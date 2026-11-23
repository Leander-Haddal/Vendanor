import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {collections} from '../site/js/collections.js';
import {mapCatalogue} from '../site/js/provision-map.js';
import {searchBoat} from '../site/js/boat-matches.js';
import {assess,evaluate,evidenceRows,screeningValues} from '../site/js/model.js';

const editions=Object.values(collections).flatMap(file=>{
  const book=mapCatalogue(JSON.parse(readFileSync(new URL('../site/data/'+file,import.meta.url),'utf8')));
  return book.instruments.flatMap(instrument=>instrument.versions.map(version=>({type:'folio',instrument,version,sections:version.sections})));
});
function search(docs,values,date='2026-11-23'){
  const {matched,review}=searchBoat(docs,{values,asOf:date},{includeUnspecified:true});
  return [...matched,...review].flatMap(group=>group.sections);
}
const byEdition=id=>editions.find(doc=>doc.version.id===id);
const cargo=byEdition('no-cargo-2025');
const cargoProfile={flag:'NO',shipType:'cargo',lengthL:18,grossTonnage:120,onlyPassenger2020:'no',approvedTraining:'no',
  closedShip:'yes',tradingCertificateRequired:'yes',hasBuildContract:'yes',contractDate:'2026-01-01',deliveryDate:'2026-10-01'};

test('every indexed edition can expose every printed passage when its vessel conditions are unspecified',()=>{
  for(const doc of editions){
    const day=doc.version.effectiveFrom||doc.version.publishedOn||doc.version.editionDate;
    const found=search([doc],{'local:reference':'unrelated'},day);
    assert.deepEqual(new Set(found.map(r=>r.section.id)),new Set(doc.sections.map(s=>s.id)),doc.version.id);
    assert.ok(found.every(row=>row.state==='review'),'No vessel facts were supplied for '+doc.version.id);
  }
});

test('missing length keeps both alternatives, known GT still excludes conflicts, and exact boundaries select one branch',()=>{
  const condition=(field,op,value)=>({field,op,value});
  const docs=[{type:'local',instrument:{id:'conditions'},version:{effectiveFrom:'2020-01-01',verifiedThrough:'2026-11-23'},
    sections:[['short','lt'],['long','gte']].map(([id,op])=>({id,criteria:{all:[condition('grossTonnage','gte',30),condition('lengthOverall',op,200)]}}))}];
  const hits=values=>search(docs,values).map(r=>[r.section.id,r.state]);
  assert.deepEqual(hits({grossTonnage:30}),[['short','review'],['long','review']]);
  assert.deepEqual(hits({grossTonnage:29.99}),[]);
  assert.deepEqual(hits({grossTonnage:30,lengthOverall:199.99}),[['short','match']]);
  assert.deepEqual(hits({grossTonnage:30,lengthOverall:200}),[['long','match']]);
  docs[0].sections[0].criteria.all[0]=condition('grossTonnage','gt',30);
  assert.deepEqual(hits({grossTonnage:30}),[['long','review']]);
});

test('a known exclusion or expired edition also wins over a missing flag, length or operating area',()=>{
  assert.equal(search([cargo],{grossTonnage:500}).some(r=>r.section.id==='s1'),false);
  assert.equal(search([cargo],{grossTonnage:30},'2025-12-31').length,0);
  assert.equal(search([cargo],{grossTonnage:30}).find(r=>r.section.id==='s1').state,'review');
  const privateDoc={type:'local',instrument:{id:'private'},version:{},sections:[{id:'first'},{id:'untagged'},{id:'tagged',criteria:{field:'grossTonnage',op:'gt',value:50}}]};
  assert.deepEqual(search([privateDoc],{grossTonnage:30}).map(r=>r.section.id),['first','untagged']);
});

test('30 GT alone exposes both real length columns in the Norwegian navigation table',()=>{
  const equipment=profile=>search([cargo],profile).find(r=>r.section.id==='s20').cases.filter(c=>c.reference==='§ 20(1)');
  const candidates=equipment({grossTonnage:30});
  assert.equal(candidates.length,2);assert.ok(candidates.every(row=>row.state===null));
  assert.deepEqual(equipment({grossTonnage:30,lengthOverall:11.99}).map(row=>row.outcome),[candidates[0].outcome]);
  assert.deepEqual(equipment({grossTonnage:30,lengthOverall:12}).map(row=>row.outcome),[candidates[1].outcome]);
});

test('Norwegian watertight subdivision keeps the exact alternatives, open-ship exclusions and historical directions separate',()=>{
  const section=cargo.sections.find(s=>s.id==='s58');
  const match=(values)=>search([cargo],{...cargoProfile,...values}).find(r=>r.section===section);
  assert.deepEqual(match({}).cases.map(r=>r.reference),['§ 58(1)','§ 58(2)','§ 58(3)']);
  assert.equal(match({}).state,'review');
  for(const [length,ref] of [[14.99,'§ 58(1)'],[15,'§ 58(2)']]){
    const row=match({lengthOverall:length,longSuperstructure:'no'});
    assert.equal(row.state,'match');
    assert.deepEqual(row.cases.map(c=>c.reference),[ref]);
    assert.equal(assess(section,cargo.version,{...cargoProfile,lengthOverall:length},'2026-11-23'),'match');
  }
  assert.equal(match({closedShip:'no'}),undefined);
  assert.equal(match({lengthOverall:15,contractDate:'2025-12-31',constructionOrder:'no'}),undefined);
  assert.equal(match({lengthOverall:15,contractDate:'2025-12-31',constructionOrder:'yes'}).state,'review');
});

test('an obligation is still found when the vessel lacks the equipment the law requires',()=>{
  const values={...cargoProfile,lengthOverall:14,anchorHandling:'yes',closedShip:'no'};
  const section=search([cargo],values).find(row=>row.section.id==='s99');
  assert.ok(section);
  assert.equal(search([cargo],{...values,anchorHandling:'no',liftingGear:'no'}).some(r=>r.section.id==='s99'),false);
});

test('an older ship extending its trading area receives the carried-forward paragraph only',()=>{
  const old={...cargoProfile,contractDate:'2025-12-20',foreignTrade:'yes',distanceToPort:31,tradingAreaIncreased:'yes',constructionOrder:'no'};
  const row=search([cargo],old).find(item=>item.section.id==='s57');
  assert.equal(row.state,'match');
  assert.deepEqual(row.cases.map(c=>[c.reference,c.state]),[['§ 57(3)',true]]);
  assert.equal(assess(row.section,cargo.version,old,'2026-11-23'),'match');
  const direction=search([cargo],{...old,tradingAreaIncreased:'no',constructionOrder:'yes'}).find(item=>item.section.id==='s57');
  assert.equal(direction.state,'review');
  assert.ok(direction.cases.every(c=>c.state===null));
});

test('competing lighting, certification and exception outcomes stay tied to their source provisions',()=>{
  const colreg=editions.find(d=>d.instrument.flagState==='NO'&&d.instrument.id.startsWith('IMO-COLREG')&&d.sections.some(s=>s.id==='r22b'));
  const light=colreg.sections.find(s=>s.id==='r22b');
  assert.deepEqual(light.cases.map(c=>evaluate(c.when,{lengthOverall:20})),[false,true]);
  const mlc=byEdition('mlc-en-NO'),profile={flag:'NO',shipType:'cargo',mlcSeagoing:'yes',mlcCommercialActivity:'yes',mlcFishingOrSimilar:'no',
    mlcTraditionalBuild:'no',mlcWarshipOrNavalAuxiliary:'no',mlcInternationalVoyage:'no',mlcOperatingFromForeignPort:'yes'};
  const certificate=gt=>search([mlc],{...profile,grossTonnage:gt}).find(r=>r.section.id==='certificate-scope');
  assert.equal(certificate(499),undefined);
  assert.deepEqual(certificate(500).cases.map(c=>c.reference),['Regulation 5.1.3(1)(b)']);
  const exception=search([byEdition('solas-1974-NO')],{flag:'NO',solasException:'none',solasPassengers:12,solasTonnage:499,solasLakes:'no'}).find(r=>r.section.id==='exceptions');
  assert.deepEqual(exception.cases.map(c=>c.reference),['Regulation I/3(a)(ii)']);
  const oil=byEdition('eu-530-2012').sections.find(s=>s.id==='heavy-grade-definition');
  const grade=(value)=>evaluate(oil.criteria,{euOilTanker:'yes',deadweightTonnes:800,euPortActivity:'enter',euGovernmentService:'no',euOilKind:'other',euOilDensity:900,euOilViscosity:value});
  assert.equal(grade(180),false);assert.equal(grade(180.01),true);
});

test('oil characteristics inform the carriage rule without requiring the same conclusion as another input',()=>{
  const doc=byEdition('eu-530-2012'),values={euOilTanker:'yes',deadweightTonnes:800,euGovernmentService:'no',euMemberFlag:'no',euPortActivity:'enter',
    euOilKind:'other',euOilDensity:900,euOilViscosity:181};
  const hits=profile=>search([doc],profile).map(r=>r.section.id);
  assert.ok(hits(values).includes('heavy-grade-carriage'));
  assert.ok(!hits({...values,euOilViscosity:180}).includes('heavy-grade-carriage'));
  assert.ok(!hits({...values,euPortActivity:'none'}).includes('heavy-grade-definition'));
  const inferred=screeningValues(values,doc.version);
  assert.equal(inferred.euHeavyGradeOil,'yes');assert.equal(values.euHeavyGradeOil,undefined);
  assert.match(evidenceRows({field:'euHeavyGradeOil',op:'eq',value:'yes'},[],values,inferred)[0].entered,/from other specifications/);
});

test('the consolidated passenger sections, original wording and amendments follow date, exclusions and voyage details',()=>{
  const doc=byEdition('no-pax-consolidated-2026');
  assert.equal(doc.sections.length,19);
  const values={lengthOverall:14,passengers:10,norwegianWaters:'yes',ambulanceSchool:'no',shipTender:'no',schoolSafetyActivities:'no',
    clubMemberRecreation:'no',mainlandTerritorialWaters:'yes',offshoreTransfer:'no',weatherCover:'no',tradingArea:'4',voyageSpeed:20};
  const source=doc.sections.find(s=>s.id==='s7');
  assert.ok(decodeURIComponent(source.sourceUrl).endsWith('/§7'));
  assert.equal(search([doc],values,'2025-12-31').length,0);
  assert.deepEqual(search([doc],{...values,voyageMonth:'01'}).find(r=>r.section===source).cases.map(c=>c.reference),['§ 7(a)']);
  assert.equal(search([doc],{...values,voyageMonth:'06'}).some(r=>r.section===source),false);
  assert.deepEqual(search([doc],{...values,voyageMonth:'06',voyageSpeed:20.1}).find(r=>r.section===source).cases.map(c=>c.reference),['§ 7(b)']);
  const life=search([doc],{...values,childrenAboard:'yes'}).find(r=>r.section.id==='s16');
  assert.equal(life.state,'match');assert.match(life.section.text,/ISO 12402-4/);
  assert.equal(search([doc],{...values,offshoreTransfer:'yes'}).length,0);
  const amendment=byEdition('no-pax-amend-2025'),stop=amendment.sections[0],transfer={...values,offshoreTransfer:'yes',outdoorSteering:'yes',sailOrProtected:'no'};
  assert.equal(assess(stop,amendment.version,transfer,'2025-12-31'),'review');
  assert.equal(assess(stop,amendment.version,transfer,'2026-01-01'),'outside');
});

test('flotation rules distinguish wearing, carriage, activity exemptions and the exact tow-speed boundary',()=>{
  const nz=byEdition('nz-rule91-2026'),base={nzPart91Waters:'yes',nzRecCraft:'yes',nzUnderway:'yes',nzLifejacketLengthM:6};
  const find=(values,id)=>search([nz],{...base,...values}).find(r=>r.section.id===id);
  assert.equal(find({nzSwimming:'yes',nzLifejacketException:'no'},'small-craft'),undefined);
  const swimmer=find({nzSwimming:'yes'},'lifejackets');
  assert.ok(swimmer.cases.some(c=>c.reference==='91.4(1B)'&&c.state===true));
  assert.ok(swimmer.cases.some(c=>c.reference==='91.4(1)'));
  const tow=speed=>find({nzTowingPerson:'yes',nzTowSport:'no',nzTowSpeed:speed},'lifejackets').cases
    .filter(c=>['91.4(7)','91.4(8)'].includes(c.reference)).map(c=>c.reference);
  assert.deepEqual(tow(4.99),['91.4(8)']);assert.deepEqual(tow(5),['91.4(7)']);
  const us=byEdition('us-33cfr175-2025'),canoe={usPart175Location:'waters',usPart175Excluded:'no',usPfdCraft:'yes',usPfdLengthFt:16,usPfdDesign:'canoe',usForeignRace:'no'};
  const found=search([us],canoe);
  assert.equal(found.some(row=>row.section.id==='throwable'),false);
  const wearable=found.find(row=>row.section.id==='devices').cases.find(c=>c.reference==='§ 175.15(a)');
  assert.equal(wearable.state,true);
  assert.deepEqual(found.find(row=>row.section.id==='exemptions').cases.map(c=>c.reference),['§ 175.17(a)']);
});
