"""Build links to reviewed provisions in five flag administrations' circulars."""

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import ssl
import subprocess
import unicodedata
from urllib.error import URLError
from urllib.request import Request, urlopen

import pymupdf

from folios import write_bytes


CHECKED = "2026-11-23"
TARGET = Path(__file__).resolve().parents[1] / "site" / "data" / "registry-guides.json"
LIBERIA = "https://www.liscr.com/onlinelibrary/"
LIB_PDF = "https://www.liscr.com/marketing/liscr/media/liscr/online%20library/maritime/"
PANAMA = "https://www.panamashipregistry.com/wp-content/uploads/2026/11/E-BOOK-OCTOBER-2026.pdf"
PA_PDF = "https://www.panamashipregistry.com/wp-content/uploads/"
MH = "https://www.register-iri.com/library/?fwp_maritime_facet=marine-notices&fwp_new_primary_filter=maritime&fwp_per_page=100&fwp_sort=control_number_asc"
MH_YACHT = "https://www.register-iri.com/library/?fwp_new_primary_filter=yacht&fwp_yacht_facet=private-yachts-yacht"
MH_PDF = "https://www.register-iri.com/wp-content/uploads/"
SG = "https://www.mpa.gov.sg/media-centre/details/"
SG_PDF = "https://www.mpa.gov.sg/api/media/"
SG_ACTIVE = SG_PDF + "04abe1ae-11d6-4f78-99c6-2700ded6d09f/sc_no_2_of_2023_rev1.pdf"
BS = "https://www.bahamasmaritime.com/notices/marine-notices/"
BS_PDF = "https://www.bahamasmaritime.com/wp-content/uploads/"
AUTHORITIES = {"LR": "Liberia Maritime Authority", "PA": "Panama Maritime Authority, General Directorate of Merchant Marine",
               "MH": "Republic of the Marshall Islands Maritime Administrator", "SG": "Maritime and Port Authority of Singapore",
               "BS": "The Bahamas Maritime Authority"}


def source(flag, reference, source_page, pdf, digest, date_label, *, issued=None, month=None, effective=None,
           checked_through=None, date_source=None, published=None):
    return {"flag": flag, "authority": AUTHORITIES[flag], "reference": reference, "sourcePage": source_page,
            "documentUrl": pdf, "documentSha256": digest, "dateLabel": date_label, "dateSource": date_source or pdf,
            "issuedOn": issued, "issuedMonth": month or issued[:7], "publishedOn": published, "effectiveFrom": effective,
            "verifiedThrough": checked_through, "sourceLanguage": "en"}


SOURCES = {
    "lr6": source("LR", "Marine Notice SAF-006", LIBERIA, LIB_PDF + "saf-006.pdf",
                  "b650e318ff3feadb7ba71f613ecc7eb12aee3dd38e981d3da7e17f3172d7e0b5",
                  "Revision July 2020. Registry listing dated 22 August 2020.", month="2020-07", published="2020-08-22"),
    "lr7": source("LR", "Marine Notice SAF-007", LIBERIA, LIB_PDF + "saf-007.pdf",
                  "d17025a28b18751e8d7e33061d38790b932b060a1399ed350bdd42481fa0bcf5",
                  "Revision July 2020. Registry listing dated 22 August 2020.", month="2020-07", published="2020-08-22"),
    "pa299": source("PA", "Merchant Marine Circular MMC-299", PANAMA, PA_PDF + "2024/02/MMC-299-Sept-2023-Rv-MR.pdf",
                    "129eaeaf7d1f6ba5608ef345bebfd3d9d48bd5a3f38a18dd37ed816573049642",
                    "Revised September 2023. Listed in the authority's valid circulars as of 31 October 2026.", month="2023-09", checked_through="2026-10-31"),
    "pa394": source("PA", "Merchant Marine Circular MMC-394", PANAMA, PA_PDF + "2021/06/MMC-394-Marine-Evacuation-System-MES-June-2021-Rev-Mr.pdf",
                    "4e68835cf150b7b432b4bfa7d891cd6c468feddd3d52619685eab67c595dad7b",
                    "Issued June 2021. Listed in the authority's valid circulars as of 31 October 2026.", month="2021-06", checked_through="2026-10-31"),
    "mh37": source("MH", "Marine Notice 2-011-37", MH, MH_PDF + "MN-2-011-37.pdf",
                   "3291fdbdd2ac75ca188766b71f9ea4d8db14f616364664bd0720148069a0b5e6",
                   "November 2026 revision, retrieved on 23 November. It supersedes the December 2025 revision.", month="2026-11"),
    "mh58": source("MH", "Marine Notice 2-011-58", MH_YACHT, MH_PDF + "MN-2-011-58.pdf",
                   "1795897c9c3985f598f54be77baa34d2b8c5ef2ce1938e0152197ba4cadd1c58",
                   "September 2026 revision. It changes the lifebuoy table from the May 2022 edition.", month="2026-09"),
    "sg11": source("SG", "Shipping Circular No. 11 of 2019", SG + "no-11-of-2019---implementation-of-requirements-for-maintenance-thorough-examination-operational-testing-overhaul-and-repair-of-lifeboats-and-rescue-boats-launching-appliances-and-release-gear",
                   SG_PDF + "f26277ea-0cf1-4d2c-a55d-a2f078ed4465/-sc_no_11_of_2019.pdf",
                   "4c947d5470248ec89b57a0fe905a12633a0287a490398177313ae34e5f8a701c",
                   "Issued 20 November 2019. Paragraphs 1 and 6 apply the servicing standards from 1 January 2020. MPA Circular 2/2023 paragraph 4 defines active website circulars.",
                   issued="2019-11-20", effective="2020-01-01", checked_through=CHECKED, date_source=SG_ACTIVE),
    "sg5": source("SG", "Shipping Circular No. 5 of 2026", SG + "no.-5-of-2026---requirements-for-singapore-registered-pleasure-craft",
                  SG_PDF + "6740764b-7723-432b-86f2-da849d5b2592/sc_no_5_of_2026.pdf",
                  "7976a14bfb0791416b8d348eac69cdd0bddb69bd9fd93f4aab2ac05bfbb8a2a8",
                  "Issued 30 April 2026. Paragraph 8 changes eligibility of survey reports on 1 October 2026.", issued="2026-04-30", checked_through=CHECKED),
    "bs85": source("BS", "Marine Notice 85, version 1.1", BS + "mn085-carriage-of-immersion-suits/", BS_PDF + "2025/11/MN085-Carriage-of-Immersion-Suits.pdf",
                   "8c68a6a559e04f1cf39a5248794b1aae2df27b3b6b40667fbfef5fc8908d791a",
                   "Issued and effective 20 November 2025. The authority posted the notice the next day.", issued="2025-11-20", published="2025-11-21", effective="2025-11-20"),
    "bs82": source("BS", "Marine Notice 82, version 1.1", BS + "mn082-lifeboat-safety/", BS_PDF + "2023/10/MN082-Lifeboat-Safety.pdf",
                   "0f8d2529080e70500f2485d2e906d5802c94efc2a44805fb4fdba9ed77d7c745",
                   "Issued 30 October 2023. The notice gives 1 November 2023 as its effective date.", issued="2023-10-30", effective="2023-11-01"),
}


def passage(source_id, identifier, title, provision, topic, scope, summary, anchors, *, vessel=None, effective=None):
    record = dict(SOURCES[source_id])
    flag = record["flag"]
    selector = {"field": "flag", "op": "eq", "value": flag, "source": record["reference"]}
    if vessel:
        selector = {"all": [selector, {"field": "shipType", "op": "eq", "value": vessel, "source": provision}]}
    if effective:
        record["effectiveFrom"] = effective
    return {**record, "id": identifier, "title": title, "topic": topic, "provision": provision, "scope": scope,
            "summary": summary, "pages": sorted(anchors), "conditions": selector}, anchors


PASSAGES = [
    passage("lr6", "lr-infant-lifejackets", "Infant lifejackets on passenger voyages", "§ 1.1.1–1.1.3, page 1", "Life-saving appliances",
            "Liberian passenger ships within the notice's SOLAS application. Voyage duration and the complement of children and infants matter.",
            "Below 24 hours the infant-lifejacket allowance uses 2.5% of passengers. From 24 hours the notice specifies one per infant. It gives a separate minimum for children.",
            {1: ["voyages less than 24 h", "at least 2.5%", "each infant on board", "at least 10%"]}, vessel="passenger"),
    passage("lr7", "lr-cargo-immersion", "Cargo-ship immersion suits and safety-equipment surveys", "§§ 1.2–1.4, pages 2–3", "Safety equipment surveys",
            "Liberian cargo ships covered by the cited SOLAS provisions. Establish construction date, trade, ship type, survey date and remote watch stations.",
            "Section 1.3 links carriage to the first safety-equipment survey on or after 1 July 2006. Section 1.2 addresses non-bulk ships trading exclusively within 32°N–32°S and retains specified survival-craft equipment.",
            {2: ["vessels, other than bulk carriers"], 3: ["first safety equipment survey", "remotely located survival craft stations"]}, vessel="cargo"),
    passage("pa299", "pa-small-cargo-safety", "Small cargo ships on the international register", "§§ 1.2, 3.1–3.2 and 4.1–4.2, pages 1–2", "Cargo-ship certification",
            "Panamanian cargo vessels with an international Registry Certificate. The notice uses gross register tonnage (GRT). Crew boats have a separate equivalency route.",
            "The cited resolution covers cargo ships below 500 GRT. The exclusions include below 100 GRT, length under 24 metres, unpropelled vessels, non-trading pleasure yachts and fishing vessels. Section 4 addresses distance from shore and an exemption certificate when specified survival craft are absent.",
            {1: ["under 500 GRT holding an international Registry Certificate"], 2: ["less than 100 GRT or less than 24 m", "20 nautical miles"]}, vessel="cargo"),
    passage("pa394", "pa-mes-survey", "Marine evacuation system servicing and deployments", "§§ 1.1, 5.1–5.2 and 10.1, pages 1, 3 and 7", "Safety equipment surveys",
            "Panamanian vessels fitted with a marine evacuation system. Verify the installation and any extension issued by the authority.",
            "The notice gives a 12-month servicing interval, a possible authority extension to 17 months and a six-year maximum between rotational deployments. Keep the service and deployment history aboard.",
            {1: ["vessels that are fitted with MES"], 3: ["extend this period to 17 months", "at least once every six"], 7: ["full-service history"]}),
    passage("mh37", "mh-launching-falls", "Inspection and renewal of survival-craft launching falls", "Applicability A–B and §§ 1.0–2.1, pages 2–3", "Safety equipment surveys",
            "Marshall Islands SOLAS ships and mobile offshore units. The applicability clause also names commercial yachts and yachts engaged in trade at 500 GT or more, passenger yachts and private yachts limited charter under the Yacht Code.",
            "The equipment section requires periodic inspection, particularly at sheaves. Deteriorating falls must be replaced when needed and the maximum renewal interval is five years.",
            {2: ["subject to SOLAS", "500 gross tons"], 3: ["areas passing through sheaves", "not more than five years"]}),
    passage("mh58", "mh-private-yacht-lifebuoys", "Lifebuoys on private yachts", "Applicability A–D and § 1.5.1–1.5.3, pages 2 and 4", "Life-saving appliances",
            "Marshall Islands private yachts. Exclusions cover limited charter, yachts engaged in trade, and yachts holding the stated SOLAS or Yacht Code voluntary compliance statements.",
            "The revised table specifies two lifebuoys below 24 m, four for yachts at least 24 m and below 500 GT, and eight in the 500 GT and above row. Use the table for position, lights, smoke signals and lines.",
            {2: ["Private Yachts Limited Charter", "Statement of Voluntary Compliance"], 4: ["minimum number of life buoys", "Eight life buoys"]}, vessel="recreational"),
    passage("sg11", "sg-lifeboat-servicing", "Approval of lifeboat and rescue-boat servicing providers", "Paragraphs 1–3 and 5–6, Annex question 7, pages 1–2 and 4", "Approved servicing providers",
            "Singapore-registered ships with the lifeboats, rescue boats, launching appliances or release gear listed in paragraph 3.",
            "MPA authorises its recognised organisations to approve providers. Annex question 7 explains the documented assessment and attending-surveyor arrangement when urgent work is needed and no approved provider is available in port.",
            {1: ["1 January 2020", "free-fall lifeboats"], 2: ["approve the service providers"], 4: ["urgent need", "attending surveyor"]}),
    passage("sg5", "sg-pleasure-surveys", "Three-year pleasure-craft surveys and eligible surveyors", "Paragraphs 2–5 and 8(a)–(b), pages 1–3", "Pleasure-craft surveys",
            "Singapore-registered pleasure craft intended for international voyages. Craft operating solely in the Port of Singapore follow the separate licensing regime described in paragraphs 3 and 5.",
            "Surveys recur every three years. From 1 October 2026 MPA Port Inspector reports are no longer accepted. The circular specifies accredited surveyors and when a report must be submitted.",
            {1: ["operating solely within the Port of Singapore"], 2: ["every 3 years", "1 October", "Port Inspector"], 3: ["international voyages must meet survey"]}, vessel="recreational", effective="2026-10-01"),
    passage("sg5", "sg-pleasure-registration", "Construction, length and passenger limits for pleasure-craft registration", "Paragraphs 4 and 6–7, pages 1–2", "Registration eligibility",
            "Applicants to the Singapore register for privately used pleasure craft going abroad. Check the owner and craft conditions and the application date.",
            "Paragraph 6 specifies an enclosed deck, a minimum load-line length of seven metres, an age limit of 17 years at registration, hull restrictions and a maximum of 12 passengers. Paragraph 7(h) dates the survey report against the application.",
            {1: ["pleasure purposes only"], 2: ["minimum load line length", "17 years old", "12 passengers", "within 3 months"]}, vessel="recreational"),
    passage("bs85", "bs-cargo-immersion", "Immersion suits at remote cargo-ship watch stations", "§§ 2.1, 4.1–4.6 and 6.1–6.4, pages 1–3", "Life-saving appliances",
            "Bahamian cargo ships and mobile offshore units under paragraph 4. Check watch arrangements, bulk-carrier status, operating area and any exemption.",
            "The notice gives minimum additional suits for bridge and machinery watches, including a smaller-ship exception for a sole engine-room watchkeeper. Section 6 gives the warm-climate limits and excludes bulk carriers from that exemption.",
            {1: ["cargo ships only"], 2: ["one engine room watch-keeper"], 3: ["Bulk carriers", "cannot be exempted"]}, vessel="cargo"),
    passage("bs85", "bs-passenger-immersion", "Immersion suits and thermal protective aids on passenger ships", "§§ 2.1(ii), 5.1–5.3 and 6.1–6.3, pages 1 and 3", "Life-saving appliances",
            "Bahamian passenger ships. Check lifeboat design, the rescue-boat or evacuation-system duties of the crew and any warm-climate determination.",
            "Paragraph 5.2 specifies suits per lifeboat and thermal protection for other occupants. Paragraph 5.3 sets out the enclosed-lifeboat and warm-climate cases.",
            {1: ["passenger ships only"], 3: ["at least three immersion suits", "partially enclosed lifeboats"]}, vessel="passenger"),
    passage("bs82", "bs-lifeboat-service", "Five-year lifeboat testing and authorised servicing", "§§ 2.1 and 5.1–5.7, pages 1 and 3–4", "Approved servicing providers",
            "Bahamian ships fitted with the survival-craft launching appliances, on-load release gear or automatic release hooks named in section 2.",
            "The notice separates routine inspections from servicing by authorised providers. It addresses dynamic load testing and the evidence for an exceptional short postponement requested through the recognised organisation.",
            {1: ["ships fitted with survival craft launching appliances"], 3: ["5-yearly service", "short postponements of up to 3 months"], 4: ["Recognised Organisation"]}),
]


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKC", value).casefold() if c.isalnum())


def fetch(url):
    request = Request(url, headers={"User-Agent": "Maritime regulation source index/1.0", "Accept": "application/pdf"})
    try:
        with urlopen(request, timeout=30) as response:
            return response.read(8_000_001)
    except URLError as error:
        if not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise
        # Use the system's verified TLS store when the interpreter lacks an issuer.
        return subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--max-time", "30", url])


def validate_sources():
    pages = {}
    for document in SOURCES.values():
        address = document["documentUrl"]
        data = fetch(address)
        if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != document["documentSha256"]:
            raise ValueError(f"Review the changed publisher edition: {document['reference']}")
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            pages[address] = [normalize(p.get_text("text", sort=True)) for p in pdf]
    for row, anchors in PASSAGES:
        for page, phrases in anchors.items():
            text = pages[row["documentUrl"]][page - 1]
            if any(normalize(phrase) not in text for phrase in phrases):
                raise ValueError(f"Review cited passage on page {page}: {row['id']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Recheck publisher PDF fingerprints and the text of each cited physical page")
    args = parser.parse_args()
    if args.refresh:
        validate_sources()
    rows = [row for row, _ in PASSAGES]
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError("Duplicate registry passage ID")
    for row in rows:
        for field in ("issuedOn", "effectiveFrom", "publishedOn", "verifiedThrough"):
            if row[field]:
                date.fromisoformat(row[field])
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", row["issuedMonth"]):
            raise ValueError(f"Invalid printed revision month on {row['id']}")
    index = {"version": 1, "checkedAt": CHECKED, "entries": rows,
             "coverage": "Selected national notices from five flag administrations. Each reference identifies the exact passage in the publisher’s PDF. The profile conditions select research leads. Vessel classification, equipment, exceptions and later amendments require reading the cited source. Revision months are retained at their printed precision."}
    write_bytes(TARGET, (json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    print(f"{len(rows)} targeted references, {len(SOURCES)} official PDFs and {len(AUTHORITIES)} flag administrations.")


if __name__ == "__main__":
    main()
