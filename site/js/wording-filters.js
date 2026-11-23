import {esc,evaluate,excerpt,fold,marked,queryParts} from './model.js';
import {readConditions} from './source-conditions.js';
import {quotedFacts} from './clause-logic.js';

// A quoted fact belongs to one published provision. An identical phrase in another edition has its own meaning.
const pageName=/^[A-Z]{2,5}-\d+\.json\.gz$/;
export const sameWording=(a,b)=>a.doc===b.doc&&a.section===b.section&&a.wording===b.wording;
export const encodeWording=f=>JSON.stringify([f.file,f.doc,f.section,f.wording,f.value]);

export function readWording(params){
  const result=[];
  for(const raw of params.getAll('where')){
    try{
      const parts=JSON.parse(raw);
      if(!Array.isArray(parts)||parts.length!==5||!parts.every(p=>typeof p==='string'&&p.length))continue;
      const [file,doc,section,wording,value]=parts;
      if(!pageName.test(file)||!['yes','no'].includes(value))continue;
      const fact={file,doc,section,wording,value};
      if(!result.some(f=>sameWording(f,fact)))result.push(fact);
    }catch{}
  }
  return result;
}

const link=(doc,section)=>'#library?'+new URLSearchParams({doc,section,mode:'text'});
function containsTerms(terms,text){const normalized=fold(text);return terms.every(t=>normalized.includes(t));}
function eligible(source,date){return Boolean(source)&&(!source.date||!date||source.date<=date);}

export async function findWording(host,{query,flag,collections,date,lookup,select}){
  const terms=queryParts(query),seen=new Set();
  const books=flag?[flag,'INT']:Object.keys(collections).sort();
  const status=document.createElement('p');
  status.setAttribute('role','status');status.textContent='Searching published conditions…';host.replaceChildren(status);
  try{
    for(const file of books.flatMap(code=>collections[code]||[])){
      if(!host.isConnected)return;
      for(const [doc,section,guard,outcome,condition] of await readConditions(file)){
        if(!host.isConnected)return;
        if(!containsTerms(terms,guard+' '+outcome))continue;
        const source=lookup(doc,section);if(!eligible(source,date))continue;
        for(const wording of quotedFacts(condition)){
          if(!containsTerms(terms,wording))continue;
          const id=JSON.stringify([doc,section,wording]);if(seen.has(id))continue;
          seen.add(id);
          const button=document.createElement('button');
          button.type='button';button.className='wording-choice';button.title=wording;
          button.innerHTML=marked(excerpt(wording,terms,155),query)+'<small>'+esc(excerpt(source.title,[],85))+'</small>';
          button.onclick=()=>select({file,doc,section,wording,value:'yes'});
          host.insertBefore(button,status);
          if(seen.size===10){status.textContent='Refine the search to find another condition.';return;}
        }
      }
    }
    status.textContent=seen.size?'':'No source-specific conditions match this wording.';
  }catch{status.textContent='The published conditions could not be loaded.';}
}

export function wordingControls(host,facts,lookup){
  host.replaceChildren();
  for(const [i,f] of facts.entries()){
    const field=document.createElement('div');field.className='owner-field wording-field';
    const label=document.createElement('label');label.htmlFor='wording-'+i;label.textContent=excerpt(f.wording,[],130);label.title=f.wording;
    const input=document.createElement('select');input.id=label.htmlFor;input.dataset.wording=i;
    input.add(new Option('Yes','yes'));input.add(new Option('No','no'));input.value=f.value;
    const source=document.createElement('a');source.href=link(f.doc,f.section);
    source.textContent=excerpt(lookup(f.doc,f.section)?.title||'Read provision',[],80);
    field.append(label,input,source);host.append(field);
  }
}

export function screenWording(rows,facts,values,includeUnspecified){
  return rows.filter(([doc,section,guard,outcome,condition])=>{
    const answers=facts.filter(f=>f.doc===doc&&f.section===section&&quotedFacts(condition).includes(f.wording));
    if(!answers.length)return false;
    const state=evaluate(condition,values,new Map(answers.map(f=>[f.wording,f.value==='yes'])));
    return state===true||(state===null&&includeUnspecified);
  });
}

export async function wordingResults(host,{facts,values,includeUnspecified,collections,lookup,date,query,selected,onCount}){
  const box=document.createElement('div');host.replaceChildren(box);
  const relevant=facts.filter(f=>{
    const source=lookup(f.doc,f.section),code=f.file.split('-')[0];
    return (!selected||selected===f.doc)&&eligible(source,date)&&(!values.flag||code===values.flag||code==='INT'||source.codes?.includes(values.flag));
  });
  const terms=queryParts(query),seen=new Set();
  let number=0;
  try{
    const files=new Set(),codes=new Set();
    for(const fact of relevant){
      const code=fact.file.split('-')[0];
      codes.add(code);
      if(collections[code]?.includes(fact.file))files.add(fact.file);
    }
    // A provision can span pages, and a refresh can move its saved position.
    for(const code of codes)for(const file of collections[code]||[])files.add(file);
    const sections=new Map(relevant.map(f=>[JSON.stringify([f.doc,f.section]),f]));
    for(const file of files){
      if(!box.isConnected)return;
      const rows=await readConditions(file);
      if(!box.isConnected)return;
      const matches=rows.filter(([doc,section])=>sections.has(JSON.stringify([doc,section])));
      for(const [doc,section,guard,outcome] of screenWording(matches,relevant,values,includeUnspecified)){
        const source=lookup(doc,section),statement=guard+' — '+outcome,id=JSON.stringify([doc,section,statement]);
        if(seen.has(id)||!containsTerms(terms,source.title+' '+statement))continue;
        seen.add(id);number++;
        const card=document.createElement('article');card.className='owner-card law-card';
        card.innerHTML='<header class="law-card-heading"><h3>'+esc(source.title)+'</h3></header><div class="source-hunk"><blockquote>'+marked(excerpt(statement,terms,550),query)+'</blockquote><a href="'+esc(link(doc,section))+'">Read original provision</a></div>';
        box.append(card);
      }
      if(matches.length)onCount(number);
    }
    if(!box.isConnected)return;
    if(!number)box.innerHTML='<div class="overview-empty">No selected source passages satisfy these filters.</div>';
    onCount(number);
  }catch{if(box.isConnected)box.textContent='The selected source wording could not be loaded.';}
}
