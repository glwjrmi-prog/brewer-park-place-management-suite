// BPP Policy Advisor upstream diagnosis — STAGING-ONLY MODULE, NOT DEPLOYED.
// Does not inspect, echo, persist, log, return or expose the API key.
// Designed to run on a private staging duplicate of the real Policy Advisor Worker.
// No governing-documents claims. Not a replacement for the live Worker.
const API='https://api.openai.com/v1/responses';
const allowedCodes=new Set(['insufficient_quota','credit_balance_exhausted','invalid_api_key','authentication_error','rate_limit_exceeded','model_not_found','invalid_request_error','server_error','billing_hard_limit_reached','permission_denied']);
const stageLabel={basic:'basic_model',web:'web_search_tool'};
export class ProbeFailure extends Error{
 constructor(kind,status=null,code=null){super('Upstream diagnostic failed');this.name='ProbeFailure';this.kind=kind;this.status=status;this.code=code}
}
function parseCode(data){
 const raw=data?.error?.code;
 return typeof raw==='string'&&allowedCodes.has(raw)?raw:null;
}
function classify(status,code){
 if(status===401||status===403)return 'AUTH_OR_PERMISSIONS';
 if(status===429)return code==='insufficient_quota'||code==='credit_balance_exhausted'?'QUOTA_OR_BILLING':'RATE_LIMIT_OR_QUOTA';
 if(status>=500)return 'PROVIDER_ERROR';
 return 'PROVIDER_HTTP_ERROR';
}
export async function probeOpenAI({
 env,mode='basic',fetcher=fetch,timeoutMs=12000,clock=()=>Date.now()
}={}){
 if(!env?.OPENAI_API_KEY||typeof env.OPENAI_API_KEY!=='string')return {step:stageLabel[mode]||'unknown',ok:false,kind:'MISSING_SECRET_BINDING'};
 if(!stageLabel[mode])throw new Error('Invalid diagnostic mode');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('Invalid timeout');
 const started=clock(),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const body={
   model:env.ADVISOR_DIAGNOSTIC_MODEL||'gpt-5',
   input:'Reply exactly with OK.',
   store:false,
   max_output_tokens:64
 };
 if(mode==='web')body.tools=[{type:'web_search'}];
 try{
   const response=await fetcher(API,{
     method:'POST',
     headers:{'Authorization':'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
     body:JSON.stringify(body),signal:controller.signal
   });
   // Parse only for safe summary values; never copy response body or answer into logs.
   let data=null;
   try{data=await response.json()}catch{}
   if(!response.ok){
     const code=parseCode(data);
     return {step:stageLabel[mode],ok:false,kind:classify(response.status,code),httpStatus:response.status,providerCode:code,elapsedMs:clock()-started};
   }
   return {step:stageLabel[mode],ok:true,kind:'PROVIDER_ACCEPTED',httpStatus:response.status,elapsedMs:clock()-started,outputReturned:Array.isArray(data?.output)};
 }catch(e){
   return {step:stageLabel[mode],ok:false,kind:controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR',elapsedMs:clock()-started};
 }finally{clearTimeout(timer)}
}
export async function diagnoseProvider(env,opts={}){
 // Sequential tests to avoid concurrent calls; do not run web search if basic test already fails.
 const basic=await probeOpenAI({env,...opts,mode:'basic'});
 if(!basic.ok)return {basic,web:null,inference:'BASE_MODEL_OR_AUTH_PROBLEM'};
 const web=await probeOpenAI({env,...opts,mode:'web'});
 return {basic,web,inference:web.ok?'BASIC_AND_WEB_TOOL_AVAILABLE':'WEB_TOOL_OR_LONG_RUNNING_REQUEST_PROBLEM'};
}
