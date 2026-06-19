import cron from "node-cron";
import { dbcon } from "../database/pool";

export function startMonthlyViewSummaryJob() {
  // Run at 00:00 on the 1st day of every month
  cron.schedule("0 0 1 * *", async () => {
    console.log("🚀 Starting Monthly View Summary Job...");
    const conn = await dbcon.getConnection();

    try {
      // 1. Calculate previous month and year
      const now = new Date();
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const targetMonth = prevMonthDate.getMonth() + 1; // getMonth() is 0-11
      const targetYear = prevMonthDate.getFullYear();

      await conn.beginTransaction();

      // 2. Summarize dorm views from the previous month
      // Note: We only summarize dorm views (DORM_ID IS NOT NULL) because STATISTIC_WEB_VIEW requires DORM_ID
      await conn.execute(
        `INSERT INTO STATISTIC_WEB_VIEW (YEAR, MONTH, DORM_ID, VIEW_COUNT)
         SELECT YEAR(VIEW_AT), MONTH(VIEW_AT), DORM_ID, COUNT(*) 
         FROM WEB_VIEW_LOGS 
         WHERE MONTH(VIEW_AT) = ? AND YEAR(VIEW_AT) = ? AND DORM_ID IS NOT NULL
         GROUP BY DORM_ID, YEAR(VIEW_AT), MONTH(VIEW_AT)
         ON DUPLICATE KEY UPDATE VIEW_COUNT = VIEW_COUNT + VALUES(VIEW_COUNT)`,
        [targetMonth, targetYear],
      );

      // 3. Delete raw data for the summarized month to save space (including website general views)
      const [deleteResult]: any = await conn.execute(
        `DELETE FROM WEB_VIEW_LOGS 
         WHERE MONTH(VIEW_AT) = ? AND YEAR(VIEW_AT) = ?`,
        [targetMonth, targetYear],
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      console.error("❌ Failed to summarize monthly views:", error);
    } finally {
      conn.release();
    }
  });

  console.log("⏱️  Monthly View Summary Cron Job initialized.");
}
