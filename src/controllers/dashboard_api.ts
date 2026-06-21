import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { RowDataPacket } from "mysql2";

export const getDashboardStats_api = async (req: Request, res: Response) => {
  try {
    // 1. Dorm Count
    const [dormCountResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM DORMITORIES"
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

    // 5. Popular Dorm (Most Views)
    const [popularDormResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT DORM_ID as dormId, DORM_NAME as dormName, VIEW_COUNT as views FROM DORMITORIES ORDER BY VIEW_COUNT DESC LIMIT 5"
    );
    const topPopularDorms = popularDormResult || [];
    const popularDorm = topPopularDorms[0] || { dormName: "N/A", views: 0 };

    // 6. Total Website Views (Historical + Current Month)
    const [historicalViewsResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT SUM(VIEW_COUNT) AS count FROM STATISTIC_WEB_VIEW WHERE DORM_ID IS NULL"
    );
    const historicalViews = Number(historicalViewsResult[0]?.count) || 0;

    const [currentViewsResult] = await dbcon.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM WEB_VIEW_LOGS WHERE DORM_ID IS NULL"
    );
    const currentViews = Number(currentViewsResult[0]?.count) || 0;

    const totalWebsiteViews = historicalViews + currentViews;

    // 7. Zone Breakdown
    const [zoneBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT dz.ZONE_ID as zoneId, dz.ZONE_NAME as zoneName, COUNT(d.DORM_ID) as dormCount 
       FROM DORM_ZONES dz 
       LEFT JOIN DORMITORIES d ON dz.ZONE_ID = d.ZONE_ID 
       GROUP BY dz.ZONE_ID`
    );

    // 8. Dorm Status & Type Breakdown
    const [dormStatusBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT ds.DORM_STATUS_NAME as statusName, COUNT(d.DORM_ID) as count
       FROM DORM_STATUSES ds
       LEFT JOIN DORMITORIES d ON ds.DORM_STATUS_ID = d.DORM_STATUS_ID
       GROUP BY ds.DORM_STATUS_ID`
    );
    const [dormTypeBreakdown] = await dbcon.execute<RowDataPacket[]>(
      `SELECT dt.DORM_TYPE_NAME as typeName, COUNT(d.DORM_ID) as count
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
