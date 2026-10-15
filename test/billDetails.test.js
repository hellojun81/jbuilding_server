import test from 'node:test';
import assert from 'node:assert/strict';
import { billDetails, validateCommonDetails } from '../lib/billDetails.js';
import { buildBillDelivery } from '../lib/billDeliverySender.js';
test('month defaults use exact dates, including leap years, and contract room',()=>{
 assert.deepEqual(billDetails({}, {address:'101호'}, '2028','02'), {dueDate:'2028-02-29',periodStart:'2028-02-01',periodEnd:'2028-02-29',room:'101호',arrears:0});
});
test('invalid dates, reversed periods and invalid arrears are rejected',()=>{
 for(const input of [{dueDate:'2026-02-30'},{periodStart:'2026-10-31',periodEnd:'2026-10-01'},{arrears:-1},{arrears:1.5},{arrears:true}]) assert.throws(()=>billDetails(input,{},'2026','10'));
 assert.throws(()=>validateCommonDetails({account:123}));
});
test('current month and arrears are separate and metadata changes invalidate preview',()=>{
 const bill={name:'테스트',rent_bill:1000,mng_bill:0,vat_bill:100,water_bill:0,other_bill:0,other_vat_bill:0,deliveryDetails:{...billDetails({arrears:500},{address:'101호'},'2026','10'),bank:'테스트은행',account:'123',accountHolder:'예금주',contact:'02-123-4567'}};
 const plan=buildBillDelivery(bill,'2026','10',{});
 assert.equal(plan.total,1100);assert.equal(plan.payable,1600);
 for(const text of ['납부기한: 2026-10-31','당월 청구액: 1,100원','이전 미납금: 500원','총 납부금액: 1,600원','테스트 (101호)','예금주: 예금주']) {assert.ok(plan.text.includes(text));assert.ok(plan.html.includes(text));}
 assert.notEqual(plan.revision,buildBillDelivery({...bill,deliveryDetails:{...bill.deliveryDetails,arrears:0}},'2026','10',{}).revision);
});
