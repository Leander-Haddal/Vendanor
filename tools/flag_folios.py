"""Build selected national vessel provisions and verify their dated source histories."""

import argparse
import gzip
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pymupdf

from folios import write_bytes


SITE = Path(__file__).resolve().parents[1] / "site"
UK, US, NZ = "gb-2020-501", "us-33cfr175-2025", "nz-rule91-2026"
UK_AMEND, NZ_ORIGINAL, NZ_AMEND = "gb-2022-1219", "nz-rule91-2003", "nz-part91-amendment-2007"
CHECKED = "2026-11-23"
UK_LAW = "https://www.legislation.gov.uk/uksi/2020/501"
UK_CHANGE = "https://www.legislation.gov.uk/uksi/2022/1219/schedule/paragraph/25/made"
UK_DATES = ["made", "2020-06-09", "2022-12-19", "2023-08-10", "2023-12-13", "2025-12-12", "2026-01-05"]
US_API = "https://www.ecfr.gov/api/versioner/v1"
US_HISTORY = US_API + "/versions/title-33.json?part=175"
US_THROUGH = "2026-11-19"
NZ_2013 = "https://www.legislation.govt.nz/act/public/2013/84/en/latest/sections/DLM4699159/"
NZ_2013_ACT = "https://www.legislation.govt.nz/act/public/2013/84/en/2014-10-01.pdf"
NZ_2003_GAZETTE = "https://library.victoria.ac.nz/databases/nzgazettearchive/pubs/gazettes/2003/2003%20ISSUE%20015.pdf#page=56"
NZ_2007_GAZETTE = "https://library.victoria.ac.nz/databases/nzgazettearchive/pubs/gazettes/2007/2007%20ISSUE%20058.pdf"


def register_query(date_field):
    criteria = {"conditions[cfr][title]": "33", "conditions[cfr][part]": "175",
                f"conditions[{date_field}][gte]": "2026-11-20", f"conditions[{date_field}][lte]": CHECKED}
    return "https://www.federalregister.gov/api/v1/documents.json?" + urlencode(criteria)


SOURCES = {
    UK: {
        "code": "GB", "authority": "Secretary of State for Transport", "id": "gb-lifesaving-2020",
        "title": "The Merchant Shipping (Life-Saving Appliances and Arrangements) Regulations 2020",
        "shortTitle": "Life-saving appliances and arrangements", "label": "S.I. 2020/501 as made",
        "kind": "Original statutory instrument", "publishedOn": "2020-05-18",
        "effectiveFrom": "2020-06-09", "effectiveTo": "2022-12-19", "verifiedThrough": "2022-12-18",
        "notes": "The instrument was made and laid on 18 May 2020 and commenced on 9 June 2020. The original application provision changed on 19 December 2022 when regulation 4(2)(i) acquired a new high-speed craft reference. Incorporated Merchant Shipping Notices have their own histories.",
        "sourceLinks": [UK_LAW + "/2020-06-09", UK_CHANGE],
        "sourceUrl": "https://www.legislation.gov.uk/uksi/2020/501/pdfs/uksi_20200501_en.pdf",
        "sourcePage": "https://www.legislation.gov.uk/uksi/2020/501/contents/made",
        "sha256": "e04e3caeddce59970d1638f42011b4221b3c5544ffde047d52e027dced6e34f4",
    },
    UK_AMEND: {
        "code": "GB", "authority": "Secretary of State for Transport", "id": "gb-lifesaving-2020",
        "title": "The Merchant Shipping (Life-Saving Appliances and Arrangements) Regulations 2020",
        "shortTitle": "Life-saving appliances and arrangements", "label": "2022 amendment of regulation 4(2)(i)",
        "kind": "Original amending statutory instrument", "publishedOn": None, "editionDate": "2022-11-28",
        "effectiveFrom": "2022-12-19", "verifiedThrough": CHECKED,
        "notes": "S.I. 2022/1219 was made on 28 November 2022 and commenced on 19 December 2022. Schedule paragraph 25 changes the high-speed craft exclusion in the 2020 Regulations. The original PDF prints the substitution. The full revised regulation 4 and its dated editions are available from the legislation register.",
        "sourceUrl": "https://www.legislation.gov.uk/uksi/2022/1219/pdfs/uksi_20221219_en.pdf", "sourcePage": UK_CHANGE,
        "sourceLinks": [UK_LAW + "/regulation/4/2022-12-19", UK_LAW + "/regulation/4", UK_LAW + "/contents"],
        "sha256": "a2abfa45fb5b75b1970811bbbaf9013bf5af758d77ebff56d9bea80cc0b56f8c",
    },
    US: {
        "code": "US", "authority": "U.S. Coast Guard", "id": "us-cfr33-175",
        "title": "33 CFR Part 175 — Equipment Requirements", "shortTitle": "Recreational boat equipment",
        "label": "Title 33, volume 2 · annual edition revised as of 1 July 2025",
        "kind": "Annual Code of Federal Regulations edition", "publishedOn": None,
        "effectiveFrom": "2016-12-31", "editionDate": "2025-07-01", "verifiedThrough": CHECKED,
        "notes": "The original PDF is the annual CFR revised as of 1 July 2025. The selected words agree with the eCFR's earliest available snapshot on 31 December 2016, every indexed revision to their parent sections, and the 19 November 2026 text. Federal Register searches for Part 175 found no further documents published or effective from 20 to 23 November 2026. The start of this comparison interval is the earliest verified wording, not the original commencement date. State requirements may also apply.",
        "sourceLinks": ["https://www.ecfr.gov/on/2026-11-19/title-33/chapter-I/subchapter-S/part-175", US_HISTORY,
                        "https://www.ecfr.gov/on/2016-12-31/title-33/chapter-I/subchapter-S/part-175",
                        register_query("publication_date"), register_query("effective_date")],
        "sourceUrl": "https://www.govinfo.gov/content/pkg/CFR-2025-title33-vol2/pdf/CFR-2025-title33-vol2-part175.pdf",
        "sourcePage": "https://www.govinfo.gov/app/details/CFR-2025-title33-vol2/CFR-2025-title33-vol2-part175",
        "sha256": "cbd0495999cef06cff7ce696c033b9c31ec06a068d990a671290cc9a6f90a844",
    },
    NZ: {
        "code": "NZ", "authority": "Maritime New Zealand", "id": "nz-navigation-part91",
        "title": "Maritime Rules Part 91 — Navigation Safety Rules", "shortTitle": "Navigation safety rules",
        "label": "Maritime New Zealand consolidation of 9 October 2026", "kind": "Government consolidation",
        "publishedOn": None, "editionDate": "2026-10-09", "effectiveFrom": "2026-10-09", "verifiedThrough": CHECKED,
        "notes": "Maritime New Zealand identifies 9 October 2026 as the entry into force of the lifejackets amendment. The PDF consolidates Part 91 as of that date. Local navigation bylaws can add requirements. PDF page numbers count the cover and preliminary material.",
        "sourceUrl": "https://www.maritimenz.govt.nz/media/rhwkcqt1/part91-maritime-rule.pdf",
        "sourcePage": "https://www.maritimenz.govt.nz/about-us/rules/all-rules/maritime-rules-part-91/",
        "sha256": "ac1ca62c4e37950b92f5cf275af6d1a126abbd3e202fc8f1743471c090108bd5",
    },
    NZ_ORIGINAL: {
        "code": "NZ", "authority": "Maritime New Zealand", "id": "nz-navigation-part91",
        "title": "Maritime Rules Part 91 — Navigation Safety Rules", "shortTitle": "Navigation safety rules",
        "label": "Original signed Part 91 · in force 21 March 2003", "kind": "Original signed maritime rule", "publishedOn": "2003-02-20",
        "effectiveFrom": "2003-03-21", "effectiveTo": "2007-06-28", "verifiedThrough": "2007-06-27",
        "notes": "The 20 February 2003 Gazette notified Part 91 and specified commencement on 21 March 2003. Physical pages 13 and 21–22 of the signed rule provide the original passages. These image-only pages were transcribed against the scan. Rule 91.3 refers to local bylaws and a transition until 31 March 2004. The next signed amendment took effect on 28 June 2007.",
        "sourceUrl": "https://www.maritimenz.govt.nz/media/jmtosrwm/part91-maritime-rule-original.pdf",
        "sourcePage": "https://www.maritimenz.govt.nz/about-us/rules/all-rules/maritime-rules-part-91/",
        "sourceLinks": [NZ_2003_GAZETTE, NZ_2007_GAZETTE, NZ_2013], "sha256": "39cf2b734768b4a043d59f14a3c44cc13b4da608ba53b33c3cce51dd6b66ae5b",
    },
    NZ_AMEND: {
        "code": "NZ", "authority": "Maritime New Zealand", "id": "nz-navigation-part91",
        "title": "Maritime Rules Part 91 — Navigation Safety Rules", "shortTitle": "Navigation safety rules",
        "label": "Part 91 Amendment Rules 2007 · clause 3", "kind": "Signed amending maritime rule", "publishedOn": "2007-05-31",
        "effectiveFrom": "2007-06-28", "effectiveTo": "2013-10-23", "verifiedThrough": "2013-10-22",
        "notes": "Clause 1 of the signed rules and the 31 May 2007 Gazette both give commencement as 28 June 2007. The 2026 administrative amendment ledger gives a different month. Clause 3 changed only rule 91.3(1), replacing ‘New Zealand’ with ‘New Zealand waters’. Schedule 2 of the 2013 Act subsequently replaced the entire rule.",
        "sourceUrl": "https://www.maritimenz.govt.nz/media/3j0jn4ca/mr091ammendment.pdf",
        "sourcePage": "https://www.maritimenz.govt.nz/about-us/rules/all-rules/maritime-rules-part-91/",
        "sourceLinks": [NZ_2007_GAZETTE, NZ_2013, NZ_2013_ACT], "sha256": "41aff6d3d4d12b2f8529d15c396a35fa5651a1608c77a9bfe621de28e0b9e393",
    },
}

YES_NO = [("yes", "Yes"), ("no", "No")]
CLASSES = ["I", "II", "II(A)", "VII", "VII(A)", "VII(T)", "VIII", "VIII(A)", "VIII(T)", "VIII(A)(T)",
           "IX", "IX(A)", "IX(A)(T)", "XI", "XII"]


def field(key, label, help_text, version, section, *, options=YES_NO, unit=None, kind="select"):
    result = {"key": key, "type": kind, "label": label, "help": help_text,
              "source": {"versionId": version, "sectionId": section}}
    if kind == "select":
        result["options"] = [{"value": v, "label": name} for v, name in options]
    if unit:
        result["unit"] = unit
    return result


FIELDS = [
    field("ukLsaReach", "UK ship or operating within UK waters", "Regulation 4 covers United Kingdom ships wherever they are, and other ships in United Kingdom waters.", UK, "application",
          options=[("uk", "United Kingdom ship"), ("waters", "Other ship in United Kingdom waters"), ("outside", "Neither")]),
    field("ukLsaExcluded", "An exclusion in regulation 4(2) or 4(3) applies", "Check the full regulation for your date, including ship classes, fishing, pleasure use and circumstances of entry. The high-speed craft reference changed on 19 December 2022.", UK, "application"),
    field("ukLsaHighSpeed", "High-speed craft subject to the referenced UK regulations", "Use the High Speed Craft Regulations cited at the research date: the 2004 Regulations before 19 December 2022 and the 2022 Regulations from that date.", UK_AMEND, "high-speed-reference"),
    field("ukLsaClass", "UK statutory ship class", "Use the class assigned under Schedule 2 of this instrument. These are statutory service classes.", UK, "older-international",
          options=[(c, "Class " + c) for c in CLASSES] + [("other", "Another class")]),
    field("ukLsaConstruction", "Keel laid or similar construction stage", "Use the date the keel was laid or the date the ship reached the similar stage defined by regulation 2. Completion and delivery dates refer to different milestones.", UK, "construction", kind="date"),
    field("ukLsaInternational", "International voyage under regulation 2", "Use the ports and Convention-country definition printed in regulation 2.", UK, "voyage"),
    field("usPart175Location", "U.S. Part 175 operating area", "Choose waters subject to U.S. jurisdiction or the high seas beyond territorial seas for a boat owned in the United States.", US, "application",
          options=[("waters", "Waters subject to U.S. jurisdiction"), ("highseas", "U.S.-owned boat on the high seas beyond territorial seas"), ("outside", "Neither")]),
    field("usPart175Excluded", "A § 175.1(a)–(e) exclusion applies", "The full list covers foreign boats temporarily using U.S. waters, specified military or public boats, state government boats, ships’ lifeboats and seaplanes on the water.", US, "application"),
    field("usPfdCraft", "Recreational vessel within § 175.11", "Use §§ 175.3 and 175.11 to check the definition of recreational vessel and the means of propulsion or control.", US, "subpart-scope"),
    field("usPfdLengthFt", "Length for the § 175.15 flotation rule", "Enter the length in feet used to apply § 175.15(b).", US, "throwable", kind="number", unit="ft"),
    field("usPfdExemption", "An exemption under § 175.17 applies", "For the additional throwable device, check canoes and kayaks of at least 16 feet, racing craft, sailboards and the qualifying foreign-competitor case.", US, "exemptions"),
    field("nzPart91Waters", "Operating in New Zealand waters", "Part 91 applies throughout New Zealand waters under rule 91.3.", NZ, "application"),
    field("nzOriginalArea", "Original Part 91 bylaw and transition conditions apply", "For the 2003 signed rule, check whether the area had navigation bylaws, their consistency with Part 91 and the transition until 31 March 2004 in 91.3(2)–(3).", NZ_ORIGINAL, "application"),
    field("nzRecCraft", "Recreational craft under rule 91.2", "The definition includes a pleasure craft or a vessel powered solely by hand or solely by sail.", NZ, "recreational-craft"),
    field("nzLifejacketLengthM", "New Zealand Part 91 length overall", "Rule 91.2 includes projecting structures such as buoyancy tubing and excludes specified fittings such as bowsprits and outboard drive units. Use this length in metres for the six-metre test in 91.4(1A).", NZ, "length", kind="number", unit="m"),
    field("nzUnderway", "Craft underway under rule 91.2", "Underway excludes a vessel at anchor, made fast to the shore or aground.", NZ, "underway"),
    field("nzLifejacketException", "An exception to rule 91.4(1A) applies to this person", "Check swimming under (1B), the activities and equipment in (2), a qualifying support vessel in (4) and any written regional exemption under (5).", NZ, "lifejackets"),
    field("nzHarbour", "Both vessels are in a harbour area defined by bylaw", "Check the regional navigation bylaw. Rule 91.16(2) defines harbour area for this duty.", NZ, "harbour"),
    field("nzOtherVesselGt", "Other vessel's gross tonnage", "Use the gross tonnage of the vessel whose navigation could be impeded.", NZ, "harbour", kind="number", unit="GT"),
]


def condition(key, value, source, op="eq"):
    return {"field": key, "op": op, "value": value, "source": source}


def one_of(key, values, source):
    return {"any": [condition(key, v, source) for v in values]}


def all_of(*rules):
    return {"all": list(rules)}


UK_SCOPE = all_of(one_of("ukLsaReach", ["uk", "waters"], "Regulation 4(1)"),
                  condition("ukLsaExcluded", "no", "Regulation 4(2)–(3)"))
US_SCOPE = all_of(one_of("usPart175Location", ["waters", "highseas"], "33 CFR § 175.1"),
                  condition("usPart175Excluded", "no", "33 CFR § 175.1(a)–(e)"))
US_PFD = all_of(US_SCOPE, condition("usPfdCraft", "yes", "33 CFR §§ 175.3, 175.11"))
NZ_WATERS = condition("nzPart91Waters", "yes", "Maritime rule 91.3")
NZ_REC = condition("nzRecCraft", "yes", "Maritime rule 91.2, recreational craft")
NZ_EARLY = all_of(condition("nzPart91Waters", "yes", "Original Part 91, rule 91.3"),
                  condition("nzOriginalArea", "yes", "Original rule 91.3(2)–(3), including the March 2004 transition"))
HIGH_SPEED = all_of(one_of("ukLsaReach", ["uk", "waters"], "Regulation 4(1)"),
                    condition("ukLsaHighSpeed", "yes", "Regulation 4(2)(i) and S.I. 2022/1219, Schedule paragraph 25"))
UK_NOTE = "General application and exclusions are in regulation 4. Schedule 2 defines the service classes."
US_NOTE = "Read §§ 175.1 and 175.11 for the geographic and vessel limits. State requirements may also apply under §§ 175.5 and 175.25."


def uk_part(number, classes, international, *, new=False):
    cite = "Regulation " + str(number)
    return all_of(UK_SCOPE, one_of("ukLsaClass", classes.split(), cite + " and Schedule 2"),
                  condition("ukLsaInternational", "yes" if international else "no", cite + " and regulation 2"),
                  condition("ukLsaConstruction", "1998-07-01", cite + " and regulation 2", "gte" if new else "lt"))


def section(identifier, number, title, areas, first, last, *, rule=None, level="section", note=""):
    return dict(id=identifier, number=number, title=title, areas=areas, first=first, last=last,
                criteria=rule, screeningLevel=level if rule else "unmapped", caveat=note)


# One-based physical PDF page; top-left-origin coordinates in PDF points. A source
# column, footnote, or continuation has its own rectangle when other text intervenes.
def uk(page, top, bottom):
    return (page, 82, top, 514, bottom)


def nz(page, top, bottom):
    return (page, 66, top, 554, bottom)


def us(page, column, top, bottom):
    left, right = (127, 304) if column == "left" else (307, 482)
    return (page, left, top, right, bottom)


PASSAGES = {
    UK: [
        section("application", "Regulation 4", "General application",
                [uk(4, 584, 764), uk(5, 69, 330), uk(5, 619, 667.9)], "General application", "S.I. 2002/1473).",
                rule=UK_SCOPE, level="instrument", note="Paragraphs (2)–(3) contain exclusions. Paragraph (4) describes when certain people on board are disregarded. The final extract contains the two printed footnotes."),
        section("geographic-reach", "Regulation 4(1)", "United Kingdom ships and United Kingdom waters", [uk(4, 584, 653)],
                "General application", "while they are within United Kingdom waters.",
                note="The introductory phrase requires the exclusions in paragraphs (2) and (3)."),
        section("high-speed-2004", "Regulation 4(2)(i)", "High-speed craft exclusion as made", [uk(5, 143, 170)],
                "(i) high-speed craft", "apply.", rule=HIGH_SPEED, level="context", note="This is an exclusion. The 2004 reference was replaced on 19 December 2022. The original full regulation 4 contains its opening words and footnotes."),
        section("voyage", "Regulation 2(1)", "International voyage", [uk(3, 171, 295)],
                "“international voyage” means", "the Convention;"),
        section("construction", "Regulation 2(1)", "New ship and similar stage of construction", [uk(3, 404, 433), uk(4, 464, 526)],
                "“new ship” means", "whichever is less."),
        section("older-international", "Regulation 9", "Application", [uk(8, 365, 428)],
                "Application", "engaged on international voyages.",
                rule=uk_part(9, "I II VII VII(A) VII(T) VIII VIII(T) IX XI XII", True), note=UK_NOTE + " This is the application clause for Part 2."),
        section("older-domestic", "Regulation 12", "Application", [uk(9, 324, 386)],
                "Application", "not engaged on international voyages.",
                rule=uk_part(12, "II(A) VII(A) VIII(A) VIII(A)(T) IX IX(A) IX(A)(T) XI XII", False), note=UK_NOTE + " This is the application clause for Part 3."),
        section("new-international", "Regulation 14", "Application", [uk(9, 517, 566)],
                "Application", "engaged on international voyages.",
                rule=uk_part(14, "I II VII VII(T) VIII VIII(T) IX XI XII", True, new=True), note=UK_NOTE + " This is the application clause for Part 4. Regulation 2 defines new ship."),
    ],
    UK_AMEND: [
        section("high-speed-reference", "Schedule, paragraph 25", "Substitution in the high-speed craft exclusion", [uk(17, 498, 559)],
                "The Merchant Shipping (Life-Saving Appliances and Arrangements) Regulations 2020", "the Merchant Shipping (High Speed Craft) Regulations 2022”.",
                rule=HIGH_SPEED, level="context", note="The amendment changes the cross-reference in regulation 4(2)(i). Use the full revised regulation 4 to determine the reach of the exclusion."),
    ],
    US: [
        section("application", "§ 175.1", "Applicability", [us(2, "left", 510, 680.8)],
                "§ 175.1 Applicability.", "Seaplanes on the water.", rule=US_SCOPE, level="instrument"),
        section("recreational-vessel", "§ 175.3", "Recreational vessel", [us(2, "right", 554.4, 635.6)],
                "Recreational vessel means", "of this title."),
        section("subpart-scope", "§ 175.11", "Applicability", [us(3, "left", 488, 542)],
                "§ 175.11 Applicability.", "or another vessel.", rule=US_PFD, level="instrument", note=US_NOTE),
        section("devices", "§ 175.15", "Personal flotation devices required", [us(3, "right", 213, 482)],
                "§ 175.15 Personal flotation devices required.", "in an enclosed cabin.", rule=US_PFD, level="instrument",
                note="Paragraphs (a), (b) and (c) have different triggers. The opening words refer to §§ 175.17 and 175.25."),
        section("throwable", "§ 175.15(b)", "Additional throwable personal flotation device",
                [us(3, "right", 234, 253.9), us(3, "right", 354.2, 408.5)],
                "Except as provided in", "paragraph (a) of this section.",
                rule=all_of(US_PFD, condition("usPfdLengthFt", 16, "33 CFR § 175.15(b)", "gte"),
                            condition("usPfdExemption", "no", "33 CFR § 175.17")),
                note="The excerpt includes the section’s opening condition. Paragraph (a) sets the separate wearable-device obligation. Section 175.17 lists exemptions, including a canoe or kayak at least 16 feet in length."),
        section("exemptions", "§ 175.17", "Exemptions", [us(3, "right", 531, 711), us(4, "left", 174, 215)],
                "§ 175.17 Exemptions.", "each foreign competitor onboard.", rule=US_PFD, level="instrument",
                note="Read each separate exception. The canoe and kayak exemption in (a) concerns the additional throwable device."),
        section("stowage", "§ 175.19", "Stowage", [us(4, "left", 232, 311)],
                "§ 175.19 Stowage.", "immediately available.", rule=US_PFD, level="instrument",
                note="This section concerns devices required by § 175.15. The conditions and exemptions in §§ 175.15, 175.17 and 175.25 affect which devices are required."),
    ],
    NZ: [
        section("length", "91.2", "Length and length overall", [nz(6, 452, 604)],
                "length in relation to a vessel, means length overall", "terminal points:"),
        section("recreational-craft", "91.2", "Recreational craft", [nz(8, 254, 324)],
                "recreational craft means", "solely powered by sail:"),
        section("underway", "91.2", "Underway", [nz(9, 550, 620.8)],
                "underway, in relation", "aground:"),
        section("application", "91.3", "Application", [nz(9, 731, 768)],
                "91.3 Application", "in New Zealand waters.", rule=NZ_WATERS, level="instrument"),
        section("lifejackets", "91.4", "Lifejackets", [nz(10, 87, 772), nz(11, 67, 440)],
                "91.4 Lifejackets", "PADDLE CRAFT APPLICATIONS ONLY”.",
                rule=NZ_WATERS, level="instrument", note="Read the subparagraph for the activity being researched. Recreational craft, persons being towed, paddle craft and written event exemptions have separate conditions."),
        section("carriage", "91.4(1)", "Lifejacket carriage on recreational craft", [nz(10, 87, 145)],
                "91.4 Lifejackets", "for each person on board.", rule=all_of(NZ_WATERS, NZ_REC), level="instrument",
                note="The remaining paragraphs prescribe exceptions and additional requirements, including when lifejackets must be worn."),
        section("small-craft", "91.4(1A)–(1B)", "Lifejackets on small recreational craft underway", [nz(10, 145, 237.5)],
                "(1A) A person in charge", "for the purpose of recreational swimming).",
                rule=all_of(NZ_WATERS, NZ_REC, condition("nzLifejacketLengthM", 6, "Maritime rule 91.4(1A)", "lte"),
                            condition("nzUnderway", "yes", "Maritime rules 91.2 and 91.4(1A)"),
                            condition("nzLifejacketException", "no", "Maritime rule 91.4(1B), (2), (4) and (5)")),
                note="The excerpt contains the swimming exception. Read 91.4(2), (4), (5) and (9) for activity exceptions, regional exemptions and paddle-craft buoyancy aids."),
        section("harbour", "91.16", "Duty of master of a vessel under 500 gross tonnage", [nz(15, 452, 562.3), nz(15, 753, 772)],
                "91.16 Duty of master", "50 m in length overall.",
                rule=all_of(NZ_WATERS, condition("grossTonnage", 500, "Maritime rule 91.16(1)", "lt"),
                            condition("nzOtherVesselGt", 500, "Maritime rule 91.16(1)", "gte"),
                            condition("nzHarbour", "yes", "Maritime rule 91.16(1)–(2)")),
                note="The gross tonnage of each vessel matters. The printed footnote about likely vessel length is an observation and supplies no substitute measurement."),
    ],
    NZ_AMEND: [
        section("commencement", "Clause 1", "Entry into force", [nz(4, 71, 114)],
                "1 Entry into Force", "28 June 2007."),
        section("area-amendment", "Clause 3", "Change to rule 91.3(1)", [nz(4, 365, 421)],
                "3 Rule 91.3 Application", "New Zealand waters”.",
                note="Concerns the listed provisions in rule 91.3(1). The geographic conditions in paragraphs (2) and (3) continued separately."),
    ],
}


# The signed 2003 original is image-only. Coordinates and transcription were
# checked against its printed pages 11 and 19–20 (physical pages 13 and 21–22).
ORIGINAL_NZ = [
    ("application", "91.3", "Application under the original regional bylaw provisions", [(13, 108, 148, 557, 352)], NZ_EARLY, "instrument",
     "91.3 Application\n\n(1) Rules 91.4(3), 91.5(4) and 91.21 apply everywhere in New Zealand.\n\n(2) The rest of Part 91 applies to –\n\n(a) areas that are not subject to navigation bylaws; and\n\n(b) regions where navigation bylaws are in force, if the bylaws are inconsistent with Part 91, in which case the bylaws shall be construed subject to Part 91.\n\n(3) Part 91 shall not apply to navigable waters subject to navigation bylaws in the manner specified in rule 91.3(2)(b) until 31 March 2004.",
     "The indexed geographic conditions concern the rest of Part 91 under (2) and (3). Paragraph (1) separately identifies three provisions applying everywhere in New Zealand."),
    ("original-area", "91.3(2)–(3)", "Application where navigation bylaws exist", [(13, 134, 204, 557, 352)], None, "unmapped",
     "(2) The rest of Part 91 applies to –\n\n(a) areas that are not subject to navigation bylaws; and\n\n(b) regions where navigation bylaws are in force, if the bylaws are inconsistent with Part 91, in which case the bylaws shall be construed subject to Part 91.\n\n(3) Part 91 shall not apply to navigable waters subject to navigation bylaws in the manner specified in rule 91.3(2)(b) until 31 March 2004.",
     "Paragraphs (2) and (3) concern the provisions outside the separately enumerated list in paragraph (1). Parliament replaced rule 91.3 in 2013."),
    ("carriage", "91.4(1)", "Personal flotation devices on recreational craft", [(13, 106, 433, 557, 514)], all_of(NZ_EARLY, NZ_REC), "instrument",
     "91.4 Personal flotation devices\n\n(1) No person in charge of a recreational craft may use it unless there are on board at the time of use, and in a readily accessible location, sufficient personal flotation devices of an appropriate size for each person on board.",
     "Read the original rule's exceptions in the following paragraphs, including sporting events, support vessels and written regional exemptions. The indexed rule screens the basic geographic and craft conditions."),
    ("harbour", "91.16", "Duty of master of a vessel under 500 gross tonnage", [(21, 106, 556, 556, 637), (22, 88, 90, 515, 160), (21, 106, 716, 420, 735)],
     all_of(NZ_EARLY, condition("grossTonnage", 500, "Maritime rule 91.16(1)", "lt"),
            condition("nzOtherVesselGt", 500, "Maritime rule 91.16(1)", "gte"), condition("nzHarbour", "yes", "Maritime rule 91.16(1)–(2)")), "section",
     "91.16 Duty of master of a vessel under 500 gross tonnage\n\n(1) The master of a vessel under 500 gross tonnage must not allow the vessel to impede the navigation of any vessel of 500 gross tonnage³ or more if the vessels are in a harbour area.\n\n(2) For the purposes of this rule a harbour area is an area defined as such in bylaws. If a regional council defines a harbour area in bylaws, the council must inform Land Information New Zealand of the defined area so that it may be marked on any applicable nautical chart.\n\n³ A vessel over 500 gross tonnage is likely to be over 50 m in length overall.",
     "The harbour definition and vessel tonnages are separate conditions. The final strip contains the printed footnote. The regional application and transition in the original rule 91.3 also matter."),
]
PASSAGES[NZ_ORIGINAL] = [dict(id=identifier, number=number, title=title, areas=areas, criteria=rule, screeningLevel=level,
                              transcript=transcript, caveat=note) for identifier, number, title, areas, rule, level, transcript, note in ORIGINAL_NZ]


def remote_bytes(address, accept):
    request = Request(address, headers={"User-Agent": "Maritime regulation index/1.0", "Accept": accept, "Accept-Encoding": "gzip"})
    with urlopen(request, timeout=60) as response:
        data = response.read(16_000_001)
        if response.status != 200 or len(data) > 16_000_000:
            raise ValueError(f"Unexpected source response: {response.status}, {len(data)} bytes from {address}")
        return gzip.decompress(data) if response.headers.get("Content-Encoding", "").lower() == "gzip" else data


def source_pdf(source_id, refresh):
    entry = SOURCES[source_id]
    path = SITE / "pdf" / "flags" / (source_id + ".pdf")
    if path.is_file() and not refresh:
        data = path.read_bytes()
    else:
        data = remote_bytes(entry["sourceUrl"], "application/pdf")
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError(f"{source_id}: received different publisher bytes; review page coordinates before updating this edition")
    write_bytes(path, data)
    return data


def anchor_key(text):
    return "".join(c for c in text.casefold() if c.isalnum())


def words(text):
    return " ".join(text.split())


def reading_text(raw, source_id):
    """Restore reading order and paragraph spacing while retaining the printed words."""
    paragraphs = []
    for region in raw:
        parts = []
        for physical_line in region.splitlines():
            line = words(physical_line)
            if not line:
                continue
            if not parts or re.match(r"^(?:\(\w{1,3}\)|\d+[.]\s|§\s?\d+\.\d+\s+[A-Z])", line) or parts[-1] in {"Application", "General application"}:
                parts.append(line)
            elif parts[-1].endswith("-") and source_id == US:
                # The selected GPO columns use line-end hyphenation. Keep printed
                # compound-word hyphens where the complete compound requires it.
                keep = parts[-1].endswith(("passengers-", "non-commercial-", "for-")) and line.startswith("hire")
                parts[-1] = parts[-1][:-1] + ("-" if keep else "") + line
            else:
                parts[-1] += " " + line
        paragraphs.extend(parts)
    text = "\n\n".join(paragraphs)
    if source_id == NZ:
        text = text.replace("gross tonnage3", "gross tonnage³").replace("\n\n3 A vessel over 500", "\n\n³ A vessel over 500")
    return text


def scanned_excerpt(document, item):
    """Retain only the reviewed signed-page pixels. No adjacent image or OCR text is embedded."""
    zoom = pymupdf.Matrix(3, 3)
    title = item["number"] + " · " + item["title"]
    with pymupdf.open() as output:
        for page_no, x0, y0, x1, y1 in item["areas"]:
            page = document[page_no - 1]
            box = pymupdf.Rect(x0, y0, x1, y1)
            if page.get_text().strip() or not page.rect.contains(box):
                raise ValueError(f"{title}: changed scan layout")
            pix = page.get_pixmap(matrix=zoom, clip=box, colorspace=pymupdf.csGRAY, alpha=False)
            target = output.new_page(width=box.width, height=box.height)
            target.insert_image(target.rect, stream=pix.tobytes("png"))
            rebuilt = target.get_pixmap(matrix=zoom, colorspace=pymupdf.csGRAY, alpha=False)
            if rebuilt.samples != pix.samples or min(pix.samples) >= 100:
                raise ValueError(f"{title}: the excerpt does not reproduce the selected source pixels")
        output.set_metadata({"title": title})
        return output.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1), item["transcript"]


def checked_excerpt(document, section_data, source_id):
    raw = []
    title = section_data["number"] + " · " + section_data["title"]
    with pymupdf.open() as excerpt:
        for page_number, x0, y0, x1, y1 in section_data["areas"]:
            index = page_number - 1
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page = document[index]
            if not page.rect.contains(rect) or rect.is_empty or page.rotation:
                raise ValueError(f"{title}: unsupported page geometry")
            raw.append(page.get_text("text", clip=rect, sort=True).strip())
            excerpt.insert_pdf(document, from_page=index, to_page=index, links=False, annots=False, widgets=False)
            copied = excerpt[-1]
            w, h = copied.rect.width, copied.rect.height
            for outside in [(0, 0, w, y0), (0, y1, w, h), (0, y0, x0, y1), (x1, y0, w, y1)]:
                if not pymupdf.Rect(outside).is_empty:
                    copied.add_redact_annot(outside, fill=None, cross_out=False)
            copied.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
            copied.set_cropbox(rect)
        excerpt.set_metadata({"title": title})
        data = excerpt.tobytes(garbage=4, deflate=True, no_new_id=True, use_objstms=1)
    if not anchor_key(raw[0]).startswith(anchor_key(section_data["first"])) or not anchor_key(raw[-1]).endswith(anchor_key(section_data["last"])):
        raise ValueError(f"{title}: wrong printed boundaries: {ascii(raw[0][:105])} ... {ascii(raw[-1][-105:])}")
    with pymupdf.open(stream=data, filetype="pdf") as checked:
        for page, original in zip(checked, raw, strict=True):
            for visible in (True, False):
                if not visible:
                    page.set_cropbox(page.mediabox)
                if words(page.get_text("text", sort=True)) != words(original):
                    raise ValueError(f"{title}: excerpt retains or loses adjacent text")
    return data, reading_text(raw, source_id)


def uk_provisions(data):
    root = ET.fromstring(data)
    result = {}
    for number in (4, 9, 12, 14):
        regulation = root.find(f".//*[@id='regulation-{number}']")
        if regulation is None:
            raise ValueError(f"Missing UK regulation {number}")
        result[str(number)] = anchor_key(" ".join(regulation.itertext()))
    regulation = root.find(".//*[@id='regulation-2']")
    for term in ("international voyage", "new ship", "similar stage of construction"):
        definitions = [anchor_key(" ".join(n.itertext())) for n in regulation.findall(".//{*}ListItem")]
        selected = [s for s in definitions if s.startswith(anchor_key(term + " means"))]
        if len(selected) != 1:
            raise ValueError(f"Cannot locate the UK statutory definition of {term}")
        result[term] = selected[0]
    return result


def verify_uk_history():
    index = ET.fromstring(remote_bytes(UK_LAW + "/contents/data.xml", "application/xml"))
    dated = [n.get("title") for n in index.iter() if n.get("rel") == "http://purl.org/dc/terms/hasVersion"]
    if dated != UK_DATES:
        raise ValueError(f"Review changed UK legislation timeline: {dated}")
    original = uk_provisions(remote_bytes(UK_LAW + "/made/data.xml", "application/xml"))
    changed = "themerchantshippinghighspeedcraftregulations2004"
    if original['4'].count(changed) != 1:
        raise ValueError("UK original regulation 4 has an unexpected high-speed reference")
    amended = {**original, "4": original["4"].replace(changed, changed[:-4] + "2022")}
    for edition in [*dated[1:], None]:
        address = UK_LAW + ("/" + edition if edition else "") + "/data.xml"
        found = uk_provisions(remote_bytes(address, "application/xml"))
        expected = original if edition and edition < "2022-12-19" else amended
        if found != expected:
            raise ValueError(f"UK selected provisions differ at {edition or 'latest'}: {[key for key in expected if found.get(key) != expected[key]]}")


def verify_us_history(sections):
    def json_source(address):
        return json.loads(remote_bytes(address, "application/json"))

    title = next(row for row in json_source(US_API + "/titles.json")["titles"] if row["number"] == 33)
    if title["up_to_date_as_of"] < US_THROUGH:
        raise ValueError("The eCFR no longer supplies the checked Title 33 edition")
    numbers = {s["id"]: re.search(r"175\.\d+", s["number"]).group() for s in sections}
    history = json_source(US_HISTORY)["content_versions"]
    dates = {row["date"] for row in history if row["identifier"] in numbers.values() and row["date"] <= US_THROUGH}
    if dates != {"2016-12-31", "2021-10-22", "2022-04-20"}:
        raise ValueError(f"Review revised eCFR section history: {sorted(dates)}")
    for day in sorted(dates | {"2025-07-01", US_THROUGH}):
        root = ET.fromstring(remote_bytes(US_API + f"/full/{day}/title-33.xml?part=175", "application/xml"))
        for section in sections:
            node = root.find(f".//*[@N='{numbers[section['id']]}']")
            if node is None:
                raise ValueError(f"{day}: {section['number']} missing in eCFR")
            body = anchor_key(" ".join(node.itertext()))
            fragments = [section["text"]]
            if section["id"] == "throwable":
                preamble, paragraph = section["text"].split("(b)", 1)
                fragments = [preamble, "(b)" + paragraph]
            for fragment in fragments:
                needle = anchor_key(fragment)
                position = body.find(needle)
                if not needle or position < 0:
                    raise ValueError(f"{day}: printed {section['number']} differs from its eCFR wording")
                body = body[position + len(needle):]
    for kind in ("publication_date", "effective_date"):
        result = json_source(register_query(kind))
        if result.get("count") != 0:
            raise ValueError(f"Check {kind} Federal Register entries between the eCFR cut-off and {CHECKED}")


def add_dated_selections(instruments):
    uk = instruments[SOURCES[UK]["id"]]["versions"]
    first = next(v for v in uk if v["id"] == UK)
    keep = {"geographic-reach", "voyage", "construction", "older-international", "older-domestic", "new-international"}
    continued = [dict(s) for s in first["sections"] if s["id"] in keep]
    geographic = next(s for s in continued if s["id"] == "geographic-reach")
    geographic.update(criteria=UK_SCOPE, screeningLevel="instrument", caveat="This excerpt reproduces the geographic provision. Check the complete revised regulation 4 for exceptions, including the amended high-speed craft reference.")
    uk.append({**first, "id": "gb-lsa-continued-2022", "label": "Selected continuing provisions · regulations 2, 4(1), 9, 12 and 14",
               "kind": "Original printed passages checked against the revised legislation register", "effectiveFrom": "2022-12-19",
               "effectiveTo": None, "verifiedThrough": CHECKED, "sections": continued, "sourcePage": UK_LAW + "/2026-01-05",
               "sourceLinks": [UK_LAW + "/regulation/4", UK_CHANGE, UK_LAW + "/contents/data.xml"] + [UK_LAW + "/" + d for d in UK_DATES[1:]],
               "notes": "These specific words from the 2020 original agree with each version listed by legislation.gov.uk, including the 2022, 2023, 2025 and 2026 revisions. The selected original PDF excerpts retain their original page layout. Regulation 4(2)(i) changed in 2022: see the separate amending document and the full revised regulation 4. Incorporated Merchant Shipping Notices have their own histories."})

    nz = instruments[SOURCES[NZ]["id"]]["versions"]
    current = next(v for v in nz if v["id"] == NZ)
    original = next(v for v in nz if v["id"] == NZ_ORIGINAL)
    earlier = [dict(s) for s in original["sections"] if s["id"] in ("original-area", "harbour")]
    next(s for s in earlier if s["id"] == "original-area").update(criteria=NZ_EARLY, screeningLevel="instrument")
    nz.append({**original, "id": "nz-rule91-2007", "label": "Regional scope and harbour duty · 28 June 2007 to 22 October 2013",
               "kind": "Original printed passages with reviewed amendment history", "effectiveFrom": "2007-06-28",
               "effectiveTo": "2013-10-23", "verifiedThrough": "2013-10-22", "sections": earlier,
               "sourceLinks": [SOURCES[NZ_AMEND]["sourceUrl"], NZ_2007_GAZETTE, SOURCES[NZ]["sourceUrl"], NZ_2013, NZ_2013_ACT], "notes": "The signed June 2007 amendment changed only paragraph (1) of rule 91.3. No subsequent amendment before October 2013 lists 91.3(2)–(3) or 91.16. The dated excerpts reproduce those continuing provisions from the original signed scan."})
    nz.append({**current, "id": "nz-rule91-2013", "label": "Nationwide scope and harbour duty · 23 October 2013 to 8 October 2026",
               "kind": "Government consolidation checked against the original and the 2013 amending Act", "effectiveFrom": "2013-10-23",
               "effectiveTo": "2026-10-09", "verifiedThrough": "2026-10-08", "sections": [s for s in current["sections"] if s["id"] in ("application", "harbour")],
               "sourceLinks": [NZ_2013, NZ_2013_ACT, SOURCES[NZ_ORIGINAL]["sourceUrl"]],
               "notes": "Section 90 and Schedule 2 of the Maritime Transport Amendment Act 2013 inserted the quoted nationwide scope. Section 2(2) commences this part of the Act the day after Royal assent on 22 October 2013. The Part 91 ledger lists later amendments, none of which changes 91.3 or 91.16. The harbour duty also agrees with the signed 2003 rule, printed pages 19–20. These excerpts are from the 2026 consolidation."})
    for instrument in instruments.values():
        instrument["versions"].sort(key=lambda version: (version["effectiveFrom"], version["id"]))


def comparison(identifier, title, before, after, note):
    return {"id": identifier, "title": title, "kind": "Amendment", "notes": note,
            "before": {"versionId": before[0], "sectionId": before[1]}, "after": {"versionId": after[0], "sectionId": after[1]}}


def build(refresh=False):
    instruments = {}
    for source_id, entry in SOURCES.items():
        sections = []
        with pymupdf.open(stream=source_pdf(source_id, refresh), filetype="pdf") as original:
            for item in PASSAGES[source_id]:
                pdf, text = scanned_excerpt(original, item) if "transcript" in item else checked_excerpt(original, item, source_id)
                path = Path("pdf", "sections", source_id, item["id"] + ".pdf")
                write_bytes(SITE / path, pdf)
                row = {key: value for key, value in item.items() if key not in ("areas", "first", "last", "transcript")}
                row.update(text=text, pages=list(dict.fromkeys(x[0] for x in item["areas"])), clip=path.as_posix())
                sections.append(row)
        version = {k: entry[k] for k in ("label", "kind", "publishedOn", "effectiveFrom", "verifiedThrough", "notes", "sourceUrl", "sourcePage")}
        version.update({key: entry[key] for key in ("editionDate", "sourceLinks") if key in entry})
        version.update(id=source_id, language="en", effectiveTo=entry.get("effectiveTo"), sections=sections,
                       pdf="pdf/flags/" + source_id + ".pdf", pdfSha256=entry["sha256"])
        instrument = {k: entry[k] for k in ("title", "shortTitle", "id", "authority")}
        book = instruments.setdefault(entry["id"], {**instrument, "jurisdiction": entry["code"], "language": "en", "versions": []})
        book["versions"].append(version)
        if refresh and source_id == US:
            verify_us_history(sections)
    if refresh:
        verify_uk_history()
    add_dated_selections(instruments)
    pairs = [comparison("uk-high-speed-reference", "UK · high-speed craft exclusion in regulation 4(2)(i)", (UK, "high-speed-2004"), (UK_AMEND, "high-speed-reference"),
                        "The left side is the original subparagraph. The right side is the signed amending provision directing the substitution on 19 December 2022. The complete revised text is linked from that edition."),
             comparison("nz-application", "New Zealand · navigation bylaws and nationwide scope", (NZ_ORIGINAL, "application"), ("nz-rule91-2013", "application"),
                        "The 2003 signed application rule includes regional conditions and a transition. The 2013 Act substituted the nationwide text. A 2007 amendment affected original paragraph (1) in the intervening period."),
             comparison("nz-application-2007", "New Zealand · 2007 change to navigation rule 91.3(1)", (NZ_ORIGINAL, "application"), (NZ_AMEND, "area-amendment"),
                        "Compare the original geographic clause with the signed 2007 instruction replacing ‘New Zealand’ with ‘New Zealand waters’ in its first paragraph."),
             comparison("nz-carriage", "New Zealand · recreational craft flotation-device carriage", (NZ_ORIGINAL, "carriage"), (NZ, "carriage"),
                        "Compare the carriage sentence in the 2003 signed rule with the October 2026 consolidation. Additional wearing requirements and exceptions appear in the surrounding paragraphs. The comparison displays these two dated sources.")]
    return {"version": 1, "checkedAt": CHECKED, "fields": FIELDS, "instruments": list(instruments.values()), "comparisons": pairs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Re-fetch pinned publisher PDFs, UK legislative versions, eCFR snapshots and Federal Register queries")
    args = parser.parse_args()
    output = build(args.refresh)
    data = (json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    write_bytes(SITE / "data" / "flag-folios.json", data)
    print(f"{len(SOURCES)} government PDFs, {sum(len(i['versions']) for i in output['instruments'])} dated selections, {sum(map(len, PASSAGES.values()))} distinct PDF excerpts, {len(output['comparisons'])} comparisons, {len(FIELDS)} additional profile fields.")


if __name__ == "__main__":
    main()


