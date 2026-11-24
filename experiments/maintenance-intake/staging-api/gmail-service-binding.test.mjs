import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {bootstrapGmailSetup} from './gmail-setup-session.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
const bearer='a'.repeat(43);
const req=()=>new Request(origin+'/oauth/gmail/session',{method:'POST',headers:{
 origin,'content-type':'application/json','x-bpp-setup-intent':'gmail-send-only',
 authorization:'Bearer '+bearer
},body:'{}'});
const env=()=>({STAGING_ADMIN_ORIGIN:origin,STAGING_INTAKE_ENABLED:'false',
 STAGING_GMAIL_OAUTH_ENABLED:'true',INTAKE_DB:{prepare(){
 return {bind(){return this},async run(){return {meta:{changes:1}}}};
 }}});
test('missing internal production auth binding fails closed',async()=>{
 const response=await bootstrapGmailSetup(req(),env(),{now:1000000});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'Internal administrator verification unavailable');
});
test('Suite auth verification routes through Cloudflare service binding',async()=>{
 const e=env();let count=0;
 e.BPP_SUITE_AUTH={async fetch(request){
  count++;
  assert.equal(request.url,'https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me');
  assert.equal(request.headers.get('authorization'),'Bearer '+bearer);
  return new Response(JSON.stringify({user:{id:'admin-1',role:'admin',active:true}}),{
   status:200,headers:{'content-type':'application/json'}
  });
 }};
 const response=await bootstrapGmailSetup(req(),e,{now:1000000});
 assert.equal(response.status,200);
 assert.equal(count,1);
 assert.equal((await response.json()).ok,true);
});
test('non-admin denied even via internal service binding',async()=>{
 const e=env();e.BPP_SUITE_AUTH={async fetch(){return new Response(JSON.stringify({
  user:{id:'user-1',role:'user',active:true}
 }),{status:200})}};
 const response=await bootstrapGmailSetup(req(),e,{now:1000000});
 assert.equal(response.status,401);
 assert.equal((await response.json()).reason,'ADMIN_REQUIRED');
});

test('unexpected internal service response gets safe non-secret reason',async()=>{
 const e=env();e.BPP_SUITE_AUTH={async fetch(){return new Response('bad gateway',{status:502})}};
 const response=await bootstrapGmailSetup(req(),e,{now:1000000});
 assert.equal(response.status,401);
 const body=await response.json();
 assert.equal(body.reason,'SESSION_NOT_VERIFIED');
 assert.ok(!JSON.stringify(body).includes(bearer));
});
