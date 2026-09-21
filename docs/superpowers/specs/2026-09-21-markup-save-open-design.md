# Saving and reopening drawing work — markup layers, route doors, and position fidelity

**Date:** 2026-09-21
**Status:** design agreed, build in two PRs
**Reported by:** owner — *"I still don't see any save/open options to save the status or progress of a cable tracing exercise — have we created dedicated buckets for saved/marked-up layouts? — have we ensured marked-up items would load in exactly the same position on the layouts after being saved and opened again"*

---

## 1. What was found

Investigated against `origin/main` `9c0fc67` and probed production read-only. Three separate
problems sit behind one report. Every claim below is evidenced.

### 1.1 Markup has no save of its own — it only exists as an RFI attachment

`public.rfi_annotations` (00033) is `rfi_id NOT NULL` with `UNIQUE (attachment_id)`. A markup
**cannot be stored without first creating an RFI and an attachment**. The consequences run all
the way to the UI:

- the Save button in the drawing viewer is literally labelled **"Attach to RFI"**
  (`MarkupCanvas.tsx`, two render sites);
- `MODES` (`DrawingViewer.tsx:127`) offers **View / Markup / RFI** — there is no way to save
  markup that is not an RFI;
- the "Markups on this drawing" rail panel links **away** to `/rfis/<id>`. It never reopens the
  scene on the drawing. Re-editing needs `?annotation=<id>`, which only the RFI page emits;
- `onSaveMarkup` — the one hook that saves a scene without an RFI — is passed only by
  `QcMarkupDialog`, which writes the scene to `projects.qc_entry_photos.annotation_data`.

So the codebase already holds **two private forks** of "a markup scene attached to a drawing"
(`rfi_annotations.annotation_data`, `qc_entry_photos.annotation_data`), and neither is reachable
as "save my work on this drawing". This is the same shape as the report-storage fork that
`00183` closed, and the answer is the same: one shared table, not a third fork.

### 1.2 The cable-tracing save exists, but is behind an unmarked door and a disabled button

The route half is genuinely built — `saveSupplyRouteAction`, `route_history` with
History…/Restore, undo/redo, per-leg save. It is just not reachable:

- **Route is not a mode in the switcher.** `mode=route` is only produced by
  `?supply=<id>`, emitted from the `/cables/[rev]/measure` worklist, the ⚡ picker inside the
  viewer (which itself renders only when the project has a cable-schedule revision), and
  `trace →` on the schedule grid. The Drawings tab offers no route affordance at all.
- **`Save leg` is `disabled={legSaving || !pixelsPerMeter}`.** Production carries
  **546 drawings, of which 5 are calibrated** (KINGSWALK 1, MAMAILA 1, DE POORT 3 — the last
  three from the PR #190 verification session). ITONKA (156 drawings), WATERMEYER (61),
  PNP FAERIE GLEN (36) and SAXBY (31) have **zero**. On ~99% of drawings the save control is
  dead until somebody sets a scale.

Production state at the time of writing:

| | count |
|---|---|
| `cable_schedule.supply_routes` | 0 |
| `cable_schedule.route_segments` | 0 |
| `cable_schedule.route_history` | 0 |
| `projects.reports` kind `cable_route_sheet` | 0 |
| `public.rfi_annotations` | **0 — not one markup has ever been saved** |
| `projects.qc_entry_photos` with `annotation_data` | 0 |

Zero rows here is not evidence the feature is rarely wanted. It is the same signal as the snag
module in PR #158 and the `client_viewer` divergence: **the flow that creates the rows does not
work, so no rows exist.**

### 1.3 Buckets — the right call, but there is no saved-layout object at all

Production holds 26 storage buckets. **None is for markup or marked-up layouts**, and none
should be: a flattened image cannot be reopened and edited, so vector geometry belongs in the
database. What is missing is not a bucket but a **row** — an object that means "this drawing,
marked up, saved, reopenable".

Today the only artefacts are:

- the composited PNG of an RFI markup → `rfi-attachments` (reachable only via an RFI);
- the exported cable-route sheet PDF → `projects.reports` kind `cable_route_sheet` → `reports`.

Both are **outputs**, not saved working state.

### 1.4 Position fidelity — the arithmetic is exact, the anchor is not

The replay maths is sound and needs no change:

- PDFs rasterise at a **hardcoded** `page.getViewport({ scale: 2 })` — not device-pixel-ratio
  dependent — so image-space is identical on every device and in every session;
- raster drawings use `naturalWidth`/`naturalHeight`, equally deterministic;
- `route_segments` stores `points` + `page_index` + the `pixels_per_meter` **in force at measure
  time**, and never recomputes it;
- markup shapes carry their own `pageIndex`, so a multi-page PDF replays per page.

**The defect is that nothing anchors geometry to the file it was drawn on.**
`cloud-sync-project`'s `isAnnotated()` (`index.ts:782`) decides whether a drawing may be
silently auto-adopted when Dropbox has a newer file. It checks exactly four things:

1. `tenants.floor_plans.pixels_per_meter IS NOT NULL`
2. a `public.rfi_annotations` row on `source_floor_plan_id`
3. a `projects.qc_entry_photos` row on `source_floor_plan_id`
4. a `field.snags` row whose `floor_plan_pin` contains the id

It does **not** look at `cable_schedule.route_segments`, and it does **not** look at
`tenants.floor_plan_page_scales`. Auto-adopt then does:

```ts
.from('floor_plans').update({ file_path: storagePath, … }).eq('id', existing.id)
```

— the **same row id, a different file**. Every saved leg keeps its pixel coordinates and now
refers to different pixels. The post-adopt check-then-act re-check calls the same blind
predicate, so it misses it too.

The live exposure is precise. To save a leg you need a scale. On page 1 that scale is
`floor_plans.pixels_per_meter`, so test 1 catches it. But
`calibrateFloorPlanAction` writes **only** `tenants.floor_plan_page_scales` when
`pageIndex > 1` — deliberately, so the drawing-level scale stays the page-1 default — leaving
`floor_plans.pixels_per_meter` NULL. **A run traced on page 2 or later of a multi-page PDF is
therefore invisible to all four tests, and its drawing is auto-adopted.**

Blast radius: **all 546 production drawings sit under a cloud-storage connection**, and
`cloud-sync-poll` runs every 15 minutes. Nothing is damaged today only because there are
0 route segments and 0 page scales. It is a loaded trap, not a live leak — and the first
person to trace a run on page 2 springs it.

No test could have caught this: there is **no round-trip position test anywhere**, and neither
`MarkupCanvas` nor `RouteLayer` has a component test.

---

## 2. Root cause

> **Markup and route geometry are saved as side effects of other objects — an RFI, a QC entry,
> a cable schedule — rather than as state of the drawing, evidenced by `rfi_annotations.rfi_id
> NOT NULL`, the "Attach to RFI" button being the only save, and `isAnnotated()` enumerating
> four hand-listed tables that a fifth kind of drawing-anchored geometry silently escaped.**

## 3. Architecture or symptom?

**The design is wrong, not merely buggy.** Two independent tells:

- one control does two semantically different things — "Attach to RFI" is both *save my work*
  and *raise a query with the client*, and a user who wants the first is forced into the second;
- the owner described the flow with "I thought it would…", the canonical signal in this
  project's protocol that the mental model and the architecture disagree.

`isAnnotated()` is the same error expressed in the sync layer: a **hand-maintained list** of
places geometry might live is guaranteed to fall behind the schema. It already has.

Corollary that shapes the fix: the guard must be **derived from the schema**, not re-typed from
intent. A hand-written mirror of the list would be valid by construction and could only ever
confirm what its author already believed — the failure mode recorded in this project's
`00204` / latin1-extractor / 1×1-PNG family.

---

## 4. The design

### 4.1 Split

Two PRs. The safety fix does not wait for the feature.

| | scope | migration | deploys via |
|---|---|---|---|
| **PR A** | `isAnnotated()` sees every drawing-anchored table; schema-derived contract test | none | edge-function deploy (`deploy.sh`) — does **not** auto-deploy on merge |
| **PR B** | `tenants.floor_plan_markups`, save/open UI, Route door, version anchor, round-trip test | one | `Deploy DB Migrations` + Vercel |

### 4.2 PR A — close the trap

Add to `isAnnotated()`, keeping its fail-closed contract (any query error ⇒ annotated):

- `cable_schedule.route_segments` on `floor_plan_id`
- `tenants.floor_plan_page_scales` on `floor_plan_id`
- `tenants.floor_plan_markups` on `floor_plan_id` (PR B's table; added in PR B)

**The guard that keeps it true.** A contract test parses the migration corpus for every
`REFERENCES tenants.floor_plans(id)` and every column named `source_floor_plan_id`, and asserts
each owning table is either queried by `isAnnotated()` or carries an explicit allow-list entry
with a written reason. It is derived from the **schema**, so a new drawing-anchored table fails
the build whether or not anyone remembered this document. Mutation-proven by deleting one
branch from `isAnnotated()` and confirming the test names that table.

*Why not just fix the page-2 case by also writing `floor_plans.pixels_per_meter`?* Because that
would corrupt the page-1 default (00199 separated them deliberately) and would still leave the
predicate blind to the next table. It treats the symptom.

### 4.3 PR B — give a drawing saved, reopenable state

**`tenants.floor_plan_markups`** — one row per named markup layer on a drawing.

```
id                 uuid pk
organisation_id    uuid not null  -- bound by trigger, never trusted from the client
project_id         uuid not null  -- bound by trigger; RLS reads it directly
floor_plan_id      uuid not null references tenants.floor_plans(id) on delete cascade
name               text not null
scene              jsonb not null -- SceneGraph { version, canvas, shapes[], pageCount }
file_path          text not null  -- the file the geometry was drawn against
source_revision_id text           -- cloud revision at draw time, when known
created_by / updated_by  uuid references public.profiles(id)
created_at / updated_at  timestamptz
unique (floor_plan_id, name)
```

Decisions and their reasons:

- **Shared and named, not a personal draft.** Every other object in the product is shared within
  the project, routes included; a markup a colleague cannot open is not worth saving. The
  IndexedDB draft (which already exists, keyed `plan.id|annotationId` for markup and
  `route-draft:<plan>:<supply>:<page>` for routes) stays exactly as it is — it is crash
  recovery, per-browser, and it is not a save.
- **One row spans all pages.** The scene graph already carries `pageIndex` per shape and
  `pageCount`, so a multi-page PDF needs no extra dimension.
- **Org and project are bound by a `BEFORE INSERT/UPDATE` trigger** from the floor plan, the
  00193/00200 pattern. A client-supplied `organisation_id` in a permissive policy is the hole
  `00200` had to close.
- **RLS:** SELECT to project readers via `user_has_project_access`; INSERT/UPDATE/DELETE
  **RESTRICTIVE** on `MARKUP_WRITE_ROLES` — the same set the viewer page is gated on, so the
  contractor who is the primary markup author keeps writing.
- **Concurrency:** `expectedUpdatedAt` on save; a stale write is refused, never merged — the
  rule routes already follow.
- **No new bucket.** Geometry is vector and belongs in the row. The flattened PNG remains an
  RFI/QC export concern.

**Version anchor.** `file_path` (+ `source_revision_id` when the drawing came from cloud
storage) is stamped at save. On open, if the drawing's current `file_path` differs, the viewer
shows a banner — *"This markup was drawn on an earlier version of this drawing; positions may
not line up."* It does **not** block and does **not** attempt to re-align: no honest
transformation exists between two arbitrary revisions of a PDF. Being told is the whole ask.

**UI.**

- `MODES` gains **Route**. With a cable schedule present it opens the ⚡ run picker; without one
  it renders disabled with the hint *"This project has no cable schedule yet"* — so the
  capability is discoverable even where it is unavailable.
- Markup mode gains a primary **Save** (first save asks for a name; later saves overwrite,
  with **Save as…** alongside). **Attach to RFI** stays, demoted to a secondary action — it is
  now one export of a saved markup rather than the only way to keep work.
- Rail: a **Saved markups** panel (open / rename / delete, two-step inline confirm — never
  `window.confirm`, which Safari suppresses). The existing panel is retitled **RFI markups**.
- Drawings tab: a **Trace a cable** action per drawing when the project has a cable schedule.
- Route mode's existing "This sheet has no scale yet — set the scale once…" prompt is unchanged;
  it is already the right first-run step.

**Tests that can actually fail.**

- **Round-trip position test** — a scene with known, awkward coordinates (non-integer, negative
  rotation, multi-page) is serialised, stored, read back and re-hydrated; assert the points are
  **bit-identical**, not merely "a scene rendered". Mutation-proven by perturbing one
  coordinate by 0.5px and confirming red.
- Action tests for save / rename / delete / stale-write refusal.
- The schema-derived `isAnnotated` contract test from PR A, extended to the new table.

---

## 5. Verification plan (stated before any code)

1. `pnpm --filter web test:ci`, `--filter @esite/shared`, **and `--filter @esite/db`** — the third
   is the one that holds the repo-wide migration guards and has been red while the first two
   were green.
2. `tsc` + eslint clean.
3. Migration: dry-run against the **current** production schema via
   `scripts/db/dry-run-migration.sh`, with at least one mutation proving each assertion can fail.
4. `-- @verify:begin … end` block mandatory (every migration ≥ `00185`). No em dash in a `sql:`
   payload outside a string literal or `/* */` — `#194` rejects it at parse time.
5. Migration number claimed **at apply time**, after re-checking three places: the ledger,
   `origin/main`, and the migration filenames in open PRs. Head is `00204`; `00201` (#191) and
   `00202` (#193) are claimed-but-unapplied and already stranded below it.
6. After `db push`: **read the affected table back**. A green workflow is not evidence a
   migration ran — `db push` keys on the version prefix and will print "up to date" and skip.
7. Edge function: deploy from `deploy.sh`, then read `verify_jwt` and the version back from the
   Management API. A fix in the repo proves nothing about production.
8. Prod walk **from the empty state, not a deep link**: open a drawing with no markups, save one,
   reload, confirm the geometry lands on the same pixels, reopen from the rail, rename, delete.
   Zero residue afterwards.

## 6. Known gaps carried, not closed

- Touch/tablet tracing remains untested; `RouteLayer` still has no component test (Konva).
- The markup toolbar's own calibration write still admits contractors (00035).
- `packages/db/src/types.ts` is still not regenerated; the new actions cast `.schema('tenants')`.
- A markup whose drawing row is deleted cascades away; a **route segment** whose drawing is
  deleted survives with `floor_plan_id` NULL (`ON DELETE SET NULL`) and can never be re-rendered
  in place. Out of scope here, worth its own decision.
