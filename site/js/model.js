/** Lowercase search form. Preserve the original wording in all displayed sources. */
export function fold(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/\s+/g, ' ').trim();
}

export function queryParts(query) {
  return (String(query).match(/"[^"]+"|[^\s"]+/g) || []).map(part => fold(part.replace(/^"|"$/g, ''))).filter(Boolean);
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
}

export function marked(value, query) {
  const text = String(value ?? '');
  const words = (String(query).match(/"[^"]+"|[^\s"]+/g) || []).map(word => word.replace(/^"|"$/g, '')).filter(Boolean);
  if (!words.length) return esc(text);
  const special = /[.*+?^${}()|[\]\\]/g;
  const patterns = words.map(word => word.replace(special, '\\$&').replace(/\s+/g, '\\s+'));
  const pattern = new RegExp('(' + patterns.join('|') + ')', 'giu');
  return text.split(pattern).map((part, index) => index % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part)).join('');
}

export function safeUrl(raw, local = false) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const base = local ? new URL('../', import.meta.url).href : globalThis.location?.href || 'https://example.test/project/';
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (local && url.origin !== new URL(base).origin) return '';
    return url.href;
  } catch { return ''; }
}

export function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function compareValue(left, op, right) {
  if (/^\d{4}$/.test(String(left)) && typeof right === 'string' && isoDay(right)) {
    const first = left + '-01-01', last = left + '-12-31';
    if (op === 'eq' || op === 'neq') {
      return right < first || right > last ? op === 'neq' : null;
    }
    const low = compareValue(first, op, right), high = compareValue(last, op, right);
    return low === high ? low : null;
  }
  if (typeof right === 'number') {
    if ((typeof left !== 'number' && typeof left !== 'string') || String(left).trim() === '' || !Number.isFinite(Number(left))) return null;
    left = Number(left);
  }
  if (typeof left !== typeof right) return null;
  switch (op) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    case 'gt': return left > right;
    case 'gte': return left >= right;
    default: return null;
  }
}

/** true/false/null correspond to supported, outside, and insufficient indexed evidence. */
export function evaluate(rule, profile = {}) {
  if (!rule || typeof rule !== 'object') return null;
  if (Array.isArray(rule.all) || Array.isArray(rule.any)) {
    const and = Array.isArray(rule.all);
    const list = and ? rule.all : rule.any;
    if (!list.length) return null;
    const states = list.map(item => evaluate(item, profile));
    if (states.includes(!and)) return !and;
    return states.includes(null) ? null : and;
  }
  if (rule.not) {
    const state = evaluate(rule.not, profile);
    return state === null ? null : !state;
  }
  if (!Object.hasOwn(profile,rule.field)) return null;
  let value = profile[rule.field];
  if (value == null || value === '') return null;
  if(rule.field==='flag'&&rule.value==='other'&&/^[A-Z]{2}$/.test(value)&&value!=='NO')value='other';
  return compareValue(value, rule.op, rule.value);
}

export function temporal(version, date) {
  if (!date) return true;
  if (version.effectiveFrom && date < version.effectiveFrom) return false;
  if (version.effectiveTo && date >= version.effectiveTo) return false;
  if (version.effectiveFrom && version.verifiedThrough && date <= version.verifiedThrough) return true;
  // A missing bound on a historical source is never proof that the text still governs.
  if (!version.effectiveFrom || !version.effectiveTo) return null;
  return true;
}

export function assess(section, version, profile, asOf) {
  const scope = evaluate(section.criteria, profile);
  const time = temporal(version, asOf);
  if (scope === false || time === false) return 'outside';
  return scope === true && time === true ? 'match' : 'review';
}

export function describeRule(rule, fields) {
  if (!rule) return 'Read the provision and its scope in the source.';
  if (rule.all || rule.any) {
    const group = rule.all || rule.any;
    return '(' + group.map(item => describeRule(item,fields)).join(rule.all ? ' AND ' : ' OR ') + ')';
  }
  if (rule.not) return 'Except ' + describeRule(rule.not, fields);
  const field = fields.find(item => (item.key || item.id) === rule.field);
  const option = field?.options?.find(item => (item.value ?? item) === rule.value);
  const op = {eq:'=',neq:'≠',lt:'<',lte:'≤',gt:'>',gte:'≥'}[rule.op] || rule.op;
  return [field?.label || rule.field, op, option?.label || rule.value, field?.unit].filter(v => v !== undefined && v !== '').join(' ');
}

export function evidenceRows(rule,fields,profile) {
  if(!rule)return [];
  if(rule.all||rule.any)return (rule.all||rule.any).flatMap(child=>evidenceRows(child,fields,profile));
  if(rule.not)return evidenceRows(rule.not,fields,profile);
  const field=fields.find(f=>f.key===rule.field),value=profile[rule.field],tested=evaluate(rule,profile);
  const option=field?.options?.find(o=>(o.value??o)===value);
  const entered=value===undefined||value===''?'Unknown':[option?.label??value,field?.unit].filter(v=>v!==undefined&&v!=='').join(' ');
  const cited=rule.source||field?.source;
  return [{condition:describeRule(rule,fields),entered,tested,source:typeof cited==='string'?cited:cited?[cited.versionId,cited.sectionId].join(' / '):''}];
}

export function mergeInstruments(official, local) {
  const grouped = new Map();
  for (const instrument of [...official, ...local]) {
    const prefix = local.includes(instrument) ? 'local:' : 'official:';
    const id = prefix + instrument.id;
    if (!grouped.has(id)) grouped.set(id, {...instrument, key:id, local:prefix === 'local:', versions:[]});
    grouped.get(id).versions.push(...instrument.versions);
  }
  return [...grouped.values()];
}

export function folioRows(instruments) {
  const rows = [];
  for (const instrument of instruments) for (const version of instrument.versions) {
    const doc = instrument.key + '|' + version.id;
    for (const section of version.sections || []) rows.push({
      id:doc+'|'+section.id, doc, sectionId:section.id, type:instrument.local?'local':'folio',
      title:instrument.shortTitle || instrument.title, fullTitle:instrument.title,
      heading:[section.number, section.title].filter(Boolean).join(' '),
      date:version.publishedOn || version.editionDate || String(version.publicationYear||''), subtitle:version.label, text:section.text || '',
      criteria:section.criteria, effectiveFrom:version.effectiveFrom, effectiveTo:version.effectiveTo,verifiedThrough:version.verifiedThrough,
      jurisdiction:instrument.jurisdiction, sharedPassage:instrument.flagState?section.clip:'', reference:[instrument.id,version.id,section.number].join(' ')
    });
  }
  return rows;
}

export function excerpt(text, parts, limit = 165) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (source.length <= limit) return source;
  const found = parts.length ? fold(source).indexOf(parts[0]) : 0;
  const start = Math.max(0, Math.min(found - 38, source.length - limit));
  return (start ? '…' : '') + source.slice(start,start+limit) + (start+limit < source.length ? '…' : '');
}

export function statusLabel(value) {
  return {match:'Matches indexed conditions',review:'Needs review',outside:'Outside indexed conditions'}[value] || 'Needs review';
}
