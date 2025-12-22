import { RowDataPacket } from "mysql2";

export interface UserAllGetRes extends RowDataPacket{
    USER_ID:        number;
    USERNAME:       string;
    EMAIL:          string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
}
