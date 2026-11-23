import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument, degrees} from '../site/vendor/pdf-lib.mjs';
import {publicPdfUrl, findPassages, fetchLinkedPdf, indexPassageLines, passageContext,
  passageBands, makePassagePdf} from '../site/js/passage.js';

function line(text, top, bottom) {
  return {text, top, bottom, y: bottom - 0.002};
}

test('search preserves punctuation, finds wrapped wording, and groups repeated text on a line', () => {
  const pages = [
    {page: 1, rotation: 0, lines: [line('Ship rules', .1, .12), line('15.5 m, fartsområde', .15, .17)]},
    {page: 2, rotation: 0, lines: [line('med sertifikat.', .2, .22), line('Ship ship', .24, .26)]},
  ];
  const book = indexPassageLines(pages);
  assert.deepEqual(findPassages(book, 'FARTSOMRÅDE   med'), [{first: 1, last: 2}]);
  assert.deepEqual(findPassages(book, '155 m'), []);
  assert.deepEqual(findPassages(book, 'ship'), [{first: 0, last: 0}, {first: 3, last: 3}]);
  const selected = passageContext(book, {first: 1, last: 2}, 0);
  assert.deepEqual(passageBands(book, selected), [{page: 1, top: .15, bottom: .17}, {page: 2, top: .2, bottom: .22}]);
  assert.deepEqual(passageContext(book, {first: 0, last: 0}, 10).map(item => item.page), [1, 1]);
});

test('scans, uncertain geometry, and a second print column never get an inferred crop', () => {
  assert.deepEqual(findPassages(indexPassageLines([{page: 1, rotation: 0, lines: []}]), 'boat'), []);
  for (const extra of [line('parallel column', .2, .22), {text: 'rotated stamp', y: .1}]) {
    const book = indexPassageLines([{page: 1, rotation: 0, lines: [line('boat', .2, .22), extra]}]);
    assert.throws(() => passageBands(book, passageContext(book, findPassages(book, 'boat')[0], 0)), /overlap|uncertain/);
  }
  const unsupported = indexPassageLines([{page: 1, rotation: 45, lines: [line('boat', .2, .22)]}]);
  assert.throws(() => passageBands(unsupported, unsupported.lines), /orientation/);
});

test('only explicit public HTTPS sources can trigger a browser fetch', async () => {
  assert.equal(publicPdfUrl('https://legislation.gov.uk/example.pdf#page=2'), 'https://legislation.gov.uk/example.pdf');
  for (const url of ['data:text/html,x', 'http://example.org/x', 'https://user:a@example.org/x', 'https://localhost/',
    'https://foo.localhost/', 'https://192.168.0.4/a', 'https://2130706433/a', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/']) {
    assert.equal(publicPdfUrl(url), '');
    await assert.rejects(fetchLinkedPdf(url), /public HTTPS/);
  }
});

test('a bounded HTTPS response becomes a PDF blob and oversized declared sources are rejected', async t => {
  const bytes = '%PDF-1.6';
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://gov.example.org/test.pdf');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return new Response(bytes);
  });
  assert.equal(await (await fetchLinkedPdf('https://gov.example.org/test.pdf')).text(), bytes);
  mock.mock.mockImplementation(async () => new Response(bytes, {headers: {'Content-Length': '25165825'}}));
  await assert.rejects(fetchLinkedPdf('https://gov.example.org/test.pdf'), /24 MiB/);
});

test('the clipped original retains its printed page and handles a rotated source with an offset crop box', async () => {
  const real = await readFile(new URL('../site/pdf/2020-01-14-67.pdf', import.meta.url));
  const sample = await makePassagePdf(new Blob([real]), [{page: 1, top: .4, bottom: .6}], 'Regulation', 'abc');
  const doc = await PDFDocument.load(await sample.arrayBuffer());
  const page = doc.getPage(0);
  assert.equal(doc.getPageCount(), 1);
  assert.ok(Math.abs(page.getCropBox().height - page.getMediaBox().height * .2) < .001);
  assert.match(doc.getSubject(), /Original pages 1/);
  const rotated = await PDFDocument.create();
  const originalPage = rotated.addPage([400, 600]);
  originalPage.setCropBox(10, 20, 300, 500);
  originalPage.setRotation(degrees(90));
  const crop = await makePassagePdf(new Blob([await rotated.save()]), [{page: 1, top: .2, bottom: .5}], 'Rotated', '');
  const result = (await PDFDocument.load(await crop.arrayBuffer())).getPage(0);
  assert.deepEqual(result.getCropBox(), {x: 70, y: 20, width: 90, height: 500});
  assert.equal(result.getRotation().angle, 90);
});
