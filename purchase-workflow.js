/* KITCH Purchasing / Main Office approval workflow — additive module */
(function(){
'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AED=v=>'AED '+Number(v||0).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2});
let staffCache=null,staffKey='',staffLoading=false,staffError='';
const listOpt=(items,empty)=>'<option value="">'+E(empty)+'</option>'+items.map(x=>'<option value="'+E(x.id)+'">'+E(x.name)+(x.unit?' ('+E(x.unit)+')':'')+'</option>').join('');
function groupLines(rows){const m=new Map();for(const r of rows){if(!m.has(r.id))m.set(r.id,{...r,lines:[]});m.get(r.id).lines.push(r)}return [...m.values()]}
function itemRows(items){return '<div class="kitch-lines"><div class="kitch-line" style="display:grid;grid-template-columns:minmax(0,1fr) 110px 35px;gap:8px;align-items:end;margin-bottom:12px"><label>Ingredient<select class="kitch-ingredient">'+listOpt(items,'Choose ingredient')+'</select></label><label>Quantity<input class="kitch-quantity" type="number" min="0.001" step="any" placeholder="Qty"></label><button type="button" class="btn kitch-remove" style="height:43px;padding:0">×</button></div></div>'}
function readItems(root,ingredients){const rows=[...root.querySelectorAll('.kitch-line')];if(!rows.length||rows.length>50)throw Error('Add 1 to 50 ingredients');const ids=new Set();return rows.map(r=>{const item=ingredients.find(i=>i.id===r.querySelector('.kitch-ingredient')?.value);const qtyField=r.querySelector('.kitch-quantity'),qty=Number(qtyField?.value);if(!item||!qtyField?.value||!Number.isFinite(qty)||qty<=0||qty>100000)throw Error('Complete each ingredient and quantity');if(ids.has(item.id))throw Error('Combine duplicate ingredients');ids.add(item.id);return {ingredient_id:item.id,quantity:qty,unit:item.unit}})}
function readPrices(root,key){const holder=[...root.querySelectorAll('.kitch-prices')].find(x=>x.dataset.request===key);if(!holder)throw Error('Missing prices');return [...holder.querySelectorAll('input[data-ingredient]')].map(x=>{const v=Number(x.value);if(!x.value||!Number.isFinite(v)||v<0||v>10000000)throw Error('Enter price for every ingredient');return {ingredient_id:x.dataset.ingredient,unit_price:v}})}
function priceFields(group){return '<div class="kitch-prices" data-request="'+E(group.id)+'">'+group.lines.map(x=>'<label style="display:block;margin:8px 0">'+E(x.ingredient)+' ('+E(x.quantity)+' '+E(x.unit)+')<input data-ingredient="'+E(x.ingredient_id)+'" type="number" min="0" step="0.01" placeholder="AED per unit"></label>').join('')+'</div>'}
async function workflow(args){
 const {data,error}=await sb.rpc(args.p_items?'kitch_purchase_multi':'kitch_purchase_workflow',args);
 if(error)throw Error(error.message||'Unable to connect to purchasing');
 return data;
}
function staffArgs(action,extra={}){
 const a=teamCloudAuth;if(!a?.staff_name||!a.pin)throw Error('Sign in with your Team account');
 return {p_action:action,p_staff_name:a.staff_name,p_pin:a.pin,...extra};
}
async function staffRefresh(force=false){
 let a=teamCloudAuth;if(!a?.staff_name||staffLoading)return;
 const key=a.staff_name+'|'+a.workspace_code+'|'+a.pin;
 if(staffKey!==key){staffCache=null;staffError='';staffKey=key;}
 if(staffCache&&!force)return;
 staffLoading=true;staffError='';
 try{staffCache=await workflow(staffArgs('list'))}
 catch(e){staffCache=null;staffError=e.message}
 finally{
  staffLoading=false;
  if(document.getElementById('pageTitle')?.textContent==='Suppliers & Purchasing')openPage('Suppliers & Purchasing');
 }
}
async function staffAct(action,extra){
 try{
  await workflow(staffArgs(action,extra));
  staffCache=null;
  await staffRefresh(true);
  alert(action==='create'?'Request sent to Main Office for approval.':'Purchase order recorded. Inventory does not change until receiving.');
 }catch(e){alert('Purchasing: '+e.message)}
}
window.kitchCloudRefresh=()=>staffRefresh(true);
window.kitchAddLine=()=>{const root=document.querySelector('#cloudPurchaseItems .kitch-lines');if(!root)return;if(root.children.length>=50)return alert('Maximum 50 items');const line=root.firstElementChild.cloneNode(true);line.querySelector('select').value='';line.querySelector('input').value='';root.appendChild(line)};
document.addEventListener('click',e=>{if(e.target.closest('#cloudPurchaseItems .kitch-remove')){const line=e.target.closest('.kitch-line');if(line.parentElement.children.length>1)line.remove()}});
window.kitchCloudCreateRequest=()=>{try{const p_items=readItems(document.getElementById('cloudPurchaseItems'),staffCache?.ingredients||[]);staffAct('create',{p_items,p_notes:document.getElementById('cloudPrNotes')?.value||''})}catch(e){alert(e.message)}};
window.kitchCloudMakeOrder=id=>{try{const p_supplier_id=document.getElementById('cloudSupplier_'+id)?.value;if(!p_supplier_id)throw Error('Choose approved supplier');const p_items=readPrices(document,id);staffAct('create_order',{p_request_id:id,p_supplier_id,p_items})}catch(e){alert(e.message)}};
if(typeof roles!=='undefined' && roles.store && !roles.store.nav.includes('Suppliers & Purchasing')){
 roles.store.nav.splice(1,0,'Suppliers & Purchasing');
}
if(typeof purchasingPage==='function'){
 purchasingPage=function(){
  if(!teamCloudAuth?.staff_name)return '<div class="panel"><h2>Purchasing</h2><p>Use your Team login for purchase requests. Main Office handles approvals in its Purchasing tab.</p></div>';
  let a=teamCloudAuth,key=a.staff_name+'|'+a.workspace_code+'|'+a.pin;
  if(staffKey!==key){staffCache=null;staffError='';staffKey=key}
  if(!staffCache&&!staffLoading&&!staffError)setTimeout(()=>staffRefresh(),0);
  if(!staffCache)return '<div class="panel"><h2>Cloud Purchasing</h2><p>'+E(staffError||'Loading cloud requests…')+'</p><button class="btn" onclick="kitchCloudRefresh()">Refresh</button></div>';
  const d=staffCache,role=d.role,canReq=['kitchen_manager','executive_chef','production_staff'].includes(role),canPO=role==='store_manager';
  const reqs=d.requests||[],orders=d.orders||[],suppliers=d.suppliers||[],ingredients=d.ingredients||[];
  const ingredientSel=listOpt(ingredients,'Select ingredient');
  const supplierSel=listOpt(suppliers,'Approved supplier');
  const requestGroups=groupLines(reqs),orderGroups=groupLines(orders);
  const reqRows=requestGroups.map(r=>{
   const canMake=canPO&&r.status==='approved'&&!orderGroups.some(o=>o.request_id===r.id&&o.status!=='cancelled');
   const action=canMake?'<select id="cloudSupplier_'+E(r.id)+'">'+supplierSel+'</select>'+priceFields(r)+
    '<button class="btn black" data-create-po="'+E(r.id)+'">Prepare PO</button>':'—';
   return '<tr><td>'+E(r.request_no)+'</td><td>'+r.lines.map(x=>E(x.ingredient)).join(', ')+'</td><td>'+
     r.lines.map(x=>E(x.quantity)+' '+E(x.unit)).join(', ')+'</td><td>'+E(r.status)+'</td><td>'+action+'</td></tr>';
  }).join('');
  const orderRows=orderGroups.map(o=>'<tr><td>'+E(o.po_no)+'</td><td>'+E(o.supplier)+'</td><td>'+E(o.status)+'</td><td>'+AED(o.lines.reduce((sum,x)=>sum+Number(x.total||0),0))+'</td></tr>').join('');
  return '<div class="panel"><h2>Cloud Purchasing</h2><p class="muted">Kitchen request → Main Office approval → Store Manager order → Store receiving. Purchase approvals never change inventory.</p><div class="actions"><button class="btn" onclick="kitchCloudRefresh()">Refresh from cloud</button></div>'+
   (canReq?'<h3>Request Ingredients</h3><div id="cloudPurchaseItems">'+itemRows(ingredients)+'</div><div class="actions"><button class="btn" onclick="kitchAddLine()">+ Add ingredient</button><input id="cloudPrNotes" maxlength="300" placeholder="Notes (optional)"><button class="btn black" onclick="kitchCloudCreateRequest()">Submit all items</button></div>':'')+
   (canPO&&!suppliers.length?'<p class="note">No approved suppliers available. Ask Main Office to register a supplier before preparing an order.</p>':'')+
   '<h3>Purchase Requests</h3><div style="overflow:auto"><table><tr><th>Request</th><th>Ingredient</th><th>Quantity</th><th>Status</th><th>Action</th></tr>'+reqRows+'</table></div>'+
   '<h3>Purchase Orders</h3><div style="overflow:auto"><table><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Amount</th></tr>'+orderRows+'</table></div></div>';
 };
}
// Main Office is an iframe; insert its Purchasing tab without replacing the original office code.
const officeFrame=document.getElementById('kitchOfficeFrame');
if(!officeFrame)return;
let officeRid=null,officeData=null,officeBranches=[],officeBusy=false;
async function officeContext(){
 const {data:{user},error:e}=await sb.auth.getUser();if(e||!user)throw Error('Sign in as Main Office owner.');
 const {data,error}=await sb.from('kitch_office_owners').select('restaurant_id').eq('user_id',user.id).eq('is_active',true).limit(1);
 if(error||!data?.length)throw Error('No active Main Office owner membership.');
 officeRid=data[0].restaurant_id;return officeRid;
}
async function officeRefresh(frame){
 const doc=frame.contentDocument,root=doc?.getElementById('officePurchaseContent');
 if(!root||officeBusy)return;
 officeBusy=true;root.textContent='Loading company purchase requests…';
 try{
  const rid=await officeContext();
  const [data,br]=await Promise.all([
   workflow({p_action:'list',p_restaurant_id:rid}),
   sb.from('branches').select('id,name').eq('restaurant_id',rid).eq('is_active',true)
  ]);
  if(br.error)throw br.error;
  officeData=data;officeBranches=br.data||[];
  officeRender(frame);
 }catch(e){root.textContent='Unable to load Purchasing: '+(e.message||String(e))}
 finally{officeBusy=false}
}
async function officeAction(frame,action,extra={}){
 if(officeBusy)return;
 const root=frame.contentDocument?.getElementById('officePurchaseContent');
 try{
  if(!officeRid)await officeContext();
  const result=await workflow({p_action:action,p_restaurant_id:officeRid,...extra});
  if(root)root.textContent='Saved. Refreshing company records…';
  await officeRefresh(frame);
 }catch(e){alert('Purchasing: '+(e.message||String(e)))}
}
function officeRender(frame){
 const doc=frame.contentDocument,root=doc.getElementById('officePurchaseContent'),d=officeData;
 if(!root||!d)return;
 const reqs=groupLines(d.requests||[]),orders=groupLines(d.orders||[]),suppliers=d.suppliers||[],ingredients=d.ingredients||[];
 const pending=reqs.filter(x=>x.status==='pending_approval').length;
 const row=reqs.map(r=>{
  const action=r.status==='pending_approval'?'<button class="btn" data-act="approve" data-id="'+E(r.id)+'">Approve</button> <button class="btn" data-act="reject" data-id="'+E(r.id)+'" style="background:#eee;color:#222">Reject</button>':
  (r.status==='approved'&&!orders.some(o=>o.request_id===r.id&&o.status!=='cancelled')?
  '<select id="officeSupplier_'+E(r.id)+'">'+listOpt(suppliers,'Choose approved supplier')+'</select>'+priceFields(r)+'<button class="btn" data-act="create_order" data-id="'+E(r.id)+'">Emergency PO</button>':'—');
  return '<tr><td>'+E(r.request_no)+'</td><td>'+r.lines.map(x=>E(x.ingredient)).join(', ')+'</td><td>'+r.lines.map(x=>E(x.quantity)+' '+E(x.unit)).join(', ')+'</td><td>'+E(String(r.status).replaceAll('_',' '))+'</td><td>'+action+'</td></tr>';
 }).join('');
 root.innerHTML='<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="card"><small>Pending approval</small><div class="number">'+pending+'</div></div><div class="card"><small>Requests</small><div class="number">'+reqs.length+'</div></div><div class="card"><small>Purchase orders</small><div class="number">'+orders.length+'</div></div></div>'+
 '<div class="card" style="margin-top:16px"><h2>Approve or Reject Requests</h2><p class="subhead">Requests are visible for your company only. Approval does not deduct or add stock.</p><div style="overflow:auto"><table><thead><tr><th>Request</th><th>Ingredient</th><th>Quantity</th><th>Status</th><th>Decision</th></tr></thead><tbody>'+row+'</tbody></table></div><button class="btn purchase-primary" data-act="refresh">Refresh</button></div>'+
 '<div class="split" style="margin-top:16px"><div class="card"><h2>Emergency Ingredient Request</h2><p class="subhead">Owner override, still requires approval before an order.</p><div class="purchase-fields"><label class="wide">Location <select id="officeReqBranch">'+listOpt(officeBranches,'Choose location')+'</select></label><div class="wide" id="officeRequestItems">'+itemRows(ingredients)+'</div><button class="btn wide" data-act="add_item" type="button">+ Add ingredient</button><label class="wide">Note <input id="officeReqNote" maxlength="300" placeholder="Reason"></label></div><button class="btn purchase-primary" data-act="create">Submit all ingredients</button></div>'+
 '<div class="card"><h2>Approved Suppliers</h2><p class="subhead">Register a supplier for Store Managers to use when preparing orders.</p><p class="purchase-supplier-empty">'+E(suppliers.map(x=>x.name).join(', ')||'No suppliers registered yet')+'</p><label>Supplier name <input id="officeNewSupplier" maxlength="120" style="width:100%" placeholder="Supplier / company"></label><button class="btn purchase-primary" data-act="add_supplier">Add supplier</button></div></div>'+
 '<div class="card" style="margin-top:16px"><h2>Purchase Orders</h2><table><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Commitment</th></tr>'+orders.map(o=>'<tr><td>'+E(o.po_no)+'</td><td>'+E(o.supplier)+'</td><td>'+E(o.status)+'</td><td>'+AED(o.lines.reduce((sum,x)=>sum+Number(x.total||0),0))+'</td></tr>').join('')+'</table></div>';
 root.querySelector('#officeRequestItems')?.addEventListener('click',e=>{
   const btn=e.target.closest('.kitch-remove');if(!btn)return;
   const line=btn.closest('.kitch-line'),list=line?.parentElement;
   if(list?.children.length>1)line.remove();
 });
 root.querySelectorAll('[data-act]').forEach(button=>button.addEventListener('click',async()=>{
  const act=button.dataset.act,id=button.dataset.id;
  if(act==='refresh')return officeRefresh(frame);
  if(act==='approve')return officeAction(frame,'approve',{p_request_id:id});
  if(act==='reject'){const reason=prompt('Reason for rejection:');if(reason===null)return;return officeAction(frame,'reject',{p_request_id:id,p_notes:reason})}
  if(act==='add_supplier'){const name=root.querySelector('#officeNewSupplier')?.value.trim();if(!name)return alert('Enter supplier name.');return officeAction(frame,'add_supplier',{p_notes:name})}
  if(act==='add_item'){
    const lines=root.querySelector('#officeRequestItems .kitch-lines');
    if(lines.children.length>=50)return alert('Maximum 50 ingredients');
    const row=lines.firstElementChild.cloneNode(true);row.querySelector('select').value='';row.querySelector('input').value='';lines.appendChild(row);return;
  }
  if(act==='create'){
    try{
      const p_branch_id=root.querySelector('#officeReqBranch')?.value;
      if(!p_branch_id)throw Error('Select a location');
      const p_items=readItems(root.querySelector('#officeRequestItems'),ingredients);
      return officeAction(frame,'create',{p_branch_id,p_items,p_notes:root.querySelector('#officeReqNote')?.value||''});
    }catch(e){return alert(e.message)}
  }
  if(act==='create_order'){
   try{
    const p_supplier_id=root.querySelector('#officeSupplier_'+id)?.value;
    if(!p_supplier_id)throw Error('Select approved supplier');
    const p_items=readPrices(root,id);
    return officeAction(frame,'create_order',{p_request_id:id,p_supplier_id,p_items});
   }catch(e){return alert(e.message)}
  }
 }));
}
function installOffice(){
 const doc=officeFrame.contentDocument;
 if(!doc?.getElementById('officeApp')||doc.getElementById('officePurchaseContent'))return;
 const nav=doc.querySelector('#officeApp .topnav');
 const app=doc.getElementById('officeApp');
 if(!nav||!app)return;
 const button=doc.createElement('button');
 button.textContent='Purchasing';button.setAttribute('data-page','approvals');
 const before=nav.querySelector('[data-page="reports"]');nav.insertBefore(button,before||null);
 const ps=doc.createElement('style');ps.id='kitch-purchasing-styles';ps.textContent="#approvals #officePurchaseContent{background:transparent;border:0;padding:0;box-shadow:none}#approvals .card{background:#fff;border:1px solid #ececec;border-radius:22px;padding:24px;min-width:0}#approvals .card h2{font-size:19px;margin:0 0 9px;letter-spacing:-.035em}#approvals .subhead{font-size:12px;color:#888;line-height:1.5;margin:0 0 22px}#approvals .split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#approvals label{display:block;margin:0 0 17px;color:#444;font-size:12px;font-weight:650}#approvals input,#approvals select{display:block;width:100%;max-width:100%;box-sizing:border-box;height:44px;margin:8px 0 0;border:1px solid #dedede;border-radius:11px;background:#fafafa;padding:0 13px;color:#222;font-size:13px}#approvals input:focus,#approvals select:focus{outline:2px solid #ff8a56;outline-offset:1px;background:white}#approvals .purchase-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}#approvals .purchase-fields .wide{grid-column:1/-1}#approvals .purchase-primary{background:#191919;color:#fff;padding:12px 18px;border-radius:11px;font-size:12px;font-weight:700;min-height:44px}#approvals .purchase-supplier-empty{border:1px dashed #e7e7e7;background:#fafafa;padding:14px;border-radius:12px;color:#888;font-size:12px;margin:0 0 20px}#approvals th{background:#fafafa;padding:13px 12px}#approvals td{padding:15px 12px;border-bottom:1px solid #eee}#approvals td input,#approvals td select{min-width:145px}#approvals .grid .card{min-height:135px}@media(max-width:850px){#approvals .split{grid-template-columns:1fr}}@media(max-width:550px){#approvals .purchase-fields{grid-template-columns:1fr}#approvals .card{padding:16px}}input[type=number]{-moz-appearance:textfield!important;appearance:textfield!important}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none!important;margin:0!important;display:none!important}";doc.head.appendChild(ps);
 const section=doc.createElement('section');section.className='section';section.id='approvals';
 section.innerHTML='<div class="hero"><div><h1>Purchasing Approvals</h1><p>Review kitchen requests, authorize orders and manage approved suppliers.</p></div><span class="tag">Main Office · Owner only</span></div><div id="officePurchaseContent">Open this tab to load purchasing records.</div>';
 const footer=app.querySelector('.footer');if(footer)footer.before(section);else app.querySelector('.content')?.appendChild(section);
 // The Main Office is embedded using iframe.srcdoc. Safari may throw on
 // history.replaceState() in the original showPage(), after visually switching
 // tabs but before the purchasing fetch runs. Switch the section directly.
 function activatePurchasing(){
  doc.querySelectorAll('.section').forEach(item=>item.classList.toggle('active',item.id==='approvals'));
  doc.querySelectorAll('[data-page]').forEach(item=>item.classList.toggle('active',item.dataset.page==='approvals'));
  try{if(officeRid)localStorage.setItem('kitch_office_lastpage_'+officeRid,'approvals');}catch(e){}
  void officeRefresh(officeFrame);
 }
 button.addEventListener('click',activatePurchasing);
 // Show a loading indicator rather than an inert placeholder.
 const placeholder=doc.getElementById('officePurchaseContent');
 if(placeholder)placeholder.textContent='Select Purchasing to load your company records.';
 // Handle restored tabs, and also any tab activation performed by older code.
 const tabObserver=new MutationObserver(()=>{
  if(section.classList.contains('active')&&doc.getElementById('officePurchaseContent')?.textContent?.includes('Select Purchasing')){
   void officeRefresh(officeFrame);
  }
 });
 tabObserver.observe(section,{attributes:true,attributeFilter:['class']});
 const onOwnerLoaded=async()=>{
  if(!officeFrame.isConnected||!officeFrame.contentDocument?.getElementById('officePurchaseContent'))return;
  if(doc.getElementById('officeApp')?.classList.contains('officeHidden'))return;
  if(section.classList.contains('active')){void officeRefresh(officeFrame);return;}
  try{
   const rid=await officeContext();
   if(localStorage.getItem('kitch_office_lastpage_'+rid)==='approvals')activatePurchasing();
  }catch(e){console.warn('Purchasing tab restore:',e);}
 };
 let checks=0;
 const checker=setInterval(()=>{
  checks++;
  if(checks>=45||!officeFrame.isConnected){clearInterval(checker);return;}
  if(!doc.getElementById('officeApp')?.classList.contains('officeHidden')){
   clearInterval(checker);
   void onOwnerLoaded();
  }
 },1000);
 if(!doc.getElementById('officeApp')?.classList.contains('officeHidden'))void onOwnerLoaded();
}
officeFrame.addEventListener('load',installOffice);
if(officeFrame.contentDocument?.getElementById('officeApp'))installOffice();
})();