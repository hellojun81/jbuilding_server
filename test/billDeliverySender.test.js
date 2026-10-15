import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import popbill from 'popbill';
import { buildBillDelivery, renderKakao, sendBillChannel } from '../lib/billDeliverySender.js';
const bill = { key_code: '1', name: '<거래처>', building_name: '제이빌딩', bill_delivery_method: 'email_sms', email: 'test@example.com', tel: '01012345678', rent_bill: 1000000, mng_bill: 200000, vat_bill: 120000, water_bill: 30000, other_bill: 0, other_vat_bill: 0 };
const env = { BILL_DELIVERY_ENABLED: 'true', SMTP_USER: 'sender@example.com', SMTP_APP_PASSWORD: 'test-only', POPBILL_LINK_ID:'test', POPBILL_SECRET_KEY:'test', POPBILL_CORP_NUM:'1234567890', POPBILL_USER_ID:'test', BILL_SMS_SENDER:'01000000000' };
test('saved bill preview has exact total, escaped HTML and channel routing',()=>{
 const p=buildBillDelivery(bill,'2026','10',env);
 assert.equal(p.total,1350000);assert.equal(p.channels.length,2);assert.ok(p.channels.every(c=>c.ready));
 assert.ok(p.html.includes('&lt;거래처&gt;'));assert.ok(!p.html.includes('<거래처>'));
 assert.notEqual(p.revision,buildBillDelivery({...bill,email:'different@example.com'},'2026','10',env).revision);
 assert.notEqual(p.revision,buildBillDelivery(bill,'2026','10',{...env,BILL_PAYMENT_NOTICE:'다른 안내'}).revision);
});
test('missing configuration and bad saved VAT cannot be sent',async()=>{
 const p=buildBillDelivery(bill,'2026','10',{});assert.ok(p.channels.every(c=>!c.ready));
 await assert.rejects(sendBillChannel({plan:p,channel:p.channels[0]},{}));
 assert.throws(()=>buildBillDelivery({...bill,vat_bill:1},'2026','10',env));
});
test('approved template rendering rejects unsupported placeholders',()=>{
 assert.equal(renderKakao('#{상호}\\n#{합계}원',{상호:'예향',합계:'100'}),'예향\n100원');
 assert.throws(()=>renderKakao('#{unknown}',{}));
});
test('email uses recipient and attaches invoice; provider is mocked',async(t)=>{
 let sent;
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async m=>{sent=m;return{accepted:[m.to],messageId:'test-receipt'};},close(){}}));
 const plan=buildBillDelivery(bill,'2026','10',env);
 const result=await sendBillChannel({plan,channel:plan.channels[0],recipientName:bill.name,requestId:'test'},env);
 assert.equal(sent.to,bill.email);assert.equal(sent.attachments.length,1);assert.equal(result.receipt,'test-receipt');
});
test('LMS and Kakao use saved recipients and stable request IDs without fallback SMS',async(t)=>{
 const calls=[];
 t.mock.method(popbill,'config',()=>{});
 t.mock.method(popbill,'MessageService',()=>({sendLMS(...args){calls.push(args);args.at(-2)('sms-test');}}));
 t.mock.method(popbill,'KakaoService',()=>({sendATS_multi(...args){calls.push(args);args.at(-2)('kakao-test');}}));
 const plan=buildBillDelivery(bill,'2026','10',env);
 assert.equal((await sendBillChannel({plan,channel:plan.channels[1],recipientName:bill.name,requestId:'req-sms'},env)).receipt,'sms-test');
 assert.equal(calls[0][2],bill.tel);assert.equal(calls[0][9],'req-sms');
 const ke={...env,BILL_KAKAO_TEMPLATE_CODE:'T',BILL_KAKAO_TEMPLATE_TEXT:'#{상호} #{청구월} #{합계}원 #{공통안내} #{청구정보}'};
 const kp=buildBillDelivery({...bill,bill_delivery_method:'kakao'},'2026','10',ke);
 await sendBillChannel({plan:kp,channel:kp.channels[0],recipientName:bill.name,requestId:'req-kakao'},ke);
 assert.equal(calls[1][3],'');assert.equal(calls[1][7],'req-kakao');assert.equal(calls[1][5][0].rcv,bill.tel);
});
test('other charges, multiline notes and common notice appear in every email/SMS bill', () => {
 const p=buildBillDelivery({...bill,other_bill:10000,other_vat_bill:1000,etc:'비고 첫줄\n<둘째줄>'},'2026','10',{...env,BILL_COMMON_NOTICE:'연체 시 5% 안내'});
 assert.equal(p.total,1361000);
 for(const c of p.channels) { assert.match(c.content,/합계: 1,361,000원/); assert.match(c.content,/기타요금\(부가세 포함\): 11,000원/); assert.match(c.content,/비고 첫줄/); assert.match(c.content,/연체 시 5% 안내/); assert.doesNotMatch(c.content,/기타 부가세:/); }
 assert.match(p.html,/&lt;둘째줄&gt;/);assert.match(p.html,/연체 시 5% 안내/);
 assert.notEqual(p.revision,buildBillDelivery({...bill,other_bill:10000,other_vat_bill:1000,etc:'비고 첫줄\n<둘째줄>'},'2026','10',{...env,BILL_COMMON_NOTICE:'변경'}).revision);
});

test('empty notes still show an explicit note section', () => {
 const p=buildBillDelivery(bill,'2026','10',env);
 assert.match(p.text,/비고: -/); assert.match(p.html,/비고: -/);
});
