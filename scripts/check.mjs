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
console.log('PASS: Daily waste, recipe yield and cloud sync release features.');
console.log(`PASS: ${scripts.length} JS scripts, ${checked} static asset references, and Main Office embed.`);
