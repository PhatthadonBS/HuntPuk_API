import { RowDataPacket } from "mysql2";

export interface User {
    id:            number;
    username:      string;
    email:         string;
    phone?:        string;
    role_id:       number;
    accout_status: number;
    token?:        string;
}

export interface UserRegPostReq {
    username: string;
    email:    string;
    password: string;
    phone:    string;
}

export interface UserDataPostRes extends RowDataPacket {
    USER_ID:        number;
    USERNAME:       string;
    EMAIL:          string;
    PASSWORD:       string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
}

export interface UserAllGetRes extends RowDataPacket {
    USER_ID:        number;
    USERNAME:       string;
    EMAIL:          string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
    FIRST_NAME?:    string;
    LAST_NAME?:     string;
}

export interface UserDormOwnerReqPostReq {
    user_id:    number;
    first_name: string;
    last_name:  string;
    facebook:   string | null;
    line:       string | null;
    x:          string | null;
    instagram:  string | null;
    telegram:   string | null;
}

export interface UserProfileUpdatePostReq {
    username: string;
    email:    string;
    phone:    string;
}

export interface UserDormOwnerGetRes {
    USER_ID:        number;
    FIRST_NAME:     string;
    LAST_NAME:      string;
    FACEBOOK:       string | null;
    INSTAGRAM:      string | null;
    LINE:           string | null;
    TELEGRAM:       string | null;
    X:              string | null;
    REQ_STATUS:     number;
    PROFILE_IMAGE:  string;
    USERNAME:       string;
    EMAIL:          string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
}

export interface UserFavGetRes {
    DORMID:           number;
    DORMNAME:         string;
    OWNERNAME:        string;
    UPDATEDAT:        string;
    ADDRESS:          string;
    COVERIMAGE:       string;
    SCORE:            string;
    DORM_STATUS_NAME: string;
}

export interface UserLoggedInPostRes {
    logged_in: boolean;
    message:   string;
    user:      User;
}

export interface OtpVerifyPostRes extends RowDataPacket {
    OTP_CODE:  string;
    CREATE_AT: string;
    EMAIL:     string;
}

export interface DTOUserDormOwnerReqGetRes extends RowDataPacket {
    user_id:        number;
    first_name:     string;
    last_name:      string;
    facebook:       string | null;
    instagram:      string | null;
    line:           string | null;
    telegram:       string | null;
    x:              string | null;
    REQ_STATUS:     number;
    PROFILE_IMAGE:  string;
    USERNAME:       string;
    EMAIL:          string;
    PHONE_NUMBER:   string;
    ROLE_TYPE_ID:   number;
    ACCOUNT_STATUS: number;
}
