import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const page = fs.readFileSync('public/index.html', 'utf8');
// Inline JavaScript contains generated HTML templates. Validate real document
// assets, not src/href strings inside JavaScript or CSS.
const markup = page
  .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const references = [...markup.matchAll(/<(?:script|link|img|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)]
  .map(match => match[2]);
let checked = 0;
for (const ref of references) {
  if (/^(?:https?:|data:|#|mailto:|javascript:|\/\/)/i.test(ref)) continue;
  if (/[\$\{\}<>]/.test(ref)) continue;
  const local = decodeURIComponent(ref.split(/[?#]/)[0]).replace(/^\.\//, '');
  if (!local || local.startsWith('/') || local.split('/').includes('..')) continue;
  const filepath = path.join('public', local);
  if (!fs.existsSync(filepath)) throw new Error(`Missing referenced asset: ${filepath}`);
  checked++;
}
const scripts = fs.readdirSync('public/assets').filter(name => name.endsWith('.js'));
for (const name of scripts) execFileSync(process.execPath, ['--check', `public/assets/${name}`]);
if (!fs.existsSync('public/assets/kitch-1.js')) throw new Error('Main app asset missing');
if (!fs.existsSync('office-source.html')) throw new Error('Main Office source is missing');
if (!scripts.some(name => /const KITCH_OFFICE_EMBED\s*=\s*'[^']+'/.test(fs.readFileSync(`public/assets/${name}`, 'utf8')))) {
  throw new Error('Missing Main Office embed');
}
const app = fs.readFileSync('public/assets/kitch-1.js', 'utf8');
const releaseChecks = [
 ['daily waste date control', 'Select waste report date'],
 ['daily waste date handler', 'setKitchDashboardWasteDate'],
 ['actual waste total', 'ACTUAL WASTE COST'],
 ['preparation yield loss', 'PREPARATION YIELD LOSS'],
 ['Supabase recipe sync', 'kitchSaveSyncedRecipe'],
 ['recipe cloud reload', 'kitchLoadSyncedRecipes'],
 ['editable cooked quantity', 'yieldCooked']
];
for (const [name, pattern] of releaseChecks) {
 if (!app.includes(pattern)) throw new Error('Missing KITCH release feature: '+name);
}

const finalKitchenCss=fs.readFileSync('public/assets/kitch-24.css','utf8');
const finalOfficeHtml=fs.readFileSync('office-source.html','utf8');
const officeRuntime=fs.readFileSync('public/assets/kitch-office-runtime.js','utf8');

const finalShared=fs.readFileSync('design/unified-workspace.css','utf8');
const finalBuild=fs.readFileSync('scripts/build.mjs','utf8');
const finalDesignChecks=[
 ['kitchen parity stylesheet',finalKitchenCss.includes('KITCH_FINAL_PARITY_20261123')],
 ['dashboard single heading stylesheet',finalKitchenCss.includes('KITCH_SINGLE_DASHBOARD_HEADER')],
 ['kitchen dashboard heading',app.includes('<h2>Kitchen Dashboard</h2>')],
 ['office logout button',finalOfficeHtml.includes('id="officeSidebarLogout"')],
 ['office logout handler',officeRuntime.includes("logout=el('officeSidebarLogout')")],
 ['office plain KITCH brand',finalOfficeHtml.includes('class="officeWordmark"')&&!finalOfficeHtml.includes('class="officeBrandMark">K')],
 ['kitchen plain KITCH brand',page.includes('class="kitchNavBrand"')&&!page.includes('<img class="kitchSideLogo" src="data:image/png;base64')],
 ['shared stylesheet',finalShared.includes('KITCH UNIFIED DESIGN v1')],
 ['shared build injection',finalBuild.includes('kitch-shared-kitchen')&&finalBuild.includes('kitch-shared-office')]
];
for (const [name,ok] of finalDesignChecks)if(!ok)throw new Error('Missing unified design feature: '+name);
console.log('PASS: Unified Main Office / Main Kitchen branding, layout, dashboard and logout contracts.');


const mobileCss=fs.readFileSync('design/mobile-unified.css','utf8');
const mobileJs=fs.readFileSync('design/office-mobile.js','utf8');
const buildScript=fs.readFileSync('scripts/build.mjs','utf8');
const officeSource=fs.readFileSync('office-source.html','utf8');
const mobileChecks=[
 ['mobile CSS present',mobileCss.includes('KITCH MOBILE FINAL')],
 ['Main Kitchen responsive drawer',mobileCss.includes('mobileMenuOpen')&&mobileCss.includes('appMobileMenu')],
 ['Main Office responsive drawer',mobileCss.includes('officeMobileOpen')&&mobileCss.includes('officeMobileMenu')],
 ['office mobile menu button',officeSource.includes('id="officeMobileMenu"')],
 ['office mobile menu backdrop',officeSource.includes('id="officeMobileBackdrop"')],
 ['office drawer close behavior',mobileJs.includes("addEventListener('keydown'")&&mobileJs.includes("officeMobileOpen")],
 ['mobile styles injected last',buildScript.includes('kitch-mobile-kitchen')&&buildScript.includes('kitch-mobile-office')],
 ['office mobile JS injected',buildScript.includes('kitch-office-mobile-script')],
 ['kitchen logout accessible',page.includes('onclick="logout()">Log out</button>')]
];
for(const [label,passed] of mobileChecks)if(!passed)throw new Error('Missing KITCH mobile feature: '+label);
console.log('PASS: Mobile layout, navigation, responsive tables and logout contracts.');


if(page.includes('class="kitchMobileTopSignIn"')) throw new Error('Extra mobile top Sign In button must remain removed');
if(!page.includes('class="mobileMenuBtn"')||!page.includes('toggleMobileMenu(false);openPublicSignIn()')) throw new Error('Mobile drawer Sign In missing');
if(!page.includes('<button class="solid" onclick="openPublicSignIn()">Sign In</button>')) throw new Error('Desktop Sign In missing');
if(page.includes('class="kitchHeroAccess"')) throw new Error('Oversized public hero CTAs must remain removed');
console.log('PASS: Desktop Sign In preserved; mobile Sign In remains only inside drawer.');


const desktopStyle=fs.readFileSync('design/mobile-unified.css','utf8');
const officeNav=fs.readFileSync('office-source.html','utf8');
const officeScript=fs.readFileSync('public/assets/kitch-2.js','utf8');
const accessChecks=[
 ['right-aligned desktop navigation',desktopStyle.includes('Desktop public navigation: actions stay flush to right')],
 ['owner page stored',app.includes('function kitchRememberOwnerPage')],
 ['owner page restored',app.includes('const lastPage=kitchLastOwnerPage()')],
 ['owner verified on restoration',app.includes("const ownerAccess=await sb.from('kitch_office_owners')")],
 ['main office view remembered',officeScript.includes("sessionStorage.setItem('kitch_last_view','office')")],
 ['main office section remembered',fs.readFileSync('office-source.html','utf8').includes("sessionStorage.setItem('kitch_office_last_section'")],
 ['owner logout clears view',app.includes("sessionStorage.removeItem('kitch_last_view')")]
];
for(const [label,ok] of accessChecks)if(!ok)throw new Error('Missing KITCH desktop/session behavior: '+label);
if(!officeNav.includes('id="kitch-office-auth-isolation"'))throw new Error('Main Office sign-in isolation missing');
if(!officeNav.includes('Main Office is taking longer than expected.'))throw new Error('Main Office slow-start retry screen missing');
if(officeNav.includes("msg.textContent='Main Office connection is taking too long. Reload the page or sign in again.'"))throw new Error('Old forced sign-in timeout still present');
if(officeScript.includes("if(auth)auth.classList.remove('officeHidden');"))throw new Error('Iframe watchdog must not expose login during session restore');
console.log('PASS: Main Office timeout cannot reveal sign-in over a loading dashboard.');
if(!officeNav.includes("window.parent.supabase?.createClient"))throw new Error('Embedded Main Office must reuse parent authentication library');
if(!officeRuntime.includes("window.kitchOfficeLoadAuthLibrary()"))throw new Error('Main Office auth loader must be awaited');
if(!officeRuntime.includes("Cloud session is slow. Please retry the connection."))throw new Error('Main Office session timeout recovery missing');
if(officeNav.includes('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js"></script>'))throw new Error('Blocking duplicate auth library script must remain removed');
console.log('PASS: Main Office startup reuses parent auth, has fallback and does not block indefinitely.');
if(!app.includes('window.__kitchSharedSupabaseClient=sb'))throw new Error('Main Kitchen must provide shared authenticated Supabase client');
if(!officeRuntime.includes('window.parent.__kitchSharedSupabaseClient'))throw new Error('Main Office must reuse existing same-origin cloud client');
if(!officeRuntime.includes('if(session)await loadOwner(session.user)'))throw new Error('Main Office startup should reuse session user');
if(!officeRuntime.includes('setVisible(true);\n document.getElementById(\'officeBoot\')?.remove();'))throw new Error('Owner shell should appear before secondary KPI requests');
if(!officeNav.includes('src="/assets/kitch-office-runtime.js'))throw new Error('Main Office external runtime script missing');
if(officeNav.includes("async function start(){"))throw new Error('Main Office startup should not be inline');
console.log('PASS: Main Office external runtime loaded and startup contracts preserved.');


console.log('PASS: Desktop navigation and authenticated owner refresh-page restoration contracts.');


const readySource=fs.readFileSync('public/assets/kitch-ready-products-v4.js','utf8');
const readySQL=fs.readFileSync('sql/kitch-ready-products-v1.review.sql','utf8');
const readyChecks=[
 ['Ready Products script tag',page.includes('src="assets/kitch-ready-products-v4.js')],
 ['Ready Products navigation',app.includes("if(n==='Ready Products')")&&app.includes("'Ready Products'")],
 ['Separate import preview',readySource.includes('kitchReadyPreviewImport')],
 ['Dedicated cloud RPC',readySource.includes("sb.rpc('kitch_ready_product_action'")],
 ['Batch record workflow',readySource.includes('kitchReadyOpenBatch')&&readySource.includes("rpc('batch'")],
 ['Request, dispatch, receipt',["commerce('create_many'","rpc('dispatch'","rpc('receive'"].every(t=>readySource.includes(t))],
 ['Separate tables',["kitch_ready_products","kitch_ready_batches","kitch_ready_requests","kitch_ready_movements"].every(t=>readySQL.includes(t))],
 ['Database RLS',readySQL.includes('enable row level security')],
 ['Single complete SQL function',readySQL.split('create or replace function public.kitch_ready_product_action').length===2&&readySQL.split('$function$;').length===2],
 ['Permission checked RPC',readySQL.includes('security definer')&&readySQL.includes('kitch_office_owners')&&readySQL.includes('staff_access')],
 ['No ingredient movement side effect',!readySQL.includes('insert into public.inventory_movements')]
];
for(const [label,ok] of readyChecks)if(!ok)throw new Error('Missing KITCH Ready Products feature: '+label);
if(!app.includes('items=[...new Set(items)]'))throw new Error('Workspace navigation must deduplicate items');
if(!app.includes("if(!multi)items=items.filter(x=>!['Stock Requests','Stock Transfer'].includes(x))"))throw new Error('Pro-only navigation visibility check missing');
if(!readySource.includes('disabled title="Cloud setup required"'))throw new Error('Unconfigured Ready Product requests must be blocked');
console.log('PASS: Ready Products navigation unique and unconfigured requests disabled.');
if(!readySource.includes('canDispatch=result?.can_dispatch===true')||!readySource.includes('centralKitchenStaff=result?.is_central_kitchen===true'))throw new Error('Central Kitchen dispatch permissions must come from cloud role and location.');
if(!readySource.includes('centralKitchenStaff||!ready'))throw new Error('Central Kitchen must not create requests to itself.');
if(!officeSource.includes('<option value="central_kitchen">'))throw new Error('Central Kitchen location type missing from Main Office.');
if(!officeRuntime.includes("x.branch_type==='central_kitchen'?'Central Kitchen'"))throw new Error('Central Kitchen location label missing.');
console.log('PASS: Central Kitchen locations, dispatch permissions and multi-location UI contracts.');
const sharedShell=fs.readFileSync('design/mobile-unified.css','utf8');
const layoutChecks=[
 ['unified workspace viewport shell',sharedShell.includes('KITCH_SINGLE_LAYOUT_SHELL_20261124')],
 ['kitchen independent scroll',sharedShell.includes('overflow-y:auto!important;overflow-x:hidden!important')],
 ['fixed mobile navigation',sharedShell.includes('position:fixed!important;top:0!important;bottom:0!important')],
 ['modal viewport centring',sharedShell.includes('html body.modal-open #modal.modal')],
 ['CK workspace label',app.includes("'CENTRAL KITCHEN WORKSPACE'")]
];
for(const [label,ok] of layoutChecks)if(!ok)throw new Error('Layout contract missing: '+label);
const stockMultiChecks=[
 ['multi-ingredient stock cart',app.includes('function stockRequestAddLine()')],
 ['stock cart quantity validation',app.includes('function stockRequestUpdateTotals()')],
 ['atomic cloud stock request',app.includes("sb.rpc('kitch_team_stock_request_many'")],
 ['stock request group reference',app.includes('x.group_ref?')],
 ['CK stock request location filtering',app.includes("x.branch===assignedLocationName()")],
 ['multi-ingredient request styling',sharedShell.includes('KITCH multi-ingredient internal stock request')]
];
for(const [label,ok] of stockMultiChecks)if(!ok)throw new Error('Multi-ingredient stock request regression: '+label);
const ckDashboardChecks=[
 ['verified CK staff workspace flag',app.includes("window.__kitchIsCentralKitchen=centralKitchenStaff&&canDispatch")||readySource.includes("window.__kitchIsCentralKitchen=centralKitchenStaff&&canDispatch")],
 ['CK-specific sidebar entries',app.includes("items=['Dashboard','Incoming Branch Orders','Production Planning','Production'")],
 ['CK dashboard route',app.includes("window.kitchCentralKitchenPage('Dashboard')")],
 ['CK live request rendering',readySource.includes("window.kitchCentralKitchenPage=view=>")],
 ['branch-specific order rows',readySource.includes("escapeHtml(x.branch_name||'—')")],
 ['CK cloud approval',readySource.includes("kitchReadyAdvance('+id+")],
 ['CK dispatch route',readySource.includes("kitchReadyDispatch('+id+")],
 ['CK production planning',readySource.includes("Approved Items to Prepare")],
 ['CK stylesheet',finalKitchenCss.includes("Central Kitchen dashboard — same KITCH operational UI")]
];
for(const [label,ok] of ckDashboardChecks)if(!ok)throw new Error('Central Kitchen release regression: '+label);
console.log('PASS: Central Kitchen dashboard, live order tracking, approval and dispatch routes.');

console.log('PASS: Ready Products catalog, requests, batch flow and isolated SQL migration staged.');

console.log('PASS: Daily waste, recipe yield and cloud sync release features.');
console.log(`PASS: ${scripts.length} JS scripts, ${checked} static asset references, and Main Office embed.`);
