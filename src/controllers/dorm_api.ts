// controllers/dorm_api.ts
import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  deleteFolder,
  deleteFromGCS,
  fileUpload,
  processAndUploadImages,
} from "./uploads";
import { getUser, getUsers_fn, resMailSender_fn } from "./user_api";
import { PoolConnection } from "mysql2/promise";
import {
  DormRegPostReq,
  DormRoomImgTypeGetRes,
  DormRoomTypeReqPostReq,
  RoomTypeItem,
  DormDataGetRes,
  FacOfDormGetRes,
  DormSummary,
  DormAllGetRes,
  DormDetailGetRes,
} from "../models/dorm.model";
import { User } from "../models/user.model";

export type MulterFiles = {
  [fieldname: string]: Express.Multer.File[];
};

export const getAllDorms = async (req: Request, res: Response) => {
  try {
    // รับพารามิเตอร์การกรองและค้นหาจาก Query String
    const {
      search,
      zone,
      minPrice,
      maxPrice,
      lat,
      lng,
      radius,
      minScore,
      maxWater,
      maxElect,
    } = req.query;

    const trimmedSearch = search ? search.toString().trim() : "";

    // โครงสร้างคำสั่ง SQL ดึงข้อมูลพื้นฐานหอพักตามขอบเขตความต้องการ
    let sql = `
            SELECT 
                d.DORM_ID, 
                d.DORM_NAME, 
                d.ADDRESS, 
                d.SCORE, 
                d.FRONT_DORM_IMAGE as image, 
                z.ZONE_NAME as zone, 
                ST_X(d.COORDINATES) as lat, 
                ST_Y(d.COORDINATES) as lng, 
                d.DORM_STATUS_ID as status,
                d.WATER_UNIT,
                d.WATER_LUMP,
                d.ELECT_UNIT,
                d.UPDATE_AT,
                -- ✅ แก้: ดึงเฉพาะราคารายเดือน (PRICE_TYPE_ID = 1) เป็น start_price
                -- ไม่ใช้ MIN(PRICE) ทั้งหมด เพราะรายวันอาจถูกกว่ารายเดือนทำให้ราคาผิด
                MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 THEN rp.PRICE ELSE NULL END) as start_price
            FROM DORMITORIES d
            LEFT JOIN DORM_ZONES z ON d.ZONE_ID = z.ZONE_ID
            LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
            LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
            WHERE d.REQ_STATUS = 1
            AND d.DORM_STATUS_ID IN (1, 3)
        `;

    const queryParams: any[] = [];

    // 🔍 1. ค้นหาด้วยชื่อหอพัก
    if (trimmedSearch) {
      sql += ` AND d.DORM_NAME LIKE ?`;
      queryParams.push(`%${trimmedSearch}%`);
    }

    // 🗺️ 2. ค้นหาด้วยโซนของหอพัก
    if (zone) {
      sql += ` AND z.ZONE_NAME = ?`;
      queryParams.push(zone);
    }

    // ⭐ 3. ค้นหาด้วยคะแนนรีวิวขั้นต่ำ (เช่น หอพักที่มีคะแนน >= 4 ดาว)
    if (minScore) {
      sql += ` AND d.SCORE >= ?`;
      queryParams.push(Number(minScore));
    }

    // 💧 4. ค้นหาด้วยค่าน้ำต่อหน่วย/แบบเหมา สูงสุดที่ไม่เกินกำหนด
    if (maxWater) {
      sql += ` AND (d.WATER_UNIT <= ? OR d.WATER_LUMP <= ?)`;
      queryParams.push(Number(maxWater), Number(maxWater));
    }

    // ⚡ 5. ค้นหาด้วยค่าไฟต่อหน่วย สูงสุดที่ไม่เกินกำหนด
    if (maxElect) {
      sql += ` AND d.ELECT_UNIT <= ?`;
      queryParams.push(Number(maxElect));
    }

    // จัดกลุ่มข้อมูลเนื่องจากมีการใช้ Aggregate Function (MIN)
    sql += ` GROUP BY d.DORM_ID`;

    // 💰 6. ค้นหาด้วยช่วงราคาเช่าเริ่มต้นต่อเดือน (ต้องเช็คใน HAVING เพราะเป็นผลรวมย่อย)
    let havingClauses = [];
    if (minPrice) {
      havingClauses.push(`start_price >= ?`);
      queryParams.push(Number(minPrice));
    }
    if (maxPrice) {
      havingClauses.push(`start_price <= ?`);
      queryParams.push(Number(maxPrice));
    }

    if (havingClauses.length > 0) {
      sql += ` HAVING ` + havingClauses.join(" AND ");
    }

    // สั่งรัน Query ดึงข้อมูลจากฐานข้อมูล
    const [rows] = await dbcon.execute<RowDataPacket[]>(sql, queryParams);

    // 📍 7. ค้นหาหอพักภายในรัศมีขอบเขตรอบจุดอ้างอิง (หมุดสีน้ำเงิน)
    let finalDorms = rows;
    if (lat && lng && radius) {
      const userLat = Number(lat);
      const userLng = Number(lng);
      const maxRadius = Number(radius); // รัศมีหน่วยเป็นกิโลเมตร

      finalDorms = rows.filter((dorm: any) => {
        if (!dorm.lat || !dorm.lng) return false;
        // คำนวณระยะห่างระหว่างจุดอ้างอิงของผู้ใช้กับที่ตั้งหอพัก
        const distance = calculateHaversineDistance(
          userLat,
          userLng,
          Number(dorm.lat),
          Number(dorm.lng),
        );
        dorm.distance_from_ref = distance; // แนบระยะทางกลับไปให้หน้า Frontend นำไปแสดงผล
        return distance <= maxRadius;
      });
    }

    // ส่งผลลัพธ์ข้อมูลหอพักที่ผ่านการกรองกลับไปให้หน้า Frontend
    res.status(200).json({ success: true, data: finalDorms });
  } catch (error: any) {
    console.error("Get All Dorms Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพักขั้นสูง",
    });
  }
};

// 🌟 ฟังก์ชันเสริม: คำนวณระยะทางจากเส้นละติจูด/ลองจิจูด (Haversine Formula) คืนค่าเป็นกิโลเมตร
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // รัศมีของโลก (กิโลเมตร)
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getDormById_fn(did: number, conn: PoolConnection) {
  try {
    const [dorm] = await conn.execute<DormDataGetRes[]>(
      "SELECT * FROM DORMITORIES WHERE DORM_ID = ?",
      [Number(did)],
    );
    if (dorm.length > 0) return dorm;
    return [];
  } catch (error) {
    throw error;
  }
}

export const getAllDorms_Admin = async (req: Request, res: Response) => {
  try {
    // ✅ เพิ่มการ Join ตาราง Zone และ ราคา (DORM_ROOMS, ROOM_PRICES) เข้ามาด้วย
    const sql = `
      SELECT 
        d.DORM_ID, 
        d.DORM_NAME, 
        d.DORM_STATUS_ID,
        ds.DORM_STATUS_NAME,
        d.ADDRESS,
        d.FRONT_DORM_IMAGE, 
        
        dz.ZONE_NAME,
        COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 THEN rp.PRICE ELSE NULL END), 0) AS start_price,

        do.FIRST_NAME,
        do.LAST_NAME,
        u.EMAIL,
        u.PHONE_NUMBER

      FROM DORMITORIES d
      LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
      LEFT JOIN DORM_STATUSES ds ON d.DORM_STATUS_ID = ds.DORM_STATUS_ID
      LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
      LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
      LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
      
      WHERE d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4
      
      GROUP BY d.DORM_ID
      ORDER BY d.DORM_ID DESC
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql);

    res.json({
      success: true,
      data: dorms,
    });
  } catch (error: any) {
    console.error("Error getAllDorms_Admin:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  }
};

export const getAllDorms_Admin_Mobile = async (req: Request, res: Response) => {
  try {
    const sql = `
      SELECT 
        d.DORM_ID, 
        d.DORM_NAME, 
        d.DORM_STATUS_ID,
        ds.DORM_STATUS_NAME,
        d.ADDRESS,
        d.FRONT_DORM_IMAGE, 
        d.REQ_STATUS,
        
        dz.ZONE_NAME,
        COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 THEN rp.PRICE ELSE NULL END), 0) AS start_price,

        do.FIRST_NAME,
        do.LAST_NAME,
        u.EMAIL,
        u.PHONE_NUMBER

      FROM DORMITORIES d
      LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
      LEFT JOIN DORM_STATUSES ds ON d.DORM_STATUS_ID = ds.DORM_STATUS_ID
      LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
      LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
      LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
      
      WHERE d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4
      
      GROUP BY d.DORM_ID
      ORDER BY d.DORM_ID DESC
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql);

    res.json({
      success: true,
      data: dorms,
    });
  } catch (error: any) {
    console.error("Error getAllDorms_Admin_Mobile:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  }
};

// --- 2. ดูรายละเอียดหอพัก 1 แห่ง (อัปเดตใหม่ ทนทานต่อการดึงรัวๆ) ---
export const getDormById = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const sqlMain = `
      SELECT 
        d.*, 
        ST_X(d.COORDINATES) AS LAT,
        ST_Y(d.COORDINATES) AS LNG,
        dz.ZONE_NAME,
        do.USER_ID,
        do.FIRST_NAME, 
        do.LAST_NAME, 
        u.PHONE_NUMBER AS OWNER_PHONE, 
        do.LINE AS OWNER_LINE, 
        do.FACEBOOK AS OWNER_FACEBOOK, 
        do.INSTAGRAM AS OWNER_INSTAGRAM, 
        do.X AS OWNER_X, 
        do.TELEGRAM AS OWNER_TELEGRAM
      FROM DORMITORIES d
      LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
      LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
      WHERE d.DORM_ID = ?
    `;

    const [dormInfo] = await dbcon.query<RowDataPacket[]>(sqlMain, [id]);

    if (dormInfo.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพัก" });
    }
    const mainData = dormInfo[0]!;

    const [images] = await dbcon.query<RowDataPacket[]>(
      "SELECT IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
      [id],
    );

    const [facilitiesData] = await dbcon.query<RowDataPacket[]>(
      `SELECT ft.FAC_TYPE_NAME, ft.FAC_TYPE_ICON FROM FACILITIES_DORMS fd JOIN FACILITIES_TYPES ft ON fd.FAC_TYPE_ID = ft.FAC_TYPE_ID WHERE fd.DORM_ID = ? AND ft.STATUS = 2`,
      [id],
    );
    const facilitiesList = facilitiesData.map((f: any) => ({
      name: f.FAC_TYPE_NAME as string,
      icon: f.FAC_TYPE_ICON as string,
    }));

    // 🌟 แก้ไขจุดที่ 3: เพิ่มการดึงราคารายวัน (perDay) และประเภทเตียงจากฐานข้อมูล
    const [rooms] = await dbcon.query<RowDataPacket[]>(
      `
        SELECT 
            dr.DORM_ROOM_ID,
            rt.ROOM_TYPE_ID,
            rt.ROOM_TYPE_NAME, 
            MAX(CASE WHEN rp.PRICE_TYPE_ID = 1 THEN rp.PRICE END) as perMonth,
            MAX(CASE WHEN rp.PRICE_TYPE_ID = 2 THEN rp.PRICE END) as perTerm,
            MAX(CASE WHEN rp.PRICE_TYPE_ID = 3 THEN rp.PRICE END) as perDay,
            rb.BED_TYPE_ID,
            bt.BED_TYPE_NAME
        FROM DORM_ROOMS dr
        JOIN ROOM_TYPES rt ON dr.ROOM_TYPE_ID = rt.ROOM_TYPE_ID
        LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
        LEFT JOIN ROOM_BEDS rb ON dr.DORM_ROOM_ID = rb.DORM_ROOM_ID
        LEFT JOIN BED_TYPES bt ON rb.BED_TYPE_ID = bt.BED_TYPE_ID
        WHERE dr.DORM_ID = ?
        GROUP BY dr.DORM_ROOM_ID, rt.ROOM_TYPE_ID, rt.ROOM_TYPE_NAME, rb.BED_TYPE_ID, bt.BED_TYPE_NAME
      `,
      [id],
    );

    // 🌟 แก้ไขจุดที่ 4: คำนวณราคาเริ่มต้นที่ถูกต้อง (ตัด 0 บาททิ้ง)
    const validMonthlyPrices = rooms
      .map((r: any) => Number(r.perMonth || r.permonth || r.PERMONTH || 0))
      .filter((p: number) => p > 0);
    const minPrice =
      validMonthlyPrices.length > 0
        ? Math.min(...validMonthlyPrices)
        : mainData.start_price || 0;

    const validTermPrices = rooms
      .map((r: any) => Number(r.perTerm || r.perterm || r.PERTERM || 0))
      .filter((p: number) => p > 0);
    const minTermPrice =
      validTermPrices.length > 0 ? Math.min(...validTermPrices) : null;

    const gallery: string[] = [];
    const roomImgKeywords: Record<string, string> = {
      ceiling: "ceiling_img",
      wall: "wall_img",
      floor: "floor_img",
      bathroom: "bathroom_img",
      balcony: "balcony_img",
    };
    const roomComponents: Record<string, string> = {};

    images.forEach((img: any) => {
      const path = img.IMAGE_PATH.toLowerCase();
      let isRoomPart = false;
      for (const [kw, field] of Object.entries(roomImgKeywords)) {
        if (path.includes(kw)) {
          roomComponents[field] = img.IMAGE_PATH;
          isRoomPart = true;
          break;
        }
      }
      if (!isRoomPart) {
        gallery.push(img.IMAGE_PATH);
      }
    });

    const [roomPricesResult] = await dbcon.query<RowDataPacket[]>(
      `SELECT rp.DORM_ROOM_ID, rp.PRICE_TYPE_ID, rp.PRICE FROM ROOM_PRICES rp
       JOIN DORM_ROOMS dr ON rp.DORM_ROOM_ID = dr.DORM_ROOM_ID WHERE dr.DORM_ID = ?`,
      [id]
    );

    const roomPricesMap: Record<number, any[]> = {};
    roomPricesResult.forEach((rp: any) => {
      if (!roomPricesMap[rp.DORM_ROOM_ID]) roomPricesMap[rp.DORM_ROOM_ID] = [];
      roomPricesMap[rp.DORM_ROOM_ID]!.push({ priceTypeId: rp.PRICE_TYPE_ID, price: rp.PRICE });
    });

    const responseData: any = {
      ...mainData,
      DORM_NAME: mainData.DORM_NAME,
      ADDRESS: mainData.ADDRESS,
      image: mainData.FRONT_DORM_IMAGE,
      lat: mainData.LAT,
      lng: mainData.LNG,
      start_price: minPrice,
      term_price: minTermPrice,
      phone: mainData.OWNER_PHONE || "-",
      line: mainData.OWNER_LINE || "-",
      facebook: mainData.OWNER_FACEBOOK || "-",
      instagram: mainData.OWNER_INSTAGRAM || "-",
      telegram: mainData.OWNER_TELEGRAM || "-",
      x: mainData.OWNER_X || "-",
      facilities: facilitiesList,
      gallery: gallery,
      ...roomComponents,
      rooms: rooms.map((r: any) => ({
        ROOM_TYPE_ID: r.ROOM_TYPE_ID,
        DORM_ROOM_ID: r.DORM_ROOM_ID,
        ROOM_TYPE_NAME: r.ROOM_TYPE_NAME,
        PRICE: Number(r.perMonth || r.permonth || r.PERMONTH || 0),
        perTerm: Number(r.perTerm || r.perterm || r.PERTERM || 0),
        perDay: Number(r.perDay || r.perday || r.PERDAY || 0),
        prices: roomPricesMap[r.DORM_ROOM_ID] || [],
        bedType: r.BED_TYPE_NAME || "-",
        BED_TYPE_ID: r.BED_TYPE_ID,
      })),
      WATER_UNIT: mainData.WATER_UNIT,
      WATER_LUMP: mainData.WATER_LUMP,
      ELECT_UNIT: mainData.ELECT_UNIT,
      ADD_DORM_DATA: mainData.ADD_DORM_DATA,
      FIRST_NAME: mainData.FIRST_NAME || "(ไม่ระบุชื่อ)",
      LAST_NAME: mainData.LAST_NAME || "",
      USER_ID: mainData.USER_ID,
      DORM_LICENSE: mainData.DORM_LICENSE,
    };

    res.json({ success: true, data: responseData });
  } catch (error: any) {
    console.error("!!! Error in getDormById !!!", error);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  }
};
export const getAllZones = async (req: Request, res: Response) => {
  try {
    // ✅ เปลี่ยนจาก SELECT * เป็นการแกะ lat, lng ออกจากจุด POINT
    const sql = `
      SELECT 
        ZONE_ID, 
        ZONE_NAME, 
        ST_X(COORDINATES) as lat, 
        ST_Y(COORDINATES) as lng 
      FROM DORM_ZONES 
      ORDER BY ZONE_ID ASC
    `;
    const [zones] = await dbcon.query<RowDataPacket[]>(sql);
    res.json({ success: true, data: zones });
  } catch (error) {
    console.error("Error in getAllZones:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
  }
};

export const addFacility_api = async (req: Request, res: Response) => {
  const { fac_name, uid } = req.body;

  const file = req.file;
  const conn = await dbcon.getConnection();
  let icon_url = null;
  if (!file || !fac_name || !uid)
    return res
      .status(400)
      .json({ success: false, message: "ข้อมูลไม่ครบถ้วน" });

  try {
    const user = await (await getUsers_fn()).filter((u) => u.USER_ID == uid);
    if (user.length < 1)
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบผู้ใช้งาน" });

    const [limitAdd] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(ADD_BY) count FROM FACILITIES_TYPES WHERE ADD_BY = ?",
      [uid],
    );

    if (limitAdd[0]!["count"] >= 3)
      return res.status(200).json({
        success: false,
        message: "ขีดจำกัดในการเพิ่มสิ่งอำนวยความสะดวกเต็มแล้ว",
      });

    const [dupFac] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(FAC_TYPE_NAME) count FROM FACILITIES_TYPES WHERE FAC_TYPE_NAME = ?",
      [fac_name],
    );

    if (dupFac[0]!["count"] > 0)
      return res
        .status(200)
        .json({ success: false, message: "ชื่อสิ่งอำนวยความสะดวกซ้ำ" });
    icon_url = await fileUpload(
      file,
      "users",
      `${user[0]?.USERNAME}_${user[0]?.USER_ID}`,
      "icons",
      fac_name,
    );

    conn.beginTransaction();
    const [result] = await conn.execute<ResultSetHeader>(
      "INSERT INTO FACILITIES_TYPES (FAC_TYPE_NAME, FAC_TYPE_ICON, ADD_BY) VALUES (? ,? ,?)",
      [fac_name.toString().trim(), icon_url, uid],
    );
    conn.commit();
    if (result.affectedRows > 0) {
      return res
        .status(201)
        .json({ success: true, message: "เพิ่มสิ่งอำนวยความสะดวกสำเร็จ" });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "เพิ่มสิ่งอำนวยความสะดวกไม่สำเร็จ" });
    }
  } catch (error: any) {
    conn.rollback();
    return res.status(400).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const createDormMB_api = async (req: Request, res: Response) => {
  const tokenUserId = (req as any).user?.id;
  const tokenUserRole = (req as any).user?.role;
  const {
    user_id, // Still accept it but prioritize tokenUserId
    name,
    address,
    lat,
    lng,
    zone_id,
    type_id,
    water_unit,
    water_lump,
    elect_unit,
    detail,
    facilities,
    roomTypes,
  } = req.body;

  let finalUserId = tokenUserId || user_id;
  if ((tokenUserRole === 1 || tokenUserRole === 3) && user_id) {
    finalUserId = user_id;
  }

  if (!finalUserId || !name || !address || !lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "ข้อมูลที่จำเป็นไม่ครบถ้วน (user_id, name, address, lat, lng)",
    });
  }

  let facilitiesArr: number[] = [];
  let roomTypesArr: any[] = [];
  let newFacArr: { name: string; icon: string }[] = [];
  try {
    facilitiesArr =
      typeof facilities === "string"
        ? JSON.parse(facilities || "[]")
        : facilities || [];
    roomTypesArr =
      typeof roomTypes === "string"
        ? JSON.parse(roomTypes || "[]")
        : roomTypes || [];

    const { new_facilities } = req.body;
    if (new_facilities) {
      newFacArr =
        typeof new_facilities === "string"
          ? JSON.parse(new_facilities)
          : new_facilities;
    }
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: "ข้อมูลสิ่งอำนวยความสะดวกหรือประเภทห้องพักไม่ถูกต้อง",
    });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    const [ownerRows] = await conn.execute<RowDataPacket[]>(
      `SELECT DORM_OWNER_ID, REQ_STATUS, FIRST_NAME, LAST_NAME FROM DORM_OWNERS WHERE USER_ID = ? ORDER BY REQ_STATUS ASC, DORM_OWNER_ID DESC`,
      [finalUserId],
    );

    let dorm_owner_id: number;
    const activeOwner = ownerRows.find(
      (r: any) => r.REQ_STATUS === 1 || r.REQ_STATUS === 0,
    );

    if (activeOwner) {
      dorm_owner_id = activeOwner.DORM_OWNER_ID;
    } else {
      const [userRows] = await conn.execute<RowDataPacket[]>(
        `SELECT USERNAME, ROLE_TYPE_ID FROM USERS WHERE USER_ID = ?`,
        [finalUserId],
      );

      if (userRows.length === 0) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, message: "ไม่พบบัญชีผู้ใช้ในระบบ" });
      }

      const username = userRows[0]!.USERNAME;
      const firstName = ownerRows[0]?.FIRST_NAME || username;
      const lastName = ownerRows[0]?.LAST_NAME || "(New Request)";

      const [insertOwner] = await conn.execute<ResultSetHeader>(
        `INSERT INTO DORM_OWNERS 
           (USER_ID, FIRST_NAME, LAST_NAME, REQ_STATUS, PROFILE_IMAGE)
         VALUES (?, ?, ?, 0, '')`,
        [finalUserId, firstName, lastName],
      );
      dorm_owner_id = insertOwner.insertId;
    }

    let finalZoneId = Number(zone_id) || 0;
    if (!finalZoneId) {
      const pointStr2 = `POINT(${lat} ${lng})`;
      const [zoneRows] = await conn.query<RowDataPacket[]>(
        `
        SELECT ZONE_ID,
          ST_Distance_Sphere(COORDINATES, POINT(ST_X(ST_GeomFromText(?)), ST_Y(ST_GeomFromText(?)))) AS dist
        FROM DORM_ZONES ORDER BY dist ASC LIMIT 1
      `,
        [pointStr2, pointStr2],
      );
      finalZoneId = zoneRows[0]?.ZONE_ID ?? 1;
    }

    const sqlDorm = `
      INSERT INTO DORMITORIES 
      (DORM_OWNER_ID, DORM_NAME, ADDRESS, COORDINATES, ZONE_ID, DORM_TYPE_ID, 
       WATER_UNIT, WATER_LUMP, ELECT_UNIT, FRONT_DORM_IMAGE, DORM_LICENSE, ADD_DORM_DATA,
       REQ_STATUS, DORM_STATUS_ID)
      VALUES (?, ?, ?, ST_GeomFromText(?), ?, ?, ?, ?, ?, '', '', ?, 0, 1)
    `;
    const pointStr = `POINT(${lat} ${lng})`;

    const [dormResult] = await conn.execute<ResultSetHeader>(sqlDorm, [
      dorm_owner_id,
      name,
      address,
      pointStr,
      finalZoneId,
      Number(type_id) || 1,
      Number(water_unit) || 0,
      Number(water_lump) || 0,
      Number(elect_unit) || 0,
      detail || "",
    ]);
    const dormId = dormResult.insertId;

    if (facilitiesArr.length > 0) {
      for (const facId of facilitiesArr) {
        await conn.execute(
          `INSERT IGNORE INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID) VALUES (?, ?)`,
          [dormId, facId],
        );
      }
    }

    if (newFacArr.length > 0) {
      for (const fac of newFacArr) {
        if (!fac.name) continue;
        const [facResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO FACILITIES_TYPES (FAC_TYPE_NAME, FAC_TYPE_ICON, STATUS, ADD_BY) VALUES (?, ?, 1, ?)`,
          [fac.name.trim(), fac.icon || null, finalUserId],
        );
        const newFacId = facResult.insertId;
        await conn.execute(
          `INSERT INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID, STATUS) VALUES (?, ?, 0)`,
          [dormId, newFacId],
        );
      }
    }

    const getBedId = async (name: string): Promise<number> => {
      const n = name?.toString() || "1";
      return parseInt(n) || 1;
    };

    const insertedRoomNames = new Set<string>();

    for (const room of roomTypesArr) {
      if (!room.roomType || room.roomType.trim() === "") continue;

      let roomName = room.roomType.trim();

      if (insertedRoomNames.has(roomName)) {
        const bedSuffix =
          room.bedType === "3" || room.bedType === "4"
            ? "เตียงคู่"
            : "เตียงเดี่ยว";
        roomName = `${roomName} (${bedSuffix})`;
      }
      if (insertedRoomNames.has(roomName)) continue;
      insertedRoomNames.add(roomName);

      let roomTypeId;
      const [existingRt] = await conn.execute<RowDataPacket[]>(
        `SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE ROOM_TYPE_NAME = ?`,
        [roomName],
      );
      if (existingRt.length > 0) {
        roomTypeId = existingRt[0]!.ROOM_TYPE_ID;
      } else {
        const [rtResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)`,
          [roomName],
        );
        roomTypeId = rtResult.insertId;
      }

      const [existingDr] = await conn.execute<RowDataPacket[]>(
        `SELECT DORM_ROOM_ID FROM DORM_ROOMS WHERE DORM_ID = ? AND ROOM_TYPE_ID = ?`,
        [dormId, roomTypeId],
      );
      if (existingDr.length > 0) continue;

      const [drResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO DORM_ROOMS (DORM_ID, ROOM_TYPE_ID) VALUES (?, ?)`,
        [dormId, roomTypeId],
      );
      const dormRoomId = drResult.insertId;

      if (
        room.perMonth !== null &&
        room.perMonth !== undefined &&
        room.perMonth !== "" &&
        Number(room.perMonth) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)`,
          [dormRoomId, room.perMonth],
        );
      }
      if (
        room.perTerm !== null &&
        room.perTerm !== undefined &&
        room.perTerm !== "" &&
        Number(room.perTerm) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)`,
          [dormRoomId, room.perTerm],
        );
      }
      if (
        room.perDay !== null &&
        room.perDay !== undefined &&
        room.perDay !== "" &&
        Number(room.perDay) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 3, ?)`,
          [dormRoomId, room.perDay],
        );
      }

      const bedTypeId = await getBedId(room.bedType);
      await conn.execute(
        `INSERT INTO ROOM_BEDS (DORM_ROOM_ID, BED_TYPE_ID) VALUES (?, ?)`,
        [dormRoomId, bedTypeId],
      );
    }

    await conn.commit();
    res
      .status(201)
      .json({ success: true, message: "ลงทะเบียนข้อมูลหอพักสำเร็จ", dormId });
  } catch (error: any) {
    console.error("Transaction Error:", error);
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลงทะเบียนหอพัก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const uploadDormImagesMB_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const dormId = Number(id);
  const files = req.files as MulterFiles;

  if (!files || Object.keys(files).length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "ไม่พบไฟล์รูปภาพที่ต้องการอัปโหลด" });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    const [dormRows] = await conn.execute<RowDataPacket[]>(
      "SELECT DORM_OWNER_ID FROM DORMITORIES WHERE DORM_ID = ?",
      [dormId],
    );

    if (dormRows.length === 0) {
      await conn.rollback();
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบหอพักที่ระบุ" });
    }

    const dorm_owner_id = dormRows[0]!.DORM_OWNER_ID;

    // 2. Process and Upload All Images
    let uploadedUrls: Record<string, string | string[]> = {};
    if (Object.keys(files).length > 0) {
      uploadedUrls = await processAndUploadImages(files, dormId, dorm_owner_id);
    }

    // 3. Update Dormitory with main image URLs
    const frontUrl = (uploadedUrls["FRONT_DORM_IMG"] as string) || "";
    const licenseUrl = (uploadedUrls["LICENSE_IMG"] as string) || "";

    if (frontUrl || licenseUrl) {
      const [oldMain] = await conn.execute<RowDataPacket[]>(
        "SELECT FRONT_DORM_IMAGE, DORM_LICENSE FROM DORMITORIES WHERE DORM_ID = ?",
        [dormId],
      );

      let sql = "UPDATE DORMITORIES SET ";
      const updates = [];
      const params = [];
      if (frontUrl) {
        if (oldMain[0]?.FRONT_DORM_IMAGE)
          await deleteFromGCS(oldMain[0].FRONT_DORM_IMAGE);
        updates.push("FRONT_DORM_IMAGE = ?");
        params.push(frontUrl);
      }
      if (licenseUrl) {
        if (oldMain[0]?.DORM_LICENSE)
          await deleteFromGCS(oldMain[0].DORM_LICENSE);
        updates.push("DORM_LICENSE = ?");
        params.push(licenseUrl);
      }

      sql += updates.join(", ") + " WHERE DORM_ID = ?";
      params.push(dormId);

      await conn.execute(sql, params);
    }

    // 4. Handle Custom Facility Image (if applicable)
    const facIconUrl = (uploadedUrls["FACILITY_IMG"] as string) || "";
    if (facIconUrl) {
      const [userRows] = await conn.execute<RowDataPacket[]>(
        "SELECT USER_ID FROM DORM_OWNERS WHERE DORM_OWNER_ID = ?",
        [dorm_owner_id],
      );
      if (userRows.length > 0) {
        await conn.execute(
          "UPDATE FACILITIES_TYPES SET FAC_TYPE_ICON = ? WHERE ADD_BY = ? AND FAC_TYPE_ICON IS NULL ORDER BY FAC_TYPE_ID DESC LIMIT 1",
          [facIconUrl, userRows[0]!.USER_ID],
        );
      }
    }

    // 5. Insert Other Images (Gallery)
    if (uploadedUrls["OTHER_IMG"]) {
      const otherUrls = Array.isArray(uploadedUrls["OTHER_IMG"])
        ? uploadedUrls["OTHER_IMG"]
        : [uploadedUrls["OTHER_IMG"]];

      for (const url of otherUrls) {
        await conn.execute(
          `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
          [dormId, url],
        );
      }
    }

    // 6. Set up room components images
    const roomImgFieldMap: Record<string, number> = {
      CEILING_IMG: 1,
      WALL_IMG: 2,
      FLOOR_IMG: 3,
      BATHROOM_IMG: 5,
      BALCONY_IMG: 6,
    };

    const roomImgFields = Object.keys(roomImgFieldMap);
    if (roomImgFields.some((field) => uploadedUrls[field])) {
      const [existingImages] = await conn.execute<RowDataPacket[]>(
        "SELECT DORM_IMG_ID, IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
        [dormId],
      );

      for (const field of roomImgFields) {
        if (uploadedUrls[field]) {
          const baseName = field.toLowerCase().replace("_img", "");
          const oldImgs = existingImages.filter(
            (img: any) =>
              img.IMAGE_PATH && img.IMAGE_PATH.toLowerCase().includes(baseName),
          );

          for (const old of oldImgs) {
            await deleteFromGCS(old.IMAGE_PATH);
            await conn.execute(
              "DELETE FROM DORM_IMAGES WHERE DORM_IMG_ID = ?",
              [old.DORM_IMG_ID],
            );
          }

          await conn.execute(
            `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
            [dormId, uploadedUrls[field] as string],
          );
        }
      }
    }

    await conn.commit();
    res.status(200).json({ success: true, message: "อัปโหลดรูปภาพสำเร็จ" });
  } catch (error: any) {
    console.error("Upload Images Error:", error);
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const createDorm_api = async (req: Request, res: Response) => {
  const {
    user_id,
    name,
    address,
    lat,
    lng,
    zone_id,
    type_id,
    water_unit,
    water_lump,
    elect_unit,
    detail,
    facilities,
    roomTypes,
  } = req.body;

  const files = req.files as MulterFiles;

  let facilitiesArr: number[] = [];
  let roomTypesArr: any[] = [];
  let newFacArr: { name: string; icon: string }[] = [];
  try {
    facilitiesArr = JSON.parse(facilities || "[]");
    roomTypesArr = JSON.parse(roomTypes || "[]");
    const { new_facilities } = req.body;
    if (new_facilities) {
      newFacArr =
        typeof new_facilities === "string"
          ? JSON.parse(new_facilities)
          : new_facilities;
    }
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: "ข้อมูลสิ่งอำนวยความสะดวกหรือประเภทห้องพักไม่ถูกต้อง",
    });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    const [ownerRows] = await conn.execute<RowDataPacket[]>(
      `SELECT DORM_OWNER_ID FROM DORM_OWNERS WHERE USER_ID = ?`,
      [user_id],
    );

    let dorm_owner_id: number;

    if (ownerRows.length === 0) {
      const [userRows] = await conn.execute<RowDataPacket[]>(
        `SELECT USERNAME, ROLE_TYPE_ID FROM USERS WHERE USER_ID = ?`,
        [user_id],
      );

      if (userRows.length === 0) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, message: "ไม่พบบัญชีผู้ใช้ในระบบ" });
      }

      const roleId = userRows[0]!.ROLE_TYPE_ID;
      const username = userRows[0]!.USERNAME;

      if (roleId !== 2 && roleId !== 3) {
        await conn.rollback();
        return res.status(403).json({
          success: false,
          message: "บัญชีนี้ไม่มีสิทธิ์ลงทะเบียนหอพัก",
        });
      }

      if (roleId === 3) {
        const [insertOwner] = await conn.execute<ResultSetHeader>(
          `INSERT INTO DORM_OWNERS 
             (USER_ID, FIRST_NAME, LAST_NAME, FACEBOOK, LINE, X, INSTAGRAM, TELEGRAM, REQ_STATUS, PROFILE_IMAGE)
           VALUES (?, ?, '(Admin)', NULL, NULL, NULL, NULL, NULL, 1, '')`,
          [user_id, username],
        );
        dorm_owner_id = insertOwner.insertId;
      } else {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message:
            "ไม่พบข้อมูลสิทธิ์เจ้าของหอพัก กรุณาลงทะเบียนเป็นเจ้าของหอพักก่อน",
        });
      }
    } else {
      dorm_owner_id = ownerRows[0]!.DORM_OWNER_ID;
    }

    let finalZoneId = Number(zone_id) || 0;
    if (!finalZoneId) {
      const pointStr2 = `POINT(${lat} ${lng})`;
      const [zoneRows] = await conn.query<RowDataPacket[]>(
        `
        SELECT ZONE_ID,
          ST_Distance_Sphere(COORDINATES, POINT(ST_X(ST_GeomFromText(?)), ST_Y(ST_GeomFromText(?)))) AS dist
        FROM DORM_ZONES ORDER BY dist ASC LIMIT 1
      `,
        [pointStr2, pointStr2],
      );
      finalZoneId = zoneRows[0]?.ZONE_ID ?? 1;
    }

    const sqlDorm = `
      INSERT INTO DORMITORIES 
      (DORM_OWNER_ID, DORM_NAME, ADDRESS, COORDINATES, ZONE_ID, DORM_TYPE_ID, 
       WATER_UNIT, WATER_LUMP, ELECT_UNIT, FRONT_DORM_IMAGE, DORM_LICENSE, ADD_DORM_DATA,
       REQ_STATUS, DORM_STATUS_ID)
      VALUES (?, ?, ?, ST_GeomFromText(?), ?, ?, ?, ?, ?, '', '', ?, 0, 1)
    `;
    const pointStr = `POINT(${lat} ${lng})`;

    const [dormResult] = await conn.execute<ResultSetHeader>(sqlDorm, [
      dorm_owner_id,
      name,
      address,
      pointStr,
      finalZoneId,
      Number(type_id) || 1,
      Number(water_unit) || 0,
      Number(water_lump) || 0,
      Number(elect_unit) || 0,
      detail || "",
    ]);
    const dormId = dormResult.insertId;

    let uploadedUrls: Record<string, string | string[]> = {};
    if (Object.keys(files).length > 0) {
      uploadedUrls = await processAndUploadImages(files, dormId, dorm_owner_id);
    }

    const frontUrl = (uploadedUrls["FRONT_DORM_IMG"] as string) || "";
    const licenseUrl = (uploadedUrls["LICENSE_IMG"] as string) || "";

    if (frontUrl || licenseUrl) {
      await conn.execute(
        `UPDATE DORMITORIES SET FRONT_DORM_IMAGE = ?, DORM_LICENSE = ? WHERE DORM_ID = ?`,
        [frontUrl, licenseUrl, dormId],
      );
    }

    if (facilitiesArr.length > 0) {
      for (const facId of facilitiesArr) {
        await conn.execute(
          `INSERT IGNORE INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID) VALUES (?, ?)`,
          [dormId, facId],
        );
      }
    }

    // 4.5 Handle Custom Facility Request (Monolithic)
    if (newFacArr.length > 0) {
      for (const fac of newFacArr) {
        if (!fac.name) continue;
        const [facResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO FACILITIES_TYPES (FAC_TYPE_NAME, FAC_TYPE_ICON, STATUS, ADD_BY) VALUES (?, ?, 1, ?)`,
          [fac.name.trim(), fac.icon || null, user_id],
        );
        const newFacId = facResult.insertId;
        await conn.execute(
          `INSERT INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID, STATUS) VALUES (?, ?, 0)`,
          [dormId, newFacId],
        );
      }
    }

    if (uploadedUrls["OTHER_IMG"]) {
      const otherUrls = Array.isArray(uploadedUrls["OTHER_IMG"])
        ? uploadedUrls["OTHER_IMG"]
        : [uploadedUrls["OTHER_IMG"]];

      for (const url of otherUrls) {
        await conn.execute(
          `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
          [dormId, url],
        );
      }
    }

    const roomImgFieldMap: Record<string, number> = {
      CEILING_IMG: 1,
      WALL_IMG: 2,
      FLOOR_IMG: 3,
      BED_IMG: 4,
      BATHROOM_IMG: 5,
      BALCONY_IMG: 6,
    };

    const uploadedRoomImgs: { typeId: number; url: string }[] = [];
    for (const [field, typeId] of Object.entries(roomImgFieldMap)) {
      if (uploadedUrls[field]) {
        uploadedRoomImgs.push({ typeId, url: uploadedUrls[field] as string });
      }
    }

    const getBedId = async (name: string): Promise<number> => {
      const n = name?.toString() || "1";
      return parseInt(n) || 1;
    };

    const insertedRoomNames = new Set<string>();

    for (const room of roomTypesArr) {
      if (!room.roomType || room.roomType.trim() === "") continue;

      let roomName = room.roomType.trim();

      if (insertedRoomNames.has(roomName)) {
        const bedSuffix =
          room.bedType === "3" || room.bedType === "4"
            ? "เตียงคู่"
            : "เตียงเดี่ยว";
        roomName = `${roomName} (${bedSuffix})`;
      }
      if (insertedRoomNames.has(roomName)) continue;
      insertedRoomNames.add(roomName);

      let roomTypeId;
      const [existingRt] = await conn.execute<RowDataPacket[]>(
        `SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE ROOM_TYPE_NAME = ?`,
        [roomName],
      );
      if (existingRt.length > 0) {
        roomTypeId = existingRt[0]!.ROOM_TYPE_ID;
      } else {
        const [rtResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)`,
          [roomName],
        );
        roomTypeId = rtResult.insertId;
      }

      const [existingDr] = await conn.execute<RowDataPacket[]>(
        `SELECT DORM_ROOM_ID FROM DORM_ROOMS WHERE DORM_ID = ? AND ROOM_TYPE_ID = ?`,
        [dormId, roomTypeId],
      );
      if (existingDr.length > 0) continue;

      const [drResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO DORM_ROOMS (DORM_ID, ROOM_TYPE_ID) VALUES (?, ?)`,
        [dormId, roomTypeId],
      );
      const dormRoomId = drResult.insertId;

      if (
        room.perMonth !== null &&
        room.perMonth !== undefined &&
        room.perMonth !== "" &&
        Number(room.perMonth) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)`,
          [dormRoomId, room.perMonth],
        );
      }
      if (
        room.perTerm !== null &&
        room.perTerm !== undefined &&
        room.perTerm !== "" &&
        Number(room.perTerm) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)`,
          [dormRoomId, room.perTerm],
        );
      }
      if (
        room.perDay !== null &&
        room.perDay !== undefined &&
        room.perDay !== "" &&
        Number(room.perDay) > 0
      ) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 3, ?)`,
          [dormRoomId, room.perDay],
        );
      }

      const bedTypeId = await getBedId(room.bedType);
      await conn.execute(
        `INSERT INTO ROOM_BEDS (DORM_ROOM_ID, BED_TYPE_ID) VALUES (?, ?)`,
        [dormRoomId, bedTypeId],
      );
    }

    for (const img of uploadedRoomImgs) {
      await conn.execute(
        `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
        [dormId, img.url],
      );
    }

    await conn.commit();
    res
      .status(201)
      .json({ success: true, message: "ลงทะเบียนหอพักสำเร็จ", dormId });
  } catch (error: any) {
    console.error("Transaction Error:", error);
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลงทะเบียนหอพัก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const updateDorm_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const dormId = Number(id);
  const body = req.body;
  const files = (req.files as MulterFiles) || {};

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();
    const dormList = await getDormById_fn(dormId, conn);

    if (!dormList || dormList.length === 0) {
      await conn.rollback();
      return res.status(400).json("Dorm not found");
    }
    const dormData: any = dormList[0];
    const ownerId = dormData.DORM_OWNER_ID;

    // Security check: only owner or admin can update
    const [ownerRows] = await conn.execute<RowDataPacket[]>(
      "SELECT USER_ID FROM DORM_OWNERS WHERE DORM_OWNER_ID = ?",
      [ownerId],
    );
    const tokenUserId = (req as any).user?.id;
    if (
      ownerRows[0]?.USER_ID !== tokenUserId &&
      (req as any).user?.role !== 3
    ) {
      await conn.rollback();
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์แก้ไขหอพักนี้" });
    }

    // Upload all new files using the centralized pipeline
    let uploadedUrls: Record<string, string | string[]> = {};
    if (Object.keys(files).length > 0) {
      uploadedUrls = await processAndUploadImages(files, dormId, ownerId);
    }

    if (((req as any).user?.role === 1 || (req as any).user?.role === 3) && body.user_id) {
      const [oRows] = await conn.execute<RowDataPacket[]>(
        `SELECT DORM_OWNER_ID FROM DORM_OWNERS WHERE USER_ID = ? ORDER BY REQ_STATUS ASC LIMIT 1`,
        [body.user_id]
      );
      let newDormOwnerId;
      if (oRows.length > 0) {
        newDormOwnerId = oRows[0]!.DORM_OWNER_ID;
      } else {
        const [uRows] = await conn.execute<RowDataPacket[]>(`SELECT USERNAME FROM USERS WHERE USER_ID = ?`, [body.user_id]);
        if (uRows.length > 0) {
          const [ins] = await conn.execute<ResultSetHeader>(
            `INSERT INTO DORM_OWNERS (USER_ID, FIRST_NAME, LAST_NAME, REQ_STATUS, PROFILE_IMAGE) VALUES (?, ?, ?, 0, '')`,
            [body.user_id, uRows[0]!.USERNAME, '(Assigned)']
          );
          newDormOwnerId = ins.insertId;
        }
      }
      if (newDormOwnerId) {
        await conn.execute(`UPDATE DORMITORIES SET DORM_OWNER_ID = ? WHERE DORM_ID = ?`, [newDormOwnerId, dormId]);
      }
    }

    await updateDormInfo_fn(dormId, body, uploadedUrls, conn);

    if (body.facilities) {
      await updateFacilities_fn(dormId, body.facilities, conn);
    }

    if (body.roomTypes) {
      await updateRoomTypes_fn(dormId, body.roomTypes, conn);
    }

    if (Object.keys(uploadedUrls).length > 0) {
      await updateRoomComponentImages_fn(dormId, uploadedUrls, conn);
      await updateGalleryImages_fn(dormId, uploadedUrls, conn);
    }

    await conn.commit();
    res.json({ success: true, message: "อัปเดตข้อมูลหอพักสำเร็จ" });
  } catch (error: any) {
    await conn.rollback();
    console.error("Update Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูลหอพัก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const updateDormInfo_fn = async (
  dormId: number,
  data: any,
  uploadedUrls: Record<string, string | string[]>,
  conn: PoolConnection,
) => {
  let sql = "UPDATE DORMITORIES SET UPDATE_AT = CURRENT_DATE()";
  const params: any[] = [];
  const [oldData] = await conn.execute<RowDataPacket[]>(
    "SELECT FRONT_DORM_IMAGE, DORM_LICENSE, REQ_STATUS FROM DORMITORIES WHERE DORM_ID = ?",
    [dormId],
  );

  if (oldData[0]?.REQ_STATUS === 2) {
    sql += ", REQ_STATUS = 3";
  }

  if (data.name !== undefined && data.name !== "") {
    sql += ", DORM_NAME = ?";
    params.push(data.name);
  }
  if (data.address !== undefined && data.address !== "") {
    sql += ", ADDRESS = ?";
    params.push(data.address);
  }
  if (data.lat !== undefined && data.lng !== undefined) {
    sql += ", COORDINATES = ST_GeomFromText(?)";
    params.push(`POINT(${data.lat} ${data.lng})`);
  }
  if (data.zone_id !== undefined) {
    sql += ", ZONE_ID = ?";
    params.push(data.zone_id);
  }
  if (data.type_id !== undefined) {
    sql += ", DORM_TYPE_ID = ?";
    params.push(data.type_id);
  }
  if (data.water_unit !== undefined) {
    sql += ", WATER_UNIT = ?";
    params.push(data.water_unit);
  }
  if (data.water_lump !== undefined) {
    sql += ", WATER_LUMP = ?";
    params.push(data.water_lump);
  }
  if (data.elect_unit !== undefined) {
    sql += ", ELECT_UNIT = ?";
    params.push(data.elect_unit);
  }
  if (data.detail !== undefined) {
    sql += ", ADD_DORM_DATA = ?";
    params.push(data.detail);
  }

  if (uploadedUrls["FRONT_DORM_IMG"]) {
    if (oldData[0]?.FRONT_DORM_IMAGE)
      await deleteFromGCS(oldData[0].FRONT_DORM_IMAGE);
    sql += ", FRONT_DORM_IMAGE = ?";
    params.push(uploadedUrls["FRONT_DORM_IMG"]);
  }

  if (uploadedUrls["LICENSE_IMG"]) {
    if (oldData[0]?.DORM_LICENSE) await deleteFromGCS(oldData[0].DORM_LICENSE);
    sql += ", DORM_LICENSE = ?";
    params.push(uploadedUrls["LICENSE_IMG"]);
  }

  sql += " WHERE DORM_ID = ?";
  params.push(dormId);
  await conn.execute(sql, params);
};

export const updateFacilities_fn = async (
  dormId: number,
  facilitiesJson: string,
  conn: PoolConnection,
) => {
  let facilitiesArr: number[] = [];
  try {
    facilitiesArr = JSON.parse(facilitiesJson);
  } catch (e) {
    return;
  }

  if (facilitiesArr.length >= 0) {
    await conn.execute("DELETE FROM FACILITIES_DORMS WHERE DORM_ID = ?", [
      dormId,
    ]);
    for (const facId of facilitiesArr) {
      await conn.execute(
        "INSERT INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID) VALUES (?, ?)",
        [dormId, facId],
      );
    }
  }
};

export const updateRoomTypes_fn = async (
  dormId: number,
  roomTypesJson: string,
  conn: PoolConnection,
) => {
  const getBedId = (name: string): number => {
    const n = name?.toString().toLowerCase() || "";
    if (n.includes("single") || n === "1") return 1;
    if (n.includes("double") || n === "2") return 2;
    return 1;
  };

  let roomTypes: any[] = [];
  try {
    roomTypes = JSON.parse(roomTypesJson);
  } catch (e) {
    return;
  }

  if (!roomTypes || roomTypes.length === 0) return;

  // 🌟 1. ล้างข้อมูลเก่าแบบ 100% (แก้บั๊ก Error 500: ทยอยลบจากลูกไปหาแม่ ปลอดภัยชัวร์!)
  await conn.execute(
    `
    DELETE rp FROM ROOM_PRICES rp 
    JOIN DORM_ROOMS dr ON rp.DORM_ROOM_ID = dr.DORM_ROOM_ID 
    WHERE dr.DORM_ID = ?
  `,
    [dormId],
  );

  await conn.execute(
    `
    DELETE rb FROM ROOM_BEDS rb 
    JOIN DORM_ROOMS dr ON rb.DORM_ROOM_ID = dr.DORM_ROOM_ID 
    WHERE dr.DORM_ID = ?
  `,
    [dormId],
  );

  // ลบตารางแม่ได้อย่างปลอดภัย
  await conn.execute(`DELETE FROM DORM_ROOMS WHERE DORM_ID = ?`, [dormId]);

  // 🌟 พระเอกคนใหม่: ใช้ Set เพื่อเก็บ "ชื่อห้อง" แทน ID
  const insertedRoomNames = new Set<string>();

  // 2. สร้างโครงสร้างห้องพักเข้าไปใหม่
  for (const room of roomTypes) {
    if (!room.roomType || room.roomType.trim() === "") continue; // ข้ามถ้าไม่ได้กรอกชื่อ

    let roomName = room.roomType.trim();

    // 🌟 ระบบสุดฉลาด: ถ้าเจอชื่อห้องซ้ำกันในรอบการบันทึกนี้ ให้ดึงประเภทเตียงมาต่อท้ายชื่อห้องอัตโนมัติ!
    if (insertedRoomNames.has(roomName)) {
      const bedSuffix =
        room.bedType === "Double Bed" || room.bedType === "2"
          ? "เตียงคู่"
          : "เตียงเดี่ยว";
      roomName = `${roomName} (${bedSuffix})`;
    }

    // ถ้าแอบต่อท้ายแล้วยังซ้ำอีก (เช่น ผู้ใช้กดส่ง "ห้องพัดลมเตียงคู่" มา 2 กล่องเป๊ะๆ) อันนี้ต้องข้ามของจริงเพื่อกันพัง
    if (insertedRoomNames.has(roomName)) {
      continue;
    }
    insertedRoomNames.add(roomName); // จำชื่อไว้กันซ้ำ

    let roomTypeId;

    // เช็คว่ามีชื่อห้องนี้อยู่ในระบบภาพรวมหรือยัง (เช็คจาก roomName ที่อาจจะถูกเติมคำแล้ว)
    const [existingRt] = await conn.execute<RowDataPacket[]>(
      `SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE ROOM_TYPE_NAME = ?`,
      [roomName],
    );

    if (existingRt.length > 0) {
      roomTypeId = existingRt[0]!.ROOM_TYPE_ID;
    } else {
      const [rtResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)`,
        [roomName],
      );
      roomTypeId = rtResult.insertId;
    }

    // สร้างสะพานเชื่อมระหว่าง หอพัก <-> ประเภทห้อง
    const [drResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO DORM_ROOMS (DORM_ID, ROOM_TYPE_ID) VALUES (?, ?)`,
      [dormId, roomTypeId],
    );
    const dormRoomId = drResult.insertId;

    // เพิ่มราคา
    if (room.prices && Array.isArray(room.prices)) {
      for (const p of room.prices) {
        if (p.price !== null && p.price !== undefined && p.price > 0) {
          await conn.execute(
            `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, ?, ?)`,
            [dormRoomId, p.priceTypeId, p.price]
          );
        }
      }
    } else {
      // Fallback for older apps that still send perMonth, perTerm, perDay
      if (room.perMonth !== null && room.perMonth !== undefined) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)`,
          [dormRoomId, room.perMonth],
        );
      }
      if (room.perTerm !== null && room.perTerm !== undefined) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)`,
          [dormRoomId, room.perTerm],
        );
      }
      if (room.perDay !== null && room.perDay !== undefined) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 3, ?)`,
          [dormRoomId, room.perDay],
        );
      }
    }

    // เพิ่มประเภทเตียง
    const bedTypeId = getBedId(room.bedType);
    await conn.execute(
      `INSERT INTO ROOM_BEDS (DORM_ROOM_ID, BED_TYPE_ID) VALUES (?, ?)`,
      [dormRoomId, bedTypeId],
    );
  }
};

export const updateRoomComponentImages_fn = async (
  dormId: number,
  uploadedUrls: Record<string, string | string[]>,
  conn: PoolConnection,
) => {
  const keywords = [
    "CEILING_IMG",
    "WALL_IMG",
    "FLOOR_IMG",
    "BED_IMG",
    "BATHROOM_IMG",
    "BALCONY_IMG",
  ];

  const [existingImages] = await conn.execute<RowDataPacket[]>(
    "SELECT DORM_IMG_ID, IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
    [dormId],
  );

  for (const keyword of keywords) {
    if (uploadedUrls[keyword]) {
      const baseName = keyword.toLowerCase().replace("_img", "");
      const oldImgs = existingImages.filter(
        (img: any) =>
          img.IMAGE_PATH && img.IMAGE_PATH.toLowerCase().includes(baseName),
      );
      for (const old of oldImgs) {
        await deleteFromGCS(old.IMAGE_PATH);
        await conn.execute("DELETE FROM DORM_IMAGES WHERE DORM_IMG_ID = ?", [
          old.DORM_IMG_ID,
        ]);
      }

      await conn.execute(
        "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
        [dormId, uploadedUrls[keyword] as string],
      );
    }
  }
};

export const updateGalleryImages_fn = async (
  dormId: number,
  uploadedUrls: Record<string, string | string[]>,
  conn: PoolConnection,
) => {
  if (!uploadedUrls["OTHER_IMG"]) return;

  const newUrls = Array.isArray(uploadedUrls["OTHER_IMG"])
    ? uploadedUrls["OTHER_IMG"]
    : [uploadedUrls["OTHER_IMG"]];

  if (newUrls.length === 0) return;

  const [allImages] = await conn.execute<RowDataPacket[]>(
    "SELECT DORM_IMG_ID, IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
    [dormId],
  );

  for (const [i, newUrl] of newUrls.entries()) {
    const keyword = `other_${i}`;

    const oldImg = allImages.find(
      (img: any) => img.IMAGE_PATH && img.IMAGE_PATH.includes(keyword),
    );

    if (oldImg) {
      await deleteFromGCS(oldImg.IMAGE_PATH);

      await conn.execute("DELETE FROM DORM_IMAGES WHERE DORM_IMG_ID = ?", [
        oldImg.DORM_IMG_ID,
      ]);
    }

    await conn.execute(
      "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
      [dormId, newUrl],
    );
  }
};

export const removeDorm_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const conn = await dbcon.getConnection();
  const userRole = (req as any).user?.role;

  try {
    if (userRole === 3) {
      // Admin: Hard Delete
      await conn.beginTransaction();

      // ลบตารางที่มี Foreign Key เชื่อมกับ DORM_ROOMS ก่อน
      await conn.execute(
        "DELETE rp FROM ROOM_PRICES rp JOIN DORM_ROOMS dr ON rp.DORM_ROOM_ID = dr.DORM_ROOM_ID WHERE dr.DORM_ID = ?",
        [id],
      );
      await conn.execute(
        "DELETE rb FROM ROOM_BEDS rb JOIN DORM_ROOMS dr ON rb.DORM_ROOM_ID = dr.DORM_ROOM_ID WHERE dr.DORM_ID = ?",
        [id],
      );

      // ลบตารางที่เชื่อมกับ DORM_ID
      await conn.execute("DELETE FROM DORM_ROOMS WHERE DORM_ID = ?", [id]);
      await conn.execute("DELETE FROM DORM_IMAGES WHERE DORM_ID = ?", [id]);
      await conn.execute("DELETE FROM FACILITIES_DORMS WHERE DORM_ID = ?", [
        id,
      ]);
      await conn.execute("DELETE FROM FAVORITES WHERE DORM_ID = ?", [id]);
      await conn.execute("DELETE FROM REVIEWS WHERE DORM_ID = ?", [id]);
      await conn.execute("DELETE FROM STATISTIC_WEB_VIEW WHERE DORM_ID = ?", [
        id,
      ]);
      await conn.execute("DELETE FROM WEB_VIEW_LOGS WHERE DORM_ID = ?", [id]);

      // ลบหอพักในตารางหลัก
      const [result] = await conn.execute<ResultSetHeader>(
        "DELETE FROM DORMITORIES WHERE DORM_ID = ?",
        [id],
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return res
          .status(404)
          .json({ success: false, message: "ไม่พบข้อมูลหอพักนี้ในระบบ" });
      }

      await conn.commit();

      res.json({
        success: true,
        message: "ลบข้อมูลหอพักออกจากระบบอย่างถาวรเรียบร้อยแล้ว (Hard Delete)",
      });
    } else {
      // Dorm Owner: Soft Delete
      const [result] = await conn.execute<ResultSetHeader>(
        "UPDATE DORMITORIES SET DORM_STATUS_ID = 4 WHERE DORM_ID = ?",
        [id],
      );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "ไม่พบข้อมูลหอพักนี้ในระบบ" });
      }

      res.json({
        success: true,
        message: "สถานะหอพักถูกเปลี่ยนเป็นปิดรับจอง (Soft Delete)",
      });
    }
  } catch (error: any) {
    await conn.rollback();
    console.error("Hard Delete Dorm Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบหอพักแบบถาวร",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const restoreDorm_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const conn = await dbcon.getConnection();

  try {
    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET DORM_STATUS_ID = 1 WHERE DORM_ID = ?",
      [id],
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพักนี้ในระบบ" });
    }

    res.json({
      success: true,
      message: "สถานะหอพักถูกเปลี่ยนเป็นกำลังใช้งาน",
    });
  } catch (error: any) {
    console.error("เกิดข้อผิดพลาดในการกู้คืนข้อมูลหอพัก:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการกู้คืนข้อมูลหอพัก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const addReview_api = async (req: Request, res: Response) => {
  const { user_id, dorm_id, score, comment } = req.body;
  if (!user_id || !dorm_id || score === undefined) {
    return res.status(400).json({
      success: false,
      message: `ข้อมูลไม่ครบถ้วน${user_id}, ${dorm_id}, ${score}, ${comment}`,
    });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    try {
      await conn.execute(
        "INSERT INTO REVIEWS (USER_ID, DORM_ID, SCORE, COMMENTS) VALUES (?, ?, ?, ?)",
        [user_id, dorm_id, score, comment],
      );
    } catch (err: any) {
      if (err.code === "ER_DUP_ENTRY") {
        throw new Error("คุณได้รีวิวหอพักนี้ไปแล้ว");
      }
      throw err;
    }

    const [avgResult] = await conn.execute<RowDataPacket[]>(
      "SELECT AVG(SCORE) as avg_score FROM REVIEWS WHERE DORM_ID = ?",
      [dorm_id],
    );

    const newScore = avgResult[0]?.avg_score || 0;

    await conn.execute("UPDATE DORMITORIES SET SCORE = ? WHERE DORM_ID = ?", [
      newScore,
      dorm_id,
    ]);

    await conn.commit();
    res.status(201).json({
      success: true,
      message: "รีวิวถูกเพิ่มเรียบร้อยแล้ว",
      newDormScore: newScore,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error("Add Review Error:", error);

    const msg =
      error.message === "คุณได้รีวิวหอพักนี้ไปแล้ว"
        ? error.message
        : "Failed to add review";
    res
      .status(500)
      .json({ success: false, message: msg, error: error.message });
  } finally {
    conn.release();
  }
};

export const deleteReview_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    const [reviewData] = await conn.execute<RowDataPacket[]>(
      "SELECT DORM_ID FROM REVIEWS WHERE REVIEW_ID = ?",
      [id],
    );

    if (reviewData.length === 0) {
      await conn.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }
    const dormId = reviewData[0]?.DORM_ID;
    await conn.execute("DELETE FROM REVIEWS WHERE REVIEW_ID = ?", [id]);
    const [avgResult] = await conn.execute<RowDataPacket[]>(
      "SELECT AVG(SCORE) as avg_score FROM REVIEWS WHERE DORM_ID = ?",
      [dormId],
    );

    const newScore = avgResult[0]?.avg_score || 0;

    await conn.execute("UPDATE DORMITORIES SET SCORE = ? WHERE DORM_ID = ?", [
      newScore,
      dormId,
    ]);

    await conn.commit();
    res.json({
      success: true,
      message: "รีวิวถูกลบเรียบร้อยแล้ว",
      newDormScore: newScore,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error("Delete Review Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบรีวิว",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const getDormsByOwner_api = async (req: Request, res: Response) => {
  const id = req.params.id as string; // This is USER_ID from frontend

  try {
    const sql = `
               SELECT 
                    d.DORM_ID,
                    d.DORM_NAME,
                    d.FRONT_DORM_IMAGE,
                    d.ADDRESS,
                    d.SCORE,
                    d.VIEW_COUNT,
                    d.REQ_STATUS,       
                    d.DORM_STATUS_ID, 
                    ds.DORM_STATUS_NAME, 
                    dz.ZONE_NAME,
                    COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 AND rp.PRICE > 0 THEN rp.PRICE END), 0) AS start_price 
                FROM DORMITORIES d
                JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
                LEFT JOIN DORM_STATUSES ds ON d.DORM_STATUS_ID = ds.DORM_STATUS_ID
                LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
                LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
                LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
                WHERE do.USER_ID = ? AND d.DORM_STATUS_ID != 4
                GROUP BY d.DORM_ID
                ORDER BY d.DORM_ID DESC
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql, [id]);

    res.json({
      success: true,
      count: dorms.length,
      data: dorms,
    });
  } catch (error: any) {
    console.error("เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก",
      error: error.message,
    });
  }
};

export const getReviewsByDormId_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const sql = `
      SELECT 
        r.REVIEW_ID,
        r.SCORE,
        r.COMMENTS,
        r.CREATE_AT,
        r.USER_ID,
        u.USERNAME
      FROM REVIEWS r
      JOIN USERS u ON r.USER_ID = u.USER_ID
      WHERE r.DORM_ID = ?
      ORDER BY r.CREATE_AT DESC
    `;

    const [reviews] = await dbcon.query<RowDataPacket[]>(sql, [id]);

    res.json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error: any) {
    console.error("Get Reviews Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลรีวิว",
      error: error.message,
    });
  }
};

export const getPendingOwners_api = async (req: Request, res: Response) => {
  try {
    const sql = `
        SELECT 
        do.*,
        u.USERNAME,
        u.EMAIL,
        u.PHONE_NUMBER,
        u.ACCOUNT_STATUS,
        u.ROLE_TYPE_ID

      FROM DORM_OWNERS do
      JOIN USERS u ON do.USER_ID = u.USER_ID
      WHERE do.REQ_STATUS = 0;
    `;

    const [owners] = await dbcon.query<RowDataPacket[]>(sql);

    res.json({
      success: true,
      count: owners.length,
      data: owners,
    });
  } catch (error: any) {
    console.error("Get Pending Owners Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลเจ้าของหอพักที่รอการอนุมัติ",
      error: error.message,
    });
  }
};

export const getPopularDorms_api = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 6;

    const sql = `
              SELECT 
                  d.DORM_ID, 
                  d.DORM_NAME, 
                  d.ADDRESS,
                  d.SCORE,
                  d.FRONT_DORM_IMAGE as image, 
                  d.VIEW_COUNT,
                  dz.ZONE_NAME,
                  /* 🌟 แก้ไขจุดที่ 6: หน้า Popular ก็ต้องยึดรายเดือน */
                  COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 AND rp.PRICE > 0 THEN rp.PRICE END), 0) as start_price,
                  d.DORM_STATUS_ID as status,
                  (SELECT COUNT(*) FROM FAVORITES f WHERE f.DORM_ID = d.DORM_ID) as fav_count
              FROM DORMITORIES d
              LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
              LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
              LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
              GROUP BY d.DORM_ID
              ORDER BY d.SCORE DESC, d.VIEW_COUNT DESC, fav_count DESC
              LIMIT ?
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql, [limit]);

    res.json({
      success: true,
      count: dorms.length,
      data: dorms,
    });
  } catch (error: any) {
    console.error("Get Popular Dorms Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพักยอดนิยม",
      error: error.message,
    });
  }
};

export const approveDormReq_api = async (req: Request, res: Response) => {
  const { dorm_id, approve_status, msg } = req.body;
  const conn = await dbcon.getConnection();

  const data = {
    dormId: Number(dorm_id),
    status: approve_status == true ? 1 : 2, // 1 = accept (อนุมัติ), 2 = reject (ไม่อนุมัติ)
    msg,
  };

  try {
    await conn.beginTransaction();

    const [dormInfo] = await conn.execute<RowDataPacket[]>(
      `SELECT u.EMAIL, d.DORM_NAME, d.DORM_LICENSE 
       FROM DORMITORIES d
       JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
       JOIN USERS u ON do.USER_ID = u.USER_ID
       WHERE d.DORM_ID = ?`,
      [data.dormId],
    );

    if (dormInfo.length === 0) {
      await conn.rollback();
      return res.status(404).json("ไม่พบข้อมูลหอพักนี้ในระบบ");
    }

    const targetEmail = dormInfo[0]!.EMAIL;
    const dormName = dormInfo[0]!.DORM_NAME;

    let result;
    if (approve_status) {
      if (dormInfo[0]!.DORM_LICENSE) {
        await deleteFromGCS(dormInfo[0]!.DORM_LICENSE);
      }
      [result] = await conn.execute<ResultSetHeader>(
        "UPDATE DORMITORIES SET REQ_STATUS = ?, DORM_LICENSE = '', UPDATE_AT = CURRENT_DATE() WHERE DORM_ID = ?;",
        [data.status, data.dormId],
      );
    } else {
      [result] = await conn.execute<ResultSetHeader>(
        "UPDATE DORMITORIES SET REQ_STATUS = ?, UPDATE_AT = CURRENT_DATE() WHERE DORM_ID = ?;",
        [data.status, data.dormId],
      );
    }

    await conn.commit();

    const subject = `แจ้งผลการพิจารณาลงทะเบียนหอพัก "${dormName}"`;
    let content = "";
    let info = false;

    if (result.affectedRows > 0) {
      if (!approve_status) {
        content = `เรียน เจ้าของหอพัก\n\nขออภัย คำร้องขอลงทะเบียนหอพัก "${dormName}" ของท่าน ไม่ผ่านการพิจารณา\n\tเนื่องจาก: ${data.msg
          .toString()
          .trim()}\n\nกรุณาตรวจสอบข้อมูลและดำเนินการแก้ไขใหม่อีกครั้ง\nขอบคุณที่ใช้บริการของเรา`;

        info = await resMailSender_fn(targetEmail, subject, content);
      } else {
        content = `เรียน เจ้าของหอพัก\n\nขอแสดงความยินดี! คำร้องขอลงทะเบียนหอพัก "${dormName}" ของท่าน ได้รับการอนุมัติเรียบร้อยแล้ว\n\tขณะนี้หอพักของท่านสามารถแสดงผลบนระบบและให้นักศึกษาเข้าดูได้ทันที\n\nขอบคุณที่ไว้วางใจและเลือกใช้บริการของเรา`;

        info = await resMailSender_fn(targetEmail, subject, content);
      }
    } else {
      return res.status(400).json("อัปเดตสถานะคำร้องล้มเหลว");
    }

    if (info) {
      return res.status(200).json("ส่งอีเมลสำเร็จ");
    } else {
      return res.status(400).json("ส่งอีเมลไม่สำเร็จ");
    }
  } catch (error) {
    await conn.rollback();
    console.error(error);
    res.status(400).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะคำร้อง" });
  } finally {
    conn.release();
  }
};

export const getPendingDormReq_api = async (req: Request, res: Response) => {
  try {
    const sql = `
      SELECT 
        d.DORM_ID,
        d.DORM_NAME,
        d.ADDRESS,
        d.FRONT_DORM_IMAGE,
        d.REG_AT,           
        d.DORM_LICENSE,
        d.REQ_STATUS,
        d.DORM_STATUS_ID,
        
        dz.ZONE_NAME,
        dt.DORM_TYPE_NAME,
        
        do.DORM_OWNER_ID,
        do.FIRST_NAME,
        do.LAST_NAME,
        u.PHONE_NUMBER,
        u.EMAIL

      FROM DORMITORIES d
      JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      JOIN USERS u ON do.USER_ID = u.USER_ID
      LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
      LEFT JOIN DORM_TYPES dt ON d.DORM_TYPE_ID = dt.DORM_TYPE_ID
      
      WHERE d.REQ_STATUS IN (0, 2, 3)  
      ORDER BY d.REG_AT ASC   
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql);
    res.json({
      success: true,
      data: dorms,
    });
  } catch (error: any) {
    console.error(
      "เกิดข้อผิดพลาดในการดึงข้อมูลคำร้องขอหอพักที่รอการอนุมัติ:",
      error,
    );
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลคำร้องขอหอพักที่รอการอนุมัติ",
      error: error.message,
    });
  }
};

export const getFacilities_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  try {
    const sql = `SELECT * FROM FACILITIES_TYPES WHERE STATUS = 2`;

    const [facs] = await conn.query<RowDataPacket[]>(sql);
    if (facs.length > 0) {
      return res.status(200).json({ success: true, data: facs });
    } else {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลสิ่งอำนวยความสะดวกในระบบ",
      });
    }
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
  } finally {
    conn.release();
  }
};

export const getFacilitiesOfDorm_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  const { dorm_id } = req.params;
  try {
    const sql = `
    SELECT FD.FAC_DORM_ID, FD.FAC_TYPE_ID, FT.FAC_TYPE_NAME, FT.FAC_TYPE_ICON, FD.DORM_ID 
    FROM FACILITIES_DORMS FD
    JOIN FACILITIES_TYPES FT ON FT.FAC_TYPE_ID = FD.FAC_TYPE_ID
    WHERE FD.DORM_ID = ? AND FT.STATUS = 2`;

    const [facs] = await conn.query<FacOfDormGetRes[]>(sql, [Number(dorm_id)]);
    if (facs.length > 0) {
      return res.status(200).json(facs);
    } else {
      return res.status(404).json("ไม่พบข้อมูลสิ่งอำนวยความสะดวกในระบบ");
    }
  } catch (error: any) {
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลสิ่งอำนวยความสะดวก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const updateFacility_api = async (req: Request, res: Response) => {
  const { fac_name, fac_id } = req.body;
  const { user_id } = req.params;
  const icon = req.file;
  const uid = Number(user_id);
  const conn = await dbcon.getConnection();
  let iconUrl: string = "";
  try {
    if (!fac_id)
      return res.status(400).json("ไม่พบสิ่งอำนวยความสะดวกนี้ในระบบ");
    let user: string;

    if (Number(uid) == 1) {
      user = "admin";
    } else {
      const [userData] = (await getUsers_fn()).filter((u) => u.USER_ID == uid);
      if (!userData) return res.status(400).json("ไม่พบข้อมูลผู้ใช้ในระบบ");
      user = `${userData.USERNAME}_${userData.USER_ID}`;
    }

    const values = [];
    const sql = [];

    if (fac_name) {
      sql.push(`FAC_TYPE_NAME = ?`);
      values.push(fac_name);
    }

    if (icon) {
      sql.push(`FAC_TYPE_ICON = ?`);
      iconUrl = await fileUpload(icon, "users", user, "icons", fac_name);
      values.push(iconUrl);
    }

    if (sql.length === 0)
      return res.status(200).json("ไม่มีการอัปเดตสิ่งอำนวยความสะดวกนี้");

    const [facs] = await conn.query<ResultSetHeader>(
      `UPDATE FACILITIES_TYPES SET ${sql.join(", ")} WHERE FAC_TYPE_ID = ?`,
      [...values, fac_id],
    );
    if (facs.affectedRows > 0) {
      return res.status(201).json({ url: iconUrl });
    }
  } catch (error: any) {
    await deleteFromGCS(iconUrl);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตสิ่งอำนวยความสะดวก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const changeDormStatus_api = async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status_id } = req.body; // รับค่า 1 (ว่าง) หรือ 3 (เต็ม)
  const conn = await dbcon.getConnection();

  try {
    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET DORM_STATUS_ID = ? WHERE DORM_ID = ?",
      [status_id, id],
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพักนี้" });
    }

    res.json({ success: true, message: "เปลี่ยนสถานะหอพักเรียบร้อยแล้ว" });
  } catch (error: any) {
    console.error("Change Status Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการเปลี่ยนสถานะ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const getAllDormMB = async (req: Request, res: Response) => {
  try {
    const { search, zone, minPrice, maxPrice, lat, lng, radius, score } =
      req.query;
    const trimmedSearch = search ? search.toString().trim() : "";
    const userRole = (req as any).user?.role;

    let sql = `
                SELECT 
                    d.DORM_ID, 
                    d.DORM_NAME, 
                    d.ADDRESS, 
                    d.SCORE, 
                    d.FRONT_DORM_IMAGE as image, 
                    d.UPDATE_AT as update_at,
                    dz.ZONE_NAME as zone, 
                    ST_X(d.COORDINATES) as lat, 
                    ST_Y(d.COORDINATES) as lng, 
                    COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 AND rp.PRICE > 0 THEN rp.PRICE END), 0) as start_price,
                    d.DORM_STATUS_ID as status
                FROM DORMITORIES d
                LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
                LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
                LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
                WHERE d.DORM_STATUS_ID in (1, 3)

            `;

    if (userRole === 3) {
      sql += ` AND d.REQ_STATUS IN (1, 2, 3) `;
    } else {
      sql += ` AND d.REQ_STATUS = 1 `;
    }

    const params: any[] = [];

    if (trimmedSearch) {
      sql += ` AND (d.DORM_NAME LIKE ? OR dz.ZONE_NAME LIKE ?) `;
      params.push(`%${trimmedSearch}%`, `%${trimmedSearch}%`);
    }

    if (zone && zone !== "" && zone !== "null" && zone !== "undefined") {
      const zoneId = Number(zone);
      if (!isNaN(zoneId)) {
        sql += ` AND d.ZONE_ID = ? `;
        params.push(zoneId);
      }
    }

    if (score && score !== "" && score !== "null" && score !== "undefined") {
      const scoreNum = Number(score);
      if (!isNaN(scoreNum)) {
        sql += ` AND d.SCORE between ? and (? + 0.9) `;
        params.push(scoreNum, scoreNum);
      }
    }

    if (
      lat &&
      lng &&
      radius &&
      lat !== "null" &&
      lng !== "null" &&
      radius !== "null"
    ) {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      const radiusNum = Number(radius);
      if (!isNaN(latNum) && !isNaN(lngNum) && !isNaN(radiusNum)) {
        sql += ` AND ST_Distance_Sphere(POINT(ST_Y(d.COORDINATES), ST_X(d.COORDINATES)), POINT(?, ?)) <= ? `;
        params.push(lngNum, latNum, radiusNum * 1000);
      }
    }

    sql += ` GROUP BY d.DORM_ID, d.DORM_NAME, d.ADDRESS, d.SCORE, d.FRONT_DORM_IMAGE, d.UPDATE_AT, dz.ZONE_NAME, d.COORDINATES, d.DORM_STATUS_ID `;

    const havingClauses = [];
    if (
      minPrice !== undefined &&
      minPrice !== null &&
      minPrice !== "" &&
      minPrice !== "null" &&
      minPrice !== "undefined"
    ) {
      const minP = Number(minPrice);
      if (!isNaN(minP)) {
        havingClauses.push(
          `COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 AND rp.PRICE > 0 THEN rp.PRICE END), 0) >= ?`,
        );
        params.push(minP);
      }
    }
    if (
      maxPrice !== undefined &&
      maxPrice !== null &&
      maxPrice !== "" &&
      maxPrice !== "null" &&
      maxPrice !== "undefined"
    ) {
      const maxP = Number(maxPrice);
      if (!isNaN(maxP)) {
        havingClauses.push(
          `COALESCE(MIN(CASE WHEN rp.PRICE_TYPE_ID = 1 AND rp.PRICE > 0 THEN rp.PRICE END), 0) <= ?`,
        );
        params.push(maxP);
      }
    }

    if (havingClauses.length > 0) {
      sql += ` HAVING ` + havingClauses.join(" AND ");
    }

    sql += ` ORDER BY d.UPDATE_AT DESC `;

    const [dorms] = await dbcon.query<DormSummary[]>(sql, params);
    res.json({ success: true, data: dorms });
  } catch (error) {
    console.error("Error in getAllDormMB:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
  }
};

export const getAllDormTypes = async (req: Request, res: Response) => {
  try {
    const [rows] = await dbcon.execute<RowDataPacket[]>(
      "SELECT DORM_TYPE_ID as id, DORM_TYPE_NAME as name FROM DORM_TYPES",
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllRoomTypes = async (req: Request, res: Response) => {
  try {
    const [rows] = await dbcon.execute<RowDataPacket[]>(
      "SELECT ROOM_TYPE_ID as id, ROOM_TYPE_NAME as name FROM ROOM_TYPES",
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllBedTypes = async (req: Request, res: Response) => {
  try {
    const [rows] = await dbcon.execute<RowDataPacket[]>(
      "SELECT BED_TYPE_ID as id, BED_TYPE_NAME as name FROM BED_TYPES",
    );
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addDormType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const [result] = await dbcon.execute<any>(
      "INSERT INTO DORM_TYPES (DORM_TYPE_NAME) VALUES (?)",
      [name]
    );
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteDormType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM DORM_TYPES WHERE DORM_TYPE_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addRoomType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const [result] = await dbcon.execute<any>(
      "INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)",
      [name]
    );
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteRoomType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM ROOM_TYPES WHERE ROOM_TYPE_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addBedType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const [result] = await dbcon.execute<any>("INSERT INTO BED_TYPES (BED_TYPE_NAME) VALUES (?)", [name]);
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteBedType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM BED_TYPES WHERE BED_TYPE_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllPriceTypes = async (req: Request, res: Response) => {
  try {
    const [rows] = await dbcon.execute<RowDataPacket[]>("SELECT PRICE_TYPE_ID as id, PRICE_TYPE_NAME as name FROM PRICE_TYPES");
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addPriceType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const [result] = await dbcon.execute<any>("INSERT INTO PRICE_TYPES (PRICE_TYPE_NAME) VALUES (?)", [name]);
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deletePriceType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM PRICE_TYPES WHERE PRICE_TYPE_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllDormStatuses = async (req: Request, res: Response) => {
  try {
    const [rows] = await dbcon.execute<RowDataPacket[]>("SELECT DORM_STATUS_ID as id, DORM_STATUS_NAME as name FROM DORM_STATUSES");
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addDormStatus = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });
    const [result] = await dbcon.execute<any>("INSERT INTO DORM_STATUSES (DORM_STATUS_NAME) VALUES (?)", [name]);
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteDormStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM DORM_STATUSES WHERE DORM_STATUS_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const addDormZone = async (req: Request, res: Response) => {
  try {
    const { name, lat, lng } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Zone name is required" });
    
    // Default coordinates if not provided (Bangkok defaults)
    const latitude = lat !== undefined && lat !== null && lat !== '' ? Number(lat) : 13.7563;
    const longitude = lng !== undefined && lng !== null && lng !== '' ? Number(lng) : 100.5018;

    const [result] = await dbcon.execute<any>(
      "INSERT INTO DORM_ZONES (ZONE_NAME, COORDINATES) VALUES (?, ST_GeomFromText(?))", 
      [name, `POINT(${latitude} ${longitude})`]
    );
    res.json({ success: true, message: "Added successfully", id: result.insertId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteDormZone = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbcon.execute("DELETE FROM DORM_ZONES WHERE ZONE_ID = ?", [id]);
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
export const getFacilityRequests_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  try {
    const sql = `SELECT * FROM FACILITIES_TYPES WHERE STATUS = 1`;
    const [facs] = await conn.query<RowDataPacket[]>(sql);
    return res.status(200).json({ success: true, data: facs });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
  } finally {
    conn.release();
  }
};

export const approveFacilityRequest_api = async (
  req: Request,
  res: Response,
) => {
  const conn = await dbcon.getConnection();
  const fac_id = req.params.fac_id as string;
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE FACILITIES_TYPES SET STATUS = 2 WHERE FAC_TYPE_ID = ?`,
      [fac_id],
    );
    await conn.execute(
      `UPDATE FACILITIES_DORMS SET STATUS = 1 WHERE FAC_TYPE_ID = ?`,
      [fac_id],
    );
    await conn.commit();
    return res.status(200).json({ success: true, message: "อนุมัติสำเร็จ" });
  } catch (error: any) {
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอนุมัติ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const rejectFacilityRequest_api = async (
  req: Request,
  res: Response,
) => {
  const conn = await dbcon.getConnection();
  const fac_id = req.params.fac_id as string;
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM FACILITIES_DORMS WHERE FAC_TYPE_ID = ?`, [
      fac_id,
    ]);
    await conn.execute(`DELETE FROM FACILITIES_TYPES WHERE FAC_TYPE_ID = ?`, [
      fac_id,
    ]);
    await conn.commit();
    return res
      .status(200)
      .json({ success: true, message: "ปฏิเสธคำร้องขอสำเร็จ" });
  } catch (error: any) {
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการปฏิเสธคำร้องขอ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const deleteFacility_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  const fac_id = req.params.fac_id as string;
  try {
    // ดึงข้อมูลรูปภาพก่อนจะลบ
    const [facRows] = await conn.execute<RowDataPacket[]>(
      `SELECT FAC_TYPE_ICON FROM FACILITIES_TYPES WHERE FAC_TYPE_ID = ?`,
      [fac_id]
    );

    await conn.beginTransaction();
    await conn.execute(`DELETE FROM FACILITIES_DORMS WHERE FAC_TYPE_ID = ?`, [
      fac_id,
    ]);
    await conn.execute(`DELETE FROM FACILITIES_TYPES WHERE FAC_TYPE_ID = ?`, [
      fac_id,
    ]);
    await conn.commit();

    // ลบรูปออกจาก Storage หลังจากลบในฐานข้อมูลเสร็จแล้ว
    if (facRows.length > 0 && facRows[0]!.FAC_TYPE_ICON) {
      await deleteFromGCS(facRows[0]!.FAC_TYPE_ICON);
    }
    return res
      .status(200)
      .json({ success: true, message: "ลบสิ่งอำนวยความสะดวกสำเร็จ" });
  } catch (error: any) {
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};


export const updateMasterType = async (req: Request, res: Response) => {
  try {
    const { type, id } = req.params;
    const { name, lat, lng } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Type name is required" });

    let query = "";
    let params: any[] = [];

    switch (type) {
      case 'bed':
        query = "UPDATE BED_TYPES SET BED_TYPE_NAME = ? WHERE BED_TYPE_ID = ?";
        params = [name, id];
        break;
      case 'dorm':
        query = "UPDATE DORM_TYPES SET DORM_TYPE_NAME = ? WHERE DORM_TYPE_ID = ?";
        params = [name, id];
        break;
      case 'status':
        query = "UPDATE DORM_STATUSES SET DORM_STATUS_NAME = ? WHERE DORM_STATUS_ID = ?";
        params = [name, id];
        break;
      case 'price':
        query = "UPDATE PRICE_TYPES SET PRICE_TYPE_NAME = ? WHERE PRICE_TYPE_ID = ?";
        params = [name, id];
        break;
      case 'room':
        query = "UPDATE ROOM_TYPES SET ROOM_TYPE_NAME = ? WHERE ROOM_TYPE_ID = ?";
        params = [name, id];
        break;
      case 'zone':
        const latitude = lat !== undefined && lat !== null && lat !== '' ? Number(lat) : 13.7563;
        const longitude = lng !== undefined && lng !== null && lng !== '' ? Number(lng) : 100.5018;
        query = "UPDATE DORM_ZONES SET ZONE_NAME = ?, COORDINATES = ST_GeomFromText(?) WHERE ZONE_ID = ?";
        params = [name, `POINT(${latitude} ${longitude})`, id];
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid type" });
    }

    await dbcon.execute(query, params);
    res.json({ success: true, message: "Updated successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};
