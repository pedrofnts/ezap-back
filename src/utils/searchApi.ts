import axios from "axios";

interface SearchPayload {
  user_id: number;
  cargo: string;
  cidade: string;
  estado: string;
  whatsapp: string | null;
}

export async function createSearch(payload: SearchPayload): Promise<void> {
  try {
    const apiUrl = process.env.SEARCH_API_URL || "http://localhost:3004";
    await axios.post(`${apiUrl}/api/searches`, payload);
  } catch (error) {
    console.error("Erro ao criar busca:", error);
    throw error;
  }
}
