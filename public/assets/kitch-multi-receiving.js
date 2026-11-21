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
      '<div class="kmrLineTop"><b>ITEM '+(i+1)+'</b><button type="button" data-action="remove" data-key="'+line.key+'" aria-label="Remove item">Remove</button></div>'+
      '<div class="kmrGrid">'+
       '<label>Ingredient *<select data-field="id" data-key="'+line.key+'"><option value="">Choose ingredient</option>'+list+'</select></label>'+
       '<label>Receiving unit *<select data-field="unit" data-key="'+line.key+'">'+options(units,line.unit)+'</select></label>'+
       (isPack?'<label>Pack / box size *<input data-field="packSize" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.packSize)+'" placeholder="5"></label>'+
       '<label>Pack size unit *<select data-field="packUnit" data-key="'+line.key+'">'+options(possibleSizeUnits(base),line.packUnit)+'</select></label>':'')+
       '<label>Delivered quantity *<input data-field="qty" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.qty)+'" placeholder="0"></label>'+
       '<label>Rejected quantity<input data-field="rejected" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.rejected)+'"></label>'+
       '<label>Invoice price (AED / '+safe(line.unit||base)+') *<input data-field="price" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.price)+'" placeholder="0"></label>'+
       '<label>Expiry date<input data-field="expiry" data-key="'+line.key+'" type="date" value="'+safe(line.expiry)+'"></label>'+
       '<label>Production date (optional)<input data-field="production" data-key="'+line.key+'" type="date" value="'+safe(line.production)+'"></label>'+
       '<label>Temperature (°C)<input data-field="temperature" data-key="'+line.key+'" type="number" step="any" value="'+safe(line.temperature)+'"></label>'+
      '</div><p class="kmrPreview">Accepted stock: <b>'+(stock==null?'Set valid unit/pack size':Number(stock.toFixed(6))+' '+safe(base))+'</b> · Line value: <b>AED '+((qty>=rej && rej>=0 && Number.isFinite(Number(line.price)))?((qty-rej)*Number(line.price)).toFixed(2):'—')+'</b></p>'+
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
   modal('<div class="modalHead"><div><h2>New Receiving · Multiple Items</h2><small>LOCAL TEST DEMO · one supplier invoice</small></div><button class="close" onclick="closeModal()">×</button></div>'+
    '<style>.kmrWrap{max-height:76vh;overflow:auto;padding-right:4px}.kmrGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.kmrGrid label{font-size:11px;font-weight:700;color:#555}.kmrGrid select,.kmrGrid input,.kmrHeader input{box-sizing:border-box;display:block;width:100%;padding:11px;border:1px solid #ddd;border-radius:11px;margin-top:6px;background:#fff;color:#111;font-size:14px}.kmrLine{border:1px solid #ddd;border-radius:15px;padding:16px;margin:13px 0;background:#fafafa}.kmrLineTop{display:flex;justify-content:space-between;align-items:center}.kmrLineTop button{border:0;background:transparent;color:#ae3426;font-weight:700;cursor:pointer}.kmrPreview{font-size:12px;color:#555;margin:12px 0 0}.kmrHeader{display:grid;grid-template-columns:1fr 1fr;gap:12px}.kmrSummary{padding:12px;background:#f4f4f2;border-radius:12px;margin:12px 0;display:flex;justify-content:space-between}@media(max-width:600px){.kmrGrid,.kmrHeader{grid-template-columns:1fr}}</style>'+
    '<div class="kmrWrap"><p class="note">Location: '+safe(assignedLocationName())+'. All items are validated and saved as one local transaction. Do not use real invoices or sensitive information.</p>'+
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
     if(['id','unit','packSize','packUnit'].includes(field))draw();
     else{
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
})();
