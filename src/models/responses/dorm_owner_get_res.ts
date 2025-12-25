import { RowDataPacket } from "mysql2";

export interface DormOwnerGetRes extends RowDataPacket{
    DORM_OWNER_ID: number;
    USER_ID:       number;
    FIRST_NAME:    string;
    LAST_NAME:     string;
    FACEBOOK:      string;
    LINE:          string;
    X:             null;
    INSTAGRAM:     string;
    TELEGRAM:      null;
    REQ_STATUS:    number;
    PROFILE_IMAGE: string;
}
