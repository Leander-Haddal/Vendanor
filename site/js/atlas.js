import {esc,excerpt,fold,isoDay,temporal,screeningRule,describeRule} from './model.js';
import {dataUrl,readJson} from './archive.js';
import {compareConditionText,countryConditions} from './source-conditions.js';

const linkTo=(id,section='')=>'#library?'+new URLSearchParams(section?{doc:id,section}:{doc:id});
const format=n=>n.toLocaleString('en');
export function holdings(countries,world,gazette,sources,mapped){
  const byCountry=new Map(countries.map(c=>[c.code,[]]));
  function add(code,item){if(!byCountry.has(code))byCountry.set(code,[]);byCountry.get(code).push(item);}
  for(const r of world)for(const code of new Set(r.codes))add(code,{key:r.id,title:r.title,kind:'National catalogue',identity:r.fingerprint||r.id});
  for(const r of gazette)add('NO',{key:r.id,title:r.title,kind:'Norwegian archive',identity:r.id});
  for(const r of sources)if(r.country)add(r.country,{key:r.id,title:r.title,kind:r.collection==='uk'?'UK legislation':r.collection==='eu'?'EU acts':'Flag administration',identity:r.id});
  for(const d of mapped){
    if(d.instrument.local||d.instrument.flagState)continue;
    const code=d.instrument.jurisdiction;
    if(!code||!byCountry.has(code))continue;
    if(d.version.archiveRecord||d.sections.some(s=>s.incorporates))continue;
    add(code,{key:d.key,title:d.instrument.shortTitle||d.instrument.title,kind:'Indexed editions',identity:d.version.pdfSha256||d.key});
  }
  return byCountry;
}
export function compareHoldings(left,right){
  const a=new Set(left.map(r=>r.identity)),b=new Set(right.map(r=>r.identity));
  return {shared:left.filter(r=>b.has(r.identity)),left:left.filter(r=>!b.has(r.identity)),right:right.filter(r=>!a.has(r.identity))};
}
export function compareTreaties(imo,a,b){
  const p=imo.participation,l=p?.byFlag[a],r=p?.byFlag[b];
  if(!l||!r)return null;
  const mark=(row,key)=>row.ratified.includes(key)?'Party':row.denounced.includes(key)?'Denunciation recorded':'No mark';
  return p.columns.map(c=>({key:c.key,title:c.label,left:mark(l,c.key),right:mark(r,c.key),
    id:imo.instruments.find(i=>i.participationKeys?.includes(c.key))?.id})).filter(x=>x.left!=='No mark'||x.right!=='No mark');
}
function predicateSignature(node,code){
  if(!node)return null;
  if(node.field)return [node.field,node.op,node.field==='flag'&&node.value===code?'selected flag':node.value];
  if(node.not)return ['not',predicateSignature(node.not,code)];
  const op=node.all?'all':'any';
  return [op,(node[op]||[]).map(n=>JSON.stringify(predicateSignature(n,code))).sort()];
}
export function compareProvisions(documents,left,right,day){
  function index(code){
    const out=new Map();
    for(const doc of documents){
      if(doc.instrument.flagState!==code||temporal(doc.version,day)!==true)continue;
      for(const section of doc.sections){
        const family=doc.instrument.id.slice(0,-code.length-1),key=family+'|'+section.id;
        if(!section.clip||!section.criteria)continue;
        const signature=JSON.stringify([predicateSignature(screeningRule(section,doc.version,day),code),
          predicateSignature(section.confirmWhen,code),section.screeningLevel,section.cases?.map(c=>[predicateSignature(c.when,code),predicateSignature(c.confirmWhen,code),c.outcome]),
          doc.version.derivedFields?.map(d=>[d.field,predicateSignature(d.when,code),d.positiveOverrides])]);
        out.set(key,{doc,section,signature});
      }
    }
    return out;
  }
  const a=index(left),b=index(right);
  return [...new Set([...a.keys(),...b.keys()])].map(key=>{
    const l=a.get(key),r=b.get(key);
    const status=l&&r?l.section.clip===r.section.clip&&l.signature===r.signature?'shared':'different':'single';
    return {left:l,right:r,status};
  });
}
function choices(countries,value,exclude=''){
  return '<option value="">Choose a country</option>'+countries.filter(c=>c.code!==exclude).map(c=>'<option value="'+esc(c.code)+'" '+(value===c.code?'selected':'')+'>'+esc(c.name)+'</option>').join('');
}
function recordList(label,records){
  if(!records.length)return '';
  return '<details class="compare-list"><summary>'+esc(label)+' <small>'+format(records.length)+'</small></summary><div>'+records.slice(0,20).map(r=>'<a href="'+esc(linkTo(r.key))+'">'+esc(r.title)+'</a>').join('')+(records.length>20?'<p>First 20 records shown.</p>':'')+'</div></details>';
}
let geometry;
export async function renderAtlas(host,{tab,params,countries,counts,imo,documents,flags,navigate,latest,fields,conditionCollections={},lookup}){
  const code=params.get('country')||'',left=params.get('left')||'',right=params.get('right')||'';
  const countryName=code=>countries.find(c=>c.code===code)?.name||code;
  if(tab==='compare'){
    host.innerHTML='<div class="atlas-card"><h2>Compare countries</h2><div class="compare-pickers"><label>First country<select data-side="left">'+choices(countries,left,right)+'</select></label><label>Second country<select data-side="right">'+choices(countries,right,left)+'</select></label></div><div class="comparison-body"></div></div>';
    for(const node of host.querySelectorAll('[data-side]'))node.onchange=()=>navigate('library',{tab,left:host.querySelector('[data-side="left"]').value,right:host.querySelector('[data-side="right"]').value});
    if(!left||!right||left===right)return;
    const l=countryName(left),r=countryName(right),ls=counts.get(left)||[],rs=counts.get(right)||[];
    const grouped=compareHoldings(ls,rs),treaties=compareTreaties(imo,left,right);
    const day=isoDay(params.get('date'))||latest;
    const body=host.querySelector('.comparison-body');
    body.innerHTML='<h3>Mapped provisions</h3><label class="comparison-date">Edition date<input type="date" value="'+esc(day)+'"></label><div class="compared-provisions"></div><div class="implementation-compare"></div>'+
      '<h3>National collections</h3><p>'+esc(l)+' · '+format(ls.length)+' records &nbsp; / &nbsp; '+esc(r)+' · '+format(rs.length)+' records</p>'+
      recordList('Shared records or identical source text',grouped.shared)+recordList('Only indexed for '+l,grouped.left)+recordList('Only indexed for '+r,grouped.right)+
      '<details class="compare-list" data-condition-comparison><summary>Compare published conditions</summary><div></div></details>'+
      '<h3>Compare provision wording</h3><form class="compare-text"><div class="compare-pickers"></div><button type="submit">Compare wording</button></form>'+
      '<h3>Treaty participation</h3>'+(!treaties?'<p>One or both countries have no separate row in the IMO status workbook.</p>':
      '<p>IMO status workbook · '+esc(imo.participation.asOf)+'</p><label class="inline"><input type="checkbox" data-shared> Include shared status</label><div class="treaty-table"></div>')+
      '';
    body.querySelector('.comparison-date input').onchange=e=>{if(isoDay(e.target.value))navigate('library',{tab,left,right,date:e.target.value});};
    const compareSources=body.querySelector('[data-condition-comparison]'),excerpts=compareSources.querySelector('div');
    compareSources.ontoggle=async()=>{
      if(!compareSources.open||excerpts.childNodes.length)return;
      excerpts.textContent='Comparing the published wording…';
      try{
        const books=await Promise.all([left,right].map(code=>countryConditions(conditionCollections[code],day,lookup)));
        if(!compareSources.isConnected)return;
        const {shared,different}=compareConditionText(...books);
        excerpts.replaceChildren();
        for(const [title,rows] of [['Different numbers in otherwise matching wording',different],['Identical conditional wording',shared]]){
          if(!rows.length)continue;
          const group=document.createElement('details');group.className='compare-list';
          group.innerHTML='<summary>'+title+' · '+format(rows.length)+'</summary><div></div>';excerpts.append(group);
          const list=group.querySelector('div');
          let shown=0;
          function next(){
            list.querySelector('button')?.remove();
            for(const [a,b] of rows.slice(shown,shown+10)){
              const block=document.createElement('article');block.className='condition-pair';
              const text=row=>row[2]+' — '+row[3];
              const leftWords=text(a).split(/\s+/),rightWords=text(b).split(/\s+/);
              const difference=leftWords.findIndex((word,i)=>fold(word)!==fold(rightWords[i]));
              for(const [row,country,words] of [[a,l,leftWords],[b,r,rightWords]]){
                const part=document.createElement('div'),link=document.createElement('a'),quote=document.createElement('blockquote');
                link.href=linkTo(row[0],row[1]);link.textContent=country+' · '+lookup(row[0],row[1]).title;
                const focus=difference<0?[]:[fold(words.slice(difference,difference+5).join(' '))];
                quote.textContent=excerpt(text(row),focus,300);part.append(link,quote);block.append(part);
              }
              list.append(block);
            }
            shown+=10;
            if(shown<rows.length){const more=document.createElement('button');more.textContent='Show more comparisons';more.onclick=next;list.append(more);}
          }
          group.ontoggle=()=>{if(group.open&&!shown)next();};
        }
        if(!excerpts.children.length)excerpts.textContent=books.every(b=>b.length)?'No identical or number-only wording matches were found in the indexed conditions.':'Conditional text is missing for one or both countries.';
      }catch{excerpts.textContent='The condition comparison could not be loaded.';}
    };
    const provisions=compareProvisions(documents,left,right,day), comparisons=body.querySelector('.compared-provisions');
    const labels={different:'Wording or mapped conditions differ',single:'Indexed for one flag',shared:'Shared wording and mapped conditions'};
    comparisons.innerHTML=Object.entries(labels).map(([status,title])=>{
      const rows=provisions.filter(p=>p.status===status);
      if(!rows.length)return '';
      return '<details class="compare-list"><summary>'+title+' · '+rows.length+'</summary><div>'+rows.map(({left:a,right:b})=>{
        const s=a||b;
        return '<p><strong>'+esc(s.section.number+' · '+(s.section.title||s.doc.instrument.shortTitle))+'</strong><br>'+[a,b].filter(Boolean).map(p=>
          '<a href="'+esc(linkTo(p.doc.key,p.section.id))+'">'+esc(countryName(p.doc.instrument.flagState)+' · '+p.doc.version.label)+'</a>'+
          (status==='different'?'<small>'+esc(describeRule(screeningRule(p.section,p.doc.version,day),fields))+'</small>':'')).join('')+'</p>';
      }).join('')+'</div></details>';
    }).join('')||'<p>No comparable dated treaty provisions are indexed for this pair.</p>';
    if(treaties){
      const shared=body.querySelector('[data-shared]'), table=body.querySelector('.treaty-table');
      function show(){const display=treaties.filter(t=>shared.checked||t.left!==t.right);
        table.innerHTML=display.length?'<table><thead><tr><th>Instrument or amendment</th><th>'+esc(l)+'</th><th>'+esc(r)+'</th></tr></thead><tbody>'+display.map(t=>'<tr><th>'+(t.id?'<a href="'+esc(linkTo('imo:'+t.id))+'">'+esc(t.title)+'</a>':esc(t.title))+'</th><td>'+t.left+'</td><td>'+t.right+'</td></tr>').join('')+'</tbody></table>':'<p>No differences in the recorded participation columns.</p>';}
      shared.onchange=show;show();
    }
    const ref=body.querySelector('.implementation-compare');
    const edges=documents.flatMap(d=>[left,right].includes(d.instrument.jurisdiction)&&temporal(d.version,day)===true?d.sections.filter(s=>s.incorporates).map(s=>({d,s})):[]);
    if(edges.length)ref.innerHTML='<h3>National implementation</h3>'+edges.map(({d,s})=>'<p><a href="'+esc(linkTo(d.key,s.id))+'">'+esc(countryName(d.instrument.jurisdiction)+' · '+s.number+' · '+s.title)+'</a><br>'+esc(s.incorporates.reference)+'</p>').join('');
    const compare=body.querySelector('.compare-text'), inputs=compare.querySelector('div');
    const selectors=[left,right].map((code,i)=>{
      const mapped=documents.filter(d=>(d.instrument.flagState||d.instrument.jurisdiction)===code&&!d.instrument.local).map(d=>({key:d.key,title:(d.instrument.shortTitle||d.instrument.title)+' · '+d.version.label}));
      const options=[...mapped,...(counts.get(code)||[])];const label=document.createElement('label');label.textContent=countryName(code);
      const find=document.createElement('input');find.type='search';find.placeholder='Find an instrument';find.setAttribute('aria-label','Find instrument for '+countryName(code));
      const select=document.createElement('select');select.required=true;select.setAttribute('aria-label','Selected instrument for '+countryName(code));
      function fill(){const term=fold(find.value);select.replaceChildren(...options.filter(o=>fold(o.title+' '+o.key).includes(term)).slice(0,100).map(o=>new Option(o.title,o.key)));}
      find.oninput=fill;fill();label.append(find,select);inputs.append(label);return select;
    });
    compare.onsubmit=e=>{e.preventDefault();navigate('changes',{before:selectors[0].value,after:selectors[1].value});};
    return;
  }
  let records=counts.get(code)||[];
  host.innerHTML='<div class="atlas-layout"><div class="atlas-card map-card"><h2>National collections</h2><div class="map-drawing" aria-busy="true"></div><div class="map-legend"><span>Source records</span>'+['0','1–9','10–49','50–199','200+'].map((v,i)=>'<span><i class="tone-'+i+'"></i>'+v+'</span>').join('')+'</div></div>'+
    '<aside class="atlas-card atlas-country"><label>Country or territory<select>'+choices(countries,code)+'</select></label><div class="place-detail"></div></aside></div>';
  host.querySelector('select').onchange=e=>navigate('library',{tab:'map',country:e.target.value});
  const detail=host.querySelector('.place-detail');
  if(code){
    const tallies=Map.groupBy(records,r=>r.kind),official=flags.flags.find(r=>r.code===code);
    detail.innerHTML='<h3>'+esc(countryName(code))+'</h3><p><strong>'+format(records.length)+'</strong> indexed source records</p><dl>'+[...tallies].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+format(v.length)+'</dd>').join('')+'</dl>'+
      '<div class="atlas-actions"><a href="#library?country='+encodeURIComponent(code)+'">Browse documents</a><a href="#library?tab=compare&amp;left='+encodeURIComponent(code)+'">Compare country</a></div>'+
      (official?'<details><summary>Publishing authorities</summary>'+official.sources.map(s=>'<p><a href="'+esc(s.url)+'" target="_blank" rel="noreferrer">'+esc(s.title)+'</a></p>').join('')+'</details>':'');
  }else detail.innerHTML='<p>Select a country on the map or in the list to explore its sources.</p>';
  const canvas=host.querySelector('.map-drawing');
  try{
    geometry??=readJson(dataUrl('world-boundaries.json')).catch(e=>{geometry=null;throw e;});
    const shapes=await geometry;if(!canvas.isConnected)return;
    canvas.innerHTML='<svg viewBox="0 0 720 284" role="group" aria-label="World map of indexed national source records">'+shapes.map(([id,name,d])=>{
      const n=counts.get(id)?.length||0,t=n>=200?4:n>=50?3:n>=10?2:n?1:0;
      const path='<path d="'+esc(d)+'" class="tone-'+t+(id===code?' chosen':'')+'"><title>'+esc(name)+' · '+format(n)+' records</title></path>';
      return countries.some(c=>c.code===id)?'<a href="#library?tab=map&amp;country='+esc(id)+'" aria-label="'+esc(name+', '+format(n)+' records')+'">'+path+'</a>':path;
    }).join('')+'</svg>';canvas.setAttribute('aria-busy','false');
  }catch{canvas.textContent='Map outlines are unavailable. The country list remains available.';}
}
