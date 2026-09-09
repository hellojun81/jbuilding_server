import test from 'node:test';
import assert from 'node:assert/strict';
import { bankLedgerFilters, bankLedgerWhere } from '../lib/bankLedger.js';

test('전체 거래내역 조회 조건을 날짜와 거래 구분으로 생성한다', () => {
  const filters = bankLedgerFilters({
    startDate: '2026-08-01', endDate: '2026-08-31', type: 'withdrawal', search: '임대료',
  });
  assert.deepEqual(filters, {
    startDate: '2026-08-01', endDate: '2026-08-31', transactionType: 'withdrawal', search: '임대료',
  });
  const where = bankLedgerWhere(filters);
  assert.match(where.whereSql, /withdrawal_amount > 0/);
  assert.match(where.whereSql, /CONCAT_WS/);
  assert.deepEqual(where.values, ['2026-08-01', '2026-08-31', '%임대료%']);
});

test('전체 거래내역은 최대 1년까지만 조회한다', () => {
  assert.throws(
    () => bankLedgerFilters({ startDate: '2025-01-01', endDate: '2026-01-02' }),
    /최대 1년/,
  );
});

test('잘못된 날짜와 거래 구분을 거부한다', () => {
  assert.throws(
    () => bankLedgerFilters({ startDate: '2026-02-30', endDate: '2026-03-01' }),
    /올바른 날짜/,
  );
  assert.throws(
    () => bankLedgerFilters({ startDate: '2026-03-01', endDate: '2026-03-31', type: 'transfer' }),
    /거래 구분/,
  );
});
