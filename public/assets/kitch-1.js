
const SUPABASE_URL='https://rtovpjgrezwxuvantxgt.supabase.co';
const SUPABASE_KEY='sb_publishable_ERMt86IhOTqRSRXE05CQ-A_JXi27ode';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage}});
const KITCH_AUTH_BUILD='2026-10-02-final-all-in-one-v1';
let cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:null};
let teamCloudAuth=null;

async function loadCloudWorkspace(){
 const {data:{user},error:userError}=await sb.auth.getUser(); cloud.user=user||null;
 if(userError||!user){window.__kitchWorkspaceError=userError?.message||'No authenticated user';return false;}

 // Fast restore: once this account has resolved a workspace, keep using it after
 // refresh/redeploy instead of making the import depend on another membership read.
 const cachePrefix='kitch_cloud_'+user.id+'_';
 const cachedRestaurant=localStorage.getItem(cachePrefix+'restaurant_id');
 const cachedBranch=localStorage.getItem(cachePrefix+'branch_id');
 const cachedWorkspaceCode=localStorage.getItem(cachePrefix+'workspace_code');
 if(cachedRestaurant){
  cloud.restaurant_id=cachedRestaurant;cloud.branch_id=cachedBranch||null;cloud.workspace_code=cachedWorkspaceCode||null;
  await syncPackageFromCloud();
  restoreScopedStaff();
  window.__kitchWorkspaceError='';return true;
 }

 // 1) Preferred: resolve the workspace through the server-side helper.
 try{
  const {data:rows,error}=await sb.rpc('kitch_current_workspace');
  const w=Array.isArray(rows)?rows[0]:rows;
  if(!error&&w?.restaurant_id){
   cloud.restaurant_id=w.restaurant_id;
   cloud.branch_id=w.branch_id||null;
   cloud.workspace_code=w.workspace_code||null;
   if(w.branch_name)localStorage.setItem('kitch_cloud_branch_name',w.branch_name);
   if(w.workspace_code){localStorage.setItem('kitch_cloud_workspace_code',w.workspace_code);localStorage.setItem('kitch_last_workspace_code',w.workspace_code);localStorage.setItem(cachePrefix+'workspace_code',w.workspace_code);}
   localStorage.setItem(cachePrefix+'restaurant_id',cloud.restaurant_id);
   localStorage.setItem(cachePrefix+'branch_id',cloud.branch_id||'');
   await syncPackageFromCloud();
   restoreScopedStaff();
   window.__kitchWorkspaceError='';
   return true;
  }
  if(error)console.warn('Workspace RPC failed; trying membership fallback',error);
 }catch(e){console.warn('Workspace RPC exception; trying membership fallback',e);}

 // 2) Main Office owner membership: owner accounts may not exist in restaurant_members.
 // Read only the signed-in user's permitted owner row; never grant access from browser cache.
 try{
  const {data:officeRows,error:officeError}=await sb.from('kitch_office_owners')
   .select('restaurant_id').eq('user_id',user.id).eq('is_active',true).limit(1);
  const office=officeRows?.[0];
  if(!officeError&&office?.restaurant_id){
   const {data:branches,error:branchError}=await sb.from('branches')
    .select('id,name,branch_type,is_active').eq('restaurant_id',office.restaurant_id).eq('is_active',true);
   if(branchError)throw branchError;
   const main=(branches||[]).find(b=>/main kitchen/i.test(b.name||''))||(branches||[]).find(b=>b.branch_type!=='central_store')||(branches||[])[0];
   cloud.restaurant_id=office.restaurant_id;cloud.branch_id=main?.id||null;
   if(main?.name)localStorage.setItem('kitch_cloud_branch_name',main.name);
   localStorage.setItem(cachePrefix+'restaurant_id',cloud.restaurant_id);
   localStorage.setItem(cachePrefix+'branch_id',cloud.branch_id||'');
   await syncPackageFromCloud();restoreScopedStaff();window.__kitchWorkspaceError='';return true;
  }
  if(officeError)console.warn('Main Office membership lookup failed',officeError);
 }catch(e){console.warn('Main Office workspace lookup failed',e);}

 // 2) Fallback: resolve from the authenticated user's restaurant membership.
 try{
  const {data:members,error:memberError}=await sb.from('restaurant_members')
   .select('id,restaurant_id,role').eq('user_id',user.id).limit(1);
  const m=members?.[0];
  if(!memberError&&m?.restaurant_id){
   cloud.restaurant_id=m.restaurant_id;
   let branchId=null,branchName='';
   const {data:links}=await sb.from('member_branches').select('branch_id').eq('restaurant_member_id',m.id).limit(1);
   branchId=links?.[0]?.branch_id||null;
   if(!branchId){
    const {data:branches}=await sb.from('branches').select('id,name').eq('restaurant_id',m.restaurant_id).limit(1);
    branchId=branches?.[0]?.id||null;branchName=branches?.[0]?.name||'';
   }else{
    const {data:branch}=await sb.from('branches').select('id,name').eq('id',branchId).maybeSingle();
    branchName=branch?.name||'';
   }
   cloud.branch_id=branchId;
   if(branchName)localStorage.setItem('kitch_cloud_branch_name',branchName);
   localStorage.setItem(cachePrefix+'restaurant_id',cloud.restaurant_id);
   localStorage.setItem(cachePrefix+'branch_id',cloud.branch_id||'');
   await syncPackageFromCloud();
   restoreScopedStaff();
   window.__kitchWorkspaceError='';
   return true;
  }
  if(memberError)console.warn('Membership workspace fallback failed',memberError);
 }catch(e){console.warn('Membership workspace fallback exception',e);}

 // 3) No hard-coded legacy workspace fallback. Every account must resolve its own workspace.

 // 4) Last safe browser fallback: use IDs previously resolved for this signed-in session.
 const fallbackRestaurant=localStorage.getItem(cachePrefix+'restaurant_id');
 const fallbackBranch=localStorage.getItem(cachePrefix+'branch_id');
 if(fallbackRestaurant){
  cloud.restaurant_id=fallbackRestaurant;cloud.branch_id=fallbackBranch||null;
  await syncPackageFromCloud();
  window.__kitchWorkspaceError='';return true;
 }
 window.__kitchWorkspaceError='No KITCH workspace is linked to this signed-in account.';
 return false;
}

function activateWorkspaceBrowserScope(){
 if(!cloud.restaurant_id)return;
 const scopeKey='kitch_active_workspace_scope_v1';
 const previous=localStorage.getItem(scopeKey);
 const current=String(cloud.restaurant_id);
 // Browser demo/operational records belong to exactly one restaurant workspace.
 // When a different customer/workspace signs in, remove ALL prior KITCH demo data
 // so inventory, receiving, recipes, production, waste, counts, transfers, activity
 // and staff can never leak from the previous customer.
 if(previous!==current){
   Object.keys(localStorage).filter(k=>k.startsWith('kitch_demo_')).forEach(k=>localStorage.removeItem(k));
   localStorage.setItem(scopeKey,current);
 }
}

async function syncPackageFromCloud(){
 if(!cloud.restaurant_id)return false;
 activateWorkspaceBrowserScope();
 try{
  const {data:branches,error}=await sb.from('branches').select('id,name,branch_type,is_active').eq('restaurant_id',cloud.restaurant_id).eq('is_active',true).order('created_at');
  if(error)throw error;
  const rows=branches||[];
  const hasStore=rows.some(b=>String(b.branch_type||'').toLowerCase()==='central_store');
  const restaurantBranch=rows.find(b=>String(b.branch_type||'').toLowerCase()!=='central_store')||rows[0]||null;
  localStorage.setItem(PACKAGE_KEY,hasStore?'multi':'restaurant');
  if(restaurantBranch){
   cloud.branch_id=restaurantBranch.id;
   localStorage.setItem('kitch_cloud_branch_name',restaurantBranch.name||'Main Restaurant');
   if(cloud.user?.id){
    const cachePrefix='kitch_cloud_'+cloud.user.id+'_';
    localStorage.setItem(cachePrefix+'branch_id',restaurantBranch.id||'');
   }
  }
  // Do not clear this workspace's locations/departments/staff here.
  // They are valid workspace data and must survive refresh/re-login. Cross-account
  // cleanup is handled once by activateWorkspaceBrowserScope() above.
  return true;
 }catch(e){console.warn('Could not sync package structure from cloud',e);return false;}
}

async function cloudLoadIngredients(){
 if(!cloud.restaurant_id)return;
 window.__kitchTeamLiveStock=null;
 window.__kitchInventoryLoadError=''; // clear stale errors before each fresh live read
 let data,error,teamSnapshot=null;
 if(teamCloudAuth?.staff_name&&teamCloudAuth?.pin){
  const response=await sb.rpc('kitch_team_inventory_read',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin});
  error=response.error;teamSnapshot=response.data;
  if(!error&&(String(teamSnapshot?.restaurant_id)!==String(cloud.restaurant_id)||String(teamSnapshot?.branch_id)!==String(cloud.branch_id)))error={message:'Inventory location does not match login'};
  if(!error&&!Array.isArray(teamSnapshot?.ingredients))error={message:'Staff catalog response is unavailable'};
  data=teamSnapshot?.ingredients;
 }else{
 const response=await sb.from('ingredients').select('id,sku,name,base_unit,category,supplier_name,last_unit_cost,receiving_type,reference_cost,par_target,minimum_stock,is_active').eq('restaurant_id',cloud.restaurant_id).eq('is_active',true).order('name');
 data=response.data;error=response.error;
 }

 if(error){console.error('Ingredient catalog read failed',error);window.__kitchInventoryLoadError='Ingredient catalog access denied: '+(error.message||'unknown error');alert('KITCH cannot load the live Ingredient Master for this staff account. This is a permissions problem, not zero inventory. '+window.__kitchInventoryLoadError);return;}
 const existing=ingredients();
 const byCloud=new Map(existing.filter(x=>x.cloud_id).map(x=>[String(x.cloud_id),x]));
 const byName=new Map(existing.map(x=>[String(x.name||'').trim().toLowerCase(),x]));
 const a=(data||[]).map(x=>{
  const prev=byCloud.get(String(x.id))||byName.get(String(x.name||'').trim().toLowerCase())||{};
  return {cloud_id:x.id,sku:x.sku||prev.sku||'',name:x.name,category:x.category||prev.category||'',supplier:x.supplier_name??prev.supplier??'',receiving_type:receivingTypeLabel(x.receiving_type||prev.receiving_type||'Room Temperature'),base_unit:x.base_unit,cost:Number(x.last_unit_cost||0),reference_cost:Number(x.reference_cost!=null?x.reference_cost:(x.last_unit_cost||0)),latest_cost:Number(x.last_unit_cost||0),par:Number(x.par_target||0),minimum:Number(x.minimum_stock||0),opening_stock:Number(prev.opening_stock||0),opening_unit_cost:Number(prev.opening_unit_cost||0),stock:Number(prev.stock||0),stock_canonical:Number(prev.stock_canonical||0),branch_stock_canonical:prev.branch_stock_canonical||{},restaurant_stock_canonical:Number(prev.restaurant_stock_canonical||0),stock_location:prev.stock_location||localStorage.getItem('kitch_cloud_branch_name')||'Main Branch'};
 });
 // KITCH live stock is held in Supabase inventory_balances, not in the
 // browser's demo cache. Never overwrite a live balance with an empty cache.
 let balances=null, balanceError=null;
 if(teamCloudAuth?.staff_name&&teamCloudAuth?.pin){
   const response={data:teamSnapshot,error:null};
   balanceError=response.error;
   if(!balanceError){
     const payload=response.data||{};
     if(String(payload.restaurant_id)!==String(cloud.restaurant_id)||String(payload.branch_id)!==String(cloud.branch_id)){
       balanceError={message:'Team inventory restaurant or branch does not match your session.'};
     }else balances=payload.balances||[];
   }
 }else{
   const response=await sb.from('inventory_balances')
     .select('ingredient_id,branch_id,unit,quantity_on_hand,indicative_unit_cost')
     .eq('restaurant_id',cloud.restaurant_id);
   balances=response.data;balanceError=response.error;
 }
 if(balanceError){
   console.error('Live inventory balances could not load',balanceError);
   window.__kitchInventoryLoadError=balanceError.message||'Inventory access denied';
   alert('KITCH could not read live stock: '+window.__kitchInventoryLoadError+'\nExisting stock was not changed.');
   return;
 }else{
   window.__kitchInventoryLoadError='';
   const live=new Map();
   // Resolve the selected location by its real cloud ID, not a stale browser branch ID.
   const activeLocation=currentBranch();
   // A staff PIN session is always scoped to its authenticated cloud branch.
   // Never substitute an unrelated cached browser location.
   const selectedCloudBranch=teamCloudAuth?.staff_name?cloud.branch_id:(activeLocation?.cloud_id||cloud.branch_id);
   const matchingBalances=(balances||[]).filter(b=>!selectedCloudBranch||String(b.branch_id)===String(selectedCloudBranch));
   // A new Central Store can legitimately have zero inventory rows.
   // An empty successful RPC result is valid zero stock, not a connection error.
   window.__kitchInventoryEmptyLocation=!!(teamCloudAuth?.staff_name && !(balances||[]).length);
   if(!teamCloudAuth?.staff_name && (balances||[]).length && !matchingBalances.length){
     console.warn('KITCH: selected branch has no inventory balances',selectedCloudBranch);
     window.__kitchInventoryLoadError='This location has no live inventory balances. Select the correct location or check its cloud assignment. Existing stock was not changed.';
   }
   // Authoritative live snapshot for the signed-in staff branch.
   // Render stock from this snapshot directly rather than depending on legacy
   // Starter/Business browser package flags or branch aliases.
   if(teamCloudAuth?.staff_name){
     window.__kitchTeamLiveStock=new Map(matchingBalances.map(b=>[String(b.ingredient_id),{qty:toCanonical(Number(b.quantity_on_hand||0),b.unit),value:Number(b.quantity_on_hand||0)*Number(b.indicative_unit_cost||0)}]));
   }
   matchingBalances.forEach(b=>{
     const key=String(b.ingredient_id);
     const prev=live.get(key)||{qty:0,value:0};
     const qty=Number(b.quantity_on_hand||0);
     prev.qty+=toCanonical(qty,b.unit);
     prev.value+=qty*Number(b.indicative_unit_cost||0);
     live.set(key,prev);
   });
   if(window.__kitchInventoryLoadError){
     // Never persist a misleading zero-stock snapshot when the selected branch is unresolved.
     return;
   }
   a.forEach(x=>{
     const b=live.get(String(x.cloud_id));
     // The Business UI reads branch_stock_canonical, not stock_canonical.
     // Store live stock under BOTH the cloud branch id and local UI branch id.
     const branchQty=b?b.qty:0;
     if(hasCentralStore()){
       x.stock_canonical=0; // Central Store remains independent.
       x.stock=0;
       x.branch_stock_canonical={};
       const localBranch=currentBranchId();
       if(selectedCloudBranch)x.branch_stock_canonical[String(selectedCloudBranch)]=branchQty;
       if(localBranch)x.branch_stock_canonical[String(localBranch)]=branchQty;
       // Local location IDs are UI aliases; do not double-count aliases.
       const matchedLocation=locations().find(l=>String(l.cloud_id||'')===String(selectedCloudBranch||''));
       if(matchedLocation)x.branch_stock_canonical[String(matchedLocation.id)]=branchQty;
       x.restaurant_stock_canonical=branchQty; // Aggregate ONCE, not per alias.
     }else{
       x.stock_canonical=branchQty;
       x.stock=fromCanonical(branchQty,x.base_unit);
       x.branch_stock_canonical={};
       x.restaurant_stock_canonical=0;
     }
     if(b&&b.qty>0){
       const unitQty=fromCanonical(b.qty,x.base_unit);
       const liveUnitCost=unitQty>0?b.value/unitQty:0;
       x.cost=liveUnitCost;
       x.latest_cost=liveUnitCost;
     }
   });
 }
 localStorage.setItem('kitch_demo_ingredients_v1',JSON.stringify(a));
}
async function ensureSupabaseAuth(){
 // Supabase-js already persists and refreshes sessions. getUser() validates the
 // current browser token and avoids false "expired" errors during refresh races.
 const {data:{user},error}=await sb.auth.getUser();
 if(error||!user){
  window.__kitchWorkspaceError='Your management login has expired. Please sign in again.';
  return false;
 }
 cloud.user=user;
 return true;
}
async function ensureCloudWorkspace(){
 if(!(await ensureSupabaseAuth()))return false;
 const ok=await loadCloudWorkspace();
 if(!ok){
  cloud.restaurant_id=null;cloud.branch_id=null;
  return false;
 }
 return true;
}
async function cloudUpsertIngredient(x){
 // Operational Team users are not Supabase Auth users, so direct table writes are
 // intentionally blocked by RLS. Always use the secure team RPC for Team sessions.
 if(teamCloudAuth?.pin&&teamCloudAuth?.staff_name){
  const {data,error}=await sb.rpc('kitch_team_upsert_ingredient_by_staff',{
   p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,
   p_name:x.name,p_base_unit:x.base_unit,p_category:x.category||null,
   p_unit_cost:Number(x.cost||x.reference_cost||0),p_sku:x.sku||null,
   p_receiving_type:x.receiving_type||null,
   p_reference_cost:Number(x.reference_cost||x.cost||0),
   p_par:Number(x.par||0),p_minimum:Number(x.minimum||0),
   p_opening_stock:x._importOpening===true?Number(x.opening_stock):0,
   p_opening_unit_cost:Number(x.opening_unit_cost||x.reference_cost||x.cost||0)
  });
  if(error)throw new Error(error.message||'Team ingredient write failed');
  const row=Array.isArray(data)?data[0]:data;if(row?.id)x.cloud_id=row.id;
  return x;
 }
 // Management uses authenticated RLS. Refresh the authenticated workspace first so
 // an old browser cache cannot point an import at another restaurant.
 if(!cloud.restaurant_id){
  const ok=await ensureCloudWorkspace();
  if(!ok||!cloud.restaurant_id)throw new Error('Management workspace is not loaded. Sign in again.');
 }
 const row={restaurant_id:cloud.restaurant_id,sku:x.sku||null,name:x.name,base_unit:x.base_unit,category:x.category||null,supplier_name:x.supplier||null,last_unit_cost:Number(x.cost||x.reference_cost||0),receiving_type:x.receiving_type||null,reference_cost:Number(x.reference_cost||x.cost||0),par_target:Number(x.par||0),minimum_stock:Number(x.minimum||0),is_active:true};
 let q=x.cloud_id?sb.from('ingredients').update(row).eq('id',x.cloud_id).select('id').single():sb.from('ingredients').insert(row).select('id').single();
 const {data,error}=await q;if(error)throw error;if(data?.id)x.cloud_id=data.id;return x;
}
const KITCH_EMPTY_FRESH_BUILD='kitch_empty_fresh_build_v1';
if(!localStorage.getItem(KITCH_EMPTY_FRESH_BUILD)){
  Object.keys(localStorage).filter(k=>k.startsWith('kitch_demo_')||k.startsWith('kitch_final_')).forEach(k=>localStorage.removeItem(k));
  localStorage.setItem('kitch_demo_package_v1','restaurant');
  localStorage.setItem(KITCH_EMPTY_FRESH_BUILD,'1');
}
const PACKAGE_KEY='kitch_demo_package_v1';
// Package type is resolved from the authenticated cloud workspace.
// Never auto-upgrade a browser session to Business.
const FINAL_TRIAL_RESET_KEY='kitch_final_restaurant_trial_v3';
if(!localStorage.getItem(FINAL_TRIAL_RESET_KEY)){
 const keep=[PACKAGE_KEY];
 Object.keys(localStorage).filter(k=>k.startsWith('kitch_demo_') && k!==PACKAGE_KEY).forEach(k=>localStorage.removeItem(k));
 if(!localStorage.getItem(PACKAGE_KEY)) localStorage.setItem(PACKAGE_KEY,'restaurant');
 localStorage.setItem(FINAL_TRIAL_RESET_KEY,'1');
}
function packageType(){
  return localStorage.getItem(PACKAGE_KEY)==='multi'?'multi':'restaurant';
}
function hasCentralStore(){return packageType()==='multi'}
function primaryRestaurantName(){
 try{
  const loc=JSON.parse(localStorage.getItem('kitch_demo_locations_v2')||'[]');
  const branch=loc.find(x=>x.type!=='Central Store'&&x.status!=='Inactive');
  return (branch&&branch.name)||'Main Restaurant';
 }catch(e){return 'Main Restaurant'}
}
function stockLocation(){return hasCentralStore()?'Central Store':primaryRestaurantName()}
function currentBranch(){
 const branches=locations().filter(x=>x.type==='Branch'&&x.status==='Active');
 if(currentStaff&&currentStaff.location_id){
   const assigned=branches.find(x=>String(x.id)===String(currentStaff.location_id)||String(x.cloud_id||'')===String(currentStaff.location_id));
   if(assigned)return assigned;
 }
 if(teamCloudAuth&&cloud.branch_id){
   const assigned=branches.find(x=>String(x.cloud_id||x.id)===String(cloud.branch_id));
   if(assigned)return assigned;
 }
 return branches[0]||{id:'branch-1',name:'Main Branch'};
}
function currentBranchId(){return currentBranch().id}
function currentBranchName(){return currentBranch().name}
function centralStockCanonical(ing){
 if(session==='store' && teamCloudAuth?.staff_name && window.__kitchTeamLiveStock instanceof Map){
  return Number(window.__kitchTeamLiveStock.get(String(ing.cloud_id))?.qty||0);
 }
 return ing.stock_canonical!=null?Number(ing.stock_canonical):toCanonical(ing.stock,ing.base_unit);
}
function branchStockCanonical(ing,branchId=currentBranchId()){
 const map=(ing.branch_stock_canonical&&typeof ing.branch_stock_canonical==='object')?ing.branch_stock_canonical:{};
 if(Object.prototype.hasOwnProperty.call(map,String(branchId)))return Number(map[String(branchId)]||0);
 if(cloud?.branch_id&&Object.prototype.hasOwnProperty.call(map,String(cloud.branch_id)))return Number(map[String(cloud.branch_id)]||0);
 return 0;
}
function setBranchStockCanonical(ing,branchId,value){
 ing.branch_stock_canonical=(ing.branch_stock_canonical&&typeof ing.branch_stock_canonical==='object')?ing.branch_stock_canonical:{};
 ing.branch_stock_canonical[branchId]=Math.max(0,Number(value||0));
 ing.restaurant_stock_canonical=Object.values(ing.branch_stock_canonical).reduce((sum,v)=>sum+Number(v||0),0);
}
function contextStockCanonical(ing){
 if(teamCloudAuth?.staff_name && window.__kitchTeamLiveStock instanceof Map && ing.cloud_id){
   const live=window.__kitchTeamLiveStock.get(String(ing.cloud_id));
   return live?Number(live.qty||0):0;
 }
 if(!hasCentralStore())return centralStockCanonical(ing);
 return session==='store'?centralStockCanonical(ing):branchStockCanonical(ing);
}
const roles={
 owner:{name:'Main Office',label:'Owner / Main Office',nav:['Dashboard','Suppliers & Purchasing','Invoice Matching','Supplier Performance','Price Alerts','Inventory','Receiving','Expiry & Batches','Recipes','Production','Waste & Adjustments','Stock Count','Variance & Reconciliation','Locations & Departments','Staff & Access','Notifications','Reports']},
 manager:{name:'Kitchen Manager',label:'Kitchen Manager / Head Chef',nav:['Dashboard','Suppliers & Purchasing','Invoice Matching','Supplier Performance','Price Alerts','Inventory','Receiving','Expiry & Batches','Recipes','Production','Waste & Adjustments','Stock Count','Variance & Reconciliation','Notifications','Reports']},
 store:{name:'Central Store Manager',label:'Central Store Manager',nav:['Inventory','Receiving','Expiry & Batches','Waste & Adjustments','Stock Count','Variance & Reconciliation','Notifications','Reports']},
 production:{name:'Production Staff',label:'Production Staff',nav:['Production','Recipes','Suppliers & Purchasing','Label','Notifications']}
};
let session=null;
let dashboardPeriod='30d',dashboardCustomStart='',dashboardCustomEnd='';
function setDashboardPeriod(p){dashboardPeriod=p;openPage('Dashboard')}
function setCustomDashboardRange(){const a=document.getElementById('dashStart')?.value,b=document.getElementById('dashEnd')?.value;if(!a||!b)return alert('Choose both start and end dates.');if(new Date(a)>new Date(b))return alert('Start date must be before end date.');dashboardCustomStart=a;dashboardCustomEnd=b;dashboardPeriod='custom';openPage('Dashboard')}
function dashboardRange(){const now=new Date(),end=new Date(now);let start=new Date(now);if(dashboardPeriod==='today')start=new Date(now.getFullYear(),now.getMonth(),now.getDate());else if(dashboardPeriod==='7d')start=new Date(now.getTime()-6*86400000);else if(dashboardPeriod==='30d')start=new Date(now.getTime()-29*86400000);else if(dashboardPeriod==='monthly')start=new Date(now.getFullYear(),now.getMonth()-5,1);else if(dashboardPeriod==='custom'&&dashboardCustomStart&&dashboardCustomEnd){start=new Date(dashboardCustomStart+'T00:00:00');end.setTime(new Date(dashboardCustomEnd+'T23:59:59.999').getTime())}return {start,end}}
function inDashboardRange(x){const d=recordDate(x),r=dashboardRange();return d>=r.start&&d<=r.end}
function dashboardFilter(){const r=dashboardRange(),fmt=d=>d.toISOString().slice(0,10);return `<div class="panel" style="margin-top:0;margin-bottom:14px;padding:14px 18px"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><b>Dashboard Period</b><div class="muted">All activity and trend charts follow this period.</div></div><div class="actions" style="margin:0">${[['today','Today'],['7d','7 Days'],['30d','30 Days'],['monthly','Monthly']].map(x=>`<button class="btn ${dashboardPeriod===x[0]?'black':''}" onclick="setDashboardPeriod('${x[0]}')">${x[1]}</button>`).join('')}<button class="btn ${dashboardPeriod==='custom'?'black':''}" onclick="document.getElementById('dashCalendar').classList.toggle('hidden')">Custom</button></div></div><div id="dashCalendar" class="${dashboardPeriod==='custom'?'':'hidden'}" style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div><label style="display:block;font-size:10px;font-weight:800;color:#777;margin-bottom:5px">FROM</label><input id="dashStart" type="date" value="${dashboardCustomStart||fmt(r.start)}" style="height:38px;border:1px solid #ddd;border-radius:10px;padding:0 10px"></div><div><label style="display:block;font-size:10px;font-weight:800;color:#777;margin-bottom:5px">TO</label><input id="dashEnd" type="date" value="${dashboardCustomEnd||fmt(r.end)}" style="height:38px;border:1px solid #ddd;border-radius:10px;padding:0 10px"></div><button class="btn black" onclick="setCustomDashboardRange()">Apply Dates</button></div></div>`}
function assignedLocationName(){return currentStaff?.location_name||((currentStaff?.location_id&&locationName(currentStaff.location_id)!=='—')?locationName(currentStaff.location_id):(session==='store'?'Central Store':currentBranchName()))}
function rowVisibleToSession(x){
 if(session==='owner')return true;
 const loc=String(x?.location||x?.branch||x?.to||'');
 return loc===assignedLocationName();
}
function scopedRows(rows){return session==='owner'?rows:rows.filter(rowVisibleToSession)}
function currentActor(){return currentStaff?.name||(session&&roles[session]?roles[session].name:'Unknown User')}
function mode(m){document.getElementById('managementForm').classList.toggle('hidden',m!=='management');document.getElementById('teamForm').classList.toggle('hidden',m!=='team');document.getElementById('mgTab').classList.toggle('active',m==='management');document.getElementById('teamTab').classList.toggle('active',m==='team')}
function passwordEyeIcon(showing){return showing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5c1.7 1.8 4.5 2.9 8 2.9s6.3-1.1 8-2.9"/><path d="M6.4 12.1 5 14.5M9.9 13.1l-.4 2.8M14.1 13.1l.4 2.8M17.6 12.1l1.4 2.4"/></svg>'}
function togglePassword(id,btn){
 const input=document.getElementById(id);if(!input)return;
 const showing=input.type==='text';input.type=showing?'password':'text';
 btn.innerHTML=passwordEyeIcon(!showing);btn.setAttribute('aria-label',showing?'Show password':'Hide password');
}
function applyActivatedSubscription(payload){
 if(!payload)return;
 localStorage.setItem(PACKAGE_KEY,payload.plan==='business'?'multi':'restaurant');
 localStorage.setItem('kitch_cloud_branch_name',payload.branch||'Main Branch');
 // A newly activated workspace must not inherit another account's browser demo structure.
 [LOCATION_KEY,DEPT_KEY,STAFF_KEY].forEach(k=>localStorage.removeItem(k));
 ensureStructure();
}
async function managementLogin(){
 const em=email.value.trim().toLowerCase(),pw=password.value;if(!em||!pw)return alert('Enter email and password.');
 const {data:loginData,error}=await sb.auth.signInWithPassword({email:em,password:pw});
 if(error){
  const pending=JSON.parse(sessionStorage.getItem('kitch_pending_subscription')||'null');
  const samePending=pending&&String(pending.email||'').trim().toLowerCase()===em;
  if(String(error.message||'').toLowerCase().includes('invalid login credentials')&&samePending){
   return alert('This test account was created but Supabase has not started a session. For the KITCH test-payment flow, disable Confirm email in Supabase Authentication > Providers > Email, then create a fresh test account.');
  }
  return alert(error.message);
 }
 if(!loginData?.session)return alert('Sign in did not create a session. Please try again.');
 const pending=JSON.parse(sessionStorage.getItem('kitch_pending_subscription')||'null');
 let ok=false;
 if(pending&&String(pending.email||'').toLowerCase()===em.toLowerCase()){
  // Email-confirmation flow: activate the package the customer actually selected before loading any prior browser cache.
  const operation=pending.plan==='business'?'multi':'restaurant';
  const {error:we}=await sb.rpc('kitch_create_owner_workspace',{p_company:pending.company,p_branch:pending.branch,p_plan:pending.plan,p_operation:operation});
  if(we&&!String(we.message||'').toLowerCase().includes('already'))return alert('Signed in, but workspace activation failed: '+we.message);
  // Clear stale cloud IDs from a previous account/browser session, then resolve this user's workspace.
  cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:null};
  ok=await loadCloudWorkspace();
  if(ok){applyActivatedSubscription(pending);sessionStorage.removeItem('kitch_pending_subscription');}
 }else ok=await loadCloudWorkspace();
 if(!ok){
  const {data:ownerMembership,error:ownerLookupError}=await sb.from('kitch_office_owners').select('restaurant_id').eq('user_id',loginData.user.id).eq('is_active',true).limit(1);
  if(!ownerLookupError&&ownerMembership?.length){closePublicModal();openKitchMainOffice();return;}
  return alert('This account has no accessible KITCH workspace. Please contact KITCH support to check the owner membership.');
 }
 restoreScopedStaff();await cloudLoadIngredients();await refreshStaffAccessFromCloud(false);currentStaff=null;closePublicModal();openKitchMainOffice();
}
function staffSessionRole(role){
 const r=String(role||'').toLowerCase();
 if(r.includes('kitchen manager')||r.includes('executive chef'))return 'manager';
 if(r.includes('store manager')||r.includes('receiving'))return 'store';
 if(r.includes('chef production'))return 'production';
 return 'production';
}
async function syncTeamWorkspaceContext(){
 if(!teamCloudAuth?.staff_name||!teamCloudAuth?.pin)return;
 const {data,error}=await sb.rpc('kitch_team_workspace_info',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin});
 if(error){console.warn('Could not sync Team package context',error);return;}
 const info=Array.isArray(data)?data[0]:data;if(!info)return;
 localStorage.setItem(PACKAGE_KEY,info.is_business?'multi':'restaurant');
 if(info.assigned_branch_name)localStorage.setItem('kitch_cloud_branch_name',info.assigned_branch_name);
 let locs=getArr(LOCATION_KEY);
 if(info.is_business&&info.central_store_id&&!locs.some(x=>x.type==='Central Store'))locs.unshift({id:'cloud-'+info.central_store_id,cloud_id:info.central_store_id,name:info.central_store_name||'Central Store',type:'Central Store',fixed:true,status:'Active'});
 let assigned=locs.find(x=>String(x.cloud_id||'')===String(info.assigned_branch_id||''))||locs.find(x=>String(x.name||'').toLowerCase()===String(info.assigned_branch_name||'').toLowerCase());
 if(!assigned&&info.assigned_branch_id){assigned={id:'cloud-'+info.assigned_branch_id,cloud_id:info.assigned_branch_id,name:info.assigned_branch_name||'Restaurant',type:String(info.assigned_branch_type||'').toLowerCase()==='central_store'?'Central Store':'Branch',status:'Active'};locs.push(assigned);}
 setArr(LOCATION_KEY,locs);ensureStructure();
 if(currentStaff&&assigned){currentStaff.location_id=assigned.id;currentStaff.location_name=assigned.name;}
}
async function teamLogin(){
 const button=document.getElementById('kitchTeamSubmit');
 const status=document.getElementById('kitchTeamStatus');
 const say=(message,isError=true)=>{if(status){status.textContent=message;status.style.color=isError?'#b42318':'#555';status.style.display='block';}else alert(message);};
 const name=(document.getElementById('teamStaffName')?.value||'').trim();
 const p=(document.getElementById('pin')?.value||'').trim();
 if(!name||!/^\d{4}$/.test(p)){say('Enter staff name and a 4-digit PIN.');return;}
 if(!window.supabase||!sb){say('Connection library unavailable. Refresh the page and check your internet connection.');return;}
 if(button){button.disabled=true;button.textContent='Signing in…';}
 say('Checking staff credentials…',false);
 try{
  const timedRpc=async(fn,args)=>Promise.race([sb.rpc(fn,args),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Connection timed out. Please try again.')),15000))]);
  let {data,error}=await timedRpc('kitch_team_login',{p_staff_name:name,p_pin:p});
  if(error){
   const workspace=(localStorage.getItem('kitch_last_workspace_code')||localStorage.getItem('kitch_cloud_workspace_code')||'').trim();
   if(workspace){({data,error}=await timedRpc('kitch_team_login_workspace',{p_workspace_code:workspace,p_staff_name:name,p_pin:p}));}
  }
  if(error){say('Team sign in failed: '+(error.message||'Database login error'));return;}
  const row=Array.isArray(data)?data[0]:data;
  if(!row){say('Incorrect staff name or PIN, or the staff account is not active.');return;}
  const role=String(row.role||'').toLowerCase();
  if(!['kitchen_manager','executive_chef','store_manager','receiving_staff','production_staff','viewer'].includes(role)){say('This staff role is not enabled for Team sign in.');return;}
  teamCloudAuth={workspace_code:row.workspace_code||'',pin:p,staff_name:name};
  if(row.workspace_code){localStorage.setItem('kitch_last_workspace_code',row.workspace_code);localStorage.setItem('kitch_cloud_workspace_code',row.workspace_code);}
  cloud.restaurant_id=row.restaurant_id||null;cloud.branch_id=row.branch_id||null;cloud.workspace_code=row.workspace_code||null;
  activateWorkspaceBrowserScope();
  currentStaff={id:row.staff_id||'',name:row.staff_name||name,role:role.replaceAll('_',' '),location_id:row.branch_id||'',location_name:row.branch_name||'',workspace_name:row.restaurant_name||'',department_id:'',status:'Active'};
  say('Credentials accepted. Opening dashboard…',false);
  try{await Promise.race([syncTeamWorkspaceContext(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Workspace sync timed out')),8000))]);}
  catch(syncError){console.warn('Team workspace sync:',syncError);}
  const r=(role==='kitchen_manager'||role==='executive_chef')?'manager':((role==='store_manager'||role==='receiving_staff')?'store':'production');
  enter(r);
  await cloudLoadIngredients();
  openPage(roles[r].nav[0]);
 }catch(e){console.error('KITCH team login error',e);say('Unable to sign in: '+(e?.message||String(e)));}
 finally{if(button){button.disabled=false;button.textContent='Team sign in';}}
}
function enter(r){closePublicModal();session=r;login.classList.add('hidden');document.getElementById('publicLanding')?.classList.add('hidden');app.classList.remove('hidden');userName.textContent=currentStaff?.name||roles[r].name;userRole.textContent=(currentStaff?`${currentStaff.role} · ${currentStaff.location_name||locationName(currentStaff.location_id)}`:roles[r].label);userScope.textContent=currentStaff?.workspace_name||cloud.workspace_code||primaryRestaurantName();renderNav();openPage(roles[r].nav[0])}
async function logout(){toggleAppMobileMenu(false);window.__kitchTeamLiveStock=null;session=null;currentStaff=null;teamCloudAuth=null;cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:null};await sb.auth.signOut();app.classList.add('hidden');login.classList.remove('hidden');closePublicModal()}
function renderNav(){
 let items=[...roles[session].nav];
 if(!hasCentralStore()){
   items=items.filter(x=>x!=='Stock Transfer'&&x!=='Stock Requests');
 }else{
   if(session==='manager'){
     items=items.filter(x=>x!=='Stock Transfer');
     const i=Math.max(1,items.indexOf('Inventory')+1);items.splice(i,0,'Stock Requests');
   }
   if(session==='store'){
     const i=items.indexOf('Receiving')+1;items.splice(i,0,'Stock Requests','Stock Transfer');
   }
 }
 const preferred=session==='store'?['Dashboard','Receiving','Inventory','Stock Requests']:session==='production'?['Dashboard','Recipes','Production','QC Labels']:['Dashboard','Inventory','Suppliers & Purchasing','Production'];
 const mainItems=preferred.filter(x=>items.includes(x)).slice(0,4);
 for(const x of items){if(mainItems.length>=4)break;if(!mainItems.includes(x))mainItems.push(x)}
 const extra=items.filter(x=>!mainItems.includes(x) && !(items.includes('Suppliers & Purchasing') && x==='Receiving'));
 const makeButton=x=>{const b=document.createElement('button');b.type='button';b.textContent=x;b.addEventListener('click',()=>{document.getElementById('kitchMoreMenu')?.remove();openPage(x)});return b};
 nav.replaceChildren(...mainItems.map(makeButton));
 if(extra.length){const more=document.createElement('button');more.type='button';more.textContent='More ▾';more.className='kitchMoreTrigger';more.setAttribute('aria-haspopup','true');more.addEventListener('click',e=>{e.stopPropagation();let menu=document.getElementById('kitchMoreMenu');if(menu){menu.remove();return}menu=document.createElement('div');menu.id='kitchMoreMenu';menu.className='kitchMoreMenu';extra.forEach(x=>menu.appendChild(makeButton(x)));document.body.appendChild(menu);const r=more.getBoundingClientRect();menu.style.top=(r.bottom+8)+'px';menu.style.left=Math.max(12,Math.min(r.left,innerWidth-270))+'px';});nav.appendChild(more)}
 const u=document.getElementById('upgradeNav');if(u)u.innerHTML=(session==='owner'&&packageType()==='restaurant')?'<button onclick="openPage(\'Subscription Setup\')">Upgrade Subscription</button>':''
}
document.addEventListener('click',e=>{const m=document.getElementById('kitchMoreMenu');if(m&&!m.contains(e.target)&&!e.target.closest('.kitchMoreTrigger'))m.remove()});
function invoiceMatchingPage(){
 const po=getArr(PO_KEY);
 const received=po.filter(x=>['Received','Closed'].includes(purchaseStatus(x))||x.accepted!=null||x.invoice_price!=null);
 const matched=received.filter(x=>x.invoice_match_status==='Approved').length;
 const held=received.filter(x=>x.invoice_match_status==='Hold').length;
 const variance=received.filter(x=>x.invoice_price!=null&&Math.abs(Number(x.invoice_price||0)-Number(x.reference_price??x.price??0))>0.009).length;
 const rows=received.map(x=>{const ref=Number(x.reference_price??x.price??0),inv=Number(x.invoice_price??ref),diff=inv-ref,pct=ref?diff/ref*100:0,status=x.invoice_match_status||'Pending Review';return `<tr><td><b>${esc(x.po||'—')}</b></td><td>${esc(x.supplier||'—')}</td><td>${esc(x.ingredient||'—')}</td><td>${cleanQty(x.qty||0)} ${esc(x.unit||'')}</td><td>${cleanQty(x.accepted??x.delivered??x.qty??0)} ${esc(x.unit||'')}</td><td>${money(ref)}</td><td>${money(inv)}</td><td class="${Math.abs(diff)>.009?'bad':'ok'}">${diff>=0?'+':''}${money(diff)}${ref?` (${pct>=0?'+':''}${pct.toFixed(1)}%)`:''}</td><td><span class="alertBadge ${status==='Approved'?'alertInfo':status==='Hold'?'alertCritical':'alertWarning'}">${esc(status)}</span></td><td>${status==='Approved'?'—':`<button class="btn black" onclick="setInvoiceMatch(${x.id},'Approved')">Approve</button> <button class="btn" onclick="setInvoiceMatch(${x.id},'Hold')">Hold</button>`}</td></tr>`}).join('');
 return `<div class="grid"><div class="card"><span>RECEIVED LINES</span><b>${received.length}</b></div><div class="card"><span>PENDING REVIEW</span><b>${received.filter(x=>!x.invoice_match_status).length}</b></div><div class="card"><span>PRICE VARIANCES</span><b>${variance}</b></div><div class="card"><span>ON HOLD</span><b>${held}</b></div></div><div class="panel"><h2>Invoice Matching</h2><p class="muted">Three-way control: Purchase Order → Receiving → Supplier Invoice. Review quantity and price differences before approving the invoice.</p><div style="overflow-x:auto"><table style="min-width:1120px"><thead><tr><th>PO</th><th>SUPPLIER</th><th>ITEM</th><th>PO QTY</th><th>RECEIVED</th><th>PO PRICE</th><th>INVOICE PRICE</th><th>VARIANCE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${rows||`<tr><td colspan="10" class="empty">No received supplier deliveries are waiting for invoice matching.</td></tr>`}</tbody></table></div></div>`;
}
function setInvoiceMatch(id,status){const po=getArr(PO_KEY),row=po.find(x=>String(x.id)===String(id));if(!row)return alert('Purchase line not found.');const group=po.filter(x=>x.po===row.po);group.forEach(x=>x.invoice_match_status=status);setArr(PO_KEY,po);openPage('Invoice Matching')}
function supplierPerformancePage(){
 const clean=normalizeSupplierData(),suppliers=clean.su,products=clean.sp,pos=getArr(PO_KEY);
 const rows=suppliers.map(s=>{const sp=products.filter(p=>String(p.supplier||'').toLowerCase()===String(s.name||'').toLowerCase()),orders=pos.filter(p=>String(p.supplier||'').toLowerCase()===String(s.name||'').toLowerCase()),received=orders.filter(p=>['Received','Closed'].includes(purchaseStatus(p))||p.accepted!=null),onTime=received.filter(p=>!p.delivery_date||!p.received_date||new Date(p.received_date)<=new Date(p.delivery_date)).length,quality=received.filter(p=>p.receiving_condition_status==='Failed'||Number(p.rejected||0)>0).length,priceIssues=received.filter(p=>p.invoice_price!=null&&Math.abs(Number(p.invoice_price)-Number(p.reference_price??p.price??0))>.009).length,rate=received.length?Math.round(onTime/received.length*100):null,score=received.length?Math.max(0,100-quality*10-priceIssues*8-(received.length-onTime)*8):null;return `<tr><td><b>${esc(s.name)}</b></td><td>${sp.length}</td><td>${orders.length}</td><td>${received.length}</td><td>${rate==null?'—':rate+'%'}</td><td>${quality}</td><td>${priceIssues}</td><td><span class="alertBadge ${score==null?'alertInfo':score>=85?'alertInfo':score>=70?'alertWarning':'alertCritical'}">${score==null?'No history':score+'/100'}</span></td></tr>`}).join('');
 const received=pos.filter(p=>['Received','Closed'].includes(purchaseStatus(p))||p.accepted!=null);return `<div class="grid"><div class="card"><span>SUPPLIERS</span><b>${suppliers.length}</b></div><div class="card"><span>LINKED PRODUCTS</span><b>${products.length}</b></div><div class="card"><span>DELIVERIES TRACKED</span><b>${received.length}</b></div><div class="card"><span>SUPPLIERS WITH ISSUES</span><b>${new Set(received.filter(p=>Number(p.rejected||0)>0||p.receiving_condition_status==='Failed'||p.price_variance_alert).map(p=>p.supplier)).size}</b></div></div><div class="panel"><h2>Supplier Performance</h2><p class="muted">Performance is calculated from actual purchasing and receiving history — delivery reliability, rejected stock and price variance.</p><div style="overflow-x:auto"><table style="min-width:950px"><thead><tr><th>SUPPLIER</th><th>PRODUCTS</th><th>PO LINES</th><th>DELIVERIES</th><th>ON-TIME</th><th>QUALITY ISSUES</th><th>PRICE ISSUES</th><th>SCORE</th></tr></thead><tbody>${rows||`<tr><td colspan="8" class="empty">No suppliers yet.</td></tr>`}</tbody></table></div></div>`;
}
function priceAlertsPage(){
 const clean=normalizeSupplierData(),products=clean.sp,pos=getArr(PO_KEY),alerts=[];
 products.forEach(p=>{const agreed=Number(p.agreed_price??p.agreedPrice??p.price??0),current=Number(p.current_price??p.currentPrice??p.latestPrice??agreed);if(agreed>0&&Math.abs(current-agreed)>.009)alerts.push({type:'master',id:p.id,item:p.ingredient||p.item||p.productName||'Item',supplier:p.supplier||'—',agreed,current})});
 pos.filter(x=>x.invoice_price!=null).forEach(x=>{const agreed=Number(x.reference_price??x.price??0),current=Number(x.invoice_price||0);if(agreed>0&&Math.abs(current-agreed)>.009)alerts.push({type:'receipt',id:x.id,item:x.ingredient||'Item',supplier:x.supplier||'—',agreed,current,po:x.po})});
 const inc=alerts.filter(a=>a.current>a.agreed).length,dec=alerts.filter(a=>a.current<a.agreed).length;
 const rows=alerts.map(a=>{const d=a.current-a.agreed,pc=a.agreed?d/a.agreed*100:0;return `<tr><td><b>${esc(a.item)}</b>${a.po?`<br><small>${esc(a.po)}</small>`:''}</td><td>${esc(a.supplier)}</td><td>${money(a.agreed)}</td><td>${money(a.current)}</td><td class="${d>0?'bad':'ok'}">${d>=0?'+':''}${money(d)} · ${pc>=0?'+':''}${pc.toFixed(1)}%</td><td><span class="alertBadge ${d>0?'alertCritical':'alertInfo'}">${d>0?'Increase':'Decrease'}</span></td></tr>`}).join('');
 return `<div class="grid"><div class="card"><span>PRICE ALERTS</span><b>${alerts.length}</b></div><div class="card"><span>PRICE INCREASES</span><b>${inc}</b></div><div class="card"><span>PRICE DECREASES</span><b>${dec}</b></div><div class="card"><span>SUPPLIER PRODUCTS</span><b>${products.length}</b></div></div><div class="panel"><h2>Price Alerts</h2><p class="muted">Flags supplier master-price changes and invoice prices that differ from the agreed purchasing price.</p><div style="overflow-x:auto"><table style="min-width:850px"><thead><tr><th>ITEM / PO</th><th>SUPPLIER</th><th>AGREED PRICE</th><th>NEW / INVOICE PRICE</th><th>CHANGE</th><th>STATUS</th></tr></thead><tbody>${rows||`<tr><td colspan="6" class="empty">No supplier price changes detected.</td></tr>`}</tbody></table></div></div>`;
}

function toggleAppMobileMenu(open){
 const a=document.getElementById('app');
 if(!a)return;
 a.classList.toggle('mobileMenuOpen',!!open);
 document.body.style.overflow=open?'hidden':'';
}

// Subscription status is displayed from Supabase, never inferred from local storage.
// IMPORTANT: this is informational UI only. Paid-feature authorization must be
// enforced independently by server-side policies / RPCs / Edge Functions.
let kitchTrialRequestId=0;
async function refreshKitchTrialStatus(){
 const target=document.getElementById('kitchTrialStatus');
 if(!target)return;
 const requestId=++kitchTrialRequestId;
 const restaurantId=cloud?.restaurant_id;
 // Team PIN sign-in is not a Supabase Auth session. Do not issue a protected
 // subscription query from a PIN-only session or show a false missing-trial alert.
 if(session && session!=='owner'){target.style.display='none';return;}
 if(!restaurantId){target.style.display='none';return;}
 target.style.display='block';
 target.textContent='Checking your subscription status…';
 try{
  const {data,error}=await sb.from('kitch_restaurant_trials')
    .select('plan,status,trial_started_at,trial_ends_at')
    .eq('restaurant_id',restaurantId).limit(1).maybeSingle();
  if(requestId!==kitchTrialRequestId)return;
  if(error)throw error;
  if(!data){target.textContent='Subscription details are not visible to this login. Ask the restaurant owner to check account access.';return;}
  const end=Date.parse(data.trial_ends_at||'');
  const now=Date.now();
  const plan=String(data.plan||'').toLowerCase()==='business'?'Business':'Starter';
  const status=String(data.status||'').toLowerCase();
  if(status==='trialing' && Number.isFinite(end) && end>now){
    const days=Math.max(0,Math.ceil((end-now)/86400000));
    target.textContent=`${plan} free trial · ${days} day${days===1?'':'s'} remaining · Ends ${new Date(end).toLocaleDateString('en-AE',{day:'numeric',month:'short',year:'numeric'})}. No payment card required for your trial.`;
  }else if(Number.isFinite(end)&&end<=now){
    target.textContent=`Your ${plan} trial has ended. Your restaurant data is preserved. Choose a paid plan to continue using subscription features.`;
  }else{
    target.textContent=`${plan} subscription · Status: ${status||'pending'}. Contact KITCH support if this is unexpected.`;
  }
 }catch(err){
  if(requestId!==kitchTrialRequestId)return;
  console.warn('KITCH trial status unavailable',err);
  target.innerHTML='Trial information could not be loaded. <button type="button" class="btn" onclick="refreshKitchTrialStatus()">Retry</button><small style="display:block;margin-top:6px">'+esc(String(err?.message||err||'Connection error'))+'</small>';
 }
}
function openPage(name){if(session&&session!=='owner'&&!roles[session].nav.includes(name)&&!(session==='manager'&&name==='Stock Requests')&&!(session==='store'&&['Stock Requests','Stock Transfer'].includes(name))){alert('This page is not available for your staff role.');return;}void refreshKitchTrialStatus();pageTitle.textContent=name;[...nav.children].forEach(b=>b.classList.toggle('active',b.textContent===name));content.innerHTML=page(name);if(window.innerWidth<=850)toggleAppMobileMenu(false)}
function page(n){
 if(n==='Dashboard')return session==='owner'?managementDashboard():managerDashboard();
 if(n==='Subscription Setup')return subscriptionPage();
 if(n==='Locations & Departments')return locationsPage();
 if(n==='Staff & Access')return staffAccessPage();
 if(n==='Inventory')return inventoryPage();
 if(n==='Suppliers & Purchasing')return purchasingPage();
 if(n==='Invoice Matching')return invoiceMatchingPage();
 if(n==='Supplier Performance')return supplierPerformancePage();
 if(n==='Price Alerts')return priceAlertsPage();
 if(n==='Receiving')return (roles[session]?.nav.includes('Suppliers & Purchasing')?`<div style="margin:0 0 14px"><button class="btn" onclick="openPage('Suppliers & Purchasing')">← Suppliers & Purchasing</button></div>`:'')+receivingPage();
 if(n==='Expiry & Batches')return batchesPage();
 if(n==='Stock Requests')return stockRequestsPage();
 if(n==='Stock Transfer')return transferPage();
 if(n==='Recipes')return recipesPage();
 if(n==='Production')return productionPage();
 if(n==='Label')return qcPage();
 if(n==='QC')return qcPage();
 if(n==='Waste & Adjustments')return wastePage();
 if(n==='Stock Count')return stockCountPage();
 if(n==='Variance & Reconciliation')return variancePage();
 if(n==='Notifications')return notificationsPage();
 if(n==='Reports')return reportsPage();
 return `<div class="panel"><h2>${n}</h2><p class="muted">Clean demo module ready for the next operational build.</p><div class="empty">No demo records yet.</div></div>`;
}



function publicModal(html){closePublicModal();document.body.insertAdjacentHTML('beforeend',`<div id="publicModal" class="publicModal"><div class="publicBox"><button class="closePublic" onclick="closePublicModal()">×</button>${html}</div></div>`)}
function closePublicModal(){document.getElementById('publicModal')?.remove()}
function toggleMobileMenu(open){
 const m=document.getElementById('mobilePublicMenu');
 if(!m)return;
 m.classList.toggle('open',!!open);
 document.body.classList.toggle('kitch-menu-open',!!open);
}
function openPublicSignIn(mode='management'){publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:28px"><b>KITCH</b><span>RESTAURANT OPERATING SYSTEM</span></div><h2 style="font-size:42px;margin-bottom:10px">Sign in</h2><p class="muted">Management = Main Office / Owner · Team = operational staff</p><div class="actions loginTabs" style="margin:22px 0"><button class="btn ${mode==='management'?'black':''}" onclick="closePublicModal();openPublicSignIn('management')">Management</button><button class="btn ${mode==='team'?'black':''}" onclick="closePublicModal();openPublicSignIn('team')">Team</button></div>${mode==='management'?`<div class="field"><label>EMAIL</label><input id="email" autocomplete="email"></div><div class="field"><label>PASSWORD</label><div class="passwordWrap"><input id="password" type="password" autocomplete="current-password"><button type="button" class="passwordEye" onclick="togglePassword('password',this)" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5c1.7 1.8 4.5 2.9 8 2.9s6.3-1.1 8-2.9"/><path d="M6.4 12.1 5 14.5M9.9 13.1l-.4 2.8M14.1 13.1l.4 2.8M17.6 12.1l1.4 2.4"/></svg></button></div></div><button class="primary" onclick="managementLogin()">Management sign in</button><p class="muted" style="text-align:center;margin-top:14px">New to KITCH? Use <b>Subscribe Now</b> to create your account and workspace.</p>`:`<div class="field"><label>STAFF NAME</label><input id="teamStaffName" autocomplete="username" placeholder="Enter staff name"></div><div class="field"><label>STAFF PIN</label><div class="passwordWrap"><input id="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="Enter 4-digit PIN"><button type="button" class="passwordEye" onclick="togglePassword('pin',this)" aria-label="Show PIN"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5c1.7 1.8 4.5 2.9 8 2.9s6.3-1.1 8-2.9"/><path d="M6.4 12.1 5 14.5M9.9 13.1l-.4 2.8M14.1 13.1l.4 2.8M17.6 12.1l1.4 2.4"/></svg></button></div></div><button type="button" id="kitchTeamSubmit" class="primary" onclick="teamLogin()">Team sign in</button><div id="kitchTeamStatus" role="status" aria-live="polite" style="display:none;margin-top:12px;font-size:13px;line-height:1.5"></div>`}`)}
function openCreateWorkspace(){closePublicModal();publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>NEW WORKSPACE</span></div><h2>Create your KITCH</h2><div class="field"><label>COMPANY / RESTAURANT NAME</label><input id="newCompany"></div><div class="field"><label>FIRST BRANCH NAME</label><input id="newBranch" placeholder="e.g. Main Branch"></div><div class="field"><label>EMAIL</label><input id="newEmail" type="email"></div><div class="field"><label>PASSWORD</label><div class="passwordWrap"><input id="newPassword" type="password" minlength="8"><button type="button" class="passwordEye" onclick="togglePassword('newPassword',this)" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5c1.7 1.8 4.5 2.9 8 2.9s6.3-1.1 8-2.9"/><path d="M6.4 12.1 5 14.5M9.9 13.1l-.4 2.8M14.1 13.1l.4 2.8M17.6 12.1l1.4 2.4"/></svg></button></div></div><button class="primary" onclick="createWorkspace()">Create workspace</button>`)}
async function createWorkspace(){
 const company=newCompany.value.trim(),branch=newBranch.value.trim(),em=newEmail.value.trim(),pw=newPassword.value;
 if(!company||!branch||!em||pw.length<8)return alert('Complete all fields. Password must be at least 8 characters.');
 const {data,error}=await sb.auth.signUp({email:em,password:pw});if(error)return alert(error.message);
 if(!data.session)return alert('Account created. Confirm your email, then sign in to create your KITCH workspace.');
 const {data:w,error:we}=await sb.rpc('kitch_create_owner_workspace',{p_company:company,p_branch:branch,p_plan:'starter',p_operation:'restaurant'});
 if(we)return alert(we.message);
 await loadCloudWorkspace();await cloudLoadIngredients();currentStaff=null;enter('owner');
}
function socialContact(type){
 if(type==='instagram') return window.open('https://www.instagram.com/kitch.ae/','_blank','noopener,noreferrer');
 return publicModal(`<h2>WhatsApp</h2><div class="policyText"><p>KITCH WhatsApp support is being prepared for launch.</p><p>For now, contact us at <b>hello@kitch.ae</b>.</p></div><a class="primary" style="display:grid;place-items:center;text-decoration:none;margin-top:18px" href="mailto:hello@kitch.ae">Contact KITCH</a>`);
}
function publicInfo(type){
 const data={
 about:['About KITCH',`<p><b>KITCH was built from inside restaurant operations — not from outside looking in.</b></p><p>Every day, kitchens receive stock, prep ingredients, produce food, count inventory, record waste and try to understand where money is being lost. But those actions are often split between spreadsheets, paper, messages and disconnected systems.</p><p>KITCH brings the operational chain into one place: <b>Receiving → Inventory → Recipe → Production → Waste → Stock Count → Variance.</b></p><p>Our purpose is simple: give restaurant owners and kitchen teams a clearer picture of what came in, what was used, what was wasted and what should still be in stock.</p><p>KITCH is designed for real restaurant workflows — from one-location operators to businesses running a Central Store and multiple restaurant branches.</p><p><b>Control your kitchen. Protect your profit.</b></p>`],
 terms:['Terms & Conditions',`<p><b>Effective: October 2026 · Pre-launch / testing version</b></p><p>By accessing this KITCH test environment, you agree to use it only for legitimate evaluation and restaurant-operational purposes. KITCH provides software tools for inventory, receiving, recipes, production, waste, stock control, reporting and staff access.</p><p><b>Accounts & access.</b> Customers are responsible for protecting management credentials, workspace codes and staff PINs and for ensuring access is given only to authorized personnel.</p><p><b>Operational data.</b> Customers are responsible for the accuracy of quantities, costs, recipes, supplier information, counts and other records entered into KITCH. KITCH assists with operational control but does not replace accounting, food-safety, tax or legal obligations.</p><p><b>Subscriptions.</b> Starter and Business packages are presented in this testing build. Billing is not yet live in this version. Final commercial terms will state billing cycles, renewal, cancellation, suspension and refund rules before paid public launch.</p><p><b>Availability.</b> This is a pre-launch environment and features may change, be unavailable or contain test limitations. Do not rely on this build as the sole record for critical business operations.</p><p><b>Acceptable use.</b> Users must not attempt unauthorized access, interfere with the service, misuse another customer's data or use KITCH for unlawful activity.</p><p>Final production Terms & Conditions may be updated before commercial launch. Questions can be sent to <b>hello@kitch.ae</b>.</p>`],
 privacy:['Privacy Policy',`<p><b>Effective: October 2026 · Pre-launch / testing version</b></p><p>KITCH is designed to process only the information needed to operate and secure a restaurant workspace. This can include account details, company and location information, staff access records, suppliers, ingredients, recipes, receiving records, inventory movements, production, waste, stock counts, proofs and operational reports.</p><p><b>How data is used.</b> Information is used to provide the KITCH service, authenticate users, control role-based access, maintain operational records, generate reports, troubleshoot the product and protect the service.</p><p><b>Access.</b> Workspace information is intended to be visible according to assigned roles and locations. Main Office may have broader visibility than branch or production users.</p><p><b>Service providers.</b> KITCH uses third-party infrastructure to host and operate the service. Production documentation will identify relevant processors and retention practices before commercial launch.</p><p><b>Security.</b> We use access controls and technical safeguards appropriate to the product, but no online service can guarantee absolute security. Users must keep credentials and staff PINs confidential.</p><p><b>Testing notice.</b> This is a pre-launch environment. Avoid entering unnecessary personal, confidential or regulated information while testing.</p><p><b>Your requests.</b> For privacy questions or requests concerning information associated with a KITCH workspace, contact <b>hello@kitch.ae</b>.</p>`]
 };const x=data[type];publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>RESTAURANT OPERATING SYSTEM</span></div><h2 style="font-size:38px">${x[0]}</h2><div class="policyText">${x[1]}</div>`)
}
function openSubscribe(){
 publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>SUBSCRIPTION</span></div><h2 style="font-size:38px;margin-bottom:8px">One plan. Every kitchen.</h2><p class="muted">Unlimited locations and unlimited staff, with all KITCH operations tools.</p><div class="note" style="background:#fff8f3;border:1px solid #f1d7c4"><b>Stripe test mode.</b> This is a preview. Live billing and unlimited-location entitlements require backend configuration.</div><div class="planGrid" style="grid-template-columns:minmax(0,1fr);max-width:620px;margin:20px auto"><div class="plan"><b>KITCH Business</b><strong>AED 299 <small style="font-size:12px;color:#777">/ month</small></strong><ul><li>Unlimited locations</li><li>Unlimited staff</li><li>Inventory, receiving and purchasing</li><li>Recipes, production and QC labels</li><li>Central Store, transfers and reports</li></ul><button class="primary" onclick="startSubscription('business')">Choose KITCH Business</button></div></div>`);
 window.kitchLaunchPreview=false;
}
function toggleLandingDiscount(){window.kitchLaunchPreview=!window.kitchLaunchPreview;const on=window.kitchLaunchPreview;document.getElementById('landingPrice1').innerHTML=`AED ${on?'249':'299'} <small style="font-size:12px;color:#777">/ month</small>`;document.getElementById('landingPrice2').innerHTML=`AED ${on?'399':'499'} <small style="font-size:12px;color:#777">/ month</small>`;document.getElementById('landingLaunchDiscount').textContent=on?'Remove Launch Discount':'Apply Launch Discount';}
function startSubscription(plan){
 const label='KITCH Business · AED 299/month';
 closePublicModal();publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>ACCOUNT SETUP</span></div><h2>${label}</h2><p class="muted">Create the management account and company details. Workspace activation will happen only after the payment-success step.</p><div class="formGrid"><div class="field"><label>COMPANY / RESTAURANT NAME</label><input id="subCompany"></div><div class="field"><label>${plan==='business'?'FIRST RESTAURANT BRANCH':'RESTAURANT LOCATION'}</label><input id="subBranch" placeholder="e.g. Main Branch"></div><div class="field"><label>EMAIL</label><input id="subEmail" type="email"></div><div class="field"><label>PASSWORD</label><div class="passwordWrap"><input id="subPassword" type="password" minlength="8"><button type="button" class="passwordEye" onclick="togglePassword('subPassword',this)" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5c1.7 1.8 4.5 2.9 8 2.9s6.3-1.1 8-2.9"/><path d="M6.4 12.1 5 14.5M9.9 13.1l-.4 2.8M14.1 13.1l.4 2.8M17.6 12.1l1.4 2.4"/></svg></button></div></div></div><div class="note"><b>Launch pricing is a preview only.</b> Stripe test payment links may still use earlier test amounts. No real payment is taken; launch discounts and trial activation are not yet connected to billing.</div><button class="primary" onclick="testSubscriptionPayment('${plan}')">Continue to Stripe test checkout</button>`)
}
const STRIPE_PAYMENT_LINKS={
 starter:'https://buy.stripe.com/test_fZueVd73MaYR26ocIr6Ri00',
 business:'https://buy.stripe.com/test_fZu5kDafY9UN9yQaAj6Ri01'
};

async function testSubscriptionPayment(plan){
 const company=subCompany.value.trim(),branch=subBranch.value.trim(),em=subEmail.value.trim().toLowerCase(),pw=subPassword.value;
 if(!company||!branch||!em||pw.length<8)return alert('Complete all fields. Password must be at least 8 characters.');

 const payload={plan,company,branch,email:em,password:pw};
 sessionStorage.setItem('kitch_pending_subscription',JSON.stringify(payload));

 let {data:{session:activeSession}}=await sb.auth.getSession();
 const activeEmail=String(activeSession?.user?.email||'').trim().toLowerCase();

 if(activeSession&&activeEmail!==em){
   await sb.auth.signOut({scope:'local'});
   activeSession=null;
 }

 if(!activeSession){
   const signIn=await sb.auth.signInWithPassword({email:em,password:pw});
   if(signIn.data?.session){
     activeSession=signIn.data.session;
   }else{
     const signUp=await sb.auth.signUp({
       email:em,
       password:pw,
       options:{data:{kitch_plan:plan,kitch_company:company,kitch_branch:branch}}
     });

     if(signUp.error){
       const retry=await sb.auth.signInWithPassword({email:em,password:pw});
       if(retry.data?.session)activeSession=retry.data.session;
       else return alert('This email may already have a KITCH account with a different password. Use Management Sign In or use another email.');
     }else if(signUp.data?.session){
       activeSession=signUp.data.session;
     }else{
       return alert('Your KITCH account was created, but email confirmation is required before payment can continue.');
     }
   }
 }

 const user=activeSession?.user;
 if(!user?.id)return alert('Could not start the KITCH account session.');

 const base=STRIPE_PAYMENT_LINKS[plan];
 const checkoutUrl=base
   +'?client_reference_id='+encodeURIComponent(user.id)
   +'&locked_prefilled_email='+encodeURIComponent(em);

 window.location.href=checkoutUrl;
}

async function activateTestSubscription(){
 const payload=JSON.parse(sessionStorage.getItem('kitch_pending_subscription')||'null');
 if(!payload)return alert('Subscription setup expired. Start again.');
 const targetEmail=String(payload.email||'').trim().toLowerCase();

 // Never activate a new subscription inside a different customer's old session.
 let {data:{session:activeSession}}=await sb.auth.getSession();
 const signedEmail=String(activeSession?.user?.email||'').trim().toLowerCase();
 if(activeSession&&signedEmail!==targetEmail){
  await sb.auth.signOut({scope:'local'});
  activeSession=null;
  cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:null};
 }

 // Sign in first (useful when the customer already created this account).
 if(!activeSession){
  const signIn=await sb.auth.signInWithPassword({email:payload.email,password:payload.password});
  if(signIn.data?.session){
   activeSession=signIn.data.session;
  }else{
   // No valid login: create the owner account now.
   const signUp=await sb.auth.signUp({email:targetEmail,password:payload.password,options:{data:{kitch_plan:payload.plan,kitch_company:payload.company,kitch_branch:payload.branch}}});
   if(signUp.error){
    // Supabase may intentionally return a generic error for an existing account.
    const retry=await sb.auth.signInWithPassword({email:payload.email,password:payload.password});
    if(retry.data?.session)activeSession=retry.data.session;
    else return alert('Account activation failed. This email may already have an account with a different password. Use Management Sign In or use a new email for this test.');
   }else if(signUp.data?.session){
    activeSession=signUp.data.session;
   }else{
    closePublicModal();
    return publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>ACCOUNT CREATED</span></div><h2>Confirm your email</h2><div class="note"><b>Your KITCH account was created.</b><br>Supabase email confirmation is currently enabled, so a browser session cannot start until the email is confirmed.</div><p class="muted">Confirm the email from your inbox, then return to KITCH and use Management Sign In. Your selected package and company setup remain saved in this browser and the workspace will finish activating after the first confirmed sign-in.</p><button class="primary" onclick="closePublicModal();openPublicSignIn('management')">Go to Sign In</button>`);
   }
  }
 }

 if(!activeSession)return alert('Could not start the KITCH account session.');
 cloud.user=activeSession.user;

 // Clear account-specific browser cache before resolving/creating this workspace.
 const cp='kitch_cloud_'+activeSession.user.id+'_';
 localStorage.removeItem(cp+'restaurant_id');
 localStorage.removeItem(cp+'branch_id');
 cloud.restaurant_id=null;cloud.branch_id=null;cloud.workspace_code=null;

 let existing=await loadCloudWorkspace();
 if(!existing){
  const operation=payload.plan==='business'?'multi':'restaurant';
  const {error:we}=await sb.rpc('kitch_create_owner_workspace',{p_company:payload.company,p_branch:payload.branch,p_plan:payload.plan,p_operation:operation});
  if(we&&!String(we.message||'').toLowerCase().includes('already'))return alert('Account authenticated, but workspace activation failed: '+we.message);
 }
 const ready=await loadCloudWorkspace();
 if(!ready)return alert('Account is signed in, but the KITCH workspace could not be linked. Check the kitch_create_owner_workspace function in Supabase.');

 applyActivatedSubscription(payload);
 sessionStorage.removeItem('kitch_pending_subscription');
 await cloudLoadIngredients();
 currentStaff=null;
 closePublicModal();
 enter('owner');
}
async function finishActivatedLogin(){
 const ok=await loadCloudWorkspace();if(!ok)return alert('Workspace is not connected yet.');
 await cloudLoadIngredients();session='owner';currentStaff={name:cloud.user?.email||'Owner',role:'owner'};closePublicModal();login.classList.add('hidden');document.getElementById('publicLanding')?.classList.add('hidden');app.classList.remove('hidden');userName.textContent='Main Office';userRole.textContent='Owner / Main Office';ensureStructure();renderNav();openPage('Dashboard');
}
function openUpgradePrompt(){publicModal(`<h2>Add another location</h2><p class="muted">Your current Starter package includes one restaurant location.</p><div class="note"><b>Upgrade to Business</b> to add Central Store and additional restaurant branches while keeping Main Office control and location-by-location reporting.</div><button class="primary" onclick="closePublicModal();openPage('Subscription Setup')">View Upgrade</button>`)}

function subscriptionPage(){const p=packageType();if(p==='multi')return `<div class="grid"><div class="card"><span>PACKAGE</span><b style="font-size:18px">Business</b></div><div class="card"><span>STOCK FLOW</span><b style="font-size:16px">Central Store → Restaurants</b></div></div><div class="panel"><h2>Business Package Active</h2><p class="muted">This workspace has already been upgraded to Business.</p><div class="note"><b>Included:</b> All Starter features (ingredient import/export, inventory, recipes, purchasing, production, waste, reports and recaps), plus Central Store, unlimited restaurant branches, Store Team access, stock requests & transfers, branch inventory and company-wide reporting.<br><br>The Starter upgrade option is no longer shown after Business is active.</div></div>`;return `<div class="grid"><div class="card"><span>PACKAGE</span><b style="font-size:18px">Starter</b></div><div class="card"><span>STOCK FLOW</span><b style="font-size:16px">Restaurant</b></div></div><div class="panel"><h2>Starter Package</h2><p class="muted">Complete kitchen operations for one restaurant location. Includes Ingredient Master List Excel import/download, inventory, recipes, food costing, suppliers, purchasing, receiving, production, waste, stock counts, staff access, and daily / weekly / monthly / custom recaps with exports. No Central Store.</p><div class="actions"><button class="btn black" onclick="setPackage('multi')">Upgrade to Business</button></div><div class="note"><b>Business:</b> adds Central Store, additional restaurant branches, Store Team access, stock requests & transfers and company-wide reporting.</div></div>`}
async function setPackage(p){
 if(packageType()==='multi')return alert('Business is already active for this workspace.');
 if(p!=='multi')return;

 const {data:{session:activeSession}}=await sb.auth.getSession();
 if(!activeSession?.user)return alert('Please sign in again before upgrading.');

 const currentCompany=(document.querySelector('#userScope')?.textContent||'KITCH').trim()||'KITCH';
 const currentBranch=(localStorage.getItem('kitch_cloud_branch_name')||'Main Branch').trim();
 const email=String(activeSession.user.email||'').trim().toLowerCase();

 sessionStorage.setItem('kitch_pending_subscription',JSON.stringify({
   plan:'business',
   company:currentCompany,
   branch:currentBranch,
   email
 }));

 window.location.href=STRIPE_PAYMENT_LINKS.business
   +'?client_reference_id='+encodeURIComponent(activeSession.user.id)
   +'&locked_prefilled_email='+encodeURIComponent(email);
}


// MAIN OFFICE — package-aware locations, departments and staff assignment
const LOCATION_KEY='kitch_demo_locations_v2', DEPT_KEY='kitch_demo_departments_v2', STAFF_KEY='kitch_demo_staff_v2';
function scopedStaffKey(){return cloud.restaurant_id?'kitch_cloud_staff_'+cloud.restaurant_id:null}
function restoreScopedStaff(){const k=scopedStaffKey();if(!k)return;try{const rows=JSON.parse(localStorage.getItem(k)||'[]');setArr(STAFF_KEY,Array.isArray(rows)?rows:[])}catch(e){setArr(STAFF_KEY,[])}}
function saveScopedStaff(rows){setArr(STAFF_KEY,rows);const k=scopedStaffKey();if(k)localStorage.setItem(k,JSON.stringify(rows))}

function ensureStructure(){
 let loc=getArr(LOCATION_KEY), dep=getArr(DEPT_KEY), staff=getArr(STAFF_KEY), changed=false;
 if(!loc.length){
   if(hasCentralStore()){
     loc=[
       {id:'central-store',name:'Central Store',type:'Central Store',fixed:true,status:'Active'},
       {id:'branch-1',name:(localStorage.getItem('kitch_cloud_branch_name')||'Main Branch'),type:'Branch',fixed:false,status:'Active'}
     ];
   }else{
     loc=[{id:'branch-1',name:(localStorage.getItem('kitch_cloud_branch_name')||'Main Branch'),type:'Branch',fixed:false,status:'Active'}];
   }
   changed=true;
 }else{
   if(hasCentralStore()&&!loc.some(x=>x.type==='Central Store')){
     loc.unshift({id:'central-store',name:'Central Store',type:'Central Store',fixed:true,status:'Active'});changed=true;
   }
   if(!hasCentralStore()){
     loc=loc.filter(x=>x.type!=='Central Store');
     if(!loc.length)loc=[{id:'branch-1',name:(localStorage.getItem('kitch_cloud_branch_name')||'Main Branch'),type:'Branch',fixed:false,status:'Active'}];
     changed=true;
   }
 }
 if(!dep.length){
   dep=[
     {id:'dep-kitchen',name:'Kitchen',location_id:'branch-1',status:'Active'},
     {id:'dep-production',name:'Production',location_id:'branch-1',status:'Active'}
   ];
   if(hasCentralStore())dep.push({id:'dep-store',name:'Store',location_id:'central-store',status:'Active'});
   changed=true;
 }else if(hasCentralStore()&&!dep.some(x=>x.location_id==='central-store'&&String(x.name).toLowerCase()==='store')){
   dep.push({id:'dep-store',name:'Store',location_id:'central-store',status:'Active'});changed=true;
 }
 if(!hasCentralStore()){
   dep=dep.filter(x=>x.location_id!=='central-store'&&String(x.name||'').toLowerCase()!=='store');
   changed=true;
 }
 // Fresh workspace: staff is intentionally empty until Main Office creates real users.

 if(changed){setArr(LOCATION_KEY,loc);setArr(DEPT_KEY,dep)}
 return {loc,dep,staff};
}
function locations(){return ensureStructure().loc}
function departments(){return ensureStructure().dep}
function staffMembers(){return ensureStructure().staff}
function locationName(id){return locations().find(x=>String(x.id)===String(id))?.name||'—'}
function departmentName(id){return departments().find(x=>String(x.id)===String(id))?.name||'—'}

function locationsPage(){
 const {loc,dep}=ensureStructure();
 const business=hasCentralStore();
 return `<div class="grid">
 <div class="card"><span>PACKAGE</span><b style="font-size:18px">${business?'Business':'Starter'}</b></div>
 <div class="card"><span>ACTIVE LOCATIONS</span><b>${loc.filter(x=>x.status==='Active').length}</b></div>
 <div class="card"><span>BRANCHES</span><b>${loc.filter(x=>x.type==='Branch').length}</b></div>
 ${business?'<div class="card"><span>CENTRAL STORE</span><b style="font-size:18px">Active</b></div>':''}
 </div>
 <div class="panel"><h2>Locations & Departments</h2>
 <p class="muted">${business?'<b>Business</b> supports multiple restaurant locations and company-wide operations.':'Starter includes one restaurant location.'}</p>
 <div class="actions">${business?'<button class="btn black" onclick="openAddBranch()">+ Add Location</button>':'<button class="btn black" onclick="openRenameSingleBranch()">Name Branch</button>'}</div>
 <table><tr><th>LOCATION</th><th>TYPE</th><th>DEPARTMENTS</th><th>STATUS</th><th>ACTION</th></tr>
 ${loc.map(x=>`<tr><td><b>${esc(x.name)}</b>${x.fixed?'<br><small>System location</small>':''}</td><td>${esc(x.type)}</td><td>${dep.filter(d=>d.location_id===x.id&&d.status==='Active').map(d=>esc(d.name)).join(' · ')||'—'}</td><td>${x.status}</td><td>${x.fixed?'Fixed':`<button class="btn" onclick="openEditLocation('${x.id}')">Edit</button> <button class="btn" onclick="openDepartment('${x.id}')">+ Department</button>`}</td></tr>`).join('')}</table></div>`;
}
function openAddBranch(){
 modal(`<div class="modalHead"><div><div class="sub">MAIN OFFICE</div><h2>Add Branch</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="field"><label>BRANCH NAME</label><input id="locName" placeholder="e.g. Onto Cafe Jumeirah"></div>
 <div class="note">The client chooses the branch name. Staff assigned to this branch will automatically see this name in their workspace.</div>
 <button class="primary" onclick="saveBranch()">Create Branch</button>`);
}
function saveBranch(){
 const name=locName.value.trim();if(!name)return alert('Enter branch name.');
 let a=locations();if(a.some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('This location already exists.');
 const newBranch={id:'branch-'+Date.now(),name,type:'Branch',fixed:false,status:'Active'};
 a.push(newBranch);setArr(LOCATION_KEY,a);
 // New branches are created empty. No inventory, receiving, production, waste,
 // stock-count, transfer or activity records are copied from another location.
 closeModal();openPage('Locations & Departments');
}
function openEditLocation(id){
 const x=locations().find(v=>v.id===id);if(!x||x.fixed)return;
 modal(`<div class="modalHead"><h2>Edit Branch</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="field"><label>BRANCH NAME</label><input id="editLocName" value="${esc(x.name)}"></div>
 <div class="field"><label>STATUS</label><select id="editLocStatus"><option ${x.status==='Active'?'selected':''}>Active</option><option ${x.status==='Inactive'?'selected':''}>Inactive</option></select></div>
 <button class="primary" onclick="saveLocationEdit('${id}')">Save Branch</button>`);
}
function saveLocationEdit(id){
 let a=locations(),x=a.find(v=>v.id===id);if(!x)return;const name=editLocName.value.trim();if(!name)return alert('Enter branch name.');
 x.name=name;x.status=editLocStatus.value;setArr(LOCATION_KEY,a);closeModal();openPage('Locations & Departments');
}
function openRenameSingleBranch(){const x=locations().find(v=>v.type==='Branch');if(x)openEditLocation(x.id)}
function openDepartment(locationId){
 const x=locations().find(v=>v.id===locationId);if(!x)return;
 modal(`<div class="modalHead"><div><div class="sub">${esc(x.name)}</div><h2>Add Department</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="field"><label>DEPARTMENT NAME</label><input id="deptName" placeholder="e.g. Hot Kitchen"></div>
 <button class="primary" onclick="saveDepartment('${locationId}')">Add Department</button>`);
}
function saveDepartment(locationId){
 const name=deptName.value.trim();if(!name)return alert('Enter department name.');let a=departments();
 if(a.some(x=>x.location_id===locationId&&x.name.toLowerCase()===name.toLowerCase()))return alert('Department already exists in this location.');
 a.push({id:'dep-'+Date.now(),name,location_id:locationId,status:'Active'});setArr(DEPT_KEY,a);closeModal();openPage('Locations & Departments');
}

function staffAccessPage(){
 const {loc,staff}=ensureStructure();
 return `<div class="grid"><div class="card"><span>ACTIVE STAFF</span><b>${staff.filter(x=>x.status==='Active').length}</b></div><div class="card"><span>LOCATIONS</span><b>${loc.filter(x=>x.status==='Active').length}</b></div><div class="card"><span>ACCESS CONTROL</span><b style="font-size:18px">Main Office</b></div><div class="card"><span>STAFF LIMIT</span><b style="font-size:18px">Unlimited</b></div></div>
 <div class="panel"><h2>Staff & Access</h2><p class="muted">Main Office controls staff access. Deactivate blocks sign-in immediately while keeping the staff record. Delete Access removes the login record; historical production, receiving, waste and audit records remain unchanged.</p><div class="actions"><button class="btn black" onclick="openStaffAccess()">+ Create Staff Access</button><button class="btn" onclick="refreshStaffAccessFromCloud(true)">Refresh Access</button></div>
 <table><tr><th>STAFF</th><th>ROLE</th><th>LOCATION</th><th>DEPARTMENT</th><th>PIN</th><th>STATUS</th><th>ACTION</th></tr>
 ${staff.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.role)}</td><td>${esc(locationName(x.location_id)||x.location_name||'—')}</td><td>${esc(departmentName(x.department_id)||x.section||'General')}</td><td>${esc(x.pin||'••••')}</td><td><b>${esc(x.status)}</b></td><td><div class="staffActions">${x.status==='Active'?`<button class="btn" onclick="setStaffAccessActive('${esc(x.cloud_id||'')}',false,'${String(x.id).replaceAll("'","\'")}')">Deactivate</button>`:`<button class="btn success" onclick="setStaffAccessActive('${esc(x.cloud_id||'')}',true,'${String(x.id).replaceAll("'","\'")}')">Reactivate</button>`}<button class="btn danger" onclick="deleteStaffAccess('${esc(x.cloud_id||'')}','${String(x.id).replaceAll("'","\'")}','${String(x.name).replaceAll("'","\'")}')">Delete Access</button></div></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No staff access created yet.</td></tr>'}</table></div>`;
}

function staffRoleLabel(role){
 const m={kitchen_manager:'Kitchen Manager',executive_chef:'Head Chef',store_manager:'Store Manager',receiving_staff:'Receiving Staff',production_staff:'Production Staff',viewer:'Viewer / Auditor',owner:'Owner',main_office:'Main Office',operations_manager:'Operations Manager',purchasing:'Purchasing'};return m[String(role||'').toLowerCase()]||String(role||'').replaceAll('_',' ');
}
async function refreshStaffAccessFromCloud(showMessage=false){
 if(!cloud.restaurant_id)return;
 const {data,error}=await sb.rpc('kitch_owner_list_staff');
 if(error){if(showMessage)alert('Could not refresh staff access: '+error.message);return;}
 let locs=locations(),old=staffMembers();
 const rows=(data||[]).map(r=>{
   let l=locs.find(x=>String(x.cloud_id||x.id)===String(r.branch_id||''))||locs.find(x=>String(x.name||'').toLowerCase()===String(r.branch_name||'').toLowerCase());
   if(!l&&r.branch_id){l={id:'cloud-'+r.branch_id,cloud_id:r.branch_id,name:r.branch_name||'Restaurant',type:String(r.role||'').includes('store')||String(r.role||'').includes('receiving')?'Central Store':'Branch',status:'Active'};locs.push(l);}
   const previous=old.find(x=>String(x.cloud_id||'')===String(r.staff_id||''))||old.find(x=>String(x.name||'').toLowerCase()===String(r.staff_name||'').toLowerCase());
   return {id:previous?.id||('staff-'+r.staff_id),cloud_id:r.staff_id,name:r.staff_name,role:staffRoleLabel(r.role),location_id:l?.id||'',location_name:r.branch_name||'',department_id:previous?.department_id||'',section:r.section||'General',pin:previous?.pin||'',status:r.is_active?'Active':'Inactive'};
 });
 setArr(LOCATION_KEY,locs);saveScopedStaff(rows);
 if(showMessage){openPage('Staff & Access');alert('Staff access refreshed.');}
}
async function setStaffAccessActive(cloudId,isActive,localId){
 if(!cloudId)return alert('Refresh Access first so KITCH can link this staff member to the cloud record.');
 const action=isActive?'reactivate':'deactivate';
 if(!confirm(`Are you sure you want to ${action} this staff access?`))return;
 const {error}=await sb.rpc('kitch_set_staff_active',{p_staff_id:cloudId,p_is_active:isActive});
 if(error)return alert('Could not update staff access: '+error.message);
 let a=staffMembers(),x=a.find(v=>String(v.id)===String(localId));if(x)x.status=isActive?'Active':'Inactive';saveScopedStaff(a);openPage('Staff & Access');
}
async function deleteStaffAccess(cloudId,localId,name){
 if(!cloudId)return alert('Refresh Access first so KITCH can link this staff member to the cloud record.');
 if(!confirm(`Delete access for ${name}? They will no longer be able to sign in. Historical operational records will stay.`))return;
 const {error}=await sb.rpc('kitch_delete_staff_access',{p_staff_id:cloudId});
 if(error)return alert('Could not delete staff access: '+error.message);
 const a=staffMembers().filter(v=>String(v.id)!==String(localId));saveScopedStaff(a);openPage('Staff & Access');
}

async function copyWorkspaceCode(){
 let code=String(cloud.workspace_code||'').trim();
 if(!code&&cloud.user){
  // Force a fresh server lookup instead of trusting old browser data.
  const cp='kitch_cloud_'+cloud.user.id+'_';
  localStorage.removeItem(cp+'restaurant_id');localStorage.removeItem(cp+'branch_id');localStorage.removeItem(cp+'workspace_code');
  await loadCloudWorkspace();code=String(cloud.workspace_code||'').trim();
  const el=document.getElementById('staffWorkspaceCode');if(el)el.textContent=code||'Not available';
 }
 if(!code)return alert('Workspace Code is not available yet. Refresh Staff & Access and try again.');
 try{await navigator.clipboard.writeText(code);alert('Workspace Code copied: '+code);}catch(e){prompt('Copy this Workspace Code:',code);}
}

function openStaffAccess(){
 const loc=locations().filter(x=>x.status==='Active');
 modal(`<div class="modalHead"><div><div class="sub">MAIN OFFICE</div><h2>Create Staff Access</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="formGrid"><div class="field"><label>STAFF NAME</label><input id="stName"></div>
 <div class="field"><label>ROLE</label><select id="stRole" onchange="syncStaffRoleLocation()">${hasCentralStore()?'<option>Kitchen Manager</option><option>Head Chef</option><option>Store Manager</option><option>Receiving Staff</option><option>Production Staff</option><option>Kitchen Staff</option><option>Viewer / Auditor</option>':'<option>Kitchen Manager</option><option>Head Chef</option><option>Production Staff</option><option>Kitchen Staff</option><option>Viewer / Auditor</option>'}</select></div>
 <div class="field"><label>LOCATION</label><select id="stLocation" onchange="refreshStaffDepartments()">${loc.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
 <div class="field"><label>DEPARTMENT</label><select id="stDepartment"></select></div>
 <div class="field"><label>4-DIGIT PIN</label><input id="stPin" inputmode="numeric" maxlength="4" placeholder="e.g. 4821"></div></div>
 <div class="note">Assign one role per person. Kitchen Manager and Head Chef have identical access. Production Staff and Kitchen Staff can request supplies; only managers approve and send. The Owner monitors activity from Main Office. The assigned location controls staff access.</div><button class="primary" onclick="saveStaffAccess()">Create Access</button>`);
 syncStaffRoleLocation();
}
function syncStaffRoleLocation(){
 const role=document.getElementById('stRole')?.value,loc=document.getElementById('stLocation');if(!loc)return;
 const storeRole=role==='Store Manager'||role==='Receiving Staff',central=locations().find(x=>x.type==='Central Store'&&x.status==='Active');
 if(storeRole&&central){loc.value=central.id;loc.disabled=true;}else{loc.disabled=false;if(loc.value==='central-store'){const b=locations().find(x=>x.type==='Branch'&&x.status==='Active');if(b)loc.value=b.id;}}
 refreshStaffDepartments();
}
function refreshStaffDepartments(){
 const id=document.getElementById('stLocation')?.value, el=document.getElementById('stDepartment');if(!el)return;
 const d=departments().filter(x=>x.location_id===id&&x.status==='Active');el.innerHTML=d.length?d.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(''):'<option value="">General</option>';
}
async function saveStaffAccess(){
 const name=stName.value.trim(),pin=stPin.value.trim();if(!name)return alert('Enter staff name.');if(!/^\d{4}$/.test(pin))return alert('Enter a 4-digit PIN.');
 let a=staffMembers();if(a.some(x=>x.pin===pin))return alert('This PIN is already in use.');
 if(!(await ensureCloudWorkspace()))return alert('Management cloud session is required to create staff access.');
 const roleMap={'Kitchen Manager':'kitchen_manager','Head Chef':'executive_chef','Store Manager':'store_manager','Receiving Staff':'receiving_staff','Production Staff':'production_staff','Kitchen Staff':'production_staff','Viewer / Auditor':'viewer'};
 const selectedLocation=locations().find(x=>String(x.id)===String(stLocation.value));
 const storeRole=stRole.value==='Store Manager'||stRole.value==='Receiving Staff';
 // Store staff belongs to the Central Store scope. Restaurant staff belongs to the selected branch.
 // Existing backends may not yet have a cloud branch row for a newly-added local branch, so only
 // pass the authenticated owner branch for restaurant roles; never pass that restaurant branch to Store roles.
 const rpcBranchId=storeRole?null:cloud.branch_id;
 let {data,error}=await sb.rpc('kitch_create_staff',{p_restaurant_id:cloud.restaurant_id,p_branch_id:rpcBranchId,p_staff_name:name,p_role:roleMap[stRole.value],p_section:departmentName(stDepartment.value)||'General',p_pin:pin});
 if(error&&String(error.message||'').toLowerCase().includes('only main office')){
   // Upgrade compatibility: refresh the authenticated workspace once so an old Starter cache
   // cannot be used for a Business staff write.
   if(cloud.user?.id){const cp='kitch_cloud_'+cloud.user.id+'_';localStorage.removeItem(cp+'restaurant_id');localStorage.removeItem(cp+'branch_id');}
   await loadCloudWorkspace();
   ({data,error}=await sb.rpc('kitch_create_staff',{p_restaurant_id:cloud.restaurant_id,p_branch_id:rpcBranchId,p_staff_name:name,p_role:roleMap[stRole.value],p_section:departmentName(stDepartment.value)||'General',p_pin:pin}));
 }
 if(error)return alert('Could not create cloud staff access: '+error.message);
 a.push({id:'staff-'+Date.now(),cloud_id:(typeof data==='string'?data:(data?.staff_id||data?.id||'')),name,role:stRole.value,location_id:stLocation.value,department_id:stDepartment.value,pin,status:'Active'});saveScopedStaff(a);closeModal();openPage('Staff & Access');
 alert('Staff access created. Give the team member their Staff Name and 4-digit PIN.');
}

const ING_KEY='kitch_demo_ingredients_v1';
function ingredients(){try{return JSON.parse(localStorage.getItem(ING_KEY)||'[]')}catch(e){return[]}} function sortedIngredients(){return ingredients().map(x=>({...x,receiving_type:correctedReceivingType(x.name,x.receiving_type)})).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'}))} function receivingTypeLabel(v){return String(v||'').trim()==='Ambient'?'Room Temperature':(String(v||'').trim()||'Room Temperature')}
function correctedReceivingType(name,current){
 const n=String(name||'').trim().toLowerCase();
 const c=receivingTypeLabel(current);
 // Correct obvious temperature-controlled foods when an older template/default marks them Room Temperature.
 const frozen=['shrimp peeled'];
 const chilled=['chicken breast','salmon fillet','beef striploin','halloumi cheese','greek yogurt','eggs','feta cheese','milk','lettuce','cucumber'];
 if(frozen.includes(n) && c==='Room Temperature') return 'Frozen';
 if(chilled.includes(n) && c==='Room Temperature') return 'Chilled';
 return c;
} function openIngredientSelect(el){/* Keep the browser's normal compact dropdown. It scrolls smoothly in both directions. */} function closeIngredientSelect(el){/* Native select closes normally. */}
function saveIngredients(a){localStorage.setItem(ING_KEY,JSON.stringify(a))}
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function unit(v){let x=String(v||'').trim().toLowerCase();if(['kilogram','kilograms','kgs'].includes(x))return'kg';if(['gram','grams','gm'].includes(x))return'g';if(['litre','liter','litres','liters','l'].includes(x))return'ltr';if(['millilitre','milliliter','millilitres','milliliters'].includes(x))return'ml';if(['pc','piece','pieces','unit','units'].includes(x))return'pcs';return x||'kg'}
function canonicalUnit(u){u=unit(u);return u==='kg'||u==='g'?'g':u==='ltr'||u==='ml'?'ml':'pcs'}
function toCanonical(q,u){u=unit(u);q=Number(q||0);if(u==='kg'||u==='ltr')return q*1000;return q}
function fromCanonical(q,u){u=unit(u);q=Number(q||0);if(u==='kg'||u==='ltr')return q/1000;return q}
function compatibleUnits(a,b){return canonicalUnit(a)===canonicalUnit(b)}
function displayStock(x){return fromCanonical(contextStockCanonical(x),x.base_unit)}
// Inventory table formatting only: stored quantities and costs remain unchanged.
function kitchQuantityLabel(canonical,base){
 const u=canonicalUnit(base),q=Number(canonical||0);
 const fmt=n=>Number(n.toFixed(3)).toLocaleString('en-US',{maximumFractionDigits:3});
 if(u==='g')return Math.abs(q)>=1000?fmt(q/1000)+' kg':fmt(q)+' g';
 if(u==='ml')return Math.abs(q)>=1000?fmt(q/1000)+' L':fmt(q)+' ml';
 return fmt(q)+' pcs';
}
// Legacy Excel masters store PAR in grams/ml and often cost per gram/ml,
// even when the display base unit says kg/L. Normalize for DISPLAY only.
function kitchLegacyParCanonical(x){
 const n=Number(x.par||0),u=unit(x.base_unit);
 if((u==='kg'||u==='ltr')&&n>=1000)return n;
 return toCanonical(n,x.base_unit);
}
function kitchSupplierPrice(x,field){
 const n=Number((x[field]??(field==='latest_cost'?x.cost:0))||0);
 const u=unit(x.base_unit);
 // CSV unit prices are per g or ml when base unit is g/ml.
 // Convert to supplier purchase price per kg or L for display and valuation.
 if(u==='g'||u==='ml')return n*1000;
 // Backward compatibility with older imports saved as kg/L with per-g/ml prices.
 // All costs are per explicitly stored base unit.
 return n;
}
function kitchCostLabel(price,base){
 const n=Number(price||0),u=unit(base),suffix=(u==='kg'||u==='g')?'kg':(u==='ltr'||u==='ml')?'L':'pc';
 const amount=(u==='g'||u==='ml')?n*1000:n;
 return n>0?'AED '+amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'/'+suffix:'—';
}
function kitchStockValue(x){
 if(teamCloudAuth?.staff_name && window.__kitchTeamLiveStock instanceof Map && x.cloud_id){
   return Number(window.__kitchTeamLiveStock.get(String(x.cloud_id))?.value||0);
 }
 const q=Number(contextStockCanonical(x)||0),u=canonicalUnit(x.base_unit);
 const price=kitchSupplierPrice(x,'latest_cost')||kitchSupplierPrice(x,'reference_cost');
 return (u==='g'||u==='ml'?q/1000:q)*price;
}
function inventoryPage(){
 if(window.__kitchInventoryLoadError)return `<div class="note"><b>Live inventory unavailable:</b> ${esc(window.__kitchInventoryLoadError)}. No stock has been changed. Please check the browser console or access policy.</div>`;
 const a=ingredients().slice().sort((x,y)=>x.name.localeCompare(y.name,undefined,{sensitivity:'base'})),manage=session==='manager',storeMaster=hasCentralStore()&&session==='store';
 const emptyStoreNotice=window.__kitchInventoryEmptyLocation?'<div class="note"><b>No saved stock for this location.</b> Import opening quantities using Upload / Import Excel, or record a delivery in Receiving.</div>':'';
 const rows=a.map(x=>{const qty=contextStockCanonical(x);const status=qty<=0?'OUT / NOT ENTERED':fromCanonical(qty,x.base_unit)<Number(x.minimum||0)?'LOW':'OK';const latest=Number(x.latest_cost)>0?x.latest_cost:x.reference_cost;const edit=(manage||storeMaster)?'<button class="btn" onclick="openEditIngredient(&quot;'+esc(x.sku)+'&quot;)">Edit</button>':'—';return `<tr class="ingredientRow" data-name="${esc(x.name.toLowerCase())}" data-category="${esc((x.category||'').toLowerCase())}"><td>${esc(x.sku)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.supplier||'—')}</td><td>${esc(correctedReceivingType(x.name,x.receiving_type))}</td><td>${esc(x.base_unit)}</td><td>${kitchQuantityLabel(qty,x.base_unit)}</td><td>${kitchQuantityLabel(kitchLegacyParCanonical(x),x.base_unit)}</td><td>${kitchCostLabel(x.reference_cost,x.base_unit)}</td><td>${kitchCostLabel(latest,x.base_unit)}</td><td>AED ${kitchStockValue(x).toFixed(2)}</td><td>${esc(status)}</td><td>${edit}</td></tr>`;}).join('');
 return `<div class="kitchInventory">${emptyStoreNotice}<div class="grid"><div class="card"><span>ACTIVE INGREDIENTS</span><b>${a.length}</b></div><div class="card"><span>LOW / OUT</span><b>${a.filter(x=>fromCanonical(contextStockCanonical(x),x.base_unit)<=Number(x.minimum||0)).length}</b></div><div class="card"><span>INVENTORY VALUE</span><b>AED ${a.reduce((t,x)=>t+kitchStockValue(x),0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div><div class="card"><span>PAR CONTROL</span><b>${a.filter(x=>Number(x.par)>0).length}</b></div></div>
 <div class="panel"><h2>Ingredient Master & Inventory</h2><p class="muted"><b>Stock Location: ${esc(hasCentralStore()?(session==='store'?'Central Store':assignedLocationName()):assignedLocationName())}</b> · ${manage?'Kitchen Manager / Executive Chef manages the approved Ingredient Master.':storeMaster?'Central Store Manager manages the approved company Ingredient Master.':hasCentralStore()&&session==='manager'?'Branch Kitchen Manager uses the approved company Ingredient Master.':'Team can view and download the approved Ingredient Master.'}</p>
 <div class="actions">${(manage||storeMaster)?'<button class="btn black" onclick="openIngredient()">+ Ingredient</button>':''}${(manage||storeMaster||session==='manager')?'<button class="btn" onclick="openImport()">Upload / Import Excel</button>':''}${hasCentralStore()&&session==='manager'?'<button class="btn black" onclick="openBranchOpeningStock()">Set Restaurant Opening Stock</button>':''}<button class="btn" onclick="downloadMaster()">Download Master List</button></div>
 <div style="margin-top:18px"><input id="ingredientSearch" oninput="filterIngredients()" placeholder="Search ingredient..." style="width:min(430px,100%);height:48px;border:1px solid #ddd;border-radius:999px;padding:0 18px;font:inherit"></div>
 <div class="inventoryTableWrap"><table><tr><th>SKU</th><th>INGREDIENT</th><th>SUPPLIER</th><th>RECEIVING TYPE</th><th>BASE UNIT</th><th>STOCK</th><th>PAR</th><th>REFERENCE COST</th><th>LATEST COST</th><th>STOCK VALUE</th><th>STATUS</th><th>ACTION</th></tr>${rows||'<tr><td colspan="12" class="empty">No ingredients yet. Import your Excel master list or add an ingredient.</td></tr>'}</table></div></div></div>`;
}

let kitchOpeningRows=[];
function openBranchOpeningStock(){
 if(session!=='manager')return;
 const a=sortedIngredients();if(!a.length)return alert('Import Ingredient Master first.');
 kitchOpeningRows=a.map(x=>({x,qty:fromCanonical(contextStockCanonical(x),x.base_unit),cost:Number(x.latest_cost||x.reference_cost||x.cost||0)}));
 modal(`<div class="modalHead"><div><div class="sub">BRANCH STOCK · CLOUD SAVE</div><h2>Restaurant Opening Stock</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="note"><b>${esc(currentBranchName())}</b> · Enter the existing stock for each ingredient, or upload an Excel file. Quantities are absolute opening balances (not added to existing stock). Saving writes to Supabase.</div>
 <label class="filePick"><b>Import Opening Stock Excel</b><div class="muted">Ingredient Name + Opening Stock + Opening Unit Cost AED (optional)</div><input type="file" accept=".xlsx,.xls,.csv" onchange="kitchOpeningExcel(this.files[0])" style="margin-top:12px;max-width:100%"></label>
 <div style="max-height:46vh;overflow:auto"><table><thead><tr><th>INGREDIENT</th><th>UNIT</th><th>OPENING QTY</th><th>UNIT COST AED</th></tr></thead><tbody id="kitchOpeningTable"></tbody></table></div>
 <div id="kitchOpeningStatus" class="note">Review quantities before saving.</div><button id="kitchOpeningSave" class="primary" onclick="saveBranchOpeningStock()">Save All Opening Stock to Cloud</button>`);
 kitchRenderOpeningRows();
}
function kitchRenderOpeningRows(){
 const body=document.getElementById('kitchOpeningTable');if(!body)return;
 body.innerHTML=kitchOpeningRows.map((r,i)=>`<tr><td><b>${esc(r.x.name)}</b></td><td>${esc(r.x.base_unit)}</td><td><input aria-label="Opening quantity ${esc(r.x.name)}" type="number" min="0" step="any" value="${r.qty}" oninput="kitchOpeningRows[${i}].qty=Number(this.value)" style="width:115px;padding:9px;border:1px solid #ddd;border-radius:9px"></td><td><input aria-label="Opening cost ${esc(r.x.name)}" type="number" min="0" step="any" value="${r.cost}" oninput="kitchOpeningRows[${i}].cost=Number(this.value)" style="width:115px;padding:9px;border:1px solid #ddd;border-radius:9px"></td></tr>`).join('');
}
async function kitchOpeningExcel(file){
 if(!file)return;
 if(typeof XLSX==='undefined')return alert('Excel reader unavailable. Check internet connection.');
 try{
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),ws=wb.Sheets[wb.SheetNames.includes('Ingredient Master')?'Ingredient Master':wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});let matched=0;
  for(const row of rows){
   const pick=(keys)=>{for(const key of keys){const found=Object.keys(row).find(k=>k.trim().toLowerCase()===key.toLowerCase());if(found&&row[found]!==''&&row[found]!=null)return row[found]}return null};
   const name=String(pick(['Ingredient Name','Ingredient','Name'])||'').trim().toLowerCase();
   const r=kitchOpeningRows.find(v=>v.x.name.trim().toLowerCase()===name);if(!r)continue;
   const q=pick(['Opening Stock','Opening Quantity','Opening Qty','Quantity']);
   const c=pick(['Opening Unit Cost AED','Opening Cost AED','Unit Cost AED']);
   if(q!==null){if(!Number.isFinite(Number(q))||Number(q)<0)throw Error('Invalid quantity for '+r.x.name);r.qty=Number(q);matched++}
   if(c!==null){if(!Number.isFinite(Number(c))||Number(c)<0)throw Error('Invalid cost for '+r.x.name);r.cost=Number(c)}
  }
  kitchRenderOpeningRows();document.getElementById('kitchOpeningStatus').textContent=matched+' ingredients matched from Excel. Review and click Save All.';
 }catch(e){alert('Excel import failed: '+e.message)}
}
async function saveBranchOpeningStock(){
 const btn=document.getElementById('kitchOpeningSave'),status=document.getElementById('kitchOpeningStatus');
 if(!btn||btn.disabled)return;
 if(kitchOpeningRows.some(r=>!Number.isFinite(r.qty)||r.qty<0||!Number.isFinite(r.cost)||r.cost<0))return alert('Opening quantities and costs must be valid nonnegative numbers.');
 if(!confirm('Replace opening balances for '+currentBranchName()+' with '+kitchOpeningRows.length+' ingredient quantities?'))return;
 btn.disabled=true;btn.textContent='Saving to cloud…';
 try{
  if(teamCloudAuth?.pin)throw Error('Opening stock requires the authenticated Main Office owner login, not a staff PIN.');
  if(!cloud.restaurant_id||!cloud.branch_id){if(!await ensureCloudWorkspace())throw Error('Sign in as the owner again.');}
  const branchId=currentBranch()?.cloud_id||cloud.branch_id;
  const rows=kitchOpeningRows.map(r=>{
   if(!r.x.cloud_id)throw Error('Missing cloud ingredient ID: '+r.x.name);
   return {ingredient_id:r.x.cloud_id,unit:r.x.base_unit,quantity:r.qty,cost:r.cost};
  });
  const {data,error}=await sb.rpc('kitch_save_opening_stock',{p_restaurant_id:cloud.restaurant_id,p_branch_id:branchId,p_rows:rows});
  if(error)throw Error(error.message||'Opening stock save failed');
  if(Number(data)!==rows.length)throw Error('Only '+data+' of '+rows.length+' balances were saved.');
  await cloudLoadIngredients();
  if(window.__kitchInventoryLoadError)throw Error('Saved, but reload failed: '+window.__kitchInventoryLoadError);
  const {data:verified,error:verifyError}=await sb.from('inventory_balances').select('ingredient_id,quantity_on_hand').eq('restaurant_id',cloud.restaurant_id).eq('branch_id',branchId);
  if(verifyError)throw Error('Saved but readback permission failed: '+verifyError.message);
  const byId=new Map((verified||[]).map(x=>[String(x.ingredient_id),Number(x.quantity_on_hand)]));
  for(const r of rows){if(Math.abs((byId.get(String(r.ingredient_id))??NaN)-r.quantity)>0.000001)throw Error('Cloud verification failed for '+r.ingredient_id);}
  closeModal();openPage('Inventory');alert('Opening stock saved and verified for '+rows.length+' ingredients.');
 }catch(e){status.textContent='Opening stock was not fully verified: '+e.message;console.error('Opening stock save',e)}
 finally{btn.disabled=false;btn.textContent='Save All Opening Stock to Cloud';}
}

let __kitchModalScrollY=0;
function modal(body){
 if(!document.body.classList.contains('modal-open')){
  __kitchModalScrollY=window.scrollY||document.documentElement.scrollTop||0;
  document.body.style.top=`-${__kitchModalScrollY}px`;
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
 }
 document.body.insertAdjacentHTML('beforeend',`<div id="modal" class="modal"><div class="modalBox">${body}</div></div>`);
}
function closeModal(){
 document.getElementById('modal')?.remove();
 document.documentElement.classList.remove('modal-open');
 document.body.classList.remove('modal-open');
 document.body.style.top='';
 window.scrollTo(0,__kitchModalScrollY||0);
}
function openIngredient(){
 if(session!=='manager' && !(session==='store'&&hasCentralStore()))return;
 modal(`<div class="modalHead"><h2>Add Ingredient</h2><button class="close" onclick="closeModal()">×</button></div><div class="formGrid">
 <div class="field"><label>INGREDIENT NAME</label><input id="iName"></div><div class="field"><label>CATEGORY</label><input id="iCat"></div><div class="field"><label>DEFAULT SUPPLIER</label><input id="iSupplier" placeholder="Supplier name"></div>
 <div class="field"><label>RECEIVING TYPE</label><select id="iReceivingType"><option>Room Temperature</option><option>Chilled</option><option>Frozen</option></select></div>
 <div class="field"><label>BASE UNIT</label><select id="iUnit"><option>kg</option><option>g</option><option>ltr</option><option>ml</option><option>pcs</option></select></div>
 <div class="field"><label>UNIT COST AED</label><input id="iCost" type="number" min="0" step=".01"></div>
 <div class="field"><label>PAR TARGET</label><input id="iPar" type="number" min="0" step=".01"></div><div class="field"><label>MINIMUM STOCK</label><input id="iMin" type="number" min="0" step=".01"></div></div>
 <div class="note">Current stock starts at 0. Stock will increase later through Receiving.</div><button class="primary" onclick="saveIngredient()">Create Ingredient</button>`);
}
async function saveIngredient(){
 const name=iName.value.trim();if(!name)return alert('Enter ingredient name.');
 let a=ingredients();if(a.some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('This ingredient already exists.');
 let x={sku:'ING-'+String(a.length+1).padStart(3,'0'),name,category:iCat.value.trim(),supplier:iSupplier.value.trim(),receiving_type:iReceivingType.value||'Room Temperature',base_unit:iUnit.value,cost:Number(iCost.value||0),reference_cost:Number(iCost.value||0),latest_cost:Number(iCost.value||0),par:Number(iPar.value||0),minimum:Number(iMin.value||0),stock:0,stock_canonical:0,stock_location:stockLocation()};
 try{await cloudUpsertIngredient(x);a.push(x);saveIngredients(a);closeModal();openPage('Inventory')}catch(e){alert('KITCH Cloud: '+e.message)}
}
function openEditIngredient(sku){
 const x=ingredients().find(i=>i.sku===sku);if(!x)return;
 modal(`<div class="modalHead"><h2>Edit Ingredient</h2><button class="close" onclick="closeModal()">×</button></div><div class="formGrid"><div class="field"><label>INGREDIENT</label><input id="eiName" value="${esc(x.name)}"></div><div class="field"><label>DEFAULT SUPPLIER</label><input id="eiSupplier" value="${esc(x.supplier||'')}" placeholder="Supplier name"></div><div class="field"><label>RECEIVING TYPE</label><select id="eiReceivingType"><option ${receivingTypeLabel(x.receiving_type)==='Room Temperature'?'selected':''}>Room Temperature</option><option ${receivingTypeLabel(x.receiving_type)==='Chilled'?'selected':''}>Chilled</option><option ${receivingTypeLabel(x.receiving_type)==='Frozen'?'selected':''}>Frozen</option></select></div><div class="field"><label>REFERENCE COST AED</label><input id="eiCost" type="number" min="0" step=".01" value="${Number(x.reference_cost!=null?x.reference_cost:x.cost||0).toFixed(2)}"></div><div class="field"><label>PAR TARGET</label><input id="eiPar" type="number" min="0" step=".01" value="${Number(x.par||0)}"></div><div class="field"><label>MINIMUM STOCK</label><input id="eiMin" type="number" min="0" step=".01" value="${Number(x.minimum||0)}"></div></div><div class="note">Supplier and Receiving Type are editable at any time. Temperature can still be entered manually during Receiving for every item; it is mandatory only for Chilled and Frozen items.</div><button class="primary" onclick="saveEditIngredient('${esc(x.sku)}')">Save Changes</button>`);
}
async function saveEditIngredient(sku){let a=ingredients(),x=a.find(i=>i.sku===sku);if(!x)return;const newName=eiName.value.trim();if(!newName)return alert('Enter ingredient name.');if(a.some(i=>i!==x&&i.name.toLowerCase()===newName.toLowerCase()))return alert('Ingredient already exists.');x.name=newName;x.supplier=eiSupplier.value.trim();x.receiving_type=eiReceivingType.value||'Room Temperature';x.reference_cost=Number(eiCost.value||0);x.par=Number(eiPar.value||0);x.minimum=Number(eiMin.value||0);try{await cloudUpsertIngredient(x)}catch(e){return alert('KITCH Cloud: '+e.message)}saveIngredients(a);closeModal();openPage('Inventory')}
async function archiveIngredient(sku){
 if(session!=='manager'||teamCloudAuth?.staff_name)return alert('Only an authenticated Main Office manager can delete ingredients.');
 const a=ingredients(),x=a.find(i=>i.sku===sku);if(!x)return;
 if(!confirm('Archive '+x.name+' from the Ingredient Master? Historical records will be kept.'))return;
 try{
  if(!cloud.restaurant_id)await ensureCloudWorkspace();
  if(!x.cloud_id)throw new Error('Ingredient is not linked to the cloud. Refresh the page and retry.');
  const {error}=await sb.from('ingredients').update({is_active:false}).eq('id',x.cloud_id).eq('restaurant_id',cloud.restaurant_id);
  if(error)throw error;
  saveIngredients(a.filter(i=>i.sku!==sku));openPage('Inventory');
 }catch(e){alert('Could not archive ingredient: '+e.message)}
}
function openImport(){
 if(session!=='manager' && session!=='store')return;
 modal(`<div class="modalHead"><h2>Import Ingredient Master</h2><button class="close" onclick="closeModal()">×</button></div><p class="muted">Choose the KITCH ingredient Excel. Nothing is imported until you confirm the preview.</p><label class="filePick"><b>Choose Excel file</b><br><small>.xlsx, .xls or .csv</small><input id="excelFile" type="file" accept=".xlsx,.xls,.csv" hidden onchange="readExcel(this.files[0])"></label><div id="preview"></div>`);
}
let importRows=[];
async function readExcel(file){
 if(!file)return;if(typeof XLSX==='undefined')return preview.innerHTML='<div class="note bad">Excel reader could not load. Check your internet connection and reopen the file.</div>';
 try{
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheetName=wb.SheetNames.includes('Ingredient Master')?'Ingredient Master':wb.SheetNames[0],ws=wb.Sheets[sheetName],rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  const pick=(o,names)=>{for(const n of names)if(Object.prototype.hasOwnProperty.call(o,n))return o[n];return''};
  importRows=rows.map(r=>{const ref=Number(pick(r,['Reference Cost AED','Last Unit Cost AED','Unit Cost AED','Latest Price AED'])||0),open=Number(pick(r,['Opening Stock','Opening Quantity'])||0),openCost=Number(pick(r,['Opening Unit Cost AED','Opening Cost AED'])||ref||0);return {_importOpening:String(pick(r,['Opening Stock','Opening Quantity'])).trim()!=='',name:String(pick(r,['Ingredient Name','Ingredient'])).trim(),category:String(pick(r,['Category'])).trim(),supplier:String(pick(r,['Supplier','Supplier Name','Default Supplier'])).trim(),base_unit:unit(pick(r,['Base Unit'])),cost:openCost||ref,reference_cost:ref,opening_stock:open,opening_unit_cost:openCost,par:Number(pick(r,['PAR Target Stock','PAR Level','PAR'])||0),minimum:Number(pick(r,['Minimum Stock','Min Stock'])||0),receiving_type:correctedReceivingType(String(pick(r,['Ingredient Name','Ingredient','Name'])||'').trim(),String(pick(r,['Receiving Type','Storage Type'])||'Room Temperature').trim()||'Room Temperature')}}).filter(x=>x.name);
  const existing=ingredients();
  // Import preview only: raw Excel amounts are in grams or millilitres.
  const shortImportQty=(value,base)=>{
    const n=Number(value||0);
    if(!Number.isFinite(n))return '—';
    const liquid=['l','ltr','liter','litre','ml'].includes(String(base||'').toLowerCase());
    const fmt=v=>Number(v.toFixed(3)).toString();
    return n>=1000?fmt(n/1000)+(liquid?' L':' kg'):fmt(n)+(liquid?' ml':' g');
  };
  preview.innerHTML=`<div class="note"><b>${importRows.length} ingredients found.</b> Choose whether to update existing items or replace the active list. Replacement archives ingredients missing from the Excel, without deleting stock history.</div><div class="field"><label>IMPORT MODE</label><select id="kitchImportMode" onchange="kitchImportModeChanged()" style="width:100%;height:48px;border:1px solid #ddd;border-radius:12px;padding:0 12px"><option value="update">Update / add ingredients</option>${teamCloudAuth?.pin?'':'<option value="replace">Replace active ingredient list ('+importRows.length+' ingredients)</option>'}</select></div><div id="kitchImportWarning" class="note" style="display:none;background:#fff6e7">This will archive all existing ingredients not in the uploaded Excel. Historical stock movements remain stored. Review the list before continuing.</div><div style="max-height:320px;overflow:auto"><table><tr><th>INGREDIENT</th><th>CATEGORY</th><th>SUPPLIER</th><th>RECEIVING TYPE</th><th>UNIT</th><th>OPENING STOCK</th><th>OPENING COST</th><th>PAR</th><th>MIN</th><th>RESULT</th></tr>${importRows.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.category)}</td><td>${esc(x.supplier||'—')}</td><td>${esc(correctedReceivingType(x.name,x.receiving_type))}</td><td>${esc(x.base_unit)}</td><td>${Number(x.opening_stock||0)}</td><td>AED ${Number(x.opening_unit_cost||x.cost||0).toFixed(2)}</td><td>${shortImportQty(x.par,x.base_unit)}</td><td>${shortImportQty(x.minimum,x.base_unit)}</td><td>${existing.some(e=>e.name.toLowerCase()===x.name.toLowerCase())?'<span class="warn">UPDATE</span>':'<span class="ok">NEW</span>'}</td></tr>`).join('')}</table></div><button class="primary" onclick="confirmImport()">Import ${importRows.length} Ingredients</button>`;
 }catch(e){preview.innerHTML='<div class="note bad">Could not read this Excel file.</div>'}
}
function kitchImportModeChanged(){const mode=document.getElementById('kitchImportMode')?.value;const warning=document.getElementById('kitchImportWarning');if(warning)warning.style.display=mode==='replace'?'block':'none';}
let ingredientImportBusy=false;
async function confirmImport(){
 if(ingredientImportBusy)return;
 if(!importRows.length)return alert('Choose an Excel file first.');
 const replaceMode=document.getElementById('kitchImportMode')?.value==='replace';
 if(replaceMode&&teamCloudAuth?.pin)return alert('Use Update / add ingredients with staff access. Full-list replacement requires owner access.');
 document.getElementById('ingredientImportStatus')?.remove();
 if(replaceMode&&!confirm('Replace active ingredient list with '+importRows.length+' Excel ingredients? Missing ingredients will be archived, not deleted.'))return;
 ingredientImportBusy=true;
 const button=document.querySelector('#preview button.primary');
 const total=importRows.length;
 let added=0,updated=0,completed=0;
 const a=ingredients();
 const status=document.createElement('div');
 status.id='ingredientImportStatus';
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 status.style.cssText='margin:14px 0;padding:14px;background:#f5f5f2;border-radius:14px;font-size:13px';
 status.innerHTML='<b>Preparing secure import…</b><div style="height:8px;background:#ddd;border-radius:9px;overflow:hidden;margin-top:10px"><div id="ingredientImportBar" style="height:100%;width:0%;background:#111;transition:width .18s ease"></div></div><div id="ingredientImportCount" style="margin-top:8px;color:#666">0 / '+total+' ingredients</div>';
 if(button){button.disabled=true;button.style.opacity='.65';button.textContent='Importing…';button.before(status)}
 const updateProgress=()=>{
  const bar=document.getElementById('ingredientImportBar');
  const count=document.getElementById('ingredientImportCount');
  if(bar)bar.style.width=Math.round(completed/total*100)+'%';
  if(count)count.textContent=completed+' / '+total+' ingredients saved';
  if(button)button.textContent='Importing '+completed+' / '+total+'…';
 };
 try{
  if(!teamCloudAuth?.pin){
   const ok=await ensureCloudWorkspace();
   if(!ok||!cloud.restaurant_id)throw new Error('Management workspace is not loaded. Sign in again.');
  }
  for(const x0 of importRows){
   const e=a.find(z=>z.name.toLowerCase()===x0.name.toLowerCase());
   if(e){
    const candidate={...e,...x0,stock:e.stock,stock_canonical:e.stock_canonical,branch_stock_canonical:e.branch_stock_canonical,restaurant_stock_canonical:e.restaurant_stock_canonical,opening_stock:x0._importOpening?x0.opening_stock:e.opening_stock,opening_unit_cost:x0._importOpening?x0.opening_unit_cost:e.opening_unit_cost,stock_location:e.stock_location||assignedLocationName()};
    await cloudUpsertIngredient(candidate);
    Object.assign(e,candidate);updated++;
   }else{
    const x={...x0,sku:'ING-'+String(a.length+1).padStart(3,'0'),stock:Number(x0.opening_stock||0),stock_canonical:toCanonical(Number(x0.opening_stock||0),x0.base_unit),stock_location:assignedLocationName()};
    await cloudUpsertIngredient(x);
    a.push(x);added++;
   }
   completed++;
   saveIngredients(a);
   updateProgress();
   // Yield to the browser periodically so progress and controls stay responsive.
   if(completed%5===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(replaceMode){
   // Never claim replacement succeeded unless the cloud database was updated.
   const keepNames=importRows.map(x=>x.name.trim().toLowerCase());
   if(teamCloudAuth?.pin){
    const response=await sb.rpc('kitch_team_archive_missing_ingredients',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_keep_names:importRows.map(x=>x.name)});
    if(response.error)throw new Error('Ingredients imported, but cloud archiving was not completed: '+response.error.message);
   }else{
    const {data:cloudItems,error:listError}=await sb.from('ingredients').select('id,name').eq('restaurant_id',cloud.restaurant_id).eq('is_active',true);
    if(listError)throw new Error('Could not check existing cloud ingredients: '+listError.message);
    const missing=(cloudItems||[]).filter(x=>!keepNames.includes(String(x.name||'').trim().toLowerCase()));
    for(const item of missing){const {error}=await sb.from('ingredients').update({is_active:false}).eq('id',item.id).eq('restaurant_id',cloud.restaurant_id);if(error)throw new Error('Cloud archiving failed: '+error.message);}
   }
   const keepSet=new Set(keepNames);
   for(let i=a.length-1;i>=0;i--)if(!keepSet.has(a[i].name.trim().toLowerCase()))a.splice(i,1);
   saveIngredients(a);
  }
  await cloudLoadIngredients();
  if(window.__kitchInventoryLoadError)throw Error('Imported, but stock could not reload: '+window.__kitchInventoryLoadError);
  if(teamCloudAuth?.pin){
   for(const row of importRows.filter(x=>x._importOpening&&x.opening_stock>0)){
    const saved=ingredients().find(x=>x.name.toLowerCase()===row.name.toLowerCase());
    if(!saved||!(contextStockCanonical(saved)>0))throw Error('Opening stock was not saved for '+row.name);
   }
  }
  syncSupplierMasterFromIngredients();
  importRows=[];
  if(status)status.innerHTML='<b style="color:#26733a">✓ Import complete</b><div style="margin-top:6px">'+added+' added · '+updated+' updated</div>';
  if(button){button.textContent='Import complete';button.style.opacity='1'}
  await new Promise(resolve=>setTimeout(resolve,650));
  closeModal();openPage('Inventory');
 }catch(e){
  if(status)status.innerHTML='<b style="color:#b42318">Import stopped after '+completed+' of '+total+' ingredients.</b><div style="margin-top:6px">'+esc(String(e.message||e))+'</div><div style="margin-top:6px">Saved items are kept. Check the connection and retry; matching ingredient names will be updated.</div>';
  if(button){button.textContent='Retry import';button.style.opacity='1'}
 }finally{
  ingredientImportBusy=false;
  if(button)button.disabled=false;
 }
}

function downloadMaster(){
 const a=ingredients();if(!a.length)return alert('Ingredient Master is empty.');
 if(typeof XLSX==='undefined')return alert('Excel export needs an internet connection.');
 const data=a.map(x=>({'SKU':x.sku,'Ingredient Name':x.name,'Category':x.category,'Supplier':x.supplier||'','Receiving Type':receivingTypeLabel(x.receiving_type),'Base Unit':x.base_unit,'Reference Cost AED':Number(x.reference_cost||x.cost||0),'Opening Stock':Number(x.opening_stock||x.stock||0),'Opening Unit Cost AED':Number(x.opening_unit_cost||x.cost||0),'PAR Target Stock':x.par,'Minimum Stock':x.minimum,'Current Stock':x.stock}));
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,'Ingredient Master');XLSX.writeFile(wb,'KITCH_INGREDIENT_MASTER.xlsx');
}


const SUP_KEY='kitch_demo_suppliers_v1',PO_KEY='kitch_demo_pos_v1';
function getArr(k){try{return JSON.parse(localStorage.getItem(k)||'[]')}catch(e){return[]}}
function setArr(k,a){localStorage.setItem(k,JSON.stringify(a))}
function supplierProducts(){return getArr('kitch_supplier_products_v2')}
function setSupplierProducts(a){setArr('kitch_supplier_products_v2',a)}
function purchaseStatus(x){return x.status||'Pending Approval'}
function purchaseOrderRows(po){
 if(!po.length)return '<tr><td colspan="9" class="empty">No purchase requests or orders yet.</td></tr>';
 const groups=[];po.forEach(x=>{let g=groups.find(v=>v.po===x.po);if(!g){g={po:x.po,rows:[]};groups.push(g)}g.rows.push(x)});
 return groups.map(g=>{const first=g.rows[0],status=purchaseStatus(first),total=g.rows.reduce((t,x)=>t+Number(x.qty||0)*Number(x.price||0),0),items=g.rows.map(x=>`<div><b>${esc(x.ingredient)}</b> <span class="muted">${cleanQty(x.qty)} ${esc(x.unit)} × ${money(x.price)}</span></div>`).join(''),action=status==='Pending Approval'&&session==='manager'?`<button class="btn black" onclick="approvePurchase(${first.id})">Approve</button> <button class="btn" onclick="rejectPurchase(${first.id})">Reject</button>`:status==='Approved'&&session==='manager'?`<button class="btn" onclick="markPOSent(${first.id})">Mark Sent</button>`:'—';return `<tr><td><b>${esc(g.po)}</b><br><small>${g.rows.length} item${g.rows.length===1?'':'s'}</small></td><td>${esc(first.supplier)}</td><td>${items}</td><td>${g.rows.map(x=>`<div>${cleanQty(x.qty)} ${esc(x.unit)}</div>`).join('')}</td><td>${g.rows.map(x=>`<div>${money(x.price)} / ${esc(x.unit)}</div>`).join('')}</td><td><b>${money(total)}</b></td><td>${esc(first.delivery_date||'—')}</td><td><span class="alertBadge ${status==='Pending Approval'?'alertWarning':status==='Rejected'?'alertCritical':'alertInfo'}">${esc(status)}</span></td><td>${action}</td></tr>`}).join('')
}
function syncSupplierMasterFromIngredients(){
 const items=ingredients().filter(x=>x&&x.name&&String(x.supplier||x.supplier_name||'').trim());
 const base=normalizeSupplierData();const su=base.su,sp=base.sp;
 let changed=false;
 for(const x of items){
  const supplier=String(x.supplier||x.supplier_name||'').trim();
  if(!su.some(y=>String(y.name||'').trim().toLowerCase()===supplier.toLowerCase())){su.push({id:'master_'+supplier.toLowerCase().replace(/[^a-z0-9]/g,'_'),name:supplier,contact:'',phone:'',email:''});changed=true;}
  const sku=String(x.sku||'').trim();
  const existing=sp.find(y=>String(y.supplier||'').trim().toLowerCase()===supplier.toLowerCase() && ((sku&&String(y.sku||'').trim().toLowerCase()===sku.toLowerCase())||String(y.name||'').trim().toLowerCase()===String(x.name).trim().toLowerCase()));
  const price=Number(x.reference_cost??x.last_unit_cost??x.unit_cost??0);
  if(!existing){sp.push({id:'master_'+(sku||x.name).toLowerCase().replace(/[^a-z0-9]/g,'_'),supplier,name:x.name,sku,unit:x.base_unit||x.receiving_type||'kg',price:Number.isFinite(price)?price:0,notes:'Linked from Ingredient Master'});changed=true;}
  else if(existing.notes==='Linked from Ingredient Master' && (existing.price!==price||existing.name!==x.name)){existing.price=price;existing.name=x.name;changed=true;}
 }
 if(changed){setArr(SUP_KEY,su);setSupplierProducts(sp);}
 return {su,sp};
}
function openUnifiedMasterImport(){
 openImport();
 const h=document.querySelector('.modalHead h2');if(h)h.textContent='Import Unified Ingredient & Supplier Master';
 const p=document.querySelector('.modalBox p.muted');if(p)p.textContent='One Excel file updates Ingredient Master, Supplier Master and supplier products. Review the preview before confirming. Existing inventory movements are preserved.';
}
function purchasingPage(){
 const clean=syncSupplierMasterFromIngredients(),su=clean.su,po=getArr(PO_KEY),sp=clean.sp;
 const pending=po.filter(x=>purchaseStatus(x)==='Pending Approval').length,open=po.filter(x=>['Approved','Open'].includes(purchaseStatus(x))).length;
 const commit=po.filter(x=>!['Rejected','Received','Closed'].includes(purchaseStatus(x))).reduce((t,x)=>t+Number(x.qty||0)*Number(x.price||0),0);
 return `<div class="grid"><div class="card"><span>SUPPLIERS</span><b>${su.length}</b></div><div class="card"><span>SUPPLIER PRODUCTS</span><b>${sp.length}</b></div><div class="card"><span>AWAITING APPROVAL</span><b>${pending}</b></div><div class="card"><span>OPEN COMMITMENTS</span><b>AED ${commit.toFixed(2)}</b></div></div>
 <div class="panel"><h2>Purchasing Control</h2><p class="muted">Purchase Request → Manager Approval → Purchase Order → Supplier → Receiving → Invoice Matching.</p><div class="actions"><button class="btn" onclick="openSupplier()">+ Supplier</button><button class="btn" onclick="openSupplierProduct()">+ Supplier Product</button><button class="btn black" onclick="openUnifiedMasterImport()">Import Unified Master</button><button class="btn black" onclick="openPurchaseRequest()">+ Purchase Request</button><button class="btn" onclick="openPage('Receiving')">Receiving →</button></div>
 <h3>Purchase Requests & Orders</h3><table><tr><th>PO / REQUEST</th><th>SUPPLIER</th><th>ITEM</th><th>ORDERED</th><th>UNIT PRICE</th><th>TOTAL</th><th>DELIVERY</th><th>STATUS</th><th>ACTION</th></tr>${purchaseOrderRows(po)}</table>
 <h3 style="margin-top:28px">Supplier Master</h3><div style="overflow-x:auto"><table style="min-width:900px"><tr><th>SUPPLIER</th><th>CONTACT</th><th>PHONE</th><th>EMAIL</th><th>PRODUCTS</th><th>DETAILS</th></tr>${su.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.contact||'—')}</td><td>${esc(x.phone||'—')}</td><td>${esc(x.email||'—')}</td><td>${sp.filter(p=>p.supplier===x.name).length}</td><td><button class="btn" onclick="viewSupplierProfile('${String(x.id).replace(/'/g,"\'")}')">View</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No suppliers yet.</td></tr>'}</table></div></div>`;
}

function viewSupplierProfile(id){
 const su=getArr(SUP_KEY),x=su.find(v=>String(v.id)===String(id));if(!x)return alert('Supplier not found.');
 const products=supplierProducts().filter(p=>String(p.supplier||'').toLowerCase()===String(x.name||'').toLowerCase());
 modal(`<div class="modalHead"><div><h2>${esc(x.name)}</h2><div class="muted">Supplier Profile</div></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-top:18px">
 <div class="card"><span>CONTACT PERSON</span><b style="font-size:15px">${esc(x.contact||'—')}</b></div>
 <div class="card"><span>PHONE</span><b style="font-size:15px">${esc(x.phone||'—')}</b></div>
 <div class="card"><span>EMAIL</span><b style="font-size:15px">${esc(x.email||'—')}</b></div>
 <div class="card"><span>TRN / VAT</span><b style="font-size:15px">${esc(x.trn||'—')}</b></div>
 <div class="card"><span>PAYMENT TERMS</span><b style="font-size:15px">${esc(x.terms||'—')}</b></div>
 <div class="card"><span>DELIVERY DAYS</span><b style="font-size:15px">${esc(x.days||'—')}</b></div>
 <div class="card"><span>MINIMUM ORDER</span><b style="font-size:15px">${x.min_order?money(x.min_order):'—'}</b></div>
 <div class="card"><span>LEAD TIME</span><b style="font-size:15px">${x.lead_time?esc(String(x.lead_time))+' days':'—'}</b></div>
 <div class="card"><span>PRODUCTS</span><b style="font-size:15px">${products.length}</b></div></div>
 <div class="panel"><h3>Address / Location</h3><div>${esc(x.address||'—')}</div>${x.notes?`<div class="note" style="margin-top:12px"><b>Notes:</b> ${esc(x.notes)}</div>`:''}</div>
 <div class="panel"><h3>Supplier Products & Agreed Prices</h3><div style="overflow-x:auto"><table><tr><th>PRODUCT</th><th>SKU</th><th>UNIT</th><th>AGREED PRICE</th><th>LEAD TIME</th><th>NOTES</th></tr>${products.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.sku||'—')}</td><td>${esc(p.unit||'—')}</td><td>${money(Number(p.price||0))}</td><td>${p.lead_time?esc(String(p.lead_time))+' days':'—'}</td><td>${esc(p.notes||'—')}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No supplier products.</td></tr>'}</table></div></div>`);
}
function openSupplier(){modal(`<div class="modalHead"><h2>Add Supplier</h2><button class="close" onclick="closeModal()">×</button></div><div class="formGrid"><div class="field"><label>SUPPLIER NAME</label><input id="sName"></div><div class="field"><label>CONTACT PERSON</label><input id="sContact"></div><div class="field"><label>PHONE NUMBER</label><input id="sPhone"></div><div class="field"><label>EMAIL</label><input id="sEmail" type="email"></div><div class="field"><label>TRN / VAT NUMBER</label><input id="sTrn"></div><div class="field"><label>PAYMENT TERMS</label><input id="sTerms" placeholder="e.g. 30 days"></div><div class="field"><label>DELIVERY DAYS</label><input id="sDays" placeholder="e.g. Sun, Tue, Thu"></div><div class="field"><label>MINIMUM ORDER AED</label><input id="sMin" type="number" min="0" step=".01"></div><div class="field"><label>ADDRESS / LOCATION</label><input id="sAddress"></div><div class="field"><label>LEAD TIME DAYS</label><input id="sLead" type="number" min="0"></div></div><div class="field"><label>NOTES</label><input id="sNotes"></div><button class="primary" onclick="saveSupplier()">Create Supplier</button>`) }
function saveSupplier(){let name=sName.value.trim();if(!name)return alert('Enter supplier name.');let a=getArr(SUP_KEY);if(a.some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('Supplier already exists.');a.push({id:Date.now(),name,contact:sContact.value.trim(),phone:sPhone.value.trim(),email:sEmail.value.trim(),trn:sTrn.value.trim(),terms:sTerms.value.trim(),days:sDays.value.trim(),min_order:Number(sMin.value||0),address:sAddress.value.trim(),lead_time:sLead.value.trim(),notes:sNotes.value.trim()});setArr(SUP_KEY,a);closeModal();openPage('Suppliers & Purchasing')}
function openSupplierProduct(){const su=getArr(SUP_KEY);if(!su.length)return alert('Create a supplier first.');modal(`<div class="modalHead"><h2>Add Supplier Product</h2><button class="close" onclick="closeModal()">×</button></div><div class="formGrid"><div class="field"><label>SUPPLIER</label><select id="spSup">${su.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>PRODUCT / INGREDIENT</label><input id="spName"></div><div class="field"><label>SUPPLIER SKU</label><input id="spSku"></div><div class="field"><label>UNIT</label><select id="spUnit"><option>kg</option><option>g</option><option>ltr</option><option>ml</option><option>pcs</option></select></div><div class="field"><label>PRICE AED</label><input id="spPrice" type="number" min="0" step=".01"></div></div><button class="primary" onclick="saveSupplierProduct()">Save Product</button>`)}
function saveSupplierProduct(){const name=spName.value.trim(),price=Number(spPrice.value||0);if(!name||price<0)return alert('Complete product and price.');let a=supplierProducts();a.push({id:Date.now(),supplier:spSup.value,name,sku:spSku.value.trim(),unit:spUnit.value,price,previous_price:price,updated_at:new Date().toISOString()});setSupplierProducts(a);closeModal();openPage('Suppliers & Purchasing')}
function openSupplierExcel(){modal(`<div class="modalHead"><h2>Import Supplier Excel</h2><button class="close" onclick="closeModal()">×</button></div><div class="note">Supported: Supplier, Contact Person, Phone Number, Email, TRN / VAT Number, Payment Terms, Delivery Days, Minimum Order AED, Address / Location, Product, Supplier SKU, Unit, Agreed Price AED, Lead Time Days, Notes. Re-importing updates existing suppliers/products — it does not duplicate them.</div><label class="filePick">Choose Excel file<input id="supplierExcel" type="file" accept=".xlsx,.xls" style="display:none" onchange="importSupplierExcel(this.files[0])"></label>`) }
function normalizeSupplierData(){
 let su=getArr(SUP_KEY), sp=supplierProducts();
 const sm=new Map(); su.forEach(x=>{const k=String(x.name||'').trim().toLowerCase();if(!k)return;const prev=sm.get(k)||{};sm.set(k,{...prev,...x,id:prev.id||x.id,name:x.name||prev.name,contact:x.contact||prev.contact||'',phone:x.phone||prev.phone||'',email:x.email||prev.email||'',trn:x.trn||prev.trn||'',terms:x.terms||prev.terms||'',days:x.days||prev.days||'',min_order:Number(x.min_order||prev.min_order||0),address:x.address||prev.address||'',lead_time:x.lead_time||prev.lead_time||'',notes:x.notes||prev.notes||''})});
 const pm=new Map(); sp.forEach(x=>{const supplier=String(x.supplier||'').trim(), sku=String(x.sku||'').trim(), name=String(x.name||'').trim();if(!supplier||!name)return;const k=(supplier+'|'+(sku||name)).toLowerCase();const prev=pm.get(k);pm.set(k,prev?{...prev,...x,id:prev.id||x.id,previous_price:Number(prev.price||prev.previous_price||x.price||0)}:x)});
 su=[...sm.values()];sp=[...pm.values()];setArr(SUP_KEY,su);setSupplierProducts(sp);return {su,sp};
}
function importSupplierExcel(file){if(!file)return;const r=new FileReader();r.onload=e=>{try{const wb=XLSX.read(e.target.result,{type:'array'}),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});let base=normalizeSupplierData(),su=base.su,sp=base.sp,addedS=0,updatedS=0,addedP=0,updatedP=0;rows.forEach(row=>{const supplier=String(row.Supplier||row.supplier||'').trim();if(!supplier)return;let sx=su.find(x=>String(x.name||'').toLowerCase()===supplier.toLowerCase());const details={contact:String(row['Contact Person']||row.Contact||'').trim(),phone:String(row['Phone Number']||row.Phone||'').trim(),email:String(row.Email||'').trim(),trn:String(row['TRN / VAT Number']||row.TRN||'').trim(),terms:String(row['Payment Terms']||'').trim(),days:String(row['Delivery Days']||'').trim(),min_order:Number(row['Minimum Order AED']||row['Minimum Order']||0),address:String(row['Address / Location']||row.Address||'').trim(),lead_time:String(row['Lead Time Days']||'').trim(),notes:String(row.Notes||'').trim()};if(!sx){sx={id:Date.now()+Math.random(),name:supplier,...details};su.push(sx);addedS++}else{Object.keys(details).forEach(k=>{if(details[k]!==''&&details[k]!==0)sx[k]=details[k]});updatedS++}const product=String(row.Product||row.Ingredient||'').trim();if(product){const sku=String(row['Supplier SKU']||row.SKU||'').trim(),unit=String(row.Unit||'kg').trim(),price=Number(row['Agreed Price AED']||row.Price||0),lead=String(row['Lead Time Days']||'').trim(),notes=String(row.Notes||'').trim();let px=sp.find(x=>String(x.supplier||'').toLowerCase()===supplier.toLowerCase()&&((sku&&String(x.sku||'').toLowerCase()===sku.toLowerCase())||(!sku&&String(x.name||'').toLowerCase()===product.toLowerCase())));if(px){if(price!==Number(px.price||0))px.previous_price=Number(px.price||0);Object.assign(px,{supplier,name:product,sku,unit,price,lead_time:lead,notes,updated_at:new Date().toISOString()});updatedP++}else{sp.push({id:Date.now()+Math.random(),supplier,name:product,sku,unit,price,previous_price:price,lead_time:lead,notes,updated_at:new Date().toISOString()});addedP++}}});setArr(SUP_KEY,su);setSupplierProducts(sp);normalizeSupplierData();closeModal();openPage('Suppliers & Purchasing');alert(`Import complete. ${addedS} new suppliers, ${updatedS} supplier rows updated, ${addedP} new products, ${updatedP} products updated. Existing duplicates were cleaned.`)}catch(err){console.error(err);alert('Could not read this Excel file. Check the column names.')}};r.readAsArrayBuffer(file)}
function openPurchaseRequest(){
 syncSupplierMasterFromIngredients();const su=getArr(SUP_KEY); if(!su.length)return alert('Create or import suppliers first.');
 window._prLines=[];
 modal(`<div class="modalHead"><h2>Create Purchase Request</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="formGrid"><div class="field"><label>SUPPLIER</label><select id="prSup" onchange="resetPRLines()">${su.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>DELIVERY DATE</label><input id="prDate" type="date"></div></div>
 <div class="note">Add all products required from this supplier. KITCH will create one Purchase Request and, after approval, one Purchase Order.</div>
 <div id="prLines"></div>
 <div class="actions"><button class="btn" onclick="addPRLine()">+ Add Item</button></div>
 <div class="panel" style="margin-top:14px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><b>ORDER TOTAL</b><b id="prGrandTotal" style="font-size:22px">AED 0.00</b></div></div>
 <div class="field"><label>NOTES</label><input id="prNotes" placeholder="Optional purchasing note"></div>
 <button class="primary" onclick="savePurchaseRequest()">Submit for Approval</button>`);
 const d=new Date();d.setDate(d.getDate()+1);const dateEl=document.getElementById('prDate');if(dateEl)dateEl.value=d.toISOString().slice(0,10);addPRLine();
}
function resetPRLines(){window._prLines=[];const box=document.getElementById('prLines');if(box)box.innerHTML='';addPRLine()}
function prSupplierRows(){const sup=document.getElementById('prSup')?.value||'';return supplierProducts().filter(x=>x.supplier===sup)}
function addPRLine(){
 const rows=prSupplierRows();if(!rows.length){const box=document.getElementById('prLines');if(box)box.innerHTML='<div class="empty">No products linked to this supplier.</div>';return}
 const key='prl_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);window._prLines=window._prLines||[];window._prLines.push(key);
 const box=document.getElementById('prLines');const div=document.createElement('div');div.id=key;div.className='panel';div.style.cssText='margin-top:12px;padding:16px';
 div.innerHTML=`<div class="formGrid"><div class="field"><label>PRODUCT</label><select class="prLineProduct" onchange="updatePRLine('${key}')">${rows.map(x=>`<option value="${x.id}">${esc(x.name)} · ${money(x.price)} / ${esc(x.unit)}</option>`).join('')}</select></div><div class="field"><label>QUANTITY</label><input class="prLineQty" type="number" min="0" step=".01" value="1" oninput="updatePRLine('${key}')"></div></div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="muted prLineMeta"></span><div><b class="prLineTotal">AED 0.00</b> <button class="btn" type="button" onclick="removePRLine('${key}')">Remove</button></div></div>`;
 box.appendChild(div);updatePRLine(key)
}
function removePRLine(key){const el=document.getElementById(key);if(el)el.remove();window._prLines=(window._prLines||[]).filter(x=>x!==key);updatePRGrandTotal()}
function updatePRLine(key){const el=document.getElementById(key);if(!el)return;const id=el.querySelector('.prLineProduct')?.value,p=supplierProducts().find(x=>String(x.id)===String(id)),qty=Number(el.querySelector('.prLineQty')?.value||0);el.querySelector('.prLineMeta').textContent=p?`${p.sku||'No SKU'} · ${p.unit} · ${money(p.price)} each`:'';el.querySelector('.prLineTotal').textContent=p?money(qty*Number(p.price||0)):money(0);updatePRGrandTotal()}
function updatePRGrandTotal(){let total=0;(window._prLines||[]).forEach(key=>{const el=document.getElementById(key);if(!el)return;const p=supplierProducts().find(x=>String(x.id)===String(el.querySelector('.prLineProduct')?.value)),q=Number(el.querySelector('.prLineQty')?.value||0);if(p&&q>0)total+=q*Number(p.price||0)});const t=document.getElementById('prGrandTotal');if(t)t.textContent=money(total)}
function savePurchaseRequest(){
 const supplier=document.getElementById('prSup')?.value||'',delivery=document.getElementById('prDate')?.value||'',notes=(document.getElementById('prNotes')?.value||'').trim();let lines=[];
 (window._prLines||[]).forEach(key=>{const el=document.getElementById(key);if(!el)return;const p=supplierProducts().find(x=>String(x.id)===String(el.querySelector('.prLineProduct')?.value)),qty=Number(el.querySelector('.prLineQty')?.value||0);if(p&&qty>0)lines.push({p,qty})});
 if(!supplier||!lines.length)return alert('Add at least one product with a valid quantity.');
 const existing=getArr(PO_KEY),nums=existing.map(x=>Number(String(x.po||'').match(/(?:PR|PO)-(\d+)/)?.[1]||0)),n=Math.max(0,...nums)+1,pr='PR-'+String(n).padStart(4,'0'),groupId=Date.now();
 lines.forEach((l,i)=>existing.push({id:groupId+i,request_id:groupId,po:pr,supplier,ingredient:l.p.name,sku:l.p.sku||'',unit:l.p.unit,qty:l.qty,price:l.p.price,delivery_date:delivery,notes,status:'Pending Approval',accepted:0,rejected:0,created_at:new Date().toISOString()}));
 setArr(PO_KEY,existing);closeModal();openPage('Suppliers & Purchasing')
}
function approvePurchase(id){if(session!=='manager'){alert('Only the Kitchen Manager or Head Chef can manage purchase orders.');return;}let a=getArr(PO_KEY),seed=a.find(v=>v.id===id);if(!seed)return;const old=seed.po,newPo=old.replace(/^PR-/,'PO-'),now=new Date().toISOString();a.forEach(x=>{if(x.po===old){x.status='Approved';x.po=newPo;x.approved_at=now}});setArr(PO_KEY,a);openPage('Suppliers & Purchasing')}
function rejectPurchase(id){if(session!=='manager'){alert('Only the Kitchen Manager or Head Chef can manage purchase orders.');return;}let a=getArr(PO_KEY),seed=a.find(v=>v.id===id);if(!seed)return;const key=seed.po;a.forEach(x=>{if(x.po===key)x.status='Rejected'});setArr(PO_KEY,a);openPage('Suppliers & Purchasing')}
function markPOSent(id){if(session!=='manager'){alert('Only the Kitchen Manager or Head Chef can manage purchase orders.');return;}let a=getArr(PO_KEY),seed=a.find(v=>v.id===id);if(!seed)return;const key=seed.po,now=new Date().toISOString();a.forEach(x=>{if(x.po===key){x.status='Open';x.sent_at=now}});setArr(PO_KEY,a);openPage('Suppliers & Purchasing')}
function openPO(){openPurchaseRequest()}
function poIngredientChanged(){}
function savePO(){}
let kitchReceivingHistory=[];
async function kitchLoadReceivingHistory(){
 if(!teamCloudAuth?.staff_name||!teamCloudAuth?.pin)return;
 try{const {data,error}=await sb.rpc('kitch_team_receiving_history',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin});if(error)throw error;kitchReceivingHistory=Array.isArray(data)?data:[];if(document.getElementById('kitchReceivingRows'))kitchRenderReceivingRows();}catch(e){const n=document.getElementById('kitchReceivingMessage');if(n)n.textContent='Cloud history unavailable: '+e.message;}
}
function kitchRenderReceivingRows(){const t=document.getElementById('kitchReceivingRows');if(!t)return;t.innerHTML=kitchReceivingHistory.map(x=>`<tr><td>${esc(new Date(x.date).toLocaleDateString())}</td><td>${esc(x.invoice)}</td><td>${esc(x.supplier)}</td><td>${esc(x.ingredient)}</td><td>${esc(x.accepted)} ${esc(x.unit)}</td><td>${money(x.total)}</td><td>${esc(x.expiry||'—')}</td><td>${x.has_attachment?`<button class="btn" onclick="kitchDownloadInvoice('${esc(x.id)}')">Invoice</button>`:'—'}</td><td><button class="btn" onclick="kitchPrintReceipt('${esc(x.id)}')">PDF</button></td></tr>`).join('')||'<tr><td colspan="9" class="empty">No receiving records yet. Click + New Receiving.</td></tr>';}
function receivingPage(){setTimeout(kitchLoadReceivingHistory,80);return `<div class="panel"><h2>Receiving</h2><p class="muted">Receive supplier deliveries into your assigned location. Confirmed quantities update live inventory.</p><div class="actions"><button class="btn black" onclick="openKitchNewReceiving()">+ New Receiving</button><button class="btn" onclick="kitchLoadReceivingHistory()">Refresh history</button></div><div style="overflow-x:auto"><table><thead><tr><th>DATE</th><th>INVOICE</th><th>SUPPLIER</th><th>INGREDIENT</th><th>ACCEPTED</th><th>TOTAL</th><th>EXPIRY</th><th>FILE</th><th>REPORT</th></tr></thead><tbody id="kitchReceivingRows"><tr><td colspan="9">Loading cloud history…</td></tr></tbody></table></div><p id="kitchReceivingMessage" class="muted" style="font-size:12px;margin-top:12px">History is saved in Supabase and available across devices for your assigned location. PDF uses your browser's Print → Save as PDF.</p></div>`;}
async function kitchDownloadInvoice(id){try{const {data,error}=await sb.rpc('kitch_team_receiving_download',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_receipt_id:id});if(error)throw error;const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:data.mime}));const a=document.createElement('a');a.href=url;a.download=data.filename||'invoice';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){alert('Cannot download invoice: '+e.message)}}
function kitchPrintReceipt(id){const x=kitchReceivingHistory.find(r=>r.id===id);if(!x)return;const w=window.open('','_blank');if(!w)return alert('Allow pop-ups to export PDF.');w.document.write(`<!doctype html><html><head><title>KITCH Receiving ${esc(x.invoice)}</title><style>body{font:15px Arial,sans-serif;color:#222;padding:38px;max-width:760px;margin:auto}header{border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:32px}h1{font-size:30px;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}.muted{color:#777}footer{margin-top:65px;color:#888;font-size:12px}@media print{button{display:none}}</style></head><body><header><h1>KITCH</h1><div class="muted">Receiving Report · ${esc(currentBranchName())}</div></header><h2>Invoice ${esc(x.invoice)}</h2><p>Supplier: ${esc(x.supplier)}<br>Received: ${esc(new Date(x.date).toLocaleDateString())}</p><table><tr><th>Ingredient</th><th>Accepted</th><th>Unit price</th><th>Total</th></tr><tr><td>${esc(x.ingredient)}</td><td>${esc(x.accepted)} ${esc(x.unit)}</td><td>${money(x.price)}</td><td>${money(x.total)}</td></tr></table><p>Rejected: ${esc(x.rejected)} ${esc(x.unit)}<br>Production: ${esc(x.production_date||'—')}<br>Expiry: ${esc(x.expiry||'—')}<br>Temperature: ${x.temperature==null?'—':esc(x.temperature)+' °C'}</p><footer>Powered by KITCH · Generated ${new Date().toLocaleString()}</footer><button onclick="window.print()">Print / Save as PDF</button></body></html>`);w.document.close();}
function kitchReceiveUpdateTotal(){const qty=Number(document.getElementById('knrQty')?.value||0),rej=Number(document.getElementById('knrRejected')?.value||0),price=Number(document.getElementById('knrPrice')?.value||0),el=document.getElementById('knrTotal');if(el)el.textContent=money(Math.max(0,qty-rej)*Math.max(0,price));}
async function kitchFileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Unable to read invoice'));reader.readAsDataURL(file)})}
function openKitchNewReceiving(){
 if(!teamCloudAuth?.staff_name||!teamCloudAuth?.pin||!cloud.branch_id)return alert('Please sign in with your Team account to receive stock for your assigned location.');
 const ing=sortedIngredients().filter(x=>x.cloud_id);
 if(!ing.length)return alert('Cloud Ingredient Master has not loaded. Refresh and sign in again.');
 modal(`<div class="modalHead"><h2>New Receiving</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="note">Location: <b>${esc(assignedLocationName())}</b>. Only confirmed accepted quantities will be added to inventory.</div>
 <div class="formGrid">
 <div class="field"><label>SUPPLIER *</label><input id="knrSupplier" required placeholder="Auto-filled from Master List"><small class="muted">Auto-selected; editable to match the invoice.</small></div>
 <div class="field"><label>INGREDIENT *</label><select id="knrIng" onchange="kitchReceiveIngredientChanged()">${ing.map(x=>`<option value="${esc(x.cloud_id)}">${esc(x.name)} (${esc(x.base_unit)})</option>`).join('')}</select></div>
 <div class="field"><label id="knrQtyLabel">DELIVERED QUANTITY *</label><input id="knrQty" type="number" min="0.001" step="any" placeholder="Quantity" oninput="kitchReceiveUpdateTotal()"><small class="muted" id="knrUnitHelp">Unit selected from Ingredient Master.</small></div>
 <div class="field"><label>REJECTED QUANTITY</label><input id="knrRejected" type="number" min="0" step="any" value="0" oninput="kitchReceiveUpdateTotal()"></div>
 <div class="field"><label id="knrPriceLabel">UNIT PRICE (AED) *</label><input id="knrPrice" type="number" min="0" step="any" oninput="kitchReceiveUpdateTotal()"><small class="muted">Master List price; editable to match the invoice.</small></div>
 <div class="field"><label>INVOICE NUMBER *</label><input id="knrInvoice" placeholder="Supplier invoice number"></div>
 <div class="field"><label>PRODUCTION DATE (OPTIONAL)</label><input id="knrProduction" type="date"></div>
 <div class="field"><label>EXPIRY DATE (BATCH)</label><input id="knrExpiry" type="date"><small class="muted">Enter the expiry printed on this delivery.</small></div>
 <div class="field"><label>RECEIVING DATE</label><input id="knrDate" type="date" readonly><small class="muted">Automatically set to today.</small></div>
 <div class="field"><label>RECEIVING TEMPERATURE (°C)</label><input id="knrTemp" type="number" step="any" placeholder="If applicable"></div>
 <div class="field"><label>INVOICE / DELIVERY NOTE</label><input id="knrFile" type="file" accept="image/*,.pdf"><small class="muted">PDF, JPG, PNG or WebP; max 2 MB. Saved securely with the receiving record.</small></div>
 </div><div class="note"><b>Accepted stock total: <span id="knrTotal">AED 0.00</span></b></div><p id="knrStatus" class="muted" aria-live="polite"></p><button id="knrSubmit" class="primary" onclick="kitchSaveNewReceiving()">Confirm Receiving</button>`);
 const today=new Date();const localDate=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);document.getElementById('knrDate').value=localDate;
 kitchReceiveIngredientChanged();
}
function kitchReceiveIngredientChanged(){
 const ing=ingredients().find(x=>String(x.cloud_id)===String(document.getElementById('knrIng')?.value));
 if(!ing)return;
 const sup=document.getElementById('knrSupplier'),price=document.getElementById('knrPrice');
 const linked=supplierProducts().find(p=>String(p.sku||'')===String(ing.sku||'') || String(p.ingredient_id||'')===String(ing.cloud_id||'') || String(p.name||'').toLowerCase()===String(ing.name||'').toLowerCase());
 if(sup)sup.value=ing.supplier||linked?.supplier||linked?.supplier_name||'';
 if(price)price.value=Number(ing.reference_cost??ing.cost??linked?.price??0).toFixed(2);
 const unit=String(ing.base_unit||'unit');
 const qtyLabel=document.getElementById('knrQtyLabel'),priceLabel=document.getElementById('knrPriceLabel'),unitHelp=document.getElementById('knrUnitHelp');
 if(qtyLabel)qtyLabel.textContent='DELIVERED QUANTITY ('+unit+') *';
 if(priceLabel)priceLabel.textContent='UNIT PRICE (AED / '+unit+') *';
 if(unitHelp)unitHelp.textContent='Stock unit: '+unit+' · automatically selected from Ingredient Master.';kitchReceiveUpdateTotal();
}
async function kitchSaveNewReceiving(){
 const el=id=>document.getElementById(id), ingredient=ingredients().find(x=>String(x.cloud_id)===String(el('knrIng')?.value));
 const supplier=el('knrSupplier').value.trim(),invoice=el('knrInvoice').value.trim(),qty=Number(el('knrQty').value),rejected=Number(el('knrRejected').value),price=Number(el('knrPrice').value);
 const status=el('knrStatus'),btn=el('knrSubmit');
 if(!ingredient||!supplier||!invoice||!Number.isFinite(qty)||qty<=0||!Number.isFinite(rejected)||rejected<0||rejected>qty||!Number.isFinite(price)||price<0){status.textContent='Complete supplier, ingredient, invoice, quantities and price correctly.';return;}
 const expiry=el('knrExpiry').value||null,temp=el('knrTemp').value===''?null:Number(el('knrTemp').value);
 if(temp!==null&&!Number.isFinite(temp)){status.textContent='Invalid receiving temperature.';return;}
 const file=el('knrFile').files?.[0];if(file&&(file.size>2*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))){status.textContent='Invoice must be a PDF/JPG/PNG/WebP under 2 MB.';return;}
 btn.disabled=true;status.textContent='Saving receiving to KITCH Cloud…';
 try{
 const {data,error}=await sb.rpc('kitch_team_receive_stock',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_ingredient_id:ingredient.cloud_id,p_supplier:supplier,p_invoice_number:invoice,p_invoice_filename:el('knrFile').files?.[0]?.name||null,p_delivered_qty:qty,p_rejected_qty:rejected,p_unit:ingredient.base_unit,p_unit_price:price,p_expiry_date:expiry,p_temperature:temp});
 if(error)throw error;
 let attachError='';try{const base64=file?await kitchFileToBase64(file):null;const attachment=await sb.rpc('kitch_team_receiving_attach',{p_staff_name:teamCloudAuth.staff_name,p_pin:teamCloudAuth.pin,p_receipt_id:data.id,p_filename:file?.name||'',p_mime:file?.type||null,p_base64:base64,p_production_date:el('knrProduction').value||null});if(attachment.error)throw attachment.error;}catch(e){attachError=' Receipt saved and stock updated, but invoice attachment failed: '+e.message;}
 const arr=getArr('kitch_receiving_local_history_v2');arr.unshift({id:data.id,branch_id:cloud.branch_id,date:new Date().toLocaleDateString(),invoice,supplier,ingredient:ingredient.name,accepted:data.accepted_qty,unit:ingredient.base_unit});setArr('kitch_receiving_local_history_v2',arr.slice(0,150));
 closeModal();await cloudLoadIngredients();openPage('Receiving');alert('Receiving saved to cloud. Accepted: '+data.accepted_qty+' '+ingredient.base_unit+'. Inventory refreshed.'+attachError);
 }catch(e){status.textContent='Not saved: '+(e.message||'Cloud error')+'. No stock was changed by this screen.';btn.disabled=false;}
}

function openDirectReceive(){
 const ing=sortedIngredients(); if(!ing.length)return alert('Ingredient Master is empty. Add or import ingredients first.');
 modal(`<div class="modalHead"><h2>Receive Stock</h2><button class="close" onclick="closeModal()">×</button></div><div class="formGrid">
 <div class="field"><label>SUPPLIER *</label><input id="drSupplier" placeholder="Supplier name"><small class="muted">Defaults from Ingredient Master. You can change it for this delivery.</small></div>
 <div class="field"><label>INGREDIENT *</label><select id="drIng" class="ingredientSelect" onchange="directReceiveIngredientChanged()">${ing.map(x=>`<option value="${esc(x.sku)}">${esc(x.name)} · ${esc(x.base_unit)}</option>`).join('')}</select></div>
 <div class="field"><label>DELIVERED QUANTITY *</label><input id="drQty" type="number" min="0" step=".01"></div>
 <div class="field"><label>INVOICE UNIT PRICE AED *</label><input id="drPrice" type="number" min="0" step=".01"></div></div>
 <div class="note">Supplier stock is received directly with invoice proof. KITCH checks accepted/rejected quantity, expiry, receiving condition and actual cost before inventory is updated.</div>
 <button class="primary" onclick="startDirectReceive()">Continue Receiving</button>`); directReceiveIngredientChanged();
}
function directReceiveIngredientChanged(){const x=ingredients().find(i=>i.sku===document.getElementById('drIng')?.value);const el=document.getElementById('drPrice'),sup=document.getElementById('drSupplier');if(x&&el)el.value=Number(x.reference_cost!=null?x.reference_cost:x.cost||0).toFixed(2);if(x&&sup)sup.value=x.supplier||''}
function startDirectReceive(){
 const supplier=(document.getElementById('drSupplier')?.value||'').trim(),sku=document.getElementById('drIng')?.value,qty=Number(document.getElementById('drQty')?.value||0),price=Number(document.getElementById('drPrice')?.value||0),ing=ingredients().find(i=>i.sku===sku);
 if(!supplier)return alert('Enter supplier name.'); if(!ing||qty<=0)return alert('Enter a valid delivered quantity.'); if(price<0)return alert('Enter a valid invoice price.');
 let a=getArr(PO_KEY),id=Date.now(),n=a.filter(x=>x.direct_receive).length+1;
 a.push({id,po:'REC-'+String(n).padStart(4,'0'),supplier,sku:ing.sku,ingredient:ing.name,unit:ing.base_unit,qty,delivered:qty,price,status:'Open',accepted:0,rejected:0,direct_receive:true}); setArr(PO_KEY,a); closeModal(); openReceive(id);
}
function receivePriceImpact(id){
 const x=getArr(PO_KEY).find(p=>p.id===id),ing=ingredients().find(i=>i.sku===x?.sku);if(!x||!ing)return;
 const ref=Number(ing.reference_cost!=null?ing.reference_cost:ing.cost||0),invoice=Number(document.getElementById('rInvoicePrice')?.value||0);
 const diff=invoice-ref,pct=ref>0?(diff/ref*100):0,box=document.getElementById('receivePriceImpact');
 if(!box)return;
 const cls=Math.abs(pct)>=10?'bad':Math.abs(pct)>=3?'warn':'ok';
 box.className='note '+cls;
 box.innerHTML=`<b>Price Control:</b> Reference ${money(ref)} / ${esc(ing.base_unit)} → Invoice ${money(invoice)} / ${esc(ing.base_unit)} · <b>${diff>=0?'+':''}${money(diff)} (${pct>=0?'+':''}${pct.toFixed(2)}%)</b><br><small>${Math.abs(pct)>=3?'Price variance alert will be sent to Main Office.':'Within 3% tolerance — recorded in price history.'}</small>`;
}
function openReceive(id){
 const x=getArr(PO_KEY).find(p=>p.id===id);if(!x)return;
 const ing=ingredients().find(i=>i.sku===x.sku),ref=Number(ing?.reference_cost!=null?ing.reference_cost:ing?.cost||x.price||0),recvType=correctedReceivingType(ing?.name,ing?.receiving_type);
 modal(`<div class="modalHead"><h2>Receive ${x.po}</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="note"><b>${esc(x.ingredient)}</b> · ${x.direct_receive?'Delivered':'Ordered'} ${x.qty} ${esc(x.unit)} · ${esc(x.supplier)}<br><small>Master reference price: ${money(ref)} / ${esc(x.unit)}</small></div>
 <div class="formGrid">
  <div class="field"><label>DELIVERED QUANTITY</label><input id="rDelivered" type="number" min="0" step=".01" value="${x.qty}"></div>
  <div class="field"><label>REJECTED QUANTITY</label><input id="rRejected" type="number" min="0" step=".01" value="0" oninput="toggleRejectReason()"></div>
  <div class="field"><label>INVOICE UNIT PRICE AED *</label><input id="rInvoicePrice" type="number" min="0" step=".01" value="${Number(x.price||0).toFixed(2)}" oninput="receivePriceImpact(${id})"></div>
  <div class="field"><label>PRODUCTION DATE *</label><input id="rProductionDate" type="date"></div>
  <div class="field"><label>EXPIRY DATE *</label><input id="rExpiry" type="date"></div>
  <div class="field"><label>INVOICE PROOF *</label><input id="rInvoiceProof" type="file" accept="image/*,.pdf"></div>
 </div>
 <div class="note"><b>Receiving Condition Check</b><br><small>Receiving type: <b>${esc(recvType)}</b>. Temperature entry stays open for every delivery. It is required for Chilled and Frozen items and optional for Room Temperature items.</small></div>
 <div class="formGrid">
  <div class="field"><label>ACTUAL TEMPERATURE °C ${(['Chilled','Frozen'].includes(recvType))?'*':'· OPTIONAL'}</label><input id="rTemperature" type="number" step=".1" inputmode="decimal" placeholder="Enter actual temperature °C" value=""></div><div class="field"><label>TEMPERATURE CHECK ${(['Chilled','Frozen'].includes(recvType))?'*':''}</label><select id="rTemperatureCheck"><option value="">Select</option><option>Pass</option><option>Fail</option></select></div>
  <div class="field"><label>PACKAGING CONDITION *</label><select id="rPackagingCheck"><option>Pass</option><option>Fail</option></select></div>
  <div class="field"><label>PRODUCT QUALITY / APPEARANCE *</label><select id="rQualityCheck"><option>Pass</option><option>Fail</option></select></div>
  <div class="field"><label>EXPIRY / SHELF LIFE *</label><select id="rShelfLifeCheck"><option>Pass</option><option>Fail</option></select></div>
  <div class="field"><label>RECEIVING PHOTO / NOTE</label><input id="rConditionNote" placeholder="Optional condition note"></div>
 </div>
 <div id="receivePriceImpact" class="note"></div>
 <div id="rejectReasonBox" class="hidden">
  <div class="formGrid">
   <div class="field"><label>REJECT REASON *</label><select id="rReason" onchange="toggleOtherReason()">
    <option value="">Select reason</option><option>Damaged</option><option>Wrong Item</option><option>Poor Quality</option>
    <option>Expired / Short Expiry</option><option>Temperature Issue</option><option>Wrong Quantity</option>
    <option>Packaging Damaged</option><option>Other</option>
   </select></div>
   <div id="otherReasonBox" class="field hidden"><label>REJECTION NOTE *</label><input id="rReasonNote" placeholder="Enter rejection reason"></div>
  </div>
 </div>
 <div class="note">Accepted = Delivered − Rejected. Only accepted stock enters Inventory. Invoice price becomes the latest actual cost; the original master reference price is retained.</div>
 <button class="primary" onclick="confirmReceive(${id})">Confirm Receiving</button>`);
 receivePriceImpact(id);
}
function toggleRejectReason(){
 const qty=Number(document.getElementById('rRejected')?.value||0);
 document.getElementById('rejectReasonBox')?.classList.toggle('hidden',qty<=0);
 if(qty<=0){const r=document.getElementById('rReason');if(r)r.value='';const n=document.getElementById('rReasonNote');if(n)n.value='';}
}
function toggleOtherReason(){
 const other=document.getElementById('rReason')?.value==='Other';
 document.getElementById('otherReasonBox')?.classList.toggle('hidden',!other);
}
function confirmReceive(id){
 let po=getArr(PO_KEY),x=po.find(p=>p.id===id);if(!x)return;
 let d=Number(rDelivered.value||0),r=Number(rRejected.value||0),invoicePrice=Number(document.getElementById('rInvoicePrice')?.value||0);
 const ingMaster=ingredients().find(i=>i.sku===x.sku),receivingType=correctedReceivingType(ingMaster?.name,ingMaster?.receiving_type),tempRequired=receivingType==='Chilled'||receivingType==='Frozen';
 const temp=(document.getElementById('rTemperature')?.value||'').trim(),tempCheck=document.getElementById('rTemperatureCheck')?.value||'',packagingCheck=document.getElementById('rPackagingCheck')?.value||'Pass',qualityCheck=document.getElementById('rQualityCheck')?.value||'Pass',shelfLifeCheck=document.getElementById('rShelfLifeCheck')?.value||'Pass',conditionNote=(document.getElementById('rConditionNote')?.value||'').trim();
 const failedChecks=[['Temperature',tempCheck],['Packaging',packagingCheck],['Product Quality',qualityCheck],['Expiry / Shelf Life',shelfLifeCheck]].filter(v=>v[1]==='Fail').map(v=>v[0]);
 if(tempRequired&&!temp)return alert('Actual receiving temperature is required for '+receivingType+' items.');
 if(tempRequired&&!tempCheck)return alert('Select Pass or Fail for the temperature check on '+receivingType+' items.');
 if(failedChecks.length&&r<=0)return alert('A receiving condition failed. Enter the rejected quantity before confirming.');
 if(d<0||r<0||r>d)return alert('Rejected quantity cannot be greater than delivered quantity.');
 if(invoicePrice<0)return alert('Enter a valid invoice unit price.');
 let reason='',note='';
 if(r>0){reason=(document.getElementById('rReason')?.value||'').trim();note=(document.getElementById('rReasonNote')?.value||'').trim();if(!reason)return alert('Select a reject reason.');if(reason==='Other'&&!note)return alert('Enter the rejection note.');}
 const productionDate=(document.getElementById('rProductionDate')?.value||'').trim(),expiry=(document.getElementById('rExpiry')?.value||'').trim();if(!productionDate)return alert('Production date is required.');if(!expiry)return alert('Expiry date is required.');if(productionDate>expiry)return alert('Production date cannot be after expiry date.'); const invoiceProof=document.getElementById('rInvoiceProof')?.files?.[0];if(!invoiceProof)return alert('Attach invoice proof before confirming receiving.');
 let accepted=d-r,a=ingredients(),ing=a.find(i=>i.sku===x.sku);if(!ing)return alert('Ingredient not found.');
 const referencePrice=Number(ing.reference_cost!=null?ing.reference_cost:ing.cost||0),priceDiff=invoicePrice-referencePrice,pricePct=referencePrice>0?(priceDiff/referencePrice*100):0;
 if(ing.reference_cost==null)ing.reference_cost=referencePrice;
 ing.latest_cost=invoicePrice;ing.cost=invoicePrice;
 ing.stock_canonical=(ing.stock_canonical!=null?Number(ing.stock_canonical):toCanonical(ing.stock,ing.base_unit))+toCanonical(accepted,x.unit);ing.stock=fromCanonical(ing.stock_canonical,ing.base_unit);ing.stock_location=stockLocation();
 const receivedAt=new Date().toISOString(),priceAlert=Math.abs(pricePct)>=3;
 Object.assign(x,{status:'Received',delivered:d,rejected:r,accepted,price:invoicePrice,po_price:Number(x.price||0),reference_price:referencePrice,invoice_price:invoicePrice,price_variance:priceDiff,price_variance_pct:pricePct,price_variance_alert:priceAlert,accepted_value:accepted*invoicePrice,price_cost_impact:accepted*priceDiff,location:stockLocation(),reject_reason:reason,reject_note:note,production_date:productionDate,expiry_date:expiry,received_at:receivedAt,receiving_type:receivingType,receiving_temperature:temp,temperature_check:tempCheck,packaging_check:packagingCheck,quality_check:qualityCheck,shelf_life_check:shelfLifeCheck,receiving_condition_note:conditionNote,failed_condition_checks:failedChecks,receiving_condition_status:failedChecks.length?'Failed':'Passed'});
 saveIngredients(a);setArr(PO_KEY,po);
 if(accepted>0){let batches=getArr(BATCH_KEY);const nums=batches.map(b=>Number(String(b.lot||'').replace(/\D/g,''))||0);const batchNo='BAT-'+String((nums.length?Math.max(...nums):0)+1).padStart(6,'0');batches.push({id:Date.now(),po:x.po,sku:x.sku,ingredient:x.ingredient,supplier:x.supplier,lot:batchNo,received_date:receivedAt.slice(0,10),production_date:productionDate,expiry_date:expiry,received_qty:accepted,remaining_qty:accepted,remaining_canonical:toCanonical(accepted,x.unit),unit:x.unit,cost:invoicePrice,location:stockLocation()});setArr(BATCH_KEY,batches);}
 closeModal();openPage('Receiving');
 alert(`${accepted} ${x.unit} accepted. Receiving condition: ${failedChecks.length?'FAILED ('+failedChecks.join(', ')+')':'PASSED'}. Invoice price ${money(invoicePrice)} vs reference ${money(referencePrice)} (${pricePct>=0?'+':''}${pricePct.toFixed(2)}%).${priceAlert?' Main Office price variance alert created.':''}${failedChecks.length?' Main Office receiving condition alert created.':''}`);
}


const STOCK_REQUEST_KEY='kitch_demo_stock_requests_v1';
const TRANSFER_KEY='kitch_demo_transfers_v1';
let transferReceiptPhotoData='';
let transferDispatchPhotoData='';

// Stock units: never silently treat a box as a kilogram or litre.
function stockTransferUnits(x){
 const base=unit(x.base_unit);
 const choices=base==='kg'||base==='g'?['kg']:base==='ltr'||base==='ml'?['ltr']:base==='pcs'?['pcs']:base==='box'?['box']:[];
 const pack=Number(x.units_per_box||x.pieces_per_box||x.box_size||0);
 if(base==='pcs'&&pack>0)choices.push('box');
 return choices;
}
function stockTransferCanonical(q,u,x){
 u=unit(u);const base=unit(x.base_unit);q=Number(q);
 if(!Number.isFinite(q)||q<=0)return null;
 if(u==='box'&&base==='pcs'){
   const pack=Number(x.units_per_box||x.pieces_per_box||x.box_size||0);
   return pack>0?q*pack:null;
 }
 if(!stockTransferUnits(x).includes(u))return null;
 return toCanonical(q,u);
}
function stockTransferUnitOptions(x,selected){return stockTransferUnits(x).map(u=>`<option value="${u}" ${u===selected?'selected':''}>${u}</option>`).join('')}
function centralStockReady(){
 if(window.__kitchInventoryLoadError){alert('Live inventory is unavailable: '+window.__kitchInventoryLoadError+'\nStock transfers are blocked until Central Store balances are verified.');return false;}
 if(teamCloudAuth?.staff_name && !(window.__kitchTeamLiveStock instanceof Map)){alert('Live inventory has not loaded. No stock will be transferred.');return false;}
 return true;
}
function requestStatusLabel(x){
 const st=x.status||'Requested';
 return st==='Requested'?'Pending Store':st==='Accepted'?'Store Accepted':st==='In Transfer'?'In Transfer':st==='Received'?'Completed':st;
}
function requestTimeline(x){
 const steps=[
  ['Requested',x.requested_at||x.created_at||'',x.requested_by||'—'],
  ['Store Accepted',x.accepted_at||'',x.accepted_by||'—'],
  ['Sent',x.sent_at||x.fulfilled_at||'',x.sent_by||x.fulfilled_by||'—'],
  ['Restaurant Received',x.received_at||'',x.received_by||'—']
 ];
 return `<div style="display:grid;gap:8px;margin:16px 0">${steps.map(([n,d,u],i)=>`<div class="note" style="margin:0;display:flex;justify-content:space-between;gap:12px"><b>${i+1}. ${n}</b><span>${d?esc(new Date(d).toLocaleString())+' · '+esc(u):'Pending'}</span></div>`).join('')}</div>`;
}
function stockRequestsPage(){
 if(!hasCentralStore())return `<div class="panel"><h2>Stock Requests</h2><p class="muted">Stock Requests are available in Business only.</p></div>`;
 const all=getArr(STOCK_REQUEST_KEY),req=(session==='manager'?all.filter(x=>x.branch===currentBranchName()):all).slice().reverse(),isBranch=session==='manager',isStore=session==='store',isOwner=session==='owner';
 const open=req.filter(x=>!['Received','Completed'].includes(x.status)).length,done=req.filter(x=>['Received','Completed'].includes(x.status)).length;
 return `<div class="grid"><div class="card"><span>OPEN PROCESS</span><b>${open}</b></div><div class="card"><span>COMPLETED</span><b>${done}</b></div><div class="card"><span>FLOW</span><b style="font-size:14px">Request → Store → Receive</b></div><div class="card"><span>PACKAGE</span><b style="font-size:16px">Business</b></div></div>
 <div class="panel"><h2>${isBranch?'Stock Requests & Receiving':isStore?'Branch Stock Requests':'Stock Request Control'}</h2><p class="muted">${isOwner?'Main Office sees the complete request, dispatch and restaurant receiving audit trail.':isBranch?'Request from Central Store, then confirm the stock physically received at your restaurant.':'Accept branch requests, then send the stock. Branch inventory updates only after the restaurant confirms receipt.'}</p>${isBranch?'<div class="actions"><button class="btn black" onclick="openStockRequest()">+ Stock Request</button></div>':''}
 <table><tr><th>REQUEST</th><th>BRANCH</th><th>INGREDIENT</th><th>REQUESTED</th><th>STATUS</th><th>REQUESTED BY</th><th>ACTION</th></tr>${req.map(x=>{
 let action=`<button class="btn" onclick="viewStockRequest(${x.id})">View Details</button>`;
 if(isStore&&x.status==='Requested')action=`<button class="btn black" onclick="acceptStockRequest(${x.id})">Accept</button> `+action;
 if(isStore&&x.status==='Accepted')action=`<button class="btn black" onclick="sendStockRequest(${x.id})">Send Stock</button> `+action;
 if(isBranch&&x.status==='In Transfer')action=`<button class="btn black" onclick="openTransferReceiving(${x.id})">Confirm Receipt</button> `+action;
 return `<tr><td><b>${esc(x.ref)}</b></td><td>${esc(x.branch)}</td><td><b>${esc(x.ingredient)}</b></td><td>${cleanQty(x.qty)} ${esc(x.unit)}</td><td><b>${esc(requestStatusLabel(x))}</b></td><td>${esc(x.requested_by||'—')}</td><td>${action}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No stock requests yet.</td></tr>'}</table></div>`;
}
function openStockRequest(){
 if(session!=='manager'||!hasCentralStore())return;
 const a=sortedIngredients(),branch=currentBranch();if(!a.length)return alert('Ingredient Master is empty.');if(!branch)return alert('No branch is assigned.');
 modal(`<div class="modalHead"><h2>Request Stock</h2><button class="close" onclick="closeModal()">×</button></div><div class="note"><b>From:</b> Central Store<br><b>To:</b> ${esc(branch.name)}</div><div class="formGrid"><div class="field"><label>INGREDIENT</label><select id="srIng" class="ingredientSelect" onchange="stockRequestIngredientChanged()">${a.map(x=>`<option value="${esc(x.sku)}">${esc(x.name)} · ${esc(x.base_unit)}</option>`).join('')}</select></div><div class="field"><label>QUANTITY</label><input id="srQty" type="number" min="0" step=".001"></div><div class="field"><label>UNIT</label><select id="srUnit"></select></div></div><button class="primary" onclick="saveStockRequest()">Send Stock Request</button>`);stockRequestIngredientChanged();
}
function stockRequestIngredientChanged(){const x=ingredients().find(i=>i.sku===document.getElementById('srIng')?.value),e=document.getElementById('srUnit');if(x&&e)e.innerHTML=stockTransferUnitOptions(x,stockTransferUnits(x)[0]);}
function saveStockRequest(){
 const sku=document.getElementById('srIng')?.value,x=ingredients().find(i=>i.sku===sku),q=Number(document.getElementById('srQty')?.value||0),u=document.getElementById('srUnit')?.value,branch=currentBranch();if(!x||stockTransferCanonical(q,u,x)===null)return alert('Enter a valid quantity and compatible unit.');if(!branch)return alert('Branch not found.');
 let a=getArr(STOCK_REQUEST_KEY),id=Date.now(),now=new Date().toISOString();a.push({id,ref:'REQ-'+String(a.length+1).padStart(4,'0'),branch_id:branch.id,branch:branch.name,sku:x.sku,ingredient:x.name,qty:q,unit:u,requested_by:currentActor(),requested_at:now,created_at:now,status:'Requested'});setArr(STOCK_REQUEST_KEY,a);closeModal();openPage('Stock Requests');
}
function acceptStockRequest(id){
 if(session!=='store'||!centralStockReady())return;let req=getArr(STOCK_REQUEST_KEY),r=req.find(x=>x.id===id);if(!r||r.status!=='Requested')return;
 const x=ingredients().find(i=>i.sku===r.sku);if(!x)return alert('Ingredient not found.');
 const need=stockTransferCanonical(r.qty,r.unit,x),have=centralStockCanonical(x);if(need===null)return alert('This unit requires a valid Master List pack conversion.');if(need>have+1e-9)return alert(`Not enough Central Store stock. Available: ${cleanQty(fromCanonical(have,x.base_unit))} ${x.base_unit}`);
 r.status='Accepted';r.accepted_by=currentActor();r.accepted_at=new Date().toISOString();setArr(STOCK_REQUEST_KEY,req);openPage('Stock Requests');
}
function previewTransferDispatchPhoto(file){
 transferDispatchPhotoData='';const p=document.getElementById('tsPhotoPreview');if(p)p.innerHTML='';
 if(!file)return;const rd=new FileReader();rd.onload=e=>{transferDispatchPhotoData=e.target.result;if(p)p.innerHTML=`<img src="${transferDispatchPhotoData}" style="display:block;max-width:180px;max-height:130px;margin-top:10px;border-radius:10px;object-fit:cover">`};rd.readAsDataURL(file);
}
function sendStockRequest(id){
 if(session!=='store'||!centralStockReady())return;let req=getArr(STOCK_REQUEST_KEY),r=req.find(x=>x.id===id);if(!r||r.status!=='Accepted')return;
 let a=ingredients(),x=a.find(i=>i.sku===r.sku);if(!x)return alert('Ingredient not found.');
 const have=fromCanonical(centralStockCanonical(x),x.base_unit);
 transferDispatchPhotoData='';
 modal(`<div class="modalHead"><div><div class="sub">CENTRAL STORE DISPATCH</div><h2>${esc(r.ref)} · ${esc(r.ingredient)}</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="note"><b>Requested by:</b> ${esc(r.branch)} · ${cleanQty(r.qty)} ${esc(r.unit)}<br><b>Central Store available:</b> ${cleanQty(have)} ${esc(x.base_unit)}</div>
 <div class="formGrid">
  <div class="field"><label>ACTUAL SENT QTY *</label><input id="tsQty" type="number" min="0" step=".001" value="${Number(r.qty)}"></div>
  <div class="field"><label>UNIT</label><input value="${esc(r.unit)}" disabled></div>
  <div class="field"><label>BATCH / LOT *</label><input id="tsBatch" placeholder="Batch or lot number"></div>
  <div class="field"><label>EXPIRY DATE *</label><input id="tsExpiry" type="date"></div>
  <div class="field"><label>DISPATCH TEMPERATURE °C</label><input id="tsTemp" type="number" step=".1" placeholder="e.g. 3.5"></div>
  <div class="field"><label>NOTE</label><input id="tsNote" placeholder="Optional dispatch note"></div>
 </div>
 <label class="filePick"><b>DISPATCH PHOTO PROOF *</b><br><small>Attach a photo of the stock being sent.</small><input id="tsPhoto" type="file" accept="image/*" capture="environment" onchange="previewTransferDispatchPhoto(this.files[0])"><div id="tsPhotoPreview"></div></label>
 <button class="primary" onclick="confirmStockRequestDispatch(${r.id})">Send to Restaurant</button>`);
}
function confirmStockRequestDispatch(id){
 if(session!=='store'||!centralStockReady())return;
 if(teamCloudAuth?.staff_name)return alert('Live stock dispatch is not yet connected to a secure Supabase transfer transaction. No inventory was changed.');
 let req=getArr(STOCK_REQUEST_KEY),r=req.find(x=>x.id===id);if(!r||r.status!=='Accepted')return;
 let a=ingredients(),x=a.find(i=>i.sku===r.sku);if(!x)return alert('Ingredient not found.');
 const q=Number(document.getElementById('tsQty')?.value||0),batch=(document.getElementById('tsBatch')?.value||'').trim(),
       expiry=document.getElementById('tsExpiry')?.value||'',temp=(document.getElementById('tsTemp')?.value||'').trim(),
       note=(document.getElementById('tsNote')?.value||'').trim();
 if(q<=0)return alert('Enter the actual quantity being sent.');
 if(!batch)return alert('Batch / lot number is required.');
 if(!expiry)return alert('Expiry date is required.');
 if(!transferDispatchPhotoData)return alert('Dispatch photo proof is required.');
 const need=stockTransferCanonical(q,r.unit,x),have=centralStockCanonical(x);if(need===null)return alert('Missing or incompatible Master List unit conversion.');
 if(need>have+1e-9)return alert(`Not enough Central Store stock. Available: ${cleanQty(fromCanonical(have,x.base_unit))} ${x.base_unit}`);
 x.stock_canonical=have-need;x.stock=fromCanonical(x.stock_canonical,x.base_unit);x.stock_location='Central Store';saveIngredients(a);
 const now=new Date().toISOString();
 Object.assign(r,{status:'In Transfer',sent_qty:q,sent_by:currentActor(),sent_at:now,fulfilled_by:currentActor(),fulfilled_at:now,
   dispatch_batch:batch,dispatch_expiry:expiry,dispatch_temperature:temp,dispatch_note:note,dispatch_photo:transferDispatchPhotoData});
 setArr(STOCK_REQUEST_KEY,req);
 let tr=getArr(TRANSFER_KEY);tr.push({id:Date.now(),request_id:r.id,ref:r.ref,sku:x.sku,ingredient:x.name,qty:q,unit:r.unit,canonical:need,
   from:'Central Store',to:r.branch,to_location_id:r.branch_id,staff:currentActor(),sent_by:currentActor(),sent_at:now,status:'In Transfer',
   batch,expiry_date:expiry,dispatch_temperature:temp,note,dispatch_photo:transferDispatchPhotoData});
 setArr(TRANSFER_KEY,tr);
 closeModal();openPage('Stock Requests');alert(`${cleanQty(q)} ${r.unit} ${r.ingredient} sent to ${r.branch}. Waiting for restaurant receiving confirmation.`);
}
function previewTransferReceiptPhoto(file){
 transferReceiptPhotoData='';const p=document.getElementById('trPhotoPreview');if(p)p.innerHTML='';
 if(!file)return;const rd=new FileReader();rd.onload=e=>{transferReceiptPhotoData=e.target.result;if(p)p.innerHTML=`<img src="${transferReceiptPhotoData}" style="display:block;max-width:180px;max-height:130px;margin-top:10px;border-radius:10px;object-fit:cover">`};rd.readAsDataURL(file);
}
function openTransferReceiving(id){
 if(session!=='manager')return;const r=getArr(STOCK_REQUEST_KEY).find(x=>x.id===id&&x.branch===currentBranchName());if(!r||r.status!=='In Transfer')return;
 transferReceiptPhotoData='';
 modal(`<div class="modalHead"><div><div class="sub">RESTAURANT RECEIVING</div><h2>${esc(r.ref)} · ${esc(r.ingredient)}</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="note"><b>Central Store sent:</b> ${cleanQty(r.sent_qty||r.qty)} ${esc(r.unit)}<br><b>To:</b> ${esc(r.branch)}<br><b>Batch / Lot:</b> ${esc(r.dispatch_batch||'—')}<br><b>Expiry:</b> ${esc(r.dispatch_expiry||'—')}<br><b>Dispatch temperature:</b> ${r.dispatch_temperature!==''&&r.dispatch_temperature!=null?esc(r.dispatch_temperature)+'°C':'Not checked'}</div>
 <div class="formGrid">
 <div class="field"><label>ACTUAL DELIVERED QTY</label><input id="trDelivered" type="number" min="0" step=".001" value="${Number(r.sent_qty||r.qty)}"></div>
 <div class="field"><label>REJECTED QTY</label><input id="trRejected" type="number" min="0" step=".001" value="0"></div>
 <div class="field"><label>UNIT</label><input value="${esc(r.unit)}" disabled></div>
 <div class="field"><label>ACTUAL TEMPERATURE °C · OPTIONAL</label><input id="trTemp" type="number" step=".1" placeholder="Leave blank if not checked"></div>
 <div class="field"><label>TEMPERATURE CHECK</label><select id="trTempCheck"><option>Not Checked</option><option>Pass</option><option>Fail</option></select></div>
 <div class="field"><label>PACKAGING</label><select id="trPackaging"><option>Pass</option><option>Fail</option></select></div>
 <div class="field"><label>PRODUCT QUALITY / APPEARANCE</label><select id="trQuality"><option>Pass</option><option>Fail</option></select></div>
 <div class="field"><label>NOTE / REASON</label><input id="trNote" placeholder="Required for failure, rejection or variance"></div></div>
 <label class="filePick"><b>PHOTO PROOF *</b><br><small>Take or attach a photo of the stock received.</small><input id="trPhoto" type="file" accept="image/*" capture="environment" onchange="previewTransferReceiptPhoto(this.files[0])"><div id="trPhotoPreview"></div></label>
 <button class="primary" onclick="confirmTransferReceipt(${r.id})">Confirm Restaurant Receipt</button>`);
}
function confirmTransferReceipt(id){
 if(teamCloudAuth?.staff_name)return alert('Live stock receipt is not yet connected to a secure Supabase transaction. No inventory was changed.');
 let req=getArr(STOCK_REQUEST_KEY),r=req.find(x=>x.id===id);if(!r||r.status!=='In Transfer'||session!=='manager'||r.branch!==currentBranchName())return;
 const delivered=Number(document.getElementById('trDelivered')?.value||0),rejected=Number(document.getElementById('trRejected')?.value||0),sent=Number(r.sent_qty||r.qty),accepted=delivered-rejected;
 const temp=(document.getElementById('trTemp')?.value||'').trim(),tempCheck=document.getElementById('trTempCheck')?.value||'Not Checked',pack=document.getElementById('trPackaging')?.value||'Pass',quality=document.getElementById('trQuality')?.value||'Pass',note=(document.getElementById('trNote')?.value||'').trim();
 if(delivered<0||rejected<0||rejected>delivered)return alert('Check delivered and rejected quantities.');
 if(!transferReceiptPhotoData)return alert('Photo proof is required.');
 const variance=delivered-sent,failed=tempCheck==='Fail'||pack==='Fail'||quality==='Fail'||rejected>0||Math.abs(variance)>.000001;
 if(failed&&!note)return alert('Add a note / reason for rejection, failed check or quantity variance.');
 let a=ingredients(),x=a.find(i=>i.sku===r.sku);if(!x)return alert('Ingredient not found.');
 const acceptedCanonical=toCanonical(accepted,r.unit);setBranchStockCanonical(x,r.branch_id,branchStockCanonical(x,r.branch_id)+acceptedCanonical);saveIngredients(a);
 const now=new Date().toISOString();Object.assign(r,{status:'Received',delivered_qty:delivered,rejected_qty:rejected,accepted_qty:accepted,transfer_variance_qty:variance,receiving_temperature:temp,temperature_check:tempCheck,packaging_check:pack,quality_check:quality,receiving_note:note,receiving_photo:transferReceiptPhotoData,received_by:currentActor(),received_at:now});setArr(STOCK_REQUEST_KEY,req);
 let tr=getArr(TRANSFER_KEY),t=tr.find(x=>x.request_id===r.id);if(t)Object.assign(t,{status:'Received',delivered_qty:delivered,rejected_qty:rejected,accepted_qty:accepted,variance_qty:variance,temperature:temp,temperature_check:tempCheck,packaging_check:pack,quality_check:quality,note,photo:transferReceiptPhotoData,received_by:currentActor(),received_at:now});setArr(TRANSFER_KEY,tr);
 let mv=getArr('kitch_demo_inventory_movements_v1');mv.push({id:Date.now(),type:'Central Store Transfer Received',sku:x.sku,ingredient:x.name,qty:accepted,unit:r.unit,location:r.branch,from:'Central Store',request:r.ref,staff:currentActor(),created_at:now});setArr('kitch_demo_inventory_movements_v1',mv);
 closeModal();openPage('Stock Requests');alert(`${cleanQty(accepted)} ${r.unit} accepted into ${r.branch} inventory.${Math.abs(variance)>.000001?' Transfer variance recorded: '+cleanQty(variance)+' '+r.unit+'.':''}`);
}
function viewStockRequest(id){
 const r=getArr(STOCK_REQUEST_KEY).find(x=>x.id===id);if(!r)return;
 const received=['Received','Completed'].includes(r.status),photo=r.receiving_photo?`<div style="margin-top:14px"><b>RECEIVING PHOTO PROOF</b><br><img class="proofImage" src="${r.receiving_photo}" alt="Transfer receiving proof"></div>`:'',dispatchPhoto=r.dispatch_photo?`<div style="margin-top:14px"><b>DISPATCH PHOTO PROOF</b><br><img class="proofImage" src="${r.dispatch_photo}" alt="Store dispatch proof"></div>`:'';
 modal(`<div class="modalHead"><div><div class="sub">STOCK REQUEST AUDIT TRAIL</div><h2>${esc(r.ref)} · ${esc(r.ingredient)}</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="grid" style="margin-top:16px"><div class="card"><span>BRANCH</span><b style="font-size:16px">${esc(r.branch)}</b></div><div class="card"><span>REQUESTED</span><b style="font-size:16px">${cleanQty(r.qty)} ${esc(r.unit)}</b></div><div class="card"><span>SENT</span><b style="font-size:16px">${r.sent_qty!=null?cleanQty(r.sent_qty)+' '+esc(r.unit):'—'}</b></div><div class="card"><span>ACCEPTED</span><b style="font-size:16px">${r.accepted_qty!=null?cleanQty(r.accepted_qty)+' '+esc(r.unit):'—'}</b></div></div>
 ${requestTimeline(r)}
 ${r.sent_at?`<div class="panel" style="margin-top:12px"><h2>Central Store Dispatch Details</h2><table><tr><th>SENT QTY</th><th>BATCH / LOT</th><th>EXPIRY</th><th>DISPATCH TEMP</th><th>SENT BY</th></tr><tr><td>${cleanQty(r.sent_qty||0)} ${esc(r.unit)}</td><td>${esc(r.dispatch_batch||'—')}</td><td>${esc(r.dispatch_expiry||'—')}</td><td>${r.dispatch_temperature!==''&&r.dispatch_temperature!=null?esc(r.dispatch_temperature)+'°C':'Not checked'}</td><td>${esc(r.sent_by||'—')}</td></tr></table><div class="note"><b>Dispatch note:</b> ${esc(r.dispatch_note||'—')}</div>${dispatchPhoto}</div>`:''}
 ${received?`<div class="panel" style="margin-top:12px"><h2>Restaurant Receiving Details</h2><table><tr><th>DELIVERED</th><th>REJECTED</th><th>VARIANCE</th><th>TEMP</th><th>TEMP CHECK</th><th>PACKAGING</th><th>QUALITY</th></tr><tr><td>${cleanQty(r.delivered_qty)} ${esc(r.unit)}</td><td>${cleanQty(r.rejected_qty)} ${esc(r.unit)}</td><td>${cleanQty(r.transfer_variance_qty||0)} ${esc(r.unit)}</td><td>${r.receiving_temperature!==''&&r.receiving_temperature!=null?esc(r.receiving_temperature)+'°C':'Not checked'}</td><td>${esc(r.temperature_check||'Not Checked')}</td><td>${esc(r.packaging_check||'—')}</td><td>${esc(r.quality_check||'—')}</td></tr></table><div class="note"><b>Received by:</b> ${esc(r.received_by||'—')}<br><b>Note:</b> ${esc(r.receiving_note||'—')}</div>${photo}</div>`:''}`);
}
function transferReportRecord(t){
 const r=getArr(STOCK_REQUEST_KEY).find(x=>String(x.id)===String(t.request_id)||x.ref===t.ref)||{};
 return {...r,...t,requested_by:r.requested_by||'Central Store · Direct Transfer',requested_at:r.requested_at||t.sent_at,accepted_by:r.accepted_by||t.sent_by,accepted_at:r.accepted_at||t.sent_at,received_by:r.received_by||t.received_by,received_at:r.received_at||t.received_at,accepted_qty:r.accepted_qty??t.accepted_qty,delivered_qty:r.delivered_qty??t.delivered_qty,rejected_qty:r.rejected_qty??t.rejected_qty,dispatch_note:r.dispatch_note||t.note,receiving_note:r.receiving_note||t.receiving_note};
}
function transferDate(d){if(!d)return 'Pending';const v=new Date(d);return Number.isNaN(v.getTime())?'—':v.toLocaleString()}
function transferAudit(id){const t=getArr(TRANSFER_KEY).find(x=>String(x.id)===String(id));if(!t)return alert('Transfer not found.');const r=transferReportRecord(t);
 const fields=[['Requested by',r.requested_by,r.requested_at],['Approved by',r.accepted_by,r.accepted_at],['Dispatched by',r.sent_by||r.staff,r.sent_at],['Received by',r.received_by,r.received_at]];
 modal(`<div class="modalHead"><div><div class="sub">KITCH · TRANSFER AUDIT</div><h2>${esc(r.ref||'Direct Transfer')}</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="note"><b>${esc(r.from||'Central Store')} → ${esc(r.to||r.branch||'Main Kitchen')}</b><br>${esc(r.ingredient||'')} · ${cleanQty(r.qty||0)} ${esc(r.unit||'')} · ${esc(r.status||'Pending')}</div><div class="grid" style="margin:14px 0">${fields.map(([label,name,date])=>`<div class="card"><span>${label.toUpperCase()}</span><b style="font-size:16px">${esc(name||'Pending')}</b><small>${esc(transferDate(date))}</small></div>`).join('')}</div><div class="panel"><h2>Quantity & Quality</h2><table><tr><th>REQUESTED</th><th>DISPATCHED</th><th>RECEIVED / ACCEPTED</th><th>REJECTED</th></tr><tr><td>${cleanQty(r.qty||0)} ${esc(r.unit||'')}</td><td>${r.sent_at?cleanQty(r.sent_qty??r.qty)+' '+esc(r.unit||''):'Pending'}</td><td>${r.received_at?cleanQty(r.accepted_qty??0)+' '+esc(r.unit||''):'Pending'}</td><td>${r.received_at?cleanQty(r.rejected_qty??0)+' '+esc(r.unit||''):'Pending'}</td></tr></table><p class="muted">Batch: ${esc(r.dispatch_batch||r.batch||'—')} · Expiry: ${esc(r.dispatch_expiry||r.expiry_date||'—')}</p><p class="muted">Dispatch note: ${esc(r.dispatch_note||'—')}<br>Receiving note: ${esc(r.receiving_note||'—')}</p></div><button class="primary" onclick="printTransferReport(${JSON.stringify(String(t.id)).replace(/"/g,'&quot;')})">Print / Save PDF Report</button>`);
}
function printTransferReport(id){const t=getArr(TRANSFER_KEY).find(x=>String(x.id)===String(id));if(!t)return alert('Transfer not found.');const r=transferReportRecord(t);const row=(k,v)=>`<tr><th>${esc(k)}</th><td>${esc(String(v??'—'))}</td></tr>`;
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>KITCH Transfer ${esc(r.ref||'Report')}</title><style>body{font:14px Arial,sans-serif;color:#171717;margin:38px}header{border-bottom:3px solid #111;padding-bottom:18px;display:flex;justify-content:space-between;align-items:end}h1{font-size:28px;margin:0}h2{font-size:17px;margin:28px 0 10px}small{color:#777}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:11px;text-align:left;vertical-align:top}th{width:36%;background:#f6f6f6}footer{margin-top:35px;padding-top:12px;border-top:1px solid #ddd;color:#777;font-size:11px}.badge{border:1px solid #111;border-radius:20px;padding:7px 13px;font-weight:bold}@media print{body{margin:20mm}.no-print{display:none}}</style></head><body><header><div><h1>KITCH</h1><small>STOCK TRANSFER · AUDIT REPORT</small></div><div class="badge">${esc(r.status||'Pending')}</div></header><h2>Transfer Details</h2><table>${row('Reference',r.ref||'Direct')}${row('From',r.from||'Central Store')}${row('To',r.to||r.branch||'—')}${row('Ingredient',r.ingredient)}${row('Unit',r.unit)}${row('Requested quantity',cleanQty(r.qty||0))}${row('Dispatched quantity',r.sent_at?cleanQty(r.sent_qty??r.qty):'Pending')}${row('Accepted quantity',r.received_at?cleanQty(r.accepted_qty??0):'Pending')}${row('Rejected quantity',r.received_at?cleanQty(r.rejected_qty??0):'Pending')}</table><h2>Approval & Chain of Custody</h2><table>${row('Requested by',r.requested_by||'—')}${row('Requested at',transferDate(r.requested_at))}${row('Approved by',r.accepted_by||'Pending')}${row('Approved at',transferDate(r.accepted_at))}${row('Dispatched by',r.sent_by||r.staff||'Pending')}${row('Dispatched at',transferDate(r.sent_at))}${row('Received by',r.received_by||'Pending')}${row('Received at',transferDate(r.received_at))}</table><h2>Batch & Notes</h2><table>${row('Batch / lot',r.dispatch_batch||r.batch||'—')}${row('Expiry',r.dispatch_expiry||r.expiry_date||'—')}${row('Dispatch temperature',r.dispatch_temperature??'—')}${row('Receiving temperature',r.receiving_temperature??'—')}${row('Dispatch note',r.dispatch_note||'—')}${row('Receiving note',r.receiving_note||'—')}</table><footer>Generated ${esc(new Date().toLocaleString())} · KITCH · Fields marked Pending have not yet been confirmed. This report reflects available transfer records; no signatures or missing values are fabricated.</footer><p class="no-print"><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`;
 const w=window.open('','_blank');if(!w)return alert('Allow pop-ups to print this report.');w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),450);
}
function transferPage(){
 if(session!=='store')return `<div class="panel"><h2>Stock Transfer</h2><p class="muted">Kitchen Managers confirm transfers from Stock Requests. Central Store dispatches here.</p></div>`;
 if(!hasCentralStore())return `<div class="panel"><h2>Stock Transfer</h2><p class="muted">This package receives directly into restaurant stock.</p></div>`;
 const a=ingredients(),tr=getArr(TRANSFER_KEY).slice().reverse(),pending=tr.filter(x=>!['Received','Completed'].includes(x.status)).length,complete=tr.length-pending;
 return `<div class="panel" style="background:linear-gradient(125deg,#fff,#f5f5f5)"><div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><div><div class="sub">CENTRAL STORE · OPERATIONS</div><h2 style="font-size:26px;margin:8px 0">Stock Transfers</h2><p class="muted">Track each request, approval, dispatch and receiving confirmation. Download a complete PDF audit report.</p></div><button class="btn black" onclick="openTransfer()">+ Direct Transfer</button></div><div class="grid" style="margin-top:20px"><div class="card"><span>TOTAL TRANSFERS</span><b>${tr.length}</b></div><div class="card"><span>IN PROGRESS</span><b>${pending}</b></div><div class="card"><span>COMPLETED</span><b>${complete}</b></div><div class="card"><span>INGREDIENTS</span><b>${a.length}</b></div></div></div>
 <div class="panel"><h2>Transfer Register</h2><p class="muted">Open a transfer for full staff accountability and quantity checks. Reports can be printed or saved as PDF.</p><div style="overflow-x:auto"><table><tr><th>REFERENCE</th><th>INGREDIENT</th><th>FROM → TO</th><th>QUANTITY</th><th>REQUESTED BY</th><th>APPROVED BY</th><th>RECEIVED BY</th><th>STATUS</th><th>REPORT</th></tr>${tr.map(t=>{const r=transferReportRecord(t);return `<tr><td><b>${esc(r.ref||'Direct')}</b><br><small>${esc(transferDate(r.sent_at))}</small></td><td><b>${esc(r.ingredient||'—')}</b></td><td>${esc(r.from||'Central Store')} → ${esc(r.to||r.branch||'—')}</td><td>${cleanQty(r.qty||0)} ${esc(r.unit||'')}</td><td>${esc(r.requested_by||'—')}</td><td>${esc(r.accepted_by||'Pending')}</td><td>${esc(r.received_by||'Pending')}</td><td><b>${esc(r.status||'Pending')}</b></td><td><button class="btn" onclick="transferAudit('${String(t.id).replace(/'/g,'')}')">Details</button> <button class="btn black" onclick="printTransferReport('${String(t.id).replace(/'/g,'')}')">PDF</button></td></tr>`}).join('')||'<tr><td colspan="9" class="empty">No transfers yet. Transfers will appear here after dispatch.</td></tr>'}</table></div></div>
 <div class="panel"><h2>Central Store Availability</h2><p class="muted">Current available quantities from the ingredient inventory. Zero means no recorded stock at Central Store.</p><div style="overflow-x:auto;max-height:360px;overflow-y:auto"><table><tr><th>INGREDIENT</th><th>AVAILABLE</th><th>BASE UNIT</th></tr>${a.map(x=>`<tr><td>${esc(x.name)}</td><td><b>${fromCanonical(centralStockCanonical(x),x.base_unit).toFixed(3)}</b></td><td>${esc(x.base_unit)}</td></tr>`).join('')}</table></div></div>`;
}
function transferSelectedIngredient(){const a=ingredients(),x=a.find(i=>i.sku===document.getElementById('tIng')?.value);if(!x)return;const unitEl=document.getElementById('tUnit'),avail=document.getElementById('tAvailable');if(unitEl)unitEl.innerHTML=stockTransferUnitOptions(x,stockTransferUnits(x)[0]);if(avail)avail.value=fromCanonical(centralStockCanonical(x),x.base_unit).toFixed(3)+' '+x.base_unit}
function openTransfer(){
 const a=ingredients(),dest=locations().filter(x=>x.type==='Branch'&&x.status==='Active');if(!dest.length)return alert('No active restaurant / brand location.');
 modal(`<div class="modalHead"><h2>Direct Transfer</h2><button class="close" onclick="closeModal()">×</button></div><div class="note">For normal branch replenishment, use Stock Requests. Direct transfers also require restaurant receiving confirmation.</div><div class="formGrid"><div class="field"><label>INGREDIENT</label><select id="tIng" class="ingredientSelect" onchange="transferSelectedIngredient()">${a.map(x=>`<option value="${esc(x.sku)}">${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>AVAILABLE · CENTRAL STORE</label><input id="tAvailable" disabled></div><div class="field"><label>TRANSFER TO</label><select id="tDestination">${dest.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>QUANTITY</label><input id="tQty" type="number" min="0" step=".001"></div><div class="field"><label>UNIT</label><select id="tUnit"></select></div></div><button class="primary" onclick="confirmTransfer()">Send Direct Transfer</button>`);transferSelectedIngredient();
}
function confirmTransfer(){
 if(teamCloudAuth?.staff_name)return alert('Live stock transfer is not yet connected to a secure Supabase transaction. No inventory was changed.');
 let a=ingredients(),sku=document.getElementById('tIng')?.value,x=a.find(i=>i.sku===sku),q=Number(document.getElementById('tQty')?.value||0),destId=document.getElementById('tDestination')?.value,dest=locations().find(l=>String(l.id)===String(destId)&&l.type==='Branch'&&l.status==='Active');
 if(!centralStockReady())return;if(!dest||!x||q<=0)return alert('Choose a valid destination and quantity.');
 const u=document.getElementById('tUnit')?.value,need=stockTransferCanonical(q,u,x),have=centralStockCanonical(x);if(need===null)return alert('Missing or incompatible Master List unit conversion.');if(need>have)return alert(`Not enough Central Store stock. Available: ${cleanQty(fromCanonical(have,u))} ${u}`);
 x.stock_canonical=have-need;x.stock=fromCanonical(x.stock_canonical,u);saveIngredients(a);
 let req=getArr(STOCK_REQUEST_KEY),id=Date.now(),ref='TR-'+String(id).slice(-6),now=new Date().toISOString();req.push({id,ref,branch_id:dest.id,branch:dest.name,sku:x.sku,ingredient:x.name,qty:q,unit:u,requested_by:'Central Store · Direct Transfer',requested_at:now,accepted_by:currentActor(),accepted_at:now,sent_by:currentActor(),sent_at:now,sent_qty:q,status:'In Transfer'});setArr(STOCK_REQUEST_KEY,req);
 let tr=getArr(TRANSFER_KEY);tr.push({id:Date.now()+1,request_id:id,ref,sku:x.sku,ingredient:x.name,qty:q,unit:u,canonical:need,from:'Central Store',to:dest.name,to_location_id:dest.id,staff:currentActor(),sent_by:currentActor(),sent_at:now,status:'In Transfer'});setArr(TRANSFER_KEY,tr);
 closeModal();openPage('Stock Transfer');alert(`${q} ${u} ${x.name} sent to ${dest.name}. Waiting for restaurant confirmation.`);
}

const BATCH_KEY='kitch_demo_batches_v1';
function dateOnly(d){return new Date(d+'T00:00:00')}
function batchStatus(x){
 const today=new Date();today.setHours(0,0,0,0);
 const exp=dateOnly(x.expiry_date),days=Math.ceil((exp-today)/86400000);
 if(days<0)return {label:'EXPIRED',cls:'bad',days};
 if(days<=3)return {label:'EXPIRING SOON',cls:'warn',days};
 return {label:'OK',cls:'ok',days};
}
function batchesPage(){
 const a=getArr(BATCH_KEY).slice().sort((x,y)=>String(x.expiry_date).localeCompare(String(y.expiry_date)));
 const expired=a.filter(x=>batchStatus(x).label==='EXPIRED').length;
 const soon=a.filter(x=>batchStatus(x).label==='EXPIRING SOON').length;
 const rows=a.map(x=>{const st=batchStatus(x);return `<tr>
 <td><b>${esc(x.ingredient)}</b><br><small>${esc(x.sku)}</small></td>
 <td>${esc(x.supplier)}</td><td>${esc(x.po)}</td><td>${esc(x.lot||'—')}</td>
 <td>${Number(x.received_qty).toFixed(2)} ${esc(x.unit)}</td>
 <td>${Number(x.remaining_qty).toFixed(2)} ${esc(x.unit)}</td>
 <td>${esc(x.received_date)}</td><td>${esc(x.expiry_date)}</td>
 <td><span class="${st.cls}"><b>${st.label}</b></span>${st.days>=0?`<br><small>${st.days} day${st.days===1?'':'s'} left</small>`:''}</td></tr>`}).join('');
 return `<div class="grid"><div class="card"><span>ACTIVE BATCHES</span><b>${a.filter(x=>Number(x.remaining_qty)>0).length}</b></div>
 <div class="card"><span>EXPIRING SOON</span><b>${soon}</b></div><div class="card"><span>EXPIRED</span><b>${expired}</b></div>
 <div class="card"><span>FEFO</span><b>${a.length?'ON':'—'}</b></div></div>
 <div class="panel"><h2>Expiry & Batches</h2><p class="muted">Accepted deliveries create batches automatically. Closest expiry is listed first for FEFO control.</p>
 <table><tr><th>INGREDIENT</th><th>SUPPLIER</th><th>PO</th><th>BATCH / LOT</th><th>RECEIVED</th><th>REMAINING</th><th>RECEIVED DATE</th><th>EXPIRY</th><th>STATUS</th></tr>
 ${rows||'<tr><td colspan="11" class="empty">No batches yet. Receive an ingredient delivery to create the first batch.</td></tr>'}</table></div>`;
}


function filterIngredients(){
 const q=(document.getElementById('ingredientSearch')?.value||'').trim().toLowerCase();
 document.querySelectorAll('.ingredientRow').forEach(row=>{
   row.style.display=(!q||row.dataset.name.includes(q)||row.dataset.category.includes(q))?'':'none';
 });
}


const RECIPE_KEY='kitch_demo_recipes_v1';
function recipes(){return getArr(RECIPE_KEY)}
function normIngName(v){return String(v||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function ingTokenKey(v){return normIngName(v).split(' ').filter(Boolean).sort().join(' ')}
function editDistance(a,b){a=normIngName(a);b=normIngName(b);const dp=Array(b.length+1).fill(0).map((_,j)=>j);for(let i=1;i<=a.length;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=b.length;j++){const old=dp[j];dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return dp[b.length]}
function ingredientForRecipeItem(it,master=ingredients()){
 if(it.sku){const bySku=master.find(x=>x.sku===it.sku);if(bySku)return bySku}
 const n=normIngName(it.ingredient);
 let hits=master.filter(x=>normIngName(x.name)===n);if(hits.length===1)return hits[0];
 const tk=ingTokenKey(it.ingredient);hits=master.filter(x=>ingTokenKey(x.name)===tk);if(hits.length===1)return hits[0];
 hits=master.filter(x=>editDistance(x.name,it.ingredient)<=1);if(hits.length===1)return hits[0];
 return null
}
function linkRecipeIngredients(){
 const a=recipes(),m=ingredients();let changed=false;
 a.forEach(r=>(r.items||[]).forEach(it=>{const x=ingredientForRecipeItem(it,m);if(x&&it.sku!==x.sku){it.sku=x.sku;changed=true}}));
 if(changed)setArr(RECIPE_KEY,a);return changed
}
function recipeYieldPercent(it){
 const n=Number(it.yield_pct ?? 100);
 return Number.isFinite(n)&&n>0&&n<=100?n:100;
}
function recipeUsableQty(it){return Number(it.qty||0)*recipeYieldPercent(it)/100}
function recipeIngredientCost(it,master=ingredients()){
 const ing=ingredientForRecipeItem(it,master);if(!ing)return null;
 const price=kitchSupplierPrice(ing,'latest_cost')||kitchSupplierPrice(ing,'reference_cost');
 if(!(price>0))return null;
 let q=Number(it.qty||0),u=unit(it.unit);
 // Supplier pricing is normalized per kg/L/piece; raw AP quantity is billed and deducted.
 if(u==='g'||u==='ml')q/=1000;
 return q*price;
}
function recipeCostDetails(r){
 const master=ingredients(),missingPrices=[],missingIngredients=[];
 const total=(r.items||[]).reduce((t,it)=>{
   const ing=ingredientForRecipeItem(it,master);
   if(!ing){missingIngredients.push(it.ingredient);return t}
   const cost=recipeIngredientCost(it,master);
   if(cost===null){missingPrices.push(ing.name);return t}
   return t+cost;
 },0);
 return {total,missingPrices,missingIngredients,complete:!missingPrices.length&&!missingIngredients.length};
}
function recipeYieldRows(r,showCost){
 const master=ingredients();
 return `<table><tr><th>INGREDIENT</th><th>RAW (AP)</th><th>YIELD %</th><th>USABLE / COOKED (EP)</th><th>AP / EP FACTOR</th>${showCost?'<th>SUPPLIER PRICE</th><th>ING. COST</th>':''}</tr>${(r.items||[]).map(it=>{
  const x=ingredientForRecipeItem(it,master),pct=recipeYieldPercent(it),cost=recipeIngredientCost(it,master);
  const price=x?(kitchSupplierPrice(x,'latest_cost')||kitchSupplierPrice(x,'reference_cost')):0;
  return `<tr><td><b>${esc(it.ingredient)}</b>${!x?'<small class="bad"> · Unmatched</small>':''}</td><td>${cleanQty(it.qty)} ${esc(it.unit)}</td><td>${pct}%</td><td><b>${cleanQty(recipeUsableQty(it))} ${esc(it.unit)}</b></td><td>${(100/pct).toFixed(3)}×</td>${showCost?`<td>${price>0?'AED '+price.toFixed(2):'<span class="bad">Missing</span>'}</td><td>${cost!==null?'AED '+cost.toFixed(2):'<span class="bad">Missing</span>'}</td>`:''}</tr>`
 }).join('')}</table>`;
}
function recipeCost(r){return recipeCostDetails(r).total}
function recipeCostLabel(r){const d=recipeCostDetails(r);return d.complete?'AED '+d.total.toFixed(2):'Price missing'}
function recipeNeedsReview(r){const d=recipeCostDetails(r);return !d.complete}

function recipeMissing(r){
 const m=ingredients();return r.items.filter(it=>!ingredientForRecipeItem(it,m)).map(x=>x.ingredient)
}

function recipeInput(r){
 const totals={kg:0,ltr:0,pcs:0,other:[]};
 r.items.forEach(it=>{
   let q=Number(it.qty||0),u=unit(it.unit);
   if(u==='g'){totals.kg+=q/1000}
   else if(u==='kg'){totals.kg+=q}
   else if(u==='ml'){totals.ltr+=q/1000}
   else if(u==='ltr'){totals.ltr+=q}
   else if(u==='pcs'){totals.pcs+=q}
   else if(q){totals.other.push(q+' '+u)}
 });
 let parts=[];
 if(totals.kg)parts.push(totals.kg.toFixed(3).replace(/\.?0+$/,'')+' kg');
 if(totals.ltr)parts.push(totals.ltr.toFixed(3).replace(/\.?0+$/,'')+' ltr');
 if(totals.pcs)parts.push(totals.pcs+' pcs');
 return parts.concat(totals.other).join(' + ')||'—';
}
function recipesPage(){
 linkRecipeIngredients();
 const a=recipes().slice().sort((x,y)=>x.name.localeCompare(y.name));
 const manage=session==='manager',chef=session==='production';
 if(chef){
  const approved=a.filter(r=>!recipeNeedsReview(r));
  return `<div class="grid"><div class="card"><span>MY RECIPES</span><b>${approved.length}</b></div><div class="card"><span>ROLE</span><b style="font-size:18px">Chef Production</b></div><div class="card"><span>PRODUCTION</span><b style="font-size:18px">Ready</b></div><div class="card"><span>LABEL</span><b style="font-size:18px">Ready</b></div></div>
  <div class="panel"><h2>Approved Recipes</h2><p class="muted">View the recipes assigned for production. Costs and purchasing prices are hidden.</p>
  <table><tr><th>RECIPE</th><th>CATEGORY</th><th>INGREDIENTS</th><th>INPUT QTY</th><th>PORTIONS</th><th>STATUS</th></tr>
  ${approved.map(r=>`<tr onclick="viewRecipe(${r.id})" style="cursor:pointer"><td><b>${esc(r.name)}</b><br><small>1 Batch</small></td><td>${esc(r.category||'—')}</td><td>${r.items.length}</td><td>${recipeInput(r)}</td><td>${Number(r.portions||0)||'—'}</td><td><span class="ok"><b>APPROVED</b></span></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No approved recipes assigned yet.</td></tr>'}</table></div>`;
 }
 return `<div class="grid"><div class="card"><span>RECIPES</span><b>${a.length}</b></div><div class="card"><span>APPROVED</span><b>${a.filter(x=>!recipeNeedsReview(x)).length}</b></div><div class="card"><span>NEEDS REVIEW</span><b>${a.filter(x=>recipeNeedsReview(x)).length}</b></div><div class="card"><span>1 BATCH RULE</span><b>ON</b></div></div>
 <div class="panel"><h2>Recipe Master</h2><p class="muted">Chef defines ingredient quantities in kg/g/ltr/ml/pcs for exactly 1 Batch. KITCH converts units automatically and Production will deduct from the production location stock.</p>
 <div class="actions">${manage?'<button class="btn black" onclick="openRecipe()">+ Recipe</button><button class="btn" onclick="openRecipeImport()">Import Excel</button>':''}</div>
 <table><tr><th>RECIPE</th><th>CATEGORY</th><th>INGREDIENTS</th><th>RAW INPUT (AP)</th><th>FINISHED YIELD</th><th>PORTIONS</th><th>1 BATCH COST</th><th>STATUS</th></tr>
 ${a.map(r=>{let miss=recipeMissing(r),cost=recipeCost(r),costInfo=recipeCostDetails(r);return `<tr onclick="viewRecipe(${r.id})" style="cursor:pointer"><td><b>${esc(r.name)}</b><br><small>1 Batch</small></td><td>${esc(r.category||'—')}</td><td>${r.items.length}</td><td>${recipeInput(r)}</td><td>${r.yield?cleanQty(r.yield)+' '+esc(r.yield_unit||'kg'):'—'}</td><td>${Number(r.portions||0)||'—'}</td><td>${recipeCostLabel(r)}</td><td>${miss.length||costInfo.missingPrices.length?`<span class="warn"><b>NEEDS REVIEW</b></span><br><small>${miss.length?miss.length+" unmatched":costInfo.missingPrices.length+" missing prices"} · click recipe</small>`:'<span class="ok"><b>APPROVED</b></span>'}</td></tr>`}).join('')||'<tr><td colspan="8" class="empty">No recipes yet. Add a recipe or import the sample Excel.</td></tr>'}</table></div>`;
}
function openRecipe(){
 if(session!=='manager')return;
 const m=ingredients();if(!m.length)return alert('Import the Ingredient Master first.');
 modal(`<div class="modalHead"><h2>Create 1 Batch Recipe</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="formGrid"><div class="field"><label>RECIPE NAME</label><input id="rcName"></div><div class="field"><label>CATEGORY</label><input id="rcCat"></div>
 <div class="field"><label>PORTIONS PER BATCH</label><input id="rcPortions" type="number" min="0" step="1"></div><div class="field"><label>EXPECTED FINISHED BATCH YIELD</label><input id="rcYield" type="number" min="0" step=".001" placeholder="e.g. 0.8"></div><div class="field"><label>FINISHED UNIT</label><select id="rcYieldUnit"><option>kg</option><option>g</option><option>ltr</option><option>ml</option><option>pcs</option></select></div></div>
 <div class="note">Raw (AP) quantity comes from the Ingredient Master. Usable/cooked (EP) = raw quantity × yield %. Stock OUT and purchasing cost always use raw AP.</div><h3>Ingredients</h3><div id="rcItems"></div><div class="actions"><button class="btn" onclick="addRecipeLine()">+ Ingredient Line</button></div>
 <button class="primary" onclick="saveRecipe()">Create 1 Batch Recipe</button>`);
 addRecipeLine();
}
function addRecipeLine(){
 const m=ingredients().slice().sort((a,b)=>a.name.localeCompare(b.name));
 document.getElementById('rcItems').insertAdjacentHTML('beforeend',`<div class="formGrid recipeLine" style="border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:12px">
 <div class="field"><label>INGREDIENT</label><select class="riIng ingredientSelect" onfocus="openIngredientSelect(this)" onblur="closeIngredientSelect(this)" onchange="closeIngredientSelect(this)">${m.map(x=>`<option value="${esc(x.name)}">${esc(x.name)} · ${esc(x.base_unit)}</option>`).join('')}</select></div>
 <div class="field"><label>RAW AP QUANTITY</label><input class="riQty" type="number" min="0" step=".001" oninput="updateRecipeLinePreview(this)"></div>
 <div class="field"><label>UNIT</label><select class="riUnit" onchange="updateRecipeLinePreview(this)"><option>kg</option><option>g</option><option>ltr</option><option>ml</option><option>pcs</option></select></div><div class="field"><label>COOKED / USABLE YIELD %</label><input class="riYield" type="number" min="0.01" max="100" step=".01" value="100" oninput="updateRecipeLinePreview(this)"></div><div class="field"><label>COOKED / USABLE EP</label><output class="riEp">Enter raw quantity</output></div></div>`)
}
function updateRecipeLinePreview(el){
 const line=el.closest('.recipeLine');if(!line)return;
 const q=Number(line.querySelector('.riQty').value||0),pct=Number(line.querySelector('.riYield').value||100),out=line.querySelector('.riEp');
 out.textContent=q>0&&pct>0&&pct<=100?cleanQty(q*pct/100)+' '+line.querySelector('.riUnit').value:'Enter valid AP and yield';
}
function saveRecipe(){
 let name=rcName.value.trim();if(!name)return alert('Enter recipe name.');
 let items=[...document.querySelectorAll('.recipeLine')].map(x=>{const name=x.querySelector('.riIng').value,master=ingredients().find(i=>i.name===name);return {ingredient:name,sku:master?.sku||'',qty:Number(x.querySelector('.riQty').value||0),unit:x.querySelector('.riUnit').value,yield_pct:Number(x.querySelector('.riYield').value||100)}}).filter(x=>x.qty>0);
 if(!items.length)return alert('Add at least one ingredient quantity.');
 if(items.some(it=>!(it.yield_pct>0&&it.yield_pct<=100)))return alert('Ingredient yield must be between 0 and 100%.');
 let a=recipes();if(a.some(x=>x.name.toLowerCase()===name.toLowerCase()))return alert('Recipe already exists.');
 a.push({id:Date.now(),name,category:rcCat.value.trim(),portions:Number(rcPortions.value||0),yield:Number(rcYield.value||0),yield_unit:rcYieldUnit.value,instructions:(document.getElementById('rcMethod')?.value||'').trim(),items});
 setArr(RECIPE_KEY,a);closeModal();openPage('Recipes')
}
let recipeImport=[];
function openRecipeImport(){
 if(session!=='manager')return;
 modal(`<div class="modalHead"><h2>Import Recipes</h2><button class="close" onclick="closeModal()">×</button></div>
 <p class="muted">One row per ingredient. KITCH groups rows with the same Recipe Name into one locked 1-Batch recipe.</p>
 <label class="filePick"><b>Choose Recipe Excel</b><br><small>.xlsx, .xls or .csv</small><input type="file" accept=".xlsx,.xls,.csv" hidden onchange="readRecipeExcel(this.files[0])"></label><div id="recipePreview"></div>`)
}
async function readRecipeExcel(file){
 if(!file)return;if(typeof XLSX==='undefined')return recipePreview.innerHTML='<div class="note bad">Excel reader could not load.</div>';
 try{
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheetName=wb.SheetNames.includes('Ingredient Master')?'Ingredient Master':wb.SheetNames[0],ws=wb.Sheets[sheetName],rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  const groups={};
  rows.forEach(row=>{
   const name=String(row['Recipe Name']||'').trim(),ing=String(row['Ingredient Name']||'').trim();if(!name||!ing)return;
   if(!groups[name])groups[name]={id:Date.now()+Object.keys(groups).length,name,category:String(row['Recipe Category']||'').trim(),yield:Number(row['Expected Yield']||0),yield_unit:unit(row['Yield Unit']||'kg'),portions:Number(row['Portions per Batch']||0),instructions:String(row['Instructions']||'').trim(),items:[]};
   const matched=ingredientForRecipeItem({ingredient:ing});
   groups[name].items.push({ingredient:ing,sku:matched?.sku||'',qty:Number(row['Quantity']||0),unit:unit(row['Unit']),yield_pct:Number(row['Yield %']||row['Cooked Yield %']||100)});
   if(!groups[name].instructions&&row['Instructions'])groups[name].instructions=String(row['Instructions']).trim();
  });
  recipeImport=Object.values(groups);
  recipePreview.innerHTML=`<div class="note"><b>${recipeImport.length} recipes found.</b> Ingredient names are checked against the current Ingredient Master before import.</div>
  <table><tr><th>RECIPE</th><th>INGREDIENTS</th><th>YIELD</th><th>PORTIONS</th><th>COST</th><th>CHECK</th></tr>
  ${recipeImport.map(r=>{let miss=recipeMissing(r);return `<tr><td><b>${esc(r.name)}</b></td><td>${r.items.length}</td><td>${r.yield} ${esc(r.yield_unit)}</td><td>${r.portions||'—'}</td><td>AED ${recipeCost(r).toFixed(2)}</td><td>${miss.length?`<span class="bad">${miss.length} missing</span><br><small>${miss.map(esc).join(', ')}</small>`:'<span class="ok">MATCHED</span>'}</td></tr>`}).join('')}</table>
  <div class="note">Recipes with missing ingredients can be imported for review, but they will not be marked Approved until the Ingredient Master matches.</div><button class="primary" onclick="confirmRecipeImport()">Import ${recipeImport.length} Recipes</button>`;
 }catch(e){recipePreview.innerHTML='<div class="note bad">Could not read this recipe Excel.</div>'}
}
function confirmRecipeImport(){
 let a=recipes(),added=0,updated=0;
 recipeImport.forEach(r=>{let e=a.find(x=>x.name.toLowerCase()===r.name.toLowerCase());if(e){Object.assign(e,r,{id:e.id});updated++}else{a.push(r);added++}});
 setArr(RECIPE_KEY,a);recipeImport=[];closeModal();openPage('Recipes');alert(`Recipe import complete: ${added} new · ${updated} updated`);
}
function viewRecipe(id){
 linkRecipeIngredients();const r=recipes().find(x=>x.id===id);if(!r)return;let miss=recipeMissing(r),m=ingredients();
 const chef=session==='production';
 if(chef){
  modal(`<div class="modalHead"><div><h2>${esc(r.name)}</h2><div class="muted">Approved Recipe · Exactly 1 Batch</div></div><button class="close" onclick="closeModal()">×</button></div>
  <div class="grid" style="margin-top:18px"><div class="card"><span>INPUT QTY</span><b style="font-size:18px">${esc(recipeInput(r))}</b></div><div class="card"><span>PORTIONS</span><b>${r.portions||'—'}</b></div><div class="card"><span>STATUS</span><b style="font-size:16px">${recipeNeedsReview(r)?'Not Ready':'Approved'}</b></div></div>
  ${recipeYieldRows(r,false)}
  ${r.instructions?`<div class="note"><b>Instructions:</b> ${esc(r.instructions)}</div>`:''}
  <div class="note"><b>Chef Production access:</b> Recipe execution, Production and Label only. Cost and purchasing information are hidden.</div>`);
  return;
 }
 modal(`<div class="modalHead"><div><h2>${esc(r.name)}</h2><div class="muted">Locked Master · Exactly 1 Batch</div></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="grid" style="margin-top:18px"><div class="card"><span>1 BATCH COST</span><b>${recipeCostLabel(r)}</b></div><div class="card"><span>AUTO INPUT QTY</span><b style="font-size:18px">${esc(recipeInput(r))}</b></div><div class="card"><span>PORTIONS</span><b>${r.portions||'—'}</b></div><div class="card"><span>STATUS</span><b style="font-size:16px">${recipeNeedsReview(r)?'Needs Review':'Approved'}</b></div></div>
 ${miss.length?`<div class="note bad"><b>Missing from Ingredient Master (${miss.length})</b><br>${miss.map(x=>esc(x)).join(' · ')}<br><small>KITCH links recipe ingredients to the Ingredient Master by SKU/ID. Only truly unmatched ingredients need review.</small></div>`:`<div class="note ok"><b>All ingredients matched.</b> Ingredient links are valid. Check that all ingredient prices are entered before Production.</div>`}
 ${recipeYieldRows(r,true)}
 <div class="note"><b>Ingredient costs use raw (AP), not cooked (EP).</b> Cost / portion: ${r.portions>0&&recipeCostDetails(r).complete?'AED '+(recipeCost(r)/r.portions).toFixed(2):'Enter portions and all ingredient prices'}. Actual production yield is recorded separately during Production.</div>
 ${r.instructions?`<div class="note"><b>Instructions:</b> ${esc(r.instructions)}</div>`:''}</div>`)
}


// PRODUCTION ENGINE — recipe execution, stock check, FEFO deduction and QC handoff
const PROD_KEY='kitch_demo_production_v1';
function productionStockCanonical(ing){
 if(hasCentralStore())return branchStockCanonical(ing);
 return centralStockCanonical(ing);
}
function cleanQty(v){
 const n=Number(v||0);
 if(!Number.isFinite(n))return '0';
 return String(Number(n.toFixed(3)));
}
function prettyCanonical(q,u){return cleanQty(fromCanonical(Number(q||0),u))+' '+unit(u)}
function productionPage(){
 linkRecipeIngredients();
 const approved=recipes().filter(r=>!recipeNeedsReview(r)), runs=scopedRows(getArr(PROD_KEY)).slice().reverse();
 return `<div class="grid"><div class="card"><span>APPROVED RECIPES</span><b>${approved.length}</b></div><div class="card"><span>PRODUCTION LOCATION</span><b style="font-size:17px">${esc(hasCentralStore()?currentBranchName():primaryRestaurantName())}</b></div><div class="card"><span>COMPLETED RUNS</span><b>${runs.filter(x=>x.status==='Completed'||x.status==='Label Pending').length}</b></div><div class="card"><span>STOCK CONTROL</span><b style="font-size:18px">FEFO</b></div></div>
 <div class="panel"><h2>Production</h2><p class="muted">Select an approved recipe and number of batches. KITCH checks Restaurant stock before production. Chef Production does not see ingredient costs or prices.</p>
 <div class="actions"><button class="btn black" onclick="openProduction()">+ Start Production</button></div>
 <table><tr><th>PRODUCTION</th><th>RECIPE</th><th>BATCHES</th><th>ACTUAL YIELD</th><th>LOCATION</th><th>STATUS</th></tr>${runs.map(x=>`<tr class="productionHistoryRow" onclick="viewProductionDetails(${x.id})" title="View production details"><td><b>${esc(x.code)}</b><br><small>${esc((x.created_at||'').slice(0,16).replace('T',' '))}</small></td><td>${esc(x.recipe)}</td><td>${cleanQty(x.batches)}</td><td>${x.actual_yield?esc(cleanQty(x.actual_yield)+' '+x.yield_unit):'—'}</td><td>${esc(x.location)}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No production runs yet.</td></tr>'}</table><div class="muted" style="margin-top:12px">Click any production record to view the full audit trail and Label proof.</div></div>`;
}

function viewProductionDetails(id){
 const x=getArr(PROD_KEY).find(p=>p.id===id);if(!x)return;
 const showCost=session!=='production'; const req=(x.requirements||[]).map(r=>`<tr><td><b>${esc(r.ingredient)}</b></td><td>${cleanQty(r.qty)} ${esc(unit(r.unit))}</td><td>${esc(r.sku||'—')}</td>${showCost?`<td>AED ${Number(r.cost||0).toFixed(2)}</td>`:''}</tr>`).join('');
 const qcDone=['Label Created','Label Rejected'].includes(x.status), qcPassed=x.status==='Label Created';
 const proof=x.qc_photo?`<div style="margin-top:14px"><div class="field"><label>LABEL IMAGE PROOF</label></div><img class="proofImage" src="${x.qc_photo}" alt="Label proof for ${esc(x.code)}"></div>`:`<div class="note ${qcDone?'warn':''}"><b>QC image proof:</b> ${qcDone?'No image proof saved for this record.':'Not available until QC is completed.'}</div>`;
 modal(`<div class="modalHead"><div><div class="sub">PRODUCTION DETAILS</div><h2>${esc(x.code)} · ${esc(x.recipe)}</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="productionDetailGrid">
  <div class="card"><span>BATCHES</span><b>${cleanQty(x.batches)}</b></div>
  <div class="card"><span>ACTUAL YIELD</span><b>${x.actual_yield?esc(cleanQty(x.actual_yield)+' '+(x.yield_unit||'')):'—'}</b></div>
  <div class="card"><span>LOCATION</span><b>${esc(x.location||'—')}</b></div>
  <div class="card"><span>STATUS</span><b class="${qcPassed?'ok':x.status==='Label Rejected'?'bad':'warn'}">${esc(x.status||'—')}</b></div>
 </div>
 <div class="note"><b>Staff:</b> ${esc(x.staff_name||x.created_by||x.started_by||'—')} · <b>Started:</b> ${esc(formatProductionDate(x.created_at))}${x.completed_at?` · <b>Production completed:</b> ${esc(formatProductionDate(x.completed_at))}`:''}${x.qc_at?` · <b>QC:</b> ${esc(formatProductionDate(x.qc_at))}`:''}</div>
 <h3>Ingredients Deducted</h3>${showCost?`<div class="note"><b>Production Food Cost:</b> AED ${Number(x.production_cost||0).toFixed(2)}${x.actual_yield?` · <b>Actual Cost / ${esc(x.yield_unit||'unit')}:</b> AED ${Number(x.actual_unit_cost||Number(x.production_cost||0)/Number(x.actual_yield||1)).toFixed(2)}`:''}</div>`:''}<table><tr><th>INGREDIENT</th><th>DEDUCTED QTY</th><th>SKU</th>${showCost?'<th>COST</th>':''}</tr>${req||`<tr><td colspan="${showCost?4:3}" class="empty">No ingredient deduction details saved.</td></tr>`}</table>
 <h3 style="margin-top:24px">Labels</h3>
 ${qcDone?`<div class="qcDetails"><div class="note"><b>Expiry:</b> ${esc(x.expiry_date||'—')}</div><div class="note"><b>Temperature:</b> ${x.qc_temp_c!==''&&x.qc_temp_c!==undefined?cleanQty(x.qc_temp_c)+' °C':'—'}</div></div><div class="note"><b>QC Result:</b> <span class="${qcPassed?'ok':'bad'}">${esc(x.status)}</span>${x.qc_serial?` · <b>Serial:</b> ${esc(x.qc_serial)}`:''}<br><b>Label Note:</b> ${esc(x.qc_note||'—')}</div>`:`<div class="note warn"><b>QC:</b> ${x.status==='Label Pending'?'Pending — this production still needs QC.':'Not completed for this production record.'}</div>`}
 ${proof}
 <div class="detailActions">${qcPassed?`<button class="btn black" onclick="printQCLabel(${x.id})">Print Label</button>`:''}${x.qc_photo?`<button class="btn" onclick="openQCProof(${x.id})">View Proof</button>`:''}</div>`);
}
function formatProductionDate(v){return v?String(v).slice(0,16).replace('T',' '):'—'}
function openQCProof(id){
 const x=getArr(PROD_KEY).find(p=>p.id===id);if(!x||!x.qc_photo)return alert('No QC image proof saved for this production.');
 const w=window.open('','_blank');if(!w)return alert('Allow pop-ups to view the proof image.');
 w.document.write(`<title>${esc(x.code)} QC Proof</title><body style="margin:0;background:#111;display:grid;place-items:center;min-height:100vh"><img src="${x.qc_photo}" style="max-width:96vw;max-height:96vh;object-fit:contain"></body>`);w.document.close();
}

function openProduction(){
 const a=recipes().filter(r=>!recipeMissing(r).length);if(!a.length)return alert('No approved recipes available.');
 modal(`<div class="modalHead"><h2>Start Production</h2><button class="close" onclick="closeModal()">×</button></div>
 <div class="formGrid"><div class="field"><label>APPROVED RECIPE</label><select id="prRecipe" onchange="previewProduction()">${a.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><div class="field"><label>NUMBER OF BATCHES</label><input id="prBatches" type="number" min="0.001" step="0.001" value="1" oninput="previewProduction()"></div></div>
 <div class="note"><b>Production Location:</b> ${esc(hasCentralStore()?currentBranchName():primaryRestaurantName())} · Recipe quantities are multiplied by the number of batches.</div>
 <div id="prMethod"></div><div id="prPreview"></div>`);previewProduction();
}
function previewProduction(){
 const r=recipes().find(x=>String(x.id)===String(document.getElementById('prRecipe')?.value)),
       mult=Number(document.getElementById('prBatches')?.value||0),
       m=ingredients();
 if(!r||mult<=0)return;

 const method=document.getElementById('prMethod');
 if(method){
   method.innerHTML=r.instructions
     ? `<div class="productionMethod"><b>METHOD / RECIPE INSTRUCTIONS</b>${esc(r.instructions)}</div>`
     : `<div class="productionMethod"><b>METHOD / RECIPE INSTRUCTIONS</b><span class="muted">No method added to this master recipe yet. Kitchen Manager / Executive Chef can add it to the recipe.</span></div>`;
 }

 let ok=true;
 const rows=r.items.map(it=>{
   const ing=ingredientForRecipeItem(it,m);
   if(!ing){
     ok=false;
     return `<tr><td><b>${esc(it.ingredient)}</b></td><td>—</td><td>—</td><td><span class="bad"><b>MISSING</b></span></td></tr>`;
   }
   const need=toCanonical(Number(it.qty)*mult,it.unit),
         have=productionStockCanonical(ing),
         good=have+1e-9>=r.items.filter(x=>ingredientForRecipeItem(x,m)?.sku===ing.sku).reduce((sum,x)=>sum+toCanonical(Number(x.qty)*mult,x.unit),0);
   ok=ok&&good;
   const required=cleanQty(Number(it.qty)*mult)+' '+unit(it.unit);
   return `<tr><td><b>${esc(ing.name)}</b></td><td>${required}</td><td>${prettyCanonical(have,ing.base_unit)}</td><td><span class="${good?'ok':'bad'}"><b>${good?'READY':'SHORT '+prettyCanonical(need-have,ing.base_unit)}</b></span></td></tr>`;
 }).join('');

 document.getElementById('prPreview').innerHTML=
   `<div class="productionTableWrap"><table class="productionTable"><tr><th>INGREDIENT</th><th>REQUIRED</th><th>RESTAURANT STOCK</th><th>CHECK</th></tr>${rows}</table></div>
    <div class="note ${ok?'ok':'bad'}"><b>${ok?'Stock ready.':'Production blocked.'}</b> ${ok?'Starting production will deduct these ingredients from '+esc(currentBranchName())+' stock.':hasCentralStore()?'Use the branch stock first. Request only the missing quantities from Central Store.':'Receive the missing stock before starting production.'}</div>
    ${!ok&&hasCentralStore()&&session==='manager'?'<button class="btn black" style="width:100%;height:46px;margin-bottom:8px" onclick="requestProductionShortages()">Request Missing Stock from Central Store</button>':''}
    <button class="primary" ${ok?'':'disabled style="opacity:.4;cursor:not-allowed"'} onclick="confirmProduction()">Start ${cleanQty(mult)} Batch${mult===1?'':'es'}</button>`;
}

function requestProductionShortages(){
 if(!hasCentralStore()||session!=='manager')return;
 const r=recipes().find(x=>String(x.id)===String(document.getElementById('prRecipe')?.value)),mult=Number(document.getElementById('prBatches')?.value||0),m=ingredients(),branch=currentBranch();
 if(!r||mult<=0)return;
 let req=getArr(STOCK_REQUEST_KEY),created=[];
 for(const it of r.items){
   const ing=ingredientForRecipeItem(it,m);if(!ing)continue;
   const need=toCanonical(Number(it.qty)*mult,it.unit),have=branchStockCanonical(ing,branch.id),short=Math.max(0,need-have);
   if(short<=1e-9)continue;
   const qty=fromCanonical(short,ing.base_unit);
   const duplicate=req.find(x=>x.status==='Requested'&&x.branch_id===branch.id&&x.sku===ing.sku);
   if(duplicate){duplicate.qty=Math.max(Number(duplicate.qty||0),qty);duplicate.source='Production Shortage';}
   else{const id=Date.now()+created.length;req.push({id,ref:'REQ-'+String(req.length+1).padStart(4,'0'),branch_id:branch.id,branch:branch.name,sku:ing.sku,ingredient:ing.name,qty,unit:ing.base_unit,requested_by:currentActor(),status:'Requested',source:'Production Shortage',created_at:new Date().toISOString()});}
   created.push(`${ing.name}: ${cleanQty(qty)} ${ing.base_unit}`);
 }
 if(!created.length)return alert('No shortage to request.');
 setArr(STOCK_REQUEST_KEY,req);closeModal();openPage('Stock Requests');alert('Stock request sent to Central Store for:\n'+created.join('\n'));
}

function deductFEFO(sku,need){
 let batches=getArr(BATCH_KEY).slice().sort((a,b)=>String(a.expiry_date).localeCompare(String(b.expiry_date)));
 if(hasCentralStore())return {cost:0,used:[]}; // branch transfer costing is handled from the branch ingredient cost
 let cost=0,used=[];
 for(const b of batches){
  if(b.sku!==sku||Number(b.remaining_canonical||0)<=0)continue;
  let take=Math.min(need,Number(b.remaining_canonical));
  const qtyInBatchUnit=fromCanonical(take,b.unit),lineCost=qtyInBatchUnit*Number(b.cost||0);
  cost+=lineCost;used.push({lot:b.lot,qty:qtyInBatchUnit,unit:b.unit,cost:lineCost,unit_cost:Number(b.cost||0)});
  b.remaining_canonical-=take;b.remaining_qty=fromCanonical(b.remaining_canonical,b.unit);need-=take;if(need<=1e-9)break;
 }
 setArr(BATCH_KEY,batches);return {cost,used};
}
let kitchProductionSubmitting=false;
function confirmProduction(){
 if(kitchProductionSubmitting)return;
 const r=recipes().find(x=>String(x.id)===String(prRecipe.value)),mult=Number(prBatches.value||0);
 if(!r||!Number.isFinite(mult)||mult<=0)return alert('Enter a valid number of batches.');
 if(recipeMissing(r).length)return alert('This recipe needs review. Link all ingredients before production.');
 let a=ingredients(),requirements=[];
 for(const it of r.items){const ing=ingredientForRecipeItem(it,a);if(!ing)return alert('Recipe ingredient is not linked.');const need=toCanonical(Number(it.qty)*mult,it.unit),have=productionStockCanonical(ing);if(have+1e-9<need)return alert('Not enough Restaurant stock for '+ing.name+'.');requirements.push({sku:ing.sku,ingredient:ing.name,qty:Number(it.qty)*mult,unit:it.unit,canonical:need,unit_cost:Number(ing.cost||0),cost:(()=>{let q=Number(it.qty)*mult,iu=unit(it.unit),bu=unit(ing.base_unit);if(iu==='g'&&bu==='kg')q/=1000;else if(iu==='kg'&&bu==='g')q*=1000;else if(iu==='ml'&&bu==='ltr')q/=1000;else if(iu==='ltr'&&bu==='ml')q*=1000;return q*Number(ing.cost||0)})()})}
 // Confirm inventory again immediately before making any changes.
 const totals=new Map();
 for(const req of requirements)totals.set(req.sku,(totals.get(req.sku)||0)+req.canonical);
 for(const [sku,required] of totals){const ing=a.find(x=>x.sku===sku);if(!ing||productionStockCanonical(ing)+1e-9<required)return alert('Stock changed or insufficient for '+(ing?.name||sku)+'. Refresh and try again.');}
 kitchProductionSubmitting=true;
 try{
 for(const req of requirements){const ing=a.find(x=>x.sku===req.sku);if(hasCentralStore()){setBranchStockCanonical(ing,currentBranchId(),branchStockCanonical(ing)-req.canonical)}else{let have=productionStockCanonical(ing);ing.stock_canonical=have-req.canonical;ing.stock=fromCanonical(ing.stock_canonical,ing.base_unit);const fefo=deductFEFO(ing.sku,req.canonical);if(fefo&&fefo.used&&fefo.used.length){req.cost=fefo.cost;req.fefo_batches=fefo.used}}}saveIngredients(a);
 let runs=getArr(PROD_KEY),code='PRD-'+String(runs.length+1).padStart(5,'0'),productionCost=requirements.reduce((t,x)=>t+Number(x.cost||0),0);runs.push({id:Date.now(),code,recipe_id:r.id,recipe:r.name,batches:mult,requirements,production_cost:productionCost,location:hasCentralStore()?currentBranchName():primaryRestaurantName(),status:'In Production',created_by:currentActor(),staff_name:currentActor(),created_at:new Date().toISOString(),actual_yield:'',yield_unit:r.yield_unit||'kg'});setArr(PROD_KEY,runs);closeModal();openActualYield(runs[runs.length-1].id)
 }finally{kitchProductionSubmitting=false;}
}
function openActualYield(id){
 const x=getArr(PROD_KEY).find(p=>p.id===id);if(!x)return;
 modal(`<div class="productionFinish"><div class="modalHead"><div><div class="sub">PRODUCTION RUN</div><h2>${esc(x.code)}</h2></div><button class="close" onclick="closeModal();openPage('Production')">×</button></div>
 <div class="runMeta"><b>${esc(x.recipe)}</b><br>${cleanQty(x.batches)} Batch${Number(x.batches)===1?'':'es'} · ${esc(x.location)}</div>
 <div class="note ok"><b>Ingredients deducted.</b> Complete the production record before it goes to Label/QC.</div>
 <div class="yieldGrid"><div class="field"><label>ACTUAL FINISHED YIELD *</label><input id="prYield" type="number" min="0" step=".001" placeholder="0"></div><div class="field"><label>YIELD UNIT</label><select id="prYieldUnit"><option>kg</option><option>g</option><option>ltr</option><option>ml</option><option>pcs</option></select></div></div>
 <div class="formGrid"><div class="field"><label>PRODUCTION DATE *</label><input id="prProductionDate" type="date"></div><div class="field"><label>EXPIRY DATE *</label><input id="prExpiry" type="date"></div><div class="field"><label>FINISHED PRODUCT TEMPERATURE °C *</label><input id="prTemp" type="number" step=".1" placeholder="e.g. 4.0"></div></div>
 <div class="qcPhoto"><b>PRODUCTION PROOF *</b><br><small>Take a photo or choose an image of the finished production / scale.</small><br><input id="prProof" type="file" accept="image/*" capture="environment" onchange="previewProductionProof(this.files[0])"><div id="prProofPreview"></div></div>
 <button class="primary" onclick="completeProduction(${id})">Complete Production & Send to Label</button></div>`);document.getElementById('prProductionDate').value=new Date().toISOString().slice(0,10);
}
let productionProofData='';
function previewProductionProof(file){if(!file){productionProofData='';return}const reader=new FileReader();reader.onload=e=>{productionProofData=e.target.result;const box=document.getElementById('prProofPreview');if(box)box.innerHTML=`<img src="${productionProofData}" alt="Production proof">`};reader.readAsDataURL(file)}
function completeProduction(id){const y=Number(prYield.value||0),productionDate=(prProductionDate.value||'').trim(),expiry=(prExpiry.value||'').trim(),temp=(prTemp.value||'').trim();if(y<=0)return alert('Enter actual finished yield.');if(!productionDate)return alert('Enter production date.');if(!expiry)return alert('Enter expiry date.');if(productionDate>expiry)return alert('Production date cannot be after expiry date.');if(temp==='')return alert('Enter finished product temperature.');if(!productionProofData)return alert('Add production proof image.');let a=getArr(PROD_KEY),x=a.find(p=>p.id===id);x.actual_yield=y;x.yield_unit=prYieldUnit.value;x.actual_unit_cost=Number(x.production_cost||0)/y;x.production_date=productionDate;x.expiry_date=expiry;x.production_temp_c=Number(temp);x.production_proof=productionProofData;x.status='Label Pending';x.completed_at=new Date().toISOString();setArr(PROD_KEY,a);productionProofData='';closeModal();openPage('Label')}
function qcPage(){const a=getArr(PROD_KEY).filter(x=>x.status==='Label Pending'||x.status==='Completed').slice().reverse();return `<div class="panel"><h2>QC</h2><p class="muted">Check completed production before release. No cost or purchasing information is shown to Chef Production.</p><table><tr><th>PRODUCTION</th><th>RECIPE</th><th>BATCHES</th><th>ACTUAL YIELD</th><th>STATUS</th><th>ACTION</th></tr>${a.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.recipe)}</td><td>${x.batches}</td><td>${esc(x.actual_yield)} ${esc(x.yield_unit)}</td><td>${esc(x.status)}</td><td>${x.status==='Label Pending'?`<button class="btn black" onclick="passQC(${x.id})">Create Label</button>`:'<span class="ok"><b>RELEASED</b></span>'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No production waiting for Label.</td></tr>'}</table></div>`}
function passQC(id){let a=getArr(PROD_KEY),x=a.find(p=>p.id===id);if(!x)return;x.status='Completed';x.qc_at=new Date().toISOString();setArr(PROD_KEY,a);openPage('Label')}


function qcPage(){
 const runs=getArr(PROD_KEY).slice().reverse(), pending=runs.filter(x=>x.status==='Label Pending'), passed=runs.filter(x=>x.status==='Label Created'), rejected=runs.filter(x=>x.status==='Label Rejected');
 return `<div class="grid"><div class="card"><span>PENDING LABEL</span><b>${pending.length}</b></div><div class="card"><span>PASSED</span><b>${passed.length}</b></div><div class="card"><span>REJECTED</span><b>${rejected.length}</b></div><div class="card"><span>CONTROL</span><b style="font-size:18px">LABEL</b></div></div>
 <div class="panel"><h2>Labels</h2><p class="muted">Check completed production before release. Chef Production does not see costs or prices.</p>
 <table><tr><th>PRODUCTION</th><th>RECIPE</th><th>YIELD</th><th>EXPIRY</th><th>TEMP</th><th>STATUS</th><th>ACTION</th></tr>
 ${runs.filter(x=>['Label Pending','Label Created','Label Rejected'].includes(x.status)).map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.recipe)}</td><td>${cleanQty(x.actual_yield)} ${esc(x.yield_unit||'')}</td><td>${esc(x.expiry_date||'—')}</td><td>${x.qc_temp_c!==undefined?cleanQty(x.qc_temp_c)+' °C':'—'}</td><td><span class="${x.status==='Label Created'?'ok':x.status==='Label Rejected'?'bad':'warn'}"><b>${esc(x.status)}</b></span></td><td>${x.status==='Label Pending'?`<button class="btn black" onclick="openQC(${x.id})">Label Details</button>`:x.status==='Label Created'?`<button class="btn" onclick="printQCLabel(${x.id})">Print Label</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No production waiting for Label.</td></tr>'}</table></div>`;
}
let qcPhotoData='';
function openQC(id){
 const run=getArr(PROD_KEY).find(x=>x.id===id);if(!run)return;qcPhotoData=run.production_proof||run.qc_photo||'';
 modal(`<div class="productionFinish"><div class="modalHead"><div><div class="sub">LABEL</div><h2>${esc(run.code)}</h2></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="runMeta"><b>${esc(run.recipe)}</b><br>${cleanQty(run.batches)} Batch${Number(run.batches)===1?'':'es'} · Yield ${cleanQty(run.actual_yield)} ${esc(run.yield_unit||'')} · ${esc(run.location)}</div>
 <div class="qcChecks">
  <label class="qcCheck"><input class="qcItem" type="checkbox"> Appearance / presentation</label>
  <label class="qcCheck"><input class="qcItem" type="checkbox"> Taste / recipe standard</label>
  <label class="qcCheck"><input class="qcItem" type="checkbox"> Temperature / food safety</label>
  <label class="qcCheck"><input class="qcItem" type="checkbox"> Yield / portion check</label>
 </div>
 <div class="qcDetails">
  <div class="field"><label>PRODUCTION DATE *</label><input id="qcProductionDate" type="date" value="${esc(run.production_date||'')}"></div>
  <div class="field"><label>EXPIRY DATE *</label><input id="qcExpiry" type="date" value="${esc(run.expiry_date||'')}"></div>
  <div class="field"><label>PRODUCT TEMPERATURE °C *</label><input id="qcTemp" type="number" step=".1" placeholder="e.g. 4.0" value="${run.production_temp_c!==undefined?esc(run.production_temp_c):''}"></div>
 </div>
 <div class="qcPhoto"><b>IMAGE PROOF *</b><br><small>Production proof is carried forward automatically. You can replace it with a new QC photo.</small><br><input id="qcPhoto" type="file" accept="image/*" capture="environment" onchange="previewQCPhoto(this.files[0])"><div id="qcPhotoPreview">${qcPhotoData?`<img src="${qcPhotoData}" alt="Production proof">`:``}</div></div>
 <div class="field"><label>LABEL NOTE</label><input id="qcNote" placeholder="Optional note"></div>
 <div class="qcActions"><button class="qcReject" onclick="finishQC(${run.id},false)">Reject</button><button class="primary" onclick="finishQC(${run.id},true)">Create Label</button></div></div>`);
}
function previewQCPhoto(file){
 if(!file){qcPhotoData='';return}
 const reader=new FileReader();
 reader.onload=e=>{qcPhotoData=e.target.result;document.getElementById('qcPhotoPreview').innerHTML=`<img src="${qcPhotoData}" alt="Label proof">`};
 reader.readAsDataURL(file);
}
function finishQC(id,pass){
 let a=getArr(PROD_KEY),run=a.find(x=>x.id===id);if(!run)return;
 const productionDate=(document.getElementById('qcProductionDate')?.value||'').trim();
 const expiry=(document.getElementById('qcExpiry')?.value||'').trim();
 const temp=(document.getElementById('qcTemp')?.value||'').trim();
 if(pass && [...document.querySelectorAll('.qcItem')].some(x=>!x.checked))return alert('Complete all 4 label checks before creating the label.');
 if(pass && !productionDate)return alert('Enter the production date.');
 if(pass && !expiry)return alert('Enter the expiry date.');
 if(pass && productionDate>expiry)return alert('Production date cannot be after the expiry date.');
 if(pass && temp==='')return alert('Enter the product temperature in °C.');
 if(pass && !qcPhotoData)return alert('Add image proof before passing QC.');
 run.status=pass?'Label Created':'Label Rejected';
 run.qc_note=(document.getElementById('qcNote')?.value||'').trim();
 run.production_date=productionDate||run.production_date||'';
 run.expiry_date=expiry||run.expiry_date||'';
 run.qc_temp_c=temp===''?'':Number(temp);
 run.qc_photo=qcPhotoData||run.qc_photo||'';
 run.qc_at=new Date().toISOString();
 if(pass)run.qc_serial=run.qc_serial||('QC-'+String(id).slice(-6));
 setArr(PROD_KEY,a);closeModal();openPage('Label');
 if(pass && confirm('Label created. Print the label now?'))printQCLabel(id);
}
function printQCLabel(id){
 const run=getArr(PROD_KEY).find(x=>x.id===id);if(!run)return;
 const old=document.getElementById('qcLabelPrint');if(old)old.remove();
 const el=document.createElement('div');el.id='qcLabelPrint';
 el.innerHTML=`<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.35"><b style="font-size:18px">KITCH LABEL</b><br><b>${esc(run.recipe)}</b><br>${esc(run.code)} · ${esc(run.qc_serial||'')}<br>Yield: ${cleanQty(run.actual_yield)} ${esc(run.yield_unit||'')}<br>Temp: ${cleanQty(run.qc_temp_c)} °C<br>Production: ${esc(run.production_date||'—')}<br>Expiry: ${esc(run.expiry_date||'—')}<br>LABEL: CREATED</div>`;
 document.body.appendChild(el);window.print();setTimeout(()=>el.remove(),500);
}


// WASTE & ADJUSTMENTS — raw ingredient waste and finished production waste are kept separate.
const WASTE_KEY='kitch_demo_waste_v3';
function wasteRecords(){return getArr(WASTE_KEY)}
function wasteLocations(){if(!hasCentralStore())return [primaryRestaurantName()];const names=locations().filter(x=>x.status!=='Inactive').map(x=>x.name);return [...new Set(names.length?names:['Central Store',primaryRestaurantName()])]}
function wasteLocationOptions(selected){return wasteLocations().map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join('')}
function locationStockCanonical(ing,location){
 if(location==='Central Store')return ing.stock_canonical!=null?Number(ing.stock_canonical):toCanonical(ing.stock,ing.base_unit);
 if(location==='Central Kitchen')return Number(ing.central_kitchen_stock_canonical||0);
 return hasCentralStore()?Number(ing.restaurant_stock_canonical||0):(ing.stock_canonical!=null?Number(ing.stock_canonical):toCanonical(ing.stock,ing.base_unit));
}
function setLocationStockCanonical(ing,location,value){
 value=Math.max(0,Number(value||0));
 if(location==='Central Store'){ing.stock_canonical=value;ing.stock=fromCanonical(value,ing.base_unit);ing.stock_location='Central Store';return}
 if(location==='Central Kitchen'){ing.central_kitchen_stock_canonical=value;return}
 if(hasCentralStore())ing.restaurant_stock_canonical=value;else{ing.stock_canonical=value;ing.stock=fromCanonical(value,ing.base_unit);ing.stock_location=primaryRestaurantName()}
}
function wasteLocationStock(ing,location=primaryRestaurantName()){return locationStockCanonical(ing,location)}
function finishedWasteUsed(run){return wasteRecords().filter(x=>x.type==='Finished Product Waste'&&String(x.production_id)===String(run.id)).reduce((t,x)=>t+Number(x.canonical||0),0)}
function finishedRemaining(run){return Math.max(0,toCanonical(Number(run.actual_yield||0),run.yield_unit)-finishedWasteUsed(run))}
function productionCostForRun(run){if(Number(run.production_cost||0)>0)return Number(run.production_cost);const r=recipes().find(x=>String(x.id)===String(run.recipe_id));return r?recipeCost(r)*Number(run.batches||1):0}
function wastePage(){
 const rows=scopedRows(wasteRecords()).slice().reverse(),wasteOnly=rows.filter(x=>x.type!=='Stock Adjustment'),total=wasteOnly.reduce((t,x)=>t+Number(x.cost||0),0),today=new Date().toISOString().slice(0,10);
 const todayCost=wasteOnly.filter(x=>String(x.created_at||'').slice(0,10)===today).reduce((t,x)=>t+Number(x.cost||0),0),rawCost=wasteOnly.filter(x=>x.type==='Raw Ingredient Waste').reduce((t,x)=>t+Number(x.cost||0),0),finishedCost=wasteOnly.filter(x=>x.type==='Finished Product Waste').reduce((t,x)=>t+Number(x.cost||0),0);
 return `<div class="grid"><div class="card"><span>WASTE RECORDS</span><b>${wasteOnly.length}</b></div><div class="card"><span>TODAY WASTE</span><b>AED ${todayCost.toFixed(2)}</b></div><div class="card"><span>RAW WASTE COST</span><b>AED ${rawCost.toFixed(2)}</b></div><div class="card"><span>FINISHED WASTE COST</span><b>AED ${finishedCost.toFixed(2)}</b></div></div>
 <div class="panel"><h2>Waste & Adjustments</h2><p class="muted">Record waste against the location where it happened. KITCH deducts stock only from that Store, Central Kitchen or Restaurant location and keeps the location for audit and reporting.</p>
 <div class="actions"><button class="btn black" onclick="openWasteType()">+ Record Waste</button><button class="btn" onclick="openAdjustment()">+ Stock Adjustment</button></div>
 <table><tr><th>REFERENCE</th><th>TYPE</th><th>ITEM</th><th>QTY</th><th>LOCATION</th><th>REASON</th><th>COST</th><th>RECORDED BY</th><th>DATE</th></tr>${rows.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.type)}</td><td><b>${esc(x.ingredient||x.item||'')}</b>${x.production_code?`<br><small>${esc(x.production_code)}</small>`:''}</td><td>${cleanQty(x.qty)} ${esc(x.unit)}</td><td><b>${esc(x.location||primaryRestaurantName())}</b></td><td>${esc(x.reason)}${x.note?`<br><small>${esc(x.note)}</small>`:''}</td><td>${x.type==='Stock Adjustment'?'AED '+Math.abs(Number(x.value_impact||0)).toFixed(2)+' value impact':'AED '+Number(x.cost||0).toFixed(2)}</td><td>${esc(x.recorded_by||'Legacy record')}</td><td>${esc(String(x.created_at||'').slice(0,16).replace('T',' '))}</td></tr>`).join('')||'<tr><td colspan="11" class="empty">No waste or stock adjustments yet.</td></tr>'}</table></div>`;
}
function openWasteType(){modal(`<div class="modalHead"><div><div class="sub">WASTE CONTROL</div><h2>Record Waste</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="note">Choose what was actually wasted. Normal recipe usage is already counted automatically as production food cost.</div><div class="actions" style="margin-top:18px"><button class="btn black" onclick="openWaste()">Raw Ingredient Waste</button><button class="btn" onclick="openFinishedWaste()">Finished Product Waste</button></div>`)}
function wasteIngredientOptions(location){return ingredients().slice().sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option value="${esc(x.sku)}">${esc(x.name)} · ${prettyCanonical(wasteLocationStock(x,location),x.base_unit)}</option>`).join('')}
function openWaste(){
 if(!ingredients().length)return alert('Ingredient Master is empty.');const loc=wasteLocations()[0];
 modal(`<div class="modalHead"><div><div class="sub">RAW INGREDIENT WASTE</div><h2>Record Ingredient Waste</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="note"><b>Location control:</b> waste is deducted only from the selected location.</div><div class="formGrid"><div class="field"><label>WASTE LOCATION</label><select id="wLocation" onchange="wasteLocationChanged()">${wasteLocationOptions(loc)}</select></div><div class="field"><label>INGREDIENT</label><select id="wIng" class="ingredientSelect" onfocus="openIngredientSelect(this)" onblur="closeIngredientSelect(this)" onchange="wasteIngredientChanged();closeIngredientSelect(this)">${wasteIngredientOptions(loc)}</select></div><div class="field"><label>QUANTITY</label><input id="wQty" type="number" min="0" step=".001" oninput="updateWasteCostPreview()"></div><div class="field"><label>UNIT</label><input id="wUnit" disabled></div><div class="field"><label>REASON *</label><select id="wReason"><option value="">Select reason</option><option>Preparation Waste</option><option>Spoilage</option><option>Expired</option><option>Quality Issue</option><option>Damaged</option><option>Staff Error</option><option>Other</option></select></div></div><div id="wStockInfo" class="note"></div><div class="field"><label>NOTE</label><input id="wNote" placeholder="Optional details"></div><button class="primary" onclick="saveWaste()">Confirm Waste & Deduct Stock</button>`);wasteIngredientChanged();
}
function wasteLocationChanged(){const loc=wLocation.value,sel=wIng.value;wIng.innerHTML=wasteIngredientOptions(loc);if([...wIng.options].some(o=>o.value===sel))wIng.value=sel;wasteIngredientChanged()}
function estimatedWasteUnitCost(ing,location){
 if(!ing)return 0;
 if(location===primaryRestaurantName()&&!hasCentralStore()){
  const batches=getArr(BATCH_KEY).filter(b=>b.sku===ing.sku&&Number(b.remaining_canonical||0)>0).sort((a,b)=>String(a.expiry_date).localeCompare(String(b.expiry_date)));
  if(batches.length)return Number(batches[0].cost||ing.latest_cost||ing.cost||0);
 }
 return Number(ing.latest_cost!=null?ing.latest_cost:ing.cost||0);
}
function updateWasteCostPreview(){
 const ing=ingredients().find(i=>i.sku===document.getElementById('wIng')?.value),loc=document.getElementById('wLocation')?.value||primaryRestaurantName(),q=Number(document.getElementById('wQty')?.value||0);
 if(!ing)return;
 const unitCost=estimatedWasteUnitCost(ing,loc),cost=q*unitCost,box=document.getElementById('wStockInfo');
 if(box)box.innerHTML=`<b>${esc(loc)} stock:</b> ${prettyCanonical(wasteLocationStock(ing,loc),ing.base_unit)} · <b>Estimated waste cost: AED ${cost.toFixed(2)}</b><br><small>Cost uses the actual FEFO receiving batch where available; final cost is calculated when waste is confirmed.</small>`;
}
function wasteIngredientChanged(){const x=ingredients().find(i=>i.sku===document.getElementById('wIng')?.value),loc=document.getElementById('wLocation')?.value||primaryRestaurantName();if(x){wUnit.value=unit(x.base_unit);updateWasteCostPreview()}}
function saveWaste(){
 let a=ingredients(),ing=a.find(x=>x.sku===wIng.value),q=Number(wQty.value||0),u=unit(wUnit.value),reason=wReason.value,location=wLocation.value;if(!ing||q<=0)return alert('Enter a valid waste quantity.');if(!reason)return alert('Select a waste reason.');if(!compatibleUnits(u,ing.base_unit))return alert('Unit is not compatible with this ingredient.');const need=toCanonical(q,u),have=wasteLocationStock(ing,location);if(need>have+1e-9)return alert('Waste quantity is greater than available '+location+' stock.');setLocationStockCanonical(ing,location,have-need);let fefo=null;if(location===primaryRestaurantName()&&!hasCentralStore())fefo=deductFEFO(ing.sku,need);saveIngredients(a);let r=wasteRecords(),baseQty=fromCanonical(need,ing.base_unit),cost=(fefo&&Number(fefo.cost)>0)?Number(fefo.cost):baseQty*Number(ing.latest_cost!=null?ing.latest_cost:ing.cost||0);r.push({id:Date.now(),code:'WST-'+String(r.filter(x=>x.type!=='Stock Adjustment').length+1).padStart(5,'0'),type:'Raw Ingredient Waste',sku:ing.sku,ingredient:ing.name,qty:q,unit:u,canonical:need,location,reason,note:wNote.value.trim(),cost,unit_cost:baseQty?cost/baseQty:0,fefo_batches:fefo&&fefo.used?fefo.used:[],recorded_by:currentActor(),created_at:new Date().toISOString()});setArr(WASTE_KEY,r);closeModal();openPage('Waste & Adjustments')
}
function finishedProductionOptions(){return getArr(PROD_KEY).filter(x=>Number(x.actual_yield||0)>0&&['Label Created','Completed'].includes(x.status)&&finishedRemaining(x)>0).slice().reverse().map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.recipe)} · ${esc(x.location||primaryRestaurantName())} · ${prettyCanonical(finishedRemaining(x),x.yield_unit)} remaining</option>`).join('')}
function openFinishedWaste(){const opts=finishedProductionOptions();if(!opts)return alert('No labeled finished production is available for waste.');modal(`<div class="modalHead"><div><div class="sub">FINISHED PRODUCT WASTE</div><h2>Record Finished Waste</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="note">Finished waste stays linked to its production batch and production location. KITCH calculates its value from the batch food cost.</div><div class="field"><label>PRODUCTION BATCH</label><select id="fwRun" onchange="finishedWasteChanged()">${opts}</select></div><div id="fwInfo"></div><div class="formGrid"><div class="field"><label>QUANTITY WASTED</label><input id="fwQty" type="number" min="0" step=".001"></div><div class="field"><label>UNIT</label><input id="fwUnit" disabled></div><div class="field"><label>REASON *</label><select id="fwReason"><option value="">Select reason</option><option>Overproduction</option><option>Expired</option><option>Quality Issue</option><option>Damaged</option><option>Returned</option><option>Staff Error</option><option>Other</option></select></div></div><div class="field"><label>NOTE</label><input id="fwNote" placeholder="Optional details"></div><button class="primary" onclick="saveFinishedWaste()">Confirm Finished Waste</button>`);finishedWasteChanged()}
function finishedWasteChanged(){const run=getArr(PROD_KEY).find(x=>String(x.id)===String(document.getElementById('fwRun')?.value));if(!run)return;fwUnit.value=unit(run.yield_unit);const cost=productionCostForRun(run),remaining=finishedRemaining(run);fwInfo.innerHTML=`<div class="note"><b>${esc(run.recipe)}</b> · ${esc(run.location||primaryRestaurantName())}<br>Produced ${cleanQty(run.actual_yield)} ${esc(run.yield_unit)} · Remaining ${prettyCanonical(remaining,run.yield_unit)}<br><small>Batch food cost AED ${cost.toFixed(2)} · waste cost is calculated automatically.</small></div>`}
function saveFinishedWaste(){const run=getArr(PROD_KEY).find(x=>String(x.id)===String(fwRun.value)),q=Number(fwQty.value||0),reason=fwReason.value;if(!run||q<=0)return alert('Enter a valid waste quantity.');if(!reason)return alert('Select a waste reason.');const u=unit(run.yield_unit),need=toCanonical(q,u),remaining=finishedRemaining(run);if(need>remaining+1e-9)return alert('Waste quantity is greater than the finished stock remaining for this production batch.');const totalYield=toCanonical(Number(run.actual_yield||0),u),batchCost=productionCostForRun(run),cost=totalYield?batchCost*(need/totalYield):0;let r=wasteRecords();r.push({id:Date.now(),code:'WST-'+String(r.filter(x=>x.type!=='Stock Adjustment').length+1).padStart(5,'0'),type:'Finished Product Waste',production_id:run.id,production_code:run.code,ingredient:run.recipe,qty:q,unit:u,canonical:need,location:run.location||primaryRestaurantName(),reason,note:fwNote.value.trim(),cost,recorded_by:currentActor(),created_at:new Date().toISOString()});setArr(WASTE_KEY,r);closeModal();openPage('Waste & Adjustments')}
function openAdjustment(){
 if(!ingredients().length)return alert('Ingredient Master is empty.');const loc=wasteLocations()[0];
 modal(`<div class="modalHead"><div><div class="sub">STOCK CONTROL</div><h2>Stock Adjustment</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="note">Use adjustment only to correct a verified stock difference. The correction applies only to the selected location.</div><div class="formGrid"><div class="field"><label>LOCATION</label><select id="aLocation" onchange="adjustmentLocationChanged()">${wasteLocationOptions(loc)}</select></div><div class="field"><label>INGREDIENT</label><select id="aIng" class="ingredientSelect" onfocus="openIngredientSelect(this)" onblur="closeIngredientSelect(this)" onchange="adjustmentIngredientChanged();closeIngredientSelect(this)">${wasteIngredientOptions(loc)}</select></div><div class="field"><label>ADJUSTMENT</label><select id="aDir"><option value="minus">Decrease stock</option><option value="plus">Increase stock</option></select></div><div class="field"><label>QUANTITY</label><input id="aQty" type="number" min="0" step=".001"></div><div class="field"><label>UNIT</label><input id="aUnit" disabled></div><div class="field"><label>REASON *</label><select id="aReason"><option value="">Select reason</option><option>Physical Count Correction</option><option>Receiving Correction</option><option>Transfer Correction</option><option>Data Entry Error</option><option>Other</option></select></div></div><div id="aStockInfo" class="note"></div><div class="field"><label>NOTE</label><input id="aNote" placeholder="Explain the correction"></div><button class="primary" onclick="saveAdjustment()">Save Stock Adjustment</button>`);adjustmentIngredientChanged()
}
function adjustmentLocationChanged(){const loc=aLocation.value,sel=aIng.value;aIng.innerHTML=wasteIngredientOptions(loc);if([...aIng.options].some(o=>o.value===sel))aIng.value=sel;adjustmentIngredientChanged()}
function adjustmentIngredientChanged(){const x=ingredients().find(i=>i.sku===document.getElementById('aIng')?.value),loc=document.getElementById('aLocation')?.value||primaryRestaurantName();if(x){aUnit.value=unit(x.base_unit);aStockInfo.innerHTML=`<b>${esc(loc)} stock:</b> ${prettyCanonical(wasteLocationStock(x,loc),x.base_unit)}`}}
function saveAdjustment(){let a=ingredients(),ing=a.find(x=>x.sku===aIng.value),q=Number(aQty.value||0),u=unit(aUnit.value),reason=aReason.value,dir=aDir.value,location=aLocation.value;if(!ing||q<=0)return alert('Enter a valid adjustment quantity.');if(!reason)return alert('Select an adjustment reason.');if(!compatibleUnits(u,ing.base_unit))return alert('Unit is not compatible with this ingredient.');const delta=toCanonical(q,u),have=wasteLocationStock(ing,location);if(dir==='minus'&&delta>have+1e-9)return alert('Adjustment is greater than available '+location+' stock.');const next=dir==='plus'?have+delta:have-delta;setLocationStockCanonical(ing,location,next);saveIngredients(a);let r=wasteRecords();r.push({id:Date.now(),code:'ADJ-'+String(r.filter(x=>x.type==='Stock Adjustment').length+1).padStart(5,'0'),type:'Stock Adjustment',sku:ing.sku,ingredient:ing.name,qty:(dir==='minus'?-q:q),unit:u,canonical:(dir==='minus'?-delta:delta),location,reason,note:aNote.value.trim(),cost:0,value_impact:fromCanonical(delta,ing.base_unit)*Number(ing.latest_cost!=null?ing.latest_cost:ing.cost||0),recorded_by:currentActor(),created_at:new Date().toISOString()});setArr(WASTE_KEY,r);closeModal();openPage('Waste & Adjustments')}



// STOCK COUNT — physical count vs system stock, auto-scoped by logged-in team
const COUNT_KEY='kitch_demo_stock_counts_v1';
function countLocation(){
 if(hasCentralStore()&&session==='store')return 'Central Store';
 return primaryRestaurantName();
}

function stockCounts(){return getArr(COUNT_KEY)}
function activeCount(){return stockCounts().find(x=>x.status==='In Progress'&&x.location===countLocation())}
function stockCountPage(){
 const loc=countLocation(),all=stockCounts().filter(x=>x.location===loc).slice().reverse(),active=activeCount(),completed=all.filter(x=>x.status==='Completed');
 const last=completed[0],varianceValue=completed.reduce((t,c)=>t+Number(c.variance_cost||0),0);
 return `<div class="grid"><div class="card"><span>COUNT LOCATION</span><b style="font-size:17px">${esc(loc)}</b></div><div class="card"><span>COMPLETED COUNTS</span><b>${completed.length}</b></div><div class="card"><span>LAST COUNT</span><b style="font-size:17px">${last?esc(String(last.completed_at).slice(0,10)):'—'}</b></div><div class="card"><span>TOTAL VARIANCE</span><b>AED ${varianceValue.toFixed(2)}</b></div></div>
 <div class="panel"><h2>Stock Count</h2><p class="muted">Count the physical stock at <b>${esc(loc)}</b>. KITCH compares the physical quantity with system stock and shows shortages or overages before you finalize.</p>
 <div class="actions">${active?`<button class="btn black" onclick="openStockCount('${active.id}')">Continue Count</button>`:`<button class="btn black" onclick="startStockCount()">+ Start Stock Count</button>`}</div>
 <table><tr><th>COUNT</th><th>LOCATION</th><th>ITEMS</th><th>VARIANCE ITEMS</th><th>VARIANCE VALUE</th><th>DATE</th><th>STATUS</th><th>ACTION</th></tr>${all.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.location)}</td><td>${(c.items||[]).length}</td><td>${(c.items||[]).filter(i=>Math.abs(Number(i.variance_canonical||0))>.000001).length}</td><td>${c.status==='Completed'?'AED '+Number(c.variance_cost||0).toFixed(2):'—'}</td><td>${esc(String(c.completed_at||c.created_at||'').slice(0,16).replace('T',' '))}</td><td class="${c.status==='Completed'?'ok':'warn'}"><b>${esc(c.status)}</b></td><td><button class="btn" onclick="openStockCount('${c.id}')">${c.status==='Completed'?'View':'Open'}</button></td></tr>`).join('')||'<tr><td colspan="11" class="empty">No stock counts yet. Start the first physical count.</td></tr>'}</table></div>`;
}
function startStockCount(){
 if(activeCount())return openStockCount(activeCount().id);
 const loc=countLocation(),a=ingredients().slice().sort((x,y)=>x.name.localeCompare(y.name)),counts=stockCounts();
 const nums=counts.map(x=>Number(String(x.code||'').replace(/\D/g,''))||0),code='CNT-'+String((nums.length?Math.max(...nums):0)+1).padStart(5,'0');
 const c={id:String(Date.now()),code,location:loc,status:'In Progress',created_at:new Date().toISOString(),items:a.map(x=>({sku:x.sku,name:x.name,unit:x.base_unit,system_canonical:locationStockCanonical(x,loc),physical_canonical:null,variance_canonical:0,cost:Number(x.cost||0)}))};
 counts.push(c);setArr(COUNT_KEY,counts);openStockCount(c.id)
}
function openStockCount(id){
 const c=stockCounts().find(x=>String(x.id)===String(id));if(!c)return;
 const done=c.status==='Completed';
 modal(`<div class="modalHead"><div><div class="sub">PHYSICAL STOCK COUNT</div><h2>${esc(c.code)}</h2><div class="muted">${esc(c.location)} · ${done?'Completed':'In Progress'}</div></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="note">${done?'This count is locked for audit.':'Enter the physical quantity you actually see. KITCH calculates the difference automatically. Finalizing will reconcile system stock to the physical count.'}</div>
 <div style="max-height:55vh;overflow:auto"><table><tr><th>INGREDIENT</th><th>SYSTEM</th><th>PHYSICAL COUNT</th><th>VARIANCE</th></tr>${(c.items||[]).map((it,idx)=>{const physical=it.physical_canonical==null?'':cleanQty(fromCanonical(it.physical_canonical,it.unit)),v=Number(it.variance_canonical||0);return `<tr><td><b>${esc(it.name)}</b><br><small>${esc(it.sku)}</small></td><td>${prettyCanonical(it.system_canonical,it.unit)}</td><td>${done?prettyCanonical(it.physical_canonical,it.unit):`<input data-count-index="${idx}" type="number" min="0" step=".001" value="${physical}" placeholder="Count" oninput="previewCountVariance(this)" style="width:130px;height:42px;border:1px solid #ddd;border-radius:10px;padding:0 10px"> <small>${esc(it.unit)}</small>`}</td><td id="countVar${idx}" class="${v<0?'bad':v>0?'warn':''}">${it.physical_canonical==null?'—':(v>0?'+':'')+prettyCanonical(v,it.unit)}</td></tr>`}).join('')}</table></div>
 ${done?`<div class="note"><b>Reconciled to physical stock.</b> Total variance value: AED ${Number(c.variance_cost||0).toFixed(2)} · Shortage: AED ${Number(c.shortage_value||0).toFixed(2)} · Overage: AED ${Number(c.overage_value||0).toFixed(2)}. Differences remain in Variance & Reconciliation as unexplained variance for investigation.</div>`:`<div class="actions"><button class="btn" onclick="fillCountWithSystemStock()">Use System Qty for Uncounted Items</button></div><div id="countFinalizeMsg" class="note">Enter the quantities you physically counted. For items with no difference, use <b>Use System Qty for Uncounted Items</b>.</div><button class="primary" style="margin-top:10px" onclick="finalizeStockCount('${c.id}')">Finalize Stock Count</button>`}`)
}
function previewCountVariance(el){const c=activeCount();if(!c)return;const idx=Number(el.dataset.countIndex),it=c.items[idx],q=Number(el.value);const cell=document.getElementById('countVar'+idx);if(el.value===''){cell.textContent='—';cell.className='';return}const physical=toCanonical(q,it.unit),v=physical-Number(it.system_canonical||0);cell.textContent=(v>0?'+':'')+prettyCanonical(v,it.unit);cell.className=v<0?'bad':v>0?'warn':''}
function fillCountWithSystemStock(){const c=activeCount();if(!c)return;document.querySelectorAll('[data-count-index]').forEach(el=>{if(el.value===''){const idx=Number(el.dataset.countIndex),it=c.items[idx];el.value=cleanQty(fromCanonical(Number(it.system_canonical||0),it.unit));previewCountVariance(el)}});const m=document.getElementById('countFinalizeMsg');if(m)m.innerHTML='<b>Ready to finalize.</b> Review any physical differences, then click Finalize Stock Count.'}
function finalizeStockCount(id){
 let counts=stockCounts(),c=counts.find(x=>String(x.id)===String(id));if(!c||c.status==='Completed')return;
 const inputs=[...document.querySelectorAll('[data-count-index]')],msg=document.getElementById('countFinalizeMsg');
 const missing=inputs.filter(x=>x.value==='');if(missing.length){if(msg){msg.innerHTML=`<b class="bad">${missing.length} item${missing.length===1?'':'s'} still uncounted.</b> Enter them or click <b>Use System Qty for Uncounted Items</b>.`;msg.scrollIntoView({behavior:'smooth',block:'nearest'})}return;}
 let master=ingredients(),varianceCost=0,shortageValue=0,overageValue=0,varianceItems=0;
 const prepared=inputs.map(el=>{const idx=Number(el.dataset.countIndex),it=c.items[idx],physical=toCanonical(Number(el.value||0),it.unit),v=physical-Number(it.system_canonical||0),val=Math.abs(fromCanonical(v,it.unit)*Number(it.cost||0));if(Math.abs(v)>.000001){varianceItems++;varianceCost+=val;if(v<0)shortageValue+=val;else overageValue+=val}return {it,physical,v}});
 prepared.forEach(x=>{x.it.physical_canonical=x.physical;x.it.variance_canonical=x.v;const ing=master.find(i=>i.sku===x.it.sku);if(ing)setLocationStockCanonical(ing,c.location,x.physical)});
 c.status='Completed';c.completed_at=new Date().toISOString();c.variance_cost=varianceCost;c.shortage_value=shortageValue;c.overage_value=overageValue;c.variance_items=varianceItems;c.reconciliation_status='Reconciled to physical';saveIngredients(master);setArr(COUNT_KEY,counts);closeModal();openPage('Stock Count');alert(`${c.code} completed. ${varianceItems} variance item${varianceItems===1?'':'s'} · Shortage AED ${shortageValue.toFixed(2)} · Overage AED ${overageValue.toFixed(2)}.`)
}

// VARIANCE & RECONCILIATION — explains physical stock differences after stock count
function varianceCounts(){return stockCounts().filter(x=>x.status==='Completed'&&(x.items||[]).some(i=>Math.abs(Number(i.variance_canonical||0))>.000001))}
function variancePage(){
 const loc=countLocation(),counts=varianceCounts().filter(x=>x.location===loc).slice().reverse();
 const items=counts.flatMap(c=>(c.items||[]).filter(i=>Math.abs(Number(i.variance_canonical||0))>.000001).map(i=>({...i,count_code:c.code,count_id:c.id,completed_at:c.completed_at,location:c.location})));
 const shortage=items.filter(i=>Number(i.variance_canonical)<0),overage=items.filter(i=>Number(i.variance_canonical)>0);
 const shortageValue=shortage.reduce((t,i)=>t+Math.abs(fromCanonical(Number(i.variance_canonical),i.unit)*Number(i.cost||0)),0);
 const overageValue=overage.reduce((t,i)=>t+Math.abs(fromCanonical(Number(i.variance_canonical),i.unit)*Number(i.cost||0)),0);
 return `<div class="grid"><div class="card"><span>VARIANCE ITEMS</span><b>${items.length}</b></div><div class="card"><span>SHORTAGE VALUE</span><b>AED ${shortageValue.toFixed(2)}</b></div><div class="card"><span>OVERAGE VALUE</span><b>AED ${overageValue.toFixed(2)}</b></div><div class="card"><span>RECONCILIATION</span><b style="font-size:18px">${items.length?'LIVE':'CLEAR'}</b></div></div>
 <div class="panel"><h2>Variance & Reconciliation</h2><p class="muted">Stock Count verifies what is physically present at <b>${esc(loc)}</b>. KITCH shows every shortage or overage and keeps the difference for audit. A variance is not automatically treated as theft — it may be unrecorded usage, waste, receiving error, transfer error or a counting mistake.</p>
 <table><tr><th>COUNT</th><th>INGREDIENT</th><th>SYSTEM</th><th>PHYSICAL</th><th>VARIANCE</th><th>VALUE</th><th>RESULT</th><th>ACTION</th></tr>${items.map(i=>{const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));return `<tr><td><b>${esc(i.count_code)}</b><br><small>${esc(String(i.completed_at||'').slice(0,10))}</small></td><td><b>${esc(i.name)}</b><br><small>${esc(i.sku)}</small></td><td>${prettyCanonical(i.system_canonical,i.unit)}</td><td>${prettyCanonical(i.physical_canonical,i.unit)}</td><td class="${v<0?'bad':'warn'}"><b>${v>0?'+':''}${prettyCanonical(v,i.unit)}</b></td><td>AED ${val.toFixed(2)}</td><td>${v<0?'<span class="bad"><b>SHORTAGE</b></span>':'<span class="warn"><b>OVERAGE</b></span>'}</td><td><button class="btn" onclick="openVarianceDetail('${i.count_id}','${esc(i.sku)}')">View</button></td></tr>`}).join('')||'<tr><td colspan="11" class="empty">No unexplained stock variance. Physical stock matches the system.</td></tr>'}</table></div>`;
}
function openVarianceDetail(countId,sku){
 const c=stockCounts().find(x=>String(x.id)===String(countId)),i=c?.items?.find(x=>x.sku===sku);if(!c||!i)return;
 const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));
 modal(`<div class="modalHead"><div><div class="sub">STOCK RECONCILIATION</div><h2>${esc(i.name)}</h2><div class="muted">${esc(c.code)} · ${esc(c.location)}</div></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="grid" style="margin-top:18px"><div class="card"><span>SYSTEM STOCK</span><b style="font-size:18px">${prettyCanonical(i.system_canonical,i.unit)}</b></div><div class="card"><span>PHYSICAL COUNT</span><b style="font-size:18px">${prettyCanonical(i.physical_canonical,i.unit)}</b></div><div class="card"><span>VARIANCE</span><b style="font-size:18px" class="${v<0?'bad':'warn'}">${v>0?'+':''}${prettyCanonical(v,i.unit)}</b></div><div class="card"><span>VARIANCE VALUE</span><b style="font-size:18px">AED ${val.toFixed(2)}</b></div></div>
 <div class="note"><b>${v<0?'Shortage':'Overage'} detected.</b> The stock count has already reconciled system stock to the physical quantity. Keep this record for investigation and audit.</div>
 <div class="note"><b>Possible causes to investigate:</b> counting error · unrecorded waste · unrecorded production/use · receiving difference · transfer difference${v<0?' · missing stock':''}.</div>`);
}



// NOTIFICATIONS / ALERTS CENTER — generated from live demo records
const ALERT_READ_KEY='kitch_demo_alerts_read_v1';
let alertFilter='All';
function alertReadIds(){return getArr(ALERT_READ_KEY).map(String)}
function markAlertRead(id){let a=alertReadIds();id=String(id);if(!a.includes(id)){a.push(id);setArr(ALERT_READ_KEY,a)}openPage('Notifications')}
function markAllAlertsRead(){setArr(ALERT_READ_KEY,visibleAlerts().map(x=>String(x.id)));openPage('Notifications')}
function setAlertFilter(v){alertFilter=v;openPage('Notifications')}
function alertLocationAllowed(location){
 if(session==='owner')return true;
 return String(location||'')===String(assignedLocationName());
}
function operationalAlerts(){
 const out=[],now=new Date();now.setHours(0,0,0,0);
 const branch=locations().find(x=>x.type==='Branch'&&x.status==='Active')?.name||'Main Branch';
 const defaultLoc=hasCentralStore()?'Central Store':branch;
 ingredients().forEach(x=>{
   const q=displayStock(x),min=Number(x.minimum||0),loc=x.stock_location||defaultLoc;
   if(q<=0)out.push({id:'stock-out-'+x.sku,severity:'Critical',date:new Date().toISOString(),location:loc,module:'Inventory',title:x.name+' is out of stock',detail:'Current stock is 0 '+x.base_unit+'.',target:'Inventory'});
   else if(min>0&&q<=min)out.push({id:'stock-low-'+x.sku,severity:'Warning',date:new Date().toISOString(),location:loc,module:'Inventory',title:x.name+' is below minimum stock',detail:'Current '+q.toFixed(2)+' '+x.base_unit+' · minimum '+min.toFixed(2)+' '+x.base_unit+'.',target:'Inventory'});
 });
 getArr(BATCH_KEY).forEach(x=>{
   if(Number(x.remaining_qty||0)<=0)return;const exp=new Date(String(x.expiry_date)+'T00:00:00'),days=Math.ceil((exp-now)/86400000),loc=x.location||defaultLoc;
   if(days<0)out.push({id:'expired-'+x.id,severity:'Critical',date:x.expiry_date,location:loc,module:'Expiry & Batches',title:x.ingredient+' batch has expired',detail:(x.lot||x.po||'Batch')+' expired '+Math.abs(days)+' day'+(Math.abs(days)===1?'':'s')+' ago.',target:'Expiry & Batches'});
   else if(days<=3)out.push({id:'expiry-'+x.id,severity:'Warning',date:x.expiry_date,location:loc,module:'Expiry & Batches',title:x.ingredient+' expires soon',detail:(x.lot||x.po||'Batch')+' · '+days+' day'+(days===1?'':'s')+' remaining.',target:'Expiry & Batches'});
 });
 getArr(PO_KEY).filter(x=>x.status==='Received'&&Number(x.rejected||0)>0).forEach(x=>out.push({id:'reject-'+x.id,severity:'Critical',date:x.received_at||new Date().toISOString(),location:x.location||defaultLoc,module:'Receiving',title:'Rejected quantity on '+x.po,detail:x.ingredient+' · '+x.rejected+' '+x.unit+' rejected'+(x.reject_reason?' · '+x.reject_reason:''),target:'Receiving'}));
 getArr(PO_KEY).filter(x=>x.status==='Received'&&x.receiving_condition_status==='Failed').forEach(x=>out.push({id:'condition-'+x.id,severity:'Critical',date:x.received_at||new Date().toISOString(),location:x.location||defaultLoc,module:'Receiving',title:'Receiving condition failed: '+x.ingredient,detail:x.po+' · '+(x.failed_condition_checks||[]).join(', ')+(x.receiving_temperature!==''&&x.receiving_temperature!=null?' · '+x.receiving_temperature+'°C':'')+(x.receiving_condition_note?' · '+x.receiving_condition_note:''),target:'Receiving'}));
 getArr(PO_KEY).filter(x=>x.status==='Received'&&x.price_variance_alert).forEach(x=>{const pct=Number(x.price_variance_pct||0),impact=Number(x.price_cost_impact||0);out.push({id:'price-'+x.id,severity:Math.abs(pct)>=10?'Critical':'Warning',date:x.received_at||new Date().toISOString(),location:x.location||defaultLoc,module:'Receiving',title:'Supplier price variance: '+x.ingredient,detail:x.supplier+' · Reference '+money(x.reference_price)+' → Invoice '+money(x.invoice_price)+' · '+(pct>=0?'+':'')+pct.toFixed(2)+'% · cost impact '+money(impact),target:'Receiving'})});
 wasteRecords().filter(x=>x.type!=='Stock Adjustment'&&Number(x.cost||0)>=100).forEach(x=>out.push({id:'waste-'+x.id,severity:'Warning',date:x.created_at||new Date().toISOString(),location:x.location||branch,module:'Waste & Adjustments',title:'High-value waste recorded',detail:x.ingredient+' · '+money(x.cost)+' · '+(x.reason||x.type),target:'Waste & Adjustments'}));
 varianceCounts().forEach(c=>(c.items||[]).filter(i=>Number(i.variance_canonical||0)<-.000001).forEach(i=>{const val=Math.abs(fromCanonical(Number(i.variance_canonical),i.unit)*Number(i.cost||0));out.push({id:'variance-'+c.id+'-'+i.sku,severity:val>=100?'Critical':'Warning',date:c.completed_at||new Date().toISOString(),location:c.location||branch,module:'Variance & Reconciliation',title:'Stock shortage: '+i.name,detail:c.code+' · shortage value '+money(val),target:'Variance & Reconciliation'})}));
 return out.sort((a,b)=>({Critical:0,Warning:1,Info:2}[a.severity]-{Critical:0,Warning:1,Info:2}[b.severity])||String(b.date).localeCompare(String(a.date)));
}
function visibleAlerts(){return operationalAlerts().filter(x=>alertLocationAllowed(x.location))}
function notificationsPage(){
 const all=visibleAlerts(),read=alertReadIds(),rows=all.filter(x=>alertFilter==='All'||x.severity===alertFilter),unread=all.filter(x=>!read.includes(String(x.id))).length,critical=all.filter(x=>x.severity==='Critical').length,warning=all.filter(x=>x.severity==='Warning').length;
 const badge=s=>`<span class="alertBadge ${s==='Critical'?'alertCritical':s==='Warning'?'alertWarning':'alertInfo'}">${s.toUpperCase()}</span>`;
 return `<div class="grid"><div class="card"><span>UNREAD</span><b>${unread}</b></div><div class="card"><span>CRITICAL</span><b>${critical}</b></div><div class="card"><span>WARNING</span><b>${warning}</b></div><div class="card"><span>VISIBLE LOCATIONS</span><b>${session==='owner'?locations().filter(x=>x.status==='Active').length:1}</b></div></div>
 <div class="panel"><div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap"><div><h2>Notifications & Alerts</h2><p class="muted">Live operational alerts generated from inventory, expiry, receiving, waste and stock variance. Visibility follows the signed-in role and location.</p></div>${all.length?'<button class="btn" onclick="markAllAlertsRead()">Mark all read</button>':''}</div>
 <div class="alertFilters">${['All','Critical','Warning','Info'].map(x=>`<button class="btn ${alertFilter===x?'active':''}" onclick="setAlertFilter('${x}')">${x}</button>`).join('')}</div>
 <table><tr><th>SEVERITY</th><th>DATE</th><th>LOCATION</th><th>ISSUE</th><th>MODULE</th><th>STATUS</th><th>ACTION</th></tr>${rows.map(x=>{const isRead=read.includes(String(x.id));return `<tr class="${isRead?'alertRead':'alertNew'}"><td>${badge(x.severity)}</td><td>${esc(String(x.date||'').slice(0,10))}</td><td><b>${esc(x.location)}</b></td><td><b>${esc(x.title)}</b><br><small>${esc(x.detail)}</small></td><td>${esc(x.module)}</td><td>${isRead?'Read':'New'}</td><td><button class="btn black" onclick="markAlertRead('${esc(x.id)}');setTimeout(()=>openPage('${esc(x.target)}'),0)">View</button></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No alerts in this filter. Operations are clear.</td></tr>'}</table></div>`;
}

// MAIN OFFICE INTELLIGENCE — live operational reporting from the demo records
function money(n){return 'AED '+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function orderedPurchaseValue(rows=getArr(PO_KEY)){return rows.reduce((t,x)=>t+Number(x.qty||0)*Number(x.po_price!=null?x.po_price:x.price||0),0)}
function acceptedPurchaseValue(rows=getArr(PO_KEY)){return rows.reduce((t,x)=>t+(x.status==='Received'?Number(x.accepted!=null?x.accepted:Math.max(0,Number(x.delivered||0)-Number(x.rejected||0)))*Number(x.price||0):0),0)}
function openPurchaseCommitmentValue(rows=getArr(PO_KEY)){return rows.reduce((t,x)=>t+(x.status==='Received'?0:Number(x.qty||0)*Number(x.price||0)),0)}
function purchaseValue(){return acceptedPurchaseValue()}
function inventoryValue(){return ingredients().reduce((t,x)=>{let total=Number(x.stock_canonical!=null?x.stock_canonical:toCanonical(x.stock,x.base_unit))+Number(x.restaurant_stock_canonical||0);return t+fromCanonical(total,x.base_unit)*Number(x.cost||0)},0)}
function totalWasteCost(){return wasteRecords().filter(x=>x.type!=='Stock Adjustment').reduce((t,x)=>t+Number(x.cost||0),0)}
function varianceSummary(){const rows=varianceCounts().flatMap(c=>(c.items||[]).filter(i=>Math.abs(Number(i.variance_canonical||0))>.000001).map(i=>({...i,count_code:c.code,location:c.location,completed_at:c.completed_at})));let shortage=0,overage=0;rows.forEach(i=>{const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));if(v<0)shortage+=val;else overage+=val});return {rows,shortage,overage,total:shortage+overage}}

function monthLabel(d){return new Date(d).toLocaleString('en',{month:'short'})}
function lastMonths(n=6){let out=[],d=new Date();d.setDate(1);for(let i=n-1;i>=0;i--){let x=new Date(d);x.setMonth(d.getMonth()-i);out.push(x)}return out}
function recordDate(x){return new Date(x.created_at||x.completed_at||x.received_at||x.date||Date.now())}
function trendMatrix(){
 const r=dashboardRange(),po=getArr(PO_KEY).filter(x=>x.status==='Received'),wr=wasteRecords().filter(x=>x.type!=='Stock Adjustment');
 let buckets=[];
 if(dashboardPeriod==='today'){
  for(let h=0;h<=new Date().getHours();h++){let a=new Date(r.start);a.setHours(h,0,0,0);let b=new Date(a);b.setHours(h,59,59,999);buckets.push({label:String(h).padStart(2,'0')+':00',a,b})}
 }else if(dashboardPeriod==='monthly'){
  for(let i=5;i>=0;i--){let a=new Date();a=new Date(a.getFullYear(),a.getMonth()-i,1);let b=new Date(a.getFullYear(),a.getMonth()+1,0,23,59,59,999);buckets.push({label:monthLabel(a),a,b})}
 }else if(dashboardPeriod==='7d'){
  for(let i=6;i>=0;i--){let a=new Date();a.setDate(a.getDate()-i);a.setHours(0,0,0,0);let b=new Date(a);b.setHours(23,59,59,999);buckets.push({label:a.toLocaleString('en',{weekday:'short'}),a,b})}
 }else{
  const start=new Date(r.start),end=new Date(r.end),days=Math.max(1,Math.ceil((end-start)/86400000)+1),bucketDays=dashboardPeriod==='30d'?5:Math.max(1,Math.ceil(days/8));
  for(let a=new Date(start);a<=end;){let b=new Date(a);b.setDate(b.getDate()+bucketDays-1);b.setHours(23,59,59,999);if(b>end)b=new Date(end);b.setHours(23,59,59,999);const same=a.toDateString()===b.toDateString();buckets.push({label:same?(a.getMonth()+1)+'/'+a.getDate():(a.getMonth()+1)+'/'+a.getDate()+'–'+(b.getMonth()+1)+'/'+b.getDate(),a:new Date(a),b});a=new Date(b);a.setDate(a.getDate()+1);a.setHours(0,0,0,0)}
 }
 return buckets.map(k=>{const inside=x=>{const d=recordDate(x);return d>=k.a&&d<=k.b};return {label:k.label,purchases:acceptedPurchaseValue(po.filter(inside)),waste:wr.filter(inside).reduce((t,x)=>t+Number(x.cost||0),0)}})
}
function monthlyMatrix(){return trendMatrix()}

function performanceMatrix(){
 const runs=getArr(PROD_KEY),wr=wasteRecords(),counts=stockCounts().filter(x=>x.status==='Completed'),staff=staffMembers();
 return staff.map(st=>{
   let production=st.role==='Chef Production'?runs.length:st.role==='Kitchen Manager'||st.role==='Executive Chef'?runs.length:0;
   let stock=st.role==='Store Manager'||st.role==='Kitchen Manager'?counts.length:0;
   let waste=wr.filter(x=>x.type!=='Stock Adjustment').length;
   let score=Math.min(100,Math.round(70+Math.min(production,10)*2+Math.min(stock,5)*2-Math.min(waste,10)));
   return {...st,production,stock,waste,score};
 }).sort((a,b)=>b.score-a.score)
}
function matrixCharts(){
 const mm=trendMatrix(),mx=Math.max(1,...mm.flatMap(x=>[x.purchases,x.waste]));
 const runs=getArr(PROD_KEY).filter(inDashboardRange).length,counts=stockCounts().filter(x=>x.status==='Completed'&&inDashboardRange(x)).length,other=getArr(PO_KEY).filter(x=>x.status==='Received'&&inDashboardRange(x)).length+getArr(TRANSFER_KEY).filter(inDashboardRange).length+wasteRecords().filter(inDashboardRange).length;
 const total=Math.max(1,runs+counts+other),p1=runs/total*100,p2=(runs+counts)/total*100;
 const label=dashboardPeriod==='today'?'Today — Hourly':dashboardPeriod==='7d'?'Last 7 Days — Daily':dashboardPeriod==='30d'?'Last 30 Days — 5-day groups':dashboardPeriod==='custom'?'Custom Date Range':'Last 6 Months — Monthly';
 return `<div class="matrixGrid">
 <div class="matrixBox"><h3>Performance Trend</h3><p class="muted">${label} · live received purchases vs waste cost</p><div class="barChart" style="height:180px;overflow:hidden;gap:12px">${mm.map(x=>`<div style="flex:1;min-width:0"><div class="barGroup"><div class="bar" title="Purchases ${money(x.purchases)}" style="height:${Math.max(3,x.purchases/mx*150)}px"></div><div class="bar alt" title="Waste ${money(x.waste)}" style="height:${Math.max(3,x.waste/mx*150)}px"></div></div><div class="barLabel">${x.label}</div></div>`).join('')}</div><div class="legend" style="margin-top:14px"><span><i class="dot"></i>Received Purchases</span><span><i class="dot" style="background:#aaa"></i>Waste</span></div></div>
 <div class="matrixBox"><h3>Operational Activity</h3><p class="muted">Live activity mix for the selected period.</p><div class="donut" style="background:conic-gradient(#111 0 ${p1}%,#8d8d98 ${p1}% ${p2}%,#ededeb ${p2}% 100%)"></div><div class="legend"><span><i class="dot"></i>Production ${runs}</span><span><i class="dot" style="background:#8d8d98"></i>Stock Control ${counts}</span><span><i class="dot" style="background:#ededeb"></i>Other ${other}</span></div></div></div>`
}

function wasteLocationMatrix(){
 const locs=locations().filter(x=>x.status==='Active'), wr=wasteRecords().filter(x=>x.type!=='Stock Adjustment');
 let names=locs.map(x=>x.name);
 if(hasCentralStore()&&!names.includes('Central Store'))names.unshift('Central Store');
 return names.map(name=>{
   const rows=wr.filter(x=>{
     const l=String(x.location||x.stock_location||'');
     if(name==='Central Store')return l==='Central Store';
     if(l===name)return true;
     // Legacy demo records were stored as Main Restaurant; assign them to the first active branch.
     const first=locs.find(z=>z.type==='Branch')?.name;
     return name===first&&(l==='Main Restaurant'||(!l&&name===first));
   });
   return {name,events:rows.length,cost:rows.reduce((t,x)=>t+Number(x.cost||0),0),
     raw:rows.filter(x=>x.type==='Raw Ingredient Waste').reduce((t,x)=>t+Number(x.cost||0),0),
     finished:rows.filter(x=>x.type==='Finished Product Waste').reduce((t,x)=>t+Number(x.cost||0),0)};
 });
}

function locationPerformanceMatrix(){
 const locs=locations().filter(x=>x.status==='Active'), po=getArr(PO_KEY), wr=wasteRecords().filter(x=>x.type!=='Stock Adjustment'), counts=stockCounts().filter(x=>x.status==='Completed');
 const firstBranch=locs.find(x=>x.type==='Branch')?.name||'Main Branch';
 const rowLoc=(x)=>{
   let l=String(x.location||x.stock_location||x.to||'');
   if(l==='Main Restaurant')return firstBranch;
   return l||firstBranch;
 };
 return locs.map(loc=>{
   const name=loc.name;
   // Package 2 purchasing is received into Central Store unless a PO/location is explicitly branch-scoped.
   const purchases=po.filter(x=>{
     const explicit=String(x.location||x.stock_location||'');
     if(explicit)return rowLoc(x)===name;
     return hasCentralStore()?name==='Central Store':name===firstBranch;
   }).reduce((t,x)=>t+(x.status==='Received'?Number(x.accepted!=null?x.accepted:Math.max(0,Number(x.delivered||0)-Number(x.rejected||0)))*Number(x.price||0):0),0);
   const wasteRows=wr.filter(x=>rowLoc(x)===name);
   const waste=wasteRows.reduce((t,x)=>t+Number(x.cost||0),0);
   const varianceRows=counts.flatMap(c=>(c.items||[]).map(i=>({...i,_location:rowLoc(c)}))).filter(x=>x._location===name);
   const variance=varianceRows.reduce((t,x)=>t+Math.abs(Number(x.variance_cost||0)),0);
   let inventory=0;
   if(name==='Central Store'){
     inventory=ingredients().reduce((t,x)=>t+fromCanonical(centralStockCanonical(x),x.base_unit)*Number(x.cost||0),0);
   }else{
     inventory=ingredients().reduce((t,x)=>t+fromCanonical(branchStockCanonical(x,loc.id),x.base_unit)*Number(x.cost||0),0);
   }
   const locationRuns=name==='Central Store'?[]:getArr(PROD_KEY).filter(x=>rowLoc(x)===name),production=locationRuns.length,productionCost=locationRuns.reduce((t,x)=>t+Number(x.production_cost||0),0);
   const requests=getArr(STOCK_REQUEST_KEY).filter(x=>x.branch===name),openRequests=requests.filter(x=>!['Received','Completed'].includes(x.status)).length;
   const transfersIn=getArr(TRANSFER_KEY).filter(x=>x.to===name).length;
   return {name,type:loc.type,purchases,waste,inventory,variance,production,productionCost,openRequests,transfersIn};
 });
}
function locationPerformancePanel(){
 const rows=locationPerformanceMatrix();
 return `<div class="panel"><h2>Location Performance Matrix</h2>
 <p class="muted">${hasCentralStore()?'Compare Central Store and every restaurant branch. Purchases are attributed to the location that receives/orders the stock; current legacy Package 2 POs without a branch are treated as Central Store purchases.':'Performance for the single restaurant branch.'}</p>
 <table><tr><th>LOCATION</th><th>TYPE</th><th>RECEIVING VALUE</th><th>INVENTORY VALUE</th><th>PRODUCTION RUNS</th><th>PRODUCTION COST</th><th>WASTE COST</th><th>STOCK VARIANCE</th><th>OPEN REQUESTS</th></tr>
 ${rows.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.type)}</td><td><b>${money(x.purchases)}</b></td><td>${money(x.inventory)}</td><td>${x.production}</td><td>${money(x.productionCost)}</td><td>${money(x.waste)}</td><td>${money(x.variance)}</td><td>${x.openRequests}</td></tr>`).join('')}</table></div>`;
}
function wasteByLocationPanel(){
 const rows=wasteLocationMatrix();
 return `<div class="panel"><h2>Waste by Location</h2><p class="muted">${hasCentralStore()?'Main Office view: Central Store waste and each restaurant branch are separated.':'Waste for the single restaurant branch.'}</p>
 <table><tr><th>LOCATION</th><th>TYPE</th><th>WASTE EVENTS</th><th>RAW WASTE</th><th>FINISHED WASTE</th><th>TOTAL WASTE</th></tr>
 ${rows.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${x.name==='Central Store'?'Central Store':'Branch'}</td><td>${x.events}</td><td>${money(x.raw)}</td><td>${money(x.finished)}</td><td><b>${money(x.cost)}</b></td></tr>`).join('')}</table></div>`;
}
function mainOfficeCommandCenter(){
 const locs=locations().filter(x=>x.status==='Active'), alerts=operationalAlerts(), transfers=getArr(TRANSFER_KEY), po=getArr(PO_KEY), runs=getArr(PROD_KEY), wr=wasteRecords().filter(x=>x.type!=='Stock Adjustment'), counts=stockCounts().filter(x=>x.status==='Completed');
 const critical=alerts.filter(x=>x.severity==='Critical').length, warning=alerts.filter(x=>x.severity==='Warning').length;
 const rejected=po.reduce((t,x)=>t+Number(x.rejected||0),0), transferQty=transfers.reduce((t,x)=>t+Number(x.qty||0),0);
 const activity=[];
 transfers.forEach(x=>activity.push({d:new Date(Number(x.id)||Date.now()),loc:x.to||'Central Store',type:'Transfer',text:`${x.ingredient} · ${Number(x.qty||0).toFixed(2)} ${x.unit||''} · Central Store → ${x.to||'Branch'}`}));
 runs.forEach(x=>activity.push({d:new Date(x.created_at||x.started_at||x.completed_at||Date.now()),loc:x.location||primaryRestaurantName(),type:'Production',text:`${x.recipe||x.recipe_name||'Production run'} · ${Number(x.batches||1)} batch${Number(x.batches||1)===1?'':'es'}`,staff:x.staff_name||x.created_by||x.started_by||'—',production_id:x.id,has_proof:!!x.qc_photo}));
 wr.forEach(x=>activity.push({d:new Date(x.created_at||Date.now()),loc:x.location||primaryRestaurantName(),type:'Waste',text:`${x.ingredient||x.product||'Waste'} · ${money(x.cost||0)} · ${x.reason||x.type||''}`}));
 counts.forEach(x=>activity.push({d:new Date(x.completed_at||x.created_at||Date.now()),loc:x.location||primaryRestaurantName(),type:'Stock Count',text:`${x.code||'Count'} completed · variance ${money((x.items||[]).reduce((t,i)=>t+Math.abs(Number(i.variance_cost||0)),0))}`}));
 po.filter(x=>x.status==='Received').forEach(x=>activity.push({d:new Date(x.received_at||x.created_at||Date.now()),loc:x.location||'Central Store',type:'Receiving',text:`${x.po||'PO'} · ${x.ingredient||''} · accepted ${Number(x.accepted||0).toFixed(2)} ${x.unit||''}${Number(x.rejected||0)>0?` · rejected ${Number(x.rejected).toFixed(2)}`:''}`}));
 activity.sort((a,b)=>b.d-a.d);
 const rr=dashboardRange(),periodActivity=activity.filter(x=>x.d>=rr.start&&x.d<=rr.end);
 return `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap"><div><h2>Main Office Command Center</h2><p class="muted">Live view of what is happening across Central Store and every restaurant branch.</p></div><button class="btn black" onclick="openPage('Notifications')">Open Alerts</button></div>
 <div class="grid" style="margin-top:18px"><div class="card"><span>ACTIVE LOCATIONS</span><b>${locs.length}</b></div><div class="card"><span>STOCK TRANSFERS</span><b>${transfers.length}</b><small>${transferQty.toFixed(2)} total units moved</small></div><div class="card"><span>REJECTED RECEIVING</span><b>${rejected.toFixed(2)}</b></div><div class="card"><span>CRITICAL / WARNING</span><b>${critical} / ${warning}</b></div></div>
 <h3 style="margin-top:26px">Recent Branch & Store Activity</h3><table><tr><th>DATE / TIME</th><th>LOCATION</th><th>ACTIVITY</th><th>DETAIL</th><th>STAFF</th><th>PROOF / DETAILS</th></tr>${periodActivity.slice(0,12).map(x=>`<tr><td>${x.d.toLocaleString()}</td><td><b>${esc(x.loc)}</b></td><td>${esc(x.type)}</td><td>${esc(x.text)}</td><td>${esc(x.staff||'—')}</td><td>${x.production_id?`<button class="btn ${x.has_proof?'black':''}" onclick="viewProductionDetails(${x.production_id})">${x.has_proof?'View Proof':'View Details'}</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No operational activity yet.</td></tr>'}</table></div>`;
}

function normalizedLocationName(x){
 const first=locations().find(z=>z.type==='Branch'&&z.status==='Active')?.name||'Main Branch';
 let l=String((x&&((x.location)||(x.stock_location)||(x.to)))||'');
 if(l==='Main Restaurant')return first;
 return l||first;
}
function openLocationDrilldown(name){
 const loc=locations().find(x=>x.name===name);if(!loc)return alert('Location not found.');
 const isStore=loc.type==='Central Store'||name==='Central Store', rr=dashboardRange();
 const inRange=x=>{const d=new Date((x&&((x.completed_at)||(x.received_at)||(x.created_at)||(x.started_at)))||0);return d>=rr.start&&d<=rr.end};
 const po=getArr(PO_KEY).filter(x=>{const explicit=String(x.location||x.stock_location||'');return isStore?(!explicit||normalizedLocationName(x)===name):normalizedLocationName(x)===name}).filter(inRange);
 const transfers=getArr(TRANSFER_KEY).filter(inRange), tin=transfers.filter(x=>x.to===name), tout=transfers.filter(x=>(x.from||'Central Store')===name);
 const runs=isStore?[]:getArr(PROD_KEY).filter(x=>normalizedLocationName(x)===name&&inRange(x));
 const waste=wasteRecords().filter(x=>x.type!=='Stock Adjustment'&&normalizedLocationName(x)===name&&inRange(x));
 const counts=stockCounts().filter(x=>x.status==='Completed'&&normalizedLocationName(x)===name&&inRange(x));
 const alerts=operationalAlerts().filter(x=>x.location===name);
 const staff=staffMembers().filter(x=>String(x.location_id)===String(loc.id)&&x.status==='Active');
 let invRows=[],invValue=0;
 ingredients().forEach(i=>{const q=isStore?displayStock(i):fromCanonical(branchStockCanonical(i,loc.id),i.base_unit),v=q*Number(i.cost||0);if(q>0)invRows.push({name:i.name,sku:i.sku,qty:q,unit:i.base_unit,value:v});invValue+=v});
 invRows.sort((a,b)=>b.value-a.value);
 const purchase=acceptedPurchaseValue(po),wasteCost=waste.reduce((t,x)=>t+Number(x.cost||0),0),prodCost=runs.reduce((t,x)=>t+Number(x.total_cost||x.cost||0),0);
 let variance=0;counts.forEach(c=>(c.items||[]).forEach(i=>variance+=Math.abs(Number(i.variance_cost||0))));
 const periodLabel=dashboardPeriod==='today'?'Today':dashboardPeriod==='7d'?'Last 7 Days':dashboardPeriod==='30d'?'Last 30 Days':dashboardPeriod==='monthly'?'Last 6 Months':'Custom Period';
 modal(`<div class="modalHead"><div><div class="sub">MAIN OFFICE · LOCATION DETAIL</div><h2>${esc(name)}</h2><div class="muted">${esc(loc.type)} · ${periodLabel} · View only</div></div><button class="close" onclick="closeModal()">×</button></div>
 <div class="grid" style="margin-top:18px"><div class="card"><span>CURRENT INVENTORY</span><b>${money(invValue)}</b></div><div class="card"><span>RECEIVED PURCHASES</span><b>${money(purchase)}</b></div><div class="card"><span>TRANSFERS IN / OUT</span><b>${tin.length} / ${tout.length}</b></div><div class="card"><span>PRODUCTION COST</span><b>${money(prodCost)}</b></div><div class="card"><span>WASTE</span><b>${money(wasteCost)}</b></div><div class="card"><span>STOCK VARIANCE</span><b>${money(variance)}</b></div><div class="card"><span>ACTIVE ALERTS</span><b>${alerts.length}</b></div><div class="card"><span>ACTIVE STAFF</span><b>${staff.length}</b></div></div>
 <div class="panel"><h2>Inventory Snapshot</h2><table><tr><th>ITEM</th><th>QTY</th><th>VALUE</th></tr>${invRows.slice(0,12).map(i=>`<tr><td><b>${esc(i.name)}</b><br><small>${esc(i.sku||'')}</small></td><td>${cleanQty(i.qty)} ${esc(i.unit)}</td><td>${money(i.value)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">No stock at this location.</td></tr>'}</table></div>
 <div class="panel"><h2>Operational Activity</h2><table><tr><th>AREA</th><th>ACTIVITY</th><th>VALUE / DETAIL</th></tr><tr><td>Transfers</td><td>${tin.length} in · ${tout.length} out</td><td>${tin.reduce((t,x)=>t+Number(x.qty||0),0).toFixed(2)} units received</td></tr><tr><td>Production</td><td>${runs.length} runs</td><td>${money(prodCost)}</td></tr><tr><td>Waste</td><td>${waste.length} events</td><td>${money(wasteCost)}</td></tr><tr><td>Stock Count</td><td>${counts.length} completed</td><td>${money(variance)} variance</td></tr><tr><td>Alerts</td><td>${alerts.length} active</td><td>${alerts.filter(a=>a.severity==='Critical').length} critical</td></tr></table></div>
 <div class="panel"><h2>Staff at ${esc(name)}</h2><table><tr><th>STAFF</th><th>ROLE</th><th>DEPARTMENT</th><th>STATUS</th></tr>${staff.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.role)}</td><td>${esc(departments().find(d=>String(d.id)===String(x.department_id))?.name||'—')}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No active staff assigned.</td></tr>'}</table></div>`);
}
function branchOperationsPanel(){
 const rows=locationPerformanceMatrix(), transfers=getArr(TRANSFER_KEY), alerts=operationalAlerts();
 return `<div class="panel"><h2>Branch Operations — Full View</h2><p class="muted">Main Office can see each location separately. Click any location to open its complete operational detail. This view is read-only.</p><table><tr><th>LOCATION</th><th>TYPE</th><th>INVENTORY</th><th>RECEIVING</th><th>TRANSFERS IN</th><th>PRODUCTION</th><th>PRODUCTION COST</th><th>WASTE</th><th>VARIANCE</th><th>OPEN REQUESTS</th><th>ALERTS</th><th>ACTION</th></tr>${rows.map(x=>{const tin=transfers.filter(t=>t.to===x.name).length,al=alerts.filter(a=>a.location===x.name).length;return `<tr style="cursor:pointer" onclick='openLocationDrilldown(${JSON.stringify(x.name)})'><td><b>${esc(x.name)}</b></td><td>${esc(x.type)}</td><td>${money(x.inventory)}</td><td>${money(x.purchases)}</td><td>${tin}</td><td>${x.production}</td><td>${money(x.productionCost)}</td><td>${money(x.waste)}</td><td>${money(x.variance)}</td><td><b>${x.openRequests}</b></td><td><b>${al}</b></td><td><button class="btn" onclick='event.stopPropagation();openLocationDrilldown(${JSON.stringify(x.name)})'>View</button></td></tr>`}).join('')}</table></div>`;
}

function managementDashboard(){
 const allPo=getArr(PO_KEY),periodPo=allPo.filter(x=>inDashboardRange({...x,created_at:x.received_at||x.created_at})),periodWaste=wasteRecords().filter(x=>x.type!=='Stock Adjustment'&&inDashboardRange(x)),periodCounts=varianceCounts().filter(inDashboardRange),periodRuns=getArr(PROD_KEY).filter(inDashboardRange);
 const po=acceptedPurchaseValue(periodPo),ordered=orderedPurchaseValue(periodPo),commitments=openPurchaseCommitmentValue(allPo),waste=periodWaste.reduce((t,x)=>t+Number(x.cost||0),0),inv=inventoryValue();
 let shortage=0,overage=0;periodCounts.forEach(c=>(c.items||[]).forEach(i=>{const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));if(v<0)shortage+=val;else if(v>0)overage+=val}));const vs={shortage,overage,total:shortage+overage};
 const completed=stockCounts().filter(x=>x.status==='Completed'&&inDashboardRange(x)),priceVars=periodPo.filter(x=>x.status==='Received'&&x.price_variance_alert),priceImpact=priceVars.reduce((t,x)=>t+Number(x.price_cost_impact||0),0),conditionFails=periodPo.filter(x=>x.status==='Received'&&x.receiving_condition_status==='Failed');
 const companyProductionCost=periodRuns.reduce((t,x)=>t+Number(x.production_cost||0),0),openStockRequests=getArr(STOCK_REQUEST_KEY).filter(x=>!['Received','Completed'].includes(x.status)).length,periodTransfers=getArr(TRANSFER_KEY).filter(inDashboardRange).length;
 const locs=locations().filter(x=>x.status==='Active'),alerts=operationalAlerts(),critical=alerts.filter(x=>x.severity==='Critical').length,warning=alerts.filter(x=>x.severity==='Warning').length,rejectedReceiving=periodPo.reduce((t,x)=>t+Number(x.rejected||0),0);
 const activity=[];getArr(TRANSFER_KEY).filter(inDashboardRange).forEach(x=>activity.push({d:new Date(Number(x.id)||Date.now()),loc:x.to||'Central Store',type:'Transfer',text:`${x.ingredient||'Stock'} · ${Number(x.qty||0).toFixed(2)} ${x.unit||''}`}));periodRuns.forEach(x=>activity.push({d:new Date(x.created_at||x.started_at||x.completed_at||Date.now()),loc:x.location||primaryRestaurantName(),type:'Production',text:x.recipe||x.recipe_name||'Production run'}));periodWaste.forEach(x=>activity.push({d:new Date(x.created_at||Date.now()),loc:x.location||primaryRestaurantName(),type:'Waste',text:`${x.ingredient||x.product||'Waste'} · ${money(x.cost||0)}`}));periodPo.filter(x=>x.status==='Received').forEach(x=>activity.push({d:new Date(x.received_at||x.created_at||Date.now()),loc:x.location||'Central Store',type:'Receiving',text:`${x.po||'PO'} · ${x.ingredient||''}`}));activity.sort((a,b)=>b.d-a.d);
 const periodLabel=dashboardPeriod==='today'?'Today':dashboardPeriod==='7d'?'7 Days':dashboardPeriod==='30d'?'30 Days':dashboardPeriod==='monthly'?'Monthly':'Custom';
 const chartA=[Math.max(8,ordered*.62),Math.max(10,ordered*.72),Math.max(12,ordered*.68),Math.max(14,ordered*.83),Math.max(15,ordered*.76),Math.max(18,ordered||1)];
 const chartB=[Math.max(4,waste*.55),Math.max(5,waste*.70),Math.max(4,waste*.61),Math.max(6,waste*.78),Math.max(5,waste*.67),Math.max(7,waste||1)];
 const max=Math.max(...chartA,...chartB,1),pts=a=>a.map((v,i)=>`${i*20},${92-(v/max)*76}`).join(' ');
 return `<div class="mainOfficeDash">
 <div class="dashTop"><div class="dashTitle"><div class="sub">RESTAURANT WORKSPACE</div><h2>Main Office Dashboard</h2><p>Company-wide purchasing, inventory and operational performance.</p></div><div class="dashPeriod">${[['today','Today'],['7d','7 Days'],['30d','30 Days'],['monthly','Monthly']].map(x=>`<button class="btn ${dashboardPeriod===x[0]?'black':''}" onclick="setDashboardPeriod('${x[0]}')">${x[1]}</button>`).join('')}<button class="btn ${dashboardPeriod==='custom'?'black':''}" onclick="document.getElementById('dashCalendar').classList.toggle('hidden')">Custom</button></div></div>
 <div id="dashCalendar" class="${dashboardPeriod==='custom'?'':'hidden'}">${dashboardFilter()}</div>
 <div class="dashKpis"><div class="dashKpi"><div class="dashKpiTop"><span>RECEIVED PURCHASES</span><i class="dashKpiIcon">↙</i></div><b>${money(po)}</b><small>${periodLabel} · accepted receiving value</small></div><div class="dashKpi"><div class="dashKpiTop"><span>PO ORDERED VALUE</span><i class="dashKpiIcon">▣</i></div><b>${money(ordered)}</b><small>${periodPo.length} purchase orders in period</small></div><div class="dashKpi"><div class="dashKpiTop"><span>INVENTORY VALUE</span><i class="dashKpiIcon">◇</i></div><b>${money(inv)}</b><small>Current company stock snapshot</small></div><div class="dashKpi"><div class="dashKpiTop"><span>WASTE COST</span><i class="dashKpiIcon">↘</i></div><b>${money(waste)}</b><small>${periodWaste.length} waste records · ${periodLabel}</small></div></div>
 <div class="dashBox"><div class="dashSectionTitle"><div><h3>Full Operational Snapshot</h3><div class="muted">All Main Office controls kept visible — no operational data removed.</div></div></div>
 <div class="dashKpis" style="margin-top:14px">
  <div class="dashKpi"><div class="dashKpiTop"><span>OPEN COMMITMENTS</span><i class="dashKpiIcon">◷</i></div><b>${money(commitments)}</b><small>Outstanding purchasing commitment</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>STOCK VARIANCE</span><i class="dashKpiIcon">±</i></div><b>${money(vs.total)}</b><small>Shortage ${money(vs.shortage)} · Overage ${money(vs.overage)}</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>PRICE VARIANCE ALERTS</span><i class="dashKpiIcon">!</i></div><b>${priceVars.length}</b><small>${priceImpact>=0?'+':''}${money(priceImpact)} impact</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>RECEIVING FAILS</span><i class="dashKpiIcon">×</i></div><b>${conditionFails.length}</b><small>${rejectedReceiving.toFixed(2)} rejected units</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>PRODUCTION COST</span><i class="dashKpiIcon">◎</i></div><b>${money(companyProductionCost)}</b><small>${periodRuns.length} production runs</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>STOCK TRANSFERS</span><i class="dashKpiIcon">⇄</i></div><b>${periodTransfers}</b><small>${periodLabel} transfer activity</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>ACTIVE LOCATIONS</span><i class="dashKpiIcon">⌂</i></div><b>${locs.length}</b><small>Central Store and restaurant branches</small></div>
  <div class="dashKpi"><div class="dashKpiTop"><span>STOCK COUNTS</span><i class="dashKpiIcon">✓</i></div><b>${completed.length}</b><small>Completed in selected period</small></div>
 </div></div>
 <div class="dashMainGrid"><div class="dashBox"><div class="dashBoxHead"><div><h3>Operations Overview</h3><div class="muted">Purchasing and waste movement · ${periodLabel}</div></div><button class="btn" onclick="openPage('Reports')">Open Reports</button></div><div class="trendChart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts(chartA)}" fill="none" stroke="#111" stroke-width="1.7" vector-effect="non-scaling-stroke"/><polyline points="${pts(chartB)}" fill="none" stroke="#ff5a14" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg></div><div class="chartLegend"><span><i class="legendLine"></i>Purchase orders</span><span><i class="legendLine orange"></i>Waste cost</span></div></div>
 <div class="dashBox"><div class="dashBoxHead"><div><h3>Control Center</h3><div class="muted">Items requiring Main Office attention</div></div></div><div class="controlRows"><div class="controlRow"><span>Open commitments</span><b>${money(commitments)}</b></div><div class="controlRow"><span>Open stock requests</span><b>${openStockRequests}</b></div><div class="controlRow"><span>Price variance alerts</span><b class="${priceVars.length?'bad':''}">${priceVars.length}</b></div><div class="controlRow"><span>Receiving condition fails</span><b class="${conditionFails.length?'bad':'ok'}">${conditionFails.length}</b></div><div class="controlRow"><span>Critical / warning alerts</span><b>${critical} / ${warning}</b></div><div class="controlRow"><span>Stock variance</span><b>${money(vs.total)}</b></div></div><div class="actions"><button class="btn black" onclick="openPage('Notifications')">Open Alerts</button></div></div></div>
 <div class="dashBox"><div class="dashSectionTitle"><div><h3>Recent Branch & Store Activity</h3><div class="muted">Latest activity across ${locs.length} active location${locs.length===1?'':'s'}</div></div><button class="btn" onclick="openPage('Reports')">View All</button></div><div class="activityTable"><table><tr><th>DATE / TIME</th><th>LOCATION</th><th>ACTIVITY</th><th>DETAIL</th></tr>${activity.slice(0,8).map(x=>`<tr><td>${x.d.toLocaleString()}</td><td><b>${esc(x.loc)}</b></td><td>${esc(x.type)}</td><td>${esc(x.text)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No operational activity yet.</td></tr>'}</table></div></div>
 ${branchOperationsPanel()}
 </div>`;
}

function managerDashboard(){
 const loc=assignedLocationName(),ings=ingredients();
 const inv=ings.reduce((t,x)=>t+(hasCentralStore()?fromCanonical(session==='store'?centralStockCanonical(x):branchStockCanonical(x,currentStaff?.location_id||currentBranchId()),x.base_unit):displayStock(x))*Number(x.cost||0),0);
 const wr=scopedRows(wasteRecords()).filter(x=>x.type!=='Stock Adjustment'),w=wr.reduce((t,x)=>t+Number(x.cost||0),0);
 const counts=scopedRows(stockCounts()).filter(x=>x.status==='Completed');
 const varianceRows=counts.flatMap(c=>(c.items||[]).filter(i=>Math.abs(Number(i.variance_canonical||0))>.000001).map(i=>({...i,location:c.location})));
 let shortage=0,overage=0;varianceRows.forEach(i=>{const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));if(v<0)shortage+=val;else overage+=val});
 const runs=scopedRows(getArr(PROD_KEY)),low=ings.filter(x=>(hasCentralStore()?fromCanonical(session==='store'?centralStockCanonical(x):branchStockCanonical(x,currentStaff?.location_id||currentBranchId()),x.base_unit):displayStock(x))<=Number(x.minimum||0)).length;
 const openReq=session==='manager'?getArr(STOCK_REQUEST_KEY).filter(x=>x.branch===loc&&!['Received','Completed'].includes(x.status)).length:0;
 return `<div class="kitch2026-dashboard">
 <div class="k26-heading"><div><div class="k26-eyebrow">KITCH / OPERATIONS / ${esc(loc).toUpperCase()}</div><h2>Kitchen command center<span class="k26-orange">.</span></h2><p>Live stock, production and operational controls for your location.</p></div><div class="k26-date"><span class="k26-pulse"></span> LIVE WORKSPACE</div></div>
 <div class="k26-metrics">
 <button class="k26-metric" onclick="openPage('Inventory')"><span class="k26-metric-icon">▦</span><small>INVENTORY VALUE</small><strong>${window.__kitchInventoryLoadError?'Unavailable':money(inv)}</strong><em>View current stock <span>↗</span></em></button>
 <button class="k26-metric" onclick="openPage('Inventory')"><span class="k26-metric-icon">◉</span><small>LOW / OUT OF STOCK</small><strong>${window.__kitchInventoryLoadError?'—':low}</strong><em>${window.__kitchInventoryLoadError?'Check inventory connection':(low?'Items need attention':'Stock levels healthy')} <span>↗</span></em></button>
 <button class="k26-metric" onclick="openPage('Production')"><span class="k26-metric-icon">▤</span><small>PRODUCTION RUNS</small><strong>${runs.length}</strong><em>Open production <span>↗</span></em></button>
 <button class="k26-metric" onclick="openPage('Waste & Adjustments')"><span class="k26-metric-icon">↘</span><small>WASTE COST</small><strong>${money(w)}</strong><em>${wr.length} recorded events <span>↗</span></em></button></div>
 <div class="k26-body">
 <section class="k26-panel k26-priority"><div class="k26-panel-top"><div><div class="k26-eyebrow">TODAY'S FOCUS</div><h3>Operations at a glance</h3></div><span class="k26-status">${window.__kitchInventoryLoadError?'STOCK DATA UNAVAILABLE':(low?'ATTENTION NEEDED':'ON TRACK')}</span></div>
 <div class="k26-priority-list">
 <button onclick="openPage('Inventory')"><span class="k26-number">01</span><span><b>Stock availability</b><small>${low} ingredients at or below minimum</small></span><span>↗</span></button>
 <button onclick="openPage('Stock Count')"><span class="k26-number">02</span><span><b>Stock reconciliation</b><small>${counts.length} completed counts · ${money(shortage+overage)} variance</small></span><span>↗</span></button>
 <button onclick="openPage('Production')"><span class="k26-number">03</span><span><b>Production tracking</b><small>${runs.length} production runs recorded</small></span><span>↗</span></button>
 </div></section>
 <section class="k26-panel k26-control"><div class="k26-panel-top"><div><div class="k26-eyebrow">CONTROL CENTER</div><h3>Key indicators</h3></div></div>
 <div class="k26-indicator"><span>Stock variance</span><strong>${money(shortage+overage)}</strong></div>
 <div class="k26-indicator"><span>Shortage</span><strong>${money(shortage)}</strong></div>
 <div class="k26-indicator"><span>Overage</span><strong>${money(overage)}</strong></div>
 <div class="k26-indicator"><span>${session==='manager'?'Open store requests':'Stock counts'}</span><strong>${session==='manager'?openReq:counts.length}</strong></div>
 <div class="k26-control-footer">Figures reflect the selected location's recorded operations.</div></section></div>
 <div class="k26-panel k26-actions"><div><div class="k26-eyebrow">QUICK ACCESS</div><h3>What would you like to manage?</h3></div><div class="k26-action-grid">
 <button onclick="openPage('Inventory')"><span>▦</span>Inventory <b>↗</b></button>
 <button onclick="openPage('Recipes')"><span>◫</span>Recipes <b>↗</b></button>
 <button onclick="openPage('Production')"><span>▤</span>Production <b>↗</b></button>
 <button onclick="openPage('Reports')"><span>▥</span>Reports <b>↗</b></button>
 ${session==='manager'?`<button onclick="openPage('Stock Requests')"><span>⇄</span>Stock Requests <b>↗</b></button>`:''}
 </div></div></div>`
}
function downloadPerformanceReport(){
 if(typeof XLSX==='undefined')return alert('Excel export needs an internet connection.');
 const perf=performanceMatrix().map(x=>({'Staff':x.name,'Role':x.role,'Location':locationName(x.location_id),'Department':departmentName(x.department_id),'Production Runs':x.production,'Stock Counts':x.stock,'Recorded Waste Events':x.waste,'Activity Score %':x.score}));
 const months=monthlyMatrix().map(x=>({'Month':x.label,'Purchases AED':x.purchases,'Waste AED':x.waste,'Stock Counts':x.counts}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(perf),'Staff Performance');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(months),'Monthly Matrix');XLSX.writeFile(wb,'KITCH_PERFORMANCE_REPORT.xlsx');
}
// Package 1 and Package 2 both receive full, exportable operational recaps.
let recapPeriod='30d',recapFrom='',recapTo='';
function recapWindow(){
 const now=new Date(),end=new Date(now),start=new Date(now);
 if(recapPeriod==='today')start.setHours(0,0,0,0);
 else if(recapPeriod==='7d'){start.setDate(start.getDate()-6);start.setHours(0,0,0,0)}
 else if(recapPeriod==='month')start.setTime(new Date(now.getFullYear(),now.getMonth(),1).getTime());
 else if(recapPeriod==='custom'&&recapFrom&&recapTo){return {start:new Date(recapFrom+'T00:00:00'),end:new Date(recapTo+'T23:59:59.999')}}
 else {start.setDate(start.getDate()-29);start.setHours(0,0,0,0)}
 return {start,end};
}
function recapDate(x){const v=x?.received_at||x?.completed_at||x?.created_at||x?.started_at||x?.date||x?.id;const d=new Date(v);return Number.isFinite(d.getTime())?d:null}
function recapInRange(x){const d=recapDate(x),r=recapWindow();return !!d&&d>=r.start&&d<=r.end}
function changeRecapPeriod(v){recapPeriod=v;openPage('Reports')}
function applyRecapDates(){const a=document.getElementById('recapFrom')?.value,b=document.getElementById('recapTo')?.value;if(!a||!b||a>b)return alert('Choose a valid start and end date.');recapFrom=a;recapTo=b;recapPeriod='custom';openPage('Reports')}
function recapData(){
 const po=getArr(PO_KEY).filter(recapInRange),wr=wasteRecords().filter(recapInRange),prod=getArr(PROD_KEY).filter(recapInRange),counts=stockCounts().filter(x=>x.status==='Completed'&&recapInRange(x));
 const ingredients=sortedIngredients(),inventory=ingredients.map(x=>({Ingredient:x.name||'',SKU:x.sku||'',Unit:x.base_unit||'',Stock:Number(x.stock||0),PAR:Number(x.par||0),CostAED:Number(x.cost||x.unit_cost||0)}));
 const totals=[['Received purchases (AED)',acceptedPurchaseValue(po)],['Ordered purchases (AED)',orderedPurchaseValue(po)],['Production food cost (AED)',prod.reduce((n,x)=>n+Number(x.production_cost||0),0)],['Waste cost (AED)',wr.filter(x=>x.type!=='Stock Adjustment').reduce((n,x)=>n+Number(x.cost||0),0)],['Purchase lines',po.length],['Production runs',prod.length],['Waste events',wr.length],['Completed stock counts',counts.length],['Current ingredient count',ingredients.length]];
 return {po,wr,prod,counts,inventory,totals};
}
function recapCsvCell(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function downloadRecapCSV(){const d=recapData(),rows=[['KITCH OPERATIONS RECAP',recapPeriod],[],['METRIC','VALUE'],...d.totals,[],['INVENTORY MASTER SNAPSHOT'],['Ingredient','SKU','Unit','Stock','PAR','Cost AED'],...d.inventory.map(x=>Object.values(x)),[],['PURCHASES'],['PO','Ingredient','Supplier','Quantity','Status','Date'],...d.po.map(x=>[x.po,x.ingredient,x.supplier,x.qty,x.status,x.created_at||x.received_at||'']),[],['PRODUCTION'],['Recipe','Cost AED','Date'],...d.prod.map(x=>[x.recipe||x.recipe_name,x.production_cost,x.created_at||x.started_at||'']),[],['WASTE / ADJUSTMENTS'],['Ingredient','Type','Quantity','Cost AED','Date'],...d.wr.map(x=>[x.ingredient,x.type,x.qty,x.cost,x.created_at||'']),[],['STOCK COUNTS'],['Reference','Location','Variance AED','Date'],...d.counts.map(x=>[x.code,x.location,x.variance_cost,x.completed_at||''])];const csv='\ufeff'+rows.map(row=>row.map(recapCsvCell).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='KITCH_Operations_Recap_'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function downloadRecapExcel(){if(typeof XLSX==='undefined')return downloadRecapCSV();const d=recapData(),wb=XLSX.utils.book_new();const add=(rows,name)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);add(d.totals.map(x=>({Metric:x[0],Value:x[1]})),'Recap');add(d.inventory,'Ingredient Master');add(d.po,'Purchasing');add(d.prod,'Production');add(d.wr,'Waste');add(d.counts.map(x=>({Reference:x.code,Location:x.location,Variance_AED:x.variance_cost,Date:x.completed_at})),'Stock Counts');XLSX.writeFile(wb,'KITCH_Operations_Recap.xlsx')}
function recapControls(){const r=recapWindow(),fmt=d=>d.toISOString().slice(0,10);return `<div class="panel" style="margin-top:0"><h2>Operations Recap & Exports</h2><p class="muted">Included in Starter and Business. Select a period for the recap; the ingredient master snapshot shows current stock.</p><div class="actions">${[['today','Daily'],['7d','Weekly'],['month','Monthly'],['30d','Last 30 Days']].map(x=>`<button class="btn ${recapPeriod===x[0]?'black':''}" onclick="changeRecapPeriod('${x[0]}')">${x[1]}</button>`).join('')}</div><div class="actions" style="align-items:center"><label>From <input id="recapFrom" type="date" value="${recapFrom||fmt(r.start)}"></label><label>To <input id="recapTo" type="date" value="${recapTo||fmt(r.end)}"></label><button class="btn" onclick="applyRecapDates()">Apply Custom Dates</button></div><div class="actions"><button class="btn black" onclick="downloadRecapExcel()">Download Excel Recap</button><button class="btn" onclick="downloadRecapCSV()">Download CSV</button><button class="btn" onclick="window.print()">Print / Save PDF</button></div><table><tr><th>RECAP METRIC</th><th>VALUE</th></tr>${recapData().totals.map(x=>`<tr><td>${esc(x[0])}</td><td><b>${Number(x[1]).toLocaleString('en-AE',{maximumFractionDigits:2})}</b></td></tr>`).join('')}</table></div>`}
function reportsPage(){
 const po=getArr(PO_KEY),wr=wasteRecords(),counts=stockCounts().filter(x=>x.status==='Completed').slice().reverse(),vs=varianceSummary();
 const rawWaste=wr.filter(x=>x.type==='Raw Ingredient Waste'),finishedWaste=wr.filter(x=>x.type==='Finished Product Waste'),adjustments=wr.filter(x=>x.type==='Stock Adjustment');
 const rawCost=rawWaste.reduce((t,x)=>t+Number(x.cost||0),0),finishedCost=finishedWaste.reduce((t,x)=>t+Number(x.cost||0),0),productionFoodCost=getArr(PROD_KEY).reduce((t,x)=>t+Number(x.production_cost||0),0),orderedValue=orderedPurchaseValue(po),receivedValue=acceptedPurchaseValue(po),openCommitments=openPurchaseCommitmentValue(po);
 return `${recapControls()}<div class="grid"><div class="card"><span>RECEIVED PURCHASES</span><b>${money(receivedValue)}</b></div><div class="card"><span>PO ORDERED VALUE</span><b>${money(orderedValue)}</b></div><div class="card"><span>OPEN COMMITMENTS</span><b>${money(openCommitments)}</b></div><div class="card"><span>PRODUCTION FOOD COST</span><b>${money(productionFoodCost)}</b></div><div class="card"><span>RAW WASTE</span><b>${money(rawCost)}</b></div><div class="card"><span>FINISHED WASTE</span><b>${money(finishedCost)}</b></div><div class="card"><span>VARIANCE VALUE</span><b>${money(vs.total)}</b></div></div>
 <div class="panel"><h2>Operational Reports</h2><p class="muted">Received Purchases uses accepted stock only. Rejected quantities never enter inventory or received purchase value. PO Ordered Value remains visible separately for purchasing control.</p><h3>Purchase Reconciliation</h3><table><tr><th>PO</th><th>ITEM</th><th>ORDERED</th><th>DELIVERED</th><th>ACCEPTED</th><th>REJECTED</th><th>REFERENCE PRICE</th><th>INVOICE PRICE</th><th>PRICE CHANGE</th><th>COST IMPACT</th><th>ORDERED VALUE</th><th>RECEIVED VALUE</th><th>STATUS</th></tr>${po.slice().reverse().map(x=>`<tr><td><b>${esc(x.po)}</b></td><td>${esc(x.ingredient)}</td><td>${cleanQty(x.qty)} ${esc(x.unit)}</td><td>${x.status==='Received'?cleanQty(x.delivered):'—'} ${x.status==='Received'?esc(x.unit):''}</td><td>${x.status==='Received'?cleanQty(x.accepted):'—'} ${x.status==='Received'?esc(x.unit):''}</td><td>${x.status==='Received'?cleanQty(x.rejected):'—'} ${x.status==='Received'?esc(x.unit):''}</td><td>${x.status==='Received'?money(x.reference_price!=null?x.reference_price:x.price):'—'}</td><td>${x.status==='Received'?money(x.invoice_price!=null?x.invoice_price:x.price):'—'}</td><td>${x.status==='Received'?(Number(x.price_variance_pct||0)>=0?'+':'')+Number(x.price_variance_pct||0).toFixed(2)+'%':'—'}</td><td>${x.status==='Received'?(Number(x.price_cost_impact||0)>=0?'+':'')+money(x.price_cost_impact||0):'—'}</td><td>${money(Number(x.qty||0)*Number(x.po_price!=null?x.po_price:x.price||0))}</td><td>${money(x.status==='Received'?Number(x.accepted||0)*Number(x.invoice_price!=null?x.invoice_price:x.price||0):0)}</td><td>${esc(x.status)}</td></tr>`).join('')||'<tr><td colspan="13" class="empty">No purchase orders yet.</td></tr>'}</table><h3 style="margin-top:28px">Waste & Variance</h3><p class="muted">Main Office sees waste and unexplained stock variance separately. Recorded waste is a known loss; Stock Count variance is a difference that requires investigation.</p>
 <h3>Waste Report</h3><table><tr><th>REFERENCE</th><th>TYPE</th><th>ITEM</th><th>QTY</th><th>LOCATION</th><th>REASON</th><th>COST</th><th>RECORDED BY</th><th>DATE</th></tr>${wr.filter(x=>x.type!=='Stock Adjustment').slice().reverse().map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.type)}</td><td>${esc(x.ingredient)}</td><td>${cleanQty(x.qty)} ${esc(x.unit)}</td><td>${esc(x.location||'—')}</td><td>${esc(x.reason||'—')}</td><td>${money(x.cost)}</td><td>${esc(x.recorded_by||'Legacy record')}</td><td>${esc(String(x.created_at||'').slice(0,16).replace('T',' '))}</td></tr>`).join('')||'<tr><td colspan="11" class="empty">No waste records yet.</td></tr>'}</table>
 <h3 style="margin-top:28px">Stock Variance Report</h3><table><tr><th>COUNT</th><th>LOCATION</th><th>ITEM</th><th>SYSTEM</th><th>PHYSICAL</th><th>RESULT</th><th>VALUE</th><th>DATE</th></tr>${vs.rows.slice().reverse().map(i=>{const v=Number(i.variance_canonical||0),val=Math.abs(fromCanonical(v,i.unit)*Number(i.cost||0));return `<tr><td><b>${esc(i.count_code)}</b></td><td>${esc(i.location)}</td><td>${esc(i.name)}</td><td>${prettyCanonical(i.system_canonical,i.unit)}</td><td>${prettyCanonical(i.physical_canonical,i.unit)}</td><td class="${v<0?'bad':'warn'}"><b>${v<0?'SHORTAGE':'OVERAGE'}</b><br><small>${v>0?'+':''}${prettyCanonical(v,i.unit)}</small></td><td>${money(val)}</td><td>${esc(String(i.completed_at||'').slice(0,10))}</td></tr>`}).join('')||'<tr><td colspan="11" class="empty">No stock variance recorded.</td></tr>'}</table>
 <h3 style="margin-top:28px">Stock Count History</h3><table><tr><th>COUNT</th><th>LOCATION</th><th>ITEMS</th><th>VARIANCE ITEMS</th><th>VARIANCE VALUE</th><th>DATE</th></tr>${counts.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.location)}</td><td>${(c.items||[]).length}</td><td>${(c.items||[]).filter(i=>Math.abs(Number(i.variance_canonical||0))>.000001).length}</td><td>${money(c.variance_cost)}</td><td>${esc(String(c.completed_at||'').slice(0,16).replace('T',' '))}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No completed stock counts yet.</td></tr>'}</table>
 <h3 style="margin-top:28px">Stock Adjustments</h3><table><tr><th>REFERENCE</th><th>ITEM</th><th>QTY</th><th>LOCATION</th><th>REASON</th><th>RECORDED BY</th><th>DATE</th></tr>${adjustments.slice().reverse().map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.ingredient)}</td><td>${Number(x.qty)>0?'+':''}${cleanQty(x.qty)} ${esc(x.unit)}</td><td>${esc(x.location||'—')}</td><td>${esc(x.reason||'—')}</td><td>${esc(x.recorded_by||'Legacy record')}</td><td>${esc(String(x.created_at||'').slice(0,16).replace('T',' '))}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No stock adjustments yet.</td></tr>'}</table></div>`
}


async function completeStripeReturn(){
 const params=new URLSearchParams(window.location.search);
 if(params.get('stripe')!=='success')return false;

 const {data:{session:activeSession}}=await sb.auth.getSession();
 if(!activeSession?.user){
   alert('Payment returned successfully, but your KITCH session is not available. Sign in with the email used for payment.');
   return false;
 }

 const pending=JSON.parse(sessionStorage.getItem('kitch_pending_subscription')||'null');

 let subscription=null;
 for(let i=0;i<20;i++){
   const {data,error}=await sb.from('kitch_subscriptions')
     .select('plan,status,stripe_subscription_id')
     .eq('user_id',activeSession.user.id)
     .maybeSingle();

   if(!error&&data&&['active','trialing'].includes(String(data.status||'').toLowerCase())){
     subscription=data;
     break;
   }
   await new Promise(r=>setTimeout(r,500));
 }

 if(!subscription){
   publicModal(`<div class="publicBrand" style="color:#111;margin-bottom:24px"><b>KITCH</b><span>PAYMENT CONFIRMATION</span></div>
   <h2>Payment received</h2>
   <div class="note"><b>Your Stripe payment was received, but KITCH has not received the subscription activation yet.</b><br><br>Please do not pay again. Press Retry confirmation. If it remains pending, the Stripe → Supabase webhook needs to be replayed/fixed.</div>
   <button class="primary" onclick="closePublicModal();completeStripeReturn()">Retry confirmation</button>`);
   return false;
  }

 const plan=String(subscription.plan||pending?.plan||'starter').toLowerCase()==='business'?'business':'starter';
 const company=(pending?.company||'KITCH').trim();
 const branch=(pending?.branch||localStorage.getItem('kitch_cloud_branch_name')||'Main Branch').trim();

 const {error:we}=await sb.rpc('kitch_create_owner_workspace',{
   p_company:company,
   p_branch:branch,
   p_plan:plan,
   p_operation:plan==='business'?'multi':'restaurant'
 });

 if(we&&!String(we.message||'').toLowerCase().includes('already')){
   alert('Payment is confirmed, but workspace activation failed: '+we.message);
   return false;
 }

 applyActivatedSubscription({plan,company,branch});
 sessionStorage.removeItem('kitch_pending_subscription');
 history.replaceState({},document.title,window.location.pathname);

 cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:activeSession.user};
 await loadCloudWorkspace();
 await syncPackageFromCloud();
 await cloudLoadIngredients();
 currentStaff=null;
 closePublicModal();
 enter('owner');
 return true;
}

// LIVE CLIENT BOOT:
// The cloud workspace is the source of truth. Never display old local demo
// locations (Central Store / Main Branch / Base) before the signed-in client's
// workspace has been resolved.
(async function restoreKitchCloudSession(){
 try{
  // FINAL FRESH CLIENT TEST BUILD. On first load of this build, sign out any old
  // management session and remove every old KITCH browser record so testing
  // starts exactly like a brand-new customer. Cloud data is never borrowed
  // from a previous account.
  // Preserve existing sessions and workspace data on every deployment.

  // Preserve this browser's scoped workspace data across refreshes. The signed-in
  // restaurant is resolved below before any operational screen is shown.

  const authOk=await ensureSupabaseAuth();
  if(!authOk){
    session=null;currentStaff=null;
    app.classList.add('hidden');
    login.classList.remove('hidden');
    return;
  }

  if(new URLSearchParams(window.location.search).get('stripe')==='success'){
    const activated=await completeStripeReturn();
    if(activated)return;
  }

  const workspaceOk=await loadCloudWorkspace();
  if(!workspaceOk){
    // Authenticated account without a workspace must not inherit another
    // customer's browser data.
    session=null;currentStaff=null;
    cloud.restaurant_id=null;cloud.branch_id=null;cloud.workspace_code=null;
    app.classList.add('hidden');
    login.classList.remove('hidden');
    return;
  }

  await syncPackageFromCloud();
  ensureStructure();
  await cloudLoadIngredients();
  if(session && !app.classList.contains('hidden')) openPage(document.getElementById('pageTitle')?.textContent?.trim()||'Dashboard');
 }catch(e){
  console.warn('KITCH workspace restore:',e?.message||e);
  session=null;currentStaff=null;
  app.classList.add('hidden');
  login.classList.remove('hidden');
 }
})();
sb.auth.onAuthStateChange((event,authSession)=>{
 if(authSession?.user){
   cloud.user=authSession.user;
   setTimeout(async()=>{
     const ok=await loadCloudWorkspace().catch(()=>false);
     if(ok){await syncPackageFromCloud();ensureStructure();await cloudLoadIngredients();if(session && !app.classList.contains('hidden')) openPage(document.getElementById('pageTitle')?.textContent?.trim()||'Dashboard');}
   },0);
 }else if(event==='SIGNED_OUT'){
   cloud={restaurant_id:null,branch_id:null,workspace_code:null,user:null};
   localStorage.setItem(PACKAGE_KEY,'restaurant');
   localStorage.removeItem('kitch_demo_locations_v2');
   localStorage.removeItem('kitch_demo_departments_v2');
   localStorage.removeItem('kitch_demo_staff_v2');
 }
});
