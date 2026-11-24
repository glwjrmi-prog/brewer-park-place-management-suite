/** BPP offline-only import contract. NO routes, network or DB writes.
 * Production must independently read the staging record over server binding,
 * authenticate PIN administrator, and obtain explicit Board confirmation. */
export const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS work_order_import_links (
  source_request_id TEXT PRIMARY KEY NOT NULL,
  source_draft_id TEXT NOT NULL UNIQUE,
  work_order_id TEXT NOT NULL UNIQUE,
  production_revision INTEGER NOT NULL,
  approved_by_user_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
);`;
const sourceID=/^BPP-STG-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const draftID=/^BPP-DRAFT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const userID=/^usr-[a-zA-Z0-9._~-]{8,128}$/;
const woID=/^WO-\d{4}-\d{3,}$/;
const fail=code=>{const e=new Error(code);e.code=code;throw e};
export function validateVerifiedImport({source,principal,revision,expectedRevision,explicitConfirmation}){
  if(!principal||principal.legacy||principal.role!=='admin'||!userID.test(principal.id||''))fail('ADMIN_REQUIRED');
  if(explicitConfirmation!==true)fail('CONFIRMATION_REQUIRED');
  if(!source||!sourceID.test(source.sourceId||'')||!draftID.test(source.draftId||''))fail('INVALID_SOURCE');
  if(source.status!=='reviewed'||source.responsibility!=='association'||!userID.test(source.verifiedBoardUserId||'')||
      typeof source.boardActor!=='string'||!source.boardActor.trim()||!Number.isFinite(Date.parse(source.reviewedAt||'')))fail('NOT_VERIFIED');
  if(!Number.isSafeInteger(revision)||revision<1||revision!==expectedRevision)fail('REVISION_CONFLICT');
  return true;
}
/** Construct statements only. Atomic Cloudflare D1 behavior needs clone testing. */
export function importTransactionStatements(db,{sourceId,draftId,workOrderId,baseRevision,approvedByUserId,
 newStateJson,checksum,countsJson,at,actor,reason,auditJson}){
  if(!db||typeof db.prepare!=='function'||!sourceID.test(sourceId||'')||!draftID.test(draftId||'')||!woID.test(workOrderId||'')||
     !userID.test(approvedByUserId||'')||!Number.isSafeInteger(baseRevision)||baseRevision<1)fail('INVALID_TRANSACTION');
  const next=baseRevision+1;
  return [
    db.prepare(`INSERT INTO work_order_import_links(source_request_id,source_draft_id,work_order_id,production_revision,approved_by_user_id,imported_at)
       SELECT ?,?,?,?,?,? FROM current_state WHERE singleton_id=1 AND revision=?`)
       .bind(sourceId,draftId,workOrderId,next,approvedByUserId,at,baseRevision),
    db.prepare(`INSERT INTO state_revisions(revision,state_json,checksum,counts_json,saved_at,saved_by,reason)
       SELECT revision,state_json,checksum,counts_json,updated_at,updated_by,reason FROM current_state WHERE singleton_id=1 AND revision=?`).bind(baseRevision),
    db.prepare(`UPDATE current_state SET revision=?,state_json=?,checksum=?,counts_json=?,updated_at=?,updated_by=?,reason=?
       WHERE singleton_id=1 AND revision=?`).bind(next,newStateJson,checksum,countsJson,at,actor,reason,baseRevision),
    db.prepare(`INSERT INTO audit_events(event_type,revision,actor,created_at,details_json)
       SELECT 'work-order-import',?,?,?,? FROM work_order_import_links WHERE source_request_id=? AND production_revision=?`)
       .bind(next,actor,at,auditJson,sourceId,next)
  ];
}
export function assertSuccess(results){
 if(!Array.isArray(results)||results.length!==4||!results.every(x=>Number(x?.meta?.changes)===1))fail('TRANSACTION_NOT_COMMITTED');
 return true;
}
