"""Build the dated major-register source map from UN country codes and reviewed publisher links."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from gazette import packed


ROOT = Path(__file__).resolve().parents[1]
REPORT = "https://unctad.org/system/files/official-document/rmt2025ch2_en.pdf"
RANKED = "LR PA MH HK SG CN MT BS GR JP PT CY ID DK KR IR IM NO BB IN SA RU US VN GB MY AG FR DE PW IT NG BE TR NL".split()
REGISTER_NAMES = {
    "HK": "Hong Kong, China", "PT": "International Shipping Register of Madeira",
    "DK": "Danish International Register of Shipping", "NO": "Norwegian International Ship Register",
}

# Each entry identifies a specific legal publication, authority register or official catalogue record.
SOURCES = {
    "LR": [
        ("Liberian Maritime Law and Regulations · registry publication RLM-105A", "https://www.liscr.com/marketing/liscr/media/liscr/online%20library/maritime/rlm-105alegislation.pdf", "Registration and safety", "Legislation"),
        ("Marine notices and amendments", "https://www.liscr.com/onlinelibrary/", "Flag instructions", "Flag administration"),
    ],
    "PA": [
        ("Ley 57 de 2008 · General Merchant Marine Law", "https://www.amp.gob.pa/wp-content/uploads/2025/06/Ley-57-de-6-de-agosto-de-2008-Espanol-e-Ingles.pdf", "Ship registration", "Legislation"),
        ("MMC-136 · recognized organizations", "https://www.panamashipregistry.com/wp-content/uploads/2026/01/MMC-136-RO-20-01-2026-1.pdf", "Statutory certification", "Flag circular"),
    ],
    "MH": [
        ("Maritime Act · MI-107", "https://www.register-iri.com/wp-content/uploads/MI-107.pdf", "Registration and administration", "Legislation"),
        ("Maritime Regulations · MI-108", "https://www.register-iri.com/wp-content/uploads/MI-108.pdf", "Ship safety and operations", "Regulations"),
        ("National maritime requirements", "https://www.register-iri.com/maritime/national-maritime-requirements/", "Flag instructions", "Flag administration"),
    ],
    "HK": [
        ("Shipping ordinances · Marine Department legislative index", "https://www.mardep.gov.hk/en/legislation/shipping-ordinances/index.html", "Registration and safety", "Legislation index"),
        ("Merchant Shipping (Safety) Ordinance · Cap. 369", "https://www.elegislation.gov.hk/hk/cap369", "Ship safety", "Legislation"),
        ("Merchant Shipping (Registration) Ordinance · Cap. 415", "https://www.elegislation.gov.hk/hk/cap415", "Ship registration", "Legislation"),
    ],
    "SG": [
        ("Merchant Shipping Act 1995", "https://sso.agc.gov.sg/Act/MSA1995", "Registration and safety", "Legislation"),
        ("Merchant Shipping Act and subsidiary legislation", "https://www.mpa.gov.sg/regulations-advisory/maritime-legislation-of-singapore/merchant-shipping-act", "Flag instructions", "Flag administration"),
    ],
    "CN": [
        ("Maritime Traffic Safety Law · 2021 revision", "https://www.ccg.gov.cn/zcfg/202405/t20240515_182.html", "Navigation and ship safety", "Legislation"),
        ("Revised Maritime Law · adoption and commencement notice", "https://en.moj.gov.cn/2025-10/29/c_1136253.htm", "Maritime law revision", "Ministry notice"),
    ],
    "MT": [
        ("Merchant Shipping Act · chapter 234", "https://legislation.mt/eli/cap/234/eng/portalpdf", "Registration and safety", "Legislation"),
        ("Merchant shipping and registration", "https://www.transport.gov.mt/maritime/ship-and-yacht-registry/ship-registration/merchant-shipping-133", "Ship registration", "Flag administration"),
    ],
    "BS": [
        ("Merchant Shipping Act 2021 · No. 33", "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2021/2021-0033/2021-0033_1.pdf", "Registration and safety", "Legislation"),
        ("Bahamas Recognised Organisations", "https://www.bahamasmaritime.com/the-bma/partnerships/authorised-classification-societies/", "Statutory certification", "Flag administration"),
    ],
    "GR": [
        ("Decree 187/1973 · Code of Public Maritime Law and original Gazette link", "https://generg.gr/en/nomothesia/", "Public maritime law", "Legislation index"),
        ("Maritime legislation · Hellenic Chamber of Shipping", "https://nee.gr/en/maritime-legislation/", "Merchant shipping", "Public maritime institution"),
    ],
    "JP": [
        ("Ship Safety Act · Act 11 of 1933", "https://laws.e-gov.go.jp/law/308AC0000000011", "Ship safety and surveys", "Legislation"),
        ("Ship Act · Act 46 of 1899", "https://laws.e-gov.go.jp/law/132AC0000000046", "Nationality and registration", "Legislation"),
    ],
    "PT": [
        ("Decree-Law 96/89 · Madeira International Shipping Register, consolidated text", "https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/1989-141358087", "Madeira register", "Legislation"),
        ("Decree-Law 96/89 · original publication", "https://diariodarepublica.pt/dr/detalhe/decreto-lei/96-1989-614782", "Madeira register", "Official gazette"),
    ],
    "CY": [
        ("Merchant Shipping (Registration of Ships, Sales and Mortgages) Laws · 1963–2020 compilation", "https://www.gov.cy/media/sites/25/2024/05/Law-45-of-1963-Registration-of-Ships-Law-Consolidation-2020-EN.pdf", "Ship registration", "Legislation"),
        ("Ship registration, maritime safety and security legislation", "https://www.gov.cy/dms/en/documents/ship-registration-maritime-safety-security/", "Ship safety and registration", "Flag administration"),
    ],
    "ID": [
        ("Shipping Law · Law 17 of 2008", "https://peraturan.bpk.go.id/Details/39060/uu-no-17-tahun-2008", "Merchant shipping", "Legislation"),
        ("Law 66 of 2024 · third amendment to the Shipping Law", "https://peraturan.bpk.go.id/Details/306526/uu-no-66-tahun-2024", "Ship law amendments", "Legislation"),
    ],
    "DK": [
        ("Danish International Register of Shipping Act · authority translation", "https://www.dma.dk/Media/637776645608571752/Consolidated%20act%20on%20the%20Danish%20International%20Register%20of%20Shipping.pdf", "Danish International Register", "Legislation"),
        ("Maritime acts · Danish Maritime Authority", "https://www.dma.dk/growth-and-framework-conditions/rules-and-legislation/acts", "Maritime law", "Flag administration"),
    ],
    "KR": [
        ("Ship Safety Act · national legislation translation", "https://elaw.klri.re.kr/eng_mobile/viewer.do?hseq=61839&key=42&type=part", "Ship safety and inspections", "Legislation"),
        ("Maritime Safety Act · National Law Information Center edition", "https://law.go.kr/LSW/lsInfoP.do?chrClsCd=010203&lsiSeq=246901&urlMode=engLsInfoR&viewCls=engLsInfoR", "Navigation and safety", "Legislation"),
    ],
    "IR": [
        ("Iranian maritime law of 1964 · FAOLEX legislative record", "https://faolex.fao.org/en/documents/LEX-FAOC159683/law-of-the-sea-irn-1964", "Registration and maritime transport", "Intergovernmental catalogue"),
        ("Iran · government maritime labour implementation profile", "https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:80021:0::NO::P80021_COUNTRY_ID:102800", "Maritime labour", "Government report to ILO"),
    ],
    "IM": [
        ("Merchant Shipping Registration Regulations 1996", "https://legislation.gov.im/cms/images/LEGISLATION/SUBORDINATE/1996/1996-0689/1996-0689_1.pdf", "Ship registration", "Regulations"),
        ("Principal shipping acts · Isle of Man Ship Registry", "https://www.iomshipregistry.com/notices-legislation/legislation/principal-acts/", "Registration and safety", "Flag administration"),
    ],
    "NO": [
        ("Norwegian International Ship Register Act · 12 June 1987 No. 48", "https://lovdata.no/lov/1987-06-12-48", "Norwegian International Ship Register", "Legislation"),
        ("NIS register conditions", "https://www.sdir.no/en/the-norwegian-ship-registers/background-terms-and-conditions/", "Ship registration", "Flag administration"),
    ],
    "BB": [
        ("Shipping Act · chapter 296, 1998 revised edition", "https://www.barbadoslawcourts.gov.bb/assets/content/pdfs/statutes/ShippingCAP296.pdf", "Ship registration and safety", "Historical legislation"),
        ("Acts of the Barbados Maritime Ship Registry", "https://barbadosmaritime.com/documents/acts/", "Registry legislation", "Flag administration"),
    ],
    "IN": [
        ("Merchant Shipping Act 2025 · Act 24", "https://www.indiacode.nic.in/bitstream/123456789/22147/1/2025-24.pdf", "Merchant shipping", "Legislation"),
        ("Acts and rules · Ministry of Ports, Shipping and Waterways", "https://www.shipmin.gov.in/en/act-and-rules/Act", "Shipping legislation", "Flag administration"),
    ],
    "SA": [
        ("Commercial Maritime Law · Bureau of Experts translation", "https://laws.boe.gov.sa/Files/Download/?attId=a26adc54-d4ff-47bf-85a1-adbb00fb521c", "Commercial maritime law", "Legislation"),
        ("Commercial Maritime Law · Arabic legislative record", "https://laws.boe.gov.sa/BoeLaws/Laws/SearchDetails/?Id=43344715-1e0d-4e7f-9895-aa3d00f670e6", "Commercial maritime law", "Legislation"),
    ],
    "RU": [
        ("Merchant Shipping Code · Federal Law 81-FZ of 30 April 1999", "https://mchs.gov.ru/dokumenty/806", "Merchant shipping", "Legislation"),
    ],
    "US": [
        ("33 CFR Part 175 · recreational-vessel equipment, 1 July 2025 edition", "https://www.govinfo.gov/content/pkg/CFR-2025-title33-vol2/pdf/CFR-2025-title33-vol2-part175.pdf", "Recreational boat equipment", "Regulations"),
        ("46 CFR volume 7 · small passenger vessel and related requirements", "https://www.govinfo.gov/content/pkg/CFR-2025-title46-vol7/xhtml/CFR-2025-title46-vol7.html", "Passenger vessel safety", "Regulations"),
    ],
    "VN": [
        ("Vietnam Maritime Code · Law 95/2015/QH13", "https://vanban.chinhphu.vn/default.aspx?docid=183192&pageid=27160", "Merchant shipping", "Legislation"),
        ("Vietnam Maritime Code · national trade portal English edition", "https://www.vietnamtradeportal.gov.vn/kcfinder/upload/files/95_2015_QH13%20EN.pdf", "Merchant shipping", "Legislation"),
    ],
    "GB": [
        ("Merchant Shipping Act 1995", "https://www.legislation.gov.uk/ukpga/1995/21/contents", "Registration and safety", "Legislation"),
        ("Life-Saving Appliances and Arrangements Regulations 2020 · SI 501, as made", "https://www.legislation.gov.uk/uksi/2020/501/pdfs/uksi_20200501_en.pdf", "Life-saving equipment", "Regulations"),
        ("Merchant Shipping Notices", "https://www.gov.uk/government/collections/merchant-shipping-notices-msns", "Flag instructions", "Flag administration"),
    ],
    "MY": [
        ("Marine Department legislation list, including the Merchant Shipping Ordinance 1952", "https://www.marine.gov.my/en/quick-links/legislation/legislation-list/", "Merchant shipping", "Legislation index"),
        ("Maritime acts and policy · Ministry of Transport", "https://www.mot.gov.my/en/maritime/acts-and-policy", "Shipping legislation", "Flag administration"),
    ],
    "AG": [
        ("Merchant Shipping Act 2006", "https://www.adoms.gov.ag/antigua-and-barbuda-merchant-shipping-act-2006/", "Registration and safety", "Legislation"),
        ("Antigua and Barbuda legislation · ADOMS", "https://www.adoms.gov.ag/information-center/antigua-barbuda-legislation/", "Flag instructions", "Flag administration"),
    ],
    "FR": [
        ("Transport Code · book VI, French International Register", "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000023079051", "Ship registration", "Legislation"),
    ],
    "DE": [
        ("Ship Safety Act · Schiffssicherheitsgesetz", "https://www.gesetze-im-internet.de/schsg/BJNR286010998.html", "Ship safety", "Legislation"),
        ("Ship Safety Ordinance · Schiffssicherheitsverordnung", "https://www.gesetze-im-internet.de/schsv_1998/BJNR302300998.html", "Ship safety and surveys", "Regulations"),
    ],
    "PW": [
        ("Palau National Code · title 7, Admiralty and Maritime", "https://www.palaulaw.gov.pw/palau-national-code", "Admiralty and shipping", "Legislation index"),
        ("Republic of Palau Maritime Regulations · 2012 instrument deposited with ILO", "https://normlex.ilo.org/dyn/nrmlx_es/f?p=1000:53::::53:P53_FILE_ID:3285803", "Maritime regulation", "Published instrument"),
    ],
    "IT": [
        ("Navigation Code · Royal Decree 327 of 30 March 1942", "https://www.mit.gov.it/normativa/regio-decreto-numero-327-del-30031942", "Navigation and shipping", "Legislation"),
    ],
    "NG": [
        ("Merchant Shipping Act 2007", "https://nimasa.gov.ng/wp-content/uploads/2025/01/nig92406.pdf", "Merchant shipping", "Legislation"),
        ("Registration and compliance guidance · NIMASA", "https://nsro.nimasa.gov.ng/guides-compliance", "Ship registration", "Flag administration"),
    ],
    "BE": [
        ("Belgian Shipping Code · consolidated legislative record", "https://www.ejustice.just.fgov.be/eli/loi/2019/05/08/2019A12565/justel", "Shipping code", "Legislation"),
        ("Law introducing the Belgian Shipping Code · official publication", "https://mobilit.belgium.be/sites/default/files/documents/regulations/2022/wet_loi_exploitat.pdf", "Shipping code", "Official gazette"),
    ],
    "TR": [
        ("Maritime laws including Law 4922 on safety of life and property at sea", "https://denizcilik.uab.gov.tr/mevzuat/denizcilik-mevzuati/kanun/", "Safety and seaworthiness", "Legislation index"),
        ("Regulation 10775 on general ship inspection and certification", "https://www.mevzuat.gov.tr/Metin.Aspx?MevzuatIliski=0&MevzuatKod=7.5.10775&sourceXmlSearch=gemilerin", "Ship surveys", "Regulations"),
    ],
    "NL": [
        ("Ships Act · Schepenwet", "https://puc.overheid.nl/nsi/doc/PUC_70908_14/", "Ship safety", "Legislation"),
        ("Sea-going Ship Safety Regulations · Dutch maritime legal framework", "https://puc.overheid.nl/nsi/doc/PUC_70731_14/", "Ship safety and surveys", "Regulations"),
    ],
    "AU": [
        ("Marine Safety (Domestic Commercial Vessel) National Law Act 2012", "https://www.legislation.gov.au/C2012A00121/latest", "Domestic commercial vessels", "Legislation"),
        ("National Law Act guidance · Australian Maritime Safety Authority", "https://www.amsa.gov.au/about/regulations-and-standards/national-law-act-2012", "Domestic vessel safety", "Flag administration"),
    ],
    "BR": [
        ("Law 9.537 of 1997 · waterway traffic safety", "https://www2.camara.leg.br/legin/fed/lei/1997/lei-9537-11-dezembro-1997-349418-normaatualizada-pl.pdf", "Navigation and safety", "Legislation"),
        ("Maritime Authority standards · Brazilian Navy", "https://www.marinha.mil.br/dpc/normas-autoridade-maritima-brasileira/", "Flag instructions", "Flag administration"),
    ],
    "CA": [
        ("Small Vessel Regulations · SOR/2010-91", "https://laws-lois.justice.gc.ca/eng/regulations/sor-2010-91/index.html", "Small vessel equipment and licensing", "Regulations"),
    ],
    "NZ": [
        ("Maritime Rules Part 91 · navigation safety, 9 October 2026 consolidation", "https://www.maritimenz.govt.nz/media/rhwkcqt1/part91-maritime-rule.pdf", "Recreational craft and navigation", "Regulations"),
        ("Part 91 editions and amendment history", "https://www.maritimenz.govt.nz/about-us/rules/all-rules/maritime-rules-part-91/", "Safety rules and amendments", "Flag administration"),
    ],
    "PH": [
        ("Domestic Shipping Development Act of 2004 · Republic Act 9295", "https://ldr.senate.gov.ph/legislative%2Bissuances/Republic%20Act%20No.%209295", "Domestic shipping", "Legislation"),
        ("MARINA Circular DS-2025-03 · wooden-hulled recreational boats", "https://marina.gov.ph/wp-content/uploads/2025/10/MC-No.-DS-2025-03.pdf", "Recreational craft", "Flag circular"),
    ],
    "ZA": [
        ("Merchant Shipping Act 57 of 1951", "https://www.gov.za/documents/merchant-shipping-act-24-aug-1951-0000", "Merchant shipping", "Legislation"),
        ("National Small Vessel Safety Regulations · original 2007 notice", "https://www.gov.za/documents/notices/merchant-shipping-act-regulations-national-small-vessel-safety-08-aug-2007", "Small vessel safety", "Regulations"),
    ],
}


def build(countries):
    names = {entry["code"]: entry["name"] for entry in countries}
    ranks = {code: rank for rank, code in enumerate(RANKED, 1)}
    if len(ranks) != 35 or not set(ranks) <= SOURCES.keys():
        raise ValueError("The published table contains 35 ranked registers.")
    flags = []
    for code in [*RANKED, *sorted(SOURCES.keys() - ranks.keys())]:
        refs = []
        for title, url, topic, kind in SOURCES[code]:
            address = urlsplit(url)
            if address.scheme != "https" or not address.netloc or address.username or address.password:
                raise ValueError("Invalid source URL for " + code)
            refs.append({"title": title, "url": url, "topic": topic, "kind": kind})
        entry = {"code": code, "name": names[code], "sources": refs}
        if code in ranks:
            entry.update(rank=ranks[code], registerName=REGISTER_NAMES.get(code, names[code]))
        flags.append(entry)
    return {"schemaVersion": 1, "basis": {
        "title": "UNCTAD Review of Maritime Transport 2025", "table": "Table II.2 · Leading flags of registration",
        "url": REPORT, "sourceUrl": REPORT, "asOf": "2025-01-01", "date": "2025-01-01",
        "metric": "Deadweight tonnage of the fleet under each flag or register",
        "scope": "Propelled seagoing merchant vessels of at least 100 gross tons. The 35 listed registers account for 93.0% of world fleet deadweight. Rankings for Madeira, DIS and NIS apply to those specific registers. Additional flags have no rank in this table.",
        "reviewedOn": "2026-11-23", "rankedCount": len(ranks),
        "sourceCount": sum(len(f["sources"]) for f in flags),
        "limitations": "Links identify selected laws, editions and flag-authority publications. Registry rankings describe merchant fleet capacity. Consult each law's geographic scope, vessel definitions, exemptions and edition."
    }, "flags": flags}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--countries", type=Path, default=ROOT / "site/data/countries.json")
    parser.add_argument("--out", type=Path, default=ROOT / "site/data/flag-sources.json")
    args = parser.parse_args()
    dataset = build(json.loads(args.countries.read_text("utf-8"))["countries"])
    payload = packed(dataset) + b"\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if not args.out.exists() or args.out.read_bytes() != payload:
        args.out.write_bytes(payload)
    print(f"{len(dataset['flags'])} flags and registers; {dataset['basis']['sourceCount']} legal sources.")


if __name__ == "__main__":
    main()

