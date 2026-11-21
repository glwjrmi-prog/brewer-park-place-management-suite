// Safe read-only test: determine which Resident Advisor POST route is supported.
// Questions are generic; no resident data or answers are logged.
const base='https://bpp-resident-policy-advisor.glwjrmi.workers.dev';
const question='General informational question: which governing documents should a Brewer Park Place board member review for common-area maintenance? Do not guess specific citations.';
for (const path of ['/ask']) {
  const start=Date.now(),ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),12000);
  try{
    const resp=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question}),signal:ctrl.signal});
    const raw=await resp.text();let json=null;
    try{json=JSON.parse(raw)}catch{}
    console.log(JSON.stringify({route:path,status:resp.status,elapsedMs:Date.now()-start,contentType:resp.headers.get('content-type'),bodyKind:typeof json?.answer==='string'?'answer':typeof json?.error==='string'?'error':'other',answerLength:typeof json?.answer==='string'?json.answer.length:null,errorCode:json?.error?.code||null}));
  }catch(e){
    console.log(JSON.stringify({route:path,outcome:'failed',elapsedMs:Date.now()-start,errorType:e?.name||'network_error'}));
  }finally{clearTimeout(timer)}
}
