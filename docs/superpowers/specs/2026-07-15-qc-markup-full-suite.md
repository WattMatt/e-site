# QC markup — adopt the full MarkupCanvas suite + full drawings list

**Date:** 2026-07-15
**Status:** approved (user-confirmed decisions below)
**Context:** The shipped QC-reports "Add drawing markup" used the simple
`FloorPlanAnnotator` via `FloorPlanAttachDialog`, which (a) filters the drawing
picker to image files only — **PDF drawings never appear** — and (b) offers only
a 7-tool basic palette. The full markup suite (symbols, tables, measure,
fullscreen, zoom/pan, multi-page PDF rasterisation, 14 shape types) already
exists as `MarkupCanvas` but its save layer is hardwired to create RFIs.

## Confirmed decisions
1. **Inline dialog** — surface the full `MarkupCanvas` in a dialog inside the QC
   entry flow (pick drawing incl. PDFs → mark up → save without leaving the
   report). NOT a navigate-to-floor-plans flow.
2. **Current-page-per-markup** for multi-page PDFs — each save flattens the page
   the user is on (identical to today's RFI markup). Add another markup for
   another page.

## Approach (Option A — no DB migration)

`qc_entry_photos` already has `annotation_data JSONB`, `source_floor_plan_id`,
`kind IN ('photo','markup')` — no schema change. QC persistence stays
**client-side** via `uploadQcMarkup`/`replaceQcMarkup` (no server action → no 10MB
body cap, QC RLS insert policy is the gate).

### 1. Decouple `MarkupCanvas` (surgical — RFI path must stay byte-identical when the new prop is absent)
- File: `apps/web/src/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas.tsx`.
- Add optional prop `onSaveMarkup?: (out: { pngBlob: Blob; scene: SceneGraph }) => Promise<void>`.
- Make `rfis` default `[]` and `editing` optional (already nullable). Add optional
  `initialScene?: SceneGraph` for QC re-edit hydration (RFI keeps using `editing`).
- Add a `saveLabel?: string` / infer: when `onSaveMarkup` is set, MarkupCanvas is
  in **external-save mode**:
  - `handleSaveClick` → `snapshotScene()` → base64→Blob → `await onSaveMarkup({pngBlob, scene})`; do NOT touch any `*RfiAnnotationAction` / `createRfiAction`, do NOT open the RFI picker, do NOT `router.push('/rfis/...')`.
  - Toolbar: render a single **Save markup** / **Update markup** (when re-editing) button; hide `+ Create RFI` / `Attach to RFI` and the picker dialog.
  - Hydrate initial shapes from `initialScene` when provided (same code path as `editing.scene`).
- The RFI code paths (`submitNewRfiWithAnnotation`, `submitNewAnnotation`, the
  picker JSX, the RFI action imports) execute ONLY when `onSaveMarkup` is
  undefined. Guard, don't delete. Existing RFI tests + `05c-rfis`/geometry/symbol
  tests must stay green.

### 2. New `QcMarkupDialog` (client, `ssr:false` MarkupCanvas host)
- `apps/web/src/app/(admin)/projects/[id]/quality-control/[reportId]/QcMarkupDialog.tsx`.
- Two states: **drawing picker** then **canvas**.
- Picker: query `tenants.floor_plans` where `project_id`, `is_active`, order
  `created_at desc` — **NO extension filter** (this is the "access the current
  drawing list" fix). Show PDFs/images/DWG. Sign each from the `drawings` bucket.
  Compute `isPdf = /\.pdf$/i.test(file_path)`; DWG/DXF rows are shown but
  non-markable → disabled with a hint (mirror `[planId]/page.tsx` which renders a
  fallback for non-image/non-PDF).
- On select → dynamic-import `MarkupCanvas` (`{ ssr:false }`, mirror
  `DrawingViewer.tsx`) with `plan` = `{ id, signedUrl, width_px, height_px,
  pixels_per_meter, isPdf }`, `projectId`, `snagPins: []`, `mode:'markup'`, and
  `onSaveMarkup` set. In re-edit, also pass `initialScene`.
- `onSaveMarkup` → caller-supplied handler:
  - **Add flow** (new entry): stage `{ blob, scene, sourceFloorPlanId, fileName }`
    into the entry form's markups list (upload happens on entry submit, unchanged
    staging model).
  - **Re-edit flow**: `replaceQcMarkup(supabase, { id, filePath }, { blob, scene })`
    then `router.refresh()`.

### 3. Persistence + schema handling
- Store the full `SceneGraph` in `qc_entry_photos.annotation_data` (JSONB —
  untyped, no migration). Keep storing `source_floor_plan_id` (for re-signing on
  re-edit) and the flattened PNG file (unchanged — the PDF report + thumbnails read
  the PNG).
- `apps/web/src/lib/qc-photos.ts`: widen the `annotationData` param type on
  `uploadQcMarkup`/`replaceQcMarkup` to accept `SceneGraph` (union with the legacy
  `AnnotationData`). No behaviour change — it already stores whatever it's given.
- Re-edit read path (`QcEntryCard`/detail `page.tsx`): feed stored
  `annotation_data` into `MarkupCanvas` as `initialScene`. Add a defensive
  `toSceneGraph(data)` helper: if it looks like the legacy `AnnotationData`
  (`canvas.width`/`baseImage` present) convert the 7 legacy shapes to `SceneGraph`
  equivalents; else pass through. (The feature is <1 day old — legacy rows are
  unlikely, but be robust.)
- Re-sign the source plan for re-edit from `source_floor_plan_id` (existing
  `handleReEditMarkup` logic); fall back gracefully if the plan was deleted (the
  scene still renders on a blank canvas at its stored dims).

### 4. Wire-in
- `AddQcEntryForm.tsx`: replace `FloorPlanAttachDialog` with `QcMarkupDialog`
  (add mode). Staged markup payload carries `scene` instead of `annotationData`.
- `QcEntryCard.tsx`: replace the re-edit `FloorPlanAttachDialog` with
  `QcMarkupDialog` (re-edit mode, `initialScene`).
- Leave the legacy `FloorPlanAnnotator`/`FloorPlanAttachDialog` in place — RFI
  create/respond still use them; do not touch that.

## Non-goals (v1)
- No multi-page "save all pages at once" (confirmed: current-page-per-markup).
- No change to the RFI markup flow, the RFI annotator, or `rfi_annotations`.
- No DB migration; no new server action (client-direct upload keeps the QC RLS
  gate + avoids the body cap).
- No mobile.

## Verification
- RFI regression: `pnpm --filter web test` (RFI action/annotation/geometry/symbol
  tests green); manually reason through `handleSaveClick` when `onSaveMarkup`
  undefined = unchanged.
- New: QcMarkupDialog picker lists PDFs; save stages/persists a `SceneGraph`;
  re-edit hydrates; `toSceneGraph` converts a legacy `AnnotationData`.
- `pnpm --filter web type-check`, `lint`, `build` green.
- Prod: throwaway project with a **PDF** floor plan → QC entry → open dialog →
  confirm the PDF appears + renders in the canvas → place a symbol/table/measure →
  save → PDF report embeds the flattened markup → re-edit reopens the scene.
