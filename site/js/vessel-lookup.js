const registryUrl = new URL('../data/vessels-no.json', import.meta.url);
const directoryApi = 'https://api.fiskeridir.no/vessel-api/api/v1/vessels/';
const recordUrl = 'https://www.wikidata.org/wiki/';
const searchApi = 'https://www.wikidata.org/w/api.php';
const queryApi = 'https://query.wikidata.org/sparql';
const qid = /^Q[1-9]\d{0,17}$/;
const fields = {flag:'Flag state',shipType:'Vessel type',lengthOverall:'Length overall',grossTonnage:'Gross tonnage',buildDate:'Year built',keelDate:'Keel laid'};
const shipTypes = {Q105999:'cargo',Q2055880:'passenger',Q1420024:'fishing',Q17096141:'recreational'};
let localRequest;

function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
}

function validImo(value) {
  if (!/^\d{7}$/.test(value)) return false;
  const sum = Array.from(value.slice(0,6), (digit, i) => Number(digit) * (7-i)).reduce((a,b) => a+b,0);
  return sum % 10 === Number(value[6]);
}

export function lookupQuery(input) {
  const value = String(input ?? '').trim();
  if (value.length < 2 || value.length > 90) throw new Error('Enter 2 to 90 characters from a name or identifier.');
  const imo = value.match(/^(?:IMO\s*[-:]?\s*)?(\d{7})$/i);
  if (imo) {
    if (!validImo(imo[1])) throw new Error('Check all seven IMO digits, including the final check digit.');
    return {value:imo[1],kind:'imo',search:'haswbstatement:P458='+imo[1]};
  }
  const mmsi = value.match(/^(?:MMSI\s*[-:]?\s*)?(\d{9})$/i);
  if (mmsi) return {value:mmsi[1],kind:'mmsi',search:'haswbstatement:P587='+mmsi[1]};
  if (/^(?:MMSI|IMO)\s*[-:]?\s*\d/i.test(value)) throw new Error('An IMO number has seven digits. A vessel MMSI has nine.');
  const clean = value.replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g,' ').trim();
  if (clean.length < 2) throw new Error('Enter a vessel name, registration mark or call sign.');
  return {value:clean,kind:'name',search:clean+' haswbstatement:P458|P587|P289'};
}

function fact(key, value, sourceUrl, explanation, referenceUrl = '') {
  return {key, value, label:fields[key], sourceUrl, explanation, referenceUrl};
}

export function registerMatches(book, query) {
  if (query.kind !== 'name') return [];
  const needle = normalized(query.value);
  const matches = [];
  for (const [id,name,mark,callSign,loa,gt,year] of book.rows) {
    const keys = [name,mark,callSign,id].map(normalized);
    const score = keys.includes(needle) ? 0 : keys.some(k => k.startsWith(needle)) ? 1 : keys[0].includes(needle) ? 2 : 3;
    if (score === 3) continue;
    const sourceUrl = directoryApi + id;
    const basis = 'Active Norwegian fishing-vessel register on ' + book.asOf + '.';
    const evidence = [fact('flag','NO',sourceUrl,basis,book.scopeUrl), fact('shipType','fishing',sourceUrl,basis,book.scopeUrl)];
    if (loa > 0) evidence.push(fact('lengthOverall',loa,sourceUrl,'Største lengde, in metres.',book.documentation));
    if (gt > 0) evidence.push(fact('grossTonnage',gt,sourceUrl,'Gross tonnage measured under the 1969 Tonnage Convention.',book.documentation));
    if (year) evidence.push(fact('buildDate',year,sourceUrl,'Hull construction year, with year precision.',book.documentation));
    matches.push({score,id,name,identifier:mark || callSign,sourceUrl,evidence,
      provider:'Norwegian Directorate of Fisheries',description:[mark,callSign].filter(Boolean).join(' · '),
      date:book.asOf,licenseUrl:book.licenseUrl,notes:[]});
  }
  return matches.sort((a,b) => a.score-b.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0,12);
}

async function jsonRequest(url, signal) {
  let result;
  try {
    result = await fetch(url, {signal, credentials:'omit', referrerPolicy:'no-referrer', headers:{Accept:'application/json'}});
  } catch (error) {
    if (error.name==='AbortError') throw error;
    throw new Error('Could not reach the source. Check the connection or enter the particulars below.');
  }
  if (result.status === 429) throw new Error('The source is limiting requests. Try again later or enter the details below.');
  if (!result.ok) throw new Error('The source returned HTTP ' + result.status + '. You can enter the details below.');
  const body = await result.json();
  if (body.error) throw new Error('The public source could not complete this search.');
  return body;
}

function localBook() {
  if (!localRequest) localRequest = jsonRequest(registryUrl).catch(error => { localRequest = undefined; throw error; });
  return localRequest;
}

async function wikiMatches(query, signal) {
  const url = new URL(searchApi);
  url.search = new URLSearchParams({action:'query',generator:'search',gsrsearch:query.search,gsrnamespace:'0',gsrlimit:'10',
    prop:'entityterms',wbetterms:'label|description',wbetlanguage:'en',format:'json',formatversion:'2',origin:'*'});
  const data = await jsonRequest(url,signal);
  return (data.query?.pages || []).filter(page => qid.test(page.title)).sort((a,b) => a.index-b.index).map(page => ({
    id:page.title,name:page.entityterms?.label?.[0] || page.title,description:page.entityterms?.description?.[0] || '',
    provider:'Wikidata',sourceUrl:recordUrl+page.title,
  }));
}

function wikiQuery(id) {
  if (!qid.test(id)) throw new Error('Invalid Wikidata vessel identifier.');
  return `SELECT DISTINCT ?ship ?kind ?value ?rank ?unit ?code ?basis ?end ?start ?when ?precision ?ref WHERE {
    VALUES ?ship { wd:${id} }
    {
      VALUES (?kind ?p ?ps) { ("imo" p:P458 ps:P458) ("mmsi" p:P587 ps:P587) ("flag" p:P8047 ps:P8047)
        ("gt" p:P1093 ps:P1093) ("length" p:P2043 ps:P2043) ("keel" p:P793 ps:P793) ("class" p:P289 ps:P289) }
      ?ship ?p ?statement . ?statement ?ps ?value ; wikibase:rank ?rank .
      FILTER(?kind != "keel" || ?value = wd:Q14592615)
      OPTIONAL { ?value wdt:P297 ?code }
      OPTIONAL { ?statement (pq:P518|pq:P459) ?basis }
      OPTIONAL { ?statement (psv:P1093|psv:P2043)/wikibase:quantityUnit ?unit }
    } UNION {
      VALUES ?value { wd:Q105999 wd:Q2055880 wd:Q1420024 wd:Q17096141 }
      ?ship p:P31 ?statement . ?statement ps:P31 ?declared ; wikibase:rank ?rank .
      ?declared wdt:P279* ?value . BIND("type" AS ?kind)
    }
    FILTER(?rank != wikibase:DeprecatedRank)
    OPTIONAL { ?statement pq:P582 ?end } OPTIONAL { ?statement pq:P580 ?start }
    OPTIONAL { ?statement pq:P585 ?when ; pqv:P585/wikibase:timePrecision ?precision }
    OPTIONAL { ?statement prov:wasDerivedFrom/pr:P854 ?ref }
  } LIMIT 181`;
}

function itemId(raw) {
  const value = String(raw || '').split('/').pop();
  return qid.test(value) ? value : '';
}

function refLink(value) {
  try {
    const url = new URL(value);
    return ['https:','http:'].includes(url.protocol) && !url.password && !url.username ? url.href : '';
  } catch { return ''; }
}

function currentClaims(rows, kind, today) {
  const timeSensitive = ['flag','mmsi','type','class'].includes(kind);
  const candidates = rows.filter(r => r.kind === kind && !r.rank?.endsWith('DeprecatedRank') &&
    (!r.start || r.start.slice(0,10) <= today) && (!r.end || r.end.slice(0,10) > today) &&
    (!timeSensitive || !r.when || (r.precision==='11' && r.when.slice(0,10)===today)));
  const preferred = candidates.filter(r => r.rank?.endsWith('PreferredRank'));
  return preferred.length ? preferred : candidates;
}

export function wikiVessel(candidate, bindings, today = new Date().toISOString().slice(0,10)) {
  if (!qid.test(candidate.id)) throw new Error('Invalid source record.');
  const rows = bindings.map(binding => Object.fromEntries(Object.entries(binding).map(([k,v]) => [k,v.value])))
    .filter(row => itemId(row.ship) === candidate.id);
  if (rows.length >= 181) throw new Error('This record has many conflicting or qualified statements. Check its source and enter the particulars below.');
  const evidence = [], notes = [];
  const sourceUrl = recordUrl+candidate.id;
  function unique(kind, select, label) {
    const values = new Map();
    for (const row of currentClaims(rows,kind,today)) {
      const value = select(row);
      if (value !== '' && value != null && !values.has(value)) values.set(value,row);
    }
    if (values.size > 1) notes.push(label+' has conflicting source values.');
    return values.size === 1 ? [...values][0] : [];
  }
  function add(kind, key, property, select, explanation) {
    const [value,row] = unique(kind,select,fields[key]);
    if (row) evidence.push(fact(key,value,sourceUrl+'#'+property,explanation,refLink(row.ref)));
  }
  const [imo] = unique('imo',r => validImo(r.value) ? r.value : null,'IMO number');
  const [mmsi] = unique('mmsi',r => /^\d{9}$/.test(r.value) ? r.value : null,'MMSI');
  const vessel = imo || currentClaims(rows,'type',today).length || currentClaims(rows,'class',today).length;
  if (!vessel) throw new Error('The record lacks evidence of an individual vessel. Use the source or enter the details below.');
  add('flag','flag','P8047',r => /^[A-Z]{2}$/.test(r.code || '') ? r.code : null,
    'Contributor-reported country of registry with no elapsed end date. Confirm the flag for your voyage.');
  add('type','shipType','P31',r => shipTypes[itemId(r.value)],'Reported ship type or its parent class. Check the statutory classification.');
  add('gt','grossTonnage','P1093',r => itemId(r.unit)==='Q199' && Number.isFinite(Number(r.value)) && Number(r.value)>0 ? Number(r.value) : null,
    'Wikidata gross tonnage, reported as a dimensionless quantity.');
  add('length','lengthOverall','P2043',r => itemId(r.basis)==='Q2358152' && itemId(r.unit)==='Q11573' && Number.isFinite(Number(r.value)) && Number(r.value)>0 ? Number(r.value) : null,
    'Metres, explicitly qualified as length overall.');
  if (rows.some(r => r.kind==='length') && !evidence.some(f => f.key==='lengthOverall')) notes.push('No unambiguous overall length qualified in metres.');
  add('keel','keelDate','P793',r => {
    if (itemId(r.value)!=='Q14592615' || !/^\d{4}-\d{2}-\d{2}T/.test(r.when || '')) return null;
    if (r.precision==='11') return r.when.slice(0,10);
    return r.precision==='9' || r.precision==='10' ? r.when.slice(0,4) : null;
  },'Reported keel-laying event. A year-only value preserves the uncertainty of a month- or year-precision source.');
  return {...candidate, sourceUrl, evidence, notes, date:today,
    identifier:imo ? 'IMO '+imo : mmsi ? 'MMSI '+mmsi : candidate.id};
}

async function wikiDetails(candidate,signal) {
  const url = new URL(queryApi);
  url.search = new URLSearchParams({format:'json',query:wikiQuery(candidate.id)});
  const data = await jsonRequest(url,signal);
  return wikiVessel(candidate,data.results?.bindings || []);
}

function element(tag, text) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

function sourceLink(label, href) {
  const link = element('a',label);
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}

function confirmedRecord(record, selected) {
  const evidence = record.evidence.filter(entry => selected.has(entry.key));
  return {name:record.name,identifier:record.identifier,values:Object.fromEntries(evidence.map(entry => [entry.key,entry.value])),
    provider:record.provider,sourceUrl:record.sourceUrl,date:record.date,evidence};
}

function showPreview(container, record, onSelect) {
  const title = element('h3',record.name);
  title.tabIndex = -1;
  const identity = element('p',[record.identifier,record.provider,record.date].filter(Boolean).join(' · '));
  const choices = element('fieldset');
  choices.append(element('legend','Choose particulars to apply'));
  const selected = new Set();
  for (const entry of record.evidence) {
    const row = element('div'), label = element('label'), control = element('input');
    control.type = 'checkbox'; control.value = entry.key;
    control.checked = record.provider !== 'Wikidata' || entry.key !== 'flag';
    if (control.checked) selected.add(entry.key);
    control.onchange = () => { if (control.checked) selected.add(entry.key); else selected.delete(entry.key); };
    const value = String(entry.value) + (entry.key==='lengthOverall'?' m':entry.key==='grossTonnage'?' GT':'');
    label.append(control, document.createTextNode(' '+entry.label+' · '+value));
    const evidence = element('p',entry.explanation+' ');
    evidence.append(sourceLink('Statement',entry.sourceUrl));
    if (entry.referenceUrl && entry.referenceUrl !== entry.sourceUrl) evidence.append(' · ',sourceLink('Reference',entry.referenceUrl));
    row.append(label,evidence); choices.append(row);
  }
  const apply = element('button',record.evidence.length?'Apply selected particulars':'Use vessel identity');
  apply.type = 'button'; apply.onclick = () => onSelect(confirmedRecord(record,selected));
  container.replaceChildren(title,identity,sourceLink('Open source record',record.sourceUrl));
  if (record.licenseUrl) container.append(' · ',sourceLink('Data licence',record.licenseUrl));
  if (record.provider==='Wikidata') container.append(element('p','Wikidata is contributor-supplied. Verify the claims against vessel documents.'));
  if (record.evidence.length) container.append(choices);
  else container.append(element('p','No supported particulars are recorded. You can enter them in the boat form.'));
  for (const note of record.notes) container.append(element('p',note));
  container.append(apply);
  title.focus({preventScroll:true});
}

export function mountVesselLookup(container, {onSelect}) {
  const form = element('form'), label = element('label','Vessel name, IMO, MMSI, register mark or call sign');
  const input = element('input'); input.type='search'; input.maxLength=90; input.required=true; input.autocomplete='off'; label.append(input);
  const providerLabel = element('label','Search in'), provider = element('select');
  for (const [value,text] of [['all','Both sources'],['no','Norwegian fishing register'],['wiki','Worldwide · Wikidata']]) {
    const option = element('option',text); option.value=value; provider.append(option);
  }
  providerLabel.append(provider);
  const submit = element('button','Search vessels'); submit.type='submit';
  const clear = element('button','Clear search'); clear.type='button';
  form.append(label,providerLabel,submit,clear);
  const status = element('p'), results = element('div'), preview = element('div');
  status.setAttribute('role','status'); preview.setAttribute('aria-live','polite');
  container.replaceChildren(form,status,results,preview);
  let turn = 0, detail = 0, controller, selection;
  clear.onclick = () => {
    ++turn; ++detail;
    controller?.abort(); selection?.abort();
    input.value = ''; status.textContent = '';
    results.replaceChildren(); preview.replaceChildren(); input.focus();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    controller?.abort(); selection?.abort();
    const ticket=++turn; ++detail;
    results.replaceChildren(); preview.replaceChildren();
    let query;
    try { query=lookupQuery(input.value); } catch (error) { status.textContent=error.message; return; }
    controller=new AbortController();
    const searchController=controller;
    const timeout=window.setTimeout(()=>searchController.abort(),18000);
    status.textContent='Searching vessel sources…';
    const failures=[],providers=[];
    let count=0;
    async function display(source, request) {
      try {
        const list=await request;
        if(ticket!==turn || !list.length)return;
        const group=element('section'); group.append(element('h3',source));
        for (const candidate of list) {
          const button=element('button',[candidate.name,candidate.description].filter(Boolean).join(' · '));
          button.type='button'; button.dataset.vesselChoice=candidate.id;
          button.onclick=async()=>{
            selection?.abort(); const choice=++detail;
            selection=new AbortController(); const selected=selection;
            const timer=window.setTimeout(()=>selected.abort(),22000);
            preview.replaceChildren(element('p','Opening vessel particulars…'));
            try {
              const record=candidate.evidence?candidate:await wikiDetails(candidate,selected.signal);
              if(ticket===turn&&choice===detail)showPreview(preview,record,onSelect);
            } catch(error) {
              if(ticket===turn&&choice===detail)preview.replaceChildren(element('p',error.name==='AbortError'?'Vessel details timed out. You can enter the details below.':error.message),sourceLink('Open source record',candidate.sourceUrl));
            } finally {window.clearTimeout(timer);}
          };
          group.append(button);
        }
        count+=list.length; results.append(group);
      } catch(error) {
        failures.push(source+': '+(error.name==='AbortError'?'request timed out.':error.message || 'unavailable.'));
      }
    }
    if(provider.value!=='wiki' && query.kind==='name') providers.push(display('Norwegian fishing register',localBook().then(book=>registerMatches(book,query))));
    if(provider.value!=='no') providers.push(display('Wikidata',wikiMatches(query,searchController.signal)));
    await Promise.all(providers);
    window.clearTimeout(timeout);
    if(ticket!==turn)return;
    status.textContent=[count?'Choose a vessel to review its particulars.':
      !providers.length?'The Norwegian snapshot supports names, call signs and registration marks. Select Worldwide for IMO or MMSI.':
      failures.length===providers.length?'The vessel search could not be completed.':
      failures.length?'The available source returned no matches. Try another name or enter the particulars below.':
      'No vessel found. Try another name or enter the particulars below.',...failures].join(' ');
  };
}
