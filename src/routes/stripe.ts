import express, { Request, Response, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";
import Stripe from "stripe";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

// Webhook para receber eventos do Stripe
router.post("/webhook", (async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Erro no webhook:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );

      // Busca a assinatura pelo session ID que foi salvo temporariamente
      const stripeSubscription = await prisma.stripeSubscription.findFirst({
        where: { stripeSubscriptionId: session.id },
      });

      if (stripeSubscription) {
        // Atualiza a assinatura do Stripe com o ID correto da subscription
        await prisma.stripeSubscription.update({
          where: { id: stripeSubscription.id },
          data: {
            stripeSubscriptionId: subscription.id,
            status: "ACTIVE",
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
        });

        // Atualiza a assinatura central
        await prisma.subscription.update({
          where: { id: stripeSubscription.id },
          data: {
            status: "ACTIVE",
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
        });
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;

      // Busca a assinatura pelo ID da subscription
      const stripeSubscription = await prisma.stripeSubscription.findFirst({
        where: { stripeSubscriptionId: subscription.id },
      });

      if (stripeSubscription) {
        // Atualiza a assinatura do Stripe
        await prisma.stripeSubscription.update({
          where: { id: stripeSubscription.id },
          data: {
            status: subscription.status === "active" ? "ACTIVE" : "CANCELLED",
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
        });

        // Atualiza a assinatura central
        await prisma.subscription.update({
          where: { id: stripeSubscription.id },
          data: {
            status: subscription.status === "active" ? "ACTIVE" : "CANCELLED",
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Erro ao processar webhook:", error);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
}) as RequestHandler);

// Rota para criar sessão de checkout
router.post("/create-checkout-session", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { priceId, successUrl, cancelUrl } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
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

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
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

    res.json({ url: session.url });
  } catch (error) {
    console.error("Erro ao criar sessão de checkout:", error);
    res.status(500).json({ error: "Erro ao criar sessão de checkout" });
  }
}) as RequestHandler);

router.get("/subscription", authenticateToken, (async (
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
        stripeSubscription: true,
      },
    });

    if (!subscription) {
      return res.json({ subscription: null });
    }

    // Busca os detalhes atualizados da assinatura no Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscription!.stripeSubscriptionId,
      {
        expand: ["default_payment_method", "items.data.price.product"],
      }
    );

    res.json({
      subscription: {
        ...subscription,
        stripeDetails: stripeSubscription,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar assinatura:", error);
    res.status(500).json({ error: "Erro ao buscar assinatura" });
  }
}) as RequestHandler);

// Rota para listar faturas
router.get("/invoices", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const stripeCustomer = await prisma.stripeCustomer.findUnique({
      where: { userId },
    });

    if (!stripeCustomer) {
      return res.json({ invoices: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: stripeCustomer.stripeCustomerId,
      limit: 24,
      expand: ["data.subscription"],
    });

    res.json({ invoices: invoices.data });
  } catch (error) {
    console.error("Erro ao buscar faturas:", error);
    res.status(500).json({ error: "Erro ao buscar faturas" });
  }
}) as RequestHandler);

export default router;
