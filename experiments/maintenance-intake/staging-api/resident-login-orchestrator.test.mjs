import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {requestPrivateLogin,redeemPrivateLogin,verifyTurnstile} from './resident-login-orchestrator.mjs';
import {authenticatedEmail} from './resident-access.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function staging(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['schema.sql','resident-email-schema.sql','verified-unit-registry.schema.sql'])
  sqlite.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({
  bind(...v){return stmt(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const x=sqlite.prepare(sql).run(...args);return {meta:{changes:x.changes}}}
 });
 const db={prepare:sql=>stmt(sql),async batch(stmts){
  sqlite.exec('BEGIN');
  try{const result=[];for(const s of stmts)result.push(await s.run());sqlite.exec('COMMIT');return result}
  catch(e){sqlite.exec('ROLLBACK');throw e}
 }};
 const registry=(email,unit='Unit A')=>sqlite.prepare(
  "INSERT INTO intake_verified_unit_access(verified_email,unit_id,active,approved_by,approved_at) VALUES(?,?,1,?,?)"
 ).run(email,unit,'board-demo','2026-11-23T00:00:00Z');
 return {sqlite,db,registry,close:()=>sqlite.close()};
}
const goodCaptcha=async(url,opts)=>({ok:url.includes('/siteverify'),async json(){assert.equal(opts.method,'POST');assert.ok(String(opts.body).includes('secret'));return {success:true}}});
const badCaptcha=async()=>({ok:true,async json(){return {success:false}}});
const options={turnstileToken:'synthetic-human-challenge',secret:'test-turnstile-secret-xyz',fetcher:goodCaptcha,linkBase:'https://example.test/maintenance/login',now:1000000};
test('only active Board-verified residents receive one-time email; public responses cannot reveal their status',async()=>{
 const t=staging();try{
  t.registry('valid@example.test');
  const outbound=[];
  const sendLink=async message=>{outbound.push(message);return true};
  const valid=await requestPrivateLogin({db:t.db,email:'VALID@example.test',sendLink,...options});
  const unknown=await requestPrivateLogin({db:t.db,email:'unknown@example.test',sendLink,...options});
  assert.deepEqual(valid,unknown);
  assert.equal(outbound.length,1);
  assert.equal(outbound[0].to,'valid@example.test');
  assert.equal(outbound[0].subject.includes('Brewer Park Place'),true);
  assert.equal(outbound[0].text.includes('Unit A'),false);
  const link=outbound[0].text.match(/https:\/\/\S+/)?.[0];
  assert.ok(link);
  const parsed=new URL(link);
  assert.equal(parsed.search,'');
  assert.match(parsed.hash,/^#login=[a-f0-9]{64}$/);
  const token=parsed.hash.slice('#login='.length);
  assert.equal(JSON.stringify(valid).includes(token),false);
  const issued=await redeemPrivateLogin({db:t.db,token,now:1000002});
  assert.match(issued.privateSession,/^[a-f0-9]{64}$/);
  assert.equal(await authenticatedEmail(t.db,issued.privateSession,1000003),'valid@example.test');
  assert.equal(await redeemPrivateLogin({db:t.db,token,now:1000003}),null);
 }finally{t.close()}
});
test('no email is sent without a verified human Turnstile token or approved unit registry',async()=>{
 const t=staging();try{
  t.registry('valid@example.test');
  let mails=0;
  const sendLink=async()=>{mails++;return true};
  const rejected=await requestPrivateLogin({db:t.db,email:'valid@example.test',sendLink,...options,fetcher:badCaptcha});
  assert.equal(rejected.ok,false);
  assert.equal(mails,0);
  assert.equal(t.sqlite.prepare('SELECT count(*) as n FROM resident_email_challenges').get().n,0);
  assert.equal(await verifyTurnstile({token:'',secret:'test-turnstile-secret-xyz',fetcher:goodCaptcha}),false);
  const unapproved=await requestPrivateLogin({db:t.db,email:'notapproved@example.test',sendLink,...options});
  assert.equal(unapproved.ok,true);
  assert.equal(mails,0);
  assert.equal(t.sqlite.prepare('SELECT count(*) as n FROM resident_email_challenges').get().n,0);
 }finally{t.close()}
});
test('undelivered links are invalidated; revoked residents cannot redeem issued links',async()=>{
 const t=staging();try{
  t.registry('valid@example.test');
  const failed=await requestPrivateLogin({db:t.db,email:'valid@example.test',sendLink:async()=>false,...options});
  assert.equal(failed.ok,true);
  const row=t.sqlite.prepare('SELECT consumed_at FROM resident_email_challenges').get();
  assert.equal(row.consumed_at,options.now);
  let link='';
  await requestPrivateLogin({db:t.db,email:'valid@example.test',sendLink:async payload=>{link=payload.text.match(/https:\/\/\S+/)[0];return true},...options});
  const token=new URL(link).hash.slice('#login='.length);
  t.sqlite.prepare("UPDATE intake_verified_unit_access SET active=0,revoked_at=? WHERE verified_email=?")
   .run('2026-11-23T00:10:00Z','valid@example.test');
  assert.equal(await redeemPrivateLogin({db:t.db,token,now:1000001}),null);
 }finally{t.close()}
});
test('service may not send without a verified account and appropriate https callback',async()=>{
 const t=staging();try{
  assert.equal((await requestPrivateLogin({db:t.db,email:'invalid',sendLink:async()=>true,...options})).ok,false);
  assert.equal((await requestPrivateLogin({db:t.db,email:'ok@example.test',sendLink:async()=>true,...options,linkBase:'http://unsafe.test'})).ok,false);
 }finally{t.close()}
});
