# Cable route measurement — a dedicated tool in the cable schedule section

**Date:** 2026-09-22
**Status:** approved by the owner (approach 2 of 3), building
**Supersedes the placement decided in:** `2026-09-15-cable-route-measurement-complete-design.md` (the capabilities stand; where they live changes)

## Why

The owner asked how hard it would be to take the cable measuring, tracing,
record-keeping and schedule-updating tool out of the floor-plan markup viewer
and give it a dedicated home in the cable schedule section, "more refined and
dialed in specific to the cable schedule being reviewed".

The design check answers: the current placement is wrong, not buggy. The
drawing viewer is one surface doing three jobs (markup for contractors, RFI
markup, and route measuring for engineers) under two different role gates. That
is why the viewer page evaluates both `MARKUP_WRITE_ROLES` and
`ORG_WRITE_ROLES`, why the disabled Route tab needs its reason supplied by the
page, and why the measuring flow bounces the user between the schedule section
and the drawings section for every sheet.

What is already independent of the viewer and does not change: migrations
00192/00198/00199/00200, `cable-route.service.ts`, every server action in
`cable-route.actions.ts`, `route-history.ts`, `snap.ts`, `route-sheets.ts`,
`RouteLayer.tsx`, `AssignRoutePanel.tsx`. No migration. No schema change.

## What changes

### 1. One page, three columns

`/projects/[id]/cables/[revisionId]/measure` becomes the whole tool.

```
┌ worklist (300px, collapsible) ┬ sheet canvas (flex) ┬ run rail (300px) ┐
│ search · sort · filter        │ toolbar             │ legs traced      │
│ run rows (outstanding first)  │ Konva stage         │ rise & drop      │
│ Routes CSV                    │ status strip        │ assign           │
│                               │                     │ history/restore  │
│                               │                     │ re-measure       │
└───────────────────────────────┴─────────────────────┴──────────────────┘
      exported sheets (SavedReportsPanel) below, as today
```

URL state: `?supply=<id>` (the run), `?sheet=<planId>` (the drawing),
`?page=<n>` (PDF page). Selecting a run or a sheet uses `router.replace` so
the link is shareable and Back is not polluted. The server re-renders on every
URL change and re-mints the sheet's signed URL; the canvas reads that URL
through a ref keyed on `plan.id`, so a re-render never re-rasterises the sheet
(the PR #190 rule).

Gates: unchanged. The page redirects non-`ORG_WRITE_ROLES` callers and
non-DRAFT revisions to the schedule. The rbac matrix loses the
`floor-plans/[planId]?mode=route` row and keeps the `measure` row.

### 2. A dedicated canvas: `RouteCanvas.tsx`

Lives beside the page under `cables/[revisionId]/measure/`. Renders the sheet
image, `RouteLayer`, and the calibration line. Owns exactly the state route
mode owned inside `MarkupCanvas`: tool (`trace` | `select` | `calibrate`),
draft polyline, pending leg, selected leg by position, calibration picking,
snapshot undo/redo, IndexedDB draft autosave per (sheet, run, page), export
sheet as JPEG, keyboard (Enter, Esc, Delete, ⌘Z/⇧⌘Z, F/0/+/-).

It has no markup tools, colours, stroke widths, shapes, RFI picker, saved
layers, snag pins or grid. Its toolbar is: Trace · Select · Set scale ·
undo · redo · zoom in/out/fit · page prev/next · Export sheet.

Props: the sheet (`id`, `signedUrl`, `isPdf`, `width_px`, `height_px`,
`pixels_per_meter`, calibration line, page scales), the run (`supplyId`,
`savedLegs`, `otherLegsOnSheet`), `initialPage`, and callbacks
(`onCommitLeg`, `onUpdateLeg`, `onDeleteLeg`, `onReplaceLegs`,
`onExportSheet`, `onCalibrated`, `onPageChange`). It never calls the server
itself except through those callbacks and `calibrateFloorPlanAction`.

### 3. Shared sheet primitives, extracted from MarkupCanvas

Three pieces of `MarkupCanvas` are generic to "show a sheet and let the user
move around it". They move to `apps/web/src/lib/sheet/` and BOTH canvases
import them, so the two cannot drift (the `_shared/cloud-storage` lesson):

- `use-sheet-image.ts` — `useSheetImage({ planId, signedUrl, isPdf, initialPage })`:
  pdfjs document + per-page rasterisation at `getViewport({ scale: 2 })`,
  raster fallback, page cache, `currentPage`/`pageCount`/`loadError`. Reads the
  signed URL through a ref so a re-minted URL does not reload.
- `use-sheet-viewport.ts` — `useSheetViewport({ containerRef, image, onPinchStart })`:
  scale/offset with refs, fit-to-view, `zoomBy`, wheel classification, two-finger
  pinch and pan, middle-drag and space-drag, F/0/+/- keys. `onPinchStart` is the
  hook's only callback into the caller (MarkupCanvas rolls back a pinch vertex
  and clears its in-progress shape; RouteCanvas rolls back a pinch vertex).
  The pure maths (`fitTransform`, `zoomAbout`) is exported and unit-tested.
- `draft-store.ts` — the IndexedDB `getDraft`/`setDraft`/`clearDraft` trio,
  same database and store names so existing drafts survive.

`MarkupCanvas` keeps its own tools, shapes, transformer, grid, eraser, save
paths and RFI picker untouched. The extraction replaces blocks with hook calls
and changes no behaviour; that is the whole point of keeping the diff on that
file mechanical.

### 4. The viewer loses route mode

- `ViewerMode` becomes `'view' | 'markup' | 'rfi'`. `routeMode`,
  `cablePicker`, the `cable` tool, `ROUTE_TOOLS`, the route status strip, the
  route rail and the Route tab are deleted from `MarkupCanvas`,
  `DrawingViewer` and the viewer page. `loadRouteContext` and
  `loadCableSchedule` go with them.
- The viewer keeps the read-only route overlay (`routeOverlay`) with the
  ⚡ Routes toggle. Pressing a route navigates to
  `/cables/<draftRevisionId>/measure?supply=<id>&sheet=<planId>` when the
  caller holds `ORG_WRITE_ROLES` and a DRAFT revision exists; otherwise the
  overlay is not pressable. The page loads only the draft revision id for this.
- Calibration from the markup toolbar stays exactly as it is (contractors keep
  it, per the 2026-09-15 owner note). Calibration for tracing lives on the
  measure page and goes through the role-gated action.
- The Drawings tab's per-row Trace link points at the measure page with
  `?sheet=<planId>`, and is rendered only when the caller may measure and a
  DRAFT revision exists; a link that lands on a redirect is worse than no link.
- The schedule grid's `trace →` links already point at the measure page and
  gain `&sheet=` when the run has legs (its last sheet).

### 5. Data flow on the measure page

Server (`page.tsx`) loads, as today, the revision, runs, strands, routes and
segments, plus: every active drawing's calibration columns; for the active
sheet only, a signed URL, calibration line and page scales. "Other legs on
this sheet" is derived from the segments already loaded (this revision's other
runs on this sheet), so it needs no extra query.

Client (`RouteMeasureWorkspace`) owns the run list in state seeded from props
and re-seeded when props change. The persist path moves over from
`DrawingViewer` unchanged: one `persistSegments` that replaces the whole list,
refuses orphaned legs, carries the `expectedUpdatedAt` token, and applies the
returned segments and token to state. A save updates the selected run's row in
the list (traced badge, total) without `router.refresh()`, so the worklist
never shows a state the server has not confirmed and the sheet never
re-rasterises. History, restore, re-measure, reorder and the assign panel work
as before; the assign panel's `onChanged` refreshes the server data, which is
safe for the same reason.

## Error handling

Unchanged semantics, relocated: a stale save is refused with the server's
message and a Reload control; an orphaned leg blocks writes with the existing
sentence; a leg on an unscaled page is refused by the server naming the page,
and the canvas disables Trace until the page has a scale; a sheet the canvas
cannot render (DWG) shows the fallback text where the canvas would be and the
worklist still works.

## Testing

- Unit: `use-sheet-viewport` maths (`fitTransform`, `zoomAbout`), the pure
  route-canvas helpers (`nextStatusStep`, `sheetEndpoints`,
  `applySaveToRun`) — each with a case that only the real rule satisfies.
- Contract: `viewer-has-no-route-mode.contract.test.ts` reads the three viewer
  files and fails on `routeMode`, `cablePicker`, `mode=route`, `'route'` in
  `ViewerMode`; and asserts `RouteCanvas.tsx` imports `RouteLayer` and both
  canvases import all three `lib/sheet` modules. Proven red by reintroducing
  one token.
- Existing: web 2083 tests stay green; `viewer-state.test.ts` drops its
  `'route'` case; `12-cable-route-measure.spec.ts` is repointed at the measure
  page (env-gated, as before).
- Browser: the measure page driven in the browser pane on a real project after
  deploy. The signed-in owner walk remains the owner's (the fixture is a
  contractor and is bounced from this page).

## Out of scope

Touch/tablet (untested before, untested now), split/merge legs, a
`SheetCanvas` rebuild of MarkupCanvas, `types.ts` regeneration, any migration.

## Deploy

One PR, no migration. Vercel builds on merge. Verification after deploy:
production commit equals the merge commit (GitHub deployments API), the measure
page returns 307 to login unauthenticated, and the browser walk above.
