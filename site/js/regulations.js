import {esc,excerpt,fold,isoDay,queryParts} from './model.js';
import {boatControl,fieldName,readBoatValue,topic} from './boat-form.js';
import {groupedLaws,filteredLaws,lawCard,lawTreeItem} from './boat-results.js';
import {dateLabel,mountRevisionPicker,revisionDates} from './revision-picker.js';
import {sourceThresholds} from './source-thresholds.js';
import {sourceConditions} from './source-conditions.js';
import {encodeWording,findWording,readWording,sameWording,wordingControls,wordingResults} from './wording-filters.js';
import {resetPrintPreviews} from './boat-excerpts.js';

function collectKeys(rule, keys) {
  if(!rule)return;
  if(rule.field)keys.add(rule.field);
  else if(rule.not)collectKeys(rule.not,keys);
  else for(const child of rule.all||rule.any||[])collectKeys(child,keys);
}

export function filterFields(documents,fields,sourceFields={}) {
  const keys=new Set(Object.keys(sourceFields));
  for(const {sections,version} of documents){
    collectKeys(version.scopeChange?.when,keys);
    for(const derived of version.derivedFields||[])collectKeys(derived.when,keys);
    for(const section of sections){
      collectKeys(section.criteria,keys);collectKeys(section.confirmWhen,keys);
      for(const item of section.cases||[]){collectKeys(item.when,keys);collectKeys(item.confirmWhen,keys);}
    }
  }
  return fields.filter(f=>keys.has(f.key));
}

export function readFacets(params,fields){
  const values={};
  for(const field of fields){
    const value=params.get('f.'+field.key);
    if(!value)continue;
    if(field.options?.length&&!field.options.some(o=>String(o.value??o)===value))continue;
    if(field.type==='number'&&(!Number.isFinite(Number(value))||Number(value)<0))continue;
    if(field.type==='date'&&!/^\d{4}$/.test(value)&&!isoDay(value))continue;
    values[field.key]=field.type==='number'?Number(value):value;
  }
  return values;
}

export function renderRegulations(container,ctx){
  const {documents,params,countryName}=ctx,fields=filterFields(documents,ctx.fields,ctx.coverage?.fields);
  const core=['flag','shipType','grossTonnage','lengthOverall'];
  const values=readFacets(params,fields);
  const wording=readWording(params);
  const chosen=new Set([...core,...Object.keys(values)]);
  const groupsSelected=new Set(params.getAll('collection'));
  const state={includeUnspecified:params.has('unfiltered')?params.get('unfiltered')==='1':!Object.keys(values).length,
    selected:params.get('instrument')||'',edition:params.get('edition')||''};
  let asOf=isoDay(params.get('date'))||ctx.latest, laws=[], visible=[], shown=10;
  const narrow=matchMedia('(max-width:760px)').matches;
  container.innerHTML='<div class="law-workspace"><aside class="law-sidebar"><details class="facet-panel" '+(narrow?'':'open')+'><summary>Filters</summary>'+
    '<div class="facet-content"><div class="facet-fields"></div><div class="wording-fields"></div><details class="facet-chooser"><summary>Add a filter</summary><label>Find a condition<input type="search" class="facet-lookup"></label><div class="facet-options"></div></details>'+
    '<button type="button" class="date-picker-button" data-date></button><dialog class="revision-dialog"></dialog><details class="collection-filters"><summary>Collections</summary><div></div></details></div></details>'+
    '<details class="law-index" '+(narrow?'':'open')+'><summary><strong>Instrument index</strong><span class="index-count"></span></summary><nav class="law-tree" aria-label="Instruments by collection"></nav></details></aside>'+
    '<section class="law-stream" aria-label="Provisions"><div class="overview-filters"><label>Search provisions<input id="rule-query" type="search" placeholder="Wording, title or citation" maxlength="260"></label>'+
    '<label class="unfiltered-control"><input id="rule-broad" type="checkbox"><span>Show unfiltered content</span></label></div>'+
    '<div class="active-facets"></div><h2 class="excerpt-count" tabindex="-1" aria-live="polite"></h2><div class="source-cards"></div><div class="national-discovery" tabindex="-1"></div></section></div>';
  const el=s=>container.querySelector(s), fieldBox=el('.facet-fields'), tree=el('.law-tree'), cards=el('.source-cards');
  const input=el('#rule-query'), broad=el('#rule-broad'), date=el('[data-date]');
  input.value=params.get('q')||'';broad.checked=state.includeUnspecified;
  const categories=new Set(groupedLaws(documents,{values:{},asOf},countryName).map(g=>g.category));

  function sync(){
    const p=new URLSearchParams();
    for(const [key,value] of Object.entries(values))p.set('f.'+key,value);
    for(const f of wording)p.append('where',encodeWording(f));
    if(input.value)p.set('q',input.value);
    if(asOf!==ctx.latest)p.set('date',asOf);
    if(state.includeUnspecified!==!Object.keys(values).length)p.set('unfiltered',state.includeUnspecified?'1':'0');
    for(const category of groupsSelected)p.append('collection',category);
    if(state.selected)p.set('instrument',state.selected);
    if(state.edition)p.set('edition',state.edition);
    ctx.changed(p,{values,asOf});
  }
  function drawFields(){
    fieldBox.innerHTML=[...chosen].map(key=>fields.find(f=>f.key===key)).filter(Boolean).map(f=>boatControl(f,values[f.key])).join('');
    wordingControls(el('.wording-fields'),wording,ctx.lookup);
    drawChoices();
  }
  function selectWording(fact){
    if(!wording.some(f=>sameWording(f,fact)))wording.push(fact);
    state.selected='';state.edition='';groupsSelected.clear();collectionOptions();
    input.value='';el('.facet-chooser').open=false;drawFields();update(false);
    el('.wording-field:last-child select')?.focus();
  }
  function drawChoices(){
    const pattern=fold(el('.facet-lookup').value), matching=fields.filter(f=>!chosen.has(f.key)&&fold(fieldName(f)+' '+topic(f)).includes(pattern));
    const grouped=Map.groupBy(matching,topic);
    el('.facet-options').innerHTML=[...grouped].map(([group,list])=>'<details '+(pattern?'open':'')+'><summary>'+esc(group)+' <small>'+list.length+'</small></summary>'+list.map(f=>'<button type="button" data-add="'+esc(f.key)+'">'+esc(fieldName(f))+'</button>').join('')+'</details>').join('')||'<p>No matching conditions.</p>';
    if(pattern.length>=3){
      const holder=document.createElement('div'),button=document.createElement('button');button.type='button';button.className='text-action';button.textContent='Search published wording';
      if(!ctx.ready||!Object.keys(ctx.conditionCollections||{}).length){
        button.disabled=true;button.textContent=ctx.ready?'Published wording unavailable':'Loading published wording…';
      }
      button.onclick=()=>findWording(holder,{query:el('.facet-lookup').value,flag:values.flag,collections:ctx.conditionCollections||{},date:asOf,lookup:ctx.lookup,select:selectWording});
      holder.append(button);el('.facet-options').prepend(holder);
    }
  }
  function collectionOptions(){
    el('.collection-filters div').innerHTML=[...new Set([...categories,...groupsSelected])].sort().map(name=>'<label><input type="checkbox" value="'+esc(name)+'" '+(groupsSelected.has(name)?'checked':'')+'> '+esc(name)+'</label>').join('');
  }
  function drawChips(){
    const tags=Object.entries(values).map(([key,value])=>{
      const f=fields.find(item=>item.key===key), option=f?.options?.find(o=>String(o.value??o)===String(value));
      return ['f.'+key,fieldName(f)+' · '+(option?.label||value)+(f.unit?' '+f.unit:'')];
    });
    for(const group of groupsSelected)tags.push(['c.'+group,group]);
    for(const [i,f] of wording.entries())tags.push(['w.'+i,excerpt(f.wording,[],56)+' · '+(f.value==='yes'?'Yes':'No')]);
    if(asOf!==ctx.latest)tags.push(['date',dateLabel(asOf)]);
    el('.active-facets').innerHTML=tags.map(([key,label])=>'<button type="button" data-clear="'+esc(key)+'" aria-label="Remove '+esc(label)+'">'+esc(label)+' ×</button>').join('')+
      (tags.length?'<button type="button" class="text-action" data-reset>Clear all</button>':'');
  }
  function drawCards(){
    resetPrintPreviews();
    if(wording.length){
      el('.excerpt-count').textContent='Selected source wording';
      wordingResults(cards,{facts:wording,values,includeUnspecified:broad.checked,collections:ctx.conditionCollections||{},lookup:ctx.lookup,date:asOf,query:input.value,selected:state.selected,
        onCount:n=>{el('.excerpt-count').textContent=n.toLocaleString()+' source passage'+(n===1?'':'s');}});
      for(const b of tree.querySelectorAll('[data-law]'))b.setAttribute('aria-current',String(b.dataset.law===state.selected));
      return;
    }
    let groups=state.selected?visible.filter(g=>g.id===state.selected):visible;
    if(state.edition)groups=groups.map(g=>({...g,sections:g.sections.filter(r=>r.doc.key===state.edition)}));
    const count=groups.reduce((sum,g)=>sum+g.sections.length,0);
    el('.excerpt-count').textContent=count.toLocaleString()+' provision'+(count===1?'':'s')+' · '+(state.selected?groups[0]?.title||'':groups.length+' instrument'+(groups.length===1?'':'s'));
    cards.replaceChildren(...groups.slice(0,shown).map(g=>lawCard(g,{state,fields},input.value,Boolean(state.selected))));
    if(groups.length>shown){const button=document.createElement('button');button.textContent='Show more instruments';button.onclick=()=>{shown+=10;drawCards();};cards.append(button);}
    if(!groups.length)cards.innerHTML='<div class="overview-empty"><h3>No matching provisions</h3>'+(!broad.checked?'<button type="button" data-broaden>Include unspecified conditions</button>':'<button type="button" data-reset>Clear filters</button>')+'</div>';
    for(const b of tree.querySelectorAll('[data-law]'))b.setAttribute('aria-current',String(b.dataset.law===state.selected&&(b.dataset.edition||'')===state.edition));
  }
  function national(){
    const host=el('.national-discovery');host.replaceChildren();
    const shortcut=tree.querySelector('[data-source-search]');
    if(shortcut)shortcut.hidden=true;
    if(wording.length||!broad.checked||groupsSelected.size||state.selected)return;
    sourceThresholds(host,{coverage:ctx.coverage,fields,values:{...values},query:input.value,asOf,lookup:ctx.lookup});
    sourceConditions(host,{collections:ctx.conditionCollections,values:{...values},query:input.value,asOf,lookup:ctx.lookup,countryName,selectWording});
    const terms=queryParts(input.value);
    const matches=ctx.records.filter(r=>(!values.flag||r.codes.includes(values.flag))&&(!r.year||Number(r.year)<=Number(asOf.slice(0,4)))&&(!isoDay(r.issuedDate)||r.issuedDate<=asOf)&&terms.every(t=>fold(r.searchText).includes(t)));
    if(shortcut)shortcut.hidden=!host.children.length&&!matches.length;
    if(!matches.length)return;
    const detail=document.createElement('details');
    const label=document.createElement('summary');label.textContent='National source records'+(values.flag?' · '+countryName(values.flag):'')+' · '+matches.length.toLocaleString();detail.append(label);
    detail.ontoggle=()=>{
      if(!detail.open||detail.children.length>1)return;
      const p=new URLSearchParams({source:'world'});if(input.value)p.set('q',input.value);if(values.flag)p.set('country',values.flag);
      const div=document.createElement('div');div.innerHTML='<p>Applicability requires reading the source. Catalogue entries are searchable in the Library.</p>'+
        matches.slice(0,6).map(r=>'<a href="#library?'+esc(new URLSearchParams({doc:r.id}).toString())+'">'+esc(r.title)+'</a>').join('')+
        '<a href="#library?'+esc(p.toString())+'">Browse collection in Library</a>';detail.append(div);
    };host.append(detail);
  }
  function update(recompute=true){
    if(recompute)laws=groupedLaws(documents,{values,asOf},countryName);
    state.includeUnspecified=broad.checked;
    el('.collection-filters').hidden=Boolean(wording.length);
    if(wording.length){
      const docs=[...new Set(wording.map(f=>f.doc))];
      if(!docs.includes(state.selected))state.selected='';
      tree.innerHTML='<button type="button" data-law="" class="all-laws">All selected instruments</button>'+docs.map(id=>'<button type="button" data-law="'+esc(id)+'">'+esc(ctx.lookup(id)?.title||id)+'</button>').join('');
      el('.index-count').textContent=docs.length;date.textContent='Editions · '+dateLabel(asOf);
      drawChips();drawCards();national();sync();return;
    }
    visible=filteredLaws(laws,queryParts(input.value)).flatMap(g=>{
      if(groupsSelected.size&&!groupsSelected.has(g.category))return [];
      const sections=broad.checked?g.sections:g.sections.filter(r=>r.state==='match');
      return sections.length?[{...g,sections}]:[];
    });
    const selected=visible.find(g=>g.id===state.selected);
    if(!selected)state.selected='';
    if(!selected?.sections.some(r=>r.doc.key===state.edition))state.edition='';
    const closed=new Set([...tree.querySelectorAll('[data-category]:not([open])')].map(n=>n.dataset.category));
    const editions=new Set([...tree.querySelectorAll('[data-editions][open]')].map(n=>n.dataset.editions));if(state.edition)editions.add(state.selected);
    tree.innerHTML='<button type="button" data-law="" class="all-laws">All instruments</button>'+[...Map.groupBy(visible,g=>g.category)].map(([name,groups])=>'<details data-category="'+esc(name)+'" '+(closed.has(name)?'':'open')+'><summary>'+esc(name)+'</summary><ul>'+groups.map(g=>lawTreeItem(g,editions)).join('')+'</ul></details>').join('');
    const sourceShortcut=document.createElement('button');sourceShortcut.type='button';sourceShortcut.dataset.sourceSearch='';sourceShortcut.textContent='Additional source texts';tree.append(sourceShortcut);
    el('.index-count').textContent=visible.length;date.textContent='Editions · '+dateLabel(asOf);shown=10;drawChips();drawCards();national();sync();
  }
  const picker=mountRevisionPicker(el('dialog'),{flagName:()=>countryName(values.flag),getRevisions:()=>revisionDates(documents,values,ctx.editions(values)),latestDay:()=>ctx.latest,onChoose:day=>{asOf=day;update();}});
  date.onclick=()=>picker.open(asOf);
  el('.facet-lookup').oninput=drawChoices;
  el('.wording-fields').onchange=e=>{const f=wording[Number(e.target.dataset.wording)];if(f){f.value=e.target.value;update(false);}};
  fieldBox.oninput=e=>e.target.setCustomValidity?.('');
  fieldBox.onchange=e=>{
    const f=fields.find(f=>f.key===e.target.name);if(!f)return;
    const r=readBoatValue(e.target,f);if(!r.valid||!e.target.reportValidity())return;
    if(r.value===undefined)delete values[f.key];else values[f.key]=r.value;
    update();
  };
  el('.collection-filters').onchange=e=>{if(e.target.checked)groupsSelected.add(e.target.value);else groupsSelected.delete(e.target.value);update(false);};
  container.onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-add')){chosen.add(b.dataset.add);drawFields();el('.facet-chooser').open=false;fieldBox.querySelector('[name="'+CSS.escape(b.dataset.add)+'"]').focus();}
    if(b.hasAttribute('data-clear')){
      const key=b.dataset.clear;
      if(key==='date')asOf=ctx.latest;else if(key.startsWith('w.'))wording.splice(Number(key.slice(2)),1);else if(key.startsWith('c.'))groupsSelected.delete(key.slice(2));else{delete values[key.slice(2)];if(!core.includes(key.slice(2)))chosen.delete(key.slice(2));}
      drawFields();collectionOptions();update();
    }
    if(b.hasAttribute('data-reset')){for(const k of Object.keys(values))delete values[k];chosen.clear();core.forEach(k=>chosen.add(k));wording.length=0;groupsSelected.clear();input.value='';asOf=ctx.latest;broad.checked=true;state.selected='';state.edition='';drawFields();collectionOptions();update();}
    if(b.hasAttribute('data-broaden')){broad.checked=true;update(false);}
    if(b.hasAttribute('data-source-search')){
      const host=el('.national-discovery'),first=host.querySelector('details');if(!first)return;
      if(narrow)el('.law-index').open=false;first.open=true;host.scrollIntoView({block:'start'});first.querySelector('summary').focus({preventScroll:true});
    }
    if(b.hasAttribute('data-law')){state.selected=b.dataset.law;state.edition=b.dataset.edition||'';drawCards();national();sync();if(narrow){el('.law-index').open=false;el('.excerpt-count').focus();}}
  };
  input.oninput=()=>update(false);broad.onchange=()=>update(false);
  drawFields();collectionOptions();update();
  return {updateRecords(records,collections){
    ctx.records=records;ctx.conditionCollections=collections;ctx.ready=true;picker.refresh();
    if(wording.length){drawFields();update(false);}else{drawChoices();national();}
  }};
}
