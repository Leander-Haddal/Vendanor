// Each entry identifies a paragraph in a pinned edition. Keep the publisher's
// actual paragraph as the outcome, including exceptions and referenced standards.
const eq=(field,value='yes')=>({field,op:'eq',value});
const limit=(field,op,value)=>({field,op,value});
const length=(op,value)=>limit('lengthOverall',op,value);
const all=(...rules)=>({all:rules});
const any=(...rules)=>({any:rules});
const under12=length('lt',12),under15=length('lt',15),atLeast15=length('gte',15);
const composite=any(eq('hullMaterial','composite'),eq('hullMaterial','aluminium'));
const farFromPort=all(eq('foreignTrade'),limit('distanceToPort','gt',30));
const towing=eq('tows'),anchors=eq('anchorHandling'),lift=eq('liftingGear');
const stairs={1:eq('stairDecks',1),2:limit('stairDecks','gt',1)};
const liquid=all(eq('liquidCargo'),eq('cargoDenser'));
// These particular paragraphs address every ship within their inherited scope.
// Other paragraphs in the same section can have their own qualifications.
const inScope=Symbol('within the provision scope');
const sources={
  'no-cargo-2025':{
    s11:{1:inScope},s13:{1:any(eq('tradingArea','small'),eq('tradingArea','greater')),2:inScope},
    s17:{1:inScope,2:inScope,3:inScope,4:inScope,5:inScope,6:eq('longRegularVoyages')},
    s19:{1:all(length('gte',12),limit('buildDate','gte','1998-07-01'),eq('wheelhouse')),
      2:all(length('gte',12),limit('buildDate','lt','1998-07-01'))},
    s20:{2:eq('emergencySteering'),4:under12,5:all(limit('grossTonnage','lt',300),eq('foreignTrade','no')),6:under15,8:under12},
    s21:{1:inScope,2:inScope,4:inScope},s22:{2:eq('standardCompass'),4:eq('standardCompass')},s33:{5:under12,6:all(under12,eq('foreignTrade','no')),7:inScope},
    s34:{1:eq('lifeRaft'),2:eq('lifeRaft'),3:eq('lifeRaft'),5:all(eq('lifeRaft'),limit('raftBoardingHeight','gt',4.5))},s35:{2:eq('childrenAboard')},s36:{1:eq('lifeRaft')},s40:{1:inScope},s42:{3:inScope},
    s44:{2:inScope,3:any(length('lt',8),eq('wheelhouse','no')),4:eq('radioArea','A2')},
    s48:{1:eq('radioDevice','vhf'),2:eq('radioDevice','manual'),3:eq('radioDevice','float'),4:eq('radioDevice','satellite')},
    s49:{1:inScope,2:eq('emergencyPower'),3:eq('emergencyPower','no')},
    s51:{1:inScope,2:eq('emergencyRadioBattery'),5:any(eq('radioDevice','manual'),eq('radioDevice','float'))},
    s57:{1:inScope,3:farFromPort},s59:{1:inScope},s60:{1:inScope,2:eq('forepeakTank')},s63:{1:inScope,2:eq('deckGearWheelhouse')},
    s71:{1:eq('winchTow')},s72:{1:eq('winchAnchor')},
    s73:{4:eq('winchTow'),5:eq('winchAnchor')},s75:{1:any(eq('winchTow'),eq('winchAnchor'))},
    s83:{1:eq('wheelhouse'),2:limit('heelingArmM','gt',0.10)},s86:{1:inScope,6:liquid,7:eq('antiRollTanks')},s90:{1:anchors},
    s93:{1:inScope,8:towing},s94:{1:inScope,3:eq('permanentLiquidBallast')},s95:{3:farFromPort},
    s98:{1:towing},s99:{1:lift,2:anchors,6:lift,7:anchors},
    s104:{6:farFromPort},s105:{4:farFromPort},s107:{2:farFromPort},
    s101:{1:inScope,2:inScope},s103:{1:inScope,2:inScope},s110:{1:inScope,3:atLeast15},s111:{1:eq('electricalAuxiliaries')},
    s112:{3:eq('emergencyBattery'),4:eq('emergencyGenerator')},s114:{1:eq('emergencyGenerator')},s116:{1:inScope},
    s115:{3:atLeast15},s119:{4:all(under15,composite)},s121:{2:all(eq('engineRoomA'),composite),5:under15},
    s125:stairs,s126:{1:inScope},s127:{2:eq('engineRoomA')},s131:{2:inScope},s132:{3:limit('fireStoreArea','lt',4)},
    s133:{1:inScope,3:any(eq('engineRoomA'),eq('dangerousCargoHold'))},s134:{4:limit('firePumpsInstalled','gt',1)},
    s136:{1:eq('firePump')},s137:{1:inScope},s145:{2:inScope},s150:{1:inScope},s151:{1:any(towing,anchors)}
  },
  'no-cargo-2014':{
    s11:{1:inScope,3:under15},s13:{4:eq('outsideProtected')},s22:{1:inScope},s26:{1:inScope,2:inScope},s30:{5:eq('wellFreeFlow'),7:liquid,8:eq('antiRollTanks')},
    s31:{3:anchors},s34:{1:inScope},s35:{1:inScope,3:eq('permanentLiquidBallast')},s38:{1:towing},s42:{1:atLeast15,2:under15},
    s48:{2:atLeast15},s49:{1:eq('emergencyGenerator')},s52:{4:all(under15,composite)},s54:{5:under15},
    s58:stairs,s59:{1:inScope},s64:{2:inScope},s65:{3:limit('fireStoreArea','lt',4)},s66:{1:inScope},s67:{4:limit('firePumpsInstalled','gt',1)},s69:{1:eq('firePump')},s70:{1:inScope}
  },
  'no-pax-2020':{
    s2:{2:inScope},s6:{1:inScope,2:limit('flag','neq','NO'),3:inScope},
    s8:{1:inScope,2:eq('weatherCover','no'),3:any(eq('svalbardFjord','b'),eq('svalbardFjord','c')),4:inScope},
    s9:{1:inScope,2:inScope,3:all(eq('outdoorSteering'),eq('sailOrProtected','no'))},
    s10:{1:inScope,2:inScope,3:eq('svalbardWaters')},
    s12:{1:eq('riverLake','no'),2:all(eq('riverLake','no'),eq('svalbardWaters'),eq('outsideRadioA1')),3:eq('riverLake','no'),4:all(eq('lifeRaft'),eq('riverLake','no')),5:eq('riverLake','no'),6:eq('riverLake','no'),7:eq('riverLake')},
    s13:{1:inScope,2:inScope,3:any(eq('superstructure','no'),eq('epirbReleaseDepth','no'))},
    s15:{1:inScope,2:all(eq('otherWeatherWarnings','no'),any(eq('tradingArea','small'),eq('tradingArea','greater'),eq('svalbardWaters')))},
    s16:{3:eq('childrenAboard'),6:inScope},s17:{1:eq('lifeRaft'),2:inScope,3:eq('vesselUnderway'),4:inScope}
  }
};

function cite(rule,source){
  if(rule.all)return {all:rule.all.map(r=>cite(r,source))};
  if(rule.any)return {any:rule.any.map(r=>cite(r,source))};
  return {...rule,source};
}

export function mapParagraphs(section,version,instrument){
  const edition=version.id==='no-pax-consolidated-2026'?'no-pax-2020':version.id;
  const rules=sources[edition]?.[section.id];
  if(!rules)return section;
  const body=section.text.split('\n[Endringsnote]')[0];
  const parts=[...body.matchAll(/^\s*\((\d+)\)\s+([\s\S]*?)(?=^\s*\(\d+\)\s+|(?![\s\S]))/gm)];
  const existing=section.cases||[],branches=[];
  for(const [number,rule] of Object.entries(rules)){
    const reference=section.number+'('+number+')';
    if(existing.some(item=>item.reference===reference))continue;
    const part=parts.find(match=>match[1]===number);
    if(!part)throw new Error('Missing printed paragraph '+version.id+' '+reference);
    const withinScope=rule===inScope;
    branches.push({reference,when:withinScope?section.criteria:cite(rule,instrument.id+' '+reference),withinScope,
      outcome:part[2].replace(/\s+/g,' ').trim(),language:'no'});
  }
  return {...section,cases:[...existing,...branches],screenCases:true};
}
