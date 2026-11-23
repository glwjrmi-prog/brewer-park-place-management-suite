// Read-only live health check of isolated intake D1 Worker. No secrets or records.
const url='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev/health';
const timer=AbortSignal.timeout(12000);
try{
 const response=await fetch(url,{signal:timer,redirect:'error',headers:{accept:'application/json'}});
 const body=await response.json();
 if(response.status!==200||body?.status!=='ready'||body?.databaseConnected!==true||body?.schemaReady!==true){
  console.error('Intake staging D1 health not ready',JSON.stringify({httpStatus:response.status,status:body?.status,databaseConnected:body?.databaseConnected,schemaReady:body?.schemaReady}));
  process.exitCode=1;
 }else console.log('PASS: isolated Cloudflare intake staging D1 binding and schema verified via read-only GET /health');
}catch(e){console.error('Intake staging D1 health unavailable',e?.name||'Error');process.exitCode=1}
