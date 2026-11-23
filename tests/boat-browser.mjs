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
  const submit = page.locator('#boat-submit');
  await submit.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.hash.startsWith('#boat-results'));
  const results = page.locator('#boat-results-view');
  await results.waitFor();
  return results;
}

async function editBoat(page) {
  await page.locator('#edit-boat').click();
  const form = page.locator('#boat-form');
  await form.waitFor();
  assert.equal(new URL(page.url()).hash.split('?')[0], '#boat');
  return form;
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

async function dateThreshold(passageList) {
  const more = passageList.locator(':scope > details.more-passages');
  await more.locator(':scope > summary').click();
  await more.locator('.passage-options').waitFor();
  const input = more.locator('input[type="search"]');
  if (await input.count()) await input.fill('§ 19(1)');
  return more.locator('[data-read-passage][data-section="s19-1"]');
}

async function checkOriginal(page, base) {
  const folios = JSON.parse(await readFile(new URL('../site/data/folios.json', import.meta.url), 'utf8'));
  const version = folios.instruments.find(row => row.id === cargoId).versions.find(row => row.id === versionId);
  const section = version.sections.find(row => row.id === 's1');
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
  assert.equal(clip.pathname, new URL(section.clip, base).pathname);
  assert.equal(original.pathname, new URL(version.pdf, base).pathname);
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
  await setField(form, '_asOf', '2026-11-23');
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
  const conditional = results.locator(cargoCard + ' .law-questions > .related-checks');
  await conditional.locator(':scope > summary').click();
  await (await dateThreshold(conditional.locator(':scope > div'))).waitFor();
  const unconfirmed = await dateThreshold(results.locator(cargoCard + ' .law-passages'));
  assert.equal(await unconfirmed.count(),0,'The construction year alone cannot settle the 1 July 1998 cutoff');
  form = await editBoat(page);
  await setField(form, 'buildDate', '1998-07-01');
  results = await submitBoat(page);
  await results.locator(cargoCard).waitFor();
  await (await dateThreshold(results.locator(cargoCard + ' .law-passages'))).waitFor();
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
  const card = results.locator('#boat-matched [data-law-id="IMO-COLREG-1972-DE"]');
  await card.waitFor();
  await card.locator('.law-passages > .more-passages > summary').click();
  await card.locator('[data-read-passage][data-section="r22c"]').click();
  const reader = page.locator('#boat-passage-view');
  await reader.locator('[data-boat-wording]').filter({hasText:'a sidelight, 1 mile'}).waitFor();
  assert.equal(new URL(await reader.locator('[data-boat-pdf]').getAttribute('href'),base).pathname,
    new URL('pdf/colreg-usbook-r22c.pdf',base).pathname);
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
  await submitBoat(page);
  await widthFits(page);
  const passage = await readProvision(page, 's1');
  await passage.locator('[data-boat-wording]').waitFor();
  await widthFits(page);
  await passage.locator('[data-boat-back]').click();
  await page.locator('#boat-results-view').waitFor();
}

export async function checkSavedLookup(page, base) {
  const snapshot = JSON.parse(await readFile(new URL('../site/data/vessels-no.json',import.meta.url),'utf8'));
  const row = snapshot.rows.find(r => r[1]==='LIBAS' && r[5]) || snapshot.rows.find(r => r[2] && r[4] && r[5] && r[6]);
  await page.goto(base.href);
  const form = page.locator('#boat-form');
  await form.waitFor();
  await page.locator('.vessel-lookup > summary').click();
  const lookup = page.locator('#vessel-lookup');
  const worldwide = 'https://www.wikidata.org/w/api.php?**';
  await page.route(worldwide,route => route.abort('internetdisconnected'));
  await lookup.locator('select').selectOption('wiki');
  await lookup.getByRole('searchbox').fill('IMO 9241061');
  await lookup.getByRole('button',{name:'Search vessels'}).click();
  await lookup.getByRole('status').filter({hasText:'The vessel search could not be completed'}).waitFor();
  assert.match(await lookup.getByRole('status').textContent(),/enter the particulars below/);
  assert.equal(await form.locator('[name="flag"]').inputValue(),'');
  await page.unroute(worldwide);
  await lookup.getByRole('button',{name:'Clear search'}).click();
  await lookup.locator('select').selectOption('no');
  await lookup.getByRole('searchbox').fill(row[2]);
  await lookup.getByRole('button',{name:'Search vessels'}).click();
  await lookup.locator('[data-vessel-choice="'+row[0]+'"]').click();
  assert.equal(await form.locator('[name="flag"]').inputValue(),'');
  assert.equal(await form.locator('[name="lengthOverall"]').inputValue(),'');
  await lookup.getByRole('button',{name:'Clear search'}).click();
  assert.equal(await lookup.getByRole('searchbox').inputValue(),'');
  assert.equal(await lookup.locator('[data-vessel-choice]').count(),0);
  assert.equal(await lookup.getByRole('button',{name:'Apply selected particulars'}).count(),0);
  await lookup.getByRole('searchbox').fill(row[2]);
  await lookup.getByRole('button',{name:'Search vessels'}).click();
  await lookup.locator('[data-vessel-choice="'+row[0]+'"]').click();
  assert.match(await lookup.textContent(),/Norwegian Directorate of Fisheries/);
  assert.equal(await lookup.getByRole('link',{name:'Open source record'}).getAttribute('href'),
    'https://api.fiskeridir.no/vessel-api/api/v1/vessels/'+row[0]);
  await lookup.locator('input[type="checkbox"][value="grossTonnage"]').uncheck();
  await lookup.getByRole('button',{name:'Apply selected particulars'}).click();
  assert.equal(await form.locator('[name="lengthOverall"]').inputValue(),String(row[4]));
  assert.equal(await form.locator('[name="grossTonnage"]').inputValue(),'');
  assert.equal(await form.locator('[name="flag"]').inputValue(),'NO');
  assert.equal(await form.locator('[name="shipType"]').inputValue(),'fishing');
  await form.locator('[name="_remember"]').check();
  const name = row[1]+' browser check';
  await form.locator('[name="_name"]').fill(name);
  await submitBoat(page);
  const cookies = await page.context().cookies();
  const cookie = cookies.find(c => c.name==='ship_law_boat');
  assert.match(cookie?.value || '',/^[a-f0-9-]{36}$/);
  assert.equal(cookie.path,base.pathname);
  await page.goto(new URL('#boats',base).href);
  await page.locator('#fleet-query').fill(row[2]);
  const saved = page.locator('#fleet-list article').filter({hasText:name});
  await saved.waitFor();
  await saved.locator('[data-edit]').click();
  assert.equal(await form.locator('[name="_name"]').inputValue(),name);
  assert.equal(await form.locator('[name="buildDate"]').inputValue(),row[6]);
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
