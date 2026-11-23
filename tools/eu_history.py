"""Publish an edition index from the Publications Office's public CELLAR graph."""
import json
import os
from pathlib import Path
import re
import tempfile
import time
from datetime import date
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql"
AUTH = "http://publications.europa.eu/resource/authority/"
PREFIX = """PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
"""
SUPPLEMENTS = ("32012R0530", "32002R0417", "31994L0025", "32013L0053")


def rows(query):
    url = ENDPOINT + "?" + urlencode({"query": PREFIX + query, "format": "application/sparql-results+json"})
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": "ShipLawIndex/1.0"}),timeout=100) as reply:
                if reply.headers.get("X-SPARQL-MaxRows") or reply.headers.get("X-SQL-State") == "S1TAT":
                    raise ValueError("The publisher returned a partial query.")
                records=json.load(reply)["results"]["bindings"]
            if len(records) >= 10000: raise ValueError("Query exceeds the public endpoint's result window.")
            return [{k:v["value"] for k,v in row.items()} for row in records]
        except (OSError, ValueError):
            if attempt == 3: raise
            time.sleep((attempt + 1) * 2)


def values(uris):
    if any(not re.fullmatch(r"http://publications\.europa\.eu/resource/[A-Za-z0-9./_-]+",uri) for uri in uris):
        raise ValueError("Unexpected Publications Office identifier.")
    return " ".join("<"+uri+">" for uri in uris)


def lex(code):
    return "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:"+quote(code,safe="")


def day(value):
    return (value or "")[:10] if re.match(r"\d{4}-\d{2}-\d{2}",value or "") else ""


def main():
    directory=AUTH+"dir-eu-legal-act"
    classes=rows('SELECT DISTINCT ?uri ?label WHERE { ?uri skos:inScheme <'+directory+'>; skos:prefLabel ?label. FILTER(LANG(?label)="en" && STRSTARTS(STR(?uri),"'+directory+'/0730")) } ORDER BY ?uri')
    if not any(c["uri"]==directory+"/0730" for c in classes): raise ValueError("Official Shipping classification is missing.")
    extras=["http://publications.europa.eu/resource/celex/"+s for s in SUPPLEMENTS]
    query="""SELECT DISTINCT ?work ?celex ?title ?date ?end WHERE {
      { VALUES ?dir { DIR } ?work cdm:resource_legal_is_about_concept_directory-code ?dir. }
      UNION { VALUES ?alias { EXTRA } ?work owl:sameAs ?alias. }
      ?work cdm:resource_legal_id_celex ?celex.
      FILTER(STRSTARTS(STR(?celex),"2") || STRSTARTS(STR(?celex),"3"))
      OPTIONAL { ?exp cdm:expression_belongs_to_work ?work; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG>; cdm:expression_title ?title. }
      OPTIONAL { ?work cdm:work_date_document ?date. }
      OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?end. }
    } ORDER BY ?work ?title""".replace("DIR",values([r["uri"] for r in classes])).replace("EXTRA",values(extras))
    works={}
    for row in rows(query):
        w,code=row["work"],row["celex"]
        if w in works: continue
        works[w]={"id":code,"title":row.get("title") or code,"date":day(row.get("date")),"endDate":day(row.get("end")),"sourceUrl":lex(code),"editions":[],"changes":[]}
    if not set(SUPPLEMENTS)<=set(v["id"] for v in works.values()): raise ValueError("Missing known maritime acts.")
    predicates={"act_consolidated_consolidates_resource_legal":"Consolidated edition","resource_legal_amends_resource_legal":"Amended by",
                "resource_legal_repeals_resource_legal":"Repealed by","resource_legal_corrects_resource_legal":"Corrected by"}
    keys=list(works)
    for start in range(0,len(keys),24):
        query="""SELECT DISTINCT ?work ?rel ?id ?date WHERE { VALUES ?work { WORKS } VALUES ?rel { PREDICATES }
        ?other ?rel ?work; cdm:resource_legal_id_celex ?id. OPTIONAL { ?other cdm:work_date_document ?date. } }""".replace("WORKS",values(keys[start:start+24])).replace("PREDICATES"," ".join("cdm:"+p for p in predicates))
        for row in rows(query):
            rec=works[row["work"]];code=row["id"];kind=predicates[row["rel"].rsplit("#",1)[-1]]
            if kind=="Consolidated edition":
                if not code.startswith("0"+rec["id"][1:]+"-"): continue
                dest=rec["editions"]
            else: dest=rec["changes"]
            entry={"id":code,"kind":kind,"date":day(row.get("date")),"sourceUrl":lex(code)}
            if entry not in dest: dest.append(entry)
    for record in works.values():
        for kind in ("editions","changes"):record[kind].sort(key=lambda x:(x["date"],x["id"]))
    records=sorted(works.values(),key=lambda x:(x["date"],x["id"]),reverse=True)
    out={"schemaVersion":1,"checkedAt":str(date.today()),"source":"Publications Office of the European Union · CELLAR","sourceUrl":"https://op.europa.eu/en/web/cellar/cellar-data",
         "classification":[{"code":x["uri"].rsplit("/",1)[-1],"label":x["label"]} for x in classes],"additionalActs":SUPPLEMENTS,"records":records}
    path=ROOT/"site"/"data"/"eu-history.json"
    with tempfile.NamedTemporaryFile("w",encoding="utf-8",newline="\n",dir=path.parent,delete=False) as tmp:
        json.dump(out,tmp,ensure_ascii=False,separators=(",",":"));tmp.write("\n")
    os.replace(tmp.name,path)
    print(len(records),"maritime acts,",sum(len(r["editions"]) for r in records),"consolidations and",sum(len(r["changes"]) for r in records),"change relationships.")


if __name__=="__main__":
    main()
