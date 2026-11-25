// BPP maintenance-intake staging: read-only D1 connectivity check.
// SAFE TO DEPLOY ONLY WITH THE NEW ISOLATED INTAKE_DB binding.
// This Worker DOES NOT accept resident requests, authenticate users, send mail,
// access Management Suite data, or alter database tables or rows.
const requiredTables=[
 'intake_requests','intake_events','intake_resident_updates',
 'intake_policy_advice','urgent_alert_outbox','staged_work_order_drafts',
 'resident_email_challenges','resident_email_sessions'
];
const respond=(status,body)=>new Response(JSON.stringify(body),{
 status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'access-control-allow-origin':'none'
 }
});
export default {
 async fetch(request,env){
  if(new URL(request.url).pathname!=='/health'||request.method!=='GET')
   return respond(404,{status:'not_found'});
  if(!env?.INTAKE_DB||typeof env.INTAKE_DB.prepare!=='function')
   return respond(503,{status:'not_ready',databaseConnected:false,schemaReady:false});
  try{
   // Reads only SQLite metadata (no resident records, email addresses or tokens).
   const meta=await env.INTAKE_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
   ).all();
   const names=new Set((meta.results||[]).map(x=>x.name));
   const tablesReady=requiredTables.every(x=>names.has(x));
   if(!tablesReady)return respond(503,{status:'not_ready',databaseConnected:true,schemaReady:false});
   const columns=await env.INTAKE_DB.prepare("PRAGMA table_info('intake_requests')").all();
   const fields=new Set((columns.results||[]).map(x=>x.name));
   const schemaReady=['submitter_email','version','resident_message'].every(x=>fields.has(x));
   return respond(schemaReady?200:503,{
    status:schemaReady?'ready':'not_ready',databaseConnected:true,schemaReady
   });
  }catch{
   return respond(503,{status:'not_ready',databaseConnected:false,schemaReady:false});
  }
 }
};
