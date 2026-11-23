import { cropTopToBottom, importLimits, inspectPdf } from './imports.js';

const resultPageSize = 20;
let dismissActive;

export function publicPdfUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    if (!/^\[[23][0-9a-f]{3}:/.test(host) || /^\[(?:2002:|3fff:|2001:(?:db8|0|10|20):)/i.test(host)) return '';
  } else if (/^[\d.]+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 88 && c === 99)) ||
        (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113)) return '';
  } else if (!host.includes('.') || /(?:\.home\.arpa|\.(?:localhost|localdomain|local|internal|intranet|lan|home|test|invalid|example|onion))$/.test(host)) {
    return '';
  }
  url.hash = '';
  return url.href;
}

export async function fetchLinkedPdf(value, signal) {
  const url = publicPdfUrl(value);
  if (!url) throw new Error('Choose a public HTTPS publisher link.');
  let response;
  try {
    response = await fetch(url, { signal, mode: 'cors', credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('The publisher did not allow a direct browser download. Open its link and choose the downloaded PDF.');
  }
  if (!response.ok || !response.body) throw new Error('The linked PDF could not be read. Choose a downloaded copy.');
  if (Number(response.headers.get('Content-Length')) > importLimits.pdfBytes) {
    await response.body.cancel();
    throw new Error('The linked original exceeds 24 MiB.');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let count = 0;
  try {
    while (true) {
      const {done, value: chunk} = await reader.read();
      if (done) break;
      count += chunk.byteLength;
      if (count > importLimits.pdfBytes) {
        await reader.cancel();
        throw new Error('The linked original exceeds 24 MiB.');
      }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type: 'application/pdf' });
}

function folded(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

export function indexPassageLines(pages) {
  const lines = [], words = [];
  let offset = 0;
  for (const page of pages) {
    for (let row = 0; row < page.lines.length; row++) {
      const source = page.lines[row], value = folded(source.text);
      if (!value) continue;
      lines.push({ start: offset, page: page.page, row, source });
      words.push(value);
      offset += value.length + 1;
    }
  }
  return { pages, lines, text: words.join(' ') };
}

export function findPassages(book, query) {
  const phrase = folded(query), hits = [];
  if (!phrase) return hits;
  let first = 0, last = 0;
  let at = book.text.indexOf(phrase);
  while (at !== -1) {
    while (book.lines[first + 1]?.start <= at) first++;
    const end = at + phrase.length - 1;
    last = Math.max(first, last);
    while (book.lines[last + 1]?.start <= end) last++;
    const previous = hits.at(-1);
    if (previous?.first !== first || previous.last !== last) hits.push({first, last});
    const nextStart = !phrase.includes(' ') && first === last ? book.lines[first + 1]?.start ?? book.text.length : at + 1;
    at = book.text.indexOf(phrase, nextStart);
  }
  return hits;
}

export function passageContext(book, hit, radius) {
  if (!Number.isInteger(radius) || radius < 0 || radius > 10 ||
      !book.lines[hit.first] || !book.lines[hit.last] || hit.first > hit.last) throw new Error('Invalid passage selection.');
  const firstPage = book.lines[hit.first].page, lastPage = book.lines[hit.last].page;
  let first = hit.first, last = hit.last;
  while (first > hit.first - radius && book.lines[first - 1]?.page === firstPage) first--;
  while (last < hit.last + radius && book.lines[last + 1]?.page === lastPage) last++;
  return book.lines.slice(first, last + 1);
}

export function passageBands(book, selection) {
  const bands = [];
  for (const page of book.pages) {
    const rows = new Set(selection.filter(line => line.page === page.page).map(line => line.row));
    if (!rows.size) continue;
    if (![0, 90, 180, 270].includes(((page.rotation % 360) + 360) % 360)) {
      throw new Error('Open the original page to review this page orientation.');
    }
    const measured = page.lines.map((line, index) => ({line, index})).filter(({line}) => line.text.trim());
    if (!measured.every(({line}) => Number.isFinite(line.top) && Number.isFinite(line.bottom) &&
        line.top >= 0 && line.top < line.bottom && line.bottom <= 1)) {
      throw new Error('This page has text with uncertain print positions. Open the original page to review it.');
    }
    const selected = measured.filter(({index}) => rows.has(index));
    const top = Math.min(...selected.map(({line}) => line.top));
    const bottom = Math.max(...selected.map(({line}) => line.bottom));
    if (measured.some(({line, index}) => !rows.has(index) && line.bottom > top && line.top < bottom)) {
      throw new Error('The selected lines overlap other printed text. Include more context or open the original page.');
    }
    bands.push({page: page.page, top, bottom});
  }
  if (!bands.length) throw new Error('Select a passage with visible source lines.');
  return bands;
}

export async function makePassagePdf(file, bands, title, fingerprint) {
  const {PDFDocument} = await import('../vendor/pdf-lib.mjs');
  const original = await PDFDocument.load(await file.arrayBuffer(), {updateMetadata: false});
  const excerpt = await PDFDocument.create({updateMetadata: false});
  for (const band of bands) {
    if (!Number.isInteger(band.page) || band.page < 1 || band.page > original.getPageCount() ||
        !(band.top >= 0 && band.bottom <= 1 && band.top < band.bottom)) throw new Error('Invalid source page or bounds.');
    const [page] = await excerpt.copyPages(original, [band.page - 1]);
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle)) throw new Error('Unsupported PDF page rotation.');
    const media = page.getMediaBox(), box = page.getCropBox();
    const x = Math.max(box.x, media.x), y = Math.max(box.y, media.y);
    const width = Math.min(box.x + box.width, media.x + media.width) - x;
    const height = Math.min(box.y + box.height, media.y + media.height) - y;
    if (!(width > 0 && height > 0)) throw new Error('The PDF has inconsistent page boundaries.');
    page.setCropBox(x, y, width, height);
    cropTopToBottom(page, band.top, band.bottom);
    excerpt.addPage(page);
  }
  if (!bands.length) throw new Error('No source pages selected.');
  excerpt.setTitle(title + ' · selected passage');
  excerpt.setSubject('Original pages ' + bands.map(band => band.page).join(', ') + ' · SHA-256 ' + fingerprint);
  return new Blob([await excerpt.save()], {type: 'application/pdf'});
}

function makeElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function openPassageFinder({url, title = 'Original PDF', query = '', sourceText = '', file} = {}) {
  dismissActive?.();
  const dialog = document.createElement('dialog');
  dialog.id = 'passage-finder';
  dialog.className = 'passage-dialog';
  dialog.setAttribute('aria-labelledby', 'passage-heading');
  dialog.innerHTML = `
    <header class="dialog-head"><div><h2 id="passage-heading">Find a PDF passage</h2><p data-title></p></div>
      <button type="button" data-dismiss>Close</button></header>
    <div class="passage-body stack">
      <div class="actions"><button type="button" data-remote hidden>Load linked PDF</button>
        <a data-publisher target="_blank" rel="noopener noreferrer" hidden>Open publisher PDF</a>
        <label>Choose original PDF<input data-file type="file" accept=".pdf,application/pdf"></label></div>
      <details data-record hidden><summary>Text from this catalogue record</summary><p class="passage-source-text" data-record-text></p></details>
      <p class="small" data-progress role="status">Choose a PDF to search on this device.</p>
      <details data-fingerprint hidden><summary>Original source details</summary><p data-file-name></p><code data-sha></code></details>
      <label>Word or phrase<input data-query type="search" maxlength="300" placeholder="Search original wording"></label>
      <p class="small" data-count role="status"></p>
      <div class="passage-columns"><div><ol class="passage-results" data-results></ol>
        <div class="actions" data-nav hidden><button data-previous type="button">Previous results</button>
        <button data-next type="button">Next results</button></div></div>
        <section class="passage-detail stack" data-detail hidden><h3 data-pages></h3>
        <label>Surrounding lines<select data-context><option value="0">Matched lines only</option>
          <option value="1">1 line each side</option><option value="2" selected>2 lines each side</option>
          <option value="5">5 lines each side</option><option value="10">10 lines each side</option></select></label>
        <div class="passage-context" data-lines></div>
        <div class="actions"><a class="button" data-original target="_blank" rel="noopener">Open original page</a>
          <button class="primary" data-create type="button">Create excerpt PDF</button></div>
        <p class="small" data-clip-status role="status"></p>
        <div class="actions" data-downloads hidden><a data-open-clip class="button" target="_blank" rel="noopener">Open excerpt</a>
          <a data-download>Download excerpt PDF</a></div></section></div>
      <a data-all-pages target="_blank" rel="noopener" hidden>Open complete original PDF</a>
    </div>`;
  const element = name => dialog.querySelector('[data-' + name + ']');
  let revision = 0, choice = 0, offset = 0, clipVersion = 0, closed = false;
  let remoteRequest, timer, currentFile, inspection, book, hits = [], bands = [], sourceBlobUrl, clipBlobUrl;
  const remote = publicPdfUrl(url);
  element('title').textContent = String(title);
  element('query').value = String(query || '').slice(0, 300);
  if (sourceText) {
    element('record-text').textContent = String(sourceText);
    element('record').hidden = false;
  }
  if (remote) {
    element('publisher').href = remote;
    element('publisher').hidden = element('remote').hidden = false;
  }
  function clearClip() {
    clipVersion++;
    if (clipBlobUrl) URL.revokeObjectURL(clipBlobUrl);
    clipBlobUrl = undefined;
    bands = [];
    element('downloads').hidden = true;
    element('clip-status').textContent = '';
  }
  function release() {
    if (closed) return;
    closed = true;
    revision++;
    remoteRequest?.abort();
    clearTimeout(timer);
    clearClip();
    if (sourceBlobUrl) URL.revokeObjectURL(sourceBlobUrl);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (dismissActive === release) dismissActive = undefined;
  }
  function showSelection() {
    clearClip();
    const hit = hits[choice];
    element('detail').hidden = !hit;
    if (!hit) return;
    const selected = passageContext(book, hit, Number(element('context').value));
    const firstPage = selected[0].page, finalPage = selected.at(-1).page;
    element('pages').textContent = firstPage === finalPage ? 'Original page ' + firstPage : 'Original pages ' + firstPage + '–' + finalPage;
    element('original').href = sourceBlobUrl + '#page=' + firstPage;
    const nodes = [];
    let lastPage;
    for (const line of selected) {
      if (firstPage !== finalPage && lastPage !== line.page) nodes.push(makeElement('strong', 'Page ' + line.page));
      const match = line.start >= book.lines[hit.first].start && line.start <= book.lines[hit.last].start;
      nodes.push(makeElement('p', line.source.text, match ? 'passage-hit' : 'passage-neighbour'));
      lastPage = line.page;
    }
    element('lines').replaceChildren(...nodes);
    try { bands = passageBands(book, selected); element('create').disabled = false; }
    catch (error) { element('create').disabled = true; element('clip-status').textContent = error.message; }
  }
  function showResults() {
    const results = element('results');
    results.start = offset + 1;
    results.replaceChildren();
    for (const [i, hit] of hits.slice(offset, offset + resultPageSize).entries()) {
      const line = book.lines[hit.first], number = i + offset;
      const button = makeElement('button', 'Page ' + line.page + ' · ' + line.source.text, 'passage-result');
      button.type = 'button';
      button.dataset.hit = String(number);
      button.setAttribute('aria-pressed', String(number === choice));
      const item = document.createElement('li');
      item.append(button);
      results.append(item);
    }
    element('nav').hidden = hits.length <= resultPageSize;
    element('previous').disabled = offset === 0;
    element('next').disabled = offset + resultPageSize >= hits.length;
  }
  function search() {
    const value = element('query').value;
    hits = book ? findPassages(book, value) : [];
    choice = offset = 0;
    element('count').textContent = !book || !folded(value) ? '' :
      hits.length ? hits.length + (hits.length === 1 ? ' matching passage' : ' matching passages') : 'No matching wording in the embedded text.';
    showResults();
    showSelection();
  }
  async function loadSource(picked) {
    const turn = ++revision;
    remoteRequest?.abort();
    remoteRequest = new AbortController();
    const signal = remoteRequest.signal;
    clearTimeout(timer);
    book = currentFile = inspection = undefined;
    if (sourceBlobUrl) URL.revokeObjectURL(sourceBlobUrl);
    sourceBlobUrl = undefined;
    element('all-pages').hidden = element('fingerprint').hidden = true;
    search();
    element('progress').textContent = picked ? 'Reading the original PDF…' : 'Downloading the linked PDF…';
    try {
      const blob = picked || await fetchLinkedPdf(remote, signal);
      if (turn !== revision) return;
      const data = await inspectPdf(blob, (page, total) => {
        if (turn !== revision) throw new DOMException('Passage finder closed.', 'AbortError');
        element('progress').textContent = 'Reading original page ' + page + ' of ' + total + '…';
      });
      if (turn !== revision) return;
      currentFile = blob;
      inspection = data;
      book = indexPassageLines(data.pages);
      sourceBlobUrl = URL.createObjectURL(blob.slice(0, blob.size, 'application/pdf'));
      element('all-pages').href = sourceBlobUrl;
      element('all-pages').hidden = element('fingerprint').hidden = false;
      element('file-name').textContent = picked ? 'Local original · ' + (blob.name || title) : remote;
      element('sha').textContent = 'SHA-256 ' + data.sha256;
      const readable = data.pages.filter(page => page.text.trim()).length;
      element('progress').textContent = readable ? 'Searchable text on ' + readable + ' of ' + data.pageCount + ' original pages.' :
        'This PDF has no embedded text. Open the complete original to read its scanned pages.';
      search();
    } catch (error) {
      if (turn === revision) element('progress').textContent = error.message;
    }
  }
  async function createExcerpt() {
    if (!currentFile || !bands.length) return;
    const token = ++clipVersion;
    element('create').disabled = true;
    element('clip-status').textContent = 'Preparing the source excerpt…';
    try {
      const blob = await makePassagePdf(currentFile, bands, String(title), inspection.sha256);
      if (token !== clipVersion) return;
      if (clipBlobUrl) URL.revokeObjectURL(clipBlobUrl);
      clipBlobUrl = URL.createObjectURL(blob);
      element('open-clip').href = element('download').href = clipBlobUrl;
      element('download').download = 'passage-page-' + bands[0].page + '.pdf';
      element('downloads').hidden = false;
      element('clip-status').textContent = 'Excerpt ready from the selected printed lines.';
    } catch (error) {
      if (token === clipVersion) element('clip-status').textContent = error.message;
    } finally { if (token === clipVersion) element('create').disabled = false; }
  }
  element('dismiss').onclick = release;
  dialog.onclose = release;
  element('remote').onclick = () => loadSource();
  element('file').onchange = event => {
    const picked = event.target.files[0];
    event.target.value = '';
    if (picked) loadSource(picked);
  };
  element('query').oninput = () => { clearTimeout(timer); timer = setTimeout(search, 140); };
  element('context').onchange = showSelection;
  element('results').onclick = event => {
    const button = event.target.closest('[data-hit]');
    if (button) { choice = Number(button.dataset.hit); showResults(); showSelection(); }
  };
  element('previous').onclick = () => { offset -= resultPageSize; choice = offset; showResults(); showSelection(); };
  element('next').onclick = () => { offset += resultPageSize; choice = offset; showResults(); showSelection(); };
  element('create').onclick = createExcerpt;
  dismissActive = release;
  document.body.append(dialog);
  dialog.showModal();
  if (file instanceof Blob) loadSource(file);
  return dialog;
}
