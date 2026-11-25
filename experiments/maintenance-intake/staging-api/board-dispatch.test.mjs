import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {stageBoardNotifications,dispatchOneBoardNotification} from './board-dispatch.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const incident={id:'BPP-STG-12345678-1234-4234-9234-123456789abc',escalation:true};
const directory=[
 {id:'board-a',role:'board',active:true,emailVerified:true,verifiedEmail:'a@example.test'},
 {id:'board-b',role:'board',active:true,emailVerified:true,verifiedEmail:'b@example.test'},
 {id:'former',role:'board',active:false,emailVerified:true,verifiedEmail:'former@example.test'}
];
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['schema.sql','board-dispatch.schema.sql'])sqlite.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 sqlite.prepare("INSERT INTO intake_requests(id,submission_key,unit,area,category,description,escalation,created_at) VALUES(?,?,?,?,?,?,?,?)")
  .run(incident.id,'synthetic-key','PRIVATE UNIT','Common area / grounds','Other','PRIVATE DESCRIPTION',1,'2026-11-23T00:00:00Z');
 const make=(sql,args=[])=>({bind(...values){return make(sql,values)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){const row=sqlite.prepare(sql).run(...args);return {meta:{changes:row.changes}}}
 });
 const db={prepare:sql=>make(sql),async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 return {sqlite,db,close:()=>sqlite.close()};
}
test('staging creates exactly one outbound entry per active Board member, not per resident',async()=>{
 const t=sandbox();try{
  assert.deepEqual(await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000}),
   {ok:true,recipientCount:2,mode:'staging_only'});
  await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000});
  const rows=t.sqlite.prepare('SELECT * FROM board_notification_dispatch ORDER BY recipient_id').all();
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.recipient_id),['board-a','board-b']);
  assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
  assert.equal(JSON.stringify(rows).includes('example.test'),false);
 }finally{t.close()}
});
test('only claimed email is sent once, no recipient list, unit or narrative; provider acceptance is not Board ack',async()=>{
 const t=sandbox();try{
  await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000});
  const outbound=[];
  const sendMail=async payload=>{outbound.push(payload);return {accepted:true,messageId:'provider-synthetic-1'}};
  const args={db:t.db,incidentId:incident.id,recipientId:'board-a',boardDirectory:directory,sendMail,now:1001};
  const first=await dispatchOneBoardNotification(args);
  assert.equal(first.state,'provider_accepted');
  assert.equal(first.boardAcknowledged,false);
  assert.equal(outbound.length,1);
  assert.equal(outbound[0].to,'a@example.test');
  assert.equal(JSON.stringify(outbound[0]).includes('PRIVATE'),false);
  assert.equal(JSON.stringify(outbound[0]).includes('b@example.test'),false);
  assert.equal((await dispatchOneBoardNotification(args)).state,'not_claimed');
  assert.equal(outbound.length,1);
  const row=t.sqlite.prepare('SELECT status,provider_message_id,attempts FROM board_notification_dispatch WHERE recipient_id=?').get('board-a');
  assert.equal(row.status,'accepted');
  assert.equal(row.provider_message_id,'provider-synthetic-1');
  assert.equal(row.attempts,1);
 }finally{t.close()}
});
test('unverified, removed and inactive board recipients cannot dispatch even if queued earlier',async()=>{
 const t=sandbox();try{
  await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000});
  let calls=0;
  await assert.rejects(()=>dispatchOneBoardNotification({
   db:t.db,incidentId:incident.id,recipientId:'board-a',boardDirectory:directory.filter(a=>a.id!=='board-a'),
   sendMail:async()=>{calls++;return {accepted:true,messageId:'no'}},now:1001
  }));
  assert.equal(calls,0);
  assert.equal(t.sqlite.prepare('SELECT status FROM board_notification_dispatch WHERE recipient_id=?').get('board-a').status,'pending');
 }finally{t.close()}
});
test('provider rejection or exception does not retry ambiguously or claim Board acknowledgment',async()=>{
 const t=sandbox();try{
  await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000});
  let calls=0;
  const args={db:t.db,incidentId:incident.id,recipientId:'board-b',boardDirectory:directory,now:1001};
  const failed=await dispatchOneBoardNotification({...args,sendMail:async()=>{calls++;throw new Error('provider timed out')}});
  assert.equal(failed.state,'provider_unconfirmed');
  assert.equal(failed.boardAcknowledged,false);
  assert.equal((await dispatchOneBoardNotification({...args,sendMail:async()=>{calls++;return {accepted:true,messageId:'late'}}})).state,'not_claimed');
  assert.equal(calls,1);
  const row=t.sqlite.prepare('SELECT status,last_error_code FROM board_notification_dispatch WHERE recipient_id=?').get('board-b');
  assert.equal(row.status,'permanent_failure');
  assert.equal(row.last_error_code,'PROVIDER_EXCEPTION');
 }finally{t.close()}
});
test('concurrent dispatch attempts claim exactly once',async()=>{
 const t=sandbox();try{
  await stageBoardNotifications({db:t.db,incident,boardDirectory:directory,now:1000});
  let deliveries=0;
  const args={db:t.db,incidentId:incident.id,recipientId:'board-a',boardDirectory:directory,
   sendMail:async()=>{deliveries++;return {accepted:true,messageId:'single'}},now:1001};
  const results=await Promise.all([dispatchOneBoardNotification(args),dispatchOneBoardNotification(args)]);
  assert.deepEqual(results.map(r=>r.state).sort(),['not_claimed','provider_accepted'].sort());
  assert.equal(deliveries,1);
 }finally{t.close()}
});
