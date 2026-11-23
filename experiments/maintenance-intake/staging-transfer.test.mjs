import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareRevisionCheckedTransfer} from './staging-transfer.mjs';

const source=()=>({
 initialized:true,
 revision:47,
 data:{
  maintenance:[{id:'WO-2026-001',status:'Open',issue:'Existing work remains untouched'},{id:'WO-2026-007',status:'Closed'}],
  projects:[{id:'P1',status:'In progress'}],
  vendors:[{name:'Sample Vendor'}],
  inspections:[],
  _sync:{revision:3}
 }
});
const reviewed=()=>({
 id:'BPP-STG-12345678-1234-4234-9234-123456789abc',
 version:2,
 status:'reviewed',
 boardActor:'Synthetic board reviewer',
 reviewedAt:'2026-11-23T14:00:00Z',
 responsibility:'association',
 priority:'routine',
 category:'Siding',
 unit:'Synthetic Unit 12',
 description:'Loose siding, for testing only'
});
const at=new Date('2026-11-23T16:00:00Z');

test('prepares a single staging append without changing a source snapshot or any Suite module',()=>{
 const snapshot=source(),before=structuredClone(snapshot);
 const proposal=prepareRevisionCheckedTransfer(snapshot,reviewed(),{now:at});
 assert.equal(proposal.mode,'staging_preview_only');
 assert.equal(proposal.expectedSuiteRevision,47);
 assert.equal(proposal.intakeVersion,2);
 assert.equal(proposal.newWorkOrder.id,'WO-2026-008');
 assert.equal(proposal.proposedState.maintenance.length,3);
 assert.deepEqual(snapshot,before);
 assert.deepEqual(proposal.proposedState.projects,snapshot.data.projects);
 assert.deepEqual(proposal.proposedState.vendors,snapshot.data.vendors);
 assert.equal(proposal.proposedState.maintenance[2].intakeRequestId,reviewed().id);
 assert.equal(proposal.allowedOperation,'append_one_reviewed_work_order');
});

test('does not trust stale embedded state revision over authoritative snapshot envelope',()=>{
 const proposal=prepareRevisionCheckedTransfer(source(),reviewed(),{now:at});
 assert.equal(proposal.expectedSuiteRevision,47);
 assert.notEqual(proposal.expectedSuiteRevision,source().data._sync.revision);
});

test('fails closed on unauthenticated, invalid or uninitialized snapshot envelope',()=>{
 for(const snapshot of [null,{}, {initialized:false,revision:4,data:source().data},
  {initialized:true,revision:0,data:source().data},
  {initialized:true,revision:1.25,data:source().data},
  {initialized:true,revision:4,data:{projects:[]}}]){
  assert.throws(()=>prepareRevisionCheckedTransfer(snapshot,reviewed(),{now:at}));
 }
});

test('blocks unreviewed, owner-only, stale update and duplicate linked intake',()=>{
 assert.throws(()=>prepareRevisionCheckedTransfer(source(),{...reviewed(),status:'pending_board_review'},{now:at}),/Board-reviewed/);
 assert.throws(()=>prepareRevisionCheckedTransfer(source(),{...reviewed(),responsibility:'owner'},{now:at}),/Owner-only/);
 assert.throws(()=>prepareRevisionCheckedTransfer(source(),{...reviewed(),version:undefined},{now:at}),/intake version/);
 const duplicate=source();
 duplicate.data.maintenance[0].intakeRequestId=reviewed().id;
 assert.throws(()=>prepareRevisionCheckedTransfer(duplicate,reviewed(),{now:at}),/already linked/);
});
