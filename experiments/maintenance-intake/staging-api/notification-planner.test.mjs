import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planUrgentBoardNotifications,classifyProviderResult,NotificationPlanError} from './notification-planner.mjs';
const incident={id:'BPP-STG-12345678-1234-4234-9234-123456789abc',escalation:true,unit:'PRIVATE UNIT',description:'PRIVATE narrative'};
const directory=[
 {id:'board-a',role:'board',active:true,emailVerified:true,verifiedEmail:'boardA@example.test'},
 {id:'board-b',role:'board',active:true,emailVerified:true,verifiedEmail:'boardB@example.test'},
 {id:'board-c',role:'board',active:false,emailVerified:true,verifiedEmail:'former@example.test'},
 {id:'resident-a',role:'resident',active:true,emailVerified:true,verifiedEmail:'resident@example.test'}
];
test('only active verified Board recipients get separate no-PII notification events',()=>{
 const events=planUrgentBoardNotifications(incident,directory);
 assert.equal(events.length,2);
 assert.deepEqual(events.map(x=>x.recipientId),['board-a','board-b']);
 assert.equal(new Set(events.map(x=>x.idempotencyKey)).size,2);
 for(const event of events){
  assert.equal(event.boardAcknowledged,undefined);
  assert.equal(event.state,'pending_provider_delivery');
  assert.equal(JSON.stringify(event).includes('PRIVATE'),false);
  assert.equal(JSON.stringify(event).includes('resident@example.test'),false);
  assert.ok(Object.isFrozen(event));
 }
 assert.ok(Object.isFrozen(events));
});
test('missing, unverified or duplicate active Board recipients fail closed',()=>{
 const bad=[
  [], [{id:'x',role:'resident',active:true,emailVerified:true,verifiedEmail:'res@example.test'}],
  [{id:'x',role:'board',active:true,emailVerified:false,verifiedEmail:'b@example.test'}],
  [{id:'x',role:'board',active:true,emailVerified:true,verifiedEmail:'invalid'}],
  [directory[0],{...directory[0],id:'board-z'}],
  [directory[0],{...directory[0],verifiedEmail:'other@example.test'}]
 ];
 for(const accounts of bad)assert.throws(()=>planUrgentBoardNotifications(incident,accounts),NotificationPlanError);
 assert.throws(()=>planUrgentBoardNotifications({...incident,escalation:false},directory),NotificationPlanError);
});
test('provider accepted is not a board acknowledgement or guarantee of delivery',()=>{
 assert.deepEqual(classifyProviderResult({accepted:true,messageId:'synthetic-provider-id'}),{delivery:'provider_accepted',boardAcknowledged:false});
 assert.deepEqual(classifyProviderResult({accepted:false,messageId:'none'}),{delivery:'not_confirmed',boardAcknowledged:false});
 assert.deepEqual(classifyProviderResult({accepted:true}),{delivery:'not_confirmed',boardAcknowledged:false});
});
