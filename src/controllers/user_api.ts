// controllers/user_api.ts
import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import bcrypt from "bcrypt";
import { format, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import axios from "axios";
import { PoolConnection } from "mysql2/promise";
import { fileUpload, deleteFromGCS } from "../controllers/uploads";
import { OtpVerifyPostRes, UserRegPostReq, UserLoginPostRes, UserDataPostRes, UserAllGetRes, UserDormOwnerReqPostReq, DTOUserDormOwnerReqGetRes, UserRegSec1Res, UserLoggedInPostRes } from "../models/user.model";
import { DormOwnerGetRes } from "../models/dorm.model";

dotenv.config(); 

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

///////////////////////////////////  About Mail --Begin--  ////////////////////////////////////////////////////////////////////

export const OTP_Verify_api = async (req: Request, res: Response) => {
  const { otp, email } = req.body;
  const data = {
    dotp: otp.toString().trim(),
    demail: email.toString().trim(),
  };
  try {
    const verify = await OTP_Verify_fn(data.dotp, data.demail);
    return res
      .status(201)
      .json({ status: verify.status, email: verify.email, msg: verify.msg });
  } catch (error) {
    res.status(401).json({ error: error });
  }
};

export const OTP_Sender_api = async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    const res1 = await OTP_Sender_fn(email);
    res.status(200).json(res1);
  } catch (error) {
    res.json(error);
  }
};

export const resMailSender_api = async (req: Request, res: Response) => {
  const { email, subject, msg } = req.body;
  try {
    const result = await resMailSender_fn(
      email.toString().trim(),
      subject.toString().trim(),
      msg.toString().trim()
    );
    res.json(result);
  } catch (error) {
    res.status(400).json(error);
  }
};

///////////////////////////////////  About Mail --End--  ////////////////////////////////////////////////////////////////////

//////////////////////////////////   About Authen --Begin--  ////////////////////////////////////////////////////////////////

export const registerSec1 = async (req: Request, res: Response) => {
  const { username, email, password, phone } = req.body;
  const phone_format = /^0[0-9]{9}$/;
  if (!phone_format.test(phone)) {
    return res.status(400).json({ message: "รูปเบอร์โทรไม่ถูกต้อง" });
  }
  const emailRegex = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "รูปเบอร์อีเมลไม่ถูกต้อง" });
  }
  const conn = await dbcon.getConnection();
  try {
    const [dupEmail] = await conn.query<RowDataPacket[]>(
      "SELECT COUNT(USER_ID) as COUNT FROM USERS WHERE EMAIL = ?",
      [email.toString().trim()]
    );
    const [dupPhone] = await conn.query<RowDataPacket[]>(
      "SELECT COUNT(USER_ID) as COUNT FROM USERS WHERE PHONE_NUMBER = ?",
      [phone.toString().trim()]
    );
    if (dupEmail[0]!["COUNT"] > 0) {
      return res.status(400).json({ success: false, message: "Email นี้ถูกใช้งานแล้ว" });
    }
    if (dupPhone[0]!["COUNT"] > 0) {
      return res.status(400).json({ success: false, message: "เบอร์โทร นี้ถูกใช้งานแล้ว" });
    }
    const hashPassword = await bcrypt.hash(password.toString().trim(), 10);
    const data = {
      username: username.toString().trim(),
      email: email.toString().trim(),
      password: hashPassword,
      phone: phone.toString().trim(),
    };
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error });
  } finally {
    conn.release();
  }
};

export const registerSec2 = async (req: Request, res: Response) => {
  const { userData, verify, admin } = req.body;
  const data: UserRegPostReq = {
    username: userData["username"],
    email: userData["email"],
    password: userData["password"],
    phone: userData["phone"],
  };
  const regex = /^\$2b\$10\$.{20,}/;
  if (!regex.test(data.password))
    return res.status(400).json("สมัครสมาชิกไม่สำเร็จ :C");
  const verStatus = verify;
  if (!verStatus && !admin) {
    return res.status(400).json({ message: "ยังไม่ยืนยัน OTP" });
  }
  const conn = await dbcon.getConnection();
  try {
    if (verStatus || admin) {
      conn.beginTransaction();
      const [rows] = await conn.execute<ResultSetHeader>(
        "INSERT INTO USERS (USERNAME, EMAIL, PASSWORD, PHONE_NUMBER) VALUES (?, ?, ?, ?)",
        [data.username, data.email, data.password, data.phone]
      );
      conn.commit();
      if (rows.affectedRows > 0) {
        return res.status(201).json("สมัครสมาชิกสำเร็จ");
      } else {
        return res.status(400).json("สมัครสมาชิกไม่สำเร็จ");
      }
    } else {
      return res.status(400).json("สมัครสมาชิกไม่สำเร็จ");
    }
  } catch (error) {
    conn.rollback();
    res.status(400).json(error);
  } finally {
    conn.release();
  }
};  

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const conn = await dbcon.getConnection();
  try {
    const [user] = await conn.query<UserLoginPostRes[]>(
      "SELECT * FROM USERS WHERE EMAIL = ?",
      [email]
    );
    if (!user || user.length === 0) {
      return res.status(400).json("User not fount");
    }
    if (user[0]?.ACCOUNT_STATUS != 0) {
      return res.status(400).json("User accout have not permission");
    }
    const isMatch = await bcrypt.compare(password, user[0]!.PASSWORD);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ success: false, message: "Server Error" });
    }
    const token = jwt.sign(
      { id: user[0]!.USER_ID, role: user[0]!.ROLE_TYPE_ID },
      jwtSecret,
      { expiresIn: "1d" }
    );
    res.json({
      logged_in: true,
      message: "เข้าสู่ระบบสำเร็จ",
      user: {
        id: user[0]!.USER_ID,
        username: user[0]!.USERNAME,
        email: user[0]!.EMAIL,
        phone: user[0]!.PHONE_NUMBER,
        role_id: user[0]?.ROLE_TYPE_ID,
        accout_status: user[0]!.ACCOUNT_STATUS,
        token: token,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  } finally {
    conn.release();
  }
};

export const resetPassword_api = async (req: Request, res: Response) => {
  const { email, password, verify } = req.body;
  const conn = await dbcon.getConnection();
  const uData = {
    email: email.toString().trim(),
    password: password.toString().trim(),
    verify,
  };
  try {
    const userData = await getUser(email);
    if (userData.length > 0 && verify) {
      const hashPassword = await bcrypt.hash(password.toString().trim(), 10);
      await conn.beginTransaction();
      const [res1] = await conn.execute<ResultSetHeader>(
        "UPDATE USERS SET PASSWORD = ? WHERE EMAIL = ?",
        [hashPassword, uData.email]
      );
      await conn.commit();
      if (res1.affectedRows > 0) {
        return res.status(200).json("reset password success");
      } else {
        return res.status(400).json("reset password fail");
      }
    } else {
      return res.status(400).json("hasn't data");
    }
  } catch (error) {
    await conn.rollback();
    res.status(400).json(error);
  } finally {
    conn.release();
  }
};

//////////////////////////////////   About Authen --End--  ////////////////////////////////////////////////////////////////

export const getUsers_api = async (req: Request, res: Response) => {
  try {
    const users = await getUsers_fn();
    return res.status(200).json(users);
  } catch (error) {
    res.status(400).json(error);
  }
};

export const getUser_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [users] = await dbcon.execute<UserAllGetRes[]>(
      `SELECT USER_ID, USERNAME, EMAIL, PHONE_NUMBER, ROLE_TYPE_ID, ACCOUNT_STATUS FROM USERS WHERE USER_ID = ?`,
      [id?.toString().trim()]
    );
    if (users.length > 0) {
      return res.status(200).json(users[0]);
    } else {
      return res.status(404).json("user not found");
    }
  } catch (error) {
    res.status(400).json(error);
  }
};

export const getMembers_api = async (req: Request, res: Response) => {
  try {
    const users = await getUsers_fn();
    const members = users.filter((member) => member.ROLE_TYPE_ID == 1);
    return res.status(200).json(members);
  } catch (error) {
    res.status(400).json(error);
  }
};

export const getDormOwners_api = async (req: Request, res: Response) => {
  try {
    const users = await getUsers_fn();
    const dormOwners = users.filter((member) => member.ROLE_TYPE_ID == 2);
    return res.status(200).json(dormOwners);
  } catch (error) {
    res.status(400).json(error);
  }
};

export const updateUser_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, phone_number } = req.body;
  const conn = await dbcon.getConnection();
  try {
    const [userData] = await conn.query<UserDataPostRes[]>("SELECT * FROM USERS WHERE USER_ID = ?", [id]);
    if (!userData || userData.length <= 0) return res.status(404).json("Not found user");
    if (!username || !phone_number) return res.status(400).json({ message: "Please provide username and phone number" });
    const phone_format = /^0[0-9]{9}$/;
    if (!phone_format.test(phone_number)) return res.status(400).json({ message: "รูปเบอร์โทรไม่ถูกต้อง" });
    let sql: string;
    let params = [];
    if (phone_number == userData[0]!.PHONE_NUMBER) {
      sql = "UPDATE USERS SET USERNAME = ? WHERE USER_ID = ?";
      params.push(username);
    } else {
      sql = "UPDATE USERS SET USERNAME = ?, PHONE_NUMBER = ? WHERE USER_ID = ?";
      params.push(username);
      params.push(phone_number);
    }
    params.push(Number(id));
    const [result] = await conn.execute<ResultSetHeader>(sql, [...params]);
    if (result.affectedRows > 0) return res.status(200).json({ message: "Update user success" });
    else return res.status(404).json({ message: "User not found or no changes made" });
  } catch (error) {
    res.status(500).json({ message: "Update fail", error });
  } finally {
    conn.release();
  }
};

export const deleteAccount_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  if(Number(id) == 1) return res.status(400).json("can't delete")
  try {
    const [result] = await dbcon.execute<ResultSetHeader>("UPDATE USERS SET ACCOUNT_STATUS = 1 WHERE USER_ID = ?", [id]);
    if (result.affectedRows > 0) return res.status(200).json({ message: "User account deactivated" });
    else return res.status(404).json({ message: "User not found" });
  } catch (error) {
    res.status(500).json(error);
  }
};

export const banAccount_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [result] = await dbcon.execute<ResultSetHeader>("UPDATE USERS SET ACCOUNT_STATUS = 2 WHERE USER_ID = ?", [id]);
    if (result.affectedRows > 0) return res.status(200).json({ message: "User account has banned" });
    else return res.status(404).json({ message: "User not found" });
  } catch (error) {
    res.status(500).json(error);
  }
};

export const recoverAccount_api = async (req: Request, res: Response) => {
  const { email, verify } = req.body;
  try {
    if (email && verify) {
      const users = await getUsers_fn();
      const uData = users.find(u => u.EMAIL === email.trim());
      if (uData?.ACCOUNT_STATUS == 0) return res.status(400).json({ message: "User account is nomal" });
      const [result] = await dbcon.execute<ResultSetHeader>("UPDATE USERS SET ACCOUNT_STATUS = 0 WHERE EMAIL = ?", [email.trim()]);
      if (result.affectedRows > 0) return res.status(200).json({ message: "User account is recovered" });
      else return res.status(404).json({ message: "User not found" });
    } else return res.status(404).json({ message: "User not found" });
  } catch (error) {
    res.status(500).json(error);
  }
};

export const addFavorite_api = async (req: Request, res: Response) => {
  const { user_id, dorm_id } = req.body;
  try {
    if (!user_id || !dorm_id) return res.status(400).json({ message: "User ID and Dorm ID are required" });
    const [result] = await dbcon.execute<ResultSetHeader>("INSERT INTO FAVORITES (USER_ID, DORM_ID) VALUES (?, ?)", [user_id, dorm_id]);
    if (result.affectedRows > 0) return res.status(201).json({ message: "Added to favorites success" });
    else return res.status(400).json({ message: "Failed to add favorite" });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "This dorm is already in your favorites" });
    return res.status(500).json({ message: "Internal Server Error", error });
  }
};

export const removeFavorite_api = async (req: Request, res: Response) => {
  const { user_id, dorm_id } = req.body;
  try {
    if (!user_id || !dorm_id) return res.status(400).json({ message: "User ID and Dorm ID are required" });
    const [result] = await dbcon.execute<ResultSetHeader>("DELETE FROM FAVORITES WHERE USER_ID = ? AND DORM_ID = ?", [user_id, dorm_id]);
    if (result.affectedRows > 0) return res.status(200).json({ message: "Removed from favorites success" });
    else return res.status(404).json({ message: "Favorite item not found" });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

export const requestDormOwner_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  let publicUrl: string | null = null;
  try {
    const { user_id, first_name, last_name, facebook, line, x, instagram, telegram } = req.body;
    const file = req.file;
    const users = await getUsers_fn();
    const user = users.find(u => u.USER_ID == Number(user_id));
    if (!user) return res.status(400).json("User not found");
    if (!file) return res.status(400).json({ success: false, message: "Profile image is required" });
    const [owner] = await conn.execute<DormOwnerGetRes[]>("SELECT * FROM DORM_OWNERS WHERE USER_ID = ?", [user_id]);
    if (owner[0]?.REQ_STATUS == 2) {
      const [reqRes] = await conn.execute<ResultSetHeader>("UPDATE DORM_OWNERS SET REQ_STATUS = 0 WHERE USER_ID = ?", [user_id]);
      if (reqRes.affectedRows > 0) return res.status(200).json(" send req agaain success");
      else return res.status(400).json("something error");
    }
    publicUrl = await fileUpload(file, "users", `${user.USERNAME}_${user.USER_ID}`, null, "profile");
    const userData: UserDormOwnerReqPostReq = { user_id, first_name, last_name, facebook, instagram, line, telegram, x };
    await conn.beginTransaction();
    const result = await requestDormOwner_fn(conn, userData, publicUrl);
    await conn.commit();
    if (result.affectedRows > 0) return res.status(201).json({ success: true, message: "Request submitted successfully", imageUrl: publicUrl, ownerId: result.insertId });
    else throw new Error("Insert failed");
  } catch (error: any) {
    await conn.rollback();
    if (publicUrl) await deleteFromGCS(publicUrl).catch(err => console.error(err));
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "Duplicate entry" });
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  } finally {
    conn.release();
  }
};

export const approveDormOwner = async (req: Request, res: Response) => {
  const { user_id, approve_status, msg } = req.body;
  const conn = await dbcon.getConnection();
  try {
    await conn.beginTransaction();
    const ownerData = await getDormOwners_fn(conn, Number(user_id));
    if (ownerData.length === 0) return res.status(400).json("user not found");
    const user = ownerData[0] as any;
    const status = approve_status == true ? 1 : 2;
    const [result] = await conn.execute<ResultSetHeader>("UPDATE DORM_OWNERS SET REQ_STATUS = ? WHERE USER_ID = ?;", [status, user_id]);
    await conn.commit();
    const subject = "รายงานการส่งคำร้องขอสิทธิ์เป็นเจ้าของหอพัก";
    let content = approve_status ? "คำร้องของคุณได้รับการอนุมัติ" : `คำร้องของคุณไม่ผ่านการพิจารณา เนื่องจาก: ${msg}`;
    const info = await resMailSender_fn(user.EMAIL, subject, content);
    if (info) return res.status(200).json("sent mail Success");
    else return res.status(400).json("sent mail fail");
  } catch (error) {
    await conn.rollback();
    res.status(400).json(error);
  } finally {
    conn.release();
  }
};

export const getMyFavorites_api = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "User ID is required" });
    const sql = `
            SELECT D.DORM_ID AS DORMID, D.DORM_NAME AS DORMNAME, CONCAT(DO.FIRST_NAME, ' ', DO.LAST_NAME) AS OWNERNAME, D.UPDATE_AT AS UPDATEDAT, D.ADDRESS AS ADDRESS, D.FRONT_DORM_IMAGE AS COVERIMAGE, D.SCORE AS SCORE, DS.DORM_STATUS_NAME
            FROM FAVORITES F
            JOIN DORMITORIES D ON F.DORM_ID = D.DORM_ID
            JOIN DORM_OWNERS DO ON D.DORM_OWNER_ID = DO.DORM_OWNER_ID
            JOIN DORM_STATUSES DS ON D.DORM_STATUS_ID = DS.DORM_STATUS_ID
            WHERE F.USER_ID = ?
            ORDER BY F.FAV_ID DESC
        `;
    const [rows] = await dbcon.query<RowDataPacket[]>(sql, [id]);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

//////////////////////////////////   About Method --Begin--  ////////////////////////////////////////////////////////////////

export async function getDormOwners_fn(conn: PoolConnection, uid: number) {
  try {
    const [owner] = await conn.execute<DTOUserDormOwnerReqGetRes[]>(
      `SELECT DONER.USER_ID, DONER.FIRST_NAME, DONER.LAST_NAME, DONER.FACEBOOK, DONER.INSTAGRAM, DONER.LINE, DONER.TELEGRAM, DONER.X, DONER.REQ_STATUS, DONER.PROFILE_IMAGE, U.USERNAME, U.EMAIL, U.PHONE_NUMBER, U.ROLE_TYPE_ID, U.ACCOUNT_STATUS
      FROM DORM_OWNERS DONER 
      INNER JOIN USERS U ON DONER.USER_ID = U.USER_ID 
      WHERE DONER.USER_ID = ?`, [uid]);
    return owner;
  } catch (error) { throw error; }
}

export async function requestDormOwner_fn(conn: PoolConnection, userData: UserDormOwnerReqPostReq, publicUrl: string) {
  const lineLink = normalizeLineID(userData?.line);
  const telegramLink = normalizeThaiPhone(userData?.telegram);
  try {
    const sql = `INSERT INTO DORM_OWNERS (USER_ID, FIRST_NAME, LAST_NAME, FACEBOOK, LINE, X, INSTAGRAM, TELEGRAM, PROFILE_IMAGE) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [userData.user_id, userData.first_name, userData.last_name, userData.facebook || null, lineLink || null, userData.x || null, userData.instagram || null, telegramLink || null, publicUrl];
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  } catch (error) { throw error; }
}

export function normalizeLineID(lineId: string | null): string | null {
  return lineId ? `https://line.me/ti/p/~${lineId.trim()}` : null;
}

export function normalizeThaiPhone(input: string | null): string | null {
  if (!input) return null;
  let phone = input.replace(/[^\d+]/g, "");
  if (phone.startsWith("+66")) return phone;
  if (phone.startsWith("66")) return "+" + phone;
  if (phone.startsWith("0")) return "https://t.me/+66" + phone.slice(1);
  return null;
}

export async function getUser(email: string) {
  const [rows] = await dbcon.query<UserDataPostRes[]>("SELECT * FROM USERS WHERE EMAIL = ?", [email.trim()]);
  return rows;
}

export async function getUsers_fn() {
  const [users] = await dbcon.execute<UserAllGetRes[]>(`SELECT USER_ID, USERNAME, EMAIL, PHONE_NUMBER, ROLE_TYPE_ID, ACCOUNT_STATUS FROM USERS WHERE ROLE_TYPE_ID IN (1, 2)`);
  return users;
}

export async function resMailSender_fn(email: string, subject: string, msg: string) {
  try {
    const users = await getUser(email.trim());
    if(users.length === 0) return false;
    const userData = users[0]!;
    
    const payload = {
        sender: { name: "HuntPuk Team", email: "no-reply@huntpuk.space" },
        to: [{ email: email }],
        subject: subject,
        htmlContent: `<html><body><h2>แจ้งเตือนจากระบบ</h2><p>เรียนคุณ ${userData.USERNAME},</p><div style="padding:20px; background:#f8fafc; border-left:4px solid #2563EB;">${msg}</div><p>ทีมงาน HuntPuk</p></body></html>`
    };

    const response = await axios.post(BREVO_URL, payload, {
        headers: {
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
        }
    });

    return response.status === 201;
  } catch (error) { 
    console.error("Brevo API Error:", error);
    return false;
  }
}

async function delOldOTP_fn(email: string) {
  try {
    await dbcon.execute("DELETE FROM OTP_VERIFIES WHERE create_at < NOW() - INTERVAL 5 MINUTE");
    await dbcon.execute("DELETE FROM OTP_VERIFIES WHERE EMAIL = ?", [email]);
  } catch (error) { throw error; }
}

export async function OTP_Sender_fn(email: string) {
  const otp = Math.floor(100000 + Math.random() * 899999).toString();
  try {
    await delOldOTP_fn(email);
    await dbcon.execute("INSERT INTO OTP_VERIFIES(otp_code, email) VALUES(?, ?)", [otp, email]);
    
    const payload = {
        sender: { name: "HuntPuk Team", email: "no-reply@huntpuk.space" },
        to: [{ email: email }],
        subject: "รหัสยืนยันตัวตน (OTP)",
        htmlContent: `<html><body><p>รหัสยืนยันตัวตน (OTP) ของคุณคือ</p><div style="font-size:40px; font-weight:bold; color:#2563EB;">${otp}</div><p>รหัสนี้จะหมดอายุภายใน 3 นาที</p></body></html>`
    };

    const response = await axios.post(BREVO_URL, payload, {
        headers: {
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
        }
    });

    return response.status === 201;
  } catch (error) { 
    console.error("Brevo API Error:", error);
    return false;
  }
}

export async function OTP_Verify_fn(otp: string, email: string) {
  try {
    const [rows] = await dbcon.execute<OtpVerifyPostRes[]>("SELECT * FROM OTP_VERIFIES WHERE email = ?", [email]);
    if (rows.length <= 0) return { status: false, email, msg: "โปรดส่งคำร้องขอ OTP" };
    const sentTime = new Date(rows[0]!.CREATE_AT);
    const diff = Math.trunc((Date.now() - sentTime.getTime()) / 1000);
    if (otp == rows[0]!.OTP_CODE && diff <= 180) {
      await delOldOTP_fn(email);
      return { status: true, email, msg: "ยืนยันตัวตนด้วย OTP สำเร็จ" };
    } else return { status: false, email, msg: "OTP ไม่ถูกต้องหรือหมดอายุ" };
  } catch (error) { throw error; }
}
