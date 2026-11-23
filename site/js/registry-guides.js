import {esc,evaluate} from './model.js';
import {link} from './reader.js';

function originalPassage(row) {
  if(!row.documentUrl)return link('Publisher record',row.sourcePage,true);
  const page=row.pages?.[0],url=new URL(row.documentUrl);
  if(Number.isInteger(page)&&page>0)url.hash='page='+page;
  return link(page?'Open original · p. '+page:'Open official document',url.href,true);
}

export function registryGuides(book,flag,profile) {
  const rows=(book?.entries||[]).filter(row=>{
    if(row.flag!==flag)return false;
    if(!profile)return true;
    if(profile.asOf&&row.publishedOn&&row.publishedOn>profile.asOf)return false;
    if(profile.asOf&&row.issuedOn&&row.issuedOn>profile.asOf)return false;
    if(profile.asOf&&row.issuedMonth&&row.issuedMonth>profile.asOf.slice(0,7))return false;
    return !row.conditions||evaluate(row.conditions,profile.values)!==false;
  }).sort((a,b)=>(b.issuedOn||b.issuedMonth||'').localeCompare(a.issuedOn||a.issuedMonth||''));
  if(!rows.length)return '';
  const contents=rows.map(r=>'<details class="map-fold"><summary>'+esc([r.reference,r.title].filter(Boolean).join(' · '))+'</summary><div>'+
    '<p>'+esc([r.topic,r.authority,r.dateLabel||(r.issuedOn||r.issuedMonth?'Issued '+(r.issuedOn||r.issuedMonth):''),r.effectiveFrom?'Takes effect '+r.effectiveFrom:''].filter(Boolean).join(' · '))+'</p>'+
    '<p><strong>'+esc(r.provision)+'</strong> '+esc(r.summary)+'</p><p>'+esc(r.scope)+'</p><div class="owner-actions">'+
    originalPassage(r)+
    (r.sourcePage&&r.documentUrl!==r.sourcePage&&r.documentUrl?link('Issuing authority',r.sourcePage):'')+
    (r.dateSource&&![r.sourcePage,r.documentUrl].includes(r.dateSource)?link('Date evidence',r.dateSource):'')+'</div></div></details>').join('');
  const note='<p>Read the cited provision for its vessel definitions, exceptions and edition.</p>';
  return profile?'<details class="owner-card national-suggestions"><summary>Flag administration notices to check ('+rows.length+')</summary>'+note+contents+'</details>':'<h2>Flag administration notices</h2>'+note+contents;
}
