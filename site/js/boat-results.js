import {esc,fold,evaluate,describeRule,queryParts} from './model.js';
import {boatControl,fieldName,readBoatValue,typeName,operationShortcuts,lookupEvidence} from './boat-form.js';
import {searchBoat} from './boat-matches.js';
import {conventionMarks} from './convention-history.js';
import {registryGuides} from './registry-guides.js';

function preferred(rows,values) {
  const rank=r=>['s1','scope','application'].includes(r.section.id)?0:(values.lastSurveyDate&&r.section.survey)?1:r.section.screeningLevel==='section'?2:3;
  return [...rows].sort((a,b)=>rank(a)-rank(b));
}

function passageButton(row) {
  const s=row.section;
  return '<button type="button" class="passage-choice" data-read-passage data-doc="'+esc(row.doc.key)+'" data-section="'+esc(s.id)+'"><span class="provision-number">'+esc(s.number||s.label||'Passage')+'</span><span>'+esc(s.title||s.number||'Read passage')+'</span><span aria-hidden="true">›</span></button>';
}

function decidingConditions(rule,profile,fields) {
  if(!rule||evaluate(rule,profile)!==true)return [];
  if(rule.all||rule.any)return (rule.all||rule.any).flatMap(r=>decidingConditions(r,profile,fields));
  if(rule.not)return [];
  if(!['lengthL','lengthOverall','grossTonnage','deadweightTonnes','passengers','shipType','colregWaters','mlcCommercialActivity','ukLsaReach','usPart175Location','nzPart91Waters'].includes(rule.field))return [];
  return [describeRule(rule,fields).replace(' = ',' ').replace(' ≠ ',' excluding ').replace(' ≤ ',' at most ').replace(' ≥ ',' at least ').replace(' < ',' below ').replace(' > ',' above ')];
}

const titleSignals={
  cargo:/\b(cargo ships?|cargo vessels?|carriage of cargo|merchant shipping)\b/,
  tanker:/\b(oil tankers?|tankers?|carriage of oil)\b/,
  fishing:/\b(fishing (vessels?|boats?|fleet)|fishing vessel (safety|registration))\b/,
  passenger:/\b(passenger (ships?|vessels?|boats?)|ferries|ferry)\b/,
  recreational:/\b(pleasure (craft|boats?|vessels?|yachts?)|recreational (boats?|vessels?|craft|boating)|pleasure navigation|yachting|small craft)\b/
};

export function nationalCandidates(records,profile) {
  const values=profile.values,signal=titleSignals[values.euOilTanker==='yes'?'tanker':values.shipType];
  if(!signal)return [];
  const day=profile.asOf||'',year=day.slice(0,4);
  return records.filter(r=>{
    if(!r.codes.includes(values.flag)||!signal.test(fold(r.title+' '+(r.sourceKeywords||[]).join(' '))))return false;
    if(year&&Number(r.year)>Number(year))return false;
    if(day&&/^\d{4}-\d\d-\d\d$/.test(r.issuedDate||'')&&r.issuedDate>day)return false;
    return true;
  }).sort((a,b)=>Number(Boolean(a.repealed))-Number(Boolean(b.repealed))||Number(b.year||0)-Number(a.year||0));
}

function listPassages(host,rows,values) {
  if(!rows.length)return;
  const ordered=preferred(rows,values);
  const top=ordered[0];
  host.innerHTML=passageButton(top)+(ordered.length>1?'<details class="more-passages"><summary>Browse all '+ordered.length+' passages</summary><div></div></details>':'');
  const details=host.querySelector('details');if(!details)return;
  details.ontoggle=()=>{
    if(!details.open||details.dataset.loaded)return;details.dataset.loaded='1';
    const body=details.querySelector('div');let limit=8;
    body.innerHTML=(ordered.length>8?'<label>Find a passage in this law<input type="search" placeholder="Heading, section or word"></label>':'')+
      '<div class="passage-options"></div><button type="button" class="text-action" data-more>Show more passages</button>';
    const input=body.querySelector('input'),more=body.querySelector('[data-more]'),list=body.querySelector('.passage-options');
    function draw() {
      const term=fold(input?.value||''),subset=term?ordered.filter(r=>fold([r.section.number,r.section.title,r.section.text].join(' ')).includes(term)):ordered;
      list.innerHTML=subset.slice(0,limit).map(passageButton).join('')||'<p>No passages match these words.</p>';more.hidden=subset.length<=limit;
    }
    if(input)input.oninput=()=>{limit=8;draw();};more.onclick=()=>{limit+=12;draw();};draw();
  };
}

function followups(host,rows,ctx) {
  const anchor=preferred(rows,ctx.profile.values).find(r=>r.missing?.length);
  if(!anchor)return;
  const fields=anchor.missing.map(key=>ctx.fields.find(f=>f.key===key)).filter(Boolean).slice(0,4);
  if(!fields.length)return;
  const form=document.createElement('form');form.dataset.followups='';form.className='followup-form';
  form.innerHTML='<fieldset><legend>Details that could settle this question</legend><div class="owner-grid">'+fields.map(f=>boatControl(f,ctx.profile.values[f.key],{prefix:'follow-'+host.dataset.position})).join('')+'</div></fieldset>'+
    '<button type="submit">Update results</button><span role="status"></span>';
  form.oninput=e=>e.target.setCustomValidity?.('');
  form.onsubmit=e=>{
    e.preventDefault();const updates={};
    for(const f of fields){const r=readBoatValue(form.elements.namedItem(f.key),f);if(!r.valid)return;if(r.value!==undefined)updates[f.key]=r.value;}
    if(!Object.keys(updates).length){form.querySelector('[role=status]').textContent='Enter a known detail to update the search.';return;}
    ctx.onRefine(updates);
  };
  const disclosure=document.createElement('details');disclosure.className='related-checks';
  const summary=document.createElement('summary');summary.textContent='Answer scope questions';disclosure.append(summary);
  for(const shortcut of operationShortcuts(ctx.profile.values,anchor.missing)){
    const group=document.createElement('div');group.className='operation-shortcut';
    const text=document.createElement('p');text.textContent=shortcut.description;
    const button=document.createElement('button');button.type='button';button.textContent=shortcut.name;button.onclick=()=>ctx.onRefine(shortcut.changes);
    group.append(text,button);disclosure.append(group);
  }
  disclosure.append(form);host.append(disclosure);
}

function lawCard(group,related,status,ctx,index) {
  const card=document.createElement('article');card.className='owner-card law-card';card.dataset.lawId=group.instrument.id;
  const rows=preferred(group.sections,ctx.profile.values),anchor=rows[0],publisher=group.instrument.authority||group.instrument.jurisdiction;
  card.innerHTML='<div class="law-card-heading"><h3>'+esc(group.title)+'</h3><p>'+esc(publisher)+'</p></div>'+
    '<div class="law-passages"></div><div class="law-questions" data-position="'+index+'"></div>';
  listPassages(card.querySelector('.law-passages'),rows,ctx.profile.values);
  const questions=card.querySelector('.law-questions');
  if(status==='review'){
    const missing=anchor.missing?.map(key=>ctx.fields.find(f=>f.key===key)).filter(Boolean).map(fieldName)||[];
    const reason=document.createElement('p');reason.className='card-reason';
    reason.textContent=missing.length?'Still needed for '+(anchor.section.number||'this passage')+' · '+missing.join(', '):anchor.reason||'Check the scope and dates in the source.';
    questions.append(reason);followups(questions,rows,ctx);
  }else{
    const conditions=[...new Set(decidingConditions(anchor.section.criteria,ctx.profile.values,ctx.fields))].slice(0,4);
    if(conditions.length){const why=document.createElement('p');why.className='card-reason';why.textContent=conditions.join(' · ');card.querySelector('.law-card-heading').append(why);}
  }
  if(status==='match'&&related?.sections.length){
    const more=document.createElement('details');more.className='related-checks';
    more.innerHTML='<summary>Other provisions to check ('+related.sections.length+')</summary><div></div>';
    more.ontoggle=()=>{if(more.open&&!more.dataset.loaded){more.dataset.loaded='1';const target=more.querySelector('div');target.dataset.position=index+'-other';listPassages(target,related.sections,ctx.profile.values);followups(target,related.sections,ctx);}};
    questions.append(more);
  }
  return card;
}

export function filteredLaws(groups,terms) {
  if(!terms.length)return groups;
  return groups.flatMap(g=>{
    const family=fold([g.title,g.instrument.title,g.instrument.id,g.instrument.authority].join(' ')),remaining=terms.filter(t=>!family.includes(t));
    if(!remaining.length)return [g];
    const sections=g.sections.filter(({section})=>{
      const wording=fold([section.number,section.title,section.text].join(' '));
      return remaining.every(t=>wording.includes(t));
    });
    return sections.length?[{...g,sections}]:[];
  });
}

function flagTreaties(book,profile,flagName) {
  const flag=profile.values.flag,asOf=book?.participation?.asOf;
  if(!asOf)return '';
  const items=book.instruments.filter(item=>conventionMarks(book,item,flag).length);
  if(!items.length)return '';
  return '<details class="owner-card national-suggestions"><summary>IMO treaty records for '+esc(flagName)+' ('+items.length+')</summary>'+
    '<p>The IMO workbook records these treaty actions on '+esc(asOf)+'. Each record links the flag’s status, amendments and sources.'+
    (profile.asOf<asOf?' For this earlier law date, check the dated instrument and flag action.':' Check each treaty’s vessel and voyage scope.')+'</p><ul class="treaty-list">'+
    items.map(i=>'<li><a href="#map?'+esc(new URLSearchParams({country:flag,convention:i.id}).toString())+'">'+esc(i.title)+'</a></li>').join('')+'</ul></details>';
}

export function renderBoatResults(container,ctx) {
  const {profile,documents,countryName}=ctx;
  const {matched,review}=searchBoat(documents,profile);
  const values=profile.values,flagName=countryName(values.flag);
  const particulars=[flagName,typeName(values),values.lengthOverall!=null?values.lengthOverall+' m overall':'',values.grossTonnage!=null?values.grossTonnage+' GT':''].filter(Boolean);
  container.innerHTML='<header class="owner-heading result-heading"><div><h1 tabindex="-1">'+(ctx.name?'Laws for '+esc(ctx.name):'Laws for your boat')+'</h1><p>'+esc(particulars.join(' · '))+'</p></div><button type="button" id="edit-boat">Edit boat</button></header>'+
    '<p class="results-date">Law date <time datetime="'+esc(profile.asOf)+'">'+esc(profile.asOf)+'</time></p>'+lookupEvidence(ctx.lookup,values)+
    (ctx.failedCollections?.length?'<p class="note">Partial search. These collections could not be loaded: '+esc(ctx.failedCollections.join(', '))+'.</p>':'')+
    (matched.length||review.length?'<label class="boat-word-search">Find within these laws<input type="search" placeholder="Keyword, phrase or section number" id="boat-law-keyword"></label>':'')+
    '<section class="result-group" id="boat-matched"><h2>Matches your particulars</h2><div></div></section>'+
    '<section class="result-group" id="boat-conditional"><h2>Needs checking</h2><div></div></section>'+
    '<section class="source-bridge"><div><h2>'+esc(flagName)+' law sources</h2><p>Official registers, national legislation and earlier editions for this flag.</p></div><a class="button" href="#map?country='+encodeURIComponent(values.flag)+'">Open law map</a></section>'+
    registryGuides(ctx.guides,values.flag,profile)+'<div id="boat-national-records"></div>'+flagTreaties(ctx.imo,profile,flagName);
  const matchHost=container.querySelector('#boat-matched > div'),reviewSection=container.querySelector('#boat-conditional'),reviewHost=reviewSection.querySelector('div'),input=container.querySelector('#boat-law-keyword');
  function showLaws(){
    const terms=queryParts(input?.value||''),yes=filteredLaws(matched,terms),maybe=filteredLaws(review,terms);
    const reviewById=new Map(maybe.map(g=>[g.id,g])),conditional=maybe.filter(g=>!yes.some(m=>m.id===g.id));
    matchHost.replaceChildren();reviewHost.replaceChildren();reviewSection.hidden=!conditional.length;
    if(!yes.length)matchHost.innerHTML='<p class="quiet-empty">'+(terms.length?'No matched provisions contain these words.':conditional.length?'No provision meets all the recorded conditions yet. Check the questions below.':'No fully screened provision was found for these particulars and date. The flag’s law sources are available below.')+'</p>';
    yes.forEach((g,i)=>matchHost.append(lawCard(g,reviewById.get(g.id),'match',ctx,i)));
    conditional.forEach((g,i)=>reviewHost.append(lawCard(g,null,'review',ctx,i+yes.length)));
  }
  if(input)input.oninput=showLaws;showLaws();
  container.querySelector('#edit-boat').onclick=ctx.onEdit;
  showNationalSuggestions(container,ctx.records||[],profile);
  container.onclick=e=>{const button=e.target.closest('[data-read-passage]');if(button)ctx.onRead(button.dataset.doc,button.dataset.section);};
}

export function showNationalSuggestions(container,records,profile) {
  const target=container.querySelector('#boat-national-records');if(!target)return;
  const national=nationalCandidates(records,profile);
  target.innerHTML=national.length?'<details class="owner-card national-suggestions" '+(!container.querySelector('.law-card')?'open':'')+'><summary>National records mentioning this type of boat ('+national.length+')</summary><p>These titles and subjects match your flag and boat type. Verify their scope in the source.</p><div></div><button type="button" class="text-action" data-national-more>Show more records</button></details>':'';
  if(national.length){
    const group=target.querySelector('.national-suggestions'),more=group.querySelector('[data-national-more]');let limit=3;
    function drawNational(){
      group.querySelector('div').innerHTML=national.slice(0,limit).map(r=>'<article class="map-national"><a href="#library?'+esc(new URLSearchParams({doc:r.id}).toString())+'">'+esc(r.title)+'</a><p>'+esc([r.year,r.repealed?'Marked repealed':''].filter(Boolean).join(' · '))+'</p></article>').join('');
      more.hidden=limit>=national.length;
    }
    more.onclick=()=>{limit+=8;drawNational();};drawNational();
  }
}
