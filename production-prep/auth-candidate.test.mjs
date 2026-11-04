// Candidate authentication tests: synthetic user data only. No live Cloudflare access.
// Run: node --test production-prep/auth-candidate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from './WORKER_AUTH_CANDIDATE.js';
const crypto = globalThis.crypto || webcrypto;
const hex = b => [...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
const sha = async t=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)));
const allowed='https://glwjrmi-prog.github.io';
const staging='https://c5a891d1.bpp-management-suite-staging.pages.dev';
const unrelated='https://attacker.pages.dev';
const salt='a'.repeat(32);
async function fixture() {
  const user={id:'usr-1',name:'Test Admin',role:'admin',active:true,salt,pinHash:await sha(salt+'|123456')};
  const second={id:'usr-2',name:'Test User',role:'user',active:true,salt:'b'.repeat(32),pinHash:await sha('b'.repeat(32)+'|654321')};
  const db={accounts:new Map(), attempts:new Map(), creds:new Map(), sessions:new Map(),
    async batch() {return [{meta:{changes:1}},{meta:{changes:1}},{meta:{changes:1}}]},
    state:{singleton_id:1,revision:1,state_json:JSON.stringify({_access:{users:[user,second]},maintenance:[],projects:[],inspections:[],vendors:[],violations:[]}),checksum:'abc',counts_json:'{}',updated_at:'now',updated_by:'tester',reason:'fixture'},
    prepare(sql) {
      const args={sql,binds:[]};
      const statement={
        bind(...binds){args.binds=binds;return statement},
        async first(){
          if(sql.includes('FROM current_state'))return db.state;
          if(sql.includes('FROM pin_attempts'))return db.attempts.get(args.binds[0])||null;
          if(sql.includes('FROM pin_credentials'))return db.creds.get(args.binds[0])||null;
          if(sql.includes('FROM pin_sessions_v2'))return db.sessions.get(args.binds[0])||null;
          throw new Error('Unmocked SELECT: '+sql);
        },
        async run(){
          if(sql.startsWith('INSERT INTO pin_attempts')) {
            db.attempts.set(args.binds[0],{failures:args.binds[1],locked_until:args.binds[2]});return {};
          }
          if(sql.startsWith('DELETE FROM pin_attempts')) {db.attempts.delete(args.binds[0]);return {};}
          if(sql.startsWith('INSERT INTO pin_credentials')) {
            db.creds.set(args.binds[0],{salt:args.binds[1],verifier:args.binds[2],iterations:args.binds[3],source_pin_hash:args.binds[4]});return {};
          }
          if(sql.startsWith('INSERT INTO pin_sessions_v2')) {
            db.sessions.set(args.binds[0],{user_id:args.binds[1],expires_at:args.binds[2],created_at:args.binds[3],account_fingerprint:args.binds[4]});return {};
          }
          if(sql.startsWith('DELETE FROM pin_sessions_v2')) {db.sessions.delete(args.binds[0]);return {};}
          throw new Error('Unmocked write: '+sql);
        }
      };
      return statement;
    }
  };
  return {db,user,second,env:{DB:db,ACCESS_TOKEN:'private-legacy-test-token',ADMIN_TOKEN:'different-admin-token',ALLOWED_ORIGINS:'https://glwjrmi-prog.github.io'}};
}
function request(path,{method='GET',token='',body,origin=allowed}={}) {
  const headers={Origin:origin};if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  return new Request('https://test.worker'+path,{method,headers,body:body?JSON.stringify(body):undefined});
}
async function send(env,path,options) {
  const response=await worker.fetch(request(path,options),env);
  const data=await response.json().catch(()=>null);
  return {response,data};
}
const login=(env,name='Test Admin',pin='123456',origin=allowed)=>
  send(env,'/api/auth/login',{method:'POST',body:{name,pin},origin});
test('preview-origin allowlist rejects unrelated project and allows intended origin',async()=>{
  const {env}=await fixture();
  const yes=await worker.fetch(new Request('https://test.worker/api/auth/login',{method:'OPTIONS',headers:{Origin:allowed}}),env);
  const no=await worker.fetch(new Request('https://test.worker/api/auth/login',{method:'OPTIONS',headers:{Origin:unrelated}}),env);
  const noStaging=await worker.fetch(new Request('https://test.worker/api/auth/login',{method:'OPTIONS',headers:{Origin:staging}}),env);
  assert.equal(yes.headers.get('access-control-allow-origin'),allowed);
  assert.equal(no.headers.get('access-control-allow-origin'),null);
  assert.equal(noStaging.headers.get('access-control-allow-origin'),null);
});
test('migrates a legacy PIN on first sign-in, verifies subsequent sign-in with PBKDF2',async()=>{
  const {env,db}=await fixture();
  const first=await login(env);
  assert.equal(first.response.status,200);
  assert.equal(db.creds.get('usr-1').iterations,310000);
  assert.notEqual(db.creds.get('usr-1').verifier,db.state.pinHash);
  const second=await login(env);
  assert.equal(second.response.status,200);
  assert.equal(db.creds.size,1);
  const who=await send(env,'/api/auth/me',{token:second.data.token});
  assert.equal(who.data.user.role,'admin');
  const state=await send(env,'/api/state',{token:second.data.token});
  assert.equal(state.data.data._access.users[0].pinHash,undefined);
  assert.equal(state.data.data._access.users[0].salt,undefined);
  const out=await send(env,'/api/auth/logout',{method:'POST',token:second.data.token});
  assert.equal(out.response.status,200);
  assert.equal((await send(env,'/api/auth/me',{token:second.data.token})).response.status,401);
});
test('PIN reset and role change invalidate old session; new PIN migrates verifier',async()=>{
  const {env,db,user}=await fixture();
  const one=await login(env);assert.equal(one.response.status,200);
  user.salt='c'.repeat(32);user.pinHash=await sha(user.salt+'|987654');
  db.state.state_json=JSON.stringify({_access:{users:[user,{id:'usr-2',name:'Test User',role:'user',active:true,salt:'b'.repeat(32),pinHash:await sha('b'.repeat(32)+'|654321')}]},maintenance:[],projects:[],inspections:[],vendors:[],violations:[]});
  assert.equal((await send(env,'/api/auth/me',{token:one.data.token})).response.status,401);
  assert.equal((await login(env,'Test Admin','123456')).response.status,401);
  const two=await login(env,'Test Admin','987654');assert.equal(two.response.status,200);
  user.role='user';db.state.state_json=JSON.stringify({_access:{users:[user]},maintenance:[],projects:[],inspections:[],vendors:[],violations:[]});
  assert.equal((await send(env,'/api/auth/me',{token:two.data.token})).response.status,401);
});
test('normal user cannot modify access configuration or add users even with a direct API save',async()=>{
  const {env,db}=await fixture();
  const r=await login(env,'Test User','654321');assert.equal(r.response.status,200);
  const current=JSON.parse(db.state.state_json);
  current._access.users[0].role='user';
  const attempt=await send(env,'/api/state',{method:'POST',token:r.data.token,body:{baseRevision:1,data:current,reason:'escalation'}});
  assert.equal(attempt.response.status,403);
  assert.equal(db.state.revision,1);
});
test('five incorrect PIN attempts trigger lockout',async()=>{
  const {env}=await fixture();
  for(let i=0;i<5;i++)assert.equal((await login(env,'Test Admin','000000')).response.status,401);
  assert.equal((await login(env,'Test Admin','123456')).response.status,429);
});

test('legacy single-record deletion requires precise intent and no collateral record edits',async()=>{
  const {env,db}=await fixture();
  const d=JSON.parse(db.state.state_json);
  d.maintenance=[{id:'WO-2026-079',status:'Closed',issue:'A'},{id:'WO-2026-080',status:'Open',issue:'B'}];
  db.state.state_json=JSON.stringify(d);
  const after=structuredClone(d);after.maintenance.pop();
  const payload={baseRevision:1,data:after,allowDestructive:true,
    deleteIntent:{type:'delete',module:'maintenance',recordId:'WO-2026-080'}};
  const denied=await send(env,'/api/state',{method:'POST',token:'private-legacy-test-token',
    body:{...payload,deleteIntent:{...payload.deleteIntent,recordId:'WO-2026-079'}}});
  assert.equal(denied.response.status,422);
  const tampered=structuredClone(after);tampered.maintenance[0].issue='Tampered';
  const blocked=await send(env,'/api/state',{method:'POST',token:'private-legacy-test-token',
    body:{...payload,data:tampered}});
  assert.equal(blocked.response.status,422);
  const legacy=await send(env,'/api/state',{method:'POST',token:'private-legacy-test-token',body:payload});
  assert.equal(legacy.response.status,200);
  assert.equal(legacy.data.ok,true);
});
test('regular PIN user cannot delete a protected record through direct save',async()=>{
  const {env,db}=await fixture();
  const who=await login(env,'Test User','654321');assert.equal(who.response.status,200);
  const d=JSON.parse(db.state.state_json);
  d.maintenance=[{id:'WO-2026-079',status:'Closed'},{id:'WO-2026-080',status:'Open'}];
  db.state.state_json=JSON.stringify(d);
  const data=structuredClone(d);data.maintenance.pop();
  const attempt=await send(env,'/api/state',{method:'POST',token:who.data.token,body:{
    baseRevision:1,data,allowDestructive:true,
    deleteIntent:{type:'delete',module:'maintenance',recordId:'WO-2026-080'}}});
  assert.equal(attempt.response.status,422);
});

test('legacy state compatibility is opt-in, and does not leak PIN verifiers to PIN sessions',async()=>{
  const {env}=await fixture();
  const modern=await login(env);
  assert.equal(modern.response.status,200);
  env.LEGACY_STATE_COMPAT='true';
  const legacy=await send(env,'/api/state',{token:'private-legacy-test-token'});
  assert.equal(legacy.data.data._access.users[0].pinHash.length,64);
  const current=await send(env,'/api/state',{token:modern.data.token});
  assert.equal(current.data.data._access.users[0].pinHash,undefined);
  delete env.LEGACY_STATE_COMPAT;
  const disabled=await send(env,'/api/state',{token:'private-legacy-test-token'});
  assert.equal(disabled.data.data._access.users[0].pinHash,undefined);
});

test('production-shaped state cannot lose Grounds Projects, knowledge base, or metadata on save', async()=>{
  const {env,db}=await fixture();
  const current=JSON.parse(db.state.state_json);
  current.groundsProjects=[{id:'GP-01',status:'Active'}];
  current.knowledgeBase=[{topic:'Storm door approval',summary:'Reference'}];
  current.recoveryMetadata={created:'source-recovery'};
  current.meta={name:'BPP'};
  db.state.state_json=JSON.stringify(current);
  const loginResponse=await login(env,'Test User','654321');
  assert.equal(loginResponse.response.status,200);
  const token=loginResponse.data.token;
  const missing=structuredClone(current);
  delete missing.groundsProjects;
  const r1=await send(env,'/api/state',{method:'POST',token,body:{baseRevision:1,data:missing}});
  assert.equal(r1.response.status,422);
  const d2=structuredClone(current);
  d2.groundsProjects=[];
  const r2=await send(env,'/api/state',{method:'POST',token,body:{baseRevision:1,data:d2}});
  assert.equal(r2.response.status,422);
  const d3=structuredClone(current);
  d3.knowledgeBase=[];
  const r3=await send(env,'/api/state',{method:'POST',token,body:{baseRevision:1,data:d3}});
  assert.equal(r3.response.status,422);
  const d4=structuredClone(current);
  delete d4.recoveryMetadata;
  const r4=await send(env,'/api/state',{method:'POST',token,body:{baseRevision:1,data:d4}});
  assert.equal(r4.response.status,422);
  assert.equal(db.state.revision,1);
});
