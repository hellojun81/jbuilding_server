import fs from 'fs/promises';
import sql from '../lib/CRUD.js';

async function migrate() {
  const source = await fs.readFile(new URL('../migrations/005_bank_transactions.sql', import.meta.url), 'utf8');
  const statements = source.split(';').map((value) => value.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  console.log('bank transaction migration complete');
}

migrate().catch((error) => {
  console.error('bank transaction migration failed:', error.message);
  process.exitCode = 1;
});
