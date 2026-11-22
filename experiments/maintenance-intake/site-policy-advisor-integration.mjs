/**
 * BPP POLICY ADVISOR — UNDEPLOYED SITE INTEGRATION CANDIDATE.
 * Intended for the public BPP website after separate site-hostname Turnstile
 * registration and end-to-end testing. NOT a drop-in production replacement.
 *
 * The present BPP website calls an older Advisor with {question} only.
 * The secure Worker requires {question,turnstileToken}. Do not just swap URL.
 * No management-suite identity or resident login is needed for policy questions.
 */
const DEFAULT_TIMEOUT_MS = 57000;
const MAX_QUESTION = 2000;
const text = (el,value) => { if(el) el.textContent = value; };
const errorMessage = (status) => {
  if(status===403) return 'Browser verification was not accepted. Please try again.';
  if(status===429) return 'The Policy Advisor is busy or has reached its usage limit. Please try again later.';
  if(status===503) return 'The Policy Advisor is temporarily unavailable. Please try again later.';
  return 'We could not complete your question. Please try again later.';
};
export function assertAdvisorConfiguration({endpoint,siteKey,expectedPageHostname},hostname){
  const parsed=new URL(endpoint);
  if(parsed.protocol!=='https:') throw new Error('HTTPS is required');
  if(!siteKey || !/^0x[\w-]+$/.test(siteKey)) throw new Error('Turnstile site key is missing');
  if(!expectedPageHostname || expectedPageHostname!==hostname) throw new Error('Advisor page hostname must match its configured verification hostname');
  if(/bpp-resident-policy-advisor\.glwjrmi\.workers\.dev/.test(parsed.hostname)) throw new Error('Legacy Policy Advisor endpoint is not Turnstile-enabled');
  return parsed.href;
}
/**
 * Pure request implementation for an already acquired Turnstile token.
 * UI code must reset the token after every attempt; tokens are single use.
 */
export async function requestAdvisor({endpoint,question,token,fetcher=fetch,timeoutMs=DEFAULT_TIMEOUT_MS}){
  if(typeof question!=='string'||!question.trim()||question.trim().length>MAX_QUESTION)
    return {ok:false,status:400,message:'Enter a question of 2,000 characters or fewer.'};
  if(typeof token!=='string'||!token.trim())
    return {ok:false,status:403,message:'Please verify your browser before asking a question.'};
  const controller=new AbortController();
  let timer;
  try{
    timer=setTimeout(()=>controller.abort(),timeoutMs);
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:question.trim(),turnstileToken:token.trim()}),signal:controller.signal,cache:'no-store'});
    let payload;
    try{payload=await response.json()}catch{payload=null}
    if(!response.ok)return {ok:false,status:response.status,message:errorMessage(response.status)};
    if(!payload || typeof payload.answer!=='string'||!payload.answer.trim())
      return {ok:false,status:502,message:'No answer was returned. Please try again later.'};
    const sourceDocuments=Array.isArray(payload.sourceDocuments)
      ?[...new Set(payload.sourceDocuments.filter(s=>typeof s==='string'&&s.trim()).map(s=>s.trim().slice(0,160)))].slice(0,8):[];
    return {ok:true,status:200,answer:payload.answer.trim(),sourceDocuments};
  }catch{
    return {ok:false,status:504,message:'The search took too long or could not connect. Please try again later.'};
  }finally{clearTimeout(timer)}
}
/**
 * Wires the existing public site's policyQuestion/policyAnswer/policyAskButton
 * elements without modifying any authoritative Suite state or policies.
 * Configuration must be supplied explicitly. Server must verify Turnstile's
 * returned hostname against the actual page host, not the staging host.
 */
export function mountResidentAdvisor({endpoint,siteKey,expectedPageHostname,turnstile,fetcher}){
  assertAdvisorConfiguration({endpoint,siteKey,expectedPageHostname},location.hostname);
  if(!turnstile || typeof turnstile.render!=='function'||typeof turnstile.reset!=='function')
    throw new Error('Turnstile has not loaded');
  const question=document.getElementById('policyQuestion');
  const answer=document.getElementById('policyAnswer');
  const button=document.getElementById('policyAskButton');
  if(!question||!answer||!button)throw new Error('Existing BPP site form not found');
  const widget=document.createElement('div');
  widget.id='bpp-policy-turnstile';
  widget.setAttribute('aria-label','Browser verification');
  button.parentNode.insertBefore(widget,button);
  const widgetId=turnstile.render(widget,{sitekey:siteKey,theme:'auto'});
  // Prevent the original inline onclick from running the legacy endpoint.
  button.removeAttribute('onclick');
  let busy=false;
  async function submit(){
    if(busy)return;
    busy=true;button.disabled=true;
    text(button,'Searching…');
    answer.style.display='block';
    text(answer,'Searching the governing documents. This may take a little while…');
    try{
      const token=turnstile.getResponse(widgetId);
      const result=await requestAdvisor({endpoint,question:question.value,token,fetcher});
      if(result.ok){
        text(answer,result.answer+(result.sourceDocuments.length?'\n\nDocuments consulted: '+result.sourceDocuments.join('; '):''));
      }else{
        text(answer,result.message);
      }
    }finally{
      try{turnstile.reset(widgetId)}catch{}
      busy=false;button.disabled=false;text(button,'Ask Resident Policy Advisor');
    }
  }
  button.addEventListener('click',submit);
  return {submit,widgetId};
}
