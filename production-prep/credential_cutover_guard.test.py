import hashlib
import json
import sqlite3
import unittest
from credential_cutover_guard import review

def fixture():
    c=sqlite3.connect(':memory:')
    c.executescript("""
    CREATE TABLE current_state(singleton_id INTEGER PRIMARY KEY,revision INTEGER,state_json TEXT,checksum TEXT);
    CREATE TABLE state_revisions(revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY);
    CREATE TABLE pin_credentials(user_id TEXT PRIMARY KEY,salt TEXT,verifier TEXT,iterations INTEGER,source_pin_hash TEXT);
    CREATE TABLE pin_sessions_v2(token_hash TEXT PRIMARY KEY,user_id TEXT);
    CREATE TABLE pin_attempts(identifier TEXT PRIMARY KEY,failures INTEGER,locked_until INTEGER);
    """)
    state={"_access":{"users":[{"id":"synthetic-admin","name":"Admin","role":"admin","active":True},
                                {"id":"synthetic-user","name":"Member","role":"user","active":True}]},
           "maintenance":[{"id":"WO-01"}],"projects":[{"id":"P-01"}]}
    raw=json.dumps(state)
    hash_value=hashlib.sha256(raw.encode()).hexdigest()
    c.execute("INSERT INTO current_state VALUES(1,2,?,?)",(raw,hash_value))
    c.execute("INSERT INTO state_revisions VALUES(1,?,?)",(raw,hash_value))
    for user_id in ("synthetic-admin","synthetic-user"):
        c.execute("INSERT INTO pin_credentials VALUES(?,?,?,?,?)",
                  (user_id,"a"*48,"b"*64,100000,""))
    c.commit()
    return c

class CutoverGuard(unittest.TestCase):
    def test_valid_credential_only_snapshot(self):
        result=review(fixture())
        self.assertTrue(result["ready"],result)
        self.assertEqual(result["active_accounts_checked"],2)

    def test_absent_credential_is_a_blocker(self):
        c=fixture()
        c.execute("DELETE FROM pin_credentials WHERE user_id='synthetic-user'")
        result=review(c)
        self.assertFalse(result["ready"])
        self.assertIn("active account lacks server-side credential",result["issues"])

    def test_legacy_hash_in_history_blocks_release(self):
        c=fixture()
        raw=json.loads(c.execute("SELECT state_json FROM state_revisions").fetchone()[0])
        raw["_access"]["users"][0]["pinHash"]="a"*64
        value=json.dumps(raw)
        c.execute("UPDATE state_revisions SET state_json=?,checksum=?",
                  (value,hashlib.sha256(value.encode()).hexdigest()))
        result=review(c)
        self.assertFalse(result["ready"])
        self.assertIn("legacy PIN verifiers remain in history",result["issues"])

    def test_source_hash_or_bad_checksum_blocks_release(self):
        c=fixture()
        c.execute("UPDATE pin_credentials SET source_pin_hash='old-fast-hash' WHERE user_id='synthetic-user'")
        c.execute("UPDATE current_state SET checksum='wrong'")
        result=review(c)
        self.assertFalse(result["ready"])
        self.assertIn("fast source PIN hashes remain in verifier table",result["issues"])
        self.assertIn("current state checksum mismatch",result["issues"])

if __name__=='__main__':
    unittest.main()
