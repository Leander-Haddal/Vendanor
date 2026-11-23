"""Build source-preserving provision PDFs and the Norwegian maritime folio index."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from urllib.request import Request, urlopen

try:
    import pymupdf
except ModuleNotFoundError:
    pymupdf = None

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
MANIFEST = ROOT / "tools" / "folio-sources.json"
INDEX = SITE / "data" / "folios.json"
SECTION = re.compile(r"^§\s*(\d+)\.?\s+(.*)")
MARGIN = 5


def write_bytes(path, data):
    """Publish one complete file, including when a rebuild is interrupted."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return
    with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        name = stream.name
        stream.write(data)
    try:
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def source_bytes(source, refresh):
    path = SITE / "pdf" / (source["id"] + ".pdf")
    if path.exists() and not refresh:
        data = path.read_bytes()
    else:
        request = Request(source["url"], headers={"User-Agent": "Maritime regulation source archive/1.0"})
        with urlopen(request, timeout=90) as response:
            data = response.read()
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError(f"{source['id']}: publisher bytes differ from the reviewed PDF")
    write_bytes(path, data)
    return data


def page_lines(page):
    result = []
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]:
        for line in block.get("lines", []):
            spans = [span for span in line["spans"] if span["text"].strip()]
            if spans:
                value = "".join(span["text"] for span in line["spans"]).strip()
                result.append((line["bbox"], value, spans[0]["font"]))
    return sorted(result, key=lambda row: (round(row[0][1], 1), row[0][0]))


def section_starts(pages, source):
    """Recognize the publishers' heading typography, skipping indexes and quoted laws."""
    starts = {}
    chapters = []
    last = source.get("sectionCount", 0)
    first_page = source.get("firstSectionPage", 1) - 1
    for pi, lines in enumerate(pages):
        if pi < first_page or len(starts) == last:
            continue
        for index, (box, value, font) in enumerate(lines):
            if value.startswith("Kapittel ") and "Bold" in font:
                chapters.append((pi, box[1]))
            match = SECTION.match(value)
            if not match or int(match[1]) != len(starts) + 1 or not any(s in font for s in ("Bold", "Italic")):
                continue
            number = int(match[1])
            title = [match[2].strip()]
            # Wrapped heading lines keep the heading's italic face.
            for _, rest, next_font in lines[index + 1:]:
                if "Ital" not in next_font or rest.startswith("§"):
                    break
                title.append(rest)
            starts[number] = ((pi, box[1]), " ".join(title))
            if number == last:
                break
    if len(starts) != last:
        raise ValueError(f"{source['id']}: located {len(starts)} of {last} consecutive headings")
    return starts, chapters


def anchor(pages, point):
    page_number, prefix = point
    lines = pages[page_number - 1]
    matches = [box[1] for box, value, _ in lines if value == prefix]
    if not matches:
        matches = [box[1] for box, value, _ in lines if value.startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"page {page_number}: expected one line starting with {prefix!r}, found {len(matches)}")
    return page_number - 1, matches[0]


def extract_sections(source, pages, version):
    starts, chapters = section_starts(pages, source)
    end = anchor(pages, source["bodyEnd"]) if "bodyEnd" in source else (len(pages), 0)
    result = []
    for number, (start, title) in starts.items():
        following = starts[number + 1][0] if number + 1 in starts else end
        stop = min([following] + [point for point in chapters if start < point < following])
        group = next((g for g in version.get("ruleGroups", []) if g["first"] <= number <= g["last"]), {})
        details = {k: v for k, v in group.items() if k in ("rule", "caveat", "screeningLevel")}
        details.update(version.get("rules", {}).get(str(number), {}))
        result.append(({"id": f"s{number}", "number": f"§ {number}", "title": title, **details}, start, stop))
    for item in source.get("excerpts", []):
        label = {k: v for k, v in item.items() if k not in ("begin", "end")}
        stop = anchor(pages, item["end"]) if item.get("end") else end
        result.append((label, anchor(pages, item["begin"]), stop))
    return result


def expand_rule(rule, definitions):
    if isinstance(rule, str):
        return expand_rule(definitions[rule], definitions)
    if isinstance(rule, list):
        field, op, value, source = rule
        return {"field": field, "op": op, "value": value, "source": source}
    if not rule:
        return None
    key, children = next(iter(rule.items()))
    if key == "not":
        return {key: expand_rule(children, definitions)}
    return {key: [expand_rule(item, definitions) for item in children]}


def regions(doc, pages, start, stop, publisher):
    """Find occupied body strips, excluding running heads, footers and chapter titles."""
    output = []
    for pi in range(start[0], min(stop[0] + 1, len(pages))):
        lo = start[1] if pi == start[0] else 0
        hi = stop[1] if pi == stop[0] else doc[pi].rect.height
        # A single blank margin separates the earliest body baseline from page numbers.
        if publisher != "nma-annex":
            lo = max(lo, 54)
            hi = min(hi, 776 if publisher == "nma" else 743)
        visible = [box for box, _, _ in pages[pi] if lo - 0.1 <= box[1] < hi - 0.1]
        if not visible:
            continue
        upper = min(box[1] for box in visible)
        lower = max(box[3] for box in visible)
        # A ruled table may extend below the last baseline or begin above the first.
        # Preserve its border and any diagrams even when text alone occupies less space.
        for shape in doc[pi].get_drawings():
            rect = shape["rect"]
            if lo - MARGIN <= rect.y0 and rect.y1 <= hi and rect.width > 0:
                upper = min(upper, rect.y0)
                lower = max(lower, rect.y1)
        max_above = max((box[3] for box, _, _ in pages[pi] if box[3] <= upper), default=0)
        min_below = min((box[1] for box, _, _ in pages[pi] if box[1] >= lower), default=doc[pi].rect.height)
        top = max(upper - MARGIN, (upper + max_above) / 2)
        bottom = min(lower + MARGIN, (lower + min_below) / 2)
        output.append((pi, pymupdf.Rect(0, top, doc[pi].rect.width, bottom)))
    if not output:
        raise ValueError(f"No source text between {start} and {stop}")
    return output


def words(text):
    return re.sub(r"\s+", "", text)


def clip_source(doc, strips, title):
    """Remove neighbouring text before clipping. Compare embedded text after serialization."""
    extracted = []
    with pymupdf.open() as output:
        for pi, strip in strips:
            original = doc[pi]
            body = original.get_text("text", clip=strip, sort=True)
            extracted.append(body.strip())
            output.insert_pdf(doc, from_page=pi, to_page=pi, links=False, annots=False, widgets=False)
            page = output[-1]
            for outer in [pymupdf.Rect(0, 0, page.rect.width, strip.y0),
                          pymupdf.Rect(0, strip.y1, page.rect.width, page.rect.height)]:
                if outer.height > 0:
                    page.add_redact_annot(outer, fill=None, cross_out=False)
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
            page.set_cropbox(strip)
        output.set_metadata({"title": title})
        content = output.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1)
    with pymupdf.open(stream=content, filetype="pdf") as proof:
        for index, page in enumerate(proof):
            if words(page.get_text("text", sort=True)) != words(extracted[index]):
                raise ValueError(f"{title}: cropped page {index + 1} differs from its source strip")
            page.set_cropbox(page.mediabox)
            if words(page.get_text("text", sort=True)) != words(extracted[index]):
                raise ValueError(f"{title}: neighbouring text remains outside the visible crop")
    return content, "\n\n".join(extracted)


def build_version(config, version, source, refresh, sources):
    if source["id"] not in sources:
        data = source_bytes(source, refresh)
        doc = pymupdf.open(stream=data, filetype="pdf")
        sources[source["id"]] = (doc, [page_lines(page) for page in doc])
    doc, pages = sources[source["id"]]
    entries = extract_sections(source, pages, version)
    indexed = []
    for item, start, stop in entries:
        if "include" in version and item["id"] not in version["include"]:
            continue
        if "exclude" in version and item["id"] in version["exclude"]:
            continue
        strips = regions(doc, pages, start, stop, source["publisher"])
        relative = Path("pdf", "sections", version["id"], item["id"] + ".pdf")
        content, text = clip_source(doc, strips, item["number"] + " " + item["title"])
        write_bytes(SITE / relative, content)
        entry = {k: v for k, v in item.items() if k not in ("rule", "caveat")}
        rule = item.get("rule", version.get("scope"))
        entry.update(text=text, pages=[pi + 1 for pi, _ in strips], clip=relative.as_posix(),
                     criteria=expand_rule(rule, config["criteria"]),
                     screeningLevel=item.get("screeningLevel", "section" if rule and "rule" in item else "instrument" if rule else "unmapped"),
                     caveat=" ".join(filter(None, [version.get("scopeNote"), item.get("caveat")])))
        indexed.append(entry)
    if not indexed:
        raise ValueError(f"{version['id']}: no indexed provisions")
    output = {k: v for k, v in version.items() if k not in ("file", "include", "exclude", "rules", "ruleGroups", "scope", "scopeNote")}
    output.update(sourceUrl=source["url"], sourcePage=source["page"], pdf=f"pdf/{source['id']}.pdf",
                  pdfSha256=source["sha256"], sections=indexed)
    return output


def add_passenger_consolidation(book):
    """Index the register's actual consolidated wording and provision URLs."""
    record_id = "SF/forskrift/2020-01-14-63"
    archive = json.loads((INDEX.parent / "gazette.json").read_text(encoding="utf-8"))
    meta = next(row for row in archive["records"] if row["id"] == record_id)
    shard = json.loads((INDEX.parent / meta["shard"]).read_text(encoding="utf-8"))
    record = next(row for row in shard["records"] if row["id"] == record_id)
    if meta["lastChangeInForceText"] != "2026-01-01" or len(record["sections"]) != 19:
        raise ValueError("Review the amended passenger regulation and its vessel conditions")
    instrument = next(row for row in book["instruments"] if row["id"] == meta["legalId"])
    original = {s["number"].replace(" ", ""): s for s in instrument["versions"][0]["sections"]}
    sections = []
    for published in record["sections"]:
        prior = original[published["key"]]
        entry = {k: prior[k] for k in ("id", "number", "criteria", "screeningLevel")}
        entry.update(title=published["label"].split(".", 1)[1].strip(), text=published["text"],
                     sourceUrl=published["sourceUrl"])
        sections.append(entry)
    edition_id = "no-pax-consolidated-2026"
    instrument["versions"] = [v for v in instrument["versions"] if v["id"] != edition_id]
    instrument["versions"].append({
        "id": edition_id, "kind": "Consolidated text", "label": "2026 consolidated regulation",
        "language": "nb", "effectiveFrom": meta["lastChangeInForceText"], "editionDate": meta["lastChangeInForceText"],
        "scopeChange": {"from": "2026-01-01", "when": {"field": "offshoreTransfer", "op": "eq",
                        "value": "no", "source": "2025/2652 § 158(5), amending 2020/63 § 1(2)(c)"}},
        "verifiedThrough": max(archive["coverage"]["snapshotDate"], "2026-11-23"),
        "sourceUrl": meta["sourceUrl"], "sourcePage": meta["sourceUrl"], "archiveRecord": record_id,
        "sourceLinks": ["https://www.sdir.no/siteassets/engelske-forskrifter-pdf/14-january-2020-no.-63-vessels-of-less-than-24-metres-carrying-12-passengers-or-less2.pdf"],
        "notes": ["Lovdata consolidated text. Each section links to its published Norwegian wording. The Norwegian Maritime Authority's English translation records the same amendments through 1 January 2026."],
        "sections": sections
    })


def save_index(book):
    write_bytes(INDEX, (json.dumps(book, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--refresh", action="store_true", help="re-fetch and verify every pinned publisher PDF")
    arguments.add_argument("--consolidation-only", action="store_true", help="update the consolidated text from the local Lovdata archive")
    args = arguments.parse_args()
    if args.consolidation_only:
        output = json.loads(INDEX.read_text(encoding="utf-8"))
        add_passenger_consolidation(output)
        save_index(output)
        return
    if pymupdf is None:
        arguments.error("Building the PDF excerpts requires PyMuPDF")

    config = json.loads(MANIFEST.read_text(encoding="utf-8"))
    output = {k: config[k] for k in ("version", "checkedAt", "fields", "comparisons")}
    output["instruments"] = []
    sources = {}
    try:
        for instrument in config["instruments"]:
            versions = [build_version(config, v, config["sources"][v["file"]], args.refresh, sources)
                        for v in instrument["versions"]]
            output["instruments"].append({**instrument, "versions": versions})
            print(instrument["id"], sum(len(v["sections"]) for v in versions), "provision clips", flush=True)
    finally:
        for doc, _ in sources.values():
            doc.close()
    keys = {(v["id"], s["id"]) for i in output["instruments"] for v in i["versions"] for s in v["sections"]}
    references = [f["source"] for f in output["fields"]] + [c[d] for c in output["comparisons"] for d in ("before", "after")]
    for reference in references:
        if (reference["versionId"], reference["sectionId"]) not in keys:
            raise ValueError(f"Unresolved folio reference {reference}")
    add_passenger_consolidation(output)
    save_index(output)


if __name__ == "__main__":
    main()
