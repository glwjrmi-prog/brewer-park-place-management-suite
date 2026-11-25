// BPP isolated maintenance staging: verified Cloudflare Access JWT identity adapter.
// NOT installed in active Worker. Must be coupled with a protected Access app,
// server-side board authorization, and privately provisioned email/role settings.
// Never trust an X-Email or X-Role request header as identity.

export class AccessDenied extends Error {
 constructor(){super('Access denied');this.name='AccessDenied'}
}
const base64url=(value)=>{
 if(typeof value!=='string'||! /^[A-Za-z0-9_-]+$/.test(value))throw new AccessDenied();
 return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
};
function decodePart(s){
 try{return JSON.parse(new TextDecoder().decode(base64url(s)))}catch{throw new AccessDenied()}
}
function teamOrigin(domain){
 if(typeof domain!=='string'||! /^[a-z0-9][a-z0-9.-]*\.cloudflareaccess\.com$/.test(domain)||domain.includes('..'))throw new AccessDenied();
 return 'https://'+domain;
}
export async function verifyCloudflareAccessIdentity(jwt,{
 teamDomain,audience,fetcher=fetch,nowSec=Math.floor(Date.now()/1000)
}={}){
 if(typeof jwt!=='string'||jwt.length>12000)throw new AccessDenied();
 const segments=jwt.split('.');
 if(segments.length!==3)throw new AccessDenied();
 const [headerText,payloadText,signatureText]=segments;
 const header=decodePart(headerText),payload=decodePart(payloadText);
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||!header.kid)throw new AccessDenied();
 const origin=teamOrigin(teamDomain);
 if(typeof audience!=='string'||!audience||payload.iss!==origin||!Array.isArray(payload.aud)||!payload.aud.includes(audience))throw new AccessDenied();
 if(!Number.isSafeInteger(payload.nbf)||!Number.isSafeInteger(payload.exp)||payload.nbf>nowSec+30||payload.exp<=nowSec||payload.exp-nowSec>86400)throw new AccessDenied();
 if(typeof payload.email!=='string'||payload.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))throw new AccessDenied();
 let keys;
 try{
  const res=await fetcher(origin+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!res.ok)throw new AccessDenied();
  const certs=await res.json();
  keys=certs?.keys;
 }catch{throw new AccessDenied()}
 if(!Array.isArray(keys)||keys.length>30)throw new AccessDenied();
 const jwk=keys.find(k=>k?.kid===header.kid&&k?.kty==='RSA'&&k?.alg==='RS256'&&k?.use==='sig');
 if(!jwk)throw new AccessDenied();
 try{
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64url(signatureText),new TextEncoder().encode(headerText+'.'+payloadText));
  if(!valid)throw new AccessDenied();
 }catch{throw new AccessDenied()}
 return Object.freeze({email:payload.email.toLowerCase(),subject:typeof payload.sub==='string'?payload.sub:''});
}
export function authorizeStagingBoard(identity,allowlist){
 if(!identity||typeof identity.email!=='string'||!Array.isArray(allowlist)||allowlist.length===0)throw new AccessDenied();
 if(allowlist.length>30||allowlist.some(x=>typeof x!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))throw new AccessDenied();
 const allowed=new Set(allowlist.map(x=>x.toLowerCase()));
 if(!allowed.has(identity.email.toLowerCase()))throw new AccessDenied();
 return Object.freeze({email:identity.email.toLowerCase(),role:'board',subject:identity.subject||''});
}
