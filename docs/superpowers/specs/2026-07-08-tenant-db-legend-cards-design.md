# Tenant DB Legend Cards — Design Spec

**Date:** 2026-07-08
**Status:** Design approved by Arno (this session). Implementation plan pending.
**Module:** Tenant schedule (`structure` schema, `/projects/[id]/tenant-schedule`)

## Goal

Capture the circuit-breaker layout of each tenant's electrical distribution board (DB) via a per-tenant form, and print the DB's **legend card** (the circuit chart fixed inside the DB door) as a PDF in the user's choice of A4 or A5.

## Why a new table (investigation summary)

- Every tenant is already a `structure.nodes` row with `kind='tenant_db'` — the feature anchors there.
- The cable-schedule module **cannot** supply this data: `cable_schedule.boards` holds only a main `breaker_rating_a`; `supplies`/`cables` model the feeder network *between* boards, not final circuits *inside* a board. The two board registries are not linked, and cable-schedule data is revision-frozen design data, not tenant deliverables.
- Existing per-tenant child tables (`tenant_scope_items` in `00080`, `node_orders` in `00083`) provide the exact schema/RLS/server-action/panel pattern to copy.

## Approved decisions

| Question | Decision |
|---|---|
| Circuit-row fields | Standard SANS-style (circuit no, description, phase, breaker rating, poles, curve, cable size) + board header block |
| Form location | Expandable "DB Legend" panel per tenant row in the tenant schedule (beside Scope of Work / Layout Issued) |
| Print format | **User-selectable A4 or A5** — not all boards accept A4. Per-tenant persisted default, overridable at print time |
| v1 conveniences | Quick-add N ways; spare-way marking. (No copy-from-tenant in v1) |

## Data model — migration `00169` (next available at time of writing)

### New table `structure.node_circuits`

One row per way/circuit in a tenant DB.

| Column | Type / constraint |
|---|---|
| `id` | UUID PK `gen_random_uuid()` |
| `node_id` | UUID NOT NULL FK → `structure.nodes(id)` ON DELETE CASCADE |
| `circuit_no` | TEXT NOT NULL (trimmed; free text, e.g. `1`, `3+5+7`); `UNIQUE (node_id, circuit_no)` |
| `description` | TEXT (blank allowed, esp. spares) |
| `phase` | TEXT NULL CHECK IN (`L1`,`L2`,`L3`,`3P`) |
| `breaker_rating_a` | NUMERIC NULL |
| `poles` | SMALLINT NULL CHECK IN (1,2,3,4) |
| `curve` | TEXT NULL CHECK IN (`B`,`C`,`D`) |
| `cable_size` | TEXT NULL (free text, e.g. `2.5mm² surfix`) |
| `is_spare` | BOOLEAN NOT NULL DEFAULT false |
| `sort_order` | INTEGER NOT NULL (assigned max+1 on insert; display/print order = `sort_order` ASC) |
| `created_at` / `updated_at` | TIMESTAMPTZ, `set_updated_at` trigger (same as `00080` tables) |

Index on `node_id`. RLS copied verbatim from the `tenant_scope_items` policies in `00080` (lines ~276–345), table name swapped: members-with-project-access SELECT, client_viewer SELECT (read-only), owner/admin/project_manager INSERT/UPDATE/DELETE.

### New columns on `structure.tenant_details` (card header, 1:1 with the node — reuses existing loading)

- `db_location` TEXT
- `db_fed_from` TEXT
- `db_earth_leakage_ma` NUMERIC
- *(Amended during planning: no `db_main_breaker_*` columns — `structure.nodes` already carries the DB's main breaker as `breaker_rating_a`/`pole_config` with derived `incomer_breaker_a`/`incomer_pole_config`, shown in the schedule's Breaker column. The legend header reuses that value; duplicating it on `tenant_details` would create a third source of truth.)*
- `legend_card_size` TEXT NOT NULL DEFAULT `'A4'` CHECK IN (`A4`,`A5`) — persisted per tenant because card size is a physical property of the board; reprints and future bulk export stay consistent.

Deploy notes: new table in an **existing** exposed schema → no PostgREST `db_schema` PATCH needed, only `NOTIFY pgrst, 'reload schema'`. Apply via Management API and log in `schema_migrations` (project convention).

## Server actions — `apps/web/src/actions/db-legend.actions.ts`

Copy the `tenant-scope.actions.ts` pattern (guards, then service-role structure-schema write). **Because writes bypass RLS via the service role, every mutating action must also gate `ORG_WRITE_ROLES` explicitly** (`requireEffectiveRole`, same as the PR #135 fix for tenant-schedule routes) in addition to `guardProjectAccess` + `guardNodeBelongsToProject`.

- `upsertCircuitAction(projectId, nodeId, circuit)` — insert or update one row; duplicate `circuit_no` returns an inline-displayable error (unique violation surfaced, not swallowed).
- `deleteCircuitAction(projectId, nodeId, circuitId)`
- `quickAddWaysAction(projectId, nodeId, count)` — `count` clamped 1–60. Creates `count` rows numbered from (max existing integer `circuit_no`)+1 (non-integer circuit numbers ignored when computing the start), each `is_spare=true`, empty description. **Quick-added rows default to spare until described** — an untouched row still prints honestly as SPARE.
- `updateLegendHeaderAction(projectId, nodeId, headerPatch)` — patches the new `tenant_details` columns only (allowlisted keys).

All actions `revalidatePath` the tenant-schedule page.

## UI — "DB Legend" panel

- New `_components/DbLegendPanel.tsx`, expandable per tenant row in `ScheduleTable.tsx` alongside Scope of Work / Layout Issued (same expand pattern).
- Header strip: location, fed from, earth leakage (mA), card size selector (A4/A5, persists via `updateLegendHeaderAction`); main breaker (A + poles) displayed read-only from the node's existing breaker fields.
- Circuit grid columns: Cct No | Phase | Description | CB (A) | Poles | Curve | Cable size | Spare toggle | delete. Inline-edit cells (follow `EditableCell.tsx` in the cables grid); rows ordered by `sort_order`.
- Controls: "Add way" (single row), "Add N ways" quick-add (numeric input), "Print legend card" button with size dropdown pre-set to the persisted size.
- `page.tsx` additionally loads `node_circuits` for the listed nodes and the new `tenant_details` columns.
- Panel is read-only (no edit affordances) for roles outside `ORG_WRITE_ROLES`; print remains available to all project-visible roles.

## Print — legend card PDF

- Route: `GET /api/tenant-schedule/legend-card/pdf?nodeId=…&size=A4|A5` (`runtime: 'nodejs'`). `size` optional → falls back to the tenant's `legend_card_size`.
- Auth: user-client reads under RLS (no service role). Project-visible roles incl. client_viewer may print. 404 if the node isn't a `tenant_db` visible to the caller.
- Renderer: `apps/web/src/lib/db-legend/render-legend-card.ts` using `pdf-lib`, following `export-pdf.ts` / `export-avery-labels.ts` (absolute coordinates, embedded Helvetica). **One layout function parameterised by page geometry** — A4 = 595.28×841.89 pt, A5 = 419.53×595.28 pt portrait — not two layouts.
- Content: branded header (project name, shop number/name, DB code, location, fed from, main breaker, earth leakage, print date), SANS-style circuit table, spares rendered as "SPARE" (muted), footer with contractor branding matching existing exports. Overflow paginates to further sheets with repeated table header.
- Response: `application/pdf`, `Content-Disposition: attachment; filename="legend-card-<shop_number-or-code>.pdf"`.

## Access control & docs

- `docs/rbac-matrix.md` updated in the same PR: the new API route (read: all project-visible roles) and the four server actions (write: `ORG_WRITE_ROLES`).
- RLS as above; no anon access.

## Testing

- Unit tests for action gates (same pattern as the PR #135 tenant-schedule route-gate tests): `client_viewer`/`contractor` rejected on all four actions; `project_manager`/`owner` accepted.
- Quick-add numbering unit tests (empty board; existing integer numbers; mixed text numbers; clamp at 60).
- Renderer smoke tests: correct page dimensions for A4 and A5; pagination triggers at capacity; spare row renders; doesn't throw on empty circuit list (prints header + "No circuits captured").
- Live verification after deploy: as an admin on a real project — quick-add 12 ways, describe a few, print both sizes; confirm the `rbac-test` contractor fixture gets read-only panel and can print but not mutate.

## Deploy cost

One migration (Management API + `schema_migrations` log + pgrst NOTIFY) + one Vercel deploy via PR to `main`. Additive only — no existing tenant-schedule behaviour changes, nothing existing needs re-verification.

## Out of scope (follow-ups)

- Copy legend from another tenant.
- Bulk "print all tenants" combined PDF.
- Mobile (Expo) capture.
- Any linkage to `cable_schedule.boards`.
