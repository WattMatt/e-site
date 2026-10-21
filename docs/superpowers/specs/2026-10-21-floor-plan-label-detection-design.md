# Floor plan: label-driven shop detection — design

**Date:** 2026-10-21
**Status:** approved in chat by the owner (2026-10-21); plan to follow
**Owner ask:** "now that we are able to match the board squares and align them on the masking of the 300 layouts, can we implement the same for the leasing or tenants?"
**Builds on:** `2026-10-09-status-plans-design.md` (status plans), `2026-10-12-tenant-plans-relocation-design.md` (Tenant plans under Tenant Schedule), `2026-10-13-tenant-plans-followups-design.md` (colour by board, Show on drawing), PR #287 (snapping), PR #288 (re-align).

---

## 1. Intent and why

On the Line diagram the app reads the 300's text layer, finds every `NO:` table, snaps a rectangle to the table's drawn border and links it to the board. The owner wants the Floor plan (tenant layout) to work the same way: open the sheet, have the shops found and linked, and keep hand-drawn masks aligned with the drawing.

The floor plan does not offer the same handle, so this is not a port of the 300 detector. It is a sibling built on what the floor-plan PDF does carry. The evidence below comes from the two `tenant_layout` sheets in production on 2026-10-21 (KINGSWALK `643.E.001` rev 9, SAXBY `591.E.002` rev 3), probed with pdf.js 5.7.284 at the app's image scale (2 px per PDF point) and `pdftoppm` at the same scale.

| What the sheet offers | KINGSWALK | SAXBY |
|---|---|---|
| Tenants on the schedule | 109 | 30 |
| Shops with exactly one `SHOP nn` text item | 109 | 29 (shop 31 is not on the sheet) |
| Labels with the tenant name and an `m²` figure within 120 px | 103 | 29 |
| Labels sitting inside a **closed vector sub-path** | 7 | 2 |
| Vector segments that are axis-aligned | 56 % | 58 % |
| Hand-drawn shapes today / linked | 51 / 11 | 29 / 29 |
| Hand-drawn shape area vs schedule GLA | within ~2 % | within ~2 % |
| Flood-fill from the label, area within 0.6–1.6 × GLA | 69 of 109 | 8 of 29 |
| Flood-fill leaked into the mall | 23 (kiosks, open-front ATM lobbies) | 0 |

Three conclusions drive the design:

1. **The `SHOP nn` label is the anchor.** It is unique per shop on both sheets. Bare numbers are not: 47 of KINGSWALK's 109 shop numbers also appear as dimensions or DB numbers. The prefix is what makes the match safe.
2. **There is no border to snap to.** Shops are loose wall segments, nearly half of them diagonal, and a shop is almost never a closed path. The 300's four-agreeing-lines snapper cannot apply, and nothing honest can be built on the vector layer alone.
3. **A raster flood-fill from the label gives a usable outline on a clean drawing and a wrong one on a busy drawing.** On KINGSWALK most shops fill to the right size; on SAXBY the electrical layout's containment and lighting lines subdivide every shop and the fill stops short. So a fill is a *suggestion the person accepts per shop*, gated by the schedule's GLA, never an automatic mask.

**The real input today is the electrical site plan.** Both production floor-plan sheets are `SITE PLAN ELECTRICAL INSTALLATION` drawings, and every number above is measured on them. The owner may upload the architect's leasing plan instead; its text layer has not been checked (CAD exports sometimes carry text as outlines or one glyph per item). The design does not depend on which: a sheet without a text layer, or with no `SHOP` labels, reports that sentence and leaves hand drawing exactly as it is today. What changes between sources is only the share of usable fill suggestions. The §6 acceptance run therefore targets the two production sheets, and the split-run joiner in §4.1 stays a defensive path with synthetic fixtures until a real sheet needs it.

## 2. Goals, non-goals, anti-goals

**Goals**

- Opening an editable floor-plan sheet scans its text layer and reports, per tenant on the schedule: already linked, link now, draw, conflict, or needs you.
- One press links every hand-drawn shape that contains a matched label and is unlinked. On KINGSWALK that is 42 of the 45 shapes that sit on a label.
- A tenant with no shape gets an anchored draw prompt: Show jumps to the label, the polygon tool is armed, and the shape saves already linked to that tenant.
- Where the sheet has a scale and the tenant has a GLA, the person can ask for a suggested outline from a flood-fill, accept it per shop, and edit it like any polygon.
- After a sheet is replaced, the same scan reports which linked shapes no longer sit on their label.
- Everything that is reported carries its reason and its numbers, so a wrong result is explainable from the panel.

**Non-goals**

- Moving or re-shaping existing polygons automatically. There is no honest transform between two revisions of a drawing.
- Snapping to vector outlines, polygonising wall segments, or any vector-derived outline.
- Writing the drawing's `m²` figure back to the schedule. It is shown as a cross-check only.
- Detecting common areas, plant rooms or services. Those stay hand-drawn with an `area_type`.
- Mobile, the portal (read-only tab is untouched), and sheets without a text layer (scanned PDFs report "no text layer; draw by hand", as the 300 does).

**Anti-goals (a shipped feature that does these has failed)**

- A fill outline saved without a person pressing accept for that shop.
- A link made on a bare number, a tenant name alone, or a label that appears twice on the page.
- A link that silently replaces an existing link, or links two shapes to one tenant.
- A suggestion offered when the sheet has no scale or the tenant has no GLA; the gate must fail closed.
- The scan running on the portal or for a reader.

## 3. Constraints

- **No migration.** `tenants.status_plan_shapes` already has `node_id`, `detected_tag` (≤ 64 chars), `source IN ('manual','detected')`, `shape IN ('polygon','rect')`, 6–4000 point values, and the partial unique index `(status_plan_id, node_id)`. The 00249 trigger already refuses a non-`tenant_db` node on a `tenant_layout` plan. Those are the data rules and they are enough.
- **Image space is fixed.** Every coordinate is in the sheet's rasterised image at scale 2 (`IMAGE_SPACE_SCALE`, `use-sheet-image`); labels come through `textItemsToImageSpace` exactly as the 300's do.
- **Role gate** is the workspace's `canEdit` (owner/admin/PM by effective project role), the same as the 300 panels; actions re-check it server-side and refuse any purpose other than `tenant_layout`.
- **Browser only.** The text layer and the fill both run on the bitmap the canvas already holds; no server rasterisation, no new route.
- **Scale and GLA** come from `status_plan_sheets.pixels_per_meter` and `structure.nodes.shop_area_m2` through the existing `loadTenantShopFacts`.
- The `product_events` CHECK is not widened in this slice. If the existing status-plan event names fit, reuse them; otherwise emit nothing rather than add a migration.

## 4. The design

### 4.1 Label detection (shared, pure)

`packages/shared/src/status-plans/detect-shop-labels.ts`

Input: the page's `ImageTextItem[]` (already upright-only, image space). Output:

```ts
interface DetectedShopLabel {
  tag: string            // "92A", "10a" → kept as printed; matching normalises
  box: Box               // the label's text box, image px
  anchor: Pt             // centre of the label box; the fill seed and the "inside" probe
  name: string | null    // nearest non-numeric item within NEAR_PX, or null
  drawingAreaM2: number | null  // the m² figure within NEAR_PX, parsed; null when absent
}
interface ShopLabelResult { labels: DetectedShopLabel[]; duplicates: Record<string, number>; textItemCount: number }
```

Rules (each pinned by a test on strings lifted from the two real sheets):

- A label is a text item matching `^SHOP\s*([0-9A-Z][0-9A-Z/.\-]*)$` case-insensitively ("SHOP 92A", "Shop 10a", "SHOP K04", "SHOP 20/21"). A run split across items ("SHOP" then "92A") is joined when the items are on one baseline and within one label height; the real sheets do not split, so this is defensive and its test is synthetic.
- The same normalised tag found twice on the page is a **duplicate**: both labels are reported and neither can auto-link.
- `name` is the nearest item within `NEAR_PX = 120` that is not the label, not an `m²` figure, and not another `SHOP` label.
- `drawingAreaM2` parses `31.67 m²`, `2,825 m2`, `28 m²`; thousands separators and both superscripts are accepted. Anything else is null.

### 4.2 Matching (reused)

Nodes are the plan's `tenant_db` nodes (the same list the shape panel offers). `buildNodeIndex` already indexes `shop_number`; `matchBlock({ tag, name })` gives exact, leading-zero-stripped, and dot-insensitive passes with the name as tie-breaker only. "K01" and "20/21" pass `isTagShaped`. A label whose tag matches nothing is **not on the schedule**; a label with several candidates is **needs you** with the candidates listed.

### 4.3 Review (shared, pure)

`reviewShopLabels(result, nodes, existingShapes, facts)` produces one row per label plus a tail of shapes with no label inside them.

| Row state | Condition | What the panel offers |
|---|---|---|
| `linked` | a shape contains the anchor and `nodeId` equals the match | counted, listed under "On the plan" |
| `linked_outside` | the matched tenant is linked to a shape that does not contain the anchor, and no other shape contains it (a kiosk or open-front lobby whose label sits in the mall) | counted under "On the plan" with the note "label outside the shape"; Show offered; never alarming and never a conflict |
| `link` | a shape contains the anchor, `nodeId` is null, the match is unique, and the node is not linked elsewhere on the plan | included in **Link N shapes**, or Link singly |
| `conflict` | the shape containing the anchor is linked to another tenant, or it is unlinked while the matched tenant is already linked to a different shape (two shapes claim one tenant) | listed with both names; never automatic; the person re-links from the shape panel |
| `draw` | unique match, no shape contains the anchor | **Show**, **Draw**, and **Suggest outline** when §4.5's gate allows |
| `needs_you` | ambiguous match, or a duplicate label | candidates preselected where the matcher has them |
| `not_on_schedule` | unique label, no node | listed so a missing tenant is visible |
| `moved` | the sheet has `replaced_at`, and a linked shape no longer contains its tenant's label | Show both, and Redraw |

"Contains" is `pointInShape(anchor)`. When two shapes contain the anchor (an overlap), the smaller wins; the other is reported under "no label".

The row also carries `areaNote` when both the drawing's `m²` and the schedule's GLA exist and differ by more than `AREA_TOLERANCE` (2 %): "drawing says 304.52 m², schedule says 281.15 m²". It is information, never a gate.

### 4.4 Link action (web, `'use server'`)

`linkShapesByLabelAction({ sheetId, links: [{ shapeId, nodeId, detectedTag, expectedUpdatedAt }] })`

- Validates with zod; at most `MAX_BATCH` per call; refuses duplicate shape ids and duplicate node ids within the batch.
- Re-reads the sheet, the plan (`purpose === 'tenant_layout'` or refuse), and the role.
- Re-reads every shape and refuses the whole batch if any is on another sheet, already linked, or stale (`updated_at` differs).
- Writes each link as a conditional update on `updated_at`, in chunks, and on the first failure puts back every completed link (`node_id = null`, `detected_tag = null`), each conditional on its new `updated_at`, reporting put-backs that could not be undone. This is PR #288's compensation shape; it stays all-or-nothing by compensation, not by transaction, for the same reason.
- `source` stays `'manual'` (the geometry is the person's); `detected_tag` records the label that linked it.
- Returns the shapes as the canvas type so the workspace folds them in without a refresh.

Undo is the same action's inverse, `unlinkShapesAction`, offered for the batch just made (one press, same compensation).

### 4.5 Anchored draw prompt (web)

Pressing **Draw** on a `draw` row:

1. `fitToBox` on the label box padded to roughly a shop's size (the builder picks the padding; the 300's `FOCUS_FILL` is the reference).
2. The canvas tool switches to `polygon` and the reducer carries a `pendingLink: { nodeId, detectedTag } | null`.
3. The polygon's commit calls `createStatusPlanShapeAction` with `nodeId` and the tag; the shape appears already linked and the row becomes `linked`.
4. Escape, switching tool, or pressing Draw on another row clears the pending link. A pending link never survives a sheet change (the workspace is keyed on the sheet id already).

### 4.6 Suggested outline (browser flood-fill)

`apps/web/src/lib/status-plans/fill-outline.ts`, run on demand per row, or for every `draw` row in sequence with a progress count ("Suggesting 12 of 40"). Input: the canvas's page bitmap (the same one `use-sheet-image` produced at scale 2), the anchor, `pixelsPerMeter`, and the tenant's GLA.

Algorithm (my calls, each a named constant with the reason beside it):

- Threshold luma < 170 as "ink"; dilate ink by 1 px to close anti-aliased hairline gaps.
- Seed from the anchor; the anchor can sit on a glyph, so probe a grid of ±24 × ±16 px in 8 px steps and keep the largest region that stays under the cap.
- Scanline flood fill over non-ink pixels; abort as a **leak** when the region exceeds `LEAK_CAP = 1.5 %` of the page's pixels (a shop is never that; the mall is).
- Grow the region by 2 px before tracing, because the fill measures the inside face of the wall while GLA is measured further out (the spike's fills ran at about 0.85 × GLA before this correction).
- Trace the outer contour, simplify with Douglas–Peucker at ε = 2 px, drop holes, cap at 1,000 vertices (the DB allows 2,000 points; a shop needs far fewer).
- **Gate:** the suggestion is offered only when the sheet has a scale, the tenant has a GLA, the fill did not leak, and `0.80 ≤ fill m² / GLA ≤ 1.20`. Anything else is reported with its number ("fill came to 839.9 m² for a 50.2 m² shop, not offered"). No scale: "calibrate the sheet first". No GLA: "no GLA on the schedule for this shop".
- **Accept** saves through `createStatusPlanShapeAction` as `shape: 'polygon'`, `source: 'detected'`, `node_id`, `detected_tag`. Nothing is saved before Accept, and the contract test in §6 pins that.

Performance budget: one fill under 200 ms on a 6,740 × 4,768 bitmap in the main thread; if the builder measures worse on an A0, move it to a Web Worker. Either is acceptable.

### 4.7 Scan on open

`shouldAutoScan` gains the floor plan: scan when the purpose is `tenant_layout`, the person can edit, the sheet is a PDF with a file URL, and (no shape on the sheet carries a `node_id`, or `replaced_at` is set). Area-typed shapes never count as "unlinked"; a finished plan is not rescanned on every open. The scan runs at most once per sheet per workspace mount, and a **Scan** button in the panel runs it on demand at any time. A scan reads the text layer only; it never runs a fill. The panel leads with **Link N shapes** when any `link` rows exist, else with the `draw` list.

### 4.8 After a replacement

The scan is the re-anchor check. The panel reports "N linked shapes still sit on their label, M moved", lists the `moved` rows with Show and Redraw, and the workspace clears the replaced banner only through the existing re-anchor path (unchanged). No geometry is moved.

### 4.9 Diagnostics (shipped in the first deploy)

- The panel's summary sentence: labels found, items read, linked / link / draw / conflict / needs you / not on schedule, duplicates.
- Every refused or unoffered suggestion carries its number and reason.
- The link action's result names any put-back failure by shape id.
- A Sentry breadcrumb per scan with the counts only (no tenant names).

## 5. What the person sees

In the floor-plan workspace, where the 300 shows "Detect blocks", a **Shops** panel:

```
Shops on this sheet          109 labels · 1,949 text items
  On the plan        3
  Link now          42   [Link 42 shapes]
  Draw              64   (Show · Draw · Suggest outline)   [Suggest all]
  Conflicts          0
  Needs you          0
  Not on schedule    1   SHOP 31
  Drawing ≠ schedule 2   SHOP 38A: drawing 304.52 m², schedule 281.15 m²
```

A `draw` row with a suggestion ready shows the fill's m² against the GLA and an **Accept** button; the suggested polygon is previewed on the canvas in the pending style until accepted or dismissed.

## 6. Evidence the build must produce

- `detect-shop-labels.test.ts`: the label regex and the name / m² neighbours on strings from both sheets; duplicates; split runs (synthetic, labelled so).
- `review-shop-labels.test.ts`: every row state in §4.3 reached by a fixture that can fail it (a conflict with the link reversed, an overlap where the larger shape must lose, a replaced sheet with one moved shape).
- `fill-outline.test.ts`: a synthetic raster with a closed room (fill ok), the same room with a 3 px gap in one wall (leak), a room subdivided by an interior line (fill under the band, not offered), and a contour round-trip whose traced polygon's area is within 1 % of the pixel count.
- `link-shapes.actions.test.ts`: purpose gate, role gate, stale `updated_at`, duplicate node in batch, compensation after a mid-batch failure with one put-back that fails.
- `StatusPlanWorkspace.test.tsx`: the Shops panel renders only for `tenant_layout`; the 300 panels only for `distribution_schematic`.
- A contract test that no code path calls `createStatusPlanShapeAction` with `source: 'detected'` outside the Accept handler.
- Production acceptance before the signed-in walk: a scratch run of `detectShopLabels` + `reviewShopLabels` against the two live sheets' text layers and live shapes (read-only) reproduces the table in §1: KINGSWALK 42 `link`, SAXBY 28 `linked` and shop 31 `not_on_schedule`, zero `conflict` and zero `linked_outside` on both (the spike found none; a non-zero count is a review bug, not drawing noise).
- Fill acceptance, read-only, on KINGSWALK's `draw` rows with the shipped constants: **at least 45 of the 64 are offered** (the spike, before the 2 px grow and with the wider band, had 69 of 109 shops in range and 23 leaks). The band may be tuned only within 0.80–1.20 and the grow only within 1–3 px to reach that; a result below it with those constants is a tracer or fill defect, not a tuning job. SAXBY is reported but has no target: its drawing subdivides shops and the spike predicts single digits.
- The signed-in walk is the owner's: open KINGSWALK's floor plan, press Link 42, draw one shop from a prompt, accept one suggested outline, replace the sheet with the same file and confirm 0 moved.

## 7. Left to the builder

- Contour tracing and simplification implementation; Worker or main thread (§4.6).
- Panel layout and copy, mirroring `DetectBlocksPanel`'s structure and the 300's tone.
- The `fitToBox` padding for Draw.
- Whether `unlinkShapesAction` is a separate file or a mode of the link action.
- Chunk size and `MAX_BATCH` (the 300's values are fine).

## 8. Calls I made that the owner may overturn

- The design is measured on the electrical site plans in production; a leasing plan is accepted, and its text layer is unverified (§1). If the owner knows the leasing plan is the real input, send one sheet and the §6 acceptance run moves to it before the build.
- A tenant whose label sits outside its linked shape is reported as `linked_outside`, not nagged as a conflict (§4.3).
- A finished plan is not rescanned on every open; the Scan button is always there (§4.7).
- The fill target is 45 of KINGSWALK's 64 `draw` rows with constants tuned only inside the stated ranges (§6).
- Fill suggestions are per-shop and never automatic (anti-goal 1).
- A conflict is never resolved by the scan; the shape panel is the only place a link changes hands.
- No migration and no new product-event names in this slice.
- The drawing's `m²` is shown, never written to the schedule.
