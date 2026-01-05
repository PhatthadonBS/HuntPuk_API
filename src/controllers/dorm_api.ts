// controllers/dorm_api.ts
import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { DormRegPostReq } from "../models/requests/dorm_reg_post_req";
import { deleteFolder, deleteFromGCS, fileUpload } from "./uploads";
import { getUser, getUsers_fn, resMailSender_fn } from "./user_api";
import { PoolConnection } from "mysql2/promise";
import { DormRoomImgTypeGetRes } from "../models/responses/dorm_roomImgType_get_res";
import { DormRoomTypeReqPostReq } from "../models/requests/dorm_roomTypeReq_post_req";
import { RoomTypeItem } from "../models/requests/RoomTypeItem";
import { User } from "../models/responses/user_data_get_res";
import { DormDataGetRes } from "../models/responses/dorm_data_get_res";
import { FacOfDormGetRes } from "../models/responses/fac_ofDorm_get_res";

export type MulterFiles = {
  [fieldname: string]: Express.Multer.File[];
};

export const getAllDorms = async (req: Request, res: Response) => {
  try {
    const { search, zone, minPrice, maxPrice } = req.query;

    // 1. Base Query (ตัด GROUP BY และ ORDER BY ออกไปก่อน)
    let sql = `
            SELECT 
                d.DORM_ID, 
                d.DORM_NAME, 
                d.ADDRESS, 
                d.SCORE, 
                d.FRONT_DORM_IMAGE as image, 
                dz.ZONE_NAME as zone, 
                ST_X(d.COORDINATES) as lat, 
                ST_Y(d.COORDINATES) as lng, 
                COALESCE(MIN(rp.PRICE), 0) as start_price
            FROM DORMITORIES d
            LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
            LEFT JOIN DORM_ROOMS dr ON d.DORM_ID = dr.DORM_ID
            LEFT JOIN ROOM_PRICES rp ON dr.DORM_ROOM_ID = rp.DORM_ROOM_ID
            WHERE d.DORM_STATUS_ID = 1
        `;

    const params: any[] = [];

    // 2. ต่อ WHERE Condition (Search & Zone)
    if (search) {
      sql += ` AND (d.DORM_NAME LIKE ? OR dz.ZONE_NAME LIKE ?) `;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (zone) {
      sql += ` AND dz.ZONE_NAME = ? `;
      params.push(zone);
    }

    // 3. ต่อ GROUP BY (ต้องมาหลัง WHERE เสมอ)
    sql += ` GROUP BY d.DORM_ID, dz.ZONE_NAME `;

    // 4. ต่อ HAVING (Price Range)
    const havingClauses = [];
    if (minPrice) {
      havingClauses.push(`start_price >= ?`);
      params.push(Number(minPrice));
    }
    if (maxPrice) {
      havingClauses.push(`start_price <= ?`);
      params.push(Number(maxPrice));
    }

    if (havingClauses.length > 0) {
      sql += ` HAVING ` + havingClauses.join(" AND ");
    }

    // 5. ต่อ ORDER BY (ต้องอยู่ท้ายสุดเสมอ)
    sql += ` ORDER BY d.UPDATE_AT DESC `;

    const [dorms] = await dbcon.query<RowDataPacket[]>(sql, params);
    res.json({ success: true, data: dorms });
  } catch (error) {
    console.error("Error in getAllDorms:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function getDormById_fn(did: number, conn: PoolConnection) {
  try {
    const [dorm] = await conn.execute<DormDataGetRes[]>(
      "SELECT * FROM DORMITORIES WHERE DORM_ID = ?",
      [Number(did)]
    );
    if (dorm.length > 0) return dorm;
    return [];
  } catch (error) {
    throw error;
  }
}

export const getAllDorms_Admin = async (req: Request, res: Response) => {
  try {
    const sql = `
      SELECT 
        d.DORM_ID, 
        d.DORM_NAME, 
        d.DORM_STATUS_ID,
        d.ADDRESS,
        d.FRONT_DORM_IMAGE, 
        
        -- 1. ข้อมูลชื่อ จากตาราง DORM_OWNERS (do)
        do.FIRST_NAME,
        do.LAST_NAME,
        
        -- 2. ข้อมูลติดต่อ จากตาราง USERS (u)
        u.EMAIL,
        u.PHONE_NUMBER

      FROM DORMITORIES d
      -- Join หาเจ้าของหอ
      LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
      -- ✅ ต้อง Join USERS ด้วย เพื่อเอา Email และ Phone
      LEFT JOIN USERS u ON do.USER_ID = u.USER_ID
      
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
      .json({ success: false, message: "Server Error", error: error.message });
  }
};
// --- 2. ดูรายละเอียดหอพัก 1 แห่ง (แก้ไข JOIN USERS เพื่อเอาเบอร์โทร) ---
export const getDormById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const conn = await dbcon.getConnection();

  try {
    // ✅ แก้ไข SQL: JOIN ตาราง USERS เพื่อดึง PHONE_NUMBER
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
                u.PHONE_NUMBER as OWNER_PHONE  -- ดึงเบอร์จากตาราง USERS
            FROM DORMITORIES d
            LEFT JOIN DORM_OWNERS do ON d.DORM_OWNER_ID = do.DORM_OWNER_ID
            LEFT JOIN USERS u ON do.USER_ID = u.USER_ID  -- ✅ เพิ่ม JOIN นี้
            LEFT JOIN DORM_ZONES dz ON d.ZONE_ID = dz.ZONE_ID
            WHERE d.DORM_ID = ?
        `;

    const [dormInfo] = await conn.query<RowDataPacket[]>(sqlMain, [id]);

    if (dormInfo.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหอพัก" });
    }

    const mainData = dormInfo[0] as RowDataPacket;

    // 2.2 ดึงรูปภาพแกลลอรี่
    const [images] = await conn.query<RowDataPacket[]>(
      "SELECT IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
      [id]
    );

    // 2.3 ดึงสิ่งอำนวยความสะดวก
    const [facilitiesData] = await conn.query<RowDataPacket[]>(
      `
            SELECT ft.FAC_TYPE_NAME 
            FROM FACILITIES_DORMS fd
            JOIN FACILITIES_TYPES ft ON fd.FAC_TYPE_ID = ft.FAC_TYPE_ID
            WHERE fd.DORM_ID = ?
        `,
      [id]
    );

    const facilitiesList = facilitiesData.map((f: any) => f.FAC_TYPE_NAME);

    // 2.4 ดึงข้อมูลห้องพักและราคา
    const [rooms] = await conn.query<RowDataPacket[]>(
      `
            SELECT rt.ROOM_TYPE_NAME, rp.PRICE
            FROM ROOM_TYPES rt
            JOIN ROOM_PRICES rp ON rt.ROOM_TYPE_ID = rp.ROOM_TYPE_ID
            WHERE rt.DORM_ID = ?
        `,
      [id]
    );

    // หาราคาต่ำสุด
    const minPrice =
      rooms.length > 0
        ? Math.min(...rooms.map((r: any) => r.PRICE))
        : mainData.start_price || 0;

    // ✅ สร้าง Object ตอบกลับ
    const responseData = {
      ...mainData,

      DORM_NAME: mainData.DORM_NAME,
      image: mainData.FRONT_DORM_IMAGE,
      address: mainData.ADDRESS,
      start_price: minPrice,

      // ใช้ค่าที่ดึงมาจาก JOIN
      phone: mainData.OWNER_PHONE || "-",
      line: mainData.OWNER_LINE || "-",

      facilities: facilitiesList,
      gallery: images.map((img: any) => img.IMAGE_PATH),
      rooms: rooms,
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error: any) {
    console.error("!!! Error in getDormById !!!", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error: " + error.message });
  } finally {
    conn.release();
  }
};

export const getAllZones = async (req: Request, res: Response) => {
  try {
    const sql = `SELECT * FROM DORM_ZONES ORDER BY ZONE_ID ASC`;
    const [zones] = await dbcon.query<RowDataPacket[]>(sql);
    res.json({ success: true, data: zones });
  } catch (error) {
    console.error("Error in getAllZones:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const addFacility_api = async (req: Request, res: Response) => {
  const { fac_name, uid } = req.body;

  const file = req.file;
  const conn = await dbcon.getConnection();
  let icon_url = null;
  if (!file || !fac_name || !uid)
    return res.status(400).json("not enough data");

  try {
    const user = await (await getUsers_fn()).filter((u) => u.USER_ID == uid);
    if (user.length < 1) return res.status(404).json("user notfound");

    const [limitAdd] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(ADD_BY) count FROM FACILITIES_TYPES WHERE ADD_BY = ?",
      [uid]
    );

    if (limitAdd[0]!["count"] >= 3)
      return res.status(200).json("u have limit for add facility");

    const [dupFac] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(FAC_TYPE_NAME) count FROM FACILITIES_TYPES WHERE FAC_TYPE_NAME = ?",
      [fac_name]
    );

    if (dupFac[0]!["count"] > 0)
      return res.status(200).json("duplicate facility name");
    icon_url = await fileUpload(
      file,
      "users",
      `${user[0]?.USERNAME}_${user[0]?.USER_ID}`,
      "icons",
      fac_name
    );

    conn.beginTransaction();
    const [result] = await conn.execute<ResultSetHeader>(
      "INSERT INTO FACILITIES_TYPES (FAC_TYPE_NAME, FAC_TYPE_ICON, ADD_BY) VALUES (? ,? ,?)",
      [fac_name.toString().trim(), icon_url, uid]
    );
    conn.commit();
    if (result.affectedRows > 0) {
      return res.status(201).json("add fac success");
    } else {
      return res.status(400).json("add fac fail");
    }
  } catch (error: any) {
    conn.rollback();
    res.status(400).json(error.message);
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
      message: "Invalid JSON format for facilities or roomTypes",
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
          "FRONT_DORM_IMG"
        ).then((url) => ({ key: "FRONT_DORM_IMG", url }))
      );
    }
    if (files["LICENSE_IMG"]?.[0]) {
      mainImgTasks.push(
        fileUpload(
          files["LICENSE_IMG"][0],
          "dorms",
          `${name}_${owner_id}`,
          null,
          "LICENSE_IMG"
        ).then((url) => ({ key: "LICENSE_IMG", url }))
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
          [dormId, facId]
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
          `other_${idx}`
        )
      );
      const otherUrls = await Promise.all(otherTasks);

      for (const url of otherUrls) {
        await conn.execute(
          `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
          [dormId, url]
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
            field
          ).then((url) => ({ typeId, url }))
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

    for (const room of roomTypesArr) {
      const [rtResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO ROOM_TYPES (DORM_ID, ROOM_TYPE_NAME) VALUES (?, ?)`,
        [dormId, room.roomType]
      );
      const rtId = rtResult.insertId;

      if (room.perMonth) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, ?, ?)`,
          [rtId, 1, room.perMonth]
        );
      }
      if (room.perTerm) {
        await conn.execute(
          `INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, ?, ?)`,
          [rtId, 2, room.perTerm]
        );
      }

      const bedTypeId = await getBedId(room.bedType);
      await conn.execute(
        `INSERT INTO ROOM_BEDS (ROOM_TYPE_ID, BED_TYPE_ID) VALUES (?, ?)`,
        [rtId, bedTypeId]
      );
    }

    for (const img of uploadedRoomImgs) {
      await conn.execute(
        `INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)`,
        [dormId, img.url]
      );
    }
    await conn.commit();
    res.status(201).json({
      success: true,
      message: "Dormitory created successfully",
      dormId,
    });
  } catch (error: any) {
    console.error("Transaction Error:", error);
    await conn.rollback();

    res.status(500).json({
      success: false,
      message: "Failed to create dormitory",
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
    res.json({ success: true, message: "Dormitory updated successfully" });
  } catch (error: any) {
    await conn.rollback();
    console.error("Update Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Update failed", error: error.message });
  } finally {
    conn.release();
  }
};

export const updateDormInfo_fn = async (
  dormId: number,
  data: any,
  files: MulterFiles,
  conn: PoolConnection,
  ownerId: number
) => {
  let sql = "UPDATE DORMITORIES SET UPDATE_AT = CURRENT_DATE()";
  const params: any[] = [];
  const [oldData] = await conn.execute<RowDataPacket[]>(
    "SELECT FRONT_DORM_IMAGE, DORM_LICENSE FROM DORMITORIES WHERE DORM_ID = ?",
    [dormId]
  );
  if (data.name) {
    sql += ", DORM_NAME = ?";
    params.push(data.name);
  }
  if (data.address) {
    sql += ", ADDRESS = ?";
    params.push(data.address);
  }
  if (data.lat && data.lng) {
    sql += ", COORDINATES = ST_GeomFromText(?)";
    params.push(`POINT(${data.lat} ${data.lng})`);
  }
  if (data.zone_id) {
    sql += ", ZONE_ID = ?";
    params.push(data.zone_id);
  }
  if (data.type_id) {
    sql += ", DORM_TYPE_ID = ?";
    params.push(data.type_id);
  }
  if (data.water_unit) {
    sql += ", WATER_UNIT = ?";
    params.push(data.water_unit);
  }
  if (data.water_lump) {
    sql += ", WATER_LUMP = ?";
    params.push(data.water_lump);
  }
  if (data.elect_unit) {
    sql += ", ELECT_UNIT = ?";
    params.push(data.elect_unit);
  }
  if (data.detail) {
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
      "FRONT_DORM_IMG"
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
      "LICENSE_IMG"
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
  conn: PoolConnection
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
        [dormId, facId]
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
    const n = name.toString().toLowerCase();
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

  const [existingRooms] = await conn.execute<RowDataPacket[]>(
    "SELECT ROOM_TYPE_ID FROM ROOM_TYPES WHERE DORM_ID = ?",
    [dormId]
  );
  const existingIds = existingRooms.map((r: any) => r.ROOM_TYPE_ID);

  const incomingIds = roomTypes
    .filter((r) => r.roomTypeId)
    .map((r) => Number(r.roomTypeId));
  const idsToDelete = existingIds.filter((id) => !incomingIds.includes(id));

  if (idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => "?").join(",");
    await conn.execute(
      `DELETE FROM ROOM_PRICES WHERE ROOM_TYPE_ID IN (${placeholders})`,
      idsToDelete
    );
    await conn.execute(
      `DELETE FROM ROOM_BEDS WHERE ROOM_TYPE_ID IN (${placeholders})`,
      idsToDelete
    );
    await conn.execute(
      `DELETE FROM ROOM_TYPES WHERE ROOM_TYPE_ID IN (${placeholders})`,
      idsToDelete
    );
  }

  for (const room of roomTypes) {
    let currentId = Number(room.roomTypeId) || 0;

    if (currentId > 0 && existingIds.includes(currentId)) {
      await conn.execute(
        "UPDATE ROOM_TYPES SET ROOM_TYPE_NAME = ? WHERE ROOM_TYPE_ID = ?",
        [room.roomType, currentId]
      );

      await conn.execute("DELETE FROM ROOM_PRICES WHERE ROOM_TYPE_ID = ?", [
        currentId,
      ]);
      if (room.perMonth)
        await conn.execute(
          "INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)",
          [currentId, room.perMonth]
        );
      if (room.perTerm)
        await conn.execute(
          "INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)",
          [currentId, room.perTerm]
        );

      await conn.execute("DELETE FROM ROOM_BEDS WHERE ROOM_TYPE_ID = ?", [
        currentId,
      ]);
      await conn.execute(
        "INSERT INTO ROOM_BEDS (ROOM_TYPE_ID, BED_TYPE_ID) VALUES (?, ?)",
        [currentId, getBedId(room.bedType)]
      );
    } else {
      const [res] = await conn.execute<any>(
        "INSERT INTO ROOM_TYPES (DORM_ID, ROOM_TYPE_NAME) VALUES (?, ?)",
        [dormId, room.roomType]
      );
      currentId = res.insertId;

      if (room.perMonth)
        await conn.execute(
          "INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 1, ?)",
          [currentId, room.perMonth]
        );
      if (room.perTerm)
        await conn.execute(
          "INSERT INTO ROOM_PRICES (ROOM_TYPE_ID, PRICE_TYPE_ID, PRICE) VALUES (?, 2, ?)",
          [currentId, room.perTerm]
        );
      await conn.execute(
        "INSERT INTO ROOM_BEDS (ROOM_TYPE_ID, BED_TYPE_ID) VALUES (?, ?)",
        [currentId, getBedId(room.bedType)]
      );
    }
  }
};

export const updateRoomComponentImages_fn = async (
  dormId: number,
  dormName: string,
  files: MulterFiles,
  conn: PoolConnection,
  ownerId: number
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
    [dormId]
  );

  const uploadTasks = [];

  for (const keyword of keywords) {
    if (files[keyword] && files[keyword][0]) {
      const oldImgs = existingImages.filter(
        (img: any) => img.IMAGE_PATH && img.IMAGE_PATH.includes(keyword)
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
          keyword
        ).then((url) => ({ url }))
      );
    }
  }

  const results = await Promise.all(uploadTasks);
  for (const res of results) {
    await conn.execute(
      "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
      [dormId, res.url]
    );
  }
};

export const updateGalleryImages_fn = async (
  dormId: number,
  dormName: string,
  files: MulterFiles,
  ownerId: number,
  conn: PoolConnection
) => {
  if (!files["OTHER_IMG"] || files["OTHER_IMG"].length === 0) return;

  const newFiles = files["OTHER_IMG"];

  const [allImages] = await conn.execute<RowDataPacket[]>(
    "SELECT DORM_IMG_ID, IMAGE_PATH FROM DORM_IMAGES WHERE DORM_ID = ?",
    [dormId]
  );

  for (const [i, file] of newFiles.entries()) {
    const keyword = `other_${i}`;

    const oldImg = allImages.find(
      (img: any) => img.IMAGE_PATH && img.IMAGE_PATH.includes(keyword)
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
      keyword
    );

    await conn.execute(
      "INSERT INTO DORM_IMAGES (DORM_ID, IMAGE_PATH) VALUES (?, ?)",
      [dormId, newUrl]
    );
  }
};

export const removeDorm_api = async (req: Request, res: Response) => {
  const { id } = req.params;
  const conn = await dbcon.getConnection();

  try {
    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET DORM_STATUS_ID = 2 WHERE DORM_ID = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Dormitory not found" });
    }

    res.json({
      success: true,
      message: "Dormitory status changed to Removed (2)",
    });
  } catch (error: any) {
    console.error("Remove Dorm Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove dorm",
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
      [id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Dormitory not found" });
    }

    res.json({
      success: true,
      message: "Dormitory status restored to Active (1)",
    });
  } catch (error: any) {
    console.error("Restore Dorm Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to restore dorm",
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
      .json({ success: false, message: "Missing required fields" });
  }

  const conn = await dbcon.getConnection();

  try {
    await conn.beginTransaction();

    try {
      await conn.execute(
        "INSERT INTO REVIEWS (USER_ID, DORM_ID, SCORE, COMMENTS) VALUES (?, ?, ?, ?)",
        [user_id, dorm_id, score, comment]
      );
    } catch (err: any) {
      if (err.code === "ER_DUP_ENTRY") {
        throw new Error("คุณได้รีวิวหอพักนี้ไปแล้ว");
      }
      throw err;
    }

    const [avgResult] = await conn.execute<RowDataPacket[]>(
      "SELECT AVG(SCORE) as avg_score FROM REVIEWS WHERE DORM_ID = ?",
      [dorm_id]
    );

    const newScore = avgResult[0]?.avg_score || 0;

    await conn.execute("UPDATE DORMITORIES SET SCORE = ? WHERE DORM_ID = ?", [
      newScore,
      dorm_id,
    ]);

    await conn.commit();
    res.status(201).json({
      success: true,
      message: "Review added successfully",
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
      [id]
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
      [dormId]
    );

    const newScore = avgResult[0]?.avg_score || 0;

    await conn.execute("UPDATE DORMITORIES SET SCORE = ? WHERE DORM_ID = ?", [
      newScore,
      dormId,
    ]);

    await conn.commit();
    res.json({
      success: true,
      message: "Review deleted successfully",
      newDormScore: newScore,
    });
  } catch (error: any) {
    await conn.rollback();
    console.error("Delete Review Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete review",
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
    console.error("Get My Dorms Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
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
      .json({ success: false, message: "Server Error", error: error.message });
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
      .json({ success: false, message: "Server Error", error: error.message });
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
                  COALESCE(MIN(rp.PRICE), 0) as start_price,
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
      .json({ success: false, message: "Server Error", error: error.message });
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
      [data.dormId]
    );

    if (dormInfo.length === 0) {
      await conn.rollback();
      return res.status(404).json("Dormitory not found");
    }

    const targetEmail = dormInfo[0]!.EMAIL;
    const dormName = dormInfo[0]!.DORM_NAME;

    const [result] = await conn.execute<ResultSetHeader>(
      "UPDATE DORMITORIES SET REQ_STATUS = ?, UPDATE_AT = CURRENT_DATE() WHERE DORM_ID = ?;",
      [data.status, data.dormId]
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
      return res.status(400).json("Update failed (No affected rows)");
    }

    if (info) {
      return res.status(200).json("sent mail Success");
    } else {
      return res.status(400).json("sent mail fail");
    }
  } catch (error) {
    await conn.rollback();
    console.error(error);
    res.status(400).json(error);
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
    console.error("Get Pending Dorm Req Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error", error: error.message });
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
      return res.status(404).json("Have not facilities");
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
      return res.status(404).json("Have not facilities");
    }
  } catch (error: any) {
    res.status(500).json({ message: "Server Error", error: error.message });
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
    if (!fac_id) return res.status(400).json("not found facility");
    let user: string;

    if (Number(uid) == 1) {
      user = "admin";
    } else {
      const [userData] = (await getUsers_fn()).filter((u) => u.USER_ID == uid);
      if (!userData) return res.status(400).json("User not found");
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
      return res.status(200).json("Have not facility update");

    const [facs] = await conn.query<ResultSetHeader>(
      `UPDATE FACILITIES_TYPES SET ${sql.join(", ")} WHERE FAC_TYPE_ID = ?`,
      [...values, fac_id]
    );
    if (facs.affectedRows > 0) {
      return res.status(201).json({ url: iconUrl });
    }
  } catch (error: any) {
    await deleteFromGCS(iconUrl);
    res.status(500).json({ message: "Server Error", error: error.message });
  } finally {
    conn.release();
  }
};
