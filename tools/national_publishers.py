"""Resolve national records to domestic publisher editions by their formal legal identifiers."""
import argparse
import bz2
import gzip
import json
import re
import tarfile
import tempfile
from collections import defaultdict
from pathlib import Path

from gazette import read_header, sections_from_xml
from national_extract import extract, write, atomic_bytes
from national_editions import domestic_editions

DATA=Path(__file__).resolve().parents[1]/'site/data'


def norwegian(r):
    original=r.get('originalTitle','')
    match=re.search(r'\b(FOR|LOV)[ -](\d{4}-\d{2}-\d{2})[ -]+(?:nr\.?\s*)?(\d+)\b',original,re.I)
    if match:
        return match[1].upper()+'-'+match[2]+'-'+str(int(match[3]))
    match=re.match(r'(Regulations?|Act|Law|Decree|Order) No\.\s*(\d+)\b',r['title'],re.I)
    date=r.get('issuedDate','')
    if match and re.fullmatch(r'\d{4}-\d\d-\d\d',date):
        return ('LOV' if match[1].lower() in ('act','law') else 'FOR')+'-'+date+'-'+str(int(match[2]))


def british(r):
    title=r['title']
    match=re.search(r'\bS\.?I\.?\s*(\d{4})\s*(?:No\.?\s*|/)(\d+)\b',title,re.I)
    if match:return 'uksi/'+match[1]+'/'+match[2]
    match=re.search(r'\bS\.?I\.?\s*No\.?\s*(\d+)\s+(?:of\s+)?(\d{4})\b',title,re.I)
    if match:return 'uksi/'+match[2]+'/'+match[1]
    match=re.search(r'\b(\d{4})\s*\(Chapter\s+(\d+)\)',title,re.I)
    if match:return 'ukpga/'+match[1]+'/'+match[2]
    return None


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download',action='store_true')
    options=parser.parse_args()
    records=json.loads((DATA/'world-laws.json').read_text(encoding='utf-8'))['records']
    uk={r['id']:r for r in json.loads((DATA/'uk-history.json').read_text(encoding='utf-8'))['records']}
    official=json.loads((DATA/'official-screening.json').read_text(encoding='utf-8'))
    matches={}
    wanted=defaultdict(list)
    dated=defaultdict(list)
    def title_key(value):
        return ' '.join(re.findall(r'\w+',value.casefold()))
    for r in records:
        if r['country']=='NO' and (identifier:=norwegian(r)):
            wanted[identifier].append(r['id'])
        elif r['country']=='NO' and r.get('originalTitle') and re.fullmatch(r'\d{4}-\d\d-\d\d',r.get('issuedDate','')):
            dated[(r['issuedDate'],title_key(r['originalTitle']))].append(r['id'])
        if r['country']=='GB' and (identifier:=british(r)) and identifier in uk:
            key='uk:'+identifier
            matches[r['id']]={'key':key,'sourceUrl':uk[identifier]['sourceUrl'],'label':uk[identifier]['title'],
                               'hasText':bool(official.get(key,{}).get('wordingShard'))}
    cache=Path(tempfile.gettempdir())/'maritime-public-lovdata-v1'
    archives=sorted(cache.glob('*.tar.bz2'))
    if not archives:
        raise SystemExit('The Lovdata public archives are required. Run tools/gazette.py to cache them.')
    endings={'-'.join(k.split('-')[1:4]).replace('-','')+'-'+k.split('-')[-1].zfill(4) for k in wanted}
    dates={date.replace('-','') for date,_ in dated}
    selected={}
    for path in archives:
        with bz2.open(path,'rb') as source,tarfile.open(fileobj=source,mode='r|',bufsize=65536) as book:
            for member in book:
                m=re.search(r'-(\d{8}-\d+)\.xml$',member.name)
                if not m or (m[1] not in endings and m[1].split('-')[0] not in dates):continue
                raw=book.extractfile(member).read()
                meta,_=read_header(raw)
                ref=meta['legalId']
                for key in dated.get((meta['date'],title_key(meta['title'])),[]):
                    if key not in wanted[ref]:
                        wanted[ref].append(key)
                if ref in wanted and (ref not in selected or meta['kind']=='consolidated'):
                    selected[ref]=(meta,raw)
    buckets=defaultdict(dict)
    for ref,(meta,raw) in selected.items():
        sections,_=sections_from_xml(raw,meta,include_appendices=True)
        for key in wanted[ref]:
            label=('Consolidated text' if meta['kind']=='consolidated' else 'Gazette publication')+' · '+ref
            hits=[dict(h,section='publisher-'+str(i)) for i,s in enumerate(sections) for h in extract(s['text'])]
            matches[key]={'label':label,'sourceUrl':meta['sourceUrl'],'shard':key[-1],'sections':len(sections),'hasText':bool(sections),'thresholds':hits}
            buckets[key[-1]][key]=[[s['label'],s['text'],s['sourceUrl']] for s in sections]
    out=DATA/'national-wording';out.mkdir(exist_ok=True)
    manifest=DATA/'publisher-matches.json'
    previous=json.loads(manifest.read_text(encoding='utf-8')) if manifest.is_file() else {}
    for key,(entry,parts) in domestic_editions(records,options.download):
        hits=[dict(h,section='publisher-'+str(i)) for i,(_,text,_) in enumerate(parts) for h in extract(text)]
        matches[key]={**entry,'shard':key[-1],'sections':len(parts),'hasText':True,'thresholds':hits}
        buckets[key[-1]][key]=parts
    old_buckets={}
    for r in records:
        key=r['id']
        citation=[r['country'],r['title'],r.get('issuedDate','')]
        old=previous.get(key,{})
        if key not in matches and old.get('citation')==citation and old.get('shard'):
            bucket=old['shard']
            if bucket not in old_buckets:
                old_buckets[bucket]=json.loads(gzip.decompress((out/(bucket+'.json.gz')).read_bytes()))
            matches[key]=old
            buckets[bucket][key]=old_buckets[bucket][key]
        if key in matches:
            matches[key]['citation']=citation
    for key,rows in sorted(buckets.items()):
        raw=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()
        atomic_bytes(out/(key+'.json.gz'),gzip.compress(raw,mtime=0))
    write(manifest,matches)
    print(len(matches),'formal national publisher links,',sum(v['hasText'] for v in matches.values()),'with local wording.')


if __name__=='__main__':
    main()
