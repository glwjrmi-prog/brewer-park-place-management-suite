// BPP Maintenance Notifications — isolated staging-only Gmail OAuth handshake.
// No Worker route is enabled by importing this module. No credentials in GitHub.
// Admin must be separately authenticated before start and before callback.
// Credentials/token persistence belong ONLY in an approved server-side secret store.
const SCOPE='https://www.googleapis.com/auth/gmail.send';
const AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN='https://oauth2.googleapis.com/token';
const TTL=10*60*1000;
const bytes=n=>{const result=new Uint8Array(n);crypto.getRandomValues(result);return result};
const base64url=value=>{
 let binary='';for(const b of value)binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const digest=async value=>{
 const encoded=new TextEncoder().encode(value);
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))].map(v=>v.toString(16).padStart(2,'0')).join('');
};
function credentials({clientId,clientSecret,redirectUri}){
 if(typeof clientId!=='string'||!/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
  throw new Error('OAuth client ID missing or invalid');
 if(typeof clientSecret!=='string'||clientSecret.length<12)
  throw new Error('OAuth client secret unavailable');
 let url;
 try{url=new URL(redirectUri)}catch{throw new Error('Invalid callback')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
  url.pathname!=='/oauth/gmail/callback')throw new Error('Unsafe callback URI');
 return {clientId,clientSecret,redirectUri:url.href};
}
function validClock(now){if(!Number.isSafeInteger(now)||now<1)throw new Error('Invalid clock')}
async function adminHash(adminSession){
 if(typeof adminSession!=='string'||adminSession.length<16||adminSession.length>4096)throw new Error('Invalid admin session');
 return digest(adminSession);
}
export async function beginGmailAuthorization({db,clientId,clientSecret,redirectUri,adminVerified=false,adminSession,now=Date.now()}){
 if(adminVerified!==true||!db?.prepare)throw new Error('Admin session required');
 validClock(now);
 const c=credentials({clientId,clientSecret,redirectUri});
 const boundAdmin=await adminHash(adminSession);
 const state=base64url(bytes(32)),verifier=base64url(bytes(32));
 const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 await db.prepare('INSERT INTO gmail_oauth_handshakes(state_hash,admin_session_hash,pkce_verifier,issued_at,expires_at) VALUES(?,?,?,?,?)')
  .bind(await digest(state),boundAdmin,verifier,now,now+TTL).run();
 const url=new URL(AUTH);
 for(const [key,value] of Object.entries({
  client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:SCOPE,
  access_type:'offline',prompt:'consent',include_granted_scopes:'false',
  state,code_challenge:challenge,code_challenge_method:'S256'
 }))url.searchParams.set(key,value);
 return {authorizationUrl:url.href,expiresAt:now+TTL};
}
export async function finishGmailAuthorization({
 db,clientId,clientSecret,redirectUri,state,code,adminVerified=false,adminSession,
 fetcher=fetch,now=Date.now()
}){
 if(adminVerified!==true||!db?.prepare)throw new Error('Admin session required');
 validClock(now);
 const c=credentials({clientId,clientSecret,redirectUri});
 if(typeof state!=='string'||! /^[a-zA-Z0-9_-]{43}$/.test(state)||
  typeof code!=='string'||code.length<4||code.length>2048||
  /[\r\n]/.test(code))throw new Error('Invalid OAuth callback');
 const stateHash=await digest(state),boundAdmin=await adminHash(adminSession);
 // Guard token exchange with atomic state consumption. Concurrent callbacks
 // cannot both exchange the same code or reuse an old auth handshake.
 const row=await db.prepare(
  'SELECT pkce_verifier FROM gmail_oauth_handshakes WHERE state_hash=? AND admin_session_hash=? AND consumed_at IS NULL AND expires_at>?'
 ).bind(stateHash,boundAdmin,now).first();
 if(!row||! /^[a-zA-Z0-9_-]{43}$/.test(String(row.pkce_verifier||'')))
  throw new Error('OAuth session expired or used');
 const claimed=await db.prepare(
  'UPDATE gmail_oauth_handshakes SET consumed_at=? WHERE state_hash=? AND admin_session_hash=? AND consumed_at IS NULL AND expires_at>?'
 ).bind(now,stateHash,boundAdmin,now).run();
 if(Number(claimed?.meta?.changes||0)!==1)throw new Error('OAuth session expired or used');
 let response;
 try{
  response=await fetcher(TOKEN,{
   method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({
    client_id:c.clientId,client_secret:c.clientSecret,
    code,code_verifier:row.pkce_verifier,grant_type:'authorization_code',
    redirect_uri:c.redirectUri
   }),
   signal:AbortSignal.timeout(10000)
  });
 }catch{throw new Error('OAuth token endpoint unavailable')}
 if(!response?.ok)throw new Error('OAuth token exchange rejected');
 let data;
 try{data=await response.json()}catch{throw new Error('Malformed OAuth response')}
 // Caller must securely store refresh token; NEVER echo it to the user or logs.
 // Reject an unexpected scope set or a missing refresh token.
 const scopes=typeof data?.scope==='string'?data.scope.split(/\s+/).filter(Boolean):[];
 if(scopes.length!==1||scopes[0]!==SCOPE||
  typeof data?.refresh_token!=='string'||data.refresh_token.length<10||
  typeof data?.access_token!=='string'||data.access_token.length<10||
  data?.token_type!=='Bearer')
  throw new Error('OAuth response lacks expected send-only offline access');
 return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,scope:SCOPE};
}
export async function refreshGmailAccess({clientId,clientSecret,redirectUri,refreshToken,fetcher=fetch}){
 const c=credentials({clientId,clientSecret,redirectUri});
 if(typeof refreshToken!=='string'||refreshToken.length<10)throw new Error('Missing refresh token');
 let response;
 try{response=await fetcher(TOKEN,{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({
   client_id:c.clientId,client_secret:c.clientSecret,
   refresh_token:refreshToken,grant_type:'refresh_token'
  }),
  signal:AbortSignal.timeout(10000)
 })}catch{throw new Error('OAuth refresh endpoint unavailable')}
 if(!response?.ok)throw new Error('OAuth access refresh rejected');
 let data;try{data=await response.json()}catch{throw new Error('Malformed OAuth refresh response')}
 if(typeof data?.access_token!=='string'||data.access_token.length<10||
  data?.token_type!=='Bearer')throw new Error('Missing refreshed access token');
 // Never return the refresh token in response; keep existing secure value.
 return {accessToken:data.access_token,expiresIn:data.expires_in};
}
export const gmailSendOnlyScope=SCOPE;
