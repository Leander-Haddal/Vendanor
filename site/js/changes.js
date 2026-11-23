import {esc,fold,safeUrl} from './model.js';
import {lineDiff,sectionDiff} from './diff.js';
import {sectionTitle,link} from './reader.js';
import {mountPdfReader} from './pdf-reader.js';

let generation=0;
let closers=[];
export function closeComparison(){
  generation++;
  for(const close of closers)close();
  closers=[];
}
function chooser(name,docs,key) {
  const active=docs.find(d=>d.key===key);
  const label=name==='before'?'Earlier source':'Later source';
  return '<label>'+label+'<input type="search" data-find="'+name+'" placeholder="Find by title, year or ID" aria-label="Find '+label.toLowerCase()+'"><select id="pick-'+name+'" aria-label="'+label+'"></select><span class="field-note" data-pick-label="'+name+'">'+esc(active?.label||'')+'</span></label>';
}

export async function renderChanges(container,ctx) {
  closeComparison();
  const token=++generation;
  const docs=ctx.choices();
  const presets=ctx.presets();
  const pair=ctx.params.get('pair');
  const selected=presets.find(p=>p.id===pair) || (!ctx.params.get('before')&&!ctx.params.get('after')?presets[0]:null);
  const before=ctx.params.get('before')||selected?.before||docs[1]?.key;
  const after=ctx.params.get('after')||selected?.after||docs[0]?.key;
  container.innerHTML='<div class="workspace-heading"><div><h1>Revision changes</h1><p>Compare the wording in two identified sources, one provision at a time.</p></div></div>'+
    '<div class="surface stack">'+(presets.length?'<label>Documented comparisons<select id="preset"><option value="">Choose a pair of sources</option>'+presets.map(p=>'<option value="'+esc(p.id)+'" '+(selected?.id===p.id?'selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select></label>':'')+
    '<div class="comparison-inputs">'+chooser('before',docs,before)+chooser('after',docs,after)+'</div><div class="actions"><button class="primary" id="run-compare">Compare sources</button><label class="inline"><input type="checkbox" id="show-same" style="width:auto"> Include unchanged provisions</label></div></div><div id="diff-output" aria-live="polite">Loading source wording…</div>';
  function fill(name,key,term='') {
    const select=container.querySelector('#pick-'+name);
    const matches=docs.filter(d=>fold(d.label+' '+d.key).includes(fold(term))).slice(0,120);
    const active=docs.find(d=>d.key===key);
    if(active&&!matches.some(d=>d.key===key))matches.unshift(active);
    select.innerHTML=matches.map(d=>'<option value="'+esc(d.key)+'" '+(d.key===key?'selected':'')+'>'+esc(d.label.slice(0,190))+'</option>').join('');
  }
  for(const [name,key] of [['before',before],['after',after]]){
    fill(name,key);
    container.querySelector('[data-find="'+name+'"]').oninput=event=>fill(name,container.querySelector('#pick-'+name).value,event.target.value);
    container.querySelector('#pick-'+name).onchange=event=>{container.querySelector('[data-pick-label="'+name+'"]').textContent=docs.find(d=>d.key===event.target.value)?.label||'';};
  }
  const preset=container.querySelector('#preset');
  if(preset)preset.onchange=()=>{const p=presets.find(v=>v.id===preset.value);if(p)ctx.navigate('changes',{before:p.before,after:p.after,pair:p.id});};
  container.querySelector('#run-compare').onclick=()=>ctx.navigate('changes',{before:container.querySelector('#pick-before').value,after:container.querySelector('#pick-after').value});
  const output=container.querySelector('#diff-output');
  try{
    if(!before||!after){output.textContent='Two source editions are needed for a comparison.';return;}
    const [a,b]=await Promise.all([ctx.getDoc(before),ctx.getDoc(after)]);
    if(token!==generation||!container.isConnected)return;
    if(!a||!b)throw new Error('One of these editions is unavailable.');
    const metadataOnly=d=>d.version.scanOnly||d.type==='register'||d.type==='world'&&d.version.wordingKind!=='source'||(['uk','eu'].includes(d.type)&&d.version.wordingKind==='catalogue')||
      d.type==='imo'&&!d.version.pdf;
    if(metadataOnly(a)||metadataOnly(b)){
      output.innerHTML='<p>Compare the original publications. A complete wording comparison is unavailable for this pair.</p><div class="compare-pickers source-pair"></div>';
      const pair=output.querySelector('.source-pair');
      for(const d of [a,b]){
        const card=document.createElement('article'),address=d.version.pdf?safeUrl(d.version.pdf,true):safeUrl(d.version.pdfUrl||d.version.issuedPdfUrl);
        card.innerHTML='<h3>'+esc(d.instrument.title)+'</h3><a href="#library?'+esc(new URLSearchParams({doc:d.key,mode:address?'pdf':'text'}).toString())+'">Read in Library</a>';
        pair.append(card);
        if(address){const host=document.createElement('div');card.append(host);closers.push(mountPdfReader(host,address,1,d.instrument.title));}
        else card.insertAdjacentHTML('beforeend',link('Publisher record',d.version.sourceUrl));
      }
      return;
    }
    const compareText=d=>d.version.wordingKind==='source'?d.sections.filter(s=>s.id.startsWith('text-')||s.id.startsWith('publisher-')):d.type==='imo'?d.sections.filter(s=>s.pages):d.sections;
    let left=compareText(a),right=compareText(b);
    if(selected?.leftSection&&selected?.rightSection){
      const l=left.find(s=>s.id===selected.leftSection),r=right.find(s=>s.id===selected.rightSection);
      if(l&&r){left=[{...l,matchKey:'mapped'}];right=[{...r,matchKey:'mapped'}];}
    }
    const files=sectionDiff(left,right);
    const changed=files.filter(f=>f.kind!=='unchanged').length;
    function draw(){
      const showSame=container.querySelector('#show-same').checked;
      const listing=files.filter(f=>showSame||f.kind!=='unchanged');
      const method=a.type==='uk'&&b.type==='uk'?'Matching uses the publisher’s provision identifiers. Each source opens the dated provision.':'Matching uses printed provision labels. An amendment notice describes edits and can differ in structure from a consolidated text.';
      output.innerHTML='<div class="note"><strong>'+changed+' changed provision'+(changed===1?'':'s')+'</strong> · '+files.length+' compared. '+esc(selected?.notes||method)+'</div>'+
        '<div class="diff-grid"><aside class="surface diff-index"><h2>Provisions</h2>'+listing.map((f,i)=>'<button class="quiet" data-jump="'+i+'">'+esc(sectionTitle(f.after||f.before).slice(0,75))+'</button>').join('')+'</aside><div>'+(!listing.length?'<div class="surface">No wording changes in this comparison.</div>':listing.map((f,i)=>'<details class="patch" id="diff-item-'+i+'"><summary class="patch-title"><span class="badge '+f.kind+'">'+f.kind+'</span>'+esc(sectionTitle(f.after||f.before))+'</summary><div></div></details>').join(''))+'</div></div>';
      listing.forEach((f,i)=>{
        const details=output.querySelector('#diff-item-'+i);
        function populate(){
          if(!details.open||details.dataset.ready)return;
          details.dataset.ready='1';
          const lines=lineDiff(f.before?.text,f.after?.text);
          const sourceLink=(label,doc,s)=>s?'<a href="#library?'+esc(new URLSearchParams({doc:doc.key,section:s.id}).toString())+'">'+label+' · '+esc(sectionTitle(s))+'</a>':'';
          details.querySelector('div').innerHTML='<div class="facts">'+sourceLink('Earlier source',a,f.before)+sourceLink('Later source',b,f.after)+'</div>'+
            lines.map(line=>'<div class="diff-line '+line.kind+'"><span>'+esc(line.left??'')+'</span><span>'+esc(line.right??'')+'</span><span>'+({add:'+',del:'−',same:' '}[line.kind])+'</span><span class="wording">'+esc(line.text)+'</span></div>').join('');
        }
        details.ontoggle=populate;
        if(i===0){details.open=true;populate();}
        output.querySelector('[data-jump="'+i+'"]').onclick=()=>{details.open=true;populate();details.scrollIntoView({block:'start'});details.querySelector('summary').focus({preventScroll:true});};
      });
    }
    container.querySelector('#show-same').onchange=draw;
    draw();
  }catch(error){if(token===generation)output.textContent=error.message;}
}
