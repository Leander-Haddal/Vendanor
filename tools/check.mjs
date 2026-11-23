import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from '../site/vendor/pdf-lib.mjs';
import {mapCatalogue} from '../site/js/provision-map.js';
import {domesticImplementations,implementationFields} from '../site/js/implementation.js';
import {registeredScopes,treatyFields} from '../site/js/treaty-scope.js';
import {gunzipSync} from 'node:zlib';

const root=fileURLToPath(new URL('../',import.meta.url)),site=join(root,'site'),data=join(site,'data');
const hashes=new Map(),usedPdfs=new Set();
const json=async name=>JSON.parse(await readFile(join(data,name),'utf8'));

async function walk(dir) {
  const result=[];
  for(const f of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,f.name);
    if(f.isDirectory())result.push(...await walk(path));else result.push(path);
  }
  return result;
}
function unique(values,label) {
  assert.equal(new Set(values).size,values.length,'Duplicate '+label);
}
function webUrl(value,hosts) {
  const address=new URL(value);
  assert.ok(['https:','http:'].includes(address.protocol)&&!address.username&&!address.password,'Invalid publisher URL '+value);
  if(hosts)assert(hosts.includes(address.hostname.toLowerCase()),'Unexpected publisher '+value);
  return address;
}
function day(value) {
  assert.match(value,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(value+'T00:00:00Z').toISOString().slice(0,10),value,'Invalid date '+value);
}
async function pdf(asset,expected) {
  assert.match(asset,/^pdf\/[a-zA-Z0-9_./-]+\.pdf$/);
  assert(!asset.includes('..'));
  const path=join(site,asset);usedPdfs.add(resolve(path));
  if(!hashes.has(asset)){
    const bytes=await readFile(path);
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-',asset);
    let pages;
    if(bytes.includes(Buffer.from('/Encrypt'))){
      // Some public editions allow reading and printing while restricting edits. Open them with the website's reader.
      const reader=await import('../site/vendor/pdfjs.mjs');
      reader.GlobalWorkerOptions.workerSrc=new URL('../site/vendor/pdf.worker.mjs',import.meta.url).href;
      const task=reader.getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,isEvalSupported:false});
      try{pages=(await task.promise).numPages;}finally{await task.destroy();}
    }else pages=(await PDFDocument.load(bytes,{updateMetadata:false})).getPageCount();
    assert(pages>0,asset+' is empty');
    hashes.set(asset,{sha256:createHash('sha256').update(bytes).digest('hex'),pages});
  }
  const info=hashes.get(asset);
  if(expected)assert.equal(info.sha256,expected,asset);
  return info.pages;
}
function leaves(rule) {
  if(!rule)return [];
  assert.equal(['any','all','not','field'].filter(key=>Object.hasOwn(rule,key)).length,1,'Invalid condition '+JSON.stringify(rule));
  if(rule.any||rule.all){
    const group=rule.any||rule.all;assert(Array.isArray(group)&&group.length,'Empty condition group');
    return group.flatMap(leaves);
  }
  if(rule.not)return leaves(rule.not);
  return [rule];
}
async function checkRegistryGuides(keys,codes) {
  const guide=await json('registry-guides.json'),documents=new Map();
  day(guide.checkedAt);assert(guide.coverage&&guide.entries.length);
  unique(guide.entries.map(entry=>entry.id),'registry guide');
  for(const item of guide.entries){
    assert(codes.has(item.flag)&&item.authority&&item.title&&item.provision&&item.reference&&item.scope&&item.summary,item.id);
    for(const key of ['sourcePage','documentUrl','dateSource'])webUrl(item[key]);
    assert.match(item.documentSha256,/^[a-f0-9]{64}$/);
    if(documents.has(item.documentUrl))assert.equal(documents.get(item.documentUrl),item.documentSha256,item.documentUrl);
    documents.set(item.documentUrl,item.documentSha256);
    assert(item.pages.length&&item.pages.every(p=>Number.isInteger(p)&&p>0),item.id+' page');
    unique(item.pages,item.id+' page');
    assert.match(item.issuedMonth,/^\d{4}-(0[1-9]|1[0-2])$/);
    if(item.issuedOn)assert.equal(item.issuedMonth,item.issuedOn.slice(0,7),item.id+' printed month');
    for(const name of ['issuedOn','publishedOn','effectiveFrom','verifiedThrough'])if(item[name])day(item[name]);
    const tests=leaves(item.conditions);
    assert(tests.some(c=>c.field==='flag'&&c.op==='eq'&&c.value===item.flag),item.id+' flag condition');
    assert(tests.every(c=>keys.has(c.field)&&c.source&&Object.hasOwn(c,'value')),item.id+' sourced profile condition');
  }
  return guide.entries.length;
}

async function checkFolios(codes) {
  const filenames=(await readdir(data)).filter(name=>name==='folios.json'||name.endsWith('-folios.json'));
  for(const required of ['folios.json','eu-folios.json','flag-folios.json','mlc-folios.json','colreg-folios.json','solas-folios.json'])assert(filenames.includes(required),'Missing '+required);
  const sets=(await Promise.all(filenames.map(json))).map(mapCatalogue);
  const versions=sets.flatMap(s=>s.instruments.flatMap(i=>i.versions));
  const fields=sets.flatMap(s=>s.fields),keys=new Set(fields.map(f=>f.key));
  unique(fields.map(f=>f.key),'profile field');
  unique(versions.map(v=>v.id),'edition ID');
  unique(sets.flatMap(set=>set.instruments.map(i=>i.id)),'mapped instrument');
  for(const set of sets){
    day(set.checkedAt);
    for(const instrument of set.instruments){
      assert(instrument.title&&instrument.authority&&instrument.versions.length,instrument.id);
      for(const version of instrument.versions){
        const evidence=version.flagEvidence;
        if(!evidence)continue;
        assert.equal(evidence.flag,instrument.flagState,instrument.id+' flag');
        assert(evidence.kind&&evidence.register,version.id+' flag authority');
        webUrl(evidence.sourceUrl);
        assert(version.sourceLinks?.includes(evidence.sourceUrl),version.id+' flag action reference');
        for(const key of ['registeredOn','effectiveFrom','effectiveTo','predecessorEffectiveFrom'])if(evidence[key])day(evidence[key]);
        if(evidence.effectiveFrom&&version.effectiveFrom)assert(evidence.effectiveFrom<=version.effectiveFrom,version.id+' precedes flag coverage');
      }
    }
  }
  for(const v of versions){
    assert(v.sections.length);unique(v.sections.map(s=>s.id),v.id+' section');
    webUrl(v.sourceUrl);webUrl(v.sourcePage);
    for(const url of [...(v.sourceLinks||[]),...(v.currentRegister?[v.currentRegister]:[])])webUrl(url);
    let pages,published;
    if(v.archiveRecord){
      const archive=await json('gazette.json'),meta=archive.records.find(record=>record.id===v.archiveRecord);
      assert(meta?.kind==='consolidated'&&v.sourceUrl===meta.sourceUrl&&v.effectiveFrom===meta.lastChangeInForceText,v.id+' consolidated edition');
      const record=(await json(meta.shard)).records.find(record=>record.id===meta.id);
      published=new Map(record.sections.map(section=>[section.sourceUrl,section.text]));
      assert.equal(v.sections.length,published.size,v.id);
    }else{
      assert.match(v.pdfSha256,/^[a-f0-9]{64}$/);pages=await pdf(v.pdf,v.pdfSha256);
    }
    for(const k of ['publishedOn','adoptedOn','editionDate','effectiveFrom','effectiveTo','verifiedThrough'])if(v[k])day(v[k]);
    if(v.effectiveFrom&&v.effectiveTo)assert(v.effectiveFrom<v.effectiveTo,v.id+' interval');
    for(const s of v.sections){
      assert(s.text.trim(),v.id+'/'+s.id);
      if(published)assert.equal(s.text,published.get(s.sourceUrl),v.id+'/'+s.id+' register wording');
      else{
        assert(s.pages.length&&s.pages.every(p=>Number.isInteger(p)&&p>0&&p<=pages),v.id+'/'+s.id);
        await pdf(s.clip);
      }
      if(s.sourceUrl)webUrl(s.sourceUrl);
      if(s.survey)assert(keys.has(s.survey.field)&&s.survey.source&&s.survey.intervalMonths>0,s.id+' survey');
      assert(s.criteria,v.id+' '+s.id+' has no applicability or source context');
      for(const entry of s.cases||[])assert(entry.reference&&entry.outcome&&entry.when,v.id+' incomplete case '+s.id);
      if(v.scopeChange)day(v.scopeChange.from);
      for(const derived of v.derivedFields||[])assert(keys.has(derived.field),v.id+' derived field');
      for(const leaf of [s.criteria,s.confirmWhen,v.scopeChange?.when,...(v.derivedFields||[]).map(r=>r.when),...(s.cases||[]).flatMap(c=>[c.when,c.confirmWhen])].flatMap(leaves)){
        assert(keys.has(leaf.field),'Unknown field '+leaf.field);
        assert(['eq','neq','lt','lte','gt','gte'].includes(leaf.op));
        assert(Object.hasOwn(leaf,'value')&&typeof leaf.source==='string'&&leaf.source.trim(),v.id+' unsupported condition');
      }
    }
  }
  const refs=[...fields.map(f=>f.source),...sets.flatMap(s=>s.comparisons.flatMap(c=>[c.before,c.after]))];
  for(const ref of refs)assert(versions.find(v=>v.id===ref.versionId)?.sections.some(s=>s.id===ref.sectionId),'Dangling source '+JSON.stringify(ref));
  const prints=new Map(),clauseSources=new Map();
  for(const version of versions)for(const section of version.sections){
    const source=section.clip||section.sourceUrl;
    if(!prints.has(source))prints.set(source,new Set());
    prints.get(source).add(section.screeningLevel);
    if(section.cases?.length)clauseSources.set(source,section.cases.length);
  }
  const direct=[...prints.values()].filter(levels=>[...levels].every(level=>level==='section')).length;
  const clauses=[...clauseSources.values()].reduce((sum,count)=>sum+count,0);
  return {versions:versions.length,prints:prints.size,direct,clauseSources:clauseSources.size,clauses,guides:await checkRegistryGuides(keys,codes)};
}
async function checkArchive() {
  const [catalogue,originals]=await Promise.all([json('gazette.json'),json('originals.json')]);
  const postingBytes=await readFile(join(data,catalogue.searchIndex));
  assert.equal(catalogue.searchIndex,'gazette-search-'+createHash('sha256').update(postingBytes).digest('hex').slice(0,14)+'.json');
  const postings=JSON.parse(postingBytes);
  const {records,coverage}=catalogue,byId=new Map(records.map(r=>[r.id,r]));
  unique(records.map(r=>r.id),'archive record');
  assert.equal(records.length,coverage.gazetteCount+coverage.consolidatedCount);
  const seen=new Set();
  for(const name of new Set(records.map(r=>r.shard))){
    const bytes=await readFile(join(data,name));
    const hash=createHash('sha256').update(bytes).digest('hex').slice(0,14);
    assert(name.endsWith('-'+hash+'.json'),name);
    const shard=JSON.parse(bytes);
    for(const raw of shard.records){
      const meta=byId.get(raw.id);assert(meta&&meta.shard===name,raw.id);assert(!seen.has(raw.id));seen.add(raw.id);
      assert.equal(raw.sections.length,meta.sectionCount);webUrl(meta.sourceUrl);
    }
  }
  assert.equal(seen.size,records.length);assert.equal(records.reduce((n,r)=>n+r.sectionCount,0),coverage.sectionCount);
  for(const list of Object.values(postings.terms)){
    let previous=-1;
    for(const value of list){assert(Number.isInteger(value)&&previous<value&&value<records.length);previous=value;}
  }
  for(const [id,original] of Object.entries(originals.records)){
    const meta=byId.get(id);assert(meta,id);webUrl(original.sourceUrl);assert.equal(await pdf(original.asset,original.sha256),original.pages,id+' original page count');
    assert.equal(original.sourceShard,meta.shard,id+' clip mapping is stale');
    for(const [ordinal,bands] of Object.entries(original.sections)){
      assert(+ordinal>=0&&+ordinal<meta.sectionCount);
      for(const b of bands)assert(Number.isInteger(b.page)&&b.page>=1&&b.page<=original.pages&&b.top>=0&&b.top<b.bottom&&b.bottom<=1,id);
    }
  }
  return records.length;
}
async function checkWorld() {
  const [directory,book]=await Promise.all([json('countries.json'),json('world-laws.json')]);
  assert(directory.countries.length&&book.records.length);
  unique(directory.countries.map(c=>c.code),'directory code');unique(book.records.map(r=>r.id),'national record');
  for(const c of directory.countries){
    assert(c.name&&c.code);
    if(c.profileUrl)webUrl(c.profileUrl);
  }
  for(const r of book.records){
    assert(r.title&&r.id&&r.countryName);webUrl(r.sourceUrl);if(r.pdfUrl)webUrl(r.pdfUrl);
  }
  return book.records.length;
}
async function checkFlagSources(codes) {
  const {basis,flags}=await json('flag-sources.json');
  day(basis.asOf);day(basis.reviewedOn);webUrl(basis.url,['unctad.org']);
  unique(flags.map(f=>f.code),'flag source directory');
  const ranked=flags.filter(f=>f.rank!=null).sort((a,b)=>a.rank-b.rank);
  assert.equal(ranked.length,basis.rankedCount);
  ranked.forEach((f,i)=>{assert.equal(f.rank,i+1);assert(f.registerName);});
  for(const flag of flags){
    assert(codes.has(flag.code)&&flag.name&&flag.sources.length,flag.code);
    unique(flag.sources.map(s=>s.url),'publisher link in '+flag.code);
    for(const item of flag.sources){assert(item.title&&item.topic&&item.kind);webUrl(item.url);}
  }
  assert.equal(flags.reduce((n,f)=>n+f.sources.length,0),basis.sourceCount);
  return flags.length;
}

async function checkTreaties(codes) {
  const {source,coverage,instruments,participation:states}=await json('imo-history.json');
  const host=['wwwcdn.imo.org'];
  day(source.asOf);day(source.checkedAt);webUrl(source.url,['www.imo.org']);
  assert.match(source.sha256,/^[a-f0-9]{64}$/);webUrl(source.chronologyUrl,host);
  const volumes=new Map();
  for(const part of source.statusBooks){
    day(part.asOf);webUrl(part.url,host);assert.match(part.sha256,/^[a-f0-9]{64}$/);
    assert(!volumes.has(part.volume));volumes.set(part.volume,part.url);
  }
  day(states.asOf);webUrl(states.sourceUrl,host);assert.match(states.sha256,/^[a-f0-9]{64}$/);
  assert.equal(states.columns.length,coverage.columns);unique(states.columns.map(c=>c.key),'IMO workbook column');
  const columns=new Set(states.columns.map(c=>c.key)),rows=new Set();
  for(const [code,record] of [...Object.entries(states.byFlag),...Object.entries(states.organizations)]){
    assert(codes.has(code)||Object.hasOwn(states.organizations,code),code);
    assert(record.name&&Number.isInteger(record.row)&&!rows.has(record.row));rows.add(record.row);
    const marked=[...record.ratified,...record.denounced];
    unique(marked,'marks in workbook row '+record.row);assert(marked.every(key=>columns.has(key)),code+' treaty status');
  }
  assert.equal(Object.keys(states.byFlag).length,coverage.flags);
  unique(instruments.map(i=>i.id),'IMO instrument');
  const numbered=instruments.filter(i=>Number.isInteger(i.listNumber));
  assert.equal(numbered.length,coverage.numberedInstruments);
  assert.equal(instruments.length-numbered.length,coverage.codesAndRelatedInstruments);
  numbered.forEach((i,n)=>assert.equal(i.listNumber,n+1));
  let pageLinks=0,events=0,amendments=0,unresolved=0;
  function location(row){
    const u=webUrl(row.sourceUrl,host);
    if(row.page){
      assert(Number.isInteger(row.page)&&row.page>0&&row.sourceUrl===volumes.get(row.volume)+'#page='+row.page,'Invalid status book location '+u);
    }else assert.equal(row.sourceUrl,source.chronologyUrl);
    assert((row.participationKeys||[]).every(k=>columns.has(k)),'Unresolved ratification column');
  }
  for(const instrument of instruments){
    assert(instrument.title&&instrument.entries.length&&instrument.sourceParagraph>0,instrument.id);
    if(instrument.parentId)assert(numbered.some(i=>i.id===instrument.parentId),instrument.id);
    location(instrument);
    for(const record of instrument.entries){
      assert(record.label&&record.kind&&(record.date||record.status||record.reportedDates?.length),instrument.id);
      assert(record.sourceParagraph>0||record.reportedAsOf,instrument.id+' event provenance');
      for(const value of [record.date,record.reportedAsOf,...(record.reportedDates||[])].filter(Boolean))day(value);
      location(record);
      if(record.page)pageLinks++;
      if(record.kind==='Amendment'){assert(Number.isInteger(record.amendmentYear));amendments++;}
      if(record.status==='Date requires source review')unresolved++;
      events++;
    }
  }
  assert.equal(events,coverage.events);assert.equal(amendments,coverage.amendmentEvents);
  assert.equal(pageLinks,coverage.pdfPageLinks);assert.equal(unresolved,coverage.unresolvedDates);
  return events;
}

async function checkBritishHistory() {
  const book=await json('uk-history.json'),hosts=['www.legislation.gov.uk','legislation.gov.uk'];
  day(book.checkedAt);webUrl(book.sourceUrl,hosts);assert(book.terms.length&&book.records.length);
  unique(book.records.map(r=>r.id),'UK history');
  for(const r of book.records){
    assert(r.title&&r.id);
    assert.equal(webUrl(r.sourceUrl,hosts).pathname,'/'+r.id);
    if(r.year)assert.match(String(r.year),/^\d{4}$/);
    if(r.pdfUrl){
      const file=webUrl(r.pdfUrl,hosts);
      assert(['Original publication PDF','Publisher PDF'].includes(r.pdfKind),r.id+' PDF provenance');
      if(r.pdfKind==='Original publication PDF')assert(file.pathname.includes('/pdfs/')&&file.pathname.endsWith('.pdf'),r.id+' original publication');
    }
    unique(r.versions.map(v=>v.label),r.id+' versions');
    for(const v of r.versions){
      if(!['made','enacted','adopted'].includes(v.label))day(v.label);
      assert.equal(webUrl(v.url,hosts).pathname,'/'+r.id+'/contents/'+v.label,r.id+' edition target');
      if(v.format){assert.equal(v.format,'pdf');webUrl(v.pdfUrl,hosts);}
    }
  }
  return book.records.length;
}

async function checkEuropeanHistory() {
  const book=await json('eu-history.json');
  day(book.checkedAt);webUrl(book.sourceUrl,['op.europa.eu']);
  assert(book.classification.some(c=>c.code==='0730'));
  for(const c of book.classification){assert(c.label);assert.match(c.code,/^0730\d*$/);}
  unique(book.records.map(r=>r.id),'EU history');
  const ids=new Set(book.records.map(r=>r.id));assert(book.additionalActs.every(id=>ids.has(id)));
  function edition(record){
    const u=webUrl(record.sourceUrl,['eur-lex.europa.eu']);
    assert.equal(u.searchParams.get('uri'),'CELEX:'+record.id,record.id);
    if(record.date)day(record.date);
  }
  for(const r of book.records){
    edition(r);if(r.endDate)day(r.endDate);assert(r.title);
    unique(r.editions.map(e=>e.id+'|'+e.date),r.id+' consolidations');
    for(const e of r.editions){edition(e);assert(e.id.startsWith('0'+r.id.slice(1)+'-')&&e.kind==='Consolidated edition',e.id);}
    for(const e of r.changes){edition(e);assert(['Amended by','Repealed by','Corrected by'].includes(e.kind),e.kind);}
  }
  return book.records.length;
}

const codes=new Set((await json('countries.json')).countries.map(c=>c.code));
async function checkLibrary(){
  const [world,index,official,treaties,wording,geo,coverage,gazette,uk,eu]=await Promise.all(
    ['world-laws.json','national-screening.json','official-screening.json','treaty-originals.json','treaty-wording.json','world-boundaries.json','rule-coverage.json','gazette.json','uk-history.json','eu-history.json'].map(json));
  const records=new Map(world.records.map(r=>[r.id,r]));
  assert.deepEqual(Object.keys(index.records).sort(),[...records.keys()].sort(),'Incomplete national condition inventory');
  assert.deepEqual(coverage.national,index.counts);
  const nationalIds=[];
  for(const file of await readdir(join(data,'national'))){
    const rows=await json('national/'+file);
    for(const [key,d] of Object.entries(rows)){
      nationalIds.push(key);const record=records.get(key);
      assert.equal(d.documents.length,record.textUrls.length);
      assert.deepEqual(d.documents.map(item=>item.source),record.textUrls);
      for(const item of d.documents)if(item.sourcePdf)assert([record.pdfUrl,...(record.documentUrls||[])].includes(item.sourcePdf),key+' PDF rendition');
      assert.equal(index.records[key][0],d.documents.filter(t=>t.state==='text').length);
      assert.equal(index.records[key][2],d.thresholds?.length||0);
      for(const hit of d.thresholds||[])assert(record.textUrls[hit.document]&&hit.quote&&Number.isFinite(hit.value),key);
    }
  }
  assert.deepEqual(nationalIds.sort(),[...records.keys()].sort());
  assert.deepEqual(Object.keys(official).sort(),[...gazette.records.map(r=>r.id),...uk.records.map(r=>'uk:'+r.id),...eu.records.map(r=>'eu:'+r.id)].sort());
  const shards=new Map();
  for(const [key,entry] of Object.entries(official)){
    assert(entry.state&&entry.source,key);
    if(!entry.wordingShard)continue;
    const bucket=entry.wordingShard;
    assert.match(bucket,/^[a-f0-9]{2}$/);
    if(!shards.has(bucket))shards.set(bucket,JSON.parse(gunzipSync(await readFile(join(data,'wording',bucket+'.json.gz')))));
    assert.equal(shards.get(bucket)[key].length,entry.sections,key+' source text');
  }
  assert.equal(coverage.officialRecords,Object.keys(official).length);
  const links=await json('publisher-matches.json'),supplements=new Map();
  let primary=0;
  for(const [id,entry] of Object.entries(index.records))if(entry[0]||links[id]?.hasText)primary++;
  assert.equal(coverage.nationalWithPrimaryText,primary);
  for(const [id,record] of Object.entries(links)){
    assert(records.has(id));webUrl(record.sourceUrl);
    if(record.key){assert(official[record.key]);continue;}
    assert.match(record.shard,/^\d$/);
    if(!supplements.has(record.shard))supplements.set(record.shard,JSON.parse(gunzipSync(await readFile(join(data,'national-wording',record.shard+'.json.gz')))));
    assert.equal(supplements.get(record.shard)[id].length,record.sections);
  }
  const truth=new Set(['eq','neq','lt','lte','gt','gte']);
  for(const [field,n] of Object.entries(coverage.fields)){
    assert.match(field,/^[a-zA-Z]+$/);
    const list=await json('predicates/'+field+'.json');assert.equal(list.length,n);
    for(const hit of list){assert(hit.section&&hit.quote&&truth.has(hit.op)&&Number.isFinite(hit.value));assert(official[hit.doc]||records.has(hit.doc.replace(/^world:/,'')));}
  }
  const imo=await json('imo-history.json'),imoIds=new Set(imo.instruments.map(r=>r.id));
  for(const [key,original] of Object.entries(treaties)){
    const pages=await pdf(original.pdf,original.sha256);webUrl(original.sourceUrl,['treaties.un.org','assets.publishing.service.gov.uk','wwwcdn.imo.org','www.legislation.gov.uk']);
    assert(imoIds.has(key),key+' missing IMO catalogue record');
    if(original.pageFile)assert.equal(original.pageFile,key+'.json.gz');
    const transcript=wording[key]||JSON.parse(gunzipSync(await readFile(join(data,'treaty-pages',original.pageFile))));
    assert.equal(transcript.length,pages,key+' published page count');
  }
  const ca=await json('ca-arctic.json'),caPages=await pdf(ca.pdf,ca.sha256);
  assert(ca.pages.length&&ca.pages.every((p,i)=>p>0&&p<=caPages&&(!i||p===ca.pages[i-1]+1)));
  assert(ca.text.includes('Chapter XIV of SOLAS')&&ca.text.includes('mechanical means of propulsion'));
  day(ca.effectiveFrom);day(ca.verifiedThrough);
  async function norwegian(id){
    const meta=gazette.records.find(r=>r.id===id);
    return (await json(meta.shard)).records.find(r=>r.id===id);
  }
  const fieldKeys=new Set((await json('boat-fields.json')).fields.map(f=>f.key));
  const implementations=[...domesticImplementations(await norwegian('SF/forskrift/2014-07-01-1072'),await json('uk-navigation.json'),
    await norwegian('SF/forskrift/2012-05-30-488'),ca),...registeredScopes(treaties,wording,imo)];
  for(const f of [...implementationFields,...treatyFields]){
    assert(implementations.find(d=>d.version.id===f.source.versionId)?.sections.some(s=>s.id===f.source.sectionId),f.key+' field citation');
  }
  for(const d of implementations)for(const s of d.sections){
    assert(s.text?.trim()&&s.sourceUrl,d.key);
    assert(leaves(s.criteria).every(rule=>fieldKeys.has(rule.field)&&rule.source),s.id);
    if(s.incorporates)assert(imo.instruments.some(i=>i.id===s.incorporates.instrument),s.title);
  }
  const logic=await json('clause-index.json');
  assert.deepEqual(Object.keys(logic.records).sort(),[...Object.keys(official),...[...records.keys()].map(id=>'world:'+id),...Object.keys(treaties).map(id=>'imo:'+id)].sort());
  const summaries=Object.values(logic.records);
  assert.equal(summaries.filter(r=>r.statements>0).length,logic.counts.recordsWithConditions);
  assert.equal(summaries.reduce((n,r)=>n+r.statements,0),logic.counts.conditionalStatements);
  for(const key of ['bound','partial'])assert.equal(summaries.reduce((n,r)=>n+(r[key]||0),0),logic.counts[key]);
  assert(summaries.every(r=>(r.bound||0)+(r.partial||0)<=r.statements));
  assert.deepEqual((await readdir(join(data,'condition-search'))).sort(),Object.values(logic.collections).flat().sort());
  const searched=new Map();
  function validCondition(node){
    if(!node||typeof node!=='object')return false;
    if(node.wording)return typeof node.wording==='string';
    if(node.field)return fieldKeys.has(node.field)&&['eq','neq','gt','gte','lt','lte'].includes(node.op)&&Object.hasOwn(node,'value');
    if(node.not)return validCondition(node.not);
    const children=node.all||node.any;
    return Array.isArray(children)&&children.length>0&&children.every(validCondition);
  }
  for(const [code,files] of Object.entries(logic.collections)){
    assert(codes.has(code)||['EU','INT','OTHER'].includes(code),code);
    const fromThisCountry=new Map();
    for(const file of files){
      assert(file.startsWith(code+'-')&&/^[A-Z]+-\d+\.json\.gz$/.test(file));
      const entries=JSON.parse(gunzipSync(await readFile(join(data,'condition-search',file))));
      for(const [id,section,guard,outcome,condition] of entries){
        assert(logic.records[id]&&section&&guard&&outcome&&validCondition(condition),id+' condition and source link');
        fromThisCountry.set(id,(fromThisCountry.get(id)||0)+1);
      }
    }
    for(const [key,n] of fromThisCountry){assert.equal(n,logic.records[key].statements,key+' searchable conditions');searched.set(key,n);}
  }
  assert.equal(searched.size,logic.counts.recordsWithConditions);
  assert(geo.length>150&&geo.every(([code,label,path])=>code&&label&&/^M[0-9.,LZM-]+$/.test(path)));
  console.log(Object.keys(index.records).length+' national catalogue records reconciled; '+index.counts.recordsWithText+' have usable primary text renditions.');
}
const checked=await Promise.allSettled([
  checkFolios(codes),checkArchive(),checkWorld(),checkFlagSources(codes),checkTreaties(codes),
  checkBritishHistory(),checkEuropeanHistory(),checkLibrary()
]);
const errors=checked.filter(r=>r.status==='rejected').map(r=>r.reason);
if(errors.length)throw new AggregateError(errors,'Source validation failed');
const [mapped,notices,national,flags,treatyEvents,ukActs,euActs]=checked.map(r=>r.value);
const files=await walk(site);
for(const path of files.filter(p=>p.endsWith('.pdf')))assert(usedPdfs.has(resolve(path)),'Unreferenced source PDF '+path);
for(const file of ['index.html','.nojekyll'])assert((await stat(join(root,file))).isFile());
for(const file of ['index.html','js/app.js','vendor/pdfjs.mjs','vendor/pdf.worker.mjs','vendor/pdf-lib.mjs','vendor/LICENSES.txt','vendor/fonts.json','vendor/cmaps.json'])assert((await stat(join(site,file))).isFile());
console.log(mapped.versions+' mapped editions, '+notices+' Norwegian records, '+national+' national records and '+usedPdfs.size+' PDF assets verified.');
console.log(mapped.prints+' distinct published excerpts have cited screening or context. '+mapped.direct+' have section-level screening in every indexed edition. The others include partial rules, scope or reference material.');
console.log(mapped.clauses+' explicit clause outcomes in '+mapped.clauseSources+' distinct excerpts.');
console.log(flags+' flag directories, '+treatyEvents+' IMO events, '+ukActs+' UK acts and '+euActs+' EU acts verified.');
console.log(mapped.guides+' registry guide passages verified.');
