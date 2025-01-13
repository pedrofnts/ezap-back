import express, { Response, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";
import Stripe from "stripe";
import { AsaasClient } from "asaas";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});
const asaas = new AsaasClient(process.env.ASAAS_API_KEY!, {
  sandbox: process.env.NODE_ENV !== "production",
});

// Rota para obter dados da página de billing
router.get("/", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Busca a assinatura atual com todos os detalhes
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING", "CANCELLED"] },
      },
      include: {
        plan: true,
        stripeSubscription: true,
        asaasSubscription: {
          include: {
            payments: {
              orderBy: {
                dueDate: "desc",
              },
              take: 24, // Últimos 24 pagamentos
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    let billingDetails = null;

    if (subscription) {
      if (
        subscription.provider === "STRIPE" &&
        subscription.stripeSubscription
      ) {
        // Busca o customer do Stripe
        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { userId },
        });

        if (!stripeCustomer) {
          return res
            .status(404)
            .json({ error: "Cliente Stripe não encontrado" });
        }

        // Busca detalhes atualizados da assinatura no Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripeSubscription.stripeSubscriptionId,
          {
            expand: [
              "default_payment_method",
              "latest_invoice",
              "items.data.price.product",
            ],
          }
        );

        // Busca as últimas faturas
        const invoices = await stripe.invoices.list({
          customer: stripeCustomer.stripeCustomerId,
          limit: 24,
          expand: ["data.subscription"],
        });

        billingDetails = {
          subscription: stripeSubscription,
          invoices: invoices.data,
          canUpdatePaymentMethod: true,
        };
      } else if (
        subscription.provider === "ASAAS" &&
        subscription.asaasSubscription
      ) {
        // Busca detalhes atualizados da assinatura no Asaas
        const asaasSubscription = await asaas.subscriptions.getById(
          subscription.asaasSubscription.asaasSubscriptionId
        );

        // Busca os pagamentos/faturas
        const payments = await asaas.subscriptions.getPayments(
          subscription.asaasSubscription.asaasSubscriptionId
        );

        // Se tiver um pagamento pendente, busca o QR Code
        let lastPaymentWithQRCode = null;
        if (
          payments.data[0] &&
          payments.data[0].status === "PENDING" &&
          payments.data[0].billingType === "PIX"
        ) {
          const pixQrCode = await asaas.payments.getPixQrCode(
            payments.data[0].id!
          );
          lastPaymentWithQRCode = {
            ...payments.data[0],
            pixQrCodeUrl: pixQrCode.encodedImage,
            pixKey: pixQrCode.payload,
          };
        }

        billingDetails = {
          subscription: asaasSubscription,
          payments: payments.data,
          lastPaymentWithQRCode,
          canUpdatePaymentMethod: false, // PIX não permite atualização de método
        };
      }
    }

    res.json({
      subscription,
      billingDetails,
      nextBillingDate: subscription?.currentPeriodEnd,
      status: subscription?.status || "NO_SUBSCRIPTION",
    });
  } catch (error) {
    console.error("Erro ao buscar dados de billing:", error);
    res.status(500).json({ error: "Erro ao buscar dados de billing" });
  }
}) as RequestHandler);

// Rota para reativar uma assinatura cancelada
router.post("/reactivate", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: "CANCELLED",
        cancelAtPeriodEnd: true,
      },
      include: {
        stripeSubscription: true,
        asaasSubscription: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!subscription) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    // Reativa a assinatura no provedor
    if (subscription.provider === "STRIPE" && subscription.stripeSubscription) {
      await stripe.subscriptions.update(
        subscription.stripeSubscription.stripeSubscriptionId,
        { cancel_at_period_end: false }
      );

      // Atualiza o status da assinatura do Stripe
      await prisma.stripeSubscription.update({
        where: { id: subscription.stripeSubscription.id },
        data: {
          status: "ACTIVE",
          cancelAtPeriodEnd: false,
        },
      });
    } else if (
      subscription.provider === "ASAAS" &&
      subscription.asaasSubscription
    ) {
      // Busca o cliente Asaas
      const asaasCustomer = await prisma.asaasCustomer.findUnique({
        where: { id: subscription.asaasSubscription.customerId },
      });

      if (!asaasCustomer) {
        return res.status(404).json({ error: "Cliente Asaas não encontrado" });
      }

      // No Asaas, precisamos criar uma nova assinatura
      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + 1);

      const asaasSubscription = await asaas.subscriptions.create({
        customer: asaasCustomer.asaasCustomerId,
        billingType: "PIX",
        value: subscription.asaasSubscription.value,
        nextDueDate: nextDueDate.toISOString().split("T")[0],
        cycle:
          subscription.asaasSubscription.cycle === "month"
            ? "MONTHLY"
            : "WEEKLY",
      });

      // Atualiza a assinatura do Asaas
      await prisma.asaasSubscription.update({
        where: { id: subscription.asaasSubscription.id },
        data: {
          asaasSubscriptionId: asaasSubscription.id!,
          status: "PENDING",
          nextDueDate: new Date(asaasSubscription.nextDueDate!),
        },
      });
    }

    // Atualiza o status da assinatura central
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: subscription.provider === "STRIPE" ? "ACTIVE" : "PENDING",
        cancelAtPeriodEnd: false,
      },
      include: {
        plan: true,
        stripeSubscription: true,
        asaasSubscription: true,
      },
    });

    res.json({ subscription: updatedSubscription });
  } catch (error) {
    console.error("Erro ao reativar assinatura:", error);
    res.status(500).json({ error: "Erro ao reativar assinatura" });
  }
}) as RequestHandler);

// Rota para consultar status do pagamento da assinatura
router.get("/payment-status", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Busca a assinatura mais recente do usuário
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING"] },
      },
      include: {
        plan: true,
        stripeSubscription: true,
        asaasSubscription: {
          include: {
            payments: {
              orderBy: {
                dueDate: "desc",
              },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!subscription) {
      return res.json({ status: "NO_SUBSCRIPTION" });
    }

    if (subscription.provider === "ASAAS" && subscription.asaasSubscription) {
      // Busca o status atualizado da assinatura no Asaas
      const asaasSubscription = await asaas.subscriptions.getById(
        subscription.asaasSubscription.asaasSubscriptionId
      );

      // Busca o último pagamento
      const lastPayment = subscription.asaasSubscription.payments[0];
      let paymentDetails = null;

      if (lastPayment) {
        const asaasPayment = await asaas.payments.getById(
          lastPayment.asaasPaymentId
        );

        if (
          asaasPayment.status === "PENDING" &&
          lastPayment.billingType === "PIX"
        ) {
          const pixQrCode = await asaas.payments.getPixQrCode(
            lastPayment.asaasPaymentId
          );
          paymentDetails = {
            ...asaasPayment,
            pixQrCodeUrl: pixQrCode.encodedImage,
            pixKey: pixQrCode.payload,
          };
        } else {
          paymentDetails = asaasPayment;
        }
      }

      return res.json({
        status: subscription.status,
        subscription: {
          ...subscription,
          asaasDetails: {
            subscription: asaasSubscription,
            lastPayment: paymentDetails,
          },
        },
      });
    } else if (
      subscription.provider === "STRIPE" &&
      subscription.stripeSubscription
    ) {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripeSubscription.stripeSubscriptionId
      );

      return res.json({
        status: subscription.status,
        subscription: {
          ...subscription,
          stripeDetails: stripeSubscription,
        },
      });
    }

    return res.json({
      status: subscription.status,
      subscription,
    });
  } catch (error) {
    console.error("Erro ao consultar status do pagamento:", error);
    res.status(500).json({ error: "Erro ao consultar status do pagamento" });
  }
}) as RequestHandler);

// Rota para iniciar uma assinatura
router.post("/subscribe", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { planId, provider, successUrl, cancelUrl } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
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
        stripeSubscription: true,
        asaasSubscription: true,
      },
    });

    // Se existe uma assinatura pendente e o provedor é diferente, cancela a anterior
    if (
      existingSubscription &&
      existingSubscription.status === "PENDING" &&
      existingSubscription.provider !== provider
    ) {
      if (
        existingSubscription.provider === "STRIPE" &&
        existingSubscription.stripeSubscription
      ) {
        // Cancela a assinatura no Stripe
        await stripe.subscriptions.cancel(
          existingSubscription.stripeSubscription.stripeSubscriptionId
        );
        await prisma.stripeSubscription.update({
          where: { id: existingSubscription.stripeSubscription.id },
          data: { status: "CANCELLED" },
        });
      } else if (
        existingSubscription.provider === "ASAAS" &&
        existingSubscription.asaasSubscription
      ) {
        // Cancela a assinatura no Asaas
        await asaas.subscriptions.delete(
          existingSubscription.asaasSubscription.asaasSubscriptionId
        );
        await prisma.asaasSubscription.update({
          where: { id: existingSubscription.asaasSubscription.id },
          data: { status: "CANCELLED" },
        });
      }

      // Atualiza o status da assinatura central
      await prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: { status: "CANCELLED" },
      });
    } else if (
      existingSubscription &&
      existingSubscription.status === "PENDING" &&
      existingSubscription.provider === provider
    ) {
      // Se já existe uma assinatura pendente com o mesmo provedor, retorna os dados necessários
      if (provider === "STRIPE" && existingSubscription.stripeSubscription) {
        // Busca o customer do Stripe
        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { userId },
        });

        if (!stripeCustomer) {
          return res
            .status(404)
            .json({ error: "Cliente Stripe não encontrado" });
        }

        const session = await stripe.checkout.sessions.create({
          customer: stripeCustomer.stripeCustomerId,
          line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
          mode: "subscription",
          success_url: successUrl,
          cancel_url: cancelUrl,
          payment_method_types: ["card"],
          allow_promotion_codes: true,
          billing_address_collection: "required",
          customer_update: {
            address: "auto",
            name: "auto",
          },
        });

        return res.json({ url: session.url });
      } else if (
        provider === "ASAAS" &&
        existingSubscription.asaasSubscription
      ) {
        // Busca o último pagamento pendente
        const payments = await asaas.subscriptions.getPayments(
          existingSubscription.asaasSubscription.asaasSubscriptionId
        );
        const lastPayment = payments.data[0];

        if (lastPayment) {
          const pixQrCode = await asaas.payments.getPixQrCode(lastPayment.id!);
          return res.json({
            subscription: existingSubscription,
            payment: {
              ...lastPayment,
              pixQrCodeUrl: pixQrCode.encodedImage,
              pixKey: pixQrCode.payload,
            },
          });
        }
      }
    } else if (
      existingSubscription &&
      existingSubscription.status === "ACTIVE"
    ) {
      return res.status(400).json({
        error: "Usuário já possui uma assinatura ativa",
        subscription: existingSubscription,
      });
    }

    if (provider === "STRIPE") {
      // Cria ou busca o cliente no Stripe
      let stripeCustomer = await prisma.stripeCustomer.findUnique({
        where: { userId },
        include: { user: true },
      });

      if (!stripeCustomer) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          return res.status(404).json({ error: "Usuário não encontrado" });
        }

        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
        });

        stripeCustomer = await prisma.stripeCustomer.create({
          data: {
            userId,
            stripeCustomerId: customer.id,
          },
          include: { user: true },
        });
      }

      // Cria a sessão de checkout
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomer.stripeCustomerId,
        line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        billing_address_collection: "required",
        customer_update: {
          address: "auto",
          name: "auto",
        },
      });

      // Cria a assinatura central em status PENDING
      const subscription = await prisma.subscription.create({
        data: {
          userId,
          planId,
          provider: "STRIPE",
          status: "PENDING",
          priceAmount: plan.price,
          interval: plan.interval,
          currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas a partir de agora
        },
      });

      // Cria a assinatura do Stripe
      await prisma.stripeSubscription.create({
        data: {
          id: subscription.id,
          stripeSubscriptionId: session.id, // Temporariamente usa o session.id
          status: "PENDING",
          customerId: stripeCustomer.id,
          currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas a partir de agora
        },
      });

      res.json({ url: session.url });
    } else if (provider === "ASAAS") {
      // Cria ou busca o cliente no Asaas
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
        });

        asaasCustomer = await prisma.asaasCustomer.create({
          data: {
            userId,
            asaasCustomerId: customer.id,
          },
          include: { user: true },
        });

        if (!asaasCustomer) {
          return res
            .status(500)
            .json({ error: "Erro ao criar cliente no Asaas" });
        }
      }

      // Neste ponto, temos certeza que asaasCustomer existe e não é null
      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + 1);

      const asaasSubscription = await asaas.subscriptions.create({
        customer: asaasCustomer.asaasCustomerId,
        billingType: "PIX",
        value: plan.price,
        nextDueDate: nextDueDate.toISOString().split("T")[0],
        cycle: plan.interval === "month" ? "MONTHLY" : "WEEKLY",
      });

      // Cria as assinaturas em uma transação
      const result = await prisma.$transaction(async (prisma) => {
        // Neste ponto, já verificamos que asaasCustomer não é null
        const subscription = await prisma.subscription.create({
          data: {
            userId,
            planId,
            provider: "ASAAS",
            status: "PENDING",
            currentPeriodEnd: new Date(asaasSubscription.nextDueDate!),
            priceAmount: plan.price,
            interval: plan.interval,
          },
        });

        // Asserção de tipo para garantir que o TypeScript entende que asaasCustomer existe
        if (!asaasCustomer) throw new Error("AsaasCustomer não encontrado");

        // Cria a assinatura do Asaas
        const savedAsaasSubscription = await prisma.asaasSubscription.create({
          data: {
            id: subscription.id, // Usa o mesmo ID da subscription central
            asaasSubscriptionId: asaasSubscription.id!,
            customerId: asaasCustomer.id,
            value: asaasSubscription.value!,
            cycle: asaasSubscription.cycle!,
            status: "PENDING",
            nextDueDate: new Date(asaasSubscription.nextDueDate!),
            description: asaasSubscription.description,
          },
        });

        return { subscription, savedAsaasSubscription };
      });

      const { subscription, savedAsaasSubscription } = result;

      // Busca os pagamentos da assinatura
      const subscriptionPayments = await asaas.subscriptions.getPayments(
        asaasSubscription.id!
      );
      const firstPayment = subscriptionPayments.data[0];

      if (firstPayment) {
        // Busca o QR Code PIX
        const pixQrCode = await asaas.payments.getPixQrCode(firstPayment.id!);

        // Salva o pagamento
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
    } else {
      res.status(400).json({ error: "Provedor de pagamento inválido" });
    }
  } catch (error) {
    console.error("Erro ao iniciar assinatura:", error);
    res.status(500).json({ error: "Erro ao iniciar assinatura" });
  }
}) as RequestHandler);

export default router;
