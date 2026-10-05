import test from 'node:test';
import assert from 'node:assert/strict';
import { taxDocumentData, applyAmountBasis, assertAmountRevision } from '../lib/taxInvoiceAmounts.js';
const row = { renter_code: '1', renter_name: '테스트', rent_supply: 1000000, management_supply: 200000, base_vat: 100000, other_supply: 10000, other_vat: 1000, water_supply: 30000 };
const source = () => taxDocumentData(row, '2026', '09');
function balanced(target) {
  for (const d of target.documents) {
    assert.equal(d.items.reduce((s, i) => s + i.supply_amount, 0), d.supply_amount);
    assert.equal(d.items.reduce((s, i) => s + i.vat_amount, 0), d.vat_amount);
    assert.equal(d.supply_amount + d.vat_amount, d.total_amount);
  }
}
test('explicit billed basis preserves gross amount, fixes inconsistent VAT and leaves original unchanged', () => {
  const original = source(); const t = applyAmountBasis(original, 'billed');
  assert.equal(t.issue_amount, 1341000); assert.equal(t.exempt_amount, 30000); balanced(t);
  assert.equal(original.base_vat_matches, false); assert.equal(original.rent_supply, 1000000);
});
test('paid basis uses linked deposit with exact won totals, retaining exempt water', () => {
  for (const deposit_amount of [1341001, 1300000, 1500000, 30001]) {
    const t = applyAmountBasis(source(), 'paid', { transaction_id: 9, deposit_amount });
    assert.equal(t.issue_amount, deposit_amount); assert.equal(t.exempt_amount, 30000); balanced(t);
  }
});
test('missing deposit, unsupported basis and nonpositive taxable amount are rejected', () => {
  assert.throws(() => applyAmountBasis(source(), 'paid'));
  assert.throws(() => applyAmountBasis(source(), 'custom'));
  for (const deposit_amount of [30000, 100, -1, NaN, 30000.5]) {
    assert.throws(() => applyAmountBasis(source(), 'paid', { deposit_amount }));
  }
});
test('unchosen basis retains existing VAT validation', () => {
  const t = applyAmountBasis(source()); assert.equal(t.base_vat_matches, false); assert.equal(t.amount_basis, '');
});
test('changed billing data, payment and basis invalidate the reviewed snapshot', () => {
  const payment = { transaction_id: 9, deposit_amount: 1500000 };
  const t = applyAmountBasis(source(), 'paid', payment);
  assertAmountRevision(t, t.amount_revision);
  assert.throws(() => assertAmountRevision(t, undefined));
  for (const changed of [applyAmountBasis(source(), 'billed', payment), applyAmountBasis(source(), 'paid', { ...payment, deposit_amount: 1500001 }), applyAmountBasis(taxDocumentData({ ...row, base_vat: 120000 }, '2026', '09'), 'paid', payment)]) {
    assert.throws(() => assertAmountRevision(changed, t.amount_revision));
  }
});
