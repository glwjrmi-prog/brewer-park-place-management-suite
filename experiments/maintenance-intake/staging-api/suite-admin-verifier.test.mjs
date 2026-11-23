import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifySuiteAdminBearer,SuiteAdminCheckError,suiteProductionAuthCheckUrl} from './suite-admin-verifier.mjs';
const bearer='synthetic-server-session-token-0123456789abcdef';
const fakeResponse=user=>({ok:true,status:200,async json(){return {user}}});
test('verifies the signed-in admin through existing Suite production /api/auth/me, not client role',async()=>{
 let calls=0;
 const r=await verifySuiteAdminBearer({bearer,fetcher:async(url,opts)=>{
  calls++;assert.equal(url,suiteProductionAuthCheckUrl);
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.authorization,'Bearer '+bearer);
  assert.equal(opts.redirect,'error');
  return fakeResponse({id:'board-admin-1',role:'admin',active:true});
 }});
 assert.deepEqual(r,{verifiedAdminId:'board-admin-1'});
 assert.equal(calls,1);
 assert.equal(JSON.stringify(r).includes(bearer),false);
});
test('regular Board user or missing explicit backend role never passes admin check',async()=>{
 for(const user of [
  {id:'user-1',role:'user',active:true},
  {id:'admin-1',role:'Admin',active:true},
  {id:'admin-1',active:true},
  {id:'admin-1',role:'admin',active:false},
  {role:'admin',active:true},null
 ]){
  await assert.rejects(()=>verifySuiteAdminBearer({bearer,fetcher:async()=>fakeResponse(user)}),e=>e instanceof SuiteAdminCheckError&&e.code==='ADMIN_REQUIRED');
 }
});
test('invalid bearer, unavailable auth, bad response and unexpected redirect fail closed',async()=>{
 await assert.rejects(()=>verifySuiteAdminBearer({bearer:'user-claims-admin',fetcher:async()=>{throw Error('must not fetch')}}),SuiteAdminCheckError);
 await assert.rejects(()=>verifySuiteAdminBearer({bearer,fetcher:async()=>{throw Error('private provider details')}}),e=>e.code==='AUTH_SERVICE_UNAVAILABLE');
 await assert.rejects(()=>verifySuiteAdminBearer({bearer,fetcher:async()=>({ok:false,status:302})}),e=>e.code==='SESSION_NOT_VERIFIED');
 await assert.rejects(()=>verifySuiteAdminBearer({bearer,fetcher:async()=>({ok:true,status:200,json:async()=>{throw Error('bad json')}})}),e=>e.code==='UNEXPECTED_AUTH_RESPONSE');
});
