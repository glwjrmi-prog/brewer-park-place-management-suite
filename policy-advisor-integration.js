/* Brewer Park Place Management Suite v8.33 — Live Policy Advisor integration
   Data-safety design: this file does not alter state storage, record schemas,
   backup/restore logic, cloud sync, or saved records. It only fills the existing
   violation form fields before the user chooses Save. The v8.19 local catalog
   remains available as a fallback. */
(function(){
  'use strict';

  const ENDPOINT='https://bpp-resident-policy-advisor.glwjrmi.workers.dev/';
  const localRun = typeof window.policyRunSuggestion === 'function' ? window.policyRunSuggestion : null;
  const localSuggest = typeof window.policySuggestForViolation === 'function' ? window.policySuggestForViolation : null;
  const localApply = typeof window.policyApplySuggestion === 'function' ? window.policyApplySuggestion : null;

  function escHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function setBox(html){
    const box=document.getElementById('policyAssistResult');
    if(box) box.innerHTML=html;
  }

  function setField(id,value){
    const el=document.getElementById(id);
    if(el && value != null) el.value=String(value).trim();
  }

  function extractSection(answer, heading, nextHeadings){
    const text=String(answer||'');
    const next=(nextHeadings||[]).map(h=>h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    const re=new RegExp('(?:^|\\n)\\s*'+heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[:\\-]?\\s*\\n?([\\s\\S]*?)'+(next?'(?=\\n\\s*(?:'+next+')\\s*[:\\-]?|$)':'$'),'i');
    const m=text.match(re);
    return m ? m[1].trim() : '';
  }

  function firstSentence(text){
    const clean=String(text||'').replace(/\s+/g,' ').trim();
    if(!clean) return '';
    const m=clean.match(/^(.{1,500}?[.!?])(?:\s|$)/);
    return (m?m[1]:clean.slice(0,500)).trim();
  }

  function parseAdvisorAnswer(answer){
    const text=String(answer||'').replace(/\r/g,'').trim();
    const answerSection=extractSection(text,'ANSWER',['GOVERNING PROVISIONS','REASONING','ANALYSIS','CONCLUSION']);
    const provisions=extractSection(text,'GOVERNING PROVISIONS',['REASONING','ANALYSIS','CONCLUSION','ANSWER']);

    const lines=(provisions||text).split('\n')
      .map(s=>s.replace(/^\s*[-•*]\s*/,'').trim())
      .filter(Boolean);

    const bylawLines=[];
    const ruleLines=[];
    const otherCitationLines=[];
    for(const line of lines){
      if(/\bbylaws?\b/i.test(line)) bylawLines.push(line);
      if(/rules?\s*(?:&|and)\s*regulations?|rules?\s*§|rules?\s*#/i.test(line)) ruleLines.push(line);
      if(/master deed|article\s+[ivxlcdm]+|section\s+\d|§/i.test(line)) otherCitationLines.push(line);
    }

    const unique = arr => [...new Set(arr)];
    const bylaws=unique(bylawLines).join(' • ');
    const rules=unique(ruleLines).join(' • ');
    const combined=unique([...bylawLines,...ruleLines,...otherCitationLines]).slice(0,8).join(' • ');
    const description=answerSection || firstSentence(text);

    let title='Live Policy Advisor Review';
    const titleMatch=text.match(/(?:POLICY TITLE|APPLICABLE (?:RULE|POLICY))\s*:\s*([^\n]+)/i);
    if(titleMatch && titleMatch[1].trim()) title=titleMatch[1].trim();

    return {title,bylaws,rules,combined,description,fullAnswer:text};
  }

  async function askLiveAdvisor(description){
    const question=[
      'Management Suite violation-rule review.',
      'A Brewer Park Place violation record contains this factual description:',
      '"'+description+'"',
      '',
      'Using only the Brewer Park Place governing documents available to the Resident Policy Advisor, identify the rule or governing provision that most directly applies.',
      'Please begin with a concise ANSWER, then list GOVERNING PROVISIONS with exact document/article/section or rule-number citations, followed by brief REASONING.',
      'Do not assume facts that are not stated. If the description is too vague for a reliable match, say that clearly rather than guessing.'
    ].join('\n');

    const response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question})
    });
    let data={};
    try{ data=await response.json(); }catch(_){ }
    if(!response.ok) throw new Error(data.error||('Policy Advisor returned '+response.status));
    const answer=String(data.answer||'').trim();
    if(!answer) throw new Error('No answer was returned by the Policy Advisor.');
    return answer;
  }

  async function livePolicyRunSuggestion(){
    const description=(document.getElementById('field_violation')?.value||'').trim();
    if(!description){
      setBox('<div class="policyAssistWarn">Enter the violation description first.</div>');
      return;
    }

    const btn=document.getElementById('policySuggestBtn');
    const oldText=btn?.textContent||'Find Applicable Rule';
    if(btn){ btn.disabled=true; btn.textContent='Checking Policy Advisor…'; }
    setBox('<span class="policyAssistBadge">Live governing-document review</span><div class="policyAssistSource">Checking the Brewer Park Place Resident Policy Advisor…</div>');

    try{
      const answer=await askLiveAdvisor(description);
      const parsed=parseAdvisorAnswer(answer);

      setField('field_policyTitle',parsed.title);
      if(parsed.bylaws) setField('field_bylawReference',parsed.bylaws);
      if(parsed.rules) setField('field_rulesReference',parsed.rules);
      if(parsed.combined) setField('field_ruleReference',parsed.combined);
      if(parsed.description) setField('field_policyResidentDescription',parsed.description);
      setField('field_policySource','BPP Resident Policy Advisor — live governing-document review');

      setBox(
        '<span class="policyAssistBadge">Live Policy Advisor match</span>'+ 
        '<div class="policyAssistText"><b>'+escHtml(parsed.title)+'</b><br>'+escHtml(parsed.description)+'</div>'+ 
        '<div class="policyAssistSource">'+
          (parsed.bylaws?'<b>Bylaws:</b> '+escHtml(parsed.bylaws)+'<br>':'')+
          (parsed.rules?'<b>Rules & Regulations:</b> '+escHtml(parsed.rules)+'<br>':'')+
          '<b>Source:</b> BPP Resident Policy Advisor (live)</div>'+ 
        '<details style="margin-top:9px"><summary style="cursor:pointer;font-size:11px;font-weight:800">View full Policy Advisor analysis</summary><div class="policyAssistText">'+escHtml(parsed.fullAnswer)+'</div></details>'+ 
        '<div class="policyAssistWarn">Review the live analysis before saving. The form fields above remain editable.</div>'
      );
    }catch(err){
      if(localRun){
        try{ localRun(); }catch(_){ }
        const box=document.getElementById('policyAssistResult');
        if(box){
          box.insertAdjacentHTML('beforeend','<div class="policyAssistWarn"><b>Live Policy Advisor unavailable.</b> The existing built-in rule catalog was used as a fallback. Confirm the citation before saving.</div>');
        }
      }else{
        setBox('<div class="policyAssistWarn"><b>Live Policy Advisor unavailable.</b> '+escHtml(err?.message||err)+'</div>');
      }
    }finally{
      if(btn){ btn.disabled=false; btn.textContent=oldText; }
    }
  }

  // Manual lookup uses the live Policy Advisor. Auto-suggest while typing stays
  // on the original local catalog so ordinary typing does not repeatedly call the network.
  window.policyRunSuggestion=livePolicyRunSuggestion;
  window.bindViolationPolicyAssist=function(){
    const btn=document.getElementById('policySuggestBtn');
    const violation=document.getElementById('field_violation');
    if(btn){
      btn.textContent='Check Live Policy Advisor';
      btn.onclick=livePolicyRunSuggestion;
    }
    if(violation && violation.dataset.policyAssistBound!=='1'){
      violation.dataset.policyAssistBound='1';
      let timer=null;
      violation.addEventListener('input',()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>{
          const ref=document.getElementById('field_ruleReference');
          const bylaw=document.getElementById('field_bylawReference');
          const rules=document.getElementById('field_rulesReference');
          if(!String(ref?.value||'').trim()&&!String(bylaw?.value||'').trim()&&!String(rules?.value||'').trim() && localRun){
            try{ localRun(); }catch(_){ }
          }
        },650);
      });
    }
  };

  // If a violation modal is already open when this enhancement loads, bind it now.
  if(document.getElementById('policySuggestBtn')) window.bindViolationPolicyAssist();

  // Relabel any newly rendered violation form and keep version text current.
  const observer=new MutationObserver(()=>{
    const btn=document.getElementById('policySuggestBtn');
    if(btn && btn.dataset.livePolicyBound!=='1'){
      btn.dataset.livePolicyBound='1';
      btn.textContent='Check Live Policy Advisor';
      btn.onclick=livePolicyRunSuggestion;
    }
    const head=document.querySelector('.policyAssistHead .muted');
    if(head && !head.dataset.livePolicyLabel){
      head.dataset.livePolicyLabel='1';
      head.textContent='Typing uses the built-in quick-match catalog; this button verifies the violation against the live BPP Policy Advisor.';
    }
    document.querySelectorAll('.versionBadge').forEach(el=>{
      if(/v8\.32/i.test(el.innerHTML)) el.innerHTML=el.innerHTML.replace(/v8\.32/gi,'v8.33');
    });
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  // Version label only; no stored state or schemas are changed.
  try{
    document.title=document.title.replace(/v8\.32/i,'v8.33');
    document.querySelectorAll('.versionBadge').forEach(el=>{
      el.innerHTML=el.innerHTML.replace(/v8\.32/gi,'v8.33');
    });
  }catch(_){ }

  console.info('BPP Management Suite v8.33 live Policy Advisor integration loaded.');
})();
