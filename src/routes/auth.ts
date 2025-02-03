import { Router, Response, RequestHandler } from "express";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

router.get("/me", authenticateToken, (async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Busca o usuário com os dados da assinatura
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        stripeCustomer: {
          include: {
            subscriptions: {
              orderBy: {
                createdAt: "desc",
              },
              take: 1,
            },
          },
        },
        asaasCustomer: {
          include: {
            subscriptions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        subscription: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Verifica se o usuário tem uma assinatura ativa
    const subscription = user.subscription;
    const subscriptionDetails =
      user.stripeCustomer?.subscriptions[0] ||
      user.asaasCustomer?.subscriptions[0];

    // Formata a resposta
    const response = {
      user: {
        ...req.user,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              currentPeriodEnd: subscription.currentPeriodEnd,
            }
          : null,
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    res.status(500).json({ error: "Erro ao buscar usuário" });
  }
}) as RequestHandler);

router.post("/register", async (req, res) => {
  const { name, email, phone, supabase_uid } = req.body;

  try {
    const user = await prisma.user.create({
      data: { name, email, phone, supabase_uid },
      include: { profile: true },
    });
    res.status(201).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

export default router;
