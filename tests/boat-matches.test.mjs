import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {searchBoat} from '../site/js/boat-matches.js';

const documents = ['folios','eu-folios'].flatMap(name => {
  const book = JSON.parse(readFileSync(new URL(`../site/data/${name}.json`,import.meta.url),'utf8'));
  return book.instruments.flatMap(instrument => instrument.versions.map(version => ({
    type:'folio', key:`official:${instrument.id}|${version.id}`,instrument,version,sections:version.sections
  })));
});
const cargo = {flag:'NO',shipType:'cargo',lengthL:12,lengthOverall:14,grossTonnage:45,approvedTraining:'no',onlyPassenger2020:'no',tows:'yes'};
const run = (values,asOf='2026-11-23',docs=documents) => searchBoat(docs,{values,asOf});
const rows = groups => groups.flatMap(group => group.sections);

test('returns original matched cargo provisions and distinguishes chapter-level screening', () => {
  const result=run(cargo), matched=rows(result.matched),review=rows(result.review);
  const survey=matched.find(r=>r.section.id==='s149');
  const doc=documents.find(d=>d.version.id==='no-cargo-2025');
  assert.equal(survey.doc,doc);
  assert.equal(survey.section,doc.sections.find(s=>s.id==='s149'));
  assert.equal(survey.dateState,true);
  assert.deepEqual(survey.missing,[]);
  assert.ok(review.some(r=>r.section.id==='s53'));
  assert.ok(!matched.some(r=>r.section.id==='s53'));
  assert.ok([...matched,...review].every(r=>r.doc.version.id==='no-cargo-2025'));
});

test('missing facts, statutory exceptions and length boundaries remain distinct', () => {
  const {approvedTraining,...rest}=cargo;
  const result=run(rest);
  assert.equal(result.matched.length,0);
  assert.deepEqual(rows(result.review).find(r=>r.section.id==='s1').missing,['approvedTraining']);
  assert.deepEqual(run({...cargo,approvedTraining:'yes'}),{matched:[],review:[]});
  assert.deepEqual(run({...cargo,lengthL:24}),{matched:[],review:[]});
  assert.deepEqual(run({...cargo,flag:'LR'}),{matched:[],review:[]});
  assert.deepEqual(run({}),{matched:[],review:[]});
});

test('foreign passenger operations use coastal scope and the date of the located source', () => {
  const pax={flag:'LR',shipType:'passenger',lengthOverall:8.2,passengers:12,norwegianWaters:'yes',ambulanceSchool:'no',shipTender:'no',
    schoolSafetyActivities:'no',clubMemberRecreation:'no',mainlandTerritorialWaters:'yes',maxPropulsionKw:45};
  const old=run(pax,'2022-01-01');
  assert.ok(rows(old.matched).some(r=>r.doc.version.id==='no-pax-2020'&&r.section.id==='s2-1'));
  assert.ok(!rows(old.review).some(r=>r.section.id==='s3'));
  assert.deepEqual(run({...pax,norwegianWaters:'no'},'2022-01-01'),{matched:[],review:[]});
  const current=run({...pax,offshoreTransfer:'no'});
  assert.ok(rows(current.matched).some(r=>r.doc.version.id==='no-pax-consolidated-2026'&&r.section.id==='s1'));
  assert.ok(rows(current.review).some(r=>r.doc.version.id==='no-pax-amend-2023'));
  assert.ok(!rows(current.review).some(r=>r.doc.version.id==='no-pax-2020'));
  const transfer=run({...pax,offshoreTransfer:'yes'});
  assert.deepEqual(rows(transfer.review).map(r=>r.doc.version.id),['no-pax-amend-2026']);
});

test('tanker scope requires evidence of tanker activity, route, DWT, and dated edition', () => {
  const tanker={flag:'LR',shipType:'cargo',euOilTanker:'yes',deadweightTonnes:600,euHeavyGradeOil:'yes',euMemberFlag:'no',euPortActivity:'enter',euGovernmentService:'no'};
  assert.ok(rows(run(tanker,'2007-01-01').matched).some(r=>r.doc.version.id==='eu-1726-2003'));
  assert.deepEqual(run({...tanker,euHeavyGradeOil:'no'},'2007-01-01'),{matched:[],review:[]});
  assert.deepEqual(run({...tanker,euOilTanker:'no'}),{matched:[],review:[]});
  assert.deepEqual(run({...tanker,euPortActivity:'none'}),{matched:[],review:[]});
  const current=run(tanker);
  assert.equal(current.matched.length,0);
  assert.ok(rows(current.review).some(r=>r.doc.version.id==='eu-530-2012'&&r.dateState===null));
});

test('imports retain identity, date boundaries and explicit geographic conditions', () => {
  const rule={field:'lengthOverall',op:'gte',value:12};
  const section={id:'local-s1',criteria:rule};
  const doc={type:'local',key:'local:test|edition',instrument:{id:'test',title:'Imported text',jurisdiction:'FR'},
    version:{id:'edition',effectiveFrom:'2020-01-01',effectiveTo:'2026-11-24'},sections:[section]};
  assert.equal(rows(run(cargo,'2026-11-23',[doc]).review)[0].section,section);
  assert.equal(run({...cargo,flag:'FR'},'2026-11-23',[doc]).matched[0].id,'local:test');
  assert.equal(run({...cargo,flag:'FR'},'2026-11-24',[doc]).matched.length,0);
  const coastal={...doc,sections:[{...section,criteria:{all:[rule,{field:'norwegianWaters',op:'eq',value:'yes'}]}}]};
  assert.equal(run({...cargo,norwegianWaters:'yes'},'2026-11-23',[coastal]).matched.length,1);
  assert.equal(run(cargo,'',[doc]).matched.length,0);
});

test('treaty flag dates, foreign-port service, GT boundary and voluntary certification retain their distinct effects', () => {
  const treaty=JSON.parse(readFileSync(new URL('../site/data/mlc-folios.json',import.meta.url),'utf8'));
  const docs=treaty.instruments.flatMap(instrument=>instrument.versions.map(version=>({instrument,version,sections:version.sections,type:'folio'})));
  const vessel={flag:'HK',shipType:'cargo',grossTonnage:500,mlcSeagoing:'yes',mlcCommercialActivity:'yes',mlcFishingOrSimilar:'no',
    mlcWarshipOrNavalAuxiliary:'no',mlcTraditionalBuild:'no',mlcInternationalVoyage:'no',mlcOperatingFromForeignPort:'yes',mlcShipownerRequest:'no'};
  const ids=(values,date)=>rows(run(values,date,docs).matched).map(row=>row.section.id);
  assert.deepEqual(run(vessel,'2018-12-19',docs),{matched:[],review:[]});
  assert.ok(ids({...vessel,flag:'CN'},'2016-11-12').includes('certificate-scope'));
  const hongKong=run(vessel,'2018-12-20',docs);
  assert.deepEqual(hongKong.matched.map(group=>group.instrument.jurisdiction),['HK']);
  assert.deepEqual(hongKong.review.map(group=>group.instrument.jurisdiction),['HK']);
  assert.ok(rows(hongKong.matched).some(row=>row.section.id==='certificate-scope'));
  assert.ok(!ids({...vessel,grossTonnage:499},'2026-01-01').includes('certificate'));
  assert.ok(ids({...vessel,grossTonnage:499,mlcShipownerRequest:'yes'},'2026-01-01').includes('voluntary'));
  assert.deepEqual(run({...vessel,flag:''},'2026-01-01',docs),{matched:[],review:[]});
  assert.deepEqual(run({...vessel,flag:'CU'},'2026-11-23',docs),{matched:[],review:[]});
  assert.deepEqual(run({...vessel,shipType:'fishing'},'2026-11-23',docs),{matched:[],review:[]});
  assert.deepEqual(run({...vessel,mlcSeagoing:'no'},'2026-11-23',docs),{matched:[],review:[]});
  const small=run({...vessel,grossTonnage:199},'2026-01-01',docs);
  assert.ok(rows(small.review).some(row=>row.section.id==='small-ships'));
  assert.ok(!rows(small.matched).some(row=>row.section.id==='small-ships'));
});

const nationalBook = JSON.parse(readFileSync(new URL('../site/data/flag-folios.json',import.meta.url),'utf8'));
const national = nationalBook.instruments.flatMap(instrument => instrument.versions.map(version => ({instrument,version,sections:version.sections,type:'folio'})));
const nationalResult = (values,asOf) => run(values,asOf,national);

test('UK statutory class, construction day, actual UK waters and historical exclusion select the correct provisions', () => {
  const vessel = {flag:'GB',shipType:'cargo',ukLsaExcluded:'no',ukLsaClass:'VII',ukLsaInternational:'yes',ukLsaConstruction:'1998-06-30'};
  const hits = (values,day) => rows(nationalResult(values,day).matched).map(row=>[row.doc.version.id,row.section.id]);
  assert.deepEqual(hits(vessel,'2022-12-18'),[['gb-2020-501','older-international']]);
  assert.deepEqual(hits(vessel,'2022-12-19'),[['gb-lsa-continued-2022','older-international']]);
  assert.deepEqual(hits({...vessel,ukLsaConstruction:'1998-07-01'},'2026-11-23'),[['gb-lsa-continued-2022','new-international']]);
  assert.deepEqual(hits({...vessel,flag:'LR',ukLsaReach:'waters'},'2026-11-23'),[['gb-lsa-continued-2022','older-international']]);
  for (const reach of ['uk','outside',undefined]) assert.deepEqual(nationalResult({...vessel,flag:'LR',ukLsaReach:reach},'2026-11-23'),{matched:[],review:[]});
  assert.deepEqual(nationalResult({...vessel,shipType:'fishing'},'2026-11-23'),{matched:[],review:[]});
  const craft = {...vessel,ukLsaHighSpeed:'yes'};
  for (const [date,id] of [['2022-12-18','high-speed-2004'],['2022-12-19','high-speed-reference']]) {
    const result = nationalResult(craft,date);
    assert.equal(result.matched.length,0);
    assert.deepEqual(rows(result.review).map(row=>row.section.id),[id]);
  }
});

test('U.S. 16-foot rule checks location, exemptions and the verified eCFR interval independently of annual-print date', () => {
  const vessel = {flag:'LR',usPart175Location:'waters',usPart175Excluded:'no',usPfdCraft:'yes',usPfdLengthFt:16,usPfdExemption:'no'};
  for (const date of ['2016-12-31','2021-10-22','2022-04-20','2026-11-23']) {
    const matched = rows(nationalResult(vessel,date).matched);
    assert.deepEqual(matched.map(row=>row.section.id),['throwable']);
    assert.equal(matched[0].doc.version.editionDate,'2025-07-01');
  }
  for (const change of [{usPfdLengthFt:15.99},{usPfdExemption:'yes'},{usPart175Excluded:'yes'},{usPart175Location:'outside'}]) {
    assert.equal(nationalResult({...vessel,...change},'2026-11-23').matched.length,0);
  }
  const absent = nationalResult({...vessel,usPfdExemption:undefined},'2026-11-23');
  assert.deepEqual(rows(absent.review).find(row=>row.section.id==='throwable').missing,['usPfdExemption']);
  assert.deepEqual(nationalResult(vessel,'2016-12-30'),{matched:[],review:[]});
  assert.ok(rows(nationalResult(vessel,'2026-11-24').review).some(row=>row.section.id==='throwable'&&row.dateState===null));
  const registrationOnly = nationalResult({flag:'US'},'2026-11-23');
  assert.deepEqual(registrationOnly.matched,[]);
  assert.deepEqual(rows(registrationOnly.review).map(row=>row.section.id),['application']);
});

test('New Zealand distinguishes regional bylaws, signed commencement, six-metre and 500-GT boundaries', () => {
  const boat = {flag:'US',nzPart91Waters:'yes',nzHarbour:'yes',grossTonnage:499,nzOtherVesselGt:500, nzOriginalArea:'yes',
    nzRecCraft:'yes',nzLifejacketLengthM:6,nzUnderway:'yes',nzLifejacketException:'no'};
  const hits = (values,day) => rows(nationalResult(values,day).matched).map(row=>[row.doc.version.id,row.section.id]);
  for (const [date,edition] of [['2003-03-21','nz-rule91-2003'],['2007-06-27','nz-rule91-2003'],['2007-06-28','nz-rule91-2007'],
    ['2013-10-22','nz-rule91-2007'],['2013-10-23','nz-rule91-2013'],['2026-10-08','nz-rule91-2013']]) {
    assert.deepEqual(hits(boat,date),[[edition,'harbour']]);
  }
  assert.deepEqual(hits({...boat,nzOriginalArea:'no'},'2007-06-28'),[]);
  assert.deepEqual(hits({...boat,nzOriginalArea:'no'},'2013-10-23'),[['nz-rule91-2013','harbour']]);
  assert.deepEqual(hits(boat,'2026-10-09'),[['nz-rule91-2026','small-craft'],['nz-rule91-2026','harbour']]);
  assert.deepEqual(hits({...boat,nzLifejacketLengthM:6.01,grossTonnage:500},'2026-11-23'),[]);
  assert.deepEqual(hits({...boat,nzLifejacketException:'yes',nzOtherVesselGt:499},'2026-11-23'),[]);
  assert.deepEqual(hits({...boat,nzPart91Waters:'no'},'2026-11-23'),[]);
});
