// Scoped incorporation of treaty provisions in the cited domestic editions.
const noSource='FOR-2014-07-01-1072 §§ 1–3', gbSource='SI 2020/673 regulations 3–5, edition of 12 December 2025';
const leaf=(field,op,value,source)=>({field,op,value,source});
const all=(...all)=>({all}), any=(...any)=>({any}), not=rule=>({not:rule});
const no=(field,value,op='eq')=>leaf(field,op,value,noSource);
const gb=(field,value,op='eq')=>leaf(field,op,value,gbSource);
const noVersion='no-construction-2026', gbVersion='uk-navigation-2025';
const caVersion='ca-arctic-2023';
const environmentVersion='no-environment-2026',environmentUrl='https://lovdata.no/dokument/SF/forskrift/2012-05-30-488';
const noUrl='https://lovdata.no/dokument/SF/forskrift/2014-07-01-1072';
const ukUrl='https://www.legislation.gov.uk/uksi/2020/673';
const yesNo=[{value:'yes',label:'Yes'},{value:'no',label:'No'}];
function fact(key,label,versionId,sectionId){
  return {key,label,type:'select',options:yesNo,source:{versionId,sectionId}};
}
export const implementationFields=[
  ...[
    ['caCanadianVessel','Registered, listed or exempt from registration as a Canadian vessel under the Canada Shipping Act'],
    ['caPolarWaters','In polar waters as defined by SOLAS XIV/1.4'],
    ['caControlZone','In a Canadian shipping safety control zone'],
    ['caGovernmentExempt','Government or foreign state vessel covered by the exemption in section 3'],
    ['caMechanicalPropulsion','Has a mechanical means of propulsion'],
    ['caChapterICertified','Certified as meeting SOLAS chapter I'],
  ].map(([key,label])=>fact(key,label,caVersion,'polar-shipping')),
  fact('noForeignPassengerCertificate','Norwegian Passenger Ship Safety Certificate required for foreign voyages',noVersion,'solas-construction'),
  {key:'noEnvironmentArea',label:'Location under Norway’s marine environmental regulations',type:'select',options:[
    {value:'territorial',label:'Norwegian territorial waters, including Svalbard and Jan Mayen'},{value:'eez',label:'Norwegian exclusive economic zone'},
    {value:'shelf',label:'Norwegian continental shelf'},{value:'other',label:'Elsewhere'}],source:{versionId:environmentVersion,sectionId:'oil'}},
  fact('noEnvironmentJurisdiction','International law permits Norwegian jurisdiction in this case',environmentVersion,'oil'),
  fact('noVoluntaryPortDischarge','High-seas discharge and voluntary presence at a Norwegian port or installation under § 1',environmentVersion,'oil'),
  fact('noHeritageFjord','Operating in a World Heritage fjord defined by the Norwegian regulation',environmentVersion,'fjord-nox'),
  fact('ukNavWaters','Within UK waters',gbVersion,'navigation-scope'),
  fact('ukNavNaval','Warship or naval auxiliary',gbVersion,'navigation-scope'),
  fact('ukNavGovernment','State-owned or operated solely in governmental non-commercial service',gbVersion,'navigation-scope'),
  fact('ukNavGreatLakes','Solely within the Great Lakes area defined in regulation 3(2)(c)',gbVersion,'navigation-scope'),
  fact('ukNavDomestic','Subject to UK domestic passenger ship regulations of 2000',gbVersion,'navigation-scope'),
  fact('ukNavCategorised','Subject to the UK categorised-waters passenger safety code of 2010',gbVersion,'navigation-scope'),
  fact('ukNavInland','Subject to UK technical requirements for inland waterway vessels of 2010',gbVersion,'navigation-scope'),
  fact('ukNavParty','Flag state is a SOLAS contracting party',gbVersion,'navigation-scope'),
  fact('ukNavInvoluntary','UK entry solely due to weather or unavoidable circumstances under regulation 3(3)',gbVersion,'navigation-scope')
];
export const norwegianConstruction=all(no('flag','NO'),no('foreignTrade','yes'),
  any(all(no('shipType','cargo'),no('grossTonnage',500,'gte')),all(no('shipType','passenger'),no('noForeignPassengerCertificate','yes'))));
export const ukNavigation=all(any(gb('flag','GB'),all(gb('flag','GB','neq'),gb('ukNavWaters','yes'))),
  ...['ukNavNaval','ukNavGovernment','ukNavGreatLakes','ukNavDomestic','ukNavCategorised','ukNavInland'].map(f=>gb(f,'no')),
  not(all(gb('flag','GB','neq'),gb('ukNavParty','no'),gb('ukNavInvoluntary','yes'))));
const pilotTransferException=any(gb('grossTonnage',150,'lt'),all(gb('grossTonnage',500,'lt'),gb('solasVoyage','other')),gb('shipType','fishing'));

function edition(id,title,shortTitle,jurisdiction,authority,language,day,sourceUrl,sections){
  const instrument={id,key:id,title,shortTitle,jurisdiction,authority,language};
  const version={id,label:day+' consolidated edition',effectiveFrom:day,verifiedThrough:'2026-11-23',sourceUrl,sections};
  return {key:id+'|'+day,type:'folio',instrument,version,sections};
}
export function canadianPolarScope(){
  const ca=(field,op,value)=>leaf(field,op,value,'SOR/2017-286, sections 1–3 and 5–6');
  return all(any(all(ca('caCanadianVessel','eq','yes'),ca('caPolarWaters','eq','yes')),
    all(ca('caCanadianVessel','eq','no'),ca('caControlZone','eq','yes'))),
    ca('caGovernmentExempt','eq','no'),ca('shipType','neq','fishing'),ca('shipType','neq','recreational'),ca('caMechanicalPropulsion','eq','yes'),
    any(ca('grossTonnage','gte',500),all(ca('passengers','gt',12),ca('caChapterICertified','eq','yes'))));
}
export function domesticImplementations(norwegian,uk,environment,canada){
  const docs=[];
  if(canada){
    const section={id:'polar-shipping',number:'Section 6',title:'SOLAS chapter XIV in polar waters',text:canada.text,pages:canada.pages,
      criteria:canadianPolarScope(),screeningLevel:'section',sourceUrl:canada.sourceUrl+'page-1.html',incorporates:{instrument:'solas-1974',
        reference:'SOLAS chapter XIV · ships operating in polar waters',exclusions:'Section 3 excludes government service as specified. Section 6(2) excludes fishing vessels, pleasure craft and vessels without mechanical propulsion.'}};
    const doc=edition(caVersion,'Arctic Shipping Safety and Pollution Prevention Regulations','Arctic shipping · SOLAS XIV','CA','Justice Canada','en',canada.effectiveFrom,canada.sourceUrl,[section]);
    Object.assign(doc.version,{pdf:canada.pdf,pdfSha256:canada.sha256,verifiedThrough:canada.verifiedThrough,sourceLinks:[canada.pdfUrl,'https://laws.justice.gc.ca/eng/acts/C-10.15/section-2.html']});
    docs.push(doc);
  }
  const section=norwegian?.sections.find(s=>s.key==='§3');
  if(section){
    const text=section.text.split('(3)')[0].trim();
    docs.push(edition(noVersion,'Forskrift om bygging av skip','Ship construction · SOLAS II-1','NO','Sjøfartsdirektoratet','nb','2026-01-01',noUrl,[{
      id:'solas-construction',number:'§ 3(1)–(2)',title:'SOLAS chapter II-1 on foreign voyages',text,sourceUrl:section.sourceUrl,
      criteria:norwegianConstruction,screeningLevel:'section',incorporates:{instrument:'solas-1974',reference:'SOLAS II-1 · 2024 consolidated edition as amended by MSC.532(107)',
        exclusions:'Regulations II-1/19 through II-1/24 are excluded by § 3(2).'},
      caveat:'Passenger certification is defined by § 1. The offshore support vessel requirements in § 3(3)–(4) are separate.'}]));
  }
  if(uk?.sections.length){
    const published=id=>uk.sections.find(s=>s.id==='regulation-'+id).text;
    const rule=(id,number,title,text,criteria,sectionNo,extra={})=>({id,number,title,text,criteria,screeningLevel:'section',sourceUrl:ukUrl+'/regulation/'+sectionNo+'/'+uk.edition,...extra});
    const pilot=published(5).match(/g regulation 23 in Chapter V.*?(?= h regulations 24)/)?.[0];
    const sections=[rule('navigation-scope','Regulation 3(1)–(3)','Territorial scope and exclusions',published(3).split(' 4 Where persons')[0],ukNavigation,3),
      rule('ambulatory-reference','Regulation 4','Amendments to SOLAS chapter V',published(4),ukNavigation,4,{
        incorporates:{instrument:'solas-1974',reference:'SOLAS chapter V · ambulatory reference',
          exclusions:'Article VIII controls when changes take effect. Regulation 5 enumerates the requirements and exceptions.'}})];
    if(pilot)sections.push(rule('pilot-transfer','Regulation 5(3)(g)','Exception to SOLAS V/23 pilot transfer arrangements',pilot,
      all(ukNavigation,pilotTransferException),5,{incorporates:{instrument:'solas-1974',reference:'Exception to SOLAS V/23 under regulation 5(3)(g)'}}));
    docs.push(edition(gbVersion,'The Merchant Shipping (Safety of Navigation) Regulations 2020','Safety of navigation · SOLAS V','GB','UK Statutory Instruments','en',uk.edition,ukUrl,sections));
  }
  if(environment){
    const cited=(field,op,value)=>leaf(field,op,value,'FOR-2012-05-30-488 §§ 1, 4, 8 and 14c');
    const domestic=cited('flag','eq','NO'),foreign=all(cited('flag','neq','NO'),cited('noEnvironmentJurisdiction','eq','yes'));
    const area=any(...['territorial','eez','shelf'].map(v=>cited('noEnvironmentArea','eq',v)));
    const ordinary=any(domestic,all(foreign,area));
    const oil=any(domestic,all(foreign,any(area,cited('noVoluntaryPortDischarge','eq','yes'))));
    const fjord=all(any(domestic,foreign),cited('noHeritageFjord','eq','yes'),cited('grossTonnage','gte',1000),cited('shipType','neq','cargo'));
    const rules=[
      ['§4','oil','MARPOL Annex I · oil pollution',oil,'Annex I, 2022 edition with MEPC.343(78), MEPC.359(79) and MEPC.381(80).','Regulation I/42 is excluded by § 4. Mobile offshore units are included.'],
      ['§8','packaged','MARPOL Annex III · harmful substances in packaged form',ordinary,'Annex III, 2022 consolidated edition.','The duties within Annex III depend on its own provisions.'],
      ['§14c','fjord-nox','World Heritage fjords · NOx Tier III for non-cargo ships',fjord,'MARPOL VI/13 · Tier III for the first-paragraph route.','The second paragraph sets 1 January 2030 for cargo ships of at least 1,000 GT.']
    ];
    const sections=rules.flatMap(([key,id,title,criteria,reference,exclusions])=>{
      const source=environment.sections.find(s=>s.key===key);
      return source?[{id,number:key,title,criteria,screeningLevel:'section',text:source.text.split('[Endringsnote]')[0].trim(),sourceUrl:source.sourceUrl,incorporates:{instrument:'marpol',reference,exclusions}}]:[];
    });
    if(sections.length)docs.push(edition(environmentVersion,'Forskrift om miljømessig sikkerhet for skip og flyttbare innretninger','Marine environmental safety · MARPOL','NO','Sjøfartsdirektoratet','nb','2026-09-01',environmentUrl,sections));
  }
  return docs;
}
