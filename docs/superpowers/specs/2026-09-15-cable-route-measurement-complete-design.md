# Cable route measurement — completeness design

**Date:** 2026-09-15 · **Status:** built — every non-skipped row below is Built; decisions taken 2026-09-15 (per-page scale table, Revert, three skips) · **Supersedes:** `2026-09-11-cable-route-measurement-design.md` (the shipped PR #180 surface) · **Branch:** `feat/cable-route-viewer-handoff`

## Why this document exists

The owner's standard: a launchable, world-class tool — recurring, reusable, editable, savable, re-loadable, with undo/redo "and whatever else there could be". What has been built to date (see `docs/cable-route-measurement.md`) is a working core arrived at reactively. This document is the systematic pass: every capability such a tool needs, judged against what exists, with evidence, so nothing launches by omission.

## The gap matrix

Status: **Built** = exists and verified in a browser against production data · **Partial** · **Missing**.

### A. Getting to a run
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| A1 | From the schedule grid, any run | Built | `trace →` on every run; `traced` badge links back |
| A2 | From the drawing — the ⚡ tool with a filterable run list | Built | picker gated on ORG_WRITE_ROLES + a DRAFT revision |
| A3 | From a route already drawn on the sheet (press it) | Built, verification interrupted | overlay + `onPressOther` |
| A4 | From the worklist, deep-linkable | Built | `?supply=` |
| A5 | Worklist search / sort | Built | search box, sort by name / length / outstanding-first |

### B. Scale
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| B1 | Set scale in-flow, stored with WHERE it was taken, drawn on the sheet | Built | `00198` |
| B2 | Recalibration flags every leg traced under the old scale | Built | rail + worklist |
| B3 | Re-measure flagged legs in one action | Built | `remeasureRouteLegsAction`, dry-run preview then write, logged |
| B4 | Scale per PDF page | Built | `tenants.floor_plan_page_scales` (`00199`); a leg on an unscaled page is refused, naming the page |

### C. Tracing
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| C1 | Click-to-add vertices, double-click / Enter to finish, live per-edge lengths, running total | Built | |
| C2 | Undo last point, Discard, Esc | Built | |
| C3 | Keyboard undo/redo (⌘Z / ⇧⌘Z) while tracing | Built, browser-verified | snapshot history, `lib/cable-route/route-history.ts` |
| C4 | Snap the first vertex of a new leg to the end of the previous leg | Built | `lib/cable-route/snap.ts`, 12 screen px |
| C5 | Orthogonal snap (Shift → 0/45/90°) | Built | |
| C6 | Zoom, pan, fit, multi-page, continue on another sheet | Built | |
| C7 | Explicit Save leg with server-computed length; pending state visible | Built | status strip |
| C8 | In-progress trace survives a reload | Built | IndexedDB draft per (drawing, run, page) |
| C9 | Touch / tablet (tap, double-tap) | Untested | handlers are shared with markup |

### D. Editing a saved route
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| D1 | Select a leg; drag / insert / remove vertices; delete a leg | Built | persists via replace-all |
| D2 | Undo/redo of persisted edits | Built | undo re-persists the previous snapshot's legs |
| D3 | Edit rise & drop | Built | shared panel |
| D4 | Reorder legs | Built | ↑↓ in the rail |
| D5 | Split / merge legs | Missing — proposed skip | delete + retrace covers it |

### E. Saving, recall, history
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| E1 | Routes drawn on the drawing in every mode; toggle; press to measure | Built | the drawing is the record |
| E2 | Reopen route mode → legs recalled; worklist reflects state | Built | |
| E3 | Route history — who changed what, when; restore a prior state | Built | `cable_schedule.route_history` (`00199`), append-only; Restore in the rail |
| E4 | Concurrent editing guarded | Built | `expectedUpdatedAt` token; stale save refused with when; Reload offered |
| E5 | Assign with overwrite confirmation listing every existing value; status rule matches the grid | Built | |
| E6 | Revert an assignment to the previous schedule figure | Built | `revertRouteAssignmentAction`, logged |
| E7 | ISSUED revision frozen | Built | DB trigger |

### F. Output
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| F1 | Export sheet → versioned PDF with legend; listed, previewable, downloadable | Built | |
| F2 | Routes CSV per revision | Built | worklist |
| F3 | Method column in the schedule's CSV/Excel exports | Built | CSV `length_method`; Excel trailing column V |
| F4 | Export a sheet from the worklist without opening it | Missing — proposed skip | the raster comes from the browser |

### G. Trust
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| G1 | App gates + RLS; contract test for inert gates; matrix rows | Built | |
| G2 | Telemetry — leg saved, assigned, exported | Built | three events, CHECK widened in `00199` |
| G3 | Project-promoted PM refused by RLS (fail-closed) | Open, documented | owner decision |

### H. Quality
| # | Capability | Status | Evidence / gap |
|---|---|---|---|
| H1 | Pure maths + actions unit-tested (51 + 37 cases) | Built | |
| H2 | End-to-end spec | Built | `e2e/tests/12-cable-route-measure.spec.ts`, env-gated |
| H3 | Empty / error states: no drawings, no scale, ISSUED, orphaned leg | Built | |

## What gets built (no exceptions, in this order)

1. **Undo/redo** — one history for route mode: vertex placement while tracing, and every persisted edit (drag, insert, remove, delete leg, save leg). Because saves replace the whole segment list, each history entry is a full segment list; undo re-persists the previous one. ⌘Z / ⇧⌘Z, toolbar ↶ ↷, disabled states, and the strip says what will be undone.
2. **Snapping** — a new leg's first vertex snaps to the previous leg's end on this sheet (within 12 screen px); Shift constrains to 0/45/90° from the previous vertex; a snap indicator shows.
3. **Draft autosave** — the in-progress polyline and pending leg persist in IndexedDB per (drawing, run, page) and are offered back on return.
4. **Re-measure after recalibration** — one action per sheet: re-derive the flagged legs' lengths from their stored points and the new scale, with a before/after confirmation.
5. **Route history + concurrency — migration `00199`** — `cable_schedule.route_history` (one row per save: who, when, the full segment snapshot, rise/drop). The save action takes the route's `updated_at` it last saw and refuses a stale write with who/when. The rail lists history; any entry can be restored (server-side undo, audited). **`00200`** (added after CI): a BEFORE trigger binds each history row's `supply_id`/`revision_id`/`organisation_id` from its route and the `00193`-shaped RESTRICTIVE write gate on `user_can_edit_revision(revision_id)` is added — `packages/db`'s cable-schedule write-role contract test caught `00199`'s permissive-only policy on the PR.
6. **Reorder legs** — up/down in the rail; seq rewritten on save.
7. **Worklist search + sort; Routes CSV; Method column in schedule exports.**
8. **Telemetry** — `cable_route_leg_saved`, `cable_route_assigned`, `cable_route_sheet_exported`.
9. **Playwright e2e** — trace → save → assign → recall on a throwaway run, auto-skipping without the env the existing RBAC spec uses.
10. **Per-page scale and Revert assignment** — per the decisions below.
11. **Docs, matrix, vault, PR.**

## Decisions for the owner

- **B4 Scale per page.** Recommended: a per-page scale table (`floor_plan_page_scales`, in `00199`), so a multi-page PDF can carry different sheet scales; the drawing-level scale remains the default for page 1 and the markup measure tool. Alternative: keep one scale per drawing and refuse to trace on any page other than the calibrated one.
- **E6 Revert assignment.** Recommended: a *Revert to previous length* control in the panel that restores the change log's prior value (recorded as another change-log row). Alternative: leave reversal to typing in the grid.
- **Proposed skips:** split/merge legs; export from the worklist; a lower-resolution preview during rasterisation (environmental: pdf.js takes 20–60 s only when the machine is loaded).

## Non-goals (unchanged)
Automatic routing; `confirmed_length_m` (site confirmation); DWG/DXF; allowance tables beyond rise and drop; the mobile app.
