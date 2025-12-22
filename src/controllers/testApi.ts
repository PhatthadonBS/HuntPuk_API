import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import bcrypt from "bcrypt";
import { QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import nodemailer from "nodemailer";
import { OtpVerifyPostRes } from "../models/responses/otp_verify_post_res";
import { UserRegPostReq } from "../models/requests/user_reg_post_req";
import {
  getDormOwners_fn,
  getUsers_fn,
  OTP_Verify_api,
  OTP_Verify_fn,
} from "./user_api";
import { UserLoginPostRes } from "../models/responses/user_login_post_res";
import { deleteFolder, fileUpload } from "./uploads";
import { MulterFiles } from "./dorm_api";
import { PoolConnection } from "mysql2/promise";
import { RoomTypeItem } from "../models/requests/RoomTypeItem";

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
    const a = await deleteFolder("moji");
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

