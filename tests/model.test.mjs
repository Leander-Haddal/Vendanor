import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluate,temporal,assess,fold,marked,safeUrl,queryParts,folioRows,mergeInstruments,isoDay} from '../site/js/model.js';
import {lineDiff,sectionDiff} from '../site/js/diff.js';
import {countryCode} from '../site/js/jurisdictions.js';
import {archiveSections} from '../site/js/archive.js';
import {importToFolio} from '../site/js/imports.js';

const read=file=>JSON.parse(readFileSync(new URL('../site/data/'+file,import.meta.url)));
const norwegian=read('folios.json'),european=read('eu-folios.json');
const condition=(field,op,value)=>({field,op,value});
const rule=(op,value)=>condition('built',op,value);
const cargo=norwegian.instruments[0].versions.find(v=>v.id==='no-cargo-2025');
const scope=cargo.sections.find(s=>s.id==='s1');
const profile={flag:'NO',shipType:'cargo',lengthL:12,grossTonnage:68,onlyPassenger2020:'no',approvedTraining:'no'};

test('unknown particulars survive nested legal alternatives and exceptions',()=>{
  const expr={all:[condition('ship','eq','tanker'),{any:[condition('flag','eq','NO'),condition('inPort','eq','yes')]},{not:condition('stateService','eq','yes')}]};
  assert.equal(evaluate(expr,{}),null);
  assert.equal(evaluate(expr,{ship:'tanker',flag:'GB',inPort:'yes',stateService:'no'}),true);
  assert.equal(evaluate(expr,{ship:'tanker',flag:'GB',stateService:'no'}),null);
  assert.equal(evaluate(expr,{ship:'cargo'}),false);
  assert.equal(evaluate(condition('flag','eq','other'),{flag:'PA'}),true);
  assert.equal(evaluate(condition('flag','eq','other'),{flag:'NO'}),false);
});
test('year-only vessel dates only decide a threshold when the whole year agrees',()=>{
  assert.equal(evaluate(rule('gte','2015-04-20'),{built:'2015'}),null);
  assert.equal(evaluate(rule('gte','2015-04-20'),{built:'2016'}),true);
  assert.equal(evaluate(rule('gt','2015-12-31'),{built:'2015'}),false);
  assert.equal(evaluate(rule('eq','2016-06-01'),{built:'2015'}),false);
  assert.equal(evaluate(rule('neq','2015-06-01'),{built:'2015'}),null);
  assert.equal(isoDay('2024-02-29'),'2024-02-29');assert.equal(isoDay('2025-02-29'),'');
});
test('legal as-of dates use exclusive end dates and dated evidence for an open interval',()=>{
  const historical={effectiveFrom:'2020-01-01',effectiveTo:'2021-01-01'};
  assert.equal(temporal(historical,'2020-12-31'),true);
  assert.equal(temporal(historical,'2021-01-01'),false);
  assert.equal(temporal({effectiveFrom:'2020-01-01'},'2020-02-01'),null);
  assert.equal(temporal(cargo,cargo.verifiedThrough),true);
  assert.equal(temporal(cargo,'2999-01-01'),null);
  assert.equal(assess({criteria:null},historical,{},'2020-08-01'),'review');
});
test('actual cargo § 1 excludes exactly 24 m regulatory length and 500 GT',()=>{
  assert.equal(assess(scope,cargo,profile,''),'match');
  for(const changes of [{lengthL:24},{grossTonnage:500},{approvedTraining:'yes'},{flag:'PA'}])assert.equal(assess(scope,cargo,{...profile,...changes},''),'outside');
  assert.equal(assess(scope,cargo,{...profile,lengthL:'',lengthOverall:15},''),'review');
  assert.equal(assess(scope,cargo,{...profile,grossTonnage:null,deadweightTonnes:68},''),'review');
});
test('source referrals, survey context and representative EU conditions survive normalization',()=>{
  const survey=cargo.sections.find(s=>s.id==='s149').survey;
  assert.equal(survey.intervalMonths,30);assert.equal(survey.earlyWindowMonths,6);assert(survey.anniversaryMayBePreserved);
  const rows=folioRows(mergeInstruments([...norwegian.instruments,...european.instruments],[]));
  assert(rows.some(r=>r.jurisdiction==='EU'&&r.sectionId==='scope'&&r.criteria));assert(rows.some(r=>r.verifiedThrough===cargo.verifiedThrough));
  assert.equal(archiveSections({sections:[{label:'I',text:'X'},{label:'I',text:'Y'}]})[1].id,'p1');
});
test('search handles Norwegian spelling, phrases, regular-expression characters and markup',()=>{
  assert.equal(fold(' Sjøfartsdirektoratet '),'sjofartsdirektoratet');
  assert.deepEqual(queryParts('skip "åpent hav"'),['skip','apent hav']);
  assert.equal(marked('<skip> 5 [m]','[m]'),'&lt;skip&gt; 5 <mark>[m]</mark>');
  assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('//foreign.example/a',true),'');
  assert.equal(countryCode('NOR',[{code:'NO',alpha3:'NOR',name:'Norway'}]),'NO');
});
test('diff retains both sources, duplicate section labels and counts',()=>{
  const items=lineDiff('A.\nB.\nC.','A.\nD.\nC.');
  assert.deepEqual(items.map(x=>x.kind),['same','del','add','same']);
  assert.equal(items[1].right,null);assert.equal(items[2].left,null);assert.equal(items[3].right,3);
  const parts=[{number:'I',text:'X'},{number:'I',text:'Y'}];
  assert.deepEqual(sectionDiff(parts,[parts[0],{number:'I',text:'Z'}]).map(x=>x.kind),['unchanged','changed']);
  const numbered=Array.from({length:650},(_,i)=>String(i)).join('\n');
  const bounded=lineDiff(numbered,numbered.replace(/\d+/g,x=>'New '+x));
  assert.equal(bounded.filter(x=>x.kind==='add').length,650);assert.equal(bounded.filter(x=>x.kind==='del').length,650);
});
test('private definitions in incompatible units cannot reuse the public vessel value',()=>{
  const make=unit=>({id:'edition',familyId:'family',title:'Private law',fields:[{key:'lengthL',type:'number',unit}],
    sections:[{key:'a',label:'I',title:'Scope',criteria:{all:[condition('lengthL','lt',40)]}}]});
  const local=importToFolio(make('ft'),norwegian.fields);
  assert.equal(local.versions[0].sections[0].criteria.all[0].field,'local-family.lengthL');
  assert.equal(evaluate(local.versions[0].sections[0].criteria,{lengthL:9}),null);
  assert.equal(importToFolio(make('m'),norwegian.fields).fields[0].key,'lengthL');
});
