import mysql from 'mysql2/promise';

async function test() {
  const dbcon = await mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: 'password', // Need to guess password, wait, in docker it might be root/admin or just no password
    database: 'huntpuk_db'
  });
  // I will just modify dashboard_api to log the results to a file, that's easier and guaranteed to work!
}
