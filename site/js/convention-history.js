import {esc, fold} from './model.js';
import {link} from './reader.js';

export function conventionMarks(book, instrument, code) {
  const data = book.participation;
  const participant = data?.byFlag?.[code] || data?.organizations?.[code];
  if (!participant) return [];
  return (instrument.participationKeys || []).flatMap(key => {
    const column = data.columns.find(c => c.key === key);
    if (!column) return [];
    if (participant.denounced?.includes(key)) return [{label: column.label, meaning: 'Denunciation recorded'}];
    if (participant.ratified?.includes(key)) return [{label: column.label, meaning: 'Ratification or accession recorded'}];
    return [];
  });
}

function statusEntries(book, instrument, code) {
  const participation = book.participation;
  if (!code || !participation || !instrument.participationKeys?.length) return '';
  const participant = participation.byFlag?.[code] || participation.organizations?.[code];
  const marks = conventionMarks(book, instrument, code);
  const result = marks.length
    ? '<ul>' + marks.map(mark => '<li>' + esc(mark.label) + ' · ' + esc(mark.meaning) + '</li>').join('') + '</ul>'
    : '<p>' + esc(participant ? 'The selected treaty columns have no recorded mark for this participant.' : 'The workbook has no separate row for this flag.') + '</p>';
  const locator = participant ? ' · row ' + participant.row : '';
  return '<div><h4>' + esc(participant?.name || code) + ' · treaty participation</h4>' + result +
    link('IMO State workbook · ' + participation.asOf + locator, participation.sourceUrl, true) + '</div>';
}

function searchEntry(record) {
  return fold([record.label, record.date, record.status, record.note, ...(record.resolutions || [])].filter(Boolean).join(' '));
}

function eventRow(record, book, code) {
  let state = record.date ? '<span>' + esc(record.date) + '</span>' : '';
  if (record.status) state += '<span>' + esc(record.status) + '</span>';
  if (record.reportedDates?.length) state += '<span>' + esc(record.reportedDates.join(' · ')) + '</span>';
  if (record.note) state += '<p>' + esc(record.note) + '</p>';
  const where = record.page ? 'Status book ' + (record.volume === 1 ? 'I' : 'II') + ' · p. ' + record.page :
    record.sourceParagraph ? 'Chronology · paragraph ' + record.sourceParagraph : 'Publisher record';
  const mark = record.participationKeys?.length ? conventionMarks(book, record, code) : [];
  if (mark.length) state += '<p>' + mark.map(m => esc(m.label + ' · ' + m.meaning)).join(' / ') + '</p>';
  return '<li><strong>' + esc(record.label) + '</strong>' + state + ' ' + link(where, record.sourceUrl, true) + '</li>';
}

export function renderConventionHistory(host, book, code, selectedId = '') {
  if (!book?.instruments?.length) return;
  const source = book.source || {}, items = book.instruments;
  host.innerHTML = '<h2>International treaties and amendments</h2><p>' +
    esc('IMO chronology as at ' + source.asOf + '. Status books and State participation as at ' + book.participation.asOf + '.') +
    '</p><div class="owner-grid"><label>Find a convention or amendment<input type="search" data-find placeholder="Convention, resolution or year"></label>' +
    '<label>Convention<select data-choice><option value="">Choose an instrument</option></select></label></div><div data-history></div>';
  const input = host.querySelector('[data-find]'), select = host.querySelector('[data-choice]'), detail = host.querySelector('[data-history]');
  function show() {
    const item = items.find(i => i.id === select.value);
    if (!item) { detail.replaceChildren(); return; }
    const term = fold(input.value);
    const all = item.entries || [];
    const rows = !term || fold(item.title + ' ' + item.id).includes(term) ? all : all.filter(entry => searchEntry(entry).includes(term));
    const bookLink = item.page ? link('Status book ' + (item.volume === 1 ? 'I' : 'II') + ' · p. ' + item.page, item.sourceUrl, true) : '';
    const other = Object.keys(book.participation.organizations || {}).filter(key => key !== code && conventionMarks(book, item, key).length);
    detail.innerHTML = '<div class="convention-detail"><h3>' + esc(item.title) + '</h3>' + statusEntries(book, item, code) +
      (other.length ? '<details><summary>Participation by an organisation</summary>' + other.map(key => statusEntries(book, item, key)).join('') + '</details>' : '') +
      '<div class="owner-actions">' + link('Original IMO chronology (Word)', source.chronologyUrl, true) + bookLink + '</div>' +
      '<ol class="edition-list">' + rows.map(entry => eventRow(entry, book, code)).join('') + '</ol></div>';
  }
  function filter() {
    const current = select.value;
    const term = fold(input.value);
    const eligible = items.filter(item => fold(item.title + ' ' + item.id).includes(term) || item.entries?.some(entry => searchEntry(entry).includes(term)));
    select.innerHTML = '<option value="">Choose an instrument</option>' + eligible.map(item => '<option value="' + esc(item.id) + '">' + esc(item.title) + '</option>').join('');
    if (eligible.some(item => item.id === current)) select.value = current;
    else if (eligible.length === 1) select.selectedIndex = 1;
    show();
    if (!eligible.length) detail.textContent = 'No convention or amendment matches those words.';
  }
  input.oninput = filter;
  select.onchange = show;
  filter();
  if(items.some(item=>item.id===selectedId)){select.value=selectedId;show();}
}
