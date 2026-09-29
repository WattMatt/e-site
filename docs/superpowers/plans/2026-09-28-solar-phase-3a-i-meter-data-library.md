# Solar Phase 3a-i — Meter Data Library (parsers, normalisation, load model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure, fully tested TypeScript that turns any real meter export in the office corpus into clean interval channels with quality flags and a validation report, and turns those channels (or a tenant schedule) into an 8,760-hour site load series by basis S1/S2/S3/S4 with maximum demand.

**Architecture:** Two new modules in `@esite/shared`, both I/O-free and exposed through package subpaths so they never collide with the main barrel: `packages/shared/src/meter-data/` (format detection A/B/C/D/E/F/G/generic, fixed per-format unit tables, SAST timestamp handling, normalisation to `tsEnd` UTC, quality flags 0–7, artefact detection, identity/body hashes, register parsers, validation report) exported as `@esite/shared/meter-data`; and `packages/shared/src/services/solar/load/` (calendar and day types incl. SA public holidays, hourly aggregation, gap filling, reference-year alignment, site common window, archetypes seeded from GCR densities, synthesis, S1–S4, diversity, maximum demand) exported as `@esite/shared/solar-load`. Golden fixtures are truncated, anonymised copies of real files built by a committed script. Plan **3a-ii** (separate file) adds the migration, Storage bucket and the server import pipeline on the same branch.

**Tech Stack:** TypeScript (strict), Vitest, Web Crypto (`crypto.subtle`, available in Node ≥ 20 and browsers — no `node:crypto` in library code), `exceljs` (already a dependency of `@esite/shared`) for `.xlsx` sheets, Node ESM script for fixtures, pnpm/Turborepo.

**Specs:** `docs/solar/02-calculation-engine-spec.md` §1.2, §2; `docs/solar/01-functional-spec.md` §4.3–4.4 (data the UI needs — no UI here); `docs/solar/as-is/10-meter-csv-source.md` §1–6; decisions D-06, D-23 in `docs/solar/06-open-decisions.md`.

**Out of scope for 3a-i:** database, Storage, API routes (3a-ii); any UI (3b); tariff TOU windows (Phase 2 — max demand takes a predicate instead).

---

## Ground rules (read once)

- Repo root = the worktree created in Task 1. Every path below is relative to it.
- **No UI, no DB, no network in this plan.** Every function is pure; tests run offline.
- **The unit is never defaulted.** Recognised formats map columns through the fixed tables in Task 6; the generic path reports `unknown_unit` until the caller supplies a unit. Do not add a "fallback to kWh" anywhere — that is the WM bug that doubled 1,242 files.
- **Timestamps:** SAST is fixed UTC+2 with no DST. Never use `Date` local-time getters (`getHours`, `getDate`, `toISOString` for local dates) — always `Date.UTC` and `getUTC*` on an explicitly shifted value. WM's browser path put 00:00–01:59 into the previous day this way.
- **Missing is NULL, never 0.** An absent row, a blank cell and a PnP `Calc` value of exactly 0 are all `value: null, quality: 1`.
- Run the shared suite with `pnpm --filter @esite/shared test -- <pattern>` while iterating; all three suites + type-check at the end (Task 25).
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The canonical checkout (`/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite`) belongs to another session: never switch its branch; only `git -C … worktree add` from it.

## Findings from reading the real files that this plan builds in (spec corrections)

These were measured on the source files on 2026-09-28 while writing this plan. Each is a deliberate deviation from, or sharpening of, the spec; the owner should see them (they are repeated in the final report).

1. **Format A "descending" files are sorted as TEXT, not by time.** SITE YA `BULK METER` has 22,761 decreasing steps and 144 increasing ones: rows run `31/12/2024 … 01/12/2024, 31/10/2025 …` — descending by the `DD/MM/YYYY` string. as-is/10 §3 says "none interleaved"; that is wrong. The parser **always sorts by parsed timestamp** and reports `rowOrder: 'unordered'` for such files (a 14-day window inside one month reads `descending`).
2. **Within one format-A file, `Solar Total Power` is `p14` shifted one interval** (SITE FV `Solar`: `STP[t+30min] == p14[t]` on 723 of 734 non-zero steps in the fixture window, 19,018 of 19,312 over the whole file). So the time-label convention is per *channel* for named-power columns, not per format. The parser detects the lag, reports it (`lagged_channel`), and never picks the lagged copy as primary. **Open question for the owner:** is `Solar Total Power` interval-ending while `p14` is interval-beginning?
3. **Spike threshold uses P95, not P99.** In a 14-day window of SITE OX `TENANT-51` (hourly `a14`), 8 of 336 values (2.4 %) are ±59,000 register artefacts, so P99 *is* an artefact and "50 × P99" flags nothing. `50 × P95(|v|)` flags exactly the 8. The full-file behaviour is unchanged in spirit.
4. **Fixtures are the 14-day window only, not "+ first and last day".** Adding the first and last day of a 16-month file creates a 15-month artificial gap and turns every fixture into a `< 50 %` completeness error. Period metadata is recorded in `manifest.json` instead.
5. **`TENANT-51`'s artefacts are not "reset pairs" in the as-is sense** (a negative followed by normal readings): they alternate −58,796 / +58,999 / −59,232 … every 1–2 days. Both signs are flagged 4 (spike); negatives among them are counted as `resetPairs`.
6. **The E log's mall is its last `;` part**, not the third (`DB - 01A TENANT-95 ; Bravo Square ; MDB - 2 ; Bravo Square`). Site names are compared through `siteKey()` (upper-case, alphanumerics, trailing MALL/SQUARE/CENTRE/CENTER/PLAZA/SHOPPING dropped), which makes `Foxtrot` (town) equal `SITE RM`.
7. **Archetypes are stored as day-type profiles + monthly multipliers, not as a fixed 8,760 array.** A fixed 8,760 cannot respect a given reference year's weekdays and public holidays; the 8,760 is expanded per reference year (Task 20). 3a-ii's `solar.load_archetypes` stores the compact form (spec §3 said "shape 8760 float4").
8. **D-06 densities are GCR generator-sizing figures** (standard 0.03 kW/m² = 30 W/m², fast food / restaurant 45 W/m²). The engine uses them as the average over operating hours. As-is/10 §6.3 measured a median tenant at 15 W/m² over *all* hours; 30 W/m² over a ~50 % duty cycle is consistent, but **the owner should confirm** (D-06 says the owner reviews the table once).
9. `SITE PM` daily files: 43 of them carry the same line-1 serial `36291073` with identical values — the mis-filing affects daily files too.

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/package.json` | Add subpath exports `./meter-data`, `./solar-load` |
| `.gitattributes` | Keep fixture bytes exact (CRLF matters) |
| `scripts/solar/build-meter-fixtures.mjs` | Builds truncated, anonymised golden fixtures from the Dropbox corpus |
| `packages/shared/src/meter-data/__fixtures__/corpus/*.csv` + `manifest.json` | Generated fixtures (committed) |
| `packages/shared/src/meter-data/__fixtures__/register/*.csv` | Hand-anonymised consolidation summaries (committed, content in Task 2) |
| `packages/shared/src/meter-data/__fixtures__/load.ts` | Test helper: read a fixture as bytes |
| `packages/shared/src/meter-data/types.ts` | Shared types, quality codes, `isUsable`, `MeterParseError` |
| `packages/shared/src/meter-data/text.ts` | Byte decoding (UTF-8/BOM/latin1), line split, quote-aware row split |
| `packages/shared/src/meter-data/filename.ts` | `{SITE}, {SHOP_NO}, {LABEL}, {AREA}[ (n)]` grammar + audit names + serial hint |
| `packages/shared/src/meter-data/sniff.ts` | Format classification A/B/C/D/E/F/G/generic/empty |
| `packages/shared/src/meter-data/units.ts` | Fixed per-format column tables; unit → stored value |
| `packages/shared/src/meter-data/timestamps.ts` | SAST ↔ UTC, per-format label parsers, date-order detection, 24:00 |
| `packages/shared/src/meter-data/stats.ts` | Per-channel statistics |
| `packages/shared/src/meter-data/artefacts.ts` | Level shifts, spikes/reset pairs, negatives, scale correction, lag detection |
| `packages/shared/src/meter-data/series.ts` | Sort, dedupe, interval, grid with NULL gaps, status → quality, cumulative → deltas, energy → power |
| `packages/shared/src/meter-data/hash.ts` | sha256 (Web Crypto) and canonical body for the identity hash |
| `packages/shared/src/meter-data/register.ts` | Consolidation-summary (G) and downloader-log (E) registers, `siteKey` |
| `packages/shared/src/meter-data/report.ts` | Validation report shape and helpers |
| `packages/shared/src/meter-data/parse-meter-file.ts` | Orchestrator: bytes + filename → outcome |
| `packages/shared/src/meter-data/workbook.ts` | `.xlsx` sheet-by-sheet via exceljs, formula columns dropped + warned |
| `packages/shared/src/meter-data/index.ts` | Barrel for `@esite/shared/meter-data` |
| `packages/shared/src/services/solar/load/calendar.ts` | Local dates, day types, reference-year dates |
| `packages/shared/src/services/solar/load/hourly.ts` | Readings → daily 24-hour arrays, timelines |
| `packages/shared/src/services/solar/load/gap-fill.ts` | ≤ 2 h linear, ≤ 14 d day-type mean, longer untouched |
| `packages/shared/src/services/solar/load/align.ts` | Source window + reference-year alignment by month/day-type/nearest day |
| `packages/shared/src/services/solar/load/archetypes.ts` | 8 archetypes, expansion, GCR-seeded densities, category mapping |
| `packages/shared/src/services/solar/load/synthesis.ts` | Tenant synthesis (area × density × shape, BO date), shape from a short sample |
| `packages/shared/src/services/solar/load/common-window.ts` | S2 site common window |
| `packages/shared/src/services/solar/load/tenant-series.ts` | Meter → reference-year series, uncovered months filled by scaled synthesis |
| `packages/shared/src/services/solar/load/site-series.ts` | S1/S2/S3/S4 + monthly energy + bulk reconciliation |
| `packages/shared/src/services/solar/load/diversity.ts` | Design MD of synthesised tenants |
| `packages/shared/src/services/solar/load/max-demand.ts` | Monthly MD per format + from an hourly series |
| `packages/shared/src/services/solar/load/index.ts` | Barrel for `@esite/shared/solar-load` |

Tests sit beside each file as `*.test.ts`.

---

### Task 1: Worktree, branch and subpath exports

**Files:**
- Modify: `packages/shared/package.json`
- Modify/Create: `.gitattributes`

- [ ] **Step 1: Create the worktree from the Phase 1A branch**

```bash
git -C "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite" fetch origin feat/solar-phase-1a
git -C "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite" worktree add -b feat/solar-phase-3a \
  ~/.config/superpowers/worktrees/esite/solar-phase-3a origin/feat/solar-phase-1a
cd ~/.config/superpowers/worktrees/esite/solar-phase-3a
pnpm install --frozen-lockfile
```
Expected: `Preparing worktree (new branch 'feat/solar-phase-3a')`, install completes.

- [ ] **Step 2: Baseline the shared suite**

Run: `pnpm --filter @esite/shared test`
Expected: PASS (record the test count; it must not drop later).

- [ ] **Step 3: Add the two subpath exports**

In `packages/shared/package.json`, replace the `"exports"` object with:

```json
  "exports": {
    ".": "./src/index.ts",
    "./placeholder-fill": "./src/lib/jbcc/placeholder-fill.ts",
    "./docx-letterhead": "./src/lib/jbcc/docx-letterhead.ts",
    "./docx-preview": "./src/lib/jbcc/docx-html.ts",
    "./meter-data": "./src/meter-data/index.ts",
    "./solar-load": "./src/services/solar/load/index.ts"
  },
```

Why subpaths: the modules export many short names (`parseMeterFilename`, `fillGaps`, `QUALITY`) that would collide in the main barrel, and the server route is the only consumer.

- [ ] **Step 4: Keep fixture bytes exact**

Append to `.gitattributes` (create it if absent):

```
# Solar meter fixtures: CRLF vs LF and exact bytes are under test (sha256, line-ending detection).
packages/shared/src/meter-data/__fixtures__/** -text
```

Run: `git check-attr text -- "packages/shared/src/meter-data/__fixtures__/corpus/x.csv"`
Expected: `...: text: unset`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json .gitattributes
git commit -m "$(cat <<'EOF'
chore(solar): meter-data and solar-load subpath exports; exact fixture bytes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Golden fixtures (builder script + register files)

**Files:**
- Create: `scripts/solar/build-meter-fixtures.mjs`
- Create (generated): `packages/shared/src/meter-data/__fixtures__/corpus/*.csv`, `manifest.json`
- Create: `packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.9col.csv`
- Create: `packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.csv`
- Create: `packages/shared/src/meter-data/__fixtures__/load.ts`

The source folder is `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV/`. It is read-only: the script never writes there.

**Transformation (identical for every fixture unless the table says otherwise):**
- Keep the preamble lines exactly (A: `sep=,`, blank, header; B/C: line-1 preamble + header), except serials in a PnP preamble are replaced by a pseudonym.
- Keep only data rows whose **reading day** falls in the window (inclusive). Reading day = the label's date for A (interval-beginning); the date of `label − 1 s` for B/C (interval-ending, so `00:00` belongs to the previous day).
- Keep rows **in their original file order** (row order is under test) and every value unchanged.
- Preserve the source line ending (CRLF for A/B, LF for C/D/E/F) and whether the file ended with one.
- Output file names follow the filename grammar with sites as `SITE xx`, tenants as `TENANT-nn`, serials as pseudonyms.
- Serial pseudonym = `'3' + (first 12 hex of sha256("esite-meter-fixture:" + digits) as integer mod 10^7, zero-padded to 7)` + any letter suffix. Deterministic, preserves equality, and never contains the real serial.

| id | Source (pseudonymous reference; resolved by the builder) | Output file | Fmt | Window |
|---|---|---|---|---|
| a-bulk | `site-5f847ce9b8e6/370de3d9ba4bcb67.A` | `SITE YA, , BULK METER, .csv` | A | 2025-03-10…03-23 |
| a-tenant | `site-5f847ce9b8e6/65967c2cc259b7c1.A` | `SITE YA, SHOP 050, TENANT-23, 3000.csv` | A | same |
| a-check | `site-5f847ce9b8e6/4b2d8e46d34aa99d.A` | `SITE YA, , CHECK 1, .csv` | A | same |
| a-generator | `site-5f847ce9b8e6/61180ef155591c2d.A` | `SITE YA, , GENERATOR METER, .csv` | A | 2025-06-02…06-15 |
| a-pv-240 | `site-6ecd81568957/f967b4c912e833dc.A` | `SITE WR, , SOLAR PLANT 240, .csv` | A | 2025-03-10…03-23 |
| a-pv-360 | `site-6ecd81568957/31c0a2ae1cc1dd25.A` | `SITE WR, , SOLAR PLANT 360, .csv` | A | same |
| a-pv-multi | `site-02159ab53247/c98ab052191ec032.A` | `SITE FV, , Solar, .csv` | A | same |
| a-reactive | `site-4212b625d081/da2426d13ebd2e58.A` | `SITE EV, 220, TENANT-31, 2067.csv` | A | same |
| a-volts-amps | `site-029eef041a13/34d2e548637b1519.A` | `SITE CY, 13, TENANT-41, 45.csv` | A | same |
| a-energy-resets | `site-1c4f602e91f4/66c44632fbbc713f.A` | `SITE OX, , TENANT-51, .csv` | A | 2024-10-10…10-23 |
| a-level-shift | `site-2b76e0d1cb45/3dd06bb7d4c5f7d1.A` | `SITE FW, 89, TENANT-61, 3127.csv` | A | 2024-10-06…10-19 |
| a-hourly-negative | `site-856f019d84f6/e0e3fe5a81786d35.A` | `SITE VW, 12, TENANT-71, 4821.csv` | A | 2024-12-27…2025-01-09 |
| a-tiny-negative | `site-131e7f7776ca/f704b904e728b979.A` | `SITE TH, 3, TENANT-81, 1995.csv` | A | 2024-06-03…06-16 |
| a-empty | `site-24560dfb48f1/cd0d4c77feaf0e3b.A` | `SITE EQ, , DB 37, .csv` | A | whole file |
| a-short | `site-d494cbac42f6/54f4fb363b436e90.A` | `SITE MO, , TENANT-91, .csv` | A | whole file (7 days) |
| a-water | `site-e3cdcac6991e/83ffb159b5600ae6.A` | `SITE BC, , BC1 - TENANT-92, .csv` | A | whole file |
| a-vacant-1 | `site-7287c42af185/5352acbd3ac56a94.A` | `SITE FL, SHOP 06, Vacant, 450 (2).csv` | A | 2025-03-10…03-23 |
| a-vacant-2 | `site-02159ab53247/caf6617114e62f70.A` | `SITE FV, , SHOP 107 VACANT, .csv` | A | same |
| a-twin-of-d | `site-ce0f452ad0cb/de89b6022ed5ef4a.A` | `SITE RP, 27, TENANT-06, 525.csv` | A | same |
| d-escaped | `site-ce0f452ad0cb/56d9620a95fbb6d1.D` | `RP - TENANT-06 525.csv` | D | same (records split on the literal `\n`) |
| b-virtual-calc | `site-8029679f4046/961ac7e81b1febae.B` | `SITE SG, , {30182503}_LOCAL MAIN, .csv` | B | 2025-10-01…10-14 |
| b-misfiled | `site-8029679f4046/d1d8f1a4c7d8ae04.B` | `SITE SG, , {32700578}_DB-26, .csv` | B | same |
| b-shared-body-1 | `site-d830013fc427/fbaeb142f41c3ecc.B` | `SITE MR, , Local Main, .csv` | B | 2025-03-10…03-23 |
| b-shared-body-2 | `site-2d26c699e0b1/1de0cf1b6460a260.B` | `SITE TS, 09, DB 09, .csv` | B | same |
| b-halfhourly | `site-e9cf6a49caa9/1b3f94512446cd32.B` | `SITE PM, , Meter {31599070}, .csv` | B | same |
| b-daily | `site-e9cf6a49caa9/6be7a716a603573a.B` | `SITE PM, , Meter {39631688}, .csv` | B | same (14 daily rows) |
| b-seven-serials | `site-d6ffa4c80435/a0e443d32bf1d122.B` | `SITE RM, , E9001, .csv` | B | same |
| c-energy | `site-0465266003ff/428f3d42a50f69c6.C` | `SITE TZ, , 01A TENANT-95, .csv` | C | same |
| c-energy-2 | `site-d830013fc427/f2b71faf2094de76.C` | `SITE MR, , TENANT-96, .csv` | C | same |
| e-log | `site-3d3bb3d89d06/8290db891735a460.E` | `SITE KM, , E9002, .csv` | E | first 30 rows + rows for serials 33103528, 38813110, 31599070, 39614362, 34606877; tenant part → `TENANT-Ennn`, mall parts → site pseudonyms, `DB…` parts kept |
| f-derived | `site-b535c62513b1/5460394984734387.F` | `SITE PD, , PDB_{31815534}_TENANT-97_22m2V, .csv` | F | first 25 lines |

`{digits}` in an output name = that serial's pseudonym. Not built as fixtures, deliberately: the 6.9 MB `PDB_…_22m2V.xlsx` (the formula-column case is built synthetically in Task 14) and the four filename-grammar edge cases (they are strings in Task 4's tests).

- [ ] **Step 1: Write the builder**

Create `scripts/solar/build-meter-fixtures.mjs`:

```js
#!/usr/bin/env node
// Builds truncated, anonymised golden fixtures for packages/shared/src/meter-data
// from the office meter corpus (read-only). Plan: docs/superpowers/plans/2026-09-28-solar-phase-3a-i-meter-data-library.md Task 2.
//   node scripts/solar/build-meter-fixtures.mjs "/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV"
// Source names below already appear in docs/solar/as-is/10-meter-csv-source.md; the OUTPUT files carry none of them.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.argv[2]
if (!ROOT) {
  console.error('usage: node scripts/solar/build-meter-fixtures.mjs "<006. METER CSV folder>"')
  process.exit(2)
}
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../../packages/shared/src/meter-data/__fixtures__/corpus')

const W = ['2025-03-10', '2025-03-23']
// Each source is named ONLY by its pseudonymous reference (the manifest `source` form):
//   ref = "site-<12 hex sha256(site folder)>/<16 hex sha256(relative path)>.<format>"
// The builder walks the corpus, hashes every relative path and matches. `out` is the final
// (already pseudonymised) fixture name. No real site, tenant or serial is written here.
const FIXTURES = [
  { id: 'a-bulk', ref: 'site-5f847ce9b8e6/370de3d9ba4bcb67.A', out: 'SITE YA, , BULK METER, .csv', fmt: 'A', window: W },
  { id: 'a-tenant', ref: 'site-5f847ce9b8e6/65967c2cc259b7c1.A', out: 'SITE YA, SHOP 050, TENANT-23, 3000.csv', fmt: 'A', window: W },
  { id: 'a-check', ref: 'site-5f847ce9b8e6/4b2d8e46d34aa99d.A', out: 'SITE YA, , CHECK 1, .csv', fmt: 'A', window: W },
  { id: 'a-generator', ref: 'site-5f847ce9b8e6/61180ef155591c2d.A', out: 'SITE YA, , GENERATOR METER, .csv', fmt: 'A', window: ['2025-06-02', '2025-06-15'] },
  { id: 'a-pv-240', ref: 'site-6ecd81568957/f967b4c912e833dc.A', out: 'SITE WR, , SOLAR PLANT 240, .csv', fmt: 'A', window: W },
  { id: 'a-pv-360', ref: 'site-6ecd81568957/31c0a2ae1cc1dd25.A', out: 'SITE WR, , SOLAR PLANT 360, .csv', fmt: 'A', window: W },
  { id: 'a-pv-multi', ref: 'site-02159ab53247/c98ab052191ec032.A', out: 'SITE FV, , Solar, .csv', fmt: 'A', window: W },
  { id: 'a-reactive', ref: 'site-4212b625d081/da2426d13ebd2e58.A', out: 'SITE EV, 220, TENANT-31, 2067.csv', fmt: 'A', window: W },
  { id: 'a-volts-amps', ref: 'site-029eef041a13/34d2e548637b1519.A', out: 'SITE CY, 13, TENANT-41, 45.csv', fmt: 'A', window: W },
  { id: 'a-energy-resets', ref: 'site-1c4f602e91f4/66c44632fbbc713f.A', out: 'SITE OX, , TENANT-51, .csv', fmt: 'A', window: ['2024-10-10', '2024-10-23'] },
  { id: 'a-level-shift', ref: 'site-2b76e0d1cb45/3dd06bb7d4c5f7d1.A', out: 'SITE FW, 89, TENANT-61, 3127.csv', fmt: 'A', window: ['2024-10-06', '2024-10-19'] },
  { id: 'a-hourly-negative', ref: 'site-856f019d84f6/e0e3fe5a81786d35.A', out: 'SITE VW, 12, TENANT-71, 4821.csv', fmt: 'A', window: ['2024-12-27', '2025-01-09'] },
  { id: 'a-tiny-negative', ref: 'site-131e7f7776ca/f704b904e728b979.A', out: 'SITE TH, 3, TENANT-81, 1995.csv', fmt: 'A', window: ['2024-06-03', '2024-06-16'] },
  { id: 'a-empty', ref: 'site-24560dfb48f1/cd0d4c77feaf0e3b.A', out: 'SITE EQ, , DB 37, .csv', fmt: 'A', window: null },
  { id: 'a-short', ref: 'site-d494cbac42f6/54f4fb363b436e90.A', out: 'SITE MO, , TENANT-91, .csv', fmt: 'A', window: null },
  { id: 'a-water', ref: 'site-e3cdcac6991e/83ffb159b5600ae6.A', out: 'SITE BC, , BC1 - TENANT-92, .csv', fmt: 'A', window: null },
  { id: 'a-vacant-1', ref: 'site-7287c42af185/5352acbd3ac56a94.A', out: 'SITE FL, SHOP 06, Vacant, 450 (2).csv', fmt: 'A', window: W },
  { id: 'a-vacant-2', ref: 'site-02159ab53247/caf6617114e62f70.A', out: 'SITE FV, , SHOP 107 VACANT, .csv', fmt: 'A', window: W },
  { id: 'a-twin-of-d', ref: 'site-ce0f452ad0cb/de89b6022ed5ef4a.A', out: 'SITE RP, 27, TENANT-06, 525.csv', fmt: 'A', window: W },
  { id: 'd-escaped', ref: 'site-ce0f452ad0cb/56d9620a95fbb6d1.D', out: 'RP - TENANT-06 525.csv', fmt: 'D', window: W },
  { id: 'b-virtual-calc', ref: 'site-8029679f4046/961ac7e81b1febae.B', out: 'SITE SG, , 30182503_LOCAL MAIN, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-misfiled', ref: 'site-8029679f4046/d1d8f1a4c7d8ae04.B', out: 'SITE SG, , 32700578_DB-26, .csv', fmt: 'B', window: ['2025-10-01', '2025-10-14'] },
  { id: 'b-shared-body-1', ref: 'site-d830013fc427/fbaeb142f41c3ecc.B', out: 'SITE MR, , Local Main, .csv', fmt: 'B', window: W },
  { id: 'b-shared-body-2', ref: 'site-2d26c699e0b1/1de0cf1b6460a260.B', out: 'SITE TS, 09, DB 09, .csv', fmt: 'B', window: W },
  { id: 'b-halfhourly', ref: 'site-e9cf6a49caa9/1b3f94512446cd32.B', out: 'SITE PM, , Meter 31599070, .csv', fmt: 'B', window: W },
  { id: 'b-daily', ref: 'site-e9cf6a49caa9/6be7a716a603573a.B', out: 'SITE PM, , Meter 39631688, .csv', fmt: 'B', window: W },
  { id: 'b-seven-serials', ref: 'site-d6ffa4c80435/a0e443d32bf1d122.B', out: 'SITE RM, , E9001, .csv', fmt: 'B', window: W },
  { id: 'c-energy', ref: 'site-0465266003ff/428f3d42a50f69c6.C', out: 'SITE TZ, , 01A TENANT-95, .csv', fmt: 'C', window: W },
  { id: 'c-energy-2', ref: 'site-d830013fc427/f2b71faf2094de76.C', out: 'SITE MR, , TENANT-96, .csv', fmt: 'C', window: W },
  { id: 'e-log', ref: 'site-3d3bb3d89d06/8290db891735a460.E', out: 'SITE KM, , E9002, .csv', fmt: 'E', window: null },
  { id: 'f-derived', ref: 'site-b535c62513b1/5460394984734387.F', out: 'SITE PD, , PDB_31815534_TENANT-97_22m2V, .csv', fmt: 'F', window: null },
]
// E-log rows kept beyond the first E_FIRST_ROWS, named by their serial PSEUDONYM (pseudoSerial),
// never by the real serial. The pseudonyms are the ones that appear in the committed fixture.
const E_KEEP_PSEUDO = new Set(['33103528', '38813110', '31599070', '39614362', '34606877'])
const E_FIRST_ROWS = 30
// Site pseudonyms for E-log mall parts, keyed by sha256("esite-site:" + siteKey(name)) (16 hex).
// siteKey() must match packages/shared/src/meter-data/register.ts.
const SITE_BY_KEY_HASH = {
  c6edb4fb87acb4f6: 'SITE PD', d182ab21d8b3203d: 'SITE PM', '13e45e03cbfd8533': 'SITE MR', '94779987cd18e987': 'SITE TZ',
  '3a043102e8313a38': 'SITE TS', e9f508348b46e046: 'SITE RM', '79a8645af3ce2a7c': 'SITE KM', c0bbe82ac3073156: 'SITE SG',
}
const siteByName = (name) => SITE_BY_KEY_HASH[sha256('esite-site:' + siteKey(name)).slice(0, 16)]

function siteKey(s) {
  const words = String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && ['MALL', 'SQUARE', 'CENTRE', 'CENTER', 'PLAZA', 'SHOPPING'].includes(words[words.length - 1])) words.pop()
  return words.join('')
}
function pseudoSerial(real) {
  const m = /^(\d+)([A-Z]?)$/.exec(real.trim())
  if (!m) return real
  const h = createHash('sha256').update('esite-meter-fixture:' + m[1]).digest('hex').slice(0, 12)
  return '3' + (BigInt('0x' + h) % 10000000n).toString().padStart(7, '0') + m[2]
}
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}
function splitKeepingEol(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const endsWithEol = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (endsWithEol) lines.pop()
  return { lines, eol, endsWithEol }
}
function joinLines(lines, eol, endsWithEol) {
  return lines.join(eol) + (endsWithEol ? eol : '')
}
// Reading day: A = label date (interval-beginning); B/C = date of (label - 1 s).
function dayOfA(line) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) /.exec(line)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
function dayOfEnding(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeStr.trim())
  if (!d || !t) return null
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) - 1000
  return new Date(ms).toISOString().slice(0, 10)
}
function dayOfB(line) {
  const cells = line.split(',').map((c) => c.trim())
  return dayOfEnding(cells[cells.length - 3] ?? '', cells[cells.length - 2] ?? '')
}
function dayOfC(line) {
  const [dt] = line.split(',')
  const [date, time] = (dt ?? '').trim().split(' ')
  return dayOfEnding(date ?? '', time ?? '')
}
const inWindow = (day, w) => day !== null && day >= w[0] && day <= w[1]

function anonymisePreamble(line) {
  // "pnpscada.com", "3xxxxxxx", ... (B)  or  pnpscada.com,3xxxxxxx (C)
  return line.replace(/(\d{7,8}[A-Z]?)/g, (s) => pseudoSerial(s))
}

function buildSeries(f, text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  if (!f.window) return { text, dataRows: Math.max(0, lines.filter((l) => l.trim() !== '').length - (f.fmt === 'A' ? 2 : 2)) }
  const pre = f.fmt === 'A' ? lines.slice(0, 3) : [anonymisePreamble(lines[0]), lines[1]]
  const body = lines.slice(pre.length).filter((l) => l.trim() !== '')
  const dayOf = f.fmt === 'A' ? dayOfA : f.fmt === 'B' ? dayOfB : dayOfC
  const kept = body.filter((l) => inWindow(dayOf(l), f.window))
  return { text: joinLines([...pre, ...kept], eol, endsWithEol), dataRows: kept.length }
}
function buildEscaped(f, text) {
  const trailing = text.endsWith('\n') ? '\n' : ''
  const recs = text.replace(/\n$/, '').split('\\n')
  const kept = recs.slice(2).filter((r) => r.trim() !== '' && inWindow(dayOfA(r), f.window))
  return { text: [recs[0], recs[1], ...kept].join('\\n') + trailing, dataRows: kept.length }
}
function buildLog(text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  const out = [lines[0]]
  let n = 0
  lines.slice(1).forEach((l, i) => {
    const [serial, name, downloaded, ts] = l.split(',')
    if (!(i < E_FIRST_ROWS || E_KEEP_SERIALS.has(serial))) return
    n++
    const parts = (name ?? '').split(/\s*;\s*/)
    const anon = parts.map((p, k) => {
      if (k === 0) return `TENANT-E${String(i + 1).padStart(3, '0')}`
      if (/^M?DB\b|^DB\s*-?\d/i.test(p)) return p
      return SITE_BY_KEY[siteKey(p)] ?? 'SITE X'
    })
    out.push([pseudoSerial(serial), anon.join(' ; '), downloaded ?? '', ts ?? ''].join(','))
  })
  return { text: joinLines(out, eol, endsWithEol), dataRows: n }
}
function buildDerived(text) {
  const { lines, eol, endsWithEol } = splitKeepingEol(text)
  const kept = lines.slice(0, 25)
  return { text: joinLines(kept, eol, endsWithEol && kept.length === lines.length), dataRows: kept.length - 1 }
}

mkdirSync(OUT, { recursive: true })
const manifest = []
for (const f of FIXTURES) {
  const raw = readFileSync(join(ROOT, f.src))
  const text = raw.toString('utf8')
  const built =
    f.fmt === 'D' ? buildEscaped(f, text)
    : f.fmt === 'E' ? buildLog(text)
    : f.fmt === 'F' ? buildDerived(text)
    : buildSeries(f, text)
  const file = outName(f.out)
  writeFileSync(join(OUT, file), built.text)
  manifest.push({
    id: f.id, file, format: f.fmt, source: f.src, sourceSha256: sha256(raw),
    window: f.window, dataRows: built.dataRows,
    transformation: f.window ? 'rows whose reading day is inside the window, original order, values unchanged; names and serials pseudonymised' : 'whole file or head as listed; names and serials pseudonymised',
  })
  console.log(`${f.id.padEnd(20)} ${String(built.dataRows).padStart(5)}  ${file}`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
```

Note on the whole-file case: for `a-empty` (`sep=,` + blank, 8 bytes), `a-short` and `a-water`, the printed `dataRows` is the non-blank line count minus the two non-data non-blank lines (`sep=,` and the header); `a-empty` prints 0 because it has only one non-blank line (`Math.max(0, …)`).

- [ ] **Step 2: Run it**

```bash
node scripts/solar/build-meter-fixtures.mjs "/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV"
```

Expected data-row counts (measured on the source on 2026-09-28; every later test depends on them):

| id | rows | id | rows | id | rows |
|---|---|---|---|---|---|
| a-bulk | 672 | a-energy-resets | 336 | b-virtual-calc | 672 |
| a-tenant | 672 | a-level-shift | 672 | b-misfiled | 672 |
| a-check | 672 | a-hourly-negative | 218 | b-shared-body-1 | 672 |
| a-generator | 663 | a-tiny-negative | 672 | b-shared-body-2 | 672 |
| a-pv-240 | 672 | a-empty | 0 | b-halfhourly | 672 |
| a-pv-360 | 672 | a-short | 335 | b-daily | 14 |
| a-pv-multi | 672 | a-water | 166 | b-seven-serials | 672 |
| a-reactive | 672 | a-vacant-1 / -2 | 672 / 672 | c-energy | 672 |
| a-volts-amps | 398 | a-twin-of-d / d-escaped | 672 / 672 | c-energy-2 | 671 |

`e-log` prints 30 + however many of the five kept serials sit beyond row 30 (32–35); `f-derived` prints 24.

If any count differs, stop: the corpus changed or the script is wrong — do not "fix" the expected numbers in later tests.

- [ ] **Step 3: Check the anonymisation**

```bash
cd packages/shared/src/meter-data/__fixtures__/corpus
grep -l -i -E "$REAL_NAMES_AND_SERIALS" -- *.csv || echo "clean"
cd -
```
Expected: `clean`. (`manifest.json` is excluded deliberately: it records the source path for reproducibility, and those names are already in `docs/solar/as-is/10-meter-csv-source.md`.)

- [ ] **Step 4: Write the two register fixtures**

`packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.9col.csv` — the SITE YA `.xls` summary saved as CSV, with tenants replaced by `TENANT-nn` in workbook row order and file names by `SA - TENANT-nn.csv` (shop numbers, areas, status and QA values are the real ones). LF line endings:

```
Meter Filename,Matched Layout Name,Shop Number,Area (sqm),Status,DUBBEL,CORRECT,ADDED,NOT ON DRAWINGS 
SA - TENANT-01.csv,TENANT-01,ATM 001,11,UNMAPPED,,,,
SA - TENANT-02.csv,TENANT-02,ATM 002,12,Direct/Substring,ON DRAWING,NO CSV,,
SA - TENANT-03.csv,TENANT-03,ATM 003,13,UNMAPPED,,,,
SA - TENANT-04.csv,TENANT-04,CAR PARK,14,Gemini LLM,,,,
SA - TENANT-05.csv,TENANT-05,KIOSK 5,42,Gemini LLM,,,,
SA - TENANT-06.csv,TENANT-06,KIOSK 6,31,UNMAPPED,,,,
SA - TENANT-07.csv,TENANT-07,KIOSK3,42,UNMAPPED,,,,
SA - TENANT-08.csv,TENANT-08,KIOSK4,21,UNMAPPED,,,,
SA - TENANT-09.csv,TENANT-09,SHOP 001,140,Direct/Substring,,,,
SA - TENANT-10.csv,TENANT-10,SHOP 002,377,Direct/Substring,,,,
SA - TENANT-11.csv,TENANT-11,SHOP 003A,118,Gemini LLM,,,,
SA - TENANT-12.csv,TENANT-12,SHOP 005 ,110,UNMAPPED,,,,
SA - TENANT-13.csv,TENANT-13,SHOP 005A,43,Gemini LLM,,,,
SA - TENANT-14.csv,TENANT-14,SHOP 008,154,Direct/Substring,,,,
,TENANT-15,SHOP 009,82,,ON DRAWING,NO CSV,,
SA - TENANT-16.csv,TENANT-16,SHOP 010,287,Direct/Substring,,,,
SA - TENANT-17.csv,TENANT-17,SHOP 011,385,Direct/Substring,,,,
SA - TENANT-18.csv,TENANT-18,SHOP 013A,56,UNMAPPED,,,,
,TENANT-19,SHOP 013B,202,,ON DRAWING,NO CSV,,
SA - TENANT-20.csv,TENANT-20,SHOP 013C,311,Direct/Substring,,,,
,TENANT-21,SHOP 013D,55,,ON DRAWING,NO CSV,,
SA - TENANT-22.csv,TENANT-22,"SHOP 040,04B,L4,L007B",440,Direct/Substring,,,,
SA - TENANT-23.csv,TENANT-23,SHOP 050,3000,Direct/Substring,,,,
SA - TENANT-24.csv,TENANT-24,,21,UNMAPPED,,,,
,,,,,,,,
SA - TENANT-26.csv,TENANT-26,,,UNMAPPED,NOT ON DRAWING,CSV ON SITE ,,
SA - TENANT-27.csv,TENANT-27,,,UNMAPPED,NOT ON DRAWING,CSV ON SITE ,,
```

`packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.csv` — the tool's own 3-column CSV, same tenant numbering, LF:

```
Shop Name,Shop Number,Area (sqm)
TENANT-01,ATM 001,11
TENANT-03,ATM 003,13
TENANT-04,CAR PARK,14
TENANT-05,KIOSK 5,42
TENANT-06,KIOSK 6,31
TENANT-07,KIOSK3,42
TENANT-08,KIOSK4,21
TENANT-09,SHOP 001,140
TENANT-10,SHOP 002,377
TENANT-11,SHOP 003A,118
TENANT-12,SHOP 005 ,110
TENANT-13,SHOP 005A,43
TENANT-14,SHOP 008,154
TENANT-16,SHOP 010,287
TENANT-17,SHOP 011,385
TENANT-18,SHOP 013A,56
TENANT-20,SHOP 013C,311
TENANT-22,"SHOP 040,04B,L4,L007B",440
TENANT-23,SHOP 050,3000
TENANT-24,,21
,,
```

- [ ] **Step 5: Fixture loader for tests**

Create `packages/shared/src/meter-data/__fixtures__/load.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FixtureManifestEntry {
  id: string
  file: string
  format: string
  source: string
  sourceSha256: string
  window: [string, string] | null
  dataRows: number
}

const DIR = join(__dirname, 'corpus')

export function manifest(): FixtureManifestEntry[] {
  return JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as FixtureManifestEntry[]
}

/** Returns the fixture bytes and its (anonymised) file name. Test-only: uses node:fs. */
export function fixture(id: string): { bytes: Uint8Array; fileName: string } {
  const entry = manifest().find((m) => m.id === id)
  if (!entry) throw new Error(`no fixture ${id}`)
  return { bytes: new Uint8Array(readFileSync(join(DIR, entry.file))), fileName: entry.file }
}

export function registerFixture(name: string): { bytes: Uint8Array; fileName: string } {
  return { bytes: new Uint8Array(readFileSync(join(__dirname, 'register', name))), fileName: name }
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/solar/build-meter-fixtures.mjs packages/shared/src/meter-data/__fixtures__
git commit -m "$(cat <<'EOF'
test(solar): anonymised 14-day golden meter fixtures from the office corpus

Built by scripts/solar/build-meter-fixtures.mjs (read-only on the source).
31 files covering formats A/B/C/D/E/F, two register summaries.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Types and text utilities

**Files:**
- Create: `packages/shared/src/meter-data/types.ts`
- Create: `packages/shared/src/meter-data/text.ts`
- Test: `packages/shared/src/meter-data/text.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/meter-data/text.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decodeMeterText, splitLines, splitRow } from './text'
import { isUsable, QUALITY } from './types'

describe('decodeMeterText', () => {
  it('reads UTF-8 and reports CRLF', () => {
    const d = decodeMeterText(new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n'))
    expect(d).toEqual({ text: 'sep=,\r\n\r\ndate,p14\r\n', encoding: 'utf-8', lineEnding: 'crlf' })
  })
  it('strips a BOM', () => {
    const d = decodeMeterText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a]))
    expect(d.text).toBe('a\n')
    expect(d.encoding).toBe('utf-8-bom')
    expect(d.lineEnding).toBe('lf')
  })
  it('falls back to Windows-1252 for invalid UTF-8', () => {
    const d = decodeMeterText(new Uint8Array([0x43, 0x41, 0x46, 0xc9]))  // "CAFÉ" in latin1
    expect(d.encoding).toBe('latin1')
    expect(d.text).toBe('CAFÉ')
  })
})

describe('splitLines', () => {
  it('splits CRLF and LF and drops one trailing empty line', () => {
    expect(splitLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\r\n\r\nb')).toEqual(['a', '', 'b'])
  })
})

describe('splitRow', () => {
  it('handles PnP "comma plus space" with quoted headers', () => {
    expect(splitRow('"P (per kW)", "Q (per kvar)", "DATE"', ',')).toEqual(['P (per kW)', 'Q (per kvar)', 'DATE'])
    expect(splitRow('332.26, 126.94, 2025-10-01, 00:30:00, Ok', ',')).toEqual(['332.26', '126.94', '2025-10-01', '00:30:00', 'Ok'])
  })
  it('keeps a quoted delimiter and unescapes doubled quotes', () => {
    expect(splitRow('TENANT-22,"SHOP 040,04B,L4,L007B",440', ',')).toEqual(['TENANT-22', 'SHOP 040,04B,L4,L007B', '440'])
    expect(splitRow('"a ""b""",c', ',')).toEqual(['a "b"', 'c'])
  })
  it('keeps empty cells', () => {
    expect(splitRow(',,', ',')).toEqual(['', '', ''])
  })
})

describe('isUsable', () => {
  it('encodes the usability rule', () => {
    expect(isUsable({ value: 1, quality: QUALITY.OK })).toBe(true)
    expect(isUsable({ value: 1, quality: QUALITY.ESTIMATED })).toBe(true)
    expect(isUsable({ value: 0.001, quality: QUALITY.SCALE_CORRECTED })).toBe(true)
    expect(isUsable({ value: 0, quality: QUALITY.NEGATIVE })).toBe(true)        // clamped tiny negative
    expect(isUsable({ value: -1710.82, quality: QUALITY.NEGATIVE })).toBe(false) // large negative: shown, excluded
    expect(isUsable({ value: null, quality: QUALITY.MISSING })).toBe(false)
    expect(isUsable({ value: 59000, quality: QUALITY.SPIKE })).toBe(false)
    expect(isUsable({ value: 5, quality: QUALITY.DUPLICATE })).toBe(false)
    expect(isUsable({ value: 5, quality: QUALITY.STATUS })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/text`
Expected: FAIL — `Failed to resolve import "./text"`.

- [ ] **Step 3: Implement `types.ts`**

```ts
/**
 * Meter data — shared types (Solar Phase 3a).
 * Spec: docs/solar/02-calculation-engine-spec.md §1.2, §2.1; docs/solar/as-is/10-meter-csv-source.md §2, §6.
 * A reading is stored at its interval END (tsEnd, epoch ms UTC). Power-like quantities are stored in
 * kW / kvar / kVA; energy per interval is converted with kW = kWh × 60 / interval_min.
 */
export type MeterFormatId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'generic' | 'empty'

export const FORMAT_LABELS: Record<MeterFormatId, string> = {
  A: 'A: sep= power export (average kW, interval-beginning labels)',
  B: 'B: PnP SCADA power export (average kW, interval-ending labels)',
  C: 'C: PnP SCADA energy export (kWh per interval, interval-ending labels)',
  D: 'D: escaped single-line copy of another export (not data)',
  E: 'E: batch-downloader log (serial register, not data)',
  F: 'F: derived working column (not data)',
  G: 'G: consolidation summary (meter register, not data)',
  generic: 'Generic delimited file (every choice confirmed by the user)',
  empty: 'Empty or header-only file',
}

export type Quantity =
  | 'active_power' | 'reactive_power' | 'apparent_power'
  | 'active_energy' | 'reactive_energy' | 'apparent_energy'
  | 'voltage' | 'current' | 'power_factor' | 'volume' | 'unknown'
export type Direction = 'import' | 'export' | 'none'
export type Phase = 'l1' | 'l2' | 'l3' | null

export const SOURCE_UNITS = ['kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'm3', 'PF', 'unknown'] as const
export type SourceUnit = (typeof SOURCE_UNITS)[number]
export type StoredUnit = 'kW' | 'kvar' | 'kVA' | 'V' | 'A' | 'PF' | 'm3' | 'unknown'
export type TsConvention = 'begin' | 'end'
export type RowOrder = 'ascending' | 'descending' | 'unordered'
export type DateOrder = 'DMY' | 'MDY' | 'YMD'

/** Engine spec §2.1 step 5. */
export const QUALITY = {
  OK: 0, MISSING: 1, ESTIMATED: 2, NEGATIVE: 3, SPIKE: 4, DUPLICATE: 5, STATUS: 6, SCALE_CORRECTED: 7,
} as const
export type QualityCode = (typeof QUALITY)[keyof typeof QUALITY]

export interface ChannelSpec {
  sourceColumn: string
  /** Index of the column in the file's header row. */
  columnIndex: number
  quantity: Quantity
  direction: Direction
  phase: Phase
  sourceUnit: SourceUnit
  /** true when the unit came from the format's fixed table; false when user-chosen or unknown. */
  unitFromTable: boolean
  /** PnP "scalar sum S": the sum across phases or serials. */
  isScalarSum?: boolean
}

export interface Reading {
  tsEnd: number
  value: number | null
  quality: QualityCode
}

/**
 * The one usability rule. Usable = has a value and is OK, estimated, scale-corrected,
 * or a tiny negative that was clamped to 0 (quality 3 with value >= 0). A large negative keeps
 * its raw value with quality 3 so it can be shown, and is excluded here.
 */
export function isUsable(r: Pick<Reading, 'value' | 'quality'>): boolean {
  if (r.value === null) return false
  if (r.quality === QUALITY.OK || r.quality === QUALITY.ESTIMATED || r.quality === QUALITY.SCALE_CORRECTED) return true
  return r.quality === QUALITY.NEGATIVE && r.value >= 0
}

export interface LevelShiftSegment {
  startTsEnd: number
  endTsEnd: number
  count: number
  medianValue: number
}

export interface ChannelStats {
  slots: number
  present: number
  usable: number
  estimated: number
  statusFlagged: number
  /** present / slots */
  completeness: number
  firstTsEnd: number | null
  lastTsEnd: number | null
  spanDays: number
  longestGapHours: number
  zeroRunsOver6h: number
  spikes: number
  resetPairs: number
  tinyNegatives: number
  largeNegatives: number
  rollovers: number
  duplicateConflicts: number
  levelShiftIntervals: number
  meanUsable: number | null
  maxUsable: number | null
  sumUsable: number
}

export interface NormalisedChannel {
  spec: ChannelSpec
  storedUnit: StoredUnit
  intervalMin: number
  isCumulative: boolean
  /** Daily (1,440-min) channels: coverage only, never load or MD (engine spec §2.1 step 6). */
  coverageOnly: boolean
  readings: Reading[]
  levelShifts: LevelShiftSegment[]
  stats: ChannelStats
}

export type IssueCode =
  | 'empty_file' | 'header_only' | 'escaped_copy' | 'download_log' | 'derived_file' | 'register_file'
  | 'workbook_file' | 'xls_not_supported' | 'water_channel' | 'unparseable_timestamps' | 'too_few_rows'
  | 'low_completeness' | 'unknown_unit' | 'ambiguous_date_order' | 'convention_required' | 'no_header'
  | 'short_window' | 'daily_interval' | 'irregular_interval' | 'serial_mismatch' | 'level_shift' | 'spikes'
  | 'reset_pairs' | 'tiny_negatives' | 'large_negatives' | 'rollover' | 'lagged_channel'
  | 'implied_density_out_of_band' | 'calc_padding' | 'status_codes_unmapped' | 'duplicate_timestamps'
  | 'unit_overridden' | 'formula_columns' | 'latin1_encoding'

export interface ReportIssue {
  code: IssueCode
  message: string
  column?: string
}

export class MeterParseError extends Error {
  readonly code: IssueCode
  constructor(code: IssueCode, message: string) {
    super(message)
    this.code = code
    this.name = 'MeterParseError'
  }
}
```

- [ ] **Step 4: Implement `text.ts`**

```ts
export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'utf-8-bom' | 'latin1'
  lineEnding: 'crlf' | 'lf' | 'mixed' | 'none'
}

/** UTF-8 (BOM stripped); anything that is not valid UTF-8 is read as Windows-1252 and reported. */
export function decodeMeterText(bytes: Uint8Array): DecodedText {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = hasBom ? bytes.subarray(3) : bytes
  let text: string
  let encoding: DecodedText['encoding']
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    encoding = hasBom ? 'utf-8-bom' : 'utf-8'
  } catch {
    text = new TextDecoder('windows-1252').decode(body)
    encoding = 'latin1'
  }
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length
  const lineEnding = lf === 0 ? 'none' : crlf === lf ? 'crlf' : crlf === 0 ? 'lf' : 'mixed'
  return { text, encoding, lineEnding }
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Quote-aware row split. Cells are trimmed; a quote opens a quoted cell only at the start of a cell
 * (after optional spaces), which is what PnP's `, "…"` headers need. `""` inside quotes is a quote.
 */
export function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"' && cur.trim() === '') {
      inQuotes = true
      cur = ''
    } else if (ch === delimiter) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/text`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/meter-data/types.ts packages/shared/src/meter-data/text.ts packages/shared/src/meter-data/text.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter-data types, usability rule, byte decoding and row splitting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Filename grammar

**Files:**
- Create: `packages/shared/src/meter-data/filename.ts`
- Test: `packages/shared/src/meter-data/filename.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseMeterFilename } from './filename'

describe('parseMeterFilename — {SITE}, {SHOP_NO}, {LABEL}, {AREA}[ (n)]', () => {
  it('standard name with shop and area', () => {
    expect(parseMeterFilename('SITE YA, SHOP 050, TENANT-23, 3000.csv')).toEqual({
      grammar: 'standard', siteHint: 'SITE YA', shopNo: 'SHOP 050', label: 'TENANT-23',
      areaM2Hint: 3000, dupIndex: null, serialHint: null, extension: 'csv',
    })
  })
  it('blank shop and blank area', () => {
    const p = parseMeterFilename('SITE YA, , BULK METER, .csv')
    expect([p.shopNo, p.label, p.areaM2Hint]).toEqual([null, 'BULK METER', null])
  })
  it('repeat marker (n)', () => {
    const p = parseMeterFilename('SITE FL, SHOP 06, Vacant, 450 (2).csv')
    expect([p.shopNo, p.label, p.areaM2Hint, p.dupIndex]).toEqual(['SHOP 06', 'Vacant', 450, 2])
  })
  // as-is/10 §6.4 edge cases, anonymised but structurally identical.
  it('shop number containing commas (SITE TH "11A,13,12")', () => {
    const p = parseMeterFilename('SITE TH, 11A,13,12, TENANT-02, 225.csv')
    expect([p.siteHint, p.shopNo, p.label, p.areaM2Hint]).toEqual(['SITE TH', '11A, 13, 12', 'TENANT-02', 225])
  })
  it('shop number with ", " and "&" (VENDA "C2, C3 & C4")', () => {
    expect(parseMeterFilename('SITE VP, C2, C3 & C4, TENANT-03, 270.csv').shopNo).toBe('C2, C3 & C4')
  })
  it('stray quote (SITE CY "4-5-6)', () => {
    const p = parseMeterFilename('SITE CY, "4-5-6, TENANT-04, 272.csv')
    expect([p.shopNo, p.label, p.areaM2Hint]).toEqual(['4-5-6', 'TENANT-04', 272])
  })
  it('decimal area (BOTLOKWA 227.5)', () => {
    expect(parseMeterFilename('SITE BP, 20, TENANT-05, 227.5.csv').areaM2Hint).toBe(227.5)
  })
  it('serial embedded in the label', () => {
    expect(parseMeterFilename('SITE SG, , 30123456_DB-26, .csv').serialHint).toBe('30123456')
    expect(parseMeterFilename('SITE PM, , Meter 30654321, .csv').serialHint).toBe('30654321')
    expect(parseMeterFilename('SITE PD, , PDB_31234567_TENANT-97_22m2V, .csv').serialHint).toBe('31234567')
    expect(parseMeterFilename('SITE KM, , E9002, .csv').serialHint).toBeNull()
  })
  it('audit-tree name "<CODE> - <TENANT> <AREA>"', () => {
    expect(parseMeterFilename('RP - TENANT-06 525.csv')).toMatchObject({
      grammar: 'audit', siteHint: 'RP', label: 'TENANT-06', areaM2Hint: 525,
    })
  })
  it('anything else', () => {
    expect(parseMeterFilename('export.txt')).toMatchObject({ grammar: 'other', label: 'export', extension: 'txt' })
  })
  it('strips a directory', () => {
    expect(parseMeterFilename('org/project/SITE YA, , CHECK 1, .csv').label).toBe('CHECK 1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/filename`
Expected: FAIL — cannot resolve `./filename`.

- [ ] **Step 3: Implement**

```ts
/**
 * Filename grammar of the office corpus (as-is/10 §1.3). Every field is a HINT: the consolidation
 * register (3a-ii) outranks it, and a PnP line-1 serial outranks the filename serial.
 */
export interface ParsedFilename {
  grammar: 'standard' | 'audit' | 'other'
  siteHint: string | null
  shopNo: string | null
  label: string | null
  areaM2Hint: number | null
  dupIndex: number | null
  serialHint: string | null
  extension: string
}

const EXT = /\.(csv|txt|xlsx|xls)$/i

function clean(s: string | undefined): string | null {
  if (s === undefined) return null
  const t = s.replace(/"/g, '').trim()
  return t === '' ? null : t
}

function findSerial(s: string | null): string | null {
  if (!s) return null
  const m = s.match(/(?<![0-9])([0-9]{7,8}[A-Z]?)(?![0-9])/)
  return m ? m[1] : null
}

export function parseMeterFilename(fileName: string): ParsedFilename {
  const base = fileName.split('/').pop() ?? fileName
  const extMatch = base.match(EXT)
  const extension = extMatch ? extMatch[1].toLowerCase() : ''
  let stem = extMatch ? base.slice(0, -extMatch[0].length) : base
  let dupIndex: number | null = null
  const dup = stem.match(/\s\((\d+)\)$/)
  if (dup) {
    dupIndex = Number(dup[1])
    stem = stem.slice(0, -dup[0].length)
  }

  const parts = stem.split(',')
  if (parts.length >= 4) {
    const areaRaw = clean(parts[parts.length - 1])
    const label = clean(parts[parts.length - 2])
    const shopParts = parts
      .slice(1, -2)
      .map((p) => p.replace(/"/g, '').trim())
      .filter((p) => p !== '')
    return {
      grammar: 'standard',
      siteHint: clean(parts[0]),
      shopNo: shopParts.length > 0 ? shopParts.join(', ') : null,
      label,
      areaM2Hint: areaRaw !== null && /^\d+(\.\d+)?$/.test(areaRaw) ? Number(areaRaw) : null,
      dupIndex,
      serialHint: findSerial(label),
      extension,
    }
  }

  const audit = stem.match(/^([A-Z0-9]{1,5})\s+-\s+(.+?)(?:\s+(\d+(?:\.\d+)?))?$/)
  if (audit) {
    return {
      grammar: 'audit',
      siteHint: audit[1],
      shopNo: null,
      label: audit[2].trim(),
      areaM2Hint: audit[3] ? Number(audit[3]) : null,
      dupIndex,
      serialHint: findSerial(audit[2]),
      extension,
    }
  }

  const label = clean(stem)
  return { grammar: 'other', siteHint: null, shopNo: null, label, areaM2Hint: null, dupIndex, serialHint: findSerial(label), extension }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/filename`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/filename.ts packages/shared/src/meter-data/filename.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter filename grammar incl. corpus edge cases and serial hints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Format sniffing

**Files:**
- Create: `packages/shared/src/meter-data/sniff.ts`
- Test: `packages/shared/src/meter-data/sniff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { sniffMeterText } from './sniff'
import { decodeMeterText } from './text'
import { fixture, registerFixture } from './__fixtures__/load'

const sniffFixture = (id: string) => sniffMeterText(decodeMeterText(fixture(id).bytes).text)

describe('sniffMeterText on the golden fixtures', () => {
  it.each([
    ['a-bulk', 'A'], ['a-pv-multi', 'A'], ['a-water', 'A'],
    ['b-virtual-calc', 'B'], ['b-daily', 'B'], ['b-seven-serials', 'B'],
    ['c-energy', 'C'], ['c-energy-2', 'C'],
    ['d-escaped', 'D'], ['e-log', 'E'], ['f-derived', 'F'],
  ])('%s → %s', (id, fmt) => {
    expect(sniffFixture(id).format).toBe(fmt)
  })

  it('A: header on line 3, data from line 4', () => {
    expect(sniffFixture('a-bulk')).toMatchObject({ delimiter: ',', headerLineIndex: 2, dataStartIndex: 3 })
  })
  it('A with only "sep=," is an empty file', () => {
    expect(sniffFixture('a-empty')).toMatchObject({ format: 'empty', reason: 'empty_file' })
  })
  it('B carries every line-1 serial', () => {
    expect(sniffFixture('b-virtual-calc').serials).toHaveLength(3)
    expect(sniffFixture('b-seven-serials').serials).toHaveLength(7)
    expect(sniffFixture('b-misfiled').serials).toHaveLength(1)
  })
  it('C: header line 2, one serial', () => {
    expect(sniffFixture('c-energy')).toMatchObject({ headerLineIndex: 1, dataStartIndex: 2 })
    expect(sniffFixture('c-energy').serials).toHaveLength(1)
  })
  it('G: both summary shapes', () => {
    const nine = sniffMeterText(decodeMeterText(registerFixture('SITE YA_Consolidation_Summary.9col.csv').bytes).text)
    const three = sniffMeterText(decodeMeterText(registerFixture('SITE YA_Consolidation_Summary.csv').bytes).text)
    expect([nine.format, three.format]).toEqual(['G', 'G'])
  })
})

describe('sniffMeterText edge cases', () => {
  it('whitespace only → empty', () => {
    expect(sniffMeterText(' \r\n\r\n').format).toBe('empty')
  })
  it('A header but no data → header_only', () => {
    expect(sniffMeterText('sep=,\r\n\r\ndate,p14\r\n')).toMatchObject({ format: 'empty', reason: 'header_only' })
  })
  it('PnP C header only → header_only', () => {
    expect(sniffMeterText('pnpscada.com,30000001\nTime,P1 (kWh),Status\n')).toMatchObject({ format: 'empty', reason: 'header_only' })
  })
  it('PnP preamble unquoted but B header → B (an .xlsx sheet written back to CSV)', () => {
    const t = 'pnpscada.com,30000002\n"P (per kW)","DATE","TIME","STATUS"\n1,2025-03-10,00:30:00,Ok\n'
    expect(sniffMeterText(t).format).toBe('B')
  })
  it('generic: semicolon + decimal comma picks ";"', () => {
    const t = 'Timestamp;Import (kW)\n01/02/2025 00:30;12,5\n01/02/2025 01:00;13,0\n01/02/2025 01:30;13,5\n01/02/2025 02:00;14,0\n01/02/2025 02:30;14,5\n'
    expect(sniffMeterText(t)).toMatchObject({ format: 'generic', delimiter: ';', headerLineIndex: 0, dataStartIndex: 1 })
  })
  it('generic without a header → no_header', () => {
    expect(sniffMeterText('1,2\n3,4\n')).toMatchObject({ format: 'generic', reason: 'no_header' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/sniff`
Expected: FAIL — cannot resolve `./sniff`.

- [ ] **Step 3: Implement**

```ts
import type { MeterFormatId } from './types'
import { splitLines, splitRow } from './text'

export interface SniffResult {
  format: MeterFormatId
  delimiter: string | null
  /** 0-based line index of the header row. */
  headerLineIndex: number | null
  dataStartIndex: number | null
  /** PnP line-1 serials (B/C). */
  serials: string[]
  reason: 'empty_file' | 'header_only' | 'escaped_copy' | 'no_header' | null
}

/** A cell that looks like a date with an optional time; used by the generic path only. */
export const GENERIC_TS_RE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/

const none = (format: MeterFormatId, reason: SniffResult['reason']): SniffResult => ({
  format, delimiter: null, headerLineIndex: null, dataStartIndex: null, serials: [], reason,
})

function hasDataAfter(lines: string[], headerIdx: number): boolean {
  return lines.slice(headerIdx + 1).some((l) => l.trim() !== '')
}

/** Fixed order; the first match wins (as-is/10 §6.1 step 3). */
export function sniffMeterText(text: string): SniffResult {
  const lines = splitLines(text)
  const nonBlank = lines.filter((l) => l.trim() !== '')
  if (nonBlank.length === 0) return none('empty', 'empty_file')
  const first = lines[0].replace(/^﻿/, '')

  if (/^Serial,Name,Downloaded,Timestamp\s*$/i.test(first)) {
    return { format: 'E', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }
  }
  // D before G: a D file starts with the summary header followed by a LITERAL "\n".
  if (nonBlank.length === 1 && first.includes('\\n') && /(^|\\n)date,/i.test(first)) {
    return { format: 'D', delimiter: ',', headerLineIndex: null, dataStartIndex: null, serials: [], reason: 'escaped_copy' }
  }
  if (/^(Shop Name|Matched Layout Name),Shop Number,Area \(sqm\)/i.test(first) || /^Meter Filename,Matched Layout Name/i.test(first)) {
    return { format: 'G', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }
  }
  if (/^kwh\+,/i.test(first)) return { format: 'F', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }

  const sep = first.match(/^sep=(.)\s*$/i)
  if (sep) {
    const d = sep[1]
    const h = lines.findIndex((l, i) => i > 0 && l.toLowerCase().startsWith(`date${d}`))
    if (h < 0) return none('empty', 'empty_file')
    if (!hasDataAfter(lines, h)) return none('empty', 'header_only')
    return { format: 'A', delimiter: d, headerLineIndex: h, dataStartIndex: h + 1, serials: [], reason: null }
  }

  if (/^"?pnpscada\.com"?\s*,/i.test(first)) {
    const serials = splitRow(first, ',').slice(1).filter((s) => s !== '')
    const header = lines[1] ?? ''
    const cells = splitRow(header, ',').map((c) => c.toUpperCase())
    const isB = cells.includes('DATE') && cells.includes('TIME') && cells.includes('STATUS')
    const isC = /^time,/i.test(header)
    if (!isB && !isC) return { ...none('generic', 'no_header'), serials }
    if (!hasDataAfter(lines, 1)) return { ...none('empty', 'header_only'), serials }
    return { format: isB ? 'B' : 'C', delimiter: ',', headerLineIndex: 1, dataStartIndex: 2, serials, reason: null }
  }

  return sniffGeneric(lines)
}

function modeOf(xs: number[]): number {
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best = 0
  let bestN = -1
  for (const [x, n] of counts) if (n > bestN || (n === bestN && x > best)) [best, bestN] = [x, n]
  return best
}

function sniffGeneric(lines: string[]): SniffResult {
  const sample = lines.slice(0, 60).filter((l) => l.trim() !== '')
  let best: { d: string; cols: number; tsShare: number } | null = null
  for (const d of [',', ';', '\t', '|']) {
    const split = sample.map((l) => splitRow(l, d))
    const counts = split.map((c) => c.length)
    const mode = modeOf(counts)
    const share = counts.filter((c) => c === mode).length / counts.length
    const tsShare = split.filter((c) => c.some((x) => GENERIC_TS_RE.test(x))).length / split.length
    if (mode < 2 || share < 0.8 || tsShare === 0) continue
    if (!best || tsShare > best.tsShare || (tsShare === best.tsShare && mode > best.cols)) best = { d, cols: mode, tsShare }
  }
  if (!best) return none('generic', 'no_header')
  const d = best.d
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const cells = splitRow(lines[i], d)
    if (cells.length < 2 || cells.some((c) => GENERIC_TS_RE.test(c))) continue
    const next = lines.slice(i + 1).filter((l) => l.trim() !== '').slice(0, 20)
    if (next.length === 0) continue
    if (next.every((l) => splitRow(l, d).some((c) => GENERIC_TS_RE.test(c)))) {
      return { format: 'generic', delimiter: d, headerLineIndex: i, dataStartIndex: i + 1, serials: [], reason: null }
    }
  }
  return { ...none('generic', 'no_header'), delimiter: d }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/sniff`
Expected: PASS (all fixture rows + 6 edge cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/sniff.ts packages/shared/src/meter-data/sniff.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter format sniffing (A/B/C/D/E/F/G/generic/empty) in fixed order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Fixed unit tables

**Files:**
- Create: `packages/shared/src/meter-data/units.ts`
- Test: `packages/shared/src/meter-data/units.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mapColumnA, mapColumnB, mapColumnC, mapColumnGeneric, suggestUnitFromHeader, storedUnitFor, toStoredValue, withUnit } from './units'

describe('format A vocabulary (p/q/s/a × 14/23/12/34, _l1..3, u, i)', () => {
  it.each([
    ['p14', 'active_power', 'import', 'kW', null],
    ['p23', 'active_power', 'export', 'kW', null],
    ['q12', 'reactive_power', 'import', 'kvar', null],
    ['q34', 'reactive_power', 'export', 'kvar', null],
    ['s14', 'apparent_power', 'import', 'kVA', null],
    ['a14', 'active_energy', 'import', 'kWh', null],
    ['a23', 'active_energy', 'export', 'kWh', null],
    ['p14_l2', 'active_power', 'import', 'kW', 'l2'],
    ['u_l1', 'voltage', 'none', 'V', 'l1'],
    ['i_l3', 'current', 'none', 'A', 'l3'],
    ['Total Solar Active Power', 'active_power', 'import', 'kW', null],
    ['Solar Total Power', 'active_power', 'import', 'kW', null],
    ['Generator Total Power', 'active_power', 'import', 'kW', null],
    ['Volume', 'volume', 'none', 'm3', null],
  ])('%s', (h, q, d, u, ph) => {
    expect(mapColumnA(h, 1)).toMatchObject({ sourceColumn: h, quantity: q, direction: d, sourceUnit: u, phase: ph, unitFromTable: true })
  })
  it('an unknown A header is NOT given a unit', () => {
    expect(mapColumnA('total_daily_night_usage', 1)).toMatchObject({ quantity: 'unknown', sourceUnit: 'unknown', unitFromTable: false })
  })
})

describe('format B (PnP power)', () => {
  it('maps P/P1/P2/Q/S/scalar sum and the non-channel columns', () => {
    expect(mapColumnB('"P (per kW)"', 0)).toMatchObject({ quantity: 'active_power', direction: 'import', sourceUnit: 'kW' })
    expect(mapColumnB('P1 (per kW)', 0)).toMatchObject({ direction: 'import' })
    expect(mapColumnB('P2 (per kW)', 2)).toMatchObject({ direction: 'export' })
    expect(mapColumnB('Q1 (per kvar)', 1)).toMatchObject({ quantity: 'reactive_power', sourceUnit: 'kvar' })
    expect(mapColumnB('S (per kVA)', 3)).toMatchObject({ quantity: 'apparent_power', direction: 'none', sourceUnit: 'kVA' })
    expect(mapColumnB('scalar sum S (per kVA)', 4)).toMatchObject({ quantity: 'apparent_power', isScalarSum: true })
    expect([mapColumnB('"DATE"', 5), mapColumnB('TIME', 6), mapColumnB('STATUS', 7)]).toEqual(['date', 'time', 'status'])
  })
})

describe('format C (PnP energy)', () => {
  it('maps kWh/kvarh/kVAh and the trailing S (kVA) demand', () => {
    expect(mapColumnC('Time', 0)).toBe('timestamp')
    expect(mapColumnC('Status', 8)).toBe('status')
    expect(mapColumnC('P1 (kWh)', 1)).toMatchObject({ quantity: 'active_energy', direction: 'import', sourceUnit: 'kWh' })
    expect(mapColumnC('P2 (kWh)', 4)).toMatchObject({ direction: 'export' })
    expect(mapColumnC('Q1 (kvarh)', 2)).toMatchObject({ quantity: 'reactive_energy', direction: 'import' })
    expect(mapColumnC('Q3 (kvarh)', 6)).toMatchObject({ direction: 'export' })
    expect(mapColumnC('S (kVAh)', 3)).toMatchObject({ quantity: 'apparent_energy', sourceUnit: 'kVAh' })
    expect(mapColumnC('S (kVA)', 9)).toMatchObject({ quantity: 'apparent_power', sourceUnit: 'kVA' })
  })
})

describe('generic path', () => {
  it('never assigns a unit, only suggests one', () => {
    expect(mapColumnGeneric('Import (kW)', 1)).toMatchObject({ sourceUnit: 'unknown', quantity: 'unknown', unitFromTable: false })
    expect(suggestUnitFromHeader('Import (kW)')).toBe('kW')
    expect(suggestUnitFromHeader('Energy [kWh]')).toBe('kWh')
    expect(suggestUnitFromHeader('Q (kvarh)')).toBe('kvarh')
    expect(suggestUnitFromHeader('Value')).toBeNull()
  })
  it('withUnit sets unit + quantity and marks it user-chosen', () => {
    expect(withUnit(mapColumnGeneric('Import', 1), 'kWh')).toMatchObject({ sourceUnit: 'kWh', quantity: 'active_energy', unitFromTable: false })
  })
})

describe('stored values', () => {
  it('energy per interval → average power (kW = kWh × 60 / Δ)', () => {
    expect(toStoredValue(4.82, { quantity: 'active_energy', sourceUnit: 'kWh' }, 30)).toBeCloseTo(9.64, 10)
    expect(toStoredValue(9.25, { quantity: 'active_energy', sourceUnit: 'kWh' }, 60)).toBeCloseTo(9.25, 10)
    expect(toStoredValue(500, { quantity: 'active_energy', sourceUnit: 'Wh' }, 30)).toBeCloseTo(1, 10)
    expect(toStoredValue(2.44, { quantity: 'apparent_energy', sourceUnit: 'kVAh' }, 30)).toBeCloseTo(4.88, 10)
  })
  it('power is stored as is, W and MW are scaled', () => {
    expect(toStoredValue(192.46, { quantity: 'active_power', sourceUnit: 'kW' }, 30)).toBe(192.46)
    expect(toStoredValue(296324, { quantity: 'active_power', sourceUnit: 'W' }, 30)).toBeCloseTo(296.324, 10)
    expect(toStoredValue(1.2, { quantity: 'active_power', sourceUnit: 'MW' }, 30)).toBeCloseTo(1200, 10)
  })
  it('stored unit per quantity', () => {
    expect([storedUnitFor('active_energy'), storedUnitFor('reactive_energy'), storedUnitFor('apparent_energy'), storedUnitFor('voltage')]).toEqual(['kW', 'kvar', 'kVA', 'V'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/units`
Expected: FAIL — cannot resolve `./units`.

- [ ] **Step 3: Implement**

```ts
/**
 * Fixed per-format column tables (engine spec §2.1 step 3; as-is/10 §6.1 step 4). The unit is
 * NEVER inferred from magnitude and never defaulted: an unrecognised column is 'unknown' and the
 * caller must supply a unit before the channel can be imported.
 * Reactive quadrants (IEC 62053-23): import = Q1+Q2, export = Q3+Q4. A's q12/q34 follow that.
 */
import type { ChannelSpec, Direction, Phase, Quantity, SourceUnit, StoredUnit } from './types'
import { SOURCE_UNITS } from './types'

export type NonChannelColumn = 'date' | 'time' | 'timestamp' | 'status'

const A_CODE = /^([pqsa])(14|23|12|34)(?:_l([123]))?$/

function spec(sourceColumn: string, columnIndex: number, quantity: Quantity, direction: Direction, sourceUnit: SourceUnit, phase: Phase = null): ChannelSpec {
  return { sourceColumn, columnIndex, quantity, direction, phase, sourceUnit, unitFromTable: sourceUnit !== 'unknown' }
}

export function mapColumnA(header: string, columnIndex: number): ChannelSpec {
  const h = header.trim()
  const lower = h.toLowerCase()
  const m = lower.match(A_CODE)
  if (m) {
    const [, letter, quad, ph] = m
    const direction: Direction = quad === '14' || quad === '12' ? 'import' : 'export'
    const phase = ph ? (`l${ph}` as Phase) : null
    if (letter === 'p') return spec(h, columnIndex, 'active_power', direction, 'kW', phase)
    if (letter === 'q') return spec(h, columnIndex, 'reactive_power', direction, 'kvar', phase)
    if (letter === 's') return spec(h, columnIndex, 'apparent_power', direction, 'kVA', phase)
    return spec(h, columnIndex, 'active_energy', direction, 'kWh', phase)
  }
  const v = lower.match(/^u_l([123])$/)
  if (v) return spec(h, columnIndex, 'voltage', 'none', 'V', `l${v[1]}` as Phase)
  const i = lower.match(/^i_l([123])$/)
  if (i) return spec(h, columnIndex, 'current', 'none', 'A', `l${i[1]}` as Phase)
  if (/total power$|active power$/.test(lower)) return spec(h, columnIndex, 'active_power', 'import', 'kW')
  if (lower === 'volume') return spec(h, columnIndex, 'volume', 'none', 'm3')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnB(header: string, columnIndex: number): ChannelSpec | NonChannelColumn {
  const h = header.replace(/"/g, '').trim()
  const upper = h.toUpperCase()
  if (upper === 'DATE') return 'date'
  if (upper === 'TIME') return 'time'
  if (upper === 'STATUS') return 'status'
  let m = h.match(/^P([12]?) \(per kW\)$/i)
  if (m) return spec(h, columnIndex, 'active_power', m[1] === '2' ? 'export' : 'import', 'kW')
  m = h.match(/^Q([1-4]?) \(per kvar\)$/i)
  if (m) return spec(h, columnIndex, 'reactive_power', m[1] === '3' || m[1] === '4' ? 'export' : 'import', 'kvar')
  if (/^scalar sum S \(per kVA\)$/i.test(h)) return { ...spec(h, columnIndex, 'apparent_power', 'none', 'kVA'), isScalarSum: true }
  if (/^S \(per kVA\)$/i.test(h)) return spec(h, columnIndex, 'apparent_power', 'none', 'kVA')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnC(header: string, columnIndex: number): ChannelSpec | NonChannelColumn {
  const h = header.trim()
  if (/^time$/i.test(h)) return 'timestamp'
  if (/^status$/i.test(h)) return 'status'
  let m = h.match(/^P([12]) \(kWh\)$/i)
  if (m) return spec(h, columnIndex, 'active_energy', m[1] === '2' ? 'export' : 'import', 'kWh')
  m = h.match(/^Q([1-4]) \(kvarh\)$/i)
  if (m) return spec(h, columnIndex, 'reactive_energy', m[1] === '3' || m[1] === '4' ? 'export' : 'import', 'kvarh')
  if (/^S \(kVAh\)$/i.test(h)) return spec(h, columnIndex, 'apparent_energy', 'none', 'kVAh')
  if (/^S \(kVA\)$/i.test(h)) return spec(h, columnIndex, 'apparent_power', 'none', 'kVA')
  return spec(h, columnIndex, 'unknown', 'none', 'unknown')
}

export function mapColumnGeneric(header: string, columnIndex: number): ChannelSpec {
  const h = header.trim()
  return spec(h, columnIndex, 'unknown', /export|\bp2\b|kwh-|kw-/i.test(h) ? 'export' : 'import', 'unknown')
}

/** A suggestion to show the user on the generic path; never applied automatically. */
export function suggestUnitFromHeader(header: string): SourceUnit | null {
  const m = header.match(/[([]\s*(kWh|kW|MWh|MW|Wh|W|kvarh|kvar|kVAh|kVA|V|A)\s*[)\]]/i)
  if (!m) return null
  return SOURCE_UNITS.find((u) => u.toLowerCase() === m[1].toLowerCase()) ?? null
}

export function quantityForUnit(u: SourceUnit): Quantity {
  switch (u) {
    case 'kW': case 'W': case 'MW': return 'active_power'
    case 'kWh': case 'Wh': case 'MWh': return 'active_energy'
    case 'kvar': return 'reactive_power'
    case 'kvarh': return 'reactive_energy'
    case 'kVA': return 'apparent_power'
    case 'kVAh': return 'apparent_energy'
    case 'V': return 'voltage'
    case 'A': return 'current'
    case 'PF': return 'power_factor'
    case 'm3': return 'volume'
    default: return 'unknown'
  }
}

export function withUnit(s: ChannelSpec, unit: SourceUnit): ChannelSpec {
  return { ...s, sourceUnit: unit, quantity: unit === 'unknown' ? s.quantity : quantityForUnit(unit), unitFromTable: false }
}

export function storedUnitFor(q: Quantity): StoredUnit {
  switch (q) {
    case 'active_power': case 'active_energy': return 'kW'
    case 'reactive_power': case 'reactive_energy': return 'kvar'
    case 'apparent_power': case 'apparent_energy': return 'kVA'
    case 'voltage': return 'V'
    case 'current': return 'A'
    case 'power_factor': return 'PF'
    case 'volume': return 'm3'
    default: return 'unknown'
  }
}

/** Energy per interval → average power over the interval; W/MW → k. */
export function toStoredValue(v: number, s: Pick<ChannelSpec, 'quantity' | 'sourceUnit'>, intervalMin: number): number {
  const perHour = 60 / intervalMin
  switch (s.sourceUnit) {
    case 'W': return v / 1000
    case 'MW': return v * 1000
    case 'kWh': case 'kvarh': case 'kVAh': return v * perHour
    case 'Wh': return (v / 1000) * perHour
    case 'MWh': return v * 1000 * perHour
    default: return v
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/units`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/units.ts packages/shared/src/meter-data/units.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): fixed per-format meter unit tables; units never defaulted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Timestamps (SAST, per-format labels, date order, 24:00)

**Files:**
- Create: `packages/shared/src/meter-data/timestamps.ts`
- Test: `packages/shared/src/meter-data/timestamps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectDateOrder, parseLabelA, parseLabelB, parseLabelC, parseLabelGeneric, sastLocalToUtcMs, utcMsToSast } from './timestamps'

describe('SAST ↔ UTC (fixed +2, no DST)', () => {
  it('local midnight is 22:00 UTC the day before', () => {
    expect(sastLocalToUtcMs(2025, 3, 10, 0, 0, 0)).toBe(Date.UTC(2025, 2, 9, 22, 0, 0))
  })
  it('rejects impossible dates', () => {
    expect(sastLocalToUtcMs(2025, 2, 30, 0, 0, 0)).toBeNull()
    expect(sastLocalToUtcMs(2025, 13, 1, 0, 0, 0)).toBeNull()
    expect(sastLocalToUtcMs(2025, 1, 1, 24, 30, 0)).toBeNull()
  })
  it('round trips', () => {
    expect(utcMsToSast(Date.UTC(2025, 2, 9, 22, 30))).toMatchObject({ isoDate: '2025-03-10', hour: 0, minute: 30 })
  })
})

describe('per-format labels', () => {
  it('A: DD/MM/YYYY HH:MM:SS', () => {
    expect(parseLabelA('10/03/2025 00:00:00')).toEqual({ utcMs: Date.UTC(2025, 2, 9, 22, 0), was2400: false })
    expect(parseLabelA('2025-03-10 00:00:00')).toBeNull()
  })
  it('B: separate DATE and TIME; 24:00 → next day 00:00', () => {
    expect(parseLabelB('2025-10-01', '00:30:00')).toEqual({ utcMs: Date.UTC(2025, 8, 30, 22, 30), was2400: false })
    expect(parseLabelB('2025-03-10', '24:00:00')).toEqual({ utcMs: Date.UTC(2025, 2, 10, 22, 0), was2400: true })
  })
  it('C: one column', () => {
    expect(parseLabelC('2024-05-01 00:30:00')?.utcMs).toBe(Date.UTC(2024, 3, 30, 22, 30))
  })
  it('generic: honours the confirmed order', () => {
    expect(parseLabelGeneric('01/02/2025 00:30', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 30))
    expect(parseLabelGeneric('01/02/2025 00:30', 'MDY')?.utcMs).toBe(Date.UTC(2024, 11, 31, 22, 30) + 86_400_000)
    expect(parseLabelGeneric('2025-02-01T00:30', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 30))  // 4-digit year first = YMD
    expect(parseLabelGeneric('2025-02-01', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 0))
  })
})

describe('detectDateOrder (file-level)', () => {
  it('a first field > 12 means DMY', () => {
    expect(detectDateOrder(['01/02/2025 00:30', '13/02/2025 00:30'])).toEqual({ order: 'DMY', ambiguous: false })
  })
  it('a second field > 12 means MDY', () => {
    expect(detectDateOrder(['02/13/2025 00:30'])).toEqual({ order: 'MDY', ambiguous: false })
  })
  it('all fields ≤ 12 is ambiguous and must be confirmed', () => {
    expect(detectDateOrder(['01/02/2025 00:30', '02/02/2025 00:30'])).toEqual({ order: null, ambiguous: true })
  })
  it('4-digit year first is YMD', () => {
    expect(detectDateOrder(['2025-02-01 00:30'])).toEqual({ order: 'YMD', ambiguous: false })
  })
  it('contradictory evidence is not guessed', () => {
    expect(detectDateOrder(['13/02/2025', '02/13/2025'])).toEqual({ order: null, ambiguous: true })
  })
})
```

The `MDY` line reads `01/02/2025` as 2 January 2025 00:30 SAST = 1 January 22:30 UTC. `Date.UTC(2024, 11, 31, 22, 30) + 1 day` is that value written another way on purpose, so the expectation is not a copy of the implementation's arithmetic.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/timestamps`
Expected: FAIL — cannot resolve `./timestamps`.

- [ ] **Step 3: Implement**

```ts
/**
 * Time handling. SAST = UTC+2, no DST, fixed (engine spec §1.2). All arithmetic goes through
 * Date.UTC / getUTC*; local-time Date getters are never used.
 */
import type { DateOrder } from './types'

export const SAST_OFFSET_MS = 2 * 3_600_000

export interface ParsedLabel {
  utcMs: number
  was2400: boolean
}

/** Returns epoch ms UTC for a SAST wall-clock time, or null if it is not a real time. Accepts 24:00:00. */
export function sastLocalToUtcMs(y: number, mo: number, d: number, h: number, mi: number, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 24 || mi < 0 || mi > 59 || s < 0 || s > 59) return null
  if (h === 24 && (mi !== 0 || s !== 0)) return null
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return Date.UTC(y, mo - 1, d, h, mi, s) - SAST_OFFSET_MS
}

export function utcMsToSast(ms: number): { year: number; month: number; day: number; hour: number; minute: number; isoDate: string } {
  const d = new Date(ms + SAST_OFFSET_MS)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes(), isoDate: `${year}-${pad(month)}-${pad(day)}` }
}

function label(y: number, mo: number, d: number, h: number, mi: number, s: number): ParsedLabel | null {
  const utcMs = sastLocalToUtcMs(y, mo, d, h, mi, s)
  return utcMs === null ? null : { utcMs, was2400: h === 24 }
}

/** Format A: DD/MM/YYYY HH:MM[:SS] (as-is/10 §2.1). */
export function parseLabelA(cell: string): ParsedLabel | null {
  const m = cell.trim().match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/)
  return m ? label(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0)) : null
}

/** Format B: DATE YYYY-MM-DD and TIME HH:MM[:SS] in separate columns. */
export function parseLabelB(dateCell: string, timeCell: string): ParsedLabel | null {
  const d = dateCell.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = timeCell.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  return d && t ? label(+d[1], +d[2], +d[3], +t[1], +t[2], +(t[3] ?? 0)) : null
}

/** Format C: YYYY-MM-DD HH:MM[:SS]. */
export function parseLabelC(cell: string): ParsedLabel | null {
  const m = cell.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  return m ? label(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)) : null
}

const GENERIC = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

export function parseLabelGeneric(cell: string, order: DateOrder): ParsedLabel | null {
  const m = cell.trim().match(GENERIC)
  if (!m) return null
  const [a, b, c] = [m[1], +m[2], m[3]]
  const [h, mi, s] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]
  if (a.length === 4) return label(+a, b, +c, h, mi, s)
  if (c.length !== 4) return null
  return order === 'MDY' ? label(+c, +a, b, h, mi, s) : label(+c, b, +a, h, mi, s)
}

/** File-level date order (engine spec §2.1 step 1): decided once for the whole file, never per row. */
export function detectDateOrder(cells: string[]): { order: DateOrder | null; ambiguous: boolean } {
  let dmy = false
  let mdy = false
  let ymd = 0
  let other = 0
  for (const cell of cells) {
    const m = cell.trim().match(GENERIC)
    if (!m) continue
    if (m[1].length === 4) { ymd++; continue }
    other++
    if (+m[1] > 12) dmy = true
    if (+m[2] > 12) mdy = true
  }
  if (ymd > 0 && other === 0) return { order: 'YMD', ambiguous: false }
  if (dmy && !mdy) return { order: 'DMY', ambiguous: false }
  if (mdy && !dmy) return { order: 'MDY', ambiguous: false }
  return { order: null, ambiguous: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/timestamps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/timestamps.ts packages/shared/src/meter-data/timestamps.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): SAST timestamp parsing per format, file-level date order, 24:00

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Channel statistics and artefact detection

**Files:**
- Create: `packages/shared/src/meter-data/stats.ts`
- Create: `packages/shared/src/meter-data/artefacts.ts`
- Test: `packages/shared/src/meter-data/artefacts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { applyScaleCorrection, detectLevelShifts, flagSpikesAndNegatives, laggedDuplicateShare, medianOf, nearestRankPercentile } from './artefacts'
import { channelStats } from './stats'
import { QUALITY, type Reading } from './types'

const STEP = 30 * 60_000
const series = (values: Array<number | null>): Reading[] =>
  values.map((v, i) => ({ tsEnd: i * STEP, value: v, quality: v === null ? QUALITY.MISSING : QUALITY.OK }))

describe('percentiles', () => {
  it('median and nearest-rank', () => {
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([4, 1, 2, 3])).toBe(2.5)
    expect(medianOf([])).toBeNull()
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5)
  })
})

describe('detectLevelShifts (W recorded as kW)', () => {
  it('flags a run of ≥ 12 values ≥ 100 × the median, as quality 4', () => {
    const vals = [...Array(40).fill(300), ...Array(12).fill(300_000), ...Array(10).fill(300)]
    const { readings, segments } = detectLevelShifts(series(vals))
    expect(segments).toEqual([{ startTsEnd: 40 * STEP, endTsEnd: 51 * STEP, count: 12, medianValue: 300_000 }])
    expect(readings.filter((r) => r.quality === QUALITY.SPIKE)).toHaveLength(12)
  })
  it('an 11-long run is not a level shift', () => {
    const vals = [...Array(40).fill(300), ...Array(11).fill(300_000)]
    expect(detectLevelShifts(series(vals)).segments).toEqual([])
  })
  it('a gap breaks a run', () => {
    const vals = [...Array(40).fill(300), ...Array(6).fill(300_000), null, ...Array(6).fill(300_000)]
    expect(detectLevelShifts(series(vals)).segments).toEqual([])
  })
  it('applyScaleCorrection divides by 1000 and marks quality 7', () => {
    const vals = [...Array(40).fill(300), ...Array(12).fill(300_000)]
    const { readings, segments } = detectLevelShifts(series(vals))
    const fixed = applyScaleCorrection(readings, segments[0])
    expect(fixed[45]).toEqual({ tsEnd: 45 * STEP, value: 300, quality: QUALITY.SCALE_CORRECTED })
    expect(fixed[0]).toEqual(readings[0])
  })
})

describe('flagSpikesAndNegatives', () => {
  it('spikes above 50 × P95(|v|) are quality 4; negative spikes count as reset pairs', () => {
    const vals = [...Array(100).fill(10), 59000, -58795, 9.9]
    const { readings, counts } = flagSpikesAndNegatives(series(vals))
    expect(counts).toEqual({ spikes: 2, resetPairs: 1, tinyNegatives: 0, largeNegatives: 0 })
    expect(readings[100].quality).toBe(QUALITY.SPIKE)
    expect(readings[100].value).toBe(59000)              // raw value kept for display
  })
  it('tiny negatives (> −0.1) are clamped to 0 with quality 3; large ones keep their value', () => {
    const { readings, counts } = flagSpikesAndNegatives(series([10, -0.002, 10, -1710.82, 10]))
    expect(readings[1]).toMatchObject({ value: 0, quality: QUALITY.NEGATIVE })
    expect(readings[3]).toMatchObject({ value: -1710.82, quality: QUALITY.NEGATIVE })
    expect(counts).toMatchObject({ tinyNegatives: 1, largeNegatives: 1 })
  })
  it('an all-zero series has no spikes', () => {
    expect(flagSpikesAndNegatives(series([0, 0, 0])).counts.spikes).toBe(0)
  })
})

describe('laggedDuplicateShare', () => {
  it('detects b(t+1) == a(t) on non-zero pairs', () => {
    const a = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const b = series([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(laggedDuplicateShare(a, b)).toBe(1)
    expect(laggedDuplicateShare(b, a)).toBe(0)
  })
  it('needs at least 10 comparable pairs', () => {
    expect(laggedDuplicateShare(series([1, 2]), series([0, 1]))).toBeNull()
  })
})

describe('channelStats', () => {
  it('counts gaps, zero runs and usable values', () => {
    const vals: Array<number | null> = [1, null, null, 2, ...Array(12).fill(0), 3]
    const s = channelStats(series(vals), 30, { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0, rollovers: 0, duplicateConflicts: 0, levelShiftIntervals: 0 })
    expect(s).toMatchObject({ slots: 17, present: 15, usable: 15, longestGapHours: 1, zeroRunsOver6h: 1, sumUsable: 6, maxUsable: 3 })
    expect(s.completeness).toBeCloseTo(15 / 17, 10)
    expect(s.firstTsEnd).toBe(0)
    expect(s.lastTsEnd).toBe(16 * STEP)
    expect(s.spanDays).toBeCloseTo((16 * 30 + 30) / 1440, 10)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/artefacts`
Expected: FAIL — cannot resolve `./artefacts`.

- [ ] **Step 3: Implement `stats.ts`**

```ts
import { isUsable, QUALITY, type ChannelStats, type Reading } from './types'

export interface ChannelCounters {
  spikes: number
  resetPairs: number
  tinyNegatives: number
  largeNegatives: number
  rollovers: number
  duplicateConflicts: number
  levelShiftIntervals: number
}

export function channelStats(readings: Reading[], intervalMin: number, counters: ChannelCounters): ChannelStats {
  let present = 0
  let usable = 0
  let estimated = 0
  let statusFlagged = 0
  let sum = 0
  let max: number | null = null
  let gap = 0
  let longestGap = 0
  let zeroRun = 0
  let zeroRuns = 0
  let firstTsEnd: number | null = null
  let lastTsEnd: number | null = null
  const zeroRunSlots = Math.ceil(360 / intervalMin)
  for (const r of readings) {
    if (r.value === null) {
      gap++
      longestGap = Math.max(longestGap, gap)
    } else {
      gap = 0
      present++
      if (firstTsEnd === null) firstTsEnd = r.tsEnd
      lastTsEnd = r.tsEnd
    }
    if (r.quality === QUALITY.ESTIMATED) estimated++
    if (r.quality === QUALITY.STATUS) statusFlagged++
    if (isUsable(r)) {
      const v = r.value as number
      usable++
      sum += v
      max = max === null ? v : Math.max(max, v)
    }
    if (r.value === 0) {
      zeroRun++
      if (zeroRun === zeroRunSlots) zeroRuns++
    } else zeroRun = 0
  }
  const slots = readings.length
  return {
    slots, present, usable, estimated, statusFlagged,
    completeness: slots > 0 ? present / slots : 0,
    firstTsEnd, lastTsEnd,
    spanDays: firstTsEnd === null || lastTsEnd === null ? 0 : (lastTsEnd - firstTsEnd) / 86_400_000 + intervalMin / 1440,
    longestGapHours: (longestGap * intervalMin) / 60,
    zeroRunsOver6h: zeroRuns,
    ...counters,
    meanUsable: usable > 0 ? sum / usable : null,
    maxUsable: max,
    sumUsable: sum,
  }
}
```

- [ ] **Step 4: Implement `artefacts.ts`**

```ts
/**
 * Artefact detection (engine spec §2.1 step 5, as-is/10 §6.1 step 9). Order matters and is fixed:
 * level shifts first (so a W-scale segment does not set the spike threshold), then spikes, then
 * negatives among what is left. Raw values are kept for display; quality decides usability.
 */
import { QUALITY, type LevelShiftSegment, type Reading } from './types'

export function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function nearestRankPercentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]
}

const clean = (r: Reading) => r.value !== null && (r.quality === QUALITY.OK || r.quality === QUALITY.ESTIMATED)

export function detectLevelShifts(
  readings: Reading[],
  opts: { factor: number; minRun: number } = { factor: 100, minRun: 12 },
): { readings: Reading[]; segments: LevelShiftSegment[] } {
  const med = medianOf(readings.filter((r) => clean(r) && (r.value as number) > 0).map((r) => r.value as number))
  if (med === null) return { readings, segments: [] }
  const out = [...readings]
  const segments: LevelShiftSegment[] = []
  let start = -1
  const close = (end: number) => {
    const len = end - start
    if (start >= 0 && len >= opts.minRun) {
      const vals = out.slice(start, end).map((r) => r.value as number)
      segments.push({ startTsEnd: out[start].tsEnd, endTsEnd: out[end - 1].tsEnd, count: len, medianValue: medianOf(vals) as number })
      for (let k = start; k < end; k++) out[k] = { ...out[k], quality: QUALITY.SPIKE }
    }
    start = -1
  }
  for (let i = 0; i < out.length; i++) {
    const hit = clean(out[i]) && (out[i].value as number) >= opts.factor * med
    if (hit && start < 0) start = i
    if (!hit && start >= 0) close(i)
  }
  if (start >= 0) close(out.length)
  return { readings: out, segments }
}

export function flagSpikesAndNegatives(
  readings: Reading[],
  opts: { spikeFactor: number; percentile: number; tinyNegativeFloor: number } = { spikeFactor: 50, percentile: 0.95, tinyNegativeFloor: -0.1 },
): { readings: Reading[]; counts: { spikes: number; resetPairs: number; tinyNegatives: number; largeNegatives: number } } {
  const p = nearestRankPercentile(readings.filter(clean).map((r) => Math.abs(r.value as number)), opts.percentile)
  const threshold = p !== null && p > 0 ? opts.spikeFactor * p : null
  const counts = { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0 }
  const out = readings.map((r): Reading => {
    if (!clean(r)) return r
    const v = r.value as number
    if (threshold !== null && Math.abs(v) > threshold) {
      counts.spikes++
      if (v < 0) counts.resetPairs++
      return { ...r, quality: QUALITY.SPIKE }
    }
    if (v < 0) {
      if (v > opts.tinyNegativeFloor) {
        counts.tinyNegatives++
        return { ...r, value: 0, quality: QUALITY.NEGATIVE }
      }
      counts.largeNegatives++
      return { ...r, quality: QUALITY.NEGATIVE }
    }
    return r
  })
  return { readings: out, counts }
}

/** User-confirmed correction of a W-scale segment (quality 7). */
export function applyScaleCorrection(readings: Reading[], segment: LevelShiftSegment, divisor = 1000): Reading[] {
  return readings.map((r) =>
    r.tsEnd >= segment.startTsEnd && r.tsEnd <= segment.endTsEnd && r.quality === QUALITY.SPIKE && r.value !== null
      ? { ...r, value: r.value / divisor, quality: QUALITY.SCALE_CORRECTED }
      : r,
  )
}

/**
 * Share of consecutive slots where b[i+1] equals a[i], over pairs where both are present and
 * non-zero. 1.0 means b is a copy of a delayed by one interval (SITE FV "Solar Total Power").
 */
export function laggedDuplicateShare(a: Reading[], b: Reading[]): number | null {
  let considered = 0
  let equal = 0
  for (let i = 0; i + 1 < a.length && i + 1 < b.length; i++) {
    const x = a[i].value
    const y = b[i + 1].value
    if (x === null || y === null || x === 0 || y === 0) continue
    considered++
    if (Math.abs(x - y) < 1e-9) equal++
  }
  return considered >= 10 ? equal / considered : null
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/artefacts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/meter-data/stats.ts packages/shared/src/meter-data/artefacts.ts packages/shared/src/meter-data/artefacts.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): level shifts, P95 spikes/reset pairs, negatives, lag detection, channel stats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Series normalisation

**Files:**
- Create: `packages/shared/src/meter-data/series.ts`
- Test: `packages/shared/src/meter-data/series.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectCumulative, detectIntervalMin, detectRowOrder, normaliseSeries, parseNumericCell, type RawRow } from './series'
import { QUALITY, type ChannelSpec } from './types'

const KW: ChannelSpec = { sourceColumn: 'p14', columnIndex: 1, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true }
const KWH: ChannelSpec = { ...KW, sourceColumn: 'P1 (kWh)', quantity: 'active_energy', sourceUnit: 'kWh' }
const T0 = Date.UTC(2025, 2, 9, 22, 0)   // 2025-03-10 00:00 SAST
const M30 = 30 * 60_000
const row = (i: number, v: string, status: string | null = null, fileIndex = i): RawRow => ({ labelUtcMs: T0 + i * M30, cells: [v], status, fileIndex })

describe('helpers', () => {
  it('row order', () => {
    expect(detectRowOrder([1, 2, 3])).toBe('ascending')
    expect(detectRowOrder([3, 2, 1])).toBe('descending')
    expect(detectRowOrder([3, 1, 2])).toBe('unordered')
  })
  it('interval = mode of Δt', () => {
    expect(detectIntervalMin([0, M30, 2 * M30, 4 * M30, 5 * M30])).toBe(30)
    expect(detectIntervalMin([0])).toBeNull()
  })
  it('numeric cells; decimal comma only when told', () => {
    expect(parseNumericCell('12.5', false)).toBe(12.5)
    expect(parseNumericCell('12,5', true)).toBe(12.5)
    expect(parseNumericCell('12,5', false)).toBeNull()
    expect(parseNumericCell('', false)).toBeNull()
    expect(parseNumericCell('1.5e3', false)).toBe(1500)
    expect(parseNumericCell('abc', false)).toBeNull()
  })
})

describe('normaliseSeries', () => {
  it('interval-beginning labels are stored at label + Δ; rows re-sorted', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(2, '3'), row(1, '2'), row(0, '1')], convention: 'begin', statusMode: 'none' })
    expect(r.rowOrder).toBe('descending')
    expect(r.intervalMin).toBe(30)
    expect(r.channels[0].readings.map((x) => [x.tsEnd, x.value])).toEqual([[T0 + M30, 1], [T0 + 2 * M30, 2], [T0 + 3 * M30, 3]])
  })
  it('interval-ending labels are stored as is', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(1, '1'), row(2, '2')], convention: 'end', statusMode: 'none' })
    expect(r.channels[0].readings[0].tsEnd).toBe(T0 + M30)
  })
  it('absent rows become NULL slots (never 0)', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '1'), row(1, '2'), row(4, '5')], convention: 'end', statusMode: 'none' })
    expect(r.intervalMin).toBe(30)   // Δt 30 and 90 tie once each; the shorter wins
    expect(r.channels[0].readings.map((x) => [x.value, x.quality])).toEqual([[1, 0], [2, 0], [null, 1], [null, 1], [5, 0]])
  })
  it('duplicate timestamps: first kept; conflicting values flag 5', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '1'), row(1, '2', null, 1), row(1, '9', null, 2), row(2, '3')], convention: 'end', statusMode: 'none' })
    expect(r.duplicates).toBe(1)
    expect(r.channels[0].readings[1]).toMatchObject({ value: 2, quality: QUALITY.DUPLICATE })
  })
  it('PnP B: Calc 0 → missing; other Calc → estimated; unknown status → 6', () => {
    const r = normaliseSeries({ channels: [KW], rows: [row(0, '0.0', 'Calc'), row(1, '5.5', 'Calc'), row(2, '6', 'Ok'), row(3, '7', 'Odd')], convention: 'end', statusMode: 'pnp_b' })
    expect(r.channels[0].readings.map((x) => [x.value, x.quality])).toEqual([[null, 1], [5.5, 2], [6, 0], [7, 6]])
    expect(r.calcRows).toBe(2)
  })
  it('PnP C: status 0 → ok, anything else → 6 (value kept)', () => {
    const r = normaliseSeries({ channels: [KWH], rows: [row(0, '1', '0'), row(1, '1', '2048')], convention: 'end', statusMode: 'pnp_c' })
    expect(r.channels[0].readings.map((x) => x.quality)).toEqual([0, 6])
    expect(r.statusRows).toBe(1)
  })
  it('energy per 30 min is stored as kW (× 2)', () => {
    const r = normaliseSeries({ channels: [KWH], rows: [row(0, '4.82'), row(1, '4.13')], convention: 'end', statusMode: 'none' })
    expect(r.channels[0].readings.map((x) => x.value)).toEqual([9.64, 8.26])
    expect(r.channels[0].storedUnit).toBe('kW')
  })
  it('daily files are coverage-only', () => {
    const D = 86_400_000
    const r = normaliseSeries({ channels: [KW], rows: [0, 1, 2].map((i) => ({ labelUtcMs: T0 + i * D, cells: ['100'], status: null, fileIndex: i })), convention: 'end', statusMode: 'none' })
    expect(r.intervalMin).toBe(1440)
    expect(r.channels[0].coverageOnly).toBe(true)
  })
  it('fewer than two distinct rows is an error', () => {
    expect(() => normaliseSeries({ channels: [KW], rows: [row(0, '1')], convention: 'end', statusMode: 'none' })).toThrow(/too_few_rows|at least two/)
  })
})

describe('cumulative registers', () => {
  const register = [...Array(30).keys()].map((i) => 1000 + i * 2)
  // 51 values → 50 steps, exactly one decreasing: 49 / 50 = 0.98 (the threshold is inclusive).
  const withRollover = [...register, ...[...Array(21).keys()].map((i) => 5 + i * 2)]
  it('detected over ALL rows (≥ 98 % non-decreasing, median step ≪ level)', () => {
    expect(detectCumulative(withRollover.map((v, i) => ({ tsEnd: i, value: v, quality: 0 as const })))).toBe(true)
    expect(detectCumulative(Array(60).fill(0.01).map((v, i) => ({ tsEnd: i, value: v, quality: 0 as const })))).toBe(false)
  })
  it('converted to deltas: first row missing, the rollover shown as quality 4', () => {
    const r = normaliseSeries({ channels: [KWH], rows: withRollover.map((v, i) => row(i, String(v))), convention: 'end', statusMode: 'none' })
    const ch = r.channels[0]
    expect(ch.isCumulative).toBe(true)
    expect(ch.readings[0]).toMatchObject({ value: null, quality: QUALITY.MISSING })
    expect(ch.readings[1].value).toBe(4)                                 // 2 kWh per 30 min = 4 kW
    expect(ch.readings[30]).toMatchObject({ value: null, quality: QUALITY.SPIKE })
    expect(ch.stats.rollovers).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/series`
Expected: FAIL — cannot resolve `./series`.

- [ ] **Step 3: Implement**

```ts
/**
 * Normalisation of one file's rows into per-channel reading grids (engine spec §2.1 steps 1–6).
 * Input labels are already UTC ms of the source label; `convention` says whether that label is the
 * interval's beginning (format A) or end (B/C). Output readings are stored at the interval END.
 */
import { detectLevelShifts, flagSpikesAndNegatives, medianOf } from './artefacts'
import { channelStats } from './stats'
import { MeterParseError, QUALITY, type ChannelSpec, type LevelShiftSegment, type NormalisedChannel, type QualityCode, type Quantity, type Reading, type RowOrder, type TsConvention } from './types'
import { storedUnitFor, toStoredValue } from './units'

export interface RawRow {
  labelUtcMs: number
  /** Raw cell strings, one per channel, in the same order as the channel specs. */
  cells: string[]
  status: string | null
  fileIndex: number
}

export type StatusMode = 'pnp_b' | 'pnp_c' | 'none'

export interface NormaliseInput {
  channels: ChannelSpec[]
  rows: RawRow[]
  convention: TsConvention
  statusMode: StatusMode
  decimalComma?: boolean
  intervalOverrideMin?: number
}

export interface NormaliseResult {
  intervalMin: number
  rowOrder: RowOrder
  duplicates: number
  irregularSteps: number
  calcRows: number
  statusRows: number
  channels: NormalisedChannel[]
}

export function detectRowOrder(labels: number[]): RowOrder {
  let inc = 0
  let dec = 0
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] > labels[i - 1]) inc++
    else if (labels[i] < labels[i - 1]) dec++
  }
  if (dec === 0) return 'ascending'
  if (inc === 0) return 'descending'
  return 'unordered'
}

export function detectIntervalMin(sortedUniqueLabels: number[]): number | null {
  const counts = new Map<number, number>()
  for (let i = 1; i < sortedUniqueLabels.length; i++) {
    const m = Math.round((sortedUniqueLabels[i] - sortedUniqueLabels[i - 1]) / 60_000)
    if (m > 0) counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  let best: number | null = null
  let bestN = 0
  for (const [m, n] of counts) if (n > bestN || (n === bestN && best !== null && m < best)) [best, bestN] = [m, n]
  return best
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
export function parseNumericCell(raw: string, decimalComma: boolean): number | null {
  const t = raw.trim()
  if (t === '') return null
  const s = decimalComma ? t.replace(',', '.') : t
  return NUMERIC.test(s) ? Number(s) : null
}

const isEnergyLike = (q: Quantity) => q === 'active_energy' || q === 'reactive_energy' || q === 'apparent_energy' || q === 'unknown'
const isLoadQuantity = (q: Quantity) => q === 'active_power' || q === 'active_energy' || q === 'apparent_power' || q === 'apparent_energy'

/** ≥ 98 % of steps non-decreasing over ALL present values, ≥ 50 % strictly increasing, median step ≤ 1 % of median level. */
export function detectCumulative(readings: Reading[]): boolean {
  const v = readings.filter((r) => r.value !== null).map((r) => r.value as number)
  if (v.length < 3) return false
  const steps = v.slice(1).map((x, i) => x - v[i])
  const nonDecreasing = steps.filter((s) => s >= 0).length / steps.length
  const increasing = steps.filter((s) => s > 0).length / steps.length
  const medStep = medianOf(steps) as number
  const medLevel = medianOf(v.map(Math.abs)) as number
  return nonDecreasing >= 0.98 && increasing >= 0.5 && medLevel > 0 && medStep <= 0.01 * medLevel
}

function toDeltas(readings: Reading[]): { readings: Reading[]; rollovers: number } {
  let rollovers = 0
  let prev: number | null = null
  const out = readings.map((r): Reading => {
    if (r.value === null) {
      prev = null
      return r
    }
    const current = r.value
    const p = prev
    prev = current
    if (p === null) return { ...r, value: null, quality: QUALITY.MISSING }
    const d = current - p
    if (d < 0) {
      rollovers++
      return { ...r, value: null, quality: QUALITY.SPIKE }
    }
    return { ...r, value: d }
  })
  return { readings: out, rollovers }
}

export function normaliseSeries(input: NormaliseInput): NormaliseResult {
  const rowOrder = detectRowOrder(input.rows.map((r) => r.labelUtcMs))
  const sorted = [...input.rows].sort((a, b) => a.labelUtcMs - b.labelUtcMs || a.fileIndex - b.fileIndex)
  const unique: RawRow[] = []
  const conflict = new Set<number>()
  let duplicates = 0
  for (const r of sorted) {
    const prev = unique[unique.length - 1]
    if (prev && prev.labelUtcMs === r.labelUtcMs) {
      duplicates++
      if (prev.cells.join('\u0001') !== r.cells.join('\u0001') || prev.status !== r.status) conflict.add(r.labelUtcMs)
      continue
    }
    unique.push(r)
  }
  if (unique.length < 2) throw new MeterParseError('too_few_rows', 'The file needs at least two distinct timestamps.')
  const intervalMin = input.intervalOverrideMin ?? detectIntervalMin(unique.map((r) => r.labelUtcMs))
  if (!intervalMin) throw new MeterParseError('irregular_interval', 'No interval could be determined.')
  const stepMs = intervalMin * 60_000
  const offset = input.convention === 'begin' ? stepMs : 0

  const slotRows: Array<RawRow | null> = []
  const slotLabels: number[] = []
  let irregularSteps = 0
  for (let i = 0; i < unique.length; i++) {
    if (i > 0) {
      const gap = unique[i].labelUtcMs - unique[i - 1].labelUtcMs
      if (gap > stepMs && gap % stepMs === 0) {
        for (let k = 1; k < gap / stepMs; k++) {
          slotRows.push(null)
          slotLabels.push(unique[i - 1].labelUtcMs + k * stepMs)
        }
      } else if (gap !== stepMs) irregularSteps++
    }
    slotRows.push(unique[i])
    slotLabels.push(unique[i].labelUtcMs)
  }

  let calcRows = 0
  let statusRows = 0
  for (const r of unique) {
    const s = r.status?.trim().toLowerCase() ?? null
    if (input.statusMode === 'pnp_b' && s === 'calc') calcRows++
    if (input.statusMode === 'pnp_c' && s !== null && s !== '0') statusRows++
  }

  const channels = input.channels.map((spec, ci): NormalisedChannel => {
    let readings: Reading[] = slotRows.map((r, si): Reading => {
      const tsEnd = slotLabels[si] + offset
      if (!r) return { tsEnd, value: null, quality: QUALITY.MISSING }
      const v = parseNumericCell(r.cells[ci] ?? '', !!input.decimalComma)
      if (v === null) return { tsEnd, value: null, quality: QUALITY.MISSING }
      let q: QualityCode = QUALITY.OK
      const s = r.status?.trim().toLowerCase() ?? null
      if (input.statusMode === 'pnp_b' && s !== null) {
        if (s === 'calc') {
          if (v === 0) return { tsEnd, value: null, quality: QUALITY.MISSING }
          q = QUALITY.ESTIMATED
        } else if (s !== 'ok') q = QUALITY.STATUS
      } else if (input.statusMode === 'pnp_c' && s !== null && s !== '0') q = QUALITY.STATUS
      if (conflict.has(r.labelUtcMs)) q = QUALITY.DUPLICATE
      return { tsEnd, value: v, quality: q }
    })

    const isCumulative = isEnergyLike(spec.quantity) && detectCumulative(readings)
    let rollovers = 0
    if (isCumulative) ({ readings, rollovers } = toDeltas(readings))
    readings = readings.map((r) => (r.value === null ? r : { ...r, value: toStoredValue(r.value, spec, intervalMin) }))

    let levelShifts: LevelShiftSegment[] = []
    let flags = { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0 }
    if (isLoadQuantity(spec.quantity)) {
      const ls = detectLevelShifts(readings)
      readings = ls.readings
      levelShifts = ls.segments
      const f = flagSpikesAndNegatives(readings)
      readings = f.readings
      flags = f.counts
    }
    return {
      spec,
      storedUnit: storedUnitFor(spec.quantity),
      intervalMin,
      isCumulative,
      coverageOnly: intervalMin >= 1440,
      readings,
      levelShifts,
      stats: channelStats(readings, intervalMin, {
        ...flags,
        rollovers,
        duplicateConflicts: conflict.size,
        levelShiftIntervals: levelShifts.reduce((n, s) => n + s.count, 0),
      }),
    }
  })

  return { intervalMin, rowOrder, duplicates, irregularSteps, calcRows, statusRows, channels }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/series.ts packages/shared/src/meter-data/series.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter series normalisation — ts_end grid, NULL gaps, Calc/status quality, cumulative deltas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Hashes (file sha256 and identity body hash)

**Files:**
- Create: `packages/shared/src/meter-data/hash.ts`
- Test: `packages/shared/src/meter-data/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { canonicalBody, sha256Hex } from './hash'
import type { RawRow } from './series'
import type { ChannelSpec } from './types'

const P: ChannelSpec = { sourceColumn: 'P (per kW)', columnIndex: 0, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true }

describe('sha256Hex', () => {
  it('matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('canonicalBody', () => {
  const rows: RawRow[] = [
    { labelUtcMs: 2, cells: ['0.0'], status: 'Calc', fileIndex: 0 },
    { labelUtcMs: 1, cells: ['332.2599999997765'], status: 'Ok', fileIndex: 1 },
  ]
  it('is independent of row order, preamble and numeric spelling', () => {
    const a = canonicalBody([P], rows)
    const b = canonicalBody([{ ...P, sourceColumn: 'P (per kW) ' }], [{ ...rows[1], fileIndex: 0 }, { ...rows[0], cells: ['0'], fileIndex: 1 }])
    expect(a).toBe(b)
    expect(a.split('\n')[0]).toBe('active_power:import::kW')
  })
  it('changes when a value changes', () => {
    expect(canonicalBody([P], rows)).not.toBe(canonicalBody([P], [{ ...rows[0], cells: ['0.1'] }, rows[1]]))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/hash`
Expected: FAIL — cannot resolve `./hash`.

- [ ] **Step 3: Implement**

```ts
/**
 * Identity hashes (engine spec §2.1 step 0). The FILE hash is sha256 of the bytes. The BODY hash
 * is sha256 of a canonical text of the parsed series — channel descriptors plus every row's label
 * time, values and status — so that two files with different preambles (PnP B) or an escaped copy
 * (D) of an A file hash equal when their data is equal. Web Crypto only (runs in browser and Node).
 */
import type { RawRow } from './series'
import type { ChannelSpec } from './types'

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const src = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const copy = new Uint8Array(src.byteLength)
  copy.set(src)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const normCell = (c: string) => {
  const t = c.trim()
  return t !== '' && Number.isFinite(Number(t)) ? String(Number(t)) : t
}

export function canonicalBody(channels: ChannelSpec[], rows: RawRow[]): string {
  const header = channels.map((c) => `${c.quantity}:${c.direction}:${c.phase ?? ''}:${c.sourceUnit}`).join(';')
  const body = [...rows]
    .sort((a, b) => a.labelUtcMs - b.labelUtcMs || a.fileIndex - b.fileIndex)
    .map((r) => `${r.labelUtcMs};${r.cells.map(normCell).join(';')};${r.status?.trim() ?? ''}`)
  return [header, ...body].join('\n')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/hash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/hash.ts packages/shared/src/meter-data/hash.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): file sha256 and canonical body hash for meter identity/dedup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Registers (G summary, E downloader log) and site keys

**Files:**
- Create: `packages/shared/src/meter-data/register.ts`
- Test: `packages/shared/src/meter-data/register.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mapMatchMethod, parseDownloadLog, parseRegisterCsv, parseSummaryMatrix, siteKey } from './register'
import { decodeMeterText } from './text'
import { fixture, registerFixture } from './__fixtures__/load'

const text = (b: Uint8Array) => decodeMeterText(b).text

describe('siteKey', () => {
  it('drops MALL/SQUARE/CENTRE/PLAZA suffixes', () => {
    expect(siteKey('Delta Echo Mall')).toBe('DELTAECHO')
    expect(siteKey('DELTA ECHO MALL')).toBe('DELTAECHO')
    expect(siteKey('Alpha Square Mall')).toBe('ALPHA')
    expect(siteKey('Foxtrot')).toBe(siteKey('FOXTROT MALL'))
    expect(siteKey('SITE PD')).toBe('SITEPD')
  })
})

describe('consolidation summary (G)', () => {
  it('9-column export: 26 rows with match methods', () => {
    const { rows } = parseRegisterCsv(text(registerFixture('SITE YA_Consolidation_Summary.9col.csv').bytes))
    expect(rows).toHaveLength(26)
    const by = (m: string) => rows.filter((r) => r.matchMethod === m).length
    expect([by('exact'), by('llm'), by('unmapped'), by('none')]).toEqual([9, 4, 10, 3])
    expect(rows.find((r) => r.shopNo === 'SHOP 050')).toMatchObject({
      kind: 'summary', fileName: 'SA - TENANT-23.csv', tenantName: 'TENANT-23', areaM2: 3000, matchMethod: 'exact',
    })
    expect(rows.find((r) => r.tenantName === 'TENANT-22')?.shopNo).toBe('SHOP 040,04B,L4,L007B')
    expect(rows.find((r) => r.tenantName === 'TENANT-02')?.qa).toEqual({ onDrawing: 'ON DRAWING', csvOnSite: 'NO CSV' })
  })
  it('3-column tool CSV: 20 rows, no method', () => {
    const { rows } = parseRegisterCsv(text(registerFixture('SITE YA_Consolidation_Summary.csv').bytes))
    expect(rows).toHaveLength(20)
    expect(rows.every((r) => r.matchMethod === 'none')).toBe(true)
    expect(rows.find((r) => r.tenantName === 'TENANT-24')).toMatchObject({ shopNo: null, areaM2: 21 })
  })
  it('accepts a matrix with numbers and nulls (an .xls sheet)', () => {
    const { rows } = parseSummaryMatrix([
      ['Meter Filename', 'Matched Layout Name', 'Shop Number', 'Area (sqm)', 'Status'],
      ['SA - X.csv', 'X', 'SHOP 1', 12.5, 'Gemini LLM'],
      [null, null, null, null, null],
    ])
    expect(rows).toEqual([expect.objectContaining({ tenantName: 'X', areaM2: 12.5, matchMethod: 'llm' })])
  })
  it('status vocabulary', () => {
    expect([mapMatchMethod('Direct/Substring'), mapMatchMethod('Gemini LLM'), mapMatchMethod('UNMAPPED'), mapMatchMethod(null)]).toEqual(['exact', 'llm', 'unmapped', 'none'])
  })
})

describe('downloader log (E)', () => {
  it('serial → tenant, mall (last ";" part), downloaded', () => {
    const rows = parseDownloadLog(text(fixture('e-log').bytes))
    expect(rows.length).toBeGreaterThanOrEqual(30)
    expect(rows.every((r) => r.kind === 'download_log' && /^3\d{7}$/.test(r.serial ?? ''))).toBe(true)
    expect(rows[0].tenantName).toMatch(/^TENANT-E\d{3}$/)
    expect(new Set(rows.map((r) => r.mallName))).toContain('SITE TS')
  })
  it('parses the name shapes found in the corpus', () => {
    const t = 'Serial,Name,Downloaded,Timestamp\n1,A ; DB 1 ; Alpha Square Mall,True,2026-02-01T17:16:14.4\n2,B ; Bravo Square ; MDB - 2 ; Bravo Square,False,\n3,Charlie - 3 ; Charlie,False,\n'
    expect(parseDownloadLog(t).map((r) => [r.tenantName, r.mallName, r.downloaded])).toEqual([
      ['A', 'Alpha Square Mall', true], ['B', 'Bravo Square', false], ['Charlie - 3', 'Charlie', false],
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/register`
Expected: FAIL — cannot resolve `./register`.

- [ ] **Step 3: Implement**

```ts
/**
 * Meter registers (as-is/10 §4, §6.5). A consolidation summary maps meter file → layout name →
 * shop → area with the match method as confidence; LLM and UNMAPPED rows are never auto-applied
 * (3a-ii / 3b). A downloader log maps serial → tenant ; DB ; mall and is never load data.
 */
import type { ReportIssue } from './types'
import { splitLines, splitRow } from './text'

export type MatchMethod = 'exact' | 'llm' | 'unmapped' | 'none'

export interface RegisterRow {
  kind: 'summary' | 'download_log'
  fileName: string | null
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: MatchMethod
  serial: string | null
  mallName: string | null
  downloaded: boolean | null
  qa: Record<string, string>
}

const SUFFIXES = ['MALL', 'SQUARE', 'CENTRE', 'CENTER', 'PLAZA', 'SHOPPING']

/** Canonical key for comparing site / mall names across filenames, registers and folders. */
export function siteKey(s: string): string {
  const words = s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1])) words.pop()
  return words.join('')
}

export function mapMatchMethod(status: string | null | undefined): MatchMethod {
  const s = (status ?? '').trim()
  if (s === '') return 'none'
  if (/^direct|substring/i.test(s)) return 'exact'
  if (/gemini|llm/i.test(s)) return 'llm'
  if (/^unmapped$/i.test(s)) return 'unmapped'
  return 'none'
}

type Cell = string | number | null | undefined
const str = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t === '' ? null : t
}
const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = str(v)
  return t !== null && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

export function parseSummaryMatrix(matrix: Cell[][]): { rows: RegisterRow[]; warnings: ReportIssue[] } {
  const headerIdx = matrix.findIndex((r) => r.some((c) => str(c)?.toLowerCase() === 'area (sqm)'))
  if (headerIdx < 0) return { rows: [], warnings: [{ code: 'register_file', message: 'No "Area (sqm)" header found.' }] }
  const header = matrix[headerIdx].map((c) => str(c)?.toLowerCase() ?? '')
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h))
  const c = {
    file: col('meter filename'), layout: col('matched layout name'), shopName: col('shop name'),
    shopNo: col('shop number'), area: col('area (sqm)'), status: col('status'),
    dubbel: col('dubbel'), correct: col('correct'), added: col('added'), notOn: col('not on drawings'),
  }
  const at = (r: Cell[], i: number) => (i >= 0 ? r[i] : null)
  const rows: RegisterRow[] = []
  for (const r of matrix.slice(headerIdx + 1)) {
    if (r.every((v) => str(v) === null)) continue
    const qa: Record<string, string> = {}
    const put = (k: string, i: number) => {
      const v = str(at(r, i))
      if (v !== null) qa[k] = v
    }
    put('onDrawing', c.dubbel)
    put('csvOnSite', c.correct)
    put('added', c.added)
    put('notOnDrawings', c.notOn)
    rows.push({
      kind: 'summary',
      fileName: str(at(r, c.file)),
      tenantName: str(at(r, c.layout)) ?? str(at(r, c.shopName)),
      shopNo: str(at(r, c.shopNo)),
      areaM2: num(at(r, c.area)),
      matchMethod: c.status >= 0 ? mapMatchMethod(str(at(r, c.status))) : 'none',
      serial: null, mallName: null, downloaded: null, qa,
    })
  }
  return { rows, warnings: [] }
}

export function parseRegisterCsv(text: string): { rows: RegisterRow[]; warnings: ReportIssue[] } {
  return parseSummaryMatrix(splitLines(text).map((l) => splitRow(l, ',')))
}

export function parseDownloadLog(text: string): RegisterRow[] {
  return splitLines(text)
    .slice(1)
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [serial, name, downloaded] = splitRow(l, ',')
      const parts = (name ?? '').split(/\s*;\s*/).filter((p) => p !== '')
      return {
        kind: 'download_log' as const,
        fileName: null,
        tenantName: parts[0] ?? null,
        shopNo: null,
        areaM2: null,
        matchMethod: 'none' as const,
        serial: str(serial),
        mallName: parts.length >= 2 ? parts[parts.length - 1] : null,
        downloaded: /^true$/i.test(downloaded ?? '') ? true : /^false$/i.test(downloaded ?? '') ? false : null,
        qa: {},
      }
    })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/register`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/register.ts packages/shared/src/meter-data/register.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): consolidation-summary and downloader-log registers; siteKey

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Validation report shape

**Files:**
- Create: `packages/shared/src/meter-data/report.ts`
- Test: `packages/shared/src/meter-data/report.test.ts`

The report carries every field the review dialog (functional spec §4.3 "Validation summary") shows: period, completeness, longest gap, zero runs ≥ 6 h, negatives, reset pairs, level shifts, duplicates, spikes, `24:00` rows, rollovers, `Calc` share, row order, the detected time-label convention, the daily flag, and implied W/m² with the 2–150 band. It is JSON (ISO strings, no `Float64Array`), so the server can store it in `solar.meter_import_reports.report` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { baseReport, channelReport, IMPLIED_DENSITY_BAND_W_PER_M2, issue, iso, METER_PARSER_VERSION } from './report'
import { QUALITY, type NormalisedChannel } from './types'

describe('report helpers', () => {
  it('baseReport fills every field', () => {
    const r = baseReport({ format: 'A' })
    expect(r).toMatchObject({ parserVersion: METER_PARSER_VERSION, format: 'A', rowOrder: null, errors: [], warnings: [], channels: [], impliedWPerM2: null })
    expect(r.formatLabel).toMatch(/^A:/)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
  it('band is 2–150 W/m²', () => {
    expect(IMPLIED_DENSITY_BAND_W_PER_M2).toEqual({ low: 2, high: 150 })
  })
  it('issue and iso', () => {
    expect(issue('spikes', 'x', 'p14')).toEqual({ code: 'spikes', message: 'x', column: 'p14' })
    expect(iso(Date.UTC(2025, 2, 9, 22, 30))).toBe('2025-03-09T22:30:00.000Z')
    expect(iso(null)).toBeNull()
  })
  it('channelReport converts times to ISO and keeps stats', () => {
    const ch: NormalisedChannel = {
      spec: { sourceColumn: 'p14', columnIndex: 1, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true },
      storedUnit: 'kW', intervalMin: 30, isCumulative: false, coverageOnly: false,
      readings: [{ tsEnd: 0, value: 1, quality: QUALITY.OK }],
      levelShifts: [{ startTsEnd: 0, endTsEnd: 1800000, count: 12, medianValue: 3 }],
      stats: { slots: 1, present: 1, usable: 1, estimated: 0, statusFlagged: 0, completeness: 1, firstTsEnd: 0, lastTsEnd: 0, spanDays: 0.02, longestGapHours: 0, zeroRunsOver6h: 0, spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0, rollovers: 0, duplicateConflicts: 0, levelShiftIntervals: 12, meanUsable: 1, maxUsable: 1, sumUsable: 1 },
    }
    const r = channelReport(ch)
    expect(r).toMatchObject({ column: 'p14', quantity: 'active_power', storedUnit: 'kW', intervalMin: 30 })
    expect(r.stats.first).toBe('1970-01-01T00:00:00.000Z')
    expect(r.levelShifts[0]).toEqual({ start: '1970-01-01T00:00:00.000Z', end: '1970-01-01T00:30:00.000Z', count: 12, medianValue: 3 })
    expect('readings' in r).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/report`
Expected: FAIL — cannot resolve `./report`.

- [ ] **Step 3: Implement**

```ts
import { FORMAT_LABELS, type ChannelStats, type DateOrder, type Direction, type IssueCode, type MeterFormatId, type NormalisedChannel, type Phase, type Quantity, type ReportIssue, type RowOrder, type SourceUnit, type StoredUnit, type TsConvention } from './types'

export const METER_PARSER_VERSION = '3a.1'
/** as-is/10 §6.3: median tenant 15 W/m² average, P10/P90 5/76. Warn outside, never block. */
export const IMPLIED_DENSITY_BAND_W_PER_M2 = { low: 2, high: 150 } as const

export interface ChannelReport {
  column: string
  quantity: Quantity
  direction: Direction
  phase: Phase
  sourceUnit: SourceUnit
  storedUnit: StoredUnit
  unitFromTable: boolean
  isCumulative: boolean
  coverageOnly: boolean
  intervalMin: number
  stats: Omit<ChannelStats, 'firstTsEnd' | 'lastTsEnd'> & { first: string | null; last: string | null }
  levelShifts: Array<{ start: string; end: string; count: number; medianValue: number }>
}

export interface ValidationReport {
  parserVersion: string
  format: MeterFormatId
  formatLabel: string
  encoding: string | null
  lineEnding: string | null
  delimiter: string | null
  decimalSeparator: '.' | ','
  /** 1-based line number of the header. */
  headerRow: number | null
  rowOrder: RowOrder | null
  dateOrder: DateOrder | null
  dateOrderAmbiguous: boolean
  tsConvention: TsConvention | null
  tsConventionSource: 'format' | 'user' | null
  intervalMin: number | null
  dailyInterval: boolean
  dataRows: number
  unparseableRows: number
  duplicates: number
  twentyFourHundredRows: number
  irregularSteps: number
  periodStart: string | null
  periodEnd: string | null
  spanDays: number | null
  calcShare: number | null
  calcZeroShare: number | null
  identity: { sourceSerials: string[]; filenameSerial: string | null; serialMismatch: boolean; virtual: boolean }
  channels: ChannelReport[]
  primaryColumn: string | null
  laggedChannels: Array<{ column: string; reference: string; share: number }>
  impliedWPerM2: { value: number; areaM2: number; low: number; high: number; outOfBand: boolean } | null
  errors: ReportIssue[]
  warnings: ReportIssue[]
}

export const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

export function issue(code: IssueCode, message: string, column?: string): ReportIssue {
  return column === undefined ? { code, message } : { code, message, column }
}

export function baseReport(p: Partial<ValidationReport> & { format: MeterFormatId }): ValidationReport {
  return {
    parserVersion: METER_PARSER_VERSION,
    formatLabel: FORMAT_LABELS[p.format],
    encoding: null, lineEnding: null, delimiter: null, decimalSeparator: '.', headerRow: null,
    rowOrder: null, dateOrder: null, dateOrderAmbiguous: false, tsConvention: null, tsConventionSource: null,
    intervalMin: null, dailyInterval: false, dataRows: 0, unparseableRows: 0, duplicates: 0,
    twentyFourHundredRows: 0, irregularSteps: 0, periodStart: null, periodEnd: null, spanDays: null,
    calcShare: null, calcZeroShare: null,
    identity: { sourceSerials: [], filenameSerial: null, serialMismatch: false, virtual: false },
    channels: [], primaryColumn: null, laggedChannels: [], impliedWPerM2: null, errors: [], warnings: [],
    ...p,
  }
}

export function channelReport(ch: NormalisedChannel): ChannelReport {
  const { firstTsEnd, lastTsEnd, ...rest } = ch.stats
  return {
    column: ch.spec.sourceColumn,
    quantity: ch.spec.quantity,
    direction: ch.spec.direction,
    phase: ch.spec.phase,
    sourceUnit: ch.spec.sourceUnit,
    storedUnit: ch.storedUnit,
    unitFromTable: ch.spec.unitFromTable,
    isCumulative: ch.isCumulative,
    coverageOnly: ch.coverageOnly,
    intervalMin: ch.intervalMin,
    stats: { ...rest, first: iso(firstTsEnd), last: iso(lastTsEnd) },
    levelShifts: ch.levelShifts.map((s) => ({ start: iso(s.startTsEnd) as string, end: iso(s.endTsEnd) as string, count: s.count, medianValue: s.medianValue })),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/report`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/report.ts packages/shared/src/meter-data/report.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter validation report shape (JSON, functional spec §4.3 fields)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `parseMeterFile` orchestrator + golden and synthetic tests

**Files:**
- Create: `packages/shared/src/meter-data/parse-meter-file.ts`
- Test: `packages/shared/src/meter-data/parse-meter-file.golden.test.ts`
- Test: `packages/shared/src/meter-data/parse-meter-file.synthetic.test.ts`

Every expected number below was measured on the source files while writing this plan (see Task 2's table). They are the reason the fixtures exist: a parser that doubles A files (WM's bug) gets 395 instead of 197.7; one that halves C files gets 8.3 instead of 16.6.

- [ ] **Step 1: Write the golden test (fails: no module)**

`packages/shared/src/meter-data/parse-meter-file.golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPublicHoliday } from '../lib/jbcc/sa-public-holidays'
import { applyScaleCorrection } from './artefacts'
import { parseMeterFile, type MeterParseOutcome, type SeriesOutcome } from './parse-meter-file'
import { siteKey } from './register'
import { utcMsToSast } from './timestamps'
import { isUsable, QUALITY, type NormalisedChannel } from './types'
import { fixture } from './__fixtures__/load'

const parse = (id: string) => {
  const f = fixture(id)
  return parseMeterFile({ bytes: f.bytes, fileName: f.fileName })
}
async function series(id: string): Promise<SeriesOutcome> {
  const o = await parse(id)
  if (o.kind !== 'series') throw new Error(`${id}: ${o.kind} ${JSON.stringify(o.report.errors)}`)
  return o
}
const ch = (o: SeriesOutcome, col: string): NormalisedChannel => {
  const c = o.channels.find((x) => x.spec.sourceColumn === col)
  if (!c) throw new Error(`no channel ${col}: ${o.channels.map((x) => x.spec.sourceColumn).join(', ')}`)
  return c
}
const codes = (o: MeterParseOutcome, kind: 'errors' | 'warnings') => o.report[kind].map((i) => i.code)

/** Mean of usable values whose interval STARTS on a SAST weekday that is not a public holiday. */
function weekdayMean(c: NormalisedChannel): number {
  const vals = c.readings
    .filter((r) => isUsable(r))
    .filter((r) => {
      const s = utcMsToSast(r.tsEnd - c.intervalMin * 60_000)
      const d = new Date(Date.UTC(s.year, s.month - 1, s.day))
      const w = d.getUTCDay()
      return w >= 1 && w <= 5 && !isPublicHoliday(d)
    })
    .map((r) => r.value as number)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

describe('format A', () => {
  it('canonical A: kW not kWh; interval-beginning labels stored at their end; rows re-sorted', async () => {
    const o = await series('a-bulk')
    expect(o.report).toMatchObject({ format: 'A', rowOrder: 'descending', intervalMin: 30, tsConvention: 'begin', tsConventionSource: 'format', dataRows: 672, dateOrder: 'DMY' })
    expect(o.report.errors).toEqual([])
    const p = ch(o, 'p14')
    expect(p.spec).toMatchObject({ quantity: 'active_power', direction: 'import', sourceUnit: 'kW' })
    expect(p.stats).toMatchObject({ slots: 672, present: 672, completeness: 1 })
    expect(p.readings[0].tsEnd).toBe(Date.UTC(2025, 2, 9, 22, 30))     // label 10/03/2025 00:00 SAST, + 30 min
    expect(p.readings[671].tsEnd).toBe(Date.UTC(2025, 2, 23, 22, 0))   // label 23/03 23:30 → 24/03 00:00 SAST
    expect(weekdayMean(p)).toBeCloseTo(197.7471, 3)                    // WM's client path showed 2× this
    expect(o.primaryColumn).toBe('p14')
  })

  it('reconciliation inputs: the "bulk" meter ≈ one anchor tenant ≈ the check meter', async () => {
    const bulk = ch(await series('a-bulk'), 'p14').stats.sumUsable
    expect(ch(await series('a-tenant'), 'p14').stats.sumUsable / bulk).toBeCloseTo(1.0418, 3)
    expect(ch(await series('a-check'), 'p14').stats.sumUsable / bulk).toBeCloseTo(1.0019, 3)
  })

  it('implied W/m² uses the filename area (3000 m²) and stays inside 2–150', async () => {
    const o = await series('a-tenant')
    expect(o.report.impliedWPerM2).toMatchObject({ areaM2: 3000, outOfBand: false })
    expect(o.report.impliedWPerM2?.value).toBeCloseTo(69.62, 1)
  })

  it('named-power header (generator)', async () => {
    const o = await series('a-generator')
    expect(ch(o, 'Generator Total Power').spec).toMatchObject({ quantity: 'active_power', sourceUnit: 'kW' })
    expect(o.report.dataRows).toBe(663)
    expect(ch(o, 'Generator Total Power').stats.sumUsable).toBeCloseTo(114.86, 2)
  })

  it('PV on the import channel; the "240" plant peaks higher than the "360" (labels look swapped)', async () => {
    const p240 = ch(await series('a-pv-240'), 'p14').stats.maxUsable
    const p360 = ch(await series('a-pv-360'), 'p14').stats.maxUsable
    expect(p240).toBeCloseTo(356.78, 2)
    expect(p360).toBeCloseTo(255.28, 2)
  })

  it('multi-channel PV: generation on p14, p23 ≈ 0, "Solar Total Power" is p14 one interval later', async () => {
    const o = await series('a-pv-multi')
    expect(o.channels.map((c) => [c.spec.sourceColumn, c.spec.quantity, c.spec.direction])).toEqual([
      ['p14', 'active_power', 'import'], ['p23', 'active_power', 'export'], ['Solar Total Power', 'active_power', 'import'],
    ])
    expect(o.report.rowOrder).toBe('ascending')
    expect(ch(o, 'p23').stats.sumUsable).toBeCloseTo(1.02, 2)
    expect(o.report.laggedChannels).toEqual([{ column: 'Solar Total Power', reference: 'p14', share: expect.closeTo(0.985, 3) }])
    expect(o.primaryColumn).toBe('p14')
    expect(codes(o, 'warnings')).toContain('lagged_channel')
  })

  it('reactive channels are kept (q12 / q34 → kvar)', async () => {
    const o = await series('a-reactive')
    expect(o.channels.map((c) => [c.spec.sourceColumn, c.spec.quantity, c.spec.direction, c.storedUnit])).toEqual([
      ['p14', 'active_power', 'import', 'kW'], ['p23', 'active_power', 'export', 'kW'],
      ['q12', 'reactive_power', 'import', 'kvar'], ['q34', 'reactive_power', 'export', 'kvar'],
    ])
  })

  it('voltage and current channels; negatives are only judged on load quantities', async () => {
    const o = await series('a-volts-amps')
    expect(o.report.dataRows).toBe(398)
    expect(ch(o, 'u_l2').spec).toMatchObject({ quantity: 'voltage', phase: 'l2', sourceUnit: 'V' })
    expect(ch(o, 'i_l1').spec).toMatchObject({ quantity: 'current', phase: 'l1', sourceUnit: 'A' })
    expect(ch(o, 'u_l2').stats.tinyNegatives + ch(o, 'u_l2').stats.largeNegatives).toBe(0)
  })

  it('hourly a14 energy with ±59,000 register artefacts: 8 spikes, 4 of them negative', async () => {
    const o = await series('a-energy-resets')
    const a = ch(o, 'a14')
    expect(a.spec).toMatchObject({ quantity: 'active_energy', sourceUnit: 'kWh' })
    expect(o.report.intervalMin).toBe(60)
    expect(a.stats).toMatchObject({ spikes: 8, resetPairs: 4 })
    expect(codes(o, 'warnings')).toEqual(expect.arrayContaining(['spikes', 'reset_pairs']))
  })

  it('W-scale segment: one level shift of 159 intervals, correctable by ÷ 1000', async () => {
    const o = await series('a-level-shift')
    const p = ch(o, 'p14')
    expect(p.levelShifts).toEqual([{ startTsEnd: Date.UTC(2024, 9, 6, 1, 0), endTsEnd: Date.UTC(2024, 9, 9, 8, 0), count: 159, medianValue: expect.any(Number) }])
    expect(codes(o, 'warnings')).toContain('level_shift')
    const fixed = applyScaleCorrection(p.readings, p.levelShifts[0])
    expect(Math.max(...fixed.filter(isUsable).map((r) => r.value as number))).toBeLessThan(1000)
  })

  it('hourly a14 with one +26,356 spike and one −1,710.82 isolated negative (shown, excluded)', async () => {
    const o = await series('a-hourly-negative')
    const a = ch(o, 'a14')
    expect(o.report).toMatchObject({ intervalMin: 60, rowOrder: 'unordered' })
    expect(a.stats).toMatchObject({ spikes: 1, resetPairs: 0, largeNegatives: 1, tinyNegatives: 0 })
    const neg = a.readings.find((r) => r.value === -1710.82)
    expect(neg?.quality).toBe(QUALITY.NEGATIVE)
    expect(isUsable(neg!)).toBe(false)
  })

  it('a −0.002 sentinel is clamped to 0 with quality 3 and stays usable', async () => {
    const p = ch(await series('a-tiny-negative'), 'p14')
    expect(p.stats.tinyNegatives).toBe(1)
    const r = p.readings.find((x) => x.tsEnd === Date.UTC(2024, 5, 9, 4, 30))   // label 09/06/2024 06:00 SAST + 30 min
    expect(r).toEqual({ tsEnd: Date.UTC(2024, 5, 9, 4, 30), value: 0, quality: QUALITY.NEGATIVE })
    expect(isUsable(r!)).toBe(true)
  })

  it('"sep=," only: rejected as empty', async () => {
    const o = await parse('a-empty')
    expect(o).toMatchObject({ kind: 'rejected', format: 'empty' })
    expect(codes(o, 'errors')).toEqual(['empty_file'])
  })

  it('7-day replacement file: short-window warning', async () => {
    const o = await series('a-short')
    expect(codes(o, 'warnings')).toContain('short_window')
    expect(o.report.spanDays).toBeGreaterThan(6)
    expect(o.report.spanDays).toBeLessThan(8)
  })

  it('water (Volume) is refused as load', async () => {
    const o = await parse('a-water')
    expect(o).toMatchObject({ kind: 'rejected', format: 'A' })
    expect(codes(o, 'errors')).toEqual(['water_channel'])
  })

  it('identical data at two sites has the same body hash', async () => {
    const [x, y] = [await series('a-vacant-1'), await series('a-vacant-2')]
    expect(x.bodySha256).toBe(y.bodySha256)
    expect(x.filename.siteHint).not.toBe(y.filename.siteHint)
  })
})

describe('format D (escaped copy)', () => {
  it('is rejected, and its unescaped body hashes equal to its main-folder twin', async () => {
    const d = await parse('d-escaped')
    expect(d).toMatchObject({ kind: 'rejected', format: 'D' })
    expect(codes(d, 'errors')).toEqual(['escaped_copy'])
    expect(d.kind === 'rejected' && d.bodySha256).toBe((await series('a-twin-of-d')).bodySha256)
  })
})

describe('format B (PnP power)', () => {
  it('three serials → virtual; Calc zeros are missing, not zero load', async () => {
    const o = await series('b-virtual-calc')
    expect(o.format).toBe('B')
    expect(o.sourceSerials).toHaveLength(3)
    expect(o.report.identity.virtual).toBe(true)
    expect(o.channels.map((c) => c.spec.sourceColumn)).toEqual(['P1 (per kW)', 'Q1 (per kvar)', 'P2 (per kW)', 'S (per kVA)', 'scalar sum S (per kVA)'])
    expect(o.report.tsConvention).toBe('end')
    expect(ch(o, 'P1 (per kW)').readings[0]).toEqual({ tsEnd: Date.UTC(2025, 8, 30, 22, 30), value: null, quality: QUALITY.MISSING })
    expect(o.report).toMatchObject({ calcShare: 1, calcZeroShare: 1 })
    expect(codes(o, 'errors')).toContain('low_completeness')
    expect(codes(o, 'warnings')).toContain('calc_padding')
  })

  it('mis-filed: the filename serial is not the meter; the same line-1 serial sits at another mall', async () => {
    const o = await series('b-misfiled')
    expect(o.report.identity.serialMismatch).toBe(true)
    expect(o.report.identity.filenameSerial).toMatch(/^3\d{7}$/)
    expect(o.sourceSerials).toHaveLength(1)
    expect(o.sourceSerials[0]).not.toBe(o.report.identity.filenameSerial)
    expect(codes(o, 'warnings')).toContain('serial_mismatch')
    expect((await series('b-shared-body-1')).sourceSerials).toEqual(o.sourceSerials)

    const log = await parse('e-log')
    if (log.kind !== 'register') throw new Error('e-log should be a register')
    const row = log.rows.find((r) => r.serial === o.sourceSerials[0])
    expect(row?.mallName).toBe('SITE PD')
    expect(siteKey(row!.mallName!)).not.toBe(siteKey(o.filename.siteHint!))
  })

  it('one series filed under two names at two malls: equal body hash', async () => {
    const [a, b] = [await series('b-shared-body-1'), await series('b-shared-body-2')]
    expect(a.bodySha256).toBe(b.bodySha256)
    expect(a.filename.label).not.toBe(b.filename.label)
  })

  it('half-hourly vs daily: daily files are coverage only', async () => {
    expect((await series('b-halfhourly')).report.intervalMin).toBe(30)
    const d = await series('b-daily')
    expect(d.report).toMatchObject({ intervalMin: 1440, dailyInterval: true, dataRows: 14 })
    expect(d.channels.every((c) => c.coverageOnly)).toBe(true)
    expect(codes(d, 'warnings')).toContain('daily_interval')
  })

  it('seven serials → virtual; 308 of 672 rows are Calc (estimated)', async () => {
    const o = await series('b-seven-serials')
    expect(o.sourceSerials).toHaveLength(7)
    expect(o.report.identity.virtual).toBe(true)
    expect(o.report.calcShare).toBeCloseTo(308 / 672, 6)
    expect(ch(o, 'P (per kW)').stats.estimated).toBeGreaterThan(0)
  })
})

describe('format C (PnP energy)', () => {
  it('kWh per 30 min → kW (× 2); weekday mean ≈ 16.6 kW, not 8.3', async () => {
    const o = await series('c-energy')
    expect(o.report).toMatchObject({ format: 'C', tsConvention: 'end', intervalMin: 30, rowOrder: 'ascending' })
    const p = ch(o, 'P1 (kWh)')
    expect(p.spec).toMatchObject({ quantity: 'active_energy', sourceUnit: 'kWh' })
    expect(p.storedUnit).toBe('kW')
    expect(p.readings[0].tsEnd).toBe(Date.UTC(2025, 2, 9, 22, 30))
    expect(weekdayMean(p)).toBeCloseTo(16.5766, 3)
    expect(ch(o, 'S (kVA)').spec).toMatchObject({ quantity: 'apparent_power', sourceUnit: 'kVA' })
    expect(o.primaryColumn).toBe('P1 (kWh)')
  })
  it('second sample: one interior half-hour absent → one NULL slot', async () => {
    const p = ch(await series('c-energy-2'), 'P1 (kWh)')
    expect(p.stats).toMatchObject({ slots: 672, present: 671 })
    expect(weekdayMean(p)).toBeCloseTo(75.1223, 3)
  })
})

describe('registers and artefacts', () => {
  it('E log → serial register', async () => {
    const o = await parse('e-log')
    expect(o).toMatchObject({ kind: 'register', format: 'E' })
    expect(codes(o, 'errors')).toEqual(['download_log'])
  })
  it('F derived column → rejected', async () => {
    const o = await parse('f-derived')
    expect(o).toMatchObject({ kind: 'rejected', format: 'F' })
    expect(codes(o, 'errors')).toEqual(['derived_file'])
  })
})
```

`c-energy-2`'s weekday mean (75.1223) was measured on 671 readings with the missing one excluded, exactly as `weekdayMean` does.

- [ ] **Step 2: Write the synthetic test (hand-built inputs for what the corpus lacks)**

`packages/shared/src/meter-data/parse-meter-file.synthetic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseMeterFile, type SeriesOutcome } from './parse-meter-file'
import { QUALITY } from './types'

const enc = (s: string) => new TextEncoder().encode(s)
async function series(text: string, fileName: string, options?: Parameters<typeof parseMeterFile>[0]['options']): Promise<SeriesOutcome> {
  const o = await parseMeterFile({ bytes: enc(text), fileName, options })
  if (o.kind !== 'series') throw new Error(`${o.kind}: ${JSON.stringify(o.report.errors)}`)
  return o
}
const codes = (o: SeriesOutcome, k: 'errors' | 'warnings') => o.report[k].map((i) => i.code)
const pad = (n: number) => String(n).padStart(2, '0')

describe('generic path: every choice is the user\'s', () => {
  const GENERIC = 'Timestamp;Import (kW)\n01/02/2025 00:30;12,5\n01/02/2025 01:00;\n01/02/2025 01:30;13,0\n01/02/2025 02:00;13,5\n01/02/2025 02:30;14,0\n'

  it('without confirmations: ambiguous date order, convention and unit are errors; decimal comma detected', async () => {
    const o = await series(GENERIC, 'export.csv')
    expect(o.format).toBe('generic')
    expect(o.report).toMatchObject({ delimiter: ';', decimalSeparator: ',', dateOrderAmbiguous: true })
    expect(codes(o, 'errors')).toEqual(expect.arrayContaining(['ambiguous_date_order', 'convention_required', 'unknown_unit']))
    expect(o.report.errors.find((e) => e.code === 'unknown_unit')?.message).toMatch(/suggests kW/)
    expect(o.channels[0].spec.sourceUnit).toBe('unknown')
  })

  it('with confirmations: DMY, interval-ending, kW → clean; a blank cell is NULL', async () => {
    const o = await series(GENERIC, 'export.csv', { dateOrder: 'DMY', tsConvention: 'end', units: { 'Import (kW)': 'kW' } })
    expect(o.report.errors).toEqual([])
    expect(o.report.tsConventionSource).toBe('user')
    expect(o.channels[0].readings[0]).toEqual({ tsEnd: Date.UTC(2025, 0, 31, 22, 30), value: 12.5, quality: QUALITY.OK })
    expect(o.channels[0].readings[1]).toMatchObject({ value: null, quality: QUALITY.MISSING })
  })

  it('MDY reads the same text as 2 January', async () => {
    const o = await series(GENERIC, 'export.csv', { dateOrder: 'MDY', tsConvention: 'end', units: { 'Import (kW)': 'kW' } })
    expect(o.channels[0].readings[0].tsEnd).toBe(Date.UTC(2025, 0, 1, 22, 30))
  })

  it('a day > 12 settles the order without asking', async () => {
    const o = await series('Time,kW\n12/02/2025 23:30,1\n13/02/2025 00:00,2\n13/02/2025 00:30,3\n', 'x.csv')
    expect(o.report).toMatchObject({ dateOrder: 'DMY', dateOrderAmbiguous: false })
    expect(codes(o, 'errors')).not.toContain('ambiguous_date_order')
  })

  it('a cumulative kWh register becomes interval power; the rollover is shown', async () => {
    const lines = [...Array(51).keys()].map((i) => {
      const d = new Date(Date.UTC(2025, 2, 10, 0, 30) + i * 1_800_000)
      const v = i < 30 ? 1000 + i * 2 : 5 + (i - 30) * 2
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())},${v}`
    })
    const o = await series(['Timestamp,Register (kWh)', ...lines].join('\n'), 'reg.csv', { tsConvention: 'end', units: { 'Register (kWh)': 'kWh' } })
    const c = o.channels[0]
    expect(c.isCumulative).toBe(true)
    expect(c.readings[1].value).toBe(4)
    expect(c.stats.rollovers).toBe(1)
    expect(codes(o, 'warnings')).toContain('rollover')
  })
})

describe('recognised formats: synthetic cases', () => {
  const aDay = (value: number) => {
    const rows = [...Array(48).keys()].map((i) => {
      const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${value}`
    })
    return 'sep=,\r\n\r\ndate,p14\r\n' + rows.reverse().join('\r\n') + '\r\n'
  }

  it('an A file labelled p14 but carrying kWh: implied density out of band is the evidence', async () => {
    const o = await series(aDay(2.5), 'SITE SY, 1, TENANT-S1, 5000.csv')
    expect(o.report.impliedWPerM2).toMatchObject({ value: 0.5, areaM2: 5000, outOfBand: true })
    expect(codes(o, 'warnings')).toEqual(expect.arrayContaining(['implied_density_out_of_band', 'short_window']))
    expect(o.report.errors).toEqual([])
  })

  it('the user can override the table unit; it is recorded', async () => {
    const o = await series(aDay(2.5), 'SITE SY, 1, TENANT-S1, 5000.csv', { units: { p14: 'kWh' } })
    expect(o.channels[0].spec).toMatchObject({ sourceUnit: 'kWh', quantity: 'active_energy', unitFromTable: false })
    expect(o.channels[0].readings[0].value).toBe(5)
    expect(codes(o, 'warnings')).toContain('unit_overridden')
  })

  it('a PnP B file with a 24:00 row', async () => {
    const t = [
      '"pnpscada.com", "30000001"',
      '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"',
      '10.0, 1.0, 10.05, 10.05, 2025-03-10, 23:00:00, Ok',
      '11.0, 1.0, 11.05, 11.05, 2025-03-10, 23:30:00, Ok',
      '12.0, 1.0, 12.04, 12.04, 2025-03-10, 24:00:00, Ok',
      '13.0, 1.0, 13.04, 13.04, 2025-03-11, 00:30:00, Ok',
    ].join('\r\n')
    const o = await series(t, 'SITE SY, , Meter 30000001, .csv')
    expect(o.report.twentyFourHundredRows).toBe(1)
    expect(o.report.identity.serialMismatch).toBe(false)
    expect(o.channels[0].readings.map((r) => [r.tsEnd, r.value])).toEqual([
      [Date.UTC(2025, 2, 10, 21, 0), 10], [Date.UTC(2025, 2, 10, 21, 30), 11],
      [Date.UTC(2025, 2, 10, 22, 0), 12], [Date.UTC(2025, 2, 10, 22, 30), 13],
    ])
  })

  it('more than 1 % unreadable timestamps is an error', async () => {
    const o = await parseMeterFile({ bytes: enc('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\nnot a date,3\r\n'), fileName: 'x.csv' })
    expect(o.report.errors.map((e) => e.code)).toContain('unparseable_timestamps')
  })

  it('.xls and .xlsx are routed, not parsed as text', async () => {
    const xls = await parseMeterFile({ bytes: enc('x'), fileName: 'SITE YA_Consolidation_Summary.xls' })
    expect(xls).toMatchObject({ kind: 'rejected', format: 'G' })
    expect(xls.report.errors[0].code).toBe('xls_not_supported')
    const xlsx = await parseMeterFile({ bytes: enc('x'), fileName: 'book.xlsx' })
    expect(xlsx.report.errors[0].code).toBe('workbook_file')
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @esite/shared test -- meter-data/parse-meter-file`
Expected: FAIL — cannot resolve `./parse-meter-file`.

- [ ] **Step 4: Implement `parse-meter-file.ts`**

```ts
/**
 * parseMeterFile: one file in, one outcome out (engine spec §2.1; as-is/10 §6.1).
 * Pure. bytes + name (+ the user's confirmations) → series | register | rejected, each with a report.
 * The server re-runs it at commit time with the confirmed options; it never trusts a client parse.
 */
import { laggedDuplicateShare } from './artefacts'
import { parseMeterFilename, type ParsedFilename } from './filename'
import { canonicalBody, sha256Hex } from './hash'
import { parseDownloadLog, parseRegisterCsv, type RegisterRow } from './register'
import { baseReport, channelReport, IMPLIED_DENSITY_BAND_W_PER_M2, iso, issue, type ValidationReport } from './report'
import { normaliseSeries, parseNumericCell, type NormaliseResult, type RawRow, type StatusMode } from './series'
import { GENERIC_TS_RE, sniffMeterText, type SniffResult } from './sniff'
import { decodeMeterText, splitLines, splitRow, type DecodedText } from './text'
import { detectDateOrder, parseLabelA, parseLabelB, parseLabelC, parseLabelGeneric, type ParsedLabel } from './timestamps'
import { MeterParseError, type ChannelSpec, type DateOrder, type IssueCode, type MeterFormatId, type NormalisedChannel, type ReportIssue, type SourceUnit, type TsConvention } from './types'
import { mapColumnA, mapColumnB, mapColumnC, mapColumnGeneric, suggestUnitFromHeader, withUnit, type NonChannelColumn } from './units'

export interface ParseOptions {
  /** Generic path only: the confirmed file-level date order. */
  dateOrder?: DateOrder
  /** Generic path only: whether labels mark the start or the end of the interval. A/B/C are fixed. */
  tsConvention?: TsConvention
  /** Per source column: a unit chosen by the user (required on the generic path; an override elsewhere). */
  units?: Record<string, SourceUnit>
  /** Area for the implied W/m² check; defaults to the filename hint. */
  areaM2?: number | null
}

export interface SeriesOutcome {
  kind: 'series'
  format: 'A' | 'B' | 'C' | 'generic'
  fileSha256: string
  bodySha256: string
  filename: ParsedFilename
  sourceSerials: string[]
  channels: NormalisedChannel[]
  primaryColumn: string | null
  report: ValidationReport
}
export interface RegisterOutcome {
  kind: 'register'
  format: 'E' | 'G'
  fileSha256: string
  filename: ParsedFilename
  rows: RegisterRow[]
  report: ValidationReport
}
export interface RejectedOutcome {
  kind: 'rejected'
  format: MeterFormatId
  fileSha256: string
  bodySha256: string | null
  filename: ParsedFilename
  report: ValidationReport
}
export type MeterParseOutcome = SeriesOutcome | RegisterOutcome | RejectedOutcome

const XLS_MESSAGE =
  'Legacy .xls workbooks in this corpus are consolidation summaries, not meter data. Save it as CSV (Excel: File, Save As, CSV UTF-8) and use Import meter register.'

function rejected(format: MeterFormatId, fileSha256: string, bodySha256: string | null, filename: ParsedFilename, report: ValidationReport): RejectedOutcome {
  return { kind: 'rejected', format, fileSha256, bodySha256, filename, report }
}

export async function parseMeterFile(input: { bytes: Uint8Array; fileName: string; options?: ParseOptions }): Promise<MeterParseOutcome> {
  const options = input.options ?? {}
  const fileSha256 = await sha256Hex(input.bytes)
  const filename = parseMeterFilename(input.fileName)
  if (filename.extension === 'xls') {
    return rejected('G', fileSha256, null, filename, baseReport({ format: 'G', errors: [issue('xls_not_supported', XLS_MESSAGE)] }))
  }
  if (filename.extension === 'xlsx') {
    return rejected('generic', fileSha256, null, filename, baseReport({ format: 'generic', errors: [issue('workbook_file', 'Workbooks are read sheet by sheet with parseMeterWorkbook.')] }))
  }

  const decoded = decodeMeterText(input.bytes)
  const common = { encoding: decoded.encoding, lineEnding: decoded.lineEnding }
  const warnings: ReportIssue[] = decoded.encoding === 'latin1' ? [issue('latin1_encoding', 'The file is not valid UTF-8; it was read as Windows-1252.')] : []
  const sniff = sniffMeterText(decoded.text)

  switch (sniff.format) {
    case 'empty':
      return rejected('empty', fileSha256, null, filename, baseReport({
        ...common, format: 'empty', warnings,
        errors: [sniff.reason === 'header_only' ? issue('header_only', 'The file has a header but no data rows.') : issue('empty_file', 'The file holds no data.')],
      }))
    case 'D':
      return parseEscapedCopy(decoded, fileSha256, filename, warnings)
    case 'E':
      return {
        kind: 'register', format: 'E', fileSha256, filename, rows: parseDownloadLog(decoded.text),
        report: baseReport({ ...common, format: 'E', delimiter: ',', headerRow: 1, warnings, errors: [issue('download_log', 'A batch-downloader log: import it as a serial register, never as load data.')] }),
      }
    case 'G': {
      const reg = parseRegisterCsv(decoded.text)
      return {
        kind: 'register', format: 'G', fileSha256, filename, rows: reg.rows,
        report: baseReport({ ...common, format: 'G', delimiter: ',', headerRow: 1, warnings: [...warnings, ...reg.warnings], errors: [issue('register_file', 'A consolidation summary: use Import meter register.')] }),
      }
    }
    case 'F':
      return rejected('F', fileSha256, null, filename, baseReport({ ...common, format: 'F', warnings, errors: [issue('derived_file', 'A derived working column from a hand analysis, not a meter export.')] }))
    default:
      return parseSeries(decoded, sniff, fileSha256, filename, options, warnings)
  }
}

async function parseEscapedCopy(decoded: DecodedText, fileSha256: string, filename: ParsedFilename, warnings: ReportIssue[]): Promise<RejectedOutcome> {
  const lines = splitLines(decoded.text.replace(/\\n/g, '\n'))
  const h = lines.findIndex((l) => /^date,/i.test(l))
  let bodySha256: string | null = null
  if (h >= 0) {
    const header = splitRow(lines[h], ',')
    const specs = header.map((x, k) => ({ x, k })).filter((c) => c.k > 0 && c.x !== '').map((c) => mapColumnA(c.x, c.k))
    const rows: RawRow[] = []
    lines.slice(h + 1).forEach((l, fileIndex) => {
      if (l.trim() === '') return
      const cells = splitRow(l, ',')
      const label = parseLabelA(cells[0] ?? '')
      if (label) rows.push({ labelUtcMs: label.utcMs, cells: specs.map((s) => cells[s.columnIndex] ?? ''), status: null, fileIndex })
    })
    bodySha256 = await sha256Hex(canonicalBody(specs, rows))
  }
  return rejected('D', fileSha256, bodySha256, filename, baseReport({
    format: 'D', encoding: decoded.encoding, lineEnding: decoded.lineEnding, warnings,
    errors: [issue('escaped_copy', 'A single-line copy of another export with escaped line breaks. Import the original file instead.')],
  }))
}

interface Layout {
  specs: ChannelSpec[]
  labelOf: (cells: string[]) => ParsedLabel | null
  statusCol: number | null
  statusMode: StatusMode
  convention: TsConvention
  conventionSource: 'format' | 'user'
  dateOrder: DateOrder
  dateOrderAmbiguous: boolean
  decimalComma: boolean
  errors: ReportIssue[]
}

const isSpec = (x: ChannelSpec | NonChannelColumn): x is ChannelSpec => typeof x !== 'string'

function resolveLayout(format: 'A' | 'B' | 'C' | 'generic', header: string[], sample: string[][], delimiter: string, options: ParseOptions): Layout {
  const fixed = { conventionSource: 'format' as const, dateOrderAmbiguous: false, decimalComma: false, errors: [] as ReportIssue[] }
  if (format === 'A') {
    return {
      ...fixed,
      specs: header.map((h, k) => ({ h, k })).filter((c) => c.k > 0 && c.h.trim() !== '').map((c) => mapColumnA(c.h, c.k)),
      labelOf: (c) => parseLabelA(c[0] ?? ''),
      statusCol: null, statusMode: 'none', convention: 'begin', dateOrder: 'DMY',
    }
  }
  if (format === 'B') {
    const mapped = header.map((h, k) => mapColumnB(h, k))
    const dateCol = mapped.indexOf('date')
    const timeCol = mapped.indexOf('time')
    const statusCol = mapped.indexOf('status')
    return {
      ...fixed,
      specs: mapped.filter(isSpec),
      labelOf: (c) => parseLabelB(c[dateCol] ?? '', c[timeCol] ?? ''),
      statusCol: statusCol >= 0 ? statusCol : null, statusMode: 'pnp_b', convention: 'end', dateOrder: 'YMD',
    }
  }
  if (format === 'C') {
    const mapped = header.map((h, k) => mapColumnC(h, k))
    const tsCol = mapped.indexOf('timestamp')
    const statusCol = mapped.indexOf('status')
    return {
      ...fixed,
      specs: mapped.filter(isSpec),
      labelOf: (c) => parseLabelC(c[tsCol] ?? ''),
      statusCol: statusCol >= 0 ? statusCol : null, statusMode: 'pnp_c', convention: 'end', dateOrder: 'YMD',
    }
  }
  const errors: ReportIssue[] = []
  const share = (k: number) => sample.filter((r) => GENERIC_TS_RE.test((r[k] ?? '').trim())).length / Math.max(1, sample.length)
  const tsCol = header.findIndex((_, k) => share(k) >= 0.9)
  if (tsCol < 0) throw new MeterParseError('unparseable_timestamps', 'No column holds a readable timestamp in at least 90 % of rows.')
  const det = detectDateOrder(sample.map((r) => r[tsCol] ?? ''))
  const dateOrder = options.dateOrder ?? det.order ?? 'DMY'
  if (!options.dateOrder && det.order === null) {
    errors.push(issue('ambiguous_date_order', 'Every day and month in the file is 12 or less, so the date order cannot be told from the data. Confirm DD/MM or MM/DD.'))
  }
  const convention = options.tsConvention ?? 'end'
  if (!options.tsConvention) errors.push(issue('convention_required', 'Confirm whether each timestamp marks the start or the end of its interval.'))
  const decimalComma = delimiter !== ',' && sample.some((r) => r.some((c, k) => k !== tsCol && /^-?\d+,\d+$/.test(c.trim())))
  return {
    specs: header.map((h, k) => ({ h, k })).filter((c) => c.k !== tsCol && c.h.trim() !== '').map((c) => mapColumnGeneric(c.h, c.k)),
    labelOf: (c) => parseLabelGeneric(c[tsCol] ?? '', dateOrder),
    statusCol: null, statusMode: 'none', convention, conventionSource: 'user', dateOrder,
    dateOrderAmbiguous: det.order === null, decimalComma, errors,
  }
}

/** The channel carrying the energy: active import (never a lagged copy), largest energy wins. */
function choosePrimary(channels: NormalisedChannel[], lagged: Set<string>): string | null {
  const cands = channels.filter((c) => (c.spec.quantity === 'active_power' || c.spec.quantity === 'active_energy') && !lagged.has(c.spec.sourceColumn))
  const pool = cands.some((c) => c.spec.direction === 'import') ? cands.filter((c) => c.spec.direction === 'import') : cands
  if (pool.length === 0) return channels.find((c) => c.spec.quantity === 'unknown')?.spec.sourceColumn ?? null
  return pool.reduce((a, b) => (Math.abs(b.stats.sumUsable) > Math.abs(a.stats.sumUsable) ? b : a)).spec.sourceColumn
}

async function parseSeries(decoded: DecodedText, sniff: SniffResult, fileSha256: string, filename: ParsedFilename, options: ParseOptions, warnings: ReportIssue[]): Promise<MeterParseOutcome> {
  const format = sniff.format as 'A' | 'B' | 'C' | 'generic'
  const common = {
    encoding: decoded.encoding, lineEnding: decoded.lineEnding, delimiter: sniff.delimiter,
    headerRow: sniff.headerLineIndex === null ? null : sniff.headerLineIndex + 1,
  }
  const reject = (code: IssueCode, message: string) =>
    rejected(format, fileSha256, null, filename, baseReport({ ...common, format, warnings, errors: [issue(code, message)] }))
  if (sniff.delimiter === null || sniff.headerLineIndex === null || sniff.dataStartIndex === null) {
    return reject('no_header', 'No header row followed by timestamped data was found.')
  }
  const delimiter = sniff.delimiter
  const lines = splitLines(decoded.text)
  const header = splitRow(lines[sniff.headerLineIndex], delimiter)
  const data = lines.slice(sniff.dataStartIndex).filter((l) => l.trim() !== '').map((l) => splitRow(l, delimiter))

  let layout: Layout
  try {
    layout = resolveLayout(format, header, data.slice(0, 50), delimiter, options)
  } catch (e) {
    if (e instanceof MeterParseError) return reject(e.code, e.message)
    throw e
  }
  const water = layout.specs.find((s) => s.quantity === 'volume')
  if (water) return reject('water_channel', `Column "${water.sourceColumn}" is a water (volume) meter, not electrical load.`)

  const errors = [...layout.errors]
  const tableSpecs = layout.specs
  const specs = tableSpecs.map((s) => {
    const u = options.units?.[s.sourceColumn]
    if (!u) return s
    if (s.unitFromTable && u !== s.sourceUnit) {
      warnings.push(issue('unit_overridden', `Unit of "${s.sourceColumn}" changed from ${s.sourceUnit} to ${u} by the user.`, s.sourceColumn))
    }
    return withUnit(s, u)
  })
  for (const s of specs) {
    if (s.sourceUnit !== 'unknown') continue
    const hint = suggestUnitFromHeader(s.sourceColumn)
    errors.push(issue('unknown_unit', `Choose a unit for "${s.sourceColumn}"${hint ? ` (the header suggests ${hint})` : ''}. Units are never assumed.`, s.sourceColumn))
  }

  const rows: RawRow[] = []
  let unparseable = 0
  let t2400 = 0
  data.forEach((cells, fileIndex) => {
    const label = layout.labelOf(cells)
    if (!label) {
      unparseable++
      return
    }
    if (label.was2400) t2400++
    rows.push({
      labelUtcMs: label.utcMs,
      cells: specs.map((s) => cells[s.columnIndex] ?? ''),
      status: layout.statusCol === null ? null : (cells[layout.statusCol] ?? null),
      fileIndex,
    })
  })
  if (data.length > 0 && unparseable / data.length > 0.01) {
    errors.push(issue('unparseable_timestamps', `${unparseable} of ${data.length} rows have a timestamp that could not be read.`))
  } else if (unparseable > 0) {
    warnings.push(issue('unparseable_timestamps', `${unparseable} row(s) skipped: unreadable timestamp.`))
  }

  let norm: NormaliseResult
  try {
    norm = normaliseSeries({ channels: specs, rows, convention: layout.convention, statusMode: layout.statusMode, decimalComma: layout.decimalComma })
  } catch (e) {
    if (e instanceof MeterParseError) return reject(e.code, e.message)
    throw e
  }
  // Identity hash from the TABLE specs, so a user's unit override never changes a file's identity.
  const bodySha256 = await sha256Hex(canonicalBody(tableSpecs, rows))

  const lagged: Array<{ column: string; reference: string; share: number }> = []
  const active = norm.channels.filter((c) => c.spec.quantity === 'active_power' && c.spec.direction === 'import')
  for (const a of active) {
    for (const b of active) {
      if (a === b) continue
      const share = laggedDuplicateShare(a.readings, b.readings)
      if (share !== null && share >= 0.9) lagged.push({ column: b.spec.sourceColumn, reference: a.spec.sourceColumn, share })
    }
  }
  for (const l of lagged) {
    warnings.push(issue('lagged_channel', `"${l.column}" repeats "${l.reference}" one interval later (${(l.share * 100).toFixed(1)} % of steps), so its time label follows the other convention. It is never used as the primary channel.`, l.column))
  }
  const primaryColumn = choosePrimary(norm.channels, new Set(lagged.map((l) => l.column)))
  const primary = norm.channels.find((c) => c.spec.sourceColumn === primaryColumn) ?? null

  const sourceSerials = sniff.serials
  const serialMismatch = filename.serialHint !== null && sourceSerials.length > 0 && !sourceSerials.includes(filename.serialHint)
  if (serialMismatch) {
    warnings.push(issue('serial_mismatch', `The file name says meter ${filename.serialHint}; the file holds ${sourceSerials.join(', ')}. The serial inside the file is the meter.`))
  }
  if (norm.intervalMin >= 1440) {
    warnings.push(issue('daily_interval', 'Daily averages: counted as coverage only, never used for the hourly profile or maximum demand.'))
  } else if (![5, 10, 15, 30, 60].includes(norm.intervalMin) || norm.irregularSteps > 0) {
    warnings.push(issue('irregular_interval', `Interval ${norm.intervalMin} min with ${norm.irregularSteps} irregular step(s).`))
  }
  if (norm.duplicates > 0) warnings.push(issue('duplicate_timestamps', `${norm.duplicates} duplicate timestamp(s); the first of each was kept.`))
  for (const c of norm.channels) {
    const s = c.stats
    const col = c.spec.sourceColumn
    if (c.levelShifts.length > 0) {
      warnings.push(issue('level_shift', `${s.levelShiftIntervals} readings in ${c.levelShifts.length} segment(s) are about 1,000 times the rest (W recorded as kW?). Excluded unless you confirm dividing them by 1,000.`, col))
    }
    if (s.spikes - s.resetPairs > 0) warnings.push(issue('spikes', `${s.spikes - s.resetPairs} spike(s) excluded.`, col))
    if (s.resetPairs > 0) warnings.push(issue('reset_pairs', `${s.resetPairs} large negative register artefact(s) excluded.`, col))
    if (s.tinyNegatives > 0) warnings.push(issue('tiny_negatives', `${s.tinyNegatives} tiny negative value(s) clamped to 0.`, col))
    if (s.largeNegatives > 0) warnings.push(issue('large_negatives', `${s.largeNegatives} negative value(s) shown but excluded.`, col))
    if (s.rollovers > 0) warnings.push(issue('rollover', `${s.rollovers} register decrease(s): a rollover or a meter exchange.`, col))
  }
  if (format === 'B' && norm.calcRows > 0) {
    warnings.push(issue('calc_padding', `${norm.calcRows} of ${rows.length} rows are PnP "Calc" (estimated); exact zeros among them are treated as missing.`))
  }
  if (format === 'C' && norm.statusRows > 0) {
    warnings.push(issue('status_codes_unmapped', `${norm.statusRows} row(s) carry a status code other than 0; their meaning is not documented, so they are excluded.`))
  }
  if (primary) {
    if (primary.stats.completeness < 0.5) {
      errors.push(issue('low_completeness', `Only ${(primary.stats.completeness * 100).toFixed(1)} % of intervals of "${primary.spec.sourceColumn}" hold data.`, primary.spec.sourceColumn))
    }
    if (primary.stats.spanDays < 30) {
      warnings.push(issue('short_window', `Only ${primary.stats.spanDays.toFixed(1)} days of data: usable as a shape sample, not as a year.`))
    }
  }

  const area = options.areaM2 ?? filename.areaM2Hint
  let impliedWPerM2: ValidationReport['impliedWPerM2'] = null
  if (primary && !primary.coverageOnly && primary.storedUnit === 'kW' && primary.stats.meanUsable !== null && area !== null && area > 0) {
    const { low, high } = IMPLIED_DENSITY_BAND_W_PER_M2
    const value = (primary.stats.meanUsable * 1000) / area
    const outOfBand = value < low || value > high
    impliedWPerM2 = { value, areaM2: area, low, high, outOfBand }
    if (outOfBand) {
      warnings.push(issue('implied_density_out_of_band', `Average ${value.toFixed(1)} W/m² over ${area} m² is outside ${low}–${high} W/m². Check the unit (kW or kWh) and the area.`))
    }
  }

  const primaryIdx = primary ? specs.indexOf(primary.spec) : -1
  const calcRowsList = format === 'B' ? rows.filter((r) => r.status?.trim().toLowerCase() === 'calc') : []
  const calcShare = format === 'B' && rows.length > 0 ? calcRowsList.length / rows.length : null
  const calcZeroShare =
    format === 'B' && rows.length > 0 && primaryIdx >= 0
      ? calcRowsList.filter((r) => parseNumericCell(r.cells[primaryIdx] ?? '', false) === 0).length / rows.length
      : null
  const firsts = norm.channels.map((c) => c.stats.firstTsEnd).filter((x): x is number => x !== null)
  const lasts = norm.channels.map((c) => c.stats.lastTsEnd).filter((x): x is number => x !== null)

  const report = baseReport({
    ...common,
    format,
    decimalSeparator: layout.decimalComma ? ',' : '.',
    rowOrder: norm.rowOrder,
    dateOrder: layout.dateOrder,
    dateOrderAmbiguous: layout.dateOrderAmbiguous,
    tsConvention: layout.convention,
    tsConventionSource: layout.conventionSource,
    intervalMin: norm.intervalMin,
    dailyInterval: norm.intervalMin >= 1440,
    dataRows: rows.length,
    unparseableRows: unparseable,
    duplicates: norm.duplicates,
    twentyFourHundredRows: t2400,
    irregularSteps: norm.irregularSteps,
    periodStart: iso(firsts.length ? Math.min(...firsts) : null),
    periodEnd: iso(lasts.length ? Math.max(...lasts) : null),
    spanDays: primary?.stats.spanDays ?? null,
    calcShare,
    calcZeroShare,
    identity: { sourceSerials, filenameSerial: filename.serialHint, serialMismatch, virtual: sourceSerials.length > 1 },
    channels: norm.channels.map(channelReport),
    primaryColumn,
    laggedChannels: lagged,
    impliedWPerM2,
    errors,
    warnings,
  })
  return { kind: 'series', format, fileSha256, bodySha256, filename, sourceSerials, channels: norm.channels, primaryColumn, report }
}
```

- [ ] **Step 5: Run to verify both pass**

Run: `pnpm --filter @esite/shared test -- meter-data/parse-meter-file`
Expected: PASS (golden + synthetic). If a golden number is off, the bug is in the code: every expected value was measured on the source files independently of this implementation. Do not edit the expectation to match the code.

- [ ] **Step 6: Mutation check (prove the golden tests can fail)**

Temporarily change `case 'kWh': case 'kvarh': case 'kVAh': return v * perHour` in `units.ts` to `return v`. Run `pnpm --filter @esite/shared test -- meter-data/parse-meter-file.golden`. Expected: the C test fails (`8.29 ≠ 16.58`). Revert. Then temporarily change `const offset = input.convention === 'begin' ? stepMs : 0` in `series.ts` to `const offset = 0`. Expected: the canonical-A and level-shift tests fail. Revert, rerun, PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/meter-data/parse-meter-file.ts packages/shared/src/meter-data/parse-meter-file.golden.test.ts packages/shared/src/meter-data/parse-meter-file.synthetic.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): parseMeterFile — formats A/B/C/generic to channels + report; D/E/F/G routed

Golden tests on the anonymised corpus fixtures (kW-not-kWh, C x2, Calc
zeros missing, identity/body hash, level shift, resets, lagged channel)
plus synthetic cases for the generic path, 24:00 and unit override.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Workbook sheets (.xlsx)

**Files:**
- Create: `packages/shared/src/meter-data/workbook.ts`
- Test: `packages/shared/src/meter-data/workbook.test.ts`

The only `.xlsx` in the corpus is a hand analysis whose column `kwh <tenant>` is `=A3+A4`: two kW half-hours added and labelled kWh (as-is/10 §2.4, N7). Formula columns are therefore dropped from every sheet and reported, never imported.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { sha256Hex } from './hash'
import { parseMeterWorkbook } from './workbook'

async function book(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('PnP')
  ws.addRow(['pnpscada.com', '30000002'])
  ws.addRow(['P (per kW)', 'Q (per kvar)', 'S (per kVA)', 'scalar sum S (per kVA)', 'DATE', 'TIME', 'STATUS', 'kwh tenant'])
  for (let i = 0; i < 4; i++) {
    ws.addRow([10 + i, 1, 10 + i, 10 + i, '2025-03-10', `${String(i + 1).padStart(2, '0')}:00:00`, 'Ok', { formula: `A${i + 3}+A${i + 4}` }])
  }
  const notes = wb.addWorksheet('Notes')
  notes.addRow(['Average of kwh'])
  notes.addRow(['by time of day'])
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

describe('parseMeterWorkbook', () => {
  it('reads each sheet; formula columns are dropped and warned', async () => {
    const bytes = await book()
    const sheets = await parseMeterWorkbook({ bytes, fileName: 'SITE PD, , PDB_30000002_TENANT-97, .xlsx' })
    expect(sheets.map((s) => s.sheetName)).toEqual(['PnP', 'Notes'])

    const pnp = sheets[0]
    expect(pnp.formulaColumns).toEqual(['H'])
    expect(pnp.outcome.kind).toBe('series')
    if (pnp.outcome.kind !== 'series') return
    expect(pnp.outcome.format).toBe('B')
    expect(pnp.outcome.channels.map((c) => c.spec.sourceColumn)).toEqual(['P (per kW)', 'Q (per kvar)', 'S (per kVA)', 'scalar sum S (per kVA)'])
    expect(pnp.outcome.report.warnings.map((w) => w.code)).toContain('formula_columns')
    expect(pnp.outcome.fileSha256).toBe(await sha256Hex(bytes))

    expect(sheets[1].outcome.kind).toBe('rejected')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- meter-data/workbook`
Expected: FAIL — cannot resolve `./workbook`.

- [ ] **Step 3: Implement**

```ts
/**
 * .xlsx meter workbooks: each sheet is written back to CSV text and sniffed with the same rules.
 * Formula columns are hand-added analysis (as-is/10 N7) and are never imported.
 */
import ExcelJS, { type CellValue } from 'exceljs'
import { sha256Hex } from './hash'
import { parseMeterFile, type MeterParseOutcome, type ParseOptions } from './parse-meter-file'
import { issue } from './report'

export interface WorkbookSheetOutcome {
  sheetName: string
  formulaColumns: string[]
  outcome: MeterParseOutcome
}

const pad = (n: number) => String(n).padStart(2, '0')

function colLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return v
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`
  }
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('')
  if (typeof v === 'object' && 'result' in v) return cellText((v as { result?: CellValue }).result ?? null)
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text)
  return ''
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export async function parseMeterWorkbook(input: { bytes: Uint8Array; fileName: string; options?: ParseOptions }): Promise<WorkbookSheetOutcome[]> {
  const workbookSha = await sha256Hex(input.bytes)
  const wb = new ExcelJS.Workbook()
  const copy = new Uint8Array(input.bytes.byteLength)
  copy.set(input.bytes)
  // exceljs types declare Buffer; an ArrayBuffer is accepted at runtime in Node and the browser.
  await wb.xlsx.load(copy.buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const csvName = input.fileName.replace(/\.xlsx$/i, '.csv')
  const out: WorkbookSheetOutcome[] = []
  for (const ws of wb.worksheets) {
    const formulaCols = new Set<number>()
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulaCols.add(col)
      })
    })
    const lines: string[] = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = []
      for (let col = 1; col <= ws.columnCount; col++) {
        if (formulaCols.has(col)) continue
        cells.push(csvCell(cellText(row.getCell(col).value)))
      }
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      lines.push(cells.join(','))
    })
    const outcome = await parseMeterFile({ bytes: new TextEncoder().encode(lines.join('\n') + '\n'), fileName: csvName, options: input.options })
    outcome.fileSha256 = workbookSha
    const formulaColumns = [...formulaCols].sort((a, b) => a - b).map(colLetter)
    if (formulaColumns.length > 0) {
      outcome.report.warnings.push(issue('formula_columns', `Formula column(s) ${formulaColumns.join(', ')} were left out: hand-added analysis is not meter data.`))
    }
    out.push({ sheetName: ws.name, formulaColumns, outcome })
  }
  return out
}
```

Note: trailing empty cells are trimmed per row, so the PnP line-1 preamble comes out as `pnpscada.com,30000002` and `sniffMeterText` recognises it (B vs C is decided by the header line).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- meter-data/workbook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/meter-data/workbook.ts packages/shared/src/meter-data/workbook.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): .xlsx meter workbooks sheet by sheet; formula columns dropped and warned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Meter-data barrel and the env-gated corpus smoke test

**Files:**
- Create: `packages/shared/src/meter-data/index.ts`
- Test: `packages/shared/src/meter-data/corpus.smoke.test.ts`

- [ ] **Step 1: Write the barrel**

```ts
export * from './types'
export * from './text'
export * from './filename'
export * from './sniff'
export * from './units'
export * from './timestamps'
export * from './stats'
export * from './artefacts'
export * from './series'
export * from './hash'
export * from './register'
export * from './report'
export * from './parse-meter-file'
export * from './workbook'
```

- [ ] **Step 2: Write the smoke test (whole real files; skipped unless `METER_CORPUS_DIR` is set)**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPublicHoliday } from '../lib/jbcc/sa-public-holidays'
import { parseMeterFile } from './parse-meter-file'
import { utcMsToSast } from './timestamps'
import { isUsable, type NormalisedChannel } from './types'

const DIR = process.env.METER_CORPUS_DIR

function weekdayMean(c: NormalisedChannel): number {
  const v = c.readings.filter(isUsable).filter((r) => {
    const s = utcMsToSast(r.tsEnd - c.intervalMin * 60_000)
    const d = new Date(Date.UTC(s.year, s.month - 1, s.day))
    return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !isPublicHoliday(d)
  }).map((r) => r.value as number)
  return v.reduce((a, b) => a + b, 0) / v.length
}

async function whole(rel: string) {
  const bytes = new Uint8Array(readFileSync(join(DIR as string, rel)))
  const o = await parseMeterFile({ bytes, fileName: rel.split('/').pop() as string })
  if (o.kind !== 'series') throw new Error(`${rel}: ${o.kind}`)
  return o
}

describe.skipIf(!DIR)('corpus smoke test (METER_CORPUS_DIR = the 006. METER CSV folder)', () => {
  it('SITE YA BULK METER, whole file: text-sorted rows, weekday mean ≈ 194 kW (as-is/10), not 388', async () => {
    const o = await whole('SITE YA/SITE YA, , BULK METER, .csv')
    expect(o.report.rowOrder).toBe('unordered')
    const m = weekdayMean(o.channels[0])
    expect(m).toBeGreaterThan(180)
    expect(m).toBeLessThan(210)
  }, 60_000)

  it('SITE TZ 01A TENANT-95 (C), whole file: weekday mean ≈ 17 kW (as-is/10), not 8.4', async () => {
    const o = await whole('SITE TZ/SITE TZ, , 01A TENANT-95, .csv')
    const m = weekdayMean(o.channels.find((c) => c.spec.sourceColumn === 'P1 (kWh)') as NormalisedChannel)
    expect(m).toBeGreaterThan(15)
    expect(m).toBeLessThan(19)
  }, 60_000)
})
```

Relative imports on purpose: a package importing itself by name (`@esite/shared/meter-data`) is not resolved reliably by Vite inside the package. The subpath exports are proven by `apps/web` importing them in plan 3a-ii (its type-check fails if they do not resolve).

- [ ] **Step 3: Run it both ways**

```bash
pnpm --filter @esite/shared test -- meter-data/corpus
METER_CORPUS_DIR="/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/006. METER CSV" pnpm --filter @esite/shared test -- meter-data/corpus
```
Expected: first run `2 skipped`; second run `2 passed`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/meter-data/index.ts packages/shared/src/meter-data/corpus.smoke.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): @esite/shared/meter-data barrel; env-gated whole-file corpus smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Load model (engine spec §2.2–2.6)

All load functions work on local (SAST) dates as `YYYY-MM-DD` strings and hourly arrays. `NaN` marks a missing hour inside the load model (the DB's NULL). A reference year has 8,760 hours; hour 0 = 1 January 00:00–01:00 SAST; a leap year drops 29 February.

### Task 16: Calendar and day types

**Files:**
- Create: `packages/shared/src/services/solar/load/calendar.ts`
- Test: `packages/shared/src/services/solar/load/calendar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { addDays, dayTypeOf, daysBetween, fillDayTypeOf, intervalStartLocal, referenceYearDates } from './calendar'

describe('calendar', () => {
  it('day types use the SA public-holiday table (incl. Sunday-rule observances)', () => {
    expect(dayTypeOf('2027-01-01')).toBe('holiday')   // Friday, New Year
    expect(dayTypeOf('2027-01-02')).toBe('saturday')
    expect(dayTypeOf('2027-01-03')).toBe('sunday')
    expect(dayTypeOf('2027-01-04')).toBe('weekday')
    expect(dayTypeOf('2027-03-21')).toBe('holiday')   // Sunday AND Human Rights Day
    expect(dayTypeOf('2027-03-22')).toBe('holiday')   // observed Monday
    expect(dayTypeOf('2027-12-27')).toBe('holiday')   // Day of Goodwill (Sunday 26th) observed
    expect(fillDayTypeOf('2027-03-22')).toBe('sunday_holiday')
    expect(fillDayTypeOf('2027-01-03')).toBe('sunday_holiday')
  })
  it('reference year: 365 dates, 29 Feb dropped', () => {
    const d = referenceYearDates(2028)
    expect(d).toHaveLength(365)
    expect(d).not.toContain('2028-02-29')
    expect([d[0], d[364]]).toEqual(['2028-01-01', '2028-12-31'])
    expect(referenceYearDates(2027)).toHaveLength(365)
  })
  it('date arithmetic', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28')
    expect(daysBetween('2025-01-01', '2025-12-31')).toBe(364)
  })
  it('interval start in SAST from ts_end', () => {
    expect(intervalStartLocal(Date.UTC(2025, 2, 9, 22, 30), 30)).toEqual({ date: '2025-03-10', hour: 0, minute: 0 })
    expect(intervalStartLocal(Date.UTC(2025, 2, 9, 22, 0), 30)).toEqual({ date: '2025-03-09', hour: 23, minute: 30 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/calendar`
Expected: FAIL — cannot resolve `./calendar`.

- [ ] **Step 3: Implement**

```ts
/**
 * Local-date calendar for the load model. SAST = UTC+2 fixed. Holidays come from the one statutory
 * source (lib/jbcc/sa-public-holidays, which projects.public_holidays materialises).
 */
import { isPublicHoliday } from '../../../lib/jbcc/sa-public-holidays'

export const HOURS_PER_YEAR = 8760
export const SAST_OFFSET_MS = 7_200_000
export type DayType = 'weekday' | 'saturday' | 'sunday' | 'holiday'
/** Gap filling pools Sundays with public holidays (engine spec §2.2). */
export type FillDayType = 'weekday' | 'saturday' | 'sunday_holiday'

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function parseIsoDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}
const utcDate = (s: string) => {
  const { y, m, d } = parseIsoDate(s)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(s: string, n: number): string {
  const t = new Date(utcDate(s).getTime() + n * 86_400_000)
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / 86_400_000)
}
export const monthOf = (s: string) => parseIsoDate(s).m

const dayTypeCache = new Map<string, DayType>()
export function dayTypeOf(s: string): DayType {
  const hit = dayTypeCache.get(s)
  if (hit) return hit
  const dt = utcDate(s)
  const w = dt.getUTCDay()
  const t: DayType = isPublicHoliday(dt) ? 'holiday' : w === 0 ? 'sunday' : w === 6 ? 'saturday' : 'weekday'
  dayTypeCache.set(s, t)
  return t
}
export function fillDayTypeOf(s: string): FillDayType {
  const t = dayTypeOf(s)
  return t === 'sunday' || t === 'holiday' ? 'sunday_holiday' : t
}

export function referenceYearDates(year: number): string[] {
  const out: string[] = []
  for (let s = isoDate(year, 1, 1); s.startsWith(`${year}-`); s = addDays(s, 1)) {
    if (!s.endsWith('-02-29')) out.push(s)
  }
  return out
}

/** Local date/hour of the START of the interval ending at tsEnd. */
export function intervalStartLocal(tsEndMs: number, intervalMin: number): { date: string; hour: number; minute: number } {
  const d = new Date(tsEndMs - intervalMin * 60_000 + SAST_OFFSET_MS)
  return { date: isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/calendar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/calendar.ts packages/shared/src/services/solar/load/calendar.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): load-model calendar — SAST dates, day types with SA holidays, 8760 reference year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Readings → hourly days and timelines

**Files:**
- Create: `packages/shared/src/services/solar/load/hourly.ts`
- Test: `packages/shared/src/services/solar/load/hourly.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { completeDays, fromTimeline, readingsToDailyHours, toTimeline } from './hourly'

const end = (date: [number, number, number], hh: number, mm: number) => Date.UTC(date[0], date[1] - 1, date[2], hh, mm) - 7_200_000

describe('readingsToDailyHours', () => {
  const day: [number, number, number] = [2025, 3, 10]
  const readings: Reading[] = []
  for (let h = 0; h < 24; h++) {
    readings.push({ tsEnd: end(day, h, 30), value: 10 * h, quality: QUALITY.OK })
    readings.push({ tsEnd: end(day, h + 1, 0), value: 10 * h + 2, quality: QUALITY.OK })
  }
  it('hour value = mean of its sub-intervals', () => {
    const d = readingsToDailyHours(readings, 30).get('2025-03-10') as Float64Array
    expect(d[0]).toBe(1)
    expect(d[23]).toBe(231)
  })
  it('an hour with a missing or unusable sub-interval is NaN', () => {
    const r = readings.filter((x) => x.tsEnd !== end(day, 5, 30)).map((x) => (x.tsEnd === end(day, 7, 30) ? { ...x, quality: QUALITY.SPIKE } : x))
    const d = readingsToDailyHours(r, 30).get('2025-03-10') as Float64Array
    expect(Number.isNaN(d[5])).toBe(true)
    expect(Number.isNaN(d[7])).toBe(true)
    expect(d[6]).toBe(61)
    expect(completeDays(readingsToDailyHours(r, 30))).toEqual([])
    expect(completeDays(readingsToDailyHours(readings, 30))).toEqual(['2025-03-10'])
  })
  it('refuses daily intervals', () => {
    expect(() => readingsToDailyHours(readings, 1440)).toThrow(/cannot build an hourly series/)
  })
})

describe('timelines', () => {
  it('contiguous from first to last date, NaN for days with no data, and back', () => {
    const m = new Map([['2025-03-10', new Float64Array(24).fill(1)], ['2025-03-12', new Float64Array(24).fill(3)]])
    const t = toTimeline(m)
    expect(t?.startDate).toBe('2025-03-10')
    expect(t?.values.length).toBe(72)
    expect(Number.isNaN(t!.values[24])).toBe(true)
    expect([...fromTimeline(t!).keys()]).toEqual(['2025-03-10', '2025-03-11', '2025-03-12'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/hourly`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { isUsable, type Reading } from '../../../meter-data/types'
import { addDays, daysBetween, intervalStartLocal } from './calendar'

/** Local date → 24 hourly average kW values; NaN = missing. */
export type DailyHours = Map<string, Float64Array>
/** A contiguous hourly series from startDate 00:00; length = days × 24. */
export interface Timeline {
  startDate: string
  values: Float64Array
}

export function readingsToDailyHours(readings: Reading[], intervalMin: number): DailyHours {
  if (intervalMin > 60 || 60 % intervalMin !== 0) {
    throw new Error(`readingsToDailyHours: a ${intervalMin}-min interval cannot build an hourly series`)
  }
  const per = 60 / intervalMin
  const acc = new Map<string, { sum: Float64Array; n: Uint8Array }>()
  for (const r of readings) {
    if (!isUsable(r)) continue
    const { date, hour } = intervalStartLocal(r.tsEnd, intervalMin)
    let e = acc.get(date)
    if (!e) {
      e = { sum: new Float64Array(24), n: new Uint8Array(24) }
      acc.set(date, e)
    }
    e.sum[hour] += r.value as number
    e.n[hour] += 1
  }
  const out: DailyHours = new Map()
  for (const date of [...acc.keys()].sort()) {
    const e = acc.get(date) as { sum: Float64Array; n: Uint8Array }
    const v = new Float64Array(24).fill(NaN)
    for (let h = 0; h < 24; h++) if (e.n[h] === per) v[h] = e.sum[h] / per
    out.set(date, v)
  }
  return out
}

export function completeDays(d: DailyHours): string[] {
  return [...d.entries()].filter(([, v]) => v.every((x) => !Number.isNaN(x))).map(([k]) => k).sort()
}

export function toTimeline(d: DailyHours): Timeline | null {
  const dates = [...d.keys()].sort()
  if (dates.length === 0) return null
  const startDate = dates[0]
  const n = daysBetween(startDate, dates[dates.length - 1]) + 1
  const values = new Float64Array(n * 24).fill(NaN)
  for (const [date, v] of d) values.set(v, daysBetween(startDate, date) * 24)
  return { startDate, values }
}

export function fromTimeline(t: Timeline): DailyHours {
  const out: DailyHours = new Map()
  for (let day = 0; day * 24 < t.values.length; day++) out.set(addDays(t.startDate, day), t.values.slice(day * 24, day * 24 + 24))
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/hourly`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/hourly.ts packages/shared/src/services/solar/load/hourly.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): readings to hourly local days and contiguous timelines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Gap filling

**Files:**
- Create: `packages/shared/src/services/solar/load/gap-fill.ts`
- Test: `packages/shared/src/services/solar/load/gap-fill.test.ts`

Rules (engine spec §2.2): ≤ 2 h → linear interpolation; > 2 h and ≤ 14 days → mean of the same fill day-type (weekday / Saturday / Sunday-or-holiday) at the same hour within ± 4 weeks; > 14 days → not filled.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { addDays, daysBetween, fillDayTypeOf } from './calendar'
import { fillGaps } from './gap-fill'
import type { Timeline } from './hourly'

const START = '2025-03-03'   // Monday
const DAYS = daysBetween(START, '2025-04-20') + 1
const level = (date: string, h: number) => h + ({ weekday: 0, saturday: 100, sunday_holiday: 200 } as const)[fillDayTypeOf(date)]
const idx = (date: string, h: number) => daysBetween(START, date) * 24 + h

function timeline(): Timeline {
  const v = new Float64Array(DAYS * 24)
  for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) v[d * 24 + h] = level(addDays(START, d), h)
  return { startDate: START, values: v }
}

describe('fillGaps', () => {
  const t = timeline()
  t.values[idx('2025-03-12', 10)] = NaN                                          // (a) 2 h: linear
  t.values[idx('2025-03-12', 11)] = NaN
  for (let h = 0; h < 24; h++) t.values[idx('2025-03-13', h)] = NaN              // (b) a weekday
  for (let h = 0; h < 24; h++) t.values[idx('2025-03-21', h)] = NaN              // (c) Human Rights Day (Friday)
  for (let d = 0; d < 15; d++) for (let h = 0; h < 24; h++) t.values[idx(addDays('2025-03-31', d), h)] = NaN  // (d) 15 days
  const r = fillGaps(t)

  it('≤ 2 h: linear', () => {
    expect(r.timeline.values[idx('2025-03-12', 10)]).toBeCloseTo(10, 10)
    expect(r.timeline.values[idx('2025-03-12', 11)]).toBeCloseTo(11, 10)
    expect(r.filled[idx('2025-03-12', 10)]).toBe(1)
  })
  it('≤ 14 days: same day-type, same hour, ± 4 weeks', () => {
    for (let h = 0; h < 24; h++) expect(r.timeline.values[idx('2025-03-13', h)]).toBeCloseTo(h, 10)
    for (let h = 0; h < 24; h++) expect(r.timeline.values[idx('2025-03-21', h)]).toBeCloseTo(200 + h, 10)  // a holiday fills from Sundays/holidays
    expect(r.filled[idx('2025-03-21', 0)]).toBe(2)
  })
  it('> 14 days: left missing', () => {
    expect(Number.isNaN(r.timeline.values[idx('2025-04-07', 12)])).toBe(true)
  })
  it('counts', () => {
    expect(r).toMatchObject({ shortFilled: 2, dayTypeFilled: 48, unfilledHours: 360 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/gap-fill`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { addDays, fillDayTypeOf, type FillDayType } from './calendar'
import type { Timeline } from './hourly'

export interface GapFillOptions {
  shortMaxHours: number
  mediumMaxHours: number
  windowDays: number
}
export const DEFAULT_GAP_FILL: GapFillOptions = { shortMaxHours: 2, mediumMaxHours: 14 * 24, windowDays: 28 }

export interface GapFillResult {
  timeline: Timeline
  /** 0 = original, 1 = linear, 2 = day-type mean. Both filled kinds are quality 2 (estimated). */
  filled: Uint8Array
  shortFilled: number
  dayTypeFilled: number
  unfilledHours: number
}

export function fillGaps(t: Timeline, opts: GapFillOptions = DEFAULT_GAP_FILL): GapFillResult {
  const src = t.values
  const n = src.length
  const out = Float64Array.from(src)
  const filled = new Uint8Array(n)
  const types = new Map<number, FillDayType>()
  const typeOf = (day: number) => {
    let v = types.get(day)
    if (!v) {
      v = fillDayTypeOf(addDays(t.startDate, day))
      types.set(day, v)
    }
    return v
  }
  let shortFilled = 0
  let dayTypeFilled = 0
  let unfilledHours = 0
  let i = 0
  while (i < n) {
    if (!Number.isNaN(src[i])) {
      i++
      continue
    }
    let j = i
    while (j < n && Number.isNaN(src[j])) j++
    const len = j - i
    if (len <= opts.shortMaxHours && i > 0 && j < n) {
      const a = src[i - 1]
      const b = src[j]
      for (let k = i; k < j; k++) {
        out[k] = a + ((b - a) * (k - (i - 1))) / (j - (i - 1))
        filled[k] = 1
      }
      shortFilled += len
    } else if (len <= opts.mediumMaxHours) {
      for (let k = i; k < j; k++) {
        const day = Math.floor(k / 24)
        const hour = k % 24
        const type = typeOf(day)
        let sum = 0
        let cnt = 0
        for (let dd = -opts.windowDays; dd <= opts.windowDays; dd++) {
          const d2 = day + dd
          if (dd === 0 || d2 < 0) continue
          const at = d2 * 24 + hour
          if (at >= n) break
          if (Number.isNaN(src[at]) || typeOf(d2) !== type) continue
          sum += src[at]
          cnt++
        }
        if (cnt > 0) {
          out[k] = sum / cnt
          filled[k] = 2
          dayTypeFilled++
        } else unfilledHours++
      }
    } else unfilledHours += len
    i = j
  }
  return { timeline: { startDate: t.startDate, values: out }, filled, shortFilled, dayTypeFilled, unfilledHours }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/gap-fill`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/gap-fill.ts packages/shared/src/services/solar/load/gap-fill.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): gap filling — 2 h linear, 14 d same day-type/hour +/-4 weeks, longer left missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Reference-year alignment

**Files:**
- Create: `packages/shared/src/services/solar/load/align.ts`
- Test: `packages/shared/src/services/solar/load/align.test.ts`

For each date of the reference year: the source date in the window with the same month, the same day-type and the nearest day-of-month; public holidays map to holidays (a Sunday when the month has none in the data); ties go to the later source date (the most recent data). Only complete source days (24 finite hours after gap filling) are candidates.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { addDays, referenceYearDates } from './calendar'
import { alignToReferenceYear, latestWindow } from './align'
import type { DailyHours } from './hourly'

/** 2025, every hour = month × 100 + day, so the chosen source date can be read off the value. */
function year2025(except: (d: string) => boolean = () => false): DailyHours {
  const m: DailyHours = new Map()
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) {
    if (except(d)) continue
    const [, mo, da] = d.split('-').map(Number)
    m.set(d, new Float64Array(24).fill(mo * 100 + da))
  }
  return m
}
const W = { start: '2025-01-01', end: '2025-12-31' }
const valueOn = (series: Float64Array, target: string) => series[referenceYearDates(2027).indexOf(target) * 24 + 12]

describe('alignToReferenceYear', () => {
  const r = alignToReferenceYear(year2025(), W, 2027)
  it.each([
    ['2027-01-01', 101],   // holiday → New Year 2025
    ['2027-01-02', 104],   // Saturday → nearest Saturday in January 2025 (4th)
    ['2027-01-04', 103],   // Monday → nearest weekday (Fri 3rd beats Mon 6th)
    ['2027-03-21', 321],   // Sunday + Human Rights Day → holiday 21 Mar 2025
    ['2027-03-22', 321],   // observed Monday → holiday 21 Mar 2025
    ['2027-12-27', 1226],  // observed Day of Goodwill → 26 Dec 2025 (nearest December holiday)
  ])('%s ← %i', (target, value) => {
    expect(valueOn(r.series, target)).toBe(value)
  })
  it('every day mapped', () => {
    expect(r).toMatchObject({ unmappedDays: 0, missingMonths: [] })
    expect(r.mapping.find((m) => m.target === '2027-01-04')?.source).toBe('2025-01-03')
  })
  it('a holiday with no holiday in that month of data falls back to the nearest Sunday', () => {
    const s = alignToReferenceYear(year2025((d) => d === '2025-03-21'), W, 2027).series
    expect(valueOn(s, '2027-03-22')).toBe(323)
  })
  it('a month with no data is reported and left NaN', () => {
    const s = alignToReferenceYear(year2025((d) => d.startsWith('2025-02')), W, 2027)
    expect(s.missingMonths).toEqual([2])
    expect(s.unmappedDays).toBe(28)
    expect(Number.isNaN(valueOn(s.series, '2027-02-10'))).toBe(true)
  })
})

describe('latestWindow', () => {
  it('the most recent 365 days ending at the last date', () => {
    expect(latestWindow(['2025-06-30', '2024-01-01'])).toEqual({ start: '2024-07-01', end: '2025-06-30' })
    expect(latestWindow([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/align`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { addDays, dayTypeOf, HOURS_PER_YEAR, monthOf, parseIsoDate, referenceYearDates } from './calendar'
import type { DailyHours } from './hourly'

export interface SourceWindow {
  start: string
  end: string
}

/** The most recent `days` days ending at the latest date (engine spec §2.2 default). */
export function latestWindow(dates: string[], days = 365): SourceWindow | null {
  if (dates.length === 0) return null
  const end = [...dates].sort()[dates.length - 1]
  return { start: addDays(end, -(days - 1)), end }
}

export interface AlignResult {
  series: Float64Array
  mapping: Array<{ target: string; source: string | null }>
  unmappedDays: number
  missingMonths: number[]
}

export function alignToReferenceYear(daily: DailyHours, window: SourceWindow, referenceYear: number): AlignResult {
  const pools = new Map<string, string[]>()
  for (const [date, v] of daily) {
    if (date < window.start || date > window.end) continue
    if (v.some((x) => Number.isNaN(x))) continue
    const key = `${monthOf(date)}|${dayTypeOf(date)}`
    const list = pools.get(key) ?? []
    list.push(date)
    pools.set(key, list)
  }
  const series = new Float64Array(HOURS_PER_YEAR).fill(NaN)
  const mapping: AlignResult['mapping'] = []
  const missing = new Set<number>()
  let unmappedDays = 0
  referenceYearDates(referenceYear).forEach((target, di) => {
    const m = monthOf(target)
    const t = dayTypeOf(target)
    let pool = pools.get(`${m}|${t}`) ?? []
    if (pool.length === 0 && t === 'holiday') pool = pools.get(`${m}|sunday`) ?? []
    const dom = parseIsoDate(target).d
    let best: string | null = null
    let bestDist = Infinity
    for (const s of pool) {
      const dist = Math.abs(parseIsoDate(s).d - dom)
      if (dist < bestDist || (dist === bestDist && best !== null && s > best)) {
        best = s
        bestDist = dist
      }
    }
    mapping.push({ target, source: best })
    if (best === null) {
      unmappedDays++
      missing.add(m)
      return
    }
    series.set(daily.get(best) as Float64Array, di * 24)
  })
  return { series, mapping, unmappedDays, missingMonths: [...missing].sort((a, b) => a - b) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/align`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/align.ts packages/shared/src/services/solar/load/align.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): reference-year alignment by month, day-type (holidays to holidays) and nearest day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Archetypes and GCR-seeded densities (D-06)

**Files:**
- Create: `packages/shared/src/services/solar/load/archetypes.ts`
- Test: `packages/shared/src/services/solar/load/archetypes.test.ts`

The eight archetypes are the functional spec §4.4 list. Hours follow engine spec §2.4 (retail 09:00–18:00 weekdays + Saturday, fast food 07:00–22:00, supermarket base 35 %, office/bank weekday 07:00–18:00, gym 05:00–21:00, anchor 24 h base); restaurant (11:00–22:00) and the anchor's 60 % base are this plan's defaults. The HVAC multipliers are defaults for the owner's one-time review (D-06). 3a-ii seeds `solar.load_archetypes` from `LOAD_ARCHETYPES` and a contract test keeps them identical.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { dayTypeOf, referenceYearDates } from './calendar'
import { ARCHETYPE_CODES, CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, expandArchetype, getArchetype, LOAD_ARCHETYPES } from './archetypes'

describe('archetypes', () => {
  it('eight, in a fixed order', () => {
    expect(LOAD_ARCHETYPES.map((a) => a.code)).toEqual([...ARCHETYPE_CODES])
    expect(ARCHETYPE_CODES).toEqual(['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'])
    for (const a of LOAD_ARCHETYPES) {
      for (const t of ['weekday', 'saturday', 'sunday', 'holiday'] as const) expect(a.profiles[t]).toHaveLength(24)
      expect(a.seasonal).toHaveLength(12)
    }
  })

  it.each(ARCHETYPE_CODES.filter((c) => c !== 'vacant'))('%s: mean over operating hours of the expanded year = 1', (code) => {
    const a = getArchetype(code)
    const s = expandArchetype(a, 2027)
    const dates = referenceYearDates(2027)
    let sum = 0
    let n = 0
    dates.forEach((d, di) => {
      const w = a.operating[dayTypeOf(d)]
      if (!w) return
      for (let h = w[0]; h < w[1]; h++) {
        sum += s[di * 24 + h]
        n++
      }
    })
    expect(sum / n).toBeCloseTo(1, 9)
  })

  it('vacant is all zero', () => {
    expect(expandArchetype(getArchetype('vacant'), 2027).every((v) => v === 0)).toBe(true)
  })

  it('supermarket keeps a 35 % refrigeration base overnight', () => {
    const s = expandArchetype(getArchetype('supermarket'), 2027)
    const di = referenceYearDates(2027).indexOf('2027-01-04')   // a Monday
    expect(s[di * 24 + 2] / s[di * 24 + 12]).toBeCloseTo(0.35, 10)
  })

  it('retail is closed on Sundays and public holidays', () => {
    const s = expandArchetype(getArchetype('retail'), 2027)
    const dates = referenceYearDates(2027)
    const at = (d: string, h: number) => s[dates.indexOf(d) * 24 + h]
    expect(at('2027-03-22', 12) / at('2027-03-23', 12)).toBeCloseTo(0.15, 10)   // observed holiday vs Tuesday
  })

  it('densities come from the GCR category rates (kW/m² × 1000)', () => {
    expect(DEFAULT_DENSITY_W_PER_M2).toEqual({ standard: 30, fast_food: 45, restaurant: 45, national: 30, other: 30 })
    expect(CATEGORY_ARCHETYPE).toEqual({ standard: 'retail', fast_food: 'fast_food', restaurant: 'restaurant', national: 'supermarket', other: 'retail' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/archetypes`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Load archetypes (engine spec §2.4, D-06). Stored as day-type profiles + monthly multipliers and
 * expanded per reference year, because a fixed 8,760 array cannot follow a given year's weekdays
 * and public holidays. The expanded shape is normalised so its mean over OPERATING hours is 1,
 * which makes A × D × shape / 1000 average D W/m² while trading.
 */
import { DEFAULT_GENERATOR_SETTINGS } from '../../generator-cost-recovery/defaults'
import type { ShopCategory } from '../../generator-cost-recovery/types'
import { dayTypeOf, HOURS_PER_YEAR, monthOf, referenceYearDates, type DayType } from './calendar'

export const ARCHETYPE_CODES = ['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'] as const
export type ArchetypeCode = (typeof ARCHETYPE_CODES)[number]
export type OperatingWindow = readonly [open: number, close: number] | null

export interface ArchetypeShapeDef {
  /** Relative level per hour (24 values) per day type; 1.0 = trading. */
  profiles: Record<DayType, readonly number[]>
  /** Hours [open, close) that define operating hours for normalisation; null = closed all day. */
  operating: Record<DayType, OperatingWindow>
  /** Monthly multiplier, January first (HVAC seasonality, southern hemisphere). */
  seasonal: readonly number[]
}

export interface LoadArchetype extends ArchetypeShapeDef {
  code: ArchetypeCode
  version: number
  name: string
}

const flat = (v: number): number[] => Array.from({ length: 24 }, () => v)
function block(base: number, open: number, close: number, ramp = 0.5): number[] {
  return Array.from({ length: 24 }, (_, h) => (h >= open && h < close ? 1 : h === open - 1 || h === close ? ramp : base))
}
function all<T>(v: T): Record<DayType, T> {
  return { weekday: v, saturday: v, sunday: v, holiday: v }
}
const HVAC = [1.1, 1.1, 1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.05, 1.1] as const

export const LOAD_ARCHETYPES: readonly LoadArchetype[] = [
  {
    code: 'retail', version: 1, name: 'Retail (09:00-18:00 Mon-Sat)',
    profiles: { weekday: block(0.15, 9, 18), saturday: block(0.15, 9, 18), sunday: flat(0.15), holiday: flat(0.15) },
    operating: { weekday: [9, 18], saturday: [9, 18], sunday: null, holiday: null },
    seasonal: HVAC,
  },
  { code: 'fast_food', version: 1, name: 'Fast food (07:00-22:00 daily)', profiles: all(block(0.2, 7, 22)), operating: all<OperatingWindow>([7, 22]), seasonal: HVAC },
  { code: 'restaurant', version: 1, name: 'Restaurant (11:00-22:00 daily)', profiles: all(block(0.2, 11, 22)), operating: all<OperatingWindow>([11, 22]), seasonal: HVAC },
  {
    code: 'supermarket', version: 1, name: 'Supermarket (refrigeration base 35 %)',
    profiles: { weekday: block(0.35, 8, 20), saturday: block(0.35, 8, 20), sunday: block(0.35, 8, 17), holiday: block(0.35, 8, 17) },
    operating: { weekday: [8, 20], saturday: [8, 20], sunday: [8, 17], holiday: [8, 17] },
    seasonal: HVAC,
  },
  {
    code: 'office_bank', version: 1, name: 'Office / bank (07:00-18:00 Mon-Fri)',
    profiles: { weekday: block(0.1, 7, 18), saturday: flat(0.1), sunday: flat(0.1), holiday: flat(0.1) },
    operating: { weekday: [7, 18], saturday: null, sunday: null, holiday: null },
    seasonal: HVAC,
  },
  { code: 'gym', version: 1, name: 'Gym (05:00-21:00 daily)', profiles: all(block(0.1, 5, 21)), operating: all<OperatingWindow>([5, 21]), seasonal: HVAC },
  { code: 'anchor_24h', version: 1, name: 'Anchor (24 h base 60 %, trading 08:00-21:00)', profiles: all(block(0.6, 8, 21, 0.8)), operating: all<OperatingWindow>([8, 21]), seasonal: HVAC },
  { code: 'vacant', version: 1, name: 'Vacant (no load)', profiles: all(flat(0)), operating: all<OperatingWindow>(null), seasonal: Array.from({ length: 12 }, () => 1) },
]

export function getArchetype(code: ArchetypeCode): LoadArchetype {
  const a = LOAD_ARCHETYPES.find((x) => x.code === code)
  if (!a) throw new Error(`unknown archetype ${code}`)
  return a
}

export function expandArchetype(a: ArchetypeShapeDef, year: number): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR)
  let sum = 0
  let n = 0
  referenceYearDates(year).forEach((date, di) => {
    const t = dayTypeOf(date)
    const s = a.seasonal[monthOf(date) - 1]
    const w = a.operating[t]
    for (let h = 0; h < 24; h++) {
      const v = a.profiles[t][h] * s
      out[di * 24 + h] = v
      if (w && h >= w[0] && h < w[1]) {
        sum += v
        n++
      }
    }
  })
  const mean = n > 0 ? sum / n : 0
  if (mean <= 0) return new Float64Array(HOURS_PER_YEAR)
  for (let i = 0; i < out.length; i++) out[i] /= mean
  return out
}

/** D-06: seeded from the GCR category rates (kW/m² → W/m²). Average over operating hours. */
export const DEFAULT_DENSITY_W_PER_M2: Record<ShopCategory, number> = (() => {
  const w = (kwPerM2: number) => Math.round(kwPerM2 * 100_000) / 100
  const s = DEFAULT_GENERATOR_SETTINGS
  return {
    standard: w(s.standardKwPerSqm),
    fast_food: w(s.fastFoodKwPerSqm),
    restaurant: w(s.restaurantKwPerSqm),
    national: w(s.nationalKwPerSqm),
    other: w(s.standardKwPerSqm),
  }
})()

export const CATEGORY_ARCHETYPE: Record<ShopCategory, ArchetypeCode> = {
  standard: 'retail', fast_food: 'fast_food', restaurant: 'restaurant', national: 'supermarket', other: 'retail',
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/archetypes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/archetypes.ts packages/shared/src/services/solar/load/archetypes.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): 8 load archetypes expanded per reference year; densities seeded from GCR (D-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Synthesis (S3 per tenant) and shape from a short sample

**Files:**
- Create: `packages/shared/src/services/solar/load/synthesis.ts`
- Test: `packages/shared/src/services/solar/load/synthesis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { addDays, referenceYearDates } from './calendar'
import { expandArchetype, getArchetype } from './archetypes'
import type { DailyHours } from './hourly'
import { shapeFromSample, synthesiseTenant } from './synthesis'

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('synthesiseTenant', () => {
  const shape = expandArchetype(getArchetype('retail'), 2027)
  const dates = referenceYearDates(2027)
  it('A × D × shape / 1000 kW; zero before beneficial occupation', () => {
    const s = synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape, boDate: '2027-03-01' }, 2027)
    const march1 = dates.indexOf('2027-03-01')
    expect(s[(march1 - 1) * 24 + 12]).toBe(0)
    expect(s[march1 * 24 + 12]).toBeCloseTo(3 * shape[march1 * 24 + 12], 12)
  })
  it('no BO date: loaded all year', () => {
    const s = synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape }, 2027)
    expect(s[12]).toBeCloseTo(3 * shape[12], 12)
  })
  it('BO after the reference year: year 1 is empty', () => {
    expect(synthesiseTenant({ areaM2: 100, densityWPerM2: 30, shape, boDate: '2028-02-01' }, 2027).every((v) => v === 0)).toBe(true)
  })
})

describe('shapeFromSample (a meter with < 30 days)', () => {
  const sample: DailyHours = new Map()
  for (let i = 0; i < 7; i++) {
    const d = addDays('2025-03-10', i)   // Mon..Sun
    sample.set(d, new Float64Array(24).fill(i < 5 ? 10 : i === 5 ? 5 : 2))
  }
  const retail = getArchetype('retail')
  const s = shapeFromSample(sample, retail)
  it('uses the sampled day types', () => {
    expect([s.profiles.weekday[12], s.profiles.saturday[12], s.profiles.sunday[12]]).toEqual([10, 5, 2])
  })
  it('borrows a missing day type from the archetype, scaled to the sample', () => {
    const ratio = ((10 + 5 + 2) / 3) / ((mean(retail.profiles.weekday) + mean(retail.profiles.saturday) + mean(retail.profiles.sunday)) / 3)
    expect(s.profiles.holiday[0]).toBeCloseTo(retail.profiles.holiday[0] * ratio, 12)
    expect(s.operating).toBe(retail.operating)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/synthesis`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ArchetypeShapeDef } from './archetypes'
import { dayTypeOf, HOURS_PER_YEAR, referenceYearDates, type DayType } from './calendar'
import type { DailyHours } from './hourly'

export interface SynthTenantInput {
  areaM2: number
  densityWPerM2: number
  /** An expanded shape (expandArchetype) for the same reference year. */
  shape: Float64Array
  /** Beneficial-occupation date (YYYY-MM-DD); load is 0 before it in year 1 (engine spec §2.4). */
  boDate?: string | null
}

export function synthesiseTenant(t: SynthTenantInput, referenceYear: number): Float64Array {
  const out = new Float64Array(HOURS_PER_YEAR)
  const k = (t.areaM2 * t.densityWPerM2) / 1000
  referenceYearDates(referenceYear).forEach((date, di) => {
    if (t.boDate && date < t.boDate) return
    for (let h = 0; h < 24; h++) out[di * 24 + h] = k * t.shape[di * 24 + h]
  })
  return out
}

const TYPES: DayType[] = ['weekday', 'saturday', 'sunday', 'holiday']
const mean = (xs: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return xs.length ? s / xs.length : 0
}

/**
 * A meter with < 30 days of data is only a SHAPE sample (engine spec §2.2): its day-type profiles
 * replace the archetype's; day types it never saw borrow the archetype's profile scaled by the
 * ratio of sample to archetype means over the day types both have. Magnitude still comes from
 * area × density when the result is expanded and synthesised.
 */
export function shapeFromSample(sample: DailyHours, archetype: ArchetypeShapeDef): ArchetypeShapeDef {
  const sums: Partial<Record<DayType, { sum: Float64Array; n: number }>> = {}
  for (const [date, v] of sample) {
    if (v.some((x) => Number.isNaN(x))) continue
    const t = dayTypeOf(date)
    const e = sums[t] ?? { sum: new Float64Array(24), n: 0 }
    for (let h = 0; h < 24; h++) e.sum[h] += v[h]
    e.n++
    sums[t] = e
  }
  const have = TYPES.filter((t) => sums[t])
  if (have.length === 0) return archetype
  const sampled = Object.fromEntries(have.map((t) => [t, Array.from(sums[t]!.sum, (x) => x / sums[t]!.n)])) as Partial<Record<DayType, number[]>>
  const denom = mean(have.map((t) => mean(archetype.profiles[t])))
  const ratio = denom > 0 ? mean(have.map((t) => mean(sampled[t]!))) / denom : 1
  const profiles = Object.fromEntries(TYPES.map((t) => [t, sampled[t] ?? archetype.profiles[t].map((v) => v * ratio)])) as Record<DayType, number[]>
  return { profiles, operating: archetype.operating, seasonal: archetype.seasonal }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/synthesis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/synthesis.ts packages/shared/src/services/solar/load/synthesis.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): tenant synthesis (area x density x shape, BO date) and shape from a short sample

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Site common window (S2) and meter → reference-year series

**Files:**
- Create: `packages/shared/src/services/solar/load/common-window.ts`
- Create: `packages/shared/src/services/solar/load/tenant-series.ts`
- Test: `packages/shared/src/services/solar/load/common-window.test.ts`
- Test: `packages/shared/src/services/solar/load/tenant-series.test.ts`

- [ ] **Step 1: Write the failing tests**

`common-window.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { addDays } from './calendar'
import { chooseCommonWindow } from './common-window'

const range = (a: string, b: string) => {
  const out: string[] = []
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d)
  return out
}
const meters = [
  { meterId: 'm1', coveredDates: range('2024-01-01', '2025-06-30') },
  { meterId: 'm2', coveredDates: range('2024-06-01', '2025-06-30') },
  { meterId: 'm3', coveredDates: range('2025-06-24', '2025-06-30') },   // 7 days: shape only
  { meterId: 'm4', coveredDates: range('2023-01-01', '2023-12-31') },   // old history
  { meterId: 'm5', coveredDates: range('2024-07-01', '2025-06-30') },
]

describe('chooseCommonWindow', () => {
  it('no window reaches 80 %: the best (latest on ties) is returned, flagged', () => {
    expect(chooseCommonWindow(meters)).toEqual({
      window: { start: '2024-07-01', end: '2025-06-30' }, share: 0.75, meetsThreshold: false,
      includedMeters: ['m1', 'm2', 'm5'], droppedMeters: ['m4'], shapeOnlyMeters: ['m3'],
    })
  })
  it('with a 70 % threshold the latest window qualifies', () => {
    expect(chooseCommonWindow(meters, { shareThreshold: 0.7, minDaysForMeter: 30, minCoveredDaysInWindow: 335, windowDays: 365 }).meetsThreshold).toBe(true)
  })
  it('no eligible meter', () => {
    expect(chooseCommonWindow([meters[2]])).toMatchObject({ window: null, shapeOnlyMeters: ['m3'] })
  })
})
```

`tenant-series.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { HOURS_PER_YEAR } from './calendar'
import { fillWithScaledSynthesis, meterReferenceSeries } from './tenant-series'

function constantReadings(from: string, to: string, kw: number, skip: (d: string) => boolean = () => false): Reading[] {
  const out: Reading[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (skip(d)) continue
    for (let k = 1; k <= 48; k++) out.push({ tsEnd: t - 7_200_000 + k * 1_800_000, value: kw, quality: QUALITY.OK })
  }
  return out
}

describe('fillWithScaledSynthesis', () => {
  it('scales synthesis to the meter\'s observed level, never fills with zero', () => {
    const aligned = new Float64Array(10).fill(NaN)
    const synth = new Float64Array(10).fill(3)
    for (let i = 0; i < 5; i++) aligned[i] = 6
    const r = fillWithScaledSynthesis(aligned, synth)
    expect(r).toMatchObject({ filledHours: 5, scale: 2 })
    expect([...r.series]).toEqual(Array(10).fill(6))
  })
})

describe('meterReferenceSeries', () => {
  it('a year with a 20-day hole: hole not filled (> 14 d), but every June target day still maps', () => {
    const readings = constantReadings('2025-01-01', '2025-12-31', 10, (d) => d >= '2025-06-01' && d <= '2025-06-20')
    const r = meterReferenceSeries({ readings, intervalMin: 30, referenceYear: 2027, fallbackSynth: new Float64Array(HOURS_PER_YEAR).fill(1) })
    expect(r.window).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(r.gapFill.unfilledHours).toBe(480)
    expect(r.missingMonths).toEqual([])
    expect(r.filledFromSynthesis).toBe(0)
    expect(r.series.every((v) => v === 10)).toBe(true)
  })
  it('six months of data: the other six are synthesis scaled to the meter (10 / 1)', () => {
    const readings = constantReadings('2025-01-01', '2025-06-30', 10)
    const r = meterReferenceSeries({ readings, intervalMin: 30, referenceYear: 2027, fallbackSynth: new Float64Array(HOURS_PER_YEAR).fill(1) })
    expect(r.missingMonths).toEqual([7, 8, 9, 10, 11, 12])
    expect(r.filledFromSynthesis).toBe(184 * 24)
    expect(r.synthesisScale).toBe(10)
    expect(r.series.every((v) => v === 10)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @esite/shared test -- solar/load/common-window solar/load/tenant-series`
Expected: FAIL.

- [ ] **Step 3: Implement `common-window.ts`**

```ts
/**
 * Site common window for S2 (engine spec §2.2): the most recent 12 months common to ≥ 80 % of
 * metered tenants. A meter "covers" a window when ≥ 335 of its 365 days have complete data; a
 * meter with < 30 days total is a shape sample only.
 */
import { addDays } from './calendar'
import type { SourceWindow } from './align'

export interface MeterCoverage {
  meterId: string
  /** Local dates with a complete day of usable data, any order. */
  coveredDates: string[]
}
export interface CommonWindowOptions {
  shareThreshold: number
  minDaysForMeter: number
  minCoveredDaysInWindow: number
  windowDays: number
}
export const DEFAULT_COMMON_WINDOW: CommonWindowOptions = { shareThreshold: 0.8, minDaysForMeter: 30, minCoveredDaysInWindow: 335, windowDays: 365 }

export interface CommonWindowResult {
  window: SourceWindow | null
  share: number
  meetsThreshold: boolean
  includedMeters: string[]
  droppedMeters: string[]
  shapeOnlyMeters: string[]
}

export function chooseCommonWindow(meters: MeterCoverage[], opts: CommonWindowOptions = DEFAULT_COMMON_WINDOW): CommonWindowResult {
  const shapeOnlyMeters = meters.filter((m) => m.coveredDates.length < opts.minDaysForMeter).map((m) => m.meterId)
  const eligible = meters.filter((m) => m.coveredDates.length >= opts.minDaysForMeter)
  if (eligible.length === 0) return { window: null, share: 0, meetsThreshold: false, includedMeters: [], droppedMeters: [], shapeOnlyMeters }
  const lastOf = (m: MeterCoverage) => [...m.coveredDates].sort()[m.coveredDates.length - 1]
  const ends = [...new Set(eligible.map(lastOf))].sort().reverse()
  const covers = (m: MeterCoverage, w: SourceWindow) => m.coveredDates.filter((d) => d >= w.start && d <= w.end).length >= opts.minCoveredDaysInWindow
  let best: { window: SourceWindow; share: number; included: string[] } | null = null
  for (const end of ends) {
    const window = { start: addDays(end, -(opts.windowDays - 1)), end }
    const included = eligible.filter((m) => covers(m, window)).map((m) => m.meterId)
    const share = included.length / eligible.length
    if (!best || share > best.share) best = { window, share, included }
    if (share >= opts.shareThreshold) break
  }
  const chosen = best as { window: SourceWindow; share: number; included: string[] }
  return {
    window: chosen.window,
    share: chosen.share,
    meetsThreshold: chosen.share >= opts.shareThreshold,
    includedMeters: chosen.included,
    droppedMeters: eligible.map((m) => m.meterId).filter((id) => !chosen.included.includes(id)),
    shapeOnlyMeters,
  }
}
```

The loop keeps the first candidate that reaches the threshold (candidates run latest-first) and otherwise the best share, where a strictly greater share is needed to replace an earlier (later-dated) candidate.

- [ ] **Step 4: Implement `tenant-series.ts`**

```ts
/**
 * One meter → one reference-year series (engine spec §2.2): hourly, gap-filled, aligned by
 * day-type; months the meter does not cover are filled by the tenant's synthesis scaled to the
 * meter's observed level, never by zero.
 */
import type { Reading } from '../../../meter-data/types'
import { alignToReferenceYear, latestWindow, type SourceWindow } from './align'
import { fillGaps } from './gap-fill'
import { completeDays, fromTimeline, readingsToDailyHours, toTimeline } from './hourly'

export function fillWithScaledSynthesis(aligned: Float64Array, synth: Float64Array): { series: Float64Array; filledHours: number; scale: number } {
  let obs = 0
  let syn = 0
  for (let i = 0; i < aligned.length; i++) {
    if (Number.isNaN(aligned[i])) continue
    obs += aligned[i]
    syn += synth[i]
  }
  const scale = syn > 0 ? obs / syn : 1
  const series = Float64Array.from(aligned)
  let filledHours = 0
  for (let i = 0; i < series.length; i++) {
    if (!Number.isNaN(series[i])) continue
    series[i] = synth[i] * scale
    filledHours++
  }
  return { series, filledHours, scale }
}

export interface MeterSeriesResult {
  series: Float64Array
  window: SourceWindow | null
  gapFill: { shortFilled: number; dayTypeFilled: number; unfilledHours: number }
  unmappedDays: number
  missingMonths: number[]
  filledFromSynthesis: number
  synthesisScale: number
}

export function meterReferenceSeries(input: {
  readings: Reading[]
  intervalMin: number
  referenceYear: number
  window?: SourceWindow | null
  fallbackSynth: Float64Array
}): MeterSeriesResult {
  const empty = { shortFilled: 0, dayTypeFilled: 0, unfilledHours: 0 }
  const tl = toTimeline(readingsToDailyHours(input.readings, input.intervalMin))
  if (!tl) {
    const f = fillWithScaledSynthesis(new Float64Array(input.fallbackSynth.length).fill(NaN), input.fallbackSynth)
    return { series: f.series, window: null, gapFill: empty, unmappedDays: 365, missingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
  }
  const gf = fillGaps(tl)
  const daily = fromTimeline(gf.timeline)
  const window = input.window ?? latestWindow(completeDays(daily))
  const gapFill = { shortFilled: gf.shortFilled, dayTypeFilled: gf.dayTypeFilled, unfilledHours: gf.unfilledHours }
  if (!window) {
    const f = fillWithScaledSynthesis(new Float64Array(input.fallbackSynth.length).fill(NaN), input.fallbackSynth)
    return { series: f.series, window: null, gapFill, unmappedDays: 365, missingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
  }
  const al = alignToReferenceYear(daily, window, input.referenceYear)
  const f = fillWithScaledSynthesis(al.series, input.fallbackSynth)
  return { series: f.series, window, gapFill, unmappedDays: al.unmappedDays, missingMonths: al.missingMonths, filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @esite/shared test -- solar/load/common-window solar/load/tenant-series`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/solar/load/common-window.ts packages/shared/src/services/solar/load/tenant-series.ts packages/shared/src/services/solar/load/common-window.test.ts packages/shared/src/services/solar/load/tenant-series.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): S2 site common window; meter to reference-year series, uncovered months from scaled synthesis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Site series S1 / S2 / S3 / S4 and bulk reconciliation

**Files:**
- Create: `packages/shared/src/services/solar/load/site-series.ts`
- Test: `packages/shared/src/services/solar/load/site-series.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR } from './calendar'
import { buildS1, buildS2, buildS3, buildS4, LoadModelError, monthlyEnergyKwh, reconcileMonthly } from './site-series'

const k = (v: number) => new Float64Array(HOURS_PER_YEAR).fill(v)

describe('S1 (bulk)', () => {
  it('refuses a meter not confirmed as the point of supply', () => {
    expect(() => buildS1({ bulk: k(100), supplyPointConfirmed: false })).toThrow(LoadModelError)
    try { buildS1({ bulk: k(100), supplyPointConfirmed: false }) } catch (e) { expect((e as LoadModelError).code).toBe('supply_point_not_confirmed') }
  })
  it('adds existing PV generation when the bulk meter sits downstream of it', () => {
    expect(buildS1({ bulk: k(100), supplyPointConfirmed: true, existingPv: k(20) })[0]).toBe(120)
  })
  it('reconciliation shows the ratio and does not assume bulk ⊇ tenants (SITE YA ≈ 2.5)', () => {
    const r = reconcileMonthly(Array(12).fill(100), Array(12).fill(250))
    expect(r[0]).toEqual({ month: 1, bulkKwh: 100, tenantsKwh: 250, ratio: 2.5 })
    expect(reconcileMonthly([0, ...Array(11).fill(1)], Array(12).fill(1))[0].ratio).toBeNull()
  })
})

describe('S2 (tenants)', () => {
  it('(Σ weight × meter + Σ unmetered synth) × (1 + common area)', () => {
    const s = buildS2({ tenants: [{ meters: [{ series: k(10), weight: 1 }, { series: k(4), weight: 0.5 }] }, { synth: k(6) }], commonAreaPct: 10 })
    expect(s[0]).toBeCloseTo((10 + 2 + 6) * 1.1, 12)
  })
  it('refuses weight ≤ 0 and a tenant with no basis', () => {
    expect(() => buildS2({ tenants: [{ meters: [{ series: k(1), weight: 0 }] }], commonAreaPct: 0 })).toThrow(/weight/)
    expect(() => buildS2({ tenants: [{}], commonAreaPct: 0 })).toThrow(/basis/)
    expect(() => buildS2({ tenants: [], commonAreaPct: 101 })).toThrow(/common/)
  })
})

describe('S3 (synthesis)', () => {
  it('Σ synth × (1 + common area)', () => {
    expect(buildS3({ synths: [k(1), k(2)], commonAreaPct: 50 })[0]).toBe(4.5)
  })
})

describe('S4 (monthly bills)', () => {
  const shape = k(1)
  for (let h = 0; h < 744; h++) shape[h] = h % 2 === 0 ? 1 : 3   // January alternates 1 / 3
  const kwh = [1488, ...Array(11).fill(100)]
  it('scales each month to the billed kWh', () => {
    const { series } = buildS4({ shape, monthlyKwh: kwh, referenceYear: 2027 })
    expect(monthlyEnergyKwh(series, 2027).map((x) => Math.round(x * 1e9) / 1e9)).toEqual(kwh)
    expect(series[744]).toBeCloseTo(100 / 672, 12)                   // February, 672 hours
  })
  it('billed kVA sets the monthly peak (PF 0.95) and keeps the energy', () => {
    const { series } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [3.8, ...Array(11).fill(null)], referenceYear: 2027 })
    expect(series[1]).toBeCloseTo(3.61, 10)
    expect(series[0]).toBeCloseTo(0.39, 10)
    expect(monthlyEnergyKwh(series, 2027)[0]).toBeCloseTo(1488, 9)
  })
  it('a flat month cannot take a peak: warned, unchanged', () => {
    const { warnings } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [null, 1, ...Array(10).fill(null)], referenceYear: 2027 })
    expect(warnings.join(' ')).toMatch(/month 2/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/site-series`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Site series by basis (engine spec §2.3). Hourly kW over the reference year. Energy is never
 * scaled by diversity (§2.5); S4's kVA step is an energy-preserving affine stretch about the
 * monthly mean (see the open question on "peak-only transform").
 */
import { HOURS_PER_YEAR, monthOf, referenceYearDates } from './calendar'

export type LoadBasis = 'S1' | 'S2' | 'S3' | 'S4'

export class LoadModelError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'LoadModelError'
  }
}

function monthIndex(referenceYear: number): Int8Array {
  const idx = new Int8Array(HOURS_PER_YEAR)
  referenceYearDates(referenceYear).forEach((d, di) => idx.fill(monthOf(d), di * 24, di * 24 + 24))
  return idx
}

export function monthlyEnergyKwh(series: Float64Array, referenceYear: number): number[] {
  const m = monthIndex(referenceYear)
  const out = Array(12).fill(0) as number[]
  for (let h = 0; h < series.length; h++) if (!Number.isNaN(series[h])) out[m[h] - 1] += series[h]
  return out
}

export function buildS1(input: { bulk: Float64Array; supplyPointConfirmed: boolean; existingPv?: Float64Array | null }): Float64Array {
  if (!input.supplyPointConfirmed) {
    throw new LoadModelError('supply_point_not_confirmed', 'A meter labelled bulk is used as the site supply only after the user confirms it is the point of supply.')
  }
  const out = Float64Array.from(input.bulk)
  if (input.existingPv) for (let h = 0; h < out.length; h++) out[h] += input.existingPv[h]
  return out
}

export function reconcileMonthly(bulkKwh: number[], tenantsKwh: number[]): Array<{ month: number; bulkKwh: number; tenantsKwh: number; ratio: number | null }> {
  return bulkKwh.map((b, i) => ({ month: i + 1, bulkKwh: b, tenantsKwh: tenantsKwh[i], ratio: b > 0 ? tenantsKwh[i] / b : null }))
}

export interface S2Tenant {
  meters?: Array<{ series: Float64Array; weight: number }>
  synth?: Float64Array
}

function checkCommonArea(pct: number): void {
  if (!(pct >= 0 && pct <= 100)) throw new LoadModelError('invalid_common_area', 'The common-area allowance must be between 0 and 100 %.')
}

export function buildS2(input: { tenants: S2Tenant[]; commonAreaPct: number }): Float64Array {
  checkCommonArea(input.commonAreaPct)
  const out = new Float64Array(HOURS_PER_YEAR)
  for (const t of input.tenants) {
    if (t.meters && t.meters.length > 0) {
      for (const m of t.meters) {
        if (!(m.weight > 0)) throw new LoadModelError('invalid_weight', 'A meter weight must be greater than 0.')
        for (let h = 0; h < out.length; h++) out[h] += m.weight * m.series[h]
      }
    } else if (t.synth) {
      for (let h = 0; h < out.length; h++) out[h] += t.synth[h]
    } else {
      throw new LoadModelError('tenant_without_basis', 'Every tenant needs a load basis: meters or a synthesised series.')
    }
  }
  const f = 1 + input.commonAreaPct / 100
  for (let h = 0; h < out.length; h++) out[h] *= f
  return out
}

export function buildS3(input: { synths: Float64Array[]; commonAreaPct: number }): Float64Array {
  return buildS2({ tenants: input.synths.map((synth) => ({ synth })), commonAreaPct: input.commonAreaPct })
}

export function buildS4(input: {
  shape: Float64Array
  monthlyKwh: number[]
  monthlyKva?: Array<number | null>
  powerFactor?: number
  referenceYear: number
}): { series: Float64Array; warnings: string[] } {
  if (input.monthlyKwh.length !== 12) throw new LoadModelError('invalid_bills', 'Twelve monthly kWh values are required.')
  const pf = input.powerFactor ?? 0.95
  const m = monthIndex(input.referenceYear)
  const out = new Float64Array(HOURS_PER_YEAR)
  const warnings: string[] = []
  for (let month = 1; month <= 12; month++) {
    const hours: number[] = []
    for (let h = 0; h < HOURS_PER_YEAR; h++) if (m[h] === month) hours.push(h)
    const shapeSum = hours.reduce((s, h) => s + input.shape[h], 0)
    if (!(shapeSum > 0)) throw new LoadModelError('flat_zero_shape', `The shape has no energy in month ${month}.`)
    const kwh = input.monthlyKwh[month - 1]
    const scale = kwh / shapeSum
    for (const h of hours) out[h] = input.shape[h] * scale
    const kva = input.monthlyKva?.[month - 1]
    if (kva === null || kva === undefined) continue
    const mean = kwh / hours.length
    const peak = Math.max(...hours.map((h) => out[h]))
    if (peak - mean < 1e-9) {
      warnings.push(`month ${month}: the shape is flat, so the billed peak cannot be applied; left unchanged`)
      continue
    }
    const s = (kva * pf - mean) / (peak - mean)
    let clamped = false
    for (const h of hours) {
      const y = mean + (out[h] - mean) * s
      if (y < 0) clamped = true
      out[h] = Math.max(0, y)
    }
    if (clamped) {
      const e = hours.reduce((acc, h) => acc + out[h], 0)
      for (const h of hours) out[h] *= kwh / e
      warnings.push(`month ${month}: the peak transform produced negative hours; clamped and energy re-scaled`)
    }
  }
  return { series: out, warnings }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load/site-series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/site-series.ts packages/shared/src/services/solar/load/site-series.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): site series S1-S4, monthly energy and bulk reconciliation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Diversity (design MD only) and maximum demand per format

**Files:**
- Create: `packages/shared/src/services/solar/load/diversity.ts`
- Create: `packages/shared/src/services/solar/load/max-demand.ts`
- Create: `packages/shared/src/services/solar/load/index.ts`
- Test: `packages/shared/src/services/solar/load/max-demand.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { designMaxDemandSynth, diversityApplies, DIVERSITY_DISABLED_REASON } from './diversity'
import { monthlyMaxDemand, monthlyMaxDemandFromHourly } from './max-demand'

const SPIKE_END = Date.UTC(2025, 2, 15, 10, 0)
function readings(scale = 1): Reading[] {
  const out: Reading[] = []
  for (let t = Date.UTC(2025, 1, 28, 22, 30); t <= Date.UTC(2025, 3, 30, 22, 0); t += 1_800_000) {
    out.push({ tsEnd: t, value: (t === SPIKE_END ? 200 : 100) * scale, quality: QUALITY.OK })
  }
  return out
}

describe('monthlyMaxDemand (engine spec §2.6)', () => {
  it('a measured kVA channel is used directly (B/C)', () => {
    const r = monthlyMaxDemand({ kw: readings(), kva: readings(1 / 0.9), intervalMin: 30 })
    if ('error' in r) throw new Error(r.error)
    expect(r.months.map((m) => [m.month, Math.round(m.kva * 1000) / 1000, m.source])).toEqual([
      ['2025-03', 222.222, 'measured_kva'], ['2025-04', 111.111, 'measured_kva'],
    ])
    expect(r.months[0].tsEnd).toBe(SPIKE_END)
  })
  it('kW only (most A files): kW / assumed PF 0.95', () => {
    const r = monthlyMaxDemand({ kw: readings(), intervalMin: 30 })
    if ('error' in r) throw new Error(r.error)
    expect(r.months[0]).toMatchObject({ month: '2025-03', source: 'kw_over_pf', powerFactor: 0.95 })
    expect(r.months[0].kva).toBeCloseTo(200 / 0.95, 9)
    expect(r.months[1].kva).toBeCloseTo(100 / 0.95, 9)
  })
  it('only chargeable intervals count (tariff TOU windows arrive in Phase 2)', () => {
    const r = monthlyMaxDemand({ kw: readings(), intervalMin: 30 }, { isChargeable: (t) => t !== SPIKE_END })
    if ('error' in r) throw new Error(r.error)
    expect(r.months[0].kva).toBeCloseTo(100 / 0.95, 9)
  })
  it('daily files cannot yield MD', () => {
    expect(monthlyMaxDemand({ kw: readings(), intervalMin: 1440 })).toEqual({ error: 'daily_interval' })
  })
  it('from an hourly site series (S2–S4)', () => {
    const s = new Float64Array(8760).fill(10)
    s[100] = 19
    const r = monthlyMaxDemandFromHourly(s, 2027)
    expect(r[0]).toMatchObject({ month: '2027-01', source: 'hourly_series' })
    expect(r[0].kva).toBeCloseTo(20, 9)
    expect(r[1].kva).toBeCloseTo(10 / 0.95, 9)
  })
})

describe('diversity (engine spec §2.5)', () => {
  it('k × Σ tenant peaks, for synthesised tenants only', () => {
    const a = new Float64Array(8760).fill(1)
    const b = new Float64Array(8760).fill(2)
    a[5] = 10
    b[7] = 20
    expect(designMaxDemandSynth([a, b], 0.8)).toBeCloseTo(24, 12)
    expect(() => designMaxDemandSynth([a], 1.2)).toThrow(RangeError)
    expect([diversityApplies('S1'), diversityApplies('S2'), diversityApplies('S3'), diversityApplies('S4')]).toEqual([false, false, true, false])
    expect(DIVERSITY_DISABLED_REASON).toBe('Measured data already reflects diversity')
  })
})
```

The barrel (`index.ts`, Step 5) is exercised by 3a-ii's web imports.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- solar/load/max-demand`
Expected: FAIL — cannot resolve `./diversity`.

- [ ] **Step 3: Implement `diversity.ts`**

```ts
import type { LoadBasis } from './site-series'

export const DIVERSITY_DISABLED_REASON = 'Measured data already reflects diversity'

/** MD_synth = k × Σ_t max_h synth_t[h]. Never applied to hourly energy (WM cut energy by 20 % that way). */
export function designMaxDemandSynth(synths: Float64Array[], k = 1): number {
  if (!(k > 0 && k <= 1)) throw new RangeError('The diversity factor must be in (0, 1].')
  let total = 0
  for (const s of synths) {
    let max = 0
    for (let i = 0; i < s.length; i++) if (s[i] > max) max = s[i]
    total += max
  }
  return k * total
}

/** Diversity is for synthesised load only; S1/S2 are measured, S4 is scaled to bills. */
export function diversityApplies(basis: LoadBasis): boolean {
  return basis === 'S3'
}
```

- [ ] **Step 4: Implement `max-demand.ts`**

```ts
/**
 * Monthly maximum demand (engine spec §2.6): the highest sub-hourly interval in chargeable windows.
 * A measured kVA channel (PnP B "S (per kVA)", C "S (kVA)") is used directly; otherwise kW / PF
 * (assumed, shown). Daily files cannot produce MD. The averaged profile's peak is never MD.
 */
import { isUsable, type Reading } from '../../../meter-data/types'
import { intervalStartLocal, monthOf, referenceYearDates } from './calendar'

export interface MonthlyMd {
  month: string
  kva: number
  source: 'measured_kva' | 'kw_over_pf' | 'hourly_series'
  powerFactor: number | null
  tsEnd: number | null
}

export function monthlyMaxDemand(
  input: { kw?: Reading[] | null; kva?: Reading[] | null; intervalMin: number },
  opts: { powerFactor?: number; isChargeable?: (tsEnd: number) => boolean } = {},
): { months: MonthlyMd[] } | { error: 'daily_interval' | 'no_data' } {
  if (input.intervalMin >= 1440) return { error: 'daily_interval' }
  const pf = opts.powerFactor ?? 0.95
  const useKva = !!input.kva && input.kva.some(isUsable)
  const src = useKva ? (input.kva as Reading[]) : (input.kw ?? [])
  const best = new Map<string, { kva: number; tsEnd: number }>()
  for (const r of src) {
    if (!isUsable(r)) continue
    if (opts.isChargeable && !opts.isChargeable(r.tsEnd)) continue
    const month = intervalStartLocal(r.tsEnd, input.intervalMin).date.slice(0, 7)
    const kva = useKva ? (r.value as number) : (r.value as number) / pf
    const cur = best.get(month)
    if (!cur || kva > cur.kva) best.set(month, { kva, tsEnd: r.tsEnd })
  }
  if (best.size === 0) return { error: 'no_data' }
  return {
    months: [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({
      month, kva: v.kva, source: useKva ? 'measured_kva' : 'kw_over_pf', powerFactor: useKva ? null : pf, tsEnd: v.tsEnd,
    })),
  }
}

/** For a site series that has no sub-hourly data behind it (S2 aggregate, S3, S4). */
export function monthlyMaxDemandFromHourly(series: Float64Array, referenceYear: number, powerFactor = 0.95): MonthlyMd[] {
  const max = Array(12).fill(-Infinity) as number[]
  referenceYearDates(referenceYear).forEach((d, di) => {
    const m = monthOf(d) - 1
    for (let h = 0; h < 24; h++) {
      const v = series[di * 24 + h]
      if (!Number.isNaN(v) && v > max[m]) max[m] = v
    }
  })
  return max.map((v, i) => ({
    month: `${referenceYear}-${String(i + 1).padStart(2, '0')}`,
    kva: Number.isFinite(v) ? v / powerFactor : 0,
    source: 'hourly_series' as const,
    powerFactor,
    tsEnd: null,
  }))
}
```

- [ ] **Step 5: Write the load barrel `index.ts`**

```ts
export * from './calendar'
export * from './hourly'
export * from './gap-fill'
export * from './align'
export * from './archetypes'
export * from './synthesis'
export * from './common-window'
export * from './tenant-series'
export * from './site-series'
export * from './diversity'
export * from './max-demand'
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- solar/load`
Expected: PASS (every load test file).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/services/solar/load/diversity.ts packages/shared/src/services/solar/load/max-demand.ts packages/shared/src/services/solar/load/index.ts packages/shared/src/services/solar/load/max-demand.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): monthly max demand per format, design MD with diversity, @esite/shared/solar-load barrel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Three suites, type-check, push, draft PR

**Files:** none new.

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @esite/shared test
pnpm --filter @esite/shared type-check
pnpm --filter @esite/shared lint
pnpm --filter web test
pnpm --filter web type-check
pnpm --filter @esite/db test:ci
```
Expected: all green. The shared count is the Task 1 baseline plus this plan's tests; web and db counts equal their baselines (this plan touches neither). If `type-check` flags `exceljs`'s `load` signature, keep the documented cast in `workbook.ts`; do not add `@types/node` to `@esite/shared`.

- [ ] **Step 2: Check the anonymisation one last time**

```bash
git grep -n -i -E "$REAL_NAMES_AND_SERIALS" -- packages/shared/src || echo "clean"
```
Expected: `clean` (only `scripts/solar/build-meter-fixtures.mjs` and `manifest.json`, which are outside `packages/shared/src` or excluded, name sources).

- [ ] **Step 3: Push over SSH**

```bash
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-3a
```

- [ ] **Step 4: Open the draft PR against `feat/solar-phase-1a`**

Write the body to a temp file, then:

```bash
cat > /tmp/pr-3a.md <<'EOF'
## Solar Phase 3a-i: meter data library

Pure TypeScript in `@esite/shared`, no DB, no UI:

- `@esite/shared/meter-data`: format detection A/B/C/D/E/F/G/generic, fixed per-format unit tables (units never defaulted), SAST timestamps with per-format label convention stored at `ts_end` UTC, normalisation with NULL gaps, PnP `Calc` handling, quality flags 0-7, level shifts / spikes / reset pairs / negatives, lagged-channel detection, file + body hashes, G/E registers, validation report, `.xlsx` sheets.
- `@esite/shared/solar-load`: calendar with SA public holidays, hourly aggregation, gap filling, reference-year alignment by day-type, S2 common window, archetypes seeded from GCR densities (D-06), synthesis with BO date, S1-S4, diversity (design MD only), monthly MD per format.
- 31 anonymised 14-day golden fixtures built from the office corpus by `scripts/solar/build-meter-fixtures.mjs`; every expected number was measured on the source files.

### Findings that change the spec (owner to review)
1. Format A "descending" files are text-sorted by DD/MM/YYYY, not time-sorted; the parser always sorts by time and reports `unordered`.
2. In one A file `Solar Total Power` is `p14` one interval later: the label convention is per channel for named columns. Detected and reported; never chosen as primary.
3. Spike threshold 50 x P95 (not P99): a 14-day window can hold > 1 % artefacts.
4. Archetypes are stored as day-type profiles + monthly multipliers and expanded per reference year.
5. GCR densities (30 / 45 W/m²) are used as averages over operating hours; confirm (D-06).

### Next
Plan 3a-ii on this branch: migration `00211` (claimed at apply time), `solar-meter-raw` bucket, parse/commit routes, D-23 volume test.

### Verification
shared / web / db suites green; shared + web type-check clean; corpus smoke test green with `METER_CORPUS_DIR` set.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr create --draft --base feat/solar-phase-1a --head feat/solar-phase-3a \
  --title "Solar Phase 3a: meter data core (parsers, normalisation, load model)" --body-file /tmp/pr-3a.md
```
Expected: a draft PR URL. Record it; plan 3a-ii updates the same PR.
