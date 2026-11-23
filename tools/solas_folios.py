"""Build flag-specific SOLAS general-scope records and exact extracts from UNTS 18961."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

import pymupdf

from colreg_folios import CHECKED, IMO_INDEX, STATUS_URL, UN_POLICY, criterion, iso_date, name_key
from folios import write_bytes


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
REGISTER = "IMO Status Book 2026, volume I, SOLAS 1974"
UN_PAGE = "https://treaties.un.org/Pages/showDetails.aspx?objid=08000002800ec37f"
UN_PDF = "https://treaties.un.org/doc/Publication/UNTS/Volume%201184/volume-1184-I-18961-English.pdf"
ICELAND = "https://www.samgongustofa.is/media/english/SOLAS-2020-Consolidated-Edition.pdf"
SUPPLEMENT = "https://wwwcdn.imo.org/localresources/en/publications/Documents/Supplements/English/QH110E_supplement_January2026.pdf"
IMO = "https://www.imo.org/en/about/conventions/pages/international-convention-for-the-safety-of-life-at-sea-%28solas%29%2C-1974.aspx"
POLAR = "https://assets.publishing.service.gov.uk/media/6a29294ff553ec1112221874/TS_24.2026_Amendments_SOLAS_1974.pdf"
FILES = {
    "original": (UN_PDF, "663457f12f81e2d60c62f87eb3a3cb81b33b78a5c984469bf472156bf326eb17"),
    "comparison": (ICELAND, "41c7c25bdfa72236892cee005842294bb4d4104e6d5687b00ee3f9bcf342d7b3"),
    "supplement": (SUPPLEMENT, "3318af50cdc57ac4fb1501fdf86368ff111f27a82da81371c8ff4fb82de961cd"),
    "status": (STATUS_URL, "70ad59fa1786051db70476070b8f80a0a8379ef981af65193be1c9a563c06c73"),
}
AREAS = {
    "scope": ("I/1", "International voyage and chapter-specific application",
              [(8, 383, 443, "Regulation 1.", "in each Chapter.")]),
    "flag": ("Article II", "Ships entitled to fly the flag of a contracting state",
             [(4, 105, 145, "Article II.", "Contracting Governments.")]),
    "voyage": ("I/2(d)", "Definition of an international voyage",
               [(8, 525, 546, '(d) "International voyage"', "or conversely.")]),
    "passengers": ("I/2(e)–(g)", "Who counts as a passenger, passenger ships and cargo ships",
                   [(8, 546, 592, "(e) A passenger", "one year of age."),
                    (9, 67, 94, "(/) A passenger ship", "a passenger ship.")]),
    "exceptions": ("I/3", "Excluded vessels, cargo-ship tonnage and the Great Lakes boundary",
                   [(9, 196, 335, "Regulation 3.", "the 63rd Meridian.")]),
    "single-voyage": ("I/4(a)", "Administrative exemption for a single exceptional international voyage",
                      [(9, 335, 401, "Regulation 4.", "by the ship.")]),
}


def source_file(key, cache, refresh):
    url, digest = FILES[key]
    local = SITE / "pdf/solas-1974-un.pdf"
    candidates = [cache / (key + ".pdf")]
    if key == "status":
        candidates.append(ROOT / ".work/colreg/imo.pdf")
    if key == "original":
        candidates.append(local)
    existing = next((p for p in candidates if p.is_file()), None)
    if existing and not refresh:
        data = existing.read_bytes()
    else:
        req = Request(url, headers={"User-Agent": "Ship Law Index/1.0", "Accept": "application/pdf"})
        with urlopen(req, timeout=90) as response:
            data = response.read(10_000_001)
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"SOLAS {key}: publisher bytes have changed; review evidence and section coordinates")
    write_bytes(local if key == "original" else candidates[0], data)
    return pymupdf.open(stream=data, filetype="pdf")


def flag_actions(status, countries):
    by_name = {name_key(c["name"]): c["code"] for c in countries}
    by_name.update(moldova="MD", nauru="NR", netherlands="NL", unitedkingdom="GB", unitedstates="US")
    date = r"\d{1,2} [A-Za-z]+ \d{4}"
    records = {}
    for page in (13, 14, 15):
        text = status[page - 1].get_text(sort=True)
        if page == 15:
            text, total = text.split("Number of Contracting States:", 1)
        for line in text.splitlines():
            row = re.fullmatch(rf"(.*?)\s{{2,}}(-|{date})\s{{2,}}({date})\s*", line)
            if not row:
                continue
            title, deposit, entry = row.groups()
            action = re.search(r"\s*\((accession|ratification|acceptance|succession|signature|approval)\)", title)
            name = re.sub(r"\d+$", "", title[:action.start()] if action else title).strip()
            flag = by_name[name_key(name)]
            if flag in records:
                raise ValueError(f"Duplicate SOLAS state: {name}")
            records[flag] = [dict(flag=flag, sourceName=name, kind=action[1].capitalize() if action else "Party",
                                  registeredOn=None if deposit == "-" else iso_date(deposit), effectiveFrom=iso_date(entry),
                                  sourceUrl=STATUS_URL + f"#page={page}", register=REGISTER)]
    if int(total.split()[0]) != len(records) or len(records) != 169:
        raise ValueError("SOLAS status table count changed")
    records["RU"][0].update(predecessorEffectiveFrom="1980-05-25", effectiveFrom="1991-12-26",
                            note="The Russian Federation continued USSR membership on 26 December 1991 (note 6).")
    records["DE"][0]["note"] = "The ratification was by the Federal Republic of Germany. Note 3 gives the German Democratic Republic's separate accession and the 1990 unification."
    return records


def territorial_actions(records, status):
    notes = {n: " ".join(status[n - 1].get_text(sort=True).split()) for n in (16, 17)}
    entries = [
        ("HK", "GB", 16, "Hong Kong", "1980-05-25", "1997-07-01", "25 May 1980"),
        ("HK", "CN", 17, "Hong Kong Special Administrative Region", "1997-07-01", None, "1 July 1997"),
        ("MO", "PT", 16, "Macau", "1999-08-24", "1999-12-20", "24 August 1999"),
        ("MO", "CN", 17, "Macao Special Administrative Region", "1999-12-20", None, "20 December 1999"),
        ("BM", "GB", 16, "Bermuda", "1988-06-23", None, "23 June 1988"),
        ("KY", "GB", 16, "Cayman Islands", "1988-06-23", None, "23 June 1988"),
        ("IM", "GB", 16, "Isle of Man", "1985-07-01", None, "1 July 1985"),
        ("GI", "GB", 16, "Gibraltar", "1988-12-01", None, "1 December 1988"),
        ("AW", "NL", 16, "Aruba", "1986-01-01", None, "1 January 1986"),
        ("CW", "NL", 16, "Curaçao", "2010-10-10", None, "10 October 2010"),
        ("SX", "NL", 16, "Sint Maarten", "2010-10-10", None, "10 October 2010"),
        ("BQ", "NL", 16, "Bonaire, Sint Eustatius and Saba", "2010-10-10", None, "10 October 2010"),
    ]
    for flag, via, page, name, start, end, stamp in entries:
        if name not in notes[page] or stamp not in notes[page]:
            raise ValueError(f"Unrecognized SOLAS territorial application: {flag}")
        event = dict(flag=flag, via=via, sourceName=name, kind="Territorial application", registeredOn=None,
                     effectiveFrom=start, sourceUrl=STATUS_URL + f"#page={page}", register=REGISTER)
        if end:
            event["effectiveTo"] = end
        records.setdefault(flag, []).append(event)


def verify_comparison(book, supplement):
    evidence = " ".join(" ".join(p.get_text(sort=True).split()) for p in [book[0], book[1]]).casefold()
    for phrase in ["apply only to ships engaged on international voyages", "the extent of the application is shown, in each chapter",
                   "port outside such country, or conversely", "a child under one year of age", "more than twelve passengers",
                   "any ship which is not a passenger ship", "cargo ships of less than 500 tons gross tonnage",
                   "pleasure yachts not engaged in trade", "fishing vessels.", "the 63rd meridian", "a single international voyage"]:
        if phrase not in evidence:
            raise ValueError(f"Consolidated SOLAS reference lost the reviewed wording: {phrase}")
    contents = " ".join(supplement[0].get_text().split())
    if "1 January 2026" not in contents or "MSC.532(107)" not in contents:
        raise ValueError("Unexpected IMO January 2026 supplement")


def original_sections(document):
    sections = []
    for key, (number, title, areas) in AREAS.items():
        texts, images = [], []
        with pymupdf.open() as excerpt:
            for pn, top, bottom, first, last in areas:
                source, rect = document[pn - 1], pymupdf.Rect(22, top, 407, bottom)
                raw = " ".join(source.get_text("text", clip=rect, sort=True).split())
                if not raw.startswith(first) or not raw.endswith(last):
                    raise ValueError(f"SOLAS {number}: wrong section bounds {raw[:40]!r}, {raw[-40:]!r}")
                raw = raw.replace("precisely denned", "precisely defined").replace("Conven tion", "Convention")
                raw = raw.replace("(/) A passenger ship", "(f) A passenger ship").replace("excep tional", "exceptional").replace("Adminis tration", "Administration")
                texts.append(re.sub(r" (?=\([a-giv]{1,3}\) )", "\n", raw))
                pixels = source.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=rect, colorspace=pymupdf.csGRAY)
                out = excerpt.new_page(width=rect.width, height=rect.height)
                out.insert_image(out.rect, stream=pixels.tobytes("png"))
                images.append(pixels.samples)
            excerpt.set_metadata({"title": "SOLAS " + number + " · " + title})
            data = excerpt.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1)
        with pymupdf.open(stream=data, filetype="pdf") as check:
            if len(check) != len(areas):
                raise ValueError("Unexpected SOLAS page count")
            for page, original in zip(check, images):
                if page.get_pixmap(matrix=pymupdf.Matrix(4, 4), colorspace=pymupdf.csGRAY).samples != original:
                    raise ValueError(f"SOLAS {number}: excerpt differs from original pixels")
        path = "pdf/solas-1974-" + key + ".pdf"
        write_bytes(SITE / path, data)
        sections.append(dict(id=key, number=number, title=title, pages=[a[0] for a in areas], clip=path, text="\n".join(texts)))
    return sections


def field(key, label, help_text, section, options=None):
    answer = dict(key=key, label=label, help=help_text, type="select" if options else "number",
                  source=dict(versionId="solas-1974-NO", sectionId=section))
    if options:
        answer["options"] = [dict(value=k, label=v) for k, v in options]
    return answer


FIELDS = [
    field("solasVoyage", "Voyage under SOLAS I/2(d)", "The voyage must run between a country to which SOLAS applies and a port outside that country, in either direction.", "voyage",
          [("international", "International voyage"), ("single", "Exceptional single international voyage"), ("other", "Other voyage")]),
    field("solasException", "Does a listed SOLAS vessel exception describe the ship?",
          "Rule I/3(a) lists these categories. The separate cargo-ship tonnage test is evaluated independently. Other SOLAS chapters can expressly apply.", "exceptions",
          [("none", "None of these categories"), ("fishing", "Fishing vessel"), ("yacht", "Pleasure yacht outside trade"),
           ("military", "Warship or troopship"), ("propulsion", "Without mechanical propulsion"), ("wood", "Wooden ship of primitive build")]),
    field("solasLakes", "Sailing solely within the I/3(b) Great Lakes–St Lawrence boundary",
          "Use the line from Cap des Rosiers to West Point on Anticosti Island and the 63rd meridian north of the island. Chapter V has its own provisions.", "exceptions",
          [("yes", "Yes"), ("no", "No")]),
    field("solasPassengers", "Passengers counted under SOLAS I/2(e)", "Exclude the master, crew, persons working on the ship's business and children under one year of age. More than 12 makes a passenger ship for this definition.", "passengers"),
    field("solasTonnage", "Ship's gross tonnage for this SOLAS threshold",
          "Use the tonnage applicable to SOLAS on the ship's official records for the date in question. Historical tonnage treatment can differ. This is a tonnage measure, distinct from deadweight.", "exceptions"),
]


def instrument(flag, events, name, shared):
    flag_rule = criterion("flag", flag, "SOLAS article II and the IMO depositary state or territorial action")
    voyage = {"any": [criterion("solasVoyage", v, "SOLAS I/1(a) and I/2(d)") for v in ["international", "single"]]}
    size = {"any": [criterion("solasPassengers", 12, "SOLAS I/2(e)–(g)", "gt"),
                    criterion("solasTonnage", 500, "SOLAS I/3(a)(ii) and I/2(g)", "gte")]}
    scope = {"all": [flag_rule, voyage, criterion("solasException", "none", "SOLAS I/3(a)(i), (iii)–(vi)"),
                     criterion("solasLakes", "no", "SOLAS I/3(b)"), size]}
    qualifier = "These are Chapter I's general application rules. Each chapter specifies its own coverage. Chapter V and the polar provisions of Chapter XIV can reach vessels outside the general rule."
    rules = {
        "scope": (scope, "section", qualifier),
        "flag": (scope, "context", "Article II uses entitlement to fly a contracting government's flag."),
        "voyage": (scope, "context", "Read the country-to-port definition in both directions."),
        "passengers": (scope, "context", "Use the treaty passenger count. Any ship outside the passenger-ship definition is a cargo ship for this purpose."),
        "exceptions": (scope, "context", qualifier),
        "single-voyage": ({"all": [scope, criterion("solasVoyage", "single", "SOLAS I/4(a)")]}, "context",
                          "Only the Administration may grant this exemption, subject to adequate safety requirements for the voyage. Check the decision and its terms."),
    }
    sections = [{**s, "criteria": rules[s["id"]][0], "screeningLevel": rules[s["id"]][1], "caveat": rules[s["id"]][2]} for s in shared]
    versions = []
    for action in events:
        identifier = "solas-1974-" + flag + ("-" + action["via"] if action.get("via") else "")
        evidence = f'{action["sourceName"]}: {action["kind"].lower()} effective {action["effectiveFrom"]}.'
        if action.get("via"):
            evidence += " Territorial application through " + action["via"] + "."
        if action.get("note"):
            evidence += " " + action["note"]
        versions.append(dict(id=identifier, label="SOLAS general provisions · " + name, kind="Original treaty, selected provisions checked against later editions",
                             language="en", publishedOn=None, publicationYear=1980, adoptedOn="1974-11-01",
                             effectiveFrom=action["effectiveFrom"], effectiveTo=action.get("effectiveTo"), verifiedThrough=CHECKED,
                             pdf="pdf/solas-1974-un.pdf", pdfSha256=FILES["original"][1], sourcePage=UN_PAGE, sourceUrl=UN_PDF,
                             sourceLinks=[action["sourceUrl"], ICELAND, SUPPLEMENT, POLAR, IMO], flagEvidence=action, sections=sections,
                             notes=evidence + " The UN registered the treaty on 30 June 1980. Only the listed extracts are screened. Iceland's published reference edition and IMO's status record and January 2026 supplement support the selected scope thresholds. The original English wording is reproduced."))
    return dict(id="IMO-SOLAS-1974-" + flag, title="International Convention for the Safety of Life at Sea · Chapter I · " + name,
                shortTitle="SOLAS general application · " + name, jurisdiction=flag, flagState=flag, scopeSection="scope",
                authority="International Maritime Organization", register=REGISTER, language="en", versions=versions)


def build(cache, refresh):
    countries = json.loads((SITE / "data/countries.json").read_text("utf8"))["countries"]
    names = {row["code"]: row["name"] for row in countries}
    with source_file("comparison", cache, refresh) as book, source_file("supplement", cache, refresh) as supplement:
        verify_comparison(book, supplement)
    with source_file("status", cache, refresh) as status:
        actions = flag_actions(status, countries)
        territorial_actions(actions, status)
    with source_file("original", cache, refresh) as original:
        sections = original_sections(original)
    instruments = [instrument(flag, events, names[flag], sections) for flag, events in sorted(actions.items())]
    return dict(version=1, checkedAt=CHECKED, fields=FIELDS, instruments=instruments, comparisons=[], partyCount=169,
                territorialFlagCount=len(instruments)-169, register=IMO_INDEX, coverage="Article II and selected passages of SOLAS Chapter I, Part A. Other chapters have specific scope, including chapter V and the 2026 polar amendments. Dated actions cover named parties and selected express territorial applications.",
                reuse=dict(individualTreaty=UN_POLICY, comparison="The Icelandic authority's consolidated reference, the IMO register, and the 2026 supplement are linked to their publishers."))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".work/solas")
    parser.add_argument("--refresh", action="store_true", help="Recheck the pinned publisher files")
    args = parser.parse_args()
    data = build(args.cache, args.refresh)
    write_bytes(SITE / "data/solas-folios.json", (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    print(f'{data["partyCount"]} SOLAS parties, {data["territorialFlagCount"]} additional flags and {len(AREAS)} shared treaty passages')


if __name__ == "__main__":
    main()
