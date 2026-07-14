-- 한 거래처/월에 과세 세금계산서와 면세 계산서를 각각 기록할 수 있도록 분리한다.
-- 적용 전 tax_invoice_issues가 비어 있거나 기존 행의 문서 종류가 확인되어야 한다.

ALTER TABLE `tax_invoice_issues`
  ADD COLUMN `document_type` VARCHAR(20) NOT NULL DEFAULT 'tax_invoice'
    COMMENT 'tax_invoice=과세 세금계산서, invoice=면세 계산서'
    AFTER `bill_month`,
  ADD COLUMN `items_json` LONGTEXT NULL AFTER `vat_amount`,
  DROP INDEX `uq_tax_invoice_bill`,
  ADD UNIQUE KEY `uq_tax_invoice_bill_document`
    (`comp_code`, `bill_year`, `bill_month`, `document_type`);
