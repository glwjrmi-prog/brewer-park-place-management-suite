import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync('production-prep/WORKER_PEPPER_EXPERIMENT.js','utf8');
const bridge=readFileSync('production-prep/PIN_BRIDGE_CANDIDATE.js','utf8');

test('administrator UI never creates legacy weak PIN hashes',()=>{
  const start=bridge.indexOf('accessShowUserForm=function(){');
  const reset=bridge.indexOf('accessShowResetPin=function(id){');
  const activity=bridge.indexOf('const originalShowAccount=accessShowAccount;');
  assert.ok(start>0 && reset>start && activity>reset,
    'PIN account UI patches must install after verified session startup');
  const accountForms=bridge.slice(start,activity);
  assert.match(accountForms,/\/api\/admin\/user-create/);
  assert.match(accountForms,/\/api\/admin\/pin-reset/);
  assert.doesNotMatch(accountForms,/accessHashPin|pinHash\s*=|\.salt\s*=/,
    'Account forms must never create fast PIN hashes');
  assert.match(accountForms,/first\.value=''|first\.value='';second\.value=''/);
  assert.match(bridge,/BPPMS_V9_PRODUCTION_PIN_USER_SESSION/);
});

test('server requires verified roles and separate system-owner entitlement',()=>{
  assert.match(worker,/principal\.role !== 'admin'/);
  assert.match(worker,/principal\.id !== env\.SYSTEM_ADMIN_USER_ID/);
  assert.match(worker,/Create new accounts through protected enrollment/);
  assert.match(worker,/function stampVerifiedRecordActors/);
  assert.match(worker,/activityRecordChanges\(currentData,stamped\)/);
  assert.match(worker,/source_pin_hash=''/);
  assert.match(worker,/LEGACY_ADMIN_ROLLBACK === 'enabled'/);
});
