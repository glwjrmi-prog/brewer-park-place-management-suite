// BPP maintenance intake — ISOLATED STAGING CANDIDATE. NO production integration.
import {residentRequests} from './resident-access.mjs';
// Bind INTAKE_DB to a NEW, dedicated D1 database; do not bind Suite v9 DB.
// RESIDENT_STAGING_TOKEN and BOARD_STAGING_TOKEN are distinct temporary test credentials.
// Not for public deployment: live release requires existing BPP per-user PIN sessions,
// per-unit authorization, abuse prevention, and production security review.
const allowedAreas=new Set(['Exterior of unit','Common area / grounds','Interior of unit']);
const allowedCategories=new Set(['Exterior trim / paint','Siding','Roof / gutters','Doors / windows','Landscaping / grounds','Drainage / water','Sidewalk / pavement','Other']);
const responsibilities=new Set(['association','owner','shared_or_disputed','requires_more_information']);
const priorities=new Set(['routine','high','emergency']);
const encode=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const str=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;
function equal(a,b){if(!a||!b||a.length!==b.length)return false;let z=0;for(let i=0;i<a.length;i++)z|=a.charCodeAt(i)^b.charCodeAt(i);return z===0;}
function roleOf(req,env){const h=req.headers.get('authorization')||'';if(!h.startsWith('Bearer '))return null;const token=h.slice(7);if(equal(token,env.BOARD_STAGING_TOKEN))return 'board';if(equal(token,env.RESIDENT_STAGING_TOKEN))return 'resident';return null;}
function cors(req,env){const origin=req.headers.get('origin');const allowed=String(env.ALLOWED_STAGING_ORIGIN||'');return origin&&origin===allowed?{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type,idempotency-key','access-control-allow-methods':'GET,POST,OPTIONS','vary':'Origin'}:{};}
function validRequest(body,key){return !!str(key,128)&&!!str(body?.unit,80)&&allowedAreas.has(body?.area)&&allowedCategories.has(body?.category)&&!!str(body?.description,2000)&&typeof body?.escalation==='boolean';}
function safeRequest(r){return {id:r.id,unit:r.unit,area:r.area,category:r.category,description:r.description,escalation:!!r.escalation,status:r.status,createdAt:r.created_at,version:r.version,urgentAcknowledged:!!r.urgent_ack_at,urgentCoordinator:r.urgent_ack_by||null, ...(r.status==='reviewed'?{responsibility:r.responsibility,priority:r.priority,reviewedAt:r.reviewed_at}:{})};}
// A list of opaque sample board identities, never email addresses.
// This staging candidate intentionally does not send messages.
function stagingRecipients(env){
 let names;try{names=JSON.parse(String(env.STAGING_BOARD_RECIPIENT_KEYS||'[]'))}catch{return null}
 if(!Array.isArray(names)||names.length<1||names.length>20)return null;
 if(names.some(x=>typeof x!=='string'||!/^test-board-[a-z0-9-]{1,35}$/.test(x)))return null;
 return [...new Set(names)];
}
async function submit(req,env,headers){
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 const key=req.headers.get('idempotency-key')||'';
 if(!validRequest(body,key))return encode({error:'Invalid fields or missing idempotency key'},422,headers);
 const exists=await env.INTAKE_DB.prepare('SELECT id,unit,area,category,description,escalation FROM intake_requests WHERE submission_key=?').bind(key).first();
 if(exists){
  const same=exists.unit===body.unit.trim()&&exists.area===body.area&&exists.category===body.category&&exists.description===body.description.trim()&&!!exists.escalation===body.escalation;
  return same?encode({ok:true,id:exists.id,status:'pending_board_review',duplicate:true},200,headers):encode({error:'Idempotency key already used for different request'},409,headers);
 }
 const id='BPP-STG-'+crypto.randomUUID(),now=new Date().toISOString();
 // Fail closed if urgency was reported but the staging board recipient set is absent.
 const recipients=body.escalation?stagingRecipients(env):[];
 if(recipients===null)return encode({error:'Urgent intake is unavailable: board alert configuration missing'},503,headers);
 try{
  const statements=[
   env.INTAKE_DB.prepare('INSERT INTO intake_requests(id,submission_key,unit,area,category,description,escalation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,key,body.unit.trim(),body.area,body.category,body.description.trim(),body.escalation?1:0,'pending_board_review',now),
   env.INTAKE_DB.prepare('INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) VALUES(?,?,?,?,?,?)').bind(id,'submitted','resident','staging resident',now,JSON.stringify({escalation:body.escalation}))
  ];
  for(const recipient of recipients)statements.push(env.INTAKE_DB.prepare("INSERT INTO urgent_alert_outbox(request_id,recipient_key,status,created_at) VALUES(?,?,'simulation_pending',?)").bind(id,recipient,now));
  // All-or-nothing D1 batch: request, audit event, and simulated alert recipients.
  await env.INTAKE_DB.batch(statements);
 }catch(e){
  // Racing same-key submissions: return existing receipt, never make duplicate work orders.
  const row=await env.INTAKE_DB.prepare('SELECT id,unit,area,category,description,escalation FROM intake_requests WHERE submission_key=?').bind(key).first();
  if(row){const same=row.unit===body.unit.trim()&&row.area===body.area&&row.category===body.category&&row.description===body.description.trim()&&!!row.escalation===body.escalation;return same?encode({ok:true,id:row.id,status:'pending_board_review',duplicate:true},200,headers):encode({error:'Idempotency key conflict'},409,headers)}
  throw e;
 }
 return encode({ok:true,id,status:'pending_board_review',disclaimer:'Board review required. No responsibility decision has been made.'},201,headers);
}
async function list(env,headers){
 const result=await env.INTAKE_DB.prepare('SELECT id,unit,area,category,description,escalation,status,responsibility,priority,review_notes,board_actor,created_at,reviewed_at,urgent_ack_by,urgent_ack_at,version FROM intake_requests ORDER BY created_at DESC LIMIT 100').all();
 return encode({ok:true,requests:(result.results||[]).map(r=>({...safeRequest(r),reviewNotes:r.review_notes,boardActor:r.board_actor,provisionalAssessment:{responsibility:'not_assessed',reason:'Awaiting verified governing documents and board review',citations:[]}}))},200,headers);
}
async function acknowledgeUrgent(req,env,id,headers){
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 // The actor is a TEST-only label; existing BPP authenticated board identity must replace it.
 if(!Number.isInteger(body?.version)||!str(body?.actor,120))return encode({error:'Version and test board actor required'},422,headers);
 const row=await env.INTAKE_DB.prepare('SELECT id,version,escalation,urgent_ack_by,urgent_ack_at FROM intake_requests WHERE id=?').bind(id).first();
 if(!row)return encode({error:'Request not found'},404,headers);
 if(!row.escalation)return encode({error:'This request was not flagged urgent'},422,headers);
 if(row.urgent_ack_at)return encode({error:'Already acknowledged by another board member',code:'ALREADY_ACKNOWLEDGED',coordinator:row.urgent_ack_by},409,headers);
 if(row.version!==body.version)return encode({error:'Request changed: refresh before acknowledging',code:'VERSION_CONFLICT'},409,headers);
 const now=new Date().toISOString(),actor=body.actor.trim();
 const result=await env.INTAKE_DB.batch([
  env.INTAKE_DB.prepare('UPDATE intake_requests SET urgent_ack_by=?,urgent_ack_at=?,version=version+1 WHERE id=? AND escalation=1 AND urgent_ack_at IS NULL AND version=?').bind(actor,now,id,body.version),
  env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT id,'urgent_acknowledged','board',?,?,? FROM intake_requests WHERE id=? AND urgent_ack_by=? AND urgent_ack_at=? AND version=?").bind(actor,now,JSON.stringify({coordinator:actor}),id,actor,now,body.version+1)
 ]);
 if(Number(result?.[0]?.meta?.changes||0)!==1||Number(result?.[1]?.meta?.changes||0)!==1)
  return encode({error:'Another board member changed this request',code:'VERSION_CONFLICT'},409,headers);
 return encode({ok:true,id,urgentAcknowledged:true,coordinator:actor,version:body.version+1,notice:'Simulated board acknowledgement only. No alerts sent and no contractor dispatched.'},200,headers);
}
async function review(req,env,id,headers){
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 if(!responsibilities.has(body?.responsibility)||!priorities.has(body?.priority)||!Number.isInteger(body?.version)||!str(body?.actor,120)||!str(body?.notes,2000))
  return encode({error:'Board review requires responsibility, priority, current version, reviewer, and notes'},422,headers);
 const existing=await env.INTAKE_DB.prepare('SELECT version,status FROM intake_requests WHERE id=?').bind(id).first();
 if(!existing)return encode({error:'Request not found'},404,headers);
 if(existing.status!=='pending_board_review'||existing.version!==body.version)return encode({error:'Review conflict: refresh before retrying',code:'VERSION_CONFLICT'},409,headers);
 const now=new Date().toISOString();
 // D1 batch provides one transaction for status change and its audit event.
 // The event SELECT only inserts when this version transition actually succeeded.
 const statements=[
  env.INTAKE_DB.prepare("UPDATE intake_requests SET status='reviewed', responsibility=?,priority=?,review_notes=?,board_actor=?,reviewed_at=?,version=version+1 WHERE id=? AND version=? AND status='pending_board_review'").bind(body.responsibility,body.priority,body.notes.trim(),body.actor.trim(),now,id,body.version),
  env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT id,'board_reviewed','board',?, ?, ? FROM intake_requests WHERE id=? AND version=? AND status='reviewed' AND board_actor=? AND reviewed_at=?").bind(body.actor.trim(),now,JSON.stringify({responsibility:body.responsibility,priority:body.priority,notes:body.notes.trim()}),id,body.version+1,body.actor.trim(),now)
 ];
 const result=await env.INTAKE_DB.batch(statements);
 if(Number(result?.[0]?.meta?.changes||0)!==1||Number(result?.[1]?.meta?.changes||0)!==1)
  return encode({error:'Review conflict: refresh before retrying',code:'VERSION_CONFLICT'},409,headers);
 return encode({ok:true,id,status:'reviewed',version:body.version+1},200,headers);
}
export default {async fetch(req,env){
 const url=new URL(req.url),headers=cors(req,env);
 if(url.pathname==='/health'&&req.method==='GET')return encode({ok:true,service:'bpp-maintenance-intake-isolated-staging'},200,headers);
 const origin=req.headers.get('origin');
 if(origin&&origin!==String(env.ALLOWED_STAGING_ORIGIN||''))return encode({error:'Origin denied'},403,headers);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 // PRIVATE READ: only a separately verified, short-lived resident session may list requests.
 // Do not accept the shared staging resident token or a unit number as proof of identity.
 if(url.pathname==='/api/my-requests'&&req.method==='GET'){
  if(!env.INTAKE_DB)return encode({error:'Staging configuration incomplete'},503,headers);
  const h=req.headers.get('authorization')||'';
  if(!h.startsWith('Bearer '))return encode({error:'Unauthorized'},401,headers);
  try{
   const records=await residentRequests(env.INTAKE_DB,h.slice(7));
   return records===null?encode({error:'Unauthorized'},401,headers):encode({ok:true,requests:records},200,headers);
  }catch(e){console.error('Isolated private request lookup error',e);return encode({error:'Private access unavailable'},503,headers)}
 }
 if(!env.INTAKE_DB||!env.BOARD_STAGING_TOKEN||!env.RESIDENT_STAGING_TOKEN||env.BOARD_STAGING_TOKEN===env.RESIDENT_STAGING_TOKEN)return encode({error:'Staging configuration incomplete'},503,headers);
 const role=roleOf(req,env);if(!role)return encode({error:'Unauthorized'},401,headers);
 try{
  if(url.pathname==='/api/requests'&&req.method==='POST'&&role==='resident')return submit(req,env,headers);
  if(url.pathname==='/api/requests'&&req.method==='GET'&&role==='board')return list(env,headers);
  const ack=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/acknowledge$/);
  if(ack&&req.method==='POST'&&role==='board')return acknowledgeUrgent(req,env,ack[1],headers);
  const m=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/review$/);
  if(m&&req.method==='POST'&&role==='board')return review(req,env,m[1],headers);
  return encode({error:'Forbidden or not found'},role==='resident'?403:404,headers);
 }catch(e){console.error('Staging intake error',e);return encode({error:'Internal staging error'},500,headers)}
}};
