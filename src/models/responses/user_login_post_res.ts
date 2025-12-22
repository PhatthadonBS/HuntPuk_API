import { RowDataPacket } from "mysql2";

export interface UserLoginPostRes extends RowDataPacket{
    USER_ID:        number;
    USERNAME:       string;
    EMAIL:          string;
    PASSWORD:       string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
}
