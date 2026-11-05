// Staging safeguard for legacy-record audit provenance.
// Existing pre-audit records may not have a known creator. Do not misattribute
// the first person who edits such a record as the original creator.
(function(){
  'use strict';

  if(typeof auditStamp==='function'){
    auditStamp=function(rec,isNew,actor){
      const now=new Date().toISOString();
      rec.auditTrail=Array.isArray(rec.auditTrail)?rec.auditTrail:[];
      if(isNew){
        rec.createdBy=rec.createdBy||actor;
        rec.createdAt=rec.createdAt||now;
        rec.auditTrail.push({at:now,by:actor,action:'Created'});
      }else{
        rec.auditTrail.push({at:now,by:actor,action:'Modified'});
        // Intentionally leave createdBy/createdAt unchanged when unknown.
        // Legacy records predate the audit system and their creator should not be guessed.
      }
      rec.modifiedBy=actor;
      rec.modifiedAt=now;
      return rec;
    };
  }

  if(typeof auditPanel==='function'){
    auditPanel=function(rec){
      const hist=(Array.isArray(rec.auditTrail)?rec.auditTrail:[]).slice(-8).reverse();
      const creator=rec.createdBy||'Legacy record — original creator not recorded';
      const createdDate=rec.createdAt?auditFmtDate(rec.createdAt):'';
      return `<section class="workOrderSection"><h3>Audit Trail <span>Who created or changed this record</span></h3>
        <div class="auditCard">
          <div class="auditGrid">
            <div class="auditItem"><small>Created By</small><b>${esc(creator)}</b><div class="muted">${esc(createdDate)}</div></div>
            <div class="auditItem"><small>Last Modified By</small><b>${esc(rec.modifiedBy||'—')}</b><div class="muted">${esc(auditFmtDate(rec.modifiedAt))}</div></div>
          </div>
          ${hist.length?`<div class="auditHistory">${hist.map(x=>`<div class="auditHistoryRow"><b>${esc(x.action||'Changed')}</b> by ${esc(x.by||'Unknown')} · ${esc(auditFmtDate(x.at))}</div>`).join('')}</div>`:''}
        </div>
      </section>`;
    };
  }
})();
