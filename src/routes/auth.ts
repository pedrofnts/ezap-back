import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();
const prisma = new PrismaClient();

interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody extends LoginBody {
  name: string;
}

interface ProfileBody {
  name?: string;
  location?: string | null;
  jobTitle?: string | null;
  workMode?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  notifications?: boolean;
  notificationTime?: string;
  whatsappActive?: boolean;
  phone?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

interface RequestWithUser extends Request {
  user?: any;
}

const loginHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginBody;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: "Email ou senha incorretos" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || "sua_chave_secreta",
      { expiresIn: "24h" }
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile,
      },
      token,
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao fazer login" });
  }
};

const registerHandler = async (req: Request, res: Response) => {
  try {
    console.log("Iniciando registro - Body:", req.body);

    const { name, email, password } = req.body as RegisterBody;

    console.log("Verificando usuário existente...");
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log("Email já cadastrado:", email);
      res.status(400).json({ error: "Email já cadastrado" });
      return;
    }

    console.log("Gerando hash da senha...");
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log("Criando usuário no banco...");
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
      include: { profile: true },
    });

    console.log("Usuário criado com sucesso. Gerando token...");
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || "sua_chave_secreta",
      { expiresIn: "24h" }
    );

    console.log("Enviando resposta...");
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile,
      },
      token,
    });
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({
      error: "Erro ao criar usuário",
      details: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
};

router.post("/login", loginHandler);
router.post("/register", registerHandler);

router.put("/profile", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    const user = req.user;

    if (!user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const data = req.body as ProfileBody;
    const userId = user.id;

    if (data.currentPassword && data.newPassword) {
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (
        !currentUser ||
        !(await bcrypt.compare(data.currentPassword, currentUser.password))
      ) {
        res.status(401).json({ error: "Senha atual incorreta" });
        return;
      }

      const hashedPassword = await bcrypt.hash(data.newPassword, 10);
      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });
    }

    if (data.name) {
      await prisma.user.update({
        where: { id: userId },
        data: { name: data.name },
      });
    }

    const profileData = {
      location: data.location,
      jobTitle: data.jobTitle,
      workMode: data.workMode,
      minSalary: data.minSalary,
      maxSalary: data.maxSalary,
      notifications: data.notifications,
      notificationTime: data.notificationTime,
      whatsappActive: data.whatsappActive,
      phone: data.phone,
    };

    const profile = await prisma.profile.upsert({
      where: { userId },
      update: profileData,
      create: {
        ...profileData,
        userId,
      },
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
}) as RequestHandler);

export default router;
