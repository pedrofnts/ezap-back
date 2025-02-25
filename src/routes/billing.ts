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
  sandbox: false,
});

router.get("/", authenticateToken, (async (
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
              take: 24,
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
        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { userId },
        });

        if (!stripeCustomer) {
          return res
            .status(404)
            .json({ error: "Cliente Stripe não encontrado" });
        }

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
        const asaasSubscription = await asaas.subscriptions.getById(
          subscription.asaasSubscription.asaasSubscriptionId
        );

        const payments = await asaas.subscriptions.getPayments(
          subscription.asaasSubscription.asaasSubscriptionId
        );

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
          canUpdatePaymentMethod: false,
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

    if (subscription.provider === "STRIPE" && subscription.stripeSubscription) {
      await stripe.subscriptions.update(
        subscription.stripeSubscription.stripeSubscriptionId,
        { cancel_at_period_end: false }
      );

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
      const asaasCustomer = await prisma.asaasCustomer.findUnique({
        where: { id: subscription.asaasSubscription.customerId },
      });

      if (!asaasCustomer) {
        return res.status(404).json({ error: "Cliente Asaas não encontrado" });
      }

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

      await prisma.asaasSubscription.update({
        where: { id: subscription.asaasSubscription.id },
        data: {
          asaasSubscriptionId: asaasSubscription.id!,
          status: "PENDING",
          nextDueDate: new Date(asaasSubscription.nextDueDate!),
        },
      });
    }

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

router.get("/payment-status", authenticateToken, (async (
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
      const asaasSubscription = await asaas.subscriptions.getById(
        subscription.asaasSubscription.asaasSubscriptionId
      );

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

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ error: "Plano não encontrado" });
    }

    const existingSubscription = await prisma.subscription.findFirst({
      where: { userId },
      include: {
        stripeSubscription: true,
        asaasSubscription: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingSubscription && existingSubscription.status === "ACTIVE") {
      return res.status(400).json({ error: "Assinatura já existe" });
    }

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1);

    const subscriptionData = {
      planId,
      provider,
      status: "PENDING",
      priceAmount: plan.price,
      interval: plan.interval,
      currentPeriodEnd: nextDueDate,
    };

    if (provider === "STRIPE") {
      let stripeCustomer = await prisma.stripeCustomer.findUnique({
        where: { userId },
        include: { user: true },
      });

      if (!stripeCustomer) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          return res.status(404).json({ error: "Usuário não encontrado" });
        }

        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: {
            userId: user.id.toString(),
          },
        });

        stripeCustomer = await prisma.stripeCustomer.create({
          data: {
            userId: user.id,
            stripeCustomerId: customer.id,
          },
          include: { user: true },
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomer.stripeCustomerId,
        payment_method_types: ["card"],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price: plan.stripePriceId!,
            quantity: 1,
          },
        ],
      });

      let subscription;
      if (existingSubscription) {
        subscription = await prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: subscriptionData,
        });

        if (existingSubscription.stripeSubscription) {
          await prisma.stripeSubscription.update({
            where: { id: existingSubscription.stripeSubscription.id },
            data: {
              stripeSubscriptionId: session.id,
              status: "PENDING",
              currentPeriodEnd: nextDueDate,
            },
          });
        } else {
          await prisma.stripeSubscription.create({
            data: {
              id: subscription.id,
              stripeSubscriptionId: session.id,
              status: "PENDING",
              customerId: stripeCustomer.id,
              currentPeriodEnd: nextDueDate,
            },
          });
        }
      } else {
        subscription = await prisma.subscription.create({
          data: {
            userId,
            ...subscriptionData,
          },
        });

        await prisma.stripeSubscription.create({
          data: {
            id: subscription.id,
            stripeSubscriptionId: session.id,
            status: "PENDING",
            customerId: stripeCustomer.id,
            currentPeriodEnd: nextDueDate,
          },
        });
      }

      res.json({ url: session.url });
    } else if (provider === "ASAAS") {
      let asaasCustomer = await prisma.asaasCustomer.findFirst({
        where: { userId },
      });

      if (!asaasCustomer) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

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
            userId: user.id,
            asaasCustomerId: customer.id!,
          },
        });
      }

      const asaasSubscription = await asaas.subscriptions.create({
        customer: asaasCustomer.asaasCustomerId,
        billingType: "PIX",
        value: plan.price,
        nextDueDate: nextDueDate.toISOString().split("T")[0],
        cycle: plan.interval === "month" ? "MONTHLY" : "WEEKLY",
      });

      let subscription;
      if (existingSubscription) {
        subscription = await prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: subscriptionData,
        });

        if (existingSubscription.asaasSubscription) {
          await prisma.asaasSubscription.update({
            where: { id: existingSubscription.asaasSubscription.id },
            data: {
              asaasSubscriptionId: asaasSubscription.id!,
              status: "PENDING",
              customerId: asaasCustomer.id,
              cycle: plan.interval,
              value: plan.price,
              nextDueDate: nextDueDate,
            },
          });
        } else {
          await prisma.asaasSubscription.create({
            data: {
              id: subscription.id,
              asaasSubscriptionId: asaasSubscription.id!,
              status: "PENDING",
              customerId: asaasCustomer.id,
              cycle: plan.interval,
              value: plan.price,
              nextDueDate: nextDueDate,
            },
          });
        }
      } else {
        subscription = await prisma.subscription.create({
          data: {
            userId,
            ...subscriptionData,
          },
        });

        await prisma.asaasSubscription.create({
          data: {
            id: subscription.id,
            asaasSubscriptionId: asaasSubscription.id!,
            status: "PENDING",
            customerId: asaasCustomer.id,
            cycle: plan.interval,
            value: plan.price,
            nextDueDate: nextDueDate,
          },
        });
      }

      const firstPayment = await asaas.subscriptions.getPayments(
        asaasSubscription.id!
      );
      if (firstPayment.data[0]) {
        const pixQrCode = await asaas.payments.getPixQrCode(
          firstPayment.data[0].id!
        );

        // Verificar se existem dados obrigatórios antes de criar o payment
        if (!firstPayment.data[0].dueDate || !firstPayment.data[0].value) {
          throw new Error("Dados de pagamento inválidos do Asaas");
        }

        // Buscar pagamentos existentes
        const existingPayment = await prisma.asaasPayment.findFirst({
          where: {
            subscriptionId: subscription.id,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        const paymentData = {
          asaasPaymentId: firstPayment.data[0].id!,
          value: firstPayment.data[0].value,
          billingType: firstPayment.data[0].billingType || "PIX",
          status: firstPayment.data[0].status || "PENDING",
          dueDate: new Date(firstPayment.data[0].dueDate),
          subscriptionId: subscription.id,
          customerId: asaasCustomer.id,
        };

        // Se já existe um pagamento, atualiza
        if (existingPayment) {
          await prisma.asaasPayment.update({
            where: { id: existingPayment.id },
            data: paymentData,
          });
        } else {
          // Caso contrário, cria um novo
          await prisma.asaasPayment.create({
            data: paymentData,
          });
        }

        res.json({
          subscription,
          payment: {
            ...firstPayment.data[0],
            pixQrCodeUrl: pixQrCode.encodedImage,
            pixKey: pixQrCode.payload,
          },
        });
      } else {
        res.json({ subscription });
      }
    }
  } catch (error) {
    console.error("Erro ao iniciar assinatura:", error);
    res.status(500).json({ error: "Erro ao iniciar assinatura" });
  }
}) as RequestHandler);

router.post("/cancel", authenticateToken, (async (
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
        status: { in: ["ACTIVE", "PENDING"] },
      },
      include: {
        stripeSubscription: true,
        asaasSubscription: true,
      },
    });

    if (!subscription) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    if (subscription.provider === "STRIPE" && subscription.stripeSubscription) {
      // Cancela a assinatura no Stripe imediatamente
      await stripe.subscriptions.cancel(
        subscription.stripeSubscription.stripeSubscriptionId
      );

      await prisma.stripeSubscription.update({
        where: { id: subscription.stripeSubscription.id },
        data: {
          status: "CANCELLED",
          cancelAtPeriodEnd: false,
        },
      });
    } else if (
      subscription.provider === "ASAAS" &&
      subscription.asaasSubscription
    ) {
      // Cancela a assinatura no Asaas
      await asaas.subscriptions.delete(
        subscription.asaasSubscription.asaasSubscriptionId
      );

      await prisma.asaasSubscription.update({
        where: { id: subscription.asaasSubscription.id },
        data: {
          status: "CANCELLED",
        },
      });
    }

    // Atualiza a assinatura central
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELLED",
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
    console.error("Erro ao cancelar assinatura:", error);
    res.status(500).json({ error: "Erro ao cancelar assinatura" });
  }
}) as RequestHandler);

router.post("/change-plan", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { planId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!planId) {
      return res.status(400).json({ error: "ID do plano não fornecido" });
    }

    // Busca o novo plano
    const newPlan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!newPlan) {
      return res.status(404).json({ error: "Plano não encontrado" });
    }

    // Busca a assinatura atual
    const currentSubscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING"] },
      },
      include: {
        plan: true,
        stripeSubscription: true,
        asaasSubscription: true,
      },
    });

    if (!currentSubscription) {
      return res.status(404).json({ error: "Assinatura atual não encontrada" });
    }

    if (currentSubscription.planId === planId) {
      return res.status(400).json({ error: "Usuário já está neste plano" });
    }

    if (
      currentSubscription.provider === "STRIPE" &&
      currentSubscription.stripeSubscription
    ) {
      if (!newPlan.stripePriceId) {
        return res
          .status(400)
          .json({ error: "Plano não configurado para Stripe" });
      }

      // Atualiza a assinatura no Stripe
      await stripe.subscriptions.update(
        currentSubscription.stripeSubscription.stripeSubscriptionId,
        {
          items: [
            {
              id: (
                await stripe.subscriptions.retrieve(
                  currentSubscription.stripeSubscription.stripeSubscriptionId
                )
              ).items.data[0].id,
              price: newPlan.stripePriceId,
            },
          ],
          proration_behavior: "always_invoice",
        }
      );

      // Atualiza o registro da assinatura do Stripe
      await prisma.stripeSubscription.update({
        where: { id: currentSubscription.stripeSubscription.id },
        data: {
          status: "ACTIVE",
        },
      });
    } else if (
      currentSubscription.provider === "ASAAS" &&
      currentSubscription.asaasSubscription
    ) {
      // Cancela a assinatura atual no Asaas
      await asaas.subscriptions.delete(
        currentSubscription.asaasSubscription.asaasSubscriptionId
      );

      // Cria uma nova assinatura com o novo plano
      const nextDueDate = new Date();
      nextDueDate.setDate(nextDueDate.getDate() + 1);

      const asaasCustomer = await prisma.asaasCustomer.findUnique({
        where: { id: currentSubscription.asaasSubscription.customerId },
      });

      if (!asaasCustomer) {
        return res.status(404).json({ error: "Cliente Asaas não encontrado" });
      }

      const newAsaasSubscription = await asaas.subscriptions.create({
        customer: asaasCustomer.asaasCustomerId,
        billingType: "PIX",
        value: newPlan.price,
        nextDueDate: nextDueDate.toISOString().split("T")[0],
        cycle: newPlan.interval === "month" ? "MONTHLY" : "WEEKLY",
      });

      // Atualiza o registro da assinatura do Asaas
      await prisma.asaasSubscription.update({
        where: { id: currentSubscription.asaasSubscription.id },
        data: {
          asaasSubscriptionId: newAsaasSubscription.id!,
          status: "PENDING",
          value: newPlan.price,
          cycle: newPlan.interval,
          nextDueDate: new Date(newAsaasSubscription.nextDueDate!),
        },
      });

      // Busca o primeiro pagamento da nova assinatura
      const firstPayment = await asaas.subscriptions.getPayments(
        newAsaasSubscription.id!
      );

      if (firstPayment.data[0]) {
        const pixQrCode = await asaas.payments.getPixQrCode(
          firstPayment.data[0].id!
        );

        // Atualiza ou cria o registro de pagamento
        const paymentData = {
          asaasPaymentId: firstPayment.data[0].id!,
          value: firstPayment.data[0].value!,
          billingType: firstPayment.data[0].billingType || "PIX",
          status: firstPayment.data[0].status || "PENDING",
          dueDate: new Date(firstPayment.data[0].dueDate!),
          subscriptionId: currentSubscription.asaasSubscription.id,
          customerId: asaasCustomer.id,
        };

        await prisma.asaasPayment.create({
          data: paymentData,
        });
      }
    }

    // Atualiza a assinatura central
    const updatedSubscription = await prisma.subscription.update({
      where: { id: currentSubscription.id },
      data: {
        planId: newPlan.id,
        priceAmount: newPlan.price,
        interval: newPlan.interval,
        status:
          currentSubscription.provider === "STRIPE" ? "ACTIVE" : "PENDING",
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
    });

    // Se for Asaas e tiver novo pagamento, inclui os dados do PIX na resposta
    if (
      updatedSubscription.provider === "ASAAS" &&
      updatedSubscription.asaasSubscription?.payments[0]
    ) {
      const lastPayment = updatedSubscription.asaasSubscription.payments[0];
      const pixQrCode = await asaas.payments.getPixQrCode(
        lastPayment.asaasPaymentId
      );

      return res.json({
        subscription: updatedSubscription,
        payment: {
          ...lastPayment,
          pixQrCodeUrl: pixQrCode.encodedImage,
          pixKey: pixQrCode.payload,
        },
      });
    }

    res.json({ subscription: updatedSubscription });
  } catch (error) {
    console.error("Erro ao alterar plano:", error);
    res.status(500).json({ error: "Erro ao alterar plano" });
  }
}) as RequestHandler);

export default router;
