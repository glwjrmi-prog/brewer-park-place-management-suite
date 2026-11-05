import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {Miniflare} from 'miniflare';

const source='production-prep/WORKER_PIN_RELEASE_CANDIDATE.js';
const worker=readFileSync(source,'utf8');
const host='https://bpp-management-suite-production-api.glwjrmi.workers.dev';
const origin='https://glwjrmi-prog.github.io';
const hash=async s=>[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');

test('temporary production enrollment is host-bound and opt-in, migrates both live-shaped synthetic PINs',async t=>{
 const mf=new Miniflare({compatibilityDate:'2026-10-01',modules:true,scriptPath:source,d1Databases:['DB'],
  bindings:{PIN_ENROLLMENT_OPEN:'enabled',PIN_PEPPER:'synthetic-testing-only-pepper-with-more-than-thirty-two-chars',
    ACCESS_TOKEN:'synthetic-old-token',ADMIN_TOKEN:'synthetic-admin',ALLOWED_ORIGINS:origin,
    SYSTEM_ADMIN_USER_ID:'usr-system'}});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const ddl=[
  'CREATE TABLE current_state(singleton_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, checksum TEXT NOT NULL, counts_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, reason TEXT NOT NULL)',
  'CREATE TABLE state_revisions(revision INTEGER PRIMARY KEY,state_json TEXT NOT NULL,checksum TEXT NOT NULL, counts_json TEXT NOT NULL,saved_at TEXT NOT NULL,saved_by TEXT NOT NULL,reason TEXT NOT NULL)',
  'CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,revision INTEGER,actor TEXT,created_at TEXT,details_json TEXT)',
  'CREATE TABLE pin_credentials(user_id TEXT PRIMARY KEY,salt TEXT NOT NULL,verifier TEXT NOT NULL,iterations INTEGER NOT NULL,source_pin_hash TEXT NOT NULL,updated_at INTEGER NOT NULL)',
  'CREATE TABLE pin_sessions_v2(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,account_fingerprint TEXT NOT NULL)',
  'CREATE TABLE pin_attempts(identifier TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0)'
 ];
 for(const sql of ddl)await db.exec(sql+';');
 const users=[{id:'usr-system',name:'System Owner',role:'admin',active:true,salt:'1'.repeat(32),pinHash:await hash('1'.repeat(32)+'|123456')},
 {id:'usr-board',name:'Board User',role:'user',active:true,salt:'2'.repeat(32),pinHash:await hash('2'.repeat(32)+'|654321')}];
 const data={_access:{users},maintenance:[],projects:[],groundsProjects:[],vendors:[],violations:[],inspections:[],knowledgeBase:[]};
 const stateJson=JSON.stringify(data);
 await db.prepare("INSERT INTO current_state(singleton_id,revision,state_json,checksum,counts_json,updated_at,updated_by,reason) VALUES(1,187,?,?,?,?,?,?)")
 .bind(stateJson,await hash(stateJson),'{}','2026-11-05','fixture','fixture').run();
 const fetch=(pathname,opts={})=>mf.dispatchFetch(host+pathname,opts);
 const page=await fetch('/pin-enrollment');
 assert.equal(page.status,200);
 const html=await page.text();
 assert.match(html,/Brewer Park Place PIN Enrollment/);
 assert.match(html,/id="name" autocomplete="off"/);
 assert.doesNotMatch(html,/value="System Owner"|value="Board User"/);
 assert.doesNotMatch(html,/PIN_PEPPER|ACCESS_TOKEN/);
 const external=await mf.dispatchFetch('https://unrelated.example.test/pin-enrollment');
 assert.equal(external.status,401,'Enrollment page exposed to a non-production hostname');
 const headers={'Content-Type':'application/json'};
 for(const [name,pin] of [['System Owner','123456'],['Board User','654321']]){
   const login=await fetch('/api/auth/login',{method:'POST',headers,body:JSON.stringify({name,pin})});
   assert.equal(login.status,200,'One of the existing accounts could not migrate');
   const credentials=await db.prepare('SELECT COUNT(*) AS count FROM pin_credentials').first();
   assert.ok(credentials.count>=1);
   const reply=await login.json();
   const checked=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+reply.token}});
   assert.equal(checked.status,200);
   const me=await checked.json();
   assert.equal(me.user.name,name);
   assert.equal(me.user.canViewActivity,name==='System Owner');
 }
 const amount=(await db.prepare('SELECT COUNT(*) AS n FROM pin_credentials').first()).n;
 assert.equal(amount,2,'Both existing credentials were not migrated');
 const snapshot=await db.prepare('SELECT revision,state_json FROM current_state').first();
 assert.equal(snapshot.revision,187);
 assert.deepEqual(JSON.parse(snapshot.state_json),data);
 const legacy=await fetch('/api/state',{headers:{Authorization:'Bearer synthetic-old-token'}});
 assert.equal(legacy.status,401,'Legacy token bypass should be off by default');
});

test('never ship test-only routes or open enrollment without operator setting',()=>{
 assert.doesNotMatch(worker,/url\.pathname\s*===\s*['"]\/test\/scrub['"]/);
 assert.doesNotMatch(worker,/function scrubSyntheticCredentials/);
 assert.match(worker,/PIN_ENROLLMENT_OPEN === 'enabled'/);
 assert.match(worker,/url\.hostname === 'bpp-management-suite-production-api\.glwjrmi\.workers\.dev'/);
});
