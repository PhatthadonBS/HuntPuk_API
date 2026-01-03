// controllers/user_api.ts
import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import bcrypt from "bcrypt";
import { format, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";
import nodemailer from "nodemailer";
import { OtpVerifyPostRes } from "../models/responses/otp_verify_post_res";
import dotenv from "dotenv";
import { UserRegPostReq } from "../models/requests/user_reg_post_req";
import { UserLoginPostRes } from "../models/responses/user_login_post_res";
import { UserDataPostRes } from "../models/responses/user_data_post_res";
import { UserAllGetRes } from "../models/responses/user_all_get_res";
import { fileUpload, deleteFromGCS } from "../controllers/uploads";
import { UserDormOwnerReqPostReq } from "../models/requests/user_dormOwnerReq_post_req";
import { PoolConnection } from "mysql2/promise";
import { DTOUserDormOwnerReqGetRes } from "../models/DOT/DTO_user_dOwner_post_res";
import { DormOwnerGetRes } from "../models/responses/dorm_owner_get_res";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.OTPPASS,
  },
});

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

// ตัวนี้แค่เก็บข้อมูลและแปลงรหัสผ่าน เก็บไว้ใน session รอยืนยันตัวตนเส็จค่อส่งให้ registersec2
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
      return res
        .status(400)
        .json({ success: false, message: "Email นี้ถูกใช้งานแล้ว" });
    }

    if (dupPhone[0]!["COUNT"] > 0) {
      return res
        .status(400)
        .json({ success: false, message: "เบอร์โทร นี้ถูกใช้งานแล้ว" });
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

//ยืนยันตัวตนผ่านแล้วส่ง objที่ได้จาก registersec1 and otpverify แล้วส่งข้อมูลมาพร้อมบัตรผ่าน
export const registerSec2 = async (req: Request, res: Response) => {
  const { userData, verify, admin } = req.body;
  console.log(req.body);

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
    return res.status(400).json({
      message: "ยังไม่ยืนยัน OTP",
    });
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
  console.log(req.body);

  const conn = await dbcon.getConnection();
  try {
    const [user] = await conn.query<UserLoginPostRes[]>(
      "SELECT * FROM USERS WHERE EMAIL = ?",
      [email]
    );

    if (!user) {
      return res.status(400).json("User not fount");
    }

    if (user[0]?.ACCOUNT_STATUS != 0) {
      return res.status(400).json("User accout have not permission");
    }

    const isMatch = await bcrypt.compare(password, user[0]!.PASSWORD);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }

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
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server Error" });
  } finally {
    conn.release();
  }
};

// ต้องเรียก ยืนยัน otp ก่อนแล้ว ส่งstatus มาว่ายืนยันตัวตนผ่านมั้ย !!!ต้องยืนยันตัวตนก่อนเรียก api นี้
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

//////////////////////////////////   other api --Begin--  ////////////////////////////////////////////////////////////////

//จะส่งไปทั้ง member and owner dorm  ใช้ filter กรองเอาที่ front เด้อ
export const getUsers_api = async (req: Request, res: Response) => {
  try {
    const users = await getUsers_fn();
    if (users.length > 0) {
      return res.status(200).json(users);
    } else {
      return res.status(200).json([]);
    }
  } catch (error) {
    res.status(400).json(error);
  } 
};

export const getUser_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (Number(id) == 1) return res.status(404).json("not found user");
    const [users] = await dbcon.execute<UserAllGetRes[]>(
      `
      SELECT
      USER_ID, USERNAME, EMAIL, PHONE_NUMBER, ROLE_TYPE_ID, ACCOUNT_STATUS
      FROM USERS 
      WHERE USER_ID = ?
      AND USER_ID != 1
      `,
      [id?.toString().trim()]
    );
    if (users.length > 0) {
      return res.status(200).json(users);
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

    if (members.length > 0) {
      return res.status(200).json(members);
    } else {
      return res.status(200).json([]);
    }
  } catch (error) {
    res.status(400).json(error);
  }
};

export const getDormOwners_api = async (req: Request, res: Response) => {
  try {
    const users = await getUsers_fn();
    const dormOwners = users.filter((member) => member.ROLE_TYPE_ID == 2);

    if (dormOwners.length > 0) {
      return res.status(200).json(dormOwners);
    } else {
      return res.status(200).json([]);
    }
  } catch (error) {
    res.status(400).json(error);
  }
};

//ดึงข้อมูลมา ถ้าไม่อันไหนไม่update ให้เอาข้อมูลเก่ายัดใส่แทน (!!!ยัดข้อมูลเก่าตั้งแต่ front เด้อค่อยส่งมา!!!)
export const updateUser_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, phone_number } = req.body;

  const conn = await dbcon.getConnection();

  try {
    if (!username || !phone_number) {
      return res
        .status(400)
        .json({ message: "Please provide username and phone number" });
    }

    const phone_format = /^0[0-9]{9}$/;

    if (!phone_format.test(phone_number)) {
      return res.status(400).json({ message: "รูปเบอร์โทรไม่ถูกต้อง" });
    }

    const sql = `
            UPDATE USERS 
            SET USERNAME = ?, PHONE_NUMBER = ? 
            WHERE USER_ID = ?
        `;

    const [result] = await conn.execute<ResultSetHeader>(sql, [
      username.toString().trim(),
      phone_number.toString().trim(),
      id,
    ]);

    if (result.affectedRows > 0) {
      return res.status(200).json({ message: "Update user success" });
    } else {
      return res
        .status(404)
        .json({ message: "User not found or no changes made" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Update fail", error });
  } finally {
    conn.release();
  }
};

export const deleteAccount_api = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const sql = "UPDATE USERS SET ACCOUNT_STATUS = 1 WHERE USER_ID = ?"; //0 = online, 1 = offline, 2 = banned

    const [result] = await dbcon.execute<ResultSetHeader>(sql, [id]);

    if (result.affectedRows > 0) {
      return res
        .status(200)
        .json({ message: "User account deactivated (Soft Deleted)" });
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json(error);
  }
};

export const banAccount_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  const conn = await dbcon.getConnection();

  try {
    const sql = "UPDATE USERS SET ACCOUNT_STATUS = 2 WHERE USER_ID = ?"; //0 = online, 1 = offline, 2 = banned

    const [result] = await conn.execute<ResultSetHeader>(sql, [id]);

    if (result.affectedRows > 0) {
      return res.status(200).json({ message: "User account has banned" });
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json(error);
  } finally {
    conn.release();
  }
};

//ต้องยืนยันตัวตนมาก่อน ค่อยทำ
export const recoverAccount_api = async (req: Request, res: Response) => {
  const { email, verify } = req.body;

  const conn = await dbcon.getConnection();

  try {
    if (email && verify) {
      const [uData] = (await getUsers_fn()).filter(
        (u) => u.EMAIL == email.toString().trim()
      );
      if (uData?.ACCOUNT_STATUS == 0)
        return res.status(400).json({ message: "User account is nomal" });

      const sql = "UPDATE USERS SET ACCOUNT_STATUS = 0 WHERE EMAIL = ?"; //0 = online, 1 = offline, 2 = banned
      const [result] = await conn.execute<ResultSetHeader>(sql, [email.trim()]);

      if (result.affectedRows > 0) {
        return res.status(200).json({ message: "User account is recovered" });
      } else {
        return res.status(404).json({ message: "User not found" });
      }
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json(error);
  } finally {
    conn.release();
  }
};

export const addFavorite_api = async (req: Request, res: Response) => {
  const { user_id, dorm_id } = req.body;
  const conn = await dbcon.getConnection();

  try {
    // 1. ตรวจสอบว่าส่งค่ามาครบไหม
    if (!user_id || !dorm_id) {
      return res
        .status(400)
        .json({ message: "User ID and Dorm ID are required" });
    }

    const sql = "INSERT INTO FAVORITES (USER_ID, DORM_ID) VALUES (?, ?)";

    // 2. ทำการ Insert
    const [result] = await conn.execute<ResultSetHeader>(sql, [
      user_id,
      dorm_id,
    ]);

    if (result.affectedRows > 0) {
      return res.status(201).json({ message: "Added to favorites success" });
    } else {
      return res.status(400).json({ message: "Failed to add favorite" });
    }
  } catch (error: any) {
    // 3. ดักจับ Error กรณีข้อมูลซ้ำ (Duplicate Entry)
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "This dorm is already in your favorites" });
    }

    console.error(error);
    return res.status(500).json({ message: "Internal Server Error", error });
  } finally {
    conn.release();
  }
};

export const removeFavorite_api = async (req: Request, res: Response) => {
  const { user_id, dorm_id } = req.body;
  const conn = await dbcon.getConnection();

  try {
    if (!user_id || !dorm_id) {
      return res
        .status(400)
        .json({ message: "User ID and Dorm ID are required" });
    }

    const sql = "DELETE FROM FAVORITES WHERE USER_ID = ? AND DORM_ID = ?";

    const [result] = await conn.execute<ResultSetHeader>(sql, [
      user_id,
      dorm_id,
    ]);

    if (result.affectedRows > 0) {
      return res
        .status(200)
        .json({ message: "Removed from favorites success" });
    } else {
      return res.status(404).json({ message: "Favorite item not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error });
  } finally {
    conn.release();
  }
};

export const requestDormOwner_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  let publicUrl: string | null = null;

  try {
    const {
      user_id,
      first_name,
      last_name,
      facebook,
      line,
      x,
      instagram,
      telegram,
    } = req.body;

    const file = req.file;

    const [user] = (await getUsers_fn()).filter(
      (u) => u.USER_ID == Number(user_id)
    );
    if (!user) return res.status(400).json("User not found");
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "กรุณาอัปโหลดรูปโปรไฟล์ (Profile image is required).",
      });
    }

    const [owner] = await conn.execute<DormOwnerGetRes[]>(
      "SELECT * FROM DORM_OWNERS WHERE USER_ID = ?",
      [user_id]
    );
    if (owner[0]?.REQ_STATUS == 2) {
      const [reqRes] = await conn.execute<ResultSetHeader>(
        "UPDATE DORM_OWNERS SET REQ_STATUS = 0 WHERE USER_ID = ?",
        [user_id]
      );

      if (reqRes.affectedRows > 0)
        return res.status(200).json(" send req agaain success");
      else return res.status(400).json("something error");
    }

    publicUrl = await fileUpload(
      file,
      "users",
      `${user.USERNAME}_${user.USER_ID}`,
      null,
      "profile"
    );

    const userData: UserDormOwnerReqPostReq = {
      user_id,
      first_name,
      last_name,
      facebook,
      instagram,
      line,
      telegram,
      x,
    };

    await conn.beginTransaction();

    // 3. เรียกฟังก์ชัน Insert ลง DB
    const result = await requestDormOwner_fn(conn, userData, publicUrl);

    await conn.commit();

    if (result.affectedRows > 0) {
      return res.status(201).json({
        success: true,
        message: "Request submitted successfully",
        imageUrl: publicUrl,
        ownerId: result.insertId,
      });
    } else {
      throw new Error("Insert failed with no affected rows");
    }
  } catch (error: any) {
    await conn.rollback();

    if (publicUrl) {
      await deleteFromGCS(publicUrl).catch((err) =>
        console.error("Failed to delete image:", err)
      );
    }

    console.error("Request Owner Error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "คุณได้ส่งคำขอไปแล้ว หรือเป็นเจ้าของหอพักอยู่แล้ว ไม่สามารถทำรายการซ้ำได้",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const approveDormOwner = async (req: Request, res: Response) => {
  const { user_id, approve_status, msg } = req.body;
  const conn = await dbcon.getConnection();
  const data = {
    uid: Number(user_id),
    status: approve_status == true ? 1 : 2, // 1 = accept, 2 = reject
    msg,
  };

  try {
    conn.beginTransaction();
    const [user] = await getDormOwners_fn(conn, data.uid);
    if (!user) return res.status(400).json("user not found");

    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORM_OWNERS SET REQ_STATUS = ? WHERE USER_ID = ?;",
      [data.status, data.uid]
    );
    conn.commit();

    const subject = "รายงานการส่งคำร้องขอสิทธิ์เป็นเจ้าของหอพัก";
    let content = "";
    let info = false;

    if (result.affectedRows > 0) {
      if (!approve_status) {
        content = `ขออภัย คำร้องขอสิทธิ์เป็นเจ้าของหอพักของท่านไม่ผ่านการพิจารณา\n\tเนื่องจาก${data.msg
          .toString()
          .trim()}\nขอบคุณที่ให้ความสนใจใช้บริการของเรา`;
        info = await resMailSender_fn(user.EMAIL, subject, content);
      } else {
        content = `ขอแสดงความยินดี\n\tคำร้องขอสิทธิ์เป็นเจ้าของหอพักของท่านได้รับการอนุมัติเรียบร้อยแล้วท่านสามารถเข้าใช้งานระบบจัดการหอพักได้ทันที\nขอบคุณที่ไว้วางใจและเลือกใช้บริการของเรา`;
        info = await resMailSender_fn(user.EMAIL, subject, content);
      }
    } else {
      return res.status(400).json("user not fount");
    }
    if (info) {
      return res.status(200).json("sent mail Success");
    } else {
      return res.status(400).json("sent mail fail");
    }
  } catch (error) {
    conn.rollback();
    res.status(400).json(error);
  } finally {
    conn.release();
  }
};

export const getMyFavorites_api = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const sql = `
            SELECT 
                D.DORM_ID AS DORMID,
                D.DORM_NAME AS DORMNAME,
                CONCAT(DO.FIRST_NAME, ' ', DO.LAST_NAME) AS OWNERNAME,
                D.UPDATE_AT AS UPDATEDAT,
                D.ADDRESS AS ADDRESS,
                D.FRONT_DORM_IMAGE AS COVERIMAGE,
                D.SCORE AS SCORE,
                DS.DORM_STATUS_NAME
            FROM FAVORITES F
            JOIN DORMITORIES D ON F.DORM_ID = D.DORM_ID
            JOIN DORM_OWNERS DO ON D.DORM_OWNER_ID = DO.DORM_OWNER_ID
            JOIN DORM_STATUSES DS ON D.DORM_STATUS_ID = DS.DORM_STATUS_ID
            WHERE F.USER_ID = ?
            ORDER BY F.FAV_ID DESC
        `;

    const [rows] = await dbcon.query<RowDataPacket[]>(sql, [id]);

    if (rows.length > 0) {
      return res.status(200).json(rows);
    } else {
      return res.status(400).json([]);
    }
  } catch (error) {
    console.error("Error fetching favorites:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////   other api --End--  ////////////////////////////////////////////////////////////////

//////////////////////////////////   About Method --Begin--  ////////////////////////////////////////////////////////////////

export async function getDormOwners_fn(conn: PoolConnection, uid: number) {
  try {
    const [owner] = await conn.execute<DTOUserDormOwnerReqGetRes[]>(
      `
      SELECT 
      DONER.USER_ID,
      DONER.FIRST_NAME,
      DONER.LAST_NAME,
      DONER.FACEBOOK,
      DONER.INSTAGRAM,
      DONER.LINE,
      DONER.TELEGRAM,
      DONER.X,
      DONER.REQ_STATUS,
      DONER.PROFILE_IMAGE,
      U.USERNAME,
      U.EMAIL,
      U.PHONE_NUMBER,
      U.ROLE_TYPE_ID,
      U.ACCOUNT_STATUS
      FROM DORM_OWNERS DONER 
      INNER JOIN USERS U 
      ON DONER.USER_ID = U.USER_ID 
      WHERE DONER.USER_ID = ?`,
      [uid]
    );

    if (owner.length > 0) {
      return owner;
    } else {
      return [];
    }
  } catch (error) {
    throw error;
  }
}

export async function requestDormOwner_fn(
  conn: PoolConnection,
  userData: UserDormOwnerReqPostReq,
  publicUrl: string
) {
  const lineLink = normalizeLineID(userData?.line);
  const telegramLink = normalizeThaiPhone(userData?.telegram);

  try {
    const sql = `
          INSERT INTO DORM_OWNERS 
          (USER_ID, FIRST_NAME, LAST_NAME, FACEBOOK, LINE, X, INSTAGRAM, TELEGRAM, PROFILE_IMAGE)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

    const params = [
      userData.user_id,
      userData.first_name,
      userData.last_name,
      userData.facebook || null,
      lineLink || null,
      userData.x || null,
      userData.instagram || null,
      telegramLink || null,
      publicUrl,
    ];

    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  } catch (error) {
    throw error;
  }
}

export function normalizeLineID(lineId: string | null): string | null {
  return lineId ? `https://line.me/ti/p/~${lineId.trim()}` : null;
}

export function normalizeThaiPhone(input: string | null): string | null {
  let phone = "";

  if (input) {
    phone = input.replace(/[^\d+]/g, "");
  } else {
    return null;
  }

  if (phone.startsWith("+66")) {
    return phone;
  }

  if (phone.startsWith("66")) {
    return "+" + phone;
  }
  if (phone.startsWith("0")) {
    return "https://t.me/+66" + phone.slice(1);
  }

  return null;
}

export async function getUser(email: string) {
  const uEmail = email.trim();
  const conn = await dbcon.getConnection();
  try {
    const [rows] = await conn.query<UserDataPostRes[]>(
      "SELECT * FROM USERS WHERE EMAIL = ?",
      [uEmail]
    );
    return rows;
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
}

export async function getUsers_fn() {
  const conn = await dbcon.getConnection();
  try {
    const sql = `
      SELECT 
        USER_ID, 
        USERNAME, 
        EMAIL, 
        PHONE_NUMBER, 
        ROLE_TYPE_ID, 
        ACCOUNT_STATUS 
      FROM USERS 
      WHERE ROLE_TYPE_ID IN (1, 2)
    `;

    const [users] = await conn.execute<UserAllGetRes[]>(sql);

    return users;
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
}

export async function resMailSender_fn(
  email: string,
  subject: string,
  msg: string
) {
  try {
    const userData = await getUser(email.trim());

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
               
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
                .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .content { padding: 40px 30px; color: #333333; line-height: 1.6; }
                .message-box { background-color: #f8fafc; border-left: 4px solid #2563EB; padding: 20px; margin: 20px 0; font-size: 18px; font-weight: 500; color: #1e293b; }
                .footer { background-color: #f4f4f4; padding: 20px; text-align: center; color: #888888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div style="background-color: #f4f4f4; padding: 40px 0;">
                <div class="container">
                    <div class="content">
                        <h2 style="margin-top: 0; color: #1f2937;">แจ้งเตือนจากระบบ</h2>
                        <p>เรียน ${userData[0]?.USERNAME},</p>
                        
                        <div class="message-box">
                            ${msg}
                        </div>

                        <p>หากคุณไม่ได้ทำรายการนี้ กรุณาติดต่อผู้ดูแลระบบทันที</p>
                        <p>ขอบคุณครับ,<br>ทีมงาน HuntPuk</p>
                    </div>

                    <div class="footer">
                        <p>&copy; ${new Date().getFullYear()} HuntPuk Application. All rights reserved.</p>
                        <p>อีเมลฉบับนี้เป็นการแจ้งเตือนอัตโนมัติ กรุณาอย่าตอบกลับ</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
`;
    const info = await transporter.sendMail({
      from: '"HuntPuk Support" <noreply.Huntpuk@gmail.com>',
      to: email,
      subject: subject,
      html: htmlContent,
    });
    return info.accepted.length > 0;
  } catch (error) {
    throw error;
  }
}

async function delOldOTP_fn(email: string) {
  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    await conn.execute(
      "DELETE FROM OTP_VERIFIES WHERE create_at < NOW() - INTERVAL 5 MINUTE"
    );
    await conn.execute<QueryResult>(
      "DELETE FROM OTP_VERIFIES WHERE EMAIL = ?",
      [email]
    );

    await conn.commit();
    return;
  } catch (error) {
    conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function OTP_Sender_fn(email: string) {
  const otp = Math.floor(100000 + Math.random() * 899999).toString();
  const conn = await dbcon.getConnection();
  let msg = null;
  try {
    const otpHtmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
            .container { max-width: 500px; margin: 30px auto; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            .content { padding: 40px 30px; text-align: center; color: #333333; }
            .otp-box { 
                background-color: #f0f9ff; 
                border: 2px dashed #2563EB; 
                border-radius: 8px; 
                padding: 20px; 
                margin: 25px 0; 
                font-size: 40px; 
                font-weight: bold; 
                letter-spacing: 8px; 
                color: #2563EB; 
                font-family: 'Courier New', monospace; 
            }
            .warning { color: #ef4444; font-size: 14px; margin-top: 15px; }
            .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="content">
                <p style="font-size: 16px; margin-bottom: 10px;">รหัสยืนยันตัวตน (OTP) ของคุณคือ</p>
                
                <div class="otp-box">
                    ${otp}
                </div>

                <p style="color: #555;">รหัสนี้จะหมดอายุภายใน <strong>3 นาที</strong></p>
                
                <div class="warning">
                    ⚠️ โปรดอย่าแชร์รหัสนี้ให้ผู้อื่น เพื่อความปลอดภัยของบัญชี
                </div>
            </div>

            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} HuntPuk Application. All rights reserved.</p>
                <p>อีเมลฉบับนี้เป็นการแจ้งเตือนอัตโนมัติ กรุณาอย่าตอบกลับ</p>
            </div>
        </div>
    </body>
    </html>
`;
    const info = await transporter.sendMail({
      from: '"HuntPuk Support" <noreply.Huntpuk@gmail.com>',
      to: email,
      subject: `รหัสยืนยันตัวตน: ${otp}`,
      html: otpHtmlContent,
    });

    if (info.accepted.length > 0) {
      await conn.beginTransaction();
      await delOldOTP_fn(email);
      const sql = "INSERT INTO OTP_VERIFIES(otp_code, email) VALUES(?, ?)";
      const [rows] = await conn.execute<ResultSetHeader>(sql, [otp, email]);
      await conn.commit();

      if (rows.affectedRows > 0) {
        msg = "ส่ง OTP สำเร็จ";
      }
    } else {
      msg = "ส่ง OTP ไม่สำเร็จ";
    }
    return msg;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function OTP_Verify_fn(otp: string, email: string) {
  const conn = await dbcon.getConnection();
  let success = false;
  let msg = null;
  try {
    const [rows] = await conn.execute<OtpVerifyPostRes[]>(
      "SELECT * FROM OTP_VERIFIES WHERE email = ?",
      [email]
    );
    if (rows.length <= 0) {
      msg = "โปรดส่งคำร้องขอ OTP";
      success = false;
      return { status: success, email, msg };
    }

    const sentTime = new Date(rows[0]!.CREATE_AT);
    const now = new Date();
    const diff = Math.trunc((now.getTime() - sentTime.getTime()) / 1000);

    if (otp == rows[0]!.OTP_CODE && diff <= 180) {
      success = true;
      msg = "ยืนยันตัวตนด้วย OTP สำเร็จ";
      await delOldOTP_fn(email);
      return { status: success, email, msg };
    } else {
      msg = "OTP ไม่ถูกต้องหรือ หมดอายุโปรดลองอีกครั้ง";
      return { status: success, email };
    }
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
}

//////////////////////////////////   About Method --End--  ////////////////////////////////////////////////////////////////
