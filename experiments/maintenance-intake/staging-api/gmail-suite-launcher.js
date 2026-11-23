// BPP Management Suite v9 OPTIONAL Gmail setup launch helper — source only.
// DO NOT include on production site until authorized. This reuses the current
// server-validated Suite PIN session without asking an administrator to type
// their PIN into any separate page, email, chat, URL or browser console.
// Must run from an actual user click on the protected Suite website.
(function(){
 'use strict';
 const origin='https://glwjrmi-prog.github.io';
 const staging='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
 const api='https://bpp-management-suite-production-api.glwjrmi.workers.dev';
 const sessionStorageKey='BPPMS_V9_PRODUCTION_PIN_USER_SESSION';
 async function launch(){
  if(location.origin!==origin||
     !location.pathname.startsWith('/brewer-park-place-management-suite/'))
   throw Error('Not on the protected BPP Management Suite site');
  const token=sessionStorage.getItem(sessionStorageKey);
  if(typeof token!=='string'||token.length<32)throw Error('Sign in to Management Suite first');
  const check=await fetch(api+'/api/auth/me',{
   method:'GET',headers:{authorization:'Bearer '+token},cache:'no-store',redirect:'error'
  });
  if(!check.ok)throw Error('Your BPP session is no longer active');
  const data=await check.json();
  if(data?.user?.role!=='admin'||data?.user?.active===false)
   throw Error('Board administrator authorization is required');
  const popup=window.open(staging+'/oauth/gmail/setup','bppGmailSetup');
  if(!popup)throw Error('Allow a popup to connect BPP Gmail');
  let sent=false;
  const receive=event=>{
   if(sent||event.origin!==staging||event.source!==popup||
      event.data?.type!=='BPP_GMAIL_SETUP_READY')return;
   sent=true;
   window.removeEventListener('message',receive);
   // Only the exact Cloudflare staging origin receives this session,
   // via postMessage, never as a URL parameter or in localStorage.
   popup.postMessage({type:'BPP_GMAIL_ADMIN_HANDOFF',token},staging);
  };
  window.addEventListener('message',receive);
 }
 // Do not automatically initiate Google OAuth or open any window.
 // Attach launch() to an explicitly approved Board-admin UI control later.
 window.bppLaunchGmailSetup=launch;
})();
