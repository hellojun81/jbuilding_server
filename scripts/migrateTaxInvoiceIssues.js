import sql from '../lib/CRUD.js';

async function columns() {
  const [rows] = await sql.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_invoice_issues'`,
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}

async function indexes() {
  const [rows] = await sql.query(
    `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tax_invoice_issues'`,
  );
  return new Set(rows.map((row) => String(row.INDEX_NAME)));
}

async function migrate() {
  await sql.query(`CREATE TABLE IF NOT EXISTS tax_invoice_issues (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    comp_code VARCHAR(50) NOT NULL,
    bill_year CHAR(4) NOT NULL,
    bill_month CHAR(2) NOT NULL,
    document_type VARCHAR(20) NOT NULL DEFAULT 'tax_invoice',
    provider VARCHAR(30) NOT NULL,
    provider_document_key VARCHAR(36) NOT NULL,
    supply_amount DECIMAL(15, 0) NOT NULL,
    vat_amount DECIMAL(15, 0) NOT NULL,
    items_json LONGTEXT NULL,
    issue_status VARCHAR(30) NOT NULL DEFAULT 'queued',
    nts_confirm_number VARCHAR(24) NULL,
    error_message VARCHAR(500) NULL,
    issued_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tax_invoice_bill_document (comp_code, bill_year, bill_month, document_type),
    UNIQUE KEY uq_tax_invoice_provider_key (provider, provider_document_key)
  )`);

  const currentColumns = await columns();
  if (!currentColumns.has('document_type')) {
    await sql.query(
      `ALTER TABLE tax_invoice_issues
         ADD COLUMN document_type VARCHAR(20) NOT NULL DEFAULT 'tax_invoice' AFTER bill_month`,
    );
  }
  if (!currentColumns.has('items_json')) {
    await sql.query('ALTER TABLE tax_invoice_issues ADD COLUMN items_json LONGTEXT NULL AFTER vat_amount');
  }

  const currentIndexes = await indexes();
  if (currentIndexes.has('uq_tax_invoice_bill')) {
    await sql.query('ALTER TABLE tax_invoice_issues DROP INDEX uq_tax_invoice_bill');
  }
  if (!currentIndexes.has('uq_tax_invoice_bill_document')) {
    await sql.query(
      `ALTER TABLE tax_invoice_issues
         ADD UNIQUE KEY uq_tax_invoice_bill_document
           (comp_code, bill_year, bill_month, document_type)`,
    );
  }
  console.log('tax_invoice_issues migration complete');
}

migrate().catch((error) => {
  console.error('tax_invoice_issues migration failed:', error.message);
  process.exitCode = 1;
});
