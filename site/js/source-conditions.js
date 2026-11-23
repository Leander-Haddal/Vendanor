import {dataUrl} from './archive.js';
import {esc,evaluate,excerpt,fold,marked,queryParts} from './model.js';
import {quotedFacts} from './clause-logic.js';

const cache=new Map();
export async function readConditions(file){
  if(!/^[A-Z]{2,5}-\d+\.json\.gz$/.test(file))throw new Error('Invalid condition collection.');
  if(!cache.has(file)){
    const load=fetch(dataUrl('condition-search/'+file)).then(async response=>{
      if(!response.ok)throw new Error('The source text could not be loaded.');
      const bytes=new Uint8Array(await response.arrayBuffer()),blob=new Blob([bytes]);
      return bytes[0]===31&&bytes[1]===139?new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json():JSON.parse(await blob.text());
    }).catch(error=>{cache.delete(file);throw error;});
    cache.set(file,load);
    if(cache.size>16)cache.delete(cache.keys().next().value);
  }
  return cache.get(file);
}

export function compareConditionText(left,right){
  const normalized=row=>(row[2]+' '+row[3]).normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();
  const numberPattern=/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu;
  const exact=new Map(),numbered=new Map(),shared=[],different=[],seen=new Set();
  for(const row of left){
    const text=normalized(row);if(exact.has(text))continue;
    exact.set(text,row);
    const template=text.replace(numberPattern,'#');
    if(template!==text&&!numbered.has(template))numbered.set(template,row);
  }
  for(const row of right){
    const text=normalized(row);if(seen.has(text))continue;seen.add(text);
    if(exact.has(text)){shared.push([exact.get(text),row]);continue;}
    const original=numbered.get(text.replace(numberPattern,'#'));
    if(original)different.push([original,row]);
  }
  return {shared,different};
}

export async function countryConditions(files,day,lookup){
  const rows=[];
  for(const file of files||[]){
    for(const entry of await readConditions(file)){
      const source=lookup(entry[0],entry[1]);
      if(source&&(!source.date||source.date<=day))rows.push(entry);
    }
  }
  return rows;
}

export function sourceConditions(host,{collections={},values,query,asOf,lookup,countryName,selectWording}){
  const terms=queryParts(query);
  if(!terms.length&&!values.flag)return;
  const groups=values.flag?[values.flag,'INT']:Object.keys(collections).sort();
  const files=groups.flatMap(k=>collections[k]||[]);
  if(!files.length)return;
  const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
  summary.textContent=values.flag?'Published conditions · '+countryName(values.flag)+' and international texts':'Published conditions';
  details.append(summary,body);host.append(details);
  let next=0,more=[],running=false,found=0;
  const seen=new Set();
  async function show(){
    if(running)return;
    running=true;
    body.querySelector(':scope > button')?.remove();
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Searching source wording…';body.append(status);
    let added=0;
    try{
      while(added<12&&(more.length||next<files.length)){
        if(!details.isConnected)return;
        if(!more.length){
          const rows=await readConditions(files[next++]);if(!details.isConnected)return;
          more=rows.filter(([doc,section,guard,outcome,condition])=>{
            const source=lookup(doc,section);if(!source)return false;
            if(asOf&&source.date&&source.date>asOf)return false;
            const text=fold(source.title+' '+guard+' '+outcome);
            if(!terms.every(t=>text.includes(t)))return false;
            const signature=JSON.stringify([doc,section,guard,outcome]);
            if(seen.has(signature))return false;
            if(condition&&evaluate(condition,values)===false)return false;
            seen.add(signature);return true;
          });
          if(!more.length)continue;
        }
        const [doc,section,guard,outcome,rule]=more.shift(),article=document.createElement('article');
        article.innerHTML='<a href="#library?'+esc(new URLSearchParams({doc,section,mode:'text'}).toString())+'">'+esc(lookup(doc,section).title)+'</a><blockquote></blockquote>';
        article.querySelector('blockquote').innerHTML=marked(excerpt(guard+' — '+outcome,terms,360),query);
        const facts=[...new Set(quotedFacts(rule))];
        if(facts.length&&selectWording){
          const file=files[next-1],pick=document.createElement('details');
          pick.innerHTML='<summary>Filter by this condition</summary>';article.append(pick);
          for(const wording of facts){
            const option=document.createElement('button');option.type='button';option.textContent=excerpt(wording,[],150);option.title=wording;
            option.onclick=()=>selectWording({file,doc,section,wording,value:'yes'});pick.append(option);
          }
        }
        body.insertBefore(article,status);added++;found++;
      }
      status.textContent=found?'':'No published conditions match this search.';
      if(more.length||next<files.length){
        const moreButton=document.createElement('button');moreButton.type='button';moreButton.textContent='More conditions';moreButton.onclick=show;body.append(moreButton);
      }
    }catch{status.textContent='The condition collection could not be loaded.';}
    finally{running=false;}
  }
  details.ontoggle=()=>{if(details.open&&!body.children.length)show();};
}
