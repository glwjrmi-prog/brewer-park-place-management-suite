import assert from 'node:assert/strict';
import {validateVerifiedImport,importTransactionStatements,assertSuccess} from './secure-import-v2.mjs';
const source={sourceId:'BPP-STG-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',draftId:'BPP-DRAFT-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',status:'reviewed',responsibility:'association',verifiedBoardUserId:'usr-123456789abc',boardActor:'Verified Board',reviewedAt:'2026-11-24T19:00:00Z'};
const principal={id:'usr-123456789abc',role:'admin'};
const valid={source,principal,revision:18,expectedRevision:18,explicitConfirmation:true};
assert.equal(validateVerifiedImport(valid),true);
for(const [change,code] of [
 [{principal:{...principal,legacy:true}},'ADMIN_REQUIRED'],
 [{principal:{...principal,role:'user'}},'ADMIN_REQUIRED'],
 [{explicitConfirmation:false},'CONFIRMATION_REQUIRED'],
 [{source:{...source,verifiedBoardUserId:undefined}},'NOT_VERIFIED'],
 [{source:{...source,status:'pending_board_review'}},'NOT_VERIFIED'],
 [{source:{...source,responsibility:'shared_or_disputed'}},'NOT_VERIFIED'],
 [{source:{...source,sourceId:'bad'}},'INVALID_SOURCE'],
 [{revision:17},'REVISION_CONFLICT']
])assert.throws(()=>validateVerifiedImport({...valid,...change}),{code});
const q=[];const db={prepare(sql){return{bind(...values){q.push({sql,values});return{sql,values}}}}};
const stmts=importTransactionStatements(db,{sourceId:source.sourceId,draftId:source.draftId,workOrderId:'WO-2026-092',baseRevision:18,approvedByUserId:principal.id,newStateJson:'{}',checksum:'hash',countsJson:'{}',at:'2026-11-24T19:00:00Z',actor:'Verified Board',reason:'Board-approved work order import',auditJson:'{}'});
assert.equal(stmts.length,4);
assert.match(q[0].sql,/INSERT INTO work_order_import_links/);
assert.match(q[2].sql,/WHERE singleton_id=1 AND revision=\?/);
assert.equal(q[0].values[4],principal.id);
assert.equal(assertSuccess(Array.from({length:4},()=>({meta:{changes:1}}))),true);
assert.throws(()=>assertSuccess(Array.from({length:4},()=>({meta:{changes:0}}))),{code:'TRANSACTION_NOT_COMMITTED'});
console.log('PASS: secure import v2 guards, SQL construction and result checks; offline only');
