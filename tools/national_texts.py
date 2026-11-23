"""Build the national source-text inventory from the public FAOLEX text renditions."""
import argparse
from collections import defaultdict,deque
import concurrent.futures
import gzip
import hashlib
import json
import re
import threading
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit

import requests
from national_extract import atomic_bytes


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'site/data'
CACHE = ROOT / '.work/national-text'
LOCAL = threading.local()
LIMIT = 30_000_000
PAUSED = threading.Event()
LOCK = threading.Lock()
COOLDOWN = CACHE / 'retry-after'


def backoff(value):
    try:
        return max(1,int(value))
    except (TypeError,ValueError):
        try:
            return max(1,int(parsedate_to_datetime(value).timestamp()-time.time()))
        except (TypeError,ValueError):
            return 3600


def fetch(url):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = CACHE / (key + '.gz')
    if path.exists():
        return url, 'read'
    if PAUSED.is_set():
        return url, 'publisher rate limit'
    if urlsplit(url).hostname != 'faolex.fao.org':
        return url, 'external'
    if not hasattr(LOCAL, 'session'):
        LOCAL.session = requests.Session()
        LOCAL.session.headers['User-Agent'] = 'ShipLawIndex/1.3 (public maritime source index)'
    for attempt in range(3):
        try:
            with LOCAL.session.get(url, timeout=(7, 35), stream=True) as response:
                if response.status_code == 429:
                    PAUSED.set()
                    until=time.time()+backoff(response.headers.get('Retry-After'))
                    with LOCK:
                        previous=float(COOLDOWN.read_text()) if COOLDOWN.exists() else 0
                        COOLDOWN.write_text(str(max(previous,until)))
                    return url, 'publisher rate limit'
                if response.status_code >= 500:
                    if PAUSED.wait(2**attempt):
                        return url, 'publisher rate limit'
                    continue
                if response.status_code != 200:
                    return url, 'HTTP ' + str(response.status_code)
                data = bytearray()
                for block in response.iter_content(65536):
                    data.extend(block)
                    if len(data) > LIMIT:
                        return url, 'size limit'
                if not data.strip() or re.search(rb'<(?:!doctype html|html|head)\b', data[:800], re.I):
                    return url, 'no text'
                atomic_bytes(path,gzip.compress(data, compresslevel=3, mtime=0))
                return url, 'read'
        except (requests.RequestException, ValueError):
            time.sleep(1 + attempt)
    return url, 'source unavailable'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    options = parser.parse_args()
    records = json.loads((DATA / 'world-laws.json').read_text(encoding='utf-8'))['records']
    countries=defaultdict(deque)
    for record in records:
        countries[record['country']].extend(record['textUrls'])
    ordered=[]
    while countries:
        for code,queue in list(countries.items()):
            ordered.append(queue.popleft())
            if not queue:
                del countries[code]
    urls=list(dict.fromkeys(ordered))
    CACHE.mkdir(parents=True, exist_ok=True)
    log = CACHE / 'responses.jsonl'
    status = {}
    if log.exists():
        for line in log.read_text().splitlines():
            url, state = json.loads(line)
            status[url] = state
    if options.download:
        if COOLDOWN.exists() and float(COOLDOWN.read_text())>time.time():
            PAUSED.set()
        # One bounded pool for the whole publisher, including multi-document records.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool, log.open('a', encoding='utf-8') as output:
            pending = {pool.submit(fetch, u) for u in urls if status.get(u) not in ('read', 'HTTP 403','HTTP 404', 'HTTP 410')}
            for number, future in enumerate(concurrent.futures.as_completed(pending), 1):
                url, state = future.result()
                status[url] = state
                output.write(json.dumps([url, state]) + '\n')
                output.flush()
                if number % 500 == 0:
                    print(f'{number} text links processed', flush=True)
    from national_extract import build
    build(DATA, CACHE, records, status)


if __name__ == '__main__':
    main()
