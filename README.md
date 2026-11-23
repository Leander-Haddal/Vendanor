# Ship Law Index

A GitHub Pages application for finding maritime law for a boat, reading the relevant passage and checking it against the original. Each result retains the particulars and date used to screen it.

## Run it

Use Node 22 or later from the repository root. The application is static and its public data is included.

```sh
npm run dev
```

Open [the local project site](http://127.0.0.1:4173/Vendanor/). To use another port, run `npm run dev -- --port 8080`.
On Windows installations where PowerShell restricts npm scripts, use `npm.cmd run dev`.

## Find the source for a vessel

1. Open **Boat search**, choose the flag and boat type and press **Find laws**. Add known length, gross tonnage, construction date, waters or survey particulars to narrow the search. A construction year is sufficient when the exact day is unknown. **Find laws as of** selects the law date independently. It defaults to the latest checked release day up to today.
2. For a known vessel, open **Look up a vessel by name or number**. Search Norway’s active fishing-vessel register by name, registration or call sign, or search Wikidata by name, IMO or MMSI. Inspect the source beside each offered value and apply the particulars you can confirm. **Remember this boat on this device** saves a named profile. **My boats** lets you find, edit, use or remove it.
3. Start at **Matches your particulars**. Each card represents an instrument. Read its first relevant passage, browse the rest or search across the results by word, phrase or section number. **Needs checking** identifies missing particulars and legal questions. Answer them in place. The flag’s national catalogue and official registers remain available beside the screened evidence.
4. Open a passage to read its wording and qualifications, then its clipped original pages, complete PDF or publisher record. For a catalogue-only law, open the publisher’s linked PDF and use **Find passage in PDF** to select and download relevant lines. A locally selected copy also works for publishers that restrict cross-origin retrieval.
5. Open **Law map** for national registers, dated editions, treaty status and amendments. The UK timeline can compare published XML editions provision by provision. The EU map links original acts, consolidations and changing acts. IMO events link to the printed status-book page or the chronology. **Research tools** also contains keyword search over the wider library, **Revision changes**, class delegations and private imports.

## Public coverage

The figures describe the release assembled on 23 November 2026. **Sources & imports** displays the counts from the files actually loaded.

| Collection | Shipped coverage | What can be searched or read |
| --- | --- | --- |
| Norwegian Gazette and current legislation | 1,393 notices and 284 consolidated records. 17,295 extracted passages. The selected notices were published from 31 January 2001 to 13 November 2026. | Searchable wording, amendment targets and publisher links. Nine verified archive originals have 288 mapped section boundaries. [Lovdata open API](https://api.lovdata.no/publicData) |
| Reviewed Norwegian legislation | Three instruments, 11 publication/annex/amendment records, ten distinct original PDFs and 282 excerpts. Includes all 268 numbered sections of the three as-issued regulations. | Page-verified excerpts, 29 source-linked vessel fields, six comparisons and the relevant historical amendment publications. [Norwegian Maritime Authority](https://www.sdir.no/en/legislation/regulations/construction-equipment-and-supervision-of-small-cargo-ships/) |
| Reviewed EU tanker legislation | Two instruments, three Official Journal publications, 12 excerpts, six fields and two documented comparisons. | Compare the 2002 scope, the 2003 replacement and the 2012 recast. General scope and the separate heavy-grade-oil threshold use tonnes deadweight. [EU Official Journal source](https://eur-lex.europa.eu/eli/reg/2012/530/oj/eng) |
| International collision rules | 166 contracting states and 19 separately dated territorial flags. Two full original sources and 17 distinct clipped passages support the flag records. | Lookout, responsibility, scope, length and selected light ranges. Compare Rule 22 around the 1 June 1983 amendment. [IMO status of conventions](https://www.imo.org/en/about/conventions/pages/statusofconventions.aspx) |
| Safety of Life at Sea | 169 contracting states and ten documented territorial flags. Six distinct excerpts from the original SOLAS treaty. | Chapter I scope, the voyage definition, passenger count, gross tonnage threshold, listed exemptions and Great Lakes boundary. The record links the special polar provisions. [Original UN treaty publication](https://treaties.un.org/doc/Publication/UNTS/Volume%201184/volume-1184-I-18961-English.pdf) |
| Maritime Labour Convention | 112 state ratification records and nine documented territorial applications. Nine distinct ILO source passages. | Check commercial and seagoing scope, exclusions, the 500 GT certification threshold and the conditions on voyages or operation from a foreign port. A future entry-into-force date remains visible in the map. [UN treaty register](https://treaties.un.org/Pages/showDetails.aspx?clang=_en&objid=080000028006822e) |
| United Kingdom, United States and New Zealand provisions | Nine dated selections with 30 distinct printed excerpts for life-saving appliances, flotation devices and navigation safety. | Read the specific requirements and historical comparisons, including the signed New Zealand 2007 amendment and the UK 2022 change. [UK legislation](https://www.legislation.gov.uk/uksi/2020/501/contents) · [US eCFR](https://www.ecfr.gov/current/title-33/chapter-I/subchapter-S/part-175) · [Maritime New Zealand](https://www.maritimenz.govt.nz/about-us/rules/all-rules/maritime-rules-part-91/) |
| IMO treaty history | 96 instruments and codes, 578 chronology events and 60 treaty, annex and protocol columns. The July 2026 chronology and October 2026 status sources have individual dates. | Search by title or resolution. Inspect a state’s recorded participation and any exceptions or conditions on a change. [IMO status books and state workbook](https://www.imo.org/en/about/conventions/pages/statusofconventions.aspx) |
| UK and EU edition histories | 1,552 UK instruments and 2,753 publisher edition links. The index includes 730 PDF-only editions. 437 EU acts, 268 consolidated texts and 476 incoming amendment, repeal or correction relationships. | Open the editions identified by the UK publisher or an original EU act and its linked changes. UK coverage spans 1664–2026 across five maritime title searches. [UK archive coverage](https://legislation.github.io/data-documentation/what-we-have.html) · [EU Publications Office](https://op.europa.eu/en/web/cellar/cellar-data) |
| Worldwide national catalogue | 9,626 records across 237 publisher country or territory names, covering 1804–2026. The selected rows map to 225 UN country/area codes. Each row has a source-supplied PDF link. | Titles, original titles, country, topic, year, sources, status as supplied and 1,635 recorded last-amended dates. Multicountry and historical territories retain their source names. [FAOLEX open data](https://www.fao.org/faolex/en/open-data) |
| Flag administrations and class | 248 UN countries and areas, 124 ILO maritime labour profile links and 28 reviewed DNV/BV entries across 15 flags. | Country search, society filters, scope of each documented authorization, and the authoritative source. [UN M49](https://unstats.un.org/unsd/methodology/m49/overview/) · [ILO maritime labour index](https://normlex.ilo.org/dyn/nrmlx_en/f?p=NORMLEXPUB:80020:0::NO:::) |
| Major registers | 81 official legislative or administrative references for 41 flags/registers, including all 35 ranked in UNCTAD Table II.2. Those 35 represented 93% of world merchant-fleet deadweight on 1 January 2025 within the table’s vessel scope. | Open the responsible authority and official legislation for a selected flag. Madeira, DIS and NIS retain their separate register labels. [UNCTAD ranking and scope](https://unctad.org/system/files/official-document/rmt2025ch2_en.pdf) |
| Flag administration notices | 12 cited passages in ten official notices for Liberia, Panama, the Marshall Islands, Singapore and the Bahamas. | Search and map entries retain the vessel scope, source language, physical PDF pages and date evidence. Month-only revision dates retain that precision. |
| Vessel particulars | 5,006 active Norwegian fishing vessels in the 22 November 2026 extract. Worldwide public vessel lookup queries Wikidata on demand. | Confirm source-backed dimensions, registration and dates. The vessel register is a dated identification aid. [Norwegian Directorate of Fisheries data](https://www.fiskeridir.no/registre/fartoyregisteret/uttrekk-fra-fartoyregisteret) |

The searchable legal wording and dates available vary by source. Historical amendment notices record specific changes. Consolidations show the publisher’s assembled wording. A FAOLEX last-amended date alone cannot reconstruct every intervening edition. EC/EEA application, incorporated technical standards, local rules and the full history of every flag require their own evidence. Review the flag, operating area, source language, exceptions and transitional provisions before using a result for an operational decision.

## Add a private law

Under **Sources & imports**, select a PDF and enter its title, authority and publication date. An unannotated PDF becomes searchable by page. Expand the provision editor to supply exact bounds, a transcript for a scan or vessel conditions. Use the same family ID for successive editions. A library pack can also contain text-only material.

For example, to index a manually identified portion of page 2, the provisions editor accepts the following shape. Supply the actual printed label and the actual measured bounds for your document.

```json
[
  {
    "key": "article-2",
    "label": "Article 2",
    "fromPage": 2,
    "toPage": 2,
    "top": 0.17,
    "bottom": 0.64
  }
]
```

Private PDFs and named boats stay in this browser. A project-scoped first-party cookie remembers the last selected boat by its opaque ID for up to a year. Browser storage holds the particulars. **Worldwide vessel lookup** sends the entered query to Wikidata when chosen. Export a library pack before clearing browser storage or moving to another site origin. The import limits are 24 MiB per PDF, 600 pages, 600 sections per document and 48 MiB per pack. An imported scan can retain its original image and a supplied transcription.

## Verify or rebuild

```sh
npm ci
npm test
npm run check
npm run inventory -- --check
```

Inventory verification requires Python 3.11 or later. It checks the project files and authored functions. If you keep a local `PLAN.md`, it also verifies that file’s inventory. Run `npm run inventory` to update the local copy. For end-to-end checks, keep the local server running in another terminal and run `npm run test:browser` with Edge or Chromium installed. Set `BROWSER_PATH` to the executable or `BASE_URL` to an alternate project mount.

| Command | Result |
| --- | --- |
| `python tools/gazette.py` | Download Lovdata’s public bulk archives and regenerate maritime records, postings and text shards. Add `--offline` to reuse a complete local source cache. |
| `python tools/archive_pdfs.py --offline --limit 100 --byte-budget 100000000` | Revalidate and map archived originals using Poppler’s `pdftotext`. The adapter can also process a selected publisher notice or a supplied directory of originals. |
| `python tools/countries.py` | Refresh UN M49 and join reviewed ILO/flag sources. An officially saved ILO index can be supplied with `--mlc-index` and `--index-date`. |
| `python tools/world_laws.py --refresh` | Rebuild national metadata from the complete FAOLEX ZIP using the country directory. Supply `--archive` for a local source cache. |
| `python tools/uk_history.py` and `python tools/eu_history.py` | Read UK Atom feeds and edition lists, and the EU Publications Office shipping classification and revision relationships. The UK adapter supports a cached run and `--refresh`. |
| `python tools/flag_sources.py`, `python tools/imo_history.py` and `python tools/vessels.py` | Validate the priority-register map, rebuild IMO convention and participation records, and refresh the public vessel particulars index. |
| `python tools/registry_guides.py --refresh` and `node tools/boat_fields.mjs` | Recheck targeted national notices against the publishers’ PDFs and rebuild the compact boat form after a folio update. |
| `python -m pip install pymupdf==1.26.7`, then `python tools/folios.py` and `python tools/eu_folios.py` | Rebuild mapped excerpts from the pinned publisher PDFs. Both source builders support `--refresh` to check the original bytes again. |
| `python tools/flag_folios.py`, `python tools/mlc_folios.py`, `python tools/colreg_folios.py` and `python tools/solas_folios.py` | Rebuild national and international clause extracts, flag dates and edition evidence using PyMuPDF. Changes in pinned source bytes require review. |
| `node tools/vendor.mjs` | Reproduce the local browser PDF libraries, fonts and character maps from integrity-checked upstream packages. |

## Publish to GitHub Pages

Review the local preview first. When you choose to release, push your reviewed revision to this repository. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. Under **Actions → Publish Ship Law Index**, manually run the workflow on the reviewed branch. The job tests that revision and publishes only `site/`. GitHub reports the deployment URL. [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

**Prepare a legal source update** is a separate manual workflow. It uses read-only repository access and produces a downloadable review artifact. The maintainer decides when to incorporate a source update and when to publish it.

## Data rights and project map

Norwegian bulk data is distributed under NLOD 2.0. FAOLEX national metadata is an attributed selection and adaptation of the FAOLEX Complete Collection, distributed under CC BY-NC-SA 3.0 IGO. Linked national texts retain their own rights. The Official Journal records, class-society publications and bundled software have their individual reuse conditions. [NLOD](https://data.norge.no/nlod/en/2.0) · [FAOLEX reuse conditions](https://www.fao.org/faolex/en/open-data) · [EUR-Lex legal notice](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html) · [Software notices](site/vendor/LICENSES.txt)

ILO material is credited to the International Labour Organization. Its English consolidated publication and the labelled excerpt crops are used under CC BY 4.0. UK source XML and the public UK statutory publications are Crown copyright under the Open Government Licence. USCG supplies the navigation handbook, and the United Nations Treaty Series supplies the historic treaty text. The IMO status workbooks and books are cited at their publisher. [ILO permissions](https://www.ilo.org/rights-and-permissions) · [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) · [IMO publications](https://www.imo.org/en/about/conventions/pages/statusofconventions.aspx)
