import {esc,marked,folioRows,mergeInstruments} from './model.js';
import {readJson,dataUrl,readShard,archiveSections,archiveKind} from './archive.js';
import {listImports,importToFolio} from './imports.js';
import {collectFields} from './profile.js';
import {today} from './boat-form.js';
import {renderRegulations} from './regulations.js';
import {publisherDates} from './revision-picker.js';
import {nationalDocument,catalogueSources,publisherDocument} from './library-records.js';
import {domesticImplementations,implementationFields} from './implementation.js';
import {registeredScopes,treatyFields} from './treaty-scope.js';
import {holdings,renderAtlas} from './atlas.js';
import {resolveEdition,loadUkEdition} from './uk-editions.js';
import {renderReader,releasePreview} from './reader.js';
import {renderChanges,closeComparison} from './changes.js';
import {renderSources} from './sources.js';
import {createDocumentWorkspace} from './documents.js';
import {collections} from './collections.js';
import {mapCatalogue} from './provision-map.js';
import {indexChangeEvents,indexIncorporations,interpretQuestion,timelineHref} from './legal-research.js';
import {showDatedHits} from './research-panel.js';

const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./search-worker.js',import.meta.url),{type:'module'});
const filters={q:'q',source:'source-filter',country:'country-filter',year:'year-filter'};
const defaults={q:'',source:'all',country:'',year:''};
let catalogues=[],gazette={records:[]},originals={records:{}},imports=[],fields=[],byKey=new Map(),byEdition=new Map(),archive=new Map();
let countries=[],worldBook={records:[]},world=new Map(),sources=new Map(),byCountry=new Map();
let flagSources={flags:[]},ukHistory={records:[]},euHistory={records:[]},imoHistory={instruments:[]},registryBook={entries:[]};
let ruleCoverage={},officialIndex={},publishers={},clauseIndex={records:{},counts:{}};
let nationalIndex={records:{},counts:{}},originalTreaties={},treatyWording={},implementation=[],failedCollections=[];
let researchCatalogue={regimes:{},provisions:[],relations:[],events:[]}, datedProvisions, researchEvents=[];
const views=['regulations','documents','library','changes','sources'];
let profile={values:{},asOf:''},rows=[],readerMode='text',loaded=false,limit=40,ticket=0,routeTurn=0,prefill,storageError='',lastQuery='',lastReader='',noticeTimer,within='',withinDoc='';
let publicStart,ownerPage='',generation=0,regSignature='',regReturn='',regBrowser,collectionReady=false;
let provisionSearch;
const documentWorkspace=createDocumentWorkspace($('documents-view'),()=>publicStart && refreshImports());
function referenceDay(){const latest=catalogues.map(c=>c.checkedAt).filter(Boolean).sort().at(-1);return latest&&latest<today()?latest:today();}
function countryName(code){return countries.find(c=>c.code===code)?.name||code||'';}
function route() {
  const [name,query='']=location.hash.slice(1).split('?');
  const params=new URLSearchParams(query);
  if(['map','jurisdictions'].includes(name)){if(!params.has('tab'))params.set('tab','map');return {view:'library',params};}
  if(name==='boat-passage')return {view:'library',params};
  return {view:views.includes(name)?name:'regulations',params};
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
  if(values.get('doc')!==doc||values.get('section')!==(section||null)){values.delete('page');values.delete('at');}
  values.set('doc',doc);
  if(section)values.set('section',section);else values.delete('section');
  values.delete('tab');navigate('library',values);
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
  fields=collectFields([...catalogues,{fields:[...implementationFields,...treatyFields]}],local);byKey=new Map();byEdition=new Map();
  setFlagChoices();
  for(const instrument of instruments)for(const version of instrument.versions){
    const key=instrument.key+'|'+version.id;
    byKey.set(key,{key,instrument,version,sections:version.sections,type:instrument.local?'local':'folio'});
    byEdition.set(version.id,key);
  }
  for(const doc of implementation){byKey.set(doc.key,doc);byEdition.set(doc.version.id,doc.key);}
  archive=new Map(gazette.records.map(r=>[r.id,r]));
  researchEvents=indexChangeEvents({imo:imoHistory,gazette:gazette.records,documents:[...byKey.values()],
    supplements:researchCatalogue.events,datedProvisions});
  world=new Map(worldBook.records.map(raw=>{
    const country=raw.country||'FAO:'+raw.countryName,id='world:'+raw.id,topics=Array.isArray(raw.topics)?raw.topics.join(' · '):raw.topics||'';
    const preview=[raw.countryName,topics,raw.kind].filter(Boolean).join(' · ');
    const codes=(raw.countries||[]).map(c=>c.code||'FAO:'+c.name);
    if(!codes.includes(country))codes.push(country);
    const screening=nationalIndex.records[raw.id];
    return [id,{...raw,id,country,codes,preview,fingerprint:screening?.[4],searchText:[raw.id,raw.title,raw.originalTitle,...(screening?.[5]||[]),codes.join(' '),(raw.countries||[]).map(c=>c.name).join(' '),raw.countryName,topics,raw.year,raw.kind,(raw.languages||[]).join(' '),raw.publisher].filter(Boolean).join(' ')}];
  }));
  const extra=catalogueSources(imoHistory,ukHistory,euHistory,originalTreaties,flagSources,registryBook,treatyWording);
  sources=new Map(extra.map(s=>[s.id,s]));
  const folios=[...folioRows(instruments),...implementation.flatMap(d=>folioRows([{...d.instrument,versions:[d.version]}]).map(r=>({...r,doc:d.key})))];
  const catalogue=[...[...world.values()].map(({id,country,codes,title,searchText,preview,year})=>({id,country,codes,title,searchText,preview,year,collection:'world'})),
    ...extra.map(({doc,...r})=>r)];
  provisionSearch=undefined;
  worker.postMessage({type:'init',folios,records:gazette.records,searchIndex:gazette.searchIndex,world:catalogue});
  lastQuery='';lastReader='';generation++;
  byCountry=holdings(countries,world.values(),gazette.records,extra,[...byKey.values()]);
  const years=new Set([...folios.map(r=>r.date),...gazette.records.map(r=>r.publishedDate||r.date),...catalogue.map(r=>r.year)].filter(Boolean).map(d=>String(d).slice(0,4)));
  const options=new Map(countries.map(c=>[c.code,c.name]));
  options.set('EU','European Union');
  for(const r of world.values())for(const v of r.countries||[]){const code=v.code||'FAO:'+v.name;if(!options.has(code))options.set(code,v.name);}
  for(const r of folios)if(r.jurisdiction&&!options.has(r.jurisdiction))options.set(r.jurisdiction,r.jurisdiction==='EU'?'European Union':r.jurisdiction);
  $('country-filter').innerHTML='<option value="">All jurisdictions</option>'+[...options].sort((a,b)=>a[1].localeCompare(b[1])).map(([k,n])=>'<option value="'+esc(k)+'">'+esc(n)+'</option>').join('');
  $('year-filter').innerHTML='<option value="">All years</option>'+[...years].sort().reverse().map(y=>'<option>'+esc(y)+'</option>').join('');
}
async function refreshImports() {
  try{imports=await listImports();storageError='';}catch{imports=[];storageError='Local document storage is unavailable in this browser session.';}
  if(loaded)rebuild();
}
function sourceSummary(key,section=''){
  const worldRecord=world.get(key), publisher=sources.get(key), record=archive.get(key);
  const item=worldRecord||publisher||record;
  if(!item)return null;
  const edition=worldRecord&&section.startsWith('publisher-')?publishers[key.slice(6)]?.editionDate:officialIndex[key]?.source?.match(/\/(\d{4}-\d{2}-\d{2})\/data\.xml$/)?.[1];
  return {title:item.title,date:String(edition||item.issuedDate||item.year||item.date||''),codes:worldRecord?.codes||(record?['NO']:publisher?.codes||[])};
}
async function getDoc(key) {
  if(byKey.has(key))return byKey.get(key);
  if(key?.startsWith('uk-edition:'))return loadUkEdition(key,ukHistory.records);
  if(sources.has(key))return publisherDocument(sources.get(key),officialIndex[key],fields);
  if(world.has(key))return nationalDocument(world.get(key),fields,publishers[key.slice(6)],clauseIndex.records[key]);
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
  return [...mapped,...uk,...[...world.values(),...sources.values()].map(r=>({key:r.id,label:r.title})),...gazette.records.map(r=>({key:r.id,label:[r.legalId,archiveKind(r),r.title].join(' · ')}))];
}
function presets() {
  return catalogues.flatMap(c=>c.comparisons||[]).map(p=>({...p,before:byEdition.get(p.before.versionId),after:byEdition.get(p.after.versionId),
    leftSection:p.before.sectionId,rightSection:p.after.sectionId})).filter(p=>p.before&&p.after);
}
function related(doc) {
  if(!['folio','archive'].includes(doc.type))return [];
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
function searchProvisions(q,country,asOf,callback){
  const id=++ticket;
  provisionSearch=callback;
  worker.postMessage({type:'search',ticket:id,q,country,asOf,limit:10,profile:{},match:'all',publishedBefore:asOf});
  return ()=>{if(ticket===id)provisionSearch=undefined;};
}
const issuingBody={imo:'IMO',archive:'NO',uk:'GB',eu:'EU'};
function libraryTimelineLink(query,source,country) {
  const now=today(), parsed=interpretQuestion(query,researchCatalogue.regimes,now);
  const authority=issuingBody[source]||country||parsed.authority;
  const href=timelineHref({query,authority,instrument:parsed.instrument,today:now});
  $('date-search-link').href=href;
  $('date-search-link').hidden=!parsed.from&&!parsed.to;
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
  libraryTimelineLink(values.q,values.source,values.country);
  const query=JSON.stringify([values,profile,limit]);
  if(query===lastQuery)return;
  const canShowDates=!values.year&&(values.source==='all'||Object.hasOwn(issuingBody,values.source));
  showDatedHits($('dated-library-hits'),researchEvents,{query:canShowDates?values.q:'',
    authority:issuingBody[values.source]||values.country,today:today(),compact:true});
  provisionSearch=undefined;
  lastQuery=query;rows=[];$('result-list').replaceChildren();$('result-count').textContent='';$('more-results').hidden=true;
  $('search-status').textContent='Searching…';
  worker.postMessage({type:'search',ticket:++ticket,...values,limit,profile:{},asOf:'',match:'all'});
}
function resultSelection() {
  const {params}=route(),auto=automaticHit(params),key=params.get('doc')||auto?.doc||byEdition.get('no-cargo-2025'),id=params.get('section')||auto?.sectionId||'s1';
  for(const button of $('result-list').querySelectorAll('[data-row]')){
    const r=rows[Number(button.dataset.row)],active=r.doc===key&&(!r.sectionId||r.sectionId===id);
    button.classList.toggle('selected',active);button.setAttribute('aria-current',String(active));
  }
}
function filtered(params) {
  return [...Object.keys(filters)].some(k=>params.has(k));
}
function automaticHit(params) {return !params.has('doc')&&filtered(params)?rows[0]:null;}
worker.onmessage=event=>{
  const message=event.data;
  if(message.ticket!==ticket)return;
  const {view,params}=route();
  if(view==='regulations'){provisionSearch?.(message);return;}
  if(view!=='library'||['map','compare'].includes(params.get('tab')))return;
  if(message.type==='error'){$('search-status').textContent='The search file could not be read. Reload to retry.';return;}
  if(message.type!=='results')return;
  const q=$('q').value;rows=message.rows;
  $('result-count').textContent=message.total.toLocaleString('en');
  $('search-status').textContent=message.errors?'Some archive files were unavailable. Results are partial.':message.progress||
    (!rows.length?($('dated-library-hits').hidden?'No results for these filters.':'No matching documents.'):'');
  $('more-results').hidden=rows.length>=message.total;
  $('result-list').innerHTML=rows.map((r,i)=>'<button class="result" data-row="'+i+'"><span class="result-top">'+esc([r.date,r.type==='archive'?r.subtitle:r.type==='local'?'My import':r.jurisdiction].filter(Boolean).join(' · '))+'</span><strong>'+marked(r.heading||r.title,q)+'</strong><span class="result-sub">'+esc(r.title)+'</span><span class="snippet">'+marked(r.preview,q)+'</span>'+'</button>').join('');
  resultSelection();
  if(!route().params.has('doc')&&filtered(route().params))drawRoute();
};
worker.onerror=()=>{
  provisionSearch?.({type:'error'});
  $('search-status').textContent='The local search worker could not start. Reload this page to retry.';
};

function showView(view) {
  for(const name of views)$(name+'-view').hidden=view!==name;
  for(const nav of document.querySelectorAll('[data-view]'))nav.setAttribute('aria-current',nav.dataset.view===view?'page':'false');
  $('research-menu').open=false;
  document.querySelector('[data-view="regulations"]').href=regReturn||'#regulations';
}
async function drawRoute() {
  const {view,params}=route(),turn=++routeTurn;
  const previous=ownerPage;ownerPage=view;showView(view);
  if(previous==='regulations'&&view!=='regulations')regBrowser?.close();
  if(previous==='changes'&&view!=='changes')closeComparison();
  if(previous==='documents'&&view!=='documents')documentWorkspace.close();
  if(view!=='library'){releasePreview();lastReader='';lastQuery='';}
  if(view==='documents'){
    if(previous!=='documents'){window.scrollTo(0,0);await documentWorkspace.open();}
    return;
  }
  if(!loaded){
    publicStart??=start().catch(error=>{publicStart=undefined;$('regulations-view').textContent=error.message;notify(error.message);});
    return;
  }
  if(view==='regulations'){
    const signature=generation+'|'+params.toString();
    if(regSignature!==signature||previous!==view){
      regBrowser?.close();
      regSignature=signature;
      regBrowser=renderRegulations($('regulations-view'),{documents:[...byKey.values()],fields,params,countryName,latest:referenceDay(),
        records:[...world.values()],coverage:ruleCoverage,conditionCollections:clauseIndex.collections,ready:collectionReady,lookup:sourceSummary,
        researchCatalogue,researchEvents,today:today(),searchProvisions,
        editions:values=>publisherDates(values,world.values(),publishers,gazette.records,ukHistory.records,euHistory.records),changed(next,current){
          profile=current;regSignature=generation+'|'+next.toString();regReturn='#regulations'+(next.size?'?'+next:'');
          history.replaceState(null,'',regReturn);
        }});
    }
    return;
  }
  if(!collectionReady)return;
  if(view==='library'){
    const tab=params.get('tab')||'documents', atlas=['map','compare'].includes(tab);
    $('library-atlas').hidden=!atlas;$('library-documents').hidden=atlas;
    for(const node of document.querySelectorAll('[data-tab]'))node.setAttribute('aria-current',node.dataset.tab===(atlas?tab:'documents')?'page':'false');
    if(atlas){releasePreview();lastReader='';lastQuery='';await renderAtlas($('library-atlas'),{tab,params,countries,counts:byCountry,imo:imoHistory,documents:[...byKey.values()],flags:flagSources,navigate,latest:referenceDay(),fields,conditionCollections:clauseIndex.collections,lookup:sourceSummary});return;}
  }
  if(view==='sources'){
    renderSources($('sources-view'),{catalogues,gazette,originals,worldBook,uk:ukHistory,eu:euHistory,imo:imoHistory,ruleCoverage,clauseCounts:clauseIndex.counts,imports,storageError,prefill,refreshImports,openLocal,notify,redraw:drawRoute});prefill=undefined;return;
  }
  if(view==='changes'){await renderChanges($('changes-view'),{params,choices,presets,getDoc,navigate});return;}
  search(params);resultSelection();
  const auto=automaticHit(params);
  if(!params.has('doc')&&filtered(params)&&!auto){releasePreview();lastReader='';$('reader').innerHTML='<div class="empty"><h2>Select a result</h2><p>Choose an instrument or change the Library filters.</p></div>';return;}
  const key=params.get('doc')||auto?.doc||byEdition.get('no-cargo-2025')||byKey.keys().next().value||gazette.records[0]?.id;
  const section=params.get('section')||auto?.sectionId||'',signature=JSON.stringify([key,section,params.get('q'),params.get('mode'),params.get('page'),params.get('at'),profile]);
  if(lastReader===signature)return;
  try{
    const doc=await getDoc(key);if(turn!==routeTurn)return;
    if(!doc)throw new Error('This edition is unavailable. Private editions are available on the device where they were imported.');
    lastReader=signature;if(withinDoc!==key){within='';withinDoc=key;}
    renderReader($('reader'),doc,section,{profile,fields,query:params.get('q')||'',mode:params.get('mode')||readerMode,page:Number(params.get('page')),passage:params.get('at')?.slice(0,220),setMode:value=>{
      readerMode=value;
      const active=route();
      if(active.view==='library'&&active.params.has('mode')&&active.params.get('mode')!==value){
        active.params.set('mode',value);if(value!=='pdf')active.params.delete('page');
        history.replaceState(null,'','#library?'+active.params);
      }
    },
      within,setWithin:value=>{within=value;},related,treatyEditions,select,notify,compare:async(a,b)=>{
        const [left,right]=await Promise.all([getDoc(a),getDoc(b)]);
        if((left.version.publishedOn||'')>(right.version.publishedOn||''))[a,b]=[b,a];
        navigate('changes',{before:a,after:b});
      },importFor:d=>{
        prefill={title:d.instrument.title,authority:d.instrument.authority,jurisdiction:d.instrument.jurisdiction,language:d.instrument.language,
          sourceUrl:d.version.sourceUrl,date:d.version.publishedOn};navigate('sources');
      }});
    if(params.has('doc')&&(params.has('mode')||previous!=='library')&&matchMedia('(max-width:760px)').matches){
      $('reader').tabIndex=-1;$('reader').focus({preventScroll:true});$('reader').scrollIntoView({block:'start'});
    }
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
  const secondary=['uk-history.json','eu-history.json','world-laws.json','national-screening.json','official-screening.json','publisher-matches.json','clause-index.json'];
  const pending=Promise.allSettled(secondary.map(f=>readJson(dataUrl(f))));
  const files=[...Object.values(collections),'countries.json','gazette.json','originals.json','flag-sources.json','registry-guides.json','imo-history.json','treaty-originals.json','treaty-wording.json','uk-navigation.json','ca-arctic.json','rule-coverage.json','legal-research.json','dated-provisions.json'];
  const results=await Promise.allSettled(files.map(f=>readJson(dataUrl(f))));
  const data=Object.fromEntries(files.map((f,i)=>[f,results[i].value]));
  catalogues=Object.entries(collections).filter(([,file])=>data[file]).map(([collectionName,file])=>({...mapCatalogue(data[file]),collectionName}));
  failedCollections=Object.entries(collections).filter(([,file])=>!data[file]).map(([name])=>name);
  gazette=data['gazette.json']||gazette;originals=data['originals.json']||originals;
  flagSources=data['flag-sources.json']||flagSources;registryBook=data['registry-guides.json']||registryBook;imoHistory=data['imo-history.json']||imoHistory;
  researchCatalogue=data['legal-research.json']||researchCatalogue;
  datedProvisions=data['dated-provisions.json'];
  ruleCoverage=data['rule-coverage.json']||{};
  countries=data['countries.json']?.countries||[];originalTreaties=data['treaty-originals.json']||{};treatyWording=data['treaty-wording.json']||{};
  async function archiveSource(id){
    const record=gazette.records.find(r=>r.id===id);
    if(!record)return;
    try{return (await readShard(record.shard)).get(id);}catch{failedCollections.push(record.title);}
  }
  const [construction,environment]=await Promise.all([archiveSource('SF/forskrift/2014-07-01-1072'),archiveSource('SF/forskrift/2012-05-30-488')]);
  implementation=[...domesticImplementations(construction,data['uk-navigation.json'],environment,data['ca-arctic.json']),...registeredScopes(originalTreaties,treatyWording,imoHistory)];
  researchCatalogue=indexIncorporations(researchCatalogue,implementation,imoHistory,countryName);
  await refreshImports();loaded=true;
  if(route().view==='regulations'){rebuild();await drawRoute();}
  const additional=await pending,more=Object.fromEntries(secondary.map((f,i)=>[f,additional[i].value]));
  ukHistory=more['uk-history.json']||ukHistory;euHistory=more['eu-history.json']||euHistory;
  worldBook=more['world-laws.json']||worldBook;nationalIndex=more['national-screening.json']||nationalIndex;officialIndex=more['official-screening.json']||{};publishers=more['publisher-matches.json']||{};clauseIndex=more['clause-index.json']||clauseIndex;
  collectionReady=true;rebuild();
  if(failedCollections.length||[...results,...additional].some(r=>r.status!=='fulfilled'))notify('Part of the public collection could not be loaded.');
  if(route().view==='regulations'&&regBrowser){regSignature=generation+'|'+route().params;regBrowser.updateRecords([...world.values()],clauseIndex.collections,researchEvents);}
  else await drawRoute();
}
let debounce;
$('q').oninput=()=>{
  libraryTimelineLink($('q').value,$('source-filter').value,$('country-filter').value);
  clearTimeout(debounce);debounce=setTimeout(applyFilters,160);
};
for(const id of ['source-filter','country-filter','year-filter'])$(id).onchange=applyFilters;
$('filter-form').onsubmit=event=>{event.preventDefault();clearTimeout(debounce);applyFilters();};
$('clear-filters').onclick=()=>{limit=40;navigate('library');};
$('more-results').onclick=()=>{limit+=60;search(route().params);};
$('result-list').onclick=event=>{const button=event.target.closest('[data-row]');if(button){const row=rows[+button.dataset.row];select(row.doc,row.sectionId,true);}};
window.addEventListener('hashchange',()=>{clearTimeout(debounce);debounce=undefined;drawRoute();});
drawRoute();
