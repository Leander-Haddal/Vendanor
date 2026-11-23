import {dataUrl,readJson} from './archive.js';
import {describeRule} from './model.js';

export function catalogueSources(imo,uk,eu,originals,flags,guides,wording={}){
  const rows=[];
  function add(id,collection,title,country,year,sourceUrl,pdfUrl,sections,label,extra={}){
    const version={id,label,sourceUrl,pdfUrl,sections,...extra};
    rows.push({id,country,codes:country?[country]:[],title,collection,year,preview:label,searchText:[title,id,label,country,year].join(' '),
      doc:{key:id,type:collection,instrument:{title,jurisdiction:country||'International',authority:collection==='imo'?'International Maritime Organization':collection==='uk'?'The National Archives':collection==='eu'?'EUR-Lex':''},version,sections}});
  }
  for(const instrument of imo.instruments){
    const original=originals[instrument.id];
    const sections=instrument.entries.map((entry,i)=>({id:'event-'+i,number:entry.kind,title:entry.label,
      text:[entry.date,entry.status,entry.note,...(entry.resolutions||[])].filter(Boolean).join(' · ')||entry.label,sourceUrl:entry.sourceUrl,
      ...(entry.page?{sourcePdf:entry.sourceUrl,sourcePageNumber:entry.page}:{})}));
    if(original){
      const pages=wording[instrument.id]||[];
      sections.unshift(...pages.map((text,i)=>({id:i?'page-'+(i+1):'original',number:'Registered text · page '+(i+1),text,sourceUrl:original.sourceUrl,pages:[i+1]})));
      if(!pages.length)sections.unshift({id:'original',number:'Registered text',text:original.label,sourceUrl:original.sourceUrl,pages:[1]});
    }
    add('imo:'+instrument.id,'imo',instrument.title,'',instrument.entries.find(e=>e.date)?.date?.slice(0,4),instrument.sourceUrl,
      /\.pdf(?:#|$)/i.test(instrument.sourceUrl)?instrument.sourceUrl:'',sections,original?.label||'Treaty status and amendment history',
      original?{pdf:original.pdf,pdfSha256:original.sha256,treatyPages:original.pageFile,alternates:original.alternates,sourceLinks:[original.sourceUrl,instrument.sourceUrl,instrument.titleSource,...(original.alternates||[]).map(e=>e.url)].filter(Boolean)}:{});
    const row=rows.at(-1);
    row.events=sections.filter(s=>s.id.startsWith('event-')).map(s=>({id:s.id,label:s.title+' '+s.text}));
    row.searchText+=' '+row.events.map(e=>e.label).join(' ');
  }
  for(const r of uk.records){
    const sections=r.versions.map((v,i)=>({id:'edition-'+i,number:'Recorded edition',title:v.label,text:r.title+' · '+v.label,sourceUrl:v.url,
      editionKey:'uk-edition:'+r.id+'@'+v.label}));
    add('uk:'+r.id,'uk',r.title,'GB',r.year,r.sourceUrl,r.pdfUrl,sections,r.pdfKind||'UK legislation');
  }
  for(const r of eu.records){
    const editions=[r,...r.editions];
    const sections=editions.map((v,i)=>({id:'edition-'+i,number:v.kind||'Act as published',title:v.date,text:v.id+' · '+(v.date||''),sourceUrl:v.sourceUrl,
      sourcePdf:v.sourceUrl.replace('/TXT/','/TXT/PDF/')}));
    add('eu:'+r.id,'eu',r.title,'EU',r.date?.slice(0,4),r.sourceUrl,sections[0].sourcePdf,sections,'European Union legal act');
  }
  const pdfUrls=new Set();
  for(const item of guides.entries){
    pdfUrls.add(item.documentUrl);
    add('guide:'+item.id,'register',item.title,item.flag,item.issuedMonth?.slice(0,4),item.sourcePage,item.documentUrl,
      [{id:'passage',number:item.reference,title:item.provision,text:item.summary,pages:item.pages}],item.authority);
  }
  for(const flag of flags.flags)for(const [i,s] of flag.sources.entries()){
    if(!/\.pdf(?:[?#]|$)/i.test(s.url)||pdfUrls.has(s.url))continue;
    add('register:'+flag.code+'-'+i,'register',s.title,flag.code,'',s.url,s.url,[],s.kind);
  }
  return rows;
}

const detailCache=new Map();
const wordingCache=new Map();
async function readWording(bucket,folder='wording'){
  const allowed=folder==='treaty-pages'?/^[a-z0-9-]+$/:/^[0-9a-f]{1,2}$/;
  if(!allowed.test(bucket))throw new Error('Invalid source index.');
  const key=folder+'/'+bucket;
  if(!wordingCache.has(key)){
    const request=fetch(dataUrl(key+'.json.gz')).then(async r=>{
      if(!r.ok)throw new Error('Edition wording is unavailable.');
      const data=new Uint8Array(await r.arrayBuffer()),blob=new Blob([data]);
      return data[0]===31&&data[1]===139?new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json():JSON.parse(await blob.text());
    }).catch(e=>{wordingCache.delete(key);throw e;});
    wordingCache.set(key,request);
    if(wordingCache.size>5)wordingCache.delete(wordingCache.keys().next().value);
  }
  return wordingCache.get(key);
}
export async function publisherDocument(source,entry,fields){
  const doc=source.doc;
  if(doc.version.treatyPages){
    try{
      const pages=await readWording(doc.version.treatyPages.replace(/\.json\.gz$/,''),'treaty-pages');
      const sourceUrl=doc.version.sourceLinks[0];
      const sections=[...pages.map((text,i)=>({id:i?'page-'+(i+1):'original',number:'Published text · page '+(i+1),text,sourceUrl,pages:[i+1]})),...doc.sections.filter(s=>s.id.startsWith('event-'))];
      return {...doc,sections,version:{...doc.version,sections}};
    }catch{/* The PDF and publisher record can still be opened. */}
  }
  if(!entry)return doc;
  let wording;
  if(entry.wordingShard){try{wording=(await readWording(entry.wordingShard))[doc.key];}catch{/* Publisher links and PDF remain available. */}}
  const published=(wording||[]).map(([id,text])=>({id:'text-'+id,number:doc.type==='uk'?id.replaceAll('-',' '):text.split('\n',1)[0].slice(0,100)||'Text '+id,text}));
  const thresholds=(entry.thresholds||[]).map((r,i)=>({id:'threshold-'+i,number:'Source-text threshold',title:describeRule(r.when||r,fields),
    text:wording?.find(([id])=>id===r.section)?.[1]||r.quote,sourceUrl:entry.source,caveat:'Automated extraction. Other qualifications and exceptions require review.'}));
  const sections=[...published,...thresholds,...doc.sections];
  const label=entry.source?.match(/\/(\d{4}-\d{2}-\d{2})\/data\.xml$/)?.[1];
  return {...doc,sections,version:{...doc.version,sections,wordingKind:published.length?'source':'catalogue',wordingDate:label,
    label:label?'Wording as of '+label:doc.version.label,sourceLinks:[entry.source,...(doc.version.sourceLinks||[])].filter(Boolean)}};
}
export async function nationalDetail(id){
  const identifier=id.replace(/^world:/,''), shard=identifier.slice(-2);
  if(!/^\d{2}$/.test(shard))return null;
  if(!detailCache.has(shard)){
    const load=readJson(dataUrl('national/'+shard+'.json')).catch(error=>{detailCache.delete(shard);throw error;});
    detailCache.set(shard,load);
  }
  return (await detailCache.get(shard))[identifier];
}
export async function nationalDocument(r,fields,domestic,logic){
  let detail;try{detail=await nationalDetail(r.id);}catch{/* Original links remain readable if a shard is unavailable. */}
  const pdfs=[...new Set([r.pdfUrl,...(r.documentUrls||[]),domestic?.pdfUrl].filter(url=>url&&/\.pdf(?:[?#]|$)/i.test(url)))];
  const sections=[{id:'catalogue',number:'Catalogue record',text:[r.title,r.originalTitle!==r.title?r.originalTitle:'',r.preview,r.issuedDate,r.repealed?'Marked as repealed in FAOLEX':'',r.notes].filter(Boolean).join('\n\n')}];
  if(domestic?.shard){
    try{
      const local=(await readWording(domestic.shard,'national-wording'))[r.id.slice(6)]||[];
      sections.push(...local.map(([number,text,sourceUrl],i)=>({id:'publisher-'+i,number,text,sourceUrl})));
    }catch{/* The linked edition is still available at its publisher. */}
  }
  for(const [i,hit] of (detail?.thresholds||[]).entries())sections.push({id:'threshold-'+i,number:'Source-text threshold',title:describeRule(hit,fields),
    text:hit.quote,sourceUrl:detail.documents[hit.document].sourcePdf||r.textUrls[hit.document],sourcePageNumber:hit.page,sourcePdf:detail.documents[hit.document].sourcePdf||pdfs.find(p=>new URL(p).pathname.split('/').pop().replace(/\.pdf$/i,'')===new URL(r.textUrls[hit.document]).pathname.split('/').pop().replace(/\.txt$/i,'')),
    caveat:'An extracted threshold. The conditions, exceptions and effect of the surrounding provision require review.'});
  for(const [i,hit] of (detail?.catalogueThresholds||[]).entries())sections.push({id:'catalogue-threshold-'+i,number:'FAOLEX abstract · threshold',title:describeRule(hit,fields),text:hit.quote,sourceUrl:r.sourceUrl});
  if(logic?.shard){
    try{
      const clauses=(await readWording(logic.shard,'clauses'))[r.id]||[];
      for(const [i,c] of clauses.entries())sections.push({id:'condition-'+i,number:'Source condition '+(i+1),
        text:c.guard+'\n'+c.outcome,extractedClauses:[c],sourcePageNumber:c.page,sourcePdf:detail?.documents[c.document]?.sourcePdf,sourceUrl:detail?.documents[c.document]?.sourcePdf||r.textUrls[c.document],caveat:'Conditional wording extracted from the national text. Additional definitions and exceptions may apply.'});
    }catch{/* The source rendition and PDF remain available. */}
  }
  const treaties={SOLAS:'solas-1974',MARPOL:'marpol',STCW:'stcw-1978','STCW-F':'stcw-f-1995',COLREG:'colreg-1972',COLREGS:'colreg-1972','LOAD LINES CONVENTION':'load-lines-1966'};
  for(const [i,ref] of (detail?.catalogueReferences||[]).entries())sections.push({id:'reference-'+i,number:'FAOLEX abstract · treaty reference',title:ref.name,text:ref.text,sourceUrl:r.sourceUrl,mentions:treaties[ref.name]});
  return {key:r.id,type:'world',sections,instrument:{title:r.title,jurisdiction:r.countryName||r.country,authority:r.publisher||'FAOLEX',language:(r.languages||[]).join(', ')},
    version:{id:r.id,label:[r.kind,r.year].filter(Boolean).join(' · '),sourceUrl:r.sourceUrl,pdfUrl:r.pdfUrl,pdfs,domestic,wordingKind:sections.some(s=>s.id.startsWith('publisher-'))?'source':'catalogue',
      sourceLinks:[...(r.sourceWebsites||[]),...(r.textUrls||[])],sections,notes:[
        'National catalogue record. '+(detail?.thresholds?.length?'Extracted threshold passages are available.':'Vessel applicability has no verified rule in this index.'),
        ...(detail?[detail.documents.map((d,i)=>'Text rendition '+(i+1)+' · '+(d.method==='OCR'?'OCR transcription · '+d.pagesRead+' of '+d.pages+' pages':d.state)).join(' / ')]:[]),
        ...(logic?.statements?[logic.statements.toLocaleString('en')+' extracted conditional statements. '+(logic.bound||0).toLocaleString('en')+' have a condition expressed entirely with named filter fields.']:[]),
        ...(detail?.catalogueReviewed?['The FAOLEX abstract was checked for measured conditions and convention references.']:[])] }};
}
