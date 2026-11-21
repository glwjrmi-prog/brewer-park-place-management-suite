import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestResidentAdvice,LIVE_ADVISOR_URL,ResidentAdvisorError} from './resident-advisor-browser.mjs';
test('matches live frontend POST JSON contract, returns plain answer',async()=>{
 let called=0;
 const answer=await requestResidentAdvice('  What about garage doors?  ',{fetcher:async(url,opts)=>{
  called++;assert.equal(url,LIVE_ADVISOR_URL);
  assert.equal(opts.method,'POST');assert.equal(opts.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(opts.body),{question:'What about garage doors?'});
  return {ok:true,json:async()=>({answer:'Refer to Board and documents.'})};
 }});
 assert.equal(called,1);assert.equal(answer,'Refer to Board and documents.');
});
test('abort on stalled request and no retries',async()=>{
 let calls=0;
 await assert.rejects(()=>requestResidentAdvice('Maintenance?',{timeoutMs:110,fetcher:(_url,opts)=>{
  calls++;return new Promise((_res,rej)=>opts.signal.addEventListener('abort',()=>rej(new Error('underlying secret')), {once:true}));
 }}),e=>e.code==='TIMEOUT'&&!e.message.includes('secret'));
 assert.equal(calls,1);
});
test('missing answer and upstream errors are safely reported',async()=>{
 await assert.rejects(()=>requestResidentAdvice('Maintenance?',{fetcher:async()=>({ok:true,json:async()=>({status:'processing'})})}),e=>e.code==='BAD_ANSWER');
 await assert.rejects(()=>requestResidentAdvice('Maintenance?',{fetcher:async()=>({ok:false,status:429,json:async()=>({error:'private'})})}),e=>e.code==='HTTP_ERROR'&&!e.message.includes('private'));
});
test('already canceled and invalid questions never reach endpoint',async()=>{
 let called=0;const fetcher=async()=>{called++};
 const ctrl=new AbortController();ctrl.abort();
 await assert.rejects(()=>requestResidentAdvice('Question',{signal:ctrl.signal,fetcher}),e=>e.code==='CANCELED');
 await assert.rejects(()=>requestResidentAdvice('  ',{fetcher}),e=>e.code==='INVALID_QUESTION');
 assert.equal(called,0);
});
