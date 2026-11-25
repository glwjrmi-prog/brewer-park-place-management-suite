// Private resident-access primitives for isolated staging only. NOT wired to public routes.
// Caller must apply rate limits, send challenges via approved email provider,
// and bind only authenticated email to request ownership. No email is sent here.
// All tokens are 256-bit random values; only SHA-256 digests are persisted.
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(value){
 if(typeof value!=='string')return null;
 const email=value.trim().toLowerCase();
 return email.length<=254&&EMAIL_RE.test(email)?email:null;
}
function token(){
 const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
 return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function digest(value){
 const bytes=new TextEncoder().encode(value);
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createEmailChallenge(db,emailValue,now=Date.now()){
 const email=normalizeEmail(emailValue);if(!email)throw new Error('Invalid email');
 const raw=token(),hash=await digest(raw),expiresAt=now+15*60*1000;
 await db.prepare('INSERT INTO resident_email_challenges(challenge_hash,email,expires_at,created_at) VALUES(?,?,?,?)').bind(hash,email,expiresAt,now).run();
 // Only trusted backend may receive raw. Never return raw in a public HTTP response.
 return {privateToken:raw,email,expiresAt};
}
export async function consumeEmailChallenge(db,raw,now=Date.now()){
 if(typeof raw!=='string'||! /^[a-f0-9]{64}$/.test(raw))return null;
 const hash=await digest(raw),session=token(),sessionHash=await digest(session);
 const row=await db.prepare('SELECT email FROM resident_email_challenges WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>?').bind(hash,now).first();
 if(!row)return null;
 // The session is atomically inserted from the still-unconsumed challenge.
 // UNIQUE(challenge_hash) ensures the challenge cannot issue a second session.
 try{
  const result=await db.batch([
   db.prepare('INSERT INTO resident_email_sessions(session_hash,challenge_hash,email,expires_at,created_at) SELECT ?,challenge_hash,email,?,? FROM resident_email_challenges WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>?').bind(sessionHash,now+60*60*1000,now,hash,now),
   db.prepare('UPDATE resident_email_challenges SET consumed_at=? WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>?').bind(now,hash,now)
  ]);
  if(Number(result?.[0]?.meta?.changes||0)!==1||Number(result?.[1]?.meta?.changes||0)!==1)return null;
 }catch{return null}
 return {privateSession:session,email:row.email,expiresAt:now+60*60*1000};
}
export async function authenticatedEmail(db,raw,now=Date.now()){
 if(typeof raw!=='string'||! /^[a-f0-9]{64}$/.test(raw))return null;
 const sessionHash=await digest(raw);
 const row=await db.prepare('SELECT email FROM resident_email_sessions WHERE session_hash=? AND expires_at>?').bind(sessionHash,now).first();
 return row?.email||null;
}
export async function residentRequests(db,session,now=Date.now()){
 const email=await authenticatedEmail(db,session,now);
 if(!email)return null;
 const records=await db.prepare('SELECT id,unit,area,category,description,escalation,status,version,created_at,reviewed_at,responsibility,resident_message FROM intake_requests WHERE submitter_email=? ORDER BY created_at DESC LIMIT 100').bind(email).all();
 // Never include notes, AI evaluation, board identity or another resident's request.
 return (records.results||[]).map(r=>({id:r.id,unit:r.unit,area:r.area,category:r.category,description:r.description,escalation:!!r.escalation,status:r.status,version:r.version,createdAt:r.created_at,reviewedAt:r.reviewed_at, ...(['reviewed','scheduled','deferred','completed'].includes(r.status)?{responsibility:r.responsibility,residentMessage:r.resident_message}:{})}));
}
