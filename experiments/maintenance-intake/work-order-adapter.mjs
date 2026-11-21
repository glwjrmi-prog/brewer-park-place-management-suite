// PURE, SIDE-EFFECT-FREE preview adapter. No network/database access or writes.
// Use only after human board approval, and only from a trusted backend with a fresh,
// revision-checked staging state. Production integration is deliberately excluded.
const categories = new Set(['Exterior trim / paint','Siding','Roof / gutters','Doors / windows','Landscaping / grounds','Drainage / water','Sidewalk / pavement','Other']);
const priorities = {routine:'Routine',high:'High',emergency:'Emergency'};
export function nextWorkOrderId(records, date=new Date()){
  const year=date.getUTCFullYear(), prefix='WO-'+year+'-', re=new RegExp('^WO-'+year+'-(\\d+)$','i');
  let max=0; for(const row of records||[]){const match=String(row?.id||'').match(re);if(match)max=Math.max(max,Number(match[1])||0);}
  return prefix+String(max+1).padStart(3,'0');
}
export function prepareApprovedWorkOrder(state, intake, options={}){
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('A valid current Suite state is required.');
  if(!Array.isArray(state.maintenance))throw new Error('Suite maintenance array is missing.');
  if(!intake||intake.status!=='reviewed'||!intake.boardActor||!intake.reviewedAt)throw new Error('Board-reviewed intake with reviewer/time is required.');
  if(!['association','shared_or_disputed'].includes(intake.responsibility))throw new Error('Owner-only or unclear requests must not automatically enter the HOA work queue.');
  if(!Object.hasOwn(priorities,intake.priority))throw new Error('Invalid priority.');
  if(!categories.has(intake.category)||!String(intake.description||'').trim()||!String(intake.unit||'').trim())throw new Error('Incomplete intake.');
  if(!/^BPP-STG-[a-f0-9-]{36}$/.test(String(intake.id||'')))throw new Error('Invalid staging intake ID.');
  if(state.maintenance.some(row=>String(row?.intakeRequestId||'')===intake.id))throw new Error('Intake already linked to a Suite work order.');
  const date=options.now instanceof Date?options.now:new Date();
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid date.');
  const workOrder={
    id:nextWorkOrderId(state.maintenance,date),
    status:'Waiting on Board',
    dateOpened:date.toISOString().slice(0,10),
    dateClosed:'',
    location:String(intake.unit).trim().slice(0,120),
    priority:priorities[intake.priority],
    vendor:'',estimate:'',actual:'',
    category:intake.category,
    documentFolderUrl:'',
    issue:String(intake.description).trim().slice(0,2000),
    notes:'Resident intake '+intake.id+' | Board review by '+String(intake.boardActor).slice(0,120)+' on '+intake.reviewedAt+' | Responsibility: '+intake.responsibility+' | No work authorized until normal board/vendor approval.',
    intakeRequestId:intake.id,
    intakeBoardReviewedAt:intake.reviewedAt
  };
  const next=structuredClone(state);
  next.maintenance.push(workOrder);
  return {workOrder,nextState:next,requiredBaseRevision:Number(state?._sync?.revision||0),mode:'preview_only'};
}
