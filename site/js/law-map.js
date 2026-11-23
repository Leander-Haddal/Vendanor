import {esc,fold} from './model.js';
import {link} from './reader.js';
import {editionKey} from './uk-editions.js';
import {renderConventionHistory} from './convention-history.js';
import {renderEuHistory} from './eu-history.js';
import {registryGuides} from './registry-guides.js';

function mapLink(label,view,params) {return '<a href="#'+view+'?'+esc(new URLSearchParams(params).toString())+'">'+esc(label)+'</a>';}
function timing(version) {return [version.kind||version.label,version.effectiveFrom?'from '+version.effectiveFrom:'',version.effectiveTo?'until '+version.effectiveTo:''].filter(Boolean).join(' · ');}
function primarySources(host,rows) {
  if(!rows.length)return;
  host.innerHTML='<h2>Official sources</h2>'+rows.map(f=>'<section class="map-authority"><h3>'+esc(f.name||f.code)+'</h3>'+f.sources.map(s=>'<div><span>'+esc([s.topic,s.kind].filter(Boolean).join(' · '))+'</span>'+link(s.title,s.url)+'</div>').join('')+'</section>').join('');
}

function mappedLaws(host,docs) {
  if(!docs.length)return;
  const titles=new Map();
  for(const d of docs){if(!titles.has(d.instrument.id))titles.set(d.instrument.id,[]);titles.get(d.instrument.id).push(d);}
  host.innerHTML='<h2>Mapped laws and editions</h2>'+[...titles.values()].map(items=>{
    const editions=[...items].sort((a,b)=>(b.version.publishedOn||'').localeCompare(a.version.publishedOn||''));
    const rows=editions.map(d=>'<li>'+mapLink(d.version.label,'library',{doc:d.key,section:d.sections[0]?.id||''})+'<span>'+esc(timing(d.version))+'</span></li>').join('');
    const comparison=editions.length>1?'<p>'+mapLink('Compare earliest and latest publications','changes',{before:editions.at(-1).key,after:editions[0].key})+'</p>':'';
    return '<details class="map-fold"><summary>'+esc(editions[0].instrument.shortTitle||editions[0].instrument.title)+'</summary><ul class="edition-list">'+rows+'</ul>'+comparison+'</details>';
  }).join('');
}

function ukTimelines(host,records) {
  if(!records.length)return;
  host.innerHTML='<h2>UK publication timelines</h2><p>Choose a title to open its original and dated versions from The National Archives.</p><label>Find a UK instrument<input type="search" placeholder="Title, year or instrument number"></label><div class="map-national-list"></div><button type="button" class="text-action" data-more>Show more titles</button>';
  const input=host.querySelector('input'),list=host.querySelector('.map-national-list'),more=host.querySelector('[data-more]');let limit=5;
  function draw() {
    const term=fold(input.value),rows=records.filter(r=>fold(r.title+' '+r.id).includes(term)).sort((a,b)=>Number(b.id==='ukpga/1995/21')-Number(a.id==='ukpga/1995/21')||Number(b.year)-Number(a.year));
    list.innerHTML=rows.slice(0,limit).map((r,i)=>'<details class="map-fold" data-index="'+i+'"><summary>'+esc(r.title)+'</summary><div></div></details>').join('')||'<p>No title matches.</p>';
    more.hidden=rows.length<=limit;
    for(const d of list.querySelectorAll('details'))d.ontoggle=()=>{
      if(!d.open||d.dataset.loaded)return;d.dataset.loaded='1';
      const r=rows[+d.dataset.index],v=r.versions;
      const options=v.map((e,i)=>'<option value="'+i+'">'+esc(e.label+(e.format==='pdf'?' · PDF':''))+'</option>').join('');
      d.querySelector('div').innerHTML='<div class="owner-actions">'+link('Official timeline',r.sourceUrl,true)+link(r.pdfKind||'Publisher PDF',r.pdfUrl,true)+'</div>'+
        (v.length?'<label>Published edition<select data-edition>'+options+'</select></label><div class="owner-actions"><a data-read target="_blank" rel="noopener noreferrer">Open this edition at source</a></div>':'<p>The publisher supplies no dated edition links in this record.</p>')+
        (v.length>1?'<label>Compare with<select data-with>'+options+'</select></label><button data-compare>Compare wording</button>':'');
      const first=d.querySelector('[data-edition]'),second=d.querySelector('[data-with]'),open=d.querySelector('[data-read]');
      const compare=d.querySelector('[data-compare]');
      function setChoices(){
        if(first){const edition=v[+first.value];open.href=edition.pdfUrl||edition.url;open.textContent=edition.format==='pdf'?'Open this edition’s PDF':'Open this edition at source';}
        if(second)compare.disabled=first.value===second.value||[first,second].some(s=>v[+s.value].format==='pdf');
      }
      if(second){second.selectedIndex=v.length-1;second.onchange=setChoices;compare.onclick=()=>{location.hash='changes?'+new URLSearchParams({before:editionKey(r,v[+first.value].label),after:editionKey(r,v[+second.value].label)});};}
      if(first){first.onchange=setChoices;setChoices();}
    };
  }
  input.oninput=()=>{limit=5;draw();};more.onclick=()=>{limit+=15;draw();};draw();
}

export function nationalLaws(host,records,code) {
  const local=records.filter(r=>r.codes.includes(code));
  const topics=[...new Set(local.flatMap(r=>r.topics||[]))].sort();
  host.innerHTML='<h2>National catalogue</h2><p>'+local.length.toLocaleString('en')+' records from FAOLEX. Open a title to check its scope and linked document.</p>'+
    (!local.length?'':'<div class="map-filters"><label>Topic<select data-topic><option value="">All topics</option>'+topics.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></label><label>Title or year<input type="search" data-search></label>'+
    '<label>History<select data-status><option value="">All records</option><option value="amended">Recorded amendment</option><option value="repealed">Marked repealed</option></select></label></div><div class="map-national-list"></div><button type="button" class="text-action" data-more>Show more records</button>');
  if(!local.length)return;
  let limit=6;
  function draw() {
    const topic=host.querySelector('[data-topic]').value,term=fold(host.querySelector('[data-search]').value),status=host.querySelector('[data-status]').value;
    const rows=local.filter(r=>(!topic||r.topics?.includes(topic))&&(!term||fold([r.title,r.originalTitle,r.year,r.id].join(' ')).includes(term))&&(!status||(status==='repealed'?r.repealed:r.amendedDate)));
    host.querySelector('.map-national-list').innerHTML=rows.slice(0,limit).map(r=>'<article class="map-national"><div>'+mapLink(r.title,'library',{doc:r.id})+'</div><p>'+esc([r.year,r.kind,r.repealed?'Marked repealed':'',r.amendedDate?'Last recorded amendment '+r.amendedDate:''].filter(Boolean).join(' · '))+'</p></article>').join('')||'<p>No records match these filters.</p>';
    host.querySelector('[data-more]').hidden=rows.length<=limit;
  }
  host.querySelector('.map-filters').oninput=()=>{limit=6;draw();};host.querySelector('[data-more]').onclick=()=>{limit+=18;draw();};draw();
}

export function renderLawMap(host,ctx) {
  const {countries,flags,records,documents,params,uk}=ctx,selected=params.get('country')??ctx.flag,code=selected==='all'?'':selected||'';
  const jurisdictions=[{code:'EU',name:'European Union'},...countries];
  const country=jurisdictions.find(c=>c.code===code),entries=flags.flags||[];
  host.innerHTML='<header class="owner-heading"><h1 tabindex="-1">Law map</h1><p>Choose a flag to explore legislation, official registers and earlier editions.</p></header>'+
    '<div class="owner-card map-picker"><label>Flag state or jurisdiction<select id="map-country"><option value="">All registers and treaties</option>'+jurisdictions.map(c=>'<option value="'+esc(c.code)+'" '+(c.code===code?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label></div>'+
    (country?'<header class="map-country-heading"><h2>'+esc(country.name)+'</h2>'+(code==='EU'?'':mapLink('Flag administration and class evidence','jurisdictions',{country:code}))+'</header><nav class="map-jumps" aria-label="Sections for this jurisdiction"></nav><div class="map-sections"><section id="map-primary"></section><section id="map-mapped"></section><section id="map-uk"></section><section id="map-eu"></section><section id="map-national"></section><section id="map-international"></section></div>':
      '<section class="owner-card register-grid"><h2>Major shipping registers</h2><div class="register-links">'+entries.filter(x=>x.rank).slice(0,8).map(x=>mapLink(x.registerName||x.name,'map',{country:x.code})).join('')+'</div>'+
      '<details class="map-fold"><summary>All ranked registers</summary><div class="register-links">'+entries.filter(x=>x.rank).map(x=>mapLink(x.registerName||x.name,'map',{country:x.code})).join('')+'</div></details>'+
      (flags.basis?.url?'<p>'+link('UNCTAD register ranking · '+flags.basis.asOf,flags.basis.url)+'</p>':'')+'</section><section class="owner-card"><h2>Regional law</h2>'+mapLink('European Union shipping legislation and earlier editions','map',{country:'EU'})+'</section><div class="map-sections"><section id="map-international"></section></div>');
  host.querySelector('#map-country').onchange=e=>ctx.navigate('map',{country:e.target.value||'all'});
  renderConventionHistory(host.querySelector('#map-international'),ctx.imo,code,params.get('convention'));
  if(!country)return;
  primarySources(host.querySelector('#map-primary'),entries.filter(x=>x.code===code));
  const guidance=registryGuides(ctx.guides,code);
  if(guidance){const section=document.createElement('section');section.innerHTML=guidance;host.querySelector('#map-primary').after(section);}
  mappedLaws(host.querySelector('#map-mapped'),documents.filter(d=>d.instrument.jurisdiction===code||d.instrument.flagIntervals?.[code]||d.version.flagIntervals?.[code]));
  if(code==='GB')ukTimelines(host.querySelector('#map-uk'),uk.records);
  if(code==='EU')renderEuHistory(host.querySelector('#map-eu'),ctx.eu);
  else {
    nationalLaws(host.querySelector('#map-national'),records,code);
    host.querySelector('#map-eu').innerHTML='<h2>Regional law</h2>'+mapLink('Explore EU shipping legislation','map',{country:'EU'});
  }
  const jumps=host.querySelector('.map-jumps');
  for(const section of host.querySelectorAll('.map-sections > section')){
    const heading=section.querySelector('h2');if(!heading)continue;
    const button=document.createElement('button');button.type='button';button.textContent=heading.textContent;
    button.onclick=()=>{heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});};jumps.append(button);
  }
}
