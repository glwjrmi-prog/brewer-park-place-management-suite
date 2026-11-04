#!/usr/bin/env python3
"""READ-ONLY audit for legacy PIN hashes in a BPP SQL export.

The SQL is loaded into an in-memory SQLite database; no changes are written
to the source file or any live/connected database. No names, PIN hashes,
account IDs or association records are printed.
"""
import argparse
import json
import sqlite3
from pathlib import Path

SECRET_FIELDS = frozenset(("pinHash", "salt", "passwordHash"))
MODULES = ("maintenance", "projects", "vendors", "violations",
           "inspections", "groundsProjects", "knowledgeBase")

def strip_credentials(data):
    """Return a non-mutating credential-stripped copy of a state JSON object."""
    clean = json.loads(json.dumps(data))
    access = clean.get("_access")
    if isinstance(access, dict) and isinstance(access.get("users"), list):
        for user in access["users"]:
            if isinstance(user, dict):
                for field in SECRET_FIELDS:
                    user.pop(field, None)
    return clean

def audit(sql_path):
    path = Path(sql_path)
    if path.suffix.lower() != ".sql":
        raise ValueError("Expected a .sql export file")
    con = sqlite3.connect(":memory:")
    con.executescript(path.read_text(encoding="utf-8"))
    counts = {"snapshots": 0, "legacy_hashes": 0, "legacy_salts": 0,
              "account_entries": 0, "revisions": 0, "record_preservation_checks": 0}
    for table in ("current_state", "state_revisions"):
        rows = con.execute("SELECT state_json FROM " + table)
        for (raw,) in rows:
            original = json.loads(raw)
            clean = strip_credentials(original)
            users = (original.get("_access") or {}).get("users") or []
            counts["snapshots"] += 1
            counts["revisions"] += int(table == "state_revisions")
            counts["account_entries"] += len(users)
            counts["legacy_hashes"] += sum("pinHash" in x for x in users if isinstance(x, dict))
            counts["legacy_salts"] += sum("salt" in x for x in users if isinstance(x, dict))
            # All non-credential user/profile fields and all association data
            # must remain byte-equivalent at the JSON-value level.
            comparison = strip_credentials(original)
            if clean != comparison:
                raise AssertionError("Unexpected credential-stripping mismatch")
            a = dict(original); a.pop("_access", None)
            b = dict(clean); b.pop("_access", None)
            if a != b:
                raise AssertionError("Non-access association state changed")
            for name in MODULES:
                if original.get(name) != clean.get(name):
                    raise AssertionError("Protected module changed: " + name)
            counts["record_preservation_checks"] += 1
    con.close()
    return counts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Read-only historical PIN hash audit")
    parser.add_argument("export", help="local SQL export; never submit secrets")
    args = parser.parse_args()
    print(json.dumps(audit(args.export), indent=2))
