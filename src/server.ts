import http from "http";
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import router from "./routes/router_api";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { startMonthlyViewSummaryJob } from "./controllers/cron_jobs";
import { connectRedis } from "./config/redis";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const app = express();

// 1. Trust proxy if behind a load balancer (common for cloud deploys)
app.set('trust proxy', 1);

app.use(morgan('dev'));

// 2. CORS Configuration (MUST be before Rate Limiter to handle preflight)
const allowedOrigins = [
  "https://huntpuk.space", 
  "https://huntpuk-8c96d.web.app",
  "capacitor://localhost", 
  "http://localhost",
  "https://localhost"
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      // Allow local development IPs and ports (e.g. 192.168.x.x:8100 or localhost:8100)
      if (
        origin.startsWith('http://192.168.') || 
        origin.startsWith('https://huntpuk-8c96d.web.app') ||
        origin.startsWith('http://10.') || 
        origin.startsWith('http://localhost:') || 
        origin.startsWith('https://localhost:')
      ) {
        return callback(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
  })
);

// 3. Global Rate Limiter
export const globalLimiter = rateLimit({
  windowMs: 3 * 60 * 1000, // 3 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later."
});

app.use(globalLimiter);

// 4. Body Parsers (Built-in Express)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. API Routes
app.use('/', router);

// 6. Generic Error Handler (Prevents server crashes)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Error:", err);
  
  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      success: false,
      message: "ข้อผิดพลาด: ขนาดไฟล์ต้องไม่เกิน 10MB"
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

// 7. Initialize Cron Jobs
startMonthlyViewSummaryJob();

// Connect to Redis and start server
connectRedis().then(() => {
  app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 HuntPuk API started on port ${port}`);
  });
}).catch(err => {
  console.error("Failed to connect to Redis:", err);
  // Fallback to start server without Redis caching
  app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 HuntPuk API started on port ${port} (Redis disconnected)`);
  });
});
