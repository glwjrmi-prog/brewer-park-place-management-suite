import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bridge=readFileSync('production-prep/ISOLATED_SECURE_ENROLLMENT_BRIDGE.js','utf8');
const loader=readFileSync('production-prep/ISOLATED_SECURE_ENROLLMENT_LOADER.html','utf8');
const prod=readFileSync('production-prep/PIN_BRIDGE_CANDIDATE.js','utf8');

test('isolation is explicit and bound to test Worker only',()=>{
 assert.match(bridge,/location\.origin !== 'https:\/\/bpp-pin-integration-test-api\.glwjrmi\.workers\.dev'/);
 assert.match(bridge,/location\.pathname !== '\/test-suite'/);
 assert.doesNotMatch(bridge,/const V9_API='https:\/\/bpp-management-suite-production-api/);
 assert.match(loader,/ISOLATED TEST — NO LIVE BPP RECORDS/);
 assert.match(loader,/ISOLATED_SECURE_ENROLLMENT_BRIDGE\.js/);
});
test('full suite gets verified account entitlement before showing private log',()=>{
 for(const code of [bridge,prod]){
  assert.match(code,/currentUser=confirmedUser/);
  assert.match(code,/canViewActivity!==true/);
  assert.match(code,/\/api\/admin\/activity\?limit=50/);
  assert.match(code,/\/api\/admin\/user-create/);
  assert.match(code,/\/api\/admin\/pin-reset/);
  assert.match(code,/\['Date','User','Action','Record','Changes'\]/);
  assert.match(code,/toLocaleString\('en-US'/);
  assert.match(code,/cell\.textContent=String\(value\)/);
  assert.doesNotMatch(code.slice(code.indexOf('const originalShowAccount='),code.indexOf('// The Worker has already verified')), /JSON\.stringify\(event\.details\|\|\{\}\)/, 'Private log should not expose raw JSON in its UI');
  assert.doesNotMatch(code.slice(code.indexOf('accessShowUserForm=function'),code.indexOf('const originalShowAccount')),
   /accessHashPin\(|pinHash\s*=|\.salt\s*=/);
 }
});

test('production release candidate uses the secure bridge, not the old shared-token client',()=>{
 const launcher=readFileSync('production-prep/PRODUCTION_PIN_LAUNCHER_CANDIDATE.html','utf8');
 assert.match(launcher,/\.\/production-prep\/PIN_BRIDGE_CANDIDATE\.js/);
 assert.doesNotMatch(launcher,/fetch\('\.\/d1-authoritative-bridge\.js'/);
 assert.match(launcher,/PRODUCTION RELEASE CANDIDATE/);
 assert.match(prod,/https:\/\/bpp-management-suite-production-api\.glwjrmi\.workers\.dev/);
});
