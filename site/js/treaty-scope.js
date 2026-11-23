// Application articles in the original registered instruments. Each reference is a physical UNTS PDF page.
const options=[{value:'yes',label:'Yes'},{value:'no',label:'No'}];
const refs={marpol:['MARPOL Article 3',61],'stcw-1978':['STCW Article III',5],'load-lines-1966':['Load Lines Articles 4–6',4]};
const groups={
  marpol:[
    ['marpolPartyFlag','Entitled to fly the flag of a MARPOL party'],
    ['marpolPartyAuthority','Operating under the authority of a MARPOL party'],
    ['treatyNaval','Warship or naval auxiliary'],
    ['treatyStateService','State-owned or operated and used only for governmental non-commercial service']
  ],
  'stcw-1978':[
    ['stcwPartyFlag','Entitled to fly the flag of an STCW party'],
    ['stcwSeafarer','Seafarer serving aboard a seagoing ship'],
    ['privateYacht','Pleasure yacht outside trade'],
    ['stcwWooden','Wooden ship of primitive build']
  ],
  'load-lines-1966':[
    ['llRegistration','Registration or flag under Article 4(1)',[['registered','Registered in a contracting country'],['territory','Registered in a territory covered by Article 32'],['unregistered','Unregistered and flying a contracting state’s flag'],['other','Other']]],
    ['llInternational','International voyage under Load Lines Article 2(4)'],
    ['llNew','New ship under Load Lines Article 2(6)'],
    ['llLength','Load Line length (Annex I) · metres','number'],
    ['llTonsGross','Existing ship’s gross tons under Article 5(1)(c)','number'],
    ['llWarship','Ship of war under Load Lines Article 5'],
    ['llExceptedWaters','Solely navigating one of the waters defined in Article 5(2)'],
    ['llExemption','Administration granted an exemption under Load Lines Article 6']
  ]
};
const further={
  'afs-2001':[
    ['afsFlag','Entitled to fly the flag of an AFS Convention party'],['afsAuthority','Operating under the authority of an AFS Convention party'],
    ['afsPort','Entering a port, shipyard or offshore terminal of an AFS party'],['afsStateService','Owned or operated by an AFS party solely on governmental non-commercial service'],
    ['afsInternational','International voyage under AFS article 2(5)'],['afsInstallation','Fixed or floating platform, FSU or FPSO'],
    ['afsLength','Load Line length under AFS article 2(6)','number']],
  'hong-kong-2009':[
    ['hkPartyFlag','Entitled to fly the flag of a Hong Kong Convention party'],['hkPartyAuthority','Operating under the authority of a Hong Kong Convention party'],
    ['hkDomesticLifetime','Operated throughout its life solely in the waters of its flag state'],['hkStateService','Owned or operated by a party solely on governmental non-commercial service']]
};
export const treatyFields=Object.entries({...groups,...further}).flatMap(([id,items])=>items.map(([key,label,type])=>({
  key,label,type:type==='number'?'number':'select',...(type==='number'?{}:{options:Array.isArray(type)?type.map(([value,label])=>({value,label})):options}),
  source:{versionId:'registered-'+id,sectionId:'application'}
})));
const all=(...all)=>({all}),any=(...any)=>({any});
export function originalScope(id){
  const fact=(field,value='yes',op='eq')=>({field,op,value,source:refs[id][0]});
  const civil=all(fact('treatyNaval','no'),fact('treatyStateService','no'));
  if(id==='marpol')return all(any(fact('marpolPartyFlag'),all(fact('marpolPartyFlag','no'),fact('marpolPartyAuthority'))),civil);
  if(id==='stcw-1978')return all(fact('stcwPartyFlag'),fact('stcwSeafarer'),civil,fact('shipType','fishing','neq'),fact('privateYacht','no'),fact('stcwWooden','no'));
  return all(any(...['registered','territory','unregistered'].map(v=>fact('llRegistration',v))),fact('llInternational'),
    fact('llWarship','no'),fact('privateYacht','no'),fact('shipType','fishing','neq'),fact('llExceptedWaters','no'),fact('llExemption','no'),
    any(all(fact('llNew'),fact('llLength',24,'gte')),all(fact('llNew','no'),fact('llTonsGross',150,'gte'))));
}
export function registeredScopes(originals,wording,imo){
  const effective={marpol:'1983-10-02','stcw-1978':'1984-04-28','load-lines-1966':'1968-07-21'};
  const registered=Object.entries(refs).flatMap(([id,[cite,page]])=>{
    const original=originals[id],pages=wording[id],title=imo.instruments.find(t=>t.id===id)?.title;
    if(!original||!pages||!title)return [];
    let text;
    if(id==='marpol')text=pages[60].split('Article 3.')[1]?.split('Article 4.')[0];
    if(id==='stcw-1978')text=(pages[4].split('APPLICATION').at(-1).split("By an amendment")[0]+'\n'+pages[5].split('Article IV.')[0].split('(b) Fishing').at(-1).replace(/^ vessels;/,'(b) Fishing vessels;'));
    if(id==='load-lines-1966')text=pages[2].split('APPLICATION').at(-1)+'\n'+pages[3].split('Article 6')[0];
    if(!text?.trim())return [];
    const versionId='registered-'+id,scope={id:'application',number:cite,title:'Application in the registered text',text:text.trim(),
      pages:id==='stcw-1978'?[5,6]:id==='load-lines-1966'?[3,4]:[page],criteria:originalScope(id),screeningLevel:'section',
      sourceUrl:original.sourceUrl,caveat:'This is the registered text. Later amendments and national implementation have separate records.'};
    const instrument={id:versionId,key:versionId,title,shortTitle:({marpol:'MARPOL','stcw-1978':'STCW','load-lines-1966':'Load Lines'})[id]+' · registered text',
      jurisdiction:'International',authority:'United Nations Treaty Series',language:'en',registeredText:true};
    const version={id:versionId,label:original.label,sourceUrl:original.sourceUrl,pdf:original.pdf,pdfSha256:original.sha256,effectiveFrom:effective[id],
      verifiedThrough:effective[id],sections:[scope],notes:scope.caveat};
    return [{key:versionId+'|'+versionId,type:'folio',instrument,version,sections:[scope]}];
  });
  for(const [id,short,day] of [['afs-2001','Anti-fouling systems','2008-09-17'],['hong-kong-2009','Ship recycling','2025-06-26']]){
    const original=originals[id];if(!original?.passages)continue;
    const versionId='registered-'+id;
    const fact=(field,value,op='eq')=>({field,value,op,source:id==='afs-2001'?'AFS articles 2–3 and Annex 4 regulations 1 and 5':'Hong Kong Convention article 3'});
    const criteria=id==='afs-2001'?all(fact('treatyNaval','no'),fact('afsStateService','no'),any(fact('afsFlag','yes'),fact('afsAuthority','yes'),fact('afsPort','yes'))):
      all(any(fact('hkPartyFlag','yes'),fact('hkPartyAuthority','yes')),fact('treatyNaval','no'),fact('hkStateService','no'),fact('hkDomesticLifetime','no'),fact('grossTonnage',500,'gte'));
    const section=(key,number,title,rule,caveat)=>({id:key,number,title,criteria:rule,screeningLevel:'section',caveat,sourceUrl:original.sourceUrl,...original.passages[key]});
    const sections=[section('application','Article 3','Direct application to ships',criteria,
      'Article 3 also sets obligations for parties with respect to excluded ships and ships of non-parties.'+(id==='hong-kong-2009'?' Ship recycling facilities have a separate route under paragraph 1.2.':''))];
    if(id==='afs-2001'){
      const vessel=all(fact('afsFlag','yes'),fact('afsInternational','yes'),fact('afsInstallation','no'),fact('treatyNaval','no'),fact('afsStateService','no'));
      sections.push(section('surveys','Annex 4, regulation 1(1)','Initial and subsequent surveys',all(vessel,fact('grossTonnage',400,'gte')),
        'The initial survey precedes entry into service or first certification. A change or replacement of the system triggers a subsequent survey.'),
        section('declaration','Annex 4, regulation 5(1)','Declaration on the anti-fouling system',all(vessel,fact('grossTonnage',400,'lt'),fact('afsLength',24,'gte')),
        'The declaration requires a signature and accompanying documentation or endorsement.'));
    }
    const instrument={id:versionId,key:versionId,title:imo.instruments.find(i=>i.id===id).title,shortTitle:short,jurisdiction:'International',authority:'International Maritime Organization',registeredText:true};
    const version={id:versionId,label:original.label,effectiveFrom:day,verifiedThrough:day,pdf:original.pdf,pdfSha256:original.sha256,sourceUrl:original.sourceUrl,sections};
    registered.push({key:versionId+'|'+versionId,type:'folio',instrument,version,sections});
  }
  return registered;
}
