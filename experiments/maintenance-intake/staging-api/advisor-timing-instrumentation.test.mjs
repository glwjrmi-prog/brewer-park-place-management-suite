import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redactlessTimings,readAdvisorResponse,createStructuredReporter} from './advisor-timing-instrumentation.mjs';
test('upstream timing logs safe metadata but never private content',async()=>{
 const events=[];const token='VERY_PRIVATE_SECRET';const question='private resident Unit 777';
 const request=redactlessTimings({emit:x=>events.push(x),fetcher:async(_url,opts)=>{
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  return {status:200,json:async()=>({answer:question})};
 }});
 const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({question})});
 const payload=await readAdvisorResponse(response,{emit:x=>events.push(x)});
 assert.equal(payload.answer,question);
 assert.deepEqual(events.map(x=>x.kind),['request_start','response_headers','response_body_complete']);
 assert.equal(JSON.stringify(events).includes(token),false);
 assert.equal(JSON.stringify(events).includes(question),false);
 assert.equal(events[1].httpStatus,200);
});
test('failed network logs phase without leaking the exception',async()=>{
 const events=[];const request=redactlessTimings({emit:x=>events.push(x),fetcher:async()=>{throw Error('confidential API token 123456')}});
 await assert.rejects(()=>request('https://example.test'),/confidential/);
 assert.equal(events.at(-1).kind,'request_failed');
 assert.equal(JSON.stringify(events).includes('123456'),false);
});
test('failed JSON parsing logs a safe error',async()=>{
 const events=[];
 await assert.rejects(()=>readAdvisorResponse({json:async()=>{throw Error('private response body')}},{emit:x=>events.push(x)}),/private response/);
 assert.equal(events[0].kind,'response_body_failed');
 assert.equal(JSON.stringify(events).includes('private response body'),false);
});
test('simple reporter emits exactly structured entries',()=>{
 const logs=[],report=createStructuredReporter({log:s=>logs.push(s)});
 report({type:'bpp_advisor_upstream',kind:'request_start',elapsedMs:0});
 assert.deepEqual(JSON.parse(logs[0]),{type:'bpp_advisor_upstream',kind:'request_start',elapsedMs:0});
});
