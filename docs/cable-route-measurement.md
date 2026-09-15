# Cable route measurement — the process

**Status:** built on `feat/cable-route-viewer-handoff` (2026-09-14/15), replacing the PR #180 surface. Migrations `00192` (routes) and `00198` (calibration geometry).

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

## What can change a stored length

- Editing a leg (drag / insert / remove a vertex) rewrites that leg's points and length — the route's total updates; the schedule does **not** until you Assign again.
- Recalibrating a sheet does **not** change any stored leg. The rail and the worklist flag such legs *sheet re-scaled since tracing*; re-trace or accept.
- Assigning replaces `measured_length_m` and records the old value in the change log. It promotes `UNMEASURED` → `MEASURED` and leaves a `CONFIRMED` or `DISCREPANCY` status alone, the same rule as typing a length in the grid.
- An ISSUED revision is frozen by database trigger: no route on it can be written.

## Who may do what

Tracing, calibrating from route mode, assigning and exporting need `ORG_WRITE_ROLES` (owner / admin / project manager) — the schedule's write role. The drawing viewer itself admits `contractor` for markup and RFIs; a contractor never sees route mode or the ⚡ tool. Reading routes on a drawing and reading an exported sheet is open to every project role. See `docs/rbac-matrix.md`.

## Known gaps

- The markup toolbar's own calibration write (since `00035`) is still open to contractors; narrowing it is an owner decision.
- A member promoted to PM on one project (`project_members`) passes the page gate but is refused by RLS, which keys on the org role. Fail-closed; no such user exists today.
- `supply_routes.notes` is stored but has no control.
- `00192`'s column comment says calibration is "per drawing AND page"; the sheet's scale is per drawing, with the page recorded alongside since `00198`. Each leg stores its own scale regardless.
- `packages/db/src/types.ts` has not been regenerated; the actions cast `.schema('cable_schedule')`.
