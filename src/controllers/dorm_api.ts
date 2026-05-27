// controllers/dorm_api.ts
import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { deleteFolder, deleteFromGCS, fileUpload } from "./uploads";
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
} from "../models/dorm.model";
import { User } from "../models/user.model";

export type MulterFiles = {
  [fieldname: string]: Express.Multer.File[];
};

export const getAllDorms = async (req: Request, res: Response) => {
  try {
    const { search, zone, minPrice, maxPrice, lat, lng, radius } = req.query;
    const trimmedSearch = search ? search.toString().trim() : '';

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
                COALESCE(MIN(rp.PRICE), 0) as start_price,
                d.DORM_STATUS_ID as status
            FROM DORMITORIES d
            LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
            LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
            LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
            WHERE d.DORM_STATUS_ID in (1, 3)
        `;

    const params: any[] = [];

    if (trimmedSearch) {
      sql += ` AND (d.DORM_NAME LIKE ? OR dz.ZONE_NAME LIKE ?) `;
      params.push(`%${trimmedSearch}%`, `%${trimmedSearch}%`);
    }

    if (zone && zone !== '' && zone !== 'null' && zone !== 'undefined') {
      sql += ` AND d.ZONE_ID = ? `;
      params.push(Number(zone));
    }

    if (lat && lng && radius && lat !== 'null' && lng !== 'null' && radius !== 'null') {
      sql += ` AND ST_Distance_Sphere(POINT(ST_Y(d.COORDINATES), ST_X(d.COORDINATES)), POINT(?, ?)) <= ? `;
      params.push(Number(lng), Number(lat), Number(radius) * 1000);
    }

    // Comprehensive GROUP BY for strict mode compatibility
    sql += ` GROUP BY d.DORM_ID, d.DORM_NAME, d.ADDRESS, d.SCORE, d.FRONT_DORM_IMAGE, d.UPDATE_AT, dz.ZONE_NAME, d.COORDINATES, d.DORM_STATUS_ID `;

    const havingClauses = [];
    if (minPrice !== undefined && minPrice !== null && minPrice !== '' && minPrice !== 'null' && minPrice !== 'undefined') {
      havingClauses.push(`COALESCE(MIN(rp.PRICE), 0) >= ?`);
      params.push(Number(minPrice));
    }
    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '' && maxPrice !== 'null' && maxPrice !== 'undefined') {
      havingClauses.push(`COALESCE(MIN(rp.PRICE), 0) <= ?`);
      params.push(Number(maxPrice));
    }

    if (havingClauses.length > 0) {
      sql += ` HAVING ` + havingClauses.join(" AND ");
    }

    sql += ` ORDER BY d.UPDATE_AT DESC `;

    const [dorms] = await dbcon.query<DormSummary[]>(sql, params);
    res.json({ success: true, data: dorms });
  } catch (error) {
    console.error("Error in getAllDorms:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดภายในระบบ" });
  }
};

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
        d.ADDRESS,
        d.FRONT_DORM_IMAGE, 
        
        dz.ZONE_NAME,
        COALESCE(MIN(rp.PRICE), 0) AS start_price,

        do.FIRST_NAME,
        do.LAST_NAME,
        u.EMAIL,
        u.PHONE_NUMBER

      FROM DORMITORIES d
      LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
      LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
      LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
      LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
      
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
    res
      .status(500)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในระบบ",
        error: error.message,
      });
  }
};
// --- 2. ดูรายละเอียดหอพัก 1 แห่ง (อัปเดตใหม่ ทนทานต่อการดึงรัวๆ) ---
export const getDormById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const sqlMain = `
            SELECT 
                d.*, 
                ST_X(d.COORDINATES) as lat, 
                ST_Y(d.COORDINATES) as lng,
                dz.ZONE_NAME,
                do.FIRST_NAME, 
                do.LAST_NAME, 
                do.LINE as OWNER_LINE,
                do.FACEBOOK as OWNER_FACEBOOK,
                do.INSTAGRAM as OWNER_INSTAGRAM,
                do.TELEGRAM as OWNER_TELEGRAM,
                do.X as OWNER_X,
                u.PHONE_NUMBER as OWNER_PHONE 
            FROM DORMITORIES d
            LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
            LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
            LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
            WHERE d.DORM_ID = ?
        `;

    const [dormInfo] = await dbcon.query<RowDataPacket[]>(sqlMain, [id]);
    if (dormInfo.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพัก" });
    }
    const mainData = dormInfo[0] as RowDataPacket;

    const [images] = await dbcon.query<RowDataPacket[]>(
      "SELECT IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
      [id],
    );

    const [facilitiesData] = await dbcon.query<RowDataPacket[]>(
      `SELECT ft.FAC_TYPE_NAME FROM FACILITIES_DORMS fd JOIN FACILITIES_TYPES ft ON fd.FAC_TYPE_ID = ft.FAC_TYPE_ID WHERE fd.DORM_ID = ?`,
      [id],
    );
    const facilitiesList = facilitiesData.map((f: any) => f.FAC_TYPE_NAME);

    // ✅ แก้ไข: ดึงข้อมูลห้องพักให้ครบถ้วน (รายเดือน, รายเทอม, ประเภทเตียง)
    const [rooms] = await dbcon.query<RowDataPacket[]>(
      `
        SELECT 
            dr.DORM_ROOM_ID,
            rt.ROOM_TYPE_ID,
            rt.ROOM_TYPE_NAME, 
            MAX(CASE WHEN rp.PRICE_TYPE_ID = 1 THEN rp.PRICE END) as perMonth,
            MAX(CASE WHEN rp.PRICE_TYPE_ID = 2 THEN rp.PRICE END) as perTerm,
            rb.BED_TYPE_ID
        FROM DORM_ROOMS dr
        JOIN ROOM_TYPES rt ON dr.ROOM_TYPE_ID = rt.ROOM_TYPE_ID
        LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
        LEFT JOIN ROOM_BEDS rb ON dr.DORM_ROOM_ID = rb.DORM_ROOM_ID
        WHERE dr.DORM_ID = ?
        GROUP BY dr.DORM_ROOM_ID, rt.ROOM_TYPE_ID, rt.ROOM_TYPE_NAME, rb.BED_TYPE_ID
      `,
      [id],
    );

    const minPrice =
      rooms.length > 0
        ? Math.min(...rooms.map((r: any) => r.perMonth || 0))
        : mainData.start_price || 0;

    const responseData = {
      ...mainData,
      DORM_NAME: mainData.DORM_NAME,
      image: mainData.FRONT_DORM_IMAGE,
      address: mainData.ADDRESS,
      start_price: minPrice,
      phone: mainData.OWNER_PHONE || "-",
      line: mainData.OWNER_LINE || "-",
      facebook: mainData.OWNER_FACEBOOK || "-",
      instagram: mainData.OWNER_INSTAGRAM || "-",
      telegram: mainData.OWNER_TELEGRAM || "-",
      x: mainData.OWNER_X || "-",
      facilities: facilitiesList,
      gallery: images.map((img: any) => img.IMAGE_PATH),
      // ✅ ส่งข้อมูลห้องที่ดึงมาใหม่กลับไปให้ครบ
      rooms: rooms.map((r: any) => ({
        ROOM_TYPE_ID: r.ROOM_TYPE_ID,
        ROOM_TYPE_NAME: r.ROOM_TYPE_NAME,
        PRICE: r.perMonth || 0,
        perTerm: r.perTerm || 0,
        bedType: r.BED_TYPE_ID === 2 ? "Double Bed" : "Single Bed",
      })),
    };

    res.json({ success: true, data: responseData });
  } catch (error: any) {
    console.error("!!! Error in getDormById !!!", error);
    return res
      .status(500)
      .json({
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
      return res
        .status(200)
        .json({
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
    return res
      .status(400)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดภายในระบบ",
        error: error.message,
      });
  } finally {
    conn.release();
  }
};

export const createDorm_api = async (req: Request, res: Response) => {
  const {
    owner_id,
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
  let roomTypesArr: DormRoomTypeReqPostReq[] = [];
  try {
    facilitiesArr = JSON.parse(facilities || "[]");
    roomTypesArr = JSON.parse(roomTypes || "[]");
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: "ข้อมูลสิ่งอำนวยความสะดวกหรือประเภทห้องพักไม่ถูกต้อง",
    });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    const mainImgTasks = [];
    if (files["FRONT_DORM_IMG"]?.[0]) {
      mainImgTasks.push(
        fileUpload(
          files["FRONT_DORM_IMG"][0],
          "dorms",
          `${name}_${owner_id}`,
          null,
          "FRONT_DORM_IMG",
        ).then((url) => ({ key: "FRONT_DORM_IMG", url })),
      );
    }
    if (files["LICENSE_IMG"]?.[0]) {
      mainImgTasks.push(
        fileUpload(
          files["LICENSE_IMG"][0],
          "dorms",
          `${name}_${owner_id}`,
          null,
          "LICENSE_IMG",
        ).then((url) => ({ key: "LICENSE_IMG", url })),
      );
    }

    const mainImgs = await Promise.all(mainImgTasks);
    const frontUrl =
      mainImgs.find((x) => x.key === "FRONT_DORM_IMG")?.url || "";
    const licenseUrl = mainImgs.find((x) => x.key === "LICENSE_IMG")?.url || "";

    const sqlDorm = `
            INSERT INTO DORMITORIES 
            (DORM_OWNER_ID, DORM_NAME, ADDRESS, COORDINATES, ZONE_ID, DORM_TYPE_ID, 
             WATER_UNIT, WATER_LUMP, ELECT_UNIT, FRONT_DORM_IMAGE, DORM_LICENSE, ADD_DORM_DATA)
            VALUES (?, ?, ?, ST_GeomFromText(?), ?, ?, ?, ?, ?, ?, ?, ?)
        `;
    const pointStr = `POINT(${lat} ${lng})`;

    const [dormResult] = await conn.execute<ResultSetHeader>(sqlDorm, [
      owner_id,
      name,
      address,
      pointStr,
      zone_id,
      type_id,
      water_unit,
      water_lump,
      elect_unit,
      frontUrl,
      licenseUrl,
      detail,
    ]);
    const dormId = dormResult.insertId;

    if (facilitiesArr.length > 0) {
      const facValues = facilitiesArr.map((facId) => [dormId, facId]);
      for (const facId of facilitiesArr) {
        await conn.execute(
          `INSERT IGNORE INTO FACILITIES_DORMS (DORM_ID, FAC_TYPE_ID) VALUES (?, ?)`,
          [dormId, facId],
        );
      }
    }

    if (files["OTHER_IMG"] && files["OTHER_IMG"].length > 0) {
      const otherTasks = files["OTHER_IMG"].map((file, idx) =>
        fileUpload(
          file,
          "dorms",
          `${name}_${owner_id}`,
          "other_imgs",
          `other_${idx}`,
        ),
      );
      const otherUrls = await Promise.all(otherTasks);

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

    const roomUploadTasks = [];

    for (const [field, typeId] of Object.entries(roomImgFieldMap)) {
      if (files[field]?.[0]) {
        roomUploadTasks.push(
          fileUpload(
            files[field][0],
            "dorms",
            `${name}_${owner_id}`,
            "room_imgs",
            field,
          ).then((url) => ({ typeId, url })),
        );
      }
    }
    const uploadedRoomImgs = await Promise.all(roomUploadTasks);

    const getBedId = async (name: string): Promise<number> => {
      const n = name.toLowerCase();
      if (n.includes("single")) return 1;
      if (n.includes("double")) return 2;
      return 1;
    };

    // ✅ จุดที่ 1: ปรับการบันทึกห้องพักใหม่ให้เชื่อมกับตาราง DORM_ROOMS
    for (const room of roomTypesArr) {
      // 1. หาว่ามีประเภทห้องนี้ในระบบหรือยัง ถ้ายังให้สร้างใหม่
      let roomTypeId;
      const [existingRt] = await conn.execute<RowDataPacket[]>(
        `SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE ROOM_TYPE_NAME = ?`,
        [room.roomType],
      );

      if (existingRt.length > 0) {
        roomTypeId = existingRt[0]!.ROOM_TYPE_ID;
      } else {
        const [rtResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)`,
          [room.roomType],
        );
        roomTypeId = rtResult.insertId;
      }

      // 2. สร้างความสัมพันธ์ในตาราง DORM_ROOMS
      const [drResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO DORM_ROOMS (DORM_ID, ROOM_TYPE_ID) VALUES (?, ?)`,
        [dormId, roomTypeId],
      );
      const dormRoomId = drResult.insertId;

      // 3. เพิ่มราคาใน ROOM_PRICES (ใช้ DORM_ROOM_ID เป็นตัวอ้างอิง)
      if (room.perMonth) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)`,
          [dormRoomId, room.perMonth],
        );
      }
      if (room.perTerm) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)`,
          [dormRoomId, room.perTerm],
        );
      }

      // 4. เพิ่มประเภทเตียงใน ROOM_BEDS
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
    res.status(201).json({
      success: true,
      message: "ลงทะเบียนหอพักสำเร็จ",
      dormId,
    });
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
  const { id } = req.params;
  const dormId = Number(id);
  const body = req.body;
  const files = req.files as MulterFiles;

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();
    const [dormData] = await getDormById_fn(dormId, conn);
    if (!dormData) return res.status(400).json("Dorm not found");
    const ownerId = dormData.DORM_OWNER_ID;
    await updateDormInfo_fn(dormId, body, files, conn, ownerId);

    if (body.facilities) {
      await updateFacilities_fn(dormId, body.facilities, conn);
    }

    if (body.roomTypes) {
      await updateRoomTypes_fn(dormId, body.roomTypes, conn);
    }

    await updateRoomComponentImages_fn(dormId, body.name, files, conn, ownerId);

    await updateGalleryImages_fn(dormId, body.name, files, ownerId, conn);

    await conn.commit();
    res.json({ success: true, message: "อัปเดตข้อมูลหอพักสำเร็จ" });
  } catch (error: any) {
    await conn.rollback();
    console.error("Update Error:", error);
    res
      .status(500)
      .json({
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
  files: MulterFiles,
  conn: PoolConnection,
  ownerId: number,
) => {
  let sql = "UPDATE DORMITORIES SET UPDATE_AT = CURRENT_DATE()";
  const params: any[] = [];
  const [oldData] = await conn.execute<RowDataPacket[]>(
    "SELECT FRONT_DORM_IMAGE, DORM_LICENSE FROM DORMITORIES WHERE DORM_ID = ?",
    [dormId],
  );

  // ✅ แก้ไข: เช็ค !== undefined เพื่อป้องกันเลข 0 ถูกมองว่าเป็นค่าว่าง
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

  if (files["FRONT_DORM_IMG"]?.[0]) {
    if (oldData[0]?.FRONT_DORM_IMAGE)
      await deleteFromGCS(oldData[0].FRONT_DORM_IMAGE);
    const url = await fileUpload(
      files["FRONT_DORM_IMG"][0],
      "dorms",
      `${data.name}_${ownerId}`,
      null,
      "FRONT_DORM_IMG",
    );
    sql += ", FRONT_DORM_IMAGE = ?";
    params.push(url);
  }

  if (files["LICENSE_IMG"]?.[0]) {
    if (oldData[0]?.DORM_LICENSE) await deleteFromGCS(oldData[0].DORM_LICENSE);
    const url = await fileUpload(
      files["LICENSE_IMG"][0],
      "dorms",
      `${data.name}_${ownerId}`,
      null,
      "LICENSE_IMG",
    );
    sql += ", DORM_LICENSE = ?";
    params.push(url);
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
  conn: PoolConnection
) => {
  const getBedId = (name: string): number => {
    // ป้องกันกรณี name เป็น null/undefined
    const n = name?.toString().toLowerCase() || '';
    if (n.includes("single") || n === "1") return 1;
    if (n.includes("double") || n === "2") return 2;
    return 1;
  };

  let roomTypes: RoomTypeItem[] = [];
  try {
    roomTypes = JSON.parse(roomTypesJson);
  } catch (e) {
    return;
  }

  // ป้องกันกรณีไม่มีข้อมูลส่งมา
  if (!roomTypes || roomTypes.length === 0) return;

  // 1. ค้นหา DORM_ROOM_ID ของหอพักนี้ทั้งหมด เพื่อเตรียมล้างข้อมูลเก่า
  const [existingDormRooms] = await conn.execute<RowDataPacket[]>(
    "SELECT DORM_ROOM_ID FROM DORM_ROOMS WHERE DORM_ID = ?", [dormId]
  );
  
  const dormRoomIds = existingDormRooms.map((r: any) => r.DORM_ROOM_ID);

  // 2. เคลียร์ข้อมูลลูก (ราคา และ เตียง) และข้อมูลความสัมพันธ์เก่าทิ้ง
  if (dormRoomIds.length > 0) {
    const placeholders = dormRoomIds.map(() => "?").join(",");
    await conn.execute(`DELETE FROM ROOM_PRICES WHERE DORM_ROOM_ID IN (${placeholders})`, dormRoomIds);
    await conn.execute(`DELETE FROM ROOM_BEDS WHERE DORM_ROOM_ID IN (${placeholders})`, dormRoomIds);
    await conn.execute(`DELETE FROM DORM_ROOMS WHERE DORM_ID = ?`, [dormId]);
  }

  // 🌟 ใช้ Set เพื่อจำไว้ว่าเราเพิ่มห้องชื่อนี้ไปหรือยัง (ป้องกัน Error 500 ชื่อห้องซ้ำ)
  const insertedRoomTypeIds = new Set<number>();

  // 3. สร้างโครงสร้างห้องพักเข้าไปใหม่
  for (const room of roomTypes) {
    if (!room.roomType || room.roomType.trim() === '') continue; // ข้ามถ้าไม่ได้กรอกชื่อห้อง

    let roomTypeId;
    
    // เช็คว่ามีชื่อห้องนี้อยู่ในระบบภาพรวมหรือยัง
    const [existingRt] = await conn.execute<RowDataPacket[]>(
      `SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE ROOM_TYPE_NAME = ?`, [room.roomType.trim()]
    );
    
    if (existingRt.length > 0) {
      roomTypeId = existingRt[0]!.ROOM_TYPE_ID;
    } else {
      const [rtResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO ROOM_TYPES (ROOM_TYPE_NAME) VALUES (?)`, [room.roomType.trim()]
      );
      roomTypeId = rtResult.insertId;
    }

    // 🌟 พระเอกอยู่ตรงนี้: ถ้าเพิ่มห้องประเภทนี้ไปแล้ว (ป้องกัน Duplicate Entry DB พัง) ให้ข้ามเลย
    if (insertedRoomTypeIds.has(roomTypeId)) {
      continue; 
    }
    insertedRoomTypeIds.add(roomTypeId);

    // สร้างสะพานเชื่อมระหว่าง หอพัก <-> ประเภทห้อง
    const [drResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO DORM_ROOMS (DORM_ID, ROOM_TYPE_ID) VALUES (?, ?)`, [dormId, roomTypeId]
    );
    const dormRoomId = drResult.insertId;

    // เพิ่มราคา (อ้างอิงด้วย DORM_ROOM_ID)
    if (room.perMonth) {
      await conn.execute(`INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)`, [dormRoomId, room.perMonth]);
    }
    if (room.perTerm) {
      await conn.execute(`INSERT INTO ROOM_PRICES (DORM_ROOM_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)`, [dormRoomId, room.perTerm]);
    }

    // เพิ่มประเภทเตียง (อ้างอิงด้วย DORM_ROOM_ID)
    const bedTypeId = getBedId(room.bedType);
    await conn.execute(`INSERT INTO ROOM_BEDS (DORM_ROOM_ID, BED_TYPE_ID) VALUES (?, ?)`, [dormRoomId, bedTypeId]);
  }
};

export const updateRoomComponentImages_fn = async (
  dormId: number,
  dormName: string,
  files: MulterFiles,
  conn: PoolConnection,
  ownerId: number,
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

  const uploadTasks = [];

  for (const keyword of keywords) {
    if (files[keyword] && files[keyword][0]) {
      const oldImgs = existingImages.filter(
        (img: any) => img.IMAGE_PATH && img.IMAGE_PATH.includes(keyword),
      );
      for (const old of oldImgs) {
        await deleteFromGCS(old.IMAGE_PATH);
        await conn.execute("DELETE FROM DORM_IMAGES WHERE DORM_IMG_ID = ?", [
          old.DORM_IMG_ID,
        ]);
      }

      uploadTasks.push(
        fileUpload(
          files[keyword][0],
          "dorms",
          `${dormName}_${ownerId}`,
          "room_imgs",
          keyword,
        ).then((url) => ({ url })),
      );
    }
  }

  const results = await Promise.all(uploadTasks);
  for (const res of results) {
    await conn.execute(
      "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
      [dormId, res.url],
    );
  }
};

export const updateGalleryImages_fn = async (
  dormId: number,
  dormName: string,
  files: MulterFiles,
  ownerId: number,
  conn: PoolConnection,
) => {
  if (!files["OTHER_IMG"] || files["OTHER_IMG"].length === 0) return;

  const newFiles = files["OTHER_IMG"];

  const [allImages] = await conn.execute<RowDataPacket[]>(
    "SELECT DORM_IMG_ID, IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
    [dormId],
  );

  for (const [i, file] of newFiles.entries()) {
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

    const newUrl = await fileUpload(
      file,
      "dorms",
      `${dormName}_${ownerId}`,
      "other_imgs",
      keyword,
    );

    await conn.execute(
      "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
      [dormId, newUrl],
    );
  }
};

export const removeDorm_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  const conn = await dbcon.getConnection();

  try {
    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET DORM_STATUS_ID = 2 WHERE DORM_ID = ?",
      [id],
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพักนี้ในระบบ" });
    }

    res.json({
      success: true,
      message: "สถานะหอพักถูกเปลี่ยนเป็นถูกลบ",
    });
  } catch (error: any) {
    console.error("Remove Dorm Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบหอพัก",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

export const restoreDorm_api = async (req: Request, res: Response) => {
  const { id } = req.params;
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
    return res
      .status(400)
      .json({ success: false, message: "ข้อมูลไม่ครบถ้วน" });
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
  const { id } = req.params;
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
  const { id } = req.params;

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
                    ds.DORM_STATUS_NAME, 
                    dz.ZONE_NAME,
                    COALESCE(MIN(rp.PRICE), 0) AS start_price 
                FROM DORMITORIES d
                LEFT JOIN DORM_STATUSES ds ON d.DORM_STATUS_ID = ds.DORM_STATUS_ID
                LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
                LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
                LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
                WHERE d.DORM_OWNER_ID = ?
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
    res
      .status(500)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก",
        error: error.message,
      });
  }
};

export const getReviewsByDormId_api = async (req: Request, res: Response) => {
  const { id } = req.params;

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
    res
      .status(500)
      .json({
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
    res
      .status(500)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลเจ้าของหอพักที่รอการอนุมัติ",
        error: error.message,
      });
  }
};

export const getPopularDorms_api = async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 6;

    // ✅ แก้ไข: เปลี่ยนไป JOIN กับตาราง DORM_ROOMS
    const sql = `
              SELECT 
                  d.DORM_ID, 
                  d.DORM_NAME, 
                  d.ADDRESS,
                  d.SCORE,
                  d.FRONT_DORM_IMAGE as image, 
                  d.VIEW_COUNT,
                  dz.ZONE_NAME,
                  COALESCE(MIN(rp.PRICE), 0) as start_price,
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
    res
      .status(500)
      .json({
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
      `SELECT u.EMAIL, d.DORM_NAME 
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

    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET REQ_STATUS = ?, UPDATE_AT = CURRENT_DATE() WHERE DORM_ID = ?;",
      [data.status, data.dormId],
    );

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
      
      WHERE d.REQ_STATUS = 0  
      ORDER BY d.REG_AT ASC   
    `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql);
    res.json({
      data: dorms,
    });
  } catch (error: any) {
    console.error(
      "เกิดข้อผิดพลาดในการดึงข้อมูลคำร้องขอหอพักที่รอการอนุมัติ:",
      error,
    );
    res
      .status(500)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลคำร้องขอหอพักที่รอการอนุมัติ",
        error: error.message,
      });
  }
};

export const getFacilities_api = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  try {
    const sql = `SELECT * FROM FACILITIES_TYPES`;

    const [facs] = await conn.query<RowDataPacket[]>(sql);
    if (facs.length > 0) {
      return res.status(200).json(facs);
    } else {
      return res.status(404).json("ไม่พบข้อมูลสิ่งอำนวยความสะดวกในระบบ");
    }
  } catch (error: any) {
    res.status(500).json({ message: "Server Error", error: error.message });
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
    WHERE FD.DORM_ID = ?`;

    const [facs] = await conn.query<FacOfDormGetRes[]>(sql, [Number(dorm_id)]);
    if (facs.length > 0) {
      return res.status(200).json(facs);
    } else {
      return res.status(404).json("ไม่พบข้อมูลสิ่งอำนวยความสะดวกในระบบ");
    }
  } catch (error: any) {
    res
      .status(500)
      .json({
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
    res
      .status(500)
      .json({
        message: "เกิดข้อผิดพลาดในการอัปเดตสิ่งอำนวยความสะดวก",
        error: error.message,
      });
  } finally {
    conn.release();
  }
};
