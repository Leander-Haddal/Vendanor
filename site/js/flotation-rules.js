const all=(...rules)=>({all:rules});
const any=(...rules)=>({any:rules});
const except=rule=>({not:rule});
const fact=(field,op,value,source)=>({field,op,value,source});

function withCases(section,scope,items){
  const cases=items.map(([reference,condition,when,outcome])=>({reference,condition,when,outcome}));
  return {...section,criteria:all(scope,any(...cases.map(c=>c.when))),screeningLevel:'section',cases};
}

export function usFlotation(section){
  const source='33 CFR §§ 175.15, 175.17, 175.19 and 175.25';
  const eq=(key,value='yes')=>fact(key,'eq',value,source);
  const long=fact('usPfdLengthFt','gte',16,source);
  const canoe=eq('usPfdDesign','canoe'),racing=eq('usPfdDesign','racing'),sailboard=eq('usPfdDesign','sailboard');
  const competitors=all(eq('usForeignRace'),eq('usTeamFlotation'));
  const allCarriage=any(racing,sailboard,competitors);
  const wearable=any(eq('usPfdExemption','no'),except(allCarriage));
  const throwable=all(long,eq('usPfdExemption','no'));
  if(section.id==='exemptions'){
    return withCases(section,section.criteria,[
      ['§ 175.17(a)','Canoe or kayak of at least 16 feet',all(canoe,long),'The additional throwable flotation device may be omitted.'],
      ['§ 175.17(b)','Racing shell, scull, canoe or kayak',racing,'The flotation-device carriage requirements in § 175.15 are waived.'],
      ['§ 175.17(c)','Sailboard',sailboard,'The flotation-device carriage requirements in § 175.15 are waived.'],
      ['§ 175.17(d)','Qualifying foreign competitors with sponsor-country devices',competitors,'The qualifying U.S. vessel is exempt from § 175.15 carriage requirements.']
    ]);
  }
  if(section.id==='stowage')return withCases(section,section.criteria,[
    ['§ 175.19(a)','Wearable flotation devices required',wearable,'Keep each required wearable device readily accessible.'],
    ['§ 175.19(b)','Additional throwable device required',throwable,'Keep the required throwable device immediately available.']
  ]);
  if(section.id==='devices'){
    const child=all(eq('usUnderway'),eq('usChildAboard'),eq('usChildStateLaw','no'));
    return withCases(section,section.criteria,[
      ['§ 175.15(a)','Wearable-device carriage applies',wearable,'Carry one wearable device per person and follow its approval label and any manual it references.'],
      ['§ 175.15(b)','At least 16 feet and subject to throwable-device carriage',throwable,'Carry an additional throwable device.'],
      ['§ 175.15(c)(1)','Under 13, under way and outside an enclosed cabin',all(child,eq('usChildEnclosed','no')),'The child must wear an appropriate Coast Guard-approved flotation device.'],
      ['§ 175.15(c)(2)','Under 13 and below decks or in an enclosed cabin',all(child,eq('usChildEnclosed')),'Being below decks or in an enclosed cabin satisfies the federal alternative.'],
      ['§ 175.25','An applicable state child-wear statute governs these waters',eq('usChildStateLaw'),'Apply the age and wearing requirements in the applicable state statute.']
    ]);
  }
  if(['application','subpart-scope'].includes(section.id))return {...section,screeningLevel:'section'};
  return section;
}

export function nzFlotation(section,version){
  if(version.id!=='nz-rule91-2026')return section;
  const source='Maritime Rules Part 91, rules 91.2 to 91.4';
  const eq=(key,value='yes')=>fact(key,'eq',value,source);
  const activity=value=>eq('nzFlotationActivity',value);
  const recreational=eq('nzRecCraft'),small=fact('nzLifejacketLengthM','lte',6,source);
  const personal=[
    ['91.4(2)(a)','Surfboard or comparable unpowered craft',activity('surf')],
    ['91.4(2)(aa)','SUP surfer with suitable leash',all(activity('sup'),eq('nzBoardLeash'))],
    ['91.4(2)(b)','Sailboarder or windsurfer in a wetsuit',all(activity('sailboard'),eq('nzWetsuit'))],
    ['91.4(2)(c)','Diver in a full wetsuit on a qualifying nearshore boat',all(activity('diving'),small,eq('nzDiveNearShore'),eq('nzFullWetsuit'))],
    ['91.4(2)(d)','Sport under an approved safety system',eq('nzSupervisedSport')],
    ['91.4(2)(e)','Visiting team member with home-approved lifejacket',eq('nzVisitingTeam')],
    ['91.4(2)(f)','Commercial raft',activity('raft')]
  ];
  const exempt=any(...personal.map(item=>item[2]),eq('nzCouncilExemption'));
  const carriageApplies=any(eq('nzLifejacketException','no'),except(any(exempt,eq('nzSupportedEvent'))));
  const carriage=all(recreational,carriageApplies);
  const wear=all(recreational,small,eq('nzUnderway'),eq('nzLifejacketException','no'));
  if(section.id==='carriage')return {...section,criteria:all(section.criteria,carriageApplies),screeningLevel:'section'};
  if(section.id==='application')return {...section,screeningLevel:'section'};
  if(section.id!=='lifejackets')return section;
  const towing=eq('nzTowingPerson'),towException=any(eq('nzTowSport'),fact('nzTowSpeed','lt',5,source));
  return withCases(section,section.criteria,[
    ['91.4(1)','Recreational craft subject to carriage',carriage,'Carry an accessible, appropriately sized lifejacket for each person.'],
    ['91.4(1A)','Under way, six metres or less, wearing rule applies',wear,'Each person must wear an appropriately sized lifejacket.'],
    ['91.4(1B)','Recreational swimming from a small craft under way',all(recreational,small,eq('nzUnderway'),eq('nzSwimming')),'The small-craft wearing rule allows this person to swim without wearing the lifejacket.'],
    ...personal.map(item=>[...item,'Paragraphs (1), (1A) and (6) give an exception for this person or craft.']),
    ['91.4(4)','Supported sporting, training or ceremonial event',eq('nzSupportedEvent'),'The carriage and small-craft wearing exception is subject to the local exemption provision. Paragraph (6) still covers danger.'],
    ['91.4(5)','Council exemption in writing for this activity',eq('nzCouncilExemption'),'Read the period and terms of the written exemption from paragraphs (1), (1A) and (6).'],
    ['91.4(6)','Danger to people on a recreational craft',all(recreational,eq('nzDanger'),except(exempt)),'Each person must wear a properly secured, appropriately sized lifejacket.'],
    ['91.4(7)','Person towed, outside the exceptions',all(towing,except(towException)),'The person being towed must wear a properly secured, appropriately sized lifejacket.'],
    ['91.4(8)','Qualifying sports tow or speed below five knots',all(towing,towException),'The towing exception in paragraph (8) applies.'],
    ['91.4(9)','Buoyancy aid for use on a paddle craft',eq('nzPaddleCraft'),'The alternative aid must meet the prototype-test, quality-system and permanent-marking conditions in this paragraph.']
  ]);
}
