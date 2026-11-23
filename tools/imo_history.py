"""Index the IMO depositary chronology, status-book page references and State marks."""

import argparse
from collections import defaultdict
from datetime import date
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
from tempfile import gettempdir
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pymupdf

from countries import name_key
from folios import write_bytes


SITE = Path(__file__).resolve().parents[1] / "site"
LANDING = "https://www.imo.org/en/about/conventions/pages/statusofconventions.aspx"
CDN = "https://wwwcdn.imo.org/localresources/en/About/Conventions/StatusOfConventions/"
FILES = {
    "list.docx": ("List of the Conventions and their amendments March 2026.docx", "497666b542cb2a4ce85cf6b348531bd3aff9f0706a8b238c55acf79140760836"),
    "states.xlsx": ("x-Status.xlsx", "1085838dd4ee544c67877ea8ea488842397f57cae2fa6292185dc1dd8eefa947"),
    "vol1.pdf": ("Status book 2026 - Vol. I SOLAS-COLREG- MARPOL.pdf", "70ad59fa1786051db70476070b8f80a0a8379ef981af65193be1c9a563c06c73"),
    "vol2.pdf": ("Status 2026 - Vol. II.pdf", "c1f7c09ab25d76fe826789530bf1a13baf157c745c90ab9097929521c0711cfd"),
}
WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SHEET = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MONTHS = "January February March April May June July August September October November December".split()
DAY = re.compile(r"(?<!\d)(\d{1,2})\s*(" + "|".join(MONTHS) + r")\s*(\d{4})(?!\d)", re.I)
NUMBERED = re.compile(r"^\((\d+)\)\s*(?:\([abc]\))?\s*", re.I)
YEAR = re.compile(r"^(?:19|20)\d{2}\s")
RESOLUTION = re.compile(r"(?<![A-Z])\b(MSC|MEPC|A|FAL|LDC|LC|LP|LEG)\s*\.\s*(\d+)\s*\(\s*(\d+|[IVXLCDM]+)\s*\)?", re.I)

# The numbered list, its corresponding status-book physical pages, and the
# separately labelled columns in the ratification/accession workbook.
PRIMARY = [
    ("solas-1974", 1, 10, "D"), ("solas-1978-protocol", 1, 86, "E"), ("solas-1988-protocol", 1, 94, "F"),
    ("colreg-1972", 1, 105, "K"), ("marpol", 1, 119, "Z AA AB AC"), ("marpol-1997-protocol", 1, 189, "AD"),
    ("fal-1965", 2, 7, "Y"), ("load-lines-1966", 2, 25, "H"), ("load-lines-1988-protocol", 2, 44, "I"),
    ("tonnage-1969", 2, 53, "J"), ("intervention-1969", 2, 63, "AG"), ("intervention-1973-protocol", 2, 72, "AH"),
    ("clc-1969", 2, 80, "AI"), ("clc-1976-protocol", 2, 92, "AJ"), ("clc-1992-protocol", 2, 98, "AK"),
    ("stp-1971", 2, 107, "S"), ("space-stp-1973", 2, 109, "T"), ("nuclear-1971", 2, 111, "AO"),
    ("fund-1971", 2, 114, ""), ("fund-1976-protocol", 2, 122, "AL"), ("fund-1992-protocol", 2, 128, "AM"),
    ("fund-2000-protocol", 2, 138, ""), ("fund-2003-protocol", 2, 140, "AN"), ("csc-1972", 2, 145, "L"),
    ("pal-1974", 2, 159, "AP"), ("pal-1976-protocol", 2, 163, "AQ"), ("pal-1990-protocol", 2, 168, "AR"),
    ("pal-2002-protocol", 2, 170, "AS"), ("imso-1976", 2, 180, "U"), ("inmarsat-oa", 2, 198, "V"),
    ("llmc-1976", 2, 209, "AT"), ("llmc-1996-protocol", 2, 223, "AU"), ("sfv-1993-protocol", 2, 328, "N"),
    ("cape-town-2012", 2, 330, "O"), ("stcw-1978", 2, 237, "P"), ("stcw-f-1995", 2, 255, "Q"),
    ("sar-1979", 2, 259, "R"), ("sua-1988", 2, 270, "AV"), ("sua-2005", 2, 283, "AX"),
    ("sua-protocol-1988", 2, 290, "AW"), ("sua-protocol-2005", 2, 300, "AY"),
    ("salvage-1989", 2, 308, "AZ"), ("oprc-1990", 2, 319, "BA"), ("oprc-hns-2000", 2, 325, "BD"),
    ("hns-1996", 2, 335, "BB"), ("hns-2010-protocol", 2, 338, "BC"), ("london-1972", 2, 386, "AE"),
    ("london-1996-protocol", 2, 398, "AF"), ("afs-2001", 2, 353, "BF"), ("bunkers-2001", 2, 343, "BE"),
    ("bwm-2004", 2, 360, "BG"), ("nairobi-2007", 2, 370, "BH"), ("hong-kong-2009", 2, 378, "BI"),
]

# Zero-based Word paragraph positions in the pinned source. Each entry is a
# separate heading in the chronology; codes do not carry their own State marks.
CHILDREN = {
    303: "ibc", 344: "igc", 385: "grain", 392: "hsc-1994", 419: "hsc-2000",
    447: "css-1-9", 451: "organization-authorization", 458: "organization-survey",
    462: "enhanced-survey-guidelines", 488: "ism", 510: "lsa", 537: "ftp", 549: "ftp-2010",
    556: "inf", 568: "corrugated-bulkheads", 572: "fss", 606: "imdg", 637: "isps",
    643: "inspection-access", 649: "single-skin-bulk-carriers", 653: "bulk-carrier-hatches",
    657: "ballast-tank-coatings", 665: "casualty-investigation", 670: "intact-stability-2008",
    684: "imsbc", 707: "goal-based-construction", 711: "cargo-oil-tank-coatings",
    719: "cargo-oil-tank-corrosion", 723: "esp-2011", 745: "noise", 753: "ro", 757: "polar",
    761: "igf", 777: "lifeboat-maintenance", 787: "ip", 795: "stability-agreement",
    1117: "ibc", 1162: "bch", 1197: "ro", 1201: "polar", 1658: "stcw-code",
    1695: "stcw-f-code", 1840: "bwms",
}
TITLE_ENDS = {665: 666, 670: 672, 777: 778, 795: 798, 1658: 1659, 1695: 1696}
GROUP_HEADINGS = {301, 793, 1115, 1656}
COUNTRY_NAMES = {
    "Dem. People's Rep. Korea": "KP", "Dem. Rep. of the Congo": "CD", "Eswatini (former Swaziland)": "SZ",
    "Lao People's Dem. Rep.": "LA", "Micronesia (Fed. States of)": "FM", "Nauru": "NR",
    "Netherlands (Kingdom of)": "NL", "St. Vincent & Grenadines": "VC", "United Kingdom": "GB",
    "United Rep. of Tanzania": "TZ", "United States": "US", "Venezuela": "VE",
    "Hong Kong, China": "HK", "Macao, China": "MO", "Faroes": "FO",
}

# Publisher footnotes qualify these dates or the status of related instruments.
# Short factual notes keep the qualifications alongside the corresponding event.
QUALIFICATIONS = {
    780: (4, "The date follows the entry into force of SOLAS resolution MSC.404(96)."),
    835: (5, "The list supplies an acceptance condition in footnote 5 without a calendar date."),
    1414: (8, "IMO identifies circular LL.12/Circ.1 for the unanimous-acceptance calculation."),
    1417: (9, "IMO identifies circular LL.12/Circ.2 for the unanimous-acceptance calculation."),
    1449: (10, "IMO identifies circular TM.7/Circ.1 for the unanimous-acceptance calculation."),
    1579: (12, "IMSO terminated the 2006 adoption and provisional-application decisions on 6 October 2008."),
    1582: (13, "The IMSO Assembly decided on provisional application from 6 October 2008."),
    1618: (14, "IMO identifies the 2012 Cape Town Agreement as the successor to this protocol."),
    1698: (15, "Part A follows the STCW-F Convention's revised annex for each Party. Part B is guidance."),
    1739: (16, "The 1996 convention as modified by its 2010 protocol constitutes the 2010 HNS Convention upon entry into force."),
    1842: (17, "The date follows the associated BWM Convention amendments in MEPC.296(72)."),
}


def source_url(name):
    return CDN + quote(FILES[name][0])


def read_source(name, directory, refresh):
    path = directory / name
    if path.is_file() and not refresh:
        data = path.read_bytes()
    else:
        with urlopen(Request(source_url(name), headers={"User-Agent": "Maritime regulation source index/1.0"}), timeout=60) as response:
            data = response.read(20_000_001)
    if len(data) > 20_000_000 or hashlib.sha256(data).hexdigest() != FILES[name][1]:
        raise ValueError(f"{name}: the publisher has changed the reviewed source. Review headings, marks and page references before replacing this edition.")
    write_bytes(path, data)
    return data


def plain(value):
    return " ".join(value.split())


def dates(text):
    return [date(int(y), MONTHS.index(m.title()) + 1, int(d)).isoformat() for d, m, y in DAY.findall(text)]


def resolution_ids(text):
    return list(dict.fromkeys(f"{prefix.upper()}.{number}({session.upper()})" for prefix, number, session in RESOLUTION.findall(text)))


def paragraphs(data):
    with ZipFile(BytesIO(data)) as package:
        root = ET.fromstring(package.read("word/document.xml"))
    result = []
    for p in root.find(WORD + "body").findall(WORD + "p"):
        runs = []
        for part in p.iter():
            if part.tag == WORD + "t":
                runs.append(part.text or "")
            elif part.tag == WORD + "tab":
                runs.append("\t")
        result.append("".join(runs).strip().replace("\xa0", " "))
    return result


def book_references(data):
    with pymupdf.open(stream=data, filetype="pdf") as document:
        toc = document.get_toc()
        pages = {p for level, _, p in toc if level == 1}
        page_text = [plain(p.get_text(sort=True)) for p in document]
        printed = [set(resolution_ids(t)) for t in page_text]
        if dates(document[0].get_text()) != ["2026-10-30"]:
            raise ValueError("Status book cover date has changed")
        targets = defaultdict(set)
        for _, label, p in toc:
            for rid in resolution_ids(label):
                if 0 < p <= len(printed) and rid in printed[p - 1]:
                    targets[rid].add(p)
        opening_dates = {}
        for p in pages:
            start = re.search(r"Entry into force\s*:\s*(.{0,28})", page_text[p - 1], re.I)
            if start:
                ds = dates(start[1])
                opening_dates[p] = ds[0] if ds else "Not yet in force" if "not yet in force" in start[1].lower() else ""
        return {"starts": pages, "resolutions": targets, "openingDates": opening_dates, "end": len(document) + 1}


def book_location(book, page):
    return {"sourceUrl": source_url(f"vol{book}.pdf") + f"#page={page}", "page": page, "volume": book}


def amendment_page(identifiers, start, end, positions):
    hits = set()
    for rid in identifiers:
        hits.update(p for p in positions.get(rid, ()) if start <= p < end)
    return hits.pop() if len(hits) == 1 else None


def event(label, start, *, kind, day=None, state=None, identifiers=None):
    item = {"label": label, "kind": kind, "sourceUrl": source_url("list.docx"), "sourceParagraph": start + 1}
    if day:
        item["date"] = day
    if state:
        item["status"] = state
    if identifiers:
        item["resolutions"] = identifiers
    if start in QUALIFICATIONS:
        item["sourceFootnote"], item["note"] = QUALIFICATIONS[start]
    return item


def amendments(lines, start, stop):
    line = lines[start]
    header = plain(line.split("\t", 1)[0])
    continuation = []
    for i in range(start + 1, stop):
        if not lines[i]:
            break
        continuation.append(lines[i])
    identifiers = resolution_ids(header)
    if not identifiers:
        # A few publisher headings wrap the resolution identifier to a subsequent
        # paragraph. Descriptive cross-references are not amendment identifiers.
        for ext in reversed(continuation):
            ids = resolution_ids(ext)
            tail = list(RESOLUTION.finditer(ext))
            if len(ids) == 1 and not ext[tail[-1].end():].strip(" ).,*"):
                identifiers = ids
                break
    if start == 1783:  # The list prints LP1.(1); the October status book prints LP.1(1).
        identifiers = ["LP.1(1)"]
    conference = re.search(r"conference resolutions?(?:\s+([0-9](?:\s*(?:and|[-–])\s*[0-9])?))?", " ".join([header, *continuation]), re.I)
    year = int(header[:4])
    desc = f"{year} amendments"
    if identifiers:
        desc += " · " + ", ".join(identifiers)
    elif conference:
        desc += " · " + re.sub(r"(\d)\s*and\s*(\d)", r"\1 and \2", conference[0]).capitalize()
    status = "Not yet in force" if "not yet in force" in " ".join([line, *continuation]).lower() else None
    if line.strip().endswith("superseded"):
        status = "Superseded"
    if start == 835:
        status = "Six months after acceptance by two thirds of the Parties"
    printed_dates = dates(line)
    phases = []
    if not printed_dates and not status:
        for i in range(start + 1, stop):
            value = lines[i]
            d = dates(value)
            if "\t" in value and d and ("Annex " in value or re.match(r"^chapter \d+", value, re.I)):
                mark = re.search(r"\bAnnex\s+([0-9]+)\b", value, re.I)
                if mark and len(d) == 1:
                    phases.append((i, mark[0], d[0]))
    result = []
    if phases:
        for position, phase, day in phases:
            item = event(desc + " · " + phase, start, kind="Amendment", day=day, identifiers=identifiers)
            item["dateParagraph"] = position + 1
            result.append(item)
    else:
        item = event(desc, start, kind="Amendment", day=printed_dates[0] if len(printed_dates) == 1 else None,
                     state=status, identifiers=identifiers)
        if len(printed_dates) > 1:
            item["reportedDates"] = printed_dates
        if not printed_dates and not status:
            item["status"] = "Date requires source review"
        result.append(item)
    for item in result:
        item["amendmentYear"] = year
    return result


def state_workbook(data, country_rows):
    names = {name_key(row["name"]): row["code"] for row in country_rows}
    with ZipFile(BytesIO(data)) as package:
        strings = ["".join(t.text or "" for t in entry.iter(SHEET + "t"))
                   for entry in ET.fromstring(package.read("xl/sharedStrings.xml"))]
        sheet = ET.fromstring(package.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(SHEET + "row"):
        cells = {}
        for cell in row.findall(SHEET + "c"):
            v = cell.findtext(SHEET + "v")
            if v is not None:
                column = re.match(r"[A-Z]+", cell.get("r")).group()
                cells[column] = plain(strings[int(v)] if cell.get("t") == "s" else v)
        rows.append((int(row.get("r")), cells))
    header = rows[0][1]
    if dates(header["A"]) != ["2026-10-30"] or dict(rows)[206].get("A") != "x= ratification/accession" or dict(rows)[207].get("A") != "d=denunciation":
        raise ValueError("The official workbook date or mark legend has changed")
    columns = [{"key": key, "label": title} for key, title in header.items() if key != "A"]
    keys = {c["key"] for c in columns}
    by_flag, organizations = {}, {}
    for row, values in rows[1:]:
        label = values.get("A")
        if not label or not 2 <= row <= 204 or label == "Associate Members":
            continue
        present = {key: mark for key, mark in values.items() if key != "A" and mark}
        if present.keys() - keys or set(present.values()) - {"x", "d"}:
            raise ValueError(f"New treaty-status notation in row {row}")
        marks = {"row": row, "name": label, "ratified": [k for k, v in present.items() if v == "x"],
                 "denounced": [k for k, v in present.items() if v == "d"]}
        if label == "European Union":
            organizations["EU"] = marks
            continue
        code = COUNTRY_NAMES.get(label) or names.get(name_key(label.replace("&", "and")))
        if not code or code in by_flag:
            raise ValueError(f"Unresolved printed State or associated territory: {label}")
        by_flag[code] = marks
    return {"asOf": "2026-10-30", "sourceUrl": source_url("states.xlsx"), "sha256": FILES["states.xlsx"][1],
            "sheet": "STATUS", "columns": columns, "byFlag": by_flag, "organizations": organizations,
            "scope": "The workbook records ratification or accession (x) and denunciation (d) as at its stated date. Blank cells and unlisted territories provide no affirmative record here. The status books give individual dates, declarations and territorial extensions."}


def select_headings(lines, books):
    headings = []
    primary = None
    for i, value in enumerate(lines):
        if i in GROUP_HEADINGS:
            continue
        if i in CHILDREN:
            till = TITLE_ENDS.get(i, i)
            title_parts = [DAY.sub("", t) for t in lines[i:till + 1]]
            title = plain(" ".join(title_parts))
            title = re.sub(r"^36\(b\)\s*", "", title)
            identifier = primary["id"] + "-" + CHILDREN[i]
            child = {"id": identifier, "title": title, "sourceParagraph": i + 1, "parentId": primary["id"],
                     "participationKeys": [], "sourceUrl": source_url("list.docx"), "entries": []}
            if i == 795:
                child["participationKeys"] = ["G"]
                child.update(book_location(1, 103))
            headings.append((i, child, primary))
            continue
        number = NUMBERED.match(value)
        if not number:
            continue
        ordinal = int(number[1])
        identifier, volume, first, columns = PRIMARY[ordinal - 1]
        if first not in books[volume]["starts"]:
            raise ValueError(f"No publisher bookmark at {volume}, p.{first}")
        primary = {"id": identifier, "title": plain(value[number.end():]), "listNumber": ordinal,
                   "sourceParagraph": i + 1, "participationKeys": columns.split(), **book_location(volume, first), "entries": []}
        headings.append((i, primary, primary))
    if [item["listNumber"] for _, item, _ in headings if "listNumber" in item] != list(range(1, 54)):
        raise ValueError("The 53 numbered treaty headings no longer match the reviewed chronology")
    return headings


def chronology(lines, books):
    headings = select_headings(lines, books)
    for k, (start, instrument, root) in enumerate(headings):
        stop = headings[k + 1][0] if k + 1 < len(headings) else len(lines)
        volume = root["volume"]
        book = books[volume]
        end = min((p for p in book["starts"] if p > root["page"]), default=book["end"])
        starts = [i for i in range(start + 1, stop) if YEAR.match(lines[i]) and i not in CHILDREN]
        first_amendment = starts[0] if starts else stop
        origin = instrument if "page" in instrument else {}
        for i in range(start, first_amendment):
            v = lines[i]
            ds = dates(v)
            label = None
            if re.match(r"^Entry into force\b", v, re.I) or re.search(r"\beffective as\s+from\b", v, re.I):
                label = "Effective from" if "effective" in v.lower() else "Entry into force"
            elif i == 795 or i == 1716:
                label = "Entry into force"
            elif re.match(r"^Annex\s+[IVX]+\s", v) and ds:
                label = plain(v.split("\t")[0]) + " · entry into force"
            elif v.startswith("Ceased to be in force on") or v.startswith("The Operating Agreement is no longer in force"):
                label = "Ceased to be in force"
            if label and len(ds) == 1:
                item = event(label, i, kind="Treaty status", day=ds[0])
            elif v.lower().strip() == "not yet in force":
                item = event("Entry into force", i, kind="Treaty status", state="Not yet in force")
            else:
                continue
            if "page" in origin and label == "Entry into force" and ds and book["openingDates"].get(origin["page"]) == ds[0]:
                item.update(book_location(origin["volume"], origin["page"]))
            if 888 <= i <= 892:
                item["participationKeys"] = [["Z"], ["Z"], ["AA"], ["AB"], ["AC"]][i - 888]
                # Convention opening pages do not identify each optional annex's
                # own date. Direct the reader to the dated chronology line.
                item.update(sourceUrl=source_url("list.docx"))
                item.pop("page", None)
                item.pop("volume", None)
            instrument["entries"].append(item)
        if instrument["id"] == "fund-1976-protocol":
            item = event("Ceased to be in force", start, kind="Treaty status", day="2002-05-24")
            item["sourceFootnote"] = 11
            instrument["entries"].append(item)
        for j, i in enumerate(starts):
            following = starts[j + 1] if j + 1 < len(starts) else stop
            for item in amendments(lines, i, following):
                page = amendment_page(item.get("resolutions", ()), root["page"], end, book["resolutions"])
                if page:
                    item.update(book_location(volume, page))
                if instrument["id"] == "csc-1972" and item["amendmentYear"] == 1993:
                    item["participationKeys"] = ["M"]
                if instrument["id"] == "imso-1976" and item["amendmentYear"] in (2006, 2008):
                    item["participationKeys"] = ["W" if item["amendmentYear"] == 2006 else "X"]
                if root["id"] == "marpol" and root is instrument:
                    annexes = re.search(r"\bAnnex(?:es)?\s+([IVX]+\b(?:\s*(?:,\s*(?:and\s+)?|and\s+)[IVX]+\b)*)", lines[i], re.I)
                    if annexes:
                        marks = {"I": "Z", "II": "Z", "III": "AA", "IV": "AB", "V": "AC"}
                        keys = [marks[a] for a in re.findall(r"\b[IVX]+\b", annexes[1].upper()) if a in marks]
                        if keys:
                            item["participationKeys"] = list(dict.fromkeys(keys))
                instrument["entries"].append(item)
        if not instrument["entries"]:
            raise ValueError("No treaty event for " + instrument["id"])
    records = [item for _, item, _ in headings]
    for key, day in (("cape-town-2012", "2027-02-24"), ("hns-2010-protocol", "2027-11-29")):
        instrument = next(r for r in records if r["id"] == key)
        if books[instrument["volume"]]["openingDates"].get(instrument["page"]) != day:
            raise ValueError("October status book entry date differs for " + key)
        instrument["entries"].append({"label": "Entry into force scheduled in the October status book",
                                      "date": day, "kind": "Status book update", "reportedAsOf": "2026-10-30",
                                      **book_location(instrument["volume"], instrument["page"])})
    return records


def build(directory, country_rows, refresh=False):
    files = {name: read_source(name, directory, refresh) for name in FILES}
    lines = paragraphs(files["list.docx"])
    if dates(lines[2]) != ["2026-07-03"]:
        raise ValueError("Check the chronology's printed edition date")
    books = {n: book_references(files[f"vol{n}.pdf"]) for n in [1, 2]}
    records = chronology(lines, books)
    marks = state_workbook(files["states.xlsx"], country_rows)
    source = {"title": "IMO list of conventions, other multilateral instruments and amendments",
              "publisher": "International Maritime Organization", "url": LANDING, "chronologyUrl": source_url("list.docx"),
              "asOf": "2026-07-03", "checkedAt": "2026-11-23", "sha256": FILES["list.docx"][1],
              "statusBooks": [{"volume": n, "asOf": "2026-10-30", "title": "Status of IMO Treaties, Volume " + ("I" if n == 1 else "II"),
                               "url": source_url(f"vol{n}.pdf"), "sha256": FILES[f"vol{n}.pdf"][1]} for n in [1, 2]],
              "scope": "Dates and resolution identifiers follow the 3 July 2026 depositary list. Numbered Word paragraphs identify source rows including empty paragraphs. PDF links use physical status-book pages. The books and State workbook are separate editions dated 30 October 2026. Treaty dates describe the instrument internationally. Individual State dates, declarations, and domestic implementation can differ."}
    all_entries = [event for item in records for event in item["entries"]]
    coverage = {"numberedInstruments": len(PRIMARY), "codesAndRelatedInstruments": len(CHILDREN),
                "events": len(all_entries), "amendmentEvents": sum(e["kind"] == "Amendment" for e in all_entries),
                "pdfPageLinks": sum("page" in e for e in all_entries),
                "unresolvedDates": sum(e.get("status") == "Date requires source review" for e in all_entries),
                "flags": len(marks["byFlag"]), "columns": len(marks["columns"])}
    return {"schemaVersion": 1, "source": source, "coverage": coverage, "instruments": records, "participation": marks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path(gettempdir()) / "maritime-imo-status")
    parser.add_argument("--refresh", action="store_true", help="Download and revalidate the four reviewed IMO files")
    args = parser.parse_args()
    countries = json.loads((SITE / "data/countries.json").read_text("utf-8"))
    dataset = build(args.cache_dir, countries["countries"], args.refresh)
    write_bytes(SITE / "data/imo-history.json", (json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    print(dataset["coverage"])


if __name__ == "__main__":
    main()


