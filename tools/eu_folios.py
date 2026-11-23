"""Rebuild the EU tanker-law excerpts from reviewed English Official Journal pages."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

import pymupdf


SITE = Path(__file__).resolve().parents[1] / "site"
CELLAR = "https://publications.europa.eu/resource/cellar/"
LEX = "https://eur-lex.europa.eu/eli/reg/"

# A version describes the indexed passage at the stated date. The replacement in
# the 2003 amending act is an original publication, not a reconstructed regulation.
SOURCES = {
    "eu-417-2002": {
        "item": "c8b9ef02-4841-4a88-8f8b-4b664682a441.0004.02/DOC_1", "eli": "2002/417",
        "sha": "68a31f8553e50524bf11302b6526da48fa1a2e89d20b39d26b87e173b6eb9dde",
        "label": "417/2002 as adopted · OJ L 64, pp. 1–5", "publishedOn": "2002-03-07",
        "effectiveFrom": "2002-09-01", "effectiveTo": "2003-10-21", "kind": "Original regulation",
        "notes": "Article 13 sets entry into force on 27 March 2002 and application from 1 September 2002. The interval follows the application of the selected scope wording until its replacement by Regulation 1726/2003.",
    },
    "eu-1726-2003": {
        "item": "70b3b629-bb3f-45f3-8b5b-d8e02650aed9.0004.02/DOC_1", "eli": "2003/1726",
        "sha": "fe41176bdf5646f1ac5d1a3a9c1723b6cf5872a40481ac991165386ee9b6ea76",
        "label": "417/2002 as amended by 1726/2003 · OJ L 249, pp. 1–4", "publishedOn": "2003-10-01",
        "effectiveFrom": "2003-10-21", "effectiveTo": "2012-07-20", "kind": "Amending regulation",
        "notes": "Article 1, point 2 replaces Article 2(1) of 417/2002. This interval follows that scope paragraph through the 2012 repeal. Other provisions changed during this period. The PDF contains the amending act as published.",
    },
    "eu-530-2012": {
        "item": "068c2d29-c59e-11e1-b84a-01aa75ed71a1.0006.01/DOC_1", "eli": "2012/530",
        "sha": "8a39ba51d33a237088c1453b0197ba9fe81737a27a7766c25c54025aab7c92b1",
        "label": "530/2012 recast · OJ L 172, pp. 3–9", "publishedOn": "2012-06-30",
        "effectiveFrom": "2012-07-20", "effectiveTo": None, "kind": "Recast regulation",
        "notes": "Articles 12 and 13 repeal 417/2002 and bring the recast into force on 20 July 2012. Annex II maps the prior provisions to this instrument. This index screens the EU text. EEA incorporation, national measures and individual exemptions require separate evidence.",
    },
}

YES_NO = [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]
ACTIVITIES = [
    {"value": "enter", "label": "Entering a port or offshore terminal"},
    {"value": "leave", "label": "Leaving a port or offshore terminal"},
    {"value": "anchor", "label": "Anchoring in an area under Member State jurisdiction"},
    {"value": "none", "label": "None of these operations"},
]


def reference(version, section):
    return {"versionId": version, "sectionId": section}


def field(key, label, help_text, section, options=None):
    result = {"key": key, "label": label, "help": help_text,
              "source": reference("eu-530-2012", section)}
    if options is None:
        return {**result, "type": "number", "unit": "t DWT"}
    return {**result, "type": "select", "options": options}


FIELDS = [
    field("deadweightTonnes", "Deadweight", "Use the ship’s deadweight in metric tonnes from its particulars. Article 3(3) refers to MARPOL Annex I, regulation 1.23. Gross tonnage and cargo on board are different measurements.", "definitions"),
    field("euOilTanker", "Oil tanker as defined by MARPOL", "Use the statutory vessel classification specified in the cited edition. A cargo ship entry alone does not establish oil tanker status.", "definitions", YES_NO),
    field("euMemberFlag", "Flag of an EU Member State", "Identify EU membership of the flag state at the date being researched. This field implements the EU text without inferring EEA adaptations.", "scope", YES_NO),
    field("euPortActivity", "Operation under EU Member State jurisdiction", "Select the operation being researched. For port or terminal calls, the port or terminal must be under Member State jurisdiction.", "scope", ACTIVITIES),
    field("euGovernmentService", "Ship in the Article 2(2) state-service exclusion", "Check the complete wording for warships, naval auxiliaries and other state ships used for government non-commercial service.", "state-service", YES_NO),
    field("euHeavyGradeOil", "Carrying heavy grade oil as cargo", "Use the cargo definition in Article 3(12), including the density or viscosity requirements and the named bitumen, tar and emulsions.", "heavy-grade-definition", YES_NO),
]


def scope_rule(version, *, heavy_cargo=False):
    """Screen Article 2 and its Article 4(3) cross-reference for one published version."""
    historical = version == "eu-417-2002"
    source = ("417/2002 Article 2(1)" if historical else
              "1726/2003 Article 1, point 2" if version == "eu-1726-2003" else "530/2012 Article 2(1)")
    definition = "417/2002 Article 3" if version != "eu-530-2012" else "530/2012 Article 3"
    state = "417/2002 Article 2(2)" if version != "eu-530-2012" else "530/2012 Article 2(2)"
    operation = "enter" if historical else "none"
    port = {"field": "euPortActivity", "op": "eq" if historical else "neq", "value": operation, "source": source}
    threshold = {"field": "deadweightTonnes", "op": "gte", "value": 5000 if historical else 600, "source": source}
    cargo = {"field": "euHeavyGradeOil", "op": "eq", "value": "yes", "source": "530/2012 Articles 3(12) and 4(3)"}
    if version == "eu-530-2012" and not heavy_cargo:
        threshold = {"any": [{**threshold, "value": 5000}, {"all": [threshold, cargo]}]}
    parts = [
        {"field": "euOilTanker", "op": "eq", "value": "yes", "source": definition},
        threshold,
        {"any": [{"field": "euMemberFlag", "op": "eq", "value": "yes", "source": source}, port]},
        {"field": "euGovernmentService", "op": "eq", "value": "no", "source": state},
    ]
    if heavy_cargo:
        parts.append(cargo)
    return {"all": parts}


def section(key, number, title, page, box, first, last, caveat, rule=None):
    return {"id": key, "number": number, "title": title, "page": page, "box": box,
            "first": first, "last": last, "caveat": caveat, "criteria": rule}


STATE = {"field": "euGovernmentService", "op": "eq", "value": "yes", "source": "Article 2(2) of the selected regulation"}
STATE_NOTE = "This exclusion includes a duty for Member States to endeavour to respect the regulation for the ships it covers."
DEFINITION_NOTE = "The text incorporates MARPOL definitions by reference. Consult the referenced Annex I regulation for the selected date."
SCOPE_NOTE = "The general threshold is 5,000 t DWT. The 600 t DWT threshold is only for Article 4(3) on heavy grade oil. An instrument-level match includes that narrower case. Read the relevant operational provision and exemptions."

# Source coordinates are PDF points measured from the top-left of the physical
# page. Each rectangle encloses one complete, visually checked column passage.
# The first and last phrases catch a shifted boundary or misidentified page.
SECTIONS = {
    "eu-417-2002": [
        section("scope", "Article 2(1)", "Oil tanker scope", 3, (39, 126, 288, 208),
                "1. This Regulation", "flag of a Member State.",
                "The original 5,000-ton threshold refers to Member State flags or entry into a Member State port or offshore terminal. See Article 2(2) for the public-service exclusion.", scope_rule("eu-417-2002")),
        section("state-service", "Article 2(2)", "Warships and government non-commercial service", 3, (39, 209, 288, 292),
                "2. This Regulation", "in this paragraph.", STATE_NOTE, STATE),
        section("definitions", "Article 3, points 3–4", "Meaning of oil tanker and deadweight", 3, (39, 524, 288, 591),
                "3. ‘oil tanker’", "Annex I of MARPOL 73/78;", DEFINITION_NOTE),
    ],
    "eu-1726-2003": [
        section("scope", "Article 1, point 2", "Replacement of Article 2(1) on oil tanker scope", 2, (306, 230, 559, 353),
                "‘1. This Regulation", "deadweight and above.’",
                SCOPE_NOTE + " Article 2(2) in the 2002 publication supplies the state-service exclusion. The amending act also introduced transitional provisions, including Article 4(5) and (6).", scope_rule("eu-1726-2003")),
    ],
    "eu-530-2012": [
        section("scope", "Article 2(1)", "Oil tanker scope", 3, (36, 460, 288, 627),
                "1. This Regulation", "deadweight and above.", SCOPE_NOTE, scope_rule("eu-530-2012")),
        section("state-service", "Article 2(2)", "Warships and government non-commercial service", 3, (36, 638, 288, 718),
                "2. This Regulation", "in this paragraph.", STATE_NOTE, STATE),
        section("definitions", "Article 3, points 2–3", "Meaning of oil tanker and deadweight", 3, (308, 141, 558, 221),
                "(2) ‘oil tanker’", "Annex I to MARPOL 73/78;", DEFINITION_NOTE),
        section("categories", "Article 3, points 4–6", "Oil tanker categories by deadweight, cargo and design", 3, (308, 233, 558, 511),
                "(4) ‘Category 1 oil tanker’", "points (4) and (5);",
                "Classification combines deadweight, cargo and MARPOL design specifications. The weight thresholds alone cannot assign a category."),
        section("heavy-grade-definition", "Article 3, point 12", "Heavy grade oil", 4, (40, 206, 295, 363),
                "(12) ‘heavy grade oil’", "emulsions thereof.",
                "Use the cargo's measured density or kinematic viscosity at the stated reference temperatures. The original PDF preserves the unit exponents."),
        section("heavy-grade-carriage", "Article 4(3)–(4)", "Carriage of heavy grade oil and inland navigation", 4, (40, 634, 295, 794),
                "3. No oil tanker", "inland waterway legislation.",
                "The screen identifies vessels to review. Paragraph 4 permits an exemption for certain certified vessels used exclusively in ports and inland navigation. Article 8 addresses exceptional permission for an individual ship.", scope_rule("eu-530-2012", heavy_cargo=True)),
        section("exceptional-entry", "Article 8", "Exemptions for ships in difficulty or for repair", 4, (309, 495, 564, 677),
                "Article 8", "port of repair.",
                "A competent authority may permit an individual ship under the stated conditions. The index carries no grant of permission."),
        section("amendments", "Annex I", "Successive amendments to the repealed regulation", 6, (85, 72, 523, 351),
                "ANNEX I", "p. 13)",
                "The recast lists all six amending regulations for 417/2002. This collection excerpts the 2003 change to scope. The source PDF also contains the Annex II correlation table."),
    ],
}


def source_pdf(version, refresh):
    metadata = SOURCES[version]
    path = SITE / "pdf" / (version + "-oj.pdf")
    if path.is_file() and not refresh:
        data = path.read_bytes()
    else:
        request = Request(CELLAR + metadata["item"], headers={"User-Agent": "Vessel Law Index/1.0", "Accept": "application/pdf"})
        with urlopen(request, timeout=60) as response:
            data = response.read(5_000_001)
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != metadata["sha"]:
        raise ValueError(f"{version}: expected the reviewed English Official Journal PDF")
    write_if_changed(path, data)
    return data


def write_if_changed(path, data):
    if path.is_file() and path.read_bytes() == data:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def normalized_text(raw):
    # Discretionary hyphens are tagged in the recast. The older OJ typography
    # also prints hard hyphens within a small number of otherwise intact words.
    text = re.sub(r"\u00ad\s*", "", raw)
    for left, right in (("jurisdic", "tion"), ("Regula", "tion"), ("practic", "able")):
        text = re.sub(rf"{left}-\s+{right}", left + right, text)
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "-", text)
    text = " ".join(text.split())
    return re.sub(r"\bmm\s*2\s*/\s*s\b", "mm²/s", re.sub(r"\bkg/m\s*3\b", "kg/m³", text))


def clip_passage(document, item, path):
    page_index = item["page"] - 1
    source = document[page_index]
    rect = pymupdf.Rect(item["box"])
    text = normalized_text(source.get_text("text", clip=rect))
    if not text.startswith(item["first"]) or not text.endswith(item["last"]):
        raise ValueError(f"{path.name}: wrong text bounds: {text[:90]!r} … {text[-90:]!r}")
    with pymupdf.open() as clipped:
        clipped.insert_pdf(document, from_page=page_index, to_page=page_index, links=False, annots=False, widgets=False)
        page = clipped[0]
        width, height = page.rect.width, page.rect.height
        outside = [(0, 0, width, rect.y0), (0, rect.y1, width, height),
                   (0, rect.y0, rect.x0, rect.y1), (rect.x1, rect.y0, width, rect.y1)]
        for area in outside:
            page.add_redact_annot(area, fill=None, cross_out=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
        page.set_cropbox(rect)
        clipped.set_metadata({"title": item["number"] + " · " + item["title"], "author": "European Union, Official Journal (excerpt)"})
        pdf = clipped.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1)
    with pymupdf.open(stream=pdf, filetype="pdf") as check:
        if len(check) != 1 or normalized_text(check[0].get_text()) != text:
            raise ValueError(f"{path.name}: saved PDF text differs from the reviewed source rectangle")
    write_if_changed(path, pdf)
    return text


def build_version(version, refresh):
    source = SOURCES[version]
    metadata = {key: value for key, value in source.items() if key not in ("item", "eli", "sha")}
    rows = []
    with pymupdf.open(stream=source_pdf(version, refresh), filetype="pdf") as doc:
        for item in SECTIONS[version]:
            relative = Path("pdf") / (version + "-" + item["id"] + ".pdf")
            text = clip_passage(doc, item, SITE / relative)
            row = {key: item[key] for key in ("id", "number", "title", "criteria", "caveat")}
            level = "instrument" if item["id"] == "scope" else "section" if item["criteria"] else "unmapped"
            rows.append({**row, "pages": [item["page"]], "clip": relative.as_posix(), "text": text, "screeningLevel": level})
    return {**metadata, "id": version, "language": "en", "sourcePage": LEX + source["eli"] + "/oj/eng",
            "sourceUrl": CELLAR + source["item"], "pdf": f"pdf/{version}-oj.pdf",
            "pdfSha256": source["sha"], "sections": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Fetch and recheck the pinned EU source bytes")
    args = parser.parse_args()
    versions = {key: build_version(key, args.refresh) for key in SOURCES}
    common = {"authority": "European Parliament and Council of the European Union", "jurisdiction": "EU", "language": "en"}
    instruments = [
        {**common, "id": "eu-tanker-417", "shortTitle": "Oil tanker double hulls · 417/2002",
         "title": "Regulation (EC) No 417/2002 on double-hull requirements for single-hull oil tankers",
         "versions": [versions["eu-417-2002"], versions["eu-1726-2003"]]},
        {**common, "id": "eu-tanker-530", "shortTitle": "Oil tanker double hulls · 530/2012",
         "title": "Regulation (EU) No 530/2012 on double-hull requirements for single-hull oil tankers (recast)",
         "versions": [versions["eu-530-2012"]]},
    ]
    comparisons = [
        {"id": "eu-tanker-scope-2003", "title": "Oil tanker scope · 2002 to 2003", "kind": "Amendment",
         "before": reference("eu-417-2002", "scope"), "after": reference("eu-1726-2003", "scope"),
         "notes": "Article 1, point 2 of 1726/2003 replaced Article 2(1). It added departure and anchoring, and a 600 t DWT threshold specific to Article 4(3)."},
        {"id": "eu-tanker-scope-recast", "title": "Oil tanker scope · 2003 amendment to 2012 recast", "kind": "Recast",
         "before": reference("eu-1726-2003", "scope"), "after": reference("eu-530-2012", "scope"),
         "notes": "Annex II of the recast maps the two scope paragraphs and reverses the order of the flag and geographic clauses. The 5,000 and 600 t DWT thresholds are retained."},
    ]
    bundle = {"version": 1, "checkedAt": "2026-11-23", "fields": FIELDS, "instruments": instruments,
              "comparisons": comparisons, "publisher": "Publications Office of the European Union",
              "reuse": "https://eur-lex.europa.eu/content/legal-notice/legal-notice.html"}
    write_if_changed(SITE / "data" / "eu-folios.json", (json.dumps(bundle, ensure_ascii=False, indent=2) + "\n").encode())
    print(f"{len(versions)} Official Journal PDFs, {sum(len(v['sections']) for v in versions.values())} section clips, {len(comparisons)} comparisons")


if __name__ == "__main__":
    main()
