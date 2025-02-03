import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import { PrismaClient, User } from "@prisma/client";
import { authenticateToken } from "../middleware/auth";
import { createSearch } from "../utils/searchApi";

const router = express.Router();
const prisma = new PrismaClient();

interface ProfileBody {
  location?: string;
  jobTitle?: string;
  workMode?: string;
  minSalary?: number;
  maxSalary?: number;
  phone?: string;
  notifications?: boolean;
  notificationTime?: string;
  whatsappActive?: boolean;
  name?: string;
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

    if (data.name) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { name: data.name },
      });
      delete data.name;
    }

    if (data.phone) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { phone: data.phone },
      });
    }

    const profile = await prisma.profile.upsert({
      where: { userId: req.user.id },
      update: data,
      create: {
        ...data,
        userId: req.user.id,
        phone: data.phone || req.user.phone || undefined,
      },
    });

    if (profile.location && profile.jobTitle) {
      const [cidade, estado] = profile.location.split(" - ");
      try {
        const whatsapp = profile.phone
          ? `55${profile.phone.replace(/\D/g, "")}`
          : null;

        await createSearch({
          user_id: req.user.id,
          cargo: profile.jobTitle,
          cidade,
          estado,
          whatsapp,
        });
      } catch (error) {
        console.error("Erro ao criar busca:", error);
      }
    }

    res.json(profile);
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
}) as RequestHandler);

export default router;
