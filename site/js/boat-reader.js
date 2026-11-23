import {assess, describeRule, evidenceRows, isoDay, safeUrl, statusLabel} from './model.js';
import {openImportClip, openImportPdf, revokeImportPdf} from './imports.js';
import {archiveExcerpt} from './verified-pdf.js';

const printedDate = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});

function node(tag, text = '', className = '') {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function address(value, local = false) {
  if (!local && !/^https?:\/\//i.test(value || '')) return '';
  const valid = safeUrl(value, local);
  if (!valid) return '';
  const parsed = new URL(valid);
  return parsed.username || parsed.password ? '' : parsed.href;
}

function external(label, href) {
  const item = node('a', label);
  item.href = href;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';
  return item;
}

function sourceName(href) {
  const host = new URL(href).hostname.replace(/^www\./, '');
  const publications = {'lovdata.no': 'Lovdata', 'sdir.no': 'Norwegian Maritime Authority',
    'eur-lex.europa.eu': 'EUR-Lex', 'publications.europa.eu': 'EU Publications Office',
    'faolex.fao.org': 'FAOLEX', 'fao.org': 'FAOLEX', 'govinfo.gov': 'U.S. Government Publishing Office',
    'legislation.gov.uk': 'The National Archives', 'maritimenz.govt.nz': 'Maritime New Zealand',
    'wwwcdn.imo.org': 'International Maritime Organization', 'treaties.un.org': 'United Nations Treaty Collection',
    'ilo.org': 'International Labour Organization', 'normlex.ilo.org': 'ILO NORMLEX',
    'gov.uk': 'UK Government', 'navcen.uscg.gov': 'U.S. Coast Guard Navigation Center'};
  return publications[host] || host;
}

function displayDate(value) {
  return isoDay(value) ? printedDate.format(new Date(value + 'T00:00:00Z')) : '';
}

function supportingTitle(url) {
  const site = new URL(url);
  if (site.hostname === 'treaties.un.org') return /actiondetails/i.test(site.pathname) ? 'UN Treaty Collection · treaty action' : 'UN Treaty Collection · treaty registration';
  if (site.hostname === 'verdragenbank.overheid.nl') return 'Netherlands Treaty Database · participating parties';
  if (site.hostname === 'normlex.ilo.org' && site.search.includes('11300:')) return 'ILO NORMLEX · ratifications';
  if (site.hostname === 'creativecommons.org') return 'Creative Commons · licence terms';
  let name = site.pathname.split('/').filter(Boolean).at(-1) || '';
  try { name = decodeURIComponent(name); } catch { /* Keep the path sent by the publisher. */ }
  return [sourceName(url), name.replace(/[_-]/g, ' ')].filter(Boolean).join(' · ');
}

function pageCitation(numbers) {
  const pages = [...new Set((numbers || []).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i];
    while (pages[i + 1] === pages[i] + 1) i++;
    ranges.push(start === pages[i] ? String(start) : start + '–' + pages[i]);
  }
  return ranges.length ? (pages.length === 1 ? 'page ' : 'pages ') + ranges.join(', ') : '';
}

function sourceWording(section, catalogue, documentTitle) {
  let text = String(section.text || '').trim();
  if (catalogue) return {heading: documentTitle, paragraphs: text.split(/\n\s*\n/).filter(p => p && p !== documentTitle)};
  const number = section.number || section.label || '';
  const title = section.title || '';
  const first = text.split('\n', 1)[0].trim();
  const compare = value => String(value).normalize('NFC').replace(/[\s.·]+/g, ' ').trim().toLocaleLowerCase();
  let heading = number || title || 'Source passage';
  if (first && [number, title, [number, title].filter(Boolean).join(' ')].some(value => value && compare(value) === compare(first))) {
    heading = number && compare(first) === compare(title) && compare(number) !== compare(title) ? number + ' · ' + first : first;
    text = text.slice(text.indexOf(first) + first.length).trimStart();
  } else if (number && title && !number.toLowerCase().includes(title.toLowerCase())) {
    heading = number + ' · ' + title;
  }
  // Split only at the source's paragraph boundaries or numbered subsection starts.
  const paragraphs = text.split(/\n[ \t]*\n+|\n(?=\(\d+[a-z]?\)\s)/u).filter(p => p.trim());
  return {heading, paragraphs};
}

function wordingBlock(paragraphs, language, catalogue) {
  const content = node('section', '', 'boat-passage__wording');
  content.dataset.boatWording = '';
  if (language) content.lang = language;
  if (catalogue) content.append(node('h3', 'Catalogue description'));
  if (!paragraphs.length) {
    content.append(node('p', 'Use the original source to read this passage.'));
    return content;
  }
  const count = paragraphs.length > 3 && paragraphs.join('\n\n').length > 1800 ? 2 : paragraphs.length;
  for (const paragraph of paragraphs.slice(0, count)) content.append(node('p', paragraph));
  if (count < paragraphs.length) {
    const rest = node('details', '', 'boat-passage__continuation');
    rest.dataset.boatContinue = '';
    rest.append(node('summary', 'Continue reading · ' + (paragraphs.length - count) + ' more paragraphs'));
    for (const paragraph of paragraphs.slice(count)) rest.append(node('p', paragraph));
    content.append(rest);
  }
  return content;
}

function pdfControl(label, href, generate, feedback) {
  if (!generate) return external(label, href);
  const button = node('button', label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    const tab = window.open('about:blank', '_blank');
    if (tab) {
      tab.opener = null;
      tab.document.title = 'Source PDF';
      tab.document.body.textContent = 'Opening source PDF…';
    }
    button.disabled = true;
    feedback.textContent = 'Opening source PDF…';
    try {
      const blob = await generate();
      if (tab && !tab.closed) {
        tab.location.replace(blob);
        feedback.textContent = '';
      } else {
        const link = external('Open the prepared PDF', blob);
        feedback.replaceChildren(link);
      }
      window.setTimeout(() => revokeImportPdf(blob), 120000);
    } catch (error) {
      if (tab && !tab.closed) tab.close();
      feedback.textContent = error.message || 'The source PDF could not be opened.';
    } finally { button.disabled = false; }
  });
  return button;
}

function conditions(section, version, profile, fields) {
  if (!section.criteria && !section.survey) return null;
  const detail = node('details', '', 'boat-passage__disclosure');
  detail.dataset.boatEvidence = '';
  detail.append(node('summary', 'How this passage was matched'));
  const value = assess(section, version, profile.values, profile.asOf);
  detail.append(node('p', statusLabel(value), 'boat-passage__condition-state'));
  if (section.criteria) {
    detail.append(node('p', describeRule(section.criteria, fields)));
    const evidence = node('dl', '', 'boat-passage__conditions');
    for (const row of evidenceRows(section.criteria, fields, profile.values)) {
      const group = node('div');
      group.append(node('dt', row.condition), node('dd', 'Your boat · ' + row.entered));
      if (row.source) group.append(node('dd', row.source, 'boat-passage__citation'));
      evidence.append(group);
    }
    detail.append(evidence);
  }
  const survey = section.survey, entered = displayDate(profile.values.lastSurveyDate);
  if (survey && entered) {
    const parts = ['Last survey entered ' + entered];
    if (survey.qualifying) parts.push(survey.qualifying);
    if (Number.isFinite(survey.intervalMonths)) parts.push('Interval ' + survey.intervalMonths + ' months');
    if (survey.source) parts.push(survey.source);
    detail.append(node('p', parts.join(' · ')));
  }
  return detail;
}

export function renderBoatPassage(container, {doc, section, profile = {}, fields = [], onBack, onLibrary}) {
  const {version, instrument} = doc;
  const catalogue = doc.type === 'world';
  const local = Boolean(version.localId && version.hasPdf);
  const original = address(version.pdf, true) || address(version.pdfUrl);
  const published = address(section.sourceUrl) || address(version.sourcePage) || address(version.sourceUrl);
  const clip = address(section.clip, true);
  const bands = doc.original?.sourceShard === doc.meta?.shard ? section.bands : null;
  const pages = section.pages || [];
  const citation = pageCitation(pages);
  const docTitle = instrument.title || version.label || 'Source document';
  const wording = sourceWording(section, catalogue, docTitle);
  const article = node('article', '', 'boat-passage');
  article.setAttribute('aria-labelledby', 'boat-passage-heading');
  const back = node('button', '← Back to results', 'boat-passage__back');
  back.type = 'button';
  back.dataset.boatBack = '';
  back.onclick = () => onBack?.();
  article.append(back);
  const paper = node('div', '', 'boat-passage__paper');
  article.append(paper);
  const header = node('header', '', 'boat-passage__header');
  if (!catalogue) header.append(node('p', docTitle, 'boat-passage__instrument'));
  const heading = node('h2', wording.heading);
  heading.id = 'boat-passage-heading';
  heading.tabIndex = -1;
  header.append(heading);
  const byline = node('p', '', 'boat-passage__byline');
  const source = published ? sourceName(published) : '';
  if (instrument.authority && instrument.authority !== source) byline.append(node('span', instrument.authority));
  if (published) {
    const publisher = external(source, published);
    publisher.dataset.boatPublisher = '';
    byline.append(publisher);
  }
  const posted = displayDate(version.publishedOn);
  if (posted) byline.append(node('span', 'Published ' + posted));
  else if (displayDate(version.editionDate)) byline.append(node('span', 'Edition of ' + displayDate(version.editionDate)));
  if (byline.childElementCount) header.append(byline);
  const feedback = node('p', '', 'boat-passage__feedback');
  feedback.setAttribute('role', 'status');
  let originalAtPage = original;
  if (original && pages.length && Number.isInteger(pages[0]) && pages[0] > 0) {
    const url = new URL(original);
    url.hash = 'page=' + pages[0];
    originalAtPage = url.href;
  }
  const generate = local ? () => openImportClip(version.localId, section.id) :
    bands?.length ? () => archiveExcerpt(doc.original, bands) : null;
  if (clip || generate || original) {
    const excerpt = Boolean(clip || generate);
    const label = (excerpt ? 'Open PDF excerpt' : 'Open original PDF') + (citation ? ' · ' + citation : '');
    const primary = pdfControl(label, clip || originalAtPage, clip ? null : generate, feedback);
    primary.dataset.boatPdf = '';
    primary.className = 'boat-passage__pdf';
    header.append(primary);
  }
  header.append(feedback);
  paper.append(header, wordingBlock(wording.paragraphs, version.language || instrument.language, catalogue));
  if (section.caveat) {
    const scope = node('aside', '', 'boat-passage__scope');
    scope.dataset.boatCaveat = '';
    scope.append(node('h3', catalogue ? 'Source context' : 'Scope note'), node('p', String(section.caveat)));
    paper.append(scope);
  }
  const match = conditions(section, version, {values: profile.values || {}, asOf: profile.asOf || ''}, fields);
  const flag = version.flagEvidence;
  const flagSource = address(flag?.sourceUrl);
  if (flagSource) {
    const record = node('p', '', 'boat-passage__flag');
    const name = flag.sourceName || flag.flag;
    const label = [name, flag.kind, flag.effectiveFrom && 'effective ' + displayDate(flag.effectiveFrom)].filter(Boolean).join(' · ');
    const link = external('Flag record' + (label ? ' · ' + label : ''), flagSource);
    link.dataset.boatFlagSource = '';
    record.append(link);
    paper.append(record);
  }
  if (match) paper.append(match);
  const history = node('details', '', 'boat-passage__disclosure');
  history.append(node('summary', 'Edition and sources'));
  const editionFacts = [version.label, doc.meta?.legalId, version.effectiveFrom && 'Effective from ' + displayDate(version.effectiveFrom),
    version.effectiveTo && 'Effective until ' + displayDate(version.effectiveTo) + ' (exclusive)',
    version.verifiedThrough && 'Checked through ' + displayDate(version.verifiedThrough)].filter(Boolean);
  if (editionFacts.length) history.append(node('p', [...new Set(editionFacts)].join(' · ')));
  for (const note of [version.notes || []].flat()) if (typeof note === 'string' && note) history.append(node('p', note));
  if (doc.meta?.effectiveText) history.append(node('p', 'Publisher commencement text · ' + doc.meta.effectiveText));
  if (original || local) {
    const full = pdfControl('Open complete original PDF', original, local ? () => openImportPdf(version.localId) : null, feedback);
    full.dataset.boatFullPdf = '';
    history.append(full);
  }
  if (version.pdfSha256) history.append(node('p', 'PDF SHA-256 · ' + version.pdfSha256, 'boat-passage__fingerprint'));
  const links = [...new Set((version.sourceLinks || []).map(url => address(url)).filter(url => url && ![published, original, flagSource, address(version.sourceUrl)].includes(url)))];
  if (links.length) {
    const refs = node('ul', '', 'boat-passage__sources');
    for (const url of links) {
      const li = node('li');
      li.append(external(supportingTitle(url), url));
      refs.append(li);
    }
    history.append(refs);
  }
  if (history.childElementCount > 1) paper.append(history);
  if (onLibrary) {
    const library = node('button', 'Open in library', 'boat-passage__library');
    library.type = 'button';
    library.dataset.boatLibrary = '';
    library.onclick = () => onLibrary();
    paper.append(library);
  }
  container.replaceChildren(article);
  heading.focus({preventScroll: true});
  if (article.getBoundingClientRect().top < 0) article.scrollIntoView({block: 'start'});
}
