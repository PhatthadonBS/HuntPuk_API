import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket } from "mysql2";

function getClientId(req: Request): string {
  const deviceId = req.headers["x-device-id"] as string;
  if (deviceId) return deviceId;

  const forwarded = req.headers["x-forwarded-for"] as string;
  const ip = forwarded ? forwarded.split(",")[0] : req.socket.remoteAddress;
  return ip || "0.0.0.0";
}

export const recordWebsiteView = async (req: Request, res: Response) => {
  const clientId = getClientId(req);

  try {
    // Check if the same IP/Device viewed the website in the last 10 minutes
    const [recentLogs] = await dbcon.execute<RowDataPacket[]>(
      `SELECT LOG_ID FROM WEB_VIEW_LOGS 
       WHERE IP_ADDRESS = ? AND DORM_ID IS NULL AND VIEW_AT > (NOW() - INTERVAL 10 MINUTE)`,
      [clientId],
    );

    if (recentLogs.length === 0) {
      await dbcon.execute(
        `INSERT INTO WEB_VIEW_LOGS (IP_ADDRESS, DORM_ID) VALUES (?, NULL)`,
        [clientId],
      );
      return res
        .status(200)
        .json({ success: true, message: "Website view counted." });
    }

    return res
      .status(200)
      .json({ success: true, message: "Website view ignored (rate limit)." });
  } catch (error) {
    console.error("Website View Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error tracking view." });
  }
};

export const recordDormView = async (req: Request, res: Response) => {
  const clientId = getClientId(req);
  const dormId = req.params.id;

  try {
    // Check if the same IP/Device viewed this specific dorm in the last 10 minutes
    const [recentLogs] = await dbcon.execute<RowDataPacket[]>(
      `SELECT LOG_ID FROM WEB_VIEW_LOGS 
       WHERE IP_ADDRESS = ? AND DORM_ID = ? AND VIEW_AT > (NOW() - INTERVAL 10 MINUTE)`,
      [clientId, dormId],
    );

    if (recentLogs.length === 0) {
      const conn = await dbcon.getConnection();
      try {
        await conn.beginTransaction();

        await conn.execute(
          `INSERT INTO WEB_VIEW_LOGS (IP_ADDRESS, DORM_ID) VALUES (?, ?)`,
          [clientId, dormId],
        );

        await conn.execute(
          `UPDATE DORMITORIES SET VIEW_COUNT = VIEW_COUNT + 1 WHERE DORM_ID = ?`,
          [dormId],
        );

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      return res
        .status(200)
        .json({ success: true, message: "Dorm view counted." });
    }

    return res
      .status(200)
      .json({ success: true, message: "Dorm view ignored (rate limit)." });
  } catch (error) {
    console.error("Dorm View Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error tracking view." });
  }
};
