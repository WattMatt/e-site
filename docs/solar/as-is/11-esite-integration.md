# 11 — How a paid, per-project "Solar" module plugs into E-Site

Source: clean export of `origin/main` = **`b8cca2e`** (2026-09-22, PR #201) at
`scratchpad/esite-main`. Citations are repo-relative `path:line`. Migration head on main
is **`00206_floor_plan_markups_read_set.sql`**. Open PRs #191 (`00201`) and #193 (`00202`)
are claimed but unapplied and sit below the head, so they are stranded. The next free number
is **`00208`**, but claim it only at apply time, after checking the ledger, `origin/main` and
the migration filenames in open PRs (see CLAUDE.md, "Claiming a number is not holding it").

---

## 1. Paid features and entitlements today

### 1.1 Subscription tiers (per organisation, recurring)
- `packages/shared/src/services/billing.service.ts:14-55`: `PLANS` holds `free` (1 project, 5 users),
  `starter` (R499/mo, `monthlyKobo: 49900`, 5 projects), `professional` (**R1,499/mo**,
  `149900`, unlimited projects) and `enterprise` (custom, mailto). ⚠ CLAUDE.md's Paystack note
  says "Pro R999", but the code says R1,499. Resolve this before quoting Solar pricing next to the tiers.
- Plan codes come from env vars (`PAYSTACK_PLAN_*`, `billing.service.ts:5-13,105`). When none is
  set, checkout falls back to a one-off charge.
- Table `billing.subscriptions` (`apps/edge-functions/supabase/migrations/00007_billing_schema.sql:10-30`)
  has `tier` CHECK (`free|starter|professional|enterprise`), `status`, `paystack_subscription_code`,
  `next_billing_date` and `UNIQUE (organisation_id)`, so each org has **one** subscription.
- The only thing a tier enforces is the **project count**
  (`apps/web/src/actions/project.actions.ts:55-78`: `PLANS[tier].limits.projects`). No module is
  gated by tier. Tiers and add-ons are separate systems (`billing.service.ts:59-62`).
- The checkout route `apps/web/src/app/api/paystack/checkout/route.ts` is `OWNER_ADMIN`
  (`docs/rbac-matrix.md:184`).
- Read gate on billing rows: `00187_billing_read_role_gate.sql` narrowed invoices and subscription
  SELECT to owner/admin. Before that, every org member could read Paystack references.

### 1.2 Add-on unlocks: `FEATURE_PRICES`
`packages/shared/src/services/billing.service.ts:67-91`:

| key | price | model | backing table |
|---|---|---|---|
| `inspections` | R250 (`amountKobo 25000`) lifetime | `'org'` | `billing.org_feature_unlocks` |
| `jbcc` | R1,999 (`199900`) lifetime | `'org'` | `billing.org_feature_unlocks` |
| `generator_cost_recovery` | R2,000 (`200000`) | `'seat'` (per user) | `billing.org_feature_seats` |

`FeatureKey = keyof typeof FEATURE_PRICES` (`:91`). The unlock route's zod enum is built from
these keys (`apps/web/src/app/api/paystack/feature-unlock/route.ts:22`), so adding a key to
`FEATURE_PRICES` makes it purchasable automatically.

A third, separate model exists: the **MV per-user annual subscription**,
`billing.user_mv_subscriptions` (`00131_mv_user_subscription.sql:26-37`). It has `status` and
`current_period_end`, and access is checked by `public.user_has_mv_access(user)` (`00131:62-77`).
It uses the Paystack recurring plan `PAYSTACK_PLAN_MV_ANNUAL` and route `/api/paystack/mv-subscribe`
(any authenticated user; `rbac-matrix.md:189,240`). This is the only *recurring* add-on in the codebase.

### 1.3 Tables that record entitlements
- `billing.org_feature_unlocks` (`00097_org_feature_unlocks.sql:19-28`): `organisation_id`,
  `feature_key`, `paystack_reference UNIQUE`, `amount_paid_kobo`, `unlocked_at`, `unlocked_by`,
  `notes`, `UNIQUE(organisation_id, feature_key)`. Migration `00190_payment_events_and_unlock_revocation.sql:138-146`
  added `revoked_at` and `revoked_reason`, plus a partial unique index on `WHERE revoked_at IS NULL`.
  RLS: SELECT only, for any org member (`00097:39-41`). Only the service role writes.
- `billing.org_feature_seats` (`00125_org_feature_seats.sql:8-22`): `organisation_id`,
  `feature_key`, `assigned_user_id`, `paystack_reference UNIQUE`, and a unique assignment index.
- `billing.payment_events` (`00190:92-110`): audit and dispute log.
- `billing.invoices`: `billingService.recordInvoice`, idempotent on `paystack_reference`.

### 1.4 Purchase flow (one-time unlock)
1. The paywall page (e.g. `apps/web/src/app/(admin)/projects/[id]/jbcc/unlock/page.tsx:44-48`) shows
   `FEATURE_PRICES.jbcc`. The CTA is visible only to owner/admin.
2. `POST /api/paystack/feature-unlock` (`feature-unlock/route.ts:28-113`):
   - auth check, then rate limit of 5/min (`:37`);
   - resolves **the caller's OLDEST owner/admin membership** (`:52-60`). It does not use the
     project's org and has no `project_id` input;
   - returns 409 if `hasFeature` already holds (`:70-76`);
   - calls Paystack `transaction/initialize` with `metadata {type:'feature_unlock', feature_key,
     org_id, amount_kobo, return_to, cancel_action}` (`:86-95`).
   - `return_to` is validated by `apps/web/src/lib/paystack/return-to.ts:40,65-70`.
     `returnToForFeature` has a `case` per key.
3. `GET /api/paystack/callback` is the browser return. It branches on `metadata.type` for
   `feature_unlock | feature_seat | mv_subscription` (`callback/route.ts:46-60`). It does not grant access.
4. `POST /api/paystack/webhook` (`apps/web/src/app/api/paystack/webhook/route.ts`) does grant it:
   - HMAC check (`:196`);
   - `charge.success` with `metadata.type === 'feature_unlock'` upserts `org_feature_unlocks`
     (`onConflict: paystack_reference, ignoreDuplicates`) at `:276-300`;
   - a 23505 on the org+feature unique index is treated as a duplicate purchase. It notifies
     admins and records a "refund required" invoice (`:295-329`);
   - seats are handled at `:222-270`, MV at `:337-404`;
   - refund or reversal sets `revoked_at` on `org_feature_unlocks` (`:619-690`) and deletes seat
     rows (`:695-702`).
   - The edge function `paystack-webhook` is a retired 410 stub
     (`apps/edge-functions/supabase/functions/paystack-webhook/index.ts:2,32`).

### 1.5 How gates are checked
- **DB:** `public.has_feature(org, key)` (latest body `00190:156-168`: row exists AND
  `revoked_at IS NULL`) and `public.has_feature_seat(org, user, key)` (`00125:25-33`). Both
  **return TRUE unconditionally for the WM-Consulting org** `dddddddd-…0001`. EXECUTE is revoked
  from PUBLIC/anon and granted to authenticated and service_role (`00186_revoke_anon_execute_security_definer.sql:137-141`).
  Only one RLS policy uses an entitlement: `00098_system_templates_support.sql:63` (system
  inspection templates). JBCC and GCR data tables are **not** entitlement-gated in RLS. The gate
  is app-side only.
- **Server (web):** `apps/web/src/lib/features.ts` has `hasFeature` / `requireFeature(org, key,
  supabase, paywallPath)` (`:28-59`, which redirects) and `hasFeatureSeat` / `requireFeatureSeat` (`:67-99`).
  Both fail closed on RPC error. Call sites:
  - JBCC: route-group layout `apps/web/src/app/(admin)/projects/[id]/jbcc/(gated)/layout.tsx:43-46`.
    It runs a role gate first (`requireEffectiveRole(... JBCC_WRITE_ROLES)`, using `.ok`), then
    `requireFeature(project.organisation_id, 'jbcc', …, '/projects/${id}/jbcc/unlock')`. The unlock
    page is kept outside `(gated)` so the redirect cannot loop. The actions re-check at
    `apps/web/src/actions/jbcc.actions.ts:63` and `jbcc-parties.actions.ts:113,156,192`.
  - Inspections: `apps/web/src/app/(admin)/projects/[id]/inspections/layout.tsx:36`, plus every
    action (`actions/inspections.actions.ts:257,318,581,677`, `inspections-certify.actions.ts:105,321`,
    `inspections-template.actions.ts:50`).
  - GCR seat: the page renders an inline paywall (`projects/[id]/generator-cost-recovery/page.tsx:42-75`).
    The report APIs and actions re-check (`api/projects/[id]/generator-cost-recovery/reports/route.ts:52`,
    `report-preview/route.ts:40`, `gcr-reports.actions.ts:75`).
- **Client (sidebar lock icons):** `apps/web/src/app/(admin)/layout.tsx:35-58` computes
  `inspectionsUnlocked` and `jbccUnlocked` from the user's **primary (oldest) org**, not the
  project's org, and `mvUnlocked` from `hasMvAccess`. These are passed as props to the client
  `Sidebar` (`components/layout/Sidebar.tsx:104-112`), which shows `LockedBadge` (`:44,172-173`).
  `mvVisible` also hides the tab entirely until the plan env var exists (`layout.tsx:57`).
- **Mobile:** no entitlement check anywhere in `apps/mobile` (grep for `has_feature` returns nothing).

**Per-org or per-project?** Every current unlock is **per-org** (or per-user for seats and MV).
Nothing is per-project, even for the project-scoped modules JBCC and GCR.

### 1.6 What a PER-PROJECT Solar add-on needs
1. **Entitlement table.** Recommended: a new `billing.project_feature_unlocks (id, organisation_id,
   project_id → projects.projects ON DELETE CASCADE, feature_key, paystack_reference UNIQUE,
   amount_paid_kobo, unlocked_at, unlocked_by, notes, revoked_at, revoked_reason)` with a partial
   `UNIQUE(project_id, feature_key) WHERE revoked_at IS NULL`. The alternative is a nullable
   `project_id` column on `org_feature_unlocks`, but that breaks its
   `UNIQUE(organisation_id, feature_key)` and the webhook's duplicate-purchase logic, and it
   interacts with the `00190` partial index. Bind `organisation_id` to the project's org with a
   BEFORE trigger (the markup/route-history pattern), because the value comes from client-supplied metadata.
2. **SQL helper.** `public.has_project_feature(p_project_id uuid, p_feature_key text)` as
   SECURITY DEFINER, `SET search_path`. It should keep the WM-org bypass for consistency and
   ideally also honour an org-wide unlock, so an org subscription covers all projects.
   `REVOKE ALL … FROM PUBLIC, anon`, then `GRANT EXECUTE TO authenticated, service_role`. Add
   `anon_execute_absent` plus a behaviour `@verify`.
3. **`FEATURE_PRICES`.** Add `solar: { model: 'project', … }`. That means widening the `model`
   union and fixing the test `packages/shared/src/__tests__/billing/billing.service.test.ts`,
   which asserts the models. Watch out: `feature-unlock/route.ts:22` builds its enum from **all**
   keys, so a `'project'`-model key would be accepted by the org route unless that route filters
   by model. The seat route does its own model checks.
4. **Purchase route.** Either a new `POST /api/paystack/project-feature-unlock` or an extension of
   feature-unlock that takes `project_id`. The route must:
   - derive the org from the **project** instead of "oldest owner/admin membership";
   - gate on the project role (`requireEffectiveRole(projectId, OWNER_ADMIN or ORG_WRITE_ROLES)`,
     checking `.ok`, since the helper returns an object);
   - put `project_id` in the Paystack metadata;
   - return 409 when the project is already unlocked;
   - add a `case` in `returnToForFeature` pointing at `/projects/[id]/solar`.
5. **Webhook.** Add a `metadata.type === 'project_feature_unlock'` branch next to `:276`. Mirror
   its idempotency, duplicate-charge notification and invoice. Extend the refund/reversal revoke
   (`:619-690`) to set `revoked_at` on the new table by `paystack_reference`. The callback
   allow-list (`callback/route.ts:57-60`) needs the new type too.
6. **Gates.** Add `lib/features.ts` helpers `hasProjectFeature` / `requireProjectFeature`. Put a
   `(gated)` route-group layout under `projects/[id]/solar/` using the JBCC pattern (role gate,
   then feature gate, with the unlock page outside the group). Re-check in every server action
   and API route. Add a **RESTRICTIVE** RLS policy calling `has_project_feature(project_id,'solar')`
   on solar write tables if you want the DB, not just the app, to enforce the paywall. None of
   the current modules does this.
   ⚠ Split RESTRICTIVE policies by verb. A `FOR ALL` restrictive policy narrows reads as well
   (`00205` → `00206`).
7. **Sidebar.** Today's lock flags are per-org and computed in the layout, which never learns the
   project id. For a per-project lock, either compute it in a project-scoped layout or pass a map.
   The simplest option is to always show the Solar item and let the gated layout redirect to the
   unlock page (the JBCC UX).
8. **Optional per-org subscription.** Follow the MV model (recurring Paystack plan, status plus
   `current_period_end`) but keyed on the org. Or record the Solar subscription as a
   `billing.subscriptions` add-on. Note that `subscriptions` is `UNIQUE(organisation_id)` with a
   single tier, so an add-on needs its own table (e.g. `billing.org_addon_subscriptions`). Have
   `has_project_feature` OR in "org has an active Solar subscription". The webhook
   `subscription.disable/not_renew` and `charge.success` renewal paths (`:765-810`) show how MV does this.
9. **Pricing and data hygiene.** Money is stored as kobo `BIGINT`. `rbac-matrix.md` must gain the
   new route and page rows in the same PR (`rbac-matrix.md:579-587`). The GCR routes are already
   missing from the matrix; do not repeat that.

---

## 2. Project-scoped module pattern

### 2.1 Navigation
- The project sidebar is one hard-coded array: `apps/web/src/components/layout/Sidebar.tsx:71-90`
  (`projectNav(id)` has Overview, Snags, QC, Diary, RFIs, Equipment & Materials, Cables,
  Medium Voltage, GCR, Tenant Schedule, Inspections, Floor Plans, Handover, JBCC, Forms,
  Settings). There is no registry. A Solar entry is one line, plus an icon from `lucide-react`
  (`:7-13`) and optional lock/visibility logic (`:155,161-173`).
- The project id comes from the pathname (`:99-118`). Admin-only filtering is by primary-org role (`:124-128`).
- The client portal has a separate nav: `apps/web/src/components/portal/PortalProjectNav.tsx`.
- Mobile uses Expo Router: `apps/mobile/app/{projects/[id],snags,rfis,diary,floor-plans,inspections,…}`.
  None of the office modules (cables, tenant schedule, GCR, MV, JBCC) exist on mobile, so Solar
  can be web-only.

### 2.2 Routes
- Pages live in `apps/web/src/app/(admin)/projects/[id]/<module>/…`. The `(admin)/layout.tsx:29-30`
  bounces `client_viewer` to `/portal`. Folders present: `cables, diary, documents,
  equipment-materials, floor-plans, forms, generator-cost-recovery, handover, inspections, jbcc,
  medium-voltage, quality-control, settings, snags, tenant-schedule`.
- Route params are `[id]`, never `[projectId]`.
- Report and download APIs go under `apps/web/src/app/api/projects/[id]/<module>/…` with
  `export const runtime = 'nodejs'` (e.g. the GCR `reports/route.ts:11`). ⚠ `app/api/*` routes are
  outside `(admin)/layout.tsx`, so they must do their own role, entitlement and client-viewer
  gating. With the service client, RLS does not apply (CLAUDE.md, site-forms defect #7).
- Server actions live beside the page (`generator-cost-recovery/gcr.actions.ts`) or in `apps/web/src/actions/*.actions.ts`.
- Page → client-component props must be JSON. Function props across the RSC boundary break at
  render, and neither tsc nor build catches it (PR #201).

### 2.3 Role gates and constants
- `apps/web/src/lib/auth/require-role.ts`:
  - `requireRole(supabase, orgId, roles)` → `{ok, role}|{ok:false,error}` (`:48-70`);
  - `requireEffectiveRole(supabase, projectId, roles)`, project-aware via the
    `user_effective_project_role` RPC (`:85-103`). **It returns an object, so `if (!allowed)` is
    dead code and callers must check `.ok`.** A contract test guards this;
  - `requireRoleAPI` (`:130-156`);
  - `requireRolePage` (`:171+`).
- Constants in `packages/shared/src/types/index.ts`:
  - `OWNER_ADMIN` `:36`;
  - `ORG_WRITE_ROLES` = owner/admin/PM `:37`;
  - `JBCC_WRITE_ROLES` `:46`;
  - `SNAG_FIELD_ROLES`;
  - `COST_VIEW_ROLES` = owner/admin/PM `:61`, named separately on purpose;
  - `MARKUP_WRITE_ROLES` `:75`.
  - Suggestion: add `SOLAR_WRITE_ROLES` (likely `ORG_WRITE_ROLES`), and gate tariff and financial
    outputs on `COST_VIEW_ROLES`.
- Roles: owner, admin, project_manager, contractor, inspector, supplier, client_viewer (`docs/rbac-matrix.md:23-33`).

### 2.4 RLS helpers
- `public.user_has_project_access(project_id)` (final body `00204`, which now checks
  `pm.is_active`). It is TRUE for **any** project member, including client_viewer. That makes it
  a read gate only; never use it for writes.
- `public.user_effective_project_role(project_id)` (`00107`) returns NULL for non-members. Wrap
  it in `COALESCE`.
- `public.get_user_org_ids()`: active org memberships, any role.
- Cautionary precedent: GCR write policies are `FOR ALL USING (organisation_id = ANY(get_user_org_ids()))`
  (`00124_generator_cost_recovery_schema.sql:88-91`), which is role-blind, the 00051 shape. The
  repo-wide guard in `packages/db` (`cable-schedule-write-role-rls.contract.test.ts` and siblings)
  flags such shapes. Model Solar on `00193` / `00200`: PERMISSIVE read on
  `user_has_project_access`, plus RESTRICTIVE per-verb write gates on
  `user_effective_project_role IN (write roles)`, plus a BEFORE trigger that derives
  `organisation_id` from the project.

### 2.5 Schemas and new-schema conventions
- Exposed schemas: `apps/edge-functions/supabase/config.toml:9` lists `public, projects, field,
  tenants, suppliers, billing, marketplace, gcr, structure, cable_schedule, inspections`.
- Choices for Solar:
  - **reuse an existing schema** (e.g. `projects` or `structure`). This needs no PostgREST change;
    `field` was chosen for site forms for exactly this reason (CLAUDE.md, #160);
  - **new `solar` schema.** The GCR checklist in `00126_gcr_schema_grants.sql:10-17,20-40` applies:
    1. a GRANT USAGE and default-privileges block (00124 forgot it, and the page threw
       "permission denied for schema gcr");
    2. add the schema to `config.toml [api].schemas`;
    3. PATCH the prod PostgREST `db_schema` via the Management API (`PATCH /v1/projects/{ref}/postgrest`).
       Without step 3, REST returns `PGRST002` indefinitely.
    4. `NOTIFY pgrst,'reload schema'`.
  - ⚠ Do **not** copy 00126's `GRANT SELECT … TO anon`. `00168` revoked anon SELECT on
    `cable_schedule` and `structure`, so grant `authenticated` and `service_role` only.
- Every new function in an exposed schema needs `REVOKE ALL … FROM PUBLIC, anon` and then
  GRANT, because Supabase default privileges grant anon directly (CLAUDE.md, #162 and #160 defect #1).
  Never use `current_user` for authorisation inside SECURITY DEFINER.
- **`@verify` blocks** are required on every migration ≥ `00185`
  (`apps/web/src/lib/migration-verify-block.contract.test.ts:30`, `PROGRAMME_FLOOR='00185'`).
  - `.github/workflows/deploy-migrations.yml:20-24,69` auto-applies on a push to main that
    touches migrations, then runs `scripts/verify-migration-applied.ts`, which re-checks every
    migration ≥00185 on **every** deploy.
  - Grammar: `table view function column policy constraint index trigger cron grant_absent
    grant_present anon_execute_absent sql behaviour`.
  - A `sql:` payload is executed verbatim, so keep comments in `/* */`.
  - If a later migration drops an object named in an earlier `@verify`, edit that block too.
- Pre-apply tooling: `scripts/db/dry-run-migration.sh <file> scripts/db/assert-*.sql` runs a
  rolled-back transaction per assertion file. Impersonation assertions, like
  `assert-floor-plan-markups-roles.sql`, are what catch RLS behaviour.
- **Three test suites**, all of which must be green before any migration PR:
  - `pnpm --filter web test` / `type-check`;
  - `pnpm --filter @esite/shared test`;
  - `pnpm --filter @esite/db test:ci` (`packages/db/package.json:13-14`). This suite holds the
    repo-wide migration-text guards, and the other two never run them.
- `packages/db/src/types.ts` is hand-maintained and stale for newer schemas. Code casts
  `(supabase as any).schema('x')`.

---

## 3. Existing assets Solar should reuse

| Asset | Where | What Solar consumes |
|---|---|---|
| **Tenant schedule / structure tree** | `structure.nodes` (`00074_structure_schema_nodes.sql:27-68`) has `kind` (`tenant_db, main_board, common_area_board, rmu, mini_sub, generator`, plus a custom label from `00090`), `shop_number`, `shop_name`, **`shop_area_m2`**, `breaker_rating_a`, `rating_kva`, `voltage_v`, `section`, `parent_node_id` (00116), soft delete (00123). **`shop_category`** (`standard, fast_food, restaurant, national, other`) and `generator_participation` were added by `00124:12-17`. `structure.tenant_details` (`00080:60-77`, plus `00093` BO dates, `00144` `incomer_breaker_a / incomer_load_a / incomer_capacity_a`, `00169` legend fields). | Tenant GLA (m²) × shop category → **load-profile synthesis** (kW/m² by category, then a per-category daily/seasonal shape). The board hierarchy and `rating_kva` give the connection point, and the mini-sub or transformer kVA caps PV export or hosting. `incomer_load_a` gives measured or declared demand. BO (beneficial occupation) dates act as an occupancy ramp. ⚠ Data-quality lesson (#161): measure what is populated before designing on it. `shop_area_m2` is widely filled; `breaker_rating_a` / `section` were null in all 472 nodes at last measurement. |
| **GCR engine (closest analogue: area × category → kW → tariff → apportionment → branded report)** | `packages/shared/src/services/generator-cost-recovery/`: `loading.ts:3-18` (`areaM2 × {standard,fastFood,restaurant,national}KwPerSqm`), `operational.ts:16+` (R/kWh tariff), `apportionment.ts`, `capital.ts`, `sizing-table.ts`, `readiness.ts`, golden-master fixtures. Web: `projects/[id]/generator-cost-recovery/*` (tabs, bulk save, reports panel) and `lib/reports/generator-report*.tsx`. Schema `gcr.*` (00124/00126/00127/00134). | Reuse the category kW/m² density approach, the `TenantInput` mapping (`from-db.ts`), the per-tenant apportionment of a shared asset (PV energy and savings split per tenant, the PV analogue of generator cost recovery), the readiness-check UX and the report pipeline. It is the best template for module structure, apart from its role-blind RLS and seat-model billing. |
| **Cable schedule and calc engine** | `packages/shared/src/services/cable-calc.service.ts` (`voltDropPctForSupply :123`, `computeCumulativeVdMap :182`, `deratedRating :325`, `shortCircuitCheck :304`, `requiredParallelSet :403`). SANS reference tables in `cable_schedule` (incl. **`DERATING_SOLAR`** direct-solar-radiation factors, `00167:291-319`). Schema `cable_schedule.*` (supplies, revisions, routes). | AC cable sizing and volt drop from inverter to the point of connection. Solar-radiation derating for exposed cables. A PV/inverter feeder could be emitted as a cable-schedule supply instead of re-implementing sizing. The DC string side is not covered (SANS 10142-1 Table figures are AC LV). |
| **MV fault / IBR** | `mv-fault.service.ts`, `mv-fault.inverters.test.ts`. `cable_schedule.fault_sources.role` includes **`'inverter'`** (`00128:56`). UI `medium-voltage/[revisionId]/fault-sources/FaultSourceForm.tsx:49,154-164,271` (`sRatedVa`, `currentLimitFactor`). | Fault contribution of the PV inverter in grid-connection studies. MV is behind a per-user subscription, so decide whether Solar users need MV access. |
| **Drawings, markup, scale, measurement** | `tenants.floor_plans` (00006; `pixels_per_meter` 00035; `calibration_points/_metres/_page_index` 00198). `tenants.floor_plan_page_scales` (00199:103, per PDF page). `tenants.floor_plan_markups` (00205/00206, vector layers anchored to `file_path` + `source_revision_id`). Primitives `apps/web/src/lib/sheet/{use-sheet-image,use-sheet-viewport,viewport-math,draft-store}.ts` (pdfjs at fixed `scale: 2`; viewport maths; IndexedDB drafts), shared by `MarkupCanvas` and `RouteCanvas`. Route tracing in `cable_schedule.supply_routes/route_segments` (00192) + `lib/cable-route/{route-history,snap}.ts` + `packages/shared/src/services/cable-route.service.ts`. | **Roof and array layout.** Trace roof polygons on a calibrated roof plan, giving area in m² and module count. The polygon-with-scale machinery exists: a Konva canvas using the sheet primitives, like PR #201's `RouteCanvas`. DC and AC cable run lengths come from route tracing. ⚠ Any new table holding floor-plan pixel coordinates **must** be added to `isAnnotated()` in `cloud-sync-project`, or be declared exempt. `floor-plan-annotated-predicate.contract.test.ts` derives the list from the schema and will fail the build. Otherwise Dropbox auto-adopt silently re-points the drawing under the roof polygons. |
| **Reports** | `projects.reports` (00117, `kind` text, versioned with supersede chain; `note` + `summary` from 00183). `apps/web/src/actions/project-reports.actions.ts:112,158,201` (list, signed URL, delete). `apps/web/src/components/reports/SavedReportsPanel.tsx:84` (`{projectId, kind, source, reports, canManage}`). `lib/reports/*` (react-pdf: `components.tsx`, `interior.tsx`, `branding.ts`, `theme.ts`, `render-*.ts`). pdf-lib is used for the cable exports. **Sanitisers:** `apps/web/src/lib/pdf/winansi.ts:59-94` (`winAnsiSafe(text,{collapseWhitespace})`: pass `false` for react-pdf, default `true` for pdf-lib) and `lib/reports/winansi-text.ts`. Read gate `lib/reports/report-kind-access.ts:38-62` + DB `public.report_kind_is_sensitive()` (00183). | A Solar feasibility or yield report as `kind='solar_*'`. It **must** be declared in `REPORT_KIND_READ_ROLES` (financials → `COST_VIEW_ROLES`) or in `OPEN_READ_REPORT_KINDS`; the contract test fails otherwise. If gated, also extend `report_kind_is_sensitive()` in SQL. Route every string through `winAnsiSafe`: `kWp`, `m²` and `°` are safe, while `Ω`, `≤`, `→`, `✓` are silently corrupted in react-pdf. Unit symbols in yield tables are the risk. |
| **Documents and cloud sync** | Dropbox sync: edge fns `cloud-sync-project` / `cloud-sync-cron`, `tenants.floor_plan_versions` / `cloud_sync_runs` (00148), `cloud_storage_default_target` (00175:80). Cron `cloud-sync-poll` every 15 min. `projects/[id]/documents`. Direct-to-storage uploads bypass the Vercel body cap (`lib/storage/tenant-documents-upload.test.ts:48`, `inspections/.../useFieldPhotos.ts:87`). | Roof drawings, SLDs, site photos and meter-data CSVs can arrive via the existing Dropbox mapping. Large meter CSVs should go **browser → Supabase Storage** directly and be parsed server-side from storage, never POSTed through a function. |
| **Excel/CSV import** | `packages/shared/src/structure/tenant-import-parser.ts:305` (`parseTenantSchedule(buffer)`, exceljs) + `import-preview.ts:137` (`diffTenantSchedule`). Routes `api/tenant-schedule/{parse,commit}` (multipart, `runtime='nodejs'`, gated `requireEffectiveRole(ORG_WRITE_ROLES)`). The same parse → preview → commit shape is used in `api/cable-schedule/{parse,commit}` and `api/projects/[id]/boq/import`. | Template for importing meter interval data (CSV/xlsx) and tariff schedules: parse and preview with per-row errors, then commit. Lessons from #135: errored rows must not be treated as "missing" (a silent decommission), and imports need a write-role gate. `exceljs` is already a dependency of web and shared. |
| **Work items / tasks** | `projects.work_items`, `work_item_types` (seeded `rfi, snag, qc_defect, inspection, diary_action, form_action, order_followup, task`), `work_item_events`, `work_item_watchers` (`00196_work_item_spine.sql:195-445`). Registry types are retired by `is_active=false`. | Add a `solar_action` type, or use `task`, for follow-ups such as "obtain 12 months of meter data" or "utility SSEG application". Item 3's projection triggers (PR #193) are not applied yet. |
| **Notifications / email** | `apps/web/src/lib/notify.ts:51` (`notifyEntityEvent`), `lib/recipients.ts:20` (`resolveProjectRecipients`), `public.notifications` with **`notifications_type_check` re-declared in full** whenever a type is added (latest in `00190:177-200`). Edge `send-email` → Resend. `project_settings.notify_*_email` toggles. | Report-ready and "unlock purchased" notices. Adding a type means re-declaring the whole CHECK. ⚠ `project_notification_recipients()` resolves 12-13 real wmeng.co.za people on any WM project, so probe with the email toggle off. |
| **Inspections (Solar PV)** | Template `solar-pv-standalone` (category `solar_pv`, `00139:19-21`); validator `apps/edge-functions/supabase/functions/_shared/validation-rules/solar-pv.ts` (SANS 10142-3 / NRS 097-2-1 / IEC 62548: string Voc/Isc ±5 %, DC IR ≥ 0.5 MΩ); `validate-inspection/index.ts:38,63-64`. | Commissioning and CoC-side verification already exists behind the R250 Inspections unlock. A Solar design module can link to it rather than duplicating it. |
| **Site forms** | `field.*` (00179/00180/00184) Termination & Making Safe. The alternative-supply option `pv_or_inverter` is in the template (`00184:310`; label `FormFieldRenderer.tsx:99`). | Isolation records already recognise PV as an alternative supply. No change needed. |
| **Mobile** | Expo 52 + PowerSync (`apps/mobile/package.json:22,29`). Routes are listed in 2.1. The JWT claim `custom_jwt_claims` decides the synced projects. | Probably none for v1. If site survey (roof photos, meter readings) is wanted later, reuse the inspections photo capture (`apps/mobile/src/inspections`). |

---

## 4. Solar, PV, tariff and metering content already in E-Site

There is **no solar design, yield, tariff-model, meter-data or load-profile code or schema.**
What exists:
- **Solar PV inspection**: the template `solar-pv-standalone` and its validator (section 3 above).
- **Direct-solar-radiation cable derating** tables, `category='DERATING_SOLAR'` (`00167_sans_reference_corrections.sql:15,291-319`).
- **Inverter** as an MV fault-source role (`00128:47-70`, `FaultSourceForm.tsx`, `mv-fault.inverters.test.ts`).
- The **`pv_or_inverter`** alternative-supply option in site forms (`00180:301`, `00184:310`).
- **"Tariff"** appears only as the GCR generator operational tariff in R/kWh
  (`generator-cost-recovery/operational.ts:3-23`, `lib/reports/generator-report.tsx:268-298`,
  `gcr.report_revisions.summary.finalTariff`). It is not a utility tariff.
- **"ESKOM/UTILITY/MUNICIPAL"** is used only as a cable-schedule source classifier (`api/cable-schedule/commit/route.ts:86`).
- **"metering"** appears as a handover-document category (`00045_handover_documents.sql:47`) and
  in the unused `billing.usage_records` comment (`00007:56`).
- No NERSA or Eskom tariff tables, no kWh interval storage, no kWp, and no load profiles. The
  NERSA tariff and meter-CSV material lives outside the repo, in the Dropbox correspondence folders.

---

## 5. Platform constraints

- **Vercel serverless request body is about 4.5 MB.** It broke tenant-document and inspection
  uploads, and both moved to direct-to-storage (`TenantDocumentList.tsx:12`, `FileField.tsx:76`).
  `next.config.ts:80` sets `serverActions.bodySizeLimit: '10mb'`, but the platform cap still
  applies. A year of 15/30-minute meter data (17,520–35,040 rows × channels) can exceed this as
  xlsx or CSV, so upload to Storage and parse from there.
- **Function duration:** no route sets `maxDuration` and there is no `vercel.json`, so every
  function runs on the project default. Heavy PDF renders (pdf.js on an A1 took 20–60 s locally)
  and 8,760-hour yield simulations should be bounded. Precompute in `@esite/shared` (pure TS,
  unit-testable), cache results in a table, and set `export const maxDuration` explicitly on the
  report routes. Report routes use `runtime='nodejs'` (not edge) because react-pdf, pdf-lib and
  exceljs need Node.
- **Edge functions do not auto-deploy.** `deploy-edge-functions.yml` is `workflow_dispatch` only
  (`:39-40`), and the cloud-sync functions are not even in it. Deploy with
  `apps/edge-functions/deploy.sh`, then read `verify_jwt` and the version back. Function-to-function
  calls must forward the caller's Authorization (`SUPABASE_SERVICE_ROLE_KEY` is `sb_secret_…`, not a JWT).
- **Migrations:** they auto-apply on merge to main (`deploy-migrations.yml:20-24`), but a number
  collision makes `db push` exit 0 silently. Verify effects afterwards. Two PRs (#191, #193) are
  currently stranded below head.
- **Cron:** pg_cron + `net.http_post` scheduled via the Management API, not in migrations. Most
  migrations show the schedule commented out (`00148:136`, `00029:59`); `00194:1448` is the
  exception that schedules inline and is `@verify cron:`-checked. Nine jobs are active. A
  periodic tariff refresh or meter pull would add one.
- **Entitlement fail-closed and bypass:** `has_feature*` returns TRUE for the WM org, so internal
  testing never sees the paywall. Use the `rbac-test@e-site.live` contractor fixture (a
  non-WM-bypass role) or a throwaway org to test the locked state. Paystack is still test-mode or
  KYC-pending (CLAUDE.md, Outstanding #1), so a live purchase cannot be tested end to end yet.
- **Money and commission** decisions are open (5 % vs 6 %, Enterprise price). The tier prices in
  CLAUDE.md disagree with the code (Pro R999 vs R1,499).
- **Signed-in UI verification** has repeatedly been left undone by agents. Budget an owner-run
  walk from the empty state.

---

## Recommended shape (summary)
1. `FEATURE_PRICES.solar` with `model: 'project'`. Add `billing.project_feature_unlocks` and
   `public.has_project_feature()` (with an optional org-subscription OR). Add a project-aware
   purchase route, a webhook branch, refund revoke and callback type. Gate with a
   `projects/[id]/solar/(gated)/layout.tsx` in the JBCC shape, with the unlock page outside the group.
2. Data in an existing exposed schema (`projects` or `structure`) to avoid the PostgREST PATCH, or
   a new `solar` schema with the full 00126 checklist minus the anon grants. Use RESTRICTIVE
   per-verb write gates, org binding by trigger, `@verify` blocks, and impersonation assertion
   scripts. Run all three test suites.
3. Pure calculation in `packages/shared/src/services/solar/`: load synthesis from
   `shop_area_m2 × shop_category` (reuse GCR loading and its category densities), meter-data
   ingestion, yield, tariff savings and per-tenant apportionment (reuse the GCR apportionment
   pattern).
4. Roof layout on the sheet primitives, like a `RouteCanvas` sibling. Register any pixel-coordinate
   table with `isAnnotated()`.
5. Report `kind='solar_feasibility'` through `projects.reports` + `SavedReportsPanel`, cost-gated,
   with WinAnsi sanitising.
6. One sidebar entry plus `docs/rbac-matrix.md` rows in the same PR.
