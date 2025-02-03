import express from "express";
import authRouter from "./routes/auth";
import jobsRouter from "./routes/jobs";
import profileRouter from "./routes/profile";
import searchRouter from "./routes/search";
import stripeRouter from "./routes/stripe";
import asaasRouter from "./routes/asaas";
import plansRouter from "./routes/plans";
import billingRouter from "./routes/billing";
import cors from "cors";
const app = express();

// app.use(cors({ origin: "http://localhost:3000", credentials: true }));

// Configuração especial para o webhook do Stripe
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// Configuração padrão para outras rotas
app.use(express.json());

// Rotas da API
app.use("/api/auth", authRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/stripe", stripeRouter);
app.use("/api/asaas", asaasRouter);
app.use("/api", searchRouter);
app.use("/api/plans", plansRouter);
app.use("/api/billing", billingRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
