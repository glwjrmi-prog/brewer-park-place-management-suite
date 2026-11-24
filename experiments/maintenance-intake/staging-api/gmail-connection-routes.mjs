// BPP isolated Gmail setup routing, staging SOURCE ONLY.
// This is NOT mounted on live or staging Cloudflare Worker.
// Design: a Suite PIN-authenticated admin exchanges their current Suite
// bearer via same-origin POST for an HttpOnly 10-minute setup cookie.
// Google redirects via top-level GET; SameSite=Lax sends that cookie.
// /oauth/gmail/start returns Google URL in a same-origin JSON response.
// No bearer, PIN, email data, secret or refresh token in any redirect URL.
import {bootstrapGmailSetup,resolveGmailAdminSession,validateGmailSetupCsrf,revokeGmailSetup} from './gmail-setup-session.mjs';
import {handleIsolatedGmailSetup} from './gmail-oauth-staging-adapter.mjs';
export async function routeGmailConnection(req,env,{fetcher=null,now=Date.now()}={}){
 let url;
 try{url=new URL(req.url)}catch{return new Response('Not found',{status:404})}
 if(url.pathname==='/oauth/gmail/session')
  return bootstrapGmailSetup(req,env,{fetcher,now});
 if(!['/oauth/gmail/start','/oauth/gmail/callback'].includes(url.pathname))
  return new Response('Not found',{status:404});
 const context=await resolveGmailAdminSession(req,env,{now});
 const result=await handleIsolatedGmailSetup(req,env,{
  fetcher:fetcher||fetch,now,returnAuthorizationJson:true,
  isVerifiedAdmin:async()=>!!context,
  getAdminSession:async()=>context?.session||null,
  hasValidCsrf:async()=>validateGmailSetupCsrf(req,env,{now})
 });
 if(url.pathname==='/oauth/gmail/callback'&&result.status===200){
  const headers=new Headers(result.headers);
  headers.set('set-cookie',await revokeGmailSetup(req,env,{now}));
  return new Response(result.body,{status:result.status,headers});
 }
 return result;
}
