import {esc,marked,safeUrl,describeRule,fold,queryParts,evidenceRows,screeningRule,screeningValues} from './model.js';
import {openImportPdf,revokeImportPdf} from './imports.js';
import {mountPdfReader} from './pdf-reader.js';
import {extractClauses} from './clause-logic.js';

let activeBlob='', turn=0, closePdf;
export function releasePreview() {
  turn++;closePdf?.();closePdf=null;
  if(activeBlob){revokeImportPdf(activeBlob);activeBlob='';}
}
export function link(label,url,button=false) {
  const safe=safeUrl(url);
  return safe?'<a '+(button?'class="button" ':'')+'href="'+esc(safe)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':'';
}
function tryNotes(notes) {
  if(!notes)return '';
  return (Array.isArray(notes)?notes:[notes]).map(value=>'<p>'+esc(typeof value==='string'?value:JSON.stringify(value))+'</p>').join('');
}
export function sectionTitle(section) {
  if(!section)return 'Document';
  return [section.number||section.label,section.title].filter(Boolean).join(' · ')||section.id;
}

export function renderReader(container,doc,selected,ctx) {
  releasePreview();
  const {instrument,version,sections}=doc;
  const section=sections.find(s=>s.id===selected)||sections[0];
  const local=!!version.localId;
  const original=section?.sourcePdf?safeUrl(section.sourcePdf):version.pdf?safeUrl(version.pdf,true):safeUrl(version.pdfUrl);
  const pdfOptions=(version.pdfs||[]).map(url=>({url,label:new URL(url).pathname.split('/').pop()}));
  if(version.alternates?.length)pdfOptions.push({url:safeUrl(version.pdf,true),label:version.label},...version.alternates);
  if(pdfOptions.length&&original&&!pdfOptions.some(o=>o.url===original))pdfOptions.unshift({url:original,label:'Cited source PDF'});
  const clip=section?.clip?safeUrl(section.clip,true):'';
  const canPdf=Boolean(clip||original||(local&&version.hasPdf));
  const pages=section?.pages||[];
  const url=version.sourcePage || version.sourceUrl;
  const related=ctx.related(doc).filter(item=>item.key!==doc.key);
  const flags=ctx.treatyEditions(doc,section);
  const bounds=[version.effectiveFrom?'From '+version.effectiveFrom:'',version.effectiveTo?'Until '+version.effectiveTo+' (exclusive)':''].filter(Boolean).join(' · ');
  const firstTitle=instrument.title || version.label;
  container.innerHTML='<div class="overline">'+esc([instrument.jurisdiction,instrument.authority].filter(Boolean).join(' · '))+'</div><h2>'+esc(firstTitle)+'</h2>'+
    '<div class="facts"><span>'+esc(version.label||'Source edition')+'</span>'+(version.publishedOn?'<span>Published '+esc(version.publishedOn)+'</span>':'')+
    '<span>'+esc(instrument.language||'')+'</span></div>'+
    (flags.length>1?'<label class="section-switch">Flag record for this wording<select id="reader-flag-record">'+flags.map(f=>'<option value="'+esc(f.key)+'" '+(f.key===doc.key?'selected':'')+'>'+esc(f.label)+'</option>').join('')+'</select></label>':'')+
    '<div class="actions">'+(canPdf?'<button class="primary" id="read-original">Read PDF</button>':'')+
    (section?.sourceUrl?link('Publisher provision',section.sourceUrl,true):link('Publisher record',url,true))+
    (section?.editionKey?'<a class="button" href="#library?'+esc(new URLSearchParams({doc:section.editionKey}).toString())+'">Read edition text</a>':'')+
    ((original||version.hasPdf||doc.type==='archive')?'<button id="find-pdf-passage">Find passage in PDF</button>':'')+
    (related.length?'<button id="compare-related">Compare revisions</button>':'')+
    (['archive','world'].includes(doc.type)?'<button id="attach-document">Attach a PDF locally</button>':'')+'</div>'+
    (pdfOptions.length>1?'<label>Source PDF<select id="source-pdf-choice">'+pdfOptions.map(o=>'<option value="'+esc(o.url)+'">'+esc(o.label)+'</option>').join('')+'</select></label>':'')+
    (doc.type==='uk'&&version.wordingDate&&version.pdfUrl?'<p class="small">The linked PDF is the publisher’s print edition. The indexed wording is dated '+esc(version.wordingDate)+'.</p>':'')+
    (section?.sourcePdf&&doc.type==='imo'?'<p class="small">Source PDF · IMO treaty status book</p>':'')+
    (version.domestic?'<p class="small">Domestic edition · '+(version.domestic.key?'<a href="#library?'+esc(new URLSearchParams({doc:version.domestic.key}).toString())+'">'+esc(version.domestic.label)+'</a>':link(version.domestic.label,version.domestic.sourceUrl))+(version.domestic.editionDate?' · '+esc(version.domestic.editionDate):'')+'</p>':'')+
    (section?.mentions?'<p><a href="#library?'+esc(new URLSearchParams({doc:'imo:'+section.mentions}).toString())+'">Read the referenced treaty record</a></p>':'')+
    (section?.incorporates?'<div class="incorporation"><strong>Incorporates</strong> <a href="#library?'+esc(new URLSearchParams({doc:'imo:'+section.incorporates.instrument}).toString())+'">'+esc(section.incorporates.reference)+'</a><p>'+esc(section.incorporates.exclusions||'')+'</p></div>':'')+
    (version.sourceLinks?.length?'<details><summary>Additional source links</summary><div class="actions">'+[...new Set(version.sourceLinks)].map((url,i)=>link('Source '+(i+1),url,true)).join('')+'</div></details>':'')+
    (sections.length>1?'<label class="section-switch">Find within this document<input id="section-find" type="search" placeholder="Keyword or provision number"></label>':'')+
    (section?'<label class="section-switch">Provision<select id="section-choice"></select></label><div class="actions"><button id="previous-section">Previous</button><button id="next-section">Next</button><span class="small" id="section-count"></span></div>':'')+
    '<div class="tabs" aria-label="Reader mode"><button data-mode="text">Section text</button><button data-mode="pdf" '+(canPdf?'':'disabled')+'>'+'Source PDF'+'</button><button data-mode="evidence">Scope &amp; history</button></div><div id="reader-body"></div>';
  const sectionChoice=container.querySelector('#section-choice');
  const flagChoice=container.querySelector('#reader-flag-record');
  if(flagChoice)flagChoice.onchange=()=>ctx.select(flagChoice.value,section.id);
  if(sectionChoice){
    const find=container.querySelector('#section-find'),prev=container.querySelector('#previous-section'),next=container.querySelector('#next-section');
    let hits=[];
    function filterSections(value) {
      const parts=queryParts(value);
      hits=sections.map((s,i)=>({s,i})).filter(({s})=>{const text=fold(sectionTitle(s)+' '+s.text);return parts.every(p=>text.includes(p));});
      sectionChoice.innerHTML=hits.map(({s,i})=>'<option value="'+i+'" '+(s===section?'selected':'')+'>'+esc(sectionTitle(s).slice(0,210))+'</option>').join('');
      const pos=hits.findIndex(h=>h.s===section);
      if(pos<0)sectionChoice.selectedIndex=-1;
      prev.disabled=pos<=0;next.disabled=!hits.length||pos>=hits.length-1;
      container.querySelector('#section-count').textContent=hits.length+' of '+sections.length+' passages';
      prev.onclick=()=>ctx.select(doc.key,hits[pos-1].s.id);next.onclick=()=>ctx.select(doc.key,hits[pos+1].s.id);
    }
    if(find){find.value=ctx.within||'';find.oninput=()=>{ctx.setWithin(find.value);filterSections(find.value);};}
    filterSections(find?.value||'');
    sectionChoice.onchange=()=>ctx.select(doc.key,sections[Number(sectionChoice.value)].id);
  }
  const comp=container.querySelector('#compare-related');
  if(comp)comp.onclick=()=>ctx.compare(related[0].key,doc.key);
  const attach=container.querySelector('#attach-document');
  if(attach)attach.onclick=()=>ctx.importFor(doc);
  const finder=container.querySelector('#find-pdf-passage');
  if(finder)finder.onclick=async()=>{
    finder.disabled=true;let temporary='';
    try{
      let file;
      if(local&&version.hasPdf)temporary=await openImportPdf(version.localId,1);
      if(temporary||version.pdf){
        const response=await fetch(temporary||safeUrl(version.pdf,true));
        if(!response.ok)throw new Error('The source PDF could not be opened.');
        file=await response.blob();
      }
      const {openPassageFinder}=await import('./passage.js');
      if(container.contains(finder))await openPassageFinder({file,url:file?undefined:original,title:firstTitle,query:ctx.query,sourceText:doc.type==='world'?'':section?.text});
    }catch(error){ctx.notify(error.message);}finally{if(temporary)revokeImportPdf(temporary);finder.disabled=false;}
  };
  const body=container.querySelector('#reader-body');
  async function switchMode(mode) {
    releasePreview();const token=turn;
    if(mode==='pdf'&&!canPdf)mode='text';
    ctx.setMode(mode);
    for(const button of container.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
    if(mode==='text'){
      body.innerHTML=section?'<h3>'+esc(sectionTitle(section))+'</h3><div class="lawtext" lang="'+esc(instrument.language||'nb')+'">'+marked(section.text||'No searchable wording in this source section.',ctx.query)+'</div>':'<div class="note">No section text was supplied for this record. Open the publisher record for the original material.</div>';
    }else if(mode==='evidence'){
      const rule=section&&screeningRule(section,version,ctx.profile.asOf);
      const evidence=evidenceRows(rule,ctx.fields,ctx.profile.values,screeningValues(ctx.profile.values,version));
      const canExtract=section&&(section.id.startsWith('text-')||section.id.startsWith('publisher-')||doc.type==='archive'||doc.type==='folio'||doc.type==='imo'&&section.pages);
      const clauses=section?.extractedClauses||(canExtract?extractClauses(section.text):[]);
      body.innerHTML='<h3>Applicability</h3>'+
        '<div class="note"><p>'+esc(describeRule(rule,ctx.fields))+'</p>'+tryNotes(section?.caveat)+'</div>'+
        (evidence.length?'<details><summary>Conditions, vessel values and citations</summary><div class="source-list">'+
          evidence.map(e=>'<div><strong>'+esc(e.condition)+'</strong><p>'+esc(e.entered)+' · '+(e.tested===null?'Unknown':e.tested?'Condition met':'Condition unmet')+'</p><small>'+esc(e.source)+'</small></div>').join('')+'</div></details>':'')+
        (section?.survey && ctx.profile.values.lastSurveyDate?'<div class="note">Last qualifying survey entered: '+esc(ctx.profile.values.lastSurveyDate)+'. '+esc(section.survey.source)+' gives a '+esc(section.survey.intervalMonths)+'-month interval. A survey within the '+esc(section.survey.earlyWindowMonths)+'-month early window can preserve the previous anniversary. Check the certificate and the original clause.</div>':'')+
        (clauses.length?'<details><summary>Conditions in the source wording ('+clauses.length+')</summary><dl class="source-logic">'+clauses.map(c=>'<dt>'+esc(c.guard)+'</dt><dd>'+esc(c.outcome)+'</dd>').join('')+'</dl></details>':'')+
        '<h3>Edition evidence</h3><p>'+esc(bounds||'No verified effective interval is encoded for this edition.')+'</p>'+tryNotes(version.notes)+
        (version.verifiedThrough?'<p>Open-ended edition checked through '+esc(version.verifiedThrough)+'.</p>':'')+
        (doc.meta?.effectiveText?'<p><strong>Publisher commencement text</strong> '+esc(doc.meta.effectiveText)+'</p>':'')+
        (pages.length?'<p>Original page'+(pages.length===1?' ':'s ')+esc(pages.join(', '))+'</p>':'')+
        (version.pdfSha256?'<details><summary>Original PDF fingerprint</summary><div><code>'+esc(version.pdfSha256)+'</code></div></details>':'')+
        (doc.meta?.targets?.length?'<h3>Cited change targets</h3><p>'+esc(doc.meta.targets.join(' · '))+'</p>':'')+
        (related.length?'<h3>Related editions and notices</h3><div class="source-list">'+related.slice(0,80).map((item,i)=>'<button class="quiet" data-related="'+i+'">'+esc(item.label)+'</button>').join('')+'</div>':'');
      body.querySelectorAll('[data-related]').forEach(button=>button.onclick=()=>ctx.select(related[+button.dataset.related].key,''));
    }else{
      body.innerHTML='<p role="status">Opening PDF…</p>';
      try{
        const pick=container.querySelector('#source-pdf-choice');
        let src=pick?.value||original||clip;
        if(local){src=await openImportPdf(version.localId,1);if(token!==turn){revokeImportPdf(src);return;}activeBlob=src;}
        if(token!==turn)return;
        const start=pick&&pick.value!==original?1:ctx.page||section?.sourcePageNumber||pages[0];
        const passage=(pick&&pick.value!==original?'':ctx.passage)||(!start&&section&&/^(threshold-|condition-|text-|publisher-)/.test(section.id)?section.text:'');
        closePdf=mountPdfReader(body,src,start,firstTitle,passage);
      }catch(error){if(token===turn)body.textContent=error.message;}
    }
  }
  for(const button of container.querySelectorAll('[data-mode]'))button.onclick=()=>switchMode(button.dataset.mode);
  const originalButton=container.querySelector('#read-original'),pdfChoice=container.querySelector('#source-pdf-choice');
  if(originalButton)originalButton.onclick=()=>{switchMode('pdf');body.scrollIntoView({block:'nearest'});};
  if(pdfChoice){if([...pdfChoice.options].some(o=>o.value===original))pdfChoice.value=original;pdfChoice.onchange=()=>switchMode('pdf');}
  switchMode(ctx.mode||'text');
}
