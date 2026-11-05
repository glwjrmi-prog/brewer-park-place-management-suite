#!/usr/bin/env python3
"""BPP credential-history migration REHEARSAL ONLY.

Loads a Wrangler SQL export into private in-memory SQLite. Rewrites only
legacy credential fields in current_state and state_revisions in memory,
recomputes SHA256 state checksums, checks all non-credential state is identical,
and prints aggregate totals. Never writes, imports, or modifies production.
No confidential data is logged or committed to source control.
"""
import argparse
import hashlib
import json
import sqlite3

CREDENTIAL_FIELDS = frozenset(("pinHash", "salt", "passwordHash"))
MODULES = ("maintenance", "violations", "projects", "inspections", "vendors",
           "groundsProjects", "knowledgeBase", "recoveryMetadata", "meta", "_sync")

def public_state(state):
    """Keep all data; strip only legacy verifiers from user profiles."""
    d = json.loads(json.dumps(state))
    users = d.get("_access", {}).get("users", [])
    for user in users:
        for key in CREDENTIAL_FIELDS:
            user.pop(key, None)
    return d

def noncredential_identity(state):
    """Canonical JSON for everything except deprecated credential properties."""
    return json.dumps(public_state(state), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def rehearse(con):
    initial_integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    if initial_integrity != "ok":
        raise RuntimeError("Source SQL integrity failure")
    original_tables = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    initial_counts = {}
    for table in ("current_state", "state_revisions", "audit_events"):
        initial_counts[table] = con.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
    summary = {"snapshots_checked": 0, "legacy_verifiers_removed_in_memory": 0,
               "records_preserved": 0, "revised_checksums_verified": 0,
               "historical_revisions": initial_counts["state_revisions"]}
    before_ids = {}
    for table in ("current_state", "state_revisions"):
        records = list(con.execute(
            "SELECT revision,state_json,checksum,counts_json FROM " + table + " ORDER BY revision"
        ))
        revisions = [r[0] for r in records]
        if len(set(revisions)) != len(revisions):
            raise RuntimeError("Duplicate revision")
        before_ids[table] = tuple(revisions)
        for rev, raw, checksum, counts_json in records:
            if hashlib.sha256(raw.encode("utf-8")).hexdigest() != checksum:
                raise RuntimeError("Pre-migration checksum mismatch")
            state = json.loads(raw)
            expected_counts = json.loads(counts_json)
            for name, n in expected_counts.items():
                if isinstance(state.get(name), list) and len(state[name]) != n:
                    raise RuntimeError("Stored collection-count mismatch")
            users = state.get("_access", {}).get("users", [])
            old = sum("pinHash" in u for u in users)
            clean = public_state(state)
            assert noncredential_identity(state) == noncredential_identity(clean)
            for module in MODULES:
                if state.get(module) != clean.get(module):
                    raise RuntimeError("Association data changed")
            # Preserve the original profile order and all noncredential fields.
            assert [u.get("id") for u in users] == [u.get("id") for u in clean.get("_access", {}).get("users", [])]
            updated_json = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
            new_checksum = hashlib.sha256(updated_json.encode("utf-8")).hexdigest()
            con.execute("UPDATE " + table + " SET state_json=?,checksum=? WHERE revision=?",
                        (updated_json, new_checksum, rev))
            summary["snapshots_checked"] += 1
            summary["legacy_verifiers_removed_in_memory"] += old
            summary["records_preserved"] += sum(len(clean.get(k, [])) for k in MODULES if isinstance(clean.get(k), list))
        con.commit()
    for table in ("current_state", "state_revisions"):
        records = con.execute("SELECT revision,state_json,checksum FROM " + table + " ORDER BY revision")
        new_ids = []
        for rev, raw, checksum in records:
            new_ids.append(rev)
            if hashlib.sha256(raw.encode("utf-8")).hexdigest() != checksum:
                raise RuntimeError("Post-migration checksum failure")
            if any(key in u for u in json.loads(raw).get("_access", {}).get("users", [])
                   for key in CREDENTIAL_FIELDS):
                raise RuntimeError("Legacy credential persisted")
            summary["revised_checksums_verified"] += 1
        if tuple(new_ids) != before_ids[table]:
            raise RuntimeError("Snapshot revisions changed")
    if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("In-memory database integrity failure")
    if original_tables != con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
        raise RuntimeError("Tables changed")
    for table, before in initial_counts.items():
        if con.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] != before:
            raise RuntimeError("Database row count changed")
    return summary

def audit_export(path):
    con = sqlite3.connect(":memory:")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            con.executescript(fh.read())
        return rehearse(con)
    finally:
        con.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="In-memory ONLY BPP history migration rehearsal")
    parser.add_argument("export", help="private local SQL file to inspect without modifying")
    args = parser.parse_args()
    print(json.dumps(audit_export(args.export), indent=2))
