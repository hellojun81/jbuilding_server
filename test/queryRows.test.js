import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueryRows, normalizeQueryValue } from '../lib/queryRows.js';

test('converts MySQL binary text values to UTF-8 strings', () => {
  assert.equal(normalizeQueryValue(Buffer.from('예향', 'utf8')), '예향');
});

test('normalizes export rows without changing numeric values', () => {
  assert.deepEqual(normalizeQueryRows([{
    이름: Buffer.from('제이쿨', 'utf8'),
    년: Buffer.from('2026', 'utf8'),
    임대료: 100000,
  }]), [{ 이름: '제이쿨', 년: '2026', 임대료: 100000 }]);
});
