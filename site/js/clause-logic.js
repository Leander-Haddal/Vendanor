// Preserve unresolved wording alongside field-bound conditions. A local clause never proves the scope of its instrument.
const effect=/(?<!\p{L})(?:shall(?: not)?|must(?: not)?|may(?: not)?|is required to|applies to|does not apply|skal(?: ikke)?|må(?: ikke)?|kan|gjelder(?: ikke)?|doit|doivent|deberá[n]?|debe[n]?|deverá|deverão|deve[m]?|muss|müssen|hat zu|должен|должны|должно)(?!\p{L})/iu;
const opening=/^(if|when|where|unless|provided that|dersom|hvis|når|med mindre|lorsque|si|sauf si|cuando|salvo que|se|quando|salvo se|wenn|sofern|falls|es sei denn|если|когда)\s+/iu;
const trailing=/\s+(provided that|except where|except when|unless|only if|if|when|med mindre|dersom|hvis|når|lorsque|sauf si|cuando|salvo que|quando|salvo se|wenn|sofern|falls|es sei denn|если|когда)\s+/iu;
const exception=/^(unless|except where|except when|med mindre|salvo que|sauf si|salvo se|es sei denn)$/iu;
const comparisons=[
  ['gte','not less than|at least|no less than|minst|au moins|al menos|pelo menos|mindestens'],['lte','not more than|not exceeding|at most|høyst|au plus|como máximo|no superior a|höchstens'],
  ['gt','greater than|more than|over|exceeding|plus de|más de|mais de|mer enn|mehr als'],['lt','less than|below|under|moins de|menos de|mindre enn|unter']
];
const quantities=[['grossTonnage','gross tonnage|GT|bruttotonnasje|(?:de )?jauge brute|(?:de )?arqueo bruto|(?:de )?arqueação bruta|Bruttoraumzahl'],
  ['lengthOverall','(?:metres?|meters?|mètres?|metros?|m) (?:in length overall|in overall length|overall|de eslora total|de longueur hors tout|de comprimento fora a fora)'],
  ['lengthL','(?:metres?|meters?|metros?|m) (?:in length \\(L\\)|lengde \\(L\\))'],
  ['passengers','passengers?|passasjerer|passagers?|pasajeros?|passageiros?'],['deadweightTonnes','(?:tonnes?|tons?) (?:of )?deadweight|DWT'],
  ['personsOnBoard','persons? on board|personnes? à bord|personas a bordo|personer om bord'],
  ['maxPropulsionKw','(?:kW|kilowatts?) (?:of )?(?:maximum |total )?propulsion power']];
const vesselTypes=new Map([['cargo ship','cargo'],['cargo vessel','cargo'],['lasteskip','cargo'],['passenger ship','passenger'],
  ['passenger vessel','passenger'],['passasjerskip','passenger'],['fishing vessel','fishing'],['fishing boat','fishing'],
  ['fiskefartøy','fishing'],['pleasure craft','recreational']]);
for(const [type,names] of Object.entries({
  cargo:['cargo ships','cargo vessels','navire de charge','navires de charge','buque de carga','buques de carga'],
  passenger:['passenger ships','passenger vessels','navire à passagers','navires à passagers','buque de pasaje','buques de pasaje'],
  fishing:['fishing vessels','fishing boats','navire de pêche','navires de pêche','buque pesquero','buques pesqueros','buque de pesca','buques de pesca']
}))for(const name of names)vesselTypes.set(name,type);
const quantityValue='(\\d+(?:[.,]\\d{1,2})?)';
const initial='(?:(?:(?:the |a )?(?:ship|vessel) (?:is |has |carries )?)|(?:(?:skipet|fartøyet) (?:er |har |fører )))?';
const tests=[];
for(const [field,unit] of quantities){
  for(const [op,words] of comparisons){
    tests.push([field,op,new RegExp('^'+initial+'(?:'+words+') '+quantityValue+' (?:'+unit+')$','iu')]);
    tests.push([field,op,new RegExp('^'+initial+'(?:a |an )?(?:'+unit+') (?:of |is |på |de )?(?:'+words+') '+quantityValue+'$','iu')]);
  }
  for(const [op,words] of [['gte','or more|and upwards|eller mer|et plus|ou plus|o más|ou mais'],['lte','or less|or fewer|eller mindre|ou moins|o menos|ou menos']]){
    tests.push([field,op,new RegExp('^'+initial+quantityValue+' (?:'+unit+') (?:'+words+')$','iu')]);
  }
}
export function quotedFacts(rule){
  if(!rule)return [];
  if(rule.wording)return [rule.wording];
  if(rule.not)return quotedFacts(rule.not);
  return (rule.all||rule.any||[]).flatMap(quotedFacts);
}
export function sourceGuard(value){
  const wording=value.trim().replace(/\s+/g,' ').replace(/[.;,\s]+$/,'');
  if(!/[\p{L}\p{N}]/u.test(wording))return null;
  const kind=/^(?:(?:the|a) (?:vessel|ship) is (not )?(?:a |an )?|(?:skipet|fartøyet) er (ikke )?(?:et )?|(?:any|a|each|every|the) )(.+)$/iu.exec(wording);
  const shipType=kind&&vesselTypes.get(kind[3].toLowerCase());
  if(shipType)return {field:'shipType',op:kind[1]||kind[2]?'neq':'eq',value:shipType};
  const noun=wording.toLowerCase().replace(/^(?:all|every|each|any|a|the|tout|tous les|les|un|los|todo|todos los) /u,'');
  if(vesselTypes.has(noun))return {field:'shipType',op:'eq',value:vesselTypes.get(noun)};
  for(const [field,op,test] of tests){const match=test.exec(wording);if(match)return {field,op,value:Number(match[1].replace(',','.'))};}
  // Keep the type and the quantity as separate facts when both are explicitly stated.
  const qualified=/^(?:an? |the |each |every |any |all )?((?:cargo|passenger|fishing) (?:ships?|vessels?|boats?)) (?:of |carrying |having )(.+)$/iu.exec(wording);
  if(qualified&&vesselTypes.has(qualified[1].toLowerCase())){
    for(const [field,op,test] of tests){
      const match=test.exec(qualified[2]);
      if(match)return {all:[{field:'shipType',op:'eq',value:vesselTypes.get(qualified[1].toLowerCase())},{field,op,value:Number(match[1].replace(',','.'))}]};
    }
  }
  // Numeric qualifiers retain their connector inside a single leaf.
  const connective=/\s+(and(?! (?:upwards|above|over)\b)|or(?! (?:more|less|fewer|above|below|over)\b)|og|eller(?! (?:mer|mindre)\b))\s+/giu;
  const operators=[...wording.matchAll(connective)];
  if(operators.length){
    const modes=new Set(operators.map(m=>/^(and|og)$/i.test(m[1])?'all':'any'));
    if(modes.size===1){
      const children=[];let offset=0;
      for(const m of operators){children.push(sourceGuard(wording.slice(offset,m.index)));offset=m.index+m[0].length;}
      children.push(sourceGuard(wording.slice(offset)));
      if(children.some(child=>!child))return {wording};
      const [operator]=modes;
      const independent=children.some(c=>!c.wording)||children.every(c=>/\b(?:has|have|is|are|operates|holds|har|er|gjelder|est|sont)\b/iu.test(c.wording));
      if(independent)return {[operator]:children};
    }
  }
  return {wording};
}
export function extractClauses(text){
  const rows=[];
  for(const sentence of String(text||'').split(/\n\s*\n|(?<=[.!?;])\s+(?=[A-ZÆØÅÉ(])/u)){
    const line=sentence.replace(/^\s*(?:\(\w{1,3}\)\s*)+/,'').replace(/\s+/g,' ').trim();
    if(!line||!effect.test(line))continue;
    const first=opening.exec(line);
    let guard='',outcome='',keyword='';
    if(first){
      const rest=line.slice(first[0].length),modal=effect.exec(rest);
      const separators=[...rest.matchAll(/,\s*(?:then\s+)?|\s+then\s+/giu)].filter(m=>{
        const prefix=rest.slice(0,m.index);
        return (prefix.match(/\(/g)||[]).length===(prefix.match(/\)/g)||[]).length;
      });
      const separator=separators.find(m=>/then/iu.test(m[0]))||separators.filter(m=>m.index<modal.index).at(-1)||separators[0];
      if(separator){guard=rest.slice(0,separator.index);outcome=rest.slice(separator.index+separator[0].length);keyword=first[1];}
    }else{
      const tail=trailing.exec(line);
      if(tail){outcome=line.slice(0,tail.index);guard=line.slice(tail.index+tail[0].length);keyword=tail[1];}
    }
    if(!first&&!keyword){
      const duty=effect.exec(line);
      const subject=line.slice(0,duty.index).trim();
      if(subject.length<=180&&/^(?:(?:every|any|a|each|the|all) (?:[a-z-]+ ){0,3}(?:ship|vessel|ships|vessels)|skipet|fartøyet|lasteskip|passasjerskip|buques|los buques|todo buque|les navires|tout navire|os navios)(?!\p{L})/iu.test(subject)){
        guard=subject;outcome=line.slice(duty.index);
      }
    }
    if(!guard||!outcome||!effect.test(outcome))continue;
    const condition=sourceGuard(guard);
    if(!condition)continue;
    rows.push({guard:keyword?keyword+' '+guard:guard,when:exception.test(keyword)?{not:condition}:condition,outcome});
  }
  return rows;
}
