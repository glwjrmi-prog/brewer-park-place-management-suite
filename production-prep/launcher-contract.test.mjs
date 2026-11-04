import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(p,'utf8');
const main=read('index.html');
const bridge=read('production-prep/PIN_BRIDGE_CANDIDATE.js');
const worker=read('production-prep/WORKER_AUTH_CANDIDATE.js');
test('preparation branch does not change the live launcher or inject PIN candidate automatically',()=>{
  assert.match(main,/fetch\('\.\/d1-authoritative-bridge\.js'/);
  assert.doesNotMatch(main,/PIN_BRIDGE_CANDIDATE/);
  assert.match(main,/\.\/grounds-site-projects\.js/);
  assert.match(main,/\.\/d1-drive-picker-patch\.js/);
  assert.match(main,/\.\/d1-audit-provenance-patch\.js/);
});
test('PIN candidate uses only named production backend, fails closed off official GitHub Pages host',()=>{
  assert.match(bridge,/https:\/\/bpp-management-suite-production-api\.glwjrmi\.workers\.dev/);
  assert.doesNotMatch(bridge,/bpp-management-suite-staging-api/);
  assert.match(bridge,/location\.origin !== 'https:\/\/glwjrmi-prog\.github\.io'/);
  assert.match(bridge,/pathname\.startsWith\('\/brewer-park-place-management-suite\/'\)/);
  assert.match(bridge,/BPPMS_V9_PRODUCTION_PIN_USER_SESSION/);
  assert.doesNotMatch(bridge,/BPPMS_V9_STAGING_USER_SESSION/);
  assert.doesNotMatch(bridge,/BPP Staging Sign In/);
});
test('candidate Worker requires exact production CORS and protects every production data module',()=>{
  assert.doesNotMatch(worker,/bpp-management-suite-staging\\\.pages\\\.dev/);
  assert.match(worker,/configuredOrigins\(env\)\.includes\(origin\)/);
  for(const key of ['maintenance','projects','vendors','violations','inspections','groundsProjects','knowledgeBase']) {
    assert.match(worker,new RegExp('"'+key+'"'));
  }
  assert.match(worker,/missingTopLevel/);
  assert.match(worker,/accountFingerprint/);
  assert.match(worker,/pin_sessions_v2/);
});
