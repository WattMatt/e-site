# Status plans — tenant layout masking + 300 schematic DB hatching

**Date:** 2026-10-09
**Status:** Design approved in conversation (owner); spec awaiting owner review
**Origin:** Owner ask — bring WM Office Web's tenant floor-plan masking into E-Site, colour completed tenants differently from other masked areas, link masks to tenants, record the masked area when the drawing is scaled; and hatch the DB blocks on our 300 schematic distribution diagrams by order status.

---

## 1. What exists today (evidence)

### WM Office Web — two tools, never joined
| | Tenant Tracker → Floor Plan Masking | Drawing markup → Supply Zones |
|---|---|---|
| Files | `src/components/tenant/FloorPlanMasking.tsx`, `MaskingCanvas.tsx`, `AssignTenantDialog.tsx`, `FloorPlanLegend.tsx` | `src/components/floor-plan/components/Canvas.tsx:209` |
| Shape | free polygon | free polygon |
| Linked to tenant | yes (`tenant_floor_plan_zones.tenant_id`, one zone per tenant, name + category copied) | no |
| Colour | grey unassigned / orange in progress / green complete (all five flags) | per-zone palette |
| Area | **not computed** — legend shows the schedule's typed area | **shoelace × scale²**, stored `zones.area_sqm` |
| Scale | two-point line → `scale_pixels_per_meter` | `scaleInfo.ratio` |
| Report | composite PNG flattened on Save → "Floor Plan with Tenant Zones" page | — |

Weakness carried by the Office Web masking tool: colour is computed once and **stored**, so the plan goes stale until someone presses "Update Preview Colors". The composite PNG freezes it again.

### E-Site
- Tenant schedule report (`apps/web/src/lib/reports/tenant-schedule-report*.ts(x)`, react-pdf): cover, KPIs, shop summary. No floor plan.
- Per-shop facts already computed in `tenant-schedule-report-compute.ts:55-68` (`ShopRow { db, lights, scope, layoutIssued, boDate, boOverdue }`); DB vs lights by `scope_item_types.key` `'db'` / `'lighting'` (`tenant-schedule-report-data.ts:81-83`). No single per-shop status function exists.
- `structure.nodes.shop_area_m2` holds scheduled GLA.
- Drawings: `tenants.floor_plans` + per-page scale `tenants.floor_plan_page_scales` (00199); `pageScaleFor()` in `cables/[revisionId]/measure/route-canvas-logic.ts:64`.
- Sheet primitives `apps/web/src/lib/sheet/` (`useSheetImage`, `useSheetViewport`, `draft-store`, `viewport-math`) — image space = PDF page at fixed `scale: 2`.
- `tenants.floor_plan_zones` (00006): polygon + colour, **no tenant/node link, never used by any UI**.
- pdf.js text with positions already used in `components/tariffs/PdfPageCrop.tsx:48` (`getTextContent` + `convertToViewportRectangle`).
- pdf-lib page embedding already used in `lib/cable-schedule/route-sheets.ts`.

### The 300 drawing (643/E/300, KINGSWALK, sheet 1 of 10)
- One A0 page, `/Rotate 90`, Acrobat Distiller output → **intact text layer** (7,860 positioned words).
- 152 `NO:` tables; each block is a 7-row table `NO / NAME / AREA / RATING / CABLE / SERIAL / CT` (e.g. `DB-05 · BOXER · 1809.27m² · 600A TP · 3×4C×150mm² ALU · 600/5A`).
- Matching its 115 `DB-*` / `MB-*` tags against KINGSWALK's 134 live nodes: **93 match `nodes.code`/`shop_number` after normalisation, +9 via `MB-x.y` ↔ `MAIN BOARD x.y` = 102/115**. 13 unmatched are genuine (combined `DB-13/14`, sub-boards not in E-Site `DB-01D` `DB-03A` `DB-08A` `DB-52A`, kiosk `DB-K07`, `DB-SR1/SR2`).
- KINGSWALK DB-order states today: ordered 114, required 25, by_tenant 38, received 2.

## 2. Design decision

**One feature, two drawing purposes.** A *status plan* is a page of a drawing in the register, marked with a purpose. Its shapes store **geometry + link + type only**; every colour, hatch and area is derived at draw/render time from live data. Nothing derived is persisted, so a plan can never lag the schedule.

Approach chosen: a dedicated module with its own page and canvas built on `lib/sheet/` (the pattern PR #201 used for cable routes). Rejected: extending `MarkupCanvas` (re-creates the one-canvas-three-jobs problem #201 undid; markup scenes store colours, not links); reusing `tenants.floor_plan_zones` (no node link, no page, no type — every column would change).

## 3. Purposes and their rules

### 3.1 Tenant layout (`purpose = 'tenant_layout'`)
Shapes: polygons (and rectangles, stored as 4-point polygons).

- **Shop shape** — linked to a `structure.nodes` row of kind `tenant_db` in the same project. A node may appear at most once per plan.
- **Area shape** — not a tenant; `area_type` ∈ `common` (mall / common area), `plant_room` (plant / electrical room), `services` (services / back-of-house), `vacant` (vacant / future). Fixed neutral colours (greys/blues) that never collide with status colours.
- **Unassigned shape** — drawn but not yet linked: grey.

Shop status (pure function, §6):
| Status | Rule | Rendering |
|---|---|---|
| `complete` | scope received **or** not required, **and** layout issued, **and** DB order ∈ {received, by_tenant}, **and** lights order ∈ {received, by_tenant} | green fill |
| `in_progress` | linked, active, not complete | orange fill |
| overdue overlay | not complete **and** BO date < today | red diagonal hatch + red outline over the base fill |
| `decommissioned` | node status decommissioned | grey fill, struck label |
| `unlinked` | node deleted (`node_id` set NULL) or never assigned | grey fill |

A shop with no DB (or no lights) order row counts that item as **not yet complete** (an order row missing is not evidence of done).

Label at the polygon's visual centre: shop number + tenant name (+ measured m² when scaled).

**Measured area:** when the page has a scale (`pageScaleFor`), area = shoelace(image-space points) ÷ `pixels_per_meter²`. Shown per shape and summed per plan. Compared against `nodes.shop_area_m2`: |measured − scheduled| / scheduled > **2 %** → amber "area differs" flag in the side panel and legend table (not on the drawing). No scale → area "—" and no comparison. Area is never stored (the scale can be recalibrated).

### 3.2 Distribution schematic (`purpose = 'distribution_schematic'`)
Shapes: rectangles over DB blocks, linked to any project node (tenant_db, main_board, common_area_board, …).

Hatch from the linked node's **DB** order (`scope_item_types.key = 'db'`):
| Order status | Rendering |
|---|---|
| `required` | red outline, no fill |
| `ordered` | amber diagonal hatch |
| `received` | green solid (translucent) fill |
| `by_tenant` | grey cross-hatch |
| no DB order row (e.g. main boards) | thin neutral outline only |
| unlinked | dashed grey outline |

**Detect blocks** (§5) proposes every block; the user confirms.

## 4. Data model (one migration, number claimed at apply time — head is `00244` today)

```
tenants.status_plans
  id               uuid pk
  project_id       uuid not null → projects.projects   (on delete cascade)
  organisation_id  uuid not null                        (bound from the drawing by trigger; client value discarded)
  floor_plan_id    uuid not null → tenants.floor_plans  (on delete cascade)
  page_index       int  not null check (>= 1)
  purpose          text not null check in ('tenant_layout','distribution_schematic')
  name             text not null check (btrim(name) <> '')
  source_file_path text not null                        (drawing file at creation — divergence warning, as 00205)
  created_by, created_at, updated_at
  unique (floor_plan_id, page_index, purpose)
  trigger: project_id must equal the drawing's project_id

tenants.status_plan_shapes
  id              uuid pk
  status_plan_id  uuid not null → status_plans (on delete cascade)
  shape           text not null check in ('polygon','rect')
  points          jsonb not null   (image-space [x0,y0,x1,y1,…], ≥ 3 vertices; rect = 4)
  node_id         uuid null → structure.nodes (on delete set null)
  area_type       text null check in ('common','plant_room','services','vacant')
  detected_tag    text null        (text read from the drawing, e.g. 'DB-13/14', kept when unmatched)
  source          text not null default 'manual' check in ('manual','detected')
  created_by, created_at, updated_at
  check (node_id is null or area_type is null)
  unique (status_plan_id, node_id) where node_id is not null
  trigger: node must belong to the plan's project; tenant_layout shapes may only link tenant_db nodes
```

**RLS** (lessons from 00205/00206 — no `FOR ALL`):
- SELECT on both: `user_has_project_access(project_id)` (shapes via the plan) — every project role incl. client_viewer.
- INSERT / UPDATE / DELETE: separate per-verb RESTRICTIVE policies gated on `user_effective_project_role(project_id) in ('owner','admin','project_manager')` (`ORG_WRITE_ROLES`).
- Both tables registered in `packages/db/src/site-scope/manifest.ts` (`status_plans` direct; `status_plan_shapes` via a `status_plan` resolver) and regenerated with `scripts/db/site-scope/emit.ts`.
- `REVOKE … FROM PUBLIC, anon` on any new function before its GRANT.
- `@verify` block; impersonation assertions `scripts/db/assert-status-plans-roles.sql` (red first) proving: contractor reads but cannot write; client_viewer reads; off-site user sees nothing (use the lapsed-org-membership PM probe, not an off-site org PM); org bound by trigger with a deliberately wrong supplied value; cross-project node link refused; duplicate node per plan refused.
- After applying, sweep every `@verify` directive ≥ 00185 under the new state (the migration adds policies).

**Cloud sync:** `isAnnotated()` in `cloud-sync-project` gains a fail-closed lookup on `tenants.status_plans` by `floor_plan_id` (the contract test will demand it). A drawing with a status plan is never silently swapped for a newer Dropbox revision; the existing "update available" banner applies. The plan page warns when `floor_plans.file_path` ≠ `source_file_path`. No auto re-alignment.

Deliberately not built: any stored colour, status, or area column.

## 5. Block detection (300 schematics)

Runs in the browser on the plan's page with pdf.js `getTextContent()` (same page rendering as `useSheetImage`), converting each text item to image space with the page viewport at `scale: 2` — **rotation handled by the viewport** (the sample sheet is `/Rotate 90`).

Pure parser in `packages/shared/src/status-plans/detect-blocks.ts`, input = positioned text items, output = proposed blocks:
1. Find label items `NO:`; for each, walk down the same label column for `NAME: AREA: RATING: CABLE: SERIAL: CT:` within a vertical gap tolerance derived from the label height.
2. Value per row = nearest text item(s) right of the label on the same baseline.
3. Block rectangle = label column left − pad … rightmost value right + pad, `NO:` top − pad … last label bottom + pad.
4. Tag = `NO:` value (e.g. `DB-05`, `MB-3.1`, `DB-20/21`); name = `NAME:` value.
5. Blocks with an empty tag still get proposed (they render as unlinked with the NAME value as hint).

Matcher `match-nodes.ts`: normalise (uppercase, strip spaces/hyphens/dots except `/`), compare against `nodes.code` and `nodes.shop_number`; `MB-x.y` ↔ `MAIN BOARD x.y`; tag `NAME` used as a tie-breaker only. Exactly one candidate → matched; zero or several → needs a decision. Never auto-link on name alone.

Review UI: "Detected 152 blocks — 102 matched · 13 need you · 37 without a tag". Matched rows accept in one click; unmatched rows pick a node from a searchable list or are skipped. Accepting writes `source='detected'`, `detected_tag`. Re-running detection on a plan only proposes blocks that don't overlap an existing shape.

No text layer (scanned/flattened PDF) → detection reports "This page has no readable text — draw blocks by hand" and the rectangle tool remains.

## 6. Shared logic (`packages/shared/src/status-plans/`)

- `shop-status.ts` — `shopStatus(facts, today): { status, overdue }` from the `ShopRow` facts. **The tenant schedule report and status plans use one loader** (`tenant-schedule-report-data.ts` extracted so both read the same facts — screen, plan and report cannot drift).
- `db-block-status.ts` — `dbBlockStatus(order | null)`.
- `geometry.ts` — shoelace area, polygon visual centre (pole of inaccessibility, simple iterative), point-in-polygon, hatch-line clipping (line segments of a given angle/spacing intersected with a polygon — used by both Konva and pdf-lib so they draw the same hatch).
- `area-check.ts` — measured vs scheduled with the 2 % tolerance.
- `palette.ts` — the single colour/hatch table for every status and area type (canvas, legend, PDF all read it).

## 7. Web

- Route `apps/web/src/app/(admin)/projects/[id]/status-plans/` — list of plans (name, drawing, page, purpose, counts) + "New status plan" (pick drawing → page → purpose → name).
- Route `…/status-plans/[planId]` — canvas + side panel.
  - Canvas `StatusPlanCanvas.tsx` (Konva) on `useSheetImage` / `useSheetViewport`. Tools: Select, Polygon, Rectangle, Pan; vertex drag; delete; Esc cancels; Enter/double-click closes; two-step inline confirm for delete (no `window.confirm`).
  - Side panel: selected shape → assign (searchable node list, already-used nodes disabled) or area type; status facts for the linked shop; measured vs scheduled area. Plan legend with live counts (tenant layout: Complete / In progress / Overdue / Unassigned + area types; schematic: Required / Ordered / Received / By tenant / No order / Unlinked) and total measured area.
  - Schematic plans: "Detect blocks" button + review list (§5).
  - Shape writes are per-shape server actions returning `{ ok, error }` (no thrown errors — production redacts them). No `router.refresh()` after a save; the action result is folded into local state.
  - Editing gated on `requireEffectiveRole(…, ORG_WRITE_ROLES)` (result object — check `.ok`); other roles get the same page read-only.
- Sidebar: "Status plans" in `projectNav` after "Tenant Schedule".
- Tenant schedule page: per-row "on plan" indicator linking to the plan with that shop selected (`?shape=`).
- Client portal: read-only plan view under `(portal)/portal/[projectId]/status-plans`.
- `docs/rbac-matrix.md` updated in the same PR.

## 8. Report and export (pdf-lib, vector, server-side)

- `lib/status-plans/render-plan-page.ts`: embeds the drawing page with pdf-lib `embedPage` (vector — no rasterising), fits it to A3 landscape (A1/A0 kept at source size for schematic "Export sheet"), draws every shape in vector from `palette.ts` with hatches from `geometry.ts`, labels, and a legend block with counts. Image-space → PDF points: ÷ 2 then the page's rotation transform. Every string through `winAnsiSafe` (`m²` is WinAnsi-safe; `→ ✓` are not).
- Tenant schedule report: new optional appendix "Tenant status plans" — one page per `tenant_layout` plan, then (optional checkbox in the report dialog) `distribution_schematic` plans. Appended with pdf-lib as route sheets are. Colours computed at render time, so a saved report version is a true snapshot of that moment.
- Schematic plan page: "Export sheet" downloads the hatched sheet at source size (PDF).
- Report read gate unchanged (`tenant_schedule` kind is open to project roles).

## 9. Error handling

- No scale → areas "—", banner "Calibrate this page on the drawing to measure areas" linking to the calibrate flow.
- Drawing file changed since the plan was created → amber banner naming both files; shapes still shown.
- Node deleted → shape falls to unlinked grey and is listed under "Needs attention".
- Stale write (two editors) → per-shape `expected_updated_at` check; refusal sentence "This shape was changed by someone else — reload to see it."
- Detection on a 0-text page → explicit message, never a silent empty result.

## 10. Testing

- **Shared unit (TDD):** shop status truth table incl. missing order rows and overdue; DB block status; shoelace with fractional and negative coordinates (known areas, e.g. a 12.5 m × 8 m L-shape); area tolerance boundaries (exactly 2 %); hatch clipping on concave polygons; matcher normalisation and ambiguity; `MB-x.y` alias.
- **Detector:** fixture of positioned text items with **invented** tags/names/values (the repo is public; no client drawing data), including a rotated-page fixture, a block with an empty tag, a combined tag `DB-90/91`, and a label column crowded by a neighbouring block. Mutation-check: shift one label off-column → that block must drop, not merge.
- **pdf-lib renderer:** render against a generated rotated PDF; decode the content stream and assert shape paths land at the expected coordinates (not "a PDF rendered"); assert WinAnsi safety on hostile labels.
- **DB:** `assert-status-plans-roles.sql` red-then-green; `@verify` block; `pnpm --filter @esite/db test:ci` (site-scope coverage + annotated-predicate contract) alongside web and shared suites.
- **Contract:** `page.tsx` → client props are JSON only (no functions).
- **Owner walk (cannot be done by the agent):** from the empty state on KINGSWALK — Status plans → New → pick the Tenant Layout drawing → mask three shops + one mall area → see colours/areas → generate the tenant report and find the appendix; then New → 643/E/300 sheet 1 → Detect blocks → accept → confirm hatches match `node_orders`.

## 11. Delivery slices (each its own PR, merged in order)

1. Migration + RLS + site scope + `isAnnotated()` + shared logic (status, geometry, palette, area check) + loader extraction.
2. Tenant layout: list page, canvas, assign panel, measured area, legend, sidebar, schedule-row link.
3. Distribution schematic: rectangle tool, detector, matcher, review UI.
4. pdf-lib plan renderer, report appendix, schematic Export sheet, portal read-only view.

## 12. Out of scope / follow-ups

- Retiring the unused `tenants.floor_plan_zones` (00006) — separate change; `isAnnotated()` keeps querying it until then.
- Colour-by-main-board (feed zone) view like the 300 key plan — a third colour rule on the same shapes, later.
- Reading `AREA:` / `RATING:` from 300 blocks to cross-check the schedule.
- Auto-detection on architectural tenant layouts (no consistent text structure).
- Mobile.
