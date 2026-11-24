import assert from 'node:assert/strict';
import {prepareVerifiedReview,handleVerifiedBoardReview} from './verified-review-handler.mjs';
const id='BPP-STG-c60da294-9883-4a12-b462-938027b87db5',actor={userId:'usr-123456789abc',name:'Verified Board Admin',role:'admin'};
const args={requestId:id,identity:actor,body:{version:1,responsibility:'association',priority:'routine',notes:'TEST ONLY',actor:'Forged name',residentMessage:'Forged resident message'},now:1795521600000};
const queries=[],db={prepare(sql){return{bind(...params){queries.push({sql,params});return{sql,params}}}}};
const result=prepareVerifiedReview({...args,db});
assert.equal(result.statements.length,2);
assert.equal(result.verifiedBoardUserId,actor.userId);
assert.match(queries[0].sql,/verified_board_user_id=\?/);
assert.match(queries[0].sql,/status='pending_board_review'/);
assert.equal(queries[0].params[4],actor.name);
assert.equal(queries[0].params[5],actor.userId);
assert.ok(!JSON.stringify(queries).includes('Forged name'));
assert.ok(!JSON.stringify(queries).includes('Forged resident message'));
assert.match(queries[1].sql,/verified_board_user_id=\?/);
assert.throws(()=>prepareVerifiedReview({...args,db,identity:{...actor,role:'user'}}),{code:'NOT_AUTHORIZED'});
assert.throws(()=>prepareVerifiedReview({...args,db,requestId:'bad'}),{code:'INVALID_REQUEST'});
assert.throws(()=>prepareVerifiedReview({...args,db,body:{...args.body,notes:''}}),{code:'INVALID_REVIEW'});
const env={BPP_SUITE_AUTH_ME_URL:'https://bpp-management-suite-production-api.glwjrmi.workers.dev/api/auth/me',
 BPP_SUITE_AUTH:{fetch:async()=>new Response(JSON.stringify({ok:true,user:{id:actor.userId,name:actor.name,role:'admin'}}),{status:200})},
 INTAKE_DB:{...db,batch:async stmts=>stmts.map(()=>({meta:{changes:1}}))}};
const req=new Request('https://example.invalid/review',{headers:{'x-bpp-board-pin-session':'a'.repeat(64)}});
const saved=await handleVerifiedBoardReview({req,env,requestId:id,body:args.body,now:args.now});
assert.equal(saved.verifiedBoardUserId,actor.userId);assert.equal(saved.version,2);
await assert.rejects(()=>handleVerifiedBoardReview({req,env:{...env,INTAKE_DB:{...db,batch:async()=>[{meta:{changes:0}},{meta:{changes:0}}]}},requestId:id,body:args.body,now:args.now}),{code:'VERSION_CONFLICT'});
console.log('PASS: offline verified-review preparation and mock batch checks. No real D1 or production calls.');
