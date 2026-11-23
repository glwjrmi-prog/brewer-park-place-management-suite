import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('one-pass bootstrap creates isolated intake and resident auth tables without production links',()=>{
 const sql=readFileSync(new URL('./bootstrap-new-d1.sql',import.meta.url),'utf8');
 assert.match(sql,/bpp-maintenance-intake-isolated-staging/);
 assert.doesNotMatch(sql,/ATTACH\\s+DATABASE/i);
 const db=new DatabaseSync(':memory:');
 db.exec(sql);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
 for(const name of ['intake_requests','intake_events','intake_resident_updates','urgent_alert_outbox','staged_work_order_drafts','intake_policy_advice','resident_email_challenges','resident_email_sessions'])assert.ok(names.includes(name),name);
 const columns=db.prepare('PRAGMA table_info(intake_requests)').all().map(x=>x.name);
 for(const name of ['submitter_email','resident_message','version'])assert.ok(columns.includes(name),name);
 assert.equal(db.prepare('SELECT count(*) AS n FROM intake_requests').get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM resident_email_challenges').get().n,0);
 db.close();
});
