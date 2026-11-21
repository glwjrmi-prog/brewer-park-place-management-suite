// Read-only diagnostic for existing BPP Resident Policy Advisor.
// Does not send resident/unit/name/contact information; logs metadata only.
const url='https://bpp-resident-policy-advisor.glwjrmi.workers.dev/';
async function check(label,options,timeoutMs){
 const start=Date.now();
 try{
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});
  const elapsedMs=Date.now()-start;
  const text=await response.text();
  let data=null;try{data=JSON.parse(text)}catch{}
  const summary={
   step:label,transport:'response',httpStatus:response.status,elapsedMs,
   contentType:response.headers.get('content-type'),
   responseLength:text.length,
   bodyType:data===null?'non-json':typeof data,
   responseKeys:data&&typeof data==='object'?Object.keys(data).slice(0,10):[],
   answerLength:typeof data?.answer==='string'?data.answer.length:null,
   errorCategory:data?.error? 'application-error':null,
  };
  console.log(JSON.stringify(summary));
  return {ok:response.ok,elapsedMs,answered:typeof data?.answer==='string'&&data.answer.trim().length>0};
 }catch(e){
  const elapsedMs=Date.now()-start;
  console.log(JSON.stringify({step:label,transport:'failure',elapsedMs,errorName:e?.name||'Unknown',errorCode:e?.cause?.code||null}));
  return {ok:false,elapsedMs,answered:false};
 }
}
const get=await check('GET health',{method:'GET'},12000);
const question=[
 'General association maintenance policy question, no resident case information.',
 'For exterior common-area landscaping maintenance at Brewer Park Place,',
 'which governing documents should a board member consult?',
 'If source text is unavailable, say that it cannot be verified.',
].join(' ');
const post=await check('POST generic policy question',{
 method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({question}),
},45000);
console.log(JSON.stringify({result:'diagnosis_complete',getResponded:get.ok,postResponded:post.ok,postAnswered:post.answered}));
if(!get.ok||!post.answered)process.exitCode=1;
