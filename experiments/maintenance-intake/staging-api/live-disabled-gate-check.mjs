// Remote non-mutating smoke check: the staged resident intake must stay disabled.
// Only GET /health and GET / are used. No resident data, secrets, or tokens.
const base='https://bpp-maintenance-intake-staging.glwjrmi.workers.dev';
for(const route of ['/health','/']){
 const response=await fetch(base+route,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000)});
 const raw=await response.text();
 let data;try{data=JSON.parse(raw)}catch{throw Error('Non-JSON response on '+route)};
 if(response.status!==503||data?.error!=='Private staging disabled'){
  throw Error('Staging security gate mismatch at '+route+': HTTP '+response.status+' body='+JSON.stringify(data).slice(0,150));
 }
 console.log('PASS: public '+route+' fails closed with HTTP 503');
}
