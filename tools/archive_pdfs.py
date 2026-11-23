"""Verify individual Gazette originals and map exact section text to PDF crop rectangles."""

import argparse
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree as ET

from gazette import open_url, packed


SOURCE_ROOT = "https://lovdata.no"
LOCAL_NAME = re.compile(r"^(sf|nl)-(\d{4})(\d{2})(\d{2})-(\d+)\.pdf$")
ID = re.compile(r"^LTI/(forskrift|lov)/(\d{4})-(\d{2})-(\d{2})-(\d+)$")
MAX_SOURCE_BYTES = 24_000_000
MAP_VERSION = 1
LIGATURES = str.maketrans({"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "\u00ad": ""})


class PublicationLinks(HTMLParser):
    """Read the explicitly labelled PDF version link from an individual Gazette landing page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.href = None
        self.label = []
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_data(self, data):
        if self.href:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.href:
            label = " ".join("".join(self.label).lower().split())
            if label in {"pdf-versjon", "pdf-versjon av kunngjøringen", "pdf version"}:
                candidate = urljoin(SOURCE_ROOT, self.href)
                if official_pdf(candidate):
                    self.urls.append(candidate)
            self.href = None


def official_pdf(url):
    target = urlsplit(url)
    return (target.scheme == "https" and target.netloc == "lovdata.no"
            and re.fullmatch(r"/static/lovtidend/ltavd1/\d{4}/[\w.-]+\.pdf", target.path)
            and not target.query and not target.fragment)


def download(url, maximum):
    with open_url(url) as response:
        final = urlsplit(response.geturl())
        if final.scheme != "https" or final.netloc != "lovdata.no":
            raise ValueError("Unexpected publisher redirect.")
        raw = response.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError("Source exceeds the byte budget.")
        return raw


def original_url(record):
    if record.get("pdfUrl") and official_pdf(record["pdfUrl"]):
        return record["pdfUrl"]
    if record["sourceUrl"] != SOURCE_ROOT + "/dokument/" + record["id"]:
        raise ValueError("Unexpected publisher landing page.")
    page = PublicationLinks()
    page.feed(download(record["sourceUrl"], 5_000_000).decode("utf-8"))
    candidates = set(page.urls)
    return candidates.pop() if len(candidates) == 1 else None


def glyphs(text):
    return "".join(unicodedata.normalize("NFC", text).translate(LIGATURES).split())


@dataclass(frozen=True)
class Line:
    page: int
    top: float
    bottom: float
    text: str


def read_pdf(path, record):
    args = ["pdftotext", "-bbox-layout", "-enc", "UTF-8", str(path), "-"]
    raw = subprocess.run(args, capture_output=True, check=True, timeout=90).stdout
    pages = ET.fromstring(raw).findall(".//{*}page")
    if not pages:
        raise ValueError("PDF has no readable pages.")
    publication = ID.fullmatch(record["id"])
    _, year, month, day, number = publication.groups()
    identity = re.compile(rf"{int(day):02d}\.{int(month):02d}\.{year}\s+nr\.?\s+0*{int(number)}", re.I)
    id_found, first_page, footer_ids, lines = False, [], set(), []
    for page_number, page in enumerate(pages, 1):
        height = float(page.attrib["height"])
        for tag in page.findall(".//{*}line"):
            text = " ".join(w.text or "" for w in tag.findall("./{*}word")).strip()
            top, bottom = float(tag.attrib["yMin"]) / height, float(tag.attrib["yMax"]) / height
            if not (math.isfinite(top) and math.isfinite(bottom) and 0 <= top < bottom <= 1):
                raise ValueError("Unsupported PDF line coordinates.")
            if page_number == 1:
                first_page.append(text)
                id_found |= bool(top < .6 and identity.fullmatch(text))
            if top > .86 and re.search(r"rettelser.*lovdata\.no/", text, re.I):
                footer_ids.update(re.findall(r"(?:www\.)?lovdata\.no/(?:dokument/)?(LTI/(?:forskrift|lov)/[\d-]+)", text))
                continue
            if top < .09 and text == str(page_number):
                continue
            if glyphs(text):
                lines.append(Line(page_number, top, bottom, text))
    title_present = glyphs(record["title"]) in glyphs(" ".join(first_page))
    if not id_found or (footer_ids != {record["id"]} if footer_ids else not title_present):
        raise ValueError("Printed date/number and publication identity could not be verified.")
    return len(pages), lines


def exact_sections(sections, lines):
    starts, page_lines = [], defaultdict(list)
    parts, offset = [], 0
    for index, line in enumerate(lines):
        starts.append(offset)
        value = glyphs(line.text)
        parts.append(value)
        offset += len(value)
        page_lines[line.page].append(index)
    text = "".join(parts)
    starts.append(len(text))
    matches = {}
    for ordinal, section in enumerate(sections):
        label, body = glyphs(section["label"]), glyphs(section["text"])
        if not body:
            continue
        alternatives = [label + body, body] if label else [body]
        for needle in alternatives:
            if len(needle) < 16:
                continue
            start = text.find(needle)
            end = start + len(needle)
            if start < 0 or text.find(needle, start + 1) != -1:
                continue
            first, last = bisect_right(starts, start) - 1, bisect_right(starts, end - 1) - 1
            if starts[first] != start or starts[last + 1] != end:
                continue
            boxes = []
            for page in range(lines[first].page, lines[last].page + 1):
                source_lines = page_lines[page]
                used = [lines[i] for i in source_lines if first <= i <= last]
                if not used:
                    break
                top, bottom = min(l.top for l in used), max(l.bottom for l in used)
                if any(lines[i].bottom > top and lines[i].top < bottom
                       for i in source_lines if not first <= i <= last):
                    break
                boxes.append({"page": page, "top": math.floor(top * 1e7) / 1e7,
                              "bottom": math.ceil(bottom * 1e7) / 1e7})
            else:
                matches[str(ordinal)] = boxes
                break
    return matches


def local_sources(directory):
    sources = {}
    if directory:
        if not directory.is_dir():
            raise ValueError(f"Missing local PDF directory: {directory}")
        for path in directory.glob("*.pdf"):
            if m := LOCAL_NAME.fullmatch(path.name.lower()):
                kind, year, month, day, number = m.groups()
                law = "forskrift" if kind == "sf" else "lov"
                sources[f"LTI/{law}/{year}-{month}-{day}-{int(number)}"] = path
    return sources


def folio_sources(site):
    catalogue = site / "data" / "folios.json"
    sources = {}
    if catalogue.is_file():
        for instrument in json.loads(catalogue.read_text("utf-8"))["instruments"]:
            for version in instrument["versions"]:
                key = version["sourcePage"].removeprefix(SOURCE_ROOT + "/dokument/")
                if (ID.fullmatch(key) and official_pdf(version["sourceUrl"])
                        and version["pdf"] == "pdf/" + key.rsplit("/", 1)[1] + ".pdf"
                        and re.fullmatch(r"[a-f0-9]{64}", version["pdfSha256"])):
                    sources[key] = version
    return sources


def save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        name = Path(temp.name)
    try:
        name.write_bytes(payload)
        os.replace(name, path)
    finally:
        name.unlink(missing_ok=True)


def write_manifest(path, current):
    payload = packed({"schemaVersion": 1, "records": dict(sorted(current.items()))}) + b"\n"
    if not path.exists() or path.read_bytes() != payload:
        save(path, payload)


def enrich(site, pdf_dir, chosen, offline, limit, byte_budget):
    if not shutil.which("pdftotext"):
        raise ValueError("Install Poppler's pdftotext to read publisher coordinates.")
    manifest = site / "data" / "originals.json"
    index = json.loads((site / "data" / "gazette.json").read_text("utf-8"))
    current = json.loads(manifest.read_text("utf-8"))["records"] if manifest.exists() else {}
    datasets = {r["id"]: r for r in index["records"] if r["kind"] == "gazette"}
    local = local_sources(pdf_dir)
    folios = folio_sources(site)
    for key in chosen:
        if key not in datasets or not ID.fullmatch(key):
            raise ValueError(f"Unknown Gazette document: {key}")
    queue = list(dict.fromkeys([*chosen, *sorted(local), *sorted(folios), *sorted(current),
                                *(key for key, r in datasets.items() if r.get("pdfUrl"))]))
    processed, consumed, failures = 0, 0, []
    cache = {}
    with tempfile.TemporaryDirectory(prefix="maritime-original-") as tmp:
        working = Path(tmp) / "source.pdf"
        for key in queue:
            if key not in datasets or not ID.fullmatch(key):
                continue
            record, previous = datasets[key], current.get(key, {})
            if record["shard"] not in cache:
                shard = json.loads((site / "data" / record["shard"]).read_text("utf-8"))
                cache[record["shard"]] = {r["id"]: r["sections"] for r in shard["records"]}
            sections = cache[record["shard"]][key]
            xml_digest = hashlib.sha256(packed([(s["label"], s["text"]) for s in sections])).hexdigest()
            saved = None
            if re.fullmatch(r"pdf/(?:archive/(?:sf|nl)-[\d-]+-[a-f0-9]{16}|\d{4}-\d{2}-\d{2}-\d+)\.pdf", previous.get("asset", "")):
                saved = site / previous["asset"]
            folio = folios.get(key, {})
            folio_path = site / folio["pdf"] if folio else None
            try:
                source = local.get(key)
                if source is None and folio_path is not None and folio_path.is_file():
                    source = folio_path
                if source is None and saved is not None and saved.is_file():
                    source = saved
                url = folio.get("sourceUrl") or record.get("pdfUrl") or previous.get("sourceUrl") or record["sourceUrl"]
                if source:
                    if source.stat().st_size > MAX_SOURCE_BYTES:
                        raise ValueError("Individual PDF exceeds the size limit.")
                    raw = source.read_bytes()
                    digest = hashlib.sha256(raw).hexdigest()
                    if (previous.get("xmlTextSha256") == xml_digest and previous.get("mappingVersion") == MAP_VERSION
                            and previous.get("sourceShard") == record["shard"]
                            and previous.get("sha256") == digest and saved is not None and saved.exists()
                            and (source == saved or hashlib.sha256(saved.read_bytes()).hexdigest() == digest)):
                        continue
                if processed >= limit or consumed >= byte_budget:
                    break
                if not source and offline:
                    continue
                processed += 1
                if not source:
                    # Non-bulk website access is limited to individual publications selected by ID or known official links.
                    url = original_url(record) if not official_pdf(url) else url
                    if url is None:
                        print(f"No labelled original PDF: {key}", flush=True)
                        continue
                    raw = download(url, min(MAX_SOURCE_BYTES, byte_budget - consumed))
                    digest = hashlib.sha256(raw).hexdigest()
                if len(raw) > byte_budget - consumed:
                    break
                consumed += len(raw)
                checksums = {value for value in (record.get("pdfSha256"), folio.get("pdfSha256")) if value}
                if not raw.startswith(b"%PDF-") or (checksums and checksums != {digest}):
                    raise ValueError("PDF signature or pinned source checksum mismatch.")
                working.write_bytes(raw)
                pages, lines = read_pdf(working, record)
                boxes = exact_sections(sections, lines)
                _, law, date = key.split("/")
                day, number = date.rsplit("-", 1)
                name = f"{'sf' if law == 'forskrift' else 'nl'}-{day.replace('-', '')}-{int(number):04d}-{digest[:16]}.pdf"
                asset = "pdf/archive/" + name
                if folio_path is not None and folio_path.is_file() and hashlib.sha256(folio_path.read_bytes()).hexdigest() == digest:
                    asset = folio["pdf"]
                if not (site / asset).is_file() or hashlib.sha256((site / asset).read_bytes()).hexdigest() != digest:
                    save(site / asset, raw)
                current[key] = {"asset": asset, "sourceUrl": url, "sha256": digest, "pages": pages,
                                "sections": boxes, "sourceShard": record["shard"],
                                "xmlTextSha256": xml_digest, "mappingVersion": MAP_VERSION}
                write_manifest(manifest, current)
                print(f"{key}: {len(boxes)}/{len(sections)} exact section ranges, {pages} pages.", flush=True)
            except (ValueError, URLError, OSError, subprocess.SubprocessError, ET.ParseError) as error:
                if isinstance(error, HTTPError) and error.code in (404, 410):
                    print(f"Publisher PDF unavailable: {key}", flush=True)
                else:
                    failures.append((key, str(error)))
    write_manifest(manifest, current)
    print(f"Verified originals: {len(current)}; linked sections: {sum(len(r['sections']) for r in current.values())}.", flush=True)
    if failures:
        raise ValueError("Unverified sources: " + repr(failures))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    cli.add_argument("--pdf-dir", type=Path, help="Directory of individually obtained official sf-/nl-YYYYMMDD-NNNN.pdf files.")
    cli.add_argument("--id", action="append", default=[], help="Select an individual LTI/forskrift/... or LTI/lov/... publication.")
    cli.add_argument("--offline", action="store_true", help="Only use verified previous assets and local source files.")
    cli.add_argument("--limit", type=int, default=8, help="Maximum originals to process per run.")
    cli.add_argument("--byte-budget", type=int, default=24_000_000, help="Maximum PDF bytes to process per run.")
    args = cli.parse_args()
    if args.limit < 1 or args.byte_budget < 1:
        cli.error("Budgets must be positive.")
    enrich(args.site, args.pdf_dir, args.id, args.offline, args.limit, args.byte_budget)


if __name__ == "__main__":
    main()
