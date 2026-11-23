"""Read image-only national PDFs using the catalogue language and keep physical page coordinates."""
import concurrent.futures
import gzip
import hashlib
import json
import os
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

import requests

from national_extract import atomic_bytes, readable, write
from national_texts import CACHE, COOLDOWN, DATA, backoff

WORK=CACHE.parent/'national-scans'
MODELS=WORK/'models'
LANGUAGES={'arabic':'ara','english':'eng','spanish':'spa','french':'fra','portuguese':'por','greek':'ell',
           'german':'deu','dhivehi':'div','chinese':'chi_sim','turkish':'tur','thai':'tha','indonesian':'ind',
           'italian':'ita','vietnamese':'vie','farsi':'fas','norwegian':'nor','slovenian':'slv','khmer':'khm',
           'danish':'dan','latvian':'lav','russian':'rus'}


def recognize(job):
    import pymupdf
    from tesserocr import PyTessBaseAPI

    source,pdf,models,languages=job
    key=hashlib.sha256(source.encode()).hexdigest()
    path=WORK/(key+'.pdf')
    if not path.is_file():
        if COOLDOWN.is_file() and float(COOLDOWN.read_text())>time.time():
            return source,None
        temp_path=None
        try:
            with requests.get(pdf,stream=True,timeout=(6,45)) as response:
                if response.status_code==429:
                    COOLDOWN.write_text(str(time.time()+backoff(response.headers.get('Retry-After'))))
                if response.status_code!=200:
                    return source,None
                with tempfile.NamedTemporaryFile(dir=WORK,delete=False) as downloaded:
                    temp_path=Path(downloaded.name)
                    for block in response.iter_content(65536):
                        downloaded.write(block)
            with temp_path.open('rb') as downloaded:
                if downloaded.read(5)!=b'%PDF-':
                    return source,None
            temp_path.replace(path)
        except (OSError,requests.RequestException):
            return source,None
        finally:
            if temp_path:temp_path.unlink(missing_ok=True)
    try:
        with pymupdf.open(path) as book:
            if book.needs_pass:return source,None
            pages=[]
            ocr_pages=0
            with PyTessBaseAPI(path=str(MODELS),lang='+'.join(models)) as engine:
                for page in book:
                    text=page.get_text()
                    if not readable(text,languages):
                        # Bound the raster, preserving the aspect ratio of unusual chart sizes.
                        scale=min(210/72,3000/max(page.rect.width,page.rect.height,1))
                        pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),colorspace=pymupdf.csGRAY,alpha=False)
                        engine.SetImageBytes(pix.samples,pix.width,pix.height,1,pix.stride)
                        text=engine.GetUTF8Text()
                        if engine.MeanTextConf()<55 or not readable(text,languages):text=''
                        if text:ocr_pages+=1
                    pages.append(text)
            count=sum(bool(p.strip()) for p in pages)
            if not count:
                return source,{'url':pdf,'state':'no usable text layer','ocrReviewed':True}
            atomic_bytes(CACHE/(key+'.pdf-text.gz'),gzip.compress(('\f'.join(pages)+'\f').encode(),mtime=0))
            return source,{'url':pdf,'state':'text','method':'OCR' if ocr_pages else 'PDF text layer',
                           'pages':len(pages),'pagesRead':count,'ocrPages':ocr_pages}
    except (RuntimeError,ValueError):
        return source,None


def main():
    manifest=CACHE/'pdf-outcomes.json'
    if not manifest.is_file():
        print('No national PDF retrieval results are available for OCR.')
        return
    local=CACHE.parent/'ocr-deps'
    if local.exists():sys.path.insert(0,str(local.resolve()))
    os.environ.setdefault('OMP_THREAD_LIMIT','1')
    try:
        from tesserocr import PyTessBaseAPI
        import pymupdf
    except ImportError as error:
        print('OCR unavailable on this host. The source PDFs and existing transcripts are retained.',error)
        return
    MODELS.mkdir(parents=True,exist_ok=True)
    states=json.loads(manifest.read_text(encoding='utf-8'))
    records=json.loads((DATA/'world-laws.json').read_text(encoding='utf-8'))['records']
    jobs={}
    for r in records:
        langs=r.get('languages',[])
        models=[]
        for lang in langs:
            normalized=''.join(c for c in lang.casefold() if not unicodedata.combining(c))
            if normalized in LANGUAGES:models.append(LANGUAGES[normalized])
        for source in r['textUrls']:
            state=states.get(source,{})
            if models and state.get('state') in ('size limit','no usable text layer') and not state.get('ocrReviewed'):
                jobs[source]=(source,state['url'],models,langs)
    available=set()
    for model in sorted({model for _,_,models,_ in jobs.values() for model in models}):
        path=MODELS/(model+'.traineddata')
        if not path.is_file():
            r=requests.get('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/'+model+'.traineddata',timeout=60)
            if not r.ok:continue
            atomic_bytes(path,r.content)
        available.add(model)
    queue=[(s,u,[m for m in models if m in available],langs) for s,u,models,langs in jobs.values() if any(m in available for m in models)]
    print('Reading',len(queue),'national PDFs using',len(available),'language models.',flush=True)
    with concurrent.futures.ProcessPoolExecutor(max_workers=min(4,os.cpu_count() or 1)) as pool:
        futures=[pool.submit(recognize,j) for j in queue]
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            key,state=future.result()
            if state:
                states[key]=state
                write(manifest,states)
            if i%25==0:print(i,'of',len(queue),'PDFs checked.',flush=True)


if __name__=='__main__':
    main()
