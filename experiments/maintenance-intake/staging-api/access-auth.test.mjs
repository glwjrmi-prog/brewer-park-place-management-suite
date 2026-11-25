import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyCloudflareAccessIdentity,authorizeStagingBoard,AccessDenied} from './access-auth.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const domain='bpp-staging.cloudflareaccess.com',origin='https://'+domain,audience='synthetic-aud-id',nowSec=1890000000;
const b64url=bytes=>Buffer.from(bytes).toString('base64url');
const encode=o=>b64url(Buffer.from(JSON.stringify(o)));
async function fixture(){
 const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const publicJwk={...await crypto.subtle.exportKey('jwk',keyPair.publicKey),kid:'test-rsa-1',use:'sig',alg:'RS256'};
 const fetcher=async(url)=>{
  assert.equal(url,origin+'/cdn-cgi/access/certs');
  return {ok:true,json:async()=>({keys:[publicJwk]})};
 };
 const mint=async(mods={})=>{
  const header={alg:'RS256',kid:'test-rsa-1',...mods.header};
  const payload={iss:origin,aud:[audience],nbf:nowSec-30,exp:nowSec+3600,email:'BoardMember@example.com',sub:'synthetic-subject',...mods.payload};
  const signed=encode(header)+'.'+encode(payload);
  const bytes=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,new TextEncoder().encode(signed));
  return signed+'.'+b64url(bytes);
 };
 return {fetcher,mint};
}
test('only valid signed Access JWT can produce verified staging identity and board authorization',async()=>{
 const {fetcher,mint}=await fixture();
 const jwt=await mint();
 const principal=await verifyCloudflareAccessIdentity(jwt,{teamDomain:domain,audience,fetcher,nowSec});
 assert.equal(principal.email,'boardmember@example.com');
 assert.equal(principal.subject,'synthetic-subject');
 const board=authorizeStagingBoard(principal,['boardmember@example.com']);
 assert.equal(board.role,'board');
 assert.ok(Object.isFrozen(board));
 assert.throws(()=>authorizeStagingBoard(principal,['someoneelse@example.com']),AccessDenied);
 assert.throws(()=>authorizeStagingBoard(principal,[]),AccessDenied);
});
test('reject unsigned, tampered, unexpected issuer/audience, expired, future and forged algorithm',async()=>{
 const {fetcher,mint}=await fixture();
 const base={teamDomain:domain,audience,fetcher,nowSec};
 for(const token of [
  await mint({payload:{iss:'https://attacker.cloudflareaccess.com'}}),
  await mint({payload:{aud:['other-aud']}}),
  await mint({payload:{exp:nowSec}}),
  await mint({payload:{nbf:nowSec+300}}),
  await mint({payload:{email:'not-an-email'}}),
  await mint({header:{alg:'none'}})
 ])await assert.rejects(()=>verifyCloudflareAccessIdentity(token,base),AccessDenied);
 const token=await mint();
 const pieces=token.split('.');
 const tampered=pieces[0]+'.'+encode({iss:origin,aud:[audience],nbf:nowSec-30,exp:nowSec+3600,email:'Attacker@example.com'})+'.'+pieces[2];
 await assert.rejects(()=>verifyCloudflareAccessIdentity(tampered,base),AccessDenied);
 await assert.rejects(()=>verifyCloudflareAccessIdentity(token,{...base,teamDomain:'attacker.invalid'}),AccessDenied);
 await assert.rejects(()=>verifyCloudflareAccessIdentity(token,{...base,fetcher:async()=>({ok:false})}),AccessDenied);
 await assert.rejects(()=>verifyCloudflareAccessIdentity('',base),AccessDenied);
});
