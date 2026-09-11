# Cable route measurement — trace a run on a drawing, assign its length

**Date:** 2026-09-11
**Status:** approved, in build
**Lane:** off the Q1 critical path. This touches no work-item spine object, so it runs alongside item 3 rather than competing with items 1 and 2.

---

## Why

Two thirds of the cable runs in production have no length at all.

| | Measured 2026-09-11 |
|---|---|
| Cable strands with no `measured_length_m` | 367 of 545 |
| Strands with a `confirmed_length_m` | 0 of 545 |
| Active drawings in cable-schedule projects | 359, every one a PDF |
| Drawings with a `pixels_per_meter` | 2 of 389 |

The gap is not spread evenly. KINGSWALK is effectively complete at 162 of 177. ITONKA (103), PNP FAERIE GLEN (96), NLC (54) and SAXBY (46) have **not one measured run between them**. Those four projects are the users of this feature.

**This formalises an existing manual practice rather than inventing one.** All 178 existing lengths are whole metres, but only 36 are multiples of five, so they were scaled off a drawing and rounded rather than estimated. Every one of them is recorded as `measured_length_method = 'MANUAL'`. The enum has offered `'SCALE_RULE'` and `'CAD'` since `00051` and neither has ever been written. The person doing this already opens the drawing, already scales the route, and already types a number. They just do it outside the system, so the route is lost and the number has no provenance.

## The three findings that shaped the design

**1. Calibration is the real blocker, not measurement.** A measure tool already ships in `MarkupCanvas` and is already gated on the drawing having a `pixels_per_meter` (`MarkupCanvas.tsx:199`, `:1933`). Two drawings out of 389 have one, and KINGSWALK has zero across 123 drawings. A design that treats calibration as a precondition someone has already satisfied inherits that 0.5% and strands the feature. **Calibration is therefore a step inside this flow**, offered the moment an uncalibrated sheet is opened for measuring, and it persists on the drawing for every later run.

**2. A run crosses sheets, so the route cannot live in a drawing.** Every drawing is a single named sheet: `643.E.100 POWER LAYOUT PORTION A` through `PORTION J`. A feed from a main board to a distant board leaves the sheet it starts on. If segments were shapes in the per-drawing scene graph, totalling one run would mean opening and parsing every drawing in the project, and "which runs are still unmeasured" could not be asked at all.

**3. The existing measure tool has a silent-rewrite defect that must not be inherited.** `MeasureShape` stores only `points` (`MarkupCanvas.tsx:104`) and the metre readout is recomputed at render from the plan's *current* `pixels_per_meter` (`:1888-1897`). Recalibrating a drawing silently changes every measurement ever taken on it, with no trace. A cable length is a number someone signs a schedule against. **Each segment therefore stores the calibration in force at the moment of measurement**, and a later recalibration raises a flag offering re-measurement instead of quietly changing the answer.

## Shape

The route is a first-class object in `cable_schedule`. The drawing renders it; the drawing does not store it.

```
supply (the logical run A→B)
  └── supply_route            1:1, revision-scoped, holds rise_m + drop_m
        └── route_segment     1:N, ordered, one per sheet the route crosses
              ├── floor_plan_id + page_index   where it was traced
              ├── points                        polyline in that drawing's pixel space
              ├── pixels_per_meter              THE CALIBRATION AT MEASURE TIME
              └── length_m                      derived and stored, not recomputed later
```

`total_length_m = sum(segment.length_m) + rise_m + drop_m`.

Rise and drop are typed by the measurer, per run. The polyline gives the horizontal route only. A run that goes 3.5 m up a wall at one end and 0.5 m down into a board at the other carries those as explicit, auditable numbers rather than hidden inside a percentage.

### Why length is stored, not computed on read

`length_m` and `pixels_per_meter` are written once, at measure time, and never recomputed. This is the whole point of finding 3. A view that recomputed metres from the drawing's present calibration would reintroduce the silent rewrite on the one number that ends up on an issued schedule.

### Write-back is explicit, never silent

Measuring does not touch the schedule. Applying does.

`applyRouteToScheduleAction` writes `measured_length_m` to **every strand of the supply**, because parallels share a route and the grid already treats that field as run-shared (`CableScheduleGrid.tsx:318`, `:936-951`). It sets `measured_length_method = 'SCALE_RULE'`, stamps `measured_length_by` / `_at`, moves `length_status` to `MEASURED`, and writes a `change_log` row per strand exactly as `updateMeasuredLengthAction` does today.

**Where a length already exists, the apply step shows old against new and requires an explicit confirmation.** KINGSWALK holds 162 hand-entered lengths. A traced route there is a second opinion, and a second opinion that overwrites the first without being seen is worse than no tool. Both values reach the change log either way.

### The worklist is a query, not a list

"Runs still to measure" is: supplies in this DRAFT revision with no route, or a route with no segments. Measuring one removes it from the list. That is what makes the list narrow as the work proceeds, and it is only cheap because the route is relational rather than buried in scene JSON.

### Routes freeze with the revision

Issued revisions are frozen by `enforce_revision_data_frozen()` (`00168` §3b), which gates every child table carrying a `revision_id`. `supply_routes` carries one for exactly this reason. Without it a route could be edited under an issued schedule and the drawing would stop agreeing with the signed document.

### The condensed legend

Saving a marked-up drawing renders a legend listing **only the runs with a segment on that sheet**: tag, from, to, and total length, with a marker where part of the route is on another sheet so the number on the page is never mistaken for the length of what is drawn on the page.

The legend is rendered from the route tables at save time. It is not stored in the scene, so it cannot drift from the schedule.

## Deliberate non-goals

- **No automatic routing.** The user traces. Nothing infers a path from the drawing.
- **No `confirmed_length_m`.** This is the designer's measurement. The site-confirmation half of the workflow has never been used once in production and adding a third length source before the second one has ever been exercised would be speculative.
- **No DWG/DXF.** Unsupported by the viewer today.
- **No allowance table or slack percentage.** Rise and drop only, as chosen. A standard per-termination table can come later without changing this model, because it would compute into the same two columns.
- **No re-measure on recalibration.** The flag is raised; a human decides.

## Risks

| Risk | Handling |
|---|---|
| Drawing deleted or de-activated by cloud sync after a route is traced | `floor_plan_id` is `ON DELETE SET NULL` with a `floor_plan_name` snapshot. The length survives as evidence; only the re-render is lost. |
| PDF pages carry different sheet scales | Calibration is per drawing **and page** via `page_index`, not per drawing. |
| A 2× PDF viewport makes pixel space non-obvious | Segments store pixel points in the same backing-canvas space the canvas already uses for every other shape, and the calibration stored alongside is in that same space, so the pair is always self-consistent. |
| Two people measure the same run | `supply_id` is UNIQUE on `supply_routes`. Second writer gets a conflict, not a duplicate route. |
