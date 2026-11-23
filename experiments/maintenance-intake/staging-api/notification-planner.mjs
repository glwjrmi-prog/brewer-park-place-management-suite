// BPP maintenance: notification planner for ISOLATED STAGING ONLY.
// Pure helper: no messaging API, no D1 writes, no real resident information.
// All active Board recipients receive an independent event; never reveal an
// entire recipient list to one Board member or to the resident.
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const intakeIdPattern=/^BPP-STG-[a-f0-9-]{36}$/;
export class NotificationPlanError extends Error {
 constructor(code){super(code);this.name='NotificationPlanError';this.code=code}
}
export function planUrgentBoardNotifications(incident,accounts){
 if(!incident||!intakeIdPattern.test(String(incident.id||''))||incident.escalation!==true)
  throw new NotificationPlanError('INVALID_URGENT_INCIDENT');
 if(!Array.isArray(accounts)||accounts.length===0||accounts.length>100)
  throw new NotificationPlanError('INVALID_BOARD_DIRECTORY');
 const active=accounts.filter(x=>x?.role==='board'&&x.active===true);
 if(!active.length)throw new NotificationPlanError('NO_ACTIVE_BOARD');
 const events=[],emails=new Set(),ids=new Set();
 for(const member of active){
  const id=String(member.id||'').trim(),email=String(member.verifiedEmail||'').trim().toLowerCase();
  if(!/^[a-zA-Z0-9_-]{1,70}$/.test(id)||!emailPattern.test(email)||email.length>254||member.emailVerified!==true)
   throw new NotificationPlanError('BOARD_RECIPIENT_NOT_VERIFIED');
  if(ids.has(id)||emails.has(email))throw new NotificationPlanError('DUPLICATE_BOARD_RECIPIENT');
  ids.add(id);emails.add(email);
  events.push(Object.freeze({
   recipientId:id,
   recipientEmail:email,
   incidentId:incident.id,
   idempotencyKey:'urgent:'+incident.id+':'+id+':email',
   subject:'Brewer Park Place: urgent maintenance report received',
   // No unit, resident narrative, account link, name, or contact number.
   message:'An urgent property concern was submitted. Sign in to the authorized Board Maintenance Center to review and acknowledge coordination.',
   state:'pending_provider_delivery'
  }));
 }
 return Object.freeze(events);
}
// Do not treat a provider "accepted" result as proof of Board acknowledgment.
export function classifyProviderResult(result){
 if(result?.accepted===true&&typeof result.messageId==='string'&&result.messageId.length>0&&result.messageId.length<=200)
  return Object.freeze({delivery:'provider_accepted',boardAcknowledged:false});
 return Object.freeze({delivery:'not_confirmed',boardAcknowledged:false});
}
