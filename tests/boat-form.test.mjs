import assert from 'node:assert/strict';
import {test} from 'node:test';
import {revisionDates} from '../site/js/revision-picker.js';
import {lookupEvidence} from '../site/js/boat-form.js';

test('revision choices use flag-specific commencement dates and distinguish publication-only editions',()=>{
  const edition=(flag,label,dates)=>({instrument:{jurisdiction:flag,title:'Flag rules'},version:{label,...dates}});
  const docs=[edition('NO','As issued',{publishedOn:'2014-12-19',effectiveFrom:'2015-01-01'}),
    edition('NO','Local notice',{publishedOn:'2025-08-09'}),edition('GB','British notice',{effectiveFrom:'2026-06-05'}),
    edition('NO','Undated copy',{}),edition('EU','Union edition',{effectiveFrom:'2024-07-01'})];
  assert.deepEqual(revisionDates(docs,{flag:'NO'}).map(r=>[r.edition,r.year,r.date,r.basis]),[
    ['Local notice','2025','2025-08-09','Published'],['As issued','2015','2015-01-01','In force from'],
    ['As issued','2014','2015-01-01','Published']]);
  assert.ok(revisionDates(docs,{flag:'DE',euMemberFlag:'yes'}).some(r=>r.edition==='Union edition'));
  assert.deepEqual(revisionDates(docs,{}),[]);
});

test('previously saved vessel facts keep their citations while their recorded values agree',()=>{
  const lookup={provider:'Register',evidence:[{key:'grossTonnage',label:'Tonnage',value:70,sourceUrl:'https://example.test/102'}]};
  assert.match(lookupEvidence(lookup,{grossTonnage:70}),/View statement/);
  assert.equal(lookupEvidence(lookup,{grossTonnage:71}),'');
});
