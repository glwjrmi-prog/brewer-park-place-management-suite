// Execute from this folder with: node --experimental-sqlite --test worker.test.mjs
// Tests use synthetic requests and an in-memory SQLite database. No network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import worker from './worker.mjs';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

function sandbox(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
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
 return {env,send,count,db};
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
