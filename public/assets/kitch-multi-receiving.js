/* KITCH multi-ingredient Receiving. Uses location-scoped cloud transactions on production and isolated demo RPCs locally. */
(() => {
 'use strict';
 const LOCAL = ['127.0.0.1','localhost'].includes(location.hostname);
 const unitsForBase=(base,ing)=>{
   // Offer volume units for liquid ingredients; do not reinterpret old kg stock.
   const n=String(ing?.name||'').toLowerCase();
   const liquid=['milk','juice','water','oil','cream','broth','syrup'].some(x=>n.includes(x));
   const u=liquid?'ltr':String(base||'').toLowerCase();
   if(['g','kg'].includes(u))return ['g','kg','pcs','pkt','box'];
   if(['ml','ltr','l'].includes(u))return ['ml','ltr','pcs','pkt','box'];
   if(u==='pcs')return ['pcs','pkt','box','tray'];
   return [u,'pkt','box'].filter(Boolean);
 };
 const safe = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
 const options=(values,selected)=>values.map(u=>'<option value="'+u+'"'+(u===selected?' selected':'')+'>'+u+'</option>').join('');
 let lines=[],counter=0,saving=false,packageDefaults=new Map(),receivingSuppliers=[],activePO=null;
 const newLine=()=>({key:++counter,id:'',unit:'',qty:'',rejected:'0',price:'',packSize:'',packUnit:'',expiry:'',temperature:'',production:''});
 const allIngredients=()=>ingredients().filter(i=>i.cloud_id).sort((a,b)=>a.name.localeCompare(b.name));
 const findIngredient=id=>allIngredients().find(x=>String(x.cloud_id)===String(id));
 const supplierNorm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const produceNames=new Set('baby spinach|broccoli|cabbage|carrot|cherry tomato|cucumber|fresh coriander|lettuce|lime|red onion|rocket leaves|tomato'.split('|'));
 const meatNames=new Set('chicken breast|chicken thigh'.split('|'));
 const seafoodNames=new Set('salmon|tuna|seabass|sea bass|prawn|prawns|shrimp|cod|fish|calamari'.split('|'));
 const currentSupplier=()=>receivingSuppliers.find(x=>String(x.id)===String(document.getElementById('kmrSupplier')?.value))||null;
 const supplierAllows=(ing,supplier)=>{
   if(!ing||!supplier)return false;
   const name=supplierNorm(ing.name),seller=supplierNorm(supplier.name),cat=supplierNorm(ing.category);
   const produce=produceNames.has(name)||/fruit|vegetable|produce|herb/.test(cat);
   const meat=meatNames.has(name)||/meat|poultry|chicken|beef|lamb/.test(cat);
   const seafood=seafoodNames.has(name)||/seafood|fish|shellfish/.test(cat);
   if(seller==='gpfruit llc')return produce;
   if(seller==='butcher llc')return meat;
   if(seller==='seaplus llc')return seafood;
   if(seller==='urs llc')return !produce;
   return supplierNorm(ing.supplier||ing.supplier_name)===seller;
 };
 const ingredientList=()=>allIngredients().filter(i=>supplierAllows(i,currentSupplier()));
 const isProduce=ing=>Boolean(ing&&(produceNames.has(supplierNorm(ing.name))||/fruit|vegetable|produce|herb/.test(supplierNorm(ing.category))));
 const produceShared={expiry:'',production:'',temperature:''};
 function updateProducePanel(){
   const panel=document.getElementById('kmrProduceShared');if(!panel)return;
   const hasProduce=ingredientList().some(isProduce);
   panel.hidden=!hasProduce;
   const supplier=currentSupplier();
   const note=panel.querySelector('.kmrProduceSupplierNote');
   if(note)note.textContent=hasProduce?'Apply shared optional details only to fruit, vegetable and herb lines. Other products remain unchanged.':'';
 }
 function applyProduceDefaults(line){
   const ing=findIngredient(line.id);
   if(!isProduce(ing))return;
   for(const field of ['expiry','production','temperature'])if(!line[field]&&produceShared[field])line[field]=produceShared[field];
 }
 function applyProduceDetails(){
   if(!currentSupplier())return;
   const values={expiry:document.getElementById('kmrProduceExpiry')?.value||'',production:document.getElementById('kmrProduceProduction')?.value||'',temperature:document.getElementById('kmrProduceTemp')?.value||''};
   if(values.expiry&&values.expiry<today())return alert('Expiry date cannot be before today.');
   if(values.expiry&&values.production&&values.production>values.expiry)return alert('Production/harvest date cannot be after expiry.');
   if(values.temperature!==''&&!Number.isFinite(Number(values.temperature)))return alert('Enter a valid temperature or leave it blank for ambient receiving.');
   Object.assign(produceShared,values);
   let count=0;
   for(const line of lines)if(isProduce(findIngredient(line.id))){Object.assign(line,values);count++;}
   draw();
   const message=document.getElementById('kmrMessage');
   if(message){message.style.color='#28734b';message.textContent='Shared produce details applied to '+count+' selected item'+(count===1?'':'s')+'. Dates remain optional when the supplier has not provided them.';}
 }

 const packBaseUnit=b=>({l:'ltr'}[String(b||'').toLowerCase()]||String(b||'').toLowerCase());
 const isMilkUnitMismatch=ing=>/\bmilk\b/i.test(ing?.name||'') && ['g','kg'].includes(String(ing?.base_unit||'').toLowerCase());
 const normalizePackSize=(saved,base)=>{
   const n=Number(saved?.pack_size),from=packBaseUnit(saved?.pack_unit),to=packBaseUnit(base);
   if(!Number.isFinite(n)||n<=0)return '';
   if(from===to)return String(n);
   const conversion={
     'g:kg':.001,'kg:g':1000,
     'ml:ltr':.001,'ltr:ml':1000
   }[from+':'+to];
   return conversion==null?'':String(Number((n*conversion).toFixed(6)));
 };
 function factor(line,base){
   if(!line||!base) return null;
   if(line.unit===base || (['ltr','l'].includes(line.unit)&&['ltr','l'].includes(base)))return 1;
   if(base==='g'&&line.unit==='kg')return 1000;
   if(base==='kg'&&line.unit==='g')return .001;
   if(base==='ml'&&line.unit==='ltr')return 1000;
   if(['ltr','l'].includes(base)&&line.unit==='ml')return .001;
   if(['pcs','pkt','box','tray'].includes(line.unit) && line.unit!==base){
     const n=Number(line.packSize);
     if(!line.packSize || !Number.isFinite(n)||n<=0)return null;
     if(line.packUnit===base || (['ltr','l'].includes(line.packUnit)&&['ltr','l'].includes(base)))return n;
     if(base==='pcs'&&line.packUnit==='pcs')return n;
     if(base==='g'&&line.packUnit==='kg')return n*1000;
     if(base==='kg'&&line.packUnit==='g')return n/1000;
     if(base==='ml'&&line.packUnit==='ltr')return n*1000;
     if(['ltr','l'].includes(base)&&line.packUnit==='ml')return n/1000;
   }
   return null;
 }
 function markup(line,i){
   const poLinked=!!activePO;
   const ing=findIngredient(line.id),base=ing?.base_unit||'g',isPack=['pcs','pkt','box','tray'].includes(line.unit)&&line.unit!==base;
   const poLine=activePO?.lines.find(x=>String(x.item_id)===String(line.po_item_id));
   const displayBase=isMilkUnitMismatch(ing)?'ltr':base;
   line.packUnit=packBaseUnit(displayBase);
   const list=ingredientList().map(x=>'<option value="'+safe(x.cloud_id)+'"'+(String(x.cloud_id)===line.id?' selected':'')+'>'+safe(x.name)+'</option>').join('');
   const baseQty=isMilkUnitMismatch(ing)?null:factor(line,base),qty=Number(line.qty||0),rej=Number(line.rejected||0);
   const stock=(baseQty!=null&&qty>=rej && rej>=0)?(qty-rej)*baseQty:null;
   const hint=base==='ml'?'Use ml/ltr, or select pkt/box and enter the volume per package.':base==='g'?'Use g/kg, or enter weight per packet/box.':'';
   return '<div class="kmrLine" data-key="'+line.key+'">'+
    '<div class="kmrLineTop"><div class="kmrLineIdentity"><span class="kmrLineNum">'+String(i+1).padStart(2,'0')+'</span><strong>'+safe(ing?.name||'Select ingredient')+'</strong></div>'+(poLinked?'<small style="color:#888">From approved purchase order</small>':'<button type="button" data-action="remove" data-key="'+line.key+'" aria-label="Remove item">Remove</button>')+'</div>'+
    (poLine?'<div style="background:#f7f7f7;border-radius:10px;padding:10px 12px;margin:0 0 12px;font-size:12px"><strong>Ordered: '+safe(poLine.ordered)+' '+safe(poLine.unit)+'</strong> · Previously received: '+safe(poLine.received)+' '+safe(poLine.unit)+' · <strong>Remaining: '+safe(poLine.remaining)+' '+safe(poLine.unit)+'</strong></div>':'')+
    '<div class="kmrGrid kmrMainGrid">'+
     '<label class="kmrIngredient">Ingredient *<select data-field="id" data-key="'+line.key+'"'+(poLinked?' disabled':'')+'><option value="">Choose ingredient</option>'+list+'</select></label>'+
     '<label>Unit *<select data-field="unit" data-key="'+line.key+'"'+(poLinked?' disabled':'')+'>'+options(poLinked?[base]:unitsForBase(base,ing),line.unit)+'</select></label>'+
     (isPack?'<label class="kmrPackSize">Size per '+safe(line.unit)+' ('+safe(packBaseUnit(displayBase))+') *<input data-field="packSize" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.packSize)+'" placeholder="Enter package size"></label>':'')+
     
     '<label>Delivered *<input data-field="qty" data-key="'+line.key+'" type="number" min="0.000001" step="any" value="'+safe(line.qty)+'" placeholder="0"></label>'+
     '<label>Rejected<input data-field="rejected" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.rejected)+'"></label>'+
     '<label>Price / '+safe(line.unit||base)+' (AED) *<input data-field="price" data-key="'+line.key+'" type="number" min="0" step="any" value="'+safe(line.price)+'" placeholder="0"></label>'+
    '</div>'+
    (isPack?'<div class="kmrMasterAction"><span>Package size and price will be remembered when this invoice is confirmed, if permitted.</span></div>':'')+
    (isProduce(ing)?'<details class="kmrProduceOverride"><summary>Produce receiving details · '+(line.expiry?'Expiry '+safe(line.expiry):'Expiry not specified')+' · Edit this item only</summary>':'')+
    '<div class="kmrQualityGrid">'+
     '<label>Expiry date'+(isProduce(ing)?' · if supplied':'')+'<input data-field="expiry" data-key="'+line.key+'" type="date" value="'+safe(line.expiry)+'"></label>'+
     '<label>Production / harvest date'+(isProduce(ing)?' · if supplied':'')+'<input data-field="production" data-key="'+line.key+'" type="date" value="'+safe(line.production)+'"></label>'+
     '<label>Actual receiving temperature (°C)<input data-field="temperature" data-key="'+line.key+'" type="number" step="any" placeholder="Optional / ambient" value="'+safe(line.temperature)+'"></label>'+
    '</div>'+
    (isProduce(ing)?'</details>':'')+
    '<div class="kmrPreview"><span>Accepted stock: <b>'+(stock==null?safe(isMilkUnitMismatch(ing)?'Unit reconciliation needed before saving this ingredient':hint||'Choose a compatible unit / pack size'):Number(stock.toFixed(6))+' '+safe(base))+'</b></span><span>Line total: <b>AED '+((qty>=rej && rej>=0 && Number.isFinite(Number(line.price)))?((qty-rej)*Number(line.price)).toFixed(2):'—')+'</b></span></div>'+
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
   const selected=currentSupplier(),supplier=selected?.name||'',invoice=document.getElementById('kmrInvoice')?.value.trim();
   if(!selected||!invoice)throw Error('Supplier and invoice number are required.');
   if(activePO && supplierNorm(selected.name)!==supplierNorm(activePO.supplier))throw Error('PO supplier cannot be changed.');
   if(!lines.length||lines.length>100)throw Error('Add between 1 and 100 ingredients.');
   const used=new Set();
   const payload=lines.map((line,i)=>{
     const ing=findIngredient(line.id),qty=Number(line.qty),rej=Number(line.rejected),price=Number(line.price);
     if(!ing)throw Error('Choose an ingredient on line '+(i+1));
     if(!supplierAllows(ing,selected))throw Error(ing.name+' is not assigned to '+supplier+'; no invoice was saved.');
     if(isMilkUnitMismatch(ing))throw Error(ing.name+' uses '+ing.base_unit+' in Ingredient Master. Correct and reconcile its stock units before receiving.');
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
     return {ingredient_id:ing.cloud_id,delivered,rejected,price:unitPrice,unit:ing.base_unit,expiry:line.expiry||null,production:line.production||null,temperature:line.temperature===''?null:Number(line.temperature)};
   });
   if(activePO){
     for(let i=0;i<payload.length;i++){
       const expected=activePO.lines[i];
       if(!expected||String(payload[i].ingredient_id)!==String(expected.ingredient_id))throw Error('Purchase order items do not match. Reload Receiving.');
       const accepted=payload[i].delivered-payload[i].rejected;
       if(accepted>Number(expected.remaining)+0.000001)throw Error(expected.ingredient+': accepted quantity exceeds remaining purchase order ('+expected.remaining+' '+expected.unit+').');
     }
   }
   return {supplier,invoice,payload};
 }
 async function submit(){
   if(saving)return;
   const message=document.getElementById('kmrMessage'),button=document.getElementById('kmrSubmit');
   try{
     // A selected unit may correct a never-used Ingredient Master without
     // a separate master-edit screen. An ingredient with stock history is
     // deliberately rejected by the audited database function.
     for(const line of lines){
       const ing=findIngredient(line.id);
       if(!ing || !isMilkUnitMismatch(ing))continue;
       const target=['ml','ltr'].includes(line.unit)?line.unit:
         (['pcs','pkt','box'].includes(line.unit)?'ltr':null);
       if(!target)throw Error('Choose ml or L for '+ing.name+'.');
       message.textContent='Checking Ingredient Master unit for '+ing.name+'…';
       const fixed=await sb.rpc('kitch_team_correct_unused_ingredient_unit',{
         p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,
         p_ingredient_id:ing.cloud_id,p_new_unit:target
       });
       if(fixed.error)throw Error(ing.name+': existing stock uses different units. Its opening balance needs an audited stock reconciliation before litres can be received. No invoice was saved.');
       await cloudLoadIngredients();
       const latest=findIngredient(line.id);
       if(!latest || latest.base_unit!==target)throw Error('Ingredient Master unit did not refresh. No invoice was saved.');
       line.packUnit=packBaseUnit(target);
       // Preserve the staff-entered quantity, package size, and invoice price.
       // The transaction validator will verify them against the corrected unit.
       draw();
       message.textContent='Ingredient Master unit automatically updated to '+target+'.';
     }
     const {supplier,invoice,payload}=validate();
     if(activePO && (payload.length!==activePO.lines.length || payload.some((p,i)=>String(p.ingredient_id)!==String(activePO.lines[i].ingredient_id))))throw Error('Items must match the selected purchase order.');
     if(!confirm('Confirm '+payload.length+' actual receiving lines under '+(activePO?activePO.po_no+' · ':'')+'invoice '+invoice+'? Only accepted stock will be added to inventory.'))return;
     saving=true;button.disabled=true;message.textContent=LOCAL?'Saving all lines to local database…':'Saving invoice and accepted stock to KITCH cloud…';
     const {data,error}=activePO
       ?await sb.rpc('kitch_team_receive_purchase_order_invoice',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_po_id:activePO.po_id,p_invoice:invoice,p_lines:payload.map((x,i)=>({...x,po_item_id:activePO.lines[i].item_id}))})
       :await sb.rpc(LOCAL?'kitch_team_receive_invoice_demo':'kitch_team_receive_invoice',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_supplier:supplier,p_invoice:invoice,p_lines:payload});
     if(error)throw error;
     // Receiving is already committed atomically. Save valid package/price
     // defaults afterwards, without ever retrying the invoice on default errors.
     const defaultsFailed=[];
     for(const line of lines){
       if(!['pcs','pkt','box'].includes(line.unit) || !(Number(line.packSize)>0))continue;
       const ing=findIngredient(line.id);
       if(!ing || isMilkUnitMismatch(ing) || factor(line,ing.base_unit)==null)continue;
       const same=packageDefaults.get(String(line.id));
       const packUnit=packBaseUnit(ing.base_unit);
       const unitPrice=Number(line.price);
       if(same?.purchase_unit===line.unit &&
          normalizePackSize(same,ing.base_unit)===String(Number(line.packSize)) &&
          Number(same.unit_price)===unitPrice)continue;
       try{
         const saved=await sb.rpc(LOCAL?'kitch_team_local_save_package':'kitch_team_save_package',{
           p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,
           p_ingredient_id:ing.cloud_id,p_purchase_unit:line.unit,
           p_pack_size:Number(line.packSize),p_pack_unit:packUnit,p_unit_price:unitPrice
         });
         if(saved.error)throw saved.error;
       }catch(e){defaultsFailed.push(ing.name);}
     }
     await cloudLoadIngredients();
     closeModal();openPage('Receiving');
     alert((LOCAL?'Local receiving saved: ':'Receiving saved to KITCH cloud: ')+data.saved_lines+' items, AED '+Number(data.total_aed||0).toFixed(2)+'.'+
       (defaultsFailed.length?' Package defaults could not be updated for '+defaultsFailed.join(', ')+'. The invoice was saved and must not be submitted again.':''));
   }catch(e){if(message){message.style.color='#b42318';message.textContent='Not saved: '+(e?.message||e)}}
   finally{saving=false;if(button)button.disabled=false}
 }
 window.openKitchNewReceiving=async function(poItemId=null,manual=false){
   if(!teamCloudAuth?.staff_name||!teamCloudAuth?.pin||!cloud?.branch_id)return alert('Sign in to your assigned KITCH location first.');
   if(!allIngredients().length)return alert('Import Ingredient Master first.');
   receivingSuppliers=[];
   try{
     const supplierResult=await sb.rpc('kitch_purchase_supplier_view',{
       p_restaurant_id:cloud.restaurant_id,p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin
     });
     if(supplierResult.error)throw supplierResult.error;
     receivingSuppliers=(Array.isArray(supplierResult.data?.suppliers)?supplierResult.data.suppliers:[])
       .filter(x=>x.id&&x.name).sort((a,b)=>a.name.localeCompare(b.name));
   }catch(err){return alert('Approved supplier master could not load: '+(err?.message||err)+'. No stock was changed.');}
   if(!receivingSuppliers.length)return alert('No approved cloud suppliers. Add suppliers in Suppliers & Purchasing first.');
   packageDefaults=new Map();
   try {
     const result=await sb.rpc(LOCAL?'kitch_team_local_package_defaults':'kitch_team_package_defaults',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin});
     if(!result.error&&Array.isArray(result.data))packageDefaults=new Map(result.data.map(x=>[String(x.ingredient_id),x]));
   } catch(err){console.warn('Local package master defaults unavailable',err)}
   activePO=null;
   if(!manual){
     const {data:pending,error:pendingError}=await sb.rpc('kitch_team_pending_receiving_orders',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin});
     if(pendingError)return alert('Cannot load orders awaiting receiving: '+pendingError.message);
     const available=Array.isArray(pending)?pending:[];
     const poItem=poItemId?available.find(x=>String(x.item_id)===String(poItemId)):available[0];
     if(poItemId&&!poItem)return alert('Selected purchase order item is no longer awaiting receiving. Refresh Receiving.');
     if(!poItem){
       return alert('No purchase orders awaiting receiving. Use “Direct Receiving (No PO)” only for deliveries without an approved purchase order.');
     }
     activePO={po_id:poItem.po_id,po_no:poItem.po_no,supplier:poItem.supplier,
       lines:available.filter(x=>String(x.po_id)===String(poItem.po_id))};
   }
   lines=activePO?activePO.lines.map(x=>({...newLine(),id:String(x.ingredient_id),unit:x.unit,qty:'',price:String(x.unit_price),po_item_id:x.item_id})): [newLine()];
   counter=lines[lines.length-1].key;
   modal('<div class="modalHead"><div><h2>'+(activePO?'Receive Purchase Order':'Direct Receiving')+'</h2><small>'+(activePO?safe(activePO.po_no)+' · '+safe(activePO.supplier):'No purchase order · One invoice')+'</small></div><button class="close" onclick="closeModal()">×</button></div>'+
    '<style>#modal .modalBox{width:min(940px,calc(100vw - 32px));max-width:940px;box-sizing:border-box;padding:24px 28px;border-radius:24px}#modal .modalHead{margin-bottom:14px}#modal .modalHead h2{font-size:24px;letter-spacing:-.035em;margin:0}.kmrWrap{max-height:76vh;overflow:auto;padding-right:4px}.kmrIntro{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px 14px;background:#f6f6f5;color:#777;border-radius:12px;padding:10px 13px;margin:4px 0 16px;font-size:12px}.kmrIntro b{color:#222}.kmrHeader{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-bottom:18px;border-bottom:1px solid #eaeaea}.kmrHeader label,.kmrGrid label{display:block;min-width:0;color:#555;font-size:11px;font-weight:750;line-height:1.4}.kmrHeader input,.kmrHeader select,.kmrGrid input,.kmrGrid select{width:100%;height:42px;box-sizing:border-box;background:white;color:#171717;padding:0 12px;border:1px solid #e1e1e1;border-radius:10px;margin-top:6px;font-size:13px;min-width:0}.kmrHeader input:focus,.kmrGrid input:focus,.kmrGrid select:focus{outline:2px solid #dedede;outline-offset:1px;border-color:#777}.kmrLine{border:1px solid #e9e9e9;border-radius:18px;background:#fff;padding:17px 18px;margin:14px 0}.kmrLineTop{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}.kmrLineIdentity{display:flex;gap:10px;align-items:center;font-size:15px}.kmrLineNum{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#fff1eb;color:#db6c36;font-size:11px;font-weight:850}.kmrMasterAction{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:10px 0}.kmrMasterAction button{border:1px solid #efd8c8;background:#fff7f0;color:#a65a2e;border-radius:999px;padding:8px 12px;font-size:11px;font-weight:750;cursor:pointer}.kmrMasterAction span{font-size:11px;color:#999}.kmrLineTop button{border:0;background:#fafafa;padding:9px 12px;border-radius:20px;color:#b64736;font-weight:700;cursor:pointer;font-size:11px}.kmrMainGrid{display:grid;grid-template-columns:1.6fr .75fr .9fr .85fr;gap:12px}.kmrMainGrid .kmrIngredient{grid-column:span 2}.kmrPackSize input{width:100%!important}.kmrUnitWarning{grid-column:1/-1;border-radius:10px;background:#fff3ed;border:1px solid #f2c5ad;color:#8b371f;font-size:12px;line-height:1.4;padding:10px 12px}.kmrQualityGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;padding-top:13px;border-top:1px solid #efefef}.kmrQualityGrid label{display:block;min-width:0;color:#555;font-size:11px;font-weight:750;line-height:1.4}.kmrQualityGrid input{width:100%;height:42px;box-sizing:border-box;background:white;color:#171717;padding:0 12px;border:1px solid #e1e1e1;border-radius:10px;margin-top:6px;font-size:13px;min-width:0}.kmrQualityGrid input:focus{outline:2px solid #dedede;outline-offset:1px;border-color:#777}.kmrExtras{margin-top:13px;border-top:1px solid #eee;padding-top:10px}.kmrExtras summary{font-size:12px;font-weight:750;color:#555;cursor:pointer}.kmrExtras summary span{font-weight:400;color:#999;margin-left:8px}.kmrExtras .kmrGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:11px}.kmrPreview{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#f7f7f5;border-radius:10px;margin:12px 0 0;padding:11px 13px;color:#666;font-size:12px}.kmrPreview b{color:#111}#kmrAdd{width:auto;background:white;border:1px dashed #bcbcbc;color:#222;padding:11px 18px;border-radius:30px;font-weight:750;cursor:pointer}.kmrSummary{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 10px;padding:15px 16px;background:#f4f4f2;border-radius:13px}.kmrSummary strong{font-size:17px;color:#111}#kmrSubmit{border-radius:999px;min-height:50px}@media(max-width:840px){.kmrMainGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.kmrMainGrid .kmrIngredient{grid-column:span 2}}@media(max-width:560px){.kmrQualityGrid{grid-template-columns:1fr 1fr}.kmrQualityGrid label:last-child{grid-column:span 2}#modal .modalBox{padding:18px 16px;width:calc(100vw - 20px)}.kmrHeader,.kmrExtras .kmrGrid{grid-template-columns:1fr}.kmrMainGrid{grid-template-columns:1fr 1fr;gap:10px}.kmrMainGrid .kmrIngredient{grid-column:span 2}.kmrLine{padding:13px}.kmrPreview{display:block}.kmrPreview span{display:block;margin:3px 0}.kmrSummary strong{font-size:14px}}</style>'+
    '<style> .kmrProduceShared{margin:17px 0 10px;border:1px solid #e5e6eb;border-radius:15px;background:#f6f6f8;padding:15px} .kmrProduceShared[hidden]{display:none!important} .kmrProduceHeading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap} .kmrProduceHeading strong{display:block;font-size:14px;color:#292a32} .kmrProduceHeading small{display:block;font-size:11px;color:#858691;margin-top:5px} .kmrProduceHeading>span{font-size:10px;letter-spacing:.06em;color:#898b95;font-weight:800} .kmrProduceSupplierNote,.kmrProduceHelp{font-size:11px;color:#828490;line-height:1.6;margin:9px 0} .kmrProduceFields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0} .kmrProduceFields label{font-size:11px;color:#666872;font-weight:700} .kmrProduceFields input{box-sizing:border-box;width:100%;height:42px;margin-top:6px;border:1px solid #dfe0e6;border-radius:10px;background:#fff;padding:0 10px;font-size:12px;color:#262730} #kmrApplyProduce{border:0;border-radius:10px;background:#282930;color:#fff;padding:11px 16px;font-size:12px;font-weight:800;cursor:pointer} .kmrProduceOverride{margin-top:13px;border-top:1px solid #eee;padding-top:12px} .kmrProduceOverride summary{cursor:pointer;font-size:11px;font-weight:750;color:#686a76} .kmrProduceOverride .kmrQualityGrid{margin-top:10px} @media(max-width:650px){.kmrProduceFields{grid-template-columns:1fr}.kmrProduceShared{padding:12px}} </style>'+
    '<div class="kmrWrap"><div class="kmrIntro"><span>Location: <b>'+safe(assignedLocationName())+'</b></span><span>'+(activePO?'Receiving '+safe(activePO.po_no):LOCAL?'Local test only':'Direct receiving · No purchase order')+'</span></div>'+
    '<div class="kmrHeader"><label>SUPPLIER *<select id="kmrSupplier"><option value="">Choose approved supplier</option>'+receivingSuppliers.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('')+'</select></label><label>INVOICE NUMBER *<input id="kmrInvoice" placeholder="Supplier invoice number"></label></div>'+
    '<section id="kmrProduceShared" class="kmrProduceShared" hidden><div class="kmrProduceHeading"><div><strong>Vegetables & Herbs · Shared Receiving Details</strong><small>Ambient deliveries: temperature optional; never invent expiry or production dates.</small></div><span>APPLY TO PRODUCE</span></div>'+
    '<p class="kmrProduceSupplierNote"></p><div class="kmrProduceFields">'+
    '<label>Expiry date (if provided)<input id="kmrProduceExpiry" type="date"></label>'+
    '<label>Production / harvest date (if provided)<input id="kmrProduceProduction" type="date"></label>'+
    '<label>Actual receiving temp °C (optional)<input id="kmrProduceTemp" type="number" step="any" placeholder="Ambient / not measured"></label>'+
    '</div><button type="button" id="kmrApplyProduce" class="btn">Apply to all produce lines</button><p class="kmrProduceHelp">If an item has a different batch date or requires chilling, open its own receiving details and enter the correct values. Follow its storage requirements.</p></section>'+
    '<div id="kmrLines"></div>'+(activePO?'':'<button type="button" id="kmrAdd" class="btn">+ Add Ingredient</button>')+
    '<div class="kmrSummary"><span id="kmrCount">1 item</span><strong>Invoice total: <span id="kmrTotal">AED 0.00</span></strong></div>'+
    '<p id="kmrMessage" role="status" aria-live="polite" style="font-size:12px;color:#555"></p>'+
    '<button id="kmrSubmit" class="primary" type="button">Confirm Entire Receiving</button></div>');
   const root=document.getElementById('modal');
   root.querySelector('#kmrApplyProduce').addEventListener('click',applyProduceDetails);
   if(activePO){
     const supplier=receivingSuppliers.find(x=>supplierNorm(x.name)===supplierNorm(activePO.supplier));
     if(!supplier)return alert('Approved supplier profile missing for '+activePO.supplier);
     const select=root.querySelector('#kmrSupplier');select.value=supplier.id;select.style.display='none';
     const readonly=document.createElement('input');readonly.value=supplier.name;readonly.readOnly=true;
     readonly.setAttribute('aria-label','Approved PO supplier');
     select.parentElement.appendChild(readonly);
     const message=root.querySelector('#kmrMessage');
     if(message)message.textContent='Linked purchase order '+activePO.po_no+'. Supplier and ingredients are locked. Enter actual delivered quantities, invoice number, prices and batch details.';
   }
   root.querySelector('#kmrSupplier').addEventListener('change',()=>{
     // Never carry ingredient quantities from a different supplier.
     lines=[newLine()];counter=lines[0].key;
     Object.assign(produceShared,{expiry:'',production:'',temperature:''});
     for(const id of ['kmrProduceExpiry','kmrProduceProduction','kmrProduceTemp']){const field=document.getElementById(id);if(field)field.value='';}
     draw();updateProducePanel();
     const supplier=currentSupplier(),count=ingredientList().length;
     const info=root.querySelector('#kmrMessage');
     if(info){info.style.color=count?'#28734b':'#b42318';info.textContent=supplier?(count+' approved products available from '+supplier.name+(count?'':'. Check supplier product assignments.')):'Choose a supplier to see its products.';}
   });
   root.querySelector('#kmrAdd')?.addEventListener('click',()=>{if(!currentSupplier())return alert('Choose a supplier first');if(!ingredientList().length)return alert('No products assigned to this supplier');if(lines.length>=100)return alert('Maximum 100 items');lines.push(newLine());draw()});
   root.querySelector('#kmrSubmit').addEventListener('click',submit);
   root.querySelector('#kmrLines').addEventListener('click',async e=>{
     const button=e.target.closest('[data-action]');if(!button)return;
     const line=lines.find(x=>x.key===Number(button.dataset.key));
     if(button.dataset.action==='remove'){if(activePO)return;lines=lines.filter(x=>x!==line);draw();return;}
     if(button.dataset.action!=='saveDefault'||!line)return;
     const ing=findIngredient(line.id),status=document.getElementById('kmrMessage');
     if(!ing||!['pcs','pkt','box'].includes(line.unit)||!(Number(line.packSize)>0)||factor(line,ing.base_unit)==null||line.price===''||!Number.isFinite(Number(line.price))||Number(line.price)<0){
       status.style.color='#b42318';status.textContent='Enter a valid package quantity, size unit, and price first.';return;
     }
     button.disabled=true;status.textContent='Saving package to Ingredient Master...';
     try{
       const result=await sb.rpc(LOCAL?'kitch_team_local_save_package':'kitch_team_save_package',{
         p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_ingredient_id:ing.cloud_id,
         p_purchase_unit:line.unit,p_pack_size:Number(line.packSize),p_pack_unit:line.packUnit,
         p_unit_price:Number(line.price)});
       if(result.error)throw result.error;
       packageDefaults.set(String(ing.cloud_id),{
         purchase_unit:line.unit,pack_size:Number(line.packSize),pack_unit:line.packUnit,unit_price:Number(line.price)});
       status.style.color='#28734b';status.textContent='Package and price saved for '+ing.name+'. Future receiving auto-fills them.';
       button.textContent='Saved to Master';
     }catch(ex){status.style.color='#b42318';status.textContent='Could not save master package: '+(ex.message||ex)}
     finally{button.disabled=false}
   });
   function change(e){
     const target=e.target,field=target.dataset.field,key=Number(target.dataset.key);
     if(!field)return;
     const line=lines.find(l=>l.key===key);if(!line)return;
     if(activePO&&['id','unit'].includes(field))return;
     line[field]=target.value;
     if(field==='id'){
       const ing=findIngredient(line.id),saved=packageDefaults.get(String(line.id));
       applyProduceDefaults(line);
       line.unit=isMilkUnitMismatch(ing)?'ltr':(saved?.purchase_unit||ing?.base_unit||'g');
       line.packUnit=packBaseUnit(isMilkUnitMismatch(ing)?'ltr':ing?.base_unit||'g');
       line.packSize=saved?normalizePackSize(saved,isMilkUnitMismatch(ing)?'ltr':ing?.base_unit):'';
       line.price=isMilkUnitMismatch(ing)?'':(saved?String(saved.unit_price):(ing?String(Number(ing.reference_cost??ing.cost??0)):''));
     }
     if(field==='unit' && !unitsForBase(findIngredient(line.id)?.base_unit,findIngredient(line.id)).includes(line.unit)){
       line.unit=findIngredient(line.id)?.base_unit||'g';
     }
     if(field==='unit'){
       const ing=findIngredient(line.id),base=ing?.base_unit||'g';
       const saved=packageDefaults.get(String(line.id));
       line.packUnit=packBaseUnit(isMilkUnitMismatch(ing)?'ltr':base);
       line.packSize=saved?.purchase_unit===line.unit?normalizePackSize(saved,base):'';
       const f=isMilkUnitMismatch(ing)?null:factor(line,base);
       line.price=isMilkUnitMismatch(ing)?'':(saved?.purchase_unit===line.unit?String(saved.unit_price):(f==null?'':String(Number(((ing?.reference_cost||0)*f).toFixed(6)))));
     }
     if(field==='packSize'||field==='packUnit'){
       const ing=findIngredient(line.id),f=factor(line,ing?.base_unit||'g');
       if(f!=null && line.price==='')line.price=String(Number((Number(ing?.reference_cost||0)*f).toFixed(6)));
     }
     if(['id','unit'].includes(field))draw();
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
   draw();updateProducePanel();
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
      '<td><button class="kitchReceivingBtn kitchActionPill" style="display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;min-width:56px!important;height:32px!important;min-height:32px!important;padding:0 13px!important;border:1px solid #dedfe3!important;border-radius:999px!important;background:#f3f3f5!important;color:#38383b!important;font:800 11px/1 Inter,Arial,sans-serif!important;white-space:nowrap!important;box-shadow:none!important;vertical-align:middle!important;" onclick="kitchPrintReceipt(\''+safe(first.id)+'\')">PDF</button></td></tr>';
   }).join('')||'<tr><td colspan="9" class="empty">No receiving records yet. Click + New Receiving.</td></tr>';
 };
 window.kitchPrintReceipt=function(id){
   const item=(kitchReceivingHistory||[]).find(r=>String(r.id)===String(id));if(!item)return;
   const rows=(kitchReceivingHistory||[]).filter(r=>r.invoice===item.invoice&&r.supplier===item.supplier&&String(r.date||'').slice(0,10)===String(item.date||'').slice(0,10));
   const total=rows.reduce((s,r)=>s+Number(r.total||0),0);
   const w=window.open('','_blank');if(!w)return alert('Allow pop-ups to print receiving invoice.');
   const rowHTML=rows.map(r=>'<tr><td>'+safe(r.ingredient)+'</td><td>'+safe(r.accepted+' '+r.unit)+'</td><td>'+safe(money(r.price))+'</td><td>'+safe(money(r.total))+'</td><td>'+safe(r.expiry||'—')+'</td></tr>').join('');
   w.document.write('<!doctype html><html><head><title>KITCH Receiving</title><style>body{font:14px Arial;padding:36px;max-width:850px;margin:auto;color:#111}h1{font-size:28px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:12px;text-align:left}footer{margin-top:30px;color:#777}@media print{button{display:none}}</style></head><body><h1>KITCH Receiving</h1><p>'+(LOCAL?'LOCAL TEST DEMO':'KITCH CLOUD RECEIVING')+' · Invoice '+safe(item.invoice)+' · '+safe(item.supplier)+'</p><p>Date: '+safe(new Date(item.date).toLocaleDateString())+'</p><table><thead><tr><th>Ingredient</th><th>Accepted</th><th>Unit price</th><th>Total</th><th>Expiry</th></tr></thead><tbody>'+rowHTML+'</tbody></table><h2>Total: '+safe(money(total))+'</h2><footer>'+(LOCAL?'Local synthetic data only.':'Verify receiving dates, supplier invoice and accepted quantities against original records.')+'</footer><button onclick="window.print()">Print / Save PDF</button></body></html>');
   w.document.close();
 };

})();
