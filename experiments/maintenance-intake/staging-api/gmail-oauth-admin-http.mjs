// BPP MAINTENANCE — standalone, STAGING-ONLY admin OAuth HTTP handler.
// Not mounted in the public Policy Advisor or in the disabled intake Worker.
// Caller supplies a real, verified BPP ADMIN session check (not a browser flag),
// CSRF validation, Google client secrets, isolated D1, and an audited secure
// refresh-token vault. No client credentials or tokens are returned to browsers.
import {beginGmailAuthorization,finishGmailAuthorization} from './gmail-oauth.mjs';
function reply(message,status=200,headers={}){
 return new Response(message,{status,headers:{'content-type':'text/plain; charset=utf-8',
  'cache-control':'no-store, private','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','x-frame-options':'DENY',...headers}});
}
function safeEnv(env){
 if(env?.STAGING_INTAKE_ENABLED!=='true'||env?.STAGING_GMAIL_OAUTH_ENABLED!=='true'||
  !env?.INTAKE_DB||!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET||
  !env.GMAIL_REDIRECT_URI)throw new Error('Gmail OAuth staging disabled');
 return {db:env.INTAKE_DB,clientId:env.GMAIL_CLIENT_ID,clientSecret:env.GMAIL_CLIENT_SECRET,
  redirectUri:env.GMAIL_REDIRECT_URI};
}
function originOf(req){
 let url;try{url=new URL(req.url)}catch{return null}
 return url.origin;
}
export async function handleGmailAdminOAuth(req,env,{
 isVerifiedAdmin,getAdminSession,hasValidCsrf,saveRefreshToken,now=Date.now(),fetcher=fetch
}={}){
 // All auth checks must use real, server-validated per-person Board/admin
 // identities. Never trust a request header's stated role.
 const expectedOrigin=String(env?.STAGING_ADMIN_ORIGIN||'');
 if(!expectedOrigin||!/^https:\/\//.test(expectedOrigin)||
  originOf(req)!==expectedOrigin)return reply('Unavailable',404);
 if(typeof isVerifiedAdmin!=='function'||!await isVerifiedAdmin(req))
  return reply('Unauthorized',401);
 // A second verified admin may not complete someone else's Gmail consent.
 // Bind handshake to an opaque, server-verified admin session token.
 const adminSession=typeof getAdminSession==='function'?await getAdminSession(req):null;
 if(typeof adminSession!=='string'||adminSession.length<16)return reply('Unauthorized',401);
 let config;try{config=safeEnv(env)}catch{return reply('Unavailable',503)}
 const url=new URL(req.url);
 if(url.pathname==='/oauth/gmail/start'){
  if(req.method!=='POST')return reply('Method not allowed',405,{allow:'POST'});
  if(req.headers.get('origin')!==expectedOrigin||typeof hasValidCsrf!=='function'||
   !await hasValidCsrf(req))return reply('Forbidden',403);
  try{
   const flow=await beginGmailAuthorization({...config,adminVerified:true,adminSession,now});
   return reply('',302,{location:flow.authorizationUrl});
  }catch{return reply('Unable to start authorization',503)}
 }
 if(url.pathname==='/oauth/gmail/callback'){
  if(req.method!=='GET')return reply('Method not allowed',405,{allow:'GET'});
  // Google communicates failure using an error parameter, never exchange.
  if(url.searchParams.has('error'))return reply('Google authorization was not approved',400);
  const code=url.searchParams.get('code'),state=url.searchParams.get('state');
  if(typeof code!=='string'||typeof state!=='string')return reply('Invalid callback',400);
  if(typeof saveRefreshToken!=='function')return reply('Secure token storage unavailable',503);
  try{
   const result=await finishGmailAuthorization({...config,adminVerified:true,
    state,code,adminSession,now,fetcher});
   // A successful provider token exchange is not considered connected until
   // the confidential refresh token is securely saved on the server.
   await saveRefreshToken({refreshToken:result.refreshToken,
    scope:result.scope,expiresIn:result.expiresIn});
   return reply('Gmail authorization saved for BPP maintenance notifications. No email has been sent.');
  }catch{return reply('Gmail authorization could not be saved. No email has been sent.',503)}
 }
 return reply('Not found',404);
}
