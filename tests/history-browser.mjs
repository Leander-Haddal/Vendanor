import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function checkLawHistory(page,base){
  const stem='https://www.legislation.gov.uk/uksi/2020/501';
  const before='uk-edition:uksi/2020/501@made', after='uk-edition:uksi/2020/501@2022-12-19';
  for(const edition of ['made','2022-12-19']){
    await page.route(stem+'/'+edition+'/data.xml',async route=>route.fulfill({contentType:'application/xml',headers:{'Access-Control-Allow-Origin':'*'},
      body:await readFile(new URL('./fixtures/gb-2020-501-'+edition+'.xml',import.meta.url))}));
  }
  await page.goto(base.href+'#changes?'+new URLSearchParams({before,after}));
  await page.locator('#diff-output .diff-line.add').first().waitFor();
  assert.match(await page.locator('#diff-output').innerText(),/High Speed Craft/);
  await page.goto(base.href+'#library?doc=eu%3A32014L0090');
  await page.locator('#reader h2').filter({hasText:/marine equipment/i}).waitFor();
  assert.ok(await page.locator('#section-choice option').count()>1);
  await page.goto(base.href+'#library?source=imo&q='+encodeURIComponent('MSC.204(81)'));
  await page.locator('#result-list button').filter({hasText:'MSC.204(81)'}).first().click();
  await page.locator('#reader .lawtext').filter({hasText:'MSC.204(81)'}).waitFor();
}
