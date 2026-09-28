# 09 — NERSA tariff source folder review (for the E-Site solar feasibility module)

**Reviewed 2026-09-28, with the files read.** This replaces the earlier same-day version, which was written while every file was a 0-byte Dropbox placeholder. The folder is now fully hydrated, and every statement below marked **[READ]** comes from opening the file itself. Statements marked **[WM Solar]** are kept from the first pass: they were verified then against WM Solar's own migrations and its Eskom Tariff Comparison Tool, and nothing in the source files contradicts them.

The review was read-only. Nothing in the source folder or the WM Solar tree was modified. All parsing ran on copies in `scratchpad/solar-review/work/` (`src/` holds the copies, `run/` the parser re-run, `txt/` the `pdftotext -layout` output). Tools used: python3 3.9 with openpyxl, a local venv with pandas (the system python lacks it, and the original parser needs it), and poppler `pdftotext`/`pdfinfo`.

Source folder: `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/005. NERSA TARIFFS`

---

## 0. Headline

1. **The data is municipal 2025/26 (1 July 2025 – 30 June 2026), and Eskom 2025/26.** Nothing for 2026/27 is in the folder.
   - The municipal books carry no year label, but 12.72% (NERSA's 2025/26 municipal guideline) is the most common increase shown on sheet titles.
   - The Eskom booklet cover reads "2025 - 2026": non-local-authority prices apply from 1 Apr 2025 to 31 Mar 2026, and local-authority prices from 1 Jul 2025 to 30 Jun 2026.
2. **There are 177 licensee sheets across the 9 province workbooks, with about 11,700 non-empty rows and about 7,650 rows that carry a value.** No two provinces share a layout. Within a province, the column holding the value, the way units are written, the number format and where the increase % sits all change from sheet to sheet.
3. **`nersa_seed_data.sql` is exactly what `nersa_parser.py` produces.** A re-run on copies reproduces 177 / 1,978 / 6,092 and is byte-identical once UUIDs are normalised. **That output is badly wrong:**
   - Only 18 of the 325 TOU plans contain any Standard-period energy rate.
   - 926 energy rows are tagged `peak`, against 48 tagged `off_peak`.
   - 628 energy rows are labelled c/kWh at values under 20, which are really R/kWh.
   - 387 plans have no rates at all.
   - The seed **is not valid SQL**: 5 rows carry an unquoted `redundant tariff` as the amount, so the single `BEGIN…COMMIT` aborts.
   - **Do not port or load it.**
4. **The province books contain one SSEG tariff in total** (Centlec–Kopanong "16. SSEG (New)"), and the parser folds it into the streetlight plan above it. The books contain no municipal export or feed-in credit rates. **Eskom's official xlsm does contain export credits** (the Gen-offset sheet, including Gen-Offset Homeflex).
5. **The NERSA Net-Billing Rules (approved 17 Dec 2024) fix the export-credit mechanics** a solar module must implement (§5.1):
   - The credit is settled monthly.
   - It offsets energy charges only.
   - It is never paid out in cash.
   - Any excess carries forward, but not past the distributor's financial year.
   - It is capped at consumption in each TOU period.
   - It is valued at avoided cost, per TOU period.
   - It needs a bidirectional TOU meter.

---

## 1. File inventory [READ]

There are 44 files. None is 0 B any more. Page counts come from `pdfinfo`. Sheet counts and rows come from openpyxl: "rows" means non-empty rows, and "value rows" means rows carrying a number, whether in a value cell or embedded in the label.

| # | Path | What it is | FY | Size | Pages / sheets |
|---|------|-----------|----|------|----------------|
| 1 | 2025/Eastern-Cape-Province.pdf | NERSA municipal tariff compendium, EC | 2025/26 | 689 KB | 40 pp |
| 2 | 2025/Eastern-Cape-Province.xlsx | same, spreadsheet (mtime 2025-10-18) | 2025/26 | 70 KB | 23 sheets, 1,405 rows, 863 value rows |
| 3 | 2025/Free-State-Province.pdf | FS | 2025/26 | 557 KB | 38 pp |
| 4 | 2025/Free-State-Province.xlsx | | 2025/26 | 91 KB | 20 sheets, 1,513 rows, 977 value rows |
| 5 | 2025/Gauteng-Province.pdf | GP | 2025/26 | 549 KB | 29 pp |
| 6 | 2025/Gauteng-Province.xlsx | | 2025/26 | 67 KB | 11 sheets, 1,131 rows, 842 value rows |
| 7 | 2025/Kwa-Zulu-Natal-Province.pdf | KZN | 2025/26 | 565 KB | 33 pp |
| 8 | 2025/Kwa-Zulu-Natal-Province.xlsx | | 2025/26 | 73 KB | 30 sheets, 1,318 rows, 863 value rows |
| 9 | 2025/Limpopo-Province.pdf | LP | 2025/26 | 373 KB | 37 pp |
| 10 | 2025/Limpopo-Province.xlsx | | 2025/26 | 52 KB | 15 sheets, 1,124 rows, 768 value rows |
| 11 | 2025/Mpumalanga-Province.pdf | MP | 2025/26 | 618 KB | 27 pp |
| 12 | 2025/Mpumalanga-Province.xlsx | | 2025/26 | 59 KB | 15 sheets, 913 rows, 623 value rows |
| 13 | 2025/North-West-Province.pdf | NW | 2025/26 | 331 KB | 17 pp |
| 14 | 2025/North-West-Province.xlsx | | 2025/26 | 39 KB | 13 sheets, 629 rows, 452 value rows |
| 15 | 2025/Northern-Cape-Province.pdf | NC | 2025/26 | 409 KB | 23 pp |
| 16 | 2025/Northern-Cape-Province.xlsx | | 2025/26 | 112 KB | 24 sheets, 873 rows, 588 value rows |
| 17 | 2025/Western-Cape-Province1.pdf | WC | 2025/26 | 832 KB | 71 pp |
| 18 | 2025/Western-Cape-Province1.xlsx | | 2025/26 | 199 KB | 26 sheets, 2,831 rows, 1,675 value rows |
| 19 | 2025/nersa_parser.py | XLSX → SQL parser (859 lines, pandas) | — | 38 KB | — |
| 20 | 2025/supabase_nersa_schema.sql | 4-table schema + enums, RLS, 2 views, 1 function | — | 14 KB | — |
| 21 | 2025/nersa_seed_data.sql | parser output: 8,412 lines | 2025/26 | 2.75 MB | 9 + 177 + 1,978 + 6,092 INSERTs |
| 22 | 2025/NERSA_Schema_Documentation.md | schema docs | — | 15 KB | — |
| 23 | 2025/LOVABLE_PROMPT.md | "set this up in Supabase" prompt for Lovable | — | 15 KB | — |
| 24 | ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm | Eskom's official tariff workbook | Eskom 2025/26 | 331 KB | 25 sheets |
| 25 | ESKOM/Tariff-booklet2.pdf | Eskom "Tariffs and Charges Booklet 2025-2026" | 2025/26 | 1.1 MB | 59 pp |
| 26 | ESKOM/README.md | notes for the Eskom pipeline | — | 2.5 KB | — |
| 27 | ESKOM/eskom_parser.py | xlsm → SQL | — | 9.4 KB | — |
| 28 | ESKOM/supabase_eskom_schema.sql | `eskom_tariff_plans` / `eskom_tariff_rates` | — | 5.9 KB | — |
| 29 | ESKOM/eskom_seed_data.sql | parser output | 2025/26 | 509 KB | 478 plans, 1,705 rates |
| 30 | DOCUMENTATION/Net-Billing-Rules-licensed-Distributors.pdf | NERSA Net-Billing Rules, approved 17 Dec 2024 | — | 209 KB | 13 pp |
| 31 | DOCUMENTATION/NERSA-Regulatory-Rules-on-Network-Charges-for-Third-Party-transportation-of-energy_Approved-03-March-2025-_2.pdf | Rules on network charges for third-party wheeling, approved 3 Mar 2025 | — | 369 KB | 26 pp |
| 32 | DOCUMENTATION/Electricity-Regulation-2006-Act-…-2007.pdf | ERA as amended 2007 | — | 108 KB | 20 pp |
| 33 | DOCUMENTATION/NERSA-ACT.pdf | National Energy Regulator Act | — | 1.6 MB | 11 pp |
| 34 | DOCUMENTATION/Electricity_Pricing_Policy.pdf | EPP, GG 31741, 19 Dec 2008 | — | 2.9 MB | 52 pp |
| 35 | DOCUMENTATION/Free-Basic-Electricity-Policy.pdf | FBE policy | — | 5.7 MB | 21 pp |
| 36 | DOCUMENTATION/NERSA-Rules-for-Licensable-Distribution-Areas-of-Supply.pdf | v01, 29 Jul 2020 | — | 377 KB | 20 pp |
| 37 | DOCUMENTATION/Update-of-the-2019-COUE-Values-…pdf | Cost of Unserved Energy update, Mar 2020 | — | 1.1 MB | 17 pp |
| 38 | DOCUMENTATION/Overview-of-the-Dispute-Resolution.pdf | one-page overview | — | 12 KB | 1 p |
| 39 | DOCUMENTATION/Board-submission-for-Dispute-Resolution-…2019-Final.pdf | ELS meeting 154 of 2019, disputes noted | 2019 | 454 KB | 10 pp |
| 40 | DOCUMENTATION/NERSAComplaintForm.pdf | complaint form | — | 55 KB | 2 pp |
| 41 | DOCUMENTATION/RFQs.pdf | **customer-complaints FAQ** (not procurement) | — | 107 KB | 1 p |
| 42 | DOCUMENTATION/RULES-FOR-SELECTION-CRITERIA-19-Feb10.pdf | REFIT project selection rules (2010) | 2010 | 261 KB | 15 pp |
| 43 | DOCUMENTATION/SGP-ESKOM-application-for3X35tariff-increase-2010-…pdf | Eskom MYPD2 application (historical) | 2010 | 1.2 MB | 58 pp |
| 44 | DOCUMENTATION/SPLUMA.pdf | Spatial Planning and Land Use Management Act | — | 319 KB | 37 pp |

**Totals across the province XLSX:** 177 sheets, 11,737 non-empty rows, about 7,651 value rows.

**Provenance, confirmed:**
- The pipeline files (#19–23) carry the same date as WM Solar migration `20260218094522`.
- `LOVABLE_PROMPT.md` quotes the exact counts (177 / ~1,978 / ~6,092) that the migration comments carry, and says the seed "will be loaded directly into Supabase via the SQL editor".
- `NERSA_Schema_Documentation.md` still quotes an earlier, stale estimate (~1,500 plans / ~15,000 rates).

---

## 2. Structure of the per-province XLSX files [READ]

### 2.1 Common shape

- **One sheet per licensee.** The sheet name is a hand-typed upper-case name, truncated to Excel's 31-character limit. It is **not** "`NAME - x%`": no sheet name contains a %. The earlier inference from WM Solar's regex applies to the **A1 title** and to the PDF, not to sheet names.
- **Row 1 holds the title and increase.** The form varies:
  - `City Power - 12.72%`
  - `Gamagara Local Municipality (7.71%)`
  - `Maluti a Phofung (10,00%)` (comma decimal)
  - `City of Ekurhuleni | 12.74%` (the % is in B1 as text)
  - `BA-PHALABORWA | 0.1292` (a fraction in B1)
  - no % at all: DAMPLAAS, THEMBELIHLE, TSANTSABANE
  - Count: 15 sheets hold the % only in B1, and 3 have none. The parser reads only A1, so 22 municipalities got a NULL increase.
- **Below row 1, each sheet is a vertical list.** A tariff header row with no value is followed by charge rows, each with a label in column A and a value somewhere to the right.
- **Sub-headers appear inside a tariff.** Examples: "Inclining Block Tariffs", "Summer Energy Charges", "Low Season", "Energy charge:".
- **Nothing is tabular.** No sheet has a header row naming columns.
- **VAT:** there are no VAT-inclusive duplicates anywhere. Across 69 rows holding 2 or more numbers, not one pair has a ratio of 1.15. Exactly one sheet states a VAT basis: Maluti-a-Phofung, A4, "Consumer Cost (Tariffs do not include VAT)". Treat all municipal values as **VAT-exclusive** and record that as an assumption (`vat_basis = assumed_excl`). **The earlier hypothesis that the sources show both excl and incl values is wrong for the municipal books.** It is true only of the Eskom xlsm (§3).
- **Markers:** "Redundant tariff" / "Redundant Tariff" (21, all in EC), "Obsolete" (7), "Recommended Tariffs" (5), "2024/25 Recommended" / "2024/25 Proposed" column labels (GP Lesedi, NC). The parser sets `is_redundant` on **0** plans.

### 2.2 Per-province layout and quirks

"Plans / rates" are the parser's output for that province; §4 explains why those figures are unreliable.

| Prov | Sheets | Value column | How values are typed | Units written as | Parser plans / empty / rates | Quirks found |
|---|---|---|---|---|---|---|
| EC | 23 | B | mostly text ("172.40"); 162 numeric | in the label: "(c/kWh)", "(R/Month)" | 285 / 65 / 761 | **Buffalo City labels c/kWh but the values are R/kWh** (Scale 1A "Part 1 - Charge per kWh (c/kWh)" = 3.09, and the PDF shows `3,090` too). Redundant/Obsolete markers. NMB "Wheeling Charge" rows carry no unit. NMB Small Business Prepaid has basic = energy = 334.12 (a likely copy error in the source). "Part 1/2/3" block wording. |
| FS | 20 | B, C or D (4-column sheets) | numeric; 173 comma-decimal strings ("R110,00") | "R / kWh" as a column header; Centlec uses R/kWh throughout | 233 / 49 / 775 | **Maluti-a-Phofung puts the block range in col B, the value in col C, and leaves the label blank on continuation rows**, so the parser drops them. Increase in B1 as a fraction. Two Centlec sheets (Mangaung/Kopanong). **The only SSEG tariff in the folder** (Centlec–Kopanong rows 181–185). |
| GP | 11 | B, sometimes C | numeric; "R1 184,45" strings (space thousands, comma decimal); "288.86 c/kWh" | "Approved c/kWh" header; Ekurhuleni has **no unit at all** (R/kWh by magnitude) | 142 / 18 / 667 | City Power's "All season Demand Charge **(c/kVArh)**" row is really reactive energy. "Block 3 (>500Wh)" typo. Private distributors (AECI, Westrand) priced in kW bands. Lesedi header row "2024/25 Recommended". |
| KZN | 30 | B | numeric | **unit in its own column C** ("c/kWh", "/month", "/kVA", "/amp") | 247 / 39 / 721 | Includes non-municipal licensees: 3 Ithala estates, **Sasol Synfuels and Sasolburg** (neither is in KZN), and Umkhanyakude (a district) at 0%. |
| LP | 15 | B | **text with the unit glued on** ("214.46c/kWh", "R167.77/month", "R1,6702 /kWh", "393,24 c/kWh") | mixed c/kWh and R/kWh, sometimes on the same sheet | 225 / 50 / 537 | 10 of 15 sheets put the increase as a fraction in B1. "R1,6464/kWh" does not match the parser's `r/kwh` test, so it is stored as **1.6464 c/kWh** (100× low). |
| MP | 15 | B (3 sheets are 6-column) | text with unit ("248.43c/kWh", "R405.19 /kVA") or plain | mixed; "(R/kWh)" in some labels | 150 / 27 / 473 | Includes MEGA (a provincial agency). Thaba Chweu "Access charge (R/kVA/month) (notified demand)". |
| NW | 13 | B | numeric / text | "R346.49//kVA", "R2042.34/month" | 93 / 3 / 396 | The cleanest province. |
| NC | 24 | **E** (A–D merged, 6 columns) | numeric; "1 787,81" strings | in the label ("Basic Charge - R/month") | 183 / 23 / 517 | **Gamagara "Commercial Three Phase Prepaid" = 3.52 "c/kWh"** next to single-phase 353.81, so R/kWh is mislabelled c/kWh. Thembelihle and Tsantsabane have no %. |
| WC | 26 | C (13 sheets) or D (5-column sheets) | numeric / text | varies | 420 / 113 / 1,245 | **City of Cape Town has every value inside the column-A sentence** ("o Basic charge: R88.33/day", "§ Peak: 610.75c/kWh", "Demand charge: R157.91kVA"). 249 such label-embedded values in WC and 56 in NC. Cape Town basic is **R/day**. Beaufort West uses "R/A/m" for a kVA charge. Mossel Bay splits "Energy Charge - Generation". Vleesbaai is a private distributor. |

**Totals:** 177 sheets, 1,978 plans (387 of them empty), 6,092 parsed rates, against about 7,651 source rows that carry a value. The parser therefore loses at least 20% of value rows outright. Of the rows it keeps, a large share are mis-tagged (§4.1).

### 2.3 What the licensee list contains

- **All 8 metros are present:** City Power (Johannesburg), Tshwane, Ekurhuleni, Cape Town, eThekwini, Nelson Mandela Bay, Buffalo City, and Mangaung via Centlec.
- **Of the 177 sheets, at least 12 are not local municipalities:**
  - AECI, Westrand Private Distributors, Vleesbaai Dienste, Damplaas
  - Ithala ×3, MEGA, Sasol Synfuels, Sasolburg
  - Umkhanyakude (district)
  - a duplicate Centlec sheet
- **Sheet names carry misspellings that a name registry must absorb:**
  - "MODALE CITY" (Mogale)
  - "NELSON MANDELLA BAY METRO"
  - "LANGERBERG"
  - "DRANKENSTEIN"
  - "KAREENBERG"
  - "WALTER SIZULU"
  - "MODIMOLLE-MOOKGOPHOONG"
  - "CITY OF CAPE " (truncated, with a trailing space)
- The WM Solar Limpopo cleanup (`20260219121343`) was repairing names that came from these sheets. **The A1 title is the better source of a name than the sheet tab, but it too is inconsistent**, so a curated registry matched on MDB code should be the key.
- The province a licensee is filed under is not reliable either (Sasol is under KZN).
- Against WM Solar's 193-name registry, the 177 sheets leave about 16+ registry names without tariffs. Limpopo is thin at 15 sheets; many of its villages are Eskom-direct.

---

## 3. The Eskom files [READ]

### 3.1 Official workbook `Eskom-tariffs-1-April-2025-ver-2.xlsm`

It has 25 sheets:

| Group | Sheets |
|---|---|
| Menu | Menu |
| Wholesale energy price | WEPS NLA, WEPS Munic |
| Large power user (LPU) | Megaflex NLA, Megaflex Gen NLA, Miniflex NLA, Nightsave Urban NLA, Nightsave Rural NLA, Ruraflex NLA, Ruraflex Gen NLA, Municflex |
| Small power user (SPU) | Municrate, Businessrate NLA, Public Lighting NLA, Public Lighting Munic, Homepower NLA, Homelight NLA, Landrate NLA, **Homeflex NLA** |
| Generator | **Gen-offset** |
| Network | TUoS NLA, DUoS NLA, **Loss Factors**, Excess NCC NLA, Excess NCC Munic |
| Reconciliation | Gen Reconciliatons |

**Correction to the first pass:** the generator and network tables that the TCT lacks *are* present in the official workbook.

- **Every value appears twice, VAT-excl then VAT-incl** (for example Homeflex 1 high-season peak `706.97 | 813.02`). Here "keep the VAT-excl value" is correct, and the pair gives a free ×1.15 validation.
- **Homeflex 1 (HF101N) 2025/26, c/kWh excl VAT:**
  - High season P/S/O = 706.97 / 216.31 / 159.26
  - Low season P/S/O = 329.28 / 204.90 / 159.26
  - Service & admin R3.27/POD/day; ancillary 0.41 c/kWh; legacy 22.78 c/kWh; network demand 26.37 c/kWh
  - NCC R12.13/POD/day (on NMD); GCC R0.72/POD/day
  - These match the TCT figures in the first pass.
- **Gen-Offset Homeflex (GOHF101N), the export credit, c/kWh excl VAT:**
  - High season 650.52 / 185.41 / 131.21
  - Low season 292.75 / 174.58 / 131.21
  - The Homeflex sheet says to refer to the Gen-offset tables for the credit rate for exported energy (paraphrased).
  - Gen-Offset Urban/Rural are gridded by transmission zone × voltage, like Megaflex. For example Megaflex zone 0 <500 V: high 650.52 / 162.63 / 108.42, low 269.97 / 151.79 / 108.42.
- **Loss factors:**
  - Distribution, urban: 1.1862 at <500 V, 1.1556 at 500 V–66 kV, 1.0724 at 66–132 kV.
  - Transmission, by zone: 1.006 / 1.016 / 1.0261 / 1.0361.

### 3.2 Booklet `Tariff-booklet2.pdf` (59 pp)

- **Validity:** 2025/26. Non-local authority 1 Apr 2025 – 31 Mar 2026; local authority 1 Jul 2025 – 30 Jun 2026 (cover, p1).
- **Contents:** Gen-wheeling p43, Gen-offset pp44–45, Gen-purchase p46, TOU periods p47 (Appendix A), WEPS appendix pp53–54.
- **p47 confirms the 2025/26 TOU change.** The evening peak grew from 2 to 3 hours, the morning peak shrank from 3 to 2, and a new 2-hour Sunday-evening standard period was added. This matches the TCT hour grids in §3.3.
- The clock diagrams are graphics, so exact hours cannot be extracted as text. The low-season Sunday window remains to be confirmed visually. **Hard-coding TOU windows from the booklet needs a human to read p47.**

### 3.3 TCT (kept from the first pass) [WM Solar]

The first pass's TCT figures stand, and the official xlsm confirms the Homeflex values:
- LPU 233 rows, LPU-by-voltage 65, SPU 46
- sample values: Megaflex >900 km <500 V; Homepower flat 268.78; Businessrate 224.93
- TOU grids: high-season weekday peak 06–08 and 17–20; low-season weekday peak 07–09 and 18–21

⚠ **WM Solar's hard-coded single window ("07:00-09:00, 17:00-20:00") is still wrong.**

### 3.4 Eskom pipeline (`eskom_parser.py`, schema, seed)

- A re-run on a copy gives 478 plans and 1,705 rates, matching the seed.
- **It fails on Homeflex:** it prints "Could not find data start for Homeflex NLA", and `grep -c Homeflex eskom_seed_data.sql` = 0. The one residential TOU tariff that SSEG customers are put on is missing.
- It skips `Loss Factors` and `Gen Reconciliatons`.
- Plan metadata is noisy. The sub-category is the 2-letter bill-code stem ("We", "Me"). Every WEPS plan is `structure='flat'` despite being TOU. 166 plans are classified "residential", including DUoS and Excess NCC rows.
- **This schema was never applied to WM Solar**: no migration of that date exists [WM Solar].
- **Verdict:** use the xlsm as a source, but not this parser.

---

## 4. Parser, schema, seed and Lovable prompt [READ]

### 4.1 `nersa_parser.py`: what it does and where it fails

**What it does:**
- It reads all 9 XLSX with `pd.read_excel(header=None)`.
- Each sheet becomes a municipality, named after the sheet tab. The increase % comes from A1 only.
- It walks rows as follows:
  - A row whose label contains a keyword (domestic, business, scale, time of use, and so on) opens a plan.
  - Season and TOU context lines set state.
  - Each labelled row with a value becomes a `tariff_rate`. The value is taken from the first cell in columns B onward that parses as a number, or else from a regex on the label.
- The unit is detected from label text, with a default of c/kWh.
- The output path is hard-coded to a Cowork sandbox (`/sessions/awesome-peaceful-thompson/mnt/2025`), and it writes next to the data.

**Defects, each demonstrated on the re-run output (City Power and Cape Town shown):**

1. **The TOU row-skip bug.**
   - In the TOU branch, the `for … else` loop `break`s after recording a rate, then falls through to the trailing `i += 1`. So **the row after every TOU value is skipped.**
   - With Peak / Standard / Off-peak on consecutive rows, Standard is never read, and the next "Winter/High Season" line is skipped too, so the season never changes.
   - City Power "Residential Time of Use" parses as four rows (275.58, 171.5, 634.02, 183.27), all `season=all, tou=peak`. The source holds six values in two seasons.
   - Result: **18 of the 325 TOU plans have any Standard energy rate.**
2. **Off-peak is tagged as peak.** The test `tou_key in ll` matches "peak" inside "off-peak". Result: 926 `energy/peak` rows against 48 `off_peak`.
3. **State leaks.** `current_tou` persists after the TOU lines, so service, capacity and demand charges come out as `tou=off_peak`: 64 basic, 49 demand and 17 service rows.
4. **Seasons are missed.** "Summer Energy Charges" and "Winter Energy Charge" match neither the exact labels nor the `'summer' == ll` test. So 154 of the 325 TOU plans have no seasonal rates.
5. **Units are wrong by 100×:**
   - 352 rows are stored as R/kWh and 3,570 as c/kWh, mixed in the same column.
   - 628 energy rows are c/kWh with values under 20: Buffalo City, Centlec, Ekurhuleni, all "R1,6464/kWh" strings, and Gamagara.
   - 25 rows are over 1,500 c/kWh.
   - The schema's `calculate_monthly_cost()` divides every energy amount by 100.
6. **Lost values:**
   - Rows with an empty label are dropped (Maluti block continuations).
   - Label-embedded values are recovered only for c/kWh and R/month, so "R88.33/day", "R157.91kVA" and "Demand charge: R277.71/kVA" are lost. Cape Town "Small Power Users 1" keeps its energy rate and loses its R/day basic.
   - Unit-less "Block 3 (>500Wh)" loses its block number.
7. **Plans are merged or empty.**
   - Headers without a keyword (for example "16. SSEG (New)", Polokwane "Bulk Supply >100A 3Phase") do not open a plan, so their rates attach to the previous plan. Centlec's SSEG rates are stored under "15. Tariff V: Departmental: streetlights".
   - Section banners ("Commercial Tariffs", "Large Power Users (Time of Use)") become 387 empty plans.
8. **Text leaks into numbers.** Buffalo City Scale 4A emits `amount = redundant tariff` unquoted (5 rows, seed lines 2408–2412), which makes the seed file fail to execute. `is_redundant` is never set.
9. **Mislabel carried through.** City Power reactive energy (label "Demand Charge (c/kVArh)") is stored as `charge='demand'`.
10. **Provenance and year are missing.** `financial_year` is never written. There is no sheet, row or cell reference, so nothing can be traced back to its source.

### 4.2 `supabase_nersa_schema.sql`

- **Tables and types:** 4 tables (`provinces`, `municipalities`, `tariff_plans`, `tariff_rates`) and 7 enums, matching the §4.2 list of the first pass.
- **Views and function:** `v_tariff_lookup`, `v_municipality_summary`, `calculate_monthly_cost()`.
  - The function divides energy by 100.
  - It filters `tr.tou = 'all'`, so TOU is never costed.
  - It ignores demand units.
- **RLS in this file:** `FOR ALL USING (auth.jwt() ->> 'role' = 'admin')`. In Supabase the `role` claim is `authenticated`/`anon`, so in practice only the service role writes.
- **RLS in WM Solar:** the version WM Solar applied has `FOR ALL TO authenticated USING (true)` [WM Solar]. **So WM Solar did not apply this file verbatim**, even though LOVABLE_PROMPT says not to modify it. Every schema-design defect listed in the first pass still holds:
  - no versioning
  - free-text units
  - no TOU windows
  - no demand basis
  - one amount with no VAT flag
  - no provenance
  - Eskom modelled as a province
  - no export/SSEG

### 4.3 Seed completeness vs XLSX

| Prov | Sheets | Value rows (source) | Seed munis | Seed plans | Seed rates |
|---|---|---|---|---|---|
| EC | 23 | 863 | 23 | 285 | 761 |
| FS | 20 | 977 | 20 | 233 | 775 |
| GP | 11 | 842 | 11 | 142 | 667 |
| KZN | 30 | 863 | 30 | 247 | 721 |
| LP | 15 | 768 | 15 | 225 | 537 |
| MP | 15 | 623 | 15 | 150 | 473 |
| NW | 13 | 452 | 13 | 93 | 396 |
| NC | 24 | 588 | 24 | 183 | 517 |
| WC | 26 | 1,675 | 26 | 420 | 1,245 |
| **Total** | **177** | **~7,651** | **177** | **1,978** | **6,092** |

- Coverage of licensees is complete (every sheet → one row).
- Coverage of values is about 80% by count and much lower by correctness.
- Some FS/GP rows hold two values, so ~7,651 is a lower bound on the number of charges.

### 4.4 `NERSA_Schema_Documentation.md` and `LOVABLE_PROMPT.md`

- **The documentation** describes the 4-table model and includes AECI and Westrand as "private distributors". It still quotes stale counts (~1,500 plans / ~15,000 rates).
- **The prompt** does five things:
  - STEP 1: run the schema, with "Do NOT modify the schema"
  - STEP 2: data model
  - STEP 3: query patterns
  - STEP 4: UI (province → municipality dropdown)
  - STEP 5: verification counts, including the full charge-type histogram, which matches the re-run exactly
- Neither file mentions VAT, TOU windows, units normalisation, SSEG or versioning.

---

## 5. Regulatory documents relevant to a solar module [READ]

### 5.1 Net-Billing Rules (#30), approved 17 Dec 2024, made under ERA s35(1)(a)(b)(c)

**Rules a solar module must implement** (page numbers are the PDF's):

| Topic | Rule | Ref |
|---|---|---|
| Who | "Prosumer": a customer that generates on its side of the billing meter mainly to offset its own use. It **excludes** anyone wheeling or selling. So net billing is for self-consumption; wheeling is §5.2. | p4 |
| Net billing definition | Exports are credited at an export tariff, and "the customer is still charged the full tariff for energy consumed and capacity provided". | p4 |
| Size cap | Generation ≤ the lower of (a) the main supply breaker rating converted to kVA, or (b) **1,000 kVA**. The distributor also sets per-facility and area export limits (hosting capacity, NRS 097). | pp5–6, §3.1–3.3 |
| Export tariff | The distributor must design an export tariff, NERSA-approved, crediting exports "not more than the consumption during each time-of-use period". | p7 §5.2 |
| Export valuation | Export energy charges "must be valued at the avoided energy cost of the distributor and on a time-of-use rate". | p8 §6.2(i) |
| No TOU export | A distributor unable to do TOU export tariffs must give NERSA a reason and a plan. So flat export rates exist in practice and should be modelled as a fallback. | p8 §5.4 |
| Import side | Import is charged TOU energy + network charges (c/kWh), fixed R/day or R/kVA on NMD, service/admin, and subsidies/levies. | p8 §6.2 |
| **Settlement** | Credit goes to **the relevant monthly billing period**. It is offset **only against energy**, not fixed, basic or demand charges. **No cash**. Any excess **carries forward**, but not into **the distributor's new financial year**. | p9 §7.1(a)–(d) |
| Estimation | The distributor "should avoid estimating" consumption and export. | p9 §7.2 |
| Billing | Import and export are separate transactions. | p9 §8 |
| Meter | Bidirectional with separate registers, records peak demand, two-way communication, **TOU metering**. No reverse-spinning meters. | pp9–10 §9.2, §9.4 |
| Credits on sale | **Accrued credits are forfeited** on change of ownership and cannot be transferred. | p12 §12.2 |
| Application | The distributor must respond within 30 days. | p7 §4.5 |
| Register | The distributor keeps a prosumer register (capacity, estimated generation and export) and submits it to NERSA twice a year. | p11 §11 |
| Applicability | The Rules apply to licensed **Distributors**, which includes municipalities and Eskom Distribution, and come into operation on approval and publication. Each distributor still needs its own NERSA-approved export tariff. | pp5, 13 §1.1, §16.1 |

**Crediting formula implied by the Rules**, per billing month m and TOU period p:

`credit_kWh[m,p] = min(export_kWh[m,p], import_kWh[m,p])` (the §5.2 cap, read as a kWh cap)

`credit_R[m] = Σ_p credit_kWh[m,p] × export_rate[season(m), p] + carry_in[m]`

`applied[m] = min(credit_R[m], energy_charges_R[m])`

`carry_out[m] = credit_R[m] − applied[m]`, reset to 0 at the distributor's financial-year boundary (Eskom 31 Mar, municipal 30 Jun)

⚠ **Interpretation flag:** §5.2 ("not more than the consumption during each TOU period") could also be read as a cap on value rather than kWh. The engine should carry both as a `cap_rule` option.

### 5.2 Rules on Network Charges for Third-Party Wheeling (#31), approved 3 Mar 2025

These are for off-site PPAs or wheeling, not rooftop self-consumption.

- **Binding force:** the rules, once gazetted, are binding on all licensees (p10 §2.4).
- **Three scenarios:** Eskom→Eskom, Eskom→municipal, municipal→municipal. Only the municipal network's UoS applies in the third (pp11–14 §4).
- **UoS cannot be avoided:** loads and generators pay use-of-system charges whatever the energy source (p15 §7.2, p17 §9.3). UoS for loads = network + subsidies/surcharges + losses + ancillary + service/admin. Generators pay NERSA-approved generator UoS (p18 §9.3.3).
- **Option 1, credit** (pp19–20 §13.3(a)):
  - Full retail tariff on all energy, then a credit line of wheeled kWh × **Wheeling Credit Rate = TOU energy purchase price excluding technical losses**, at avoided cost.
  - Wheeled kWh are capped at consumed kWh **per TOU period**.
  - Reconciliation may be half-hourly, hourly or monthly (the rule text reads "…should…evolve to be at least hourly").
- **Option 2, netting** (pp20–21 §13.3(b)):
  - Energy charge on (total − wheeled) kWh.
  - UoS on total kWh, demand, service, subsidies, ancillary and losses.
  - This needs fully unbundled tariffs including loss factors.
- **Avoided cost** includes upstream technical losses avoided (p21 §13.3(c)).
- **Solar-module impact:** a "wheeled PV" scenario needs a wheeling-credit-rate charge, loss factors (Eskom's Loss Factors sheet provides these), and a per-TOU cap. None of these is in the municipal books.

### 5.3 The others (brief relevance)

- **ERA (#32) and NERSA Act (#33):** legal basis. ERA s35 is cited by both rule sets.
- **EPP 2008 (#34):** pricing principles, with a §4.4 renewables section that is background only.
- **FBE (#35):** relevant only to indigent tariffs.
- **Licensable Distribution Areas (#36, 2020):** who is the licensee for a site. Useful for a licensee lookup.
- **COUE (#37):** unserved-energy valuation. Not needed.
- **Not relevant:** #38–41 (disputes, complaint form, and "RFQs" = a customer-complaints FAQ); REFIT selection rules (#42, 2010, superseded); MYPD2 2010 (#43, historical); SPLUMA (#44, planning law).

---

## 6. Gaps [READ]

1. **No 2026/27 data anywhere:** not municipal (in force since 1 Jul 2026) and not Eskom (since 1 Apr 2026). Every value in the folder is one tariff year stale. The 9.01% 2026/27 guideline figure quoted from the RESPUBLICA note is still unverified: it is not in this folder.
2. **Export/SSEG rates are almost entirely absent from the municipal books.** One tariff (Centlec–Kopanong "SSEG (New)", FS xlsx rows 181–185, PDF p8) appears in 177 licensees, and its sheet does not say whether the R1.42 / 0.98 / 0.62 per kWh are import or export rates. Metros publish SSEG tariffs in their own books, which are not in the folder. **The municipal export credit must come from another source, or from user input with provenance.**
3. **The Eskom export credit is present** (Gen-offset, including Gen-Offset Homeflex) but was not ingested by either pipeline.
4. **Municipal TOU windows and season months are never stated.** The books say "Summer/Winter" or "Low/High season" but give no hours. Assuming Eskom's windows for municipal TOU tariffs is an assumption, and must be flagged as one.
5. **Coverage:** 177 licensee sheets, of which about 165 are municipalities; all 8 metros are present. Against WM Solar's 193-name registry, about 16+ names have no tariff sheet (Limpopo is the thinnest). The province compendium thins metro books: Cape Town's sheet has 125 rows, while its own book is far larger.
6. **Source data errors to expect on every ingest:** R/kWh values labelled c/kWh (Buffalo City, Gamagara), a reactive charge labelled as demand (City Power), basic = energy duplicates (NMB), block typos ("500Wh"), and 2024/25 column labels on 2025/26 values (Lesedi).
7. **No `status` provenance** (draft, final, NERSA-approved) in the books themselves. They are NERSA's compendium, so treat them as `nersa_approved`, but the per-municipality source books behind them are not in the folder.
8. **Not in the folder:** NRS 097, municipal SSEG by-laws, and any municipal wheeling tariffs (apart from NMB's two unlabelled "Wheeling Charge" rows).

---

## 7. Recommended canonical tariff model for E-Site

The model in `03-data-model-and-security.md` §4 (`tariffs.licensee` … `tariffs.ingest_run`) stands. The changes the real data forces are listed at the end of this document.

The design goals remain:
- one row per published fact
- page or cell provenance
- financial years as versions
- canonical units
- VAT-exclusive storage with an explicit basis
- TOU windows held as data
- a public-read, service-write review workflow

### 7.1 Parser design (deterministic; one front end per format, one normaliser for all)

**Stage A: format front ends.** Each produces `RawLine {licensee_sheet, row, col, label, raw_value, raw_unit_hint, context_stack}`.

| Front end | Applies to | Rules |
|---|---|---|
| `province_xlsx` | the 9 NERSA workbooks | **Title:** read A1 and B1, and take the % from either (`\d+[.,]\d+%`, or a fraction < 1 in B1 → ×100). **Value:** scan columns B…F for the right-most cell that parses (number, or text matching `^R?\s*[\d ]+([.,]\d+)?\s*(c/kWh\|R/kWh\|/kWh\|/month\|/kVA\|/day\|/amp\|c/kVArh)?$`). **Unit:** if column C holds only a unit token, use it (KZN). **Continuation rows:** if column A is empty but B holds a block range (`\(?[<>]?\d+\s*-\s*\d*\s*kWh\)?`) and C holds a value (Maluti), inherit the last label. **Embedded values:** if no value cell is found, extract every `(label): R?number unit` from the column-A sentence, with bullets `·o§Ø` stripped (Cape Town). |
| `eskom_xlsm` | official Eskom workbook | Fixed per-sheet column maps (header rows 7–10). Take **the excl column of each excl/incl pair** and assert incl ≈ excl×1.15 (±0.02). Key rows by bill code (HF101N, GOHF101N, NLUrbOffset01N). Transmission zone and voltage come from the row. |
| `pdf_book` (fallback) | metros' own PDFs | `pdftotext -layout`, then the same line grammar as the embedded-value rule. Its output always goes to review. An LLM may propose rows only in this path, never as the primary path. |

**Stage B: context state machine** (fixes §4.1 bugs 1–4, 7):
- **Tariff header:** a row with no value whose next non-empty row has a value or is a context line. Keyword lists are hints, not gates. Numbered headers (`^\d+\.`, `^Tariff [IVX]+`, `^Scale \w+`) always open a tariff. An **SSEG / generator / export** keyword opens a tariff with `category='sseg'`.
- **Season:** any label containing summer / low season / low demand sets `low`; winter / high season / high demand sets `high`. It is **reset at each new tariff header**.
- **TOU:** detect `off[- ]?peak` **before** `peak`, and read the period from the label start or a trailing token. Never advance an extra row. The TOU state **applies only to energy components**, not to fixed or demand charges.
- **Section banners** ("Commercial Tariffs", "Large Power Users") push a category hint and never create a tariff.
- **Markers:** "Redundant tariff" / "Obsolete" set `is_legacy=true` on the current tariff and never produce a charge. "Recommended" is kept as a note.

**Stage C: normaliser.** This is the only place units are decided.
1. **Numbers:** strip `R` and spaces. A single comma followed by 1–4 digits with no dot is a decimal comma. A space between digit groups is a thousands separator.
2. **Unit:** chosen by precedence: the value's own suffix, then the unit column, then the label's parenthesis, then the tariff's header row ("Approved c/kWh", "R / kWh"). The default is **none** (unit unknown), never c/kWh.
3. **Magnitude check for energy.** Plausible ranges are 50–1,500 c/kWh or 0.5–15 R/kWh.
   - If the labelled unit is c/kWh and the value is below 20, re-read it as R/kWh (converting ×100) and set `unit_inferred=true` with reason `magnitude`.
   - An unlabelled value is inferred the same way.
   - Every inference is queued for review.
4. **Component from label:**
   - The `c/kVArh` unit wins over the word "demand" → `reactive`.
   - "network capacity … NMD" / "access charge … notified" → `network_capacity` with `demand_basis=nmd`.
   - "network demand … actual" → `network_demand` with `demand_basis=actual_md`.
   - "capacity charge (R/month)" → a fixed `capacity` component.
   - "wheeling charge" → `wheeling_uos` (unit unknown, review).
5. **Blocks:** parse `a-b`, `>a`, `>a to <=b`, and "first N". Store them half-open as `[min, max)` in kWh per month. Check that blocks are contiguous; for a gap like "0-500 / 501-1000", treat 500 as the boundary. Record the "500Wh" typo as `raw_text` and review it.
6. **VAT:** municipal → `vat_basis='assumed_excl'`; Maluti → `stated_excl`; Eskom → `stated_excl` with the incl value asserted.
7. **Provenance:** keep `source_locator = {file sha256, sheet, row, col, raw_text, raw_unit, pdf_page?}` on every charge.

**Stage D: validators.** They block publish and do not merely warn:
- every tariff has at least one charge
- no numeric field holds text
- TOU tariffs have 6 energy values (3 periods × 2 seasons), or 3 plus an explicit `season=all`
- IBT blocks are contiguous
- energy is within its range after conversion
- fixed charges are R/month or R/day
- no two tariffs in a licensee share a name after normalisation, unless both are marked as variants
- the increase % against the predecessor year is within ±3 percentage points of the sheet's stated %
- the licensee matches the registry by MDB code and the province comes from the registry, not from the file

**Stage E: diff and review.** As in the first-pass §7. Each charge is shown beside its sheet row or PDF crop.

### 7.2 Golden test cases (from the files; all excl VAT, 30-day month where relevant)

"Row" refers to the XLSX sheet row. Expected bills are computed by hand from the source cells.

| # | Licensee / tariff (source) | What it tests | Inputs | Expected |
|---|---|---|---|---|
| 1 | City Power, Residential Single Phase 60A (GP xlsx `CITY POWER` rows 15–22) | 5-block IBT; "0-500 / 501-1000" boundaries | 800 kWh | 500×2.2728 + 300×2.6083 = 1,918.89; + service 235.79 + capacity 694.58 = **R2,849.26** |
| 2 | City Power, Residential Time of Use (≤80A) (rows 65–75) | all 6 TOU values captured, with seasons; Standard not skipped; off-peak not read as peak | winter (high): P 100, S 200, O 300 kWh | 634.02 + 519.44 + 549.81 + 235.79 + 951.45 = **R2,890.51**. Parsed low season must be 275.58 / 218.00 / 171.50 |
| 3 | City Power, Industrial LV (TOU) (rows 143–155) | "R358,84" / "R1 895,11" strings; values in column C (rows 154–155); "(c/kVArh)" labelled as demand → reactive | summer: P 2,000, S 5,000, O 3,000 kWh; MD 100 kVA; 0 kVArh | energy 20,083.50 + demand 35,884.00 + service 1,895.11 + capacity 1,694.31 = **R59,556.92**. Reactive component = 37.64 c/kVArh. (The non-TOU Industrial LV at row 128 is R358,80, so do not cross the two.) |
| 4 | City of Ekurhuleni, Domestic IBT Tariff A (GP xlsx rows 3–8) | % in B1 as text; **unitless** values inferred as R/kWh; ">50 to <=600" boundaries | 800 kWh | 600×2.3231 + 100×3.9486 + 100×11.1291 = **R2,901.63** (no basic charge in this block) |
| 5 | Lephalale, Domestic Prepaid & Conventional (LP xlsx rows 2–7) | "R1,6464/kWh" strings with comma decimals must be R/kWh; fraction in B1 (0.1039 → 10.39%) | 400 kWh | 50×1.6464 + 300×2.0889 + 50×3.0002 = 859.00; + 202.25 = **R1,061.25** |
| 6 | Buffalo City, Scale 1A (EC xlsx row 24–26; PDF p4 "3,090") | **source says c/kWh but the value is R/kWh**: magnitude inference plus a review flag | 500 kWh | 500×3.09 + 664 = **R2,209.00**, with `unit_inferred=true` |
| 7 | City of Cape Town, Large User Low Voltage TOU (WC xlsx `CITY OF CAPE ` rows 55–71) | values embedded in the label; basic in **R/day**; NMD charge at R0.00 | high season: P 5,000, S 15,000, O 10,000 kWh; MD 200 kVA | basic 168.81×30 = 5,064.30; energy 30,537.50 + 28,462.50 + 10,618.00 = 69,618.00; demand 55,542.00 → **R130,224.30**. Low-season P/S/O must parse as 203.80 / 142.41 / 92.80 |
| 8 | Maluti-a-Phofung, Domestic conventional single phase, summer (FS xlsx rows 8, 13–16) | block ranges in column B, values in column C, blank-label continuation rows; explicit VAT-excl statement | 400 kWh, summer | 50×1.68 + 300×2.18 + 50×3.08 = 892.00; + 383.84 = **R1,275.84** |
| 9 | Centlec–Kopanong, "16. SSEG (New)" (FS xlsx rows 181–185; PDF p8) | an SSEG header opens its own tariff (not merged into streetlights); `category=sseg` | parse only | 4 charges: basic R110.00/month; P 142, S 98, O 62 c/kWh. Import/export semantics = **unknown → review**; bill = not computed |
| 10 | Eskom Homeflex 1 + Gen-Offset Homeflex (xlsm `Homeflex NLA` row 11/18, `Gen-offset` row 49) | excl/incl pairs; R/POD/day fixed charges; c/kWh adders; net-billing credit capped per TOU and applied to energy only | high season, 30 days: import P 100, S 300, O 200 kWh; export S 150 kWh | energy 1,674.42 + adders (0.41 + 22.78 + 26.37)c × 600 = 297.36 + service 98.10 + NCC 363.90 + GCC 21.60 − credit 150×1.8541 = 278.12 → **R2,177.26**. Variant: export S 400 kWh → credited kWh capped at 300 → credit 556.23 |

Also as fixtures (validator must flag, not a bill):
- Gamagara "Commercial Three Phase Prepaid" 3.52 "c/kWh" beside 353.81 → the magnitude flag fires.
- NMB Small Business Prepaid basic = energy = 334.12 → duplicate-value flag.
- Buffalo City Scale 4A "Redundant tariff" → `is_legacy`, with no numeric charge emitted.

---

## 8. Reproduction (what was run, 2026-09-28)

1. `find <folder> -size 0` → nothing. All 44 files are hydrated.
2. `pdfinfo` on every PDF gives the page counts in §1. `pdftotext -layout` for all PDFs goes to `work/txt/`, and the per-page extracts of #30 and #31 to `txt/nb_pages.txt` and `txt/nc_pages.txt`.
3. `work/inv.py`, `anal.py`, `kw.py` and `vat.py` produce the sheet, row, value-type, keyword and VAT-pair statistics in §2.
4. The parser re-run: `run/parser_copy.py` (`DATA_DIR` patched to `work/run`, output `rerun_seed.sql`), then `diff` against the shipped seed with UUIDs normalised: identical. `run/analyse.py` and `run/show.py` produce the quality statistics and the City Power, Cape Town, Maluti and Centlec dumps in §4.1.
5. The Eskom re-run: `work/run_eskom/` (a copy), giving 478 / 1,705 and the Homeflex failure.

---

## Spec changes required

These are contradictions with, or additions to, `03-data-model-and-security.md` §4 and `02-calculation-engine-spec.md` §5. The other files were not edited.

**03 §4 (`tariffs` schema)**
1. **`tariff.structure`:** add `seasonal` (flat summer/winter energy, as in City Power Agriculture) and `seasonal_ibt` (IBT per season, as in City Power Residential Seasonal). The current `flat|ibt|tou|tou_ibt` cannot represent them.
2. **`tariff.category`:** add `sseg` (and optionally `wheeling`). **`tariff.metering`:** add `unmetered`.
3. **`tariff`:** add `transmission_zone` and `local_authority bool`. Eskom Gen-offset and LPU rows are keyed by zone × voltage, and the xlsm is split NLA/Munic. The earlier §7 draft had these fields; the spec dropped them.
4. **Export tariff linkage:** add `tariff.export_tariff_id` (or `applies_to_tariff_id` on the export tariff). Eskom's export credit is a separate tariff (Gen-Offset Homeflex, Gen-Offset Urban/Rural by zone and voltage), not a component on the import tariff.
5. **`charge`:** add `unit_inferred bool`, `inference_reason`, and `vat_basis (stated_excl|assumed_excl|stated_incl)`.
   - Source units are wrong often enough (Buffalo City, Gamagara, Ekurhuleni unitless, 628 rows in the old seed) that "canonical units converted at ingestion" needs a recorded inference, not a silent conversion.
   - The raw unit can be *absent*, so `raw_unit` must be nullable.
6. **`sseg_rule`:**
   - `crediting` needs `net_billing_tou | net_billing_flat | none` (Net-Billing Rules p8 §5.4 allows a non-TOU fallback).
   - Add `carry_forward (none|within_financial_year)`, `fy_end_month` (Eskom 3, municipal 6), `cap_rule (kwh_per_tou_period|value_per_tou_period|energy_charges)`, `offsets (energy_only)`, `forfeit_on_ownership_change bool`, and `max_kva` (1,000 per §3.2).
   - Rules cite pp7–12.
7. **`licensee`:** the province must come from the registry, never from the source file (Sasol is filed under KZN). Add `kind` values `development_agency` and `industrial_private`, or document that `private` covers Ithala, MEGA, AECI and Sasol. Keep an alias table for misspelt sheet names.
8. **`tou_calendar`:** needs a `source (published|assumed_eskom)` flag. The municipal books state seasons but never hours, so any municipal TOU calendar is an assumption until a by-law is sourced.
9. **Seed plan:** "SSEG rules for licensees where published" cannot come from this folder (1 SSEG tariff of 177, no municipal export rates). State that the municipal export rate is user-supplied with provenance until metro and municipal SSEG books are sourced. Eskom Gen-offset **is** available now.
10. **Loss factors:** Eskom publishes them as a table (Dx urban/rural × voltage; Tx × zone), not as a charge. Add `tariffs.loss_factor(licensee, kind, voltage_band, transmission_zone, factor)`, needed for wheeling Option 1/2.

**02 §5 (bill engine)**
11. **§5.7 export credit is wrong as written** ("capped at that month's energy charges"). Per the Net-Billing Rules p9 §7.1:
    - The credit is capped per TOU period at import kWh (p7 §5.2).
    - It offsets energy only.
    - **The excess carries forward** to later months, not paid out.
    - The balance is **reset at the distributor's financial-year end.**
    - The engine therefore needs cross-month state: a credit balance in and out per month. The annual financial model must not treat carried credit as lost within a year, nor as cash.
12. **§5.3 fixed charges:** municipal basic charges can be **R/day** (Cape Town), not only Eskom R/POD/day. Any fixed component with a per-day unit is multiplied by the days in the month.
13. **§5.5 network capacity:** Eskom SPU NCC is **R/POD/day** (Homeflex R12.13/POD/day, "based on NMD" by footnote), not NMD × R/kVA. Support both.
14. **§5.1 adders:** Homeflex carries the network demand charge as **c/kWh** (26.37), alongside ancillary (0.41) and legacy (22.78). Include it as a per-kWh adder, as the spec lists, and do not confuse it with an R/kVA demand charge.
15. **§5.6 reactive:** accept a reactive component whose source label says "Demand" but whose unit is c/kVArh (City Power). The component comes from the normaliser, and the engine must not re-derive it from the label.
16. **Validation (D-19):** add the 10 golden cases in §7.2 as unit tests of the engine plus normaliser, alongside the 3–5 real bills. Cases 2, 3, 7 and 10 exercise exactly the defects the old seed had.
17. **Wheeling scenario (new, optional):** Option 1 = full tariff − wheeled kWh × (TOU WEPS/avoided cost excl losses), wheeled kWh capped per TOU period (Wheeling Rules pp19–20). Option 2 = netting with fully unbundled UoS (p21). This is only needed if off-site PV is in scope.
