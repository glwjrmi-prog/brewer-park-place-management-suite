// EXPERIMENT: only isolated Miniflare+D1 synthetic data; do NOT deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { Miniflare } from 'miniflare';

const origin = 'https://glwjrmi-prog.github.io';
const salt='1'.repeat(32);
const hash=async input=>[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))].map(x=>x.toString(16).padStart(2,'0')).join('');
let mf, db;
const get = async (path,token='') => {
 const headers={Origin:origin};if(token)headers.Authorization='Bearer '+token;
 const res=await mf.dispatchFetch('https://bpp-pin-integration-test-api.glwjrmi.workers.dev'+path,{method:'GET',headers});
 return {res,data:await res.json()};
};
const post = async (path,payload,token='')=>{
 const headers={Origin:origin,'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const res=await mf.dispatchFetch('https://bpp-pin-integration-test-api.glwjrmi.workers.dev'+path,{method:'POST',headers,body:JSON.stringify(payload)});
 return {res,data:await res.json()};
};
test('isolated real Worker runtime, D1 auth migration, state and integrity',async(t)=>{
 mf=new Miniflare({
  compatibilityDate:'2026-10-01',
  modules:true,
  scriptPath:'production-prep/WORKER_PIN_ENROLLMENT_TEST.js',
  d1Databases:['DB'],
  bindings:{
    ACCESS_TOKEN:'synthetic-old-shared-key',
    ADMIN_TOKEN:'synthetic-admin-token',
    PIN_PEPPER:'synthetic-test-pepper-not-real-change-before-use-1234567890',
    SYSTEM_ADMIN_USER_ID:'admin',
    TEST_MODE:'enabled',
    ALLOWED_ORIGINS:origin
  },
 });
 t.after(async()=>{await mf.dispose()});
 db=await mf.getD1Database('DB');
 for(const sql of `
  CREATE TABLE current_state (
   singleton_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL,
   state_json TEXT NOT NULL, checksum TEXT NOT NULL, counts_json TEXT NOT NULL,
   updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,reason TEXT NOT NULL
  );
  CREATE TABLE state_revisions (
   revision INTEGER PRIMARY KEY,state_json TEXT NOT NULL,checksum TEXT NOT NULL,
   counts_json TEXT NOT NULL,saved_at TEXT NOT NULL,saved_by TEXT NOT NULL,reason TEXT NOT NULL
  );
  CREATE TABLE audit_events (
   id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,revision INTEGER,
   actor TEXT,created_at TEXT,details_json TEXT
  );
  CREATE TABLE pin_attempts (
   identifier TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
   locked_until INTEGER NOT NULL DEFAULT 0
  );
  `.split(';').map(q=>q.trim()).filter(Boolean)) await db.exec(sql.replace(/\s+/g,' ')+';');
 const schema=readFileSync('production-prep/SCHEMA_V2.sql','utf8').replace(/^--.*$/gm,'');
 for(const sql of schema.split(';').map(q=>q.trim()).filter(Boolean)) await db.exec(sql.replace(/\s+/g,' ')+';');
 const users=[
  {id:'admin',name:'Test Admin',role:'admin',active:true,salt,pinHash:await hash(salt+'|123456')},
  {id:'viewer',name:'Test User',role:'user',active:true,salt:'2'.repeat(32),pinHash:await hash('2'.repeat(32)+'|654321')}
 ];
 const data={
  meta:{name:'BPP synthetic'}, _access:{users},maintenance:[{id:'WO-2026-079',status:'Closed'}],
  projects:[{name:'Bridge test'}],groundsProjects:[{id:'GP-1',status:'Planning'}],
  knowledgeBase:[{id:'KB-1',topic:'Test'}], vendors:[],violations:[],inspections:[],
  recoveryMetadata:{verified:'synthetic'}
 };
 await db.prepare('INSERT INTO current_state(singleton_id,revision,state_json,checksum,counts_json,updated_at,updated_by,reason) VALUES(1,1,?,?,?,?,?,?)')
  .bind(JSON.stringify(data),'fixture-checksum','{}','2026-11-04','fixture','fixture').run();
 // A leaked legacy ACCESS_TOKEN must not grant admin access by default.
 const legacyRead=await get('/api/state','synthetic-old-shared-key');
 assert.equal(legacyRead.res.status,401,'Legacy shared token unexpectedly bypassed PIN authorization');
 const legacyBootstrap=await post('/api/bootstrap',{data:{}},'synthetic-old-shared-key');
 assert.equal(legacyBootstrap.res.status,401,'Shared token unexpectedly permitted database bootstrap');

 const login=await post('/api/auth/login',{name:'Test User',pin:'654321'});
 assert.equal(login.res.status,200,JSON.stringify(login.data));
 const admin=await post('/api/auth/login',{name:'Test Admin',pin:'123456'});
 assert.equal(admin.res.status,200,JSON.stringify(admin.data));
 const enrollPage=await mf.dispatchFetch('https://bpp-pin-integration-test-api.glwjrmi.workers.dev/test-enroll',{method:'GET'});
 assert.equal(enrollPage.status,200);
 assert.match(await enrollPage.text(),/PIN Enrollment/);
 // The historical credential cleanup must refuse a partial rollout.
 const early=await post('/test/scrub',{},admin.data.token);
 assert.equal(early.res.status,409);
 assert.equal((await get('/api/state',admin.data.token)).data.revision,1);
 const viewerConfirmed=await post('/test/confirm',{},login.data.token);
 assert.equal(viewerConfirmed.res.status,200);
 const adminConfirmed=await post('/test/confirm',{},admin.data.token);
 assert.equal(adminConfirmed.res.status,200);
 const scrubbed=await post('/test/scrub',{},admin.data.token);
 assert.equal(scrubbed.res.status,200,JSON.stringify(scrubbed.data));
 assert.equal(scrubbed.data.snapshotsChecked,1);
 assert.equal((await get('/api/state',login.data.token)).res.status,401,'Cleanup did not revoke old sessions');
 const snapshot=await db.prepare('SELECT state_json,checksum FROM current_state').first();
 const serverHash=await hash(snapshot.state_json);
 assert.equal(snapshot.checksum,serverHash,'Cleanup corrupted state checksum');
 const cleaned=JSON.parse(snapshot.state_json);
 assert.equal(cleaned.maintenance.length,1);
 assert.equal(cleaned.groundsProjects.length,1);
 assert.ok(cleaned._access.users.every(u=>!('pinHash' in u)&&!('salt' in u)));
 const freshAdmin=await post('/api/auth/login',{name:'Test Admin',pin:'123456'});
 assert.equal(freshAdmin.res.status,200,'Admin lockout after cleanup');
 const freshViewer=await post('/api/auth/login',{name:'Test User',pin:'654321'});
 assert.equal(freshViewer.res.status,200,'User lockout after cleanup');
 assert.equal((await get('/api/admin/activity',freshViewer.data.token)).res.status,403);
 assert.equal((await get('/api/admin/activity',freshAdmin.data.token)).res.status,200);
 const added=await post('/api/admin/user-create',{name:'Enrollment Test Member',role:'user',pin:'246810'},freshAdmin.data.token);
 assert.equal(added.res.status,201,JSON.stringify(added.data));
 assert.equal((await post('/api/auth/login',{name:'Enrollment Test Member',pin:'246810'})).res.status,200);
 const reset=await post('/api/admin/pin-reset',{userId:added.data.user.id,pin:'831624'},freshAdmin.data.token);
 assert.equal(reset.res.status,200);
 assert.notEqual((await post('/api/auth/login',{name:'Enrollment Test Member',pin:'246810'})).res.status,200);
 assert.equal((await post('/api/auth/login',{name:'Enrollment Test Member',pin:'831624'})).res.status,200);
 // Hostname-bound: even TEST_MODE must not expose scrub on a production URL.
 const wrongHost=await mf.dispatchFetch('https://bpp-management-suite-production-api.glwjrmi.workers.dev/test-enroll',{method:'GET'});
 assert.notEqual(wrongHost.status,200);
});
