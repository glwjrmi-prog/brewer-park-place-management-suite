// BPP MAINTENANCE - ISOLATED STAGING LOGIN ORCHESTRATOR (NOT DEPLOYED)
// A verified email inbox is not evidence of unit ownership. This module only
// sends a one-use sign-in link to an email with active Board-approved unit access.
// The public endpoint must independently enforce request size, origin, and
// address/network abuse controls. No provider or account is configured here.
import {normalizeEmail,createEmailChallenge,consumeEmailChallenge} from './resident-access.mjs';
import {activeUnitsForVerifiedEmail} from './verified-unit-registry.mjs';
import {reserveLoginAttempt} from './resident-login-rate-limit.mjs';
const generic=Object.freeze({ok:true,message:'If this address is authorized, a sign-in email will be sent.'});
const invalid=Object.freeze({ok:false,message:'Please check the information and try again.'});
const maxCaptchaLength=4096;
export async function verifyTurnstile({token,secret,fetcher=fetch,remoteIp}){
 if(typeof token!=='string'||token.length<1||token.length>maxCaptchaLength||typeof secret!=='string'||secret.length<12)
  return false;
 try{
  const payload=new URLSearchParams({secret,response:token});
  if(remoteIp&&typeof remoteIp==='string'&&remoteIp.length<=64)payload.set('remoteip',remoteIp);
  const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:payload,
   signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)return false;
  const result=await response.json();
  return result?.success===true;
 }catch{return false}
}
export async function requestPrivateLogin({db,email,turnstileToken,secret,fetcher,sendLink,linkBase,remoteIp,requesterId,rateLimitSecret,now=Date.now()}){
 // Callers MUST return the same generic reply for unlisted addresses. No raw
 // challenge is written to a public response, logs, or analytics.
 const valid=normalizeEmail(email);
 if(!valid||typeof sendLink!=='function'||!db?.prepare||!/^https:\/\//.test(String(linkBase||'')))
  return invalid;
 const captcha=await verifyTurnstile({token:turnstileToken,secret,fetcher,remoteIp,now});
 if(!captcha)return invalid;
 // All valid and unknown emails use the same quota path; never reveal registry existence.
 // requesterId must come from the trusted Cloudflare edge, never from an untrusted form field.
 try{
  if(!await reserveLoginAttempt({db,email:valid,requesterId,secret:rateLimitSecret,now}))return generic;
 }catch{return invalid}
 // The trust decision comes solely from the Board-managed, active unit registry.
 const units=await activeUnitsForVerifiedEmail(db,valid);
 if(!units.length)return generic;
 const challenge=await createEmailChallenge(db,valid,now);
 const link=new URL(linkBase);
 // A fragment keeps token out of most reverse-proxy access logs. The consuming
 // frontend must erase the fragment immediately after reading, and never beacon it.
 link.hash='login='+encodeURIComponent(challenge.privateToken);
 try{
  const accepted=await sendLink({
   to:valid,
   subject:'Brewer Park Place maintenance access',
   text:'Use this one-time sign-in link within 15 minutes: '+link.toString(),
   // Never share resident details or unit numbers in email.
   expiresAt:challenge.expiresAt
  });
  if(accepted!==true)throw new Error('Provider did not accept email');
 }catch{
  // Disable the undelivered token before returning a non-enumerating reply.
  await db.prepare('UPDATE resident_email_challenges SET consumed_at=? WHERE challenge_hash=? AND consumed_at IS NULL')
   .bind(now,await hashHex(challenge.privateToken)).run();
  return generic;
 }
 return generic;
}
async function hashHex(value){
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function redeemPrivateLogin({db,token,now=Date.now()}){
 const session=await consumeEmailChallenge(db,token,now);
 if(!session)return null;
 const units=await activeUnitsForVerifiedEmail(db,session.email);
 if(!units.length)return null;
 return {privateSession:session.privateSession,expiresAt:session.expiresAt};
}
