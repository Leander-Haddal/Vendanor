import {readFile,writeFile,rename} from 'node:fs/promises';
import {collections} from '../site/js/collections.js';
import {collectFields} from '../site/js/profile.js';

const directory=new URL('../site/data/',import.meta.url);
const catalogues=await Promise.all(Object.values(collections).map(async name=>JSON.parse(await readFile(new URL(name,directory),'utf8'))));
const index={checkedAt:catalogues.map(c=>c.checkedAt).sort().at(-1),fields:collectFields(catalogues,[])};
const target=new URL('boat-fields.json',directory),serialized=JSON.stringify(index)+'\n';
if(process.argv.includes('--check')){
  if(await readFile(target,'utf8')!==serialized)throw new Error('The boat form and the legal field definitions differ. Run node tools/boat_fields.mjs.');
}else{
  const temporary=new URL('boat-fields.'+process.pid+'.tmp',directory);
  await writeFile(temporary,serialized);await rename(temporary,target);
}
console.log(index.fields.length+' source-defined vessel fields verified.');
