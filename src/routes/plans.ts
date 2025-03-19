import express, { Request, Response, RequestHandler } from "express";
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

// Rota para listar planos disponíveis
router.get("/", (async (req: Request, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: { price: "asc" },
    });

    res.json({ plans });
  } catch (error) {
    console.error("Erro ao listar planos:", error);
    res.status(500).json({ error: "Erro ao listar planos" });
  }
}) as RequestHandler);

// Rota para criar um novo plano
router.post("/", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { name, description, features, price, interval } = req.body;

    // Cria o preço no Stripe
    const stripePrice = await stripe.prices.create({
      unit_amount: Math.round(price * 100),
      currency: "brl",
      recurring: { interval },
      product_data: {
        name,
        metadata: {
          features: JSON.stringify(features),
          description: description,
        },
      },
    });

    // Cria o plano no banco
    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        features,
        price,
        interval,
        billingCycle: interval === "month" ? "monthly" : "weekly",
        stripePriceId: stripePrice.id,
      },
    });

    res.json({ plan });
  } catch (error) {
    console.error("Erro ao criar plano:", error);
    res.status(500).json({ error: "Erro ao criar plano" });
  }
}) as RequestHandler);

// Rota para atualizar um plano
router.put("/:planId", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { planId } = req.params;
    const { name, description, features, price, interval, active } = req.body;

    const plan = await prisma.plan.update({
      where: { id: planId },
      data: {
        name,
        description,
        features,
        price,
        interval,
        active,
      },
    });

    res.json({ plan });
  } catch (error) {
    console.error("Erro ao atualizar plano:", error);
    res.status(500).json({ error: "Erro ao atualizar plano" });
  }
}) as RequestHandler);

export default router;
