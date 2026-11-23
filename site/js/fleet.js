import {esc,fold} from './model.js';

const prefix='ship-law.boat.v1.',cookie='ship_law_boat';

function cookiePath() {
  return new URL('.',location.href).pathname.replace(/[;\r\n]/g,'');
}

export function selectSavedBoat(id='') {
  try{
    document.cookie=cookie+'='+encodeURIComponent(id)+'; Path='+cookiePath()+'; Max-Age='+(id?'31536000':'0')+'; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  }catch{/* Saved boats stay accessible from the device's boat list when cookies are blocked. */}
}

export function savedBoat(id) {
  if(!/^[a-f0-9-]{36}$/i.test(id||''))return null;
  try{
    const value=JSON.parse(localStorage.getItem(prefix+id));
    return value?.id===id && value.name && value.profile?.values ? value : null;
  }catch{return null;}
}

export function selectedBoat() {
  try {
    const value=document.cookie.split('; ').find(part=>part.startsWith(cookie+'='));
    return savedBoat(value?.slice(cookie.length+1));
  }catch{return null;}
}

export function listBoats() {
  const boats=[];
  try {
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key?.startsWith(prefix)){const boat=savedBoat(key.slice(prefix.length));if(boat)boats.push(boat);}
    }
  }catch{return [];}
  return boats.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export function rememberBoat({id,name,identifier,profile,lookup}) {
  const saved={id:savedBoat(id)?.id||crypto.randomUUID(),name:String(name||'').trim().slice(0,140),
    identifier:String(identifier||'').trim().slice(0,90),profile,lookup:lookup||null,updatedAt:new Date().toISOString()};
  if(!saved.name)throw new Error('Give your boat a name to save it.');
  try{localStorage.setItem(prefix+saved.id,JSON.stringify(saved));}
  catch{throw new Error('This browser could not save the boat. Turn off “Remember this boat” to search for this visit.');}
  selectSavedBoat(saved.id);return saved;
}

export function forgetBoat(id) {
  const active=selectedBoat()?.id===id;
  localStorage.removeItem(prefix+id);
  if(active)selectSavedBoat();
}

export function fleetMatches(boats,query) {
  const terms=fold(query).split(' ').filter(Boolean);
  return boats.filter(b=>terms.every(t=>fold([b.name,b.identifier,b.profile.values.flag,b.profile.values.shipType].join(' ')).includes(t)));
}

export function renderFleet(container,{boats,countryName,onNew,onOpen,onEdit,onRemove}) {
  container.innerHTML='<header class="owner-heading"><h1 tabindex="-1">My boats</h1><p>Saved on this device.</p></header>'+
    '<div class="owner-card fleet-card"><div class="fleet-bar">'+(boats.length?'<label>Filter saved boats<input type="search" id="fleet-query" placeholder="Name or registration"></label>':'<h2>Save your first boat</h2>')+
    '<button class="boat-primary" type="button" id="new-boat">Add a boat</button></div>'+
    (boats.length?'':'<p>Choose “Remember this boat” when you search to keep its particulars here.</p>')+'<div id="fleet-list" aria-live="polite"></div></div>';
  const list=container.querySelector('#fleet-list'),input=container.querySelector('#fleet-query');
  function draw() {
    const rows=fleetMatches(boats,input?.value||'');
    list.innerHTML=rows.map(b=>'<article class="fleet-row"><div><h3>'+esc(b.name)+'</h3><p>'+esc([countryName(b.profile.values.flag),b.identifier].filter(Boolean).join(' · '))+'</p></div><div class="owner-actions">'+
      '<button type="button" data-use="'+esc(b.id)+'">See laws</button><button type="button" class="text-action" data-edit="'+esc(b.id)+'">Edit</button><button type="button" class="text-action" data-forget="'+esc(b.id)+'">Remove</button></div></article>').join('')+
      (boats.length&&!rows.length?'<p>No saved boats match this search.</p>':'');
  }
  list.onclick=e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.use)onOpen(b.dataset.use);
    if(b.dataset.edit)onEdit(b.dataset.edit);
    if(b.dataset.forget){const item=boats.find(v=>v.id===b.dataset.forget);if(item&&confirm('Remove “'+item.name+'” from this device?'))onRemove(item.id);}
  };
  if(input)input.oninput=draw;
  container.querySelector('#new-boat').onclick=onNew;draw();
}
