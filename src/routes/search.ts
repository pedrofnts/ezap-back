import express, { Request, Response, RequestHandler } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const router = express.Router();

interface IBGECity {
  id: number;
  nome: string;
  microrregiao: {
    mesorregiao: {
      UF: {
        sigla: string;
      };
    };
  };
}

interface CityData {
  id: number;
  name: string;
  state: string;
}

interface QueryParams {
  q?: string;
}

let citiesCache: CityData[] = [];

async function loadCities() {
  try {
    const response = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
    );

    if (!response.ok) {
      throw new Error("Erro ao buscar dados do IBGE");
    }
    const cities = (await response.json()) as IBGECity[];

    citiesCache = cities.map((city) => ({
      id: city.id,
      name: city.nome,
      state: city.microrregiao.mesorregiao.UF.sigla,
    }));
    console.log("Cache de cidades carregado com sucesso");
  } catch (error) {
    console.error("Erro ao carregar cache de cidades:", error);
  }
}

loadCities();

router.get("/cities", (async (
  req: Request<{}, {}, {}, QueryParams>,
  res: Response
) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    if (citiesCache.length === 0) {
      await loadCities();
    }

    const filteredCities = citiesCache
      .filter((city) => city.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 10);

    res.json(filteredCities);
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: "Erro ao buscar cidades" });
  }
}) as RequestHandler);

router.get("/job-areas", (async (
  req: Request<{}, {}, {}, QueryParams>,
  res: Response
) => {
  const { q } = req.query;

  try {
    const areas = await prisma.jobArea.findMany({
      where: {
        name: {
          contains: String(q || ""),
          mode: "insensitive",
        },
      },
      take: 10,
    });
    res.json(areas);
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: "Erro ao buscar áreas" });
  }
}) as RequestHandler);

export default router;
