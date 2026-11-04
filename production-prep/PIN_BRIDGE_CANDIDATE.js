// BPP PIN authenticated D1 production website bridge CANDIDATE — NOT DEPLOYABLE
// Preparation branch only. Requires production API candidate, schema and controlled cutover.
(function(){
  'use strict';

  const V9_API='https://bpp-management-suite-production-api.glwjrmi.workers.dev';
  const V9_KEY_STORAGE='BPPMS_V9_PRODUCTION_PIN_SESSION';
  const V9_CONFLICT_PREFIX='BPPMS_V9_PRODUCTION_PIN_CONFLICT_COPY_';
  const V9_BLOCKED_PREFIX='BPPMS_V9_PRODUCTION_PIN_BLOCKED_COPY_';

  let v9Key='';
  let v9Revision=0;
  let v9Dirty=false;
  let v9Busy=false;
  let v9Ready=false;
  let v9ReadOnly=true;
  let v9SaveTimer=null;
  let v9PollTimer=null;
  let v9LastRemote=null;

  // Staging-only work-order numbering fix.
  // The original Suite uses array.length + 1, which can reuse an ID when records were
  // deleted, imported, or assigned nonconsecutively. Never reuse an existing ID.
  const originalDefaultValue=(typeof defaultValue==='function')?defaultValue:null;
  if(originalDefaultValue){
    defaultValue=function(key,name){
      if(key==='maintenance' && name==='id'){
        const year=new Date().getFullYear();
        const prefix='WO-'+year+'-';
        const used=new Set((Array.isArray(state?.maintenance)?state.maintenance:[])
          .map(r=>String(r?.id||'')));
        let maximum=0;
        for(const id of used){
          if(!id.startsWith(prefix))continue;
          const suffix=id.slice(prefix.length);
          if(!/^\d+$/.test(suffix))continue;
          maximum=Math.max(maximum,Number(suffix));
        }
        let next=maximum+1;
        while(used.has(prefix+String(next).padStart(3,'0')))next++;
        return prefix+String(next).padStart(3,'0');
      }
      return originalDefaultValue(key,name);
    };
  }

  // Capture original access-session startup. We delay it until authoritative data is loaded.
  const originalAuditStartSession=(typeof auditStartSession==='function')?auditStartSession:null;

  function v9Actor(){
    try{
      const a=(typeof auditCurrentUser==='function')?String(auditCurrentUser()||'').trim():'';
      return a||'Authorized user';
    }catch{return 'Authorized user'}
  }

  function v9Status(text,kind=''){
    try{setCloudStatus(text,kind)}catch{}
    let b=document.getElementById('bppV9SafetyBanner');
    if(!b){
      b=document.createElement('div');
      b.id='bppV9SafetyBanner';
      b.style.cssText='position:fixed;z-index:2147483001;left:50%;top:8px;transform:translateX(-50%);background:#173a29;color:#fff;border:1px solid #7ba98e;border-radius:999px;padding:7px 12px;font:700 11px Segoe UI,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);max-width:90vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(b);
    }
    b.textContent=`D1 STAGING · Revision ${v9Revision||'—'} · ${text}`;
    b.style.background=kind==='warn'?'#7b5a0b':kind==='bad'?'#8f3030':'#173a29';
  }

  function v9Overlay(text){
    let o=document.getElementById('bppV9BootOverlay');
    if(!o){
      o=document.createElement('div');
      o.id='bppV9BootOverlay';
      o.style.cssText='position:fixed;inset:0;z-index:2147483002;background:rgba(16,38,27,.82);display:grid;place-items:center;padding:24px';
      o.innerHTML='<div style="width:min(560px,94vw);background:white;border-radius:18px;padding:24px;font-family:Segoe UI,Arial,sans-serif;box-shadow:0 24px 70px rgba(0,0,0,.35)"><h2 style="margin:0 0 8px;color:#173a29">Protected Cloud</h2><div id="bppV9BootText" style="color:#41544a;line-height:1.5"></div></div>';
      document.body.appendChild(o);
    }
    const t=document.getElementById('bppV9BootText');if(t)t.textContent=text;
  }
  function v9OverlayClose(){document.getElementById('bppV9BootOverlay')?.remove()}

  function v9SetReadOnly(value,reason=''){
    v9ReadOnly=!!value;
    if(v9ReadOnly)v9Status(reason||'Cloud unavailable — read only','bad');
  }

  async function v9Api(path,options={}){
    const headers={
      'Authorization':'Bearer '+v9Key,
      ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(options.headers||{})
    };
    const r=await fetch(V9_API+path,{cache:'no-store',...options,headers});
    let body={};
    try{body=await r.json()}catch{}
    if(!r.ok){
      const e=new Error(body?.error||('HTTP '+r.status));
      e.status=r.status;e.body=body;throw e;
    }
    return body;
  }

  function v9SaveSafety(prefix,snapshot){
    try{
      const k=prefix+Date.now();
      localStorage.setItem(k,JSON.stringify(snapshot));
      return k;
    }catch(e){console.warn('Could not create safety snapshot',e);return''}
  }

  function v9RenderAll(){
    try{saveLocalOnly()}catch{}
    try{render()}catch(e){console.error(e)}
    try{postRenderEnhancements()}catch{}
    try{auditEnhanceUI()}catch{}
  }

  function v9ApplyRemote(remote,{renderNow=true}={}){
    if(!remote||!remote.initialized||!remote.data)throw new Error('Authoritative production database is not initialized.');
    state=structuredClone(remote.data);
    v9Revision=Number(remote.revision||0);
    v9LastRemote=structuredClone(remote.data);
    v9Dirty=false;
    v9ReadOnly=false;
    try{localStorage.setItem(CLOUD_LAST_SAVE_KEY,String(Date.now()))}catch{}
    try{localStorage.setItem(CLOUD_DIRTY_KEY,'0')}catch{}
    if(renderNow)v9RenderAll();
    v9Status('Data Safe · protected cloud current','ok');
    return state;
  }

  async function v9GetState(){return await v9Api('/api/state',{method:'GET'})}

  async function v9Commit(nextState,reason='Record change',allowDestructive=false,deleteIntent=null){
    if(!v9Ready||v9ReadOnly)throw new Error('Editing is disabled until the protected cloud is verified.');
    if(v9Busy)throw new Error('A protected cloud save is already in progress.');
    v9Busy=true;
    v9Status('Saving protected revision…','warn');
    try{
      const headers={};
      const payload={baseRevision:v9Revision,data:nextState,actor:v9Actor(),reason};
      if(deleteIntent)payload.deleteIntent=deleteIntent;
      if(allowDestructive){
        // Staging-only explicit-delete path. ACCESS_TOKEN and ADMIN_TOKEN are intentionally
        // the same production session during validation. Production will use role-aware delete/archive controls.
        payload.allowDestructive=true;
        headers['X-Admin-Token']=v9Key;
      }
      await v9Api('/api/state',{method:'POST',headers,body:JSON.stringify(payload)});
      const fresh=await v9GetState();
      v9ApplyRemote(fresh);
      return true;
    }catch(e){
      console.error(e);
      if(e.status===409&&e.body?.code==='REVISION_CONFLICT'){
        v9SaveSafety(V9_CONFLICT_PREFIX,nextState);
        v9Status('Save blocked · newer cloud revision exists','warn');
        alert('Another user saved a newer revision first. Your change was NOT uploaded.\n\nA local safety copy of your attempted change was preserved. The latest protected cloud data will now be loaded.');
        try{v9ApplyRemote(await v9GetState())}catch{}
        return false;
      }
      if(e.status===422&&e.body?.code==='INTEGRITY_BLOCK'){
        v9SaveSafety(V9_BLOCKED_PREFIX,nextState);
        v9Status('Save blocked by data-loss protection','warn');
        const friendly=(e.body?.details||[]).map(x=>String(x).replace(/^maintenance count/i,'Work order count').replace(/^violations count/i,'Violation count').replace(/^projects count/i,'Project count').replace(/^inspections count/i,'Inspection count').replace(/^vendors count/i,'Vendor count'));
        alert('The protected cloud blocked this save because records would unexpectedly disappear.\n\nNo cloud data was overwritten.\n\n'+(friendly.join('\n')||e.message));
        try{v9ApplyRemote(await v9GetState())}catch{}
        return false;
      }
      v9SaveSafety(V9_BLOCKED_PREFIX,nextState);
      v9SetReadOnly(true,'Cloud unavailable · unsaved safety copy preserved');
      alert('The cloud save did not complete. No protected cloud data was overwritten. A local safety copy was preserved and editing is now read-only until the cloud reconnects.\n\n'+e.message);
      return false;
    }finally{v9Busy=false}
  }

  function v9QueueSave(reason='Record change'){
    clearTimeout(v9SaveTimer);
    v9SaveTimer=setTimeout(async()=>{
      if(!v9Dirty||v9Busy||v9ReadOnly)return;
      const snap=structuredClone(state);
      await v9Commit(snap,reason,false);
    },350);
  }

  async function v9Refresh(showMessage=false){
    if(v9Busy)return false;
    if(v9Dirty){
      if(showMessage)alert('This browser has an unsaved change. Refresh is blocked until that change is saved or resolved.');
      return false;
    }
    try{
      const remote=await v9GetState();
      v9ApplyRemote(remote);
      if(showMessage)alert('Protected cloud data is current.');
      return true;
    }catch(e){
      v9SetReadOnly(true,'Cloud unavailable · read only');
      if(showMessage)alert('The protected cloud could not be verified. Editing is disabled.\n\n'+e.message);
      return false;
    }
  }

  async function v9Poll(){
    if(!v9Ready||v9Busy||document.hidden)return;
    try{
      const remote=await v9GetState();
      v9ReadOnly=false;
      const rr=Number(remote.revision||0);
      if(rr>v9Revision){
        const dlg=document.getElementById('recordDialog');
        if(v9Dirty||dlg?.open){
          v9Status(`Newer cloud revision ${rr} available · finish or cancel current edit`,'warn');
          return;
        }
        v9ApplyRemote(remote);
        v9Status(`Updated automatically · revision ${v9Revision}`,'ok');
      }else{
        v9Status('Data Safe · protected cloud current','ok');
      }
    }catch(e){
      v9SetReadOnly(true,'Cloud unavailable · read only');
    }
  }

  function v9StartPolling(){
    clearInterval(v9PollTimer);
    v9PollTimer=setInterval(v9Poll,10000);
    setTimeout(v9Poll,1500);
  }

  // Replace the legacy whole-state browser/KV sync functions before the original startup timer fires.
  auditStartSession=async function(){
    if(!v9Ready)return;
    if(originalAuditStartSession)return originalAuditStartSession();
  };
  cloudToken=function(){return v9Key};
  cloudRequireToken=function(){if(!v9Key)throw new Error('Protected production session is not configured.');return v9Key};
  cloudIsSetup=function(){return !!v9Key&&v9Ready};
  cloudIsDirty=function(){return v9Dirty};
  cloudMarkDirty=function(){v9Dirty=true};
  cloudBaseRevision=function(){return v9Revision};
  cloudRemoteRevision=function(data){return Number(data?._sync?.revision||0)};
  cloudRemoteUser=function(data){return String(data?._sync?.updatedBy||'another user')};
  cloudRememberRevision=function(){};
  cloudMarkSynced=function(){v9Dirty=false;try{localStorage.setItem(CLOUD_LAST_SAVE_KEY,String(Date.now()))}catch{}};
  cloudFetch=async function(){const r=await v9GetState();return r.data||null};
  cloudPostUnsafe=async function(){return await v9Commit(structuredClone(state),'Legacy save routed through protected D1',false)};
  cloudPush=async function(){return await v9Commit(structuredClone(state),'Protected cloud save',false)};
  queueCloudSave=function(){v9QueueSave('Record change')};
  cloudPollForUpdates=v9Poll;
  cloudStartPolling=function(){if(v9Ready)v9StartPolling()};
  firstCloudSetup=async function(){return await v9Refresh(true)};
  syncCloudNow=async function(showMessage=true){return await v9Refresh(showMessage)};
  forceUploadToCloud=async function(){alert('Force Upload is disabled in protected production cloud. A browser copy can never blindly replace the authoritative cloud database.');return false};
  forceDownloadFromCloud=async function(){return await v9Refresh(true)};

  saveState=function(){
    if(!v9Ready||v9ReadOnly){
      alert('Editing is currently read-only because the protected cloud has not been verified. No data was changed in the authoritative database.');
      if(v9LastRemote){state=structuredClone(v9LastRemote);v9RenderAll()}
      return false;
    }
    try{
      saveLocalOnly();
      v9Dirty=true;
      try{localStorage.setItem(CLOUD_DIRTY_KEY,'1')}catch{}
      render();postRenderEnhancements();auditEnhanceUI();
      v9Status('Unsaved change · saving…','warn');
      v9QueueSave('Record change');
      return true;
    }catch(e){
      console.error(e);alert('Unable to prepare the protected cloud save. '+e.message);return false;
    }
  };

  cloudSaveNow=async function(reason='Changes'){
    clearTimeout(v9SaveTimer);
    if(!v9Ready||v9ReadOnly){alert('Protected cloud is not verified. This change was not uploaded.');return false}
    try{saveLocalOnly()}catch{}
    v9Dirty=true;
    return await v9Commit(structuredClone(state),reason,false);
  };

  accessPushNow=async function(){
    if(!v9Ready||v9ReadOnly)return false;
    v9Dirty=true;
    return await v9Commit(structuredClone(state),'Authorized user settings changed',false);
  };

  // Explicit delete is treated differently from an accidental shrinking database.
  // Use a delegated capture listener so the delete control remains protected even if the Suite re-renders it.
  // The server still retains the previous revision in history before accepting a protected-module deletion.
  document.addEventListener('click',async function(e){
    const btn=e.target&&e.target.closest?e.target.closest('#deleteRecordBtn'):null;
    if(!btn)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!v9Ready||v9ReadOnly){alert('Deletion is unavailable while protected cloud status is unverified.');return}
    const key=document.getElementById('recordModule')?.value||'';
    const idx=document.getElementById('recordIndex')?.value??'';
    if(idx==='')return;
    const i=Number(idx),rows=Array.isArray(state[key])?state[key]:[];
    const rec=rows[i];if(!rec)return;

    const idFields={maintenance:'id',violations:'caseId',inspections:'inspectionId'};
    const protectedModule=Object.prototype.hasOwnProperty.call(idFields,key);
    const recordId=protectedModule?String(rec?.[idFields[key]]||'').trim():'';
    const label=recordId||rec.project||rec.vendor||'this record';
    const moduleName={maintenance:'Work Order',violations:'Violation',projects:'Project',vendors:'Vendor',inspections:'Inspection'}[key]||'Record';

    if(protectedModule&&!recordId){
      alert('This protected record does not have the ID required for an authorized deletion. Nothing was deleted.');
      return;
    }
    if(!confirm(`Delete ${moduleName} ${label}?\n\nThis permanently removes it from the active cloud data. A protected prior revision remains available for recovery.`))return;

    const copy=structuredClone(state);
    copy[key].splice(i,1);
    const ok=await v9Commit(
      copy,
      `Explicitly deleted ${label}`,
      protectedModule,
      protectedModule?{type:'delete',module:key,recordId}:null
    );
    if(ok){
      document.getElementById('recordDialog')?.close();
      v9Status('Authorized deletion saved to cloud','ok');
    }
  },true);

  async function v9Boot(){
    // Fail closed: a candidate accidentally hosted on a staging or third-party
    // origin must never send authenticated requests to production.
    if(location.origin !== 'https://glwjrmi-prog.github.io' ||
       !location.pathname.startsWith('/brewer-park-place-management-suite/')){
      v9Overlay('Production PIN bridge disabled on this host. No cloud changes can be made.');
      return;
    }
    v9Overlay('Connecting to the protected production database. Editing is disabled until the newest cloud revision is loaded.');
    try{
      // Production PIN login. No shared key is requested or written to localStorage.
      const SESSION_KEY='BPPMS_V9_PRODUCTION_PIN_USER_SESSION';
      const USER_KEY='BPPMS_AUTH_USER_ID';
      async function verifySession(token){
        v9Key=token;
        try { const r=await v9Api('/api/auth/me');return r.user||null; }
        catch { return null; }
      }
      async function showPinLogin(){
        return new Promise((resolve,reject)=>{
          let overlay=document.getElementById('bppV9BootOverlay');
          const card=overlay?.firstElementChild;
          if(!card)return reject(new Error('Login screen unavailable'));
          card.innerHTML='';
          const heading=document.createElement('h2');heading.textContent='BPP Management Suite Sign In';heading.style.color='#173a29';
          const note=document.createElement('p');note.textContent='Enter your authorized name and six-digit PIN.';
          const name=document.createElement('input');name.placeholder='Your name';name.autocomplete='username';
          const pin=document.createElement('input');pin.type='password';pin.inputMode='numeric';pin.maxLength=6;pin.autocomplete='current-password';pin.placeholder='6-digit PIN';
          const error=document.createElement('p');error.style.color='#a33';error.setAttribute('role','alert');
          const button=document.createElement('button');button.textContent='Sign In';
          for(const input of [name,pin]){input.style.cssText='display:block;box-sizing:border-box;width:100%;font-size:16px;padding:11px;margin:10px 0;border:1px solid #aab9ad;border-radius:8px'}
          button.style.cssText='background:#173a29;color:white;border:0;border-radius:8px;padding:12px 24px;cursor:pointer';
          card.append(heading,note,name,pin,error,button);
          const submit=async()=>{
            button.disabled=true;error.textContent='';
            try{
              const response=await fetch(V9_API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value,pin:pin.value}),cache:'no-store'});
              let result={};try{result=await response.json()}catch{}
              pin.value='';
              if(!response.ok||!result.token||!result.user?.id)throw new Error(result.error||'Login unsuccessful');
              sessionStorage.setItem(SESSION_KEY,result.token);
              sessionStorage.setItem(USER_KEY,result.user.id);
              resolve(result.user);
            }catch(e){error.textContent=e.message||'Login failed';button.disabled=false;}
          };
          button.addEventListener('click',submit);
          pin.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit()}});
          name.focus();
        });
      }
      let currentUser=null;
      const saved=sessionStorage.getItem(SESSION_KEY)||'';
      if(saved)currentUser=await verifySession(saved);
      if(!currentUser){
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(USER_KEY);
        currentUser=await showPinLogin();
        if(!await verifySession(sessionStorage.getItem(SESSION_KEY)||''))throw new Error('Session verification failed');
      }
      sessionStorage.setItem(USER_KEY,currentUser.id);
      const remote=await v9GetState();
      // Sign-out must invalidate the server-side session, not just clear the browser's user id.
      accessSignOut=async function(){
        try{await v9Api('/api/auth/logout',{method:'POST'})}catch{}
        v9Key='';sessionStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(USER_KEY);
        location.reload();
      };
      // Switching users also ends the current cloud session.
      auditChangeUser=accessSignOut;
      v9ApplyRemote(remote,{renderNow:true});
      v9Ready=true;v9ReadOnly=false;
      document.title='Brewer Park Place Management Suite — Protected Cloud';
      v9OverlayClose();
      v9StartPolling();
      // The Worker has already verified the user's PIN and established this session.
      // Do not invoke the old browser-side PIN screen: its PIN hashes are deliberately
      // omitted from /api/state responses, and a second login would not work.
      try{
        accessRemoveOverlay?.();
        // Old account/switch-user actions must terminate the verified cloud session.
        accessShowLogin=function(){ accessSignOut(); };
        auditEnhanceUI?.();
      }catch(e){console.warn('Authorized-user UI startup warning',e)}
      v9Status('Data Safe · protected cloud current','ok');
    }catch(e){
      console.error(e);
      v9Ready=false;v9SetReadOnly(true,'Protected cloud unavailable · read only');
      const t=document.getElementById('bppV9BootText');
      if(t)t.textContent='The protected cloud could not be loaded. No editing is allowed. '+e.message;
    }
  }

  v9Boot();
})();
