"""Offline SQLite smoke test for verified Board review, replay, and draft uniqueness.
This does NOT run on Cloudflare D1, and never touches real HOA state.
"""
import sqlite3
con=sqlite3.connect(':memory:')
con.executescript("""
CREATE TABLE intake_requests (id TEXT PRIMARY KEY,version INTEGER NOT NULL,status TEXT NOT NULL,responsibility TEXT,priority TEXT,review_notes TEXT,resident_message TEXT,board_actor TEXT,reviewed_at TEXT);
CREATE TABLE intake_events (id INTEGER PRIMARY KEY,request_id TEXT,event_type TEXT,actor_role TEXT,actor_name TEXT,event_at TEXT,details_json TEXT);
CREATE TABLE staged_work_order_drafts (id TEXT PRIMARY KEY,intake_request_id TEXT UNIQUE,created_by TEXT,created_at TEXT);
ALTER TABLE intake_requests ADD COLUMN verified_board_user_id TEXT;
CREATE INDEX idx_bpp_intake_verified_board ON intake_requests(verified_board_user_id);
INSERT INTO intake_requests(id,version,status) VALUES('BPP-STG-example',1,'pending_board_review');
""")
review="UPDATE intake_requests SET status='reviewed', responsibility=?,priority=?,review_notes=?,resident_message=?,board_actor=?,verified_board_user_id=?,reviewed_at=?,version=version+1 WHERE id=? AND version=? AND status='pending_board_review'"
event="INSERT INTO intake_events(request_id,event_type,actor_role,actor_name,event_at,details_json) SELECT id,'board_reviewed','board',?, ?, ? FROM intake_requests WHERE id=? AND version=? AND status='reviewed' AND board_actor=? AND verified_board_user_id=? AND reviewed_at=? AND NOT EXISTS(SELECT 1 FROM intake_events WHERE request_id=? AND event_type='board_reviewed' AND event_at=?)"
a=('association','routine','notes','response','Verified Admin','usr-123456789abc','2026-11-24T20:00:00Z','BPP-STG-example',1)
b=('Verified Admin','2026-11-24T20:00:00Z','{}','BPP-STG-example',2,'Verified Admin','usr-123456789abc','2026-11-24T20:00:00Z','BPP-STG-example','2026-11-24T20:00:00Z')
with con:
 assert con.execute(review,a).rowcount==1
 assert con.execute(event,b).rowcount==1
assert con.execute('SELECT version FROM intake_requests').fetchone()[0]==2
with con:
 assert con.execute(review,a).rowcount==0
 assert con.execute(event,b).rowcount==0
assert con.execute('SELECT count(*) FROM intake_events').fetchone()[0]==1
with con: assert con.execute(review,a[:-1]+(0,)).rowcount==0
assert con.execute('SELECT verified_board_user_id FROM intake_requests').fetchone()[0]=='usr-123456789abc'
draft="INSERT INTO staged_work_order_drafts(id,intake_request_id,created_by,created_at) SELECT ?,id,?,? FROM intake_requests WHERE id=? AND version=? AND status='reviewed' AND responsibility='association' AND reviewed_at IS NOT NULL AND board_actor IS NOT NULL AND verified_board_user_id IS NOT NULL"
with con: assert con.execute(draft,('BPP-DRAFT-one','Verified Admin','2026-11-24','BPP-STG-example',2)).rowcount==1
try:
 with con: con.execute(draft,('BPP-DRAFT-two','Verified Admin','2026-11-24','BPP-STG-example',2))
 assert False,'duplicate draft unexpectedly accepted'
except sqlite3.IntegrityError: pass
assert con.execute('SELECT count(*) FROM staged_work_order_drafts').fetchone()[0]==1
print('PASS: offline SQLite staging review and draft transaction checks')
