import {esc,fold} from './model.js';
import {link} from './reader.js';

const references=[
  ['IMO information services','https://www.imo.org/en/knowledgecentre/pages/findinformation.aspx'],
  ['ILO maritime labour country profiles','https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:80020:0::NO:::'],
  ['United Nations maritime legislation and treaties','https://www.un.org/Depts/los/LEGISLATIONANDTREATIES/index.htm'],
  ['DNV rules, standards and archives','https://www.dnv.com/rules-standards/'],
  ['DNV statutory and flag-state services','https://www.dnv.com/services/statutory-and-flag-state-services-3735/'],
  ['Bureau Veritas flag recognition directory','https://marine-offshore.bureauveritas.com/flag-recognition/flags'],
  ['Bureau Veritas classification rules and guidance','https://marine-offshore.bureauveritas.com/rules-classification-rule-notes-and-guidance-notes']
];

export function countryCode(value,countries) {
  const v=String(value||'').toUpperCase();
  return countries.find(c=>c.code===v||c.alpha3===v||c.name.toUpperCase()===v)?.code||v;
}
export function jurisdictionDesk(container,{countries,records,params,navigate,scopeCountry}) {
  const counts=new Map();
  for(const r of records)for(const code of r.codes)counts.set(code,(counts.get(code)||0)+1);
  const initial=params.get('country')||'',society=params.get('society')||'';
  container.innerHTML='<div class="workspace-heading"><div><h1>Jurisdictions &amp; class</h1><p>Find national legal sources and evidence of delegated survey or certification work.</p></div></div>'+
    '<div class="surface stack"><div class="comparison-inputs"><label>Find a country or area<input id="country-lookup" type="search" placeholder="Name or country code"></label>'+
    '<label>Documented delegation<select id="society-filter"><option value="">All jurisdictions</option><option value="either">DNV or Bureau Veritas</option><option value="DNV">DNV</option><option value="BV">Bureau Veritas</option></select></label></div><span id="country-count" class="small"></span></div>'+
    '<div class="workgrid"><aside class="listpane" id="country-list" aria-label="Country directory"></aside><article class="reader" id="country-detail"></article></div>'+
    '<div class="surface"><h2>International and class references</h2><p>Classification rules and flag-state authorizations cover different functions. Each delegation below links to evidence and gives its scope. A missing entry means that evidence has yet to be indexed here.</p><div class="actions">'+references.map(([l,u])=>link(l,u,true)).join('')+'</div></div>';
  const input=container.querySelector('#country-lookup'),filter=container.querySelector('#society-filter'),list=container.querySelector('#country-list'),detail=container.querySelector('#country-detail');
  filter.value=society;
  let active=initial||scopeCountry||'NO';
  function show(country) {
    if(!country){detail.innerHTML='<h2>No jurisdiction selected</h2>';return;}
    active=country.code;
    const recognitions=country.recognitions||[],count=counts.get(country.code)||0;
    detail.innerHTML='<div class="overline">'+esc([country.code,country.alpha3].filter(Boolean).join(' · '))+'</div><h2>'+esc(country.name)+'</h2>'+
      '<p>'+count.toLocaleString('en')+' national catalogue records in the current selection.</p>'+
      '<div class="actions"><button class="primary" id="see-laws">Search laws for this jurisdiction</button>'+link('ILO country profile',country.profileUrl,true)+'</div>'+
      '<h3>Documented recognized organizations</h3>'+(recognitions.length?recognitions.map(r=>'<div class="note"><strong>'+esc(r.society==='BV'?'Bureau Veritas':r.society)+'</strong><p>'+esc(r.scope)+'</p>'+link('Delegation source',r.sourceUrl)+'</div>').join(''):'<p>No DNV or Bureau Veritas delegation evidence indexed for this entry. Check the flag administration and the IMO sources below.</p>');
    detail.querySelector('#see-laws').onclick=()=>navigate('library',{country:country.code});
    for(const b of list.querySelectorAll('[data-code]'))b.setAttribute('aria-current',String(b.dataset.code===active));
  }
  function draw() {
    const term=fold(input.value),soc=filter.value;
    const items=countries.filter(c=>fold([c.name,c.code,c.alpha3].join(' ')).includes(term)&&(!soc||(c.recognitions||[]).some(r=>soc==='either'||r.society===soc)));
    container.querySelector('#country-count').textContent=items.length+' countries and areas';
    list.innerHTML=items.map(c=>'<button class="result" data-code="'+esc(c.code)+'"><strong>'+esc(c.name)+'</strong><span class="small">'+esc(c.code)+' · '+(counts.get(c.code)||0)+' catalogue records</span></button>').join('');
    show(items.find(c=>c.code===active)||items[0]);
  }
  input.oninput=draw;filter.onchange=draw;
  list.onclick=event=>{const b=event.target.closest('[data-code]');if(b)show(countries.find(c=>c.code===b.dataset.code));};
  draw();
}
