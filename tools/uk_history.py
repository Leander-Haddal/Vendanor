"""Index publisher-enumerated UK maritime legislation and its point-in-time editions."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
HOST = "www.legislation.gov.uk"
ATOM = "{http://www.w3.org/2005/Atom}"
TERMS = ("merchant shipping", "fishing vessels", "marine navigation", "safety at sea", "shipping and maritime")
DOMESTIC = {"ukpga", "uksi", "ukla", "ukppa", "ukmo", "asp", "ssi", "wsi", "asc", "anaw", "nisr", "nisi", "apni", "aep", "aosp", "apgb", "aip", "mwa", "ukmd", "uksro", "ukcm", "ukdsi"}


def official(raw):
    parts = urlsplit(raw or "")
    return "https://" + HOST + parts.path + ("?" + parts.query if parts.query else "") if parts.hostname == HOST else ""


def fetch_xml(url, cache, refresh):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = cache / (key + ".xml")
    if path.exists() and not refresh:
        return ET.fromstring(path.read_bytes())
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": "ShipLawIndex/1.0 public legal source reader", "Accept": "application/xml, application/atom+xml, */*"}), timeout=45) as response:
                data = response.read(16_000_001)
            if len(data) > 16_000_000:
                raise ValueError("Unexpectedly large legislation response.")
            root = ET.fromstring(data)
            if root.tag.rsplit("}", 1)[-1] not in {"feed", "Legislation"}:
                raise ValueError("Unexpected legislation response.")
            path.write_bytes(data)
            return root
        except HTTPError as error:
            if error.code in {404, 410, 300}:
                return None
            if error.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise
            delay = error.headers.get("Retry-After", "")
            time.sleep(min(90, int(delay)) if delay.isdigit() else 3 * (attempt + 1))
        except (OSError, ET.ParseError) as error:
            if attempt == 3:
                raise ValueError("Could not read official UK feed " + url) from error
            time.sleep(2 * (attempt + 1))


def entry_record(entry):
    uri = official(entry.findtext(ATOM + "id"))
    ident = urlsplit(uri).path.removeprefix("/id/").strip("/")
    if ident.split("/")[0] not in DOMESTIC or not re.fullmatch(r"[a-z]+/[A-Za-z0-9/.-]+", ident):
        return None
    canonical = "https://" + HOST + "/" + ident
    title = " ".join("".join(entry.find(ATOM + "title").itertext()).split())
    year = next((n.get("Value") for n in entry if n.tag.endswith("}Year")), "")
    pdfs = [n for n in entry.findall(ATOM + "link") if n.get("type") == "application/pdf" and "explanatory" not in (n.get("title") or "").lower()]
    original = next((n for n in pdfs if n.get("title") == "Original PDF"), None)
    picked = original if original is not None else next(iter(pdfs), None)
    return {"id": ident, "title": title, "year": year, "sourceUrl": canonical, "pdfUrl": official(picked.get("href")) if picked is not None else "", "pdfKind": "Original publication PDF" if original is not None else "Publisher PDF"}


def list_instruments(cache, refresh):
    records = {}
    for term in TERMS:
        url = "https://" + HOST + "/search/data.feed?" + urlencode({"title": term, "results-count": 200})
        seen = set()
        while url:
            if url in seen:
                raise ValueError("Pagination loop in " + term)
            seen.add(url)
            feed = fetch_xml(url, cache, refresh)
            if feed is None:
                if len(seen) > 1: raise ValueError("Missing search results page.")
                break
            for entry in feed.findall(ATOM + "entry"):
                record = entry_record(entry)
                if record: records.setdefault(record["id"], record)
            url = next((official(n.get("href")) for n in feed.findall(ATOM + "link") if n.get("rel") == "next"), "")
        print(term, len(records), flush=True)
    if not records:
        raise ValueError("The publisher returned no domestic legislation.")
    return sorted(records.values(), key=lambda r: r["id"])


def index_versions(record, cache, refresh):
    body = fetch_xml(record["sourceUrl"] + "/contents/data.xml", cache, refresh)
    versions = {}
    if body is not None:
        self_edition = ""
        for link in body.iter(ATOM + "link"):
            rel = link.get("rel")
            if rel not in {"self","http://purl.org/dc/terms/hasVersion","http://purl.org/dc/terms/tableOfContents"}: continue
            url = official(link.get("href"))
            if rel == "self": url = url.removesuffix("/data.xml")
            if not url.startswith(record["sourceUrl"]+"/contents/"): continue
            label = link.get("title", "") if rel.endswith("hasVersion") else url.rsplit("/", 1)[-1]
            if re.fullmatch(r"made|enacted|adopted|\d{4}-\d{2}-\d{2}", label) and url.endswith("/"+label):
                versions[label] = {"label": label, "url": url}
                if rel == "self": self_edition = label
        original = next((official(n.get("URI")) for n in body.iter() if n.tag.endswith("}Alternative") and not n.get("Title") and "/pdfs/" in (n.get("URI") or "") and (n.get("URI") or "").endswith(".pdf")), "")
        if original:
            record["pdfUrl"], record["pdfKind"] = original, "Original publication PDF"
        if self_edition and body.get("NumberOfProvisions") == "0" and record["pdfUrl"]:
            versions[self_edition].update(format="pdf",pdfUrl=record["pdfUrl"])
    record["versions"] = sorted(versions.values(),key=lambda v:(v["label"][0].isdigit(),v["label"]))
    return record


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--cache", type=Path, default=ROOT / ".work" / "uk-history")
    cli.add_argument("--refresh", action="store_true", help="Recheck cached source documents.")
    args = cli.parse_args()
    args.cache.mkdir(exist_ok=True, parents=True)
    records = list_instruments(args.cache, args.refresh)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for count, _ in enumerate(pool.map(lambda r: index_versions(r, args.cache, args.refresh), records), 1):
            if count % 100 == 0: print("Edition timelines", count, "of", len(records), flush=True)
    payload = {"schemaVersion": 1, "source": "The National Archives · legislation.gov.uk",
        "sourceUrl": "https://www.legislation.gov.uk/", "checkedAt": str(date.today()), "terms": list(TERMS),
        "licence": "Open Government Licence v3.0", "records": records}
    path = ROOT / "site" / "data" / "uk-history.json"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=path.parent, delete=False) as out:
        json.dump(payload, out, ensure_ascii=False, separators=(",", ":")); out.write("\n")
    os.replace(out.name, path)
    print(len(records), "UK instruments;", sum(len(r["versions"]) for r in records), "publisher edition links.", flush=True)


if __name__ == "__main__":
    main()
