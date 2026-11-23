import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function checkLawHistory(page,base) {
  await page.goto(base.href+'#map?country=EU');
  const eu=page.locator('#map-eu');
  await eu.locator('[data-find]').fill('32014L0090');
  const marine=eu.locator('[data-rows] > details').first();
  await marine.locator('summary').first().click();
  assert.equal(await marine.getByRole('link',{name:'Open original act and published formats'}).getAttribute('href'),'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0090');
  await marine.getByText(/Consolidated wording/).click();
  assert.ok((await marine.getByRole('link',{name:/Consolidated edition/}).count())>=1);
  await page.locator('#map-country').selectOption('GB');
  const uk=page.locator('#map-uk');
  await uk.locator('input').fill('Life-Saving Appliances and Arrangements');
  const regulation=uk.locator('.map-national-list > details').filter({hasText:/2020/}).first();
  await regulation.locator('summary').click();
  const earlier=regulation.locator('[data-edition]'),later=regulation.locator('[data-with]');
  await earlier.selectOption({label:'made'});await later.selectOption({label:'2022-12-19'});
  for(const label of ['made','2022-12-19']){
    const body=await readFile(new URL('./fixtures/gb-2020-501-'+label+'.xml',import.meta.url));
    await page.route('https://www.legislation.gov.uk/uksi/2020/501/'+label+'/data.xml',r=>r.fulfill({contentType:'application/xml',headers:{'Access-Control-Allow-Origin':'*'},body}));
  }
  await regulation.getByRole('button',{name:'Compare wording'}).click();
  await page.getByText('1 changed provision',{exact:true}).waitFor();
  assert.match(await page.locator('#diff-output .note').innerText(),/41 compared/);
  const change=page.locator('.patch').filter({has:page.locator('summary',{hasText:'4 · General application'})});
  await change.locator('summary').click();
  assert.match(await change.locator('.diff-line.del').allTextContents().then(lines=>lines.join(' ')),/High Speed Craft\) Regulations 2004/);
  assert.match(await change.locator('.diff-line.add').allTextContents().then(lines=>lines.join(' ')),/High Speed Craft\) Regulations 2022/);
  assert.match(decodeURIComponent(page.url()),/uk-edition:uksi\/2020\/501@2022-12-19/);
  if(!await change.locator('a').first().isVisible())await change.locator('summary').click();
  await change.getByRole('link',{name:/Later source/}).click();
  assert.equal(await page.getByRole('link',{name:'This provision at the publisher'}).getAttribute('href'),'https://www.legislation.gov.uk/uksi/2020/501/regulation/4/2022-12-19');
  await page.goto(base.href+'#map?country=NO');
  const imo=page.locator('#map-international');
  await imo.locator('[data-find]').fill('MSC.204(81)');
  const item=imo.locator('[data-choice] option').nth(1);await imo.locator('[data-choice]').selectOption(await item.getAttribute('value'));
  assert.match(await imo.locator('[data-history]').innerText(),/MSC.204\(81\)/);
}

export async function checkOwnerSourceSearch(page,base) {
  let release;
  const pending=new Promise(done=>{release=done;});
  await page.route('**/data/solas-folios.json',async request=>{await pending;await request.continue();});
  await page.goto(base.href,{waitUntil:'domcontentloaded'});
  await page.selectOption('#boat-flag','MH');await page.selectOption('#boat-shipType','recreational');
  await page.selectOption('#boat-colregWaters','high');await page.fill('#boat-lengthOverall','9.5');
  await page.click('#boat-submit');await page.getByText('Opening the source passages for your boat…').waitFor();
  release();
  const input=page.locator('#boat-law-keyword');await input.fill('look-out');
  const card=page.locator('#boat-matched .law-card');
  assert.equal(await card.count(),1);
  await card.locator('[data-read-passage]').first().click();
  assert.match(await page.locator('[data-boat-wording]').innerText(),/look-out/i);
  await page.goBack();assert.equal(await input.inputValue(),'look-out');
  await input.fill('xyzzzzz');assert.equal(await page.locator('#boat-matched .law-card').count(),0);
  await input.fill('');
  const guides=page.locator('#boat-results-view details').filter({has:page.locator('summary',{hasText:/Flag administration notices to check/})}).first();
  await guides.locator(':scope > summary').click();await guides.locator('details > summary').first().click();
  const official=guides.getByRole('link',{name:/Open original · p\./}).first();
  assert.match(await official.getAttribute('href'),/^https:\/\/.+#page=\d+$/);
}
