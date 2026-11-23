import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readFacets,filterFields} from '../site/js/regulations.js';
import {evaluate} from '../site/js/model.js';
import {norwegianConstruction,ukNavigation,canadianPolarScope} from '../site/js/implementation.js';
import {sourceGuard,extractClauses} from '../site/js/clause-logic.js';
import {originalScope,registeredScopes} from '../site/js/treaty-scope.js';
import {thresholdCandidates} from '../site/js/source-thresholds.js';
import {compareHoldings,compareTreaties} from '../site/js/atlas.js';
import {compareConditionText} from '../site/js/source-conditions.js';
import {encodeWording,readWording,screenWording} from '../site/js/wording-filters.js';
import {publisherDates,revisionDates} from '../site/js/revision-picker.js';

test('filters are derived from guards, alternatives, derived conditions and exceptions',()=>{
  const eq=field=>({field,op:'eq',value:'yes'}),fields=['a','b','c','unused'].map(key=>({key,type:'select'}));
  const doc={version:{derivedFields:[{when:eq('c')}]},sections:[{criteria:{not:eq('a')},cases:[{when:eq('b')}]}]};
  assert.deepEqual(filterFields([doc],fields).map(f=>f.key),['a','b','c']);
  assert.deepEqual(readFacets(new URLSearchParams({'f.gt':'0','f.bad':'NaN','f.date':'2024-02-31','f.kind':'freighter'}),[
    {key:'gt',type:'number'},{key:'bad',type:'number'},{key:'date',type:'date'},{key:'kind',options:['cargo']}]),{gt:0});
});
test('revision years include domestic editions for the chosen flag and preserve the published date precision',()=>{
  const records=[{id:'world:a',codes:['IE'],issuedDate:'2012-05-01',title:'Harbour rules',kind:'Regulation'},
    {id:'world:b',codes:['IE'],issuedDate:'1995',title:'Year only'},
    {id:'world:c',codes:['GB'],issuedDate:'2020-03-01',title:'Other flag'}];
  const values={flag:'IE'},editions=publisherDates(values,records,{a:{editionDate:'2024-08-13',label:'Consolidated wording'}},[],[],[]);
  assert.deepEqual(revisionDates([],values,editions).map(r=>[r.date,r.basis]),[['2024-08-13','Edition dated'],['2012-05-01','Issued']]);
});

test('Norwegian incorporation preserves the inclusive 500 GT boundary and passenger alternative',()=>{
  const facts={flag:'NO',foreignTrade:'yes',shipType:'cargo'};
  assert.equal(evaluate(norwegianConstruction,facts),null);
  assert.equal(evaluate(norwegianConstruction,{...facts,grossTonnage:499.99}),false);
  assert.equal(evaluate(norwegianConstruction,{...facts,grossTonnage:500}),true);
  assert.equal(evaluate(norwegianConstruction,{...facts,grossTonnage:1000,foreignTrade:'no'}),false);
  assert.equal(evaluate(norwegianConstruction,{...facts,shipType:'passenger',noForeignPassengerCertificate:'yes'}),true);
  assert.equal(evaluate(norwegianConstruction,{...facts,flag:'GB'}),false);
});
test('UK territorial scope, public-service exclusions and forced entry remain distinct',()=>{
  const exclusions=Object.fromEntries(['Naval','Government','GreatLakes','Domestic','Categorised','Inland'].map(k=>['ukNav'+k,'no']));
  assert.equal(evaluate(ukNavigation,{flag:'GB',...exclusions}),true);
  assert.equal(evaluate(ukNavigation,{flag:'GB',...exclusions,ukNavDomestic:'yes'}),false);
  const guest={...exclusions,flag:'NO',ukNavWaters:'yes',ukNavParty:'no'};
  assert.equal(evaluate(ukNavigation,guest),null);
  assert.equal(evaluate(ukNavigation,{...guest,ukNavInvoluntary:'yes'}),false);
  assert.equal(evaluate(ukNavigation,{...guest,ukNavParty:'yes'}),true);
});
test('country comparisons require a shared record or exact source fingerprint',()=>{
  const a={identity:'a',title:'Navigation'},b={identity:'b',title:'Navigation'};
  assert.deepEqual(compareHoldings([a],[b]),{shared:[],left:[a],right:[b]});
  assert.deepEqual(compareHoldings([a],[{...b,identity:'a'}]).shared,[a]);
  assert.equal(compareTreaties({participation:{byFlag:{},columns:[]}},'NO','GB'),null);
  const row=(key,condition)=>[key,'art-1',condition,'the owner must carry a certificate'];
  const first=row('a','if the vessel is at least 30 GT'),shared=row('b','IF the vessel is at least 30 GT'),changed=row('c','if the vessel is at least 50 GT');
  assert.deepEqual(compareConditionText([first],[shared,changed,row('d','if the vessel is less than 30 GT')]),{shared:[[first,shared]],different:[[first,changed]]});
});
test('Canadian polar shipping treats the domestic reach, foreign zone and alternative passenger threshold separately',()=>{
  const rule=canadianPolarScope();
  const facts={caCanadianVessel:'yes',caPolarWaters:'yes',caGovernmentExempt:'no',caMechanicalPropulsion:'yes',shipType:'cargo',grossTonnage:500};
  assert.equal(evaluate(rule,facts),true);
  assert.equal(evaluate(rule,{...facts,shipType:'fishing'}),false);
  assert.equal(evaluate(rule,{...facts,caCanadianVessel:'no',caControlZone:'no'}),false);
  assert.equal(evaluate(rule,{...facts,caCanadianVessel:'no',caPolarWaters:'no',caControlZone:'yes'}),true);
  assert.equal(evaluate(rule,{...facts,grossTonnage:499,passengers:12,caChapterICertified:'yes'}),false);
  assert.equal(evaluate(rule,{...facts,grossTonnage:499,passengers:13,caChapterICertified:'yes'}),true);
  assert.equal(evaluate(rule,{...facts,grossTonnage:499}),null);
});
test('registered Load Lines wording keeps new-ship length and existing-ship tonnage as alternatives',()=>{
  const scope=originalScope('load-lines-1966'), common={llRegistration:'registered',llInternational:'yes',llWarship:'no',privateYacht:'no',shipType:'cargo',llExceptedWaters:'no',llExemption:'no'};
  assert.equal(evaluate(scope,{...common,llNew:'yes',llLength:23.9,llTonsGross:200}),false);
  assert.equal(evaluate(scope,{...common,llNew:'yes',llLength:24}),true);
  assert.equal(evaluate(scope,{...common,llNew:'no',llTonsGross:150}),true);
  assert.equal(evaluate(scope,{...common,llNew:'no',llLength:250}),null);
});
test('registered ship-recycling and anti-fouling scopes preserve their separate thresholds and exclusions',()=>{
  const read=name=>JSON.parse(readFileSync(new URL('../site/data/'+name,import.meta.url),'utf8'));
  const docs=registeredScopes(read('treaty-originals.json'),{},read('imo-history.json'));
  const section=(id,key)=>docs.find(d=>d.instrument.id==='registered-'+id).sections.find(s=>s.id===key).criteria;
  const recycling=section('hong-kong-2009','application'),hk={hkPartyFlag:'yes',treatyNaval:'no',hkStateService:'no',hkDomesticLifetime:'no',grossTonnage:500};
  assert.equal(evaluate(recycling,hk),true);
  assert.equal(evaluate(recycling,{...hk,grossTonnage:499}),false);
  assert.equal(evaluate(recycling,{...hk,hkDomesticLifetime:'yes'}),false);
  const declaration=section('afs-2001','declaration'),survey=section('afs-2001','surveys');
  const afs={afsFlag:'yes',afsInternational:'yes',afsInstallation:'no',afsStateService:'no',treatyNaval:'no',grossTonnage:399,afsLength:24};
  assert.equal(evaluate(declaration,afs),true);
  assert.equal(evaluate(declaration,{...afs,afsLength:23.99}),false);
  assert.equal(evaluate(declaration,{...afs,grossTonnage:400}),false);
  assert.equal(evaluate(survey,{...afs,grossTonnage:400}),true);
});
test('source wording preserves a conjunction, a negative exception and opaque qualifications',()=>{
  const rule=sourceGuard('at least 30 GT and less than 200 metres in length overall');
  assert.equal(evaluate(rule,{grossTonnage:30}),null);
  assert.equal(evaluate(rule,{grossTonnage:30,lengthOverall:200}),false);
  const [clause]=extractClauses('Equipment must be carried unless an individual exemption has been issued.');
  assert.deepEqual(clause.when,{not:{wording:'an individual exemption has been issued'}});
  assert.equal(clause.outcome,'Equipment must be carried');
  assert.deepEqual(sourceGuard('the owner and master'),{wording:'the owner and master'});
  assert.equal(extractClauses('If the ship carries cargo, subject to an exemption, the master must keep records.')[0].guard,'If the ship carries cargo, subject to an exemption');
  assert.equal(evaluate(sourceGuard('the vessel is not a fishing vessel'),{shipType:'fishing'}),false);
  assert.equal(evaluate(sourceGuard('a cargo ship of 500 gross tonnage and upwards'),{shipType:'cargo',grossTonnage:500}),true);
  assert.equal(evaluate(sourceGuard('au moins 12 passagers'),{passengers:11}),false);
  const rows=[{op:'gte',value:30},{op:'lt',value:30}];
  assert.deepEqual(thresholdCandidates(rows,'grossTonnage',{grossTonnage:30}),rows.slice(0,1));
});
test('verbatim answers are scoped to one published section and respect exceptions, alternatives and missing values',()=>{
  const fact={file:'IE-0.json.gz',doc:'a',section:'s1',wording:'the authority consents',value:'no'};
  const answers=readWording(new URLSearchParams([['where',encodeWording(fact)],['where',encodeWording(fact)],['where','null']]));
  assert.deepEqual(answers,[fact]);
  const rule={all:[{not:{wording:fact.wording}},{field:'grossTonnage',op:'gte',value:30}]};
  const row=['a','s1','unless the authority consents','the owner must notify',rule];
  const others=[['b',...row.slice(1)],['a','s2',...row.slice(2)]];
  assert.deepEqual(screenWording([row,...others],answers,{},true),[row]);
  assert.deepEqual(screenWording([row,...others],answers,{},false),[]);
  assert.deepEqual(screenWording([row,...others],answers,{grossTonnage:30},false),[row]);
  assert.deepEqual(screenWording([row],answers,{grossTonnage:29},true),[]);
  assert.deepEqual(screenWording([row],[{...fact,value:'yes'}],{grossTonnage:30},true),[]);
});
