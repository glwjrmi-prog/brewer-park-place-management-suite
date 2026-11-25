// Regression coverage for the actual BPP Resident Advisor request observed
// in Cloudflare's live editor on 2026-11-20. All network responses are MOCKED.
// Does not load any actual resident question, governing-document content,
// OpenAI secret or live vector store.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchPolicyAnswer,PolicyProviderError} from './responses-worker-repair.mjs';
const expectedStore='vs_6a8a42e54954819186e4e74e5bc3d2da';
const liveRequest={
 model:'gpt-5',
 instructions:'[governing document instructions unchanged]',
 input:'[synthetic policy question]',
 tools:[{type:'file_search',vector_store_ids:[expectedStore],max_num_results:12}],
 store:false
};
test('actual Resident GPT-5 File Search configuration is preserved exactly',async()=>{
 let calls=0;const phases=[];
 const answer=await fetchPolicyAnswer({apiKey:'synthetic-secret',
 requestBody:liveRequest,onPhase:x=>phases.push(x),fetcher:async(url,options)=>{
 calls++;
 assert.equal(url,'https://api.openai.com/v1/responses');
 const body=JSON.parse(options.body);
 assert.deepEqual(body,liveRequest);
 assert.equal(body.tools[0].type,'file_search');
 assert.deepEqual(body.tools[0].vector_store_ids,[expectedStore]);
 assert.equal(body.tools[0].max_num_results,12);
 assert.equal(body.model,'gpt-5');
 return {ok:true,status:200,json:async()=>({status:'completed',output:[
 {type:'file_search_call',status:'completed',results:[]},
 {type:'message',role:'assistant',content:[{type:'output_text',text:'Document-grounded result'}]}
 ]})};
 }});
 assert.equal(calls,1);
 assert.equal(answer,'Document-grounded result');
 assert.deepEqual(phases.map(x=>x.phase),['upstream_request_start','upstream_headers_received','upstream_body_received','answer_extracted']);
 assert.equal(JSON.stringify(phases).includes(expectedStore),false);
 assert.equal(JSON.stringify(phases).includes('synthetic-secret'),false);
});
test('missing or inaccessible vector store appears as a fast upstream HTTP error',async()=>{
 let calls=0;
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'synthetic-secret',requestBody:liveRequest,fetcher:async()=>{
 calls++;return {ok:false,status:404,json:async()=>({error:{code:'vector_store_not_found',message:'private provider details'}})};
 }}),e=>e instanceof PolicyProviderError&&e.reason==='UPSTREAM_STATUS'&&e.status===404&&!e.message.includes('private'));
 assert.equal(calls,1);
});
test('OpenAI may finish HTTP request but return incomplete status, which must not become a 200 answer',async()=>{
 await assert.rejects(()=>fetchPolicyAnswer({apiKey:'synthetic-secret',requestBody:liveRequest,fetcher:async()=>({ok:true,status:200,json:async()=>({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Partial'}]}]})})}),
 e=>e instanceof PolicyProviderError&&e.reason==='RESPONSE_NOT_COMPLETED');
});
