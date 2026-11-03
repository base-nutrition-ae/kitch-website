/* KITCH Purchasing / Main Office approval workflow — additive module */
(function(){
'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AED=v=>'AED '+Number(v||0).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2});
let staffCache=null,staffKey='',staffLoading=false,staffError='';
const listOpt=(items,empty)=>'<option value="">'+E(empty)+'</option>'+items.map(x=>'<option value="'+E(x.id)+'">'+E(x.name)+(x.unit?' ('+E(x.unit)+')':'')+'</option>').join('');
async function workflow(args){
 const {data,error}=await sb.rpc('kitch_purchase_workflow',args);
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
window.kitchCloudCreateRequest=()=>{
 const id=document.getElementById('cloudPrIngredient')?.value;
 const ing=staffCache?.ingredients?.find(x=>x.id===id);
 const qty=Number(document.getElementById('cloudPrQty')?.value);
 if(!ing||!Number.isFinite(qty)||qty<=0)return alert('Choose an ingredient and valid quantity.');
 staffAct('create',{p_ingredient_id:id,p_qty:qty,p_unit:ing.unit,p_notes:document.getElementById('cloudPrNotes')?.value||''});
};
window.kitchCloudMakeOrder=id=>{
 const supplier=document.getElementById('cloudSupplier_'+id)?.value;
 const text=document.getElementById('cloudPrice_'+id)?.value;
 const price=Number(text);
 if(!supplier||text===''||!Number.isFinite(price)||price<0)return alert('Choose an approved supplier and enter unit price.');
 staffAct('create_order',{p_request_id:id,p_supplier_id:supplier,p_price:price});
};
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
  const reqRows=reqs.map(r=>{
   const canMake=canPO&&r.status==='approved'&&!orders.some(o=>o.request_id===r.id&&o.status!=='cancelled');
   const action=canMake?'<select id="cloudSupplier_'+E(r.id)+'">'+supplierSel+'</select> <input id="cloudPrice_'+E(r.id)+'" type="number" min="0" step="0.01" style="width:95px" placeholder="Unit AED"><button class="btn black" onclick="kitchCloudMakeOrder(\''+E(r.id)+'\')">Prepare PO</button>':'—';
   return '<tr><td>'+E(r.request_no)+'</td><td>'+E(r.ingredient)+'</td><td>'+E(r.quantity)+' '+E(r.unit)+'</td><td>'+E(String(r.status).replaceAll('_',' '))+'</td><td>'+action+'</td></tr>';
  }).join('');
  const orderRows=orders.map(o=>'<tr><td>'+E(o.po_no)+'</td><td>'+E(o.supplier)+'</td><td>'+E(o.status)+'</td><td>'+AED(o.total)+'</td></tr>').join('');
  return '<div class="panel"><h2>Cloud Purchasing</h2><p class="muted">Kitchen request → Main Office approval → Store Manager order → Store receiving. Purchase approvals never change inventory.</p><div class="actions"><button class="btn" onclick="kitchCloudRefresh()">Refresh from cloud</button></div>'+
   (canReq?'<h3>Request Ingredients</h3><div class="actions"><select id="cloudPrIngredient">'+ingredientSel+'</select><input id="cloudPrQty" type="number" min="0.001" step="any" placeholder="Quantity in ingredient unit"><input id="cloudPrNotes" maxlength="300" placeholder="Notes (optional)"><button class="btn black" onclick="kitchCloudCreateRequest()">Submit Request</button></div>':'')+
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
 const reqs=d.requests||[],orders=d.orders||[],suppliers=d.suppliers||[],ingredients=d.ingredients||[];
 const pending=reqs.filter(x=>x.status==='pending_approval').length;
 const row=reqs.map(r=>{
  const action=r.status==='pending_approval'?'<button class="btn" data-act="approve" data-id="'+E(r.id)+'">Approve</button> <button class="btn" data-act="reject" data-id="'+E(r.id)+'" style="background:#eee;color:#222">Reject</button>':
  (r.status==='approved'&&!orders.some(o=>o.request_id===r.id&&o.status!=='cancelled')?
  '<select id="officeSupplier_'+E(r.id)+'">'+listOpt(suppliers,'Choose approved supplier')+'</select><input id="officePrice_'+E(r.id)+'" type="number" min="0" step="0.01" placeholder="Price per unit" style="width:130px"><button class="btn" data-act="create_order" data-id="'+E(r.id)+'">Emergency PO</button>':'—');
  return '<tr><td>'+E(r.request_no)+'</td><td>'+E(r.ingredient)+'</td><td>'+E(r.quantity)+' '+E(r.unit)+'</td><td>'+E(String(r.status).replaceAll('_',' '))+'</td><td>'+action+'</td></tr>';
 }).join('');
 root.innerHTML='<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="card"><small>Pending approval</small><div class="number">'+pending+'</div></div><div class="card"><small>Requests</small><div class="number">'+reqs.length+'</div></div><div class="card"><small>Purchase orders</small><div class="number">'+orders.length+'</div></div></div>'+
 '<div class="card" style="margin-top:16px"><h2>Approve or Reject Requests</h2><p class="subhead">Requests are visible for your company only. Approval does not deduct or add stock.</p><div style="overflow:auto"><table><thead><tr><th>Request</th><th>Ingredient</th><th>Quantity</th><th>Status</th><th>Decision</th></tr></thead><tbody>'+row+'</tbody></table></div><button class="btn" data-act="refresh">Refresh</button></div>'+
 '<div class="split" style="margin-top:16px"><div class="card"><h2>Emergency Ingredient Request</h2><p class="subhead">Owner override, still requires approval before an order.</p><label>Location <select id="officeReqBranch">'+listOpt(officeBranches,'Choose location')+'</select></label><label>Ingredient <select id="officeReqIngredient">'+listOpt(ingredients,'Choose ingredient')+'</select></label><label>Quantity <input id="officeReqQty" type="number" min="0.001" step="any" style="width:100%" placeholder="Quantity in ingredient unit"></label><label>Note <input id="officeReqNote" maxlength="300" style="width:100%" placeholder="Reason"></label><button class="btn" data-act="create">Submit emergency request</button></div>'+
 '<div class="card"><h2>Approved Suppliers</h2><p class="subhead">Register a supplier for Store Managers to use when preparing orders.</p><p>'+E(suppliers.map(x=>x.name).join(', ')||'No suppliers registered')+'</p><label>Supplier name <input id="officeNewSupplier" maxlength="120" style="width:100%" placeholder="Supplier / company"></label><button class="btn" data-act="add_supplier">Add supplier</button></div></div>'+
 '<div class="card" style="margin-top:16px"><h2>Purchase Orders</h2><table><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Commitment</th></tr>'+orders.map(o=>'<tr><td>'+E(o.po_no)+'</td><td>'+E(o.supplier)+'</td><td>'+E(o.status)+'</td><td>'+AED(o.total)+'</td></tr>').join('')+'</table></div>';
 root.querySelectorAll('[data-act]').forEach(button=>button.addEventListener('click',async()=>{
  const act=button.dataset.act,id=button.dataset.id;
  if(act==='refresh')return officeRefresh(frame);
  if(act==='approve')return officeAction(frame,'approve',{p_request_id:id});
  if(act==='reject'){const reason=prompt('Reason for rejection:');if(reason===null)return;return officeAction(frame,'reject',{p_request_id:id,p_notes:reason})}
  if(act==='add_supplier'){const name=root.querySelector('#officeNewSupplier')?.value.trim();if(!name)return alert('Enter supplier name.');return officeAction(frame,'add_supplier',{p_notes:name})}
  if(act==='create'){
   const branch=root.querySelector('#officeReqBranch')?.value,ingid=root.querySelector('#officeReqIngredient')?.value;
   const qty=Number(root.querySelector('#officeReqQty')?.value),ingredient=ingredients.find(x=>x.id===ingid);
   if(!branch||!ingredient||!Number.isFinite(qty)||qty<=0)return alert('Select location, ingredient and quantity.');
   return officeAction(frame,'create',{p_branch_id:branch,p_ingredient_id:ingid,p_qty:qty,p_unit:ingredient.unit,p_notes:root.querySelector('#officeReqNote')?.value||''});
  }
  if(act==='create_order'){
   const supplier=root.querySelector('#officeSupplier_'+id)?.value;
   const inp=root.querySelector('#officePrice_'+id),price=Number(inp?.value);
   if(!supplier||!inp?.value||!Number.isFinite(price)||price<0)return alert('Select approved supplier and unit price.');
   return officeAction(frame,'create_order',{p_request_id:id,p_supplier_id:supplier,p_price:price});
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
 const section=doc.createElement('section');section.className='section';section.id='approvals';
 section.innerHTML='<div class="hero"><div><h1>Purchasing Approvals</h1><p>Review kitchen requests, authorize orders and manage approved suppliers.</p></div><span class="tag">Main Office · Owner only</span></div><div id="officePurchaseContent" class="card">Open this tab to load purchasing records.</div>';
 const footer=app.querySelector('.footer');if(footer)footer.before(section);else app.querySelector('.content')?.appendChild(section);
 button.addEventListener('click',()=>{officeFrame.contentWindow.showPage('approvals');officeRefresh(officeFrame)});
 // Restore the purchasing tab after Safari refresh once Main Office owner access is loaded.
 let checks=0;
 const checker=setInterval(async()=>{
  checks++;
  if(checks>16||!officeFrame.isConnected||!officeFrame.contentDocument?.getElementById('officePurchaseContent')){clearInterval(checker);return;}
  if(section.classList.contains('active')){clearInterval(checker);officeRefresh(officeFrame);return;}
  if(!officeFrame.contentDocument.getElementById('officeApp')?.classList.contains('officeHidden')){
   clearInterval(checker);
   try{
    const rid=await officeContext();
    if(localStorage.getItem('kitch_office_lastpage_'+rid)==='approvals'){
      officeFrame.contentWindow.showPage('approvals');
      await officeRefresh(officeFrame);
    }
   }catch(e){console.warn('Purchasing tab restore:',e);}
  }
 },1000);
}
officeFrame.addEventListener('load',installOffice);
if(officeFrame.contentDocument?.getElementById('officeApp'))installOffice();
})();