# Cable Schedule — Export Review Fixes

**Date:** 2026-06-24
**Status:** Design — awaiting review
**Origin:** the export review from the 2026-06-23 discovery (12 findings). User scope: **fix everything** (High + Medium + Low).
**Suggested home:** its own branch off `main` (separate from the tenant-electrical PR #96).

## Goal

Close the 12 issues found in the cable-schedule export review: add the missing electrical data (breaker + per-cable amps), make redaction/filters/empty-states honest, harden the routes, and de-duplicate exporter logic — without changing the (good) existing layout/branding.

## Affected code

- Routes: `apps/web/src/app/api/cable-schedule/export/{csv,excel,pdf,zip,multi-zip,tag-labels,tag-list}/route.ts`
- Renderers/lib: `apps/web/src/lib/cable-schedule/export-{payload,csv,excel,pdf,zip,multi-zip,avery-labels,tag-list-pdf,role,filename}.ts`, `assert-export-policy.ts`, `export-watermark.ts`
- UI: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/ExportMenu.tsx`
- Reused: the breaker engine from the tenant-electrical work (`@esite/shared` `deriveIncomerBreaker`) for breaker derivation where a node value is absent.

---

## Phase A — Data completeness (High)

### A1. Breaker rating in exports *(High)*
Today `breaker_rating_a` / `pole_config` are never joined into the export payload. 
**Fix:** in `export-payload.ts`, join `structure.nodes` for each run's `to_node_id` and add `breaker_a` + `pole_config` to `EnrichedRun`. Display value = `node.breaker_rating_a ?? node.incomer_breaker_a` and `node.pole_config ?? node.incomer_pole_config` (reuses the persisted derivation from the tenant-electrical feature; for boards the manual value is normally set). Add a **Breaker (A)** column to schedule CSV, Excel, and PDF (after Load), formatted e.g. `63 TP`.

### A2. Per-cable derated amps *(High)*
Schedule exports collapse to run-level `combined_capacity_a`; the per-strand `derated_current_rating_a` is internal only.
**Fix:** add `derated_current_rating_a` to the **tags CSV** (one row per cable already), and add a **Per-cable A** value on the Excel/PDF expanded/strand detail. Keep run-level `combined_capacity_a` as the headline. Document that schedule rows are run-level by design.

---

## Phase B — Honest behaviour (Medium)

### B1. Explicit cost-redaction *(Medium)*
Redacted exports silently drop cost (empty/omitted). 
**Fix:** render an explicit single-row CSV `NOTE,Cost data redacted for your role`; add a redaction line to the ZIP `README.txt` and the Excel title block. No silent omission.

### B2. CSV filter parity / honesty *(Medium)*
`?filter/size/conductor` apply to CSV only; Excel/PDF/ZIP silently ignore them.
**Fix (chosen):** add a visible hint in `ExportMenu.tsx` — "Filters apply to CSV only" with a `?`-tooltip — and document it. (Full filter support in Excel/PDF/ZIP is out of scope for this pass; revisit if requested.)

### B3. Empty-state outputs *(Medium)*
Revision-pack PDF and schedule CSV/Excel render misleading near-empty files at 0 cables.
**Fix:** when `cables.length === 0`, render a single placeholder page ("No cables in this revision yet") for PDF, and a one-line note row for CSV/Excel — mirroring the existing tag-list/Avery empty-state handling.

### B4. QR-failure visibility *(Medium)*
QR generation failures are swallowed (`catch {}`).
**Fix:** `console.error`/pino-log the failure and render a small `QR FAILED` marker in place of the code so a missing QR is visible.

### B5. Response header hygiene *(Medium-low)*
**Fix:** add `Content-Length` where the byte length is known (CSV/PDF buffers); confirm Excel MIME; keep `Cache-Control: no-store`.

---

## Phase C — Maintainability (Low)

### C1. Shared numeric formatting
Extract `formatDecimal/formatZero/formatCurrency` into `export-format.ts`; replace the per-file `round2`/`fmt`/`numFmt` ad-hoc logic. One null convention (`null → ''`).

### C2. Shared section grouping
Extract `groupRunsBySectionConductor()` (NORMAL→EMERGENCY, CU→AL) into `export-util.ts`; import in CSV/Excel/PDF (currently duplicated 3×).

### C3. Central export auth
Add `withExportAuth(handler)` wrapper enforcing auth + `getExportPolicy` once; apply to all export routes (removes per-route duplication; multi-zip's bespoke check folds in).

### C4. Param validation
Add `validateUuid()` for `projectId`/`revisionId` query params at each route entry → `400` on malformed input (defense-in-depth; PostgREST is parameterized already).

### C5. ExportMenu filter persistence
Document/ensure the parent persists filter state via `useSearchParams` so CSV filters survive reload (or move the filter UI into `ExportMenu`).

---

## Testing strategy (TDD)

- **A1/A2:** unit-test `export-payload` enrichment (breaker join + per-cable amps) with fixture supplies/cables/nodes; snapshot a CSV row containing the new columns.
- **B1:** assert the redacted CSV emits the explicit NOTE row (role = client_viewer).
- **B3:** assert 0-cable CSV/Excel/PDF produce the placeholder, not an empty body.
- **B4:** mock QR failure → assert log + `QR FAILED` marker.
- **C1/C2:** unit-test the extracted formatters + grouping; existing exporter tests must stay green.
- **C3/C4:** route tests for unauthorized + malformed-id → 403/400.

## Sequencing

A (data completeness, the user-visible wins) → B (honesty/robustness) → C (refactors, behind unchanged outputs). Each phase independently shippable; A reuses the breaker engine already merged via PR #96.

## Out of scope

Layout/branding redesign; full filter support in Excel/PDF/ZIP (B2 ships the hint only); the tenant-schedule report extension (separate).
