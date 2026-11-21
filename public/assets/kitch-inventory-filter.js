/* KITCH inventory search fallback, separate from legacy inline handler.
   Keeps filtered rows out of layout even when legacy CSS overrides row display. */
(() => {
 'use strict';
 const STYLE_ID='kitch-inventory-search-guard';
 if(!document.getElementById(STYLE_ID)){
   const style=document.createElement('style');
   style.id=STYLE_ID;
   style.textContent='.kitchInventory .inventoryTableWrap tr.ingredientRow.kitch-search-no-match{display:none!important;visibility:collapse!important}';
   document.head.appendChild(style);
 }
 function update(input){
   if(!input||input.id!=='ingredientSearch')return;
   const area=input.closest('.kitchInventory');
   if(!area)return;
   const query=input.value.trim().toLocaleLowerCase();
   const rows=area.querySelectorAll('.inventoryTableWrap tr.ingredientRow');
   let matches=0;
   rows.forEach(row=>{
     const value=[row.dataset.name,row.dataset.category,row.cells?.[0]?.textContent,row.cells?.[1]?.textContent]
       .filter(Boolean).join(' ').toLocaleLowerCase();
     const show=!query||value.includes(query);
     row.classList.toggle('kitch-search-no-match',!show);
     row.hidden=!show;
     row.style.setProperty('display',show?'table-row':'none','important');
     if(show)matches++;
   });
   let message=area.querySelector('#kitchIngredientSearchStatus');
   if(!message){
     message=document.createElement('p');
     message.id='kitchIngredientSearchStatus';
     message.setAttribute('role','status');
     message.setAttribute('aria-live','polite');
     message.style.cssText='margin:8px 0 12px;font-size:12px;color:#777;';
     input.insertAdjacentElement('afterend',message);
   }
   message.textContent=query?(matches+' matching ingredient'+(matches===1?'':'s')):'';
 }
 document.addEventListener('input',e=>{
   const input=e.target;
   if(input?.id==='ingredientSearch'){
     update(input);
     requestAnimationFrame(()=>{if(input.isConnected)update(input);});
   }
 },true);
 document.addEventListener('change',e=>{if(e.target?.id==='ingredientSearch')update(e.target)},true);
 document.addEventListener('search',e=>{if(e.target?.id==='ingredientSearch')update(e.target)},true);
 window.kitchInventorySearchDiagnostic=()=>{
   const input=document.getElementById('ingredientSearch');
   update(input);
   return {scriptLoaded:true,query:input?.value||'',rows:document.querySelectorAll('.kitchInventory .ingredientRow').length,hidden:document.querySelectorAll('.kitchInventory .ingredientRow.kitch-search-no-match').length};
 };
})();
