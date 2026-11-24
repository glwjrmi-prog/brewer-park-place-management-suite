"""Offline SQLite test of import SQL contract. NOT a Cloudflare D1 test."""
import sqlite3,json
def db():
 c=sqlite3.connect(':memory:',isolation_level=None)
 c.executescript("""
 CREATE TABLE current_state(singleton_id INTEGER PRIMARY KEY,revision INTEGER,state_json TEXT,checksum TEXT,counts_json TEXT,updated_at TEXT,updated_by TEXT,reason TEXT);
 CREATE TABLE state_revisions(revision INTEGER PRIMARY KEY,state_json TEXT,checksum TEXT,counts_json TEXT,saved_at TEXT,saved_by TEXT,reason TEXT);
 CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT,revision INTEGER,actor TEXT,created_at TEXT,details_json TEXT);
 CREATE TABLE work_order_import_links(source_request_id TEXT PRIMARY KEY NOT NULL,source_draft_id TEXT NOT NULL UNIQUE,work_order_id TEXT NOT NULL UNIQUE,production_revision INTEGER NOT NULL,approved_by_user_id TEXT NOT NULL,imported_at TEXT NOT NULL);
 INSERT INTO current_state VALUES(1,18,'{"maintenance":[{"id":"WO-2026-091"}],"vendors":[1]}','old','{"maintenance":1}','yesterday','Board','Last save');
 """)
 return c
def commit(c,src='source1',draft='draft1',wo='WO-2026-092',rev=18):
 data=json.loads(c.execute('SELECT state_json FROM current_state').fetchone()[0])
 data['maintenance'].append({'id':wo,'sourceIntakeId':src})
 c.execute('BEGIN IMMEDIATE')
 try:
  changes=[
   c.execute('INSERT INTO work_order_import_links(source_request_id,source_draft_id,work_order_id,production_revision,approved_by_user_id,imported_at) SELECT ?,?,?,?,?,? FROM current_state WHERE singleton_id=1 AND revision=?',(src,draft,wo,rev+1,'usr-123456789abc','now',rev)).rowcount,
   c.execute('INSERT INTO state_revisions(revision,state_json,checksum,counts_json,saved_at,saved_by,reason) SELECT revision,state_json,checksum,counts_json,updated_at,updated_by,reason FROM current_state WHERE singleton_id=1 AND revision=?',(rev,)).rowcount,
   c.execute('UPDATE current_state SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason=? WHERE singleton_id=1 AND revision=?',(rev+1,json.dumps(data),'hash','{"maintenance":2}','now','Verified Board','Import',rev)).rowcount,
   c.execute("INSERT INTO audit_events(event_type,revision,actor,created_at,details_json) SELECT 'work-order-import',?,?,?,? FROM work_order_import_links WHERE source_request_id=? AND production_revision=?",(rev+1,'Verified Board','now','{}',src,rev+1)).rowcount]
  if changes!=[1,1,1,1]:raise RuntimeError('Unexpected affected rows: '+str(changes))
  c.execute('COMMIT')
 except Exception:
  c.execute('ROLLBACK')
  raise
c=db();commit(c)
assert c.execute('SELECT revision FROM current_state').fetchone()[0]==19
assert c.execute('SELECT COUNT(*) FROM audit_events').fetchone()[0]==1
try:commit(c,src='source2',draft='draft2',wo='WO-2026-093',rev=18)
except RuntimeError:pass
else:raise AssertionError('stale revision accepted')
for src,draft,wo in [('source1','draft2','WO-2026-093'),('source2','draft1','WO-2026-093'),('source2','draft2','WO-2026-092')]:
 try:commit(c,src,draft,wo,19)
 except sqlite3.IntegrityError:pass
 else:raise AssertionError('duplicate accepted')
assert c.execute('SELECT revision FROM current_state').fetchone()[0]==19
assert c.execute('SELECT COUNT(*) FROM work_order_import_links').fetchone()[0]==1
assert c.execute('SELECT COUNT(*) FROM state_revisions').fetchone()[0]==1
assert json.loads(c.execute('SELECT state_json FROM current_state').fetchone()[0])['vendors']==[1]
print('PASS: SQLite rollback, stale revision, unique source/draft/work-order, audit, module preservation')
