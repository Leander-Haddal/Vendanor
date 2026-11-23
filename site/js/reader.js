import {esc,marked,safeUrl,assess,describeRule,statusLabel,fold,queryParts,evidenceRows} from './model.js';
import {openImportPdf,openImportClip,revokeImportPdf} from './imports.js';
import {archiveExcerpt} from './verified-pdf.js';

let activeBlob='', turn=0;
export function releasePreview() {
  turn++;
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
  const state=section?assess(section,version,ctx.profile.values,ctx.profile.asOf):'review';
  const local=!!version.localId;
  const original=version.pdf?safeUrl(version.pdf,true):safeUrl(version.pdfUrl);
  const clip=section?.clip?safeUrl(section.clip,true):'';
  const bands=section?.bands;
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
    '<div class="actions">'+(doc.type==='uk'&&section?.sourceUrl?link('This provision at the publisher',section.sourceUrl,true):'')+link(doc.type==='world'?'Open catalogue record':'Publisher record',url,true)+(local&&version.hasPdf?'<button id="local-original">Open original PDF</button>':link(doc.type==='world'?'Open linked PDF':'Open original PDF',original,true))+
    (!original&&version.issuedPdfUrl?link('Original PDF as issued',version.issuedPdfUrl,true):'')+
    ((original||version.hasPdf||doc.type==='archive')?'<button id="find-pdf-passage">Find passage in PDF</button>':'')+
    (related.length?'<button id="compare-related">Compare revisions</button>':'')+
    (['archive','world'].includes(doc.type)?'<button id="attach-document">Attach a PDF locally</button>':'')+'</div>'+
    (version.sourceLinks?.length?'<details><summary>Additional source links</summary><div class="actions">'+[...new Set(version.sourceLinks)].map((url,i)=>link('Source '+(i+1),url,true)).join('')+'</div></details>':'')+
    (sections.length>1?'<label class="section-switch">Find within this document<input id="section-find" type="search" placeholder="Keyword or provision number"></label>':'')+
    (section?'<label class="section-switch">Provision<select id="section-choice"></select></label><div class="actions"><button id="previous-section">Previous</button><button id="next-section">Next</button><span class="small" id="section-count"></span></div>':'')+
    '<div class="tabs" aria-label="Reader mode"><button data-mode="text">Section text</button><button data-mode="pdf" '+(canPdf?'':'disabled')+'>'+((clip||local||bands)?'PDF excerpt':'Source PDF')+'</button><button data-mode="evidence">Scope &amp; history</button></div><div id="reader-body"></div>';
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
  const orig=container.querySelector('#local-original');
  if(orig)orig.onclick=async()=>{
    try{
      const newTab=window.open('about:blank','_blank');if(newTab)newTab.opener=null;
      const url=await openImportPdf(version.localId,pages[0]||1);
      if(newTab)newTab.location.replace(url);else ctx.notify('Allow a new tab to open the original PDF.');
      setTimeout(()=>revokeImportPdf(url),120000);
    }catch(error){ctx.notify(error.message);}
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
      const evidence=evidenceRows(section?.criteria,ctx.fields,ctx.profile.values);
      body.innerHTML='<h3>Vessel screening</h3><span class="badge '+state+'">'+esc(statusLabel(state))+'</span>'+
        '<div class="note"><p>'+esc(describeRule(section?.criteria,ctx.fields))+'</p>'+tryNotes(section?.caveat)+'</div>'+
        (evidence.length?'<details><summary>Conditions, vessel values and citations</summary><div class="source-list">'+
          evidence.map(e=>'<div><strong>'+esc(e.condition)+'</strong><p>'+esc(e.entered)+' · '+(e.tested===null?'Unknown':e.tested?'Condition met':'Condition unmet')+'</p><small>'+esc(e.source)+'</small></div>').join('')+'</div></details>':'')+
        (section?.survey && ctx.profile.values.lastSurveyDate?'<div class="note">Last qualifying survey entered: '+esc(ctx.profile.values.lastSurveyDate)+'. '+esc(section.survey.source)+' gives a '+esc(section.survey.intervalMonths)+'-month interval. A survey within the '+esc(section.survey.earlyWindowMonths)+'-month early window can preserve the previous anniversary. Check the certificate and the original clause.</div>':'')+
        '<h3>Edition evidence</h3><p>'+esc(bounds||'No verified effective interval is encoded for this edition.')+'</p>'+tryNotes(version.notes)+
        (version.verifiedThrough?'<p>Open-ended edition checked through '+esc(version.verifiedThrough)+'.</p>':'')+
        (doc.meta?.effectiveText?'<p><strong>Publisher commencement text</strong> '+esc(doc.meta.effectiveText)+'</p>':'')+
        (pages.length?'<p>Original page'+(pages.length===1?' ':'s ')+esc(pages.join(', '))+'</p>':'')+
        (version.pdfSha256?'<details><summary>Original PDF fingerprint</summary><div><code>'+esc(version.pdfSha256)+'</code></div></details>':'')+
        (doc.meta?.targets?.length?'<h3>Cited change targets</h3><p>'+esc(doc.meta.targets.join(' · '))+'</p>':'')+
        (related.length?'<h3>Related editions and notices</h3><div class="source-list">'+related.slice(0,80).map((item,i)=>'<button class="quiet" data-related="'+i+'">'+esc(item.label)+'</button>').join('')+'</div>':'');
      body.querySelectorAll('[data-related]').forEach(button=>button.onclick=()=>ctx.select(related[+button.dataset.related].key,''));
    }else{
      body.innerHTML='<div class="note">Opening PDF…</div>';
      try{
        let src=clip||original;
        if((local&&section)||bands){src=local?await openImportClip(version.localId,section.id):await archiveExcerpt(doc.original,bands);if(token!==turn){revokeImportPdf(src);return;}activeBlob=src;}
        if(token!==turn)return;
        const note=(clip||local||bands)?'Extract from the source PDF'+(pages.length?' · original page'+(pages.length>1?'s ':' ')+pages.join(', '):''):'Linked document. This record has no verified section clip.';
        body.innerHTML='<p class="small">'+esc(note)+'</p><p class="actions"><a class="button" target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a></p><iframe class="pdf-frame" title="PDF source excerpt"></iframe>';
        body.querySelector('a').href=src;body.querySelector('iframe').src=src;
      }catch(error){if(token===turn)body.innerHTML='<div class="note">'+esc(error.message)+'</div>';}
    }
  }
  for(const button of container.querySelectorAll('[data-mode]'))button.onclick=()=>switchMode(button.dataset.mode);
  switchMode(ctx.mode||'text');
}
