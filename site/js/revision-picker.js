import {esc, fold, isoDay} from './model.js';

const displayDate = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
export function dateLabel(day) {
  return isoDay(day) ? displayDate.format(new Date(day + 'T00:00:00Z')) : '';
}

export function publisherDates(values,world,publishers,gazette,uk,eu){
  const result=[];
  const add=(stamp,basis,title,edition)=>{
    if(isoDay(stamp))result.push({date:stamp,stamp,year:stamp.slice(0,4),basis,title,edition});
  };
  if(!values.flag)return result;
  for(const r of world){
    if(!r.codes.includes(values.flag))continue;
    add(r.issuedDate,'Issued',r.title,r.kind||'National instrument');
    const match=publishers[r.id.slice(6)];
    if(match?.editionDate&&match.editionDate!==r.issuedDate)add(match.editionDate,'Edition dated',r.title,match.label||'Domestic publisher edition');
  }
  if(values.flag==='NO')for(const r of gazette)add(r.publishedDate,'Published',r.title,r.kind==='gazette'?'Norwegian gazette':'Consolidated record');
  if(values.flag==='GB')for(const r of uk)for(const v of r.versions)add(v.label,'Edition dated',r.title,'UK legislation');
  if(values.euMemberFlag==='yes')for(const r of eu)for(const v of [r,...r.editions])add(v.date,'Edition dated',r.title,v.kind||'EU act');
  return result;
}

export function revisionDates(documents, values, publications=[]) {
  if (!values.flag) return [];
  const rows = [];
  for (const {instrument, version} of documents) {
    const jurisdiction = instrument.flagState || instrument.jurisdiction;
    if (jurisdiction !== values.flag && !(jurisdiction === 'EU' && values.euMemberFlag === 'yes')) continue;
    const milestones = [[version.effectiveFrom, 'In force from'], [version.editionDate, 'Edition dated'],
      [version.publishedOn, 'Published'], [version.adoptedOn, 'Adopted']];
    const years = new Set();
    for (const [stamp, basis] of milestones) {
      if (!isoDay(stamp) || (version.effectiveTo && stamp >= version.effectiveTo)) continue;
      const year = stamp.slice(0, 4);
      if (years.has(year)) continue;
      years.add(year);
      // An adopted or published amendment can take effect later for this flag.
      const date = version.effectiveFrom && stamp < version.effectiveFrom ? version.effectiveFrom : stamp;
      rows.push({date, stamp, year, basis, title:instrument.shortTitle || instrument.title, edition:version.label});
    }
  }
  const unique=new Map();
  for(const row of [...rows,...publications])unique.set(JSON.stringify([row.stamp,row.date,row.title,row.edition]),row);
  return [...unique.values()].sort((a, b) => b.stamp.localeCompare(a.stamp) || a.title.localeCompare(b.title) || a.edition.localeCompare(b.edition));
}

export function mountRevisionPicker(dialog, {flagName, getRevisions, latestDay, onChoose}) {
  dialog.innerHTML = '<header><h2>Law date</h2><button type="button" data-close aria-label="Close date selector">Close</button></header>' +
    '<div class="revision-content"><label>Revision year<select data-year></select></label>' +
    '<label data-find-label hidden>Find an instrument<input type="search" data-find></label><p data-status role="status"></p><ul class="revision-list"></ul><button type="button" data-more hidden>More editions</button></div>' +
    '<form class="revision-custom"><label>Exact date<input type="date" required name="day"></label>' +
    '<button type="submit">Use date</button></form><button type="button" class="text-action revision-latest"></button>';
  const year = dialog.querySelector('[data-year]'), list = dialog.querySelector('ul');
  const status = dialog.querySelector('[role=status]'), custom = dialog.querySelector('[name=day]');
  const latest = dialog.querySelector('.revision-latest');
  const find=dialog.querySelector('[data-find]'),more=dialog.querySelector('[data-more]');
  let entries = [], selectedDay = '',limit=16;
  function choose(day) {
    if (!isoDay(day)) return;
    dialog.close();
    onChoose(day);
  }
  function drawYear() {
    const annual=entries.filter(entry=>entry.year===year.value);
    dialog.querySelector('[data-find-label]').hidden=annual.length<=16&&!find.value;
    const term=fold(find.value),matches=annual.filter(e=>!term||fold(e.title+' '+e.edition).includes(term));
    more.hidden=matches.length<=limit;
    list.innerHTML = matches.slice(0,limit).map(entry =>
      '<li><button type="button" data-date="' + esc(entry.date) + '"><span><strong>' + esc(entry.title) +
      '</strong><span>' + esc(entry.edition) + '</span></span><small>' + esc(entry.basis + ' ' + dateLabel(entry.stamp)) +
      (entry.date !== entry.stamp ? '<br>In force from ' + dateLabel(entry.date) : '') +
      '</small></button></li>').join('')||(term?'<li>No editions match this wording.</li>':'');
  }
  function refresh() {
    if (!dialog.open) return;
    const flag = flagName();
    const revisions = getRevisions();
    entries = revisions || [];
    const years = [...new Set(entries.map(entry => entry.year))];
    const requested = year.value || selectedDay.slice(0, 4);
    dialog.querySelector('h2').textContent = flag ? 'Revision dates for ' + flag : 'Law date';
    year.innerHTML = years.map(value => '<option>' + value + '</option>').join('');
    if (years.length) year.value = years.find(value => value <= requested) || years.at(-1);
    year.parentElement.hidden = !years.length;
    status.textContent = !flag ? 'Choose a flag to see its indexed revisions.' : revisions === null ? 'Loading indexed editions…' :
      !years.length ? 'No dated editions are indexed for this flag.' : '';
    latest.textContent = 'Use latest indexed date · ' + dateLabel(latestDay());
    drawYear();
  }
  year.onchange=()=>{find.value='';limit=16;drawYear();};
  find.oninput=()=>{limit=16;drawYear();};more.onclick=()=>{limit+=16;drawYear();};
  list.onclick = event => { const button = event.target.closest('[data-date]'); if (button) choose(button.dataset.date); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = event => { event.preventDefault(); choose(custom.value); };
  latest.onclick = () => choose(latestDay());
  return {refresh, open(day) {
    selectedDay = day;
    custom.value = day;
    find.value='';limit=16;
    year.replaceChildren();
    dialog.showModal();
    refresh();
    (entries.length ? year : custom).focus();
  }};
}
