import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient, User } from "@prisma/client";

const prisma = new PrismaClient();

interface JwtPayload {
  userId: string;
}

interface RequestWithUser extends Request {
  user?: User;
}

export const authenticateToken = (async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({ error: "Token não fornecido" });
      return;
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "sua_chave_secreta"
    ) as JwtPayload;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { profile: true },
    });

    if (!user) {
      res.status(401).json({ error: "Usuário não encontrado" });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: "Token inválido" });
  }
}) as RequestHandler;
