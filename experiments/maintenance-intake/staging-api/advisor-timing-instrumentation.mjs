// BPP Policy Advisor timed-request instrumentation, STAGING ONLY.
// Wraps an EXISTING outbound fetch; does not create a new API key, change model,
// modify input, copy governing documents or alter HTTP transport behavior.
// Never log Authorization headers, URLs with query strings, request/response bodies,
// answers, secrets, user questions, unit numbers, or raw exceptions.
export function redactlessTimings({fetcher=fetch,emit=()=>{},clock=()=>Date.now()}={}){
 return async function timedFetch(url,options={}){
  const start=clock();
  let phase='request_start';
  const safe=(kind,details={})=>{
   // Explicit fields only. No spread from exceptions, headers or responses.
   emit({type:'bpp_advisor_upstream',kind,elapsedMs:Math.max(0,clock()-start),...details});
  };
  safe('request_start');
  try{
   const response=await fetcher(url,options);
   phase='response_headers';
   safe('response_headers',{httpStatus:response.status});
   // Wrapping response body is intentionally not done: leave original response
   // object and stream untouched for normal consumption by its caller.
   return response;
  }catch(err){
   safe('request_failed',{phase,errorClass:options.signal?.aborted?'ABORTED':'FETCH_FAILED'});
   throw err;
  }
 };
}
export async function readAdvisorResponse(response,{emit=()=>{},clock=()=>Date.now()}={}){
 const start=clock();
 const log=(kind,details={})=>emit({type:'bpp_advisor_upstream',kind,bodyElapsedMs:Math.max(0,clock()-start),...details});
 try{
  const payload=await response.json();
  const output=typeof payload?.answer==='string'&&payload.answer.trim().length>0;
  log('response_body_complete',{responseType:output?'answer':'other',answerLength:output?payload.answer.length:0});
  return payload;
 }catch(err){
  log('response_body_failed',{errorClass:'BODY_READ_FAILED'});
  throw err;
 }
}
export function createStructuredReporter(consoleLike){
 return entry=>consoleLike.log(JSON.stringify(entry));
}
