import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import companiesRouter from "./routes/companies.js";
import productsRouter from "./routes/products.js";
import knowledgeRouter from "./routes/knowledge.js";
import competitorsRouter from "./routes/competitors.js";
import scriptsRouter from "./routes/scripts.js";
import leadsRouter from "./routes/leads.js";
import ordersRouter from "./routes/orders.js";
import chatRouter from "./routes/chat.js";
import conversationsRouter from "./routes/conversations.js";

const app = express();

const configuredOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedOrigins = new Set([
  configuredOrigin,
  configuredOrigin.replace("localhost", "127.0.0.1"),
  configuredOrigin.replace("127.0.0.1", "localhost"),
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} không được phép`));
    },
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/companies", companiesRouter);
app.use("/api/products", productsRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/competitors", competitorsRouter);
app.use("/api/scripts", scriptsRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/chat", chatRouter);
app.use("/api/conversations", conversationsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.name === "MulterError" ? 400 : err.status || 500;
  res.status(status).json({ error: err.message || "Lỗi máy chủ" });
});

const port = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(port, () => console.log(`[server] Đang chạy tại http://localhost:${port}`));
  })
  .catch((err) => {
    console.error("[server] Không kết nối được MongoDB:", err.message);
    process.exit(1);
  });
