import {readFile,readdir,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {extractClauses} from '../site/js/clause-logic.js';

const data=new URL('../site/data/',import.meta.url), cache=new URL('../.work/national-text/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,data),'utf8'));
const [gazette,official,world,index,matching,treaties]=await Promise.all(['gazette.json','official-screening.json','world-laws.json','national-screening.json','publisher-matches.json','treaty-wording.json'].map(read));
const records={},samples=new Map(),previousSamples=new Map();
const searchBooks=new Map(),jurisdictions=new Map(world.records.map(r=>['world:'+r.id,[...new Set(r.countries.map(c=>c.code).filter(Boolean))]]));
function hasField(rule){
  if(rule.field)return true;
  if(rule.not)return hasField(rule.not);
  return (rule.all||rule.any||[]).some(hasField);
}
function fullyBound(rule){
  if(rule.field)return true;
  if(rule.not)return fullyBound(rule.not);
  const children=rule.all||rule.any;
  return Boolean(children?.length)&&children.every(fullyBound);
}
function register(key,section,clauses){
  if(!clauses.length)return;
  const codes=jurisdictions.get(key)||(key.startsWith('uk:')?['GB']:key.startsWith('eu:')?['EU']:key.startsWith('imo:')?['INT']:['NO']);
  for(const code of codes.length?codes:['OTHER']){
    if(!searchBooks.has(code))searchBooks.set(code,[]);
    const rows=searchBooks.get(code);
    for(const c of clauses)rows.push([key,section,c.guard,c.outcome,c.when]);
  }
}
let prior={};
try{prior=(await read('clause-index.json')).records;}catch(error){if(error.code!=='ENOENT')throw error;}
const bucketFor=id=>createHash('sha256').update(id).digest('hex').slice(0,2);
function storeClauses(key,clauses){
  if(!clauses.length)return;
  const b=bucketFor(key);
  if(!samples.has(b))samples.set(b,{});
  const bucket=samples.get(b);bucket[key]??=[];
  for(const clause of clauses){
    register(key,'condition-'+bucket[key].length,[clause]);
    bucket[key].push(clause);
  }
  records[key].shard=b;
}
function inspect(key,section,text,keep=false,doc=0,page=0){
  if(!records[key])records[key]={sections:0,statements:0};
  records[key].sections++;
  const clauses=extractClauses(text);
  records[key].statements+=clauses.length;
  for(const c of clauses){
    if(!hasField(c.when))continue;
    const kind=fullyBound(c.when)?'bound':'partial';
    records[key][kind]=(records[key][kind]||0)+1;
  }
  if(keep)storeClauses(key,clauses.map(c=>({document:doc,section,...(page?{page}:{}),...c})));
  else register(key,section,clauses);
  return clauses.length;
}
for(const name of new Set(gazette.records.map(r=>r.shard))){
  for(const r of (await read(name)).records)r.sections.forEach((s,i)=>inspect(r.id,'p'+i,s.text));
}
for(const name of await readdir(new URL('wording/',data))){
  if(!name.endsWith('.json.gz'))continue;
  const group=JSON.parse(gunzipSync(await readFile(new URL('wording/'+name,data))));
  for(const [key,parts] of Object.entries(group)){
    if(official[key]?.wordingShard!==name.slice(0,2))continue;
    for(const [id,text] of parts)inspect(key,'text-'+id,text);
  }
}
for(const [key,publication] of Object.entries(await read('treaty-originals.json'))){
  const pages=treaties[key]||JSON.parse(gunzipSync(await readFile(new URL('treaty-pages/'+publication.pageFile,data))));
  pages.forEach((s,i)=>inspect('imo:'+key,i?'page-'+(i+1):'original',s));
}
for(const name of await readdir(new URL('national-wording/',data))){
  const group=JSON.parse(gunzipSync(await readFile(new URL('national-wording/'+name,data))));
  for(const [key,parts] of Object.entries(group)){
    if(matching[key]?.shard!==name[0])continue;
    parts.forEach(([,text],i)=>inspect('world:'+key,'publisher-'+i,text));
  }
}
const details=new Map();
for(const r of world.records){
  const key='world:'+r.id;records[key]??={sections:0,statements:0};
  if(!index.records[r.id]?.[0])continue;
  const shard=r.id.slice(-2);
  if(!details.has(shard))details.set(shard,await read('national/'+shard+'.json'));
  const documents=details.get(shard)[r.id].documents;
  for(const [i,url] of r.textUrls.entries()){
    if(documents[i].state!=='text')continue;
    const fromPdf=Boolean(documents[i].sourcePdf);
    const file=createHash('sha256').update(url).digest('hex')+(fromPdf?'.pdf-text.gz':'.gz');
    let bytes;
    try{bytes=gunzipSync(await readFile(new URL(file,cache)));}catch(error){if(error.code!=='ENOENT')throw error;}
    const digest=documents[i].digest;
    const entry=records[key];
    entry.renditions??={};
    if(!bytes){
      const saved=prior[key]?.renditions?.[digest];
      if(!saved)continue;
      entry.sections+=saved.sections;entry.statements+=saved.statements;
      for(const k of ['bound','partial'])if(saved[k])entry[k]=(entry[k]||0)+saved[k];
      entry.renditions[digest]={...saved,document:i};
      if(saved.statements){
        const bucket=prior[key].shard;
        if(!previousSamples.has(bucket))previousSamples.set(bucket,JSON.parse(gunzipSync(await readFile(new URL('clauses/'+bucket+'.json.gz',data)))));
        storeClauses(key,(previousSamples.get(bucket)[key]||[]).filter(c=>c.document===saved.document).map(c=>({...c,document:i})));
      }
      continue;
    }
    let text;
    if(bytes[0]===255&&bytes[1]===254)text=new TextDecoder('utf-16le').decode(bytes);
    else if(bytes[0]===254&&bytes[1]===255)text=new TextDecoder('utf-16be').decode(bytes);
    else try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);}
    const start=entry.sections,before=entry.statements,bound=entry.bound||0,partial=entry.partial||0;
    for(const [page,body] of (fromPdf?text.split('\f'):[text]).entries()){
      for(const [j,p] of body.split(/\n\s*\n/).entries())if(p.trim())inspect(key,'paragraph-'+j,p,true,i,fromPdf?page+1:0);
    }
    entry.renditions[digest]={document:i,sections:entry.sections-start,statements:entry.statements-before,bound:(entry.bound||0)-bound,partial:(entry.partial||0)-partial};
  }
}
for(const key of Object.keys(official))records[key]??={sections:0,statements:0};
await mkdir(new URL('clauses/',data),{recursive:true});
for(const [b,items] of samples){
  const dest=new URL('clauses/'+b+'.json.gz',data),temp=new URL(dest.href+'.tmp');
  await writeFile(temp,gzipSync(JSON.stringify(items)));await rename(temp,dest);
}
const out=new URL('clause-index.json',data),temp=new URL(out.href+'.tmp');
const counts={recordsWithConditions:0,conditionalStatements:0,sourceSections:0,bound:0,partial:0};
for(const entry of Object.values(records)){
  counts.recordsWithConditions+=Number(entry.statements>0);
  counts.conditionalStatements+=entry.statements;
  counts.sourceSections+=entry.sections;
  counts.bound+=entry.bound||0;counts.partial+=entry.partial||0;
}
const collections={};
await mkdir(new URL('condition-search/',data),{recursive:true});
for(const [code,rows] of searchBooks){
  const pages=[];
  for(let offset=0;offset<rows.length;offset+=600){
    const file=code+'-'+pages.length+'.json.gz',items=rows.slice(offset,offset+600);
    const dest=new URL('condition-search/'+file,data),temp=new URL(dest.href+'.tmp');
    await writeFile(temp,gzipSync(JSON.stringify(items)));await rename(temp,dest);
    pages.push(file);
  }
  collections[code]=pages;
}
await writeFile(temp,JSON.stringify({counts,records,collections})+'\n');await rename(temp,out);
const activePages=new Set(Object.values(collections).flat());
for(const file of await readdir(new URL('condition-search/',data))){
  if(/^[A-Z]{2,5}-\d+\.json\.gz$/.test(file)&&!activePages.has(file))await unlink(new URL('condition-search/'+file,data));
}
for(const file of await readdir(new URL('clauses/',data))){
  if(/^[0-9a-f]{2}\.json\.gz$/.test(file)&&!samples.has(file.slice(0,2)))await unlink(new URL('clauses/'+file,data));
}
console.log(counts.conditionalStatements+' conditional statements located in '+counts.recordsWithConditions+' source records.');
