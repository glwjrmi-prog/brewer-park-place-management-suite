// NON-MUTATING BPP public Policy Advisor verification.
// One GET only. No question POST, API key, secret, resident data, or quota use.
// This does not establish deployed source version or document currency.
const target='https://bpp-resident-advisor-public.glwjrmi.workers.dev/';
const controller=AbortSignal.timeout(15000);
const response=await fetch(target,{method:'GET',redirect:'error',signal:controller,headers:{accept:'text/html'}});
const type=response.headers.get('content-type')||'';
const html=await response.text();
const checks={
 httpOK:response.status===200,
 html:type.includes('text/html')||/^\s*<!doctype html/i.test(html),
 hasQuestionInput:/(<textarea\b|<input\b)[^>]*(?:question|ask|prompt)|(?:question|ask|prompt)[\s\S]{0,400}<textarea\b/i.test(html),
 hasTurnstile:/(turnstile|challenges\.cloudflare\.com\/turnstile)/i.test(html),
 noProductionKeyPrompt:!/enter (?:your )?(?:openai|api|production) key/i.test(html)
};
console.log('BPP public Policy Advisor non-mutating GET:',JSON.stringify({http:response.status,checks}));
if(!checks.httpOK||!checks.html||!checks.hasQuestionInput||!checks.hasTurnstile||!checks.noProductionKeyPrompt)
 process.exitCode=1;
