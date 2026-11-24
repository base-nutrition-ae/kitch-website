/* KITCH READY PRODUCTS V4: fresh asset, multi-item cart and owner-configured per-client pricing. */
/* KITCH Ready Products — separate catalog & transfer workflow.
   Fail closed until kitch_ready_product_action RPC is installed.
   No finished-product movements use ingredient stock or ingredient RPCs.
*/
(function(){
 const $=id=>document.getElementById(id);
 const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n||0).toLocaleString('en-AE',{maximumFractionDigits:3});
 let catalog=[],requests=[],ready=false,loading=false,error='',centralKitchenStaff=false,canDispatch=false;
 let markupPercent=50,defaultMarkup=50,pricingBranches=[],priceLookup=Object.create(null);
 const maxImport=500;
 const units=['pcs','portion','pack','kg','g','ltr','ml'];
 const headings=['SKU','Product Name','Category','Unit','Pack Size','Unit Cost AED','Source','Shelf Life Days','Storage','Active'];
 function pick(row,keys){const entries=Object.entries(row);for(const key of keys){const x=entries.find(([k])=>k.trim().toLowerCase()===key.toLowerCase());if(x&&x[1]!==''&&x[1]!==null&&x[1]!==undefined)return x[1]}return ''}
 function normalize(r,i){
  const sku=String(pick(r,['SKU','Product SKU'])).trim().toUpperCase();
  const name=String(pick(r,['Product Name','Name'])).trim();
  const category=String(pick(r,['Category'])||'Prepared Food').trim();
  const unit=String(pick(r,['Unit','Base Unit'])||'portion').trim().toLowerCase();
  const packSize=Number(pick(r,['Pack Size','Units Per Pack'])||1);
  const cost=Number(pick(r,['Unit Cost AED','Unit Cost','Cost AED'])||0);
  const shelf=Number(pick(r,['Shelf Life Days','Shelf Life'])||1);
  const storage=String(pick(r,['Storage','Storage Type'])||'Chilled').trim();
  const active=String(pick(r,['Active'])||'Yes').trim().toLowerCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(sku))throw Error('Row '+i+': SKU must be 2–40 letters/numbers, dashes or underscores.');
  if(!name||name.length>160)throw Error('Row '+i+': valid product name required.');
  if(!units.includes(unit))throw Error('Row '+i+': invalid unit '+unit);
  if(!Number.isFinite(packSize)||packSize<=0||packSize>100000)throw Error('Row '+i+': invalid pack size.');
  if(!Number.isFinite(cost)||cost<0||cost>1000000)throw Error('Row '+i+': invalid cost.');
  if(!Number.isInteger(shelf)||shelf<0||shelf>3650)throw Error('Row '+i+': invalid shelf life.');
  if(!['chilled','frozen','ambient','hot'].includes(storage.toLowerCase()))throw Error('Row '+i+': storage must be Chilled, Frozen, Ambient or Hot.');
  return {sku,name,category,unit,pack_size:packSize,unit_cost:cost,source:'Central Kitchen',shelf_life_days:shelf,storage,active:!['0','false','no','inactive'].includes(active)};
 }
 async function rpc(action,payload={}){
  if(typeof sb==='undefined'||!sb)throw Error('Cloud authentication unavailable.');
  const auth=typeof cloud!=='undefined'&&cloud?.user?.id;
  const staff=typeof teamCloudAuth!=='undefined'&&teamCloudAuth?.pin&&teamCloudAuth?.staff_name;
  if(!auth&&!staff)throw Error('Sign in as a KITCH owner or authorized staff member first.');
  const args={p_action:action,p_payload:payload,p_staff_name:staff?teamCloudAuth.staff_name:null,p_pin:staff?teamCloudAuth.pin:null};
  const {data,error:problem}=await sb.rpc('kitch_ready_product_action',args);
  if(problem)throw Error(problem.code==='PGRST202'?'Ready Products database update has not been installed. No stock was changed.':(problem.message||'Ready Products cloud request failed.'));
  return data;
 }

 async function commerce(action,payload={}){
  if(typeof sb==='undefined'||!sb)throw Error('Cloud authentication unavailable.');
  const staff=typeof teamCloudAuth!=='undefined'&&teamCloudAuth?.staff_name&&teamCloudAuth?.pin;
  const auth=typeof cloud!=='undefined'&&cloud?.user?.id;
  if(!staff&&!auth)throw Error('Please sign in first.');
  const {data,error:problem}=await sb.rpc('kitch_ready_commercial_action',{p_action:action,p_payload:payload,p_staff_name:staff?teamCloudAuth.staff_name:null,p_pin:staff?teamCloudAuth.pin:null});
  if(problem)throw Error(problem.message||'Ready Products pricing could not load');
  return data;
 }
 const money=n=>(n===null||n===undefined||!Number.isFinite(Number(n)))?'—':'AED '+Number(n).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2});

 async function refresh(showAlert=false){
  if(loading)return;
  loading=true;error='';
  try{
   const [result,prices]=await Promise.all([rpc('overview'),commerce('overview')]);
   markupPercent=Number(prices?.markup_percent??50);
   defaultMarkup=Number(prices?.default_markup_percent??50);
   pricingBranches=Array.isArray(prices?.branches)?prices.branches:[];
   priceLookup=Object.fromEntries((prices?.pricing||[]).map(x=>[x.sku,x]));
   catalog=(Array.isArray(result?.catalog)?result.catalog:[]).map(x=>({...x,costPrice:priceLookup[x.sku]?.cost==null?null:Number(priceLookup[x.sku].cost),salePrice:priceLookup[x.sku]?.price==null?null:Number(priceLookup[x.sku].price)}));
   requests=Array.isArray(result?.requests)?result.requests:[];
   centralKitchenStaff=result?.is_central_kitchen===true;
   canDispatch=result?.can_dispatch===true;
   ready=true;
  }catch(e){error=e.message;ready=false;if(showAlert)alert(error)}
  finally{loading=false;if(typeof pageTitle!=='undefined'&&pageTitle?.textContent==='Ready Products'&&typeof content!=='undefined')content.innerHTML=render()}
 }
 function productOptions(){return catalog.filter(x=>x.active).map(x=>'<option value="'+escapeHtml(x.sku)+'">'+escapeHtml(x.name)+' · '+escapeHtml(x.unit)+'</option>').join('')}
 function table(items,columns,renderRow,empty){return '<div class="kitchReadyScroll"><table><thead><tr>'+columns.map(c=>'<th>'+escapeHtml(c)+'</th>').join('')+'</tr></thead><tbody>'+(items.length?items.map(renderRow).join(''):'<tr><td colspan="'+columns.length+'" class="empty">'+escapeHtml(empty)+'</td></tr>')+'</tbody></table></div>'}
 function render(){
  const isManager=typeof session!=='undefined'&&session==='manager'&&!centralKitchenStaff;
  const canManage=canDispatch;
  const notices=!ready?'<div class="note"><b>Ready Products cloud setup required.</b> '+escapeHtml(error||'Checking access…')+' Existing ingredient requests remain available; finished-product transfers are disabled until this separate workflow is configured.</div>':'';
  return '<div class="panel kitchReadyPage"><div class="kitchReadyHeading"><div><div class="sub">KITCH PRO · INTERNAL TRANSFERS</div><h2>Ready Products</h2><p class="muted">'+(centralKitchenStaff?'Central Kitchen orders: review requests from all branches, accept and dispatch prepared food. Each receiving branch confirms its own delivery.':'Ready products come from saved recipes and completed production. Each branch receives into its own stock.')+'</p></div><div class="actions"><button class="btn" onclick="kitchReadyRefresh()">Refresh</button>'+(session==='owner'?'<button class="btn black" onclick="kitchReadySetMarkup()">Pricing · +'+fmt(markupPercent)+'%</button>':'')+(isManager?'<button class="btn black" onclick="kitchReadyNewRequest()" '+(!ready?'disabled title="Cloud setup required"':'')+'>+ Request Ready Products</button>':'')+'</div></div>'+notices+
   '<div class="grid"><div class="card"><span>READY PRODUCTS</span><b>'+catalog.length+'</b></div><div class="card"><span>ACTIVE REQUESTS</span><b>'+requests.filter(x=>!['Received','Cancelled'].includes(x.status)).length+'</b></div><div class="card"><span>FLOW</span><b style="font-size:13px">Kitchen → Branch → Receipt</b></div></div>'+
   '<h3 style="margin:22px 0 10px">Ready Products · Cost & Transfer Price <small class="muted">(+ '+fmt(markupPercent)+'% markup)</small></h3>'+table(catalog,['SKU','READY PRODUCT','UNIT','STORAGE','COST / UNIT','BRANCH PRICE / UNIT'],x=>'<tr><td>'+escapeHtml(x.sku)+'</td><td><b>'+escapeHtml(x.name)+'</b><div class="muted">'+escapeHtml(x.category||'')+'</div></td><td>'+escapeHtml(x.unit)+'</td><td>'+escapeHtml(x.storage)+'</td><td>'+money(x.costPrice)+'</td><td><b>'+money(x.salePrice)+'</b></td></tr>','No saved recipes with kg or litre yield.')+
   '<h3 style="margin:22px 0 10px">Branch Ready Product Requests</h3>'+table(requests,['ORDER','BRANCH','PRODUCT','QTY','UNIT PRICE','LINE TOTAL','STATUS','ACTION'],x=>'<tr><td><b>#'+escapeHtml(x.id)+'</b>'+(x.group_ref?'<div class="muted">Group '+escapeHtml(String(x.group_ref).slice(0,8))+'</div>':'')+'</td><td>'+escapeHtml(x.branch_name||'—')+'</td><td>'+escapeHtml(x.product_name||x.sku)+'</td><td>'+fmt(x.qty)+' '+escapeHtml(x.unit)+'</td><td>'+money(x.unit_price_snapshot)+'</td><td>'+money(x.unit_price_snapshot==null?null:Number(x.qty)*Number(x.unit_price_snapshot))+'</td><td>'+escapeHtml(x.status)+'</td><td>'+actions(x,canManage,isManager)+'</td></tr>','No ready product requests yet.')+
   '<p class="muted" style="margin-top:14px">Finished goods require recorded batch, expiry and available Central Kitchen stock before dispatch. Branch stock increases only after receipt.</p></div>';
 }
 function actions(x,canManage,isManager){
  const id=Number(x.id);if(!Number.isSafeInteger(id))return '—';
  if(x.status==='Requested'&&canManage)return '<button class="btn" onclick="kitchReadyAdvance('+id+',\'accept\')">Accept</button>';
  if(x.status==='Accepted'&&canManage)return '<button class="btn black" onclick="kitchReadyDispatch('+id+')">Dispatch</button>';
  if(x.status==='In Transfer'&&isManager)return '<button class="btn black" onclick="kitchReadyReceive('+id+')">Receive</button>';
  return '—';
 }
 window.kitchReadyRefresh=()=>refresh(true);
 window.kitchReadyProductsPage=()=>{if(!loading)queueMicrotask(()=>refresh(false));return render()};
 window.kitchReadyOpenImport=()=>{
  if(!['owner','store'].includes(session))return;
  modal('<div class="modalHead"><h2>Import Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p class="muted">Ready Products now come directly from saved recipes. Separate Excel import is not required.</p><div class="actions"><button class="btn" onclick="kitchReadyDownloadTemplate()">Download CSV Template</button></div><div class="field"><label>READY PRODUCTS EXCEL OR CSV</label><input id="kitchReadyFile" type="file" accept=".xlsx,.xls,.csv" onchange="kitchReadyPreviewImport(this.files[0])"></div><div id="kitchReadyImportPreview" class="note">Choose a file to preview. Nothing is saved until you confirm.</div><div class="actions"><button class="btn black" id="kitchReadySaveImport" onclick="kitchReadySaveImport()" disabled>Save Products to Cloud</button></div>');
 };
 window.kitchReadyDownloadTemplate=()=>{
  const sample=[headings,['SOUP-TOMATO','Tomato Soup','Soups','portion',1,8.50,'Central Kitchen',3,'Chilled','Yes'],['BEEF-COOKED','Cooked Beef','Prepared Protein','kg',1,49,'Central Kitchen',3,'Chilled','Yes']];
  const csv=sample.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='KITCH_Ready_Products_Template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 let pending=[];
 function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=ch}
  if(quoted)throw Error('Unclosed CSV quotation');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  const head=rows.shift()||[];return rows.map(values=>Object.fromEntries(head.map((k,i)=>[k,values[i]||''])));
 }
 window.kitchReadyPreviewImport=async file=>{
  const out=$('kitchReadyImportPreview'),button=$('kitchReadySaveImport');if(!out||!button)return;
  button.disabled=true;pending=[];
  if(!file)return;
  try{
   if(file.size>2e6)throw Error('Maximum import file size is 2 MB.');
   let rows;
   if(/\.csv$/i.test(file.name))rows=parseCsv(await file.text());
   else{if(typeof XLSX==='undefined')throw Error('Excel library unavailable. Please use the CSV template.');const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})}
   if(!rows.length||rows.length>maxImport)throw Error('Please import between 1 and '+maxImport+' products.');
   pending=rows.map((x,i)=>normalize(x,i+2));
   if(new Set(pending.map(x=>x.sku)).size!==pending.length)throw Error('Duplicate SKU in this file.');
   out.innerHTML='<b>'+pending.length+' products validated.</b><div class="muted">Preview: '+pending.slice(0,5).map(x=>escapeHtml(x.sku+' '+x.name)).join(' · ')+'</div>';
   button.disabled=false;
  }catch(e){out.textContent=e.message}
 };
 window.kitchReadySaveImport=async()=>{
  if(!pending.length||!['owner','store'].includes(session))return;
  const b=$('kitchReadySaveImport');if(b)b.disabled=true;
  try{const result=await rpc('import',{products:pending});pending=[];closeModal();await refresh();alert('Ready Products catalog saved: '+(result?.count??'completed')+' items.')}
  catch(e){alert('Import not saved: '+e.message)}finally{if(b)b.disabled=false}
 };
 window.kitchReadyOpenBatch=()=>{
  if(!['owner','store'].includes(session)||!ready||!catalog.some(x=>x.active))return alert('Save the recipe and complete a production batch with QC; finished stock is recorded automatically.');
  modal('<div class="modalHead"><h2>Record Finished Batch</h2><button class="close" onclick="closeModal()">×</button></div><p class="muted">Record Central Kitchen production. This creates a separate finished-product stock movement, never an ingredient receiving record.</p><div class="formGrid"><div class="field"><label>READY PRODUCT</label><select id="kitchReadyBatchSku">'+productOptions()+'</select></div><div class="field"><label>BATCH NUMBER</label><input id="kitchReadyNewBatchNo" maxlength="80"></div><div class="field"><label>PRODUCTION DATE</label><input type="date" id="kitchReadyProducedDate"></div><div class="field"><label>EXPIRY DATE</label><input type="date" id="kitchReadyNewExpiryDate"></div><div class="field"><label>FINISHED QUANTITY</label><input type="number" id="kitchReadyBatchQty" min=".001" step=".001"></div></div><button class="primary" onclick="kitchReadySaveBatch()">Record Finished Stock</button>');
  const today=new Date().toISOString().slice(0,10);
  if($('kitchReadyProducedDate'))$('kitchReadyProducedDate').value=today;
 };
 window.kitchReadySaveBatch=async()=>{
  const sku=$('kitchReadyBatchSku')?.value,batch_no=$('kitchReadyNewBatchNo')?.value.trim(),
   produced_on=$('kitchReadyProducedDate')?.value,expiry_date=$('kitchReadyNewExpiryDate')?.value,qty=Number($('kitchReadyBatchQty')?.value);
  if(!sku||!batch_no||!produced_on||!expiry_date||expiry_date<produced_on||!Number.isFinite(qty)||qty<=0||qty>100000)return alert('Enter a valid product, batch, dates and quantity.');
  try{await rpc('batch',{sku,batch_no,produced_on,expiry_date,qty});closeModal();await refresh(true);alert('Finished-product batch recorded in Central Kitchen.')}
  catch(e){alert('Batch was not saved: '+e.message)}
 };


 window.kitchReadyNewRequest=()=>{
  if(session!=='manager'||centralKitchenStaff||!ready||!catalog.some(x=>x.active&&x.salePrice!=null))return alert('No price-ready recipes found. Check ingredient costs and recipe yields.');
  modal('<div class="kitchReadyRequestForm">'+
   '<div class="modalHead"><div><div class="readyCartEyebrow">KITCH / BRANCH ORDERS</div><h2>Request Ready Products</h2></div><button class="close" aria-label="Close request" onclick="closeModal()">×</button></div>'+
   '<div class="readyCartRoute"><div><span class="routeLabel">FROM · PRODUCTION</span><strong>Central Kitchen</strong></div><span class="routeArrow">→</span><div><span class="routeLabel">TO · RECEIVING</span><strong>'+escapeHtml(currentBranchName())+'</strong></div></div>'+
   '<p class="readyCartHint">Choose multiple finished products. Quantities use each item’s kg or litre unit. Company markup: +'+fmt(markupPercent)+'%.</p>'+
   '<div class="readyCartSectionHeading"><strong>Order items</strong><span>Up to 30 products</span></div>'+
   '<div id="kitchReadyCartLines"></div>'+
   '<button class="readyCartAdd" type="button" onclick="kitchReadyAddLine()">+ Add Another Product</button>'+
   '<div class="readyCartSummary"><span class="totalLabel" id="kitchReadyCartCount">ORDER TOTAL · 1 ITEM</span><strong class="totalAmount" id="kitchReadyCartTotal">AED 0.00</strong></div>'+
   '<button class="primary" type="button" id="kitchReadyCartSubmit" onclick="kitchReadySaveRequest()">Send Request to Central Kitchen</button>'+
   '<div class="readyCartFootnote">Central Kitchen reviews and approves the order before dispatch.</div></div>');
  kitchReadyAddLine();
 };
 window.kitchReadyAddLine=()=>{
  const wrap=$('kitchReadyCartLines');if(!wrap)return;
  if(wrap.children.length>=30)return alert('Maximum 30 items');
  const opts=catalog.filter(x=>x.active&&x.salePrice!=null&&x.costPrice>0)
   .map(x=>'<option value="'+escapeHtml(x.sku)+'">'+escapeHtml(x.name)+' · '+escapeHtml(x.unit)+'</option>').join('');
  const line=document.createElement('div');
  line.className='kitchReadyCartLine';
  line.innerHTML='<div class="field"><label>PREPARED PRODUCT</label><select class="readyCartSku" onchange="kitchReadyUpdateTotals()">'+opts+'</select></div>'+
    '<div class="field"><label>QUANTITY</label><input class="readyCartQty" type="number" step="0.001" min="0.001" placeholder="e.g. 2.5" oninput="kitchReadyUpdateTotals()"></div>'+
    '<button class="readyCartRemove" type="button" aria-label="Remove item" onclick="this.closest(\'.kitchReadyCartLine\').remove();kitchReadyUpdateTotals()">Remove</button>'+
    '<div class="readyCartPrice muted"></div>';
  wrap.appendChild(line);kitchReadyUpdateTotals();
 };
 window.kitchReadyUpdateTotals=()=>{
  const lines=[...document.querySelectorAll('#kitchReadyCartLines .kitchReadyCartLine')];
  let total=0,valid=lines.length>0;const seen=new Set();
  for(const line of lines){
   const sku=line.querySelector('.readyCartSku')?.value;
   const raw=line.querySelector('.readyCartQty')?.value;
   const qty=Number(raw),item=catalog.find(x=>x.sku===sku);
   const duplicate=seen.has(sku);seen.add(sku);
   const ok=Boolean(item&&raw&&Number.isFinite(qty)&&qty>0&&qty<=100000&&item.salePrice!=null&&!duplicate);
   if(!ok)valid=false;
   const amount=ok?Number((item.salePrice*qty).toFixed(2)):0;total+=amount;
   line.querySelector('.readyCartPrice').textContent=duplicate?'Select a different product; duplicates are not allowed.':(item?money(item.salePrice)+' / '+item.unit+' · Line total '+(ok?money(amount):'—'):'Select a product');
  }
  const display=$('kitchReadyCartTotal');if(display)display.textContent=money(total);
  const counter=$('kitchReadyCartCount');if(counter)counter.textContent='ORDER TOTAL · '+lines.length+' '+(lines.length===1?'ITEM':'ITEMS');
  const btn=$('kitchReadyCartSubmit');if(btn)btn.disabled=!valid;
 };
 window.kitchReadySaveRequest=async()=>{
  const lines=[...document.querySelectorAll('#kitchReadyCartLines .kitchReadyCartLine')];
  const items=lines.map(line=>({sku:line.querySelector('.readyCartSku').value,qty:Number(line.querySelector('.readyCartQty').value)}));
  if(!items.length||items.length>30||new Set(items.map(x=>x.sku)).size!==items.length||
    items.some(x=>!Number.isFinite(x.qty)||x.qty<=0||x.qty>100000))return alert('Choose 1–30 different products and enter valid quantities.');
  const btn=$('kitchReadyCartSubmit');if(btn)btn.disabled=true;
  try{
    const result=await commerce('create_many',{items});
    closeModal();await refresh(true);
    alert('Ready Product request sent: '+result.count+' items · '+money(result.total)+'. Order '+String(result.group_ref).slice(0,8));
  }catch(e){alert('Request not saved: '+e.message);if(btn)btn.disabled=false}
 };

 window.kitchReadySetMarkup=()=>{
  if(session!=='owner')return alert('Only the company owner can change client markup.');
  const choices='<option value="">Default markup (all clients without an override)</option>'+
   pricingBranches.map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.name)+' ('+(x.markup_percent==null?'uses default':fmt(x.markup_percent)+'%')+')</option>').join('');
  modal('<div class="modalHead"><h2>Ready Product Client Pricing</h2><button class="close" onclick="closeModal()">×</button></div>'+
   '<p class="muted">Set a markup for a specific receiving restaurant, or change the default. Only the owner can edit prices.</p>'+
   '<div class="field"><label>CLIENT / RESTAURANT</label><select id="kitchReadyPricingBranch" onchange="kitchReadyPricingBranchChanged()">'+choices+'</select></div>'+
   '<div class="field"><label>MARKUP ON PRODUCTION COST (%)</label><input id="kitchReadyMarkupInput" type="number" min="0" max="500" step="0.1" value="'+defaultMarkup+'" oninput="kitchReadyPreviewMarkup()"></div>'+
   '<div id="kitchReadyMarkupPreview" class="note"></div>'+
   '<button class="primary" id="kitchReadyMarkupSave" onclick="kitchReadySaveMarkup()">Save Client Pricing</button>');
  kitchReadyPreviewMarkup();
 };
 window.kitchReadyPricingBranchChanged=()=>{
  const id=$('kitchReadyPricingBranch')?.value;
  const branch=pricingBranches.find(x=>x.id===id);
  if($('kitchReadyMarkupInput'))$('kitchReadyMarkupInput').value=branch?.markup_percent??defaultMarkup;
  kitchReadyPreviewMarkup();
 };
 window.kitchReadyPreviewMarkup=()=>{
  const pct=Number($('kitchReadyMarkupInput')?.value);
  const valid=Number.isFinite(pct)&&pct>=0&&pct<=500;
  const box=$('kitchReadyMarkupPreview');
  if(box)box.textContent=valid?'Example: AED 7.00 production cost + '+pct+'% markup = '+money(7*(1+pct/100)):'Enter markup between 0% and 500%.';
  const btn=$('kitchReadyMarkupSave');if(btn)btn.disabled=!valid;
 };
 window.kitchReadySaveMarkup=async()=>{
  if(session!=='owner')return alert('Owner only.');
  const percent=Number($('kitchReadyMarkupInput')?.value);
  const branch_id=$('kitchReadyPricingBranch')?.value||null;
  if(!Number.isFinite(percent)||percent<0||percent>500)return alert('Invalid markup.');
  const btn=$('kitchReadyMarkupSave');if(btn)btn.disabled=true;
  try{await commerce('set_markup',{percent,...(branch_id?{branch_id}:{})});closeModal();await refresh(true)}
  catch(e){alert('Markup not saved: '+e.message);if(btn)btn.disabled=false}
 };

 window.kitchReadyAdvance=async(id,action)=>{
  if(action!=='accept'||!confirm('Accept ready-product request #'+id+'?'))return;
  try{await rpc(action,{request_id:id});await refresh(true)}catch(e){alert(e.message)}
 };
 window.kitchReadyDispatch=id=>{
  const x=requests.find(r=>Number(r.id)===id);if(!x)return;
  const maxQty=Number(x.qty);
  modal('<div class="modalHead"><h2>Dispatch Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p>Request #'+id+' · '+escapeHtml(x.product_name||x.sku)+'</p><div class="note">Enter the actual production batch and expiry date. Dispatch cannot exceed available batch stock.</div><div class="formGrid"><div class="field"><label>BATCH NUMBER</label><input id="kitchReadyBatch" maxlength="80" placeholder="Batch from production"></div><div class="field"><label>EXPIRY DATE</label><input id="kitchReadyExpiry" type="date"></div><div class="field"><label>DISPATCH QUANTITY</label><input id="kitchReadyDispatchQty" type="number" min=".001" step=".001" max="'+maxQty+'" value="'+maxQty+'"></div></div><button class="primary" onclick="kitchReadyConfirmDispatch('+id+')">Confirm Dispatch</button>');
 };
 window.kitchReadyConfirmDispatch=async id=>{
  const batch=$('kitchReadyBatch')?.value.trim(),expiry=$('kitchReadyExpiry')?.value,qty=Number($('kitchReadyDispatchQty')?.value);
  const req=requests.find(x=>Number(x.id)===id);
  const guard=window.KitchReadyEngine;
  if(!batch||!guard||!guard.dateOnly(expiry)||!req||!Number.isFinite(qty)||qty<=0||qty>Number(req.qty))
   return alert('Enter a valid production batch, expiry date and dispatch quantity.');
  if(expiry<guard.todayUTC())return alert('Expired batches cannot be dispatched.');
  try{await rpc('dispatch',{request_id:id,batch_no:batch,expiry_date:expiry,qty});closeModal();await refresh(true)}catch(e){alert(e.message)}
 };
 window.kitchReadyReceive=id=>{
  const x=requests.find(r=>Number(r.id)===id);if(!x)return;
  const sentQty=Number(x.sent_qty);
  modal('<div class="modalHead"><h2>Receive Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p>Request #'+id+' · '+escapeHtml(x.product_name||x.sku)+'</p><div class="note">Verify batch and expiry before accepting. Accepted plus rejected must equal the dispatched quantity.</div><div class="formGrid"><div class="field"><label>ACCEPTED QUANTITY</label><input id="kitchReadyReceivedQty" type="number" min="0" step=".001" max="'+sentQty+'" value="'+sentQty+'"></div><div class="field"><label>REJECTED QUANTITY</label><input id="kitchReadyRejectedQty" type="number" min="0" step=".001" value="0"></div></div><button class="primary" onclick="kitchReadyConfirmReceive('+id+')">Confirm Receipt</button>');
 };
 window.kitchReadyConfirmReceive=async id=>{
  const received=Number($('kitchReadyReceivedQty')?.value),rejected=Number($('kitchReadyRejectedQty')?.value);
  const sent=Number(requests.find(x=>Number(x.id)===id)?.sent_qty);
  const decision=window.KitchReadyEngine?.receipt({sent,accepted:received,rejected});
  if(!decision?.ok)return alert(decision?.error||'Accepted plus rejected must equal the dispatched quantity.');
  try{await rpc('receive',{request_id:id,accepted_qty:received,rejected_qty:rejected});closeModal();await refresh(true)}catch(e){alert(e.message)}
 };
})();
