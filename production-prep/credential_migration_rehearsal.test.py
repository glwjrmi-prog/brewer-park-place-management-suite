import json
import sqlite3
import unittest
from credential_migration_rehearsal import rehearse

class CredentialMigrationTest(unittest.TestCase):
    def test_full_revision_history_credential_only_rewrite(self):
        c=sqlite3.connect(":memory:")
        c.executescript("""
            CREATE TABLE current_state (revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT,counts_json TEXT);
            CREATE TABLE state_revisions (revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT,counts_json TEXT);
            CREATE TABLE audit_events (id INTEGER PRIMARY KEY,details_json TEXT);
            INSERT INTO audit_events VALUES(1,'{"event":"saved"}');
        """)
        import hashlib
        for table,rev in (("state_revisions",1),("state_revisions",2),("current_state",3)):
            data={"_access":{"users":[{"id":"synthetic","name":"User","active":True,
                     "pinHash":"fake-fast-verifier","salt":"fake-salt"}]},
                  "maintenance":[{"id":"WO-01","notes":"Preserve this"}],
                  "projects":[{"id":"P-1"}],"groundsProjects":[{"id":"G-1"}],
                  "recoveryMetadata":{"fixed":True}}
            raw=json.dumps(data)
            c.execute("INSERT INTO "+table+" VALUES(?,?,?,?)",
                      (rev,raw,hashlib.sha256(raw.encode()).hexdigest(),
                       json.dumps({"maintenance":1,"projects":1})))
        c.commit()
        summary=rehearse(c)
        self.assertEqual(summary["snapshots_checked"],3)
        self.assertEqual(summary["legacy_verifiers_removed_in_memory"],3)
        self.assertEqual(summary["revised_checksums_verified"],3)
        self.assertEqual(summary["historical_revisions"],2)
        for table in ("state_revisions","current_state"):
            for (raw,) in c.execute("SELECT state_json FROM "+table):
                data=json.loads(raw)
                self.assertEqual(data["maintenance"][0]["notes"],"Preserve this")
                self.assertEqual(data["projects"][0]["id"],"P-1")
                self.assertEqual(data["groundsProjects"][0]["id"],"G-1")
                self.assertEqual(data["recoveryMetadata"],{"fixed":True})
                self.assertNotIn("pinHash",data["_access"]["users"][0])
                self.assertNotIn("salt",data["_access"]["users"][0])
        self.assertEqual(c.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0],1)
        # Idempotence: no credentials resurrected and snapshots still valid
        again=rehearse(c)
        self.assertEqual(again["legacy_verifiers_removed_in_memory"],0)
        self.assertEqual(again["snapshots_checked"],3)
    def test_rejects_mismatched_original_checksum(self):
        c=sqlite3.connect(":memory:")
        c.execute("CREATE TABLE current_state (revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT,counts_json TEXT)")
        c.execute("CREATE TABLE state_revisions (revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT,counts_json TEXT)")
        c.execute("CREATE TABLE audit_events (id INTEGER PRIMARY KEY)")
        c.execute("INSERT INTO current_state VALUES(1,'{}','bad','{}')")
        with self.assertRaisesRegex(RuntimeError,"checksum mismatch"):
            rehearse(c)
if __name__=="__main__":
    unittest.main()
