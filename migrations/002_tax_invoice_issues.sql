CREATE TABLE tax_invoice_issues (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    comp_code VARCHAR(50) NOT NULL,
    bill_year CHAR(4) NOT NULL,
    bill_month CHAR(2) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    provider_document_key VARCHAR(36) NOT NULL,
    supply_amount DECIMAL(15, 0) NOT NULL,
    vat_amount DECIMAL(15, 0) NOT NULL,
    issue_status VARCHAR(30) NOT NULL DEFAULT 'queued',
    nts_confirm_number VARCHAR(24) NULL,
    error_message VARCHAR(500) NULL,
    issued_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tax_invoice_bill (comp_code, bill_year, bill_month),
    UNIQUE KEY uq_tax_invoice_provider_key (provider, provider_document_key)
);
