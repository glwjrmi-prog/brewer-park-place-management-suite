// BPP maintenance Gmail connection: ephemeral, cookie-bound admin session.
// Staging-only source, NOT deployed. The existing Management Suite PIN login
// is verified only via its production /api/auth/me, never by trusting client role.
// The Suite bearer is NEVER persisted, copied into a URL, or sent to Google.
import {verifySuiteAdminBearer} from './suite-admin-verifier.mjs';
const NAME='__Host-bpp_gmail_setup';
const TTL=10*60*1000;
const token=()=>{
 const b=crypto.getRandomValues(new Uint8Array(32));
 let s='';for(const c of b)s+=String.fromCharCode(c);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const digest=async v=>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
 'referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers
}});
const cookieString=secret=>`${NAME}=${secret}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`;
const clearCookie=`${NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
function cookieOf(req){
 const header=req.headers.get('cookie')||'';
 const match=header.match(/(?:^|;\s*)__Host-bpp_gmail_setup=([A-Za-z0-9_-]{43})(?:;|$)/);
 return match?.[1]||null;
}
function safeEnvelope(req,env){
 let u;try{u=new URL(req.url)}catch{return false}
 return u.protocol==='https:'&&u.origin===String(env?.STAGING_ADMIN_ORIGIN||'')&&
  env.STAGING_INTAKE_ENABLED==='false'&&env.STAGING_GMAIL_OAUTH_ENABLED==='true'&&
  !!env.INTAKE_DB?.prepare;
}
export async function bootstrapGmailSetup(req,env,{fetcher=null,now=Date.now()}={}){
 if(!safeEnvelope(req,env))return reply({error:'Unavailable'},503);
 if(req.method!=='POST'||new URL(req.url).pathname!=='/oauth/gmail/session')
  return reply({error:'Not found'},404);
 if(req.headers.get('origin')!==env.STAGING_ADMIN_ORIGIN||
  req.headers.get('content-type')!=='application/json'||
  req.headers.get('x-bpp-setup-intent')!=='gmail-send-only')
  return reply({error:'Forbidden'},403);
 const authorization=req.headers.get('authorization')||'';
 const bearer=authorization.startsWith('Bearer ')?authorization.slice(7):'';
 // Authenticate using the same-account Cloudflare Service Binding only.
 // An injected test fetcher is permitted in unit tests; no public-fetch fallback.
 const verifyFetcher=fetcher || (typeof env?.BPP_SUITE_AUTH?.fetch==='function'
  ?(url,options)=>env.BPP_SUITE_AUTH.fetch(new Request(url,options)):null);
 if(!verifyFetcher)return reply({error:'Internal administrator verification unavailable'},503);
 let admin;
 try{admin=await verifySuiteAdminBearer({bearer,fetcher:verifyFetcher})}
 catch{return reply({error:'Unauthorized'},401)}
 if(!Number.isSafeInteger(now)||now<1)return reply({error:'Unavailable'},503);
 const session=token(),csrf=token();
 try{
  const result=await env.INTAKE_DB.prepare(
   'INSERT INTO gmail_setup_sessions(session_hash,csrf_hash,admin_user_id,issued_at,expires_at) VALUES(?,?,?,?,?)'
  ).bind(await digest(session),await digest(csrf),admin.verifiedAdminId,now,now+TTL).run();
  if(Number(result?.meta?.changes||0)!==1)return reply({error:'Unavailable'},503);
 }catch{return reply({error:'Unavailable'},503)}
 return reply({ok:true,csrfToken:csrf,expiresAt:now+TTL},200,{'set-cookie':cookieString(session)});
}
export async function resolveGmailAdminSession(req,env,{now=Date.now()}={}){
 if(!safeEnvelope(req,env)||!Number.isSafeInteger(now)||now<1)return null;
 const session=cookieOf(req);if(!session)return null;
 let row;
 try{
  row=await env.INTAKE_DB.prepare(
   'SELECT admin_user_id,csrf_hash FROM gmail_setup_sessions WHERE session_hash=? AND expires_at>? AND revoked_at IS NULL'
  ).bind(await digest(session),now).first();
 }catch{return null}
 return row&&typeof row.admin_user_id==='string'&&row.admin_user_id.length?
  Object.freeze({session,adminId:row.admin_user_id,csrfHash:row.csrf_hash}):null;
}
export async function validateGmailSetupCsrf(req,env,{now=Date.now()}={}){
 const context=await resolveGmailAdminSession(req,env,{now});
 const value=req.headers.get('x-bpp-gmail-csrf');
 return !!context&&typeof value==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(value)&&
  await digest(value)===context.csrfHash;
}
export async function revokeGmailSetup(req,env,{now=Date.now()}={}){
 const cookie=cookieOf(req);
 if(cookie&&env?.INTAKE_DB?.prepare){
  try{await env.INTAKE_DB.prepare(
   'UPDATE gmail_setup_sessions SET revoked_at=? WHERE session_hash=? AND revoked_at IS NULL'
  ).bind(now,await digest(cookie)).run()}catch{}
 }
 return clearCookie;
}
export const gmailSessionCookieName=NAME;
