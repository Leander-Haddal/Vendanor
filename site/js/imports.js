// User-supplied source material is kept in this origin's IndexedDB.
const MiB = 1024 * 1024;
export const importLimits = Object.freeze({
  pdfBytes: 24 * MiB, packBytes: 48 * MiB, pages: 600,
  documents: 200, sections: 600, textCharacters: 4_000_000,
});
const packFormat = "vessel-law-library";
const inspectedFiles = new WeakMap();
const resourceTables = new Map();
let databasePromise;

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object.");
  }
  return value;
}

function textValue(value, label, max, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string" || value.length > max) {
    throw new Error(label + " must be text of at most " + max + " characters.");
  }
  const text = value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (required && !text) throw new Error(label + " is required.");
  return text;
}

function keyValue(value, label) {
  const key = textValue(value, label, 120, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key) ||
      ["constructor", "prototype", "__proto__"].includes(key)) {
    throw new Error(label + " must be a stable letter, digit, dot, colon, dash or underscore identifier.");
  }
  return key;
}

function dateValue(value, label) {
  const date = textValue(value, label, 10);
  if (!date) return "";
  const parsed = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(label + " must be a calendar date in YYYY-MM-DD format.");
  }
  return date;
}

function urlValue(value) {
  const source = textValue(value, "Source URL", 2048);
  if (!source) return "";
  let url;
  try { url = new URL(source); } catch { throw new Error("The source URL is invalid."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The source URL must be a public HTTP or HTTPS address without credentials.");
  }
  return url.href;
}

function boundedArray(value, max, label) {
  if (!Array.isArray(value) || value.length > max) throw new Error(label + " must be a list of up to " + max + " items.");
  return value;
}

function pageNumber(value, total, label) {
  if (!Number.isInteger(value) || value < 1 || value > total) {
    throw new Error(label + " must be an original page number from 1 to " + total + ".");
  }
  return value;
}

async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function hashText(text) {
  return sha256(new TextEncoder().encode(text));
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length % 4 ||
      !/^(?:[A-Za-z0-9+/]+={0,2})?$/.test(value)) throw new Error("Invalid base64 PDF data.");
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function resourceTable(kind) {
  const filename = { cMapUrl: "cmaps.json", standardFontDataUrl: "fonts.json" }[kind];
  if (!filename) throw new Error("Unsupported PDF text resource.");
  if (!resourceTables.has(kind)) {
    const request = fetch(new URL("../vendor/" + filename, import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error("PDF text resource is unavailable.");
        return response.json();
      })
      .catch(error => { resourceTables.delete(kind); throw error; });
    resourceTables.set(kind, request);
  }
  return resourceTables.get(kind);
}

class LocalPdfResources {
  async fetch({ kind, filename }) {
    const table = await resourceTable(kind);
    if (!Object.hasOwn(table, filename)) throw new Error("Missing bundled PDF text resource.");
    return decodeBase64(table[filename]);
  }
}

function itemBand(viewport, item, style, baselineY) {
  if (!style || style.vertical || item.dir === "ttb" ||
      !Number.isFinite(style.ascent) || !Number.isFinite(style.descent) || style.ascent <= style.descent) return null;
  const [a, b, c, d] = item.transform;
  const [vx, vy, wx, wy] = viewport.transform;
  const advanceX = vx * a + wx * b;
  const advanceY = vy * a + wy * b;
  const emY = vy * c + wy * d;
  // Only horizontal visual text has a single baseline across the whole item.
  // Rotation in the PDF page and in the text matrix both affect that decision.
  if (!Number.isFinite(emY) || !emY || !advanceX || Math.abs(advanceY) > Math.abs(advanceX) * 0.001) return null;
  const ascent = baselineY + emY * style.ascent / viewport.height;
  const descent = baselineY + emY * style.descent / viewport.height;
  const top = Math.max(0, Math.min(ascent, descent));
  const bottom = Math.min(1, Math.max(ascent, descent));
  return top < bottom ? { top, bottom } : null;
}

async function readPage(page, remaining) {
  const viewport = page.getViewport({ scale: 1 });
  const reader = page.streamTextContent().getReader();
  const lines = [];
  const styles = new Map();
  let line = "";
  let y = 0;
  let size = 0;
  let top = 1;
  let bottom = 0;
  let completeBand = true;
  function finishLine() {
    const entry = { y, text: line.trim() };
    if (completeBand && top < bottom) Object.assign(entry, { top, bottom });
    lines.push(entry);
    line = "";
    top = 1;
    bottom = 0;
    completeBand = true;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const [name, style] of Object.entries(chunk.value.styles || {})) styles.set(name, style);
      for (const item of chunk.value.items) {
        if (typeof item.str !== "string") continue;
        const point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const nextY = point[1] / viewport.height;
        if (line && Math.abs(nextY - y) > 0.006) finishLine();
        if (!line) y = nextY;
        if (item.str.trim()) {
          const band = itemBand(viewport, item, styles.get(item.fontName), nextY);
          if (band) {
            top = Math.min(top, band.top);
            bottom = Math.max(bottom, band.bottom);
          } else completeBand = false;
        }
        line += item.str + " ";
        size += item.str.length + 1;
        if (size > remaining) throw new Error("The extracted text exceeds the local import limit.");
        if (item.hasEOL) finishLine();
      }
    }
    if (line.trim()) finishLine();
    return { page: page.pageNumber, rotation: viewport.rotation, text: lines.map(item => item.text).join("\n").trim(), lines };
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); page.cleanup(); }
  }
}

export async function loadPdfBytes(bytes) {
  return loadPdfSource({data:bytes});
}

export async function loadPdfSource(source) {
  const pdfjs = await import("../vendor/pdfjs.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.mjs", import.meta.url).href;
  return pdfjs.getDocument({
    ...source, BinaryDataFactory: LocalPdfResources, useWorkerFetch: false,
    disableFontFace: true, useSystemFonts: false, useWasm: false, useWasmSimd: false,
    disableWorkerRendering: true, enableXfa: false, isEvalSupported: false,
    verbosity: 0,
  });
}

export async function inspectPdf(file, onProgress) {
  if (!(file instanceof Blob) || !file.size || file.size > importLimits.pdfBytes) {
    throw new Error("Choose a nonempty PDF up to 24 MiB.");
  }
  if (!(await file.slice(0, 1024).text()).includes("%PDF-")) throw new Error("The file has no PDF header.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fingerprint = await sha256(bytes);
  const task = await loadPdfBytes(bytes);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > importLimits.pages) throw new Error("The PDF exceeds the 600-page import limit.");
    const pages = [];
    let characters = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const result = await readPage(await pdf.getPage(i), importLimits.textCharacters - characters);
      pages.push(result);
      characters += result.text.length;
      if (typeof onProgress === "function") onProgress(i, pdf.numPages);
    }
    const inspection = { pageCount: pdf.numPages, pages, sha256: fingerprint };
    inspectedFiles.set(inspection, file);
    return inspection;
  } catch (error) {
    if (error.name === "PasswordException") throw new Error("Import an unlocked copy of this PDF.");
    throw error;
  } finally {
    await task.destroy();
  }
}

function normalizeFields(raw) {
  const fields = [];
  const keys = new Set();
  for (const value of boundedArray(raw ?? [], 64, "Field definitions")) {
    const field = record(value, "Field");
    const key = keyValue(field.key ?? field.id, "Field key");
    if (keys.has(key)) throw new Error("Duplicate field key: " + key);
    keys.add(key);
    if (!["number", "date", "select", "text"].includes(field.type)) throw new Error("Unknown field type for " + key + ".");
    const out = { key, label: textValue(field.label, "Field label", 160, true), type: field.type };
    if (field.unit) out.unit = textValue(field.unit, "Field unit", 80);
    if (field.help) out.help = textValue(field.help, "Field help", 1000);
    if (field.type === "select") {
      const seen = new Set();
      out.options = boundedArray(field.options, 100, "Select options").map(option => {
        const data = typeof option === "string" ? { value: option, label: option } : record(option, "Option");
        const value = textValue(data.value, "Option value", 100, true);
        if (seen.has(value)) throw new Error("Duplicate option for " + key + ".");
        seen.add(value);
        return { value, label: textValue(data.label, "Option label", 160, true) };
      });
      if (!out.options.length) throw new Error("A select field needs at least one option.");
    }
    if (field.source) {
      const source = record(field.source, "Field source");
      out.source = {
        versionId: keyValue(source.versionId, "Source version"),
        sectionId: keyValue(source.sectionId, "Source section"),
      };
    }
    fields.push(out);
  }
  return fields;
}

function normalizeCriteria(raw, fields, depth = 0, budget = { count: 0 }) {
  if (raw == null && depth === 0) return null;
  const value = record(raw, "Applicability expression");
  if (depth > 10 || ++budget.count > 150) throw new Error("Applicability expression is too complex.");
  for (const op of ["all", "any", "not"]) {
    if (!Object.hasOwn(value, op)) continue;
    if (Object.keys(value).length !== 1) throw new Error("An applicability group must have one operator.");
    if (op === "not") return { not: normalizeCriteria(value.not, fields, depth + 1, budget) };
    const children = boundedArray(value[op], 40, "Applicability group");
    if (!children.length) throw new Error("An applicability group needs a condition.");
    return { [op]: children.map(child => normalizeCriteria(child, fields, depth + 1, budget)) };
  }
  if (Object.keys(value).some(key => !["field", "op", "value", "source"].includes(key))) {
    throw new Error("Unknown applicability expression member.");
  }
  const field = keyValue(value.field, "Criterion field");
  if (!["eq", "neq", "lt", "lte", "gt", "gte"].includes(value.op)) throw new Error("Unknown criterion operator.");
  const equality = value.op === "eq" || value.op === "neq";
  const spec = fields.find(item => item.key === field);
  let expected = value.value;
  if (typeof expected === "number") {
    if (!Number.isFinite(expected) || (spec && spec.type !== "number")) throw new Error("Invalid number for " + field + ".");
  } else {
    expected = textValue(expected, "Criterion value", 160, true);
    if (spec?.type === "number") throw new Error("A numeric criterion requires a JSON number.");
    if (spec?.type === "date" || !equality) dateValue(expected, "Date criterion");
    if (spec?.type === "select" && !spec.options.some(item => item.value === expected)) {
      throw new Error("Unknown selection for " + field + ".");
    }
  }
  if (spec && ["select", "text"].includes(spec.type) && !equality) throw new Error("Text criteria require equality or inequality.");
  const leaf = { field, op: value.op, value: expected };
  if (value.source) {
    if (typeof value.source === "string") leaf.source = textValue(value.source, "Criterion source", 300);
    else {
      const source = record(value.source, "Criterion source");
      leaf.source = { versionId: keyValue(source.versionId, "Source version"), sectionId: keyValue(source.sectionId, "Source section") };
    }
  }
  return leaf;
}

function fraction(value, fallback) {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Crop bounds must be fractions between 0 and 1.");
  return value;
}

function sectionText(inspection, from, to, top, bottom) {
  const parts = [];
  for (let n = from; n <= to; n++) {
    const page = inspection.pages[n - 1];
    const start = n === from ? top : 0;
    const end = n === to ? bottom : 1;
    parts.push(start === 0 && end === 1 ? page.text :
      page.lines.filter(line => line.y >= start && line.y <= end).map(line => line.text).join("\n"));
  }
  return parts.join("\n\n").trim();
}

function normalizeSections(raw, inspection, fields) {
  if (raw == null && inspection) {
    raw = inspection.pages.map(page => ({
      key: "p-" + page.page, label: "Page " + page.page, title: "Original page " + page.page,
      fromPage: page.page, toPage: page.page,
    }));
  }
  const sections = [];
  const seen = new Set();
  let total = 0;
  for (const item of boundedArray(raw, importLimits.sections, "Sections")) {
    const data = record(item, "Section");
    const key = keyValue(data.key ?? data.id ?? ("s-" + (sections.length + 1)), "Section key");
    if (seen.has(key)) throw new Error("Duplicate section key: " + key);
    seen.add(key);
    const label = textValue(data.label ?? data.number ?? key, "Section label", 180, true);
    const title = textValue(data.title ?? label, "Section title", 300, true);
    let fromPage = null;
    let toPage = null;
    let supplied = textValue(data.text, "Section text", importLimits.textCharacters);
    const top = fraction(data.top, 0);
    const bottom = fraction(data.bottom, 1);
    if (inspection) {
      fromPage = pageNumber(data.fromPage ?? 1, inspection.pageCount, "Section start");
      toPage = pageNumber(data.toPage ?? fromPage, inspection.pageCount, "Section end");
      if (toPage < fromPage || top === 1 || bottom === 0 || (fromPage === toPage && top >= bottom)) {
        throw new Error("The section bounds leave an empty or reversed excerpt.");
      }
      if (!supplied) supplied = sectionText(inspection, fromPage, toPage, top, bottom);
    } else if (!supplied || data.fromPage != null || data.toPage != null || top !== 0 || bottom !== 1) {
      throw new Error("A text-only section requires text and cannot reference PDF pages.");
    }
    total += supplied.length;
    if (total > importLimits.textCharacters) throw new Error("Document text exceeds four million characters.");
    const caveat = textValue(data.caveat, "Section note", 2000) ||
      (!supplied ? "This page has no embedded text. Consult the original image or add a transcription." : "");
    sections.push({ key, label, title, fromPage, toPage, top, bottom, text: supplied,
      criteria: normalizeCriteria(data.criteria ?? data.conditions, fields), caveat });
  }
  if (!sections.length) throw new Error("Add at least one section.");
  return sections;
}

async function prepareDocument(input, file, inspection) {
  const data = record(input, "Document metadata");
  const fileName = textValue(data.fileName ?? file?.name, "PDF filename", 300);
  const title = textValue(data.title ?? fileName.replace(/\.pdf$/i, ""), "Document title", 300, true);
  const authority = textValue(data.authority, "Issuing authority", 200);
  const jurisdiction = textValue(data.jurisdiction, "Jurisdiction", 120);
  const language = textValue(data.language, "Language", 64);
  const date = dateValue(data.date ?? data.publishedOn, "Publication date");
  const effectiveFrom = dateValue(data.effectiveFrom, "Effective from");
  const effectiveTo = dateValue(data.effectiveTo, "Effective until");
  if (effectiveFrom && effectiveTo && effectiveTo <= effectiveFrom) {
    throw new Error("The exclusive end date must follow the effective start date.");
  }
  const revision = textValue(data.revision, "Revision label", 180) || date || "Imported edition";
  const fields = normalizeFields(data.fields);
  const sections = normalizeSections(data.sections, inspection, fields);
  const familyId = data.familyId ? keyValue(data.familyId, "Document family") :
    "f-" + (await hashText(JSON.stringify([title, authority, jurisdiction].map(value => value.toLowerCase())))).slice(0, 24);
  const normalized = {
    familyId, title, authority, jurisdiction, language, date, effectiveFrom, effectiveTo, revision,
    sourceUrl: urlValue(data.sourceUrl), notes: textValue(data.notes, "Revision notes", 4000),
    fields, sections, fileName, hasPdf: Boolean(file), pdfSha256: inspection?.sha256 ?? "",
    pageCount: inspection?.pageCount ?? 0,
  };
  const fingerprint = await hashText(JSON.stringify(normalized));
  const id = data.id ? keyValue(data.id, "Revision ID") : "v-" + fingerprint.slice(0, 32);
  return { doc: { ...normalized, id, fingerprint, importedAt: new Date().toISOString() }, file };
}

async function libraryDatabaseName() {
  const directory = new URL("../", import.meta.url);
  const prefix = "maritime-law-library:";
  const name = prefix + directory.pathname;
  if (!directory.pathname.endsWith("/site/") || !indexedDB.databases) return name;
  // Earlier root-hosted builds served the modules one directory higher.
  const previous = prefix + new URL("../", directory).pathname;
  const databases = await indexedDB.databases().catch(() => []);
  return !databases.some(db => db.name === name) && databases.some(db => db.name === previous) ? previous : name;
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Local browser storage is unavailable."));
  if (databasePromise) return databasePromise;
  databasePromise = libraryDatabaseName().then(name => new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    let blocked = false;
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore("documents", { keyPath: "id" });
      opening.result.createObjectStore("originals");
    };
    opening.onblocked = () => {
      blocked = true;
      reject(new Error("Close the other tab using this library, then retry."));
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  })).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDocuments(entries) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "originals"], "readwrite");
    const documents = tx.objectStore("documents");
    const originals = tx.objectStore("originals");
    let conflict;
    const saved = new Map();
    tx.oncomplete = () => resolve(entries.map(entry => saved.get(entry.doc.id)));
    tx.onabort = () => reject(conflict ?? tx.error ?? new Error("The local import was interrupted."));
    for (const { doc, file } of entries) {
      const query = documents.get(doc.id);
      query.onsuccess = () => {
        if (query.result) {
          if (query.result.fingerprint !== doc.fingerprint) {
            conflict = new Error("Revision ID " + doc.id + " already belongs to different content. Choose a new revision ID.");
            tx.abort();
          } else saved.set(doc.id, query.result);
          return;
        }
        documents.add(doc);
        if (file) originals.add(file, doc.id);
        saved.set(doc.id, doc);
      };
    }
  });
}

export async function savePdf(file, metadata = {}, inspection) {
  if (!inspection || inspectedFiles.get(inspection) !== file) inspection = await inspectPdf(file);
  const entry = await prepareDocument(metadata, file, inspection);
  const [saved] = await storeDocuments([entry]);
  return saved;
}

export async function saveText(file) {
  if (!(file instanceof Blob) || !file.size || file.size > 4 * importLimits.textCharacters) {
    throw new Error("Choose a nonempty UTF-8 text file with up to four million characters.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch { throw new Error("Save this document as UTF-8 plain text, then try again."); }
  if (text.includes("\u0000")) throw new Error("Choose a UTF-8 plain text file.");
  if (text.length > importLimits.textCharacters) throw new Error("Document text exceeds four million characters.");
  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("This text file is empty.");

  const paragraphBreak = /\n(?:[ \t]*\n)+/;
  const paragraphs = paragraphBreak.test(text);
  const blocks = text.split(paragraphs ? paragraphBreak : "\n");
  const groupSize = Math.ceil(blocks.length / importLimits.sections);
  const sections = [];
  for (let i = 0; i < blocks.length; i += groupSize) {
    const number = sections.length + 1;
    sections.push({ key: "s-" + number, label: "Passage " + number,
      text: blocks.slice(i, i + groupSize).join(paragraphs ? "\n\n" : "\n") });
  }
  const fileName = file.name || "Document.txt";
  const entry = await prepareDocument({ fileName, title: fileName.replace(/\.txt$/i, "") || fileName, sections }, null, null);
  const [saved] = await storeDocuments([entry]);
  return saved;
}

export async function listImports() {
  const db = await openDatabase();
  const docs = await requestResult(db.transaction("documents").objectStore("documents").getAll());
  return docs.sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id));
}

export async function removeImport(id) {
  keyValue(id, "Revision ID");
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "originals"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("The local removal was interrupted."));
    tx.objectStore("documents").delete(id);
    tx.objectStore("originals").delete(id);
  });
}

async function getLocalPdf(id) {
  keyValue(id, "Revision ID");
  const db = await openDatabase();
  const tx = db.transaction(["documents", "originals"]);
  const [doc, file] = await Promise.all([
    requestResult(tx.objectStore("documents").get(id)), requestResult(tx.objectStore("originals").get(id)),
  ]);
  if (!doc || !file) throw new Error("This local revision has no stored original PDF.");
  return { doc, file };
}

export async function openImportPdf(id, page = 1) {
  const { doc, file } = await getLocalPdf(id);
  pageNumber(page, doc.pageCount, "Original page");
  return URL.createObjectURL(file.slice(0, file.size, "application/pdf")) + "#page=" + page;
}

export function cropTopToBottom(page, top, bottom) {
  top = fraction(top, 0);
  bottom = fraction(bottom, 1);
  if (top >= bottom) throw new Error("A PDF excerpt needs a positive height.");
  if (top === 0 && bottom === 1) return;
  const { x, y, width, height } = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const span = bottom - top;
  if (rotation === 90) page.setCropBox(x + width * top, y, width * span, height);
  else if (rotation === 270) page.setCropBox(x + width * (1 - bottom), y, width * span, height);
  else if (rotation === 180) page.setCropBox(x, y + height * top, width, height * span);
  else page.setCropBox(x, y + height * (1 - bottom), width, height * span);
}

export async function openImportClip(id, sectionId) {
  const { doc, file } = await getLocalPdf(id);
  const section = doc.sections.find(item => item.key === sectionId);
  if (!section) throw new Error("The selected section is unavailable in this local edition.");
  if (section.fromPage === 1 && section.toPage === doc.pageCount && section.top === 0 && section.bottom === 1) {
    return URL.createObjectURL(file.slice(0, file.size, "application/pdf"));
  }
  const { PDFDocument } = await import("../vendor/pdf-lib.mjs");
  const original = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const excerpt = await PDFDocument.create({ updateMetadata: false });
  const indices = [];
  for (let p = section.fromPage; p <= section.toPage; p++) indices.push(p - 1);
  const pages = await excerpt.copyPages(original, indices);
  for (let i = 0; i < pages.length; i++) {
    cropTopToBottom(pages[i], i === 0 ? section.top : 0, i === pages.length - 1 ? section.bottom : 1);
    excerpt.addPage(pages[i]);
  }
  excerpt.setTitle(doc.title + " · " + section.label);
  const bytes = await excerpt.save();
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function revokeImportPdf(url) {
  if (typeof url === "string" && url.startsWith("blob:")) URL.revokeObjectURL(url.split("#")[0]);
}

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  const parts = [];
  for (let start = 0; start < bytes.length; start += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 24_576))));
  }
  return parts.join("");
}

export async function importPack(file) {
  if (!(file instanceof Blob) || !file.size || file.size > importLimits.packBytes) {
    throw new Error("Choose a nonempty JSON law pack up to 48 MiB.");
  }
  let pack;
  try {
    pack = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
  } catch { throw new Error("This file is not a valid UTF-8 JSON law pack."); }
  if (pack?.format !== packFormat || pack.schemaVersion !== 1) {
    throw new Error("Use law pack format vessel-law-library, schemaVersion 1.");
  }
  const docs = boundedArray(pack.documents, importLimits.documents, "Pack documents");
  if (!docs.length) throw new Error("The law pack has no documents.");
  const seen = new Set();
  const entries = [];
  for (const input of docs) {
    const data = record(input, "Pack document");
    let original = null;
    let inspection = null;
    if (data.pdf != null) {
      const pdf = record(data.pdf, "Embedded PDF");
      if (typeof pdf.base64 !== "string" || !pdf.base64 || pdf.base64.length > Math.ceil(importLimits.pdfBytes / 3) * 4) {
        throw new Error("An embedded PDF exceeds the 24 MiB limit or has no bytes.");
      }
      original = new Blob([decodeBase64(pdf.base64)], { type: "application/pdf" });
      inspection = await inspectPdf(original);
      if (pdf.sha256 != null && pdf.sha256 !== inspection.sha256) throw new Error("An embedded PDF failed its SHA-256 check.");
    }
    const entry = await prepareDocument(data, original, inspection);
    if (seen.has(entry.doc.id)) throw new Error("Duplicate revision ID inside this pack: " + entry.doc.id);
    seen.add(entry.doc.id);
    entries.push(entry);
  }
  return storeDocuments(entries);
}

export async function exportPack(documentIds) {
  const requested = documentIds == null ? null : new Set(boundedArray(documentIds, importLimits.documents, "Selected documents"));
  const db = await openDatabase();
  const tx = db.transaction(["documents", "originals"]);
  const [documents, fileIds, files] = await Promise.all([
    requestResult(tx.objectStore("documents").getAll()),
    requestResult(tx.objectStore("originals").getAllKeys()),
    requestResult(tx.objectStore("originals").getAll()),
  ]);
  const originals = new Map(fileIds.map((id, i) => [id, files[i]]));
  const selected = documents.filter(doc => !requested || requested.has(doc.id));
  if (!selected.length) throw new Error("There are no local documents to export.");
  if (requested && selected.length !== requested.size) throw new Error("A selected local revision is unavailable.");
  if (selected.length > importLimits.documents) throw new Error("Export a selection of up to 200 local revisions.");
  const chunks = ['{"format":"' + packFormat + '","schemaVersion":1,"documents":['];
  let size = chunks[0].length + 3;
  for (const doc of selected) {
    const { fingerprint, importedAt, pageCount, hasPdf, pdfSha256, ...metadata } = doc;
    if (hasPdf) {
      const original = originals.get(doc.id);
      if (!original) throw new Error("Missing original PDF for " + doc.title + ".");
      if (size + Math.ceil(original.size / 3) * 4 > importLimits.packBytes) {
        throw new Error("This pack exceeds 48 MiB. Export fewer revisions together.");
      }
      metadata.pdf = { sha256: pdfSha256, base64: await encodeFile(original) };
    }
    const part = JSON.stringify(metadata);
    size += new Blob([part]).size + 1;
    if (size > importLimits.packBytes) throw new Error("This pack exceeds 48 MiB. Export fewer revisions together.");
    if (chunks.length > 1) chunks.push(",");
    chunks.push(part);
  }
  chunks.push("]}");
  return new Blob(chunks, { type: "application/json" });
}

export function importToFolio(doc, officialFields = []) {
  const id = "local-" + doc.familyId;
  const versionId = "local-" + doc.id;
  const fieldKeys = new Map();
  const fields = doc.fields.map(field => {
    const official = officialFields.find(known => known.key === field.key);
    const compatible = official && field.type === official.type &&
      (field.unit || "") === (official.unit || "") &&
      (field.type !== "select" || field.options.every(option => official.options.some(o => o.value === option.value)));
    const key = compatible ? field.key : id + "." + field.key;
    fieldKeys.set(field.key, key);
    const source = field.source?.versionId === doc.id ? {...field.source, versionId} : field.source;
    return {...field, key, source};
  });
  function bindCriteria(rule) {
    if (!rule) return null;
    if (rule.all) return {all: rule.all.map(bindCriteria)};
    if (rule.any) return {any: rule.any.map(bindCriteria)};
    if (rule.not) return {not: bindCriteria(rule.not)};
    return {...rule, field: fieldKeys.get(rule.field) || rule.field};
  }
  const sections = doc.sections.map(section => {
    const pages = [];
    if (section.fromPage != null) {
      for (let p = section.fromPage; p <= section.toPage; p++) pages.push(p);
    }
    return {
      id: section.key, number: section.label, title: section.title, text: section.text, pages,
      criteria: bindCriteria(section.criteria), screeningLevel: section.criteria ? "section" : "unmapped",
      caveat: section.caveat, localId: doc.id,
    };
  });
  return {
    id, title: doc.title, shortTitle: doc.title, authority: doc.authority || "User-supplied",
    jurisdiction: doc.jurisdiction || "Unspecified", language: doc.language, fields,
    versions: [{
      id: versionId, localId: doc.id, label: doc.revision, publishedOn: doc.date || null,
      effectiveFrom: doc.effectiveFrom || null, effectiveTo: doc.effectiveTo || null,
      sourceUrl: doc.sourceUrl, hasPdf: doc.hasPdf, kind: "local-import", notes: doc.notes, sections,
    }],
  };
}
