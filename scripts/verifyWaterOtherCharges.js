import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [rows] = await connection.query(`
    SELECT
      COUNT(*) AS row_count,
      SUM(COALESCE(etc_bill, 0)) AS legacy_water_total,
      SUM(COALESCE(water_bill, 0)) AS water_total,
      SUM(CASE WHEN COALESCE(etc_bill, 0) <> COALESCE(water_bill, 0) THEN 1 ELSE 0 END) AS mismatch_count,
      SUM(COALESCE(other_bill, 0)) AS other_total,
      SUM(COALESCE(other_vat_bill, 0)) AS other_vat_total
    FROM jbuildingrentbill
  `);
  const result = rows[0];
  console.log(JSON.stringify(result, null, 2));
  if (Number(result.mismatch_count) !== 0) {
    throw new Error('기존 수도료와 신규 수도료가 일치하지 않습니다.');
  }
  console.log('Verification passed');
} finally {
  await connection.end();
}
