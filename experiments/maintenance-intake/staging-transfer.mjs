// BPP — isolated staging transfer preparation. NO network calls or Suite writes.
// Intended for a trusted, authenticated server once a separate staging Suite snapshot exists.
import {prepareApprovedWorkOrder} from './work-order-adapter.mjs';

export function prepareRevisionCheckedTransfer(snapshot,intake,{now=new Date()}={}){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error('Authoritative snapshot envelope required');
 if(snapshot.initialized!==true||!snapshot.data||typeof snapshot.data!=='object')throw new Error('Initialized Suite snapshot required');
 const revision=snapshot.revision;
 if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Valid positive authoritative revision required');
 if(!intake||!Number.isSafeInteger(intake.version)||intake.version<1)throw new Error('Current intake version required');
 // This must be a reviewed, immutable handoff. A resident supplement forces re-review.
 const prepared=prepareApprovedWorkOrder(snapshot.data,intake,{now});
 if(!Array.isArray(prepared.nextState.maintenance)||prepared.nextState.maintenance.length!==snapshot.data.maintenance.length+1)
  throw new Error('Unexpected work-order mutation');
 const baseIds=new Set(snapshot.data.maintenance.map(x=>String(x?.id||'')));
 if(baseIds.has(prepared.workOrder.id))throw new Error('Work-order ID collision');
 if(prepared.nextState.maintenance.filter(x=>x.intakeRequestId===intake.id).length!==1)
  throw new Error('Intake must link to exactly one work order');
 if(JSON.stringify(prepared.nextState.maintenance.slice(0,-1))!==JSON.stringify(snapshot.data.maintenance))
  throw new Error('Existing maintenance rows unexpectedly changed');
 for(const key of Object.keys(snapshot.data)){
  if(key==='maintenance')continue;
  if(JSON.stringify(prepared.nextState[key])!==JSON.stringify(snapshot.data[key]))
   throw new Error('Non-maintenance Suite module unexpectedly changed: '+key);
 }
 // Snapshot revision is the only base revision accepted; state._sync is not authoritative.
 return {
  mode:'staging_preview_only',
  intakeId:intake.id,
  intakeVersion:intake.version,
  expectedSuiteRevision:revision,
  newWorkOrder:prepared.workOrder,
  proposedState:prepared.nextState,
  allowedOperation:'append_one_reviewed_work_order',
  warning:'Preview only. No Suite save or work-order number reservation has occurred.'
 };
}
