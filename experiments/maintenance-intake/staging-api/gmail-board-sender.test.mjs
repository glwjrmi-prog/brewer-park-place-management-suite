import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGmailBoardSender,encodeGmailBoardAlert,gmailBoardAlertCopy,GmailDeliveryError} from './gmail-board-sender.mjs';
const valid={from:'bpp-board@example.test',to:'board-one@example.test',...gmailBoardAlertCopy};
const key='urgent:BPP-STG-12345678-1234-4234-9234-123456789abc:board-1:email';
function decode(raw){
 const fixed=raw.replace(/-/g,'+').replace(/_/g,'/');
 return new TextDecoder().decode(Uint8Array.from(atob(fixed),c=>c.charCodeAt(0)));
}
test('Gmail MIME is base64url RFC 2822 style; one recipient, no private details',()=>{
 const mime=decode(encodeGmailBoardAlert(valid));
 assert.match(mime,/^From: bpp-board@example\.test\r\nTo: board-one@example\.test\r\n/);
 assert.match(mime,/Subject: Brewer Park Place: urgent maintenance report received/);
 assert.ok(!mime.includes('resident@'));
 assert.ok(!mime.includes('Unit 12'));
 assert.ok(!mime.includes('Bcc:'));
 assert.throws(()=>encodeGmailBoardAlert({...valid,to:'board@example.test\r\nBcc: stranger@example.test'}),GmailDeliveryError);
 assert.throws(()=>encodeGmailBoardAlert({...valid,text:'Private unit number'}),GmailDeliveryError);
 assert.throws(()=>encodeGmailBoardAlert({...valid,subject:'Private narrative'}),GmailDeliveryError);
});
test('Gmail adapter only posts approved fixed alert with server-side bearer authorization',async()=>{
 let calls=0;
 const sender=createGmailBoardSender({senderEmail:valid.from,accessToken:'synthetic-server-oauth-access-token',
  fetcher:async(url,opts)=>{
   calls++;
   assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
   assert.equal(opts.method,'POST');
   assert.equal(opts.headers.authorization,'Bearer synthetic-server-oauth-access-token');
   const data=JSON.parse(opts.body);
   const message=decode(data.raw);
   assert.match(message,/To: board-one@example\.test\r\n/);
   assert.equal(message.includes('synthetic-server-oauth-access-token'),false);
   return {ok:true,status:200,async json(){return {id:'gmail-accepted-12345'}}};
  }});
 const result=await sender({to:valid.to,...gmailBoardAlertCopy,idempotencyKey:key});
 assert.deepEqual(result,{accepted:true,messageId:'gmail-accepted-12345'});
 assert.equal(calls,1);
 await assert.rejects(()=>sender({to:'other@example.test',...gmailBoardAlertCopy,idempotencyKey:'bad-key'}),GmailDeliveryError);
 assert.equal(calls,1);
});
test('Gmail errors avoid exposing private provider content and do not imply Board acknowledgment',async()=>{
 for(const status of [401,403,429,500]){
  const sender=createGmailBoardSender({senderEmail:valid.from,accessToken:'synthetic-server-oauth-access-token',
   fetcher:async()=>({ok:false,status,async json(){throw Error('private provider response')}})});
  await assert.rejects(()=>sender({to:valid.to,...gmailBoardAlertCopy,idempotencyKey:key}),GmailDeliveryError);
 }
 const network=createGmailBoardSender({senderEmail:valid.from,accessToken:'synthetic-server-oauth-access-token',fetcher:async()=>{throw new Error('private network detail')}});
 await assert.rejects(()=>network({to:valid.to,...gmailBoardAlertCopy,idempotencyKey:key}),e=>e.code==='GMAIL_NETWORK_OR_TIMEOUT');
});
