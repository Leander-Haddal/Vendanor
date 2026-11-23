import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {checkBoatJourney, checkPhoneBoat, checkSavedLookup, checkTreatyBoat} from './boat-browser.mjs';
import {checkLawHistory,checkOwnerSourceSearch} from './history-browser.mjs';

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4173/Vendanor/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const pdfFile = fileURLToPath(new URL('../site/pdf/2020-01-14-67.pdf', import.meta.url));

function browserPath() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const candidates = [chromium.executablePath(),
    `${process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'}/Microsoft/Edge/Application/msedge.exe`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const found = candidates.find(existsSync);
  assert.ok(found, 'Install Chromium for playwright-core or set BROWSER_PATH to Chrome or Edge.');
  return found;
}

async function visibleText(page, selector, text) {
  await page.locator(selector).filter({hasText:text}).first().waitFor();
}

async function widthFits(page) {
  const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(Math.max(...dimensions) <= page.viewportSize().width + 1,
    `Page overflow at ${page.url()}: ${dimensions.join(' / ')} on ${page.viewportSize().width}px`);
}

async function verifyFolio(page) {
  const address = new URL(base.href);
  address.hash = 'library?' + new URLSearchParams({doc:'official:FOR-2025-12-16-2652|no-cargo-2025',section:'s1'});
  await page.goto(address.href);
  await visibleText(page, '#reader .lawtext', 'Forskriften gjelder for norske lasteskip');
  await widthFits(page);
  const original = await page.getByRole('link', {name:'Open original PDF'}).getAttribute('href');
  assert.equal(new URL(original).pathname, base.pathname + 'pdf/2025-12-16-2652.pdf');
  const source = await page.request.get(original);
  assert.equal(source.status(), 200);
  assert.equal(createHash('sha256').update(await source.body()).digest('hex'),
    'eedab4c406938f78c498e550d9dbac90def6c8ad8de1b3bdea858135dd1da9a7');
  await page.getByRole('button', {name:'PDF excerpt', exact:true}).click();
  const frame = page.locator('#reader iframe');
  await frame.waitFor();
  const url = await frame.getAttribute('src');
  assert.equal(new URL(url).pathname, base.pathname + 'pdf/sections/no-cargo-2025/s1.pdf');
  const clip = await page.request.get(url);
  assert.match(clip.headers()['content-type'], /application\/pdf/);
  assert.equal((await clip.body()).subarray(0, 5).toString(), '%PDF-');
  await page.locator('[data-mode="text"]').click();
  await page.locator('#section-find').fill('periodisk kontroll');
  const options = page.locator('#section-choice option');
  const count = await options.count();
  assert.ok(count > 0 && count < 159);
  const match = options.filter({hasText:'§ 149'}).first();
  await page.locator('#section-choice').selectOption(await match.getAttribute('value'));
  await visibleText(page, '#reader .lawtext', '30 måneder');
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('section'), 's149');
}

async function verifyProfile(page) {
  await page.goto(new URL('#library', base).href);
  await page.locator('#library-view').waitFor();
  await page.locator('#open-profile').click();
  await page.locator('#boat-form').waitFor();
  assert.equal(new URL(page.url()).hash.split('?')[0], '#boat');
}

async function verifyArchive(page) {
  await page.goto(new URL('#library', base).href);
  await page.locator('#library-view').waitFor();
  await page.locator('#source-filter').selectOption('archive');
  await page.locator('#q').fill('nødstoppmekanisme');
  await page.locator('#q').press('Enter');
  const hit = page.locator('#result-list button').filter({hasText:'nødstoppmekanisme'}).first();
  await hit.waitFor();
  await hit.click();
  await page.locator('[data-mode="text"]').click();
  await visibleText(page, '#reader .lawtext', /nødstoppmekanisme/i);
  assert.ok(await page.locator('#reader .lawtext mark').count() > 0);
  await widthFits(page);
  const notice = new URL(base.href);
  notice.hash = 'library?' + new URLSearchParams({doc:'LTI/forskrift/2020-01-14-67',section:'p0'});
  await page.goto(notice.href);
  await visibleText(page, '#reader .lawtext', 'virkeområdet');
  await page.locator('[data-mode="pdf"]').click();
  const clip = page.locator('#reader iframe');
  await clip.waitFor();
  const header = await clip.evaluate(async node => {
    const result = await fetch(node.src);
    return (await result.blob()).slice(0, 5).text();
  });
  assert.equal(header,'%PDF-');
  await page.locator('[data-mode="text"]').click();
}

async function verifyComparison(page) {
  await page.goto(new URL('#changes', base).href);
  await page.locator('#preset').selectOption('pax-stop');
  await visibleText(page, '#diff-output .diff-line.del', 'dødmannsknapp');
  await visibleText(page, '#diff-output .diff-line.add', 'nødstoppmekanisme');
  const earlier = page.locator('#diff-output').getByRole('link', {name:/Earlier source/});
  const later = page.locator('#diff-output').getByRole('link', {name:/Later source/});
  const earlierUrl = new URL(await earlier.getAttribute('href'), page.url());
  const laterUrl = new URL(await later.getAttribute('href'), page.url());
  assert.notEqual(earlierUrl.href, laterUrl.href);
  await earlier.click();
  await visibleText(page, '#reader .lawtext', 'dødmannsknapp');
  await page.goto(laterUrl.href);
  await visibleText(page, '#reader .lawtext', 'nødstoppmekanisme');
}

async function verifyImports(page) {
  const sources = page.locator('a[href="#sources"]:visible').first();
  const importedTitle = 'Local copy of the 2020 passenger exclusion';
  await page.goto(new URL('#sources', base).href);
  const form = page.locator('#document-import');
  await form.locator('[name="file"]').setInputFiles(pdfFile);
  await form.locator('[name="title"]').fill(importedTitle);
  await form.locator('[name="language"]').fill('nb');
  await form.locator('summary').click();
  await form.locator('[name="sections"]').fill(JSON.stringify([{key:'s1b',label:'§ 1(2)(b)',fromPage:1,toPage:1,top:0.46,bottom:0.56}]));
  await form.getByRole('button', {name:'Index PDF on this device'}).click();
  await visibleText(page, '#reader h2', importedTitle);
  await visibleText(page, '#reader .lawtext', 'virkeområdet');
  await page.getByRole('button', {name: 'Find passage in PDF'}).click();
  const finder = page.locator('#passage-finder');
  await visibleText(page, '#passage-finder [data-progress]', '1 of 1 original pages');
  assert.equal(await finder.locator('[data-remote]').isVisible(), false);
  await finder.locator('[data-record] summary').click();
  assert.match(await finder.locator('[data-record-text]').textContent(), /virkeområdet/);
  await finder.locator('[data-query]').fill('Endringen trer i kraft');
  await visibleText(page, '#passage-finder .passage-hit', '1. februar 2020');
  await finder.getByRole('button', {name: 'Close', exact: true}).click();
  await page.locator('[data-mode="pdf"]').click();
  const local = page.locator('#reader iframe');
  await local.waitFor();
  assert.match(await local.getAttribute('src'), /^blob:/);
  await sources.click();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-export]').first().click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const pack = JSON.parse(buffer.toString('utf8'));
  assert.equal(pack.format, 'vessel-law-library');
  assert.equal(pack.documents.length, 1);
  assert.equal(pack.documents[0].pdf.sha256, createHash('sha256').update(await readFile(pdfFile)).digest('hex'));
  await page.reload();
  await visibleText(page, '#sources-view .source-list', importedTitle);
  const remove = async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-remove]').first().click();
    await visibleText(page, '#sources-view', 'No private documents');
  };
  await remove();
  await page.locator('#pack-file').setInputFiles({name:'library.json',mimeType:'application/json',buffer});
  await visibleText(page, '#sources-view .source-list', importedTitle);
  await page.reload();
  await page.locator('[data-open]').first().click();
  await visibleText(page, '#reader h2', importedTitle);
  await page.locator('[data-mode="text"]').click();
  await visibleText(page, '#reader .lawtext', 'virkeområdet');
  await sources.click();
  await remove();
  await page.reload();
  await visibleText(page, '#sources-view', 'No private documents');
}

async function verifyNationalPassage(page) {
  // UK SI 2023/273, as made. Contains public sector information licensed under the Open Government Licence v3.0.
  // https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
  const source = 'https://faolex.fao.org/docs/pdf/uk217329.pdf';
  const fingerprint = 'e1ed216a5d3ce8ced169cfd624d2fc36659a03d3932ece780707d072edf9d201';
  const bytes = await readFile(new URL('./fixtures/uk217329.pdf', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fingerprint);
  let requests = 0;
  await page.route(source, async route => {
    requests++;
    await route.fulfill({status: 200, headers: {'Content-Type': 'application/pdf',
      'Access-Control-Allow-Origin': '*', 'Content-Length': String(bytes.length)}, body: bytes});
  });
  try {
    const address = new URL(base.href);
    address.hash = 'library?' + new URLSearchParams({doc: 'world:LEX-FAOC217329', section: 'catalogue'});
    await page.goto(address.href);
    await visibleText(page, '#reader h2', 'Sea Fisheries (Amendment) Regulations 2023');
    assert.equal(await page.getByRole('link', {name: 'Open linked PDF'}).getAttribute('href'), source);
    await page.getByRole('button', {name: 'Find passage in PDF'}).click();
    const finder = page.locator('#passage-finder');
    await finder.waitFor();
    assert.equal(requests, 0);
    assert.equal(await finder.locator('[data-record]').isVisible(), false);
    await finder.getByRole('button', {name: 'Load linked PDF'}).click();
    await visibleText(page, '#passage-finder [data-progress]', '3 of 3 original pages');
    assert.equal(requests, 1);
    assert.equal(await finder.locator('[data-sha]').textContent(), 'SHA-256 ' + fingerprint);
    await finder.locator('[data-query]').fill('commencement and extent');
    await visibleText(page, '#passage-finder .passage-hit', 'Citation, commencement and extent');
    await finder.locator('[data-context]').selectOption('0');
    assert.equal(await finder.locator('[data-pages]').textContent(), 'Original page 1');
    await finder.getByRole('button', {name: 'Create excerpt PDF'}).click();
    await finder.getByRole('link', {name: 'Download excerpt PDF'}).waitFor();
    const excerpt = await finder.locator('[data-download]').evaluate(async node => {
      const {PDFDocument} = await import(new URL('vendor/pdf-lib.mjs', document.baseURI));
      const pdf = await PDFDocument.load(await (await fetch(node.href)).arrayBuffer());
      const first = pdf.getPage(0);
      return {pages: pdf.getPageCount(), height: first.getCropBox().height, full: first.getMediaBox().height,
        subject: pdf.getSubject()};
    });
    assert.equal(excerpt.pages, 1);
    assert.ok(excerpt.height > 0 && excerpt.height < excerpt.full / 4);
    assert.match(excerpt.subject, new RegExp(fingerprint));
    await page.keyboard.press('Escape');
    await finder.waitFor({state: 'detached'});
  } finally { await page.unroute(source); }
}

async function verifyDirectory(page) {
  await page.goto(new URL('#jurisdictions', base).href);
  await page.locator('#country-lookup').fill('Norway');
  await visibleText(page, '#country-detail h2', 'Norway');
  await page.locator('#country-lookup').fill('');
  for (const society of ['DNV','BV']) {
    await page.locator('#society-filter').selectOption(society);
    await page.locator('#country-list button').first().click();
    const evidence = page.locator('#country-detail .note').filter({hasText:society==='DNV'?'DNV':'Bureau Veritas'}).first();
    assert.match(await evidence.getByRole('link').getAttribute('href'), /^https:\/\//);
  }
  await page.locator('#society-filter').selectOption('');
  const country = page.locator('#country-list button').filter({hasText:/[1-9][\d,]* catalogue records/}).first();
  await country.click();
  const code = await country.getAttribute('data-code');
  await page.locator('#see-laws').click();
  assert.equal(await page.locator('#country-filter').inputValue(),code);
  await page.locator('#source-filter').selectOption('world');
  await page.locator('#result-list button').first().click();
  const record = page.locator('#reader').getByRole('link', {name:'Open catalogue record'});
  const bookResponse = await page.request.get(new URL('data/world-laws.json', base).href);
  const book = await bookResponse.json();
  const recordId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('doc').replace(/^world:/,'');
  const metadata = book.records.find(item => item.id === recordId);
  assert.equal(await record.getAttribute('href'),metadata.sourceUrl);
  if (metadata.pdfUrl) {
    assert.equal(await page.locator('#reader').getByRole('link', {name:'Open linked PDF'}).getAttribute('href'),metadata.pdfUrl);
  }
  await widthFits(page);
}

async function verifyMobile(page) {
  await checkPhoneBoat(page, base, widthFits);
  await verifyComparison(page);
  await widthFits(page);
  await verifyDirectory(page);
  await widthFits(page);
}

async function verifyBoat(page) {
  await checkBoatJourney(page, base, widthFits);
}

async function verifySavedLookup(page) {
  await checkSavedLookup(page,base);
}

async function verifyTreatyBoat(page) {
  await checkTreatyBoat(page,base);
}

async function verifyLawHistory(page) {
  await checkLawHistory(page,base);
}

async function verifyBoatSearch(page) {
  await checkOwnerSourceSearch(page,base);
}

const browser = await chromium.launch({executablePath:browserPath(),headless:true});
try {
  const faults = [];
  const requested = process.argv.slice(2);
  const checks = [verifyBoat, verifyTreatyBoat, verifySavedLookup, verifyFolio, verifyProfile, verifyArchive, verifyComparison, verifyImports, verifyDirectory, verifyNationalPassage, verifyLawHistory, verifyBoatSearch, verifyMobile];
  assert.ok(requested.every(name => checks.some(check => check.name===name)), 'Unknown browser check name');
  for (const check of checks.filter(item => !requested.length || requested.includes(item.name))) {
    const context = await browser.newContext(check === verifyMobile
      ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true}
      : {viewport:{width:1440,height:960}});
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => faults.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(base.href) && response.status() >= 400) faults.push(`${response.status()} ${response.url()}`);
    });
    try { await check(page); }
    catch (error) {
      const state = await page.locator('#result-count, #search-status, #import-status, #pack-status').allTextContents();
      console.error(`${check.name} at ${page.url()}`, state, faults);
      throw error;
    } finally { await context.close(); }
    console.log(`${check.name} passed`);
  }
  assert.deepEqual(faults, []);
  console.log('Browser checks passed.');
} finally { await browser.close(); }
