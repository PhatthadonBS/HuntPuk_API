export interface UserLoggedInPostRes {
    logged_in: boolean;
    message:   string;
    user:      User;
}

export interface User {
    id:            number;
    username:      string;
    email:         string;
    phone:         string;
    role_id:       number;
    accout_status: number;
}
