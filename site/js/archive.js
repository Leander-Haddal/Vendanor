const cache = new Map();
export const dataUrl = file => new URL('../data/' + file, import.meta.url);

export async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Source file unavailable (' + response.status + ')');
  return response.json();
}

export async function readShard(name) {
  if (!/^gazette-[a-zA-Z0-9_-]+\.json$/.test(name)) throw new Error('Invalid archive shard name');
  if (cache.has(name)) {
    const hit = cache.get(name);
    cache.delete(name); cache.set(name,hit);
    return hit;
  }
  const pending = readJson(dataUrl(name)).then(value => new Map(value.records.map(record => [record.id,record])));
  cache.set(name,pending);
  if (cache.size > 5) cache.delete(cache.keys().next().value);
  try { return await pending; } catch (error) { cache.delete(name); throw error; }
}

export function archiveSections(record) {
  return (record?.sections || []).map((s,i) => ({...s,id:'p'+i,number:s.label || 'Text '+(i+1),title:'',text:s.text || ''}));
}

export function archiveKind(record) {
  return record.kind === 'consolidated' ? 'Consolidated text' : 'Gazette notice';
}
