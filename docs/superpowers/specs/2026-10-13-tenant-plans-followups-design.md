# Tenant plans — follow-ups (main-board view, show on drawing, markups in exports, retire zones)

**Date:** 2026-10-13
**Status:** The owner asked to "execute all next steps proposals"; these are the four items listed after PR #282.
**Builds on:** `2026-10-12-tenant-plans-relocation-design.md` (PR #282, migration 00249).

## 1. Colour the floor plan by feeding main board

**Owner context:** the 643/E/300 key plan colours each shop by the main board that feeds it (red for MB 1.1, green for MB 2.x, cyan for 3.1, orange for 4.1, magenta for 5.x).

**Data (measured 2026-10-13, KINGSWALK):**
- `structure.nodes.parent_node_id` is NULL for all 134 nodes, so it cannot be used.
- The feed path exists only in the cable schedule: `cable_schedule.supplies.from_node_id → to_node_id`.
- Walking upstream from each tenant DB, using the project's revision (latest ISSUED, else latest), **95 of 108** shops reach a main board. There are 9 main boards.

**Behaviour:**
- On the Floor plan tool, add a **Colour by: Status | Main board** switch. Status is the default. The choice is kept in the URL as `?colour=board`.
- **Main board mode** fills each linked shop with its feeding main board's colour.
  - Feeding board = the nearest `main_board` reached by walking `supplies` upstream (breadth-first, no more than 12 hops, cycle-safe).
  - If two boards are equally near, take the first by board name. The side panel then says "Also fed from MB x".
  - A shop with no path is grey and listed as "Feed not in the cable schedule".
  - Area shapes keep their neutral colours. The overdue hatch is not drawn in this mode.
- **Legend:** one row per main board (name, colour, shop count, measured GLA), plus a row for the unreached shops.
- **Palette:** a fixed categorical list of 12 colours. Each board takes its colour by sorted board name, so the same board keeps the same colour on screen, in PDFs, and between sessions. The colours never reuse the status colours (green complete, orange in progress, red overdue). Each passes contrast against a white label halo.
- **Output:**
  - The floor-plan **Export sheet** gets the same switch (`?colour=board`).
  - The report appendix gains a third option, "Floor plan by main board", off by default, which adds those pages.
  - The portal stays on status.
- **Code:**
  - A pure `feedingMainBoard(edges, nodes, nodeId)` in `@esite/shared/status-plans`, plus a loader `loadProjectFeedGraph(client, projectId)` that reads the chosen revision's supplies with `readAll` (supplies can exceed 1,000 rows).
  - Read access goes through the caller's session (RLS on `cable_schedule`).
  - If the cable-schedule read fails, the tool says "Main board view unavailable — the cable schedule could not be read". It never shows every shop grey.

## 2. Show on drawing

- **Line diagram (Detect blocks review):** each row in *Matched*, *Need you* and *Without a tag* gets a **Show** button. It zooms the canvas so the block's box fills about 60 % of the view and pulses a highlight outline for 2 s.
- **Floor plan and Line diagram (Needs attention list):** each entry gets **Show**, which zooms to and selects the shape.
- **Implementation:** add `fitToBox(box, fill = 0.6)` to `useSheetViewport`. It is pure maths in `viewport-math.ts` with tests (box at the edges, tiny box clamped to `MAX_SCALE`, huge box clamped to `MIN_SCALE`). The canvas gets a `focus` prop of `{ box, nonce }`; a new nonce re-triggers the same box.

## 3. Bluebeam / PDF markups survive exports

**Evidence:**
- The browser canvas renders PDF pages with pdf.js's default `annotationMode`, which draws annotation appearance streams. So Bluebeam markups, stamps and clouds are visible on screen.
- `pdf-lib`'s `embedPage` copies only the page content. Exported sheets and report appendix pages therefore silently lose them, and the PDF disagrees with the screen.

**Change:**
- When the source page has `/Annots`, each annotation is flattened into the embedded output:
  - for annotations whose `/AP /N` is a form XObject, draw it at its `/Rect`, honouring its `/Matrix` and `/BBox` (PDF 32000 §12.5.5 algorithm), inside the same rotation and fit transform as the page;
  - pick the `/AS` sub-dictionary entry when `/N` is a dictionary of states.
- **Skipped:**
  - annotations flagged `Hidden` (bit 2) or `NoView` (bit 6);
  - `Popup` and `Link`;
  - `Widget` (form fields, which pdf.js also omits in its default mode);
  - any annotation with no appearance stream.
- Annotation resources are copied with the page's other objects. The existing prune and the once-per-document embed cache still apply; the cache key covers annotations because they belong to the page.
- **Tests:**
  - a generated PDF with a square annotation that has an appearance stream: the decoded output contains its drawing operators at the expected transformed rectangle, for all 4 rotations;
  - a Hidden annotation and a Popup are not drawn;
  - a page with no `/Annots` renders byte-identically to before (no regression).

## 4. Retire `tenants.floor_plan_zones`

- **Evidence:** created in 00006 for "spatial snag pinning", never written by any UI; 0 rows in production; no view or function depends on it (checked 2026-10-13).
- **References to clean up:**
  - `isAnnotated()` in `cloud-sync-project` queries it, and the annotated-predicate contract test names it.
  - The site-scope manifest and the generated `site_scoped_access.sql` include it.
  - 00009 RLS and 00238 site-scope policies sit on it, possibly with `@verify` directives that name it.
  - `packages/db/src/types.ts` has its types.
- **Migration** (number claimed at apply time; head 00249, #281 holds 00250, so 00251 is expected):
  - step 0 refuses if any rows exist;
  - `DROP TABLE tenants.floor_plan_zones`;
  - remove it from the manifest and regenerate;
  - any earlier `@verify` directive that names it is edited in the same PR, proven by the sweep.
- ⚠ **Deploy order (same rule as 00249):** deploy `cloud-sync-project` without the `floor_plan_zones` lookup BEFORE applying the migration. The current function fails closed on a query error, which would mark every drawing as annotated.

## 5. Testing and delivery

- One branch and one PR, built in four phases (1–4 above), each reviewed.
- The suites (web, shared, db), tsc, lint and `next build` must pass.
- Production dry-run for the migration: rolled back, red first, then the sweep.
- Deploy in this order: function, then merge, then migration verify, then confirm cloud sync runs clean.
- **Not verifiable by the agent:** the signed-in walk.
