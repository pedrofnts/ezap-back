import express from "express";
import authRouter from "./routes/auth";
import searchRouter from "./routes/search";

const app = express();

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
    body: req.body,
    query: req.query,
    headers: req.headers,
  });
  next();
});

app.use(express.json());

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Erro global:", err);
    res.status(500).json({
      error: "Erro interno do servidor",
      details: err.message,
    });
  }
);

app.use("/api/auth", authRouter);
app.use("/api", searchRouter);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
