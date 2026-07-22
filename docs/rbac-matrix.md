# RBAC Matrix

The contract for "who can see/do what" across E-Site. **Every new route or
API endpoint must be added here in the same PR that introduces it.** If a
cell is wrong, the gate is wrong — file a bug.

The codebase has 7 org-level roles, defined in
[`packages/shared/src/types/index.ts`](../packages/shared/src/types/index.ts).
A user can hold different roles in different organisations (multi-tenancy),
and the marketplace `supplier` role is independent of the contractor-side
membership.

## Legend

| Symbol | Meaning |
|---|---|
| **W** | Can view *and* mutate (full CRUD as the route allows) |
| **R** | Read-only — page renders or GET returns data, but writes are blocked |
| **—** | No access — page redirects, or API returns 401/403/404 |
| **→** | Permanent redirect to a successor route — access is governed by the target's row |
| **?** | Behaviour not verified; flag for audit |

## Roles

| Role | Typical persona |
|---|---|
| `owner` | Founder / main contractor — full control incl. billing |
| `admin` | Senior team lead — full operational control, no billing |
| `project_manager` | PM scoped to one or more projects |
| `contractor` | Site team — read/write project data, no admin |
| `inspector` | Third-party compliance auditor — inspections only, paywall-gated |
| `supplier` | Marketplace seller — supplier portal only |
| `client_viewer` | Client / external rep — project-scoped read-only |

## Page routes (`apps/web/src/app/(admin)/*`)

| Route | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `/dashboard` | W | W | W | W | W | W | R |
| `/projects` (list) | W | W | W | W | R | — | R |
| `/projects/[id]` (overview) | W | W | W | W | R | — | R |
| `/projects/[id]/snags` (list; `?view=visits\|all`) | W | W | W | W | R | — | R |
| `/projects/[id]/snags/visits/[visitId]` (visit detail) | W | W | W | W | R | — | R |
| `/projects/[id]/quality-control` (list) | W | W | W | W | R | — | R⁹ |
| `/projects/[id]/quality-control/new` | W | W | W | W | R | — | R⁹ |
| `/projects/[id]/quality-control/[reportId]` (report detail) | W | W | W | W | R | — | R⁹ |
| `/projects/[id]/diary` | W | W | W | W | R | — | R |
| `/projects/[id]/cables` | W | W | W | R⁷ | — | — | R¹ |
| `/projects/[id]/medium-voltage` (MV protection studies; per-user paid subscription on top of role) | W | W | W | — | — | — | — |
| `/projects/[id]/equipment-materials` | W | W | W | W | — | — | R¹ |
| `/projects/[id]/equipment-schedule` | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ |
| `/projects/[id]/materials` | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ | →⁶ |
| `/projects/[id]/tenant-schedule` | W | W | W | W | — | — | R¹ |
| `/projects/[id]/floor-plans` | W | W | W | W | R | — | R |
| `/projects/[id]/handover` | W | W | W | R | R | — | R |
| `/projects/[id]/inspections` | W² | W² | W² | R² | W² | — | R² |
| `/rfis?projectId=…` | W | W | W | W | R | — | R |
| `/inspections/templates` | W² | W² | — | — | — | — | — |
| `/inspections/unlock` | W | R | R | — | — | — | — |
| `/marketplace` | W³ | W³ | W³ | W³ | — | — | — |
| `/marketplace/supplier/*` | — | — | — | — | — | W | — |
| `/site` (site capture) | W | W | W | W | W | — | — |
| `/cable-schedule/sans` | R | R | R | R | R | R | R |
| `/settings` | W | W | — | — | — | — | — |
| `/settings/billing` | W | W | — | — | — | — | — |
| `/settings/users` | W | W | — | — | — | — | — |
| `/settings/branding` | W | W | — | — | — | — | — |
| `/settings/organisation` | W | W | ? | — | — | — | — |
| `/settings/integrations` | W | W | ? | — | — | — | — |
| `/projects/[id]/jbcc/unlock` | R⁴ | R⁴ | R⁴ | R⁴ | R⁴ | — | — |
| `/projects/[id]/jbcc` (library landing) | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/notice/[code]` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/notice/[code]/new` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/tracking` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/tracking/[letterId]` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/parties` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |

¹ `client_viewer` exports redact cost columns ([`export-role.ts:104`](../apps/web/src/lib/cable-schedule/export-role.ts:104)).
² All inspections access requires `public.has_feature(org_id, 'inspections') = true` — the paywall layer comes before the role check. WM-Consulting bypasses.
³ Marketplace is Phase 2-gated by `NEXT_PUBLIC_PHASE_2_MARKETPLACE=true`.
⁴ `/jbcc/unlock` is visible to all authenticated org members (read-only paywall page). The `<UnlockJbccButton />` inside only renders for owner/admin; all other roles see "ask your owner/admin" text. No redirect for locked org — this IS the locked-state destination.
⁵ All JBCC routes under `/(gated)/` require `public.has_feature(org_id, 'jbcc') = true` **and** an effective project JBCC role — `jbcc/layout.tsx` runs `requireEffectiveRole(projectId, JBCC_WRITE_ROLES)` (owner/admin/project_manager/**contractor**) alongside the `requireFeature` paywall redirect. WM-Consulting bypasses the feature check. As of **migration 00170** the `jbcc_*` RLS reads AND writes are project-scoped to `JBCC_WRITE_ROLES` via `public.user_effective_project_role(...)`, so `inspector`, `supplier`, and `client_viewer` no longer see or download any contractual notices (previously they had org-wide read). Server actions in `jbcc.actions.ts` (`previewLetterAction`, `downloadExampleAction`, `generateLetterAction`, `letterLifecycleAction`, party + attachment actions) all enforce the same guard + a target-belongs-to-project IDOR check; `jbcc-parties.actions.ts` was brought onto the same gate (previously missing the feature check). Issued letters are content-frozen by DB trigger and every transition is written to the append-only `projects.jbcc_letter_events` audit trail.
⁶ `/equipment-schedule` and `/materials` were merged into `/equipment-materials` and now unconditionally `redirect()` there for every role (thin shims, no role gate of their own) — access is governed by the `/equipment-materials` row. Equipment management (add/edit/decommission boards) is inline on the unified tab and is gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) by the existing `equipment.actions` guards. `client_viewer` views the register (view-only) via the portal tab `/portal/[projectId]/equipment-materials` (see Client portal section).

⁷ **Corrected 2026-07 (SANS audit):** this cell previously read `W`, but every cable-schedule write path — server actions (`ROLES_ENGINEER = ORG_WRITE_ROLES`, i.e. owner/admin/project_manager only) and the import API routes — excludes `contractor`. The page renders read-only for contractors (no page-level role gate beyond the `(admin)` layout); their writes are refused server-side. A contractor promoted per-project via `projects.project_members` (role `project_manager`) gains `W` on that project through the effective-role gates.

⁹ **Quality Control (added 2026-07-14).** `client_viewer` never reaches these `(admin)` routes (`(admin)/layout.tsx` bounces clients to `/portal`); their actual surface is `/portal/[projectId]/quality-control` (see Client portal), and migration `00172`'s `qc_reports` SELECT policy additionally hides every non-`issued` report (drafts AND closed) from client viewers at the DB — a leaked link to a draft 404s. Pages compute `canWrite` via `requireEffectiveRole(..., QC_WRITE_ROLES)` (owner/admin/project_manager/**contractor**) and hide mutating affordances for `inspector`, who renders read-only; every mutation re-gates in its server action (see the Quality control actions section — issue/close/delete-report narrow to `ORG_WRITE_ROLES`).

## Client portal (`apps/web/src/app/(portal)/portal/*`)

Since the portal shipped (PR #124), `client_viewer` never reaches the `(admin)` shell —
`(admin)/layout.tsx` bounces clients to `/portal`, and `(portal)/layout.tsx` bounces every staff
role to `/dashboard` (fail-closed in both directions). The `client_viewer` column in the table
above therefore documents legacy per-page gates only; the client's actual surface is this portal.

| Route | client_viewer | all other roles |
|---|---|---|
| `/portal` (site list) | R | → `/dashboard` |
| `/portal/[projectId]` (overview) | Rᵃ | → `/dashboard` |
| `/portal/[projectId]/diary` | R | → `/dashboard` |
| `/portal/[projectId]/snags` | R | → `/dashboard` |
| `/portal/[projectId]/quality-control` | Rᵈ | → `/dashboard` |
| `/portal/[projectId]/inspections` | Rᵇ | → `/dashboard` |
| `/portal/[projectId]/cables` | Rᵇ | → `/dashboard` |
| `/portal/[projectId]/equipment-materials` | Rᶜ | → `/dashboard` |
| `/portal/[projectId]/generator-recovery` | Rᵇ | → `/dashboard` |
| `/portal/[projectId]/floor-plans` | R | → `/dashboard` |
| `/portal/[projectId]/handover` | R | → `/dashboard` |
| `/portal/[projectId]/tenant-schedule` | R | → `/dashboard` |

ᵃ Explicit project columns only — `contract_value` is never selected ([`lib/portal/data.ts`](../apps/web/src/lib/portal/data.ts)).
ᵇ Curated service-role read with explicit column allow-lists after the `requirePortalAccess` membership check; the client JWT stays RLS-blocked on these schemas.
ᶜ Added 2026-07-07 (user decision, reversing the 2026-07-06 "not chosen"): board register + procurement status. Served by a **curated service-role read** (like cables/gcr) — order notes, quote/order-instruction documents and shop drawings are never selected, and migration `00166` now blocks the client JWT from reading `structure.node_orders` / `node_order_documents` / `node_order_shop_drawings` and the `node-order-documents` storage bucket directly (a confirmed pre-existing leak: a client could `GET` a quote PDF via PostgREST/storage).
ᵈ **Issued QC reports only — enforced at the DB**, not by page logic: migration `00172`'s `qc_reports` SELECT policy hides non-`issued` rows (drafts AND closed) from client viewers, and the page just renders what the user client returns. "Download PDF" goes through `getPortalQcReportPdfUrlAction` (`portal-qc.actions.ts`), which RLS-reads the QC report AND the latest issued `projects.reports` `kind='qc'` row on the **user client** (`reports_select`, 00117 — `user_has_project_access`) before service-signing a 300 s download URL.

Every `[projectId]` aspect is gated by `requirePortalAccess` in the per-project layout (active
`client_viewer` + active `project_members` row, else 404). Table writes are independently blocked at
the DB by the 00161/00162 RESTRICTIVE client_viewer policies; commercial procurement reads by the
00166 effective-client_viewer SELECT guards.

> **Invite integrity.** Project role `client_viewer` is only coherent when the user's identity-org
> role is also `client_viewer` (every shell/RLS gate keys off the org role). `bulkAddOrInviteProjectMembers`
> and `addProjectMembersFromSubOrg` now reject tagging an existing staff-org user as a project
> `client_viewer` — that would silently grant full staff access + the admin shell. Give client
> access via a dedicated client invite (new user → org role `client_viewer`).

## Project settings (`apps/web/src/app/(admin)/projects/[id]/settings/*`)

All 14 sub-pages live under `/projects/[id]/settings/`. View-vs-edit roles narrow further per sub-page. The DB RLS gate underneath (PR-1a) is `ORG_WRITE_ROLES`; app-layer rows below narrow further. PR-1c ships these routes as placeholders ("Coming soon"); real forms land per Phase-2 PR.

| Sub-page | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `/projects/[id]/settings/general`       | W | W | W | R | R | R | R |
| `/projects/[id]/settings/site`          | W | W | W | R | R | R | R |
| `/projects/[id]/settings/dates`         | W | W | W | R | R | R | R |
| `/projects/[id]/settings/client`        | W | W | W | R | R | R | R |
| `/projects/[id]/settings/contract`      | W | W | — | — | — | — | — |
| `/projects/[id]/settings/rates`         | W | W | W | — | — | — | — |
| `/projects/[id]/settings/valuations`    | W | W | W | — | — | — | — |
| `/projects/[id]/settings/variations`    | W | W | W | — | — | — | — |
| `/projects/[id]/settings/members`       | W | W | — | — | — | — | — |
| `/projects/[id]/settings/contacts`      | W | W | W | R | R | R | R |
| `/projects/[id]/settings/jbcc-parties`  | W | W | W | R | R | R | R |
| `/projects/[id]/settings/operational`   | W | W | W | R | R | R | R |
| `/projects/[id]/settings/integrations`  | W | W | — | — | — | — | — |
| `/projects/[id]/settings/danger-zone`   | W | — | — | — | — | — | — |
| `/projects/[id]/settings/history`       | R | R | R | R | R | R | R |

W = view + edit; R = view only; — = denied (route redirects to `/dashboard`).

## API routes (`apps/web/src/app/api/*`)

| Endpoint | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `POST /api/paystack/checkout` | W | W | — | — | — | — | — |
| `POST /api/projects/[id]/boq/import`    | W | W | W | — | — | — | — |
| `POST /api/paystack/cancel-subscription` | W | W | — | — | — | — | — |
| `POST /api/paystack/callback` | n/a — public webhook, signature-validated |
| `POST /api/inspections/delete-photo` | W | W | W | W² | W² | — | — |
| `POST /api/notifications/dispatch` | bearer-token; not session-gated — **not yet audited** |
| `POST /api/paystack/feature-unlock` | W | W | — | — | — | — | — |
| `GET /api/jbcc/sign` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `GET /api/projects/[id]/snags/visits/[visitId]/report` | R | R | R | R | R | — | R |
| `GET /api/projects/[id]/quality-control/[reportId]/report` | R | R | R | R | R | — | R⁹ |
| `POST /api/medium-voltage/study` | W | W | W | — | — | — | — |
| `POST /api/tenant-schedule/parse` | W | W | W | —⁷ | — | — | — |
| `POST /api/tenant-schedule/commit` | W | W | W | —⁷ | — | — | — |
| `GET /api/tenant-schedule/legend-card/pdf` | R | R | R | R | R | — | R⁸ |
| `POST /api/cable-schedule/parse` | W | W | W | —⁷ | — | — | — |
| `POST /api/cable-schedule/commit` | W | W | W | —⁷ | — | — | — |
| `GET /api/cable-schedule/export/excel` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/pdf` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/csv` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/zip` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/multi-zip` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/tag-list/pdf` | R | R | R | — | — | — | R¹ |
| `GET /api/cable-schedule/export/tag-labels/pdf` | R | R | R | — | — | — | R¹ |

> `POST /api/tenant-schedule/parse` (preview, no writes) and `POST /api/tenant-schedule/commit` (full-sync import; **writes run with the service-role key, bypassing RLS**) are both gated via `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` — the same gate the `/projects/[id]/tenant-schedule` page applies before rendering the ImportFlow control. ⁶ A contractor promoted per-project via `projects.project_members` (role `project_manager`) passes the effective-role gate on that project.
>
> ⁸ `GET /api/tenant-schedule/legend-card/pdf` (added with the DB legend cards feature) is read-only and has **no explicit role gate** — it runs on the cookie client under RLS, and the `structure.nodes` RLS-gated read (`kind='tenant_db'`) IS the access check: any role that can see the node (any active project member, `client_viewer` included) gets the PDF, an invisible or non-tenant node 404s. No service-role writes occur on this route.

> `POST /api/cable-schedule/parse` (preview, no writes) and `POST /api/cable-schedule/commit` (imports a whole revision: sources / structure.nodes / supplies / cables / change_log; **writes run on the user client so RLS applies, but RLS's cable_schedule write policies are role-agnostic beyond the client_viewer block**) are both gated via `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` — added 2026-07 (SANS audit); previously only project *visibility* was checked, the same gap PR #135 closed for the tenant-schedule routes. ⁷ as above: a per-project `project_manager` promotion passes.
>
> All 7 `GET /api/cable-schedule/export/*` routes gate via `getExportPolicy` ([`export-role.ts`](../apps/web/src/lib/cable-schedule/export-role.ts)): owner/admin/project_manager export fully; `client_viewer` may export **only when active in `projects.project_members` for the project**, with all cost data redacted (¹); contractor/inspector/supplier are blocked entirely. Size caps return 413 (`MAX_CABLES_PER_EXPORT` 500, PDF/ZIP 300).

> `GET /api/projects/[id]/quality-control/[reportId]/report` (inline QC PDF preview, no persistence — snag-visit report pattern) returns 401 unauthenticated, then gates inside `gatherQcReportData`: the cookie-client **RLS read of the `qc_reports` row is the visibility gate** — a report invisible to the caller (wrong org, or ⁹ a non-`issued` report for a `client_viewer`, per 00172) 404s — plus `requireEffectiveRole` over all 7 project roles (403 for non-members). Photo bytes are fetched with the service client only after both gates pass.
>
> `POST /api/medium-voltage/study` runs the heavy MV Z-bus + earth-fault solve and caches per-node `fault_results` for a revision. Gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireRoleAPI(ORG_WRITE_ROLES, orgId)` against the *revision's* org; refused on non-DRAFT revisions (an ISSUED snapshot is frozen). Discrimination/coordination compute is deferred to Phase 4b (device-pairing design).

## Server actions (`apps/web/src/actions/*`)

Read-only actions require project access (any project member). Write/export actions are gated to `ORG_WRITE_ROLES` (owner / admin / project_manager) via `requireEffectiveRole`, enforced in-app on top of RLS.

### Organisation users (`users.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createUserAction` | W | W | — | — | — | — | — |
| `updateUserAction` | W | W | — | — | — | — | — |
| `removeUserAction` | W | W | — | — | — | — | — |
| `resendInviteAction` | W | W | — | — | — | — | — |

> All four gate to owner/admin of the **caller's** org (`getOrgContext` + `isOrgAdmin` — this file predates the `requireRole` helpers) and mutate via the service client, so the app gate is load-bearing. Owner-role rules: `createUserAction` refuses to assign `owner`; `updateUserAction`/`removeUserAction` require an owner caller to touch an owner row and never strip the last active owner.
>
> `resendInviteAction` (added with the invite-expiry fix) re-sends the branded set-password invite — fresh recovery link + 6-digit code — to an **active member of the caller's org who has never signed in** (`auth.users.last_sign_in_at IS NULL`, checked via `auth.admin.getUserById`). It refuses for users who have already signed in (they use "Forgot password" instead). Sub-org members are **out of scope** (their membership row is on the sub-org, not the caller's org) — for them, removing and re-adding via the sub-org roster re-sends the invite. Rate-limited per caller like `createUserAction`; surfaced as the "Resend invite" button on `/settings/users` rows.

### Organisation branding / letterhead (`org-branding.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `uploadOrgLogoAction` | W | W | — | — | — | — | — |
| `updateOrgBrandingAction` | W | W | — | — | — | — | — |
| `removeOrgLogoAction` | W | W | — | — | — | — | — |

> Org-level letterhead used on generated JBCC notice letters + reports. All three gate to owner/admin of the **caller's primary org** (`getOrgContext` + `requireRole(OWNER_ADMIN)`) and mutate via the service client (RLS-bypassing storage upload + `organisations` write), so the app gate is load-bearing. Logo is a PNG/JPEG ≤ 5 MB stored at `report-logos/{orgId}/org-logo.{ext}` with the path on `organisations.logo_url`; accent must match `#RRGGBB`. Surfaced at `/settings/branding`.

### Snag site visits (`snag-visit.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createSnagVisitAction` | W | W | W | — | — | — | — |
| `updateSnagVisitAction` | W | W | W | — | — | — | — |
| `deleteSnagVisitAction` | W | W | W | — | — | — | — |
| `addSnagToVisitAction` | W | W | W | W | W | W | — |
| `closeSnagOnVisitAction` | W | W | W | W | W | W | — |
| `exportSnagVisitReportAction` (renders + persists to `projects.reports`, kind=`snag`) | W | W | W | — | — | — | — |

> **Widened 2026-06-04:** raising/closing a snag *on a visit* (`addSnagToVisitAction`, `closeSnagOnVisitAction`) is gated to `SNAG_FIELD_ROLES` = every role **except** read-only `client_viewer` — site agents (contractor/inspector/supplier) can both raise and close snags during a visit. Creating/editing the visit and exporting the report stay `ORG_WRITE_ROLES` (owner/admin/PM).

### Tenant hard-delete (`tenant-delete.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `getTenantDeleteSummaryAction` | W | W | W | — | — | — | — |
| `hardDeleteTenantAction` | W | W | W | — | — | — | — |

> Permanently deletes a tenant board (`structure.nodes` kind=`tenant_db`) + its cascade (scope/units/documents/orders/drawings) + handover copies + storage objects. Gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireEffectiveRole` — **stricter** than the `/tenant-schedule` page row's general `W` (contractor can edit the schedule but not hard-delete a tenant). Refused when the tenant is wired into an **issued** cable revision or has child boards.

### DB legend cards (`db-legend.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `upsertCircuitAction` | W | W | W | — | — | — | — |
| `deleteCircuitAction` | W | W | W | — | — | — | — |
| `quickAddWaysAction` | W | W | W | — | — | — | — |
| `updateLegendHeaderAction` | W | W | W | — | — | — | — |

> All four manage `structure.node_circuits` rows and the legend-card header columns on `structure.tenant_details` (migration `00169`), writing via the **service-role key** (cross-schema PostgREST `fetch`, bypasses RLS — same pattern as `tenant-scope.actions.ts`). `guardProjectAccess` enforces `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` (owner/admin/project_manager) before any write; a contractor promoted per-project via `projects.project_members` (role `project_manager`) passes on that project. The read-only print path (`GET /api/tenant-schedule/legend-card/pdf`, see API routes) is open to any project-visible role.

### Floor-plan markup / RFI annotations (`rfi-annotation.actions.ts`, `markup-export.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createRfiAnnotationAction` (save markup → attach/create RFI) | W | W | W | W | — | — | — |
| `updateRfiAnnotationAction` (re-edit an existing markup) | W | W | W | W | — | — | — |
| `exportRfiMarkupPdfAction` (flatten a saved markup → PDF) | R | R | R | R | R | — | R |

> **Added 2026-07-09 (markup authz hardening).** Both write actions upload a composited PNG to the `rfi-attachments` bucket and insert/update `public.rfi_annotations`, always creating or attaching an RFI. Previously they checked only `auth.getUser()` and relied 100% on RLS — the same class of gap PRs #135/#137/#143 closed on other write surfaces. They now gate on `requireEffectiveRole(supabase, projectId, MARKUP_WRITE_ROLES)` — owner/admin/project_manager/**contractor**, matching the `/rfis` + `/floor-plans` write set — **before** any storage upload or DB write (the project is resolved via the annotation's RFI on the update path). Read-only roles (inspector/supplier/client_viewer) are refused with a clear message instead of a raw RLS violation. **Migration `00171`** is the uniform DB backstop: a RESTRICTIVE policy on `public.rfi_annotations` enforces `MARKUP_WRITE_ROLES` on **every** INSERT/UPDATE/DELETE (resolving the project through `source_floor_plan_id → tenants.floor_plans.project_id` via a SECURITY DEFINER helper), so the same boundary holds for the **client-side** `components/attachments/commit.ts` RFI-create/respond/gallery-re-edit writes and any direct PostgREST call — not just these server actions. `00161`/`00162` continue to block `client_viewer` on the shared `attachments` row + `rfi-attachments`/`drawings` storage buckets. (00171 verified behaviourally against Postgres 17: owner/admin/PM/contractor pass, inspector/supplier/client_viewer + plan-less rows fail closed.) `exportRfiMarkupPdfAction` is a read (download the already-saved PNG → wrap in a single-page PDF) and stays open to any role that can already see the markup. The `/projects/[id]/floor-plans` list page and the per-drawing viewer compute the same `canWrite` (via `requireEffectiveRole` + `MARKUP_WRITE_ROLES`) and hide the upload / cloud-sync / per-row Markup / mode-toggle affordances for read-only roles — who get pan/zoom + overlays only (`MarkupCanvas` mode `'view'`). Constant `MARKUP_WRITE_ROLES` lives in `@esite/shared` alongside `ORG_WRITE_ROLES`.

### Site diary (`diary.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `deleteDiaryEntryAction` (delete) | W | W | W | W† | W† | W† | W† |

> **Delete** (`deleteDiaryEntryAction`) is gated to the entry **author** OR **`ORG_WRITE_ROLES`** (owner / admin / project_manager) — a contractor / inspector / supplier / client_viewer marked † can only delete entries they authored; owner/admin/PM can delete any entry.
>
> **Create** has no server action — entries are created client-side via `diaryService.create()` from `AddDiaryEntryForm`, gated only by RLS to any active org member (unchanged).

### Quality control (`qc.actions.ts`, `portal-qc.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createQcReportAction` | W | W | W | W | — | — | — |
| `updateQcReportAction` | W | W | W | W | — | — | — |
| `addQcEntryAction` | W | W | W | W | — | — | — |
| `addQcCommentAction` | W | W | W | W | — | — | — |
| `deleteQcEntryAction` | W | W | W | W† | — | — | — |
| `deleteQcPhotoAction` | W | W | W | W† | — | — | — |
| `deleteQcCommentAction` | W | W | W | W† | — | — | — |
| `deleteQcReportAction` | W | W | W | — | — | — | — |
| `closeQcReportAction` | W | W | W | — | — | — | — |
| `reopenQcReportAction` | W | W | W | — | — | — | — |
| `issueQcReportAction` (renders + persists to `projects.reports`, kind=`qc`) | W | W | W | — | — | — | — |
| `getPortalQcReportPdfUrlAction` (signed download link) | R | R | R | R | R | — | R |

> Lifecycle writes (`createQcReportAction`, `updateQcReportAction`, `addQcEntryAction`, `addQcCommentAction`) gate on `requireEffectiveRole(supabase, projectId, QC_WRITE_ROLES)` — owner/admin/project_manager/**contractor**, same write set as markup — with the project resolved from the target row's own `project_id` via an RLS read (never a client-supplied id), then write via the cookie/RLS client so 00172's per-verb policies stay the backstop. Photo/markup rows have **no server action by design** — they are inserted client-side under RLS by `lib/qc-photos.ts` (diary-attachments pattern), and **markup re-edit** (the entry card's ✎ on `kind='markup'` photos, shown for `QC_WRITE_ROLES` on non-closed reports) replaces the flattened PNG at the SAME storage path (`upsert:true`) + updates `annotation_data`/`file_size_bytes` on the same row via `replaceQcMarkup` — client-side under the 00172 `qc_entry_photos` UPDATE policy and the qc-report-entries storage UPDATE policy (the RFI `replaceAnnotation` pattern).
>
> **UI wiring (report detail page).** `updateQcReportAction` is reached through the inline "Edit report" form (`EditQcReportForm` — title/description/location/inspection date), rendered for `QC_WRITE_ROLES` while `status != 'closed'`. `closeQcReportAction` ("Close report", two-step armed, shown when `issued`), `reopenQcReportAction` ("Reopen report", shown when `closed` — the Issue button is hidden on closed reports and Reopen shows instead) and `deleteQcReportAction` ("Delete report", two-step armed, redirects to the QC list) render only for `ORG_WRITE_ROLES` (`canManage`) in `QcReportsSection`; every button's action re-gates server-side, so the visibility is UX, not the boundary.
>
> **Create fires no notification.** A draft is private working state (00172 hides non-`issued` reports from client viewers, and a draft title may carry unvetted findings); the single notify moment is issue time (`notifyQcIssued`).
>
> **Closed-report freeze (server-side).** Every content mutation — `updateQcReportAction`, `addQcEntryAction`, `addQcCommentAction`, and the three child deletes (author or not) — refuses when the parent report's `status='closed'`, mirroring the 00172 DB-trigger freeze on the child tables. `issueQcReportAction` also refuses closed (a re-issue would silently reopen the report in the client portal + re-email the roster); the only way out of closed is the explicit `reopenQcReportAction`.
>
> Deletes (`deleteQcEntryAction` / `deleteQcPhotoAction` / `deleteQcCommentAction`) follow the diary delete pattern: **author** (†) OR `ORG_WRITE_ROLES`, RLS read for the gate, then service client for the row delete + best-effort storage cleanup. Inspector/supplier can never author QC content (`QC_WRITE_ROLES` excludes them), so the † columns are effectively contractor-only.
>
> `deleteQcReportAction` / `closeQcReportAction` / `reopenQcReportAction` / `issueQcReportAction` gate to `ORG_WRITE_ROLES` and write via the service client (in-app gate load-bearing, matching `snag-visit.actions.ts`; per-project promotions don't satisfy the table's RLS write policies). Close (`issued → closed`) and reopen (`closed → issued` only) are **row-verified** status flips — a 0-row update returns an error instead of silently succeeding. Issue renders the branded PDF, uploads `qc-reports/{org}/{project}/qc-report-{reportId}-v{n}.pdf` (`upsert:false`, storage rollback on row-insert failure), inserts a versioned `projects.reports` row and supersedes ALL prior issued rows (`exportSnagVisitReportAction` shape), flips the report to `issued` (+`issued_at`/`by`), then notifies the roster — bell `qc_issued` + `notify_qc_email`-gated email with a 7-day signed PDF link.
>
> `getPortalQcReportPdfUrlAction` (`portal-qc.actions.ts`) has **no role gate by design**: both the `qc_reports` and `projects.reports` reads run on the user client, so RLS visibility — including the client_viewer issued-only rule — is the gate; only the 300 s signed-URL creation uses the service client. See the Client portal section (ᵈ).

### MV protection (`mv-protection.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `upsertMvStudySettings` | W | W | W | — | — | — | — |
| `upsertFaultSource` | W | W | W | — | — | — | — |
| `upsertProtectionDevice` | W | W | W | — | — | — | — |
| `overrideFaultLevel` | W | W | W | — | — | — | — |

> All four resolve revision → project → org and gate to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireEffectiveRole`, on top of the cable_schedule org RLS (`get_user_org_ids` + `user_is_client_viewer`). Each **refuses writes on a non-DRAFT revision** (ISSUED / SUPERSEDED are frozen — start a new revision). `overrideFaultLevel` writes `revisions.fault_level_ka` (the source prospective value `shortCircuitCheck` consumes) and records provenance in `change_log`. `issueMvStudy` (the gated DRAFT→ISSUED transition) is Phase 6.

### Inspection reports (`inspection-report.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `regenerateInspectionReportAction` | W | W | W | — | — | — | — |

> Manual re-issue of an inspection's branded report (certify auto-runs the same worker). Gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireEffectiveRole`, requires `public.has_feature(org_id, 'inspections')`, with a **cross-project guard** (the inspection's `project_id` must match the route project before any write). Renders via the Node renderer → saves versioned to `projects.reports` (kind=`inspection`) → auto-files the cert into handover `compliance_certs` and the inspection's own uploads into `test_certificates`, each tagged `origin_kind='inspection'` for clean re-issue dedup.
>
> **Report page read** (`/projects/[id]/inspections/[inspectionId]/report`) — the PDF artifact source moved from `inspections.certificates` to the latest **issued** `projects.reports` row (read by project role via the `reports_select` RLS). Share-link + Revoke are deferred in v1 (the legacy `generateShareLinkAction` / `revokeCertificateAction` remain but are no longer surfaced).

## Public / unauthenticated

| Route | Access |
|---|---|
| `/login`, `/signup`, `/forgot-password` | Public |
| `/auth/confirm` | Public; single-use-link interstitial. Emailed `token_hash` links (invites, recovery, magic links) land here **unverified** — the page's form POSTs the token to `POST /auth/callback`, the only place `verifyOtp` runs, so mail-scanner GET prefetch can't burn the token. Renders nothing sensitive; a missing/unknown-type token redirects to `/login?error=auth_callback_failed`. |
| `/inspection/[token]` | Public; signed COC share link (expires) |
| `/(portal)/compliance` | Public; client view of approved COCs |

## How to add a new route

1. **Server-side gate.** Use one of these:
   - Server component / page → `requireRolePage(allowedRoles)` from [`@/lib/auth/require-role`](../apps/web/src/lib/auth/require-role.ts). Redirects on failure.
   - API route → `requireRoleAPI(allowedRoles, orgId?)`. Returns `NextResponse` on failure.
   - Server action with an entity-bound org id → `requireRole(supabase, orgId, allowedRoles)` (primitive).
2. **Constants.** Import role groups from `@esite/shared`: `OWNER_ADMIN`, `ORG_WRITE_ROLES`. Don't hardcode `['owner','admin']` arrays — drift surface.
3. **Update this matrix.** Add a row with the verified W/R/— cells for each role.
4. **RLS.** Confirm Postgres RLS independently denies cross-org reads/writes. The app-layer gate should not be load-bearing — RLS is the backstop.

## Known gaps & open audits

These are tracked outside this doc:

- **Supplier portal isolation.** No `(supplier)` route group exists; suppliers reach `(admin)/*` and rely on per-page gates. Audit whether every page either redirects suppliers or semantically tolerates supplier access.
- **`/api/notifications/dispatch` bearer auth.** Confirm the bearer secret is required, rate-limited, and the dispatch payload can't leak cross-org notifications.
- **Cable-schedule RLS.** App-layer gates are present ([`require-role.ts`](../apps/web/src/lib/cable-schedule/require-role.ts)); verify RLS denies cross-org access independently.
- **Floor-plan *management* writes (upload / calibrate / adopt-latest) are role-agnostic beyond `client_viewer`.** `tenants.floor_plans` write RLS authorises by org membership; `00161` excludes only `client_viewer`. The 2026-07-09 UI hides the upload button, cloud-sync toolbar and the MarkupCanvas *Calibrate* control for read-only roles, but a determined `inspector`/`supplier` could still `INSERT`/`UPDATE` a `floor_plans` row via PostgREST directly. Low severity (trusted internal roles; the external `client_viewer` is DB-blocked; calibration/upload are not commercially sensitive). Deliberately NOT gated at the DB in this pass because a RESTRICTIVE `floor_plans` write policy must not disturb the cloud-sync *adopt-latest* path; tracked as a follow-up. **Markup authoring itself (`rfi_annotations`) IS now uniformly DB-gated to `MARKUP_WRITE_ROLES` across every write path by migration `00171`** — this residual is floor-plan file management only, not markup content. Also: the client-side `commit.ts` annotation INSERT (RFI-create-with-markup) omits the `NOT NULL` `rfi_id` and so silently no-ops even for writers — a pre-existing latent bug, separate from authz, worth a follow-up.
- **QC storage buckets accept unreferenced blobs from non-write roles.** `qc-report-entries` / `qc-reports` use the platform-wide Pattern-A storage RLS (org-id path prefix, `00172` mirroring `00117`): any org member except `client_viewer` (blocked by the RESTRICTIVE overlay mirroring `00162`) — i.e. `inspector`/`supplier` too — can `PUT` a blob under their org's prefix even though the `qc_entry_photos` **table** write correctly refuses them, leaving an orphaned object no UI ever references. Same posture as every other bucket (`snag-photos`, `diary-attachments`, `reports`); documented with the QC PR, deliberately not fixed there.
- **Multi-org users.** `getOrgContext()` resolves the *oldest* membership, not a user-selected current org. Role checks for users in multiple orgs may apply against the wrong org. Out of scope until multi-org UX exists.
- **Cells marked `?`.** `/settings/organisation` and `/settings/integrations` for `project_manager` — behaviour not yet verified end-to-end.
