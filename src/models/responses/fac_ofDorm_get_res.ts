import { RowDataPacket } from "mysql2";

export interface FacOfDormGetRes extends RowDataPacket{
    FAC_DORM_ID:   number;
    FAC_TYPE_ID:   number;
    FAC_TYPE_NAME: string;
    FAC_TYPE_ICON: string;
    DORM_ID:       number;
}
