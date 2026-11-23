import {esc, excerpt, fold, marked, queryParts} from './model.js';
import {inspectPdf, listImports, openImportPdf, removeImport, revokeImportPdf, savePdf, saveText} from './imports.js';

function heading(section) {
  if (section.title === section.label || section.title === 'Original page ' + section.fromPage) return section.label;
  return [section.label, section.title].filter(Boolean).join(' · ');
}

export function createDocumentWorkspace(container, onChange) {
  const get = name => container.querySelector('#document-' + name);
  const form = container.querySelector('form');
  const file = get('file'), choice = get('choice'), status = get('status');
  const query = get('query'), from = get('from'), to = get('to');
  const hits = get('hits'), original = get('original'), wording = get('wording');
  const scanOriginal = get('scan-original');
  let documents = [], doc, index = [], selected, pdfUrl = '', visible = false, revision = 0;
  let originalRevision = 0;

  function releaseOriginal() {
    originalRevision++;
    revokeImportPdf(pdfUrl);
    pdfUrl = '';
    original.removeAttribute('href');
    original.hidden = true;
    scanOriginal.removeAttribute('href');
    scanOriginal.hidden = true;
  }

  function showOriginal() {
    original.hidden = !pdfUrl || !selected?.fromPage;
    if (original.hidden) return;
    original.href = pdfUrl.split('#')[0] + '#page=' + selected.fromPage;
    original.textContent = 'Open original page ' + selected.fromPage;
  }

  function read(section) {
    selected = section;
    for (const button of hits.children) button.setAttribute('aria-current', String(button.dataset.key === section.key));
    get('heading').textContent = heading(section);
    wording.innerHTML = marked(section.text || section.caveat || 'This passage has no embedded text.', query.value);
    showOriginal();
  }

  function filter() {
    if (!doc) return;
    const first = from.value ? from.valueAsNumber : 1;
    const last = to.value ? to.valueAsNumber : Number(to.max);
    const valid = from.validity.valid && to.validity.valid && first <= last;
    const parts = queryParts(query.value);
    const matches = valid ? index.filter(row => row.last >= first && row.first <= last &&
      parts.every(word => row.searchText.includes(word))) : [];
    get('count').textContent = !valid ? 'Enter a range from 1 to ' + to.max + ', with the lower number first.' :
      matches.length ? matches.length + ' of ' + index.length + (index.length === 1 ? ' passage' : ' passages') :
      'No passages match these filters.';
    hits.innerHTML = matches.map(({section}) => '<button type="button" class="result" data-key="' + esc(section.key) +
      '"><strong>' + marked(heading(section), query.value) + '</strong><span class="snippet">' +
      marked(excerpt(section.text, parts), query.value) + '</span></button>').join('');
    get('results').hidden = !matches.length;
    if (matches.length) read((matches.find(row => row.section === selected) || matches[0]).section);
    else { selected = undefined; wording.replaceChildren(); showOriginal(); }
  }

  function choose(id) {
    releaseOriginal();
    doc = documents.find(item => item.id === id) || documents[0];
    selected = undefined;
    form.reset();
    get('search').hidden = get('picker').hidden = !doc;
    if (!doc) { index = []; hits.replaceChildren(); wording.replaceChildren(); return; }
    choice.value = doc.id;
    const unit = doc.hasPdf ? 'page' : 'passage';
    get('from-label').textContent = 'From ' + unit;
    get('to-label').textContent = 'To ' + unit;
    from.max = to.max = String(doc.hasPdf ? doc.pageCount : doc.sections.length);
    from.placeholder = '1';
    to.placeholder = to.max;
    get('scan').hidden = !doc.hasPdf || doc.sections.every(section => section.text);
    index = doc.sections.map((section, i) => ({section, first: section.fromPage ?? i + 1,
      last: section.toPage ?? i + 1, searchText: fold(heading(section) + ' ' + section.text)}));
    filter();
    if (doc.hasPdf) {
      const turn = originalRevision;
      openImportPdf(doc.id).then(url => {
        if (turn !== originalRevision) { revokeImportPdf(url); return; }
        pdfUrl = url;
        scanOriginal.href = url;
        scanOriginal.hidden = false;
        showOriginal();
      }).catch(error => { if (turn === originalRevision) status.textContent = error.message; });
    }
  }

  async function reload(preferred) {
    const turn = ++revision;
    try {
      const saved = await listImports();
      if (!visible || turn !== revision) return;
      documents = saved;
      choice.replaceChildren(...documents.map(item => new Option(
        [item.title, item.date || (item.revision !== 'Imported edition' ? item.revision : '')].filter(Boolean).join(' · '), item.id)));
      choose(preferred);
      status.textContent = documents.length ? '' : 'Choose a file to add your first document.';
    } catch (error) {
      if (visible && turn === revision) status.textContent = error.message;
    }
  }

  file.onchange = async () => {
    const picked = file.files[0];
    if (!picked) return;
    file.disabled = true;
    try {
      let saved;
      status.textContent = 'Reading ' + picked.name + '…';
      if (/\.txt$/i.test(picked.name) || picked.type === 'text/plain') saved = await saveText(picked);
      else if (/\.pdf$/i.test(picked.name) || picked.type === 'application/pdf') {
        const inspection = await inspectPdf(picked, (page, total) => {
          status.textContent = 'Reading page ' + page + ' of ' + total + '…';
        });
        saved = await savePdf(picked, {}, inspection);
      } else throw new Error('Choose a PDF or a plain text (.txt) file.');
      await onChange();
      if (visible) {
        await reload(saved.id);
        if (doc?.id === saved.id) { status.textContent = 'Ready to search.'; query.focus(); }
      }
    } catch (error) { status.textContent = error.message; }
    finally { file.value = ''; file.disabled = false; }
  };

  get('remove').onclick = async () => {
    if (!doc || !confirm('Remove “' + doc.title + '” from this browser?')) return;
    try {
      await removeImport(doc.id);
      await onChange();
      if (visible) await reload(choice.value);
    } catch (error) { status.textContent = error.message; }
  };
  choice.onchange = () => choose(choice.value);
  form.onsubmit = event => { event.preventDefault(); filter(); };
  for (const control of [query, from, to]) control.oninput = filter;
  get('clear').onclick = () => { form.reset(); filter(); query.focus(); };
  hits.onclick = event => {
    const button = event.target.closest('button[data-key]');
    if (!button) return;
    read(doc.sections.find(section => section.key === button.dataset.key));
    if (matchMedia('(max-width:760px)').matches) get('heading').focus();
  };

  return {
    open() { visible = true; return reload(choice.value); },
    close() { visible = false; revision++; releaseOriginal(); },
  };
}
