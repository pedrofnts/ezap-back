import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { PrismaClient } from "@prisma/client";
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

router.get("/", authenticateToken, (async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user!.id },
    });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar perfil" });
  }
}) as RequestHandler);

router.put("/", authenticateToken, (async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data: ProfileBody = req.body;

    const profile = await prisma.profile.upsert({
      where: { userId: req.user!.id },
      update: data,
      create: {
        ...data,
        userId: req.user!.id,
      },
    });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
}) as RequestHandler);

export default router;
