import express, { Request, Response, RequestHandler } from "express";
import { PrismaClient, User } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";
import Stripe from "stripe";

const router = express.Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

// Rota para listar planos disponíveis
router.get("/plans", (async (req: Request, res: Response) => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      type: "recurring",
      expand: ["data.product"],
    });

    const plans = prices.data.map((price) => ({
      id: price.id,
      product: price.product,
      unit_amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval,
      interval_count: price.recurring?.interval_count,
    }));

    res.json({ plans });
  } catch (error) {
    console.error("Erro ao listar planos:", error);
    res.status(500).json({ error: "Erro ao listar planos" });
  }
}) as RequestHandler);

// Rota para criar uma sessão de checkout
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
      subscription_data: {
        trial_period_days: 7,
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Erro ao criar sessão de checkout:", error);
    res.status(500).json({ error: "Erro ao criar sessão de checkout" });
  }
}) as RequestHandler);

// Rota para obter detalhes da assinatura atual
router.get("/subscription", authenticateToken, (async (
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
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!stripeCustomer || !stripeCustomer.subscriptions[0]) {
      return res.json({ subscription: null });
    }

    const subscription = await stripe.subscriptions.retrieve(
      stripeCustomer.subscriptions[0].stripeSubscriptionId,
      {
        expand: ["default_payment_method", "items.data.price.product"],
      }
    );

    res.json({ subscription });
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

// Rota para baixar fatura
router.get("/invoices/:invoiceId", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { invoiceId } = req.params;
    const invoice = await stripe.invoices.retrieve(invoiceId);

    if (!invoice.invoice_pdf) {
      return res.status(404).json({ error: "PDF da fatura não encontrado" });
    }

    res.json({ pdf_url: invoice.invoice_pdf });
  } catch (error) {
    console.error("Erro ao baixar fatura:", error);
    res.status(500).json({ error: "Erro ao baixar fatura" });
  }
}) as RequestHandler);

// Rota para cancelar assinatura
router.post("/cancel-subscription", authenticateToken, (async (
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
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!stripeCustomer || !stripeCustomer.subscriptions[0]) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    const subscription = await stripe.subscriptions.update(
      stripeCustomer.subscriptions[0].stripeSubscriptionId,
      {
        cancel_at_period_end: true,
        cancellation_details: {
          comment:
            req.body.cancellation_reason ||
            "Cancelamento solicitado pelo usuário",
        },
      }
    );

    await prisma.stripeSubscription.update({
      where: { id: stripeCustomer.subscriptions[0].id },
      data: { status: "canceling" },
    });

    res.json({ subscription });
  } catch (error) {
    console.error("Erro ao cancelar assinatura:", error);
    res.status(500).json({ error: "Erro ao cancelar assinatura" });
  }
}) as RequestHandler);

// Rota para criar sessão de atualização de cartão/plano
router.post("/create-billing-portal-session", authenticateToken, (async (
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
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const { return_url } = req.body;

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomer.stripeCustomerId,
      return_url,
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
      flow_data: {
        type: "payment_method_update",
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Erro ao criar sessão do portal de faturamento:", error);
    res
      .status(500)
      .json({ error: "Erro ao criar sessão do portal de faturamento" });
  }
}) as RequestHandler);

// Rota para reativar assinatura cancelada
router.post("/reactivate-subscription", authenticateToken, (async (
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
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!stripeCustomer || !stripeCustomer.subscriptions[0]) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    const subscription = await stripe.subscriptions.update(
      stripeCustomer.subscriptions[0].stripeSubscriptionId,
      { cancel_at_period_end: false }
    );

    await prisma.stripeSubscription.update({
      where: { id: stripeCustomer.subscriptions[0].id },
      data: { status: "active" },
    });

    res.json({ subscription });
  } catch (error) {
    console.error("Erro ao reativar assinatura:", error);
    res.status(500).json({ error: "Erro ao reativar assinatura" });
  }
}) as RequestHandler);

// Rota para atualizar método de pagamento
router.post("/update-payment-method", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { paymentMethodId } = req.body;
    if (!paymentMethodId) {
      return res
        .status(400)
        .json({ error: "ID do método de pagamento não fornecido" });
    }

    const stripeCustomer = await prisma.stripeCustomer.findUnique({
      where: { userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!stripeCustomer) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    // Anexa o método de pagamento ao cliente
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomer.stripeCustomerId,
    });

    // Define como método de pagamento padrão
    await stripe.customers.update(stripeCustomer.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Se houver uma assinatura ativa, atualiza o método de pagamento
    if (stripeCustomer.subscriptions[0]) {
      await stripe.subscriptions.update(
        stripeCustomer.subscriptions[0].stripeSubscriptionId,
        {
          default_payment_method: paymentMethodId,
        }
      );
    }

    res.json({ message: "Método de pagamento atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar método de pagamento:", error);
    res.status(500).json({ error: "Erro ao atualizar método de pagamento" });
  }
}) as RequestHandler);

// Rota para aplicar cupom de desconto
router.post("/apply-coupon", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { couponId } = req.body;
    if (!couponId) {
      return res.status(400).json({ error: "ID do cupom não fornecido" });
    }

    const stripeCustomer = await prisma.stripeCustomer.findUnique({
      where: { userId },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!stripeCustomer || !stripeCustomer.subscriptions[0]) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    const subscription = await stripe.subscriptions.update(
      stripeCustomer.subscriptions[0].stripeSubscriptionId,
      {
        coupon: couponId,
      }
    );

    res.json({ subscription });
  } catch (error) {
    console.error("Erro ao aplicar cupom:", error);
    res.status(500).json({ error: "Erro ao aplicar cupom" });
  }
}) as RequestHandler);

// Rota para verificar cupom de desconto
router.get("/verify-coupon/:couponId", (async (req: Request, res: Response) => {
  try {
    const { couponId } = req.params;
    const coupon = await stripe.coupons.retrieve(couponId);

    res.json({ coupon });
  } catch (error) {
    console.error("Erro ao verificar cupom:", error);
    res.status(500).json({ error: "Cupom inválido" });
  }
}) as RequestHandler);

// Webhook do Stripe
router.post("/webhook", (async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    return res
      .status(400)
      .json({ error: "Assinatura do webhook não encontrada" });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.customer) break;

        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { stripeCustomerId: session.customer.toString() },
        });

        if (!stripeCustomer) break;

        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription.toString()
          );

          await prisma.stripeSubscription.create({
            data: {
              stripeSubscriptionId: subscription.id,
              status: subscription.status,
              currentPeriodEnd: new Date(
                subscription.current_period_end * 1000
              ),
              customerId: stripeCustomer.id,
            },
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription || !invoice.customer) break;

        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { stripeCustomerId: invoice.customer.toString() },
        });

        if (!stripeCustomer) break;

        await prisma.stripeSubscription.update({
          where: { stripeSubscriptionId: invoice.subscription.toString() },
          data: {
            status: "active",
            currentPeriodEnd: new Date(invoice.period_end * 1000),
          },
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription || !invoice.customer) break;

        const stripeCustomer = await prisma.stripeCustomer.findUnique({
          where: { stripeCustomerId: invoice.customer.toString() },
        });

        if (!stripeCustomer) break;

        await prisma.stripeSubscription.update({
          where: { stripeSubscriptionId: invoice.subscription.toString() },
          data: { status: "past_due" },
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await prisma.stripeSubscription.update({
          where: { stripeSubscriptionId: subscription.id },
          data: { status: "canceled" },
        });
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await prisma.stripeSubscription.update({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Erro ao processar webhook:", error);
    res.status(400).json({ error: "Erro ao processar webhook" });
  }
}) as RequestHandler);

export default router;
