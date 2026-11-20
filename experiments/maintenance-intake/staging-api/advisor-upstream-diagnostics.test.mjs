import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseProvider,probeOpenAI} from './advisor-upstream-diagnostics.mjs';
const env={OPENAI_API_KEY:'test-secret-do-not-log'};
test('staging probe sends only synthetic prompt; never leaks key or answer',async()=>{
 const a=await diagnoseProvider(env,{fetcher:async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal(opts.headers.Authorization,'Bearer test-secret-do-not-log');
  const payload=JSON.parse(opts.body);
  assert.equal(payload.input,'Reply exactly with OK.');
  assert.equal(payload.store,false);
  return {ok:true,status:200,json:async()=>({output:[{type:'message',content:[{text:'Private model output should not appear'}]}]})};
 }});
 assert.equal(a.basic.ok,true);assert.equal(a.web.ok,true);
 assert.equal(a.inference,'BASIC_AND_WEB_TOOL_AVAILABLE');
 assert.equal(JSON.stringify(a).includes('test-secret'),false);
 assert.equal(JSON.stringify(a).includes('Private model output'),false);
});
test('quota denial returns safely classified code without secrets',async()=>{
 const r=await diagnoseProvider(env,{fetcher:async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota',message:'secret upstream details'}})})});
 assert.equal(r.basic.kind,'QUOTA_OR_BILLING');assert.equal(r.basic.providerCode,'insufficient_quota');
 assert.equal(r.web,null);assert.equal(JSON.stringify(r).includes('secret upstream'),false);
});
test('missing secret binding is reported but no key required',async()=>{
 const r=await probeOpenAI({env:{}});
 assert.equal(r.kind,'MISSING_SECRET_BINDING');assert.equal(r.ok,false);
});
test('web tool failure distinguishable from successful basic model',async()=>{
 let count=0;
 const r=await diagnoseProvider(env,{fetcher:async()=>{
  count++;
  return count===1?{ok:true,status:200,json:async()=>({output:[]})}:{ok:false,status:500,json:async()=>({error:{code:'other',message:'secret'}})};
 }});
 assert.equal(r.basic.ok,true);assert.equal(r.web.ok,false);assert.equal(r.web.kind,'PROVIDER_ERROR');assert.equal(r.inference,'WEB_TOOL_OR_LONG_RUNNING_REQUEST_PROBLEM');
});
test('abort timeout returns bounded safe diagnostic',async()=>{
 const r=await probeOpenAI({env,timeoutMs:110,fetcher:async(_url,opts)=>new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('secret exception')),{once:true}))});
 assert.equal(r.kind,'TIMEOUT');assert.equal(JSON.stringify(r).includes('secret'),false);
});
