import { RowDataPacket } from "mysql2";

export interface DormFacGetRes extends RowDataPacket{
    FAC_TYPE_ID:   number;
    FAC_TYPE_NAME: string;
    FAC_TYPE_ICON: string;
    ADD_BY:        number;
}
