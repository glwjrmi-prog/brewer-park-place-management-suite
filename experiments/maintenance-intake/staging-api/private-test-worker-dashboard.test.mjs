import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import packaged from './private-test-worker-dashboard.mjs';
import modular from './private-test-gateway.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='d'.repeat(64);
const request=()=>new Request('https://private.example/health',{headers:{'x-bpp-staging-gate':secret}});
test('packaged and modular private staging gates agree on disabled and enabled behavior',async()=>{
 for(const [label,env]of [
  ['off',{}],
  ['missing private flag',{STAGING_INTAKE_ENABLED:'true',STAGING_TEST_SECRET:secret}],
  ['wrong secret',{STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:'a'.repeat(64)}],
  ['correct secret',{STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:secret}]
 ]){
  const [a,b]=await Promise.all([packaged.fetch(request(),env),modular.fetch(request(),env)]);
  assert.equal(a.status,b.status,label);
  assert.deepEqual(await a.json(),await b.json(),label);
 }
});
test('packaged private staging refuses any request without a server-side gate secret',async()=>{
 const env={STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:secret};
 const r=await packaged.fetch(new Request('https://private.example/api/requests',{headers:{authorization:'Bearer board-test-secret'}}),env);
 assert.equal(r.status,401);
});

test('full synthetic intake and Board decision work only behind both private gate and separate role token',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {readFileSync}=await import('node:fs');
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./bootstrap-console-paste.sql',import.meta.url),'utf8'));
 const bind=(sql,args=[])=>({
  bind(...values){return bind(sql,values)},
  async first(){return db.prepare(sql).get(...args)||null},
  async all(){return {results:db.prepare(sql).all(...args)}},
  async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}}}
 });
 const wrapped={prepare(sql){return bind(sql)},async batch(statements){
  db.exec('BEGIN');
  try{
   const result=[];
   for(const statement of statements)result.push(await statement.run());
   db.exec('COMMIT');
   return result;
  }catch(e){db.exec('ROLLBACK');throw e}
 }};
 const env={INTAKE_DB:wrapped,STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',
  STAGING_TEST_SECRET:secret,BOARD_STAGING_TOKEN:'synthetic-board',RESIDENT_STAGING_TOKEN:'synthetic-resident',
  ALLOWED_STAGING_ORIGIN:'https://private.example',
  STAGING_BOARD_RECIPIENT_KEYS:'["test-board-one"]'};
 const issue={unit:'Synthetic Unit 9',area:'Exterior of unit',category:'Siding',
  description:'Synthetic loose siding',escalation:false};
 const send=async(path,token,body,gate=secret,key='synthetic-key-1')=>{
  const headers={origin:env.ALLOWED_STAGING_ORIGIN,authorization:'Bearer '+token,'idempotency-key':key,'content-type':'application/json'};
  if(gate)headers['x-bpp-staging-gate']=gate;
  const r=await packaged.fetch(new Request('https://private.example'+path,
   {method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env);
  return {status:r.status,body:await r.json()};
 };
 try{
  const blocked=await send('/api/requests','synthetic-resident',issue,'');
  assert.equal(blocked.status,401);
  assert.equal(db.prepare('SELECT count(*) AS n FROM intake_requests').get().n,0);
  assert.equal((await send('/api/requests','synthetic-board',issue)).status,404);
  const created=await send('/api/requests','synthetic-resident',issue);
  assert.equal(created.status,201);
  assert.equal(created.body.status,'pending_board_review');
  const id=created.body.id;
  assert.equal((await send('/api/requests','synthetic-resident',issue)).body.id,id);
  assert.equal((await send('/api/requests','synthetic-resident')).status,403);
  const list=await send('/api/requests','synthetic-board');
  assert.equal(list.status,200);
  assert.equal(list.body.requests.length,1);
  const review={actor:'Synthetic Board',notes:'Synthetic documented decision',version:1,
   responsibility:'association',priority:'routine'};
  assert.equal((await send('/api/requests/'+id+'/review','synthetic-resident',review)).status,403);
  assert.equal((await send('/api/requests/'+id+'/review','synthetic-board',review)).status,200);
  assert.equal(db.prepare('SELECT status FROM intake_requests WHERE id=?').get(id).status,'reviewed');
  assert.equal(db.prepare('SELECT count(*) AS n FROM intake_events').get().n,2);
 }finally{db.close()}
});
