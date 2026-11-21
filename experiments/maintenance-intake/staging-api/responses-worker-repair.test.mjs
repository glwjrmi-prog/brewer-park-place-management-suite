import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchPolicyAnswer,extractAnswer,PolicyProviderError} from './responses-worker-repair.mjs';
const prior={model:'gpt-5-mini',instructions:'BPP documents private and unchanged',input:'Which rule applies?',tools:[{type:'web_search'}],store:false};
test('preserves exact historical instruction, model and tool payload, returns nested output',async()=>{
 const phases=[];
 const answer=await fetchPolicyAnswer({apiKey:'secret-key-not-for-logs',requestBody:prior,onPhase:p=>phases.push(p),fetcher:async(url,opts)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(opts.method,'POST');assert.equal(opts.headers.Authorization,'Bearer secret-key-not-for-logs');
   assert.deepEqual(JSON.parse(opts.body),prior);
   return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'reasoning',content:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'ANSWER\\nGOVERNING PROVISIONS'}]}]})};
 }});
 assert.equal(answer,'ANSWER\\nGOVERNING PROVISIONS');
 assert.deepEqual(phases.map(p=>p.phase),['upstream_request_start','upstream_headers_received','upstream_body_received','answer_extracted']);
 assert.ok(!JSON.stringify(phases).includes('secret-key'));
 assert.ok(!JSON.stringify(phases).includes(prior.instructions));
});
test('accepts Responses API convenience output_text',()=>{
 assert.equal(extractAnswer({status:'completed',output_text:' Board answer '}),'Board answer');
});
test('does not use tool output, reasoning or incomplete answer as final response',()=>{
 assert.throws(()=>extractAnswer({status:'incomplete',output_text:'Partial answer'}),(e)=>e.reason==='RESPONSE_NOT_COMPLETED');
 assert.throws(()=>extractAnswer({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'reasoning',summary:[]}]}),(e)=>e.reason==='EMPTY_OUTPUT');
 assert.equal(extractAnswer({status:'completed',output:[{type:'message',role:'user',content:[{type:'output_text',text:'wrong speaker'}]},{type:'message',role:'assistant',content:[{type:'output_text',text:'Correct'}]}]}),'Correct');
});
test('returns safe status without leaking error message or token',async()=>{
 const phases=[];
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'secret',requestBody:prior,onPhase:x=>phases.push(x),fetcher:async()=>({ok:false,status:429,json:async()=>({error:{message:'private key'}})})}),
 (e)=>e instanceof PolicyProviderError&&e.reason==='UPSTREAM_STATUS'&&e.status===429&&!e.message.includes('key'));
 assert.ok(!JSON.stringify(phases).includes('secret'));
});
test('bounds hung request and returns generic timeout error',async()=>{
 const phases=[];
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'secret',requestBody:prior,timeoutMs:110,onPhase:x=>phases.push(x),fetcher:(_url,opts)=>new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('private text')),{once:true}))}),
 (e)=>e.reason==='TIMEOUT_OR_ABORT'&&!e.message.includes('private'));
 assert.ok(phases.some(p=>p.phase==='upstream_failed'));
});
test('abort from original caller is respected',async()=>{
 const ac=new AbortController();ac.abort();
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'secret',requestBody:prior,signal:ac.signal,fetcher:()=>{throw Error('should not call')}}),
 (e)=>e.reason==='ABORTED');
});
test('JSON parse error does not expose provider body',async()=>{
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'secret',requestBody:prior,fetcher:async()=>({ok:true,status:200,json:async()=>{throw new Error('provider response secret')}})}),
 (e)=>e.reason==='UPSTREAM_NETWORK_OR_PARSE'&&!e.message.includes('secret'));
});
test('explicit store false overrides unsafe request payload option',async()=>{
 await fetchPolicyAnswer({apiKey:'secret',requestBody:{...prior,store:true},fetcher:async(_url,opts)=>{
  assert.equal(JSON.parse(opts.body).store,false);
  return {ok:true,status:200,json:async()=>({output_text:'OK'})};
 }});
});
