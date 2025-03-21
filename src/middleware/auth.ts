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
      console.log("[Auth] Token não fornecido");
      res.status(401).json({ error: "Token não fornecido" });
      return;
    }

    console.log(`[Auth] Verificando token: ${token.substring(0, 15)}...`);

    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error("[Auth] Erro na verificação do token Supabase:", error);
      res
        .status(401)
        .json({ error: "Usuário não autenticado", details: error.message });
      return;
    }

    const supabaseUser = data.user;
    if (!supabaseUser) {
      console.log("[Auth] Token válido, mas usuário Supabase não encontrado");
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    console.log(`[Auth] Usuário Supabase encontrado: ${supabaseUser.id}`);

    const user = await prisma.user.findUnique({
      where: { supabase_uid: supabaseUser.id },
      include: { profile: true },
    });

    if (!user) {
      console.log(
        `[Auth] Usuário não encontrado no banco de dados com supabase_uid: ${supabaseUser.id}`
      );
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    console.log(`[Auth] Usuário autenticado com sucesso: ${user.id}`);
    req.user = user;
    next();
  } catch (error) {
    console.error("[Auth] Erro não tratado na autenticação:", error);
    res.status(403).json({
      error: "Token inválido",
      details: "Erro durante a verificação do token",
    });
  }
};
