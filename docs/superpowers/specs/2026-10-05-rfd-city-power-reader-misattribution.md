# RfD City Power reader — prose headers, hidden headers, and published years that cannot be corrected

**Date:** 2026-10-05 · **Status:** owner approved the proposal 2026-10-05; implemented (see §6)
**Trigger:** E7 finding — MIDVAAL 2026/27 (published) has a tariff named
"Based on the available information and the analysis performed, the REC decided:".

## 1. MIDVAAL, against the PDF (`pdftotext -layout`, sha256 `9c0eac50…ed915`, matches prod)

- The published year holds **one** tariff with **22** charges (pages 18–20), not 6. The whole
  schedule collapsed into it. Header locator = page 1 line 21 = decision paragraph "2. Based on…".
- The six TOU energy charges on page 20 are **Megaflex** (printed "Page 20 of 21"). Values are
  correct transcriptions of the Recommended column and equal Approved × 1.10 to the cent:
  196.24 / 324.23 / 783.03 (high off-peak/standard/peak), 183.34 / 232.91 / 519.05 (low).
- The other 16 charges belong to 11 other tariffs (Flat & Townhouse, General Lighting, Municipal
  Suppliers, Agriculture Single Phase, Agriculture Nightsave, Industrial Bulk LV, Bulk MV,
  Off-Peak LV/MV, Megaflex reactive). Missing entirely: Domestic IBT (4 blocks), Commercial,
  Charitable, Megaflex demand 205.03 R/kVA (page 21), and all of Miniflex (7 rows).
- The column reader (`parseRfdColumns`) on the same text produces 14 correctly named tariffs, with
  1 blocking issue (Agriculture Nightsave day/night not read) and 1 review (Megaflex demand dropped).

## 2. Root cause — two defects in `parseRfdCityPower` (rfd-text.ts), plus the dispatcher

`parseRfdText` takes the City Power reader's output whenever it yields ≥ 1 tariff. That reader's
model: a tariff opens at `N. Name` **in literal column 0**, and every later column-0 charge row
belongs to the open draft.

- **D1 — layout mismatch.** In files whose tariff names are not `N. Name` headers (MIDVAAL:
  "Flat and Townhouse Complexes   Approved …"), the only header the reader recognises is a numbered
  decision paragraph, a TOC line ("CONCLUSION ……23") or a section heading ("DETERMINATION OF …
  TARIFFS BASED ON THE COST OF"). The draft stays open across hundreds of lines and swallows every
  table. "7.   TARIFF ANALYSIS" does not close it (2+ spaces after the number fail `HEADER`).
- **D2 — indented pages.** pdftotext shifts some pages 1–3 spaces right. Headers and labels on
  those pages go to the `^\s` branch, are never headers, and their rows are lost. Rows that spill
  past a page break back into column 0 attach to whatever draft is open: a prose header (City Power
  service 70 / capacity 140 belong to "2. Residential Prepaid High"; Dikgatlong 314.93 to
  "2. Residential Conventional"; Rustenburg Block 4 + Basic to "Residential Conventional (Town)"),
  or, silently, the previous real tariff.

Evidence: of the 33 files read by this reader, 13 carry a prose/TOC/section header as a tariff
name, and 15 have `N. Name` headers at indent 1–2 that the reader cannot see.

## 3. Prose-like names in published years (DB sweep: length > 70, trailing `: , ; .`, dot leaders,
"decided|analysis|determination|conclusion|based on|regulator|municipality must")

| Licensee 2026/27 (published) | Defect | Effect |
|---|---|---|
| MIDVAAL | D1 | 1 tariff / 22 charges = whole schedule |
| BA-PHALABORWA | D1 ("CONCLUSION ……") | 1 tariff / 5 charges |
| GREATER LETABA | D1 ("DETERMINATION OF …") | 1 tariff / 14 charges |
| LEPHALALE | D1 ("DETERMINATION OF …") | 1 tariff / 13 charges |
| DR PIXLEY KA SEME | D1 ("CONCLUSION ……") | 9 charges under the TOC line; unit looks like R/kWh stored as c/kWh (2.1786) |
| RENOSTERBERG | D1 ("that the municipality must submit …") | 11 charges |
| DIKGATLONG | D2 spill-over | 1 charge under "Based on …" |
| NKANDLA | D1/D2 | 2 charges under "DETERMINATION OF …" |
| RAMOTSHERE MOILOA | D2 | "9. Industrial Low Tension" missing, no flag |
| TSWAING | D2 | "3. Commercial Business", "11. Households with flats" missing, no flag |

In review, same class: CITY POWER, RUSTENBURG, CITY OF MATLOSANA, NALEDI (36 charges), BELA-BELA,
MODIMOLLE-MOOKGOPHOONG (39), EMFULENI; D2 also in MODALE CITY, RANDWEST, MAQUASIE HILLS, NANAKHOI,
RICHTERSVELD, KOUGA, KING SABATA DALINDYEBO.
Cosmetic only (column reader, charges plausible): MEGA "DETAILS OF TARIFFS APPLIED FOR 2.Industrial…",
POLOKWANE "DOMESTIC TARIFFS TARIFF A: …", names ending in " Approved".
2025/26 published long names come from the province workbooks and are real names.

Nothing references any affected tariff yet: `solar.studies` / `bill_checks` / `tariff_overrides` = 0
(one study platform-wide, on another tariff).

## 4. Why the narrow fix was not built

A scratch experiment (not committed) tried "reject prose header text":
- MIDVAAL still collapses, now under "1. At its meeting held on 30 April 2026, the REC" (no prose
  marker). Text heuristics are whack-a-mole.
- Widening the label column to indent ≤ 2 for D2 made the City Power reader claim 11 files the
  column reader currently parses (e.g. MASILONYANA → 1 tariff / 56 charges, a new collapse).
- Baseline reproduction: all 170 committed digests match locally (TARIFF_SOURCE_DIR on the SSD).

## 5. Proposal (needs owner confirmation)

**Parser (one PR, test-first; fixtures = MIDVAAL p16–21, City Power p27–28, Ramotshere p23 excerpts):**
1. D1, structural not textual: a draft that reaches a page break with no charge is closed, and a
   column-0 numbered section line that is not a header ("7.   TARIFF ANALYSIS") closes the open
   draft. Rows then orphan instead of attaching to prose. A file where the City Power reader ends
   with orphaned rows falls through to the column reader, so it does not partly win.
2. D2: a page-relative label column, computed only from lines that carry a five-number row or a
   header, used only for files the City Power reader already claims under today's rules, so it
   cannot steal column-reader files.
3. Digest guard: the 137 non-City-Power files must stay byte-identical. Each changed City-Power
   file's new output is hand-reviewed against its PDF before its digest is re-pinned (the #229
   rule).

**Database, the correction path (none exists today):** `UNIQUE (licensee_id, financial_year)`
forbids a second 2026/27 row while the bad one exists. The trigger only allows published →
superseded, and only when another year publishes. So a published year **cannot be corrected**,
despite the schema header's "corrections are a new version through review". A migration would
replace the unique constraint with a partial unique index over `ingesting/in_review`, keeping
`tariff_year_one_published`. Publishing the corrected same-FY year then supersedes the bad one
through the existing branch, whose back-fill test uses a strict `>`. The loader also needs a
correction mode: `ingest-core.ts` today reports `skip_published` for a published existing year and
loads nothing. Optional `replaces_year_id` for audit.

**Re-ingest:** the 10 published years above get corrected drafts, are reviewed in
`/admin/tariffs` and published, which supersedes the bad rows. The in-review years are re-ingested
in place (in_review → ingesting is legal).

## 6. As built

- **Parser.** A wide-gap numbered section closes the open tariff, and a TOC line is never a header.
  Files this reader claims (decided on column 0 alone) are read with the label column up to indent 3.
  Any charge row it cannot attach hands the whole file to the column readers. The page-break rule (R2)
  was dropped: City Power "Business", Emfuleni "Miniflex" and Dikgatlong "Serviced Vacant Land" are
  real headers whose table starts on the next page.
- **Column reader.** A table with no name of its own is never named after a NERSA section title or a
  numbered paragraph (a sentence ends inside it). A section-word test was tried first and rejected:
  it dropped real tables named "Staff – Analysis and Key findings" (Hessequa) and "Three-Phase
  Analysis…" (Oudtshoorn). A wide-gap test was also rejected: "29.    Staff   –" is a real heading.
- **Digests.** 27 re-pinned (26 City-Power-reader files + Kgatelopele, whose opex table had been read
  as a R3.52 million service charge); 137 unchanged. Each change was reviewed against the text.
- **Known limitations kept** (in review, flagged by issues): sub-numbered tables ("2.1 / 2.2 / 2.3",
  Kokstad) still merge under the parent header; multi-line "Basic Charge (R/month)" rows are not read
  (Kouga); Modimolle and Greater Letaba now carry 1 tariff each, with the unread tables flagged for
  review, instead of one false tariff carrying everything.
- **Database (00232).** `replaces_year_id` + state `replaced`; one draft and one live row per
  (licensee, FY). Loader: `--correct-published`.
