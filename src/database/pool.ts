import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

export const dbcon = mysql.createPool({
  host: process.env.DB_HOST as string, 
  user: process.env.DB_USER as string,     
  password: process.env.DB_PASSWORD as string,  
  database: process.env.DB_NAME as string,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 150,
  maxIdle: 150,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true, 
  keepAliveInitialDelay: 10000
});

