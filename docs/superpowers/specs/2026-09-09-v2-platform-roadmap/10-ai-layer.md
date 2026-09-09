## The AI layer — chase agent, drafting, cited answers and photo tagging

There is no model call anywhere in this monorepo today: a grep for `anthropic`, `openai`, `gpt-`, `whisper` and `transcri` across `apps/` and `packages/` returns four prose comments about hand-transcribed SANS tables (`apps/web/src/lib/cable-schedule/sans-breadcrumb.ts:47`, `packages/shared/src/services/generator-cost-recovery/sizing-table.ts:60`) and nothing else. The layer is greenfield, so the rule can be enforced structurally rather than by convention.

**The rule: AI removes chores, never makes decisions, and every output is reviewable.** Three constraints. (1) No AI feature holds a write grant to a domain table — output lands in a draft row that a human promotes through an existing role-gated action (`requireEffectiveRole`, `apps/web/src/lib/auth/require-role.ts:85`). (2) No AI feature invents a number: figures are rendered by templates from payloads the model never computes, and prose is post-checked for digit strings absent from the payload (§07 §5.6). (3) Every call is logged with model, tokens, the row references it read, and what the human did with it — the eval set is a by-product of running the feature.

**What is committed inside the twelve months, and what is designed but not built.** After the re-plan, three routes are funded: the chase agent and voice-to-field in Q3 (voice arrives with the `ai` schema itself, 2.0 weeks; chase 1.5 weeks), and narrative drafting in Q4 (2.0 weeks). Two designs in this section are **cut past twelve months** and are retained here behind that banner so the following programme inherits the design rather than re-deriving it: **cited structured answers** (§10.4) and **photo pre-classification** (§10.6). Drawing-to-legend extraction (§10.8) stays **uncommitted**, exactly as §14 already had it. Search is excluded by decision, not deferred.

### 10.1 Shared substrate

One gateway, not seven integrations. A new `ai` schema holding four tables, created in **Q3** alongside voice. The split between the tables is the section's most important structural decision.

**Decision: telemetry and reviewable output are different tables with different readers.** `ai.runs` is a cost-and-audit ledger nobody but an org administrator should read. `ai.drafts` is the staging area a project manager must read to do the review the whole layer depends on. Collapsing them makes the narrative draft and the legend grid unreadable by the people who promote them.

```sql
CREATE TABLE ai.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  project_id      uuid          REFERENCES projects.projects(id)   ON DELETE CASCADE,
  feature text NOT NULL,        -- committed: 'chase'|'narrative'|'voice'
                                -- reserved for the designs held past twelve months:
                                -- 'answer'|'photo_tag'|'legend'. No CHECK, so adding one
                                -- when a held design is funded costs no migration.
  model text NOT NULL, input_tokens int, output_tokens int,
  cache_read_input_tokens int, cache_creation_input_tokens int,
  latency_ms int, cost_usd numeric,
  input_digest text NOT NULL,   -- cache/eval key only; see source_refs for provenance
  source_refs jsonb NOT NULL,   -- [{schema, table, id}, …] every row that entered the prompt
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','accepted','edited','rejected','expired')),
  edit_distance int, resolved_by uuid REFERENCES public.profiles(id), resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.drafts (                       -- reviewable output; never the record
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES ai.runs(id)          ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  feature text NOT NULL, payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','promoted','discarded','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.nudges (                       -- the chase agent's anti-spam ledger
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES projects.work_items(id)  ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
  rung smallint NOT NULL CHECK (rung IN (1,2,3)),
  sent_on date NOT NULL, sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX nudges_one_per_person_per_day ON ai.nudges (person_id, sent_on);
CREATE UNIQUE INDEX nudges_one_per_item_per_day   ON ai.nudges (work_item_id, sent_on);

CREATE TABLE ai.org_profile (                  -- §10.7, one row per organisation
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  tone_json jsonb NOT NULL, standard_wording jsonb NOT NULL, thresholds jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Placement, quarter and the rest of the new-table inventory are Appendix A(f)'s; this section owns only the DDL above.

| Table | Read gate | Rationale |
|---|---|---|
| `ai.runs` | `OWNER_ADMIN` (`packages/shared/src/types/index.ts:36`) at org scope. No client role, no PM | It is a cost ledger and a model-behaviour audit, not project content |
| `ai.drafts` | Permissive SELECT on `user_effective_project_role(project_id) IS NOT NULL`, plus a RESTRICTIVE policy limiting promotion (UPDATE of `state`) to the feature's write roles | A PM must read the narrative they edit and the legend grid they accept; `OWNER_ADMIN` excludes `project_manager`, which would make both features unbuildable |
| `ai.nudges`, `ai.org_profile` | `OWNER_ADMIN` read; service-role write only | Operational |

Every read still goes through a server action that calls `requireEffectiveRole` first; the DB policies are the backstop, not the gate, because server actions and `app/api/*` routes are directly invocable outside `(admin)/layout.tsx`.

**Retention.** Project-scoped rows die with the project by cascade. Org-scoped `ai.runs` rows with a null `project_id` (there are only two producers — the org-profile editor's preview and the weekly eval roll-up) are purged by a monthly `pg_cron` job at 180 days; nothing cascades them, so a dated purge is the only mechanism that works.

**Migration footprint, stated once so it is not under-counted — two migrations, and the schema-creating one carries three separate obligations, not one.** Appendix A(f) records the same three; they are restated here because this section is the only one that creates a schema.

1. **The `ai` schema, its four tables and their policies**, plus:
   - **(i) the Management-API `PATCH /v1/projects/{ref}/postgrest` on `db_schema`.** Without it REST returns `PGRST002` indefinitely with no auto-recovery. The Supabase CLI does not expose this.
   - **(ii) a complete GRANT block** — `USAGE` on the schema to `anon`, `authenticated` and `service_role`, plus **all table and sequence privileges** to `authenticated` and `service_role`. This is not belt-and-braces: `00069_inspections_grants.sql:2-13` exists precisely because `00066` granted schema `USAGE` and nothing else, and the missing table and sequence grants made PostgREST's schema-cache rebuild fail with **`PGRST002` across the entire REST API — every query returned 503**, not just the new schema's. Table-level grants control what the role can see at the introspection layer; RLS still enforces rows (the same comment says so at `:11-13`). Per A(f)'s rule, `anon`'s table `SELECT` is then explicitly revoked table by table and verified with `has_table_privilege`, never by reading `relacl`.
   - **(iii) an edit adding `ai` to `apps/edge-functions/supabase/config.toml:9`.** That line today lists eleven schemas — `public, projects, field, tenants, suppliers, billing, marketplace, gcr, structure, cable_schedule, inspections` — and not `ai` (verified). Omit it and local dev and any fresh database diverge from production, which is the failure the comment two lines above it already documents for the dropped `compliance` schema.
2. **`chase_opt_out boolean NOT NULL DEFAULT false` on `public.notification_preferences`** (§05 §(c)).

The `ai_tags` / `ai_caption` migration across the three photo tables is **removed from this footprint**: §10.6 is cut past twelve months.

Migration numbers are claimed at merge, never at branch (A(f)), checked against `max(version)` **and** `origin/main` immediately before applying, and verified by reading the affected object back — a green `Deploy DB Migrations` is not evidence a migration ran, because `db push` keys on the version prefix and silently skips a file whose number is already in `schema_migrations`.

### 10.2 (a) The chase agent — Q3, committed

| | |
|---|---|
| **Trigger** | `pg_cron` at 05:30 SAST, one row per project, calling the `chase-sweep` edge function (Appendix A(g), Q3) — the `cron.schedule` + `net.http_post` shape documented at `00029_health_scores.sql:59-70` and scheduled through the Management API like the seven live jobs. Edge functions do **not** auto-deploy on merge, so the function is CLI-deployed before the cron job is scheduled. The function forwards the **caller's** Authorization on any function-to-function call: the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as `sb_secret_…`, not a JWT, and a JWT-role gate rejects it (PR #153) |
| **Selection** | `projects.work_items WHERE ball_in_court_id IS NOT NULL AND due_date < current_date` — this is the exact shape of Appendix A(a)'s partial index `(ball_in_court_id, due_date) WHERE status IN ('triage','open','answered')`. `ball_in_court_id` is a `STORED` generated column that resolves to NULL for both `closed` and `void`, so one predicate excludes closed items and voided ones without a second clause. Joined to source rows for context: `projects.rfis.due_date`/`assigned_to` (`00002_projects_schema.sql:91,93`), `structure.node_orders.status`/`ordered_at` (`00083_node_orders.sql:74,78`), `field.site_forms` unsigned (`00179_site_forms.sql:69`), `field.snags`, and `projects.jbcc_time_bar_schedule` (`00099_jbcc_module.sql:66`) where that module is toggled on |
| **Addressing** | Every nudge is addressed to `ball_in_court_id`, never to `assignee_id`. An RFI at `status='answered'` is waiting on the WM gatekeeper, and nudging the contractor who already answered it reads as harassment for someone else's inaction — the exact inversion the ball-in-court primitive exists to prevent |
| **Ladder** | **Day 1 past due** → the holder. **Day 4** → the holder plus the other named party on the item (`gatekeeper_id` when the holder is the assignee, `assignee_id` when the holder is the gatekeeper). **Day 8** → those two plus the project manager. **Day 15** → nudging **stops**; the item is listed in the weekly report's exceptions table, which is a management artefact rather than a message |
| **Output** | Rung 1 writes an item into the 07:00 recap builder (`public.build_daily_recap`, §05 §(d)) — it does not raise its own bell. Rung 2 and above dispatch per-person through `dispatchNotification({ userIds, title, body, route, type, entityType, entityId })` (`apps/web/src/lib/notifications.ts:26`) with the `chase_nudge` type. **`chase_nudge` is registered by an `INSERT` into `public.notification_types`, not by re-declaring a CHECK constraint**: Q1 replaces `notifications_type_check` with that table plus an FK, so from Q1 onward the `00178_snag_visit_completion.sql:54-58` re-declaration ritual no longer applies. Appendix A(c) owns the type's row — Immediate tier, one per person per day, ranked, always-fires. One notification per **person**, carrying that person's overdue items with one model-written sentence of context each, deep-linked to `/my-work` |
| **Forbidden** | `notifyEntityEvent` (`apps/web/src/lib/notify.ts:30`) must never carry a chase nudge. It resolves the entire project roster via `resolveProjectRecipients` and bells everyone but the actor (`:32-38`) — it is a broadcast primitive with no per-person addressing — and it posts its email leg under a hardcoded `type: 'rfi-created'` (`:50`). Using it here would reproduce the 964-sent / 57-read fan-out this programme exists to end |
| **Hard limits** | One chase notification per person per day across all projects (`nudges_one_per_person_per_day`); one nudge per item per 72 h (`nudges_one_per_item_per_day` plus an explicit `NOT EXISTS (SELECT 1 FROM ai.nudges n WHERE n.work_item_id = wi.id AND n.sent_at > now() - interval '72 hours')` in the selection query — the daily index alone does not express 72 h); nothing on Saturday, Sunday or an SA public holiday; a project with more than 40 overdue items sends the PM one "this project needs triage" item instead of nudging forty people; the sweep is skipped entirely for a project whose `project_settings` chase toggle is off, and skips any person with `notification_preferences.chase_opt_out` |
| **Holidays** | The chase ladder reads the **site** calendar in Appendix A(h) — nothing on Saturday, Sunday or an SA public holiday. `projects.public_holidays` is **seeded from the existing computus function**, `listHolidays(year)` / `isPublicHoliday` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:43,63` — fixed dates, Good Friday and Family Day by computus, and the Sunday-observed-Monday rule at `:53-60`), with a **contract test asserting the table equals `listHolidays()` for every seeded year**. It is therefore a *materialisation* of the one source the contractual deadlines already use, not a second source that can drift from it. The table is required rather than optional because the sweep's selection is a single SQL statement that must exclude non-working days **inside the query that picks recipients**, before any model call — a surface a TypeScript function called from application code cannot provide, and moving the exclusion out of the query would break the "every limit is enforced before the model runs" guarantee below |
| **Audit** | Every nudge writes `ai.nudges` and `public.audit_log` (`00001_initial_schema.sql:124`) with `action='chase_nudge'`, the item's `entity_type`/`entity_id`, and `new_values` carrying the rung. The nudge is a record, not a message that vanishes |
| **Cost tier** | Low — `claude-haiku-4-5` |

**Decision: the chase sweep is the sole producer of overdue nudges — and this is now the arbitrated position, not a proposal.** Two producers over one event would mean an overdue item generating a daily §05 notification *and* a 72-hourly chase nudge, on different cadences to different recipient sets, with the "hard limits so it cannot spam" guarantee void because the limits bind only one of the two paths. **The ruling: §05 §(e) now carries only the delivery contract the chase sweep writes into — non-suppressible, holder-addressed, `channel_email` honoured — and its independent daily cadence and its +7-day rung are deleted.** This section's numbers stand: 72 h minimum interval, rungs at days 1 / 4 / 8 / 15. **In Q1 and Q2, before the sweep exists, overdue appears in exactly one place: section 2 of the 07:00 recap**, holder-addressed, `work_item_overdue` at Recap tier (Appendix A(c)). Rationale unchanged: a daily nudge on a two-week-old item is how people learn to filter the sender, and a two-rung ladder cannot reach a PM.

**Decision: the model writes the sentence, SQL decides who gets chased.** Selection, ranking and escalation are deterministic queries; if the model is unavailable the nudge sends with template text. This is why it cannot spam — every limit is enforced in the query that selects recipients, before any model call. `apps/web/src/lib/rate-limit.ts:11` is a per-instance in-memory counter and is useless here; the limits are unique indexes. And no push dependency: `send-notification/index.ts` posts to Expo, production holds zero push tokens, so chase reaches people by bell, recap and email.

**What changes / what stays / cost.** Changes: one edge function, one cron job, one row in `notification_types`, `ai.nudges`, the §05 §(e) deletion above. Stays: `work_items`, every source table, every existing notification path. Cost: ~R3 per active project per month (§10.11), inside the committed set.

### 10.3 (b) Narrative drafting — Q4, committed

Trigger: the report scheduler requests a draft when a periodic report is assembled. Inputs, the numeral post-check, the traceability requirement and the issue-on-time-without-prose rule are specified in the report engine §07 §5.6 and are not restated. What belongs here:

- **Decision: only the weekly project report and the monthly client report get drafted prose, and no daily report is drafted because none is built.** The original objection stands and is now moot twice over: a daily site report would have been ~22 drafts a month, by far the largest volume in the feature, and it is a delta of the day's rows read by the site team rather than client-facing prose. The re-plan **cuts the daily site report entirely** — it is redundant with a Q1 deliverable, since the 07:00 recap's section 4 already names contractors with no diary entry, every day — and Appendix A(d) records `daily_site` as not registered. The sections that carry meaning ("contractors with no entry, named", "weather not recorded") remain template lines that read identically every day.
- **Model: `claude-opus-5` at `output_config: { effort: "medium" }`.** Report prose is the one output a client reads as WM's professional voice; the wrong place to save six rand a month.
- **Decision: no prompt caching on this route.** The 5-minute ephemeral TTL is shorter than the weekly cadence by four orders of magnitude, so a cache breakpoint charges the 1.25× write premium on every run and reads on none. It would pay back only through the post-check regeneration path, which needs a retry rate above roughly 27% to break even — well above what the feature should tolerate.
- **Where caching would apply, the test must be able to fail.** A single call always reports `cache_read_input_tokens = 0` — the first call writes the cache — so an assertion on one call is either vacuous or flaky against real billing. Any cached route makes **two back-to-back calls with an identical prefix and asserts on the second**, with a companion static test asserting that no volatile token (timestamp, project name, uuid, question text) appears anywhere before the last `cache_control` breakpoint. No committed route caches; the rule is written down here because the first route that does will otherwise ship the vacuous test. (It was written for §10.4, which is now cut.)
- **The output must survive the PDF.** A model emits `≤`, `→`, `Ω` and `✓` unprompted, and `@react-pdf/renderer` draws the wrong glyph for all four while throwing nothing — `Ω` prints as `©`, `✓` truncates to an invisible `0x13`. **`≤ → d` is the variant that survives proofreading**, because a plausible letter reads as a typo. En- and em-dashes, `·`, `²`, `°` and `†` are genuine WinAnsi (`apps/web/src/lib/pdf/winansi.ts:36-41`) and are safe. Narrative strings reach the page through §07 §5.6's single sanitisation boundary — the `<T>` primitive calling `toWinAnsiSafe` (`apps/web/src/lib/reports/winansi-text.ts:70`), which delegates to `winAnsiSafe(text, { collapseWhitespace: false })` (`apps/web/src/lib/pdf/winansi.ts:94-95`). **The two-argument signature lives at `lib/pdf/winansi.ts`; `lib/cable-schedule/winansi.ts` is the re-export shim.** Passing `collapseWhitespace` to the shim path is silently ignored and flattens every multi-paragraph narrative into one run-on block. pdf-lib callers take the default `true`; react-pdf callers must pass `false`. The model is additionally instructed to spell "less than or equal to" and "ohm" in words, and a fixture test feeds hostile output through the renderer and asserts on the decoded content stream — not on the fact that something rendered.

**What changes / what stays / cost.** Changes: one prompt route, one draft row per periodic report, an edit-distance write on issue. Stays: the report registry, every gatherer, every renderer. Cost: ~R6 per active project per month (weekly R4 + monthly R2), inside the committed set.

### 10.4 (c) Cited structured answers — **DESIGNED, CUT PAST TWELVE MONTHS**

> **Status.** This feature is **cut, not conditional.** §14 previously carried it as earnable from Q4 float; after the re-plan Q4 is committed at 19.5 against 20.2 with 0.7 weeks of slack, and this feature is 2.5 weeks — there is no float to earn it, and pretending otherwise would put a 2.5-week line behind a 0.7-week door. Its exit criterion is deleted from the Q4 table with the deliverable (§15). **The specification below is unchanged and is the design the following programme inherits**; nothing in it is re-derived when it is funded. Search over documents remains excluded by decision, so this stays the intended answer surface rather than being superseded by one.

**Decision: tool-use over typed queries, not document RAG.** E-Site's corpus of record is relational, so an answer should be a query result with a row id, not a passage a model paraphrased. Trunk Tools' published 87% accuracy is the benchmark for RAG over documents; a parameterised query is either right or it errors.

| | |
|---|---|
| **Trigger** | A question in the project Ask box, or an `@ask` mention in a thread (§06) |
| **Tools** | Six read-only, parameter-typed functions in the `ai` schema, each returning rows plus their primary keys: `q_cable_supplies` (`cable_schedule.supplies`/`cables`, `00051_cable_schedule_core.sql:141,176`), `q_orders` (`structure.node_orders`), `q_tenants` (`structure.nodes`/`tenant_details`), `q_work_items`, `q_diary`, `q_forms`. No free-text SQL is ever executed |
| **Execution** | **All six are `SECURITY INVOKER`**, called through PostgREST as the asking user. This codebase's default habit is `SECURITY DEFINER` (`00001_initial_schema.sql:119`, `allocate_form_no`, every `user_can_*` helper), and a DEFINER function would apply the *owner's* row security and silently void the entire access model below. `current_user` is never used for authorisation inside any of them. Each also needs `REVOKE ALL FROM PUBLIC` **and** an explicit `REVOKE … FROM anon` — Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` directly at creation — verified with `has_function_privilege('anon', oid, 'EXECUTE')` and never by reading `proacl`, where a NULL value looks empty but *is* the PUBLIC grant. A contract test fails the build if any function in the `ai` schema has `prosecdef = true` |
| **Rows vs columns** | **RLS gates rows; the tool layer gates columns.** RLS is row-level and cannot hide a column, and the assumption that it redacts cost is false against this schema: `cl_select` on `cable_schedule.cost_lines` (`00051_cable_schedule_core.sql:449-460`) explicitly *admits* a `client_viewer` who holds an active `projects.project_members` row, so a project-assigned client viewer can read `supply_rate_per_m`, `install_rate_per_m` and `termination_rate_each` (`00051:289-291`) by RLS today. Cost redaction in this codebase is an application concern — `requireEffectiveRole(supabase, id, COST_VIEW_ROLES)` at `projects/[id]/page.tsx:57`, `settings/rates/page.tsx:21`, `api/projects/[id]/boq/import/route.ts:45` — and it stays one here |
| **Two schemas, chosen server-side** | Each tool is registered in two variants: cost-bearing and redacted. The variant is selected **before the model sees the tool list**, by one `requireEffectiveRole(projectId, COST_VIEW_ROLES)` (`packages/shared/src/types/index.ts:61`) at request assembly. A user without that role is never shown a tool whose projection contains a rate, so the model is structurally unable to name a figure it should not have — rather than being asked not to |
| **Output** | Prose plus a citation chip per claim carrying `(table, id, label)`; clicking it opens the row. **An answer with zero citations is not rendered** — the UI shows "I could not answer that from the project record" |
| **Guardrails** | No figure may appear that is not in a returned row (§07 §5.6's digit post-check); the model may not aggregate beyond the `count`/`sum` a tool returned; a question resolving to zero rows returns "no matching records", never a hedge |
| **Cost tier** | Medium — `claude-sonnet-5`, tool schemas cached (the two-call cache test in §10.3 applies) |

**What it would change / what stays / cost when funded.** Changes: six SQL functions in two projections each, one Ask surface, one contract test. Stays: every RLS policy — none is loosened or tightened by this feature. Cost when built: ~R15 per active project per month at 60 questions — **not in the committed cost** (§10.11).

### 10.5 (d) Voice to structured field — Q3, committed

Shared with the capture layer, which owns the hold-to-talk control, the same-origin `POST /api/capture/transcribe` route (Appendix A(g), Q3, `requireRoleAPI`) and the `microphone=self` header change; this section owns the extraction. Speech-to-text is **not** Claude — a third-party STT at ~R0.11/minute produces the transcript; `claude-haiku-4-5` maps it onto fields. The STT vendor is not yet named and is named by **30 November 2026** on two hard criteria — a zero-retention tier and an SA or EU processing region (Appendix A(i); §15 open question 9). The project vocabulary — board tags from `structure.nodes`, tenant names from `tenant_details`, cable tags from `cable_schedule.cable_tags` — is passed as a lexicon so "DB three point one" resolves to `MAIN BOARD 3.1`.

**Decision: extraction targets `projects.site_diary_entries`, `field.snags` and `projects.qc_entries` only.** Output shape is exactly the target table's columns — for a diary entry, `weather` / `workers_on_site` / `progress_notes` / `delays` / `safety_notes`. **Site forms and inspections are excluded entirely: signed instruments are typed, not spoken.** Nothing is written to `field.form_responses` (`00179_site_forms.sql:152`) or `inspections.responses` by any extraction path. A site form carries 121 required answers with per-field regulatory meaning under SANS 10142-1 and the EMR 2011; voice-filling them is where one wrong extraction becomes a false compliance record, and hedging the exclusion to "except test readings and signatures" would still leave a hundred fields a machine may populate.

**Confirmation screen always; never auto-submit.** Unfilled is the correct output for anything not said — the safest-sounding default is the most dangerous thing to invent, exactly as the null `as_left_status` defaulting to `made_safe_de_energised` was. Unmatched speech lands verbatim in free text, never invented into a structured value. Audio is discarded at both ends once extraction returns: a recording is discoverable and a diary is a legal document.

**Voice in Q3 is the first client data to reach a foreign operator**, which is what sets the 1 April 2027 deadline on the paperwork in §10.12 item 8.

**What changes / what stays / cost.** Changes: one extraction route, a `captured_by='voice'` flag on three tables. Stays: every form and inspection capture path, unmodified. Cost: ~R2 per active project per month, STT included — inside the committed set.

### 10.6 (e) Photo pre-classification — **DESIGNED, CUT PAST TWELVE MONTHS**

> **Status and the reason, stated so it is not re-argued.** This feature is **cut**, not deferred pending a date. It costs a migration across **three** photo tables, an enqueue path on every upload action, and a **200-photo labelled evaluation set** that someone at WM must sit and label before a single tag may ship — and what it buys is search (**excluded by decision**) and report grouping (**not needed**: reports group by entry, board and visit, all of which are already columns). It buys these for a product in which `field.snag_photos` has **never held a row** — zero snag photos ever recorded, measured 2026-09-09. Building a classifier for photographs nobody has taken yet is the clearest example in this document of instrumenting an absence. The design below is retained so the following programme inherits it; the `ai_tags`/`ai_caption` migration is removed from §10.1's footprint and the photo-tag row in §10.9 is marked deferred.

**Decision: classification is enqueued by the upload server action after the storage write commits, never by a database trigger.** A trigger cannot call an API, and coupling classification to the insert would make a model outage a photo-upload outage. The enqueue mirrors the orphan-safe ordering the snag uploader already uses (`apps/web/src/lib/image/compress.ts:56`): storage write, row insert, then enqueue. **A failed classification never rolls back the photo** — an untagged photo is a photo; a lost photo is evidence gone.

Applies to three row tables: `projects.qc_entry_photos` (`00172_qc_reports.sql:133`), `field.snag_photos` (`00004_field_schema.sql:40`) and `field.form_photos` (`00179_site_forms.sql:212`). Site-form photos are rows in `field.form_photos`, not in the `site-form-photos` bucket (`00179:563`) — a bucket has no columns and cannot hold a tag. Output is a `tags text[]` plus a one-line caption written to **new `ai_tags` / `ai_caption` columns, never to `description`, `severity`, `caption` or `pass_state`**.

**Tags, never verdicts.** Permitted vocabulary is a fixed list — equipment (`db`, `cable_tray`, `luminaire`, `conduit`, `earth_bar`), context (`ceiling_void`, `riser`, `shopfront`), state (`terminated`, `untidy`, `unlabelled`, `damaged`) — plus the board or tenant if legible on a label. Forbidden outputs: any pass/fail, any SANS clause number, any "compliant" / "non-compliant", any person. Tags would drive report grouping and prefill suggestions; a human still types the defect. Cost tier when built: low, `claude-haiku-4-5` vision, ~R6 per active project per month — **not in the committed cost**.

### 10.7 (f) The organisation skills profile — Q3, with the schema

**`ai.org_profile` is the sole home of WM's house wording, report tone and thresholds.** There is no second store: **§07 §5.6's competing `public.organisations.report_narrative_profile` column is deleted** and is recorded in Appendix A(f) as not created. Two configuration surfaces for one voice is how a report ships in last year's wording because someone edited the other one.

The table is edited by an owner/admin on a settings page and versioned in `public.audit_log`. Three blocks: **tone** (register, person, sentence length, banned phrases — "steady progress continued" is banned by name); **standard wording** (the CoC disclaimer, the JBCC notice salutation, the sign-off block, the redaction note); **thresholds** (what counts as overdue per item type, the escalation days in §10.2, the snag count that triggers a triage nudge). Every feature reads it; nothing else configures prompts.

**It is created in Q3, with the `ai` schema — one quarter before the narrative needs it.** That ordering is deliberate and is the reason the column in §07 can be deleted rather than kept as a stopgap: by the time narrative drafting starts in Q4, the profile has existed for a quarter, the chase agent has already been reading its thresholds, and WM has had a quarter of ordinary use to get its own wording right rather than approving it in the week the first client report is due.

**Model ids are server-side environment configuration, not customer data, and are not in this table.** A customer-editable model id is an unbounded cost and safety surface with no validation, no ceiling and no eval coverage for whatever string an administrator types. Procore ships wording configuration as "Skills"; the point is that a consulting engineer's *voice* is a customer-editable asset. Its model routing is not.

### 10.8 (g) Drawing to circuit legend — uncommitted, as §14 already had it

`structure.node_circuits` (`00169_db_legend.sql:25`) is the right table with the wrong contents: 12 rows in the whole database, every descriptive column null — yet it is the substrate the legend card, the site-form prefill and future QA all depend on.

**Trigger:** an explicit "Extract circuits from this sheet" action, PM-only. **Input:** tiled renders of one drawing page plus the board's `node_orders` and cable-schedule context. **Decision: the PM's browser rasterises the tiles.** `pdfjs-dist` is already a dependency (`apps/web/package.json:43`) but every use in the monorepo is browser-side canvas (`floor-plans/[planId]/MarkupCanvas.tsx`), and there is no server-side rasteriser — no `sharp`, no `node-canvas`. The existing viewer renders the tiles and posts them to the extraction route, so this feature adds no new raster dependency and no new serverless cold-start weight. The drawing source is `tenants.floor_plan_versions` (`00148_floor_plan_versions_cloud_sync.sql:41`), which holds 201 rows created in the last 30 days; `projects.drawings` is empty, has zero rows and is dropped in Q2 (Appendix A(f)).

**Output:** proposed `circuit_no`, `description`, `phase`, `breaker_rating_a`, `poles`, `curve`, `cable_size`, `is_spare` rows (`00169:34-46`) staged in `ai.drafts` and shown in a side-by-side accept/edit grid. Nothing reaches `node_circuits` until a human accepts a row, and the accepting action writes `ai.runs.outcome` and `edit_distance` in the same transaction.

**Why it stays uncommitted, and it is not the tokens** (~R3 a sheet on `claude-opus-5` vision). A wrong breaker rating on a legend card is a safety artefact, so this needs a held-out eval set of at least 40 real SA drawing sheets scored per-field before it is offered to anyone but WM, and per-field accuracy gates the rollout. No quarter in the twelve months carries that eval work, and §14 correctly left the line uncommitted; it stays uncommitted here rather than being smuggled into Q3 as "at the earliest".

### 10.9 (h) Evaluation and instrumentation, from day one

| Feature | Status | Primary metric | Target at 90 days | Kill condition | Not evaluated before |
|---|---|---|---|---|---|
| Chase | **Q3, live** | Median hours from nudge to item status change; % of nudges answered before rung 2 | < 48 h; > 50% | Answered rate < 20% | 90 days **or** 200 nudges, whichever is later |
| Narrative | **Q4, live** | Character edit distance draft → issued, per 1,000 chars | < 250 (a quarter rewritten) | > 500 — editors rewrite more than they keep | 60 days or 20 issued reports |
| Voice | **Q3, live** | Field-level accuracy vs the confirmed save; % of fields the user changed | > 85%; < 15% changed | Users retyping more than a third of extracted fields | 60 days or 100 captures |
| Answers | **deferred — §10.4 is cut** | % answers with ≥1 citation the asker opened; thumbs-down rate | > 60%; < 10% | Any confirmed fabricated figure disables the feature by hotfix, immediately and without a sample | Immediate for fabrication; 60 days or 150 questions for the rate metrics |
| Photo tags | **deferred — §10.6 is cut** | Precision on a 200-photo labelled set; tag-removal rate | > 0.85 precision | Any verdict-shaped tag reaching production | Immediate for a verdict tag; otherwise the labelled set. **The 200-photo labelled set is itself part of the cut cost** — it is not sunk work waiting on a switch |
| Legend | **uncommitted** | Per-field accuracy on 40 held-out sheets | > 0.95 on breaker rating and circuit number | Below that: not released | The eval set is the gate; there is no live period |

**The minimum-sample column is load-bearing, not decoration.** Production today has three weekly actives and thirteen contractor accounts with no sign-in in 30 days. A bare threshold evaluated at 30 days would trip the chase agent's kill condition in its first fortnight and delete the feature most likely to fix the cold start. A cold start must not be mistakable for a failed feature.

**The opt-out is per person, and it is not a kill switch.** `notification_preferences.chase_opt_out` (§05 §(c)) stops nudges for that user. Two opt-outs on one project raise a PM review item — the useful signal is "these nudges are wrong for this project", not "turn the feature off for everyone".

The three live features read from `ai.runs`: `outcome`, `edit_distance` and `resolved_at` are written by the same server action that accepts, edits or rejects the draft, so no feature can be instrumented later. A weekly job posts the table to the WM admin dashboard. Every eval set is drawn from real accepted and rejected runs, held out **by month**, so a prompt change is scored on months it never saw. The three deferred rows keep their metrics so that the instrumentation ships with the feature when it is funded, not after it.

### 10.10 (i) Not building, and why

| Not building | Reason |
|---|---|
| Computer-vision progress tracking against BIM | Needs a model, a maintained schedule and disciplined 360 walks. No SA retail fit-out WM works on has any of the three; Buildots' own customers are fabs and hospitals |
| 360 / reality capture as a platform | Commodity and hardware-bound. If a client asks, link out to OpenSpace or DroneDeploy |
| Predictive schedule or delay risk from history | Requires hundreds of completed projects. E-Site has 14, five with real data |
| Autonomous agents that act without review — auto-answering an RFI, auto-issuing a JBCC notice, auto-closing a snag | The record feeds a SANS 10142-1 CoC and JBCC contractual notices. An unsigned machine decision on either is legal exposure with no upside |
| Anything writing to a domain table without human promotion | Including "high confidence" auto-accept. Confidence thresholds are how review dies quietly |
| Voice filling site forms or inspections | §10.5. Signed instruments are typed |
| Search, and a chat assistant over uploaded PDFs (document RAG) | Search is **excluded by decision, not deferred** — it is not a twelve-month line and does not become one by being wanted. Cited structured answers (§10.4) remain the intended answer surface when the following programme funds them; a paraphrase of a drawing is not an answer a consulting engineer signs |
| Multilingual voice (isiZulu, Afrikaans, Sesotho) | Wanted, but STT quality varies sharply by language and none of it is testable without recordings from WM's own sites. Revisit once voice-to-English is measured |

### 10.11 (j) Models, vendors and cost at WM's volumes

Rates from the published Claude API table: `claude-opus-5` $5 / $25 per MTok, `claude-sonnet-5` $2 / $10, `claude-haiku-4-5` $1 / $5; cache reads at 0.1× the input rate, cache writes at 1.25×. R18.50 to the dollar. Volumes are **target-state assumptions for an active project, not measurements** — production today records six diary entries and eleven QC rows in thirty days and zero snag photos ever, so every line below is an over-estimate at present volumes. Vendors, their POPIA status and the operator-agreement obligation are **Appendix A(i)**; the vendor column below names the processor so no route's cost is read without its paperwork.

**Committed — the three routes funded inside the twelve months.**

| Route | Vendor | Model | Tokens in / out per call | Cache-read share of input | Calls per project per month | Cost |
|---|---|---|---|---|---|---|
| Chase sweep (Q3) | Anthropic | `claude-haiku-4-5` | 3 500 / 250 | 0% — the daily cadence exceeds the 5-minute ephemeral TTL, so a breakpoint would charge the write premium and read nothing | 30 | **~R3** |
| Weekly narrative (Q4) | Anthropic | `claude-opus-5`, `effort: medium` | 8 000 / 700 | 0% (§10.3) | 4 | **~R4** |
| Monthly narrative (Q4) | Anthropic | `claude-opus-5`, `effort: medium` | 15 000 / 1 200 | 0% | 1 | **~R2** |
| Voice extraction — mapping (Q3) | Anthropic | `claude-haiku-4-5` | 2 650 / 200 | 0% | 15 | ~R1 |
| Voice extraction — transcription (Q3) | **Speech-to-text, vendor named by 30 Nov 2026** (A(i)) | third-party STT at ~R0.11/min | 45 s of audio per capture | — | 15 | ~R1 |
| **Committed, per active project** | | | | | | **~R11/month** |
| **Committed, portfolio of 5 projects with real data** | | | | | | **~R55/month** |
| **Committed, portfolio of 14 projects, every module on** | | | | | | **~R155/month** |

**Not committed — designed, cut past twelve months, priced so the following programme has the number.**

| Route | Vendor | Model | Calls per project per month | Cost if built |
|---|---|---|---|---|
| Cited answers (§10.4, cut) | Anthropic | `claude-sonnet-5`, 8 500 / 500 across two turns, ~55% cache read | 60 | ~R15 |
| Photo tags (§10.6, cut) | Anthropic | `claude-haiku-4-5` vision, 2 400 / 60 | 120 | ~R6 |
| Daily report narrative | — | none — the daily site report is itself cut (§10.3, A(d)) | 0 | R0 |
| Legend extraction (§10.8, uncommitted) | Anthropic | `claude-opus-5` vision, 18 000 / 2 000 | bounded by an explicit user action, not by volume | ~R3 a sheet |
| **Not committed, per active project if all were built** | | | | ~R21/month |

> **Sensitivity, flagged and deliberately excluded from the headline.** The two lines that grow with success are both in the *not-committed* table. At ten times the assumed volume — 600 questions and 1 200 photos per project — cited answers reach ~R150 and photo tags ~R60, taking a project that had funded both to ~R220 and a fourteen-project portfolio to roughly R2 900 a month. **This is a sensitivity on features the programme is not building; it must not be read back into the committed figures.** The committed set contains no line that scales with adoption faster than project count: chase is capped at one notification per person per day by unique index, narrative is 5 calls a month by cadence, and voice is bounded by how much a person will talk. Ten times the *committed* volume is ~R110 per project per month.

For comparison, 27 WM users on monday.com Pro bill as 30 seats (it sells in blocks of 3/5/10/15/20) at a list USD 19 each — about R10 500 a month. **The committed AI layer, across the whole portfolio, is about 1.5% of that** — R155 against R10 500 — which is why cost never justifies degrading the narrative model, and why the two cut features were cut on value and engineer-weeks rather than on their token bill.

**Decision: model choice is per route, and the exception list is the rule.** `claude-opus-5` for client-facing prose and safety-critical vision (narrative, legend); `claude-sonnet-5` for tool-use answers, where judgement about which query to run matters more than register; `claude-haiku-4-5` for the high-volume, low-judgement routes (chase sentences, voice mapping, and photo tags if ever funded). Note that Haiku 4.5 does not accept `output_config.effort` and still takes `thinking: { type: "enabled", budget_tokens: N }`, so the cheap routes are configured differently from the expensive ones — one shared gateway, two configuration shapes.

### 10.12 (k) Data handling and privacy

WM's clients are shopping-centre landlords. The data includes tenant trading names, valuations, contractual correspondence, named contractor staff in diary entries, site photographs of people, and GPS coordinates — personal information of identifiable data subjects under the Protection of Personal Information Act 4 of 2013. Eight constraints, all enforceable.

1. **Zero data retention and no training use on every model account.** Written into the client-facing data annexe, not just the API configuration.
2. **RLS gates rows; the tool layer gates columns.** The answer tools query as the asking user (§10.4, `SECURITY INVOKER`); the chase sweep and narrative jobs run service-role but are scoped to one `project_id` at the query. A model never receives a row the requesting human could not open, and never receives a cost column the requesting human is not cost-cleared for.
3. **Every run records what it read.** `ai.runs.source_refs` is an array of `{schema, table, id}` for every row that entered the prompt. `input_digest` is a hash and is the cache and eval key *only* — a hash cannot answer "which rows did the model see when it wrote this paragraph", which is the one question an enquiry or a client dispute will ask. This mirrors §07 §5.6, which stores the entity ids each narrative paragraph was composed from in `projects.reports.narrative_json`. **Prompt text itself is never stored.**
4. **No cross-project or cross-organisation context, ever.** Prompt assembly takes exactly one `project_id`; `ai.org_profile` is the only cross-project input and contains wording, not data.
5. **Cost figures are excluded from any payload whose audience is not `COST_VIEW_ROLES`** (`packages/shared/src/types/index.ts:61`) — the same set the valuations page, the rates page and the BoQ import already require.
6. **Draft output is deleted with its project.** `ai.drafts.project_id` and `ai.runs.project_id` are `REFERENCES projects.projects(id) ON DELETE CASCADE`, and `organisation_id` cascades from `public.organisations` — the same shape as `00179:71`, `00172:137` and `00051:143`. Org-scoped rows with a null `project_id` cascade on nothing and are purged at 180 days by the job named in §10.1.
7. **Photographs and audio leave the platform only for §10.6 and §10.5.** With §10.6 cut, **no photograph leaves the platform inside the twelve months**; audio does, from Q3. One image per call, never batched across projects, never for face or person detection — the tag vocabulary forbids it. Audio is deleted at the STT provider and at our origin the moment extraction returns.
8. **POPIA §21 and §72 are satisfied before any client data flows — and this has an owner and a date.** Every model and speech-to-text provider is an *operator* processing personal information on WM's behalf, so §21 requires a **written operator agreement** binding the provider to the §19 security safeguards, to process only on WM's authorisation, and to treat the information as confidential; §22 breach notification to the Information Regulator and affected data subjects flows from it. Because processing happens outside the Republic, **§72 requires that the recipient be bound by an agreement affording a level of protection substantially similar to POPIA's conditions** — the operator agreement's equivalent-protection undertaking is the mechanism relied on, not consent, because the data subjects here are contractor staff named in diary entries and people photographed on site, none of whom are in a position to be asked. **The STT provider is subject to the identical terms**, selected on two criteria: zero data retention available, and an SA or EU processing region. The client-facing data annexe names every processor (Appendix A(i)), states what leaves South Africa, and states the retention position; **WM signs it per client**, because the landlord is the responsible party one level up and WM is its operator in turn. **Owner and deadline: the operator agreements and the client data annexe are Arno's, signed before 1 April 2027** — ahead of the first client data reaching a foreign operator, which after the re-plan is voice extraction in Q3. They are legal and commercial work, priced in §15(g)'s cost table as a legal-review fee, and deliberately **not** charged to the engineer-week ledger.

Every AI route is a server action or an `app/api/*` handler and is therefore directly invocable outside the `(admin)` layout: each gates in the app with `requireEffectiveRole` **and** in the DB with a RESTRICTIVE policy, and `docs/rbac-matrix.md` and `CONFORMANCE.md` are updated in the same PR that adds it (Appendix A(g) carries the route rows).
