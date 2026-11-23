// BPP maintenance intake — ISOLATED STAGING CANDIDATE. NO production integration.
import {residentRequests,authenticatedEmail} from './resident-access.mjs';
import {askAdvisor} from './policy-advisor.mjs';
// Bind INTAKE_DB to a NEW, dedicated D1 database; do not bind Suite v9 DB.
// RESIDENT_STAGING_TOKEN and BOARD_STAGING_TOKEN are distinct temporary test credentials.
// Not for public deployment: live release requires existing BPP per-user PIN sessions,
// per-unit authorization, abuse prevention, and production security review.
const allowedAreas=new Set(['Exterior of unit','Common area / grounds','Interior of unit']);
const allowedCategories=new Set(['Exterior trim / paint','Siding','Roof / gutters','Doors / windows','Landscaping / grounds','Drainage / water','Sidewalk / pavement','Other']);
const responsibilities=new Set(['association','owner','shared_or_disputed','requires_more_information']);
const priorities=new Set(['routine','high','emergency']);
const approvedResidentMessages={association:'The board reviewed your request and identified this as an association maintenance matter. The association will determine next steps.',owner:'The board reviewed your request and determined that the owner is responsible for this maintenance.',shared_or_disputed:'The board reviewed the request. Additional coordination may be needed to determine the applicable responsibilities.',requires_more_information:'The board reviewed your request and needs more information before determining responsibility.'};
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
async function submit(req,env,headers,ownerEmail=null){
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 const key=req.headers.get('idempotency-key')||'';
 if(!validRequest(body,key))return encode({error:'Invalid fields or missing idempotency key'},422,headers);
 const exists=await env.INTAKE_DB.prepare('SELECT id,unit,area,category,description,escalation,submitter_email FROM intake_requests WHERE submission_key=?').bind(key).first();
 if(exists){
  const same=exists.submitter_email===ownerEmail&&exists.unit===body.unit.trim()&&exists.area===body.area&&exists.category===body.category&&exists.description===body.description.trim()&&!!exists.escalation===body.escalation;
  return same?encode({ok:true,id:exists.id,status:'pending_board_review',duplicate:true},200,headers):encode({error:'Idempotency key already used for different request'},409,headers);
 }
 const id='BPP-STG-'+crypto.randomUUID(),now=new Date().toISOString();
 // Fail closed if urgency was reported but the staging board recipient set is absent.
 const recipients=body.escalation?stagingRecipients(env):[];
 if(recipients===null)return encode({error:'Urgent intake is unavailable: board alert configuration missing'},503,headers);
 try{
  const statements=[
   env.INTAKE_DB.prepare('INSERT INTO intake_requests(id,submission_key,unit,area,category,description,escalation,status,created_at,submitter_email) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,key,body.unit.trim(),body.area,body.category,body.description.trim(),body.escalation?1:0,'pending_board_review',now,ownerEmail),
   env.INTAKE_DB.prepare('INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) VALUES(?,?,?,?,?,?)').bind(id,'submitted','resident','staging resident',now,JSON.stringify({escalation:body.escalation}))
  ];
  for(const recipient of recipients)statements.push(env.INTAKE_DB.prepare("INSERT INTO urgent_alert_outbox(request_id,recipient_key,status,created_at) VALUES(?,?,'simulation_pending',?)").bind(id,recipient,now));
  // All-or-nothing D1 batch: request, audit event, and simulated alert recipients.
  await env.INTAKE_DB.batch(statements);
 }catch(e){
  // Racing same-key submissions: return existing receipt, never make duplicate work orders.
  const row=await env.INTAKE_DB.prepare('SELECT id,unit,area,category,description,escalation,submitter_email FROM intake_requests WHERE submission_key=?').bind(key).first();
  if(row){const same=row.submitter_email===ownerEmail&&row.unit===body.unit.trim()&&row.area===body.area&&row.category===body.category&&row.description===body.description.trim()&&!!row.escalation===body.escalation;return same?encode({ok:true,id:row.id,status:'pending_board_review',duplicate:true},200,headers):encode({error:'Idempotency key conflict'},409,headers)}
  throw e;
 }
 return encode({ok:true,id,status:'pending_board_review',disclaimer:'Board review required. No responsibility decision has been made.'},201,headers);
}

// Private supplemental information from the owner of this individual intake.
// A reviewed request returns to pending review; earlier board determinations stay
// only in the audit trail and are no longer exposed as current resident guidance.
async function residentUpdates(req,env,id,headers,ownerEmail){
 const request=await env.INTAKE_DB.prepare('SELECT id,version,status FROM intake_requests WHERE id=? AND submitter_email=?').bind(id,ownerEmail).first();
 if(!request)return encode({error:'Request not found'},404,headers);
 if(req.method==='GET'){
  const found=await env.INTAKE_DB.prepare('SELECT id,details,created_at AS createdAt FROM intake_resident_updates WHERE request_id=? AND submitter_email=? ORDER BY id ASC LIMIT 100').bind(id,ownerEmail).all();
  return encode({ok:true,updates:found.results||[]},200,headers);
 }
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 if(!str(body?.details,2000)||!Number.isSafeInteger(body?.version)||body.version<1)return encode({error:'Update details and current request version required'},422,headers);
 if(request.version!==body.version)return encode({error:'Request changed: refresh before updating',code:'VERSION_CONFLICT'},409,headers);
 const draft=await env.INTAKE_DB.prepare('SELECT id FROM staged_work_order_drafts WHERE intake_request_id=?').bind(id).first();
 if(draft)return encode({error:'A work-order draft exists; contact the Board with further updates'},409,headers);
 const now=new Date().toISOString(),details=body.details.trim();
 // Update + resident supplement + audit are atomic; the INSERT statements only
 // run when the owned request has actually moved to the requested next version.
 const result=await env.INTAKE_DB.batch([
  env.INTAKE_DB.prepare("UPDATE intake_requests SET status='pending_board_review',responsibility=NULL,priority=NULL,resident_message=NULL,review_notes=NULL,board_actor=NULL,reviewed_at=NULL,version=version+1 WHERE id=? AND submitter_email=? AND version=? AND NOT EXISTS(SELECT 1 FROM staged_work_order_drafts WHERE intake_request_id=?)").bind(id,ownerEmail,body.version,id),
  env.INTAKE_DB.prepare("INSERT INTO intake_resident_updates(request_id,submitter_email,details,created_at) SELECT id,submitter_email,?,? FROM intake_requests WHERE id=? AND submitter_email=? AND version=? AND status='pending_board_review'").bind(details,now,id,ownerEmail,body.version+1),
  env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT id,'resident_supplement','resident','verified email owner',?,? FROM intake_requests WHERE id=? AND submitter_email=? AND version=? AND status='pending_board_review'").bind(now,JSON.stringify({returnedToBoard:true}),id,ownerEmail,body.version+1)
 ]);
 if(result.some(x=>Number(x?.meta?.changes||0)!==1))return encode({error:'Request changed: refresh before updating',code:'VERSION_CONFLICT'},409,headers);
 return encode({ok:true,id,status:'pending_board_review',version:body.version+1,notice:'Additional information received; Board review required.'},201,headers);
}
async function boardUpdates(env,id,headers){
 const found=await env.INTAKE_DB.prepare('SELECT id,details,created_at AS createdAt FROM intake_resident_updates WHERE request_id=? ORDER BY id ASC LIMIT 100').bind(id).all();
 return encode({ok:true,updates:found.results||[]},200,headers);
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
async function createWorkOrderDraft(req,env,id,headers){
 // No Suite data is read or written. This is an isolated staging record only.
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 if(!Number.isInteger(body?.version)||!str(body?.actor,120))return encode({error:'Current version and staging board actor required'},422,headers);
 const r=await env.INTAKE_DB.prepare('SELECT id,status,responsibility,priority,version,unit,category,description,reviewed_at,board_actor FROM intake_requests WHERE id=?').bind(id).first();
 if(!r)return encode({error:'Request not found'},404,headers);
 if(r.status!=='reviewed'||!['association','shared_or_disputed'].includes(r.responsibility)||!r.reviewed_at||!r.board_actor)return encode({error:'Only board-approved HOA/shared requests qualify for a draft'},422,headers);
 if(r.version!==body.version)return encode({error:'Request changed: refresh before retrying',code:'VERSION_CONFLICT'},409,headers);
 const already=await env.INTAKE_DB.prepare('SELECT id FROM staged_work_order_drafts WHERE intake_request_id=?').bind(id).first();
 if(already)return encode({error:'Draft already exists',code:'DUPLICATE_DRAFT',draftId:already.id},409,headers);
 const draftId='BPP-DRAFT-'+crypto.randomUUID(),now=new Date().toISOString(),actor=body.actor.trim();
 try{
  // DB transaction guards review/version and intake uniqueness; no Suite writes.
  const result=await env.INTAKE_DB.batch([
   env.INTAKE_DB.prepare("INSERT INTO staged_work_order_drafts(id,intake_request_id,created_by,created_at) SELECT ?,id,?,? FROM intake_requests WHERE id=? AND version=? AND status='reviewed' AND responsibility IN ('association','shared_or_disputed') AND reviewed_at IS NOT NULL AND board_actor IS NOT NULL").bind(draftId,actor,now,id,body.version),
   env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT intake_request_id,'staging_work_order_drafted','board',?,?,? FROM staged_work_order_drafts WHERE id=?").bind(actor,now,JSON.stringify({draftId,mode:'isolated_staging_only'}),draftId)
  ]);
  if(Number(result?.[0]?.meta?.changes||0)!==1||Number(result?.[1]?.meta?.changes||0)!==1)return encode({error:'Draft creation conflict: refresh',code:'VERSION_CONFLICT'},409,headers);
 }catch(e){
  const existing=await env.INTAKE_DB.prepare('SELECT id FROM staged_work_order_drafts WHERE intake_request_id=?').bind(id).first();
  if(existing)return encode({error:'Draft already exists',code:'DUPLICATE_DRAFT',draftId:existing.id},409,headers);
  throw e;
 }
 return encode({ok:true,draftId,intakeRequestId:id,mode:'isolated_staging_only',status:'draft',notice:'Not a Suite work order. No vendor or maintenance action authorized.'},201,headers);
}
async function listWorkOrderDrafts(env,headers){
 const result=await env.INTAKE_DB.prepare("SELECT d.id AS draftId,d.intake_request_id AS intakeRequestId,d.created_at AS createdAt,d.created_by AS createdBy,i.unit,i.category,i.description,i.priority,i.responsibility,i.reviewed_at AS reviewedAt FROM staged_work_order_drafts d JOIN intake_requests i ON i.id=d.intake_request_id ORDER BY d.created_at DESC LIMIT 100").all();
 return encode({ok:true,mode:'isolated_staging_only',drafts:result.results||[]},200,headers);
}
async function policyAdvice(req,env,id,headers){
 const row=await env.INTAKE_DB.prepare('SELECT id,area,category,status,version FROM intake_requests WHERE id=?').bind(id).first();
 if(!row)return encode({error:'Request not found'},404,headers);
 if(req.method==='GET'){
  const record=await env.INTAKE_DB.prepare('SELECT answer,question,advisor_source AS source,requested_by AS requestedBy,requested_at AS requestedAt,request_version AS requestVersion FROM intake_policy_advice WHERE request_id=?').bind(id).first();
  return record?encode({ok:true,verified:false,boardOnly:true,advice:record},200,headers):encode({ok:true,verified:false,boardOnly:true,advice:null},200,headers);
 }
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 if(!Number.isInteger(body?.version)||!str(body?.actor,120))return encode({error:'Current version and board actor required'},422,headers);
 if(row.status!=='pending_board_review')return encode({error:'Policy lookup is available before board decision only'},409,headers);
 if(row.version!==body.version)return encode({error:'Request changed: refresh before lookup',code:'VERSION_CONFLICT'},409,headers);
 if(env.POLICY_ADVISOR_ENABLED!=='true')return encode({error:'Advisor integration disabled in staging configuration'},503,headers);
 const existing=await env.INTAKE_DB.prepare('SELECT request_id FROM intake_policy_advice WHERE request_id=?').bind(id).first();
 if(existing)return encode({error:'Advice already recorded',code:'ALREADY_ADVISED'},409,headers);
 // Send ONLY the general area and category; never resident/unit/description/email.
 const fetcher=typeof env.POLICY_ADVISOR_TEST_FETCH==='function'?env.POLICY_ADVISOR_TEST_FETCH:fetch;
 let advice;
 try{advice=await askAdvisor({area:row.area,category:row.category,fetcher,signal:AbortSignal.timeout(10000)})}
 catch(e){console.error('BPP_INTAKE_STAGING_ADVISOR_UNAVAILABLE');return encode({error:'Advisor unavailable; board must review governing documents directly'},502,headers)}
 const now=new Date().toISOString(),actor=body.actor.trim();
 try{
  const result=await env.INTAKE_DB.batch([
   env.INTAKE_DB.prepare("INSERT INTO intake_policy_advice(request_id,answer,question,advisor_source,requested_by,requested_at,request_version) SELECT id,?,?,?,?,?,? FROM intake_requests WHERE id=? AND version=? AND status='pending_board_review'").bind(advice.answer,advice.question,advice.source,actor,now,body.version,id,body.version),
   env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT request_id,'policy_advice_recorded','board',?,?,? FROM intake_policy_advice WHERE request_id=? AND requested_at=?").bind(actor,now,JSON.stringify({verified:false,category:row.category}),id,now)
  ]);
  if(Number(result?.[0]?.meta?.changes||0)!==1||Number(result?.[1]?.meta?.changes||0)!==1)return encode({error:'Request changed before advice was saved',code:'VERSION_CONFLICT'},409,headers);
 }catch(e){console.error('BPP_INTAKE_STAGING_ADVICE_SAVE_FAILED');return encode({error:'Could not save preliminary advice'},409,headers)}
 return encode({ok:true,boardOnly:true,verified:false,advice:{answer:advice.answer,question:advice.question,source:advice.source,requestedBy:actor,requestedAt:now},warning:'Preliminary unverified advice only. Board must inspect source documents before determining responsibility.'},201,headers);
}
async function review(req,env,id,headers){
 let body;try{body=await req.json()}catch{return encode({error:'Invalid JSON'},400,headers)}
 if(!responsibilities.has(body?.responsibility)||!priorities.has(body?.priority)||!Number.isInteger(body?.version)||!str(body?.actor,120)||!str(body?.notes,2000))
  return encode({error:'Board review requires responsibility, priority, current version, reviewer, and notes'},422,headers);
 if(body?.residentMessage!==undefined&&(typeof body.residentMessage!=='string'||body.residentMessage.trim().length>1000))return encode({error:'Resident communication must be 1000 characters or fewer'},422,headers);
 // Never publish AI draft notes or document citations automatically. Board controls release.
 const message=body?.residentMessage?.trim()||approvedResidentMessages[body.responsibility];
 const existing=await env.INTAKE_DB.prepare('SELECT version,status FROM intake_requests WHERE id=?').bind(id).first();
 if(!existing)return encode({error:'Request not found'},404,headers);
 if(existing.status!=='pending_board_review'||existing.version!==body.version)return encode({error:'Review conflict: refresh before retrying',code:'VERSION_CONFLICT'},409,headers);
 const now=new Date().toISOString();
 // D1 batch provides one transaction for status change and its audit event.
 // The event SELECT only inserts when this version transition actually succeeded.
 const statements=[
  env.INTAKE_DB.prepare("UPDATE intake_requests SET status='reviewed', responsibility=?,priority=?,review_notes=?,resident_message=?,board_actor=?,reviewed_at=?,version=version+1 WHERE id=? AND version=? AND status='pending_board_review'").bind(body.responsibility,body.priority,body.notes.trim(),message,body.actor.trim(),now,id,body.version),
  env.INTAKE_DB.prepare("INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT id,'board_reviewed','board',?, ?, ? FROM intake_requests WHERE id=? AND version=? AND status='reviewed' AND board_actor=? AND reviewed_at=?").bind(body.actor.trim(),now,JSON.stringify({responsibility:body.responsibility,priority:body.priority,notes:body.notes.trim(),residentMessage:message}),id,body.version+1,body.actor.trim(),now)
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
 const privateUpdates=url.pathname.match(/^\/api\/my-requests\/(BPP-STG-[a-f0-9-]+)\/updates$/);
 if((url.pathname==='/api/my-requests'&&req.method==='GET')||(url.pathname==='/api/private/requests'&&req.method==='POST')||(privateUpdates&&(req.method==='GET'||req.method==='POST'))){
  if(!env.INTAKE_DB)return encode({error:'Staging configuration incomplete'},503,headers);
  const h=req.headers.get('authorization')||'';
  if(!h.startsWith('Bearer '))return encode({error:'Unauthorized'},401,headers);
  try{
   const session=h.slice(7);
   if(privateUpdates){
    const email=await authenticatedEmail(env.INTAKE_DB,session);
    return email?residentUpdates(req,env,privateUpdates[1],headers,email):encode({error:'Unauthorized'},401,headers);
   }
   if(req.method==='POST'){
    const email=await authenticatedEmail(env.INTAKE_DB,session);
    return email?submit(req,env,headers,email):encode({error:'Unauthorized'},401,headers);
   }
   const records=await residentRequests(env.INTAKE_DB,session);
   return records===null?encode({error:'Unauthorized'},401,headers):encode({ok:true,requests:records},200,headers);
  }catch(e){console.error('BPP_INTAKE_STAGING_PRIVATE_ACCESS_FAILED');return encode({error:'Private access unavailable'},503,headers)}
 }
 if(!env.INTAKE_DB||!env.BOARD_STAGING_TOKEN||!env.RESIDENT_STAGING_TOKEN||env.BOARD_STAGING_TOKEN===env.RESIDENT_STAGING_TOKEN)return encode({error:'Staging configuration incomplete'},503,headers);
 const role=roleOf(req,env);if(!role)return encode({error:'Unauthorized'},401,headers);
 try{
  if(url.pathname==='/api/requests'&&req.method==='POST'&&role==='resident')return submit(req,env,headers);
  if(url.pathname==='/api/requests'&&req.method==='GET'&&role==='board')return list(env,headers);
  if(url.pathname==='/api/work-order-drafts'&&req.method==='GET'&&role==='board')return listWorkOrderDrafts(env,headers);
  const boardSupplement=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/updates$/);
  if(boardSupplement&&req.method==='GET'&&role==='board')return boardUpdates(env,boardSupplement[1],headers);
  const advisor=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/policy-advice$/);
  if(advisor&&(req.method==='GET'||req.method==='POST')&&role==='board')return policyAdvice(req,env,advisor[1],headers);
  const draft=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/work-order-draft$/);
  if(draft&&req.method==='POST'&&role==='board')return createWorkOrderDraft(req,env,draft[1],headers);
  const ack=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/acknowledge$/);
  if(ack&&req.method==='POST'&&role==='board')return acknowledgeUrgent(req,env,ack[1],headers);
  const m=url.pathname.match(/^\/api\/requests\/(BPP-STG-[a-f0-9-]+)\/review$/);
  if(m&&req.method==='POST'&&role==='board')return review(req,env,m[1],headers);
  return encode({error:'Forbidden or not found'},role==='resident'?403:404,headers);
 }catch(e){console.error('BPP_INTAKE_STAGING_REQUEST_FAILED');return encode({error:'Internal staging error'},500,headers)}
}};
