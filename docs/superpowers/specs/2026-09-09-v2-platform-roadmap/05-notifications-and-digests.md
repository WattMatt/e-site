## Primitive 3 — the notification, digest and email participation engine

### What exists today, and the arithmetic of 964 → 57

Every module funnels through one helper. `notifyEntityEvent` resolves the project roster once and fans out to all of it: the bell excludes the actor, the email does not (`apps/web/src/lib/notify.ts:32-34`, `:42-51`). The roster is `project_notification_recipients()` — active `project_members` UNION every org owner, admin and project_manager of the project's org (`apps/edge-functions/supabase/migrations/00146_project_notification_recipients.sql:32-55`), reached through `resolveProjectRecipients` (`apps/web/src/lib/recipients.ts:19-41`). For a WM project that is twelve to fourteen people. The order of magnitude of the 750 `diary_created` rows is exactly that roster: fifty-three diary entries against rosters of twelve to fourteen, once `diary_created` became a legal type in `00173_notifications_type_qc_and_created.sql:49`. Roster fan-out is not a diary bug, it is the design — `qc.actions.ts:439-455` bells the entire roster, client viewers included, for a single comment, once the report is issued. The `status === 'issued'` guard is the tell: the module already knows the roster is the wrong audience for a draft, and the only vocabulary it has to say so is an all-or-nothing status check.

Everything else follows. There is no tier: `send-notification/index.ts:89-99` inserts one row per user, immediately, for every event — no coalescing, no cap, no dedupe key, no `actor_id`, no `organisation_id`. There is no per-user preference over transactional notifications; the only per-user flag in the schema is `profiles.marketing_emails_opted_out` (`00030_email_sequences.sql:55`), served by a live unauthenticated one-click page at `apps/web/src/app/(legal)/unsubscribe/page.tsx`, and it governs lifecycle mail only. The real controls are **six per-project booleans** — `notify_rfi_email` (`00101_project_settings.sql:43`), `notify_inspection_email` (`:45`), `notify_snag_email` + `notify_diary_email` (`00147:9-10`), `notify_qc_email` (`00172:183`), `notify_form_email` (`00179:628`) — five defaulting `true` and **`notify_inspection_email` defaulting `false`**. Plus `notify_rfi_to text[]` (`00101:44`), an external-address list that is schema-validated (`packages/shared/src/schemas/project-settings.schema.ts:31-33`) and read by **no send path anywhere in the monorepo**. All are admin-owned and all-or-nothing for the whole roster; a contractor who wants less cannot have less.

The false default is evidence, not trivia: inspection email has been off by default since `00101`, and all eighteen production inspections are still `status = assigned` with zero responses and zero certificates. Nobody was ever told.

Presence is not consulted, so the email fires at the instant the bell is already on screen. Every module posts its email to `send-email` under the literal type `'rfi-created'` (`notify.ts:50`; also `snag-email.ts:313`), whose handler is a pure passthrough — it forwards the caller's `html` to Resend unmodified (`send-email/index.ts:141-153`). The shell is therefore whatever the caller rendered, and four of the five shared renderers carry their own private, unbranded shell — `baseEmailTemplate` at `rfi-email.ts:60`, `qc-email.ts:20` and `snag-visit-email.ts:27`, and `inviteBaseTemplate` at `invite-email.ts:46`. Only `site-form-email.ts:209` uses `renderBrandedEmail` (`packages/shared/src/email/layout.ts:97`), and that module's own header says migrating the others was deliberately left out of scope (`layout.ts:4-9`, `:16-17`). Push is Expo-only and returns `{sent:0}` on every call — `push_tokens` is empty and its CHECK admits only `ios|android` (`send-notification/index.ts:103-114`; `00008_attachments_notifications.sql:33`). There is no service worker and no web manifest anywhere in `apps/web/public`, which holds exactly one file, `pdf.worker.min.mjs` (verified).

Read tracking is worse than absent — it is dishonest. `read_at` has existed since `00001_initial_schema.sql:151` and **nothing has ever written it**; the client sets `is_read` alone (`NotificationCentre.tsx:62`). "Mark all read" is an unscoped `UPDATE … WHERE is_read = false` across a user's entire history (`:51-56`). The panel fetches the newest thirty rows with no unread filter and no project scope (`:41-46`), and its realtime channel subscribes to **INSERT only, with no filter at all** (`:29-33`), refetching on every insert in the table. **57 of 964 is therefore not a read rate; it is the number of times someone clicked a specific row before something else cleared the rest.** The true engagement figure is unknowable from the current schema — which is itself the finding.

**Four structural hazards to retire.**

1. **`notifications_own` is `FOR ALL … USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`** (`00019_notifications.sql:35-38`). The client owns its own read state through direct PostgREST, so no metric built on it can ever be audit-grade.
2. **`notifications_type_check` was declared once and re-declared wholesale five times.** It is created at `00066:654` with no prior constraint to drop, then dropped and re-declared in full at 00072, 00173, 00176, 00178 and `00179_site_forms.sql:596-621` — five re-declarations, each obliged to re-list every prior value or silently delete types. The Q1 migration in the table at the end of this section is the **sixth and last**, after which the FK to `notification_types` retires the pattern (§12 and §03 §1.10 phrase it the same way).
3. **A bad type loses the bell for the entire batch, silently.** The insert is one multi-row statement whose error is only `console.error`'d (`send-notification/index.ts:99-100`), and `dispatchNotification` never throws (`apps/web/src/lib/notifications.ts:52-56`). This is not hypothetical: `compliance-complete/index.ts:177-184` inserts `type: 'compliance_complete'` — never a legal CHECK value — together with a `metadata` column that does not exist on `public.notifications` (the column is `data`, added at `00019:12`). Every one of those inserts has always failed on two counts, logged at `:191` and discarded.
4. **`project_notification_recipients` is an unauthenticated directory dump.** It is `SECURITY DEFINER` with `SET row_security TO 'off'`, performs no membership check on the caller, and is granted `TO authenticated, service_role` with no `REVOKE … FROM PUBLIC` and no explicit `anon` revoke (`00146:22-61`; line 61 is the last line of the file and no later migration touches it). Any signed-in user — a contractor in another organisation — can pass any project UUID and receive every member's id, full name and email. Per this project's own documented Supabase behaviour, `anon` very likely holds EXECUTE as well, because `ALTER DEFAULT PRIVILEGES` grants it directly at creation.

### The model

**Decision: the Inbox and the Activity feed are different objects.** `public.notifications` becomes strictly *things aimed at you* — the surface that must reach zero. Everything else becomes a project-scoped activity event with no per-user fan-out. That feed is **`projects.activity`**; its DDL is carried by §06 §4.3, which writes `actor_id`, `verb`, `subject_type`/`subject_id` and `thread_id` into it by trigger, and it **exists from Q1** (Appendix A(f)), one quarter ahead of the threads that also write to it — the Q1 recap's section 4 has no other source. This engine requires only that recap-tier events write there and never to `notifications`. It is not `public.audit_log`: `audit_log` (`00001_initial_schema.sql:124-135`) stays the immutable machine record of `old_values`/`new_values`; `projects.activity` is the human-readable feed a PM reads over coffee. Neither is derived from the other.

**Volume projection.** 964 − 750 `diary_created` = 214 rows from every other type combined. The six remaining roster types contribute the bulk of those 214 at ~14 recipients per event and each becomes one `projects.activity` row plus at most one targeted row; the already-targeted types (`rfi_response`, `rfi_closed`, `snag_status_changed`, the five inspection types) contribute ~2 recipients per event and survive unchanged at roughly 35 rows. Add the rows the old model never produced — one assignment or ball-in-court row per RFI (15), snag (6) and inspection (18) ≈ 40 — plus mentions. Call it **≈120 against 964**, and treat it as a projection over the same event stream, not a measurement.

**Decision: tiers become data, not a CHECK constraint.** `public.notification_types(type PK, tier, default_audience, always_fires boolean, module, is_active)`, seeded from **the enumerated constraint set UNION the live `SELECT DISTINCT type`** — 18 values at `00179_site_forms.sql:596-621` — with an FK from `notifications.type` added `NOT VALID` and `VALIDATE`d after seeding. **Appendix A(c) is the registry**: every type, its tier, its audience, its always-fires flag and the quarter in which it is registered live there and are not restated in this section. `notification_types` gets a permissive SELECT policy for `authenticated` and an explicit `anon` revoke. Adding a type becomes an INSERT; the re-declaration hazard disappears. The three never-emitted values are **not deleted** — they are seeded `is_active = false`, so the FK validates against any historical row and the retirement is a fact in a table rather than an omission from a constraint. The FK alone does not fix hazard 3 — see §(i).

The `ALTER TABLE` below adds **thirteen** columns to `public.notifications`, not twelve — thirteen `ADD COLUMN` clauses, counted, because A(f)'s Q1 column-add row and §13's migration grouping both cite this block by its count and a stale twelve would leave one column created by nobody:

```sql
ALTER TABLE public.notifications
  ADD COLUMN project_id   UUID REFERENCES projects.projects(id) ON DELETE CASCADE,
  ADD COLUMN actor_id     UUID REFERENCES public.profiles(id),
  ADD COLUMN tier         TEXT NOT NULL DEFAULT 'held',
  ADD COLUMN dedupe_key   TEXT,
  ADD COLUMN coalesced_count INT NOT NULL DEFAULT 1,
  ADD COLUMN hold_until   TIMESTAMPTZ,
  ADD COLUMN hold_extensions SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN seen_at      TIMESTAMPTZ,   -- rendered in an open inbox
  ADD COLUMN cleared_at   TIMESTAMPTZ,   -- triaged out, NOT read
  ADD COLUMN email_state  TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN push_state   TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN read_at_estimated BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT notifications_never_self CHECK (actor_id IS NULL OR actor_id <> user_id),
  ADD CONSTRAINT notifications_actor_required
      CHECK (actor_id IS NOT NULL OR created_at < DATE '2026-10-01') NOT VALID;

CREATE UNIQUE INDEX notifications_coalesce_key
  ON public.notifications (user_id, dedupe_key)
  WHERE cleared_at IS NULL AND read_at IS NULL AND dedupe_key IS NOT NULL;
```

`dedupe_key` is `'<entity_type>:<entity_id>:<tier>'`; the partial unique index on **`(user_id, dedupe_key)`** is what makes coalescing an UPSERT rather than a cross-user merge. `organisation_id` (`00001:143`) is NULL on all 964 rows because nothing has ever successfully written it — **decision: backfill it from the project's organisation and make it NOT NULL for new rows**, since every read gate and every report-kind policy in the platform keys on org.

**Decision: `is_read` is dropped, not converted.** Postgres cannot convert an existing column into a generated one, and a `DROP`/`ADD GENERATED` would silently take `idx_notifications_user_unread` with it (`00019:22-24`, partial `WHERE is_read = FALSE`) while breaking every deployed writer — `NotificationCentre.tsx:54` and `:62` both UPDATE it, and writing a generated column raises rather than being ignored. Unread is a property of `read_at` and belongs in the inbox view, not a column. Sequence, in this order: (1) ship the client change that stops writing `is_read` and reads `read_at`, and remove `is_read: false` from `compliance-complete/index.ts:184`; (2) migration `DROP COLUMN is_read`, then `CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, created_at DESC) WHERE read_at IS NULL`; (3) verify by reading the table definition and `pg_indexes` back — a green `Deploy DB Migrations` is not evidence a migration ran.

**Decision: the client can read its inbox and nothing more.** `notifications_own` is dropped and replaced by:

```sql
DROP POLICY notifications_own ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_no_client_insert ON public.notifications
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY notifications_no_client_update ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY notifications_no_client_delete ON public.notifications
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated, anon;
```

The restrictive policies are scoped per command deliberately — a restrictive `FOR ALL … USING (false)` would also kill SELECT. All writes go through four `SECURITY DEFINER` RPCs with `search_path` locked and `SET row_security TO 'off'` (the `00146` pattern), each carrying `REVOKE EXECUTE … FROM PUBLIC` **and** an explicit revoke for `anon`, verified with `has_function_privilege('anon', oid, 'EXECUTE')` and never by reading `proacl` — a NULL `proacl` looks empty but *is* the PUBLIC grant. None of them uses `current_user` for authorisation.

#### (a) Urgency tiers

| Tier | Bell | Push | Email | Rule |
|---|---|---|---|---|
| **Immediate** | now | now, unless quiet hours | after a 60 s grace, only if still unseen | Direct address only |
| **Held** | now | at window close if unseen | at window close if unseen | 5-min coalescing window per record |
| **Recap** | never | never | 07:00 line only | Writes `projects.activity`, not `notifications` |

**Which tier each type carries, who receives it, whether it always fires, and the quarter it is registered are in Appendix A(c). This section does not restate them** — one table, one place, asserted by §12 §(h)'s set-equality contract test in both directions. What belongs here is the evidence about the code as it stands, and the reading of it.

Where the fifteen live types are emitted today — evidence, not a registry:

| Type | Emitted at | Audience today |
|---|---|---|
| `rfi_created` | `rfi.actions.ts:84-94` + `rfi-email.ts:50` | roster (bell minus raiser; email incl. raiser) |
| `snag_created` | `snag-email.ts:86-99` | roster |
| `diary_created` | `diary-email.ts:83-95` | roster |
| `qc_issued` | `qc-email.ts:89-101` | roster |
| `qc_comment` | `qc.actions.ts:439-455` | roster, issued reports only, bell only |
| `snag_visit_completed` | `snag-email.ts:241-253` | roster |
| `site_form_distributed` | `site-form-email.ts:340-353` | roster |
| `snag_status_changed` | bell `snag.actions.ts:107-117` / `:195-215`; email `snag-email.ts:277-313` | **bell targeted, email roster** |
| `rfi_response` | `rfi.actions.ts:163-173` | raiser + assignee |
| `rfi_closed` | `rfi.actions.ts:219-229` | raiser + assignee |
| `inspection_assigned` | `inspections.actions.ts:282-292`, `:339-349` | assignee |
| `inspection_awaiting_verification` | `inspections.actions.ts:544-553` | verifier |
| `inspection_abandoned` | `inspections.actions.ts:631-641` | assignee + verifier |
| `inspection_certified` | `inspections-certify.actions.ts:277-288` | contributors + PMs |
| `inspection_re_inspect_required` | `inspections-certify.actions.ts:334-346` | contributors |
| `rfi_assigned`, `grn_recorded`, `inspection_revoked` | — | **never emitted anywhere** (`00179:601`, `:604`, `:614`) |

**Six of the fifteen live types fan out to the whole roster and account for essentially all 964 rows; three are dead constraint values, retired rather than tiered; five leave the inbox entirely under the new model** — the six recap-or-distribution-list types become `projects.activity` rows or narrow to a named list, per A(c). Note `snag_status_changed`: its bell has been correctly targeted since `snag.actions.ts:107-117` while its email still goes to everyone — one event, two audiences, no way to reconcile them. Computing the recipient set once, in one place, is the whole point.

#### (b) Presence, coalescing, actor exclusion, and the thing that releases them

**The dispatcher.** A `pg_cron` job **every five minutes** POSTs to `/api/cron/dispatch`, a **Next route handler, not an edge function** (§(d) carries the reason, and A(g) records both cron surfaces as `api` routes). It selects rows where `hold_until <= now() AND email_state = 'pending'`, applies the rules below and sends.

**Five minutes, not the one-minute tick this section previously specified.** §15 §(b2) owns the scheduled-job ledger and prices this job at every 5 min against a 15-minute staleness threshold — three missed ticks before `job_missed` fires — and a per-minute tick would make that threshold fifteen missed ticks for the same alarm. The only thing a per-minute tick buys is up to four minutes off an Immediate **email** whose bell and push have already fired at write time; that is not worth two different cadences in one document. Consequence, stated so nobody is surprised: the 60 s Immediate grace resolves within one to six minutes of the event, and a five-minute Held window closes within five to ten. Each run writes `public.notification_dispatch_runs(started_at, considered, sent, suppressed, deferred, failed, status, skipped_reason)` **on every tick, including a tick that did nothing** — which writes `status = 'skipped'` with its reason, per §15 §(b2) rule 1, so that "no row" means "did not run" and never "ran and had nothing to do" — and so "why did nothing go out?" is answerable from a table.

**Because both cron surfaces are route handlers, Q1 introduces zero new edge functions.** Every Q1 deliverable in this section ships on a Vercel deploy plus a Management-API cron entry, and **no Q1 deliverable waits on the `workflow`-scoped GitHub token** obtained in §13 item 0 — that token is needed only for the two Q2 functions in §(f) and §(h).

**Presence — specified in §15, created in A(f)'s Q1 ordinal 1, consumed here.** This engine defines no presence table and creates none: `user_presence`, `user_sessions` and `touch_presence()` are created **once**, in §15's metrics migration, which is A(f)'s Q1 ordinal 1 and lands first of the substantive set. §15 owns two objects with one writer: `public.user_presence(user_id, last_active_at)`, the current-state row this dispatcher branches on, and `public.user_sessions(user_id, started_at, last_seen_at, user_agent, platform)`, the append-only history the metrics read; the **same RPC `public.touch_presence(p_platform)`** writes both, so a session can never exist without presence having been written and the two can never disagree. The heartbeat runs every 60 s from the Inbox and project shells only — not every page — through that `SECURITY DEFINER` RPC rather than a PostgREST upsert, which sidesteps the `Prefer: resolution=merge-duplicates` header trap that has already silently no-opped a `project_settings` upsert in this codebase; a row older than 15 minutes is treated as absent. The one thing this engine adds is `notifications.seen_at`, marked by an `IntersectionObserver` batch (≥1 s in viewport) through one of the four RPCs above. At window close the dispatcher applies, in order:

1. `seen_at` or `read_at` set → `email_state = 'suppressed'`, `push_state = 'suppressed'`.
2. `last_active_at > now() - 5 min` **and `hold_extensions < 2`** → extend `hold_until` by five minutes, increment `hold_extensions`.
3. Otherwise send.

Suppression means the user has been present in the last five minutes **on the surface the notification targets**, not merely somewhere in the product.

**Presence may only delay, never suppress.** Two extensions is the ceiling — ten minutes — after which the row sends regardless. Without a ceiling, a shared site PC or an office laptop parked on the project page keeps `last_active_at` fresh all day and the recipient never receives mail for something they never actually looked at; the rule meant to cut noise becomes a delivery black hole for exactly the least-engaged users the programme exists to activate. Anything still unsent at 22:00 SAST is marked `email_state = 'rolled_to_recap'` and appears in the next morning's recap instead of arriving at midnight.

**Coalescing.** Five-minute window keyed on `(user_id, dedupe_key)`; a second event inside the window increments `coalesced_count` and rewrites the title ("3 updates on RFI-014") rather than inserting a row — an UPSERT against `notifications_coalesce_key`. Caps: **one email and one push per recipient per record per hour**, counted over `(user_id, dedupe_key, delivered_at > now() - interval '1 hour')` — Fieldwire's proven per-task numbers (5-minute batching, capped at one email per hour, author excluded; `research/01-field-first.md:11`, `:143`). A second, global cap of **six pushes per recipient per hour across all records is our own number**, chosen so that a busy tenant-fit-out day cannot exceed one buzz every ten minutes; no competitor publishes a global figure and none is claimed here.

**Actor exclusion** is computed once, in the dispatcher, from a single recipient set that both bell and email consume — replacing the split at `notify.ts:33-34` where the bell filters the actor out and the email does not. The `notifications_never_self` CHECK is a backstop against a future writer, described as such: it cannot reach the email path at all, and while `actor_id` is nullable on the legacy 964 rows a writer that omits it would satisfy the constraint vacuously. `notifications_actor_required` closes that for every row created from the cutover date.

#### (c) Preferences — three controls in Q1, a fourth in Q3

`public.notification_preferences`, one row per profile. Two columns are user-visible, plus a per-project mute:

| Exposed in v1 | Values | Default |
|---|---|---|
| `scope` | `aimed_at_me` \| `everything` | `aimed_at_me` |
| `recap_hour` | 05–10 | `7` |
| `notification_project_mutes(user_id, project_id, muted_until)` | one link per recap footer | none |

| Not exposed in v1 | Behaviour |
|---|---|
| `timezone` | Derived from the organisation; `Africa/Johannesburg` for every current account |
| `channel_email` | Flipped only by the one-click unsubscribe link |
| `channel_push` | Flipped only by the browser permission prompt and its revocation |
| `quiet_start` / `quiet_end` | Fixed at 18:00–06:30 SAST |

That is the entire settings surface: **three controls in Q1; a fourth — `chase_opt_out` — when the chase sweep ships in Q3**, added as a column on this table by the Q3 migration (A(f)) and read by §10.2's selection query, which skips any person carrying it. It is exposed only once there is something to opt out of; a checkbox that governs nothing for two quarters teaches people the settings page lies. Per-type toggles are refused at every point. Linear groups types and Basecamp offers two scopes precisely because nobody tunes forty checkboxes, and Asana's forums carry both the "we are getting bombarded" threads (2020 and 2023) and a Dec-2024 "Don't batch notifications" thread — proof that batching must be per-user, not a global setting (`research/03-work-os.md:37`). PlanRadar's shape — a per-user digest with a chosen delivery time and a scope selector, new users defaulted to "assigned to me, daily" — is the one adopted (`research/01-field-first.md:144`).

**Migration of existing users:** backfill one row per profile at `scope='aimed_at_me'`, 07:00, email on, push on. **Nobody is migrated to `everything`** — `everything` is exactly what produced the 750 diary bells. The six `notify_*` project booleans survive but change meaning: they gate whether the *module emits an event at all*, not per-user delivery, and `notify_inspection_email` is flipped to `true` on migration because its `false` default (`00101:45`) is the reason eighteen inspections have sat untouched. `notify_rfi_to` is retained and generalised into a per-project external-observer list for people with no account — its first actual use, since no send path reads it today.

#### (d) The 07:00 SAST daily recap

Content, in this order:

1. **Needs you today** — items where you hold the ball, overdue first, then due today, then due this week.
2. **Overdue** — holder only, with days late and who is waiting. In Q1 and Q2 this is the *only* place overdue appears (§(e)).
3. **Waiting on others** — items you raised or assigned, each naming the current holder.
4. **Yesterday on your sites** — `projects.activity` rows grouped project → module, with "no diary entry logged" called out as a gap.
5. **Unread inbox** — count plus the top five, deep-linked.

**The skip rule is load-bearing: a recap sends only if section 1, 2, 3 or 5 is non-empty. Section 4 alone never justifies an email** — a daily digest of other people's diary entries is the 750-row firehose in a new wrapper.

**Generation.** `public.build_daily_recap(p_user_id uuid, p_for_date date) RETURNS jsonb` returns **the payload only** — a SQL function cannot render HTML. It is `SECURITY DEFINER`, `search_path` locked, `SET row_security TO 'off'`, `REVOKE … FROM PUBLIC` plus an explicit `anon` revoke verified with `has_function_privilege`, and never uses `current_user` for authorisation.

**Rendering and sending: a Next route handler, not an edge function.** `/api/cron/daily-recap` fetches each payload and renders it through `renderBrandedEmail` (`layout.ts:97`) with the project logo as a **signed URL, never a `data:` URI** (`layout.ts:19-22`), then posts to `send-email`. Rationale, stated as a decision: **no edge function in this repo has ever imported `@esite/shared`** — every one duplicates the logic under `functions/_shared/` (`calculate-health-scores/index.ts:12-14`: "Keep the math in lockstep with packages/shared…"), and that exact duplication produced the live cloud-storage drift incident when `sortCloudItems` was lost. Vendoring `layout.ts` into `functions/_shared/` behind a byte-identical contract test would work; removing the duplicate outright is better. `/api/cron/dispatch` (§b) is a route handler for the same reason, **and the consequence is deliberate: Q1 adds no edge function at all, so nothing in this quarter depends on the `workflow`-scoped token or on a manual `supabase functions deploy`.** §13 item 7's "new `daily-recap` edge function" is superseded by this decision. Both routes authenticate a constant-time comparison of an `x-cron-secret` header and are listed in `docs/rbac-matrix.md` as service-only, with `CONFORMANCE.md` updated in the same PR because each introduces a new bearer credential (A(g)).

Each run writes `public.recap_runs(user_id, for_date, sections jsonb, skipped_reason, sent_at)` with `UNIQUE (user_id, for_date)` so a retried tick cannot double-send and "why did I not get a recap?" is answerable from a table.

**Deliverability and POPIA.** Every recap carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers pointing at a one-click endpoint that sets `channel_email = false` — a **distinct** flag from `profiles.marketing_emails_opted_out` (`00030:55`), so opting out of the digest does not silently opt a user out of lifecycle mail or vice versa. External observers on the generalised `notify_rfi_to` list receive **item mail only, never the recap**, until they hold an account: a scheduled bulk mailing to people who never registered is a POPIA question this design declines to have rather than answer.

**Four deliverability facts, because a recap that lands in spam is not a channel.** (1) **SPF, DKIM and DMARC alignment for `e-site.live` is confirmed in Resend before the first recap is sent**, not after the first complaint — this is scoped into §13 item 0 alongside the delivery evidence, and the recap's exit criterion is meaningless without it. (2) **`in.e-site.live` carries an MX record and nothing else.** It is never a sending domain, no mail is ever `From:` it, it therefore needs no DKIM key of its own, and it **cannot affect the sending reputation of `e-site.live`** — the two are separate DNS names with separate roles, which is the whole reason the inbound hostname is a subdomain rather than the apex. (3) **Volume ramps with the rollout waves, not with a switch.** The recap goes live for Wave 1 — two to three people on KINGSWALK in Q1 week 1 — and widens to Wave 2's remaining contractors across Q1 weeks 4–8, so daily send volume grows from single digits to a few dozen over eight weeks rather than 36 accounts appearing on the same morning; a cold domain that starts at its ceiling is how a legitimate sender earns a reputation problem. (4) **Resend's bounce and complaint webhook is wired to the suppression list built in §13 item 0**, and that list is consulted before every send, recap and item mail alike. A hard bounce suppresses the address and raises a work item for the PM to correct it, because an address that cannot receive mail is an account estate problem, not a mail problem.

**Scheduling — the sequence, as a decision.** Not in a migration. Every `cron.schedule` in this repo is commented out (`00029:59`, `00030:62-66`, `00031:59`, `00148:136-147`), and the one that mattered was never applied: `cloud-sync-poll` sat as an informational block using `current_setting('app.settings.service_role_key', true)` (`00148:142`) — unusable — and all eleven runs ever were manual. Putting `cron.schedule` in a migration ships a recap that silently never runs, behind a green workflow. The order is:

1. Migration, numbered against `max(version)` **and** `origin/main` immediately before applying, announced to peer sessions, verified by reading the affected table back.
2. Vercel deploy (automatic on merge) so the two route handlers exist. **In Q1 the sequence stops here** — there is no function to deploy.
3. Q2 only: CLI deploy of the two new edge functions (§(f), §(h)) — edge functions do **not** auto-deploy; `.github/workflows/deploy-edge-functions.yml` is `workflow_dispatch:` only (`:7-8`) and lists functions individually (`:29-51`), so it must gain a step per function and the run is a deliberate manual act.
4. Schedule via the Supabase Management API with the service-role key **inlined in the SQL**, matching prod cron jobs 1–8: `daily-recap` at `'0 5 * * 1-6'` (05:00 UTC = 07:00 SAST, no DST, Monday to Saturday because SA sites work Saturdays, the same premise as the `site` calendar in A(h)), `notification-dispatch` at `'*/5 * * * *'` — the five-minute cadence §15 §(b2)'s ledger publishes for this job.
5. Verify with `SELECT jobname, schedule, active FROM cron.job` and by reading `public.recap_runs` and `public.notification_dispatch_runs` back after the first tick. A scheduled job with no run row inside its threshold raises `job_missed` to the org owner (A(c)).

Any function-to-function hop forwards the caller's Authorization header: the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as an `sb_secret_…` string, not a JWT, and a role-gated callee will 403 (the PR #153 lesson).

#### (e) Rules that fire regardless of preferences

Four events ignore `scope` and project mutes: **assignment** to you; **ball-in-court shifting** onto you; **overdue**, to the current holder; and **@mention**. These are the `always_fires` rows in A(c). They honour exactly three switches, per §13: `projects.project_settings.suppress_all_outbound` (default false, set on every throwaway verification project — without it, exercising assignment on production emails the whole firm, because `project_notification_recipients()` resolves 12–13 real wmeng.co.za addresses), the global unsubscribe at `apps/web/src/app/(legal)/unsubscribe`, and the bounce/complaint suppression list. `channel_email = false` is honoured for all four; **the in-app bell is never suppressible**, matching CompanyCam. Push inside quiet hours is still held for these, with one exception — an overdue escalation on a safety-gated item (isolation form, CoC, inspection blocking energisation) is delivered, because the cost of the interruption is lower than the cost of the omission.

**Overdue has exactly one producer, and this section is not it.** From Q3, `work_item_overdue` is produced **solely by the chase sweep** described in §10.2, on that section's ladder: a **72-hour minimum interval per item**, with rungs at **day 1** past due (the holder), **day 4** (the holder plus the other named party on the item), **day 8** (those two plus the project manager) and **day 15** (nudging stops; the item moves to the weekly report's exceptions table, which is a management artefact rather than a message). **This section's earlier independent daily cadence, and its escalation to holder *and* assigner at +7 days, are deleted.** Two producers over one event would mean an overdue item generating a daily notification *and* a 72-hourly nudge, on different cadences to different recipient sets, with §10.2's hard limits binding only one of the two paths.

What this section owns is the **delivery contract** the sweep writes into, and only that: the notification is non-suppressible by `scope` or by a project mute; it is addressed to `ball_in_court_id` and **never to the roster** — nudging the contractor who already answered an RFI now sitting with a WM gatekeeper reads as harassment for someone else's inaction; `channel_email = false` is honoured; and the in-app bell is not suppressible under any preference.

**Before the sweep exists — that is, throughout Q1 and Q2 — overdue appears only as section 2 of the 07:00 recap, and never as an independent notification.** No bell, no push, no separate email, no `work_item_overdue` row: an item that is late is a line in the morning digest of the person holding it and nothing more. This is a deliberate, stated gap of two quarters, and it is the honest one — the alternative is shipping a cadence in Q1 that Q3 then has to unship.

#### (f) Reply-by-email

**Address scheme.** Inbound domain **`in.e-site.live`**, MX-delegated, and that hostname is fixed regardless of which transport carries the mail. Per-recipient tokens: `wi-<short_id>-<hmac10>@in.e-site.live`, the HMAC covering `kind|item_id|recipient_user_id` under a server-side secret. Because the address is per-recipient, a leaked address grants one person's voice, is revocable, and identifies the leaker. Set as `Reply-To:` on every item email; `From:` stays `noreply@e-site.live` for deliverability, display name "Arno Watson via E-Site".

**Provider — decided, not deferred.** Inbound arrives via **Cloudflare Email Routing → Worker → the `inbound-email` edge function**: free (A(i) prices it at R0), available on the current account today, and provider-independent. The standardwebhooks signature verifier already exists in `auth-email-hook` (`apps/edge-functions/supabase/functions/auth-email-hook/index.ts:22,177-180`) and is reused to authenticate the Worker's HTTP request — without it the endpoint is an unauthenticated `app/api`-class surface accepting forged mail-shaped JSON.

**One substitution is admitted, and only one.** The Q1 week-1 entitlement ticket (§13 item 0) may come back confirming **Resend Inbound**; if it confirms **raw-MIME retrieval** and demonstrably simplifies attachment handling, Resend replaces Cloudflare as the transport and the vendor list loses a row. Nothing else moves. **The parser consumes raw MIME, so the transport adapter is the only thing that changes** — not the hostname, not the token scheme, not a single parsing rule, not `field.inbound_messages` (A(a2)), not the security checks below. That is why this is a priced substitution rather than an open decision, and why the ticket is raised in Q1 week 1 for a Q2 deliverable rather than at the moment of need.

**Parsing.** Prefer `text/plain`. Cut the quoted reply at the sentinel `-- Reply above this line --` that every outbound email carries as its first body line; fall back to `On … wrote:`, `-----Original Message-----`, localised `Van:`/`From:` blocks and `>`-prefixed runs. Strip signatures after `-- \n` and after "Sent from my iPhone". Attachments: ≤10 files, ≤25 MB total; images downscaled to 2048 px and filed to the item's photo set; PDFs and documents to attachments; archives and executables refused. HTML sanitised to a whitelist.

**Where inbound mail is stored — one table, specified once, in Appendix A(a2).** Every message the function accepts, and every one it refuses, writes a row to **`field.inbound_messages`**. **Its column set, its single verdict column and that column's value set are A(a2)'s and are not restated here.** This object had been declared twice — in this subsection and again in §11.3 — with every shared column renamed, two disposition designs and two rejection vocabularies, inside a document that twice asserts there is one table under one name. A(a2) settles it on **this section's** column set (its typed FKs `work_item_id` and `thread_message_id` are the anti-polymorphic decision §03 §1.2 and §04 take by name; §11.3's `(disposition_entity_type, disposition_entity_id)` pair does not exist) plus four columns §11.3 needed and this section lacked: `message_id` and `in_reply_to`, `resolved_role`, and `bytes`.

**Two consequences land in this section's own text.** The verdict column is **`result`**, with **`reason`** beside it — `verification_state` and `reject_reason` are gone, because §15 §(b)'s inbound-outcome metric and §11.3's "`inbound_email_events(result, reason)` is this same object under a second name" both key on those two names, and because `verification_state` conflated the outcome with the identity check. And the Unverified-inbound tray predicate of §(g) is **`result = 'unverified'`**; nothing else about the tray changes.

**What is this section's and stays here is the retention rule.** Raw MIME is filed to storage and **retained 90 days**, then swept by the same nightly job that expires signed URLs; body text and the verdict columns are retained with the item, because they are the record of what a person said. Placement and policy are A(a2)'s — `field` schema, Q2, already exposed, so **no PostgREST `db_schema` PATCH is involved** and the `PGRST002` failure mode is not in play; project-scoped RLS, `ORG_WRITE_ROLES` read, no client write path at all, `anon` SELECT revoked and verified with `has_table_privilege`. The table backs exactly three surfaces and is sized for all three: **the Unverified-inbound tray** of §(g); **the abuse metric** — rejects per project per week, which is the only way to notice an address being harvested; and **the support queue**, because "my reply never arrived" is otherwise unanswerable and the 90 days of raw MIME are what settle it.

**Security.** Three checks on the mail itself, on top of the Worker signature: (1) DKIM passes and aligns with the `From:` domain — a `From:` header is trivially forged, so the token alone is never sufficient; (2) the envelope sender matches `public.profiles.email` for the user the token was minted for; (3) that user still passes `user_has_project_access` (`00106_relax_user_has_project_access.sql:35`) for the item's project **at the moment of receipt**, never from a snapshot. **A DKIM-valid reply that fails check (2) is not bounced** — it is written `result = 'unverified'` (A(a2)), routed into the Unverified-inbound tray, attached to the item, with a one-click "this is me" link for the PM that binds the alias to the profile. Site foremen reply from phone aliases, forwarded mailboxes and shared site addresses; bouncing them destroys mail from exactly the thirteen contractor accounts, zero active in thirty days, that this programme exists to reach, and a bounce is indistinguishable from the product being broken.

**Which failure classes bounce and which do not is A(a2)'s table, and this subsection's earlier "only DKIM failures and auto-responder traffic are rejected outright" is replaced by it**, because a three-value vocabulary could not express the size, rate-limit and quarantine outcomes this function actually produces. In A(a2)'s terms: a DKIM failure or a misaligned `From:` domain bounces (`bounced_dkim`); a revoked or expired token, a closed item or a lost project access bounces (`bounced_access`); an over-limit message bounces naming the limit (`bounced_size`). An HMAC that does not verify, or resolves to nothing, is **`quarantined` and never bounced** — a bounce confirms to a forger that the address exists. Auto-responder traffic — anything carrying `Auto-Submitted: auto-*`, `X-Autoreply` or `Precedence: bulk`, or an empty stripped body — is **`rejected_auto` and never bounced**, which is what stops an out-of-office loop. `unverified` and `quarantined` are separate verdicts precisely because one is posted and one is not. **§06 §4.1's "a message failing verification is bounced and never posted" is amended by A(a2) to match: a DKIM failure or an access failure is bounced and never posted; an identity mismatch is posted `unverified` and is visibly marked as such on the thread.** Tokens revoke when access is lost or the item closes. Rate limits: 20 posts per user per hour, 60 per project per hour, **queued, never dropped** — the row carries `result = 'rate_limited'` until the queue drains, when its verdict is rewritten to a terminal one, and it bounces only if still queued after 24 h (A(a2)). The function writes `author_id` resolved from the token, never from a header, and is gated at the DB with a RESTRICTIVE policy as well as in code, because an edge function sits outside every page gate.

**Fan-out afterwards.** The parsed reply becomes an ordinary thread comment and re-enters this engine unchanged: participants get `thread_reply` (Held), anyone @mentioned gets `mention` (Immediate), the author is excluded by the dispatcher's single recipient set. Asana's header semantics are adopted (`research/03-work-os.md:34`): a colleague's E-Site address in `To:` reassigns the item; in `Cc:` adds a follower. Both write `public.audit_log`.

#### (g) Email-to-item — **cut past twelve months; retained here as the design record**

> **Not committed.** Email-to-item was a 0.5-week Q2 line and is **cut, not deferred into a later quarter**. Nothing in the twelve months creates a work item from an unsolicited email. What ships instead is §(f) — reply-by-email into an item that already exists — which carries the Unverified-inbound tray and `field.inbound_messages` on its own budget, so the infrastructure this feature would need is in place if it is ever picked up. The design is kept below so that it does not have to be re-derived, and so the two decisions inside it that were wrong are corrected rather than left in the record.

Per-project address `<project_code>@in.e-site.live` (`kingswalk@in.e-site.live`), shown on the project page. Senders are accepted if they are a project member, on the project's external-observer list (the generalised `notify_rfi_to`), or on a per-project `inbound_allow_domains`; everything else, plus the identity-unmatched replies from §(f), is written to `field.inbound_messages` with `result = 'unverified'` (A(a2)) and lands in the **Unverified-inbound tray** visible to PMs — never silently dropped, never auto-created.

A permitted mail creates one `projects.work_items` row, in §03's vocabulary and no other:

- `item_type = 'task'` — the only sourceless, client-insertable type besides `approval` (A(a), A(b)). **`kind = 'triage'` is deleted: `triage` is a status, never a type.**
- `origin = 'manual'`.
- `status = 'triage'`. **`status = 'untriaged'` is deleted** — it is not in the five-value set `triage, open, answered, closed, void` that §15 metrics 4 and 7 read.
- `assignee_id` = **the project's resolved triage owner**, through §03's chain — per-type `work_item_defaults`, then `project_settings.triage_owner_id`, terminating at the org owner, never raising. **`assignee_id = NULL` is deleted**: the column is `NOT NULL` and an item that belongs to nobody cannot exist (A(a)).
- `due_date` from the `task` default — **+5 working days on the `office` calendar** (A(b), A(h)).
- Subject → title, stripped body → description, attachments preserved, `work_item_id` written back onto the `inbound_messages` row.

`ball_in_court_id` follows from `status = 'triage'` and needs no separate write: the generated column resolves to `assignee_id` in that state. **Creation notifies nobody** (Basecamp Forwards). Because the row is assigned and dated by construction, it appears in the triage owner's Inbox and under the triage filter on My Work — **there is no separate queue and no state in which an item is untriaged and therefore invisible** — and it is counted in that person's recap section 1, with `triage_item_received` (Recap tier, A(c)) as the only notification the flow emits. That is what stops a forwarded consultant mailing list becoming a new firehose.

#### (h) Web push and the installable PWA

`push_tokens` cannot hold a Web Push subscription — its CHECK is `ios|android` and every row is an Expo token (`00008:33`). New table `public.web_push_subscriptions(user_id, endpoint UNIQUE, p256dh, auth, user_agent, last_success_at, failure_count, is_active)`; `push_tokens` is left untouched for the parked Expo app.

VAPID: one key pair per environment, generated once. Public key ships as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; the private key exists only as a Supabase edge secret and in `.secrets/`, never in the repo or a client bundle. Rotating invalidates every subscription, so it is a one-way door. A new `send-web-push` edge function signs the VAPID JWT and deactivates subscriptions on 404/410, reusing the sweep shape already proven for Expo `DeviceNotRegistered` (`send-notification/index.ts:140-151`). `apps/web/public/sw.js` and `manifest.webmanifest` are new — `apps/web/public` currently contains only `pdf.worker.min.mjs`; `notificationclick` focuses an existing client on `action_url` rather than opening a duplicate tab.

Permission is never requested on first load. It is asked once, contextually, immediately after the user closes their first work item or is assigned one. Declined once → never asked again automatically. Quiet hours 18:00–06:30 SAST plus Sundays, evaluated in the user's timezone, with the safety-gated exception in §(e).

**Decision: the whole of this subsection is Q2. Q1 ships no manifest, no service worker and no install prompt.** The Q1/Q2 split is therefore clean: **Q1 ships (a)–(e) and (i)**; **Q2 ships `manifest.webmanifest`, `sw.js`, the install prompt, the permission prompt and `send-web-push`**, alongside §(f). The earlier argument for pulling the install prompt into Q1 — that an installed app is what makes the Q1 activation metric reachable on a phone — **is withdrawn as factually wrong.** Activation is §15 metric 7: *a new user closes a first-run work item within their first session.* **A mobile browser satisfies that definition completely.** Nothing in it requires an installed app, a service worker or a push subscription, so the Q1 phone story is §13 item 10's responsive shell — 375 px, ≥44 px targets, camera capture through the existing `compressImage` path — and nothing more.

The dependency that is real runs the other way, and it is why all five pieces ship together: **on iOS, web push requires an installed home-screen PWA (16.4+)**, so a permission prompt without a manifest and a service worker reaches no iPhone at all. Shipping the install prompt a quarter early would put an install banner in front of the first contractors this firm has ever activated, in a quarter with 0.5 weeks of float on its critical chain, and buy nothing measurable. The consequence for the rollout is stated rather than hidden: the on-site session that §15's Wave 1 describes — PWA installed to the foreman's home screen, push granted in the room — becomes a **Q2** visit. The Q1 visit installs nothing, and still works, because the 07:00 recap and item email reach the same phone through a channel that needs no permission at all. Push is an accelerant; it is never the channel of record.

#### (i) Honest read tracking

Four server-written timestamps, set through the four `SECURITY DEFINER` RPCs described above — and, critically, **unwritable by the client at all**, because `notifications_own` is gone and `authenticated` holds no INSERT/UPDATE/DELETE grant on the table. Routing writes "through an RPC" in application code is not a gate; the same class of error as page-level gating on a directly-invocable server action.

| Timestamp | Set when |
|---|---|
| `delivered_at` | Row created, or push accepted by the endpoint |
| `seen_at` | Rendered ≥1 s in an open inbox |
| `read_at` | The item's target route rendered |
| `cleared_at` | Triaged out without opening |

The unscoped "Mark all read" (`NotificationCentre.tsx:51-56`) is deleted and replaced by **Clear**, which sets `cleared_at` and leaves `read_at` NULL — cleared items leave the inbox but appear once more in the next recap's unread section, so clearing is not a black hole. The rebuilt panel subscribes to **INSERT and UPDATE** on `public.notifications` with `filter: 'user_id=eq.<uid>'` — coalescing is an UPDATE, and the current channel (`:29-33`) listens to INSERT with no filter, so a coalesced row would never reach an open tab and the badge would silently under-count.

**Retiring the silent-loss path (hazard 3).** The dispatcher validates `type` against `notification_types` before insert and rejects an unknown type with a 400 rather than a swallowed constraint error. Inserts go row-by-row (or `ON CONFLICT DO NOTHING` with a returning count) so one bad row cannot take a whole roster with it, and every failed insert writes `public.notification_dead_letters(payload jsonb, error text, created_at)`. Without this the FK inherits the CHECK's failure mode exactly, and no volume metric in this section would be trustworthy.

**Engagement is §15 metric 5, and its definition lives there — this section cites it and does not restate the expression.** Metric 5 is a **union over the two halves the Inbox actually has**, because `done_at` lives on `public.inbox_state` and on nothing else: §04 confines it there, and the `ALTER TABLE` above adds `delivered_at`, `seen_at` and `cleared_at` and **no column named `done_at`** on `public.notifications`. The earlier single-table formula in this subsection read a column this section does not create; it is withdrawn rather than quietly corrected, because it was also published in §15 and the Q1 exit criterion rests on it. §15 owns numerator, denominator and the tier split; nothing here re-derives them.

**What this section owns is the delivery-side half of that metric, and it is asserted here.** All four timestamps above are server-written through the four `SECURITY DEFINER` RPCs and unwritable by the client, so the `notifications` half of the union is audit-grade; the split by tier is possible only because `tier` is a column on the row rather than a property of the sender, so a healthy Immediate rate cannot be hidden by a dead Held rate; and every metric query carries the standing `read_at_estimated = false` filter of the cutover below. Recap engagement is a `?r=<recap_id>` parameter on every deep link — a server-side click event — not an open pixel.

**The cutover, merged and single.** There is **one** history rewrite over `public.notifications`, run in the migration that adds the columns above, and §04's separate `done_at = now()` archive pass is not run beside it — two passes over 964 rows, writing two different columns to mean the same thing, is how the two sections would disagree about what day one looked like. The single statement set is:

- **all 964 rows** get `delivered_at = created_at`;
- **the 57 rows carrying `is_read = true`** get `read_at = created_at` **plus `read_at_estimated = true`**;
- **the other 907** get `cleared_at = <cutover>` **plus `read_at_estimated = true`**, so the Inbox opens empty on day one.

Every metric query carries the standing filter `read_at_estimated = false`, which excludes all 964 legacy rows from metric 5. That filter is not bookkeeping — it is the point. Metric 5 counts `cleared_at` as engagement (an inbox driven to zero is the goal), so 907 rows cleared by a migration would otherwise publish a ~94% engagement rate on day one, manufactured entirely by a statement nobody read. **No future metric may silently treat a reconstructed timestamp as measured**, and `read_at_estimated` is the column that makes the rule enforceable rather than aspirational. Verify by reading `count(*) FILTER (WHERE cleared_at IS NULL)` and `count(*) FILTER (WHERE read_at_estimated)` back afterwards: `db push` keys on the version prefix, so a green *Deploy DB Migrations* is not evidence the file ran.

### Cost and sequencing

**Migrations (six),** each numbered against `max(version)` **and** `origin/main` immediately before applying, announced to peer sessions, and verified by reading the affected table back. Numbers are claimed at merge, never in this document.

**The Q1 migration inventory and its ordering are Appendix A(f)'s, not this section's.** A(f)'s Q1 ledger carries **eleven migrations, ordinals 0–10**, and this table neither restates its contents nor re-orders it: the five Q1 rows below map one-for-one onto A(f) ordinals **0, 2, 3, 4 and 5**, and every Q1 object this engine *reads* but does not create — `user_presence`, `user_sessions`, `touch_presence()`, and the A(h) calendar — lands in **A(f) ordinal 1**, §15's metrics migration, which is first of the substantive set. Each file carries a `-- @verify:` header checked by `scripts/verify-migration-applied.ts` (§13 item 1) after the push.

| # | A(f) Q1 ordinal | Quarter | Contents |
|---|---|---|---|
| 1 | **0** | Q1 | `project_notification_recipients` hardened — a `user_has_project_access(p_project_id)` guard inside the function plus a service-role-only variant for the dispatcher, `REVOKE EXECUTE FROM PUBLIC` and `FROM anon`, verified with `has_function_privilege('anon', oid, 'EXECUTE')`. Ships first, alone, because it is a live cross-org data leak — and it is now **booked**, in A(f)'s ledger and §13's migration table, rather than designed here and scheduled in no quarter |
| 2 | **2** | Q1 | The **thirteen** `notifications` columns above + `notification_types` (seeded from the constraint set UNION live DISTINCT, retired values at `is_active = false`) + FK `NOT VALID`→`VALIDATE` + coalesce index + RLS replacement + the four RPCs + the single merged cutover of §(i). This is the platform's **sixth and last** wholesale re-declaration of `notifications_type_check` before the FK retires it |
| 3 | **3** | Q1 | `DROP COLUMN is_read` + rebuilt partial index (after the client change is deployed) |
| 4 | **4** | Q1 | `notification_preferences` + `notification_project_mutes`. **`user_presence`, `user_sessions` and `touch_presence()` are not created here** — they are created **once**, in A(f) ordinal 1, and this engine only reads them |
| 5 | **5** | Q1 | `recap_runs` + `notification_dispatch_runs` + `notification_dead_letters` |
| 6 | — | Q2 | `web_push_subscriptions` (`public`) + `field.inbound_messages`, whose DDL is **A(a2)** |

**Two Next route handlers** (`/api/cron/dispatch`, `/api/cron/daily-recap`), both Q1, both in `(api)` per A(g). **Two new edge functions, both Q2** — Q1 introduces none — with flags stated per function: `inbound-email` deploys `--no-verify-jwt` because the Cloudflare Worker's standardwebhooks signature is the authenticator; `send-web-push` deploys **with** gateway JWT verification, since its only caller is the dispatcher holding the service key. Both gain steps in `.github/workflows/deploy-edge-functions.yml`, which is `workflow_dispatch:` only (`:7-8`) and today names four functions, one of which (`generate-report`) has no directory, so a dispatch run already fails at that step and the file needs fixing in the same PR — that work, and the `workflow`-scoped token it needs, both fall in Q2 and block nothing in Q1.

In the same Q2 pass, `send-notification` and `send-email` are redeployed **without** `--no-verify-jwt` (`:33`, `:39`): under that flag their `role === 'service_role'` gate is a decoded, unverified claim (`_shared/auth.ts:4-6`, warned at `cloud-sync-project/index.ts:141`), and both are called only by holders of the service key. `send-email` gains a generic `notification` type with `Reply-To`, retiring the `'rfi-created'` masquerade (`notify.ts:50`, `snag-email.ts:313`), and the four private unbranded shells (`rfi-email.ts:60`, `qc-email.ts:20`, `snag-visit-email.ts:27`, `invite-email.ts:46`) are deleted and their callers migrate onto `renderBrandedEmail` (`layout.ts:97`) so every outbound mail carries the project's logo and accent. `docs/rbac-matrix.md` moves in the same PR as every new route, and `CONFORMANCE.md` in the same PR as both cron credentials and the inbound function. Cloudflare Email Routing is free; Resend at this volume, inbound and outbound together, is under R400/month (A(i)).

**Q1 ships (a)–(e) and (i)** — the hardened recipients function, tiers as data, the Inbox/`projects.activity` split, the dispatcher, presence suppression, three-control preferences, the 07:00 recap with overdue as its section 2, and honest read tracking. No manifest, no service worker, no install prompt, no edge function. That is "Every day starts here". **Q2 ships (f) and (h)** — reply-by-email with `field.inbound_messages`, then the manifest, service worker, install prompt, permission prompt and `send-web-push`. That is "One conversation per project". **§(g) email-to-item ships in neither**: it is cut past twelve months and retained above as a design record. **Q3 adds one column and one behaviour** — `notification_preferences.chase_opt_out`, and the overdue delivery contract of §(e) coming alive under §10.2's chase sweep.
