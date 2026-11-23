import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {routeGmailConnection} from './gmail-connection-routes.mjs';
import {loadBoardRefreshToken} from './gmail-vault.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
const bearer='synthetic-production-pin-session-abcdef123456789';
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['gmail-oauth.schema.sql','gmail-vault.schema.sql','gmail-setup-session.schema.sql'])
  sqlite.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({bind(...v){return stmt(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 const vaultKey=Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const env={INTAKE_DB:{prepare:sql=>stmt(sql)},GMAIL_VAULT_KEY:vaultKey,
  STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'true',STAGING_ADMIN_ORIGIN:origin,
  GMAIL_CLIENT_ID:'123456789-synthetic.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET:'synthetic-client-secret-not-real',
  GMAIL_REDIRECT_URI:origin+'/oauth/gmail/callback'};
 const req=(path,method='GET',headers={})=>new Request(origin+path,{method,headers});
 const startReq=()=>req('/oauth/gmail/session','POST',{origin,'content-type':'application/json',
  'x-bpp-setup-intent':'gmail-send-only',authorization:'Bearer '+bearer});
 const fetcher=async(url,opts)=>{
  if(url.includes('/api/auth/me')){
   assert.equal(opts.headers.authorization,'Bearer '+bearer);
   return {ok:true,status:200,async json(){return {user:{id:'admin-1',role:'admin',active:true}}}};
  }
  if(url.includes('/tokeninfo'))return {ok:true,async json(){return {
   iss:'https://accounts.google.com',aud:env.GMAIL_CLIENT_ID,email:'board@bppcondos.org',
   email_verified:true,hd:'bppcondos.org',nonce:sqlite.prepare('SELECT oidc_nonce FROM gmail_oauth_handshakes').get().oidc_nonce,
   exp:Math.floor(Date.now()/1000)+3600
  }}};
  if(url.includes('/token'))return {ok:true,async json(){return {
   access_token:'synthetic-access-token-1234',refresh_token:'synthetic-refresh-token-5678',
   id_token:'synthetic-id-token-with-length-12345678',token_type:'Bearer',expires_in:3600,
   scope:'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send'
  }}};
  throw Error('Unexpected network URL');
 };
 return {sqlite,env,req,startReq,fetcher,close:()=>sqlite.close()};
}
test('existing Suite admin session -> HttpOnly cookie -> CSRF -> Google -> encrypted BPP token',async()=>{
 const s=sandbox();try{
  const a=await routeGmailConnection(s.startReq(),s.env,{fetcher:s.fetcher,now:1000000});
  assert.equal(a.status,200);
  const cookie=a.headers.get('set-cookie').split(';')[0];
  const {csrfToken}=await a.json();
  assert.equal(cookie.includes(bearer),false);
  const start=await routeGmailConnection(s.req('/oauth/gmail/start','POST',{
   origin,cookie,'x-bpp-gmail-csrf':csrfToken
  }),s.env,{fetcher:s.fetcher,now:1000100});
  assert.equal(start.status,200);
  const google=new URL((await start.json()).authorizationUrl);
  assert.equal(google.hostname,'accounts.google.com');
  assert.equal(google.searchParams.get('redirect_uri'),s.env.GMAIL_REDIRECT_URI);
  assert.ok(google.searchParams.get('scope').includes('gmail.send'));
  const state=google.searchParams.get('state');
  const callback=await routeGmailConnection(s.req('/oauth/gmail/callback?state='+state+'&code=test-code','GET',{cookie}),s.env,{
   fetcher:s.fetcher,now:1000200
  });
  assert.equal(callback.status,200);
  assert.match(callback.headers.get('set-cookie'),/Max-Age=0/);
  const body=await callback.text();
  assert.equal(body.includes('synthetic-refresh-token'),false);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM gmail_sender_vault').get().n,1);
  assert.equal(await loadBoardRefreshToken({db:s.env.INTAKE_DB,vaultSecret:s.env.GMAIL_VAULT_KEY}),'synthetic-refresh-token-5678');
  const replay=await routeGmailConnection(s.req('/oauth/gmail/callback?state='+state+'&code=test-code','GET',{cookie}),s.env,{fetcher:s.fetcher,now:1000300});
  assert.equal(replay.status,401);
 }finally{s.close()}
});
test('unverified admin and attempts to turn on resident access fail closed',async()=>{
 const s=sandbox();try{
  const fake=await routeGmailConnection(s.req('/oauth/gmail/start','POST',{origin}),s.env,{now:1000000,fetcher:s.fetcher});
  assert.equal(fake.status,401);
  const a=await routeGmailConnection(s.startReq(),s.env,{fetcher:s.fetcher,now:1000000});
  const cookie=a.headers.get('set-cookie').split(';')[0];
  const {csrfToken}=await a.json();
  s.env.STAGING_INTAKE_ENABLED='true';
  const res=await routeGmailConnection(s.req('/oauth/gmail/start','POST',{
   origin,cookie,'x-bpp-gmail-csrf':csrfToken
  }),s.env,{fetcher:s.fetcher,now:1000001});
  assert.notEqual(res.status,200);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM gmail_sender_vault').get().n,0);
  assert.equal((await routeGmailConnection(s.req('/api/requests'),s.env)).status,404);
 }finally{s.close()}
});
