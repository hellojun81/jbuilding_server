import assert from 'node:assert/strict';
import test from 'node:test';
import { billTotal, matchCandidates, normalizeMatchText } from '../lib/bankMatching.js';

test('법인 표기와 공백을 제거해 입금자명을 비교한다', () => {
  assert.equal(normalizeMatchText('(주) 예 향'), '예향');
});

test('청구서의 모든 금액 항목을 합산한다', () => {
  assert.equal(billTotal({ rent_bill: 100, mng_bill: 20, vat_bill: 12, water_bill: 3, other_bill: 4, other_vat_bill: 1 }), 140);
});

test('금액과 이름이 일치하는 후보를 우선 제안한다', () => {
  const result = matchCandidates(
    { deposit_amount: 1100, remark1: '예향 임대료' },
    [
      { renter_code: 1, renter_name: '예향', rent_bill: 1000, vat_bill: 100 },
      { renter_code: 2, renter_name: '다른업체', rent_bill: 1000, vat_bill: 100 },
    ],
  );
  assert.equal(result.suggested.renterCode, '1');
  assert.equal(result.candidates.length, 2);
});

test('금액 후보가 여러 개이고 이름이 없으면 자동 제안하지 않는다', () => {
  const result = matchCandidates(
    { deposit_amount: 1000, remark1: '알수없음' },
    [
      { renter_code: 1, renter_name: '가', rent_bill: 1000 },
      { renter_code: 2, renter_name: '나', rent_bill: 1000 },
    ],
  );
  assert.equal(result.suggested, null);
});

test('과거 수동 매칭 거래처를 동일 금액 후보 중 우선 제안한다', () => {
  const result = matchCandidates(
    { deposit_amount: 1000, remark1: '거래처와 다른 입금자명' },
    [
      { renter_code: 1, renter_name: '가업체', rent_bill: 1000 },
      { renter_code: 2, renter_name: '나업체', rent_bill: 1000 },
    ],
    { preferredRenterCode: '2' },
  );
  assert.equal(result.suggested.renterCode, '2');
  assert.equal(result.suggested.confidence, 'learned');
});

test('금액이 다른 미수납 청구서도 강제 수동 선택 후보로 제공한다', () => {
  const result = matchCandidates(
    { deposit_amount: 900, remark1: '입금자' },
    [{ renter_code: 1, renter_name: '가업체', rent_bill: 1000 }],
  );
  assert.equal(result.suggested, null);
  assert.equal(result.candidates[0].exactAmount, false);
  assert.equal(result.candidates[0].difference, -100);
  assert.equal(result.candidates[0].confidence, 'manual');
});

test('후보에 실제 청구월과 월별 고유 선택키를 포함한다', () => {
  const result = matchCandidates(
    { deposit_amount: 1000, remark1: '입금자' },
    [
      { renter_code: 38, renter_name: '백채김치찌개', bill_year: '2026', bill_month: '08', rent_bill: 1000 },
      { renter_code: 38, renter_name: '백채김치찌개', bill_year: '2026', bill_month: '09', rent_bill: 1100 },
    ],
  );
  assert.equal(result.candidates[0].candidateKey, '38:2026-08');
  assert.equal(result.candidates[0].billYear, '2026');
  assert.equal(result.candidates[0].billMonth, '08');
});

test('미수납 청구서에 남은 기존 매칭 정보를 후보에 포함한다', () => {
  const result = matchCandidates(
    { deposit_amount: 3500000, remark1: '이명호' },
    [{
      renter_code: 20, renter_name: '스시다바', bill_year: '2026', bill_month: '08',
      rent_bill: 2890000, mng_bill: 210000, vat_bill: 310000, water_bill: 56324,
      existing_match_id: 27, existing_transaction_id: 1,
      existing_deposit_amount: 2600000, existing_payer: '이명호',
    }],
  );
  assert.equal(result.candidates[0].existingMatchId, 27);
  assert.equal(result.candidates[0].existingDepositAmount, 2600000);
  assert.equal(result.candidates[0].existingPayer, '이명호');
});
