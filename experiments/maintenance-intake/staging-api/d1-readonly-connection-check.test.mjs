import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import probe from './d1-readonly-connection-check.mjs';

function fakeDatabase(){
 const sqlite=new DatabaseSync(':memory:');
 const wrap=(sql)=>({all:async()=>({results:sqlite.prepare(sql).all()})});
 return {sqlite, db:{prepare:wrap}};
}
async function request(env,path='/health',method='GET'){
 const r=await probe.fetch(new Request('https://example.test'+path,{method}),env);
 return {status:r.status,body:await r.json(),headers:r.headers};
}
test('does not mutate database and reports ready only for full intake schema',async()=>{
 const {sqlite,db}=fakeDatabase();
 sqlite.exec(readFileSync(new URL('./bootstrap-console-paste.sql',import.meta.url),'utf8'));
 const before=sqlite.prepare('SELECT count(*) AS n FROM intake_requests').get().n;
 const r=await request({INTAKE_DB:db});
 assert.equal(r.status,200);
 assert.deepEqual(r.body,{status:'ready',databaseConnected:true,schemaReady:true});
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM intake_requests').get().n,before);
 assert.equal(r.headers.get('cache-control'),'no-store');
 sqlite.close();
});
test('without binding or matching schema, fails closed without metadata disclosure',async()=>{
 assert.equal((await request({})).status,503);
 const {sqlite,db}=fakeDatabase();
 sqlite.exec('CREATE TABLE random_table (id INTEGER PRIMARY KEY)');
 const r=await request({INTAKE_DB:db});
 assert.equal(r.status,503);
 assert.deepEqual(r.body,{status:'not_ready',databaseConnected:true,schemaReady:false});
 assert.equal((await request({INTAKE_DB:db},'/api/requests')).status,404);
 assert.equal((await request({INTAKE_DB:db},'/health','POST')).status,404);
 sqlite.close();
});
test('schema query failure returns generic status without exposing private error',async()=>{
 const r=await request({INTAKE_DB:{prepare(){throw new Error('SYNTHETIC_PRIVATE_TOKEN')}}});
 assert.equal(r.status,503);
 assert.equal(JSON.stringify(r.body).includes('PRIVATE_TOKEN'),false);
});
