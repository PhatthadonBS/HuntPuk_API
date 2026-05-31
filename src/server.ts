import http from "http";
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import router from "./routes/router_api";
import cors from "cors";
import rateLimit from "express-rate-limit";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const app = express();

// 1. Trust proxy if behind a load balancer (common for cloud deploys)
app.set('trust proxy', 1);

// 2. Global Rate Limiter
export const globalLimiter = rateLimit({
  windowMs: 3 * 60 * 1000, // 3 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later."
});

app.use(globalLimiter);

// 3. CORS Configuration
app.use(
  cors({
    origin: "*", // Adjust this to specific domains in production
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 4. Body Parsers (Built-in Express)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. API Routes
app.use('/', router);

// 6. Generic Error Handler (Prevents server crashes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

const server = http.createServer(app);

server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 HuntPuk API started on port ${port}`);
}).on("error", (error) => {
  console.error("Server Startup Error:", error);
});

