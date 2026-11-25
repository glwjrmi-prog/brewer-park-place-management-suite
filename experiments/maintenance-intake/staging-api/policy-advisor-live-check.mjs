// Read-only Policy Advisor live handshake from GitHub CI. No personal information.
import assert from 'node:assert/strict';
import {askAdvisor,ADVISOR_URL} from './policy-advisor.mjs';
const timeout=AbortSignal.timeout(15000);
try {
 const response=await askAdvisor({area:'Common area / grounds',category:'Landscaping / grounds',fetcher:(url,opts)=>fetch(url,{...opts,signal:timeout}),signal:timeout});
 assert.equal(response.source.includes('unverified'),true);
 assert.ok(response.answer.length>0);
 assert.ok(response.answer.length<=20000);
 console.log(JSON.stringify({status:'PASS',endpoint:ADVISOR_URL,method:'POST',responseShape:'JSON answer string',answerCharacters:response.answer.length,contentVerified:false,residentDataTransmitted:false}));
} catch (err) {
 console.error(JSON.stringify({status:'FAIL',endpoint:ADVISOR_URL,error:err?.name||'Policy Advisor connection error',contentVerified:false}));
 process.exitCode=1;
}
