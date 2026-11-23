import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {handleGmailAdminOAuth} from './gmail-oauth-admin-http.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
function sandbox(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('./gmail-oauth.schema.sql',import.meta.url),'utf8'));
 const make=(q,args=[])=>({bind(...v){return make(q,v)},async first(){return sql.prepare(q).get(...args)||null},
  async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:r.changes}}}});
 const env={INTAKE_DB:{prepare:q=>make(q)},STAGING_INTAKE_ENABLED:'true',STAGING_GMAIL_OAUTH_ENABLED:'true',
  STAGING_ADMIN_ORIGIN:origin,GMAIL_CLIENT_ID:'123456789-synthetic.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET:'synthetic-server-secret-not-real',GMAIL_REDIRECT_URI:origin+'/oauth/gmail/callback'};
 const req=(path,method='GET',h={})=>new Request(origin+path,{method,headers:h});
 const ok={isVerifiedAdmin:async()=>true,hasValidCsrf:async()=>true,now:1000000};
 return {sql,env,req,ok,close:()=>sql.close()};
}
test('admin-only starting OAuth requires POST, same-origin and server-verified CSRF',async()=>{
 const s=sandbox();try{
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/start'),s.env,s.ok)).status,405);
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/start','POST'),s.env,s.ok)).status,403);
  const post=s.req('/oauth/gmail/start','POST',{origin});
  assert.equal((await handleGmailAdminOAuth(post,s.env,{...s.ok,isVerifiedAdmin:async()=>false})).status,401);
  assert.equal((await handleGmailAdminOAuth(post,s.env,{...s.ok,hasValidCsrf:async()=>false})).status,403);
  const res=await handleGmailAdminOAuth(post,s.env,s.ok);
  assert.equal(res.status,302);
  assert.match(res.headers.get('location'),/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.equal(res.headers.get('cache-control'),'no-store, private');
  assert.equal(res.headers.get('referrer-policy'),'no-referrer');
  assert.equal(s.sql.prepare('SELECT count(*) as n FROM gmail_oauth_handshakes').get().n,1);
 }finally{s.close()}
});
test('successful callback stores refresh token only on server and never sends it in HTTP',async()=>{
 const s=sandbox();try{
  const begin=await handleGmailAdminOAuth(s.req('/oauth/gmail/start','POST',{origin}),s.env,s.ok);
  const state=new URL(begin.headers.get('location')).searchParams.get('state');
  let stored=null;
  const result=await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?state='+state+'&code=synthetic-code'),s.env,{
   ...s.ok,
   saveRefreshToken:async payload=>{stored=payload},
   fetcher:async()=>({ok:true,async json(){return {token_type:'Bearer',access_token:'synthetic-access',
    refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/gmail.send',expires_in:3600}}})
  });
  assert.equal(result.status,200);
  assert.equal(stored.refreshToken,'synthetic-refresh');
  const body=await result.text();
  assert.equal(body.includes('synthetic-refresh'),false);
  assert.equal(body.includes('synthetic-access'),false);
  assert.equal(body.includes('synthetic-code'),false);
  assert.equal(result.headers.get('cache-control'),'no-store, private');
  const replay=await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?state='+state+'&code=synthetic-code'),s.env,{
   ...s.ok,saveRefreshToken:async()=>{throw Error('must not repeat')},
   fetcher:async()=>{throw Error('must not repeat')}
  });
  assert.equal(replay.status,503);
 }finally{s.close()}
});
test('disabled gate, missing secret vault and unverified admin deny callback with no token exchange',async()=>{
 const s=sandbox();try{
  s.env.STAGING_GMAIL_OAUTH_ENABLED='false';
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?code=a&state=b'),s.env,s.ok)).status,503);
  s.env.STAGING_GMAIL_OAUTH_ENABLED='true';
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?code=a&state=b'),s.env,s.ok)).status,503);
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?error=access_denied'),s.env,s.ok)).status,400);
  assert.equal((await handleGmailAdminOAuth(s.req('/oauth/gmail/callback?code=a&state=b'),s.env,
   {...s.ok,isVerifiedAdmin:async()=>false,saveRefreshToken:async()=>{}})).status,401);
 }finally{s.close()}
});
