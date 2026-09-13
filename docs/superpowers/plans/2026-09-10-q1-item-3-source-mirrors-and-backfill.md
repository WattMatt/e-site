# Source Mirrors and the Backfill Implementation Plan

> **Reconciled 2026-09-13 against item 2 as shipped (PR #186, `00195` + `00196`, applied 2026-09-12).** The plan was written on 2026-09-10 against item 2's *spec*; item 2 as *built* differs in twenty places (`scratchpad/item3-reconciliation.md`, §1). Every amendment in that reconciliation's numbered list is applied **in place** below — #1 (the guard exemption is item 3's to ship, `> 1`), #2 (project moves ride the exemption; §11 records no event for a move), #3 (`void` is terminal for the mirror too), #4 (historical `opened_at` / `closed_at` / `closed_by` / `void_reason` on every projection INSERT), #5 (item 2's resolvers stay; item 3 adds `resolve_mirror_assignee`), #6 (`suppress_all_outbound` does not exist — owner decision), #7 + #8 (no bells, no GUC consumer yet — assertions kept but marked vacuous), #9 (`product_events.event = 'backfill_completed'`), #10 (`seed_work_item_watchers` deleted — §11 already seeds), #11 + #12 (migration is **`00198`**; real identifiers in `@verify` from the first commit; `-- trigger:` already parses), #13 (impersonated guard probe; claim-clearing rule; `WITH_EXTRA`), #14 (four item-2 fixtures retargeted), #15 (`rfi` registry `gatekeeper_rule` → `'creator'` — owner decision), #16–#20 (stale comment, matrix/CONFORMANCE/A(f) anchors, allocator timing caveat + `ORDER BY`, re-measured counts, the two grant mutations that could no longer fail). Two items are marked `⚠ OWNER DECISION` and are **not** decided here. Line references of the form `00196:1540` are into item 2's migration files as merged at `13ea0c2`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project six existing module sources into `projects.work_items` by database trigger, write assignment and due date back to `projects.rfis` and `field.snags` so every existing reader and PDF keeps working untouched, and back-fill the live estate once — without creating a single work item from `structure.node_orders`, without projecting a diary entry that says "None", and without rewriting `updated_at` on a single live source row.

**Architecture:** One migration (Appendix A(f)'s Q1 **ordinal 9**, file **`00198`**) creates twenty-two functions and twenty-one triggers (thirteen projection, two write-back, six delete-to-void), **`CREATE OR REPLACE`s item 2's `projects.work_items_transition_guard()` with the depth-scoped exemption the mirror needs** (F8), amends one registry row (`rfi` → `gatekeeper_rule = 'creator'`, owner decision), then runs the data backfill in the same transaction under `SET LOCAL esite.suppress_notifications = 'on'`, and records its own completion into `public.product_events` as `event = 'backfill_completed'`. Each source has **two** functions: a plain `projects.project_<type>(uuid)` that does the projection, and a thin trigger wrapper that carries the recursion guard and calls it — so the backfill invokes the projection **directly** and never touches a source row. Source tables stay the system of record for their own content and status; the spine owns assignment, gatekeeper, due date, ball-in-court and the five universal states. Projection is idempotent through item 2's seven partial `UNIQUE` indexes (`work_items_src_rfi_uidx`, `_snag_`, `_qc_`, `_diary_`, `_form_`, `_order_`, `_inspection_uidx`, `00196:371–377`), so triggers land before the backfill and a retry is free. Item 2's resolvers (`00195`'s `resolve_project_pm`, `00196`'s caller-guarded `resolve_work_item_assignee`) are **read, never replaced**; the mirror calls a new `projects.resolve_mirror_assignee(uuid,text,uuid)` that carries no caller guard and excludes `client_viewer`.

**Tech Stack:** PostgreSQL 17 (Supabase project `cbskbnvvgcybmfikxgky`), plpgsql triggers, Supabase Management API `/database/query` for rolled-back rehearsals, vitest contract tests parsing SQL text (the `apps/web/src/lib/snag-photo-type.contract.test.ts` pattern), `tsx` for scripts.

**Spec:** §13 item 3 (Q1, Arno's lane, 1.5 engineer-weeks, off the critical path) · §03 §1.2 (mirrored spine, loop suppression, trigger privileges, delete-to-void) · §03 §1.5–§1.6 (resolution chain, triage) · §03 §1.8 (status, gatekeeper, watchers) · §03 §1.10 (what breaks, and the backfill) · §12 §(c) hard dependency 5 · §12 §(d) (backfills) · §12 §(h) (the eight tests and the fixture-quality rule) · Appendix **A(a)** (the authoritative `work_items` DDL, constraint set and index set), **A(b)** (types, sources, due offsets, calendars, gatekeepers), **A(f)** (the Q1 migration ledger and object inventory), **A(h)** (the working-day calendar).

**Depends on:** **Item 2 (work-item spine) — migrations `00195_work_item_project_settings.sql` and `00196_work_item_spine.sql`, APPLIED to production on 2026-09-12** (ledger `max(version) = '00196'`, post-push verifier 13 + 75 directives green). Merged is not enough; Task 2's gate verifies the objects. Item 6's own migration has **not** shipped — `00195` is item 2's slice of A(f) ordinal 6 and is all this plan needs from it. Concretely this plan reads, and does not create:

| From | Object | Why this plan needs it |
|---|---|---|
| A(f) ord. 1 (`00194`) | `projects.public_holidays`, `projects.calendar_years`, `projects.working_days_between(timestamptz,timestamptz,uuid,text)` | item 2's `due_date` trigger raises `no_data_found` without a seeded year (seeded to 2035) |
| A(f) ord. 1 (`00194`) | `public.product_events` (columns `occurred_at, actor_id, project_id, organisation_id NOT NULL, event, effective_role, session_id, properties`). **`event` is a fixed CHECK vocabulary** (`00194:231–238`): `rfi_created, rfi_responded, rfi_closed, snag_resolved, project_created, project_deleted, marketplace_order_placed, onboarding_started, backfill_completed` | section I writes the completion row as **`event = 'backfill_completed'`** with `properties->>'migration'` naming this file (F11). A free-text event name aborts the whole migration with `23514` |
| A(f) ord. 6, item 2's slice (`00195`) | `projects.project_settings.work_item_defaults`, `.triage_owner_id`, `.builders_shutdown_start_md`, `.builders_shutdown_end_md` — **four columns only** (`00195:63–67`). `suppress_all_outbound`, `enabled_modules`, `client_comments_enabled` do **not** exist | the resolution chain. The outbound-mail gate §12 §(d) names is an **owner decision** in Task 20 Step 5 |
| A(f) ord. 6 (`00195`) | `projects.resolve_project_pm(uuid)` — project PM → org PM → org admin → org owner → `created_by`, **every arm validated** through `user_effective_project_role`, NULL only for an orphaned project (`00195:118–129, 163–185`) | the PM step of the mirror chain and the gatekeeper default. **Read, not redefined** (F3) |
| A(f) ord. 7 (`00196`) | `projects.resolve_work_item_assignee(uuid,text,uuid)` — carries a **caller-access guard** (`00196:861–863`: NULL when `auth.uid()` is non-NULL and lacks `user_has_project_access`), RAISES one sentence for an orphaned project (`901–902`), granted to `authenticated`, **admits `client_viewer`** by decision (`911–913`) | the people-picker's function. **Not called by the mirror** — inside the source writer's session the caller guard returns NULL for an org member with no `project_members` row, and the RFI insert would abort on `assignee_id NOT NULL`. The mirror calls `resolve_mirror_assignee` (Task 3) |
| A(f) ord. 7 (`00196`) | `projects.work_items` with A(a)'s full constraint set (`work_items_one_source`, `work_items_source_required`, `work_items_bic_present`, `work_items_ref_unique`, `00196:335–353`), the `ref` allocator (§6, per-(project,type) advisory lock + `MAX(suffix)+1`), the `due_date` `BEFORE INSERT` trigger (§5 — **stamps `opened_at := now()` only for a client session and keeps a supplied value on the service path**, `00196:629–636`), the assignee-membership trigger (`work_items_assert_membership_trg`, fires **before** the guard by name order), and the `work_item_events` append trigger (§11 — dates `created` at `NEW.opened_at`; **seeds `work_item_watchers`**; writes **no** bell and reads **no** GUC) | the whole spine |
| A(f) ord. 7 (`00196`) | `projects.work_items_transition_guard()` (§12) — exempts **only** `auth.uid() IS NULL` (`00196:1540–1549`); no `pg_trigger_depth` anywhere; its own comment (`1590–1605`) names `pg_trigger_depth() > 1` as the bypass item 3 must carry and says item 3 adds `source_status` to clause (a) | **Item 3 REPLACES this function** (Task 5½, F8). Without the replacement every mirror `UPDATE` in a signed-in session is refused by clause (a) / (a2) / (b) / (c) / (d) and the refusal surfaces on the *source* edit |
| A(f) ord. 7 (`00196`) | `projects.work_item_types` with the six mirrored A(b) keys registered; `gatekeeper_rule` CHECK vocabulary `('project_pm','verifier_else_pm','creator')` (`00196:202`); the `rfi` row seeded with `'project_pm'` (`00196:239`) | `item_type` is an FK to it. Improvement 4 makes the registry row truthful with an `UPDATE` (owner decision, Task 5½) |
| A(f) ord. 7 (`00196`) | `projects.work_item_watchers` with **PK `(work_item_id, user_id)`** (`00196:450`) and a `reason` CHECK that admits `'creator'`, `'assignee'`, `'gatekeeper'`, `'raiser'` | §11 seeds `created_by`, assignee and gatekeeper on INSERT and on every people change (`00196:1378–1387, 1410–1424`). **Item 3 seeds nothing** (#10) |
| A(f) ord. 7 (`00196`) | Seven partial `UNIQUE` indexes, `WHERE <col> IS NOT NULL AND origin = 'mirror'`: `work_items_src_rfi_uidx`, `work_items_src_snag_uidx`, `work_items_src_qc_uidx`, `work_items_src_diary_uidx`, `work_items_src_form_uidx`, `work_items_src_order_uidx`, `work_items_src_inspection_uidx` (`00196:371–377`) | the `ON CONFLICT` target that makes projection idempotent |
| A(f) ord. 7 (`00196`) | `ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON TABLES FROM anon` (`00196:1310`) and **no function default ACL** in `projects` (measured by item 2) | a table created after `00196` is **not** born anon-readable, and a new `projects` function's `anon` EXECUTE is Postgres's built-in PUBLIC grant — `REVOKE … FROM PUBLIC` alone strips it. The plan keeps both revokes belt-and-braces; Tasks 13/14's mutation proofs are shaped accordingly (#20) |

**Not depended on, and worth saying:** `public.notification_types` and a `work_item_assigned` type do not exist; item 2 writes no notification and item 4 adds the emit and the `esite.suppress_notifications` guard to §11 by `CREATE OR REPLACE` (`00196:1354–1356`). The `SET LOCAL` in section H is kept because it is the exact GUC item 4 will honour; the two "no bells" assertions are **vacuous today** and say so (#7, #8).

**`auth_events.session_id` is NOT in this plan.** A(f)'s ordinal-9 sentence books it here; §12 §(c) line 121 books it with the metrics migration ("a column add on an existing table and it rides with that migration too"). §12 §(c) is the later and more specific ruling and this plan follows it. Task 18 Step 5 amends A(f) so the two stop disagreeing.

---

## ⛔ Blocking precondition — read before Task 1

**The only test surface in this plan is a rolled-back transaction against production.** There is no local Postgres in this repository's test loop and no pgTAP. That means:

> **Nothing below Task 2 is executable until A(f) ordinals 1 and 7, and ordinal 6's item-2 slice (`00195`), are APPLIED TO PRODUCTION.** As of 2026-09-13 they are: `00194` (item 1), `00195` + `00196` (item 2, PR #186) are in `supabase_migrations.schema_migrations` and the post-push verifier passed. **Verify, do not assume** — Task 2 Step 2 checks for the *objects* (`projects.work_items`, `00195`'s four columns, the six types, the watchers PK, `product_events` with `'backfill_completed'` in its vocabulary, and the guard function this plan replaces), not for a window.

Task 2 Step 2 is the gate that measures this. If it fails, stop: write the blocker down (the likeliest cause is a rollback or a diverged branch, not an unapplied item), do not "work around it" by stubbing the spine, and do not proceed to Task 3.

The harness's `--with` flag is **repeatable** (Task 1) so that this migration — and, for the guard mutation in Task 5½, a scratch copy of part of `00196` — can be stacked ahead of a probe. That is a development convenience only. **Acceptance — every mutation verification, the full rehearsal, the scale run — is against production with item 2 really applied.** Item 2's own regression suite (`scripts/db/assertions/*.sql`, ten files, run by `scripts/db/try-work-item-spine.sh`) must also stay green with `00198` stacked (Task 5½ Step 7, Task 15 Step 6) and after apply (Task 20 Step 8).

---

## Improvements folded in

Twelve changes came out of the product review and are built into the tasks below as real code, not as notes. Each was measured against production on 2026-09-10.

| # | Change | Task | Why it is in, not deferred |
|---|---|---|---|
| 1 | **Diary negation stop-list, and the diary backfill projects nothing.** `projects.diary_delay_text()` returns NULL for `none / none. / none, / no / n/a / na / nil / nothing / - / 0`; the backfill arm is dropped entirely | 10, 14 | All **6 of 6** live "delays" are negations: `"None"`, `"None,"` ×2, `"None"`, `"NO"`, `"No delays or info required was noted in the site walk and or meeting"`. The predicate measured whether a text box was filled, not whether a delay happened. Shipped as written, day one puts six items titled `Delay 2026-06-24: None,` in the owner's inbox |
| 2 | **The E-Site DEMO organisation is excluded from every backfill arm** (`e51ede00-0000-0000-0000-000000000001`) | 14 | All **6 of 6** snags are seeded demo rows: identical `created_at` of 2026-07-06, all raised by `Sipho Dlamini (Demo Contractor)`, on a project whose creator resolves to `contractor`. Backfilling them puts six fabricated defects on a demo contractor's ball-in-court and pollutes metric 2a's numerator with a fixture account. The snag spine goes live **empty**; the live trigger still works |
| 3 | **The day-one distribution is asserted by person and published before apply** | 14, 17, 19 | A type-count probe passes cleanly against a distribution that fails the product. §15's own diagnostic: "an empty inbox cannot be driven to zero, and neither can a forty-item one" |
| 4 | **The RFI gatekeeper is the raiser, not the project PM** — and the registry row says so: `UPDATE projects.work_item_types SET gatekeeper_rule = 'creator' WHERE key = 'rfi'` plus the TS mirror in `packages/shared/src/work-items/types.ts` (**owner decision**, recorded in Task 5½) | 5, 5½, 18 | 13 of 14 projects were created by the same person, so `triage_owner_id` and the PM resolver both return him; assignee and gatekeeper would be the same person on all 15 RFIs and §03 §1.8's "only the gatekeeper may close" would be vacuous for the type that matters most. 12 of 15 RFIs were raised by contractors. This is the only mechanism in Q1 that puts an item in a contractor's ball-in-court. Item 2 seeded the row as `'project_pm'` (`00196:239`); the mirror sets `created_by = raised_by`, so `'creator'` is the truthful value and items 4–6 read `gatekeeper_rule` (#15) |
| 5 | **Location goes into the snag title; the parent report goes into the `qc_defect` title** | 7, 9 | **6 of 6** live snags carry a location (`Floor 7 — DB Room`, `Basement — MCC Panel`, `Levels 3–5 — Steel`) and **0 of 6** carry a floor-plan pin. The title is all that travels into the 07:00 recap |
| 6 | **A projected item may never arrive already overdue** — `projects.work_item_mirror_due_date()` passes a past source date through as NULL so item 2's trigger computes the type's own offset on the type's own calendar | 5, 8 | Live RFI due dates are 0–3 calendar days after creation (`Drawings`: created **and due** 2026-07-23). **15 of 18** inspections have `scheduled_at` in the past. The backfill already floors history for this reason; the live path must too |
| 7 | **`client_viewer` is excluded from every step of the mirror's resolver**, `projects.resolve_mirror_assignee` (Task 3). Item 2's people-picker resolver `resolve_work_item_assignee` **still admits them by decision** (`00196:911–913`) and is left alone; the divergence is recorded in the matrix (Task 18) | 3 | Every step of the spec chain accepted any candidate with a non-null effective role, and all **4** live `client_viewer` accounts pass that test. §03 §1.9 defers their write set to Q3, and `work_items_bic_present` keeps the row pointing at them — an inbox that can never reach zero |
| 8 | **Every mirror trigger watches `project_id` and `organisation_id` and re-resolves people on a move** | 5–11, 5½ | §15's rollout section has already decided "snags move to KINGSWALK". As written the item stays on the demo project forever: wrong counts on both project homes, wrong SELECT scope, an assignee resolved against a project they are not a member of. ⚠ Clause (a) of item 2's guard makes `project_id` / `organisation_id` immutable for any signed-in actor (`00196:1578–1588`) — the move is only possible because Task 5½'s replacement guard exempts trigger-driven writes. The membership trigger still re-validates both people on a move (`00196:961–984`), so a move to a project the people are not on reports the **membership** sentence (pinned by `work-item-transition.sql` 5b / `work-item-membership.sql` 3b). §11 records **no event** for a move: the feed shows a project change only through the people/status events beside it (#2) |
| 9 | **The write-back skips `closed` and `void` records; the due-date floor skips them too** | 6, 14 | **6 of 15** RFIs are already closed. Stamping `assigned_to` on them makes the RFI page render "Assigned to: Arno Mattheus" on a record nobody was ever assigned — the site-forms `as_left_status` lesson exactly |
| 10 | **Projection goes through `projects.project_<source>(uuid)`; the backfill never runs `UPDATE … SET status = status`** | 5–11, 14 | Every one of the six source tables carries a `BEFORE UPDATE set_updated_at` trigger (verified in `pg_trigger`). A no-op UPDATE rewrites `updated_at` on ~40 live rows (RFI `updated_at` currently spans 24 Jun – 2 Sep) with no snapshot. It also makes the site-form arm depend on `current_user = 'postgres'` escaping `enforce_site_form_transition` (`00179:353`) |
| 11 | **`due_date` is written back to `projects.rfis`, not only `assigned_to`** | 6 | §04 makes re-dating a first-class keyboard verb and §03 §1.6 one of triage's three actions. Without this the RFI page, the RFI PDF and the Inbox give three answers to "when is this due", on the module carrying headline metric 4 |
| 12 | **A human confirms the fourteen resolved triage owners before the backfill runs** | 19 | `resolve_project_pm` takes the **oldest** active `project_manager` row. SAXBY has 4 such rows, PNP FAERIE GLEN 4, KINGSWALK 3 — so on the three densest projects the recipient of every unowned item is decided by membership creation order, invisibly |

## Deferred improvements

| Improvement | Recommendation | One-line reason |
|---|---|---|
| **`order_followup` has no producer anywhere in Q1** — A(b) registers the type with "explicit chase only, one control on the order line", and no Q1 deliverable builds that control, so a live module with 440 rows contributes nothing to any inbox for the whole quarter | **later-quarter** (Q4, beside `lead_time_days`) | A UI control + server action + rbac-matrix row + notification path is not free, Arno's lane has 0.5 weeks of float, and item 3 is third on the cut list; the phone shell is worth more to the quarter's stated outcome |
| **Seed `client_viewer` project members as watchers on every mirrored item** | **reject** | Reproduces the fan-out that made 750 of 964 notifications `diary_created` at a 5.9% read rate, and A(c) puts those types on the Recap tier — so a client would get a 07:00 email listing work they hold no verb over until Q3. §04 is explicit that the portal's job is "since your last visit", not a second inbox |
| **A "why is this mine?" explainer on the item, showing which resolver step chose the holder** | **q1-separate-item** (fold into item 4's Inbox row if it is cheap there) | Real value once 34 items land on four people, but it is an Inbox-surface change and this item ships no UI |

---

## Eleven measured findings that correct the spec. Read these before Task 1.

Each has a task that implements it and a test that fails when it is undone. Do not "simplify" any of them back to what the spec text says. F1–F6 were proved against production on 2026-09-10 inside rolled-back transactions; F7–F10 are corrections raised in review and re-derived here against the real tree and A(a)'s authoritative DDL; F3, F5 and F8 were **re-derived on 2026-09-13 against item 2 as shipped** and read differently from the 2026-09-10 text; F11 is new from that reconciliation.

**F1 — the delete-to-void trigger must be `BEFORE DELETE`, and with `AFTER DELETE` the DELETE does not merely orphan the item, it *fails*.** §03 §1.2 says "an `AFTER DELETE` trigger on each source sets the orphaned item `status = 'void'`". The `ON DELETE SET NULL` referential action runs *before* a user `AFTER DELETE` trigger, so the `AFTER` form's `UPDATE … WHERE rfi_id = OLD.id` matches nothing. But A(a)'s `work_items_source_required` — `item_type IN ('task','approval') OR status = 'void' OR <exactly one source FK non-null>` — is re-evaluated on the RI `SET NULL` update, and at that moment the item is still `status='open'` with zero sources. **The DELETE therefore aborts with `23514 … "work_items_source_required"`.** Consequence: with `AFTER DELETE`, `deleteDiaryEntryAction` (`apps/web/src/actions/diary.actions.ts:109`) and every RFI and snag delete break outright once a mirror item exists. With `BEFORE DELETE` the item is already `void` when SET NULL fires, both that CHECK and `work_items_bic_present` pass on their `void` arms, and the delete proceeds. ⚠ **An earlier probe of this reported a silently-orphaned open item; that probe ran against a synthetic table lacking the CHECK and its result is withdrawn.** Task 12 Step 5 measures the real thing against item 2's table and records the SQLSTATE. Task 12.

**F2 — the write-back trigger must NOT carry the `pg_trigger_depth() > 1` guard.** §03 §1.2 says "every trigger function returns immediately when `pg_trigger_depth() > 1`". Applied uniformly that is measurably wrong. Probe with the uniform rule: `src.assigned_to` stays `<null>` while the work item says `TRIAGE-OWNER` — the exact "the RFI page renders nothing" failure the write-back exists to prevent. Probe with the guard on the mirror only: both converge, trace `mirror@1 → writeback@2 → mirror@3 → skipped`. The depth guard on the **mirror** is what terminates the cycle; removing only the value-difference check still terminates. Removing both produces `ERROR: 54001: stack depth limit exceeded`. Task 6.

**F3 — the resolution chain terminates at `projects.projects.created_by`, validated; an orphaned project RAISES, and that is item 2's contract, not this plan's to change.** §03 §1.6 and §12 §(d) both say every chain "terminates at the org owner". Measured: of 14 projects the §03 §1.5 four-step PM rule resolves 13 and returns **NULL** for `Sandton City Office Tower — DB Upgrade (Demo)`, whose organisation (`E-Site DEMO`, `e51ede00-…-0001`) has **no owner, no admin and no project_manager** — only a `contractor` and a `client_viewer`. Item 2 shipped the fifth step in `00195`'s `resolve_project_pm` (`00195:183–184`) — but **every arm, `created_by` included, is validated** through `user_effective_project_role` (the CONTRACT at `00195:118–129`): the chain returns NULL only for a project none of whose PM / creator / org roles still holds an effective role, and the caller must raise one actionable sentence. On the demo project `created_by` resolves to a user whose effective role is `contractor`, so the chain resolves there today and the demo project's snag insert works. ⚠ **Accepted consequence, recorded rather than hidden:** on that project the gatekeeper is a contractor — plausibly the same person who raised the snag, which §03 §1.5 forbids for snags. Improvement 2 removes the demo project from the backfill so no live item is created that way. **This plan does not redefine `resolve_project_pm` or `resolve_work_item_assignee`** — replacing either turns three of item 2's regression files red (`work-item-settings.sql:186`, `work-item-rls.sql` 11f, `work-item-membership.sql:271–280`). It adds `projects.resolve_mirror_assignee`, which delegates to `00195`'s PM chain and raises item 2's sentence (`This project has nobody who can own work — add a project manager to it first.`) when that returns NULL. Task 3.

**F4 — `qc_defect` back-fills ZERO rows today, and its projection needs a trigger on `projects.qc_reports` as well as on `projects.qc_entries`.** The brief's "11 qc_entries" counts entries on issued/closed reports, not failed ones. Measured: `SELECT conformance, severity, report_status, count(*)` over the join returns exactly one group — `{conformance:"na", severity:null, report_status:"issued", count:11}`. **`conformance='fail'` has zero rows in the whole database.** So a fixture drawn from live data could never fail; Task 14 builds a synthetic one. Separately, the entry-level trigger alone can never bring a row into scope: an entry is authored while its report is `draft` and enters scope when the **report** transitions to `issued` — an `UPDATE` on `qc_reports`. Task 9.

**F5 — trigger functions need `REVOKE`, and no `GRANT` at all — and in `projects` the leak is PUBLIC's grant, not a direct `anon` one.** Measured in a throwaway schema: a trigger fired for a caller holding no `EXECUTE` on its function (`{trigger_fired:1, auth_execute:false, anon_execute:false}`). Function privileges on a trigger function are checked at `CREATE TRIGGER` time, not at fire time. Every function here is called only from inside a trigger or from another `SECURITY DEFINER` function owned by the same role, so the correct posture is `REVOKE ALL … FROM PUBLIC` plus an explicit `REVOKE … FROM anon`, and `GRANT` to nobody. ⚠ **Corrected 2026-09-13 (#20):** item 2 measured `pg_default_acl` for `projects` and found **no function default** — unlike `public` (`00113`), a new `projects` function's `anon` EXECUTE is Postgres's built-in PUBLIC grant, which `REVOKE … FROM PUBLIC` alone strips; and `00196:1310` ran `ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON TABLES FROM anon`, so a table created after `00196` is **not** born anon-readable. Both revokes are kept (belt-and-braces, and the `grant_absent:` lines stay true), but the mutation proofs in Tasks 13 and 14 are shaped so they can actually go red: drop the `FROM PUBLIC` line, not the `FROM anon` one; `GRANT` the snapshot table to `anon` and prove the revoke removes it. Task 13.

**F6 — idempotency needs an explicit partial-index conflict target, and a bare `ON CONFLICT DO NOTHING` is dangerous.** Measured: an explicit `ON CONFLICT (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror' DO NOTHING` swallows a duplicate mirror projection, leaves a deliberate `origin='split'` row on the same source untouched, **and still raises `23505 … "work_items_ref_unique"` on a `ref` collision** — which a bare `ON CONFLICT DO NOTHING` would have silently swallowed, turning a numbering race into a missing inbox item. `work_items_ref_unique` is A(a)'s name and is the one to match on. The per-source partial indexes are named in `00196:371–377` — `work_items_src_rfi_uidx`, `work_items_src_snag_uidx`, `work_items_src_qc_uidx`, `work_items_src_diary_uidx`, `work_items_src_form_uidx`, `work_items_src_order_uidx`, `work_items_src_inspection_uidx` — and those names go into the PR body directly; Task 15 Step 3's query only confirms them. Task 5.

**F7 — §03 §1.2's mandated trigger declaration is not valid PostgreSQL, so each source gets TWO triggers.** §03 §1.2 line 49 is normative: "declared `AFTER INSERT OR UPDATE … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col>)`". PostgreSQL rejects a `WHEN` clause referencing `OLD` on a trigger whose event list includes `INSERT` (`ERROR: 42P17: INSERT trigger's WHEN condition cannot reference OLD values`). The intent — never fire on an unrelated write — is honoured by splitting each source into `<table>_mirror_work_item_ins` (`AFTER INSERT`, no `WHEN`) and `<table>_mirror_work_item_upd` (`AFTER UPDATE OF <cols>` with the mandated `WHEN`). Thirteen projection triggers result: six sources × 2, plus `qc_reports_mirror_defects`. **This is also why the backfill cannot use a no-op `UPDATE`**: with the `WHEN` predicate in place, `UPDATE … SET status = status` fires nothing at all. Improvement 10's `project_<source>(uuid)` functions are what the backfill calls instead. Tasks 5–11, 14. Spec corrected in Task 18.

**F8 — the mirror's own writes must be exempted from item 2's transition guard, and ITEM 3 SHIPS THAT EXEMPTION in its own migration by replacing the guard.** The mirror is `SECURITY DEFINER`, but inside it `auth.uid()` is still the contractor who changed the source row, and item 2's `projects.work_items_transition_guard()` (`00196:1509–1759`) exempts **only** `auth.uid() IS NULL` (`1540–1549`) — there is no `pg_trigger_depth` anywhere in `00196`. Every mirror `UPDATE` in a signed-in session is therefore refused: clause (a) on a project move, (a2) on every title re-projection of a mirrored row, (b) on a re-resolved assignee or a forward-assigned inspection, (c) on `triage→answered` when a contractor responds to an untriaged RFI, (c2)/(d) on a close by anyone but the gatekeeper, and the void-reason check — each surfacing as a `P0001` **on the source edit** (a PM renaming an RFI; a contractor closing one). Item 2's own comment (`1590–1605`) names the bypass: **`pg_trigger_depth() > 1`** — "a client statement is always depth 1, a trigger-driven UPDATE never is" — and says item 3 adds `source_status` to clause (a) under that same bypass. ⚠ The 2026-09-10 text said `> 0`; that would exempt **every** direct client `UPDATE` (a top-level statement's trigger runs at depth 1) — i.e. disable the guard. Task 5½ `CREATE OR REPLACE`s the function byte-identical to `00196 §12` except the early return (`IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN`) and `source_status` in clause (a), re-revokes it from PUBLIC/`anon`, declares it (`function:` + a `sql:` directive proving the exemption text), and proves it **under impersonation** (probe 05b): a contractor's `UPDATE rfis SET status='responded'` on an untriaged mirror succeeds, and the same contractor's direct `UPDATE work_items SET title=…` on the mirror row is still refused with "mirrored from its source record". Probe 04 runs as `postgres` (service path) and **cannot** see the guard; it is not F8's evidence. Task 5½, Task 16.

**F9 — the Management API `/database/query` endpoint runs as `postgres` with `rolbypassrls = true` and `auth.uid()` NULL** (measured 2026-09-10). Every probe in this plan therefore executes with RLS bypassed and no identity, which means **no probe can fail on an authorisation defect** unless it deliberately assumes one. Applying the fixture-quality rule: remove `SECURITY DEFINER` from every mirror and every probe in the original plan still passed. Task 16 adds the one probe that runs as a real non-privileged user and can see the difference. This is also why the migration is safe to apply through `db push` (also `postgres`) and why the site-form arm of the old backfill "worked".

**F10 — `field.site_forms.created_by` is `UUID NOT NULL DEFAULT auth.uid()` (`00179:83`), so `NEW.created_by IS NOT NULL` is a tautology.** Decided rather than left ambiguous: a site form **is** the thing its author must finish, so its author is an explicit assignee and the item is born `open`, not `triage`. The tautological predicate is replaced with a literal `true` and a one-line reason, and probe 10 asserts `= 'open'` rather than `IN ('triage','open')` so the decision is pinned. Task 11.

**F11 — `public.product_events.event` is a fixed vocabulary, not free text.** `00194:231–238` declares `event text NOT NULL CHECK (event IN ('rfi_created', …, 'backfill_completed'))`. The 2026-09-10 text wrote `'work_item_backfill_completed'`, which aborts the whole migration with `23514` at section I. The completion row is `event = 'backfill_completed'` with `properties.migration = 'work_item_source_mirrors_and_backfill'`, and every filter — the post-check, probe 13, Task 20 Step 8 — reads `event = 'backfill_completed' AND properties->>'migration' = '…'`. The INSERT stays direct (`project_id` is nullable, `occurred_at` defaults); it must **not** go through `emit_product_event`, which raises on an absent project. Task 14.

**Historical stamps on every projection INSERT (#4).** `opened_at` defaults to `now()` (`00196:303`); §5 overwrites it **only** for client sessions (`629–636`) and keeps a supplied value on the service path "for item 3's historical mirrors"; §11 dates the `created` event at `NEW.opened_at` (`1366–1376`); the guard keeps a caller-supplied `closed_by` on the service path (`1540–1547`), makes `opened_at` immutable afterwards (`1584`), and the void-reason check fires on **any** signed-in UPDATE of a void row (`1745–1755`). So every projection INSERT supplies `opened_at = <src>.created_at`, `last_activity_at = <src>.updated_at`, and for a terminal mapping `closed_at` / `closed_by` from the source's own stamps and `void_reason = COALESCE(NULLIF(btrim(<src reason>), ''), '<type> voided at source')`. On the live path §5 overwrites the two timestamps with the same instant (harmless); on the backfill they are kept — otherwise all 34 backfilled items date their `created` event in the apply week of metric 5's denominator, the six born-closed RFIs carry NULL `closed_at`/`closed_by` (metric 7 and the feed lie), and a born-void inspection fails its first signed-in source delete with "Dropping … needs a short reason". Tasks 5, 7–11, 14.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql` | **Create.** The whole item, in one file, in ten lettered sections: (A) `-- @verify:` header and pre-flight assertions, (B) the mirror resolver + helpers, (C) status mapping, due-date and diary-delay helpers, **(C′) amendments to item 2's objects — the `CREATE OR REPLACE` of `projects.work_items_transition_guard()` with the depth-scoped exemption, the `rfi` registry `gatekeeper_rule` update (owner decision), and the `suppress_all_outbound` column if the owner takes option (a) (owner decision)**, (D) the six `project_<source>()` bodies plus seven trigger wrappers and thirteen triggers, (E) the assignment + due-date write-back, (F) the six `BEFORE DELETE` void triggers, (G) grants and `anon` revokes, (H) the pre-migration snapshot and the backfill under notification suppression, (I) the backfill-completion `product_events` row(s) and post-conditions. **The number is `00198`, claimed at Task 2** (ledger max `00196`; open PR #185 holds `00197`) and **re-checked at Task 20** against the ledger, `origin/main` and open PRs. Twenty-two functions created, one replaced. ⚠ Every identifier in the `@verify` block must be a bare identifier from the first commit — `parseVerifyBlock` throws "is not a bare identifier" on `<NNNNN>` (`verify-header.ts:90,103`), and the hygiene test scans every file `>= '00185'` (`migration-verify-block.contract.test.ts:30–34`), so a placeholder name makes `pnpm --filter web test` red from Task 2 onward. The snapshot table is `projects.backup_00198_source_assignees` from the start. (The reconciliation suggested placing the guard replacement "between F and G"; it is placed between C and D instead so Task 5½ can insert it before Task 6 without splitting section D.) |
| `scripts/db/rehearse-sql.ts` | **Create.** The harness every probe in this plan runs through: concatenates `BEGIN;` + one or more `--with` files + a probe file + `ROLLBACK;` into one Management-API request, prints the assertion rows, refuses any input containing `COMMIT`, and **fails when no assertion rows come back**. Reads `SUPABASE_PAT`, falling back to `SUPABASE_ACCESS_TOKEN` (the name `scripts/db/mgmt-api.sh` uses). |
| `scripts/db/try-work-item-spine.sh` | **Modify.** Item 2's harness for its ten assertion files (stacks `00195` + `00196` + one RAISE-style file, returns no rows). Gains `WITH_EXTRA=<file>[:<file>…]`, stacked after `00196` and before the assertion file, so item 2's suite runs with `00198` on top (Task 5½ Step 7, Task 15 Step 6). Note `. scripts/db/mgmt-api.sh` turns `set -euo pipefail` on in the sourcing shell and `mgmt_query` exits **5** on an API error. |
| `scripts/db/assertions/work-item-ddl.sql`, `work-item-events.sql`, `work-item-transition.sql` | **Modify.** Four fixtures (`ddl:119,123`, `events:111`, `transition:155,183`) insert `origin='mirror'` rows against **live** `projects.rfis` ids. After `00198` applies every non-demo RFI carries a backfilled mirror and `work_items_src_rfi_uidx` allows one, so the suite goes red with `23505` on the day item 3 lands. Retargeted to a throwaway RFI the fixture creates itself (Task 15 Step 6). |
| `scripts/db/probes/*.sql` | **Create.** One assertion file per task — the executable tests. Committed, because they are the regression suite for a layer vitest cannot reach. Every probe has exactly **one** row-producing statement, and it is the last one; every probe that impersonates ends by clearing the claim and asserting `auth.uid() IS NULL` (Task 1). |
| `packages/shared/src/work-items/types.ts` | **Modify (owner decision, Task 5½).** `WORK_ITEM_TYPES`'s `rfi` entry `gatekeeperRule: 'project_pm'` → `'creator'`, in the same commit as the registry `UPDATE`, or `work-item-types.contract.test.ts` (item 2's per-key registry-equality test) fails. |
| `apps/web/src/lib/work-items/source-status-map.contract.test.ts` | **Create.** Parses each source table's own status `CHECK` out of its migration — anchored on `CREATE TABLE <schema>.<table>`, never on the first CHECK in the file — and asserts `projects.map_source_status` carries an arm for every value; asserts every non-null result is a member of the `work_items` status `CHECK`. |
| `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts` | **Create.** Asserts F1 (every void trigger is `BEFORE DELETE`), F2 (every `project_<source>` wrapper carries the depth guard; the write-back does not), F7 (every source has an `_ins` and an `_upd` trigger and the `_upd` carries a `WHEN`), that the diary stop-list exists, and that no trigger anywhere names `structure.node_orders`. |
| `docs/rbac-matrix.md` | **Modify.** New subsection **after `### Work items (\`work-items.actions.ts\`)` (~L496) and before `## Public / unauthenticated` (~L530)** — item 2 added the Work items subsection, so the 2026-09-10 anchor ("after Site forms") is stale — recording that a work-item reassign or re-date now writes source columns through a `SECURITY DEFINER` trigger that bypasses those tables' RLS, that the mirror's resolver excludes `client_viewer` while item 2's picker resolver admits them, and that the guard's exemption is depth-scoped. |
| `CONFORMANCE.md` | **Modify.** New row under `## C. Provisioning & database`, per the file's own same-PR rule. Item 1 took **C11** and item 2 took **E9** (`CONFORMANCE.md:86`); the next C id is expected to be **C12** but is **re-read at Task 18**, never assumed. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` | **Modify.** A(f)'s Q1 row **already lists** `resolve_project_pm()`, `resolve_work_item_assignee()`, `user_can_*` and item 2's trigger functions (`:331`, `:350`); it gains **only the new names** — the twenty-two functions, `resolve_mirror_assignee()` among them, and `backup_00198_source_assignees`; A(f)'s ordinal-9 sentence gains `qc_reports` and loses `auth_events.session_id`; A(b)'s `rfi` gatekeeper cell changes to the raiser (owner decision, with the registry `UPDATE`). |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/03-work-items.md` | **Modify.** §1.2 corrected: `BEFORE DELETE`, and the two-trigger declaration that PostgreSQL actually accepts. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/12-data-model-and-migrations.md` | **Modify.** §(c) hard dependency 5 gains the `qc_reports` entry point; §(d)'s RFI chain gains `default_rfi_assignee_id`'s real position. |

---

## Task 1 — The rehearsal harness

There is no local Postgres in this repository's test loop and no pgTAP. The house pattern since PR #135 is a rolled-back transaction against production through the Management API, and every task below runs its test that way. Build the harness first so "watch it fail" is a real command from Task 2 onward.

**Probe file contract, enforced by the harness.** Every probe file is:
1. Zero or more `DO $…$ … END $…$;` blocks that build fixtures, perform mutations, and record observations into `TEMP TABLE … ON COMMIT DROP`; then
2. **exactly one** row-producing statement — a `SELECT … UNION ALL …` with the columns `probe text, ok boolean, detail text` — and it is the **last** statement in the file;
3. **if it impersonates** (`set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE authenticated`), it ends the impersonating block with `EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true);` and carries an assertion that `auth.uid() IS NULL` afterwards. ⚠ `set_config(…, true)` is **transaction-local, not block-local**: after `RESET ROLE`, `auth.uid()` still returns the last impersonated user (measured by item 2; `work-item-transition.sql:24–35`), which flips §5's `opened_at` stamp, `resolve_work_item_assignee`'s caller guard and the guard's service-path exemption for every later `postgres` block in the same transaction — including the assertion `SELECT`. Production's `auth.uid()` reads the legacy `request.jwt.claim.sub` first, then `request.jwt.claims::jsonb->>'sub'`; clearing the second to `''` makes both arms NULL. Seed everything a `postgres` block needs **before** the first impersonation.

The Management API returns rows from the **last row-producing statement only**. Measured: `SELECT 1 AS first_sel; SELECT 2 AS second_sel;` returns `[{"second_sel":2}]`. A probe that ends in a `DO` block, or that concatenates two assertion `SELECT`s, silently discards assertions — which is why the harness fails on zero rows and on rows without the three columns.

**Two harnesses, two contracts, both valid.** Item 2's `scripts/db/try-work-item-spine.sh` stacks `00195` + `00196` + one RAISE-style assertion file and expects **no rows** (a failure is a `RAISE`); this plan's `rehearse-sql.ts` expects `(probe, ok, detail)` rows. Do not merge the two; Task 5½ extends item 2's with `WITH_EXTRA` so its ten files can run with `00198` stacked.

**Files:**
- Create: `scripts/db/rehearse-sql.ts`
- Test: `scripts/db/probes/00-harness-selftest.sql`

- [ ] **Step 1: Confirm the credential path works.** The Management API PAT lives in the macOS keychain; `scripts/db/mgmt-api.sh:21–33` (`_get_pat`) is the house decoder (env `SUPABASE_ACCESS_TOKEN` first, else keychain with the `go-keyring-base64:` prefix stripped) and `scripts/import-templates-to-staging.ts:6` establishes `SUPABASE_PAT` as the TS-side env-var name. Either works; the harness accepts both.
  ```bash
  RAW=$(security find-generic-password -s "Supabase CLI" -w)
  if [[ "$RAW" == go-keyring-base64:* ]]; then
    export SUPABASE_PAT=$(echo "${RAW#go-keyring-base64:}" | base64 -d)
  else export SUPABASE_PAT="$RAW"; fi
  echo "${SUPABASE_PAT:0:4} len=${#SUPABASE_PAT}"
  ```
  Expected: `sbp_ len=44`. ⚠ `. scripts/db/mgmt-api.sh` runs `set -euo pipefail` in the sourcing shell, and `mgmt_query` exits **5** (not 1) on an API error — relevant when a shell loop wraps it.

- [ ] **Step 2: Write the self-test probe first, and make it a failing one.** Create `scripts/db/probes/00-harness-selftest.sql`:
  ```sql
  -- Deliberately failing assertion. Step 4 flips it.
  SELECT 'harness'         AS probe,
         (1 = 2)           AS ok,
         'expected true'   AS detail;
  ```

- [ ] **Step 3: Write the harness.** Create `scripts/db/rehearse-sql.ts`:
  ```ts
  /**
   * rehearse-sql.ts — run SQL against production inside a transaction that is
   * ALWAYS rolled back, and print the assertion rows.
   *
   * Usage:
   *   SUPABASE_PAT=… pnpm tsx scripts/db/rehearse-sql.ts <probe.sql> [--with <a.sql>] [--with <b.sql>]
   *
   * --with is REPEATABLE and applies each file first, in the order given, in the
   * same transaction — so a probe can assert against objects that do not exist on
   * production yet (stack A(f) ordinals 1/6/7 ahead of this migration in an
   * unapplied window). Nothing is ever committed: the harness appends its own
   * ROLLBACK and refuses any input containing COMMIT.
   */
  import { readFileSync } from 'node:fs'

  const PROJECT_REF = 'cbskbnvvgcybmfikxgky'
  // SUPABASE_PAT is this repo's TS-side name (import-templates-to-staging.ts:6);
  // SUPABASE_ACCESS_TOKEN is what scripts/db/mgmt-api.sh and CI use.
  const PAT = process.env.SUPABASE_PAT ?? process.env.SUPABASE_ACCESS_TOKEN
  if (!PAT) throw new Error('SUPABASE_PAT (or SUPABASE_ACCESS_TOKEN) not set')

  const args = process.argv.slice(2)
  const probePath = args.find((a, i) => i === 0 && !a.startsWith('--'))
  if (!probePath) throw new Error('usage: rehearse-sql.ts <probe.sql> [--with <migration.sql>]…')
  // Repeatable --with: every value whose predecessor is the flag.
  const withPaths = args.filter((a, i) => args[i - 1] === '--with')

  const parts: string[] = ['BEGIN;']
  for (const p of withPaths) parts.push(readFileSync(p, 'utf8'))
  parts.push(readFileSync(probePath, 'utf8'))

  const body = parts.join('\n')
  // Safety interlock: this harness must never be the thing that commits.
  // Comment-stripped, and matched anywhere — not only at a line start, so
  // "ROLLBACK; COMMIT;" and "SELECT 1; COMMIT;" are both caught.
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  if (/\bCOMMIT\b/i.test(stripped)) {
    throw new Error('refusing to run: input contains COMMIT. This harness only rehearses.')
  }
  const sql = `${body}\nROLLBACK;`

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) { console.error(`FAIL (HTTP ${res.status})\n${text}`); process.exit(1) }

  const rows = JSON.parse(text) as Array<Record<string, unknown>>
  // The API returns rows from the LAST row-producing statement only. If the probe
  // ended in a DO block, or an early error skipped the assertion SELECT, we get
  // [] or the wrong shape — and "0/0 passed, exit 0" is the one result a test
  // harness must never print.
  if (!Array.isArray(rows) || rows.length === 0 ||
      !rows.every((r) => 'ok' in r && 'probe' in r)) {
    console.error(
      'no assertion rows returned. A probe file must end in exactly one row-producing\n' +
      'statement selecting (probe text, ok boolean, detail text). Got:\n' +
      JSON.stringify(rows).slice(0, 600),
    )
    process.exit(1)
  }

  let failed = 0
  for (const r of rows) {
    const ok = r.ok === true
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.probe}  ${r.detail ?? ''}`)
  }
  // Print the names seen, so a silently-dropped assertion is visible in the
  // output and not only in a total the reader has to remember.
  console.log(`\nassertions seen: ${rows.map((r) => r.probe).join(', ')}`)
  console.log(`${rows.length - failed}/${rows.length} assertions passed`)
  process.exit(failed === 0 ? 0 : 1)
  ```

- [ ] **Step 4: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/00-harness-selftest.sql
  ```
  Expected, exit code 1:
  ```
  FAIL  harness  expected true

  assertions seen: harness
  0/1 assertions passed
  ```

- [ ] **Step 5: Fix the probe, watch it pass.** Change `(1 = 2)` to `(1 = 1)` and re-run. Expected, exit 0: `PASS  harness  expected true` / `1/1 assertions passed`.

- [ ] **Step 6: Prove the COMMIT interlock, including the forms a line-anchored regex would miss.** Append each of these to the probe in turn, re-run, confirm the refusal, then remove it:
  - `COMMIT;` on its own line
  - `SELECT 1; COMMIT;` on one line
  - `ROLLBACK; COMMIT;` on one line

  Expected each time:
  ```
  Error: refusing to run: input contains COMMIT. This harness only rehearses.
  ```
  Then append `-- COMMIT; (in a comment, must NOT trip the interlock)` and confirm it still runs. Remove it.

- [ ] **Step 7: Prove the zero-rows guard.** Replace the probe body with a bare `DO $x$ BEGIN NULL; END $x$;` and re-run. Expected, exit 1:
  ```
  no assertion rows returned. A probe file must end in exactly one row-producing
  statement selecting (probe text, ok boolean, detail text). Got:
  []
  ```
  This is the guard that stops a concatenated rehearsal reporting "3/3 passed" while nine probes were discarded. Restore the Step 5 body.

- [ ] **Step 8: Prove the rollback is real.** Temporarily prepend to the probe:
  ```sql
  CREATE SCHEMA _probe_rollback_check;
  ```
  Run (expect `1/1`). Then remove that line and set the probe body to:
  ```sql
  SELECT 'rollback' AS probe,
         NOT EXISTS (SELECT 1 FROM information_schema.schemata
                      WHERE schema_name = '_probe_rollback_check') AS ok,
         'schema must not survive' AS detail;
  ```
  Expected: `PASS  rollback  schema must not survive`. Restore the Step 5 body.

- [ ] **Step 9: Prove `--with` is repeatable.** Create two throwaway files and confirm both apply in order:
  ```bash
  echo "CREATE TEMP TABLE _w1(x int) ON COMMIT DROP; INSERT INTO _w1 VALUES (1);" > /tmp/w1.sql
  echo "INSERT INTO _w1 VALUES (2);" > /tmp/w2.sql
  cat > /tmp/w.sql <<'SQL'
  SELECT 'two_with_files' AS probe, (SELECT count(*) FROM _w1) = 2 AS ok,
         'both --with files applied, in order' AS detail;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/w.sql --with /tmp/w1.sql --with /tmp/w2.sql
  ```
  Expected: `PASS  two_with_files  both --with files applied, in order` / `1/1`.

- [ ] **Step 10: Commit.**
  ```bash
  git add scripts/db/rehearse-sql.ts scripts/db/probes/00-harness-selftest.sql
  git commit -m "chore(db): add rolled-back production rehearsal harness for work-item mirrors

Fails on zero assertion rows: the Management API returns only the last
row-producing statement's rows, so a probe that ends in a DO block would
otherwise print 0/0 and exit 0."
  ```

---

## Task 2 — Migration skeleton, the `-- @verify:` header, and pre-flight assertions

The pre-flight block is a check **expected to pass** (§12 §(d)): it catches a rollback or a diverged branch, it does not gate the feature. There is no fallback arm anywhere in this migration. It asserts the things this plan reads from item 2 as built: `projects.work_items`, `00195`'s four `project_settings` columns, the six registered types, the watchers PK, `public.product_events` with `'backfill_completed'` in its `event` vocabulary (F11), and that `projects.work_items_transition_guard()` **exists** — section C′ `CREATE OR REPLACE`s it, and a replace of a missing function would silently *create* a guard with no trigger behind it.

**The number is claimed here, not at Task 20.** Ledger `max(version) = '00196'` (item 2, applied 2026-09-12); open PR #185 (the spun-off `user_has_project_access` `is_active` fix) already holds **`00197`**. This migration is **`00198`**. Task 20 Step 1 re-checks the ledger, `origin/main` and every open PR at merge; if `00198` has been taken by then, take the next free number and rename in one pass (Task 20 Step 4). ⚠ Placeholders are not an option: `parseVerifyBlock` requires bare identifiers (`/^[a-z0-9_]+$/i`, `verify-header.ts:90,103`) and the hygiene contract test scans every migration `>= '00185'` — a `<NNNNN>` or a `99999_` file makes `pnpm --filter web test` red from this task's Step 5 onward.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql`
- Test: `scripts/db/probes/01-preflight.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/01-preflight.sql`:
  ```sql
  SELECT 'spine_applied' AS probe,
         to_regclass('projects.work_items') IS NOT NULL AS ok,
         'A(f) ordinal 7 (00196) must be APPLIED to production, not merely merged' AS detail
  UNION ALL
  SELECT 'settings_applied',
         (SELECT count(*) FROM information_schema.columns
           WHERE table_schema='projects' AND table_name='project_settings'
             AND column_name IN ('work_item_defaults','triage_owner_id',
                                 'builders_shutdown_start_md','builders_shutdown_end_md')) = 4,
         'A(f) ordinal 6, item 2''s slice (00195:63-67): four columns. suppress_all_outbound is NOT one of them'
  UNION ALL
  SELECT 'watchers_pk_present',
         EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='projects' AND tablename='work_item_watchers'
                    AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef ILIKE '%work_item_id%'
                    AND indexdef ILIKE '%user_id%'),
         '00196:450 — PK (work_item_id, user_id). §11 seeds watchers; this plan seeds none'
  UNION ALL
  SELECT 'product_events_present',
         to_regclass('public.product_events') IS NOT NULL,
         'section I writes the backfill-completion row (A(f) ordinal 9)'
  UNION ALL
  SELECT 'backfill_completed_in_vocabulary',
         EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.product_events'::regclass
                    AND pg_get_constraintdef(c.oid) ~ '''backfill_completed'''),
         'F11: product_events.event is a fixed CHECK (00194:231-238); a free-text name aborts section I with 23514'
  UNION ALL
  SELECT 'six_types_registered',
         (SELECT count(*) FROM projects.work_item_types
           WHERE key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action')) = 6,
         'item_type is an FK to work_item_types; all six mirrored A(b) keys must be seeded (00196:236-247)'
  UNION ALL
  SELECT 'guard_present',
         to_regprocedure('projects.work_items_transition_guard()') IS NOT NULL,
         'section C'' CREATE OR REPLACEs item 2''s guard; replacing a missing function would create a guard with no trigger';
  ```

- [ ] **Step 2: Run it. This is the gate — if it fails, STOP.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/01-preflight.sql
  ```
  Expected: `7/7 assertions passed`.

  If any arm FAILs, **this whole plan is blocked** — item 2 was applied on 2026-09-12 and its post-push verifier was green, so a failure here means a rollback, a diverged branch, or a wrong project ref. Record the blocker and stop; do not stub the spine and do not "fix" item 2's objects from here.

  ⚠ There is no "run it and watch it fail" pair for this probe. It is a precondition check, not a unit under test, and the plan does not pretend otherwise.

- [ ] **Step 3: Create the migration file with its header and section A.** Create `apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql`:
  ```sql
  -- =============================================================================
  -- Migration: 00198_work_item_source_mirrors_and_backfill.sql
  -- Appendix A(f) Q1 ordinal 9. Depends on 00194 (ordinal 1), 00195 (ordinal 6,
  --   item 2's slice) and 00196 (ordinal 7) being APPLIED — all three since 2026-09-12.
  -- Description: Six projection entry points push module status into
  --              projects.work_items; assignment and due date write back to
  --              projects.rfis and field.snags; six BEFORE DELETE triggers void an
  --              orphaned item; item 2's transition guard is REPLACED with the
  --              depth-scoped exemption the mirror needs (00196:1590-1605 names
  --              it); the rfi registry row's gatekeeper_rule becomes 'creator';
  --              then the entity backfill runs under notification suppression and
  --              records its own completion into public.product_events as
  --              event = 'backfill_completed'. structure.node_orders gets NO
  --              trigger (A(b)).
  --
  -- go_live: DATE '2026-11-03'  (Tuesday). Due-date floor for backfilled OPEN
  --          items = go_live + 5 office working days = DATE '2026-11-10'
  --          (Wed 4, Thu 5, Fri 6, Mon 9, Tue 10 — no SA public holiday in range).
  --          Both literals are re-derived at merge in Task 20 Step 4.
  --
  -- Role dependency: applied by `supabase db push`, which connects as `postgres`
  --          with auth.uid() NULL — the guard's service path (00196:1540). The
  --          backfill's INSERTs (no guard on INSERT) and the floor UPDATE are
  --          exempt on that path, and §5 keeps a supplied opened_at there
  --          (00196:629-636). Nothing else depends on the role: the backfill
  --          calls projects.project_*() directly and never UPDATEs a source row,
  --          so field.site_forms' enforce_site_form_transition (00179:347) is
  --          never entered.
  --
  -- Restore: additive only, except the guard replacement and the registry row.
  --          To undo:
  --            DELETE FROM projects.work_items
  --             WHERE origin = 'mirror' AND created_at <= <apply timestamp>;
  --            UPDATE projects.rfis r SET assigned_to = b.assigned_to, due_date = b.due_date,
  --                   updated_at = b.updated_at
  --              FROM projects.backup_00198_source_assignees b
  --             WHERE b.kind = 'rfi' AND b.id = r.id;
  --            UPDATE field.snags s SET assigned_to = b.assigned_to, updated_at = b.updated_at
  --              FROM projects.backup_00198_source_assignees b
  --             WHERE b.kind = 'snag' AND b.id = s.id;
  --            UPDATE projects.work_item_types SET gatekeeper_rule = 'project_pm' WHERE key = 'rfi';
  --            -- and re-run 00196 §12's CREATE OR REPLACE FUNCTION projects.work_items_transition_guard()
  --          No source row is destroyed. The write-back is the only thing this
  --          migration changes on a source table, and it rewrites `updated_at`
  --          via the pre-existing set_updated_at triggers (rfis_updated_at
  --          00002:100, snags_updated_at 00004:33) on the rows it touches —
  --          which is why updated_at is in the snapshot. The floor UPDATE in
  --          section H also reaches projects.rfis.due_date on the 9 open RFIs
  --          through the write-back (improvement 11 is two-way for due_date on
  --          the spine side only); the snapshot's due_date column restores it.
  --
  -- @verify:begin
  -- table: projects.backup_00198_source_assignees
  -- function: projects.work_item_person_eligible(uuid,uuid)
  -- function: projects.resolve_mirror_assignee(uuid,text,uuid)
  -- function: projects.resolve_work_item_gatekeeper(uuid,uuid)
  -- function: projects.map_source_status(text,text)
  -- function: projects.work_item_status_for_mirror(text,text,boolean)
  -- function: projects.work_item_mirror_due_date(date)
  -- function: projects.diary_delay_text(text,text)
  -- function: projects.project_rfi(uuid)
  -- function: projects.project_snag(uuid)
  -- function: projects.project_inspection(uuid)
  -- function: projects.project_qc_entry(uuid)
  -- function: projects.project_diary_action(uuid)
  -- function: projects.project_form_action(uuid)
  -- function: projects.mirror_rfi_work_item()
  -- function: projects.mirror_snag_work_item()
  -- function: projects.mirror_inspection_work_item()
  -- function: projects.mirror_qc_defect_work_item()
  -- function: projects.mirror_qc_report_defects()
  -- function: projects.mirror_diary_action_work_item()
  -- function: projects.mirror_form_action_work_item()
  -- function: projects.work_item_assignment_writeback()
  -- function: projects.void_work_item_on_source_delete()
  -- function: projects.work_items_transition_guard()
  -- sql: SELECT p.prosrc ~ 'pg_trigger_depth\(\)\s*>\s*1' AND p.prosrc ~ 'source_status\s+IS DISTINCT FROM' AND p.prosrc !~ 'pg_trigger_depth\(\)\s*>\s*0' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'work_items_transition_guard'
  -- sql: SELECT gatekeeper_rule = 'creator' FROM projects.work_item_types WHERE key = 'rfi'
  -- trigger: rfis_mirror_work_item_ins ON projects.rfis
  -- trigger: rfis_mirror_work_item_upd ON projects.rfis
  -- trigger: snags_mirror_work_item_ins ON field.snags
  -- trigger: snags_mirror_work_item_upd ON field.snags
  -- trigger: inspections_mirror_work_item_ins ON inspections.inspections
  -- trigger: inspections_mirror_work_item_upd ON inspections.inspections
  -- trigger: qc_entries_mirror_work_item_ins ON projects.qc_entries
  -- trigger: qc_entries_mirror_work_item_upd ON projects.qc_entries
  -- trigger: qc_reports_mirror_defects ON projects.qc_reports
  -- trigger: site_diary_entries_mirror_work_item_ins ON projects.site_diary_entries
  -- trigger: site_diary_entries_mirror_work_item_upd ON projects.site_diary_entries
  -- trigger: site_forms_mirror_work_item_ins ON field.site_forms
  -- trigger: site_forms_mirror_work_item_upd ON field.site_forms
  -- trigger: work_items_assignment_writeback_ins ON projects.work_items
  -- trigger: work_items_assignment_writeback_upd ON projects.work_items
  -- trigger: rfis_void_work_item ON projects.rfis
  -- trigger: snags_void_work_item ON field.snags
  -- trigger: inspections_void_work_item ON inspections.inspections
  -- trigger: qc_entries_void_work_item ON projects.qc_entries
  -- trigger: site_diary_entries_void_work_item ON projects.site_diary_entries
  -- trigger: site_forms_void_work_item ON field.site_forms
  -- grant_absent: anon SELECT ON projects.backup_00198_source_assignees
  -- grant_absent: anon EXECUTE ON projects.work_item_person_eligible(uuid,uuid)
  -- grant_absent: anon EXECUTE ON projects.resolve_mirror_assignee(uuid,text,uuid)
  -- grant_absent: anon EXECUTE ON projects.resolve_work_item_gatekeeper(uuid,uuid)
  -- grant_absent: anon EXECUTE ON projects.map_source_status(text,text)
  -- grant_absent: anon EXECUTE ON projects.work_item_status_for_mirror(text,text,boolean)
  -- grant_absent: anon EXECUTE ON projects.work_item_mirror_due_date(date)
  -- grant_absent: anon EXECUTE ON projects.diary_delay_text(text,text)
  -- grant_absent: anon EXECUTE ON projects.project_rfi(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_snag(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_inspection(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_qc_entry(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_diary_action(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_form_action(uuid)
  -- grant_absent: anon EXECUTE ON projects.mirror_rfi_work_item()
  -- grant_absent: anon EXECUTE ON projects.mirror_snag_work_item()
  -- grant_absent: anon EXECUTE ON projects.mirror_inspection_work_item()
  -- grant_absent: anon EXECUTE ON projects.mirror_qc_defect_work_item()
  -- grant_absent: anon EXECUTE ON projects.mirror_qc_report_defects()
  -- grant_absent: anon EXECUTE ON projects.mirror_diary_action_work_item()
  -- grant_absent: anon EXECUTE ON projects.mirror_form_action_work_item()
  -- grant_absent: anon EXECUTE ON projects.work_item_assignment_writeback()
  -- grant_absent: anon EXECUTE ON projects.void_work_item_on_source_delete()
  -- grant_absent: anon EXECUTE ON projects.work_items_transition_guard()
  -- @verify:end
  -- =============================================================================
  ```
  Twenty-two `function:` lines for objects this file creates, one for the guard it replaces (the hygiene test demands every `CREATE [OR REPLACE] FUNCTION` in the file be declared), one `table:`, two `sql:` predicates (one statement each, returning one boolean — the grammar `verify-header.ts:50` accepts: `table view function column policy constraint index trigger cron grant_absent grant_present anon_execute_absent sql behaviour`; `-- trigger:` is already a kind and `00196` declares six of them), twenty-one `trigger:` lines, and one `grant_absent:` per revoke (item 2's convention). **If the owner takes option (a) on `suppress_all_outbound` (Task 20 Step 5), add `-- column: projects.project_settings.suppress_all_outbound` here and the `ADD COLUMN` to section C′.** ⚠ The first `sql:` predicate reads the replaced guard's source; the second the registry row. Both are predicates only THIS migration can satisfy — a `function:` line on a pre-existing function passes either way, which is why the guard's `function:` line is accompanied by the `sql:` one.

  Then section A:
  ```sql
  -- ─── A. Pre-flight. Expected to pass; catches a rollback or a diverged branch. ──
  DO $preflight$
  BEGIN
    IF to_regclass('projects.work_items') IS NULL THEN
      RAISE EXCEPTION 'A(f) ordinal 7 (00196, the spine) has not been applied';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='projects' AND table_name='qc_entries'
                      AND column_name IN ('conformance','severity')
                    HAVING count(*) = 2) THEN
      RAISE EXCEPTION 'projects.qc_entries is missing conformance/severity (00176:54,56)';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname IN ('qc_entries_conformance_check','qc_entries_severity_check')
                    HAVING count(*) = 2) THEN
      RAISE EXCEPTION 'the qc_entries conformance/severity CHECKs are absent (00176:60,67)';
    END IF;

    -- 00195 (item 2's slice of A(f) ordinal 6) adds exactly four columns. There is
    -- no suppress_all_outbound: see Task 20 Step 5 (owner decision).
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='projects' AND table_name='project_settings'
           AND column_name IN ('work_item_defaults','triage_owner_id',
                               'builders_shutdown_start_md','builders_shutdown_end_md')) <> 4 THEN
      RAISE EXCEPTION '00195 (work_item_defaults / triage_owner_id / builders_shutdown_*_md) has not been applied';
    END IF;

    IF (SELECT count(*) FROM projects.work_item_types
         WHERE key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action')) <> 6 THEN
      RAISE EXCEPTION 'the six mirrored A(b) types are not all registered';
    END IF;

    -- §11 seeds watchers on the PK (work_item_id, user_id) (00196:450); nothing
    -- in this migration writes that table, but its shape is what makes the
    -- SELECT policy's watcher arm meaningful for mirrored items.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname='projects' AND tablename='work_item_watchers'
                      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
                      AND indexdef ILIKE '%work_item_id%' AND indexdef ILIKE '%user_id%') THEN
      RAISE EXCEPTION 'projects.work_item_watchers has no PK/UNIQUE on (work_item_id, user_id) — item 2 owns it';
    END IF;

    -- Section C' CREATE OR REPLACEs item 2's guard. A replace of a MISSING function
    -- would silently create a guard that no trigger calls — refuse instead.
    IF to_regprocedure('projects.work_items_transition_guard()') IS NULL THEN
      RAISE EXCEPTION 'projects.work_items_transition_guard() is absent — 00196 §12 has not been applied';
    END IF;

    IF to_regclass('public.product_events') IS NULL THEN
      RAISE EXCEPTION 'A(f) ordinal 1 (public.product_events) has not been applied';
    END IF;

    -- F11. product_events.event is a fixed CHECK vocabulary (00194:231-238); section
    -- I writes 'backfill_completed'. Checked here so the failure is a sentence at
    -- the top, not a 23514 after the whole backfill has run.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conrelid = 'public.product_events'::regclass
                      AND pg_get_constraintdef(c.oid) ~ '''backfill_completed''') THEN
      RAISE EXCEPTION 'public.product_events.event does not admit ''backfill_completed'' (F11)';
    END IF;
  END $preflight$;
  ```
  ⚠ **No trailing `SELECT`.** A migration must not return rows to `db push`; the probe in Step 1 reads the same facts from `information_schema` and `pg_proc` directly, so the migration needs no output of its own.

- [ ] **Step 4: Prove the pre-flight can fail.** Temporarily change `<> 6` to `<> 7` and run:
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/01-preflight.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: the six mirrored A(b) types are not all registered
  ```
  Restore `<> 6`, re-run with `--with`, and confirm `7/7` again — a pre-flight that passes only because the migration was not applied is not a pre-flight. Then run the hygiene test on the skeleton, which must already be green — it is the thing that would go red on a placeholder identifier:
  ```bash
  pnpm --filter web test -- migration-verify-block
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/01-preflight.sql
  git commit -m "feat(work-items): 00198 skeleton, @verify header and pre-flight assertions for source mirrors

Number claimed against ledger max 00196 and open PR #185 (00197). Every
identifier in the @verify block is real from this commit: parseVerifyBlock
refuses placeholders and the hygiene test scans every file >= 00185."
  ```
  (The 2026-09-10 plan had a Step 5 extending `verify-migration-applied.ts` to parse `-- trigger:`; it already does — `trigger` has been a directive kind since item 1 and `00196` declares six. Deleted at reconciliation, #11.)

---

## Task 3 — The mirror's resolver (findings F3, improvement 7)

**Item 2 shipped both resolvers the spec names, and this task replaces neither.** `00195`'s `projects.resolve_project_pm(uuid)` has the plan's arm order (project PM → org PM → org admin → org owner → `created_by`, ties broken by `user_id`) but **validates every arm** and returns NULL for an orphaned project (its CONTRACT, `00195:118–129`). `00196`'s `projects.resolve_work_item_assignee(uuid,text,uuid)` carries a **caller-access guard** (`00196:861–863`), RAISES one sentence for an orphaned project (`901–902`), is granted to `authenticated` for the people-picker and `createWorkItemTaskAction`, and **admits `client_viewer` by decision** (`911–913`). Redefining either turns three of item 2's regression files red (`work-item-settings.sql:186` — orphaned project must resolve NULL; `work-item-rls.sql` 11f — the caller guard; `work-item-membership.sql:271–280` — orphaned project must RAISE) and strips Task 13's actions of their contracted error.

**But the mirror cannot call `resolve_work_item_assignee` either.** A mirror trigger runs in the source writer's session, where `auth.uid()` is a person; the caller guard then returns NULL for an org member with no `project_members` row — and `projects.rfis`' INSERT/UPDATE policies are **org-wide** (`00027:44–50`) while `user_has_project_access` needs a membership row or org admin (`00106:44–57`). `assignee_id NOT NULL` fails and **the RFI insert aborts** (item 2 hand-off). So this task creates **`projects.resolve_mirror_assignee(uuid,text,uuid)`** — the spec chain with no caller guard — plus two helpers. Three decisions, each with its reason on the record:

1. **The chain ends at `00195`'s `resolve_project_pm`, which ends at a validated `created_by`; when that is NULL the mirror RAISES item 2's sentence** (F3). Measured 2026-09-10: the Sandton demo project's org has no owner, admin or PM; its `created_by` holds an effective `contractor` role, so the chain resolves there today. ⚠ **Accepted consequence:** on that project the gatekeeper is a contractor — the same person who raised all six snags — which §03 §1.5 forbids. Accepted because improvement 2 keeps that project out of the backfill. An orphaned project (nobody with an effective role) raises `This project has nobody who can own work — add a project manager to it first.` on the source insert — item 2's contract, and the only actionable answer.
2. **`default_rfi_assignee_id` is step 1b for `p_item_type = 'rfi'`,** which §12 §(d) line 133 names and the original plan silently dropped. In practice it is moot — `rfiService.create` already applies it at the application layer (`packages/shared/src/services/rfi.service.ts:75-83`, verified) and no project has it set (`00101:29`) — but the backfill is exactly the path where that application-layer fallback did not run, so the database must carry it.
3. **`client_viewer` is excluded from every step of the mirror's chain** (improvement 7). §03 §1.9 grants client viewers assignee *eligibility* from Q1 but defers to Q3 the write set that lets them clear an item; `00161`'s blanket block stops them writing and `work_items_bic_present` keeps the row pointing at them, so an item that lands on one can never reach zero. Four `client_viewer` accounts exist in production and are reachable through an explicit `rfis.assigned_to` or a mistyped `triage_owner_id`. **Item 2's people-picker resolver still admits them** (a landlord is often the ball-in-court in a fit-out) — that divergence is deliberate on both sides and is recorded in the matrix (Task 18). Deleting this predicate in Q3 is one line; recovering items stranded on a client's ball-in-court is a data migration and a conversation with the client.

Every candidate is filtered through one helper, `projects.work_item_person_eligible`, so the exclusion lives in exactly one place a test can pin. §03 §1.5 warns that a departed employee's id survives in the jsonb with no foreign key behind it, and item 2's assignee-membership trigger would reject them anyway — raising inside the mirror, which would make it impossible for anyone to raise an RFI on that project.

**Files:**
- Modify: the migration — add section B after section A
- Test: `scripts/db/probes/02-resolvers.sql`

- [ ] **Step 1: Write the probe first, with the demo project and a real client viewer named explicitly.** Create `scripts/db/probes/02-resolvers.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_cv   uuid;   -- a live client_viewer in WM-Consulting
    v_proj uuid;   -- a project they can see
  BEGIN
    SELECT u.user_id INTO v_cv
      FROM public.user_organisations u
     WHERE u.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
       AND u.role = 'client_viewer' AND u.is_active
     LIMIT 1;

    SELECT p.id INTO v_proj FROM projects.projects p
     WHERE p.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
       AND public.user_effective_project_role(p.id, v_cv) = 'client_viewer'
     LIMIT 1;

    -- An ORPHANED project: a throwaway org with no members at all, whose creator
    -- (v_cv, a WM client viewer) holds no role there. 00195's chain returns NULL
    -- for it; the mirror resolver must RAISE item 2's sentence, not return NULL
    -- (which would fail assignee_id NOT NULL with a generic message on the
    -- source insert).
    DECLARE v_orphan_org uuid; v_orphan uuid; v_err text;
    BEGIN
      INSERT INTO public.organisations (name) VALUES ('_probe_orphan_org') RETURNING id INTO v_orphan_org;
      INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
      VALUES (v_orphan_org, '_probe_orphan', 'active', 'ZAR', v_cv) RETURNING id INTO v_orphan;
      BEGIN
        PERFORM projects.resolve_mirror_assignee(v_orphan, 'snag', NULL);
        v_err := '<no error>';
      EXCEPTION WHEN raise_exception THEN
        v_err := SQLERRM;
      END;
      CREATE TEMP TABLE res_orphan(proj uuid, err text) ON COMMIT DROP;
      INSERT INTO res_orphan VALUES (v_orphan, v_err);
    END;

    CREATE TEMP TABLE res_ctx(cv uuid, proj uuid) ON COMMIT DROP;
    INSERT INTO res_ctx VALUES (v_cv, v_proj);
  END $probe$;

  -- Live projects only: the orphan fixture is asserted on separately.
  WITH live AS (SELECT p.* FROM projects.projects p WHERE p.name NOT LIKE '\_probe\_%')
  SELECT 'pm_resolves_everywhere' AS probe,
         count(*) FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL) = 0 AS ok,
         '00195''s chain (item 2''s, read not redefined) — unresolved: ' || COALESCE(string_agg(p.name, '; ')
             FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL), 'none') AS detail
  FROM live p
  UNION ALL
  SELECT 'assignee_resolves_everywhere',
         count(*) FILTER (WHERE projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NULL) = 0,
         'unresolved: ' || COALESCE(string_agg(p.name, '; ')
             FILTER (WHERE projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NULL), 'none')
  FROM live p
  UNION ALL
  SELECT 'demo_project_resolves',
         bool_and(projects.resolve_project_pm(p.id) IS NOT NULL
              AND projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NOT NULL),
         'E-Site DEMO has no owner/admin/PM; 00195''s validated created_by arm resolves it (the creator holds an effective role)'
  FROM live p WHERE p.name LIKE 'Sandton%'
  UNION ALL
  -- F3's accepted consequence, on the record rather than discovered later.
  SELECT 'demo_gatekeeper_is_the_creator_and_a_contractor',
         bool_and(projects.resolve_project_pm(p.id) = p.created_by
              AND public.user_effective_project_role(p.id, p.created_by) = 'contractor'),
         'accepted: on the demo project the gatekeeper is a contractor, so improvement 2 keeps it out of the backfill'
  FROM live p WHERE p.name LIKE 'Sandton%'
  UNION ALL
  -- F3: an orphaned project raises item 2's sentence, never NULL.
  SELECT 'orphan_raises_one_sentence',
         (SELECT err LIKE 'This project has nobody who can own work%' FROM res_orphan),
         'got: ' || (SELECT err FROM res_orphan)
  UNION ALL
  SELECT 'resolved_people_are_members',
         count(*) FILTER (WHERE public.user_effective_project_role(
             p.id, projects.resolve_mirror_assignee(p.id, 'snag', NULL)) IS NULL) = 0,
         'assignee must pass user_effective_project_role or item 2''s membership trigger raises'
  FROM live p
  UNION ALL
  -- Improvement 7.
  SELECT 'client_viewer_is_never_eligible',
         NOT projects.work_item_person_eligible((SELECT proj FROM res_ctx), (SELECT cv FROM res_ctx)),
         'a client viewer cannot clear an item until Q3, and work_items_bic_present pins it to them forever'
  UNION ALL
  SELECT 'client_viewer_explicit_is_overridden',
         projects.resolve_mirror_assignee((SELECT proj FROM res_ctx), 'rfi', (SELECT cv FROM res_ctx))
           IS DISTINCT FROM (SELECT cv FROM res_ctx),
         'an explicit rfis.assigned_to naming a client viewer falls through to the chain (item 2''s picker resolver would have kept them — deliberate divergence)'
  UNION ALL
  SELECT 'nobody_resolves_to_a_client_viewer',
         count(*) FILTER (WHERE public.user_effective_project_role(
             p.id, projects.resolve_mirror_assignee(p.id, 'rfi', NULL)) = 'client_viewer') = 0,
         'no project''s default assignee may be a client viewer'
  FROM live p;
  ```
  ⚠ The orphan fixture's `INSERT INTO public.organisations` must satisfy that table's NOT NULL columns; `slug` is trigger-filled (`organisations_ensure_slug`). If the insert needs more columns on the day, supply them — the fixture's only property is "nobody holds a role here".

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/02-resolvers.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `FAIL (HTTP 400) … ERROR: 42883: function projects.resolve_mirror_assignee(uuid, unknown, unknown) does not exist` — the DO block reaches the orphan fixture's `PERFORM` before the assertion `SELECT` runs. (`resolve_project_pm` exists already; it is item 2's.)

- [ ] **Step 3: Append section B to the migration.**
  ```sql
  -- ─── B. The mirror's resolver ────────────────────────────────────────────────
  -- All three are SECURITY DEFINER with row_security off because they read
  -- membership tables the calling contractor cannot see, and none of them uses
  -- current_user: inside SECURITY DEFINER it is the function OWNER, which is what
  -- made the first site-form transition trigger silently inert (00179:341-346,
  -- function at :347). They take no caller identity at all — they answer
  -- "who owns this project", not "who is asking".
  --
  -- NOT here, deliberately: projects.resolve_project_pm (00195) and
  -- projects.resolve_work_item_assignee (00196) are item 2's and are READ, never
  -- redefined. The second carries a caller-access guard (00196:861-863) that
  -- returns NULL inside a source writer's session for an org member with no
  -- project_members row — and projects.rfis' write policies are org-wide
  -- (00027:44-50), so the RFI insert would abort on assignee_id NOT NULL. The
  -- mirror therefore has its own chain below, with no caller guard: it is only
  -- ever called from a trigger or the backfill, never by a client.

  -- One place, and only one place, decides whether a person may hold an item.
  CREATE OR REPLACE FUNCTION projects.work_item_person_eligible(
      p_project_id uuid, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
    SELECT p_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id)
       -- §03 §1.9 defers the client viewer's write set to Q3. Until then an item
       -- that lands on one can never be cleared: 00161 blocks their writes and
       -- work_items_bic_present keeps the row pointing at them. Delete this one
       -- clause in Q3; it is one line, and stranded items are a data migration.
       AND COALESCE(public.user_effective_project_role(p_project_id, p_user_id), 'none')
             NOT IN ('none', 'client_viewer')
  $fn$;

  -- The mirror's chain. Same shape as 00196's resolve_work_item_assignee, three
  -- differences, all deliberate: (1) NO caller-access guard — this is called
  -- from triggers and the backfill only, never by a client, and inside a source
  -- writer's session the guard would return NULL for an org member with no
  -- project_members row; (2) every candidate goes through
  -- work_item_person_eligible, so client_viewer is excluded (improvement 7 —
  -- item 2's picker resolver admits them, by decision, 00196:911-913);
  -- (3) step 1b, default_rfi_assignee_id (§12 §(d) line 133, 00101:29).
  -- The PM step and the created_by terminus are 00195's resolve_project_pm,
  -- read as-is; when it returns NULL (an orphaned project) this raises the
  -- SAME sentence 00196:901 raises, so a PM sees one message whichever path
  -- produced it.
  CREATE OR REPLACE FUNCTION projects.resolve_mirror_assignee(
      p_project_id uuid, p_item_type text, p_explicit uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE v_candidate uuid;
  BEGIN
    -- 1. explicit
    IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
      RETURN p_explicit;
    END IF;

    -- 1b. RFI only: the per-project default (§12 §(d) line 133,
    --     00101_project_settings.sql:29). rfiService.create applies this at the
    --     application layer (rfi.service.ts:75-83) and no project sets it today,
    --     but the backfill is exactly the path where that never ran.
    IF p_item_type = 'rfi' THEN
      SELECT s.default_rfi_assignee_id INTO v_candidate
        FROM projects.project_settings s WHERE s.project_id = p_project_id;
      IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
        RETURN v_candidate;
      END IF;
    END IF;

    -- 2. per-type work_item_defaults.<type>.triage_owner_id. No FK behind the
    --    jsonb (§03 §1.5), so a stale id is discarded rather than raising.
    SELECT NULLIF(s.work_item_defaults #>> ARRAY[p_item_type, 'triage_owner_id'], '')::uuid
      INTO v_candidate
      FROM projects.project_settings s WHERE s.project_id = p_project_id;
    IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
      RETURN v_candidate;
    END IF;

    -- 3. project triage_owner_id (nullable by decision, §03 §1.6)
    SELECT s.triage_owner_id INTO v_candidate
      FROM projects.project_settings s WHERE s.project_id = p_project_id;
    IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
      RETURN v_candidate;
    END IF;

    -- 4 + 5. 00195's PM chain, validated end to end, terminating at a validated
    --        created_by. NULL only for an orphaned project (00195:118-129).
    v_candidate := projects.resolve_project_pm(p_project_id);
    IF v_candidate IS NOT NULL THEN
      RETURN v_candidate;
    END IF;

    -- Item 2's sentence (00196:901), verbatim, so the PM reading a server
    -- action's error.message sees one message whichever resolver produced it.
    RAISE EXCEPTION 'This project has nobody who can own work — add a project manager to it first.'
      USING ERRCODE = 'raise_exception';
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.resolve_work_item_gatekeeper(
      p_project_id uuid, p_explicit uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    -- A(b), as amended in this PR: the gatekeeper is the project PM for snag,
    -- qc_defect, diary_action and form_action; verifier_id for inspection; and
    -- THE RAISER for rfi (improvement 4 — an RFI is closed by the person who
    -- asked, once they confirm the answer is usable; the registry row says
    -- 'creator', section C'). The caller supplies the exception as p_explicit;
    -- everyone else passes NULL. Delegates to 00195's resolve_project_pm; an
    -- orphaned project returns NULL here and the mirror's assignee call raises
    -- first, so no second sentence is needed.
    IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
      RETURN p_explicit;
    END IF;
    RETURN projects.resolve_project_pm(p_project_id);
  END $fn$;
  ```

- [ ] **Step 4: Run the probe and watch all nine assertions pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/02-resolvers.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected:
  ```
  PASS  pm_resolves_everywhere                            00195's chain … unresolved: none
  PASS  assignee_resolves_everywhere                      unresolved: none
  PASS  demo_project_resolves                             E-Site DEMO has no owner/admin/PM; …
  PASS  demo_gatekeeper_is_the_creator_and_a_contractor   accepted: …
  PASS  orphan_raises_one_sentence                        got: This project has nobody who can own work — add a project manager to it first.
  PASS  resolved_people_are_members                       assignee must pass user_effective_project_role …
  PASS  client_viewer_is_never_eligible                   a client viewer cannot clear an item until Q3, …
  PASS  client_viewer_explicit_is_overridden              an explicit rfis.assigned_to naming a client viewer …
  PASS  nobody_resolves_to_a_client_viewer                no project's default assignee may be a client viewer

  assertions seen: pm_resolves_everywhere, assignee_resolves_everywhere, demo_project_resolves, demo_gatekeeper_is_the_creator_and_a_contractor, orphan_raises_one_sentence, resolved_people_are_members, client_viewer_is_never_eligible, client_viewer_explicit_is_overridden, nobody_resolves_to_a_client_viewer
  9/9 assertions passed
  ```

- [ ] **Step 5: Mutation-verify F3 — the orphan must RAISE, never NULL.** The `created_by` arm is `00195`'s and is tested by item 2 (`work-item-settings.sql:186`); what this plan owns is the raise. Replace `RAISE EXCEPTION 'This project has nobody …'` in `resolve_mirror_assignee` with `RETURN NULL;`. Re-run. Expected:
  ```
  FAIL  orphan_raises_one_sentence   got: <no error>
  ```
  Restore and confirm 9/9. **Record 9/9 → 8/9 → 9/9 in the PR body** — §12 §(h) makes mutation verification the acceptance step, not a nicety. Do **not** mutate `resolve_project_pm`: it is not in this file.

- [ ] **Step 6: Mutation-verify improvement 7.** In `work_item_person_eligible`, change `NOT IN ('none', 'client_viewer')` to `NOT IN ('none')`. Re-run. Expected:
  ```
  FAIL  client_viewer_is_never_eligible        a client viewer cannot clear an item until Q3, …
  FAIL  client_viewer_explicit_is_overridden   an explicit rfis.assigned_to naming a client viewer …
  ```
  Restore. Record 9/9 → 7/9 → 9/9.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/02-resolvers.sql
  git commit -m "feat(work-items): resolve_mirror_assignee — the mirror's chain, no caller guard, no client viewers

Item 2's resolve_work_item_assignee carries a caller-access guard that returns
NULL inside a source writer's session for an org member with no project_members
row, and projects.rfis' write policies are org-wide — the RFI insert would abort
on assignee_id NOT NULL. The mirror gets its own chain: explicit → rfi default →
per-type → project triage owner → 00195's validated PM chain, every candidate
through work_item_person_eligible (client_viewer excluded until Q3), raising
item 2's one sentence for an orphaned project. 00195/00196's resolvers are
read, never redefined."
  ```

---

## Task 4 — Status mapping, the due-date floor, and the diary negation stop-list

Four pure functions with clearly separated jobs, so each is independently testable:

- `map_source_status` — pure vocabulary, one arm per source value, parseable by a contract test.
- `work_item_status_for_mirror` — the policy reconciling a mapping with §03 §1.6's triage rule.
- `work_item_mirror_due_date` — **improvement 6**: a source date at or before today becomes NULL, so item 2's `BEFORE INSERT` trigger computes the type's own offset on the type's own calendar and no projected item is ever born overdue.
- `diary_delay_text` — **improvement 1**: the negation stop-list, in SQL rather than in prose, so a contract test can assert it exists and a probe can assert it works.

The status reconciliation matters because A(b) maps `inspection.assigned → open` while §1.6 says an item created without an explicit assignee is born `triage`. Applied naively the mapping would immediately un-triage every unowned inbound item and empty the Triage queue — the queue §1.6 exists to fill. **The rule: a mapped `open` never overrides `triage`; only `answered`, `closed` and `void` do — and `void` is terminal.** Item 2's machine (`00196:1701–1709`) makes `void` terminal for every signed-in actor; under Task 5½'s exemption the mirror bypasses that machine entirely, so without an arm here an inspection going `abandoned → re-inspect_required` would un-void its item and put it back in inboxes with its old `void_reason` intact (the guard restores `OLD.void_reason` on any non-void row, `00196:1536–1538`). Reconciliation #3: `void` stays terminal on the mirror side too, matching the plan's own "no un-projection path".

**Files:**
- Modify: the migration — add section C
- Create: `apps/web/src/lib/work-items/source-status-map.contract.test.ts`
- Test: `scripts/db/probes/03-status-map.sql`

- [ ] **Step 1: Write the SQL probe first.** Create `scripts/db/probes/03-status-map.sql`:
  ```sql
  WITH cases(probe, got, want) AS (VALUES
    ('rfi_responded',     projects.map_source_status('rfi','responded'),        'answered'),
    ('rfi_closed',        projects.map_source_status('rfi','closed'),           'closed'),
    ('rfi_draft_null',    projects.map_source_status('rfi','draft'),            NULL),
    ('snag_resolved',     projects.map_source_status('snag','resolved'),        'answered'),
    ('snag_signed_off',   projects.map_source_status('snag','signed_off'),      'closed'),
    ('insp_awaiting',     projects.map_source_status('inspection','awaiting_verification'), 'answered'),
    ('insp_abandoned',    projects.map_source_status('inspection','abandoned'), 'void'),
    ('qc_na_null',        projects.map_source_status('qc_defect','na'),         NULL),
    ('qc_pass_closed',    projects.map_source_status('qc_defect','pass'),       'closed'),
    ('form_distributed',  projects.map_source_status('form_action','distributed'), 'closed'),
    ('diary_always_null', projects.map_source_status('diary_action','anything'), NULL)
  )
  SELECT probe, got IS NOT DISTINCT FROM want AS ok,
         'got ' || COALESCE(got,'<null>') || ', want ' || COALESCE(want,'<null>') AS detail
  FROM cases
  UNION ALL
  SELECT 'open_never_untriages',
         projects.work_item_status_for_mirror('triage','open',false) = 'triage',
         'an inspection at status=assigned must not empty the Triage queue'
  UNION ALL
  SELECT 'terminal_overrides_triage',
         projects.work_item_status_for_mirror('triage','closed',false) = 'closed',
         'a source that closed while untriaged still closes'
  UNION ALL
  SELECT 'insert_without_assignee_is_triage',
         projects.work_item_status_for_mirror(NULL,'open',false) = 'triage',
         '§03 §1.6: born triage when nobody was named'
  UNION ALL
  SELECT 'insert_with_assignee_is_open',
         projects.work_item_status_for_mirror(NULL,'open',true) = 'open',
         '§03 §1.6: born open when an assignee was named'
  UNION ALL
  SELECT 'unmapped_leaves_unchanged',
         projects.work_item_status_for_mirror('answered',NULL,false) = 'answered',
         '§03 §1.8: an unmapped source status changes nothing'
  UNION ALL
  -- Reconciliation #3: void is terminal on the mirror side too.
  SELECT 'void_is_terminal',
         projects.work_item_status_for_mirror('void','open',false) = 'void'
     AND projects.work_item_status_for_mirror('void','answered',false) = 'void',
         'an inspection going abandoned → re-inspect_required must not un-void its item (00196:1701-1709 makes void terminal; the mirror bypasses (c))'
  UNION ALL
  -- Improvement 6.
  SELECT 'past_due_becomes_null',
         projects.work_item_mirror_due_date(CURRENT_DATE - 30) IS NULL,
         'a past source date must not arrive overdue; item 2''s trigger computes the type default instead'
  UNION ALL
  SELECT 'today_becomes_null',
         projects.work_item_mirror_due_date(CURRENT_DATE) IS NULL,
         'RFI "Drawings" was created AND due 2026-07-23; a same-day due date is not a deadline'
  UNION ALL
  SELECT 'future_due_passes_through',
         projects.work_item_mirror_due_date(CURRENT_DATE + 14) = CURRENT_DATE + 14,
         'a real future deadline the raiser set is honoured'
  UNION ALL
  SELECT 'null_due_stays_null',
         projects.work_item_mirror_due_date(NULL) IS NULL,
         'no source date at all: item 2''s trigger computes A(b)''s offset'
  UNION ALL
  -- Improvement 1. Every one of these is a live value measured on production.
  SELECT 'diary_none_is_not_a_delay',
         projects.diary_delay_text('None,', NULL) IS NULL
     AND projects.diary_delay_text('None', NULL) IS NULL
     AND projects.diary_delay_text('NO', NULL) IS NULL
     AND projects.diary_delay_text(NULL, 'n/a') IS NULL
     AND projects.diary_delay_text('  none.  ', NULL) IS NULL,
         'all 6 of 6 live "delays" are negations: None, / None, / None / None / NO / "No delays or info required…"'
  UNION ALL
  SELECT 'diary_long_negation_is_not_a_delay',
         projects.diary_delay_text('No delays or info required was noted in the site walk and or meeting', NULL) IS NULL,
         'the 2026-06-02 entry: a sentence, not a token, so a token stop-list alone is not enough'
  UNION ALL
  SELECT 'diary_real_delay_survives',
         projects.diary_delay_text('Crane stood down 4h awaiting sparks', NULL)
           = 'Crane stood down 4h awaiting sparks',
         'a real delay must still project, or the stop-list has eaten the feature'
  UNION ALL
  SELECT 'diary_notes_fallback',
         projects.diary_delay_text(NULL, 'Late delivery of DB-04A') = 'Late delivery of DB-04A',
         'delay_notes (00017:18) is the second source, added after the original column';
  ```

- [ ] **Step 2: Run it, watch it fail** with `ERROR: 42883: function projects.map_source_status(unknown,unknown) does not exist`.

- [ ] **Step 3: Append section C to the migration.**
  ```sql
  -- ─── C. Status, due date, and what counts as a delay ─────────────────────────
  -- Pure vocabulary. IMMUTABLE because it reads nothing. Every value in every
  -- source table's own status CHECK has an arm here — mapped, or explicitly NULL
  -- meaning "leaves the universal status unchanged" (§03 §1.8). A contract test
  -- parses both sides and fails on any value with no arm.
  CREATE OR REPLACE FUNCTION projects.map_source_status(p_item_type text, p_source_status text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE p_item_type
      WHEN 'rfi' THEN CASE p_source_status
        -- No 'draft' arm with meaning: rfiService.create hardcodes status:'open'
        -- (rfi.service.ts:100) and no code path writes 'draft'; it exists only
        -- in the 00002:90 CHECK.
        WHEN 'draft'     THEN NULL
        WHEN 'open'      THEN 'open'
        WHEN 'responded' THEN 'answered'
        WHEN 'closed'    THEN 'closed'
        ELSE NULL END
      WHEN 'snag' THEN CASE p_source_status
        WHEN 'open'             THEN 'open'
        WHEN 'in_progress'      THEN 'open'
        -- resolved/pending_sign_off both mean "the contractor says it is done and
        -- the PM has the ball", which is exactly 'answered'. Sign-off is the PM's
        -- act (§03 §1.5: the snag gatekeeper is the PM, not the raiser).
        WHEN 'resolved'         THEN 'answered'
        WHEN 'pending_sign_off' THEN 'answered'
        WHEN 'signed_off'       THEN 'closed'
        WHEN 'closed'           THEN 'closed'
        ELSE NULL END
      WHEN 'inspection' THEN CASE p_source_status   -- §03 §1.10, verbatim
        WHEN 'assigned'              THEN 'open'
        WHEN 'in_progress'           THEN 'open'
        WHEN 'awaiting_verification' THEN 'answered'
        WHEN 'certified'             THEN 'closed'
        WHEN 're-inspect_required'   THEN 'open'
        WHEN 'abandoned'             THEN 'void'
        ELSE NULL END
      WHEN 'qc_defect' THEN CASE p_source_status    -- source_status mirrors conformance
        WHEN 'fail' THEN NULL                        -- in scope; triage/open rules decide
        WHEN 'pass' THEN 'closed'                    -- the defect was corrected
        -- 'na' is the column DEFAULT (00176:54) and all 11 live entries carry it.
        -- Reading it as a close would mass-close items on a default value.
        WHEN 'na'   THEN NULL
        ELSE NULL END
      WHEN 'form_action' THEN CASE p_source_status
        WHEN 'draft'       THEN NULL
        WHEN 'submitted'   THEN 'answered'
        WHEN 'distributed' THEN 'closed'
        WHEN 'void'        THEN 'void'
        ELSE NULL END
      -- projects.site_diary_entries has no status column at all (00002:146-158,
      -- 00017:14-18). The delay item's lifecycle is entirely spine-side.
      WHEN 'diary_action' THEN NULL
      ELSE NULL END
  $fn$;

  -- Policy. Reconciles a mapping with §03 §1.6's triage rule.
  CREATE OR REPLACE FUNCTION projects.work_item_status_for_mirror(
      p_current text, p_mapped text, p_has_explicit_assignee boolean)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
      -- void is terminal (00196:1701-1709, and this plan's "no un-projection
      -- path"). Under the depth-scoped exemption the mirror bypasses item 2's
      -- machine, so this arm is the only thing stopping abandoned →
      -- re-inspect_required from un-voiding a row that still carries its old
      -- void_reason. A voided source that is genuinely revived is a new record.
      WHEN p_current = 'void' THEN 'void'
      -- Terminal states always win: a source that closed, was answered or was
      -- voided says so regardless of where the item sat.
      WHEN p_mapped IN ('answered','closed','void') THEN p_mapped
      -- Insert path (§03 §1.6).
      WHEN p_current IS NULL AND p_has_explicit_assignee THEN 'open'
      WHEN p_current IS NULL                             THEN 'triage'
      -- A mapped 'open' must never un-triage: A(b) maps inspection.assigned →
      -- open, and every unowned inbound item is born triage. Only the triage
      -- owner's explicit assign moves it (§03 §1.6: assign, re-date, or void).
      WHEN p_current = 'triage'  THEN 'triage'
      WHEN p_mapped  = 'open'    THEN 'open'
      ELSE p_current
    END
  $fn$;

  -- Improvement 6: a projected item may never arrive already overdue.
  -- Measured 2026-09-10: RFI "Drawings" was created AND due 2026-07-23; five
  -- August RFIs were created 08-17 and due 08-18 against A(b)'s +7 wd default;
  -- 15 of 18 inspections carry a scheduled_at in the past. Returning NULL hands
  -- the decision to item 2's BEFORE INSERT trigger, which computes the TYPE's
  -- offset on the TYPE's calendar (A(b), A(h)) — so no new calendar maths lives
  -- here and there is nothing to keep in sync.
  -- STABLE, not IMMUTABLE: it reads CURRENT_DATE.
  CREATE OR REPLACE FUNCTION projects.work_item_mirror_due_date(p_source date)
  RETURNS date LANGUAGE sql STABLE AS $fn$
    SELECT CASE WHEN p_source IS NULL OR p_source <= CURRENT_DATE THEN NULL ELSE p_source END
  $fn$;

  -- Improvement 1: what actually counts as a delay.
  -- projects.site_diary_entries has no "was there a delay" flag, only two free
  -- text columns (delays, 00002:154; delay_notes, 00017:18). Measured 2026-09-10,
  -- ALL SIX entries a non-empty test would have projected are negations:
  --   'None,'  'None,'  'None'  'None'  'NO'
  --   'No delays or info required was noted in the site walk and or meeting'
  -- A non-empty test measures whether the box was filled in, not whether a delay
  -- occurred — the same class of error as counting form_responses newlines.
  -- Contractors will keep typing "None" daily, so this lives on the LIVE path,
  -- not only in the backfill.
  CREATE OR REPLACE FUNCTION projects.diary_delay_text(p_delays text, p_delay_notes text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    WITH candidate AS (
      SELECT COALESCE(NULLIF(TRIM(p_delays), ''), NULLIF(TRIM(p_delay_notes), '')) AS t
    )
    SELECT CASE
      WHEN c.t IS NULL THEN NULL
      -- exact-token negations
      WHEN lower(regexp_replace(c.t, '[[:punct:][:space:]]+$', ''))
             IN ('none','no','n/a','na','nil','nothing','-','0','none noted','no delays') THEN NULL
      -- sentence negations: the 2026-06-02 entry is a full sentence, so a token
      -- list alone would have let it through.
      WHEN lower(c.t) ~ '^(no|none|nil|nothing)\y[^.]{0,80}(delay|issue|problem|info)' THEN NULL
      ELSE c.t
    END
    FROM candidate c
  $fn$;
  ```

- [ ] **Step 4: Run the probe and watch 25/25 pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/03-status-map.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  (Eleven `cases` rows plus fourteen `UNION ALL` rows. If the printed `assertions seen:` list is shorter than twenty-five, an arm was dropped — read the list, not the total.)

- [ ] **Step 5: Mutation-verify the stop-list against the real live strings.** Change `diary_delay_text` to `SELECT COALESCE(NULLIF(TRIM(p_delays),''), NULLIF(TRIM(p_delay_notes),''))` — the original non-empty predicate — and re-run. Expected:
  ```
  FAIL  diary_none_is_not_a_delay            all 6 of 6 live "delays" are negations: …
  FAIL  diary_long_negation_is_not_a_delay   the 2026-06-02 entry: a sentence, not a token, …
  ```
  Then restore only the token list (delete the sentence-negation arm) and re-run: `diary_none_is_not_a_delay` passes, `diary_long_negation_is_not_a_delay` still FAILs. Restore both. Record 25/25 → 23/25 → 24/25 → 25/25. Then delete the `WHEN p_current = 'void' THEN 'void'` arm and re-run: `FAIL void_is_terminal`. Restore. Record 25/25 → 24/25 → 25/25.

- [ ] **Step 6: Write the contract test.** This is the half the SQL probe cannot do: it proves no source status value has been *forgotten*. Create `apps/web/src/lib/work-items/source-status-map.contract.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'

  /**
   * Contract test: projects.map_source_status must carry an arm for every value
   * in every mirrored source table's own status CHECK, and every non-null result
   * must be a member of the projects.work_items status CHECK.
   *
   * The fixture is the migrations themselves, on both sides. A hardcoded list
   * here would pass forever after someone widened a source CHECK — which is how
   * `photo_type: 'defect'` shipped and produced zero rows in field.snag_photos.
   */
  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  /** Find a migration by a distinctive string in its BODY, never by filename. */
  function migrationContaining(needle: string): string {
    for (const n of readdirSync(MIG_DIR).sort()) {
      const sql = readFileSync(join(MIG_DIR, n), 'utf8')
      if (sql.includes(needle)) return sql
    }
    throw new Error(`no migration contains ${JSON.stringify(needle)}`)
  }

  const mirrorSql = () =>
    migrationContaining('CREATE OR REPLACE FUNCTION projects.map_source_status')
  const spineSql = () => migrationContaining('CREATE TABLE projects.work_items')

  /**
   * Values in the `<col> IN (…)` CHECK for `column`, searched ONLY from `anchor`
   * onward. The anchor is mandatory: in 00002_projects_schema.sql the FIRST
   * `CHECK (status IN (…))` is projects.projects at line 20
   * (planning|active|on_hold|completed|cancelled), not projects.rfis at line 90.
   * An unanchored search demands that the rfi arm cover the project vocabulary
   * and fails permanently.
   */
  function checkValues(sql: string, anchor: string, column: string): string[] {
    const start = sql.indexOf(anchor)
    if (start < 0) throw new Error(`anchor not found: ${anchor}`)
    const slice = sql.slice(start)
    const re = new RegExp(`${column}[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i')
    const m = slice.match(re)
    if (!m) throw new Error(`no CHECK found for ${column} after ${anchor}`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }

  /** The `WHEN '<x>' THEN` arms inside one `WHEN '<type>' THEN CASE …` block. */
  function armsForType(sql: string, itemType: string): string[] {
    const start = sql.indexOf(`WHEN '${itemType}' THEN`)
    if (start < 0) throw new Error(`map_source_status has no arm for item_type '${itemType}'`)
    const rest = sql.slice(start + 10)
    const end = rest.search(/\n\s*WHEN '[a-z_]+' THEN CASE|\n\s*ELSE NULL END\s*\n\s*\$fn\$/)
    const block = rest.slice(0, end < 0 ? rest.length : end)
    return [...block.matchAll(/WHEN\s+'([^']+)'\s+THEN/g)].map((x) => x[1])
  }

  const SOURCES = [
    { type: 'rfi',         needle: 'CREATE TABLE projects.rfis',
      anchor: 'CREATE TABLE projects.rfis',            column: 'status',
      expect: ['draft', 'open', 'responded', 'closed'] },
    { type: 'snag',        needle: 'CREATE TABLE field.snags',
      anchor: 'CREATE TABLE field.snags',              column: 'status',
      expect: ['open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed'] },
    { type: 'inspection',  needle: 'CREATE TABLE inspections.inspections',
      anchor: 'CREATE TABLE inspections.inspections',  column: 'status',
      expect: ['assigned', 'in_progress', 'awaiting_verification', 'certified',
               're-inspect_required', 'abandoned'] },
    { type: 'qc_defect',   needle: 'qc_entries_conformance_check',
      anchor: 'qc_entries_conformance_check',          column: 'conformance',
      expect: ['pass', 'fail', 'na'] },
    { type: 'form_action', needle: 'CREATE TABLE field.site_forms',
      anchor: 'CREATE TABLE field.site_forms',         column: 'status',
      expect: ['draft', 'submitted', 'distributed', 'void'] },
  ] as const

  describe('map_source_status covers every source vocabulary', () => {
    for (const s of SOURCES) {
      it(`${s.type}: the parser reads the right CHECK`, () => {
        // Assert the PARSE before comparing it to anything. An anchor that
        // silently matched the wrong table would otherwise make the next test
        // pass or fail for a reason that has nothing to do with the mapping.
        const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
        expect(values.sort()).toEqual([...s.expect].sort())
      })

      it(`${s.type}: every value in the source CHECK has an arm`, () => {
        const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
        const arms = armsForType(mirrorSql(), s.type)
        const missing = values.filter((v) => !arms.includes(v))
        expect(missing, `${s.type} has no arm for: ${missing.join(', ')}`).toEqual([])
      })
    }

    it('diary_action is mapped to NULL unconditionally (the source has no status column)', () => {
      expect(mirrorSql()).toMatch(/WHEN 'diary_action' THEN NULL/)
    })

    it('every mapped result is a member of the work_items status CHECK', () => {
      const universal = checkValues(spineSql(), 'CREATE TABLE projects.work_items', 'status')
      expect(universal.sort()).toEqual(['answered', 'closed', 'open', 'triage', 'void'])
      const produced = [...mirrorSql().matchAll(/WHEN\s+'[^']+'\s+THEN\s+'([a-z_]+)'/g)].map((x) => x[1])
      const rogue = [...new Set(produced)].filter((p) => !universal.includes(p))
      expect(rogue, `map_source_status produces non-universal states: ${rogue.join(', ')}`).toEqual([])
    })

    it('the diary negation stop-list exists and covers every live value', () => {
      const sql = mirrorSql()
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION projects\.diary_delay_text/)
      for (const token of ['none', 'no', 'n/a', 'na', 'nil', 'nothing']) {
        expect(
          sql,
          `diary_delay_text must stop-list ${JSON.stringify(token)} — all 6 of 6 live ` +
          `site_diary_entries "delays" values are negations (measured 2026-09-10)`,
        ).toContain(`'${token}'`)
      }
      // The 2026-06-02 entry is a sentence, so the token list alone is not enough.
      expect(sql).toMatch(/\^\(no\|none\|nil\|nothing\)/)
    })
  })
  ```

- [ ] **Step 7: Run it and watch it pass.**
  ```bash
  pnpm --filter web test -- source-status-map
  ```
  Expected: 13 passed (5 parse + 5 coverage + diary-null + universal + stop-list).

- [ ] **Step 8: Prove the contract test can fail, three ways.** One at a time, undo, run, confirm the named failure, restore:
  - delete `WHEN 'pending_sign_off' THEN 'answered'` ⇒ *"snag has no arm for: pending_sign_off"*
  - change the `rfi` anchor to the bare string `'status'` ⇒ *"rfi: the parser reads the right CHECK"* fails with the `projects.projects` vocabulary, which is the whole reason the anchor exists
  - delete `'nil'` from `diary_delay_text` ⇒ *"diary_delay_text must stop-list \"nil\" — all 6 of 6 live … values are negations"*

  Record 13 → 12 → 13 for each in the PR body.

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          apps/web/src/lib/work-items/source-status-map.contract.test.ts \
          scripts/db/probes/03-status-map.sql
  git commit -m "feat(work-items): status mapping, non-overdue due dates, and the diary negation stop-list

A mapped 'open' cannot un-triage, and void is terminal on the mirror side (the
mirror bypasses item 2's machine under the depth exemption). A source due date
at or before today becomes NULL so item 2's trigger computes the type's own
offset. And all six live diary 'delays' values are the word None — a non-empty
test measures whether the box was filled in, not whether a delay happened."
  ```

---

## Task 5 — The RFI projection: the reference implementation (F6, F7, F11's sibling #4, improvements 4, 6, 8, 10)

This is the pattern Tasks 7–11 repeat. Read it first and repeat it deliberately rather than abstracting it — five of the six differ in their column names, their title expression, their priority source and their gatekeeper, which is most of the function.

⚠ **Every probe from here to Task 15 runs as `postgres` with `auth.uid()` NULL (F9) — which is item 2's guard's service path (`00196:1540`).** Their UPDATE-arm assertions pass whatever the guard says. The guard's behaviour on a mirror write in a *signed-in* session is proved once, under impersonation, in Task 5½ — which must land before Task 6, because Task 6's probe reassigns on the spine and Task 7 onward push status from the source.

**Two functions per source, and the split is load-bearing** (improvement 10):

| | What it is | Who calls it |
|---|---|---|
| `projects.project_rfi(uuid)` | Plain function. Reads the RFI row by id, does the whole projection. Carries **no** recursion guard. | the wrapper, and **the backfill (section H) directly** |
| `projects.mirror_rfi_work_item()` | Trigger wrapper. Two lines: the depth guard, then `PERFORM projects.project_rfi(NEW.id)`. | the two triggers |

Why: the backfill must project 15 RFIs without touching a source row. Every source table carries a `BEFORE UPDATE set_updated_at` trigger (`rfis_updated_at` `00002:100`, `snags_updated_at` `00004:33`, and four more, all verified in `pg_trigger`), so `UPDATE projects.rfis SET status = status` would rewrite `updated_at` on 15 live rows whose values currently span 24 Jun – 2 Sep. It would also fire `field.site_forms`' `trg_site_forms_transition`, whose body raises `42501` on a same-status update of any non-draft form and is escaped only by `current_user IN ('postgres','service_role','supabase_admin')` (`00179:353`) — making the backfill depend on the role `db push` happens to use. And with F7's `WHEN` predicates in place, a no-op UPDATE fires **nothing at all**, so the old backfill would have inserted zero rows.

**Three loop defences, doing three different jobs** (§03 §1.2). Do not collapse them:
1. The `WHEN` clause on the `_upd` trigger — stops the trigger firing at all on an unrelated `UPDATE`.
2. `pg_trigger_depth() > 1` inside the **wrapper** — **this is what terminates the cycle**, measured (F2).
3. The value-difference check in the write-back (Task 6) — prevents write amplification and a spurious `updated_at` bump on the source, not recursion.

**Two triggers, not one** (F7). PostgreSQL rejects `WHEN (OLD.…)` on a trigger whose event list includes `INSERT`:
```
ERROR:  42P17: INSERT trigger's WHEN condition cannot reference OLD values
```
so §03 §1.2's single declaration is split into `_ins` (`AFTER INSERT`, no `WHEN`) and `_upd` (`AFTER UPDATE OF …` with the mandated `WHEN`).

**Files:**
- Modify: the migration — start section D
- Test: `scripts/db/probes/04-rfi-mirror.sql`

- [ ] **Step 1: Write the probe first, from the empty state.** Every mutation lives inside the `DO` block and its observations are recorded into a temp table; the file ends in one assertion `SELECT`. Create `scripts/db/probes/04-rfi-mirror.sql`:
  ```sql
  -- Walks from an empty project, never from seeded data (§12 §(h)).
  -- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
  -- in a FROM clause (42601), and sibling parts of one statement read the
  -- pre-update snapshot — so an assertion that "the status changed" written as a
  -- subquery beside the UPDATE can never be true.
  DO $probe$
  DECLARE
    v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
    v_pm    uuid;
    v_other uuid;
    v_proj  uuid;
    v_rfi   uuid;
    v_closed_rfi uuid;
    v_after_insert  record;
    v_after_respond record;
    v_closed_item   record;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_other FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_rfi_mirror', 'active', 'ZAR', v_pm)
    RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

    -- Raised by v_other (a non-owner), with NO assignee and a due date of TODAY —
    -- the exact live shape of RFI "Drawings" (created and due 2026-07-23).
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by, due_date)
    VALUES (v_proj, v_org, 'Probe RFI', 'body', 'high', 'open', v_other, CURRENT_DATE)
    RETURNING id INTO v_rfi;

    SELECT w.id, w.item_type, w.title, w.priority, w.status, w.source_status,
           w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date, w.origin,
           w.opened_at, w.closed_at, w.closed_by
      INTO v_after_insert
      FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

    -- Push-back from the source. This probe runs as postgres (auth.uid() NULL),
    -- which is the guard's SERVICE path — so this UPDATE cannot be refused here
    -- whatever the guard says. F8's evidence is probe 05b (Task 5½), which does
    -- the same thing as a signed-in contractor.
    UPDATE projects.rfis SET status = 'responded' WHERE id = v_rfi;

    SELECT w.status, w.ball_in_court_id INTO v_after_respond
      FROM projects.work_items w WHERE w.rfi_id = v_rfi;

    -- A second projection through a column in the UPDATE OF list that does NOT
    -- change status. If ON CONFLICT were removed this would raise 23505; if the
    -- upsert target were wrong it would create a second item.
    UPDATE projects.rfis SET priority = 'low' WHERE id = v_rfi;

    -- A BORN-CLOSED source with historical stamps — the shape of the 6 closed
    -- RFIs the backfill will project (#4). On the service path §5 keeps a
    -- supplied opened_at (00196:629-636) and there is no guard on INSERT, so
    -- what the projection supplies is what the row carries.
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by, closed_at, closed_by, created_at)
    VALUES (v_proj, v_org, 'Probe closed RFI', 'body', 'low', 'closed', v_other,
            now() - interval '20 days', v_pm, now() - interval '40 days')
    RETURNING id INTO v_closed_rfi;

    SELECT w.status, w.opened_at, w.closed_at, w.closed_by INTO v_closed_item
      FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

    CREATE TEMP TABLE rfi_ctx(
      rfi uuid, closed_rfi uuid, proj uuid, pm uuid, other uuid,
      ins_status text, ins_bic uuid, ins_assignee uuid, ins_gate uuid,
      ins_due date, ins_title text, ins_priority text, ins_source_status text, ins_type text,
      ins_opened_at timestamptz,
      resp_status text, resp_bic uuid,
      closed_status text, closed_opened_at timestamptz, closed_closed_at timestamptz, closed_closed_by uuid)
      ON COMMIT DROP;
    INSERT INTO rfi_ctx VALUES (
      v_rfi, v_closed_rfi, v_proj, v_pm, v_other,
      v_after_insert.status, v_after_insert.ball_in_court_id, v_after_insert.assignee_id,
      v_after_insert.gatekeeper_id, v_after_insert.due_date, v_after_insert.title,
      v_after_insert.priority, v_after_insert.source_status, v_after_insert.item_type,
      v_after_insert.opened_at,
      v_after_respond.status, v_after_respond.ball_in_court_id,
      v_closed_item.status, v_closed_item.opened_at, v_closed_item.closed_at, v_closed_item.closed_by);
  END $probe$;

  SELECT 'item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, rfi_ctx c
           WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per RFI' AS detail
  UNION ALL
  SELECT 'item_shape',
         (SELECT c.ins_type = 'rfi' AND c.ins_title = 'Probe RFI' AND c.ins_priority = 'high'
             AND c.ins_source_status = 'open' AND c.ins_assignee IS NOT NULL
             AND c.ins_gate IS NOT NULL AND c.ins_due IS NOT NULL FROM rfi_ctx c),
         'type/title/priority/source_status/people/due all set at insert'
  UNION ALL
  SELECT 'born_in_triage',
         (SELECT c.ins_status = 'triage' FROM rfi_ctx c),
         '§03 §1.6: no explicit assignee ⇒ triage'
  UNION ALL
  SELECT 'bic_is_the_assignee',
         (SELECT c.ins_bic = c.ins_assignee FROM rfi_ctx c),
         'A(a): non-null from the first millisecond, and on triage it is the assignee'
  UNION ALL
  -- Improvement 4.
  SELECT 'gatekeeper_is_the_raiser',
         (SELECT c.ins_gate = c.other FROM rfi_ctx c),
         'A(b) as amended: an RFI is closed by the person who asked, once the answer is usable'
  UNION ALL
  SELECT 'assignee_is_not_the_gatekeeper',
         (SELECT c.ins_assignee <> c.ins_gate FROM rfi_ctx c),
         '§03 §1.8''s "only the gatekeeper may close" is vacuous when they are the same person'
  UNION ALL
  -- Improvement 6.
  SELECT 'not_born_overdue',
         (SELECT c.ins_due > CURRENT_DATE FROM rfi_ctx c),
         'the source said due TODAY; item 2''s trigger must have computed +7 wd instead'
  UNION ALL
  SELECT 'raiser_is_watcher',
         EXISTS (SELECT 1 FROM projects.work_item_watchers ww
                   JOIN projects.work_items w ON w.id = ww.work_item_id
                   JOIN rfi_ctx c ON c.rfi = w.rfi_id
                  WHERE ww.user_id = c.other),
         '§03 §1.5: the raiser is a watcher — seeded by item 2''s §11 from created_by (00196:1378-1387), which the mirror sets to raised_by; this migration seeds nothing'
  UNION ALL
  -- Service-path push-back. NOT F8's evidence: as postgres the guard is exempt.
  SELECT 'status_pushback',
         (SELECT c.resp_status = 'answered' FROM rfi_ctx c),
         'responded ⇒ answered on the service path. The signed-in case is probe 05b (Task 5½)'
  UNION ALL
  SELECT 'bic_moves_to_gatekeeper',
         (SELECT c.resp_bic = c.ins_gate FROM rfi_ctx c),
         'answered ⇒ the ball is with the person who asked'
  UNION ALL
  SELECT 'idempotent_reprojection',
         (SELECT count(*) FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id = c.rfi) = 1,
         'a second projection (priority edit) must not create a second item'
  UNION ALL
  SELECT 'reprojection_kept_the_status',
         (SELECT w.status FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id = c.rfi) = 'answered',
         'the update arm must not reset a terminal status on an unrelated edit'
  UNION ALL
  -- #4: historical stamps travel with the projection.
  SELECT 'opened_at_is_source_created_at',
         (SELECT c.closed_opened_at = (SELECT r.created_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
            FROM rfi_ctx c),
         '#4: opened_at = rfis.created_at, kept on the service path (00196:629-636); §11 dates the created event at it'
  UNION ALL
  SELECT 'born_closed_carries_source_stamps',
         (SELECT c.closed_status = 'closed'
             AND c.closed_closed_at = (SELECT r.closed_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
             AND c.closed_closed_by = c.pm
            FROM rfi_ctx c),
         '#4: a born-closed RFI carries closed_at/closed_by from the source, or metric 7 and the feed lie for the 6 closed live RFIs';
  ```
  ⚠ Everything runs inside the harness's single rolled-back transaction, so the probe project and its RFIs never exist. **Do not add a `COMMIT`** — the harness refuses it. ⚠ The two inserts consume **two** values of `projects.rfis_rfi_number_seq`, which a rollback does not return. That is two numbers; the 50,000-row scale probe in Task 15 is the one that must restore the sequence.

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/04-rfi-mirror.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `FAIL  item_created  one mirror item per RFI` and `0/14` — no trigger exists, so the RFIs produce nothing and every recorded observation is NULL.

- [ ] **Step 3: Append the RFI projection to the migration.**
  ```sql
  -- ─── D. Projection ───────────────────────────────────────────────────────────
  -- Every function here is SECURITY DEFINER (§03 §1.2): it writes assignee_id,
  -- gatekeeper_id and due_date, which the contractor who raised the RFI must not
  -- be able to forge, and without it item 2's RESTRICTIVE INSERT policy on
  -- work_items would be evaluated against that contractor and their perfectly
  -- legitimate RFI insert would fail. (Mechanism: the policies are TO
  -- authenticated, 00196:1107-1229; a SECURITY DEFINER function owned by
  -- postgres — table owner, BYPASSRLS — never evaluates them.) Attribution uses
  -- auth.uid(), never current_user, which resolves to the function OWNER.
  --
  -- ⚠ F8. Being SECURITY DEFINER does NOT change auth.uid(): inside these
  -- functions it is still the contractor who touched the source row, and item
  -- 2's transition guard exempts only auth.uid() IS NULL (00196:1540). Every
  -- UPDATE below would be refused in a signed-in session — clause (a) on a
  -- move, (a2) on a title re-projection, (b)/(c)/(d) on people and status —
  -- and the refusal would surface on the SOURCE edit. Section C' replaces the
  -- guard with the depth-scoped exemption its own comment names
  -- (pg_trigger_depth() > 1, 00196:1590-1605): these UPDATEs run at depth 2.
  --
  -- Watchers: NOT seeded here. §11 (00196:1378-1387) seeds created_by,
  -- assignee and gatekeeper on INSERT and on every people change, in an AFTER
  -- ROW trigger that fires before any statement here could — every row a
  -- seeder wrote would hit DO NOTHING. The mirror sets created_by = the raiser.
  --
  -- Historical stamps (#4): every INSERT supplies opened_at (= the source's
  -- created_at; §5 keeps it on the service path, 00196:629-636, and §11 dates
  -- the created event at it), last_activity_at, and for a terminal mapping the
  -- source's own closed_at / closed_by / void reason. On the live path §5
  -- overwrites the two timestamps with the same instant; on the backfill they
  -- are what stop 34 items dating their created event in the apply week.

  -- The projection body. Plain function, no recursion guard, callable directly —
  -- which is how the backfill projects 15 RFIs without touching a source row.
  CREATE OR REPLACE FUNCTION projects.project_rfi(p_rfi_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    r          projects.rfis%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid;
    v_gate     uuid;
    v_mapped   text;
    v_moved    boolean;
  BEGIN
    SELECT * INTO r FROM projects.rfis WHERE id = p_rfi_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE rfi_id = r.id AND origin = 'mirror';

    v_mapped := projects.map_source_status('rfi', r.status);

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_mirror_assignee(r.project_id, 'rfi', r.assigned_to);
      -- Improvement 4: the RFI gatekeeper is the RAISER, not the project PM.
      -- Measured: triage_owner_id and the PM resolver both return the same person
      -- on 13 of 14 projects, so a PM gatekeeper makes assignee and gatekeeper
      -- identical on every live RFI and §03 §1.8's close gate vacuous. 12 of 15
      -- live RFIs were raised by contractors, and this is the only mechanism in
      -- Q1 that puts an item into a contractor's ball-in-court. If the raiser is
      -- ineligible (departed, or a client viewer) the resolver falls back to the PM.
      -- The registry row agrees: section C' sets rfi.gatekeeper_rule = 'creator'.
      v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id,
        opened_at, last_activity_at, closed_at, closed_by)
      VALUES (
        r.organisation_id, r.project_id, 'rfi', 'mirror', r.subject, r.priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, r.assigned_to IS NOT NULL),
        r.status, v_assignee, v_gate,
        -- Improvement 6: a past or same-day source date becomes NULL so item 2's
        -- BEFORE INSERT trigger computes A(b)'s +7 wd on the office calendar.
        projects.work_item_mirror_due_date(r.due_date),
        r.raised_by, r.id,
        -- #4: historical stamps. §5 overwrites opened_at/last_activity_at for a
        -- client session (same instant — harmless) and keeps them on the service
        -- path, which is the backfill. closed_* only when the source is closed.
        r.created_at, r.updated_at,
        CASE WHEN r.status = 'closed' THEN COALESCE(r.closed_at, r.updated_at) END,
        CASE WHEN r.status = 'closed' THEN r.closed_by END)
      -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6).
      -- Measured: this swallows a duplicate projection, leaves an origin='split'
      -- row on the same source untouched, and STILL raises 23505 on a
      -- work_items_ref_unique collision — which the bare form would have hidden,
      -- turning a ref numbering race into a silently missing inbox item.
      -- The index is work_items_src_rfi_uidx (00196:371).
      ON CONFLICT (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 has already done it (see the section comment).
    ELSE
      -- Improvement 8: a project move re-resolves both people. §15's rollout has
      -- already decided "snags move to KINGSWALK", and correcting an RFI raised on
      -- the wrong project is routine in a 14-project estate. Without this the item
      -- keeps the old project's scope and counts and its assignee may not be a
      -- member of the new project at all — which item 2's assignee-membership
      -- trigger would have rejected had the row been inserted that way.
      -- ⚠ Clause (a) of the guard makes project_id/organisation_id immutable for
      -- a signed-in actor; this UPDATE runs at depth 2 and rides section C''s
      -- exemption. The membership trigger (00196:961-984, UPDATE OF … project_id)
      -- still re-validates both people and fires BEFORE the guard by name order,
      -- so a move to a project the people are not on reports the MEMBERSHIP
      -- sentence. §11 records NO event for a move — the feed shows it only through
      -- the people/status events beside it.
      v_moved := v_item.project_id IS DISTINCT FROM r.project_id;

      IF v_moved THEN
        v_assignee := projects.resolve_mirror_assignee(r.project_id, 'rfi', r.assigned_to);
        v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);
      ELSE
        v_assignee := COALESCE(
          CASE WHEN projects.work_item_person_eligible(r.project_id, r.assigned_to)
               THEN r.assigned_to END,
          v_item.assignee_id);
        v_gate := v_item.gatekeeper_id;
      END IF;

      UPDATE projects.work_items
         SET project_id       = r.project_id,
             organisation_id  = r.organisation_id,
             title            = r.subject,
             priority         = r.priority,
             source_status    = r.status,
             status           = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id      = v_assignee,
             gatekeeper_id    = v_gate,
             closed_at        = CASE WHEN r.status = 'closed'
                                     THEN COALESCE(v_item.closed_at, r.closed_at, now())
                                     ELSE NULL END,
             closed_by        = CASE WHEN r.status = 'closed'
                                     THEN COALESCE(v_item.closed_by, r.closed_by) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  -- The trigger wrapper. Two lines: the guard that terminates the mirror ⇄
  -- write-back cycle (measured trace mirror@1 → writeback@2 → mirror@3 → skipped;
  -- removing it and the write-back's value check produces
  -- "ERROR: 54001: stack depth limit exceeded"), then the projection.
  CREATE OR REPLACE FUNCTION projects.mirror_rfi_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_rfi(NEW.id);
    RETURN NULL;   -- AFTER trigger; the return value is ignored
  END $fn$;

  -- F7: two triggers, because PostgreSQL rejects a WHEN clause referencing OLD on
  -- a trigger whose event list includes INSERT ("INSERT trigger's WHEN condition
  -- cannot reference OLD values"). §03 §1.2's single declaration is not valid SQL.
  CREATE TRIGGER rfis_mirror_work_item_ins
    AFTER INSERT ON projects.rfis
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_rfi_work_item();

  CREATE TRIGGER rfis_mirror_work_item_upd
    AFTER UPDATE OF subject, priority, status, due_date, assigned_to,
                    closed_at, closed_by, project_id, organisation_id
    ON projects.rfis
    FOR EACH ROW
    WHEN (OLD.subject         IS DISTINCT FROM NEW.subject
       OR OLD.priority        IS DISTINCT FROM NEW.priority
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.due_date        IS DISTINCT FROM NEW.due_date
       OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
       OR OLD.closed_at       IS DISTINCT FROM NEW.closed_at
       OR OLD.closed_by       IS DISTINCT FROM NEW.closed_by
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_rfi_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 14/14 pass.** Read the `assertions seen:` line; if it is shorter than fourteen names, a `UNION ALL` arm was dropped.

- [ ] **Step 5: Do NOT try to prove F8 here.** The 2026-09-10 plan stacked a copy of item 2's guard "without the exemption" under this probe and expected a `P0001`. That experiment is structurally incapable of failing: this probe runs as `postgres` with `auth.uid()` NULL, which is the guard's service path (`00196:1540`) — the guard returns early whatever exemption text it carries, so `status_pushback` passes with item 2's guard, with the replacement, and with no guard at all. F8's evidence is **probe 05b in Task 5½**, which pushes the status back as a signed-in contractor and records the (c)-clause sentence item 2's guard produces without the exemption. Move on.

- [ ] **Step 6: Mutation-verify improvement 4.** Change `projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by)` to `(r.project_id, NULL)` in **both** arms. Re-run. Expected:
  ```
  FAIL  gatekeeper_is_the_raiser         A(b) as amended: an RFI is closed by the person who asked, …
  FAIL  assignee_is_not_the_gatekeeper   §03 §1.8's "only the gatekeeper may close" is vacuous …
  FAIL  bic_moves_to_gatekeeper          answered ⇒ the ball is with the person who asked
  ```
  Restore. Record 14/14 → 11/14 → 14/14.

- [ ] **Step 7: Mutation-verify improvement 6.** Change `projects.work_item_mirror_due_date(r.due_date)` to `r.due_date`. Re-run. Expected: `FAIL not_born_overdue  the source said due TODAY; item 2's trigger must have computed +7 wd instead`. Restore.

- [ ] **Step 7b: Mutation-verify the historical stamps (#4).** Delete `opened_at, last_activity_at, closed_at, closed_by` from the INSERT's column list and the four matching VALUES. Re-run. Expected:
  ```
  FAIL  opened_at_is_source_created_at      #4: opened_at = rfis.created_at, …
  FAIL  born_closed_carries_source_stamps   #4: a born-closed RFI carries closed_at/closed_by from the source, …
  ```
  — `opened_at` defaulted to `now()` and the closed row carries NULL stamps. Restore. Record 14/14 → 12/14 → 14/14.

- [ ] **Step 8: Mutation-verify F6.** Replace the `ON CONFLICT (rfi_id) WHERE …` clause with a bare `ON CONFLICT DO NOTHING`. Re-run: still 14/14 — a bare form does not fail *this* probe, which is exactly the danger. Now run the collision by hand: append this to the `DO` block, before the temp table insert, and re-run with each form:
  ```sql
    -- With the explicit target this raises 23505 on work_items_ref_unique (A(a)).
    -- With a bare ON CONFLICT DO NOTHING it vanishes and nobody ever knows.
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin,
      ref, title, status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
    SELECT w.organisation_id, w.project_id, 'task', 'manual', w.ref, 'ref clash', 'open',
           w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, NULL
      FROM projects.work_items w WHERE w.rfi_id = v_rfi
    ON CONFLICT DO NOTHING;
  ```
  Expected with the bare form: the probe still reports 14/14 and the clashing row is silently absent. Expected with `ON CONFLICT ON CONSTRAINT work_items_ref_unique DO NOTHING` replaced by nothing at all:
  ```
  FAIL (HTTP 400)
  … ERROR: 23505: duplicate key value violates unique constraint "work_items_ref_unique"
  ```
  Restore the explicit target on `project_rfi` and remove the temporary insert. Record both outcomes in the PR body — this finding is about which errors stay visible, and only a by-hand comparison shows it.

- [ ] **Step 9: Note the deferred F2 mutation.** Changing `IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;` to `IF false THEN` cannot blow up until the write-back exists. **Task 6 Step 7 runs it.** Do not skip it.

- [ ] **Step 10: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/04-rfi-mirror.sql
  git commit -m "feat(work-items): RFI projection — project_rfi() + guarded wrapper + ins/upd triggers

The gatekeeper is the raiser, not the PM: triage_owner_id and the PM resolver
return the same person on 13 of 14 projects, so a PM gatekeeper makes assignee
and gatekeeper identical on every live RFI. A same-day source due date becomes
NULL so item 2's trigger computes +7 working days instead. Every INSERT carries
the source's own opened_at/closed_at/closed_by so the backfill does not date
34 items in the apply week. No watcher seeding: item 2's §11 already does it."
  ```

---

## Task 5½ — Replace item 2's transition guard with the depth-scoped exemption, and amend the `rfi` registry row (F8, improvement 4, #15)

**Why this is a whole task and why it sits here.** Item 2's `projects.work_items_transition_guard()` (`00196:1509–1759`) exempts only the service path (`auth.uid() IS NULL`). A mirror trigger runs in the source writer's session, where `auth.uid()` is a person, so every UPDATE arm written in Task 5 and repeated in Tasks 7–11 is refused in production: clause (a) on a project move, (a2) on any title re-projection of a mirrored row, (b) on a re-resolved assignee or an inspection forward-assignment, (c) on `triage→answered` when a contractor responds to an untriaged RFI, (c2)/(d) on a close by anyone but the gatekeeper, and the void-reason check — each surfacing as a `P0001` on the **source** edit. Nothing in Tasks 5–15 can see this, because every `rehearse-sql` probe runs as `postgres` (F9), which is the service path. Item 2's own comment (`00196:1590–1605`) names the fix: **`pg_trigger_depth() > 1`** — "a client statement is always depth 1, a trigger-driven UPDATE never is. Not `auth.uid() IS NULL`" — and says item 3 adds `source_status` to clause (a) under that same bypass. ⚠ `> 0` would exempt **every** direct client `UPDATE` (a top-level statement's trigger runs at depth 1) — i.e. disable the guard; probe 05b's `direct_title_edit_refused` is the assertion that catches that.

**The exemption gives the mirror exactly the service-path treatment:** stamps kept (`last_activity_at := now()`; `closed_at := now()` on a close, with the caller-supplied `closed_by` kept — `00196:1540–1547`), authority and the machine skipped, `void_reason` restored on non-void rows. Authority for a mirrored write was already checked on the source row by the module's own gates.

**Also here: the `rfi` registry row.** The mirror sets `created_by = raised_by` and the gatekeeper to the raiser (improvement 4); the registry says `'project_pm'` (`00196:239`) and the CHECK admits `'creator'` (`00196:202`). Items 4–6 read `gatekeeper_rule`; a reader would be wrong for the type carrying metric 4. The `UPDATE` lands in the same section, with the TS mirror in the same commit because item 2's `work-item-types.contract.test.ts` compares the two registries per key.

> ⚠ **OWNER DECISION (default: do it — `UPDATE projects.work_item_types SET gatekeeper_rule = 'creator' WHERE key = 'rfi'` in section C′, plus `gatekeeperRule: 'creator'` on the `rfi` entry of `WORK_ITEM_TYPES` in `packages/shared/src/work-items/types.ts`, plus A(b)'s `rfi` gatekeeper cell in Task 18 Step 8, all in this PR).** Improvement 4 was measured on 2026-09-10 (13 of 14 projects resolve the PM and the triage owner to one person; 12 of 15 RFIs were raised by contractors) and item 2 seeded `'project_pm'` without that measurement. **If the owner declines:** delete the `UPDATE` and the `sql: SELECT gatekeeper_rule = 'creator' …` directive from the `@verify` block, leave `types.ts` alone, change `project_rfi`'s gatekeeper call to `resolve_work_item_gatekeeper(r.project_id, NULL)` in both arms, drop probe 04's `gatekeeper_is_the_raiser` / `assignee_is_not_the_gatekeeper` / `bic_moves_to_gatekeeper` assertions and probe 16's `gatekeeper_is_the_contractor`, and skip Task 18 Step 8's A(b) change — the registry then stays truthful at `'project_pm'` and §03 §1.8's close gate is vacuous on every live RFI. Record the decision in the PR body either way.

**Files:**
- Modify: the migration — insert section C′ **between C and D** (not appended: it must read before the projections, and it must exist in the stacked file before Task 6's probe)
- Modify: `scripts/db/try-work-item-spine.sh` — `WITH_EXTRA`
- Modify: `packages/shared/src/work-items/types.ts` (owner decision default)
- Test: `scripts/db/probes/05b-guard-exemption.sql` (impersonated)

- [ ] **Step 1: Write the impersonated probe first.** Create `scripts/db/probes/05b-guard-exemption.sql`. Every id is captured as `postgres` **before** the first impersonation (Task 1's rule 3); the file ends by clearing the claim and asserting it.
  ```sql
  -- Runs the mirror in a SIGNED-IN session, which is the only place item 2's
  -- guard can refuse it. rbac-test (contractor on WM-Consulting) is the permanent
  -- prod fixture — never invite, email or notify it.
  DO $setup$
  DECLARE
    v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';
    v_pm   uuid; v_proj uuid; v_rfi1 uuid; v_rfi2 uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_guard', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;
    INSERT INTO projects.project_members (project_id, user_id, role, is_active)
    VALUES (v_proj, v_ctr, 'contractor', true);

    -- Two RFIs raised by the contractor, seeded as postgres (service path):
    -- both born triage with the contractor as gatekeeper (improvement 4).
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Guard probe 1', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi1;
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Guard probe 2', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi2;

    CREATE TEMP TABLE gd_ctx(proj uuid, ctr uuid, pm uuid, rfi1 uuid, rfi2 uuid,
      who text, resp_status text, title_err text, src_status_err text,
      close_status text, close_by uuid, pm_close_status text) ON COMMIT DROP;
    INSERT INTO gd_ctx (proj, ctr, pm, rfi1, rfi2) VALUES (v_proj, v_ctr, v_pm, v_rfi1, v_rfi2);
    GRANT SELECT, UPDATE ON gd_ctx TO authenticated;   -- a postgres temp table is unreadable after SET LOCAL ROLE (item 2, measured)
  END $setup$;

  DO $as_contractor$
  DECLARE c record; v_err text; v_status text; v_by uuid;
  BEGIN
    SELECT * INTO c FROM gd_ctx;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE gd_ctx SET who = current_user;

    -- 1. The contractor responds to their own UNTRIAGED RFI: triage → answered
    --    through the mirror. Clause (c) forbids triage→answered for a client;
    --    the exemption must let the trigger-driven UPDATE through.
    UPDATE projects.rfis SET status = 'responded' WHERE id = c.rfi1;
    SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
    UPDATE gd_ctx SET resp_status = v_status;

    -- 2. The same contractor edits the mirror row DIRECTLY: still refused. This is
    --    the assertion that proves the exemption is depth-scoped and not `> 0`.
    BEGIN
      UPDATE projects.work_items SET title = 'hand edit' WHERE rfi_id = c.rfi1;
      v_err := '<no error>';
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    UPDATE gd_ctx SET title_err = v_err;

    -- 3. source_status is now in clause (a): a direct edit is refused too.
    BEGIN
      UPDATE projects.work_items SET source_status = 'hacked' WHERE rfi_id = c.rfi1;
      v_err := '<no error>';
    EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
    UPDATE gd_ctx SET src_status_err = v_err;

    -- 4. The raiser (= gatekeeper) closes through the source. Under the exemption
    --    the guard stamps closed_at := now() and keeps the closed_by the mirror
    --    supplied (00196:1540-1547).
    UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.ctr WHERE id = c.rfi1;
    SELECT w.status, w.closed_by INTO v_status, v_by FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
    UPDATE gd_ctx SET close_status = v_status, close_by = v_by;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
  END $as_contractor$;

  DO $as_pm$
  DECLARE c record; v_status text;
  BEGIN
    SELECT * INTO c FROM gd_ctx;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c.pm::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 5. The PM closes an RFI they did NOT raise, through the RFI module's own
    --    path. Clause (d) would refuse a non-gatekeeper close on the spine; the
    --    module already gated the source write, and the mirror follows.
    UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.pm WHERE id = c.rfi2;
    SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi2;
    UPDATE gd_ctx SET pm_close_status = v_status;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
  END $as_pm$;

  SELECT 'ran_as_authenticated' AS probe,
         (SELECT who = 'authenticated' FROM gd_ctx) AS ok,
         'without this a probe that silently stayed postgres is indistinguishable from one that worked' AS detail
  UNION ALL
  SELECT 'contractor_respond_pushed_back',
         (SELECT resp_status = 'answered' FROM gd_ctx),
         'F8: triage → answered through the mirror in a signed-in session. Without the exemption item 2''s (c) refuses it ON THE RFI RESPOND'
  UNION ALL
  SELECT 'direct_title_edit_refused',
         (SELECT title_err LIKE '%mirrored from its source record%' FROM gd_ctx),
         'the exemption is depth-scoped: a client statement is depth 1 and (a2) still bites. Got: ' || (SELECT title_err FROM gd_ctx)
  UNION ALL
  SELECT 'direct_source_status_edit_refused',
         (SELECT src_status_err LIKE '%cannot be renumbered, retyped or moved%' FROM gd_ctx),
         'source_status joined clause (a) (00196:1600-1605 books it here). Got: ' || (SELECT src_status_err FROM gd_ctx)
  UNION ALL
  SELECT 'raiser_close_pushed_back',
         (SELECT close_status = 'closed' AND close_by = ctr FROM gd_ctx),
         'the raiser-gatekeeper closes through the source; closed_by is what the mirror supplied'
  UNION ALL
  SELECT 'pm_close_through_source_succeeds',
         (SELECT pm_close_status = 'closed' FROM gd_ctx),
         'a non-gatekeeper close through the module''s own path is followed by the spine; (d) is skipped at depth 2'
  UNION ALL
  SELECT 'claim_cleared',
         current_user = 'postgres' AND auth.uid() IS NULL,
         'Task 1 rule 3: the claim is transaction-local and must be cleared before the assertion SELECT';
  ```

- [ ] **Step 2: Run it against item 2's guard and record the production failure F8 predicts.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/05b-guard-exemption.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected — section C′ does not exist yet, so item 2's guard is live:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: RFI-<n> cannot move from "triage" to "answered".
  ```
  i.e. the contractor's `UPDATE projects.rfis SET status = 'responded'` **aborts** — the RFI never reaches `responded`. **Copy the exact sentence into the PR body**: it is the evidence that the exemption is load-bearing, and it comes from clause (c) rather than (d) because the item was untriaged.

- [ ] **Step 3: Insert section C′ into the migration, between C and D.** The guard body is **`00196` lines 1509–1759 copied verbatim** — the full function, comments included, so a `diff` against item 2 shows exactly two hunks — then edited in two places, then re-revoked:
  ```sql
  -- ─── C'. Amendments to item 2's objects ──────────────────────────────────────
  -- (1) The transition guard. Byte-identical to 00196 §12 (lines 1509-1759)
  --     except two edits, both booked by item 2's own comment at 00196:1590-1605:
  --       (i)  the early return becomes
  --              IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN
  --            A mirror UPDATE runs at depth 2 (source statement → AFTER trigger →
  --            this BEFORE UPDATE guard) and gets the service-path treatment:
  --            stamps kept, authority and the machine skipped. A client statement
  --            is always depth 1 and is unchanged. NOT `> 0` — that exempts every
  --            client write. Proved under impersonation by probe 05b.
  --       (ii) source_status joins clause (a)'s immutable list:
  --              OR NEW.source_status  IS DISTINCT FROM OLD.source_status
  --            because from this migration the projection is its only writer.
  --     CREATE OR REPLACE keeps the function's ACL; the revokes are re-issued so
  --     the @verify grant_absent: line is provably true of THIS file.
  CREATE OR REPLACE FUNCTION projects.work_items_transition_guard() RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'projects', 'public'
  AS $fn$
  -- … 00196:1513-1539 verbatim …
    IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN
      -- Service client / migration, OR a trigger-driven write (item 3's mirror,
      -- write-back and delete-to-void). The action layer, or the source
      -- module's own gates, are what authorised these. A close stamps the
      -- moment; closed_by stays whatever the caller supplied.
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'closed' THEN NEW.closed_at := now();
        ELSE NEW.closed_at := NULL; NEW.closed_by := NULL; END IF;
      END IF;
      RETURN NEW;
    END IF;
  -- … 00196:1551-1577 verbatim …
    IF NEW.project_id      IS DISTINCT FROM OLD.project_id
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.item_type       IS DISTINCT FROM OLD.item_type
    OR NEW.ref             IS DISTINCT FROM OLD.ref
    OR NEW.origin          IS DISTINCT FROM OLD.origin
    OR NEW.created_by      IS DISTINCT FROM OLD.created_by
    OR NEW.opened_at       IS DISTINCT FROM OLD.opened_at
    OR NEW.created_at      IS DISTINCT FROM OLD.created_at
    OR NEW.source_status   IS DISTINCT FROM OLD.source_status THEN
      RAISE EXCEPTION '% cannot be renumbered, retyped or moved to another project — those details are fixed when the item is created.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
  -- … 00196:1590-1758 verbatim …
  $fn$;
  -- The trigger (00196:1761-1764) is untouched: it already calls this function.

  REVOKE ALL ON FUNCTION projects.work_items_transition_guard() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION projects.work_items_transition_guard() FROM anon;

  -- (2) The rfi registry row (improvement 4, owner decision — see Task 5½).
  --     The mirror sets created_by = raised_by and the gatekeeper to the raiser;
  --     'creator' is the truthful rule for readers in items 4-6. The CHECK
  --     (00196:202) already admits it. The TS mirror (packages/shared/src/
  --     work-items/types.ts) changes in the same commit.
  UPDATE projects.work_item_types SET gatekeeper_rule = 'creator' WHERE key = 'rfi';
  ```
  (The `-- … verbatim …` lines are instructions to the executor, not text to leave in the file. Do not retype the guard from memory: copy it, then apply exactly the two edits.)

- [ ] **Step 4: Run probe 05b and watch 7/7 pass.**

- [ ] **Step 5: Mutation-verify the depth bound — the acceptance step.** Change `> 1` to `> 0` and re-run:
  ```
  FAIL  direct_title_edit_refused           … Got: <no error>
  FAIL  direct_source_status_edit_refused   … Got: <no error>
  ```
  — the contractor's direct writes went through: `> 0` disables the guard for every client. Restore. Then delete the `OR pg_trigger_depth() > 1` clause entirely (item 2's text) and re-run: `FAIL (HTTP 400) … cannot move from "triage" to "answered"` — Step 2's failure, reproduced on demand. Restore. Record 7/7 → 5/7 → HTTP 400 → 7/7.

- [ ] **Step 6: Mutation-verify the `source_status` clause.** Delete the `OR NEW.source_status IS DISTINCT FROM OLD.source_status` line. Re-run: `FAIL direct_source_status_edit_refused … Got: <no error>`. Restore.

- [ ] **Step 7: Extend item 2's harness and run its ten assertion files with `00198` stacked.** In `scripts/db/try-work-item-spine.sh`, after the `PRELUDE` block and before `SQL=$(printf …)`, add:
  ```bash
  # WITH_EXTRA=<file>[:<file>…]: later migrations stacked after 00196 and before
  # the assertion file, so this suite can run against item 3's 00198 (and later)
  # before they merge. Colon-separated, applied in order.
  EXTRA=""
  if [[ -n "${WITH_EXTRA:-}" ]]; then
    IFS=':' read -r -a _extra_files <<< "$WITH_EXTRA"
    for f in "${_extra_files[@]}"; do
      [[ -f "$f" ]] || { echo "ERROR: WITH_EXTRA file not found: $f" >&2; exit 1; }
      EXTRA+=$'\n'"$(cat "$f")"
    done
  fi
  ```
  and change the `printf` to five `%s` slots with `"$EXTRA"` between `"$(cat "$MIG2")"` and `"$(cat "$ASSERT")"`. Then:
  ```bash
  for f in scripts/db/assertions/work-item-*.sql; do
    WITH_EXTRA=apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
      scripts/db/try-work-item-spine.sh "$f"
  done
  ```
  Expected: `✓ <file> — all assertions passed` for all ten. The replaced guard changes nothing a client can observe (depth-1 writes take the same path), and `work-item-transition.sql`'s service-path block clears the claim before it runs. ⚠ Four of these files will go **red** once section H exists (Task 14) — they insert `origin='mirror'` rows against live RFI ids that the backfill will have mirrored. That is Task 15 Step 6's retargeting, not a failure here. If any file is red **now**, the guard replacement is not byte-identical — diff it against `00196` before touching anything else.

- [ ] **Step 8: The TS mirror and its contract test (owner decision default).** In `packages/shared/src/work-items/types.ts`, change the `rfi` entry's `gatekeeperRule: 'project_pm'` to `'creator'`. Run:
  ```bash
  pnpm --filter @esite/shared test -- work-item-types
  ```
  Expected: green. Then revert the TS edit only and re-run: the registry-equality test must **fail** naming `rfi`'s `gatekeeper_rule` — that is the test doing its job across the SQL/TS boundary. Restore the edit.

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/05b-guard-exemption.sql \
          scripts/db/try-work-item-spine.sh \
          packages/shared/src/work-items/types.ts
  git commit -m "feat(work-items): replace the transition guard with a depth-scoped exemption; rfi gatekeeper_rule = creator

Item 2's guard exempts only auth.uid() IS NULL, and a mirror trigger runs in the
source writer's session — so a contractor responding to their own untriaged RFI
hit 'cannot move from \"triage\" to \"answered\"' on the RFI respond (proved
under impersonation). The early return is now v_actor IS NULL OR
pg_trigger_depth() > 1, as 00196's own comment prescribes; > 0 would exempt every
client write and is pinned by a direct-edit assertion. source_status joins
clause (a). The rfi registry row and its TS mirror say 'creator', which is what
the mirror does. Item 2's ten assertion files pass with 00198 stacked."
  ```

---

## Task 6 — Assignment and due-date write-back (F2, improvements 9 and 11)

The point of the write-back is that "existing readers and PDFs keep working untouched" (§13 item 3). After it lands, `apps/web/src/app/(admin)/rfis/[id]/page.tsx:271-272` renders an assignee for the first time in production.

Three rules, each measured:

- **No depth guard here** (F2). With one, an RFI raised with no assignee gets a work item naming the triage owner while `rfis.assigned_to` stays NULL — the page still renders nothing and the write-back has bought exactly nothing. Without one, the cycle still terminates at depth 3 because the *wrapper* is guarded.
- **`due_date` is written back too** (improvement 11). §04 makes re-dating a first-class keyboard verb (`D`) and §03 §1.6 one of triage's three actions. Without this the RFI page, the RFI PDF and the Inbox give three answers to "when is this due", on the module carrying headline metric 4. `projects.rfis.due_date` exists (`00002:91`) and is populated on 13 of 15 rows.
- **Closed and void records are skipped** (improvement 9). **6 of 15** live RFIs are already `closed`. Stamping `assigned_to` on them makes the RFI page and any future RFI PDF render "Assigned to: Arno Mattheus" on a historical record nobody was ever assigned — the site-forms `as_left_status` lesson exactly: *the safest-sounding default is the most dangerous thing to invent, because nobody double-checks it.*

**Files:**
- Modify: the migration — add section E
- Test: `scripts/db/probes/05-writeback.sql`

- [ ] **Step 1: Write the probe first, covering all three rules.** Create `scripts/db/probes/05-writeback.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_other uuid; v_proj uuid;
    v_rfi uuid; v_closed uuid;
    v_a1 uuid; v_d1 date; v_a2 uuid; v_d2 date;
    v_closed_assignee uuid; v_closed_due date;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_other FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_writeback', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- (a) raised with NO assignee: the resolved holder must reach rfis.assigned_to
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'Probe writeback', 'body', 'medium', 'open', v_pm)
    RETURNING id INTO v_rfi;

    SELECT r.assigned_to, r.due_date INTO v_a1, v_d1 FROM projects.rfis r WHERE r.id = v_rfi;

    -- (b) reassign + re-date on the spine ⇒ both reach the source
    UPDATE projects.work_items
       SET assignee_id = v_other, due_date = CURRENT_DATE + 21
     WHERE rfi_id = v_rfi;

    SELECT r.assigned_to, r.due_date INTO v_a2, v_d2 FROM projects.rfis r WHERE r.id = v_rfi;

    -- (c) a CLOSED record must not acquire an assignee it never had
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by, closed_at)
    VALUES (v_proj, v_org, 'Probe closed', 'body', 'medium', 'closed', v_pm, now())
    RETURNING id INTO v_closed;

    SELECT r.assigned_to, r.due_date INTO v_closed_assignee, v_closed_due
      FROM projects.rfis r WHERE r.id = v_closed;

    CREATE TEMP TABLE wb_ctx(rfi uuid, closed uuid, other uuid,
      a1 uuid, d1 date, a2 uuid, d2 date, ca uuid, cd date) ON COMMIT DROP;
    INSERT INTO wb_ctx VALUES (v_rfi, v_closed, v_other, v_a1, v_d1, v_a2, v_d2,
                               v_closed_assignee, v_closed_due);
  END $probe$;

  SELECT 'holder_reaches_source' AS probe,
         (SELECT a1 IS NOT NULL FROM wb_ctx) AS ok,
         'F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing' AS detail
  UNION ALL
  SELECT 'source_matches_item',
         (SELECT c.a1 = (SELECT w.assignee_id FROM projects.work_items w WHERE w.rfi_id = c.rfi)
            FROM wb_ctx c),
         'rfis.assigned_to and work_items.assignee_id agree'
  UNION ALL
  SELECT 'reassign_flows_to_source',
         (SELECT a2 = other FROM wb_ctx),
         'a work-item reassign writes projects.rfis.assigned_to'
  UNION ALL
  -- Improvement 11.
  SELECT 'redate_flows_to_source',
         (SELECT d2 = CURRENT_DATE + 21 FROM wb_ctx),
         'a work-item re-date writes projects.rfis.due_date, or the RFI page and the Inbox disagree'
  UNION ALL
  -- Improvement 9.
  SELECT 'closed_record_untouched',
         (SELECT ca IS NULL AND cd IS NULL FROM wb_ctx),
         '6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson'
  UNION ALL
  SELECT 'closed_item_still_exists',
         (SELECT count(*) FROM projects.work_items w, wb_ctx c WHERE w.rfi_id = c.closed) = 1,
         'the item is still projected — only the write-back is skipped'
  UNION ALL
  SELECT 'no_runaway_recursion', true,
         'reaching this row at all proves the mirror ⇄ write-back cycle terminated';
  ```

- [ ] **Step 2: Run it and watch it fail, 3/7.** Expected: `FAIL holder_reaches_source`, `FAIL source_matches_item`, `FAIL reassign_flows_to_source`, `FAIL redate_flows_to_source` — the mirror (Task 5) resolved a holder and projected both RFIs, but nothing wrote anything back. `closed_item_still_exists` passes (the item exists; Task 5's trigger made it — the 2026-09-10 text said it would fail, which was wrong), and `closed_record_untouched` and `no_runaway_recursion` pass **vacuously** at this point; Step 5 makes the first of them real.

- [ ] **Step 3: Append section E.**
  ```sql
  -- ─── E. Assignment and due-date write-back ───────────────────────────────────
  -- Two sources only. inspections.inspections.assigned_to_id is deliberately NOT
  -- written back (§03 §1.2): the inspection engine's own assignment flow (00066)
  -- stays the system of record for that column, and a third write-back is a third
  -- loop to reason about. (The inspection mirror still READS that column forward —
  -- see Task 8. "System of record" is an argument for not writing back, not for
  -- not reading forward.)
  --
  -- ⚠ NO pg_trigger_depth() guard here, and that asymmetry is load-bearing (F2).
  -- Measured: with a uniform guard, an RFI raised with no assignee ends up with
  -- work_items.assignee_id = the resolved holder and rfis.assigned_to = NULL — the
  -- write-back silently buys nothing. Termination is the WRAPPER's guard, not this
  -- one; the value-difference predicates below only stop write amplification and a
  -- spurious rfis_updated_at bump (00002:100-102).
  CREATE OR REPLACE FUNCTION projects.work_item_assignment_writeback()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF NEW.origin <> 'mirror' THEN RETURN NULL; END IF;   -- splits own their own lifecycle

    -- Improvement 9: never invent an assignee or a future deadline on a record
    -- that is already finished. 6 of 15 live RFIs are closed.
    IF NEW.status IN ('closed','void') THEN RETURN NULL; END IF;

    IF NEW.rfi_id IS NOT NULL THEN
      UPDATE projects.rfis
         SET assigned_to = NEW.assignee_id,
             due_date    = NEW.due_date
       WHERE id = NEW.rfi_id
         AND status NOT IN ('closed')
         AND (assigned_to IS DISTINCT FROM NEW.assignee_id
           OR due_date    IS DISTINCT FROM NEW.due_date);
    ELSIF NEW.snag_id IS NOT NULL THEN
      -- field.snags has no due_date column (00004:10-32), so assignment only.
      UPDATE field.snags
         SET assigned_to = NEW.assignee_id
       WHERE id = NEW.snag_id
         AND status NOT IN ('signed_off','closed')
         AND assigned_to IS DISTINCT FROM NEW.assignee_id;
    END IF;

    RETURN NULL;
  END $fn$;

  -- F7 again: an INSERT arm cannot carry a WHEN referencing OLD.
  CREATE TRIGGER work_items_assignment_writeback_ins
    AFTER INSERT ON projects.work_items
    FOR EACH ROW EXECUTE FUNCTION projects.work_item_assignment_writeback();

  CREATE TRIGGER work_items_assignment_writeback_upd
    AFTER UPDATE OF assignee_id, due_date ON projects.work_items
    FOR EACH ROW
    WHEN (OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
       OR OLD.due_date    IS DISTINCT FROM NEW.due_date)
    EXECUTE FUNCTION projects.work_item_assignment_writeback();
  ```

- [ ] **Step 4: Run the probe and watch 7/7 pass.**

- [ ] **Step 5: Mutation-verify improvement 9.** Delete `IF NEW.status IN ('closed','void') THEN RETURN NULL; END IF;` **and** the `AND status NOT IN ('closed')` predicate. Re-run. Expected:
  ```
  FAIL  closed_record_untouched  6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson
  ```
  Restore both. Record 7/7 → 6/7 → 7/7.

- [ ] **Step 6: Mutation-verify F2.** Add `IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;` as the first line of `work_item_assignment_writeback`, re-run:
  ```
  FAIL  holder_reaches_source  F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing
  FAIL  source_matches_item    rfis.assigned_to and work_items.assignee_id agree
  ```
  Remove it. Record 7/7 → 5/7 → 7/7.

- [ ] **Step 7: Now run Task 5 Step 9's deferred mutation — the termination proof.** In `mirror_rfi_work_item`, change `IF pg_trigger_depth() > 1 THEN` to `IF false THEN` **and** delete the `AND (assigned_to IS DISTINCT FROM … OR due_date IS DISTINCT FROM …)` predicate from the write-back. Re-run:
  ```
  FAIL (HTTP 400)
  … ERROR: 54001: stack depth limit exceeded
  HINT: Increase the configuration parameter "max_stack_depth" …
  ```
  Now restore **only** the depth guard, leaving the value predicate deleted, and confirm 7/7. That is the measured proof that the value check is a write-amplification guard and the depth guard is the termination guard, so nobody later "simplifies" the wrong one. Restore the value predicate.

- [ ] **Step 8: Record the one accepted divergence, in the migration, beside the function.**
  ```sql
  COMMENT ON FUNCTION projects.work_item_assignment_writeback() IS
    'Writes work_items.assignee_id and due_date back to projects.rfis, and assignee_id to '
    'field.snags (which has no due_date column). Skips closed and void records so a historical '
    'row never acquires an assignee it never had. '
    'Known divergence: createRfiAction reads rfi.assigned_to from the INSERT''s RETURNING clause '
    '(rfi.actions.ts:104), which is computed before this AFTER trigger runs — so an RFI raised '
    'with no assignee still emails "unassigned" while the row already names the resolved holder. '
    'OPEN; NOT closed by item 2, which shipped five server actions and no module UI '
    '(createRfiAction is untouched). Candidates: re-read the row after insert in createRfiAction, '
    'or make assignee required on the create form (§03 §1.10) — neither is in this migration.';
  ```

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/05-writeback.sql
  git commit -m "feat(work-items): assignment + due-date write-back, deliberately without a depth guard

A uniform pg_trigger_depth() guard silently loses the write-back; termination
comes from the mirror wrapper's guard, proved by mutation. Due date is written
back too, or the RFI page, the RFI PDF and the Inbox give three answers. Closed
and void records are skipped: 6 of 15 live RFIs are closed and must not acquire
an assignee nobody ever set."
  ```

---

## Task 7 — The snag projection (improvement 5)

Same shape as Task 5. Four differences that matter:

1. The snag's default assignee falls to `raised_by` before the resolver chain (§12 §(d)); `raised_by` is `NOT NULL` (`00004:25`).
2. The gatekeeper is the **project PM, never the raiser** (§03 §1.5) — the opposite of the RFI. `signOffSnagAction` today stamps whoever clicked, with no role gate beyond authentication, so a raiser-closes default would hand close authority to the contractor who reported the defect. (An RFI is the mirror image: the asker confirms the answer is usable. A defect is not signed off by the person who reported it.)
3. **The title carries the location** (improvement 5). Measured: **6 of 6** live snags carry a `location` (`Floor 7 — DB Room`, `Basement — MCC Panel`, `Levels 3–5 — Steel`, `Floor 4 — DB-04A`, `Floor 2 — Comms`, `Unit 5 — DB-05`) and **0 of 6** carry a `floor_plan_pin`, so the text column is the only locator that exists. The title is all that travels into the 07:00 recap; without it a foreman reads *"DB labelling incomplete — circuits 14–22 unlabelled"* with no floor and no board.
4. `field.snags` has **no `due_date` column** (`00004:10-32`), so the projection always passes NULL and item 2's trigger computes A(b)'s +5 wd on the site calendar. The write-back writes assignment only.

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/06-snag-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/06-snag-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_ctr uuid; v_proj uuid; v_snag uuid; v_nowhere uuid;
    v_ins record; v_res record; v_sof record;
    v_assigned_after uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_ctr FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_snag', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- Shaped like a live row: a contractor raises it, no assignee, a location.
    INSERT INTO field.snags (project_id, organisation_id, title, location,
                             priority, status, raised_by)
    VALUES (v_proj, v_org, 'DB labelling incomplete', 'Unit 5 — DB-05',
            'high', 'open', v_ctr)
    RETURNING id INTO v_snag;

    SELECT w.title, w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date
      INTO v_ins FROM projects.work_items w WHERE w.snag_id = v_snag;

    SELECT s.assigned_to INTO v_assigned_after FROM field.snags s WHERE s.id = v_snag;

    -- A snag with NO location must not gain a dangling em-dash.
    INSERT INTO field.snags (project_id, organisation_id, title, location,
                             priority, status, raised_by)
    VALUES (v_proj, v_org, 'No location snag', '   ', 'low', 'open', v_ctr)
    RETURNING id INTO v_nowhere;

    UPDATE field.snags SET status = 'resolved' WHERE id = v_snag;
    SELECT w.status, w.ball_in_court_id INTO v_res
      FROM projects.work_items w WHERE w.snag_id = v_snag;

    UPDATE field.snags SET status = 'signed_off', signed_off_by = v_pm, signed_off_at = now()
     WHERE id = v_snag;
    SELECT w.status, w.ball_in_court_id, w.closed_at INTO v_sof
      FROM projects.work_items w WHERE w.snag_id = v_snag;

    CREATE TEMP TABLE sn_ctx(snag uuid, nowhere uuid, proj uuid, pm uuid, ctr uuid,
      ins_title text, ins_status text, ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
      assigned_after uuid, res_status text, res_bic uuid,
      sof_status text, sof_bic uuid, sof_closed timestamptz) ON COMMIT DROP;
    INSERT INTO sn_ctx VALUES (v_snag, v_nowhere, v_proj, v_pm, v_ctr,
      v_ins.title, v_ins.status, v_ins.assignee_id, v_ins.gatekeeper_id,
      v_ins.ball_in_court_id, v_ins.due_date, v_assigned_after,
      v_res.status, v_res.ball_in_court_id,
      v_sof.status, v_sof.ball_in_court_id, v_sof.closed_at);
  END $probe$;

  SELECT 'snag_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, sn_ctx c
           WHERE w.snag_id = c.snag AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per snag' AS detail
  UNION ALL
  -- Improvement 5.
  SELECT 'title_carries_the_location',
         (SELECT ins_title = 'DB labelling incomplete — Unit 5 — DB-05' FROM sn_ctx),
         '6 of 6 live snags carry a location and 0 carry a floor_plan_pin; the title is all that reaches the recap'
  UNION ALL
  SELECT 'blank_location_adds_no_dash',
         (SELECT w.title FROM projects.work_items w, sn_ctx c WHERE w.snag_id = c.nowhere)
           = 'No location snag',
         'a whitespace-only location must not produce a trailing em-dash'
  UNION ALL
  SELECT 'snag_writeback',
         (SELECT assigned_after IS NOT NULL FROM sn_ctx),
         'field.snags.assigned_to must be populated by the write-back'
  UNION ALL
  SELECT 'assignee_is_the_raiser',
         (SELECT ins_assignee = ctr FROM sn_ctx),
         '§12 §(d): assigned_to → raised_by → the chain'
  UNION ALL
  SELECT 'gatekeeper_is_pm_not_raiser',
         (SELECT c.ins_gate = projects.resolve_project_pm(c.proj) AND c.ins_gate <> c.ctr FROM sn_ctx c),
         '§03 §1.5: a defect is not signed off by the person who reported it'
  UNION ALL
  SELECT 'due_computed_by_the_spine',
         (SELECT ins_due > CURRENT_DATE FROM sn_ctx),
         'field.snags has no due_date column, so item 2''s trigger computes A(b)''s +5 wd on the site calendar'
  UNION ALL
  SELECT 'resolved_is_answered',
         (SELECT res_status = 'answered' AND res_bic = ins_gate FROM sn_ctx),
         'resolved ⇒ answered ⇒ the PM holds the ball'
  UNION ALL
  SELECT 'signed_off_is_closed',
         (SELECT sof_status = 'closed' AND sof_closed IS NOT NULL FROM sn_ctx),
         'signed_off ⇒ closed, stamped from signed_off_at'
  UNION ALL
  SELECT 'closed_clears_bic',
         (SELECT sof_bic IS NULL FROM sn_ctx),
         'A(a): the generated column is NULL on closed, so the item leaves every inbox';
  ```

- [ ] **Step 2: Run it, watch `snag_item_created` fail with `one mirror item per snag`, 1/10** — only `closed_clears_bic` passes, and it passes **vacuously** because no item exists to hold a ball at all. Step 4 is what makes it mean something.

- [ ] **Step 3: Append the snag projection to section D.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_snag(p_snag_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    s          field.snags%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO s FROM field.snags WHERE id = p_snag_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items WHERE snag_id = s.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('snag', s.status);

    -- Improvement 5. 6 of 6 live snags carry a location and 0 carry a
    -- floor_plan_pin, so this text column is the only locator that exists — and
    -- the title is the whole of what travels into the 07:00 recap email.
    v_title := s.title || COALESCE(' — ' || NULLIF(TRIM(s.location), ''), '');

    IF v_item.id IS NULL THEN
      -- §12 §(d): assigned_to → raised_by → the chain. raised_by is NOT NULL
      -- (00004:25), so this almost always resolves at step 1.
      v_assignee := projects.resolve_mirror_assignee(
                      s.project_id, 'snag', COALESCE(s.assigned_to, s.raised_by));
      -- §03 §1.5: the PM, never the raiser. NULL is deliberate, not an oversight;
      -- compare project_rfi, which passes r.raised_by for the opposite reason.
      v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, snag_id,
        opened_at, last_activity_at, closed_at, closed_by)
      VALUES (
        s.organisation_id, s.project_id, 'snag', 'mirror', v_title, s.priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, s.assigned_to IS NOT NULL),
        s.status, v_assignee, v_gate,
        NULL,                  -- no due_date column on field.snags: A(b) +5 wd, site
        s.raised_by, s.id,
        -- #4: historical stamps (see the section D comment).
        s.created_at, s.updated_at,
        CASE WHEN s.status IN ('signed_off','closed') THEN COALESCE(s.signed_off_at, s.updated_at) END,
        CASE WHEN s.status IN ('signed_off','closed') THEN s.signed_off_by END)
      -- work_items_src_snag_uidx (00196:372).
      ON CONFLICT (snag_id) WHERE snag_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 does it.
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM s.project_id;   -- improvement 8, rides C''s exemption
      IF v_moved THEN
        v_assignee := projects.resolve_mirror_assignee(
                        s.project_id, 'snag', COALESCE(s.assigned_to, s.raised_by));
        v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);
      ELSE
        v_assignee := COALESCE(
          CASE WHEN projects.work_item_person_eligible(s.project_id, s.assigned_to)
               THEN s.assigned_to END, v_item.assignee_id);
        v_gate := v_item.gatekeeper_id;
      END IF;

      UPDATE projects.work_items
         SET project_id = s.project_id, organisation_id = s.organisation_id,
             title = v_title, priority = s.priority, source_status = s.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id = v_assignee, gatekeeper_id = v_gate,
             closed_at = CASE WHEN s.status IN ('signed_off','closed')
                              THEN COALESCE(v_item.closed_at, s.signed_off_at, now()) END,
             closed_by = CASE WHEN s.status IN ('signed_off','closed')
                              THEN COALESCE(v_item.closed_by, s.signed_off_by) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_snag_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_snag(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER snags_mirror_work_item_ins
    AFTER INSERT ON field.snags
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_snag_work_item();

  CREATE TRIGGER snags_mirror_work_item_upd
    AFTER UPDATE OF title, location, priority, status, assigned_to,
                    signed_off_by, signed_off_at, project_id, organisation_id
    ON field.snags
    FOR EACH ROW
    WHEN (OLD.title           IS DISTINCT FROM NEW.title
       OR OLD.location        IS DISTINCT FROM NEW.location
       OR OLD.priority        IS DISTINCT FROM NEW.priority
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
       OR OLD.signed_off_by   IS DISTINCT FROM NEW.signed_off_by
       OR OLD.signed_off_at   IS DISTINCT FROM NEW.signed_off_at
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_snag_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 10/10 pass.**

- [ ] **Step 5: Mutation-verify the gatekeeper rule.** Change `projects.resolve_work_item_gatekeeper(s.project_id, NULL)` to `(s.project_id, s.raised_by)` in both arms. Re-run. Expected:
  ```
  FAIL  gatekeeper_is_pm_not_raiser  §03 §1.5: a defect is not signed off by the person who reported it
  FAIL  resolved_is_answered         resolved ⇒ answered ⇒ the PM holds the ball
  ```
  Restore. Record 10/10 → 8/10 → 10/10.

- [ ] **Step 6: Mutation-verify improvement 5.** Change `v_title := s.title || COALESCE(…)` to `v_title := s.title;`. Re-run. Expected: `FAIL title_carries_the_location  6 of 6 live snags carry a location and 0 carry a floor_plan_pin; …`. Restore. Then change the `COALESCE(' — ' || NULLIF(TRIM(s.location), ''), '')` to `' — ' || COALESCE(s.location,'')` and re-run: `FAIL blank_location_adds_no_dash`. Restore.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/06-snag-mirror.sql
  git commit -m "feat(work-items): snag projection — gatekeeper is the PM, title carries the location

6 of 6 live snags carry a location and 0 carry a floor-plan pin, so the text
column is the only locator that exists — and the title is all that travels into
the 07:00 recap."
  ```

---

## Task 8 — The inspection projection, the profiles edge case, and forward assignment

**Including inspections is not optional.** All **18** rows sit at `status = 'assigned'` with zero responses and zero certificates (verified), which is exactly the pathology the ball-in-court spine exists to fix.

**There is no FK to reconcile.** `public.profiles.id` is itself `REFERENCES auth.users(id)` (`00001_initial_schema.sql:62`) and `handle_new_user` inserts a profiles row on every `auth.users` insert (`00001:77-92`), so `inspections.inspections.assigned_to_id` / `verifier_id` / `created_by` (`00066:54,55,73`) already hold the UUIDs a `work_items.assignee_id REFERENCES public.profiles(id)` needs. Verified: **0** auth users have no profiles row, and **0** of the 18 inspections reference a missing profile. The edge case is handled anyway — by `work_item_person_eligible` on the way in — because a zero count today measures the estate's *age*, not its risk. **The backfill does not add a second, contradictory guard** (see Task 14 Step 3, item 3).

**No write-back, but assignment is read forward.** §03 §1.2 keeps `00066`'s own assignment flow as the system of record for `assigned_to_id` — that is an argument for not writing *back*, not for not reading *forward*. The `_upd` trigger fires on `assigned_to_id`, so re-assigning an inspection in the inspections module must move `work_items.assignee_id`, `ball_in_court_id`, the Inbox and My Work with it. Without that line the spine points at the previous person forever.

**Due date.** §12 §(d) line 136 says `scheduled_at::date` if set. **15 of 18** live inspections carry a `scheduled_at` in the past, so passing it straight through would make every one of them born overdue — the thing improvement 6 exists to stop. It goes through `work_item_mirror_due_date`, which returns NULL for a past date so item 2's trigger computes A(b)'s +3 wd on the site calendar. (A(b) says nothing about `scheduled_at`; that rule is §12 §(d)'s.)

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/07-inspection-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/07-inspection-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_v uuid; v_third uuid; v_proj uuid; v_tpl uuid; v_insp uuid; v_past uuid;
    v_ins record; v_re record; v_aw record;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_v FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;
    SELECT u.user_id INTO v_third FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id NOT IN (v_pm, v_v) LIMIT 1;
    SELECT id INTO v_tpl FROM inspections.templates LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_insp', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
      target_node_type, target_label, target_location, assigned_to_id, verifier_id,
      status, created_by)
    VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Probe board', 'Level 2 — Riser',
            v_pm, v_v, 'assigned', v_pm)
    RETURNING id INTO v_insp;

    SELECT w.title, w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date
      INTO v_ins FROM projects.work_items w WHERE w.inspection_id = v_insp;

    -- 15 of 18 live inspections are scheduled in the past.
    INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
      target_node_type, target_label, assigned_to_id, verifier_id, status,
      scheduled_at, created_by)
    VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Past board', v_pm, v_v, 'assigned',
            now() - interval '30 days', v_pm)
    RETURNING id INTO v_past;

    -- Reassignment inside the inspections module must reach the spine.
    UPDATE inspections.inspections SET assigned_to_id = v_third WHERE id = v_insp;
    SELECT w.assignee_id, w.ball_in_court_id INTO v_re
      FROM projects.work_items w WHERE w.inspection_id = v_insp;

    UPDATE inspections.inspections SET status = 'awaiting_verification' WHERE id = v_insp;
    SELECT w.status, w.ball_in_court_id INTO v_aw
      FROM projects.work_items w WHERE w.inspection_id = v_insp;

    CREATE TEMP TABLE in_ctx(insp uuid, past uuid, proj uuid, pm uuid, verifier uuid, third uuid,
      ins_title text, ins_status text, ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
      re_assignee uuid, re_bic uuid, aw_status text, aw_bic uuid) ON COMMIT DROP;
    INSERT INTO in_ctx VALUES (v_insp, v_past, v_proj, v_pm, v_v, v_third,
      v_ins.title, v_ins.status, v_ins.assignee_id, v_ins.gatekeeper_id,
      v_ins.ball_in_court_id, v_ins.due_date,
      v_re.assignee_id, v_re.ball_in_court_id, v_aw.status, v_aw.ball_in_court_id);
  END $probe$;

  SELECT 'insp_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, in_ctx c
           WHERE w.inspection_id = c.insp AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per inspection' AS detail
  UNION ALL
  SELECT 'assignee_seeds_from_source',
         (SELECT ins_assignee = pm FROM in_ctx),
         'A(b): existing assigned_to_id, else the chain'
  UNION ALL
  SELECT 'gatekeeper_is_verifier',
         (SELECT ins_gate = verifier FROM in_ctx),
         'A(b): verifier_id, else the PM'
  UNION ALL
  SELECT 'born_open_not_triage',
         (SELECT ins_status = 'open' FROM in_ctx),
         'an inspection arrives already assigned, so it is open, not triage'
  UNION ALL
  SELECT 'title_names_the_place',
         (SELECT ins_title = 'Probe board — Level 2 — Riser' FROM in_ctx),
         'target_location is the only locator an inspection has; the title is what reaches the recap'
  UNION ALL
  -- Improvement 6, on the source §12 §(d) explicitly told us to pass through.
  SELECT 'past_schedule_not_born_overdue',
         (SELECT w.due_date > CURRENT_DATE FROM projects.work_items w, in_ctx c
           WHERE w.inspection_id = c.past),
         '15 of 18 live inspections are scheduled in the past; §12 §(d) says scheduled_at::date and that would be overdue on day one'
  UNION ALL
  -- The forward-assignment rule.
  SELECT 'reassignment_reaches_the_spine',
         (SELECT re_assignee = third AND re_bic = third FROM in_ctx),
         '00066 owns the column, but the spine must follow it or the Inbox names the previous person forever'
  UNION ALL
  SELECT 'no_writeback_to_source',
         (SELECT i.assigned_to_id = c.third FROM inspections.inspections i, in_ctx c
           WHERE i.id = c.insp),
         'the source is unchanged by the spine: 00066''s flow stays the system of record (§03 §1.2)'
  UNION ALL
  SELECT 'awaiting_verification_is_answered',
         (SELECT aw_status = 'answered' AND aw_bic = verifier FROM in_ctx),
         'awaiting_verification ⇒ answered ⇒ the ball moves to the verifier';
  ```

- [ ] **Step 2: Run it, watch `insp_item_created` fail, 1/9** — `no_writeback_to_source` passes, but only because the probe's own `UPDATE` set that column; it becomes meaningful once an item exists to *not* write it back.

- [ ] **Step 3: Append the inspection projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_inspection(p_inspection_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'inspections'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    i          inspections.inspections%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_creator uuid;
    v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO i FROM inspections.inspections WHERE id = p_inspection_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE inspection_id = i.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('inspection', i.status);

    -- target_location (00066:47) is the only locator an inspection carries.
    v_title := i.target_label || COALESCE(' — ' || NULLIF(TRIM(i.target_location), ''), '');

    -- The ids are the same UUID (00001:62, 00001:77-92); work_item_person_eligible
    -- covers the one edge case, an auth user with no profiles row. Zero such users
    -- exist today — which measures the estate's age, not its risk.
    v_moved := v_item.id IS NOT NULL AND v_item.project_id IS DISTINCT FROM i.project_id;

    v_assignee := projects.resolve_mirror_assignee(
                    i.project_id, 'inspection',
                    CASE WHEN projects.work_item_person_eligible(i.project_id, i.assigned_to_id)
                         THEN i.assigned_to_id END);
    v_gate     := projects.resolve_work_item_gatekeeper(i.project_id, i.verifier_id);
    v_creator  := CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.created_by)
                       THEN i.created_by ELSE v_assignee END;

    IF v_item.id IS NULL THEN
      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, inspection_id,
        opened_at, last_activity_at, closed_at, void_reason)
      VALUES (
        i.organisation_id, i.project_id, 'inspection', 'mirror', v_title, 'medium',
        projects.work_item_status_for_mirror(NULL, v_mapped, i.assigned_to_id IS NOT NULL),
        i.status, v_assignee, v_gate,
        -- §12 §(d) line 136 says scheduled_at::date. 15 of 18 live inspections are
        -- scheduled in the PAST, so passing it through births them overdue.
        -- work_item_mirror_due_date returns NULL for those and item 2's trigger
        -- computes A(b)'s +3 wd on the site calendar instead (improvement 6).
        projects.work_item_mirror_due_date(i.scheduled_at::date),
        v_creator, i.id,
        -- #4: historical stamps. inspections carries no certified_by the plan has
        -- verified, so closed_by stays NULL on a born-certified row. A born-void
        -- (abandoned) row MUST carry a reason: the guard's void-reason check fires
        -- on the first signed-in UPDATE of any void row (00196:1745-1755) — that
        -- would be the source delete, failing with "Dropping … needs a short reason".
        i.created_at, i.updated_at,
        CASE WHEN i.status = 'certified' THEN COALESCE(i.certified_at, i.updated_at) END,
        CASE WHEN i.status = 'abandoned'
             THEN COALESCE(NULLIF(btrim(i.abandon_reason), ''), 'inspection voided at source') END)
      -- work_items_src_inspection_uidx (00196:377).
      ON CONFLICT (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 does it.
    ELSE
      UPDATE projects.work_items
         SET project_id = i.project_id, organisation_id = i.organisation_id,   -- improvement 8, rides C''s exemption
             title = v_title, source_status = i.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             -- 00066's flow owns inspections.assigned_to_id and this migration never
             -- writes it back — but the spine must FOLLOW it, or reassigning an
             -- inspection leaves work_items.assignee_id (and therefore
             -- ball_in_court_id, the Inbox and My Work) on the previous person forever.
             assignee_id   = COALESCE(
               CASE WHEN projects.work_item_person_eligible(i.project_id, i.assigned_to_id)
                    THEN i.assigned_to_id END,
               CASE WHEN v_moved THEN v_assignee ELSE v_item.assignee_id END),
             gatekeeper_id = v_gate,
             closed_at = CASE WHEN i.status = 'certified'
                              THEN COALESCE(v_item.closed_at, i.certified_at, now()) END,
             -- Never blank a void row's reason: under the exemption the guard's
             -- void-reason check is skipped here and would bite on the next
             -- signed-in UPDATE instead. A void item stays void (Task 4's arm), so
             -- ELSE keeps whatever it already carried.
             void_reason = CASE WHEN i.status = 'abandoned'
                                THEN COALESCE(NULLIF(btrim(i.abandon_reason), ''), v_item.void_reason,
                                              'inspection voided at source')
                                ELSE v_item.void_reason END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_inspection_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'inspections'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_inspection(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER inspections_mirror_work_item_ins
    AFTER INSERT ON inspections.inspections
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_inspection_work_item();

  CREATE TRIGGER inspections_mirror_work_item_upd
    AFTER UPDATE OF target_label, target_location, status, assigned_to_id, verifier_id,
                    scheduled_at, certified_at, abandon_reason, project_id, organisation_id
    ON inspections.inspections
    FOR EACH ROW
    WHEN (OLD.target_label    IS DISTINCT FROM NEW.target_label
       OR OLD.target_location IS DISTINCT FROM NEW.target_location
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.assigned_to_id  IS DISTINCT FROM NEW.assigned_to_id
       OR OLD.verifier_id     IS DISTINCT FROM NEW.verifier_id
       OR OLD.scheduled_at    IS DISTINCT FROM NEW.scheduled_at
       OR OLD.certified_at    IS DISTINCT FROM NEW.certified_at
       OR OLD.abandon_reason  IS DISTINCT FROM NEW.abandon_reason
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_inspection_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 9/9 pass.**

- [ ] **Step 5: Mutation-verify the forward-assignment line.** Delete the `assignee_id = COALESCE(…)` clause from the `ELSE` arm. Re-run. Expected:
  ```
  FAIL  reassignment_reaches_the_spine  00066 owns the column, but the spine must follow it or the Inbox names the previous person forever
  ```
  Restore. Record 9/9 → 8/9 → 9/9.

- [ ] **Step 6: Mutation-verify the past-schedule rule.** Change `projects.work_item_mirror_due_date(i.scheduled_at::date)` to `i.scheduled_at::date`. Re-run. Expected: `FAIL past_schedule_not_born_overdue  15 of 18 live inspections are scheduled in the past; …`. Restore.

- [ ] **Step 7: Prove the profiles edge case is handled.** Temporarily add to the `DO` block, immediately before the temp table insert:
  ```sql
    DELETE FROM public.profiles WHERE id = v_third;   -- an auth user with no profiles row
    UPDATE inspections.inspections SET target_label = 'Probe board 2' WHERE id = v_insp;
  ```
  Expected: the probe still runs (`9/9` or a title mismatch on `title_names_the_place`, which is fine — nothing raises). Then change `v_creator := CASE WHEN EXISTS (…) THEN i.created_by ELSE v_assignee END;` to `v_creator := i.created_by;` and, in the `_ins` path, delete the `work_item_person_eligible` wrapper around `i.assigned_to_id`. Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23503: insert or update on table "work_items" violates foreign key constraint
  ```
  Restore both and remove the temporary lines.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/07-inspection-mirror.sql
  git commit -m "feat(work-items): inspection projection — reads assignment forward, never writes it back

00066's flow stays the system of record for assigned_to_id, but the spine must
follow it or the Inbox names the previous person forever. 15 of 18 live
inspections are scheduled in the past, so scheduled_at goes through the
non-overdue filter rather than straight into due_date."
  ```

---

## Task 9 — The `qc_defect` projection needs two entry points (F4, improvement 5)

**Scope predicate (§12 §(d)):** an entry is mirrored only where `conformance = 'fail'` **and** its parent report's `status IN ('issued','closed')`. A QC report is a checklist; mirroring every issued entry would manufacture ~40 inbox items from one 40-line report — the poisoning A(b) refuses and the reason `qc_report` is not a registered type.

**Why two entry points.** That predicate spans two tables and an entry does not cross it on its own. In practice a report is authored as a `draft` — the `fail` verdict is written then — and enters scope when someone **issues the report**, which is an `UPDATE` on `projects.qc_reports`, not on `projects.qc_entries`. A trigger on the entry alone would never fire on the normal path. The entry-level trigger is still needed for the second path: an entry edited to `fail` while its report is already `issued`.

**Both paths are live.** `projects.qc_entries` carries `qc_entries_frozen_guard → projects.qc_report_children_frozen` (verified in `pg_trigger`), whose body raises only when the parent report's `status = 'closed'` and which returns early when `auth.uid() IS NULL`. So entries on an `issued` report remain editable, and the backfill is not blocked by it either — though the backfill calls `project_qc_entry()` directly and never UPDATEs an entry, so it never enters that guard at all.

**Severity maps onto priority** (§03 §1.10): `minor→low`, `major→high`, `critical→critical`, never a flat `medium`. A NULL severity is `medium`, because `00176:63-68` deliberately leaves the "severity present iff `conformance='fail'`" relationship to the app layer.

**The title carries the report** (improvement 5). `projects.qc_entries` has **no location column** and its titles are checklist lines (`"Failed check"`, `"Earth continuity"`), so a defect item is unreadable in an inbox without knowing which report it came from. `projects.qc_reports.title` is `NOT NULL` (`00172:62`).

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/08-qc-mirror.sql`

- [ ] **Step 1: Write the probe first, and make the report-issue path its centrepiece.** Create `scripts/db/probes/08-qc-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rep uuid; v_fail uuid; v_na uuid;
    v_draft_items int; v_issued_fail int; v_issued_na int;
    v_prio text; v_src text; v_title text; v_after_pass text;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_qc', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
    VALUES (v_proj, v_org, 'Level 3 handover QC', 'draft', v_pm) RETURNING id INTO v_rep;

    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, severity, created_by)
    VALUES (v_rep, v_org, v_proj, 'Earth continuity', 'fail', 'major', v_pm)
    RETURNING id INTO v_fail;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, created_by)
    VALUES (v_rep, v_org, v_proj, 'Untested check', 'na', v_pm) RETURNING id INTO v_na;

    SELECT count(*) INTO v_draft_items FROM projects.work_items
     WHERE qc_entry_id IN (v_fail, v_na);

    -- The path a trigger on qc_entries alone can never see (F4).
    UPDATE projects.qc_reports SET status = 'issued', issued_at = now() WHERE id = v_rep;

    SELECT count(*) INTO v_issued_fail FROM projects.work_items WHERE qc_entry_id = v_fail;
    SELECT count(*) INTO v_issued_na   FROM projects.work_items WHERE qc_entry_id = v_na;
    SELECT w.priority, w.source_status, w.title INTO v_prio, v_src, v_title
      FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

    -- The second path: an entry corrected while the report is already issued.
    UPDATE projects.qc_entries SET conformance = 'pass', severity = NULL WHERE id = v_fail;
    SELECT w.status INTO v_after_pass FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

    CREATE TEMP TABLE qc_ctx(rep uuid, fail uuid, na uuid,
      draft_items int, issued_fail int, issued_na int,
      prio text, src text, title text, after_pass text) ON COMMIT DROP;
    INSERT INTO qc_ctx VALUES (v_rep, v_fail, v_na, v_draft_items, v_issued_fail,
      v_issued_na, v_prio, v_src, v_title, v_after_pass);
  END $probe$;

  SELECT 'draft_report_projects_nothing' AS probe,
         (SELECT draft_items = 0 FROM qc_ctx) AS ok,
         'a fail on a DRAFT report is not yet an obligation' AS detail
  UNION ALL
  SELECT 'issue_report_projects_the_fail',
         (SELECT issued_fail = 1 FROM qc_ctx),
         'F4: issuing the REPORT is the normal path; an entry-only trigger never fires here'
  UNION ALL
  SELECT 'issue_report_ignores_the_rest',
         (SELECT issued_na = 0 FROM qc_ctx),
         'A(b): mirroring every issued entry manufactures ~40 items from one 40-line report'
  UNION ALL
  SELECT 'severity_maps_to_priority',
         (SELECT prio = 'high' FROM qc_ctx),
         '§03 §1.10: major → high, never a flat medium'
  UNION ALL
  SELECT 'source_status_is_conformance',
         (SELECT src = 'fail' FROM qc_ctx),
         'source_status mirrors conformance'
  UNION ALL
  -- Improvement 5.
  SELECT 'title_carries_the_report',
         (SELECT title = 'Level 3 handover QC — Earth continuity' FROM qc_ctx),
         'qc_entries has no location column and its titles are checklist lines'
  UNION ALL
  SELECT 'entry_pass_closes_item',
         (SELECT after_pass = 'closed' FROM qc_ctx),
         'fail → pass on an issued report closes the defect';
  ```

- [ ] **Step 2: Run it. Expected 1/7:** `draft_report_projects_nothing` PASSes **vacuously** (nothing exists yet) and the other six FAIL. Note that vacuous pass explicitly — it is the fixture-quality question in miniature, and Step 6 is what makes it non-vacuous.

- [ ] **Step 3: Append the qc projection — one body, two entry points.**
  ```sql
  -- One projection body, two trigger entry points, because the scope predicate
  -- spans two tables (F4). The normal path is the REPORT being issued; the
  -- entry-level trigger covers an entry edited to 'fail' while its report is
  -- already issued.
  CREATE OR REPLACE FUNCTION projects.project_qc_entry(p_entry_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    e          projects.qc_entries%ROWTYPE;
    rep        projects.qc_reports%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_priority text; v_title text;
  BEGIN
    SELECT * INTO e FROM projects.qc_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO rep FROM projects.qc_reports WHERE id = e.report_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE qc_entry_id = e.id AND origin = 'mirror';

    -- Out of scope and never projected: do nothing. Out of scope but already
    -- projected cannot happen — a report never returns to draft (00172's status
    -- guard) — so there is no un-project path and none is invented.
    IF rep.status NOT IN ('issued','closed') AND v_item.id IS NULL THEN RETURN; END IF;

    v_mapped   := projects.map_source_status('qc_defect', e.conformance);
    v_priority := CASE e.severity WHEN 'minor' THEN 'low' WHEN 'major' THEN 'high'
                                  WHEN 'critical' THEN 'critical' ELSE 'medium' END;
    -- Improvement 5: qc_entries has no location column and its titles are
    -- checklist lines, so the parent report is the only thing that makes a defect
    -- readable in an inbox. qc_reports.title is NOT NULL (00172:62).
    v_title    := rep.title || ' — ' || e.title;

    IF v_item.id IS NULL THEN
      IF e.conformance <> 'fail' THEN RETURN; END IF;   -- only failures become obligations
      v_assignee := projects.resolve_mirror_assignee(e.project_id, 'qc_defect', e.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(e.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, qc_entry_id,
        opened_at, last_activity_at)
      VALUES (
        e.organisation_id, e.project_id, 'qc_defect', 'mirror', v_title, v_priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, false),
        e.conformance, v_assignee, v_gate,
        NULL,                  -- no due date on the source: A(b) +5 wd, site
        e.created_by, e.id,
        -- #4: a qc_defect is only ever born on conformance='fail', never closed,
        -- so opened_at/last_activity_at are the only historical stamps here.
        e.created_at, COALESCE(e.updated_at, e.created_at))
      -- work_items_src_qc_uidx (00196:373).
      ON CONFLICT (qc_entry_id) WHERE qc_entry_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 does it.
    ELSE
      UPDATE projects.work_items
         SET project_id = e.project_id, organisation_id = e.organisation_id,   -- improvement 8, rides C''s exemption
             title = v_title, priority = v_priority, source_status = e.conformance,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             closed_at = CASE WHEN v_mapped = 'closed' THEN COALESCE(v_item.closed_at, now()) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  -- Entry point 1: the entry itself changed.
  CREATE OR REPLACE FUNCTION projects.mirror_qc_defect_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_qc_entry(NEW.id);
    RETURN NULL;
  END $fn$;

  -- Entry point 2: the REPORT was issued, which brings every failed entry into
  -- scope in one statement. Without this the qc_defect projection would never
  -- fire on the normal authoring path, because the entry itself does not change.
  CREATE OR REPLACE FUNCTION projects.mirror_qc_report_defects()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE v_id uuid;
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    IF NEW.status NOT IN ('issued','closed') THEN RETURN NULL; END IF;

    FOR v_id IN SELECT e.id FROM projects.qc_entries e
                 WHERE e.report_id = NEW.id AND e.conformance = 'fail'
    LOOP
      PERFORM projects.project_qc_entry(v_id);
    END LOOP;
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER qc_entries_mirror_work_item_ins
    AFTER INSERT ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

  CREATE TRIGGER qc_entries_mirror_work_item_upd
    AFTER UPDATE OF title, conformance, severity, project_id, organisation_id
    ON projects.qc_entries
    FOR EACH ROW
    WHEN (OLD.title           IS DISTINCT FROM NEW.title
       OR OLD.conformance     IS DISTINCT FROM NEW.conformance
       OR OLD.severity        IS DISTINCT FROM NEW.severity
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

  -- ⚠ §12 §(c) hard dependency 5 says the projection triggers cover the six
  -- automatic A(b) sources "and only those". This is a SEVENTH table, and it is
  -- required: the qc_defect scope predicate spans two tables and an entry does not
  -- cross it on its own (F4). §12 §(c) is amended in this PR to say so.
  CREATE TRIGGER qc_reports_mirror_defects
    AFTER UPDATE OF status ON projects.qc_reports
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION projects.mirror_qc_report_defects();
  ```

- [ ] **Step 4: Run the probe and watch 7/7 pass.**

- [ ] **Step 5: Mutation-verify F4 — drop the report trigger and watch the normal path go dark.** Comment out `CREATE TRIGGER qc_reports_mirror_defects`, re-run. Expected:
  ```
  FAIL  issue_report_projects_the_fail    F4: issuing the REPORT is the normal path; an entry-only trigger never fires here
  FAIL  severity_maps_to_priority         §03 §1.10: major → high, never a flat medium
  FAIL  source_status_is_conformance      source_status mirrors conformance
  FAIL  title_carries_the_report          qc_entries has no location column and its titles are checklist lines
  FAIL  entry_pass_closes_item            fail → pass on an issued report closes the defect
  ```
  This is the whole finding: with only an entry-level trigger, a QC report can be issued with failed entries and **nothing reaches anybody's inbox**. Restore. Record 7/7 → 2/7 → 7/7.

- [ ] **Step 6: Make `draft_report_projects_nothing` non-vacuous.** Change the scope test to `IF false AND v_item.id IS NULL THEN RETURN; END IF;` — i.e. project regardless of report status — and re-run. Expected:
  ```
  FAIL  draft_report_projects_nothing  a fail on a DRAFT report is not yet an obligation
  ```
  Restore.

- [ ] **Step 7: Mutation-verify improvement 5.** Change `v_title := rep.title || ' — ' || e.title;` to `v_title := e.title;`. Re-run. Expected: `FAIL title_carries_the_report`. Restore.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/08-qc-mirror.sql
  git commit -m "feat(work-items): qc_defect projection on both the report-issue and entry-edit paths

An entry enters scope when its REPORT is issued, which is an UPDATE on
qc_reports; an entry-only trigger never fires on the normal authoring path.
The title carries the report title because qc_entries has no location column
and its own titles are checklist lines."
  ```

---

## Task 10 — The `diary_action` projection (improvement 1)

`projects.site_diary_entries` has **no status column, no owner column and no due date** (`00002:146-158`, `00017:14-18`) — the emptiest row in §03 §1.1's table. `diary_action` carries the shortest offset on the board — **+2 working days, site calendar** (A(b)) — because a delay recorded today is stale by Friday (§03 §1.5).

⚠ **The scope predicate is `projects.diary_delay_text()`, not "the text box is non-empty".** Measured on production 2026-09-10, **6 of 6** entries a non-empty test would project are negations:

| entry_date | text |
|---|---|
| 2026-06-02 | `No delays or info required was noted in the site walk and or meeting` |
| 2026-06-24 | `None,` |
| 2026-06-24 | `None,` |
| 2026-06-25 | `None` |
| 2026-07-21 | `None` |
| 2026-07-22 | `NO` |

**Zero of the six is a delay.** A non-empty test measures whether the box was filled in — the same class of error as counting `field.form_responses` newlines and reading the `client_viewer` zero as rarity. Shipped without the stop-list, day one puts six items titled `Delay 2026-06-24: None,` with a +2 working-day due date in the owner's own inbox. Contractors will keep typing "None" daily, so **the stop-list lives on the live trigger**, not only in the backfill. The diary arm of the backfill is dropped entirely (Task 14).

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/09-diary-mirror.sql`

- [ ] **Step 1: Write the probe first, with the live strings as fixtures.** Create `scripts/db/probes/09-diary-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_plain uuid; v_delay uuid; v_none uuid; v_sentence uuid;
    v_title text; v_src text; v_upgraded int;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_diary', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- (a) no delay text at all — 47 of 53 live entries
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Slab poured, no issues', v_pm) RETURNING id INTO v_plain;

    -- (b) the exact live values — 6 of 6 of them
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Rain', 'None,', v_pm) RETURNING id INTO v_none;
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Walk',
            'No delays or info required was noted in the site walk and or meeting', v_pm)
    RETURNING id INTO v_sentence;

    -- (c) an actual delay
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, DATE '2026-06-24', 'Rain',
            'Crane stood down 4h awaiting sparks', v_pm)
    RETURNING id INTO v_delay;

    SELECT w.title, w.source_status INTO v_title, v_src
      FROM projects.work_items w WHERE w.diary_id = v_delay;

    -- (d) the upgrade path: a plain entry later edited to record a real delay
    UPDATE projects.site_diary_entries SET delay_notes = 'Late delivery of DB-04A'
     WHERE id = v_plain;
    SELECT count(*) INTO v_upgraded FROM projects.work_items WHERE diary_id = v_plain;

    CREATE TEMP TABLE d_ctx(plain uuid, delay uuid, none uuid, sentence uuid,
      title text, src text, upgraded int) ON COMMIT DROP;
    INSERT INTO d_ctx VALUES (v_plain, v_delay, v_none, v_sentence, v_title, v_src, v_upgraded);
  END $probe$;

  SELECT 'empty_entry_not_mirrored' AS probe,
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.none) = 0 AS ok,
         'the string is literally "None," — 2 of the 6 live rows say exactly this' AS detail
  UNION ALL
  SELECT 'sentence_negation_not_mirrored',
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.sentence) = 0,
         'the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough'
  UNION ALL
  SELECT 'no_delay_text_not_mirrored', true,
         'TAUTOLOGY — delete this row in Step 4; edit_into_scope_mirrors covers the property'
  UNION ALL
  SELECT 'real_delay_mirrored',
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.delay) = 1,
         'a genuine delay must still project, or the stop-list has eaten the feature'
  UNION ALL
  SELECT 'title_carries_the_delay',
         (SELECT title = 'Delay 2026-06-24: Crane stood down 4h awaiting sparks' FROM d_ctx),
         'the item must be readable in an inbox without opening the diary'
  UNION ALL
  SELECT 'source_status_is_null',
         (SELECT src IS NULL FROM d_ctx),
         'the source has no status column, so there is nothing to mirror'
  UNION ALL
  SELECT 'edit_into_scope_mirrors',
         (SELECT upgraded = 1 FROM d_ctx),
         'adding real delay_notes to an existing entry brings it into scope';
  ```
  ⚠ Delete the `no_delay_text_not_mirrored` row before committing — it is a tautology written here only to make the numbering obvious while drafting, and a tautological assertion is exactly what §12 §(h)'s fixture rule forbids. The property it names is covered by `edit_into_scope_mirrors`, which projects the same row **only after** real text is added.

- [ ] **Step 2: Run it. Expected 4/7** — `empty_entry_not_mirrored`, `sentence_negation_not_mirrored`, the tautological `no_delay_text_not_mirrored` and `source_status_is_null` all pass **vacuously** because nothing exists yet. Read that as the fixture-quality warning it is; Step 4 deletes the tautology and Step 5 makes the other three real.

- [ ] **Step 3: Append the diary projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_diary_action(p_entry_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    d          projects.site_diary_entries%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_delay text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO d FROM projects.site_diary_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- Improvement 1. NOT "the text box is non-empty": all 6 of 6 live values a
    -- non-empty test would project are the word None. See projects.diary_delay_text.
    v_delay := projects.diary_delay_text(d.delays, d.delay_notes);

    SELECT * INTO v_item FROM projects.work_items WHERE diary_id = d.id AND origin = 'mirror';

    -- No delay: nothing to do. An entry edited to REMOVE its delay keeps its item —
    -- the delay was recorded and acted on, and silently deleting an inbox item
    -- because prose changed is worse than one stale row.
    IF v_delay IS NULL THEN RETURN; END IF;

    v_title := 'Delay ' || to_char(d.entry_date, 'YYYY-MM-DD') || ': ' || left(v_delay, 120);

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_mirror_assignee(d.project_id, 'diary_action', d.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(d.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, diary_id,
        opened_at, last_activity_at)
      VALUES (
        d.organisation_id, d.project_id, 'diary_action', 'mirror', v_title, 'medium',
        projects.work_item_status_for_mirror(NULL, NULL, false),
        NULL,                  -- the source has no status vocabulary at all
        v_assignee, v_gate, NULL, d.created_by, d.id,
        d.created_at, COALESCE(d.updated_at, d.created_at))   -- #4
      -- work_items_src_diary_uidx (00196:374).
      ON CONFLICT (diary_id) WHERE diary_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 does it.
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM d.project_id;   -- improvement 8, rides C''s exemption
      UPDATE projects.work_items
         SET project_id = d.project_id, organisation_id = d.organisation_id,
             title = v_title,
             assignee_id = CASE WHEN v_moved
                                THEN projects.resolve_mirror_assignee(d.project_id,'diary_action',d.created_by)
                                ELSE v_item.assignee_id END,
             gatekeeper_id = CASE WHEN v_moved
                                  THEN projects.resolve_work_item_gatekeeper(d.project_id, NULL)
                                  ELSE v_item.gatekeeper_id END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_diary_action_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_diary_action(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER site_diary_entries_mirror_work_item_ins
    AFTER INSERT ON projects.site_diary_entries
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_diary_action_work_item();

  CREATE TRIGGER site_diary_entries_mirror_work_item_upd
    AFTER UPDATE OF delays, delay_notes, entry_date, project_id, organisation_id
    ON projects.site_diary_entries
    FOR EACH ROW
    WHEN (OLD.delays          IS DISTINCT FROM NEW.delays
       OR OLD.delay_notes     IS DISTINCT FROM NEW.delay_notes
       OR OLD.entry_date      IS DISTINCT FROM NEW.entry_date
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_diary_action_work_item();
  ```

- [ ] **Step 4: Delete the tautological probe row flagged in Step 1, run the probe and watch 6/6 pass.**

- [ ] **Step 5: Make the three vacuous assertions real — this is the acceptance step for the task.** Change `v_delay := projects.diary_delay_text(d.delays, d.delay_notes);` to the original non-empty predicate:
  ```sql
  v_delay := COALESCE(NULLIF(TRIM(d.delays), ''), NULLIF(TRIM(d.delay_notes), ''));
  ```
  Re-run. Expected:
  ```
  FAIL  empty_entry_not_mirrored        the string is literally "None," — 2 of the 6 live rows say exactly this
  FAIL  sentence_negation_not_mirrored  the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough
  ```
  Restore. Then change it to `v_delay := NULL;` and re-run: `FAIL real_delay_mirrored`, `FAIL title_carries_the_delay`, `FAIL edit_into_scope_mirrors` — the stop-list has eaten the feature. Restore. **Record 6/6 → 4/6 → 3/6 → 6/6 in the PR body.**

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/09-diary-mirror.sql
  git commit -m "feat(work-items): diary_action projection, gated on a real delay and not a filled-in box

All 6 of 6 live site_diary_entries delay values are negations — None, / None, /
None / None / NO / 'No delays or info required was noted…'. A non-empty test
measures whether the box was filled in, not whether a delay occurred."
  ```

---

## Task 11 — The `form_action` projection (F10)

`field.site_forms` holds **1 row** on production, on `(649) PNP FAERIE GLEN`. `form_action`'s +3 working days is set by what the record is for — it feeds a supplementary CoC under EIR reg 7(4) — not by how long the form takes to fill (§03 §1.5).

⚠ `field.site_forms` already carries `trg_site_forms_transition` (`00179:415`; function `field.enforce_site_form_transition()` at `00179:347`, deliberately `SECURITY INVOKER` with the rationale at `00179:341-346`). The mirror is `AFTER`, so the state machine runs first and the mirror only ever sees a legal transition. **Do not convert the mirror to `BEFORE` for any reason.**

**F10 — a site form is born `open`, not `triage`, and that is a decision.** `field.site_forms.created_by` is `UUID NOT NULL DEFAULT auth.uid()` (`00179:83`), so the original `NEW.created_by IS NOT NULL` was a tautology and the outcome was accidental. The decision taken here: **a site form is the thing its author must finish**, so its author is an explicit owner and the item is born `open` on them. The literal `true` and the reason are in the code, and probe 10 asserts `= 'open'` rather than `IN ('triage','open')` so nobody can flip it without a failing test.

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/10-form-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/10-form-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_tpl uuid; v_form uuid;
    v_title text; v_status text; v_assignee uuid; v_bic uuid;
    v_dist_status text; v_dist_bic uuid; v_dist_closed timestamptz;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT id INTO v_tpl FROM field.form_templates WHERE is_active LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_form', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO field.site_forms (organisation_id, project_id, template_row_id,
                                  board_ref, board_label, status, created_by)
    VALUES (v_org, v_proj, v_tpl, 'DB-PROBE', 'Probe board', 'draft', v_pm)
    RETURNING id INTO v_form;

    SELECT w.title, w.status, w.assignee_id, w.ball_in_court_id
      INTO v_title, v_status, v_assignee, v_bic
      FROM projects.work_items w WHERE w.site_form_id = v_form;

    UPDATE field.site_forms
       SET status = 'distributed', submitted_at = now(), submitted_by = created_by,
           distributed_at = now(), distributed_by = created_by
     WHERE id = v_form;

    SELECT w.status, w.ball_in_court_id, w.closed_at
      INTO v_dist_status, v_dist_bic, v_dist_closed
      FROM projects.work_items w WHERE w.site_form_id = v_form;

    CREATE TEMP TABLE f_ctx(form uuid, pm uuid, title text, status text,
      assignee uuid, bic uuid, dist_status text, dist_bic uuid, dist_closed timestamptz)
      ON COMMIT DROP;
    INSERT INTO f_ctx VALUES (v_form, v_pm, v_title, v_status, v_assignee, v_bic,
      v_dist_status, v_dist_bic, v_dist_closed);
  END $probe$;

  SELECT 'form_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, f_ctx c
           WHERE w.site_form_id = c.form AND w.origin = 'mirror') = 1 AS ok,
         'a draft form is already an obligation: somebody has to finish it' AS detail
  UNION ALL
  SELECT 'title_names_the_board',
         (SELECT title LIKE '%Probe board%' FROM f_ctx),
         'the item must name the board without opening the form'
  UNION ALL
  -- F10, decided rather than accidental.
  SELECT 'draft_is_open_on_its_author',
         (SELECT status = 'open' AND assignee = pm AND bic = pm FROM f_ctx),
         'F10: a site form IS the thing its author must finish, so it is born open on them, not triage'
  UNION ALL
  SELECT 'distributed_is_closed',
         (SELECT dist_status = 'closed' AND dist_closed IS NOT NULL FROM f_ctx),
         'submitted → answered → distributed → closed'
  UNION ALL
  SELECT 'closed_clears_bic',
         (SELECT dist_bic IS NULL FROM f_ctx),
         'A(a): the item leaves every inbox on closed';
  ```

- [ ] **Step 2: Run it and watch `form_item_created` fail, 1/5** — `closed_clears_bic` passes vacuously (there is no ball to clear).

- [ ] **Step 3: Append the form projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_form_action(p_form_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    f          field.site_forms%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO f FROM field.site_forms WHERE id = p_form_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items WHERE site_form_id = f.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('form_action', f.status);
    -- board_label is the as-found nameplate and board_ref the schedule tag; the
    -- site_forms_board_identified CHECK (00179:93-95) guarantees one of them.
    v_title  := COALESCE(f.form_no, 'Site form') || ' — '
                || COALESCE(NULLIF(TRIM(f.board_label), ''), f.board_ref, 'board');

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_mirror_assignee(f.project_id, 'form_action', f.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(f.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, site_form_id,
        opened_at, last_activity_at, closed_at, closed_by, void_reason)
      VALUES (
        f.organisation_id, f.project_id, 'form_action', 'mirror', v_title, 'medium',
        -- F10. The third argument is a literal true, not `f.created_by IS NOT NULL`
        -- (which is a tautology: 00179:83 makes created_by NOT NULL DEFAULT
        -- auth.uid()). The decision: a site form IS the thing its author must
        -- finish, so the author is an explicit owner and the item is born `open`
        -- on them rather than entering the triage queue. Probe 10 asserts = 'open'.
        projects.work_item_status_for_mirror(NULL, v_mapped, true),
        f.status, v_assignee, v_gate, NULL, f.created_by, f.id,
        -- #4: historical stamps. The one live form may be distributed (born
        -- closed) or void on the backfill; both shapes carry their source stamps.
        f.created_at, f.updated_at,
        CASE WHEN f.status = 'distributed' THEN COALESCE(f.distributed_at, f.updated_at) END,
        CASE WHEN f.status = 'distributed' THEN f.distributed_by END,
        CASE WHEN f.status = 'void'
             THEN COALESCE(NULLIF(btrim(f.void_reason), ''), 'form voided at source') END)
      -- work_items_src_form_uidx (00196:375).
      ON CONFLICT (site_form_id) WHERE site_form_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;
      -- No watcher seeding: §11 does it.
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM f.project_id;   -- improvement 8, rides C''s exemption
      UPDATE projects.work_items
         SET project_id = f.project_id, organisation_id = f.organisation_id,
             title = v_title, source_status = f.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id = CASE WHEN v_moved
                                THEN projects.resolve_mirror_assignee(f.project_id,'form_action',f.created_by)
                                ELSE v_item.assignee_id END,
             gatekeeper_id = CASE WHEN v_moved
                                  THEN projects.resolve_work_item_gatekeeper(f.project_id, NULL)
                                  ELSE v_item.gatekeeper_id END,
             closed_at = CASE WHEN f.status = 'distributed'
                              THEN COALESCE(v_item.closed_at, f.distributed_at, now()) END,
             closed_by = CASE WHEN f.status = 'distributed'
                              THEN COALESCE(v_item.closed_by, f.distributed_by) END,
             -- #4 / #3: a void row always keeps a non-blank reason (the guard's
             -- check is skipped under the exemption and would bite on the next
             -- signed-in UPDATE); void is terminal, so ELSE keeps what it had.
             void_reason = CASE WHEN f.status = 'void'
                                THEN COALESCE(NULLIF(btrim(f.void_reason), ''), v_item.void_reason,
                                              'form voided at source')
                                ELSE v_item.void_reason END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_form_action_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_form_action(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER site_forms_mirror_work_item_ins
    AFTER INSERT ON field.site_forms
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_form_action_work_item();

  CREATE TRIGGER site_forms_mirror_work_item_upd
    AFTER UPDATE OF form_no, board_ref, board_label, status,
                    distributed_at, distributed_by, void_reason, project_id, organisation_id
    ON field.site_forms
    FOR EACH ROW
    WHEN (OLD.form_no         IS DISTINCT FROM NEW.form_no
       OR OLD.board_ref       IS DISTINCT FROM NEW.board_ref
       OR OLD.board_label     IS DISTINCT FROM NEW.board_label
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.distributed_at  IS DISTINCT FROM NEW.distributed_at
       OR OLD.distributed_by  IS DISTINCT FROM NEW.distributed_by
       OR OLD.void_reason     IS DISTINCT FROM NEW.void_reason
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_form_action_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 5/5 pass.**

- [ ] **Step 5: Mutation-verify F10.** Change the third argument from `true` to `false`. Re-run. Expected: `FAIL draft_is_open_on_its_author  F10: a site form IS the thing its author must finish, …` — the item lands in triage instead. Restore. This is the pin that stops the decision drifting back to an accident.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/10-form-mirror.sql
  git commit -m "feat(work-items): form_action projection, born open on its author

created_by is NOT NULL DEFAULT auth.uid() (00179:83), so the original
'created_by IS NOT NULL' test was a tautology and the outcome was accidental.
Decided: a site form is the thing its author must finish. A born-distributed or
born-void form carries its source stamps; a void row's reason is never blanked."
  ```

---

## Task 12 — Six delete-to-void triggers, `BEFORE DELETE` (F1)

§03 §1.2 chose `ON DELETE SET NULL` over `CASCADE` on the house precedent that *"deleting a board must not delete the record of having made it safe"* (`00179:75-77`), and because `deleteDiaryEntryAction` (`apps/web/src/actions/diary.actions.ts:109`) is a live, gated action today — a cascade would silently destroy the item's `work_item_events` and with them the median-days-to-respond metric.

**The spec's `AFTER DELETE` does not work, and the consequence is worse than an orphan.** The RI `SET NULL` action runs before a user `AFTER DELETE` trigger, so the `AFTER` form's `UPDATE … WHERE rfi_id = OLD.id` matches nothing. But A(a)'s

```sql
CONSTRAINT work_items_source_required CHECK (
  item_type IN ('task','approval') OR status = 'void'
  OR <exactly one source column is non-null>)
```

is re-evaluated on that `SET NULL` update, and at that moment the item is still `status = 'open'` with zero sources. **So the DELETE aborts with `23514`.** Deleting a diary entry, an RFI or a snag would simply stop working in production the moment a mirror item existed for it.

With `BEFORE DELETE` the item is already `void` when `SET NULL` fires, both `work_items_source_required` and `work_items_bic_present` pass on their `void` arms, and the delete proceeds. `ball_in_court_id` goes NULL for free — it is a `STORED` generated column over `status`.

⚠ **An earlier probe reported the `AFTER` case as a silently-orphaned open item (`{src_id: null, status: "open", void_reason: null}`). That probe ran against a synthetic table with no CHECK constraints and its result is withdrawn.** Step 5 measures the real thing against item 2's table.

One function serves all six, keyed on `TG_ARGV[0]`. `format('%I')` quotes the identifier, and `TG_ARGV` is developer-supplied in this file, so there is no injection surface.

**Files:**
- Modify: the migration — add section F
- Create: `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts`
- Test: `scripts/db/probes/11-delete-to-void.sql`

- [ ] **Step 1: Write the probe first, covering three sources.** Create `scripts/db/probes/11-delete-to-void.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rfi uuid; v_snag uuid; v_diary uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_delete', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'Doomed RFI', 'x', 'medium', 'open', v_pm) RETURNING id INTO v_rfi;
    INSERT INTO field.snags (project_id, organisation_id, title, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Doomed snag', 'medium', 'open', v_pm) RETURNING id INTO v_snag;
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'x', 'Crane stood down 4h', v_pm)
    RETURNING id INTO v_diary;

    CREATE TEMP TABLE del_ctx(kind text, item uuid) ON COMMIT DROP;
    INSERT INTO del_ctx
      SELECT 'rfi',   w.id FROM projects.work_items w WHERE w.rfi_id   = v_rfi   UNION ALL
      SELECT 'snag',  w.id FROM projects.work_items w WHERE w.snag_id  = v_snag  UNION ALL
      SELECT 'diary', w.id FROM projects.work_items w WHERE w.diary_id = v_diary;

    -- With AFTER DELETE these three statements RAISE 23514 and the whole probe
    -- returns HTTP 400 instead of any assertion rows. That is the finding.
    DELETE FROM projects.rfis               WHERE id = v_rfi;
    DELETE FROM field.snags                 WHERE id = v_snag;
    DELETE FROM projects.site_diary_entries WHERE id = v_diary;
  END $probe$;

  SELECT 'three_items_existed' AS probe, (SELECT count(*) FROM del_ctx) = 3 AS ok,
         'the fixture must actually have produced items, or every row below passes vacuously' AS detail
  UNION ALL
  SELECT 'deletes_succeeded',
         (SELECT count(*) FROM projects.rfis WHERE subject = 'Doomed RFI') = 0,
         'F1: with AFTER DELETE the DELETE itself aborts on work_items_source_required'
  UNION ALL
  SELECT 'all_voided',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.status = 'void' AND w.void_reason = 'source deleted') = 3,
         'the item is voided BEFORE the RI SET NULL empties its source column'
  UNION ALL
  SELECT 'fk_is_null',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.rfi_id IS NULL AND w.snag_id IS NULL AND w.diary_id IS NULL) = 3,
         'ON DELETE SET NULL still applied, after the void'
  UNION ALL
  SELECT 'bic_cleared',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.ball_in_court_id IS NULL) = 3,
         'A(a): the generated column is NULL on void, so the item leaves every inbox'
  UNION ALL
  SELECT 'events_survive',
         (SELECT count(*) FROM projects.work_item_events e JOIN del_ctx d ON d.item = e.work_item_id) > 0,
         '§03 §1.2: the events are why this is not a CASCADE';
  ```

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/11-delete-to-void.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected — with no void trigger at all, the constraint fires exactly as it would with `AFTER DELETE`:
  ```
  FAIL (HTTP 400)
  … ERROR: 23514: new row for relation "work_items" violates check constraint "work_items_source_required"
  ```
  **Read that error. It is the finding.** Delete of an RFI is broken until this task lands.

- [ ] **Step 3: Append section F.**
  ```sql
  -- ─── F. Delete-to-void ───────────────────────────────────────────────────────
  -- ⚠ BEFORE DELETE, not AFTER. §03 §1.2 says AFTER; that is measurably wrong.
  -- The ON DELETE SET NULL referential action runs before a user AFTER DELETE
  -- trigger, so the AFTER form's UPDATE matches nothing — and A(a)'s
  -- work_items_source_required is re-evaluated on that SET NULL while the item is
  -- still status='open' with zero sources, so the DELETE ABORTS with 23514.
  -- Deleting a diary entry (deleteDiaryEntryAction, diary.actions.ts:109), an RFI
  -- or a snag would simply stop working the moment a mirror item existed.
  -- BEFORE DELETE voids first, so both work_items_source_required and
  -- work_items_bic_present pass on their 'void' arms and the delete proceeds.
  CREATE OR REPLACE FUNCTION projects.void_work_item_on_source_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    -- %I quotes the identifier; TG_ARGV[0] is set by the six CREATE TRIGGER
    -- statements below and is never user input.
    -- ball_in_court_id needs no clearing: it is a STORED generated column over
    -- status and goes NULL on 'void' by itself (A(a)).
    EXECUTE format(
      'UPDATE projects.work_items
          SET status = ''void'', void_reason = $1, last_activity_at = now()
        WHERE %I = $2 AND status <> ''void''', TG_ARGV[0])
      USING 'source deleted', OLD.id;
    RETURN OLD;   -- BEFORE trigger: returning OLD lets the DELETE proceed
  END $fn$;

  CREATE TRIGGER rfis_void_work_item BEFORE DELETE ON projects.rfis
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('rfi_id');
  CREATE TRIGGER snags_void_work_item BEFORE DELETE ON field.snags
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('snag_id');
  CREATE TRIGGER inspections_void_work_item BEFORE DELETE ON inspections.inspections
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('inspection_id');
  CREATE TRIGGER qc_entries_void_work_item BEFORE DELETE ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('qc_entry_id');
  CREATE TRIGGER site_diary_entries_void_work_item BEFORE DELETE ON projects.site_diary_entries
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('diary_id');
  CREATE TRIGGER site_forms_void_work_item BEFORE DELETE ON field.site_forms
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('site_form_id');
  ```

- [ ] **Step 4: Run the probe and watch 6/6 pass.**

- [ ] **Step 5: Mutation-verify F1 — the acceptance step for the whole task.** Change all six `BEFORE DELETE` to `AFTER DELETE` and re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23514: new row for relation "work_items" violates check constraint "work_items_source_required"
  ```
  — not a failing assertion, an aborted statement. **Copy the exact SQLSTATE, constraint name and message into the PR body**, and note that no assertion row is returned at all, which is why the harness's zero-rows guard (Task 1 Step 7) matters. Restore `BEFORE DELETE` and confirm 6/6.

- [ ] **Step 6: Write the contract test that pins it in CI.** Create `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'

  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  function mirrorMigration(): { name: string; sql: string } {
    for (const n of readdirSync(MIG_DIR).sort()) {
      const sql = readFileSync(join(MIG_DIR, n), 'utf8')
      if (sql.includes('projects.void_work_item_on_source_delete')) return { name: n, sql }
    }
    throw new Error('no migration defines projects.void_work_item_on_source_delete')
  }

  /** Strip block and whole-line comments so prose ABOUT the bug does not read AS the bug. */
  function stripComments(sql: string): string {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*--.*$/gm, '')
  }

  const SOURCES = [
    ['rfis', 'projects.rfis'],
    ['snags', 'field.snags'],
    ['inspections', 'inspections.inspections'],
    ['qc_entries', 'projects.qc_entries'],
    ['site_diary_entries', 'projects.site_diary_entries'],
    ['site_forms', 'field.site_forms'],
  ] as const

  describe('work-item source mirrors: structural contract', () => {
    const { name, sql } = mirrorMigration()
    const code = stripComments(sql)

    it('every delete-to-void trigger is BEFORE DELETE, never AFTER', () => {
      const triggers = [...code.matchAll(
        /CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+DELETE\s+ON\s+([\w.]+)[\s\S]{0,200}?void_work_item_on_source_delete/gi,
      )]
      expect(triggers.length, 'expected six delete-to-void triggers').toBe(6)
      const wrong = triggers.filter((t) => t[2].toUpperCase() !== 'BEFORE')
        .map((t) => `${t[1]} ON ${t[3]} is ${t[2]} DELETE`)
      expect(
        wrong,
        `${name}: an AFTER DELETE trigger cannot void the item. The ON DELETE SET NULL ` +
        `referential action runs first, and work_items_source_required is re-evaluated on ` +
        `that update while the item is still open with no source — so the DELETE aborts ` +
        `with 23514 and deleting an RFI/snag/diary entry stops working. Measured, not theorised.`,
      ).toEqual([])
    })

    it('F7: every source has an _ins trigger and an _upd trigger with a WHEN clause', () => {
      for (const [prefix, table] of SOURCES) {
        const ins = new RegExp(
          `CREATE TRIGGER\\s+${prefix}_mirror_work_item_ins\\s+AFTER INSERT ON\\s+${table.replace('.', '\\.')}`, 'i')
        expect(code, `${prefix}: missing an AFTER INSERT trigger on ${table}`).toMatch(ins)

        const updMatch = code.match(new RegExp(
          `CREATE TRIGGER\\s+${prefix}_mirror_work_item_upd[\\s\\S]*?EXECUTE FUNCTION`, 'i'))
        expect(updMatch, `${prefix}: missing an AFTER UPDATE trigger on ${table}`).not.toBeNull()
        expect(
          updMatch![0],
          `${prefix}_mirror_work_item_upd must carry the §03 §1.2 WHEN predicate. ` +
          `PostgreSQL rejects WHEN(OLD…) on a trigger whose events include INSERT, which is ` +
          `why the declaration is split in two rather than dropped.`,
        ).toMatch(/\bWHEN\s*\(\s*OLD\./i)
        expect(
          updMatch![0],
          `${prefix}_mirror_work_item_upd must watch project_id: §15's rollout moves snags to ` +
          `KINGSWALK, and an item left on the old project keeps the wrong scope and people.`,
        ).toMatch(/OLD\.project_id\s+IS DISTINCT FROM\s+NEW\.project_id/i)
      }
    })

    it('every mirror trigger wrapper carries the pg_trigger_depth guard', () => {
      const fns = [...code.matchAll(
        /CREATE OR REPLACE FUNCTION\s+(projects\.mirror_\w+)\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
      )]
      expect(fns.length, 'expected the seven mirror trigger wrappers').toBe(7)
      const unguarded = fns
        .filter((f) => !/pg_trigger_depth\(\)\s*>\s*1/.test(f[2]))
        .map((f) => f[1])
      expect(unguarded, `unguarded mirror wrappers: ${unguarded.join(', ')}`).toEqual([])
    })

    it('the projection bodies are callable directly and carry NO depth guard', () => {
      const bodies = [...code.matchAll(
        /CREATE OR REPLACE FUNCTION\s+(projects\.project_\w+)\s*\(p_\w+ uuid\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
      )]
      expect(bodies.length, 'expected six projects.project_<source>(uuid) bodies').toBe(6)
      const guarded = bodies.filter((b) => /pg_trigger_depth/.test(b[2])).map((b) => b[1])
      expect(
        guarded,
        `${guarded.join(', ')} must NOT carry a depth guard: the backfill calls these directly ` +
        `(at depth 0) precisely so it never UPDATEs a source row and never rewrites updated_at ` +
        `on ~40 live rows through their set_updated_at triggers.`,
      ).toEqual([])
    })

    it('the backfill never UPDATEs a source table', () => {
      const offenders = [
        ...code.matchAll(/UPDATE\s+(projects\.rfis|field\.snags|inspections\.inspections|projects\.qc_entries|projects\.site_diary_entries|field\.site_forms)\b/gi),
      ].map((m) => m[0])
      // The write-back legitimately updates rfis and snags; nothing else may.
      const illegal = offenders.filter((o) => !/projects\.rfis|field\.snags/i.test(o))
      expect(
        illegal,
        `${illegal.join(', ')}: every source table carries a BEFORE UPDATE set_updated_at ` +
        `trigger, so touching one rewrites live history. Project through projects.project_*().`,
      ).toEqual([])
    })

    it('the write-back function deliberately has NO depth guard', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(m, 'work_item_assignment_writeback not found').not.toBeNull()
      expect(
        /pg_trigger_depth/.test(m![1]),
        'A depth guard here silently loses the write-back: work_items.assignee_id names the ' +
        'resolved holder while rfis.assigned_to stays NULL and the RFI page renders nothing. ' +
        'Termination comes from the mirror wrappers, proved by mutation.',
      ).toBe(false)
    })

    it('the write-back skips closed and void records', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(
        m![1],
        '6 of 15 live RFIs are already closed. Stamping assigned_to on them makes the RFI page ' +
        'render an assignee nobody ever set — the as_left_status lesson.',
      ).toMatch(/NEW\.status IN \('closed','void'\)/)
    })

    it('the diary projection is gated on diary_delay_text, not on a non-empty box', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.project_diary_action\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(m, 'projects.project_diary_action not found').not.toBeNull()
      expect(
        m![1],
        'All 6 of 6 live site_diary_entries delay values are negations (measured 2026-09-10). ' +
        'A COALESCE(NULLIF(TRIM(...))) predicate measures whether the box was filled in.',
      ).toMatch(/projects\.diary_delay_text\(/)
    })

    it('nothing in this migration attaches a trigger to structure.node_orders', () => {
      const offenders = [...code.matchAll(/CREATE TRIGGER\s+\w+[\s\S]{0,200}?ON\s+(structure\.node_orders)/gi)]
        .map((m) => m[0].split('\n')[0].trim())
      expect(
        offenders,
        'A(b): order_followup is created ONLY by the explicit chase control on an order line. ' +
        'A projection trigger here would put 440 live procurement rows into inboxes on day one.',
      ).toEqual([])
    })

    it('F8: the replaced transition guard exempts depth > 1 (never > 0) and freezes source_status', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.work_items_transition_guard\s*\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(m, 'the guard replacement (section C′) is missing — every mirror UPDATE in a signed-in session is refused without it').not.toBeNull()
      expect(m![1], '00196:1590-1605 prescribes pg_trigger_depth() > 1').toMatch(/pg_trigger_depth\(\)\s*>\s*1/)
      expect(
        /pg_trigger_depth\(\)\s*>\s*0/.test(m![1]),
        '> 0 exempts every direct client UPDATE (a top-level statement\'s trigger runs at depth 1) — the guard would be disabled',
      ).toBe(false)
      expect(m![1], 'source_status must join clause (a): from this migration the projection is its only writer').toMatch(/NEW\.source_status\s+IS DISTINCT FROM\s+OLD\.source_status/)
      // The mirror wrappers' guard must NOT be weakened to match.
      expect(code).not.toMatch(/mirror_\w+[\s\S]{0,400}?pg_trigger_depth\(\)\s*>\s*0/)
    })
  })
  ```

- [ ] **Step 7: Run it and watch 10 pass.**
  ```bash
  pnpm --filter web test -- mirror-triggers
  ```

- [ ] **Step 8: Prove each of the ten tests can fail — eleven mutations, because the F7 test carries three assertions.** One at a time, undo the thing it guards, run, confirm the named failure, restore:
  - flip one `BEFORE DELETE` → `AFTER DELETE` ⇒ *"rfis_void_work_item ON projects.rfis is AFTER DELETE"*
  - delete the `WHEN` clause from `snags_mirror_work_item_upd` ⇒ *"snags_mirror_work_item_upd must carry the §03 §1.2 WHEN predicate"*
  - delete `OLD.project_id IS DISTINCT FROM NEW.project_id` from one `_upd` ⇒ *"must watch project_id: §15's rollout moves snags to KINGSWALK…"*
  - delete the depth guard from `mirror_snag_work_item` ⇒ *"unguarded mirror wrappers: projects.mirror_snag_work_item"*
  - add a depth guard to `project_rfi` ⇒ *"projects.project_rfi must NOT carry a depth guard…"*
  - add `UPDATE inspections.inspections SET status = status;` anywhere ⇒ *"UPDATE inspections.inspections: every source table carries a BEFORE UPDATE set_updated_at trigger…"*
  - add a depth guard to the write-back ⇒ *"A depth guard here silently loses the write-back…"*
  - delete `IF NEW.status IN ('closed','void')` from the write-back ⇒ *"6 of 15 live RFIs are already closed…"*
  - replace `projects.diary_delay_text(` in `project_diary_action` with `COALESCE(NULLIF(TRIM(` ⇒ *"All 6 of 6 live site_diary_entries delay values are negations…"*
  - add `CREATE TRIGGER x AFTER INSERT ON structure.node_orders …` ⇒ *"A(b): order_followup is created ONLY by the explicit chase control…"*
  - change the guard's `> 1` to `> 0` in section C′ ⇒ *"> 0 exempts every direct client UPDATE…"* — the same mutation probe 05b catches on production (Task 5½ Step 5); this is its CI twin

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          apps/web/src/lib/work-items/mirror-triggers.contract.test.ts \
          scripts/db/probes/11-delete-to-void.sql
  git commit -m "feat(work-items): BEFORE DELETE void triggers + structural contract test

AFTER DELETE does not merely orphan the item: work_items_source_required is
re-evaluated on the ON DELETE SET NULL update while the item is still open with
no source, so the DELETE aborts with 23514 and deleting an RFI, snag or diary
entry stops working entirely."
  ```

---

## Task 13 — Grants, and the `anon` revoke that is not optional (F5)

Two obligations, routinely confused (§12 §(b) rule 5), and **this migration has both**: twenty-two functions (plus the replaced guard, re-revoked in section C′) **and** one table (the pre-migration snapshot in section H).

**Functions — corrected 2026-09-13 (#20).** In `public`, Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` EXECUTE *directly* at creation, so `REVOKE … FROM PUBLIC` alone leaves a separate grant behind — that is how `field.allocate_form_no` was executable by `anon` (`00179:317,326`) and why `00113_lock_rbac_function_grants.sql:14-24` pairs every `FROM PUBLIC` with a `FROM anon`. **`projects` is different:** item 2 read `pg_default_acl` for the schema and found **no function default**. A new `projects` function's `anon` EXECUTE is Postgres's built-in PUBLIC grant, which `REVOKE … FROM PUBLIC` alone strips. Both revokes are still issued — belt-and-braces, and every `grant_absent:` line in the `@verify` block then holds regardless of which schema convention a later migration copies — but the mutation that proves the block bites is dropping the **`FROM PUBLIC`** line, not the `FROM anon` one (Step 5). A reader who "fixes" the missing direct `anon` grant has misread the schema.

**And grant to nobody.** Measured (F5): a trigger fires for a caller holding no EXECUTE privilege on its function — function privileges on a trigger function are checked at `CREATE TRIGGER` time, not at fire time. Every function here is reached only from inside a trigger or from another `SECURITY DEFINER` function owned by the same role, so no `GRANT EXECUTE` is required at all. Adding one would be a widened surface bought for nothing. (Item 2 follows the same posture: `00196:1041–1064, 1461–1462, 1770–1771`.)

**Tables — corrected 2026-09-13 (#20).** `00025_grant_schema_permissions.sql:26` set `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon`, but **`00196:1310` ran `ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON TABLES FROM anon`** (asserted by the `sql:` directive at `00196:130`), so a table created after `00196` is **not** born anon-readable. The snapshot table holds the `assigned_to` of every RFI and snag on the platform; it still gets an explicit `REVOKE SELECT … FROM anon` (true whichever default a future migration re-establishes), RLS with **no policy** — service-role only — and it appears in the `-- @verify:` block and in A(f). Its mutation proof (Task 14 Step 5) is therefore `GRANT`-then-`REVOKE`, because simply deleting the revoke can no longer make the assertion red.

⚠ **Never verify by reading `proacl` or `relacl`.** A NULL `proacl` looks empty but **is** the PUBLIC grant. Use `has_function_privilege` / `has_table_privilege`.

**Files:**
- Modify: the migration — add section G
- Test: `scripts/db/probes/12-grants.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/12-grants.sql`:
  ```sql
  WITH fns AS (
    SELECT p.oid, p.prosrc, p.prosecdef,
           n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || ')' AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'projects'
       AND p.proname IN ('resolve_mirror_assignee',
                         'resolve_work_item_gatekeeper','work_item_person_eligible',
                         'map_source_status','work_item_status_for_mirror',
                         'work_item_mirror_due_date','diary_delay_text',
                         'project_rfi','project_snag','project_inspection',
                         'project_qc_entry','project_diary_action','project_form_action',
                         'mirror_rfi_work_item','mirror_snag_work_item',
                         'mirror_inspection_work_item','mirror_qc_defect_work_item',
                         'mirror_qc_report_defects','mirror_diary_action_work_item',
                         'mirror_form_action_work_item','work_item_assignment_writeback',
                         'void_work_item_on_source_delete')
  )
  SELECT 'all_functions_created' AS probe, count(*) = 22 AS ok,
         'found ' || count(*) || ' of 22 (resolve_project_pm / resolve_work_item_assignee are item 2''s and not counted)' AS detail FROM fns
  UNION ALL
  -- The replaced guard: CREATE OR REPLACE keeps the ACL, and C' re-revokes anyway.
  SELECT 'replaced_guard_still_revoked',
         NOT has_function_privilege('anon', 'projects.work_items_transition_guard()', 'EXECUTE')
     AND NOT has_function_privilege('public', 'projects.work_items_transition_guard()', 'EXECUTE'),
         'section C'' re-issues both revokes so the @verify grant_absent: line is provably true of this file'
  UNION ALL
  SELECT 'anon_cannot_execute_any',
         count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) = 0,
         'anon can execute: ' || COALESCE(string_agg(sig, ', ')
           FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')), 'none') FROM fns
  UNION ALL
  SELECT 'public_cannot_execute_any',
         count(*) FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')) = 0,
         'PUBLIC can execute: ' || COALESCE(string_agg(sig, ', ')
           FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')), 'none') FROM fns
  UNION ALL
  SELECT 'every_stateful_function_is_security_definer',
         count(*) FILTER (WHERE NOT prosecdef) = 0,
         'SECURITY INVOKER: ' || COALESCE(string_agg(sig, ', ') FILTER (WHERE NOT prosecdef), 'none')
    FROM fns
   WHERE sig NOT LIKE 'projects.map_source_status%'
     AND sig NOT LIKE 'projects.work_item_status_for_mirror%'
     AND sig NOT LIKE 'projects.work_item_mirror_due_date%'
     AND sig NOT LIKE 'projects.diary_delay_text%'
  UNION ALL
  -- Narrowed to the AUTHORISATION use, and comment-stripped: this migration is
  -- full of prose explaining why current_user must not be used, and a bare token
  -- match would fail the build on the explanation rather than on the defect.
  SELECT 'no_current_user_authorisation',
         count(*) FILTER (
           WHERE regexp_replace(prosrc, '--[^\n]*', '', 'g')
                 ~* '(IF|AND|OR|WHERE|WHEN)[^\n]*\mcurrent_user\M') = 0,
         'current_user resolves to the function OWNER inside SECURITY DEFINER (00179:341-346)'
    FROM fns
  UNION ALL
  SELECT 'snapshot_table_not_anon_readable',
         NOT has_table_privilege('anon', 'projects.backup_00198_source_assignees', 'SELECT'),
         'holds every RFI and snag assignee; explicitly revoked (00196:1310 already made new projects tables non-anon-readable — belt and braces)'
  UNION ALL
  SELECT 'snapshot_table_has_rls',
         (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='projects' AND c.relname='backup_00198_source_assignees'),
         'RLS on with no policy: service-role only';
  ```
  The snapshot table is named `backup_00198_source_assignees` from the start (A(f)'s R52 convention `backup_<version>_<object>`; `00198` was claimed at Task 2). If Task 20 Step 1 forces a different number, the rename touches this probe in the same commit.

- [ ] **Step 2: Run it and watch `anon_cannot_execute_any` fail,** naming every one of the twenty-two functions — because a new `projects` function inherits Postgres's built-in PUBLIC EXECUTE (there is no function default ACL in `projects`) and nothing has revoked it. This is the whole point of the task; read the list. (`snapshot_table_*` will fail too until section H exists — Task 14 adds it. `replaced_guard_still_revoked` passes already: `CREATE OR REPLACE` kept item 2's ACL and C′ re-revoked.)

- [ ] **Step 3: Append section G.**
  ```sql
  -- ─── G. Grants ───────────────────────────────────────────────────────────────
  -- In `projects` a new function's anon EXECUTE is Postgres's built-in PUBLIC
  -- grant — item 2 measured pg_default_acl and found NO function default for
  -- this schema (unlike `public`, where 00113's precedent pairs FROM PUBLIC with
  -- FROM anon because Supabase grants anon directly). Both revokes are issued
  -- anyway: belt and braces, and every grant_absent: line above then holds
  -- whichever convention a later migration copies. Verified with
  -- has_function_privilege, never proacl — a NULL proacl looks empty but IS the
  -- PUBLIC grant.
  --
  -- No GRANT follows. Measured (F5): a trigger fires for a caller with no EXECUTE
  -- on its function (privileges are checked at CREATE TRIGGER time), and every
  -- function below is reached only from a trigger or from another SECURITY
  -- DEFINER function owned by the same role. Granting EXECUTE would widen the
  -- surface for nothing. The replaced guard is revoked in section C'.
  DO $grants$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'projects'
         AND p.proname IN ('resolve_mirror_assignee',
                           'resolve_work_item_gatekeeper','work_item_person_eligible',
                           'map_source_status','work_item_status_for_mirror',
                           'work_item_mirror_due_date','diary_delay_text',
                           'project_rfi','project_snag','project_inspection',
                           'project_qc_entry','project_diary_action','project_form_action',
                           'mirror_rfi_work_item','mirror_snag_work_item',
                           'mirror_inspection_work_item','mirror_qc_defect_work_item',
                           'mirror_qc_report_defects','mirror_diary_action_work_item',
                           'mirror_form_action_work_item','work_item_assignment_writeback',
                           'void_work_item_on_source_delete')
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',    r.sig);
    END LOOP;
  END $grants$;

  -- Assert the revoke actually took, in the same transaction that made it.
  -- The LIKE ANY pattern is deliberately BROADER than the explicit list above, so
  -- a function added to this migration later and forgotten in the DO block fails
  -- the apply rather than shipping open. It also covers item 2's functions that
  -- share these prefixes (resolve_project_pm, resolve_work_item_assignee,
  -- work_item_*) — all of which item 2 revoked, so the assertion is true today and
  -- stays a tripwire for every later migration in this schema.
  DO $assert_grants$
  DECLARE v_leak text;
  BEGIN
    SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_leak
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'projects'
       AND p.proname LIKE ANY (ARRAY['mirror\_%','resolve\_%','project\_%','map\_source\_status',
                                     'work\_item\_%','work\_items\_transition\_guard',
                                     'void\_work\_item\_%','diary\_delay\_text'])
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'anon retains EXECUTE on: %', v_leak;
    END IF;
  END $assert_grants$;
  ```
  ⚠ `resolve_work_item_assignee` is `GRANT`ed to `authenticated` by item 2 (`00196:1078`) for the people-picker; that grant is **not** touched here and is not what the assertion tests (`anon` only).

- [ ] **Step 4: Run the probe.** Expected: `6/8` — the five function assertions and `replaced_guard_still_revoked` pass; both `snapshot_table_*` rows still fail because section H does not exist yet. That is expected and is closed in Task 14 Step 5.

- [ ] **Step 5: Mutation-verify — drop the `FROM PUBLIC` line, not the `FROM anon` one (#20).** Delete `EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);`, leaving only the `anon` revoke. Re-run. Expected — `anon` inherits PUBLIC's EXECUTE and the assertion names the leak:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: anon retains EXECUTE on: projects.resolve_mirror_assignee, projects.project_rfi, …
  ```
  Restore. (Deleting the `FROM anon` line instead leaves the block **silent** in this schema — there is no direct `anon` grant to remove — which is exactly why the 2026-09-10 mutation could not fail; record that too.) Then, separately, add a twenty-third function named `projects.work_item_scratch()` **without** adding it to the `DO $grants$` list, and confirm the broader `LIKE ANY` assertion catches it by name. Remove it.

- [ ] **Step 6: Mutation-verify the comment-stripping.** Add `-- current_user is never used for authorisation here` as a comment line inside the body of `projects.resolve_mirror_assignee` and re-run: `no_current_user_authorisation` must still **PASS**. Then add `IF current_user = 'postgres' THEN RETURN NULL; END IF;` as real code and re-run: it must **FAIL**. Remove both. This is the difference between testing the string and testing the use.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/12-grants.sql
  git commit -m "feat(work-items): revoke EXECUTE from PUBLIC and anon on all twenty-two functions

Trigger functions fire without EXECUTE (checked at CREATE TRIGGER time), so
nothing is granted. In projects the leak is PUBLIC's built-in grant (no function
default ACL in this schema — item 2 measured it), so the mutation that proves
the block bites is dropping FROM PUBLIC. Asserted with has_function_privilege
inside the migration, under a pattern broader than the explicit list so a
forgotten function fails the apply rather than shipping open."
  ```

---

## Task 14 — The backfill and the completion event (F4, improvements 1, 2, 3, 9)

**What the backfill takes**, all counts re-measured against production on 2026-09-10 **after** improvements 1 and 2:

| Source | Rows | Predicate |
|---|---|---|
| `projects.rfis` | **15** | all of them; `assigned_to` is NULL on **all 15**, so all fifteen resolve through the chain |
| `inspections.inspections` | **18** | all of them, all on WM-Consulting; every one is at `status='assigned'` with both `assigned_to_id` and `verifier_id` set |
| `field.snags` | **0** | **improvement 2.** All six live snags are seeded demo rows in the `E-Site DEMO` org — identical `created_at`, one demo contractor as raiser, a project whose creator resolves to `contractor`. The snag spine goes live **empty**; the live trigger is unaffected |
| `projects.site_diary_entries` | **0** | **improvement 1.** All 6 of 6 entries a non-empty test would project say "None". The arm is omitted entirely rather than filtered, because nothing historical qualifies and a filter that selects zero rows invites someone to "fix" it |
| `projects.qc_entries` | **0** | `conformance='fail'` on an issued/closed report. **There are no such rows** (F4). All 11 entries on the one issued report carry `conformance='na'` |
| `field.site_forms` | **1** | the single live form, on `(649) PNP FAERIE GLEN` |
| `structure.node_orders` | **0** | **440 rows, deliberately none.** No trigger, no bulk backfill, no automatic path |

**34 work items — as of 2026-09-10.** §12 §(d) estimated "roughly 50"; that estimate assumed 11 QC defects that do not exist, six snags that are demo fixtures and six diary delays that say "None". ⚠ **Re-measure at Step 1 and again at Task 17 (#19):** three days of live use have passed since, and item 2's `createWorkItemTaskAction` can now create `origin='manual'` rows (excluded by every `origin='mirror'` filter, so harmless — but a reader comparing raw `work_items` counts will be confused). `total_live_items` stays a **probe**, never a `sql:` directive in the `@verify` block: the post-push verifier runs on every later deploy and a count that drifts with use would block them all.

⚠ **Three arms will insert zero rows and every assertion about them will pass vacuously.** Steps 6 and 7 build synthetic fixtures for the QC and snag arms so they can actually fail. **Do not** read a zero as "this source does not need mirroring" — twice already a zero has measured a module's *age* (the `field.form_responses` newline count, the `client_viewer` divergence).

**`go_live` is a literal**, `DATE '2026-11-03'` (§03 §1.10), set at merge. The floor for backfilled **open** items is `go_live + 5 office working days = DATE '2026-11-10'` (Wed 4, Thu 5, Fri 6, Mon 9, Tue 10; no SA public holiday falls in that window — check `listHolidays(2026)` again at merge if the date moves). Both are plain literals with the derivation written out; **no `working_days_between` call, because A(h) ships no add-working-days form and inventing one here would be a second calendar**. Closed and void items are **not** floored (improvement 9): moving a July record's deadline into November puts finished work into My Work's date bands.

**The completion event is part of this migration** (A(f) ordinal 9). §12 §(d): *"The first recap after go-live carries only items whose events post-date the backfill timestamp, recorded as `product_events.properties->>'backfill_completed_at'`."* Without it, item 4's 07:00 recap on day one lists all 34 backfilled items — exactly what the suppression GUC exists to avoid. `public.product_events.organisation_id` is `NOT NULL` (§12 §(i)), so one row is written **per organisation touched**, each carrying the same timestamp — which is also more correct, since each org's recap reads its own.

**Files:**
- Modify: the migration — add sections H and I
- Test: `scripts/db/probes/13-backfill.sql`

- [ ] **Step 1: Write the probe first, with the counts from the measurement above.** Create `scripts/db/probes/13-backfill.sql`. Note the `_probe_%` exclusion on every count: this file is concatenated into Task 17's full rehearsal, where other probes' fixtures exist in the same transaction and would otherwise inflate every number.
  ```sql
  -- Counts are over the LIVE estate only. Probe fixtures from other files in the
  -- same transaction are excluded by project name, or the full rehearsal in
  -- Task 17 would fail here for a reason that has nothing to do with the backfill.
  WITH live AS (
    SELECT w.* FROM projects.work_items w
      JOIN projects.projects p ON p.id = w.project_id
     WHERE p.name NOT LIKE '\_probe\_%'
  )
  SELECT 'rfi_count' AS probe, count(*) = 15 AS ok, 'got ' || count(*) || ' of 15' AS detail
    FROM live WHERE item_type = 'rfi' AND origin = 'mirror'
  UNION ALL
  SELECT 'inspection_count', count(*) = 18, 'got ' || count(*) || ' of 18'
    FROM live WHERE item_type = 'inspection' AND origin = 'mirror'
  UNION ALL
  SELECT 'form_count', count(*) = 1, 'got ' || count(*) || ' of 1'
    FROM live WHERE item_type = 'form_action' AND origin = 'mirror'
  UNION ALL
  SELECT 'snag_count_is_zero', count(*) = 0,
         'improvement 2: all 6 live snags are E-Site DEMO fixtures; got ' || count(*)
    FROM live WHERE item_type = 'snag' AND origin = 'mirror'
  UNION ALL
  SELECT 'diary_count_is_zero', count(*) = 0,
         'improvement 1: all 6 of 6 live "delays" say None; got ' || count(*)
    FROM live WHERE item_type = 'diary_action' AND origin = 'mirror'
  UNION ALL
  SELECT 'qc_count_is_zero', count(*) = 0,
         'F4: zero conformance=fail rows exist; this arm is exercised by the synthetic fixture in Step 6'
    FROM live WHERE item_type = 'qc_defect' AND origin = 'mirror'
  UNION ALL
  SELECT 'no_order_followup_anywhere', count(*) = 0,
         '440 node_orders rows, deliberately zero items'
    FROM projects.work_items WHERE item_type = 'order_followup'
  UNION ALL
  SELECT 'total_live_items', count(*) = 34, 'got ' || count(*) || ' of 34 expected'
    FROM live WHERE origin = 'mirror'
  UNION ALL
  SELECT 'nothing_from_the_demo_org', count(*) = 0,
         'improvement 2: no live item may belong to E-Site DEMO'
    FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
   WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001' AND w.origin = 'mirror'
  UNION ALL
  -- Improvement 9.
  SELECT 'writeback_skipped_closed_rfis',
         (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) = 6,
         'before: 15 NULL. after: 6 — exactly the 6 closed RFIs, which must not acquire an assignee'
  UNION ALL
  SELECT 'writeback_filled_open_rfis',
         (SELECT count(*) FROM projects.rfis WHERE status <> 'closed' AND assigned_to IS NULL) = 0,
         'all 9 non-closed RFIs now render an assignee on rfis/[id]/page.tsx:271-272'
  UNION ALL
  SELECT 'snag_assignees_untouched',
         (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) = 6,
         'no snag was backfilled, so no snag acquired an assignee'
  UNION ALL
  SELECT 'due_dates_floored',
         count(*) = 0,
         'no OPEN backfilled item may be due before go_live + 5 office working days (2026-11-10)'
    FROM live
   WHERE origin = 'mirror' AND status IN ('triage','open','answered')
     AND due_date < DATE '2026-11-10'
  UNION ALL
  SELECT 'closed_items_not_refloored',
         count(*) = 0, 'a July record must not acquire a November deadline'
    FROM live
   WHERE origin = 'mirror' AND status IN ('closed','void') AND due_date = DATE '2026-11-10'
  UNION ALL
  SELECT 'every_open_item_has_a_holder',
         count(*) = 0, 'ball_in_court is NOT NULL on every non-terminal item'
    FROM live
   WHERE origin = 'mirror' AND status IN ('triage','open','answered') AND ball_in_court_id IS NULL
  UNION ALL
  SELECT 'events_written_but_no_bells',
         (SELECT count(*) FROM projects.work_item_events) > 0
     AND (SELECT count(*) FROM public.notifications
           WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
         '§12 §(d): events are written for the metrics. The bell half is VACUOUS until item 4 adds the emit + the esite.suppress_notifications guard to §11 (00196:1354-1356); kept so the assertion is already in place'
  UNION ALL
  SELECT 'completion_event_written',
         (SELECT count(*) FROM public.product_events
           WHERE event = 'backfill_completed'
             AND properties->>'migration' = 'work_item_source_mirrors_and_backfill'
             AND properties ? 'backfill_completed_at') >= 1,
         'F11 / §12 §(d): event is the fixed vocabulary''s ''backfill_completed''; without it, item 4''s first 07:00 recap lists all 34 backfilled items'
  UNION ALL
  -- #4: the backfill keeps history; §11 dates `created` at opened_at.
  SELECT 'opened_at_is_historical',
         (SELECT min(opened_at) FROM live WHERE origin = 'mirror') < now() - interval '1 day',
         '#4: every INSERT supplies opened_at = source created_at and the service path keeps it (00196:629-636); min must predate the apply, or metric 5''s denominator gets 34 items in one week'
  UNION ALL
  SELECT 'created_event_dated_at_opened_at',
         NOT EXISTS (SELECT 1 FROM projects.work_item_events e JOIN live w ON w.id = e.work_item_id
                      WHERE w.origin = 'mirror' AND e.event = 'created' AND e.created_at <> w.opened_at),
         '00196:1366-1376: the created event is dated at NEW.opened_at, so a historical opened_at dates the event historically'
  UNION ALL
  -- #10 (optional hand-off from item 2): a departed raiser is seeded by §11 regardless
  -- and becomes a non-member watcher who can read the item through the watcher arm.
  SELECT 'no_non_member_watchers_on_mirrors',
         (SELECT count(*) FROM projects.work_item_watchers ww JOIN live w ON w.id = ww.work_item_id
           WHERE w.origin = 'mirror'
             AND public.user_effective_project_role(w.project_id, ww.user_id) IS NULL) = 0,
         'section H''s last statement removes watchers with no effective role on the project'
  UNION ALL
  -- Improvement 3: the distribution, not just the totals.
  SELECT 'at_least_three_distinct_holders',
         (SELECT count(DISTINCT ball_in_court_id) FROM live
           WHERE origin='mirror' AND ball_in_court_id IS NOT NULL) >= 3,
         'holders: ' || (SELECT string_agg(x.who || '=' || x.n, ', ' ORDER BY x.n DESC) FROM (
             SELECT COALESCE(pr.full_name,'?') AS who, count(*) AS n
               FROM live l LEFT JOIN public.profiles pr ON pr.id = l.ball_in_court_id
              WHERE l.origin='mirror' AND l.ball_in_court_id IS NOT NULL
              GROUP BY 1) x)
  UNION ALL
  SELECT 'no_holder_over_twenty',
         COALESCE((SELECT max(n) FROM (
             SELECT count(*) AS n FROM live
              WHERE origin='mirror' AND ball_in_court_id IS NOT NULL
              GROUP BY ball_in_court_id) y), 0) <= 20,
         '§15: an empty inbox cannot be driven to zero, and neither can a forty-item one'
  UNION ALL
  SELECT 'no_item_on_a_client_viewer',
         (SELECT count(*) FROM live l
           WHERE l.origin='mirror' AND l.ball_in_court_id IS NOT NULL
             AND public.user_effective_project_role(l.project_id, l.ball_in_court_id) = 'client_viewer') = 0,
         'improvement 7: a client viewer cannot clear an item until Q3';
  ```

- [ ] **Step 2: Run it and watch every count fail at 0.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/13-backfill.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `rfi_count`, `inspection_count`, `form_count`, `total_live_items`, `writeback_filled_open_rfis`, `at_least_three_distinct_holders`, `completion_event_written`, `opened_at_is_historical` and `created_event_dated_at_opened_at` all FAIL. `writeback_skipped_closed_rfis` FAILs too — it currently reads 15, not 6. (`no_non_member_watchers_on_mirrors` passes vacuously — zero mirrors, zero watchers — and becomes real at Step 4.)

- [ ] **Step 3: Append sections H and I.**
  ```sql
  -- ─── H. Pre-migration snapshot, then the backfill ────────────────────────────
  -- R52 (A(f)): every migration that overwrites a column takes a snapshot into a
  -- timestamped backup_<version>_<object> table in the same transaction, with the
  -- restore statement named in the header. updated_at is included because the
  -- write-back fires rfis_updated_at (00002:100) and snags_updated_at (00004:33)
  -- on the rows it touches. due_date is included because the floor UPDATE below
  -- reaches projects.rfis.due_date through the write-back on the open RFIs.
  CREATE TABLE IF NOT EXISTS projects.backup_00198_source_assignees AS
    SELECT 'rfi'::text AS kind, id, assigned_to, due_date, updated_at
      FROM projects.rfis
    UNION ALL
    SELECT 'snag', id, assigned_to, NULL::date, updated_at
      FROM field.snags;

  -- 00196:1310 ran ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON
  -- TABLES FROM anon, so this table is NOT born anon-readable (the 00025:26
  -- default no longer applies in this schema). Revoked explicitly anyway: it
  -- holds the assignee of every RFI and snag on the platform, and the revoke is
  -- true whichever default a later migration re-establishes.
  REVOKE SELECT ON projects.backup_00198_source_assignees FROM anon;
  ALTER TABLE projects.backup_00198_source_assignees ENABLE ROW LEVEL SECURITY;
  -- No policy, deliberately: RLS with no policy is deny-all for every role except
  -- the table owner and service_role. Nothing in the app reads this table.

  -- ⚠ Notification suppression — forward-looking, and vacuous today. Item 2's
  -- §11 writes NO bell and reads NO GUC ("Nothing here writes a bell",
  -- 00196:1354-1356); item 4 adds the emit and the
  -- current_setting('esite.suppress_notifications', true) guard to that same
  -- function by CREATE OR REPLACE. This SET LOCAL is the exact GUC item 4 will
  -- honour, so it is set here on principle: against an estate where 964
  -- notifications have produced 57 reads, ~34 assignment bells plus overdue
  -- bells plus a 07:00 recap listing 34 stale items is the failure this
  -- programme exists to reverse, and a backfill that runs after item 4 lands
  -- (a re-run, a restore) must already carry it. work_item_events rows are
  -- STILL written — the metrics need them.
  SET LOCAL esite.suppress_notifications = 'on';

  DO $backfill$
  DECLARE
    v_go_live  CONSTANT date := DATE '2026-11-03';   -- Tuesday; set at merge (Task 20 Step 4)
    v_floor    CONSTANT date := DATE '2026-11-10';   -- go_live + 5 office working days
    v_demo     CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';  -- E-Site DEMO
    v_n int;
  BEGIN
    -- ⚠ Lock order (#18, item 2 hand-off). §6's ref allocator takes a
    --    per-(project, type) advisory lock held to COMMIT (00196:752-803). One
    --    statement per type (below) plus ORDER BY p.id inside each gives every
    --    session the same acquisition order; a concurrent client insert during
    --    the apply could otherwise deadlock (40P01 — aborted cleanly, retry-safe,
    --    but it would abort db push).

    -- 1. RFIs — all 15. Projected DIRECTLY through projects.project_rfi(), never by
    --    touching the source row: every source table carries a BEFORE UPDATE
    --    set_updated_at trigger, and with the F7 WHEN predicates in place a no-op
    --    UPDATE would fire nothing anyway. Historical stamps travel with the
    --    projection (#4): opened_at = rfis.created_at, closed_at/closed_by for the
    --    6 closed ones — kept because this runs on the service path.
    PERFORM projects.project_rfi(r.id)
       FROM projects.rfis r
       JOIN projects.projects p ON p.id = r.project_id
      WHERE p.organisation_id <> v_demo
      ORDER BY p.id, r.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % rfis (15 expected on 2026-09-10 data)', v_n;

    -- 2. Inspections — all 18. No profiles guard here: projects.project_inspection()
    --    already handles an auth user with no profiles row via
    --    work_item_person_eligible, and a second WHERE EXISTS would SKIP a row the
    --    projection would have handled correctly, turning a data question into a
    --    count mismatch. Measured: 0 such rows exist today.
    PERFORM projects.project_inspection(i.id)
       FROM inspections.inspections i
       JOIN projects.projects p ON p.id = i.project_id
      WHERE p.organisation_id <> v_demo
      ORDER BY p.id, i.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % inspections (18 expected on 2026-09-10 data)', v_n;

    -- 3. Snags — improvement 2. All six live rows are seeded E-Site DEMO fixtures
    --    (identical created_at, one demo contractor as raiser, a project whose
    --    creator resolves to contractor and would therefore be his own gatekeeper).
    --    Backfilling them manufactures defects no real person owes and pollutes
    --    metric 2a's contractor numerator with a fixture account. The snag spine
    --    goes live EMPTY; the live trigger is unaffected. The predicate is written
    --    out rather than the arm deleted, so the intent survives the demo data.
    PERFORM projects.project_snag(s.id)
       FROM field.snags s
       JOIN projects.projects p ON p.id = s.project_id
      WHERE p.organisation_id <> v_demo AND p.status = 'active'
      ORDER BY p.id, s.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % snags (0 expected — all 6 live rows are demo)', v_n;

    -- 4. QC defects — failed entries on issued/closed reports only.
    --    Expected to project ZERO rows today: all 11 live entries are
    --    conformance='na' (F4). That is not a reason to widen the predicate.
    PERFORM projects.project_qc_entry(e.id)
       FROM projects.qc_entries e
       JOIN projects.qc_reports r ON r.id = e.report_id
       JOIN projects.projects p ON p.id = e.project_id
      WHERE e.conformance = 'fail' AND r.status IN ('issued','closed')
        AND p.organisation_id <> v_demo
      ORDER BY p.id, e.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % qc defects (0 expected on 2026-09-10 data)', v_n;

    -- 5. Diary — NO ARM. Improvement 1. All 6 of 6 entries a non-empty test would
    --    have projected are negations ("None," ×2, "None" ×2, "NO", and "No delays
    --    or info required was noted in the site walk and or meeting"). Zero of the
    --    six is a delay, so there is nothing historical to project. Entries written
    --    from go-live onward are projected by the live trigger, which carries the
    --    same stop-list. A filtered arm that selects zero rows is omitted rather
    --    than written, because a zero-row filter invites someone to "fix" it.

    -- 6. Site forms — the single live row.
    PERFORM projects.project_form_action(f.id)
       FROM field.site_forms f
       JOIN projects.projects p ON p.id = f.project_id
      WHERE p.organisation_id <> v_demo
      ORDER BY p.id, f.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % site forms (1 expected on 2026-09-10 data)', v_n;

    -- 7. structure.node_orders: NOTHING. 440 rows, no trigger, no backfill.
    --    A(b): order_followup is created only by the explicit chase control on an
    --    order line. Projecting 440 procurement rows into an inbox that is read
    --    6% of the time is the fastest way to prove the new inbox is also noise.

    -- 8. Floor every backfilled OPEN due date. An item months overdue on day one is
    --    a red inbox nobody opens (§03 §1.10). Closed and void items are NOT
    --    floored (improvement 9): giving a July record a November deadline sorts
    --    finished work into My Work's date bands.
    --    This UPDATE runs on the service path (auth.uid() NULL under db push), so
    --    the guard's clause (a4) does not apply; it reaches projects.rfis.due_date
    --    on the open RFIs through the write-back (and bumps their updated_at —
    --    the snapshot's due_date/updated_at columns are the restore).
    UPDATE projects.work_items
       SET due_date = v_floor
     WHERE origin = 'mirror'
       AND status IN ('triage','open','answered')
       AND due_date < v_floor;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: floored % open due dates to %', v_n, v_floor;

    -- 9. Departed watchers (#10, item 2 hand-off). §11 seeds created_by as a
    --    watcher on every INSERT regardless of membership, so a raiser who has
    --    since left the project becomes a non-member watcher who can read the
    --    item through the SELECT policy's watcher arm. Backfill-only: the live
    --    path's raiser is, by construction, a current member.
    DELETE FROM projects.work_item_watchers w
     USING projects.work_items wi
     WHERE wi.id = w.work_item_id AND wi.origin = 'mirror'
       AND public.user_effective_project_role(wi.project_id, w.user_id) IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: removed % non-member watchers', v_n;
  END $backfill$;

  -- ─── I. The completion event ─────────────────────────────────────────────────
  -- A(f) ordinal 9, and §12 §(d): "The first recap after go-live carries only
  -- items whose events post-date the backfill timestamp, recorded as
  -- product_events.properties->>'backfill_completed_at'". Without this row, item
  -- 4's 07:00 recap on day one lists all 34 backfilled items — the exact failure
  -- the suppression GUC above exists to avoid.
  -- F11: `event` is a fixed CHECK vocabulary (00194:231-238) and
  -- 'backfill_completed' is its arm for this; properties.migration says WHICH
  -- backfill. Direct INSERT, not emit_product_event() — that raises on an
  -- absent project, and these are org-level rows (project_id nullable).
  -- public.product_events.organisation_id is NOT NULL (§12 §(i)), so one row is
  -- written per organisation touched, each carrying the same timestamp. That is
  -- also the more correct shape: each org's recap reads its own row.
  INSERT INTO public.product_events (organisation_id, project_id, actor_id, event, properties)
  SELECT o.organisation_id, NULL, NULL, 'backfill_completed',
         jsonb_build_object(
           'backfill_completed_at', now(),
           'items', o.n,
           'migration', 'work_item_source_mirrors_and_backfill')
    FROM (SELECT p.organisation_id, count(*) AS n
            FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
           WHERE w.origin = 'mirror'
           GROUP BY p.organisation_id) o;

  -- Post-conditions, asserted in the same transaction that made them.
  DO $postcheck$
  DECLARE v_total int; v_orders int; v_stranded int;
  BEGIN
    SELECT count(*) INTO v_total FROM projects.work_items WHERE origin = 'mirror';
    IF v_total = 0 THEN
      RAISE EXCEPTION 'the backfill projected nothing at all';
    END IF;

    SELECT count(*) INTO v_orders FROM projects.work_items WHERE item_type = 'order_followup';
    IF v_orders > 0 THEN
      RAISE EXCEPTION 'order_followup items exist (%) — A(b) forbids an automatic path', v_orders;
    END IF;

    SELECT count(*) INTO v_stranded
      FROM projects.work_items w
     WHERE w.origin = 'mirror' AND w.status IN ('triage','open','answered')
       AND public.user_effective_project_role(w.project_id, w.ball_in_court_id) = 'client_viewer';
    IF v_stranded > 0 THEN
      RAISE EXCEPTION '% items land on a client viewer, who cannot clear them until Q3', v_stranded;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.product_events
                    WHERE event = 'backfill_completed'
                      AND properties->>'migration' = 'work_item_source_mirrors_and_backfill') THEN
      RAISE EXCEPTION 'no backfill-completion event was written (§12 §(d))';
    END IF;
  END $postcheck$;
  ```

- [ ] **Step 4: Run the probe and watch 23/23 pass.** Read the `assertions seen:` line and count the names — twenty-three. **If `total_live_items` differs from 34, re-measure every count in the table above against today's estate (#19) and update the probe and the PR body before Task 17** — three days of live use have passed since 2026-09-10; a drift that traces to a real new RFI or inspection is expected, a drift that does not is a bug.

- [ ] **Step 5: Confirm Task 13's two deferred assertions now pass, and prove the revoke bites the way this schema allows (#20).**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/12-grants.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `8/8`, with `snapshot_table_not_anon_readable` and `snapshot_table_has_rls` both PASS. ⚠ Deleting the `REVOKE SELECT … FROM anon` line does **not** turn the assertion red in this schema — `00196:1310` already stopped new `projects` tables being born anon-readable, so there is nothing for the revoke to remove — which is why the 2026-09-10 mutation could never fail. Instead, insert `GRANT SELECT ON projects.backup_00198_source_assignees TO anon;` immediately **before** the `REVOKE` and confirm `8/8` still (the revoke removed the grant); then move the `GRANT` to immediately **after** the `REVOKE` and confirm `FAIL snapshot_table_not_anon_readable`. Remove the `GRANT`. Record both readings.

- [ ] **Step 6: Make the QC arm non-vacuous with a synthetic fixture (F4).** Prepend to `13-backfill.sql`, before the assertion `SELECT`:
  ```sql
  -- Synthetic QC fixture. Live data has zero conformance='fail' rows, so without
  -- this the qc_defect arm passes vacuously — "what would this fixture have to
  -- look like for the test to be able to fail?"
  DO $qcfix$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rep uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_qc_backfill', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;
    INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by, issued_at)
    VALUES (v_proj, v_org, 'Synthetic issued report', 'issued', v_pm, now()) RETURNING id INTO v_rep;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, severity, created_by)
    SELECT v_rep, v_org, v_proj, 'Defect ' || g, 'fail',
           (ARRAY['minor','major','critical'])[1 + (g % 3)], v_pm
      FROM generate_series(1, 3) g;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, created_by)
    SELECT v_rep, v_org, v_proj, 'Passing check ' || g, 'pass', v_pm
      FROM generate_series(1, 40) g;
  END $qcfix$;
  ```
  and add these arms to the assertion `SELECT` (they read `projects.work_items` directly, not `live`, because the fixture project IS a `_probe_%` project):
  ```sql
  UNION ALL
  SELECT 'qc_fixture_projects_three',
         (SELECT count(*) FROM projects.work_items w JOIN projects.qc_entries e ON e.id = w.qc_entry_id
           WHERE e.conformance = 'fail') = 3,
         'three failures out of a 43-line report'
  UNION ALL
  SELECT 'qc_fixture_ignores_forty',
         (SELECT count(*) FROM projects.work_items w JOIN projects.qc_entries e ON e.id = w.qc_entry_id
           WHERE e.conformance = 'pass') = 0,
         'A(b): mirroring every issued entry would manufacture ~40 items from one report'
  UNION ALL
  SELECT 'qc_fixture_priority_spread',
         (SELECT count(DISTINCT w.priority) FROM projects.work_items w
            JOIN projects.qc_entries e ON e.id = w.qc_entry_id WHERE e.conformance = 'fail') = 3,
         'severity maps to three distinct priorities, never a flat medium'
  ```
  Run and watch 26/26. Then set every fixture entry's `severity` to NULL and re-run: `FAIL qc_fixture_priority_spread`. Restore.

- [ ] **Step 7: Make the snag arm non-vacuous.** Add a second fixture that creates a snag on a **non-demo** project, so the arm's `organisation_id <> v_demo` predicate is proved to *include* as well as exclude:
  ```sql
  DO $snagfix$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_snag_backfill', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;
    INSERT INTO field.snags (project_id, organisation_id, title, location, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Real-org snag', 'Level 1', 'medium', 'open', v_pm);
  END $snagfix$;
  ```
  and the assertion:
  ```sql
  UNION ALL
  SELECT 'snag_arm_includes_non_demo_orgs',
         (SELECT count(*) FROM projects.work_items w
            JOIN projects.projects p ON p.id = w.project_id
           WHERE p.name = '_probe_snag_backfill' AND w.item_type = 'snag') = 1,
         'the demo exclusion must exclude the demo org, not disable the snag arm'
  ```
  Run and watch 27/27. Then change the arm's predicate to `WHERE false` and re-run: `FAIL snag_arm_includes_non_demo_orgs`. Restore. **This is the assertion that stops improvement 2 being read as "snags are not mirrored".**

- [ ] **Step 8: Mutation-verify the demo exclusion itself.** Delete `AND p.organisation_id <> v_demo` from the snag arm and re-run. Expected:
  ```
  FAIL  snag_count_is_zero          improvement 2: all 6 live snags are E-Site DEMO fixtures; got 6
  FAIL  total_live_items            got 40 of 34 expected
  FAIL  nothing_from_the_demo_org   improvement 2: no live item may belong to E-Site DEMO
  ```
  Restore. Record 27/27 → 24/27 → 27/27.

- [ ] **Step 8b: Mutation-verify the historical dating (#4) and the departed-watcher sweep (#10).** In `project_rfi` and `project_inspection`, temporarily replace `r.created_at` / `i.created_at` in the INSERT's `opened_at` slot with `now()`. Re-run: `FAIL opened_at_is_historical` and `FAIL created_event_dated_at_opened_at` (the `created` event now sits in the apply week — the exact failure §11 was built to avoid). Restore. Then delete section H's watcher `DELETE` and, in the `DO` block of probe 13, add a fixture that makes one live mirrored item's raiser a non-member (e.g. `UPDATE projects.project_members SET is_active = false WHERE user_id = <a raiser with only a project_members row on that project>` — pick one from the day-one list; if none exists, note that the sweep is vacuous on today's estate and keep the assertion). Re-run: `FAIL no_non_member_watchers_on_mirrors`. Restore both.

- [ ] **Step 9: Mutation-verify the completion event.** Delete section I's `INSERT INTO public.product_events …`. Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: no backfill-completion event was written (§12 §(d))
  ```
  — the in-migration post-check catches it before the probe does, which is the right order. Restore. Then change `'backfill_completed'` to `'work_item_backfill_completed'` (the 2026-09-10 text) and re-run: `FAIL (HTTP 400) … ERROR: 23514: new row for relation "product_events" violates check constraint "product_events_event_check"` — F11, on demand. Restore.

- [ ] **Step 10: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/13-backfill.sql
  git commit -m "feat(work-items): backfill 34 items with historical stamps, then record backfill_completed

15 RFIs, 18 inspections, 1 site form (2026-09-10 counts; re-measured at apply).
Zero snags (all six live rows are E-Site DEMO fixtures), zero diary actions
(all six live 'delays' say None), zero QC defects (no conformance='fail' row
exists) and none of the 440 node_orders. Projection runs through
projects.project_<source>() so no source row is touched and no live updated_at
is rewritten; every item keeps its source's opened_at/closed_at so 34 created
events do not land in the apply week. The completion row is
event='backfill_completed' — product_events.event is a fixed vocabulary."
  ```

---

## Task 15 — Idempotency, and the 50,000-row rehearsal

"A backfill that passes on 50 rows proves nothing about 50,000" (§12 §(d)). Two properties: re-running creates no duplicates, and the projection does not degrade into a per-row round trip at scale.

⚠ **Timing caveat (#18).** Item 2's `ref` allocator (`00196:752–803`) takes a per-(project, type) advisory lock and computes `MAX(suffix)+1` **per row**; 50,000 rows in one statement on one project is an O(n²) suffix scan. Expect `completed_under_five_minutes` to go **red** on the 50k run; `refs_are_unique` must still hold (the lock serialises). The plan already routes a failure here to item 2 (Step 6) — do not "fix" the allocator from this PR. For a timing figure worth quoting, run the probe once more with `generate_series(1, 5000)` and record both readings; keep 50k for the uniqueness proof if the window allows.

⚠ **`projects.rfis.rfi_number` is `INTEGER GENERATED ALWAYS AS IDENTITY` (`00002:83`) and sequences are NOT transactional.** Rolling back does **not** return consumed values. A 50,000-row fixture therefore permanently advances production's RFI numbering by 50,000, and the next RFI a human raises displays a number around 50,016 — on the identifier §03 §1.2 rules "stays displayed alongside as the module's own identifier". Step 4 captures `last_value` before and restores it after, in separate committed statements, and records both readings in the PR body.

**Files:**
- Test: `scripts/db/probes/14-idempotency.sql`, `scripts/db/probes/15-scale.sql`

- [ ] **Step 1: Write the idempotency probe.** It applies the migration via `--with` (so section H has already run once), then re-runs every projection path twice more. Create `scripts/db/probes/14-idempotency.sql`:
  ```sql
  DO $rerun$
  DECLARE
    v_demo CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';
    v_split uuid;
  BEGIN
    CREATE TEMP TABLE idem_before ON COMMIT DROP AS
      SELECT item_type, count(*) AS n FROM projects.work_items
       WHERE origin = 'mirror' GROUP BY 1;

    FOR i IN 1..2 LOOP
      PERFORM projects.project_rfi(r.id) FROM projects.rfis r
         JOIN projects.projects p ON p.id = r.project_id WHERE p.organisation_id <> v_demo;
      PERFORM projects.project_inspection(i2.id) FROM inspections.inspections i2
         JOIN projects.projects p ON p.id = i2.project_id WHERE p.organisation_id <> v_demo;
      PERFORM projects.project_snag(s.id) FROM field.snags s
         JOIN projects.projects p ON p.id = s.project_id
        WHERE p.organisation_id <> v_demo AND p.status = 'active';
      PERFORM projects.project_qc_entry(e.id) FROM projects.qc_entries e
         JOIN projects.qc_reports rp ON rp.id = e.report_id
        WHERE e.conformance = 'fail' AND rp.status IN ('issued','closed');
      PERFORM projects.project_form_action(f.id) FROM field.site_forms f
         JOIN projects.projects p ON p.id = f.project_id WHERE p.organisation_id <> v_demo;
    END LOOP;

    -- A deliberate split must survive a re-run untouched (§03 §1.2, §1.3): the
    -- partial UNIQUE excludes origin <> 'mirror'.
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
      status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
    SELECT w.organisation_id, w.project_id, 'rfi', 'split', w.title || ' (split)', 'open',
           w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, w.rfi_id
      FROM projects.work_items w WHERE w.item_type = 'rfi' AND w.origin = 'mirror' LIMIT 1
    RETURNING id INTO v_split;

    -- And a third projection AFTER the split exists, to prove the split is not
    -- picked up, overwritten or duplicated by it.
    PERFORM projects.project_rfi(r.id) FROM projects.rfis r
       JOIN projects.projects p ON p.id = r.project_id WHERE p.organisation_id <> v_demo;

    CREATE TEMP TABLE idem_ctx(split uuid) ON COMMIT DROP;
    INSERT INTO idem_ctx VALUES (v_split);
  END $rerun$;

  SELECT 'no_duplicates_after_three_runs' AS probe,
         NOT EXISTS (
           SELECT 1 FROM projects.work_items w
            JOIN idem_before b ON b.item_type = w.item_type
            WHERE w.origin = 'mirror'
            GROUP BY w.item_type, b.n HAVING count(*) <> b.n) AS ok,
         'the partial UNIQUE per source column is what makes projection idempotent' AS detail
  UNION ALL
  SELECT 'one_item_per_source_row',
         NOT EXISTS (
           SELECT 1 FROM projects.work_items WHERE origin = 'mirror'
            GROUP BY COALESCE(rfi_id, snag_id, qc_entry_id, inspection_id, diary_id, site_form_id)
           HAVING count(*) > 1),
         'no source row may carry two mirror items'
  UNION ALL
  SELECT 'split_row_survives',
         (SELECT count(*) FROM projects.work_items w, idem_ctx c
           WHERE w.id = c.split AND w.origin = 'split') = 1,
         'the partial index excludes origin<>mirror, so a split is legal and never re-projected'
  UNION ALL
  SELECT 'split_title_untouched',
         (SELECT w.title LIKE '% (split)' FROM projects.work_items w, idem_ctx c WHERE w.id = c.split),
         'a re-projection must not overwrite a split row''s own title';
  ```

- [ ] **Step 2: Run it and watch 4/4.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/14-idempotency.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```

- [ ] **Step 3: Prove idempotency can fail, and confirm the REAL index names.** Item 2 named them (`00196:371–377`): `work_items_src_rfi_uidx`, `work_items_src_snag_uidx`, `work_items_src_qc_uidx`, `work_items_src_diary_uidx`, `work_items_src_form_uidx`, `work_items_src_order_uidx`, `work_items_src_inspection_uidx` — write those seven into the PR body directly. This query only confirms production agrees with the file:
  ```bash
  cat > /tmp/idxname.sql <<'SQL'
  SELECT 'src_partial_uniques' AS probe, count(*) = 7 AS ok,
         COALESCE(string_agg(indexname, ', ' ORDER BY indexname), 'none') AS detail
    FROM pg_indexes
   WHERE schemaname = 'projects' AND tablename = 'work_items'
     AND indexname LIKE 'work\_items\_src\_%\_uidx' AND indexdef ILIKE '%mirror%';
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/idxname.sql
  ```
  Expected: `PASS  src_partial_uniques  work_items_src_diary_uidx, work_items_src_form_uidx, work_items_src_inspection_uidx, work_items_src_order_uidx, work_items_src_qc_uidx, work_items_src_rfi_uidx, work_items_src_snag_uidx`. Then delete the whole `ON CONFLICT (rfi_id) WHERE …` clause from `project_rfi` and re-run the idempotency probe. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23505: duplicate key value violates unique constraint "work_items_src_rfi_uidx"
  ```
  This is the *good* failure — the index is the guarantee and `ON CONFLICT` only makes a retry quiet. Restore.

- [ ] **Step 4: Write the scale rehearsal, with the sequence restore.** Create `scripts/db/probes/15-scale.sql`:
  ```sql
  -- 50,000 synthetic RFIs on one throwaway project, projected through the real
  -- trigger. Times the projection and asserts the shape holds.
  --
  -- ⚠ projects.rfis.rfi_number is GENERATED ALWAYS AS IDENTITY (00002:83) and a
  -- ROLLBACK does NOT return consumed sequence values. Task 15 Step 5 reads
  -- last_value before this runs and setval()s it back afterwards, OUTSIDE the
  -- rolled-back transaction. Do not run this probe without those two steps.
  DO $scale$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_t0 timestamptz; v_ms numeric;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_scale', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    v_t0 := clock_timestamp();
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    SELECT v_proj, v_org, 'Scale RFI ' || g, 'body', 'medium', 'open', v_pm
      FROM generate_series(1, 50000) g;
    v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;

    CREATE TEMP TABLE scale_ctx(proj uuid, ms numeric) ON COMMIT DROP;
    INSERT INTO scale_ctx VALUES (v_proj, v_ms);
  END $scale$;

  SELECT 'fifty_thousand_projected' AS probe,
         (SELECT count(*) FROM projects.work_items w, scale_ctx c
           WHERE w.project_id = c.proj AND w.origin = 'mirror') = 50000 AS ok,
         'one item per RFI at scale' AS detail
  UNION ALL
  SELECT 'refs_are_unique',
         (SELECT count(DISTINCT ref) FROM projects.work_items w, scale_ctx c
           WHERE w.project_id = c.proj) = 50000,
         'the MAX+1 ref allocator must not collide under a 50k single-statement insert'
  UNION ALL
  SELECT 'writeback_reached_every_row',
         (SELECT count(*) FROM projects.rfis r, scale_ctx c
           WHERE r.project_id = c.proj AND r.assigned_to IS NULL) = 0,
         'the write-back is per-row; if it degrades, it degrades here'
  UNION ALL
  SELECT 'completed_under_five_minutes',
         (SELECT ms FROM scale_ctx) < 300000,
         'took ' || (SELECT round(ms) FROM scale_ctx) || ' ms';
  ```

- [ ] **Step 5: Capture the sequence, run the scale probe, restore the sequence.** Three commands, in this order, and **do not skip the third**:
  ```bash
  # 1. BEFORE — record this number in the PR body.
  cat > /tmp/seq-before.sql <<'SQL'
  SELECT 'rfi_seq' AS probe, true AS ok, last_value::text AS detail
    FROM projects.rfis_rfi_number_seq;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/seq-before.sql     # e.g. detail = 16

  # 2. The scale run. Holds locks on projects.rfis and projects.work_items for its
  #    duration — run it outside working hours.
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/15-scale.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql

  # 3. AFTER + restore. setval is a committed write; the harness refuses COMMIT, so
  #    this one goes through the Management API directly.
  cat > /tmp/seq-restore.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT
  const before = process.argv[2]            // the number from step 1
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  console.log('after  :', await q('SELECT last_value FROM projects.rfis_rfi_number_seq'))
  console.log('setval :', await q(`SELECT setval('projects.rfis_rfi_number_seq', ${before}, true)`))
  console.log('final  :', await q('SELECT last_value FROM projects.rfis_rfi_number_seq'))
  JS
  node /tmp/seq-restore.mjs 16
  ```
  Expected: `after` ≈ 50016, `final` = the number from step 1. **Put all three readings in the PR body.** If `final` does not match, the next RFI a human raises will display a five-digit number.

- [ ] **Step 6: Read `refs_are_unique` first and act on what it says.** Item 2's `ref` allocator reads `MAX(...) + 1` under a per-(project,type) advisory lock: `refs_are_unique` should hold (the lock serialises) and `completed_under_five_minutes` is the one expected to go red at 50k (#18). **If `refs_are_unique` fails, that is item 2's defect, not this plan's — report it against item 2 and stop, rather than working around it in the mirror.** Record the measured timing (50k and 5k) and `refs_are_unique`'s result explicitly whichever way it went.

- [ ] **Step 6b: Retarget the four item-2 fixtures that will collide with the backfill (#14), and run item 2's suite with `00198` stacked.** `scripts/db/assertions/work-item-ddl.sql:119,123`, `work-item-events.sql:111` and `work-item-transition.sql:155,183` insert `origin='mirror'` rows against **live** `projects.rfis` ids. After section H, every non-demo RFI already carries a mirror and `work_items_src_rfi_uidx` allows one — the four files go red with `23505` on the day item 3 lands. First reproduce that:
  ```bash
  for f in scripts/db/assertions/work-item-{ddl,events,transition}.sql; do
    WITH_EXTRA=apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
      scripts/db/try-work-item-spine.sh "$f" || true
  done
  ```
  Expected: `✗ … transaction aborted: … 23505 … "work_items_src_rfi_uidx"` for all three. **Record it.** Then, in each fixture, replace the live-id lookup (`SELECT id FROM projects.rfis … LIMIT 1` or equivalent) with a throwaway RFI the fixture creates itself on its own throwaway project, followed immediately by
  ```sql
  -- 00198's live trigger mirrors this RFI on insert; the fixture owns the mirror it
  -- asserts on, so it removes the trigger-made row first (0 rows before 00198
  -- applies, 1 after — correct in every window).
  DELETE FROM projects.work_items WHERE rfi_id = v_rfi AND origin = 'mirror';
  ```
  so the fixture's own `INSERT … origin='mirror'` (and the second one that must fail `23505`) keep their meaning. Do not weaken the uniqueness assertions and do not switch to a demo-org RFI (the demo org may hold none). Re-run **all ten** files stacked:
  ```bash
  for f in scripts/db/assertions/work-item-*.sql; do
    WITH_EXTRA=apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
      scripts/db/try-work-item-spine.sh "$f"
  done
  ```
  Expected: `✓` for all ten. Then run them **unstacked** (`scripts/db/try-work-item-spine.sh "$f"` with no `WITH_EXTRA`) and confirm all ten still pass — the retargeted fixtures must be correct both before and after `00198` applies, because item 2's suite is also the post-apply regression check (Task 20 Step 8).

- [ ] **Step 7: Commit.**
  ```bash
  git add scripts/db/probes/14-idempotency.sql scripts/db/probes/15-scale.sql \
          scripts/db/assertions/work-item-ddl.sql scripts/db/assertions/work-item-events.sql \
          scripts/db/assertions/work-item-transition.sql
  git commit -m "test(work-items): idempotency across three projection runs, a 50k-row scale rehearsal, item-2 fixtures retargeted

The scale probe consumes 50,000 identity values that a rollback does not return,
so the runbook captures and restores projects.rfis_rfi_number_seq around it.
Four item-2 fixtures inserted origin='mirror' rows against live RFI ids; after
the backfill every non-demo RFI carries a mirror and work_items_src_rfi_uidx
allows one, so they now create their own RFI and own its mirror. Item 2's ten
assertion files pass with 00198 stacked and unstacked."
  ```

---

## Task 16 — The one probe that runs as a real user (F9)

**Every other probe in this plan is authorisation-blind.** Measured on production 2026-09-10:

```
current_user = postgres   rolbypassrls = true   auth.uid() = <null>
```

The Management API `/database/query` endpoint runs with RLS bypassed and no identity. So no probe above — **except 05b (Task 5½), which impersonates for the guard** — can fail on an authorisation defect, including the single most important one the whole design turns on: **the mirror is `SECURITY DEFINER` so that a contractor's legitimate RFI insert is not rejected by item 2's RESTRICTIVE INSERT policy on `work_items`** (§03 §1.2, quoted in section D). Apply the fixture-quality rule and it is stark: *remove `SECURITY DEFINER` from every function in this migration and every probe other than 05b still passes.*

This task adds the probe that can see the difference, using the house pattern from PRs #157 and #162 and item 2's assertion files: inside the rolled-back transaction, become `authenticated` with a real JWT claim, act, then return to `postgres` **and clear the claim** (Task 1 rule 3) before asserting.

The identity is the permanent production fixture `rbac-test@e-site.live` (`018f2d31-bbe8-4cc1-bbdd-63af0187081e`, `contractor` on WM-Consulting — verified 2026-09-10). It is not a real user; **never invite it, email it, or send it a notification.**

**Files:**
- Test: `scripts/db/probes/16-as-a-real-user.sql`

- [ ] **Step 1: Write the probe.** Create `scripts/db/probes/16-as-a-real-user.sql`:
  ```sql
  DO $setup$
  DECLARE
    v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
    v_pm   uuid;
    v_proj uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_rls_identity', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- Give the contractor real access to this project, the way a PM would.
    INSERT INTO projects.project_members (project_id, user_id, role, is_active)
    VALUES (v_proj, v_ctr, 'contractor', true);

    CREATE TEMP TABLE rls_ctx(proj uuid, ctr uuid, rfi uuid) ON COMMIT DROP;
    INSERT INTO rls_ctx VALUES (v_proj, v_ctr, NULL);
  END $setup$;

  DO $asuser$
  DECLARE
    v_proj uuid; v_ctr uuid; v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_rfi uuid;
  BEGIN
    SELECT proj, ctr INTO v_proj, v_ctr FROM rls_ctx;

    -- Become a real, non-privileged user. postgres holds rolbypassrls, so without
    -- these two lines every RLS policy in the database is inert for this probe.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_ctr::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- The ordinary act: a contractor raises an RFI on a project they belong to.
    -- The mirror then INSERTs into projects.work_items, which item 2 gates with a
    -- RESTRICTIVE INSERT policy that refuses every mirrored type. It only works
    -- because the mirror is SECURITY DEFINER.
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'RFI raised as a contractor', 'body', 'medium', 'open', v_ctr)
    RETURNING id INTO v_rfi;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);

    UPDATE rls_ctx SET rfi = v_rfi;
  END $asuser$;

  SELECT 'contractor_insert_succeeded' AS probe,
         (SELECT rfi IS NOT NULL FROM rls_ctx) AS ok,
         'F9: as authenticated, not postgres — the whole point of SECURITY DEFINER on the mirror' AS detail
  UNION ALL
  SELECT 'item_was_projected',
         (SELECT count(*) FROM projects.work_items w, rls_ctx c
           WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 1,
         'the projection ran under the contractor''s identity and still wrote work_items'
  UNION ALL
  SELECT 'holder_is_not_the_contractor',
         (SELECT w.assignee_id <> c.ctr FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi),
         'the resolved holder is a value the contractor could not have written themselves'
  UNION ALL
  SELECT 'gatekeeper_is_the_contractor',
         (SELECT w.gatekeeper_id = c.ctr FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi),
         'improvement 4: the raiser is the gatekeeper, and here the raiser is a contractor'
  UNION ALL
  SELECT 'writeback_reached_the_source',
         (SELECT r.assigned_to IS NOT NULL FROM projects.rfis r, rls_ctx c WHERE r.id = c.rfi),
         'the write-back is SECURITY DEFINER too and bypasses the RLS on projects.rfis'
  UNION ALL
  SELECT 'ran_as_postgres_when_asserting',
         current_user = 'postgres' AND auth.uid() IS NULL,
         'RESET ROLE actually took, so the assertions above are not themselves role-scoped';
  ```

- [ ] **Step 2: Run it and watch 6/6 pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/16-as-a-real-user.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```

- [ ] **Step 3: Mutation-verify F9 — this is the acceptance step, and it is the only place `SECURITY DEFINER` is actually tested.** Remove `SECURITY DEFINER` from `projects.project_rfi` (making it `SECURITY INVOKER`, the default). Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 42501: new row violates row-level security policy for table "work_items"
  ```
  — the contractor's perfectly legitimate RFI insert is refused. **Now re-run every other probe (04, 05, 06, 07) with that same mutation in place and confirm they all still pass 100%.** That contrast is the finding: without this task, `SECURITY DEFINER` is untested. Record both halves in the PR body. Restore.

- [ ] **Step 4: Mutation-verify the identity switch itself.** Comment out the `EXECUTE 'SET LOCAL ROLE authenticated'` line and re-run: `ran_as_postgres_when_asserting` still passes and everything else still passes — because the probe silently degraded to running as `postgres` again. **That is the failure mode this task exists to expose**, so add the guard that makes it visible: move `SELECT current_user` into the `$asuser$` block and record it, then assert it:
  ```sql
  UNION ALL
  SELECT 'insert_really_ran_as_authenticated',
         (SELECT who = 'authenticated' FROM rls_ctx),
         'without this, a probe that silently fell back to postgres looks identical to one that worked'
  ```
  (add a `who text` column to `rls_ctx` and set it from `current_user` inside `$asuser$`, immediately after `SET LOCAL ROLE`). Re-run: 7/7. Comment out the `SET LOCAL ROLE` again: `FAIL insert_really_ran_as_authenticated`. Restore.

- [ ] **Step 5: Commit.**
  ```bash
  git add scripts/db/probes/16-as-a-real-user.sql
  git commit -m "test(work-items): one probe that runs as a real contractor, not as postgres

The Management API runs as postgres with rolbypassrls=true and auth.uid() NULL,
so every other probe is authorisation-blind: removing SECURITY DEFINER from the
mirrors leaves them all green. This one fails with 42501."
  ```

---

## Task 17 — The rolled-back production rehearsal of the whole migration, and the day-one list

Everything above rehearsed one section. This runs the migration end to end against real production data, reads back the resulting counts **and the resulting distribution**, publishes the 34 items as a list a human can read, and rolls back — before a number is claimed, before anything merges.

⚠ **The Management API returns rows from the LAST row-producing statement only** (measured: `SELECT 1 AS a; SELECT 2 AS b;` → `[{"b":2}]`). So the full rehearsal is **not** a concatenation of ten probe files: that would discard nine of them silently and report the tenth's count as the total — the one test in the plan structurally incapable of failing. It is assembled as **all fixture `DO` blocks first, then ONE assertion `SELECT`.**

**Files:**
- Test: `scripts/db/probes/17-full-rehearsal.sql`, `scripts/db/probes/18-day-one-list.sql`

- [ ] **Step 1: Assemble the full rehearsal probe correctly.** Create `scripts/db/probes/17-full-rehearsal.sql` as:
  1. every `DO $…$ … END $…$;` block from probes **04, 05, 06, 07, 08, 09, 10, 11, 13 (both fixtures), 14, then 05b, then 16**, in that order, verbatim — including their `CREATE TEMP TABLE … ON COMMIT DROP` context tables, whose names are already distinct per probe (`rfi_ctx`, `wb_ctx`, `sn_ctx`, `in_ctx`, `qc_ctx`, `d_ctx`, `f_ctx`, `del_ctx`, `idem_ctx`, `gd_ctx`, `rls_ctx`). **The two impersonating probes (05b, 16) go last**: each clears its claim (Task 1 rule 3), but every `postgres` block that depends on the service path is safest run before any impersonation at all;
  2. then **one** `SELECT … UNION ALL …` carrying every assertion arm from all of those files.

  Two mechanical checks before running it:
  ```bash
  # exactly one row-producing statement, and it is last
  grep -c "^SELECT '" scripts/db/probes/17-full-rehearsal.sql        # expect 1
  tail -1 scripts/db/probes/17-full-rehearsal.sql | grep -q ';' && echo "ends in the assertion"
  # no probe's DO block was dropped
  grep -c "END \$probe\$;\|END \$setup\$;\|END \$asuser\$;\|END \$as_contractor\$;\|END \$as_pm\$;\|END \$rerun\$;\|END \$qcfix\$;\|END \$snagfix\$;" \
    scripts/db/probes/17-full-rehearsal.sql
  ```
  ⚠ Probe 13's counts already exclude `_probe_%` projects (Task 14 Step 1). Confirm that exclusion survived the assembly — without it, probe 04's RFI, probe 11's RFI/snag/diary and probe 06's snag all land in the live counts and `total_live_items` reads 40-odd instead of 34, failing for a reason that has nothing to do with the backfill.

- [ ] **Step 2: Capture a pre-state baseline, including the sequence.**
  ```bash
  cat > /tmp/baseline.sql <<'SQL'
  SELECT 'baseline' AS probe, true AS ok,
    'rfis_null='   || (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) ||
    ' snags_null=' || (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) ||
    ' work_items=' || (SELECT count(*) FROM projects.work_items) ||
    ' notifications=' || (SELECT count(*) FROM public.notifications) ||
    ' product_events=' || (SELECT count(*) FROM public.product_events) ||
    ' rfi_seq='    || (SELECT last_value FROM projects.rfis_rfi_number_seq) ||
    ' projects='   || (SELECT count(*) FROM projects.projects) AS detail;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/baseline.sql
  ```
  Expected before anything is applied: `rfis_null=15 snags_null=6 work_items=0 notifications=964 rfi_seq=16 …` (or whatever the estate holds that day — **write it down**).

- [ ] **Step 3: Run the full rehearsal, and the four stateless probes beside it.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/17-full-rehearsal.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql

  # 01, 02, 03 and 12 assert on pg_catalog and pure functions rather than on
  # fixtures, so they stay separate files and are run alongside, not merged in.
  for p in 01-preflight 02-resolvers 03-status-map 12-grants; do
    echo "── $p"
    pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/$p.sql \
      --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  done

  # Item 2's own regression suite, with 00198 stacked (Task 15 Step 6b retargeted
  # the four fixtures that would otherwise collide with the backfill).
  for f in scripts/db/assertions/work-item-*.sql; do
    WITH_EXTRA=apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
      scripts/db/try-work-item-spine.sh "$f"
  done
  ```
  Expected from the rehearsal: every assertion PASS, and an `assertions seen:` line naming **every** probe from every merged file. **Count the names against the per-task totals:**

  | file | assertions |
  |---|---|
  | 04 rfi-mirror (incl. the two #4 stamp rows) | 14 |
  | 05 writeback | 7 |
  | 06 snag-mirror | 10 |
  | 07 inspection-mirror | 9 |
  | 08 qc-mirror | 7 |
  | 09 diary-mirror (tautology deleted) | 6 |
  | 10 form-mirror | 5 |
  | 11 delete-to-void | 6 |
  | 13 backfill (incl. both synthetic fixtures, the two #4 rows and the watcher sweep) | 27 |
  | 14 idempotency | 4 |
  | 05b guard-exemption (impersonated) | 7 |
  | 16 as-a-real-user (incl. Step 4's addition) | 7 |
  | **total** | **109** |

  If the list is shorter than 109, an arm was lost in the assembly — read the list, not the total. The four stateless probes add 7 + 9 + 25 + 8 = 49 more, run separately, and item 2's ten files must all print `✓`.

- [ ] **Step 4: Prove the assembly is not silently discarding assertions.** Deliberately break **one** arm in the middle of the file — change probe 06's `gatekeeper_is_pm_not_raiser` expectation to `= c.ctr` — and re-run. Expected: exactly that one row FAILs and the other 108 pass. If instead everything passes, the assembly is broken and the whole rehearsal is decorative. Restore.

- [ ] **Step 5: Prove the rehearsal left nothing.** Re-run Step 2's baseline. Expected: **identical** to Step 2's output **except `rfi_seq`**, which will have advanced by the number of RFIs the fixtures inserted (roughly 6). Sequences are not transactional; nothing else may have moved. If `work_items` is not back to 0, the harness's rollback did not fire — stop and investigate before doing anything else.

- [ ] **Step 6: Publish the day-one list — improvement 3.** A count is not a distribution, and the only property an inbox has is whose it is. Create `scripts/db/probes/18-day-one-list.sql`:
  ```sql
  -- Every backfilled item as one line, ordered the way §04 orders the Inbox.
  -- This is not an assertion file: it is the artefact that goes in the PR body and
  -- in front of the owner in Task 19, so a human can see the 34 items before they
  -- are irreversible. It still ends in the (probe, ok, detail) shape the harness
  -- requires, with the line itself in `detail`.
  SELECT 'item' AS probe, true AS ok,
         rpad(w.ref, 12) || ' ' ||
         rpad(left(p.name, 26), 27) || ' ' ||
         rpad(w.item_type, 13) || ' ' ||
         rpad(w.status, 9) || ' ' ||
         to_char(w.due_date, 'YYYY-MM-DD') || '  ' ||
         rpad(COALESCE(left(holder.full_name, 18), '—'), 19) || ' ' ||
         left(w.title, 60) AS detail
    FROM projects.work_items w
    JOIN projects.projects p ON p.id = w.project_id
    LEFT JOIN public.profiles holder ON holder.id = w.ball_in_court_id
   WHERE w.origin = 'mirror' AND p.name NOT LIKE '\_probe\_%'
   ORDER BY w.ball_in_court_id NULLS LAST, w.due_date, w.ref;
  ```

- [ ] **Step 7: Run it and read all 34 lines.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/18-day-one-list.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
    | tee /tmp/day-one-list.txt
  ```
  **Paste the whole output into the PR body.** Read it before you do anything else, and specifically look for:
  - **Duplicate titles.** Measured, the live RFI subjects include `Cable Schedule ` twice, `Inquiry for Mains 2.1 and Mains 3.1` twice, plus `Inquiry` and `Drawings` — four of the eight open RFIs are indistinguishable by title alone. That is why this listing carries `ref` and project name, and it is a **finding for item 4**: the Inbox row and the recap line must render ref + project + raiser alongside the title, or a user cannot tell two of their items apart. Raise it against item 4 in the PR body.
  - **Concentration.** Expect roughly: 8 open RFIs on the triage owner, 1 answered RFI on its raiser, 6 closed RFIs with no holder, 18 inspections split across three WM staff (measured today: 7 / 6 / 5), 1 site form on its author. Anything materially different means a resolver is behaving unexpectedly — reconcile before Task 19.

- [ ] **Step 8: Confirm no mail could have been sent by the migration itself.**
  ```bash
  grep -c "send-email\|net.http_post\|pg_net\|fetch(" \
    apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `0`. The migration is pure SQL and issues no outbound call. **This is not the whole outbound-mail story** — §12 §(d) requires an outbound gate on every project touched by a write-back; the column it names does not exist (`00195` added four columns and not that one), and how the gate is provided is the owner decision in Task 20 Step 5.

- [ ] **Step 9: Commit.**
  ```bash
  git add scripts/db/probes/17-full-rehearsal.sql scripts/db/probes/18-day-one-list.sql
  git commit -m "test(work-items): end-to-end rolled-back production rehearsal + the day-one item list

The rehearsal is one assertion SELECT after all the fixtures, not ten
concatenated probe files: the Management API returns rows from the last
row-producing statement only, so a concatenation discards nine of ten silently."
  ```

---

## Task 18 — Documentation: the matrix, CONFORMANCE, and six spec corrections

This item introduces **no route and no endpoint**, so `docs/rbac-matrix.md` gains no route row. It does change **effective write authority**, which is the thing the matrix exists to record: a work-item reassign or re-date now writes `projects.rfis.assigned_to`, `projects.rfis.due_date` and `field.snags.assigned_to` through a `SECURITY DEFINER` function with `row_security` off, so those tables' own RLS is bypassed on that path. That is an auth change, and `CONFORMANCE.md`'s own rule (STANDARD §4, quoted at the top of the file) says it moves in the same PR.

Appendix A(f)'s Q1 row must gain the twenty-two new functions **and the snapshot table** — and **only** the new names: item 2 already registered `resolve_project_pm()`, `resolve_work_item_assignee()`, `user_can_*` (`16-appendix-registries.md:331`) and its trigger functions (`:350`), and a duplicate entry is what §12 §(h) **test 8** would flag if it existed (it does not yet — the registry diff is a review discipline until someone owns it; `migration-verify-block.contract.test.ts` says so). §12 §(h) **test 5** (the hygiene test) does exist and has been green since Task 2.

- [ ] **Step 1: Add the matrix subsection.** In `docs/rbac-matrix.md`, after `### Work items (\`work-items.actions.ts\`)` (line ~496 — item 2's subsection; the 2026-09-10 anchor "after Site forms" is stale) and before `## Public / unauthenticated` (line ~530), insert:
  ```markdown
  ### Work-item source mirrors (database triggers, no route)

  | Path | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
  |---|---|---|---|---|---|---|---|
  | Reassign a mirrored work item ⇒ writes `projects.rfis.assigned_to` | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Re-date a mirrored work item ⇒ writes `projects.rfis.due_date`     | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Reassign a mirrored work item ⇒ writes `field.snags.assigned_to`   | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Raise an RFI / snag / inspection / QC defect / site form ⇒ creates a work item | W | W | W | W | W | W | — |

  > ¹ Not a gate in this migration. Who may change `work_items.assignee_id` or
  > `due_date` is item 2's `projects.user_can_write_work_item(project_id, item_type)`,
  > enforced by a RESTRICTIVE UPDATE policy; this row records only where that
  > authority *lands*. **The write-back function is `SECURITY DEFINER … SET
  > row_security TO 'off'`, so it bypasses the RLS on `projects.rfis` and
  > `field.snags`.** That is deliberate: the mirror resolves an assignee the raiser
  > could not have written themselves (the triage owner, the project PM), and the
  > two source columns must agree with the spine or every existing reader and PDF
  > shows something different from the Inbox. The authority check happens once, on
  > the `work_items` UPDATE. The write-back **skips `closed` and `void` records**,
  > so a historical row never acquires an assignee nobody set.
  >
  > **`structure.node_orders` has no projection trigger and no row here.**
  > `order_followup` is created only by the explicit chase control on an order line
  > (Appendix A(b)) — which no Q1 deliverable builds, so that type produces nothing
  > this quarter. A contract test fails the build if any trigger in the mirror
  > migration names that table: 440 live procurement rows projected into inboxes is
  > the backfill poisoning the roadmap names as a risk.
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
  > `resolve_work_item_assignee` (`00196:911–913`) still **admits** a client
  > viewer — in a fit-out the landlord is often the ball-in-court — so a PM can
  > assign one by hand through the Inbox; the mirror never resolves to one on
  > its own. Both are decisions; delete the mirror's clause in Q3 with the write set.
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
  > PR): the mirror sets `created_by = raised_by` and the raiser gatekeeps.
  ```

- [ ] **Step 2: Verify the matrix edit landed between the right headings.**
  ```bash
  grep -n "^### \|^## " docs/rbac-matrix.md | sed -n '/### Work items/,/Public/p'
  ```
  Confirm `### Work-item source mirrors` sits between `### Work items` and `## Public / unauthenticated`.

- [ ] **Step 3: Add the CONFORMANCE row — re-read the last C id first.** Item 1 took **C11** and item 2 took **E9** (`CONFORMANCE.md:86`), so the next id under `## C. Provisioning & database` is expected to be **C12** — but read the table's last row before claiming it; another session may have landed a C row since. Append to the `## C. Provisioning & database` table (substituting the id you read):
  ```markdown
  | C12 | Work-item mirrors write source columns through SECURITY DEFINER triggers; the transition guard's exemption is depth-scoped | MUST | ✓ | `00198_work_item_source_mirrors_and_backfill.sql` sections C′–G. Twenty-two new functions, all with `SET search_path`; the eighteen stateful ones `SECURITY DEFINER … SET row_security TO 'off'`, the four pure mappers `IMMUTABLE`/`STABLE` invoker. None uses `current_user` for authorisation (asserted in-migration and by probe, comment-stripped). All revoked from PUBLIC **and** `anon` and granted to nobody — trigger functions fire without EXECUTE, verified with `has_function_privilege`. Item 2's `work_items_transition_guard()` is `CREATE OR REPLACE`d with `IF v_actor IS NULL OR pg_trigger_depth() > 1` (never `> 0`) and `source_status` in clause (a); proved under impersonation (probe 05b) and pinned by a `sql:` directive + a contract test. The pre-migration snapshot table is `REVOKE SELECT … FROM anon` + RLS-enabled with no policy. Authority is checked once, on the `projects.work_items` UPDATE, by item 2's `user_can_write_work_item` + RESTRICTIVE policy; the mirror's own resolver (`resolve_mirror_assignee`) has no caller guard and excludes `client_viewer`. |
  ```
  Then update the file's `Last updated:` line to today's date and this branch name.

- [ ] **Step 4: Extend Appendix A(f)'s Q1 row — new names only.** In `16-appendix-registries.md`, the A(f) table's **Q1 / `projects`** cell already lists `resolve_project_pm()`, `resolve_work_item_assignee()`, `user_can_*` and item 2's trigger functions (`:331`, `:350`). **Do not repeat them.** Append after the last existing entry:
  ```
  , backup_00198_source_assignees, work_item_person_eligible(), resolve_mirror_assignee(),
  resolve_work_item_gatekeeper(), map_source_status(), work_item_status_for_mirror(),
  work_item_mirror_due_date(), diary_delay_text(), project_rfi(), project_snag(),
  project_inspection(), project_qc_entry(), project_diary_action(), project_form_action(),
  mirror_rfi_work_item(), mirror_snag_work_item(), mirror_inspection_work_item(),
  mirror_qc_defect_work_item(), mirror_qc_report_defects(),
  mirror_diary_action_work_item(), mirror_form_action_work_item(),
  work_item_assignment_writeback(), void_work_item_on_source_delete()
  ```
  and beside item 2's `work_items_transition_guard()` entry add "(replaced by 00198: depth-scoped exemption)". If the owner takes option (a) in Task 20 Step 5, `project_settings.suppress_all_outbound` is booked under ordinal 6's column list with "(added by 00198)".

- [ ] **Step 5: Correct A(f)'s ordinal-9 sentence — three changes.** Replace it with:
  > Projection triggers on the **six automatic** Q1 sources of A(b) — `rfis`, `snags`, `qc_entries`, `inspections`, `site_diary_entries`, `site_forms` — **plus a report-level entry point on `projects.qc_reports`, because the `qc_defect` scope predicate spans two tables and an entry does not cross it on its own (measured 2026-09-10: an entry is authored while its report is `draft` and enters scope when the report is issued)** — with assignment and due-date write-back; then the entity backfill under `SET LOCAL esite.suppress_notifications = 'on'`; then the backfill-completion `product_events` row. **`auth_events.session_id` rides with migration 1, per §12 §(c) line 121, and is not part of this migration.**

- [ ] **Step 6: Correct §12 §(c) hard dependency 5.** It currently reads "…`site_forms` — **and only those**." Amend to:
  > …`site_forms` — **and only those, plus a report-level entry point on `projects.qc_reports`**, because the `qc_defect` scope predicate spans two tables and an entry does not cross it on its own (measured 2026-09-10). `structure.node_orders` still gets **no trigger**.

- [ ] **Step 7: Correct §03 §1.2 — two errors in one paragraph.** Replace *"an `AFTER DELETE` trigger on each source sets the orphaned item `status = 'void'`"* with:
  > a **`BEFORE DELETE`** trigger on each source sets the item `status = 'void'`, `void_reason = 'source deleted'`. **`AFTER DELETE` does not work and is worse than it looks:** the `ON DELETE SET NULL` referential action runs first, so an `AFTER` trigger's `UPDATE` matches nothing — and `work_items_source_required` is re-evaluated on that `SET NULL` while the item is still `open` with no source, so the **DELETE aborts with `23514`** and deleting an RFI, snag or diary entry stops working entirely (derived from A(a)'s constraint set and measured 2026-09-10).

  And in the "Trigger loop suppression" paragraph, replace *"declared `AFTER INSERT OR UPDATE … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col>)`"* with:
  > declared as **two triggers per source** — `AFTER INSERT … FOR EACH ROW` and `AFTER UPDATE OF <cols> … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col> OR …)`. A single declaration is not valid PostgreSQL: `ERROR: 42P17: INSERT trigger's WHEN condition cannot reference OLD values`.

- [ ] **Step 8: Correct A(b)'s `rfi` gatekeeper and §12 §(d)'s RFI chain (the A(b) half is conditional on the owner decision recorded in Task 5½).** A(b) is the prose; the registry row (`UPDATE projects.work_item_types SET gatekeeper_rule = 'creator' WHERE key = 'rfi'`) and the TS mirror already changed in Task 5½ — all three must agree, and item 2's `work-item-types.contract.test.ts` pins the SQL/TS pair. In A(b), change the `rfi` row's **Gatekeeper** cell from `project PM` to:
  > the raiser (`rfis.raised_by`), else the project PM — registry `gatekeeper_rule = 'creator'`

  with a footnote under the table:
  > **`rfi`'s gatekeeper is the raiser, not the PM** (measured 2026-09-10): `triage_owner_id` and the §1.5 PM resolver both return the same person on 13 of 14 projects, so a PM gatekeeper makes assignee and gatekeeper identical on all 15 live RFIs and §03 §1.8's "only the gatekeeper may close" vacuous for the type that carries metric 4. An RFI is the mirror image of a snag: the asker confirms the answer is usable, whereas a defect is never signed off by the person who reported it. 12 of the 15 live RFIs were raised by contractors, and this is the only Q1 mechanism that puts a work item into a contractor's ball-in-court.

  In §12 §(d)'s backfill table, the `projects.rfis` row already names `default_rfi_assignee_id`; leave it, and add one sentence to the paragraph below it:
  > The database chain implements that step too, even though `rfiService.create` already applies it at the application layer (`rfi.service.ts:75-83`) and no project has the column set — because the backfill is precisely the path on which that application-layer fallback never ran.

- [ ] **Step 9: Run the whole test suite.**
  ```bash
  pnpm --filter web test
  pnpm --filter @esite/shared test
  pnpm --filter web type-check
  pnpm --filter web lint
  ```
  All four clean. §12 §(h) test 5 (`migration-verify-block.contract.test.ts`) exists and must be green; the `@esite/shared` run covers `work-item-types.contract.test.ts` (the registry/TS equality, changed in Task 5½). Tests 7 and 8 do not exist yet; if they land before merge they must pass against the amended A(f) — that is the point of Steps 4 and 5.

- [ ] **Step 10: Commit.**
  ```bash
  git add docs/rbac-matrix.md CONFORMANCE.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/03-work-items.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/12-data-model-and-migrations.md
  git commit -m "docs: record the mirror write-back authority and the guard exemption; six spec corrections

§03 §1.2: BEFORE DELETE, not AFTER (the AFTER form aborts the delete with 23514),
and two triggers per source because PostgreSQL rejects WHEN(OLD…) on an INSERT arm.
§12 §(c)5 and A(f) ordinal 9: the qc_defect projection needs a qc_reports entry
point. A(f) ordinal 9: auth_events.session_id rides with migration 1 per §12 §(c).
A(b): the RFI gatekeeper is the raiser (registry gatekeeper_rule = 'creator').
Matrix: the mirror resolver excludes client_viewer where item 2's picker admits
them; the transition guard's exemption is depth-scoped (> 1, never > 0)."
  ```

---

## Task 19 — Put the fourteen resolved triage owners in front of a human (improvement 12)

`projects.resolve_project_pm` — `00195`'s, item 2's function, which this plan reads as-is — takes the **oldest active `project_manager` membership row**, ties broken by `user_id`. Measured 2026-09-10: SAXBY has **4** such rows, PNP FAERIE GLEN **4**, KINGSWALK **3**. On those three projects the person who receives every unowned item is decided by the creation order of a membership row — invisibly, with no way for anyone to tell why.

§02's central finding about this codebase is that `default_rfi_assignee_id` was a perfectly good routing mechanism that no project ever configured, and that *a setting that must be turned on is a setting that does not exist*. The inverse failure is a setting nobody was ever shown being silently decisive over 34 items. **This task costs an hour of the owner's time and sits off the critical path** — item 3 is not on it.

**Files:** none. This task produces a decision and possibly some `project_settings` writes.

- [ ] **Step 1: Print the resolution table for all fourteen projects.**
  ```bash
  cat > /tmp/owners.sql <<'SQL'
  SELECT 'project' AS probe, true AS ok,
         rpad(left(p.name, 34), 35) || ' ' ||
         rpad(COALESCE(left(t.full_name, 18), '<unset>'), 19) || ' ' ||
         rpad(COALESCE(left(m.full_name, 18), '<none>'), 19) || ' ' ||
         rpad((SELECT count(*)::text FROM projects.project_members pm
                WHERE pm.project_id = p.id AND pm.role = 'project_manager' AND pm.is_active), 3) || ' ' ||
         (SELECT count(*)::text FROM projects.rfis r WHERE r.project_id = p.id) || ' rfi, ' ||
         (SELECT count(*)::text FROM inspections.inspections i WHERE i.project_id = p.id) || ' insp'
         AS detail
    FROM projects.projects p
    LEFT JOIN projects.project_settings s ON s.project_id = p.id
    LEFT JOIN public.profiles t ON t.id = s.triage_owner_id
    LEFT JOIN public.profiles m ON m.id = projects.resolve_project_pm(p.id)
   ORDER BY p.name;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/owners.sql \
    --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql \
    | tee /tmp/triage-owners.txt
  ```
  Columns: project · `triage_owner_id` as set by item 6 · what `resolve_project_pm` returns · how many active PM rows exist · how many items that project contributes. **A project with `PM rows` ≥ 2 is one where the answer was chosen by creation order.**

- [ ] **Step 2: Send `/tmp/triage-owners.txt` and `/tmp/day-one-list.txt` (Task 17 Step 7) to Arno and get an explicit yes or a list of overrides.** The question is exactly: *"Every unowned item on this project will land on this person. Is that right?"* Expect a correction on at least the three multi-PM projects.

- [ ] **Step 3: Apply any overrides as `project_settings.triage_owner_id`, and re-read every row.** ⚠ **PostgREST emits `ON CONFLICT` only when `Prefer: resolution=merge-duplicates` arrives as an HTTP header** — a query parameter is silently ignored, and a supabase-js `.upsert()` on `project_settings` has already silently no-opped in this codebase (PR #159). Write these with plain SQL through the Management API and **confirm with a `SELECT`, never with the absence of an error**:
  ```bash
  cat > /tmp/set-owner.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT
  const [projectId, userId] = process.argv.slice(2)
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  await q(`UPDATE projects.project_settings SET triage_owner_id = '${userId}'
            WHERE project_id = '${projectId}'`)
  console.log(await q(`SELECT project_id, triage_owner_id FROM projects.project_settings
                        WHERE project_id = '${projectId}'`))
  JS
  node /tmp/set-owner.mjs <project-id> <user-id>
  ```
  The printed row **is** the verification. If the `SELECT` returns **no row**, the project has no `project_settings` row and item 2's `ensure_project_settings_row()` / `00195` missed it — that is a blocker on item 2, not something to paper over with an INSERT here. (A row with `triage_owner_id` NULL after the UPDATE means the UPDATE matched nothing — check the project id.)

- [ ] **Step 4: Re-run Task 17's day-one list after any overrides** and confirm the distribution moved the way the owner expected. Put the before and after holder tallies in the PR body.

- [ ] **Step 5: Record the decision in the PR body**, including any project where Arno accepted the creation-order default knowingly. There is nothing to commit; the artefact is the paragraph.

---

## Task 20 — Claim the number, set the outbound gate, apply, and read the objects back

**Everything about this task is a rule that was written in blood.** PRs #162 and #163 both shipped a `00183`; `db push` keys on the version **prefix**, so a number already in `schema_migrations` makes it print "Remote database is up to date", exit 0 and **skip the file**. The workflow went green and production served the old code. Then both fixes independently renumbered to `00184` and broke the deploy workflow twice more.

**Files:**
- Rename: the migration file — **only if** Step 1 finds `00198` taken
- Modify: the migration header's `go_live` and floor literals; the snapshot table name and probe 12/13 only if renamed

- [ ] **Step 1: Re-read `max(version)` from production AND `origin/main`, at merge time, not now.**
  ```bash
  cat > /tmp/maxver.sql <<'SQL'
  SELECT 'max_version' AS probe, true AS ok, max(version) AS detail
    FROM supabase_migrations.schema_migrations;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/maxver.sql
  git fetch origin main
  git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | sort | tail -3
  ```
  As of 2026-09-13 the ledger reads **`00196`** (item 2, applied 2026-09-12), `origin/main`'s tail is `00196`, and open PR #185 holds **`00197`** — which is why this file has been `00198` since Task 2. **Re-read all three.** If #185 has merged and applied, `max(version)` reads `00197` and `00198` is still right; if something else has taken `00198`, take the next free number and do the rename in Step 4. ⚠ Merge-order: if #185 has **not** applied by the time this merges, `00198` landing first makes `db push` refuse #185's `00197` ("local migration files to be inserted before the last migration on remote" — the PR #163/#165 lesson). Tell the owner which order the two must apply in; do not silently take `00197`.

- [ ] **Step 2: Check every open PR for the same number.** `≤ max(version)` only catches a number the ledger has absorbed; the failure that actually happened was two sessions each picking the same *free* number and each passing that check.
  ```bash
  gh pr list --state open --json number,headRefName --jq '.[] | "\(.number) \(.headRefName)"' |
  while read -r n b; do
    echo "PR #$n:"
    gh api "repos/WattMatt/e-site/pulls/$n/files" --jq \
      '.[].filename | select(startswith("apps/edge-functions/supabase/migrations/"))'
  done
  ```
  If any open PR claims your number, take the next one and **say so in your PR body**.

- [ ] **Step 3: Announce the number to peer sessions before writing the file.** This is a shared checkout with concurrent agent sessions; the announcement is the only signal available before either merges.

- [ ] **Step 4: Re-derive the literals; rename only if the number moved.** The file, the snapshot table (`backup_00198_source_assignees`), the `@verify` block, probes 12 and 13 and the header have carried `00198` since Task 2 (placeholders do not parse — Task 2). In one edit pass:
  1. `v_go_live` and `v_floor` in section H, **recomputed from the actual release date**. `2026-11-10` assumes a Tuesday 2026-11-03 go-live and five office working days with no SA public holiday in the window; re-derive from `listHolidays(<year>)` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:43`) if the date moves, and update the header comment with the new derivation;
  2. `DATE '2026-11-10'` in `scripts/db/probes/13-backfill.sql`, twice;
  3. **only if Step 1 found `00198` taken:** `git mv` the file to the new number and change every `00198` in the header, the `table:`/`grant_absent:` lines, sections H's four snapshot-table references, the two restore statements, probes 12 and 13, CONFORMANCE and A(f) — one `grep -rn 00198` over the branch is the checklist.

  Then re-run probes 12, 13 and 17 to confirm the edit broke nothing:
  ```bash
  for p in 12-grants 13-backfill 17-full-rehearsal; do
    pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/$p.sql \
      --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
  done
  ```

- [ ] **Step 5: The outbound-mail gate on every project the write-back will touch — BEFORE merging.** §12 §(d): *"That GUC does not cover outbound mail. `projects.project_settings.suppress_all_outbound` must be set on any project touched by a write-back, and the send log read back afterwards to prove the path inert."* The write-back changes `assigned_to` on 9 live RFIs across up to four projects. The migration itself is pure SQL and sends nothing (Task 17 Step 8), but any application path that observes those rows in the same window can, and the spec makes the flag a precondition rather than a judgement call. **The column the spec names does not exist** — `00195` (item 2's slice of A(f) ordinal 6) added `work_item_defaults`, `triage_owner_id` and the two shutdown columns only (#6).

  > ⚠ **OWNER DECISION (default: (a) — item 3 adds the column).** Two ways to satisfy §12 §(d)'s gate; the reconciliation leaned (b) and the controller recorded (a) as the default, so both are written out and the owner picks.
  >
  > **(a) Item 3 adds `projects.project_settings.suppress_all_outbound boolean NOT NULL DEFAULT false`** in section C′ (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), books it in A(f) ordinal 6 as "added by 00198", and declares `-- column: projects.project_settings.suppress_all_outbound` in the `@verify` block. Because the column is born in the same transaction as the backfill, the flag cannot be set *before* merge; section H sets it **inside the migration, before the first `PERFORM`** — `UPDATE projects.project_settings SET suppress_all_outbound = true WHERE project_id IN (<the scope below>)` — and Step 9 clears it after the send log is read. Nothing in the application reads the column yet (items 4–6 will honour it), so today it is bookkeeping that the later readers inherit already-true on the right projects; say so in the PR body rather than implying it silenced anything. Task 20 Step 8 gains `suppress_flag_set_on_touched_projects`; Step 9's clear is re-read with a `SELECT`.
  >
  > **(b) Substitute the existing per-project toggles** `notify_rfi_email` (`00101:43`) and `notify_snag_email` (`00147:9`): set both `false` on the touched projects **before merge** by plain SQL through the Management API and **re-read them with a `SELECT`** (the Prefer-header lesson, PR #159), run the apply, read the send log, restore them (re-read again). The migration then adds no column and section A stays as written; A(f) ordinal 6's `suppress_all_outbound` remains booked for whichever of items 5/6 first needs it. The migration is pure SQL inside one `db push` transaction and no application path observes the apply, so (b) satisfies §12 §(d)'s *intent*; it does not satisfy its *letter*, which is the reason the column is the default.
  >
  > **What changes if the owner picks (b):** delete the `ADD COLUMN`, the `UPDATE … suppress_all_outbound` in section H, the `column:` directive, the A(f) booking and Step 8's flag assertion; run the script below with `notify_rfi_email`/`notify_snag_email` in place of `suppress_all_outbound` (two columns, both `false`, both re-read); Step 9 restores both to their captured values, not to `true` blindly.

  For either option, the scope and the re-read are the same shape:
  ```bash
  cat > /tmp/suppress.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT ?? process.env.SUPABASE_ACCESS_TOKEN
  const on = process.argv[2] === 'on'
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  const scope = `project_id IN (
      SELECT DISTINCT r.project_id FROM projects.rfis r WHERE r.status <> 'closed'
      UNION SELECT DISTINCT s.project_id FROM field.snags s)`
  // Option (a): the column exists only AFTER apply, so `on` is set by section H
  // and this script is used for the `off` half (Step 9) and the re-read.
  // Option (b): replace the column with notify_rfi_email/notify_snag_email and
  // run `on` (= both false) BEFORE merge, capturing the prior values first.
  if (!on) await q(`UPDATE projects.project_settings SET suppress_all_outbound = false WHERE ${scope}`)
  // Re-read. Never trust the absence of an error on a settings write (PR #159).
  console.log(JSON.stringify(await q(
    `SELECT p.name, s.suppress_all_outbound
       FROM projects.project_settings s JOIN projects.projects p ON p.id = s.project_id
      WHERE s.${scope.slice(0)} ORDER BY p.name`), null, 1))
  JS
  ```
  **Every row in the printed output must read the value you expect.** A project whose row is missing has no `project_settings` row at all — a blocker on item 2's `ensure_project_settings_row()`.

- [ ] **Step 6: Merge, and watch the workflow.** `deploy-migrations.yml` auto-runs on any push to `main` touching a migration (path filter `apps/edge-functions/supabase/migrations/**`) and its three secrets have been bound since 2026-06-02.
  ```bash
  gh run watch "$(gh run list --workflow='Deploy DB Migrations' --limit 1 --json databaseId --jq '.[0].databaseId')"
  ```

- [ ] **Step 7: A green workflow is not evidence. Read the objects back.**
  ```bash
  node --experimental-strip-types scripts/verify-migration-applied.ts --since 00197   # > 00197 ⇒ 00198 only
  ```
  (`--since` keeps files whose 5-digit prefix is **greater** than the value — `scripts/verify-migration-applied.ts:94`; `--file 00198_work_item_source_mirrors_and_backfill.sql` is the other form.) It parses the `-- @verify:` block and evaluates every directive — `table`, `function`, `trigger`, `grant_absent`, and the two `sql:` predicates (the guard's exemption text; the `rfi` registry rule) — one read-only request per predicate, exiting non-zero on any absence, any surviving `anon` privilege, or a false predicate. The deploy workflow already runs this after `db push`; run it again by hand and paste the directive count into the PR body.

- [ ] **Step 8: Independently read the data back, which is the check `db push` cannot fake.**
  ```bash
  cat > /tmp/postapply.sql <<'SQL'
  WITH live AS (
    SELECT w.* FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
     WHERE p.name NOT LIKE '\_probe\_%')
  SELECT 'version_in_ledger' AS probe,
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '00198') AS ok,
         'the file must be in the ledger AND its effect present' AS detail
  UNION ALL
  SELECT 'items_projected', (SELECT count(*) FROM live WHERE origin='mirror') = 34,
         'got ' || (SELECT count(*) FROM live WHERE origin='mirror') || ' of 34'
  UNION ALL
  SELECT 'open_rfis_now_assigned',
         (SELECT count(*) FROM projects.rfis WHERE status <> 'closed' AND assigned_to IS NULL) = 0,
         'was 15 NULL before; the 6 closed ones stay NULL by design'
  UNION ALL
  SELECT 'closed_rfis_still_unassigned',
         (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) = 6,
         'improvement 9: a historical record must not acquire an assignee nobody set'
  UNION ALL
  SELECT 'snags_untouched',
         (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) = 6,
         'improvement 2: no snag was backfilled, so none acquired an assignee'
  UNION ALL
  SELECT 'no_demo_org_items',
         (SELECT count(*) FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
           WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001') = 0,
         'the E-Site DEMO org contributed nothing'
  UNION ALL
  SELECT 'no_diary_items', (SELECT count(*) FROM live WHERE item_type='diary_action') = 0,
         'improvement 1: all six live "delays" say None'
  UNION ALL
  SELECT 'no_order_followup',
         (SELECT count(*) FROM projects.work_items WHERE item_type='order_followup') = 0,
         '440 node_orders rows, deliberately zero items'
  UNION ALL
  SELECT 'no_backfill_bells',
         (SELECT count(*) FROM public.notifications
           WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
         'VACUOUS until item 4 adds the emit + GUC guard to §11 (00196:1354-1356); kept so the check is already in place'
  UNION ALL
  SELECT 'completion_event_present',
         (SELECT count(*) FROM public.product_events
           WHERE event = 'backfill_completed'
             AND properties->>'migration' = 'work_item_source_mirrors_and_backfill') >= 1,
         'F11: the fixed vocabulary''s arm; item 4''s first recap filters on properties->>backfill_completed_at'
  UNION ALL
  SELECT 'rfi_gatekeeper_rule_is_creator',
         (SELECT gatekeeper_rule = 'creator' FROM projects.work_item_types WHERE key = 'rfi'),
         'improvement 4 / #15 (owner decision): the registry agrees with the mirror'
  UNION ALL
  SELECT 'guard_exemption_present',
         (SELECT p.prosrc ~ 'pg_trigger_depth\(\)\s*>\s*1' AND p.prosrc !~ 'pg_trigger_depth\(\)\s*>\s*0'
             AND p.prosrc ~ 'source_status\s+IS DISTINCT FROM'
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'projects' AND p.proname = 'work_items_transition_guard'),
         'F8: the replaced guard is what is deployed, not item 2''s text'
  UNION ALL
  SELECT 'opened_at_is_historical',
         (SELECT min(opened_at) FROM live WHERE origin = 'mirror') < now() - interval '1 day',
         '#4: the backfill kept the sources'' created_at; metric 5''s denominator is not 34-in-one-week'
  UNION ALL
  SELECT 'thirteen_projection_triggers',
         (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND p.proname LIKE 'mirror\_%') = 13,
         'six sources × (ins + upd) = 12, plus qc_reports_mirror_defects'
  UNION ALL
  SELECT 'six_void_triggers_all_before',
         (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND p.proname = 'void_work_item_on_source_delete'
             AND (t.tgtype & 2) = 2) = 6,
         'tgtype bit 1 (value 2) is BEFORE; six of six must set it'
  UNION ALL
  SELECT 'anon_has_no_execute',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='projects'
             AND p.proname LIKE ANY (ARRAY['mirror\_%','resolve\_%','project\_%','map\_source\_status',
                                           'work\_item\_%','work\_items\_transition\_guard',
                                           'void\_work\_item\_%','diary\_delay\_text'])
             AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0,
         'never read proacl — a NULL proacl looks empty but IS the PUBLIC grant'
  UNION ALL
  SELECT 'anon_cannot_read_the_snapshot',
         NOT has_table_privilege('anon', 'projects.backup_00198_source_assignees', 'SELECT'),
         'explicitly revoked (00196:1310 already made new projects tables non-anon-readable)';
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/postapply.sql
  ```
  Expected: 17/17 as written; **18/18 under option (a)**, after adding `suppress_flag_set_on_touched_projects` — `(SELECT bool_and(s.suppress_all_outbound) FROM projects.project_settings s WHERE s.project_id IN (<the Step 5 scope>))` — which does not exist under option (b). **`six_void_triggers_all_before` and `guard_exemption_present` are the two to read twice** — the first is the only post-apply check for F1, whose failure mode (a DELETE that aborts with 23514) only shows up when somebody deletes something; the second is the only post-apply check that the guard actually deployed is the replacement, whose failure mode (a contractor's RFI respond refused with a sentence about the item) only shows up when a signed-in user pushes a status.

  Then run item 2's two post-apply checks alongside, as the regression baseline for the spine this migration sits on:
  ```bash
  scripts/db/smoke-test-work-item-spine.sh                     # item 2's 12-section smoke test
  for f in scripts/db/assertions/work-item-*.sql; do           # item 2's suite, UNSTACKED — 00198 is live now
    scripts/db/try-work-item-spine.sh "$f"
  done
  ```
  Expected: the smoke test green; all ten `✓` (Task 15 Step 6b is what makes the four retargeted files hold here).

- [ ] **Step 9: Read the send log and clear the outbound gate (per the Step 5 owner decision).**
  ```bash
  # There is no send-log table for this path: public.email_sequence_events
  # (00030_email_sequences.sql:14) covers the onboarding/re-engagement sequence and
  # not RFI or snag mail. The two records that exist are the edge function's
  # invocation log and Resend's own send list — check BOTH for the apply window.
  #   Supabase Dashboard → Edge Functions → send-email → Invocations
  #   Resend → Emails, filtered to the apply window
  # Expect ZERO rfi-created / snag-assigned invocations.
  SUPABASE_PAT=$SUPABASE_PAT node /tmp/suppress.mjs off      # option (a): clears suppress_all_outbound
                                                              # option (b): restores notify_rfi_email / notify_snag_email to the values captured in Step 5
  ```
  The re-read in the script prints every affected project with the gate back to its resting value; **check that output, do not assume it**. Record the send-log result, the flags' before/after, and which option the owner took in the PR body.

- [ ] **Step 10: Walk the flow from an empty state in the real UI, not from a deep link.** On a **throwaway project** with `notify_rfi_email = false` and `notify_snag_email = false` (both re-read with a `SELECT` after writing, per the `Prefer` trap), signed in as a `contractor`:
  1. Create the project → confirm its `project_settings` row arrived with a named `triage_owner_id`.
  2. Raise an RFI with no assignee and a due date of **today** → it appears in the triage owner's queue, `projects.rfis.assigned_to` now names them, and the due date is **not** today (item 2's +7 wd was computed instead).
  3. Assign it → `status` moves `triage → open`, ball-in-court is the assignee.
  4. Re-date it in the Inbox → `projects.rfis.due_date` follows, and the RFI page shows the same date.
  5. Respond → `status` moves to `answered`, ball-in-court moves to **the raiser** (improvement 4 — you, the contractor).
  6. As the contractor, close it → **allowed**, because you are the gatekeeper. Then repeat on a snag: as the raiser, attempt to close → **refused**, because the snag gatekeeper is the PM. Then, as the contractor, try to rename the RFI's work item **in the Inbox** (not the RFI page) → **refused** with "is mirrored from its source record" — the guard's exemption is depth-scoped, and this is the client-side half of probe 05b.
  7. Write a diary entry whose Delays box says `None` → **no work item appears**. Write one that says `Crane stood down` → one does.
  8. Delete the RFI → it does **not** error, its work item goes `void` with `void_reason = 'source deleted'`, it leaves the inbox, and its `work_item_events` survive.

  Then tear the project down and confirm zero residue. ⚠ Steps 5, 6 and 8 are the three that would have been silently broken by F8 (the respond and the close, refused on the source edit under item 2's guard) and F1 respectively, and none is reachable from a deep link into seeded data.

- [ ] **Step 11: Write the PR body.** It must carry, at minimum:
  - the claimed number (`00198`) and the `max(version)` + `origin/main` + open-PR readings that justified it, and the apply order agreed with #185;
  - **the two owner decisions** (Task 5½: `rfi` `gatekeeper_rule = 'creator'`; Task 20 Step 5: `suppress_all_outbound` option (a) or (b)) with the option taken and who took it;
  - the guard replacement: the `P0001` sentence item 2's guard produced on the contractor's RFI respond (Task 5½ Step 2), the `> 0` mutation reading, and the `diff` of section C′ against `00196:1509–1759` showing exactly two hunks;
  - the mutation-verification counts from Tasks 3, 4, 5, 5½, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 and 16;
  - the full rehearsal output from Task 17 Step 3 with its 109-name `assertions seen:` line, the four stateless probes' 49, item 2's ten `✓` lines with `00198` stacked, plus the deliberate single-arm break from Step 4;
  - the four item-2 fixtures retargeted in Task 15 Step 6b and the `23505` they produced before it;
  - the seven partial-unique index names (`work_items_src_*_uidx`) confirmed against production;
  - **the day-one list from Task 17 Step 7, all 34 lines**, and the duplicate-title finding raised against item 4;
  - the triage-owner decision from Task 19 and any overrides;
  - the `rfis_rfi_number_seq` before / after / restored readings from Task 15 Step 5;
  - the post-apply read-back from Step 8 and the send-log result from Step 9;
  - the eleven findings F1–F11 named explicitly, so a reviewer can disagree with them on the evidence rather than on the text;
  - the twelve folded-in improvements and the three deferred ones, so the owner can schedule what was not taken;
  - one sentence on the due-date floor's reach: the section H floor `UPDATE` rewrites `projects.rfis.due_date` (and bumps `updated_at`) on the open RFIs through the write-back, restorable from the snapshot's `due_date`/`updated_at` columns; and one on improvement 11 being one-way from the spine — an RFI-module `due_date` edit is **not** projected (the `_upd` trigger watches it but the UPDATE arm does not write it), consistent with `00196:1636–1640` making the reviewer the authority.

---

## What this item deliberately does not do

- **No trigger on `structure.node_orders`, and no backfill of its 440 rows.** `order_followup` is created only by the explicit chase control on an order line (A(b)) — **and no Q1 deliverable builds that control**, so Equipment & Materials contributes zero inbox rows for the whole quarter. That is recorded honestly in the Deferred table above and booked for Q4 beside `lead_time_days`; it is not hidden. `node_orders` carries no lead-time column (`00083:50-86`), so there is no defensible rule for which order is late. Backfilling 440 procurement items into an inbox that currently gets read 6% of the time is the single fastest way to prove the new inbox is also noise. A contract test fails the build if a trigger is ever added.
- **No write-back to `inspections.inspections.assigned_to_id`.** `00066`'s own flow stays the system of record; a third write-back is a third loop to reason about (§03 §1.2). The mirror still reads that column **forward**, which is a different thing.
- **No snag or diary rows in the backfill.** Both are measurement decisions, not scope cuts: every live snag is an `E-Site DEMO` fixture and every live "delay" says *None*. Both live triggers work; both spines simply start empty. The two synthetic fixtures in Task 14 Steps 6–7 exist so the arms can still fail.
- **No `variation_order` and no `handover_item`.** Zero rows today, and neither ships inside twelve months. Provision when there is a use.
- **No GCR projection.** Its rows are tenant apportionment records, not assignable acts; nobody is ever owed one.
- **No `qc_report` type.** Only failed entries on issued reports become `qc_defect`; mirroring every issued entry manufactures ~40 items from one 40-line report.
- **No client-viewer watchers, and no client-facing arm at all.** Rejected on the evidence in the Deferred table: it reproduces the fan-out behind 750 `diary_created` notifications at a 5.9% read rate, and A(c) puts those types on the Recap tier. The honest Q1 position is that item 3 delivers nothing to clients.
- **No un-projection path, and no un-void.** Nothing here deletes a work item. A source leaving scope (a diary delay edited away, a QC report re-opened) keeps its item; silently removing something from an inbox because prose changed is worse than one stale row, and the void path exists for the case that genuinely warrants it. `void` is terminal on the mirror side too (#3): an `abandoned` inspection that goes back to `re-inspect_required` does not un-void its item — that would re-enter inboxes with the old `void_reason` intact. A voided source that is genuinely revived is a new record.
- **No redefinition of item 2's resolvers.** `00195`'s `resolve_project_pm` and `00196`'s `resolve_work_item_assignee` are read, never replaced (#5): replacing either turns three of item 2's regression files red and strips its server actions of their contracted error. The mirror has its own `resolve_mirror_assignee` — no caller guard, `client_viewer` excluded — and the two deliberately disagree on client viewers (item 2's picker admits them; recorded in the matrix).
- **No notification writes, no `notification_types` row, no GUC consumer.** Item 2's §11 writes no bell and reads no GUC; item 4 adds both by `CREATE OR REPLACE` (`00196:1354–1356`). Section H's `SET LOCAL esite.suppress_notifications = 'on'` is kept because it is the GUC item 4 will honour, and the two "no bells" assertions are marked vacuous rather than deleted (#7, #8).
- **No watcher seeding.** §11 already seeds `created_by`, assignee and gatekeeper on INSERT and on every people change (#10). The one thing item 3 does to watchers is backfill-only: it removes a departed raiser §11 would otherwise have made a non-member watcher.
- **No `suppress_all_outbound` unless the owner takes option (a)** in Task 20 Step 5 (#6). `00195` did not add it; the plan carries both options and decides neither.
- **No `auth_events.session_id`.** A(f) books it here and §12 §(c) books it with the metrics migration; §12 §(c) is the later, more specific ruling and Task 18 amends A(f) rather than shipping the column twice.
