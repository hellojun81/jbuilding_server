import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeliveryMethod, billDeliveryPlan } from '../lib/billDelivery.js';
test('only supported methods and unset values are accepted', () => {
 for (const method of ['email','sms','kakao','email_sms',null,'']) assert.equal(validateDeliveryMethod({bill_delivery_method:method}).bill_delivery_method,method||null);
 for (const method of ['fax','__proto__', ['email'],true]) assert.throws(()=>validateDeliveryMethod({bill_delivery_method:method}));
 assert.deepEqual(validateDeliveryMethod({email:'test@example.com'}),{email:'test@example.com'});
});
test('email plus SMS produces two channels; missing contacts block readiness',()=>{
 const plan=billDeliveryPlan({bill_delivery_method:'email_sms',email:'test@example.com',tel:'010-1234-5678'});
 assert.deepEqual(plan.recipients.map(x=>x.channel),['email','sms']);assert.equal(plan.contactReady,true);assert.equal(plan.sendingEnabled,false);
 assert.equal(billDeliveryPlan({bill_delivery_method:'email_sms',email:'test@example.com'}).contactReady,false);
});
test('Kakao uses phone and old contracts remain unconfigured',()=>{
 assert.equal(billDeliveryPlan({bill_delivery_method:'kakao',tel:'010-1234-5678'}).recipients[0].recipient,'01012345678');
 assert.equal(billDeliveryPlan({}).contactReady,false);
 assert.deepEqual(billDeliveryPlan({}).recipients,[]);
});
