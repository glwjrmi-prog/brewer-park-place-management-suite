import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from credential_history_dry_run import strip_credentials, audit

class CredentialHistoryDryRunTest(unittest.TestCase):
    def test_retains_all_noncredential_modules(self):
        data = {
            "_access":{"users":[{"id":"synthetic","name":"Test","role":"user",
                                 "pinHash":"fake-test-hash","salt":"fake-test-salt"}]},
            "maintenance":[{"id":"WO-001"}],"groundsProjects":[{"id":"GP-1"}],
            "knowledgeBase":[{"id":"KB-1"}],"recoveryMetadata":{"retain":True}}
        copy = json.loads(json.dumps(data))
        cleaned = strip_credentials(data)
        self.assertEqual(data, copy, "Source mutated")
        self.assertNotIn("pinHash", cleaned["_access"]["users"][0])
        self.assertNotIn("salt", cleaned["_access"]["users"][0])
        for key in ("maintenance","groundsProjects","knowledgeBase","recoveryMetadata"):
            self.assertEqual(data[key], cleaned[key])

    def test_sql_export_is_scanned_readonly(self):
        con = sqlite3.connect(":memory:")
        con.execute("CREATE TABLE current_state(state_json TEXT)")
        con.execute("CREATE TABLE state_revisions(state_json TEXT)")
        raw = json.dumps({"_access":{"users":[{"id":"test","pinHash":"fakehash","salt":"fakesalt"}]},
                          "maintenance":[{"id":"WO-test"}],"groundsProjects":[]})
        con.execute("INSERT INTO current_state VALUES (?)",(raw,))
        con.execute("INSERT INTO state_revisions VALUES (?)",(raw,))
        con.commit()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"synthetic.sql"
            path.write_text("\n".join(con.iterdump()),encoding="utf-8")
            before=path.read_bytes()
            result=audit(path)
            self.assertEqual(path.read_bytes(),before)
        self.assertEqual(result["snapshots"],2)
        self.assertEqual(result["revisions"],1)
        self.assertEqual(result["legacy_hashes"],2)
        self.assertEqual(result["legacy_salts"],2)
        self.assertEqual(result["record_preservation_checks"],2)

if __name__=="__main__":
    unittest.main()
