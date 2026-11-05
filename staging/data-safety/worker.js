// Brewer Park Place Management Suite v9 — STAGING ONLY
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

const API_VERSION = "bpp-v9-staging-1";
const PROTECTED_COLLECTIONS = ["maintenance", "violations", "projects", "inspections", "vendors"];

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

      if (!originAllowed(request, env)) {
        return json({ ok: false, error: "Origin not allowed" }, 403, cors);
      }

      if (!authorized(request, env.ACCESS_TOKEN)) {
        return json({ ok: false, error: "Unauthorized" }, 401, cors);
      }

      if (url.pathname === "/api/state" && request.method === "GET") {
        return getState(env, cors);
      }

      if (url.pathname === "/api/state" && request.method === "POST") {
        return saveState(request, env, cors);
      }

      if (url.pathname === "/api/history" && request.method === "GET") {
        return getHistory(url, env, cors);
      }

      const historyMatch = url.pathname.match(/^\/api\/history\/(\d+)$/);
      if (historyMatch && request.method === "GET") {
        return getRevision(Number(historyMatch[1]), env, cors);
      }

      if (url.pathname === "/api/bootstrap" && request.method === "POST") {
        if (!adminAuthorized(request, env.ADMIN_TOKEN)) {
          return json({ ok: false, error: "Administrator authorization required" }, 403, cors);
        }
        return bootstrap(request, env, cors);
      }

      if (url.pathname === "/api/restore" && request.method === "POST") {
        if (!adminAuthorized(request, env.ADMIN_TOKEN)) {
          return json({ ok: false, error: "Administrator authorization required" }, 403, cors);
        }
        return restoreRevision(request, env, cors);
      }

      return json({ ok: false, error: "Not found" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: "Server error", detail: safeError(err) }, 500);
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

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // direct API tools/curl
  return configuredOrigins(env).includes(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = origin && configuredOrigins(env).includes(origin) ? origin : "";
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

async function getState(env, cors) {
  const row = await currentRow(env);
  if (!row) return json({ ok: true, initialized: false, service: API_VERSION }, 200, cors);
  return json({
    ok: true,
    initialized: true,
    service: API_VERSION,
    ...publicMeta(row),
    data: JSON.parse(row.state_json)
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
  const reason = reasonText(body?.reason || "Initial staging import");

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

async function saveState(request, env, cors) {
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
  const destructive = destructiveDifferences(currentData, body.data);
  const allowDestructive = body?.allowDestructive === true && adminAuthorized(request, env.ADMIN_TOKEN);
  if (destructive.length && !allowDestructive) {
    return json({
      ok: false,
      error: "Destructive change blocked",
      code: "INTEGRITY_BLOCK",
      details: destructive,
      current: publicMeta(current)
    }, 422, cors);
  }

  const actor = actorName(body?.actor);
  const reason = reasonText(body?.reason);
  const newRevision = baseRevision + 1;
  const stamped = stampState(body.data, newRevision, actor);
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
        `UPDATE current_state
         SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason=?
         WHERE singleton_id=1 AND revision=?`
      ).bind(newRevision, stateJson, checksum, countsJson, now, actor, reason, baseRevision),
      env.DB.prepare(
        "INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) VALUES('save',?,?,?,?)"
      ).bind(newRevision, actor, now, JSON.stringify({ reason, counts: recordCounts(stamped), destructiveOverride: allowDestructive }))
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

async function getRevision(revision, env, cors) {
  if (!Number.isInteger(revision) || revision < 1) return json({ ok: false, error: "Invalid revision" }, 400, cors);

  const current = await currentRow(env);
  if (current && Number(current.revision) === revision) {
    return json({ ok: true, current: true, ...publicMeta(current), data: JSON.parse(current.state_json) }, 200, cors);
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
    data: JSON.parse(row.state_json)
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
