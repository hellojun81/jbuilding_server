import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
 await db.query(`CREATE TABLE IF NOT EXISTS deleted_bills (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 comp_code VARCHAR(50) NOT NULL, bill_year CHAR(4) NOT NULL, bill_month CHAR(2) NOT NULL,
 renter_name VARCHAR(255) NOT NULL, snapshot_json LONGTEXT NOT NULL,
 deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 console.log('Deleted bill archive ready');
} finally { await db.end(); }
