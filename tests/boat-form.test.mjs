import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyLookup} from '../site/js/boat-form.js';

test('selecting a different registered boat starts a separate profile without inheriting particulars',()=>{
  const previous={id:'saved',identifier:'R-102',values:{flag:'NO',lengthOverall:12,mlcSeagoing:'yes'},lookup:{sourceUrl:'https://example.test/102'}};
  const selected=applyLookup(previous,{identifier:'R-103',sourceUrl:'https://example.test/103',values:{flag:'NO'}});
  assert.deepEqual(selected,{id:'',values:{flag:'NO'},separate:true});
  assert.equal(previous.values.lengthOverall,12);
});

test('rechecking the same vessel keeps independent entries and withdraws an unconfirmed source value',()=>{
  const current={id:'saved',identifier:'R-102',values:{flag:'NO',grossTonnage:70,lengthOverall:14,passengers:2},lookup:{
    sourceUrl:'https://example.test/102',evidence:[{key:'grossTonnage',value:70},{key:'lengthOverall',value:12}]}};
  const selected=applyLookup(current,{identifier:'r-102',sourceUrl:'https://example.test/102',values:{flag:'NO'}});
  assert.deepEqual(selected,{id:'saved',values:{flag:'NO',lengthOverall:14,passengers:2},separate:false});
});
