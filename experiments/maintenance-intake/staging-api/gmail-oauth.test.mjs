import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {beginGmailAuthorization,finishGmailAuthorization,refreshGmailAccess,gmailSendOnlyScope} from './gmail-oauth.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const settings={
 clientId:'123456789-synthetic.apps.googleusercontent.com',
 clientSecret:'synthetic-secret-is-not-real',
 redirectUri:'https://bpp-maintenance-intake-staging.glwjrmi.workers.dev/oauth/gmail/callback'
};
function sandbox(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('./gmail-oauth.schema.sql',import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...v){return wrap(sql,v)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 return {db:{prepare:sql=>wrap(sql)},sqlite,close:()=>sqlite.close()};
}
test('admin-only start generates exact registered https redirect, random state and S256 challenge',async()=>{
 const s=sandbox();try{
  await assert.rejects(()=>beginGmailAuthorization({db:s.db,...settings,now:1000000}));
  const result=await beginGmailAuthorization({db:s.db,...settings,adminVerified:true,now:1000000});
  const url=new URL(result.authorizationUrl);
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.pathname,'/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'),gmailSendOnlyScope);
  assert.equal(url.searchParams.get('access_type'),'offline');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('redirect_uri'),settings.redirectUri);
  assert.equal(url.searchParams.get('include_granted_scopes'),'false');
  assert.match(url.searchParams.get('state'),/^[a-zA-Z0-9_-]{43}$/);
  assert.match(url.searchParams.get('code_challenge'),/^[a-zA-Z0-9_-]{43}$/);
  const row=s.sqlite.prepare('SELECT * FROM gmail_oauth_handshakes').get();
  assert.equal(row.state_hash.length,64);
  assert.notEqual(row.state_hash,url.searchParams.get('state'));
  assert.notEqual(row.pkce_verifier,url.searchParams.get('code_challenge'));
  assert.equal(result.expiresAt,1600000);
  assert.equal(JSON.stringify(result).includes(settings.clientSecret),false);
 }finally{s.close()}
});
test('single-use callback exchanges code with PKCE and never accepts replay',async()=>{
 const s=sandbox();try{
  const auth=await beginGmailAuthorization({db:s.db,...settings,adminVerified:true,now:1000000});
  const state=new URL(auth.authorizationUrl).searchParams.get('state');
  let sent=0;
  const fetcher=async(url,opts)=>{
   sent++;
   assert.equal(url,'https://oauth2.googleapis.com/token');
   assert.equal(opts.method,'POST');
   assert.equal(opts.body.get('client_id'),settings.clientId);
   assert.equal(opts.body.get('client_secret'),settings.clientSecret);
   assert.equal(opts.body.get('grant_type'),'authorization_code');
   assert.equal(opts.body.get('redirect_uri'),settings.redirectUri);
   assert.match(opts.body.get('code_verifier'),/^[a-zA-Z0-9_-]{43}$/);
   return {ok:true,async json(){return {access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',
    token_type:'Bearer',expires_in:3600,scope:gmailSendOnlyScope}}};
  };
  const callback={db:s.db,...settings,state,code:'synthetic-auth-code',adminVerified:true,fetcher,now:1000100};
  const result=await finishGmailAuthorization(callback);
  assert.equal(result.refreshToken,'synthetic-refresh-token');
  assert.equal(sent,1);
  assert.equal(s.sqlite.prepare('SELECT consumed_at FROM gmail_oauth_handshakes').get().consumed_at,1000100);
  await assert.rejects(()=>finishGmailAuthorization(callback));
  assert.equal(sent,1);
 }finally{s.close()}
});
test('tampered state, expired state, non-admin callback and excess scope are all denied',async()=>{
 const s=sandbox();try{
  const auth=await beginGmailAuthorization({db:s.db,...settings,adminVerified:true,now:1000000});
  const state=new URL(auth.authorizationUrl).searchParams.get('state');
  let called=0;const fetcher=async()=>{called++;return {ok:true,async json(){return {
   access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',
   scope:gmailSendOnlyScope+' https://mail.google.com/'}}}};
  const base={db:s.db,...settings,adminVerified:true,state,code:'synthetic-auth-code',fetcher,now:1000100};
  await assert.rejects(()=>finishGmailAuthorization({...base,adminVerified:false}));
  await assert.rejects(()=>finishGmailAuthorization({...base,state:state.slice(0,42)+'!'}));
  await assert.rejects(()=>finishGmailAuthorization({...base,now:1700000}));
  assert.equal(called,0);
  await assert.rejects(()=>finishGmailAuthorization(base));
  assert.equal(called,1);
 }finally{s.close()}
});
test('callback URI mismatch and secret-free callback fail before network access',async()=>{
 const s=sandbox();try{
  await assert.rejects(()=>beginGmailAuthorization({
   db:s.db,...settings,redirectUri:'http://unsafe.example/oauth/gmail/callback',
   adminVerified:true,now:1000000}));
  await assert.rejects(()=>beginGmailAuthorization({
   db:s.db,...settings,redirectUri:'https://example.test/oauth/gmail/callback?inject=1',
   adminVerified:true,now:1000000}));
  await assert.rejects(()=>beginGmailAuthorization({
   db:s.db,...settings,clientSecret:'',adminVerified:true,now:1000000}));
 }finally{s.close()}
});
test('refresh requests Gmail access without exposing stored refresh token',async()=>{
 let calls=0;const fetcher=async(url,opts)=>{
  calls++;
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(opts.body.get('grant_type'),'refresh_token');
  assert.equal(opts.body.get('refresh_token'),'synthetic-refresh-token');
  return {ok:true,async json(){return {access_token:'synthetic-new-access-token',token_type:'Bearer',expires_in:3600}}};
 };
 const result=await refreshGmailAccess({...settings,refreshToken:'synthetic-refresh-token',fetcher});
 assert.equal(calls,1);
 assert.equal(result.accessToken,'synthetic-new-access-token');
 assert.equal('refreshToken' in result,false);
});
