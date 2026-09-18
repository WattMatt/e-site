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
| `/projects/[id]/forms` (site forms list) | W | W | W | W | W | W | R¹⁰ |
| `/projects/[id]/forms/new` | W | W | W | W | W | W | — |
| `/projects/[id]/forms/[formId]` (capture / view) | W¹¹ | W¹¹ | W¹¹ | W¹¹ | W¹¹ | W¹¹ | R¹⁰ |
| `/projects/[id]/cables` | W | W | W | R⁷ | — | — | R¹ |
| `/projects/[id]/medium-voltage` (MV protection studies; per-user paid subscription on top of role) | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
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
| `/metrics` | R | R | — | — | — | — | — |
| `/projects/[id]/jbcc/unlock` | R⁴ | R⁴ | R⁴ | R⁴ | R⁴ | — | — |
| `/projects/[id]/jbcc` (library landing) | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/notice/[code]` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/notice/[code]/new` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/tracking` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/tracking/[letterId]` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `/projects/[id]/jbcc/parties` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |

> `/metrics` (labelled "Adoption" in the sidebar) renders
> `public.platform_metrics_weekly` and is gated twice:
> `requireRolePage(OWNER_ADMIN)` on the page, and a RESTRICTIVE SELECT policy on
> the three metrics tables. `platform_metrics_weekly` uses the zero-argument
> `public.user_is_org_admin()` because it holds platform-wide aggregates with no
> per-org row; `product_events` and `metric_cohorts` use the one-argument
> `public.user_is_org_admin(organisation_id)`, because they do. The page reads
> through the caller's own session — never the service client — so the database
> gate is exercised on every render. There is no `/team/metrics`; `/team` is
> never created.

¹ Cost-redacted export (2026-07-31): contractor / inspector / supplier / client_viewer download every format with all cost data stripped ([`export-role.ts`](../apps/web/src/lib/cable-schedule/export-role.ts) `redactPayloadCost`); redaction derives from `COST_VIEW_ROLES`. Requires an **effective role on the project** (`public.user_effective_project_role`) — unassigned org members of any role are blocked.
² All inspections access requires `public.has_feature(org_id, 'inspections') = true` — the paywall layer comes before the role check. WM-Consulting bypasses.
³ Marketplace is Phase 2-gated by `NEXT_PUBLIC_PHASE_2_MARKETPLACE=true`.
⁴ `/jbcc/unlock` is visible to all authenticated org members (read-only paywall page). The `<UnlockJbccButton />` inside only renders for owner/admin; all other roles see "ask your owner/admin" text. No redirect for locked org — this IS the locked-state destination.
⁵ All JBCC routes under `/(gated)/` require `public.has_feature(org_id, 'jbcc') = true` **and** an effective project JBCC role — `jbcc/layout.tsx` runs `requireEffectiveRole(projectId, JBCC_WRITE_ROLES)` (owner/admin/project_manager/**contractor**) alongside the `requireFeature` paywall redirect. WM-Consulting bypasses the feature check. As of **migration 00170** the `jbcc_*` RLS reads AND writes are project-scoped to `JBCC_WRITE_ROLES` via `public.user_effective_project_role(...)`, so `inspector`, `supplier`, and `client_viewer` no longer see or download any contractual notices (previously they had org-wide read). Server actions in `jbcc.actions.ts` (`previewLetterAction`, `downloadExampleAction`, `generateLetterAction`, `letterLifecycleAction`, party + attachment actions) all enforce the same guard + a target-belongs-to-project IDOR check; `jbcc-parties.actions.ts` was brought onto the same gate (previously missing the feature check). Issued letters are content-frozen by DB trigger and every transition is written to the append-only `projects.jbcc_letter_events` audit trail.
⁶ `/equipment-schedule` and `/materials` were merged into `/equipment-materials` and now unconditionally `redirect()` there for every role (thin shims, no role gate of their own) — access is governed by the `/equipment-materials` row. Equipment management (add/edit/decommission boards) is inline on the unified tab and is gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) by the existing `equipment.actions` guards. `client_viewer` views the register (view-only) via the portal tab `/portal/[projectId]/equipment-materials` (see Client portal section).

⁷ **Corrected 2026-07 (SANS audit):** this cell previously read `W`, but every cable-schedule write path — server actions (`ROLES_ENGINEER = ORG_WRITE_ROLES`, i.e. owner/admin/project_manager only) and the import API routes — excludes `contractor`. The page renders read-only for contractors (no page-level role gate beyond the `(admin)` layout); their writes are refused server-side. A contractor promoted per-project via `projects.project_members` (role `project_manager`) gains `W` on that project through the effective-role gates.

⁹ **Quality Control (added 2026-07-14).** `client_viewer` never reaches these `(admin)` routes (`(admin)/layout.tsx` bounces clients to `/portal`); their actual surface is `/portal/[projectId]/quality-control` (see Client portal), and migration `00172`'s `qc_reports` SELECT policy additionally hides every non-`issued` report (drafts AND closed) from client viewers at the DB — a leaked link to a draft 404s. Pages compute `canWrite` via `requireEffectiveRole(..., QC_WRITE_ROLES)` (owner/admin/project_manager/**contractor**) and hide mutating affordances for `inspector`, who renders read-only; every mutation re-gates in its server action (see the Quality control actions section — issue/close/delete-report narrow to `ORG_WRITE_ROLES`).

¹⁰ **Site forms (added 2026-08-12).** `client_viewer` never reaches these `(admin)` routes — `(admin)/layout.tsx` bounces clients to `/portal`. The `field.site_forms` SELECT policy additionally restricts client viewers to `status = 'distributed'` at the DB, so a leaked link to a draft or a voided record returns nothing. There is no portal surface for site forms yet; client viewers receive the distributed record by email as a branded PDF.

> ⚠ The PDF route needs its own check and has one. `GET /api/projects/[id]/forms/[formId]/report` lives under `app/api/*`, **not** under `(admin)/layout.tsx`, so the portal bounce does not protect it — and the gatherer reads with the service client, so RLS does not either. An adversarial review confirmed this was exploitable: the distribution email hands every client viewer the `projectId` and `formId`, so after a PM **voids** a record the app would hide it everywhere while this route kept serving the complete PDF indefinitely, regenerated live. `gatherSiteFormReportData` now refuses when `role === 'client_viewer'` and `status <> 'distributed'`, using the same not-found wording as a missing form so the endpoint cannot be used to confirm a form id exists. `qc-report-data.ts` and `snag-visit-report-data.ts` share this shape and are **not yet audited** for the same gap.

¹¹ **Capture is a field action, distribution is not.** Creating, filling and submitting a form is gated to `FORMS_FIELD_ROLES` (every role except `client_viewer`) because site electricians are normally `contractor`. **Distributing, re-distributing and voiding are gated to `ORG_WRITE_ROLES`** (owner/admin/project_manager) — a completed form emails every project member, which is deliberately not a field-level decision. The `W` above therefore means "may capture and submit"; see the site-forms actions section for the distribution split.

> **Three DB-level layers back the action gate**, all verified by probing production roles in rolled-back transactions rather than by reading the SQL:
> 1. RLS restricts writes to `status = 'draft'` (`field.user_can_write_form`), so responses, photos and signatures freeze on submit.
> 2. The `site_forms_update` `WITH CHECK` refuses to let a non-manager leave a row in `distributed` or `void`, **and** binds `organisation_id` to the project's own org. That binding is load-bearing: the client-viewer test was originally `NOT user_is_client_viewer(organisation_id)`, which returns false for an org you are not a member of, so one `PATCH` moving a draft into a foreign org made it visible, editable and submittable by *that* org's client viewers — and made the issued PDF render their branding.
> 3. A `BEFORE UPDATE` transition trigger enforces the state machine and freezes the identity/lifecycle columns (`created_by`, `form_no`, `submitted_*`, `distributed_*`, `report_id`). It is deliberately `SECURITY INVOKER`: the first version was `SECURITY DEFINER`, under which `current_user` is the function owner, so its trusted-role exemption was true for every caller and the trigger enforced nothing.
>
> Client-viewer detection at the DB uses `public.user_effective_project_role`, **not** `public.user_is_client_viewer` — the latter reads only `public.user_organisations`, so a client viewer holding access through `projects.project_members` was invisible to the database while the app layer treated them as one. Every function in `00179` is `REVOKE`d from `PUBLIC` before being granted: Postgres grants `EXECUTE` to `PUBLIC` by default and the `field` schema has no function default ACL, so a bare `GRANT` adds without restricting — which briefly left `allocate_form_no` callable by `anon` over PostgREST.

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
| `GET /api/paystack/callback` | W | W | — | — | — | — | — |¹¹
| `POST /api/paystack/subaccount` | W¹² | W¹² | — | — | — | — | — |¹²
| `POST /api/paystack/feature-seat` | W | W | — | — | — | — | — |¹³
| `POST /api/paystack/mv-subscribe` | W | W | W | W | W | W | W |¹⁴
| `POST /api/webhooks/resend` | n/a — public webhook, Svix/standardwebhooks HMAC-SHA256 over the raw body; writes only as service_role; bypassed in `middleware.ts` by exact path |
| `POST /api/paystack/webhook` | n/a — public webhook, HMAC-SHA512 over the raw body; was never listed here and was 307'd to `/login` until `SIGNED_WEBHOOK_PATHS` |
| `POST /api/notifications/dispatch` | bearer-token; not session-gated — **not yet audited** |
| `POST /api/paystack/feature-unlock` | W | W | — | — | — | — | — |
| `GET /api/jbcc/sign` | W⁵ | W⁵ | W⁵ | W⁵ | — | — | — |
| `GET /api/projects/[id]/snags/visits/[visitId]/report` | R | R | R | R | R | — | R |
| `GET /api/projects/[id]/forms/[formId]/report` | R | R | R | R | R | R | R¹⁰ |
| `GET /api/projects/[id]/quality-control/[reportId]/report` | R | R | R | R | R | — | R⁹ |
| `GET /api/projects/[id]/equipment-materials/report-preview` | R | R | R | — | — | — | — |
| `POST /api/projects/[id]/equipment-materials/reports` | W | W | W | — | — | — | — |
| `POST /api/medium-voltage/study` | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
| `POST /api/tenant-schedule/parse` | W | W | W | —⁷ | — | — | — |
| `POST /api/tenant-schedule/commit` | W | W | W | —⁷ | — | — | — |
| `GET /api/tenant-schedule/legend-card/pdf` | R | R | R | R | R | — | R⁸ |
| `POST /api/cable-schedule/parse` | W | W | W | —⁷ | — | — | — |
| `POST /api/cable-schedule/commit` | W | W | W | —⁷ | — | — | — |
| `GET /api/cable-schedule/export/excel` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/pdf` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/csv` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/zip` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/multi-zip` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/tag-list/pdf` | R | R | R | R¹ | R¹ | R¹ | R¹ |
| `GET /api/cable-schedule/export/tag-labels/pdf` | R | R | R | R¹ | R¹ | R¹ | R¹ |

> **A second phantom row was found and removed 2026-09-10: `POST /api/inspections/delete-photo`.** The route was real when this matrix was written (`e6b19c5`) but was **deleted** by PR #126 (`3b0f050` / `9765b54`) along with `upload-photo` and `upload-file`, when inspection capture moved to direct-to-storage under the user's own session. The row outlived it by months and described a gate that no longer exists. Photo delete is now a client-side `delete()` on `inspections.photos` on the **user client**, authorised entirely by the `photos_delete` RLS policy (`00066`) — **uploader-or-project-manager, and only while the inspection is still editable** — with the storage object removed best-effort afterwards; a `0`-row delete is reported to the user as "not permitted" rather than as success (`useFieldPhotos.ts:200-235`). There is no app-layer role gate to document because there is no longer a route: **RLS is the gate.** Nothing about the effective permissions changed with this deletion; only the description was wrong.
>
> **Everything in this table sits behind the session middleware first.** `apps/web/src/middleware.ts` `307`s a request with no session to `/login` before the handler runs, so the `401`s described in the footnotes are the handler's own fail-closed backstop — an expired session, or the path being added to an exemption list later — not what an anonymous caller normally sees. Verified on production 2026-09-10: unauthenticated `POST` to `/api/paystack/subaccount`, `/feature-seat` and `/mv-subscribe`, and `GET /api/paystack/callback`, all returned `307 → /login`. The two deliberately exempt payment paths are `/api/paystack/webhook` (`SIGNED_WEBHOOK_PATHS`; an unsigned `POST` returns `401` from the handler — confirmed live) and `/api/unsubscribe` (`PUBLIC_API_PATHS`).

> `POST /api/tenant-schedule/parse` (preview, no writes) and `POST /api/tenant-schedule/commit` (full-sync import; **writes run with the service-role key, bypassing RLS**) are both gated via `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` — the same gate the `/projects/[id]/tenant-schedule` page applies before rendering the ImportFlow control. ⁶ A contractor promoted per-project via `projects.project_members` (role `project_manager`) passes the effective-role gate on that project.
>
> ⁸ `GET /api/tenant-schedule/legend-card/pdf` (added with the DB legend cards feature) is read-only and has **no explicit role gate** — it runs on the cookie client under RLS, and the `structure.nodes` RLS-gated read (`kind='tenant_db'`) IS the access check: any role that can see the node (any active project member, `client_viewer` included) gets the PDF, an invisible or non-tenant node 404s. No service-role writes occur on this route.

> `POST /api/cable-schedule/parse` (preview, no writes) and `POST /api/cable-schedule/commit` (imports a whole revision: sources / structure.nodes / supplies / cables / change_log; **writes run on the user client so RLS applies; since migration `00193` the cable_schedule write policies enforce the same owner/admin/project_manager set — see the RLS note below**) are both gated via `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` — added 2026-07 (SANS audit); previously only project *visibility* was checked, the same gap PR #135 closed for the tenant-schedule routes. ⁷ as above: a per-project `project_manager` promotion passes.
>
> All 7 `GET /api/cable-schedule/export/*` routes gate via `getExportPolicy` ([`export-role.ts`](../apps/web/src/lib/cable-schedule/export-role.ts)), which resolves the caller's **effective project role** via `public.user_effective_project_role` (the same RPC as `requireEffectiveRole`): owner/admin/project_manager export fully; contractor/inspector/supplier/client_viewer export **all formats with cost data redacted** (¹) — each requires an active effective role on the project (org membership alone is not enough); no effective role → 403. Per-project promotion to `project_manager` grants full export. Policy widened 2026-07-31 (previously contractor/inspector/supplier were blocked outright). Size caps return 413 (`MAX_CABLES_PER_EXPORT` 500, PDF/ZIP 300).

> `GET /api/projects/[id]/quality-control/[reportId]/report` (inline QC PDF preview, no persistence — snag-visit report pattern) returns 401 unauthenticated, then gates inside `gatherQcReportData`: the cookie-client **RLS read of the `qc_reports` row is the visibility gate** — a report invisible to the caller (wrong org, or ⁹ a non-`issued` report for a `client_viewer`, per 00172) 404s — plus `requireEffectiveRole` over all 7 project roles (403 for non-members). Photo bytes are fetched with the service client only after both gates pass.
>
> **Equipment & Materials report.** `GET …/equipment-materials/report-preview` (render + stream, no persistence) and `POST …/equipment-materials/reports` (render + save a new version to `projects.reports`) both gate on `requireEffectiveRole(projectId, ORG_WRITE_ROLES)` inside `gatherEquipmentMaterialsReportData`, which throws `ReportAccessError` → 403. This is deliberately stricter than the tenant-schedule report's view-level gate: that report is a snapshot of what any project member can already see, whereas this one prints **order notes and quote/order-instruction status**, which the portal tab `/portal/[projectId]/equipment-materials` deliberately withholds as commercial artefacts. Preview streams byte-identical content to the saved artifact, so both routes carry the same gate — gating only the save would be theatre. Report content is a fixed full snapshot of all **active** boards; the tab's status filter and show-decommissioned toggle do not affect it.
>
> **Saved-report reads are now gated by kind.** `projects.reports.reports_select` (00117) gates only on `public.user_has_project_access()`, which is TRUE for any `project_members` row **regardless of role** (00106 clause (a)), and `listProjectReportsAction` / `getProjectReportUrlAction` are directly-invocable server actions — so before **migration 00183** any project member, `client_viewer` included, could list and download a saved report of any kind. Sensitive kinds are now declared in [`report-kind-access.ts`](../apps/web/src/lib/reports/report-kind-access.ts) (`equipment_materials`, `valuation` → `ORG_WRITE_ROLES`); every other kind stays open to project members and is listed explicitly there. Both actions consult the map, and 00183 adds a **RESTRICTIVE** SELECT policy calling `public.user_can_read_report_kind()` so direct PostgREST is closed too. A contract test fails the build if any `kind` written to `projects.reports` declares no read policy.

> **¹¹ `GET /api/paystack/callback` is NOT a webhook.** This row read `n/a — public webhook, signature-validated` until 2026-09-10; every word of that was wrong. It is a **GET**, it is the browser navigation Paystack sends the payer back on (`callback_url` in `/api/paystack/checkout`), it sits inside the session-cookie surface, and it **validates no signature at all** — it re-verifies the reference against `transaction/verify`, which authenticates the *charge*, never the *caller*. `org_id` and `tier` come out of the transaction's metadata and the writes run on the **service client** (RLS bypassed), so until the gate below it authorised nobody: any member of an org at any role — contractor, `client_viewer`, or any stranger holding a reference — could GET it and rewrite that org's subscription tier. Proven on production: the rbac-test contractor read all three `paystack_reference` values straight out of `billing.invoices`, whose SELECT policy was role-blind (see below), and WM's own `fdgyux6ite` would have downgraded a 13-project org to `starter` (5-project cap), blocking project creation org-wide for the owner too, with **no audit row** because `recordInvoice` no-ops on a duplicate reference. Now gated with `requireRole(userClient, metadata.org_id, OWNER_ADMIN)` — the primitive against the *metadata's* org, not the caller's primary org — and refusals **redirect** to `/settings/billing?error=forbidden` rather than returning a JSON 403, because the caller is a browser arriving from Paystack's hosted checkout. A second guard covers the case the role gate does not: the route now looks `billing.invoices` up by `paystack_reference` first and, if the charge is already recorded, redirects to `?success=1` **without touching `billing.subscriptions`** — `recordInvoice` is idempotent, `upsertSubscription` is not, so an owner replaying their own paid reference could otherwise flip a `cancelled`/`past_due` subscription back to `active` with no new charge. That same guard makes the benign webhook-won-the-race case a no-op. The callback's writes are deliberately **kept**, not retired in favour of the webhook: the webhook was 307'd to `/login` from the day it shipped, so this route has written every billing row in production to date.
>
> **⚠ DO NOT add `/api/paystack/callback` to any middleware exemption list.** `apps/web/src/middleware.ts` has six — `PUBLIC_PATHS`, `PUBLIC_EXACT_PATHS`, `PUBLIC_CONTENT_PREFIXES`, `SELF_AUTH_PATHS`, `SIGNED_WEBHOOK_PATHS`, `PUBLIC_API_PATHS` — and this route belongs in none of them. This warning is here because the false "public webhook, signature-validated" description above is exactly the kind of claim that invites someone to "fix" a redirect by exempting the path, and those lists are where they would do it (`SIGNED_WEBHOOK_PATHS` first, since the description named a signature). The route **needs** the session: its authorisation is `requireRole(userClient, metadata.org_id, OWNER_ADMIN)`, which reads the caller's identity from the Supabase auth **cookie**. Exempt it from the middleware and every request arrives anonymous. Today that fails closed (`requireRole` returns `Not authenticated` → redirect to `?error=forbidden`), so the immediate damage is that paying customers stop being activated — but the same edit read together with the old description ("it's signature-validated, the role gate is redundant") is one step from deleting the gate, and what sits behind it is an unauthenticated `GET` that writes `billing.subscriptions` and `billing.invoices` with the **service client** from attacker-supplied `reference`. There is no signature to fall back on. Paystack's *server-to-server* events go to `/api/paystack/webhook`, which is signature-verified and correctly exempted; this route is the *browser* coming back from hosted checkout, and browsers carry cookies. It is currently in none of them — verified in production: `GET https://www.e-site.live/api/paystack/callback?reference=x` → `307 → /login?...&next=%2Fapi%2Fpaystack%2Fcallback` (2026-09-10).
>
> **¹² `POST /api/paystack/subaccount` — owner/admin of the SUPPLIER's organisation, rate-limited, insert-only.** Fixed 2026-09-11 (payments pre-go-live audit, finding #7). Until then every column in this row was `W` and that was not a typo: the route checked a session, that the caller had **some** active `user_organisations` row (`.limit(1).single()` with no `.order()`, so an **arbitrary** org for a multi-org user), and that the `supplierId` belonged to that org. No role was ever consulted, so a `contractor`, `inspector`, `supplier` or `client_viewer` sharing an org with the supplier could set **where that supplier's marketplace payouts land** — and the upsert was `onConflict: 'supplier_id'`, i.e. it replaced any existing binding. Now: `401` unauthenticated; `429` past `rateLimit('subaccount:<user id>', 5, 60_000)`; `400` on a malformed body; the supplier is resolved **by id alone on the service client**; `409` when `supplier.organisation_id IS NULL` (all 7 production suppliers are in that state today) — ⚠ **never** `?? undefined` into `requireRoleAPI`, which falls back to the *caller's* primary org and would let any org admin bank an org-less supplier; then `requireRole(supabase, supplier.organisation_id, OWNER_ADMIN)` → `403`. Only after all of that is a Paystack subaccount minted. An existing binding is **never replaced**: a second attempt returns `409` with the existing `subaccount_code`, and changing bank details is a deliberate support action. The row is written with the **service client** — migration `00191` REVOKEs INSERT/UPDATE/DELETE on `marketplace.paystack_subaccounts` from `authenticated` entirely, so no user session can write payout bindings over PostgREST under any policy. A failed write logs `PAYSTACK_SUBACCOUNT_ORPHAN` **and returns the `subaccount_code` in the 500 body**, because the previous code lost a live bank-bound subaccount to a `console.error`. The 94 % split (E-Site keeps 6 %) is still hardcoded in the route; the `percentage_charge` column disagreement is tracked separately.
>
> **¹³ `POST /api/paystack/feature-seat` — owner/admin, rate-limited.** `503` if `PAYSTACK_SECRET_KEY` is unset; `401` unauthenticated; `429` past `rateLimit('feature-seat:<user id>', 5, 60_000)` (5 per 60 s per user, in-process). The gate is a `user_organisations` lookup filtered `.in('role', ['owner', 'admin'])` (oldest such membership by `created_at`) → `403` for every other role, matching the paywall CTA. The **target** user must be an active member of that same org (`400`) and must not already hold the seat (`409`, `alreadyUnlocked: true`). The route only initialises the hosted-page charge — the seat row in `billing.org_feature_seats` is written by `/api/paystack/webhook` on `metadata.type === 'feature_seat'`.
>
> **¹⁴ `POST /api/paystack/mv-subscribe` — ANY authenticated user, per-USER, service-role write.** The only identity check is `supabase.auth.getUser()` (`401` without a session). There is **no org-membership check and no role check** — org membership is not even required, because the subscription being bought is per-user (`billing.user_mv_subscriptions`), not per-org: the R2 000/yr MV protection seat belongs to the individual. Rate-limited 5 per 60 s per user (`429`). Step 1 records disclaimer acceptance and a `pending` row **with the service client** — deliberate and documented in the route: that table has SELECT-own RLS and no write policy, so the user cannot write their own row. Returns **`503` until `PAYSTACK_PLAN_MV_ANNUAL` is set** to a `PLN_…` code — there is no one-off fallback, unlike the org checkout, so an unset plan makes the feature unbuyable rather than degrading to a one-off charge. Note the handler ordering: both `503` branches are evaluated **before** the session check, so an unauthenticated probe cannot distinguish an unset plan from a missing session. Whether the var is set in Vercel Production was not verified here. ⚠ As of `8dbe166` the step-1 upsert writes `status: 'pending'` unconditionally, contradicting the comment directly above it ("never downgrade an active one") — so re-pressing Subscribe on an active seat rewrites it to `pending`. Behavioural bug, not an access-control one; tracked in the 2026-09 payments audit.
>
> **Billing reads (migration `00187`).** `billing.invoices`' SELECT policy was named `"Org admins can view invoices"` and qualified on `organisation_id = ANY (get_user_org_ids())`, which is bare `is_active` membership — no role predicate. `billing` is PostgREST-exposed and `authenticated` holds table SELECT, so all 27 WM members (12 contractors, 3 `client_viewer`s, most of them staff at other firms) could `GET /rest/v1/invoices` with `Accept-Profile: billing` and read every amount paid and every Paystack reference — the reads that turned the callback replay into a one-click attack. `00187` replaces it with an owner/admin qual plus a **RESTRICTIVE** gate on `public.user_is_org_admin()` so a future permissive policy cannot reopen it, and revokes `anon`'s pointless grant. Verified on prod in a rolled-back transaction: org admin 3 rows, contractor/`client_viewer`/non-member 0, `anon` `permission denied`. **`billing.subscriptions` is deliberately left at org-member read** and merely renamed to `subscriptions_select_org_member` so the name stops lying: `PaymentStatusBanner` and `checkProjectQuota` read `status`/`tier` from it on the **user client at every role**, so an admin-only qual would delete the "account paused" warning for the 12 contractors and impose a false 1-project cap. See the Known gaps entry.

> **²⁰ Medium-Voltage — TWO conditions, and role is the weaker one.** Every MV surface requires (a) `ORG_WRITE_ROLES` (owner/admin/project_manager) **and** (b) the per-USER R2 000/yr entitlement, `public.user_has_mv_access(auth.uid())`. `POST /api/medium-voltage/study` runs the heavy Z-bus + earth-fault solve and caches per-node `fault_results`; it is gated with `requireRoleAPI(ORG_WRITE_ROLES, orgId)` against the *revision's* org, refused on non-DRAFT revisions, and then returns **`402`** without a subscription. Discrimination/coordination compute is deferred to Phase 4b.
>
> Until 2026-09-11 condition (b) existed **only in five `page.tsx` files** (finding #20 of the payments audit): `grep -r 'requireMvAccess\|hasMvAccess' apps/web/src/actions apps/web/src/app/api` returned nothing, so the compute route and all the MV server actions were role-gated and nothing more. Route handlers and server actions are directly invocable and sit outside `(admin)/layout.tsx`; this repo has shipped that exact class twice before (PR #135, PR #162).
>
> **The read side needed the database, because no page gate can reach it.** `cable_schedule` is PostgREST-exposed, `authenticated` holds SELECT on `fault_results` and `discrimination_checks`, and their cross-org SELECT policy qualifies on `user_has_project_access()` — true for any `project_members` row at **any** role. Migration `00191` adds a RESTRICTIVE `FOR ALL` policy on both tables calling `user_has_mv_access`. Demonstrated on production in a rolled-back transaction: a DEMO-org **`client_viewer`** added to the WM project read all **131** rows of the paid solve before the policy and **0** after, while a WM member still read 131.
>
> ⚠ `public.user_has_mv_access` opens with an unconditional **WM-Consulting bypass** — every active member of `dddddddd-0000-0000-0000-000000000001` passes with no subscription and no accepted disclaimer. That is why production shows 0 MV subscriptions alongside 131 cached results, and why a "works for me" report from a WM account proves nothing about the paywall. `lib/mv-access.ts` used to claim "no owner bypass"; corrected.

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

### Billing (`billing.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `cancelSubscriptionAction` | W | W | — | — | — | — | — |

> **This is the only cancellation surface — there is no `POST /api/paystack/cancel-subscription`.** A row for that endpoint stood in the API table above from the day this file was created (`fcbb9f3`, 2026-05-25) until 2026-09-10; no such route has ever existed anywhere in the repo's history. It is deleted rather than corrected. Cancellation is the server action, surfaced as `CancelSubscriptionButton` on `/settings/billing`, rendered whenever the subscription is not already `cancelled`.
>
> The gate resolves the caller's org through **`getOrgContext()`** — the identical resolver `/settings/billing` uses via `requireRolePage(OWNER_ADMIN)` — and requires `OWNER_ADMIN`; every other role gets `{ ok: false, error: 'Only an owner or admin can cancel the subscription.' }`. It then disables the subscription at Paystack via `paystack_subscription_code` (a one-off charge has none — nothing to disable) and writes `status='cancelled'` + `cancelled_at` with the **service client**, so the app gate is load-bearing. Idempotent with the `subscription.disable` webhook, which applies the same flip. Refuses when there is no paid subscription or it is already cancelled; a Paystack failure returns an error **without** the local write, so the app never shows cancelled while the customer is still being billed.
>
> ⚠ **Fixed 2026-09-11 (payments audit, finding #29b).** The membership lookup was `.eq('is_active', true).limit(1).single()` with **no `.order()`**, so for an owner/admin of more than one org *which* organisation got cancelled was whichever row Postgres returned — and because `disableSubscription` runs at Paystack **before** the local write, the wrong org's recurring billing was genuinely stopped. Adding `.order('created_at')` was rejected as the fix: it deterministically targets the OLDEST org and still ignores the OrgSwitcher's `profiles.active_organisation_id`. The regression test uses a two-org owner whose active org is the NEWER one — a single-org fixture cannot express this property, because every resolution strategy agrees when there is only one membership.

### Project membership (`project-members.actions.ts`, `project-members-bulk.actions.ts`, `project-members-from-sub-org.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `addProjectMemberAction` | W | W | W | — | — | — | — |
| `updateProjectMemberRoleAction` | W | W | W | — | — | — | — |
| `removeProjectMemberAction` | W | W | W | — | — | — | — |
| `bulkAddOrInviteProjectMembers` | W | W | W | — | — | — | — |
| `addProjectMembersFromSubOrgAction` | W | W | W | — | — | — | — |

> All gate on `requireRole(supabase, project.organisation_id, ORG_WRITE_ROLES)` — the **org** role, not the effective project role, so a per-project `project_manager` promotion does **not** confer the right to administer membership.
>
> **Migration `00177` is the uniform DB backstop** for both RBAC membership tables, closing a privilege-escalation gap found in the 2026-07-31 cable-export review. `projects.project_members` (00027) authorised writes on `organisation_id = ANY(get_user_org_ids())` and `public.user_organisations` (00026) on `user_id = auth.uid()` — membership tests, not authorisation tests, with no predicate on the caller's role or on the role being written, and `00161` fenced only `client_viewer`. Reproduced on prod as the `rbac-test` contractor (inside a rolled-back transaction): self-INSERT of a `project_manager` row, self-promotion of an existing row, **DELETE of 29 colleagues' project memberships**, INSERT of an `owner` membership into a *foreign* org, and self-promotion to org `owner` — after which `user_effective_project_role` returned `owner` for every project in the org, which is what `requireEffectiveRole` trusts everywhere (full-cost cable exports included). Six RESTRICTIVE policies now enforce: `project_members` writes require owner/admin/project_manager **of the org that owns the project** (`public.user_can_manage_project_members(project_id)` — keyed on the project, not the row's `organisation_id`, so the sub-org identity convention from `00160` stays expressible); `user_organisations` writes require owner/admin **of the target org** (`public.user_is_org_admin(organisation_id)`, matching `OWNER_ADMIN`). Both helpers are SECURITY DEFINER with `row_security=off`, which is what lets a policy *on* `user_organisations` call a helper that *reads* `user_organisations` without the RLS recursion `00026` documents. SELECT is deliberately untouched on both tables. Service-role writes (every invite/signup path: `users.actions.ts`, `onboarding.actions.ts`, `project-members-bulk.actions.ts`, `sub-org-members.actions.ts`) bypass RLS and are unaffected — verified, not assumed.

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
| `completeSnagVisitAction` (issues report + stamps completion + notifies roster) | W | W | W | — | — | — | — |
| `reopenSnagVisitAction` (clears completion stamps) | W | W | W | — | — | — | — |

> **Widened 2026-06-04:** raising/closing a snag *on a visit* (`addSnagToVisitAction`, `closeSnagOnVisitAction`) is gated to `SNAG_FIELD_ROLES` = every role **except** read-only `client_viewer` — site agents (contractor/inspector/supplier) can both raise and close snags during a visit. Creating/editing the visit and exporting the report stay `ORG_WRITE_ROLES` (owner/admin/PM).

> **Visit completion (2026-08-06, migration 00178):** `completeSnagVisitAction` delegates to `exportSnagVisitReportAction` for the PDF (so versioning/supersede/storage behave identically to a manual export), then stamps `completed_at`/`completed_by`/`report_id` on `field.snag_visits` and fires ONE roster notification — bell `snag_visit_completed` + `notify_snag_email`-gated summary email with counts, top defects and 7-day signed-URL before/after thumbnails, deep-linking to the visit page (not a signed file URL). A stamp failure returns an error rather than announcing a completion the DB doesn't record. While a visit is open, `addSnagToVisitAction` suppresses the *individual* snag email (the bell still fires) so a 40-snag walk sends one message, not forty; snags added to an already-completed visit email immediately as before.

> **Snag photo capture:** photos are written client-side under `field.snag_photos` RLS ("Org members can upload snag photos" — INSERT gated on **org membership**, with the `00161`/`00162` RESTRICTIVE overlay blocking `client_viewer`). The web uploader (`SnagPhotoUploader` on `/snags/[id]`) and the mobile snag-detail capture are rendered behind `SNAG_FIELD_ROLES`, matching the visit actions. Note the table's INSERT policy keys on org membership, **not** project access, so a cross-org user promoted via `project_members` can view but not upload snag photos — a pre-existing narrowness inherited from `field.snags`, unchanged here.

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

### Cloud-storage sync (`cloud-storage.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `syncProjectCloudFolderAction` ("Sync now") | W | W | W | W | W | W | W* |
| `autoSyncCloudFolderAction` (tab-open freshness check) | W | W | W | W | W | W | W* |
| `setProjectCloudFolderAction` / `clearProjectCloudFolderAction` | W | W | W | — | — | — | — |
| `updateFloorPlanToLatestAction` / `updateAllFloorPlansToLatestAction` (adopt revisions) | W | W | W | W | W | W | — |

> **Added 2026-07-23 (sync freshness rework).** Both sync triggers call the
> `cloud-sync-project` edge function with the **service-role key**, so the
> app-side gate is the only caller check: `requireVisibleProject` requires a
> signed-in user for whom RLS returns the project row (any project-visible
> member — `W*` = a `client_viewer` who can see the project can trigger a
> pull, which only imports from the admin-mapped folder; no caller content is
> involved, and fresh data is the point of the feature for read-only roles).
> Previously `syncProjectCloudFolderAction` checked only `auth.getUser()` —
> the same class of gap PR #135 closed (any signed-in user could sync an
> arbitrary project id). Folder mapping stays RLS-gated to
> owner/admin/project_manager via `projects.projects` UPDATE policies (00009).
> Adopt actions ride `tenants.floor_plans` RLS (client_viewer excluded by
> 00161). The engine auto-adopts changed drawings with **zero annotations**
> (no RFI annotations / QC markup lineage / snag pins / calibration);
> annotated drawings keep the explicit Update / Update-all step.

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
| `upsertMvStudySettings` | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
| `upsertFaultSource` | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
| `upsertProtectionDevice` | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
| `upsertMvStudySignoff` | W²⁰ | W²⁰ | W²⁰ | — | — | — | — |
| `overrideFaultLevel` (free — LV short-circuit input) | W | W | W | — | — | — | — |

> All resolve revision → project → org and gate to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireEffectiveRole`, on top of the cable_schedule RLS — org membership (`get_user_org_ids` + `user_is_client_viewer`) **plus, since `00193`, a RESTRICTIVE owner/admin/project_manager write gate** on `revisions` and `change_log`, which `overrideFaultLevel` writes. ⚠ `00193`'s gate reads the **org** role while `requireEffectiveRole` honours a project-scoped promotion, so a user who held `project_members.role='project_manager'` with a narrower org role would pass the action and be refused 42501 by the database. Production holds zero such users (measured 2026-09-11); the direction is fail-closed. Each **refuses writes on a non-DRAFT revision** (ISSUED / SUPERSEDED are frozen — start a new revision). `issueMvStudy` (the gated DRAFT→ISSUED transition) is Phase 6.
>
> **Since 2026-09-11 the four paid actions also require the MV subscription** (`{ error: 'Medium-Voltage subscription required' }`) — see footnote ²⁰. ⚠ **`overrideFaultLevel` is deliberately excluded.** It shares `resolveWritableRevision` with the other four but is called from `FaultLevelEditor` in the **free** cable-schedule workspace on every DRAFT revision, and it is the only writer of `revisions.fault_level_ka`, the source value the LV schedule's `shortCircuitCheck` consumes. Putting the entitlement check inside the shared helper — the obvious one-line implementation — would silently break short-circuit checking for every LV cable-schedule user, with no error anywhere. A test drives it with MV access OFF and asserts the write still lands. It records provenance in `change_log`.

### Marketplace orders (`supplier.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `updateOrderStatusAction` (status/notes) | W | W | W | W | W | W | — |
| `updateOrderStatusAction` (`quotedAmount`) | supplier org only — enforced in the DB | | | | | | |

> ⚠ **The buyer used to set the price they were charged.** Production grants gave `authenticated` a TABLE-level UPDATE on `marketplace.orders`, so
> `has_column_privilege` was true for `total_amount`, `commission_rate`, `commission_amount`, `payment_status`, `paid_at`, `paystack_reference` and
> `paystack_split_code`; the only UPDATE policy is PERMISSIVE with `USING (contractor_org_id = ANY get_user_org_ids() OR supplier_org_id = ANY …)`,
> `with_check` NULL, and `get_user_org_ids()` is role-blind. `marketplace-payment` charges `order.total_amount`. Reproduced on production in a
> rolled-back transaction as the **rbac-test contractor**: an R18 750 order rewritten to `total_amount = 0.01` with `payment_status = 'paid'`.
> `updateOrderStatusAction` was the shorter path to the same thing — gated on `if (!user)` alone and writing `total_amount = extras.quotedAmount`
> through the RLS client.
>
> Closed by migration `00191` in two layers that fail **independently**, both verified on production:
> 1. **Grant layer** — `REVOKE UPDATE ON TABLE … FROM authenticated` then `GRANT UPDATE (status, notes)`. The direct PATCH now returns
>    `42501 permission denied for table orders`. ⚠ The table-level REVOKE must come first: a column-level REVOKE cannot subtract from a table-level
>    grant (proven on this database for `billing.subscriptions`).
> 2. **Policy layer** — `orders_money_columns_immutable`, RESTRICTIVE FOR UPDATE TO authenticated, whose WITH CHECK pins 15 money and identity
>    columns to their stored values via `marketplace.order_protected_columns_unchanged(to_jsonb(orders))`. With the table grant handed back in full,
>    the same attack returns `new row violates row-level security policy "orders_money_columns_immutable"`.
>
> The one legitimate money write from a session — the supplier's quote — goes through `marketplace.set_order_quote(uuid, numeric)`, SECURITY DEFINER,
> which asserts the caller is in the order's `supplier_org_id`, is not a `client_viewer`, and that `payment_status` is still `'pending'`. Verified on
> production: the buyer gets `42501 Only the supplier organisation may quote on this order`, a supplier-org member's quote applies, and a quote on a
> paid order is refused. `anon` holds no EXECUTE on either new function (checked with `has_function_privilege`, never `proacl` — a NULL `proacl`
> looks empty but **is** the PUBLIC grant).
>
> ⚠ Do **not** "fix" pricing by deriving the charge from `marketplace.order_items` instead. `total_amount` is deliberately not the item sum — it is
> the supplier's quote (production order …0002: total 18 750.00 vs `sum(line_total)` 18 525.00) — and `order_items` is not authoritative either:
> `authenticated` holds INSERT on it under a policy that lets the buyer choose `unit_price`, and `line_total` is GENERATED from it.

### Inspection reports (`inspection-report.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `regenerateInspectionReportAction` | W | W | W | — | — | — | — |

> Manual re-issue of an inspection's branded report (certify auto-runs the same worker). Gated to `ORG_WRITE_ROLES` (owner/admin/project_manager) via `requireEffectiveRole`, requires `public.has_feature(org_id, 'inspections')`, with a **cross-project guard** (the inspection's `project_id` must match the route project before any write). Renders via the Node renderer → saves versioned to `projects.reports` (kind=`inspection`) → auto-files the cert into handover `compliance_certs` and the inspection's own uploads into `test_certificates`, each tagged `origin_kind='inspection'` for clean re-issue dedup.
>
> **Report page read** (`/projects/[id]/inspections/[inspectionId]/report`) — the PDF artifact source moved from `inspections.certificates` to the latest **issued** `projects.reports` row (read by project role via the `reports_select` RLS). Share-link + Revoke are deferred in v1 (the legacy `generateShareLinkAction` / `revokeCertificateAction` remain but are no longer surfaced).

### Site forms (`site-forms.actions.ts`, `site-forms-distribute.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `listFormTemplatesAction` | R | R | R | R | R | R | R |
| `listProjectFormsAction` | R | R | R | R | R | R | R¹⁰ |
| `listCableScheduleBoardsAction` | R | R | R | R | R | R | — |
| `createSiteFormAction` | W | W | W | W | W | W | — |
| `upsertFormResponseAction` | W | W | W | W | W | W | — |
| `submitSiteFormAction` | W | W | W | W | W | W | — |
| `voidSiteFormAction` | W | W | W | — | — | — | — |
| `previewFormRecipientsAction` | W | W | W | — | — | — | — |
| `distributeSiteFormAction` | W | W | W | — | — | — | — |

> **The role split is the point.** Capture (`create`/`upsert`/`submit`) is gated to `FORMS_FIELD_ROLES` — every role except `client_viewer` — because the person standing at the board is normally a `contractor`. Distribution and voiding are gated to `ORG_WRITE_ROLES`, because distributing emails **every** project member and withdrawing a record that has already gone out is not a field-level decision. A test asserts `contractor` is refused on both distribution actions; that is the regression most likely to be introduced later.
>
> **Three independent layers guard the write window.** (1) The action gate above. (2) RLS: `field.user_can_write_form` permits writes only while `status = 'draft'`, so responses, photos and signatures freeze on submit. (3) A `BEFORE UPDATE` transition trigger (migration `00179`) enforces the state machine in the database — without it any project member could `PATCH status='distributed'` straight over PostgREST and skip the action gate entirely, the same class of hole `00177` closed for `project_members` self-promotion. The trigger exempts `postgres`/`service_role`, since the action layer is what gates those.
>
> **Submission is gated on legal constraints, not just completeness.** `submitSiteFormAction` runs `evaluateSubmitGates` and returns the whole issue list rather than submitting partially: no energising without an insulation-resistance reading (SANS 10142-1 8.6.8, with the NOTE 2 exception), no out-of-calibration instrument, no incomplete prove-test-prove sequence, EIR reg 9(3) duties mandatory on any C1 defect, and registration-scope checks. The client shows the same issues live via the shared `buildGateInput`/`evaluateSubmitGates` pair, but the server re-checks independently.
>
> **Distribution never silently emails.** `previewFormRecipientsAction` returns the resolved recipient list and the per-project `notify_form_email` state so the reviewer sees exactly who will receive it, and how many, before sending. `project_notification_recipients()` resolves 12 real wmeng.co.za people for any WM-Consulting project, so a mistaken send goes company-wide. Re-distribution is permitted and issues a **new report version** through the `projects.reports` supersede chain; a distributed form is never reopened — it is voided with a reason and reissued, mirroring the spirit of EIR reg 9(5).

### Work items (`work-items.actions.ts`)

Cells describe the `task` type — the only client-insertable type in Q1 (migration `00196`). Each action resolves the write set from the registry (`projects.work_item_types.write_roles`, mirrored in `WORK_ITEM_TYPES`) by the row's `item_type`, so for a mirrored type the four write-role columns follow that type's set: `contractor` is in the write set for `rfi`, `snag`, `qc_defect`, `diary_action`, `form_action` and `task`, and NOT for `inspection` or `order_followup` (those are `ORG_WRITE_ROLES`).

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createWorkItemTaskAction` | W | W | W | W | — | — | — |
| `reassignWorkItemAction` | W | W | W | W (assignee, while triage/open) | — | — | — |
| `advanceWorkItemStatusAction` | W | W | W | W | own ball | own ball | — |
| `setWorkItemDueDateAction` | W | W | W | — | — | — | — |
| `voidWorkItemAction` | W | W | W | W | own ball | own ball | — |

> **"own ball" means the caller is the row's current `ball_in_court_id`.** The status moves inside `advanceWorkItemStatusAction` are further governed by the database, and the action does not pre-empt it: it forwards the write and returns the guard's sentence **verbatim** (`return { error: error.message }` — every RAISE in `00196` §12 is a sentence naming the item's ref, and those strings are the user-facing copy).
>
> **The close and reopen authority, as finally decided (`00196` §12).** **Only the gatekeeper closes** — `status = 'closed'` is accepted only when `auth.uid() = NEW.gatekeeper_id`. **Gatekeeper governance is owner/admin/project_manager**: only they may change who signs an item off, or change the assignee while it is `answered`. A governing actor who is not the gatekeeper takes the seat first — through the actions that is `reassignWorkItemAction` on an `answered` item (it writes `gatekeeper_id` in that state), then close; over PostgREST it is one statement (`gatekeeper_id = auth.uid(), status = 'closed'`, recorded as `gatekeeper_changed` then `closed`). There is **no "take over" verb** in Q1, and on an `open` item there is no action path for a non-gatekeeper to close — the assignee moves it to `answered` first. **Reopen** (`closed → open`, also through `advanceWorkItemStatusAction`) needs a write role **or the closing gatekeeper**; the action admits exactly those (a closed row has no ball-in-court, so the holder arm never applies).
>
> **A `contractor` holding the type write role may reassign the ASSIGNEE in triage/open and may not touch the gatekeeper seat** — `reassignWorkItemAction` on an `answered` item writes `gatekeeper_id`, and for a contractor the guard refuses that with the governance sentence, except to hand on a review they themselves hold (an `answered` item whose gatekeeper they are). They may also move the status, void, and reopen (all on the write set).
>
> **A holder WITHOUT a write role has three affordances, and reassign is not one of them.** They may (1) move their own item forward (`open → answered`; `advanceWorkItemStatusAction` admits the holder), (2) void it with a reason (`voidWorkItemAction` admits the holder — the guard's `v_may_manage`), and (3) edit a manual item's title/priority — a direct-PostgREST affordance the permissive UPDATE policy admits; no Q1 action exposes it. They **cannot reassign** — and the order in which the database says so matters: Postgres evaluates an UPDATE's RLS WITH CHECK **after** the BEFORE ROW triggers, so the transition guard runs first and **admits** a bare holder's hand-off (`v_is_holder`), and then `work_items_update_gate`'s WITH CHECK refuses the new row with `42501` because the actor is no longer assignee or gatekeeper on it. Same conclusion, guard first. `reassignWorkItemAction` therefore gates on the write set only — deliberately not §03 §1.4's "or the current holder"; admitting them would only swap the role sentence for a raw "new row violates row-level security policy" — and the Inbox must not offer reassign to a non-write-role holder.
>
> **A plain member who is neither holder nor write-role holder gets a silent zero-row update from RLS** (the RESTRICTIVE gate's USING filters the row; PostgREST raises nothing) — **the UI must not rely on an error for that case.** The actions refuse such a caller before the database (`requireEffectiveRole` on the **project**, not the primary org, then the holder arm), and every UPDATE is **conditioned on the pre-read status** (`.eq('status', <as read>)`, so a decision made for an `open` row — which person column to write, whether the holder arm applies — never lands on a row that flipped to `answered` in between) **and asserts rows affected** (`.select('id').maybeSingle()` → `null` is an error, never `ok`). The one caller who reaches the database with a row the gate will refuse is a **`client_viewer` assignee** — legal from Q1, they pass the holder arm — and the action reports "Nothing was changed", never success. A same-status `advanceWorkItemStatusAction` is a no-op that never reaches the database.
>
> **Where the actions are deliberately NARROWER than the database.** `setWorkItemDueDateAction` is `ORG_WRITE_ROLES` only; §12 (a4) would also accept the type's write set or the gatekeeper — a deadline is a management decision (§13 item 2). The guard also lets a governing actor **correct** `assignee_id` or `gatekeeper_id` in any live state (not only the column the current status selects); Q1 exposes no UI for that, and `reassignWorkItemAction` writes only the column the status selects.
>
> **The create verb inserts `origin = 'manual'` and `status = 'open'` as server-side literals** (§03 §1.6: an item created WITH an explicit assignee is born open; the column default stays `'triage'` for item 3's unnamed-assignee path), `gatekeeper_id = created_by = auth.uid()` (A(b): task's gatekeeper is the creator), and **never forwards** `ref`, `ball_in_court_id`, `opened_at`, `created_at`, `closed_at`, `closed_by`, `void_reason` or any source FK from the payload — the payload is built field by field, never spread. It does not pre-validate the assignee: the membership trigger is the last word and its sentence is returned as-is. Only a `created` event follows; the `assigned` verb fires exclusively from item 3's triage path.
>
> **Three DB layers back the action gate, and the action gate is not the load-bearing one.** (1) `requireEffectiveRole` on the **project**, not the primary org. (2) A PERMISSIVE INSERT/UPDATE policy plus a **RESTRICTIVE** gate calling `projects.user_can_write_work_item(project_id, item_type)`, which resolves the type's `write_roles` out of `projects.work_item_types` — so widening a type's write set is one `UPDATE` in one place, never a policy rewrite. The INSERT gate additionally pins `item_type = 'task'`, `origin = 'manual'`, `status IN ('triage','open')`, a `TASK-n` ref, no source FK and no closed/void stamp. (3) A `BEFORE UPDATE` transition guard (`00196` §12) that RLS cannot express, because RLS cannot compare `OLD` and `NEW`.
>
> **`task` is the only client-insertable type.** Every mirrored type — `rfi`, `snag`, `qc_defect`, `inspection`, `diary_action`, `form_action` — is created **only** by its source row's projection trigger (item 3); a direct insert naming one of those keys is refused by the RESTRICTIVE policy. `order_followup` becomes insertable when the explicit chase control on the order line ships, with an arm requiring `node_order_id` and nothing else.
>
> **`client_viewer` may be an ASSIGNEE from Q1 but may not write, and may not browse.** In a shopping-centre fit-out the landlord is frequently the ball-in-court, so an item must be able to point at them. Their writes are blocked by `work_items_update_gate` and by the fact that no registered type admits `client_viewer` in `write_roles` — **`00161_client_viewer_readonly_write_block.sql` does NOT cover `work_items`**, it loops over a hard-coded list of thirteen tables (`00161:61-75`), so this is one layer, not two. Their **reads** are narrowed too: `work_items_select` excludes `client_viewer` from the project-access arm, because `public.user_has_project_access()` is TRUE for any `project_members` row regardless of role (`00106` clause (a)) — the identical predicate PR #162 closed on saved reports. They see only items they are assigned, gatekeep or watch, which is what §04 §(d) describes. The Q3 Watcher tier replaces the write block.
>
> **`work_item_events` has no write policy at all**, and `INSERT`/`UPDATE`/`DELETE` are revoked from `authenticated`. It is written solely by a `SECURITY DEFINER` append trigger, so the assignment and status history cannot be forged by the person it incriminates.
>
> **Three of the five verbs are narrowed by ITEM TYPE, because the source module owns the column** (migration `00202`; measured, not assumed). `reassignWorkItemAction` refuses `item_type = 'inspection'` in **both** its arms — the `assignee_id` write while triage/open and the `gatekeeper_id` write while `answered` — with *"Inspections are assigned from the Inspections module — change the inspector or verifier there."* The mirror forward-reads `inspections.assigned_to_id` and `verifier_id` on **every** projection, so a spine-side reassignment or gatekeeper correction is reverted by the next source write — including the inspector merely pressing start (`assigned → in_progress`). A spine-side **due date** on an inspection is transient for the same reason while `scheduled_at` is in the future (the UPDATE arm re-derives it); `setWorkItemDueDateAction` is *not* gated on the type, because a past/same-day reschedule keeps the spine's date and the control is still useful — the transience is documented, not refused. Priority on a `qc_defect` is module-owned while `severity` is set: the refusal sentence is *"A QC defect's priority follows its severity in the QC report — change the severity there."* Q1 ships **no priority verb** in `work-items.actions.ts` (item 2 shipped five: create, reassign, advance, due date, void), so that refusal is exported as `refuseModuleOwnedEdit('qc_defect', 'priority')` for the Inbox control item 5/6 builds — one string, so the copy cannot be re-invented.
>
> **A mirrored item follows its source across a project move and keeps its `ref` — and a second such move can be refused** (`00202`, measured). The `ref` allocator is max-based per `(project, item_type)` under an advisory lock (`00196:777-789`) and `ref` is immutable, so moving item A (`RFI-3`) from project P into C succeeds, and then moving item B (also `RFI-3`, from Q) into C raises `23505 work_items_ref_unique` **on the source statement** — fail-closed, zero residue, the source row stays where it was. Reachable only over direct PostgREST: no app path moves an RFI, snag, form, QC entry or diary entry between projects, and every source's WITH CHECK binds the **org**, not the project. Recorded as a known limit for Q1.

### Work-item source mirrors (database triggers, no route)

Migration `00202_work_item_source_mirrors_and_backfill.sql` introduces **no route and no endpoint**, so there is no route row. It does change **effective write authority**, which is the thing this file exists to record: a work-item reassign or re-date now writes `projects.rfis.assigned_to`, `projects.rfis.due_date` and `field.snags.assigned_to` through a `SECURITY DEFINER … SET row_security TO 'off'` function, so those tables' own RLS is bypassed on that path.

| Path | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| Reassign a mirrored `rfi` item ⇒ writes `projects.rfis.assigned_to` | W | W | W | W¹ | — | — | — |
| Re-date a mirrored `rfi` item ⇒ writes `projects.rfis.due_date` | W | W | W | —² | — | — | — |
| Reassign a mirrored `snag` item ⇒ writes `field.snags.assigned_to` | W | W | W | W¹ | W¹ | W¹ | — |
| Reassign / re-gatekeep a mirrored `inspection` item | —³ | —³ | —³ | — | — | — | — |
| Re-file a mirrored `qc_defect` item's priority | —³ | —³ | —³ | —³ | — | — | — |
| Raise a snag / site form / delay diary entry ⇒ creates a work item | W | W | W | W⁴ | W⁴ | W⁴ | — |
| Raise an RFI or a QC defect ⇒ creates a work item | W | W | W | W⁴ | —⁴ | —⁴ | — |
| Schedule an inspection ⇒ creates a work item | W | W | W | —⁴ | W⁴ | —⁴ | — |
| Close an RFI-mirrored item | gatekeeper only ⁶ | gatekeeper only ⁶ | gatekeeper only ⁶ | **W ⁶** | — | — | — |
| Delete any of the six sources ⇒ voids its mirrored item (live **or closed**) | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | W⁵ | — |

> ¹ **Not a gate in this migration.** Who may change `work_items.assignee_id` or
> `due_date` is item 2's `projects.user_can_write_work_item(project_id, item_type)`,
> enforced by a RESTRICTIVE UPDATE policy; these rows record only where that
> authority *lands*. The cells therefore follow the **type's** write set:
> `rfi` is `MARKUP_WRITE_ROLES` (contractor included) and `snag` is
> `SNAG_FIELD_ROLES` (everyone but `client_viewer`), which is why a contractor
> reassigning an RFI item writes `projects.rfis.assigned_to` and an inspector
> reassigning a snag item writes `field.snags.assigned_to`.
> **The write-back function is `SECURITY DEFINER … SET row_security TO 'off'`,
> so it bypasses the RLS on `projects.rfis` and `field.snags`.** That is
> deliberate: the mirror resolves an assignee the raiser could not have written
> themselves (the triage owner, the project PM), and the two source columns must
> agree with the spine or every existing reader and PDF shows something
> different from the Inbox. The authority check happens **once**, on the
> `work_items` UPDATE. The write-back **skips `closed` and `void` records**, so a
> historical row never acquires an assignee nobody set. Its **snag** arm
> additionally skips `triage` items: on a snag `assigned_to` means "assigned to
> fix", and writing the raiser there on the creation request would make
> `notifySnagCreatedAction`'s email render the raiser as the assignee.
>
> ² `setWorkItemDueDateAction` is `ORG_WRITE_ROLES` only — deliberately narrower
> than §12 (a4), which would also accept the type's write set or the gatekeeper.
> A deadline is a management decision (§13 item 2). ⚠ **The spine owns an RFI's
> due date and writes it source-ward, never the reverse**: an RFI raised with a
> past or same-day `due_date` has that column rewritten to the spine's computed,
> shutdown-pushed date **on the same request**, and a later source-side re-date
> is a silent no-op for the spine. Item 4 must point the RFI page's due-date
> control at the spine or the page and the Inbox diverge after the first source
> re-date.
>
> ³ **Refused by the action with a sentence, because the edit would be
> transient.** See "Three of the five verbs are narrowed by ITEM TYPE" above:
> inspection people are module-owned (`00066`'s assignment flow and the
> certification chain own `assigned_to_id` / `verifier_id`; the mirror forward-reads
> both on every projection), and a `qc_defect`'s priority follows its entry's
> `severity` while that is non-NULL. Neither is a *security* boundary — over
> direct PostgREST a write-role holder can still make the edit, and the next
> watched source write will revert it. The durable alternative (option (c): the
> wrapper passes a "the source's people column actually changed" flag, and the
> projection forward-reads only then) is recorded for a later quarter.
>
> ⁴ **Each source's own write gate decides**, not the spine's, which is why the
> three rows above differ: `rfi` `MARKUP_WRITE_ROLES` and `qc_defect`
> `QC_WRITE_ROLES` (+ `00176`'s tenancy-bound policies and
> `qc_report_children_frozen`) both EXCLUDE inspector and supplier; `inspection`
> is `ORG_WRITE_ROLES`, which excludes contractor and supplier; `snag`
> `SNAG_FIELD_ROLES` and `form_action` `FORMS_FIELD_ROLES` admit the site roles;
> `diary_action`'s INSERT gate is `00145:25-36` (the UPDATE policy at
> `00145:39-50` is the separate, wider one recorded under Known gaps). The table
> below lists each one — read it rather than these cells when the answer
> matters.
>
> ⁵ **Deleting a source voids its mirrored item, and a CLOSED item is voided
> too — that is forced, not chosen.** `work_items_source_required` admits a
> source-less mirror item only while `status = 'void'`, so leaving a closed item
> closed with its FK nulled fails the CHECK on the RI `SET NULL` and the DELETE
> aborts with `23514`. C′'s exempt path then clears `closed_at` / `closed_by` on
> the `closed → void` transition (inherited from `00196:1545-1546`), so the close
> stamps do **not** survive the delete — only the `closed` and `voided` events
> carry that history. Kept as built so "stamps ⇔ closed" stays a simple invariant
> no future consumer can misread; the two alternatives (preserve the stamps in
> C′'s exempt path, or admit `closed` in `work_items_source_required`) are owner
> decisions recorded in the PR body. The cells are NOT `ORG_WRITE_ROLES`: the
> widest **person-satisfiable** DELETE policy across the six sources is
> `projects.site_diary_entries`', which is AUTHOR-scoped rather than role-scoped
> (`00149:30-36` — `created_by = auth.uid()` AND an active org membership AND
> not a client viewer). So ANY non-client-viewer role, contractor and inspector
> and supplier included, can delete a diary entry it authored and thereby void
> that entry's mirrored item, live or closed. Every other source is owner /
> admin / PM or service-role-only — see the DELETE table below, which is the
> per-source detail this row summarises.
>
> ⁶ **Close an RFI-mirrored item — the gatekeeper only; under
> `gatekeeper_rule = 'creator'` that is the RAISER, so a contractor closes the
> RFI item they raised.** A contractor who merely holds the ball on someone
> else's RFI cannot — clause (d) refuses with `P0001 Only the person who signs
> RFI-1 off can close it. Take it over first, or ask them to close it.`
> `00202:834` runs `UPDATE projects.work_item_types SET gatekeeper_rule =
> 'creator' WHERE key = 'rfi'`, and `project_rfi` calls
> `resolve_work_item_gatekeeper(r.project_id, r.raised_by)` in **both** arms
> (`00202:975` on insert, `00202:1070` on update); measured
> `gatekeeper_is_the_contractor = true`. **An INELIGIBLE raiser — departed, a
> client viewer, or an org-level contractor with no `project_members` row —
> falls back to the project PM** (`00202:968-974`). Any sentence anywhere in this file
> or in the specs saying only owner/admin/PM closes an RFI-mirrored item is
> wrong.

**Each source's own write gate, beside the spine's.** The spine's governance clauses are now exactly as strong as the write authority of the table they mirror: a source write reaches the projection at `pg_trigger_depth() = 2`, where the transition guard's authority and state-machine clauses are skipped.

| Source | Write gate on the SOURCE table | Note |
|---|---|---|
| `projects.rfis` | `00027:48-50` — **org-membership-wide UPDATE, no `WITH CHECK`, no role predicate, no column list** | ⚠ Over direct PostgREST any org member can set `status`, `closed_by` or `project_id` on any RFI in the org, and the mirror follows at depth 2. **Pre-existing on `rfis`**, not introduced here; spun off as a task chip ("Gate `projects.rfis` writes by role and column"). |
| `field.snags` | `00161` client-viewer RESTRICTIVE block + the module's own policies | `apps/mobile/src/hooks/useSnags.ts:72` deletes snags under the **user's** client and `field.snags` carries no permissive DELETE policy — the mutation reports success on **0 rows**. Pre-existing; a matrix note, not item 3's bug. |
| `inspections.inspections` | `inspections.user_can_write_responses` / `user_can_verify` (`00066`) | People columns are module-owned; the spine reads them and never writes back. |
| `projects.qc_entries` | `00176:53-68` write policies (`QC_WRITE_ROLES` + tenancy binding) + `qc_report_children_frozen` (closed reports only, signed-in actors only) | |
| `projects.qc_reports.status` | `qc_reports_status_guard` (`00172:249-263`) — **role-only (owner/admin/PM), with no direction check** | ⚠ `issued → draft` and `closed → draft` are therefore legal at the database over PostgREST, though no app action writes them. The projection **leaves a withdrawn report's items live**, and a re-issue projects only the fails added during the draft cycle. Whether the guard should also refuse draft-ward transitions (it reads as if it did) is a pre-existing owner question on `qc_reports`, same family as the `rfis` chip. |
| `projects.site_diary_entries` | `00145:39-50` — **org-wide UPDATE, no `WITH CHECK`, no column list** (any non-client-viewer org member could already rewrite every column of any entry) | ⚠ The mirror does not widen that hole **in kind**, but it extends its **blast radius onto the spine**: the same statement can now void, move or re-title a live work item through the depth-2 exempt path. Owner chip spawned (`WITH CHECK` binding org/project; UPDATE narrowed to author-or-`ORG_WRITE_ROLES`). No app path UPDATEs a diary entry at all. |
| `field.site_forms` | `field.user_can_write_form` (draft only) + `enforce_site_form_transition` (`00179:347/415`, BEFORE, SECURITY INVOKER) | The transition trigger runs first and refuses an illegal move with its own `42501` sentence; the mirror is AFTER and never fires on a refused statement. |

**DELETE paths per source** (which of them a *person* can walk, and whether it can void a **closed** spine item):

| Source | Permissive DELETE policy a person can satisfy | App path | Can a person void a CLOSED item this way? |
|---|---|---|---|
| `projects.rfis` | none (`00161` client-viewer RESTRICTIVE only) | no web/mobile delete action | no — service role only |
| `field.snags` | none | `apps/mobile/src/hooks/useSnags.ts:72` → **silent 0 rows** | no — service role only |
| `inspections.inspections` | none | `deleteInspectionAction` (`inspections.actions.ts:664`): org owner only, refuses `certified`, deletes with the service key | no (a certified = closed item is refused before the delete); the `voided` event's actor is **NULL** on that path |
| `projects.qc_reports` → cascades `qc_entries` | `qc_reports_delete` (`00176:121-127`, owner/admin/PM by effective project role) | `deleteQcReportAction` (`qc.actions.ts:149`) | **yes** over PostgREST — the cascade voids each entry's item, closed ones included |
| `projects.qc_entries` | `qc_entries_delete` (`00176:182-192`; frozen on a CLOSED report) | `deleteQcEntryAction` (`qc.actions.ts:467`) | **yes — measured**: a PM deleting a PASSED entry on an issued report → item `void` / `'source deleted'`, one `voided` event with `actor_id` = the PM, `actor_role = 'project_manager'`, `from_status = 'closed'` |
| `projects.site_diary_entries` | `Authors can delete their diary entries` (`00149:30-36`) | `deleteDiaryEntryAction` (`diary.actions.ts:109`) — service client, so the `voided` event's actor is **NULL** | **yes** over PostgREST |
| `field.site_forms` | `site_forms_delete` (`00179:483-485`, **drafts only**, owner/admin/PM) | `voidSiteFormAction` voids rather than deletes | no — only drafts are person-deletable, and a draft is never closed |

> **`structure.node_orders` has no projection trigger and no row here.**
> `order_followup` is created only by the explicit chase control on an order line
> (Appendix A(b)) — which no Q1 deliverable builds, so that type produces nothing
> this quarter. A contract test fails the build if any trigger in the mirror
> migration names that table: **453 live procurement rows** projected into inboxes
> is the backfill poisoning the roadmap names as a risk.
>
> **`inspections.inspections.assigned_to_id` is read but never written back.**
> `00066`'s own assignment flow stays the system of record for that column; the
> spine follows it forward so the Inbox does not name a previous assignee forever.
>
> **`client_viewer` is excluded from every step of the MIRROR's resolver**
> (`projects.resolve_mirror_assignee`) until their write set lands in Q3
> (§03 §1.9). An item that landed on one could never be cleared: `00161` blocks
> their writes and `work_items_bic_present` keeps the row pointing at them.
> ⚠ **Deliberate divergence:** item 2's people-picker resolver
> `resolve_work_item_assignee` (`00196:911-913`) still **admits** a client
> viewer — in a fit-out the landlord is often the ball-in-court — so a PM can
> assign one by hand through the Inbox; the mirror never resolves to one on
> its own. Both are decisions; delete the mirror's clause in Q3 with the write set.
> ⚠ **Improvement 7 is destructive on the source once the write-back lands:** a
> client viewer named on `rfis.assigned_to` **at creation** is replaced by the
> chain's answer and that answer is written back to the source; one set by a
> **later** source edit stays on the source while the spine holds the chain's
> answer. Zero live instances today (0 of 15 RFIs and 0 of 6 snags are assigned
> to anyone — module age, not rarity).
>
> **The transition guard's exemption is depth-scoped, not identity-scoped.**
> `projects.work_items_transition_guard()` (replaced by this migration) skips
> authority and the state machine when `auth.uid() IS NULL OR
> pg_trigger_depth() > 1`: a mirror, write-back or delete-to-void UPDATE runs
> at depth 2 and was authorised on the source row; a client statement is depth
> 1 and still meets every clause. `source_status` is now immutable for clients.
> Proved under impersonation (probe 05b): a contractor's direct title edit on a
> mirrored item is refused while their RFI respond is projected.
>
> **`rfi`'s registry `gatekeeper_rule` is `'creator'`** (owner decision, this
> PR): the mirror sets `created_by = raised_by` and **the raiser gatekeeps**.
> ⚠ **So a contractor who raises an RFI IS its gatekeeper and CAN close it**
> (footnote ⁶; an **ineligible** raiser falls back to the project PM,
> `00202:968-974`) — any sentence elsewhere saying only owner/admin/PM closes an
> RFI-mirrored item is wrong. 12 of the 15 live RFIs were raised by contractors, and this is the
> only Q1 mechanism that puts a work item into a contractor's ball-in-court.
> Measured on the SELECT policy's four arms for a contractor on their own
> mirrored item: `project_access = true`, `assignee = false`, `gatekeeper = true`,
> `watcher = true`. Changing the **gatekeeper seat** still needs governance
> (owner/admin/PM) — that is item 2's clause and unchanged.
>
> **A closed `qc_defect` reopens when its entry crosses back INTO `fail`** — a
> projection-level crossing rule, not a map change (`map_source_status` keeps
> `fail → NULL`). The map change was measured and rejected: it pulled every
> `answered` defect of a report back to `open` on any unrelated entry edit and on
> a report rename. A reopened defect is re-filed at the severity it was
> **re-failed** with. On the issue path the `created` events carry a **NULL
> actor** — `issueQcReportAction` flips the report with the service client — and
> the items are born at issue (`opened_at = GREATEST(entry.created_at,
> report.issued_at)`), not pre-aged through the draft cycle.

## Public / unauthenticated

| Route | Access |
|---|---|
| `/login`, `/signup`, `/forgot-password` | Public |
| `/inspection/[token]` | Public; signed COC share link (expires) |
| `/(portal)/compliance` | Public; client view of approved COCs |
| `/`, `/pricing`, `/legal/*` | Public marketing/legal content; signed-in users are NOT bounced |
| `/unsubscribe` | Public; bearer is the v4 auth UUID in `?user=`. Marketing opt-out |
| `/privacy/request` | Public; POPIA §23/§24 data-subject-request intake |
| `/cookies` | Public; cookie notice |
| `POST /api/unsubscribe` | Public; RFC 8058 one-click target. No session, no cookies |

> **The four gates a public page must clear, not one (2026-09).** `/unsubscribe`, `/privacy/request` and `/cookies` were in no list in `middleware.ts`, so every anonymous visitor was 307'd to `/login` — and `safe-next.ts` did not allow them either, so logging in landed on `/dashboard` instead. Production probe before the fix: `GET https://www.e-site.live/unsubscribe?user=<uuid>` → `307 → /login?...&next=%2Funsubscribe`. Consequence: 246 lifecycle emails to 36 recipients across 15 domains (8 external client and contractor firms) and **0 of 36 profiles opted out** — POPIA §69(3)/§11(3) and ECTA §45 require the objection mechanism to be cost-free and unobstructed. Adding a path to `PUBLIC_PATHS` alone clears rule 1 and then **breaks** rule 2, which bounces signed-in users to `/dashboard`; rules 3 (unconfirmed email) and 4b (aal1 MFA) fire regardless of `isPublicPath` and target exactly the dormant cohort the re-engagement sequence mails. All four are now driven off one `PUBLIC_CONTENT_PREFIXES` list, and `middleware.test.ts` enumerates every page under `app/(legal)` and `app/(public)` **from disk** — a new page in either group joins the contract when its file lands, rather than when someone remembers to extend a hardcoded list of five strings.

> **The gate is not the whole defect.** Behind the 307, `optOutMarketingEmailsAction` ran on the **anon cookie client**, and the only UPDATE policy on `public.profiles` is `id = auth.uid()`. For an anonymous caller `auth.uid()` is NULL, the UPDATE matched zero rows, PostgREST raised **no error**, and the page rendered "You're unsubscribed" having written nothing — so fixing only the middleware would have converted a visible failure into an invisible one. The opt-out now uses `createServiceClient()` (the unguessable v4 UUID is the bearer; the blast radius of a guessed UUID is a suppressed marketing email) **and asserts rows affected** — `.select(...)` returning null is `ok:false`. `optBackInMarketingEmailsAction` is deliberately **asymmetric**: it requires a session whose `auth.uid()` matches and writes on the RLS-enforced cookie client, because the userId appears in the URL of every marketing email ever sent, so an unauthenticated service-role re-subscribe would let anyone holding a forwarded email silently reverse someone's opt-out — a fresh §11(3) violation.

> **`POST /api/unsubscribe` (RFC 8058).** Mailbox providers render their own Unsubscribe control when a message carries `List-Unsubscribe` + `List-Unsubscribe-Post`, and honour it by POSTing with **no cookies**. App Router `page.tsx` answers GET only, so the header cannot point at `/unsubscribe` — it would 405. The handler is bypassed in `middleware.ts` via `PUBLIC_API_PATHS` (a 307 is recorded by the provider as a failed one-click, and the control stops being offered), and calls the same writer as the page so there is one place that can regress. It returns **422**, never 200, when nothing was written.

> **`/api/diary/notify` added to `SELF_AUTH_PATHS`.** It verifies a mobile Bearer JWT against Supabase Auth and checks org membership itself — the same shape as `/api/notifications/dispatch` — but was in no list, so every mobile diary notification was 307'd to `/login`. Surfaced by the new contract test, which scans `app/api/**/route.ts` for bearer/signature auth markers and asserts each match is bypassed.

## How to add a new route

1. **Server-side gate.** Use one of these:
   - Server component / page → `requireRolePage(allowedRoles)` from [`@/lib/auth/require-role`](../apps/web/src/lib/auth/require-role.ts). Redirects on failure.
   - API route → `requireRoleAPI(allowedRoles, orgId?)`. Returns `NextResponse` on failure.
   - Server action with an entity-bound org id → `requireRole(supabase, orgId, allowedRoles)` (primitive).
2. **Constants.** Import role groups from `@esite/shared`: `OWNER_ADMIN`, `ORG_WRITE_ROLES`. Don't hardcode `['owner','admin']` arrays — drift surface.
3. **Update this matrix.** Add a row with the verified W/R/— cells for each role — and verify the row against the route file, not against the ticket. Both failure directions have shipped here: `POST /api/paystack/cancel-subscription` sat in the API table for three and a half months describing a route that **has never existed** in the repo's history, while `/api/paystack/subaccount`, `/feature-seat` and `/mv-subscribe` shipped with **no row at all** — and the one route with no role gate is among them, which is not a coincidence: a route nobody wrote down is a route nobody was prompted to check. A matrix row that no longer matches the code is worse than a missing one, because it is *read as authority*: `GET /api/paystack/callback` was described here as `n/a — public webhook, signature-validated` when it is a session-gated `GET` that validates no signature (footnote ¹¹). Two cheap contract tests would close this permanently — one enumerating `apps/web/src/app/api/**/route.ts` and failing on any path with no row here, and the reverse assertion that every `/api/` path named in this file resolves to a real route file. The reverse check would have caught the fictional row the day it was written.
4. **RLS.** Confirm Postgres RLS independently denies cross-org reads/writes. The app-layer gate should not be load-bearing — RLS is the backstop.

## Edge function callers — `send-email`

`send-email` is not a route and has no role matrix, but it is an authorisation
surface and it belongs here: it mails from `noreply@e-site.live`, the
DKIM-signed identity that also carries every invite and password reset.

| Caller | Credential | Types allowed |
| --- | --- | --- |
| `lib/{invite-email,rfi-email,snag-email,notify,diary-email,qc-email,site-form-email}.ts` | service-role key | all |
| `actions/data-request.actions.ts` (public POPIA form) | service-role key (was the SSR anon client until the 2026-09-10 audit) | `data-subject-request` only |
| anyone else, incl. an unauthenticated caller | — | `data-subject-request` only, and it controls no recipient, subject, timestamp or markup |

Rules, each of which was violated in production until 2026-09-10:

1. **A caller is trusted only if it PROVES it holds a service-role credential.**
   Never authorise on a decoded-but-unverified JWT — see
   [`auth-pitfalls-playbook.md` §18](auth-pitfalls-playbook.md). The old
   `getJwtRole` base64-decoded the bearer token, and combined with the
   `--no-verify-jwt` deploy flag a JWT signed with the literal string
   `notasignature` reached the arbitrary-HTML passthroughs.
2. **A public type must let its caller choose nothing that reaches the wire** —
   not the recipient, not the subject, and no unescaped string. Contract tests:
   [`send-email-hardening.test.ts`](../apps/web/src/lib/email/send-email-hardening.test.ts).
3. **`--no-verify-jwt` must not be used on this function.** Tracked in
   [`.github/workflows/deploy-edge-functions.yml`](../.github/workflows/deploy-edge-functions.yml);
   `send-notification` carries the same flag and is not yet audited.

## Known gaps & open audits

These are tracked outside this doc:

- ~~**`POST /api/paystack/subaccount` has no role gate.**~~ **Closed 2026-09-11** — `requireRole(…, OWNER_ADMIN)` against the *supplier's* organisation, plus a rate limit, insert-only semantics, and migration `00191` removing the table's write grants from `authenticated`. See footnote ¹².
- **`PAYSTACK_WEBHOOK_SECRET` is required by no code and exists as a live secret.** Two runbooks listed it as a required environment variable and one instructed pasting it into a Paystack "Signature field" that does not exist. Every occurrence of the name in this repo is markdown — both handlers verify `HMAC-SHA512` of the raw body against **`PAYSTACK_SECRET_KEY`** (`apps/web/src/app/api/paystack/webhook/route.ts:52-70`; the edge `paystack-webhook` reads the same key). The docs were corrected 2026-09-10 ([`launch-checklist.md`](launch-checklist.md), [`staging-deployment-checklist.md`](staging-deployment-checklist.md)); the **secret itself is still set in the Supabase Edge secret store** and should be removed under its own reviewed change — deleting a production secret is not a documentation edit.
- **Multi-org callers resolve to an arbitrary organisation in one remaining billing surface.** `requireRoleAPI`'s default (via `getOrgContext`) is the general primary-org limitation tracked below. The two acute cases are **closed 2026-09-11**: `cancelSubscriptionAction` now resolves through `getOrgContext()` — the same resolver `/settings/billing` uses via `requireRolePage(OWNER_ADMIN)`, so it honours the OrgSwitcher's `profiles.active_organisation_id` and cancels the org the user was looking at (adding `.order('created_at')` was rejected as a fix: it deterministically targets the OLDEST org and still ignores the switcher); and `POST /api/paystack/subaccount` no longer resolves a caller org at all, gating on the supplier's own organisation instead.
- **Supplier portal isolation.** No `(supplier)` route group exists; suppliers reach `(admin)/*` and rely on per-page gates. Audit whether every page either redirects suppliers or semantically tolerates supplier access.
- **`/api/notifications/dispatch` bearer auth.** Confirm the bearer secret is required, rate-limited, and the dispatch payload can't leak cross-org notifications.
- ~~**Cable-schedule RLS.**~~ **Write side closed 2026-09-11 by migration `00193`.** `00051`'s `sup_write` / `cab_write` / `src_write` / `cl_write` / `trm_write` / `tag_write` / `chg_write` / `rev_write_org_members` all qualified on `organisation_id = ANY(get_user_org_ids()) AND NOT user_is_client_viewer(...)` — membership, not authorisation — while every server action gates on `ROLES_ENGINEER` (= `ORG_WRITE_ROLES`). Reproduced on production as the `rbac-test` **contractor** in rolled-back transactions: `measured_length_m` rewritten 63→1062 on the live KINGSWALK DRAFT, cables deleted, all 13 cost lines and all 74 cable tags deleted, 729 `change_log` rows forged then erased, a DRAFT flipped to ISSUED, and a revision deleted — which **cascaded 6 cables and 6 supplies away, because referential-integrity cascades are not subject to row security on the child table** (which is why `00193` also gates `revisions` and `change_log`, not just the six leaf tables). `00193` adds RESTRICTIVE INSERT/UPDATE/DELETE policies keyed on `cable_schedule.user_can_edit_revision` / `_cable` / `_project`, all of which defer to `00192`'s `user_can_edit_schedule`. **SELECT is untouched** on all eight tables. Predicates key on the **parent's** org, not the row's client-supplied `organisation_id` (the `00177` pattern) — `00192` may key on the column only because its BEFORE triggers bind it, and the `00051` tables have no such trigger. Guarded by [`cable-schedule-write-role-rls.contract.test.ts`](../packages/db/src/__tests__/security/cable-schedule-write-role-rls.contract.test.ts), which fails the build for any `cable_schedule` table that accepts writes without a role gate or a declared reason. **Still open:** the read side was never independently verified cross-org, and `sans_overrides` plus the six MV tables (`fault_sources`, `fault_results`, `protection_devices`, `discrimination_checks`, `mv_study_settings`, `mv_study_signoff`) keep the identical `00051` write predicate — the two MV tables with a RESTRICTIVE overlay gate the paid entitlement, not the role. All seven are listed in that test's `DECLARED_GAPS`.
- **Floor-plan *management* writes (upload / calibrate / adopt-latest) are role-agnostic beyond `client_viewer`.** `tenants.floor_plans` write RLS authorises by org membership; `00161` excludes only `client_viewer`. The 2026-07-09 UI hides the upload button, cloud-sync toolbar and the MarkupCanvas *Calibrate* control for read-only roles, but a determined `inspector`/`supplier` could still `INSERT`/`UPDATE` a `floor_plans` row via PostgREST directly. Low severity (trusted internal roles; the external `client_viewer` is DB-blocked; calibration/upload are not commercially sensitive). Deliberately NOT gated at the DB in this pass because a RESTRICTIVE `floor_plans` write policy must not disturb the cloud-sync *adopt-latest* path; tracked as a follow-up. **Markup authoring itself (`rfi_annotations`) IS now uniformly DB-gated to `MARKUP_WRITE_ROLES` across every write path by migration `00171`** — this residual is floor-plan file management only, not markup content. Also: the client-side `commit.ts` annotation INSERT (RFI-create-with-markup) omits the `NOT NULL` `rfi_id` and so silently no-ops even for writers — a pre-existing latent bug, separate from authz, worth a follow-up.
- **QC storage buckets accept unreferenced blobs from non-write roles.** `qc-report-entries` / `qc-reports` use the platform-wide Pattern-A storage RLS (org-id path prefix, `00172` mirroring `00117`): any org member except `client_viewer` (blocked by the RESTRICTIVE overlay mirroring `00162`) — i.e. `inspector`/`supplier` too — can `PUT` a blob under their org's prefix even though the `qc_entry_photos` **table** write correctly refuses them, leaving an orphaned object no UI ever references. Same posture as every other bucket (`snag-photos`, `diary-attachments`, `reports`); documented with the QC PR, deliberately not fixed there.
- **Sub-org project members cannot actually be added (pre-existing, surfaced by the `00177` work).** `addProjectMembersFromSubOrgAction` writes a `project_members` row whose `organisation_id` is the member's **sub-org** while the caller's authority comes from the **parent** org — but `00027`'s permissive INSERT policy still requires `organisation_id = ANY(get_user_org_ids())`, and the parent-org caller is not a member of the sub-org. Verified denied (42501) on prod *before* `00177`, and prod holds **0** rows where `project_members.organisation_id` differs from the project's org, i.e. the flow has never succeeded. `00177` is keyed on `project_id` precisely so it will not become a second blocker once the permissive policy is repaired. Fixing it means widening the `00027` INSERT/UPDATE policy to `public.user_can_manage_project_members(project_id)` — not done here to keep a security backstop from also changing behaviour.
- **Org admins can self-elevate to `owner`.** `00177` gates `user_organisations` writes at `OWNER_ADMIN`, so an admin can still PATCH their own row to `owner`. The app treats owner+admin as one tier (both administer users), so this is a tier-internal move rather than a crossing of a trust boundary; narrowing role *changes* to owners only is a product decision, not a backstop. Note the app's own `updateUserAction` already enforces the stricter rule (owner caller required to touch an owner row, last active owner protected) — the DB does not.
- **Supplier self-registration is dead code.** `registerSupplierAction` creates the org with the **user session**, but the only INSERT policy on `public.organisations` is "Parent admins can insert shadow children" (`is_shadow = true`), so the non-shadow insert is rejected (42501, verified on prod) and the `user_organisations` self-insert one statement later is unreachable. Repairing it means moving **both** writes to the service client, the pattern `onboarding.actions.ts` already documents — deliberately out of `00177`'s scope because it changes who may create an organisation.
- **Mobile invite screen self-upserts a membership row.** `apps/mobile/app/(auth)/invite/[token].tsx` upserts `user_organisations` with a role read from `auth` user metadata (user-writable via `auth.updateUser`), which today can silently overwrite the admin-assigned role — including the literal `'member'` default in that file. Every invite path already creates the membership row server-side with the service client before the email is sent, so the upsert is redundant; `00177` denies it, and the call is already wrapped in `try/catch { /* ignore */ }`. Removing the dead upsert is a tidy-up follow-up.
- **`billing.subscriptions` is readable by every org member, at every role.** `subscriptions_select_org_member` (`00187`, renamed from `00007`'s misnamed `"Org admins can view subscription"`) qualifies on bare org membership, so any of the 27 WM members can read the org's tier, status, `amount_kobo` and `paystack_customer_code` via PostgREST — a client can see what their consulting engineer pays for its software. Left open deliberately, with the two cheap fixes both proven wrong on production first: (a) an admin-only qual breaks `PaymentStatusBanner.tsx:51-56` (the "Account paused — read-only mode" warning vanishes for the 12 contractors it is for) and `checkProjectQuota` (`project.actions.ts:44-56` falls to its `?? 'free'` default and caps the org at 1 project); (b) `REVOKE SELECT (amount_kobo, …) FROM authenticated` is a **complete no-op** — `authenticated` holds a table-level grant (`relacl authenticated=arwd`) and a column-level REVOKE cannot subtract from one; run in a rolled-back prod transaction, `has_column_privilege(…,'amount_kobo','SELECT')` was still `true` afterwards. The form that does bite (`REVOKE SELECT ON TABLE` then `GRANT SELECT (cols)`) then fails the **owner's own** billing page, because `billingService.getSubscription` issues `select('*')` — measured: `ERROR permission denied for table subscriptions`, while `select(tier,status)` succeeds. Closing it properly means narrowing `PaymentStatusBanner` and `checkProjectQuota` to a `SECURITY DEFINER` RPC (or the service client) and pinning `getSubscription` to an explicit column list, *then* adding the role predicate — application work in `packages/shared` and `apps/web/src/actions`, out of scope for the callback fix.
- **`projects.rfis` and `projects.site_diary_entries` accept org-wide, column-blind UPDATEs.** `00027:48-50` and `00145:39-50` each qualify on org membership with **no `WITH CHECK`, no role predicate and no column list**, so over direct PostgREST any non-client-viewer org member can rewrite any column of any RFI or diary entry in the org — including `project_id`. Both are pre-existing and neither is introduced by the work-item mirrors; what the mirrors change is the **blast radius**, because the same statement now reaches the spine through the depth-2 exempt path (void, move or re-title a live work item). Two task chips spawned: gate `projects.rfis` writes by role and column; bind `site_diary_entries` UPDATE with a `WITH CHECK` on org/project and narrow it to author-or-`ORG_WRITE_ROLES`.
- **`qc_reports_status_guard` checks the role but never the direction.** `00172:249-263` admits owner/admin/PM for any `status` change, so `issued → draft` and `closed → draft` are legal at the database over PostgREST even though no app action writes them (`reopenQcReportAction` goes `closed → issued`). The work-item mirror deliberately **leaves a withdrawn report's items live** — void is irreversible on the spine and the partial unique admits one item per entry, so voiding would silently and permanently empty a re-issued report's failures from every inbox. Whether the guard should refuse draft-ward transitions outright is a pre-existing owner question, same family as the `rfis` chip.
- **Seven `projects` functions leak `EXECUTE` to `anon` (pre-existing, owner note).** `ensure_project_code`, the five `jbcc_*` trigger functions, and `suggest_code` were created without the `REVOKE … FROM PUBLIC` the house rule now requires. Five of the seven are **trigger** functions, which PostgREST never exposes as RPCs, so they are unreachable from the anon key. `jbcc_status_can_transition` and `suggest_code` **are** anon-callable, and both are `IMMUTABLE`/pure — they read no row and write nothing. Surfaced by `00202`'s grant audit; not fixed there because revoking on functions this migration does not create is a separate, reviewable change.
- **The `work_items` `ref` allocator is O(n²) per `(project, item_type)` (item 2, owner note).** `00196:752-803` takes a per-`(project, type)` advisory lock and computes `MAX(suffix) + 1` per row. Measured 2026-09-15: 2 500 rows 16.9 s, 5 000 rows 44.6–55.0 s, 10 000 rows exceeds the Management API's `statement_timeout = '2min'`; fit `2.48 ms/row + 1.71e-3 ms/n²` ⇒ ~73 min for 50 000. **No bearing on the `00202` apply** — the backfill is 35 rows (≈0.1 s). It would bite a future bulk import of thousands of items onto ONE project. Uniqueness holds at every size measured; the advisory lock, not the row count, is the mechanism.
- **Multi-org users.** `getOrgContext()` resolves the *oldest* membership, not a user-selected current org. Role checks for users in multiple orgs may apply against the wrong org. Out of scope until multi-org UX exists.
- **Cells marked `?`.** `/settings/organisation` and `/settings/integrations` for `project_manager` — behaviour not yet verified end-to-end.
