import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBoardApprovedRegistry,allowedUnitsForEmail,requireAuthorizedUnit,UnitAuthorizationError} from './unit-authorization.mjs';
const records=[
 {verifiedEmail:'OwnerA@Example.Test',unitId:'Unit 101',active:true,verifiedByBoard:true,approvedBy:'board-1'},
 {verifiedEmail:'ownera@example.test',unitId:'Unit 102',active:true,verifiedByBoard:true,approvedBy:'board-1'},
 {verifiedEmail:'ownerb@example.test',unitId:'Unit 103',active:true,verifiedByBoard:true,approvedBy:'board-2'}
];
test('verified mailbox only receives access to its own approved condo units',()=>{
 const verified=validateBoardApprovedRegistry(records);
 assert.deepEqual(allowedUnitsForEmail(' OwnerA@example.test ',verified),['Unit 101','Unit 102']);
 assert.deepEqual(allowedUnitsForEmail('unknown@example.test',verified),[]);
 assert.equal(requireAuthorizedUnit({verifiedEmail:'OWNERA@example.test',requestedUnit:'Unit 101',registry:records}),'Unit 101');
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'ownera@example.test',requestedUnit:'Unit 103',registry:records}),UnitAuthorizationError);
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'unknown@example.test',requestedUnit:'Unit 101',registry:records}),UnitAuthorizationError);
});
test('self-reported unit association, inactive and unverified Board rows fail closed',()=>{
 for(const bad of [
  [{...records[0],active:false}],
  [{...records[0],verifiedByBoard:false}],
  [{...records[0],approvedBy:''}],
  [{...records[0],verifiedEmail:'spoof'}],
  [records[0],{...records[0],verifiedEmail:'ownera@example.test'}]
 ])assert.throws(()=>validateBoardApprovedRegistry(bad),UnitAuthorizationError);
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'ownera@example.test',requestedUnit:'Unit 101',registry:[]}),UnitAuthorizationError);
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'ownera@example.test',requestedUnit:'Unit 101',registry:undefined}),UnitAuthorizationError);
});
test('a resident cannot inject an unapproved unit into their own request',()=>{
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'ownera@example.test',requestedUnit:'Unit 999',registry:records}),UnitAuthorizationError);
 assert.throws(()=>requireAuthorizedUnit({verifiedEmail:'ownera@example.test',requestedUnit:'Unit 101\nX',registry:records}),UnitAuthorizationError);
});
