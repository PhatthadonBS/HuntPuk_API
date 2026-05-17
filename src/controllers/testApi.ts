import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import bcrypt from "bcrypt";
import { QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import nodemailer from "nodemailer";
import { OtpVerifyPostRes, UserRegPostReq, UserLoginPostRes } from "../models/user.model";
import {
  getDormOwners_fn,
  getUsers_fn,
  OTP_Verify_api,
  OTP_Verify_fn,
  resMailSender_fn,
} from "./user_api";
import { deleteFolder, fileUpload } from "./uploads";
import { getDormById_fn, MulterFiles } from "./dorm_api";
import { PoolConnection } from "mysql2/promise";
import { RoomTypeItem } from "../models/dorm.model";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "noreply.HuntPuk@gmail.com",
    pass: "",
  },
});

// /////////////////////////////////////////////////////////////////////////////////////////////////

export const test_send = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  const file = req.file;
  try {
    const a = await resMailSender_fn("66011212117@msu.ac.th", "Test Email from HuntPuk API", "This is a test email sent from HuntPuk API</h1><>If you received this email, it means the email sending functionality is working correctly");
    // const [a] = await conn.query("SELECT * FROM IMAGE_ROOM_TYPES");

    res.status(200).json(a);
  } catch (error: any) {
    console.log(error);

    res.status(400).json({ msg: error.message });
  } finally {
    conn.release();
  }
};

// /////////////////////////////////////////////////////////////////////////////////////////////////

