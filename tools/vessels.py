"""Build the Norwegian vessel-particulars snapshot using only the fartoy.csv tar member."""

import csv
import hashlib
import io
import json
import os
import re
import tarfile
import tempfile
from datetime import timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen


ARCHIVE = "https://register.fiskeridir.no/fartoyreg/last/frtyweb.tar"
GUIDE = "https://www.fiskeridir.no/registre/fartoyregisteret/uttrekk-fra-fartoyregisteret"
LICENSE = "https://www.fiskeridir.no/statistikk-tall-og-analyse/lisens-for-bruk-av-fiskeridirektoratets-data"
SCOPE = "https://www.fiskeridir.no/yrkesfiske/j-meldinger/j-252-2025"
DEST = Path(__file__).resolve().parents[1] / "site" / "data" / "vessels-no.json"


def read_range(offset, length, modified):
    end = offset + length - 1
    headers = {"Range": f"bytes={offset}-{end}", "User-Agent": "Ship Law Index/1.0"}
    if modified:
        headers["If-Range"] = modified
    with urlopen(Request(ARCHIVE, headers=headers), timeout=40) as response:
        if response.status != 206 or not re.fullmatch(rf"bytes {offset}-{end}/\d+", response.headers.get("Content-Range", "")):
            raise ValueError("The registry did not return the requested byte range")
        stamp = response.headers.get("Last-Modified")
        data = response.read(length + 1)
        if not stamp or (modified and stamp != modified) or len(data) != length:
            raise ValueError("The source archive changed while reading the vessel CSV")
        return data, stamp


def vessel_member():
    # Only fetch tar headers and the identified vessel records. The public archive
    # also contains administrative files, whose payloads are skipped by offset.
    offset, modified = 0, None
    for _ in range(64):
        header, modified = read_range(offset, 512, modified)
        if header == bytes(512):
            break
        member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
        if member.isfile() and PurePosixPath(member.name).name.casefold() == "fartoy.csv":
            if not 20_000 < member.size < 4_000_000:
                raise ValueError("Unexpected vessel CSV size")
            return read_range(offset + 512, member.size, modified)
        offset += 512 + ((member.size + 511) // 512) * 512
    raise ValueError("The public archive has no vessel CSV")


def positive(raw):
    if not raw:
        return None
    value = float(raw.replace(",", "."))
    if not 0 < value < 1_000_000:
        return None
    return int(value) if value.is_integer() else value


def build_index(data, modified):
    stamp = parsedate_to_datetime(modified)
    # The Directorate describes each nightly publication as the preceding day's active register.
    as_of = stamp.date() - timedelta(days=1)
    stream = io.StringIO(data.decode("utf-8-sig"), newline="")
    dialect = csv.Sniffer().sniff(stream.readline(), delimiters=",;")
    stream.seek(0)
    reader = csv.DictReader(stream, dialect=dialect)
    rows = []
    seen = set()
    for raw in reader:
        row = {k.casefold(): (v or "").strip() for k, v in raw.items()}
        identifier, name = row["fartoy_id"], row["navn"]
        if not re.fullmatch(r"\d{10}", identifier) or not name or identifier in seen:
            raise ValueError("Invalid or duplicate Norwegian vessel identity")
        seen.add(identifier)
        year = row["bygget_aar"]
        if not re.fullmatch(r"(?:18|19|20)\d{2}", year) or year > str(as_of.year):
            year = None
        rows.append([identifier, name, row["registreringsmerke"], row["radiokallesignal"],
                     positive(row["stoerste_lengde"]), positive(row["bruttotonnasje_1969"]), year])
    if len(rows) < 1000:
        raise ValueError("Incomplete Norwegian active vessel register")
    return {"version": 1, "publisher": "Norwegian Directorate of Fisheries", "asOf": as_of.isoformat(),
            "publishedAt": stamp.isoformat(), "download": ARCHIVE, "member": "fartoy.csv",
            "memberSha256": hashlib.sha256(data).hexdigest(), "documentation": GUIDE, "scopeUrl": SCOPE,
            "license": "Norwegian Licence for Open Government Data (NLOD)", "licenseUrl": LICENSE,
            "fields": ["id", "name", "registrationMark", "callSign", "lengthOverallMetres", "grossTonnage1969", "buildYear"],
            "rows": sorted(rows, key=lambda item: (item[1], item[0]))}


def main():
    snapshot = build_index(*vessel_member())
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=DEST.parent, delete=False) as out:
        tmp = Path(out.name)
        try:
            json.dump(snapshot, out, ensure_ascii=False, separators=(",", ":"))
            out.write("\n")
        except BaseException:
            out.close()
            tmp.unlink()
            raise
    os.replace(tmp, DEST)
    print(f"{len(snapshot['rows']):,} active Norwegian fishing vessels as of {snapshot['asOf']}")


if __name__ == "__main__":
    main()
