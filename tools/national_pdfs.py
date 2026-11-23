"""Recover missing national wording from the text layer of the catalogue's original PDFs."""
import concurrent.futures
import gzip
import hashlib
import json
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests

from national_extract import atomic_bytes, build, readable, write
from national_texts import CACHE, COOLDOWN, DATA, LIMIT, backoff

PAUSE=threading.Event()


def source_pair(record):
    def name(url):
        return Path(unquote(urlsplit(url).path)).stem.casefold()
    urls=[record.get('pdfUrl',''),*record.get('documentUrls',[])]
    pdfs={name(u):u for u in urls if urlsplit(u).hostname=='faolex.fao.org' and u.lower().endswith('.pdf')}
    for source in record['textUrls']:
        if name(source) in pdfs:
            yield source,pdfs[name(source)]


def recover(item):
    source,url,languages=item
    if PAUSE.is_set():
        return source,{}
    try:
        with requests.get(url,stream=True,timeout=(6,35)) as response:
            if response.status_code==429:
                PAUSE.set()
                return source,{'url':url,'state':'publisher rate limit','retry':time.time()+backoff(response.headers.get('Retry-After'))}
            if response.status_code!=200:
                return source,{'url':url,'state':'HTTP '+str(response.status_code)}
            raw=bytearray()
            for block in response.iter_content(65536):
                raw.extend(block)
                if len(raw)>LIMIT:
                    return source,{'url':url,'state':'size limit'}
        if not raw.startswith(b'%PDF-'):
            return source,{'url':url,'state':'no PDF'}
        result=subprocess.run(['pdftotext','-enc','UTF-8','-','-'],input=raw,capture_output=True,timeout=60)
        text=result.stdout.decode('utf-8',errors='replace')
        if result.returncode or not readable(text,languages):
            return source,{'url':url,'state':'no usable text layer'}
        path=CACHE/(hashlib.sha256(source.encode()).hexdigest()+'.pdf-text.gz')
        atomic_bytes(path,gzip.compress(result.stdout,mtime=0))
        return source,{'url':url,'state':'text','pages':len(text.removesuffix('\f').split('\f'))}
    except (requests.RequestException,subprocess.TimeoutExpired):
        return source,{'url':url,'state':'source unavailable'}


def main():
    records=json.loads((DATA/'world-laws.json').read_text(encoding='utf-8'))['records']
    previous={}
    for path in (DATA/'national').glob('*.json'):
        previous.update(json.loads(path.read_text(encoding='utf-8')))
    manifest=CACHE/'pdf-outcomes.json'
    responses=json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    jobs={}
    for r in records:
        docs={d.get('source'):d for d in previous.get(r['id'],{}).get('documents',[])}
        for source,url in source_pair(r):
            old=responses.get(source,{})
            if docs.get(source,{}).get('state')=='text' or (old.get('url')==url and old.get('state') in ('text','no usable text layer','HTTP 403','HTTP 404','HTTP 410','no PDF')):
                continue
            jobs[source]=(source,url,r.get('languages',[]))
    if COOLDOWN.exists() and float(COOLDOWN.read_text())>time.time():
        print('FAOLEX requested a waiting period. Existing editions have been retained.')
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures=[pool.submit(recover,item) for item in jobs.values()]
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            key,result=future.result()
            if result:
                responses[key]=result
            if result.get('retry'):
                old=float(COOLDOWN.read_text()) if COOLDOWN.is_file() else 0
                COOLDOWN.write_text(str(max(old,result['retry'])))
            if i%100==0:
                write(manifest,responses)
    write(manifest,responses)
    status={}
    log=CACHE/'responses.jsonl'
    if log.exists():
        for line in log.read_text(encoding='utf-8').splitlines():
            url,state=json.loads(line);status[url]=state
    build(DATA,CACHE,records,status)


if __name__=='__main__':
    main()
