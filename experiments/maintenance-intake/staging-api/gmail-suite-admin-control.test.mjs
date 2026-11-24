import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url);
const index=readFileSync(new URL('index.html',root),'utf8');
const bridge=readFileSync(new URL('production-prep/PIN_BRIDGE_CANDIDATE.js',root),'utf8');
const launcher=readFileSync(new URL('experiments/maintenance-intake/staging-api/gmail-suite-launcher.js',root),'utf8');
const control=readFileSync(new URL('experiments/maintenance-intake/staging-api/gmail-suite-admin-control.js',root),'utf8');
test('Gmail helper loads before asynchronous PIN boot and is not auto-opened',()=>{
 const idx=index.indexOf("'<script>'+gmailLaunch");
 assert.ok(idx>0);
 assert.ok(index.indexOf("gmailControl",idx)>idx);
 assert.ok(index.indexOf("bridge",idx)>idx);
 assert.ok(!index.includes('bppLaunchGmailSetup()'));
 assert.match(launcher,/button|window\.bppLaunchGmailSetup=launch/);
});
test('install gated on verified PIN plus authoritative membership',()=>{
 const userValidated=bridge.indexOf('const confirmedUser=await verifySession');
 const membershipValidated=bridge.indexOf('Verified PIN account missing in authoritative state');
 const install=bridge.indexOf('window.bppInstallGmailAdminSetupControl?.(');
 assert.ok(userValidated>=0&&membershipValidated>userValidated&&install>membershipValidated);
 assert.match(bridge,/currentUser\.role==='admin' && currentUser\.active!==false/);
 assert.match(control,/if\(verifiedAdmin!==true/);
 assert.match(control,/addEventListener\('click'/);
 assert.match(control,/window\.bppLaunchGmailSetup\(\)/);
});
test('setup launcher checks backend and fixed origins without publishing secrets',()=>{
 assert.match(launcher,/\/api\/auth\/me/);
 assert.match(launcher,/data\?\.user\?\.role!=='admin'/);
 assert.match(launcher,/event\.origin!==staging/);
 assert.match(launcher,/popup\.postMessage\(/);
 assert.ok(!launcher.includes('GMAIL_CLIENT_SECRET'));
 assert.ok(!control.includes('GMAIL_VAULT_KEY'));
});
