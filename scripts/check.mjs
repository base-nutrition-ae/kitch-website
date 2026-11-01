import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const page=fs.readFileSync('public/index.html','utf8');
const refs=[...page.matchAll(/(?:src|href)="([^"\s]+)"/g)].map(m=>m[1]);
let checked=0;
for (const ref of refs){
  if (/^(https?:|data:|#|mailto:|javascript:)/i.test(ref)) continue;
  const filepath=path.join('public',decodeURIComponent(ref.split(/[?#]/)[0]));
  if(!fs.existsSync(filepath)) throw new Error(`Missing referenced asset: ${filepath}`);
  checked++;
}
const scripts=fs.readdirSync('public/assets').filter(n=>n.endsWith('.js'));
for (const name of scripts) execFileSync(process.execPath,['--check',`public/assets/${name}`]);
if(!page.includes('assets/kitch-1.js')) throw new Error('Main app script missing');
if(!fs.existsSync('office-source.html')) throw new Error('Main Office source is missing');
if (!scripts.some(n => /const KITCH_OFFICE_EMBED\s*=\s*'[^']+'/.test(fs.readFileSync(`public/assets/${n}`,'utf8')))) throw new Error('Missing Main Office embed');
console.log(`PASS: ${scripts.length} JS scripts, ${checked} local asset references, and Main Office embed.`);
