# 10 — Meter CSV source folder review (`006. METER CSV`)

**Date:** 2026-09-28
**Scope:** `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV`, compared against WM Solar (`scratchpad/wmsolar-main`) parser spec + code.
**Method:** read-only. Python/xattr/mdls/Spotlight from a scratch dir (`solar-review/work/`). Nothing in Dropbox was modified, and nothing was downloaded or hydrated.

---

## 0. Headline: none of the 2,140 files could be read. All are online-only Dropbox placeholders

This finding limits everything below, so it comes first.

| Check | Result |
|---|---|
| Files found | **2,140** (2,079 `.csv`, 33 `.pdf`, 27 `.xls`, 1 `.xlsx`) |
| `open()` + `read(4096)` succeeded | 2,140 / 2,140. **Every read returned 0 bytes** |
| `st_size` / `kMDItemLogicalSize` / `kMDItemPhysicalSize` | **0 for all 2,140** |
| `com.dropbox.placeholder` xattr present | **2,140 / 2,140** (38-byte header, version field `3`) |
| Did the placeholder carry the real size? | **No.** The 8-byte field after the version is the same constant (`32425189`) on every file, including PDFs and the `.xlsx`, so it is an identifier and not a size. I decoded and tested it, and I have **not** used it as a size anywhere. |
| Does reading trigger hydration? | No. This Dropbox sync on the external APFS volume returns an empty stream without fetching the content. |
| Hydrated copies anywhere else on the machine? | Searched Spotlight across all 6,703 Dropbox CSVs and the whole disk. The sibling `(647) FORTRESS - ASSET AUDITS/25. METERING/011. METERING AUDIT/<SITE>/` tree holds the same meters under a different naming (`YA - BULK METER.csv`, `WR - SOLAR PLANT 360.csv`), but **1,276 of its 1,278 files are also 0-byte placeholders**. The only two non-empty files are asset-register `.xlsx` files, not meter data. None of the other 155 non-empty Dropbox CSVs is meter data (they are COC rename maps and platform-import dry runs). |

**What this means for the brief.** I cannot give real file contents: headers, delimiters, units, intervals, timestamp formats, date ranges, gap/zero/spike statistics, or real excerpts. I have not guessed any of them. Sections 2 and 3 are marked **NOT DETERMINABLE** wherever content is needed. Where I describe a format, it is the format **WM Solar's code expects**, and it is labelled that way. Section 7 gives the smallest hydration step that unblocks the rest.

Everything else in this report comes from evidence that does not depend on file content: names, folder structure, export timestamps, WM Solar source code, and its fixtures.

---

## 1. Inventory

### 1.1 Top level

| Artefact | Count | What it is (from name/structure) |
|---|---|---|
| 41 site folders | 2,079 CSV + 1 XLSX | One file per meter/channel, exported per site |
| Root `FLAMWOOD VALUE_…` and `SEGONYANA_Consolidation_Summary.csv/.xls` | 4 | Per-site roll-ups (see §4) |
| `001. COMPLETED SITES/` | 24 CSV + 25 XLS | `<SITE>_Consolidation_Summary.{csv,xls}` for **25 sites** |
| `002. OVERALL SITE LAYOUTES/` | 33 PDF (10 in 4 sub-folders) | Leasing/letting plans and tenant layouts (e.g. `… LET001-REV19.pdf`, `… LETTING JULY 2024.pdf`, `… MASTER PLAN.PDF`). Used to map a shop number to its physical position. All dated 2025-07-29. Some belong to sites that have **no meter folder** (GAME MAKHADO, MUSINA, LEPHALALE). |

### 1.2 Per-site folders

Legend. **csv** = meter files. **shop** = files with a shop-number field. **area** = files with a numeric trailing area. **dup** = files with a ` (n)` duplicate suffix. **Export dates** = file creation/modification dates, i.e. when the files were downloaded, **not the data period**. **Data range** is NOT DETERMINABLE for every site (see §0).

| Site folder | csv | shop | area (Σ m²*) | dup | Special meters (by label) | Label style | Export dates |
|---|---|---|---|---|---|---|---|
| 204 Oxford | 76 | 0 | 0 | 0 | MAIN INCOMER 1, MAIN INCOMER 2, GENERATOR 1; 18 `DB-…` | tenant/DB name | 2025-12-08 → 2026-01-05 |
| ABAQULUSI PLAZA | 56 | 40 | 42 (13,612) | 0 | ATMs, common area | shop+tenant+area | 2026-01-12 (+8 on 03-17) |
| BIYELA CENTRE | 25 + 13 in `BIYELA SQUARE/` | 15 | 15 (4,345) | 0 | — | mixed; subfolder uses `BC2 - <TENANT>.csv` | 2026-01-09 (+3 on 03-17) |
| BIYELA SQUARE | 13 | 2 | 2 (597) | 0 | — | `BC2 - …` inside standard grammar | 2026-01-09 |
| BLOEM VALUE MART | 22 | 10 | 13 (8,938) | 1 | — | shop+tenant+area | 2026-01-09 |
| BOTLOKWA PLAZA | 30 | 20 | 21 (7,712) | 0 | `DB-13 SPARE` | shop+tenant+area | 2026-01-09 |
| CAPRICORN MUTSINDO | 26 | 21 | 21 (5,873) | 0 | — | shop+tenant+area | 2026-01-09 |
| CENTRAL PARK BLOEM | 53 | 45 | 45 (12,589) | 1 | 4 files with blank tenant | shop+tenant+area | 2026-01-09 |
| CITY CENTRE YORK | 55 | 45 | 45 (4,316) | 1 | COMMON AREA 1… | shop+tenant+area; one shop field starts with a stray `"` | 2025-12-10 |
| CROSSROADS | 46 | 0 | 0 | 0 | ATMs | tenant only | 2026-01-09 |
| EQUINOX | 38 | 24 | 24 (10,880) | 1 | — | shop+tenant+area | 2026-01-09 |
| Evaton | 102 | 86 | 85 (30,298) | 0 | centre management, container | shop+tenant+area | 2025-12-11 |
| FLAMWOOD VALUE | 6 | 4 | 4 (2,940) | 2 | `SHOP 06, Vacant, 450` + `(2)` | shop+tenant+area | 2026-01-09 |
| FLAMWOOD WALK | 33 | 26 | 26 (16,072) | 0 | — | shop+tenant+area | 2026-01-09 |
| Fourways Value Mart | 12 | 0 | 0 | 0 | **Solar, SOLAR PV1, SOLAR PV2, GENERATOR METER**, COMMON AREA | tenant only | 2025-12-11 |
| KOKSTAD | 22 | 17 | 17 (6,619) | 0 | — | shop+tenant+area | 2026-01-09 |
| KURUMAN MALL | 171 | 0 | 0 | 1 | **`Kuruman_Solar_Meter_No3_<serial>`**, `Kuruman_Kuruman_-_HT_1_<serial>` (HT = likely MV/bulk) | **meter code `E####`** (165 of 171) | 2026-02-01/02 |
| LEBOWAKGOMO | 30 | 24 | 24 (7,349) | 0 | — | shop+tenant+area | 2026-01-09 |
| MAHIKENG STATION CENTRE | 14 | 14 | 14 (7,799) | 0 | 3 with blank tenant | shop+tenant+area | 2026-01-09 |
| MAYVILLE MALL | 42 | 0 | 0 | 0 | — | tenant only | 2026-01-09 |
| MERINO MALL | 102 | 71 | 0 | 8 | **MDB-1.1/2.1/3.1 Bulk, Main Meter (+2), Local Main (+7 numbered copies)** | `DB <shop>`, `Merino Mall - <serial>`, `merino_E####_<serial>` | 2026-01-19 → 02-02 |
| MONUMENT CENTRE | 30 | 25 | 25 (7,632) | 0 | 4 ATMs | shop+tenant+area | 2026-01-08/09 (+4 on 03-19) |
| MORONE (KAPANE) - KSC | 34 | 0 | 0 | 0 | ATMs | tenant only | 2026-01-08 (+22 on 03-19) |
| PALM SPRINGS | 48 | 40 | 40 (16,714) | 0 | — | shop+tenant+area | 2026-01-08 |
| PARK CENTRAL | 42 | 36 | 37 (8,465) | 0 | — | shop+tenant+area | 2026-01-08 |
| PARKDENE | 89 + **1 `.xlsx`** | 0 | 48 (18,235) | 0 | — | tenant+area (CamelCase, e.g. `BurgerKingDT, 189`), `Meter <serial>` (41), `PDB_<serial>_<label>_`; xlsx `PDB_<serial>_<label>_22m2V.xlsx` | 2026-02-01/02 (+2 in March) |
| PRINCESS MKABAYI MALL | 126 | 0 | 0 | 0 | none identifiable | **`Meter <8-digit serial>` only** (126 of 126) | 2026-02-01/02 |
| RUSTENBURG MALL | 144 | 0 | 0 | 0 | none identifiable | **meter code `E####` only** (144 of 144) | 2026-02-01/02 |
| RUSTENBURG PLAZA | 38 + 32 in `_consolidated/` | 34 | 35 (10,162) | 2 | AC, DB-B | standard grammar; subfolder uses `RP - <TENANT> <area>.csv` (24/32 match a main-folder tenant) | 2026-01-07; `_consolidated` 2026-03-15 |
| SEGONYANA | 30 | 3 | 3 (546) | 0 | **`<serial>_TOTAL LOAD`, `<serial>_BULK` ×2, `<serial>_LOCAL MAIN` ×2** | `<8-digit serial>_<label>` (27) | 2026-02-02 |
| STERKSPRUIT | 68 | 54 | 54 (17,214) | 1 | 7 ATMs | shop+tenant+area | 2025-12-09/10 |
| THABAZIMBI | 36 | 21 | 0 | 2 | **Bulk Meter, Generator, Solar**, COMMON AREA ×3, VACANT ×8 | shop+tenant, no area | 2026-02-01 |
| THAMBI | 23 | 15 | 14 (5,167) | 0 | 5 ATMs | shop+tenant+area; shop field `11A,13,12` contains commas | 2026-01-06 |
| THE PLAZA (NELSPRUIT) | 60 | 0 | 0 | 0 | — | tenant only | 2026-01-06/07 |
| TOWN SQUARE | 81 | 66 | 0 | 9 | **PV, PV Meter (+2)**, `Local Meter` ×5 | `DB <shop>` | 2026-01-20 → 02-01 |
| VENDA PLAZA | 40 | 31 | 31 (9,588) | 0 | — | shop+tenant+area; shop `C2, C3 & C4` contains `, ` | 2026-01-06 |
| VILLAGE WALK | 23 | 17 | 17 (9,478) | 0 | **SOLAR PV1** | shop+tenant+area | 2025-12-11 |
| WESKUS | 93 | 0 | 0 | 0 | ATMs | tenant only | 2026-01-05/06 |
| WHITE RIVER | 2 | 0 | 0 | 0 | **SOLAR PLANT 240, SOLAR PLANT 360** (the folder holds only solar meters) | tenant only | 2026-01-05 |
| YARONA | 27 | 19 | 20 (5,188) | 0 | **BULK METER, GENERATOR METER**, CENTRE MANAGEMENT | shop+tenant+area; shop `SHOP 040,04B,L4,L007B` | 2026-01-05 |

\* The "area" figure is the trailing numeric field of the filename, summed. Reading it as **m² GLA** is an inference. Values such as SHOPRITE 3000, ATM 16 and KIOSK 42 fit that reading, and the PARKDENE xlsx carries an explicit `22m2`. The file contents have not confirmed it.

**Meter classification from labels only (content unverified):**
- **Tenant/shop sub-meters:** the vast majority, about 1,950 files.
- **Bulk/incomer/council-side:** YARONA `BULK METER`; SEGONYANA `TOTAL LOAD`, `BULK` ×2, `LOCAL MAIN` ×2; MERINO `MDB-x.1 Bulk` ×3, `Main Meter` ×2, `Local Main` ×8; 204 Oxford `MAIN INCOMER 1/2`; THABAZIMBI `Bulk Meter`; KURUMAN `HT_1`. That is about 20 files.
- **Generator:** YARONA, THABAZIMBI, 204 Oxford, Fourways (4).
- **Solar/PV:** WHITE RIVER ×2, Fourways ×3, VILLAGE WALK, TOWN SQUARE ×3, THABAZIMBI, KURUMAN (11). These must not be summed into load, and their energy may sit in the export (`kWh-`) channel (see §5).
- **Common area / ATM / DB / vacant / spare:** landlord load. Vacant meters are expected to read near zero.
- **Unclassifiable from the name:** PRINCESS MKABAYI (126, serial only), RUSTENBURG MALL (144, `E####` only), KURUMAN (165 `E####`), PARKDENE `Meter <serial>` (41). About **476 files (~23%) need an external meter register** to tell tenant from bulk from PV.

### 1.3 Naming conventions

The dominant grammar covers 2,014 of the 2,079 CSVs:

```
{SITE}, {SHOP_NO}, {LABEL}, {AREA}[ (n)].csv
```
- `SHOP_NO` is often blank (`, , `). It can contain commas **without** a following space (`11A,13,12`), commas **with** a space (`C2, C3 & C4`), or a stray leading quote (`"4-5-6`).
- `LABEL` is the tenant, DB or meter label. It can be blank (`152E, , 11`), have leading or trailing spaces (`,  DYNAMIC BEDDING`, `ABSA ATM , `), or embed a meter serial (`Meter 35575535`, `36724764_TOTAL LOAD`, `merino_E3274_33883274`, `PDB_36338548_Kiosk5_`).
- `AREA` is blank or numeric, possibly decimal (`227.5`, `62.6`).
- ` (n)` marks re-downloads or duplicate channels (27 files). Example: MERINO `Local Main` has 8 distinct files `Local Main`, `(2)`…`(7)`. These are **probably different meters sharing one label** rather than duplicates, which content comparison would have to confirm.

A robust filename parse: split on `", "`; `site = first`, `area = last` (numeric or blank, after removing ` (n)`), `label = second-last`, `shop = join(middle, ", ")`.

**Variants outside the grammar:**
- `RUSTENBURG PLAZA/_consolidated/RP - <TENANT> <AREA>.csv` (32). Created 2026-03-15, two months after the main folder. The name suggests per-tenant merges of several meters or periods.
- `BIYELA CENTRE/BIYELA SQUARE/BC2 - <TENANT>.csv` (13). This mirrors the top-level `BIYELA SQUARE/` folder (11 of 13 names match). It is a **cross-folder duplicate risk**.
- `PARKDENE/PDB_<serial>_<label>_22m2V.xlsx`, a spreadsheet export among the CSVs.

**WM Solar ignores all of this filename metadata.** `BulkCsvDropzone.tsx:385-392` stores the whole filename (minus `.csv`) as both `site_name` and `shop_name`, so shop number, area and site are never split out.

---

## 2. File formats

### 2.1 Observed formats: NOT DETERMINABLE

Clustering by header signature needs file bytes, and none were readable (§0). The table below is the brief's checklist with its status.

| Attribute | Status |
|---|---|
| Source system, delimiter, preamble, column names | NOT DETERMINABLE |
| Units (kWh / kW / kVA / kvarh / V / A / PF), interval, timestamp format/TZ | NOT DETERMINABLE |
| Cumulative register vs interval, multi-channel, missing markers, DST artefacts, encoding/BOM | NOT DETERMINABLE |
| Representative 3-line excerpts | **Not provided.** Inventing them would be fabrication. |

### 2.2 Indirect evidence about likely formats (hypotheses, not observations)

1. **Meter serial style.** Eight-digit serials in the 32…36xxxxxx range (SEGONYANA, PRINCESS MKABAYI, PARKDENE, MERINO), `E####` asset codes (KURUMAN, RUSTENBURG MALL) and the `PDB_` prefix suggest **at least two or three different export sources or naming regimes**. The vendor cannot be identified from names alone.
2. **The WM Solar code base anticipates these header families** (the author presumably saw them in real files):
   - **PnP SCADA**: line 1 `,"<meter>",YYYY-MM-DD,YYYY-MM-DD`; line 2 `rdate,rtime,kWh+,kvarh+,kWh-,kvarh-,kVA,pf,Status` (`src/components/loadprofiles/utils/csvTypeDetection.ts:20,62`; spec §Format Detection 1; `supabase/functions/process-scada-profile/index.ts:165-178`).
   - **PnP SCADA "non-standard"**: a first line that contains `pnpscada` / `scada.com`, with the header found somewhere within the first 10 lines (`BulkCsvDropzone.tsx:66-94`).
   - **Excel-saved variants** with a `sep=` first line and BOM (`BulkCsvDropzone.tsx:48-57`; `process-scada-profile/index.ts:465-467`).
   - Value headers `kwh_del` and `P1 (kWh)` (`BulkCsvDropzone.tsx:160-161`), which suggests a Landis/Elster-style or AMR export exists somewhere in WM Solar's inputs.
   - A `Timestamp,kwh_export` style with mixed date formats. This is the only fixture, `simulation/data/meter_data.csv`, and it is **synthetic** (7 lines: `Timestamp,kwh_export` / `01-Jan-24 00:00,12.5` / `01/01/2024 04:00,15.0` / `2024-01-01 05:00,20.0`). It tests date parsing only, not any real export.
3. **The consolidation summaries come as `.csv` + `.xls` pairs.** That points to a tool that writes both formats: probably WM Solar or a helper script. No code in `wmsolar-main` references "Consolidation" (grep found nothing), so the producer is outside this repo.

---

## 3. Data-quality statistics: NOT DETERMINABLE

No content was readable, so none of these can be computed: gaps, zeros, negatives, spikes, overlapping periods, or year mismatches across meters.

Two things **can** be said from metadata:
- **Export dates within a site vary by up to about 3 months.** Examples: ABAQULUSI 01-12 vs 03-17; MORONE 01-08 vs 03-19; RUSTENBURG PLAZA 01-07 vs 03-15; 204 Oxford 2025-12-08 → 2026-01-05. If the exports were rolling "last 12 months" pulls, meters of one site could cover **different periods**. The importer must check period alignment per site and not assume it.
- **Duplicates.** 27 ` (n)` files; 16 sites repeat a label (e.g. THABAZIMBI `VACANT` ×8, MERINO `Local Main` ×8, TOWN SQUARE `Local Meter` ×5); the two cross-folder mirrors (`_consolidated`, `BIYELA SQUARE`). Any of these can double-count a site total unless content hashes and serials are compared.

The **bulk-vs-sum reconciliation** is the key check once data is readable. Six sites have both bulk and tenant meters: YARONA, SEGONYANA, MERINO, 204 Oxford, THABAZIMBI, KURUMAN (HT). For those, compare Σ tenant kWh against bulk kWh per interval to measure common-area and loss load, and to catch double counting.

---

## 4. Consolidation_Summary files

- **27 sites have one:** 25 in `001. COMPLETED SITES/` plus FLAMWOOD VALUE and SEGONYANA at the root, which are presumably still in progress. Most sites have both `.csv` and `.xls`. Exceptions: BIYELA SQUARE has `.csv` only; BOTLOKWA, CAPRICORN MUTSINDO, CENTRAL PARK BLOEM and MORONE have `.xls` only.
- **13 site folders have no summary:** 204 Oxford, CROSSROADS, Fourways, KURUMAN, MAYVILLE, MERINO, PARKDENE, PRINCESS MKABAYI, RUSTENBURG MALL, THABAZIMBI, THE PLAZA, TOWN SQUARE, WESKUS. These are mostly the serial-coded and bulk-heavy sites.
- **Timing:** created 2026-03-16 → 03-29, after every meter export (latest 03-19). That is consistent with them being **derived per-site roll-ups** of the tenant CSVs. The "completed" folder name suggests a site is finished once its summary exists.
- **Content: NOT DETERMINABLE.** I cannot say whether they hold per-tenant totals, a summed site interval series, or a tenant↔meter mapping. They are the most valuable files to hydrate first (§7). A summary that maps meter→tenant→area would resolve the ~476 serial-only files.

---

## 5. Does WM Solar's current parser handle these files?

The formats themselves cannot be checked. Below are code-verified behaviours that **will** mis-handle properties these files very likely have (sub-hourly energy, bulk/PV channels, gaps). Each item is cited. "Likely impact" is an inference.

| # | Defect (verified in code) | Where | Likely impact on this corpus |
|---|---|---|---|
| 1 | **The server profile averages interval values per hour regardless of unit.** For kWh data it gives kWh/interval, not kW. 30-min data comes out at **half the real kW**; 15-min data at a quarter. The client path does this correctly (sum ÷ days) but the server does not. | `process-scada-profile/index.ts:612-614` (`calculateProfile` = mean of bucket); used by `ScadaImport.tsx` (~lines 182, 193 feed `data.weekdayProfile`) | Any PnP half-hourly kWh file processed through `ScadaImport` understates load ×2 |
| 2 | **Cumulative detection is effectively disabled for files over ~220 rows.** It counts increases over only the first 200 rows but compares that count with `0.9 × dataRows.length` (all rows). | `process-scada-profile/index.ts:222-234` | A register-type export (monotonic kWh) is treated as interval energy, which inflates it enormously |
| 3 | **Cumulative mode keeps the first raw register value as a reading**, which produces a spike on row 1. Rollover returns `current`, which silently loses the true delta. | `index.ts:564-570`, `338-344` | A spike of a whole register value at the first interval |
| 4 | **Missing or blank cells become 0**, not gaps: `parseFloat(x \|\| '0')` and `Number(v) \|\| 0`. | `index.ts:549`; `csvToLoadProfile.ts:445`; `BulkCsvDropzone.tsx` raw_data map (~line 395); `normalise-raw-data/index.ts:38,49,60,138` | Outages and comms gaps read as zero load, which drags profiles down; there is no gap report |
| 5 | **A bulk import of the strict PnP layout sets the header row one line too late.** `startRow = lineOffset + 3` is then used as `headerIdx = startRow - 1`, so the **first data row becomes the header**. There is then no `date` header → "No date column" failure, or the row is misread. The wizard uses `startRow: 2` correctly. | `BulkCsvDropzone.tsx:75,80` vs `311`; wizard `CsvImportWizard.tsx:249` | Drag-and-drop of standard PnP files may fail or lose data. Needs a test on a real file. |
| 6 | **Import/export channel ambiguity.** Header matching takes the first column containing `kwh`, which is `kWh+` (import) ahead of `kWh-` (export). | `BulkCsvDropzone.tsx:163`; `index.ts:216-218`; `normalise-raw-data/index.ts:129` | For the 11 **solar/PV meters** the generation is probably in `kWh-`. Picking `kWh+` reports PV as near-zero "load". Net-metered bulk meters lose export. |
| 7 | **Only one value channel is kept.** kvarh, kVA and PF are ignored (kVA is only optional on the server). | `index.ts:515,603`; Bulk path | kVA maximum demand cannot be rebuilt. Tariff demand charges and PF are lost. |
| 8 | **Naive `split(delimiter)`** on the server and in the normaliser: no quote handling. The edge function only strips outer quotes per cell. | `index.ts:481-485`; `normalise-raw-data/index.ts:126,135`; `MeterAnalysis.tsx:69-98`; `useMonthlyConsumption.ts:109-118` | Meter names in the PnP preamble that contain commas (like the filenames, e.g. `11A,13,12`) shift columns |
| 9 | **The number cleaner `replace(/[^\d.-]/g,'')` breaks decimal commas** (`12,5` → `125`) and thousand separators in semicolon files. | `index.ts:225,549`; `csvToLoadProfile.ts:445` | A ×10 or ×100 error if any export is in a ZA/EU locale |
| 10 | **Server response truncates `rawData` to 5,000 points** (~104 days of 30-min data). | `index.ts:639` | A year of data cannot be re-analysed from what is stored via this path |
| 11 | **Timezone mix in the client.** Dates are built in local time (SAST) but day keys use `toISOString()` (UTC), so 00:00–01:59 readings go into the previous day's key. | `csvToLoadProfile.ts:441,484` | Day counts, weekday/weekend split and raw_data dates are slightly wrong |
| 12 | **Unknown month abbreviation silently becomes January.** | `normalise-raw-data/index.ts:81` | Silent misdating |
| 13 | **Negatives are dropped by default** (`filter`). | `index.ts:573-579`; spec §Negative | Hides export or reverse-CT wiring on solar/bulk meters instead of flagging it |
| 14 | **The filename metadata described in §1.3 is never parsed.** | `BulkCsvDropzone.tsx:385-392` | Shop number and m² (needed for kWh/m² benchmarks) are thrown away |
| 15 | **`.xls` / `.xlsx` are not supported in the load-profile path.** | no xlsx reader in `loadprofiles/utils` | The PARKDENE xlsx and all 27 summary `.xls` files cannot be imported |

What the parser does well, and E-Site should keep: `sep=`/BOM stripping; PnP preamble extraction of meter name and date range; interval-mode detection (`csvToLoadProfile.ts:76-130`); the client's correct energy aggregation (`csvToLoadProfile.ts:531-560`); and a quote-aware row splitter in the bulk path (`BulkCsvDropzone.tsx:292-308`).

---

## 6. Recommended import specification for E-Site

### 6.1 Pipeline

1. **Ingest.** Store the original bytes unchanged in Storage (`meter-raw/<org>/<site>/<sha256>.<ext>`). Record sha256, byte size, original filename and uploader. Deduplicate on sha256, so ` (n)` copies and cross-folder mirrors collapse automatically.
2. **Filename parse** (§1.3 grammar) into `site_hint, shop_no, label, area_m2_hint, dup_index, serial_hint`. `serial_hint` comes from `/\b(3\d{7})\b/`, `/\bE\d{3,5}\b/` and `PDB_(\d+)_`. These are **hints** that the user confirms, never facts.
3. **Sniff.** Decode as UTF-8 with BOM strip, falling back to cp1252. Normalise CRLF. Then detect, **in this order**:
   - `.xls`/`.xlsx` → sheet reader. Apply the same detection to the first sheet.
   - A `sep=X` line sets the delimiter.
   - **PnP SCADA**: a line within the first 3 matching `^,?"?(.+?)"?,(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})`, followed by a line with `rdate` and `rtime` → header = that next line. Also accept the `pnpscada`/`scada.com` preamble variant with a header search within the first 10 lines.
   - Otherwise, generic: the header is the first row whose cells are mostly non-numeric **and** whose next 20 rows parse as date plus number.
   - Delimiter: choose the candidate (`, ; \t |`) with the most **consistent** column count across 20 lines. Do not simply count characters.
   - Decimal separator: if the delimiter is `;` and the values match `^\-?\d+,\d+$` → decimal comma.
4. **Channel mapping.** Map each numeric column to `{quantity, direction, unit}`: `kWh+`→(energy, import, kWh), `kWh-`→(energy, export), `kvarh±`, `kVA`→(apparent power, kVA), `pf`, `V`, `A`, plus a status column. **Keep every channel.** Choosing the primary channel is a separate, visible decision. The default is `energy/import`, but for meters labelled solar/PV/generation it defaults to **export** and asks the user to confirm.
5. **Timestamp.** Combine date and time. The format is fixed per file (YMD/DMY/MDY) by testing every row, never row by row. Handle `24:00`. Convention is **interval-ending** unless proven otherwise; detect this from whether the first reading of each day is 00:00 or 00:30. Timezone is `Africa/Johannesburg` (UTC+2, no DST), stored as UTC `timestamptz`.
6. **Interval and register type.** Interval = mode of Δt (1/5/10/15/30/60). Cumulative = at least 98% non-decreasing across **all** rows **and** a median step much smaller than the level. Deltas: drop the first row. On a decrease, flag a rollover or meter exchange and ask the user; do not silently take `current`.
7. **Normalise** to a canonical interval series (below). Blank or invalid values become **NULL with a quality flag**, never 0.
8. **Validate and report** (6.3), then commit only after the user accepts.

### 6.2 Canonical storage shape

```
solar.meter_files      (id, site_id, sha256 UNIQUE, storage_path, original_name, parsed_filename jsonb,
                        detected_format, delimiter, decimal_sep, header_row, encoding,
                        preamble jsonb, detection_confidence, uploaded_by, uploaded_at)
solar.meters           (id, site_id, serial, label, shop_no, area_m2, kind CHECK in
                        ('tenant','bulk','council','generator','solar','common','vacant','unknown'),
                        parent_meter_id NULL  -- tenant under bulk, for reconciliation
                        UNIQUE(site_id, serial) where serial is not null)
solar.meter_channels   (id, meter_id, file_id, source_column, quantity, direction, unit,
                        interval_min, is_cumulative, tz_convention, is_primary)
solar.meter_readings   (channel_id, ts_end timestamptz, value numeric NULL, quality smallint,
                        PRIMARY KEY (channel_id, ts_end))   -- quality: 0 ok, 1 missing, 2 estimated,
                                                            -- 3 negative, 4 spike, 5 duplicate-ts, 6 status≠OK
solar.meter_import_reports (file_id, report jsonb, accepted_by, accepted_at)
```
Derived views, not stored truth: hourly kW per meter (`Σ kWh per hour` for energy, `mean` for power), weekday/weekend and month×hour profiles, and site totals over `kind='tenant'` vs `kind='bulk'`. Volume check: about 2,000 meters × 17,520 half-hours ≈ 35 M rows per year per channel. That is fine in Postgres if the table is partitioned by site, or it can be kept as Parquet in Storage with only aggregates in Postgres.

### 6.3 Validation report shown to the user (per file, then per site)

- Detected format, delimiter, header row, and **every channel with unit and direction**, plus the primary-channel choice and the reason for it.
- Period covered, interval, expected vs present intervals (**completeness %**), and the longest gap.
- Counts of zero runs (≥ 6 h flagged), negatives, duplicate timestamps, out-of-order rows, `24:00` rows and status≠OK rows.
- Spikes: value > Q3 + 10·IQR, or kW > 3× the 99th percentile.
- Unit sanity: implied kW vs `area_m2` (W/m² outside roughly 5–300 → warn) and vs breaker size if known.
- For a cumulative channel: rollovers or resets.
- **Site level:** period alignment across meters (flag differing years or windows); Σ tenant vs bulk per month (reconciliation %); duplicates by sha256 or serial; PV meters excluded from load.
- Explicit accept, edit mapping, or reject. Warnings never block; errors do.

### 6.4 Golden fixtures (once hydrated — §7)

Chosen by filename to cover every structural case. Each fixture's content must be checked and its format confirmed before it becomes a golden test. Store a **truncated and anonymised** copy (≈ 14 days) plus the expected normalised output and report.

| Fixture | Why |
|---|---|
| `YARONA/YARONA, SHOP 050, SHOPRITE, 3000.csv` | Anchor tenant, standard grammar, large area |
| `YARONA/YARONA, , BULK METER, .csv` + `YARONA, , GENERATOR METER, .csv` | Bulk + generator; reconciliation against the other 25 YARONA tenants |
| `WHITE RIVER/WHITE RIVER, , SOLAR PLANT 240, .csv` | PV meter: tests export-channel selection and negatives |
| `Fourways Value Mart/…, , SOLAR PV1, .csv` and `…, , Solar, .csv` | Two PV labelling styles on one site; possible duplicate |
| `KURUMAN MALL/…, , Kuruman_Solar_Meter_No3_58106693, .csv` and `…, , E0085, .csv` | Serial-embedded label + `E####` code regime |
| `SEGONYANA/…, , 36724764_TOTAL LOAD, .csv` + `SEGONYANA_Consolidation_Summary.csv` + `.xls` | Serial_label regime; summary↔CSV relationship; xls reader |
| `PRINCESS MKABAYI MALL/…, , Meter 35575535, .csv` | Serial-only meter (unclassifiable without a register) |
| `MERINO MALL/…, , Local Main, .csv` and `…, , Local Main,  (7).csv` | Same label, many files: dedupe-vs-distinct logic |
| `FLAMWOOD VALUE/…, SHOP 06, Vacant, 450.csv` and `… 450 (2).csv` | ` (n)` re-download: sha256 dedupe; vacant ≈ zero |
| `THAMBI/THAMBI, 11A,13,12, RAGE, 225.csv`, `VENDA PLAZA/…, C2, C3 & C4, KFC, 270.csv`, `CITY CENTRE YORK/…, "4-5-6, CAPITEC BANK LTD, 272.csv` | Filename-grammar edge cases (commas, `, ` inside shop, stray quote) |
| `BOTLOKWA PLAZA/…, 20, KFC, 227.5.csv` | Decimal area |
| `RUSTENBURG PLAZA/_consolidated/RP - ABSA 525.csv` + its main-folder counterpart | Alternate grammar; merged-file overlap/duplicate detection |
| `BIYELA CENTRE/BIYELA SQUARE/BC2 - …csv` vs `BIYELA SQUARE/…` | Cross-folder mirror dedupe |
| `PARKDENE/PDB_36506619_KFCDT_22m2V.xlsx` | Only xlsx meter export; `PDB_` naming |
| `204 Oxford/…, , MAIN INCOMER 1, .csv` | Incomer; oldest export batch (2025-12-08) for period-alignment tests |
| Synthetic set (hand-built) | 30-min kWh vs 30-min kW with identical energy (catches defect #1); cumulative register with rollover (#2/#3); blank cells (#4); decimal-comma `;` file (#9); `24:00` and interval-ending; 15-min file; status≠OK rows |

---

## 7. Unblocking step (needs the user, not done here)

Hydrating the files is a download into Dropbox, so it needs the user's go-ahead. The smallest useful action is to right-click in Finder → **Make available offline** on:
1. The 29 `*_Consolidation_Summary.*` files (root + `001. COMPLETED SITES`).
2. `YARONA/`, `SEGONYANA/`, `WHITE RIVER/` and `KURUMAN MALL/`. Together these cover tenant, bulk, generator, solar and all three serial regimes.

After that, rerun this review's scripts (`solar-review/work/inv.py`, `names.py`). The same scripts complete §2–§4 with real header clusters, excerpts and quality statistics. File sizes are not known until then (see §0 — the placeholder does not carry them).
