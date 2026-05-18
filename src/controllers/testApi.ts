import { Request, Response } from "express";
import { dbcon } from "../database/pool";
import { resMailSender_fn } from "./user_api";

// /////////////////////////////////////////////////////////////////////////////////////////////////

export const test_send = async (req: Request, res: Response) => {
  const conn = await dbcon.getConnection();
  try {
    const a = await resMailSender_fn(
      "66011212117@msu.ac.th", 
      "Test Email from HuntPuk API", 
      "This is a test email sent from HuntPuk API. If you received this email, it means the Brevo API integration is working correctly."
    );

    res.status(200).json(a);
  } catch (error: any) {
    console.log(error);
    res.status(400).json({ msg: error.message });
  } finally {
    conn.release();
  }
};

// /////////////////////////////////////////////////////////////////////////////////////////////////
