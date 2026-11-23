import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {lookupQuery, registerMatches, wikiVessel} from '../site/js/vessel-lookup.js';

const candidate = {id:'Q191888',name:'Queen Mary 2',provider:'Wikidata'};
const entity = id => 'http://www.wikidata.org/entity/'+id;
const rank = 'http://wikiba.se/ontology#NormalRank';
function statement(kind, value, qualifiers = {}) {
  const properties = {ship:entity(candidate.id),kind,value,rank,...qualifiers};
  return Object.fromEntries(Object.entries(properties).map(([key,value]) => [key,{value}]));
}
const identity = statement('imo','9241061');
const lookupDate = '2026-11-23';
const facts = rows => Object.fromEntries(wikiVessel(candidate,rows,lookupDate).evidence.map(e => [e.key,e.value]));

test('typed searches distinguish a checked IMO and actual nine-digit MMSI', () => {
  assert.equal(lookupQuery('IMO 9241061').search,'haswbstatement:P458=9241061');
  assert.equal(lookupQuery('310627000').search,'haswbstatement:P587=310627000');
  assert.equal(lookupQuery('LIBAS').kind,'name');
  assert.throws(() => lookupQuery('IMO 9241062'),/check digit/);
  assert.throws(() => lookupQuery('MMSI 31062'),/nine/);
  assert.throws(() => lookupQuery('!'),/characters/);
  assert.ok(!lookupQuery('Fram:incategory:test').search.includes(':incategory:'));
});

test('registry IDs and units trace to the vessel-only snapshot', async () => {
  const book = JSON.parse(await readFile(new URL('../site/data/vessels-no.json',import.meta.url),'utf8'));
  assert.ok(book.rows.length > 1000);
  assert.deepEqual(book.fields,['id','name','registrationMark','callSign','lengthOverallMetres','grossTonnage1969','buildYear']);
  assert.match(book.memberSha256,/^[0-9a-f]{64}$/);
  const row = book.rows.find(r => r[2] && r[3] && r[4] && r[5] && r[6]);
  const match = registerMatches(book, lookupQuery(row[2])).find(r => r.id===row[0]);
  assert.ok(match);
  assert.equal(match.identifier,row[2]);
  assert.equal(new URL(match.sourceUrl).pathname,'/vessel-api/api/v1/vessels/'+row[0]);
  const values = Object.fromEntries(match.evidence.map(f => [f.key,f.value]));
  assert.deepEqual(values,{flag:'NO',shipType:'fishing',lengthOverall:row[4],grossTonnage:row[5],buildDate:row[6]});
  assert.ok(match.evidence.every(e => e.sourceUrl===match.sourceUrl));
  assert.deepEqual(registerMatches(book, lookupQuery('IMO 9241061')),[]);
});

test('historical flags, unresolved gross tonnage and generic length are withheld', () => {
  const rows = [identity,statement('gt','149215',{unit:entity('Q199')}),statement('gt','148528',{unit:entity('Q199')}),
    statement('length','345.03',{unit:entity('Q11573')}),statement('flag',entity('Q145'),{end:'2011-01-01',code:'GB'}),
    statement('flag',entity('Q23635'),{start:'2011-01-01',code:'BM'}),statement('type',entity('Q2055880')),
    statement('keel',entity('Q14592615'),{when:'2002-07-04T00:00:00Z',precision:'11'})];
  const record = wikiVessel(candidate,rows,lookupDate);
  assert.deepEqual(facts(rows),{flag:'BM',shipType:'passenger',keelDate:'2002-07-04'});
  assert.equal(record.identifier,'IMO 9241061');
  assert.match(record.notes.join(' '),/conflicting/);
  assert.equal(record.evidence.every(e => e.sourceUrl.startsWith('https://www.wikidata.org/wiki/Q191888#P')),true);
});

test('earlier point-in-time and ended classifications cannot fill current particulars', () => {
  const past = {when:'2020-06-01T00:00:00Z',precision:'11'};
  const rows = [identity,statement('flag',entity('Q145'),{...past,code:'GB'}),statement('type',entity('Q2055880'),past),
    statement('type',entity('Q1420024'),{end:'2025-01-01'}),statement('type',entity('Q105999'))];
  assert.deepEqual(facts(rows),{shipType:'cargo'});
});

test('vessel dates retain their precision and only expressly qualified LOA can fill the length field', () => {
  const rows = [identity,statement('keel',entity('Q14592615'),{when:'2002-07-01T00:00:00Z',precision:'10'}),
    statement('length','345.03',{unit:entity('Q11573'),basis:entity('Q2358152')}),
    statement('gt','1234',{unit:entity('Q191118')})];
  assert.deepEqual(facts(rows),{lengthOverall:345.03,keelDate:'2002'});
  assert.deepEqual(facts([identity,statement('length','1100',{basis:entity('Q2358152'),unit:entity('Q3710')})]),{});
});

test('preserves uncertainty for unidentifiable items, competing flags and overlapping ship types', () => {
  assert.throws(() => wikiVessel(candidate,[statement('mmsi','310627000')],lookupDate),/individual vessel/);
  const rows = [identity,statement('flag',entity('Q145'),{code:'GB'}),statement('flag',entity('Q23635'),{code:'BM'}),
    statement('type',entity('Q105999')),statement('type',entity('Q2055880'))];
  assert.deepEqual(facts(rows),{});
  assert.throws(() => wikiVessel(candidate,Array(181).fill(identity),lookupDate),/many conflicting/);
});
