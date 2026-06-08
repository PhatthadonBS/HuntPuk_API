import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
// ขยาย interface Request ให้มีตัวแปร user
export interface AuthRequest extends Request {
  user?: any;
}

export const verifyToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers["authorization"]?.split(" ")[1]; // รับ Token จาก Header (Bearer <token>)

  if (!token) return res.status(403).json("No token provided");
  if (!process.env.JWT_SECRET) {
    return res.status(500).json("Internal server error");
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json("Unauthorized!");
    req.user = decoded; // ยัดข้อมูลที่ถอดรหัสได้ (เช่น user_id) ใส่ Request
    next(); // ให้ไปทำงานที่ Controller ต่อไปได้
  });
};

export const verifyTokenOptional = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return next();
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json("Internal server error");
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (!err) {
      req.user = decoded;
    }
    next();
  });
};
