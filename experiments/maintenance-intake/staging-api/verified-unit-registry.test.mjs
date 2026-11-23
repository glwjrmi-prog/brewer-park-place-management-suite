import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {activeUnitsForVerifiedEmail,authorizeUnitOrDeny,RegistryUnavailableError} from './verified-unit-registry.mjs';
function isolated(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./verified-unit-registry.schema.sql',import.meta.url),'utf8'));
 const wrapper={prepare(sql){return {bind(...params){return {async all(){return {results:db.prepare(sql).all(...params)}}}}}}};
 return {db,wrapper};
}
test('active Board-authorized unit rights are isolated by verified email',async()=>{
 const {db,wrapper}=isolated();
 try{
  const write=db.prepare('INSERT INTO intake_verified_unit_access(verified_email,unit_id,active,approved_by,approved_at,revoked_at) VALUES(?,?,?,?,?,?)');
  write.run('ownerA@example.test','Unit 101',1,'board-1','2026-11-23T15:00:00Z',null);
  write.run('ownerA@example.test','Unit 102',1,'board-1','2026-11-23T15:00:00Z',null);
  write.run('ownerB@example.test','Unit 103',1,'board-2','2026-11-23T15:00:00Z',null);
  write.run('past@example.test','Unit 104',0,'board-2','2026-11-23T15:00:00Z','2026-11-23T15:01:00Z');
  assert.deepEqual(await activeUnitsForVerifiedEmail(wrapper,'OWNERA@example.test'),['Unit 101','Unit 102']);
  assert.equal(await authorizeUnitOrDeny(wrapper,'ownerA@example.test','Unit 103'),false);
  assert.equal(await authorizeUnitOrDeny(wrapper,'ownerA@example.test','Unit 101'),true);
  assert.equal(await authorizeUnitOrDeny(wrapper,'missing@example.test','Unit 101'),false);
  assert.deepEqual(await activeUnitsForVerifiedEmail(wrapper,'past@example.test'),[]);
  db.prepare('UPDATE intake_verified_unit_access SET active=0,revoked_at=? WHERE verified_email=? AND unit_id=?')
    .run('2026-11-23T15:02:00Z','ownerA@example.test','Unit 101');
  assert.equal(await authorizeUnitOrDeny(wrapper,'ownerA@example.test','Unit 101'),false);
 }finally{db.close()}
});
test('missing or unusable private registry never grants resident access',async()=>{
 const {db,wrapper}=isolated();
 try{
  assert.equal(await authorizeUnitOrDeny(wrapper,'ownerA@example.test','Unit 101'),false);
  assert.equal(await authorizeUnitOrDeny(wrapper,'ownerA@example.test','Unit 101\nX'),false);
  assert.rejects(()=>activeUnitsForVerifiedEmail({prepare(){throw Error('db down')}},'ownerA@example.test'),RegistryUnavailableError);
  assert.rejects(()=>activeUnitsForVerifiedEmail(wrapper,'not-email'),RegistryUnavailableError);
  assert.throws(()=>db.prepare('INSERT INTO intake_verified_unit_access(verified_email,unit_id,active) VALUES(?,?,1)').run('x@ex.test','Unit 999'));
 }finally{db.close()}
});
