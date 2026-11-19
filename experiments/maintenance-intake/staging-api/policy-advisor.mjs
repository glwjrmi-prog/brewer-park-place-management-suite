// BPP Policy Advisor integration for ISOLATED maintenance intake staging.
// Based on current Suite policy-advisor-integration.js protocol: POST {question}, response {answer}.
// NOT a source of verified law or governing citations; board must check original documents.
// No resident email, unit, name, raw issue narrative or attachment is transmitted.
export const ADVISOR_URL='https://bpp-resident-policy-advisor.glwjrmi.workers.dev/';
const categories=new Set(['Exterior trim / paint','Siding','Roof / gutters','Doors / windows','Landscaping / grounds','Drainage / water','Sidewalk / pavement','Other']);
const areas=new Set(['Exterior of unit','Common area / grounds','Interior of unit']);
export function advisorQuestion(area,category){
 if(!areas.has(area)||!categories.has(category))throw new Error('Unknown area/category');
 return [
  'Brewer Park Place board maintenance responsibility review. This is a GENERAL question, not a specific resident case.',
  'Maintenance category: '+category+'.',
  'Area type: '+area+'.',
  'Using ONLY the BPP governing documents you can actually access, including any Maintenance Matrix that is available to you, explain which provisions MAY govern who maintains or repairs this type of item.',
  'Use headings ANSWER, GOVERNING PROVISIONS, REASONING.',
  'Quote precise source document names and article/section numbers only when located in those documents; otherwise say that the precise citation is unverified.',
  'List what further facts or inspection would be needed before allocating responsibility.',
  'This is preliminary, board-internal advice and not an HOA determination.'
 ].join('\n');
}
export async function askAdvisor({area,category,fetcher=fetch,signal}){
 const question=advisorQuestion(area,category);
 const response=await fetcher(ADVISOR_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question}),signal});
 if(!response?.ok)throw new Error('Policy Advisor request failed');
 const data=await response.json();
 if(typeof data?.answer!=='string'||!data.answer.trim()||data.answer.length>20000)throw new Error('Policy Advisor returned an invalid answer');
 return {answer:data.answer.trim(),source:'BPP Policy Advisor — unverified board-internal suggestion',question};
}
