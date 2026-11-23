"""Index source-backed threshold passages. A threshold hit is not a complete applicability rule."""
import collections
import csv
import gzip
import hashlib
import json
import io
import os
import re
import unicodedata
import tempfile
import zipfile


MEASURES = {
    'grossTonnage': r'gross tonnage(?: units?)?|GT\b|bruttotonnasje|jauge brute|arqueo bruto|arqueação bruta|Bruttoraumzahl|bruttodräktighet|валовой вместимостью',
    'passengers': r'passengers?|passasjerer|passagers?|pasajeros?|passageiros?',
    'deadweightTonnes': r'(?:tonnes? (?:of )?deadweight|tons? deadweight|dwt)\b',
    'lengthOverall': r'(?:metres?|meters?|mètres?|metros?|m) (?:in length overall|in overall length|overall|de eslora total|de comprimento fora a fora|de longueur hors tout)|(?:metres?|meters?) (?:in )?overall length',
    'personsOnBoard': r'persons? on board|people on board|personnes à bord|personas a bordo|personer om bord|pessoas a bordo',
    'maxPropulsionKw': r'(?:kW|kilowatts?) (?:of )?(?:maximum |total )?propulsion power',
}
COMPARATORS = {
    'gte': r'at least|not less than|no less than|of at least|minst|au moins|al menos|pelo menos|mindestens|не менее',
    'lte': r'at most|not exceeding|not more than|no more than|up to|høyst|au plus|hasta|höchstens|не более',
    'gt': r'more than|greater than|exceeding|over|plus de|más de|mais de|mehr als|mer enn|более|свыше',
    'lt': r'less than|below|under|moins de|menos de|weniger als|mindre enn|менее',
}
POST = {'gte': r'or (?:more|over|above|upwards)|and (?:above|upwards|over)|eller mer|et plus|o más|ou mais',
        'lte': r'or (?:less|fewer)|or below|eller mindre|ou moins|o menos|ou menos'}
NUMBER = r'(?P<n>\d+(?:[.,]\d{1,3})?)'
PATTERNS = []
for field, unit in MEASURES.items():
    for op, comparator in COMPARATORS.items():
        PATTERNS.append((field, op, re.compile(r'\b(?:' + comparator + r')\s+' + NUMBER + r'\s*(?:' + unit + r')\b', re.I)))
        PATTERNS.append((field, op, re.compile(r'\b(?:' + unit + r')\s+(?:(?:of|is|på|de|d’au|von)\s+)?(?:' + comparator + r')\s+' + NUMBER + r'\b', re.I)))
    for op, comparator in POST.items():
        PATTERNS.append((field, op, re.compile(r'\b' + NUMBER + r'\s*(?:' + unit + r')\s+(?:' + comparator + r')\b', re.I)))
        PATTERNS.append((field, op, re.compile(r'\b(?:' + unit + r')\s+' + NUMBER + r'\s+(?:' + comparator + r')\b', re.I)))
HINT = re.compile('|'.join(MEASURES.values()), re.I)
DIMENSIONS={'lengthOverall':r'length overall|overall length|største lengde|eslora total|longueur hors tout',
            'lengthL':r'lengde\s*\(L\)|length\s*\(L\)','maxPropulsionKw':r'maximum propulsion power|samlet fremdriftseffekt'}
for field,label in DIMENSIONS.items():
    unit='(?:kW|kilowatts?)' if field=='maxPropulsionKw' else '(?:m|metres?|meters?|meter|mètres?|metros?)'
    for op,comparator in COMPARATORS.items():
        PATTERNS.append((field,op,re.compile(r'\b(?:'+label+r')\s+(?:(?:of|is|på|de)\s+)?(?:'+comparator+r')\s+'+NUMBER+r'\s*'+unit+r'\b',re.I)))
    for op,comparator in POST.items():
        PATTERNS.append((field,op,re.compile(r'\b(?:'+label+r')\s+(?:(?:of|på)\s+)?'+NUMBER+r'\s*'+unit+r'\s+(?:'+comparator+r')\b',re.I)))
HINT=re.compile(HINT.pattern+'|'+'|'.join(DIMENSIONS.values()),re.I)
EFFECT = re.compile(r'\b(shall not|must not|may not|shall|must|is required to|does not apply|do not apply|applies to|may|skal ikke|skal|gjelder ikke|gjelder for|doivent|doit|ne s.applique pas|deberán?|deberá|quedan excluidos|deve[m]?)\b',re.I)
INSTRUMENT = re.compile(r'\b(SOLAS|MARPOL|STCW(?:-F)?|COLREGs?|MLC\s*2006|Load Lines Convention)\b',re.I)


def decode(raw):
    if raw[:2] in (b'\xff\xfe', b'\xfe\xff'):
        return raw.decode('utf-16', errors='replace')
    for enc in ('utf-8-sig', 'utf-16' if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else 'cp1252', 'latin1'):
        try:
            return raw.decode(enc)
        except UnicodeError:
            pass
    return ''


def readable(text,languages):
    letters=[c for c in text if c.isalpha()]
    if len(letters)<80 or len(letters)<len(text)*.38:
        return False
    latin={'english','french','spanish','portuguese','german','dutch','norwegian','danish','swedish','italian','polish','finnish','turkish','indonesian','vietnamese'}
    if languages and all(lang.lower() in latin for lang in languages):
        sample=letters[::max(1,len(letters)//600)]
        return sum('LATIN' in unicodedata.name(c,'') for c in sample)>.8*len(sample)
    return True


def extract(text):
    hits = []
    for line in re.split(r'(?<=[.;!?])\s+|\n\s*\n', text):
        if not HINT.search(line):
            continue
        line = ' '.join(line.split())
        found=[]
        for field, op, pattern in PATTERNS:
            for m in pattern.finditer(line):
                # Punctuation has different decimal and thousands conventions across languages.
                num = m['n']
                if re.search(r'[.,]\d{3}$', num):
                    continue
                value = float(num.replace(',', '.'))
                start, end = m.span()
                hit = {'field': field, 'op': op, 'value': int(value) if value.is_integer() else value,
                       'quote': line[max(0, start-54):min(len(line), end+54)]}
                found.append((start,end,hit))
        found=[v for v in found if not any(other[2]['field']==v[2]['field'] and other[0]<=v[0] and other[1]>=v[1] and (other[0],other[1])!=(v[0],v[1]) for other in found)]
        # Retain the passage's qualification and normative effect. Mixed conjunctions,
        # subordinate exceptions and unparsed language stay open for source review.
        # Keep numeric duties on the result side out of the applicability predicate.
        effects=list(EFFECT.finditer(line))
        for start,end,hit in found:
            following=next((m for m in effects if m.start()>=end),None)
            if following and following.start()-start<=280:
                conditions=sorted(((a,b,h) for a,b,h in found if following.start()-280<=a<b<=following.start()),key=lambda row:row[:2])
                gaps=[line[b:a].strip(' ,()') for (_,b,_),(a,_,_) in zip(conditions,conditions[1:])]
                conjunction=None
                if all(g.lower() in ('and','og','et','y','e') for g in gaps):
                    conjunction='all'
                elif all(g.lower() in ('or','eller','ou','o') for g in gaps):
                    conjunction='any'
                if conjunction:
                    leaves=[{k:h[k] for k in ('field','op','value')} for _,_,h in conditions]
                    hit['when']=leaves[0] if len(leaves)==1 else {conjunction:leaves}
                hit['effect']=line[following.start():following.start()+170]
            targets=list(dict.fromkeys(m.group().upper() for m in INSTRUMENT.finditer(line) if abs(m.start()-start)<=250))
            if targets:
                hit['mentions']=targets
            if hit not in hits:
                hits.append(hit)
    return hits


def write(path, obj):
    atomic_bytes(path,(json.dumps(obj, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf-8'))


def atomic_bytes(path,content):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as output:
        output.write(content)
        temp=output.name
    os.replace(temp,path)


def catalogue_notes(data,records):
    archive=data.parents[1]/'.work/world-laws/FAOLEX_All.zip'
    if not archive.exists():
        return {}
    wanted={r['id'] for r in records}
    notes={}
    csv.field_size_limit(20_000_000)
    with zipfile.ZipFile(archive) as book, book.open('FAOLEX_All.csv') as source, io.TextIOWrapper(source,encoding='utf-8-sig',newline='') as stream:
        reader=csv.DictReader(stream)
        identifier=next(k for k in reader.fieldnames if k.endswith('FAOLEX ID'))
        for row in reader:
            key=row[identifier]
            if key not in wanted:
                continue
            value=' '.join(row['Abstract'].split())
            if not value:
                continue
            references=[]
            for m in INSTRUMENT.finditer(value):
                name=m.group().upper()
                if any(r['name']==name for r in references):
                    continue
                references.append({'name':name,'text':value[max(0,m.start()-85):m.end()+85]})
            notes[key]={'reviewedCatalogue':True,'thresholds':extract(value),'references':references}
    return notes


def build(data, cache, records, responses):
    out = data / 'national'
    out.mkdir(exist_ok=True)
    index, counts, chunks = {}, collections.Counter(), collections.defaultdict(dict)
    renditions = {}
    used_pdfs={}
    recovered=cache/'pdf-outcomes.json'
    pdfs=json.loads(recovered.read_text(encoding='utf-8')) if recovered.exists() else {}
    notes=catalogue_notes(data,records)
    prior={}
    for shard in out.glob('*.json'):
        prior.update(json.loads(shard.read_text(encoding='utf-8')))
    for rec in records:
        source_pdfs={rec.get('pdfUrl',''),*rec.get('documentUrls',[])}
        old=prior.get(rec['id'],{})
        previous={doc['source']:(i,doc) for i,doc in enumerate(old.get('documents',[])) if doc.get('source')}
        docs = []
        for url in rec['textUrls']:
            if url not in renditions:
                path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.gz')
                if path.exists():
                    raw = gzip.decompress(path.read_bytes())
                    text = decode(raw)
                    normal = ' '.join(unicodedata.normalize('NFC', text).split())
                    # Empty or noisy OCR still has a publisher link. Never confirm a rule from OCR.
                    legible = readable(normal,rec.get('languages',[]))
                    state = 'text' if legible else 'unusable text'
                    fingerprint = hashlib.sha256(normal.encode()).hexdigest() if legible else ''
                    renditions[url] = (state, fingerprint, extract(text) if legible else [])
                if url in pdfs and pdfs[url]['state']=='text' and pdfs[url]['url'] in source_pdfs and renditions.get(url,('',))[0]!='text':
                    path=cache/(hashlib.sha256(url.encode()).hexdigest()+'.pdf-text.gz')
                    if path.is_file():
                        pages=gzip.decompress(path.read_bytes()).decode('utf-8').removesuffix('\f').split('\f')
                        fingerprint=hashlib.sha256(' '.join(unicodedata.normalize('NFC',' '.join(pages)).split()).encode()).hexdigest()
                        hits=[dict(hit,page=i) for i,text in enumerate(pages,1) for hit in extract(text)]
                        renditions[url]=('text',fingerprint,hits)
                        used_pdfs[url]=pdfs[url]['url']
                old_pdf=previous.get(url,(0,{}))[1].get('sourcePdf')
                if (url not in renditions or (old_pdf and old_pdf in source_pdfs and renditions[url][0]!='text')) and url in previous and previous[url][1].get('digest'):
                    position,document=previous[url]
                    hits=[{k:v for k,v in hit.items() if k!='document'} for hit in old.get('thresholds',[]) if hit['document']==position]
                    renditions[url]=(document['state'],document['digest'],hits)
                    if old_pdf in source_pdfs and old_pdf:used_pdfs[url]=old_pdf
                if url not in renditions:
                    renditions[url] = (responses.get(url, 'not retrieved'), '', [])
            docs.append(renditions[url])
        hits = [dict(hit, document=i) for i, (_, _, result) in enumerate(docs) for hit in result]
        group = rec['id'][-2:]
        detail = {'documents': [{'state':state,'source':url, **({'digest': digest} if digest else {})} for url,(state,digest,_) in zip(rec['textUrls'],docs)]}
        for doc in detail['documents']:
            source=doc['source']
            pdf=pdfs.get(source,{})
            old_doc=previous.get(source,(0,{}))[1]
            if pdf.get('url') in source_pdfs:
                doc['pdfState']=pdf['state']
            if source in used_pdfs:
                doc['sourcePdf']=used_pdfs[source]
                annotation=pdf if pdf.get('method') else old_doc if old_doc.get('digest')==doc.get('digest') else {}
                if annotation.get('method')=='OCR':
                    doc.update(method='OCR',pagesRead=annotation['pagesRead'],pages=annotation['pages'])
            elif not (cache/(hashlib.sha256(source.encode()).hexdigest()+'.gz')).exists() and doc.get('digest') and old_doc.get('digest')==doc['digest'] and old_doc.get('sourcePdf') in source_pdfs:
                doc.update({k:old_doc[k] for k in ('sourcePdf','method','pagesRead','pages') if k in old_doc})
        note=notes.get(rec['id'])
        if not notes and old.get('catalogueReviewed'):
            note={'thresholds':old.get('catalogueThresholds',[]),'references':old.get('catalogueReferences',[])}
        if note:
            detail['catalogueReviewed']=True
            if note['thresholds']:
                detail['catalogueThresholds']=note['thresholds']
            if note['references']:
                detail['catalogueReferences']=note['references']
            counts['recordsWithAbstract']+=1
            counts['catalogueThresholds']+=len(note['thresholds'])
            counts['catalogueReferences']+=len(note['references'])
        if hits:
            detail['thresholds'] = hits
        chunks[group][rec['id']] = detail
        fields = sorted({h['field'] for h in hits})
        count = sum(state == 'text' for state, _, _ in docs)
        index[rec['id']] = [count, len(docs), len(hits), fields]
        if docs and count == len(docs):
            fingerprints = sorted(digest for _,digest,_ in docs)
            index[rec['id']].append(hashlib.sha256(' '.join(fingerprints).encode()).hexdigest())
        references=detail.get('catalogueReferences',[])
        if references:
            if len(index[rec['id']])==4:
                index[rec['id']].append(None)
            index[rec['id']].append([ref['name'] for ref in references])
        counts['records'] += 1
        counts['recordsWithText'] += bool(count)
        counts['recordsWithOcr'] += any(d.get('method')=='OCR' for d in detail['documents'])
        counts['renditions'] += len(docs)
        counts['recordsWithThresholds'] += bool(hits)
        counts['thresholds'] += len(hits)
    for key, rows in chunks.items():
        write(out / (key + '.json'), rows)
    write(data / 'national-screening.json', {'counts': dict(counts), 'records': index})
    print(dict(counts), flush=True)
