import {esc,isoDay} from './model.js';
import {link} from './reader.js';
import {inspectPdf,savePdf,importPack,exportPack,removeImport} from './imports.js';

function field(label,name,type='text',value='') {
  return '<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"></label>';
}

function download(blob) {
  const url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url;anchor.download='ship-law-library.json';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function formMarkup(prefill) {
  return '<form id="document-import" class="stack"><label>Original PDF<input required type="file" name="file" accept=".pdf,application/pdf"></label>'+
    '<div class="form-grid">'+field('Document title','title','text',prefill.title)+field('Issuing authority','authority','text',prefill.authority)+
    field('Jurisdiction','jurisdiction','text',prefill.jurisdiction)+field('Publication date','date','date',isoDay(prefill.date))+
    field('Revision label','revision')+field('Language','language','text',prefill.language)+field('Publisher URL','sourceUrl','url',prefill.sourceUrl)+
    field('Document family ID','familyId','text',prefill.familyId)+'</div>'+
    '<p class="small">Use the same family ID for successive editions. Each PDF page becomes searchable unless you define provisions below.</p>'+
    '<details><summary>Define provisions, dates and vessel conditions</summary><div class="stack">'+
    '<div class="form-grid">'+field('Effective from','effectiveFrom','date')+field('Effective until (exclusive)','effectiveTo','date')+'</div>'+
    '<label>Provisions (JSON array)<textarea name="sections" rows="5" spellcheck="false" placeholder=\'[{"key":"art-1","label":"Article 1","fromPage":1,"toPage":1,"top":0.1,"bottom":0.7}]\'></textarea></label>'+
    '<p class="small">Page numbers start at 1. Top and bottom are fractions of the first and last page measured from the top. For a scan, add a text property with your transcription.</p>'+
    '<label>Vessel field definitions (JSON array)<textarea name="fields" rows="3" spellcheck="false" placeholder=\'[{"key":"draft","label":"Draught","type":"number","unit":"m"}]\'></textarea></label>'+
    '<p class="small">A provision may include a criteria object using field, op and value. Supported operators are eq, neq, lt, lte, gt and gte. Nest conditions under all, any or not.</p></div></details>'+
    '<button class="primary" type="submit">Index PDF on this device</button><p class="small" id="import-status" role="status"></p></form>';
}

export function renderSources(container,ctx) {
  const {imports,gazette,catalogues,originals,worldBook,prefill={}}=ctx;
  const counts=catalogues.map(c=>{
    const versions=c.instruments.flatMap(i=>i.versions),flags=c.instruments.filter(i=>i.flagState);
    return {name:c.collectionName||'Source',flags:flags.length,editions:versions.length,originals:new Set(versions.map(v=>v.pdf).filter(Boolean)).size,
      passages:new Set(versions.flatMap(v=>v.sections.map(s=>s.clip).filter(Boolean))).size,credit:c.reuse?.credit||'',licence:c.reuse?.licence};
  });
  const totalOriginals=Object.keys(originals.records||{}).length;
  const archiveCount=gazette.records.length;
  container.innerHTML='<div class="workspace-heading"><div><h1>Sources &amp; imports</h1><p>Inspect public coverage and keep your own legal sources on this device.</p></div></div>'+
    '<div class="two-col"><div class="surface stack"><h2>Published collections</h2>'+
    counts.map(c=>'<div><strong>'+esc(c.name)+'</strong><p>'+c.originals+' distinct original PDF'+(c.originals===1?'':'s')+' · '+c.passages+' distinct passage PDFs'+
      (c.flags?' · '+c.flags+' flags and territories with dated records':' · '+c.editions+' publication records')+'.</p>'+(c.credit?'<p class="small">'+esc(c.credit)+' '+link('Reuse licence',c.licence)+'</p>':'')+'</div>').join('')+
    '<div><strong>Norwegian maritime archive</strong><p>'+archiveCount.toLocaleString('en')+' notices and consolidated records. '+totalOriginals+' archive originals are available locally. The archive includes records selected by issuing authority, statutory authority and amendment links. Coverage varies by date and publisher.</p>'+
    link('Lovdata public archives','https://api.lovdata.no/publicData')+' · '+link('NLOD 2.0','https://data.norge.no/nlod/en/2.0')+' · '+link('Norwegian Maritime Authority','https://www.sdir.no/en/legislation/')+' · '+link('EU Official Journal','https://eur-lex.europa.eu/oj/direct-access.html')+'</div>'+
    '<details><summary>Archive coverage and release metadata</summary><div><pre>'+esc(JSON.stringify(gazette.coverage||{},null,2))+'</pre></div></details>'+
    '<div><h3>FAOLEX national catalogue</h3><p><span id="sources-national-count">'+worldBook.records.length.toLocaleString('en')+'</span> selected descriptions of national legal instruments. FAOLEX metadata © FAO, adapted under CC BY-NC-SA 3.0 IGO. Linked documents retain their respective terms.</p>'+
    link('FAOLEX','https://www.fao.org/faolex/en/')+' · '+link('Licence','https://creativecommons.org/licenses/by-nc-sa/3.0/igo/')+'</div>'+
    '<div><h3>Edition and treaty histories</h3><p>'+ctx.uk.records.length.toLocaleString('en')+' UK instruments · '+ctx.eu.records.length.toLocaleString('en')+' EU acts · '+ctx.imo.instruments.length+' IMO instruments and codes. Open Flag registers for individual publications and treaty records.</p>'+
    '<a href="#map?country=GB">UK timelines</a> · <a href="#map?country=EU">EU editions</a> · <a href="#map?country=all">IMO instruments</a></div>'+
    '<p class="small">Source year uses publication dates where available, the instrument date for undated archive publications and the catalogue year for national records. Effective intervals and construction and survey dates have separate meanings.</p></div>'+
    '<div class="surface stack"><h2>Uploaded documents</h2>'+(ctx.storageError?'<div class="note">'+esc(ctx.storageError)+'</div>':'')+
    (imports.length?'<div class="source-list">'+imports.map((d,i)=>'<div><strong>'+esc(d.title)+'</strong><p class="small">'+esc([d.revision,d.jurisdiction,d.date].filter(Boolean).join(' · '))+' · '+d.sections.length+' sections</p><div class="actions"><button data-open="'+i+'">Read</button><button data-export="'+i+'">Export</button><button data-remove="'+i+'">Remove</button></div></div>').join('')+'</div><button id="export-all">Export my library</button>':'<p>No private documents on this device.</p>')+
    '<label>Restore a library pack<input type="file" id="pack-file" accept=".json,application/json"></label><p class="small" id="pack-status" role="status"></p></div></div>'+
    '<div class="surface stack"><h2>Import a legal PDF</h2><p>PDF bytes, extracted text and vessel particulars stay in your browser. Export a library pack to back up documents or transfer them to another device.</p>'+formMarkup(prefill)+'</div>';
  const form=container.querySelector('#document-import'), status=container.querySelector('#import-status');
  const fileInput=form.elements.namedItem('file');
  fileInput.onchange=()=>{
    if(fileInput.files[0]&&!form.elements.title.value)form.elements.title.value=fileInput.files[0].name.replace(/\.pdf$/i,'');
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const submit=form.querySelector('[type=submit]'), file=fileInput.files[0];
    if(!file||submit.disabled)return;
    submit.disabled=true;
    try {
      const input=new FormData(form), metadata={};
      for(const name of ['title','authority','jurisdiction','date','revision','language','sourceUrl','familyId','effectiveFrom','effectiveTo'])metadata[name]=String(input.get(name)||'').trim();
      for(const name of ['sections','fields'])if(input.get(name)?.trim())metadata[name]=JSON.parse(input.get(name));
      status.textContent='Reading PDF…';
      const inspection=await inspectPdf(file,(page,total)=>{status.textContent='Indexing page '+page+' of '+total+'…';});
      const saved=await savePdf(file,metadata,inspection);
      await ctx.refreshImports();ctx.notify('Indexed '+saved.sections.length+' sections on this device.');ctx.openLocal(saved);
    } catch(error){status.textContent=error.message;} finally{submit.disabled=false;}
  };
  container.querySelector('#pack-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    const localStatus=container.querySelector('#pack-status');localStatus.textContent='Validating library pack…';
    try{await importPack(file);await ctx.refreshImports();ctx.notify('Library pack restored.');ctx.redraw();}
    catch(error){localStatus.textContent=error.message;event.target.value='';}
  };
  container.onclick=async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.hasAttribute('data-open'))ctx.openLocal(imports[+button.dataset.open]);
      if(button.hasAttribute('data-export'))download(await exportPack([imports[+button.dataset.export].id]));
      if(button.id==='export-all')download(await exportPack());
      if(button.hasAttribute('data-remove')){
        const doc=imports[+button.dataset.remove];
        if(!confirm('Remove “'+doc.title+'” from this browser?'))return;
        await removeImport(doc.id);await ctx.refreshImports();ctx.redraw();
      }
    }catch(error){ctx.notify(error.message);}
  };
}
