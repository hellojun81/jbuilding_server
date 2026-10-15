import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillDeliveryRouter } from '../lib/billDeliveryRoutes.js';
function setup(send = async () => ({ receipt: 'fake' })) {
 const rows=[];let gate=Promise.resolve();
 const query=async (s,p)=>{
  if(s.includes('FROM bill_detail_settings')) return [[]];
  if(s.includes('FROM bill_settings')) return [[]];
  if(s.includes('FROM jbuildingmng'))return [[{key_code:'1',name:'테스트'}]];
  if(s.startsWith('SELECT channel'))return [rows];
  if(s.startsWith('INSERT')){rows.push({channel:p[3],request_id:p[4],status:'queued'});return [{affectedRows:1}];}
  if(s.startsWith('UPDATE')){Object.assign(rows.find(r=>r.request_id===p[3]),{status:p[0],receipt:p[1]});return [{affectedRows:1}];}
  throw Error(s);
 };
 const database={query,transaction:async cb=>{const previous=gate;let release;gate=new Promise(r=>{release=r});await previous;try{return await cb(query)}finally{release()}}};
 const build=()=>({revision:'revision',channels:[{channel:'email',recipient:'test@example.com',content:'test',ready:true}]});
 const router=createBillDeliveryRouter({database,build,send});
 const handler=router.stack.find(layer=>layer.route?.path==='/:renter/deliver').route.stack[0].handle;
 const call=async(extra={})=>{let result,error;await handler({params:{renter:'테스트'},body:{year:'2026',month:'10',revision:'revision',confirmation:'SEND_BILL',...extra}}, {json:v=>{result=v}},e=>{error=e});return {result,error};};
 return {call,rows};
}
test('simultaneous double-click sends a saved monthly channel only once',async()=>{
 let count=0;const s=setup(async()=>{count++;return {receipt:'fake'}});
 const results=await Promise.all([s.call(),s.call()]);assert.equal(count,1);assert.equal(s.rows.length,1);
 assert.equal(results.filter(r=>r.error?.status===409).length,1);
});
test('uncertain provider results never allow automatic duplicate sending',async()=>{
 let count=0;const s=setup(async()=>{count++;throw Error('timeout')});await s.call();
 assert.equal(s.rows[0].status,'unknown');assert.equal((await s.call()).error.status,409);assert.equal(count,1);
});
test('stale preview and missing confirmation do not reserve or send',async()=>{
 const s=setup(()=>{throw Error('must not send')});assert.equal((await s.call({revision:'stale'})).error.status,409);
 assert.equal((await s.call({confirmation:''})).error.status,400);assert.equal(s.rows.length,0);
});

test('history filters are parameterized, paginated and include inactive renters', async () => {
 const calls=[];
 const router=createBillDeliveryRouter({database:{query:async(s,p)=>{calls.push([s,p]);return s.includes('COUNT(*)')?[[{total:21}]]:[[{id:1,status:'submitted'}]];}}});
 const handler=router.stack.find(l=>l.route?.path==='/delivery-history').route.stack[0].handle;
 let result,error;
 await handler({query:{year:'2026',month:'10',channel:'sms',status:'submitted',page:'1'}},{json:v=>{result=v}},e=>{error=e});
 assert.equal(error,undefined);assert.equal(result.total,21);
 assert.deepEqual(calls[1][1],['2026','10','sms','submitted',20]);
 assert.match(calls[1][0],/LEFT JOIN/);assert.doesNotMatch(calls[1][0],/dealYN/);
 await handler({query:{year:'2026',month:'10',channel:'invalid'}},{json:()=>{}},e=>{error=e});
 assert.equal(error.status,400);assert.equal(calls.length,2);
});
test('history details reject invalid ids and return 404 for missing records', async () => {
 const router=createBillDeliveryRouter({database:{query:async()=>[[]]}});
 const handler=router.stack.find(l=>l.route?.path==='/delivery-history/:id').route.stack[0].handle;
 for(const [id,status] of [['invalid',400],['42',404]]) {
  let error;await handler({params:{id}},{json:()=>assert.fail('unexpected success')},e=>{error=e});assert.equal(error.status,status);
 }
});
test('common notice is persisted and rejects oversized values', async () => {
 let saved; const router=createBillDeliveryRouter({database:{query:async(s,p)=>{if(s.includes('INSERT INTO bill_settings')) saved=p;return [{}];}}});
 const handler=router.stack.find(l=>l.route?.path==='/settings' && l.route.methods.put).route.stack[0].handle;
 let result,error;
 await handler({body:{notice:' 안내 문구 '}},{json:v=>{result=v}},e=>{error=e});
 assert.equal(error,undefined);assert.deepEqual(saved,['안내 문구']);assert.equal(result.notice,'안내 문구');
 await handler({body:{notice:'a'.repeat(1001)}},{json:()=>{}},e=>{error=e});assert.equal(error.status,400);
});
test('preview uses unsaved note, supports clearing and validates input', async () => {
 let rendered;
 const router=createBillDeliveryRouter({database:{query:async(s)=>s.includes('FROM jbuildingmng')?[[{key_code:'1',etc:'저장된 비고'}]]:[[]]},build:(bill)=>{rendered=bill.etc;return {};}});
 const handler=router.stack.find(l=>l.route?.path==='/:renter/delivery-preview').route.stack[0].handle;
 for (const note of ['청구서 테스트','']) {
  let error; await handler({method:'POST',params:{renter:'테스트'},body:{year:'2026',month:'10',note}},{json:()=>{}},e=>{error=e});
  assert.equal(error,undefined);assert.equal(rendered,note);
 }
 let error;await handler({method:'POST',params:{renter:'테스트'},body:{year:'2026',month:'10',note:123}},{json:()=>{}},e=>{error=e});assert.equal(error.status,400);
});
