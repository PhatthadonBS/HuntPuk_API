import { RowDataPacket } from "mysql2";

export interface DormDataGetRes extends RowDataPacket{
    DORM_ID:          number;
    DORM_OWNER_ID:    number;
    DORM_NAME:        string;
    ADDRESS:          string;
    COORDINATES:      Coordinates;
    ZONE_ID:          number;
    DORM_TYPE_ID:     number;
    ADD_DORM_DATA:    string;
    WATER_UNIT:       number;
    WATER_LUMP:       number;
    ELECT_UNIT:       number;
    REG_AT:           string;
    UPDATE_AT:        string;
    SCORE:            string;
    FRONT_DORM_IMAGE: string;
    DORM_LICENSE:     string;
    DORM_STATUS_ID:   number;
    REQ_STATUS:       number;
    VIEW_COUNT:       number;
}

export interface Coordinates {
    x: number;
    y: number;
}
