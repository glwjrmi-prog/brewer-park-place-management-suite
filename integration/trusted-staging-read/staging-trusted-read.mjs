/** BPP staging trusted import lookup — OFFLINE CANDIDATE, NOT DEPLOYABLE. */
const ID=/^BPP-STG-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY=/^[0-9a-f]{64}$/;
const HEADERS={'cache-control':'no-store, private','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const reply=(b,s)=>new Response(JSON.stringify(b),{status:s,headers:HEADERS});
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!KEY.test(a)||!KEY.test(b))return false;let v=0;for(let i=0;i<64;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0}
export async function readApprovedStagingDraft(req,env){
  if(env?.STAGING_IMPORT_LOOKUP_ENABLED!=='true'||!env?.INTAKE_DB||!KEY.test(String(env.BPP_IMPORT_SERVICE_SECRET||'')))return reply({error:'Unavailable'},503);
  if(req.method!=='GET')return reply({error:'Method not allowed'},405);
  if(req.headers.get('origin')||req.headers.get('cookie')||!equal(req.headers.get('x-bpp-import-service-key'),env.BPP_IMPORT_SERVICE_SECRET))return reply({error:'Unauthorized'},401);
  let url;try{url=new URL(req.url)}catch{return reply({error:'Not found'},404)}
  const m=url.pathname.match(/^\/internal\/approved-intake\/(BPP-STG-[0-9a-f-]+)$/);
  if(!m||!ID.test(m[1])||url.search)return reply({error:'Not found'},404);
  let r;try{r=await env.INTAKE_DB.prepare(`SELECT i.id AS sourceId,i.version,i.status,i.responsibility,i.unit,i.area,i.category,i.description,i.priority,i.reviewed_at AS reviewedAt,i.board_actor AS boardActor,d.id AS draftId,d.created_at AS draftCreatedAt FROM intake_requests i JOIN staged_work_order_drafts d ON d.intake_request_id=i.id WHERE i.id=? LIMIT 1`).bind(m[1]).first()}catch{return reply({error:'Lookup unavailable'},503)}
  if(!r)return reply({error:'Not found'},404);
  if(r.status!=='reviewed'||r.responsibility!=='association'||!r.reviewedAt||!r.boardActor||!r.draftId)return reply({error:'Not approved for import'},409);
  return reply({ok:true,mode:'staging-read-only',source:{
    sourceId:r.sourceId,version:r.version,status:r.status,responsibility:r.responsibility,unit:r.unit,area:r.area,category:r.category,description:r.description,priority:r.priority,reviewedAt:r.reviewedAt,boardActor:r.boardActor,draftId:r.draftId,draftCreatedAt:r.draftCreatedAt
  }},200);
}
