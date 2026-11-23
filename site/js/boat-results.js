import {esc,fold,evaluate,describeRule,queryParts} from './model.js';
import {boatControl,fieldName,readBoatValue,operationShortcuts} from './boat-form.js';
import {passagePreview, resetPrintPreviews} from './boat-excerpts.js';
import {searchBoat} from './boat-matches.js';
import {conventionMarks} from './convention-history.js';
import {registryGuides} from './registry-guides.js';

function preferred(rows,values) {
  const rank=r=>['s1','scope','application'].includes(r.section.id)?0:(values.lastSurveyDate&&r.section.survey)?1:r.section.screeningLevel==='section'?2:3;
  return [...rows].sort((a,b)=>rank(a)-rank(b));
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

function lawCard(group, ctx, query, selected, index) {
  const card = document.createElement('article');
  card.className = 'owner-card law-card';
  card.dataset.lawId = group.instrument.id;
  const rows = group.sections;
  card.innerHTML = '<header class="law-card-heading"><div><h3>' + esc(group.title) + '</h3><p>' +
    esc(group.instrument.authority || group.category) + '</p></div><span class="passage-total">' +
    rows.length + (rows.length === 1 ? ' passage' : ' passages') + '</span></header><div class="law-passages"></div>';
  const list = card.querySelector('.law-passages');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'expand-passages';
  let shown = 0;
  function append(limit) {
    const start = shown;
    shown = Math.min(rows.length, limit);
    for (const row of rows.slice(start, shown)) list.append(passagePreview(row, query));
    const remaining = rows.length - shown;
    more.hidden = remaining === 0;
    more.textContent = remaining > 8 ? 'Show next 8 passages (' + remaining + ' remaining)' :
      'Show ' + remaining + ' more ' + (remaining === 1 ? 'passage' : 'passages');
  }
  append(selected ? 5 : 1);
  more.onclick = () => {
    const first = shown;
    append(shown + 8);
    const heading = list.children[first].querySelector('h4');
    heading.tabIndex = -1;
    heading.focus({preventScroll:true});
  };
  card.append(more);

  const questions = document.createElement('div');
  questions.className = 'law-questions';
  questions.dataset.position = String(index);
  const review = rows.filter(row => row.state === 'review');
  if (review.length) {
    const anchor = preferred(review, ctx.profile.values).find(row => row.missing.length) || review[0];
    const missing = anchor.missing.map(key => ctx.fields.find(field => field.key === key)).filter(Boolean).map(fieldName);
    const note = document.createElement('p');
    note.className = 'card-reason';
    note.textContent = missing.length ? 'Still needed for ' + (anchor.section.number || 'this passage') + ' · ' + missing.join(', ') : anchor.reason;
    questions.append(note);
    followups(questions, review, ctx);
  } else {
    const conditions = [...new Set(decidingConditions(rows[0].section.criteria, ctx.profile.values, ctx.fields))].slice(0, 4);
    if (conditions.length) {
      const why = document.createElement('p');
      why.className = 'card-reason';
      why.textContent = conditions.join(' · ');
      questions.append(why);
    }
  }
  if (questions.childElementCount) card.append(questions);
  return card;
}

function groupedLaws(documents, profile, countryName) {
  const {matched, review} = searchBoat(documents, profile);
  const laws = new Map();
  for (const group of [...matched, ...review]) {
    const rows = preferred(group.sections, profile.values);
    const existing = laws.get(group.id);
    if (existing) { existing.sections.push(...rows); continue; }
    const instrument = group.instrument;
    let category = countryName(instrument.jurisdiction) || 'National legislation';
    if (instrument.local) category = 'Uploaded documents';
    else if (instrument.flagState) category = 'International conventions';
    else if (instrument.jurisdiction === 'EU') category = 'European Union';
    laws.set(group.id, {...group, category, sections: rows});
  }
  return [...laws.values()].map(group => ({...group, multipleEditions:new Set(group.sections.map(row => row.doc.key)).size > 1}));
}

export function filteredLaws(groups,terms) {
  if(!terms.length)return groups;
  return groups.flatMap(g=>{
    const family=fold([g.title,g.instrument.title,g.instrument.id,g.instrument.authority].join(' ')),remaining=terms.filter(t=>!family.includes(t));
    if(!remaining.length)return [g];
    const sections=g.sections.filter(({doc,section})=>{
      const wording=fold([doc.version.label,section.number,section.title,section.text].join(' '));
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

function lawTreeItem(group, openEditions) {
  const editions = new Map();
  for (const {doc} of group.sections) {
    const entry = editions.get(doc.key);
    if (entry) entry.count++;
    else editions.set(doc.key, {label:doc.version.label, count:1});
  }
  const law = ' data-law="' + esc(group.id) + '"';
  const button = '<button type="button"' + law + '><span>' + esc(group.title) +
    '</span><small title="Passages">' + group.sections.length + '</small></button>';
  if (!group.multipleEditions) return '<li>' + button + '</li>';
  return '<li>' + button + '<details class="edition-tree" data-editions="' + esc(group.id) + '"' +
    (openEditions.has(group.id) ? ' open' : '') + '><summary>' + editions.size + (editions.size === 1 ? ' source edition' : ' source editions') + '</summary><ul>' +
    [...editions].map(([key, entry]) => '<li><button type="button"' + law + ' data-edition="' + esc(key) + '"><span>' +
      esc(entry.label) + '</span><small title="Passages">' + entry.count + '</small></button></li>').join('') + '</ul></details></li>';
}

export function renderBoatResults(container, ctx) {
  const {profile, state} = ctx;
  const laws = groupedLaws(ctx.documents, profile, ctx.countryName);
  const flagName = ctx.countryName(profile.values.flag);
  const compact = matchMedia('(max-width:760px)').matches;
  const lawMap = '#map?' + new URLSearchParams({country:profile.values.flag});
  container.dataset.hasLaws = String(laws.length > 0);
  container.innerHTML = '<details class="owner-card specs-panel"' + ((state.specsOpen ?? !compact) ? ' open' : '') +
    '><summary><strong>Ship specifications</strong></summary><div class="specs-body"></div></details>' +
    (ctx.failedCollections?.length ? '<p class="note">Partial search. Unavailable collections include ' + esc(ctx.failedCollections.join(', ')) + '.</p>' : '') +
    '<div class="law-workspace"><aside class="law-sidebar"><details class="law-index" ' + (compact ? '' : 'open') +
    '><summary><strong>Law index</strong><span class="index-count"></span></summary><nav class="law-tree" aria-label="Laws by category"></nav></details></aside>' +
    '<section class="law-stream" aria-label="Source excerpts"><div class="overview-filters" role="search">' +
    '<label>Search passages<input id="boat-law-keyword" type="search" maxlength="260" placeholder="Law, section number or wording"></label>' +
    '<label>Screening result<select id="boat-outcome"><option value="all">All passages</option><option value="match">Matches your particulars</option>' +
    '<option value="review">Needs checking</option></select></label></div>' +
    '<h2 class="excerpt-count" tabindex="-1" aria-live="polite"></h2><div class="source-cards"></div></section></div>' +
    '<section class="additional-sources"><h2>Other sources for ' + esc(flagName) + '</h2>' +
    registryGuides(ctx.guides, profile.values.flag, profile) + '<div id="boat-national-records"></div>' +
    flagTreaties(ctx.imo, profile, flagName) + '<a href="' + esc(lawMap) + '">Browse registers and earlier editions for ' + esc(flagName) + '</a></section>';
  const specs = container.querySelector('.specs-panel');
  specs.ontoggle = () => { state.specsOpen = specs.open; };
  ctx.renderSpecifications(specs.querySelector('.specs-body'));
  const input = container.querySelector('#boat-law-keyword'), outcome = container.querySelector('#boat-outcome');
  const index = container.querySelector('.law-index'), tree = index.querySelector('nav');
  const count = container.querySelector('.excerpt-count'), cards = container.querySelector('.source-cards');
  input.value = state.query || '';
  outcome.value = state.outcome || 'all';
  let visible = [];

  function drawCards() {
    resetPrintPreviews();
    let groups = state.selected ? visible.filter(group => group.id === state.selected) : visible;
    if (state.edition) groups = groups.map(group => ({...group, sections:group.sections.filter(row => row.doc.key === state.edition)}));
    const passages = groups.reduce((sum, group) => sum + group.sections.length, 0);
    const title = state.edition ? groups[0].sections[0].doc.version.label : groups[0]?.title;
    count.textContent = (state.selected ? title + ' · ' : '') + passages + (passages === 1 ? ' passage' : ' passages') +
      (state.selected ? '' : ' in ' + groups.length + (groups.length === 1 ? ' law' : ' laws'));
    cards.replaceChildren(...groups.map((group, i) => lawCard(group, ctx, input.value, Boolean(state.selected), i)));
    if (!groups.length) {
      cards.innerHTML = laws.length ? '<div class="overview-empty"><h3>No passages match these filters</h3><button type="button" data-reset-law>Clear filters</button></div>' :
        '<div class="overview-empty"><h3>No screened laws for these specifications</h3><p>Check the ship details above or browse the other sources below.</p></div>';
    }
    for (const button of tree.querySelectorAll('[data-law]')) {
      button.setAttribute('aria-current', String(button.dataset.law === state.selected && (button.dataset.edition || '') === state.edition));
    }
  }

  function filter() {
    state.query = input.value;
    state.outcome = outcome.value;
    visible = filteredLaws(laws, queryParts(input.value));
    if (outcome.value !== 'all') visible = visible.flatMap(group => {
      const sections = group.sections.filter(row => row.state === outcome.value);
      return sections.length ? [{...group, sections}] : [];
    });
    const selected = visible.find(group => group.id === state.selected);
    if (!selected) state.selected = '';
    if (!selected?.sections.some(row => row.doc.key === state.edition)) state.edition = '';
    const closed = new Set([...tree.querySelectorAll('[data-category]:not([open])')].map(folder => folder.dataset.category));
    const openEditions = new Set([...tree.querySelectorAll('[data-editions][open]')].map(folder => folder.dataset.editions));
    if (state.edition) openEditions.add(state.selected);
    const folders = new Map();
    for (const group of visible) {
      if (!folders.has(group.category)) folders.set(group.category, []);
      folders.get(group.category).push(group);
    }
    index.querySelector('.index-count').textContent = String(visible.length);
    tree.innerHTML = '<button type="button" class="all-laws" data-law="">All laws</button>' + [...folders].map(([name, groups]) =>
      '<details data-category="' + esc(name) + '" ' + (closed.has(name) ? '' : 'open') + '><summary>' + esc(name) +
      '</summary><ul>' + groups.map(group => lawTreeItem(group, openEditions)).join('') + '</ul></details>').join('');
    drawCards();
  }
  tree.onclick = event => {
    const button = event.target.closest('[data-law]');
    if (!button) return;
    state.selected = button.dataset.law;
    state.edition = button.dataset.edition || '';
    drawCards();
    if (matchMedia('(max-width:760px)').matches) {
      index.open = false;
      count.focus({preventScroll:true});
    }
    if (count.getBoundingClientRect().top < 0 || !index.open) count.scrollIntoView({block:'start'});
  };
  cards.onclick = event => {
    if (!event.target.closest('[data-reset-law]')) return;
    input.value = ''; outcome.value = 'all'; filter(); input.focus();
  };
  input.oninput = filter;
  outcome.onchange = filter;
  filter();
  showNationalSuggestions(container, ctx.records || [], profile);
}

export function showNationalSuggestions(container,records,profile) {
  const target=container.querySelector('#boat-national-records');if(!target)return;
  const national=nationalCandidates(records,profile);
  target.innerHTML=national.length?'<details class="owner-card national-suggestions" '+(container.dataset.hasLaws==='false'?'open':'')+'><summary>National records mentioning this type of boat ('+national.length+')</summary><p>These titles and subjects match your flag and boat type. Verify their scope in the source.</p><div></div><button type="button" class="text-action" data-national-more>Show more records</button></details>':'';
  if(national.length){
    const group=target.querySelector('.national-suggestions'),more=group.querySelector('[data-national-more]');let limit=3;
    function drawNational(){
      group.querySelector('div').innerHTML=national.slice(0,limit).map(r=>'<article class="map-national"><a href="#library?'+esc(new URLSearchParams({doc:r.id}).toString())+'">'+esc(r.title)+'</a><p>'+esc([r.year,r.repealed?'Marked repealed':''].filter(Boolean).join(' · '))+'</p></article>').join('');
      more.hidden=limit>=national.length;
    }
    more.onclick=()=>{limit+=8;drawNational();};drawNational();
  }
}
