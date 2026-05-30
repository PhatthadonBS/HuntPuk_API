export interface ApiResponse<T = any> {
    success: boolean;
    message?: string;
    data?: T;
    error?: string;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
    total?: number;
    page?: number;
    limit?: number;
} 
 