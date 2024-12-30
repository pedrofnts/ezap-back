import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import jobsRouter from "./routes/jobs";
import profileRouter from "./routes/profile";
import searchRouter from "./routes/search";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/profile", profileRouter);
app.use("/api", searchRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
