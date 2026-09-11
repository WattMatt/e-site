## Data model, migrations and technical architecture

### Schema placement

**Decision: no new schema is created for the six primitives. §10's `ai` schema in Q3 is the one exception, and it carries three obligations rather than being waved through.** Every primitive is project-scoped, so it belongs in `projects`, which is already in PostgREST's exposed list (`apps/edge-functions/supabase/config.toml:9`) and already carries the role grants and `ALTER DEFAULT PRIVILEGES` installed by `00025_grant_schema_permissions.sql:14-27`. The notification, presence and observability engine extends `public`, where `notifications`, `profiles`, `audit_log` and `auth_events` already live (`00001_initial_schema.sql:61,124`; `00019_notifications.sql`; `00038_auth_events.sql:13`). Nothing new goes in `field`, `inspections`, `structure` or `gcr`: those stay module schemas whose rows are *projected* into the spine. Appendix A(f) is the canonical inventory of what lands where, by quarter.

Two distinct hazards are frequently conflated and must not be:

1. **Creating a new schema requires a Management-API `PATCH /v1/projects/{ref}/postgrest` on `db_schema`.** Without it REST returns `PGRST002` indefinitely with no auto-recovery. Adding a plain column or a table to an already-exposed schema needs only `NOTIFY pgrst, 'reload schema'`. Avoiding a new schema avoids this class entirely.
2. **A new schema also needs a complete GRANT block, and a missing one produces the same `PGRST002` symptom from a different cause.** `00069_inspections_grants.sql:2-13` records exactly this: `00066` granted only schema `USAGE` to `authenticated` and `service_role`, missing `USAGE` for `anon` and *all* table and sequence privileges, and PostgREST's schema-cache rebuild failed with `PGRST002` across the entire REST API. It was a GRANT defect, not a config-PATCH failure. Both rules are real; each has its own signature.

**The `ai` exception, stated so it is not discovered at deploy time.** §10's Q3 schema pays both of the above — the config PATCH *and* a complete GRANT block covering schema `USAGE` for `anon`, `authenticated` and `service_role` plus all table and sequence privileges — and a third obligation neither hazard covers: `config.toml:9` today lists eleven schemas and does **not** include `ai` (verified), so without an edit to that line local dev and any fresh database diverge from production, and the divergence surfaces as a test suite that passes against a database the product does not run on. All three ship in the same PR as the schema, and the deploy verification reads the REST root back before anything else in Q3 is merged.

The corollary that bites every table this section proposes: `00025_grant_schema_permissions.sql:26` sets `ALTER DEFAULT PRIVILEGES IN SCHEMA projects GRANT SELECT ON TABLES TO anon` (verified), so **every new table in `projects` is born readable by `anon` at the grant layer**. RLS denies it in practice, but the precedent set by `00168_cable_schedule_security_hardening.sql:92-98` and followed by `00179_site_forms.sql:331-334` is to revoke it outright rather than let a policy be the only thing between `anon` and the rows. Every migration in this programme therefore ends with an explicit `REVOKE SELECT ON <new tables> FROM anon`, and its verification block asserts `has_table_privilege('anon', …, 'SELECT') = false` — never by reading `relacl`, where a NULL is not an empty ACL.

### (a) New tables and columns, by quarter

**Appendix A(f) owns the inventory.** This subsection does not restate it; it carries only the design arguments that belong to the data model and the columns whose *shape* is contested.

**Universal rule for every new project-scoped table in this programme:** it carries `id uuid PK`, `project_id uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE`, **`organisation_id uuid NOT NULL REFERENCES public.organisations(id)`**, `created_at`, and `created_by uuid REFERENCES public.profiles(id)`. The denormalised `organisation_id` is not redundancy for its own sake: it is the column rule 3 in §(b) pins in `WITH CHECK`, and the foreign-org walk it prevents is a real prior incident (a draft site form could be hopped into an org the author was not a member of, and handed to that org's client viewers). It also matches every existing table in the schema — `projects.qc_reports` (`00172_qc_reports.sql:60`), `projects.variation_orders` (`00135_project_variations.sql:9`), `projects.handover_checklist` (`00002_projects_schema.sql:184`), `projects.project_settings` (`00101_project_settings.sql:17`).

#### Q1 — the spine, the toggles, and honest instrumentation

**`projects.work_items` is defined once, in Appendix A(a), and this section does not restate its DDL.** §03 governs the spine; A(a) is its authoritative column set, constraint set and index set, and every argument below is written against it.

**The objection this section previously raised against a generated ball-in-court column is withdrawn, and the reason is recorded so it is not re-litigated.** The earlier text argued that "a `GENERATED` column cannot call a resolver", and that is true — but A(a)'s `ball_in_court_id` calls nothing. It is a `CASE` over three columns **of the same row** (`status`, `assignee_id`, `gatekeeper_id`), which is exactly what Postgres permits in a `STORED` generated column: no subquery, no function over other tables, no volatility. The objection is correct about a *different* design — one that derives the holder by walking child tables or a settings cascade — and that design is not what shipped. §08's `projects.resolve_ball_in_court()` is a separate function with a separate job: it supplies a non-null holder for the ten non-work-item `dated_items` kinds and passes `work_items.ball_in_court_id` straight through for `work_item_due`.

Three consequences follow for everything in this section, and they are load-bearing:

- **`assignee_id` is `NOT NULL`.** There is no unassigned arm anywhere in the data model, no null-assignee branch in the backfill, and no "unassigned" bucket in any query.
- **`due_date` is `NOT NULL`,** computed in working days by the `BEFORE INSERT` trigger against Appendix A(h)'s calendar. Every ordering, index and cursor in §(f) is written on a non-null date.
- **`ball_in_court_id` has no write path at all.** It is generated, so §(b) rule 4's attribution guard does not have to defend it — the class of forgery simply does not exist for that column.

Module statuses are **not** rewritten. `projects.rfis.status` (`00002_projects_schema.sql:88-89`), `projects.qc_reports.status` (`00172_qc_reports.sql:74-77`) and `field.snags.status` stay exactly as they are; the spine carries A(a)'s five-value `status` plus a display-only `source_status` mirroring the module's own vocabulary, and the mapping between them is a pure function in `@esite/shared` (§g).

| Object | The argument this section owns |
|---|---|
| `projects.work_item_events` | Append-only assignment and state transitions; feeds ball-in-court history, the activity feed and **three of the eight metrics** — metric 4, the ball-in-court-arrivals half of metric 5's denominator, and metric 7. It does **not** feed metric 1, which reads `public.user_sessions` + `public.product_events` through `public.metric_accounts` (§i, §15 §(a)). Written **only** by a `SECURITY DEFINER` append trigger, with a SELECT policy and no write policy — the shape at `00179_site_forms.sql:504-506`. |
| `projects.project_settings.enabled_modules text[]` | The module toggles are an array column on an existing row, **not a new table** (A(e)). Indexability is a GIN index on the array; attributability is already supplied by the `00102_project_settings_history` audit trigger, which records who changed what and when. A second table would have duplicated an audit trail the schema already keeps. |
| `projects.project_settings.triage_owner_id` | The default-assignee backstop. **Nullable**, per §03 §1.6: a `NOT NULL` column with no default would break project creation platform-wide, because `ensure_project_settings_row()` inserts only `(project_id, organisation_id)` (`00103_project_settings_backfill_and_autocreate.sql:19-30`). The same migration rewrites that function to resolve a default and backfills the 14 existing rows. The DB-level guarantee is `work_items.assignee_id NOT NULL`, not this column. |
| `public.notifications` column adds | §05 owns the **thirteen** columns of its `ALTER TABLE public.notifications` block — `project_id`, `actor_id`, `tier`, `dedupe_key`, `coalesced_count`, `hold_until`, `hold_extensions`, `delivered_at`, `seen_at`, `cleared_at`, `email_state`, `push_state`, `read_at_estimated` — plus the `notification_types` FK that replaces the CHECK, the `is_read` drop and the `notifications_own` replacement. Counted off that block, not off an older summary of it. **`done_at` is not among them and is not added here**: it lives on `public.inbox_state` alone (§04), which is what makes metric 5 a union rather than one expression (§f, §i). This section owns only the sequencing constraint in §(c). |
| `public.product_events` | Append-only product telemetry — the **event stream**. DDL and read policy in §(i); created in §15's Q1 metrics migration, the one that lands first (A(f), §c), alongside `user_presence`, `user_sessions`, `touch_presence()`, `public_holidays` and `calendar_years`. |
| `public.auth_events.session_id`, `public.product_events.session_id` | Correlates an event to a session row. `auth_events` today has no session identifier at all — its columns are `id, user_id, event_type, ip_address, user_agent, metadata, occurred_at` (`00038_auth_events.sql:13-31`). Nullable; existing rows backfill NULL. |

**Honest read tracking does not need a deliveries table.** The earlier proposal here — `public.notification_prefs`, `public.notification_deliveries` and `public.digest_batches` — is deleted. The argument behind it stands and is the right one: today `is_read` conflates "never delivered" with "delivered and ignored", and 57 reads on 964 rows tells us nothing. §05 answers it on the notification row itself, with **four server-stamped timestamps** — `delivered_at`, `seen_at`, `read_at`, `cleared_at` — all written through `SECURITY DEFINER` RPCs and **unwritable by the client**, because `notifications_own` is dropped and `authenticated` holds no INSERT/UPDATE/DELETE grant on the table. "We chose not to send" is `email_state`/`push_state = 'suppressed'` on the same row, and "the send ran at all" is `public.notification_dispatch_runs`, one row per dispatcher tick carrying `considered, sent, suppressed, deferred, failed`. Three tables' worth of distinctions, on one row plus a run log, with no join to keep in step.

#### Q2 — threads, mentions, activity, reply-by-email

Appendix A(f) carries the tables. Two arguments are this section's:

**`projects.activity` is a materialised feed table, not a `UNION ALL` view** — a union across four tables cannot use an index for cross-project ordering, and the feed is the second-most-hit query after the Inbox. §06 owns its DDL, RLS, `anon` revoke and its 24-month-then-rollup retention; it ships in **Q1**, not Q2, because the Recap tier writes to it and the diary reclassification is what removes 750 of 964 notifications. In Q2 it gains the thread and work-item triggers.

**An inbound reply address is a bearer credential arriving in plaintext headers, so only its HMAC is ever stored.** §05's scheme is `wi-<short_id>-<hmac10>@in.e-site.live`, the HMAC covering `kind|item_id|recipient_user_id` under a server-side secret; §06 §4.5 applies the identical rule to the instruction acknowledgement token. There is no `inbound_email_tokens` table — the address is derived and verified, not stored — and the only new inbound table is `field.inbound_messages` (A(f)), which lands in an already-exposed schema and therefore involves no config PATCH.

#### Q3 — report engine

Appendix A(f) carries `report_schedules`, `report_runs`, `approvals`, the transmittal tables and the period columns on `projects.reports` (`00117_report_export_branding.sql:44`).

**Decision: the report-kind → read-role registry stays in TypeScript, and Appendix A(d) is that registry.** From the Q3 harness port, `access.read` on the `ReportSpec` registry is the single source; `REPORT_KIND_READ_ROLES` and `OPEN_READ_REPORT_KINDS` are deleted, and `report-kind-access.contract.test.ts` is repointed at the registry, keeping its scanner guard. The DB backstop stays — a RESTRICTIVE policy calling `public.user_can_read_report_kind()`, with `public.report_kind_is_sensitive()` held in lockstep by a second test. **A DB registry *table* is rejected for the same reason it always was: a row insert would grant access to a class of report without a code review.** Note for any reader on an older branch: both the TypeScript module and migration `00183` shipped in PR #162 and are **not present in this working tree**, whose migration directory ends at `00182_site_form_response_provenance.sql` (verified).

#### Q4 — calendar and programme

**Appendix A(f) governs: `projects.calendar_entries`, `projects.milestones`, the `dated_items` view (`security_invoker = true, security_barrier = true`) and `projects.resolve_ball_in_court()`.** The earlier proposal in this section — `calendar_events`, `programme_tasks` and `programme_links`, with an RFC 5545 `recurrence_rule` subset, baseline dates, `percent_complete` and four FS/SS/FF/SF link types — is deleted in full. It was a critical-path scheduling engine, which is a different product from a three-week lookahead over things that already have dates; §08 owns the design and A(f) owns the tables.

### (b) RLS, grants and function security

Every new table follows the shape `00179_site_forms.sql` settled on, which is the house pattern.

1. **Permissive SELECT** keyed on `public.user_has_project_access(project_id)` plus a role predicate resolved through `public.user_effective_project_role` (`00107_user_effective_project_role.sql:30-66`) — never `user_is_client_viewer`, which reads only `public.user_organisations` and is blind to project-scoped client viewers (`00179_site_forms.sql:439`).
2. **RESTRICTIVE gates** for anything a client viewer or contractor must not see — cost-bearing work items and valuation threads. The cost-bearing set is `projects.cost_bearing_item_types()`, which today returns exactly `valuation` (Appendix A(b), Q4) and is a function rather than a literal so widening it is one edit in one place. This follows the `user_can_read_report_kind()` precedent and the RESTRICTIVE construction at `00171_markup_write_roles_rls.sql:120,128,141`. A restrictive policy is the only construct that cannot be widened by a later permissive policy someone adds in a hurry.
3. **INSERT `WITH CHECK` binds `organisation_id` to the project's own org**: `organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)`. Every table in §(a) has the column precisely so this predicate is writable.
4. **Attribution pinned to the caller**: `author_id = auth.uid()`; `assignee_id` and `gatekeeper_id` change only through the transition trigger. Otherwise the append-only history records a forgery as fact. `ball_in_court_id` needs no rule at all — it is a generated column and cannot be written by anyone, which is one of the reasons A(a) generates it rather than maintaining it.
5. **Grants — two separate obligations, routinely confused:**
   - **Functions:** `REVOKE ALL ON FUNCTION … FROM PUBLIC` **and** `REVOKE EXECUTE ON FUNCTION … FROM anon`, then `GRANT EXECUTE … TO authenticated, service_role`. The `anon` revoke is not optional and not implied: Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` EXECUTE *directly* at creation, which is a separate grant that `FROM PUBLIC` does not touch. The precedent is `00113_lock_rbac_function_grants.sql:15-24`, which pairs every `FROM PUBLIC` with a `FROM anon`. **`00179:314-323` is not the precedent** — it revokes only from PUBLIC on all seven of its functions and never names `anon`. Verify with `has_function_privilege('anon', oid, 'EXECUTE')`, never by reading `proacl`: a NULL `proacl` looks empty but **is** the PUBLIC grant.
   - **Tables:** `REVOKE SELECT ON <new tables> FROM anon`, because of the `00025:26` default privilege. Precedent `00168:92-98`. Verify with `has_table_privilege('anon', …, 'SELECT')`.
6. **Helper functions are `STABLE SECURITY DEFINER … SET search_path … SET row_security TO 'off'`**, and **never use `current_user` for authorisation** — inside `SECURITY DEFINER` it resolves to the function *owner*, which is what made the first site-form transition trigger silently inert (`00179:341-346`). Any role test whose predicate can yield NULL for a non-member is `COALESCE`d to FALSE, because `NULL IN (…)` is NULL.
7. **Two triggers on `work_items`, with different security contexts, and the difference is load-bearing:**
   - The **guard** trigger (which status transitions are legal, who may make them) is **`SECURITY INVOKER`** — the default — for the reason spelled out at `00179:341-346`: under `SECURITY DEFINER` its trusted-role exemption would be true for every caller. It needs no elevated rights; it reads `OLD`/`NEW` and calls a `SECURITY DEFINER` helper.
   - The **append** trigger that writes `projects.work_item_events` is **`SECURITY DEFINER` with `SET search_path`** and `REVOKE ALL … FROM PUBLIC`, exactly as `field.append_form_response_history()` is (`00179:192-194`). This is what lets `work_item_events` carry a SELECT policy and **no write policy** (`00179:504-506`); a `SECURITY INVOKER` append trigger would hit RLS as the calling user and the first assignment change would fail with a row-level-security violation. Attribution inside it comes from `auth.uid()`, never `current_user`.
8. **The `WITH CHECK` independently re-states the management gate** so the guard does not rest on the trigger alone. Page-level gating is never a gate: server actions and `app/api` routes are directly invocable, so every rule above is enforced in the app **and** in the database.

Four new helpers, all following rule 5: `projects.user_can_read_work_item(uuid)`, `projects.user_can_write_work_item(uuid, text)`, `projects.user_can_read_thread(uuid)`, and `projects.my_project_roles()` (see §f).

### (c) Migration sequencing and the numbering-race protocol

**Migration numbers are claimed at merge, never reserved in advance and never written down here** (Appendix A(f)). A reserved block is a comfortable fiction: reserving 00190–00209 for a quarter does not stop two sessions inside that quarter from both picking 00191, which is precisely how two `00183`s and two `00184`s shipped in a single week. Migrations are identified in planning by quarter and ordinal, and a number is attached to a file only at the moment of merge, under this protocol.

**Protocol, mandatory:**

1. Immediately **before applying** — not when branching — re-read `max(version)` from `supabase_migrations.schema_migrations` **and** `origin/main`'s migration directory. Both, because either can have moved.
2. Announce the number to peer sessions before writing the file.
3. Every migration header carries a fenced, machine-readable verification block in exactly this form, one object per line:

   ```
   -- @verify:begin
   -- table: projects.work_items
   -- table: projects.work_item_events
   -- function: projects.user_can_read_work_item(uuid)
   -- policy: work_items_select ON projects.work_items
   -- constraint: work_items_one_source ON projects.work_items
   -- index: work_items_inbox_idx ON projects.work_items
   -- grant_absent: anon SELECT ON projects.work_items
   -- grant_absent: anon EXECUTE ON projects.user_can_read_work_item(uuid)
   -- @verify:end
   ```

4. After deploy, `scripts/verify-migration-applied.ts` parses that block and queries `information_schema.tables`, `pg_proc`, `pg_policy`, `pg_constraint`, `pg_indexes`, `has_table_privilege` and `has_function_privilege`, exiting non-zero on any absence or any surviving `anon` privilege. **A green `Deploy DB Migrations` is not evidence a migration ran** — `supabase db push` keys on the version *prefix*, so a number already in the ledger makes it print "Remote database is up to date", exit 0 and skip the file.
5. **CI fails a PR whose migration number is ≤ `max(version)` on `origin/main` *or* already claimed by any other open PR.** The second half is not redundant: `≤ max(version)` only catches a number the ledger has already absorbed, and the failure mode that actually happened was two concurrent sessions each picking the same *free* number and each passing that check independently. The added rule enumerates open PRs' migration filenames through the GitHub API and fails on a collision, naming the other PR — which is the only signal available before either merges.
6. Renumbering after a collision is a ledger operation as much as a rename: reconcile `schema_migrations` to the filenames on main after independently verifying each migration's *effect*, or `db push` stays blocked for everyone.

**Appendix A(f) owns the migration inventory — what is created, in which schema, in which quarter — and this section neither restates it nor re-orders it.** An earlier draft of §(c) carried its own numbered Q1 list, which is exactly how four sections came to publish four different homes for the same objects. §05's hardening of `project_notification_recipients()` is Q1's first migration and is booked in A(f) with everything else. What §12 owns is the protocol above and the dependency constraints below, which any order A(f) carries must satisfy.

**Five hard dependencies in Q1. They are constraints, not preferences:**

1. **`public.notification_types` and the `notifications.type` FK (`NOT VALID`, validated after seeding, seeded per Appendix A(c)) land before any trigger that can emit `work_item_assigned`.** The bell path swallows every failure by design (§e), so a rejected type writes no row *and no error* — every backfill bell would vanish silently. §03 §1.10's wholesale re-declaration of `notifications_type_check` runs inside that migration and is the **last** one in the platform's history; after the FK lands, a new type is an INSERT.
2. **`project_settings.enabled_modules`, its `project_settings_modules_known` `<@` CHECK, its GIN index and its seeding from live data (§d) precede both the sidebar and the RESTRICTIVE module gates**, and the seeding step runs before the OFF-by-default column default can hide live data.
3. **`project_settings.triage_owner_id` (nullable, §03 §1.6), the `ensure_project_settings_row()` rewrite and the 14-row backfill precede the first work-item insert**, or `assignee_id NOT NULL` fails mid-backfill on the projects with no assignee anywhere.
4. **`projects.public_holidays`, `calendar_years` and `working_days_between` (Appendix A(h)) precede the spine.** `due_date` is `NOT NULL` and its `BEFORE INSERT` trigger computes working days, which raises `no_data_found` on an unseeded year rather than silently falling back to calendar days. They are created **once**, in §15's Q1 metrics migration — the one that lands first — and not again in the spine's migration or the notification group.
5. **The projection triggers exist before the backfill runs, and they cover the six automatic Q1 sources of A(b) — `rfis`, `snags`, `qc_entries`, `inspections`, `site_diary_entries`, `site_forms` — and only those.** `structure.node_orders` gets **no trigger**: `order_followup` is created solely by the explicit chase control on an order line (A(b); §(d) below; §13 item 3). Triggers-before-backfill is what makes a retry idempotent through the partial UNIQUE per source column; a seventh trigger on `node_orders` would ship the automatic path A(b) forbids and project 265 live procurement rows into inboxes on day one — the backfill poisoning §13 names as a risk and §(d) refuses.

**`public.user_presence`, `public.user_sessions` and `touch_presence()` are created by §15's Q1 metrics migration and by nothing else here** — not by the notification engine, not by the spine, not by a late telemetry migration. `public.auth_events.session_id` is a column add on an existing table and rides with that migration too. The only thing deliberately late in Q1 is the backfill-completion event itself, written into `public.product_events` after §(d) finishes, because it records that the backfill happened.

**Three ordering constraints belong to the later quarters; the inventory for those is A(f)'s as well.** In Q2, `work_items.instruction_recipient_id` lands with **both** of A(a)'s CHECKs re-declared wholesale in the same statement, because `DROP CONSTRAINT` discards the other one silently. In Q3, the `reports_one_issued` partial unique index is built only after the duplicate count returns zero, and the `ai` schema ships its config PATCH, its complete GRANT block and its `config.toml:9` edit in the same PR as the schema itself. In Q4, `projects.resolve_ball_in_court()` precedes the `dated_items` view that calls it.

### (d) Backfills

The live estate is small, which is the trap: 15 RFIs, 6 snags, 18 inspections, 1 site form, 11 QC rows in the last 30 days — roughly **50 work items**. A backfill that passes on 50 rows proves nothing about 50,000, so the script is also exercised against a synthetic 50,000-row fixture before it touches production.

Type keys, gatekeepers and default due days are Appendix A(b)'s; this table carries only how each source's rows resolve. `go_live` is the Q1 release date, passed to the migration as a literal (`DATE '2026-11-03'`, §03 §1.10), and every due date is floored at `go_live + 5 working days` on the `office` calendar so a first inbox is not entirely red.

| Source | Type | Assignee resolution | Due date |
|---|---|---|---|
| `projects.rfis` (15, `assigned_to` NULL on all) | `rfi` | `assigned_to` → `project_settings.default_rfi_assignee_id` (`00101_project_settings.sql:29`) → `triage_owner_id` → org owner | `due_date` if set, else `created_at + 7 wd`, floored at `go_live + 5 wd` |
| `projects.qc_entries` with `conformance = 'fail'` (`00176_qc_conformance_and_hardening.sql:53-61`) on parent reports with `status IN ('issued','closed')` (`00172_qc_reports.sql:74-77`) | `qc_defect` | `created_by` (`00172:119`, NOT NULL) → `triage_owner_id` → org owner | `created_at + 5 wd`, floored |
| `field.snags` (6) | `snag` | `assigned_to` → `raised_by` (`00004_field_schema.sql:22-23`) → `triage_owner_id` → org owner | `created_at + 5 wd`, floored |
| `inspections.inspections` (18, all `assigned`, zero responses) | `inspection` | `assigned_to_id` (`00066_inspections_module.sql:54`) → `triage_owner_id` → org owner | `scheduled_at::date` if set, else `created_at + 3 wd`, floored |
| `field.site_forms` (1) | `form_action` | `created_by` → `triage_owner_id` → org owner | `created_at + 3 wd`, floored |
| `projects.site_diary_entries` (53) | `diary_action` — **only the 6 carrying non-empty `delays` (`00002:154`) or `delay_notes` (`00017:18`)** | entry author → `triage_owner_id` → org owner | `entry_date + 2 wd`, floored |
| `structure.node_orders` (265 rows in 30 days) | `order_followup` — **no bulk backfill, no automatic path and no projection trigger** (§c constraint 5) | n/a | n/a |

**Every chain in that table terminates at the org owner, never at `triage_owner_id`.** The column is nullable by decision (§03 §1.6, §(a) above), so a chain that stopped there could hand NULL to `assignee_id NOT NULL` and abort the backfill on precisely the projects that most need triaging. The full chain the mirror trigger walks, and the backfill with it, is §03 §1.6's: explicit assignee → per-type `work_item_defaults.<type>.triage_owner_id` → project `triage_owner_id` → the §03 §1.5 PM resolver → the org owner. The terminal step is the one that makes the nullable column safe.

**`order_followup` is deliberately not backfilled.** `structure.node_orders` has no lead-time column (`00083:50-86`), so there is no defensible rule for which of 265 orders is late; items are created only on explicit chase, one control on the order line (A(b), §03 §1.10). A lead-time column and a lapse rule are Q4 programme work. Backfilling 265 procurement items into an inbox that currently gets read 6% of the time is the single fastest way to prove the new inbox is also noise.

**`qc_defect` mirrors failed entries only.** A QC report is a checklist: mirroring every issued entry would manufacture ~40 inbox items from one 40-line report — the poisoning A(b) refuses, and the reason `qc_report` is not a registered type.

**The failed-entry predicate is expressible today, and this is verified against the tree rather than inferred from one file.** `00172_qc_reports.sql:110-125` creates `projects.qc_entries` with `title, description, sort_order, created_by` and no verdict — but that is the **pre-`00176`** CREATE TABLE, and `00176_qc_conformance_and_hardening.sql` is in this working tree, whose migration directory runs to `00182_site_form_response_provenance.sql` (verified). `00176:53-71` runs `ALTER TABLE projects.qc_entries ADD COLUMN IF NOT EXISTS conformance TEXT NOT NULL DEFAULT 'na'` and `ADD COLUMN IF NOT EXISTS severity TEXT`, then adds the named CHECKs `qc_entries_conformance_check` (`pass | fail | na`) and `qc_entries_severity_check` (`NULL | minor | major | critical`) and the `(report_id, conformance)` tally index. An earlier draft of this section read the column list off `00172` alone and asserted the columns were absent; **that assertion was false, and the abort clause built on it is withdrawn** — it would have made the Q1 `qc_defect` mirror, which A(b) registers unconditionally and §03 §1.10 specifies with `severity` mapped onto `priority` (`minor→low`, `major→high`, `critical→critical`), conditional on a fact that is not in doubt.

The pre-flight assertion is kept, restated as **a check expected to pass**: the migration opens by asserting `conformance` and `severity` exist on `projects.qc_entries` and both named CHECKs are present in `pg_constraint`, citing `00176:53-71`. It exists to catch a rollback or a diverged branch, not to gate the feature, and there is no fallback to mirroring every entry.

**`variation_order` and `handover_item` are not backfilled and not registered.** Both hold zero rows today, and after the Q4 re-plan neither ships inside the twelve months. The previous instinct here — map them anyway "so the projection exists before first use" — is the wrong lesson from the right incident: the pattern worth avoiding is a module whose first live row is the moment its defects surface, and the remedy for that is verifying from the empty state (§h), not provisioning a projection for a feature that does not exist. Provision when there is a use.

**GCR is a decision, not an omission: Generator Cost Recovery is a project-level module, not a work-item source.** Its 20 rows in the last 30 days are tenant apportionment records, not assignable acts; nobody is ever "owed" a GCR row. It gets the `generator_cost_recovery` toggle token (A(e)) and nothing in `work_items`.

**Expect all 15 RFIs to resolve to `triage_owner_id`, not to a project default.** `rfiService.create` already applies the `default_rfi_assignee_id` fallback (`packages/shared/src/services/rfi.service.ts:75-83`), and all 15 live RFIs are still NULL — which means the column is unset on the projects that hold them. Nobody should expect otherwise, and nobody should read the resulting concentration on WM's triage owner as a bug in the cascade.

**The backfill runs under notification suppression.** Every one of these inserts fires the transition trigger, which emits `work_item_assigned`; the overdue sweep would immediately classify the July-dated RFIs as overdue. Against a user base where 964 notifications have produced 57 reads and no contractor has signed in for 30 days, a burst of ~50 assignment bells plus overdue bells plus a 07:00 recap listing 50 stale items is exactly the failure mode this roadmap exists to reverse. The projection therefore runs with `SET LOCAL esite.suppress_notifications = 'on'`, which the append trigger reads via `current_setting('esite.suppress_notifications', true)`: `work_item_events` rows are still written (the metrics need them), but no `public.notifications` row is created. **The first recap after go-live carries only items whose events post-date the backfill timestamp**, recorded as `product_events.properties->>'backfill_completed_at'`.

⚠ **That GUC does not cover outbound mail.** It is transaction-scoped and read inside SQL; the RFI email path is an application-side `fetch` outside the transaction (§03 §1.10). `projects.project_settings.suppress_all_outbound` must be set on any project touched by a write-back, and the send log read back afterwards to prove the path inert.

**Module toggles are seeded from live data, before the OFF-by-default defaults ship.** An `enabled_modules` array left at its column default would hide the 20 live GCR rows and the one live site form from the projects that own them. The seeding step runs inside the same migration that adds the column (§c constraint 2) — the five default-ON tokens are already in the column default, so only the OFF tokens are seeded:

| Token | Added to `enabled_modules` where the project has ≥1 row in |
|---|---|
| `generator_cost_recovery` | `gcr.*` keyed on `project_id` |
| `forms` | `field.site_forms` |
| `jbcc` | `projects.jbcc_letters` ∪ `projects.jbcc_notices` (project-scoped rows) |
| `handover` | `projects.handover_checklist` |
| `medium_voltage` | `cable_schedule.mv_study_settings` ∪ `cable_schedule.fault_sources` |

**Marketplace is not seeded, because it is not a token.** It is org-level — orders key on `contractor_org_id` — and A(e) removes it from navigation rather than toggling it per project; its tables, its seven `(marketplace)` pages and the two April orders are untouched. The seeding query set is asserted by a test that fails if any token's detection query returns zero projects while its underlying table holds rows.

One pre-existing inconsistency the projection absorbs: `inspections.inspections.assigned_to_id` references `auth.users` (`00066:54`), while `projects.rfis.assigned_to`, `field.snags.assigned_to` and `projects.qc_reports.raised_by` reference `public.profiles`. `work_items.assignee_id` references `public.profiles`, and the two ids are the same UUID — `public.profiles.id` **is** `auth.users.id` (`00001:62`) and `handle_new_user` creates a profile for every auth user (`00001:77-92`). The one edge case, an auth user with no profiles row, is handled by an INNER JOIN in the backfill and by the `NOT NULL` FK on the mirror.

### (e) Registering a notification type

The bell path never throws: `notifyEntityEvent` swallows every failure by design (`apps/web/src/lib/notify.ts:30-64`), so a CHECK violation writes **no row and no error**. Four bell types shipped broken for months before `00173` found them. The constraint was **declared once and re-declared wholesale five times** — `00066_inspections_module.sql:654` created it (its own header records that no prior CHECK existed), and `00072` → `00173` → `00176` → `00178` → `00179:596` each dropped and re-added it — with every re-declaration restating the entire set, because `DROP CONSTRAINT` discards the previous one wholesale. Five re-declarations after one original, which is §03 §1.10's count and the one this section uses.

**That procedure ends in Q1.** §05 replaces the constraint with `public.notification_types` and an FK from `notifications.type`, seeded per Appendix A(c) — the enumerated constraint set UNION the live `SELECT DISTINCT type`, 18 values verified at `00179_site_forms.sql:596-621`. One wholesale re-declaration remains, in the migration §(c) constraint 1 governs, and it is the sixth and last in the platform's history. After it, the procedure for adding a type is:

1. Add the type to the shared registry in `@esite/shared` **with its tier** — Immediate, Held or Recap (A(c)). A type with no tier cannot be routed by the dispatcher.
2. `INSERT` one row into `public.notification_types` carrying `tier`, `default_audience`, `always_fires`, `module` and `is_active`. No `DROP CONSTRAINT`, no restatement of anything that came before, and no possibility of silently discarding a peer session's type.
3. A contract test asserts set equality **in both directions** between the shared registry, `public.notification_types` and Appendix A(c) — so neither a stray row, an untiered registry entry, nor a type the appendix does not carry survives.
4. Deploy verification inserts one row of each new type in a rolled-back transaction. **Because the insert path is silent, this is the only proof.** The FK inherits the CHECK's failure mode exactly unless the dispatcher validates `type` before insert and rejects an unknown one with a 400 rather than a swallowed error — which §05 does, writing every failed insert to `public.notification_dead_letters`.

Appendix A(c) is the registry; no quarter's type list is restated here.

### (f) Performance and retention

**The Inbox must not evaluate a role function per candidate row.** `public.user_effective_project_role` is `STABLE SECURITY DEFINER` and runs two subqueries per call (`00107_user_effective_project_role.sql:30-66`); in an RLS predicate on a cross-project scan it is evaluated per row.

**Decision: Inbox and My Work are served by one `SECURITY DEFINER` RPC, `projects.inbox_for_user(p_cursor, p_limit)`, which re-applies the read gate inside its own body against a per-caller role set materialised once.** The body opens with `WITH me AS (SELECT project_id, effective_role FROM projects.my_project_roles())` — a `STABLE SECURITY DEFINER` set-returning helper that resolves the caller's effective role on every project they can reach, one row per project, evaluated exactly once per call. The scan is then `work_items wi JOIN me ON me.project_id = wi.project_id`, filtered on `wi.ball_in_court_id = auth.uid()`, with the cost-bearing gate stated explicitly in the body:

```sql
AND NOT (wi.item_type = ANY (projects.cost_bearing_item_types())
         AND me.effective_role <> ALL (projects.cost_view_roles()))
```

This is not belt-and-braces. **A `SECURITY DEFINER` function owned by the table owner bypasses RLS by ownership, whether or not `row_security` is set to `'off'`** — so inside this RPC the RESTRICTIVE policies of §(b) rule 2 do not run, and the in-body predicate is the *only* gate. Routing the front door of the product through a DEFINER function with a bare `ball_in_court_id = auth.uid()` predicate would rebuild, deliberately, the role-blind saved-report read that PR #162 had to close. `REVOKE ALL … FROM PUBLIC`, `REVOKE EXECUTE … FROM anon`, `GRANT EXECUTE … TO authenticated`. A test signs in as a client viewer who is ball-in-court on a cost-bearing item and asserts `inbox_for_user` returns **zero rows for that item** while still returning their non-cost items.

**Pagination is keyset, never `OFFSET`, and the cursor is two-part.** `ORDER BY due_date ASC, id ASC`, cursor `(due_date, id)`. There is no NULLS ordering and no three-part tuple, because `due_date` is `NOT NULL` (A(a)) — the null-boundary problem the earlier design solved does not exist, and inventing a `NULLS LAST` clause would only mask an index that no longer matches the sort.

**The `work_items` index set is Appendix A(a)'s and is not restated here.** The indexes this section owns are the ones on tables A(a) does not cover:

| Index | Table | Rationale |
|---|---|---|
| `(work_item_id, created_at)` | `work_item_events` | Item history; also the scan behind metrics 4 and 7. |
| `(project_id, created_at DESC)` | `activity` | Project feed, keyset (§06 owns the table). |
| `(occurred_at DESC)` and `(actor_id, occurred_at DESC)` | `product_events` | Metric rollups and per-user activation. |
| GIN `(enabled_modules)` | `project_settings` | "Which projects have JBCC on", answered without a second table (A(e)). |
| `(project_id) WHERE status = 'running'` | `tenants.cloud_sync_runs` | The in-flight guard, which currently scans on the general index. |

The previously proposed partial index on `notifications (user_id, created_at DESC) WHERE is_read = false` is **deleted**: §05 drops the `is_read` column outright and rebuilds `idx_notifications_user_unread` as `(user_id, created_at DESC) WHERE read_at IS NULL`. Two partial indexes on the same table keyed on two different unread definitions is how the definitions drift.

**`tenants.cloud_sync_runs` holds 22,488 rows** and grows on every tab-open auto-sync as well as the 15-minute cron. Its useful index exists (`idx_cloud_sync_runs_project` on `(project_id, started_at DESC)`, `00148_floor_plan_versions_cloud_sync.sql:116`). Without retention this is the first table that makes the floor-plans tab slow, and it holds nothing older than a quarter that a rollup does not.

`idx_cloud_sync_runs_org` (`00148:117`) is **kept unless production says otherwise**: the table's only SELECT policy is `organisation_id = ANY(public.get_user_org_ids())` (`00148:120-122`), which is exactly the predicate an `(organisation_id)` index serves. Read `pg_stat_user_indexes.idx_scan` for it on production immediately before the retention migration; drop it in that same migration only if the scan count is zero.

**Retention, for every append-only object the programme creates.** `cloud_sync_runs` was the only table with a retention plan, and it is not the fastest-growing thing here. Each rule below is a `pg_cron` job that writes a run row of its own, so a purge that stops running is caught by A(c)'s `job_missed` notification rather than discovered as a slow query eighteen months later.

| Object | Detail retention | What survives, and why |
|---|---|---|
| `projects.work_item_events` | **Never purged** | It is the ball-in-court history and the source of metrics 4, 5's ball-in-court denominator, and 7. It dies only with its project, by cascade. ~5–10 rows per item on a live estate of tens of thousands of items is small; the growth risk here is imaginary and the audit loss would not be. |
| `projects.activity` | 24 months, then a monthly rollup **in the same table** | §06 owns the sweep: one row per `(project_id, month, verb)` with `actor_id = NULL` and counts in `payload`, so "142 diary entries, March 2027" stays true forever. A(f) carries no `activity_monthly`, and §(h) **test 8** — the new-object inventory diff — would fail one. |
| `public.product_events` | 24 months | The weekly snapshot in `platform_metrics_weekly` is permanent, so purging detail loses re-derivation, never a published number. Any metric that needs raw events older than 24 months is a metric that has been redefined, and §15's `method_version` discipline requires new rows for that anyway. |
| `public.user_sessions` | 24 months | Same argument, same pair. `public.user_presence` is current-state, one row per user, and is never purged. |
| `public.notifications` | 12 months after `read_at` **or** `cleared_at` | Unread and uncleared rows are **never** purged — they are somebody's outstanding work. The rule keys on two timestamps and not three because **there is no `done_at` on this table**: §05's `ALTER TABLE` adds `delivered_at`, `seen_at` and `cleared_at`, and `done_at` exists on `public.inbox_state` alone (§04). That is precisely why metric 5 is a **union over both halves of the Inbox** and not one expression over notifications — the event half contributes rows created that week whose `read_at` or `cleared_at` is set, and the state half contributes separately (next row). §15's weekly snapshot preserves the rate before any purge reaches the detail. |
| `public.inbox_state` | **Never purged**; a row dies with its work item or its user, by the `ON DELETE CASCADE` on both FKs (§04) | It is the state half of the Inbox and the source of metric 5's `done_at` numerator, so a dated purge would silently deflate the auto-done-without-read share §15 reports as a **success** rather than a miss. Rows are written lazily — only on snooze, open or dismiss — so the table is a fraction of users × items, and its growth is bounded by the spine's. |
| `public.notification_dispatch_runs` | 90 days detail, then one summary row per day | The dispatcher ticks **every five minutes** (§05 §(b); §15 §(b2)'s ledger prices the job at that cadence against a 15-minute staleness threshold), and it writes a row on **every** tick including one that did nothing — so this is ~288 rows a day, **~105 000 a year**, for a table whose only question is "did the dispatcher run and what did it decide". 90 days is far longer than `job_missed`'s threshold needs. |
| `public.recap_runs` | 24 months | ~11,000 rows a year at current headcount. It answers "why did I not get a recap?", which is asked about last month, not last decade. |
| `public.notification_dead_letters` | 180 days | Each row is a bug. They are rare, and one that is still there at 180 days has been ignored, which is its own signal. |
| `field.inbound_messages` | Raw MIME 90 days (§05); body text and verdict columns retained with the item | The 90 days of raw MIME is what settles "my reply never arrived"; the body is the record of what a person said and outlives the envelope. |
| `ai.runs`, `ai.drafts` | Project-scoped rows cascade with the project; org-scoped rows with a NULL `project_id` purge at 180 days (§10) | Nothing cascades a null-project row, so a dated purge is the only mechanism that works. |
| `projects.report_runs` | 24 months | Retained with its schedule; a failed run older than that has been superseded by every run since. |
| `tenants.cloud_sync_runs` | 90 days detail, plus a `tenants.cloud_sync_daily` rollup via `pg_cron` at 02:00 SAST | As above. |

### (g) Shared-package boundary

`@esite/shared` holds everything pure, so the parked Expo app can consume the primitives when it is unparked.

| In `@esite/shared` | In `apps/web` |
|---|---|
| Work-item type registry (A(b)), source-status → `status` mapping, the ball-in-court `CASE` mirrored for optimistic UI, due-state computation, `working-days.ts` (A(h)) | Server actions, Supabase clients, `require-role.ts` gates |
| Notification type + tier registry (A(c)), coalescing keys, presence-suppression rules | `notify.ts` dispatch, the two cron route handlers, edge-function invocation |
| Mention parsing, thread participant derivation | Inbound-email webhook handling |
| The `ReportSpec` registry incl. `access.read` (A(d)), report payload builders | `react-pdf` / `pdf-lib` renderers, `winAnsiSafe` call sites |

The ball-in-court mirror in TypeScript is a **mirror, not a second source**: the database column is generated and authoritative, the TS function exists only so an optimistic UI can predict the next holder before the round trip, and a contract test asserts the two agree over a fixture covering all five statuses.

Hard rule, already load-bearing: nothing re-exported from the `@esite/shared` barrel may import `next/*`, `react-pdf`, `pizzip`, `docxtemplater` or `node:fs` at module init. `Sidebar.tsx` imports `OWNER_ADMIN` from the barrel, so a heavy transitive import crashes the admin layout — the precedent documented at `packages/shared/src/index.ts:33-38`. Heavy modules ship as sub-path exports.

**The TypeScript boundary is necessary but not sufficient for mobile, and this section does not pretend otherwise.** The Expo app does not read through PostgREST — it syncs through PowerSync (`apps/mobile/package.json:22`). Two further pieces of work stand between these primitives and a mobile Inbox:

1. `work_items`, `work_item_events`, `notifications`, `threads` and `thread_messages` must be added to `supabase/powersync/sync-rules.yaml`, bucketed on the existing `project_ids` JWT claim in the `project_access` bucket. PowerSync classic Sync Rules parameter queries are single-table with no JOINs, which is exactly why project access had to be pushed into a JWT claim in the first place (`00164_powersync_jwt_project_access.sql:6-11`).
2. The Inbox must be expressible as a **local query over the synced `work_items` bucket**, because a cross-project `SECURITY DEFINER` RPC has no PowerSync equivalent at all. This is an independent argument for A(a)'s `ball_in_court_id` being a **`STORED`** generated column rather than a virtual one or a view: a device can sort and filter on it offline, with no server round trip and no resolver to reimplement in the client.

**This work is out of scope for all four quarters**, and the approved frame publishes no app store. The boundary is drawn so that unparking the app is possible, not so that it is free.

### (h) Testing strategy

Eight tests, each parsing the constraint or the registry out of the source rather than restating it — the shape proven by `apps/web/src/lib/snag-photo-type.contract.test.ts:38-44`, which reads the CHECK set out of the SQL and fails naming the offending file and line.

1. **Work-item types: set equality in both directions between Appendix A(b), `projects.work_item_types` and every `item_type` literal in application code.** A key in code and not in the appendix fails; a key in the appendix and not registered fails.
2. **Notification types: set equality in both directions between Appendix A(c), `public.notification_types` and the shared registry**, and every type declares a tier.
3. **Report kinds: set equality in both directions between Appendix A(d) and the `ReportSpec` registry**, with a second assertion that `public.report_kind_is_sensitive()`'s SQL list equals the set of kinds whose `read` is narrower than project access. The existing scanner guard in `report-kind-access.contract.test.ts` is kept and repointed.
4. **Route coverage:** every new route under `app/api` or a route group appears in `docs/rbac-matrix.md` with the gate Appendix A(g) states; auth-surface changes and new bearer credentials appear in `CONFORMANCE.md`.
5. **Migration hygiene:** every migration in the programme carries a well-formed `-- @verify:` block, and every object it creates appears in that block. This test is what makes §(c) item 4 executable.
6. **Accessibility:** an automated `axe-core` pass over `/inbox`, `/my-work`, the capture routes and `/portal/[projectId]`, **failing the build on any serious or critical violation.** §04 §(e) sets the standard — WCAG 2.2 AA on every new surface — and this is where it is enforced rather than aspired to. The pass does not catch focus trapping or focus restore on the peek panel; those are checked by hand, and saying so is part of the rule.
7. **Module tokens: set equality in both directions across four places at once** — Appendix A(e), the token array exported from `@esite/shared` that `requireModule()` and the settings UI both read, the `project_settings_modules_known` `<@` array CHECK parsed out of its migration (§04 §(f) carries the DDL), and the set of write-entry tables carrying the RESTRICTIVE module gate. Ten tokens today. A token in code and not in A(e), in A(e) and not in the CHECK, or a gated write-entry table whose token is unregistered, each fails the build naming the file and line. **This is the test §04 §(f) and §06 §4.9 cite** when they rule that a stray token — `instructions`, `transmittals` — cannot be declared without failing CI, and it did not exist until now; adding it is what makes those two rulings enforceable rather than stated.
8. **New-object inventory: every table, view and function a programme migration creates appears in Appendix A(f) under that migration's quarter, and every A(f) entry is actually created.** It is asserted off the `-- @verify:` blocks §(c) already mandates: the test parses every `-- table:`, `-- view:` and `-- function:` line out of the programme's migration files, groups them by quarter, and diffs against A(f) in both directions. An invented table fails because A(f) does not carry it — §06 §4.3's rejected `activity_monthly` is the worked example — and an A(f) row nobody built fails because no `-- @verify:` block declares it. Test 5 asserts each block is well-formed and complete for its own migration; test 8 is what turns the union of those blocks into an executable registry rather than a documentary one.

**Fixture-quality rule, applied to every fixture:** *what would this fixture have to look like for the test to be able to fail?* A 1×1-pixel PNG has no aspect ratio, so no render test using it could ever have caught `objectFit:'cover'` discarding 37–84% of every photo; a latin1 decoder made every punctuation assertion pass vacuously; and "zero live instances" has twice measured a module's *age*, not its risk. Concretely, the Inbox fixture must span **≥3 projects with mixed effective roles**, include one overdue item, **one whose due date falls inside the December builders' shutdown** (A(h)), **one cost-bearing item whose viewer is a client viewer** (which must not appear), and **one `answered` item whose ball-in-court is the gatekeeper and not the assignee** — the case the whole primitive exists for.

**Mutation verification is the acceptance step, not a nicety.** Disable the thing under test, count the failures, restore, count again — the numbers go in the PR body. For the Q1 spine specifically: disabling the in-body cost gate in `inbox_for_user` must fail the client-viewer test; **an answered item whose ball-in-court is the gatekeeper and not the assignee must appear in the gatekeeper's inbox and not the assignee's**, and inverting that branch of the generated column must fail; removing the `anon` revoke must fail the grant assertions.

**Verification walks from the empty state.** Not from a deep link into seeded data — an uploader that rendered correctly on a page nobody could reach passed verification once already.

### (i) Observability

**Decision: metrics are computed from first-party Postgres tables, never from PostHog.** `trackServer` returns immediately when `getPostHogNode()` is null, which it is whenever `NEXT_PUBLIC_POSTHOG_KEY` is unset (`apps/web/src/lib/analytics.ts:63-68, 80-88`) — a missing environment variable and a quiet quarter produce byte-identical output, so no absence of data there can ever be interpreted. The existing `assignee_source` diagnostic on the RFI create path (`apps/web/src/actions/rfi.actions.ts:70`) is emitted only through that call and has produced nothing usable; it is **retired** once assignment is mandatory (§03 §1.10), because it could then only ever report `explicit`. `trackServer` continues to fan out to PostHog when configured; nothing depends on it.

**Two stores, and they are not the same thing.** Conflating them is what makes a metric argue with itself:

- **`public.product_events` is the append-only event stream** — one row per action, written as it happens, at full granularity, purged at 24 months (§f). It is what you query when you want to know *what happened*.
- **`public.platform_metrics_weekly` is the immutable weekly snapshot** — one row per metric per ISO week, written by §15's `pg_cron` job `platform-metrics-weekly` at `0 4 * * 1` (04:00 UTC = 06:00 SAST, no DST), carrying `method_version`, never rewritten. It is what you quote. Changing a definition writes new rows rather than editing history, and the recap renders last week's row if this week's has not landed.

```sql
CREATE TABLE public.product_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES public.profiles(id),
  project_id      uuid REFERENCES projects.projects(id) ON DELETE SET NULL,  -- nullable: org-level events
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  event           text NOT NULL,          -- CHECK against the shared registry
  effective_role  text,                   -- stamped at write time via user_effective_project_role(project_id, actor_id)
  session_id      uuid,
  properties      jsonb NOT NULL DEFAULT '{}'
);
```

`effective_role` is stamped at write time and never re-resolved later, because role in this system is **per project** (`user_effective_project_role(p_project_id, p_user_id)`, `00107:30-66`) and memberships change; that is why the row must carry a `project_id` to stamp a role against. The table is **append-only** (no UPDATE or DELETE policy), **service-role write**, **RESTRICTIVE-read to org `owner`/`admin`** through §15's `public.user_is_org_admin()`, and `REVOKE SELECT … FROM anon`.

**Presence and sessions come from §15's objects, not from a notification preferences row.** There are two of them and one writer. `public.user_presence(user_id, last_active_at)` is the current-state row the dispatcher branches on, upserted every 60 s by a focused tab. `public.user_sessions(user_id, started_at, last_seen_at, user_agent, platform)` is the append-only history the metrics read. **The same RPC, `public.touch_presence(p_platform)`, writes both** — `SECURITY DEFINER`, touching only the caller's own rows, `REVOKE ALL … FROM PUBLIC` plus an explicit `anon` revoke — so a session can never exist without presence having been written and the two can never disagree. The 30-minute gap that bounds a session is applied **at read time** over `last_seen_at`, never at write time. The earlier proposal here, a `last_seen_at` column on a `notification_prefs` table, is deleted with that table: it would have been a third presence source with no session history behind it.

Suppression is recorded, not silent, and it is recorded on the notification row: §05's `email_state` / `push_state = 'suppressed'` distinguishes "we chose not to send" from "we failed to send" — the same distinction that makes read tracking honest — and `public.notification_dispatch_runs` records that the sweep ran at all.

**§15 owns the eight metrics — seven product metrics running from Q1, plus metric 8, the commercial one — with their exact definitions, baselines and targets.** This section owns only which table each one reads and why that table can answer it:

| Metric | Reads | Why it is answerable |
|---|---|---|
| 1 · Weekly active | `public.user_sessions` + `public.product_events`, through the `public.metric_accounts` view | A session row **or** a first-party write in the ISO week (§15 §(a)), and the view excludes `rbac-test@e-site.live` and any `%probe%` account, so no metric counts its own fixture. |
| 2a/2b · Contractor active | Same, joined to `product_events.effective_role` stamped at event time | Role is per project and changes; the stamped value is the only one that stays true. |
| 3 · Diary same-day | `projects.site_diary_entries` (`00002:150`, `:156`), `AT TIME ZONE 'Africa/Johannesburg'` | Both columns already exist; nothing new is needed to start measuring. |
| 4 · Median working days to respond | `projects.work_item_events`, first `open → answered` transition, working days per A(h)'s `office` calendar | Unanswered items are counted at their current age, so the median cannot be flattered by ignoring them. |
| 5 · Inbox engagement | `public.notifications` **and** `public.inbox_state`, server-stamped columns only, the notifications half filtered `read_at_estimated = false` | It is a **union over both halves of the Inbox**, per §15 §(a) metric 5, because the Inbox is two halves: the event half contributes notifications created that week with `read_at` or `cleared_at` set; the state half contributes `inbox_state` rows whose `done_at` fell in that week, against work items that entered the caller's ball-in-court that week. `done_at` is on `inbox_state` only (§04, §f), so a single expression over `notifications` would not compile — and dropping the disjunct instead would discard the auto-done-without-read share §15 reports as a success. The timestamps counted are the RPC-written ones of §05 §(i); no reconstructed timestamp is ever treated as measured. |
| 6 · Report schedules per project | `projects.report_schedules WHERE enabled` (Q3) | Reported with the count of active projects holding zero, because the average hides them. |
| 7 · Activation | `public.user_sessions` × `projects.work_item_events` with `to_status = 'closed'` | This is why `session_id` is added to `product_events` and `auth_events` in Q1 (A(f)) — it attributes an event to a session row. `auth_events` is a best-effort client call after an explicit login (`(auth)/login/page.tsx:108`, `:166`) and emits nothing for a returning cookie session, so it is a corroborating source and never the primary one; `00038:8-10` records that `login`/`logout` writes were themselves deferred to a follow-up pass. |
| 8 · Signed paying organisations | `billing.subscriptions` + `billing.invoices` | No new table, and none is needed: the bands are evaluated **only at renewal** (§11.7), so a band change is a cancel-and-resubscribe and the subscription row is the only history of what an organisation actually paid for. Instrumented in Q1, zero by design until Q3. |

**The never-null rule is verified against the data, not against an analytics event.** `SELECT count(*) FROM projects.work_items WHERE ball_in_court_id IS NULL AND status NOT IN ('closed','void')` must be **0** — asserted immediately post-backfill, and again by a nightly check that raises an Immediate-tier bell to the org owner if it ever is not. A(a)'s `work_items_bic_present` CHECK makes the violation impossible at write time; the nightly check exists to catch the day someone drops it.

Every one of these metrics is a query over a table this programme creates or a table that already exists. None depends on a third-party analytics vendor being configured.

### (j) Backup, restore and data export

The programme applies roughly forty migrations across four quarters against a live production database whose ledger has already been corrupted twice by number races. §15's reversibility table is about product decisions; this is about data, and it has three parts.

**1. Every destructive migration takes a pre-migration snapshot in the same transaction.** The snapshot is `CREATE TABLE backup_<version>_<object> AS SELECT * FROM <object>` — same transaction as the drop, so a failure leaves neither — retained 90 days by the same purge job family as §(f), with the exact restore statement written into the migration header beside the `-- @verify:` block. Eight migrations in this programme are destructive, and they are named here so no ninth arrives unnoticed:

| # | Quarter | Destructive act | What the snapshot holds |
|---|---|---|---|
| 1 | Q1 | `DROP CONSTRAINT notifications_type_check`, replaced by the `notification_types` FK | The constraint's full text, captured from `pg_constraint` into the header before the drop |
| 2 | Q1 | `DROP POLICY notifications_own` | The policy definition from `pg_policies` |
| 3 | Q1 | `ALTER TABLE public.notifications DROP COLUMN is_read` | `(id, is_read)` for all 964 rows — the only evidence behind the 5.9% figure once the column is gone |
| 4 | Q2 | `DROP TABLE projects.drawings` | The table, asserted empty in the same transaction first |
| 5 | Q2 | `attachments.entity_type` CHECK re-declared without `'drawing'` | The old CHECK text, plus a count of rows carrying the dropped value (which must be zero) |
| 6 | Q4 | `DROP TABLE projects.qc_comments`, after the renderer repoint — the back-fill and repoint moved to Q4 with the re-plan (§14), and Appendix A(f) books this drop there | Every comment row; these are people's words about defects and are irreplaceable |
| 7 | Q4 | `DROP TABLE field.inspection_milestones`, after asserting `count(*) = 0` in the same transaction | The table |
| 8 | Q4 | `DROP TABLE gcr.report_revisions`, at the end of its read-only quarter | Every revision, because the Q4 backfill into `projects.reports` is the only other copy |

Items 4, 5 and 7 assert emptiness *in the transaction that drops*, never from a count taken earlier — "zero live instances" has twice measured a module's age rather than its risk, and a count read in a previous session is exactly that mistake in a new place.

**2. The point-in-time-restore window is confirmed as a fact in Q1 item 0, not assumed.** Item 0 already reads production for the account estate and the mail entitlement; it also reads the Supabase project's actual PITR retention from the Management API, records the number in `CLAUDE.md` beside the migration protocol, and performs one restore-to-a-branch drill so that the recovery path has been walked once before it is needed. If the window turns out to be shorter than the 90-day snapshot retention above, the snapshots are the longer-lived mechanism and the header restore statement is the primary route — which is the reason the snapshots exist rather than relying on PITR alone. The drill is half a day inside item 0's existing allocation and adds nothing to the engineer-week ledger.

**3. `project_export` is a defined artefact, and it is what §11.7's Archived tier sells.** Registered as a report kind in Q4 (A(d)), gated `ORG_WRITE_ROLES`, generated by the Q3 harness: **one ZIP containing every `status='issued'` report for the project plus the RFI, snag, QC, instruction, procurement and tenant registers as CSV, with a manifest listing every file, its kind, its version and its issue date** (§07 §5.4). It contains project records only — no auth rows, no other project, no other organisation, no keys — and it is generated by the same `file_report()` path as everything else, so it inherits the read gate, the version chain and the retention rules rather than being a bespoke download route.

Two assumptions in the saved-report path break on it, and both are fixed in the harness in the same quarter: the row must set `mime_type = 'application/zip'`, because the column defaults to `'application/pdf'` (`00117_report_export_branding.sql:53`, verified), and `downloadFileName()` must derive its extension from `mime_type` instead of hard-coding `.pdf` (`apps/web/src/actions/project-reports.actions.ts:33-34`, verified). A project that has left support must still be openable by the client who paid for it, and for a system holding SANS 10142-1 compliance records and JBCC correspondence that is a professional obligation before it is a product feature.

---

**Appendix A is the canonical registry for every vocabulary this section touches** — the `work_items` DDL, the work-item types, the notification types, the report kinds, the module tokens, the new-table inventory, the routes, the working-day calendar and the vendor list. This section cites it and never restates it — including the migration inventory, whose ordinals this section deliberately no longer publishes — and §(h) tests 1–3, 7 and 8 assert set equality against it in both directions across work-item types, notification types, report kinds, module tokens and the new-object inventory, so a value that exists in code and not in the appendix, or in the appendix and not in code, fails the build. Every table A(f) lists is covered by one of those five tests, which is what the appendix preamble promises.
