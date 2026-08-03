CREATE TABLE IF NOT EXISTS bank_collection_jobs (
  job_id VARCHAR(18) NOT NULL,
  account_key CHAR(64) NOT NULL,
  bank_code VARCHAR(4) NOT NULL,
  account_number_masked VARCHAR(40) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  error_code VARCHAR(30) NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(20) NOT NULL DEFAULT 'popbill',
  provider_tid VARCHAR(64) NOT NULL,
  job_id VARCHAR(18) NOT NULL,
  bank_code VARCHAR(4) NOT NULL,
  account_number_masked VARCHAR(40) NOT NULL,
  trade_date DATE NOT NULL,
  trade_datetime DATETIME NULL,
  deposit_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
  withdrawal_amount DECIMAL(15, 0) NOT NULL DEFAULT 0,
  balance DECIMAL(15, 0) NOT NULL DEFAULT 0,
  remark1 VARCHAR(255) NULL,
  remark2 VARCHAR(255) NULL,
  remark3 VARCHAR(255) NULL,
  remark4 VARCHAR(255) NULL,
  memo VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_transaction_provider_tid (provider, provider_tid),
  KEY ix_bank_transaction_date (trade_date)
);

CREATE TABLE IF NOT EXISTS bank_bill_matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bank_transaction_id BIGINT UNSIGNED NOT NULL,
  comp_code VARCHAR(50) NOT NULL,
  bill_year CHAR(4) NOT NULL,
  bill_month CHAR(2) NOT NULL,
  matched_amount DECIMAL(15, 0) NOT NULL,
  match_method VARCHAR(20) NOT NULL DEFAULT 'manual',
  matched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_match_transaction (bank_transaction_id),
  UNIQUE KEY uq_bank_match_bill (comp_code, bill_year, bill_month),
  CONSTRAINT fk_bank_match_transaction FOREIGN KEY (bank_transaction_id)
    REFERENCES bank_transactions (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS bank_payer_aliases (
  payer_key CHAR(64) NOT NULL,
  comp_code VARCHAR(50) NOT NULL,
  last_transaction_id BIGINT UNSIGNED NOT NULL,
  match_count INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (payer_key),
  KEY ix_bank_payer_alias_comp (comp_code),
  CONSTRAINT fk_bank_payer_alias_transaction FOREIGN KEY (last_transaction_id)
    REFERENCES bank_transactions (id) ON DELETE RESTRICT
);
