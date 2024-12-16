import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import searchRouter from "./routes/search";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api", searchRouter);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
