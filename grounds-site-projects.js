/* Brewer Park Place Management Suite: Grounds & Site Projects module. */
(function () {
  'use strict';
  if (window.__bppGroundsProjectsLoaded) return;
  window.__bppGroundsProjectsLoaded = true;

  const categories = ['Landscaping', 'Irrigation', 'Drainage', 'Pavement', 'Lighting', 'Signage', 'Snow / Ice', 'Other'];
  const statuses = ['Planning', 'Bidding', 'Scheduled', 'In Progress', 'Waiting on Vendor', 'On Hold', 'Complete', 'Cancelled'];
  const priorities = ['Routine', 'High', 'Emergency'];
  const fields = [
    ['project', 'Project name', 'text', true],
    ['category', 'Category', 'select', true, categories],
    ['area', 'Property area / location', 'text', true],
    ['status', 'Status', 'select', true, statuses],
    ['priority', 'Priority', 'select', true, priorities],
    ['assignedManager', 'Assigned manager', 'text'],
    ['vendor', 'Vendor', 'text'],
    ['startDate', 'Start date', 'date'],
    ['dueDate', 'Target completion', 'date'],
    ['budget', 'Approved budget ($)', 'number'],
    ['actual', 'Actual cost ($)', 'number'],
    ['workOrderRef', 'Related work order', 'text'],
    ['scope', 'Scope / description', 'textarea'],
    ['nextAction', 'Next action', 'textarea'],
    ['notes', 'Notes', 'textarea']
  ];

  const escHtml = value => typeof esc === 'function' ? esc(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = () => {
    if (!Array.isArray(state.groundsProjects)) state.groundsProjects = [];
    return state.groundsProjects;
  };
  const fmtMoney = value => {
    const n = Number(value || 0);
    return n ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—';
  };
  const dateText = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
  const uniqueId = () => {
    const n = Math.max(0, ...list().map(r => Number(String(r.id || '').match(/\d+/)?.[0] || 0))) + 1;
    return `GSP-${String(n).padStart(3, '0')}`;
  };
  const getDialog = () => {
    let d = document.getElementById('groundsProjectDialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'groundsProjectDialog';
    d.className = 'modal';
    d.innerHTML = `<form id="groundsProjectForm" method="dialog"><div class="modalHeader"><div><h2 id="groundsProjectTitle">New grounds project</h2><div class="muted">Grounds and shared outdoor property work</div></div><button class="iconBtn" type="button" id="groundsProjectClose" aria-label="Close">×</button></div><div class="formGrid" id="groundsProjectFields"></div><div class="modalActions"><span class="muted" id="groundsProjectHistory"></span><span></span><button class="secondary" type="button" id="groundsProjectCancel">Cancel</button><button type="submit">Save project</button></div></form>`;
    document.body.appendChild(d);
    d.querySelector('#groundsProjectClose').onclick = () => d.close();
    d.querySelector('#groundsProjectCancel').onclick = () => d.close();
    d.querySelector('form').addEventListener('submit', saveForm);
    return d;
  };
  const fieldHtml = ([key, label, type, required, options]) => {
    const wide = type === 'textarea' ? ' wide' : '';
    let control = '';
    if (type === 'select') control = `<select name="${key}" ${required ? 'required' : ''}>${options.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('')}</select>`;
    else if (type === 'textarea') control = `<textarea name="${key}" ${required ? 'required' : ''}></textarea>`;
    else control = `<input name="${key}" type="${type}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" step="0.01"' : ''}>`;
    return `<label class="${wide}">${escHtml(label)}${control}</label>`;
  };
  function openEditor(id) {
    const record = list().find(r => r.id === id) || { status: 'Planning', priority: 'Routine', category: 'Landscaping', history: [] };
    const dialog = getDialog();
    dialog.dataset.recordId = record.id || '';
    dialog.querySelector('#groundsProjectTitle').textContent = record.id ? `Edit ${record.id}` : 'New grounds project';
    dialog.querySelector('#groundsProjectFields').innerHTML = fields.map(fieldHtml).join('');
    for (const [key] of fields) {
      const input = dialog.querySelector(`[name="${key}"]`);
      if (input) input.value = record[key] ?? '';
    }
    const history = Array.isArray(record.history) ? record.history : [];
    dialog.querySelector('#groundsProjectHistory').textContent = record.id && history.length ? `Last updated ${new Date(history[history.length - 1].at).toLocaleString()}` : 'Changes are saved to the protected suite record.';
    dialog.showModal();
  }
  function saveForm(event) {
    event.preventDefault();
    const dialog = getDialog();
    const formData = new FormData(event.currentTarget);
    const existingId = dialog.dataset.recordId;
    const prior = list().find(r => r.id === existingId);
    const next = { ...(prior || {}), id: existingId || uniqueId() };
    for (const [key] of fields) next[key] = String(formData.get(key) || '').trim();
    next.budget = next.budget ? Number(next.budget) : '';
    next.actual = next.actual ? Number(next.actual) : '';
    next.history = Array.isArray(prior?.history) ? prior.history.slice() : [];
    next.history.push({ at: new Date().toISOString(), status: next.status, note: prior ? 'Project details updated' : 'Project created' });
    next.updatedAt = new Date().toISOString();
    const rows = list();
    const index = rows.findIndex(r => r.id === next.id);
    if (index >= 0) rows[index] = next; else rows.push(next);
    dialog.close();
    saveState();
    renderGroundsProjects();
  }
  function exportCsv() {
    const headers = ['ID', ...fields.map(f => f[1])];
    const keys = ['id', ...fields.map(f => f[0])];
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...list().map(r => keys.map(k => r[k] ?? ''))].map(row => row.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `BPP_Grounds_Site_Projects_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function renderGroundsProjects() {
    if (activeView !== 'grounds') return;
    const rows = list();
    const open = rows.filter(r => !['Complete', 'Cancelled'].includes(r.status)).length;
    const due = rows.filter(r => r.dueDate && r.dueDate < new Date().toISOString().slice(0,10) && !['Complete', 'Cancelled'].includes(r.status)).length;
    document.getElementById('viewRoot').innerHTML = `${renderTopBar('Grounds & Site Projects', '<button id="groundsAddBtn">+ New Project</button><button id="groundsExportBtn" class="secondary">Export CSV</button>')}<div class="groundsIntro"><b>Manage work across the shared property.</b><span>Track landscaping, irrigation, drainage, pavement, lighting, signage, and snow or ice projects separately from building projects.</span></div><div class="kpis">${kpi(rows.length, 'Total Projects')}${kpi(open, 'Open / Active')}${kpi(due, 'Past Due')}${kpi(rows.filter(r => r.status === 'Complete').length, 'Complete')}</div><div class="toolbar standardToolbar"><div class="toolbarGroup"><span class="toolbarLabel">Find & Filter</span><input id="groundsSearch" class="search" placeholder="Search projects, areas, managers, vendors..."><select id="groundsCategory" class="filter"><option value="">All categories</option>${categories.map(c=>`<option>${escHtml(c)}</option>`).join('')}</select><select id="groundsStatus" class="filter"><option value="">All statuses</option>${statuses.map(s=>`<option>${escHtml(s)}</option>`).join('')}</select><button id="groundsClear" class="secondary clearFilters">Clear</button></div><div class="muted" id="groundsCount"></div></div><div class="tablewrap standardTable"><table><thead><tr><th>Project / Area</th><th>Category</th><th>Status</th><th>Manager / Vendor</th><th>Target</th><th>Budget / Actual</th><th>Work Order</th><th>Recent activity</th><th>Action</th></tr></thead><tbody id="groundsRows"></tbody></table></div><div id="groundsEmpty" class="empty hidden">No grounds projects match these filters.</div>`;
    document.getElementById('groundsAddBtn').onclick = () => openEditor('');
    document.getElementById('groundsExportBtn').onclick = exportCsv;
    document.getElementById('groundsClear').onclick = () => { ['groundsSearch','groundsCategory','groundsStatus'].forEach(id => document.getElementById(id).value = ''); draw(); };
    ['groundsSearch','groundsCategory','groundsStatus'].forEach(id => { const el = document.getElementById(id); el.oninput = el.onchange = draw; });
    function draw() {
      const q = document.getElementById('groundsSearch').value.trim().toLowerCase();
      const cat = document.getElementById('groundsCategory').value;
      const status = document.getElementById('groundsStatus').value;
      const filtered = rows.filter(r => (!q || [r.project,r.area,r.assignedManager,r.vendor,r.workOrderRef,r.scope].some(v => String(v||'').toLowerCase().includes(q))) && (!cat || r.category === cat) && (!status || r.status === status)).slice().sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
      document.getElementById('groundsCount').textContent = `${filtered.length} of ${rows.length} projects`;
      document.getElementById('groundsEmpty').classList.toggle('hidden', filtered.length > 0);
      document.getElementById('groundsRows').innerHTML = filtered.map(r => {
        const last = (r.history||[]).slice(-1)[0];
        const overdue = r.dueDate && r.dueDate < new Date().toISOString().slice(0,10) && !['Complete','Cancelled'].includes(r.status);
        return `<tr><td><b>${escHtml(r.project)}</b><span class="recordSecondary">${escHtml(r.id)} · ${escHtml(r.area)}</span></td><td>${escHtml(r.category)}</td><td><span class="pill ${escHtml(r.status)}">${escHtml(r.status)}</span>${overdue ? '<span class="pill Overdue">Past Due</span>' : ''}</td><td>${escHtml(r.assignedManager||'—')}<span class="recordSecondary">${escHtml(r.vendor||'')}</span></td><td class="dateCell">${dateText(r.dueDate)}</td><td class="moneyCell">${fmtMoney(r.budget)}<span class="recordSecondary">Actual ${fmtMoney(r.actual)}</span></td><td>${escHtml(r.workOrderRef||'—')}</td><td>${last ? `${new Date(last.at).toLocaleDateString()}: ${escHtml(last.note)}` : '—'}</td><td><button class="secondary groundsEditBtn" data-id="${escHtml(r.id)}">Edit</button></td></tr>`;
      }).join('');
      document.querySelectorAll('.groundsEditBtn').forEach(b => b.onclick = () => openEditor(b.dataset.id));
    }
    draw();
  }

  const originalShell = shell;
  shell = function () {
    return originalShell().replace('</nav>', '<button class="navBtn" data-view="grounds"><span>🌳</span>Grounds &amp; Site Projects</button></nav>');
  };
  const originalRender = render;
  render = function () {
    originalRender();
    if (activeView === 'grounds') renderGroundsProjects();
  };

  const style = document.createElement('style');
  style.textContent = '.groundsIntro{display:grid;gap:3px;margin:0 0 14px;padding:14px 16px;border:1px solid var(--line);border-left:5px solid var(--green2);border-radius:15px;background:#fff;box-shadow:var(--shadow)}.groundsIntro span{font-size:13px;line-height:1.5;color:var(--muted)}#groundsProjectDialog{z-index:10000}#groundsProjectDialog .formGrid{max-height:65vh;overflow:auto}#groundsProjectDialog .modalActions{grid-template-columns:1fr auto auto auto}@media(max-width:900px){#groundsProjectDialog .modalActions{grid-template-columns:1fr 1fr}.groundsIntro{font-size:14px}}';
  document.head.appendChild(style);
  render();
})();
