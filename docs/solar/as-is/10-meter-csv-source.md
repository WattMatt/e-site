# 10 — Meter CSV source folder review (`006. METER CSV`)

**Date:** 2026-09-28 (second pass, with the files readable)
**Scope:** `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV`, compared against WM Solar (`scratchpad/wmsolar-main`) parser code.
**Method:** read-only. Every one of the 2,140 files was opened and read in full (2.66 GB). Nothing in Dropbox was modified. The scripts and the per-file profile are in `solar-review/work/`: `prof.py` → `prof.json` (one record per CSV), `bodyhash.json` (hash of each file's data rows, with the preamble excluded), `summ_xls.json` (the 27 summary workbooks), and `harness/` (WM Solar's parser code, run unmodified against real files; see §5). Excerpts in this document are anonymised: tenant names are replaced with `<TENANT>` and meter serials with `3xxxxxxx`.

---

## 0. Headline

The first pass could read nothing, because every file was a 0-byte Dropbox placeholder. All 2,140 files are now hydrated and read. The findings that matter most:

1. **There are seven file shapes, not one** (§2). Two are real meter exports: a `sep=,` / `date,p14` power export (1,242 files) and PnP SCADA in two shapes (703 + 73). The other shapes are artefacts: escaped single-line copies, download logs, a derived column and the summaries. **No file uses the `rdate,rtime,kWh+,kWh-` layout** that WM Solar's PnP detector was written for.
2. **Most of the PnP SCADA folders do not contain the meters their filenames claim.** The 703 PnP "power" files hold only **29 distinct meter serials** and **43 distinct data series**. One series appears under **121 filenames across six malls**. KURUMAN MALL's 170 meter files contain 13 series, and none of them is a Kuruman meter according to the downloader's own log. TOWN SQUARE's 78 hold 6. For these eight sites **the filename is not the meter; only the serial in line 1 is** (§1.4).
3. **Units differ by format and are mostly power, not energy.** `p14` and PnP `P (per kW)` are **average kW**. PnP `P1 (kWh)` is **kWh per 30 minutes**. WM Solar gets this wrong in both directions: its **client path doubles** the `p14` files, and its **server path halves** the kWh files. It also cannot read the PnP power files at all, yet reports success (§5).
4. **The consolidation summaries hold no energy totals.** They are meter→letting-plan mapping sheets: meter file, matched layout name, shop number, area in m², and match method (`Direct/Substring` / `Gemini LLM` / `UNMAPPED`), plus manual QA columns. The trailing number in a filename **is** that sheet's `Area (sqm)`. This is confirmed for 623 files by exact shop+area match (§4).
5. **Solar meters record generation on the import channel** (`p14`, `P1`), not on export. The earlier review's concern about `kWh+` vs `kWh-` does not apply to this corpus (§5).

---

## 1. Inventory

### 1.1 Top level

| Artefact | Count | What it is (verified by reading) |
|---|---|---|
| 41 site folders | 2,053 CSV + 1 XLSX | Meter exports, plus artefacts, per site (§2) |
| Root `FLAMWOOD VALUE_…` and `SEGONYANA_Consolidation_Summary.csv/.xls` | 4 | Mapping sheets (§4) |
| `001. COMPLETED SITES/` | 24 CSV + 25 XLS | `<SITE>_Consolidation_Summary.{csv,xls}` for 25 sites (three CSV names carry a ` 14.26.09` time suffix) |
| `002. OVERALL SITE LAYOUTES/` | 33 PDF | Letting plans. These are the source of the summaries' shop numbers and areas. Not parsed here. |

All CSVs are UTF-8 without a BOM. None is empty on disk. Of the 2,079 CSVs, 2,050 are meter-data shaped (formats A–D), 2 are download logs (E), 1 is derived (F) and 26 are summaries (G).

### 1.2 Per-site folders (data periods read from content)

**files** = CSVs in the folder, subfolders included. **series** = distinct non-empty data series, by body hash. **empty/0** = files with no data rows / files whose values are all zero. **Period** = earliest first reading → latest last reading in the folder. **span** = median per-file span in days. **<30 d** = files covering under 30 days.

| Site | files | format | series | empty/0 | Period (from data) | span d | <30 d | interval (min) |
|---|---|---|---|---|---|---|---|---|
| 204 Oxford | 76 | A | 73 | 3/3 | 2023-10-30 → 2025-12-11 | 762 | 10 | 30 (60), 60 (13: `a14`) |
| ABAQULUSI PLAZA | 56 | A | 56 | 0/0 | 2023-11-17 → 2026-03-17 | 689 | 6 | 30 |
| BIYELA CENTRE (+`BIYELA SQUARE/` sub) | 38 | A | 36 | 2/0 | 2024-11-26 → 2026-03-17 | 369 | 8 | 30, 60 (3) |
| BIYELA SQUARE | 13 | A | 13 | 0/0 | 2024-11-26 → 2026-01-09 | 370 | 2 | 30 |
| BLOEM VALUE MART | 22 | A | 20 | 1/0 | 2023-10-03 → 2026-03-17 | 790 | 3 | 30 |
| BOTLOKWA PLAZA | 30 | A | 27 | 3/2 | 2024-11-21 → 2026-03-17 | 375 | 3 | 30 |
| CAPRICORN MUTSINDO | 26 | A | 26 | 0/0 | 2024-11-20 → 2025-12-01 | 376 | 0 | 30 |
| CENTRAL PARK BLOEM | 53 | A | 50 | 3/0 | 2023-10-01 → 2026-03-11 | 792 | 2 | 30 |
| CITY CENTRE YORK | 55 | A | 54 | 0/0 | 2024-11-25 → 2025-12-01 | 370 | 2 | 30 |
| CROSSROADS | 46 | A | 43 | 3/1 | 2023-08-16 → 2025-12-01 | 837 | 0 | 30 |
| EQUINOX | 38 | A | 35 | 2/1 | 2024-11-15 → 2026-01-09 | 381 | 2 | 30 |
| Evaton | 102 | A | 102 | 0/0 | 2023-07-21 → 2025-12-01 | 861 | 0 | 30 |
| FLAMWOOD VALUE | 6 | A | 5 | 1/0 | 2024-10-25 → 2025-12-01 | 402 | 0 | 30 |
| FLAMWOOD WALK | 33 | A | 32 | 0/0 | 2024-07-25 → 2026-03-18 | 494 | 1 | 30 |
| Fourways Value Mart | 12 | A | 12 | 0/0 | 2024-10-25 → 2025-12-01 | 402 | 0 | 30 |
| KOKSTAD | 22 | A | 22 | 0/0 | 2022-09-30 → 2025-12-01 | 407 | 0 | 30 |
| **KURUMAN MALL** | 171 | B 170 + E 1 | **13** | 0/0 | 2024-02-01 → 2026-02-02 | 730 | 0 | 30 (131), **1440 (39)** |
| LEBOWAKGOMO | 30 | A | 29 | 1/0 | 2023-09-20 → 2026-01-09 | 802 | 2 | 30, 60 (5) |
| MAHIKENG STATION CENTRE | 14 | A | 14 | 0/0 | 2024-06-24 → 2026-01-09 | 525 | 3 | 30 |
| MAYVILLE MALL | 42 | A | 42 | 0/0 | 2025-01-08 → 2026-01-09 | 322 | 4 | 30 |
| MERINO MALL | 102 | C 69 + B 33 | 71 | 3/2 | 2024-02-01 → 2026-02-02 | 330 | 0 | 30, 1440 (3) |
| MONUMENT CENTRE | 30 | A | 30 | 0/0 | 2024-02-19 → 2026-03-19 | 612 | 4 | 30 |
| MORONE (KAPANE) - KSC | 34 | A | 33 | 1/2 | 2024-08-07 → 2026-03-19 | **6** | **18** | 30 |
| PALM SPRINGS | 48 | A | 47 | 1/0 | 2023-04-12 → 2026-03-19 | 881 | 4 | 30 |
| PARK CENTRAL | 42 | A | 41 | 1/0 | 2023-09-18 → 2026-03-19 | 805 | 3 | 30 |
| **PARKDENE** | 89 + 1 xlsx | B 88 + F 1 | **17** | 0/0 | 2024-02-01 → 2026-02-02 | 730 | 0 | 30 |
| **PRINCESS MKABAYI MALL** | 126 | B | **19** | 0/0 | 2024-02-01 → 2026-02-02 | 730 | 0 | 30 (84), **1440 (42)** |
| **RUSTENBURG MALL** | 144 | B 143 + E 1 | **13** | 0/0 | 2024-02-01 → 2026-02-02 | 730 | 0 | 30 (125), **1440 (18)** |
| RUSTENBURG PLAZA (+`_consolidated/`) | 70 | A 38 + D 32 | 38 | 0/0 | 2024-11-20 → 2025-12-01 | 376 | 1 | 30 |
| **SEGONYANA** | 30 | B | **4** | 0/0 | 2025-10-01 → 2026-02-02 | 123 | 0 | 30 |
| STERKSPRUIT | 68 | A | 67 | 1/2 | 2024-08-13 → 2025-12-01 | 472 | 0 | 30 |
| **THABAZIMBI** | 36 | B 35 + C 1 | **4** | 0/0 | 2024-02-01 → 2026-02-01 | 730 | 0 | 30 |
| THAMBI | 23 | A | 23 | 0/0 | 2023-07-26 → 2026-01-06 | 859 | 1 | 30 |
| THE PLAZA (NELSPRUIT) | 60 | A | 60 | 0/0 | 2024-06-11 → 2026-01-06 | 538 | 5 | 30 |
| **TOWN SQUARE** | 81 | B 78 + C 3 | **6** | 0/0 | 2024-02-01 → 2026-02-01 | 730 | 0 | 30 |
| VENDA PLAZA | 40 | A | 40 | 0/0 | 2024-09-27 → 2026-03-19 | 430 | 2 | 30 |
| VILLAGE WALK | 23 | A | 23 | 0/0 | 2022-01-01 → 2025-12-11 | 407 | 1 | 30, 60 (4: `a14`) |
| WESKUS | 93 | A | 93 | 0/0 | 2022-05-26 → 2026-01-05 | 1,281 | 2 | 30 |
| WHITE RIVER | 2 | A | 2 | 0/0 | 2024-02-08 → 2025-12-01 | 662 | 0 | 30 |
| YARONA | 27 | A | 27 | 0/0 | 2023-10-31 → 2026-01-05 | 477 | 1 | 30 |

What each file represents:
- **Format A:** one meter channel, or a few, per file, exported as a whole history up to the export date. 1,107 of 1,219 non-empty A files end exactly on **2025-12-01 23:30**. The later "re-downloads" seen in the first pass by mtime (the `+8 on 03-17` style batches) are **7-day files**: 2026-01-02→01-09 and 2026-03-12→03-19. They replace a missing file with one week of data, not a year. Start dates spread from 2022 to 2026 (2022: 83, 2023: 404, 2024: 540, 2025: 130, 2026: 62).
- **Format B/C:** a fixed two-year PnP window, 2024-02-01 → 2026-02-02 (B), or ~2025-02 → 2026-01-20 (C, MERINO). SEGONYANA B files are 2025-10-01 → 2026-02-02.
- **102 B files are daily**, not half-hourly: one row per day at 00:00, value = daily **average kW** (§2, format B).

### 1.3 Naming conventions

The dominant grammar still holds for **2,014 of 2,079** CSVs:

```
{SITE}, {SHOP_NO}, {LABEL}, {AREA}[ (n)].csv
```

The name-only findings stand: `SHOP_NO` may contain `,` or `, ` or a stray `"`; `LABEL` may be blank or embed a serial; ` (n)` marks repeats. The robust split (site = first, area = last, label = second-last, shop = middle joined by `", "`) parses them all. New from content:

- **`AREA` is m² and is copied from the consolidation summary's `Area (sqm)`.** For 623 files, the filename's (shop, area) pair matches a summary row exactly, and in 622 of those the filename label equals the summary's `Matched Layout Name`. The one exception is a mojibake name (`CAFEÃÅ`). Another 53 match on area only; these have a blank or reformatted shop number. The summary took its areas from the letting-plan PDFs by name matching, and 105 of the summary rows were matched by **`Gemini LLM`**. **So an area is a planning figure, sometimes machine-matched, not a measured value** (§4).
- **` (n)` does not mean "same meter again".** Compared by content:
  - FLAMWOOD VALUE `…Vacant, 450.csv` is **empty** (8 bytes, `sep=,` only).
  - Its `(2)` and `(3)` are **byte-identical to Fourways Value Mart `SHOP 107 VACANT` and `SHOP 117 VACANT`**.
  - MERINO `Local Main` … `(7)` belong to the large cross-site duplicate groups (§1.4).
- **Labels are crossed between FLAMWOOD VALUE and Fourways Value Mart.** Five data series are identical across the two folders, including `BABY CITY` ↔ `HANSON HOME` swapped both ways, and `Food Lovers`. At least one folder is mislabelled.
- **Variants outside the grammar:**
  - `RUSTENBURG PLAZA/_consolidated/RP - <TENANT> <AREA>.csv` (32). Once unescaped, **all 32 are identical to a main-folder file** (format D).
  - `BIYELA CENTRE/BIYELA SQUARE/BC2 - …` (13). **All 13 are identical to the top-level `BIYELA SQUARE/` files**, which confirms the mirror.
  - STERKSPRUIT has four `… - Copy (Unicode Encoding Conflict)` files, which are Dropbox conflict copies.
- **Two "meter" files are not meter data:** KURUMAN `E2495` and RUSTENBURG MALL `E4115` are the batch downloader's progress logs (format E).

### 1.4 Meter identity: the PnP SCADA folders are mostly mis-filed

A format-B file names its meter serial(s) in line 1. Comparing that serial, and the data body, across files:

| Check | Result |
|---|---|
| B files | 703 across 8 sites |
| Distinct serial sets in line 1 | **29** (698 files carry one serial; 4 carry 3–7 serials, i.e. virtual/summed meters) |
| Distinct data bodies | **43** |
| Largest identical-body group | **121 files** (TOWN SQUARE 56, KURUMAN 28, MERINO 25, PARKDENE 6, RUSTENBURG MALL 5, PRINCESS MKABAYI 1), all carrying the same single line-1 serial |
| Filename serial ≠ line-1 serial | 192 files (PRINCESS MKABAYI 118, PARKDENE 32, SEGONYANA 25, MERINO 11, KURUMAN 6) |
| Downloader log (E) | 778 meters listed across Kuruman, Merino, Parkdene, Princess Mkabayi, Rustenburg, Thabazimbi and Town Square. 304 are marked `Downloaded=True`, yet **only 7 of those serials appear as a line-1 serial in any file** |
| Content vs folder, using the log's mall name for each line-1 serial | KURUMAN: 0 own-site / 142 other-site / 28 unknown. TOWN SQUARE: 0 / 66 / 12. MERINO (B part): 0 / 31 / 2. SEGONYANA: 0 / 12 / 18. PRINCESS MKABAYI: 45 / 52 / 29. RUSTENBURG MALL: 110 / 29 / 4. PARKDENE: 79 / 7 / 2. THABAZIMBI: 35 / 0 / 0 |

"Own-site" means only that the serial belongs to that mall. It does not mean the file holds the right meter: the 35 THABAZIMBI files hold 4 series. The pattern fits a scripted downloader that wrote the last successfully fetched meter into every slot whose download failed.

**Across the whole corpus, 2,050 meter-data files contain 1,311 distinct bodies.** Formats A and C are mostly sound: A has 1,242 files and 1,197 unique non-empty series, the remainder being empties, the D/BC2 mirrors and the crossed Flamwood/Fourways pairs. C has 73 files and 70 series. **The format-B corpus is not usable per tenant without re-downloading.**

### 1.5 Meter classification (labels, now checked against content)

- **Solar/PV** (all verified generation-shaped, with the power centroid at solar noon; §2):
  - WHITE RIVER ×2
  - Fourways `SOLAR PV1`, `SOLAR PV2`, `Solar`
  - VILLAGE WALK `SOLAR PV1`
  - THABAZIMBI `Solar`
  - KURUMAN `Kuruman_Solar_Meter_No3_…`. This one is a B file whose body is shared with 22 other filenames, so it is not trustworthy.
- **Energy is on the import channel in every PV meter:**
  - `p14` / `P1` / `Total Solar Active Power` carry the generation.
  - `p23` / `P2` carry ≈0: Σ = 38 kW·intervals against 1.26 M on Fourways `Solar`; P2 Σ = 150 against 1.06 M on Kuruman.
- **Generator:** YARONA `GENERATOR METER` (`Generator Total Power`, mostly 0, max 63 kW), 204 Oxford `GENERATOR 1`.
- **Bulk vs tenants does not reconcile at YARONA.** Monthly Σ of the 25 tenant files is **2.3–2.8× the "BULK METER"**. In March 2025, `BULK METER` 156.7 MWh ≈ `SHOPRITE` 160.2 MWh ≈ `CHECK 1` 155.9 MWh. So the "bulk" meter is at best the anchor's supply, and `CHECK 1` is a check meter duplicating it. **Labels such as BULK or MAIN cannot be trusted for S1 without a single-line diagram.**
- **Non-electric:** two `Volume` files (BIYELA CENTRE `BC1 - …`, 204 Oxford `Medical Suits Toilets`) are **water** meters.

---

## 2. File formats

The formats were clustered by header signature over all 2,079 CSVs, plus the 28 workbooks.

| ID | Files | Sites | Source system | Signature |
|---|---|---|---|---|
| **A** | 1,242 | 32 | Unknown vendor web export (Excel-style `sep=` line) | `sep=,` / blank / `date,<channels>` |
| **B** | 703 | 8 | PnP SCADA, "power" export | `"pnpscada.com", "<serial>"…` / quoted header ending `"DATE", "TIME", "STATUS"` |
| **C** | 73 | 3 (MERINO 69) | PnP SCADA, "energy" export | `pnpscada.com,<serial>` / `Time,P1 (kWh),…,Status,S (kVA)` |
| **D** | 32 | RUSTENBURG PLAZA `_consolidated` | Broken re-save of A | One physical line with literal `\n` escapes |
| **E** | 2 | KURUMAN, RUSTENBURG MALL | Batch-downloader log | `Serial,Name,Downloaded,Timestamp` |
| **F** | 1 (+1 xlsx) | PARKDENE | Hand analysis | `kwh+,,<number>,diversity factor` |
| **G** | 26 CSV + 27 XLS | summaries | Mapping tool (see §4) | `Shop Name,Shop Number,Area (sqm)` (CSV) / `Meter Filename, Matched Layout Name, …, Status, …` (XLS) |

### 2.1 Format A: `sep=,` power export (1,242)

| Attribute | Observed |
|---|---|
| Preamble | Line 1 `sep=,`, line 2 blank, line 3 header. **23 files have only `sep=,`** (8 bytes, no data). |
| Delimiter / decimal | `,` / `.`. Values mostly have 2 decimals (1,134 files), a few 0, 3 or 5. |
| Encoding / line ends | UTF-8, no BOM / CRLF (all) |
| Header | `date,p14` in 1,179 files. Variants: `date,a14` (15), and 26 multi-channel files from `p14,p23`, `p14_l1..l3`, `p23_l1..l3`, `q12`, `q34`, `s14`, `s23`, `a23`, `u_l1..l3`, `i_l1..l3`, `Total Solar Active Power`, `Solar Total Power`, `Generator Total Power`, `total_daily_night_usage`, `Volume`/`volume` |
| Channel vocabulary (inferred from the suffix convention and verified on content) | `p` = active power, `q` = reactive power, `s` = apparent power, `a` = active energy per interval. Suffix `14` = quadrants I+IV (import), `23` = II+III (export), `12` / `34` = reactive quadrant pairs. `_l1..l3` = per phase. `u` = voltage, `i` = current. |
| Units | **`p14` = average kW over the interval** (not stated in the file). Evidence: (a) its siblings are named "Power"; (b) PV peaks are plausible as kW and impossible as kWh/30 min: WHITE RIVER maxima 256 / 385, VILLAGE WALK 669; (c) the two WHITE RIVER plants give 4.0 kWh/kWp/day each if read as kW **with the 240/360 labels swapped**, and 2.7 / 6.0 as labelled, so the labels are probably swapped. **`a14` = kWh per interval** (hourly), a differenced register: it shows paired ±reset spikes (−58,796 then back to normal). |
| Interval | 30 min in 1,186 files. 60 min in 26 (mostly `a14`). 5 files have a 90-min mode and 2 a 120-min mode, which means sparse or irregular logging. |
| Timestamp | `DD/MM/YYYY HH:MM:SS`, local **SAST** (PV centroid within ±0.1 h of local solar noon at four sites; UTC would put it near 10:00). **Row order is mixed: 628 ascending, 591 descending** (newest first). |
| Convention | **Interval-beginning.** Series end at 23:30 of the export day (1,078 files), and there is no `24:00` row and no next-day 00:00. Treat the label as the start of [t, t+Δ). The PV centroid rules out a ±15-min error of the opposite sign only weakly, so the convention should be shown to the user as "detected". |
| Cumulative vs interval | Interval. No file is a register: the 21 "≥98 % non-decreasing" files are flat near-zero series. |
| Missing data | **Absent rows**, never blank cells: 0 blank or non-numeric values in the corpus. |
| Duplicates / 24:00 | 0 duplicate timestamps; 0 `24:00` rows |

```
sep=,

date,p14
31/12/2024 23:30:00,0.01
```

### 2.2 Format B: PnP SCADA "per kW" export (703)

| Attribute | Observed |
|---|---|
| Preamble | Line 1 `"pnpscada.com", "<serial>"[, "<serial>"…]`. 698 files carry one serial. 3 RUSTENBURG MALL files carry 7 (a summed virtual meter) and 1 SEGONYANA file carries 3. One serial has a letter suffix (`…A`). |
| Delimiter | `, ` (comma **plus space**). Header cells are quoted; values are not. |
| Header | `"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"` (475), or `"P1 (per kW)", "Q1 (per kvar)", "P2 (per kW)", "S (per kVA)", "scalar sum S (per kVA)", …` (228) |
| Units | **Average kW / kvar / kVA per interval.** Proof: the daily-interval B files carry the same serial as a half-hourly group, and their mean is 108.25 against the half-hourly mean of 108.29. An energy total would be 48× larger. `P2` = export power. |
| Interval | 30 min (601 files, 35,088 rows = 731 days, or 5,952 rows for SEGONYANA). **1,440 min (102 files):** one row per day at 00:00 (KURUMAN 39, PRINCESS MKABAYI 42, RUSTENBURG MALL 18, MERINO 3). |
| Timestamp | Separate `DATE` `YYYY-MM-DD` and `TIME` `HH:MM:SS`, SAST (Kuruman PV centroid 12:27 against a solar noon of about 12:26). Ascending. |
| Convention | **Interval-ending.** The first row of the window is 00:30, and the day closes at the next day's `00:00:00`. No `24:00` rows. |
| Status | `Ok` or `Calc`. **45.6 % of all B rows are `Calc`**, and in the unique bodies **80 % of `Calc` rows are exactly 0** (420,151 / 523,188), against 23 % of `Ok` rows. `Calc` marks PnP's estimated padding: leading zeros before a meter existed, and filled gaps. As a result, B files look 100 % complete. |
| Precision | Float artefacts, up to 17–18 significant decimals |
| Encoding / line ends | UTF-8, no BOM / CRLF |

```
"pnpscada.com", "3xxxxxxx"
"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"
332.2599999997765, 126.93999999994412, 355.68310502445473, 355.68310502445473, 2025-10-01, 00:30:00, Ok
```

### 2.3 Format C: PnP SCADA "kWh" export (73)

| Attribute | Observed |
|---|---|
| Preamble | Line 1 `pnpscada.com,<serial>` (unquoted). **3 files are header-only** (TOWN SQUARE). |
| Delimiter / decimal | `,` / `.` / LF line ends / UTF-8, no BOM |
| Header | `Time,P1 (kWh),Q1 (kvarh),S (kVAh),P2 (kWh),Q2 (kvarh),Q3 (kvarh),Q4 (kvarh),Status,S (kVA)`. There are 10 columns, and **`Status` is the 9th, not the last**. |
| Units | **kWh (and kvarh, kVAh) per 30-min interval**. The trailing `S (kVA)` = 2 × `S (kVAh)` in all 92,918 rows tested, so it is the interval's average demand. `P2` = export: non-zero in 3 files. |
| Timestamp | `YYYY-MM-DD HH:MM:SS` in one column, SAST, ascending. **Interval-ending**: the first reading is 00:30. |
| Status | Numeric: `0` (70 files), `2048` (3). Meaning not documented. |
| Coverage | ~2025-02 → 2026-01-20 (one file from 2024-05). Completeness ≥ 97.7 %. Longest gap 26.5 h. |

```
pnpscada.com,3xxxxxxx
Time,P1 (kWh),Q1 (kvarh),S (kVAh),P2 (kWh),Q2 (kvarh),Q3 (kvarh),Q4 (kvarh),Status,S (kVA)
2024-05-01 00:30:00,4.819999999999709,0.79999999999995453,4.885939009033691,0,0,0,0,0,9.771878018067381
```

### 2.4 Artefact formats

- **D (32):** one physical line (LF-terminated) in which the record separators are the two characters `\` `n`. It starts `Shop Name,Shop Number,Area (sqm),\ndate,p14\n…`, and the metadata fields are empty. Unescaped, every file equals a main-folder A file. Treat it as a duplicate or reject it; never parse it as data.
  `Shop Name,Shop Number,Area (sqm),\ndate,p14\n31/12/2024 23:30:00,0.66\n31/12/2024 23:00:00,1.62\n…`
- **E (2):** 778 rows `Serial,Name,Downloaded,Timestamp`. `Name` = `<TENANT> ; <DB> ; <MALL>[ ; <TOWN>]`, `Downloaded` = `True`/`False`, ISO timestamps from 2026-02-01 17:16–18:30. Useful as a **serial → name → mall register**, and not as load data.
  `3xxxxxxx,<TENANT> ; <DB> ; <MALL>,True,2026-02-01T17:16:14.432618`
- **F (1):** `kwh+,,238.2377907,diversity factor` then 344 single values. The mean of those values = 238.2377907. This is a derived working column, not an export. Its companion **`PDB_…_22m2V.xlsx`** has 4 sheets: two PnP-B sheets plus a hand-added column `kwh <tenant>` whose formula is **`=A3+A4`**, the sum of two consecutive *kW* half-hours. That value is 2× the hourly kWh, yet it is labelled kWh. It also has a pivot `Average of kwh` by time of day and a sheet combining two meters. **The office's own manual analysis carries the kW/kWh confusion as well.**
- **G:** see §4.

---

## 3. Data-quality statistics

Counted on **unique bodies**, so that duplicates do not inflate them: A = 1,197, B = 43, C = 70.

| Measure | A (`sep=`, kW) | B (PnP kW) | C (PnP kWh) |
|---|---|---|---|
| Completeness (distinct timestamps ÷ expected in span): min / Q1 / median / max | 0.17 / 0.986 / **0.997** / 1.0 | 1.0 everywhere (padded with `Calc`) | 0.977 / 1.0 / 1.0 / 1.0 |
| Files < 90 % / < 50 % | 94 / 7 | 0 / 0 | 0 / 0 |
| Span: median days; < 30 d; ≥ 365 d | 525; **88**; 998 | 730; 0; 39 | 329; 0; 1 |
| Files with any gap / gap > 24 h / > 7 d | 1,130 / 476 / **242** | 0 | 11 / 1 / 0 |
| Longest single gap | 14,337 h (597 days) inside one file | — | 26.5 h |
| Zero run ≥ 6 h / ≥ 7 d; all-zero files | 864 / 165; 11 (+23 empty) | 43 / 32 (mostly `Calc` lead-in) | 12 / 5; 2 (+3 empty) |
| Negatives | 178 files, 8,828 values. Most are tiny (−0.01 ×2,048, −0.002 ×926, −0.06 ×589). 3,816 are < −0.1, including register-reset artefacts down to **−74,461** | 0 | 0 |
| Spikes > 3 × P99 (files / values) | 86 / 3,576 | 2 / 253 | 2 / 58 |
| Duplicate timestamps; `24:00` rows | 0; 0 | 0; 0 | 0; 0 |
| Out-of-order rows | Whole files are reversed (591 descending); none interleaved | none | none |

Specific artefacts an importer must catch:

- **Scale segments.** FLAMWOOD WALK `Checkers` holds 706 consecutive rows (2024-09-21 → 10-09) at 244,715–311,092 inside a series whose Q3 is 313. That is the same quantity in **W instead of kW**. A per-file P99 test misses it, because 3 % of the file is affected. It needs level-shift detection.
- **Reset pairs.** In the `a14` files, a register reset produces a large negative delta and then normal readings. Example: 204 Oxford `NAKED COFFEE` −58,796 at 12:00, then 1.1. Sometimes a matching positive spike appears too: the same file reaches +75,711.
- **Different periods across the meters of one site.** Almost every A site mixes multi-year histories, one-year histories and 7-day replacement files: MORONE has 18 of 34 files under 30 days; 204 Oxford has 10. Start dates within a site differ by up to 3 years (WESKUS 2022-05 → 2025). B and C sites are aligned within their windows. Site sums over a common window drop most files at sites like MORONE.
- **Bulk vs Σ tenants:** YARONA Σ tenants / bulk = 2.33–2.77 per month (§1.5). The other A sites with a labelled bulk or incomer are 204 Oxford (`MAIN INCOMER 1/2`) and SEGONYANA (B, unusable).

---

## 4. Consolidation_Summary files

- **What they are:** meter-to-letting-plan **mapping sheets**. They carry no kWh, no kW and no totals, so there is no total to recompute.
- **XLS (27 workbooks, one sheet each, 1,119 rows):**
  - 22 of them have header `Meter Filename | Matched Layout Name | Shop Number | Area (sqm) | Status | DUBBEL | CORRECT | ADDED | NOT ON DRAWINGS`; 3 lack the last four columns; 2 lack `Meter Filename`/`Status`.
  - `Meter Filename` uses the audit tree's naming: `<SITE CODE> - <TENANT>.csv`, e.g. `YA - …`, `WR - …`, `CPB - …`.
  - `Status` counts: `Direct/Substring` 379, `UNMAPPED` 291, `Gemini LLM` 107, blank 239.
  - The QA columns are **mislabelled**. `DUBBEL` holds `ON DRAWING`/`NOT ON DRAWING` (with 5 misspellings) and `CORRECT` holds `CSV ON SITE`/`NO CSV`/`NO CSV ON SITE`. They record manual checks and do not mean "duplicate" or "correct".
- **CSV (26):** only `Shop Name,Shop Number,Area (sqm)` (BLOEM VALUE MART: `Matched Layout Name,…`), with fewer rows than the XLS. Blank `,,` rows remain where a meter was unmapped (SEGONYANA 9 of 12).
- **Relation to the meter CSVs (verified):** the 006 filenames were **generated from these sheets**. `{SHOP_NO}` = `Shop Number`, `{LABEL}` = `Matched Layout Name`, `{AREA}` = `Area (sqm)`. 623 filenames match shop+area exactly, 622 of them with an identical label, and 53 more match on area. Folder file counts track the XLS row counts: YARONA 27/27, VILLAGE WALK 23/22, MAHIKENG 14/15. Where the XLS has many more rows than the folder has files (WHITE RIVER 36 rows vs 2 files; BIYELA CENTRE 41 vs 25), the missing meters were never exported into 006.
- **Consequence for E-Site:** a summary is the best available **meter → shop → area** register, and it should be importable as such. Its provenance column (`Direct/Substring` / `Gemini LLM` / `UNMAPPED`) must travel with each area as a confidence, because 105 areas came from LLM matching.

---

## 5. Does WM Solar's current parser handle these files?

**Method.** The code was verified by **running it on real files**, not only by reading it:
- `harness/run-scada.ts` executes `supabase/functions/process-scada-profile/index.ts` unchanged (only the Deno imports and `serve` wrapper are removed). It replicates the `ScadaImport.tsx:123-170` call sequence: `detect`, then `process` with `headerRowNumber`.
- `harness/run-bulk.ts` runs `BulkCsvDropzone.tsx:33-199`, whose functions were extracted verbatim, plus the unmodified `utils/csvToLoadProfile.ts`. It replicates `processFile` (`BulkCsvDropzone.tsx:287-371`).

### 5.1 Per format

| Format | Server path (`ScadaImport` → `process-scada-profile`) | Client bulk path (`BulkCsvDropzone` → `processCSVToLoadProfile`) |
|---|---|---|
| **A** `date,p14` | Parses: `sep=` and the blank line are filtered (`index.ts:461-463`); the header is `date,p14`. Values are averaged per hour (`index.ts:612-614`), which is **correct for kW**. YARONA bulk: weekday mean 194 kW. | Unit falls back to **kWh**: `p14` matches no pattern, so the numeric fallback applies (`BulkCsvDropzone.tsx:183-194`, `valueUnit='kWh'`), and the wizard default does the same (`csvToLoadProfile.ts:405-407`). kWh is summed per hour ÷ days (`csvToLoadProfile.ts:540-541`). The result is **2× the load**: YARONA bulk weekday mean **388** against 194, and total 4.44 GWh against 2.22 GWh. `Total Solar Active Power` and `Generator Total Power` also default to kWh. |
| **B** PnP power | **Silently wrong.** `detectFormat`'s PnP regex needs `rdate/rtime/kwh` (`index.ts:168-172`), so it falls through. The header search takes the first row whose first cell is non-numeric (`index.ts:186-191`), which is the **preamble** `"pnpscada.com"`. Column auto-detect then sets date = value = column 0, and dates are parsed out of the **P values**. SEGONYANA `DB-26`: **117 of 5,953 rows kept, dates in years 0319–0659, `success: true`.** | Correct. The "non-standard PnP" branch finds the header line (`BulkCsvDropzone.tsx:82-95`); `P (per kW)` scores as kW (line 164); `DATE`/`TIME` are detected. Values are averaged as power. |
| **C** PnP kWh | By luck the header is again the preamble, but the fallbacks land on date = col 0 (`Time`) and value = col 1 (`P1 (kWh)`). Averaging kWh/30 min gives **half the kW**: MERINO `Checkers` weekday mean 36 against 71. | Correct. `P1 (kWh)` scores 95 as kWh (`BulkCsvDropzone.tsx:161`), and kWh is summed per hour ÷ days. MERINO `Checkers` = 71. |
| **D** escaped | 0 data points, `success: true`. The UI then says "No data points found". | Fails: "Only 0 data rows". |
| **E** log | Would parse `Serial` as a date: garbage. | Not tested; no date/value columns, so it fails. |
| Empty A (23), header-only C (3) | 0 points | Fails (< 10 rows) |
| **G** summaries / `.xls` / `.xlsx` | Not meter data. `.xls`/`.xlsx` are not readable in either path. | `.xls` passes the file filter (`type === 'application/vnd.ms-excel'`, `BulkCsvDropzone.tsx:227-231`) and would be read as text. |

### 5.2 The earlier review's claimed defects: confirmed or refuted

| # | Claim | Verdict on real data | Evidence |
|---|---|---|---|
| 1 | Server averages kWh, so 30-min kWh comes out as half load | **Confirmed for format C only** (73 files): MERINO `Checkers` 36 against 71 kW. **Refuted for A and B**, which are kW, where averaging is right. The mirror-image defect is new: see N1. | `index.ts:612-614`; harness |
| 2 | Cumulative detection is dead above ~220 rows | **Confirmed in code** (`index.ts:224-234`: ≤199 comparisons against `0.9 × dataRows.length`), but **no impact**: the corpus contains no cumulative register files. | `prof.json` `frac_nondecr` |
| 3 | Cumulative mode keeps the first raw value; rollover returns `current` | **Confirmed in code** (`index.ts:338-344, 564-570`). No impact on this corpus, because the upstream `a14` deltas already carry reset artefacts, which is a different problem (N5). | — |
| 4 | Blanks become 0 | **Confirmed in code** (`index.ts:549`, `csvToLoadProfile.ts:445`, `BulkCsvDropzone.tsx:396`). The corpus has **no blank cells**. Its missing data is **absent rows** (A) and **`Calc` zero-padding** (B), and both reach the profile as real data (N3). | — |
| 5 | Bulk PnP header off by one | **Code confirmed, corpus refuted.** The off-by-one only affects the strict `,"meter",date,date` + `rdate,rtime,kwh` layout (`BulkCsvDropzone.tsx:71-75`), and **no file has that layout**. B and C go through the non-standard branch and get the right header. | harness |
| 6 | Picks `kWh+` over `kWh-`, so PV reads ≈0 | **Refuted.** No file has `kWh±` headers, and every PV meter records generation on the import channel (`p14`/`P1`). Choosing the first `kw` column picks the generation. | §1.5 |
| 7 | Only one channel kept | **Confirmed.** kvar, kVA and the export channels are dropped. B and C carry `S (kVA)` for maximum demand; A mostly does not. | `index.ts:515, 603` |
| 8 | Naive `split`, no quote handling | **Confirmed in code; no impact.** No data cell contains a delimiter. B's `, ` works because cells are trimmed. | — |
| 9 | Decimal comma becomes ×10/×100 | **Code confirmed; no impact.** Every file uses `.` decimals. | — |
| 10 | `rawData` truncated to 5,000 | **Confirmed and material.** A year of 30-min data is 17,520 points. YARONA's 22,906 points were stored as 5,000 (`index.ts:639` → `ScadaImport.tsx:315`). | harness |
| 11 | Local-vs-UTC day keys | **Confirmed for the browser path** (`csvToLoadProfile.ts:441, 484`, `toISOString`). In SAST, 00:00–01:59 falls into the previous date key. The Deno server runs in UTC, so it does not shift. | harness run in SAST |
| 12 | Unknown month becomes January | Code confirmed (`normaliseRawData`); **no impact** (no text months in the corpus). | — |
| 13 | Negatives filtered by default | **Confirmed, and worse than stated:** the filter drops the negative half of a reset pair but **keeps the positive spike**, which biases profiles upward. 204 Oxford `NAKED COFFEE` shows a weekday peak of 212 against a normal range of 0–40 (`index.ts:573-579`, default `handleNegatives:'filter'` at line 411). | harness |
| 14 | Filename metadata ignored | **Confirmed** (`BulkCsvDropzone.tsx:385-392`), and it matters: that metadata is the only link to shop and area. | — |
| 15 | No `.xls`/`.xlsx` | **Confirmed.** It affects the 27 summaries and 1 workbook, none of which is meter data. | — |

### 5.3 New defects found on real data

| # | Defect | Where | Impact |
|---|---|---|---|
| N1 | **The unit defaults to kWh when a header names no unit.** `p14` (kW) is summed as energy, which doubles the load. | `BulkCsvDropzone.tsx:193`; `csvToLoadProfile.ts:405-407` | **All 1,242 A files through the bulk or wizard path show 2× kW and 2× kWh.** |
| N2 | **The server takes the PnP preamble as the header** and reports success on garbage. | `index.ts:166-192` | All 703 B files are unusable through `ScadaImport`, with no error. |
| N3 | **The `STATUS`/`Status` column is ignored.** `Calc` rows, 45.6 % of B rows and 80 % zero, are treated as measured zero load. | both paths | Profiles and annual kWh are understated for every meter installed after 2024-02. |
| N4 | **No identity check.** A new meter is created per file (`BulkCsvDropzone.tsx:384` "Always create a new meter"); nothing compares the line-1 serial with the filename, or data with data. | bulk path | KURUMAN would become 170 meters built from 13 series, none of them Kuruman's. |
| N5 | No level-shift or reset-pair detection | — | W/kW segments (×1000) and `a14` resets reach the profile. |
| N6 | Mixed row order: 591 A files are newest-first. It is harmless to profiles, but any "first/last row" logic (for example cumulative deltas) runs backwards. | `index.ts:565-570` | Latent |
| N7 | The team's own workbook formula labels `P(t−1)+P(t)` (kW + kW) as kWh | `PDB_…_22m2V.xlsx`, sheet 1, col I | Any figure from that workbook is 2× the hourly energy |

What WM Solar does well and E-Site should keep: `sep=` stripping; the non-standard PnP header search in the bulk path; the quote-aware row splitter (`BulkCsvDropzone.tsx:292-308`); the power-vs-energy aggregation branch (`csvToLoadProfile.ts:524-542`), which is correct once the unit is right; and interval detection.

---

## 6. Recommended import specification for E-Site

The structure of the first pass is unchanged, and it is amended where the real data demands. **Changes are in bold.**

### 6.1 Pipeline

1. **Ingest.** Store the original bytes unchanged in Storage and record sha256, size, name and uploader. **Deduplicate on two keys: the sha256 of the file, and a body hash (sha256 of the data rows with the preamble removed).** The body hash catches B files whose preambles differ and the unescaped D copies.
2. **Filename parse** (grammar in §1.3) into `site_hint, shop_no, label, area_m2_hint, dup_index, serial_hint`. All of them are hints. **A shop/area hint comes from the summary register (6.5) when one is loaded; the filename is only a fallback.**
3. **Sniff and classify** (fixed order; the first match wins):
   - `Serial,Name,Downloaded,Timestamp` → **E: offer it as a meter register** and never as data.
   - One line containing a literal `\n` and `date,` → **D: reject** as "escaped copy". Optionally unescape and dedupe; do not import it as new data.
   - `(Shop|Matched Layout) Name,Shop Number,Area (sqm)` (CSV) or an `.xls` with `Meter Filename`/`Matched Layout Name` → **G: mapping import (6.5)**.
   - `sep=X` → delimiter X; skip blank lines; the header is the first `date,` line → **A**. If there is no header, the file is **empty: skip it with a warning**.
   - Line 1 starts with `"pnpscada.com"` (quoted) → **B**. The delimiter is `,` with cell trimming, and the header is line 2.
   - Line 1 starts with `pnpscada.com,` → **C**. The header is line 2.
   - Keep the legacy `,"<meter>",YYYY-MM-DD,YYYY-MM-DD` + `rdate,rtime` rule for completeness (not seen in this corpus).
   - Otherwise, generic detection (consistent column count; header = first mostly non-numeric row whose next 20 rows parse as date + number).
   - `.xlsx` workbooks: sniff each sheet with the same rules, **and warn that hand-added formula columns are not meter data** (N7).
4. **Channel mapping (per-format table, not header guessing):**
   - **A:** `p14`→(power, import, kW); `p23`→(power, export, kW); `q12`/`q34`→(reactive power, kvar); `s14`/`s23`→(apparent power, kVA); `a14`/`a23`→(energy, import/export, kWh per interval); `*_l1..l3`→per-phase; `u_*`→V; `i_*`→A; `…Total Power`/`…Active Power`→(power, kW); `Volume`→**water: reject for load**.
   - **B:** `P`/`P1`→(power, import, kW); `P2`→(power, export, kW); `Q*`→kvar; `S`→kVA; `scalar sum S`→kVA (sum across the phases or serials).
   - **C:** `P1 (kWh)`→(energy, import, kWh/interval); `P2 (kWh)`→export; `Q1..Q4 (kvarh)`; `S (kVAh)`; trailing `S (kVA)`→(apparent power, kVA).
   - **The unit is never defaulted to kWh.** A header with no unit is "unknown" and must be confirmed by the user, with the evidence shown (PV peak, W/m², daily-vs-30-min check).
   - Keep every channel. **The primary channel for a PV or generator meter is the one carrying generation, which is import (`p14`/`P1`) in this corpus. It is not assumed to be export.** It is chosen by comparing channel energies and confirmed by the user.
5. **Timestamp.**
   - **A:** `DD/MM/YYYY HH:MM:SS`, **interval-beginning**, sort ascending (591 files are descending).
   - **B:** `DATE`+`TIME`, **interval-ending**.
   - **C:** `Time`, **interval-ending**.
   - All in `Africa/Johannesburg`. Store `ts_end` UTC: for A, `ts_end = label + Δ`. Accept `24:00` (not observed).
   - **Daily (1,440-min) files are coverage-only.** Flag them "daily averages, not usable for hourly profile or MD".
6. **Status.** B `Ok` → quality 0. **B `Calc` → quality 2 (estimated), and a `Calc` value of exactly 0 → quality 1 (missing, value NULL).** C `0` → 0; C other codes (e.g. `2048`) → quality 6 until mapped.
7. **Identity check (new, blocking for B/C).** The line-1 serial(s) are the meter identity. A warning is raised if:
   - the filename serial differs from it; or
   - the same serial or body is already imported under another label (show that label and site); or
   - the serial belongs to another mall in a loaded E register.

   Import as a *new* meter is refused until the user resolves it. Multi-serial preambles → meter kind `virtual`.
8. **Interval and register type.** Interval = mode of Δt. Irregular modes (90/120 min) → warning. Cumulative detection over all rows, as before; it will not fire on this corpus.
9. **Artefact detection.** Level shifts: a run of ≥ 12 intervals whose median is ≥ 100× the file median → "possible W/kW scale segment", with an offer to divide by 1,000. Reset pairs in energy channels: a |value| > 50× P99 followed by a return to normal → flag 4 and exclude. Tiny negatives (> −0.1) → clamp to 0 with flag 3 and count them. Large negatives → flag 3, excluded, shown.
10. **Normalise** to the canonical interval series (below): gaps and absent rows are NULL, never 0.
11. **Validate, report, commit** (6.3).

### 6.2 Canonical storage shape

This is unchanged from the first pass, with these additions:
- `solar.meter_files`: `body_sha256`, `format_id` (A/B/C…), `source_serials text[]`, `ts_convention` (`begin`/`end`), `row_order`.
- `solar.meters`: `kind` gains `'check'`, `'virtual'` and `'water'` (the last excluded from load); `serial` is the **line-1** serial for PnP files.
- `solar.meter_readings`: quality code 7 `scale-corrected`.

The volume estimate still holds (about 1,300 real series × 17,520 half-hours ≈ 23 M rows per channel-year), and it is lower than first estimated because duplicates collapse.

### 6.3 Validation report

This is unchanged, plus:
- **Identity section:** serial vs filename; duplicate bodies (with the other filenames and sites); and where the E register says the serial belongs.
- `Calc` share and `Calc`-zero share; the scale-segment and reset-pair findings.
- A **coverage window per site**, with the common window across meters and the files that would drop out (MORONE: 18 of 34).
- An implied W/m² band recalibrated to the data: the median tenant is 15 W/m² average, and the 10th/90th percentiles are 5 / 76. **Warn outside 2–150 W/m²**, and never block. The area comes from the summary register, with its match method.
- **Bulk reconciliation shows the ratio and does not assume bulk ⊇ tenants** (YARONA 2.5×).

### 6.4 Golden fixtures (all confirmed to exist and read)

Store each as a truncated, anonymised copy (≈ 14 days, plus the first and last day), with the expected normalised output and report.

| Fixture | Format / facts | Why |
|---|---|---|
| `YARONA/YARONA, , BULK METER, .csv` | A `date,p14`, 30 min, descending, 2024-08-11 → 2025-12-01, 22,906 rows | Canonical A. kW-not-kWh test: the expected weekday mean is 194 kW, not 388. |
| `YARONA/YARONA, SHOP 050, SHOPRITE, 3000.csv` + `YARONA, , CHECK 1, .csv` | A. Monthly energy ≈ the bulk within 3 % | Reconciliation: bulk ≈ one tenant; check-meter kind |
| `YARONA/YARONA, , GENERATOR METER, .csv` | A `date,Generator Total Power`, mostly 0 | Named-power header; generator excluded from load |
| `WHITE RIVER/WHITE RIVER, , SOLAR PLANT 240, .csv` (+ `360`) | A PV. Max 385 / 256 kW | PV on the import channel; label/capacity sanity (the labels look swapped) |
| `Fourways Value Mart/…, , Solar, .csv` | A `date,p14,p23,Solar Total Power` | Multi-channel. Generation on `p14`; `p23` ≈ 0 |
| `Evaton/Evaton, 220, BOXER SUPERSTORES, 2067.csv` | A `p14,p23,q12,q34`, 41,210 rows | Channel vocabulary; kvar kept |
| `CITY CENTRE YORK/…, 13, REMY'S CLOTHING, 45.csv` | A `i_l1..3,p14,p23,u_l1..3` | V/A channels |
| `204 Oxford/204 Oxford, , NAKED COFFEE, .csv` | A `date,a14`, 60 min, reset pairs −74,461 / +75,711 | Energy header in A; reset-pair detection; negative-filter bias |
| `FLAMWOOD WALK/FLAMWOOD WALK, 89, Checkers, 3127.csv` | A. 706-row W-scale segment | Level-shift detection |
| `VILLAGE WALK/VILLAGE WALK, 12, SHOPRITE CHECKERS, 4821.csv` | A `a14`, 60 min, one −1,711 value | Hourly energy; isolated negative |
| `THAMBI/THAMBI, 3, Pick n Pay, 1995.csv` | A. `-0.002` sentinel values | Tiny-negative clamp |
| `EQUINOX/EQUINOX, , DB 37, .csv` | A, `sep=,` only (8 bytes) | Empty-file handling |
| `MORONE (KAPANE) - KSC/…` (any 7-day file) | A. 2026-03-12 → 03-19 | Short-window / period-alignment warning |
| `SEGONYANA/SEGONYANA, , 36724754_LOCAL MAIN, .csv` | B `P1/Q1/P2`, 3 serials in line 1, 5,952 rows, `Calc` lead-in zeros | Multi-serial → virtual; `Calc`-zero → missing |
| `SEGONYANA/SEGONYANA, , 36338822_DB-26, .csv` | B. Filename serial ≠ line-1 serial. The line-1 serial belongs to another mall per the E log (it also heads a PARKDENE workbook sheet). The body is shared with 11 other SEGONYANA files | Identity check must block it |
| `MERINO MALL/MERINO MALL, , Local Main, .csv` | B. A member of the 121-file identical-body group | Body-hash dedup across sites |
| `PRINCESS MKABAYI MALL/…, , Meter 35575535, .csv` + a daily file from the same folder | B 30-min and B 1,440-min | Daily-average detection (coverage-only) |
| `RUSTENBURG MALL/RUSTENBURG MALL, , E0400, .csv` | B with a 7-serial preamble | Virtual/summed meter |
| `THABAZIMBI/THABAZIMBI, , 01A Panarottis, .csv` | C, 30,153 rows, `S (kVA)` = 2×`S (kVAh)` | kWh per interval → kW = ×2; expected weekday mean ≈ 17 kW, not 8.4 |
| `MERINO MALL/MERINO MALL, , Checkers, .csv` | C | Second C sample (MERINO range) |
| `RUSTENBURG PLAZA/_consolidated/RP - ABSA 525.csv` | D | Escaped-copy rejection, dedupe against its main-folder twin |
| `KURUMAN MALL/KURUMAN MALL, , E2495, .csv` | E, 778 rows | Register import; never parsed as load |
| `PARKDENE/PARKDENE, , PDB_36506619_KFCDT_22m2V, .csv` + `PDB_…_22m2V.xlsx` | F + a 4-sheet workbook with an `=A3+A4` column | Derived-file rejection; per-sheet xlsx sniff |
| `FLAMWOOD VALUE/…, SHOP 06, Vacant, 450 (2).csv` vs `Fourways Value Mart/…, SHOP 107 VACANT, .csv` | A, identical bodies at two sites | Cross-site duplicate warning |
| `THAMBI/THAMBI, 11A,13,12, RAGE, 225.csv`, `VENDA PLAZA/…, C2, C3 & C4, KFC, 270.csv`, `CITY CENTRE YORK/…, "4-5-6, CAPITEC BANK LTD, 272.csv`, `BOTLOKWA PLAZA/…, 20, KFC, 227.5.csv` | A | Filename-grammar edge cases, all confirmed to parse |
| `001. COMPLETED SITES/YARONA_Consolidation_Summary.xls` + `.csv` | G (9-column XLS, 3-column CSV) | Mapping import; area + match-method provenance |
| `BIYELA CENTRE/BIYELA CENTRE, , BC1 - MICY'S CHANNEL BOUTIQE, .csv` | A `date,Volume` | Water meter → excluded |
| Synthetic set (hand-built) | — | The first-pass list minus decimal-comma and blank-cell cases, which remain useful for generality. Add: an A file labelled `p14` but carrying kWh (unit confirmation), and a B file with a `24:00` row. |

### 6.5 Mapping import (new)

A Consolidation_Summary (XLS or CSV) can be imported as a **meter register**: `meter file / audit name → layout name → shop number → area m² → match method → drawing/CSV QA flags`. The E logs import as a **serial register**: `serial → tenant ; DB ; mall`. Both feed the Tenants sub-tab's **Auto-match meters**. The match method is shown as confidence, and `Gemini LLM` and `UNMAPPED` rows are never auto-applied.

---

## 7. Reproduction

Everything in this document can be regenerated from `solar-review/work/`:
- `python3 prof.py` (about 25 s over 2.66 GB) → `prof.json`.
- The body-hash, summary and reconciliation snippets are recorded in the session. The only persisted outputs are `bodyhash.json` and `summ_xls.json`.
- `harness/`: `node run-scada.ts "<rel path>"…` and `node run-bulk.ts "<rel path>"…` (Node 26 type-stripping). They run WM Solar's own code. `harness/scada.ts` is `process-scada-profile/index.ts` minus its two Deno imports; `bulk-detect.ts` is `BulkCsvDropzone.tsx:33-199`; `csvToLoadProfile.ts` differs only in `import type`.
- `.xls` files were read with the SheetJS copy already in `WM_Solar_Web/node_modules`. Nothing was installed.

---

## Spec changes required

Against `02-calculation-engine-spec.md §2` and §1.2, and `01-functional-spec.md §4.3`. The real data contradicts or adds the following.

**Engine spec (`02-…`)**
1. **§1.2 "values are interval-ending averages"**: correct for stored `ts_end`, but §2.1.1 must say that **the source convention is per format and not global**. A (`sep=`/`p14`) is **interval-beginning** (the last label of the day is 23:30); PnP B/C are interval-ending. The rule "interval-ending unless detected" would shift 1,242 files by one interval.
2. **§2.1.3 units:** add that **a unit is never inferred by default**. Add the A-format channel vocabulary (`p`/`q`/`s`/`a` × `14`/`23`/`12`/`34`, `_l1..3`, `u`/`i`) and the PnP B (`per kW` = average kW) and C (`kWh`/`kVAh` per interval; trailing `S (kVA)` = demand) mappings as fixed data. Energy→power conversion (`kW = kWh × 60/Δ`) applies only to `a14` and PnP C.
3. **§2.1.5 quality flags:** `status ≠ OK` is too coarse. PnP `Calc` = **estimated (2)**, and a `Calc` value of exactly 0 = **missing (1, NULL)**. Add flag 7 `scale-corrected`. Add **reset-pair** and **level-shift** detection to the spike rule.
4. **§2.1 (new step) identity and dedup:** before normalisation, a body-hash dedup and a PnP line-1 serial check. Without them, S2 sums at eight sites count one meter up to 121 times.
5. **§2.1 (new) daily-interval channels** (1,440-min PnP files) are not load data. They are excluded from §2.2 and §2.6 and count as coverage only.
6. **§2.2 alignment:** the data has per-meter windows differing by up to 3 years at one site, plus 7-day replacement files. Add a **site common-window rule**: S2 uses the most recent 12 months common to ≥ N % of metered tenants; meters with less coverage fall back to S3 synthesis for the missing months, and never to zero. Add a minimum-coverage threshold per meter (e.g. 30 days) below which a meter is only a shape sample.
7. **§2.3 S1:** a meter labelled bulk cannot be assumed to be the site supply (YARONA "BULK METER" ≈ one anchor tenant; Σ tenants = 2.5× bulk). S1 requires a user-confirmed "this meter is the point of supply" and a reconciliation result. Add a `check` meter kind that is excluded from both sums.
8. **§2.3 existing PV:** in every PV meter here, the generation is on the **import** channel. The S1 PV-netting flag should reference the specific channel, not "export".
9. **§2.6 MD:** most A files carry only `p14`, so there is no kVA. MD from A needs the PF assumption, while B/C have measured `S (kVA)`. State that preference explicitly per format, and that the daily B files cannot yield MD.

**Functional spec (`01-…` §4.3)**
10. **Import review dialog:** add the **identity panel** (line-1 serial vs filename, identical bodies elsewhere with site and label, register lookup). A B/C file whose serial or body is already a meter must be resolved (link to the existing meter / skip / override with a reason) before **Accept & import**.
11. **Primary channel default:** replace "export for meters labelled solar/PV/generation" with "the channel carrying generation (import in all observed PV meters), chosen by energy and confirmed".
12. **Upload accepts `.xls/.xlsx`:** the only `.xls` files here are Consolidation_Summaries (mapping, not data), and the only `.xlsx` is a hand-analysis workbook with formula columns. Route G files to a new **Import meter register** control (§6.5 above) and warn on formula columns in `.xlsx`.
13. **Duplicate rule:** "duplicate sha256 → skipped" is insufficient. Add body-hash duplicates, including across sites and projects in the org (FLAMWOOD VALUE ↔ Fourways Value Mart), with a "same data as <meter> at <site>" message.
14. **Validation summary:** add `Calc` share, scale-segment and reset-pair counts, row order, the detected timestamp convention, the daily-interval flag, and "empty file". Recalibrate the W/m² sanity band to 2–150. Areas come from the summary register with their match method; LLM-matched areas are labelled as such.
15. **Errors that block commit:** add "escaped single-line file (D)", "download log (E)", "water/volume channel" and "header-only / empty file". Each is routed to Skip with a reason, not left as a parse error.
16. **Meter kind:** add `check`, `virtual` (multi-serial) and `water`.
17. **Auto-match meters (§4.4):** feed it from the imported summary and serial registers, not only filename hints. Never auto-apply `Gemini LLM` or `UNMAPPED` rows.
