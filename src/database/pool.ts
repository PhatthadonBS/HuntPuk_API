import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

export const dbcon = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', 
  user: process.env.DB_USER || 'root',     
  password: process.env.DB_PASSWORD || '',  
  database: process.env.DB_NAME || 'my_database',
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // Max idle connections, the same as connectionLimit or less
  idleTimeout: 60000, // Idle connections timeout in milliseconds (1 minute)
  queueLimit: 0,
  enableKeepAlive: true, 
  keepAliveInitialDelay: 10000 // Start keep alive after 10 seconds
});

