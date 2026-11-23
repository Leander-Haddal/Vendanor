import {isoDay} from './model.js';

const STORAGE='ship-law.profile.v1';
export function readProfile() {
  try {
    const saved=JSON.parse(sessionStorage.getItem(STORAGE)||localStorage.getItem(STORAGE)||'{}');
    return {values:saved.values && typeof saved.values==='object' ? saved.values : {}, asOf:isoDay(saved.asOf)};
  } catch { return {values:{},asOf:''}; }
}

export function collectFields(catalogues, imports) {
  const fields=new Map();
  for(const list of [...catalogues.map(c=>c.fields||[]),...imports.map(d=>d.fields||[])])for(const field of list) {
    const key=field.key||field.id;
    if(!key || !/^[\w.:-]+$/.test(key) || fields.has(key))continue;
    fields.set(key,{...field,key});
  }
  return [...fields.values()];
}

export function saveProfile(profile) {
  try { sessionStorage.setItem(STORAGE,JSON.stringify(profile)); localStorage.removeItem(STORAGE); } catch { /* The current tab can still use the profile. */ }
}
