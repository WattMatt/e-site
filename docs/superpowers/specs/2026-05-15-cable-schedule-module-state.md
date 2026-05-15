# Cable Schedule Module — Consolidated Module State

**Date:** 2026-05-15
**Branch:** `feat/powersync` (synchronized with `main` at `10b8124`)
**Production:** `esite-lilac.vercel.app` (= `main`)
**Backup tags:** `main-pre-cable-recompute-clarity-2026-05-15` (the `ae4a1d1` checkpoint, on origin)

This document is the **single inheritance point** for the cable-schedule module — everything needed to pick up work in a new session without re-reading the chat history. It supersedes earlier per-slice handoffs (C1–C9 in `SPEC DOCS/cable-schedule-session-22-handoff.md`).

---

## 1. Purpose & scope

A multi-revision LV / MV cable schedule for South African industrial sites — design, site sign-off, costing, exports, diff, ring-main visualisation, SANS-compliant derating, all on top of `cable_schedule.*` Postgres schema with PostgREST. The module is shipped, in production, with a complete editable grid + Structure tree + SANS reference library + Excel ingestion + 5-format exports (Excel / PDF / CSV / ZIP).

**Out of scope (deferred):** C10 React-Flow single-line diagram; firm-wide Rate Library global page; bundling more LV tables (4.2 PILC standalone, single-core 6.6/6.7 LV); offline IndexedDB queue for `/site`; CSV bulk-import of confirmed lengths.

---

## 2. Where it lives

```
esite/
├── apps/edge-functions/supabase/migrations/
│   ├── 00051_cable_schedule_core.sql           ─ tables: revisions, sources, boards, supplies, cables, terminations, cable_tags, cost_lines, change_log
│   ├── 00052_cable_schedule_grants.sql         ─ PostgREST GRANTs for cable_schedule schema (separate migration to avoid the "schema cache 403" gotcha)
│   ├── 00053_sans_reference_library.sql        ─ sans_tables, sans_rows, sans_overrides — generic table-of-tables. Seeds TABLE_6_4 + TABLE_6_3_1..5
│   ├── 00054_cable_schedule_c12_editable.sql   ─ voltage range (LV→MV), structured node types (board.kind, source.type)
│   ├── 00055_cable_schedule_supplies_unique_from_to.sql ─ partial UNIQUE indexes on (revision, from, to) so findOrCreateSupplyAction can upsert
│   ├── 00056_sans_reference_bootstrap.sql      ─ verified F&F seed: TABLE_4_2, 5_2, 6_2, 6_3, 6_3_1, 6_4, 6_5, 6_6, 6_7, 9_1
│   ├── 00057_sans_derating_corrections.sql    ─ LV derating suite: 6_3_1..6_3_7 + 9_1 corrected
│   ├── 00058_sans_mv_derating_tables.sql       ─ MV derating: 4_3_1..6 (paper), 5_2_1..6 (XLPE), + 6_9 short-circuit k-factors
│   └── 00059_sans_table_category_applicability.sql ─ tagging tables with category (LV multi-core / MV / derating / etc.)
│
├── apps/web/src/app/(admin)/projects/[id]/cables/
│   ├── page.tsx                                 ─ Revisions list (DRAFT / ISSUED / SUPERSEDED) + + Add revision + Excel ⬆ Import
│   ├── import/page.tsx                          ─ Excel import upload + preview confirm
│   └── [revisionId]/
│       ├── page.tsx                             ─ Revision detail — fetches all rows, runs calc, renders Structure + Grid + Header
│       ├── CableScheduleGrid.tsx                ─ The 23-column editable grid. liveRows state, optimistic updates, recompute on conductor change
│       ├── EditableCell.tsx                     ─ Inline-edit primitive (numeric / select / text)
│       ├── LengthEditPopover.tsx                ─ Per-cable length editor with method dropdown + status badges
│       ├── LengthModeToggle.tsx                 ─ design / as-built / worst-case segmented control
│       ├── StructurePanel.tsx                   ─ Feed-tree renderer (recursive). Ring-main flattening + sibling layout
│       ├── StructureSection.tsx                 ─ Thin 'use client' wrapper that holds the shared `feedFrom` state between StructurePanel and AddEntityPanel
│       ├── AddEntityPanel.tsx                   ─ + Add cable form with live parallel-set readout + inline "+ new board" option
│       ├── ExportMenu.tsx                       ─ Excel / PDF / CSV / ZIP dropdown
│       ├── cost/page.tsx                        ─ Cost summary (per-size rates, contingency %, VAT %, grand total)
│       ├── diff/page.tsx                        ─ Revision diff viewer (cloud ☁ markers)
│       ├── discrepancies/page.tsx               ─ Δ-length discrepancy report — accept / re-measure / design-review actions
│       └── tags/page.tsx                        ─ Tag schedule + QR codes + 10-up A4 print sheet
│
├── apps/web/src/app/(admin)/cable-schedule/sans/
│   └── page.tsx                                 ─ SANS reference library viewer (`/cable-schedule/sans`) — formatted like the Excel workbook
│
├── apps/web/src/app/api/cable-schedule/
│   ├── parse/route.ts                           ─ POST multipart workbook → ImportPreview JSON
│   ├── commit/route.ts                          ─ POST JSON preview → creates DRAFT revision
│   └── export/{excel,pdf,csv,zip}/route.ts      ─ One handler per format
│
├── apps/web/src/actions/
│   ├── cable-entities.actions.ts                ─ add/update/delete source, board, supply, cable; findOrCreateSupplyAction; addParallelCableSetAction; previewParallelCableSet; resolveCableElectricals; repointSupplyAction; renameSourceAction; renameBoardAction; updateCableAction (with RecomputeAudit)
│   ├── cable-revision.actions.ts                ─ create / issue / supersede revisions; re-issue with reason
│   ├── cable-length.actions.ts                  ─ confirm-length, re-measure, evidence upload
│   ├── cable-tag.actions.ts                     ─ generate tags, mark-printed bookkeeping
│   ├── cable-cost.actions.ts                    ─ rate-library CRUD, cost recalc
│   └── cable-discrepancy.actions.ts             ─ accept-variance, request-remeasure, request-design-review
│
├── apps/web/src/lib/cable-schedule/
│   ├── roles.ts                                 ─ cableRoleFor() + ROLE_CAPS bitmap (Designer / SiteOperator / Verifier / Admin / Viewer)
│   ├── excel-importer.ts                        ─ Parses workbooks (reads cell.result for formulas; Aluminium/Copper header rows = conductor context downward; groups by (FROM, TO) for parallel reconstruction)
│   ├── export-payload.ts                        ─ Shared loader — pulls the full revision graph in one Promise.all so Excel + PDF + CSV + ZIP all see the same snapshot
│   ├── export-excel.ts                          ─ 4-sheet workbook: CABLE SCHEDULE (round-trip-safe headers + cable_tag in col B + Aluminium/Copper section headers + Normal/Emergency) + COST SUMMARY + FACTS AND FIGURES + REVISION HISTORY
│   ├── export-pdf.ts                            ─ Multi-page revision pack: WM-branded cover + A4-landscape grid + cost summary + A4-portrait tag schedule (10/page with QR codes)
│   ├── export-csv.ts                            ─ 4 variants: ?type=schedule|tags|cost|change_log, RFC-4180 quoted, CRLF
│   └── export-zip.ts                            ─ Bundle: {stem}.xlsx + {stem}.pdf + csv/*.csv + README.txt (via jszip)
│
└── packages/shared/src/services/
    ├── cable-calc.service.ts                    ─ activeLengthM, voltDropPctSingle, voltDropPctForSupply, computeCumulativeVdMap, shortCircuitCheck, deratedRating, utilisationPct, vdTone, utilisationTone, requiredParallelSet, supplyParallelCapacity
    ├── cable-calc.service.test.ts               ─ vitest — VD, parallel, derating, utilisation, tone (14 tests)
    ├── cable-diff.service.ts                    ─ DiffableCable + changedCableIds (returns {added: Set, changed: Set})
    ├── cable-structure.service.ts               ─ buildStructureTree (pure, ring-aware, cycle-safe) + StructureTreeNode + StructureFeedSummary
    ├── cable-structure.service.test.ts          ─ vitest — nesting, multi-fed, unfed, ring flattening, 2-node cycle (5 tests)
    └── sans-lookup.service.ts                   ─ tableCodeFor, lookupCableProperties, lookupCableProperties bulk, lookupDeratingFactors, lookupFactor (honest-null on miss)
```

---

## 3. Database schema (`cable_schedule.*`)

Storage bucket: `cable-schedule-evidence` (private, 50 MB, image/png|jpeg + pdf).

### Tables

| Table | Purpose | Notable columns |
|---|---|---|
| `revisions` | One row per revision per project | `code` (REV-1…), `status` (DRAFT / ISSUED / SUPERSEDED), `fault_level_ka`, `issued_at`, `issued_by` |
| `sources` | Supply roots | `code`, `type` (COUNCIL_RMU / UTILITY / PV / STANDBY), `rating_kva`, `voltage_v` |
| `boards` | Destinations and intermediate nodes | `code`, `kind` (CONSUMER_RMU / TRANSFORMER / MAIN_BOARD / SUB_BOARD), `breaker_rating_a`, `section`, `parent_board_id` (dormant scaffolding, NOT used by tree — feed graph IS the structure) |
| `supplies` | Feed edges in the graph | `from_source_id` XOR `from_board_id`, `to_board_id`, `voltage_v`, `design_load_a`, `section`. UNIQUE partial indexes on (revision, from_*, to) |
| `cables` | One row per physical cable (parallels are individual rows on the same supply) | `supply_id`, `cable_no`, `size_mm2`, `cores` (3 / 3+E / 4), `conductor` (CU / AL), `insulation` (PVC / XLPE / PILC), `armour`, `standard`, `measured_length_m` + `_by` + `_at` + `_method`, `confirmed_length_m` + same triplet + `_method` (PULL_TAPE / LASER / DRUM_MARKING / REEL_LABEL), `length_status` (UNMEASURED / MEASURED / CONFIRMED / DISCREPANCY), `installation_method`, `depth_mm`, `grouped_with`, `ambient_temp_c`, `thermal_resistivity_kmw`, `ohm_per_km`, `derate_depth` / `_thermal` / `_grouping` / `_temp`, `derated_current_rating_a`, `manual_override`, `tag_override`, `notes` |
| `terminations` | Optional metadata per cable end (gland type, lug, etc.) | `cable_id`, `end` (FROM / TO), JSON fields |
| `cable_tags` | Generated tag info | `cable_id`, `tag_text`, `qr_data`, `printed_at`, `printed_by` |
| `cost_lines` | Computed cost rows | rate from `rate_library.size_mm2 × cores × conductor × insulation`, length, derived total |
| `change_log` | Audit trail of every field change | `entity_type`, `entity_id`, `field_name`, `old_value`, `new_value`, `changed_by`, `changed_at` |
| `sans_tables` | Generic table-of-tables registry | `code` (TABLE_6_4…), `title`, `standard`, `section_number`, `cable_construction`, `description`, `columns` (JSON), `notes`, `source_ref`, **`category`** (lv-multi / mv / derating / earth / single-core), **`applicability`** (JSON tags) |
| `sans_rows` | Generic row data, keyed by table_id + sort_key | `table_id` (FK), `sort_key` (numeric, usually size_mm2 or factor parameter), `row_data` (JSONB) |
| `sans_overrides` | Per-project override of any SANS table | `project_id`, `table_code`, `columns`, `rows`. Wins over bundled data on lookup |

### Conventions

- All writes set `revalidatePath(`/projects/<id>/cables/<revisionId>`)`.
- `Content-Profile: cable_schedule` for writes, `Accept-Profile: cable_schedule` for reads via PostgREST.
- `(supabase as any).schema('cable_schedule')` pattern in all server actions (regen `packages/db/src/types.ts` to drop the cast — known TODO).
- A `revision.status !== 'DRAFT'` short-circuits every write action with `"Revision is ISSUED — start a new revision to make changes."`.

---

## 4. SANS reference library

All ten LV/MV reference tables plus eleven derating tables plus earth-conductor and short-circuit k-factor tables are bundled. `tableCodeFor(conductor, insulation, cores)` is the routing function in `sans-lookup.service.ts` — add new entries there as new bundled tables seed.

### Cable property tables (rated current + impedance)

| Code | Standard | Construction | Conductor | Insulation | Voltage | Seeded |
|---|---|---|---|---|---|---|
| `TABLE_4_2` | SANS 1339 | 3-core PILC SWA jute-served | CU | PILC | 6.35/11 kV | ✓ 00056 |
| `TABLE_5_2` | SANS 97 | 3-core XLPE/PVC SWA | CU | XLPE | 6.35/11 kV | ✓ 00056 |
| `TABLE_6_2` | SANS 1507-3 | Multi-core SWA | CU | PVC | 600/1000 V | ✓ 00056 |
| `TABLE_6_3` | SANS 1507-3 | Multi-core SWA | AL | PVC | 600/1000 V | ✓ 00056 |
| `TABLE_6_4` | SANS 1507-4 | Multi-core SWA | CU | XLPE (90 °C) | 600/1000 V | ✓ 00056 |
| `TABLE_6_5` | SANS 1507-4 | Multi-core SWA | AL | XLPE (90 °C) | 600/1000 V | ✓ 00056 |
| `TABLE_6_6` | SANS 1507-3 | Single-core unarmoured | CU | PVC | 600/1000 V | ✓ 00056 (viewable only — not auto-routed; `tableCodeFor` returns null for single-core) |
| `TABLE_6_7` | SANS 1507-4 | Single-core unarmoured | CU | XLPE | 600/1000 V | ✓ 00056 (viewable only) |
| `TABLE_9_1` | SANS 10142-1 | Earth conductor | CU | — | — | ✓ 00056 + corrected 00057 |

**`normalise()` column mapping** — handles both source-workbook names (`current_rating_ground_90c_a`) and legacy normalised names. For XLPE tables, the 90 °C rating column is the rated value (XLPE conductors run at 90 °C). PVC + AL tables have a single rating set.

### Derating tables (LV — SANS 1507)

| Code | Factor for |
|---|---|
| `TABLE_6_3_1` | Depth of laying |
| `TABLE_6_3_2` | Soil thermal resistivity |
| `TABLE_6_3_3` | Grouping by axial spacing |
| `TABLE_6_3_4` | Ground temperature |
| `TABLE_6_3_5` | Air temperature |
| `TABLE_6_3_6` | Number of cables in a group |
| `TABLE_6_3_7` | Soil resistivity by region |

### Derating tables (MV — paper, SANS 1339 + XLPE, SANS 97)

`TABLE_4_3_1..6` (paper / PILC) and `TABLE_5_2_1..6` (XLPE) mirror the LV suite — depth, thermal resistivity, grouping, ground temp, air temp 25–45 °C, air temp 30–50 °C, soil resistivity.

### Short-circuit k-factors

`TABLE_6_9` — Conductor temperature limits and short-circuit k-factors per (conductor × insulation) combination, used by `shortCircuitCheck()`.

### Routing rules (in `sans-lookup.service.ts`)

```ts
function tableCodeFor(conductor, insulation, cores): string | null {
  void cores  // Each table covers both 3- and 4-core constructions.
  if (insulation === 'XLPE' && conductor === 'CU') return 'TABLE_6_4'
  if (insulation === 'XLPE' && conductor === 'AL') return 'TABLE_6_5'
  if (insulation === 'PVC'  && conductor === 'CU') return 'TABLE_6_2'
  if (insulation === 'PVC'  && conductor === 'AL') return 'TABLE_6_3'
  // PILC (MV paper, Table 4.2 / 5.2) and single-core tables (6.6 / 6.7) are
  // viewable in the SANS reference library but not auto-filled here.
  return null
}
```

**Calc-honesty contract:** `lookupFactor` returns `null` on a genuine table miss (not silent `1`). `deratedRating(base, factors)` returns `null` if `base` is null **or** if any factor is explicitly `null`. The grid renders `null` as `—` with a hover tooltip naming the missing combo. The Add-cable preview branch returns `{}` (not `{error}`) when the rating is genuinely null.

### Project overrides

`sans_overrides` lets a project hand-paste their own version of any table (e.g. a manufacturer's datasheet) — wins over the bundled seed for that project only. Excel-importer's FACTS AND FIGURES sheet can populate this (importer side currently partial — column-mapping wizard is on the polish punch-list).

---

## 5. Calculations (`packages/shared/src/services/cable-calc.service.ts`)

All pure, all unit-tested. No I/O. The data layer fetches rows; these functions compute over them.

```ts
interface CableForCalc { id, supply_id, cable_no, size_mm2, ohm_per_km|null,
  measured_length_m|null, confirmed_length_m|null, length_status,
  derate_depth|null, derate_thermal|null, derate_grouping|null, derate_temp|null }

interface SupplyForCalc { id, from_source_id|null, from_board_id|null,
  to_board_id, voltage_v, design_load_a }

type LengthMode = 'design' | 'as-built' | 'worst'

activeLengthM(cable, mode)           → number | null
voltDropPctSingle(cable, supply, mode) → number  (per-cable VD%)
voltDropPctForSupply(supply, cables, mode) → number  (parallel-aware; uses combined Ω/km)
computeCumulativeVdMap(supplies, cables, mode) → Map<supplyId, vdPct>
                                      (sums VD along the feed chain; cycle-guarded)
shortCircuitCheck(cable, fault_level_ka, t_sec=1) → { ok, kAt²_required, kAt²_actual }
deratedRating(baseA, {depth, thermal, grouping, temperature}) → number | null
utilisationPct(supply, combinedCapacityA) → number | null
vdTone(vdPct) → 'ok' | 'warning' | 'danger'
utilisationTone(util|null) → 'ok' | 'warning' | 'danger'
requiredParallelSet(designLoadA, ratingForN: (n: number) => number, maxN) → ParallelSetResult
supplyParallelCapacity(cables[]) → number  (Σ derated_current_rating_a)
```

### Volt-drop convention

3-phase: `Vd = √3 × I × (R cosφ + X sinφ) × L` reduced to `(I × R × L × √3) / V × 100` for VD%. For parallel sets, R divides by N; the per-cable load is `I/N` for thermal check, the cable's own Ω/km × full I for VD (so the result is the SAME as if N cables were running at full I/N — physics correct).

### Auto-parallel (`requiredParallelSet`)

Given a design load and a per-N rating-curve callback, finds the smallest N where the combined parallel capacity ≥ design load, up to `MAX_PARALLEL_N = 16`. Returns `{ count, perCableRatingA, combinedRatingA, insufficient }`. `previewParallelCableSet` server action wraps this with SANS lookup + group-derating per N. `addParallelCableSetAction` is the commit — atomically creates the supply + N cable rows with `grouped_with = N`.

---

## 6. Structure tree (`packages/shared/src/services/cable-structure.service.ts`)

Pure function transforming the supply graph into a forest:

```ts
buildStructureTree(sources, boards, supplies, decorate) → { roots, unfed }
```

### Behaviour (5 covered by vitest)

1. **Nesting** — every source is a root; its children are the boards on supplies `from_source_id=this`. Each child's children are boards on supplies `from_board_id=child.id`. Recurse.
2. **Multi-fed boards** — a board fed by two non-ring sources appears under each, the 2nd occurrence flagged `alsoFedElsewhere: true` and not re-expanded.
3. **Unfed group** — boards with no incoming supply appear in `unfed[]` with their own subtree.
4. **Ring flattening** — when DFS encounters a back-edge to an ancestor on the current path, that's a ring closure cable. All path nodes between the back-edge target and the back-edge source become **direct siblings** under the ring entry parent (the back-edge target). The closing cable is annotated on the last ring member via `ringClosesBackTo: string` (the entry parent's display code). Each ring member keeps its own non-ring downstream subtree.
5. **Cycle safety** — `expanded` set + DFS `visiting` set prevent infinite recursion on malformed data; a degenerate 2-node ring (A→B, B→A) flattens to B as a child of A with `ringClosesBackTo = 'A'`.

### `StructureTreeNode` shape

```ts
{ id, code, category: 'source' | 'board', nodeType,
  feedSummary: { cableCount, sizeLabel, vdPct, underRated } | null,
  children: StructureTreeNode[],
  alsoFedElsewhere: boolean,
  ringClosesBackTo: string | null,
  blastSupplies: number, blastCables: number }
```

`decorate.feedSummaryFor` and `decorate.blastFor` are caller-supplied — `page.tsx` builds them from already-computed per-supply maps so the pure function stays DB-free.

### Renderer

`StructurePanel.tsx` renders the tree recursively via `TreeNode`. Each row: monospace glyph (`◆` amber for source, `▪` mid-tone for board, `▪` dim for `alsoFedElsewhere` repeats), node code, edge label (`← N×Xmm² Cu · Y.Y% VD · ⚠ under-rated`), the `↻ also fed elsewhere` or `↻ closes ring back to <code>` annotation, then a right-aligned action group (`+ feed a board` / `rename` / `remove`) separated by a flex spacer.

### "+ feed a board" flow

`StructureSection.tsx` (client wrapper) holds `feedFrom` state. Clicking `+ feed a board` on a tree node calls `onFeedBoard(<source|board>:<id>)` → `setFeedFrom(key)` → `AddEntityPanel` receives `feedFromKey` prop → opens auto, pre-seeds CableForm's "From" select. The "To" select has a `+ new board…` option that chains `addBoardAction` before the supply/cable creation. **Idempotent retry:** after a successful `addBoardAction` the form sets `toBoardId = board.id` so a retry on a partial failure (board created, feed failed) targets the existing board instead of duplicating it.

---

## 7. Schedule grid (`CableScheduleGrid.tsx`)

23 columns, inline-editable on DRAFT revisions, supply-aware:

| Group | Columns |
|---|---|
| Identity | `Δ` (cloud marker), Cable tag, From, To |
| Electrical demand | **`V`**, **`Load (A)`** (supply.design_load_a), **`Load / cable`** (per-cable load split) |
| Construction | `mm²`, `Cores`, `Cond` (CU / AL), `Insul` (PVC / XLPE / PILC), `Ω/km`, `C/no` (cable number) |
| Lengths | `Meas (m)`, `Conf (m)`, `Δ m`, `Length` status badge |
| Performance | `VD %` (per-supply), `Σ VD %` (cumulative along feed chain), **`Rating (A)`** (derated current-carrying capacity), `Util %` |
| Installation | `Install`, `Depth`, `Grp` (grouped_with) |
| Free-text | `Notes` |

### Load vs Rating disambiguation

After **commit `73db427`**: the historically-ambiguous `A` / `A / cable` / `Derate A` headers were renamed to **`Load (A)` / `Load / cable` / `Rating (A)`**. `Load (A)` is supply.design_load_a — what you ask the cable to carry; independent of conductor by physics. `Rating (A)` is the cable's derated current-carrying capacity; SANS-derived, changes with Cu↔Al.

### Editable-on-conductor-change semantics

When `Cond` (or any of `size_mm2`, `cores`, `insulation`, `installation_method`, `depth_mm`, `grouped_with`, `ambient_temp_c`) is edited:

1. Optimistic update applies new field to `liveRows` immediately.
2. `updateCableAction` runs — detects `sansChanged` and re-runs the SANS pipeline: `lookupCableProperties` (per new conductor + insulation + size) → `baseRating` (per installation method) → `lookupDeratingFactors` (per depth + thermal + grouping + ambient + insulation) → `deratedRating(base, factors)`.
3. The new `derated_current_rating_a` is patched in DB; `revalidatePath` propagates.
4. The action response carries `recomputed = { ohm_per_km, derated_current_rating_a, audit: RecomputeAudit }`. The audit has `inputs`, `propsFound`, `baseRating`, `derate.{depth,thermal,grouping,temperature}` — engineering observability for the recompute.
5. Server-side `console.log('[cable-recompute]', …)` records the audit in Vercel function logs.
6. Client `console.log` of the audit so DevTools shows the trail.
7. Client applies the new rating **honestly** — `null` from server renders as `—` with a hover tooltip naming the missing combo (no `?? r.derated_rating_a` stale-fallback for SANS-changed paths; the fallback is retained ONLY for the `ohm_per_km_override` path where null means "no change").

### Other cell types

- `Meas (m)` / `Conf (m)` — numeric input with status-machine: editing measured promotes UNMEASURED → MEASURED; clearing it demotes back. Confirmed-length has its own popover (`LengthEditPopover`) with method dropdown + evidence upload.
- `Length` status badge — UNMEASURED / MEASURED / CONFIRMED / DISCREPANCY.
- `Notes`, `tag_override` — text.
- `Ω/km override` — manual override; clears on any SANS-affecting change.
- Right-click row → re-point From/To (RepointPicker) or delete (with blast-radius confirm modal).

### Sub-pages

- `/cables/[revisionId]/cost` — Cost summary, editable per-size rates, contingency %, VAT %, grand total.
- `/cables/[revisionId]/tags` — A4 print sheet, 10 tags per page with QR codes, mark-printed bookkeeping.
- `/cables/[revisionId]/diff` — Cloud ☁N markers comparing against the previous ISSUED revision.
- `/cables/[revisionId]/discrepancies` — Δ-length report (confirmed − measured), per-cable actions (accept / re-measure / design-review).

---

## 8. Excel ingestion

Two-route flow (workbook can exceed the 10 MB server-action limit):

1. `POST /api/cable-schedule/parse` (multipart, workbook bytes)
   - Returns `ImportPreview = { rows: ParsedRow[], conflicts: [], warnings: [], sansWarnings: [] }`.
   - Parser at `apps/web/src/lib/cable-schedule/excel-importer.ts`. Reads `cell.result` for formula cells (CONCATENATE, IF chains, XLOOKUP). Honours `Aluminium`/`Copper` header rows as conductor context downward. Groups by (FROM, TO) for parallel reconstruction. `vdFidelityOk()` self-checks every imported row's VD against the workbook's L column within ±0.001 %.

2. `POST /api/cable-schedule/commit` (JSON body of the preview + `project_id`)
   - Creates a new DRAFT revision and inserts sources / boards / supplies / cables.

**Polish punch-list (not blocking):** COST SUMMARY and FACTS AND FIGURES sheets import; column-mapping wizard for non-canonical layouts; node-fuzzy matching across re-imports; import modes (replace vs append); SHA-256 re-import safety; file-fingerprint templates for known-good workbook formats.

---

## 9. Exports

Five route handlers under `/api/cable-schedule/export/*`. Driven by `ExportMenu.tsx` dropdown on the revision page. All five share `lib/cable-schedule/export-payload.ts` for snapshot consistency.

| Route | Output | Notes |
|---|---|---|
| `/export/excel` | 4-sheet workbook | CABLE SCHEDULE (round-trip-safe importer-regex-compliant headers + cable_tag in col B + Aluminium/Copper section header rows + Normal/Emergency rows) + COST SUMMARY + FACTS AND FIGURES + REVISION HISTORY |
| `/export/pdf` | Multi-page revision pack | WM-branded cover + paginated A4-landscape grid + cost-summary page + A4-portrait tag schedule with QR codes (10/page) |
| `/export/csv?type=schedule\|tags\|cost\|change_log` | One CSV | RFC-4180 quoted, CRLF terminated |
| `/export/zip` | Bundle | `{stem}.xlsx` + `{stem}.pdf` + `csv/*.csv` + `README.txt`; uses `jszip` |

Excel uses `exceljs`, PDF uses `pdf-lib`, QR codes use `qrcode`.

---

## 10. Role mapping & access matrix (`lib/cable-schedule/roles.ts`)

Spec defines five role types; we map to existing `user_organisations.role`:

| `user_organisations.role` | Cable schedule role | Rationale |
|---|---|---|
| `owner` / `admin` | **Admin** | Full caps |
| `project_manager` | **Verifier** | PMs at WM do both design AND sign-off in this firm's model |
| `field_worker` | **SiteOperator** | |
| `client_viewer` | **Viewer** | Read-only |

`ROLE_CAPS` bitmap (in `roles.ts`):

| Role | editMeasured | enterConfirmed | signOff | editDesignFields | acceptVariance | requestRemeasure | requestDesignReview |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Designer | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ |
| SiteOperator | ✗ | ✓ (DRAFT) | ✗ | ✗ | ✗ | ✓ | ✗ |
| Verifier | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Viewer | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Every server action calls `lookupCableRole(supabase, user.id, organisation_id)` and gates against `ROLE_CAPS[role]`.

---

## 11. Tests

```
packages/shared:
  cable-calc.service.test.ts        14 tests   VD, parallel, derating, utilisation, tone
  cable-structure.service.test.ts    5 tests   nesting, multi-fed, unfed, ring-flatten, 2-node cycle

(known pre-existing failures unrelated to cable-schedule:
  __tests__/cloud-storage/dropbox.test.ts — 4 fail; identical fail at 842936e)

apps/web typecheck: clean for all cable-schedule files. 5 pre-existing
errors in unrelated files (onboarding.actions, supplier.actions,
NewProcurementForm, supplier/profile/page, paystack/subaccount/route) —
do NOT fix in cable-schedule work; not in baseline.
```

---

## 12. What's been shipped (commit by commit, this batch on top of C9)

| SHA | Subject |
|---|---|
| `10b8124` | **feat:** ring-main flattening in Structure tree |
| `3516b69` | ux: readable Structure tree — spaced action buttons + text icons |
| `065a216` | **fix:** calc honesty on conductor change + recompute audit trail |
| `73db427` | ux: disambiguate amp column headers in the grid (A → Load (A); Derate A → Rating (A)) |
| `974a678` | fix: inline new-board retry no longer duplicates the board |
| `8b3fb28` | **feat:** Structure panel becomes a feed tree with inline build |
| `9ae6174` | feat: Add-cable form — pre-seedable From + inline new-board |
| `368cbed` | feat: buildStructureTree — supply graph to feed tree |
| `842936e` | docs: calculation-honesty + Add-cable display spec |
| `30cccdb` | feat: promote Conductor (Cu/Al) to a primary Add-cable field |
| `e11d7a3` | feat: show per-cable load share column in the schedule grid |
| `46b368b` | fix: SANS lookupFactor returns null (not 1) on a genuine table miss |
| `d56d9a3` | feat: add category + applicability to SANS reference tables |
| `eea3f17` | feat: format SANS reference viewer like the Excel library |
| `4ace86e` | feat: seed MV derating suites + Table 6.9 reference |
| `26b09da` | fix: hide manual group-size field in the auto-parallel path |
| `3bedf7c` | feat: grid supply under-rating flag + supply-level utilisation |
| `37cdfff` | fix: correct SANS derating tables + populate earth table |
| `4629be6` | fix: discard stale previewParallelCableSet responses in Add-cable form |
| `f08135e` | feat: Add-cable form — live parallel readout + auto-create |
| `499e922` | fix: bound + error-check the existing-cables query in addParallelCableSetAction |
| `a92c6e7` | feat: addParallelCableSetAction batch-create server action |
| `1748e83` | fix: previewParallelCableSet returns empty (not error) when no SANS rating |
| `13c8701` | feat: previewParallelCableSet read-only server action |
| `f40df23` | feat: seed SANS reference library from verified F&F workbook |
| `7797515` | docs: note why updateCableAction keeps its own SANS recompute |
| `2211bcb` | refactor: extract resolveCableElectricals from addCableAction |
| `cff3b91` | fix: guard rMax in requiredParallelSet insufficient branch |
| `f5da140` | feat: requiredParallelSet + supplyParallelCapacity calc helpers |
| `4e15b83` | feat: unique (from,to) supply index + insert-first upsert |
| `f363bc3` | feat: consistent, grouped editor header buttons |
| `0c69d78` | feat: progressive Add-cable form + refreshed empty-state copy |
| `a07c251` | feat: always-visible Structure panel; drop redundant read-only panels |
| `ab8aa00` | feat: length-mode toggle — segmented control + disabled-with-reason |
| `c6341cf` | fix: grid Length column honours the length mode |
| `74df23c` | feat: revisions list — whole-row open + clear affordance |

(C12 editable-schedule batch from Session 22 — eab690c..7eb7c34 — already documented in `SPEC DOCS/cable-schedule-session-22-handoff.md`.)

---

## 13. Pitfalls / known gotchas

- **PostgREST schema cache.** New tables/columns in `cable_schedule.*` need `NOTIFY pgrst, 'reload schema'` after migration OR `supabase db push` (which auto-NOTIFYs). A 403 PGRST schema-cache error on a new table means the GRANT migration didn't run.
- **`(supabase as any)`** is everywhere because `packages/db/src/types.ts` is stale. Regenerating it surfaces 35+ schema-drift errors in unrelated files; not done yet.
- **`parent_board_id`** on `boards` is dormant scaffolding. The feed graph IS the structure — do not introduce a separate parent tree. Cleanup is an optional future task.
- **`?? r.derated_rating_a` fallback** in `saveCableField` is intentionally retained ONLY for the `ohm_per_km_override` path. For all SANS-affecting fields the recompute is authoritative — `null` renders as `—`.
- **Ring detection** triggers on any DFS back-edge. If a non-ring multi-feed happens to traverse a path that loops, the algorithm will treat it as a ring; in practice this matches engineering intent.
- **`grouped_with`** on a parallel set is set to the parallel count by `addParallelCableSetAction`; the manual Group-size field in the Add-cable form is hidden in the parallel path (commit `26b09da`).
- **`lookupCableProperties` bulk variant** exists in `sans-lookup.service.ts` but is NOT called from production code; the grid recomputes one cable at a time via `updateCableAction`.
- **iCloud `* 2.*` files** appear in working tree but are gitignored (`.gitignore` pattern `* 2.*`); never commit them.
- **`feat/powersync` ↔ `main` FF** is deliberate and gated. Push to feat/powersync first, then `git push origin origin/feat/powersync:main` once verified. Always tag a backup at origin/main before the FF.

---

## 14. Deferred polish punch-list

- C10 — React-Flow single-line diagram (schematic distribution view).
- Excel ingestion — COST SUMMARY + FACTS AND FIGURES imports; column-mapping wizard; node-fuzzy matching; import modes (replace vs append); SHA-256 re-import safety; file-fingerprint templates.
- Tag schedule — `Mark printed` bookkeeping UI (the action exists, the surface needs polish).
- `/site` — QR-scan-to-open landing; offline IndexedDB queue with sync; CSV bulk-import of confirmed lengths.
- More bundled SANS tables — 4.2 PILC standalone (if customers need a non-MV use), 5.2 XLPE 11 kV variants, 6.5/6.6/6.7 LV single-core variants beyond viewing.
- Firm-wide Rate Library global page (per-org reusable rate table, currently per-project).
- Auto-recompute derating when ambient/depth/group_size edits flow onto an existing cable (today triggers correctly via `updateCableAction` but not via cascade from supply-level edits).
- Regen `packages/db/src/types.ts` and drop the `(supabase as any)` casts.

---

## 15. How to extend

### Add a new bundled SANS table

1. Write a new migration `000XX_sans_<topic>.sql`:
   ```sql
   WITH t AS (
     INSERT INTO cable_schedule.sans_tables (code, title, standard, section_number, …, columns)
     VALUES ('TABLE_X_Y', 'My new table', 'SANS …', '…', …, $cols$[…]$cols$::jsonb)
     RETURNING id
   )
   INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
   SELECT t.id, v.sort_key, v.row_data::jsonb FROM t,
   (VALUES
     (1.5, $r${"size_mm2":1.5,"current_rating_ground_a":…,…}$r$),
     …
   ) AS v(sort_key, row_data);
   ```
2. If it's a property table the lookup should auto-route to, add an entry in `tableCodeFor(conductor, insulation, cores)` in `sans-lookup.service.ts`.
3. If it's a derating table, extend `lookupDeratingFactors` to read it. Always return `null` from `lookupFactor` on miss (calc honesty).
4. Apply to staging: `supabase db push --password "$DB_PWD"`.
5. The SANS viewer at `/cable-schedule/sans` picks up the new table automatically via `sans_tables`/`sans_rows`.

### Add a new cable field

1. Column migration on `cable_schedule.cables`.
2. Extend the cable schemas: `CableForCalc` (if it affects calc), `ScheduleRow` (if grid-displayed), `addCableAction`'s zod schema, `updateCableSchema` + `SANS_FIELDS` (if it should trigger recompute).
3. Add to the grid header + `EditableCell` for the column. Wire `saveCableField` for the new field name.
4. Update `cable-diff.service.ts` field list so revision diff catches the new field.
5. Update Excel exporter column map + importer regex.

### Add a new node kind

1. CHECK constraint on `cable_schedule.boards.kind` (in a new migration).
2. Add to `BOARD_KINDS` array in `StructurePanel.tsx` and `BOARD_KIND_OPTIONS` in `AddEntityPanel.tsx`.
3. If it changes the structure-tree semantics (rare), update `buildStructureTree`.

---

## 16. Quick reference — key commands

```bash
# Apply migrations to staging
supabase link --project-ref cbskbnvvgcybmfikxgky --password 'ArnoM@77heu5'
supabase db push --password 'ArnoM@77heu5'

# Run cable-schedule tests
pnpm --filter @esite/shared exec vitest run src/services/cable-structure.service.test.ts
pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts

# Typecheck
pnpm --filter @esite/shared exec tsc --noEmit
pnpm --filter web exec tsc --noEmit    # expect exactly 5 pre-existing errors, none in cable-schedule

# Commit & ship
git add <specific files only — never -A>
git commit -m "feat(cable-schedule): …"
git push origin feat/powersync
# Promote to production:
git tag main-pre-<topic>-$(date +%Y-%m-%d) origin/main && git push origin <tag>
git push origin origin/feat/powersync:main

# Query staging directly (service-role key in .secrets/supabase.md)
curl "$SUPABASE_URL/rest/v1/<table>?select=…" \
     -H "apikey: $SR" -H "Authorization: Bearer $SR" \
     -H "Accept-Profile: cable_schedule"
```

---

## 17. Related design docs (in this repo)

- `docs/cable-schedule-c12-editable-design.md` — Original C12 editable-schedule design (Session 22)
- `docs/cable-schedule-c12-editable-plan.md` — C12 implementation plan
- `docs/superpowers/specs/2026-05-14-cable-schedule-ui-redesign-design.md` — UI redesign (progressive Add-cable, always-visible Structure)
- `docs/superpowers/plans/2026-05-14-cable-schedule-ui-redesign.md`
- `docs/superpowers/specs/2026-05-14-auto-parallel-cables-design.md` — Auto-parallel cables
- `docs/superpowers/plans/2026-05-14-auto-parallel-cables.md`
- `docs/superpowers/specs/2026-05-15-cable-calc-honesty-and-display-design.md` — SANS calc-honesty + per-cable load share + Conductor as primary field
- `docs/superpowers/specs/2026-05-15-cable-schedule-structure-tree-design.md` — Structure-panel feed-tree design
- `docs/superpowers/plans/2026-05-15-cable-schedule-structure-tree.md` — Structure-tree implementation plan
- `SPEC DOCS/cable-schedule/WEB_APP_BUILD_PROMPT.md` — Original module-build prompt
- `SPEC DOCS/cable-schedule-session-22-handoff.md` — C1–C8 detailed handoff (Session 22)

---

**End of consolidated state.** A new session should be able to bootstrap from this doc + `CLAUDE.md` alone. Do not modify the SANS-honesty contracts (`null` on miss → `—` rendering) without a deliberate calc-honesty redesign — it's the engineering correctness anchor.
