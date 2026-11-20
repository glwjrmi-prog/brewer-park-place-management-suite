// BPP Policy Advisor: source-preserving, staging-only Responses API request helper.
// Historical Worker design (Aug 2026): POST /v1/responses with instructions,
// input, model, web_search and store:false. This helper does NOT define or alter
// governing-document instructions and does not replace an existing Worker.
// Requires a secure staging duplicate with its original secret bindings.
// NOT DEPLOYED. No client-visible raw OpenAI errors or secret logging.

const ENDPOINT='https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS=25000;
const MAX_TIMEOUT_MS=40000;
const safeStatuses=new Set(['completed','incomplete','failed','cancelled','in_progress','queued']);
export class PolicyProviderError extends Error {
 constructor(reason,status=null){
  super('The Policy Advisor cannot complete this question right now. Please try again later or consult the governing documents.');
  this.name='PolicyProviderError';this.reason=reason;this.status=status;
 }
}
export function extractAnswer(payload){
 if(payload?.status && safeStatuses.has(payload.status)&&payload.status!=='completed')
  throw new PolicyProviderError('RESPONSE_NOT_COMPLETED');
 // Responses API may provide a convenience output_text property, or structured output parts.
 const direct=typeof payload?.output_text==='string'?payload.output_text.trim():'';
 if(direct)return direct;
 const chunks=[];
 for(const item of (Array.isArray(payload?.output)?payload.output:[])){
  if(item?.type!=='message'||item.role!=='assistant'||!Array.isArray(item.content))continue;
  for(const part of item.content){
   if(part?.type==='output_text'&&typeof part.text==='string'&&part.text.trim())chunks.push(part.text);
  }
 }
 const answer=chunks.join('\n').trim();
 if(!answer)throw new PolicyProviderError('EMPTY_OUTPUT');
 return answer;
}
export async function fetchPolicyAnswer({
 apiKey,requestBody,fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS,onPhase=()=>{},
 signal
}={}){
 if(!apiKey||typeof apiKey!=='string')throw new PolicyProviderError('MISSING_SECRET');
 if(!requestBody||typeof requestBody!=='object'||Array.isArray(requestBody))throw new PolicyProviderError('INVALID_REQUEST');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>MAX_TIMEOUT_MS)throw new PolicyProviderError('INVALID_TIMEOUT');
 // Preserve caller-defined model, instructions, input, tools, token limits verbatim;
 // only enforce store:false and never log or echo raw request/answer data.
 const body={...requestBody,store:false};
 const controller=new AbortController();
 const onAbort=()=>controller.abort();
 if(signal?.aborted)throw new PolicyProviderError('ABORTED');
 signal?.addEventListener('abort',onAbort,{once:true});
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const started=Date.now();
 // Always report strictly constant phases, never passing headers or bodies.
 const record=(phase,status)=>onPhase({phase,elapsedMs:Date.now()-started,...(status?{httpStatus:status}:{})});
 try {
  record('upstream_request_start');
  const response=await fetcher(ENDPOINT,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
   body:JSON.stringify(body),signal:controller.signal
  });
  record('upstream_headers_received',response.status);
  // Avoid accidentally returning raw credentials/errors to residents.
  if(!response.ok)throw new PolicyProviderError('UPSTREAM_STATUS',response.status);
  const data=await response.json();
  record('upstream_body_received');
  const answer=extractAnswer(data);
  record('answer_extracted');
  return answer;
 }catch(err){
  if(err instanceof PolicyProviderError){record('upstream_failed',err.status);throw err;}
  const reason=controller.signal.aborted?'TIMEOUT_OR_ABORT':'UPSTREAM_NETWORK_OR_PARSE';
  record('upstream_failed');
  throw new PolicyProviderError(reason);
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
 }
}
