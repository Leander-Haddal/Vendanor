import {esc,marked,folioRows,mergeInstruments,statusLabel} from './model.js';
import {readJson,dataUrl,readShard,archiveSections,archiveKind} from './archive.js';
import {listImports,importToFolio} from './imports.js';
import {readProfile,collectFields,saveProfile} from './profile.js';
import {renderBoatForm,today} from './boat-form.js';
import {renderBoatResults,showNationalSuggestions} from './boat-results.js';
import {renderBoatPassage} from './boat-reader.js';
import {listBoats,rememberBoat,savedBoat,selectedBoat,selectSavedBoat,forgetBoat,renderFleet} from './fleet.js';
import {renderLawMap,nationalLaws} from './law-map.js';
import {resolveEdition,loadUkEdition} from './uk-editions.js';
import {renderReader,releasePreview} from './reader.js';
import {renderChanges} from './changes.js';
import {renderSources} from './sources.js';
import {createDocumentWorkspace} from './documents.js';
import {countryCode,jurisdictionDesk} from './jurisdictions.js';
import {collections} from './collections.js';

const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./search-worker.js',import.meta.url),{type:'module'});
const filters={q:'q',source:'source-filter',country:'country-filter',year:'year-filter',match:'match-filter'};
const defaults={q:'',source:'all',country:'',year:'',match:'candidate'};
let catalogues=[],gazette={records:[]},originals={records:{}},imports=[],fields=[],byKey=new Map(),byEdition=new Map(),archive=new Map();
let countries=[],worldBook={records:[]},world=new Map(),worldLoading=true;
let flagSources={flags:[]},ukHistory={records:[]},euHistory={records:[]},imoHistory={instruments:[]},failedCollections=[],boatFormActive=false,ownerPage='',lastOwnerHash='';
let registryBook={entries:[]},earlyFields=[],fieldReleaseDay='',pendingDefinition;
const historyLoads=new Map();
let boatResultSignature='',resultScroll=0,returnPassage='';
const views=['boat','boat-results','boat-passage','boats','map','documents','library','changes','sources','jurisdictions'];
let profile=readProfile(),rows=[],readerMode='text',loaded=false,limit=40,ticket=0,routeTurn=0,prefill,storageError='',lastQuery='',lastReader='',noticeTimer,within='',withinDoc='';
let boatRecord=selectedBoat();
if(boatRecord)profile=boatRecord.profile;
let draft;
let publicStart;
const documentWorkspace=createDocumentWorkspace($('documents-view'),()=>publicStart && refreshImports());

function referenceDay() {
  const now=today(),latest=catalogues.map(c=>c.checkedAt).filter(Boolean).sort().at(-1)||fieldReleaseDay;
  return latest&&latest<now?latest:now;
}
function currentDraft() {
  return {id:boatRecord?.id||'',name:boatRecord?.name||'',identifier:boatRecord?.identifier||'',remember:Boolean(boatRecord?.id),
    lookup:boatRecord?.lookup||null,profile:{values:{...profile.values},asOf:profile.asOf||referenceDay()}};
}
function countryName(code) {return countries.find(c=>c.code===code)?.name||code||'';}
function applyBoat(state) {
  if(state.remember)boatRecord=rememberBoat(state);
  else {selectSavedBoat();boatRecord={name:state.name,identifier:state.identifier,lookup:state.lookup};}
  profile=state.profile;saveProfile(profile);draft=null;boatFormActive=false;
  lastReader='';lastQuery='';returnPassage='';profileSummary();navigate('boat-results');
  if(!loaded&&$('boat-form-status'))$('boat-form-status').textContent='Opening the source passages for your boat…';
}
function useBoat(id,edit) {
  const row=savedBoat(id);if(!row)return;
  selectSavedBoat(id);boatRecord=row;profile=row.profile;saveProfile(profile);draft=null;boatFormActive=false;
  lastReader='';lastQuery='';profileSummary();navigate(edit?'boat':'boat-results');
}

function route() {
  const [name,query='']=location.hash.slice(1).split('?');
  return {view:views.includes(name)?name:'boat',params:new URLSearchParams(query)};
}
function navigate(view,values={},replace=false) {
  const params=new URLSearchParams(values);
  for(const key of [...params.keys()])if(!params.get(key))params.delete(key);
  const hash='#'+view+(params.size?'?'+params.toString():'');
  if(hash!==location.hash)history[replace?'replaceState':'pushState'](null,'',hash);
  drawRoute();
}
function notify(message) {
  clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').hidden=false;
  noticeTimer=setTimeout(()=>{$('notice').hidden=true;},6000);
}
function select(doc,section,focus=false) {
  const {view,params}=route();
  const values=view==='library'?params:new URLSearchParams();
  values.set('doc',doc);
  if(section)values.set('section',section);else values.delete('section');
  navigate('library',values);
  if(focus&&matchMedia('(max-width:760px)').matches)$('reader').scrollIntoView({block:'start'});
}
function setFlagChoices() {
  const flag=fields.find(f=>f.key==='flag');
  if(flag&&countries.length)flag.options=[...countries.map(c=>({value:c.code,label:c.name})),{value:'other',label:'Another flag state (unspecified)'}];
}
function rebuild() {
  const publicFields=collectFields(catalogues,[]);
  const local=imports.map(doc=>importToFolio(doc,publicFields));
  const instruments=mergeInstruments(catalogues.flatMap(c=>c.instruments),local);
  fields=collectFields([...catalogues,{fields:earlyFields.filter(f=>['flag','shipType'].includes(f.key))}],local);byKey=new Map();byEdition=new Map();
  setFlagChoices();
  for(const instrument of instruments)for(const version of instrument.versions){
    const key=instrument.key+'|'+version.id;
    byKey.set(key,{key,instrument,version,sections:version.sections,type:instrument.local?'local':'folio'});
    byEdition.set(version.id,key);
  }
  archive=new Map(gazette.records.map(r=>[r.id,r]));
  world=new Map(worldBook.records.map(raw=>{
    const country=countryCode(raw.country,countries)||'FAO:'+raw.countryName,id='world:'+raw.id,topics=Array.isArray(raw.topics)?raw.topics.join(' · '):raw.topics||'';
    const preview=[raw.countryName,topics,raw.kind].filter(Boolean).join(' · ');
    const codes=(raw.countries||[]).map(c=>countryCode(c.code,countries)||'FAO:'+c.name);
    if(!codes.includes(country))codes.push(country);
    return [id,{...raw,id,country,codes,preview,searchText:[raw.id,raw.title,raw.originalTitle,codes.join(' '),(raw.countries||[]).map(c=>c.name).join(' '),raw.countryName,topics,raw.year,raw.kind,(raw.languages||[]).join(' '),raw.publisher].filter(Boolean).join(' ')}];
  }));
  const folios=folioRows(instruments);
  worker.postMessage({type:'init',folios,records:gazette.records,searchIndex:gazette.searchIndex,world:[...world.values()].map(({id,country,codes,title,searchText,preview,year})=>({id,country,codes,title,searchText,preview,year}))});lastQuery='';lastReader='';
  const years=new Set([...folios.map(r=>r.date),...gazette.records.map(r=>r.publishedDate||r.date),...[...world.values()].map(r=>r.year)].filter(Boolean).map(d=>String(d).slice(0,4)));
  const options=new Map(countries.map(c=>[c.code,c.name]));
  for(const r of world.values())for(const v of r.countries||[]){const code=v.code||'FAO:'+v.name;if(!options.has(code))options.set(code,v.name);}
  for(const r of folios)if(r.jurisdiction&&!options.has(r.jurisdiction))options.set(r.jurisdiction,r.jurisdiction==='EU'?'European Union':r.jurisdiction);
  $('country-filter').innerHTML='<option value="">All jurisdictions</option>'+[...options].sort((a,b)=>a[1].localeCompare(b[1])).map(([k,n])=>'<option value="'+esc(k)+'">'+esc(n)+'</option>').join('');
  $('year-filter').innerHTML='<option value="">All years</option>'+[...years].sort().reverse().map(y=>'<option>'+esc(y)+'</option>').join('');
  const checked=new Set(catalogues.flatMap(c=>c.instruments.flatMap(i=>i.versions.flatMap(v=>v.sections.map(s=>s.clip).filter(Boolean))))).size;
  $('scope-line').textContent=checked.toLocaleString('en')+' distinct mapped passage PDFs · '+gazette.records.length.toLocaleString('en')+' Norwegian archive records · '+(worldLoading?'Loading national catalogue…':world.size.toLocaleString('en')+' national catalogue records');
  $('coverage-brief').hidden=!gazette.coverage?.snapshotDate;
  $('coverage-brief').textContent='Archive snapshot '+(gazette.coverage?.snapshotDate||'');
  profileSummary();
}
async function refreshImports() {
  try{imports=await listImports();storageError='';}catch{imports=[];storageError='Local document storage is unavailable in this browser session.';}
  if(loaded)rebuild();
}
function profileSummary() {
  const active=fields.filter(f=>profile.values[f.key]!==undefined),count=active.length+(profile.asOf?1:0);
  const strip=$('profile-strip');strip.hidden=!count;
  strip.textContent=[profile.asOf?'Law as of '+profile.asOf:'',...active.map(f=>{
    const value=profile.values[f.key],opt=f.options?.find(o=>(o.value??o)===value);
    return f.label+' '+(opt?.label||value)+(f.unit?' '+f.unit:'');
  })].filter(Boolean).join(' · ');
  if(countries.some(c=>c.code===profile.values.flag)){
    const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='Flag-state sources';
    button.onclick=()=>navigate('jurisdictions',{country:profile.values.flag});strip.append(' ',button);
  }
  if(profile.values.lastSurveyDate){const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent='Norwegian cargo survey provision';button.onclick=()=>select(byEdition.get('no-cargo-2025'),'s149',true);strip.append(' ',button);}
}
async function getDoc(key) {
  if(byKey.has(key))return byKey.get(key);
  if(key?.startsWith('uk-edition:'))return loadUkEdition(key,ukHistory.records);
  if(world.has(key)){
    const r=world.get(key),sections=[{id:'catalogue',number:'Catalogue description',text:[r.title,r.originalTitle!==r.title?r.originalTitle:'',r.preview,r.issuedDate?'Instrument date '+r.issuedDate:'',r.amendedDate?'Recorded amendment '+r.amendedDate:'',r.repealed?'FAOLEX marks this instrument as repealed.':'',r.notes].filter(Boolean).join('\n\n'),caveat:'National catalogue metadata. The source document supplies the legal wording, scope and amendments.'}];
    return {key,type:'world',sections,instrument:{title:r.title,jurisdiction:r.countryName||r.country,authority:r.publisher||worldBook.source?.name,language:(r.languages||[]).join(', ')},
      version:{id:key,label:[r.kind||'National legislation',r.year].filter(Boolean).join(' · '),sourceUrl:r.sourceUrl,pdfUrl:r.pdfUrl,sourceLinks:[...(r.sourceWebsites||[]),...(r.documentUrls||[]),...(r.textUrls||[])].filter(s=>/^https?:\/\//i.test(s)),sections,
        notes:['Linked national record from '+(worldBook.source?.name||'the public catalogue')+'. Its source year is the year supplied by the catalogue. Verify the edition and current status with the issuing authority.']}};
  }
  const meta=archive.get(key);if(!meta)return null;
  const record=(await readShard(meta.shard)).get(key);
  if(!record)throw new Error('The edition is missing from its indexed file.');
  const original=originals.records?.[key], sections=archiveSections(record);
  if(original?.sourceShard===meta.shard)sections.forEach((s,i)=>{
    const bands=original.sections?.[i];if(bands?.length){s.bands=bands;s.pages=bands.map(b=>b.page);}
  });
  const officialDate=meta.publishedDate||'';
  const notes=[meta.kind==='consolidated'?'Consolidated wording at the archive snapshot. The instrument date is '+meta.date+'.':'As-published Gazette wording. An amendment gives instructions for changing another instrument.'];
  if(meta.omittedAppendices?.length||Number(meta.omittedAppendices)>0)notes.push('The publisher supplies additional appendix material outside the extracted text.');
  return {key,type:'archive',meta,original,sections,instrument:{title:meta.title,jurisdiction:'NO',authority:'Lovdata',language:'nb'},
    version:{id:key,label:archiveKind(meta)+' · '+meta.legalId,publishedOn:officialDate,sourceUrl:meta.sourceUrl,
      pdf:original?.asset,pdfSha256:original?.sha256,pdfUrl:meta.pdfUrl,notes,sections}};
}
function choices() {
  const mapped=[...byKey.values()].map(d=>({key:d.key,label:[d.instrument.shortTitle||d.instrument.title,d.version.label,d.version.publishedOn,d.instrument.id].filter(Boolean).join(' · ')}));
  const params=route().params,uk=[];
  for(const key of new Set([params.get('before'),params.get('after')])){
    const edition=resolveEdition(key,ukHistory.records);if(edition)uk.push({key,label:edition.record.title+' · '+edition.version.label});
  }
  return [...mapped,...uk,...gazette.records.map(r=>({key:r.id,label:[r.legalId,archiveKind(r),r.title].join(' · ')}))];
}
function presets() {
  return catalogues.flatMap(c=>c.comparisons||[]).map(p=>({...p,before:byEdition.get(p.before.versionId),after:byEdition.get(p.after.versionId),
    leftSection:p.before.sectionId,rightSection:p.after.sectionId})).filter(p=>p.before&&p.after);
}
function related(doc) {
  if(doc.type==='world'||doc.type==='uk')return [];
  const ids=new Set([doc.instrument.id,doc.meta?.legalId,...(doc.meta?.targets||[])].filter(Boolean));
  const keys=new Set();
  for(const d of byKey.values())if(ids.has(d.instrument.id))keys.add(d.key);
  for(const r of gazette.records)if(ids.has(r.legalId)||r.targets?.some(t=>ids.has(t)))keys.add(r.id);
  for(const p of presets()){if(p.before===doc.key)keys.add(p.after);if(p.after===doc.key)keys.add(p.before);}
  return choices().filter(c=>keys.has(c.key)&&c.key!==doc.key);
}
function treatyEditions(doc,section) {
  if(!doc.instrument.flagState||!section?.clip)return [];
  return [...byKey.values()].filter(d=>d.version.pdf===doc.version.pdf&&d.sections.some(s=>s.clip===section.clip)).map(d=>({
    key:d.key,label:[countryName(d.instrument.flagState),d.version.effectiveFrom?'from '+d.version.effectiveFrom:'',d.version.effectiveTo?'until '+d.version.effectiveTo:''].filter(Boolean).join(' · ')
  })).sort((a,b)=>a.label.localeCompare(b.label));
}
function openLocal(doc) {
  const key=byEdition.get('local-'+doc.id);if(key)select(key,doc.sections[0]?.key);
}
function openBoatDefinition(source) {
  if(!loaded){pendingDefinition=source;if($('boat-form-status'))$('boat-form-status').textContent='Opening the source provision…';return;}
  const cited=byKey.get(byEdition.get(source.versionId));
  if(!cited){notify('The cited source is unavailable.');return;}
  const flag=draft?.profile.values.flag,section=cited.sections.find(s=>s.id===source.sectionId);
  const local=cited.instrument.flagState&&flag?[...byKey.values()].find(d=>d.instrument.flagState===flag&&d.version.pdf===cited.version.pdf&&d.sections.some(s=>s.id===section?.id&&s.text===section.text)):null;
  navigate('boat-passage',{doc:(local||cited).key,section:source.sectionId,from:'boat'});
}
function openBoatForm() {
  boatFormActive=true;draft??=currentDraft();
  renderBoatForm($('boat-view'),{fields,draft,onDraft:value=>{draft=value;},onSearch:applyBoat,onSource:openBoatDefinition});
}

async function loadEditionIndexes(view,params) {
  const code=params.get('country')??profile.values.flag,needed=[];
  const ukRoute=['before','after','doc'].some(key=>params.get(key)?.startsWith('uk-edition:'));
  if(view==='sources'||(view==='map'&&code==='GB')||ukRoute)needed.push('uk');
  if(view==='sources'||(view==='map'&&code==='EU'))needed.push('eu');
  await Promise.all(needed.map(key=>{
    if(!historyLoads.has(key)){
      const request=readJson(dataUrl(key+'-history.json')).then(book=>{
        if(key==='uk')ukHistory=book;else euHistory=book;
      }).catch(()=>{
        historyLoads.delete(key);notify('The '+key.toUpperCase()+' edition index could not be loaded. Reopen the law map to retry.');
      });
      historyLoads.set(key,request);
    }
    return historyLoads.get(key);
  }));
}
function search(params) {
  const values={};
  for(const [key,id] of Object.entries(filters)){
    const control=$(id),wanted=params.get(key)||defaults[key];
    if(key==='q'&&debounce){values[key]=wanted;continue;}
    if(control.value!==wanted)control.value=wanted;
    if(control.value!==wanted)control.value=defaults[key];
    values[key]=control.value;
  }
  const query=JSON.stringify([values,profile,limit]);
  if(query===lastQuery)return;
  lastQuery=query;rows=[];$('result-list').replaceChildren();$('result-count').textContent='';$('more-results').hidden=true;
  $('search-status').textContent='Searching…';
  worker.postMessage({type:'search',ticket:++ticket,...values,limit,profile:profile.values,asOf:profile.asOf});
}
function resultSelection() {
  const {params}=route(),auto=automaticHit(params),key=params.get('doc')||auto?.doc||byEdition.get('no-cargo-2025'),id=params.get('section')||auto?.sectionId||'s1';
  for(const button of $('result-list').querySelectorAll('[data-row]')){
    const r=rows[Number(button.dataset.row)],active=r.doc===key&&(!r.sectionId||r.sectionId===id);
    button.classList.toggle('selected',active);button.setAttribute('aria-current',String(active));
  }
}
function filtered(params) {
  return [...Object.keys(filters)].some(k=>params.has(k))||Object.keys(profile.values).length||profile.asOf;
}
function automaticHit(params) {return !params.has('doc')&&filtered(params)?rows[0]:null;}
worker.onmessage=event=>{
  const message=event.data;
  if(message.ticket!==ticket||route().view!=='library')return;
  if(message.type==='error'){$('search-status').textContent='The search file could not be read. Reload to retry.';return;}
  if(message.type!=='results')return;
  const q=$('q').value;rows=message.rows;
  $('result-count').textContent=message.total.toLocaleString('en');
  $('search-status').textContent=message.errors?'Some archive files were unavailable. Results are partial.':message.progress||(!rows.length?'No results for these filters.':'');
  $('more-results').hidden=rows.length>=message.total;
  $('result-list').innerHTML=rows.map((r,i)=>'<button class="result" data-row="'+i+'"><span class="result-top">'+esc([r.date,r.type==='archive'?r.subtitle:r.type==='local'?'My import':r.jurisdiction].filter(Boolean).join(' · '))+'</span><strong>'+marked(r.heading||r.title,q)+'</strong><span class="result-sub">'+esc(r.title)+'</span><span class="snippet">'+marked(r.preview,q)+'</span>'+(Object.keys(profile.values).length||profile.asOf?'<span class="small">'+esc(statusLabel(r.state))+'</span>':'')+'</button>').join('');
  resultSelection();
  if(!route().params.has('doc')&&filtered(route().params))drawRoute();
};
worker.onerror=()=>{$('search-status').textContent='The local search worker could not start. Reload this page to retry.';};

function showView(view) {
  for(const name of views)$(name+'-view').hidden=view!==name;
  for(const nav of document.querySelectorAll('[data-view]'))nav.setAttribute('aria-current',(nav.dataset.view===view||(nav.dataset.view==='boat'&&view.startsWith('boat-')))?'page':'false');
  $('research-menu').open=false;
}
async function drawRoute() {
  const {view,params}=route(),turn=++routeTurn;
  if(!loaded&&view!=='documents'){
    if(ownerPage==='documents'){documentWorkspace.close();ownerPage='';showView('boat');}
    publicStart??=start().catch(error=>{
      publicStart=undefined;
      $('scope-line').textContent='The library could not start.';
      $('boat-view').querySelector('[role=status]')?.replaceChildren(error.message);
      $('reader').textContent=error.message;
    });
    return;
  }
  const previous=ownerPage,entered=ownerPage!==view||lastOwnerHash!==location.hash;
  ownerPage=view;lastOwnerHash=location.hash;
  showView(view);
  if(previous==='documents'&&view!=='documents')documentWorkspace.close();
  if(view==='documents'){
    if(previous!=='documents'){
      boatFormActive=false;releasePreview();lastReader='';lastQuery='';
      window.scrollTo(0,0);$('documents-view').querySelector('h1').focus({preventScroll:true});
      await documentWorkspace.open();
    }
    return;
  }
  if(['map','sources','library','boat-passage','changes'].includes(view)){
    await loadEditionIndexes(view,params);if(turn!==routeTurn)return;
  }
  if(view!=='boat')boatFormActive=false;
  if(view!=='library'){releasePreview();lastReader='';lastQuery='';}
  if(view==='boat'){
    if(boatFormActive)return;
    openBoatForm();
  }else if(view==='boats'){
    renderFleet($('boats-view'),{boats:listBoats(),countryName,onNew:()=>{
      draft={name:'',identifier:'',remember:true,profile:{values:{},asOf:referenceDay()}};navigate('boat');
    },onOpen:id=>useBoat(id,false),onEdit:id=>useBoat(id,true),onRemove:id=>{
      forgetBoat(id);if(boatRecord?.id===id){boatRecord=null;profile={values:{},asOf:''};saveProfile(profile);draft=null;profileSummary();}drawRoute();
    }});
  }else if(view==='boat-results'){
    if(!profile.values.flag||!profile.values.shipType){navigate('boat',{},true);return;}
    const signature=JSON.stringify([profile,boatRecord?.name,boatRecord?.lookup,[...byKey.keys()]]);
    if(boatResultSignature!==signature){boatResultSignature=signature;renderBoatResults($('boat-results-view'),{profile,fields,name:boatRecord?.name,lookup:boatRecord?.lookup,imo:imoHistory,guides:registryBook,documents:[...byKey.values()],countryName,records:[...world.values()],failedCollections,
      onEdit:()=>{draft=currentDraft();navigate('boat');},onRead:(doc,section)=>navigate('boat-passage',{doc,section}),
      onRefine:changes=>{const state=currentDraft();Object.assign(state.profile.values,changes);applyBoat(state);}});}
    if(previous==='boat-passage'&&returnPassage){
      window.scrollTo(0,resultScroll);
      [...$('boat-results-view').querySelectorAll('[data-read-passage]')].find(b=>b.dataset.doc+'|'+b.dataset.section===returnPassage)?.focus({preventScroll:true});return;
    }
  }else if(view==='boat-passage'){
    if(previous==='boat-results'){resultScroll=window.scrollY;returnPassage=params.get('doc')+'|'+params.get('section');}
    let doc;
    try{doc=await getDoc(params.get('doc'));}catch{/* Show the unavailable passage with a route back below. */}
    if(turn!==routeTurn)return;
    const section=doc?.sections.find(s=>s.id===params.get('section'));
    if(!doc||!section){$('boat-passage-view').innerHTML='<h1>Passage unavailable</h1><a href="#boat">Back to boat search</a>';return;}
    renderBoatPassage($('boat-passage-view'),{doc,section,fields,profile,onBack:()=>navigate(params.get('from')==='boat'?'boat':'boat-results'),onLibrary:()=>select(doc.key,section.id)});
  }else if(view==='map'){
    renderLawMap($('map-view'),{countries,flags:flagSources,guides:registryBook,records:[...world.values()],documents:[...byKey.values()],params,uk:ukHistory,eu:euHistory,imo:imoHistory,flag:profile.values.flag,navigate});
  }
  if(['boat','boat-results','boat-passage','boats','map'].includes(view)){
    if(entered&&view==='map'&&params.get('convention')){
      const heading=$('map-international')?.querySelector('h3');if(heading){heading.tabIndex=-1;heading.focus();heading.scrollIntoView({block:'start'});return;}
    }
    if(entered && location.hash){window.scrollTo(0,0);$(view+'-view').querySelector('h1')?.focus({preventScroll:true});}
    return;
  }
  if(view==='sources'){
    renderSources($('sources-view'),{catalogues,gazette,originals,worldBook,uk:ukHistory,eu:euHistory,imo:imoHistory,imports,storageError,prefill,refreshImports,openLocal,notify,redraw:drawRoute});prefill=undefined;return;
  }
  if(view==='jurisdictions'){jurisdictionDesk($('jurisdictions-view'),{countries,records:[...world.values()],params,navigate,scopeCountry:profile.values.flag});return;}
  if(view==='changes'){await renderChanges($('changes-view'),{params,choices,presets,getDoc,navigate});return;}
  search(params);resultSelection();
  const auto=automaticHit(params);
  if(!params.has('doc')&&filtered(params)&&!auto){releasePreview();lastReader='';$('reader').innerHTML='<div class="empty"><h2>Select a result</h2><p>The reader follows your search and vessel filters.</p></div>';return;}
  const key=params.get('doc')||auto?.doc||byEdition.get('no-cargo-2025')||byKey.keys().next().value||gazette.records[0]?.id;
  const section=params.get('section')||auto?.sectionId||'',signature=JSON.stringify([key,section,params.get('q'),profile]);
  if(lastReader===signature)return;
  try{
    const doc=await getDoc(key);if(turn!==routeTurn)return;
    if(!doc)throw new Error('This edition is unavailable. Private editions are available on the device where they were imported.');
    lastReader=signature;if(withinDoc!==key){within='';withinDoc=key;}
    renderReader($('reader'),doc,section,{profile,fields,query:params.get('q')||'',mode:readerMode,setMode:value=>{readerMode=value;},
      within,setWithin:value=>{within=value;},related,treatyEditions,select,notify,compare:async(a,b)=>{
        const [left,right]=await Promise.all([getDoc(a),getDoc(b)]);
        if((left.version.publishedOn||'')>(right.version.publishedOn||''))[a,b]=[b,a];
        navigate('changes',{before:a,after:b});
      },importFor:d=>{
        prefill={title:d.instrument.title,authority:d.instrument.authority,jurisdiction:d.instrument.jurisdiction,language:d.instrument.language,
          sourceUrl:d.version.sourceUrl,date:d.version.publishedOn};navigate('sources');
      }});
  }catch(error){if(turn===routeTurn){lastReader='';$('reader').textContent=error.message;}}
}
function applyFilters() {
  clearTimeout(debounce);debounce=undefined;
  const {params}=route();
  params.delete('doc');params.delete('section');
  for(const [key,id] of Object.entries(filters)){const v=$(id).value;if(v&&v!==defaults[key])params.set(key,v);else params.delete(key);}
  limit=40;navigate('library',params,true);
}
async function start() {
  const [formIndex,directory]=await Promise.allSettled(['boat-fields.json','countries.json'].map(f=>readJson(dataUrl(f))));
  countries=directory.value?.countries||[];earlyFields=formIndex.value?.fields||[];fieldReleaseDay=formIndex.value?.checkedAt||'';
  if(route().view==='boat'&&earlyFields.length&&countries.length){fields=earlyFields.map(f=>({...f}));setFlagChoices();openBoatForm();}
  const files=[...Object.values(collections),'gazette.json','originals.json','flag-sources.json','registry-guides.json','imo-history.json'];
  const worldRequest=readJson(dataUrl('world-laws.json')).then(value=>({value}),error=>({error}));
  const results=await Promise.allSettled(files.map(f=>readJson(dataUrl(f))));
  const data=Object.fromEntries(files.map((f,i)=>[f,results[i].value]));
  catalogues=Object.entries(collections).filter(([,file])=>data[file]).map(([collectionName,file])=>({...data[file],collectionName}));
  failedCollections=Object.entries(collections).filter(([,file])=>!data[file]).map(([name])=>name);
  gazette=data['gazette.json']||gazette;originals=data['originals.json']||originals;
  flagSources=data['flag-sources.json']||flagSources;registryBook=data['registry-guides.json']||registryBook;imoHistory=data['imo-history.json']||imoHistory;
  await refreshImports();loaded=true;rebuild();
  if(boatFormActive&&(imports.some(i=>i.fields?.length)||failedCollections.length))boatFormActive=false;
  if(results.some(r=>r.status!=='fulfilled'))notify('Some public source files are unavailable. Displaying the collections that loaded.');
  await drawRoute();
  if(pendingDefinition&&route().view==='boat')openBoatDefinition(pendingDefinition);
  pendingDefinition=undefined;
  const national=await worldRequest;worldLoading=false;
  if(national.value)worldBook=national.value;else notify('The national catalogue could not be loaded. The other collections are available.');
  rebuild();
  const {view}=route();
  if(view==='boat-results')showNationalSuggestions($('boat-results-view'),[...world.values()],profile);
  else if(view==='map'){
    const host=$('map-national'),code=$('map-country')?.value;
    if(host&&code&&code!=='EU')nationalLaws(host,[...world.values()],code);
  }else if(view==='sources'&&$('sources-national-count'))$('sources-national-count').textContent=world.size.toLocaleString('en');
  else if(['library','jurisdictions'].includes(view)||view==='boat-passage'&&route().params.get('doc')?.startsWith('world:'))await drawRoute();
}
let debounce;
$('q').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(applyFilters,160);};
for(const id of ['source-filter','country-filter','year-filter','match-filter'])$(id).onchange=applyFilters;
$('filter-form').onsubmit=event=>{event.preventDefault();clearTimeout(debounce);applyFilters();};
$('clear-filters').onclick=()=>{limit=40;navigate('library');};
$('more-results').onclick=()=>{limit+=60;search(route().params);};
$('result-list').onclick=event=>{const button=event.target.closest('[data-row]');if(button){const row=rows[+button.dataset.row];select(row.doc,row.sectionId,true);}};
window.addEventListener('hashchange',()=>{clearTimeout(debounce);debounce=undefined;drawRoute();});
drawRoute();
