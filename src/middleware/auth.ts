import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient, User } from "@prisma/client";

const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      res.status(401).json({ error: "Token não fornecido" });
      return;
    }

    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser(token);
    if (!supabaseUser) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { supabase_uid: supabaseUser.id },
      include: { profile: true },
    });

    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: "Token inválido" });
  }
};
