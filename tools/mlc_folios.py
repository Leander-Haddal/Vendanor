"""Build dated Maritime Labour Convention excerpts for individually evidenced flag states."""

import argparse
from datetime import datetime
import hashlib
import html
import json
from pathlib import Path
import re
import ssl
import subprocess
import unicodedata
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import pymupdf

from folios import SITE, clip_source, write_bytes


CHECKED = "2026-11-23"
PUBLISHER = "International Labour Organization"
DOCUMENT = "https://www.ilo.org/sites/default/files/2024-10/NORMES_MLC%20Amendments-EN_2022_Web_1.pdf"
PAGE = "https://www.ilo.org/resource/other/maritime-labour-convention-2006-amended-including-2022-amendments"
ORIGINAL = "https://www.ilo.org/sites/default/files/wcmsp5/groups/public/@ed_norm/@normes/documents/normativeinstrument/wcms_090250.pdf"
REGISTER = "https://treaties.un.org/Pages/showDetails.aspx?clang=_en&objid=080000028006822e"
NORMLEX = "https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:11300:0::NO::P11300_INSTRUMENT_ID:312331"
DUTCH_REGISTER = "https://verdragenbank.overheid.nl/en/Treaty/Details/010842_p.html"
SHA256 = "bc444a84c177558dfc043b027b47681f06d7155f793819e755984f1b785f7e43"
ORIGINAL_SHA256 = "74f3f95ceda4d787027629ee6f2848cd9fda3695c6cd37ca57c894d0dffed422"
PDF = "pdf/mlc-2022-consolidated.pdf"
LICENCE = "https://creativecommons.org/licenses/by/4.0/"
RIGHTS = "https://www.ilo.org/rights-and-permissions"
ATTRIBUTION = "International Labour Organization, Maritime Labour Convention, 2006, as amended (including 2022 amendments), published 2 October 2024. CC BY 4.0. Excerpts are cropped from the English publication. The ILO has not reviewed or endorsed the indexing or excerpts."

# Flag actions in UN Treaty Collection registration 51299. The registering party is the ILO.
# Columns are flag, deposit/notification date, date of effect and individual UNTC action identifier.
ACTIONS = """
AG 11/08/2011 20/08/2013 08000002803b0ed4
AU 21/12/2011 20/08/2013 08000002803b0ed9
BS 11/02/2008 20/08/2013 08000002803b1092
BD 06/11/2014 06/11/2015 0800000280441d88
BE 20/08/2013 20/08/2014 08000002803dfe04
BZ 08/07/2014 08/07/2015 0800000280441dc8
BR 07/05/2020 07/05/2021 08000002805ad183
CA 15/06/2010 20/08/2013 08000002803b10a7
CN 12/11/2015 12/11/2016 0800000280479427
HK 06/08/2018 20/12/2018 080000028053b964
KM 18/02/2024 18/02/2025 08000002806669c6
CK 18/12/2019 18/12/2020 08000002805750c1
CY 20/07/2012 20/08/2013 08000002803b10af
DK 23/06/2011 20/08/2013 08000002803b10b3
FO 09/07/2013 20/08/2013 08000002803e100c
EG 07/06/2024 07/06/2025 0800000280666d0f
FR 28/02/2013 28/02/2014 08000002803dfe71
NC 28/02/2013 28/02/2014 08000002803e1011
DE 16/08/2013 16/08/2014 08000002803dfe76
GR 04/01/2013 04/01/2014 08000002803dfed0
HN 06/06/2016 06/06/2017 08000002804e4610
IN 09/10/2015 09/10/2016 0800000280479479
ID 12/06/2017 12/06/2018 08000002804e461a
IE 21/07/2014 21/07/2015 0800000280444817
IT 19/11/2013 19/11/2014 08000002803dfeea
JM 13/06/2017 13/06/2018 08000002804e461e
JP 05/08/2013 05/08/2014 08000002803dfef4
LR 07/06/2006 20/08/2013 08000002803b10c1
MY 20/08/2013 20/08/2014 08000002803dfff9
MT 22/01/2013 22/01/2014 08000002803e0043
MH 25/09/2007 20/08/2013 08000002803b10c9
NL 13/12/2011 20/08/2013 08000002803b10cd
NZ 09/03/2016 09/03/2017 08000002804e4630
NO 10/02/2009 20/08/2013 08000002803b10d1
PW 29/05/2012 20/08/2013 08000002803b10d8
PA 06/02/2009 20/08/2013 08000002803b10dc
PH 20/08/2012 20/08/2013 08000002803b10e0
PT 12/05/2016 12/05/2017 08000002804e4667
KR 09/01/2014 09/01/2015 08000002803dff06
SG 15/06/2011 20/08/2013 08000002803b10fc
ZA 20/06/2013 20/06/2014 08000002803e04f8
ES 04/02/2010 20/08/2013 08000002803b1100
KN 21/02/2012 20/08/2013 08000002803b10ee
VC 09/11/2010 20/08/2013 08000002803b10f3
SE 12/06/2012 20/08/2013 08000002803b1104
TV 16/02/2012 20/08/2013 08000002803b1111
GI 07/08/2013 07/08/2014 08000002803e108a
IM 07/08/2013 07/08/2014 08000002803e1090
BM 02/05/2014 07/08/2014 08000002803e1041
GB 07/08/2013 07/08/2014 08000002803e08e5
KY 13/02/2014 07/08/2014 08000002803e1059
VN 08/05/2013 08/05/2014 08000002803e0984
AL 28/10/2016 28/10/2017 08000002804e4542
DZ 22/07/2016 22/07/2017 08000002804e4547
AR 28/05/2014 28/05/2015 08000002803dfde7
BB 20/06/2013 20/06/2014 08000002803dfdfd
BJ 13/06/2011 20/08/2013 08000002803b1096
BA 18/01/2010 20/08/2013 08000002803b109a
BG 12/04/2010 20/08/2013 08000002803b10a3
CV 06/10/2015 06/10/2016 0800000280479423
CL 22/02/2018 22/02/2019 0800000280538955
CG 26/03/2014 26/03/2015 08000002803dfe28
HR 12/02/2010 20/08/2013 08000002803b10ab
DJ 20/07/2018 20/07/2019 080000028053b95a
EE 05/05/2016 05/05/2017 08000002804e460c
ET 28/03/2019 28/03/2020 0800000280559f4d
FJ 10/10/2014 10/10/2015 0800000280441dec
FI 09/01/2013 09/01/2014 08000002803dfe4c
GA 25/09/2014 25/09/2015 0800000280441e02
GM 09/11/2018 09/11/2019 0800000280559f51
GE 14/02/2024 14/02/2025 0800000280666d17
GH 16/08/2013 16/08/2014 08000002803dfec9
GD 12/11/2018 12/11/2019 0800000280559f5e
GW 10/06/2024 10/06/2025 0800000280666d3e
HU 31/07/2013 31/07/2014 08000002803dfedd
IS 04/04/2019 04/04/2020 0800000280559f70
IR 11/06/2014 11/06/2015 08000002803dfee2
JO 27/04/2016 27/04/2017 08000002804e4622
KE 31/07/2014 31/07/2015 0800000280441e07
KI 24/10/2011 20/08/2013 08000002803b10b9
LV 12/08/2011 20/08/2013 08000002803b10bd
LB 09/03/2018 09/03/2019 080000028053b960
LT 20/08/2013 20/08/2014 08000002803dffb4
LU 20/09/2011 20/08/2013 08000002803b10c5
MV 07/10/2014 07/10/2015 0800000280441e17
MU 30/05/2014 30/05/2015 08000002803e0048
MN 01/09/2015 01/09/2016 080000028047947d
ME 03/02/2015 03/02/2016 0800000280441e1c
MA 10/09/2012 10/09/2013 08000002803e0063
MZ 25/05/2021 25/05/2022 08000002805c6cf9
MM 25/05/2016 25/05/2017 08000002804e462c
NI 20/12/2013 20/12/2014 08000002803e0267
NG 18/06/2013 18/06/2014 08000002803e02bd
PK 14/03/2025 14/03/2026 0800000280696288
PL 03/05/2012 20/08/2013 08000002803b10e6
RO 24/11/2015 24/11/2016 0800000280479484
RU 20/08/2012 20/08/2013 08000002803b10ea
WS 21/11/2013 21/11/2014 08000002803e02ef
SN 19/09/2019 19/09/2020 0800000280576750
RS 15/03/2013 15/03/2014 08000002803e0469
SC 07/01/2014 07/01/2015 08000002803e046e
SK 17/05/2018 17/05/2019 080000028053b956
SI 15/04/2016 15/04/2017 08000002804e466b
LK 12/01/2017 12/01/2018 08000002804e466f
SD 04/10/2019 04/10/2020 0800000280577375
CH 21/02/2011 20/08/2013 08000002803b1109
TH 07/06/2016 07/06/2017 08000002804e467a
TG 14/03/2012 20/08/2013 08000002803b110d
TN 05/04/2017 05/04/2018 08000002804e467e
TZ 03/04/2019 03/04/2020 080000028055a2e7
""".strip().splitlines()
TERRITORIES = {
    "HK": "Declaration of application without modification to the Hong Kong Special Administrative Region",
    "BM": "Territorial application in respect of Bermuda",
    "KY": "Territorial application in respect of the Cayman Islands",
    "GI": "Territorial application in respect of Gibraltar",
    "IM": "Territorial application in respect of Isle of Man",
    "FO": "Territorial application in respect of the Faroe Islands",
    "NC": "Territorial application in respect of New Caledonia",
}
# Additional actions recorded in the Netherlands Ministry of Foreign Affairs treaty register.
# The two British extensions have documented effect dates; the table supplies no notification date.
ADDITIONAL = [
    ("CU", "Cuba", "12-06-2026", "12-06-2027"), ("EC", "Ecuador", "04-04-2025", "04-04-2026"),
    ("IQ", "Iraq", "22-03-2023", "22-03-2024"), ("MG", "Madagascar", "15-06-2023", "15-06-2024"),
    ("OM", "Oman", "29-03-2022", "29-03-2023"), ("SM", "San Marino", "30-03-2022", "30-03-2023"),
    ("SL", "Sierra Leone", "29-03-2022", "29-03-2023"), ("SB", "Solomon Islands", "08-01-2026", "08-01-2027"),
    ("SY", "Syria", "06-04-2023", "06-04-2024"), ("VG", "British Virgin Islands", None, "11-03-2021"),
    ("FK", "Falkland Islands", None, "11-03-2021"),
]

# Physical pages and vertical bands in the identified 2024 print. Each ends in the margin before the next clause.
PASSAGES = [
    ("tonnage", "Article II(1)(c)", "Gross tonnage", [(7, 88.8, 157.7)]),
    ("waters", "Article II(1)(i)", "Meaning of ship and the waters excluded", [(7, 291.6, 327.3)]),
    ("scope", "Article II(4)", "Commercial ships and excluded ship types", [(7, 473.6, 522.3)]),
    ("doubt", "Article II(5)", "Competent authority determination in case of doubt", [(7, 522.4, 571.2)]),
    ("small-ships", "Article II(6)", "Limited national determination for smaller ships", [(7, 571.3, 627), (8, 62, 113.8)]),
    ("certificate-scope", "Regulation 5.1.3(1)", "Compulsory certification and the definition of international voyage", [(87, 298.3, 380.2)]),
    ("voluntary", "Regulation 5.1.3(2)", "Certification at the shipowner’s request", [(87, 380.3, 419.8)]),
    ("certificate", "Regulation 5.1.3(3)", "Carriage and maintenance of the maritime labour certificate", [(87, 419.8, 492.7)]),
    ("declaration", "Regulation 5.1.3(4)", "Declaration of maritime labour compliance", [(87, 492.8, 554.1)]),
]

FIELDS = [
    ("mlcSeagoing", "Navigates beyond inland, sheltered and port-regulated waters", "Select Yes if the vessel’s navigation extends beyond the waters excluded from the definition in Article II(1)(i).", "waters"),
    ("mlcCommercialActivity", "Ordinarily engaged in commercial activity", "Article II(4) covers ordinarily commercial operations regardless of public or private ownership.", "scope"),
    ("mlcFishingOrSimilar", "Engaged in fishing or similar pursuits", "Article II(4) expressly excludes these activities.", "scope"),
    ("mlcTraditionalBuild", "Ship of traditional build under Article II(4)", "The treaty gives dhows and junks as examples of traditional builds.", "scope"),
    ("mlcWarshipOrNavalAuxiliary", "Warship or naval auxiliary", "Article II(4) expressly excludes these ships.", "scope"),
    ("mlcInternationalVoyage", "International voyage under Regulation 5.1.3", "For this regulation the voyage must be from a country to a port outside that country.", "certificate-scope"),
    ("mlcOperatingFromForeignPort", "Operating from or between ports in another country", "Regulation 5.1.3(1)(b) also covers a participating flag’s ship operating from a port or between ports in a different country.", "certificate-scope"),
    ("mlcShipownerRequest", "Shipowner requested MLC certification", "Under Regulation 5.1.3(2) the shipowner may request certification from the member whose flag the vessel flies.", "voluntary"),
]


def fetch(url):
    request = Request(url, headers={"User-Agent": "Maritime treaty source index/1.0"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def digest(data, expected):
    if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("The ILO PDF differs from its reviewed fingerprint")
    return data


def action_url(identifier):
    return "https://treaties.un.org/Pages/showActionDetails.aspx?objid=" + identifier + "&clang=_en"


def table_rows(page):
    return [[html.unescape(re.sub("<[^>]+>", "", cell)).strip() for cell in re.findall(r"<(?:td|th)\b[^>]*>(.*?)</(?:td|th)>", row, re.I | re.S)]
            for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", page, re.I | re.S)]


def iso_date(value):
    return datetime.strptime(value.replace("-", "/"), "%d/%m/%Y").date().isoformat() if value else None


def verify_actions():
    registry = fetch(REGISTER).decode("utf-8")
    published = set(re.findall(r'showActionDetails\.aspx\?objid=(\w+)', registry, re.I))
    pinned = {line.split()[-1] for line in ACTIONS}
    if published != pinned:
        raise ValueError("The UN register lists a different set of actions. Review the changed entries.")
    for line in ACTIONS:
        flag, deposit, effect, identifier = line.split()
        matches = [row for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", registry, re.I | re.S) if identifier in row]
        if len(matches) != 1 or deposit not in matches[0] or effect not in matches[0]:
            raise ValueError(f"{flag}: the registered action needs review")
        if flag in TERRITORIES:
            page = fetch(action_url(identifier)).decode("utf-8")
            plain = " ".join(html.unescape(re.sub("<[^>]+>", " ", page)).split())
            if TERRITORIES[flag] not in plain:
                raise ValueError(f"{flag}: the territorial declaration needs review")
        elif ">Ratification<" not in matches[0]:
            raise ValueError(f"{flag}: action is not a ratification")
    try:
        secondary = fetch(DUTCH_REGISTER)
    except URLError as error:
        if not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise
        # Some Windows installations provide the Dutch government CA through the platform TLS store.
        secondary = subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", DUTCH_REGISTER])
    rows = table_rows(secondary.decode("utf-8"))
    for code, name, submitted, effective in ADDITIONAL:
        matches = [row for row in rows if row and row[0] == name]
        if submitted:
            matches = [row for row in matches if len(row) == 6 and row[2].startswith(submitted) and row[3] == effective and not row[5]]
        else:
            matches = [row for row in matches if len(row) == 3 and row[1] == effective and not row[2]]
        if len(matches) != 1:
            raise ValueError(f"{code}: the additional recorded treaty action needs review")


def normalize(text):
    return "".join(char for char in unicodedata.normalize("NFKC", text.casefold()) if char.isalnum())


def extract_passages(data, original=None):
    output = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for key, number, title, ranges in PASSAGES:
            boxes = [(page - 1, pymupdf.Rect(0, top, doc[page - 1].rect.width, bottom)) for page, top, bottom in ranges]
            clip, text = clip_source(doc, boxes, number + " " + title)
            if original is not None and normalize(text) not in original:
                raise ValueError(f"{number}: the 2006 wording differs and requires review")
            path = "pdf/mlc-" + key + ".pdf"
            write_bytes(SITE / path, clip)
            output.append({"id": key, "number": number, "title": title, "text": text,
                           "pages": [page for page, _, _ in ranges], "clip": path})
    return output


def rules_for(flag):
    def term(field, value, source, op="eq"):
        return {"field": field, "op": op, "value": value, "source": source}
    def all_of(*items):
        return {"all": list(items)}
    participation = term("flag", flag, "Individual flag action in the cited treaty status register")
    scope = all_of(participation, term("mlcSeagoing", "yes", "Article II(1)(i)"),
                   term("mlcCommercialActivity", "yes", "Article II(4)"),
                   term("shipType", "fishing", "Article II(4)", "neq"),
                   term("mlcFishingOrSimilar", "no", "Article II(4)"),
                   term("mlcTraditionalBuild", "no", "Article II(4)"),
                   term("mlcWarshipOrNavalAuxiliary", "no", "Article II(4)"))
    route = {"any": [term("mlcInternationalVoyage", "yes", "Regulation 5.1.3(1)(a)"),
                     term("mlcOperatingFromForeignPort", "yes", "Regulation 5.1.3(1)(b)")]}
    compulsory = all_of(term("grossTonnage", 500, "Regulation 5.1.3(1)", "gte"), route)
    request = term("mlcShipownerRequest", "yes", "Regulation 5.1.3(2)")
    certification = all_of(scope, {"any": [compulsory, request]})
    return {
        "tonnage": (scope, "instrument", "Consult the tonnage certificate and the treaty definition."),
        "waters": (all_of(participation, term("mlcSeagoing", "yes", "Article II(1)(i)")), "instrument", "Read the full application provisions in Article II(4)–(6)."),
        "scope": (scope, "section", "Article II(5) gives the competent authority a role where application is in doubt."),
        "doubt": (scope, "instrument", "Consult the competent authority if the status of a ship or category is in doubt."),
        "small-ships": (all_of(scope, term("grossTonnage", 200, "Article II(6)", "lt"), term("mlcInternationalVoyage", "no", "Article II(6)")), "context", "The authority must make the determination and ensure alternative provision for particular Code details. These thresholds alone grant no exemption."),
        "certificate-scope": (all_of(scope, compulsory), "section", "The 500 GT threshold is inclusive. Either specified operating pattern satisfies paragraph 1."),
        "voluntary": (all_of(scope, {"not": compulsory}, request), "section", "Paragraph 2 concerns a ship outside paragraph 1 following its owner’s request to the flag member."),
        "certificate": (certification, "section", "The certificate duty is screened together with the two application routes in paragraphs 1–2."),
        "declaration": (certification, "section", "The declaration duty is screened together with the two application routes in paragraphs 1–2."),
    }


def make_index(passages):
    names_file = SITE / "data" / "countries.json"
    names = {c["code"]: c["name"] for c in json.loads(names_file.read_text("utf-8"))["countries"]}
    instruments = []
    flags = []
    for line in ACTIONS:
        code, submitted, effective, identifier = line.split()
        action = {"flag": code, "kind": "Territorial application" if code in TERRITORIES else "Ratification",
                  "registeredOn": iso_date(submitted), "effectiveFrom": iso_date(effective), "sourceUrl": action_url(identifier),
                  "register": "United Nations Treaty Collection, registration 51299"}
        if code in TERRITORIES:
            action["description"] = TERRITORIES[code]
        if code == "FO":
            action["territorialSource"] = "https://fma.fo/manning-2/maritime-labour-convention/"
        flags.append(action)
    for code, name, submitted, effective in ADDITIONAL:
        flags.append({"flag":code, "kind":"Ratification" if submitted else "Territorial application",
                      "registeredOn":iso_date(submitted), "effectiveFrom":iso_date(effective),
                      "register":"Netherlands Ministry of Foreign Affairs Treaty Database, treaty 010842",
                      "sourceUrl":DUTCH_REGISTER + ("#" + quote(name) if submitted else "")})
    for action in sorted(flags, key=lambda item: item["flag"]):
        code = action["flag"]
        rules = rules_for(code)
        sections = [{**section, "criteria": rules[section["id"]][0], "screeningLevel": rules[section["id"]][1],
                     "caveat":rules[section["id"]][2]} for section in passages]
        label = names.get(code, code)
        deposit = " recorded " + action["registeredOn"] if action["registeredOn"] else ""
        notes = [f"{label}: {action['kind'].lower()}{deposit}, effective {action['effectiveFrom']}.",
                 action.get("description", ""), "Only the selected provisions have been checked against the 2006 wording. National implementation, exemptions and decisions about individual vessels require their own sources.", ATTRIBUTION]
        edition = {"id": "mlc-en-" + code, "label": "MLC 2006 · " + label, "kind": "Official English consolidated treaty text",
                   "language": "en", "publishedOn": "2024-10-02", "effectiveFrom": action["effectiveFrom"],
                   "effectiveTo": None, "verifiedThrough": CHECKED, "sourcePage": PAGE, "sourceUrl": DOCUMENT,
                   "sourceLinks": [url for url in (action["sourceUrl"], action.get("territorialSource"), REGISTER, DUTCH_REGISTER, NORMLEX, ORIGINAL, RIGHTS, LICENCE) if url],
                   "flagEvidence": action, "pdf": PDF, "pdfSha256": SHA256, "notes": " ".join(filter(None, notes)), "sections": sections}
        instruments.append({"id": "ILO-MLC-2006-" + code, "title": "Maritime Labour Convention, 2006 · " + label,
                            "shortTitle": "Maritime Labour Convention · " + label, "jurisdiction":code, "flagState":code, "scopeSection":"scope",
                            "authority": PUBLISHER, "language": "en", "register": action["sourceUrl"], "versions":[edition]})
    fields = [{"key": key, "label": label, "type": "select", "options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}],
               "help": help_text, "source": {"versionId":"mlc-en-NO","sectionId":section}}
              for key, label, help_text, section in FIELDS]
    return {"version":1, "checkedAt":CHECKED, "fields":fields, "instruments":instruments, "comparisons":[],
            "flags":flags, "register": REGISTER, "secondaryRegister":DUTCH_REGISTER,
            "coverage":"Dated flag-state actions only. A territory requires a separate recorded application. Absence of an action is not a finding about port-state control or national legislation.",
            "reuse":{"credit":ATTRIBUTION,"licence":LICENCE,"terms":RIGHTS}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="verify individual flag actions, 2006 wording and publisher bytes online")
    args = parser.parse_args()
    file = SITE / PDF
    data = digest(fetch(DOCUMENT) if args.refresh or not file.exists() else file.read_bytes(), SHA256)
    original = None
    if args.refresh:
        verify_actions()
        with pymupdf.open(stream=digest(fetch(ORIGINAL), ORIGINAL_SHA256), filetype="pdf") as older:
            original = normalize("\n".join(line for p in older for line in p.get_text("text", sort=True).splitlines()
                                            if line.strip() not in ("Maritime Labour Convention, 2006", "Compliance and enforcement")
                                            and not line.strip().isdigit()))
    passages = extract_passages(data, original)
    write_bytes(file, data)
    index = make_index(passages)
    write_bytes(SITE / "data" / "mlc-folios.json", (json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    print(f"{len(index['flags'])} individually documented flags, {len(passages)} distinct treaty excerpts")


if __name__ == "__main__":
    main()

