import {esc,fold} from './model.js';
import {passagePreview} from './boat-excerpts.js';
import {searchBoat} from './boat-matches.js';

function preferred(rows,values) {
  const rank=r=>['s1','scope','application'].includes(r.section.id)?0:(values.lastSurveyDate&&r.section.survey)?1:r.section.screeningLevel==='section'?2:3;
  return [...rows].sort((a,b)=>rank(a)-rank(b));
}


export function lawCard(group, ctx, query, selected) {
  const card = document.createElement('article');
  card.className = 'owner-card law-card';
  card.dataset.lawId = group.instrument.id;
  const rows = group.sections;
  card.innerHTML = '<header class="law-card-heading"><div><h3>' + esc(group.title) + '</h3><p>' +
    esc(group.instrument.authority || group.category) + '</p></div><span class="passage-total">' +
    rows.length + (rows.length === 1 ? ' passage' : ' passages') + '</span></header><div class="law-passages"></div>';
  const list = card.querySelector('.law-passages');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'expand-passages';
  let shown = 0;
  function append(limit) {
    const start = shown;
    shown = Math.min(rows.length, limit);
    for (const row of rows.slice(start, shown)) list.append(passagePreview(row, query,ctx.state.includeUnspecified,ctx.fields));
    const remaining = rows.length - shown;
    more.hidden = remaining === 0;
    more.textContent = remaining > 8 ? 'Show next 8 passages (' + remaining + ' remaining)' :
      'Show ' + remaining + ' more ' + (remaining === 1 ? 'passage' : 'passages');
  }
  append(selected ? 5 : 1);
  more.onclick = () => {
    const first = shown;
    append(shown + 8);
    const heading = list.children[first].querySelector('h4');
    heading.tabIndex = -1;
    heading.focus({preventScroll:true});
  };
  card.append(more);

  return card;
}

export function groupedLaws(documents, profile, countryName) {
  const {matched, review} = searchBoat(documents, profile, {includeUnspecified:true});
  const laws = new Map(), unspecifiedPrints = new Set();
  for (const group of [...matched, ...review]) {
    const instrument = group.instrument;
    const acrossFlags = !profile.values.flag && instrument.flagState;
    const id = acrossFlags ? instrument.id.slice(0,-instrument.flagState.length-1) : group.id;
    const title = acrossFlags ? group.title.split(' · ')[0] : group.title;
    const rows = preferred(group.sections, profile.values).filter(row=>{
      if(!acrossFlags)return true;
      const key=id+'|'+row.section.clip;
      if(unspecifiedPrints.has(key))return false;
      unspecifiedPrints.add(key);return true;
    });
    if(!rows.length)continue;
    const existing = laws.get(id);
    if (existing) { existing.sections.push(...rows); continue; }
    let category = countryName(instrument.jurisdiction) || 'National legislation';
    if (instrument.local) category = 'Uploaded documents';
    else if (instrument.registeredText) category='Treaty texts';
    else if (instrument.flagState) category = 'International conventions';
    else if (instrument.jurisdiction === 'EU') category = 'European Union';
    laws.set(id, {...group, id, title, category, sections: rows});
  }
  return [...laws.values()].map(group => ({...group, multipleEditions:new Set(group.sections.map(row => row.doc.key)).size > 1}));
}

export function filteredLaws(groups,terms) {
  if(!terms.length)return groups;
  return groups.flatMap(g=>{
    const family=fold([g.title,g.instrument.title,g.instrument.id,g.instrument.authority].join(' ')),remaining=terms.filter(t=>!family.includes(t));
    if(!remaining.length)return [g];
    const sections=g.sections.filter(({doc,section})=>{
      const wording=fold([doc.version.label,section.number,section.title,section.text,...(section.cases||[]).map(c=>c.outcome)].join(' '));
      return remaining.every(t=>wording.includes(t));
    });
    return sections.length?[{...g,sections}]:[];
  });
}

export function lawTreeItem(group, openEditions) {
  const editions = new Map();
  for (const {doc} of group.sections) {
    const entry = editions.get(doc.key);
    if (entry) entry.count++;
    else editions.set(doc.key, {label:doc.version.label, count:1});
  }
  const law = ' data-law="' + esc(group.id) + '"';
  const button = '<button type="button"' + law + '><span>' + esc(group.title) +
    '</span><small title="Passages">' + group.sections.length + '</small></button>';
  if (!group.multipleEditions) return '<li>' + button + '</li>';
  return '<li>' + button + '<details class="edition-tree" data-editions="' + esc(group.id) + '"' +
    (openEditions.has(group.id) ? ' open' : '') + '><summary>' + editions.size + (editions.size === 1 ? ' source edition' : ' source editions') + '</summary><ul>' +
    [...editions].map(([key, entry]) => '<li><button type="button"' + law + ' data-edition="' + esc(key) + '"><span>' +
      esc(entry.label) + '</span><small title="Passages">' + entry.count + '</small></button></li>').join('') + '</ul></details></li>';
}
