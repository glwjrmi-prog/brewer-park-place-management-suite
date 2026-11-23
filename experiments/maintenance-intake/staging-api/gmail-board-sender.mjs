// BPP MAINTENANCE — Gmail API delivery adapter for ISOLATED STAGING.
// This is a callable adapter, NOT wired into a live Worker. It cannot obtain
// authorization by itself. Only server-side credentials for a designated BPP
// sender may be used, with the minimal gmail.send OAuth scope.
// Never expose tokens, raw MIME, or recipient directory in browser responses.
const emailRe=/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const SAFE_SUBJECT='Brewer Park Place: urgent maintenance report received';
const SAFE_BODY='An urgent property concern was submitted. Sign in to the authorized Board Maintenance Center to review and acknowledge coordination.';
export class GmailDeliveryError extends Error{
 constructor(code){super(code);this.name='GmailDeliveryError';this.code=code}
}
function address(value){
 if(typeof value!=='string'||value.length>254||!emailRe.test(value))throw new GmailDeliveryError('INVALID_ADDRESS');
 return value.toLowerCase();
}
function b64url(bytes){
 // Works in Workers and Node's web-compatible runtime; do not depend on Buffer.
 let binary='';const u8=new Uint8Array(bytes);
 for(let i=0;i<u8.length;i+=0x8000)binary+=String.fromCharCode(...u8.subarray(i,i+0x8000));
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function encodeGmailBoardAlert({from,to,subject,text}){
 const sender=address(from),recipient=address(to);
 // Fixed copy prevents injection from residents or untrusted Board members.
 if(subject!==SAFE_SUBJECT||text!==SAFE_BODY)throw new GmailDeliveryError('UNAPPROVED_MESSAGE');
 const mime='From: '+sender+'\r\nTo: '+recipient+'\r\nSubject: '+subject+
  '\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'+text+'\r\n';
 return b64url(new TextEncoder().encode(mime));
}
export function createGmailBoardSender({senderEmail,accessToken,fetcher=fetch}){
 const from=address(senderEmail);
 if(typeof accessToken!=='string'||accessToken.length<10)throw new GmailDeliveryError('GMAIL_AUTH_UNAVAILABLE');
 if(typeof fetcher!=='function')throw new GmailDeliveryError('GMAIL_FETCH_UNAVAILABLE');
 return async function sendMail({to,subject,text,idempotencyKey}){
  if(typeof idempotencyKey!=='string'||!/^urgent:BPP-STG-[a-f0-9-]{36}:[a-zA-Z0-9_-]{1,70}:email$/.test(idempotencyKey))
   throw new GmailDeliveryError('INVALID_DISPATCH_KEY');
  const raw=encodeGmailBoardAlert({from,to,subject,text});
  // Gmail API does not promise deduplication by caller key. Dispatch only via
  // the single-claim isolated D1 outbox; never blindly replay on uncertainty.
  let response;
  try{
   response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST',
    headers:{authorization:'Bearer '+accessToken,'content-type':'application/json; charset=utf-8'},
    body:JSON.stringify({raw}),
    signal:AbortSignal.timeout(15000)
   });
  }catch{throw new GmailDeliveryError('GMAIL_NETWORK_OR_TIMEOUT')}
  if(!response?.ok){
   if(response?.status===401||response?.status===403)throw new GmailDeliveryError('GMAIL_AUTH_OR_PERMISSION');
   if(response?.status===429)throw new GmailDeliveryError('GMAIL_RATE_LIMIT');
   throw new GmailDeliveryError('GMAIL_PROVIDER_REJECTED');
  }
  let payload;
  try{payload=await response.json()}catch{throw new GmailDeliveryError('GMAIL_BAD_RESPONSE')}
  if(typeof payload?.id!=='string'||!/^[-_a-zA-Z0-9]{4,200}$/.test(payload.id))
   throw new GmailDeliveryError('GMAIL_BAD_RESPONSE');
  return {accepted:true,messageId:payload.id};
 };
}
export const gmailBoardAlertCopy=Object.freeze({subject:SAFE_SUBJECT,text:SAFE_BODY});
