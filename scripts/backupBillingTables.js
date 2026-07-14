import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const tables = ['jbuildingmng', 'jbuildingrentbill'];
const outputDirectory = process.env.BACKUP_DIR || '/private/tmp';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(outputDirectory, `jbuilding-before-water-other-${timestamp}.sql`);

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function insertStatement(table, rows) {
  if (rows.length === 0) return `-- ${table}: 0 rows\n`;
  const columns = Object.keys(rows[0]);
  const columnSql = columns.map((column) => mysql.escapeId(column)).join(', ');
  const valuesSql = rows.map((row) => `(${columns.map((column) => mysql.escape(row[column])).join(', ')})`).join(',\n');
  return `INSERT INTO ${mysql.escapeId(table)} (${columnSql}) VALUES\n${valuesSql};\n`;
}

try {
  const sections = [
    '-- JBuilding billing tables backup',
    `-- Created at ${new Date().toISOString()}`,
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
  ];

  for (const table of tables) {
    const [createRows] = await connection.query(`SHOW CREATE TABLE ${mysql.escapeId(table)}`);
    const [, createSql] = Object.values(createRows[0]);
    const [rows] = await connection.query(`SELECT * FROM ${mysql.escapeId(table)}`);
    sections.push(`DROP TABLE IF EXISTS ${mysql.escapeId(table)};`);
    sections.push(`${createSql};`);
    sections.push(insertStatement(table, rows));
    console.log(`${table}: ${rows.length} rows backed up`);
  }

  sections.push('SET FOREIGN_KEY_CHECKS = 1;');
  fs.writeFileSync(outputPath, `${sections.join('\n\n')}\n`, { mode: 0o600 });
  console.log(`Backup created: ${outputPath}`);
} finally {
  await connection.end();
}
