import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket } from "mysql2";

export const getDashboardStats_api = async (req: Request, res: Response) => {
  try {
    // 1. Dorm Count (Only approved and not deleted)
    const [dormCountResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM DORMITORIES WHERE REQ_STATUS = 1 AND DORM_STATUS_ID != 4"
    );
    const dormCount = dormCountResult[0]?.count || 0;

    // 2. Member Count
    const [memberCountResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM USERS WHERE ROLE_TYPE_ID = 1"
    );
    const memberCount = memberCountResult[0]?.count || 0;

    // 3. Owner Count
    const [ownerCountResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM USERS WHERE ROLE_TYPE_ID = 2"
    );
    const ownerCount = ownerCountResult[0]?.count || 0;

    // 4. Zone Count
    const [zoneCountResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM DORM_ZONES"
    );
    const zoneCount = zoneCountResult[0]?.count || 0;

    const [popularDormResult] = await dbcon.execute<RowDataPacket[]>(`
      SELECT 
        d.DORM_ID as dormId, 
        d.DORM_NAME as dormName, 
        (
          COALESCE((SELECT SUM(VIEW_COUNT) FROM STATISTIC_WEB_VIEW s WHERE s.DORM_ID = d.DORM_ID), 0) + 
          COALESCE((SELECT COUNT(LOG_ID) FROM WEB_VIEW_LOGS w WHERE w.DORM_ID = d.DORM_ID), 0)
        ) as views 
      FROM DORMITORIES d 
      WHERE d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4
      ORDER BY views DESC
    `);
    const allDormViews = popularDormResult || [];
    const topPopularDorms = allDormViews.slice(0, 5);
    const popularDorm = topPopularDorms[0] || { dormName: "N/A", views: 0 };
    const totalDormViews = allDormViews.reduce((sum: number, dorm: any) => sum + Number(dorm.views), 0);



    // 6. Total Website Views (Historical + Current Month)
    const [historicalViewsResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT SUM(VIEW_COUNT) AS count FROM STATISTIC_WEB_VIEW"
    );
    const historicalViews = Number(historicalViewsResult[0]?.count) || 0;

    const [currentViewsResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM WEB_VIEW_LOGS"
    );
    const currentViews = Number(currentViewsResult[0]?.count) || 0;

    const totalWebsiteViews = historicalViews + currentViews;

    // 7. Zone Breakdown (Only count approved and not deleted dorms)
    const [zoneBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT dz.ZONE_ID as zoneId, dz.ZONE_NAME as zoneName, 
              COUNT(CASE WHEN d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4 THEN d.DORM_ID END) as dormCount 
       FROM DORM_ZONES dz 
       LEFT JOIN DORMITORIES d ON dz.ZONE_ID = d.ZONE_ID 
       GROUP BY dz.ZONE_ID`
    );

    // 8. Dorm Status & Type Breakdown
    const [dormStatusBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT ds.DORM_STATUS_NAME as statusName, 
              COUNT(CASE WHEN d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4 THEN d.DORM_ID END) as count
       FROM DORM_STATUSES ds
       LEFT JOIN DORMITORIES d ON ds.DORM_STATUS_ID = d.DORM_STATUS_ID
       WHERE ds.DORM_STATUS_ID != 4
       GROUP BY ds.DORM_STATUS_ID`
    );
    const [dormTypeBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT dt.DORM_TYPE_NAME as typeName, 
              COUNT(CASE WHEN d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4 THEN d.DORM_ID END) as count
       FROM DORM_TYPES dt
       LEFT JOIN DORMITORIES d ON dt.DORM_TYPE_ID = d.DORM_TYPE_ID
       GROUP BY dt.DORM_TYPE_ID`
    );

    // 9. User Status Breakdown (Active, Deactive, Banned)
    // 0 = กำลังใช้งาน, 1 = ปิดการใช้งาน, 2 = ระงับการเข้าถึง
    const [userStatusBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT ACCOUNT_STATUS as status, COUNT(USER_ID) as count
       FROM USERS
       GROUP BY ACCOUNT_STATUS`
    );
    let activeUsers = 0;
    let deactiveUsers = 0;
    let bannedUsers = 0;
    userStatusBreakdown.forEach((row: any) => {
      if (row.status === 0) activeUsers = row.count;
      else if (row.status === 1) deactiveUsers = row.count;
      else if (row.status === 2) bannedUsers = row.count;
    });

    // 10. Views Per Month
    const [historicalViewsPerMonth] = await dbcon.execute<RowDataPacket[]>(
      `SELECT YEAR, MONTH, SUM(VIEW_COUNT) as count
       FROM STATISTIC_WEB_VIEW
       GROUP BY YEAR, MONTH
       ORDER BY YEAR ASC, MONTH ASC`
    );
    const [liveViewsPerMonth] = await dbcon.execute<RowDataPacket[]>(
      `SELECT YEAR(VIEW_AT) as YEAR, MONTH(VIEW_AT) as MONTH, COUNT(LOG_ID) as count
       FROM WEB_VIEW_LOGS
       GROUP BY YEAR(VIEW_AT), MONTH(VIEW_AT)`
    );

    // Merge Historical and Live views
    const viewsMap = new Map<string, number>();
    historicalViewsPerMonth.forEach((row: any) => {
      const key = `${row.YEAR}-${row.MONTH}`;
      viewsMap.set(key, Number(row.count) || 0);
    });
    liveViewsPerMonth.forEach((row: any) => {
      if (row.YEAR && row.MONTH) {
        const key = `${row.YEAR}-${row.MONTH}`;
        const existing = viewsMap.get(key) || 0;
        viewsMap.set(key, existing + (Number(row.count) || 0));
      }
    });

    const viewsPerMonthBreakdown = Array.from(viewsMap.entries()).map(([key, count]) => {
      const [year, month] = key.split('-');
      return { year: Number(year), month: Number(month), count };
    }).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    const [ownersWithDormsResult] = await dbcon.execute<RowDataPacket[]>(
      `SELECT do.USER_ID as userId, do.FIRST_NAME as firstName, do.LAST_NAME as lastName, u.EMAIL as email, do.PROFILE_IMAGE as profileImage, COUNT(d.DORM_ID) as registeredDormsCount
       FROM DORM_OWNERS do
       JOIN USERS u ON do.USER_ID = u.USER_ID
       JOIN DORMITORIES d ON do.DORM_OWNER_ID = d.DORM_OWNER_ID
       WHERE d.REQ_STATUS = 1 AND d.DORM_STATUS_ID != 4
       GROUP BY do.USER_ID, do.FIRST_NAME, do.LAST_NAME, u.EMAIL, do.PROFILE_IMAGE
       ORDER BY registeredDormsCount DESC`
    );
    const ownersWithDorms = ownersWithDormsResult || [];

    return res.status(200).json({
      success: true,
      data: {
        dormCount,
        memberCount,
        ownerCount,
        zoneCount,
        totalWebsiteViews,
        popularDormName: popularDorm.dormName,
        popularDormViews: popularDorm.views,
        topPopularDorms,
        allDormViews,
        totalDormViews,
        ownersWithDorms,
        zoneBreakdown: zoneBreakdown || [],
        dormStatusBreakdown: dormStatusBreakdown || [],
        dormTypeBreakdown: dormTypeBreakdown || [],
        userStatusBreakdown: { activeUsers, deactiveUsers, bannedUsers },
        viewsPerMonthBreakdown
      },
    });
  } catch (error: any) {
    console.error("Get Dashboard Stats Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching dashboard statistics",
      error: error.message,
    });
  }
};
