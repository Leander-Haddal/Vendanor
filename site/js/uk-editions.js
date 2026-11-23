const host='www.legislation.gov.uk',cache=new Map();
const keyPrefix='uk-edition:';

export function editionKey(record,label) {return keyPrefix+record.id+'@'+label;}

export function resolveEdition(key,records) {
  if(!key?.startsWith(keyPrefix))return null;
  const [id,label]=key.slice(keyPrefix.length).split('@');
  const record=records.find(r=>r.id===id);
  const version=record?.versions.find(v=>v.label===label);
  return version?{record,version}:null;
}

function safeContents(url) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.hostname!==host||!parsed.pathname.includes('/contents/'))throw new Error('The source has no verified UK edition URL.');
  parsed.pathname=parsed.pathname.replace('/contents/','/')+'/data.xml';return parsed;
}

function directChild(node,name) {return [...node.children].find(c=>c.localName===name);}

function officialSection(value) {
  if(!value)return '';
  try{
    const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.hostname!==host||url.username||url.password)return '';
    url.protocol='https:';return url.href;
  }catch{return '';}
}

function sectionText(node,root=node) {
  const children=[...node.childNodes].map(child=>{
    if(child.nodeType===3){
      const text=child.textContent.replace(/[\t\r\n ]+/g,' ');
      return text.trim()||['Text','Emphasis','Strong','Span','Term','Definition','Citation'].includes(node.localName)?text:'';
    }
    if(child.nodeType!==1||['CommentaryRef','FootnoteRef','Commentaries','Footnotes','Metadata'].includes(child.localName)||child.localName==='Title'&&node===root)return '';
    if(child.localName==='Pnumber'){
      if(node===root)return '';
      const number=child.textContent.trim();
      return node.localName==='P1'?number+(child.getAttribute('PuncAfter')||'.')+' ':'('+number+') ';
    }
    const content=sectionText(child,root);
    return ['Text','Title','P','P1para','P2','P3','P4','P5','Para','ListItem','TitleBlock','Row'].includes(child.localName)?'\n'+content+'\n':content;
  });
  return children.join('').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function parseEdition(xml) {
  const source=new DOMParser().parseFromString(xml,'application/xml');
  if(source.querySelector('parsererror')||source.documentElement.localName!=='Legislation')throw new Error('The publisher did not return an edition in readable XML.');
  const sections=[];
  for(const node of source.getElementsByTagNameNS('*','P1')){
    const number=directChild(node,'Pnumber')?.textContent.trim(),id=node.getAttribute('id');
    if(!id||!number||node.closest('BlockAmendment,BlockExtract,Version,ExplanatoryNotes,Resources'))continue;
    const title=(directChild(node,'Title')||directChild(node.parentElement,'Title'))?.textContent.trim()||'';
    const text=sectionText(node);
    if(text)sections.push({id,number,title,text,matchKey:id,sourceUrl:officialSection(node.getAttribute('DocumentURI'))});
  }
  if(!sections.length)throw new Error('This edition is available in the publisher’s viewer. Structured provision text is unavailable for comparison.');
  return sections;
}

export async function loadUkEdition(key,records) {
  const choice=resolveEdition(key,records);if(!choice)return null;
  if(cache.has(key))return cache.get(key);
  const {record,version}=choice;
  const pending=(async()=>{
    if(version.format==='pdf'){
      const sections=[{id:'published',number:'Published edition',text:'The publisher supplies this edition as a PDF. Open the original to read its provisions.'}];
      return {key,type:'uk',sections,instrument:{id:record.id,title:record.title,jurisdiction:'GB',authority:'The National Archives',language:'en'},
        version:{id:key,label:version.label,sourceUrl:version.url,pdfUrl:version.pdfUrl,scanOnly:true,sections}};
    }
    const response=await fetch(safeContents(version.url),{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error('The National Archives could not supply this edition. Open the official timeline in Flag registers.');
    const sections=parseEdition(await response.text());
    return {key,type:'uk',sections,instrument:{id:record.id,title:record.title,shortTitle:record.title,jurisdiction:'GB',authority:'The National Archives',language:'en'},
      version:{id:key,label:'UK published edition · '+version.label,sourceUrl:version.url,sections,
        pdfUrl:['made','enacted','adopted'].includes(version.label)&&record.pdfKind==='Original publication PDF'?record.pdfUrl:'',
        issuedPdfUrl:record.pdfKind==='Original publication PDF'?record.pdfUrl:'',
        notes:'Wording for the selected publisher edition. Each dated link identifies a point on the official timeline.'}};
  })();
  if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(key,pending);
  try{return await pending;}catch(error){cache.delete(key);throw error;}
}
