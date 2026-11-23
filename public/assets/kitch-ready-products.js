/* KITCH Ready Products — separate catalog & transfer workflow.
   Fail closed until kitch_ready_product_action RPC is installed.
   No finished-product movements use ingredient stock or ingredient RPCs.
*/
(function(){
 const $=id=>document.getElementById(id);
 const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n||0).toLocaleString('en-AE',{maximumFractionDigits:3});
 let catalog=[],requests=[],ready=false,loading=false,error='';
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
 async function refresh(showAlert=false){
  if(loading)return;
  loading=true;error='';
  try{
   const result=await rpc('overview');
   catalog=Array.isArray(result?.catalog)?result.catalog:[];
   requests=Array.isArray(result?.requests)?result.requests:[];
   ready=true;
  }catch(e){error=e.message;ready=false;if(showAlert)alert(error)}
  finally{loading=false;if(typeof pageTitle!=='undefined'&&pageTitle?.textContent==='Ready Products'&&typeof content!=='undefined')content.innerHTML=render()}
 }
 function productOptions(){return catalog.filter(x=>x.active).map(x=>'<option value="'+escapeHtml(x.sku)+'">'+escapeHtml(x.name)+' · '+escapeHtml(x.unit)+'</option>').join('')}
 function table(items,columns,renderRow,empty){return '<div class="kitchReadyScroll"><table><thead><tr>'+columns.map(c=>'<th>'+escapeHtml(c)+'</th>').join('')+'</tr></thead><tbody>'+(items.length?items.map(renderRow).join(''):'<tr><td colspan="'+columns.length+'" class="empty">'+escapeHtml(empty)+'</td></tr>')+'</tbody></table></div>'}
 function render(){
  const isManager=typeof session!=='undefined'&&session==='manager';
  const canManage=typeof session!=='undefined'&&['owner','store'].includes(session);
  const notices=!ready?'<div class="note"><b>Ready Products cloud setup required.</b> '+escapeHtml(error||'Checking access…')+' Existing ingredient requests remain available; finished-product transfers are disabled until this separate workflow is configured.</div>':'';
  return '<div class="panel kitchReadyPage"><div class="kitchReadyHeading"><div><div class="sub">KITCH PRO · INTERNAL TRANSFERS</div><h2>Ready Products</h2><p class="muted">Prepared products from Central Kitchen, separate from the Ingredient Master.</p></div><div class="actions"><button class="btn" onclick="kitchReadyRefresh()">Refresh</button>'+(canManage?'<button class="btn black" onclick="kitchReadyOpenImport()">Import Ready Products</button>':'')+(isManager?'<button class="btn black" onclick="kitchReadyNewRequest()">+ Request Ready Products</button>':'')+'</div></div>'+notices+
   '<div class="grid"><div class="card"><span>READY PRODUCTS</span><b>'+catalog.length+'</b></div><div class="card"><span>ACTIVE REQUESTS</span><b>'+requests.filter(x=>!['Received','Cancelled'].includes(x.status)).length+'</b></div><div class="card"><span>FLOW</span><b style="font-size:13px">Kitchen → Branch → Receipt</b></div></div>'+
   '<h3 style="margin:22px 0 10px">Ready Products Master</h3>'+table(catalog,['SKU','READY PRODUCT','UNIT','STORAGE','SHELF LIFE','UNIT COST'],x=>'<tr><td>'+escapeHtml(x.sku)+'</td><td><b>'+escapeHtml(x.name)+'</b><div class="muted">'+escapeHtml(x.category||'')+'</div></td><td>'+escapeHtml(x.unit)+'</td><td>'+escapeHtml(x.storage)+'</td><td>'+fmt(x.shelf_life_days)+' days</td><td>AED '+fmt(x.unit_cost)+'</td></tr>','No ready products imported.')+
   '<h3 style="margin:22px 0 10px">Branch Ready Product Requests</h3>'+table(requests,['REQUEST','BRANCH','PRODUCT','QTY','STATUS','ACTION'],x=>'<tr><td><b>#'+escapeHtml(x.id)+'</b></td><td>'+escapeHtml(x.branch_name||'—')+'</td><td>'+escapeHtml(x.product_name||x.sku)+'</td><td>'+fmt(x.qty)+' '+escapeHtml(x.unit)+'</td><td>'+escapeHtml(x.status)+'</td><td>'+actions(x,canManage,isManager)+'</td></tr>','No ready product requests yet.')+
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
  modal('<div class="modalHead"><h2>Import Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p class="muted">Separate ready-product Excel master. Import does not alter ingredients, recipes, or existing inventory.</p><div class="actions"><button class="btn" onclick="kitchReadyDownloadTemplate()">Download CSV Template</button></div><div class="field"><label>READY PRODUCTS EXCEL OR CSV</label><input id="kitchReadyFile" type="file" accept=".xlsx,.xls,.csv" onchange="kitchReadyPreviewImport(this.files[0])"></div><div id="kitchReadyImportPreview" class="note">Choose a file to preview. Nothing is saved until you confirm.</div><div class="actions"><button class="btn black" id="kitchReadySaveImport" onclick="kitchReadySaveImport()" disabled>Save Products to Cloud</button></div>');
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
 window.kitchReadyNewRequest=()=>{
  if(session!=='manager'||!ready||!catalog.some(x=>x.active))return alert('Import ready products before placing a request.');
  modal('<div class="modalHead"><h2>Ready Product Request</h2><button class="close" onclick="closeModal()">×</button></div><div class="note"><b>From:</b> Central Kitchen<br><b>To:</b> '+escapeHtml(currentBranchName())+'</div><div class="formGrid"><div class="field"><label>READY PRODUCT</label><select id="kitchReadySku" onchange="kitchReadyUnitChanged()">'+productOptions()+'</select></div><div class="field"><label>QUANTITY</label><input id="kitchReadyQty" type="number" min="0.001" max="100000" step=".001"></div><div class="field"><label>UNIT</label><input id="kitchReadyUnit" readonly></div></div><button class="primary" onclick="kitchReadySaveRequest()">Send Request</button>');window.kitchReadyUnitChanged();
 };
 window.kitchReadyUnitChanged=()=>{const x=catalog.find(p=>p.sku===$('kitchReadySku')?.value);if($('kitchReadyUnit'))$('kitchReadyUnit').value=x?.unit||''};
 window.kitchReadySaveRequest=async()=>{
  const x=catalog.find(p=>p.sku===$('kitchReadySku')?.value),qty=Number($('kitchReadyQty')?.value);
  if(!x||!Number.isFinite(qty)||qty<=0||qty>100000)return alert('Select a ready product and valid quantity.');
  try{await rpc('create',{sku:x.sku,qty,unit:x.unit});closeModal();await refresh(true)}catch(e){alert(e.message)}
 };
 window.kitchReadyAdvance=async(id,action)=>{
  if(action!=='accept'||!confirm('Accept ready-product request #'+id+'?'))return;
  try{await rpc(action,{request_id:id});await refresh(true)}catch(e){alert(e.message)}
 };
 window.kitchReadyDispatch=id=>{
  const x=requests.find(r=>Number(r.id)===id);if(!x)return;
  modal('<div class="modalHead"><h2>Dispatch Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p>Request #'+id+' · '+escapeHtml(x.product_name||x.sku)+'</p><div class="note">Enter the actual production batch and expiry date. Dispatch cannot exceed available batch stock.</div><div class="formGrid"><div class="field"><label>BATCH NUMBER</label><input id="kitchReadyBatch" maxlength="80" placeholder="Batch from production"></div><div class="field"><label>EXPIRY DATE</label><input id="kitchReadyExpiry" type="date"></div><div class="field"><label>DISPATCH QUANTITY</label><input id="kitchReadyDispatchQty" type="number" min=".001" step=".001" max="'+fmt(x.qty)+'" value="'+fmt(x.qty)+'"></div></div><button class="primary" onclick="kitchReadyConfirmDispatch('+id+')">Confirm Dispatch</button>');
 };
 window.kitchReadyConfirmDispatch=async id=>{
  const batch=$('kitchReadyBatch')?.value.trim(),expiry=$('kitchReadyExpiry')?.value,qty=Number($('kitchReadyDispatchQty')?.value);
  if(!batch||!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(qty)||qty<=0)return alert('Enter production batch, expiry date and quantity.');
  try{await rpc('dispatch',{request_id:id,batch_no:batch,expiry_date:expiry,qty});closeModal();await refresh(true)}catch(e){alert(e.message)}
 };
 window.kitchReadyReceive=id=>{
  const x=requests.find(r=>Number(r.id)===id);if(!x)return;
  modal('<div class="modalHead"><h2>Receive Ready Products</h2><button class="close" onclick="closeModal()">×</button></div><p>Request #'+id+' · '+escapeHtml(x.product_name||x.sku)+'</p><div class="note">Verify batch and expiry before accepting. Stock updates only for the confirmed quantity.</div><div class="formGrid"><div class="field"><label>ACCEPTED QUANTITY</label><input id="kitchReadyReceivedQty" type="number" min="0" step=".001" max="'+fmt(x.sent_qty)+'" value="'+fmt(x.sent_qty)+'"></div><div class="field"><label>REJECTED QUANTITY</label><input id="kitchReadyRejectedQty" type="number" min="0" step=".001" value="0"></div></div><button class="primary" onclick="kitchReadyConfirmReceive('+id+')">Confirm Receipt</button>');
 };
 window.kitchReadyConfirmReceive=async id=>{
  const received=Number($('kitchReadyReceivedQty')?.value),rejected=Number($('kitchReadyRejectedQty')?.value);
  if(!Number.isFinite(received)||received<0||!Number.isFinite(rejected)||rejected<0)return alert('Enter valid accepted and rejected quantities.');
  try{await rpc('receive',{request_id:id,accepted_qty:received,rejected_qty:rejected});closeModal();await refresh(true)}catch(e){alert(e.message)}
 };
})();
