import {esc,isoDay} from './model.js';

const keyLabels={
  flag:'Flag state',shipType:'Ship type',lengthOverall:'Length overall',lengthL:'Regulatory length (L)',grossTonnage:'Gross tonnage',
  deadweightTonnes:'Deadweight',buildDate:'Year or date built',lastSurveyDate:'Last qualifying survey',
  approvedTraining:'Approved recreational competency training',onlyPassenger2020:'Used exclusively under the 2020 passenger rules',
  norwegianWaters:'Operating in the Norwegian waters defined in § 1',passengers:'Passengers carried',colregWaters:'Operating waters for collision rules'
};
const units={lengthOverall:'m',lengthL:'m',grossTonnage:'GT',deadweightTonnes:'t DWT'};
const topics=[
  ['Dimensions and construction',/^(length|grossTonnage|deadweight|build|contract|keel|delivery|hasBuild|wheelhouse|hull|closedShip|moulded|lightweight|longSuperstructure|superstructure|movingHull|construction|repairBeyond|stairDecks)/],
  ['Certification and surveys',/([cC]ertificate|[sS]urvey|approvedTraining|onlyPassenger|holdsVesselInstruction|flaggingIn)/],
  ['Waters and voyages',/^(voyage|longRegularVoyages|tradingArea|norwegianWaters|mainlandTerritorial|svalbard|riverLake|foreignTrade|distanceToPort|iceWaters|icePatrol|icingRisk|cautiousWaters|outsideProtected|vesselUnderway)/],
  ['Towing and deck equipment',/^(tow|winch|anchorHandling|deckGear|deckCrane|lineRestraint|liftingGear|haulingGear|fishingGear)/],
  ['Cargo and stability',/^(cargo|heelingArm|liquidCargo|permanentLiquid|antiRoll|existingStability|well|partlyFilledWell|tankerService)/],
  ['Navigation and radio',/^(radio|outsideRadio|integratedBridge|outdoorSteering|parallelSteering|emergencySteering|pilot|otherWeather|epirb|watchAlarm|standardCompass|reserveCompass|emergencyRadio)/],
  ['People and life-saving equipment',/^(passengers|childrenAboard|personsOnBoard|crewAtWork|schoolSafety|clubMember|ambulanceSchool|fishingTraining|lifeRaft|raftBothSides|raftBoarding|flotationWorn|weatherCover|enclosedSpace)/],
  ['Machinery and fire safety',/^(emergency|engineRoom|machinery|fire|galley|maxPropulsion|dangerousCargo)/],
  ['Collision regulations',/^colreg/],['Maritime labour',/^mlc/],['Safety of life at sea',/^solas/],
  ['Oil tankers',/^eu/],['United Kingdom',/^uk/],['United States',/^us/],['New Zealand',/^nz/],['Canada · polar navigation',/^ca[A-Z]/],
  ['Marine pollution',/^(marpol|noEnvironment|noHeritage|noVoluntary)/],['Training and certification',/^stcw/],['Load Lines',/^ll[A-Z]/]
];
export function topic(field){return topics.find(([,pattern])=>pattern.test(field.key))?.[0]||'Operations and equipment';}

export function today() {
  const date=new Date();
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

export function fieldName(field) {return keyLabels[field.key]||field.label;}

export function boatControl(field,value,{prefix='filter'}={}) {
  if(!field)return '';
  const key=field.key,id=prefix+'-'+key,name=esc(key),label=fieldName(field);
  let input;
  if(field.options?.length){
    const options=field.options.map(o=>({value:o.value??o,label:o.label??o}));
    const prompt='Any';
    input='<select id="'+esc(id)+'" name="'+name+'"><option value="">'+prompt+'</option>'+
      options.map(o=>'<option value="'+esc(o.value)+'" '+(String(value)===String(o.value)?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>';
  }else{
    const numeric=field.type==='number',date=field.type==='date',unit=units[key]||field.unit;
    input='<div class="owner-input"><input id="'+esc(id)+'" name="'+name+'" type="'+(numeric?'number':'text')+'" '+
      (numeric?'step="any" min="0" inputmode="decimal" ':'')+(date?'placeholder="e.g. 1998" title="Enter a year or a full date as YYYY-MM-DD" maxlength="10" ':'')+
      'value="'+esc(value??'')+'" '+(unit?'aria-describedby="'+esc(id)+'-unit"':'')+'>'+(unit?'<span id="'+esc(id)+'-unit">'+esc(unit)+'</span>':'')+'</div>';
  }
  return '<div class="owner-field"><label for="'+esc(id)+'">'+esc(label)+'</label>'+input+'</div>';
}

export function readBoatValue(input,field) {
  const value=input.value.trim();
  if(value&&field.type==='date'&&!/^\d{4}$/.test(value)&&!isoDay(value)){
    input.setCustomValidity('Enter a year or a valid date in YYYY-MM-DD format.');
    input.reportValidity();return {valid:false};
  }
  return {valid:true,value:value===''?undefined:field.type==='number'?Number(value):value};
}
