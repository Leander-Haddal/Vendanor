import {esc, isoDay} from './model.js';

const displayDate = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'});
export function dateLabel(day) {
  return isoDay(day) ? displayDate.format(new Date(day + 'T00:00:00Z')) : '';
}

export function revisionDates(documents, values) {
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
  return rows.sort((a, b) => b.stamp.localeCompare(a.stamp) || a.title.localeCompare(b.title) || a.edition.localeCompare(b.edition));
}

export function mountRevisionPicker(dialog, {flagName, getRevisions, latestDay, onChoose}) {
  dialog.innerHTML = '<header><h2>Law date</h2><button type="button" data-close aria-label="Close date selector">Close</button></header>' +
    '<div class="revision-content"><label>Revision year<select data-year></select></label>' +
    '<p data-status role="status"></p><ul class="revision-list"></ul></div>' +
    '<form class="revision-custom"><label>Exact date<input type="date" required name="day"></label>' +
    '<button type="submit">Use date</button></form><button type="button" class="text-action revision-latest"></button>';
  const year = dialog.querySelector('[data-year]'), list = dialog.querySelector('ul');
  const status = dialog.querySelector('[role=status]'), custom = dialog.querySelector('[name=day]');
  const latest = dialog.querySelector('.revision-latest');
  let entries = [], selectedDay = '';
  function choose(day) {
    if (!isoDay(day)) return;
    dialog.close();
    onChoose(day);
  }
  function drawYear() {
    list.innerHTML = entries.filter(entry => entry.year === year.value).map(entry =>
      '<li><button type="button" data-date="' + esc(entry.date) + '"><span><strong>' + esc(entry.title) +
      '</strong><span>' + esc(entry.edition) + '</span></span><small>' + esc(entry.basis + ' ' + dateLabel(entry.stamp)) +
      (entry.date !== entry.stamp ? '<br>In force from ' + dateLabel(entry.date) : '') +
      '</small></button></li>').join('');
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
  year.onchange = drawYear;
  list.onclick = event => { const button = event.target.closest('[data-date]'); if (button) choose(button.dataset.date); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = event => { event.preventDefault(); choose(custom.value); };
  latest.onclick = () => choose(latestDay());
  return {refresh, open(day) {
    selectedDay = day;
    custom.value = day;
    year.replaceChildren();
    dialog.showModal();
    refresh();
    (entries.length ? year : custom).focus();
  }};
}
