import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const page=readFileSync(new URL('../gmail-connect.html',import.meta.url),'utf8');
const script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const token='a'.repeat(43);
assert.ok(script,'inline launcher must exist');
function harness({session=token,role='admin',origin='https://glwjrmi-prog.github.io'}={}){
 const button={disabled:false,addEventListener(type,fn){if(type==='click')this.click=fn}};
 const status={textContent:''};
 const listeners=new Map();
 const sent=[],urls=[];
 const popup={closed:false,close(){this.closed=true},location:{replace(s){urls.push(s)}},
  postMessage(data,target){sent.push({data,target})}};
 const document={getElementById(id){return id==='connect'?button:status}};
 const window={open(){return popup},addEventListener(type,fn){listeners.set(type,fn)},
  removeEventListener(type){listeners.delete(type)}};
 const sessionStorage={getItem(){return session}};
 const fetch=async(url,opts)=>{
  assert.equal(url,'https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me');
  assert.equal(opts.headers.authorization,'Bearer '+token);
  return {ok:true,async json(){return {user:{id:'admin-1',role,active:true}}}};
 };
 const location={origin,pathname:'/brewer-park-place-management-suite/gmail-connect.html'};
 vm.runInNewContext(script,{document,window,sessionStorage,fetch,location,console});
 return {button,status,popup,listeners,sent,urls};
}
test('missing PIN session never opens popup',async()=>{
 const h=harness({session:null});
 await h.button.click();
 assert.equal(h.urls.length,0);
 assert.match(h.status.textContent,/sign in/i);
});
test('non-admin cannot authorize staging',async()=>{
 const h=harness({role:'user'});
 await h.button.click();
 assert.equal(h.urls.length,0);
 assert.equal(h.popup.closed,true);
 assert.match(h.status.textContent,/administrator/i);
});
test('admin requires exact-origin popup message and never adds bearer to URL',async()=>{
 const h=harness();
 await h.button.click();
 assert.equal(h.urls.length,1);
 assert.equal(h.urls[0],'https://bpp-maintenance-intake-staging.glwjrmi.workers.dev/oauth/gmail/setup');
 assert.ok(!h.urls[0].includes(token));
 const message=h.listeners.get('message');
 assert.ok(message);
 message({origin:'https://evil.example',source:h.popup,data:{type:'BPP_GMAIL_SETUP_READY'}});
 assert.equal(h.sent.length,0);
 message({origin:'https://bpp-maintenance-intake-staging.glwjrmi.workers.dev',source:h.popup,
  data:{type:'BPP_GMAIL_SETUP_READY'}});
 assert.equal(h.sent.length,1);
 assert.equal(h.sent[0].target,'https://bpp-maintenance-intake-staging.glwjrmi.workers.dev');
 assert.equal(h.sent[0].data.token,token);
 assert.ok(!h.listeners.has('message'));
});
test('page has no secrets or automatic OAuth',()=>{
 assert.ok(!page.includes('GMAIL_CLIENT_SECRET'));
 assert.ok(!page.includes('GMAIL_VAULT_KEY'));
 assert.ok(!page.includes('oauth/gmail/start'));
 assert.ok(page.includes("button.addEventListener('click',launch)"));
});
