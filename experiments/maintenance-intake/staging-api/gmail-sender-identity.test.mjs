import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyGoogleBoardIdentity,GmailSenderIdentityError,EXPECTED_BOARD_SENDER} from './gmail-sender-identity.mjs';
const clientId='123456789-synthetic.apps.googleusercontent.com';
const nonce='base64url-opaque-nonce-12345678901234567890123';
function identity(extra={}){return {iss:'https://accounts.google.com',aud:clientId,email:'BOARD@BPPcondos.org',
 email_verified:true,hd:'bppcondos.org',nonce,exp:Math.floor(Date.now()/1000)+3600,...extra}}
const mock=x=>async(_url,opts)=>{assert.equal(opts.method,'POST');assert.ok(opts.body.get('id_token'));return {ok:true,async json(){return x}}};
const args={idToken:'synthetic-id-token-value-for-unit-test-1234',clientId,nonce};
test('the Google-verified Workspace account must be exactly the Board sender',async()=>{
 const out=await verifyGoogleBoardIdentity({...args,fetcher:mock(identity())});
 assert.deepEqual(out,{verified:true,email:EXPECTED_BOARD_SENDER});
});
test('rejects Google sign-ins from another BPP account, a consumer Gmail, wrong OAuth client or attacker nonce',async()=>{
 const invalid=[
  {email:'building@bppcondos.org'},
  {email:'board@gmail.com',hd:null},
  {hd:'otherdomain.org'},
  {aud:'attacker-client.apps.googleusercontent.com'},
  {nonce:'attacker-nonce'},
  {email_verified:false},
  {iss:'https://attacker.example'},
  {exp:Math.floor(Date.now()/1000)-100}
 ];
 for(const changes of invalid){
  await assert.rejects(()=>verifyGoogleBoardIdentity({...args,fetcher:mock(identity(changes))}),GmailSenderIdentityError);
 }
});
test('provider error or unavailable credential verification fails closed without revealing token',async()=>{
 const error=async()=>{throw Error('internal provider details')};
 await assert.rejects(()=>verifyGoogleBoardIdentity({...args,fetcher:error}),e=>e.code==='IDENTITY_VERIFIER_UNAVAILABLE');
 await assert.rejects(()=>verifyGoogleBoardIdentity({...args,fetcher:async()=>({ok:false})}),GmailSenderIdentityError);
});
