import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaxinvoice, makeDocumentKey, taxInvoiceProviderStatus } from '../lib/taxInvoiceProvider.js';

const supplier = {
  corpName: '(주)타울',
  ceoname: '대표자',
  addr: '서울시',
  bizType: '서비스',
  bizClass: '소프트웨어',
};

const target = {
  year: '2020',
  month: '07',
  renter_code: 'customer-1',
  renter_name: '임차기업',
  representative: '임차대표',
  business_number: '1234567890',
  address: '서울시 강남구',
  email: 'billing@example.com',
};

test('document key is deterministic and within Popbill length limit', () => {
  const args = { year: '2026', month: '07', renterCode: 'customer-1', documentType: 'tax_invoice' };
  const key = makeDocumentKey(args);
  assert.equal(key, makeDocumentKey(args));
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.ok(key.length <= 24);
  assert.notEqual(key, makeDocumentKey({ ...args, documentType: 'invoice' }));
});

test('builds a taxable Popbill invoice with exact totals and details', () => {
  process.env.POPBILL_CORP_NUM = '111-22-33333';
  process.env.TAX_INVOICE_PURPOSE = '청구';
  const invoice = buildTaxinvoice({
    target,
    supplier,
    documentKey: 'R202607-key-T',
    document: {
      tax_type: '과세',
      supply_amount: 150000,
      vat_amount: 15000,
      total_amount: 165000,
      items: [
        { name: '임대료', supply_amount: 100000, vat_amount: 10000 },
        { name: '관리비', supply_amount: 50000, vat_amount: 5000 },
      ],
    },
  });
  assert.equal(invoice.writeDate, '20200731');
  assert.equal(invoice.invoicerCorpNum, '1112233333');
  assert.equal(invoice.invoiceeCorpNum, '1234567890');
  assert.equal(invoice.supplyCostTotal, '150000');
  assert.equal(invoice.taxTotal, '15000');
  assert.equal(invoice.totalAmount, '165000');
  assert.equal(invoice.detailList.length, 2);
});

test('builds an individual invoice for a 13-digit resident registration number', () => {
  process.env.POPBILL_CORP_NUM = '1112233333';
  const invoice = buildTaxinvoice({
    target: { ...target, business_number: '900101-1234567' },
    supplier,
    documentKey: 'R202007-key-E',
    document: {
      tax_type: '면세',
      supply_amount: 30000,
      vat_amount: 0,
      total_amount: 30000,
      items: [{ name: '수도료', supply_amount: 30000, vat_amount: 0 }],
    },
  });
  assert.equal(invoice.invoiceeType, '개인');
  assert.equal(invoice.invoiceeCorpNum, '9001011234567');
  assert.equal(invoice.taxType, '면세');
});

test('configuration status never exposes credentials', () => {
  process.env.TAX_INVOICE_PROVIDER = 'popbill';
  process.env.POPBILL_LINK_ID = 'configured';
  process.env.POPBILL_SECRET_KEY = 'secret';
  process.env.POPBILL_CORP_NUM = '1112233333';
  process.env.POPBILL_USER_ID = 'user';
  const status = taxInvoiceProviderStatus();
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes('secret'), false);
});
