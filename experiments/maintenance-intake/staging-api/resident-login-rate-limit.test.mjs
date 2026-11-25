import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {reserveLoginAttempt} from './resident-login-rate-limit.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('./resident-login-rate-limit.schema.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){return {async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}}}}}};
 return {sqlite,db};
}
test('rate limit rejects fourth mailbox request without exposing mailbox or requester IDs',async()=>{
 const {sqlite,db}=sandbox();try{
  const values={db,email:'Person@Example.Test',requesterId:'trusted-network-id',secret:'S'.repeat(64),now:1700000000,maxEmails:3,maxRequester:20};
  for(let i=0;i<3;i++)assert.equal(await reserveLoginAttempt(values),true);
  assert.equal(await reserveLoginAttempt({...values,email:'person@example.test'}),false);
  assert.equal(await reserveLoginAttempt({...values,now:1700000000+3600000}),true);
  assert.equal(sqlite.prepare('SELECT count(*) as n FROM resident_login_attempt_limits').get().n,2);
  const records=sqlite.prepare('SELECT * FROM resident_login_attempt_limits').all();
  assert.equal(JSON.stringify(records).includes('Person@Example.Test'),false);
  assert.equal(JSON.stringify(records).includes('trusted-network-id'),false);
 }finally{sqlite.close()}
});
test('trusted requester limit applies across different addresses and fails if missing',async()=>{
 const {sqlite,db}=sandbox();try{
  for(let i=0;i<2;i++){
   assert.equal(await reserveLoginAttempt({db,email:'new'+i+'@test.example',requesterId:'trusted-net',secret:'S'.repeat(64),now:1700000000,maxRequester:2}),true);
  }
  assert.equal(await reserveLoginAttempt({db,email:'new2@test.example',requesterId:'trusted-net',secret:'S'.repeat(64),now:1700000000,maxRequester:2}),false);
  await assert.rejects(()=>reserveLoginAttempt({db,email:'x@example.test',requesterId:'',secret:'S'.repeat(64),now:1700000000}));
  await assert.rejects(()=>reserveLoginAttempt({db,email:'x@example.test',requesterId:'spoofed',secret:'short',now:1700000000}));
 }finally{sqlite.close()}
});
