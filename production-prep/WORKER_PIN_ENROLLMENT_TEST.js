// ISOLATED WORKER TEST HARNESS ONLY — NEVER DEPLOY ON PRODUCTION HOST.
// Uses the hardcoded test Worker hostname plus TEST_MODE=enabled gate.
// RESEARCH PROTOTYPE — NOT APPROVED FOR PRODUCTION.
// Requires server-only PIN_PEPPER (>=32 random chars) in Cloudflare secrets.
// Legacy fast PIN hashes still exist in state history, and shared ACCESS_TOKEN bypass remains.
// No live deployment until both are retired, full UI is verified, and backups completed.
// REVIEW REQUIRED: credentials migrate on next successful login; legacy SHA hashes
// remain in authoritative state until a separate, coordinated credentials-only reset.
// Do not claim complete at-rest migration from this change alone.
// Requires idempotent additive migration in production-prep/SCHEMA_V2.sql.
// MUST test against a non-production D1 clone before any production deployment.
// Brewer Park Place Management Suite v9 — AUTHENTICATION HARDENING CANDIDATE (NOT DEPLOYABLE)
// Cloudflare Worker + D1 authoritative-state service.
//
// Required bindings/secrets:
//   DB                D1 database binding
//   ACCESS_TOKEN      bearer token used by the Management Suite client
//   ADMIN_TOKEN       separate secret for bootstrap/restore/destructive admin actions
//   ALLOWED_ORIGINS   comma-separated origins, e.g.
//                     https://glwjrmi-prog.github.io
//
// This worker intentionally stores NO real data in source control.

const API_VERSION = "bpp-v9-peppered-pin-experiment-not-for-production";
const AUTH_SESSION_SECONDS = 8 * 60 * 60;
const PBKDF2_ITERATIONS = 100000;
const PROTECTED_COLLECTIONS = ["maintenance", "violations", "projects", "inspections", "vendors", "groundsProjects", "knowledgeBase"];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const cors = corsHeaders(request, env);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      if (url.pathname === "/health") {
        return json({ ok: true, service: API_VERSION }, 200, cors);
      }

      // Hard-bound to the existing ISOLATED test Worker hostname.
      // Never expose test routes on a production Worker.
      const isolated = url.hostname==='bpp-pin-integration-test-api.glwjrmi.workers.dev' &&
        env.TEST_MODE==='enabled';
      if (isolated && url.pathname==='/test-enroll' && request.method==='GET')
        return new Response(testEnrollmentHtml(),{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});
      if (isolated && url.pathname==='/test/confirm' && request.method==='POST') {
        const user=await authenticateSession(request,env);
        if(!user)return json({ok:false,error:'Valid test PIN session required'},401,cors);
        const state=await currentRow(env);
        await env.DB.prepare("INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('test-enrollment-confirmed',?,?,?,?)")
          .bind(Number(state.revision),user.name,new Date().toISOString(),JSON.stringify({userId:user.id})).run();
        return json({ok:true,confirmedTestAccount:user.id},200,cors);
      }
      if (isolated && url.pathname==='/test/scrub' && request.method==='POST') {
        const user=await authenticateSession(request,env);
        if (!user || user.role!=='admin')
          return json({ok:false,error:'Test administrator login required'},403,cors);
        return scrubSyntheticCredentials(env,cors);
      }
      if (!originAllowed(request, env)) {
        return json({ ok: false, error: "Origin not allowed" }, 403, cors);
      }

      // Individual PIN authentication; the shared ACCESS_TOKEN remains for legacy rollback.
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if (typeof env.PIN_PEPPER !== 'string' || env.PIN_PEPPER.length < 32) return json({ok:false,error:'Authentication configuration unavailable'},503,cors);
        return loginWithPin(request, env, cors);
      }
      const legacy = env.LEGACY_ADMIN_ROLLBACK === 'enabled' && authorized(request, env.ACCESS_TOKEN);
      const principal = legacy ? { id: "legacy-admin", name: "Legacy Administrator", role: "admin", legacy: true } : await authenticateSession(request, env);
      if (!principal) return json({ ok: false, error: "Unauthorized" }, 401, cors);
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return json({ ok: true, user: {...publicUser(principal),canViewActivity:!!env.SYSTEM_ADMIN_USER_ID && principal.id===env.SYSTEM_ADMIN_USER_ID} }, 200, cors);
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        if (!legacy) await revokeSession(request, env);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/api/admin/user-create" && request.method === "POST") {
        if (principal.legacy || principal.role !== 'admin')
          return json({ok:false,error:'Administrator PIN session required'},403,cors);
        return createCredentialUser(request,env,cors,principal);
      }
      if (url.pathname === "/api/admin/activity" && request.method === "GET") {
        if (!env.SYSTEM_ADMIN_USER_ID || principal.id !== env.SYSTEM_ADMIN_USER_ID)
          return json({ok:false,error:'System administrator only'},403,cors);
        return readAdminActivity(url,env,cors);
      }
      if (url.pathname === "/api/admin/pin-reset" && request.method === "POST") {
        if (principal.legacy || principal.role !== 'admin') {
          return json({ok:false,error:'Administrator PIN session required'},403,cors);
        }
        return resetUserPin(request,env,cors,principal);
      }

      if (url.pathname === "/api/state" && request.method === "GET") {
        return getState(env, cors, principal);
      }

      if (url.pathname === "/api/state" && request.method === "POST") {
        return saveState(request, env, cors, principal);
      }

      if (url.pathname === "/api/history" && request.method === "GET") {
        return getHistory(url, env, cors);
      }

      const historyMatch = url.pathname.match(/^\/api\/history\/(\d+)$/);
      if (historyMatch && request.method === "GET") {
        return getRevision(Number(historyMatch[1]), env, cors, principal);
      }

      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        if (!principal.legacy || !adminAuthorized(request, env.ADMIN_TOKEN)) {
          return json({ ok: false, error: "Administrator authorization required" }, 403, cors);
        }
        return bootstrap(request, env, cors);
      }

      if (url.pathname === "/api/restore" && request.method === "POST") {
        if (!principal.legacy || !adminAuthorized(request, env.ADMIN_TOKEN)) {
          return json({ ok: false, error: "Administrator authorization required" }, 403, cors);
        }
        return restoreRevision(request, env, cors);
      }

      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: "Server error" }, 500, corsHeaders(request, env));
    }
  }
};

function safeError(err) {
  const msg = String(err?.message || err || "Unknown error");
  return msg.slice(0, 500);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function configuredOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

// Allow only HTTPS preview subdomains belonging to this specific staging Pages project.
// This does NOT permit arbitrary *.pages.dev websites or the production API.
function permittedOrigin(origin, env) {
  // Production: exact allowlist only. Never inherit staging preview wildcard.
  return !!origin && origin !== 'null' && configuredOrigins(env).includes(origin);
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // direct API tools/curl
  return permittedOrigin(origin, env);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = origin && permittedOrigin(origin, env) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function timingSafeEqualText(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function bearer(request) {
  const h = String(request.headers.get("Authorization") || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function authorized(request, secret) {
  return timingSafeEqualText(bearer(request), secret);
}

function adminAuthorized(request, secret) {
  return timingSafeEqualText(request.headers.get("X-Admin-Token"), secret);
}

function actorName(value) {
  return String(value || "Unknown user").trim().slice(0, 120) || "Unknown user";
}

function reasonText(value) {
  return String(value || "Normal save").trim().slice(0, 300) || "Normal save";
}

function arrayOf(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function activityRecordChanges(before, after) {
  // Store field names and safe operational values; no complete resident notes,
  // contact details, user PINs or document URLs in the activity event.
  const ids={maintenance:'id',projects:'id',groundsProjects:'id',
    vendors:'vendor',violations:'caseId',inspections:'inspectionId',knowledgeBase:'id'};
  const safeValues=new Set(['status','priority','dateClosed','dateOpened','actual','estimate']);
  const changes=[];
  for(const [module,idKey] of Object.entries(ids)){
    const oldRows=arrayOf(before,module),newRows=arrayOf(after,module);
    const old=new Map(oldRows.map((r,i)=>[String(r?.[idKey]||'#'+i),r]));
    const next=new Map(newRows.map((r,i)=>[String(r?.[idKey]||'#'+i),r]));
    for(const [id,record] of next){
      const previous=old.get(id);
      if(!previous){changes.push({module,id,action:'created'});continue}
      const fields=[];
      for(const key of new Set([...Object.keys(previous),...Object.keys(record)])){
        if(key==='auditTrail'||key==='modifiedBy'||key==='modifiedAt')continue;
        if(JSON.stringify(previous[key])===JSON.stringify(record[key]))continue;
        const field={field:key};
        if(safeValues.has(key)){
          field.before=String(previous[key]??'').slice(0,80);
          field.after=String(record[key]??'').slice(0,80);
        }
        fields.push(field);
      }
      if(fields.length)changes.push({module,id,action:'modified',fields:fields.slice(0,30)});
    }
    for(const id of old.keys())if(!next.has(id))changes.push({module,id,action:'deleted'});
  }
  return changes.slice(0,150);
}
function recordCounts(data) {
  const out = {};
  for (const key of PROTECTED_COLLECTIONS) out[key] = arrayOf(data, key).length;
  return out;
}

function keySet(data, collection, field) {
  return new Set(
    arrayOf(data, collection)
      .map(x => String(x?.[field] || "").trim())
      .filter(Boolean)
  );
}

function duplicates(data, collection, field) {
  const seen = new Set();
  const dupes = new Set();
  for (const row of arrayOf(data, collection)) {
    const id = String(row?.[field] || "").trim();
    if (!id) continue;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

function missingKeys(current, proposed, collection, field) {
  const before = keySet(current, collection, field);
  const after = keySet(proposed, collection, field);
  return [...before].filter(id => !after.has(id));
}

function validateShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["Data must be a JSON object."];
  }
  const errors = [];
  for (const key of PROTECTED_COLLECTIONS) {
    if (data[key] != null && !Array.isArray(data[key])) {
      errors.push(`${key} must be an array.`);
    }
  }
  const woDupes = duplicates(data, "maintenance", "id");
  const violationDupes = duplicates(data, "violations", "caseId");
  const inspectionDupes = duplicates(data, "inspections", "inspectionId");
  if (woDupes.length) errors.push(`Duplicate work-order IDs: ${woDupes.join(", ")}`);
  if (violationDupes.length) errors.push(`Duplicate violation IDs: ${violationDupes.join(", ")}`);
  if (inspectionDupes.length) errors.push(`Duplicate inspection IDs: ${inspectionDupes.join(", ")}`);
  return errors;
}

// Production compatibility: the old UI supports a confirmed single-record delete.
// This is intentionally narrower than an unrestricted destructive state upload.
// It is accepted only for a logged-in administrator (or the temporary legacy key).
function confirmedSingleDelete(beforeData, afterData, body) {
  if (body?.allowDestructive !== true) return false;
  const intent=body?.deleteIntent;
  if (!intent || intent.type !== 'delete') return false;
  const fields={maintenance:'id',violations:'caseId',inspections:'inspectionId'};
  const field=fields[intent.module];
  const id=String(intent.recordId||'').trim();
  if (!field||!id) return false;
  const before=arrayOf(beforeData,intent.module);
  const after=arrayOf(afterData,intent.module);
  if (before.length !== after.length+1) return false;
  if (before.filter(r=>String(r?.[field]||'').trim()===id).length!==1) return false;
  if (after.some(r=>String(r?.[field]||'').trim()===id)) return false;
  // A delete request must not mutate other records in the deleted collection
  // or any other protected collection.
  for(const name of PROTECTED_COLLECTIONS) {
    const oldRows=arrayOf(beforeData,name);
    const newRows=arrayOf(afterData,name);
    if (name===intent.module) {
      const preserved=oldRows.filter(r=>String(r?.[field]||'').trim()!==id);
      if (JSON.stringify(preserved)!==JSON.stringify(newRows)) return false;
    } else if (JSON.stringify(oldRows)!==JSON.stringify(newRows)) return false;
  }
  return true;
}

function destructiveDifferences(current, proposed) {
  const issues = [];
  const before = recordCounts(current);
  const after = recordCounts(proposed);

  for (const key of PROTECTED_COLLECTIONS) {
    if (after[key] < before[key]) {
      issues.push(`${key} count would drop from ${before[key]} to ${after[key]}`);
    }
  }

  const identityChecks = [
    ["maintenance", "id", "work orders"],
    ["violations", "caseId", "violations"],
    ["inspections", "inspectionId", "inspections"]
  ];

  for (const [collection, field, label] of identityChecks) {
    const missing = missingKeys(current, proposed, collection, field);
    if (missing.length) {
      issues.push(`${label} would lose existing IDs: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`);
    }
  }

  return issues;
}

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function stampVerifiedRecordActors(previous,proposed,actor,at) {
  // Browser-provided record author/audit fields are untrusted. Server session
  // identity is authoritative for all newly created or changed record entries.
  const updated=structuredClone(proposed);
  const identity={maintenance:'id',projects:'id',groundsProjects:'id',vendors:'vendor',
    violations:'caseId',inspections:'inspectionId',knowledgeBase:'id'};
  const ignore=new Set(['createdBy','createdAt','modifiedBy','modifiedAt','auditTrail']);
  const substantive=r=>{
    if(!r || typeof r!=='object')return r;
    const result={};
    for(const [k,v] of Object.entries(r))if(!ignore.has(k))result[k]=v;
    return result;
  };
  for(const [module,key] of Object.entries(identity)){
    if(!Array.isArray(updated[module]))continue;
    const existing=arrayOf(previous,module);
    const old=new Map(existing.map((r,i)=>[String(r?.[key]||'#'+i),r]));
    updated[module]=updated[module].map((record,i)=>{
      if(!record || typeof record!=='object')return record;
      const prior=old.get(String(record?.[key]||'#'+i));
      const rec={...record};
      if(prior){
        rec.createdAt=prior.createdAt;
        rec.createdBy=prior.createdBy;
        rec.auditTrail=structuredClone(Array.isArray(prior.auditTrail)?prior.auditTrail:[]);
        if(JSON.stringify(substantive(prior))!==JSON.stringify(substantive(record))){
          rec.modifiedAt=at;rec.modifiedBy=actor;
          rec.auditTrail.push({at,by:actor,action:'Modified'});
        } else {
          rec.modifiedAt=prior.modifiedAt;rec.modifiedBy=prior.modifiedBy;
        }
      }else{
        rec.createdBy=actor;rec.createdAt=at;rec.modifiedBy=actor;rec.modifiedAt=at;
        rec.auditTrail=[{at,by:actor,action:'Created'}];
      }
      return rec;
    });
  }
  return updated;
}
function stampState(data, revision, actor) {
  const copy = structuredClone(data);
  copy._sync = {
    ...(copy._sync && typeof copy._sync === "object" ? copy._sync : {}),
    revision,
    updatedAt: Date.now(),
    updatedBy: actor,
    serverAuthority: true,
    serverVersion: API_VERSION
  };
  return copy;
}

async function currentRow(env) {
  return env.DB.prepare(
    "SELECT singleton_id, revision, state_json, checksum, counts_json, updated_at, updated_by, reason FROM current_state WHERE singleton_id = 1"
  ).first();
}

function publicMeta(row) {
  if (!row) return null;
  return {
    revision: Number(row.revision),
    checksum: row.checksum,
    counts: JSON.parse(row.counts_json || "{}"),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    reason: row.reason
  };
}

async function getState(env, cors, principal) {
  const row = await currentRow(env);
  if (!row) return json({ ok: true, initialized: false, service: API_VERSION }, 200, cors);
  return json({
    ok: true,
    initialized: true,
    service: API_VERSION,
    ...publicMeta(row),
    data: redactState(JSON.parse(row.state_json), principal, env)
  }, 200, cors);
}

async function bootstrap(request, env, cors) {
  const existing = await currentRow(env);
  if (existing) return json({ ok: false, error: "Database is already initialized" }, 409, cors);

  const body = await request.json();
  const errors = validateShape(body?.data);
  if (errors.length) return json({ ok: false, error: "Integrity validation failed", details: errors }, 422, cors);

  const actor = actorName(body?.actor);
  const revision = 1;
  const stamped = stampState(body.data, revision, actor);
  const stateJson = JSON.stringify(stamped);
  const checksum = await sha256Text(stateJson);
  const countsJson = JSON.stringify(recordCounts(stamped));
  const now = new Date().toISOString();
  const reason = reasonText(body?.reason || "Initial production import");

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO current_state(singleton_id,revision,state_json,checksum,counts_json,updated_at,updated_by,reason) VALUES(1,?,?,?,?,?,?,?)"
    ).bind(revision, stateJson, checksum, countsJson, now, actor, reason),
    env.DB.prepare(
      "INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('bootstrap',?,?,?,?)"
    ).bind(revision, actor, now, JSON.stringify({ counts: recordCounts(stamped) }))
  ]);

  return json({ ok: true, revision, checksum, counts: recordCounts(stamped), updatedAt: now, updatedBy: actor }, 201, cors);
}

async function saveState(request, env, cors, principal) {
  const body = await request.json();
  const baseRevision = Number(body?.baseRevision);
  if (!Number.isInteger(baseRevision) || baseRevision < 1) {
    return json({ ok: false, error: "A valid baseRevision is required" }, 400, cors);
  }

  const errors = validateShape(body?.data);
  if (errors.length) return json({ ok: false, error: "Integrity validation failed", details: errors }, 422, cors);

  const current = await currentRow(env);
  if (!current) return json({ ok: false, error: "Database is not initialized" }, 409, cors);

  const currentRevision = Number(current.revision);
  if (currentRevision !== baseRevision) {
    return json({
      ok: false,
      error: "Stale client revision",
      code: "REVISION_CONFLICT",
      current: publicMeta(current)
    }, 409, cors);
  }

  const currentData = JSON.parse(current.state_json);
  // Never accept a client-provided actor or unverified account modifications.
  const accessCheck = mergeAndAuthorizeAccess(currentData, body.data, principal, env);
  if (accessCheck) return json({ ok: false, error: accessCheck }, 403, cors);
  // A partial/old client must never silently erase a top-level data module.
  // A privileged, explicit restore remains available through its separate endpoint.
  const missingTopLevel = Object.keys(currentData).filter(key => key !== '_sync' &&
    !Object.prototype.hasOwnProperty.call(body.data, key));
  if (missingTopLevel.length) {
    return json({ok:false,error:'Save blocked: missing stored data modules',details:missingTopLevel},422,cors);
  }
  const destructive = destructiveDifferences(currentData, body.data);
  const explicitSingleDelete = confirmedSingleDelete(currentData, body.data, body);
  const allowDestructive = principal.legacy
    ? ((body?.allowDestructive === true && adminAuthorized(request, env.ADMIN_TOKEN)) || explicitSingleDelete)
    : (body?.allowDestructive === true && principal.role === "admin");
  if (destructive.length && !allowDestructive) {
    return json({
      ok: false,
      error: "Destructive change blocked",
      code: "INTEGRITY_BLOCK",
      details: destructive,
      current: publicMeta(current)
    }, 422, cors);
  }

  const actor = actorName(principal.name);
  const reason = reasonText(body?.reason);
  const newRevision = baseRevision + 1;
  const now = new Date().toISOString();
  const verifiedState=stampVerifiedRecordActors(currentData,body.data,actor,now);
  const stamped = stampState(verifiedState, newRevision, actor);
  const stateJson = JSON.stringify(stamped);
  const checksum = await sha256Text(stateJson);
  const countsJson = JSON.stringify(recordCounts(stamped));

  try {
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO state_revisions(revision,state_json,checksum,counts_json,saved_at,saved_by,reason)
         SELECT revision,state_json,checksum,counts_json,updated_at,updated_by,reason
         FROM current_state WHERE singleton_id=1 AND revision=?`
      ).bind(baseRevision),
      env.DB.prepare(
        `UPDATE current_state
         SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason=?
         WHERE singleton_id=1 AND revision=?`
      ).bind(newRevision, stateJson, checksum, countsJson, now, actor, reason, baseRevision),
      env.DB.prepare(
        "INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('save',?,?,?,?)"
      ).bind(newRevision, actor, now, JSON.stringify({ reason, counts: recordCounts(stamped), changes: activityRecordChanges(currentData,stamped), destructiveOverride: allowDestructive }))
    ]);

    const updateMeta = result?.[1]?.meta;
    const changed = Number(updateMeta?.changes ?? result?.[1]?.changes ?? 0);
    if (changed !== 1) {
      return json({ ok: false, error: "Save conflict", code: "REVISION_CONFLICT" }, 409, cors);
    }
  } catch (err) {
    // A concurrent writer can make the history insert collide on the same revision.
    const latest = await currentRow(env);
    if (latest && Number(latest.revision) !== baseRevision) {
      return json({ ok: false, error: "Save conflict", code: "REVISION_CONFLICT", current: publicMeta(latest) }, 409, cors);
    }
    throw err;
  }

  return json({
    ok: true,
    revision: newRevision,
    checksum,
    counts: recordCounts(stamped),
    updatedAt: now,
    updatedBy: actor
  }, 200, cors);
}

async function getHistory(url, env, cors) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 100);
  const rows = await env.DB.prepare(
    `SELECT revision,checksum,counts_json,saved_at,saved_by,reason
     FROM state_revisions ORDER BY revision DESC LIMIT ?`
  ).bind(limit).all();

  const current = await currentRow(env);
  const history = (rows.results || []).map(r => ({
    revision: Number(r.revision),
    checksum: r.checksum,
    counts: JSON.parse(r.counts_json || "{}"),
    savedAt: r.saved_at,
    savedBy: r.saved_by,
    reason: r.reason
  }));

  return json({ ok: true, current: publicMeta(current), history }, 200, cors);
}

async function getRevision(revision, env, cors, principal) {
  if (!Number.isInteger(revision) || revision < 1) return json({ ok: false, error: "Invalid revision" }, 400, cors);

  const current = await currentRow(env);
  if (current && Number(current.revision) === revision) {
    return json({ ok: true, current: true, ...publicMeta(current), data: redactState(JSON.parse(current.state_json), principal, env) }, 200, cors);
  }

  const row = await env.DB.prepare(
    "SELECT revision,state_json,checksum,counts_json,saved_at,saved_by,reason FROM state_revisions WHERE revision=?"
  ).bind(revision).first();

  if (!row) return json({ ok: false, error: "Revision not found" }, 404, cors);
  return json({
    ok: true,
    current: false,
    revision: Number(row.revision),
    checksum: row.checksum,
    counts: JSON.parse(row.counts_json || "{}"),
    updatedAt: row.saved_at,
    updatedBy: row.saved_by,
    reason: row.reason,
    data: redactState(JSON.parse(row.state_json), principal, env)
  }, 200, cors);
}

async function restoreRevision(request, env, cors) {
  const body = await request.json();
  const targetRevision = Number(body?.revision);
  const baseRevision = Number(body?.baseRevision);
  if (!Number.isInteger(targetRevision) || !Number.isInteger(baseRevision)) {
    return json({ ok: false, error: "revision and baseRevision are required" }, 400, cors);
  }

  const current = await currentRow(env);
  if (!current) return json({ ok: false, error: "Database is not initialized" }, 409, cors);
  if (Number(current.revision) !== baseRevision) {
    return json({ ok: false, error: "Stale client revision", code: "REVISION_CONFLICT", current: publicMeta(current) }, 409, cors);
  }

  let targetData;
  if (targetRevision === Number(current.revision)) {
    targetData = JSON.parse(current.state_json);
  } else {
    const old = await env.DB.prepare("SELECT state_json FROM state_revisions WHERE revision=?").bind(targetRevision).first();
    if (!old) return json({ ok: false, error: "Revision not found" }, 404, cors);
    targetData = JSON.parse(old.state_json);
  }

  // Reuse the normal save path conceptually, but a restore is explicitly destructive
  // and is protected by the separate ADMIN_TOKEN.
  const actor = actorName(body?.actor);
  const reason = reasonText(body?.reason || `Restore revision ${targetRevision}`);
  const newRevision = baseRevision + 1;
  const stamped = stampState(targetData, newRevision, actor);
  const stateJson = JSON.stringify(stamped);
  const checksum = await sha256Text(stateJson);
  const countsJson = JSON.stringify(recordCounts(stamped));
  const now = new Date().toISOString();

  try {
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO state_revisions(revision,state_json,checksum,counts_json,saved_at,saved_by,reason)
         SELECT revision,state_json,checksum,counts_json,updated_at,updated_by,reason
         FROM current_state WHERE singleton_id=1 AND revision=?`
      ).bind(baseRevision),
      env.DB.prepare(
        `UPDATE current_state SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason=?
         WHERE singleton_id=1 AND revision=?`
      ).bind(newRevision, stateJson, checksum, countsJson, now, actor, reason, baseRevision),
      env.DB.prepare(
        "INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('restore',?,?,?,?)"
      ).bind(newRevision, actor, now, JSON.stringify({ restoredFrom: targetRevision, counts: recordCounts(stamped) }))
    ]);
    const changed = Number(result?.[1]?.meta?.changes ?? result?.[1]?.changes ?? 0);
    if (changed !== 1) return json({ ok: false, error: "Restore conflict", code: "REVISION_CONFLICT" }, 409, cors);
  } catch (err) {
    const latest = await currentRow(env);
    if (latest && Number(latest.revision) !== baseRevision) {
      return json({ ok: false, error: "Restore conflict", code: "REVISION_CONFLICT", current: publicMeta(latest) }, 409, cors);
    }
    throw err;
  }

  return json({ ok: true, revision: newRevision, restoredFrom: targetRevision, checksum, counts: recordCounts(stamped), updatedAt: now, updatedBy: actor }, 200, cors);
}

// PIN authentication for the staging-only migration. Requires BPP_PIN_AUTH_MIGRATION.sql.
function publicUser(u) { return { id: u.id, name: u.name, role: u.role }; }
function redactState(data, principal, env) {
  // Temporary explicit compatibility only: old live UI requires historical
  // account data. Remove this gate and rotate the legacy shared key at cutover.
  if (principal?.legacy && env?.LEGACY_STATE_COMPAT === 'true') return structuredClone(data);
  const copy = structuredClone(data);
  if (Array.isArray(copy?._access?.users)) {
    copy._access.users = copy._access.users.map(u => {
      const {pinHash, salt, passwordHash, ...safe} = u;
      return safe;
    });
  }
  return copy;
}
function normalizeName(v) { return String(v || '').trim().toLocaleLowerCase('en-US'); }
function sha256Hex(data) { return sha256Text(data); }
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
}

function randomHex(bytesLength = 24) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
}
function hexBytes(hex) {
  const value = String(hex || '');
  if (value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error('Invalid credential salt');
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2),16);
  return bytes;
}
async function pbkdf2Pin(pin, saltHex, iterations, env, userId) {
  // EXPERIMENT ONLY: server-side HMAC pepper prevents an offline D1-only attacker
  // from testing six-digit guesses without also possessing the Worker secret.
  if (!Number.isInteger(iterations) || iterations !== PBKDF2_ITERATIONS)
    throw new Error('Unsupported credential cost');
  if (typeof env.PIN_PEPPER !== 'string' || env.PIN_PEPPER.length < 32)
    throw new Error('PIN pepper missing');
  const key = await crypto.subtle.importKey(
    'raw',new TextEncoder().encode(env.PIN_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',key,new TextEncoder().encode('bpp-pin-v1\\0'+userId+'\\0'+pin)
  );
  const base = await crypto.subtle.importKey('raw',mac,'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2',hash:'SHA-256',salt:hexBytes(saltHex),iterations},
    base,256
  );
  return Array.from(new Uint8Array(bits), b=>b.toString(16).padStart(2,'0')).join('');
}
async function accountFingerprint(user) {
  // Role or PIN change invalidates old sessions, even if the client forgets to log out.
  return sha256Hex(JSON.stringify([
    user.id,user.role,user.active !== false,user.pinHash,user.salt
  ]));
}
async function authenticateSession(request, env) {
  const token = bearer(request);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare('SELECT user_id,expires_at,account_fingerprint FROM pin_sessions_v2 WHERE token_hash=?').bind(tokenHash).first();
  if (!session || Number(session.expires_at) <= Date.now()) return null;
  const row = await currentRow(env);
  if (!row) return null;
  const users = JSON.parse(row.state_json)?._access?.users || [];
  const user = users.find(u => u.id === session.user_id && u.active !== false);
  if (!user) return null;
  const fingerprint = await accountFingerprint(user);
  return timingSafeEqualText(session.account_fingerprint, fingerprint) ? publicUser(user) : null;
}
async function revokeSession(request, env) {
  const token = bearer(request);
  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare('DELETE FROM pin_sessions_v2 WHERE token_hash=?').bind(await sha256Hex(token)).run();
  }
}
async function loginWithPin(request, env, cors) {
  const failure = () => json({ok:false,error:'Incorrect name or PIN, or account temporarily locked.'},401,cors);
  if (Number(request.headers.get('content-length')||0)>4096) return json({ok:false,error:'Request too large'},413,cors);
  let payload;
  try { payload = await request.json(); } catch { return failure(); }
  const name = normalizeName(payload?.name);
  const pin = String(payload?.pin ?? '');
  if (name.length < 2 || name.length > 120 || !/^\d{6}$/.test(pin)) return failure();
  const identifier = await sha256Hex(name);
  const now = Date.now();
  const attempts = await env.DB.prepare('SELECT failures, locked_until FROM pin_attempts WHERE identifier=?').bind(identifier).first();
  if (Number(attempts?.locked_until || 0) > now) return json({ok:false,error:'Account temporarily locked. Try again later.'},429,cors);
  const row = await currentRow(env);
  const users = row ? (JSON.parse(row.state_json)?._access?.users || []) : [];
  const user = users.find(u => normalizeName(u.name) === name && u.active !== false);
  let valid = false;
  const expected = user?.pinHash || '';
  const legacySalt = String(user?.salt || '');
  // Isolated experiment supports BOTH the transitional legacy mode and the
  // post-sanitization state where user profiles no longer carry fast verifiers.
  // A source_pin_hash of '' is mandatory after scrub; a stale legacy value
  // must not be silently accepted or used for offline guessing.
  if (user) {
    const credential = await env.DB.prepare(
      'SELECT salt,verifier,iterations,source_pin_hash FROM pin_credentials WHERE user_id=?'
    ).bind(user.id).first();
    const legacyPresent = /^[0-9a-f]{64}$/.test(expected) && /^[0-9a-f]{32}$/.test(legacySalt);
    const scrubbed = !expected && !legacySalt;
    if (credential) {
      const sourceValid = (scrubbed && credential.source_pin_hash === '') ||
        (legacyPresent && timingSafeEqualText(String(credential.source_pin_hash), expected));
      if (sourceValid) {
        const derived = await pbkdf2Pin(pin, credential.salt, Number(credential.iterations), env, user.id);
        valid = timingSafeEqualText(derived, credential.verifier);
      }
    }
    // Until the verified cleanup, a correct existing legacy PIN can recover
    // credentials created by the earlier (unpeppered) synthetic test Worker.
    // This path is disabled entirely once credential-only mode is enabled.
    if (!valid && legacyPresent && env.CREDENTIALS_ONLY !== 'enabled') {
      const actualLegacy = await sha256Hex(legacySalt + '|' + pin);
      valid = timingSafeEqualText(actualLegacy, expected);
      if (valid) {
        const newSalt = randomHex(24);
        const newVerifier = await pbkdf2Pin(pin, newSalt, PBKDF2_ITERATIONS, env, user.id);
        await env.DB.prepare(
          `INSERT INTO pin_credentials(user_id,salt,verifier,iterations,source_pin_hash,updated_at)
           VALUES(?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,verifier=excluded.verifier,
              iterations=excluded.iterations,source_pin_hash=excluded.source_pin_hash,
              updated_at=excluded.updated_at`
        ).bind(user.id,newSalt,newVerifier,PBKDF2_ITERATIONS,expected,Date.now()).run();
      }
    }
  }
  if (!valid) {
    const failures = Number(attempts?.failures || 0) + 1;
    const lock = failures >= 5 ? now + 15 * 60 * 1000 : 0;
    await env.DB.prepare(`INSERT INTO pin_attempts(identifier,failures,locked_until) VALUES(?,?,?)
      ON CONFLICT(identifier) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until`)
      .bind(identifier,lock ? 0 : failures,lock).run();
    return failure();
  }
  await env.DB.prepare('DELETE FROM pin_attempts WHERE identifier=?').bind(identifier).run();
  const token = randomToken();
  await env.DB.prepare('INSERT INTO pin_sessions_v2(token_hash,user_id,expires_at,created_at,account_fingerprint) VALUES(?,?,?,?,?)')
    .bind(await sha256Hex(token),user.id,now+AUTH_SESSION_SECONDS*1000,now,await accountFingerprint(user)).run();
  return json({ok:true,token,user:publicUser(user),expiresAt:now+AUTH_SESSION_SECONDS*1000},200,cors);
}
async function createCredentialUser(request, env, cors, principal) {
  if (Number(request.headers.get('content-length')||0)>4096)
    return json({ok:false,error:'Request too large'},413,cors);
  let body;
  try { body=await request.json(); }
  catch { return json({ok:false,error:'Invalid request'},400,cors); }
  const name=String(body.name||'').trim();
  const pin=String(body.pin||'');
  const role=String(body.role||'');
  if (name.length<2 || name.length>100 || !['user','admin'].includes(role) ||
      pin.length!==6 || !Array.from(pin).every(c=>c>='0'&&c<='9'))
    return json({ok:false,error:'Invalid account details'},400,cors);
  const row=await currentRow(env);
  if (!row) return json({ok:false,error:'Database not initialized'},409,cors);
  const old=JSON.parse(row.state_json);
  const users=old?._access?.users;
  if (!Array.isArray(users) || users.length>=100 ||
      users.some(u=>normalizeName(u.name)===normalizeName(name)))
    return json({ok:false,error:'Duplicate name or account limit reached'},409,cors);
  if (users.some(u=>u.pinHash||u.salt||u.passwordHash))
    return json({ok:false,error:'Credential migration required'},409,cors);
  const id='usr-'+randomHex(16);
  const actor=actorName(principal.name),now=new Date().toISOString();
  const changed=structuredClone(old);
  changed._access.users.push({id,name,role,active:true,createdAt:now,createdBy:actor});
  const nextRevision=Number(row.revision)+1;
  const stamped=stampState(changed,nextRevision,actor);
  const stateJson=JSON.stringify(stamped);
  const checksum=await sha256Text(stateJson);
  const countsJson=JSON.stringify(recordCounts(stamped));
  const salt=randomHex(24);
  const verifier=await pbkdf2Pin(pin,salt,PBKDF2_ITERATIONS,env,id);
  try {
    const batch=await env.DB.batch([
      env.DB.prepare('INSERT INTO state_revisions(revision,state_json,checksum,counts_json,saved_at,saved_by,reason) SELECT revision,state_json,checksum,counts_json,updated_at,updated_by,reason FROM current_state WHERE singleton_id=1 AND revision=?').bind(row.revision),
      env.DB.prepare("UPDATE current_state SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason='Add authorized user' WHERE singleton_id=1 AND revision=?").bind(nextRevision,stateJson,checksum,countsJson,now,actor,row.revision),
      env.DB.prepare("INSERT INTO pin_credentials(user_id,salt,verifier,iterations,source_pin_hash,updated_at) VALUES(?,?,?,?,'',?)").bind(id,salt,verifier,PBKDF2_ITERATIONS,Date.now()),
      env.DB.prepare("INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('user-created',?,?,?,?)").bind(nextRevision,actor,now,JSON.stringify({accountId:id,role}))
    ]);
    if (Number(batch?.[1]?.meta?.changes??batch?.[1]?.changes??0)!==1)
      return json({ok:false,error:'Concurrent change'},409,cors);
  }catch{return json({ok:false,error:'Account creation conflict'},409,cors)}
  return json({ok:true,user:{id,name,role,active:true},revision:nextRevision},201,cors);
}
async function readAdminActivity(url,env,cors){
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50)));
  const rows=await env.DB.prepare('SELECT event_type,revision,actor,created_at,details_json FROM audit_events ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ok:true,events:(rows.results||[]).map(r=>({action:r.event_type,revision:r.revision,actor:r.actor,at:r.created_at,details:JSON.parse(r.details_json||'{}')}))},200,cors);
}
async function resetUserPin(request, env, cors, principal) {
  // This endpoint is intentionally unavailable before legacy credentials have
  // been removed from authoritative state. No PIN is sent back to the browser.
  if (Number(request.headers.get('content-length')||0)>4096)
    return json({ok:false,error:'Request too large'},413,cors);
  let body;
  try {body=await request.json();} catch {return json({ok:false,error:'Invalid request'},400,cors);}
  const id=String(body?.userId||'');
  const pin=String(body?.pin??'');
  if (!id || id.length>128 || !/^\d{6}$/.test(pin))
    return json({ok:false,error:'Invalid account or PIN'},400,cors);
  const row=await currentRow(env);
  if (!row) return json({ok:false,error:'Database not initialized'},409,cors);
  const state=JSON.parse(row.state_json);
  const users=state?._access?.users || [];
  if (!users.length || users.some(u=>u.pinHash || u.salt || u.passwordHash))
    return json({ok:false,error:'Credential-only migration required'},409,cors);
  const target=users.find(u=>u.id===id);
  if (!target) return json({ok:false,error:'Account not found'},404,cors);
  const salt=randomHex(24);
  const verifier=await pbkdf2Pin(pin,salt,PBKDF2_ITERATIONS,env,id);
  const at=Date.now();
  // Credential update and session revocation are one D1 transaction.
  // We intentionally do not alter current_state or historical revisions.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO pin_credentials(user_id,salt,verifier,iterations,source_pin_hash,updated_at)
                    VALUES(?,?,?,?,'',?)
                    ON CONFLICT(user_id) DO UPDATE SET
                      salt=excluded.salt,verifier=excluded.verifier,
                      iterations=excluded.iterations,source_pin_hash='',
                      updated_at=excluded.updated_at`)
      .bind(id,salt,verifier,PBKDF2_ITERATIONS,at),
    env.DB.prepare('DELETE FROM pin_sessions_v2 WHERE user_id=?').bind(id),
    env.DB.prepare(`INSERT INTO audit_events(event_type,revision,actor,created_at,details_json)
                    VALUES('pin-reset',?,?,?,?)`)
      .bind(Number(row.revision),actorName(principal.name),new Date(at).toISOString(),
            JSON.stringify({accountId:id,credentialOnly:true}))
  ]);
  return json({ok:true,accountId:id,sessionRevoked:true},200,cors);
}
function mergeAndAuthorizeAccess(current, proposed, principal, env) {
  // Once credential-only storage is enabled, no browser request may supply
  // legacy fast PIN verifier properties (including new users).
  const existingProfiles = current?._access?.users || [];
  const profilesAreCredentialOnly = existingProfiles.length > 0 &&
    existingProfiles.every(u => !u.pinHash && !u.salt && !u.passwordHash);
  if ((env.CREDENTIALS_ONLY === 'enabled' || profilesAreCredentialOnly) &&
      (proposed?._access?.users || []).some(u =>
        Object.hasOwn(u,'pinHash') || Object.hasOwn(u,'salt') || Object.hasOwn(u,'passwordHash')))
    return 'Credential fields must be managed by the server';
  if (!proposed || typeof proposed !== 'object' || Array.isArray(proposed)) return 'Invalid data';
  const before = current?._access?.users || [];
  const after = proposed?._access?.users || [];
  if (!Array.isArray(after)) return 'Invalid user data';
  const saved = new Map(before.map(u => [u.id,u]));
  // Read-only, secret-stripped profiles are compared to detect non-admin edits.
  const oldPublic = JSON.stringify((current?._access?.users || []).map(u => {
    const {pinHash,salt,passwordHash,...v}=u; return v;
  }));
  const newPublic = JSON.stringify(after.map(u => {
    const {pinHash,salt,passwordHash,...v}=u; return v;
  }));
  if (principal.role !== 'admin' && oldPublic !== newPublic) return 'Only administrators may change users';
  // A non-admin must not modify _access configuration, even when the users array is unchanged.
  const oldAccess = structuredClone(current?._access || {});
  const newAccess = structuredClone(proposed?._access || {});
  delete oldAccess.users; delete newAccess.users;
  if (principal.role !== 'admin' && JSON.stringify(oldAccess) !== JSON.stringify(newAccess))
    return 'Only administrators may change access settings';
  // Existing users cannot be silently removed, including by an administrator.
  // Deactivation is supported; permanent deletion requires an explicit migration.
  if (after.length < before.length || before.some(u => !after.some(v => v.id === u.id)))
    return 'Existing user accounts must not be removed';
  for (const u of after) {
    const old = saved.get(u.id);
    if (!old && profilesAreCredentialOnly)
      return 'Create new accounts through protected enrollment';

    if (old) {
      if (!u.pinHash) u.pinHash=old.pinHash;
      if (!u.salt) u.salt=old.salt;
      if (principal.role !== 'admin' && (u.pinHash !== old.pinHash || u.salt !== old.salt)) return 'Only administrators may change PINs';
    } else if (principal.role !== 'admin') return 'Only administrators may add users';
    if (u.pinHash && !/^[0-9a-f]{64}$/.test(u.pinHash)) return 'Invalid PIN verification hash';
    if (u.salt && !/^[0-9a-f]{32}$/.test(u.salt)) return 'Invalid PIN salt';
  }
  // Prevent removing/deactivating the last administrator.
  if (!after.some(u => u.role === 'admin' && u.active !== false)) return 'An active administrator is required';
  return null;
}

function testEnrollmentHtml(){
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BPP Isolated PIN Enrollment Test</title>
<style>body{font:16px system-ui,sans-serif;max-width:660px;margin:2rem auto;padding:0 1rem;color:#183c2b}
label{display:block;margin:12px 0}input,select{display:block;padding:11px;border-radius:6px;border:1px solid #8c9b93;max-width:100%;box-sizing:border-box;width:350px}
button{padding:11px;margin:5px 4px 5px 0;background:#194630;color:#fff;border:0;border-radius:7px;cursor:pointer}button:disabled{opacity:.4}
section{border:1px solid #d4dfd7;border-radius:12px;padding:16px;margin:12px 0}#out{white-space:pre-wrap;background:#f0f5f1;padding:16px;border-radius:10px}
small{color:#6b756b}</style>
<h2>BPP PIN Enrollment — Isolated Test Only</h2><p>This page works only with the synthetic BPP test database, not production. Do not use real PINs or identities here.</p>
<section><h3>1. Sign in</h3>
<label>Test account name<input id="name" autocomplete="username" placeholder="BPP Test Admin"></label>
<label>Test PIN<input id="pin" type="password" maxlength="6" inputmode="numeric" autocomplete="off"></label>
<button id="signin">Sign in</button><button id="logout">Sign out</button><button id="who">Check session</button></section>
<section><h3>2. Enroll a new test user</h3>
<label>New test name<input id="newname" placeholder="Enrollment Test Member"></label>
<label>Role<select id="role"><option value="user">Authorized User</option><option value="admin">Board Administrator</option></select></label>
<label>New test PIN<input id="newpin" maxlength="6" type="password" inputmode="numeric"></label>
<button id="create">Create test user</button></section>
<section><h3>3. Reset a test PIN</h3><label>Test account ID<input id="accountid" placeholder="ID from Check Session"></label>
<label>Replacement test PIN<input id="resetpin" maxlength="6" type="password" inputmode="numeric"></label><button id="reset">Reset test PIN</button></section>
<section><h3>4. Private Activity Log</h3><button id="activity">Check System Administrator-only access</button></section>
<section><h3>5. Test-only historical credential cleanup</h3>
<p><small>This is for synthetic test records only. First sign in once under each existing test account so its secure verifier is enrolled. This changes the isolated test database.</small></p>
<button id="scrub">Sanitize isolated test history</button></section>
<h3>Result</h3><div id="out" role="status">Not signed in.</div>
<script>
const by=id=>document.getElementById(id);
let token=sessionStorage.getItem('bppEnrollmentTestToken')||'';
const output=(message,data)=>by('out').textContent=message+(data?'\\n'+JSON.stringify(data,null,2):'');
async function api(path,body){
  const headers={Authorization:'Bearer '+token};
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await r.json();if(!r.ok)throw new Error((data.error||'HTTP '+r.status)+' ('+r.status+')');
  return data;
}
async function run(fn){try{await fn()}catch(e){output('Not completed: '+e.message)}}
by('signin').onclick=()=>run(async()=>{
  const name=by('name').value,pin=by('pin').value;by('pin').value='';
  const r=await api('/api/auth/login',{name,pin});token=r.token;
  sessionStorage.setItem('bppEnrollmentTestToken',token);await api('/test/confirm',{});output('Signed in and test credential confirmed.',{user:r.user});
});
by('who').onclick=()=>run(async()=>{const r=await api('/api/auth/me');output('Verified session.',r)});
by('logout').onclick=()=>run(async()=>{try{await api('/api/auth/logout',{})}catch{}
  token='';sessionStorage.removeItem('bppEnrollmentTestToken');output('Signed out.')});
by('create').onclick=()=>run(async()=>{
  const name=by('newname').value,pin=by('newpin').value,role=by('role').value;by('newpin').value='';
  const r=await api('/api/admin/user-create',{name,role,pin});output('Test user created.',r);
});
by('reset').onclick=()=>run(async()=>{
  const userId=by('accountid').value,pin=by('resetpin').value;by('resetpin').value='';
  const r=await api('/api/admin/pin-reset',{userId,pin});output('Test PIN reset.',r);
});
by('activity').onclick=()=>run(async()=>{
  const r=await api('/api/admin/activity?limit=10');output('Private system activity.',r);
});
by('scrub').onclick=()=>run(async()=>{
  if(!confirm('Sanitize historical PIN fields in the isolated synthetic database ONLY?'))return;
  const r=await api('/test/scrub',{});token='';sessionStorage.removeItem('bppEnrollmentTestToken');
  output('Isolated test credential cleanup completed. Sign in again.',r);
});
</script></html>`;
}
async function scrubSyntheticCredentials(env,cors) {
  const row=await currentRow(env);
  if(!row)return json({ok:false,error:'Test database not initialized'},409,cors);
  const current=JSON.parse(row.state_json);
  const users=current?._access?.users||[];
  if(!users.length || !users.some(u=>u.role==='admin'&&u.active!==false))
    return json({ok:false,error:'Active test administrator required'},409,cors);
  const creds=(await env.DB.prepare('SELECT user_id,source_pin_hash FROM pin_credentials').all()).results||[];
  const keys=new Map(creds.map(c=>[c.user_id,c.source_pin_hash]));
  const enrolledRows=(await env.DB.prepare("SELECT details_json FROM audit_events WHERE event_type='test-enrollment-confirmed'").all()).results||[];
  const confirmed=new Set(enrolledRows.map(x=>{try{return JSON.parse(x.details_json).userId}catch{return''}}));
  if(users.some(u=>u.active!==false&&!confirmed.has(u.id)))
    return json({ok:false,error:'Every active test user must sign in on /test-enroll before cleanup'},409,cors);

  if(users.some(u=>u.active!==false && !keys.has(u.id)))
    return json({ok:false,error:'Sign in once as every active test account before scrubbing'},409,cors);
  // Historical data is rewritten only in the isolated test Worker.
  const history=(await env.DB.prepare('SELECT revision,state_json,checksum FROM state_revisions').all()).results||[];
  const sources=[{revision:row.revision,state_json:row.state_json,checksum:row.checksum,current:true},
                 ...history.map(x=>({...x,current:false}))];
  const changes=[];
  for(const snapshot of sources) {
    if(!timingSafeEqualText(await sha256Text(snapshot.state_json),snapshot.checksum))
      return json({ok:false,error:'Snapshot checksum mismatch; test cleanup refused'},409,cors);
    const value=JSON.parse(snapshot.state_json);
    for(const u of value?._access?.users||[]) {
      delete u.pinHash;delete u.salt;delete u.passwordHash;
    }
    const serialized=JSON.stringify(value),checksum=await sha256Text(serialized);
    changes.push(snapshot.current
      ?env.DB.prepare('UPDATE current_state SET state_json=?,checksum=? WHERE singleton_id=1 AND revision=?').bind(serialized,checksum,snapshot.revision)
      :env.DB.prepare('UPDATE state_revisions SET state_json=?,checksum=? WHERE revision=?').bind(serialized,checksum,snapshot.revision));
  }
  changes.push(env.DB.prepare("UPDATE pin_credentials SET source_pin_hash=''"));
  changes.push(env.DB.prepare('DELETE FROM pin_sessions_v2'));
  await env.DB.batch(changes);
  return json({ok:true,snapshotsChecked:sources.length,testOnly:true},200,cors);
}
