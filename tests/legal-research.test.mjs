import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {compareRequirements,indexChangeEvents,interpretQuestion,listChanges,parseDateRange,researchScope,searchDatedProvisions,timelineChanges,timelineHref} from '../site/js/legal-research.js';

const load = async name => JSON.parse(await readFile(new URL('../site/data/'+name+'.json',import.meta.url)));
const catalogue = await load('legal-research');
const datedProvisions = await load('dated-provisions');
const today = '2026-11-23';
const question = value => interpretQuestion(value,catalogue.regimes,today);

test('Norwegian questions preserve separate vessel and date constraints',()=>{
  const parsed=question('Hvilke krav NOR flagg har til lasteskip over 500 grt som er strengere enn SOLAS?');
  assert.equal(parsed.mode,'compare');
  assert.deepEqual([parsed.left,parsed.right,parsed.facts.shipType,parsed.facts.registry],['NO','SOLAS','cargo','NOR']);
  assert.equal(researchScope({field:'grossTonnage',op:'lte',value:500},parsed.facts),false);
  assert.equal(researchScope({field:'grossTonnage',op:'gte',value:1600},parsed.facts),null);
  assert.equal(compareRequirements(catalogue,{...parsed,asOf:today}).length,5);

  const dates=question('Hvilke vedtatte krav fra IMO trer i kraft de neste to årene?');
  assert.deepEqual([dates.mode,dates.authority,dates.from,dates.to],['timeline','IMO',today,'2028-11-23']);
});

test('an additional rule set uses the same comparison and scope filters',()=>{
  const parsed=question('Compare UK vs SOLAS for pilot transfer');
  const comparisons=compareRequirements(catalogue,{...parsed,topic:'pilot',asOf:today});
  assert.equal(comparisons.length,1);
  assert.equal(comparisons[0].relation.kind,'exception');
  assert.equal(compareRequirements(catalogue,{...parsed,stricter:true,asOf:today}).length,0);
  assert.equal(compareRequirements(catalogue,{...parsed,asOf:'2025-12-11'}).length,0);
});

test('dates and source references are distinct and published changes exclude drafts',async()=>{
  const imo=await load('imo-history');
  const events=indexChangeEvents({imo,supplements:catalogue.events,datedProvisions});
  const dates=question('IMO changes taking effect in 2028');
  const timeline=listChanges(events,{...dates,kind:'entry-into-force'});
  assert.ok(timeline.length>=8);
  assert.ok(timeline.every((entry,i)=>entry.url&&(i===0||entry.date>=timeline[i-1].date)));
  for(const [citation,instrument,count] of [
    ['MSC.583(111)','solas-1974',2],['MSC.588(111)','solas-1974-ip',1],
    ['MSC.589(111)','solas-1974-lsa',1],['MSC.590(111)','solas-1974-lifeboat-maintenance',1]
  ]){
    const matches=timeline.filter(e=>e.citation===citation);
    assert.equal(matches.length,count,citation);
    assert.ok(matches.every(e=>e.instrument===instrument&&e.provisionId),citation);
  }
  assert.equal(listChanges([...events,{...timeline[0],id:'future-draft',stage:'draft'}],dates)
    .some(event=>event.id==='future-draft'),false);
});

test('operative dates, publisher dates and provision wording have independent filters',async()=>{
  const [imo,gazette]=await Promise.all([load('imo-history'),load('gazette')]);
  const documents=[{type:'folio',key:'demo',instrument:{id:'DEMO',title:'Sample safety regulation',jurisdiction:'NZ'},
    version:{label:'Second edition',effectiveFrom:'2027-02-01',sourceUrl:'https://legislation.govt.nz/'}}];
  const events=indexChangeEvents({imo,gazette:gazette.records,documents,supplements:catalogue.events,datedProvisions});
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);

  const lifeboats={authority:'IMO',topic:'MSC.535(107)',from:'2029-01-01',to:'2029-12-31'};
  const [application]=timelineChanges(events,lifeboats);
  assert.equal(application.kind,'application');
  assert.ok(application.evidence.some(e=>e.quote.includes('1 January 2029')));
  assert.equal(timelineChanges(events,{...lifeboats,kind:'entry-into-force'}).length,0);
  assert.equal(timelineChanges(events,{...lifeboats,from:'2026-01-01',to:'2026-01-01',kind:'entry-into-force'})[0].date,'2026-01-01');
  assert.equal(timelineChanges(events,{...lifeboats,topic:'"enclosed lifeboats installed"'})[0].id,application.id);

  const polar={authority:'NO',topic:'FOR-2025-12-19-2820'};
  assert.deepEqual(timelineChanges(events,polar).map(e=>e.date),['2026-01-01','2027-01-01']);
  assert.equal(timelineChanges(events,{...polar,kind:'publication'})[0].doc,'LTI/forskrift/2025-12-19-2820');
  assert.ok(timelineChanges(events,{authority:'NO',topic:'LOV-2026-06-12-22',kind:'entry-into-force'}).every(e=>e.date!=='2028-07-01'));
  assert.equal(timelineChanges(events,{authority:'NZ',from:'2027-02-01',to:'2027-02-01'})[0].kind,'edition-effective');
  assert.deepEqual(timelineChanges(events,{from:'2027-02-02',to:'2027-02-01'}),[]);
});

test('wording search finds the dated legal condition, with related dates and original excerpts',()=>{
  const events=indexChangeEvents({datedProvisions});
  const [roro]=searchDatedProvisions(events,{query:'roro brann 2028'});
  assert.equal(roro.kind,'survey');
  assert.match(roro.condition,/first survey/);
  assert.equal(roro.evidence.length,3);
  assert.ok(roro.evidence.some(e=>e.url.endsWith('#page=7')&&e.quote.includes('1 January 2028')));
  assert.equal(searchDatedProvisions(events,{query:'roro brann 2028',facts:{buildDate:'2026-01-01'}}).length,0);
  assert.equal(searchDatedProvisions(events,{query:'roro brann 2028',facts:{buildDate:'2025-12-31'}}).length,1);
  const [ip]=searchDatedProvisions(events,{query:'industriperson 2032'});
  assert.equal(ip.date,'2032-01-01');
  assert.match(ip.description,/90 kg/);

  const tiers=timelineChanges(events,{provision:'nea-nox-tier-iii',kind:'all'});
  assert.deepEqual(tiers.map(e=>[e.date,e.kind]),[
    ['2027-01-01','construction'],['2027-07-01','construction'],['2027-09-01','application'],['2031-01-01','delivery']
  ]);
  const [beidou]=searchDatedProvisions(events,{query:'beidou 2028'});
  assert.equal(beidou.date,'2028-07-31');
  assert.equal(beidou.kind,'recommendation');
  assert.ok(!timelineChanges(events,{provision:beidou.provisionId}).length);
  assert.deepEqual(searchDatedProvisions(events,{query:'31.07.2028'}).map(e=>e.id),[beidou.id]);
  const period=searchDatedProvisions(events,{query:'IMO 2027–2029'});
  assert.ok(period.length>=38);
  assert.ok(period.every(e=>e.date>='2027-01-01'&&e.date<='2029-12-31'&&e.evidence.length));
});

test('calendar ranges survive a link from Library to changes by date',()=>{
  for(const query of ['2027–2029','the next three calendar years','de neste tre kalenderårene']){
    assert.deepEqual(parseDateRange(query,today),{from:'2027-01-01',to:'2029-12-31'});
  }
  const params=new URLSearchParams(timelineHref({query:'2029',authority:'IMO'}).split('?')[1]);
  assert.deepEqual(Object.fromEntries(params),{research:'timeline','r.authority':'IMO','r.from':'2029-01-01','r.to':'2029-12-31'});
});
