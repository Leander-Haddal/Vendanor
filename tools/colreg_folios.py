"""Build flag-specific COLREG extracts from the treaty, amendment and depositary records."""

import argparse
import calendar
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen

import pymupdf

from folios import write_bytes


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
CHECKED = "2026-11-23"
AMENDED = "1983-06-01"
ORIGINAL_DAY = "1977-07-15"
REGISTER = "IMO Status Book 2026, volume I, COLREG 1972"
IMO_INDEX = "https://www.imo.org/en/about/conventions/pages/statusofconventions.aspx"
STATUS_URL = "https://wwwcdn.imo.org/localresources/en/About/Conventions/StatusOfConventions/Status%20book%202026%20-%20Vol.%20I%20SOLAS-COLREG-%20MARPOL.pdf"
RESOLUTION = "https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/AssemblyDocuments/A.464%28XII%29.pdf"
MCA = "https://www.gov.uk/government/publications/msn-1781-mf-amendment-3-the-merchant-shipping-regulations-1996-colreg/appendix-2-original-colreg-and-amendments"
UN_PAGE = "https://treaties.un.org/pages/showDetails.aspx?objid=08000002800fcf87"
US_PAGE = "https://www.navcen.uscg.gov/navigation-rules-amalgamated"
UN_POLICY = "https://uncitral.un.org/sites/default/files/media-documents/uncitral/en/policy_manual_rev_sept_2020.pdf"
US_POLICY = "https://www.uscg.mil/Community/faq/"
SOURCES = {
    "imo": (STATUS_URL, "70ad59fa1786051db70476070b8f80a0a8379ef981af65193be1c9a563c06c73"),
    "un": ("https://treaties.un.org/doc/Publication/UNTS/Volume%201050/volume-1050-I-15824-English.pdf",
           "2ec7f890856774007b4eb0e34fe7aebeeadba0702cef43143b82aec740d3c928"),
    "usbook": ("https://www.navcen.uscg.gov/sites/default/files/pdf/navRules/Handbook/Nav%20Rules%20Handbook_Corrected_08-12-2024.pdf",
               "dcc7eb6d279be614a4fd4e18cbea6bbf55b44f0322ba0a0a07f2f0265dd633e2"),
}
TITLES = {
    "scope": ("Rule 1(a)–(b)", "Waters covered and local special rules"),
    "responsibility": ("Rule 2", "Responsibility of the vessel, owner, master and crew"),
    "length": ("Rule 3(j)", "Length overall and greatest breadth"),
    "lookout": ("Rule 5", "Look-out"),
    "r22": ("Rule 22", "Minimum visibility ranges of prescribed lights"),
    "r22a": ("Rule 22(a)", "Light ranges at 50 metres overall and above"),
    "r22b": ("Rule 22(b)", "Light ranges from 12 to under 50 metres overall"),
    "r22c": ("Rule 22(c)", "Light ranges below 12 metres overall"),
    "r22d": ("Rule 22(d)", "Light on an inconspicuous, partly submerged tow"),
}
# Each rectangle is a single consecutive passage on a physical PDF page. The
# original is an image scan. Its OCR boxes overlap several neighbouring lines.
# The visible image and the text layer therefore have separate boundary checks.
BOUNDS = {
    "un": {
        "scope": (6, 105, 190, "Ride 1", "possible to these Rules."),
        "responsibility": (6, 367, 473, "Rule 2", "avoid immediate danger."),
        "length": (7, 365, 387, "(/) The words", "greatest breadth."),
        "lookout": (7, 513, 569, "Rule 5", "risk of collision."),
        "r22": (14, 76, 359, "Rule 22", "all-round light, 2 miles."),
        "r22a": (14, 76, 195, "Rule 22", "all-round light, 3 miles;"),
        "r22b": (14, 196, 281, "(b) in vessels", "all-round light, 2 miles;"),
        "r22c": (14, 282, 359, "(c) in vessels", "all-round light, 2 miles."),
    },
    "usbook": {
        "scope": (11, 118, 266, "Rule 1", "possible to these Rules."),
        "responsibility": (13, 335, 474, "Rule 2", "avoid immediate danger."),
        "length": (17, 139, 161, "(j) The words", "greatest breadth."),
        "lookout": (19, 252, 348, "Rule 5", "risk of collision."),
        "r22": (45, 86, 474, "Rule 22", "all-round light, 3 miles."),
        "r22a": (45, 86, 242, "Rule 22", "all-round light, 3 miles."),
        "r22b": (45, 245, 350, "(b) In vessels", "all-round light, 2 miles."),
        "r22c": (45, 359, 440, "(c) In vessels", "all-round light, 2 miles."),
        "r22d": (45, 443, 474, "(d) In inconspicuous", "all-round light, 3 miles."),
    },
}


def source_bytes(key, cache, refresh):
    url, digest = SOURCES[key]
    local = SITE / "pdf" / ("colreg-" + key + ".pdf")
    choices = (cache / (key + ".pdf"), local)
    found = next((path for path in choices if path.is_file()), None)
    if found and not refresh:
        data = found.read_bytes()
    else:
        request = Request(url, headers={"User-Agent": "Maritime law library/1.0", "Accept": "application/pdf"})
        with urlopen(request, timeout=90) as response:
            data = response.read(12_000_001)
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"{key}: upstream PDF changed; review dates and page bounds before updating the pinned digest")
    if key != "imo":
        write_bytes(local, data)
    else:
        write_bytes(choices[0], data)
    return data


def name_key(name):
    plain = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", plain)


def iso_date(stamp):
    day, month, year = stamp.split()
    return f"{year}-{list(calendar.month_name).index(month):02d}-{int(day):02d}"


def parties(document, countries):
    lookup = {name_key(row["name"]): row["code"] for row in countries}
    lookup.update(moldova="MD", nauru="NR", netherlands="NL", unitedkingdom="GB", unitedstates="US")
    date_pattern = r"\d{1,2} [A-Za-z]+ \d{4}"
    pattern = re.compile(rf"^(.*?)\s{{2,}}(-|{date_pattern})\s{{2,}}({date_pattern})\s*$")
    evidence = {}
    for page in range(107, 111):
        text = document[page - 1].get_text(sort=True)
        if page == 107:
            text = text.split("II. Parties to the Convention", 1)[1]
        if page == 110:
            text, total = text.split("Number of Contracting States:", 1)
        for line in text.splitlines():
            match = pattern.fullmatch(line)
            if not match:
                continue
            title, registered, entered = match.groups()
            event = re.search(r"\s*\((accession|succession|approval|ratification|acceptance|signature)\)", title)
            name = re.sub(r"\d+$", "", title[:event.start()] if event else title).strip()
            code = lookup[name_key(name)]
            if code in evidence:
                raise ValueError(f"Duplicate IMO party: {name}")
            effective = iso_date(entered)
            evidence[code] = [dict(flag=code, sourceName=name, kind=event[1].capitalize() if event else "Party (action unspecified)",
                                   registeredOn=None if registered == "-" else iso_date(registered),
                                   effectiveFrom=effective, sourceUrl=STATUS_URL + f"#page={page}", register=REGISTER)]
    if len(evidence) != int(total.strip().split()[0]) or len(evidence) != 166:
        raise ValueError("Expected all 166 reviewed parties in the IMO table")
    evidence["RU"][0].update(predecessorEffectiveFrom=ORIGINAL_DAY, effectiveFrom="1991-12-26",
                             note="The table records the USSR's accession. The Russian Federation continued membership on 26 December 1991 (note 5).")
    evidence["DE"][0]["note"] = "The Federal Republic of Germany ratified. The German Democratic Republic joined the Federal Republic on 3 October 1990 (note 4)."
    for flag in ("RS", "ME"):
        evidence[flag][0]["note"] = "The depositary gives 3 June 2006 for the dissolution of Serbia and Montenegro (notes 10 and 11)."
    return evidence


def territories(evidence, document, country_names):
    # Each grouped entry shares an explicitly printed effective date. Exclude
    # disputed extensions and superseded trust territories from automatic scope.
    notes_text = " ".join(" ".join(document[p - 1].get_text(sort=True).split()) for p in [110, 111, 112])
    names = {"JE": "Bailiwick of Jersey", "GG": "Bailiwick of Guernsey", "VG": "British Virgin Islands",
             "PN": "Pitcairn Islands Group", "TC": "Turks and Caicos Islands", "VI": "Virgin Islands of the United States",
             "SX": "Sint Maarten", ("HK", "GB"): "Hong Kong", ("HK", "CN"): "Hong Kong Special Administrative Region",
             ("MO", "PT"): "Macau", ("MO", "CN"): "Macao Special Administrative Region"}
    def add(flags, via, page, start, printed, *, end=None, deposited=None, note=""):
        for name in printed:
            if name not in notes_text:
                raise ValueError("Unrecognized territorial footnote: " + name)
        for flag in flags.split():
            source_name = names.get((flag, via), names.get(flag, country_names[flag]))
            record = dict(flag=flag, sourceName=source_name, kind="Territorial application", via=via,
                          registeredOn=deposited, effectiveFrom=start, register=REGISTER,
                          sourceUrl=STATUS_URL + f"#page={page}", note=note)
            if end:
                record["effectiveTo"] = end
            evidence.setdefault(flag, []).append(record)
    add("JE GG IM", "GB", 110, ORIGINAL_DAY, ["Bailiwick of Jersey", "of Guernsey, Isle of Man"], deposited=ORIGINAL_DAY)
    add("BM VG KY GI MS PN TC", "GB", 110, ORIGINAL_DAY,
        ["Bermuda", "British Virgin Islands", "Cayman Islands", "Gibraltar", "Montserrat", "Pitcairn Islands Group", "Turks and Caicos Islands"],
        deposited="1977-08-08")
    add("AS GU PR VI", "US", 111, ORIGINAL_DAY, ["Puerto Rico, Guam", "Virgin Islands", "American Samoa"], deposited="1977-04-01")
    add("HK", "GB", 110, ORIGINAL_DAY, ["Hong Kong", "Ceased to apply to Hong Kong"], end="1997-07-01", deposited="1974-10-30")
    add("HK", "CN", 110, "1997-07-01", ["Hong Kong Special Administrative Region with effect from 1 July 1997"])
    add("MO", "PT", 112, "1999-03-22", ["Applies to Macau with effect from 22 March 1999"], end="1999-12-20")
    add("MO", "CN", 110, "1999-12-20", ["Macao Special Administrative Region with effect from 20 December 1999"])
    add("AW", "NL", 112, "1986-01-01", ["Aruba (with effect from 1 January 1986)"])
    add("CW SX", "NL", 112, "2010-10-10", ["Curaçao", "Sint Maarten", "10 October 2010"])


def reading_text(raw, edition, key):
    text = " ".join(raw.split())
    if edition == "un":
        if key == "scope":
            text = text.replace("Ride 1.", "Rule 1.", 1)
        if key == "length":
            text = text.replace("(/)", "(j)", 1)
        if key == "lookout":
            text = text.replace("Rule 5,", "Rule 5.", 1)
    text = re.sub(r" (?=\([a-d]\) )", "\n", text)
    return text.replace(" − ", "\n− ")


def document_sections(edition, original):
    result = []
    for key, (pn, top, bottom, first, last) in BOUNDS[edition].items():
        page = original[pn - 1]
        left, right = (12, 413) if edition == "un" else (20, 377)
        rect = pymupdf.Rect(left, top, right, bottom)
        raw = " ".join(page.get_text("text", clip=rect, sort=True).split())
        if not raw.startswith(first) or not raw.endswith(last):
            raise ValueError(f"{edition} {key}: wrong printed boundary: {raw[:65]!r}, {raw[-65:]!r}")
        title = TITLES[key]
        with pymupdf.open() as excerpt:
            if edition == "un":
                # A lossless inset of the original scan avoids carrying inaccurate
                # invisible OCR from adjacent paragraphs into the opened PDF.
                scale = pymupdf.Matrix(4, 4)
                pixels = page.get_pixmap(matrix=scale, colorspace=pymupdf.csGRAY, clip=rect, alpha=False)
                out = excerpt.new_page(width=rect.width, height=rect.height)
                out.insert_image(out.rect, stream=pixels.tobytes("png"))
            else:
                # Retain selectable typeset text. Redact the surrounding page as
                # well as cropping it so expanding the box cannot reveal other rules.
                excerpt.insert_pdf(original, from_page=pn - 1, to_page=pn - 1, links=False, annots=False, widgets=False)
                out = excerpt[0]
                w, h = out.rect.width, out.rect.height
                for outside in [(0, 0, w, top), (0, bottom, w, h), (0, top, left, bottom), (right, top, w, bottom)]:
                    out.add_redact_annot(outside, fill=None, cross_out=False)
                out.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                                     graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                                     text=pymupdf.PDF_REDACT_TEXT_NONE)
                # Font extents in consecutive printed lines overlap. Remove each
                # unwanted line through its centre, away from the adjacent line.
                for block in page.get_text("dict")["blocks"]:
                    for line in block.get("lines", []):
                        x0, y0, x1, y1 = line["bbox"]
                        mid = (y0 + y1) / 2
                        if mid < top or mid > bottom or x1 <= left or x0 >= right:
                            out.add_redact_annot((x0, mid, x1, mid + 0.05), fill=None, cross_out=False)
                out.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
                out.set_cropbox(rect)
            excerpt.set_metadata({"title": "COLREG " + title[0] + " · " + title[1]})
            data = excerpt.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1)
        with pymupdf.open(stream=data, filetype="pdf") as checked:
            after = checked[0]
            if edition == "un":
                original_pixels = pymupdf.Pixmap(checked, after.get_images()[0][0])
                if original_pixels.samples != pixels.samples:
                    raise ValueError(f"{edition} {key}: pixel crop changed")
            else:
                for box in [after.cropbox, after.mediabox]:
                    after.set_cropbox(box)
                    if " ".join(after.get_text("text", sort=True).split()) != raw:
                        raise ValueError(f"{edition} {key}: cropped PDF lost or retained words")
        path = "pdf/colreg-" + edition + "-" + key + ".pdf"
        write_bytes(SITE / path, data)
        result.append(dict(id=key, number=title[0], title=title[1], text=reading_text(raw, edition, key), pages=[pn], clip=path))
    return result


def criterion(field, value, source, op="eq"):
    return dict(field=field, op=op, value=value, source=source)


def scoped_sections(rows, flag):
    flag_rule = criterion("flag", flag, REGISTER + ", party or territorial record")
    def water(value):
        return criterion("colregWaters", value, "Rule 1(a)–(b)")
    def reach(*types):
        return {"all": [flag_rule, {"any": [water(value) for value in types]}]}
    geographical = reach("high", "connected", "special")
    navigation = reach("high", "connected")
    lights = criterion("colregLightBasis", "ordinary", "Rules 1(e), 22 and 38(a)")
    scope_note = "Rule 1(b) preserves local special rules. Check the competent authority's demarcation and local rules for the waters where the boat operates."
    light_note = "Rule 22 sets ranges for lights prescribed elsewhere. Check the vessel's required light arrangement, Rule 1(e) determinations and any historical Rule 38(a) relief. Rule 3(j) uses length overall."
    rules = {
        "scope": (geographical, "section", scope_note),
        "responsibility": (navigation, "section", "The rule addresses vessels, owners, masters and crew. Paragraph (b) covers special circumstances and immediate danger."),
        "length": (navigation, "context", "Rule 3 introduces definitions except where the context otherwise requires."),
        "lookout": (navigation, "section", "Applies at all times. Rule 4 covers any condition of visibility."),
        "r22": (None, "unmapped", "Complete comparison text for Rule 22. Individual lettered paragraphs are screened by vessel particulars."),
    }
    for key, limits in [("r22a", [("gte", 50)]), ("r22b", [("gte", 12), ("lt", 50)]), ("r22c", [("lt", 12)])]:
        size = [criterion("lengthOverall", value, TITLES[key][0] + " and Rule 3(j)", op) for op, value in limits]
        rules[key] = ({"all": [navigation, lights, *size]}, "section",
                      light_note + (" Paragraph (b) gives a shorter masthead-light range below 20 metres." if key == "r22b" else ""))
    rules["r22d"] = ({"all": [navigation, lights, criterion("colregTowSubject", "yes", "Rule 22(d)")]},
                     "section", "This is the light on the qualifying vessel or object being towed. Rule 24 sets separate display requirements.")
    return [{**row, "criteria": rules[row["id"]][0], "screeningLevel": rules[row["id"]][1], "caveat": rules[row["id"]][2]} for row in rows]


def edition_id(edition, flag, event):
    return "colreg-" + edition + "-" + flag + ("-" + event["via"] if event.get("via") else "")


def make_version(edition, flag, event, rows):
    old = edition == "un"
    start = max(event["effectiveFrom"], ORIGINAL_DAY if old else AMENDED)
    ends = [stamp for stamp in (event.get("effectiveTo"), AMENDED if old else None) if stamp]
    end = min(ends) if ends else None
    if end and end <= start:
        return None
    label = "Original Regulations" if old else "Regulations with the 1981 Rule 22 amendment"
    note = (f'{event["sourceName"]}. {event["kind"]} effective {event["effectiveFrom"]}. '
            + (f'Extension through {event["via"]}. ' if "via" in event else "") + (event.get("note", "") + " ").strip() + " ")
    note += ("Concluded on 20 October 1972 and registered with the UN on 8 August 1977. The 1977 Treaty Series reproduces the original Regulations and their recorded rectifications."
             if old else "The US Coast Guard's international pages supply the selected text. IMO A.464(XII) added Rule 22(d) on 1 June 1983. The UK Maritime and Coastguard Agency's amendment table identifies subsequent changes elsewhere in the Rules.")
    return dict(id=edition_id(edition, flag, event), label=label, language="en",
                kind="Treaty as concluded" if old else "International regulations, selected provisions as amended",
                adoptedOn="1972-10-20" if old else "1981-11-19", publishedOn=None if old else "2024-08-08",
                publicationYear=1977 if old else 2024, effectiveFrom=start, effectiveTo=end, verifiedThrough=CHECKED,
                sourcePage=UN_PAGE if old else US_PAGE, sourceUrl=SOURCES[edition][0],
                sourceLinks=[event["sourceUrl"], RESOLUTION, MCA, UN_PAGE if not old else US_PAGE],
                flagEvidence=event, pdf="pdf/colreg-" + edition + ".pdf", pdfSha256=SOURCES[edition][1],
                notes=note.strip(), sections=scoped_sections(rows, flag))


def field(key, label, help_text, section, options):
    return dict(key=key, label=label, type="select", help=help_text,
                source=dict(versionId="colreg-usbook-NO", sectionId=section),
                options=[dict(value=value, label=text) for value, text in options])


FIELDS = [
    field("colregWaters", "Which navigation rules govern these waters?",
          "Rule 1 covers the high seas and connected waters navigable by seagoing vessels. Check local special rules on rivers, lakes, harbours and inland waterways.", "scope",
          [("high", "High seas"), ("connected", "Connected and navigable by seagoing vessels; international rules confirmed"),
           ("special", "Connected and navigable; local special rules apply or need checking"), ("other", "Other waters")]),
    field("colregLightBasis", "Which light-range standard applies to this vessel?",
          "Check any government-approved alternative under Rule 1(e), and Rule 38(a) for the original four-year transition for older vessels.", "r22",
          [("ordinary", "Ordinary international light ranges"), ("alternative", "A relevant alternative or exemption applies")]),
    field("colregTowSubject", "Is this boat or object the inconspicuous, partly submerged tow?",
          "Answer for the item being towed. The towing vessel has its own lighting rules.", "r22d",
          [("yes", "Yes"), ("no", "No")]),
]


def build(cache, refresh):
    countries = json.loads((SITE / "data/countries.json").read_text("utf8"))["countries"]
    country_names = {row["code"]: row["name"] for row in countries}
    with pymupdf.open(stream=source_bytes("imo", cache, refresh), filetype="pdf") as status:
        flags = parties(status, countries)
        territories(flags, status, country_names)
        if "1 June 1983" not in status[116].get_text():
            raise ValueError("Amendment commencement changed in the depositary register")
    sections = {}
    for ed in BOUNDS:
        with pymupdf.open(stream=source_bytes(ed, cache, refresh), filetype="pdf") as source:
            sections[ed] = document_sections(ed, source)
    instruments = []
    for flag, events in sorted(flags.items()):
        versions = [v for event in events for ed in BOUNDS if (v := make_version(ed, flag, event, sections[ed]))]
        versions.sort(key=lambda v: v["effectiveFrom"])
        if any(a["effectiveTo"] != b["effectiveFrom"] for a, b in zip(versions, versions[1:])):
            raise ValueError(f"Unexpected gap or overlap at {flag}")
        name = country_names[flag]
        instruments.append(dict(id="IMO-COLREG-1972-" + flag, title="International Regulations for Preventing Collisions at Sea · " + name,
                                shortTitle="Collision rules (COLREG) · " + name, jurisdiction=flag, flagState=flag,
                                scopeSection="scope", authority="International Maritime Organization", language="en", register=REGISTER, versions=versions))
    comparisons = [dict(id="colreg-1981-lights", title="COLREG Rule 22 · partly submerged tows",
                        before=dict(versionId="colreg-un-NO", sectionId="r22"), after=dict(versionId="colreg-usbook-NO", sectionId="r22"),
                        kind="Amendment", notes="A.464(XII), paragraph 10, added Rule 22(d) from 1 June 1983. The original English UN text and the USCG publication also differ in typography and regional spelling.")]
    return dict(version=1, checkedAt=CHECKED, register=IMO_INDEX, fields=FIELDS, instruments=instruments,
                comparisons=comparisons, partyCount=166, territorialFlagCount=len(flags) - 166,
                coverage="Named parties and selected explicitly dated territorial applications. The IMO register also records declarations, reservations, former territories and disputed extensions on pages 110–116. Coastal-state and local navigation law can govern vessels under other flags. The indexed text is limited to the specified international rules.",
                reuse=dict(individualTreaty=UN_POLICY, handbook=US_POLICY, depositary="Dates and country identifiers from the IMO status record; the IMO volume is linked at its source."))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".work/colreg")
    parser.add_argument("--refresh", action="store_true", help="Download and check fresh publisher bytes against pinned editions")
    args = parser.parse_args()
    data = build(args.cache, args.refresh)
    write_bytes(SITE / "data/colreg-folios.json", (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    print(f'{data["partyCount"]} contracting states, {data["territorialFlagCount"]} territorial flags, '
          f'{sum(len(i["versions"]) for i in data["instruments"])} dated editions and {sum(map(len, BOUNDS.values()))} shared excerpts')


if __name__ == "__main__":
    main()
