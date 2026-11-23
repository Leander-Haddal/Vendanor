import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const cargoId = 'FOR-2025-12-16-2652';
const cargoCard = '[data-law-id="' + cargoId + '"]';
const versionId = 'no-cargo-2025';

async function reveal(control) {
  await control.waitFor({state:'attached'});
  for (const details of await control.locator('xpath=ancestor::details').all()) {
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  }
  await control.waitFor({state:'visible'});
}

async function setField(form, name, value) {
  const control = form.locator('[name="' + name + '"]').first();
  await reveal(control);
  if (await control.evaluate(node => node.tagName === 'SELECT')) await control.selectOption(value);
  else await control.fill(value);
}

async function quietForm(page, base, widthFits) {
  await page.goto(base.href, {waitUntil:'domcontentloaded'});
  const form = page.locator('#boat-form');
  await form.waitFor();
  for (const name of ['flag','shipType','lengthOverall','grossTonnage','buildDate']) {
    const control = form.locator('[name="' + name + '"]');
    await control.waitFor({state:'attached'});
    assert.ok(await control.evaluate(node => node.labels?.length || node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')),
      'Missing accessible label for ' + name);
  }
  assert.equal(await page.locator('#boat-results-view:visible, #boat-passage-view:visible, #reader:visible, [data-read-passage]:visible').count(), 0);
  assert.equal(await form.locator('[name="flag"]').inputValue(), '');
  await widthFits(page);
  return form;
}

async function submitBoat(page) {
  const submit = page.locator('#boat-submit:visible, #result-boat-form:visible button[type="submit"]');
  await submit.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.hash.startsWith('#boat-results'));
  const results = page.locator('#boat-results-view');
  await results.waitFor();
  return results;
}

async function editBoat(page) {
  const form = page.locator('#result-boat-form');
  await reveal(form);
  assert.equal(new URL(page.url()).hash, '#boat-results');
  return form;
}

async function selectLaw(results, id) {
  const law = results.locator('button[data-law="official:' + id + '"]:not([data-edition])');
  await reveal(law);
  await law.click();
  assert.equal(await law.getAttribute('aria-current'), 'true');
}

async function readProvision(page, sectionId) {
  const card = page.locator('#boat-results-view ' + cargoCard);
  assert.equal(await card.count(), 1, 'The 2025 regulation should have one instrument group');
  const button = card.locator('[data-read-passage][data-section="' + sectionId + '"]').first();
  await reveal(button);
  assert.match(await button.getAttribute('data-doc'), /no-cargo-2025/);
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.hash.startsWith('#boat-passage'));
  return page.locator('#boat-passage-view');
}

async function checkOriginal(page, base) {
  const folios = JSON.parse(await readFile(new URL('../site/data/folios.json', import.meta.url), 'utf8'));
  const version = folios.instruments.find(row => row.id === cargoId).versions.find(row => row.id === versionId);
  const section = version.sections.find(row => row.id === 's1');
  const results = page.locator('#boat-results-view');
  const material = results.locator(cargoCard + ' .source-hunk[data-section="s1"]');
  await material.scrollIntoViewIfNeeded();
  const quote = material.locator('.source-quote');
  const target = new URL(await quote.getAttribute('href'), base);
  assert.equal(target.pathname, new URL('site/' + version.pdf, base).pathname);
  const fragment = new URLSearchParams(target.hash.slice(1));
  assert.equal(fragment.get('page'), String(section.pages[0]));
  assert.ok(section.text.replace(/\s+/g, ' ').includes(fragment.get('search')));
  await material.getByRole('button', {name:'Show text excerpt'}).waitFor();
  assert.ok(await material.locator('canvas').evaluate(canvas => {
    const {data} = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return data.some((value, index) => index % 4 === 0 && value < 150 && data[index + 3] === 255);
  }), 'The printed excerpt must contain visible ink from the source PDF');
  await material.getByRole('button', {name:'Show text excerpt'}).click();
  assert.match(await material.locator('.source-words').innerText(), /Forskriften gjelder for norske lasteskip/);
  const passage = await readProvision(page, 's1');
  await passage.locator('[data-boat-wording]').filter({hasText:'Forskriften gjelder for norske lasteskip'}).waitFor();
  const heading = passage.locator('#boat-passage-heading');
  assert.equal(await heading.evaluate(node => document.activeElement === node), true);
  assert.equal(await passage.locator('[data-boat-publisher]').getAttribute('href'), version.sourcePage);
  const evidence = passage.locator('[data-boat-evidence]');
  await evidence.locator('summary').click();
  assert.match(await evidence.textContent(), /Your boat/);
  assert.match(await evidence.textContent(), /2025\/2652/);
  const clip = new URL(await passage.locator('[data-boat-pdf]').getAttribute('href'), page.url());
  const original = new URL(await passage.locator('[data-boat-full-pdf]').getAttribute('href'), page.url());
  const assets = new URL('site/', base);
  assert.equal(clip.pathname, new URL(section.clip, assets).pathname);
  assert.equal(original.pathname, new URL(version.pdf, assets).pathname);
  const [excerptResponse, originalResponse] = await Promise.all([page.request.get(clip.href), page.request.get(original.href)]);
  assert.equal(excerptResponse.status(), 200);
  assert.equal(originalResponse.status(), 200);
  assert.match(excerptResponse.headers()['content-type'], /application\/pdf/);
  const excerpt = await excerptResponse.body();
  assert.equal(excerpt.subarray(0,5).toString(), '%PDF-');
  assert.deepEqual(excerpt, await readFile(new URL('../site/' + section.clip, import.meta.url)));
  assert.equal(createHash('sha256').update(await originalResponse.body()).digest('hex'), version.pdfSha256);
  await passage.locator('[data-boat-library]').click();
  await page.waitForURL(url => url.hash.startsWith('#library?'));
  await page.locator('#reader .lawtext').filter({hasText:'Forskriften gjelder for norske lasteskip'}).waitFor();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('section'), 's1');
  await page.goBack();
  await passage.waitFor();
  await passage.locator('[data-boat-back]').click();
  await page.locator('#boat-results-view').waitFor();
  assert.equal(await page.locator(':focus').getAttribute('data-section'), 's1');
}

export async function checkBoatJourney(page, base, widthFits) {
  let release;
  // Hold the large catalogue until the visitor has already edited the first form.
  const hold = new Promise(resolve => { release = resolve; });
  const national = '**/data/world-laws.json';
  await page.route(national, async route => { await hold; await route.continue(); });
  let form;
  try {
    form = await quietForm(page, base, widthFits);
    await setField(form, 'flag', 'DE');
    await setField(form, 'shipType', 'cargo');
    await setField(form, 'lengthOverall', '14');
  } finally {
    release();
    await page.waitForLoadState('networkidle');
    await page.unroute(national);
  }
  assert.equal(await form.locator('[name="flag"]').inputValue(), 'DE');
  assert.equal(await form.locator('[name="shipType"]').inputValue(), 'cargo');
  assert.equal(await form.locator('[name="lengthOverall"]').inputValue(), '14');
  await setField(form, 'grossTonnage', '120');
  await setField(form, 'buildDate', '1998');
  await form.locator('.date-picker-button').click();
  const calendar = page.getByRole('dialog', {name:'Choose a law date'});
  await calendar.getByLabel('Exact date').fill('2026-11-23');
  await calendar.getByRole('button', {name:'Use date', exact:true}).click();
  let results = await submitBoat(page);
  assert.equal(await results.locator(cargoCard).count(), 0, 'A German flag alone cannot match Norwegian-flag cargo scope');
  await widthFits(page);
  form = await editBoat(page);
  assert.equal(await form.locator('[name="buildDate"]').inputValue(), '1998');
  await setField(form, 'flag', 'NO');
  await setField(form, 'lengthL', '14');
  await setField(form, 'lastSurveyDate', '2025-08-21');
  results = await submitBoat(page);
  const followups = results.locator('[data-followups]').filter({has:page.locator('[name="approvedTraining"]')}).first();
  await setField(followups, 'approvedTraining', 'yes');
  if (await followups.locator('[name="onlyPassenger2020"]').count()) await setField(followups, 'onlyPassenger2020', 'no');
  await followups.getByRole('button', {name:'Update results'}).click();
  await results.locator(cargoCard).waitFor({state:'detached'});
  form = await editBoat(page);
  await setField(form, 'approvedTraining', 'no');
  await setField(form, 'onlyPassenger2020', 'no');
  await setField(form, 'wheelhouse', 'yes');
  results = await submitBoat(page);
  const index = await results.locator('.law-sidebar').boundingBox();
  const stream = await results.locator('.law-stream').boundingBox();
  assert.ok(index.x + index.width <= stream.x && stream.x + stream.width - index.x > page.viewportSize().width * .85);
  await selectLaw(results, cargoId);
  const query = results.locator('#boat-law-keyword'), outcome = results.locator('#boat-outcome');
  await query.fill('"§ 19(1)"');
  await outcome.selectOption('review');
  const threshold = results.locator(cargoCard + ' .source-hunk[data-section="s19-1"]');
  await threshold.waitFor();
  await outcome.selectOption('match');
  assert.equal(await threshold.count(),0,'The construction year alone cannot settle the 1 July 1998 cutoff');
  form = await editBoat(page);
  await setField(form, 'buildDate', '1998-07-01');
  results = await submitBoat(page);
  await threshold.waitFor();
  assert.equal(await threshold.getAttribute('data-state'), 'match');
  assert.equal(await query.inputValue(), '"§ 19(1)"');
  // This section starts on page 5. The searched wording is on its second printed page.
  const clipPath = '**/pdf/sections/no-cargo-2025/s19-1.pdf';
  let releaseClip;
  const held = new Promise(resolve => { releaseClip = resolve; });
  await page.route(clipPath, async route => { await held; await route.continue(); });
  try {
    await query.fill('kameraløsning');
    await threshold.locator('.source-words mark').waitFor();
    const [tab] = await Promise.all([page.waitForEvent('popup'), threshold.locator('.source-quote').click()]);
    releaseClip();
    await tab.waitForURL(url => url.pathname.endsWith('/2025-12-16-2652.pdf') && new URLSearchParams(url.hash.slice(1)).get('page') === '6');
    await tab.close();
    assert.match(await threshold.locator('.source-location').innerText(), /page 6/);
  } finally { releaseClip(); await page.unroute(clipPath); }
  await query.fill('');
  await outcome.selectOption('all');
  await selectLaw(results, cargoId);
  const card = results.locator(cargoCard);
  const shown = await card.locator('.source-hunk').count();
  await card.locator('.expand-passages').click();
  assert.ok(await card.locator('.source-hunk').count() > shown);
  await checkOriginal(page, base);
  await readProvision(page, 's1');
  await page.goBack();
  await page.locator('#boat-results-view').waitFor();
  form = await editBoat(page);
  await page.reload();
  await form.waitFor();
  for (const [name, expected] of Object.entries({flag:'NO',shipType:'cargo',lengthL:'14',lengthOverall:'14',grossTonnage:'120',buildDate:'1998-07-01',lastSurveyDate:'2025-08-21',_asOf:'2026-11-23'})) {
    assert.equal(await form.locator('[name="' + name + '"]').inputValue(), expected, 'Saved ' + name);
  }
  await setField(form, 'flag', 'DE');
  results = await submitBoat(page);
  assert.equal(await results.locator(cargoCard).count(), 0, 'Changing flag must invalidate the earlier Norwegian result');
}

export async function checkTreatyBoat(page,base) {
  await page.goto(base.href);
  let form = page.locator('#boat-form');
  await setField(form,'flag','DE');
  await setField(form,'shipType','recreational');
  await setField(form,'lengthOverall','9.5');
  await setField(form,'colregWaters','high');
  await setField(form,'colregLightBasis','ordinary');
  await setField(form,'colregTowSubject','no');
  let results = await submitBoat(page);
  const card = results.locator('[data-law-id="IMO-COLREG-1972-DE"]');
  await card.waitFor();
  await selectLaw(results, 'IMO-COLREG-1972-DE');
  await results.locator('#boat-outcome').selectOption('match');
  await results.locator('#boat-law-keyword').fill('"Rule 22(c)"');
  const excerpt = card.locator('.source-hunk[data-section="r22c"]');
  assert.match(await excerpt.locator('.source-words').innerText(), /a sidelight, 1 mile/);
  const original = new URL(await excerpt.locator('.source-quote').getAttribute('href'));
  assert.equal(original.pathname,new URL('site/pdf/colreg-usbook.pdf',base).pathname);
  assert.equal(new URLSearchParams(original.hash.slice(1)).get('page'),'45');
  const clipPath = '**/pdf/colreg-usbook-r22c.pdf';
  await page.route(clipPath, route => route.abort());
  await excerpt.getByRole('button', {name:'Show printed excerpt'}).click();
  await excerpt.getByRole('status').filter({hasText:'The printed preview is unavailable'}).waitFor();
  assert.match(await excerpt.locator('.source-words').innerText(), /a sidelight, 1 mile/);
  await page.unroute(clipPath);
  await excerpt.getByRole('button', {name:'Show printed excerpt'}).click();
  await excerpt.locator('canvas').waitFor();
  await card.locator('[data-read-passage][data-section="r22c"]').click();
  const reader = page.locator('#boat-passage-view');
  await reader.locator('[data-boat-wording]').filter({hasText:'a sidelight, 1 mile'}).waitFor();
  assert.equal(new URL(await reader.locator('[data-boat-pdf]').getAttribute('href'),base).pathname,
    new URL('site/pdf/colreg-usbook-r22c.pdf',base).pathname);
  assert.equal(await reader.locator('[data-boat-publisher]').getAttribute('href'),
    'https://www.navcen.uscg.gov/navigation-rules-amalgamated');
  const flagProof = reader.locator('[data-boat-flag-source]');
  await reveal(flagProof);
  assert.match(await flagProof.getAttribute('href'),/^https:\/\/wwwcdn\.imo\.org\/.+\.pdf#page=108$/);
  await reader.locator('[data-boat-back]').click();
  form = await editBoat(page);
  await setField(form,'colregWaters','other');
  results = await submitBoat(page);
  assert.equal(await results.locator('[data-law-id="IMO-COLREG-1972-DE"]').count(),0);
}

export async function checkPhoneBoat(page, base, widthFits) {
  const form = await quietForm(page, base, widthFits);
  await setField(form, 'flag', 'NO');
  await setField(form, 'shipType', 'cargo');
  for (const [key,value] of Object.entries({lengthOverall:'14',lengthL:'14',grossTonnage:'120'})) await setField(form, key, value);
  for (const key of ['onlyPassenger2020','approvedTraining']) await setField(form, key, 'no');
  const results = await submitBoat(page);
  await widthFits(page);
  assert.equal(await results.locator('.law-index').getAttribute('open'), null);
  assert.equal(await results.locator('.specs-panel').getAttribute('open'), null);
  await selectLaw(results, cargoId);
  assert.equal(await results.locator('.law-index').getAttribute('open'), null);
  assert.equal(await results.locator('.law-card').count(), 1);
  await results.locator(cargoCard + ' .source-words').first().waitFor();
  const specs = await editBoat(page);
  await specs.locator('.date-picker-button').click();
  await page.getByRole('dialog').getByLabel('Revision year').waitFor();
  await widthFits(page);
  await page.getByRole('button', {name:'Close date selector'}).click();
  await setField(specs, 'lengthOverall', '15.5');
  await submitBoat(page);
  assert.equal(await results.locator('.law-card').count(), 1);
  assert.equal(await results.locator('.specs-panel > summary').innerText(), 'Ship specifications');
  assert.equal(await results.locator('[name="lengthOverall"]').first().inputValue(), '15.5');
  await widthFits(page);
  const passage = await readProvision(page, 's1');
  await passage.locator('[data-boat-wording]').waitFor();
  await widthFits(page);
  await passage.locator('[data-boat-back]').click();
  await page.locator('#boat-results-view').waitFor();
}

export async function checkSavedBoat(page, base) {
  await page.goto(base.href);
  const form = page.locator('#boat-form');
  const name = 'Nordlys';
  const registration = 'N-102';
  await setField(form, 'flag', 'NO');
  await setField(form, 'shipType', 'fishing');
  await setField(form, 'lengthOverall', '24');
  await setField(form, 'buildDate', '1998');
  await form.locator('[name="_remember"]').check();
  await form.locator('[name="_name"]').fill(name);
  await form.locator('[name="_identifier"]').fill(registration);
  await submitBoat(page);
  const specs = await editBoat(page);
  await setField(specs, 'grossTonnage', '432');
  await submitBoat(page);
  const cookies = await page.context().cookies();
  const cookie = cookies.find(c => c.name==='ship_law_boat');
  assert.match(cookie?.value || '',/^[a-f0-9-]{36}$/);
  assert.equal(cookie.path,base.pathname);
  // Earlier saved profiles can carry evidence for a confirmed measurement.
  await page.evaluate(id => {
    const key='ship-law.boat.v1.'+id, boat=JSON.parse(localStorage.getItem(key));
    boat.lookup={provider:'Previous register import', evidence:[{key:'grossTonnage', label:'Gross tonnage', value:432, sourceUrl:'https://example.test/registry/102'}]};
    localStorage.setItem(key, JSON.stringify(boat));
  }, cookie.value);
  await page.goto(new URL('#boats',base).href);
  await page.locator('#fleet-query').fill(registration);
  const saved = page.locator('#fleet-list article').filter({hasText:name});
  await saved.waitFor();
  await saved.locator('[data-edit]').click();
  assert.equal(await form.locator('[name="_name"]').inputValue(),name);
  assert.equal(await form.locator('[name="buildDate"]').inputValue(),'1998');
  assert.equal(await form.locator('[name="grossTonnage"]').inputValue(),'432');
  assert.match(await form.locator('.lookup-evidence').textContent(),/Previous register import/);
  await page.reload();
  await form.waitFor();
  assert.equal(await form.locator('[name="shipType"]').inputValue(),'fishing');
  await page.goto(new URL('#boats',base).href);
  await page.locator('#fleet-query').fill('name with no record');
  await page.locator('#fleet-list').filter({hasText:'No saved boats match'}).waitFor();
  await page.locator('#fleet-query').fill('');
  page.once('dialog',dialog => dialog.accept());
  await saved.locator('[data-forget]').click();
  await page.locator('#boats-view').filter({hasText:'Save your first boat'}).waitFor();
  assert.equal((await page.context().cookies()).some(c => c.name==='ship_law_boat'),false);
}

export async function checkRevisionPicker(page, base) {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const manifest = '**/data/solas-folios.json';
  await page.route(manifest, async route => { await hold; await route.continue(); });
  await page.goto(base.href, {waitUntil:'domcontentloaded'});
  const form = page.locator('#boat-form');
  const picker = page.getByRole('dialog', {name:'Choose a law date'});
  try {
    await setField(form, 'flag', 'NO');
    await setField(form, 'shipType', 'cargo');
    await form.locator('.date-picker-button').click();
    await picker.getByText('Loading indexed editions…').waitFor();
  } finally { release(); }
  await picker.getByLabel('Revision year').selectOption('2015');
  await page.unroute(manifest);
  const earlier = picker.getByRole('button', {name:/2014 regulation · as issued/});
  assert.match(await earlier.innerText(), /In force from 1 Jan 2015/);
  await earlier.click();
  assert.equal(await form.locator('[name="_asOf"]').inputValue(), '2015-01-01');
  const results = await submitBoat(page);
  await results.locator('[data-law-id="FOR-2014-12-19-1853"]').waitFor();
  assert.equal(await results.locator(cargoCard).count(), 0);
  assert.equal(await results.locator(':scope > :first-child').getAttribute('class'), 'owner-card specs-panel');
  assert.equal(await page.getByRole('link',{name:'Regulations',exact:true}).getAttribute('aria-current'), 'page');
  const specs = await editBoat(page);
  await setField(specs, 'flag', 'NZ');
  await specs.locator('.date-picker-button').click();
  await picker.getByRole('heading', {name:'Revision dates for New Zealand'}).waitFor();
  await picker.getByLabel('Revision year').selectOption('2003');
  await picker.getByRole('button', {name:/Original signed Part 91/}).waitFor();
  assert.equal(await picker.getByRole('button', {name:/Small cargo ships/}).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await specs.locator('[name="_asOf"]').inputValue(), '2015-01-01');
  await specs.locator('.date-picker-button').click();
  const latest = picker.getByRole('button', {name:/Use latest indexed date/});
  const latestLabel = (await latest.innerText()).split(' · ').at(-1);
  await latest.click();
  await submitBoat(page);
  assert.equal(await specs.locator('[name="flag"]').inputValue(),'NZ');
  assert.equal(await specs.locator('.date-picker-button').innerText(),latestLabel);
}

export async function checkEditionOverview(page, base) {
  const bytes = await readFile(new URL('../site/pdf/2020-01-14-67.pdf', import.meta.url));
  const family = {familyId:'passenger-editions', title:'Passenger source copies', jurisdiction:'NO'};
  const documents = [
    {...family, id:'printed', revision:'Printed notice', pdf:{base64:bytes.toString('base64')},
      sections:[{key:'s1', label:'Section 1', fromPage:1, toPage:1, top:.46, bottom:.56}]},
    {...family, id:'transcript', revision:'Port transcript', sections:[{key:'s1', label:'Section 1', text:'The port keeps a passenger register.'}]},
  ];
  await page.goto(new URL('#sources', base).href);
  await page.locator('#pack-file').setInputFiles({name:'editions.json', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({format:'vessel-law-library', schemaVersion:1, documents}))});
  await page.locator('#sources-view .source-list [data-open]').nth(1).waitFor();
  await page.locator('nav a[href="#boat"]').click();
  const form = page.locator('#boat-form');
  await setField(form, 'flag', 'NO');
  await setField(form, 'shipType', 'passenger');
  const results = await submitBoat(page);
  const editions = results.locator('[data-category="Uploaded documents"] [data-editions]');
  await editions.locator('summary').click();
  const printed = editions.getByRole('button', {name:/Printed notice/});
  await printed.click();
  assert.equal(await results.locator('.source-hunk').count(), 1);
  await results.getByRole('button', {name:'Show text excerpt', exact:true}).waitFor();
  const [tab] = await Promise.all([page.waitForEvent('popup'), results.locator('button.source-quote').click()]);
  await tab.waitForURL(url => url.protocol === 'blob:');
  const original = new URL(tab.url());
  assert.equal(new URLSearchParams(original.hash.slice(1)).get('page'), '1');
  const fingerprint = await page.evaluate(async url => {
    const hash = await crypto.subtle.digest('SHA-256', await (await fetch(url)).arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }, original.href);
  assert.equal(fingerprint, createHash('sha256').update(bytes).digest('hex'));
  await tab.close();
  await editions.getByRole('button', {name:/Port transcript/}).click();
  const quote = results.locator('.source-quote');
  assert.match(await quote.innerText(), /keeps a passenger register/);
  assert.equal(await results.locator('.source-hunk').count(), 1);
  await quote.click();
  await page.locator('#reader .lawtext').filter({hasText:'keeps a passenger register'}).waitFor();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('section'), 's1');
  await page.goBack();
  assert.equal(await editions.getByRole('button', {name:/Port transcript/}).getAttribute('aria-current'), 'true');
}
