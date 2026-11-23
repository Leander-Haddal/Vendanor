import {excerpt, fold, marked, queryParts, safeUrl} from './model.js';
import {originalPassageControl, pageCitation, sourceWording} from './boat-reader.js';
import {loadPdfBytes, openImportClip, revokeImportPdf} from './imports.js';

// Only open a clip when its excerpt is visible or a reader asks for it.
let printObserver;
const visibleActions = new WeakMap();
export function resetPrintPreviews() {
  printObserver?.disconnect();
}

function whenVisible(toggle, action) {
  printObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !entry.target.isConnected) continue;
      printObserver.unobserve(entry.target);
      visibleActions.get(entry.target)?.();
    }
  }, {rootMargin:'100px'});
  visibleActions.set(toggle, action);
  printObserver.observe(toggle);
}

function searchable(text) {
  return fold(text).replace(/[^\p{L}\p{N}]/gu, '');
}

function sourcePhrase(snippet, term) {
  const wholeWords = snippet.replace(/^…\S*\s*|\s*\S*…$/gu, '').trim();
  const normalized = fold(wholeWords);
  const hit = term ? normalized.indexOf(term) : -1;
  const start = hit > 0 ? Math.max(0, normalized.slice(0, hit).trim().split(' ').length - 2) : 0;
  return wholeWords.split(/\s+/u).slice(start, start + 10).join(' ');
}

async function locateWords(pdf, phrase, term) {
  const target = searchable(phrase), needle = searchable(term);
  let firstHit;
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const {items} = await page.getTextContent();
    const textItems = items.filter(item => item.str);
    const parts = textItems.map(item => searchable(item.str));
    const body = parts.join('');
    const phraseAt = target ? body.indexOf(target) : -1;
    const termAt = needle ? body.indexOf(needle) : -1;
    if (phraseAt < 0 && (termAt < 0 || firstHit)) continue;
    const at = phraseAt >= 0 ? phraseAt : termAt;
    let offset = 0, item = 0;
    while (item < parts.length && offset + parts[item].length <= at) {
      offset += parts[item].length;
      item++;
    }
    const hit = {index, line:textItems[item]};
    if (phraseAt >= 0) return hit;
    firstHit = hit;
  }
  return firstHit || {index:1};
}

async function printedPage(doc, section, width, phrase, term) {
  let localUrl, task;
  try {
    const source = section.clip ? safeUrl(section.clip, true) :
      (localUrl = await openImportClip(doc.version.localId, section.id));
    const response = await fetch(source);
    if (!response.ok) throw new Error('The printed excerpt could not be loaded.');
    task = await loadPdfBytes(new Uint8Array(await response.arrayBuffer()));
    const pdf = await task.promise;
    const hit = term ? await locateWords(pdf, phrase, term) : {index:1};
    const page = await pdf.getPage(hit.index);
    const size = page.getViewport({scale: 1});
    const scale = Math.min(width / size.width, 1.7);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({scale: scale * ratio});
    const canvas = document.createElement('canvas');
    // Keep the displayed strip around the matching line in long or multi-page clips.
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(Math.min(viewport.height, 235 * ratio));
    canvas.style.width = canvas.width / ratio + 'px';
    canvas.setAttribute('aria-hidden', 'true');
    const y = hit.line ? viewport.convertToViewportPoint(...hit.line.transform.slice(4))[1] : 0;
    const top = Math.max(0, Math.min(y - 50 * ratio, viewport.height - canvas.height));
    await page.render({canvas, viewport, transform:[1, 0, 0, 1, 0, -top]}).promise;
    const physicalPage = pdf.numPages === section.pages?.length ? section.pages[hit.index - 1] : section.pages?.[0];
    return {canvas, physicalPage};
  } finally {
    if (task) await task.destroy();
    if (localUrl) revokeImportPdf(localUrl);
  }
}

export function passagePreview(row, query) {
  const {doc, section} = row;
  const host = document.createElement('section');
  host.className = 'source-hunk';
  host.dataset.state = row.state;
  host.dataset.section = section.id;
  const wording = sourceWording(section, false, doc.instrument.title);
  const body = wording.paragraphs.join('\n\n') || section.text || '';
  const normalized = fold(body);
  const terms = queryParts(query).filter(term => normalized.includes(term));
  const snippet = excerpt(body, terms, 360);
  const phrase = sourcePhrase(snippet, terms[0]);

  const header = document.createElement('header');
  const title = document.createElement('h4');
  title.innerHTML = marked(wording.heading, query);
  const outcome = document.createElement('span');
  outcome.className = 'passage-outcome ' + row.state;
  outcome.textContent = row.state === 'match' ? 'Matches' : 'Needs checking';
  header.append(title, outcome);

  const feedback = document.createElement('p');
  feedback.setAttribute('role', 'status');
  feedback.className = 'preview-feedback';
  const hasPrint = section.clip || doc.version.hasPdf && doc.version.localId;
  const locateHit = hasPrint && terms.length && section.pages?.length > 1;
  let load;
  const {control:original, caption, setPage} = originalPassageControl(doc, section, phrase, feedback, locateHit ? () => load() : null);
  original.className = 'source-quote';
  const text = document.createElement('span');
  text.className = 'source-words';
  text.lang = doc.version.language || doc.instrument.language || '';
  text.innerHTML = marked(snippet || 'Open the original to read this passage.', query);
  original.replaceChildren(text, caption);

  const foot = document.createElement('footer');
  const edition = document.createElement('span');
  edition.className = 'excerpt-edition';
  edition.textContent = [doc.version.label, pageCitation(section.pages)].filter(Boolean).join(' · ');
  foot.append(edition);
  if (hasPrint) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Show printed excerpt';
    let canvas, loading;
    async function prepare() {
      const {canvas:printed, physicalPage} = await printedPage(doc, section, text.clientWidth || 640, phrase, terms[0]);
      setPage?.(physicalPage);
      canvas = printed;
      canvas.hidden = true;
      original.insertBefore(canvas, caption);
      return physicalPage;
    }
    load = () => {
      loading ??= prepare().catch(error => {
        loading = null;
        throw error;
      });
      return loading;
    };
    toggle.onclick = async () => {
      printObserver?.unobserve(toggle);
      if (!canvas) {
        toggle.disabled = true;
        feedback.textContent = 'Opening printed excerpt…';
        try {
          await load();
          feedback.textContent = '';
        } catch {
          feedback.textContent = 'The printed preview is unavailable. You can still open the original.';
          return;
        } finally { toggle.disabled = false; }
      }
      const printed = !text.classList.contains('transcript-only');
      toggle.textContent = printed ? 'Show text excerpt' : 'Show printed excerpt';
      text.classList.toggle('transcript-only', printed);
      canvas.hidden = !printed;
    };
    foot.append(toggle);
    if (!query.trim() && matchMedia('(min-width:761px)').matches) whenVisible(toggle, () => toggle.click());
    else if (locateHit) whenVisible(toggle, () => load().catch(() => {}));
  }
  const details = document.createElement('a');
  details.href = '#boat-passage?' + new URLSearchParams({doc: doc.key, section: section.id});
  details.textContent = 'Passage details';
  details.dataset.readPassage = '';
  details.dataset.doc = doc.key;
  details.dataset.section = section.id;
  foot.append(details);
  host.append(header, original, foot, feedback);
  return host;
}
