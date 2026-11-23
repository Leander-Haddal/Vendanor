"""Pin the registered treaty texts, UK navigation edition and Natural Earth outlines."""
import hashlib
import gzip
import json
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import requests
from national_extract import atomic_bytes

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site/data'
TREATIES = [
    ('marpol', '1340', 'A-22484', '1973 Convention and 1978 Protocol as registered'),
    ('stcw-1978', '1361', 'I-23001', '1978 Convention as registered'),
    ('load-lines-1966', '640', 'I-9159', '1966 Convention as registered'),
    ('solas-1974','1184','I-18961','1974 Convention as registered'),
    ('solas-1978-protocol','1226','I-18961','1978 Protocol as registered'),
    ('colreg-1972','1050','I-15824','1972 Convention and Regulations as registered'),
    ('tonnage-1969','1291','I-21264','1969 Convention as registered'),
    ('sar-1979','1405','I-23489','1979 Convention as registered'),
    ('fal-1965','591','I-8564','1965 Convention as registered'),
    ('clc-1969','973','I-14097','1969 Convention as registered'),
    ('oprc-1990','1891','I-32194','1990 Convention as registered'),
    ('intervention-1969','970','I-14049','1969 Convention as registered'),
    ('london-1972','1046','I-15749','1972 Convention as registered'),
    ('llmc-1976','1456','I-24635','1976 Convention as registered'),
    ('csc-1972','1064','I-16198','1972 Convention as registered'),
    ('pal-1974','1463','I-24817','1974 Convention as registered'),
    ('fund-1971','1110','I-17146','1971 Convention as registered'),
]
UN_PARTS={'bwm-2004':'55544-080000028053b465','afs-2001':'56215-080000028057e421','stcw-f-1995':'56216-080000028057dd97'}
PUBLICATIONS={'hong-kong-2009':('https://assets.publishing.service.gov.uk/media/6aede2ca3e39e22b607435ba/MS_12.2026_Hong_Kong_International_Convention_Recyling_Ships.pdf','2009 Convention · UK Miscellaneous Series 12 (2026)'),
              'sua-1988':('https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/ConferencesMeetings/SUAConferenceDocuments/SUA%20CONF%2015%20Rev.1.pdf','1988 adoption text · IMO SUA/CONF/15/Rev.1'),
              'bwm-2004':('https://assets.publishing.service.gov.uk/media/6720cf3c3ce5634f5f6ef3da/TS_84.2024_International_Convention_Control_Management_Ships_Ballast_Sediments_2004.pdf','2004 Convention as amended · UK Treaty Series 84 (2024)'),
              'afs-2001':('https://assets.publishing.service.gov.uk/media/5a7cabd5e5274a2f304ef5f5/8284.pdf','2001 Convention · UK Treaty Series 13 (2012)'),
              'nairobi-2007':('https://assets.publishing.service.gov.uk/media/5a8048b7ed915d74e33f988d/TS_30_2016_Cm_9315_Nairobi_WEB.pdf','2007 Convention · UK Treaty Series 30 (2016)'),
              'bunkers-2001':('https://assets.publishing.service.gov.uk/media/5a7b927240f0b645ba3c52f8/8489.pdf','2001 Convention · UK publication Cm 8489'),
              'salvage-1989':('https://treaties.un.org/doc/Publication/UNTS/Volume%201953/v1953.pdf#page=203','1989 Convention · English treaty text, UN Treaty Series 1953'),
              'stcw-f-1995':('https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/Revised%20annex%20of%20STCW-F%2095.pdf','Revised STCW-F annex · IMO adoption text'),
              'stcw-f-1995-stcw-f-code':('https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/STCW-F%20Code.pdf','STCW-F Code · IMO adoption text')}


def fetch(url, dest):
    if not dest.exists():
        response = requests.get(url, timeout=90)
        response.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.suffix=='.pdf' and not response.content.startswith(b'%PDF-'):
            raise ValueError('The publisher did not return the requested PDF: '+url)
        atomic_bytes(dest,response.content)
    return dest.read_bytes()


def write(name, value):
    (DATA / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def main():
    originals = {}
    pages = {}
    addresses={key:(f'https://treaties.un.org/doc/Publication/UNTS/Volume%20{vol}/volume-{vol}-{number}-English.pdf',label) for key,vol,number,label in TREATIES}
    transcript_dir=DATA/'treaty-pages';transcript_dir.mkdir(exist_ok=True)
    for key,(url,label) in (addresses|PUBLICATIONS).items():
        asset = {'solas-1974':'pdf/solas-1974-un.pdf','colreg-1972':'pdf/colreg-un.pdf'}.get(key,
                'pdf/treaties/'+key+('-edition' if key in UN_PARTS else '')+'.pdf')
        path=ROOT/'site'/asset
        if key=='salvage-1989' and not path.exists():
            volume=ROOT/'.work/unts-1953.pdf'
            fetch(url.split('#')[0],volume)
            with tempfile.TemporaryDirectory(dir=ROOT/'.work') as work:
                temp=Path(work)
                subprocess.run(['pdfseparate','-f','203','-l','218',str(volume),str(temp/'p-%d.pdf')],check=True)
                subprocess.run(['pdfunite',*[str(temp/f'p-{i}.pdf') for i in range(203,219)],str(temp/'english.pdf')],check=True)
                atomic_bytes(path,(temp/'english.pdf').read_bytes())
        raw = fetch(url,path)
        if not raw.startswith(b'%PDF-'):
            raise ValueError(f'Expected original PDF from {url}')
        originals[key] = dict(pdf=asset, sourceUrl=url, label=label, sha256=hashlib.sha256(raw).hexdigest())
        if key in UN_PARTS:
            number=UN_PARTS[key]
            originals[key]['alternates']=[{'label':'Original registered text · UN Treaty Series',
               'url':f'https://treaties.un.org/doc/Publication/UNTS/No%20Volume/{number.split("-")[0]}/Part/I-{number}.pdf'}]
        text = subprocess.run(['pdftotext','-layout','-enc','UTF-8',str(ROOT/'site'/asset),'-'],check=True,capture_output=True).stdout.decode('utf-8')
        by_page=[page.strip() for page in text.removesuffix('\f').split('\f')]
        passages={
            'hong-kong-2009':[('application',[7,8],'ARTICLE 3','ARTICLE 4')],
            'afs-2001':[('application',[6,7],'ARTICLE 3','ARTICLE 4'),
                ('surveys',[25],'(1) Ships of 400','(2) The survey'),
                ('declaration',[28],'(1) The Administration shall require a ship of 24','(2)')],
        }
        for section,numbers,start,end in passages.get(key,[]):
            body=' '.join(' '.join(by_page[p-1].split()) for p in numbers)
            offset=body.casefold().index(start.casefold())
            limit=body.casefold().find(end.casefold(),offset+len(start))
            originals[key].setdefault('passages',{})[section]={'text':body[offset:limit if limit>=0 else len(body)].strip(),'pages':numbers}
        if key in ('marpol','stcw-1978','load-lines-1966'):
            pages[key]=by_page
        else:
            originals[key]['pageFile']=key+'.json.gz'
            originals[key]['pageCount']=len(by_page)
            atomic_bytes(transcript_dir/(key+'.json.gz'),gzip.compress(json.dumps(by_page,ensure_ascii=False).encode('utf-8'),mtime=0))
    write('treaty-originals.json', originals)
    write('treaty-wording.json', pages)

    uk_url = 'https://www.legislation.gov.uk/uksi/2020/673/2025-12-12/data.xml'
    uk = ET.fromstring(fetch(uk_url, ROOT / '.work/uk-navigation-2025.xml'))
    parts = []
    for node in uk.findall('.//{*}P1'):
        if node.get('id') in ('regulation-3', 'regulation-4', 'regulation-5'):
            parts.append({'id': node.get('id'), 'text': ' '.join(' '.join(node.itertext()).split())})
    if len(parts) != 3:
        raise ValueError('Missing UK edition text')
    write('uk-navigation.json', {'edition':'2025-12-12', 'sourceUrl':uk_url, 'sections':parts})

    ca_url='https://laws.justice.gc.ca'
    ca_pdf='pdf/canada/SOR-2017-286.pdf'
    ca_bytes=fetch(ca_url+'/PDF/SOR-2017-286.pdf',ROOT/'site'/ca_pdf)
    ca_text=subprocess.run(['pdftotext','-layout','-enc','UTF-8',str(ROOT/'site'/ca_pdf),'-'],check=True,capture_output=True).stdout.decode('utf-8')
    ca_pages=ca_text.removesuffix('\f').split('\f')
    def printed_date(label):
        found=re.search(label+r'\s+([A-Za-z]+ \d{1,2}, \d{4})',ca_pages[0],re.I)
        if not found:
            raise ValueError('Missing date on the Canadian consolidation')
        return datetime.strptime(found[1],'%B %d, %Y').date().isoformat()
    verified=printed_date('Current to')
    amended=printed_date('Last amended on')
    ca_xml=ET.fromstring(fetch(ca_url+'/eng/XML/SOR-2017-286.xml',ROOT/'.work/ca-arctic.xml'))
    if ca_xml.get('{http://justice.gc.ca/lims}lastAmendedDate')!=amended:
        raise ValueError('The Canadian XML and PDF have different amendment dates')
    target=next(s for s in ca_xml.findall('Body/Section') if s.findtext('Label')=='6')
    page=next(i+1 for i,s in enumerate(ca_pages) if 'cargo vessels of 500 gross tonnage' in s)
    last=next(i+1 for i,s in enumerate(ca_pages) if 'does not apply to fishing vessels' in s)
    write('ca-arctic.json',{'pdf':ca_pdf,'sha256':hashlib.sha256(ca_bytes).hexdigest(),'pdfUrl':ca_url+'/PDF/SOR-2017-286.pdf',
          'sourceUrl':ca_url+'/eng/regulations/SOR-2017-286/','effectiveFrom':amended,'verifiedThrough':verified,
          'pages':list(range(page,last+1)),'text':' '.join(' '.join(target.itertext()).split())})

    geo = json.loads(fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson', ROOT / '.work/ne_110m_admin_0_countries.json'))
    shapes = []
    for feature in geo['features']:
        geometry, props = feature['geometry'], feature['properties']
        if props['ADMIN'] == 'Antarctica':
            continue
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        paths = []
        for rings in polygons:
            for ring in rings:
                points = [(round((x+180)*2,1), round((84-y)*2,1)) for x,y,*_ in ring]
                paths.append('M' + 'L'.join(f'{x:g},{y:g}' for x,y in points) + 'Z')
        shapes.append([props['ISO_A2_EH'], props['ADMIN'], ''.join(paths)])
    write('world-boundaries.json', shapes)


if __name__ == '__main__':
    main()
