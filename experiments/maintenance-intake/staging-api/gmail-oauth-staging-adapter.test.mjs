import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {handleIsolatedGmailSetup} from './gmail-oauth-staging-adapter.mjs';
import {loadBoardRefreshToken} from './gmail-vault.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['gmail-oauth.schema.sql','gmail-vault.schema.sql'])
  sqlite.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 const make=(sql,args=[])=>({bind(...v){return make(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 const db={prepare:sql=>make(sql)};
 const vaultSecret=Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const env={INTAKE_DB:db,GMAIL_VAULT_KEY:vaultSecret,GMAIL_VAULT_KEY_VERSION:'v1',
  STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'true',
  STAGING_ADMIN_ORIGIN:origin,GMAIL_CLIENT_ID:'123456789-synthetic.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET:'synthetic-server-secret-not-real',GMAIL_REDIRECT_URI:origin+'/oauth/gmail/callback'};
 const request=(path,method='GET',headers={})=>new Request(origin+path,{method,headers});
 const verified={isVerifiedAdmin:async()=>true,getAdminSession:async()=> 'synthetic-admin-session-0123456789',
  hasValidCsrf:async()=>true,now:1000000};
 return {sqlite,db,env,request,verified,close:()=>sqlite.close()};
}
test('OAuth consent is disabled unless resident intake is false and private vault configured',async()=>{
 const t=sandbox();try{
  const req=t.request('/oauth/gmail/start','POST',{origin});
  t.env.STAGING_INTAKE_ENABLED='true';
  assert.equal((await handleIsolatedGmailSetup(req,t.env,t.verified)).status,503);
  t.env.STAGING_INTAKE_ENABLED='false';
  delete t.env.GMAIL_VAULT_KEY;
  assert.equal((await handleIsolatedGmailSetup(req,t.env,t.verified)).status,503);
  assert.equal(t.sqlite.prepare('SELECT count(*) as n FROM gmail_oauth_handshakes').get().n,0);
 }finally{t.close()}
});
test('only a verified admin can persist verified board Gmail refresh token encrypted in D1',async()=>{
 const t=sandbox();try{
  const start=await handleIsolatedGmailSetup(t.request('/oauth/gmail/start','POST',{origin}),t.env,t.verified);
  assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const fetcher=async(url)=>{
   if(url==='https://oauth2.googleapis.com/tokeninfo')return {
    ok:true,async json(){return {iss:'https://accounts.google.com',aud:t.env.GMAIL_CLIENT_ID,
     email:'board@bppcondos.org',hd:'bppcondos.org',email_verified:true,
     nonce:t.sqlite.prepare('SELECT oidc_nonce FROM gmail_oauth_handshakes').get().oidc_nonce,
     exp:Math.floor(Date.now()/1000)+3600}}
   };
   return {ok:true,async json(){return {token_type:'Bearer',access_token:'synthetic-access-token-1234',
    refresh_token:'synthetic-private-refresh-token-1234',id_token:'synthetic-signed-id-token-value-1234',
    expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email'}}};
  };
  const cb=t.request('/oauth/gmail/callback?code=synthetic-code&state='+state);
  const result=await handleIsolatedGmailSetup(cb,t.env,{...t.verified,fetcher});
  assert.equal(result.status,200);
  const page=await result.text();
  assert.equal(page.includes('synthetic-private-refresh-token'),false);
  const dbRow=t.sqlite.prepare('SELECT ciphertext,iv FROM gmail_sender_vault').get();
  assert.ok(dbRow);
  assert.equal(JSON.stringify(dbRow).includes('synthetic-private-refresh-token'),false);
  assert.equal(await loadBoardRefreshToken({db:t.db,vaultSecret:t.env.GMAIL_VAULT_KEY}),'synthetic-private-refresh-token-1234');
 }finally{t.close()}
});
