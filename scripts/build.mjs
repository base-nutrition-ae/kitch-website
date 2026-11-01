import fs from 'node:fs';
const dir='public/assets';
const payload=Buffer.from(fs.readFileSync('office-source.html','utf8')).toString('base64');
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
console.log('PASS: Main Office source embedded into application.');
