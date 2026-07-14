import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCashReceipt,
  normalizeTaxInvoice,
  validateCollectionPeriod,
} from '../lib/vatDataProvider.js';

test('accepts a quarter and converts dates to Popbill format', () => {
  assert.deepEqual(validateCollectionPeriod('2026-04-01', '2026-06-30'), {
    startDate: '20260401',
    endDate: '20260630',
  });
});

test('rejects periods longer than the Popbill three-month limit', () => {
  assert.throws(
    () => validateCollectionPeriod('2026-01-01', '2026-04-01'),
    /최대 3개월/,
  );
});

test('normalizes a sales tax invoice for the VAT table', () => {
  assert.deepEqual(normalizeTaxInvoice({
    ntsconfirmNum: '202601010000000000000001',
    writeDate: '20260110',
    invoiceeCorpName: '거래처',
    invoiceeCorpNum: '1234567890',
    supplyCostTotal: '100000',
    taxTotal: '10000',
    totalAmount: '110000',
    taxType: '과세',
  }), {
    id: '202601010000000000000001',
    source: 'tax_invoice',
    sourceLabel: '매출 세금계산서',
    direction: 'SELL',
    date: '20260110',
    partyName: '거래처',
    partyNumber: '1234567890',
    supplyAmount: 100000,
    vatAmount: 10000,
    totalAmount: 110000,
    status: '과세',
  });
});

test('normalizes cancelled cash receipts as negative amounts', () => {
  const result = normalizeCashReceipt({
    ntsconfirmNum: '202601010000000000000002',
    tradeDate: '20260111',
    tradeType: '취소거래',
    franchiseCorpName: '매입처',
    supplyCost: '50000',
    tax: '5000',
    totalAmount: '55000',
  }, 'BUY');
  assert.equal(result.supplyAmount, -50000);
  assert.equal(result.vatAmount, -5000);
  assert.equal(result.totalAmount, -55000);
  assert.equal(result.partyName, '매입처');
});
