import {fold, queryParts, assess, excerpt} from './model.js';
import {readShard, dataUrl, readJson, archiveKind} from './archive.js';

let folios=[], records=[], world=[],current=0, routing, indexFile='';
const foldCache=new Map();
const termsByConcept = [
  ['lifejacket','life jacket','personal flotation device','flyteutstyr','redningsvest'],
  ['immersion suit','redningsdrakt'], ['bridge visibility','sikt fra broen'],
  ['pilot transfer','losoverforing'], ['noise','stoy']
];
const searchText=value=>fold(value).replace(/§\s*(\d+)\s*([a-z])\b/g,'§ $1$2')
  .replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' ');

function expandParts(query){
  let remainder=searchText(query);
  const concepts=[];
  for(const terms of termsByConcept){
    const pattern=new RegExp('\\b(?:'+terms.join('|')+')(?:ene|er|en|s)?\\b','g');
    const rest=remainder.replace(pattern,' ');
    if(rest===remainder)continue;
    concepts.push(terms);
    remainder=rest;
  }
  return [...queryParts(remainder).map(term=>[term]),...concepts];
}

function allowsType(type,filter) {
  return !filter || filter==='all' || type===filter;
}
function allowsMatch(value,filter) {
  if (!filter || filter==='all') return true;
  return filter==='candidate' ? value!=='outside' : value===filter;
}
function metadata(row) {
  return [row.title,row.fullTitle,row.heading,row.reference,row.subtitle,row.legalId,row.id,...(row.targets || [])].filter(Boolean).join(' ');
}
function accepted(text,parts) {
  const normal=searchText(text);
  return parts.every(group=>group.some(term=>normal.includes(term)));
}
function archiveRow(record,section,index,parts) {
  return {id:record.id,doc:record.id,type:'archive',title:record.title,heading:section?.label || record.legalId,
    date:record.publishedDate || record.date,subtitle:archiveKind(record),sectionId:section?'p'+index:'',
    preview:excerpt(section?.text || (record.targets||[]).join(' · '),parts),state:'review'};
}
function emit(ticket,rows,limit,done,progress,errors=0) {
  if(ticket!==current)return;
  const ordered=[...rows].sort((a,b)=>b.score-a.score || (b.date||'').localeCompare(a.date||'') || a.title.localeCompare(b.title));
  postMessage({type:'results',ticket,total:ordered.length,rows:ordered.slice(0,limit),done,progress,errors});
}
async function candidateSets(parts) {
  if(!parts.length) return [];
  if(!indexFile)return [];
  if(!routing) routing=readJson(dataUrl(indexFile)).then(r=>r.terms||null).catch(()=>null);
  const terms=await routing;
  if(!terms) return [];
  const tokens=[...new Set(parts.flatMap(routingTokens))];
  return tokens.map(token=>{
    if(foldCache.has(token))return [token,foldCache.get(token)];
    const ordinals=new Set();
    for(const [term,values] of Object.entries(terms))if(fold(term).includes(token))for(const value of values)ordinals.add(value);
    if(foldCache.size>=32)foldCache.delete(foldCache.keys().next().value);
    foldCache.set(token,ordinals);
    return [token,ordinals];
  });
}

function routingTokens(value) {
  return (value.replace(/(\d+)([a-z])\b/g,'$1 $2').match(/[\p{L}\p{N}]+/gu)||[])
    .filter(token=>token.length>=2);
}

async function search(message) {
  const {ticket,q,source,year,limit,profile,asOf,match,country,publishedBefore}=message;
  current=ticket;
  const parts=expandParts(q), highlights=parts.flat(), rows=[],shared=new Map();
  const score=(name,base)=>base+(parts.length&&accepted(name,parts)?65:0);
  for(const item of folios) {
    if(!allowsType(item.type,source) || (country && item.jurisdiction!==country) || (year && !String(item.date).startsWith(year))) continue;
    if(publishedBefore&&(item.effectiveFrom>publishedBefore||item.date>publishedBefore))continue;
    const state=assess(item,item,profile,asOf);
    if(!allowsMatch(state,match) || !accepted(metadata(item)+' '+item.text,parts))continue;
    const {text,criteria,...summary}=item;
    const groupKey=!country&&!profile?.flag&&item.sharedPassage?item.sharedPassage+'|'+state:'';
    const prior=groupKey&&shared.get(groupKey);
    if(prior){
      prior.flags.add(item.jurisdiction);
      prior.row.jurisdiction='Treaty wording · '+prior.flags.size+' flag records';
      prior.row.title=prior.title;continue;
    }
    const row={...summary,state,preview:excerpt(text,highlights),score:score(item.heading,100)+(state==='match'?20:0)};
    rows.push(row);
    if(groupKey)shared.set(groupKey,{row,flags:new Set([item.jurisdiction]),title:item.title.split(' · ').slice(0,-1).join(' · ')||item.title});
  }
  if(allowsMatch('review',match))for(const r of world){
    if(!allowsType(r.collection||'world',source))continue;
    if((country&&!r.codes.includes(country))||(year&&String(r.year)!==year)||
      (publishedBefore&&Number(r.year)>Number(publishedBefore.slice(0,4)))||!accepted(r.searchText,parts))continue;
    const hit=parts.length?r.events?.find(e=>accepted(e.label,parts)):null;
    rows.push({doc:r.id,title:r.title,sectionId:hit?.id||(r.collection==='world'?'catalogue':''),type:r.collection||'world',heading:r.title,date:String(r.year||''),
      jurisdiction:r.country,preview:hit?.label||r.preview,state:'review',score:score(r.title,15)+(profile.flag===r.country?12:0)});
  }
  if(!allowsType('archive',source) || (country&&country!=='NO') || !allowsMatch('review',match)) { emit(ticket,rows,limit,true,''); return; }
  const pending=[];
  records.forEach((record,i)=>{
    const date=record.publishedDate||record.date||'';
    if((year&&!date.startsWith(year))||(publishedBefore&&date&&date>publishedBefore))return;
    const meta=metadata(record);
    if(accepted(meta,parts)) {
      rows.push({...archiveRow(record,null,0,highlights),score:score(record.title,20)});
    }
    if(parts.length)pending.push([i,record,searchText(meta)]);
  });
  if(!pending.length){emit(ticket,rows,limit,true,'');return;}
  emit(ticket,rows,limit,false,'Searching provision text…');
  const groups=parts.map(group=>group.map(routingTokens));
  const index=new Map(await candidateSets(parts.flat()));
  if(ticket!==current)return;
  const byShard=new Map();
  for(const [i,record,meta] of pending) {
    if(index.size&&groups.some(group=>!group.some(tokens=>tokens.every(token=>meta.includes(token)||index.get(token)?.has(i)))))continue;
    if(!byShard.has(record.shard))byShard.set(record.shard,[]);
    byShard.get(record.shard).push([record,meta]);
  }
  const work=[...byShard.entries()]; let cursor=0,finished=0,errors=0;
  async function scan() {
    while(cursor<work.length && current===ticket) {
      const [name,items]=work[cursor++];
      try {
        const data=await readShard(name);
        if(current!==ticket)return;
        for(const [record,meta] of items) {
          const contents=data.get(record.id)?.sections || [];
          const matches=contents.map((section,i)=>({section,i})).filter(({section})=>accepted(section.label+' '+section.text,parts));
          const exact=matches.length||accepted(meta,parts)?matches:contents.map((section,i)=>({section,i})).filter(({section})=>
            accepted(meta+' '+section.label+' '+section.text,parts));
          for(const {section,i} of exact.slice(0,3)){
            rows.push({...archiveRow(record,section,i,highlights),score:score(section.label,55)+(record.kind==='consolidated'?8:0)});
          }
        }
      } catch { errors++; }
      finished++;
      emit(ticket,rows,limit,false,'Searched '+finished+' of '+work.length+' archive files',errors);
    }
  }
  await Promise.all([scan(),scan()]);
  emit(ticket,rows,limit,true,'',errors);
}
self.onmessage=event=>{
  const msg=event.data;
  if(msg.type==='init'){
    if(indexFile!==msg.searchIndex){routing=null;foldCache.clear();indexFile=/^gazette-search(?:-[a-f0-9]+)?\.json$/.test(msg.searchIndex||'')?msg.searchIndex:'';}
    folios=msg.folios;records=msg.records;world=msg.world||[];current++;return;
  }
  if(msg.type==='search')search(msg).catch(()=>{if(current===msg.ticket)postMessage({type:'error',ticket:msg.ticket});});
};
