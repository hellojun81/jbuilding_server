import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
 await db.query(`CREATE TABLE IF NOT EXISTS bill_deliveries (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 comp_code VARCHAR(50) NOT NULL, bill_year CHAR(4) NOT NULL, bill_month CHAR(2) NOT NULL,
 channel VARCHAR(20) NOT NULL, request_id VARCHAR(32) NOT NULL,
 recipient VARCHAR(320) NOT NULL, content_text TEXT NOT NULL, revision CHAR(64) NOT NULL,
 status VARCHAR(20) NOT NULL, receipt VARCHAR(255) NULL, error_message VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_bill_delivery (comp_code, bill_year, bill_month, channel),
 UNIQUE KEY uq_bill_delivery_request (request_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 console.log('Bill delivery history table ready');
} finally { await db.end(); }
