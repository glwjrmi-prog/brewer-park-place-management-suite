// OFFLINE CANDIDATE — no route deployment or D1 writes.
const TOKEN=/^[a-zA-Z0-9._~-]{32,512}$/;
const USERID=/^usr-[a-zA-Z0-9._~-]{8,128}$/;
export class IdentityFailure extends Error {constructor(code){super(code);this.code=code}}
export async function verifyBoardPinIdentity(req,env){
 if(typeof env?.BPP_SUITE_AUTH?.fetch!=='function')throw new IdentityFailure('AUTH_SERVICE_UNAVAILABLE');
 const token=req.headers.get('x-bpp-board-pin-session');
 if(!TOKEN.test(token||''))throw new IdentityFailure('SESSION_REQUIRED');
 let u;try{u=new URL(env.BPP_SUITE_AUTH_ME_URL)}catch{throw new IdentityFailure('AUTH_CONFIGURATION')}
 if(u.href!=='https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me')throw new IdentityFailure('AUTH_CONFIGURATION');
 let res;try{res=await env.BPP_SUITE_AUTH.fetch(new Request(u.href,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)}))}catch{throw new IdentityFailure('AUTH_SERVICE_UNAVAILABLE')}
 if(res.status!==200||!res.ok)throw new IdentityFailure('NOT_AUTHORIZED');
 let data;try{data=await res.json()}catch{throw new IdentityFailure('INVALID_AUTH_RESPONSE')}
 const p=data?.user;
 if(data?.ok!==true||p?.role!=='admin'||!USERID.test(p?.id||'')||typeof p?.name!=='string'||p.name.trim().length<2||p.name.length>120)throw new IdentityFailure('NOT_AUTHORIZED');
 return Object.freeze({userId:p.id,name:p.name.trim(),role:'admin'});
}
export function checkedReviewMetadata(identity,body,now){
 if(identity?.role!=='admin'||!USERID.test(identity?.userId||''))throw new IdentityFailure('NOT_AUTHORIZED');
 if(!Number.isSafeInteger(body?.version)||!['association','owner','shared_or_disputed','requires_more_information'].includes(body?.responsibility)||!['routine','high','emergency'].includes(body?.priority)||typeof body?.notes!=='string'||!body.notes.trim()||body.notes.length>2000)throw new IdentityFailure('INVALID_REVIEW');
 return Object.freeze({version:body.version,responsibility:body.responsibility,priority:body.priority,notes:body.notes.trim(),boardActor:identity.name,verifiedBoardUserId:identity.userId,reviewedAt:new Date(now).toISOString()});
}
export function eligibleForTrustedImport(r){
 return !!(r&&r.status==='reviewed'&&r.responsibility==='association'&&USERID.test(r.verified_board_user_id||'')&&typeof r.board_actor==='string'&&r.board_actor.trim()&&r.reviewed_at&&r.draftId);
}