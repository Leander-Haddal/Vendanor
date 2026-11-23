"""Publish compact reviewable source predicates and reconcile every record against its index."""
from collections import defaultdict
import json
import re
from pathlib import Path

from national_extract import write

DATA = Path(__file__).resolve().parents[1] / 'site/data'


def main():
    def read(path):
        return json.loads((DATA/path).read_text(encoding='utf-8'))
    official=read('official-screening.json')
    world=read('world-laws.json')['records']
    details={}
    for p in sorted((DATA/'national').glob('*.json')):
        details.update(read(p))
    expected={r['id'] for r in world}
    if details.keys()!=expected:
        raise ValueError('National source inventory has missing or obsolete records')
    lookup={r['id']:r for r in world}
    publishers=read('publisher-matches.json')
    by_field=defaultdict(list)
    for key,record in details.items():
        raw=lookup[key]
        for i,hit in enumerate(record.get('thresholds',[])):
            by_field[hit['field']].append({'doc':'world:'+key,'section':'threshold-'+str(i),'countries':[c['code'] for c in raw['countries']],
                                           'op':hit['op'],'value':hit['value'],'quote':hit['quote'],
                                           **{k:hit[k] for k in ('when','effect','mentions') if k in hit}})
    for key,record in official.items():
        code='GB' if key.startswith('uk:') else 'EU' if key.startswith('eu:') else 'NO'
        stamp=re.search(r'/(\d{4}-\d{2}-\d{2})/data\.xml$',record['source'])
        for i,hit in enumerate(record.get('thresholds',[])):
            section=hit['section'] if code=='NO' else 'threshold-'+str(i)
            by_field[hit['field']].append({'doc':key,'section':section,'countries':[code],
                                           'op':hit['op'],'value':hit['value'],'quote':hit['quote'],**({'editionDate':stamp[1]} if stamp else {}),
                                           **{k:hit[k] for k in ('when','effect','mentions') if k in hit}})
    for key,record in publishers.items():
        for hit in record.get('thresholds',[]):
            by_field[hit['field']].append({'doc':'world:'+key,'section':hit['section'],'countries':[c['code'] for c in lookup[key]['countries']],
                **({'editionDate':record['editionDate']} if record.get('editionDate') else {}),
                **{k:hit[k] for k in ('op','value','quote','when','effect','mentions') if k in hit}})
    out=DATA/'predicates';out.mkdir(exist_ok=True)
    for field,rows in by_field.items():
        write(out/(field+'.json'),rows)
    stats={k:len(v) for k,v in sorted(by_field.items())}
    index=read('national-screening.json')
    primary=sum(bool(row[0] or publishers.get(key,{}).get('hasText')) for key,row in index['records'].items())
    write(DATA/'rule-coverage.json',{'fields':stats,'national':index['counts'],'nationalWithPrimaryText':primary,'nationalPublisherMatches':len(publishers),
        'officialRecords':len(official),'officialWithText':sum(r['state']=='text' for r in official.values()),
        'officialSections':sum(r.get('sections',0) for r in official.values()),
        'officialWithThresholds':sum(bool(r.get('thresholds')) for r in official.values())})
    print('Indexed source thresholds:',stats)


if __name__=='__main__':
    main()
