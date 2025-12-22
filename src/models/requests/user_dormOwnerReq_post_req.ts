export interface UserDormOwnerReqPostReq{
    user_id:    number;
    first_name: string;
    last_name:  string;
    facebook:   string | null;
    line:       string | null;
    x:          string | null;
    instagram:  string | null;
    telegram:   string | null;
}
