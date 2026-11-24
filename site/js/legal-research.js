import {evaluate, fold, isoDay, queryParts, temporal} from './model.js';

export const eventKinds = {
  'entry-into-force':'Entry into force', application:'Application',
  'early-use':'Voluntary early use', adoption:'Adoption', acceptance:'Acceptance',
  expiry:'Expiry', 'reporting-year':'Reporting year', recommendation:'Recommended application',
  'edition-effective':'Edition takes effect', publication:'Publication',
  construction:'Construction threshold', delivery:'Delivery threshold', installation:'Installation threshold',
  survey:'Survey deadline', certification:'Certification deadline'
};

const operativeKinds = new Set(['entry-into-force','application','expiry','reporting-year','edition-effective',
  'construction','delivery','installation','survey','certification']);
const dateOnly = /^(?:\d{4}(?:-\d{2}-\d{2})?|\d{1,2}\.\d{1,2}\.\d{4})$/;
const dateInterval = /\b(\d{4}(?:-\d{2}-\d{2})?)\s*(?:through|to|til|[-–—])\s*(\d{4}(?:-\d{2}-\d{2})?)\b/i;
const yearInContext = /\b(?:in|for|i) (20\d{2})\b/i;

const numbers = {one:1, two:2, three:3, four:4, five:5, en:1, ett:1, to:2, tre:3, fire:4, fem:5};
const shipTypes = {
  cargo:/\b(?:cargo ships?|lasteskip)\b/i,
  passenger:/\b(?:passenger ships?|passasjerskip)\b/i,
  fishing:/\b(?:fishing (?:ships?|vessels?)|fiskefartoy|fiskeskip)\b/i,
  recreational:/\b(?:recreational craft|pleasure (?:craft|yachts?)|fritidsbat|fritidsfartoy)\b/i
};
const infinity = {min:-Infinity, max:Infinity, minInclusive:false, maxInclusive:false};

function anniversary(day, years) {
  const year = Number(day.slice(0,4)) + years;
  if (year < 1 || year > 9999) return '';
  const prefix = String(year).padStart(4,'0');
  return isoDay(prefix+day.slice(4)) || prefix+'-02-28';
}

export function parseDateRange(query, today) {
  query=fold(query);
  const relative = query.match(/\b(?:next|coming|neste|kommende)\s+(\d{1,2}|one|two|three|four|five|en|ett|to|tre|fire|fem)\s+(?:(calendar\s+|kalender\s*))?(?:years?|ar(?:ene|et)?)\b/);
  if (relative && isoDay(today)) {
    const years=numbers[relative[1]] ?? Number(relative[1]);
    if(relative[2]){
      const year=Number(today.slice(0,4));
      return {from:isoDay((year+1)+'-01-01'),to:isoDay((year+years)+'-12-31')};
    }
    return {from:today,to:anniversary(today,years)};
  }
  const interval = query.match(dateInterval);
  if (interval) return {from:isoDay(interval[1].length===4?interval[1]+'-01-01':interval[1]),
    to:isoDay(interval[2].length===4?interval[2]+'-12-31':interval[2])};
  const since = query.match(/\b(?:after|since|from|etter|siden|fra)\s+(\d{4}-\d{2}-\d{2})\b/);
  if(since) {
    const first = isoDay(since[1]);
    if(first && /^(?:after|etter)\b/.test(since[0])) {
      const date = new Date(first+'T00:00:00Z');
      date.setUTCDate(date.getUTCDate()+1);
      return {from:isoDay(date.toISOString().slice(0,10)),to:''};
    }
    return {from:first,to:''};
  }
  if(isoDay(query))return {from:query,to:query};
  const numericDate=query.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(numericDate){
    const [,day,month,year]=numericDate;
    const date=isoDay(year+'-'+month.padStart(2,'0')+'-'+day.padStart(2,'0'));
    return date?{from:date,to:date}:{};
  }
  const year = query.match(/^(\d{4})$/)||query.match(yearInContext);
  return year ? {from:year[1]+'-01-01',to:year[1]+'-12-31'} : {};
}

function datedSearchFilters(query,today) {
  const {from,to}=parseDateRange(query,today);
  const topic=from||to?(dateOnly.test(query.trim())?'':query.replace(dateInterval,' ').replace(yearInContext,' ').trim()):query;
  return {from,to,topic};
}

export function timelineHref({query='',authority='',instrument='',today,provision='',allDates=false,level='',vessel={}}={}) {
  const params=new URLSearchParams({research:'timeline'});
  if(authority)params.set('r.authority',authority);
  if(instrument)params.set('r.instrument',instrument);
  if(provision)params.set('r.provision',provision);
  if(level)params.set('r.level',level);
  for(const [key,value] of Object.entries(vessel))params.set('f.'+key,value);
  const {from,to,topic}=datedSearchFilters(query,today);
  if(from)params.set('r.from',from);
  if(to)params.set('r.to',to);
  if(topic&&(!from&&!to||allDates))params.set('r.topic',topic);
  if(allDates){
    if(!from)params.set('r.from','');
    if(!to)params.set('r.to','');
    params.set('r.kind','all');
  }
  return '#regulations?'+params;
}

function termIndex(query, alias) {
  const target = fold(alias);
  if (!target) return -1;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return query.search(new RegExp('(?<![\\p{L}\\p{N}])'+escaped+'(?![\\p{L}\\p{N}])','u'));
}

export function provisionTerms(input, flag, regimes) {
  if(!/\?|^\s*(?:which|what|how|where|hvilk(?:e|en|et)|hva|hvordan|hvor)\b/i.test(input))return input;
  const stop=new Set('a an are can do does for from give has have how i in is it list of on should the to under what where which with would and at hvis finnes finner for fra gjelder har hvordan hvilke hvilken hvilket hva jeg kan og om pa skal som til ved krav kravene regler reglene rule rules requirement requirements'.split(' '));
  const regime=regimes[flag];
  if(regime)for(const alias of [flag,regime.label,...(regime.aliases||[])])for(const word of queryParts(alias))stop.add(word);
  return queryParts(input.replace(/[?]/g,'')).filter(term=>!stop.has(term))
    .map(term=>term.includes(' ')?'"'+term+'"':term).join(' ');
}

export function interpretQuestion(value, regimes, today) {
  const query = fold(value).replace(/[–—]/g,'-');
  const named = Object.entries(regimes).flatMap(([key,regime]) => {
    const positions = [key,regime.label,...(regime.aliases||[])].filter(a=>a.length>2 || value.includes(a))
      .map(alias=>termIndex(query,alias)).filter(i=>i>=0);
    return positions.length ? [{key,offset:Math.min(...positions)}] : [];
  }).sort((a,b)=>a.offset-b.offset).map(r=>r.key);
  const dateRange = parseDateRange(query,today);
  const dates = /\b(?:timeline|ikrafttred\w*|(?:kommer|tre|trer) i kraft|effective dates?|enter(?:s|ing)? into force|(?:takes?|taking) effect|upcoming|kommende|adopted (?:rules?|changes?|amendments?)|vedtatte? (?:krav|endringer))\b/.test(query)||
    Boolean(dateRange.from&&/\b(?:changes?|amendments?|appl(?:y|ies)|endringer|gjelder)\b/.test(query));
  const stricter = /\b(?:stricter|more stringent|stricter than|strengere|skjerp\w*)\b/.test(query);
  const compare = stricter || /\b(?:compar(?:e|ison)|sammenlign\w*|forskjell\w*|vs|versus|beyond|utover)\b/.test(query);
  const facts = {};
  const types = Object.entries(shipTypes).filter(([,pattern])=>pattern.test(query));
  if(types.length===1)facts.shipType=types[0][0];
  if(/\b(?:utenriksfart|internasjonal fart|international voyages?|foreign voyages?)\b/.test(query))facts.foreignTrade='yes';
  if(/\b(?:innenriksfart|domestic voyages?)\b/.test(query))facts.foreignTrade='no';
  const registry = Object.entries(regimes).find(([,r])=>r.registers?.some(name=>new RegExp('\\b'+name+'\\b').test(value)));
  if(registry)facts.registry=registry[1].registers.find(name=>new RegExp('\\b'+name+'\\b').test(value));
  const size = query.match(/(?:(at least|no less than|minst|over|above|greater than|under|below|less than)\s+)?(\d+(?:[ ,.]\d{3})*|\d+)\s*(?:grt|gt|brt|bt|bruttotonn(?:asje)?|gross (?:tons?|tonnes?|tonnage))\b/);
  if(size) {
    const [,op,value]=size,n=Number(value.replace(/[^\d]/g,''));
    if(!op)facts.grossTonnage=n;
    else if(/under|below|less than/.test(op)&&op!=='no less than')facts.grossTonnage={...infinity,max:n};
    else facts.grossTonnage={...infinity,min:n,minInclusive:/at least|no less than|minst/.test(op)};
  }
  const date = query.match(/\b(?:as of|pa datoen|per)\s+(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const namedFlag = named.find(id=>regimes[id].flag);
  const left=named.find(id=>id!== 'IMO')||'';
  return {mode:compare?'compare':dates?'timeline':'provisions',left,right:named.find(id=>id!==left&&id!=='IMO')||'',
    instrument:named.find(id=>!regimes[id].flag&&id!=='IMO')||'', factFlag:namedFlag?regimes[namedFlag].flag:'',
    authority:named.includes('IMO')?'IMO':dates&&namedFlag?regimes[namedFlag].flag:'', date:isoDay(date), stricter, facts, ...dateRange};
}

function numericScope(rule, gap) {
  const {op,value} = rule;
  if (typeof value!=='number') return null;
  const below = gap.max<value || (gap.max===value && !gap.maxInclusive);
  const above = gap.min>value || (gap.min===value && !gap.minInclusive);
  if (op==='gt') return above?true:gap.max<=value?false:null;
  if (op==='gte') return gap.min>=value?true:below?false:null;
  if (op==='lt') return below?true:gap.min>=value?false:null;
  if (op==='lte') return gap.max<=value?true:above?false:null;
  const equal=below||above?false:gap.min===value&&gap.max===value?true:null;
  return op==='eq'?equal:op==='neq'&&equal!==null?!equal:null;
}

export function researchScope(rule, facts) {
  if (!rule) return true;
  if (rule.not) { const child=researchScope(rule.not,facts); return child===null?null:!child; }
  if (rule.all || rule.any) {
    const and=Boolean(rule.all),children=(rule.all||rule.any).map(child=>researchScope(child,facts));
    return children.includes(!and)?!and:children.includes(null)?null:and;
  }
  const value=facts[rule.field];
  return value&&typeof value==='object' ? numericScope(rule,value) : evaluate(rule,facts);
}

export function compareRequirements(catalogue, {left,right,topic='',facts={},asOf='',stricter=false}) {
  if (!left || !right || left===right) return [];
  const provisions=new Map(catalogue.provisions.map(p=>[p.id,p]));
  const words=queryParts(topic);
  const available=source=>{
    const validity=temporal(source,asOf);
    return validity===true||(validity===null&&asOf===catalogue.checkedAt);
  };
  return catalogue.relations.flatMap(relation=>{
    const rule=provisions.get(relation.rule),baseline=provisions.get(relation.baseline);
    if(!rule||!baseline)return [];
    const forward=rule.regime===left&&baseline.regime===right;
    const reverse=rule.regime===right&&baseline.regime===left;
    if ((!forward&&!reverse)||(stricter&&(!forward||!['stricter','additional'].includes(relation.kind)))) return [];
    const {flag,registry,...context}=facts;
    const scope=source=>researchScope(source.scope,{...context,flag:catalogue.regimes[source.regime]?.flag??flag,registry});
    if (!available(rule)||!available(baseline)||scope(rule)===false||scope(baseline)===false||researchScope(relation.scope,facts)===false) return [];
    if (!words.every(term=>fold([rule.topic,rule.title,baseline.title,relation.difference,relation.keywords].join(' ')).includes(term))) return [];
    return [{relation,rule,baseline,forward}];
  });
}

export function indexIncorporations(catalogue, documents, history, countryName) {
  const regimes={...catalogue.regimes}, provisions=[...catalogue.provisions], relations=[...catalogue.relations];
  const instruments=new Map((history.instruments||[]).map(instrument=>[instrument.id,instrument]));
  const reviewed=new Set(provisions.filter(p=>p.doc&&p.section).map(p=>p.doc+'|'+p.section));
  for(const doc of documents)for(const section of doc.sections) {
    const reference=section.incorporates;
    const instrument=reference&&instruments.get(reference.instrument);
    const flag=doc.instrument.jurisdiction;
    const id=doc.key+'|'+section.id;
    if(!instrument||!flag||reviewed.has(id))continue;
    const treaty=instrument.id.split('-')[0].toUpperCase();
    regimes[flag]??={label:countryName(flag),flag};
    regimes[treaty]??={label:instrument.title};
    const {effectiveFrom,effectiveTo,verifiedThrough}=doc.version;
    provisions.push({
      id,regime:flag,title:section.title,citation:section.number,
      text:section.text,doc:doc.key,section:section.id,url:section.sourceUrl,
      scope:section.criteria,effectiveFrom,effectiveTo,verifiedThrough
    },{
      id:id+'|treaty',regime:treaty,title:instrument.title,citation:reference.reference,
      text:reference.reference,doc:'imo:'+instrument.id,url:instrument.sourceUrl
    });
    relations.push({rule:id,baseline:id+'|treaty',kind:'implements',difference:reference.exclusions||reference.reference});
  }
  return {...catalogue,regimes,provisions,relations};
}

export function chronologyEvents(book={}, supplements=[]) {
  const matched = new Set(supplements.filter(e=>e.kind==='entry-into-force')
    .map(e=>[e.instrument,e.citation,e.date].join('|')));
  const regimes=new Map(supplements.filter(e=>e.authority==='IMO').map(e=>[e.instrument,e.regime]));
  const days=new Map();
  for(const instrument of book.instruments||[])for(const [index,entry] of instrument.entries.entries()){
    const {date,status,sourceUrl,label,resolutions=[]}=entry;
    if(!isoDay(date)||status||!sourceUrl)continue;
    const kind=entry.kind==='Amendment'||/entry into force|effective from/i.test(label)?'entry-into-force':
      /ceased to be in force/i.test(label)?'expiry':'';
    if(!kind)continue;
    const citation=resolutions.join(', ');
    if(matched.has([instrument.id,citation,date].join('|')))continue;
    const key=[instrument.id,citation||label,date].join('|');
    if(days.has(key))continue;
    const regime=regimes.get(instrument.id)||instrument.id.split('-')[0].toUpperCase();
    days.set(key,{id:instrument.id+'-'+index,instrument:instrument.id,regime,
      authority:'IMO',date,kind,citation,title:instrument.title,description:label,url:sourceUrl,
      doc:'imo:'+instrument.id,section:'event-'+index});
  }
  return [...new Map([...days.values(),...supplements].map(event=>[event.id,event])).values()];
}

export function provisionDateEvents({sources={},provisions=[]}={}) {
  return provisions.flatMap(({id:provisionId, dates, ...provision})=>dates.map(day=>{
    const evidence=day.evidence.map(({source,reference,page,quote})=>{
      const url=new URL(sources[source].url);
      if(page)url.hash='page='+page;
      return {reference:[sources[source].citation,reference].filter(Boolean).join(' · '),url:url.href,quote};
    });
    const scope=provision.scope&&day.scope?{all:[provision.scope,day.scope]}:day.scope||provision.scope;
    return {...provision,...day,scope,evidence,provisionId,provisionTitle:provision.title,id:provisionId+'/'+day.id,url:evidence[0].url};
  }));
}

function gazetteEvents(records) {
  return records.filter(r=>r.kind==='gazette').flatMap(r=>{
    const common={authority:'NO',instrument:r.legalId,regime:'NO',citation:r.legalId,
      title:r.title,doc:r.id,url:r.sourceUrl};
    // The publisher calls this field dateInForce. A range or a conditional date
    // needs provision-level evidence before it can become a dated event.
    const dates=(r.effectiveText||'').split(/\s*,\s*/);
    const effective=dates.every(isoDay)?[...new Set(dates)].map(date=>({...common,
      id:r.id+'|entry-into-force|'+date,date,kind:'entry-into-force',
      description:dates.length>1?'One of '+dates.length+' commencement dates recorded in the notice.':''})):[];
    const published=isoDay(r.publishedDate)?[{...common,id:r.id+'|publication',date:r.publishedDate,kind:'publication'}]:[];
    return [...effective,...published];
  });
}

function editionEvents(documents) {
  return documents.filter(doc=>doc.type==='folio').flatMap(({key,instrument,version})=>{
    const authority=instrument.jurisdiction;
    const date=isoDay(version.effectiveFrom);
    if(!authority||!date)return [];
    return [{id:key+'|edition-effective',date,kind:'edition-effective',authority,regime:authority,
      instrument:instrument.id,citation:instrument.id,title:instrument.title,description:version.label,
      doc:key,url:version.sourceUrl}];
  });
}

export function indexChangeEvents({imo,gazette=[],documents=[],supplements=[],datedProvisions}) {
  const provisions=provisionDateEvents(datedProvisions);
  const events=[...chronologyEvents(imo,[...supplements,...provisions]),...gazetteEvents(gazette),...editionEvents(documents)];
  const titles=new Map((imo?.instruments||[]).map(instrument=>[instrument.id,instrument.title]));
  return events.filter(e=>e.doc||e.url).map(event=>{
    const instrumentTitle=titles.get(event.instrument);
    return {...event,instrumentTitle,searchText:eventSearchText(event,instrumentTitle)};
  });
}

export function changeEvidence(event) {
  return Array.isArray(event.evidence)?event.evidence:event.evidence?[event.evidence]:[];
}

function eventSearchText(event, instrumentTitle) {
  return fold([event.title,event.provisionTitle,event.description,event.citation,event.keywords,event.condition,
    ...changeEvidence(event).flatMap(e=>[e.quote,e.reference]),event.date,event.authority,event.regime,
    event.instrument,instrumentTitle,eventKinds[event.kind]].join(' '));
}

export function listChanges(events,{from='',to='',instrument='',topic='',kind='',authority='',facts={},provision='',level=''}={}) {
  const words=queryParts(topic);
  return events.filter(event=>{
    if(!isoDay(event.date)||!Object.hasOwn(eventKinds,event.kind)||event.stage==='draft'||event.stage==='approved')return false;
    if((from&&event.date<from)||(to&&event.date>to)||(kind&&kind!==event.kind))return false;
    if(authority&&authority!==event.authority)return false;
    if(instrument&&event.regime!==instrument&&event.instrument!==instrument)return false;
    if(provision&&provision!==event.provisionId)return false;
    if(level==='provisions'&&!event.provisionId)return false;
    return researchScope(event.scope,facts)!==false&&words.every(term=>(event.searchText||eventSearchText(event)).includes(term));
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}

export function searchDatedProvisions(events,{query='',authority='',facts={},today}={}) {
  if(query.trim().length<2)return [];
  return listChanges(events,{authority,facts,level:'provisions',...datedSearchFilters(query,today)});
}

export function timelineChanges(events,state) {
  const {kind,...filters}=state;
  if(filters.from&&filters.to&&filters.from>filters.to)return [];
  return listChanges(kind?events:events.filter(event=>operativeKinds.has(event.kind)),
    {...filters,kind:kind==='all'?'':kind});
}
