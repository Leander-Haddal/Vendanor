"""Read domestic editions identified by a statutory citation in the FAOLEX record."""
import gzip
import hashlib
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

import requests

from national_extract import atomic_bytes
from national_texts import backoff

CACHE = Path(__file__).resolve().parents[1] / '.work/domestic-editions'
SPANISH = 'https://www.boe.es/datosabiertos/api/legislacion-consolidada'


def content(url, download, accept='*/*'):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.gz')
    if path.is_file():
        return gzip.decompress(path.read_bytes())
    cooldown = CACHE / (urlsplit(url).hostname + '-retry-after')
    if not download or (cooldown.exists() and time.time() < float(cooldown.read_text())):
        return None
    try:
        with requests.get(url, headers={'Accept':accept}, timeout=(5, 45), stream=True) as response:
            if response.status_code == 429:
                cooldown.write_text(str(time.time() + backoff(response.headers.get('Retry-After'))))
            if response.status_code != 200:
                return None
            data = bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data) > 75_000_000:
                    return None
        atomic_bytes(path, gzip.compress(data, compresslevel=5, mtime=0))
        return bytes(data)
    except requests.RequestException:
        return None


def wording(node):
    return ' '.join(' '.join(node.itertext()).split())


def canadian(record, download):
    match = re.search(r'\b(?:SOR[/ -]|DORS/|Statutory Orders and Regulations )(\d{2,4})-(\d+)\b',
                      record['title'] + ' ' + record.get('originalTitle', ''), re.I)
    if not match:
        return
    number = 'SOR-' + match[1] + '-' + match[2]
    base = 'https://laws.justice.gc.ca/eng/regulations/' + number + '/'
    raw = content('https://laws.justice.gc.ca/eng/XML/' + number + '.xml', download)
    if not raw:
        return
    root = ET.fromstring(raw)
    if root.findtext('Identification/InstrumentNumber', '').replace('/', '-') != number:
        return
    stamp = root.get('{http://justice.gc.ca/lims}current-date', '')
    rows = []
    for part in root.findall('Body//Section'):
        label = part.findtext('Label', '')
        if label:
            rows.append(['Section ' + label, wording(part), base + 'FullText.html'])
    for part in root.findall('Schedule'):
        rows.append([part.findtext('Label') or 'Schedule', wording(part), base + 'FullText.html'])
    if rows:
        return {'sourceUrl':base,'label':'Justice Canada consolidation · ' + number,
                'editionDate':stamp,'pdfUrl':'https://laws.justice.gc.ca/PDF/' + number + '.pdf'}, rows


class IrishInstrument(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.paragraph = None
        self.lines = []

    def handle_starttag(self, tag, attrs):
        if tag == 'div' and (self.depth or dict(attrs).get('id') == 'act'):
            self.depth += 1
        if self.depth and tag == 'p':
            self.handle_endtag('p')
            self.paragraph = []
        if self.paragraph is not None and tag == 'br':
            self.paragraph.append(' ')

    def handle_endtag(self, tag):
        if self.depth and tag == 'div':
            self.depth -= 1
        if tag == 'p' and self.paragraph is not None:
            line = ' '.join(''.join(self.paragraph).split())
            if line:
                self.lines.append(line)
            self.paragraph = None

    def handle_data(self, data):
        if self.paragraph is not None:
            self.paragraph.append(data)


def irish(record, download):
    match = re.search(r'\bS\.?\s*I\.?\s*(?:No\.?\s*)?(\d+)\s*(?:of\s+|/)(\d{4})\b',record['title'],re.I)
    if not match:
        return
    url = 'https://www.irishstatutebook.ie/eli/' + match[2] + '/si/' + str(int(match[1])) + '/made/en/print'
    raw = content(url, download)
    if not raw:
        return
    parser = IrishInstrument()
    parser.feed(raw.decode('utf-8', errors='replace'))
    rows = []
    for line in parser.lines:
        heading = re.match(r'^(\d+[A-Z]?)\.\s+', line)
        if heading:
            rows.append(['Regulation ' + heading[1], line, url])
        elif re.fullmatch(r'(?:SCHEDULE|EXPLANATORY NOTE).{0,30}',line, re.I) or not rows:
            rows.append([line[:65], line, url])
        else:
            rows[-1][1] += '\n' + line
    if any(r[0].startswith('Regulation ') for r in rows):
        return {'sourceUrl':url,'label':'Irish Statute Book · S.I. ' + match[1] + '/' + match[2] + ' as made',
                'editionDate':record.get('issuedDate','')}, rows


def spanish_catalogue(download):
    raw = content(SPANISH + '?limit=-1', download, 'application/xml')
    index = defaultdict(list)
    if raw:
        for item in ET.fromstring(raw).findall('data/item'):
            key = (item.findtext('rango','').casefold(), item.findtext('numero_oficial','').casefold(),
                   item.findtext('fecha_disposicion',''))
            index[key].append((item.findtext('identificador'),item.findtext('url_html_consolidada')))
    return index


def spanish(record, download, index):
    match = re.match(r'(Real Decreto Legislativo|Real Decreto[- ]ley|Real Decreto|Ley Orgánica|Ley|Orden)\s+'
        r'(?:N[º°o.]?\s*)?((?:[A-Z]+/)?\d+/\d{4})\b', record['title'], re.I)
    if not match:
        return
    key = (match[1].casefold().replace('decreto ley','decreto-ley'),match[2].casefold(),record.get('issuedDate','').replace('-',''))
    hits = index.get(key,[])
    if len(hits) != 1:
        return
    identifier, url = hits[0]
    raw = content(SPANISH + '/id/' + identifier + '/texto', download, 'application/xml')
    if not raw:
        return
    rows = []
    dates = []
    today = date.today().strftime('%Y%m%d')
    for block in ET.fromstring(raw).findall('.//bloque'):
        editions = [v for v in block.findall('version') if v.get('fecha_publicacion','') <= today
                    and (v.get('fecha_vigencia') or v.get('fecha_publicacion','')) <= today]
        if not editions:
            continue
        version = max(editions, key=lambda v:(v.get('fecha_vigencia') or v.get('fecha_publicacion',''),v.get('fecha_publicacion','')))
        text = '\n'.join(wording(p) for p in version if wording(p))
        if text:
            dates.append(version.get('fecha_publicacion',''))
            rows.append([block.get('titulo') or block.get('id'),text,url + '#' + block.get('id')])
    if rows:
        stamp=max(dates)
        return {'sourceUrl':url,'label':'Boletín Oficial del Estado · ' + identifier,
                'editionDate':stamp[:4]+'-'+stamp[4:6]+'-'+stamp[6:8] if len(stamp)==8 else ''},rows


def domestic_editions(records, download):
    spanish_index = spanish_catalogue(download)
    for record in records:
        try:
            code = record['country']
            if code == 'IE':
                result = irish(record, download)
            elif code == 'CA':
                result = canadian(record, download)
            elif code == 'ES':
                result = spanish(record, download, spanish_index)
            else:
                continue
        except ET.ParseError:
            continue
        if result:
            yield record['id'], result
