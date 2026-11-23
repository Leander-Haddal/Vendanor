import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {searchBoat} from '../site/js/boat-matches.js';

const catalogue = JSON.parse(readFileSync(new URL('../site/data/solas-folios.json',import.meta.url),'utf8'));
const documents = catalogue.instruments.flatMap(instrument => instrument.versions.map(version => ({
  type:'folio', instrument, version, sections:version.sections,
})));
const particulars = {flag:'NO',shipType:'cargo',solasVoyage:'international',solasLakes:'no',solasException:'none',solasTonnage:500,solasPassengers:12};
function results(changes={},asOf='2026-11-23') {
  const groups = searchBoat(documents,{values:{...particulars,...changes},asOf});
  return Object.fromEntries(Object.entries(groups).map(([k,v]) => [k,v.flatMap(row => row.sections)]));
}

test('the SOLAS source keeps the general 500-tonnage and more-than-12 passenger routes distinct', () => {
  assert(results().matched.some(r => r.section.id==='scope'));
  assert.deepEqual(results({solasTonnage:499}),{matched:[],review:[]});
  assert(results({solasTonnage:1,solasPassengers:13}).matched.some(r => r.section.id==='scope'));
  assert(results({solasTonnage:null,solasPassengers:13}).matched.some(r => r.section.id==='scope'));
  const unknown = results({solasTonnage:undefined,grossTonnage:501,solasPassengers:12});
  assert.equal(unknown.matched.length,0);
  assert(unknown.review.find(r => r.section.id==='scope').missing.includes('solasTonnage'));
});

test('specific chapter exceptions and the exceptional single-voyage administration decision remain explicit', () => {
  for (const change of [{solasLakes:'yes'},{solasException:'yacht'},{solasException:'fishing'},
    {solasException:'wood'},{solasVoyage:'other'},{flag:''}]) {
    assert.deepEqual(results(change),{matched:[],review:[]});
  }
  const single = results({solasVoyage:'single'});
  assert(single.matched.some(r => r.section.id==='scope'));
  assert(!single.matched.some(r => r.section.id==='single-voyage'));
  assert(single.review.some(r => r.section.id==='single-voyage' && /Administration/.test(r.section.text)));
});

test('SOLAS uses its own depositary dates and truthful source pages across flag changes', () => {
  assert.equal(catalogue.partyCount,169);
  assert.equal(catalogue.territorialFlagCount,10);
  assert.equal(new Set(documents.map(d => d.version.id)).size,181);
  assert.equal(new Set(documents.map(d => d.version.pdf)).size,1);
  assert.equal(new Set(documents.flatMap(d => d.sections.map(s => s.clip))).size,6);
  for (const [flag,asOf,id] of [
    ['NO','1980-05-24',null],['NO','1980-05-25','solas-1974-NO'],
    ['AU','1983-11-16',null],['AU','1983-11-17','solas-1974-AU'],
    ['MO','1999-08-23',null],['MO','1999-08-24','solas-1974-MO-PT'],
    ['MO','1999-12-20','solas-1974-MO-CN'],['BM','1988-06-22',null],['BM','1988-06-23','solas-1974-BM-GB'],
  ]) {
    const ids = [...new Set(results({flag},asOf).matched.map(r => r.doc.version.id))];
    assert.deepEqual(ids,id ? [id] : [],flag+' '+asOf);
  }
  const version = documents.find(d => d.version.id==='solas-1974-MO-PT').version;
  assert.match(version.flagEvidence.sourceUrl,/#page=16$/);
  assert.match(version.sections.find(s => s.id==='exceptions').text,/pleasure yachts not engaged in trade/i);
  assert.deepEqual(version.sections.find(s => s.id==='passengers').pages,[8,9]);
});
