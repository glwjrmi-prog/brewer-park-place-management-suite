// OPTIONAL BPP v9 board-admin Gmail setup control.
// Requires gmail-suite-launcher.js and an explicit call from the existing
// server-verified PIN boot path. This file alone does not enable the UI.
(function(){
  'use strict';
  const ID='bppGmailAdminSetupButton';
  const MESSAGE='bppGmailAdminSetupStatus';
  function install(verifiedAdmin){
    document.getElementById(ID)?.remove();
    document.getElementById(MESSAGE)?.remove();
    if(verifiedAdmin!==true || typeof window.bppLaunchGmailSetup!=='function')return;
    if(location.origin!=='https://glwjrmi-prog.github.io' ||
       !location.pathname.startsWith('/brewer-park-place-management-suite/'))return;
    const container=document.createElement('div');
    container.id='bppGmailAdminSetupControls';
    container.style.cssText='position:fixed;bottom:16px;right:16px;z-index:10000;max-width:min(360px,90vw);font:14px system-ui';
    const button=document.createElement('button');
    button.id=ID;button.type='button';button.textContent='Connect Board Gmail (staging)';
    button.style.cssText='padding:10px 14px;border-radius:8px;border:1px solid #173a29;background:#173a29;color:white;cursor:pointer';
    const message=document.createElement('p');
    message.id=MESSAGE;message.setAttribute('role','status');
    message.style.cssText='background:white;color:#173a29;margin:6px 0 0;padding:7px;border-radius:6px;display:none';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      message.style.display='none';message.textContent='';
      try{await window.bppLaunchGmailSetup()}
      catch(err){message.textContent=err?.message||'Gmail setup could not be opened';message.style.display='block'}
      finally{button.disabled=false}
    });
    container.append(button,message);
    document.body.append(container);
  }
  // Caller must use an identity verified by Suite /api/auth/me, not an
  // untrusted browser role, URL query, or editable input.
  window.bppInstallGmailAdminSetupControl=install;
})();
