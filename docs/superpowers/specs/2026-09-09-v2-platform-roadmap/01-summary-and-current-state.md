## Executive summary and current-state review

### Executive summary

E-Site v2 is not a feature release. It is the conversion of a large, correct, well-tested engineering records system into something three different kinds of people open every working day.

What WM has built is substantial: 140 pages, 118 live tables across 12 schemas, 19 edge functions. The electrical ledger at its centre — boards, circuits, cable schedules, SANS-referenced calculations, CoC-grade site forms — is unmatched in the South African market. It is also used almost exclusively by WM's own staff, and collapsing: authentication events fell from 91 across 28 users in July 2026 to **2 across 1 user in August**. Three people signed in during the week to 9 September. None of the thirteen contractor accounts has signed in within 30 days; four never have. The four client viewers last appeared on 8 July.

v2 fixes the cause, not the symptom. Six primitives — assignable work items, a personal Today/Inbox, threads with @mentions, a notification and digest engine, a report engine, a project calendar — are built once and inherited by every module. Capture moves to a phone-first installable web app. Email becomes a full participation channel. Five modules become per-project toggles that default off (Appendix A(e) carries the token set and the default state), and Marketplace leaves the navigation entirely, so a new project opens as a work list, not a filing cabinet.

The programme is costed, and it fits. Committed work across the four quarters is **70.25 engineer-weeks against 74.2 available**, leaving 3.95 weeks of float and a published cut order per quarter. The binding constraint is not the annual total but the Q1 critical path: the chain from the pre-window through the work-item spine, the Inbox, the recap and the first mirrored modules is 11.5 serial engineer-weeks walked by one person, with **0.5 weeks of float on the path — 0.5 gross and 0.5 free — against 1.8 on the total**. Float on the path is lane capacity minus chain length, realisable only by executing that quarter's cut order on the off-path items in the same lane; §13 publishes the definition and the gross and free figure for all four quarters. The whole plan is conditional on a single gate rather than an open question — the contract engineer's funding. Unfunded, the Q1 path has no second walker and the theme does not land; §13 and §15 carry the gate, its date and its consequence.

### What the platform contains today

Repository figures are counted from `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite` on the `feat/site-forms-prefill` branch; production figures are the live-database census of 9 September 2026. Where the two disagree, both are given — that disagreement is itself part of the current state.

| Surface | Count | Note |
| --- | --- | --- |
| Next.js pages (`page.tsx`) | 140 | `(admin)` 103, `(portal)` 12, `(marketplace)` 7, `(auth)` 7, `(public)` 5, `(legal)` 3, `(scan)` 1, **+2 ungrouped** |
| Ungrouped pages | 2 | `account-deleted/page.tsx` and `inspection/[shareToken]/page.tsx` — the latter is the platform's only no-login participation surface (service-role read, explicit token/expiry/revocation check, `inspection/[shareToken]/page.tsx:1-13`) |
| API route handlers | 37 under `apps/web/src/app/api` (39 `route.ts` in total) | all directly invocable, outside `(admin)/layout.tsx`, so page gating does not reach them |
| Server actions | **65 modules exporting 273 server actions**, plus 35 co-located test files (100 files in `apps/web/src/actions`) | the real mutation surface; same direct-invocation exposure as the API routes |
| Database tables | **118 live** across 12 schemas | `projects`, `structure`, `field`, `inspections`, `cable_schedule`, `gcr`, `marketplace`, `suppliers`, `tenants`, `billing`, `compliance`, `public`. The migrations *name* 138 distinct `schema.table` creations; at least three are later dropped (`cable_schedule.boards`, `projects.contractor_companies`, `public.org_invites`). The remaining gap is dropped, renamed or Studio-managed objects — the migration history is not a reliable census. |
| Migrations | **177 files on this branch, max `00182`**; production ledger stands at **`00184`** | `00183` (saved-report read gate) and `00184` (site-forms template v1.1) merged to `main` after this branch cut. Given that `supabase db push` keys on the version prefix and silently skips a number already in `schema_migrations`, branch-versus-ledger drift is a standing hazard, not a footnote. |
| Edge functions | **19** deployable (`apps/edge-functions/supabase/functions` holds 20 directories, one of which is the `_shared` library) | they do **not** auto-deploy on merge — the workflow is manual and does not list `cloud-sync-*`, so any v2 work placed in an edge function inherits a manual deploy step |
| Test files | 275 | vitest plus Playwright under `apps/web/e2e` |
| Sidebar entries | 15 project modules + a Settings drawer; 4 workspace entries; 3 footer entries | `Sidebar.tsx:73-88` (`projectNav`), `:64-69` (`GLOBAL_NAV`), `:92-96` (`FOOTER_ITEMS`) |
| Project settings tabs | 15 | `SettingsTabs.tsx:42-57`; includes Valuations (`:49`) and Variations (`:50`), both gated on `COST_VIEW_ROLES` |
| Notification types | **18**, fixed by a `CHECK` constraint | `00179_site_forms.sql:596-621`. The constraint is re-declared **wholesale** on every extension (`00066` → `00072` → `00173` → `00176` → `00178` → `00179`, documented at `:592-593`), so each new v2 type costs a full re-declaration and an omitted value silently breaks writes for that type. Q1 replaces the constraint with a registry table and an FK; Appendix A(c) is the type list from that point on. |
| PWA surface | **none** | no manifest, no service worker, and no `PushManager`/`serviceWorker`/VAPID reference anywhere in `apps/web/src` or `apps/web/public` — all four verified absent by grep |

**Two commercial deliverables are filed as project configuration.** Valuations and Variation Orders are not missing from the product; they are misclassified. Both are first-class tabs in the project settings tab strip (`SettingsTabs.tsx:49-50`), reachable in two clicks via Settings, gated on `COST_VIEW_ROLES` — and absent from `projectNav` (`Sidebar.tsx:73-88`). A monthly valuation is a deliverable with a deadline and a ball-in-court; it currently lives in the same drawer as Danger Zone. The BOQ is filed the same way, under Settings → Rates (`SettingsTabs.tsx:48`).

#### Module inventory versus use

Row counts are the live-database census of 9 September 2026 unless marked †, which are the 12 August 2026 production measurements recorded in `CLAUDE.md`. "Not censused" means the module was not measured on 9 September and no figure is invented here. The last five rows are **global and route-level surfaces inventoried by disposition rather than by row count** — they were absent from earlier drafts of this table, and two of them are absent from `docs/rbac-matrix.md` as well.

| Module | Rows | Created last 30 days | Verdict |
| --- | --- | --- | --- |
| Tenant schedule (`structure.nodes` + `tenant_details`) | 472† / 411† | 265 | **Alive.** WM's own deliverable; the busiest module on the platform. |
| Floor plans (`tenants.floor_plan_versions`) | Not censused | 201 | **Alive, but machine-driven.** Dropbox sync writes the rows; people do not. |
| Cable schedule (`cable_schedule.*`) | Not censused | 24 | **Alive.** WM engineering; the strongest moat asset. |
| Generator cost-recovery (`gcr.*`) | Not censused | 20 | **Alive.** Billing-driven; a small number of WM users. |
| Site diary | 53 | 31 | **Alive but broken.** 36 of 53 entries from one contractor; median 2-day lag between `entry_date` and `created_at`, max 14; `delays` filled 6/53, `safety_notes` and `quality_notes` 2/53 each. |
| Quality control | Not censused | 11 | **Alive.** WM-authored; 1 saved report. |
| RFIs | 15 | 7 | **Half-alive.** `assigned_to` NULL on all 15; 11 of 15 raised by one contractor; all 5 responses written by WM. |
| Equipment & materials | Not censused | Not censused | **Alive.** Register maintained by WM; 1 saved report since the module shipped in August 2026. |
| BOQ (`projects.boq_items`) | Not censused | Not censused | **Buried.** Real surface — import route (`app/api/projects/[id]/boq/import/route.ts`) plus `BoqImportDialog`, `BoqSectionTree`, `BoqLineItemTable`, `BoqMainSummary`, `BoqReconciliationReport` — filed under Settings → Rates. Same misclassification as valuations and variations. |
| Tenant scope items and documents (`structure.tenant_scope_items`, `structure.tenant_documents`, `tenants.documents`) | Not censused | Not censused | **Sub-module of tenant schedule.** Reached only from the tenant-schedule row expanders; four dedicated action modules (`tenant-scope.actions.ts`, `tenant-documents.actions.ts` and their delete siblings) with no nav entry of their own. |
| Saved reports (`projects.reports`) | 9 | — | **Thin.** 7 tenant schedule, 1 QC, 1 equipment & materials. Nothing is scheduled; every report is produced by a human pressing Generate. |
| Inspections | 18 | 0 responses, 0 certificates | **Dead on assignment.** Every one still `status='assigned'`. |
| Snags | 6 | 0 | **Dead.** All on a demo project; zero photos ever recorded. |
| Site forms | 1 | 0 responses | **Dead on arrival**, one month after shipping. |
| Handover checklist | 0 | 0 | **Never used.** |
| Variation orders | 0 | 0 | **Never used.** Misfiled as a settings tab (`SettingsTabs.tsx:50`), not a module. |
| Valuations | 1 | 0 | **Effectively never used.** Misfiled as a settings tab (`SettingsTabs.tsx:49`), not a module. |
| Medium voltage | Not censused | Not censused | **Specialist.** Paid unlock (R2 000/year), tiny audience. |
| JBCC | Not censused | Not censused | **Specialist.** R1 999 one-time unlock; procedural notices only. |
| Marketplace | 2 orders | 0 | **Dead since April, but advertised on every screen — and deleted outright in Q1.** `NEXT_PUBLIC_PHASE_2_MARKETPLACE` does **not** darken the navigation: the entry renders for every user with an "In Dev" badge (`Sidebar.tsx:186` in project context, `:205` in workspace context, intent documented at `:17-19`); only the pages are stubbed, `(admin)/marketplace/layout.tsx:10-13` serving `InDevelopmentNotice` instead. **Both** nav entries go in Q1 — the `GLOBAL_NAV` row (`Sidebar.tsx:68`, rendered `:194-207`) and the in-project Workspace link (`:180-188`) — and `(admin)/marketplace` becomes a redirect to `/inbox` while the flag is off. Marketplace is **not** a per-project toggle and never becomes one: orders key on `contractor_org_id` (`00005_suppliers_schema.sql:98`, indexed `00010_indexes.sql:69`), so the object is org-level and both links are org-level; a project-scoped switch could not express it. Tables, the seven `(marketplace)` pages and the two April orders are untouched (Appendix A(e)). |
| Compliance schema (`compliance.sites`, `project_sites`, `subsections`, `coc_uploads`, `qr_codes`) | Not censused | Not censused | **Orphaned.** Five tables from `00003_compliance_schema.sql` with no route in `apps/web/src/app`; read only by `packages/shared/src/services/health.service.ts:164` and two edge functions. The project list explicitly records its replacement: "Per-project inspections certified count (replaces compliance-health %)" (`(admin)/projects/page.tsx:68`). |
| Mobile app (`apps/mobile` v2.0.0) | 0 push tokens | — | **Unreachable.** Never published to a store. |
| `/inspections/templates` (global) | Not censused | — | **Always-on, org-level, `OWNER_ADMIN` — unchanged by the programme.** A `GLOBAL_NAV` entry (`Sidebar.tsx:67`, hidden from non-unlocked orgs at `:126`, badge at `:195`) carrying the versioned inspection-template family and its `enforce_template_immutability` trigger (`00066_inspections_module.sql:394,405`), which blocks any UPDATE that changes `schema_json`. Explicitly **not** the site-form template engine: the two are separate engines over separate tables and are never merged, consolidated or spoken of as one. `docs/rbac-matrix.md:61` already carries the row. |
| `/settings/integrations` (global) | Not censused | — | **Always-on, `ORG_WRITE_ROLES`, unchanged.** The cloud-storage mapping (Dropbox / Google Drive / OneDrive) that every drawing and document deliverable in Q2 and Q3 depends on — if it is not connected, the drawing register has nothing to register. Recorded precisely rather than by label: the live page gate is hand-rolled — any active membership that is not `client_viewer` (`settings/integrations/page.tsx:49-51`) — which is wider than `ORG_WRITE_ROLES` by contractor, inspector and supplier, and `docs/rbac-matrix.md:72` still marks the `project_manager` cell `?` (unverified, `:456`). The programme changes neither the gate nor the page; the matrix row is written from the code when the route is next touched, not from the label. |
| `/settings/health` (global) | Not censused | — | **Retained, `OWNER_ADMIN`.** Org churn scores from `public.organisation_health_scores`, the founder-facing view of which *organisations* are going quiet. §14 Q4.8's project health is a different computation over a different subject — a project's own liveness — and does **not** replace it; both exist at the end of the year. One defect recorded as debt, not scheduled: the page filters `user_organisations.role` on `'org_admin'` (`settings/health/page.tsx:71`), a string that appears nowhere else in the monorepo and is absent from `ORG_ROLES` (`packages/shared/src/types/index.ts:7-15`), so the page renders an empty state for every user including owners. It also has **no row at all** in `docs/rbac-matrix.md` (zero matches). |
| `/projects/[id]/documents` | Not censused | — | **Becomes an always-on module, and IS the Q2 register surface.** The route exists and works — `(admin)/projects/[id]/documents/page.tsx`, project read with writes gated by `requireEffectiveRole(…, ORG_WRITE_ROLES)` at `:65-66`, cloud-sync toolbar included — but it is absent from `projectNav` (`Sidebar.tsx:73-88`) and absent from `docs/rbac-matrix.md`, so today it is reachable only by typing the URL. It is added to the navigation and becomes the surface the Q2 drawing-and-document register is built **on**, not a second page beside it (Appendix A(e)). |
| `/projects/[id]/materials`, `/projects/[id]/equipment-schedule` | 0 | — | **Legacy redirect shims — deleted in Q1 item 8.** Both are `redirect()` one-liners onto `/equipment-materials` (`materials/page.tsx:18`, `equipment-schedule/page.tsx:18`) left behind when the two tabs were merged. Their `docs/rbac-matrix.md` rows (`:54`, `:55`) and footnote `⁶` (`:86`) are removed in the same PR as the deletion. |

Two tables ship empty and unreferenced by any working flow: `public.rfi_annotations` and `projects.drawings` (0 rows each). They are listed here as schema debt, not modules.

Fourteen projects exist. Five hold real data; six have a single member and nothing in them.

**Where things live.** Appendix A (§16) is the canonical registry for work-item types, notification types, report kinds, module tokens, new tables by quarter, routes, the working-day calendar and external vendors; no section re-lists them. Everything above is the *current* state, measured; everything the appendix carries is the *target* state, decided.

### Engagement diagnosis

#### Finding 1 — Nothing is ever assigned, so nobody owes anything

`assigned_to` is NULL on all 15 RFIs. This is by design, not neglect: the RFI creation form carries no assignee control and says so — "No assignee field — RFIs are team-wide: every active project member is notified" (`(admin)/rfis/new/page.tsx:156-157`). The action already treats the gap as a known defect, recording `assigneeSource` as `'none'` when neither an explicit assignee nor a project default exists (`apps/web/src/actions/rfi.actions.ts:70`). A `default_rfi_assignee_id` column has existed since `00101_project_settings.sql:29` and is exposed in project settings (`settings/operational/OperationalForm.tsx:281`); production shows it unset.

Snags and inspections do carry assignee columns (`00004_field_schema.sql:22`, `00066_inspections_module.sql:54`). The columns are written and displayed — but never *read for a person*. Two verified negatives close this finding:

- **No route.** No `inbox`, `my-work`, `today` or `assigned` route exists anywhere in `apps/web/src/app`. The dashboard is an organisation-wide roll-up (`(admin)/dashboard/page.tsx:33-40`). Eleven of the twelve portal pages sit under `/portal/[projectId]`; the twelfth is a project list (`(portal)/portal/page.tsx`).
- **No query.** A grep across `apps/web/src`, `apps/mobile/src` and `packages/shared/src` for any read filtering on the current user's assignment returns nothing. The one filter capability that exists — `snagService.listByOrg`'s `assignedTo` clause at `packages/shared/src/services/snag.service.ts:39` — has no caller that passes a user id; its only two call sites pass `status`, `priority` and `agingDays` (`(admin)/snags/page.tsx:57-62`). Every other `assignedTo` reference in the monorepo either writes an assignment or renders an assignee's name.

The columns exist, the role resolver exists, and nothing has ever selected work by assignee. Eighteen inspections sit at `status='assigned'` with zero responses because assignment produces a bell and nothing else.

#### Finding 2 — The notification firehose is unread, and the only outbound engine is a churn nudge

964 notifications sent, 57 ever read — 5.9%. 750 of the 964 are `diary_created`. The mechanism is explicit: every diary entry calls `notifyEntityEvent` (`apps/web/src/lib/diary-email.ts:83`), which resolves the *entire* project roster and bells everyone except the author (`apps/web/src/lib/notify.ts:30-40`), with a parallel email to the whole roster including the author. Fifty-three diary entries therefore produced roughly fourteen bells each. There is no relevance filter: the bell fetches the latest 30 rows with no scope, no priority split and no "aimed at me" tab (`apps/web/src/components/ui/NotificationCentre.tsx:39-47`, the unscoped `.limit(30)` at `:45`), and its only bulk action marks everything read (`:49`).

What does **not** exist is a relevance-ranked digest of a user's own obligations. What *does* exist is a churn-nudge sequence, and its failure is itself evidence. Six scheduled lifecycle-email functions ship today — `onboarding-email-d0/d1/d3/d7/d14` and `reengagement-check`. The latter is a daily cron that buckets users by last-login age into 7–13, 14–29 and 30+ day cohorts and sends `inactive_7d`/`inactive_14d`/`inactive_30d` (`reengagement-check/index.ts:1-40`), idempotent through `public.email_sequence_events`' `UNIQUE (user_id, sequence_name, step_name)` (`00030_email_sequences.sql:14`) with per-user unsubscribe URLs (`_shared/email-sequence.ts:50`). That machinery has been firing at the thirteen dormant contractor accounts and has recovered none of them.

The diagnosis is therefore sharper than "no digest": generic re-engagement mail addressed to a person's *absence* does not work, because it carries no obligation. The idempotency ledger and unsubscribe plumbing are sound and are the natural substrate for the 07:00 recap — the payload has to change, not the transport.

#### Finding 3 — Site capture has no installable phone surface, and the one uploader that matters opens a file picker

`apps/mobile` is a complete Expo 52 client — dashboard, projects, snags, diary, floor plans, inspections, RFIs, QR scan — and it registers an Expo push token on sign-in (`apps/mobile/src/providers/AuthProvider.tsx:75-86`). It has never been published to an app store, and `public.push_tokens` holds zero rows in production, so `send-notification`'s push leg (`send-notification/index.ts:104`) has never delivered anything.

The gap in the web client is narrower and more specific than "no camera". Camera capture already works: `capture="environment"` is set on the file inputs in `forms/[formId]/FormPhotoStrip.tsx:302`, `inspections/[inspectionId]/fields/PhotoField.tsx:126` and `.../fields/InlinePhotoCapture.tsx:137`. Four things are absent, all verified by grep across `apps/web/src` and `apps/web/public`: **no manifest, no service worker, no VAPID or `PushManager` reference, and therefore no home-screen icon, no web push and no offline capture.**

Snags fail for a nearer reason than the unpublished Expo app. The web snag uploader exists and is reachable (`(admin)/snags/[id]/SnagPhotoUploader.tsx`), but its input at `:117-125` sets `accept` and `multiple` and **no `capture` attribute** — on a phone it opens a file picker rather than the camera. Photographing a defect therefore means taking a photo in the camera app, leaving it, opening the browser, finding the snag and picking the file back out of the gallery. Zero snag photos is the predictable result of that sequence, not of a missing app.

Two phone-shaped surfaces already exist in the navigation and should be absorbed by the PWA work rather than rebuilt: `/site` (`Sidebar.tsx:93`), which lists every cable pending site length confirmation across all accessible draft revisions (`(admin)/site/page.tsx`), and the `(scan)` route group's tag lookup (`(scan)/site/tag/[text]/page.tsx`), which renders outside the admin shell.

#### Finding 4 — The modules that thrive are the ones WM must maintain for its own work

The headline number is the month-over-month collapse: **91 authentication events across 28 users in July 2026, 2 events across 1 user in August.** The platform is not merely under-adopted; it is falling out of use.

Rank the last 30 days by rows created and the pattern is total: tenant schedule 265, floor plans 201, cable schedule 24, GCR 20, QC 11 — all WM-authored engineering deliverables WM cannot produce without the app. Below that line sit the collaboration modules: diary 31 (but 36 of 53 lifetime entries from a single contractor), RFIs 7, snags 0, inspections 0, forms 0. The platform is load-bearing for the buyer's own drawing office and optional for everyone else.

Nothing in it creates an obligation a contractor or client must discharge. Thirteen contractor accounts have not signed in for 30 days, four never at all, and the four client viewers have not returned since 8 July. Of 36 accounts, 27 sit in WM's own organisation; 24 have signed in within 90 days and 3 within the last 7. The single-tenant usage profile is not a marketing failure — it is the direct output of a product in which every obligation belongs to the vendor.

#### Finding 5 — Six of fourteen projects are empty shells, opening onto a cabinet of empty drawers

Only five of fourteen projects hold real data; six have one member and nothing in them.

A new project opens onto **fifteen project modules plus a Settings drawer that itself hides fifteen tabs, two of which (Valuations, Variations) are commercial deliverables** (`Sidebar.tsx:73-88`, `SettingsTabs.tsx:42-57`). Two of the fifteen modules are paid unlocks that show a padlock rather than value (JBCC and Medium Voltage, `Sidebar.tsx:173-174`). Above them sits a permanent Workspace entry for Marketplace, rendered to every user in every context with an "In Dev" badge (`Sidebar.tsx:186`, `:205`) and leading to a placeholder (`(admin)/marketplace/layout.tsx:10-13`) — a dead module advertising itself on every screen in the product.

And the count is wrong in both directions: a route that *should* be in the sidebar is missing from it. `/projects/[id]/documents` is a working page absent from `projectNav`, so the one drawer a contractor or client actually wants — the current drawings and documents — is the one they cannot find, while the drawer labelled "coming soon" is impossible to miss.

There is no per-project module configuration and no seeded first work. The first-run experience is an empty filing cabinet whose most prominent drawer is labelled "coming soon", which is why single-member projects stay single-member.

### What we are not doing

| Excluded | Rationale |
| --- | --- |
| App-store publication | The phone client is an installable PWA with web push. `apps/mobile` is parked at v2.0.0 — not deleted, not maintained, not shipped this version. |
| Computer-vision progress tracking or 360° capture | Capital-intensive and aimed at the wrong problem: E-Site's gap is obligation, not observation. |
| Rewriting the engineering calculation modules | Cable calc, MV protection, GCR and the SANS reference data are correct, tested and the moat. They gain work items, threads and reports; their mathematics is untouched. |
| Replacing Microsoft Teams as a general chat tool | E-Site absorbs the *project-record* conversation — threads bound to an item, with @mentions and reply-by-email. Ambient chat stays in Teams. |
| Marketplace revival | Marketplace ships no new work in the 12 months and leaves the navigation entirely in Q1 — both entries deleted, not toggled, and it never becomes a per-project switch because orders are org-level. The two orders it has ever taken date from April 2026. |
