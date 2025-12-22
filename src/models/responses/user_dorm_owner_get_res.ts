export interface UserDormOwnerGetRes{
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