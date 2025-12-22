import { RowDataPacket } from "mysql2";

export interface OtpVerifyPostRes extends RowDataPacket{
    OTP_CODE:  string;
    CREATE_AT: string;
    EMAIL:     string;
}
