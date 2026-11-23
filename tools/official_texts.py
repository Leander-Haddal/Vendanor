"""Inventory provision text and extract reviewable thresholds from the national publisher archives."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from html.parser import HTMLParser

import requests

from national_extract import extract, write, atomic_bytes
from national_texts import backoff

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site/data'
CACHE = ROOT / '.work/official-text'
RATE_LOCK=threading.Lock()


class EurLex(HTMLParser):
    def __init__(self):
        super().__init__()
        self.lines = []
        self.current = []
        self.body = False

    def handle_starttag(self,tag,attrs):
        if tag=='body':
            self.body=True
        if self.body and tag=='br':
            self.handle_endtag('p')

    def handle_data(self, data):
        if self.body:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag in ('p','div','td','li','h1','h2'):
            line = ' '.join(''.join(self.current).split())
            if line:
                self.lines.append(line)
            self.current = []
        if tag=='body':
            self.body=False

    def sections(self):
        sections=[]
        title='Published text'
        lines=[]
        for line in self.lines:
            if re.fullmatch(r'(?:Article\s+\d+[a-z]?|ANNEX(?:\s+[IVX\d]+)?|CHAPTER\s+[IVX\d]+)',line,re.I):
                if lines:
                    sections.append((str(len(sections)+1),title+'\n'+'\n'.join(lines)))
                title=line
                lines=[]
            else:
                lines.append(line)
        if lines:
            sections.append((str(len(sections)+1),title+'\n'+'\n'.join(lines)))
        return sections


def acquire(item, download):
    key,url,kind = item
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest()+'.gz')
    if not path.exists() and download:
        cooldown=CACHE/(kind+'-retry-after')
        with RATE_LOCK:
            if cooldown.exists() and float(cooldown.read_text())>time.time():
                return key,{'state':'publisher rate limit','source':url}
        try:
            headers={'Accept':'application/xhtml+xml,text/html;q=0.9','Accept-Language':'eng'} if kind=='eu' else {}
            with requests.get(url, headers=headers, timeout=(5,20), stream=True) as response:
                if response.status_code==429:
                    with RATE_LOCK:
                        cooldown.write_text(str(time.time()+backoff(response.headers.get('Retry-After'))))
                if response.status_code != 200:
                    return key, {'state':'HTTP '+str(response.status_code), 'source':url}
                data = bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data)>25_000_000:
                        return key, {'state':'size limit', 'source':url}
            atomic_bytes(path,gzip.compress(data,compresslevel=3,mtime=0))
        except requests.RequestException:
            return key, {'state':'source unavailable','source':url}
    if not path.exists():
        return key, {'state':'not retrieved','source':url}
    content=gzip.decompress(path.read_bytes())
    parts=[]
    if kind=='uk':
        try:
            root=ET.fromstring(content)
            def provisions(node):
                tag=node.tag.split('}')[-1]
                if tag in ('BlockAmendment','BlockExtract','ExplanatoryNotes','Versions','Resources'):
                    return
                if tag=='P1' and node.get('id'):
                    parts.append((node.get('id'),' '.join(' '.join(node.itertext()).split())))
                    return
                for child in node:
                    provisions(child)
            provisions(root)
        except ET.ParseError:
            pass
    elif any(marker in content for marker in (b'eli-container',b'oj-normal',b'class="norm',b'name="DC.title"')):
        parser=EurLex();parser.feed(content.decode('utf-8',errors='replace'))
        parts=parser.sections()
    record=from_sections(parts,url)
    if parts:
        record['wording']=parts
    return key, record


def from_sections(parts,url):
    hits=[dict(hit,section=section) for section,text in parts for hit in extract(text)]
    return {'state':'text' if parts else 'no provision text','source':url,'sections':len(parts),'thresholds':hits}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download',action='store_true')
    parser.add_argument('--eu-only',action='store_true');options=parser.parse_args()
    CACHE.mkdir(parents=True,exist_ok=True)
    def records(name):
        return json.loads((DATA/name).read_text(encoding='utf-8'))['records']
    manifest=DATA/'official-screening.json'
    results=json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    jobs=[]
    for r in records('uk-history.json'):
        version=next((v for v in reversed(r['versions']) if re.fullmatch(r'\d{4}-\d{2}-\d{2}',v['label'])),None)
        url=(version['url'].replace('/contents/','/') if version else r['sourceUrl'])+'/data.xml'
        jobs.append(('uk:'+r['id'],url,'uk'))
    for r in records('eu-history.json'):
        jobs.append(('eu:'+r['id'],'https://publications.europa.eu/resource/celex/'+r['id'],'eu'))
    shards={}
    for r in records('gazette.json'):
        shard=r['shard']
        if shard not in shards:
            shards[shard]={i['id']:i['sections'] for i in records(shard)}
        parts=shards[shard][r['id']]
        results[r['id']]=from_sections([(f'p{i}',s['text']) for i,s in enumerate(parts)],r['sourceUrl'])
    books={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(acquire,j,options.download and (not options.eu_only or j[2]=='eu')) for j in jobs]
        for index,future in enumerate(concurrent.futures.as_completed(futures),1):
            key,record=future.result()
            wording=record.pop('wording',None)
            if wording:
                bucket=hashlib.sha256(key.encode()).hexdigest()[:2]
                books.setdefault(bucket,{})[key]=wording
                record['wordingShard']=bucket
            previous=results.get(key,{})
            same_edition=previous.get('source')==record['source']
            archived=previous.get('wordingShard') and (DATA/'wording'/(previous['wordingShard']+'.json.gz')).is_file()
            if same_edition and record['state']!='text' and (archived or record['state']=='not retrieved'):
                continue
            results[key]=record
    dest=DATA/'wording';dest.mkdir(exist_ok=True)
    for bucket,items in books.items():
        path=dest/(bucket+'.json.gz')
        if path.exists():
            previous=json.loads(gzip.decompress(path.read_bytes()))
            previous.update(items);items=previous
        payload=json.dumps(items,ensure_ascii=False,separators=(',',':')).encode()
        atomic_bytes(path,gzip.compress(payload,compresslevel=7,mtime=0))
    keys={key for key,_,_ in jobs}|{r['id'] for r in records('gazette.json')}
    write(manifest,{k:v for k,v in results.items() if k in keys})
    print(len(results),'national, UK and EU publisher records;',sum(r.get('sections',0) for r in results.values()),'provisions.')


if __name__=='__main__':
    main()
