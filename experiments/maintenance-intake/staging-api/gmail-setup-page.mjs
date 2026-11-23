// BPP Gmail staging setup UI; no credentials or user records are embedded.
// Deploy ONLY on the isolated Cloudflare staging domain, after review.
// A signed-in BPP Management Suite popup opener transfers its current PIN
// bearer by target-origin postMessage; the page sends it to this same-origin
// /oauth/gmail/session endpoint in request headers, never in URLs or storage.
const allowed='https://glwjrmi-prog.github.io';
const html=`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BPP Gmail Setup</title><link rel="icon" href="data:,"></head><body><main style="font:16px system-ui;max-width:640px;margin:8vh auto;padding:26px"><h1>Brewer Park Place</h1><h2>Board maintenance notifications</h2><p>This setup authorizes the Board's existing Google Workspace mailbox to send maintenance notifications. It does not enable resident submissions.</p><p id="status" role="status">Checking administrator authorization…</p></main><script type="module" src="/oauth/gmail/setup.js"></script></body></html>`;
const js=`const expectedOpenerOrigin='https://glwjrmi-prog.github.io';
const status=document.getElementById('status');
const setStatus=value=>{status.textContent=value};
let started=false;
if(!window.opener){setStatus('Please open this page from the authenticated BPP Management Suite.')}
else{
 window.addEventListener('message',async event=>{
  if(started||event.origin!==expectedOpenerOrigin||event.source!==window.opener||
    event.data?.type!=='BPP_GMAIL_ADMIN_HANDOFF')return;
  const token=event.data?.token;
  if(typeof token!=='string'||token.length<32||token.length>512)return;
  started=true;
  try{
   // Origin checks happen again on the server; PIN bearer is not persisted.
   const session=await fetch('/oauth/gmail/session',{
    method:'POST',credentials:'same-origin',redirect:'error',
    headers:{'content-type':'application/json',
     'x-bpp-setup-intent':'gmail-send-only',authorization:'Bearer '+token},
    body:'{}',cache:'no-store'
   });
   if(!session.ok)throw Error('BPP administrator verification was not approved.');
   const context=await session.json();
   const start=await fetch('/oauth/gmail/start',{
    method:'POST',credentials:'same-origin',redirect:'error',
    headers:{'x-bpp-gmail-csrf':context.csrfToken},cache:'no-store'
   });
   if(!start.ok)throw Error('Gmail authorization could not start.');
   const details=await start.json();
   const google=new URL(details.authorizationUrl);
   if(google.origin!=='https://accounts.google.com'||
     google.pathname!=='/o/oauth2/v2/auth')throw Error('Unexpected Google address.');
   setStatus('Opening Google authorization…');
   // Break opener relationship before navigating to third-party Google page.
   window.opener=null;
   location.assign(google.href);
  }catch(e){setStatus(e?.message||'Gmail setup could not be started.');}
 });
 window.opener.postMessage({type:'BPP_GMAIL_SETUP_READY'},expectedOpenerOrigin);
}`;
function noStore(type,body,status=200){
 return new Response(body,{status,headers:{'content-type':type,'cache-control':'no-store, private',
  'referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY',
  'content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
export function renderGmailSetupPage(req,env){
 let url;try{url=new URL(req.url)}catch{return noStore('text/plain','Not found',404)}
 if(req.method!=='GET'||url.origin!==env?.STAGING_ADMIN_ORIGIN||
   env?.STAGING_GMAIL_OAUTH_ENABLED!=='true'||env?.STAGING_INTAKE_ENABLED!=='false')
  return noStore('text/plain','Unavailable',503);
 if(url.pathname==='/oauth/gmail/setup')return noStore('text/html; charset=utf-8',html);
 if(url.pathname==='/oauth/gmail/setup.js')return noStore('text/javascript; charset=utf-8',js);
 return noStore('text/plain','Not found',404);
}
export const bppSuiteOrigin=allowed;
