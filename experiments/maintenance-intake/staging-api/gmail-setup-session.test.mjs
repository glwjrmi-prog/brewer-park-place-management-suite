import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {bootstrapGmailSetup,resolveGmailAdminSession,validateGmailSetupCsrf,revokeGmailSetup,gmailSessionCookieName} from './gmail-setup-session.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
const pinBearer='synthetic-session-token-0123456789abcdef';
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('./gmail-setup-session.schema.sql',import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({bind(...v){return stmt(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 const env={INTAKE_DB:{prepare:sql=>stmt(sql)},STAGING_ADMIN_ORIGIN:origin,STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'true'};
 const request=(path,method='GET',headers={})=>new Request(origin+path,{method,headers});
 const start=()=>request('/oauth/gmail/session','POST',{
  origin,'content-type':'application/json','x-bpp-setup-intent':'gmail-send-only',authorization:'Bearer '+pinBearer
 });
 const fetcher=async(url,opts)=>{
  assert.equal(url,'https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me');
  assert.equal(opts.headers.authorization,'Bearer '+pinBearer);
  return {ok:true,status:200,async json(){return {user:{id:'verified-board-admin-1',role:'admin',active:true}}}};
 };
 return {sqlite,env,request,start,fetcher,close:()=>sqlite.close()};
}
test('verified PIN admin exchanges bearer for 10-minute HttpOnly SameSite=Lax cookie, no PIN leakage',async()=>{
 const s=sandbox();try{
  const response=await bootstrapGmailSetup(s.start(),s.env,{fetcher:s.fetcher,now:1000000});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');
  assert.match(cookie,/^__Host-bpp_gmail_setup=[a-zA-Z0-9_-]{43}; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
  assert.equal(cookie.includes(pinBearer),false);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.match(data.csrfToken,/^[a-zA-Z0-9_-]{43}$/);
  assert.equal(data.expiresAt,1600000);
  assert.equal(JSON.stringify(data).includes(pinBearer),false);
  const sessionValue=cookie.split('=')[1].split(';')[0];
  const req=s.request('/oauth/gmail/callback','GET',{cookie:gmailSessionCookieName+'='+sessionValue});
  assert.equal((await resolveGmailAdminSession(req,s.env,{now:1000100})).adminId,'verified-board-admin-1');
  assert.equal(await validateGmailSetupCsrf(s.request('/oauth/gmail/start','POST',{
   cookie:gmailSessionCookieName+'='+sessionValue,'x-bpp-gmail-csrf':data.csrfToken
  }),s.env,{now:1000100}),true);
  const row=s.sqlite.prepare('SELECT * FROM gmail_setup_sessions').get();
  assert.equal(row.session_hash.length,64);
  assert.equal(row.csrf_hash.length,64);
  assert.equal(JSON.stringify(row).includes(sessionValue),false);
  assert.equal(JSON.stringify(row).includes(pinBearer),false);
  assert.equal(await resolveGmailAdminSession(req,s.env,{now:1600000}),null);
  const cleared=await revokeGmailSetup(req,s.env,{now:1000200});
  assert.match(cleared,/Max-Age=0/);
  assert.equal(await resolveGmailAdminSession(req,s.env,{now:1000201}),null);
 }finally{s.close()}
});
test('unverified or non-admin Suite session never creates cookie or D1 entry',async()=>{
 const s=sandbox();try{
  assert.equal((await bootstrapGmailSetup(s.start(),s.env,{now:1000000,fetcher:async()=>({
   ok:true,status:200,async json(){return {user:{id:'someone',role:'user',active:true}}}
  })})).status,401);
  assert.equal((await bootstrapGmailSetup(s.start(),s.env,{now:1000000,fetcher:async()=>{throw Error('down')}})).status,503);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM gmail_setup_sessions').get().n,0);
 }finally{s.close()}
});
test('same-origin POST, JSON and setup intent are all required; resident intake stays off',async()=>{
 const s=sandbox();try{
  assert.equal((await bootstrapGmailSetup(s.request('/oauth/gmail/session','POST',{
   origin:'https://malicious.example',authorization:'Bearer '+pinBearer,
   'content-type':'application/json','x-bpp-setup-intent':'gmail-send-only'
  }),s.env,{now:1000000,fetcher:s.fetcher})).status,403);
  assert.equal((await bootstrapGmailSetup(s.request('/oauth/gmail/session','POST',{
   origin,'content-type':'application/json',authorization:'Bearer '+pinBearer
  }),s.env,{now:1000000,fetcher:s.fetcher})).status,403);
  s.env.STAGING_INTAKE_ENABLED='true';
  assert.equal((await bootstrapGmailSetup(s.start(),s.env,{now:1000000,fetcher:s.fetcher})).status,503);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM gmail_setup_sessions').get().n,0);
 }finally{s.close()}
});
test('cookie forgery and missing/incorrect CSRF cannot authorize the setup',async()=>{
 const s=sandbox();try{
  const r=await bootstrapGmailSetup(s.start(),s.env,{fetcher:s.fetcher,now:1000000});
  const csrf=(await r.json()).csrfToken;
  const forged=s.request('/oauth/gmail/callback','GET',{cookie:gmailSessionCookieName+'='+'a'.repeat(43)});
  assert.equal(await resolveGmailAdminSession(forged,s.env,{now:1000001}),null);
  const original=r.headers.get('set-cookie').split('=')[1].split(';')[0];
  const live=s.request('/oauth/gmail/start','POST',{cookie:gmailSessionCookieName+'='+original,
   'x-bpp-gmail-csrf':'b'.repeat(43)});
  assert.equal(await validateGmailSetupCsrf(live,s.env,{now:1000001}),false);
  assert.equal(await validateGmailSetupCsrf(s.request('/oauth/gmail/start','POST',{cookie:gmailSessionCookieName+'='+original}),s.env,{now:1000001}),false);
  const valid=s.request('/oauth/gmail/start','POST',{cookie:gmailSessionCookieName+'='+original,'x-bpp-gmail-csrf':csrf});
  assert.equal(await validateGmailSetupCsrf(valid,s.env,{now:1000001}),true);
 }finally{s.close()}
});
