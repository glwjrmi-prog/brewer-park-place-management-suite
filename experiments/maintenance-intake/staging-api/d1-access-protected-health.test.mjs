import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import app from './d1-access-protected-health.mjs';
const req=(p='/health')=>new Request('https://bpp-maintenance-intake-staging.example'+p);
const ctx={access:{getIdentity:async()=>({email:'staging-tester@example.com'})}};
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./bootstrap-console-paste.sql',import.meta.url),'utf8'));
 return {db,binding:{prepare(sql){return {all:async()=>({results:db.prepare(sql).all()})}}}};
}
test('rejects missing Cloudflare Access even if caller spoofs email header',async()=>{
 const request=new Request('https://example.test/health',{headers:{'Cf-Access-Jwt-Assertion':'fake','X-User-Email':'admin@example.com'}});
 const response=await app.fetch(request,{},null);
 assert.equal(response.status,403);
 assert.equal((await response.json()).status,'access_required');
});
test('Access identity and complete isolated D1 only: read-only authorized health passes',async()=>{
 const {db,binding}=database();
 const r=await app.fetch(req(),{INTAKE_DB:binding},ctx);
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'ready',schemaReady:true});
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(db.prepare('SELECT count(*) AS n FROM intake_requests').get().n,0);
 db.close();
});
test('deny missing identity, unavailable database, incorrect endpoint and database errors',async()=>{
 assert.equal((await app.fetch(req(),{},{})).status,403);
 assert.equal((await app.fetch(req(),{}, {access:{getIdentity:async()=>({email:'bad'})}})).status,403);
 assert.equal((await app.fetch(req(),{},ctx)).status,503);
 assert.equal((await app.fetch(req('/api/requests'),{},ctx)).status,404);
 const r=await app.fetch(req(),{INTAKE_DB:{prepare(){throw new Error('PRIVATE_TOKEN')}}},ctx);
 assert.equal(r.status,503);
 assert.equal(JSON.stringify(await r.json()).includes('PRIVATE_TOKEN'),false);
});
