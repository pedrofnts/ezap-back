import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { PrismaClient, User } from "@prisma/client";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();
const prisma = new PrismaClient();

interface ProfileBody {
  location?: string;
  jobTitle?: string;
  workMode?: string;
  minSalary?: number;
  maxSalary?: number;
}

interface RequestWithUser extends Request {
  user?: User;
}

router.get("/", authenticateToken, (async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
    });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar perfil" });
  }
}) as RequestHandler);

router.put("/", authenticateToken, (async (
  req: RequestWithUser,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const data: ProfileBody = req.body;

    const profile = await prisma.profile.upsert({
      where: { userId: req.user.id },
      update: data,
      create: {
        ...data,
        userId: req.user.id,
      },
    });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
}) as RequestHandler);

export default router;
