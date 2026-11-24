'use strict';
// Brewer Park Place / resident intake -> work order.
// OFFLINE TRANSACTION SIMULATOR. This module does not call production APIs.
// Adapt only after inspecting the deployed production API schema, authentication,
// and the current revision/uniqueness transaction boundaries.

function problem(message,code) {
  const e=new Error(message);e.code=code;return e;
}
function requireSource(source,draft) {
  if(!source||!draft||typeof source!=='object'||typeof draft!=='object')throw problem('Missing source or draft','INVALID_SOURCE');
  if(!/^BPP-STG-[a-f0-9-]{36}$/.test(String(source.id||'')))throw problem('Invalid source ID','INVALID_SOURCE');
  if(!/^BPP-DRAFT-[a-f0-9-]{36}$/.test(String(draft.draftId||''))||draft.intakeRequestId!==source.id)
    throw problem('Draft does not match request','INVALID_DRAFT');
  if(source.status!=='reviewed'||source.responsibility!=='association')
    throw problem('Only approved Association requests may be imported','NOT_APPROVED');
  if(typeof source.boardActor!=='string'||!source.boardActor.trim()||typeof source.reviewedAt!=='string'||!Number.isFinite(Date.parse(source.reviewedAt)))
    throw problem('Board review provenance missing','INVALID_REVIEW');
  if(!['routine','high','emergency'].includes(source.priority))
    throw problem('Invalid priority','INVALID_PRIORITY');
  if(typeof source.unit!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9 _./#-]{0,79}$/.test(source.unit))
    throw problem('Invalid location','INVALID_SOURCE');
  if(typeof source.category!=='string'||!source.category.trim()||source.category.length>100)
    throw problem('Invalid category','INVALID_SOURCE');
  if(typeof source.description!=='string'||!source.description.trim()||source.description.length>2000)
    throw problem('Invalid description','INVALID_SOURCE');
  return true;
}
function sourceTag(sourceId){return '[BPP INTAKE '+sourceId+']';}
function nextWorkOrderId(workOrders,year){
  const prefix='WO-'+year+'-';const used=new Set(workOrders.map(w=>String(w.id||'')));
  let max=0;for(const id of used)if(id.startsWith(prefix)&&/^\d+$/.test(id.slice(prefix.length)))max=Math.max(max,Number(id.slice(prefix.length)));
  let n=max+1;while(used.has(prefix+String(n).padStart(3,'0')))n++;
  return prefix+String(n).padStart(3,'0');
}
function alreadyImported(workOrders,sourceId){
  const tag=sourceTag(sourceId);
  return workOrders.find(w=>w.sourceIntakeId===sourceId||String(w.issue||'').includes(tag))||null;
}
function mapRecord(source,draft,workOrders,date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))throw problem('Invalid date','INVALID_DATE');
  const desc=source.description.trim();
  return {
    id:nextWorkOrderId(workOrders,Number(date.slice(0,4))),
    dateOpened:date,dateClosed:'',location:source.unit,
    priority:{routine:'Routine',high:'High',emergency:'Emergency'}[source.priority],
    status:'Open',category:source.category,issue:desc+'\n\n'+sourceTag(source.id)+'\nDraft: '+draft.draftId+'\nBoard reviewed by '+source.boardActor+' at '+source.reviewedAt,
    vendor:'',estimate:'',actual:'',notes:'',documentFolderUrl:'',attachments:[],
    sourceIntakeId:source.id,sourceDraftId:draft.draftId
  };
}
// Two explicit phases. The commit below only modifies a CALLER-SUPPLIED in-memory
// snapshot. A production implementation MUST perform these checks atomically
// inside its actual server-side revision/unique-source transaction.
function previewImport({source,draft,state,date}){
  requireSource(source,draft);
  if(!state||!Number.isSafeInteger(state.revision)||!Array.isArray(state.maintenance))
    throw problem('Invalid destination snapshot','INVALID_STATE');
  const found=alreadyImported(state.maintenance,source.id);
  if(found)return {eligible:false,reason:'ALREADY_IMPORTED',existingId:found.id};
  const record=mapRecord(source,draft,state.maintenance,date);
  return {eligible:true,mode:'PREVIEW_ONLY',baseRevision:state.revision,record};
}
function simulateCommit({source,draft,state,approvedPreview,currentRevision}) {
  requireSource(source,draft);
  if(!approvedPreview||approvedPreview.eligible!==true||approvedPreview.mode!=='PREVIEW_ONLY')
    throw problem('Explicit preview approval required','APPROVAL_REQUIRED');
  if(!Number.isSafeInteger(currentRevision)||currentRevision!==state?.revision||currentRevision!==approvedPreview.baseRevision)
    throw problem('State changed; refresh before approving','REVISION_CONFLICT');
  if(!Array.isArray(state.maintenance))throw problem('Invalid maintenance data','INVALID_STATE');
  const found=alreadyImported(state.maintenance,source.id);
  if(found)return {outcome:'ALREADY_IMPORTED',workOrderId:found.id,nextState:state};
  if(approvedPreview.record.sourceIntakeId!==source.id||approvedPreview.record.sourceDraftId!==draft.draftId)
    throw problem('Preview source mismatch','PREVIEW_MISMATCH');
  const generated=mapRecord(source,draft,state.maintenance,approvedPreview.record.dateOpened);
  if(generated.id!==approvedPreview.record.id||generated.issue!==approvedPreview.record.issue)
    throw problem('Preview no longer matches','PREVIEW_MISMATCH');
  const nextState={...state,revision:state.revision+1,maintenance:[...state.maintenance,structuredClone(generated)]};
  return {outcome:'SIMULATED_ONLY',workOrderId:generated.id,nextState};
}
module.exports={requireSource,sourceTag,nextWorkOrderId,alreadyImported,previewImport,simulateCommit};
