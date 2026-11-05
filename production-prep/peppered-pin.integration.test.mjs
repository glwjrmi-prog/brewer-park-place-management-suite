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
 const res=await mf.dispatchFetch('https://api.example.test'+path,{method:'GET',headers});
 return {res,data:await res.json()};
};
const post = async (path,payload,token='')=>{
 const headers={Origin:origin,'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const res=await mf.dispatchFetch('https://api.example.test'+path,{method:'POST',headers,body:JSON.stringify(payload)});
 return {res,data:await res.json()};
};
test('isolated real Worker runtime, D1 auth migration, state and integrity',async(t)=>{
 mf=new Miniflare({
  compatibilityDate:'2026-10-01',
  modules:true,
  scriptPath:'production-prep/WORKER_PEPPER_EXPERIMENT.js',
  d1Databases:['DB'],
  bindings:{
    ACCESS_TOKEN:'synthetic-old-shared-key',
    ADMIN_TOKEN:'synthetic-admin-token',
    PIN_PEPPER:'synthetic-test-pepper-not-real-change-before-use-1234567890',
    SYSTEM_ADMIN_USER_ID:'admin',
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
 // Real V8-isolate Worker login: triggers D1 read and PBKDF2 migration writes.
 const login=await post('/api/auth/login',{name:'Test User',pin:'654321'});
 assert.equal(login.res.status,200,JSON.stringify(login.data));
 assert.match(login.data.token,/^[0-9a-f]{64}$/);
 const c=await db.prepare('SELECT iterations,verifier FROM pin_credentials WHERE user_id=?').bind('viewer').first();
 assert.equal(c.iterations,100000);
 assert.match(c.verifier,/^[0-9a-f]{64}$/);
 const me=await get('/api/auth/me',login.data.token);
 assert.equal(me.data.user.role,'user');
 // Authenticated ordinary PIN sessions may read; sensitive hashes are redacted.
 const state=await get('/api/state',login.data.token);
 assert.equal(state.res.status,200);
 assert.equal(state.data.data._access.users[0].pinHash,undefined);
 assert.equal(state.data.data.maintenance[0].id,'WO-2026-079');
 // Missing a module is forbidden even if the new body otherwise looks valid.
 const dropped=structuredClone(state.data.data);
 delete dropped.groundsProjects;
 const deny=await post('/api/state',{baseRevision:1,data:dropped},login.data.token);
 assert.equal(deny.res.status,422,JSON.stringify(deny.data));
 // Ordinary user forbidden from changing role.
 const escalated=structuredClone(state.data.data);
 escalated._access.users[1].role='admin';
 const forbidden=await post('/api/state',{baseRevision:1,data:escalated},login.data.token);
 assert.equal(forbidden.res.status,403,JSON.stringify(forbidden.data));
 // Login as administrator, then save a legitimate new work order.
 const adminLogin=await post('/api/auth/login',{name:'Test Admin',pin:'123456'});
 assert.equal(adminLogin.res.status,200,JSON.stringify(adminLogin.data));
 const candidate=structuredClone((await get('/api/state',adminLogin.data.token)).data.data);
 candidate.maintenance.push({id:'WO-2026-080',status:'Open',location:'Integration test'});
 const saved=await post('/api/state',{baseRevision:1,data:candidate,reason:'Synthetic work order'},adminLogin.data.token);
 assert.equal(saved.res.status,200,JSON.stringify(saved.data));
 const after=await get('/api/state',adminLogin.data.token);
 assert.equal(after.data.revision,2);
 assert.equal(after.data.data.maintenance.length,2);
 assert.equal(after.data.data.groundsProjects.length,1);
 const historical=await db.prepare('SELECT count(*) AS n FROM state_revisions').first();
 assert.equal(historical.n,1);
 // Server-side session invalidation must work without a browser refresh.
 // A user already holding a token must lose access when an administrator deactivates them.
 const beforeDisable=structuredClone(after.data.data);
 beforeDisable._access.users.find(u=>u.id==='viewer').active=false;
 const disabled=await post('/api/state',{baseRevision:2,data:beforeDisable,reason:'Synthetic account deactivation'},adminLogin.data.token);
 assert.equal(disabled.res.status,200,JSON.stringify(disabled.data));
 assert.equal((await get('/api/state',login.data.token)).res.status,401,'Deactivated user session remained valid');
 const deniedLogin=await post('/api/auth/login',{name:'Test User',pin:'654321'});
 assert.notEqual(deniedLogin.res.status,200,'Deactivated account was allowed to sign in');
 // Reactivate user and change their PIN; the previously issued session must stay invalid.
 const afterDisable=await get('/api/state',adminLogin.data.token);
 const changed=structuredClone(afterDisable.data.data);
 const viewer=changed._access.users.find(u=>u.id==='viewer');
 viewer.active=true;
 viewer.salt='3'.repeat(32);
 viewer.pinHash=await hash(viewer.salt+'|789456');
 const changedPin=await post('/api/state',{baseRevision:3,data:changed,reason:'Synthetic reset and reactivate'},adminLogin.data.token);
 assert.equal(changedPin.res.status,200,JSON.stringify(changedPin.data));
 assert.equal((await get('/api/state',login.data.token)).res.status,401,'Old session survived PIN reset');
 const oldPin=await post('/api/auth/login',{name:'Test User',pin:'654321'});
 assert.notEqual(oldPin.res.status,200,'Old PIN remained usable after reset');
 const newPin=await post('/api/auth/login',{name:'Test User',pin:'789456'});
 assert.equal(newPin.res.status,200,JSON.stringify(newPin.data));
 assert.equal((await get('/api/auth/me',newPin.data.token)).data.user.role,'user');
 // Ordinary user cannot use another user's PIN session to operate administrative endpoints.
 const blockedRestore=await post('/api/restore',{baseRevision:4,revision:1},newPin.data.token);
 assert.equal(blockedRestore.res.status,403);
 const blockedBootstrap=await post('/api/bootstrap',{data:{}},newPin.data.token);
 assert.equal(blockedBootstrap.res.status,403);
 const latest=await get('/api/state',adminLogin.data.token);
 assert.equal(latest.data.revision,4,'Forbidden requests changed the authoritative revision');
 // Logged-out sessions cannot read protected state.
 const logout=await post('/api/auth/logout',{},adminLogin.data.token);
 assert.equal(logout.res.status,200);
 assert.equal((await get('/api/state',adminLogin.data.token)).res.status,401);
 // Simulate the credential-only data state after an offline-verified migration:
 // no old fast hashes or salts, no source hash retained in new verifier table.
 const currentBlob=await db.prepare('SELECT state_json FROM current_state').first();
 const credentialOnly=JSON.parse(currentBlob.state_json);
 for(const u of credentialOnly._access.users){delete u.pinHash;delete u.salt;delete u.passwordHash;}
 await db.prepare('UPDATE current_state SET state_json=? WHERE singleton_id=1').bind(JSON.stringify(credentialOnly)).run();
 await db.prepare("UPDATE pin_credentials SET source_pin_hash=''").run();
 const fromScrub=await post('/api/auth/login',{name:'Test User',pin:'789456'});
 assert.equal(fromScrub.res.status,200,'Existing server-side credential failed after fast hash scrubbing: '+JSON.stringify(fromScrub.data));
 const protectedState=await get('/api/state',fromScrub.data.token);
 assert.equal(protectedState.res.status,200);
 assert.equal(protectedState.data.data.maintenance.length,2);
 assert.ok(protectedState.data.data._access.users.every(u=>!('pinHash' in u)&&!('salt' in u)));
 const adminAfterScrub=await post('/api/auth/login',{name:'Test Admin',pin:'123456'});
 assert.equal(adminAfterScrub.res.status,200,'Admin lockout after credential-history scrub');
 assert.equal((await get('/api/auth/me',adminAfterScrub.data.token)).data.user.role,'admin');
 // Server-backed account enrollment never places a PIN hash in /api/state.
 const ordinaryCreate=await post('/api/admin/user-create',{name:'Third User',role:'user',pin:'246810'},fromScrub.data.token);
 assert.equal(ordinaryCreate.res.status,403);
 const noAudit=await get('/api/admin/activity',fromScrub.data.token);
 assert.equal(noAudit.res.status,403,'An ordinary user could view private activity');
 const adminActivity=await get('/api/admin/activity',adminAfterScrub.data.token);
 assert.equal(adminActivity.res.status,200,'Dedicated system administrator could not view activity');
 const created=await post('/api/admin/user-create',{name:'Third User',role:'user',pin:'246810'},adminAfterScrub.data.token);
 assert.equal(created.res.status,201,JSON.stringify(created.data));
 assert.equal(created.data.user.role,'user');
 const thirdLogin=await post('/api/auth/login',{name:'Third User',pin:'246810'});
 assert.equal(thirdLogin.res.status,200,'Newly enrolled account cannot log in');
 const afterCreation=await get('/api/state',thirdLogin.data.token);
 assert.equal(afterCreation.data.revision,5);
 assert.equal(afterCreation.data.data.maintenance.length,2);
 assert.equal(afterCreation.data.data._access.users.length,3);
 assert.equal(afterCreation.data.data._access.users[2].pinHash,undefined);
 assert.equal((await get('/api/admin/activity',thirdLogin.data.token)).res.status,403);
 // PIN reset is a server-only admin action after credential-only cutover.
 const ordinaryReset=await post('/api/admin/pin-reset',{userId:'admin',pin:'831624'},fromScrub.data.token);
 assert.equal(ordinaryReset.res.status,403,'Ordinary account could reset administrator PIN');
 const reset=await post('/api/admin/pin-reset',{userId:'viewer',pin:'831624'},adminAfterScrub.data.token);
 assert.equal(reset.res.status,200,JSON.stringify(reset.data));
 assert.equal((await get('/api/auth/me',fromScrub.data.token)).res.status,401,
              'PIN reset failed to invalidate active user session');
 const superseded=await post('/api/auth/login',{name:'Test User',pin:'789456'});
 assert.notEqual(superseded.res.status,200,'Old PIN worked after credential-only reset');
 const rotated=await post('/api/auth/login',{name:'Test User',pin:'831624'});
 assert.equal(rotated.res.status,200,JSON.stringify(rotated.data));
 const stateAfterRotate=await get('/api/state',rotated.data.token);
 const weakHashInjection=structuredClone(stateAfterRotate.data.data);
 weakHashInjection._access.users.find(u=>u.id==='viewer').pinHash='f'.repeat(64);
 weakHashInjection._access.users.find(u=>u.id==='viewer').salt='a'.repeat(32);
 const injection=await post('/api/state',{baseRevision:5,data:weakHashInjection},rotated.data.token);
 assert.equal(injection.res.status,403,'Fast credential hashes reintroduced after scrub');
 assert.equal((await get('/api/state',rotated.data.token)).data.revision,5);
 // CORS must not permit the staging Pages origin.
 const disallowed=await mf.dispatchFetch('https://api.example.test/api/auth/login',{
  method:'OPTIONS',headers:{Origin:'https://bad.bpp-management-suite-staging.pages.dev'}
 });
 assert.equal(disallowed.headers.get('access-control-allow-origin'),null);
});
