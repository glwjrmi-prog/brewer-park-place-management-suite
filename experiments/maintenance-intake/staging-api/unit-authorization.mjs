// BPP maintenance intake — ownership authorization adapter, source only.
// A valid email session proves control of a mailbox, NOT ownership of a condo.
// This module must be supplied a trusted, Board-approved unit registry backend.
// No actual resident/unit mappings are stored here. Never trust a unit supplied
// by the resident, a self-declared browser role, or a Client-Side access list.
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export class UnitAuthorizationError extends Error{
 constructor(code){super(code);this.name='UnitAuthorizationError';this.code=code;}
}
function normalizedEmail(value){
 if(typeof value!=='string')return null;
 const email=value.trim().toLowerCase();
 return email.length<=254&&emailPattern.test(email)?email:null;
}
function validUnitId(value){return typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9 _./#-]{0,79}$/.test(value)&&value===value.trim();}
export function validateBoardApprovedRegistry(rows){
 if(!Array.isArray(rows)||rows.length>1000)throw new UnitAuthorizationError('INVALID_REGISTRY');
 const seen=new Set(),normalized=[];
 for(const row of rows){
  const email=normalizedEmail(row?.verifiedEmail),unit=String(row?.unitId??''),approvedBy=row?.approvedBy;
  if(!email||!validUnitId(unit)||!/^[a-zA-Z0-9_-]{1,100}$/.test(String(approvedBy||''))||row?.active!==true||row?.verifiedByBoard!==true)
   throw new UnitAuthorizationError('UNVERIFIED_UNIT_ASSIGNMENT');
  const key=email+'\u0000'+unit.toLowerCase();
  if(seen.has(key))throw new UnitAuthorizationError('DUPLICATE_UNIT_ASSIGNMENT');
  seen.add(key);
  normalized.push(Object.freeze({email,unitId:unit,approvedBy}));
 }
 return Object.freeze(normalized);
}
export function allowedUnitsForEmail(email,verifiedAssignments){
 const owner=normalizedEmail(email);
 if(!owner)throw new UnitAuthorizationError('INVALID_EMAIL');
 if(!Array.isArray(verifiedAssignments))throw new UnitAuthorizationError('INVALID_REGISTRY');
 const allowed=new Map();
 for(const record of verifiedAssignments){
  if(record?.email===owner&&validUnitId(record.unitId))
   allowed.set(record.unitId.toLowerCase(),record.unitId);
 }
 return Object.freeze([...allowed.values()]);
}
export function requireAuthorizedUnit({verifiedEmail,requestedUnit,registry}){
 const units=allowedUnitsForEmail(verifiedEmail,validateBoardApprovedRegistry(registry));
 const wanted=String(requestedUnit??'').trim().toLowerCase();
 if(!validUnitId(String(requestedUnit??''))||!units.some(u=>u.toLowerCase()===wanted))
  throw new UnitAuthorizationError('UNIT_NOT_AUTHORIZED');
 return units.find(u=>u.toLowerCase()===wanted);
}
