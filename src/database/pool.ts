import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

export const dbcon = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', 
  user: process.env.DB_USER || 'root',     
  password: process.env.DB_PASSWORD || '',  
  database: process.env.DB_NAME || 'my_database',
  port: Number(process.env.DB_PORT) ,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true, 
  keepAliveInitialDelay: 0
});

