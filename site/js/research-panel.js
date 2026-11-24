import {esc, isoDay, marked, safeUrl} from './model.js';
import {changeEvidence,compareRequirements,eventKinds,interpretQuestion,searchDatedProvisions,timelineChanges,timelineHref} from './legal-research.js';

const modes = {provisions:'Provisions', compare:'Compare requirements', timeline:'Changes by date'};

export function sourceLink(item, title='Publisher source') {
  if (item.doc) {
    const p=new URLSearchParams({doc:item.doc});
    if(item.section)p.set('section',item.section);
    return '<a href="#library?'+esc(p)+'">'+esc(title)+'</a>';
  }
  const url=safeUrl(item.url);
  return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(title)+'</a>':'';
}

function provision(item, regimes) {
  return '<div><p class="research-meta">'+esc(regimes[item.regime]?.label||item.regime)+' · '+esc(item.citation)+'</p>'+
    '<p>'+esc(item.text)+'</p><div class="research-links">'+sourceLink(item,item.doc?'Read provision':'Read original')+
    (item.doc&&item.url?sourceLink({url:item.url},'Publisher source'):'')+'</div></div>';
}

function changeRow(event, authorityName, otherDates) {
  const evidence=changeEvidence(event);
  const sources=evidence.length?evidence.map(item=>
    '<blockquote class="research-quote">'+esc(item.quote)+'</blockquote>'+sourceLink({url:item.url||event.url},item.reference||'Publisher source')).join(''):
    sourceLink({url:event.url});
  return '<li class="research-row"><h4>'+esc(event.title)+
    '</h4><p class="research-meta">'+[eventKinds[event.kind],authorityName(event.authority),event.citation].filter(Boolean).map(esc).join(' · ')+'</p>'+
    (event.description?'<p>'+esc(event.description)+'</p>':'')+
    (event.condition?'<p class="research-condition"><strong>When it applies</strong> '+esc(event.condition)+'</p>':'')+
    '<div class="research-evidence">'+sources+'</div>'+
    (event.doc||otherDates?'<div class="research-links">'+(event.doc?sourceLink(event,'Open in Library'):'')+
    (otherDates?'<a href="'+esc(timelineHref({provision:event.provisionId,allDates:true}))+'">All dates for this provision</a>':'')+'</div>':'')+'</li>';
}

function changeDays(events, authorityName, relatedCounts) {
  return [...Map.groupBy(events,event=>event.date)].map(([day,items])=>
    '<section class="research-day"><h3><time datetime="'+esc(day)+'">'+esc(day)+'</time></h3><ul>'+
    items.map(event=>changeRow(event,authorityName,relatedCounts?.get(event.provisionId)>1)).join('')+'</ul></section>').join('');
}

export function mountResearch(host, modeButtons, {catalogue,events,today,params,countryName,changed}) {
  const {regimes}=catalogue;
  const manual=new URLSearchParams(params);
  const authorityName=key=>regimes[key]?.label||(key==='EU'?'European Union':countryName(key));
  const defaultEnd=interpretQuestion('next three years',regimes,today).to;
  const pageSize=60;
  let currentMode,limit=pageSize;
  modeButtons.innerHTML=Object.entries(modes).map(([key,label])=>'<button type="button" data-research-mode="'+key+
    '" aria-pressed="false">'+esc(label)+'</button>').join('');
  modeButtons.onclick=e=>{
    const button=e.target.closest('[data-research-mode]');
    if(!button)return;
    manual.set('research',button.dataset.researchMode);
    limit=pageSize;
    changed();
  };
  const options=(pairs,label)=>'<option value="">'+esc(label)+'</option>'+pairs.map(([key,value])=>
    '<option value="'+esc(key)+'">'+esc(value)+'</option>').join('');
  const comparisonRegimes=Object.entries(regimes).filter(([key])=>catalogue.provisions.some(p=>p.regime===key))
    .map(([key,r])=>[key,r.label]);
  const field=(caption,key,markup)=>'<label>'+caption+markup.replace(' data-control',' data-control="'+key+'"')+'</label>';
  const topic=field('Topic','topic','<input data-control type="search" placeholder="Title, condition or citation">');
  const researchDates=field('From','from','<input data-control type="date">')+
    field('Through','to','<input data-control type="date">');
  function controls(mode) {
    if (mode==='compare')return field('First rule set','left','<select data-control>'+options(comparisonRegimes,'Choose a rule set')+'</select>')+
      field('Second rule set','right','<select data-control>'+options(comparisonRegimes,'Choose a rule set')+'</select>')+
      field('Relationship','relationship','<select data-control>'+options([['stricter','Stricter or additional requirements']],'All relationships')+'</select>')+topic;
    return researchDates+field('Issuing body or jurisdiction','authority','<select data-control></select>')+
      field('Instrument','instrument','<select data-control></select>')+
      field('Date type','kind','<select data-control>'+options([['all','All date types'],...Object.entries(eventKinds)],'Operative dates')+'</select>')+
      field('Result level','level','<select data-control>'+options([['provisions','Dated provisions']],'All records')+'</select>')+topic;
  }
  function form(mode) {
    host.innerHTML='<form class="research-fields"></form><div data-research-results aria-live="polite"></div>';
    const form=host.querySelector('form');
    form.innerHTML=controls(mode);
    form.onsubmit=e=>e.preventDefault();
    const update=e=>{
      const key=e.target.dataset.control;
      if(!key)return;
      manual.set('r.'+key,e.target.value);
      if(key==='authority')manual.set('r.instrument','');
      limit=pageSize;
      changed();
    };
    form.onchange=update;
    form.oninput=e=>{if(e.target.dataset.control==='topic')update(e);};
    host.querySelector('[data-research-results]').onclick=e=>{
      if(e.target.closest('[data-clear-provision]')){
        manual.delete('r.provision');
        limit=pageSize;
        changed();
        host.querySelector('[data-control="topic"]').focus();
        return;
      }
      const button=e.target.closest('[data-more-dates]');
      if(!button)return;
      const previous=limit;
      limit+=pageSize;
      changed();
      host.querySelectorAll('.research-row h4')[previous]?.focus();
    };
  }

  function populateSelect(key,pairs,label,value) {
    const select=host.querySelector('[data-control="'+key+'"]');
    const markup=options(pairs,label);
    if(select.dataset.options!==markup){select.innerHTML=markup;select.dataset.options=markup;}
    select.value=value;
    if(key==='instrument')select.parentElement.hidden=!pairs.length;
  }

  function draw(context) {
    const parsed=interpretQuestion(context.query,regimes,today);
    const selected=manual.get('research'),mode=Object.hasOwn(modes,selected)?selected:parsed.mode;
    for(const b of modeButtons.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.researchMode===mode));
    host.hidden=mode==='provisions';
    if(mode==='provisions'){currentMode=mode;return mode;}
    if(mode!==currentMode){form(mode);currentMode=mode;}
    const factScope={...parsed.facts,...context.values};
    if(!factScope.flag&&parsed.factFlag)factScope.flag=parsed.factFlag;
    const state={...parsed,asOf:context.asOf,facts:factScope,provision:manual.get('r.provision')||''};
    const initial={left:parsed.left||context.values.flag||'',right:parsed.right||'',
      from:parsed.from??today,to:parsed.to??defaultEnd,authority:parsed.authority||'',instrument:parsed.instrument||'',kind:'',level:'',
      topic:mode==='timeline'&&parsed.mode==='provisions'&&!parsed.from?context.query:'',
      relationship:parsed.stricter?'stricter':''};
    for(const control of host.querySelectorAll('[data-control]')){
      const key=control.dataset.control;
      state[key]=manual.has('r.'+key)?manual.get('r.'+key):initial[key];
      if(control.value!==state[key])control.value=state[key]||'';
    }
    const results=host.querySelector('[data-research-results]');
    if(mode==='compare'){
      const comparisons=compareRequirements(catalogue,{...state,stricter:state.relationship==='stricter'});
      const message=!state.left||!state.right?'Choose two rule sets to compare.':
        state.left===state.right?'Choose two different rule sets.':'No indexed comparison for these rule sets and filters.';
      const choices=isoDay(state.asOf)?'<p class="research-meta">Edition date · '+esc(state.asOf)+'</p>':'';
      results.innerHTML='<h2 class="research-count">Requirements comparison</h2>'+choices+(comparisons.length?
        comparisons.map(({relation,rule,baseline,forward})=>'<article class="owner-card research-comparison"><h3>'+
          esc(rule.title)+'</h3><p>'+esc(relation.difference)+'</p><div class="research-pair">'+
          [forward?rule:baseline,forward?baseline:rule].map(item=>provision(item,regimes)).join('')+'</div></article>').join(''):
        '<p>'+esc(message)+'</p>');
    }else{
      const sortLabels=(a,b)=>a[1].localeCompare(b[1]);
      const authorityKeys=new Set(events.map(event=>event.authority));
      if(state.authority)authorityKeys.add(state.authority);
      const authorities=[...authorityKeys].map(key=>[key,authorityName(key)]).sort(sortLabels);
      populateSelect('authority',authorities,'All sources',state.authority);
      const scoped=state.authority?events.filter(event=>event.authority===state.authority):events;
      const instruments=new Map(scoped.filter(event=>event.regime!==event.authority)
        .map(event=>[event.regime,regimes[event.regime]?.label||event.regime]));
      const selectedInstrument=scoped.find(event=>event.instrument===state.instrument);
      if(selectedInstrument&&!instruments.has(state.instrument))instruments.set(state.instrument,selectedInstrument.instrumentTitle||selectedInstrument.title);
      populateSelect('instrument',[...instruments].sort(sortLabels),'All instruments',state.instrument);
      const changes=timelineChanges(events,state);
      const count=changes.length.toLocaleString();
      const days=new Set(changes.map(event=>event.date)).size.toLocaleString();
      const selectedProvision=state.provision&&events.find(event=>event.provisionId===state.provision);
      const relatedCounts=state.provision?null:new Map([...Map.groupBy(events.filter(event=>event.provisionId),event=>event.provisionId)]
        .map(([key,dates])=>[key,dates.length]));
      results.innerHTML='<h2 class="research-count">Changes by date</h2>'+(selectedProvision?
        '<div class="research-selection"><strong>'+esc(selectedProvision.provisionTitle)+'</strong> '+
        '<button type="button" class="quiet" data-clear-provision>Show all provisions</button></div>':'')+(changes.length?
        '<p class="research-meta">'+count+' '+(changes.length===1?'result':'results')+' on '+days+' '+(days==='1'?'date':'dates')+'</p>'+
        '<div class="research-timeline">'+changeDays(changes.slice(0,limit),authorityName,relatedCounts)+'</div>'+
        (changes.length>limit?'<button class="research-more" type="button" data-more-dates>Show more results</button>':''):
        '<p>'+(state.from&&state.to&&state.from>state.to?'Choose an end date on or after the start date.':'No indexed changes match these filters.')+'</p>');
      for(const heading of results.querySelectorAll('.research-row h4'))heading.tabIndex=-1;
    }
    return mode;
  }
  return {draw,updateEvents(next){events=next;},save(target){
    if(manual.has('research'))target.set('research',manual.get('research'));
    for(const [key,value] of manual)if(key.startsWith('r.'))target.set(key,value);
  }};
}

export function showDatedHits(host, events, {compact=false,...filters}={}) {
  const hits=searchDatedProvisions(events,filters);
  host.hidden=!hits.length;
  if(!hits.length){host.replaceChildren();return;}
  const first=hits.slice(0,compact?3:4);
  host.innerHTML='<h2 class="research-count">Dated requirements</h2>'+
    (compact?'<ul class="research-linked-results">'+first.map(event=>
      '<li><a href="'+esc(timelineHref({provision:event.provisionId,allDates:true}))+'">'+marked(event.title,filters.query)+'</a>'+
      '<span class="research-meta">'+esc(event.date+' · '+eventKinds[event.kind])+'</span></li>').join('')+'</ul>':
      '<div class="research-timeline">'+changeDays(first,authority=>authority)+'</div>')+
    '<a href="'+esc(timelineHref({...filters,allDates:true,level:'provisions'}))+'">View '+(hits.length===1?'dated requirement':'all '+hits.length+' results')+'</a>';
}

export function showLibraryHits(host, rows, {query, country, pending, error}) {
  if(!pending&&!error&&!rows.length){host.hidden=true;return;}
  host.hidden=false;
  const p=new URLSearchParams({q:query});
  if(country)p.set('country',country);
  host.innerHTML='<h2 class="research-count">Library provisions</h2>'+
    (error?'<p>Library search is unavailable.</p>':pending?'<p role="status">Searching the Library…</p>':'')+
    (rows.length?'<ul class="research-linked-results">'+rows.slice(0,6).map(row=>{
      const p=new URLSearchParams({doc:row.doc});
      if(row.sectionId)p.set('section',row.sectionId);
      return '<li><a href="#library?'+esc(p)+'">'+marked(row.heading||row.title,query)+
        '</a><span class="research-meta">'+esc(row.title)+'</span><p>'+marked(row.preview,query)+'</p></li>';
    }).join('')+'</ul>':'')+'<a href="#library?'+esc(p)+'">Open Library search</a>';
}
