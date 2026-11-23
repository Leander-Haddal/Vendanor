"""Build the searchable Norwegian maritime collection from Lovdata's open XML archives."""

import argparse
import bz2
import collections
import hashlib
import html.entities
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
import unicodedata
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


API = "https://api.lovdata.no/v1/publicData/"
PUBLISHER = "https://lovdata.no/dokument/"
ARCHIVES = re.compile(r"^(?:lovtidend-avd1-\d{4}(?:-\d{4})?|gjeldende-(?:lover|sentrale-forskrifter))\.tar\.bz2$")
LEGAL_REF = re.compile(r"\b(lov|forskrift)/(\d{4}-\d\d-\d\d-\d+)", re.I)
CORE_ACTS = {"LOV-2007-02-16-9", "LOV-1994-06-24-39", "LOV-1998-06-26-47", "LOV-2013-06-21-102"}
VESSEL_TITLE = re.compile(
    r"\b(?:skip(?:et|ene|s)?|skipsfart\w*|skipsarbeid\w*|skipssikker\w*|skipsregist\w*|"
    r"lasteskip\w*|passasjerskip\w*|fiskefartøy\w*|fritidsfartøy\w*|fritidsbåt\w*|"
    r"småbåt\w*|sjøfolk\w*|sjøfart\w*|sjødyktig\w*|sjøloven|skipsfører\w*|sjøveisregl\w*)\b",
    re.I,
)
SHIPPING_SUBJECT = re.compile(r"\b(?:skipsfart|sjørett|sjøfart)\b", re.I)
WORD = re.compile(r"[^\W_]+")
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
PARAGRAPHS = {"article", "p", "section", "div", "ol", "ul", "li", "br", "table", "tr", "figure", *HEADINGS}
SHARD_BYTES = 1_100_000
# Individually retrieved publisher PDFs. Each first page was checked against its formal ID.
PDFS = {
    "FOR-2020-01-14-63": ("2020/sf-20200114-0063", "e3cd7a05db8e89da52a4811d1220324906c1ca44bc7b4df9df7472b463c72ae7"),
    "FOR-2020-01-14-67": ("2020/sf-20200114-0067", "3305c4a976463e1cea249ba0fc9d523a5e39c757511f2e50adf09958088ec806"),
    "FOR-2022-06-28-1234": ("2022/sf-20220628-1234", "c0070a2811bf3bb05c6317268e05638926fc1ba3651257d88138f3003ef4ddc6"),
    "FOR-2025-12-16-2652": ("2025/sf-20251216-2652", "eedab4c406938f78c498e550d9dbac90def6c8ad8de1b3bdea858135dd1da9a7"),
    "FOR-2025-12-17-2671": ("2025/sf-20251217-2671", "819fda135ee1280db860a1c444de4096e546525a61dddfce60dd620c612a48b0"),
}


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def open_url(url):
    return urlopen(Request(url, headers={"User-Agent": "MaritimeLawRegister/1.0 (Lovdata open-data reader)"}), timeout=120)


def get_archives(cache, offline):
    cache.mkdir(parents=True, exist_ok=True)
    catalogue = cache / "catalog.json"
    previous = json.loads(catalogue.read_text("utf-8")) if catalogue.exists() else []
    if offline:
        rows = previous
    else:
        with open_url(API + "list") as response:
            rows = json.load(response)
    selected = sorted((r for r in rows if ARCHIVES.fullmatch(r["filename"])), key=lambda r: r["filename"])
    if not {"gjeldende-lover.tar.bz2", "gjeldende-sentrale-forskrifter.tar.bz2"} <= {r["filename"] for r in selected} or not any(r["filename"].startswith("lovtidend-") for r in selected):
        raise ValueError("Missing expected national archives in the Lovdata catalogue.")
    archives = []
    for row in selected:
        name, size = row["filename"], int(row["sizeBytes"])
        path = cache / name
        complete = path.is_file() and path.stat().st_size == size and row in previous
        if not complete:
            if offline:
                raise ValueError(f"Uncached or incomplete publication: {name}")
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
                temp = Path(output.name)
            try:
                with open_url(API + "get/" + name) as response, temp.open("wb") as output:
                    while chunk := response.read(512 * 1024):
                        output.write(chunk)
                        if output.tell() > size:
                            raise ValueError(f"Publication changed during retrieval: {name}")
                if temp.stat().st_size != size:
                    raise ValueError(f"Incomplete publication: {name}")
                os.replace(temp, path)
            finally:
                temp.unlink(missing_ok=True)
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        archives.append((path, {**row, "sizeBytes": size, "url": API + "get/" + name, "sha256": digest}))
    if not offline:
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as new:
            new.write(packed(rows))
        os.replace(new.name, catalogue)
    return archives


def xml_members(path, wanted=None):
    with bz2.open(path, "rb") as decompressed, tarfile.open(fileobj=decompressed, mode="r|", bufsize=65536) as stream:
        for item in stream:
            if item.isfile() and item.name.lower().endswith(".xml") and (wanted is None or item.name in wanted):
                if item.size > 200_000_000:
                    raise ValueError(f"Unexpected XML member size: {path.name}/{item.name}")
                yield item.name, stream.extractfile(item).read()


def parse_xml(value):
    try:
        return ET.fromstring(value)
    except ET.ParseError:
        # Some publisher XHTML uses named HTML entities outside the five XML names.
        def replace_entity(match):
            name = match[1].decode("ascii")
            if name not in {"amp", "lt", "gt", "quot", "apos"} and name + ";" in html.entities.html5:
                return html.entities.html5[name + ";"].encode("utf-8")
            return match[0]
        return ET.fromstring(re.sub(rb"&([a-zA-Z][a-zA-Z0-9]+);", replace_entity, value))


def clean(value):
    return " ".join(value.split())


def inline(node):
    return clean("".join(node.itertext())) if node is not None else ""


def formal_refs(node):
    if node is None:
        return []
    values = [*node.itertext(), *(a.get("href", "") for a in node.iter("a"))]
    return sorted({
        ("LOV-" if prefix.lower() == "lov" else "FOR-") + date
        for value in values for prefix, date in LEGAL_REF.findall(value)
    })


def read_header(raw):
    start, end = raw.find(b"<header"), raw.find(b"</header>")
    if start < 0 or end < 0:
        raise ValueError("The XML document has no publisher header.")
    fields = {n.get("class"): n for n in parse_xml(raw[start:end + 9]).findall("./dl/dd")}
    def field(name):
        return inline(fields.get(name))
    key, legal_id, title = field("dokid"), field("legacyID"), field("title")
    if not key or not legal_id or not title:
        raise ValueError(f"Missing identity fields: {key!r}, {legal_id!r}")
    date = re.search(r"\d{4}-\d\d-\d\d", legal_id)
    if not date:
        raise ValueError(f"Unrecognized instrument date: {legal_id!r}")
    published = re.match(r"\d{4}-\d\d-\d\d", field("dateOfPublication"))
    bases, targets = formal_refs(fields.get("basedOn")), formal_refs(fields.get("changesToDocuments"))
    authority = "sjøfartsdirektoratet" in field("subunit").lower() or bool(
        re.search(r"(?:fastsatt|fastsett|vedtatt|vedteke) av sjøfartsdirektoratet", field("miscInformation"), re.I)
    )
    seed = bool(legal_id in CORE_ACTS or authority or CORE_ACTS.intersection(bases)
                or SHIPPING_SUBJECT.search(field("legalArea")) or VESSEL_TITLE.search(title))
    record = {
        "id": key, "legalId": legal_id, "title": title, "date": date[0],
        "publishedDate": published[0] if published else None,
        "effectiveText": field("dateInForce") or None,
        "kind": "gazette" if key.startswith("LTI/") else "consolidated",
        "sourceUrl": PUBLISHER + quote(key, safe="/-"), "targets": targets,
    }
    if record["kind"] == "consolidated":
        record["lastChangeInForceText"] = field("lastChangeInForce") or None
    if record["kind"] == "gazette" and legal_id in PDFS:
        filename, sha = PDFS[legal_id]
        record.update(pdfUrl=f"https://lovdata.no/static/lovtidend/ltavd1/{filename}.pdf", pdfSha256=sha)
    return record, seed


def discover(archives):
    candidates, direct, history, scanned = {}, set(CORE_ACTS), set(), {}
    for path, _ in archives:
        scanned[path.name] = 0
        for member, raw in xml_members(path):
            scanned[path.name] += 1
            try:
                record, seed = read_header(raw)
            except (ValueError, ET.ParseError) as error:
                raise ValueError(f"{path.name}/{member}: {error}") from error
            if seed:
                direct.add(record["legalId"])
                if record["kind"] == "consolidated":
                    for note in re.finditer(rb'<article\b[^>]*class="changesToParent"[^>]*>.*?</article>', raw, re.S):
                        history.update(formal_refs(parse_xml(note[0])))
            if record["id"] in candidates:
                old_path, old_member, _ = candidates[record["id"]]
                variant = r"-(?:nn|nb|en)\.xml$"
                if old_path == path and re.sub(variant, ".xml", old_member) == re.sub(variant, ".xml", member):
                    if re.search(variant, member):
                        continue
                else:
                    raise ValueError(f"Duplicate publisher ID: {record['id']} ({old_member}, {member})")
            candidates[record["id"]] = (path, member, record)
        print(f"Read {scanned[path.name]:,} document headers from {path.name}", flush=True)
    matched = []
    for path, member, record in candidates.values():
        if record["legalId"] in direct or record["legalId"] in history or direct.intersection(record["targets"]):
            matched.append((path, member, record))
    return matched, scanned


def render(node):
    parts = [node.text or ""]
    for i, child in enumerate(node):
        block = child.tag in PARAGRAPHS
        if block:
            parts.append("\n")
        if node.tag in {"ul", "ol"} and child.tag == "li":
            marker = child.get("data-name") or child.get("data-li-identifier") or child.get("value")
            if not marker and node.tag == "ol":
                marker = chr(97 + i) if node.get("type") == "a" and i < 26 else str(i + 1)
            parts.append((marker + " ") if marker else "• ")
        if child.get("class") == "changesToParent":
            parts.append("[Endringsnote] ")
        parts.append(render(child))
        if block:
            parts.append("\n")
        if child.tag in {"td", "th"}:
            parts.append(" | ")
        parts.append(child.tail or "")
    return "".join(parts)


def tidy_lines(value):
    return "\n".join(line for raw in value.splitlines() if (line := clean(raw)))


def sections_from_xml(raw, record):
    main = parse_xml(raw).find("./body/main")
    if main is None:
        raise ValueError("Missing documentBody in " + record["id"])
    sections, omitted = [], 0
    def collect(node, inherited):
        nonlocal omitted
        heading = next((child for child in node if child.tag in HEADINGS), None)
        label = inline(heading) or inherited
        if node is not main and (re.match(r"^(?:vedlegg|anneks|appendiks|appendix|bilag)\b", label, re.I)
                                 or re.match(r"^(?:vedlegg|anneks)", node.get("data-name", ""), re.I)):
            omitted += 1
            return
        fragment = node.get("id", "")
        page = node.get("data-lovdata-URL", "")
        if page.startswith(record["id"] + "/"):
            url = PUBLISHER + quote(page, safe="/-")
        else:
            url = record["sourceUrl"] + ("#" + quote(fragment, safe="-") if fragment else "")
        kind = node.get("class", "")
        if kind in {"legalArticle", "change"}:
            if heading is None and kind == "change" and len(node):
                first = inline(node[0])
                label = first if first and len(first) <= 160 else inherited
            text = tidy_lines(render(node))
            if heading is not None and text.split("\n", 1)[0] == inline(heading):
                text = text.partition("\n")[2]
            if text:
                section = {"label": label, "text": text, "sourceUrl": url}
                if logical_key := node.get("data-name"):
                    section["key"] = logical_key
                revisions = sorted({ref for child in node if child.get("class") == "changesToParent"
                                    for ref in formal_refs(child)})
                if revisions:
                    section["amendments"] = revisions
                for attr, operation in (("data-repeal-part", "repeal"), ("data-add-new-part", "addition"),
                                        ("data-move-part", "move"), ("data-change-part", "substitution")):
                    if node.get(attr):
                        section.update(operation=operation, target=node.get(attr))
                        break
                sections.append(section)
            return
        pending = []
        if node.text and node.text.strip():
            pending.append(node.text)
        def flush():
            if text := tidy_lines("\n".join(pending)):
                sections.append({"label": label, "text": text, "sourceUrl": url})
            pending.clear()
        for child in node:
            if child.tag in HEADINGS:
                continue
            if child.tag == "section" or child.get("class") in {"legalArticle", "change", "document-change"}:
                flush()
                collect(child, label)
            else:
                pending.append(render(child))
            if child.tail and child.tail.strip():
                pending.append(child.tail)
        flush()
    collect(main, record["title"])
    return sections, omitted


def tokens(text):
    return {word for word in WORD.findall(unicodedata.normalize("NFC", text).lower()) if 2 <= len(word) <= 80}


def build(out, archives):
    selected, scanned = discover(archives)
    selected.sort(key=lambda value: (value[2]["date"], value[2]["id"]), reverse=True)
    by_archive = collections.defaultdict(dict)
    for ordinal, (path, member, record) in enumerate(selected):
        by_archive[path][member] = (ordinal, record)
    postings, families = collections.defaultdict(list), collections.defaultdict(list)
    for path, _ in archives:
        for member, raw in xml_members(path, by_archive[path]):
            ordinal, record = by_archive[path][member]
            sections, omitted = sections_from_xml(raw, record)
            record.update(sectionCount=len(sections), omittedAppendices=omitted)
            words = tokens(record["title"] + " " + record["legalId"])
            for section in sections:
                words.update(tokens(section["label"] + " " + section["text"]))
            for word in words:
                postings[word].append(ordinal)
            year = record["date"][:4]
            group = year if record["kind"] == "gazette" else "current-" + year[:3] + "0"
            obj = packed({"id": record["id"], "sections": sections})
            families[group].append((record, obj))
    out.mkdir(parents=True, exist_ok=True)
    old_shards = set()
    index_path = out / "gazette.json"
    if index_path.is_file():
        previous = json.loads(index_path.read_text("utf-8"))
        old_shards = {r["shard"] for r in previous["records"]} | {previous["searchIndex"]}
    new_shards = set()
    with tempfile.TemporaryDirectory(prefix="maritime-gazette-", dir=out.parent) as tmp:
        stage = Path(tmp)
        for group, docs in sorted(families.items()):
            batch, count = [], 0
            def emit():
                payload = b'{"schemaVersion":1,"records":[' + b",".join(doc for _, doc in batch) + b"]}\n"
                digest = hashlib.sha256(payload).hexdigest()[:14]
                name = f"gazette-{group}-{digest}.json"
                (stage / name).write_bytes(payload)
                new_shards.add(name)
                for record, _ in batch:
                    record["shard"] = name
            for record, obj in sorted(docs, key=lambda d: d[0]["id"]):
                if batch and count + len(obj) > SHARD_BYTES:
                    emit()
                    batch, count = [], 0
                batch.append((record, obj))
                count += len(obj) + 1
            if batch:
                emit()
        text_index = {"schemaVersion": 1, "terms": {word: sorted(ids) for word, ids in sorted(postings.items())}}
        search_bytes = packed(text_index) + b"\n"
        search_file = "gazette-search-" + hashlib.sha256(search_bytes).hexdigest()[:14] + ".json"
        (stage / search_file).write_bytes(search_bytes)
        records = [r for _, _, r in selected]
        dates = [r["publishedDate"] for r in records if r["kind"] == "gazette" and r["publishedDate"]]
        coverage = {
            "jurisdiction": "Norway", "language": "Norwegian", "archiveFiles": [meta for _, meta in archives],
            "scanned": scanned, "gazetteCount": sum(r["kind"] == "gazette" for r in records),
            "consolidatedCount": sum(r["kind"] == "consolidated" for r in records),
            "sectionCount": sum(r["sectionCount"] for r in records),
            "firstNoticePublished": min(dates), "lastNoticePublished": max(dates),
            "snapshotDate": max(meta["lastModified"] for _, meta in archives)[:10],
            "selection": "National section I gazette and current national acts/regulations. Includes NMA-issued texts, shipping subject classifications, vessel-title matches, four core maritime acts and their implementing instruments, instruments amending these, and change notes cited by selected consolidations.",
            "limitations": "Gazette texts are enactments and amendment notices, not historical consolidations. Current consolidated texts represent the archive snapshot; adoption year is not a version date. Gazette starts in 2001. Local regulations, other jurisdictions, third-party standards, embedded graphics and labelled appendices are outside this text extraction. Legal applicability requires reading the original scope and exceptions.",
        }
        index = {"schemaVersion": 1, "source": {"name": "Lovdata · Norsk Lovtidend and consolidated legislation",
                 "url": API + "list", "licence": "NLOD 2.0", "licenceUrl": "https://data.norge.no/nlod/en/2.0"},
                 "searchIndex": search_file, "coverage": coverage, "records": records}
        (stage / "gazette.json").write_bytes(packed(index) + b"\n")
        for path in sorted(stage.iterdir(), key=lambda p: p.name == "gazette.json"):
            os.replace(path, out / path.name)
    for name in old_shards - new_shards - {search_file}:
        if name == "gazette-search.json" or re.fullmatch(r"gazette-(?:search|(?:current-)?\d{4})-[a-f0-9]{14}\.json", name):
            (out / name).unlink(missing_ok=True)
    print(f"Indexed {len(records):,} documents, {coverage['sectionCount']:,} sections, "
          f"{len(postings):,} distinct terms and {len(new_shards)} text shards.", flush=True)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "maritime-public-lovdata-v1")
    cli.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "site" / "data")
    cli.add_argument("--offline", action="store_true", help="Rebuild from complete previously downloaded archives.")
    options = cli.parse_args()
    build(options.out, get_archives(options.cache_dir, options.offline))


if __name__ == "__main__":
    main()
