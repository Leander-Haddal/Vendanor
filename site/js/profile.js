export function collectFields(catalogues, imports) {
  const fields=new Map();
  for(const list of [...catalogues.map(c=>c.fields||[]),...imports.map(d=>d.fields||[])])for(const field of list) {
    const key=field.key||field.id;
    if(!key || !/^[\w.:-]+$/.test(key) || fields.has(key))continue;
    fields.set(key,{...field,key});
  }
  return [...fields.values()];
}
