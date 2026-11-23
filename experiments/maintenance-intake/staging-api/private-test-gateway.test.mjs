import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import gateway,{permitPrivateStaging} from './private-test-gateway.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const key='3'.repeat(64);
const base=()=>({STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:key});
const request=(gate,role)=>new Request('https://staging.example/health',{
 headers:{...(gate===undefined?{}:{'x-bpp-staging-gate':gate}),...(role?{authorization:'Bearer '+role}:{})}
});
test('staging private harness is disabled by default',async()=>{
 for(const env of [{},{...base(),STAGING_PRIVATE_TEST_ENABLED:'false'},{...base(),STAGING_INTAKE_ENABLED:'false'}]){
  const result=await permitPrivateStaging(request(key),env);
  assert.deepEqual(result,{ok:false,status:503});
  const response=await gateway.fetch(request(key),env);
  assert.equal(response.status,503);
 }
});
test('secret gate is required even for the generic health endpoint',async()=>{
 const env=base();
 assert.equal((await gateway.fetch(request(),env)).status,401);
 assert.equal((await gateway.fetch(request('4'.repeat(64)),env)).status,401);
 assert.equal((await gateway.fetch(request('wrong'),env)).status,401);
 assert.equal((await gateway.fetch(request(key),{...env,STAGING_TEST_SECRET:'short'})).status,401);
 const response=await gateway.fetch(request(key),env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).service,'bpp-maintenance-intake-isolated-staging');
});
test('separate staging gate does not treat a board bearer token as the gate secret',async()=>{
 const env=base();
 const withRoleOnly=request(undefined,'board-test-secret');
 assert.equal((await gateway.fetch(withRoleOnly,env)).status,401);
 const permitted=request(key,'board-test-secret');
 assert.deepEqual(await permitPrivateStaging(permitted,env),{ok:true});
});
test('missing secret never falls through to intake database operations',async()=>{
 let called=0;
 const env={...base(),INTAKE_DB:{prepare(){called++;throw Error('Should not query')}}};
 const r=await gateway.fetch(new Request('https://staging.example/api/requests',{headers:{authorization:'Bearer board-test-secret'}}),env);
 assert.equal(r.status,401);
 assert.equal(called,0);
});
