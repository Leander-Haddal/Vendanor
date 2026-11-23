import {esc,isoDay,safeUrl} from './model.js';
import {dateLabel,mountRevisionPicker} from './revision-picker.js';

const keyLabels={
  flag:'Flag state',shipType:'Boat type',lengthOverall:'Length overall',lengthL:'Regulatory length (L)',grossTonnage:'Gross tonnage',
  deadweightTonnes:'Deadweight',buildDate:'Year or date built',lastSurveyDate:'Last qualifying survey',
  approvedTraining:'Approved recreational competency training',onlyPassenger2020:'Used exclusively under the 2020 passenger rules',
  norwegianWaters:'Operating in the Norwegian waters defined in § 1',passengers:'Passengers carried',colregWaters:'Operating waters for collision rules'
};
const units={lengthOverall:'m',lengthL:'m',grossTonnage:'GT',deadweightTonnes:'t DWT'};
const shipNames={cargo:'Cargo ship',recreational:'Recreational boat',passenger:'Passenger vessel',fishing:'Fishing vessel',other:'Other vessel',tanker:'Oil tanker'};
const operating=['passengers','norwegianWaters','approvedTraining','onlyPassenger2020','tows','anchorHandling','euMemberFlag','euPortActivity','euGovernmentService','euHeavyGradeOil'];
const dates=['lastSurveyDate','contractDate','keelDate','deliveryDate','hasBuildContract'];

export function today() {
  const date=new Date();
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

export function fieldName(field) {return keyLabels[field.key]||field.label;}

export function lookupEvidence(lookup,values) {
  if(!lookup?.evidence)return '';
  const facts=lookup.evidence.filter(f=>String(values[f.key]??'')===String(f.value)&&safeUrl(f.sourceUrl));
  if(!facts.length)return '';
  return '<details class="owner-disclosure lookup-evidence"><summary>Source of vessel particulars</summary><p>'+esc([lookup.provider,lookup.date].filter(Boolean).join(' · '))+'</p><ul>'+
    facts.map(f=>'<li>'+esc(f.label)+' · '+esc(f.value)+' · <a target="_blank" rel="noopener noreferrer" href="'+esc(safeUrl(f.sourceUrl))+'">View statement</a></li>').join('')+'</ul></details>';
}


export function operationShortcuts(values,missing) {
  const choices=[];
  if(values.shipType==='recreational')choices.push({name:'Confirm private leisure use',description:'The boat is ordinarily used for private leisure and is outside commercial service.',changes:{mlcCommercialActivity:'no'}});
  if(values.flag==='NO'&&values.shipType==='cargo'){
    choices.push({name:'Confirm both cargo exceptions are absent',description:'The boat has neither approved recreational competency training nor exclusive operation under the 2020 passenger rules.',
      changes:{approvedTraining:'no',onlyPassenger2020:'no'}});
  }
  if(values.shipType!=='fishing'){
    choices.push({name:'Confirm standard commercial operation',description:'The boat ordinarily works commercially beyond inland or sheltered waters. It is conventionally built and outside fishing, similar pursuits and naval service.',
      changes:{mlcCommercialActivity:'yes',mlcSeagoing:'yes',mlcTraditionalBuild:'no',mlcFishingOrSimilar:'no',mlcWarshipOrNavalAuxiliary:'no'}});
  }
  return choices.filter(c=>Object.keys(c.changes).some(k=>missing.includes(k))&&Object.entries(c.changes).every(([k,v])=>values[k]===undefined||values[k]===v));
}

export function boatControl(field,value,{required=false,prefix='boat',ownerType=false}={}) {
  if(!field)return '';
  const key=field.key,id=prefix+'-'+key,name=esc(key),label=fieldName(field);
  let input;
  if(field.options?.length){
    let options=field.options.map(o=>({value:o.value??o,label:o.label??o}));
    if(key==='shipType'&&ownerType){
      options=options.map(o=>({...o,label:shipNames[o.value]||o.label}));
      if(!options.some(o=>o.value==='tanker'))options.push({value:'tanker',label:'Oil tanker (MARPOL)'});
    }
    const prompt=required?(key==='flag'?'Select flag state':'Select boat type'):'Unknown';
    input='<select id="'+esc(id)+'" name="'+name+'" '+(required?'required':'')+'><option value="">'+prompt+'</option>'+
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

function groupFor(values,fields,inline) {
  const core=['flag','shipType','lengthOverall','grossTonnage'];
  const particulars=['buildDate'];
  if(values.flag==='NO'&&values.shipType==='cargo')particulars.push('lengthL');
  if(values.euOilTanker==='yes')particulars.push('deadweightTonnes');
  if(values.shipType&&values.flag&&fields.some(f=>f.key==='colregWaters'))particulars.push('colregWaters');
  if(values.shipType==='recreational'&&fields.some(f=>f.key==='mlcCommercialActivity'))particulars.push('mlcCommercialActivity');
  if(!inline)core.push(...particulars);
  const known=new Set(core);
  const groups=[{title:'Operation and passengers',keys:operating.filter(k=>!k.startsWith('eu')||values.euOilTanker==='yes')},
    {title:'Surveys and construction dates',keys:dates}];
  if(inline)groups.unshift({title:'Dimensions, construction and service',keys:particulars});
  for(const g of groups)for(const k of g.keys)known.add(k);
  for(const [prefix,title] of [['colreg','Navigation lights and collision rules'],['solas','Safety of Life at Sea'],['mlc','Maritime labour and certification'],['ukLsa','United Kingdom life-saving appliances'],['us','United States recreational safety'],['nz','New Zealand navigation safety']]){
    const keys=fields.filter(f=>f.key.startsWith(prefix)&&!known.has(f.key)).map(f=>f.key);
    if(keys.length){groups.push({title,keys});for(const k of keys)known.add(k);}
  }
  groups.push({title:'Further legal particulars',keys:fields.filter(f=>!known.has(f.key)&&!(f.key==='euOilTanker'&&values.euOilTanker==='yes')).map(f=>f.key)});
  return {core,groups};
}

export function renderBoatForm(container,ctx) {
  const {fields,draft,inline=false}=ctx,byKey=new Map(fields.map(f=>[f.key,f])),values={...draft.profile.values};
  const prefix=inline?'result-boat':'boat';
  const get=suffix=>container.querySelector('#'+prefix+'-'+suffix);
  const more='<details class="owner-disclosure owner-more"><summary>'+(inline?'More specifications':'More boat details and definitions')+'</summary><div>'+
    '<div id="'+prefix+'-more"></div><details class="owner-disclosure"><summary>Where to find the values</summary><div class="boat-definitions" id="'+prefix+'-definitions"></div></details></div></details>';
  const core='<div class="owner-grid" id="'+prefix+'-core"></div>';
  const feedback='<p class="form-status" role="status" id="'+prefix+'-form-status"></p>';
  if(inline){
    container.innerHTML='<form id="result-boat-form" autocomplete="off" aria-label="Ship specifications">'+core+more+
      '<div id="result-boat-lookup-evidence"></div>'+feedback+'</form>';
  }else{
    container.innerHTML='<div class="owner-card entry-card"><form id="boat-form" autocomplete="off"><div class="boat-form-body"><fieldset><legend>Ship specifications</legend>'+core+'</fieldset>'+more+'<div id="boat-lookup-evidence"></div>'+
      '<div class="owner-grid" id="boat-identity" hidden><label>Boat name<input name="_name" maxlength="140" autocomplete="off"></label><label>IMO, MMSI or registration <small>(optional)</small><input name="_identifier" maxlength="90" autocomplete="off"></label></div></div>'+
      '<div class="owner-form-foot"><button type="submit" id="boat-submit" class="boat-primary">Find laws</button><label class="owner-check"><input type="checkbox" name="_remember">Remember this boat on this device</label></div>'+feedback+'</form></div>';
  }
  const form=get('form'),controls=form.elements,definitions=get('definitions');
  if(!inline){
    controls._remember.checked=Boolean(draft.remember);
    controls._name.value=draft.name||'';controls._identifier.value=draft.identifier||'';
  }
  const lookup=draft.lookup;
  const dialog=document.createElement('dialog');
  dialog.className='revision-dialog';
  dialog.setAttribute('aria-label','Choose a law date');
  container.append(dialog);
  const datePicker=mountRevisionPicker(dialog,{
    flagName:()=>controls.flag?.value ? controls.flag.selectedOptions[0].textContent : '',
    getRevisions:()=>ctx.revisions(values),latestDay:ctx.latestDay,
    onChoose:day=>{
      controls._asOf.value=day;
      get('date-picker').textContent=dateLabel(day);
      ctx.onDraft?.(snapshot());
    }
  });
  function showLookupEvidence(){
    const host=get('lookup-evidence'),open=host.querySelector('details')?.open;
    host.innerHTML=lookupEvidence(lookup,values);
    if(open&&host.firstElementChild)host.firstElementChild.open=true;
  }
  function syncIdentity() {
    const remember=controls._remember.checked;
    container.querySelector('#boat-identity').hidden=!remember;controls._name.required=remember;
  }
  function renderFields() {
    const openGroups=new Set([...get('more').querySelectorAll('details[open]')].map(d=>d.dataset.group));
    const {core,groups}=groupFor(values,fields,inline);
    const markup=(key,required=false)=>boatControl(byKey.get(key),key==='shipType'&&values.euOilTanker==='yes'?'tanker':values[key],{prefix,required,ownerType:key==='shipType'});
    const day=controls._asOf?.value||draft.profile.asOf||today();
    get('core').innerHTML=core.map(k=>markup(k,k==='flag'||k==='shipType')).join('')+
      '<div class="owner-field"><label id="'+prefix+'-date-label" for="'+prefix+'-date-picker">Date and editions</label><button type="button" class="date-picker-button" aria-haspopup="dialog" aria-labelledby="'+prefix+'-date-label '+prefix+'-date-picker" id="'+prefix+'-date-picker">'+esc(dateLabel(day))+'</button><input type="hidden" name="_asOf" value="'+esc(day)+'"></div>'+
      (inline?'<button type="submit" class="boat-primary">Apply changes</button>':'');
    get('date-picker').onclick=()=>datePicker.open(controls._asOf.value);
    get('more').innerHTML=groups.map(g=>{
      const keys=g.keys.filter(k=>byKey.has(k));if(!keys.length)return '';
      return '<details class="owner-disclosure" data-group="'+esc(g.title)+'" '+(openGroups.has(g.title)?'open':'')+'><summary>'+esc(g.title)+'</summary><div class="owner-grid detail-fields">'+keys.map(k=>markup(k)).join('')+'</div></details>';
    }).join('');
    definitions.innerHTML='<dl>'+fields.filter(f=>f.help||f.source).map(f=>'<dt>'+esc(fieldName(f))+'</dt><dd>'+esc(f.help||'')+(f.source?.versionId?'<button type="button" class="text-action" data-definition="'+esc(f.key)+'">Read source provision</button>':'')+'</dd>').join('')+'</dl>';
    showLookupEvidence();
  }
  function updateField(el) {
    const field=byKey.get(el.name);if(!field)return;
    const raw=el.value.trim();
    if(field.key==='flag'&&values.flag&&raw!==values.flag)delete values.euMemberFlag;
    if(field.key==='shipType'){
      if(raw==='tanker'){values.shipType='cargo';values.euOilTanker='yes';}
      else{if(values.euOilTanker==='yes')delete values.euOilTanker;if(raw)values.shipType=raw;else delete values.shipType;}
    }else if(raw==='')delete values[field.key];
    else values[field.key]=field.type==='number'?Number(raw):raw;
  }
  function snapshot() {
    if(inline)return {...draft,profile:{asOf:controls._asOf.value||today(),values:{...values}}};
    return {...draft,name:controls._name.value.trim(),identifier:controls._identifier.value.trim(),remember:controls._remember.checked,
      profile:{asOf:controls._asOf.value||today(),values:{...values}},lookup};
  }
  form.oninput=e=>{
    e.target.setCustomValidity?.('');updateField(e.target);if(lookup)showLookupEvidence();ctx.onDraft?.(snapshot());
  };
  form.onchange=e=>{
    const el=e.target;updateField(el);
    if(el.name==='flag'||el.name==='shipType'||el.name==='euOilTanker'){
      renderFields();controls.namedItem(el.name)?.focus({preventScroll:true});
    }
    if(el.name==='_remember')syncIdentity();
    ctx.onDraft?.(snapshot());
  };
  form.addEventListener('invalid',e=>{for(let d=e.target.closest('details');d;d=d.parentElement.closest('details'))d.open=true;},true);
  definitions.onclick=e=>{const key=e.target.closest('[data-definition]')?.dataset.definition;if(key)ctx.onSource(byKey.get(key).source);};
  form.onsubmit=e=>{
    e.preventDefault();
    for(const f of fields){
      const input=controls.namedItem(f.key);if(!input||f.key==='shipType')continue;
      updateField(input);
      if(f.type==='date'&&input.value&&!/^\d{4}$/.test(input.value)&&!isoDay(input.value)){
        for(let d=input.closest('details');d;d=d.parentElement.closest('details'))d.open=true;
        readBoatValue(input,f);return;
      }
    }
    const value=snapshot();
    try{ctx.onSearch(value);}catch(error){get('form-status').textContent=error.message;}
  };
  renderFields();
  if(!inline)syncIdentity();
  return datePicker.refresh;
}
