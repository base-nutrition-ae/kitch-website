/* KITCH local multi-item receiving demo. Not a production receiving ledger.
   Loaded after the original KITCH application script. */
(() => {
 'use strict';
 const LOCAL = ['127.0.0.1','localhost'].includes(location.hostname);
 if (!LOCAL) return;
 const units = ['g','kg','ml','ltr','pcs','pkt','box'];
 const safe = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
 const options=(values,selected)=>values.map(u=>'<option value="'+u+'"'+(u===selected?' selected':'')+'>'+u+'</option>').join('');
 let lines=[],counter=0,saving=false;
 const newLine=()=>({key:++counter,id:'',unit:'',qty:'',rejected:'0',price:'',packSize:'',packUnit:'',expiry:'',temperature:'',production:''});
 const ingredientList=()=>ingredients().filter(i=>i.cloud_id).sort((a,b)=>a.name.localeCompare(b.name));
 const findIngredient=id=>ingredientList().find(x=>String(x.cloud_id)===String(id));
 const possibleSizeUnits=b=>['g','kg'].includes(b)?['g','kg']:['ml','ltr','l'].includes(b)?['ml','ltr']:['pcs'];
 function factor(line,base){
   if(!line||!base) return null;
   if(line.unit===base || (['ltr','l'].includes(line.unit)&&['ltr','l'].includes(base)))return 1;
   if(base==='g'&&line.unit==='kg')return 1000;
   if(base==='kg'&&line.unit==='g')return .001;
   if(base==='ml'&&line.unit==='ltr')return 1000;
   if(['ltr','l'].includes(base)&&line.unit==='ml')return .001;
   if(['pkt','box'].includes(line.unit)){
     const n=Number(line.packSize);
     if(!line.packSize || !Number.isFinite(n)||n<=0)return null;
     if(line.packUnit===base || (['ltr','l'].includes(line.packUnit)&&['ltr','l'].includes(base)))return n;
     if(base==='g'&&line.packUnit==='kg')return n*1000;
     if(base==='kg'&&line.packUnit==='g')return n/1000;
     if(base==='ml'&&line.packUnit==='ltr')return n*1000;
     if(['ltr','l'].includes(base)&&line.packUnit==='ml')return n/1000;
   }
   return null;
 }
 function markup(line,i){
   const ing=findIngredient(line.id),base=ing?.base_unit||'g',isPack=['pkt','box'].includes(line.unit);
   const list=ingredientList().map(x=>'<option value="'+safe(x.cloud_id)+'"'+(String(x.cloud_id)===line.id?' selected':'')+'>'+safe(x.name)+'</option>').join('');
   const baseQty=factor(line,base),qty=Number(line.qty||0),rej=Number(line.rejected||0);
   const stock=(baseQty!=null&&qty>=rej && rej>=0)?(qty-rej)*baseQty:null;
   return '<div class="kmrLine" data-key="'+line.key+'">'+
    '<div class="kmrLineTop"><div class="kmrLineIdentity"><span class="kmrLineNum">'+String(i+1).padStart(2,'0')+'</span><strong>'+safe(ing?.name||'Select ingredient')+'</strong></div><button type="button" data-action="remove" data-key="'+line.key+'" aria-label="Remove item">Remove</button></div>'+
    '<div class="kmrGrid kmrMainGrid">'+
     '<label class="kmrIngredient">Ingredient *<select data-field="id" data-key="'+line.key+'"><option value="">Choose ingredient</option>'+list+'</select></label>'+
     '<label>Unit *<select data-field="unit" data-key="'+line.key+'">'+options(units,line.unit)+'</select></label>'+
     (isPack?'<label class="kmrPackSize">Pack size *<div class="kmrPackInline"><input data-field="packSize" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.packSize)+'" placeholder="5"><select data-field="packUnit" data-key="'+line.key+'" aria-label="Pack size unit">'+options(possibleSizeUnits(base),line.packUnit)+'</select></div></label>':'')+
     '<label>Delivered *<input data-field="qty" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.qty)+'" placeholder="0"></label>'+
     '<label>Rejected<input data-field="rejected" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.rejected)+'"></label>'+
     '<label>Price / '+safe(line.unit||base)+' (AED) *<input data-field="price" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.price)+'" placeholder="0"></label>'+
     '<label>Expiry date<input data-field="expiry" data-key="'+line.key+'" type="date" value="'+safe(line.expiry)+'"></label>'+
    '</div>'+
    '<details class="kmrExtras"><summary>More details <span>Production date and temperature</span></summary><div class="kmrGrid">'+
     '<label>Production date<input data-field="production" data-key="'+line.key+'" type="date" value="'+safe(line.production)+'"></label>'+
     '<label>Temperature (°C)<input data-field="temperature" data-key="'+line.key+'" type="number" step="any" value="'+safe(line.temperature)+'"></label>'+
    '</div></details>'+
    '<div class="kmrPreview"><span>Accepted stock: <b>'+(stock==null?'Check unit / pack size':Number(stock.toFixed(6))+' '+safe(base))+'</b></span><span>Line total: <b>AED '+((qty>=rej && rej>=0 && Number.isFinite(Number(line.price)))?((qty-rej)*Number(line.price)).toFixed(2):'—')+'</b></span></div>'+
    '</div>';
 }
 function draw(){
   const el=document.getElementById('kmrLines');if(!el)return;
   el.innerHTML=lines.map(markup).join('');
   const total=lines.reduce((s,l)=>s+(Math.max(0,Number(l.qty||0)-Number(l.rejected||0))*Number(l.price||0)),0);
   document.getElementById('kmrTotal').textContent='AED '+total.toFixed(2);
   document.getElementById('kmrCount').textContent=lines.length+' item'+(lines.length===1?'':'s');
 }
 function validate(){
   const supplier=document.getElementById('kmrSupplier')?.value.trim(),invoice=document.getElementById('kmrInvoice')?.value.trim();
   if(!supplier||!invoice)throw Error('Enter supplier and invoice number.');
   if(!lines.length||lines.length>100)throw Error('Add between 1 and 100 ingredients.');
   const used=new Set();
   const payload=lines.map((line,i)=>{
     const ing=findIngredient(line.id),qty=Number(line.qty),rej=Number(line.rejected),price=Number(line.price);
     if(!ing)throw Error('Choose an ingredient on line '+(i+1));
     if(used.has(line.id))throw Error('Ingredient repeated on lines. Combine it into one line: '+ing.name);
     used.add(line.id);
     if(!line.qty||!line.price && line.price!=='0'||!Number.isFinite(qty)||qty<=0||!Number.isFinite(rej)||rej<0||rej>qty||!Number.isFinite(price)||price<0)
       throw Error('Invalid quantity or invoice price on line '+(i+1));
     const f=factor(line,ing.base_unit);
     if(f==null || !Number.isFinite(f)||f<=0)throw Error('Choose a compatible unit and valid pack size on line '+(i+1));
     if(line.expiry && line.expiry<today())throw Error('Expired stock blocked on line '+(i+1));
     if(line.production&&line.expiry&&line.production>line.expiry)throw Error('Production date must be before expiry on line '+(i+1));
     if(line.temperature!==''&&!Number.isFinite(Number(line.temperature)))throw Error('Invalid temperature on line '+(i+1));
     const delivered=Number((qty*f).toFixed(6)),rejected=Number((rej*f).toFixed(6)),unitPrice=price/f;
     if(delivered<=0||!Number.isFinite(unitPrice))throw Error('Invalid conversion on line '+(i+1));
     return {ingredient_id:ing.cloud_id,delivered,rejected,price:unitPrice,unit:ing.base_unit,expiry:line.expiry||null,temperature:line.temperature===''?null:Number(line.temperature)};
   });
   return {supplier,invoice,payload};
 }
 async function submit(){
   if(saving)return;
   const message=document.getElementById('kmrMessage'),button=document.getElementById('kmrSubmit');
   try{
     const {supplier,invoice,payload}=validate();
     if(!confirm('Save '+payload.length+' receiving lines under invoice '+invoice+'? All lines will save together.'))return;
     saving=true;button.disabled=true;message.textContent='Saving all lines to local database…';
     const {data,error}=await sb.rpc('kitch_team_receive_invoice_demo',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_supplier:supplier,p_invoice:invoice,p_lines:payload});
     if(error)throw error;
     await cloudLoadIngredients();
     closeModal();openPage('Receiving');
     alert('Local receiving saved: '+data.saved_lines+' items, AED '+Number(data.total_aed||0).toFixed(2)+'. No invoice attachment was uploaded.');
   }catch(e){if(message){message.style.color='#b42318';message.textContent='Not saved: '+(e?.message||e)}}
   finally{saving=false;if(button)button.disabled=false}
 }
 window.openKitchNewReceiving=function(){
   if(!teamCloudAuth?.staff_name||!cloud?.branch_id)return alert('Sign in with the local Demo Manager account.');
   if(!ingredientList().length)return alert('Import Ingredient Master first.');
   lines=[newLine()];counter=lines[0].key;
   modal('<div class="modalHead"><div><h2>New Receiving</h2><small>One invoice · Multiple ingredients</small></div><button class="close" onclick="closeModal()">×</button></div>'+
    '<style>#modal .modalBox{width:min(940px,calc(100vw - 32px));max-width:940px;box-sizing:border-box;padding:24px 28px;border-radius:24px}#modal .modalHead{margin-bottom:14px}#modal .modalHead h2{font-size:24px;letter-spacing:-.035em;margin:0}.kmrWrap{max-height:76vh;overflow:auto;padding-right:4px}.kmrIntro{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px 14px;background:#f6f6f5;color:#777;border-radius:12px;padding:10px 13px;margin:4px 0 16px;font-size:12px}.kmrIntro b{color:#222}.kmrHeader{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-bottom:18px;border-bottom:1px solid #eaeaea}.kmrHeader label,.kmrGrid label{display:block;min-width:0;color:#555;font-size:11px;font-weight:750;line-height:1.4}.kmrHeader input,.kmrGrid input,.kmrGrid select{width:100%;height:42px;box-sizing:border-box;background:white;color:#171717;padding:0 12px;border:1px solid #e1e1e1;border-radius:10px;margin-top:6px;font-size:13px;min-width:0}.kmrHeader input:focus,.kmrGrid input:focus,.kmrGrid select:focus{outline:2px solid #dedede;outline-offset:1px;border-color:#777}.kmrLine{border:1px solid #e9e9e9;border-radius:18px;background:#fff;padding:17px 18px;margin:14px 0}.kmrLineTop{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}.kmrLineIdentity{display:flex;gap:10px;align-items:center;font-size:15px}.kmrLineNum{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#fff1eb;color:#db6c36;font-size:11px;font-weight:850}.kmrLineTop button{border:0;background:#fafafa;padding:9px 12px;border-radius:20px;color:#b64736;font-weight:700;cursor:pointer;font-size:11px}.kmrMainGrid{display:grid;grid-template-columns:1.6fr .75fr .9fr .85fr;gap:12px}.kmrMainGrid .kmrIngredient{grid-column:span 2}.kmrPackInline{display:flex;gap:6px}.kmrPackInline input{flex:1}.kmrPackInline select{flex:0 0 75px}.kmrExtras{margin-top:13px;border-top:1px solid #eee;padding-top:10px}.kmrExtras summary{font-size:12px;font-weight:750;color:#555;cursor:pointer}.kmrExtras summary span{font-weight:400;color:#999;margin-left:8px}.kmrExtras .kmrGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:11px}.kmrPreview{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#f7f7f5;border-radius:10px;margin:12px 0 0;padding:11px 13px;color:#666;font-size:12px}.kmrPreview b{color:#111}#kmrAdd{width:auto;background:white;border:1px dashed #bcbcbc;color:#222;padding:11px 18px;border-radius:30px;font-weight:750;cursor:pointer}.kmrSummary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 10px;padding:15px 16px;background:#f4f4f2;border-radius:13px}.kmrSummary strong{font-size:17px;color:#111}#kmrSubmit{border-radius:999px;min-height:50px}@media(max-width:840px){.kmrMainGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.kmrMainGrid .kmrIngredient{grid-column:span 2}}@media(max-width:560px){#modal .modalBox{padding:18px 16px;width:calc(100vw - 20px)}.kmrHeader,.kmrExtras .kmrGrid{grid-template-columns:1fr}.kmrMainGrid{grid-template-columns:1fr 1fr;gap:10px}.kmrMainGrid .kmrIngredient{grid-column:span 2}.kmrLine{padding:13px}.kmrPreview{display:block}.kmrPreview span{display:block;margin:3px 0}.kmrSummary strong{font-size:14px}}</style>'+
    '<div class="kmrWrap"><div class="kmrIntro"><span>Location: <b>'+safe(assignedLocationName())+'</b></span><span>Local test only · No attachments required</span></div>'+
    '<div class="kmrHeader"><label>SUPPLIER *<input id="kmrSupplier" placeholder="Supplier"></label><label>INVOICE NUMBER *<input id="kmrInvoice" placeholder="LOCAL-INV-001"></label></div>'+
    '<div id="kmrLines"></div><button type="button" id="kmrAdd" class="btn">+ Add Ingredient</button>'+
    '<div class="kmrSummary"><span id="kmrCount">1 item</span><strong>Invoice total: <span id="kmrTotal">AED 0.00</span></strong></div>'+
    '<p id="kmrMessage" role="status" aria-live="polite" style="font-size:12px;color:#555"></p>'+
    '<button id="kmrSubmit" class="primary" type="button">Confirm Entire Receiving</button></div>');
   const root=document.getElementById('modal');
   root.querySelector('#kmrAdd').addEventListener('click',()=>{if(lines.length>=100)return alert('Maximum 100 items');lines.push(newLine());draw()});
   root.querySelector('#kmrSubmit').addEventListener('click',submit);
   root.querySelector('#kmrLines').addEventListener('click',e=>{
     const button=e.target.closest('[data-action=remove]');if(!button)return;
     lines=lines.filter(x=>x.key!==Number(button.dataset.key));draw();
   });
   function change(e){
     const target=e.target,field=target.dataset.field,key=Number(target.dataset.key);
     if(!field)return;
     const line=lines.find(l=>l.key===key);if(!line)return;
     line[field]=target.value;
     if(field==='id'){
       const ing=findIngredient(line.id);line.unit=ing?.base_unit||'g';
       line.packUnit=line.unit;line.price=ing?String(Number(ing.reference_cost??ing.cost??0)):'';
       line.packSize='';
     }
     if(field==='unit'){
       const ing=findIngredient(line.id),base=ing?.base_unit||'g';
       line.packUnit=base;line.packSize='';
       const f=factor(line,base);
       line.price=f==null?'':String(Number(((ing?.reference_cost||0)*f).toFixed(6)));
     }
     if(field==='packSize'||field==='packUnit'){
       const ing=findIngredient(line.id),f=factor(line,ing?.base_unit||'g');
       if(f!=null)line.price=String(Number((Number(ing?.reference_cost||0)*f).toFixed(6)));
     }
     if(['id','unit','packUnit'].includes(field))draw();
     else{
       if(field==='packSize'){
         const priceInput=target.closest('.kmrLine')?.querySelector('[data-field="price"]');
         if(priceInput)priceInput.value=line.price;
       }
       // Update preview without replacing the focused input during typing.
       const block=target.closest('.kmrLine'),base=findIngredient(line.id)?.base_unit||'g',f=factor(line,base);
       const q=Number(line.qty||0),r=Number(line.rejected||0),p=Number(line.price||0);
       const preview=block?.querySelector('.kmrPreview');
       if(preview)preview.textContent='Accepted stock: '+(f!=null&&q>=r?Number(((q-r)*f).toFixed(6))+' '+base:'Invalid quantity / unit')+' · Line value: AED '+Math.max(0,(q-r)*p).toFixed(2);
       const total=lines.reduce((s,l)=>s+Math.max(0,Number(l.qty||0)-Number(l.rejected||0))*Number(l.price||0),0);
       document.getElementById('kmrTotal').textContent='AED '+total.toFixed(2);
     }
   }
   root.querySelector('#kmrLines').addEventListener('input',change);
   root.querySelector('#kmrLines').addEventListener('change',e=>{if(e.target.matches('select'))change(e)});
   draw();
 };

 // Show one receiving entry per supplier invoice, even when it has several ingredients.
 function grouped(){
   const sets=new Map();
   (kitchReceivingHistory||[]).forEach(r=>{
     const day=String(r.date||'').slice(0,10);
     const key=String(r.supplier||'').toLowerCase()+'|'+String(r.invoice||'').toLowerCase()+'|'+day;
     if(!sets.has(key))sets.set(key,[]);
     sets.get(key).push(r);
   });
   return [...sets.values()];
 }
 window.kitchRenderReceivingRows=function(){
   const target=document.getElementById('kitchReceivingRows');if(!target)return;
   target.innerHTML=grouped().map(group=>{
     const first=group[0],count=group.length,total=group.reduce((s,r)=>s+Number(r.total||0),0);
     const exp=group.map(r=>r.expiry).filter(Boolean).sort();
     const ingredientsText=count===1?first.ingredient:count+' items: '+group.map(r=>r.ingredient).join(', ');
     return '<tr><td>'+safe(new Date(first.date).toLocaleDateString())+'</td><td>'+safe(first.invoice)+'</td><td>'+safe(first.supplier)+'</td><td>'+safe(ingredientsText)+'</td>'+
      '<td>'+safe(group.map(r=>r.accepted+' '+r.unit).join(' · '))+'</td><td>'+safe(money(total))+'</td><td>'+safe(exp.length?exp[0]:'—')+'</td><td>—</td>'+
      '<td><button class="kitchReceivingBtn small" onclick="kitchPrintReceipt(\''+safe(first.id)+'\')">PDF</button></td></tr>';
   }).join('')||'<tr><td colspan="9" class="empty">No receiving records yet. Click + New Receiving.</td></tr>';
 };
 window.kitchPrintReceipt=function(id){
   const item=(kitchReceivingHistory||[]).find(r=>String(r.id)===String(id));if(!item)return;
   const rows=(kitchReceivingHistory||[]).filter(r=>r.invoice===item.invoice&&r.supplier===item.supplier&&String(r.date||'').slice(0,10)===String(item.date||'').slice(0,10));
   const total=rows.reduce((s,r)=>s+Number(r.total||0),0);
   const w=window.open('','_blank');if(!w)return alert('Allow pop-ups to print receiving invoice.');
   const rowHTML=rows.map(r=>'<tr><td>'+safe(r.ingredient)+'</td><td>'+safe(r.accepted+' '+r.unit)+'</td><td>'+safe(money(r.price))+'</td><td>'+safe(money(r.total))+'</td><td>'+safe(r.expiry||'—')+'</td></tr>').join('');
   w.document.write('<!doctype html><html><head><title>KITCH Receiving</title><style>body{font:14px Arial;padding:36px;max-width:850px;margin:auto;color:#111}h1{font-size:28px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:12px;text-align:left}footer{margin-top:30px;color:#777}@media print{button{display:none}}</style></head><body><h1>KITCH Receiving</h1><p>LOCAL TEST DEMO · Invoice '+safe(item.invoice)+' · '+safe(item.supplier)+'</p><p>Date: '+safe(new Date(item.date).toLocaleDateString())+'</p><table><thead><tr><th>Ingredient</th><th>Accepted</th><th>Unit price</th><th>Total</th><th>Expiry</th></tr></thead><tbody>'+rowHTML+'</tbody></table><h2>Total: '+safe(money(total))+'</h2><footer>Local synthetic data only. Not a food safety or accounting record.</footer><button onclick="window.print()">Print / Save PDF</button></body></html>');
   w.document.close();
 };

})();
