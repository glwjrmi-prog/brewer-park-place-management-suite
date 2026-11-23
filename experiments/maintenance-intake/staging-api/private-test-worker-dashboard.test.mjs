import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import packaged from './private-test-worker-dashboard.mjs';
import modular from './private-test-gateway.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='d'.repeat(64);
const request=()=>new Request('https://private.example/health',{headers:{'x-bpp-staging-gate':secret}});
test('packaged and modular private staging gates agree on disabled and enabled behavior',async()=>{
 for(const [label,env]of [
  ['off',{}],
  ['missing private flag',{STAGING_INTAKE_ENABLED:'true',STAGING_TEST_SECRET:secret}],
  ['wrong secret',{STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:'a'.repeat(64)}],
  ['correct secret',{STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:secret}]
 ]){
  const [a,b]=await Promise.all([packaged.fetch(request(),env),modular.fetch(request(),env)]);
  assert.equal(a.status,b.status,label);
  assert.deepEqual(await a.json(),await b.json(),label);
 }
});
test('packaged private staging refuses any request without a server-side gate secret',async()=>{
 const env={STAGING_INTAKE_ENABLED:'true',STAGING_PRIVATE_TEST_ENABLED:'true',STAGING_TEST_SECRET:secret};
 const r=await packaged.fetch(new Request('https://private.example/api/requests',{headers:{authorization:'Bearer board-test-secret'}}),env);
 assert.equal(r.status,401);
});
