import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './gmail-setup-worker.mjs';
const origin='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
const req=(path,method='GET')=>new Request(origin+path,{method});
test('every resident route stays disabled and unexposed even when Gmail setup flag is active',async()=>{
 for(const env of [
  {STAGING_INTAKE_ENABLED:'false'},
  {STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'true'},
  {STAGING_INTAKE_ENABLED:'true',STAGING_GMAIL_OAUTH_ENABLED:'true'}
 ]){
  const res=await worker.fetch(req('/api/my-requests'),env);
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'Private staging disabled');
  assert.equal((await worker.fetch(req('/'),env)).status,503);
 }
});
test('OAuth callback and setup UI unavailable while Gmail consent flag is absent',async()=>{
 const env={STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'false'};
 for(const url of ['/oauth/gmail/setup','/oauth/gmail/session','/oauth/gmail/start','/oauth/gmail/callback']){
  assert.equal((await worker.fetch(req(url),env)).status,503);
 }
});
test('Gmail setup page is separate with no secrets, and refuses to activate resident routes',async()=>{
 const env={STAGING_INTAKE_ENABLED:'false',STAGING_GMAIL_OAUTH_ENABLED:'true',STAGING_ADMIN_ORIGIN:origin};
 const page=await worker.fetch(req('/oauth/gmail/setup'),env);
 assert.equal(page.status,200);
 const html=await page.text();
 assert.match(html,/Board maintenance notifications/);
 assert.equal(html.includes('GMAIL_CLIENT_SECRET'),false);
 assert.equal(page.headers.get('content-security-policy').includes('script-src'),true);
 const script=await worker.fetch(req('/oauth/gmail/setup.js'),env);
 const js=await script.text();
 assert.match(js,/BPP_GMAIL_ADMIN_HANDOFF/);
 assert.match(js,/event\.origin!==expectedOpenerOrigin/);
 assert.equal(js.includes('BPPMS_V9_PRODUCTION_PIN_USER_SESSION'),false);
 env.STAGING_INTAKE_ENABLED='true';
 assert.equal((await worker.fetch(req('/oauth/gmail/setup'),env)).status,503);
});
