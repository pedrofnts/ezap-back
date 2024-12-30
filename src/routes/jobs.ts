import express, { Request, Response, RequestHandler } from "express";
import { PrismaClient, User, Prisma } from "@prisma/client";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();
const prisma = new PrismaClient();

interface JobPayload {
  cargo: string;
  empresa: string;
  cidade: string;
  estado: string;
  descricao: string | null;
  url: string;
  origem: string;
  data_publicacao: string | null;
  nivel: string | null;
  tipo: string;
  salario_minimo: number | null;
  salario_maximo: number | null;
  is_home_office: boolean;
  is_confidential: boolean;
}

interface WebhookPayload {
  search_id: number;
  user_id: number;
  jobs: JobPayload[];
}

interface RequestWithUser extends Request {
  user?: User;
}

// Webhook para receber vagas
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const { search_id, user_id, jobs } = req.body as WebhookPayload;

    // Verificar se o usuário existe
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    // Criar ou atualizar a busca
    const search = await prisma.search.upsert({
      where: { id: search_id },
      update: {},
      create: {
        id: search_id,
        userId: user_id,
      },
    });

    // Criar as vagas
    const jobsData = jobs.map((job) => ({
      searchId: search.id,
      cargo: job.cargo,
      empresa: job.empresa,
      cidade: job.cidade,
      estado: job.estado,
      descricao: job.descricao || "Sem descrição disponível",
      url: job.url,
      origem: job.origem,
      dataPublicacao: job.data_publicacao
        ? new Date(job.data_publicacao)
        : null,
      nivel: job.nivel || null,
      tipo: job.tipo || "N/A",
      salarioMinimo:
        typeof job.salario_minimo === "number" ? job.salario_minimo : null,
      salarioMaximo:
        typeof job.salario_maximo === "number" ? job.salario_maximo : null,
      isHomeOffice: job.is_home_office || false,
      isConfidential: job.is_confidential || false,
    }));

    // Inserir novas vagas
    await prisma.job.createMany({
      data: jobsData,
    });

    res.status(200).json({ message: "Vagas recebidas com sucesso" });
  } catch (error) {
    console.error("Erro ao processar webhook:", error);
    res.status(500).json({ error: "Erro ao processar vagas" });
  }
});

// Rota para consultar vagas do usuário
router.get("/", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const jobs = await prisma.job.findMany({
      where: {
        search: {
          userId: req.user.id,
        },
      },
      include: {
        search: true,
        favorites: {
          where: {
            userId: req.user.id,
          },
        },
        views: {
          where: {
            userId: req.user.id,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transformar os resultados para incluir flags de favorito e visualização
    const transformedJobs = jobs.map((job) => ({
      ...job,
      isFavorited: job.favorites.length > 0,
      isViewed: job.views.length > 0,
      // Remover os arrays de relacionamentos da resposta
      favorites: undefined,
      views: undefined,
    }));

    res.json(transformedJobs);
  } catch (error) {
    console.error("Erro ao buscar vagas:", error);
    res.status(500).json({ error: "Erro ao buscar vagas" });
  }
}) as RequestHandler);

// Rota para marcar vaga como vista
router.post("/:id/view", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "ID da vaga inválido" });
      return;
    }

    // Verifica se a vaga existe
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      res.status(404).json({ error: "Vaga não encontrada" });
      return;
    }

    // Cria ou atualiza a visualização
    const jobView = await prisma.jobView.upsert({
      where: {
        jobId_userId: {
          jobId: jobId,
          userId: req.user.id,
        },
      },
      update: {},
      create: {
        jobId: jobId,
        userId: req.user.id,
      },
    });

    res.status(200).json({ message: "Vaga marcada como vista" });
  } catch (error) {
    console.error("Erro ao marcar vaga como vista:", error);
    res.status(500).json({ error: "Erro ao marcar vaga como vista" });
  }
}) as RequestHandler);

// Rota para favoritar vaga
router.post("/:id/favorite", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "ID da vaga inválido" });
      return;
    }

    // Verifica se a vaga existe
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      res.status(404).json({ error: "Vaga não encontrada" });
      return;
    }

    // Cria o favorito
    const favorite = await prisma.jobFavorite.create({
      data: {
        jobId: jobId,
        userId: req.user.id,
      },
    });

    res.status(200).json({ message: "Vaga favoritada com sucesso" });
  } catch (error) {
    // Se o erro for de unique constraint, significa que a vaga já está favoritada
    if ((error as Prisma.PrismaClientKnownRequestError).code === "P2002") {
      res.status(400).json({ error: "Vaga já está favoritada" });
      return;
    }

    console.error("Erro ao favoritar vaga:", error);
    res.status(500).json({ error: "Erro ao favoritar vaga" });
  }
}) as RequestHandler);

// Rota para desfavoritar vaga
router.post("/:id/unfavorite", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const jobId = parseInt(req.params.id);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "ID da vaga inválido" });
      return;
    }

    // Verifica se a vaga existe
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      res.status(404).json({ error: "Vaga não encontrada" });
      return;
    }

    // Remove o favorito
    await prisma.jobFavorite.delete({
      where: {
        jobId_userId: {
          jobId: jobId,
          userId: req.user.id,
        },
      },
    });

    res.status(200).json({ message: "Vaga removida dos favoritos" });
  } catch (error) {
    // Se o erro for de registro não encontrado, significa que a vaga não estava favoritada
    if ((error as Prisma.PrismaClientKnownRequestError).code === "P2025") {
      res.status(400).json({ error: "Vaga não está favoritada" });
      return;
    }

    console.error("Erro ao desfavoritar vaga:", error);
    res.status(500).json({ error: "Erro ao desfavoritar vaga" });
  }
}) as RequestHandler);

// Rota para listar vagas favoritadas
router.get("/favorites", authenticateToken, (async (
  req: RequestWithUser,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: "Usuário não autenticado" });
      return;
    }

    const favorites = await prisma.job.findMany({
      where: {
        favorites: {
          some: {
            userId: req.user.id,
          },
        },
      },
      include: {
        search: true,
        favorites: {
          where: {
            userId: req.user.id,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(favorites);
  } catch (error) {
    console.error("Erro ao buscar favoritos:", error);
    res.status(500).json({ error: "Erro ao buscar favoritos" });
  }
}) as RequestHandler);

export default router;
