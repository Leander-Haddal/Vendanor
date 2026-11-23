import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PDFDocument} from '../site/vendor/pdf-lib.mjs';

export async function checkLegacyDocuments(page, base) {
  // Store a v1 pack at the module path used by the former root-hosted app.
  await page.goto(new URL('site/vendor/LICENSES.txt', base).href);
  const oldModule = new URL('js/imports.js', base).href;
  await page.route(oldModule, route => route.fulfill({
    path:fileURLToPath(new URL('../site/js/imports.js', import.meta.url)), contentType:'text/javascript',
  }));
  await page.evaluate(async url => {
    const {importPack} = await import(url);
    await importPack(new Blob([JSON.stringify({format:'vessel-law-library', schemaVersion:1, documents:[{
      title:'Earlier edition', fields:[{key:'length', label:'Length', type:'number'}],
      sections:[{key:'a1', label:'Article 1', text:'Pilotage on arrival.', criteria:{field:'length', op:'gt', value:100}}],
    }]})]));
    sessionStorage.setItem('ship-law.profile.v1', JSON.stringify({values:{length:10}, asOf:'2001-01-01'}));
  }, oldModule);
  await page.unroute(oldModule);
  await page.goto(new URL('#documents', base).href);
  const view = page.locator('#documents-view');
  await view.getByRole('searchbox').fill('pilotage');
  await view.locator('#document-wording mark').filter({hasText:'Pilotage'}).waitFor();
  assert.equal(await view.getByLabel('Saved documents').locator('option:checked').textContent(), 'Earlier edition');
  assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name)),
    ['maritime-law-library:' + base.pathname]);
}

export async function checkDocuments(page, base, widthFits) {
  const publicRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/data/')) publicRequests.push(request.url());
  });
  await page.goto(new URL('site/?bookmark=1#documents', base).href);
  const view = page.locator('#documents-view');
  const status = view.getByRole('status').filter({hasText: 'first document'});
  await status.waitFor();
  assert.equal(page.url(), new URL('?bookmark=1#documents', base).href);
  assert.equal(await page.locator('nav').getByRole('link', {name:'My documents'}).getAttribute('aria-current'), 'page');
  const file = view.getByLabel('Upload a PDF or text file');
  const choice = view.getByLabel('Saved documents');
  const search = view.getByRole('searchbox');
  const hits = view.locator('#document-hits button');
  const count = view.locator('#document-count');
  const wording = view.locator('#document-wording');

  await file.setInputFiles({name:'Incomplete.pdf', mimeType:'application/pdf', buffer:Buffer.from('Incomplete')});
  await view.getByText('The file has no PDF header.').waitFor();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Article 1. Record the port of registry.');
  pdf.addPage().drawText('Article 2. Inspect the vessel in port.');
  pdf.addPage();
  await file.setInputFiles({name:'Harbour rules.pdf', mimeType:'application/pdf', buffer:Buffer.from(await pdf.save())});
  await wording.filter({hasText:'Article 1'}).waitFor();
  await view.getByText(/Some pages have no searchable text/).waitFor();
  await search.fill('"port of registry"');
  await count.filter({hasText:'1 of 3 passages'}).waitFor();
  assert.equal(await wording.locator('mark').textContent(), 'port of registry');

  await search.fill('port');
  await view.getByLabel('From page').fill('2');
  await wording.filter({hasText:'Article 2'}).waitFor();
  const pageLink = view.getByRole('link', {name:'Open original page 2'});
  await pageLink.waitFor();
  assert.match(await pageLink.getAttribute('href'), /^blob:.*#page=2$/);
  assert.deepEqual(await pageLink.evaluate(async link => Array.from(new Uint8Array(
    await (await fetch(link.href)).arrayBuffer()).slice(0, 5))), [...Buffer.from('%PDF-')]);
  await view.getByLabel('To page').fill('1');
  await count.filter({hasText:'lower number first'}).waitFor();
  assert.equal(await hits.count(), 0);
  await view.getByRole('button', {name:'Clear filters'}).click();
  await count.filter({hasText:'3 of 3 passages'}).waitFor();

  const textFile = {name:'Port notice.txt', mimeType:'text/plain',
    buffer:Buffer.from('Article 1\nKeep a copy of <Schedule A>.\n\nArticle 2\nRecord the incoming tide.')};
  await file.setInputFiles(textFile);
  await wording.filter({hasText:'Keep a copy of <Schedule A>.'}).waitFor();
  assert.equal(await choice.locator('option').count(), 2);
  await view.getByLabel('From passage').fill('2');
  await search.fill('TIDE');
  await count.filter({hasText:'1 of 2 passages'}).waitFor();
  assert.equal(await wording.locator('mark').textContent(), 'tide');
  await search.fill('registry');
  await count.filter({hasText:'No passages match'}).waitFor();
  assert.equal(await wording.isVisible(), false);
  await file.setInputFiles(textFile);
  await wording.filter({hasText:'Keep a copy'}).waitFor();
  assert.equal(await choice.locator('option').count(), 2);
  await page.setViewportSize({width:360, height:800});
  await widthFits(page);
  await hits.filter({hasText:'Article 2'}).click();
  assert.equal(await view.locator('#document-heading').evaluate(node => node === document.activeElement), true);

  await page.reload();
  await choice.selectOption({label:'Harbour rules'});
  await search.fill('registry');
  await wording.filter({hasText:'Article 1'}).waitFor();
  assert.deepEqual(publicRequests, []);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await view.getByRole('link', {name:'Import options and backups'}).click();
  await page.locator('#sources-view .source-list').filter({hasText:'Port notice'}).waitFor();
  await page.locator('nav').getByRole('link', {name:'My documents'}).click();
  await choice.selectOption({label:'Port notice'});
  page.once('dialog', dialog => dialog.accept());
  await view.getByRole('button', {name:'Remove document'}).click();
  await wording.filter({hasText:'port of registry'}).waitFor();
  assert.equal(await choice.locator('option').count(), 1);
}
