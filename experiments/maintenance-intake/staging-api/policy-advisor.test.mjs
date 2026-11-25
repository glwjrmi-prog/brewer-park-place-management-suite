import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askAdvisor,AdvisorUnavailableError,ADVISOR_URL} from './policy-advisor.mjs';
const valid={area:'Exterior of unit',category:'Siding'};
test('safe advisor prompt contains general category but no resident fields',async()=>{
 const result=await askAdvisor({...valid,fetcher:async(url,opts)=>{
  assert.equal(url,ADVISOR_URL);
  assert.equal(opts.method,'POST');
  const body=JSON.parse(opts.body);
  assert.equal(Object.keys(body).join(','),'question');
  assert.ok(body.question.includes('Siding'));
  assert.ok(!body.question.includes('Unit 12'));
  return {ok:true,json:async()=>({answer:'No specific document citation verified.'})};
 }});
 assert.ok(result.source.includes('unverified'));
});
test('timeout cancels outbound request and uses safe error',async()=>{
 const start=Date.now();
 await assert.rejects(()=>askAdvisor({...valid,timeoutMs:40,fetcher:async(_url,opts)=>{
  await new Promise((resolve,reject)=>{
   if(opts.signal.aborted)reject(new Error('cancelled'));
   opts.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});
  });
 }}),(e)=>e instanceof AdvisorUnavailableError && e.code==='TIMEOUT_OR_ABORT' && !/credential|token|worker/i.test(e.message));
 assert.ok(Date.now()-start<2000);
});
test('upstream rejection does not expose private errors or raw answer',async()=>{
 await assert.rejects(()=>askAdvisor({...valid,fetcher:async()=>{throw new Error('private upstream credential value')}}),
  (e)=>e instanceof AdvisorUnavailableError&&e.code==='NETWORK_FAILURE'&&!e.message.includes('credential'));
});
test('invalid upstream payload and non-OK status are rejected',async()=>{
 await assert.rejects(()=>askAdvisor({...valid,fetcher:async()=>({ok:true,json:async()=>({answer:''})})}),
 (e)=>e.code==='INVALID_ANSWER');
 await assert.rejects(()=>askAdvisor({...valid,fetcher:async()=>({ok:false,status:503})}),
 (e)=>e.code==='UPSTREAM_STATUS');
});
test('caller cancellation is respected',async()=>{
 const ctrl=new AbortController();ctrl.abort();
 await assert.rejects(()=>askAdvisor({...valid,signal:ctrl.signal,fetcher:async()=>{throw new Error('should not call fetch')}}),
 (e)=>e.code==='ABORTED');
});
