import { RowDataPacket } from "mysql2";

export interface DormRoomImgTypeGetRes extends RowDataPacket{
    IMG_ROOM_TYPE_ID:   number;
    IMG_ROOM_TYPE_NAME: string;
}
