import express, { Response, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";
import { AsaasClient } from "asaas";

const router = express.Router();
const prisma = new PrismaClient();
const asaas = new AsaasClient(process.env.ASAAS_API_KEY!, {
  sandbox: false,
});

// Rota para criar uma assinatura PIX
router.post("/create-subscription", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { value, planId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!planId) {
      return res.status(400).json({ error: "ID do plano não fornecido" });
    }

    // Busca o plano
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ error: "Plano não encontrado" });
    }

    // Verifica se já existe uma assinatura ativa
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING"] },
      },
      include: {
        asaasSubscription: true,
        stripeSubscription: true,
      },
    });

    if (existingSubscription) {
      return res.status(400).json({
        error: "Usuário já possui uma assinatura ativa",
        subscription: existingSubscription,
      });
    }

    // Busca ou cria o cliente no Asaas
    let asaasCustomer = await prisma.asaasCustomer.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!asaasCustomer) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const customer = await asaas.customers.new({
        name: user.name,
        email: user.email,
        phone: user.phone || undefined,
        cpfCnpj: "07192534978",
        notificationDisabled: true,
      });

      asaasCustomer = await prisma.asaasCustomer.create({
        data: {
          userId,
          asaasCustomerId: customer.id,
        },
        include: { user: true },
      });
    }

    // Cria a assinatura com pagamento PIX
    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1); // Primeiro pagamento em 24h

    const asaasSubscription = await asaas.subscriptions.create({
      customer: asaasCustomer.asaasCustomerId,
      billingType: "PIX",
      value: value,
      nextDueDate: nextDueDate.toISOString().split("T")[0],
      cycle: "MONTHLY",
    });

    // Salva a assinatura do Asaas no banco com status PENDING
    const savedAsaasSubscription = await prisma.asaasSubscription.create({
      data: {
        asaasSubscriptionId: asaasSubscription.id!,
        customerId: asaasCustomer.id,
        value: asaasSubscription.value!,
        cycle: asaasSubscription.cycle!,
        status: "PENDING", // Status inicial como PENDING
        nextDueDate: new Date(asaasSubscription.nextDueDate!),
        description: asaasSubscription.description,
      },
    });

    // Cria a assinatura central com status PENDING
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        provider: "ASAAS",
        status: "PENDING",
        currentPeriodEnd: new Date(asaasSubscription.nextDueDate!),
        priceAmount: asaasSubscription.value!,
        interval: "month",
        asaasSubscription: {
          connect: {
            id: savedAsaasSubscription.id,
          },
        },
      },
      include: {
        asaasSubscription: true,
      },
    });

    // Busca os pagamentos da assinatura
    const subscriptionPayments = await asaas.subscriptions.getPayments(
      asaasSubscription.id!
    );
    const firstPayment = subscriptionPayments.data[0];

    if (firstPayment) {
      // Busca o QR Code PIX do primeiro pagamento
      const pixQrCode = await asaas.payments.getPixQrCode(firstPayment.id!);

      // Salva o pagamento no banco
      await prisma.asaasPayment.create({
        data: {
          asaasPaymentId: firstPayment.id!,
          customerId: asaasCustomer.id,
          subscriptionId: savedAsaasSubscription.id,
          value: firstPayment.value!,
          status: firstPayment.status!,
          billingType: firstPayment.billingType!,
          dueDate: new Date(firstPayment.dueDate!),
          invoiceUrl: firstPayment.invoiceUrl || null,
          pixQrCodeUrl: pixQrCode.encodedImage || null,
          pixKey: pixQrCode.payload || null,
        },
      });

      res.json({
        subscription,
        payment: {
          ...firstPayment,
          pixQrCodeUrl: pixQrCode.encodedImage,
          pixKey: pixQrCode.payload,
        },
      });
    } else {
      res.json({ subscription });
    }
  } catch (error) {
    console.error("Erro ao criar assinatura:", error);
    res.status(500).json({ error: "Erro ao criar assinatura" });
  }
}) as RequestHandler);

// Rota para consultar status da assinatura
router.get("/subscription/:subscriptionId", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const subscription = await prisma.asaasSubscription.findFirst({
      where: {
        asaasSubscriptionId: subscriptionId,
        customer: {
          userId,
        },
      },
      include: {
        payments: true,
      },
    });

    if (!subscription) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    const asaasSubscription = await asaas.subscriptions.getById(subscriptionId);
    const subscriptionPayments = await asaas.subscriptions.getPayments(
      subscriptionId
    );

    // Atualiza o status da assinatura no banco
    const updatedSubscription = await prisma.asaasSubscription.update({
      where: { id: subscription.id },
      data: {
        status: asaasSubscription.status!,
        nextDueDate: new Date(asaasSubscription.nextDueDate!),
      },
    });

    res.json({
      subscription: updatedSubscription,
      payments: subscriptionPayments.data,
    });
  } catch (error) {
    console.error("Erro ao consultar assinatura:", error);
    res.status(500).json({ error: "Erro ao consultar assinatura" });
  }
}) as RequestHandler);

// Rota para consultar status do pagamento
router.get("/payment/:paymentId", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { paymentId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Busca o pagamento no banco e verifica se pertence ao usuário
    const payment = await prisma.asaasPayment.findFirst({
      where: {
        asaasPaymentId: paymentId,
        customer: {
          userId,
        },
      },
      include: {
        subscription: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Pagamento não encontrado" });
    }

    // Busca o status atualizado do pagamento no Asaas
    const asaasPayment = await asaas.payments.getById(paymentId);

    // Se for um pagamento PIX, busca o QR Code atualizado
    let pixQrCode = null;
    if (payment.billingType === "PIX") {
      pixQrCode = await asaas.payments.getPixQrCode(paymentId);
    }

    // Atualiza o status do pagamento no banco
    const updatedPayment = await prisma.asaasPayment.update({
      where: { id: payment.id },
      data: {
        status: asaasPayment.status!,
        pixQrCodeUrl: pixQrCode?.encodedImage || payment.pixQrCodeUrl,
        pixKey: pixQrCode?.payload || payment.pixKey,
      },
      include: {
        subscription: true,
      },
    });

    res.json({
      payment: {
        ...updatedPayment,
        invoiceUrl: asaasPayment.invoiceUrl,
      },
    });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
}) as RequestHandler);

// Rota para listar assinaturas do usuário
router.get("/subscriptions", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Busca apenas a assinatura ativa ou pendente
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING"] },
      },
      include: {
        asaasSubscription: {
          include: {
            payments: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json({ subscription });
  } catch (error) {
    console.error("Erro ao listar assinaturas:", error);
    res.status(500).json({ error: "Erro ao listar assinaturas" });
  }
}) as RequestHandler);

// Webhook para receber atualizações de status
router.post("/webhook", (async (req, res) => {
  try {
    const event = req.body;
    console.log("Webhook recebido:", JSON.stringify(event, null, 2));

    // Lista de eventos que atualizam o status do pagamento
    const paymentStatusEvents = [
      "PAYMENT_RECEIVED",
      "PAYMENT_CONFIRMED",
      "PAYMENT_UPDATED",
      "PAYMENT_OVERDUE",
      "PAYMENT_DELETED",
      "PAYMENT_RESTORED",
      "PAYMENT_REFUNDED",
      "PAYMENT_RECEIVED_IN_CASH_UNDONE",
      "PAYMENT_CHARGEBACK_REQUESTED",
      "PAYMENT_CHARGEBACK_DISPUTE",
      "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
    ];

    if (paymentStatusEvents.includes(event.event)) {
      console.log("Buscando pagamento:", event.payment.id);

      // Busca o pagamento e inclui a subscription com seus pagamentos
      const payment = await prisma.asaasPayment.findFirst({
        where: { asaasPaymentId: event.payment.id },
        include: {
          subscription: {
            include: {
              subscription: true,
              payments: {
                orderBy: {
                  dueDate: "asc",
                },
              },
            },
          },
        },
      });

      console.log("Pagamento encontrado:", payment);

      if (!payment) {
        console.log(
          "Pagamento não encontrado, buscando pela subscription:",
          event.payment.subscription
        );

        // Se não encontrou o pagamento, tenta criar baseado na subscription
        if (event.payment.subscription) {
          const asaasSubscription = await prisma.asaasSubscription.findFirst({
            where: { asaasSubscriptionId: event.payment.subscription },
            include: {
              customer: true,
              subscription: true,
            },
          });

          if (asaasSubscription) {
            console.log("Subscription encontrada:", asaasSubscription);

            // Cria o pagamento no banco
            const newPayment = await prisma.asaasPayment.create({
              data: {
                asaasPaymentId: event.payment.id,
                customerId: asaasSubscription.customerId,
                subscriptionId: asaasSubscription.id,
                value: event.payment.value,
                status: event.payment.status,
                billingType: event.payment.billingType,
                dueDate: new Date(event.payment.dueDate),
                invoiceUrl: event.payment.invoiceUrl || null,
              },
            });

            console.log("Novo pagamento criado:", newPayment);

            // Busca os dados atualizados da subscription no Asaas
            const updatedAsaasSubscription = await asaas.subscriptions.getById(
              event.payment.subscription
            );

            // Atualiza o status da subscription do Asaas
            await prisma.asaasSubscription.update({
              where: { id: asaasSubscription.id },
              data: {
                status: updatedAsaasSubscription.status!,
                nextDueDate: new Date(updatedAsaasSubscription.nextDueDate!),
              },
            });

            // Atualiza a subscription central
            if (asaasSubscription.subscription) {
              await prisma.subscription.update({
                where: { id: asaasSubscription.subscription.id },
                data: {
                  status: updatedAsaasSubscription.status!,
                  currentPeriodEnd: new Date(
                    updatedAsaasSubscription.nextDueDate!
                  ),
                },
              });
            }
          } else {
            console.log("Subscription não encontrada");
          }
        }
      } else {
        // Atualiza o status do pagamento existente
        console.log("Atualizando status do pagamento:", payment.id);

        await prisma.asaasPayment.update({
          where: { id: payment.id },
          data: {
            status: event.payment.status,
            pixQrCodeUrl:
              event.event === "PAYMENT_DELETED" ||
              event.event === "PAYMENT_REFUNDED"
                ? null
                : undefined,
            pixKey:
              event.event === "PAYMENT_DELETED" ||
              event.event === "PAYMENT_REFUNDED"
                ? null
                : undefined,
          },
        });

        // Se o pagamento está vinculado a uma assinatura, atualiza os status
        if (payment.subscriptionId && payment.subscription?.subscription) {
          console.log("Atualizando subscriptions:", payment.subscriptionId);

          // Busca os dados atualizados da subscription no Asaas
          const updatedAsaasSubscription = await asaas.subscriptions.getById(
            event.payment.subscription
          );

          // Verifica se é o primeiro pagamento e se foi confirmado
          const isFirstPayment =
            payment.subscription.payments[0]?.id === payment.id;
          const isPaymentConfirmed = ["RECEIVED", "CONFIRMED"].includes(
            event.payment.status
          );

          // Define o status da assinatura
          let subscriptionStatus = updatedAsaasSubscription.status;
          if (isFirstPayment) {
            subscriptionStatus = isPaymentConfirmed ? "ACTIVE" : "PENDING";
          }

          // Atualiza o status da subscription do Asaas
          await prisma.asaasSubscription.update({
            where: { id: payment.subscriptionId },
            data: {
              status: subscriptionStatus,
              nextDueDate: new Date(updatedAsaasSubscription.nextDueDate!),
            },
          });

          // Atualiza a subscription central
          await prisma.subscription.update({
            where: { id: payment.subscription.subscription.id },
            data: {
              status: subscriptionStatus,
              currentPeriodEnd: new Date(updatedAsaasSubscription.nextDueDate!),
            },
          });
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
}) as RequestHandler);

export default router;
