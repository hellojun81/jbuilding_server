import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBillingAmounts } from '../lib/billingAmounts.js';
const current = { rent_bill: 1350000, mng_bill: 530000, vat_bill: 188000, water_bill: 30000, other_bill: 0, other_vat_bill: 0 };
test('reject stale VAT on the reported payment edit', () => {
  assert.throws(() => validateBillingAmounts({ ...current, rent_bill: 1410000, mng_bill: 560000 }), { status: 400 });
});
test('accept consistent saved amounts and recalculate omitted VAT on partial updates', () => {
  const result = validateBillingAmounts({ rent_bill: 1410000, mng_bill: 560000 }, current);
  assert.equal(result.vat_bill, 197000);
  assert.equal(result.water_bill, 30000);
  assert.equal(validateBillingAmounts(result).vat_bill, 197000);
});
test('reject invalid amounts and other VAT mismatch', () => {
  for (const amount of [-1, 'abc', 1.5, Infinity, {}, true]) assert.throws(() => validateBillingAmounts({ rent_bill: amount }));
  assert.throws(() => validateBillingAmounts({ other_bill: 10000, other_vat_bill: 0 }));
});
test('round consistently per taxable item and preserve memo-only edits', () => {
  assert.equal(validateBillingAmounts({ rent_bill: 15, mng_bill: 15 }).vat_bill, 4);
  assert.deepEqual(validateBillingAmounts({ etc: '메모' }, current), { etc: '메모' });
});
