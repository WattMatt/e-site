# 09 — NERSA tariff source folder review (for the E-Site solar feasibility module)

Reviewed 2026-09-28. Read-only; nothing in the source folder or the WM Solar tree was modified.

Source folder: `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/005. NERSA TARIFFS`

---

## 0. The headline: none of the 44 source files could be read

**All 44 files are 0-byte Dropbox online-only placeholders. Not one could be read.** The evidence:

- `stat` gives size 0 for every file. `head -c 100`, and a Python `open(...).read()`, return 0 bytes, including for `nersa_parser.py`, `Gauteng-Province.xlsx` and `Net-Billing-Rules-licensed-Distributors.pdf`.
- Every file carries the xattrs `com.dropbox.placeholder` (38 B) and `com.dropbox.attrs` (26 B). The placeholder attribute holds only `03 0a`, so there is no content and no pointer that could be hydrated locally.
- Reading does not trigger a download. This copy on the external SSD is not the live Dropbox sync root. The live root is `~/Library/CloudStorage/Dropbox-WATSONMATTHEUS`, and macOS privacy controls block this agent from it: `ls` gives "Operation not permitted".
- A disk-wide search of `/Volumes/Extreme SSD`, `~/Documents`, `~/Downloads` and the scratchpad found no readable copy of `nersa_parser.py`, `supabase_nersa_schema.sql`, `nersa_seed_data.sql`, `LOVABLE_PROMPT.md`, `NERSA_Schema_Documentation.md`, `eskom_parser.py`, any `*-Province.xlsx`, or any of the regulatory PDFs.

**So sections 1–5 below separate two kinds of statement:**
- **[VERIFIED]** means I read it directly from something readable. There are three such sources: the WM Solar migrations and edge function that consumed this folder's output, the Eskom Tariff Comparison Tool workbook shipped inside WM Solar, and a sibling verification note in RESPUBLICA METERING.
- **[NOT READ]** means the content could not be examined. In those places I give only what can be inferred from the file name, the date, or downstream artefacts, and I label it that way. I made no guesses about content.

**To finish this review properly:** in Finder, right-click the folder and choose Dropbox → "Make available offline". Alternatively, grant the terminal Full Disk Access to `~/Library/CloudStorage`. Then re-run the inventory. The scripts in §8 are ready.

---

## 1. File inventory

Every file is 0 B on disk and marked "no" for readable. "Date" is the file mtime. Rows and pages could not be measured for any file.

| # | Path | What it is (from name/context) | FY | Date | Readable |
|---|------|--------------------------------|----|------|----------|
| 1 | 2025/Eastern-Cape-Province.pdf | NERSA-approved municipal tariff book, EC | 2025/26 | 2025-06-11 | no |
| 2 | 2025/Eastern-Cape-Province.xlsx | Same as a spreadsheet (re-saved; later mtime) | 2025/26 | 2025-10-18 | no |
| 3 | 2025/Free-State-Province.pdf | Municipal tariff book, FS | 2025/26 | 2025-06-11 | no |
| 4 | 2025/Free-State-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 5 | 2025/Gauteng-Province.pdf | Municipal tariff book, GP | 2025/26 | 2025-06-11 | no |
| 6 | 2025/Gauteng-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 7 | 2025/Kwa-Zulu-Natal-Province.pdf | Municipal tariff book, KZN | 2025/26 | 2025-06-11 | no |
| 8 | 2025/Kwa-Zulu-Natal-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 9 | 2025/Limpopo-Province.pdf | Municipal tariff book, LP | 2025/26 | 2025-06-11 | no |
| 10 | 2025/Limpopo-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 11 | 2025/Mpumalanga-Province.pdf | Municipal tariff book, MP | 2025/26 | 2025-06-11 | no |
| 12 | 2025/Mpumalanga-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 13 | 2025/North-West-Province.pdf | Municipal tariff book, NW | 2025/26 | 2025-06-11 | no |
| 14 | 2025/North-West-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 15 | 2025/Northern-Cape-Province.pdf | Municipal tariff book, NC | 2025/26 | 2025-06-11 | no |
| 16 | 2025/Northern-Cape-Province.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 17 | 2025/Western-Cape-Province1.pdf | Municipal tariff book, WC (the "1" suffix is a duplicate-download artefact) | 2025/26 | 2025-06-11 | no |
| 18 | 2025/Western-Cape-Province1.xlsx | spreadsheet | 2025/26 | 2025-06-11 | no |
| 19 | 2025/nersa_parser.py | XLSX → SQL parser | — | 2026-02-18 | no |
| 20 | 2025/supabase_nersa_schema.sql | Target Postgres schema | — | 2026-02-18 | no |
| 21 | 2025/nersa_seed_data.sql | Generated INSERTs | 2025/26 | 2026-02-18 | no |
| 22 | 2025/NERSA_Schema_Documentation.md | Schema docs | — | 2026-02-18 | no |
| 23 | 2025/LOVABLE_PROMPT.md | Prompt handed to Lovable to apply the schema to WM Solar | — | 2026-02-18 | no |
| 24 | ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm | Eskom's official tariff workbook | Eskom FY 2025/26 (1 Apr 2025 – 31 Mar 2026) | 2026-03-19 | no |
| 25 | ESKOM/Tariff-booklet2.pdf | Eskom Schedule of Standard Prices / tariff booklet | 2025/26 (inferred) | 2026-03-19 | no |
| 26 | ESKOM/README.md | Notes for the Eskom pipeline | — | 2026-03-19 | no |
| 27 | ESKOM/eskom_parser.py | Eskom workbook → SQL parser | — | 2026-03-19 | no |
| 28 | ESKOM/supabase_eskom_schema.sql | Eskom schema | — | 2026-03-19 | no |
| 29 | ESKOM/eskom_seed_data.sql | Eskom seed | 2025/26 | 2026-03-19 | no |
| 30 | DOCUMENTATION/Net-Billing-Rules-licensed-Distributors.pdf | NERSA net-billing rules | — | 2025-09-02 | no |
| 31 | DOCUMENTATION/NERSA-Regulatory-Rules-on-Network-Charges-for-Third-Party-transportation-of-energy_Approved-03-March-2025-_2.pdf | Wheeling / third-party network-charge rules, approved 3 Mar 2025 | — | 2025-09-02 | no |
| 32 | DOCUMENTATION/Electricity-Regulation-2006-Act-No-4-of-2006-…-Act-No-28-of-2007.pdf | Electricity Regulation Act (ERA) | — | 2025-09-02 | no |
| 33 | DOCUMENTATION/NERSA-ACT.pdf | National Energy Regulator Act | — | 2025-09-02 | no |
| 34 | DOCUMENTATION/Electricity_Pricing_Policy.pdf | EPP (2008) | — | 2025-09-02 | no |
| 35 | DOCUMENTATION/Free-Basic-Electricity-Policy.pdf | FBE policy | — | 2025-09-02 | no |
| 36 | DOCUMENTATION/NERSA-Rules-for-Licensable-Distribution-Areas-of-Supply.pdf | Area-of-supply rules | — | 2025-09-02 | no |
| 37 | DOCUMENTATION/Update-of-the-2019-COUE-Values-…pdf | Cost of Unserved Energy update | — | 2025-09-02 | no |
| 38 | DOCUMENTATION/Overview-of-the-Dispute-Resolution.pdf | Dispute resolution | — | 2025-09-02 | no |
| 39 | DOCUMENTATION/Board-submission-for-Dispute-Resolution-…2019-Final.pdf | Dispute resolution board paper | — | 2025-09-02 | no |
| 40 | DOCUMENTATION/NERSAComplaintForm.pdf | Complaint form | — | 2025-09-02 | no |
| 41 | DOCUMENTATION/RFQs.pdf | Unknown (procurement?) | — | 2025-09-02 | no |
| 42 | DOCUMENTATION/RULES-FOR-SELECTION-CRITERIA-19-Feb10.pdf | Selection-criteria rules (2010; likely the renewables/REFIT era) | — | 2025-09-02 | no |
| 43 | DOCUMENTATION/SGP-ESKOM-application-for3X35tariff-increase-2010-…pdf | Eskom's 2010 MYPD2 3×35% application (historical) | 2010 | 2025-09-02 | no |
| 44 | DOCUMENTATION/SPLUMA.pdf | Spatial Planning and Land Use Management Act | — | 2025-10-15 | no |

Observations drawn only from metadata:
- All 9 provinces are present as a PDF + XLSX pair (18 files). No per-municipality books exist. Eskom is a separate folder.
- The pipeline artefacts (#19–23) all share the date **2026-02-18**. That is the same day WM Solar applied migration `20260218094522` "NERSA TARIFF DATABASE MIGRATION" (see §4). This is strong circumstantial evidence that the migration is `supabase_nersa_schema.sql` applied by Lovable via `LOVABLE_PROMPT.md`.
- The Eskom pipeline (#26–29) is dated 2026-03-19, a month later. **WM Solar has no migration of that date.** The Eskom schema/seed appears **never to have been applied** to WM Solar. WM Solar instead extracts Eskom tariffs through its AI edge function (§4.3).
- Of the 15 DOCUMENTATION PDFs, only #30 and #31 bear directly on a solar module. #32–#36 are background. #37–#44 are not relevant.

---

## 2. Structure of the per-province XLSX files

**[NOT READ]** The XLSX files could not be opened, so I have no sheet list, no column layout and no counts measured from source. What *can* be established indirectly is below.

### 2.1 What the downstream code reveals about the layout [VERIFIED from WM Solar]

`supabase/functions/process-tariff-file/index.ts` is WM Solar's AI importer, which was pointed at these same province workbooks and PDFs. It encodes these assumptions about them:

- **One sheet per municipality, named "`<MUNICIPALITY> - <nn.nn>%`"**, the % being that municipality's NERSA-approved increase. The code strips it with `/\s*-\s*\d+\.?\d*%$/` (lines 261, 810, 1433). The PDF variant uses the same header convention, e.g. "POLOKWANE - 14.59%" (line 822).
- Categories: Domestic / Commercial / Industrial / Agricultural, with Prepaid as separate named tariffs. IBT blocks are written like "Block 1 (0-50)kWh" and ">600kWh". Basic charge is in R/month, demand in R/kVA, energy in c/kWh. Phase is Single/Three. Voltage is LV (≤400 V) / MV (11/22 kV) / HV (≥44 kV). TOU is High/Low season × Peak/Standard/Off-peak (prompt lines 871ff).
- **VAT duplication:** the extractor dedupes energy rates by keeping the *lowest* value per (season, tou, block) and logs "Deduped … VAT-inclusive energy rates" (lines 1314–1327). So the sources show **both VAT-excl and VAT-incl values**, at least in some provinces. The Eskom prompt says so explicitly: each cell shows two values.

### 2.2 Counts [VERIFIED from WM Solar migration comments, not from the XLSX]

The rebuild migration `20260218094522` annotates its tables as follows. These are the seed's totals, so they are the nearest available proxy for "what the XLSX contained":
- `PROVINCES (9 rows)`
- `MUNICIPALITIES (177 rows)` → about 20 per province on average
- `TARIFF PLANS (~1,978 rows)` → about 11 per municipality
- `TARIFF RATES (~6,092 rows)` → about 3.1 rate lines per plan

**A per-province breakdown of municipalities and tariff rows cannot be produced** without the XLSX or the seed. For comparison, the later name-registry migration `20260219121343` seeds 193 municipality names: EC 33, FS 19, GP 9, KZN 38, LP 7 (after cleanup of existing rows), MP 17, NW 18, NC 26, WC 25, plus a fake "Eskom" province holding "Eskom Direct". That is a list of names, not a list of municipalities with tariffs. The gap between 177 and 193+ suggests at least some municipalities in the name list had no tariff sheet.

### 2.3 Quirks you should expect, and check for once the files are readable

These were not observed, because the files could not be opened. They are inferred from the dedupe logic and from the one municipal tariff book that was verified elsewhere (RESPUBLICA note on the Stellenbosch 2025/26 book).
- Values given both VAT-excl and VAT-incl, sometimes in adjacent columns and sometimes as two numbers in one cell.
- Mixed units within a sheet: c/kWh for energy, R/month or R/day for fixed charges, R/kVA/month for demand, and R/A or R/amp for capacity charges.
- Tariffs labelled with municipality-specific scale codes (the WM Solar schema has `scale_code`, `is_redundant` and `is_recommended` for exactly this).
- "Redundant" or legacy tariffs that are still listed.
- The Stellenbosch note found that the reference book was a **draft** "Application" book, not the final approved one. The province books may contain the same draft-versus-final ambiguity.

---

## 3. The Eskom files

**[NOT READ]** `ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm` and `Tariff-booklet2.pdf` could not be opened.

**[VERIFIED] substitute:** WM Solar ships Eskom's own **Tariff Comparison Tool** as `public/temp/Eskom-TCT-2025.xlsm` and `Eskom-TCT-202526.xlsm`. The two files are byte-identical (md5 `3d9c5abe…`). Its "New" sheets hold 2025/26 prices and its "Current" sheets hold 2024/25 prices. Its `Lists` sheet gives Eskom FY end 2026-03-31, municipal FY end 2026-06-30, and VAT 0.15. All prices are **VAT-exclusive, in c/kWh**, unless stated otherwise.

### 3.1 Tariffs covered (TCT "New" = 2025/26)

- **Large power user (LPU) energy sheet: 233 rows.** Megaflex 17, Miniflex 17, Ruraflex 17, Nightsave (Urban Large/Small, Rural) 51, Municflex 97, Transflex 34.
  - Each is gridded by transmission zone (0–300 / 301–600 / 601–900 / >900 km) × supply voltage (<500 V; ≥500 V & <66 kV; ≥66 kV & ≤132 kV; >132 kV).
  - Columns: High-season Peak/Standard/Off-peak; Low-season Peak/Standard/Off-peak; Nightsave High/Low energy and demand charges; transmission network charge (R/kVA/m); network capacity charge (R/kVA/m); generation capacity charge (R/kVA/m); legacy charge (c/kWh).
- **LPU by voltage: 65 rows.** Distribution network capacity charge (NCC), network demand charge (NDC, both as R/kVA and as c/kWh), ancillary service charge, urban LV subsidy (R/kVA), GCC.
- **LPU other:** electrification & rural subsidy (ERS) c/kWh; environmental levy, which is "n/a" in the new structure; reactive energy c/kVArh; affordability subsidy c/kWh.
- **Small power user (SPU): 46 rows.**
  - Businessrate 1–4
  - Homepower 1–4 + Bulk
  - Homelight 20A/60A
  - Homeflex 1–4 (TOU)
  - Landrate 1–4 + Dx
  - Landlight 20A/60A
  - Public Lighting (24 h / All Night / Urban Fixed)
  - Municrate 1–4
  - Each tariff has Non-Local-Authority and Local-Authority variants.
- **Not in the TCT:** Gen-offset / Gen-wheeling / Gen-purchase / WEPS / TUoS / DUoS tables. WM Solar's batch list does expect these as sheet names in the official xlsm ("gen-offset", "gen-wheeling", "gen-purchase", "tuos nla", "duos nla", "ancillary").

Sample 2025/26 values:
- **Megaflex, >900 km, <500 V:** High 705.13 / 176.28 / 117.52; Low 292.64 / 164.53 / 117.52 c/kWh; transmission network 10.96 R/kVA/m; GCC 3.49; legacy 22.78 c/kWh.
- **Homeflex 1:** High 706.97 / 216.31 / 159.26; Low 329.28 / 204.90 / 159.26; legacy 22.78.
- **Homepower 1–4:** flat 268.78 c/kWh. **No inclining blocks in 2025/26**; the TCT's Block 1/2 columns are 0.
- **Businessrate 1–3:** flat 224.93 c/kWh.

### 3.2 TOU periods [VERIFIED, TCT `METADATA` grid, hour-by-hour]

In the strings below, each character is one hour from 00h to 23h: P = peak, S = standard, O = off-peak.

| Season / day | 2025/26 ("Current TOU") | 2024/25 ("Previous") |
|---|---|---|
| High (Jun–Aug), weekday | `OOOOOOPPSSSSSSSSSPPPSSOO` → **peak 06–08, 17–20** | peak 06–09, 17–19 |
| High, Saturday | std 07–12, 17–19 | std 07–12, 18–20 |
| High, Sunday | **std 17–19** (new); all other hours off-peak | all off-peak |
| Low (Sep–May), weekday | `OOOOOOSPPSSSSSSSSSPPPSOO` → **peak 07–09, 18–21** | peak 07–10, 18–20 |
| Low, Saturday | std 07–12, 18–20 | std 07–12, 18–20 |
| Low, Sunday | std in the evening (19–21 per the grid, with one unreadable cell at 05h); verify against the booklet | all off-peak |

The same sheet also carries a public-holiday table covering 2025-04-18 to 2026-06-16, each holiday mapped to the day-type it is treated as (1 = Sunday, 7 = Saturday).

⚠ **WM Solar gets this wrong.** `TOUReference.tsx` and `NERSAGuidelines.tsx` hard-code a single weekday window for both seasons: "07:00-09:00, 17:00-20:00", with a Sunday standard period of 18:00-20:00. Against Eskom's own tool, the high-season morning peak should be 06–08 and the low-season evening peak should be 18–21. The TOU-window table (`tou_periods`) was dropped in the February 2026 rebuild, so WM Solar now holds no TOU windows as data at all.

### 3.3 Charge components (the 2025/26 unbundled structure)

The energy charge is split by season and TOU. Alongside it:
- legacy charge (c/kWh)
- generation capacity charge (R/POD/day or R/kVA/m)
- transmission network charge (R/kVA/m)
- distribution network capacity charge (R/kVA/m or R/POD/day)
- network demand charge (R/kVA/m or c/kWh)
- ancillary service charge (c/kWh)
- electrification & rural subsidy (c/kWh)
- affordability subsidy (c/kWh)
- urban LV subsidy (R/kVA/m)
- service & administration charge (R/POD/day)
- reactive energy charge (c/kVArh, high season only)

---

## 4. Parser, schema, seed and Lovable prompt

### 4.1 `nersa_parser.py`, `NERSA_Schema_Documentation.md`, `LOVABLE_PROMPT.md`

**[NOT READ].** I cannot say what the parser does or misses. I can say what its output looked like once applied (§4.2), and what the prompt must have asked for: a drop-and-recreate of WM Solar's tariff tables to "the new NERSA schema", with public read and authenticated write (§4.2).

### 4.2 `supabase_nersa_schema.sql` as applied in WM Solar [VERIFIED, migration `20260218094522`]

**Enums:**
- `customer_category`: domestic, domestic_indigent, commercial, industrial, agricultural, public_lighting, sports_facilities, public_benefit, bulk_reseller, departmental, availability, other
- `metering_type`: prepaid, conventional, both, unmetered
- `tariff_structure`: flat, inclining_block, seasonal, time_of_use, demand, hybrid
- `voltage_level`: low, medium, high
- `charge_type`: basic, energy, demand, network_access, network_demand, reactive_energy, service, admin, maintenance, availability, capacity, ancillary, subsidy, surcharge, amperage, notified_demand
- `season_type`: all, low, high
- `tou_period`: all, peak, standard, off_peak

**Tables:**
- `provinces(name, code)`
- `municipalities(province_id, name, nersa_increase_pct, financial_year text)`, UNIQUE(province, name)
- `tariff_plans(municipality_id, name, scale_code, category, metering, structure, voltage, phase, min/max_amps, min/max_kva, min/max_kw, description, is_redundant, is_recommended)`, later extended with `effective_from/effective_to`
- `tariff_rates(tariff_plan_id, charge, season, tou, block_number, block_min/max_kwh, consumption_threshold_kwh, is_above_threshold, amount, unit text, notes)`

**Other objects:** views `v_tariff_lookup` and `v_municipality_summary`, and the function `calculate_monthly_cost()`. The migration contains **0 INSERTs**, so the seed was loaded separately.

**Defects that matter if E-Site copies this schema:**
1. **No real versioning.** `financial_year` is a free-text field on the *municipality*, and UNIQUE(province, name) permits one row per municipality. Two financial years cannot coexist without duplicating plans under the same municipality and relying on the `effective_from/to` that was bolted on later. Nothing links a plan to its predecessor, so year-on-year diffs are impossible.
2. **Units are free text, and mixed units are a live bug.**
   - `calculate_monthly_cost()` divides energy by 100, which assumes c/kWh.
   - WM Solar's AI importer writes energy rows with `unit:'R/kWh'` (already divided by 100), but legacy, ancillary and other rows as c/kWh.
   - Any plan created by the importer is therefore **understated 100×** in that function.
3. **TOU plans are silently excluded from cost estimates.** The function filters `tr.tou = 'all'`. There are no TOU time windows anywhere in the schema (`tou_periods` was dropped).
4. **Demand charges have no basis.** Nothing says whether a charge applies to NMD or actual MD, to peak-window or all-time demand, or per kVA versus per kW. The ratchet/minimum-billing rule is also missing.
5. **VAT handling is lossy.** Only one `amount` is stored, and nothing marks whether it is VAT-exclusive. The importer's "keep the lowest" dedupe would also drop legitimate distinct rates that happen to share a (season, tou, block) key, for example prepaid versus conventional rows that were parsed into one plan.
6. **No provenance.** No field records the source document, page or sheet, row or cell, or a hash. `municipalities.source_file_path` existed in the old schema and was dropped.
7. **RLS lets any authenticated user write** (`FOR ALL TO authenticated USING (true)`), so any user can rewrite the public tariff reference data.
8. **Eskom is modelled as a province** ("Eskom" / "Eskom Direct"), which conflates licensee with geography.
9. **No export/feed-in, SSEG or wheeling tariffs anywhere.** A grep of every WM Solar migration for feed-in/export/net-billing/SSEG/wheeling returns nothing.

### 4.3 Seed completeness

- **[NOT READ]** `nersa_seed_data.sql`.
- By the migration's own comments, the seed held 177 municipalities, about 1,978 plans and about 6,092 rates.
- Its completeness against the XLSX cannot be measured. The one mismatch that can be seen: Limpopo needed a follow-up cleanup (`20260219121343`: deleted the duplicate "BELABELA" and renamed 15 malformed names such as "Bela-Bela" and "Modimolle-Mookgophong"). So the parser's municipality-name normalisation was imperfect, at least for Limpopo.

WM Solar's AI importer is a second, parallel path into the same tables:
- Claude Sonnet with tool-use
- Source text truncated to 15,000 characters per municipality
- Analysis pass capped at the first 150 rows per sheet
- A "reprise" re-check pass

The 15k truncation will cut large metros (Johannesburg, Tshwane, Ekurhuleni, Cape Town). An ingestion path whose output is 100× wrong on units, and whose input is truncated, should not be ported.

---

## 5. Regulatory documents relevant to a solar module

**[NOT READ]** All the PDFs are placeholders, so **no page references can be given** and nothing below is quoted from them. What follows is general regulatory context from background knowledge. It needs checking against the documents once they are hydrated, and the module should cite the documents, not this note.

- **Net-Billing Rules for licensed distributors (#30).** For SSEG customers, NERSA's framework is net *billing*, not net *metering*:
  - Import is billed at the customer's normal tariff.
  - Export is credited at a separate export/feed-in rate, typically tied to the distributor's avoided cost (the Eskom WEPS/Gen-offset basis for Eskom customers, and a municipal feed-in tariff for municipal customers).
  - Credits normally offset charges only within the billing period. Typical rules are no cash-out and no rollover beyond a limit, and exports above consumption may be uncredited or capped.
  - Customers usually have to be on a bidirectional meter, and often on a TOU tariff (Eskom requires Homeflex for residential grid-tied generation).
  - Things to extract when readable: the crediting formula, the settlement period, caps, the TOU requirement, metering requirements, and whether the rules bind municipalities or are guidance.
- **Third-party network-charges (wheeling) rules, approved 3 March 2025 (#31).** These set how a licensee charges use-of-system (TUoS/DUoS, losses, ancillary, admin) for energy transported from a third-party generator to an off-taker. They matter for off-site PPAs and virtual wheeling scenarios, not for rooftop self-consumption. Things to extract: the charge components, the loss-factor treatment, how reconciliation and credits are applied (Eskom "Gen-wheeling" credits energy at the WEPS rate excluding losses, per WM Solar's own NERSAGuidelines text), and any cap for small generators.
- **SSEG registration.** None of the listed files is an SSEG registration rule set. The ERA (#32) Schedule 2 licensing exemptions (post-2022/23 amendments: no licence limit, but registration with NERSA or the distributor) and NRS 097-2-x connection standards govern this. Neither the NRS 097 standards nor a NERSA SSEG registration rule is in the folder. The Electricity Pricing Policy (#34) and FBE policy (#35) are background only.

---

## 6. Gaps

1. **2025/26 is not the current year.** Municipal financial years run 1 July to 30 June. **2026/27 municipal tariffs have been in force since 1 July 2026**, and the folder holds none. The sibling note `RESPUBLICA METERING/.../Tariff and NERSA resale verification (2026-09-09).md` records NERSA's 2026/27 municipal guideline increase as **9.01%**. I did not verify that figure independently; confirm it against the NERSA decision. Every 2025/26 municipal rate in the seed is therefore about one year stale.
2. **Eskom 2026/27 (from 1 April 2026) is missing.** The Eskom workbook is "1-April-2025". Both the TCT and the ESKOM folder stop at 2025/26. Municipal bulk tariffs (Municflex/Municrate) change on 1 July instead, so the model needs both calendars.
3. **Province/municipality coverage cannot be confirmed.** The 177 seeded municipalities are fewer than the name registry (193+). Which municipalities have no tariffs is unknown without the seed. Metro books (for example City Power, the City of Cape Town) are normally separate, larger documents and may be thinned by the province compendium.
4. **No export/feed-in or SSEG tariffs, in either the folder or WM Solar.** For a solar feasibility module this is the most material gap, because export credit drives the value of any oversized array. Each metro and municipality publishes its own SSEG feed-in rate and any SSEG-specific fixed charges.
5. **No Eskom generator tariffs as data** (Gen-offset, Gen-wheeling, Gen-purchase, WEPS), and no TUoS/DUoS tables.
6. **No TOU window data** in WM Solar, and the hard-coded windows are wrong (§3.2).
7. **Draft versus final books.** At least one municipal book used in the office was a draft (Stellenbosch). The source of each municipal book needs a `status` field (draft, final council-approved, or NERSA-approved).
8. The folder does not contain NRS 097, the NERSA SSEG registration framework, or municipal SSEG by-laws.

---

## 7. Recommended canonical tariff model for E-Site

The design goals:
- one row per *published fact*
- every row traceable to a page or cell in a stored source document
- financial years as first-class versions
- all units normalised
- VAT stored explicitly
- TOU windows held as data

Suggested schema `tariffs`. It needs its own schema, PostgREST exposure and `@verify` blocks per E-Site conventions.

```
tariffs.licensee            id, kind (eskom|municipal|metro|private), name, mdb_code, province, nersa_licence_no, parent_licensee_id
tariffs.source_document     id, licensee_id?, kind (tariff_book|nersa_decision|eskom_schedule|rules|by_law),
                            title, financial_year, status (draft|final|nersa_approved), published_on,
                            storage_path (Supabase bucket), sha256, page_count, url, retrieved_at
tariffs.tariff_year         id, licensee_id, financial_year ('2026/27'), effective_from, effective_to,
                            approved_increase_pct, source_document_id, state (ingesting|in_review|published|superseded)
                            UNIQUE (licensee_id, financial_year)
tariffs.tariff              id, tariff_year_id, code (scale_code), name, family (e.g. Megaflex),
                            category (enum as WM Solar + 'sseg_export'), metering (prepaid|conventional|both|unmetered),
                            structure, voltage_band (lt500V|500V_66kV|66_132kV|gt132kV), phase, transmission_zone,
                            local_authority bool, min/max_amps, min/max_kva, eligibility jsonb,
                            predecessor_tariff_id (for YoY diff), is_legacy, notes
tariffs.charge              id, tariff_id, component (energy|legacy|basic|service|admin|network_capacity|network_demand|
                            transmission_network|gcc|ancillary|ers|affordability|lv_subsidy|reactive|demand|capacity_amp|
                            export_credit|wheeling_uos|loss_factor|…),
                            season (all|high|low), tou (all|peak|standard|off_peak), day_type?,
                            block_min_kwh, block_max_kwh, block_basis (monthly|daily),
                            unit (enum: c_per_kWh|R_per_kWh|R_per_month|R_per_day|R_per_kVA_month|R_per_kW_month|
                                  R_per_A_month|c_per_kVArh|R_per_POD_day|pct),
                            demand_basis (nmd|actual_md|peak_window_md|utilised_capacity)?,
                            amount_excl_vat numeric(14,6) NOT NULL, amount_incl_vat numeric(14,6), vat_rate,
                            source_document_id, source_locator jsonb ({page, sheet, cell, row_label}),
                            extraction_method (parser|ai|manual), reviewed_by, reviewed_at
tariffs.tou_calendar        id, licensee_id, valid_from, valid_to, season_months int[] (high = {6,7,8})
tariffs.tou_window          calendar_id, season, day_type (weekday|saturday|sunday), start_minute, end_minute, period
tariffs.holiday_day_type    calendar_id, date, treated_as (saturday|sunday)
tariffs.sseg_rule           licensee_id, tariff_year_id, crediting (net_billing|net_metering|none), settlement_period,
                            export_cap_rule, requires_tou bool, requires_bidirectional_meter bool, source_document_id, locator
```

Rules:
- Money is stored VAT-exclusive, with the VAT rate and date alongside. Amounts are converted to canonical units at ingest, and the original string and unit are kept in `source_locator`.
- Reference data is public-read. Writes go through the service role and the review workflow only, never through any authenticated user.
- Projects pin a `tariff_id`, which fixes the year. Escalation beyond the latest published year is an explicit scenario parameter (for example 9.01%, then an assumed path), never an implicit reuse of the old rates.
- The bill engine is a pure function in `@esite/shared`: (tariff + charges + TOU calendar + 8760 load + PV profile) → monthly bill and export credit. It is unit-tested against 3–5 hand-checked real bills.

### Ingestion pipeline

1. **Acquire.** Download each province XLSX/PDF, metro books, the Eskom xlsm/booklet and the NERSA decisions into a `tariff-sources` bucket. Record sha256; an unchanged hash means no re-ingest.
2. **Parse deterministically** (not an LLM as the primary path). One parser per format family, for example the NERSA province compendium (one sheet per municipality, "NAME - x%") and the Eskom official xlsm (fixed sheet names). The parser emits `charge` rows with `source_locator`. An LLM is allowed only as a fallback for PDF-only municipalities, and its output always goes through review.
3. **Validate automatically.** Checks:
   - units are known
   - VAT-incl ≈ excl × 1.15 when both are given
   - IBT blocks are contiguous and non-overlapping
   - TOU tariffs have all 6 season×period energy values
   - amount ranges are plausible (for example 50–1,500 c/kWh)
   - the municipality exists in the licensee registry
   - the % increase against the predecessor tariff is within ±3 pp of `approved_increase_pct`
4. **Diff against the previous year.** Match on (licensee, code or name, structure) into `predecessor_tariff_id`. Produce a per-licensee report of new, removed and changed tariffs and each charge's % change. Outliers are flagged for review.
5. **Human review.** An admin UI shows each charge beside a rendered crop of its source page or cell. Approve, edit or reject. Publishing flips `tariff_year.state` to `published` and the previous year to `superseded`, but never deletes it.
6. **Monitor.** A cron job on 1 July and 1 April raises a "new tariff year due" alert for any licensee with no published year covering today.

---

## 8. What to run once the files are hydrated

1. `find … -size 0` → should return nothing.
2. For each `*-Province.xlsx`: list sheets, count sheets matching `- \d+(\.\d+)?%$` (= municipalities), count non-empty rows per sheet, and collect header vocabulary (units, VAT markers, "Block", "Peak", "kVA", "Prepaid").
3. `pdfinfo` page counts for every PDF, and `pdftotext -layout` on #30 and #31 for page-referenced quotes to fill in §5.
4. Diff `supabase_nersa_schema.sql` against WM Solar `20260218094522` to confirm the provenance inferred in §1.
5. Count the INSERTs in `nersa_seed_data.sql` per province, and compare with the XLSX sheet counts to measure seed completeness.
