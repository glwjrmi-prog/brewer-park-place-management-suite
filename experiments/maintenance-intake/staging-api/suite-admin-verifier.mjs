// BPP isolated Gmail setup: server-side bridge to the ALREADY-DEPLOYED
// Management Suite production PIN authentication service. Not mounted.
// This module ONLY checks /api/auth/me; it never reads or writes Suite data.
// The PIN session is supplied by the actual logged-in Suite browser, NOT by
// user-entered PIN or a self-asserted role. Never log or store that bearer.
// The real provider response format/role must be verified before deployment.
const ME_URL='https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me';
const SESSION_RE=/^[a-zA-Z0-9._~-]{32,512}$/;
export class SuiteAdminCheckError extends Error{
 constructor(code){super(code);this.name='SuiteAdminCheckError';this.code=code}
}
export async function verifySuiteAdminBearer({bearer,fetcher=fetch}){
 if(typeof bearer!=='string'||!SESSION_RE.test(bearer)||typeof fetcher!=='function')
  throw new SuiteAdminCheckError('INVALID_SESSION');
 let response;
 try{
  response=await fetcher(ME_URL,{
   method:'GET',
   headers:{authorization:'Bearer '+bearer,accept:'application/json'},
   redirect:'error',
   signal:AbortSignal.timeout(8000)
  });
 }catch{throw new SuiteAdminCheckError('AUTH_SERVICE_UNAVAILABLE')}
 if(!response||response.ok!==true||response.status!==200)
  throw new SuiteAdminCheckError('SESSION_NOT_VERIFIED');
 let data;
 try{data=await response.json()}catch{throw new SuiteAdminCheckError('UNEXPECTED_AUTH_RESPONSE')}
 const user=data?.user;
 // Never authorize based on a browser-supplied role or name. The
 // backend response MUST confirm an active administrator explicitly.
 if(typeof user?.id!=='string'||!/^[a-zA-Z0-9._~-]{1,128}$/.test(user.id)||
  user?.role!=='admin'||user?.active===false)
  throw new SuiteAdminCheckError('ADMIN_REQUIRED');
 return Object.freeze({verifiedAdminId:user.id});
}
export const suiteProductionAuthCheckUrl=ME_URL;
