import { RowDataPacket } from "mysql2";

export interface Coordinates {
    x: number;
    y: number;
}

export interface DormRegPostReq {
    owner_id:   number;
    name:       string;
    address:    string;
    lat:        number;
    lng:        number;
    zone_id:    number;
    type_id:    number;
    water_unit: number;
    water_lump: number;
    elect_unit: number;
    detail:     string;
    facilities: string;
    roomTypes:  string;
}

export interface RoomTypeItem {
    roomTypeId?: number | string;
    roomType: string;
    bedType: string; 
    perMonth: number;
    perTerm: number;
    perDay: number;
}

export interface DormRoomTypeReqPostReq {
    roomType: string; 
    bedType: string;  
    perMonth: string | number;
    perTerm: string | number;
    perDay: string | number;
}

export interface DormSummary extends RowDataPacket {
    DORM_ID:     number;
    DORM_NAME:   string;
    ADDRESS:     string;
    SCORE:       string;
    image:       string;
    zone:        string;
    lat:         number;
    lng:        number;
    start_price: number;
    update_at?: string;
    status?: number;
    ZONE_ID?: number;
    DORM_STATUS_ID?: number;
    DORM_STATUS_NAME?: string;
}

export interface DormAllGetRes {
    success: boolean;
    data:    DormSummary[];
}

export interface DormDataGetRes extends RowDataPacket {
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

export interface DormFacGetRes extends RowDataPacket {
    FAC_TYPE_ID:   number;
    FAC_TYPE_NAME: string;
    FAC_TYPE_ICON: string;
    ADD_BY:        number;
}

export interface DormOwnerGetRes extends RowDataPacket {
    DORM_OWNER_ID: number;
    USER_ID:       number;
    FIRST_NAME:    string;
    LAST_NAME:     string;
    FACEBOOK:      string;
    LINE:          string;
    X:             string | null;
    INSTAGRAM:     string;
    TELEGRAM:      string | null;
    REQ_STATUS:    number;
    PROFILE_IMAGE: string;
}

export interface DormRoomImgTypeGetRes extends RowDataPacket {
    IMG_ROOM_TYPE_ID:   number;
    IMG_ROOM_TYPE_NAME: string;
}

export interface FacOfDormGetRes extends RowDataPacket {
    FAC_DORM_ID:   number;
    FAC_TYPE_ID:   number;
    FAC_TYPE_NAME: string;
    FAC_TYPE_ICON: string;
    DORM_ID:       number;
}

export interface DormRoomDetail {
    ROOM_TYPE_ID: number;
    ROOM_TYPE_NAME: string;
    PRICE: number;
    perTerm: number;
    perDay: number;
    bedType: string;
    BED_TYPE_ID: number;
}

export interface DormDetail extends RowDataPacket {
    DORM_ID: number;
    DORM_NAME: string;
    ADDRESS: string;
    SCORE: string;
    image: string;
    ZONE_ID: number;
    ZONE_NAME: string;
    DORM_TYPE_ID: number;
    lat: number;
    lng: number;
    start_price: number;
    term_price?: number;
    phone: string;
    line: string;
    facebook: string;
    instagram: string;
    telegram: string;
    x: string;
    facilities: { name: string; icon: string }[];
    gallery: string[];
    ceiling_img?: string;
    wall_img?: string;
    floor_img?: string;
    bathroom_img?: string;
    balcony_img?: string;
    rooms: DormRoomDetail[];
    WATER_UNIT: number;
    WATER_LUMP: number;
    ELECT_UNIT: number;
    ADD_DORM_DATA: string;
    USER_ID: number;
    FIRST_NAME: string;
    LAST_NAME: string;
}

export interface DormDetailGetRes {
    success: boolean;
    data: DormDetail;
}
 