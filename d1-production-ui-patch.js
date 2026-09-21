// Brewer Park Place Management Suite v9 production presentation cleanup
(function(){
  'use strict';
  function apply(){
    document.querySelectorAll('.versionBadge').forEach(el=>{
      el.innerHTML='<b>Version 9.0</b>';
    });
    document.querySelectorAll('.sideNote').forEach(el=>{
      if(el.textContent.trim()==='Export backups regularly.') el.textContent='Protected cloud data · automatic revision safety';
    });
    document.querySelectorAll('.muted').forEach(el=>{
      if(el.textContent.includes('Management Suite · Version 8.29')) el.textContent=el.textContent.replace('Version 8.29','Version 9.0');
    });
  }
  const obs=new MutationObserver(()=>apply());
  if(document.body) obs.observe(document.body,{childList:true,subtree:true});
  setTimeout(apply,0);
})();
