# Cable route measurement — the process

**Status:** built on `feat/cable-route-viewer-handoff` (2026-09-14/15), replacing the PR #180 surface. Migrations `00192` (routes), `00198` (calibration geometry), `00199` (route history, per-page scales, telemetry). Gap analysis and design: `docs/superpowers/specs/2026-09-15-cable-route-measurement-complete-design.md`.

## What it is

A cable run's length is traced on the drawing rather than typed. The trace is a **route**: an ordered list of **legs**, one per sheet the run crosses, each a polyline in that drawing's pixel space with the drawing's scale *at the moment it was traced* and the metres that scale produced. Rise and drop are typed per run. The route is a measurement record; **it never changes a schedule length on its own.**

```
supply (MB 1.1 → DB-10)
└── supply_route          1 per run per revision · rise_m, drop_m, total_length_m
    └── route_segment     ordered legs · floor_plan_id, page_index, points[], pixels_per_meter, length_m
```

## The workflow, and what each step writes

| # | You do | Where | What is written |
|---|---|---|---|
| 1 | Pick a run | ⚡ *Measure a cable run* on any drawing · `trace →` on the schedule grid · the measure worklist | nothing |
| 2 | Set the sheet's scale, once, if it has none | *Set scale* in route mode (or Calibrate in markup) | `tenants.floor_plans.pixels_per_meter` + the two points and metres (`00198`) |
| 3 | Trace: click the corners, double-click to finish, **Save leg** | the drawing | one `route_segment`; the server re-measures from the sheet's scale and stores *its* figure |
| 4 | Continue on another sheet if the run crosses one | *Continue on* in the banner | another `route_segment` |
| 5 | Rise & drop | the rail on the drawing, or the worklist — the same panel | `supply_route.rise_m / drop_m` |
| 6 | **Assign to schedule** (confirming an overwrite if a length exists) | same panel | every strand's `measured_length_m`, method `SCALE_RULE`, `measured_length_by/at`, a `change_log` row |
| 7 | **Export sheet** | the drawing | a versioned PDF (sheet + legend) in `projects.reports`, kind `cable_route_sheet`, listed under *Exported sheets* |

Step 3 is the only "save" you press repeatedly; 5 and 6 are one panel; 7 is optional. *Back to schedule* is navigation, not a save — nothing is lost by pressing it, because every leg was saved when you pressed **Save leg**.

## Recall

Every drawing shows its saved routes whenever it is opened — view, markup or route mode — with per-edge lengths, toggleable from the toolbar. Press a route to measure that run. On the schedule grid, a run whose length came from a trace carries a **traced** badge linking to its route. On the worklist, a run is *outstanding* until it has a route with at least one leg.

## While tracing

- **Undo / redo** — ⌘Z / ⇧⌘Z or ↶ ↷ in route mode. One history covers everything you can see change: vertices as you place them, the pending leg, and every saved edit (a dragged vertex, an inserted or removed one, a deleted leg). Undoing a saved edit re-saves the previous state; it is not a client-side illusion.
- **Snapping** — a new leg's first vertex snaps to the end of a leg already saved on the sheet so the run joins up; hold **Shift** to constrain a vertex to 0/45/90° from the previous one (cable trays are orthogonal). The strip says what snapped.
- **An unsaved trace survives** — the polyline you are clicking out and a finished-but-unsaved leg are kept in the browser per drawing, run and page, and brought back if you reload or navigate away; the strip says *restored an unsaved trace from HH:MM*. Saving the leg clears it.
- **Scale per page** — a multi-page PDF can carry a different scale on each page; *Set scale* on page N sets page N's. Page 1 uses the drawing's scale. A leg on a page with no scale is refused, naming the page.
- **Two people, one run** — a save carries the route's last-known timestamp; if someone else saved first, yours is refused with when, and the viewer offers Reload. Nothing is silently overwritten.

## History

Every save writes a row to `cable_schedule.route_history` — who, when, why (*save*, *restore*, *remeasure*), and the whole leg list as it was. The rail's **History…** lists them; **Restore** puts the route back to any earlier state verbatim (the lengths and scale-at-the-time as they were — nothing is re-measured), and that restore is itself a history row. The log has no update or delete policy: it cannot be edited, only added to.

## Carrying the sheets with the schedule report

An exported route sheet is the evidence for the traced lengths, so the schedule's own report can carry it. On the revision page, **Export** offers *Include the marked-up route sheets (N)* whenever this revision has exported sheets — ticked by default, the user's choice either way:

- **PDF revision pack** — an *Appendix — Cable route sheets* divider (sheet, version, export date, freshness) followed by every sheet's own pages (A3 drawing + A4 legend, their own sizes).
- **Revision pack (ZIP)** and **All ISSUED revisions (ZIP)** — the same appendix inside the pack PDF, plus each sheet as its own file under `route-sheets/` (an A3 prints better on its own), listed in the README.
- Excel, tag labels and the CSVs are tabular and never carry a drawing.

"Applicable" means the **current** version of every (drawing, page) exported **for this revision** — a sheet records the revision whose runs its legend lists (`summary.revisionId`) and its PDF page (`summary.page`), and versions run per (drawing, page, revision), so exporting page 2 never retires page 1's sheet and Rev 1's export never retires the sheet behind the issued Rev 0 report. A sheet whose routes were saved after it was exported is flagged *routes changed after export* in the menu, the appendix and the README — re-export it from the drawing to carry the latest trace. Caps: 20 sheets / 40 MB per pack; anything beyond is listed as not included, never silently dropped.

Server side this is `lib/cable-schedule/route-sheets.ts` (`listRouteSheetsForRevision`, `loadRouteSheetAttachments`, `appendRouteSheetsToPdf`), read through the caller's session and gated exactly as the export routes are (`?routeSheets=1`).

## What can change a stored length

- Editing a leg (drag / insert / remove a vertex) rewrites that leg's points and length — the route's total updates; the schedule does **not** until you Assign again.
- Recalibrating a sheet does **not** change any stored leg. The rail and the worklist flag such legs *sheet re-scaled since tracing*; the rail offers **Show what re-measuring would change** — a per-leg before/after — and then **Re-measure**, which re-derives those legs from their stored points and the sheet's current scale and logs a *remeasure* history row.
- Assigning replaces `measured_length_m` and records the old value in the change log. It promotes `UNMEASURED` → `MEASURED` and leaves a `CONFIRMED` or `DISCREPANCY` status alone, the same rule as typing a length in the grid.
- **Revert to previous length** (in the panel, once a route is on the schedule) puts each strand back to what the change log says it held before the last Assign — as `MANUAL`, or `UNMEASURED` if it had none — and logs that too.
- An ISSUED revision is frozen by database trigger: no route on it can be written.

## Who may do what

Tracing, calibrating from route mode, assigning and exporting need `ORG_WRITE_ROLES` (owner / admin / project manager) — the schedule's write role. The drawing viewer itself admits `contractor` for markup and RFIs; a contractor never sees route mode or the ⚡ tool. Reading routes on a drawing and reading an exported sheet is open to every project role. See `docs/rbac-matrix.md`.

## Outputs and records

Beyond the sheet PDF: the worklist offers a **Routes CSV** (every run with legs, sheets, traced, rise, drop, total, schedule length, on-schedule); the schedule's own CSV and Excel exports carry a **Method** column (`MANUAL` / `SCALE_RULE` / `CAD`); and three product events — `cable_route_leg_saved`, `cable_route_assigned`, `cable_route_sheet_exported` — make the tool's use measurable on `/metrics`.

## Known gaps

- The markup toolbar's own calibration write (since `00035`) is still open to contractors; narrowing it is an owner decision.
- A member promoted to PM on one project (`project_members`) passes the page gate but is refused by RLS, which keys on the org role. Fail-closed; no such user exists today.
- `supply_routes.notes` is stored but has no control.
- Split / merge of legs, export from the worklist, and a low-resolution preview during rasterisation were deliberately left out (owner decision, 2026-09-15). `RouteLayer` has no component test (Konva needs a real canvas); the Playwright spec `12-cable-route-measure` covers the flow end to end when `E2E_ROUTE_*` is set.
- `packages/db/src/types.ts` has not been regenerated; the actions cast `.schema('cable_schedule')`.
