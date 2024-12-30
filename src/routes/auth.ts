import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthenticatedRequest } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

router.get("/me", authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

router.post("/register", async (req, res) => {
  const { name, email, supabase_uid } = req.body;
  try {
    const user = await prisma.user.create({
      data: { name, email, supabase_uid },
      include: { profile: true },
    });
    res.status(201).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

export default router;
