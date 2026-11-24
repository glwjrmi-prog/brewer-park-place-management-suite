// Offline review-write candidate. Not wired into any Worker route.
// Integrate only after staging D1 clone migration and authorization tests.
import {verifyBoardPinIdentity,checkedReviewMetadata,IdentityFailure} from './verified-board-identity.mjs';

const REQUEST_ID=/^BPP-STG-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESSAGES=Object.freeze({
 association:'The board reviewed your request and identified this as an association maintenance matter. The association will determine next steps.',
 owner:'The board reviewed your request and determined that the owner is responsible for this maintenance.',
 shared_or_disputed:'The board reviewed the request. Additional coordination may be needed to determine the applicable responsibilities.',
 requires_more_information:'The board reviewed your request and needs more information before determining responsibility.'
});
export function prepareVerifiedReview({db,requestId,identity,body,now}){
 if(typeof db?.prepare!=='function'||!REQUEST_ID.test(requestId||''))throw new IdentityFailure('INVALID_REQUEST');
 if(!Number.isSafeInteger(now)||now<=0)throw new IdentityFailure('INVALID_TIME');
 const m=checkedReviewMetadata(identity,body,now);
 const note=m.notes;
 const publicMessage=MESSAGES[m.responsibility];
 const at=m.reviewedAt;
 const actor=m.boardActor;
 const details=JSON.stringify({responsibility:m.responsibility,priority:m.priority,notes:note,residentMessage:publicMessage,verifiedBoardUserId:m.verifiedBoardUserId});
 const update=db.prepare(`UPDATE intake_requests
    SET status='reviewed',responsibility=?,priority=?,review_notes=?,resident_message=?,
        board_actor=?,verified_board_user_id=?,reviewed_at=?,version=version+1
    WHERE id=? AND version=? AND status='pending_board_review'`)
  .bind(m.responsibility,m.priority,note,publicMessage,actor,m.verifiedBoardUserId,at,requestId,m.version);
 const event=db.prepare(`INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json)
    SELECT id,'board_reviewed','board',?,?,?
    FROM intake_requests
    WHERE id=? AND version=? AND status='reviewed' AND verified_board_user_id=? AND reviewed_at=?`)
  .bind(actor,at,details,requestId,m.version+1,m.verifiedBoardUserId,at);
 return Object.freeze({statements:[update,event],requestId,expectedVersion:m.version+1,verifiedBoardUserId:m.verifiedBoardUserId});
}
export async function handleVerifiedBoardReview({req,env,requestId,body,now=Date.now()}){
 // The route must not accept the old static BOARD_STAGING_TOKEN as a reviewer identity.
 const identity=await verifyBoardPinIdentity(req,env);
 if(typeof env?.INTAKE_DB?.batch!=='function')throw new IdentityFailure('DATABASE_UNAVAILABLE');
 const prepared=prepareVerifiedReview({db:env.INTAKE_DB,requestId,identity,body,now});
 const results=await env.INTAKE_DB.batch(prepared.statements);
 if(!Array.isArray(results)||results.length!==2||results.some(r=>Number(r?.meta?.changes)!==1))
   throw new IdentityFailure('VERSION_CONFLICT');
 return Object.freeze({ok:true,id:requestId,status:'reviewed',version:prepared.expectedVersion,verifiedBoardUserId:prepared.verifiedBoardUserId});
}
// No HTTP route, public CORS headers, deployment config, or executable production import here.
