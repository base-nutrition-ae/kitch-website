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
const finalShared=fs.readFileSync('design/unified-workspace.css','utf8');
const finalBuild=fs.readFileSync('scripts/build.mjs','utf8');
const finalDesignChecks=[
 ['kitchen parity stylesheet',finalKitchenCss.includes('KITCH_FINAL_PARITY_20261123')],
 ['dashboard single heading stylesheet',finalKitchenCss.includes('KITCH_SINGLE_DASHBOARD_HEADER')],
 ['kitchen dashboard heading',app.includes('<h2>Kitchen Dashboard</h2>')],
 ['office logout button',finalOfficeHtml.includes('id="officeSidebarLogout"')],
 ['office logout handler',finalOfficeHtml.includes("logout=el('officeSidebarLogout')")],
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
 ['main office section remembered',officeNav.includes("sessionStorage.setItem('kitch_office_last_section'")],
 ['owner logout clears view',app.includes("sessionStorage.removeItem('kitch_last_view')")]
];
for(const [label,ok] of accessChecks)if(!ok)throw new Error('Missing KITCH desktop/session behavior: '+label);
console.log('PASS: Desktop navigation and authenticated owner refresh-page restoration contracts.');


const readySource=fs.readFileSync('public/assets/kitch-ready-products.js','utf8');
const readySQL=fs.readFileSync('sql/kitch-ready-products-v1.review.sql','utf8');
const readyChecks=[
 ['Ready Products script tag',page.includes('src="assets/kitch-ready-products.js')],
 ['Ready Products navigation',app.includes("if(n==='Ready Products')")&&app.includes("'Ready Products'")],
 ['Separate import preview',readySource.includes('kitchReadyPreviewImport')],
 ['Dedicated cloud RPC',readySource.includes("sb.rpc('kitch_ready_product_action'")],
 ['Batch record workflow',readySource.includes('kitchReadyOpenBatch')&&readySource.includes("rpc('batch'")],
 ['Request, dispatch, receipt',["rpc('create'","rpc('dispatch'","rpc('receive'"].every(t=>readySource.includes(t))],
 ['Separate tables',["kitch_ready_products","kitch_ready_batches","kitch_ready_requests","kitch_ready_movements"].every(t=>readySQL.includes(t))],
 ['Database RLS',readySQL.includes('enable row level security')],
 ['Permission checked RPC',readySQL.includes('security definer')&&readySQL.includes('kitch_office_owners')&&readySQL.includes('staff_access')],
 ['No ingredient movement side effect',!readySQL.includes('insert into public.inventory_movements')]
];
for(const [label,ok] of readyChecks)if(!ok)throw new Error('Missing KITCH Ready Products feature: '+label);
console.log('PASS: Ready Products catalog, requests, batch flow and isolated SQL migration staged.');

console.log('PASS: Daily waste, recipe yield and cloud sync release features.');
console.log(`PASS: ${scripts.length} JS scripts, ${checked} static asset references, and Main Office embed.`);
