// BPP staging: ONLY read-only schema check, now requiring verified Cloudflare Access.
// Do not deploy before Access policy is configured for this ONE staging Worker.
// No credentials, resident rows, or Management Suite records are read or written.
const required=['intake_requests','intake_events','intake_resident_updates','intake_policy_advice','urgent_alert_outbox','staged_work_order_drafts','resident_email_challenges','resident_email_sessions'];
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export default {
 async fetch(request,env,ctx){
  if(request.method!=='GET'||new URL(request.url).pathname!=='/health')return reply(404,{status:'not_found'});
  // Verified Cloudflare Access identity is supplied by Cloudflare, not the browser.
  if(!ctx?.access||typeof ctx.access.getIdentity!=='function')return reply(403,{status:'access_required'});
  let identity;
  try{identity=await ctx.access.getIdentity()}catch{return reply(403,{status:'access_required'})}
  const email=typeof identity?.email==='string'?identity.email.toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(403,{status:'access_required'});
  if(!env?.INTAKE_DB||typeof env.INTAKE_DB.prepare!=='function')return reply(503,{status:'not_ready',schemaReady:false});
  try{
   const rows=await env.INTAKE_DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
   const available=new Set((rows.results||[]).map(x=>x.name));
   if(!required.every(x=>available.has(x)))return reply(503,{status:'not_ready',schemaReady:false});
   const fields=await env.INTAKE_DB.prepare("PRAGMA table_info('intake_requests')").all();
   const names=new Set((fields.results||[]).map(x=>x.name));
   const schemaReady=['submitter_email','version','resident_message'].every(x=>names.has(x));
   return reply(schemaReady?200:503,{status:schemaReady?'ready':'not_ready',schemaReady});
  }catch{return reply(503,{status:'not_ready',schemaReady:false})}
 }
};
