import {caseState, evaluate, isoDay, limitedScope, screeningRule, screeningValues, temporal} from './model.js';

const cargo = new Set(['FOR-2025-12-16-2652', 'FOR-2014-12-19-1853']);
const passenger = 'FOR-2020-01-14-63';
const tankers = new Set(['eu-tanker-417', 'eu-tanker-530']);
const nationalReach = new Map([
  ['gb-lifesaving-2020', ['GB','ukLsaReach',['uk','waters']]],
  ['us-cfr33-175', ['US','usPart175Location',['waters','highseas']]],
  ['nz-navigation-part91', ['NZ','nzPart91Waters',['yes']]],
]);

/** Keep only unknown leaves that could still change this expression's answer. */
function missingFields(rule, values) {
  if (!rule || evaluate(rule, values) !== null) return [];
  if (rule.not) return missingFields(rule.not, values);
  if (rule.all || rule.any) {
    return [...new Set((rule.all || rule.any).flatMap(child => missingFields(child, values)))];
  }
  return rule.field ? [rule.field] : [];
}

function familyInterest(doc, values) {
  const family = doc.instrument.id;
  if (doc.type === 'local' || doc.instrument.local) return 'identified';
  if (doc.instrument.flagState) {
    if (values.flag !== doc.instrument.flagState) return 'none';
    const scope = doc.sections.find(section => section.id === doc.instrument.scopeSection);
    return scope && evaluate(scope.criteria, values) === false ? 'none' : 'identified';
  }
  if (nationalReach.has(family)) {
    const [country,field,accepted] = nationalReach.get(family);
    if (family === 'gb-lifesaving-2020' && values.ukLsaReach === 'uk' && values.flag && values.flag !== 'GB') return 'none';
    if (values[field]) return accepted.includes(values[field]) ? 'identified' : 'none';
    return values.flag === country ? 'scope' : 'none';
  }
  if (cargo.has(family)) {
    if ((values.flag && values.flag !== 'NO') || (values.shipType && values.shipType !== 'cargo')) return 'none';
    if (Number(values.lengthL) >= 24 || Number(values.grossTonnage) >= 500) return 'none';
    if (values.flag === 'NO' && values.shipType === 'cargo') return 'identified';
    return values.flag === 'NO' || values.shipType === 'cargo' ? 'scope' : 'none';
  }
  if (family === passenger) {
    if (values.norwegianWaters === 'no' || Number(values.passengers) > 12 || Number(values.lengthOverall) >= 24) return 'none';
    const activity = Number(values.passengers) > 0 || values.shipType === 'passenger' || values.onlyPassenger2020 === 'yes'
      || values.schoolSafetyActivities === 'yes' || values.clubMemberRecreation === 'yes';
    if (!activity) return 'none';
    return values.norwegianWaters === 'yes' ? 'identified' : 'scope';
  }
  if (tankers.has(family)) {
    if (values.euOilTanker === 'yes') return 'identified';
    return !values.euOilTanker && values.euHeavyGradeOil === 'yes' ? 'scope' : 'none';
  }
  return 'identified';
}

/** A journal notice can supply scope evidence even when its isolated text has no complete vessel rule. */
function noticeEvidence(doc, section, values, originals, day) {
  const id = doc.version.id;
  const original = originals.get(doc.instrument.id);
  const scope = original?.sections.find(s => s.id === 's1');
  if (!scope?.criteria) return null;
  if (doc.instrument.id === passenger) {
    const special = original.sections.find(s => s.id === 's2-1');
    if (id === 'no-pax-amend-2026' && section.id === 's1-2-c' && values.offshoreTransfer === 'yes') {
      return {rule:scope.criteria, evidence:scope, reason:'The notice adds an exclusion for the stated offshore transfer activity.'};
    }
    const offshore = day >= '2026-01-01' ? [{field:'offshoreTransfer',op:'eq',value:'no',source:'2025/2652 § 158(5)'}] : [];
    if (id === 'no-pax-amend-2023' && section.id === 's2-1' && special?.criteria) {
      return {rule:{all:[scope.criteria,...offshore]}, evidence:special, reason:'Read § 2(1) to determine which operating requirements apply. This notice contains a historical amendment to the passenger regulation.'};
    }
    if (id === 'no-pax-amend-2025' && section.id === 's9-3' && values.wheelhouse === 'no') {
      return {rule:{all:[original.sections.find(s => s.id === 's9-3')?.criteria,...offshore]}, evidence:scope,
        reason:'Check whether steering is exclusively outdoors and whether the sailing- or heritage-vessel exception applies.'};
    }
  }
  if (doc.instrument.id === 'FOR-2014-12-19-1853' && id === 'no-cargo-amend-2015') {
    if (section.id === 's89a' && values.tows === 'yes' && !(Number(values.lengthOverall) >= 15)) {
      return {rule:scope.criteria, evidence:scope, reason:'The temporary tow-permit clause also depends on vessel instruction, tow size and trading area.'};
    }
    if (section.id === 's89-2' && (values.contractDate || values.keelDate)) {
      const transition = original.sections.find(s => s.id === 's3');
      return {rule:transition?.criteria, evidence:transition, reason:'The notice changes the transition provision. Check the first paragraph and the referenced deadlines.'};
    }
  }
  return null;
}

function scopeLimit(doc, section, values) {
  const family = doc.instrument.id;
  if (doc.type === 'local' || doc.instrument.local) return null;
  if (family === passenger && section.id === 's9-3' && section.screeningLevel === 'instrument') {
    return 'The rule checks passenger-vessel scope. This paragraph also requires exclusively outdoor steering and has sailing- and heritage-vessel exceptions.';
  }
  if (section.id === 'scope' && tankers.has(family)) return null;
  if (!limitedScope(section,values)) return null;
  if (section.confirmWhen&&evaluate(section.confirmWhen,values)!==true)return section.scopeNote;
  if (section.screeningLevel === 'context') return section.caveat || 'A competent authority must determine the individual case.';
  if (section.screeningLevel === 'partial') return 'The indexed conditions narrow this passage. Read the original for its remaining qualifications and exceptions.';
  if (section.screeningLevel === 'chapter') return 'The entered particulars meet or may meet the chapter scope. Check the conditions in this provision.';
  if (section.screeningLevel === 'instrument') return 'The entered particulars meet or may meet the instrument scope. This provision has no separate complete vessel rule.';
  return null;
}

/** Narrowly scoped local rules may cross a border. The issuer alone cannot establish a flag or coastal nexus. */
function localJurisdiction(doc, rule, values) {
  if (doc.type !== 'local' && !doc.instrument.local && (cargo.has(doc.instrument.id) || doc.instrument.id === passenger || tankers.has(doc.instrument.id) || nationalReach.has(doc.instrument.id))) return null;
  if(doc.instrument.registeredText)return null;
  const jurisdiction = doc.instrument.jurisdiction?.trim().toUpperCase();
  if (!jurisdiction || values.flag === jurisdiction) return null;
  if (jurisdiction === 'NO' && values.norwegianWaters === 'yes') return null;
  const withoutNexus = {...values};
  for (const key of ['flag','norwegianWaters','euMemberFlag','euPortActivity']) delete withoutNexus[key];
  if (evaluate(rule, values) === true && evaluate(rule, withoutNexus) !== true) return null;
  return 'Confirm the flag-state or territorial connection to this source’s issuing jurisdiction.';
}

function rowFor(doc, section, context) {
  const {values, day, interest, originals, includeUnspecified} = context;
  const local = doc.type === 'local' || doc.instrument.local;
  const family = doc.instrument.id;
  const isScope = ['s1','scope','application','geographic-reach','original-area'].includes(section.id);
  if (!includeUnspecified && !local && family === 'gb-lifesaving-2020' && ['high-speed-reference','high-speed-2004'].includes(section.id) && values.ukLsaHighSpeed !== 'yes') return null;
  const notice = !section.criteria && !local ? noticeEvidence(doc, section, values, originals, day) : null;
  if (interest === 'scope' && !isScope && !notice) return null;
  const rule = section.criteria ? screeningRule(section,doc.version,day) : notice?.rule;
  if (!rule) {
    if (!includeUnspecified && (!local || !values.flag || section !== doc.sections[0] || doc.sections.some(s => s.criteria) || doc.instrument.jurisdiction !== values.flag)) return null;
    return {doc,section,state:'review',missing:[],reason:section.caveat || 'This passage has no indexed vessel conditions.'};
  }
  const criteria = [rule];
  if (!local && doc.version.id === 'eu-1726-2003' && section.id === 'scope' && section.screeningLevel==='instrument') {
    criteria.push({any:[{field:'deadweightTonnes',op:'gte',value:5000},{field:'euHeavyGradeOil',op:'eq',value:'yes'}]});
  }
  const state = evaluate({all:criteria}, values);
  if (state === false) return null;
  const cases=section.cases?.map(item=>({...item,state:caseState(item,values)})).filter(item=>item.state!==false);
  const openCases=section.screenCases&&!cases?.some(item=>item.state===true)?(cases||[]).map(item=>item.when):[];
  const pending=section.confirmWhen&&limitedScope(section,values)?section.confirmWhen:null;
  const missing = [...new Set([...criteria,pending,...openCases].flatMap(node => missingFields(node, values)))];
  const time = day ? temporal(doc.version, day) : null;
  const limitation = notice?.reason || scopeLimit(doc, section, values) || localJurisdiction(doc, rule, values);
  const reason = limitation || (state === null ? 'Further vessel particulars are needed to evaluate the cited conditions.' :
    time === null ? 'The edition’s effective interval is unconfirmed for the requested date.' : 'The supplied particulars meet the indexed conditions for this dated provision.');
  return {doc, section, state:state === true && time === true && !limitation ? 'match' : 'review',
    missing, reason, scopeState:state, dateState:time, evidence:notice?.evidence || section,
    cases};
}

/** Search dated provisions. The caller supplies the reference day, including for a current-day search. */
export function searchBoat(documents, profile = {}, {includeUnspecified=false} = {}) {
  const supplied=profile.values||{};
  if (!includeUnspecified && !Object.values(supplied).some(value => value !== undefined && value !== null && value !== '')) return {matched:[],review:[]};
  const day = isoDay(profile.asOf);
  const originals = new Map();
  for (const doc of documents) {
    if (doc.type !== 'local' && !doc.instrument?.local && !doc.version?.archiveRecord && doc.sections?.some(s => s.id === 's1' && s.criteria)) originals.set(doc.instrument.id, doc);
  }
  const matched = new Map(), review = new Map();
  for (const doc of documents) {
    if (!doc.instrument || !doc.version || !doc.sections?.length || ['archive','world'].includes(doc.type)) continue;
    if (day ? temporal(doc.version, day) === false : doc.version.effectiveTo) continue;
    const values=screeningValues(supplied,doc.version);
    // The broad view uses the actual three-valued predicates for every alternative.
    // An unentered trade, ship type or coastal operating area supplies no negative evidence.
    let interest='identified';
    if(!includeUnspecified)interest=familyInterest(doc,values);
    else if(doc.type!=='local'&&!doc.instrument.local){
      if(doc.instrument.flagState && values.flag && doc.instrument.flagState!==values.flag)continue;
      if(doc.instrument.id==='gb-lifesaving-2020' && values.ukLsaReach==='uk' && values.flag && values.flag!=='GB')continue;
    }
    if (interest === 'none') continue;
    for (const section of doc.sections) {
      const row = rowFor(doc, section, {values,day,interest,originals,includeUnspecified});
      if (!row) continue;
      const groups = row.state === 'match' ? matched : review;
      const id = doc.instrument.key || ((doc.type === 'local' || doc.instrument.local) ? 'local:' : 'official:') + doc.instrument.id;
      if (!groups.has(id)) groups.set(id, {id,title:doc.instrument.shortTitle || doc.instrument.title,instrument:doc.instrument,sections:[]});
      groups.get(id).sections.push(row);
    }
  }
  for (const group of review.values()) {
    group.sections.sort((a,b) => Number(Boolean(b.section.criteria && b.section.screeningLevel === 'section'))
      - Number(Boolean(a.section.criteria && a.section.screeningLevel === 'section')) || a.missing.length - b.missing.length);
  }
  return {matched:[...matched.values()],review:[...review.values()]};
}
