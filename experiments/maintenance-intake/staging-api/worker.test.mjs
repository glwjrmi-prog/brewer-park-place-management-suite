// Execute from this folder with: node --experimental-sqlite --test worker.test.mjs
// Tests use synthetic requests and an in-memory SQLite database. No network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import worker from './worker.mjs';
import {createEmailChallenge,consumeEmailChallenge} from './resident-access.mjs';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

function sandbox(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./resident-email-schema.sql',import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({
   bind(...values){return wrap(sql,values)},
   async first(){return db.prepare(sql).get(...args)||null},
   async all(){return {results:db.prepare(sql).all(...args)}},
   async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}}}
 });
 const database={
   prepare(sql){return wrap(sql)},
   async batch(stmts){
     db.exec('BEGIN');
     try{
       const out=[];
       for(const stmt of stmts)out.push(await stmt.run());
       db.exec('COMMIT');
       return out;
     }catch(e){db.exec('ROLLBACK');throw e}
   }
 };
 const env={INTAKE_DB:database,BOARD_STAGING_TOKEN:'board-test-secret',RESIDENT_STAGING_TOKEN:'resident-test-secret',STAGING_BOARD_RECIPIENT_KEYS:JSON.stringify(['test-board-a','test-board-b','test-board-c']),ALLOWED_STAGING_ORIGIN:'https://private-test.example'};
 const send=async(path,role='resident',method='GET',payload=null,key='test-key-1')=>{
   const headers={'authorization':'Bearer '+(role==='board'?env.BOARD_STAGING_TOKEN:role==='resident'?env.RESIDENT_STAGING_TOKEN:'not-authorized'),'origin':env.ALLOWED_STAGING_ORIGIN};
   if(payload!==null)headers['content-type']='application/json';
   if(method==='POST'&&path==='/api/requests')headers['idempotency-key']=key;
   const req=new Request('https://staging.test'+path,{method,headers,body:payload===null?undefined:JSON.stringify(payload)});
   const response=await worker.fetch(req,env);
   return {status:response.status,body:await response.json()};
 };
 const count=(table)=>Number(db.prepare('SELECT count(*) AS n FROM '+table).get().n);
 return {env,send,count,db,database};
}
const sample=(escalation=false)=>({unit:'Sample Unit 12',area:'Exterior of unit',category:'Siding',description:'Loose trim - synthetic only',escalation});
test('resident submission, board-only list and duplicate retry',async()=>{
 const t=sandbox();
 const first=await t.send('/api/requests','resident','POST',sample());
 assert.equal(first.status,201);
 assert.equal(t.count('intake_requests'),1);
 assert.equal(t.count('intake_events'),1);
 const duplicate=await t.send('/api/requests','resident','POST',sample());
 assert.equal(duplicate.status,200);
 assert.equal(duplicate.body.id,first.body.id);
 assert.equal(duplicate.body.duplicate,true);
 assert.equal(t.count('intake_requests'),1);
 const conflict=await t.send('/api/requests','resident','POST',{...sample(),description:'Changed text'});
 assert.equal(conflict.status,409);
 assert.equal((await t.send('/api/requests','resident')).status,403);
 assert.equal((await t.send('/api/requests','board')).status,200);
 assert.equal((await t.send('/api/requests','invalid')).status,401);
});
test('urgent request queues all test recipients and only one board ack',async()=>{
 const t=sandbox();
 const created=await t.send('/api/requests','resident','POST',sample(true));
 assert.equal(created.status,201);
 assert.equal(t.count('urgent_alert_outbox'),3);
 const id=created.body.id;
 assert.equal((await t.send('/api/requests/'+id+'/acknowledge','resident','POST',{actor:'Fake resident',version:1})).status,403);
 const acknowledged=await t.send('/api/requests/'+id+'/acknowledge','board','POST',{actor:'Test board 1',version:1});
 assert.equal(acknowledged.status,200);
 assert.equal(acknowledged.body.coordinator,'Test board 1');
 assert.equal((await t.send('/api/requests/'+id+'/acknowledge','board','POST',{actor:'Test board 2',version:1})).status,409);
 assert.equal(t.count('intake_events'),2);
 const queue=await t.send('/api/requests','board');
 assert.equal(queue.body.requests[0].urgentAcknowledged,true);
});
test('review requires actor, notes, valid version and board permissions',async()=>{
 const t=sandbox();
 const created=await t.send('/api/requests','resident','POST',sample(false));
 const id=created.body.id,path='/api/requests/'+id+'/review';
 const review={actor:'Test board 2',notes:'Checked reference; synthetic review only',version:1,responsibility:'association',priority:'routine'};
 assert.equal((await t.send(path,'board','POST',{...review,notes:''})).status,422);
 assert.equal((await t.send(path,'resident','POST',review)).status,403);
 assert.equal((await t.send(path,'board','POST',review)).status,200);
 assert.equal((await t.send(path,'board','POST',review)).status,409);
 assert.equal(t.count('intake_events'),2);
});
test('missing urgent recipient configuration fails closed with no request created',async()=>{
 const t=sandbox();delete t.env.STAGING_BOARD_RECIPIENT_KEYS;
 const r=await t.send('/api/requests','resident','POST',sample(true));
 assert.equal(r.status,503);
 assert.equal(t.count('intake_requests'),0);
});
test('untrusted origin denied',async()=>{
 const t=sandbox();
 const req=new Request('https://staging.test/api/requests',{method:'GET',headers:{origin:'https://untrusted.example',authorization:'Bearer board-test-secret'}});
 const response=await worker.fetch(req,t.env);
 assert.equal(response.status,403);
});

test('private request route requires a verified email session, not a unit or shared token',async()=>{
 const t=sandbox();
 const insert=t.db.prepare("INSERT INTO intake_requests(id,submission_key,unit,area,category,description,status,created_at,submitter_email,review_notes) VALUES(?,?,?,?,?,?,?,?,?,?)");
 insert.run('BPP-STG-a','key-first','Unit 12','Exterior of unit','Siding','First resident concern','reviewed','2026-11-19T10:00:00Z','first@example.com','Board private discussion');
 insert.run('BPP-STG-b','key-second','Unit 12','Exterior of unit','Siding','Second resident concern','reviewed','2026-11-19T10:01:00Z','second@example.com','Confidential review');
 const one=await createEmailChallenge(t.database,'first@example.com');
 const two=await createEmailChallenge(t.database,'second@example.com');
 const first=await consumeEmailChallenge(t.database,one.privateToken);
 const second=await consumeEmailChallenge(t.database,two.privateToken);
 async function as(token){
  const request=new Request('https://staging.test/api/my-requests',{headers:{authorization:'Bearer '+token,origin:t.env.ALLOWED_STAGING_ORIGIN}});
  const response=await worker.fetch(request,t.env);
  return {status:response.status,body:await response.json()};
 }
 assert.equal((await t.send('/api/my-requests','resident')).status,401);
 assert.equal((await t.send('/api/my-requests','board')).status,401);
 assert.equal((await as('a'.repeat(64))).status,401);
 const mine=await as(first.privateSession);
 assert.equal(mine.status,200);assert.equal(mine.body.requests.length,1);
 assert.equal(mine.body.requests[0].id,'BPP-STG-a');
 assert.equal(JSON.stringify(mine.body).includes('Board private discussion'),false);
 assert.equal(JSON.stringify(mine.body).includes('Second resident concern'),false);
 const other=await as(second.privateSession);
 assert.equal(other.status,200);assert.equal(other.body.requests[0].id,'BPP-STG-b');
});

test('verified resident submission appears only in matching private inbox',async()=>{
 const t=sandbox();
 const a=await createEmailChallenge(t.database,'a@example.com');
 const b=await createEmailChallenge(t.database,'b@example.com');
 const first=await consumeEmailChallenge(t.database,a.privateToken);
 const second=await consumeEmailChallenge(t.database,b.privateToken);
 async function request(path,session,method='GET',payload=null,key='shared-testing-key'){
  const headers={authorization:'Bearer '+session,origin:t.env.ALLOWED_STAGING_ORIGIN};
  if(method==='POST'){headers['content-type']='application/json';headers['idempotency-key']=key}
  const req=new Request('https://staging.test'+path,{method,headers,body:payload===null?undefined:JSON.stringify(payload)});
  const r=await worker.fetch(req,t.env);return {status:r.status,body:await r.json()};
 }
 const submitted=await request('/api/private/requests',first.privateSession,'POST',sample(),'resident-one-key');
 assert.equal(submitted.status,201);
 const stored=t.db.prepare('SELECT submitter_email FROM intake_requests WHERE id=?').get(submitted.body.id);
 assert.equal(stored.submitter_email,'a@example.com');
 const mine=await request('/api/my-requests',first.privateSession);
 assert.equal(mine.status,200);assert.equal(mine.body.requests.length,1);
 const others=await request('/api/my-requests',second.privateSession);
 assert.equal(others.status,200);assert.equal(others.body.requests.length,0);
 const identicalRetry=await request('/api/private/requests',first.privateSession,'POST',sample(),'resident-one-key');
 assert.equal(identicalRetry.status,200);assert.equal(identicalRetry.body.duplicate,true);
 const crossAccountRetry=await request('/api/private/requests',second.privateSession,'POST',sample(),'resident-one-key');
 assert.equal(crossAccountRetry.status,409);
 assert.equal((await request('/api/private/requests','a'.repeat(64),'POST',sample(),'bad')).status,401);
 assert.equal(t.count('intake_requests'),1);
});

test('staging draft is board-only, requires HOA/shared approval and is unique',async()=>{
 const t=sandbox();
 const a=await t.send('/api/requests','resident','POST',sample(), 'draft-case-one');
 const id=a.body.id,path='/api/requests/'+id+'/work-order-draft';
 assert.equal((await t.send(path,'resident','POST',{version:1,actor:'resident'})).status,403);
 assert.equal((await t.send(path,'board','POST',{version:1,actor:'Test board'})).status,422);
 assert.equal((await t.send('/api/work-order-drafts','resident')).status,403);
 const review={version:1,actor:'Test board',notes:'Board authorized draft only',responsibility:'association',priority:'routine'};
 assert.equal((await t.send('/api/requests/'+id+'/review','board','POST',review)).status,200);
 assert.equal((await t.send(path,'board','POST',{version:1,actor:'Test board'})).status,409);
 const created=await t.send(path,'board','POST',{version:2,actor:'Test board'});
 assert.equal(created.status,201);assert.equal(created.body.mode,'isolated_staging_only');
 assert.equal(t.count('staged_work_order_drafts'),1);
 assert.equal((await t.send(path,'board','POST',{version:2,actor:'Different board member'})).status,409);
 assert.equal(t.count('staged_work_order_drafts'),1);
 const listed=await t.send('/api/work-order-drafts','board');
 assert.equal(listed.status,200);assert.equal(listed.body.drafts.length,1);
 assert.equal(listed.body.drafts[0].intakeRequestId,id);
 assert.equal(t.count('intake_events'),3);
});
test('owner-only reviewed intake cannot create HOA draft',async()=>{
 const t=sandbox();
 const a=await t.send('/api/requests','resident','POST',sample(), 'draft-case-two'),id=a.body.id;
 assert.equal((await t.send('/api/requests/'+id+'/review','board','POST',{version:1,actor:'Test board',notes:'Owner item',responsibility:'owner',priority:'routine'})).status,200);
 const r=await t.send('/api/requests/'+id+'/work-order-draft','board','POST',{version:2,actor:'Test board'});
 assert.equal(r.status,422);assert.equal(t.count('staged_work_order_drafts'),0);
});
test('shared-responsibility board-approved intake may create isolated draft',async()=>{
 const t=sandbox();
 const a=await t.send('/api/requests','resident','POST',sample(), 'draft-case-three'),id=a.body.id;
 assert.equal((await t.send('/api/requests/'+id+'/review','board','POST',{version:1,actor:'Test board',notes:'Shared matter',responsibility:'shared_or_disputed',priority:'high'})).status,200);
 const r=await t.send('/api/requests/'+id+'/work-order-draft','board','POST',{version:2,actor:'Test board'});
 assert.equal(r.status,201);assert.equal(t.count('staged_work_order_drafts'),1);
});

test('board review releases only approved message to verified resident',async()=>{
 const x=sandbox(),challenge=await createEmailChallenge(x.database,'home@example.com');
 const session=await consumeEmailChallenge(x.database,challenge.privateToken);
 async function privateCall(path,method='GET',payload=null,key='review-message-test'){
  const headers={'authorization':'Bearer '+session.privateSession,'origin':x.env.ALLOWED_STAGING_ORIGIN};
  if(method==='POST'){headers['content-type']='application/json';headers['idempotency-key']=key}
  const r=await worker.fetch(new Request('https://staging.test'+path,{method,headers,body:payload===null?undefined:JSON.stringify(payload)}),x.env);
  return {status:r.status,body:await r.json()};
 }
 const received=await privateCall('/api/private/requests','POST',sample());
 assert.equal(received.status,201);
 const pending=await privateCall('/api/my-requests');
 assert.equal(pending.body.requests.length,1);
 assert.equal(Object.hasOwn(pending.body.requests[0],'responsibility'),false);
 assert.equal(Object.hasOwn(pending.body.requests[0],'residentMessage'),false);
 const id=received.body.id;
 const review={actor:'Test Board',notes:'PRIVATE AI draft and internal discussion',version:1,responsibility:'association',priority:'routine',residentMessage:'The board will evaluate exterior cleaning at the next maintenance meeting.'};
 assert.equal((await x.send('/api/requests/'+id+'/review','resident','POST',review)).status,403);
 assert.equal((await x.send('/api/requests/'+id+'/review','board','POST',{...review,residentMessage:'x'.repeat(1001)})).status,422);
 const approved=await x.send('/api/requests/'+id+'/review','board','POST',review);
 assert.equal(approved.status,200);
 const after=await privateCall('/api/my-requests');
 assert.equal(after.status,200);
 assert.equal(after.body.requests[0].responsibility,'association');
 assert.equal(after.body.requests[0].residentMessage,review.residentMessage);
 assert.equal(JSON.stringify(after.body).includes('PRIVATE AI draft'),false);
 assert.equal(JSON.stringify(after.body).includes('Test Board'),false);
});

test('board-only advisor calls existing JSON interface with sanitized area/category, never private details',async()=>{
 const t=sandbox(),created=await t.send('/api/requests','resident','POST',{...sample(),description:'Private details: call Jane 616-555-1234 in Unit 12'},'policy-001');
 assert.equal(created.status,201);
 const id=created.body.id,route='/api/requests/'+id+'/policy-advice';
 let sent=null,requestedUrl=null,callCount=0;
 t.env.POLICY_ADVISOR_ENABLED='true';
 t.env.POLICY_ADVISOR_TEST_FETCH=async(url,options)=>{
  callCount++;requestedUrl=url;sent=JSON.parse(options.body);
  return {ok:true,json:async()=>({answer:'ANSWER: Insufficient facts to assign responsibility.\\nGOVERNING PROVISIONS: None verified; board must consult source documents.'})};
 };
 assert.equal((await t.send(route,'resident','GET')).status,403);
 assert.equal((await t.send(route,'resident','POST',{version:1,actor:'Fake resident'})).status,403);
 assert.equal((await t.send(route,'board','POST',{version:2,actor:'Board A'})).status,409);
 assert.equal((await t.send(route,'board','POST',{version:1,actor:'Board A'})).status,201);
 assert.equal(callCount,1);
 assert.equal(requestedUrl,'https://bpp-resident-policy-advisor.glwjrmi.workers.dev/');
 assert.equal(typeof sent.question,'string');
 assert.equal(sent.question.includes('Siding'),true);
 assert.equal(sent.question.includes('Exterior of unit'),true);
 assert.equal(JSON.stringify(sent).includes('Jane'),false);
 assert.equal(JSON.stringify(sent).includes('616-555'),false);
 assert.equal(JSON.stringify(sent).includes('Unit 12'),false);
 assert.equal(t.count('intake_policy_advice'),1);
 const view=await t.send(route,'board','GET');
 assert.equal(view.status,200);assert.equal(view.body.verified,false);assert.equal(view.body.boardOnly,true);
 const residentData=JSON.stringify((await t.send('/api/requests','board')).body);
 assert.equal(residentData.includes('Insufficient facts'),false);
 assert.equal((await t.send(route,'board','POST',{version:1,actor:'Board B'})).status,409);
 assert.equal(callCount,1);
});
test('disabled or failing advisor makes no advice record and cannot leak to residents',async()=>{
 const t=sandbox(),created=await t.send('/api/requests','resident','POST',sample(),'policy-002'),id=created.body.id;
 const route='/api/requests/'+id+'/policy-advice';
 assert.equal((await t.send(route,'board','POST',{version:1,actor:'Board'})).status,503);
 assert.equal(t.count('intake_policy_advice'),0);
 t.env.POLICY_ADVISOR_ENABLED='true';
 t.env.POLICY_ADVISOR_TEST_FETCH=async()=>({ok:false,json:async()=>({error:'Down'})});
 assert.equal((await t.send(route,'board','POST',{version:1,actor:'Board'})).status,502);
 assert.equal(t.count('intake_policy_advice'),0);
});

test('staging advisor failures do not write raw upstream error details to logs',async()=>{
 const t=sandbox();
 const created=await t.send('/api/requests','resident','POST',sample(),'privacy-log-case');
 const id=created.body.id;
 t.env.POLICY_ADVISOR_ENABLED='true';
 const privateMarker='SYNTHETIC-PRIVATE-MARKER-DO-NOT-LOG';
 t.env.POLICY_ADVISOR_TEST_FETCH=async()=>{throw new Error(privateMarker)};
 const observed=[];
 const original=console.error;
 console.error=(...args)=>observed.push(args);
 try{
  const result=await t.send('/api/requests/'+id+'/policy-advice','board','POST',{version:1,actor:'Test board'});
  assert.equal(result.status,502);
  assert.equal(t.count('intake_policy_advice'),0);
 }finally{
  console.error=original;
 }
 assert.equal(JSON.stringify(observed).includes(privateMarker),false);
 assert.equal(observed.some(args=>args.includes('BPP_INTAKE_STAGING_ADVISOR_UNAVAILABLE')),true);
});
