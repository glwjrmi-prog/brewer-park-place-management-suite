const API='https://bpp-management-suite-staging-api.glwjrmi.workers.dev';
let key='';
let actor='';
let state=null;
let revision=0;
let busy=false;
let editingIndex=null;
let pollTimer=null;

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function authHeaders(extra={}){return {'Authorization':'Bearer '+key,...extra}}
function setStatus(text,kind=''){const el=$('cloudStatus');el.textContent=text;el.className='pill '+kind}
function fmtWhen(v){if(!v)return '—';try{return new Date(v).toLocaleString()}catch{return String(v)}}
function arr(k){return Array.isArray(state?.[k])?state[k]:[]}

async function api(path,opts={}){
  const res=await fetch(API+path,{cache:'no-store',...opts,headers:authHeaders(opts.headers||{})});
  let body={};
  try{body=await res.json()}catch{}
  if(!res.ok){const e=new Error(body?.error||('HTTP '+res.status));e.status=res.status;e.body=body;throw e}
  return body;
}

async function connect(){
  actor=$('actorInput').value.trim()||'Staging user';
  key=$('keyInput').value.trim();
  if(!key){$('loginMsg').textContent='Enter the staging key.';return}
  $('loginMsg').textContent='Connecting…';
  try{
    const r=await api('/api/state');
    if(!r.initialized)throw new Error('Staging database is not initialized.');
    applyRemote(r);
    $('login').style.display='none';
    startPolling();
  }catch(e){$('loginMsg').textContent=e.message||'Unable to connect.'}
}

function applyRemote(r){
  state=r.data;
  revision=Number(r.revision||0);
  $('revisionStatus').textContent='Revision '+revision;
  $('lastSaved').textContent='Last saved '+fmtWhen(r.updatedAt);
  $('updatedBy').textContent='Updated by '+(r.updatedBy||'—');
  setStatus('Data Safe · cloud current','ok');
  renderCounts();renderWorkOrders();
}

function renderCounts(){
  $('woCount').textContent=arr('maintenance').length;
  $('violationCount').textContent=arr('violations').length;
  $('projectCount').textContent=arr('projects').length;
  $('inspectionCount').textContent=arr('inspections').length;
  $('vendorCount').textContent=arr('vendors').length;
}

function renderWorkOrders(){
  const q=$('search').value.trim().toLowerCase();
  const rows=arr('maintenance').map((r,i)=>({r,i})).filter(({r})=>{
    if(!q)return true;
    return [r.id,r.location,r.issue,r.vendor,r.status].some(v=>String(v||'').toLowerCase().includes(q));
  });
  $('woBody').innerHTML=rows.map(({r,i})=>`<tr data-i="${i}"><td><b>${esc(r.id)}</b></td><td>${esc(r.dateOpened||'')}</td><td>${esc(r.location||'')}</td><td>${esc(r.issue||'')}</td><td>${esc(r.status||'')}</td><td>${esc(r.vendor||'')}</td><td>${r.actual?('$'+esc(r.actual)):'—'}</td></tr>`).join('');
  document.querySelectorAll('#woBody tr').forEach(tr=>tr.onclick=()=>openWorkOrder(Number(tr.dataset.i)));
}

function nextWorkOrderId(){
  const year=new Date().getFullYear();
  let max=0;
  for(const r of arr('maintenance')){
    const m=String(r.id||'').match(/^WO-(\d{4})-(\d+)$/);
    if(m&&Number(m[1])===year)max=Math.max(max,Number(m[2]));
  }
  return `WO-${year}-${String(max+1).padStart(3,'0')}`;
}

function openWorkOrder(i){
  editingIndex=i;
  const r=arr('maintenance')[i];
  fillForm(r);
  $('dlgTitle').textContent='Edit '+(r.id||'Work Order');
  $('woDialog').showModal();
}

function newWorkOrder(){
  editingIndex=-1;
  fillForm({id:nextWorkOrderId(),status:'Open',dateOpened:new Date().toISOString().slice(0,10),priority:'Routine',attachments:[]});
  $('dlgTitle').textContent='New Work Order';
  $('woDialog').showModal();
}

function fillForm(r){
  $('fId').value=r.id||'';$('fStatus').value=r.status||'Open';$('fOpened').value=r.dateOpened||'';$('fClosed').value=r.dateClosed||'';$('fLocation').value=r.location||'';$('fPriority').value=r.priority||'Routine';$('fVendor').value=r.vendor||'';$('fActual').value=r.actual||'';$('fIssue').value=r.issue||'';$('fNotes').value=r.notes||'';
}

async function saveWorkOrder(){
  if(busy)return;
  busy=true;$('saveWoBtn').disabled=true;setStatus('Saving…','warn');
  const copy=structuredClone(state);
  const current=editingIndex>=0?copy.maintenance[editingIndex]:{attachments:[]};
  const edited={...current,id:$('fId').value.trim(),status:$('fStatus').value,dateOpened:$('fOpened').value,dateClosed:$('fClosed').value,location:$('fLocation').value.trim(),priority:$('fPriority').value,vendor:$('fVendor').value.trim(),actual:$('fActual').value,issue:$('fIssue').value.trim(),notes:$('fNotes').value.trim()};
  if(editingIndex>=0)copy.maintenance[editingIndex]=edited;else copy.maintenance.push(edited);
  try{
    const result=await api('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:revision,actor,reason:(editingIndex>=0?'Updated ':'Created ')+edited.id,data:copy})});
    const fresh=await api('/api/state');applyRemote(fresh);$('woDialog').close();
  }catch(e){
    if(e.status===409){setStatus('Save blocked · newer cloud revision exists','bad');alert('Another user saved a newer revision first. Your change was NOT uploaded. The latest cloud data will now be loaded.');try{applyRemote(await api('/api/state'))}catch{} }
    else if(e.status===422){setStatus('Save blocked by integrity protection','bad');alert('The server blocked this save to protect existing data.\n\n'+((e.body?.details||[]).join('\n')||e.message));}
    else{setStatus('Cloud unavailable · read only','bad');alert('Save failed. No cloud data was overwritten. '+e.message)}
  }finally{busy=false;$('saveWoBtn').disabled=false}
}

async function refresh(){
  if(busy)return;
  try{setStatus('Checking cloud…','warn');applyRemote(await api('/api/state'))}catch(e){setStatus('Cloud unavailable · read only','bad')}
}

async function showHistory(){
  try{
    const h=await api('/api/history?limit=25');
    const rows=[];
    if(h.current)rows.push({...h.current,isCurrent:true,savedAt:h.current.updatedAt,savedBy:h.current.updatedBy});
    for(const r of (h.history||[]))rows.push(r);
    $('historyBody').innerHTML=rows.map(r=>`<tr><td><b>${esc(r.revision)}</b>${r.isCurrent?' · current':''}</td><td class="historyMeta">${esc(fmtWhen(r.savedAt))}</td><td>${esc(r.savedBy||'')}</td><td>${esc(r.reason||'')}</td><td>${esc(r.counts?.maintenance??'')}</td><td>${esc(r.counts?.violations??'')}</td></tr>`).join('');
    $('historyPanel').hidden=false;$('historyPanel').scrollIntoView({behavior:'smooth'});
  }catch(e){alert('Could not load history: '+e.message)}
}

function startPolling(){
  clearInterval(pollTimer);
  pollTimer=setInterval(async()=>{
    if(busy||$('woDialog').open||document.hidden)return;
    try{
      const r=await api('/api/state');
      if(Number(r.revision)>revision)applyRemote(r);
      else setStatus('Data Safe · cloud current','ok');
    }catch{setStatus('Cloud unavailable · read only','bad')}
  },10000);
}

function signOut(){key='';actor='';state=null;revision=0;clearInterval(pollTimer);$('keyInput').value='';$('loginMsg').textContent='';$('login').style.display='grid';setStatus('Not connected','warn')}

$('connectBtn').onclick=connect;
$('keyInput').addEventListener('keydown',e=>{if(e.key==='Enter')connect()});
$('refreshBtn').onclick=refresh;
$('historyBtn').onclick=showHistory;
$('closeHistoryBtn').onclick=()=>{$('historyPanel').hidden=true};
$('signOutBtn').onclick=signOut;
$('search').oninput=renderWorkOrders;
$('newWorkOrderBtn').onclick=newWorkOrder;
$('dlgClose').onclick=()=>$('woDialog').close();
$('saveWoBtn').onclick=saveWorkOrder;
