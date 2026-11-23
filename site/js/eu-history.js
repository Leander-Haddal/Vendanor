import {esc,fold} from './model.js';
import {link} from './reader.js';

function editionList(title,editions) {
  if(!editions.length)return '';
  return '<details class="map-fold"><summary>'+esc(title)+' ('+editions.length+')</summary><ul class="edition-list">'+
    editions.map(v=>'<li>'+link(v.kind+' · '+v.id,v.sourceUrl)+'<span>'+esc(v.date)+'</span></li>').join('')+'</ul></details>';
}

export function renderEuHistory(host,book) {
  host.innerHTML='<h2>EU shipping legislation</h2>';
  if(!book?.records?.length){host.insertAdjacentHTML('beforeend','<p>The EU edition index is unavailable.</p>');return;}
  const years=[...new Set(book.records.map(r=>r.date.slice(0,4)).filter(Boolean))].sort().reverse();
  host.insertAdjacentHTML('beforeend','<p>Search the Publications Office shipping directory and selected vessel regulations. An act’s own scope determines which boats it covers.</p>'+
    '<div class="map-filters"><label>Title or CELEX number<input type="search" data-find placeholder="For example, marine equipment"></label>'+
    '<label>Act year<select data-year><option value="">All years</option>'+years.map(y=>'<option>'+esc(y)+'</option>').join('')+'</select></label>'+
    '<label>Publication history<select data-type><option value="">All acts</option><option value="editions">Has a consolidated edition</option><option value="changes">Has a recorded change</option><option value="ended">Has an end-of-validity date</option></select></label></div>'+
    '<p data-count role="status"></p><div data-rows></div><button class="text-action" type="button" data-more>Show more acts</button>'+
    '<p>'+link('Publications Office data source',book.sourceUrl)+'</p>');
  const input=host.querySelector('[data-find]'),year=host.querySelector('[data-year]'),type=host.querySelector('[data-type]'),results=host.querySelector('[data-rows]'),more=host.querySelector('[data-more]');
  let limit=8;
  function draw() {
    const terms=fold(input.value).split(/\s+/).filter(Boolean);
    const rows=book.records.filter(r=>terms.every(t=>fold(r.title+' '+r.id).includes(t))&&(!year.value||r.date.startsWith(year.value))&&
      (!type.value||(type.value==='ended'?r.endDate&&r.endDate!=='9999-12-31':r[type.value].length)));
    host.querySelector('[data-count]').textContent=rows.length.toLocaleString('en')+(rows.length===1?' act':' acts');
    results.innerHTML=rows.slice(0,limit).map((r,i)=>'<details class="map-fold" data-index="'+i+'"><summary>'+esc(r.title)+'</summary><div></div></details>').join('')||'<p>No acts match these filters.</p>';
    for(const item of results.children)item.ontoggle=()=>{
      if(!item.open||item.dataset.loaded)return;
      const r=rows[+item.dataset.index];item.dataset.loaded='1';
      item.querySelector('div').innerHTML='<p>'+esc([r.id,r.date?'Document date '+r.date:'',r.endDate&&r.endDate!=='9999-12-31'?'End of validity '+r.endDate:''].filter(Boolean).join(' · '))+'</p>'+
        '<p>'+link('Open original act and published formats',r.sourceUrl,true)+'</p>'+
        editionList('Consolidated wording',r.editions)+editionList('Amendments, repeals and corrections',r.changes)+
        (!r.editions.length&&!r.changes.length?'<p>The index contains the original act. See the publisher record for further history.</p>':'');
    };
    more.hidden=rows.length<=limit;
  }
  host.querySelector('.map-filters').oninput=()=>{limit=8;draw();};more.onclick=()=>{limit+=16;draw();};draw();
}
