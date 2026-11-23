"""Build the national vessel-law catalogue from the public FAOLEX Complete Collection."""

import argparse
import csv
import hashlib
import io
import json
import os
import re
import tempfile
import unicodedata
import zipfile
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
ARCHIVE = ROOT / ".work" / "world-laws" / "FAOLEX_All.zip"
DOWNLOAD = "https://faolex.fao.org/docs/opendata/FAOLEX_All.zip"
CATALOGUE = "https://faolex.apps.fao.org/en/open-data"
LICENSE = "https://creativecommons.org/licenses/by-nc-sa/3.0/igo/"
KNOWN_RELEASES = {"b0d107c274bd623ad516e94f44552f9bdaba87f573e3ea6cc2e5a2c6d0ba3773": "2026-10-03"}

# Select the publisher's controlled keywords, supplemented by unambiguous vessel
# terms in multilingual titles. Generic pollution and fisheries terms alone also
# occur in terrestrial laws and fish-stock management, so they need a vessel signal.
CONTROLLED = {"fishing vessel": "Fishing vessels", "navigation": "Navigation",
              "harbour": "Ports and harbours", "port state measures": "Port State measures"}
TITLE_RULES = {
    "Ship operations": r"\b(?:merchant shipping|shipping act|maritime transport|maritime navigation|marine navigation|inland navigation|maritime traffic|navigation maritime|navigation intérieure|marine marchande|transport maritime|navegación marítima|navegación fluvial|transporte marítimo|marina mercante|navegação marítima|marinha mercante|seeschifffahrt|schifffahrt|maritime vessels?|seagoing vessels?|navires?|buques?|navios?|embarcaciones|embarcações|oil tankers?|tanker ships?|merchant ships?|motorboats?|motor vessels?)\b",
    "Vessel safety": r"\b(?:solas|safety of life at sea|maritime safety|ship safety|vessel safety|safe manning|load lines?|ship construction|ship surveys?|safety of (?:fishing )?vessels|sécurité des navires|seguridad marítima)\b",
    "Ship-source pollution": r"\b(?:marpol|ballast water|ship recycling|ship[ -]breaking|ship[ -]source pollution|pollution (?:from|by) (?:ships|vessels)|oil tanker|anti[ -]fouling systems?|aguas de lastre|eaux de ballast|pol[l]?ution par les navires)\b",
    "Vessel registration and monitoring": r"\b(?:ship registration|registration of (?:ships|vessels)|vessel monitoring system|vessel register|register of ships|registre des navires|registro de buques|registro de embarcaciones)\b",
    "Fishing vessels": r"\b(?:fishing (?:vessels?|boats?|fleets?)|pesqueros|buques de pesca|navires? de pêche|embarcações de pesca|pescherecci)\b",
    "Port State measures": r"\b(?:port state (?:control|measures)|contrôle par l’état du port|control por el estado rector del puerto)\b",
}
TITLE_RULES = {topic: re.compile(pattern, re.IGNORECASE) for topic, pattern in TITLE_RULES.items()}
VESSEL = re.compile(r"\b(?:ship|ships|shipping|vessels?|boats?|watercraft|seafarers?|mariners?|seamen)\b", re.IGNORECASE)
NATIONAL_TYPES = {"Legislation", "Regulation"}

# Common FAO name variants for modern entries in the UN M49 country directory.
# Leave historical or unassigned areas in the record with their own source name.
ALIASES = {
    "china hong kong sar": "HK", "china macao sar": "MO", "palestine": "PS",
    "united states virgin islands": "VI", "wallis and futuna islands": "WF",
    "saint martin": "MF", "sint maarten": "SX", "pitcairn": "PN",
    "svalbard": "SJ", "jan mayen": "SJ", "naoero": "NR",
    "saint helena ascension and tristan da cunha": "SH",
}


def words(value):
    text = unicodedata.normalize("NFKD", value.casefold())
    return " ".join(re.findall(r"[a-z0-9]+", "".join(c for c in text if not unicodedata.combining(c))))


def values(value):
    return list(dict.fromkeys(item for raw in value.split(";") if (item := " ".join(raw.split()))))


def web_links(raw):
    urls = []
    for value in values(raw):
        try:
            parsed = urlsplit(value)
            if parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password:
                urls.append(value)
        except ValueError:
            continue
    return urls


def source_websites(raw):
    """Accept recorded URLs or explicit hostnames, keeping the publisher's paths."""
    result = []
    notes = []
    for source in values(raw):
        url = source
        if not re.match(r"^https?://", source, re.IGNORECASE):
            if not re.match(r"^(?:[\w-]+\.)+[a-z]{2,}(?:/|$)", source, re.IGNORECASE):
                notes.append(source)
                continue
            url = "https://" + source
        if web_links(url) and not any(c.isspace() for c in url):
            result.append(url)
        else:
            notes.append(source)
    return list(dict.fromkeys(result)), notes


def date_text(raw):
    source = raw.strip()
    if not source:
        return None, None
    for pattern, output in (("%d-%m-%Y", "%Y-%m-%d"), ("%Y-%m-%d", "%Y-%m-%d"),
                            ("%m-%Y", "%Y-%m"), ("%Y-%m", "%Y-%m"), ("%Y", "%Y")):
        try:
            day = datetime.strptime(source, pattern)
            return day.strftime(output), day.year
        except ValueError:
            continue
    return source, None


def country_directory(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    names = {words(item["name"]): item["code"] for item in data["countries"]}
    current = set(names.values())
    names.update({key: code for key, code in ALIASES.items() if code in current})
    return names


def jurisdictions(raw, names):
    result = []
    for name in values(raw):
        code = names.get(words(name))
        if not code:
            bare = re.sub(r"\s*\([^)]*\)\s*$", "", name)
            code = names.get(words(bare))
        result.append({"code": code or "", "name": name})
    return result


def topics(row):
    keywords = {item.casefold() for item in values(row["Keywords"])}
    selected = {topic for key, topic in CONTROLLED.items() if key in keywords}
    title = row["Title"] + " " + row["Original Title"]
    for topic, pattern in TITLE_RULES.items():
        if pattern.search(title):
            selected.add(topic)
    if VESSEL.search(title):
        subjects = {s.casefold() for s in values(row["Subjects"])}
        if subjects & {"sea", "fisheries and aquaculture"}:
            if not re.search(r"\b(?:blood|pressure|reactor) vessels?\b", title, re.I):
                selected.add("Ship operations")
    if selected and "marine pollution" in keywords:
        selected.add("Marine pollution")
    return sorted(selected)


def national_record(row, names):
    kinds = {value.strip() for value in row["Type of Text"].split(",")}
    if not kinds <= NATIONAL_TYPES or not row["Country/Territory"].strip():
        return None
    selected = topics(row)
    if not selected:
        return None
    record_id = row["FAOLEX ID"].strip()
    links = web_links(row["Record URL"])
    if not re.fullmatch(r"LEX-FAOC\d+", record_id) or len(links) != 1 or not row["Title"].strip():
        raise ValueError(f"Missing identifier, title or source record for {record_id!r}")
    places = jurisdictions(row["Country/Territory"], names)
    documents = web_links(row["Document URL"])
    pdf = next((url for url in documents if urlsplit(url).path.casefold().endswith(".pdf")), None)
    issued, year = date_text(row["Date of Text"])
    amended, _ = date_text(row["Last Amended Date"])
    source_url = links[0]
    if source_url.startswith("http://www.fao.org/"):
        source_url = "https://" + source_url[len("http://"):]
    websites, site_notes = source_websites(row["Source websites"])
    item = {"id": record_id, "country": places[0]["code"], "countryName": places[0]["name"],
            "countries": places, "title": " ".join(row["Title"].split()), "year": year,
            "topics": selected, "kind": row["Type of Text"], "sourceUrl": source_url}
    optional = {
        "originalTitle": " ".join(row["Original Title"].split()), "issuedDate": issued,
        "amendedDate": amended, "repealed": row["Repealed"].strip().upper() == "Y",
        "pdfUrl": pdf, "documentUrls": documents if documents != [pdf] else [],
        "textUrls": web_links(row["Text URL"]), "sourceWebsites": websites, "sourceWebsiteNotes": site_notes,
        "sourceKeywords": [keyword for keyword in values(row["Keywords"]) if keyword.casefold() in {*CONTROLLED, "marine pollution"}],
        "languages": values(row["Language of Document"]), "subdivisions": values(row["Territorial Subdivision"]),
        "organizations": values(row["Regional Organisations"]),
    }
    item.update((key, value) for key, value in optional.items() if value)
    return item


def download_archive(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    request = Request(DOWNLOAD, headers={"Accept": "*/*", "User-Agent": "Vessel Law Index/1.0"})
    temp = None
    try:
        with urlopen(request, timeout=120) as response, tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temp = Path(output.name)
            while chunk := response.read(1 << 20):
                output.write(chunk)
                if output.tell() > 200_000_000:
                    raise ValueError("FAOLEX archive exceeds the expected compressed size")
        with zipfile.ZipFile(temp) as archive:
            if not 100_000 < archive.getinfo("FAOLEX_All.csv").file_size < 900_000_000:
                raise ValueError("FAOLEX CSV size is outside the expected range")
        os.replace(temp, path)
    finally:
        if temp and temp.exists():
            temp.unlink()


def collect(path, names):
    seen = set()
    records = []
    total = 0
    csv.field_size_limit(20_000_000)
    with zipfile.ZipFile(path) as archive, archive.open("FAOLEX_All.csv") as source:
        with io.TextIOWrapper(source, encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            # The current CSV has a second, misdecoded byte-order marker before
            # the first label. Only accept that column if its semantic name matches.
            if not reader.fieldnames or not reader.fieldnames[0].endswith("FAOLEX ID"):
                raise ValueError("FAOLEX ID header missing")
            reader.fieldnames[0] = "FAOLEX ID"
            for row in reader:
                total += 1
                record = national_record(row, names)
                if record:
                    if record["id"] in seen:
                        raise ValueError(f"Duplicate national record {record['id']}")
                    seen.add(record["id"])
                    records.append(record)
    if total < 100_000 or not records:
        raise ValueError("Incomplete FAOLEX Complete Collection")
    return total, sorted(records, key=lambda r: (-(r["year"] or 0), r["id"]))


def assemble(archive, directory, checked):
    with archive.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    total, records = collect(archive, country_directory(directory))
    codes = Counter()
    names = set()
    unmapped = set()
    for record in records:
        for country in record["countries"]:
            names.add(country["name"])
            if not country["code"]:
                unmapped.add(country["name"])
        codes.update({country["code"] for country in record["countries"] if country["code"]})
    years = [item["year"] for item in records if item["year"]]
    metadata = {"name": "FAOLEX Complete Collection", "publisher": "Food and Agriculture Organization of the United Nations",
                "url": CATALOGUE, "download": DOWNLOAD, "metadata": "https://faolex.apps.fao.org/en/open-data/metadata",
                "license": "CC BY-NC-SA 3.0 IGO", "licenseUrl": LICENSE,
                "attribution": f"FAO. FAOLEX Database. Complete Collection. National vessel-related records selected from the source catalogue. Extracted {checked}.",
                "sha256": digest, "publisherUpdatedOn": KNOWN_RELEASES.get(digest),
                "reuseNotes": "The indexed metadata is adapted from FAOLEX and is distributed under the same licence. Rights in the linked national documents are held separately by their respective owners."}
    counts = {"sourceRecords": total, "records": len(records), "areaCodes": len(codes), "sourceAreas": len(names),
              "unmappedAreas": sorted(unmapped), "byCountry": dict(sorted(codes.items())),
              "withPdf": sum(bool(r.get("pdfUrl")) for r in records), "withAmendedDate": sum(bool(r.get("amendedDate")) for r in records),
              "flaggedRepealed": sum(bool(r.get("repealed")) for r in records), "firstYear": min(years), "lastYear": max(years)}
    return {"version": 1, "checkedAt": checked, "source": metadata, "coverage": counts,
            "selection": "FAOLEX country/territory legislation and regulations with controlled fishing-vessel, navigation, harbour or port-state keywords, or vessel terms in their recorded titles. Ports and inland navigation are included. Topics identify research candidates. The dates describe enactment or the last reported amendment. An absent repeal flag supplies no evidence of present force.",
            "records": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ARCHIVE, help="Local complete FAOLEX ZIP cache")
    parser.add_argument("--countries", type=Path, default=DATA / "countries.json", help="Generated UN M49 directory")
    parser.add_argument("--refresh", action="store_true", help="Download the current FAOLEX complete archive")
    parser.add_argument("--checked-at", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    args = parser.parse_args()
    if not args.countries.exists():
        parser.error("Generate site/data/countries.json first, or supply --countries")
    if args.refresh or not args.archive.exists():
        download_archive(args.archive)
    bundle = assemble(args.archive, args.countries, args.checked_at.isoformat())
    DATA.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=DATA, encoding="utf-8", newline="\n", delete=False) as out:
        temp = Path(out.name)
        try:
            json.dump(bundle, out, ensure_ascii=False, separators=(",", ":"))
            out.write("\n")
        except BaseException:
            out.close()
            temp.unlink()
            raise
    os.replace(temp, DATA / "world-laws.json")
    print(json.dumps({k: v for k, v in bundle["coverage"].items() if k != "byCountry"}))


if __name__ == "__main__":
    main()
