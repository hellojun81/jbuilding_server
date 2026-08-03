import assert from 'node:assert/strict';
import test from 'node:test';
import { bankCollectionSucceeded } from '../lib/bankTransactionProvider.js';

test('팝빌 계좌수집이 완료되고 성공 사유인 경우만 성공으로 판정한다', () => {
  assert.equal(bankCollectionSucceeded({ jobState: 3, errorCode: 1, errorReason: '수집 완료' }), true);
});

test('완료 코드여도 실패 사유가 있으면 0건 성공으로 처리하지 않는다', () => {
  assert.equal(bankCollectionSucceeded({ jobState: 3, errorCode: 1, errorReason: '크레딧 부족' }), false);
});

test('수집이 진행 중이면 성공으로 처리하지 않는다', () => {
  assert.equal(bankCollectionSucceeded({ jobState: 2, errorCode: 1, errorReason: '' }), false);
});
