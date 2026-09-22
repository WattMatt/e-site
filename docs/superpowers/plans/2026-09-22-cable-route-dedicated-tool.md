# Cable route dedicated tool — implementation plan

> Executed inline in the session that wrote it (owner asked for token economy;
> a code-complete plan would duplicate the implementation). Spec:
> `docs/superpowers/specs/2026-09-22-cable-route-dedicated-tool-design.md`.

**Goal:** move cable route tracing out of the drawing viewer into
`/projects/[id]/cables/[revisionId]/measure`, on a dedicated canvas, with the
viewer keeping a read-only route overlay. No migration.

**Architecture:** extract three sheet primitives from `MarkupCanvas` into
`apps/web/src/lib/sheet/` (image, viewport, draft store), build
`RouteCanvas` on them plus `RouteLayer`, rewrite `RouteMeasureWorkspace` as a
three-column tool that owns the persist path moved from `DrawingViewer`, then
delete route mode from the three viewer files.

**Stack:** Next 15 app router, React 19, react-konva, pdfjs-dist, vitest.

---

### Task 1: `lib/sheet/draft-store.ts`
- Create `apps/web/src/lib/sheet/draft-store.ts`: `getDraft<T>(key)`, `setDraft<T>(key, value)`, `clearDraft(key)` over IndexedDB `esite-markup-drafts` / store `drafts` (names unchanged so existing drafts survive).
- Modify `MarkupCanvas.tsx`: delete the inline `openDraftDB/getDraft/setDraftRecord/clearDraftRecord` block (lines 232–291) and import from the module; keep `DraftRecord` type local.
- No unit test (IndexedDB is not in jsdom); covered by the contract test in Task 8.

### Task 2: `lib/sheet/viewport-math.ts` + `use-sheet-viewport.ts`
- Create `viewport-math.ts`: `fitTransform(viewport, image) → { scale, offset } | null` (0.95 margin, centred; null when either side < 50 or the image is empty) and `zoomAbout(prev, offset, factor, anchor) → { scale, offset }` (clamped 0.05..8, anchor stationary).
- Test `viewport-math.test.ts`: fit centres a landscape image inside a portrait viewport; zoomAbout keeps the anchor's image coordinate fixed (compute `(anchor - offset)/scale` before and after); clamp at 8 returns the same offset.
- Create `use-sheet-viewport.ts`: `useSheetViewport({ containerRef, image, resetKey, onPinchStart })` returning `{ viewport, scale, offset, setOffsetFromStage, fitToView, zoomIn, zoomOut, gestureActive, panning, spaceHeld, touchCountRef, panningRef }`. Body = MarkupCanvas lines 1091–1137, 1173–1324, 1358–1476 verbatim, with `setCurrent(null)` + `setPolyPoints(rollback…)` replaced by `onPinchStart()`.
- Modify `MarkupCanvas.tsx` to call the hook; `onPinchStart` does the two calls it did inline; fullscreen stays in MarkupCanvas.

### Task 3: `lib/sheet/use-sheet-image.ts`
- Create hook: `useSheetImage({ planId, signedUrl, isPdf, initialPage }) → { img, currentPage, setCurrentPage, pageCount, loadError }`. Body = MarkupCanvas lines 841–847, 970–1081 verbatim (pdfjs worker path `/pdf.worker.min.mjs`, `getViewport({ scale: 2 })`, page cache, signed URL through a ref, reset on `planId`/`isPdf`/`initialPage`).
- Modify `MarkupCanvas.tsx` to call it; `backingSize` moves into the module and is exported.

### Task 4: `RouteCanvas.tsx` (+ `route-canvas-logic.ts`)
- Create `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/route-canvas-logic.ts` (pure): `sheetEndpoints(legs, planId, page)`, `nextStatusStep({ pending, drafting, legs, assigned })`, `runAssigned(scheduleLengthM, total, legs)`. Test each.
- Create `RouteCanvas.tsx` per spec §2. Toolbar: Trace · Select · Set scale · ↶ ↷ · zoom −/fit/+ · page ‹ n/N › · Export sheet. Status strip and the pending/selected action bar as in MarkupCanvas 2728–2806. Calibration picking via `calibrateFloorPlanAction` (per page). Keyboard as MarkupCanvas 1480–1504.

### Task 5: `RouteMeasureWorkspace.tsx` rewrite + `page.tsx`
- `page.tsx`: parse `?supply`, `?sheet`, `?page`; load plans with calibration columns; for the active sheet mint a signed URL and load `floor_plan_page_scales`; add `updatedAt` and `revisionId` to `RunRow`; compute `otherLegsOnSheet` from loaded segments; pass `activeSheet` to the workspace.
- `RouteMeasureWorkspace.tsx`: three columns; run list in state seeded from props; `persistSegments`, history, restore, remeasure, reorder, conflict banner moved from `DrawingViewer` 277–470; `router.replace` on run/sheet change; `applySaveToRun(run, segments, riseM, dropM, updatedAt)` pure helper in `route-canvas-logic.ts` with a test.
- `RouteCanvas` loaded with `next/dynamic({ ssr: false })`.

### Task 6: the viewer loses route mode
- `MarkupCanvas.tsx`: delete `routeMode`, `cablePicker`, the `cable` tool, `ROUTE_TOOLS`, route state, route effects, route strips, route toolbar, the route branch of `finishPoly`/`onPointerDown`/`saveCalibration`/keyboard, the route `RouteLayer` branch; `ViewerMode = 'view' | 'markup' | 'rfi'`; keep `routeOverlay`.
- `DrawingViewer.tsx`: delete `route`, `cableSchedule`, `openRoutePicker`, `routeUnavailableReason`, the Route tab, picker, route rail and persist path; add `measureHref?: (supplyId: string) => string`.
- `page.tsx` (viewer): delete `loadRouteContext`, `loadCableSchedule`, the `supply`/`route` params; add `loadDraftRevisionId` gated on `ORG_WRITE_ROLES`; keep `loadLegsOnSheet`.
- `viewer-state.ts`/`.test.ts`: drop the `'route'` case.
- `DrawingsList.tsx` + `floor-plans/page.tsx`: `traceHref: string | null` (measure page + `?sheet=`), rendered only when set.
- `CableScheduleGrid.tsx`: `trace →` gains `&sheet=<last leg's sheet>` when known.

### Task 7: docs
- `docs/rbac-matrix.md`: drop the `?mode=route` row; update the 2026-09-14 note.
- `docs/cable-route-measurement.md`: doors and workflow now name the measure page.

### Task 8: contract test + e2e
- `apps/web/src/app/(admin)/projects/[id]/floor-plans/[planId]/viewer-has-no-route-mode.contract.test.ts` per spec §Testing; prove red by grepping for a reintroduced token before the deletion lands (run it after Task 4, before Task 6: it must fail).
- `apps/web/e2e/tests/12-cable-route-measure.spec.ts`: navigate to `/cables/<rev>/measure?supply=&sheet=`; trace; save; recall on the plain drawing; remove.

### Task 9: verify, PR, deploy
- `pnpm --filter web test -- --run`, `type-check`, `lint`; `@esite/shared` and `@esite/db` suites unchanged but run.
- Browser walk on the dev server against production data (`preview_start`), then PR, CI, merge, Vercel production commit check.
