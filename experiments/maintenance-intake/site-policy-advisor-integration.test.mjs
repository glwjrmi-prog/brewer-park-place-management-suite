import test from 'node:test';
import assert from 'node:assert/strict';
import {requestAdvisor,assertAdvisorConfiguration} from './site-policy-advisor-integration.mjs';

const endpoint='https://bpp-resident-advisor-staging.glwjrmi.workers.dev/';
const mkResponse=(status,payload)=>({ok:status>=200&&status<300,status,async json(){return payload}});
test('validated answer includes filtered source document names',async()=>{
  let body;
  const result=await requestAdvisor({endpoint,question:' Who repairs garage doors? ',token:'verified-token',fetcher:async (_url,options)=>{
    body=JSON.parse(options.body);
    return mkResponse(200,{answer:'Association repairs the door.',sourceDocuments:['Recorded Master Deed','Recorded Master Deed',42,'Bylaws']});
  }});
  assert.deepEqual(body,{question:'Who repairs garage doors?',turnstileToken:'verified-token'});
  assert.deepEqual(result,{ok:true,status:200,answer:'Association repairs the door.',sourceDocuments:['Recorded Master Deed','Bylaws']});
});
test('missing verification token never makes a network call',async()=>{
  let called=false;
  const r=await requestAdvisor({endpoint,question:'Parking?',token:'',fetcher:async()=>{called=true;throw Error('should not run')}});
  assert.equal(r.status,403);assert.equal(called,false);
});
test('oversized question never makes a network call',async()=>{
  let called=false;
  const r=await requestAdvisor({endpoint,question:'x'.repeat(2001),token:'x',fetcher:async()=>{called=true}});
  assert.equal(r.status,400);assert.equal(called,false);
});
test('quota response uses clear generic text',async()=>{
  const r=await requestAdvisor({endpoint,question:'Parking?',token:'x',fetcher:async()=>mkResponse(429,{error:'private message'})});
  assert.equal(r.status,429);assert.match(r.message,/usage limit/);assert.doesNotMatch(r.message,/private/);
});
test('invalid successful answer fails safely',async()=>{
  const r=await requestAdvisor({endpoint,question:'Parking?',token:'x',fetcher:async()=>mkResponse(200,{answer:''})});
  assert.equal(r.status,502);
});
test('network failure gives safe message',async()=>{
  const r=await requestAdvisor({endpoint,question:'Parking?',token:'x',fetcher:async()=>{throw Error('network secret')}});
  assert.equal(r.status,504);assert.doesNotMatch(r.message,/secret/);
});
test('integration rejects wrong actual webpage hostname',()=>{
  assert.throws(()=>assertAdvisorConfiguration({endpoint,siteKey:'0x4AAAAAAGNR2JDRq6CS3bIY',expectedPageHostname:'bpp-resident-advisor-staging.glwjrmi.workers.dev'},'bppcondos.org'),/hostname/);
});
test('production legacy endpoint cannot be reused',()=>{
  assert.throws(()=>assertAdvisorConfiguration({endpoint:'https://bpp-resident-policy-advisor.glwjrmi.workers.dev/',siteKey:'0x4AAAAAAGNR2JDRq6CS3bIY',expectedPageHostname:'bppcondos.org'},'bppcondos.org'),/Legacy/);
});
