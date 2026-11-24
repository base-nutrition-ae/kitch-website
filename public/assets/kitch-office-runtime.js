window.__kitchOfficeRuntimeStarted=true;

// KITCH Main Office: authenticated, owner-scoped read access. No service role keys in browser.
(function(){
const URL='https://rtovpjgrezwxuvantxgt.supabase.co';
const KEY='sb_publishable_ERMt86IhOTqRSRXE05CQ-A_JXi27ode';
const el=id=>document.getElementById(id);
const msg=el('officeAuthMessage');
window.__kitchOfficeStartupPhase='initializing interface';
window.addEventListener('error',function(e){
  if(!document.getElementById('officeBoot'))return;
  const issue=(e && e.message)||'A startup component failed';
  window.__kitchOfficeStartupPhase='interface error: '+String(issue).slice(0,160);
});
/* Start auth independently of secondary UI handlers. A broken optional widget
   must not prevent the owner login from initializing. */
setTimeout(function(){
  start().catch(function(e){
    document.getElementById('officeBoot')?.remove();
    setVisible(false);
    say(e?.message||'Unable to start Main Office.');
  });
},0);
let db=null;let officeRid=null,officeBranches=[],officeStaff=[];let officeRestaurantName='';
let officeOpsSnapshot=null, officeOpsLoading=false;
let officePlanStatus=null;

let officeFlowData=null,officeFlowLoading=false;
function officeFlowInstall(){
 const root=document.getElementById('overview');
 if(!root||document.getElementById('officeFlowPanel'))return;
 root.insertAdjacentHTML('beforeend','<section id="officeFlowPanel" aria-label="Company operations control center">'+
 '<div class="ofHead"><div><h2>Operations Control Center</h2><p>Central Kitchen orders and ingredient stock requests across locations</p></div>'+
 '<div class="ofActions"><select id="ofLocation" aria-label="Filter destination location"><option value="all">All locations</option></select><button id="ofRefresh" type="button">Refresh</button></div></div>'+
 '<div id="ofError"></div><div id="ofKpis" class="ofKpis"></div>'+
 '<div class="ofCols"><div class="ofPanel"><h3>Central Kitchen Orders</h3><small>Ready-product lines · current month</small><div id="ofReady" class="ofScroll"></div></div>'+
 '<div class="ofPanel"><h3>Central Store Ingredient Requests</h3><small>Latest 200 stock request lines</small><div id="ofStock" class="ofScroll"></div></div></div>'+
 '<p class="ofFoot">Read-only company records. Approvals, dispatch and receiving remain in the relevant team workspace.</p></section>');
 document.getElementById('ofLocation').addEventListener('change',officeFlowRender);
 document.getElementById('ofRefresh').addEventListener('click',officeFlowRefresh);
}
function officeFlowRender(){
 if(!officeFlowData)return;
 const filter=document.getElementById('ofLocation')?.value||'all';
 const ready=(officeFlowData.ready||[]).filter(x=>filter==='all'||String(x.branch_id)===filter);
 const stock=(officeFlowData.stock||[]).filter(x=>filter==='all'||String(x.branch_id)===filter);
 const tiles=[
 ['CK awaiting approval',ready.filter(x=>x.status==='Requested').length],
 ['CK approved / to dispatch',ready.filter(x=>x.status==='Accepted').length],
 ['Ready products in transit',ready.filter(x=>x.status==='In Transfer').length],
 ['Store requests awaiting approval',stock.filter(x=>x.status==='Requested').length]
 ];
 document.getElementById('ofKpis').innerHTML=tiles.map(x=>'<div class="ofKpi"><small>'+safe(x[0])+'</small><strong>'+x[1]+'</strong></div>').join('');
 const rows=(data,kind)=>data.length?
 '<table><thead><tr><th>REF</th><th>LOCATION</th><th>ITEM / QUANTITY</th><th>STATUS</th></tr></thead><tbody>'+
 data.slice(0,50).map(x=>'<tr><td>#'+safe(x.id)+(x.group_ref?'<small>Group '+safe(String(x.group_ref).slice(0,8))+'</small>':'')+
 '</td><td>'+safe(x.branch_name||'—')+'</td><td><strong>'+safe(kind==='ready'?x.product_name:x.ingredient_name)+
 '</strong><small>'+safe(x.qty)+' '+safe(x.unit)+'</small></td><td><span class="ofStatus">'+safe(x.status)+'</span></td></tr>').join('')+
 '</tbody></table>':'<div class="ofEmpty">No matching cloud records for this location.</div>';
 document.getElementById('ofReady').innerHTML=rows(ready,'ready');
 document.getElementById('ofStock').innerHTML=rows(stock,'stock');
}
async function officeFlowRefresh(){
 if(!officeRid||!db||officeFlowLoading)return;
 officeFlowInstall();officeFlowLoading=true;
 const btn=document.getElementById('ofRefresh');if(btn){btn.disabled=true;btn.textContent='Refreshing…'}
 try{
  const {data,error}=await db.rpc('kitch_owner_flow_monitor');
  if(error)throw error;
  if(String(data?.restaurant_id)!==String(officeRid))throw Error('Company mismatch in operations report');
  officeFlowData=data;
  const sel=document.getElementById('ofLocation'),value=sel.value;
  sel.innerHTML='<option value="all">All locations</option>'+officeBranches.filter(b=>b.is_active).map(b=>'<option value="'+safe(b.id)+'">'+safe(b.name)+'</option>').join('');
  if([...sel.options].some(x=>x.value===value))sel.value=value;
  document.getElementById('ofError').textContent='';
  officeFlowRender();
 }catch(e){
  officeFlowData=null;
  document.getElementById('ofError').textContent='Live operations unavailable: '+String(e.message||e)+'. No estimated totals shown.';
  document.getElementById('ofKpis').innerHTML='';
  document.getElementById('ofReady').textContent='Data unavailable';
  document.getElementById('ofStock').textContent='Data unavailable';
 }finally{officeFlowLoading=false;if(btn){btn.disabled=false;btn.textContent='Refresh'}}
}

function say(t){msg.textContent=t||'';}
function setVisible(on){el('officeAuth').classList.toggle('officeHidden',on);el('officeApp').classList.toggle('officeHidden',!on);}
function money(n){return 'AED '+Number(n||0).toLocaleString('en-AE',{maximumFractionDigits:2,minimumFractionDigits:2});}
function setKpi(label,value){const cards=[...document.querySelectorAll('#overview .overview-kpis .card')];const card=cards.find(c=>c.querySelector('small')?.textContent.trim()===label);if(card)card.querySelector('.number').textContent=value;}
function safe(t){return String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadOwner(initialUser){
 // Reuse the already-validated session user. A second getUser() network request
 // during embedded startup can stall before the owner workspace is shown.
 let user=initialUser;
 if(!user){const result=await db.auth.getUser();user=result.data?.user;if(result.error||!user){setVisible(false);return;}}
 if(!user){setVisible(false);return;}
 const {data:members,error:me}=await db.from('kitch_office_owners').select('restaurant_id,role').eq('user_id',user.id).eq('is_active',true).limit(1);
 if(me){setVisible(false);say('Main Office database setup is required. Run the supplied SQL and assign your owner account. '+me.message);return;}
 if(!members?.length){setVisible(false);say('Your email is signed in but has not been assigned as a KITCH Main Office owner. Ask the administrator to link your account.');return;}
 const rid=members[0].restaurant_id;officeRid=rid;
 // Owner access is confirmed; show the workspace immediately. KPI and inventory
 // requests populate asynchronously and must not keep the full-screen boot visible.
 window.__kitchOfficeStartupPhase='loading dashboard data';
 setVisible(true);
 document.getElementById('officeBoot')?.remove();
 // Ingredient Master is always initialized for the owner, not only on a hash route.
 refreshIngredients().catch(err=>{const status=document.getElementById('officeIngredientStatus');if(status)status.textContent='Ingredient load failed: '+err.message;});
 const [r,b,staff,inventory,ings,recipes,receipts,production,purchaseRequests,purchaseOrders,purchaseOrderItems]=await Promise.all([
 db.from('restaurants').select('name,currency').eq('id',rid).single(),
 db.from('branches').select('id,name,code,branch_type,is_active').eq('restaurant_id',rid),
 db.from('staff_access').select('id,staff_name,role,section,branch_id,is_active').eq('restaurant_id',rid),
 db.from('kitch_office_inventory_read').select('ingredient_id,quantity_on_hand,indicative_unit_cost,branch_id').eq('restaurant_id',rid),
 db.from('ingredients').select('id,name,minimum_stock,is_active,is_current_master').eq('restaurant_id',rid).eq('is_active',true).eq('is_current_master',true),
 db.rpc('kitch_owner_operations_summary'),
 db.from('kitch_receiving_entries').select('id,branch_id,delivered_qty,rejected_qty,unit_price,received_at,invoice_filename').eq('restaurant_id',rid).gte('received_at',new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString()),
 Promise.resolve({data:null,error:null}), // Production runs are summarized securely by owner RPC above
 db.from('purchase_requests').select('id,request_no,status,branch_id,requested_at,created_at,supplier_id').eq('restaurant_id',rid),
 db.from('purchase_orders').select('id,po_no,status,branch_id,ordered_at,created_at,supplier_id').eq('restaurant_id',rid),
 db.from('purchase_order_items').select('purchase_order_id,ordered_qty,unit_price').eq('restaurant_id',rid)
 ]);
 const errors=[r,b,staff,inventory,ings].filter(x=>x.error).map(x=>x.error.message);if(errors.length){setVisible(false);say('Data access needs attention: '+errors.join('; '));return;} if(recipes.error){setVisible(false);say('Recipe access needs attention: '+recipes.error.message);return;}
 officeRestaurantName=String(r.data?.name||'').trim();
 setVisible(true);
 const currentIds=new Set((ings.data||[]).map(x=>String(x.id)));
 const branches=(b.data||[]).filter(x=>x.is_active),team=(staff.data||[]).filter(x=>x.is_active),bal=(inventory.data||[]).filter(x=>currentIds.has(String(x.ingredient_id)));officeBranches=b.data||[];officeStaff=staff.data||[];renderStaff();renderLocations();void officeRefreshPackageStatus();bindOfficeLocationOperations();refreshOfficeLocationOperations().catch(e=>console.warn('Office location report unavailable',e));
 officeFlowInstall();void officeFlowRefresh();
 const val=bal.reduce((s,x)=>s+Number(x.quantity_on_hand||0)*Number(x.indicative_unit_cost||0),0);
 if(!bal.length){const note=document.querySelector('#overview .notice');if(note)note.textContent='No inventory rows are visible to this account yet. Check owner inventory permissions before interpreting AED 0.00 as a real balance.';}
 setKpi('Active Locations',String(branches.length).padStart(2,'0'));
 setKpi('Active Staff',String(team.length));
 setKpi('Inventory Value',money(val));
 // Count only actual cloud-synced recipes, not browser-local recipe drafts.
 const ownerOps=(!recipes.error&&recipes.data&&typeof recipes.data==='object')?recipes.data:null;
 setKpi('Active Recipes',ownerOps?String(Number(ownerOps.synced_recipe_count||0)):'—');
 const recipeCard=[...document.querySelectorAll('#overview .overview-kpis .card')].find(c=>c.querySelector('small')?.textContent.trim()==='Active Recipes');
 if(recipeCard)recipeCard.querySelector('.foot').textContent=ownerOps?'Cloud-synced recipes; local recipes may differ':'Cloud recipe summary unavailable';
 // Use actual receiving records, not the legacy movement source filter.
 // A denied table read is shown as unavailable, never as a misleading zero.
 const receivingConnected=!receipts.error;
 const received=receivingConnected?(receipts.data||[]):[];
 const receivedValue=received.reduce((sum,x)=>sum+Math.max(0,Number(x.delivered_qty||0)-Number(x.rejected_qty||0))*Number(x.unit_price||0),0);
 setKpi('Receiving Entries',receivingConnected?String(received.length):'—');
 const productionConnected=Boolean(ownerOps);
 const productionRows=[]; // Completion is not represented by stock-deduction request logs.
 const completedProduction=[];
 setKpi('Production Batches',ownerOps?String(Number(ownerOps.production_runs_this_month||0)):'—');
 const productionCard=[...document.querySelectorAll('#overview .overview-kpis .card')].find(c=>c.querySelector('small')?.textContent.trim()==='Production Batches');
 if(productionCard)productionCard.querySelector('.foot').textContent=ownerOps?'Stock-deducted runs this month · completion not tracked':'Cloud production summary unavailable';
 const receivingCard=[...document.querySelectorAll('#overview .overview-kpis .card')].find(c=>c.querySelector('small')?.textContent.trim()==='Receiving Entries');
 if(receivingCard)receivingCard.querySelector('.foot').textContent=receivingConnected?'Recorded deliveries this month':'Receiving access not connected';

 // Low stock is based on the ingredient's minimum stock threshold across all locations.
 // Ignore ingredients with no positive minimum threshold; compare only active ingredients.
 const totals=new Map();for(const x of bal)totals.set(x.ingredient_id,(totals.get(x.ingredient_id)||0)+Number(x.quantity_on_hand||0));
 const lows=(ings.data||[]).filter(x=>x.is_active!==false && (totals.get(x.id)||0)<=Number(x.minimum_stock||0));
 const summary=[...document.querySelectorAll('#overview .summary-rows > div')];
 const updateSummary=(label,value)=>{const row=summary.find(x=>x.querySelector('span')?.textContent.trim()===label);if(row)row.querySelector('strong').textContent=value;};
 updateSummary('Stock on hand',String(bal.filter(x=>Number(x.quantity_on_hand)>0).length)+' stocked ingredient balances');
 updateSummary('Low / Out · Current Master',String(lows.length));
 updateSummary('Receiving requiring review',receivingConnected?String(received.filter(x=>Number(x.rejected_qty||0)>0).length)+' with rejected quantity':'Not connected');
 updateSummary('Production cost this month',ownerOps?money(Number(ownerOps.production_cost_this_month||0))+' · stock usage':'Not available');

 // Read the shared cloud purchasing ledger, not browser-only demo purchase orders.
 const purchasingReady=!purchaseRequests.error&&!purchaseOrders.error&&!purchaseOrderItems.error;
 const reqs=purchasingReady?(purchaseRequests.data||[]):[];
 const sharedOrders=purchasingReady?(purchaseOrders.data||[]):[];
 const sharedLines=purchasingReady?(purchaseOrderItems.data||[]):[];
 const orderTotals=new Map();
 for(const line of sharedLines){
  const key=String(line.purchase_order_id);
  orderTotals.set(key,(orderTotals.get(key)||0)+Number(line.ordered_qty||0)*Number(line.unit_price||0));
 }
 const waiting=reqs.filter(x=>String(x.status).toLowerCase()==='pending_approval');
 const outstanding=sharedOrders.filter(x=>['approved','open','sent'].includes(String(x.status).toLowerCase()));
 updateSummary('Pending purchase orders',purchasingReady?String(waiting.length)+' purchase requests':'Cloud purchasing unavailable');
 const purchasingCard=[...document.querySelectorAll('#overview .overview-kpis .card')].find(c=>c.querySelector('small')?.textContent.trim()==='Monthly Purchasing');
 const currentMonth=new Date().toISOString().slice(0,7);
 const monthly=sharedOrders.filter(x=>String(x.ordered_at||x.created_at||'').slice(0,7)===currentMonth&&!['cancelled','rejected'].includes(String(x.status).toLowerCase()));
 if(purchasingCard){
  purchasingCard.querySelector('.number').textContent=purchasingReady?money(monthly.reduce((sum,x)=>sum+Number(orderTotals.get(String(x.id))||0),0)):'—';
  purchasingCard.querySelector('.foot').textContent=purchasingReady?'Shared cloud purchase orders · Current month':'Cloud purchasing read unavailable';
 }
 const summaryRoot=el('overview').querySelector('.summary-rows');
 let pendingDeliveries=el('ownerPendingDeliveries');if(!pendingDeliveries&&summaryRoot){pendingDeliveries=document.createElement('div');pendingDeliveries.id='ownerPendingDeliveries';summaryRoot.appendChild(pendingDeliveries);}
 if(pendingDeliveries)pendingDeliveries.innerHTML='<span>Orders awaiting delivery (cloud)</span><strong>'+(purchasingReady?outstanding.length:'—')+'</strong>';
 const activityTable=[...el('overview').querySelectorAll('.titleline')].find(x=>x.querySelector('h2')?.textContent.trim()==='Recent Activity')?.parentElement?.querySelector('tbody');
 if(activityTable){
  const activities=[
   ...reqs.map(x=>({name:x.request_no||'Purchase request',branch_id:x.branch_id,status:x.status,date:x.requested_at||x.created_at})),
   ...sharedOrders.map(x=>({name:x.po_no||'Purchase order',branch_id:x.branch_id,status:x.status,date:x.ordered_at||x.created_at}))
  ].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,8);
  const locationName=id=>branches.find(x=>String(x.id)===String(id))?.name||'—';
  activityTable.innerHTML=purchasingReady?(activities.map(x=>'<tr><td>'+safe(x.name)+'</td><td>'+safe(locationName(x.branch_id))+'</td><td>Cloud</td><td>'+safe(x.status)+'</td><td>'+safe(String(x.date||'').slice(0,10)||'—')+'</td></tr>').join('')||'<tr><td colspan="5">No shared purchase requests or orders recorded yet.</td></tr>'):'<tr><td colspan="5">Cloud purchasing temporarily unavailable. No browser-only orders shown.</td></tr>';
 }
 // Receipts are real spending evidence, but not a complete purchasing ledger.

 const notes=el('overview').querySelector('.note');if(notes)notes.textContent='Live inventory, recipes and low-stock alerts are connected. '+(receivingConnected?'Receiving entries are now read from saved deliveries. ':'Receiving entries need owner read permission. ')+(purchasingReady?'Purchase requests and purchase orders are read from the shared cloud. ':'Cloud purchasing could not be read; values are not shown as zero. ')+'Production stock usage is read from the cloud ledger; final production completion and billing are not yet cloud-connected.';

 const prodSummaryId='ownerProductionSummary';
 let prodSummary=el(prodSummaryId);
 if(!prodSummary){prodSummary=document.createElement('div');prodSummary.id=prodSummaryId;prodSummary.className='formrow';const target=el('overview').querySelector('.summary-rows');if(target)target.appendChild(prodSummary);}
 if(prodSummary)prodSummary.innerHTML='<span>Production completion / review status</span><strong>Not yet cloud-tracked</strong>';
 const receiptSummaryId='ownerReceivingTotal';
 let receiptSummary=el(receiptSummaryId);
 if(!receiptSummary){receiptSummary=document.createElement('div');receiptSummary.id=receiptSummaryId;receiptSummary.className='formrow';const target=el('overview').querySelector('.summary-rows');if(target)target.appendChild(receiptSummary);}
 if(receiptSummary)receiptSummary.innerHTML='<span>Received stock value this month</span><strong>'+(receivingConnected?money(receivedValue):'Not connected')+'</strong>';
 const locSection=el('locations');
 if(locSection)renderLocations();

 const locRows=el('overview').querySelector('.overview-scroll tbody');if(locRows)locRows.innerHTML=branches.map(x=>'<tr><td>'+safe(x.name)+'</td><td>'+money(bal.filter(y=>y.branch_id===x.id).reduce((s,y)=>s+Number(y.quantity_on_hand||0)*Number(y.indicative_unit_cost||0),0))+'</td><td>—</td><td>'+'—'+'</td><td>Active</td></tr>').join('')||'<tr><td colspan="5">No locations</td></tr>';
 const title=el('officeApp').querySelector('.profile');if(title)title.setAttribute('title',(r.data?.name||'KITCH')+' · '+user.email);
 const logout=el('officeSidebarLogout');if(logout)logout.onclick=async()=>{logout.disabled=true;try{window.parent.postMessage({type:'KITCH_OFFICE_SIGNED_OUT'},'*');const {error}=await db.auth.signOut({scope:'local'});if(error)console.warn('KITCH office sign-out:',error.message);officeRid=null;officeRestaurantName='';officeIngredients=[];}catch(e){console.warn('KITCH office sign-out:',e);}finally{logout.disabled=false;}};
}


async function refreshOfficeLocationOperations(){
 if(!officeRid||officeOpsLoading)return;
 officeOpsLoading=true;
 const status=el('officeOpsStatus');
 if(status)status.textContent='Loading verified location data…';
 try{
  const {data,error}=await db.rpc('kitch_owner_location_operations');
  if(error)throw error;
  if(String(data?.restaurant_id)!==String(officeRid))throw Error('Wrong company report response');
  officeOpsSnapshot=data;
  renderOfficeLocationOperations();
 }catch(e){
  if(status)status.textContent='Location report unavailable: '+String(e.message||e);
  if(el('officeOpsRows'))el('officeOpsRows').innerHTML='<tr><td colspan="8">Live records unavailable. No estimated totals shown.</td></tr>';
  if(el('officeOpsActivity'))el('officeOpsActivity').innerHTML='<tr><td colspan="5">Could not load verified activity.</td></tr>';
 }finally{officeOpsLoading=false}
}
function renderOfficeLocationOperations(){
 const data=officeOpsSnapshot;
 if(!data)return;
 const locations=Array.isArray(data.locations)?data.locations:[];
 const events=Array.isArray(data.activity)?data.activity:[];
 const filter=el('officeOpsLocationFilter'),status=el('officeOpsStatus');
 if(filter){
  const current=filter.value||'all';
  filter.innerHTML='<option value="all">All locations</option>'+locations.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+' ('+safe(x.branch_type)+')</option>').join('');
  if(current==='all'||locations.some(x=>String(x.id)===current))filter.value=current;
 }
 const selected=filter?.value||'all';
 const visible=selected==='all'?locations:locations.filter(x=>String(x.id)===selected);
 const count=x=>Number(x||0).toLocaleString('en-AE');
 const moneyOrDash=x=>x==null?'—':money(x);
 const cells=visible.map(x=>'<tr><td><b>'+safe(x.name)+'</b><div style="font-size:11px;color:#888">'+safe(x.branch_type)+'</div></td><td>'+moneyOrDash(x.inventory_value)+'</td><td>'+count(x.production_runs)+'</td><td>'+moneyOrDash(x.production_stock_cost)+'</td><td>'+count(x.receiving_entries)+' · '+moneyOrDash(x.receiving_value)+'</td><td>'+count(x.ready_product_orders)+'</td><td>'+count(x.stock_counts)+'</td><td>'+count(x.stock_transfers)+'</td></tr>');
 if(selected==='all'&&visible.length){
  const sum=k=>visible.reduce((s,x)=>s+Number(x[k]||0),0);
  cells.push('<tr style="font-weight:750;background:#f5f5f6"><td>ALL LOCATIONS</td><td>'+money(sum('inventory_value'))+'</td><td>'+count(sum('production_runs'))+'</td><td>'+money(sum('production_stock_cost'))+'</td><td>'+count(sum('receiving_entries'))+' · '+money(sum('receiving_value'))+'</td><td>'+count(sum('ready_product_orders'))+'</td><td>'+count(sum('stock_counts'))+'</td><td>—</td></tr>');
 }
 if(el('officeOpsRows'))el('officeOpsRows').innerHTML=cells.join('')||'<tr><td colspan="8">No matching locations.</td></tr>';
 // Transfers appear per participating location; do not sum them as a company total.
 const locationName=Object.fromEntries(locations.map(x=>[String(x.id),x.name]));
 const activity=events.filter(x=>selected==='all'||String(x.branch_id)===selected);
 if(el('officeOpsActivity'))el('officeOpsActivity').innerHTML=activity.slice(0,100).map(x=>'<tr><td>'+safe(String(x.at||'').replace('T',' ').slice(0,16))+'</td><td>'+safe(locationName[String(x.branch_id)]||'—')+'</td><td>'+safe(x.event_type)+'</td><td>'+safe(x.description)+'</td><td>'+safe(x.actor)+'</td></tr>').join('')||'<tr><td colspan="5">No transactions recorded for this location during the selected period.</td></tr>';
 if(status)status.textContent='Verified cloud report · '+safe(data.month||'Current month');
 if(el('officeOpsNote'))el('officeOpsNote').textContent='Current inventory balances; other counts month-to-date. Production runs measure raw ingredient deductions, not finished QC. Transfers are counted per participating location and not added to the company total. Multi-brand allocations are not yet connected.';
 const cards=[...document.querySelectorAll('#reports .grid .card')];
 if(cards[0])cards[0].querySelector('.number').textContent=money(visible.reduce((a,x)=>a+Number(x.inventory_value||0),0));
 if(cards[1])cards[1].querySelector('.number').textContent=money(visible.reduce((a,x)=>a+Number(x.production_stock_cost||0),0));
 // Purchase expenditure isn't derivable from the receiving ledger; avoid calling it purchasing.
 if(cards[2]){cards[2].querySelector('small').textContent='Supplier Receiving Value';cards[2].querySelector('.number').textContent=money(visible.reduce((a,x)=>a+Number(x.receiving_value||0),0));}
 if(cards[3]){cards[3].querySelector('small').textContent='Ready Product Requests';cards[3].querySelector('.number').textContent=count(visible.reduce((a,x)=>a+Number(x.ready_product_orders||0),0));}
 const overviewRows=el('overview')?.querySelector('.overview-scroll tbody');
 if(overviewRows&&locations.length){
  overviewRows.innerHTML=locations.filter(x=>x.is_active).map(x=>'<tr><td>'+safe(x.name)+'</td><td>'+money(x.inventory_value)+'</td><td>'+count(x.purchase_requests)+' requests</td><td>'+count(x.production_runs)+' runs</td><td>Active</td></tr>').join('');
 }
}
function bindOfficeLocationOperations(){
 const filter=el('officeOpsLocationFilter'),btn=el('officeOpsReload');
 if(filter&&!filter.dataset.ready){filter.dataset.ready='yes';filter.onchange=renderOfficeLocationOperations;}
 if(btn&&!btn.dataset.ready){btn.dataset.ready='yes';btn.onclick=()=>refreshOfficeLocationOperations();}
}

function renderLocations(){const target=el('locations')?.querySelector('table tbody');if(!target)return;target.innerHTML=officeBranches.map(x=>'<tr><td>'+safe(x.name)+'</td><td>'+safe(x.branch_type==='central_store'?'Central Store':x.branch_type==='central_kitchen'?'Central Kitchen':'Restaurant / Branch')+' · '+safe(x.code||'—')+'</td><td>'+ (x.is_active?'Active':'Inactive')+' <button type="button" class="officeMini" data-location-edit="'+safe(x.id)+'">Edit</button> <button type="button" class="officeMini" data-location-toggle="'+safe(x.id)+'">'+(x.is_active?'Deactivate':'Activate')+'</button></td></tr>').join('')||'<tr><td colspan="3">No locations found</td></tr>';target.querySelectorAll('[data-location-edit]').forEach(btn=>btn.onclick=()=>openLocation(officeBranches.find(x=>x.id===btn.dataset.locationEdit)));target.querySelectorAll('[data-location-toggle]').forEach(btn=>btn.onclick=()=>toggleLocation(btn.dataset.locationToggle));}
function officeHeaderPlanBadge(planStatus){
 const badge=el('officePlanTopBadge');
 if(!badge)return;
 const verified=planStatus&&String(planStatus.restaurant_id)===String(officeRid)&&['active','trialing'].includes(planStatus.subscription_status);
 const starter=verified&&planStatus.plan==='starter';
 const pro=verified&&planStatus.plan==='pro';
 badge.textContent=starter?'◆ KITCH STARTER':pro?'◆ KITCH PRO':'Package not verified';
 badge.style.background=starter?'#f0f1f3':pro?'#22242a':'#f5f5f5';
 badge.style.color=starter?'#25282e':pro?'#fff':'#666';
 badge.title=starter?'Starter · AED 149/month':pro?'Pro · AED 249/month':'Subscription details could not be verified';
}
async function officeRefreshPackageStatus(){
 if(!officeRid||!db)return;
 const {data,error}=await db.rpc('kitch_owner_package_status');
 if(error||String(data?.restaurant_id)!==String(officeRid)){
  officePlanStatus=null;officeHeaderPlanBadge(null);const n=el('officeLocationNote');if(n)n.textContent='Subscription information unavailable. KITCH Cloud checks the plan before permitting any location changes.';
  return;
 }
 officePlanStatus=data;officeHeaderPlanBadge(data);
 const starter=data.plan==='starter',pro=data.plan==='pro';
 const tag=el('officePackageLabel');if(tag)tag.textContent=starter?'KITCH Starter · 1 restaurant':pro?'KITCH Pro · Multi-location':'Subscription verification required';
 const note=el('officeLocationNote');
 if(note)note.textContent=starter?'KITCH Starter includes one complete Restaurant Kitchen. Main Office controls purchasing, recipes, inventory, receiving, production and reports. Upgrade to Pro to add locations.':pro?'KITCH Pro includes unlimited locations. Add Restaurant Branch, Central Kitchen or Central Store only when needed. Each has separate stock and staff permissions.':'Your package is not yet mapped. Contact KITCH support before adding locations.';
 const add=el('officeAddLocation');
 if(add){add.disabled=!pro || data.subscription_status==='not_active';add.title=starter?'Starter includes one full kitchen. Pro is required to add more locations.':pro?'Add another location': 'Verify subscription first';}
}
function openLocation(x){const d=el('officeLocationDialog');el('officeLocationForm').reset();el('officeLocationId').value=x?.id||'';el('officeLocationTitle').textContent=x?'Edit Location':'Add Location';el('officeLocationName').value=x?.name||'';el('officeLocationCode').value=x?.code||'';el('officeLocationType').value=x?.branch_type==='restaurant'?'branch':(x?.branch_type||'branch');el('officeLocationDeliveryAddress').value=x?.delivery_address||'';el('officeLocationDeliveryInstructions').value=x?.delivery_instructions||'';el('officeLocationMessage').textContent='';d.showModal();}
async function refreshLocations(){const [br,staff]=await Promise.all([db.from('branches').select('id,name,code,branch_type,is_active,delivery_address,delivery_instructions').eq('restaurant_id',officeRid),db.from('staff_access').select('id,staff_name,role,section,branch_id,is_active').eq('restaurant_id',officeRid)]);if(br.error){alert(br.error.message);return;}officeBranches=br.data||[];if(!staff.error)officeStaff=staff.data||[];renderLocations();renderStaff();setKpi('Active Locations',String(officeBranches.filter(x=>x.is_active).length).padStart(2,'0'));await loadOwner();}
async function toggleLocation(id){const x=officeBranches.find(y=>y.id===id);if(!x)return;const action=x.is_active?'deactivate':'activate';if(!confirm((x.is_active?'Deactivate ':'Activate ')+x.name+'?'))return;const {error}=await db.rpc('kitch_office_manage_location',{p_action:action,p_restaurant_id:officeRid,p_branch_id:id});if(error){alert(error.message);return;}await refreshLocations();}
el('officeAddLocation').onclick=()=>{if(officePlanStatus?.plan!=='pro')return alert('KITCH Pro is required to create additional locations.');openLocation(null);};
el('officeLocationCancel').onclick=()=>el('officeLocationDialog').close();
el('officeLocationX').onclick=()=>el('officeLocationDialog').close();
el('officeLocationForm').onsubmit=async e=>{e.preventDefault();if(!el('officeLocationId').value&&officePlanStatus?.plan!=='pro')return alert('Only Pro can add additional locations.');const btn=el('officeLocationSave'),id=el('officeLocationId').value;btn.disabled=true;el('officeLocationMessage').textContent='Saving…';const {error}=await db.rpc('kitch_office_manage_location',{p_action:id?'update':'create',p_restaurant_id:officeRid,p_branch_id:id||null,p_name:el('officeLocationName').value.trim(),p_code:el('officeLocationCode').value.trim()||null,p_branch_type:el('officeLocationType').value});btn.disabled=false;if(error){el('officeLocationMessage').textContent=error.message;return;}
 const savedAddress=el('officeLocationDeliveryAddress').value.trim(),savedInstructions=el('officeLocationDeliveryInstructions').value.trim();
 const {data:branches,error:branchError}=await db.from('branches').select('id,name').eq('restaurant_id',officeRid);
 if(branchError){el('officeLocationMessage').textContent='Location saved but delivery details could not be loaded: '+branchError.message;return;}
 const matching=id?branches.find(x=>String(x.id)===String(id)):branches.filter(x=>x.name===el('officeLocationName').value.trim()).at(-1);
 if(!matching){el('officeLocationMessage').textContent='Location saved, but delivery address could not be linked. Refresh and edit this location.';return;}
 const {error:deliveryError}=await db.rpc('kitch_office_location_delivery',{p_action:'save',p_restaurant_id:officeRid,p_branch_id:matching.id,p_address:savedAddress,p_instructions:savedInstructions});
 if(deliveryError){el('officeLocationMessage').textContent='Location saved, but delivery address failed: '+deliveryError.message;return;}
 el('officeLocationDialog').close();await refreshLocations();};
const staffRoles=['executive_chef','kitchen_manager','store_manager','production_staff','receiving_staff'];
const staffRoleLabels={executive_chef:'Executive Chef',kitchen_manager:'Kitchen Manager',store_manager:'Store Manager',production_staff:'Production Staff',receiving_staff:'Receiving Staff'};
const staffRoleLabel=r=>staffRoleLabels[r]||String(r||'').replaceAll('_',' ');
function renderStaff(){const target=el('staff')?.querySelector('table tbody');if(!target)return;target.innerHTML=officeStaff.map(x=>'<tr><td>'+safe(x.staff_name)+'</td><td>'+safe(staffRoleLabel(x.role))+'</td><td>'+safe(officeBranches.find(z=>z.id===x.branch_id)?.name||'—')+'</td><td>'+ (x.is_active?'Active':'Inactive') +'</td><td><button class="officeMini" data-edit="'+safe(x.id)+'">Edit</button> <button class="officeMini" data-toggle="'+safe(x.id)+'">'+(x.is_active?'Deactivate':'Activate')+'</button></td></tr>').join('')||'<tr><td colspan="5">No staff accounts</td></tr>';target.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openStaff(officeStaff.find(x=>x.id===b.dataset.edit)));target.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleStaff(b.dataset.toggle));}
function openStaff(x){if(!officeBranches.length){alert('No active locations available.');return;}const dialog=el('officeStaffDialog'),f=el('officeStaffForm');f.reset();el('staffFormTitle').textContent=x?'Edit Staff':'Add Staff';el('staffRecordId').value=x?.id||'';el('staffFullName').value=x?.staff_name||'';el('staffSection').value=x?.section||'';el('staffPin').required=!x;el('staffPin').placeholder=x?'Leave blank to keep existing PIN':'4–8 digit PIN';el('staffRole').innerHTML=[...staffRoles,...(x?.role&&!staffRoles.includes(x.role)?[x.role]:[])].map(r=>'<option value="'+r+'">'+safe(staffRoleLabel(r))+(staffRoles.includes(r)?'':' (existing role)')+'</option>').join('');el('staffRole').value=x?.role||'kitchen_manager';if(!x&&el('staffRole').value==='production_staff')el('staffSection').value='Kitchen / Production';el('staffBranch').innerHTML=officeBranches.map(b=>'<option value="'+safe(b.id)+'">'+safe(b.name)+'</option>').join('');el('staffBranch').value=x?.branch_id||officeBranches[0].id;el('staffFormMessage').textContent='';dialog.showModal();}
async function toggleStaff(id){const x=officeStaff.find(x=>x.id===id);if(!x||!confirm((x.is_active?'Deactivate ':'Activate ')+x.staff_name+'?'))return;const {error}=await db.rpc('kitch_office_manage_staff',{p_action:x.is_active?'deactivate':'activate',p_restaurant_id:officeRid,p_staff_id:id});if(error){alert(error.message);return;}await refreshStaff();}
async function refreshStaff(){const {data,error}=await db.from('staff_access').select('id,staff_name,role,section,branch_id,is_active').eq('restaurant_id',officeRid);if(error){alert('Unable to refresh staff: '+error.message);return;}officeStaff=data||[];renderStaff();setKpi('Active Staff',String(officeStaff.filter(x=>x.is_active).length));}
el('officeAddStaff').onclick=()=>openStaff(null);
el('officeStaffCancel').onclick=()=>el('officeStaffDialog').close();
el('officeStaffX').onclick=()=>el('officeStaffDialog').close();
el('staffRole').addEventListener('change',()=>{
 const role=el('staffRole').value;
 const section=el('staffSection');
 if(role==='production_staff'&&!section.value.trim())section.value='Kitchen / Production';
 if(role==='receiving_staff'&&!section.value.trim())section.value='Receiving';
 if(role==='store_manager'&&!section.value.trim())section.value='Central Store';
});
el('officeStaffForm').onsubmit=async e=>{e.preventDefault();const id=el('staffRecordId').value,pin=el('staffPin').value.trim();const btn=el('officeStaffSave');btn.disabled=true;el('staffFormMessage').textContent='Saving…';const {error}=await db.rpc('kitch_office_manage_staff',{p_action:id?'update':'create',p_restaurant_id:officeRid,p_staff_id:id||null,p_staff_name:el('staffFullName').value.trim(),p_pin:pin||null,p_role:el('staffRole').value,p_branch_id:el('staffBranch').value,p_section:el('staffSection').value.trim()||null});btn.disabled=false;if(error){el('staffFormMessage').textContent=error.message;return;}el('officeStaffDialog').close();await refreshStaff();};

async function start(){
  const boot=document.getElementById('officeBoot');
  try{
    window.__kitchOfficeStartupPhase='loading authentication';
    await window.kitchOfficeLoadAuthLibrary();
    if(!window.supabase?.createClient)throw new Error('Authentication library unavailable. Please retry.');
    try{
      const parentClient=window.parent!==window?window.parent.__kitchSharedSupabaseClient:null;
      db=parentClient?.auth?.getSession?parentClient:null;
    }catch(e){db=null;}
    if(!db)db=window.supabase.createClient(URL,KEY);
    db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){setVisible(false);officeRid=null;officePlanStatus=null;officeHeaderPlanBadge(null);officeFlowData=null;officeIngredients=[];document.querySelectorAll('dialog[open]').forEach(x=>x.close());}});
    window.__kitchOfficeStartupPhase='checking saved session';
    const {data:{session},error}=await Promise.race([
      db.auth.getSession(),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('Cloud session is slow. Please retry the connection.')),15000))
    ]);
    if(error)throw error;
    if(session)await loadOwner(session.user);
  }catch(e){setVisible(false);say(e.message||'Unable to open Main Office. Please retry.');}
  finally{if(boot)boot.remove();}
}
el('officeLoginForm').addEventListener('submit',async e=>{e.preventDefault();say('Signing in…');if(!db){say('Authentication is not ready.');return;}const {data,error}=await db.auth.signInWithPassword({email:el('officeEmail').value.trim(),password:el('officePassword').value});if(error){say(error.message);return;}say('');await loadOwner(data?.user);});

// Owner-only Ingredient Master. Server RPC checks the signed-in owner's restaurant.
let officeIngredients=[];
const ig=id=>document.getElementById(id);
const escIg=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function refreshIngredients(){
 if(!db||!officeRid){ig('officeIngredientCount').textContent='Sign in required';return;}
 ig('officeIngredientCount').textContent='Refreshing…';
 ig('officeIngredientStatus').textContent='Loading ingredients…';
 const {data,error}=await db.from('ingredients').select('id,name,base_unit,category,supplier_name,receiving_type,last_unit_cost,reference_cost,par_target,minimum_stock,is_active').eq('restaurant_id',officeRid).eq('is_active',true).eq('is_current_master',true).order('name');
 if(error){ig('officeIngredientCount').textContent='Load failed';ig('officeIngredientStatus').textContent='Unable to load: '+error.message;throw error;}
 officeIngredients=data||[];ig('officeIngredientStatus').textContent='';renderIngredients();
}
function officePrice(x){return Number(x.reference_cost)>0?Number(x.reference_cost):Number(x.last_unit_cost||0)}
function renderIngredients(){const term=ig('officeIngredientSearch').value.toLowerCase();const rows=officeIngredients.filter(x=>[x.name,x.supplier_name,x.category].join(' ').toLowerCase().includes(term));ig('officeIngredientCount').textContent=rows.length+' of '+officeIngredients.length+' ingredients';ig('officeIngredientRows').innerHTML=rows.map(x=>'<tr><td>'+escIg(x.name)+'</td><td>'+escIg(x.base_unit)+'</td><td>'+escIg(x.supplier_name||'—')+'</td><td>'+escIg(x.category||'—')+'</td><td>AED '+officePrice(x).toFixed(2)+' / '+escIg(x.base_unit)+'</td><td>'+Number(x.minimum_stock||0)+'</td><td>'+(x.is_active?'Active':'Archived')+'</td><td><button class="btn" data-ingredient-edit="'+x.id+'">Edit</button></td></tr>').join('')||'<tr><td colspan="8">No ingredients found</td></tr>';}
function editIngredient(x){ig('officeIngredientForm').reset();ig('officeIngredientId').value=x?.id||'';ig('officeIngredientTitle').textContent=x?'Edit Ingredient':'Add Ingredient';for(const [id,key] of [['Name','name'],['Unit','base_unit'],['Category','category'],['Supplier','supplier_name'],['Receiving','receiving_type'],['Cost','reference_cost'],['Par','par_target'],['Min','minimum_stock']])ig('officeIngredient'+id).value=x?.[key]??(id==='Unit'?'kg':id==='Cost'||id==='Par'||id==='Min'?0:'');ig('officeIngredientCost').value=officePrice(x||{});ig('officeIngredientActive').checked=x?.is_active??true;ig('officeIngredientFormStatus').textContent='';ig('officeIngredientDialog').showModal();}
async function officeSyncSuppliersFromIngredients(){
 if(!officeRid)return null;
 const {data,error}=await db.rpc('kitch_office_sync_suppliers_from_ingredients',{p_restaurant_id:officeRid});
 if(error)throw new Error('Supplier sync failed: '+error.message);
 return data;
}
async function saveIngredient(x){const {data,error}=await db.rpc('kitch_office_upsert_ingredient',{p_restaurant_id:officeRid,p_id:x.id||null,p_name:x.name,p_base_unit:x.unit,p_category:x.category||null,p_supplier_name:x.supplier||null,p_receiving_type:x.receiving||null,p_reference_cost:x.cost,p_par_target:x.par,p_minimum_stock:x.min,p_is_active:x.active});if(error)throw error;const check=await db.from('ingredients').select('id,reference_cost').eq('restaurant_id',officeRid).eq('name',x.name).single();if(check.error)throw check.error;if(Math.abs(Number(check.data.reference_cost)-x.cost)>0.000001)throw Error('Saved price did not match. Please retry or check the database function.');return data;}
ig('officeIngredientAdd').onclick=()=>editIngredient(null);
ig('officeIngredientCancel').onclick=()=>ig('officeIngredientDialog').close();
ig('officeIngredientSearch').oninput=renderIngredients;
ig('officeIngredientRows').onclick=e=>{const b=e.target.closest('[data-ingredient-edit]');if(b)editIngredient(officeIngredients.find(x=>x.id===b.dataset.ingredientEdit));};
ig('officeIngredientForm').onsubmit=async e=>{e.preventDefault();const b=ig('officeIngredientSave');b.disabled=true;ig('officeIngredientFormStatus').textContent='Saving…';try{await saveIngredient({id:ig('officeIngredientId').value,name:ig('officeIngredientName').value.trim(),unit:ig('officeIngredientUnit').value,category:ig('officeIngredientCategory').value,supplier:ig('officeIngredientSupplier').value,receiving:ig('officeIngredientReceiving').value,cost:Number(ig('officeIngredientCost').value),par:Number(ig('officeIngredientPar').value),min:Number(ig('officeIngredientMin').value),active:ig('officeIngredientActive').checked});await officeSyncSuppliersFromIngredients();ig('officeIngredientDialog').close();await refreshIngredients();}catch(err){ig('officeIngredientFormStatus').textContent='Save failed: '+err.message;}finally{b.disabled=false;}};
function csvCell(x){return '"'+String(x??'').replace(/"/g,'""')+'"';}
ig('officeIngredientExport').onclick=()=>{const keys=['name','base_unit','category','supplier_name','receiving_type','reference_cost','par_target','minimum_stock','is_active'];const csv=[keys.join(','),...officeIngredients.map(x=>keys.map(k=>csvCell(x[k])).join(','))].join('\r\n');const a=document.createElement('a');a.href=window.URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='KITCH_Ingredient_Master.csv';a.click();setTimeout(()=>window.URL.revokeObjectURL(a.href),1000);};
function parseCSV(s){let out=[],row=[],cell='',quoted=false;for(let i=0;i<s.length;i++){let c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))out.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(x=>x.trim()))out.push(row);return out;}
function importNumber(v,label){const n=Number(String(v).replace(/AED|,/gi,'').trim());if(!Number.isFinite(n)||n<0)throw Error('Invalid '+label+': '+v);return n;}
function normalizeImportRows(rows){
 const aliases={name:['name','ingredient','ingredient name'],base_unit:['base_unit','base unit','unit'],reference_cost:['reference_cost','reference cost aed','unit cost aed','last unit cost aed','latest price aed','price','price aed','supplier price aed'],supplier_name:['supplier_name','supplier','supplier name','default supplier'],category:['category'],receiving_type:['receiving_type','receiving type','storage type'],par_target:['par_target','par target stock','par level','par'],minimum_stock:['minimum_stock','minimum stock','min stock'],is_active:['is_active']};
 const seen=new Set();return rows.map(row=>{const r=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/^\uFEFF/,'').trim().toLowerCase(),String(v??'').trim()]));const get=k=>{for(const a of aliases[k])if(r[a]!==undefined&&r[a]!=='')return r[a];return undefined};const name=get('name');if(!name)throw Error('Missing ingredient name');const key=name.toLowerCase();if(seen.has(key))throw Error('Duplicate ingredient: '+name);seen.add(key);const old=officeIngredients.find(x=>x.name.toLowerCase()===key);let unit=(get('base_unit')||old?.base_unit||'').toLowerCase();unit=({l:'ltr',liter:'ltr',litre:'ltr',piece:'pcs',pc:'pcs',kilogram:'kg',gram:'g'})[unit]||unit;if(!['kg','g','ltr','ml','pcs','box'].includes(unit))throw Error('Invalid unit for '+name);if(old&&old.base_unit!==unit)throw Error('Unit change requires manual review: '+name);const cost=get('reference_cost');if(cost===undefined&&!old)throw Error('Missing price for '+name);return {id:old?.id||null,name,unit,category:get('category')??old?.category??'',supplier:get('supplier_name')??old?.supplier_name??'',receiving:get('receiving_type')??old?.receiving_type??'Room Temperature',cost:cost===undefined?officePrice(old):importNumber(cost,'price'),par:importNumber(get('par_target')??old?.par_target??0,'PAR'),min:importNumber(get('minimum_stock')??old?.minimum_stock??0,'minimum'),active:get('is_active')===undefined?(old?.is_active??true):get('is_active').toLowerCase()!=='false'};});
}
ig('officeIngredientImport').onchange=async e=>{const file=e.target.files[0];if(!file)return;let done=0;try{await refreshIngredients();let rows;if(/\.xlsx?$/i.test(file.name)){const reader=window.parent.XLSX;if(!reader)throw Error('Excel reader unavailable. Check connection and retry.');const wb=reader.read(await file.arrayBuffer(),{type:'array'});rows=reader.utils.sheet_to_json(wb.Sheets[wb.SheetNames.includes('Ingredient Master')?'Ingredient Master':wb.SheetNames[0]],{defval:''});}else{const csv=parseCSV(await file.text());if(!csv.length)throw Error('Empty file');const headers=csv.shift();rows=csv.map(r=>Object.fromEntries(headers.map((k,i)=>[k,r[i]??''])));}const items=normalizeImportRows(rows);if(!items.length||items.length>500)throw Error('Import must contain 1–500 ingredients');if(!confirm('Import '+items.length+' ingredients? Prices are AED per listed base unit. Missing fields on existing ingredients will be preserved. Stock quantities will not change.'))return;for(const x of items){await saveIngredient(x);done++;ig('officeIngredientStatus').textContent='Imported '+done+' of '+items.length;}await officeSyncSuppliersFromIngredients();await refreshIngredients();alert('Imported and verified '+done+' ingredients; suppliers synchronized.');}catch(err){ig('officeIngredientStatus').textContent='Import stopped after '+done+' verified rows: '+err.message;}finally{e.target.value='';}};
const oldShowPage=showPage;showPage=function(page){oldShowPage(page);if(page==='ingredients'&&officeRid)refreshIngredients().catch(err=>{ig('officeIngredientCount').textContent='Load failed';ig('officeIngredientStatus').textContent=err.message;});};

const officePurchaseState={requests:[],orders:[],suppliers:[],dispatches:[],requestSuppliers:[],ingredientPrices:new Map()};
let officeLastOrderChannel='email';
let officeDraftAwaitingConfirmation=null;
let officeSupplierProfileEditing=null;
let officePurchaseBusy=false;
const officePurchaseEl=id=>document.getElementById(id);
const officePurchaseStatus=message=>{const n=officePurchaseEl('officePurchaseMessage');if(n)n.textContent=message||''};
async function officePurchaseRpc(action,values={}){
 if(!officeRid||!db)throw Error('Sign in to Main Office first');
 const {data,error}=await db.rpc('kitch_purchase_workflow',{p_action:action,p_restaurant_id:officeRid,...values});
 if(error)throw Error(error.message);
 return data;
}
async function officePurchaseLoad(){
 if(!officeRid)return;
 officePurchaseStatus('');
 try{
  const d=await officePurchaseRpc('list');
  if(d?.role!=='owner')throw Error('Main Office owner access required');
  const requests=Array.isArray(d.requests)?d.requests:[];
  const orders=Array.isArray(d.orders)?d.orders:[];
  const {data:profileRows,error:profileError}=await db.rpc('kitch_office_supplier_profile',{p_action:'list',p_restaurant_id:officeRid});
  if(profileError)throw Error('Supplier Master unavailable: '+profileError.message);
  const suppliers=Array.isArray(profileRows)?profileRows.filter(x=>x.is_approved&&x.is_active):[];
  const {data:channelRows,error:channelError}=await db.rpc('kitch_supplier_channels',{p_action:'list',p_restaurant_id:officeRid});
  if(channelError)throw Error('Supplier channels unavailable: '+channelError.message);
  const contacts=new Map((Array.isArray(channelRows)?channelRows:[]).map(x=>[String(x.id),x]));
  for(const supplier of suppliers)Object.assign(supplier,contacts.get(String(supplier.id))||{});
  const {data:supplierItems,error:supplierItemsError}=await db.from('ingredients')
   .select('name,category,supplier_name,preferred_supplier_id,base_unit,reference_cost')
   .eq('restaurant_id',officeRid).eq('is_active',true).eq('is_current_master',true);
  if(supplierItemsError)throw new Error('Supplier ingredient catalog unavailable: '+supplierItemsError.message);
  officePurchaseState.ingredientPrices=new Map((supplierItems||[]).map(x=>[String(x.name||'').trim().toLowerCase(),x]));
  const supplierCatalog=new Map();
  for(const ingredient of supplierItems||[]){
   const key=String(ingredient.preferred_supplier_id||'');
   const alt=String(ingredient.supplier_name||'').trim().toLowerCase();
   for(const supplier of suppliers){
    if((key&&key===String(supplier.id))||(!key&&alt===String(supplier.name||'').trim().toLowerCase())){
     if(!supplierCatalog.has(supplier.id))supplierCatalog.set(supplier.id,[]);
     supplierCatalog.get(supplier.id).push(ingredient);
     break;
    }
   }
  }

  officePurchaseState.requests=requests;officePurchaseState.orders=orders;officePurchaseState.suppliers=suppliers;
  const {data:supplierLinks,error:supplierLinksError}=await db.rpc('kitch_purchase_supplier_view',{p_restaurant_id:officeRid});
  if(supplierLinksError)throw Error('Could not load chef-selected suppliers: '+supplierLinksError.message);
  officePurchaseState.requestSuppliers=Array.isArray(supplierLinks?.request_suppliers)?supplierLinks.request_suppliers:[];
  const {data:sentRows,error:sentError}=await db.from('kitch_supplier_order_dispatches').select('request_id,supplier_id,recipient_email,recipient_phone,channel,cc_emails,sent_at').eq('restaurant_id',officeRid);
  if(sentError)throw Error('Supplier dispatch history unavailable: '+sentError.message);
  officePurchaseState.dispatches=sentRows||[];
  const requestGroups=new Map();
  for(const item of requests){
   if(!requestGroups.has(item.id))requestGroups.set(item.id,{...item,lines:[]});
   requestGroups.get(item.id).lines.push(item);
  }
  officePurchaseState.requestGroups=[...requestGroups.values()];
  for(const req of officePurchaseState.requestGroups){
    const link=officePurchaseState.requestSuppliers.find(x=>String(x.request_id)===String(req.id));
    req.chef_supplier_id=link?.supplier_id||null;
    req.chef_supplier_name=link?.supplier_name||null;
  }
  officePurchaseEl('officeSupplierCount').textContent=suppliers.length+' approved';
  officePurchaseEl('officeRequestCount').textContent=requestGroups.size+' requests';
  const groups=new Map();
  for(const o of orders){
   if(!groups.has(o.id))groups.set(o.id,{...o,total:0});
   groups.get(o.id).total+=Number(o.total)||0;
  }
  officePurchaseEl('officePOCount').textContent=groups.size+' orders';
  officePurchaseEl('officeSuppliers').innerHTML=suppliers.map(x=>{
   const items=supplierCatalog.get(x.id)||[];
   const categories=[...new Set(items.map(i=>String(i.category||'Uncategorized')))];
   return '<div class="officeSupplierCard"><div style="flex:1;min-width:220px"><div class="officeSupplierCardName">'+safe(x.name)+'</div>'+
     '<div class="officeSupplierCardInfo">'+safe(items.length+' assigned ingredients')+(categories.length?' · '+safe(categories.join(', ')):'')+'</div>'+
     '<div class="officeSupplierCardInfo">'+safe(x.contact_name||'Contact not provided')+' · '+safe(x.email||'Email not provided')+'</div>'+
     '<div class="officeSupplierCardInfo">'+safe(x.phone||'Phone not provided')+'</div>'+
     (items.length?'<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;font-weight:650">View supplied ingredients</summary><div style="margin-top:8px;font-size:12px;color:#555;line-height:1.7">'+items.map(i=>safe(i.name)).join(' · ')+'</div></details>':'')+
     '</div><button type="button" class="btn officeSupplierEdit" data-supplier-id="'+safe(x.id)+'">Edit details</button></div>';
  }).join('')||'<div class="officeSupplierEmpty">No suppliers yet. Suppliers are created from Ingredient Master, or use <b>+ Add Supplier</b>.</div>';
  officePurchaseEl('officePurchaseRequests').innerHTML=[...requestGroups.values()].map(r=>{
   const status=String(r.status||'');
   const exists=orders.some(o=>o.request_id===r.id&&o.status!=='cancelled');
   const dispatch=officePurchaseState.dispatches.find(d=>String(d.request_id)===String(r.id));
   const draft=officeDraftAwaitingConfirmation?.restaurant_id===officeRid&&String(officeDraftAwaitingConfirmation.request_id)===String(r.id)?officeDraftAwaitingConfirmation:null;
   const actions=status==='pending_approval'
    ?'<div class="officeRequestActions"><button type="button" class="officeRequestAction primary" data-po-action="approve" data-id="'+safe(r.id)+'">Approve</button><button type="button" class="officeRequestAction muted" data-po-action="reject" data-id="'+safe(r.id)+'">Reject</button></div>'
    :status==='approved'&&!dispatch&&draft
    ?'<div class="officeRequestActions"><button type="button" class="officeRequestAction primary" data-po-action="confirm_sent" data-id="'+safe(r.id)+'">I Sent This Order</button><button type="button" class="officeRequestAction muted" data-po-action="create_order" data-id="'+safe(r.id)+'">Edit / Resend</button></div>'
    :status==='approved'&&!dispatch
    ?'<div class="officeRequestActions"><button type="button" class="officeRequestAction primary" data-po-action="create_order" data-id="'+safe(r.id)+'">Send Order</button></div>'
    :dispatch
    ?'<div class="officeRequestActions"><button type="button" class="officeRequestAction muted" data-po-action="create_order" data-id="'+safe(r.id)+'">View Order</button></div>'
    :'<div class="officeRequestActions"><button type="button" class="officeRequestAction muted" data-po-action="view" data-id="'+safe(r.id)+'">View Order</button></div>';
   const statusLabel=dispatch?'<span class="officeRequestStatus sent">Sent</span>':status==='approved'?'<span class="officeRequestStatus approved">Approved</span>':status==='pending_approval'?'<span class="officeRequestStatus pending">Pending</span>':'<span class="officeRequestStatus">'+safe(status.replaceAll('_',' '))+'</span>';
   return '<tr><td><button type="button" class="officeRequestLink" data-po-action="view" data-id="'+safe(r.id)+'">'+safe(r.request_no)+'</button></td><td><b>'+safe(r.chef_supplier_name||'Not selected')+'</b></td><td>'+r.lines.map(l=>safe(l.ingredient)).join(', ')+'</td><td>'+r.lines.map(l=>safe(l.quantity)+' '+safe(l.unit)).join(' · ')+'</td><td>'+statusLabel+'</td><td>'+actions+'</td></tr>';
  }).join('')||'<tr><td colspan="6">No cloud purchase requests yet.</td></tr>';
  officePurchaseEl('officePurchaseOrders').innerHTML=[...groups.values()].map(o=>
   '<tr><td>'+safe(o.po_no)+'</td><td>'+safe(o.supplier)+'</td><td>'+safe(o.status)+'</td><td>'+money(o.total)+'</td></tr>'
  ).join('')||'<tr><td colspan="4">No cloud purchase orders yet.</td></tr>';
 }catch(e){officePurchaseStatus('Could not load Purchasing: '+e.message)}
}
let officeSelectedPurchaseRequest=null;
function officePOShow(id){
 const req=(officePurchaseState.requestGroups||[]).find(x=>String(x.id)===String(id));
 if(!req||req.status!=='approved')return officePurchaseStatus('Only approved kitchen requests can be sent. Refresh first.');
 officeSelectedPurchaseRequest=req.id;
 const panel=officePurchaseEl('officePOComposer');
 const estimate=officeOrderEstimate(req);
 officePurchaseEl('officePOEstimatedTotal').textContent=money(estimate.total)+(estimate.unknown.length?' · partial estimate':'')+' (reference prices)';
 const destination=officeOrderDestination(req);
 const deliveryPreview=officePurchaseEl('officePODeliveryPreview');
 if(deliveryPreview)deliveryPreview.textContent=destination.name+' — '+(destination.address||'Address not saved; add one under Locations before ordering')+(destination.instructions?' · '+destination.instructions:'');
 officePurchaseEl('officePOComposerSummary').textContent=req.request_no+' · '+req.lines.length+' ingredient'+(req.lines.length===1?'':'s');
 const opts=officePurchaseState.suppliers.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
 officePurchaseEl('officePOSupplier').innerHTML='<option value="">Select supplier</option>'+opts;
 const defaultSupplier=req.chef_supplier_id
  ?officePurchaseState.suppliers.find(x=>String(x.id)===String(req.chef_supplier_id))
  :officePurchaseState.suppliers.find(x=>req.lines.some(l=>String(l.supplier||'').toLowerCase()===String(x.name||'').toLowerCase()));
 if(defaultSupplier)officePurchaseEl('officePOSupplier').value=defaultSupplier.id;
 officePurchaseEl('officePOSupplier').disabled=!!req.chef_supplier_id;
 officePurchaseEl('officePOComposerSummary').textContent=req.request_no+' · '+req.lines.length+' ingredients · '+(req.chef_supplier_name||'Legacy request: choose supplier');
 officePurchaseEl('officePOSupplierEmail').value='';
 officeLastOrderChannel='email';
 officePurchaseEl('officePOLines').innerHTML=req.lines.map((l,i)=>{
  const item=officePurchaseState.ingredientPrices.get(String(l.ingredient||'').trim().toLowerCase());
  const reference=item?' · Reference AED '+Number(item.reference_cost||0).toFixed(2)+' / '+safe(item.base_unit):' · Price not recorded';
  return '<div class="kitchPOLine" style="display:flex;justify-content:space-between;align-items:center;gap:15px"><div><strong>'+(i+1)+'. '+safe(l.ingredient)+'</strong><small>Requested by kitchen'+reference+'</small></div><b style="font-size:14px;white-space:nowrap">'+safe(l.quantity)+' '+safe(l.unit)+'</b></div>';
 }).join('');
 officePurchaseEl('officePORequestNo').textContent=req.request_no||req.id;
 officePurchaseEl('officePOItem').textContent=req.lines.map(x=>x.ingredient).join(', ');
 officePurchaseEl('officePOQuantity').textContent=req.lines.map(x=>x.quantity+' '+x.unit).join(' · ');
 const dispatch=officePurchaseState.dispatches.find(d=>String(d.request_id)===String(req.id));
 officePurchaseEl('officePOConfirm').hidden=!!dispatch;
 officePurchaseEl('officePOConfirmSent').hidden=!!dispatch;
 officePurchaseEl('officePOConfirmSent').disabled=false;
 if(dispatch){officePurchaseEl('officePOSupplier').value=dispatch.supplier_id;officePurchaseEl('officePOSupplierEmail').value=dispatch.recipient_email||'';officeLastOrderChannel=dispatch.channel||'email';}
 officePurchaseEl('officePOInlineMessage').textContent=dispatch?'Sent via '+(dispatch.channel||'email')+' on '+new Date(dispatch.sent_at).toLocaleString()+' · '+(dispatch.recipient_email||dispatch.recipient_phone||''):'';
 panel.hidden=false;
 officePOUpdateSupplier();
 if(dispatch)officePurchaseEl('officePOSupplierEmail').value=dispatch.recipient_email||'';
 panel.scrollIntoView({block:'nearest',behavior:'smooth'});
 officePurchaseStatus('');
}
async function officePurchaseDo(action,id){
 if(officePurchaseBusy)return;
 const req=officePurchaseState.requests.find(r=>r.id===id);
 if(!req)return officePurchaseStatus('Refresh requests and try again.');
 if(action==='create_order')return officePOShow(id);
 if(!['approve','reject'].includes(action)||req.status!=='pending_approval')return officePurchaseStatus('This request is not pending approval.');
 officePurchaseBusy=true;
 officePurchaseStatus('Saving '+action+'…');
 try{
  await officePurchaseRpc(action,{p_request_id:id});
  await officePurchaseLoad();
  officePurchaseStatus('Request '+req.request_no+' '+(action==='approve'?'approved':'rejected')+'.');
 }catch(e){officePurchaseStatus('No changes made: '+e.message)}
 finally{officePurchaseBusy=false}
}
officePurchaseEl('officePurchaseRefresh').addEventListener('click',officePurchaseLoad);
/* Read-only Main Office purchase request viewer. */
function officeShowRequestDetails(id){
 const r=(officePurchaseState.requestGroups||[]).find(x=>String(x.id)===String(id));
 if(!r)return officePurchaseStatus('Request not found. Refresh the list.');
 const lines=r.lines||[];
 const details=document.createElement('div');
 details.id='officeRequestDetailOverlay';
 details.setAttribute('role','presentation');
 details.innerHTML='<div class="officeRequestDetailCard" role="dialog" aria-modal="true" aria-label="Purchase request details" tabindex="-1">'+
  '<div class="officeRequestDetailHeader"><div><small>PURCHASING · MAIN OFFICE · VIEW ONLY</small><h2>Purchase Request Details</h2><p>'+safe(r.request_no||r.id)+'</p></div><button type="button" class="officeRequestDetailClose" aria-label="Close request details">×</button></div>'+
  '<div class="officeRequestDetailBody"><div class="officeRequestDetailMeta"><div><span>STATUS</span><strong>'+safe(String(r.status||'Unknown').replaceAll('_',' '))+'</strong></div><div><span>INGREDIENTS</span><strong>'+lines.length+'</strong></div><div><span>SUPPLIER</span><strong>'+safe(r.chef_supplier_name||'Legacy request: not assigned')+'</strong></div></div>'+
  '<h3>Full ingredient list</h3><div class="officeRequestDetailTable"><table><thead><tr><th>#</th><th>Ingredient</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>'+
  lines.map((line,i)=>'<tr><td>'+(i+1)+'</td><td><b>'+safe(line.ingredient||line.name||'—')+'</b></td><td>'+safe(line.quantity??'—')+'</td><td>'+safe(line.unit||'—')+'</td></tr>').join('')+
  '</tbody></table></div><div class="officeRequestDetailNotes"><span>NOTES</span><p>'+safe(r.notes||r.note||r.request_notes||'No notes provided')+'</p></div><p class="officeRequestDetailHint">This request is read-only. Main Office can approve or reject pending requests from the request list. Inventory changes only after Receiving.</p></div>'+
  '<div class="officeRequestDetailFooter"><button type="button" class="btn officeRequestDetailDone">Close</button></div></div>';
 const close=()=>{document.removeEventListener('keydown',escape);details.remove()};
 const escape=e=>{if(e.key==='Escape')close()};
 document.getElementById('officeRequestDetailOverlay')?.remove();
 details.addEventListener('click',e=>{if(e.target===details||e.target.closest('.officeRequestDetailClose,.officeRequestDetailDone'))close()});
 document.addEventListener('keydown',escape);
 document.body.appendChild(details);
 details.querySelector('.officeRequestDetailCard')?.focus();
}
const officeRequestDetailCSS=document.createElement('style');
officeRequestDetailCSS.id='office-request-detail-styles';
officeRequestDetailCSS.textContent=`
.officeRequestLink{border:0;background:transparent;padding:4px 0;color:#151515;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
#officeRequestDetailOverlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box}
.officeRequestDetailCard{background:white;border-radius:24px;max-width:840px;width:100%;max-height:calc(100vh - 36px);overflow:auto;box-shadow:0 24px 75px #0004;color:#181818}
.officeRequestDetailHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:27px 30px 20px;border-bottom:1px solid #eee}
.officeRequestDetailHeader small{color:#888;font-size:10px;font-weight:800;letter-spacing:.12em}
.officeRequestDetailHeader h2{font-size:24px;letter-spacing:-.035em;margin:7px 0}
.officeRequestDetailHeader p{font-size:12px;color:#777;margin:0}
.officeRequestDetailClose{width:38px;height:38px;border:0;border-radius:50%;background:#f1f1f1;color:#222;font-size:22px;cursor:pointer}
.officeRequestDetailBody{padding:22px 30px}.officeRequestDetailMeta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.officeRequestDetailMeta>div{background:#f6f6f6;padding:17px;border-radius:14px;min-width:0;overflow-wrap:anywhere}
.officeRequestDetailMeta span,.officeRequestDetailNotes span{display:block;font-size:10px;font-weight:800;color:#888;letter-spacing:.08em;margin-bottom:9px}
.officeRequestDetailMeta strong{display:block;font-size:14px;text-transform:capitalize}
.officeRequestDetailBody h3{font-size:16px;margin:25px 0 12px}
.officeRequestDetailTable{overflow-x:auto;border:1px solid #eee;border-radius:14px}
.officeRequestDetailTable table{border-collapse:collapse;width:100%;min-width:450px}
.officeRequestDetailTable th{background:#f8f8f8;text-align:left;font-size:11px;color:#777;padding:14px}
.officeRequestDetailTable td{padding:16px 14px;font-size:13px;border-top:1px solid #eee}
.officeRequestDetailNotes{padding:17px;margin-top:17px;background:#f6f6f6;border-radius:14px}
.officeRequestDetailNotes p{margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.officeRequestDetailHint{font-size:12px;color:#777;line-height:1.6;margin:18px 0 0}
.officeRequestDetailFooter{padding:18px 30px 24px;border-top:1px solid #eee;display:flex;justify-content:flex-end}
.officeRequestDetailFooter button{border-radius:99px!important;background:#181818!important;color:#fff!important;padding:11px 25px!important}
@media(max-width:600px){.officeRequestDetailHeader,.officeRequestDetailBody,.officeRequestDetailFooter{padding-left:16px;padding-right:16px}.officeRequestDetailMeta{grid-template-columns:1fr 1fr}.officeRequestDetailCard{border-radius:17px}}
`;
document.head.appendChild(officeRequestDetailCSS);
officePurchaseEl('officePurchaseRequests').addEventListener('click',e=>{
 const button=e.target.closest('[data-po-action]');
 if(!button)return;
 if(button.dataset.poAction==='view')return officeShowRequestDetails(button.dataset.id);
 if(button.dataset.poAction==='confirm_sent'){
  if(officeDraftAwaitingConfirmation?.restaurant_id!==officeRid||String(officeDraftAwaitingConfirmation.request_id)!==String(button.dataset.id)){
   return officePurchaseStatus('Open Send Order and prepare the email again before confirming.');
  }
  officePurchaseEl('officePOConfirmSent').click();return;
 }
 officePurchaseDo(button.dataset.poAction,button.dataset.id);
});
function officePOUpdateSupplier(){
 const id=officePurchaseEl('officePOSupplier').value;
 const supplier=officePurchaseState.suppliers.find(x=>String(x.id)===String(id));
 officePurchaseEl('officePOSupplierText').textContent=supplier?.name||'Select supplier';
 officePurchaseEl('officePOSupplierEmail').value=supplier?.email||'';
 officePurchaseEl('officePOAdditionalTo').value=supplier?.additional_to_emails||'';
 officePurchaseEl('officePOCC').value=supplier?.cc_emails||'';
 officePurchaseEl('officePOExtraRecipients').open=!!(supplier?.additional_to_emails||supplier?.cc_emails);
 officePurchaseEl('officePOWhatsapp').value=supplier?.whatsapp_phone||supplier?.phone||'';
 const preview=officePurchaseEl('officePOSupplierContact');
 if(preview)preview.innerHTML=supplier?'<div><span>CONTACT PERSON</span><strong>'+safe(supplier.contact_name||'Not provided')+'</strong></div><div><span>PHONE</span><strong>'+safe(supplier.phone||'Not provided')+'</strong></div><div><span>SUPPLIER ADDRESS</span><strong>'+safe(supplier.address||'Not provided')+'</strong></div>':'Choose a supplier to view saved contact details.';
}
function officeValidEmailList(value){
 const values=String(value||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
 if(values.some(x=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(x)))throw Error('Enter valid email addresses separated by commas.');
 return [...new Set(values.map(x=>x.toLowerCase()))];
}
function officeOrderEstimate(req){
 let total=0,unknown=[];
 for(const line of req.lines){
  const item=officePurchaseState.ingredientPrices.get(String(line.ingredient||'').trim().toLowerCase());
  const units=String(line.unit||'').toLowerCase(),base=String(item?.base_unit||'').toLowerCase();
  const qty=Number(line.quantity);
  if(!item||!Number.isFinite(qty)||qty<0){unknown.push(line.ingredient);continue;}
  let scale=1;
  if(units!==base){
   if(units==='g'&&base==='kg'||units==='ml'&&base==='ltr')scale=.001;
   else if(units==='kg'&&base==='g'||units==='ltr'&&base==='ml')scale=1000;
   else {unknown.push(line.ingredient);continue;}
  }
  total+=qty*scale*Number(item.reference_cost||0);
 }
 return {total,unknown};
}
function officeOrderDestination(req){
 const loc=officeBranches.find(x=>String(x.id)===String(req.branch_id));
 return {name:loc?.name||'Location not found',address:loc?.delivery_address||'',instructions:loc?.delivery_instructions||''};
}
function officeKitchenOrderText(req,supplierName){
 const restaurant=String(officeRestaurantName||'Restaurant').trim();
 const orderNumber=req.request_no||req.id;
 const destination=officeOrderDestination(req);
 const items=req.lines.map((l,i)=>(i+1)+'. '+l.ingredient+' — '+l.quantity+' '+l.unit).join('\n');
 const notes=String(req.notes||req.note||req.request_notes||'').trim();
 return 'Dear '+supplierName+' Team,\n\n'+
  'I hope this email finds you well.\n\n'+
  'Please find below the purchase order from '+restaurant+'. Kindly review the requested items and confirm their availability and the expected delivery schedule.\n\n'+
  'PURCHASE ORDER DETAILS\n'+
  'Restaurant: '+restaurant+'\n'+
  'Order reference: '+orderNumber+'\n'+
  'Supplier: '+supplierName+'\n\n'+
  'ITEMS & QUANTITIES\n'+items+'\n\n'+
  'DELIVERY INFORMATION\n'+
  'Delivery location: '+destination.name+'\n'+
  'Delivery address: '+(destination.address||'Address pending confirmation')+'\n'+
  (destination.instructions?'Delivery instructions: '+destination.instructions+'\n':'')+
  (notes?'\nAdditional notes: '+notes+'\n':'')+
  '\nPlease confirm receipt of this order, item availability and the expected delivery time.\n\n'+
  'Thank you for your cooperation.\n\n'+
  'Best regards,\n'+restaurant+'\nPurchasing Department';
}
function officeCurrentKitchenOrder(){
 const req=(officePurchaseState.requestGroups||[]).find(x=>String(x.id)===String(officeSelectedPurchaseRequest));
 if(!req||req.status!=='approved'){officePurchaseEl('officePOInlineMessage').textContent='Request not approved or missing. Refresh and try again.';return null}
 const supplier=officePurchaseState.suppliers.find(x=>String(x.id)===String(officePurchaseEl('officePOSupplier').value));
 if(!supplier){officePurchaseEl('officePOInlineMessage').textContent='Select the supplier first.';return null}
 if(req.chef_supplier_id&&String(supplier.id)!==String(req.chef_supplier_id)){officePurchaseEl('officePOInlineMessage').textContent='This request must go to the supplier selected by the chef.';return null}
 return {req,supplier};
}
officePurchaseEl('officePOSupplier').addEventListener('change',officePOUpdateSupplier);
officePurchaseEl('officePOClose').addEventListener('click',()=>officePurchaseEl('officePOCancel').click());
officePurchaseEl('officePOCancel').addEventListener('click',()=>{
 officeSelectedPurchaseRequest=null;officePurchaseEl('officePOComposer').hidden=true;
});
officePurchaseEl('officePOConfirm').addEventListener('click',()=>{
 const data=officeCurrentKitchenOrder();if(!data)return;
 const message=officePurchaseEl('officePOInlineMessage');
 let to,cc;
 try{
  to=officeValidEmailList([officePurchaseEl('officePOSupplierEmail').value,officePurchaseEl('officePOAdditionalTo').value].filter(Boolean).join(','));
  cc=officeValidEmailList(officePurchaseEl('officePOCC').value);
  if(!to.length)throw Error('Enter at least one supplier To email.');
 }catch(e){message.textContent=e.message;return}
 const subject='Purchase Order '+(data.req.request_no||data.req.id)+' | '+(officeRestaurantName||'Restaurant');
 const body=officeKitchenOrderText(data.req,data.supplier.name);
 const mailto='mailto:'+to.map(encodeURIComponent).join(',')+'?'+(cc.length?'cc='+encodeURIComponent(cc.join(','))+'&':'')+'subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
 officeLastOrderChannel='email';
 officeDraftAwaitingConfirmation={restaurant_id:officeRid,request_id:data.req.id,channel:'email',recipient_email:to.join(','),cc_emails:cc.join(',')||null};
 officePurchaseEl('officePOConfirmSent').hidden=false;
 // Close the KITCH composer when the external email draft is opened.
 officePurchaseEl('officePOComposer').hidden=true;
 officePurchaseLoad().then(()=>officePurchaseStatus('Email draft opened. After sending in Mail, click “I Sent This Order” in the request row. KITCH cannot detect delivery automatically.')).catch(e=>officePurchaseStatus(e.message));
 window.location.href=mailto;
});
officePurchaseEl('officePOWhatsappSend').addEventListener('click',()=>{
 const order=officeCurrentKitchenOrder();if(!order)return;
 const msg=officePurchaseEl('officePOInlineMessage');
 const phone=String(officePurchaseEl('officePOWhatsapp').value||'').replace(/[^0-9]/g,'');
 if(!/^[1-9][0-9]{7,14}$/.test(phone)){msg.textContent='Enter a WhatsApp number including country code, e.g. 9715...';return;}
 officeLastOrderChannel='whatsapp';
 officePurchaseEl('officePOConfirmSent').hidden=false;
 const message=officeKitchenOrderText(order.req,order.supplier.name);
 const link='https://wa.me/'+phone+'?text='+encodeURIComponent(message);
 const win=window.open(link,'_blank','noopener,noreferrer');
 if(!win){msg.textContent='Your browser blocked WhatsApp. Allow popups and try again.';return;}
 officeDraftAwaitingConfirmation={restaurant_id:officeRid,request_id:order.req.id,channel:'whatsapp',recipient_phone:phone};
 officePurchaseEl('officePOComposer').hidden=true;
 officePurchaseLoad().then(()=>officePurchaseStatus('WhatsApp draft opened. After sending, click “I Sent This Order” in the request row.')).catch(e=>officePurchaseStatus(e.message));
});
officePurchaseEl('officePOConfirmSent').addEventListener('click',async()=>{
 if(officePurchaseBusy)return;
 const order=officeCurrentKitchenOrder();if(!order)return;
 const status=officePurchaseEl('officePOInlineMessage');
 const draft=officeDraftAwaitingConfirmation?.restaurant_id===officeRid&&String(officeDraftAwaitingConfirmation.request_id)===String(order.req.id)?officeDraftAwaitingConfirmation:null;
 const channel=draft?.channel||officeLastOrderChannel;
 let email=null,phone=null,cc=null;
 try{
  if(channel==='email'){
   const to=officeValidEmailList(draft?.recipient_email||[officePurchaseEl('officePOSupplierEmail').value,officePurchaseEl('officePOAdditionalTo').value].filter(Boolean).join(','));
   if(!to.length)throw Error('Enter at least one supplier email.');
   email=to.join(',');
   cc=officeValidEmailList(draft?.cc_emails??officePurchaseEl('officePOCC').value).join(',')||null;
  }else{
   phone=String(draft?.recipient_phone||officePurchaseEl('officePOWhatsapp').value||'').replace(/[^0-9]/g,'');
   if(!/^[1-9][0-9]{7,14}$/.test(phone))throw Error('Enter a valid WhatsApp number with country code.');
  }
 }catch(e){status.textContent=e.message;return;}
 if(!confirm('Have you actually sent this order through '+(channel==='email'?'email':'WhatsApp')+'? KITCH records your confirmation, not delivery.'))return;
 const button=officePurchaseEl('officePOConfirmSent');button.disabled=true;officePurchaseBusy=true;
 try{
  const {error}=await db.from('kitch_supplier_order_dispatches').insert({
   request_id:order.req.id,restaurant_id:officeRid,supplier_id:order.supplier.id,
   channel,recipient_email:email,recipient_phone:phone,cc_emails:cc,
   confirmed_by:(await db.auth.getUser()).data.user?.id
  });
  if(error)throw Error(error.message);
  officeSelectedPurchaseRequest=null;officeDraftAwaitingConfirmation=null;officePurchaseEl('officePOComposer').hidden=true;
  await officePurchaseLoad();
  officePurchaseStatus('Order '+order.req.request_no+' recorded as sent by '+channel+' (confirmed manually).');
 }catch(e){status.textContent='Could not record sent status: '+e.message}
 finally{officePurchaseBusy=false;button.disabled=false}
});
officePurchaseEl('officePOPrint').addEventListener('click',()=>{
 const data=officeCurrentKitchenOrder();if(!data)return;
 const rows=data.req.lines.map((l,i)=>'<tr><td>'+(i+1)+'</td><td>'+safe(l.ingredient)+'</td><td>'+safe(l.quantity)+'</td><td>'+safe(l.unit)+'</td></tr>').join('');
 const notes=data.req.notes||data.req.note||data.req.request_notes||'None';
 const destination=officeOrderDestination(data.req);
 const doc='<!doctype html><html><head><meta charset="utf-8"><title>'+safe(officeRestaurantName||'Restaurant')+' Order '+safe(data.req.request_no||data.req.id)+'</title><style>body{font:14px Arial,sans-serif;color:#111;margin:40px}h1{font-size:26px}p{line-height:1.6}.meta{margin:24px 0;padding:20px;background:#f7f7f7;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ddd;padding:12px;text-align:left}th{background:#f5f5f5}footer{margin-top:36px;color:#777;font-size:12px}@media print{body{margin:20mm}}</style></head><body><h1>'+safe(officeRestaurantName||'Restaurant')+' · Purchase Order</h1><div class="meta"><p><b>Request:</b> '+safe(data.req.request_no||data.req.id)+'</p><p><b>Supplier:</b> '+safe(data.supplier.name)+'</p><p><b>Delivery location:</b> '+safe(destination.name)+'</p><p><b>Delivery address:</b> '+safe(destination.address||'Not provided')+'</p><p><b>Delivery instructions:</b> '+safe(destination.instructions||'None')+'</p><p><b>Status:</b> Approved kitchen request</p></div><h2>Items ordered</h2><table><thead><tr><th>#</th><th>Ingredient</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>'+rows+'</tbody></table><p><b>Notes:</b> '+safe(notes)+'</p><footer>Generated from the approved kitchen purchase request for '+safe(officeRestaurantName||'Restaurant')+'. Inventory updates only after Receiving.</footer></body></html>';
 const popup=window.open('','_blank');
 if(!popup){officePurchaseEl('officePOInlineMessage').textContent='Allow pop-ups in your browser to print or save this order as a PDF.';return}
 popup.document.open();popup.document.write(doc);popup.document.close();popup.focus();popup.print();
});

function officeSupplierProfileForm(id){
 const supplier=officePurchaseState.suppliers.find(x=>String(x.id)===String(id))||null;
 officeSupplierProfileEditing=supplier?.id||null;
 const overlay=document.createElement('div');
 overlay.id='officeSupplierProfileOverlay';
 overlay.innerHTML='<div class="officeSupplierProfileDialog" role="dialog" aria-modal="true" aria-label="Supplier details"><div class="officeSupplierDialogHead"><div><small>SUPPLIER MASTER · MAIN OFFICE</small><h2>'+(supplier?'Edit Supplier':'Add New Supplier')+'</h2><p>Save contact information once and use it automatically for future purchase orders.</p></div><button type="button" id="officeSupplierClose" class="officeSupplierDialogClose" aria-label="Close">×</button></div>'+
 '<form id="officeSupplierProfileForm" class="officeSupplierProfileForm"><div class="officeSupplierFormGrid">'+
 '<label>Supplier / Company Name *<input required maxlength="120" name="name" placeholder="Supplier company name"></label>'+
 '<label>Contact Person<input maxlength="120" name="contact" placeholder="Full name"></label>'+
 '<label>Primary email (To)<input type="email" maxlength="320" name="email" placeholder="orders@supplier.com"></label>'+
 '<details class="wide" id="officeSupplierExtraRecipients" style="grid-column:1/-1;border:1px solid #e5e5e5;border-radius:12px;padding:12px 14px;background:#fafafa"><summary style="font-size:12px;font-weight:750;cursor:pointer">+ Add another email / CC (optional)</summary><div style="padding-top:12px;display:grid;gap:12px"><label>Additional To emails<input maxlength="640" name="more_to" placeholder="sales@supplier.com"></label><label>CC emails<input maxlength="640" name="cc" placeholder="accounts@supplier.com"></label></div></details>'+
 '<label>Supplier WhatsApp number (with country code)<input type="tel" maxlength="30" name="whatsapp" placeholder="+971501234567"></label>'+
 '<label>Phone / WhatsApp<input type="tel" maxlength="50" name="phone" placeholder="+971 ..."></label>'+
 '<label class="wide">Business Address<textarea maxlength="600" name="address" rows="2" placeholder="Street, area, city"></textarea></label>'+
 '<label>Trade License / TRN (optional)<input maxlength="120" name="license" placeholder="Reference number"></label>'+
 '<label class="wide">Additional Information<textarea maxlength="1000" name="notes" rows="3" placeholder="Delivery schedule, ordering instructions, account details"></textarea></label></div>'+
 '<p id="officeSupplierFormError" role="status"></p><div class="officeSupplierDialogFooter"><button type="button" class="btn" id="officeSupplierCancel">Cancel</button><button class="btn black" id="officeSupplierSave" type="submit">Save Supplier</button></div></form></div>';
 document.getElementById('officeSupplierProfileOverlay')?.remove();
 document.body.appendChild(overlay);
 const form=overlay.querySelector('form');
 const fields={name:'name',contact_name:'contact',email:'email',phone:'phone',address:'address',trade_license:'license',notes:'notes',additional_to_emails:'more_to',cc_emails:'cc',whatsapp_phone:'whatsapp'};
 if(supplier)for(const [key,field] of Object.entries(fields))form.elements[field].value=supplier[key]||'';
 if(supplier&&(supplier.additional_to_emails||supplier.cc_emails))overlay.querySelector('#officeSupplierExtraRecipients').open=true;
 const close=()=>overlay.remove();
 overlay.querySelector('#officeSupplierClose').onclick=close;
 overlay.querySelector('#officeSupplierCancel').onclick=close;
 overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
 form.onsubmit=async e=>{
  e.preventDefault();
  if(!form.reportValidity())return;
  const button=overlay.querySelector('#officeSupplierSave');
  const err=overlay.querySelector('#officeSupplierFormError');
  const name=form.elements.name.value.trim(),email=form.elements.email.value.trim();
  try{officeValidEmailList(form.elements.more_to.value);officeValidEmailList(form.elements.cc.value)}catch(e){err.textContent=e.message;return;}
  if(!name){err.textContent='Supplier company name is required.';return}
  button.disabled=true;err.textContent='Saving supplier…';
  try{
   const {data,error}=await db.rpc('kitch_office_supplier_profile',{
    p_action:'save',p_restaurant_id:officeRid,p_supplier_id:officeSupplierProfileEditing,
    p_name:name,p_contact_name:form.elements.contact.value.trim(),p_email:email,
    p_phone:form.elements.phone.value.trim(),p_address:form.elements.address.value.trim(),
    p_trade_license:form.elements.license.value.trim(),p_notes:form.elements.notes.value.trim()
   });
   if(error)throw Error(error.message);
   const supplierId=data?.id||officeSupplierProfileEditing;
   if(!supplierId)throw Error('Supplier saved, but contact channels could not be linked. Refresh and retry.');
   const {error:channelsError}=await db.rpc('kitch_supplier_channels',{
    p_action:'save',p_restaurant_id:officeRid,p_supplier_id:supplierId,
    p_additional_to:form.elements.more_to.value.trim(),
    p_cc:form.elements.cc.value.trim(),p_whatsapp:form.elements.whatsapp.value.trim()
   });
   if(channelsError)throw Error('Supplier saved; additional contacts were not saved: '+channelsError.message);
   close();await officePurchaseLoad();officePurchaseStatus('Supplier '+name+' and contact channels saved.');
  }catch(ex){err.textContent='Supplier not saved: '+ex.message}
  finally{button.disabled=false}
 };
 form.elements.name.focus();
}
// One-Excel workflow: Kitchen Manager imports ingredients and supplier contact fields;
// Main Office owner confirms and syncs matching browser Supplier Master profiles.
officePurchaseEl('officeSupplierSync').addEventListener('click',async()=>{
 const button=officePurchaseEl('officeSupplierSync');
 const msg=officePurchaseEl('officeSupplierMessage');
 if(!officeRid){msg.textContent='Sign in as Main Office owner first.';return;}
 let local=[];
 try{local=JSON.parse(window.localStorage.getItem('kitch_demo_suppliers_v1')||'[]')}
 catch(e){msg.textContent='Could not read the imported Supplier Master on this browser.';return;}
 if(!Array.isArray(local))local=[];
 const suppliers=new Map();
 for(const raw of local){
  const name=String(raw?.name||'').trim();
  if(!name||name.length>120)continue;
  const key=name.toLowerCase();
  const old=suppliers.get(key)||{};
  suppliers.set(key,{...old,...raw,name});
 }
 if(!suppliers.size){msg.textContent='No imported suppliers found on this browser. First import your Unified Master Excel from Operations.';return;}
 button.disabled=true;
 try{
  const {data:cloudRows,error:listError}=await db.rpc('kitch_office_supplier_profile',{p_action:'list',p_restaurant_id:officeRid});
  if(listError)throw Error(listError.message);
  const existing=new Map((Array.isArray(cloudRows)?cloudRows:[]).map(x=>[String(x.name||'').trim().toLowerCase(),x]));
  const additions=[...suppliers.values()].filter(x=>!existing.has(x.name.toLowerCase()));
  const fillings=[...suppliers.values()].filter(x=>{
   const old=existing.get(x.name.toLowerCase());
   return old&&(['contact_name','email','phone','address','trade_license'].some((field,i)=>!old[field]&&String(x[['contact','email','phone','address','trn'][i]]||'').trim()));
  });
  if(!additions.length&&!fillings.length){msg.textContent='All '+suppliers.size+' imported suppliers are already in the cloud. No changes needed.';return;}
  if(!confirm('Sync '+additions.length+' new supplier(s) and fill missing contact fields on '+fillings.length+' existing supplier(s)? Existing nonempty cloud details and purchase history stay unchanged.')){
   msg.textContent='Sync cancelled. No supplier changes made.';return;
  }
  let saved=0;
  for(const x of [...additions,...fillings]){
   const old=existing.get(x.name.toLowerCase());
   const field=(cloudName,localName,max)=>{
    const v=String(old?.[cloudName]||x[localName]||'').trim();
    return v.slice(0,max);
   };
   const notes=String(old?.notes||x.notes||x.supplier_type||'').slice(0,1000);
   const {data,error}=await db.rpc('kitch_office_supplier_profile',{
    p_action:'save',p_restaurant_id:officeRid,p_supplier_id:old?.id||null,
    p_name:x.name,p_contact_name:field('contact_name','contact',120),
    p_email:field('email','email',320),
    p_phone:field('phone','phone',50),
    p_address:field('address','address',600),
    p_trade_license:field('trade_license','trn',120),p_notes:notes
   });
   if(error)throw Error(x.name+': '+error.message);
   if(!data?.saved)throw Error(x.name+': cloud did not confirm save');
   saved++;
   msg.textContent='Synced '+saved+' / '+(additions.length+fillings.length)+' suppliers…';
  }
  await officePurchaseLoad();
  msg.textContent='✓ '+saved+' imported supplier profiles synchronized. They now appear in cloud supplier orders.';
 }catch(e){msg.textContent='Supplier sync stopped: '+e.message+' Earlier successful records remain saved; retry skips duplicates.'}
 finally{button.disabled=false}
});
officePurchaseEl('officeSupplierAdd').addEventListener('click',()=>officeSupplierProfileForm(null));
officePurchaseEl('officeSuppliers').addEventListener('click',e=>{
 const btn=e.target.closest('[data-supplier-id]');
 if(btn)officeSupplierProfileForm(btn.dataset.supplierId);
});
const originalOfficeShowPage=showPage;
showPage=function(page){originalOfficeShowPage(page);if(page==='purchasing'&&officeRid)officePurchaseLoad()};

// Startup is scheduled near the beginning so unrelated widget errors cannot block sign-in.
})();
