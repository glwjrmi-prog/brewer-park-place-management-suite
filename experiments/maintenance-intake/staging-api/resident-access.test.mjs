import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {normalizeEmail,createEmailChallenge,consumeEmailChallenge,authenticatedEmail,residentRequests} from './resident-access.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('./resident-email-schema.sql',import.meta.url),'utf8'));
 const make=(sql,args=[])=>({
  bind(...v){return make(sql,v)},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}}
 });
 return {
  db:{prepare(sql){return make(sql)},async batch(statements){
   sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}
  }},
  sqlite
 };
}
test('email validation, token privacy, one-time link and expiry',async()=>{
 const {db,sqlite}=sandbox(),now=1000000000;
 assert.equal(normalizeEmail('  Demo@Example.Com  '),'demo@example.com');
 assert.equal(normalizeEmail('not an email'),null);
 const x=await createEmailChallenge(db,' Demo@Example.Com ',now);
 assert.match(x.privateToken,/^[a-f0-9]{64}$/);
 assert.equal(sqlite.prepare('SELECT challenge_hash FROM resident_email_challenges').get().challenge_hash===x.privateToken,false);
 assert.equal(await consumeEmailChallenge(db,x.privateToken,now+15*60*1000+1),null);
 const y=await createEmailChallenge(db,'demo@example.com',now);
 const session=await consumeEmailChallenge(db,y.privateToken,now+1000);
 assert.equal(session.email,'demo@example.com');
 assert.equal(await consumeEmailChallenge(db,y.privateToken,now+1001),null);
 assert.equal(await authenticatedEmail(db,session.privateSession,now+2000),'demo@example.com');
 assert.equal(await authenticatedEmail(db,session.privateSession,now+60*60*1000+1001),null);
 assert.equal(sqlite.prepare('SELECT session_hash FROM resident_email_sessions WHERE email=?').get('demo@example.com').session_hash===session.privateSession,false);
});
test('resident sees only own requests, no board notes',async()=>{
 const {db,sqlite}=sandbox(),now=5000000;
 sqlite.prepare("INSERT INTO intake_requests(id,submission_key,unit,area,category,description,status,created_at,submitter_email,review_notes) VALUES(?,?,?,?,?,?,?,?,?,?)").run('BPP-STG-a','key1','Unit 12','Exterior of unit','Siding','My siding','reviewed','2026-11-19T01:00:00Z','first@example.com','secret board note');
 sqlite.prepare("INSERT INTO intake_requests(id,submission_key,unit,area,category,description,status,created_at,submitter_email,review_notes) VALUES(?,?,?,?,?,?,?,?,?,?)").run('BPP-STG-b','key2','Unit 12','Exterior of unit','Siding','Other request','reviewed','2026-11-19T01:00:00Z','second@example.com','another secret');
 const challenge=await createEmailChallenge(db,'first@example.com',now),session=await consumeEmailChallenge(db,challenge.privateToken,now+10);
 const records=await residentRequests(db,session.privateSession,now+20);
 assert.equal(records.length,1);assert.equal(records[0].description,'My siding');
 assert.equal(Object.hasOwn(records[0],'review_notes'),false);
 assert.equal(await residentRequests(db,'f'.repeat(64),now+20),null);
});
test('two attempts to reuse one challenge cannot create two sessions',async()=>{
 const {db,sqlite}=sandbox(),now=50000;
 const c=await createEmailChallenge(db,'sample@example.com',now);
 const results=await Promise.all([consumeEmailChallenge(db,c.privateToken,now+1),consumeEmailChallenge(db,c.privateToken,now+1)]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM resident_email_sessions').get().n,1);
});
