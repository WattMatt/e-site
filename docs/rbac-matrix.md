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
| `/settings/organisation` | W | W | ? | — | — | — | — |
| `/settings/integrations` | W | W | ? | — | — | — | — |
| `/projects/[id]/jbcc/unlock` | R⁴ | R⁴ | R⁴ | R⁴ | R⁴ | — | — |
| `/projects/[id]/jbcc` (library landing) | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | — | R⁵ |
| `/projects/[id]/jbcc/notice/[code]` | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | — | R⁵ |
| `/projects/[id]/jbcc/notice/[code]/new` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/tracking` | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | — | R⁵ |
| `/projects/[id]/jbcc/tracking/[letterId]` | W⁵ | W⁵ | W⁵ | W⁵ | R⁵ | — | R⁵ |
| `/projects/[id]/jbcc/parties` | W⁵ | W⁵ | W⁵ | W⁵ | R⁵ | — | R⁵ |

¹ `client_viewer` exports redact cost columns ([`export-role.ts:104`](../apps/web/src/lib/cable-schedule/export-role.ts:104)).
² All inspections access requires `public.has_feature(org_id, 'inspections') = true` — the paywall layer comes before the role check. WM-Consulting bypasses.
³ Marketplace is Phase 2-gated by `NEXT_PUBLIC_PHASE_2_MARKETPLACE=true`.
⁴ `/jbcc/unlock` is visible to all authenticated org members (read-only paywall page). The `<UnlockJbccButton />` inside only renders for owner/admin; all other roles see "ask your owner/admin" text. No redirect for locked org — this IS the locked-state destination.
⁵ All JBCC routes under `/(gated)/` require `public.has_feature(org_id, 'jbcc') = true` — the `jbcc/layout.tsx` gate redirects locked orgs to `/jbcc/unlock` before any role check. WM-Consulting bypasses. For write-gated routes: `inspector`, `supplier`, and `client_viewer` cannot reach `/notice/[code]/new`; status/attachment mutations on tracking and CRUD on parties require `ORG_WRITE_ROLES` (owner/admin/project_manager/contractor) enforced server-side.
⁶ `/equipment-schedule` and `/materials` were merged into `/equipment-materials` and now unconditionally `redirect()` there for every role (thin shims, no role gate of their own) — access is governed by the `/equipment-materials` row. Equipment management (add/edit/decommission boards) is inline on the unified tab and is gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) by the existing `equipment.actions` guards. `client_viewer` views the register (view-only) via the portal tab `/portal/[projectId]/equipment-materials` (see Client portal section).

⁷ **Corrected 2026-07 (SANS audit):** this cell previously read `W`, but every cable-schedule write path — server actions (`ROLES_ENGINEER = ORG_WRITE_ROLES`, i.e. owner/admin/project_manager only) and the import API routes — excludes `contractor`. The page renders read-only for contractors (no page-level role gate beyond the `(admin)` layout); their writes are refused server-side. A contractor promoted per-project via `projects.project_members` (role `project_manager`) gains `W` on that project through the effective-role gates.

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
| `GET /api/jbcc/sign` | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | — | — |
| `GET /api/projects/[id]/snags/visits/[visitId]/report` | R | R | R | R | R | — | R |
| `POST /api/medium-voltage/study` | W | W | W | — | — | — | — |
| `POST /api/tenant-schedule/parse` | W | W | W | —⁷ | — | — | — |
| `POST /api/tenant-schedule/commit` | W | W | W | —⁷ | — | — | — |
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

> `POST /api/cable-schedule/parse` (preview, no writes) and `POST /api/cable-schedule/commit` (imports a whole revision: sources / structure.nodes / supplies / cables / change_log; **writes run on the user client so RLS applies, but RLS's cable_schedule write policies are role-agnostic beyond the client_viewer block**) are both gated via `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` — added 2026-07 (SANS audit); previously only project *visibility* was checked, the same gap PR #135 closed for the tenant-schedule routes. ⁷ as above: a per-project `project_manager` promotion passes.
>
> All 7 `GET /api/cable-schedule/export/*` routes gate via `getExportPolicy` ([`export-role.ts`](../apps/web/src/lib/cable-schedule/export-role.ts)): owner/admin/project_manager export fully; `client_viewer` may export **only when active in `projects.project_members` for the project**, with all cost data redacted (¹); contractor/inspector/supplier are blocked entirely. Size caps return 413 (`MAX_CABLES_PER_EXPORT` 500, PDF/ZIP 300).

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

### Site diary (`diary.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `deleteDiaryEntryAction` (delete) | W | W | W | W† | W† | W† | W† |

> **Delete** (`deleteDiaryEntryAction`) is gated to the entry **author** OR **`ORG_WRITE_ROLES`** (owner / admin / project_manager) — a contractor / inspector / supplier / client_viewer marked † can only delete entries they authored; owner/admin/PM can delete any entry.
>
> **Create** has no server action — entries are created client-side via `diaryService.create()` from `AddDiaryEntryForm`, gated only by RLS to any active org member (unchanged).

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
- **Multi-org users.** `getOrgContext()` resolves the *oldest* membership, not a user-selected current org. Role checks for users in multiple orgs may apply against the wrong org. Out of scope until multi-org UX exists.
- **Cells marked `?`.** `/settings/organisation` and `/settings/integrations` for `project_manager` — behaviour not yet verified end-to-end.
