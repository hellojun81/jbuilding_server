import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
 await db.query(`CREATE TABLE IF NOT EXISTS bill_settings (
 id INT NOT NULL PRIMARY KEY, notice TEXT NOT NULL
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db.query(`CREATE TABLE IF NOT EXISTS bill_detail_settings (id INT NOT NULL PRIMARY KEY, details_json TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 console.log('Bill settings table ready');
} finally { await db.end(); }
