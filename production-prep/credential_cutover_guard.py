#!/usr/bin/env python3
"""Read-only BPP PIN cutover safety guard. Never modifies database or files.

Expect this guard to BLOCK on the original production SQL backup: it does not
yet contain the peppered credential tables. It is designed for a later verified
candidate copy after enrollment and credential-history sanitation.
"""
import argparse
import hashlib
import json
import re
import sqlite3

def review(con):
    table_names={r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    reasons=[]
    required={"current_state","state_revisions","audit_events","pin_credentials","pin_sessions_v2"}
    for missing in sorted(required-table_names):
        reasons.append("missing table: "+missing)
    if "current_state" not in table_names:
        return {"ready":False,"issues":reasons}
    state_row=con.execute("SELECT state_json,checksum FROM current_state WHERE singleton_id=1").fetchone()
    if state_row is None:
        reasons.append("missing current state")
        return {"ready":False,"issues":reasons}
    raw, stored=state_row
    if hashlib.sha256(raw.encode("utf-8")).hexdigest()!=stored:
        reasons.append("current state checksum mismatch")
    profiles=json.loads(raw).get("_access",{}).get("users",[])
    active=[u for u in profiles if u.get("active",True) is not False]
    if len({u.get("id") for u in profiles})!=len(profiles):
        reasons.append("duplicate user IDs")
    if not any(u.get("role")=="admin" for u in active):
        reasons.append("no active administrator")
    for u in profiles:
        if any(k in u for k in ("pinHash","salt","passwordHash")):
            reasons.append("legacy PIN verifiers remain in current state")
            break
    if "state_revisions" in table_names:
        for raw,stored in con.execute("SELECT state_json,checksum FROM state_revisions"):
            if hashlib.sha256(raw.encode("utf-8")).hexdigest()!=stored:
                reasons.append("historical snapshot checksum mismatch")
                break
            if any(any(k in u for k in ("pinHash","salt","passwordHash"))
                   for u in json.loads(raw).get("_access",{}).get("users",[])):
                reasons.append("legacy PIN verifiers remain in history")
                break
    if "pin_credentials" in table_names:
        credentials={r[0]:r[1:] for r in
                     con.execute("SELECT user_id,salt,verifier,iterations,source_pin_hash FROM pin_credentials")}
        for u in active:
            user_id=u.get("id")
            cred=credentials.get(user_id)
            if cred is None:
                reasons.append("active account lacks server-side credential")
                continue
            salt,verifier,iterations,source=cred
            if not re.fullmatch(r"[0-9a-f]{48}",salt or "") or not re.fullmatch(r"[0-9a-f]{64}",verifier or ""):
                reasons.append("invalid server-side verifier format")
            if iterations!=100000:
                reasons.append("unexpected verifier cost")
            if source:
                reasons.append("fast source PIN hashes remain in verifier table")
    return {"ready":not reasons,"active_accounts_checked":len(active),
            "history_checked":"state_revisions" in table_names,
            "issues":sorted(set(reasons))}

def review_export(path):
    con=sqlite3.connect(":memory:")
    try:
        with open(path,encoding="utf-8") as f:con.executescript(f.read())
        return review(con)
    finally:con.close()

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Read-only cutover readiness guard")
    parser.add_argument("export",help="private local .sql export to check in memory")
    args=parser.parse_args()
    result=review_export(args.export)
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result["ready"] else 2)
