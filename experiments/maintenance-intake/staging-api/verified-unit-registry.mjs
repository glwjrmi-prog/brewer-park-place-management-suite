// Staging ONLY: Board-approved unit access from a dedicated intake D1 table.
// No production Suite or resident directory reads, no self-registered memberships.
// A short-lived mailbox session proves mailbox control, not an active unit right.
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const unitPattern=/^[a-zA-Z0-9][a-zA-Z0-9 _./#-]{0,79}$/;
export class RegistryUnavailableError extends Error {
 constructor(){super('Verified unit registry unavailable');this.name='RegistryUnavailableError'}
}
const emailOf=value=>typeof value==='string'&&value.length<=254&&emailPattern.test(value.trim().toLowerCase())?value.trim().toLowerCase():null;
const unitOf=value=>typeof value==='string'&&value===value.trim()&&unitPattern.test(value)?value:null;
export async function activeUnitsForVerifiedEmail(db,email){
 const normalized=emailOf(email);
 if(!normalized||!db?.prepare)throw new RegistryUnavailableError();
 let response;
 try{
  response=await db.prepare('SELECT unit_id AS unitId, approved_by AS approvedBy FROM intake_verified_unit_access WHERE verified_email=? AND active=1 AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND revoked_at IS NULL ORDER BY unit_id ASC LIMIT 100').bind(normalized).all();
 }catch{throw new RegistryUnavailableError()}
 if(!response||!Array.isArray(response.results))throw new RegistryUnavailableError();
 const unique=new Map();
 for(const row of response.results){
  if(!unitOf(row.unitId)||!/^[-_a-zA-Z0-9]{1,100}$/.test(String(row.approvedBy||'')))throw new RegistryUnavailableError();
  const key=row.unitId.toLowerCase();
  if(unique.has(key))throw new RegistryUnavailableError();
  unique.set(key,row.unitId);
 }
 return Object.freeze([...unique.values()]);
}
export async function authorizeUnitOrDeny(db,email,requestedUnit){
 const requested=unitOf(requestedUnit);
 if(!requested)return false;
 const allowed=await activeUnitsForVerifiedEmail(db,email);
 return allowed.some(unit=>unit.toLowerCase()===requested.toLowerCase());
}
