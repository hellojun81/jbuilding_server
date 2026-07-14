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

const columns = [
  ['jbuildingmng', 'water_bill', 'BIGINT NOT NULL DEFAULT 0'],
  ['jbuildingmng', 'other_bill', 'BIGINT NOT NULL DEFAULT 0'],
  ['jbuildingmng', 'other_vat_bill', 'BIGINT NOT NULL DEFAULT 0'],
  ['jbuildingrentbill', 'water_bill', 'BIGINT NOT NULL DEFAULT 0'],
  ['jbuildingrentbill', 'other_bill', 'BIGINT NOT NULL DEFAULT 0'],
  ['jbuildingrentbill', 'other_vat_bill', 'BIGINT NOT NULL DEFAULT 0'],
];

try {
  const [existingRows] = await connection.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('jbuildingmng', 'jbuildingrentbill')`,
  );
  const existing = new Set(existingRows.map((row) => `${row.table_name}.${row.column_name}`.toLowerCase()));

  for (const [table, column, definition] of columns) {
    if (!existing.has(`${table}.${column}`)) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`Added ${table}.${column}`);
    }
  }

  const [masterResult] = await connection.query(
    'UPDATE jbuildingmng SET water_bill = COALESCE(ETC_BILL, 0) WHERE water_bill = 0 AND COALESCE(ETC_BILL, 0) <> 0',
  );
  const [billResult] = await connection.query(
    'UPDATE jbuildingrentbill SET water_bill = COALESCE(etc_bill, 0) WHERE water_bill = 0 AND COALESCE(etc_bill, 0) <> 0',
  );
  console.log(`Copied master water charges: ${masterResult.affectedRows}`);
  console.log(`Copied monthly water charges: ${billResult.affectedRows}`);
} finally {
  await connection.end();
}
