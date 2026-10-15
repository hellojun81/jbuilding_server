import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
try {
  const [rows] = await db.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'jbuildingmng' AND column_name = 'bill_delivery_method'");
  if (!rows.length) await db.query("ALTER TABLE jbuildingmng ADD COLUMN bill_delivery_method VARCHAR(20) NULL DEFAULT NULL COMMENT 'email,sms,kakao,email_sms; NULL=미설정'");
  console.log(rows.length ? 'Delivery column already exists' : 'Delivery column added; existing contracts remain unset');
} finally { await db.end(); }
