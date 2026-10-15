import test from 'node:test';
import assert from 'node:assert/strict';
import { billDeletionRevision, archiveAndDeleteBill } from '../lib/billDeletion.js';
const bill = {comp_code:'1',year:'2026',month:'10',rent_bill:1000,finish:'N'};
const args = {code:'1',year:'2026',month:'10',renter:'테스트',revision:billDeletionRevision(bill)};
function mockQuery(row=bill, linked='') {
 const calls=[];
 const query=async(s,p)=>{calls.push({s,p});if(s.startsWith('SELECT *'))return [[row]];if(s.startsWith('SELECT id'))return [s.includes(linked)&&linked?[{id:1}]:[]];return [{affectedRows:1}];};
 return {query,calls};
}
test('archives exact original before deleting the monthly bill',async()=>{
 const m=mockQuery();assert.equal(await archiveAndDeleteBill(m.query,args),1);
 const writes=m.calls.filter(c=>!c.s.startsWith('SELECT'));
 assert.ok(writes[0].s.startsWith('INSERT INTO deleted_bills'));assert.deepEqual(JSON.parse(writes[0].p[4]),bill);
 assert.ok(writes[1].s.startsWith('DELETE'));assert.deepEqual(writes[1].p,['1','2026','10']);
});
test('changed or paid bills cannot be deleted',async()=>{
 for(const row of [{...bill,rent_bill:2000},{...bill,finish:'Y'}]) {
  const m=mockQuery(row);await assert.rejects(archiveAndDeleteBill(m.query,{...args,revision:row.finish==='Y'?billDeletionRevision(row):args.revision}),{status:409});
  assert.ok(!m.calls.some(c=>c.s.startsWith('DELETE')));
 }
});
test('bank, tax and delivery history each prevent deletion',async()=>{
 for(const linked of ['bank_bill_matches','tax_invoice_issues','bill_deliveries']) {
  const m=mockQuery(bill,linked);await assert.rejects(archiveAndDeleteBill(m.query,args),{status:409});
  assert.ok(!m.calls.some(c=>c.s.startsWith('INSERT')||c.s.startsWith('DELETE')));
 }
});
test('failed archive never proceeds to deletion',async()=>{
 const m=mockQuery();const q=async(s,p)=>{if(s.startsWith('INSERT'))throw Error('archive failed');return m.query(s,p)};
 await assert.rejects(archiveAndDeleteBill(q,args));assert.ok(!m.calls.some(c=>c.s.startsWith('DELETE')));
});
