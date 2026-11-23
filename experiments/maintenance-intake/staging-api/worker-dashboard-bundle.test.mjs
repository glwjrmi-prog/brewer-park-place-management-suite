import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bundle from './worker-dashboard-bundle.mjs';
import modular from './worker.mjs';

const request=()=>new Request('https://private-staging.example/health',{method:'GET'});
test('dashboard bundle imports cleanly and refuses traffic when disabled',async()=>{
 const env={};
 const response=await bundle.fetch(request(),env);
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'Maintenance intake staging disabled');
});
test('bundle has identical inactive and health behavior to modular worker',async()=>{
 for(const enabled of [undefined,'false','true']){
  const env={STAGING_INTAKE_ENABLED:enabled};
  const one=await bundle.fetch(request(),env);
  const two=await modular.fetch(request(),env);
  assert.equal(one.status,two.status);
  assert.deepEqual(await one.json(),await two.json());
 }
});
test('single-file dashboard bundle contains no local imports and no stored credentials',()=>{
 const text=readFileSync(new URL('./worker-dashboard-bundle.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(text,/^import\s/m);
 assert.doesNotMatch(text,/secret-[a-z0-9]{20}/i);
 assert.match(text,/STAGING_INTAKE_ENABLED/);
});
