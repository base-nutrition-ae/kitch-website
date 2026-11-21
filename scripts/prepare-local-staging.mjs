// Generate a disposable KITCH browser preview wired only to local Supabase.
// Never modify production assets or start the production-connected npm run dev target.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const publicDir=path.join(root,'public');
const out=path.join(root,'.local-staging','public');
const sbCommand=process.env.SUPABASE_CLI || 'supabase';
let status;
try{
 status=execFileSync(sbCommand,['status','--env'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
}catch(e){throw Error('Local Supabase is not running. Install Supabase CLI and a container runtime, then run supabase init and supabase start locally. '+String(e.stderr||''));}
const variables={};
for(const line of status.split(/\r?\n/)){
 const match=line.match(/^(?:export\s+)?([A-Z_]+)=(.*)$/);
 if(match)variables[match[1]]=match[2].replace(/^["']|["']$/g,'');
}
const api=variables.API_URL;
const key=variables.ANON_KEY||variables.PUBLISHABLE_KEY;
let parsed;
try{parsed=new URL(api);}catch{throw Error('Local Supabase API_URL not found in status output');}
if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||!['http:','https:'].includes(parsed.protocol))
 throw Error('REFUSING to create staging preview: API_URL is not localhost.');
if(!key||!key.startsWith('sb_publishable_')&&!/^eyJ/.test(key))throw Error('Local ANON_KEY or PUBLISHABLE_KEY not found.');
const source=fs.readFileSync(path.join(publicDir,'assets','kitch-1.js'),'utf8');
const urlMatch=source.match(/const SUPABASE_URL='([^']+)'/);
const keyMatch=source.match(/const SUPABASE_KEY='([^']+)'/);
if(!urlMatch||!keyMatch)throw Error('KITCH cloud configuration signature changed; fail closed.');
if(!urlMatch[1].includes('.supabase.co'))throw Error('Unexpected original cloud URL; review before replacing.');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.cpSync(publicDir,out,{recursive:true});
const safe=source.replace(urlMatch[0],"const SUPABASE_URL='"+api+"'")
 .replace(keyMatch[0],"const SUPABASE_KEY='"+key+"'");
fs.writeFileSync(path.join(out,'assets','kitch-1.js'),safe);
const files=[];
function inspect(dir){
 for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,ent.name);
  if(ent.isDirectory())inspect(p);
  else if(/\.(?:html|js)$/i.test(p))files.push(p);
 }
}
inspect(out);
for(const p of files){
 const body=fs.readFileSync(p,'utf8');
 if(/https:\/\/rtovpjgrezwxuvantxgt\.supabase\.co/.test(body))
  throw Error('Production Supabase URL detected in staging copy: '+p);
}
console.log('Local-only preview generated:',out);
console.log('Supabase API:',api);
console.log('No migrations applied and no production data imported.');
console.log('Run: python3 -m http.server 8081 --directory .local-staging/public');
