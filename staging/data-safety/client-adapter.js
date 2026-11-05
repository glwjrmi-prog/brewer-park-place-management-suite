// Brewer Park Place Management Suite v9 — STAGING ONLY
// Browser-side adapter for the authoritative revisioned cloud service.
// This file is not loaded by the production app.

export class BppAuthoritativeSync {
  constructor({ baseUrl, token, actor, onState, onStatus, onReadOnly }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.token = String(token || "");
    this.actor = String(actor || "Unknown user");
    this.onState = onState || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onReadOnly = onReadOnly || (() => {});
    this.revision = 0;
    this.state = null;
    this.dirty = false;
    this.readOnly = true;
    this.pollTimer = null;
  }

  headers(extra = {}) {
    return {
      "Authorization": `Bearer ${this.token}`,
      "Content-Type": "application/json",
      ...extra
    };
  }

  async request(path, options = {}) {
    const r = await fetch(`${this.baseUrl}${path}`, {
      cache: "no-store",
      ...options,
      headers: this.headers(options.headers || {})
    });
    let body = null;
    try { body = await r.json(); } catch {}
    if (!r.ok) {
      const err = new Error(body?.error || `Request failed (${r.status})`);
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  setStatus(text, kind = "") {
    this.onStatus({ text, kind, revision: this.revision, readOnly: this.readOnly, dirty: this.dirty });
  }

  setReadOnly(value, reason = "") {
    this.readOnly = !!value;
    this.onReadOnly({ readOnly: this.readOnly, reason });
  }

  async start() {
    this.setStatus("Loading latest cloud data…", "loading");
    try {
      const remote = await this.request("/api/state", { method: "GET" });
      if (!remote.initialized) throw new Error("The cloud database has not been initialized.");
      this.acceptRemote(remote);
      this.setReadOnly(false);
      this.setStatus("Cloud current", "ok");
      this.startPolling();
      return remote.data;
    } catch (err) {
      this.setReadOnly(true, "The cloud could not be verified. Editing is disabled to protect current data.");
      this.setStatus("Cloud unavailable — read only", "warn");
      throw err;
    }
  }

  acceptRemote(remote) {
    this.revision = Number(remote.revision || 0);
    this.state = structuredClone(remote.data);
    this.dirty = false;
    this.onState({
      data: structuredClone(this.state),
      revision: this.revision,
      updatedAt: remote.updatedAt,
      updatedBy: remote.updatedBy,
      counts: remote.counts || {}
    });
  }

  markDirty(nextState) {
    if (this.readOnly) throw new Error("Editing is disabled while cloud status is unverified.");
    this.state = structuredClone(nextState);
    this.dirty = true;
    this.setStatus("Unsaved changes", "dirty");
  }

  async save(nextState, reason = "Record change") {
    if (this.readOnly) throw new Error("Editing is disabled while cloud status is unverified.");
    if (nextState) this.markDirty(nextState);

    const payload = {
      baseRevision: this.revision,
      data: this.state,
      actor: this.actor,
      reason
    };

    this.setStatus("Saving…", "saving");
    try {
      const saved = await this.request("/api/state", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      this.revision = Number(saved.revision);
      if (this.state?._sync) {
        this.state._sync.revision = this.revision;
        this.state._sync.updatedBy = saved.updatedBy;
      }
      this.dirty = false;
      this.setStatus("Cloud current", "ok");
      return saved;
    } catch (err) {
      if (err.status === 409 && err.body?.code === "REVISION_CONFLICT") {
        this.setStatus("Newer cloud data exists — save blocked", "warn");
        // Critical behavior: never retry a stale whole-state save automatically.
        throw new Error("Another user saved newer information. Your stale save was blocked. Reload the latest cloud data before editing again.");
      }
      if (err.status === 422 && err.body?.code === "INTEGRITY_BLOCK") {
        this.setStatus("Data-loss protection blocked this save", "warn");
        throw new Error(`Save blocked to prevent data loss: ${(err.body.details || []).join("; ")}`);
      }
      this.setStatus("Save failed — local changes preserved", "warn");
      throw err;
    }
  }

  async refresh() {
    if (this.dirty) throw new Error("Unsaved local changes exist. Refresh is blocked until they are resolved.");
    const remote = await this.request("/api/state", { method: "GET" });
    if (Number(remote.revision) > this.revision) this.acceptRemote(remote);
    this.setStatus("Cloud current", "ok");
    return this.state;
  }

  async pollOnce() {
    if (this.readOnly || this.dirty) return;
    try {
      const remote = await this.request("/api/state", { method: "GET" });
      if (Number(remote.revision) > this.revision) {
        this.acceptRemote(remote);
        this.setStatus(`Updated from cloud · revision ${this.revision}`, "ok");
      }
    } catch {
      // A temporary poll failure should not destroy the already-loaded screen,
      // but editing becomes read-only until the cloud can be verified again.
      this.setReadOnly(true, "Cloud verification was lost. Editing is disabled until reconnection.");
      this.setStatus("Cloud unavailable — read only", "warn");
    }
  }

  startPolling(ms = 15000) {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.pollOnce(), ms);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
