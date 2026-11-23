import {provisionFields} from './provision-fields.js';
import {mapParagraphs} from './provision-paragraphs.js';
import {usFlotation,nzFlotation} from './flotation-rules.js';

const all=(...rules)=>rules.length===1?rules[0]:{all:rules};
const any=(...rules)=>rules.length===1?rules[0]:{any:rules};
const leaf=(field,op,value,source)=>({field,op,value,source});
const branch=(reference,when,outcome)=>({reference,when,outcome});

// Conditions describe when to read a requirement. Its prescribed equipment, dimensions
// and actions belong to the outcome and must never exclude a ship that fails to comply.
function norwegian(section,version,original){
  const id=section.id,edition=version.id,ref=original.instrumentId+' '+section.number;
  const test=(field,op,value)=>leaf(field,op,value,ref);
  const eq=(key,value='yes')=>test(key,'eq',value);
  const choice=(key,...options)=>any(...options.map(option=>eq(key,option)));
  const when=(rule,level='partial')=>({...section,criteria:all(section.criteria,rule),screeningLevel:level});
  const cases=(rule,items,level)=>({...when(rule,level),cases:items,screenCases:true});
  const context=(scope,note)=>({...section,criteria:scope,screeningLevel:'context',caveat:note||section.caveat});
  const originalRule=key=>original.sections.find(s=>s.id===key).criteria;
  const boundary=(limit,op)=>test('lengthOverall',op,limit);
  const tow=eq('tows'),anchor=eq('anchorHandling'),winches=any(eq('winchTow'),eq('winchAnchor'));
  const closed=eq('closedShip'),open=eq('closedShip','no');
  const composite=choice('hullMaterial','composite','aluminium');
  const smallTrade=choice('tradingArea','1','2','3','4','small');
  const area4plus=choice('tradingArea','4','small','greater');
  const single=eq('crewAtWork',1);
  const before15=boundary(15,'lt'),from15=boundary(15,'gte');
  const instruction=originalRule('s1');
  const distant=all(eq('foreignTrade'),test('distanceToPort','gt',30));
  if((edition==='no-cargo-2025' && id==='s58')||(edition==='no-cargo-2014' && id==='s21')){
    return cases(closed,[
      branch(section.number+'(1)',before15,'At least two watertight bulkheads.'),
      branch(section.number+'(2)',from15,'At least three watertight bulkheads, including a collision bulkhead at least 0.05 L aft of the forward perpendicular.'),
      branch(section.number+'(3)',eq('longSuperstructure'),'Extend the collision bulkhead weathertight to the first deck above the freeboard deck. Read the requirements for steps and openings in the original.')
    ]);
  }
  if(edition==='no-cargo-2025'){
    const number=Number(id.slice(1));
    if(['s8','s38','s39','s43','s46','s47','s53','s82','s144'].includes(id))return {...section,screeningLevel:'section'};
    if(id==='s12'){
      const book=boundary(8,'gte'),signals=all(test('grossTonnage','gte',300),eq('foreignTrade'),eq('radioInstalled'));
      return cases(any(book,signals),[branch('§ 12(1)',book,'Carry an updated paper copy of IAMSAR Manual Volume III.'),
        branch('§ 12(2)',signals,'Carry an updated paper copy of the International Code of Signals.')],'section');
    }
    if(id==='s20'){
      const below150=test('grossTonnage','lt',150),middle=all(test('grossTonnage','gte',150),test('grossTonnage','lt',300));
      const above300=test('grossTonnage','gte',300);
      return {...section,screeningLevel:'section',cases:[
        branch('§ 20(1)',all(below150,boundary(12,'lt')),'The under-12-metre column lists GNSS, a class B magnetic compass and a radar reflector. Paragraphs 4 and 8 give alternatives.'),
        branch('§ 20(1)',all(below150,boundary(12,'gte')),'The next column lists GNSS, a class B magnetic compass, class A AIS and a bridge watch alarm.'),
        branch('§ 20(1)',middle,'The 150-to-under-300 GT column lists GNSS, a class A magnetic compass, a spare compass, class A AIS and a bridge watch alarm. Read paragraphs 5–7 for alternatives.'),
        branch('§ 20(1)',above300,'Carry GNSS, class A and spare magnetic compasses, class A AIS, a bridge watch alarm, a transmitting heading device, 9 GHz radar and an echo sounder.'),
        branch('§ 20(1)',all(test('grossTonnage','gte',150),eq('foreignTrade')),'In foreign trade carry a bearing device and daylight signalling lamp.'),
        branch('§ 20(1)',all(above300,eq('foreignTrade')),'In foreign trade also carry a through-water speed log.')
      ]};
    }
    if(id==='s37')return cases(single,[branch('§ 37(1)',eq('outdoorSteering'),'Fit an emergency stop for the propulsion machinery.'),
      branch('§ 37(2)',single,'Fit a permanently mounted rescue ladder meeting the specifications in paragraph 2.')],'section');
    if(id==='s33')return {...section,cases:[
      branch('§ 33(1)',boundary(8,'lt'),'Read the under-8-metre equipment column. It specifies lifejackets with lights for everyone, a lifebuoy with a line and three hand flares.'),
      branch('§ 33(1)',all(boundary(8,'gte'),before15),'One liferaft for all aboard, a lit lifejacket and thermal immersion suit per person, one lifebuoy with a line, one with a light, three hand flares and three parachute flares.'),
      branch('§ 33(1)',from15,'Two liferafts each for all aboard, a lit lifejacket and thermal immersion suit per person, one lifebuoy with a line, two with lights, three hand flares and three parachute flares.'),
      branch('§ 33(2)',all(from15,choice('tradingArea','1','2'),eq('tankerService','no'),eq('raftBothSides')),'One liferaft may be carried if it can be launched on either side.'),
      branch('§ 33(4)',all(boundary(12,'gte'),before15,eq('foreignTrade','no'),test('personsOnBoard','lte',3)),'The two-raft alternative may be used if both rafts meet the equipment and installation requirements in paragraph 4.')
    ]};
    if(id==='s41'){
      const drill=boundary(12,'gte'),rescue=eq('enclosedSpaceDuties');
      return cases(any(drill,rescue),[branch('§ 41(1)–(3)',drill,'Hold monthly evacuation and fire drills using the activities specified in the source.'),
        branch('§ 41(4)',rescue,'Crew assigned enclosed-space entry or rescue duties must participate in this drill at least every three months.')],'section');
    }
    if(id==='s57')return {...section,cases:[branch('§ 57(3)',distant,'Anchor and mooring equipment must meet the rules of a recognised classification society.')]};
    if(id==='s65')return cases(tow,[branch('§ 65(1)–(3)',tow,'Provide a towing winch or hook and a towing connection meeting the source requirements.'),
      branch('§ 65(4)',eq('outsideProtected'),'Keep a complete spare towing connection readily accessible.'),
      branch('§ 65(5)',distant,'Fit a towing winch.')]);
    if(id==='s134'||id==='s136'){
      const installation=all(closed,eq('wheelhouseOnly','no'));
      return id==='s136'?when(eq('firePump')):cases(any(installation,eq('firePump')),[
        branch('§ 134(1)',installation,'Provide at least one fire pump.'),
        branch('§ 134(2)–(4)',eq('firePump'),'Check pump controls, capacity and permitted alternatives in the original.')
      ]);
    }
    if([69,70,73,74,75,76].includes(number))return when(winches,number===74?'section':'partial');
    if([28,29,30,31].includes(number)){
      const pilot=eq('pilotage');
      return when(number===29?all(pilot,test('pilotBoardingHeight','gte',1.5),test('pilotBoardingHeight','lte',9)):pilot);
    }
    if([104,105,106,107].includes(number))return when(leaf('lightweightClass','eq','no','2025/2652 § 100'));
    const conditions={
      s3:originalRule('s53'),s6:eq('fishingTraining'),s7:eq('fishingGear'),s10:eq('flaggingIn'),
      s14:eq('icePatrol'),s16:all(eq('parallelSteeringPower'),eq('cautiousWaters')),s23:all(eq('watchAlarm'),eq('vesselUnderway')),
      s25:all(test('grossTonnage','gte',300),eq('foreignTrade'),eq('outsideRadioA1')),s26:eq('reserveCompass'),s45:eq('vesselUnderway'),
      s27:eq('integratedBridge'),s32:boundary(12,'gte'),s36:eq('lifeRaft'),s55:eq('iceWaters'),s56:eq('mouldedHull'),s59:closed,s60:all(closed,from15),
      s61:eq('movingHullParts'),s63:eq('deckGear'),s64:eq('deckGear'),s66:anchor,s67:eq('lineRestraintHazard'),
      s68:any(tow,anchor,eq('deckGearHazard')),s71:eq('winchTow'),s72:eq('winchAnchor'),s78:eq('haulingGear'),
      s85:any(tow,anchor),s87:eq('wellFreeFlow'),s88:tow,s89:test('heelingArmM','gt',0.10),s90:anchor,s91:eq('icingRisk'),
      s95:closed,s96:all(eq('partlyFilledWell'),eq('wellSheltered'),eq('wellAtSea')),s97:open,s98:tow,
      s99:any(eq('liftingGear'),anchor),s100:eq('lightweightClass'),s101:closed,s102:closed,s103:open,
      s114:eq('emergencyGenerator'),s122:composite,s140:eq('galleyPantry'),s141:any(eq('engineRoomA'),eq('dangerousCargoHold')),
      s148:choice('constructionWork','new','conversion','alteration','repair'),
      s143:all(eq('engineRoomA'),test('machineryVolume','lte',10)),s151:any(tow,anchor),s156:originalRule('s53')
    };
    if(conditions[id])return when(conditions[id],['s6','s10','s14','s16','s23','s25','s26','s27','s32','s45','s64','s66','s67','s85','s97','s103','s122','s140','s148'].includes(id)?'section':'partial');
    if(id==='s157')return context(instruction,'Commencement and repeal date for the Norwegian small cargo ship regulations.');
    if(id==='s158')return context(any(eq('flag','NO'),all(original.passengerScope,eq('offshoreTransfer'))),
      'Each amendment uses the scope of its target regulation. Paragraph 5 also concerns passenger operations in Norwegian waters.');
  }
  if(edition==='no-cargo-2014'){
    if(['s26','s45','s77'].includes(id))return {...section,screeningLevel:'section'};
    if(id==='s1-2-b')return when(all(...instruction.all.filter(rule=>rule.field!=='onlyPassenger2009')),'section');
    const conditions={s9:eq('iceWaters'),s10:eq('mouldedHull'),s13:all(tow,smallTrade),
      s14:all(tow,choice('tradingArea','1','2'),test('towObjectLength','lt',15),eq('towObjectLoaded','no')),
      s15:all(anchor,smallTrade),s16:all(any(tow,anchor),smallTrade),s17:smallTrade,s18:smallTrade,
      s20:all(any(tow,anchor),eq('tradingArea','greater')),s22:closed,s23:closed,s24:eq('movingHullParts'),s29:any(tow,anchor),
      s31:any(tow,eq('deckCraneUse'),anchor),s32:eq('icingRisk'),s36:closed,s37:open,s38:tow,s39:any(eq('deckCraneUse'),anchor),
      s40:all(eq('partlyFilledWell'),eq('calmWellOperations'),eq('wellAtSea')),s41:closed,s42:closed,s43:open,s46:eq('electricalAuxiliaries'),s49:eq('emergencyGenerator'),
      s55:composite,s67:any(all(closed,eq('wheelhouseOnly','no')),eq('firePump')),s69:eq('firePump'),
      s73:eq('galleyPantry'),s76:test('machineryVolume','lte',10),s84:originalRule('s82'),s85:any(tow,anchor),
      s81:choice('constructionWork','new','conversion','repair'),s87:eq('repairBeyondMaintenance'),s88:originalRule('s3'),s89:originalRule('s3')};
    if(conditions[id])return when(conditions[id],['s20','s29','s37','s40','s41','s43','s46','s55','s73','s81','s87'].includes(id)?'section':'partial');
    if(id==='s91')return context(eq('flag','NO'),'Commencement, repeal and amendments to other Norwegian instruments. Read each target provision for its application.');
  }
  if(edition==='no-pax-2020'||edition==='no-pax-consolidated-2026'){
    const svalbard=eq('svalbardWaters'),summer=all(test('voyageMonth','gte','04'),test('voyageMonth','lte','09'));
    if(['s3','s4','s5','s6','s9','s10','s11','s15','s17'].includes(id))return {...section,screeningLevel:'section'};
    if(id==='s2')return {...section,criteria:originalRule('s2-1'),screeningLevel:'section'};
    if(id==='s7'){
      const winterLimit=all(area4plus,{not:summer});
      const refuge=all(test('voyageSpeed','gt',20),any(eq('tradingArea','3'),all(area4plus,summer)));
      return cases(all(eq('mainlandTerritorialWaters'),eq('weatherCover','no'),any(winterLimit,refuge)),[
        branch('§ 7(a)',winterLimit,'Maximum speed is 20 knots in trading area 4 and above from October through March.'),
        branch('§ 7(b)',refuge,'Keep within five nautical miles of a refuge or an accompanying vessel with room for everyone aboard both vessels.')
      ],'section');
    }
    if(id==='s8')return when(svalbard,'section');
    if(['s13','s14'].includes(id))return when(any(area4plus,svalbard),'section');
    if(id==='s16'){
      const openSvalbard=all(eq('superstructure','no'),svalbard);
      const exception=any(eq('flotationWorn','suit'),all(eq('flotationWorn','vest'),choice('tradingArea','1','2'),summer),openSvalbard);
      return {...section,screeningLevel:'section',cases:[
        branch('§ 16(1)(a)–(c)',{not:exception},'Carry liferaft capacity and flotation equipment for everyone aboard, and a lifebuoy with a light.'),
        branch('§ 16(1)(d)–(f)',section.criteria,'Carry a throwing ring and line, three parachute flares, three hand flares and a means of recovering a person from the water.'),
        branch('§ 16(2)(a)',eq('flotationWorn','suit'),'The liferaft, flotation equipment and lifebuoy in paragraph 1(a)–(c) may be omitted.'),
        branch('§ 16(2)(b)',all(eq('flotationWorn','vest'),choice('tradingArea','1','2'),summer),'The same exception applies in trading area 2 or below from April through September.'),
        branch('§ 16(4)',all(boundary(8,'lt'),eq('vesselUnderway'),eq('passengersOutdoors')),'People in open areas must wear the flotation equipment specified in paragraph 1(b).'),
        branch('§ 16(5)',openSvalbard,'Everyone must wear a full-body flotation suit providing 150 N, alone or in combination. The vessel may omit the items in paragraph 1(a)–(c).')
      ].map(b=>({...b,withinScope:b.when===section.criteria}))};
    }
    if(id==='s18')return context(section.criteria,'An exemption requires a written application, special reasons and a safety assessment by the Norwegian Maritime Authority.');
    if(id==='s9-3')return when(all(eq('outdoorSteering'),eq('sailOrProtected','no')),'section');
    if(id==='s19')return context(instruction,'Commencement of the 2020 passenger regulations and repeal of the 2009 instrument.');
  }
  if(section.criteria)return section;
  if(edition==='no-cargo-amend-2015'&&id==='s89a'){
    const rule=all(eq('flag','NO'),eq('shipType','cargo'),tow,before15,eq('holdsVesselInstruction','no'),test('towObjectGt','gte',50),eq('outsideProtected'));
    return context(rule,'This transitional permit provision also sets the application procedure and conditions for a permit.');
  }
  if(edition==='no-cargo-amend-2015'&&id==='s89-2')return context(originalRule('s3'),'Transitional wording. Read the dates in § 89(1) with this amendment.');
  if(edition==='no-cargo-amend-2020'){
    return context(all(...instruction.all.filter(r=>r.field!=='onlyPassenger2009'),eq('onlyPassenger2020')),'The amendment excludes ships operated exclusively under the specified 2020 passenger rules.');
  }
  if(edition==='no-pax-amend-2023'){
    if(id==='s2-1')return context(originalRule('s2-1'),'These operations are excepted from §§ 3–18. Read the amended table in the original.');
    if(id==='s16-6')return context(originalRule('s16'),'The amendment changes the standards for flotation equipment and full-body flotation suits.');
  }
  if(edition==='no-pax-amend-2025')return context(all(originalRule('s9-3'),eq('outdoorSteering'),eq('sailOrProtected','no')),'The outdoor-steering requirement excludes sailing vessels and protected vessels.');
  if(edition==='no-pax-amend-2026')return context(all(instruction,eq('offshoreTransfer')),'This notice adds an exclusion for offshore renewable-energy personnel transfers.');
  return context(instruction,section.caveat);
}

function international(section,version,instrument){
  const id=section.id,ref=section.number,scope=version.sections.find(s=>s.id===instrument.scopeSection||s.id==='scope')?.criteria;
  const test=(key,op,value)=>leaf(key,op,value,ref);
  const eq=(key,value='yes')=>test(key,'eq',value);
  const context=(criteria,caveat)=>({...section,criteria,screeningLevel:'context',caveat:caveat||section.caveat});
  if(instrument.id.startsWith('IMO-SOLAS')){
    const flag=scope.all.find(r=>r.field==='flag');
    if(id==='flag'||id==='voyage')return context(flag);
    if(id==='passengers')return {...context(flag),cases:[
      branch('Regulation I/2(f)',test('solasPassengers','gt',12),'Classified as a passenger ship for this chapter.'),
      branch('Regulation I/2(g)',test('solasPassengers','lte',12),'Classified as a cargo ship for this chapter.')
    ]};
    if(id==='exceptions'){
      const listed=test('solasException','neq','none'),smallCargo=all(test('solasPassengers','lte',12),test('solasTonnage','lt',500)),lakes=eq('solasLakes');
      return {...context(all(flag,any(listed,smallCargo,lakes))),cases:[
        branch('Regulation I/3(a)',listed,'The listed ship category is excepted unless expressly provided otherwise.'),
        branch('Regulation I/3(a)(ii)',smallCargo,'The cargo-ship exception below 500 applies unless expressly provided otherwise.'),
        branch('Regulation I/3(b)',lakes,'The specified Great Lakes and St Lawrence reach is excepted, subject to express provisions in Chapter V.')
      ]};
    }
    if(id==='single-voyage')return {...section,cases:[
      branch('Regulation I/4(a)',eq('solasExemptionGranted'),'Read the Administration’s decision for the voyage and the safety requirements it sets.'),
      branch('Regulation I/4(a)',eq('solasExemptionGranted','no'),'A single voyage alone does not grant an exemption.')
    ]};
  }
  if(instrument.id.startsWith('ILO-MLC')){
    const flag=scope.all.find(r=>r.field==='flag');
    if(id==='doubt')return context(all(flag,eq('mlcDoubt')),'Under Article II(5), the competent authority settles doubts after consultation with the shipowners’ and seafarers’ organisations concerned.');
    if(id==='small-ships')return {...section,cases:[
      branch('Article II(6)',all(eq('mlcDetermination'),eq('mlcAlternative')),'Read the determination. Only the specified details of the Code may be dealt with by the alternative measure.'),
      branch('Article II(6)',eq('mlcDetermination','no'),'A ship below 200 GT on a domestic voyage receives no automatic exemption.')
    ]};
    if(id==='certificate-scope')return {...section,cases:[
      branch('Regulation 5.1.3(1)(a)',eq('mlcInternationalVoyage'),'Compulsory certification applies on the international-voyage route at 500 GT or above.'),
      branch('Regulation 5.1.3(1)(b)',eq('mlcOperatingFromForeignPort'),'Compulsory certification applies at 500 GT or above when operating from, or between, ports in another country.')
    ]};
  }
  if(instrument.id.startsWith('IMO-COLREG')){
    if(id==='r22'){
      const rules=version.sections.filter(s=>/^r22[a-d]$/.test(s.id)).map(s=>s.criteria);
      return context(any(...rules),'Full source for Rule 22. Each lettered passage gives the ranges for its vessel or tow.');
    }
    if(id==='r22b')return {...section,cases:[
      branch('Rule 22(b)',test('lengthOverall','lt',20),'Masthead light 3 nautical miles. Each other light listed in this paragraph 2 nautical miles.'),
      branch('Rule 22(b)',test('lengthOverall','gte',20),'Masthead light 5 nautical miles. Each other light listed in this paragraph 2 nautical miles.')
    ]};
  }
  if(instrument.id.startsWith('eu-tanker')){
    if(id==='definitions'||id==='amendments')return context(scope);
    if(id==='categories'){
      const oils=any(all(eq('euOilCargo','listed'),test('deadweightTonnes','gte',20000)),all(eq('euOilCargo','other'),test('deadweightTonnes','gte',30000)));
      const cat3=all(test('deadweightTonnes','gte',5000),{not:oils});
      const categories=[
        branch('Article 3(4)',all(oils,eq('euAnnexI','no')),'Category 1 oil tanker.'),
        branch('Article 3(5)',all(oils,eq('euAnnexI'),eq('euBallast')),'Category 2 oil tanker.'),
        branch('Article 3(6)',cat3,'Category 3 oil tanker.')
      ];
      return {...context(all(scope,any(...categories.map(item=>item.when)))),cases:categories};
    }
    if(id==='heavy-grade-definition'){
      const branches=[
        branch('Article 3(12)(a)',all(eq('euOilKind','crude'),test('euOilDensity','gt',900)),'Crude oil meets the heavy grade oil definition.'),
        branch('Article 3(12)(b)',all(eq('euOilKind','other'),any(test('euOilDensity','gt',900),test('euOilViscosity','gt',180))),'Other oil meets the heavy grade oil definition.'),
        branch('Article 3(12)(c)',eq('euOilKind','bitumen'),'Bitumen, tar and their emulsions meet the heavy grade oil definition.')
      ];
      const carriage=version.sections.find(s=>s.id==='heavy-grade-carriage').criteria;
      const definitionScope=all(...carriage.all.filter(rule=>rule.field!=='euHeavyGradeOil'));
      return {...context(all(definitionScope,any(...branches.map(b=>b.when)))),cases:branches};
    }
    if(id==='exceptional-entry')return context(all(scope,test('euPortActivity','neq','none'),any(eq('euRefuge'),eq('euRepair'))),'The competent authority may authorise an individual movement under Article 8, subject to national provisions.');
    if(id==='heavy-grade-carriage')return {...section,cases:[
      branch('Article 4(3)',eq('euDoubleHull','no'),'The flag, port, terminal and anchoring prohibitions apply subject to any exemption granted.'),
      branch('Article 4(3)',eq('euDoubleHull'),'The double-hull condition in this paragraph is met.'),
      branch('Article 4(4)',all(eq('euInlandOnly'),eq('euInlandCertified')),'An exemption from paragraph 3 may be granted for the certified inland operation.')
    ]};
    if(id==='scope')return {...section,screeningLevel:'section',criteria:version.id==='eu-1726-2003'?all(scope,any(test('deadweightTonnes','gte',5000),eq('euHeavyGradeOil'))):scope};
    if(id==='state-service')return {...section,criteria:all(section.criteria,...scope.all.filter(r=>r.field!=='euGovernmentService'))};
  }
  if(instrument.id==='us-cfr33-175'&&section.criteria)return usFlotation(section);
  if(instrument.id==='nz-navigation-part91'&&section.criteria)return nzFlotation(section,version);
  if(!section.criteria){
    const sourceRule=key=>version.sections.find(s=>s.id===key)?.criteria;
    if(instrument.id==='gb-lifesaving-2020')return context(sourceRule('application')||sourceRule('geographic-reach'));
    if(instrument.id==='us-cfr33-175')return context(sourceRule('application'));
    if(instrument.id==='nz-navigation-part91')return context(sourceRule('application')||eq('nzPart91Waters'));
  }
  return section;
}

// The original construction standard can continue to govern an older ship. A direction
// from the authority may cover only particular requirements. It can invite reading a
// provision, but cannot by itself confirm all the provisions of the newer standard.
function constructionScope(section,version,original){
  const current=version.id==='no-cargo-2025',previous=version.id==='no-cargo-2014';
  if(!current&&!previous)return section;
  const n=Number(section.id.slice(1));
  if(!Number.isInteger(n))return section;
  const source=current?'2025/2652 §§ 9 and 153':'2014/1853 §§ 3, 88 and 89';
  const fact=(f,op,v)=>leaf(f,op,v,source);
  const is=(f,v='yes')=>fact(f,'eq',v);
  let carried,fullyCarried;
  const paragraphConditions=new Map();
  if(current){
    if(![3,4,7].includes(n)&&(n<53||n>144))return section;
    if([66,76,139].includes(n))return section;
    const increased=is('tradingAreaIncreased');
    if(n===7)fullyCarried=fact('fishingGearInstallDate','gte','2026-01-01');
    const paragraph={57:3,65:5,95:3,104:6,105:4,107:2,108:6,115:2}[n];
    if(paragraph){carried=increased;paragraphConditions.set(section.number+'('+paragraph+')',increased);}
    if(n>=62&&n<=81){
      fullyCarried=fact('deckGearInstallDate','gte','2026-01-01');
      if(n===78)fullyCarried=any(fullyCarried,is('firstQualifyingControl'));
    }
    const due=is('firstQualifyingControl');
    if(n===104||n===108||n===109){
      const obligation=n===108?all(due,fact('lengthOverall','lt',15)):due;
      carried=carried?any(carried,obligation):obligation;
      const paragraphs=n===104?5:n===108?2:4;
      for(let p=1;p<=paragraphs;p++)paragraphConditions.set(section.number+'('+p+')',obligation);
    }
  }else{
    if(n<7||n>76||[11,13,14,15,16,17,18,19,20,41,42,72,73].includes(n))return section;
    if(n>=26&&n<=40)carried=any(is('existingStabilityApproved','no'),all(is('tows'),is('towStabilityApproved','no')),is('deckCraneUse'),is('anchorHandling'));
  }
  const transition=original.sections.find(s=>s.id===(current?'s9':'s3')).criteria;
  const newer={not:transition.all[1]};
  const confirmed=fullyCarried?any(newer,fullyCarried):newer;
  const ordinary=carried?any(confirmed,carried):confirmed;
  const order=is('constructionOrder');
  const cases=paragraphConditions.size&&section.cases?section.cases.map(entry=>{
    const carriedParagraph=paragraphConditions.get(entry.reference);
    const applies=carriedParagraph?any(confirmed,carriedParagraph):confirmed;
    return {...entry,displayWhen:entry.when,when:all(entry.when,any(applies,order)),confirmWhen:applies};
  }):section.cases;
  return {...section,cases,criteria:all(section.criteria,any(ordinary,order)),
    confirmWhen:confirmed,scopeNote:source+'. An older ship can have different requirements. Check the transitional paragraphs and the terms of any individual direction.'};
}

// Apply to published editions once when loaded. Private documents keep their own rules.
export function mapCatalogue(book){
  const editions=new Set(book.instruments.flatMap(i=>i.versions.map(v=>v.id)));
  const fields=[...book.fields,...provisionFields.filter(field=>editions.has(field.source.versionId))];
  const passengerScope=book.instruments.find(i=>i.id==='FOR-2020-01-14-63')?.versions[0].sections.find(s=>s.id==='s1')?.criteria;
  const instruments=book.instruments.map(instrument=>{
    const original={instrumentId:instrument.id,sections:instrument.versions[0].sections,passengerScope};
    const versions=instrument.versions.map(version=>{
      const sections=version.sections.map(section=>instrument.id.startsWith('FOR-')
        ?constructionScope(mapParagraphs(norwegian(section,version,original),version,instrument),version,original)
        :international(section,version,instrument));
      const derivedFields=[];
      const grade=sections.find(section=>section.id==='heavy-grade-definition');
      if(grade)derivedFields.push({field:'euHeavyGradeOil',when:any(...grade.cases.map(item=>item.when))});
      if(instrument.id==='us-cfr33-175'){
        const exemptions=sections.find(s=>s.id==='exemptions').cases;
        derivedFields.push({field:'usPfdExemption',when:any(...exemptions.map(c=>c.when)),positiveOverrides:true});
      }
      if(version.id==='nz-rule91-2026'){
        const cases=sections.find(s=>s.id==='lifejackets').cases;
        const exemptions=cases.filter(c=>/^91\.4\((?:1B|2|4|5)\)/.test(c.reference));
        derivedFields.push({field:'nzLifejacketException',when:any(...exemptions.map(c=>c.when)),positiveOverrides:true});
      }
      const scopeChange=['no-pax-amend-2023','no-pax-amend-2025'].includes(version.id)
        ?{from:'2026-01-01',when:leaf('offshoreTransfer','eq','no','2025/2652 § 158(5)')}:undefined;
      return {...version,sections,...(derivedFields.length?{derivedFields}:{}),...(scopeChange?{scopeChange}:{})};
    });
    return {...instrument,versions};
  });
  return {...book,fields,instruments};
}
