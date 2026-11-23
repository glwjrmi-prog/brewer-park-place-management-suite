// BPP PRIVATE LOGIN RATE LIMIT, isolated D1 only.
// HMAC subject hashes avoid storing raw email/IP values in the quota table.
// The caller MUST derive requesterId from trusted Cloudflare network metadata;
// never trust a browser-controlled X-Forwarded-For header.
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function subjectHash(secret,scope,value){
 if(typeof secret!=='string'||secret.length<32||typeof value!=='string'||value.length<1)
  throw new Error('Rate-limit secret or subject missing');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(scope+':'+value)));
}
async function increment(db,scope,key,now,windowMs,maxAttempts){
 const start=Math.floor(now/windowMs)*windowMs;
 const result=await db.prepare(
  'INSERT INTO resident_login_attempt_limits(scope,subject_hash,window_start,attempt_count) VALUES(?,?,?,1) '+
  'ON CONFLICT(scope,subject_hash) DO UPDATE SET '+
  'window_start=excluded.window_start,attempt_count=CASE WHEN window_start=excluded.window_start THEN attempt_count+1 ELSE 1 END '+
  'WHERE window_start<>excluded.window_start OR attempt_count<?'
 ).bind(scope,key,start,maxAttempts).run();
 return Number(result?.meta?.changes||0)===1;
}
export async function reserveLoginAttempt({db,email,requesterId,secret,now=Date.now(),windowMs=3600000,maxEmails=3,maxRequester=15}){
 if(!db?.prepare||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(windowMs)||windowMs<60000||
  !Number.isSafeInteger(maxEmails)||maxEmails<1||!Number.isSafeInteger(maxRequester)||maxRequester<1)
  throw new Error('Unsafe login rate-limit configuration');
 // A deterministic failure stops issuance. Both counters are reserved even
 // when a requester has reached a limit; this can only reduce traffic.
 const emailKey=await subjectHash(secret,'email',String(email||'').trim().toLowerCase());
 const requesterKey=await subjectHash(secret,'requester',requesterId);
 const byEmail=await increment(db,'email',emailKey,now,windowMs,maxEmails);
 const byNetwork=await increment(db,'requester',requesterKey,now,windowMs,maxRequester);
 return byEmail&&byNetwork;
}
