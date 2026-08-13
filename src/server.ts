import http from "http";
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import router from "./routes/router_api";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { startMonthlyViewSummaryJob } from "./controllers/cron_jobs";
import { connectRedis } from "./config/redis";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const isProduction = process.env.NODE_ENV === "production";

app.use(morgan(isProduction ? "combined" : "dev"));

// 2. CORS Configuration (MUST be before Rate Limiter to handle preflight)
const allowedOrigins = [
  "https://huntpuk.space",
  "https://www.huntpuk.space",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
    credentials: true,
  }),
);

export const globalLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "มีการส่งคำขอมากเกินไปจาก IP นี้ กรุณาลองใหม่อีกครั้งในภายหลัง",
});

app.use(globalLimiter);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/", router);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "ไม่พบหน้าเว็บ" });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error:", err);

  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      success: false,
      message: "ข้อผิดพลาด: ขนาดไฟล์ต้องไม่เกิน 5MB",
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: "เกิดข้อผิดพลาดภายในระบบ",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

startMonthlyViewSummaryJob();

// Start HTTP server immediately to pass Railway/Cloud health checks
app.listen(port, "0.0.0.0", () => {
  console.log(`HuntPuk API started on port ${port}`);
});

// Connect Redis asynchronously in background
connectRedis().catch((err) => {
  console.error("Failed to connect to Redis:", err.message);
});
