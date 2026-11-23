"""Build the UN country/area directory and link published maritime flag-state evidence."""

import argparse
from datetime import date
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen


M49 = "https://unstats.un.org/unsd/methodology/m49/overview/"
NORMLEX = "https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:"
MLC_INDEX = NORMLEX + "80020:0::NO:::"

# Names present in the published MLC implementation index, joined to ILO's country IDs.
# Each ID was checked against an ILO MLC profile or the ILO's named ratifications record.
PUBLISHED_PROFILES = {
    "Albania": 102532,
    "Algeria": 102908,
    "Angola": 102999,
    "Antigua and Barbuda": 103369,
    "Argentina": 102536,
    "Australia": 102544,
    "Bahamas": 103215,
    "Bangladesh": 103500,
    "Barbados": 103218,
    "Belgium": 102560,
    "Belize": 103222,
    "Benin": 103028,
    "Bermuda": 103636,
    "Bosnia and Herzegovina": 102704,
    "Brazil": 102571,
    "British Virgin Islands": 103651,
    "Bulgaria": 102576,
    "Cabo Verde": 103096,
    "Canada": 102582,
    "Cayman Islands": 1495700,
    "Chile": 102588,
    "China": 103404,
    "China - Hong Kong Special Administrative Region": 103578,
    "Comoros": 103360,
    "Congo": 103376,
    "Cook Islands": 103291,
    "Croatia": 102700,
    "Cuba": 102603,
    "Curaçao": 1575903,
    "Cyprus": 103070,
    "Denmark": 102609,
    "Djibouti": 103044,
    "Ecuador": 102616,
    "Egypt": 102915,
    "Estonia": 102620,
    "Ethiopia": 102950,
    "Falkland Islands (Malvinas)": 103639,
    "Faroe Islands": 103698,
    "Fiji": 103278,
    "Finland": 102625,
    "France": 102632,
    "Gabon": 103391,
    "Gambia": 103226,
    "Georgia": 102639,
    "Germany": 102643,
    "Ghana": 103231,
    "Gibraltar": 103629,
    "Greece": 102658,
    "Grenada": 103320,
    "Guinea-Bissau": 103065,
    "Honduras": 102675,
    "Hungary": 102679,
    "Iceland": 102685,
    "India": 102691,
    "Indonesia": 102938,
    "Iran (Islamic Republic of)": 102800,
    "Iraq": 102974,
    "Ireland": 102901,
    "Isle of Man": 103643,
    "Italy": 102709,
    "Jamaica": 103236,
    "Japan": 102729,
    "Jordan": 103201,
    "Kenya": 103315,
    "Kiribati": 103504,
    "Latvia": 102738,
    "Lebanon": 103147,
    "Liberia": 102742,
    "Lithuania": 102752,
    "Luxembourg": 102757,
    "Madagascar": 102955,
    "Malaysia": 102960,
    "Maldives": 103365,
    "Malta": 103111,
    "Marshall Islands": 103414,
    "Mauritius": 103106,
    "Mongolia": 103142,
    "Montenegro": 102734,
    "Morocco": 102993,
    "Mozambique": 102964,
    "Myanmar": 103159,
    "Netherlands (Kingdom of the)": 102768,
    "New Caledonia": 103684,
    "New Zealand": 102775,
    "Nicaragua": 102780,
    "Nigeria": 103259,
    "Norway": 102785,
    "Oman": 103441,
    "Pakistan": 103166,
    "Palau": 2466492,
    "Panama": 102792,
    "Philippines": 102970,
    "Poland": 102809,
    "Portugal": 102815,
    "Republic of Korea": 103123,
    "Romania": 102824,
    "Russian Federation": 102884,
    "Saint Kitts and Nevis": 103373,
    "Saint Vincent and the Grenadines": 103333,
    "Samoa": 103295,
    "San Marino": 102829,
    "Senegal": 103013,
    "Serbia": 102839,
    "Seychelles": 103090,
    "Sierra Leone": 103269,
    "Singapore": 103163,
    "Slovakia": 102717,
    "Slovenia": 103533,
    "Solomon Islands": 103193,
    "South Africa": 102888,
    "Spain": 102847,
    "Sri Lanka": 103172,
    "Sudan": 103176,
    "Sweden": 102854,
    "Switzerland": 102861,
    "Syrian Arab Republic": 102923,
    "Thailand": 102843,
    "Togo": 103050,
    "Tokelau": 103617,
    "Tunisia": 102986,
    "Tuvalu": 103508,
    "United Kingdom of Great Britain and Northern Ireland": 102651,
    "United Republic of Tanzania": 103476,
    "Viet Nam": 103004,
}
ALIASES = {"China - Hong Kong Special Administrative Region": "HK"}

# Independently reviewed lists of flag-state delegations; retain the remit of each source.
class M49Table(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = False
        self.row = None
        self.cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "table" and dict(attrs).get("id") == "downloadTableEN":
            self.active = True
        if self.active and tag == "tr":
            self.row = []
        if self.row is not None and tag in {"td", "th"}:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        if tag == "table" and self.active:
            self.active = False


class ProfileLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.href = None
        self.label = []
        self.profiles = {}

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_data(self, data):
        if self.href:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag != "a" or not self.href:
            return
        u = urlsplit(urljoin(MLC_INDEX, self.href))
        self.href = None
        if u.hostname not in {"normlex.ilo.org", "www.ilo.org", "wwwex.ilo.org"}:
            return
        args = parse_qs(u.query).get("p", [""])[0].split(":")
        if len(args) < 8 or args[1] != "80021":
            return
        keys = dict(zip(args[6].split(","), args[7].split(",")))
        country = " ".join("".join(self.label).split()).rstrip(" *")
        id_value = keys.get("P80021_COUNTRY_ID", "")
        if country and id_value.isdecimal():
            self.profiles[country] = int(id_value)
        elif country and re.fullmatch(r"[A-Z]{3}", keys.get("P80021_ISO_CODE", "")):
            self.profiles[country] = keys["P80021_ISO_CODE"]


def read_source(url, path):
    if path:
        return path.read_text("utf-8-sig")
    with urlopen(Request(url, headers={"User-Agent": "MaritimeSourceDirectory/1.0"}), timeout=60) as response:
        data = response.read(9_000_001)
    if len(data) > 9_000_000:
        raise ValueError("Unexpected source size: " + url)
    return data.decode("utf-8-sig")


def country_rows(markup):
    table = M49Table()
    table.feed(markup)
    if not table.rows:
        raise ValueError("Missing UN M49 English table.")
    header, *rows = table.rows
    indices = [header.index(c) for c in ("Country or Area", "M49 Code", "ISO-alpha2 Code", "ISO-alpha3 Code")]
    countries = {}
    for row in rows:
        name, m49, code, alpha3 = [row[i] for i in indices]
        if not name or not (re.fullmatch(r"[A-Z]{2}", code) and re.fullmatch(r"[A-Z]{3}", alpha3) and re.fullmatch(r"\d{3}", m49)):
            raise ValueError(f"Invalid UN row: {row}")
        if code in countries:
            raise ValueError("Duplicate UN code: " + code)
        countries[code] = {"code": code, "alpha3": alpha3, "m49": m49, "name": name}
    if len({c["m49"] for c in countries.values()}) != len(countries):
        raise ValueError("UN numeric identifiers must be unique.")
    return countries


def name_key(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if c.isalnum())


def compile_directory(countries, profile_ids, checked_on):
    by_name = {name_key(c["name"]): c["code"] for c in countries.values()}
    for label, key in profile_ids.items():
        code = ALIASES.get(label) or by_name.get(name_key(label))
        if code not in countries:
            raise ValueError("Unmapped ILO country or territory: " + label)
        field = "COUNTRY_ID" if isinstance(key, int) else "ISO_CODE"
        entry = countries[code]
        if "profileUrl" in entry:
            raise ValueError("Duplicate ILO profile mapping: " + code)
        entry["profileUrl"] = NORMLEX + f"80021:0::NO::P80021_{field}:{key}"
    result = sorted(countries.values(), key=lambda r: (name_key(r["name"]), r["code"]))
    coverage = {"countryCount": len(result), "profileCount": sum("profileUrl" in r for r in result),
                "profileIndexCheckedOn": checked_on, "scope": "UN statistical countries and areas with ILO implementation profiles."}
    return {"schemaVersion": 1, "source": {"name": "United Nations Statistics Division and ILO NORMLEX",
            "url": M49, "mlcIndexUrl": MLC_INDEX}, "coverage": coverage, "countries": result}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "site/data/countries.json")
    cli.add_argument("--m49-file", type=Path, help="Use a locally saved official M49 overview page.")
    mode = cli.add_mutually_exclusive_group()
    mode.add_argument("--mlc-index", type=Path, help="Use the publisher's saved MLC implementation index HTML.")
    mode.add_argument("--refresh-mlc", action="store_true", help="Fetch the named ILO index where automated access is available.")
    cli.add_argument("--index-date", type=date.fromisoformat, help="Publication/check date of a supplied MLC index.")
    args = cli.parse_args()
    countries = country_rows(read_source(M49, args.m49_file))
    profiles, checked = PUBLISHED_PROFILES, "2026-11-23"
    if args.mlc_index or args.refresh_mlc:
        links = ProfileLinks()
        links.feed(read_source(MLC_INDEX, args.mlc_index))
        if not links.profiles:
            raise ValueError("No country profile links found in the supplied ILO index.")
        profiles = links.profiles
        checked = str(args.index_date or date.today()) if args.refresh_mlc or args.index_date else None
    payload = json.dumps(compile_directory(countries, profiles, checked), ensure_ascii=False, indent=2) + "\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=args.out.parent, delete=False) as output:
        output.write(payload)
    os.replace(output.name, args.out)
    print(f"Published {len(countries)} UN countries/areas and {len(profiles)} ILO implementation profiles.")


if __name__ == "__main__":
    main()
