# Cable Export Fixes — Implementation Plan

> Execute with superpowers:executing-plans / TDD. Spec: `docs/superpowers/specs/2026-06-24-cable-export-fixes-design.md`.
> Branch: `feat/cable-export-fixes` (stacked on the tenant-electrical work / PR #96, for the breaker engine).

**Goal:** close the 12 export-review findings, starting with the user-visible data gaps (breaker + per-cable amps), then honesty/robustness, then refactors.

**Testable seam:** the renderers are pure functions of `ExportPayload`. `export-payload.ts` does DB I/O (not unit-tested here — type-checked + exercised by the CSV/Excel tests via a cast fixture).

---

## Phase A — data completeness (High)

### Task A1 — breaker on `EnrichedRun` + CSV columns + per-cable amps (this slice)
**Files:** `export-payload.ts`, `export-csv.ts`, new `export-csv.test.ts`
- [ ] Test first: `renderCsv('schedule', …)` header includes `breaker_a`,`pole_config` and the row shows them; `renderCsv('tags', …)` includes `derated_current_rating_a`.
- [ ] `export-payload.ts`: add `incomer_breaker_a, incomer_pole_config` to the `nodes` select + `ExportPayload['nodes']` type; add `breaker_a: number|null`, `pole_config: string|null` to `EnrichedRun`; populate in the `runs.push` from `nodeById.get(supply.to_node_id)` as `breaker_rating_a ?? incomer_breaker_a` (poles likewise).
- [ ] `export-csv.ts`: add `breaker_a`,`pole_config` to schedule header+row (after `load_a`); add `derated_current_rating_a` to tags header+row.
- [ ] GREEN + `tsc`.

### Task A2 — Excel + PDF breaker column
**Files:** `export-excel.ts`, `export-pdf.ts`
- [ ] Excel: add a "Breaker A" column (header + cell + width + number format) after Load; keep importer round-trip header labels intact (append at the end of the data columns to avoid breaking the importer regex anchors).
- [ ] PDF: add a Breaker column to the schedule table layout (recompute column widths to fit landscape A4).
- [ ] Verify via exceljs read-back (Excel) + render-without-throw (PDF) tests; manual visual.

---

## Phase B — honest behaviour (Medium)
- [ ] **B1** explicit cost-redaction note (CSV already does a NOTE row — extend to ZIP README + Excel title block).
- [ ] **B2** ExportMenu hint: "Filters apply to CSV only" tooltip.
- [ ] **B3** empty-state (0 cables) placeholder for schedule CSV/Excel + revision-pack PDF.
- [ ] **B4** QR-failure log + `QR FAILED` marker (`export-pdf.ts`, `export-avery-labels.ts`).
- [ ] **B5** `Content-Length` on CSV/PDF responses where known.

## Phase C — maintainability (Low)
- [ ] **C1** `export-format.ts` shared numeric formatters; replace `round2`/`fmt`/`numFmt`.
- [ ] **C2** `export-util.ts` shared `groupRunsBySectionConductor`; use in CSV/Excel/PDF.
- [ ] **C3** `withExportAuth()` wrapper; apply to all export routes.
- [ ] **C4** `validateUuid()` on route params → 400.
- [ ] **C5** ExportMenu filter persistence via `useSearchParams` (or self-contained filter UI).

---

## Sequencing
A1 (now) → A2 → B → C. Each task ends green + committed. A1 is the smallest end-to-end win and unblocks A2 (shares the `EnrichedRun.breaker_a` field).
