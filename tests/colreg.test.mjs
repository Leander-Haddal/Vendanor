import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {searchBoat} from '../site/js/boat-matches.js';

const catalogue = JSON.parse(readFileSync(new URL('../site/data/colreg-folios.json',import.meta.url),'utf8'));
const documents = catalogue.instruments.flatMap(instrument => instrument.versions.map(version => ({
  type:'folio', instrument, version, sections:version.sections,
})));
const boat = {flag:'DE',shipType:'recreational',lengthOverall:9.5,colregWaters:'high',colregLightBasis:'ordinary',colregTowSubject:'no'};

function search(changes={},asOf='2026-11-23') {
  const result = searchBoat(documents,{values:{...boat,...changes},asOf});
  return Object.fromEntries(Object.entries(result).map(([key,groups]) => [key,groups.flatMap(group => group.sections)]));
}

test('the IMO register covers named states and separately dated territorial extensions', () => {
  assert.equal(catalogue.partyCount,166);
  assert.equal(catalogue.territorialFlagCount,19);
  assert.equal(new Set(catalogue.instruments.map(i => i.flagState)).size,185);
  assert.equal(new Set(documents.map(d => d.version.id)).size,281);
  assert.equal(new Set(documents.map(d => d.version.pdf)).size,2);
  assert.equal(new Set(documents.flatMap(d => d.sections.map(s => s.clip))).size,17);
  for (const [flag,asOf,id] of [
    ['SO','2026-06-25',null],['SO','2026-06-26','colreg-usbook-SO'],
    ['KG','2026-10-14',null],['KG','2026-10-15','colreg-usbook-KG'],
    ['HK','1997-06-30','colreg-usbook-HK-GB'],['HK','1997-07-01','colreg-usbook-HK-CN'],
    ['MO','1999-03-21',null],['MO','1999-03-22','colreg-usbook-MO-PT'],['MO','1999-12-20','colreg-usbook-MO-CN'],
    ['CW','2010-10-09',null],['CW','2010-10-10','colreg-usbook-CW-NL'],
  ]) {
    const ids = new Set(search({flag},asOf).matched.map(row => row.doc.version.id));
    assert.deepEqual([...ids],id ? [id] : [],flag+' '+asOf);
  }
});

test('water and personal-boat scope do not depend on a commercial use or guessed coastal law', () => {
  const ordinary = search();
  assert(ordinary.matched.some(row => row.section.id==='lookout'));
  assert(ordinary.matched.some(row => row.section.id==='responsibility'));
  assert(ordinary.matched.every(row => row.doc.instrument.flagState==='DE'));
  for (const flag of ['', 'AD']) assert.deepEqual(search({flag}),{matched:[],review:[]});
  assert.deepEqual(search({colregWaters:'other'}),{matched:[],review:[]});
  assert.deepEqual(search({colregWaters:'special'}).matched.map(r => r.section.id),['scope']);
  const missing = search({colregWaters:undefined});
  assert.equal(missing.matched.length,0);
  assert(missing.review.some(row => row.section.id==='lookout' && row.missing.includes('colregWaters')));
});

test('Rule 22 follows length overall, including its printed exception below 20 metres', () => {
  for (const [lengthOverall,section] of [[11.99,'r22c'],[12,'r22b'],[19.99,'r22b'],[20,'r22b'],[49.99,'r22b'],[50,'r22a']]) {
    const matched = search({lengthOverall,lengthL:100,grossTonnage:1000}).matched.filter(r => /^r22[abc]$/.test(r.section.id));
    assert.deepEqual(matched.map(r => r.section.id),[section]);
    if (section==='r22b') assert.match(matched[0].section.text,/less than 20 meters, 3 miles/);
  }
  assert(!search({colregLightBasis:'alternative'}).matched.some(r => r.section.id.startsWith('r22')));
  assert(search({shipType:'fishing',lengthOverall:6}).matched.some(r => r.section.id==='r22c'));
});

test('the published 1981 amendment enters into force at the date given by the depositary', () => {
  const before = search({colregTowSubject:'yes'},'1983-05-31');
  const after = search({colregTowSubject:'yes'},'1983-06-01');
  assert(!before.matched.some(r => r.section.id==='r22d'));
  assert(after.matched.some(r => r.section.id==='r22d' && r.section.text.includes('a white all-round light, 3 miles.')));
  assert(!search({colregTowSubject:'no'},'1983-06-01').matched.some(r => r.section.id==='r22d'));
  const pair = catalogue.comparisons[0];
  const original = documents.find(d => d.version.id===pair.before.versionId).sections.find(s => s.id===pair.before.sectionId);
  const amended = documents.find(d => d.version.id===pair.after.versionId).sections.find(s => s.id===pair.after.sectionId);
  assert(!original.text.includes('partly submerged'));
  assert(amended.text.includes('partly submerged'));
});
