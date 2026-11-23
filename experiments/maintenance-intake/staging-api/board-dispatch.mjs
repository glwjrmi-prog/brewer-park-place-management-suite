// BPP MAINTENANCE: ISOLATED BOARD NOTIFICATION DISPATCH ADAPTER.
// The adapter has NO actual mail provider connection and is never enabled
// against the live Worker or Management Suite DB. Board-only access is required
// around any future invocation. No unit/resident narrative is emailed.
import {planUrgentBoardNotifications,classifyProviderResult} from './notification-planner.mjs';
const MAX_ATTEMPTS=4;
const claimId=()=>crypto.randomUUID();
function safeClock(now){if(!Number.isSafeInteger(now)||now<0)throw new Error('Invalid time');return now;}
export async function stageBoardNotifications({db,incident,boardDirectory,now=Date.now()}){
 safeClock(now);
 if(!db?.prepare||!db?.batch)throw new Error('Isolated D1 unavailable');
 const events=planUrgentBoardNotifications(incident,boardDirectory);
 const row=await db.prepare('SELECT escalation FROM intake_requests WHERE id=?').bind(incident.id).first();
 if(!row||row.escalation!==1)throw new Error('Verified urgent intake missing');
 const batch=events.map(e=>db.prepare(
  "INSERT INTO board_notification_dispatch(incident_id,recipient_id,idempotency_key,status,next_attempt_at,created_at,updated_at) "+
  "VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(incident_id,recipient_id) DO NOTHING"
 ).bind(e.incidentId,e.recipientId,e.idempotencyKey,now,now,now));
 await db.batch(batch);
 return {ok:true,recipientCount:events.length,mode:'staging_only'};
}
// A single notification is independently claimed using a compare-and-swap.
// Stale claims are NOT automatically retried: this avoids accidental duplicate
// mail in the absence of an external idempotency contract.
export async function dispatchOneBoardNotification({db,incidentId,recipientId,boardDirectory,sendMail,now=Date.now()}){
 safeClock(now);
 if(typeof sendMail!=='function'||!db?.prepare)throw new Error('Mail adapter missing');
 const plan=planUrgentBoardNotifications({id:incidentId,escalation:true},boardDirectory);
 const event=plan.find(e=>e.recipientId===recipientId);
 if(!event)throw new Error('Recipient not actively Board verified');
 const claim=claimId();
 const result=await db.prepare(
  "UPDATE board_notification_dispatch SET status='claimed',claim_token=?,claimed_at=?,attempts=attempts+1,updated_at=? "+
  "WHERE incident_id=? AND recipient_id=? AND idempotency_key=? AND status IN ('pending','retry') AND "+
  'next_attempt_at<=? AND attempts<?'
 ).bind(claim,now,now,incidentId,recipientId,event.idempotencyKey,now,MAX_ATTEMPTS).run();
 if(Number(result?.meta?.changes||0)!==1)return {state:'not_claimed',providerAccepted:false,boardAcknowledged:false};
 // Only this claimant may update delivery status. Never persist provider API tokens.
 try{
  const provider=await sendMail({
   to:event.recipientEmail,subject:event.subject,text:event.message,
   idempotencyKey:event.idempotencyKey
  });
  const status=classifyProviderResult(provider);
  if(status.delivery==='provider_accepted'){
   await db.prepare(
    "UPDATE board_notification_dispatch SET status='accepted',provider_message_id=?,claim_token=NULL,updated_at=? "+
    "WHERE incident_id=? AND recipient_id=? AND status='claimed' AND claim_token=?"
   ).bind(provider.messageId,now,incidentId,recipientId,claim).run();
   return {state:'provider_accepted',providerAccepted:true,boardAcknowledged:false};
  }
  // Ambiguous delivery MUST NOT be automatically retried without provider
  // idempotency: operator review required before requeue.
  await db.prepare(
   "UPDATE board_notification_dispatch SET status='permanent_failure',last_error_code='PROVIDER_UNCONFIRMED',claim_token=NULL,updated_at=? "+
   "WHERE incident_id=? AND recipient_id=? AND status='claimed' AND claim_token=?"
  ).bind(now,incidentId,recipientId,claim).run();
  return {state:'provider_unconfirmed',providerAccepted:false,boardAcknowledged:false};
 }catch{
  await db.prepare(
   "UPDATE board_notification_dispatch SET status='permanent_failure',last_error_code='PROVIDER_EXCEPTION',claim_token=NULL,updated_at=? "+
   "WHERE incident_id=? AND recipient_id=? AND status='claimed' AND claim_token=?"
  ).bind(now,incidentId,recipientId,claim).run();
  return {state:'provider_unconfirmed',providerAccepted:false,boardAcknowledged:false};
 }
}
