# Tenant plans — dedicated floor plan + line diagram tools under Tenants

**Date:** 2026-10-12
**Status:** Approved by the owner in conversation (decision A = keep masks and flag a replaced drawing; decision B = remove the Drawings-register route, which was the recommended default and was not objected to)
**Supersedes:** where things live and where files come from in `2026-10-09-status-plans-design.md` §2, §4 (`floor_plan_id`/`page_index`/`source_file_path`), §7 (routes and sidebar) and §8 (appendix naming). The engine is unchanged: shapes linked to nodes, live status colours and hatches, measured area, block detection, and the vector PDF.

## 1. Owner report (design check)

> "similar to the wm office app, the process must start with tenants, where we can upload a drawing and map the areas, under the same area we must have two options, load the floor plan and load the line diagram, not in floor plan markup or anywhere else, dedicated tools with dedicated flow"

Is this a bug in the current design, or is the design wrong? **The design is wrong.**
- The shipped tool is a separate sidebar item, "Status plans".
- A plan can only start from a drawing that is already in the shared Drawings register. That is the same entry point as drawing markup, and its files come and go with cloud sync.
- So one place, the register, ends up doing several jobs, and the flow does not start where the owner's work starts, which is Tenants.

## 2. The new shape

### Entry point
- **Tenant Schedule** page → a **Tenant plans** section with exactly two cards.
- **Floor plan.** Upload the floor plan, then mask and link shops. Purpose `tenant_layout`.
- **Line diagram.** Upload the 300 schematic, then detect and hatch DB blocks. Purpose `distribution_schematic`.

Each card shows its state. With nothing loaded, it shows "Upload". When loaded, it shows sheet count, live counts and Open, and owner/admin/PM also get **Upload / Replace**. Read-only roles see Open only.

### Routes
- `/projects/[id]/tenant-schedule/floor-plan`
- `/projects/[id]/tenant-schedule/line-diagram`

Each is the existing canvas workspace plus a **sheet strip** for stepping between sheets.

### What goes away
- The `/projects/[id]/status-plans` list route and the "Status plans" sidebar entry. Old URLs redirect (307) to the tenant schedule.
- The "New status plan" form.
- Any reference to `tenants.floor_plans` from these tables.

### Portal
- The portal tab is renamed **Tenant plans** and lists the two PDFs, where they exist.

## 3. Dedicated files

- **New private storage bucket `tenant-plan-files`**:
  - path `{org}/{project}/{plan_id}/{sheet_id}/{revision}.{pdf|png|jpg}`
  - PDF, PNG and JPEG only, 60 MB limit
  - not visible in the Drawings register or Dropbox sync
  - untouched by markup
- **Storage RLS:**
  - read: any member who can read the plan
  - write: owner/admin/PM of the project
  - plus the `site_scope_objects` treatment that 00238 gave the other 9 buckets
- **Upload flow:** the browser uploads straight to storage using a path the server issues, so large files never pass through a Vercel function. A server action then registers the sheets.
  - A PDF with N pages creates N sheets.
  - Several files can be uploaded at once, and their sheets are appended in order.
  - Sheet labels default to "Sheet n of N" or the file name, and can be edited.

## 4. Data model (migration, number claimed at apply time)

Production holds **0** rows in both tables, so columns are changed in place with no data migration.

### `tenants.status_plans`: one per project per purpose
- Drop `floor_plan_id`, `page_index`, `source_file_path` and their triggers and constraints.
- Unique `(project_id, purpose)`.
- Keep `name`. It defaults to "Floor plan" or "Line diagram".

### New `tenants.status_plan_sheets`
| Column | Notes |
|---|---|
| `id` | |
| `status_plan_id` | FK, on delete cascade |
| `organisation_id` | bound by trigger |
| `sort_order` | |
| `label` | |
| `file_path` | current file |
| `page_index` | page within that file |
| `file_name` | |
| `mime` | |
| `revision` | int, starts at 1 |
| `replaced_at` | timestamptz null |
| `replaced_from_path` | text null |
| `pixels_per_meter` | null |
| `calibration_points` | jsonb null |
| `calibration_metres` | null |
| `created_by`, `created_at`, `updated_at` | |

Constraints and rules:
- Unique `(status_plan_id, sort_order)`.
- **Replace** sets a new `file_path`, `revision + 1`, `replaced_at = now()` and `replaced_from_path = old path`.
- **Re-anchor** clears `replaced_at` and keeps the masks (decision A).
- The scale is per sheet. Replacing a sheet keeps the scale but flags it in the same banner.

### `tenants.status_plan_shapes`
- Add `sheet_id NOT NULL` → `status_plan_sheets` (on delete cascade).
- A trigger ensures the sheet belongs to the shape's plan.
- Keep `status_plan_id`, so the rule "a node appears once per plan" still spans every sheet: a shop is masked once across all floor levels.

### Access and checks
- RLS follows the 00245 pattern (per-verb RESTRICTIVE write gates, read for project roles, generator-exact `site_scope`, the new table in the site-scope manifest).
- `@verify` block, impersonation assertions red-first, and the 00245 assertions updated.
- The full earlier `@verify` sweep runs under the new state.

### Cloud sync
- `isAnnotated()` drops the `status_plans` lookup, because these tables no longer reference drawings.
- The annotated-predicate contract test must stay green.
- ⚠ **Deploy order: deploy `cloud-sync-project` without the lookup BEFORE applying the migration.** The current lookup filters on `floor_plan_id`. Once that column is dropped the query errors, and `isAnnotated()` treats an error as "annotated", which would stop auto-adopt for every drawing in production.

## 5. Unchanged engine, re-pointed

- The canvas, reducer, shape view, side panel, legend, area check, detection, matcher and accept action read **sheet** image space from the sheet's own file and page.
- Scale comes from the sheet row, not `pageScaleFor(floor_plans …)`. "Set scale" writes the sheet; it does not call `calibrateFloorPlanAction`.
- Stale-write checks, error mapping, JSON props and role gates stay as built.
- **Report appendix:**
  - "Tenant floor plan": every sheet of the floor plan.
  - "Line diagram": optional, every sheet.
  - Same caps and the same storage handoff.
- **Export sheet:** per line-diagram sheet.
- **Tenant schedule "On plan ↗":** links to `/tenant-schedule/floor-plan?sheet=…&shape=…`.

## 6. Testing

- Migration: dry-run red-first; impersonation assertions:
  - contractor reads but cannot upload, replace or write;
  - client_viewer reads;
  - a lapsed-org PM sees nothing;
  - a shape's sheet must belong to its plan;
  - a node appears once across sheets;
  - one plan per purpose;
  - storage object RLS for the new bucket.
- Unit tests:
  - upload registration: N pages → N sheets, multiple files appended;
  - replace / re-anchor;
  - sheet strip navigation;
  - redirects from the old routes;
  - tenant-schedule cards per role.
- Plus the existing suites, `next build`, and the post-deploy checks: the routes redirect a signed-out visitor to login, and cloud sync runs clean after the function deploy and after the migration.
- **Not verifiable by the agent:** the signed-in walk.
