import {dataUrl,readJson} from './archive.js';
import {evaluate,esc,fold,queryParts,describeRule} from './model.js';

const loads=new Map();
function readField(key){
  if(!loads.has(key))loads.set(key,readJson(dataUrl('predicates/'+encodeURIComponent(key)+'.json')).catch(e=>{loads.delete(key);throw e;}));
  return loads.get(key);
}
export function thresholdCandidates(rows,field,values){
  return rows.filter(r=>evaluate(r.when||{field,op:r.op,value:r.value},values)!==false);
}
export async function sourceThresholds(host,{coverage,values,fields,query,asOf,lookup}){
  const keys=Object.keys(coverage?.fields||{}).filter(f=>Object.hasOwn(values,f));
  if(!keys.length)return;
  const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
  summary.textContent='Source-text thresholds';details.append(summary,body);host.prepend(details);
  const terms=queryParts(query);
  try{
    const results=(await Promise.all(keys.map(async field=>thresholdCandidates(await readField(field),field,values).map(r=>({...r,field}))))).flat();
    if(!details.isConnected)return;
    const distinct=new Map();
    for(const r of results){
      const source=lookup(r.doc);if(!source)continue;
      if(values.flag&&!r.countries.includes(values.flag)&&!r.countries.includes('INT'))continue;
      if(r.editionDate&&asOf&&r.editionDate>asOf)continue;
      if(asOf&&source.date&&(source.date.length===4?source.date>asOf.slice(0,4):source.date>asOf))continue;
      if(terms.length&&!terms.every(t=>fold([source.title,r.quote,r.effect,...(r.mentions||[])].join(' ')).includes(t)))continue;
      distinct.set(JSON.stringify([r.doc,r.section,r.quote]),{...r,title:source.title});
    }
    const items=[...distinct.values()];
    if(!items.length){details.remove();return;}
    summary.textContent='Source-text thresholds · '+items.length.toLocaleString();
    let limit=12;
    function show(){
      body.innerHTML='<p>These passages contain measured conditions. Their other qualifications and exceptions still need review.</p>'+
        items.slice(0,limit).map(r=>'<article><a href="#library?'+esc(new URLSearchParams({doc:r.doc,section:r.section,mode:'text'}).toString())+'">'+esc(r.title)+'</a>'+
          '<small>'+esc(describeRule(r.when||r,fields))+'</small><blockquote>'+esc(r.quote)+'</blockquote>'+(r.effect?'<p>'+esc(r.effect)+'</p>':'')+'</article>').join('')+
        (limit<items.length?'<button type="button">More passages</button>':'');
      const more=body.querySelector('button');if(more)more.onclick=()=>{limit+=12;show();};
    }
    details.ontoggle=()=>{if(details.open&&!body.children.length)show();};
    if(details.open)show();
  }catch{if(details.isConnected)body.textContent='The threshold index could not be loaded.';}
}
