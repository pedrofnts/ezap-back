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
    console.log("[/me] Rota acessada, verificando usuário autenticado");

    if (!req.user?.id) {
      console.log("[/me] Usuário não autenticado ou ID ausente");
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    console.log(
      `[/me] Buscando informações completas para usuário ID: ${req.user.id}`
    );

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
      console.log(`[/me] Usuário ${req.user.id} não encontrado no banco`);
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    console.log(`[/me] Usuário ${user.id} encontrado, formatando resposta`);

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

    console.log(`[/me] Retornando resposta para usuário ${user.id}`);
    res.json(response);
  } catch (error) {
    console.error("[/me] Erro ao buscar usuário:", error);
    res.status(500).json({
      error: "Erro ao buscar usuário",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
}) as RequestHandler);

router.post("/register", async (req, res) => {
  const { name, email, phone, supabase_uid, referral } = req.body;

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        supabase_uid,
        referral: referral || undefined,
      },
      include: { profile: true },
    });
    res.status(201).json({ user });
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

// Nova rota para validar token
router.post("/validate-token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({
        valid: false,
        error: "Token não fornecido",
      });
      return;
    }

    console.log(
      `[/validate-token] Verificando token: ${token.substring(0, 15)}...`
    );

    // Verificar o token com o Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.log("[/validate-token] Erro na verificação:", error.message);
      res.status(200).json({
        valid: false,
        supabaseValid: false,
        error: error.message,
      });
      return;
    }

    if (!data.user) {
      res.status(200).json({
        valid: false,
        supabaseValid: true,
        error: "Token válido, mas usuário não encontrado",
      });
      return;
    }

    // Verificar se o usuário existe no banco
    const user = await prisma.user.findUnique({
      where: { supabase_uid: data.user.id },
    });

    if (!user) {
      res.status(200).json({
        valid: false,
        supabaseValid: true,
        supabaseUser: {
          id: data.user.id,
          email: data.user.email,
        },
        error: "Usuário não encontrado no banco de dados",
      });
      return;
    }

    res.status(200).json({
      valid: true,
      supabaseValid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("[/validate-token] Erro não tratado:", error);
    res.status(500).json({
      valid: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});

export default router;
