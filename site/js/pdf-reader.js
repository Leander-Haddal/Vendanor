import {loadPdfSource} from './imports.js';

export function mountPdfReader(host,source,startPage,title,passage=''){
  let task,book,render,closed=false,epoch=0,current=1,zoom=1,manual=false;
  const initial=new URL(source,location.href);
  const anchor=new URLSearchParams(initial.hash.slice(1));
  const pinned=Boolean(startPage||anchor.get('page'));
  startPage=Math.max(1,Math.floor(startPage||Number(anchor.get('page'))||1));
  const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const words=passage.trim().split(/\s+/);
  const phrase=words.length>=6?normalize(words.slice(words.length>15?2:0,Math.min(words.length,17)).join(' ')):'';
  function locate(items){
    if(phrase.length<25)return [];
    const parts=items.filter(i=>i.str).map(item=>({item,text:normalize(item.str)}));
    const at=parts.map(p=>p.text).join('').indexOf(phrase);if(at<0)return [];
    let offset=0;
    return parts.filter(p=>{const start=offset;offset+=p.text.length;return start<at+phrase.length&&offset>at;}).map(p=>p.item);
  }
  initial.hash='';
  host.innerHTML='<div class="pdf-controls"><button type="button" data-prev aria-label="Previous PDF page">Previous</button>'+
    '<label>Page <input type="number" data-page min="1" step="1"></label><span data-total></span><button type="button" data-next aria-label="Next PDF page">Next</button>'+
    '<label>Zoom <select data-zoom><option value="1">Fit width</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>'+
    '<p class="small" data-status role="status">Opening PDF…</p><div class="pdf-sheet"></div><details class="pdf-transcript"><summary>Page text</summary><div class="lawtext"></div></details>';
  const el=s=>host.querySelector(s),sheet=el('.pdf-sheet'),pageNumber=el('[data-page]'),status=el('[data-status]');
  async function show(number){
    if(closed||!book)return;
    const turn=++epoch;render?.cancel();current=Math.max(1,Math.min(book.numPages,Math.trunc(number)||1));
    pageNumber.value=current;el('[data-prev]').disabled=current===1;el('[data-next]').disabled=current===book.numPages;
    status.textContent='Opening page '+current+'…';el('.lawtext').textContent='';
    try{
      const page=await book.getPage(current);if(closed||turn!==epoch)return;
      const base=page.getViewport({scale:1}),width=Math.max(220,Math.min(1440,sheet.clientWidth||700))*zoom;
      const scale=width/base.width,ratio=Math.min(2,window.devicePixelRatio||1),viewport=page.getViewport({scale:scale*ratio});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=width+'px';
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+', page '+current);
      render=page.render({canvasContext:canvas.getContext('2d'),viewport});await render.promise;
      if(closed||turn!==epoch)return;
      sheet.replaceChildren(canvas);status.textContent='';
      const wording=await page.getTextContent();if(closed||turn!==epoch)return;
      el('.lawtext').textContent=wording.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')||'This page has no text layer.';
      const hits=locate(wording.items);
      if(hits.length&&!manual){
        const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(238,176,45,.32)';
        let top=Infinity;
        for(const item of hits){
          const [x,y]=viewport.convertToViewportPoint(...item.transform.slice(4)),h=Math.max(3,item.height*scale*ratio);
          ctx.fillRect(x,y-h,item.width*scale*ratio,h*1.2);top=Math.min(top,(y-h)/ratio);
        }
        sheet.scrollTop=Math.max(0,top-sheet.clientHeight*.25);status.textContent='Passage highlighted on page '+current+'.';
      }
    }catch(e){if(!closed&&turn===epoch)status.textContent='This page could not be displayed.';}
  }
  function turnPage(number){manual=true;show(number);}
  el('[data-prev]').onclick=()=>turnPage(current-1);el('[data-next]').onclick=()=>turnPage(current+1);
  pageNumber.onchange=()=>turnPage(Number(pageNumber.value));el('[data-zoom]').onchange=e=>{manual=true;zoom=Number(e.target.value);show(current);};
  async function openAtPassage(){
    await show(startPage);
    if(pinned||phrase.length<34)return;
    try{
      for(let i=1;i<=book.numPages&&!closed&&!manual;i++){
        const page=await book.getPage(i),text=await page.getTextContent();
        if(closed||manual)return;
        if(locate(text.items).length){
          if(i!==current)await show(i);return;
        }
      }
      if(!closed&&!manual)status.textContent='Page 1 is open. The passage could not be located in this PDF’s text layer.';
    }catch{/* Manual navigation remains available when a text layer cannot be searched. */}
  }
  (async()=>{
    try{
      const pending=await loadPdfSource({url:initial.href});
      if(closed){await pending.destroy();return;}
      task=pending;book=await task.promise;if(closed)return;
      el('[data-total]').textContent='of '+book.numPages;pageNumber.max=book.numPages;openAtPassage();
    }catch{
      if(closed)return;
      host.querySelector('.pdf-controls').hidden=true;el('.pdf-transcript').hidden=true;
      status.textContent='Publisher-hosted PDF. If the publisher blocks embedding, choose a local copy to read it here.';
      const frame=document.createElement('iframe');frame.className='pdf-frame';frame.title=title;frame.src=initial.href+'#page='+startPage;
      const label=document.createElement('label');label.textContent='Open a local PDF copy';const file=document.createElement('input');file.type='file';file.accept='application/pdf,.pdf';label.append(file);sheet.replaceChildren(label,frame);
      file.onchange=async()=>{const local=file.files[0];if(!local)return;try{task=await loadPdfSource({data:new Uint8Array(await local.arrayBuffer())});if(closed){await task.destroy();return;}book=await task.promise;if(closed)return;
        host.querySelector('.pdf-controls').hidden=false;el('.pdf-transcript').hidden=false;el('[data-total]').textContent='of '+book.numPages;pageNumber.max=book.numPages;openAtPassage();
      }catch{if(!closed)status.textContent='This file could not be read as a PDF.';}};
    }
  })();
  return ()=>{closed=true;epoch++;render?.cancel();task?.destroy().catch(()=>{});};
}
