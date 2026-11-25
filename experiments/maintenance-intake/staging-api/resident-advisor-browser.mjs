// BPP Resident Policy Advisor browser-call candidate. PROTECTED DEVELOPMENT ONLY.
// Verified the live website's existing interface: POST root path with {question}.
// This module is not referenced by the live site and has no deployment action.
export const LIVE_ADVISOR_URL='https://bpp-resident-policy-advisor.glwjrmi.workers.dev/';
export class ResidentAdvisorError extends Error {
 constructor(code){
  super(code==='TIMEOUT'?'The Policy Advisor is taking longer than expected. Please try again later.':'The Policy Advisor is temporarily unavailable. Please try again later.');
  this.name='ResidentAdvisorError';this.code=code;
 }
}
export async function requestResidentAdvice(question,{fetcher=fetch,timeoutMs=30000,signal}={}){
 if(typeof question!=='string'||!question.trim()||question.trim().length>2000)throw new ResidentAdvisorError('INVALID_QUESTION');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new ResidentAdvisorError('INVALID_TIMEOUT');
 const controller=new AbortController(),onAbort=()=>controller.abort();
 if(signal?.aborted)throw new ResidentAdvisorError('CANCELED');
 signal?.addEventListener('abort',onAbort,{once:true});
 let expired=false;
 const timer=setTimeout(()=>{expired=true;controller.abort()},timeoutMs);
 try {
  const response=await fetcher(LIVE_ADVISOR_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:question.trim()}),signal:controller.signal});
  if(!response?.ok)throw new ResidentAdvisorError('HTTP_ERROR');
  // Body read is inside the same timeout scope.
  const data=await response.json();
  if(typeof data?.answer!=='string'||!data.answer.trim()||data.answer.length>50000)throw new ResidentAdvisorError('BAD_ANSWER');
  return data.answer.trim();
 }catch(e){
  if(e instanceof ResidentAdvisorError)throw e;
  throw new ResidentAdvisorError(expired?'TIMEOUT':signal?.aborted?'CANCELED':'NETWORK_ERROR');
 }finally{
  clearTimeout(timer);
  signal?.removeEventListener('abort',onAbort);
 }
}
