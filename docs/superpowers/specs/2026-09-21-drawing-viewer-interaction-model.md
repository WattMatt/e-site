# Drawing viewer — interaction model review and proposal

**Date:** 2026-09-21
**Status:** proposal, no code written — owner decisions outstanding
**Method:** 21 agents across two review workflows, every claim read out of the worktree and the
Konva source. The prescription below is the CORRECTED one: four adversaries returned
"needs-revision" on the first draft and broke its central mechanism. Where the first draft was
wrong, this document says so rather than quietly dropping it.

**Reported by:** owner — *"the process is not seamless and UI friendly, can we put on our pro UI
engineer hat … simple/ clean/ easy/ obvious"*, after asking for middle-drag panning "no matter where
we are in the functions and or process … so we can use the same wheel to zoom and pan while tracing".

---

## 1. What is actually wrong

Five things. Two are defects I shipped this morning; the rest predate today.

**① Nothing in the viewer reads which mouse button was pressed.**
`onPointerDown` (`MarkupCanvas.tsx:1649`) never inspects `e.evt.button`. Konva's Stage never reads it
either (`konva/lib/Stage.js:373-410`). So a middle press does not fail to pan — it *fires the tool you
are holding*: lands a numbered pin (`:1691`), opens a blocking `window.prompt` (`:1682`), replaces a
calibration point (`:1659`), appends a route vertex (`:1795`), or erases and pushes undo (`:1675`). A
middle *drag* draws and commits a real shape, because `onPointerMove` tests `buttons === 1` only for
the eraser (`:1812`) and `onPointerUp` (`:1851`) **takes no argument at all**. With the routes overlay
on — in any mode, including read-only view — a middle press on a route line navigates the page away.
The reflex an AutoCAD user makes in the first ten seconds is the most destructive input on the canvas.

**② On the two devices this product is actually used on, navigation is broken or destructive.**
*Trackpad:* the wheel handler is `e.deltaY < 0 ? 1.1 : 1/1.1` (`:1222`). It reads only the sign of
`deltaY` — never `deltaX`, never `ctrlKey`. Two-finger up zooms in, down zooms out, and a horizontal
swipe zooms **out** (because `deltaY` is 0 and `0 < 0` is false). All four directions of the universal
pan gesture zoom. There is no pan on a MacBook outside the Select tool.
*Tablet:* `onTouchStart={onPointerDown}` (`:3288`) sends the **first** finger into full tool logic; the
two-finger handler only engages when the second lands (`:1226`). Every attempt to pan mid-trace stamps
a vertex first, and `dedupeConsecutivePoints(polyPoints, 3/scale)` (`:705`) cannot collapse it because
pinch fingers are far apart. **Zooming in to place a vertex accurately is what makes the cable length
wrong** — the server re-measures from the geometry it is handed.

**③ Two work-losing defects in the markup save I shipped this morning (PR #196).**
(a) `onModeChange` rebuilds the querystring as `?mode=<next>` and drops `markup=`
(`DrawingViewer.tsx:462`). With a saved layer open, clicking the **RFI** tab blanks the canvas — the
`key={plan.id}:${openMarkup?.id}` remount I added fires with `initialScene` undefined — and then both
RFI buttons grey out on `shapes.length === 0`. Your markup appears to vanish.
(b) `saveFloorPlanMarkupAction` returns the created row (`floor-plan-markup.actions.ts:216`) and
`onSaveLayer` discards it (`DrawingViewer.tsx:244`). The URL never gains `markup=<new id>`, so
`openMarkup` stays null and the **second** Save INSERTs again → `23505` → my own friendly error telling
the user to pick another name when they only wanted to save their work again.
Both were invisible to my tests because those tested the action in isolation with an explicit
`markupId`. The viewer's state threading was never exercised. Same lesson as the rest of this repo:
the check and the artefact were derived from the same intent.

**④ [missing convention] Pan is a property of the Select tool, and leaving a tool destroys that
tool's work — so "move the sheet" and "keep tracing" are mutually exclusive by construction.**
`draggable={tool === 'select' && !gestureActive}` (`:3278`); the tool-change effect wipes `polyPoints`
(`:691`). No space-drag, no middle-drag, no trackpad pan; the whole keyboard surface is `f/0/+/−`.
`⌘Z`, `Enter` and Escape-cancels-a-polyline are bound *inside* `if (routeMode)` (`:1321-1339`) — the
handlers and the stacks exist in both modes, only the guard is wrong.

**⑤ [structural] Of the four things in the mode strip, exactly one is a mode.**
In 3,718 lines `mode === 'rfi'` appears **once**, presetting a dialog radio (`:2087`) that
`openSaveDialog(mode)` immediately overwrites (`:2102`). `mode === 'markup'` appears **once**,
rendering one button (`:2930`). Everything else keys on `mode !== 'view'`, and `view` is `canWrite`
restated. Route is not a mode but a picker that navigates — and the strip is not rendered once route
mode is on (`:515`), **so the mode you enter deletes the only control that could leave it.**

### The dead end that explains the zero

A user told to measure MB 3.1 → DB-50 hits this at step 10 of 20. The polyline *button* is disabled
without a scale (`:2618`), but the canvas handler has no such check (`:1779-1797`) and route mode
force-arms `polyline` without consulting calibration (`:959`). The toolbar says "you cannot", the
canvas says "you can", and both are live. The user traces twelve vertices, double-clicks to finish,
and `Save leg` is dead — `disabled={legSaving || !pixelsPerMeter}` (`:2574`) with **no reason shown**.
Production holds 546 drawings, 5 calibrated. That is a plausible mechanism for cable route measurement
shipping and producing zero routes.

---

## 2. The one principle

> **Navigation is never modal. A tool answers exactly one question — "what does my next left-press
> create?" Everything else the viewer asks as a mode (where am I looking, where does this save, which
> run am I measuring) is a control, not a state you have to be in.**

It deletes rather than adds, it is what this audience already knows from AutoCAD and Bluebeam, and the
same edit that implements it closes the defects: reading the button is simultaneously the pan primitive
*and* the guard that stops a middle press stamping a vertex.

**Honest limit:** it does not abolish modes. Trace *is* real — different table, different role gate
(`ORG_WRITE_ROLES` vs `MARKUP_WRITE_ROLES`), different undo semantics (route undo re-persists to the
server). The target is **one mode boundary with a visible exit**, not zero. The principle's job is to
delete the three fake modes standing next to the real one.

---

## 3. What the adversaries killed, and why it matters

The first draft's load-bearing line was "Stage `draggable` unconditional with `dragButtons={[1]}`".
**That API does not exist.**

- `dragButtons` is a **module global** — `konva/lib/Global.js:43`, read statically as
  `Konva.dragButtons` at `Node.js:1410`. react-konva exposes no such Stage prop. `<Stage
  dragButtons={[1]}>` is an inert attribute.
- Making `draggable` unconditional **kills tablet drawing**: Konva binds `mousedown.konva
  touchstart.konva` and computes `shouldCheckButton = evt.evt['button'] !== undefined`. A TouchEvent
  has no `button`, so `canDrag` is always true — one-finger touch would pan the sheet in every tool.
- **Pan must not be a Konva drag at all.** `Node._setDragPosition` recomputes position from an offset
  captured once at drag start, so a wheel tick mid-drag is not merely discarded, it is *reverted* on
  the next mousemove. "The same wheel to zoom and pan" is impossible if pan is a Konva drag. It must
  write the existing `offsetRef`/`setOffset` model — the one two-finger pinch already uses (`:1258`).
- **The obvious button guard bricks touch.** `if (e.evt.button !== 0) return` — a TouchEvent's
  `button` is `undefined`, and `undefined !== 0`, so the entire canvas goes inert on a tablet. The
  guard must be shaped "fire only for touch, or for `button === 0`", and must not swallow a stylus
  barrel button.
- **8 px tap slop is too tight.** Platform tap slop is ~10–16 CSS px; an iPad logical pixel is
  ~0.19 mm, so 8 px is ~1.5 mm against a gloved contact patch. Gloved taps would silently do nothing.

Also rejected from the first draft: grouping 17 flat tools behind `Draw ▾`/`Shape ▾`/`Text ▾` (that
hides complexity rather than removing it, and doubles the taps for a gloved hand); space-to-pan as a
fourth pan modality; and rebinding double-click from Fit to zoom-in (Fit's only other routes are `f`/`0`
and a button — both useless or relocated on a tablet).

---

## 4. Proposed staging

### Stage 0 — the regression I shipped today. Not a proposal; do it now.
Preserve `markup=` in `onModeChange`; adopt the returned row id after a create so the second Save
overwrites. ~10 lines. Without it, the save feature shipped this morning loses work on its second use.

### Stage 1 — "the sheet moves, and only the left button draws"
Touch is **in** Stage 1, not deferred — the tablet is half the deployment and every other Stage-1 win
(middle button, space bar, ⌘Z) is meaningless there.

- Button-aware input extracted to a **pure, Konva-free module** — `shouldToolFire({pointerType, button,
  gestureActive, movedPx})` — so it is unit-testable. This is the only honestly testable surface:
  Konva cannot run under jsdom (no `canvas` package) and no test mounts this canvas today.
- Middle-drag pans in **every** tool, via `offsetRef`, intercepted in a **capture-phase** listener on
  `containerRef`. Konva binds on `stage.content`, a child div (`Stage.js:684`), so capture on the
  container is the one place that runs first and can suppress tool logic, shape selection, shape drag
  and stage drag together. Plus `preventDefault` on `mousedown` for Windows/Linux autoscroll.
- **Trackpad pan**: honour `deltaX`, and treat `ctrlKey` as zoom and everything else as pan — the
  standard two-line fix that turns every swipe from a zoom into a pan.
- **Touch**: raise `gestureActive` on the *first* pointerdown and settle on the second, so finger one
  no longer writes; commit tap-tools on pointer-**up** past a ≥16 px slop threshold.
- Guard the Stage's `onDragEnd` with `if (e.target !== e.target.getStage()) return` (`:3279`) — closes
  the live defect where nudging a mark writes the *shape's* coordinates into the pan offset.
- Close the calibration trap at the canvas, and arm **calibrate** rather than polyline on an
  uncalibrated sheet.
- Hoist `⌘Z`/`Enter`/`Escape` out of `if (routeMode)`.
- Add `12-cable-route-measure.spec.ts` to a Playwright project — it matches no `testMatch` in
  `playwright.config.ts` and **has never executed**.

**Nothing on screen moves. There is nothing to relearn.**

### Stage 2 — two modes, one Save, one picker
Delete the RFI tab and `mode === 'rfi'`; strip becomes Draw / Trace with Route shown as selected and an
exit; `calibrate` into the palette, `⚡` out; one searchable sheet picker replacing both 546-option
native `<select>`s; one `Save ▾`; a persistent saved/unsaved status line (the app displays that fact
**nowhere** today). Majority deletion. `docs/rbac-matrix.md` moves in the same PR.

### Stage 3 — the tablet, and the way out
44 px targets on a flat palette (not dropdowns); hit areas divided by scale — markup hit areas are
image-space, so the eraser is a 0.7 px needle at fit and 56 px at 4×; tap-a-vertex-to-remove replacing
right-click (which does not exist on a tablet); `window.prompt` → inline input; and **Export/Print for
a saved markup layer** — today a saved markup can be created and viewed in one browser tab and has no
way out of it, which is the very trap `00205` was written to escape.

---

## 5. Deliberately not proposed

- **A Hand tool** — an 18th palette entry to fix a problem caused by navigation being a tool.
- **A pan toggle or preference** — if the answer to "too many modes" is a new mode, it is wrong.
- **Fixing the per-mousemove re-render** (`setOffset` rebuilds ~1,220 lines of JSX and up to 802 grid
  lines). Real, but it optimises a gesture that does not yet exist. Ship Stage 1, pan for ten seconds,
  then measure.
- **Auto-calibrating from the sheet's scale bar.** Tempting at 541 of 546 uncalibrated, and wrong: its
  failure mode is a silently wrong scale producing wrong cable lengths that get signed against.
- **Merging markup shapes and route legs** — different tables, gates and undo semantics. An
  architecture change to make a UI look tidier is the wrong direction of causation.
- **Rewriting the canvas or replacing Konva** — nothing in the complaint is about rendering.

---

## 6. Open decisions for the owner

1. **Scope.** Stage 0+1 alone (small, invisible, fixes the complaint), or commit to Stage 2's model
   simplification? *Recommend: 0+1 now, decide 2 after using it.*
2. **Trackpad pan direction.** Honouring `deltaX`/`deltaY` as pan changes what today's users' muscle
   memory does — today every swipe zooms. *Recommend: change it; the current behaviour is a defect,
   not a convention.*
3. **Can a client see a drawing at all?** `(admin)/layout.tsx:30` bounces org-level `client_viewer` to
   `/portal`, and the portal's floor-plans page is a four-column table with no link, thumbnail or
   download. The read-only viewer was built for an audience the shell redirects one layer earlier, and
   `docs/rbac-matrix.md:53` describes a path they cannot reach. *Recommend: give the portal a read-only
   open, or delete the dead path and correct the matrix.*
4. **Right-click.** It is currently the only way to remove a route vertex, and it does not exist on a
   tablet. *Recommend: tap-a-selected-vertex-to-remove, and reserve right-click.*
