function node(tag, text = '', className = '') {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

export function pageCitation(numbers) {
  const pages = [...new Set((numbers || []).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i];
    while (pages[i + 1] === pages[i] + 1) i++;
    ranges.push(start === pages[i] ? String(start) : start + '–' + pages[i]);
  }
  return ranges.length ? (pages.length === 1 ? 'page ' : 'pages ') + ranges.join(', ') : '';
}

export function sourceWording(section, catalogue, documentTitle) {
  let text = String(section.text || '').trim();
  if (catalogue) return {heading: documentTitle, paragraphs: text.split(/\n\s*\n/).filter(p => p && p !== documentTitle)};
  const number = section.number || section.label || '';
  const title = section.title || '';
  const first = text.split('\n', 1)[0].trim();
  const compare = value => String(value).normalize('NFC').replace(/[\s.·]+/g, ' ').trim().toLocaleLowerCase();
  let heading = number || title || 'Source passage';
  if (first && [number, title, [number, title].filter(Boolean).join(' ')].some(value => value && compare(value) === compare(first))) {
    heading = number && compare(first) === compare(title) && compare(number) !== compare(title) ? number + ' · ' + first : first;
    text = text.slice(text.indexOf(first) + first.length).trimStart();
  } else if (number && title && !number.toLowerCase().includes(title.toLowerCase())) {
    heading = number + ' · ' + title;
  }
  // Split only at the source's paragraph boundaries or numbered subsection starts.
  const paragraphs = text.split(/\n[ \t]*\n+|\n(?=\(\d+[a-z]?\)\s)/u).filter(p => p.trim());
  return {heading, paragraphs};
}

export function originalPassageControl(doc, section, phrase, feedback, locate) {
  const {version}=doc;
  const pdf=Boolean(version.pdf||version.pdfUrl||version.hasPdf||section.sourcePdf);
  const control=node('a'),caption=node('span','','source-location');
  let page=section.pages?.[0]||section.sourcePageNumber,pending=Boolean(locate);
  function setPage(number){
    if(Number.isInteger(number)&&number>0)page=number;
    const params=new URLSearchParams({doc:doc.key,section:section.id,mode:pdf?'pdf':'text'});
    if(pdf&&page)params.set('page',page);
    if(pdf&&phrase)params.set('at',phrase.slice(0,220));
    control.href='#library?'+params;
    caption.textContent=pdf?(page?'Read original page '+page:'Read original PDF'):'Read source provision';
  }
  setPage(page);
  if(pending)control.onclick=async event=>{
    if(!pending||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();pending=false;try{setPage(await locate());}catch{/* Use the first source page. */}
    if(control.isConnected)location.hash=control.hash;
  };
  return {control,caption,setPage};
}
