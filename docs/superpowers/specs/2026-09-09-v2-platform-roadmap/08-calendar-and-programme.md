## Primitive 6 — calendar, programme and the tenant delivery tracker

E-Site already stores a dozen classes of dated object and surfaces none of them together. There is no calendar route: the project navigation lists sixteen module links and not one is a date view (`apps/web/src/components/layout/Sidebar.tsx:73-88`). Dates are visible only to whoever opens the module that owns them, which is why an overdue beneficial-occupation (BO) date, an unreturned RFI and a JBCC time bar can all be live on one project with nobody seeing them on one screen. The planning layer is therefore a projection over dates that already exist, plus two small tables, plus the arithmetic that turns a date into an owned commitment.

### What already exists (verified)

| Dated object | Where it lives | Surfaced today |
|---|---|---|
| Project opening date | `projects.projects.opening_date` (`00093_tenant_bo_dates.sql:35`) | one control on the tenant-schedule page |
| Tenant BO date | computed, never stored — `computeBoDate` (`packages/shared/src/structure/bo.service.ts:86`) over `bo_period_days` / `bo_date_override` (`00093:51,55`) | BO cells in the schedule table |
| Order required-by + RAG | `computeOrderRequiredBy` / `computeRagStatus` (`bo.service.ts:116,139`), 14-day amber window (`bo.service.ts:31`) | Equipment & Materials rows only (`.../equipment-materials/_lib/gather-unified-boards.ts:77,82`) |
| JBCC time bar | `projects.jbcc_letters.trigger_date` / `deadline_date` (`00099_jbcc_module.sql:112-113`), computed by `computeDeadline` (`packages/shared/src/lib/jbcc/working-days.ts:37`) | `DeadlineStrip.tsx` inside the JBCC tab |
| RFI due date | `projects.rfis.due_date` (`00002_projects_schema.sql:91`) | a text suffix on the RFI list (`apps/web/src/app/(admin)/rfis/page.tsx:153`) |
| Inspection schedule | `inspections.inspections.scheduled_at`, TIMESTAMPTZ (`00066_inspections_module.sql:62`) | a date column on the inspections list (`inspections/page.tsx:170`), selected into the portal read (`apps/web/src/lib/portal/data.ts:207`), and the mobile sort key (`apps/mobile/app/inspections/index.tsx:57`) — but in no cross-module or dated view |
| QC visit | `projects.qc_reports.inspection_date`, DATE (`00172_qc_reports.sql:65`) | report header |
| Snag visit | `field.snag_visits.visit_date`, DATE (`00120_snag_site_visits.sql:20`) | visit list |
| Drawing issue | `structure.tenant_details.layout_issued_at`, trigger-derived from `tenant_document_revisions.issued_at` (`00118_tenant_documents.sql:24,40-45`) | a status pill |
| Contract dates | `projects.project_settings.contract_signed_date` / `practical_completion_date` (`00101_project_settings.sql:37-38`) | a settings form |
| Valuation | `projects.valuations.valuation_date` (`00132_project_valuations.sql:10`) | valuation list |
| Project window | `projects.projects.start_date` / `end_date` (`00002:21-22`) | project header |
| Site diary entry date | `projects.site_diary_entries.entry_date` (`00002:150`) | the diary list — and **not projected by this section**; the end-of-day check-in is a recurring daily prompt owned by Primitive 2's Today view, because there is no source row until the entry exists |

Two working assets are built and stranded. First, a correct South African working-day engine — Mon–Fri minus computed public holidays including Easter (`working-days.ts:21-22`, `sa-public-holidays.ts`) — is namespaced under `lib/jbcc/` and used by nothing else; its `crossesBuildersHoliday` helper (`working-days.ts:67`) is exported and never called. Second, `project_settings.working_days`, `extra_holidays`, `builders_holiday` and `holiday_calendar` (`00101:19-23`) are editable in the operational settings form (`.../settings/operational/OperationalForm.tsx:179-191`) but drive no computation: they round-trip through the mappers (`packages/shared/src/services/_project-settings-mappers.ts:65-68`) and the settings service (`project-settings.service.ts:311-321`) and stop.

Two modules were read and contribute nothing. **GCR** (`00124_generator_cost_recovery_schema.sql`) has no date column anywhere beyond `created_at`/`updated_at` — it is out of the calendar entirely. **Handover** (`projects.handover_checklist`, `00002:181-192`) carries only `is_complete` / `completed_by` / `completed_at` and no target date; when the Handover module toggle is on — it is OFF by default, per Appendix A(e) — its items become work items whose due dates derive from the practical-completion milestone (`00101:38`), which is also the only thing that would give that table its first production row.

### (a) The project calendar

**Decision: a projection, not an event store.** Copying dates into a `calendar_events` table would create a second source of truth for every date the modules already own, plus a reconciliation job for each. The calendar reads one view, `projects.dated_items`, that UNIONs the sources below. Two new tables carry the classes with no existing home: `projects.calendar_entries` (meetings and ad-hoc planned visits — nothing else) and `projects.milestones` (every milestone, including hand-created ones).

**Security of the view is the first design constraint, not an afterthought.** A Postgres view is security-*definer* by default and would run as its owner, bypassing every base-table policy; and migration `00025_grant_schema_permissions.sql:20,26` runs `GRANT SELECT ON ALL TABLES … TO anon` plus `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon` for the `projects` schema, so a new view there inherits `anon` SELECT automatically — the same shape as the anon-grant incidents that forced `00168`'s revokes on `cable_schedule`/`structure`. The DDL is therefore explicit:

```sql
CREATE VIEW projects.dated_items
  WITH (security_invoker = true, security_barrier = true) AS …;
REVOKE ALL ON projects.dated_items FROM anon, PUBLIC;
GRANT SELECT ON projects.dated_items TO authenticated, service_role;
```

Verified after apply with `has_table_privilege('anon','projects.dated_items','SELECT') = false` — never by reading `relacl`, which looks empty when it is inherited. A contract test asserts `pg_class.reloptions` still contains `security_invoker=true`, because silently dropping that reloption converts the view into a full-database read.

**For staff and contractors, base-table RLS is the only gate** — a contractor sees exactly the dates they can already reach and no new read policy is written. **The landlord-facing surface is a separate path** and is covered in (c); the portal is app-gated, not RLS-gated.

Every projected row carries the same shape:

```
kind            text          -- 11 values, table below
occurs_on       date          -- the day the row lands on; sites work in days
occurs_at       timestamptz   -- NULL except where the source stores a time
entity_type     text
entity_id       uuid
project_id      uuid
module          text          -- so a toggled-off module contributes nothing
ball_in_court   uuid NOT NULL -- projects.resolve_ball_in_court(...)
state           text          -- planned | due | overdue | done | void
severity        text          -- statutory | contractual | operational
```

`ball_in_court` is never null. It resolves through a new `projects.resolve_ball_in_court(p_project_id uuid, p_candidate uuid) RETURNS uuid`: `COALESCE(p_candidate, the module owner, the earliest active project_members row with role='project_manager', projects.projects.created_by)`. The terminal term is `NOT NULL` at `00002:28`, so the function cannot return null for a project that exists, and the view's `ball_in_court` column is declared over that COALESCE so the guarantee is structural.

**This function is not a second implementation of §03's generated column, and the two are not alternatives.** `projects.work_items.ball_in_court_id` is a `STORED` generated column over three columns of its own row (Appendix A(a)); it is the holder of record for every work item and nothing here recomputes it. `resolve_ball_in_court()` exists because the **ten non-work-item `dated_items` kinds have no such column** — a BO date, a CoC due date, a JBCC deadline, a valuation and the rest carry at best a candidate uuid that is frequently null — so the function supplies a non-null holder for those ten, and for `work_item_due` it **passes `work_items.ball_in_court_id` straight through**. One is a stored per-row fact on the spine; the other is a fallback chain for sources that never had one.

**`projects.projects.site_manager_id` (`00002:27`) is dead and is not in the chain** — grep across `apps/web/src`, `apps/mobile/app` and `packages/shared/src` finds only reads (`packages/shared/src/services/project.service.ts:15,18,40,43,57,60`), no writer, no form field, no server action. A test fails the build if any `dated_items` row returns a null `ball_in_court`. The function is `SECURITY DEFINER` with a locked `search_path` (so the fallback resolves even where the caller cannot read `project_members`), takes `auth.uid()` rather than `current_user`, and ships with `REVOKE ALL … FROM PUBLIC` **and** an explicit `REVOKE … FROM anon`, verified with `has_function_privilege('anon', oid, 'EXECUTE')`.

| Kind | Source (verified) | Severity | Ball-in-court candidate | done → / void → |
|---|---|---|---|---|
| `work_item_due` | `projects.work_items.due_date` (Primitive 1) | inherits the item's type | `work_items.ball_in_court_id` — already `NOT NULL` while open, passed through unchanged | `status='closed'` / `status='void'` |
| `bo_date` | `computeBoDate` over `opening_date` + `bo_period_days`/`bo_date_override` (`bo.service.ts:86`) | contractual | tenant's party on `tenant_scope_items` (`00080_tenant_schedule.sql:95`), else PM | `tenant_details.bo_confirmed_on` present / node `status='decommissioned'` (`00074:44-45`) |
| `coc_due` | = that node's BO date, projected only where `nodes.coc_required` (`00074:43`) | statutory | the inspection's `assigned_to_id`, else PM | a live `inspections.certificates` row (`00066:183`, `revoked_at`/`superseded_at` null) for an inspection whose `target_node_id` (`00066:50`) is the node / `coc_required=false` |
| `order_required_by` | `computeOrderRequiredBy` + the lead/install offsets in (d) | contractual | PM | `node_orders.status='received'` (`00083_node_orders.sql:75`) / `status='by_tenant'` |
| `jbcc_deadline` | `jbcc_letters.deadline_date` (`00099:113`) | statutory | the letter's issuer | `status='served'` (`00099:109-110`) / **no void state** — a lapsed time bar stays overdue, because that is the contractual fact |
| `inspection` | `inspections.scheduled_at` (`00066:62`) | operational | `assigned_to_id` | `status='certified'` / `status='abandoned'` (`00066:57-58`) |
| `qc_visit` | `qc_reports.inspection_date` (`00172:65`) | operational | `raised_by` | `status IN ('issued','closed')` (`00172:77`) / — |
| `snag_visit` | `snag_visits.visit_date` (`00120:20`) | operational | `conducted_by` | `completed_at` present (`00178_snag_visit_completion.sql`) / — |
| `milestone` | `projects.milestones.target_date` | its `kind` column | `owner_id` | `actual_date` present / — (milestones that lapse are deleted) |
| `meeting` | `projects.calendar_entries.occurs_on` | operational | `organiser_id` | `occurs_on < today` / `cancelled_at` present |
| `valuation` | `projects.valuations.valuation_date` (`00132:10`) | contractual | `created_by` | `status='certified'` (`00132:28`) / — |

`work_item_due` is the reference implementation and the first kind built, because `projects.work_items` is the only source that already carries an assignee and a due date natively (`due_date date NOT NULL`, `ball_in_court_id` a STORED generated column — Appendix A(a)) — so its projection is a straight SELECT and its `ball_in_court` is trivially non-null. It also removes duplication by construction: **`projects.rfis.due_date` is deliberately not a kind of its own.** Primitive 1 mirrors every RFI into `work_items`, so projecting the RFI's own due date as well would render one commitment twice. The same applies to snag close-out, QC entry close-out, inspection completion and form submission. The three visit kinds survive alongside `work_item_due` because a site visit and the record it produces are genuinely different dates; where they coincide the UI collapses rows sharing `(entity_type, entity_id, occurs_on)`.

**Date and time.** Only `inspections.scheduled_at` is a TIMESTAMPTZ (`00066:62`); `snag_visits.visit_date` and `qc_reports.inspection_date` are already DATE. The projection therefore exposes both `occurs_on date` and `occurs_at timestamptz NULL`. A drag writes the new **date** and preserves the source's existing time of day; a 09:00 SAST default applies only when the source's time is null on first scheduling. Without that rule a date-grid drag silently destroys the time on every scheduled inspection.

**Views.** Month is the read-mostly default. Week is the working view: seven columns, rows grouped by ball-in-court, drag permitted only on rows whose date is *stored* (`work_item_due`, `meeting`, `milestone`, `inspection`, `qc_visit`, `snag_visit`). Derived dates — `bo_date`, `coc_due`, `order_required_by`, `jbcc_deadline`, `valuation` — render locked; dragging one opens the control that owns the input, because silently overriding a derived date is how the schedule and the PDF start disagreeing. **Per-tenant** is the third view and is the row-expansion of the tracker in (c), not a separate model: the same `dated_items` query filtered to rows whose entity resolves to a node under the shop's owning lease (`resolveOwningLease`, `packages/shared/src/structure/owning-lease.ts:25`), rendered as a single vertical date column for that shop with the pipeline stage badge pinned at the top. All three views read one view and one query.

**Working-day arithmetic splits in two, and the split is deliberate.** `packages/shared/src/lib/calendar/working-days.ts` gains a `ProjectCalendar` argument built from `project_settings` (`working_days`, `extra_holidays`, `builders_holiday`, `holiday_calendar` — `00101:19-23`) and drives **operational** dates only: install durations, chase intervals, lookahead windows, work-item due dates. **The JBCC engine keeps a fixed statutory South African calendar** — Mon–Fri minus SA public holidays, `working-days.ts:21-22` unchanged — and ignores `project_settings` entirely. JBCC defines "working day" in the contract, not in a project preference; `deadline_date` is stored (`00099:113`), so letting an admin toggle Saturday on in the operational form (`OperationalForm.tsx:179-191`) would compute old and new letters on different definitions with nothing recording which. `lib/jbcc/working-days.ts` becomes a shim that passes the statutory calendar explicitly (a shim cannot supply a `ProjectCalendar`: `computeDeadline`'s only caller passes `(notice, triggerDate)` — `apps/web/src/actions/jbcc.actions.ts:295`), and a test asserts a JBCC deadline is byte-identical after `working_days` is edited. `crossesBuildersHoliday` becomes a caveat badge on any deadline whose window crosses 15 Dec–15 Jan — the single most common cause of a missed December commitment on a South African site.

**The mechanism under that split is Appendix A(h), and it exists once.** Statutory holidays are materialised into `projects.public_holidays(d date PRIMARY KEY, name text)`, **seeded from the existing computus function** `listHolidays(year)` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:43`, verified: fixed dates, Good Friday and Family Day by computus, and the Sunday-observed-Monday rule), with a contract test asserting the table equals `listHolidays()` for every seeded year — so the table is a materialisation of the one source, not a second source. `projects.calendar_years(year int PRIMARY KEY, seeded_at timestamptz)` makes an unseeded year detectable, and is refreshed each October for the following year. **`projects.working_days_between(p_from timestamptz, p_to timestamptz, p_project uuid, p_calendar text)` is the one SQL function every reader calls** — `STABLE` and never `IMMUTABLE`, since it reads a table and folding a result across a calendar refresh would be a silent drift; both bounds evaluated `AT TIME ZONE 'Africa/Johannesburg'`; and it raises `no_data_found` on an unseeded year rather than falling back to calendar days, because a one-day drift changes whether an item escalates. `packages/shared/src/lib/calendar/working-days.ts` is its TypeScript mirror, with a contract test asserting the two agree over a fixture year.

**No `works_saturdays` column is added.** `projects.project_settings.working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]` (`00101_project_settings.sql:20`, verified) already carries the working week; a boolean beside it would be a second source of truth for a fact the array states. `p_calendar` selects between the two calendars derived from that one row: **`office`** = `working_days` as stored, minus `public_holidays` and `extra_holidays`; **`site`** = `office` plus Saturday where Saturday is absent from `working_days`, because SA sites work Saturdays. Which calendar a kind uses is a column on the type registry (Appendix A(b)), never a per-call decision, and a due date landing inside the December builders' shutdown is pushed to the first site working day of the new year.

### (b) Milestones and the lightweight programme

**Decision: milestones plus a three-week lookahead. No critical path, no logic links, no resource levelling, no baseline, no earned value.** RIB Candy (CCS) is the SA contractor's estimating, BOQ, valuation and programme standard at roughly R1 500/month per licence; BuildSmart owns integrated costing. Neither touches the field, and neither is displaceable by a consulting engineer's app. WM is the electrical consultant, not the planner: it does not own the construction programme, it owns *commitments against* it. A CPM engine would cost a quarter and lose to Candy on the ground Candy is built for. E-Site's scheduling claim is narrower and defensible: **every date one person owes another is visible, owned and chased.**

`projects.milestones` is deliberately thin — `id, project_id, organisation_id, name, target_date, actual_date, owner_id, kind (contractual|internal|tenant|statutory), sort_order`. No predecessors, no duration, no float. A milestone that slips is a fact recorded and announced; nothing recalculates downstream, because nothing downstream is modelled. Seeds on project creation: contract signed, construction start, practical completion, centre opening — **all four already have columns to backfill from** (`project_settings.contract_signed_date` and `practical_completion_date` at `00101:37-38`, `projects.start_date` at `00002:21`, `projects.opening_date` at `00093:35`).

`projects.calendar_entries` is equally thin and holds meetings and ad-hoc planned visits **only**: `id, project_id, organisation_id, kind (meeting|site_visit), title, occurs_on date, occurs_at timestamptz NULL, duration_minutes int NULL, location text, organiser_id, attendee_ids uuid[], cancelled_at, created_by`. **Recurrence is out of scope for Q4: one row per occurrence.** A weekly site meeting is thirteen rows created by one "repeat for N weeks" control at insert time — an RRULE engine plus per-occurrence exceptions is a fortnight of work for a table that will hold a few hundred rows per project.

`field.inspection_milestones` (`00004_field_schema.sql:80-94`) already carries almost exactly this shape — name, description, `scheduled_date`, `completed_date`, status, `inspector_id` — with RLS maintained as recently as `00160:114-116`, and **zero application code**: grep across `apps` and `packages` finds it only in `packages/db/src/types.ts:1001`. It is dead. `projects.milestones` supersedes it and the same migration drops it, after asserting `count(*) = 0` in the same transaction, migrating any rows found into `projects.milestones` before the drop, and taking the pre-migration snapshot Appendix A(f) requires of every destructive migration.

The three-week lookahead is a filter over `dated_items`, not a second model: last week (what slipped), this week, next week, grouped by ball-in-court, its window counted in **site** working days. It is the agenda for the site meeting and it is what the weekly PDF renders.

### (c) The tenant delivery tracker

This is the highest-value object in the section. No product links lease → shop DB → CoC → occupation certificate; SA landlords run this in spreadsheets and hire PM firms for it; TCTrac's insight is that the tracker is a *pipeline with one status per tenant*, not a document folder. E-Site already stores most of the evidence.

| Stage | Evidence | Derivation / capture |
|---|---|---|
| Lease recorded | a `tenant_db` node with `shop_number`/`shop_name` (`00074:32-37,48-49`) | derived from the tenant-schedule import. **No `lease_signed_on` column is added**: nothing in E-Site captures a lease, so the column would be null in all 411 tenant rows |
| Scope received | `tenant_details.scope_status='received'` OR `scope_not_required` (`00080:64-65`, `00150_tenant_scope_not_required.sql:14`) | derived; trigger-maintained (`00118:36-49`) |
| Drawings issued | `layout_status='issued'` + `layout_issued_at` (`00080:68-70`) | derived; trigger-maintained (`00118:40-45`) |
| Drawings approved | revisions store `issued_at` only (`00118:24`) | new `tenant_document_revisions.approved_on` / `approved_by`, **written by closing the drawing-approval work item and never typed free-hand** — approval is an assigned commitment with a due date, and the timestamp is its side effect |
| Installation | every landlord-party `node_orders` line on the node at `status='received'` (`00083:75`) and no open snags | derived, no schema change |
| Beneficial occupation | planned = `computeBoDate` (`bo.service.ts:86`) | new `tenant_details.bo_confirmed_on`, written by a **Confirm BO** action on the tenant row — the same action whose output the landlord's report reads, so the person who benefits from the field is the person who fills it |
| CoC | a live `inspections.certificates` row (`00066:183`) against the node (`00066:50`) | derived; `nodes.coc_required` (`00074:43`) decides whether the stage applies |
| Occupation certificate | none today (municipal) | derived from a `tenant_documents` row of a new `kind='occupation_cert'`; the stage date is that revision's `issued_at` (`00118:24`), **not a separate column**. The `kind` CHECK (`00118:7`) is re-declared wholesale with all three values; `recompute_tenant_doc_status` needs no change because its `IF/ELSIF` has no `ELSE` and no-ops on an unknown kind (`00118:41-49`) |

**Three new columns is the whole schema cost** — `bo_confirmed_on`, `approved_on`, `approved_by`. Stage status is derived wherever evidence exists in E-Site, and captured only where the event happens outside it; each captured value has a named surface and a workflow gate that forces it. This discipline is not theoretical: `00169_db_legend.sql:140-145` added `db_location`, `db_fed_from` and `db_earth_leakage_ma` to this same table as free-text capture fields, and they are null in **all 411** production rows — which is why PR #161 abandoned them as a prefill source. A column with no gate is a column that stays null.

`scope_not_required` (`00150:14`) and `nodes.coc_required` (`00074:43`) mark stages not-applicable rather than incomplete, so a landlord-fitted shop does not read as late forever.

**The landlord-facing tracker reuses the established portal pattern, not RLS.** Migration `00166_client_viewer_node_order_read_block.sql` **dropped** `node_orders_select_client_viewer` after a confirmed live leak, so a `client_viewer` JWT reads **zero** rows from `structure.node_orders`; the Installation stage and the `order_required_by` kind cannot be derived through RLS for a landlord at all. The portal shows this data only because `getPortalEquipmentMaterials` reads it with `createServiceClient()` behind `requirePortalAccess` (`apps/web/src/lib/portal/data.ts:39-53, 274-330`) under an explicit column allow-list. The tracker follows exactly that: `requirePortalAccess` → service client → allow-listed projection of `node_orders.status` only, never `notes`, documents or shop drawings (all three blocked at the DB by `00166`). It lives beside the existing portal tenant-schedule surface (`apps/web/src/app/(portal)/portal/[projectId]/tenant-schedule/`), at the route Appendix A(g) registers as `/portal/[projectId]/delivery`, and the new read is added to `docs/rbac-matrix.md` in the same PR.

The tracker adds the one column a landlord acts on: **ball-in-court by party** — landlord, tenant, WM, contractor, municipality — because the only question a shopping-centre landlord asks is whose fault Shop 42 is. Rows sort by BO date; overdue is measured against BO, not against today.

### (d) Procurement lead-times and the late-order alert

The current derivation has a defect worth naming: `computeOrderRequiredBy` returns the BO date itself for a tenant order and the project opening date for an equipment order (`bo.service.ts:116-121`). An order "required by" the day the tenant takes occupation is already late by the whole lead time and the whole installation duration. The 14-day amber window (`bo.service.ts:31`) is the only slack in the model and it is a display constant, not a procurement fact.

**Decision: tenant lead times are a property of the scope item; equipment lead times are a property of the project.** `structure.scope_item_types` gains `lead_time_days INT NOT NULL DEFAULT 30` and `install_days INT NOT NULL DEFAULT 3`. **The migration seeds non-zero values for the two built-in types in the same statement** — `db` → 60 lead / 5 install, `lighting` → 30 / 3, updating the rows seeded per organisation at `00080:121-129` — so the fix takes effect on apply rather than shipping as a no-op waiting for someone to populate it, and the table is read back afterwards. Equipment orders can never be reached this way: `node_orders.scope_item_type_id` is NULL for every equipment order by design (`00083:68-69`, enforced by the partial unique index at `00083:111-113`). They take `projects.project_settings.equipment_lead_time_days INT NOT NULL DEFAULT 90` and `equipment_install_days INT NOT NULL DEFAULT 10` — project-level because switchgear procurement is a project fact, and `project_settings` already exists 1:1 with the project.

Required-by becomes `BO date − lead_time_days − install_days` for a tenant order and `opening_date − equipment_lead_time_days − equipment_install_days` for an equipment order, with `install_days` counted in the **site** calendar's working days through `working_days_between(…, 'site')` and `lead_time_days` in calendar days (a supplier does not observe your working week). `computeOrderRequiredBy` keeps its signature and gains an optional offsets argument, so the three existing call sites — the admin tab (`gather-unified-boards.ts:77`), the portal (`portal/data.ts:274-330`) and `computeNodeOrderRequiredBy` (`owning-lease.ts:99`) — compile unchanged.

`AMBER_WINDOW_DAYS` stays at 14 and `computeRagStatus`'s signature is untouched, but its meaning changes: it stops being a proxy for lead time (which the required-by date now embeds) and becomes the "order it this week" warning band. No existing display changes; the dates behind them get honest.

The late-order alert is a **daily per-project digest, not a per-order notification**. Production holds 964 notifications, 57 ever read, 750 of them `diary_created`: per-row notification is a failure mode already measured in this product. One digest per project per day, sent only when the set of red or newly-amber orders changes, addressed to the ball-in-court, listing tenant, scope item, BO date and days late — one commitment ("order 4 late items for KFC, DEBONAIRS, CONVERSE"), not four bells. The migration **inserts two rows into `public.notification_types`** — `order_late` and `milestone_due`, both **Held** tier, with the audiences Appendix A(c) records. It does **not** re-declare `notifications_type_check`, because Q1 retired that constraint and replaced it with the `notification_types` table plus an FK; after Q1, adding a type is an `INSERT`. That the CHECK had been rewritten six times (`00066:653`, `00072:29`, `00173:28`, `00176`, `00178:58`, `00179:595`) and could never be appended to is exactly why it is gone.

### (e) The contract this section offers the Inbox, the chase agent and the reports

This section owns dates, not delivery. **The contract is: every `dated_items` row carries `occurs_on`, `severity` and a non-null `ball_in_court`, and statutory items are therefore rankable above operational ones.** How the Inbox orders its rows and how the 07:00 recap lays out its sections belong to Primitives 2 and 4. What this section publishes is the chase schedule per kind and the reports each kind feeds:

| Kind | Severity | Chase schedule this section publishes | Report |
|---|---|---|---|
| `work_item_due` | inherits type | at assignment, at due, then per the item type's interval | weekly pack, My Work |
| `jbcc_deadline` | statutory | at trigger, daily inside 5 working days, escalates to the project owner at 2 | weekly pack, top block |
| `coc_due` | statutory | 7, 3 and 1 days before the BO date | tenant delivery tracker, compliance pack |
| `bo_date` | contractual | 30, 14 and 7 days out to the ball-in-court party; weekly to the landlord party | tenant delivery tracker |
| `order_required_by` | contractual | daily digest when the red/amber set changes; escalates to the PM at red | Equipment & Materials |
| `inspection` / `qc_visit` / `snag_visit` | operational | day before, morning of — one nudge only | that visit's own report |
| `milestone` | its `kind` column | 7 days out, and on slip | lookahead page |
| `meeting` | operational | day before | the agenda is the lookahead |
| `valuation` | contractual | 7 days out | valuation pack |

Reports gain two things and invent nothing. The tenant-schedule report already computes a BO block (`upcoming / overdue / noDate`) and a per-shop `boOverdue` flag (`apps/web/src/lib/reports/tenant-schedule-report-compute.ts:120,144-148`); it gains a BO-runway page ordered by date. A new `tenant_delivery` report kind joins the unified `projects.reports` table (`00117_report_export_branding.sql:48`) with its existing supersede chain, note and summary, rendered through the shared saved-reports panel. It **declares `access.read` on the `ReportSpec` registry** — project access, with the landlord surface served by `requirePortalAccess` → service client → allow-listed columns rather than by RLS, as Appendix A(d) records. It does not touch `REPORT_KIND_READ_ROLES` or `user_can_read_report_kind()`: the Q3 registry port made the registry the single source and deleted the constant, and `tenant_delivery` lands in Q4, after that port. The DB side stays in lockstep through `public.report_kind_is_sensitive()` and the registry contract test. Every string the report draws must pass through `winAnsiSafe` with `collapseWhitespace: false` for react-pdf — a tenant name with an en dash, or a `≤` in a lead-time note, otherwise prints the wrong glyph with no error at all (`apps/web/src/lib/pdf/winansi.ts`).

**Calendar subscription ships as a read-only signed ICS feed per user** at `/api/calendar/ics?token=…`. It puts E-Site dates into Outlook — the tool the calendar is competing with — for the cost of one route, without importing anything back. **It ships in Q4, inside the Q4.1 calendar line, at 0.5 engineer-weeks**: it was previously specified in full here with no quarter carrying it, and the Q4 re-plan adds it explicitly rather than leaving it as an unbudgeted line. It is designed against the confirmed PR #160 defect 7 (a report route under `app/api/*` sits outside `(admin)/layout.tsx`, is directly invocable, and here is unauthenticated by design):

- The token is stored as a **SHA-256 hash** in a new `public.profiles.ics_token_hash` column; the raw value is shown once at issue and never again.
- The route resolves rows **through `user_effective_project_role(project_id)` for the token's owner on every request**, never from a snapshot taken at issue — so a contractor removed from a project stops receiving that project's dates on the next fetch, not when somebody remembers to revoke.
- Membership removal or a role change rotates the token.
- The feed carries **no free text**: each `VEVENT` summary is the kind plus the entity reference (`CoC due — Shop 42`), so a leaked URL exposes dates, not content. Only `statutory` and `contractual` items are included.
- The route is added to `docs/rbac-matrix.md` and, because it introduces a new bearer credential, to `CONFORMANCE.md` in the same PR.

### (f) Deliberately excluded from Q4

| Excluded | Reason |
|---|---|
| Critical-path / Gantt engine, logic links, float, resource levelling | Candy/CCS owns SA programme; WM owns commitments, not the programme |
| Baseline vs actual, earned value, S-curves | requires a baseline nobody in E-Site authors |
| `form_due` as a calendar kind | `field.site_forms` (`00179:69-100`) has no due-date column of any kind, and a form's isolation-event date lives inside a `form_responses` value rather than a column — projecting it would mean parsing template payloads on every calendar read |
| Recurring calendar entries (RRULE, exceptions) | one row per occurrence, created by a "repeat for N weeks" control; an exception model is a fortnight for a few hundred rows |
| Two-way calendar sync (Outlook/Google/CalDAV write-back) | write-back needs conflict resolution and per-user OAuth; the read-only ICS feed delivers most of the value for a fraction of the cost |
| Labour, plant and crew scheduling | Raken/Simpro territory; no demand evidenced in the 53 diary entries |
| Weather-forecast-driven rescheduling | the diary captures actual weather; forecasting a programme E-Site does not own is theatre |
| Candy / MS Project import | no baseline model to import into |
| Auto-rescheduling on slip | nothing downstream is modelled, so a cascade would be fiction |
| Drag-to-move on derived dates | edit the input, not the output |
| Portfolio-level multi-project Gantt | 14 projects, 5 with real data — premature |
| Per-project and per-node lead-time overrides | scope-type and project defaults first; add only when a project demonstrably differs |
| A `lease_signed_on` capture field | no lease-capture surface exists; the column would be null in all 411 tenant rows, exactly like `00169`'s three |

### Cost and schedule

The full inventory of new tables, views, functions and column adds this section introduces is **Appendix A(f), Q4** — `projects.calendar_entries`, `projects.milestones`, the `dated_items` view, `resolve_ball_in_court()`, `tenant_details.bo_confirmed_on`, `tenant_document_revisions.approved_on` / `approved_by`, the four lead-time integers, `profiles.ics_token_hash`, the `tenant_documents.kind` CHECK re-declared with `occupation_cert`, and the drop of `field.inspection_milestones`. The routes are **Appendix A(g)** — `/projects/[id]/calendar` and `/calendar` in `(admin)`, `/portal/[projectId]/delivery` in `(portal)`, `GET /api/calendar/ics` ‡ in `api`. Neither list is restated here. What is unique to this section and appears in no registry: **one shim move** of the working-day engine from `lib/jbcc/` to `packages/shared/src/lib/calendar/`, **one new report kind** (`tenant_delivery`, read policy in Appendix A(d)), and **two notification-type rows** (`order_late`, `milestone_due`, tiers in Appendix A(c)). `docs/rbac-matrix.md` moves in the same PR as every route above; `CONFORMANCE.md` moves with the ICS credential, because it is a new bearer token.

**Three committed Q4 lines, 8.0 engineer-weeks:**

| Q4 line | Contents | Engineer-weeks |
|---|---|---|
| Q4.1 | `dated_items` + `resolve_ball_in_court()`, month / week / per-tenant views, `milestones`, `calendar_entries`, the three-week lookahead, **and the ICS feed at 0.5 of it** | 3.5 |
| Q4.2 | The tenant delivery tracker: three columns, the derived pipeline, the portal surface and the `tenant_delivery` report | 2.5 |
| Q4.3 | Lead-times, the corrected required-by derivation and the late-order digest | 2.0 |

Q4 commits 19.5 engineer-weeks against 20.2 available, leaving 0.7 weeks of float. **None of these three lines sits in Q4's published cut order** — that order is commercial activation, then the portfolio view, then the GCR and cable registrations — so the calendar, the tracker and the lead-times are the quarter's protected core. The one thing this section previously specified without a budget, the ICS feed, is now inside Q4.1 rather than floating.

**Four migrations, in this order. They are ordinals, not migration numbers:**

| Ordinal | Contents |
|---|---|
| 1 | `projects.calendar_entries` + `projects.milestones` + RLS + the four-milestone backfill per existing project; `profiles.ics_token_hash`; drop `field.inspection_milestones` after asserting zero rows, with the Appendix A(f) pre-migration snapshot in the same transaction |
| 2 | `tenant_details.bo_confirmed_on`; `tenant_document_revisions.approved_on` / `approved_by`; `tenant_documents.kind` CHECK re-declared with `occupation_cert`; write policies for all three |
| 3 | `scope_item_types.lead_time_days` / `install_days` with non-zero defaults **and** the seeded `db` (60/5) and `lighting` (30/3) updates; `project_settings.equipment_lead_time_days` / `equipment_install_days` |
| 4 | `projects.resolve_ball_in_court`; `projects.dated_items` (last — it references every column above and `projects.work_items`); the `REVOKE`s and grants; the two `public.notification_types` inserts |

**The ordering is load-bearing and survives arbitration unchanged:** ordinal 4 must be last because the view references every column ordinals 2 and 3 add plus the Q1 work-items spine, and `resolve_ball_in_court` must exist before the view that declares a column over it. §14's Q4 migration table now mirrors this same ordering **as ordinals rather than numbers**, so the two cannot drift into a numbering race with each other.

Numbers are claimed at merge, never in this document (Appendix A(f)). Each is re-checked against `max(version)` **and** `origin/main` immediately before applying — not when the branch is cut — and announced to peer sessions, because `supabase db push` keys on the version prefix and will print "Remote database is up to date", exit 0 and skip the file if that number is already in `schema_migrations`. A green `Deploy DB Migrations` is not evidence a migration ran: every one of the four is verified by reading the affected table, view reloption or grant back afterwards.
