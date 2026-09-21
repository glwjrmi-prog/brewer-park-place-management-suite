// Brewer Park Place Management Suite — D1 staging tools cleanup
// Removes legacy browser-vs-cloud recovery choices from the normal user interface.
(function(){
  'use strict';

  function safeText(fn,fallback=''){
    try{return String(fn())}catch{return fallback}
  }

  bppOpenCloudTools=function(){
    try{bppCloseTools()}catch{}

    const overlay=document.createElement('div');
    overlay.id='bppToolsOverlay';
    overlay.className='bppToolsOverlay';

    const backupStatus=safeText(()=>autoBackupStatusText(),'Browser safety backup status unavailable.');
    const keep=safeText(()=>AUTO_BACKUP_KEEP,'7');

    overlay.innerHTML=`<div class="bppToolsCard">
      <div class="bppToolsHead">
        <h3>Backup & Data Safety</h3>
        <button class="secondary" id="bppToolsClose">Close</button>
      </div>
      <div class="bppToolsBody">
        <div class="bppToolsSection">
          <h4>Protected Cloud Database</h4>
          <div class="bppBackupOk">D1 authoritative cloud protection is active.</div>
          <div class="bppToolsNote">The newest protected cloud revision is the source of truth. Older browser copies cannot silently overwrite newer board-member changes, and unexpected record loss is blocked.</div>
        </div>

        <div class="bppToolsSection">
          <h4>Automatic Browser Safety Copies</h4>
          <div class="bppBackupOk">${typeof esc==='function'?esc(backupStatus):backupStatus}</div>
          <div class="bppToolsNote">This device can retain up to ${typeof esc==='function'?esc(keep):keep} daily browser snapshots as an additional recovery layer. These copies never take authority over D1.</div>
        </div>

        <div class="bppToolsSection">
          <h4>Manual Backup</h4>
          <div class="bppToolsNote">Export a downloadable JSON snapshot whenever you want an additional offline copy of the current Management Suite data.</div>
          <div class="bppToolsActions"><button id="bppExportBackup">Export Backup</button></div>
        </div>

        <div class="bppToolsSection">
          <h4>Administration</h4>
          <div class="bppToolsNote">Controlled historical restore and other destructive recovery actions are intentionally not available to normal users. They require an administrator recovery workflow so older data cannot accidentally replace current records.</div>
          <div class="bppToolsActions">
            <button class="secondary" id="bppEditViolationTemplates">Edit Communication Templates</button>
            <button class="secondary" id="bppViewLicense">View Copyright & License</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    document.getElementById('bppToolsClose').onclick=()=>{try{bppCloseTools()}catch{overlay.remove()}};
    overlay.addEventListener('click',e=>{if(e.target===overlay){try{bppCloseTools()}catch{overlay.remove()}}});

    document.getElementById('bppExportBackup').onclick=()=>{
      try{
        markBackupCreated();
        download(`BPP_MS_D1_backup_${today()}.json`,JSON.stringify(state,null,2),'application/json');
        autoBackupRun(true);
        render();
      }catch(e){
        console.error(e);
        alert('The backup could not be created. '+(e?.message||e));
      }
    };

    document.getElementById('bppEditViolationTemplates').onclick=()=>{
      try{bppCloseTools()}catch{}
      try{bppOpenTemplateEditor()}catch(e){alert('Communication Templates could not be opened. '+(e?.message||e))}
    };

    document.getElementById('bppViewLicense').onclick=()=>{
      try{bppCloseTools()}catch{}
      try{bppOpenLicense()}catch(e){alert('Copyright & License could not be opened. '+(e?.message||e))}
    };
  };
})();
