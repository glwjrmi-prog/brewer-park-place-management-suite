// BPP isolated staging synthetic-test gate; not resident authentication.
// No Zero Trust billing dependency. No actual residents or production credentials.
// This module is not deployed, and never changes live Suite data.
import intakeWorker from './worker.mjs';

const deny=(status)=>new Response(JSON.stringify({error:status===503?'Private staging disabled':'Unauthorized'}),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const allowedToken=/^[a-f0-9]{64}$/;
async function hash(value){
 const bytes=new TextEncoder().encode(value);
 return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
}
async function equalToken(a,b){
 // Compare fixed-length hashes, never compare raw secret strings or log either.
 const x=await hash(a),y=await hash(b);
 let difference=0;
 for(let i=0;i<32;i++)difference|=x[i]^y[i];
 return difference===0;
}
export async function permitPrivateStaging(req,env){
 if(env?.STAGING_INTAKE_ENABLED!=='true'||env?.STAGING_PRIVATE_TEST_ENABLED!=='true')
  return {ok:false,status:503};
 const secret=env?.STAGING_TEST_SECRET;
 const supplied=req.headers.get('x-bpp-staging-gate')||'';
 if(!allowedToken.test(secret||'')||!allowedToken.test(supplied))
  return {ok:false,status:401};
 if(!await equalToken(supplied,secret))return {ok:false,status:401};
 return {ok:true};
}
export default {
 async fetch(req,env,ctx){
  // Only exact, externally supplied server-side secret header unlocks.
  // A public website must NOT embed this secret in JavaScript.
  const auth=await permitPrivateStaging(req,env);
  if(!auth.ok)return deny(auth.status);
  return intakeWorker.fetch(req,env,ctx);
 }
};
