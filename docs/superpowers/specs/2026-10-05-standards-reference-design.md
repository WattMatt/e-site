# Standards reference — design (E3, 2026-10-05)

**Goal.** Make the SANS reference library cited, edition-aware and browsable, and let the cable
calculator show where each derating factor comes from.

**Constraint that shaped everything.** This repository is public and the SANS PDFs are licensed.
No value read from a standard is committed: not in migrations, not in fixtures. Tests use
synthetic numbers, except the handful of cited factors pinned in `sans-lookup.cited.test.ts`.

## Model (migration 00225, extends `cable_schedule`)
- `ref_standards` — source documents: code, edition, year, title, status (current/superseded,
  with `superseded_by`), `in_library`. Seeded with metadata read from each document's cover.
- `sans_tables` + `standard_id`, `clause`, `provenance` (`transcribed` legacy / `extracted`),
  `verification` (the audit's verdict on a legacy table), `visibility_org_id`.
- `sans_rows` + `citation` `{clause, page_pdf, page_printed, spanned_columns?}`. The database
  refuses a row of an extracted table without one, and refuses removing it.
- Row security: extracted tables are readable only by active members of `visibility_org_id`
  (owner decision D2, default the WM org). Legacy tables stay readable by every signed-in user —
  every org's cable calculator reads them. Restrictive policies are SELECT-only.
- A superseded edition's tables stay loaded; the UI links them to the same clause in the current one.

## Pipeline (`scripts/standards/`, run by WM staff on a machine holding the library)
1. `extract.ts` — `pdftotext -layout`, then `packages/shared/src/standards`: reads the edition and
   year from the document, finds each table by heading, places numbers by the printed column-number
   row, and refuses unexpected/missing rows, stray numbers and blank required cells. Writes a dataset
   outside the repo (it refuses a path inside it).
2. `audit.ts` — compares every legacy cell that has a SANS counterpart (`LEGACY_CROSSCHECKS`) and
   writes the value-level report outside the repo (the vault).
3. `load.ts` — one transaction: loads the ranked tables (`LOADED_CLAUSES`) for every edition in the
   dataset, stamps each legacy table's verdict recomputed from live data, then reads back.

## Calculator
`lookupDeratingFactors` still returns the legacy factor — no number changes. Each axis now carries
`sources.<axis>.citation` when the SANS 2021 table (if the caller may read it) lands on the same row
with the same value; a differing SANS cell is flagged `sansDisagrees` and never applied. The cable
grid's rating tooltip prints the model's verdicts ("= SANS 10142-1:2021 Ed 3.1 Table 6.13, p.120").

## UI
`/standards` replaces `/cable-schedule/sans` (which redirects): search across standards, tables and
clauses; edition and status badges; per-row citations; verdicts; "used by" derived from the
calculator's own table codes; card view under 760 px.
