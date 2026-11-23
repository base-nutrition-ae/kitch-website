import fs from 'node:fs';
const dir='public/assets';
// Graphite-glass presentation layer. Do not alter app event handlers, data bindings, or auth.
const unifiedTheme=fs.readFileSync('design/unified-workspace.css','utf8');
const officeTheme=fs.readFileSync('design/office-glass.css','utf8');
const kitchenTheme=fs.readFileSync('design/kitch-glass.css','utf8');
const officeHtml=fs.readFileSync('office-source.html','utf8').replace('</head>',`<style id="kitch-glass-office">${officeTheme}</style><style id="kitch-shared-office">${unifiedTheme}</style></head>`);
const payload=Buffer.from(officeHtml).toString('base64');
const indexPath='public/index.html';
let page=fs.readFileSync(indexPath,'utf8');
page=page.replace(/<style id="kitch-glass-kitchen">[\s\S]*?<\/style>/g,'').replace(/<style id="kitch-shared-kitchen">[\s\S]*?<\/style>/g,'');
page=page.replace('</head>',`<style id="kitch-glass-kitchen">${kitchenTheme}</style><style id="kitch-shared-kitchen">${unifiedTheme}</style></head>`);
fs.writeFileSync(indexPath,page);
const match=/const KITCH_OFFICE_EMBED\s*=\s*'[^']+'/;
const files=fs.readdirSync(dir).filter(n=>n.endsWith('.js'));
let found=0;
for (const name of files){
  const file=`${dir}/${name}`;
  const source=fs.readFileSync(file,'utf8');
  if(source.includes('const KITCH_OFFICE_EMBED')){
    if(!match.test(source)) throw new Error(`Invalid Main Office embed in ${name}`);
    const output=source.replace(match,`const KITCH_OFFICE_EMBED='${payload}'`);
    if(output!==source) fs.writeFileSync(file,output);
    found++;
  }
}
if(found!==1) throw new Error(`Expected one Main Office embed, found ${found}`);
console.log('PASS: Main Office source embedded and KITCH graphite-glass theme applied.');
