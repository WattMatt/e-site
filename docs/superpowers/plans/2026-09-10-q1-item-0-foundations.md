# Q1 Item 0 — Account Estate, Delivery Evidence and Workflow Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make E-Site able to measure whether an email it sends is delivered, opened, clicked, bounced, complained about or never left — because every Q1 outcome ships over that channel and today the platform has never measured a single one — and clear the two workflow prerequisites that block later quarters.

**Architecture:** A new `POST /api/webhooks/resend` Next route handler verifies the Svix (standardwebhooks) signature on Resend's raw request body, then writes an append-only row to a new `public.email_events` table, maintains a `public.email_suppressions` list from hard bounces and complaints, and stamps `public.email_sequence_events.opened_at` / `clicked_at` — the two columns `00030_email_sequences.sql:24-25` has advertised as "populated by Resend webhook (Phase 2)" since it shipped and which nothing has ever written. A one-off script pulls last-known delivery state from the Resend API for the 235 historical sends that carry a message id, and records the 11 that do not as the send failures they are. Two GitHub workflow files are corrected on a separate branch because the available token cannot push them.

**Tech Stack:** Next.js 15 App Router route handler (Node runtime), `node:crypto` HMAC-SHA256 (no new npm dependency), Supabase Postgres + RLS, Vitest, `node --experimental-strip-types` for the one-off script.

**Spec:** §13 item 0 (`13-roadmap-q1-q2.md:139-141`); §05 §(deliverability) `05-notifications-and-digests.md:173` facts (1) and (4) and `:187`'s three switches; §15 metric 2a (`15-metrics-risks-open-questions.md:39` — baseline 0/13, Q1 target 6/13) and the adoption risk (`:156`); §15 §(b2) Rule 3's Monday ops review (`:121`); Appendix A(f) Q1 `public` table row (`16-appendix-registries.md:332`), A(g) routes (`:387-388`), A(i) vendors; §12 §(c) migration protocol.

**Depends on:** nothing. This is the pre-window item; every other Q1 plan depends on it.

---

## Improvements folded in

Taken from the product review and built as real steps, not as notes:

| # | Improvement | Where it lands | Why it is in scope |
|---|---|---|---|
| 1 | **Turn Resend open tracking ON, click tracking OFF** | Task 7 Step 8; recorded in the note | Resend emits `email.opened` / `email.clicked` **only when tracking is enabled per domain**. Without this the whole item can ship, pass every check, and leave `opened_at` NULL forever — the very defect it exists to fix. Click tracking stays off because it rewrites every deep link through a Resend redirect host, and §15's diagnostics already specify server-side click measurement. |
| 2 | **Admit `email.failed`, and a `send_failure` source** | Task 1 CHECK constraints; Task 3 `RESEND_EVENT_TYPES`; Task 8 writes the 11 historical failures | Resend emits `email.failed` for sends that never left. Without it that event is 200'd and discarded — the most actionable negative signal thrown away. Production already shows 11 such sends sitting unexamined for five months. Two string literals now; a whole migration and a number claim later. |
| 3 | **`project_id` + `entity_ref` on `email_events`, extracted from Resend tags** | Task 1 DDL; Task 3 `readTags`; tag vocabulary fixed in both | `send-email/index.ts:27` returns `void` and throws the Resend response away, so no RFI, snag, invite or CoC mail has a stored message id. The webhook will otherwise log deliveries nobody can attribute to the thing they sent. Two nullable columns in a migration being authored anyway; NULL until item 4 sends tags. |
| 4 | **Back-fill reads the link host out of the HTML it already fetches** | Task 8 `hostsIn` + histogram | `_shared/email-sequence.ts:44` defaults `SITE_URL` to `https://app.e-site.live` — the DNS-less host behind the PR #138 incident. If the 246 lifecycle emails carried buttons pointing there, "zero clicks" and "five never signed in" have a cause no webhook can fix. Ten lines in a script, run inside a dry run that is already required. |
| 5 | **Back-filled rows carry the real `sent_at`, not the retrieval time** | Task 1 adds `retrieved_at`; Task 8 sets `occurred_at = row.sent_at` | Item 1 builds `platform_metrics_weekly` on this table in the very next item. `occurred_at = now()` would compress 2026-04-20 → 2026-08-30 into a single-day spike. The script already has `sent_at` in hand. |
| 6 | **Delivery baseline split by role cohort** | Task 8 Step 6 rollup SQL; note §4 | Wave 1 (contractors) and Wave 3 (client viewers) need different answers from the same data. Measured: all 13 contractors and all 4 client viewers hold `user_organisations` rows, so it is one `GROUP BY`. |
| 7 | **Read the signing secret inside the handler; put the Paystack webhook in the same bypass** | Task 4 route; Task 5 `SIGNED_WEBHOOK_PATHS` + tests | `apps/web/src/app/api/paystack/webhook/route.ts:50-70` verifies an HMAC-SHA512 over the raw body, constant-time, fails closed — structurally identical to the Resend route — and it is in neither `PUBLIC_PATHS` (`middleware.ts:5-20`) nor `SELF_AUTH_PATHS` (`:39`), so it is 307'd to `/login` today. One string in an array being edited anyway. |
| 8 | **"Done means" asserts the column this item exists to populate** | Done-means checklist; Task 7 Step 12 | Every original exit criterion could pass with `opened_at` still NULL on all 246 rows — the exact condition the item was written to end. This is the plan's own fixture rule applied to its own definition of done. |
| 9 | **Say plainly that nothing consults the suppression list until item 7 — and ship one shared helper** | Task 1 table comment; Task 6 `isSuppressed`; note §6; §15 §(b2) ops-review row | The list is written from Task 7 and first read twelve weeks later. In between, seven lifecycle crons keep mailing hard-bounced addresses daily. Stating it stops the next reader assuming protection that is not live; the shared helper stops items 4 and 7 writing two implementations. |

**Where I disagreed with the review, with evidence.** Improvement 7 claims moving the secret read into the handler "removes a deployment step". It does not: Vercel binds environment variables at deploy time, so a variable added after a build is absent from the running deployment's environment regardless of where the code reads it. Task 7 therefore still requires a redeploy. What the in-handler read genuinely removes is the module-scope capture — a warm lambda holding a stale `undefined` after the variable is set — and it removes `vi.resetModules()` from the unconfigured-secret test. Both are worth having, so the change is folded in with the accurate justification.

## Deferred improvements

The owner reads this table to decide what else to schedule. It is complete.

| Improvement | Recommendation | Reason it is not in item 0 |
|---|---|---|
| **A delivery chip beside each user on `/settings/users`** ("Delivered 3 Sep" / "Bounced — permanent" / "No mail sent"), org-admin gated, reusing this item's RLS policy | **q1-separate-item** | Genuinely valuable — without a surface the evidence is a psql fact and the PM deciding whether to phone a foreman cannot reach it. But it is not on the critical path. Fund it from the pre-window's idle 0.8 (items 0 and 1 are 2.0 against a 2.8-week pre-window), cap it at 0.3, and cut it first if item 1's metrics baseline runs long. Note the policy serves owner/admin only, so a project manager sees nothing — state that on the page rather than let it be discovered. |
| **`List-Unsubscribe` / `List-Unsubscribe-Post` headers on lifecycle mail** | **later-quarter (item 7)** | The one-click endpoint does not exist yet — §05 `:171` builds it with the recap — and changing `resendSend` means CLI-deploying seven edge functions, which item 0 deliberately avoids so that no Q1 deliverable waits on the workflow-scoped token (§15 `:164`). Same code, against an endpoint that exists, in item 7. |
| **An email-health dashboard, an `email_events` admin table view, per-message drill-down, inbound handling** | **reject** | §05 owns the notification surfaces and §11.3 owns inbound; both are Q2 or later by design. A viewer for a table you just created measures nothing extra and would eat either the pre-window slack improvement 10 uses better or the 0.5 weeks of float on an 11.5-week single-walker chain. |

---

## Read this before Task 0 — what changed since the spec was written

Four measurements taken on 2026-09-10 rewrite this item. Do not implement the spec's version of it.

1. **`reengagement-check` is scheduled and works.** pg_cron job 6, `20 1 * * *`, **144 runs, 144 succeeded**, last 2026-09-10. §13 line 139's either/or ("either those contractors burnt all three re-engagement emails without returning, or the cron was never scheduled") is settled: the cron ran and the emails went out. **Do not plan or perform an investigation into whether the cron exists.**

2. **The account estate is healthy, so re-invitation is not the fix.** All 36 accounts have a password set and a confirmed email. `invited_at` is NULL for every one of them — they were created through the admin API, not the GoTrue invite flow, so the PR #138 `otp_expired` failure class does not apply. Five have never signed in (three `aeec.co.za`, one `matlaqs.co.za`, one `gmigroup.co.za` client viewer); they are not locked out. **§13 line 141's instruction to "re-invite every stranded account" is withdrawn — there are no stranded accounts.** What replaces it is Task 10's findings note and Task 8's per-address delivery evidence.

3. **246 automated emails have been sent and `opened_at` and `clicked_at` are NULL on every single row.** Measured: `select count(*), count(resend_message_id) from public.email_sequence_events` → **246 total, 235 with a message id, 11 without**. **That zero is a measurement gap, not a behaviour measurement.** `00030_email_sequences.sql:24-25` comments both columns "populated by Resend webhook (Phase 2)"; Phase 2 never shipped. There is no Resend webhook route anywhere under `apps/web/src/app/api/` (the directories are `auth`, `cable-schedule`, `diary`, `health`, `inspections`, `jbcc`, `medium-voltage`, `node-order-documents`, `notifications`, `paystack`, `projects`, `tenant-schedule`) and nothing in the monorepo writes either column. This is the same shape as `public.notifications.read_at` — a column provisioned for a later phase that nothing ever writes, making the metric that depends on it unmeasurable.

4. **§13 line 141's migration-reconciliation instruction is also already satisfied.** It says to "pull `00183` and `00184` into the local migration directory — the checkout ends at `00182_site_form_response_provenance.sql`". Verified 2026-09-10: this worktree holds `00183_report_notes_summary_and_kind_read_gate.sql` and `00184_site_forms_template_v1_1.sql`, `git ls-tree origin/main` confirms both are on main, and production's `max(version)` is `00184`. **Do not renumber anything and do not "reconcile" a directory that is already correct.** Claim `00185` at merge, per Task 7 Step 2.

**Why this must land before §13 item 7 designs the 07:00 recap.** Three reasons, each load-bearing:

- §05 `:173` fact (4) makes the recap's suppression consult a hard requirement: "Resend's bounce and complaint webhook is wired to the suppression list built in §13 item 0, and that list is consulted before every send". `public.email_suppressions` (Task 1) is that list. It cannot exist without the webhook, because nothing else observes a bounce.
- §05 `:187` names the suppression list as **one of exactly three switches** the always-fires notifications honour. Ship item 7 first and one of its three switches is a table that does not exist.
- §13 line 186 makes item 7's exit criterion conditional on this evidence: "a recap sent to a hard-bounced address is not a channel." Metric 2a's denominator is **frozen** — §15 `:39` fixes it at the 13 contractor accounts named on 9 September 2026 for the whole programme, and this item does not and must not change it. What this item adds is the per-address deliverability annotation published beside it, so a flat 2a can be read as non-adoption rather than as non-delivery.

**A fourth reason found while planning, and it is a live bug.** `apps/web/src/middleware.ts:175` matches `/api/*`, `:85` bypasses only `SELF_AUTH_PATHS = ['/api/notifications/dispatch']` (`:39`), and `:100` redirects any unauthenticated request to `/login` with a 307. **A webhook POST to a new `/api/webhooks/*` route is therefore redirected before the handler runs.** Svix treats a 3xx as a failed delivery, retries with backoff, and eventually disables the endpoint — and the symptom is indistinguishable from "Resend never sends webhooks". Task 5 fixes this for the Resend route **and for `POST /api/paystack/webhook`, which has the same shape and is broken today**, and Task 7 proves it in production with a request that must return **401, not 307**.

---

## File Structure

Worktree root for every path below: `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap`. **Do not use `../esite`** — that checkout is on a stale branch with 30 dirty files.

**Created**

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00185_resend_email_delivery_evidence.sql` | Creates `public.email_events` (append-only delivery log for every message) and `public.email_suppressions` (the bounce/complaint list §05 requires), their RLS, grants and `anon` revokes. Number is provisional — claimed at merge (Task 7). |
| `apps/web/src/lib/webhooks/svix-signature.ts` | Reads the `svix-*` / `webhook-*` header triple and verifies the standardwebhooks HMAC-SHA256 signature in constant time, with a 5-minute timestamp tolerance. No npm dependency; `node:crypto` only. |
| `apps/web/src/lib/webhooks/svix-signature.test.ts` | Proves the verifier against the **published Svix test vector** (an independently-sourced fixture that can fail), plus tampered body, tampered signature, wrong secret, stale timestamp, rotated multi-signature header, and both header families. |
| `apps/web/src/lib/webhooks/resend-events.ts` | Pure mapping: a Resend webhook payload → an `email_events` row (including `project_id` / `entity_ref` from tags), → a suppression row or null, → which `email_sequence_events` timestamp column to set or null. No I/O. |
| `apps/web/src/lib/webhooks/resend-events.test.ts` | All eight handled event types, the unhandled-type case, `bounce.type = Transient` not suppressing, multi-recipient `to` arrays, both tag encodings, and a non-UUID `project_id` tag being dropped rather than poisoning the insert. |
| `apps/web/src/app/api/webhooks/resend/route.ts` | The endpoint. Fails closed on a missing secret, 401s an invalid signature, 200s an unhandled type, 500s a storage failure so Svix retries, and reports how many sequence rows it stamped. |
| `apps/web/src/app/api/webhooks/resend/route.test.ts` | Route-level gates: unconfigured secret, tampered signature, replay, duplicate delivery, each write path, the stamp count. |
| `packages/shared/src/email/suppression.ts` | `isSuppressed(client, address)` — the single implementation items 4 and 7 import instead of writing two. Nothing consults it yet; that is stated in the file. |
| `packages/shared/src/email/suppression.test.ts` | Hit, miss, case/whitespace normalisation, and the fail-open-on-read-error decision. |
| `apps/web/src/lib/email/edge-site-url.contract.test.ts` | Contract test: the two Deno senders must carry the same `SITE_URL` default. Fails today, which is the point. |
| `apps/web/scripts/backfill-resend-delivery-evidence.ts` | One-off: pulls per-message state from the Resend API for the 235 historical sends that have a message id, records the 11 that do not as `email.failed`, and prints a link-host histogram. Dry-run by default. |
| `docs/superpowers/notes/2026-09-10-account-estate-and-email-delivery.md` | The findings note. What was measured, what it means, and what Wave 1 rollout should therefore assume. |

**Modified**

| Path | Change |
|---|---|
| `apps/web/src/middleware.ts:39` (after `SELF_AUTH_PATHS`) and `:85-87` | New `SIGNED_WEBHOOK_PATHS` bypass, covering the Resend webhook **and** the already-broken Paystack webhook. |
| `apps/web/src/middleware.test.ts` | Asserts both bypasses — the test that would have caught the 307. |
| `apps/web/.env.example:17` | Documents `RESEND_WEBHOOK_SECRET`. |
| `apps/edge-functions/supabase/functions/_shared/email-sequence.ts:44` | `SITE_URL` default `https://app.e-site.live` → `https://www.e-site.live`. The first host has no DNS record. |
| `docs/staging-deployment-checklist.md:81` | Same correction, so the checklist stops re-introducing the dead host. |
| `packages/shared/src/index.ts` | Barrel export for `./email/suppression`. |
| `docs/rbac-matrix.md:174` | Two new API rows (same-PR rule): the Resend webhook, and the Paystack webhook that was never listed. |
| `CONFORMANCE.md` §E + Env-gated items | New E7 row (unauthenticated signed surfaces) + the new secret. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md:332, :388` | A(f) Q1 `public` row gains the two tables; A(g) gains the route. Required — §12 §(h) tests 4 and 8 diff code against these registries in both directions. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/15-metrics-risks-open-questions.md:121` | Rule 3's Monday ops review gains the suppression-list read, because nothing consults it until item 7. |
| `.github/workflows/deploy-edge-functions.yml` | Dead `generate-report` step deleted, stale header corrected, coverage guard added. **Separate branch, separate PR, NOT part of this item's definition of done — see Task 12.** |

---

## Task 0 — Settle the base branch before writing a line

**Files:** none. This task exists because getting it wrong opens a pull request containing the entire v2 roadmap spec set.

**The situation, measured 2026-09-10.** This worktree is on `docs/v2-platform-roadmap`, which is **2 commits ahead of `origin/main` and 0 behind** (`e05e58e` "Add the v2 platform review and 12-month roadmap design", `e3f0aee` "Record the Q1 item 0 findings"). Those two commits carry the 17 spec files under `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/`. **`git ls-tree origin/main docs/superpowers/specs/` does not list that directory at all.**

That matters because Task 1 Step 2 and Task 5 Step 8 edit `16-appendix-registries.md`, and Task 6 Step 6 edits `15-metrics-risks-open-questions.md`. **Branching item 0 from `origin/main` breaks those three steps**, because the files do not exist there. Branching from the roadmap branch and pushing `HEAD:feat/resend-delivery-evidence` without a base would open a PR against `main` containing the whole roadmap.

**The decision: item 0 branches from `docs/v2-platform-roadmap`, and the roadmap branch merges to main first.** If for any reason it has not merged when item 0 is ready, item 0's PR is opened **stacked**, with `--base docs/v2-platform-roadmap`, and rebased onto `main` after the roadmap merges.

- [ ] **Step 1: Confirm the base is where this plan says it is.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
git branch --show-current
git rev-list --left-right --count origin/main...HEAD
git ls-tree --name-only origin/main docs/superpowers/specs/2026-09-09-v2-platform-roadmap/ | wc -l
```

Expected: `docs/v2-platform-roadmap`, `0	2`, and `0` (the spec directory is not on main). If the third number is non-zero the roadmap branch has already merged — in that case branch from `origin/main` instead and skip Step 2.

- [ ] **Step 2: Push the roadmap branch and open its PR, so item 0 has somewhere to land.** This is one command and it settles the base question permanently.

```bash
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD:docs/v2-platform-roadmap
gh pr create --head docs/v2-platform-roadmap --base main \
  --title "docs: v2 platform review and 12-month roadmap" \
  --body "$(cat <<'EOF'
Spec set only — no code, no migration. Q1 item 0's implementation PR stacks on
this branch because its Appendix A(f)/A(g) registry edits require these files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Note the four untracked plan files** (`docs/superpowers/plans/2026-09-10-q1-item-*.md`). They belong to the roadmap branch, not to item 0. Commit them there if you own that branch; **never `git add -A` inside item 0's tasks** — every `git add` in this plan names its paths explicitly for exactly this reason.

- [ ] **Step 3: Cut item 0's branch.**

```bash
git switch -c feat/resend-delivery-evidence
git branch --show-current   # expect: feat/resend-delivery-evidence
```

Every commit in Tasks 1 through 6 lands here. Task 7 pushes and merges it. Tasks 8 through 11 use a **second** branch, cut after the migration is applied, because the back-fill cannot run until the tables exist.

---

## Task 1 — The delivery-evidence tables

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00185_resend_email_delivery_evidence.sql`
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md:332` and `:354`

**Constraints that bite in this task:**

- **A new `public` table is born `anon`-writable, not merely readable.** Measured on production: `pg_default_acl` for schema `public`, object type `r`, is `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — `a`=INSERT, `r`=SELECT, `w`=UPDATE, `d`=DELETE, `D`=TRUNCATE. So `REVOKE SELECT` alone would leave `anon` able to **forge delivery evidence and poison the suppression list** through PostgREST. `REVOKE ALL` is the only correct form, and the `@verify` block below checks INSERT, UPDATE and DELETE as well as SELECT so the guard can fail for the worst case it exists to prevent. A(f) attributes the default grant to `00025_grant_schema_permissions.sql:26`; that migration's loop covers only `projects, compliance, field, marketplace, suppliers, billing, tenants` (verified, `:12`) — **not `public`**, which gets it from Supabase's own bootstrap. The conclusion is unchanged. **Verify with `has_table_privilege`, never by reading `relacl`** — a NULL `relacl` looks empty but *is* the default grant.
- **A new table in an existing schema needs `NOTIFY pgrst, 'reload schema'`.** Only a *new schema* needs the Management-API PostgREST `db_schema` PATCH; neither table introduces one.
- **This migration creates no function**, deliberately. Every function in an exposed schema needs both `REVOKE ... FROM PUBLIC` and an explicit `REVOKE ... FROM anon`, and every function is a surface to re-verify. The suppression list is a table the webhook maintains, not a helper the sender calls.
- **`public.email_suppressions` is write-only until §13 item 7.** Nothing in this item consults it, and that must be stated in the table comment rather than assumed away — see improvement 9 and Task 6.

- [ ] **Step 1: Write the migration file.** Create `apps/edge-functions/supabase/migrations/00185_resend_email_delivery_evidence.sql` with exactly this content. The `-- @verify:begin` block is the machine-readable form mandated by §12 §(c) item 3 and parsed by §12 §(h) test 8; §13 line 153's prose "`-- @verify: <SQL>` header" is satisfied by it — `scripts/verify-migration-applied.ts` arrives in item 1 and reads this form.

```sql
-- ---------------------------------------------------------------------------
-- Migration 00185: Resend delivery evidence — email_events + email_suppressions
-- ---------------------------------------------------------------------------
-- Why: public.email_sequence_events has carried opened_at / clicked_at since
-- 00030 with the comment "populated by Resend webhook (Phase 2)"
-- (00030_email_sequences.sql:24-25). Phase 2 never shipped. 246 automated
-- emails have been sent to 36 accounts and every opened_at and clicked_at is
-- NULL — a measurement gap, not a behaviour measurement. Q1's entire outcome
-- ships over this channel (§13 item 7's 07:00 recap), so the channel must be
-- measurable before it is designed on.
--
-- public.email_events is the append-only log of every Resend delivery event for
-- EVERY message, sequence mail or not. The recap is not sequence mail and gets
-- no email_sequence_events row, so a second home is required rather than
-- optional.
--
-- public.email_suppressions is §05 :173(4)'s bounce/complaint suppression list,
-- one row per address, and one of the three switches the always-fires
-- notifications honour (§05 :187).
--
-- RLS NOTE, so the limitation is documented rather than discovered: the read
-- policy below serves org owners and admins only. A project_manager reads ZERO
-- rows, and so does every human for an address with no profile — an external
-- notify_rfi_to recipient, a canary. Both are fail-closed and intended; both
-- are verified against production after this migration applies.
--
-- Reversible: DROP TABLE public.email_suppressions; DROP TABLE public.email_events;
--
-- @verify:begin
-- table: public.email_events
-- table: public.email_suppressions
-- constraint: email_events_webhook_id_key ON public.email_events
-- constraint: email_events_event_type_check ON public.email_events
-- constraint: email_events_source_check ON public.email_events
-- constraint: email_suppressions_reason_check ON public.email_suppressions
-- index: email_events_message_id_idx ON public.email_events
-- index: email_events_to_email_idx ON public.email_events
-- policy: email_events_org_admin_read ON public.email_events
-- grant_absent: anon SELECT ON public.email_events
-- grant_absent: anon INSERT ON public.email_events
-- grant_absent: anon UPDATE ON public.email_events
-- grant_absent: anon DELETE ON public.email_events
-- grant_absent: anon SELECT ON public.email_suppressions
-- grant_absent: anon INSERT ON public.email_suppressions
-- grant_absent: anon UPDATE ON public.email_suppressions
-- grant_absent: anon DELETE ON public.email_suppressions
-- grant_absent: authenticated SELECT ON public.email_suppressions
-- @verify:end
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id        TEXT        NOT NULL UNIQUE,
    resend_message_id TEXT,
    event_type        TEXT        NOT NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    retrieved_at      TIMESTAMPTZ,
    to_email          TEXT,
    subject           TEXT,
    bounce_type       TEXT,
    project_id        UUID,
    entity_ref        TEXT,
    source            TEXT        NOT NULL DEFAULT 'webhook',
    payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT email_events_event_type_check CHECK (event_type IN (
        'email.sent', 'email.delivered', 'email.delivery_delayed',
        'email.bounced', 'email.complained', 'email.opened', 'email.clicked',
        'email.failed')),
    CONSTRAINT email_events_source_check CHECK (source IN (
        'webhook', 'backfill', 'send_failure'))
);

COMMENT ON TABLE public.email_events IS
  'Append-only Resend delivery events for every message the platform sends. '
  'webhook_id is the svix-id header (or ''backfill:<message_id>'' / '
  '''send_failure:<sequence_event_id>'') and is the idempotency key — Svix '
  'retries reuse the same svix-id.';
COMMENT ON COLUMN public.email_events.occurred_at IS
  'When the event happened. For source=''webhook'' from the payload; for '
  '''backfill'' and ''send_failure'' it is the ORIGINAL send time taken from '
  'email_sequence_events.sent_at, so a weekly bucket over this column is not '
  'a single-day spike. The moment the back-fill observed the state is '
  'retrieved_at.';
COMMENT ON COLUMN public.email_events.retrieved_at IS
  'Only for source=''backfill'': when the Resend retrieve endpoint was asked. '
  'That endpoint returns a last-known state with no timestamp of its own, so '
  'the as-of and the event time are genuinely different facts.';
COMMENT ON COLUMN public.email_events.to_email IS
  'Lower-cased first recipient. The RLS policy and the suppression list both '
  'key on it; the full recipient array is preserved in payload.';
COMMENT ON COLUMN public.email_events.bounce_type IS
  'Resend bounce classification (Permanent / Transient / Undetermined). Only '
  'Permanent suppresses — see public.email_suppressions.';
COMMENT ON COLUMN public.email_events.event_type IS
  '''email.failed'' is a SEND-side failure: the message never left. It is not '
  'a recipient verdict and never suppresses. Without it in this CHECK the '
  'single most actionable negative signal would be 200''d and discarded.';
COMMENT ON COLUMN public.email_events.project_id IS
  'The project the message was about, read from the Resend `project_id` tag. '
  'Deliberately NO foreign key: this is an append-only evidence log and '
  'deleting a project must not rewrite what was delivered. NULL until §13 '
  'item 4''s dispatcher starts sending tags.';
COMMENT ON COLUMN public.email_events.entity_ref IS
  'The thing the message was about, as ''<kind>:<entity_id>'' (or just '
  '''<kind>'' when there is no id), from the Resend tags. The vocabulary is '
  'fixed in apps/web/src/lib/webhooks/resend-events.ts so item 4 and item 7 '
  'send with it rather than each inventing one: kind is recap | rfi | snag | '
  'invite | onboarding | report.';

CREATE INDEX IF NOT EXISTS email_events_message_id_idx
    ON public.email_events (resend_message_id)
    WHERE resend_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_events_to_email_idx
    ON public.email_events (to_email, occurred_at DESC);

-- No index on project_id or entity_ref: nothing reads them yet. The columns
-- exist now because adding them later is a second migration on a live table
-- and another number claim; an index with no query is speculative.

CREATE TABLE IF NOT EXISTS public.email_suppressions (
    email_address       TEXT        PRIMARY KEY,
    reason              TEXT        NOT NULL,
    first_suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at       TIMESTAMPTZ NOT NULL,
    source_message_id   TEXT,
    CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('hard_bounce', 'complaint'))
);

COMMENT ON TABLE public.email_suppressions IS
  'Addresses that must not be mailed again: a Permanent bounce or a spam '
  'complaint. Maintained ONLY by the Resend webhook, so it is built forward '
  'from live events — the historical back-fill cannot populate it, because the '
  'Resend retrieve endpoint returns no bounce classification.'
  E'\n\n'
  'WRITE-ONLY UNTIL §13 ITEM 7. Nothing consults this list yet. The seven '
  'lifecycle edge functions gate only on hasOptedOut '
  '(_shared/email-sequence.ts:121) and will keep mailing a hard-bounced '
  'address daily until item 7 wires the consult through '
  'packages/shared/src/email/suppression.ts. Until then the protection is a '
  'record, not a control; §15 §(b2) Rule 3''s Monday ops review reads this '
  'table so a growing list is seen by a human rather than by nobody.'
  E'\n\n'
  'Release is a deliberate data change, not a button: a hard-bounced address '
  'is not fixed by un-suppressing it, it is fixed by correcting the address, '
  'which is a different address.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- email_events: an org owner/admin may read delivery events for addresses
-- belonging to members of their own org. The EXISTS subquery runs under the
-- caller's RLS on public.profiles and public.user_organisations, both of which
-- already permit org-member visibility (00009_rls_policies.sql:81-89, :95-97),
-- so this policy can never widen what the reader can already see.
--
-- Measured consequences, stated rather than discovered (all 2026-09-10):
--   * 31 of the 36 mailed addresses hold an active user_organisations row —
--     13 contractor, 12 admin, 4 client_viewer, 2 owner — so the 12 admins and
--     2 owners can read their org's events. Good.
--   * A project_manager reads ZERO rows. PMs are the people §04 and §13 put in
--     the chasing role; widening to them is the /settings/users chip in this
--     plan's Deferred table, not this migration.
--   * 5 addresses have no user_organisations row at all (2766mattheus@gmail.com,
--     arno@watsonmattheus.com, demo.owner@wmeng.co.za, demo.pm@wmeng.co.za,
--     spud-test-signup@inboxkitten.com) — service_role only.
--   * Any external notify_rfi_to recipient is invisible to every human.
-- All four are fail-closed and intended. Task 7 Step 6 proves the second one.
--
-- email_suppressions: NO permissive policy at all. Its only consumer is the
-- service-role sender. RLS on with no policy denies every authenticated read.

ALTER TABLE public.email_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_events_org_admin_read ON public.email_events;
CREATE POLICY email_events_org_admin_read
    ON public.email_events
    FOR SELECT TO authenticated
    USING (
        to_email IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.user_organisations uo
              ON uo.user_id = p.id AND uo.is_active
            WHERE lower(p.email) = public.email_events.to_email
              AND public.user_is_org_admin(uo.organisation_id)
        )
    );

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Supabase's bootstrap ALTER DEFAULT PRIVILEGES on schema public grants anon
-- and authenticated arwdDxtm on every new table — INSERT, UPDATE, DELETE and
-- TRUNCATE, not merely SELECT. A new public table is therefore born forgeable.
-- REVOKE ALL, then grant back exactly what the policies gate. Verify with
-- has_table_privilege, never by reading relacl: a NULL relacl IS the grant.

REVOKE ALL ON public.email_events       FROM anon, authenticated;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;

GRANT SELECT ON public.email_events TO authenticated;   -- gated by the policy above
GRANT ALL    ON public.email_events       TO service_role;
GRANT ALL    ON public.email_suppressions TO service_role;

-- New tables in an existing schema need the schema-cache reload. Only a NEW
-- schema needs the Management-API PostgREST db_schema PATCH; neither table
-- introduces one.
NOTIFY pgrst, 'reload schema';
```

> **On the missing `@verify` key for the RLS limitation.** The review asked for a `-- @verify` line proving a project_manager reads zero rows. The `@verify` block is parsed by item 1's `scripts/verify-migration-applied.ts`, which implements exactly the keys used above (`table`, `constraint`, `index`, `policy`, `grant_absent`). Inventing an `rls_zero_for_role:` key here would fail the build on a handler nobody has written. The expectation is therefore stated in the header prose **and executed against production in Task 7 Step 6**, which makes it a tested fact rather than a comment. If item 1 later adds such a key, move it in.

- [ ] **Step 2: Register the two tables in Appendix A(f).** Appendix A owns every registry, and §12 §(h) **test 8** diffs the union of all `-- @verify:` blocks against A(f) in both directions — a table created but not registered fails the build naming the migration, and vice versa. Edit `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md:332`, appending the two names to the Q1 `public` row so it ends:

```
… `product_events`, `platform_metrics_weekly`, `metric_cohorts`, `metric_accounts` (view), `email_events`, `email_suppressions` | `public` |
```

Then, immediately below the Q1 migration ledger heading at `:354` ("#### The Q1 migration ledger — **eleven migrations**"), add this paragraph so the ordinals stay honest:

```
**Item 0's delivery-evidence migration is a twelfth, and it is pre-window.** It creates `public.email_events` and `public.email_suppressions` and lands three weeks before ordinal 0, because §05 §(d) fact (4) makes the suppression list a precondition of the recap rather than a part of it. It is not renumbered into this ledger: the ledger's ordinals are the ten-week window's, and this file merges before the window opens.
```

- [ ] **Step 3: Commit.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
git add apps/edge-functions/supabase/migrations/00185_resend_email_delivery_evidence.sql \
        docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md
git commit -m "$(cat <<'EOF'
feat(email): add email_events + email_suppressions delivery-evidence tables

00030 has advertised opened_at/clicked_at as "populated by Resend webhook
(Phase 2)" since it shipped. Phase 2 never shipped: 246 sends, zero measured
opens, no webhook route anywhere in the monorepo. These two tables are where
the evidence lands.

REVOKE ALL, not REVOKE SELECT: a new public table is born anon-writable
(pg_default_acl grants anon arwdDxtm), so revoking reads alone would leave
anon able to forge delivery evidence through PostgREST. The @verify block
checks INSERT/UPDATE/DELETE too, so the guard can fail for the worst case.

email.failed and source='send_failure' are admitted now — a send that never
left is the most actionable negative signal, and adding a CHECK value later
is another migration and another number claim.

Registered in Appendix A(f) so §12 §(h) test 8 passes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

*The migration is NOT applied yet — the number is claimed at merge in Task 7, against `max(version)` **and** `origin/main`, and its effect is read back out of production there.*

---

## Task 2 — The Svix signature verifier

Resend signs webhooks with Svix, which is the same standardwebhooks scheme `auth-email-hook` already verifies (`apps/edge-functions/supabase/functions/auth-email-hook/index.ts:22,177-180`). That function imports `standardwebhooks` from esm.sh; `apps/web` has no such dependency and needs none — the scheme is HMAC-SHA256 over `${id}.${timestamp}.${body}` with a base64 key, ~30 lines of `node:crypto`, and hand-rolling it keeps the verification independently testable against the published vector rather than against the library's own idea of itself.

**Files:**
- Create: `apps/web/src/lib/webhooks/svix-signature.test.ts`
- Create: `apps/web/src/lib/webhooks/svix-signature.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/lib/webhooks/svix-signature.test.ts`.

**The fixture rule, applied.** Ask of the vector below: *what would it have to look like for this test to be able to fail?* If the expected signature were computed by calling the function under test, nothing could ever fail. So the vector is Svix's own published one, transcribed, not derived — and it was confirmed byte-identical by an independent HMAC computation while this plan was written.

**And the same question, asked of the tamper fixture — this is where the previous draft was wrong.** Flipping the *last* base64 character does not tamper with anything. In a 44-character base64 string ending in one `=`, the final data character carries 4 data bits and 2 padding bits; `E` (`000100`) and `F` (`000101`) differ only in a padding bit, which Node discards. Measured:

```
Buffer.from('…1OE=','base64').equals(Buffer.from('…1OF=','base64'))  →  true
```

So a `…1OF=` fixture asserts that a **byte-identical** signature is rejected, which a correct verifier will never do — the assertion would go red at the exact moment this plan claims green. Flip the **first** character instead, where every bit survives decoding.

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readSvixHeaders, verifySvixSignature } from './svix-signature'

/**
 * Published standardwebhooks/Svix test vector. NOT computed by the code under
 * test — that is the whole point. secret/id/timestamp/payload/signature are
 * transcribed from the specification's worked example.
 */
const VECTOR = {
  secret:    'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id:        'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body:      '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}
// The vector's timestamp is in 2021, so every call pins `now` to it. Real
// requests use Date.now() and the 5-minute tolerance.
const NOW = Number(VECTOR.timestamp) * 1000

function verify(over: Partial<typeof VECTOR> = {}, now = NOW) {
  const v = { ...VECTOR, ...over }
  return verifySvixSignature({
    secret: v.secret,
    body: v.body,
    headers: { id: v.id, timestamp: v.timestamp, signature: v.signature },
    now,
  })
}

describe('verifySvixSignature', () => {
  it('accepts the published vector', () => {
    expect(verify()).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verify({ body: '{"test": 2432232315}' })).toBe(false)
  })

  it('rejects a tampered signature', () => {
    // Flip the FIRST base64 character, never the last. In a 44-char base64
    // string ending in one '=', the final data character carries 4 data bits
    // and 2 padding bits, so '...1OE=' and '...1OF=' decode to BYTE-IDENTICAL
    // buffers — a verifier returning false for that would be WRONG. Do not
    // "simplify" this back to a trailing-character flip.
    expect(verify({ signature: VECTOR.signature.replace('v1,g0hM', 'v1,h0hM') })).toBe(false)
  })

  it('rejects a different message id (the id is part of the signed content)', () => {
    expect(verify({ id: 'msg_p5jXN8AQM9LWM0D4loKWxJel' })).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(verify({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx' })).toBe(false)
  })

  it('accepts the same secret stored without the whsec_ prefix', () => {
    expect(verify({ secret: VECTOR.secret.slice('whsec_'.length) })).toBe(true)
  })

  it('rejects a timestamp outside the 5-minute tolerance', () => {
    expect(verify({}, NOW + 6 * 60 * 1000)).toBe(false)
    expect(verify({}, NOW - 6 * 60 * 1000)).toBe(false)
  })

  it('accepts a timestamp inside the tolerance', () => {
    expect(verify({}, NOW + 4 * 60 * 1000)).toBe(true)
  })

  it('accepts a rotated multi-signature header where only the second matches', () => {
    expect(verify({ signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${VECTOR.signature}` })).toBe(true)
  })

  it('rejects an unversioned or v2 signature', () => {
    expect(verify({ signature: VECTOR.signature.replace('v1,', 'v2,') })).toBe(false)
    expect(verify({ signature: VECTOR.signature.replace('v1,', '') })).toBe(false)
  })

  it('rejects a non-numeric timestamp without throwing', () => {
    expect(verify({ timestamp: 'not-a-number' })).toBe(false)
  })
})

describe('readSvixHeaders', () => {
  const map = (o: Record<string, string>) => (n: string) => o[n] ?? null

  it('reads the svix-* family Resend sends', () => {
    expect(readSvixHeaders(map({
      'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c',
    }))).toEqual({ id: 'a', timestamp: 'b', signature: 'c' })
  })

  it('reads the webhook-* family standardwebhooks defines', () => {
    expect(readSvixHeaders(map({
      'webhook-id': 'a', 'webhook-timestamp': 'b', 'webhook-signature': 'c',
    }))).toEqual({ id: 'a', timestamp: 'b', signature: 'c' })
  })

  it('returns null when any of the three is missing', () => {
    expect(readSvixHeaders(map({ 'svix-id': 'a', 'svix-timestamp': 'b' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
pnpm --filter web test src/lib/webhooks/svix-signature.test.ts
```

Expected: `Error: Failed to load url ./svix-signature` — the module does not exist yet.

- [ ] **Step 3: Write the verifier.** Create `apps/web/src/lib/webhooks/svix-signature.ts`.

```ts
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * standardwebhooks / Svix signature verification.
 *
 * Resend signs every webhook with Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * keyed by the base64 body of the `whsec_`-prefixed signing secret, sent as one
 * or more space-separated `v1,<base64>` values. This is the same scheme
 * auth-email-hook verifies with the standardwebhooks package
 * (apps/edge-functions/.../auth-email-hook/index.ts:22,177-180); apps/web
 * carries no such dependency and needs none for thirty lines of node:crypto.
 *
 * The timestamp check is what stops a captured-and-replayed request.
 */

export interface SvixHeaders {
  id: string
  timestamp: string
  signature: string
}

const TOLERANCE_MS = 5 * 60 * 1000
const SECRET_PREFIX = 'whsec_'

/**
 * Resend sends `svix-*`; the standardwebhooks specification names `webhook-*`.
 * Accept either — getting this wrong rejects every request with a 401 that
 * looks exactly like a wrong secret.
 */
export function readSvixHeaders(get: (name: string) => string | null): SvixHeaders | null {
  const id = get('svix-id') ?? get('webhook-id')
  const timestamp = get('svix-timestamp') ?? get('webhook-timestamp')
  const signature = get('svix-signature') ?? get('webhook-signature')
  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}

export function verifySvixSignature(opts: {
  secret: string
  body: string
  headers: SvixHeaders
  /** Injectable for tests; production always uses the real clock. */
  now?: number
}): boolean {
  const { secret, body, headers } = opts
  const now = opts.now ?? Date.now()

  const seconds = Number(headers.timestamp)
  if (!Number.isFinite(seconds)) return false
  if (Math.abs(now - seconds * 1000) > TOLERANCE_MS) return false

  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  const key = Buffer.from(raw, 'base64')
  if (key.length === 0) return false

  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest()

  // Svix sends two signatures while a secret is being rotated. Any v1 match wins.
  // Compare byte-lengths first so a malformed value cannot make timingSafeEqual throw.
  for (const part of headers.signature.split(' ')) {
    const comma = part.indexOf(',')
    if (comma < 0) continue
    if (part.slice(0, comma) !== 'v1') continue
    const provided = Buffer.from(part.slice(comma + 1), 'base64')
    if (provided.length === expected.length && timingSafeEqual(expected, provided)) return true
  }
  return false
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter web test src/lib/webhooks/svix-signature.test.ts
```

Expected: `Test Files 1 passed`, `Tests 14 passed`.

- [ ] **Step 5: Prove the test can fail — and know the exact number before you look.** Temporarily change `'sha256'` to `'sha512'` in `svix-signature.ts` and re-run.

Expect **exactly 4 of the 14 to fail**, by name:

```
× verifySvixSignature > accepts the published vector
× verifySvixSignature > accepts the same secret stored without the whsec_ prefix
× verifySvixSignature > accepts a timestamp inside the tolerance
× verifySvixSignature > accepts a rotated multi-signature header where only the second matches
```

The other seven `verifySvixSignature` tests and all three `readSvixHeaders` tests still pass, **and that is correct**: SHA-512 makes `expected.length` 64 while every `provided` is 32, so every check returns false — a wrong hash rejects everything, so only the four accept-path assertions carry the mutation signal. If you see any other count, the fixtures are not doing what this plan says they are. Revert the change and confirm `Tests 14 passed` again.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/webhooks/svix-signature.ts apps/web/src/lib/webhooks/svix-signature.test.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): add standardwebhooks/Svix signature verification

Verified against the published standardwebhooks test vector rather than
against itself, so the test can actually fail. No new dependency: thirty
lines of node:crypto, mirroring the scheme auth-email-hook already trusts.

The tamper fixture flips the FIRST base64 character, not the last: a trailing
'E' -> 'F' differs only in a discarded padding bit and decodes to identical
bytes, so it would have asserted that a correct verifier rejects a valid
signature.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — The Resend event mapper

Pure, no I/O, so every decision the webhook makes is testable without a database. Four decisions live here: what row to store, what the message was *about*, whether the address must be suppressed, and which `email_sequence_events` column (if any) to stamp.

**Files:**
- Create: `apps/web/src/lib/webhooks/resend-events.test.ts`
- Create: `apps/web/src/lib/webhooks/resend-events.ts`

**Constraint that bites here:** `project_id` lands in a `uuid` column. A tag carrying anything else would make the insert fail with SQLSTATE `22P02`, the route would 500, and **Svix would retry that request forever**. The mapper drops a non-UUID `project_id` rather than passing it on, and a test pins that.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/lib/webhooks/resend-events.test.ts`.

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mapResendEvent, suppressionFor, sequenceTimestampFor } from './resend-events'

const base = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  created_at: '2026-09-10T06:00:00.000Z',
  data: {
    email_id: 'ab12cd34-0000-0000-0000-000000000001',
    to: ['Site.Foreman@AEEC.co.za'],
    from: 'E-Site <noreply@e-site.live>',
    subject: 'Your open items',
    created_at: '2026-09-10T05:59:00.000Z',
    ...data,
  },
})

const PROJECT = '11111111-2222-3333-4444-555555555555'

describe('mapResendEvent', () => {
  it('maps a delivered event onto a row', () => {
    expect(mapResendEvent('msg_1', base('email.delivered'))).toEqual({
      webhook_id: 'msg_1',
      resend_message_id: 'ab12cd34-0000-0000-0000-000000000001',
      event_type: 'email.delivered',
      occurred_at: '2026-09-10T06:00:00.000Z',
      to_email: 'site.foreman@aeec.co.za',
      subject: 'Your open items',
      bounce_type: null,
      project_id: null,
      entity_ref: null,
      source: 'webhook',
      payload: base('email.delivered'),
    })
  })

  it('lower-cases the recipient — the RLS policy and the suppression list key on it', () => {
    expect(mapResendEvent('msg_1', base('email.sent'))?.to_email).toBe('site.foreman@aeec.co.za')
  })

  it('keeps the first recipient and preserves the whole array in payload', () => {
    const row = mapResendEvent('msg_1', base('email.sent', { to: ['a@x.co.za', 'b@x.co.za'] }))
    expect(row?.to_email).toBe('a@x.co.za')
    expect((row?.payload as any).data.to).toEqual(['a@x.co.za', 'b@x.co.za'])
  })

  it('extracts the bounce classification', () => {
    const row = mapResendEvent('msg_1', base('email.bounced', {
      bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
    }))
    expect(row?.bounce_type).toBe('Permanent')
  })

  it('handles email.failed — a send that never left', () => {
    const row = mapResendEvent('msg_1', base('email.failed', {
      failed: { reason: 'Recipient domain does not accept mail' },
    }))
    expect(row?.event_type).toBe('email.failed')
    expect(row?.bounce_type).toBeNull()
  })

  it('returns null for an event type we do not handle', () => {
    expect(mapResendEvent('msg_1', base('contact.created'))).toBeNull()
  })

  it('returns null for a payload with no type', () => {
    expect(mapResendEvent('msg_1', { data: {} })).toBeNull()
  })

  it('falls back to the data timestamp when the envelope has none', () => {
    const payload: any = base('email.opened')
    delete payload.created_at
    expect(mapResendEvent('msg_1', payload)?.occurred_at).toBe('2026-09-10T05:59:00.000Z')
  })
})

describe('mapResendEvent tags', () => {
  it('reads the array-of-{name,value} encoding the Resend SDK sends', () => {
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: [
        { name: 'kind', value: 'rfi' },
        { name: 'project_id', value: PROJECT },
        { name: 'entity_id', value: 'rfi-0042' },
      ],
    }))
    expect(row?.project_id).toBe(PROJECT)
    expect(row?.entity_ref).toBe('rfi:rfi-0042')
  })

  it('reads the plain-object encoding some payloads come back as', () => {
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: { kind: 'recap', project_id: PROJECT },
    }))
    expect(row?.project_id).toBe(PROJECT)
    expect(row?.entity_ref).toBe('recap')  // no entity_id — kind alone
  })

  it('drops a non-UUID project_id instead of poisoning a uuid column', () => {
    // A 22P02 on insert would 500 the route, and Svix would retry that
    // request forever. Dropping the tag is the only safe behaviour.
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: [{ name: 'project_id', value: 'KINGSWALK' }, { name: 'kind', value: 'snag' }],
    }))
    expect(row?.project_id).toBeNull()
    expect(row?.entity_ref).toBe('snag')
  })

  it('leaves both null when there are no tags — every message sent today', () => {
    const row = mapResendEvent('msg_1', base('email.delivered'))
    expect(row?.project_id).toBeNull()
    expect(row?.entity_ref).toBeNull()
  })
})

describe('suppressionFor', () => {
  const row = (type: string, bounce_type: string | null = null) =>
    ({ ...mapResendEvent('msg_1', base(type))!, event_type: type as any, bounce_type })

  it('suppresses a Permanent bounce', () => {
    expect(suppressionFor(row('email.bounced', 'Permanent'))).toEqual({
      email_address: 'site.foreman@aeec.co.za',
      reason: 'hard_bounce',
      last_event_at: '2026-09-10T06:00:00.000Z',
      source_message_id: 'ab12cd34-0000-0000-0000-000000000001',
    })
  })

  it('suppresses a complaint', () => {
    expect(suppressionFor(row('email.complained'))?.reason).toBe('complaint')
  })

  it('does NOT suppress a Transient bounce', () => {
    expect(suppressionFor(row('email.bounced', 'Transient'))).toBeNull()
  })

  it('does NOT suppress a bounce with no classification', () => {
    expect(suppressionFor(row('email.bounced', null))).toBeNull()
  })

  it('does NOT suppress email.failed — the send failed, the address did not', () => {
    expect(suppressionFor(row('email.failed'))).toBeNull()
  })

  it('does NOT suppress a delivery', () => {
    expect(suppressionFor(row('email.delivered'))).toBeNull()
  })
})

describe('sequenceTimestampFor', () => {
  const row = (type: string) => ({ ...mapResendEvent('msg_1', base(type))!, event_type: type as any })

  it('maps opened to opened_at', () => {
    expect(sequenceTimestampFor(row('email.opened')))
      .toEqual({ column: 'opened_at', value: '2026-09-10T06:00:00.000Z' })
  })

  it('maps clicked to clicked_at', () => {
    expect(sequenceTimestampFor(row('email.clicked'))?.column).toBe('clicked_at')
  })

  it('maps everything else to null — 00030 has only those two columns', () => {
    for (const t of ['email.sent', 'email.delivered', 'email.delivery_delayed',
                     'email.bounced', 'email.complained', 'email.failed']) {
      expect(sequenceTimestampFor(row(t))).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter web test src/lib/webhooks/resend-events.test.ts
```

Expected: `Failed to load url ./resend-events`.

- [ ] **Step 3: Write the mapper.** Create `apps/web/src/lib/webhooks/resend-events.ts`.

```ts
/**
 * Pure mapping from a Resend webhook payload to the rows it produces.
 *
 * Kept free of I/O so every decision the endpoint makes — store, attribute,
 * suppress, stamp — is testable without a database or a network.
 */

export const RESEND_EVENT_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  // A send that never left. NOT a recipient verdict and never suppresses.
  // Without it here the single most actionable negative signal would be
  // acknowledged with a 200 and discarded.
  'email.failed',
] as const

export type ResendEventType = (typeof RESEND_EVENT_TYPES)[number]

export interface ResendEventRow {
  webhook_id: string
  resend_message_id: string | null
  event_type: ResendEventType
  occurred_at: string
  to_email: string | null
  subject: string | null
  bounce_type: string | null
  project_id: string | null
  entity_ref: string | null
  source: 'webhook'
  payload: unknown
}

export interface SuppressionRow {
  email_address: string
  reason: 'hard_bounce' | 'complaint'
  last_event_at: string
  source_message_id: string | null
}

/**
 * THE TAG VOCABULARY. Fixed here so §13 item 4's dispatcher and item 7's recap
 * send with it rather than each inventing one:
 *
 *   kind       recap | rfi | snag | invite | onboarding | report
 *   project_id the project the message is about (a UUID)
 *   entity_id  the RFI / snag / report id, when there is one
 *
 * Nothing sends tags today — send-email/index.ts:27 returns void and discards
 * the Resend response entirely — so project_id and entity_ref are NULL on every
 * message until item 4. The columns exist now because adding them to a live
 * table later is a second migration and another number claim.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readTags(data: Record<string, unknown>): Record<string, string> {
  const raw = data.tags
  const out: Record<string, string> = {}
  if (Array.isArray(raw)) {
    // The Resend SDK's send-side shape, echoed back.
    for (const entry of raw) {
      const tag = entry as { name?: unknown; value?: unknown }
      if (typeof tag?.name === 'string' && typeof tag?.value === 'string') out[tag.name] = tag.value
    }
  } else if (raw && typeof raw === 'object') {
    // Some payloads come back as a plain map. Accepting both costs four lines;
    // guessing one and being wrong yields a silent null, not an error.
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

function isHandled(t: unknown): t is ResendEventType {
  return typeof t === 'string' && (RESEND_EVENT_TYPES as readonly string[]).includes(t)
}

/** `null` means "acknowledge and ignore" — never "reject". */
export function mapResendEvent(webhookId: string, raw: unknown): ResendEventRow | null {
  const evt = raw as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> } | null
  if (!evt || !isHandled(evt.type)) return null
  const data = evt.data ?? {}

  const to = Array.isArray(data.to) ? data.to : typeof data.to === 'string' ? [data.to] : []
  const bounce = data.bounce as { type?: unknown } | undefined

  const tags = readTags(data)
  // A non-UUID here would fail the insert with 22P02, 500 the route, and make
  // Svix retry that request forever. Dropping the tag is the safe behaviour.
  const projectId = tags.project_id && UUID_RE.test(tags.project_id) ? tags.project_id : null
  const entityRef = tags.kind
    ? tags.entity_id
      ? `${tags.kind}:${tags.entity_id}`
      : tags.kind
    : null

  return {
    webhook_id: webhookId,
    resend_message_id: typeof data.email_id === 'string' ? data.email_id : null,
    event_type: evt.type,
    occurred_at:
      (typeof evt.created_at === 'string' && evt.created_at) ||
      (typeof data.created_at === 'string' && data.created_at) ||
      new Date().toISOString(),
    to_email: typeof to[0] === 'string' ? (to[0] as string).trim().toLowerCase() : null,
    subject: typeof data.subject === 'string' ? data.subject : null,
    bounce_type: typeof bounce?.type === 'string' ? bounce.type : null,
    project_id: projectId,
    entity_ref: entityRef,
    source: 'webhook',
    payload: raw,
  }
}

/**
 * Only a Permanent bounce or a complaint suppresses.
 *
 * A bounce with no classification, a Transient one, and `email.failed` are all
 * recorded as events and do NOT suppress. The asymmetry is deliberate:
 * suppressing a live address silently deletes the channel to a contractor we
 * are trying to activate, and that failure is invisible; continuing to mail a
 * dead one costs a wasted send and shows up as another bounce event.
 */
export function suppressionFor(row: ResendEventRow): SuppressionRow | null {
  if (!row.to_email) return null
  if (row.event_type === 'email.complained') {
    return {
      email_address: row.to_email,
      reason: 'complaint',
      last_event_at: row.occurred_at,
      source_message_id: row.resend_message_id,
    }
  }
  if (row.event_type === 'email.bounced' && row.bounce_type === 'Permanent') {
    return {
      email_address: row.to_email,
      reason: 'hard_bounce',
      last_event_at: row.occurred_at,
      source_message_id: row.resend_message_id,
    }
  }
  return null
}

/**
 * public.email_sequence_events carries exactly two of these columns
 * (00030_email_sequences.sql:24-25). Full delivery history lives in
 * public.email_events and joins on resend_message_id — no duplicated columns.
 */
export function sequenceTimestampFor(
  row: ResendEventRow,
): { column: 'opened_at' | 'clicked_at'; value: string } | null {
  if (row.event_type === 'email.opened') return { column: 'opened_at', value: row.occurred_at }
  if (row.event_type === 'email.clicked') return { column: 'clicked_at', value: row.occurred_at }
  return null
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter web test src/lib/webhooks/resend-events.test.ts
```

Expected: `Tests 21 passed`.

- [ ] **Step 5: Prove the tag guard can fail.** Temporarily delete `&& UUID_RE.test(tags.project_id)` from the `projectId` line, re-run, and confirm **one** test fails — `drops a non-UUID project_id instead of poisoning a uuid column` — with `expected 'KINGSWALK' to be null`. Revert and confirm `Tests 21 passed`. A guard whose test passes with the guard removed is decorative.

- [ ] **Step 5b: Sweep the other guards, because this step only mutates one of them.** Step 5 proves a single guard. When this task was executed, a full sweep of 24 mutants found that **three more branches survived all 21 tests above**, each with a production consequence — so the test set as written was incomplete, in exactly the way `CLAUDE.md` records three shipped times. Break each of the following, confirm a test fails, and restore:

| Break this | What it would cost in production |
|---|---|
| `row.event_type === 'email.bounced'` in the hard-bounce condition | A `delivery_delayed` or `failed` payload carrying a classification suppresses the address — silently deleting the channel to a contractor |
| `if (!row.to_email) return null` in `suppressionFor` | A null into `email_suppressions.email_address`, which is the PRIMARY KEY: 23502 → 500 → Svix retries that request forever |
| `.trim()` on the address | A padded address matches neither the suppression key nor the RLS join on `lower(profiles.email)`, and fails silently in both |

Also add a contract test that parses the three CHECK constraints out of `00185_resend_email_delivery_evidence.sql` and asserts this mapper's vocabulary agrees with them — event types, `source`, and `reason`. Prove it is not decorative by adding a bogus value such as `'email.scheduled'` to `RESEND_EVENT_TYPES` and watching it fail. A mapper that emits a value the CHECK rejects is a 500 on a live webhook, and nothing else in the suite would catch it.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/webhooks/resend-events.ts apps/web/src/lib/webhooks/resend-events.test.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): map Resend delivery events to rows, suppressions and stamps

Only a Permanent bounce or a complaint suppresses; an unclassified bounce and
email.failed are recorded and do not, because suppressing a live contractor
address deletes the channel invisibly and mailing a dead one merely bounces
again.

Fixes the tag vocabulary here (kind / project_id / entity_id) so item 4's
dispatcher and item 7's recap send with one convention rather than two. A
non-UUID project_id tag is dropped rather than passed to a uuid column: a
22P02 would 500 the route and Svix would retry that request forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---
## Task 4 — The webhook endpoint

**Files:**
- Create: `apps/web/src/app/api/webhooks/resend/route.test.ts`
- Create: `apps/web/src/app/api/webhooks/resend/route.ts`

**Where the signing secret lives, decided:** a **Vercel environment variable named `RESEND_WEBHOOK_SECRET`** on the `esite` project, set for Production, Preview and Development, whose value is the `whsec_…` signing secret shown once when the endpoint is created in the Resend dashboard. It is **not** the `RESEND_API_KEY` — Resend issues a per-endpoint signing secret, and reusing the API key would mean a leaked read key could forge delivery evidence. It is not committed anywhere: `.env.example` carries the name and a `whsec_...` placeholder (Task 5), and the real value goes in Vercel plus the gitignored `.secrets/vercel.md` inventory. The route **fails closed with a 500 when it is unset**, exactly as `apps/web/src/app/api/paystack/webhook/route.ts:52-56` does.

**Constraints that bite in this task:**

- **Read `process.env.RESEND_WEBHOOK_SECRET` inside `POST`, not at module scope.** A module-scope constant is captured once per lambda instance, so a warm instance that started before the variable was set keeps serving 500s after it is set. Reading per request costs nothing and removes that class of bug — and it removes `vi.resetModules()` from the unconfigured-secret test. **It does not remove the redeploy in Task 7**: Vercel binds environment variables at deploy time, so a variable added after a build is absent from the running deployment's environment regardless of where the code reads it.
- **Page-level gating is not a gate**, and neither is middleware. `app/api/*` handlers are directly invocable; the signature is the only authenticator here, and it is checked before anything is parsed or written.
- **Do not use `.upsert()` for the event insert.** PostgREST emits `ON CONFLICT` only when `Prefer: resolution=merge-duplicates` arrives as an HTTP **header**, and this repository has twice shipped an upsert that reported no error and changed nothing (PR #143, PR #158). Use a plain `.insert()` and treat SQLSTATE `23505` as success — a duplicate Svix delivery is a no-op by definition. The one genuine upsert (suppressions) is re-read in production in Task 7 rather than trusted.
- **Never return a 4xx for an event you simply do not handle.** Svix retries non-2xx with backoff and disables an endpoint that keeps failing. Unhandled types get a 200.
- **Report the stamp count in the response body.** The `email_sequence_events` update is the single write this whole item exists to make. If it only ever `console.error`s while the route returns 200, it can fail permanently and invisibly — the exact defect class this item was written to end. `.select('id')` gives the affected rows, and the count goes in the body so Task 7 can assert on it from a curl.

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/app/api/webhooks/resend/route.test.ts`.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'

const { calls, insertResult, updateResult, createServiceClientMock } = vi.hoisted(() => {
  const calls: Array<{ table: string; op: string; payload: unknown; filters: string[] }> = []
  const insertResult = { value: { error: null as { code?: string } | null } }
  const updateResult = {
    value: { data: [{ id: 'seq-1' }] as { id: string }[] | null, error: null as unknown },
  }
  return { calls, insertResult, updateResult, createServiceClientMock: vi.fn() }
})

// Recorder client: every call appends to `calls`, so the assertions are about
// what was written, not about whether a promise resolved.
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    const make = (table: string) => {
      const filters: string[] = []
      const chain: any = {
        insert: (payload: unknown) => {
          calls.push({ table, op: 'insert', payload, filters })
          return Promise.resolve(insertResult.value)
        },
        upsert: (payload: unknown) => {
          calls.push({ table, op: 'upsert', payload, filters })
          return Promise.resolve({ error: null })
        },
        update: (payload: unknown) => {
          calls.push({ table, op: 'update', payload, filters })
          return chain
        },
        eq: (c: string, v: string) => { filters.push(`eq:${c}=${v}`); return chain },
        is: (c: string, v: unknown) => { filters.push(`is:${c}=${String(v)}`); return chain },
        select: () => Promise.resolve(updateResult.value),
      }
      return chain
    }
    createServiceClientMock()
    return { from: (t: string) => make(t) }
  },
}))

import { POST } from './route'

function signed(body: string, at = Date.now()) {
  const id = 'msg_test_0001'
  const ts = String(Math.floor(at / 1000))
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  const headers: Record<string, string> = {
    'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`,
  }
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as any
}

const bounced = JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-09-10T06:00:00.000Z',
  data: {
    email_id: 'ab12cd34-0000-0000-0000-000000000001',
    to: ['Ghost@aeec.co.za'],
    subject: 'Your open items',
    bounce: { type: 'Permanent', subType: 'General', message: 'no such mailbox' },
  },
})

const opened = JSON.stringify({
  type: 'email.opened',
  created_at: '2026-09-10T07:00:00.000Z',
  data: { email_id: 'ab12cd34-0000-0000-0000-000000000002', to: ['a@x.co.za'] },
})

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  calls.length = 0
  insertResult.value = { error: null }
  updateResult.value = { data: [{ id: 'seq-1' }], error: null }
  createServiceClientMock.mockClear()
})

describe('POST /api/webhooks/resend', () => {
  it('401s a tampered body and writes nothing', async () => {
    const req = signed(bounced)
    const tampered = { ...req, text: async () => bounced.replace('Permanent', 'Transient') }
    const res = await POST(tampered)
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('401s a request with no signature headers at all', async () => {
    const res = await POST({ headers: { get: () => null }, text: async () => bounced } as any)
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('401s a replayed request signed ten minutes ago', async () => {
    const res = await POST(signed(bounced, Date.now() - 10 * 60 * 1000))
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('stores a Permanent bounce and suppresses the address', async () => {
    const res = await POST(signed(bounced))
    expect(res.status).toBe(200)
    const evt = calls.find(c => c.table === 'email_events')
    expect(evt?.op).toBe('insert')
    expect(evt?.payload).toMatchObject({
      webhook_id: 'msg_test_0001',
      event_type: 'email.bounced',
      to_email: 'ghost@aeec.co.za',
      bounce_type: 'Permanent',
    })
    const sup = calls.find(c => c.table === 'email_suppressions')
    expect(sup?.op).toBe('upsert')
    expect(sup?.payload).toMatchObject({ email_address: 'ghost@aeec.co.za', reason: 'hard_bounce' })
  })

  it('stamps opened_at on the sequence row, only when it is still null, and reports the count', async () => {
    const res = await POST(signed(opened))
    expect(res.status).toBe(200)
    const seq = calls.find(c => c.table === 'email_sequence_events')
    expect(seq?.op).toBe('update')
    expect(seq?.payload).toEqual({ opened_at: '2026-09-10T07:00:00.000Z' })
    // First open wins: a message opened five times keeps the first timestamp.
    expect(seq?.filters).toContain('is:opened_at=null')
    expect(seq?.filters).toContain('eq:resend_message_id=ab12cd34-0000-0000-0000-000000000002')
    // The count is in the body, so a production probe can assert on it rather
    // than hoping a console.error somewhere did not fire.
    expect(await res.json()).toEqual({ received: true, stamped: 1 })
  })

  it('reports stamped:0 when the message matches no sequence row — a dashboard test event', async () => {
    updateResult.value = { data: [], error: null }
    const res = await POST(signed(opened))
    expect(await res.json()).toEqual({ received: true, stamped: 0 })
  })

  it('flags a stamp error in the body instead of failing silently', async () => {
    updateResult.value = { data: null, error: { code: '42501' } }
    const res = await POST(signed(opened))
    expect(res.status).toBe(200)   // a retry cannot help: the insert already succeeded
    expect(await res.json()).toEqual({ received: true, stamped: 0, stamp_error: true })
  })

  it('200s a duplicate delivery (unique violation) without erroring', async () => {
    insertResult.value = { error: { code: '23505' } }
    const res = await POST(signed(bounced))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, duplicate: true })
  })

  it('500s a real storage failure so Svix retries', async () => {
    insertResult.value = { error: { code: '42501' } }
    const res = await POST(signed(bounced))
    expect(res.status).toBe(500)
  })

  it('200s an unhandled event type and writes nothing — a 4xx would make Svix disable the endpoint', async () => {
    const res = await POST(signed(JSON.stringify({ type: 'contact.created', data: {} })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ignored: true })
    expect(calls).toHaveLength(0)
  })

  it('500s when the signing secret is not configured, and never reaches the database', async () => {
    // No vi.resetModules(): the route reads process.env per request.
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await POST(signed(bounced))
    expect(res.status).toBe(500)
    expect(calls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter web test src/app/api/webhooks/resend/route.test.ts
```

Expected: `Failed to load url ./route`.

- [ ] **Step 3: Write the route.** Create `apps/web/src/app/api/webhooks/resend/route.ts`.

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { readSvixHeaders, verifySvixSignature } from '@/lib/webhooks/svix-signature'
import { mapResendEvent, suppressionFor, sequenceTimestampFor } from '@/lib/webhooks/resend-events'

/**
 * Resend delivery-event webhook.
 *
 * Closes the measurement gap 00030_email_sequences.sql:24-25 left open: every
 * opened_at and clicked_at in production is NULL across 246 sends because the
 * "Phase 2" webhook was never built. Q1's outcome ships over this channel, so
 * it has to be measurable before it is designed on (§05 :173).
 *
 * The Svix signature is the ONLY authenticator — this handler sits outside
 * every session gate, so it is checked before the body is parsed or anything
 * is written. Note that middleware.ts must also let the path through
 * (SIGNED_WEBHOOK_PATHS); without that the request is 307'd to /login and
 * Svix records a delivery failure that looks like a Resend problem.
 *
 * Non-2xx makes Svix retry and eventually disable the endpoint, so an event
 * type we do not handle is acknowledged with a 200, and only a genuine storage
 * failure returns a 500 (where a retry is exactly what we want).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read per request, not at module scope: a warm lambda that started before
  // RESEND_WEBHOOK_SECRET was set would otherwise keep serving 500s after it
  // is set, and the test would need vi.resetModules() to reach this branch.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET

  // Fail closed: a missing secret must never let an unsigned request through.
  if (!webhookSecret) {
    console.error('Resend webhook: RESEND_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const headers = readSvixHeaders((name) => req.headers.get(name))
  const rawBody = await req.text()
  if (!headers || !verifySvixSignature({ secret: webhookSecret, body: rawBody, headers })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    // Signed but unparseable: acknowledge, do not invite a retry loop.
    console.warn('Resend webhook: signed body was not JSON')
    return NextResponse.json({ ignored: true })
  }

  const row = mapResendEvent(headers.id, parsed)
  if (!row) return NextResponse.json({ ignored: true })

  const supabase = createServiceClient() as any

  // Plain insert, not upsert: PostgREST only emits ON CONFLICT when
  // `Prefer: resolution=merge-duplicates` arrives as a header, and this
  // repository has twice shipped an upsert that reported no error and wrote
  // nothing. webhook_id is UNIQUE, so a Svix retry lands 23505 — which is
  // success, not failure.
  const { error: insertError } = await supabase.from('email_events').insert(row)
  if (insertError) {
    if (insertError.code === '23505') return NextResponse.json({ received: true, duplicate: true })
    console.error('Resend webhook: email_events insert failed', insertError)
    return NextResponse.json({ error: 'store failed' }, { status: 500 })
  }

  const suppression = suppressionFor(row)
  if (suppression) {
    const { error } = await supabase
      .from('email_suppressions')
      .upsert(suppression, { onConflict: 'email_address' })
    if (error) {
      console.error('Resend webhook: email_suppressions upsert failed', error)
      return NextResponse.json({ error: 'suppress failed' }, { status: 500 })
    }
  }

  // The stamp is the write this whole item exists to make, so its outcome goes
  // in the response body rather than only into a log line nobody reads.
  //
  // .is(column, null) so the FIRST open wins — a message opened five times
  // keeps the timestamp of the open that mattered.
  //
  // A stamp failure does NOT 500: email_events already holds the row, so a
  // Svix retry would short-circuit on 23505 and never reach this code again.
  // Reporting it is the only useful thing left to do.
  let stamped = 0
  let stampError = false
  const stamp = sequenceTimestampFor(row)
  if (stamp && row.resend_message_id) {
    const { data, error } = await supabase
      .from('email_sequence_events')
      .update({ [stamp.column]: stamp.value })
      .eq('resend_message_id', row.resend_message_id)
      .is(stamp.column, null)
      .select('id')
    if (error) {
      console.error('Resend webhook: sequence stamp failed', error)
      stampError = true
    } else {
      stamped = data?.length ?? 0
    }
  }

  return NextResponse.json(
    stampError ? { received: true, stamped: 0, stamp_error: true } : { received: true, stamped },
  )
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter web test src/app/api/webhooks/resend/route.test.ts
```

Expected: `Tests 11 passed`.

- [ ] **Step 5: Prove the signature gate can fail.** Temporarily replace the `if (!headers || !verifySvixSignature(...))` condition with `if (false)`, re-run, and confirm **exactly three** tests fail — the three `401s …` cases, each with `expected 200 to be 401`. Revert and confirm `Tests 11 passed`. A webhook whose tests pass with verification disabled is guarding nothing.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/app/api/webhooks/resend/
git commit -m "$(cat <<'EOF'
feat(webhooks): add POST /api/webhooks/resend delivery-event endpoint

Signature-authenticated (the handler sits outside every session gate), plain
INSERT with 23505-as-success rather than an upsert, 200 on unhandled types so
Svix never disables the endpoint, 500 only where a retry is what we want.

The secret is read per request, not at module scope: a warm lambda would
otherwise keep 500ing after the variable is set.

The sequence stamp reports its affected-row count in the response body. It is
the one write this item exists to make; a console.error and a 200 would let it
fail permanently and invisibly, which is the defect class this item ends.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Let the request reach the handler, and document the surface

This is the task that stops the whole feature being silently dead. `apps/web/src/middleware.ts:175-179` matches `/api/*`; `:85-87` bypasses only `SELF_AUTH_PATHS`; `:100-105` redirects an unauthenticated request to `/login` with a 307. Without a bypass the webhook never runs.

**And the same bug is live on Paystack today.** `apps/web/src/app/api/paystack/webhook/route.ts:50-70` verifies an HMAC-SHA512 over the raw body, constant-time, failing closed on a missing secret — structurally identical to the route in Task 4 — and grepping `middleware.ts` shows it is in neither `PUBLIC_PATHS` (`:5-20`) nor `PUBLIC_EXACT_PATHS` (`:24`) nor `SELF_AUTH_PATHS` (`:39`). It is 307'd to `/login`. Paystack is not in live mode, so nothing is broken *today* — but the fix is one string in the array being edited anyway, the verification that matters is the middleware unit test rather than live traffic, and discovering this during the KYC smoke test would burn a round trip with a payment provider. `docs/rbac-matrix.md` has never listed it either (verified: `grep -n "paystack/webhook" docs/rbac-matrix.md` returns nothing).

**Files:**
- Modify: `apps/web/src/middleware.ts` (after `:39`, and `:85-87`)
- Modify: `apps/web/src/middleware.test.ts` (append a describe block)
- Modify: `apps/web/.env.example:17`
- Modify: `docs/rbac-matrix.md:174`
- Modify: `CONFORMANCE.md` (§E table and the Env-gated items table)
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md:388`

- [ ] **Step 1: Write the failing middleware test.** Append to `apps/web/src/middleware.test.ts`, after the existing describes. The file already provides `state`, `run(path)` and `locationOf(res)` at `:15`, `:53` and `:57`.

```ts
// `run(path)` issues a GET; middleware.ts does not branch on method, so the
// bypass it proves is the same one a POST takes.
describe('signed webhook bypass', () => {
  it('lets an unauthenticated request to /api/webhooks/resend through to its handler', async () => {
    state.user = null
    const res = await run('/api/webhooks/resend')
    // Not a redirect. If this is a 307 to /login, Svix records a delivery
    // failure, retries, and eventually disables the endpoint — and the symptom
    // is indistinguishable from "Resend never sends webhooks".
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })

  it('lets an unauthenticated request to /api/paystack/webhook through — broken since it shipped', async () => {
    state.user = null
    const res = await run('/api/paystack/webhook')
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })

  it('still redirects an unauthenticated request to a neighbouring path', async () => {
    state.user = null
    const res = await run('/api/webhooks')
    expect(locationOf(res).pathname).toBe('/login')
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter web test src/middleware.test.ts
```

Expected: the **first two** new tests fail with `expected '/login' to be null` (or `expected 307 to be 200`). **That is the live bug, demonstrated twice.** The third passes already — `/api/webhooks` with no trailing segment is deliberately *not* bypassed, so a `startsWith` that is too loose gets caught here.

- [ ] **Step 3: Add the bypass.** In `apps/web/src/middleware.ts`, immediately after the `SELF_AUTH_PATHS` declaration at `:39`, add:

```ts
// Webhook endpoints authenticated by a signature over the raw request body,
// not by a session or a bearer token. They must NOT be redirected: a 307 to
// /login is recorded by the sender as a failed delivery, and after enough
// failures the provider disables the endpoint — a failure mode that looks
// exactly like the provider never sending anything.
//
// Exact paths, not prefixes: '/api/webhooks' itself is not an endpoint.
//
// /api/paystack/webhook was in no list at all and has therefore been 307'd
// since it shipped. Paystack is not in live mode yet, so nothing is broken
// today — but finding this during the KYC smoke test would cost a round trip
// with a payment provider.
const SIGNED_WEBHOOK_PATHS = ['/api/webhooks/resend', '/api/paystack/webhook']
```

Then extend the bypass at `:85-87`:

```ts
  if (
    SELF_AUTH_PATHS.some((p) => pathname.startsWith(p)) ||
    SIGNED_WEBHOOK_PATHS.includes(pathname)
  ) {
    return NextResponse.next()
  }
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter web test src/middleware.test.ts
```

Expected: all tests pass, including all three new ones.

- [ ] **Step 5: Document the environment variable.** In `apps/web/.env.example`, after line 17 (`RESEND_API_KEY=re_...`), add:

```
# Resend webhook signing secret — shown once when the endpoint is created in the
# Resend dashboard (Webhooks → Add Endpoint → https://www.e-site.live/api/webhooks/resend).
# NOT the API key: a leaked read key must not be able to forge delivery evidence.
# The route fails closed with a 500 when this is unset.
RESEND_WEBHOOK_SECRET=whsec_...
```

- [ ] **Step 6: Update `docs/rbac-matrix.md` in this same commit.** The same-PR rule is absolute. Insert two rows after line 174 (`| \`POST /api/paystack/callback\` | n/a — public webhook, signature-validated |`):

```
| `POST /api/webhooks/resend` | n/a — public webhook, Svix/standardwebhooks HMAC-SHA256 over the raw body; writes only as service_role; bypassed in `middleware.ts` by exact path |
| `POST /api/paystack/webhook` | n/a — public webhook, HMAC-SHA512 over the raw body; was never listed here and was 307'd to `/login` until `SIGNED_WEBHOOK_PATHS` |
```

- [ ] **Step 7: Update `CONFORMANCE.md` in this same commit** (an auth surface and a new credential). Add to the §E table:

```
| E7 | Unauthenticated signed webhook surfaces verify a signature over the raw body, in constant time, fail closed on a missing secret, and are reachable — not redirected by middleware | MUST | ✓ | `apps/web/src/lib/webhooks/svix-signature.ts` (Svix/standardwebhooks HMAC-SHA256, 5-min replay window, `timingSafeEqual`) consumed by `app/api/webhooks/resend/route.ts`; `app/api/paystack/webhook/route.ts` (HMAC-SHA512). Both listed in `middleware.ts` `SIGNED_WEBHOOK_PATHS` (exact match) and covered by `middleware.test.ts`. The Svix verifier is tested against the published standardwebhooks vector plus tampered body/signature/id, wrong secret and stale timestamp |
```

And to the Env-gated items table:

```
| Resend delivery evidence (E7) | code-complete, endpoint registration pending | Set `RESEND_WEBHOOK_SECRET` in Vercel, redeploy, then create the endpoint in the Resend dashboard for the eight `email.*` events and enable Open Tracking on the domain |
```

- [ ] **Step 8: Register the route in Appendix A(g) in this same commit.** §12 §(h) test 4 diffs A(g) against `docs/rbac-matrix.md`. At `16-appendix-registries.md:388`, after the `POST /api/cron/daily-recap` row, add:

```
| `POST /api/webhooks/resend` ‡ | `api` | Q1 (pre-window, item 0) | Svix/standardwebhooks signature over the raw body; no session; service-role writes only; bypassed in `middleware.ts` by exact path |
```

- [ ] **Step 9: Run the full gate and commit.**

```bash
pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint
git add apps/web/src/middleware.ts apps/web/src/middleware.test.ts apps/web/.env.example \
        docs/rbac-matrix.md CONFORMANCE.md \
        docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md
git commit -m "$(cat <<'EOF'
fix(middleware): let signature-authenticated webhooks reach their handler

middleware.ts matches /api/* and 307s every unauthenticated request to
/login, so a new /api/webhooks/* route never runs — Svix records the redirect
as a failed delivery and eventually disables the endpoint, which is
indistinguishable from the provider never sending anything.

/api/paystack/webhook has the same shape and was in no bypass list at all, so
it has been 307'd since it shipped. Paystack is not live yet, so nothing is
broken today; finding it during the KYC smoke test would not be free. It is
also added to docs/rbac-matrix.md, which never listed it.

Exact-path bypass plus the tests that would have caught both. rbac-matrix,
CONFORMANCE and Appendix A(g) updated in the same commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — One suppression helper, and the honest statement that nothing calls it yet

`public.email_suppressions` is created here and first **read** twelve weeks later, by §13 item 7's recap. In between, `reengagement-check` (pg_cron job 6) and the four onboarding crons fire daily against `_shared/email-sequence.ts`, whose only pre-send gate is `hasOptedOut` at `:121`. So the platform will start recording hard bounces and keep mailing those exact addresses.

**The decision, taken explicitly: the list is deliberately write-only until item 7, and item 7 owns wiring the consult.** Wiring it here would mean editing `_shared/email-sequence.ts` and CLI-deploying seven Deno edge functions — and §15 `:164` records that **Q1 introduces no new edge function precisely so that no Q1 deliverable waits on the workflow-scoped token**. What this task ships instead is (a) the single implementation both future callers import, so items 4 and 7 do not diverge, and (b) the statement, in three places, that the protection is a record and not yet a control.

**Files:**
- Create: `packages/shared/src/email/suppression.test.ts`
- Create: `packages/shared/src/email/suppression.ts`
- Modify: `packages/shared/src/index.ts:21` (after `export * from './email/site-form-email'`)
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/15-metrics-risks-open-questions.md:121`

- [ ] **Step 1: Write the failing test.** Create `packages/shared/src/email/suppression.test.ts`.

```ts
import { describe, it, expect, vi } from 'vitest'
import { isSuppressed } from './suppression'

/** Minimal recorder standing in for a Supabase client. */
function client(result: { data: unknown; error: unknown }) {
  const seen: { table?: string; column?: string; value?: string } = {}
  return {
    seen,
    from(table: string) {
      seen.table = table
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            seen.column = column
            seen.value = value
            return { maybeSingle: async () => result }
          },
        }),
      }
    },
  }
}

describe('isSuppressed', () => {
  it('is true when the address has a row', async () => {
    const c = client({ data: { email_address: 'ghost@aeec.co.za' }, error: null })
    expect(await isSuppressed(c as never, 'ghost@aeec.co.za')).toBe(true)
    expect(c.seen.table).toBe('email_suppressions')
    expect(c.seen.column).toBe('email_address')
  })

  it('is false when it does not', async () => {
    const c = client({ data: null, error: null })
    expect(await isSuppressed(c as never, 'live@aeec.co.za')).toBe(false)
  })

  it('normalises case and whitespace before looking up', async () => {
    const c = client({ data: null, error: null })
    await isSuppressed(c as never, '  Ghost@AEEC.co.za ')
    expect(c.seen.value).toBe('ghost@aeec.co.za')
  })

  it('is false for an empty address without querying at all', async () => {
    const c = client({ data: null, error: null })
    expect(await isSuppressed(c as never, '   ')).toBe(false)
    expect(c.seen.table).toBeUndefined()
  })

  it('FAILS OPEN on a read error, and says so loudly', async () => {
    // A read error here would otherwise silence every outbound email on the
    // platform at once. Mailing a handful of dead addresses until someone
    // fixes the query is the cheaper failure.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = client({ data: null, error: { message: 'permission denied' } })
    expect(await isSuppressed(c as never, 'ghost@aeec.co.za')).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @esite/shared test src/email/suppression.test.ts
```

Expected: `Failed to load url ./suppression`.

- [ ] **Step 3: Write the helper.** Create `packages/shared/src/email/suppression.ts`.

```ts
/**
 * The bounce/complaint suppression consult.
 *
 * ⚠ NOTHING CALLS THIS YET, AND THAT IS DELIBERATE.
 *
 * public.email_suppressions is created in migration 00185 (pre-window, §13
 * item 0) and is WRITE-ONLY until §13 item 7 builds the 07:00 recap. Until
 * then the seven lifecycle edge functions gate only on hasOptedOut
 * (apps/edge-functions/supabase/functions/_shared/email-sequence.ts:121) and
 * will keep mailing a hard-bounced address daily.
 *
 * Wiring the consult into those functions would mean CLI-deploying seven Deno
 * edge functions, and §15 :164 records that Q1 introduces no edge-function work
 * precisely so that no Q1 deliverable waits on the workflow-scoped token. So
 * the list is a record now and a control from item 7.
 *
 * This file exists so that item 4's dispatcher and item 7's recap import ONE
 * implementation instead of writing two that drift. §05 :187 names this list as
 * one of exactly three switches the always-fires notifications honour; two
 * different implementations of one of those three is not a switch.
 */

/** The narrow slice of a Supabase client this needs. Structural on purpose. */
export interface SuppressionClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

export async function isSuppressed(
  supabase: SuppressionClient,
  emailAddress: string,
): Promise<boolean> {
  const address = (emailAddress ?? '').trim().toLowerCase()
  if (!address) return false

  const { data, error } = await supabase
    .from('email_suppressions')
    .select('email_address')
    .eq('email_address', address)
    .maybeSingle()

  if (error) {
    // FAIL OPEN, on purpose. Failing closed on a read error would silence
    // every outbound email on the platform simultaneously — an invisible total
    // outage. Mailing a handful of dead addresses until the error is fixed is
    // the cheaper failure, and it is visible: it produces more bounce events.
    // The loud log is what makes it reach §15 §(b2) Rule 3's Monday review.
    console.error('isSuppressed: suppression read failed, allowing the send', error)
    return false
  }

  return data !== null
}
```

- [ ] **Step 4: Export it from the barrel and run the test.** Add to `packages/shared/src/index.ts`, immediately after `export * from './email/site-form-email'` at `:21`:

```ts
export * from './email/suppression'
```

```bash
pnpm --filter @esite/shared test src/email/suppression.test.ts
```

Expected: `Tests 5 passed`.

- [ ] **Step 5: Prove the normalisation test can fail.** Temporarily change `.trim().toLowerCase()` to `.trim()`, re-run, and confirm exactly one test fails — `normalises case and whitespace before looking up`, with `expected 'Ghost@AEEC.co.za' to be 'ghost@aeec.co.za'`. Revert and confirm `Tests 5 passed`. `email_suppressions.email_address` is the primary key and the webhook writes it lower-cased, so a consult that does not normalise silently never matches — the same shape as a switch that is wired but never fires.

- [ ] **Step 6: Put the list on the Monday ops review.** Nothing consults it until item 7, so a human has to. In `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/15-metrics-risks-open-questions.md`, extend Rule 3 at `:121` with a second sentence:

```
**It also reads `select * from public.email_suppressions`.** That list is written by the Resend webhook from the pre-window and is not consulted by any sender until §13 item 7, so between those two dates a hard-bounced address keeps receiving lifecycle mail daily. One line in a review that already happens is proportionate to a table with zero rows; a growing list before item 7 is a signal to bring the consult forward.
```

- [ ] **Step 7: Run the full gate and commit.**

```bash
pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint
git add packages/shared/src/email/suppression.ts packages/shared/src/email/suppression.test.ts \
        packages/shared/src/index.ts \
        docs/superpowers/specs/2026-09-09-v2-platform-roadmap/15-metrics-risks-open-questions.md
git commit -m "$(cat <<'EOF'
feat(email): one suppression consult, and the honest note that nothing calls it

public.email_suppressions is written from the pre-window and first read twelve
weeks later by item 7's recap. Wiring the consult into the seven lifecycle
edge functions would mean a CLI deploy, and Q1 deliberately introduces no
edge-function work so nothing waits on the workflow-scoped token.

So: one implementation both future callers import (§05 :187 names this list as
one of three switches — two implementations of one switch is not a switch),
the write-only status stated in the table comment and in this file, and a
`select * from email_suppressions` added to §15 §(b2) Rule 3's Monday review so
a growing list is seen by a human rather than by nobody.

Fails OPEN on a read error: failing closed would silence every outbound email
at once, invisibly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Merge, apply, register and verify in production

**Files:** none created. This is the deploy-and-prove task, and its steps are in a strict order for a reason given at each one.

**Constraints that bite in this task:**
- **`supabase db push` keys on the version PREFIX.** A number already in `schema_migrations` makes it print "Remote database is up to date", **exit 0, and skip the file**. A green `Deploy DB Migrations` run is *not* evidence the migration ran. That is how PR #163 shipped nothing behind three green signals.
- **Claim the number at merge, against `max(version)` AND `origin/main`** — either can have moved since the branch was cut. Announce it to any peer session on the shared checkout.
- **Verify by reading the object back out of production**, never by trusting the workflow.

- [ ] **Step 1: Set up a production query helper.** Run once per shell.

```bash
mkdir -p /tmp/esite-pgq && cat > /tmp/esite-pgq/pgq.mjs <<'JS'
const q = process.argv[2];
const r = await fetch("https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query", {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.PAT, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
});
console.log(await r.text());
JS
PAT=$(security find-generic-password -s "Supabase CLI" -w)
case "$PAT" in go-keyring-base64:*) PAT=$(printf '%s' "${PAT#go-keyring-base64:}" | base64 -d);; esac
export PAT
pgq () { node /tmp/esite-pgq/pgq.mjs "$1"; }
pgq "select 1 as ok"
```

Expected: `[{"ok":1}]`.

- [ ] **Step 2: Claim the migration number, immediately before merging — not now, and not when the branch was cut.**

```bash
pgq "select max(version) as head from supabase_migrations.schema_migrations"
git fetch origin main && git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
```

Both must show `00184` as the highest. If they do, `00185` stands and no rename is needed. If either has moved, `git mv` the file to `max + 1` **and** update every reference to it in this plan's later steps. Announce the number to peer sessions before pushing.

- [ ] **Step 3: Push the branch and open the PR against the right base.** Task 0 settled this: if the roadmap branch has not merged yet, `--base docs/v2-platform-roadmap`. Note the branch carries no `.github/workflows/**` change — Task 12 is a separate PR precisely because this token cannot push one.

```bash
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD:feat/resend-delivery-evidence
gh pr create --head feat/resend-delivery-evidence --base docs/v2-platform-roadmap \
  --title "Q1 item 0: Resend delivery evidence (migration 00185)" --body "$(cat <<'EOF'
E-Site has never measured whether one of its emails was opened. 246 sends,
`opened_at` and `clicked_at` NULL on every row, because the webhook
`00030_email_sequences.sql:24-25` promised as "Phase 2" was never built.
Q1's entire outcome ships over that channel.

Adds `public.email_events` + `public.email_suppressions` (migration 00185),
`POST /api/webhooks/resend` with Svix signature verification, and the
middleware bypass without which the endpoint is 307'd to /login and never
runs — a bypass that also fixes `POST /api/paystack/webhook`, which has been
redirected since it shipped.

Base is the roadmap branch, not main: the Appendix A(f)/A(g) registry edits
that §12 §(h) tests 4 and 8 require touch files that do not exist on main yet.

rbac-matrix, CONFORMANCE and Appendix A(f)/A(g) updated in-PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After merge, verify the migration actually applied — do not read the workflow's colour.**

```bash
pgq "select version from supabase_migrations.schema_migrations order by version desc limit 3"
```

Expected: `00185` present and highest. If the workflow is green but `00185` is absent, the prefix-skip has bitten: apply the file's SQL directly through `pgq` and then reconcile `schema_migrations`.

- [ ] **Step 5: Read the objects back out of production.** This is the `-- @verify:` block, executed — and it checks **INSERT, UPDATE and DELETE, not only SELECT**, because a new `public` table is born with all of them.

```bash
pgq "select
       to_regclass('public.email_events')       is not null as events_table,
       to_regclass('public.email_suppressions') is not null as supp_table,
       (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
         where c.relname='email_events' and p.polname='email_events_org_admin_read') as policy_rows,
       (select count(*) from pg_indexes where tablename='email_events'
         and indexname in ('email_events_message_id_idx','email_events_to_email_idx')) as idx_rows,
       has_table_privilege('anon','public.email_events','SELECT') as anon_ev_sel,
       has_table_privilege('anon','public.email_events','INSERT') as anon_ev_ins,
       has_table_privilege('anon','public.email_events','UPDATE') as anon_ev_upd,
       has_table_privilege('anon','public.email_events','DELETE') as anon_ev_del,
       has_table_privilege('anon','public.email_suppressions','SELECT') as anon_sup_sel,
       has_table_privilege('anon','public.email_suppressions','INSERT') as anon_sup_ins,
       has_table_privilege('anon','public.email_suppressions','UPDATE') as anon_sup_upd,
       has_table_privilege('anon','public.email_suppressions','DELETE') as anon_sup_del,
       has_table_privilege('authenticated','public.email_suppressions','SELECT') as auth_sup_sel"
```

Expected exactly: `events_table true, supp_table true, policy_rows 1, idx_rows 2`, and **every one of the nine privilege columns `false`**. Any `true` among them fails the task — do not accept `relacl` being NULL as evidence of anything; a NULL `relacl` *is* the default grant.

**Prove this check can fail**, once, so it is not decorative:

```bash
pgq "begin;
     create table public.__acl_probe (id int);
     select has_table_privilege('anon','public.__acl_probe','INSERT') as anon_can_insert;
     rollback;"
```

Expected: `anon_can_insert true`. That is a table created without the REVOKE, inside a rolled-back transaction — it proves the guard above is measuring something real, and it leaves nothing behind.

- [ ] **Step 6: Prove the RLS limitation the migration header claims.** A project_manager must read zero rows. Pick one and check in a rolled-back transaction.

```bash
pgq "select user_id from projects.project_members where role='project_manager' limit 1"
```

Then, substituting that id:

```bash
pgq "begin;
     set local role authenticated;
     set local request.jwt.claims = '{\"sub\":\"<PM_USER_ID>\",\"role\":\"authenticated\"}';
     select count(*) as pm_visible_email_events from public.email_events;
     rollback;"
```

Expected: `0`. Record it in Task 10's note §7 — the limitation becomes a tested fact rather than a surprise discovered in Q1.

- [ ] **Step 7: Create the endpoint in Resend and copy its signing secret.** **Owner: whoever holds the Resend account login — Arno by default.** This is step *one* of the deployment sequence, not step two: the secret does not exist until the endpoint does.

Resend dashboard → Webhooks → Add Endpoint:
  - URL `https://www.e-site.live/api/webhooks/resend` (the canonical production host; `www` is the `NEXT_PUBLIC_SITE_URL` and `app.e-site.live` still has no DNS record).
  - Events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed` — exactly the eight the CHECK constraint admits.
  - Copy the `whsec_…` signing secret. It is shown once.

**Between this step and Step 9, Resend may post to a route whose secret is unset and get a 500.** That is expected and self-healing — Svix retries — but keep the window to minutes rather than days.

- [ ] **Step 8: Turn Open Tracking ON and leave Click Tracking OFF.** Resend dashboard → Domains → `e-site.live`.

**Without this the item ships and measures nothing.** Resend emits `email.opened` and `email.clicked` **only when tracking is enabled per domain**, so every future row would carry `opened_at IS NULL` exactly as today — the plan's own "column provisioned for a later phase that nothing writes" defect, reproduced by the item built to end it.

**Click tracking stays OFF, deliberately.** It rewrites every `href` through a Resend redirect domain, so "View RFI" stops saying e-site to a contractor who has never used the product and is being asked to trust it. §15's diagnostics already specify server-side click measurement via `?r=<recap_id>`, which costs nothing and keeps the link honest. Record both the choice and this reason in Task 10's note §5.

- [ ] **Step 9: Set the secret in Vercel, then redeploy.** Vercel dashboard → `esite` project → Settings → Environment Variables → add `RESEND_WEBHOOK_SECRET` for **Production, Preview and Development**, value from Step 7. Then trigger a redeploy.

The redeploy is required even though the route reads `process.env` per request: **Vercel binds environment variables at deploy time**, so a variable added after a build is not in the running deployment's environment at all. Reading in-handler removes a *different* failure — a warm lambda holding a stale value — not this one.

- [ ] **Step 10: Prove the route is reachable — the 401-not-307 probe.** The cheapest possible production check, and it distinguishes four different failures by status code alone.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  https://www.e-site.live/api/webhooks/resend
```

Expected: **`401`**. A `307` means the middleware bypass did not deploy. A `500` means `RESEND_WEBHOOK_SECRET` is unset in that environment (or the redeploy in Step 9 has not finished). A `404` means the route did not build. Do not proceed until this reads 401.

Run the same probe against `https://www.e-site.live/api/paystack/webhook` and expect `401` there too — that endpoint returned a 307 before this PR.

- [ ] **Step 11: Prove an event lands. The Resend dashboard re-send is the ONLY way to trigger one here.**

**Do not wait for a cron tick.** `public.email_sequence_events` carries `UNIQUE (user_id, sequence_name, step_name)` (`00030:26`) and production already holds inactive_7d 36, inactive_14d 36, inactive_30d 33 rows across 36 accounts — **every re-engagement step is a spent lifetime shot**. The four onboarding crons select on signup age and there are no new signups. So the 01:20 UTC tick sends zero mail, Resend delivers zero webhooks, and an engineer who waited would conclude the endpoint is broken and start debugging a working system.

In the Resend dashboard → Webhooks → your endpoint → pick a recent delivery → **Re-send**. Then:

```bash
pgq "select event_type, to_email, occurred_at, source, entity_ref
       from public.email_events order by received_at desc limit 5"
```

Expected: at least one row, `source = 'webhook'`, `to_email` lower-cased, `entity_ref` NULL (nothing sends tags until item 4). **A dashboard test event carries a synthetic `email_id` that matches no sequence row, so the route's response body will read `stamped: 0` — that is expected**, and only the `email_events` insert is the assertion here.

Re-read the suppression table rather than trusting the upsert — this is the `Prefer: resolution=merge-duplicates` lesson generalised:

```bash
pgq "select * from public.email_suppressions"
```

- [ ] **Step 12: Prove the column this whole item exists to populate can be populated.** Open one of the platform's own lifecycle emails in a real mailbox (any of the 36 addresses whose owner will co-operate — Arno's own is the obvious one), wait a minute for Resend to fire `email.opened`, then:

```bash
pgq "select count(*) filter (where opened_at  is not null) as opened,
            count(*) filter (where clicked_at is not null) as clicked,
            count(*) as total
       from public.email_sequence_events"
```

Expected: **`opened` ≥ 1**. It has been `0` since 2026-04-20.

If it is still 0: check the `email_events` table for an `email.opened` row. If one exists but the sequence row is unstamped, the message id did not match — read the route's `stamped` field on the next event. If no `email.opened` row exists at all, **Step 8's Open Tracking toggle did not take**, which is the single most likely cause and the reason that step exists.

- [ ] **Step 13: Confirm the deliverability record §05 :173(1) requires.** Resend dashboard → Domains → `e-site.live`: confirm SPF, DKIM and **DMARC** all read verified, and capture the result for Task 10's note §5. §05 makes this explicitly part of item 0 and makes item 7's exit criterion meaningless without it. If DMARC is absent, that is a DNS record Arno adds in Google Cloud DNS — record it as an open action with an owner, not a blocker for this task.

- [ ] **Step 14: Cut the second branch for the back-fill.** The migration is applied, so the back-fill can now run — and Tasks 8 through 10 need somewhere to land that is not the merged branch.

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
git fetch origin && git switch -c chore/resend-delivery-backfill-and-findings origin/docs/v2-platform-roadmap
```

(Substitute `origin/main` if the roadmap branch has merged by now — Task 0 Step 1's third number tells you which.)

---
## Task 8 — The delivery-evidence back-fill

The webhook only sees the future. The October baseline needs a real delivery figure for the sends that already happened, so the deliverability annotation published beside metric 2a is a measurement rather than an assumption.

**Files:**
- Create: `apps/web/scripts/backfill-resend-delivery-evidence.ts`

**The exact shape of the data, measured on production 2026-09-10. Do not expect the numbers the earlier draft printed.**

```
246 total  ·  235 with a resend_message_id  ·  11 without
```

| sequence | step | rows | with id |
|---|---|---|---|
| onboarding | d1 | 33 | 32 |
| onboarding | d3 | 36 | 32 |
| onboarding | d7 | 36 | 32 |
| onboarding | d14 | 36 | 36 |
| reengagement | inactive_7d | 36 | 34 |
| reengagement | inactive_14d | 36 | 36 |
| reengagement | inactive_30d | 33 | 33 |

**The 11 are a live outbound-reliability defect, not a historical curiosity.** That is **4.5% of every automated send this platform has ever made**, rejected by Resend and left as a null-message-id failure record by `_shared/email-sequence.ts:136-141`, and nobody has ever looked. All 11 are April 2026 and all are `wmeng.co.za` or `esite-staging.co.za` — **no contractor account has ever had a failed send**, which is itself a real and reassuring finding the note must carry.

**Note also that 246 ≠ 36 × 7 = 252.** Six account-steps are missing: three accounts have no `d1` row and three have no `inactive_30d` row, because their signup or dormancy window had not opened when the step last ran. Do not "simplify" this to "4 onboarding + 3 re-engagement per account".

**What this back-fill can and cannot produce, stated up front so nobody over-reads it:** the Resend retrieve endpoint returns a *last-known state* for a message, not an event stream, and it carries no bounce classification. So the back-fill produces a **delivery baseline** and it **cannot build the suppression list** — that is built forward from live webhook events (Task 7).

- [ ] **Step 1: Write the script.** Create `apps/web/scripts/backfill-resend-delivery-evidence.ts`. It lives under `apps/web/scripts/` for the same reason `sweep-orphan-snag-photos.ts` does: `@supabase/supabase-js` resolves from the web app's `node_modules`.

```ts
#!/usr/bin/env node --experimental-strip-types
/**
 * Back-fill delivery evidence for the sends that pre-date the webhook.
 * =========================================================================
 * 246 automated emails were sent before POST /api/webhooks/resend existed.
 * Their opened_at / clicked_at are NULL because nothing ever wrote them — see
 * 00030_email_sequences.sql:24-25, "populated by Resend webhook (Phase 2)".
 *
 * Measured on production 2026-09-10: 246 rows, 235 with a resend_message_id,
 * 11 without. This pulls each of the 235's last-known state from the Resend API
 * and writes it to public.email_events with source='backfill'; the 11 are
 * written as source='send_failure', event_type='email.failed', because
 * _shared/email-sequence.ts:136-141 leaves the row in place with a null message
 * id precisely as a failure record. They are 4.5% of every send ever made and
 * nothing has ever surfaced them.
 *
 * occurred_at is the ORIGINAL sent_at, never now(): item 1 builds
 * platform_metrics_weekly on this table in the very next item, and stamping
 * every row with today would render five months of history as a one-day spike.
 * The retrieval moment goes in retrieved_at, which is a different fact.
 *
 * It also prints a HOST HISTOGRAM of every href in the fetched HTML.
 * _shared/email-sequence.ts:44 defaults SITE_URL to https://app.e-site.live —
 * a hostname with no DNS record, the domain behind the PR #138 otp_expired
 * incident — while send-email/index.ts:19 defaults to https://www.e-site.live.
 * If the lifecycle mail carried buttons pointing at the dead host, then "zero
 * clicks" and "five accounts that never signed in" have a cause that no
 * webhook, re-invite or cron can fix, and Wave 1 is being planned against a
 * population that never had a working door. The script already downloads every
 * body; this costs a regex and a Map.
 *
 * What it CANNOT do: build the suppression list. The retrieve endpoint returns
 * a last-known state with no bounce classification, and public.email_suppressions
 * only ever admits a Permanent bounce or a complaint. Suppression is built
 * forward from live webhook events.
 *
 * Dry-run is the DEFAULT. Nothing is written without --live.
 *
 * Usage (from repo root; Node 22+ for --experimental-strip-types):
 *   node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts --limit 1 --print-raw
 *   node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts
 *   node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts --live
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 */

import { createClient } from '@supabase/supabase-js'

const LIVE = process.argv.includes('--live')
const PRINT_RAW = process.argv.includes('--print-raw')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

// Resend's default API rate limit is a small number of requests per second.
// 700ms between calls puts 235 messages at roughly three minutes and leaves
// headroom; a 429 here would silently truncate the baseline.
const THROTTLE_MS = 700

const HANDLED = new Set([
  'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'clicked',
])

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const resendKey = process.env.RESEND_API_KEY
if (!url || !key || !resendKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface SeqRow {
  id: string
  to_email: string
  resend_message_id: string | null
  sent_at: string
  sequence_name: string
  step_name: string
}

/** Every href host in an HTML body. mailto:, relative and {{token}} hrefs throw and are skipped. */
const HREF_RE = /href=["']([^"']+)["']/gi
function hostsIn(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(HREF_RE)) {
    try { out.push(new URL(m[1]).host) } catch { /* not an absolute URL */ }
  }
  return out
}

async function main() {
  const { data, error } = await supabase
    .from('email_sequence_events')
    .select('id, to_email, resend_message_id, sent_at, sequence_name, step_name')
    .order('sent_at', { ascending: true })
  if (error) throw new Error(`read email_sequence_events: ${error.message}`)

  const rows = (data ?? []) as SeqRow[]
  const withId = rows.filter((r) => r.resend_message_id)
  const withoutId = rows.filter((r) => !r.resend_message_id)

  console.log(`${rows.length} sequence rows · ${withId.length} with a message id · ${withoutId.length} without`)
  console.log('(measured on production 2026-09-10: 246 · 235 · 11 — a different shape means investigate before continuing)')

  if (withoutId.length) {
    const pct = ((withoutId.length / rows.length) * 100).toFixed(1)
    console.log(`\nsend_failed — Resend never accepted the send. ${withoutId.length} of ${rows.length} = ${pct}% of every`)
    console.log('automated send this platform has ever made (_shared/email-sequence.ts:136-141 leaves the')
    console.log('row as a failure record). This is a live outbound-reliability defect, not history:')
    for (const r of withoutId) {
      console.log(`  ${r.sent_at}  ${r.sequence_name}/${r.step_name}  ${r.to_email}`)
    }
    if (LIVE) {
      const failRows = withoutId.map((r) => ({
        webhook_id: `send_failure:${r.id}`,
        resend_message_id: null,
        event_type: 'email.failed',
        occurred_at: r.sent_at,          // the real send time, never now()
        to_email: r.to_email.trim().toLowerCase(),
        source: 'send_failure',
        payload: { sequence_name: r.sequence_name, step_name: r.step_name, sequence_event_id: r.id },
      }))
      const { error: failErr } = await supabase.from('email_events').insert(failRows)
      // 23505 = already back-filled. Anything else is real.
      if (failErr && failErr.code !== '23505') console.error('  send_failure insert failed', failErr)
    }
  }

  const tally: Record<string, number> = {}
  const hostTally = new Map<string, number>()
  let processed = 0

  for (const row of withId.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    const res = await fetch(`https://api.resend.com/emails/${row.resend_message_id}`, {
      headers: { Authorization: `Bearer ${resendKey}` },
    })

    if (res.status === 404) {
      tally.not_found = (tally.not_found ?? 0) + 1
      await sleep(THROTTLE_MS)
      continue
    }
    if (!res.ok) {
      console.error(`  ${row.resend_message_id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      tally.http_error = (tally.http_error ?? 0) + 1
      await sleep(THROTTLE_MS)
      continue
    }

    const body = (await res.json()) as Record<string, unknown>
    if (PRINT_RAW) {
      console.log('\n--- raw Resend response, confirm the field names before the full run ---')
      console.log(JSON.stringify(body, null, 2))
      console.log('--- end ---\n')
    }

    if (typeof body.html === 'string') {
      for (const h of hostsIn(body.html)) hostTally.set(h, (hostTally.get(h) ?? 0) + 1)
    }

    const last = typeof body.last_event === 'string' ? body.last_event : null
    if (!last || !HANDLED.has(last)) {
      console.warn(`  ${row.resend_message_id}: unexpected last_event ${JSON.stringify(last)} — skipped`)
      tally.unexpected = (tally.unexpected ?? 0) + 1
      await sleep(THROTTLE_MS)
      continue
    }

    tally[last] = (tally[last] ?? 0) + 1

    if (LIVE) {
      const { error: insErr } = await supabase.from('email_events').insert({
        webhook_id: `backfill:${row.resend_message_id}`,
        resend_message_id: row.resend_message_id,
        event_type: `email.${last}`,
        // The ORIGINAL send time. The retrieve endpoint gives a state, not a
        // time; stamping now() would put five months of history on one day and
        // item 1's weekly snapshot is built on this column next.
        occurred_at: row.sent_at,
        retrieved_at: new Date().toISOString(),
        to_email: row.to_email.trim().toLowerCase(),
        subject: typeof body.subject === 'string' ? body.subject : null,
        bounce_type: null,
        source: 'backfill',
        payload: body,
      })
      if (insErr && insErr.code !== '23505') {
        console.error(`  ${row.resend_message_id}: insert failed`, insErr)
        tally.insert_error = (tally.insert_error ?? 0) + 1
      }
    }

    processed++
    if (processed % 25 === 0) console.log(`  …${processed}/${withId.length}`)
    await sleep(THROTTLE_MS)
  }

  console.log(`\n${LIVE ? 'WROTE' : 'DRY RUN — would write'} ${processed} rows`)
  console.log('last_event tally:', tally)

  console.log('\nlink hosts found in the fetched bodies:')
  if (hostTally.size === 0) {
    console.log('  (none — no absolute hrefs, or no html field on the response)')
  } else {
    for (const [host, n] of [...hostTally].sort((a, b) => b[1] - a[1])) {
      const dead = host === 'app.e-site.live' ? '   <-- NO DNS RECORD. See PR #138.' : ''
      console.log(`  ${String(n).padStart(5)}  ${host}${dead}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Confirm the API's shape before trusting it.** Run the single-message probe first. **Do not skip this** — `last_event` and `html` are the two fields this script depends on and they must be seen, not assumed.

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... RESEND_API_KEY=...
node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts --limit 1 --print-raw
```

Read the printed JSON. If the state field is named something other than `last_event`, change the two references and re-run the probe. **If the response carries a bounce classification after all** (a `bounce` object, or a `last_event` of `bounced` with detail), then the back-fill *can* seed suppressions: add a `bounce_type` extraction and a `public.email_suppressions` insert for `Permanent` only, and say so in the note. Only add it if you see it.

- [ ] **Step 3: Dry run the whole set.**

```bash
node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts
```

Expected first line, verbatim: `246 sequence rows · 235 with a message id · 11 without`. Then the 11 named addresses (all `wmeng.co.za` / `esite-staging.co.za`, all April 2026), then the `last_event` tally, then the host histogram. **Record all three — they go in the note.**

- [ ] **Step 3b: Decide whether this is a baseline at all.** If `not_found` exceeds roughly half of the 235, Resend's retention window has eaten the pre-webhook period and the surviving minority is not representative. **Do not publish a delivery rate computed from it.** Write in note §4 instead: *"the pre-webhook period is delivery-unknown beyond Resend's retention window; the honest delivery baseline starts at webhook go-live on [date]"* — and use that go-live date as the baseline's start in §6. A figure drawn from whichever messages happened to survive is worse than no figure, because it will be quoted.

- [ ] **Step 4: Run it live and read the result back.**

```bash
node --experimental-strip-types apps/web/scripts/backfill-resend-delivery-evidence.ts --live
pgq "select source, event_type, count(*) from public.email_events
       where source in ('backfill','send_failure') group by 1,2 order by 1,3 desc"
```

The `backfill` counts must match the dry run's tally, and `send_failure` must be exactly **11**. A mismatch means inserts failed silently — investigate before writing the note.

- [ ] **Step 5: Roll the evidence up per address — this is what Wave 1 actually needs.** The per-message tally answers "how many messages", which is not the question. "Can we reach this person" is.

```bash
pgq "select to_email,
            count(*)                                              as messages,
            count(*) filter (where event_type='email.delivered')  as delivered,
            count(*) filter (where event_type='email.opened')     as opened,
            count(*) filter (where event_type='email.bounced')    as bounced,
            count(*) filter (where event_type='email.failed')     as send_failed,
            count(*) filter (where event_type='email.sent')       as sent_only,
            max(occurred_at)::date                                as last_seen
       from public.email_events
      where source in ('backfill','send_failure')
      group by 1
      order by bounced desc, send_failed desc, delivered desc"
```

- [ ] **Step 6: Split it by role cohort.** Wave 1 (contractors) and Wave 3 (the four client viewers dormant since 8 July) need different answers from the same rows: a landlord who *opened* and did not click has a content problem — there was nothing to come back for; one who never opened has a deliverability problem. A flat tally cannot tell them apart. Measured: all 36 sequence addresses match a profile exactly and 31 hold an active `user_organisations` row (13 contractor, 12 admin, 4 client_viewer, 2 owner), so the join is one `GROUP BY`.

```bash
pgq "select coalesce(uo.role,'(no org row)') as cohort,
            count(distinct e.to_email)                            as addresses,
            count(*)                                              as messages,
            count(*) filter (where e.event_type='email.delivered') as delivered,
            count(*) filter (where e.event_type='email.opened')    as opened,
            count(*) filter (where e.event_type='email.bounced')   as bounced,
            count(*) filter (where e.event_type='email.failed')    as send_failed
       from public.email_events e
       left join public.profiles p on lower(p.email) = e.to_email
       left join public.user_organisations uo on uo.user_id = p.id and uo.is_active
      where e.source in ('backfill','send_failure')
      group by 1 order by 2 desc"
```

Both tables go in note §4, and the contractor rows are cross-referenced by name against the 13 accounts §15 `:39` freezes.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/scripts/backfill-resend-delivery-evidence.ts
git commit -m "$(cat <<'EOF'
chore(email): back-fill delivery evidence for the pre-webhook sends

Dry-run by default, throttled, idempotent on backfill:<message_id>. Produces a
delivery baseline, NOT a suppression list — the retrieve endpoint returns a
last-known state with no bounce classification, so suppression is built
forward from live webhook events.

occurred_at is the original sent_at, never now(): item 1 builds
platform_metrics_weekly on this table next, and stamping today would render
2026-04-20..2026-08-30 as a single-day spike. The retrieval moment goes in
retrieved_at.

The 11 rows with a null resend_message_id are send failures, not unknowns —
4.5% of every automated send ever made, all April, all wmeng/staging, none on
a contractor domain. They are written as email.failed / source='send_failure'
so a per-address rollup is complete rather than silently short by 11.

Also prints a host histogram of every href in the fetched bodies:
_shared/email-sequence.ts:44 defaults SITE_URL to app.e-site.live, which has
no DNS record. If the lifecycle mail linked there, "zero clicks" has a cause
no webhook can fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — The two `SITE_URL` defaults

Two mail senders default the same concept to two different hosts, and one of them has no DNS record.

```
apps/edge-functions/supabase/functions/_shared/email-sequence.ts:44
  const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live'

apps/edge-functions/supabase/functions/send-email/index.ts:19
  const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.e-site.live'
```

`app.e-site.live` is the host that burnt every invite token in the PR #138 `otp_expired` incident, and `docs/staging-deployment-checklist.md:81` still instructs setting `SITE_URL` to it. The live edge secret exists but its value cannot be read back through the API, so **which host the 246 emails actually pointed at is unknown** — Task 8's histogram is what settles it.

**Files:**
- Create: `apps/web/src/lib/email/edge-site-url.contract.test.ts`
- Modify: `apps/edge-functions/supabase/functions/_shared/email-sequence.ts:44`
- Modify: `docs/staging-deployment-checklist.md:81`

- [ ] **Step 1: Write the failing contract test.** Create `apps/web/src/lib/email/edge-site-url.contract.test.ts`. It reads the two Deno files off disk, in the manner of the snag `photo_type` contract test that parses a migration — a unit test cannot import a Deno module, and the property under test is textual anyway.

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// apps/web/src/lib/email  ->  five levels up is the repo root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const FN = 'apps/edge-functions/supabase/functions'

const FILES = [
  `${FN}/_shared/email-sequence.ts`,
  `${FN}/send-email/index.ts`,
]

const DEFAULT_RE = /SITE_URL\s*=\s*Deno\.env\.get\('SITE_URL'\)\s*\?\?\s*'([^']+)'/

function siteUrlDefault(rel: string): string {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  const m = src.match(DEFAULT_RE)
  if (!m) throw new Error(`no SITE_URL default found in ${rel}`)
  return m[1]
}

describe('edge senders agree on the SITE_URL default', () => {
  it('both fall back to the canonical production host', () => {
    // app.e-site.live has NO DNS RECORD. It is the host that dead-ended every
    // invite link in the PR #138 otp_expired incident. A sender that defaults
    // to it produces mail whose buttons go nowhere, and the only symptom is
    // "nobody clicks".
    for (const f of FILES) {
      expect(siteUrlDefault(f), f).toBe('https://www.e-site.live')
    }
  })

  it('the two files do not disagree with each other', () => {
    const [a, b] = FILES.map(siteUrlDefault)
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter web test src/lib/email/edge-site-url.contract.test.ts
```

Expected: **both** tests fail —
`expected 'https://app.e-site.live' to be 'https://www.e-site.live'` for `_shared/email-sequence.ts`, and `expected 'https://app.e-site.live' to be 'https://www.e-site.live'` on the agreement test. That is the live divergence, demonstrated.

- [ ] **Step 3: Fix the default.** In `apps/edge-functions/supabase/functions/_shared/email-sequence.ts:44`:

```ts
// www is canonical. app.e-site.live has no DNS record and is the host that
// dead-ended every invite link in PR #138; a fallback to it produces mail whose
// buttons go nowhere, with "nobody clicks" as the only symptom.
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.e-site.live'
```

**This change is inert until those seven edge functions are next deployed**, which item 0 deliberately does not do (§15 `:164` — Q1 introduces no edge-function work so nothing waits on the workflow-scoped token). It lands in the repo, the contract test locks it, and it ships with item 4. What is *actionable now* is reading the live secret: **Arno** should check the `SITE_URL` edge secret's value in the Supabase dashboard and record it in note §5, because the default only matters when the secret is unset.

- [ ] **Step 4: Fix the checklist that re-introduces it.** `docs/staging-deployment-checklist.md:81`:

```
supabase secrets set SITE_URL="https://www.e-site.live" --project-ref <ref>
```

- [ ] **Step 5: Run it and watch it pass.**

```bash
pnpm --filter web test src/lib/email/edge-site-url.contract.test.ts
```

Expected: `Tests 2 passed`.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/email/edge-site-url.contract.test.ts \
        apps/edge-functions/supabase/functions/_shared/email-sequence.ts \
        docs/staging-deployment-checklist.md
git commit -m "$(cat <<'EOF'
fix(email): make both edge senders default SITE_URL to the host that resolves

_shared/email-sequence.ts:44 fell back to https://app.e-site.live — a hostname
with no DNS record, and the host that dead-ended every invite link in the
PR #138 otp_expired incident — while send-email/index.ts:19 fell back to
https://www.e-site.live. The staging checklist instructed the dead one.

A contract test now reads both files and fails if they ever disagree or if
either points anywhere but www. The change is inert until those functions are
next deployed; the live SITE_URL secret's value is an open item for Arno,
because the default only matters when the secret is unset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — The findings note, the DPA, and the entitlement ticket

**Files:**
- Create: `docs/superpowers/notes/2026-09-10-account-estate-and-email-delivery.md`

Wave 1 rollout must be planned against what was measured, not against the re-invitation theory the spec was written under. This note is where the evidence lives so that nobody re-derives it, and so that a later reader can tell which numbers were observed and which were inferred. **Every figure in it is either measured or bracketed — a note whose job is to stop people re-deriving evidence must not seed a false one.**

- [ ] **Step 1: Write the note.** Create `docs/superpowers/notes/2026-09-10-account-estate-and-email-delivery.md` with the structure below, filling every bracketed figure from the queries you actually ran in Tasks 7, 8 and 9. **Do not carry a bracket into the commit.**

```markdown
# Account estate and email delivery — what was measured

**Measured:** 2026-09-10 (estate, cron, sequence rows) and [date] (delivery back-fill).
**Why it exists:** §13 item 0 was written on the assumption that the dormant contractor
accounts were stranded invitees. They are not. This note records what is actually true so
Wave 1 is planned against evidence.
**Supersedes:** §13 line 141's "re-invite every stranded account"; line 139's either/or on
`reengagement-check`; and line 141's migration-reconciliation instruction — `00183` and
`00184` were already present in the worktree and on `origin/main`, and production's
`max(version)` was already `00184`.

## 1. The re-invitation theory is dead

36 accounts. **All 36 have a password set. All 36 have a confirmed email. `invited_at` is
NULL for every one of them** — they were created through the admin API, not the GoTrue
invite flow, so the PR #138 `otp_expired` failure class cannot apply to any of them.

Five have never signed in: three at `aeec.co.za`, one at `matlaqs.co.za`, one client viewer
at `gmigroup.co.za`. **They are not locked out. They simply never came.** Re-inviting them
would send a password-reset link to an account that already has a working password.

## 2. `reengagement-check` works and has always worked

pg_cron job 6, schedule `20 1 * * *`. **144 runs, 144 succeeded**, most recent 2026-09-10.
Eight pg_cron jobs exist and all eight are active. The `cloud-sync-poll` failure mode —
shipped in a migration, never scheduled — does not apply here.

**246 sends across seven steps — not 36 × 7 = 252.** The per-step counts are uneven:

| sequence | step | rows | with a message id |
|---|---|---|---|
| onboarding | d1 | 33 | 32 |
| onboarding | d3 | 36 | 32 |
| onboarding | d7 | 36 | 32 |
| onboarding | d14 | 36 | 36 |
| reengagement | inactive_7d | 36 | 34 |
| reengagement | inactive_14d | 36 | 36 |
| reengagement | inactive_30d | 33 | 33 |

The six gaps are accounts whose signup or dormancy window had not opened when the step last
ran. `email_sequence_events`' UNIQUE `(user_id, sequence_name, step_name)` means each step is
a single lifetime shot — which is exactly why §13 item 7's recap is per-item and always-fires
rather than per-user and once-ever, and also why **no cron tick can be used to test the
webhook**: every re-engagement step is already spent and there are no new signups.

## 3. Zero measured opens was never a behaviour measurement

`opened_at` and `clicked_at` were NULL on all 246 rows. `00030_email_sequences.sql:24-25`
comments both columns "populated by Resend webhook (Phase 2)". **Phase 2 never shipped:**
no webhook route existed anywhere under `apps/web/src/app/api/`, and nothing in the
monorepo wrote either column.

This is the same defect class as `public.notifications.read_at` (exists since
`00001_initial_schema.sql:151`, never written, which is why §15 metric 5's 5.9% is called
"the pathology, not the baseline") and the snag `photo_type` literal. **A column
provisioned for a later phase that nothing ever writes makes the metric depending on it
unmeasurable, and the zero it returns reads as a product failure.**

**Open tracking was also off.** Resend emits `email.opened` / `email.clicked` only when
tracking is enabled per domain, so even a webhook built earlier would have measured nothing.
It was enabled on [date]. **Click tracking was deliberately left OFF**: it rewrites every
`href` through a Resend redirect domain, so "View RFI" would stop saying e-site to a
contractor who has never used the product — and §15's diagnostics already specify
server-side click measurement via `?r=<recap_id>`.

## 4. Delivery baseline, from the Resend API

Back-filled [date] by `apps/web/scripts/backfill-resend-delivery-evidence.ts`.
**235 of the 246 sends had a `resend_message_id`. Eleven did not.**

| Last known state | Messages |
|---|---|
| delivered | [n] |
| opened | [n] |
| clicked | [n] |
| bounced | [n] |
| complained | [n] |
| sent (no further event) | [n] |
| not found (Resend retention) | [n] |
| **send_failed — no `resend_message_id`** | **11** |

**The 11 send failures are 4.5% of every automated send this platform has ever made, and
they are a live outbound-reliability defect, not a historical curiosity.**
`_shared/email-sequence.ts:136-141` leaves the row in place with a null message id precisely
as a failure record, so Resend never accepted those sends and nothing has ever surfaced them.
All 11 are April 2026 and all are `wmeng.co.za` or `esite-staging.co.za`:
`qa.test@esite-staging.co.za` (×4), `demo.pm@wmeng.co.za` (×3), `demo.owner@wmeng.co.za` (×2),
`arno@wmeng.co.za` (×2). **No contractor account has ever had a failed send.**

**Per address** — the question Wave 1 actually asks is "can we reach this person", not "how
many messages":

| Address | Messages | Delivered | Opened | Bounced | Send-failed | Last seen |
|---|---|---|---|---|---|---|
| [from the Step 5 rollup; cross-reference the 13 contractor accounts by name] | | | | | | |

**By role cohort** — Wave 1 and Wave 3 need different answers from the same rows:

| Cohort | Addresses | Messages | Delivered | Opened | Bounced | Send-failed |
|---|---|---|---|---|---|---|
| contractor (13) | | | | | | |
| admin (12) | | | | | | |
| client_viewer (4) | | | | | | |
| owner (2) | | | | | | |
| (no org row) (5) | | | | | | |

**What this table is and is not.** It is a *last-known state per message* from the retrieve
endpoint, not an event stream, and it carries no bounce classification — so it is a
delivery baseline and it **cannot** seed `public.email_suppressions`. The suppression list
is built forward from live webhook events only. Back-filled rows carry `source='backfill'`,
an `occurred_at` equal to the original `sent_at`, and the observation moment in
`retrieved_at`. [If `not_found` exceeded half of the 235, delete the rate above and write
instead: the pre-webhook period is delivery-unknown beyond Resend's retention window, and
the honest delivery baseline starts at webhook go-live on [date].]

**Link hosts found in the fetched bodies:** [histogram]. `_shared/email-sequence.ts:44`
defaulted `SITE_URL` to `https://app.e-site.live` — **a hostname with no DNS record**, the
host behind the PR #138 `otp_expired` incident — while `send-email/index.ts:19` defaulted to
`https://www.e-site.live`, and `docs/staging-deployment-checklist.md:81` instructed the dead
one. Both defaults are now `www` and a contract test locks them together, but **the change
is inert until those edge functions are next deployed**. The live `SITE_URL` secret's value
is [value, from Arno] — the default only matters when the secret is unset. [If the histogram
shows `app.e-site.live`: this, not disengagement, is the leading explanation for zero clicks
and five never-signed-in accounts, and Wave 1 is being planned against a population that
never had a working door.]

## 5. Deliverability posture

SPF [state] · DKIM [state] · DMARC [state] for `e-site.live`, confirmed in the Resend
dashboard on [date] per §05 :173(1). [Any open DNS action, with owner.]
Open tracking: ON from [date]. Click tracking: OFF, deliberately (see §3).
Resend DPA: [executed <date> | requested <date> | not available].
`SITE_URL` edge secret: [value | not read].

## 6. What Wave 1 should therefore assume

- The channel exists and mail is accepted. What was never known is whether it **arrives and
  is read**; from [date] that is measured on every message.
- **The five never-signed-in accounts need contact, not credentials.** Nothing technical
  stands between them and the product [unless §4's histogram says otherwise].
- **Metric 2a's denominator is fixed by §15:39 at the 13 contractor accounts named on
  9 Sep 2026 and does not move.** It is a frozen cohort for the whole programme. What this
  item adds is a per-address deliverability annotation published beside it, so a flat 2a can
  be read as non-adoption rather than as non-delivery. Addresses with a hard bounce as at
  [date]: [list, or "none"].
- §05 :173(3)'s volume ramp still stands on its own merits: the recap starts with two to
  three people on KINGSWALK and widens over eight weeks. A cold domain that starts at its
  ceiling earns a reputation problem.
- **`public.email_suppressions` is write-only until §13 item 7.** Nothing consults it. The
  seven lifecycle crons gate only on `hasOptedOut` (`_shared/email-sequence.ts:121`) and will
  keep mailing a hard-bounced address daily until item 7 wires
  `packages/shared/src/email/suppression.ts`. Item 7 owns that; §15 §(b2) Rule 3's Monday
  review reads the table meanwhile.
- **The Resend inbound entitlement answer does not block anything.** §13 line 321 decided
  inbound is Cloudflare-primary: Cloudflare Email Routing takes the MX for `in.e-site.live`
  at R0 and forwards to a Worker that signs and posts to the `inbound-email` edge function.
  A positive answer removes one hop and one deployment target for about a quarter of an
  engineer-week; a negative answer or no answer costs nothing.

## 7. Adjacent findings

- **`POST /api/paystack/webhook` was 307'd to `/login` and is now fixed.** It was in neither
  `PUBLIC_PATHS` nor `SELF_AUTH_PATHS`, so an unauthenticated Paystack callback never reached
  a handler that verifies HMAC-SHA512 over the raw body. Paystack is not in live mode, so
  nothing was broken in production — but discovering it during the KYC smoke test would have
  cost a round trip with a payment provider. It is now in `SIGNED_WEBHOOK_PATHS`, covered by
  a middleware test, and listed in `docs/rbac-matrix.md`, which had never listed it.
- **The `email_events` read policy serves org owners and admins only.** Verified against
  production in a rolled-back transaction: **a project_manager reads 0 rows.** PMs are the
  people §04 and §13 put in the chasing role, so this is a real limitation, not an oversight
  — widening it is the `/settings/users` delivery chip in item 0's plan's Deferred table.
  Five mailed addresses have no `user_organisations` row at all
  (`2766mattheus@gmail.com`, `arno@watsonmattheus.com`, `demo.owner@wmeng.co.za`,
  `demo.pm@wmeng.co.za`, `spud-test-signup@inboxkitten.com`) and are service-role only, as is
  any external `notify_rfi_to` recipient. All fail-closed and intended.
- **A new `public` table is born `anon`-writable, not merely readable.** Measured:
  `pg_default_acl` for schema `public` is
  `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
  — INSERT, UPDATE, DELETE and TRUNCATE included. `REVOKE SELECT` would not have been enough.
  Note also that A(f)'s attribution of this to `00025_grant_schema_permissions.sql:26` is
  wrong: that migration's loop covers `projects, compliance, field, marketplace, suppliers,
  billing, tenants` (`:12`) and **not** `public`, which gets it from Supabase's bootstrap.
- **`public.user_is_org_admin(uuid)` already exists**, created by
  `00177_membership_write_authz_rls.sql:256`. Appendix A(f) lists it as a Q1 `public`
  creation. `CREATE OR REPLACE` makes that harmless, but item 1 should know it is
  replacing rather than creating — and note that 00177 issued `REVOKE ALL ... FROM PUBLIC`
  without an explicit `REVOKE ... FROM anon`.
- **Exactly one view-shaped object exists in any migration in this repository** — the
  materialised view at `00021_supplier_ratings.sql:24`
  (`CREATE MATERIALIZED VIEW marketplace.supplier_rating_summary`). A matview supports
  neither RLS nor `security_invoker`, so it settles nothing about plain views.
  `public.email_suppressions` was therefore built as a table: a view defaults to the
  *owner's* permissions, and `security_invoker = true` would have been this codebase's first
  use of a setting nobody here has yet had to get right. **A(f)'s Q4 `dated_items` is still
  the programme's first plain view and should be reviewed as the first use of
  `security_invoker = true` in this codebase.**
```

- [ ] **Step 2: Confirm the Resend DPA (Appendix A(i)).** **Owner: Arno.** A(i) records Resend as an existing processor with the action "confirm the DPA in Q1 item 0". Every foreign processor of personal information is an **operator** under POPIA §21 and needs a written operator agreement; because processing happens outside the Republic, §72 additionally requires the recipient be bound to substantially similar protection. Resend receives recipient names and addresses. Action: download the executed DPA from the Resend dashboard (Settings → Legal / Compliance), confirm it names the correct legal entity and covers sub-processors, and file it with the operator agreements. **This is administrative work with a dated owner — it is not charged to the engineer-week ledger** (A(i), §13 line 109). Record the outcome in §5 of the note.

- [ ] **Step 3: Raise the Resend inbound entitlement ticket — as an optimisation, not a gate.** **Owner: Arno.** Open a Resend support request asking whether the account can receive inbound email on a subdomain. The reason it blocks nothing is already written into §6 of the note; do not restate it here.

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/notes/2026-09-10-account-estate-and-email-delivery.md
git commit -m "$(cat <<'EOF'
docs: record what the account estate and email delivery actually measure

The re-invitation theory is dead: all 36 accounts have a password and a
confirmed email, invited_at is NULL for every one, and reengagement-check has
run 144 times successfully. The zero opens were a missing webhook AND open
tracking that was never enabled, not disengagement. Wave 1 plans against this,
not against the spec's assumption.

Every figure is measured or bracketed. 246 sends, not 36 x 7 = 252; 235 with a
message id and 11 without, which is 4.5% of every send ever made and none of
them on a contractor domain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — Push the second branch and open its PR

**Without this task, Tasks 8, 9 and 10 sit on a dead local branch and never reach the repository.** The back-fill script and the findings note are the entire point of §13 item 0's brief; a note that is written and lost is worse than one never written, because the next reader re-derives everything.

- [ ] **Step 1: Run the full gate.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
pnpm --filter web test && pnpm --filter @esite/shared test && \
pnpm --filter web type-check && pnpm --filter web lint
```

- [ ] **Step 2: Confirm you are pushing what you think you are.**

```bash
git branch --show-current   # expect: chore/resend-delivery-backfill-and-findings
git log --oneline origin/docs/v2-platform-roadmap..HEAD
```

Expected: exactly three commits — the back-fill, the SITE_URL contract test, and the note. If the first branch's commits appear here too, the second branch was cut from the wrong base; re-cut it per Task 7 Step 14.

- [ ] **Step 3: Push and open the PR.**

```bash
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD:chore/resend-delivery-backfill-and-findings
gh pr create --head chore/resend-delivery-backfill-and-findings --base docs/v2-platform-roadmap \
  --title "Q1 item 0: delivery back-fill, SITE_URL contract, findings note" --body "$(cat <<'EOF'
Second half of item 0, on its own branch because it can only run after
migration 00185 is applied.

- One-off back-fill of delivery evidence for the pre-webhook sends. Dry-run by
  default. 246 sequence rows, 235 with a Resend message id, 11 without — the 11
  are send failures (4.5% of every automated send ever made), recorded as
  `email.failed` rather than left in a script's stdout.
- Contract test locking both edge senders to the same `SITE_URL` default.
  `_shared/email-sequence.ts:44` fell back to `app.e-site.live`, which has no
  DNS record and is the host behind the PR #138 otp_expired incident.
- The findings note. It supersedes §13 line 141's re-invitation instruction:
  all 36 accounts have a password and a confirmed email, `invited_at` is NULL
  for every one, and `reengagement-check` has 144 successful runs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm it merged.**

```bash
gh pr list --state merged --limit 3
git fetch origin && git ls-tree --name-only origin/docs/v2-platform-roadmap docs/superpowers/notes/
```

Expected: the note's filename listed. If it is not on a remote branch, item 0 is not done.

---

## Task 12 — Fix the edge-function workflow file

**Files:**
- Modify: `.github/workflows/deploy-edge-functions.yml`

**⚠ This task is NOT part of item 0's definition of done.** It is a separate branch, a separate PR, and an Arno-owned action, and §15 `:164` already establishes that no Q1 deliverable waits on the workflow scope. Letting an unrelated YAML fix hold item 0 open would be the tail wagging the dog. Do it if the scope arrives; hand it over if it does not.

**⚠ It also cannot be pushed with the token this environment holds.** Verified 2026-09-10:

```
$ gh auth status
  Token scopes: 'gist', 'read:org', 'repo'
```

There is no `workflow` scope, so GitHub rejects any push whose diff touches `.github/workflows/**` with *"refusing to allow an OAuth App to create or update workflow without workflow scope"* — and it rejects the **whole push**, not just that file.

**Who runs it, in order of preference:**
1. **Arno runs `gh auth refresh -h github.com -s workflow`** in an interactive terminal (device-code flow, one minute), after which the engineer pushes normally. This is the only option that also unblocks Q2, which adds two edge functions and must edit this file again.
2. **Arno edits both hunks by hand in the GitHub web UI** — repo → `.github/workflows/deploy-edge-functions.yml` → pencil → commit to a branch → PR. The complete final content is given below so it can be pasted without judgement calls.
3. A fine-grained PAT with **Workflows: write**, used for this one push and then revoked.

- [ ] **Step 1: Confirm the dead step is genuinely dead before deleting it.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
ls apps/edge-functions/supabase/functions/ | grep -c generate-report   # expect 0
git log --oneline -1 dbe2328                                            # the commit that removed it
```

Expected: `0`, and `dbe2328 PDF standardization: remove dead edge fns, popup-safe visit export, cable-pack accent wiring`. The function was removed deliberately; the workflow step naming it was left behind, so **any `workflow_dispatch` run of this workflow fails at lines 41-45 today**. Deleting the step is the correct fix — do not recreate the function.

- [ ] **Step 2: Settle which header is stale, with evidence.** `deploy-edge-functions.yml:3-6` claims `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` "aren't bound". `deploy-migrations.yml:7-9` records those two plus `SUPABASE_DB_PASSWORD` as **bound 2026-06-02**. Both jobs declare `environment: production` and read the same `secrets.*` names, and `deploy-migrations.yml` has been running green on every migration push since. **The edge-function header is the stale one.** Confirm it directly:

```bash
gh run list --workflow=deploy-migrations.yml --limit 5
```

Expected: recent successful runs. That is the evidence; record it in the commit message.

- [ ] **Step 3: Rewrite the file.** On a fresh branch (`git switch -c chore/fix-edge-function-workflow` from `origin/main`), replace lines 1-8 so the head of `.github/workflows/deploy-edge-functions.yml` reads:

```yaml
name: Deploy Edge Functions

# Secrets: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF ARE bound, in the
# `production` environment, alongside SUPABASE_DB_PASSWORD (bound 2026-06-02).
# The previous header claimed they were not; deploy-migrations.yml reads the
# same names from the same environment and has been running green on every
# migration push since, which settles it.
#
# Still workflow_dispatch-only, deliberately. This file names 3 of the 20
# function directories under apps/edge-functions/supabase/functions/, so a
# push-triggered green run would assert "edge functions deployed" while 17 —
# including cloud-sync-project and cloud-sync-cron, whose absence from this
# file is the documented cause of cloud-sync-poll never running — were never
# touched. A green signal that means less than it appears to is the exact
# failure class the `supabase db push` prefix-skip already cost this project
# twice. The COVERAGE GUARD below makes the gap visible instead of implicit;
# restoring `on: push` is safe as soon as UNMANAGED is empty.
on:
  workflow_dispatch:
```

Add this as the first step of the `deploy` job, immediately after `- uses: actions/checkout@v4`:

```yaml
      - name: Coverage guard — every function is deployed here or listed as unmanaged
        run: |
          # Functions this workflow deliberately does not deploy. Deploying them
          # needs their correct --no-verify-jwt flags, which nobody has verified.
          # Shrinking this list to empty is what makes `on: push` honest.
          UNMANAGED="auth-email-hook calculate-health-scores cloud-sync-cron cloud-sync-project \
            compliance-complete conversion-prompt eft-invoice marketplace-payment \
            onboarding-email-d0 onboarding-email-d1 onboarding-email-d3 onboarding-email-d7 \
            onboarding-email-d14 payment-recovery-check paystack-webhook reengagement-check"
          WF=.github/workflows/deploy-edge-functions.yml
          MISSING=""
          for d in apps/edge-functions/supabase/functions/*/; do
            f=$(basename "$d")
            [ "$f" = "_shared" ] && continue
            grep -q "functions deploy $f" "$WF" && continue
            case " $UNMANAGED " in *" $f "*) continue;; esac
            MISSING="$MISSING $f"
          done
          if [ -n "$MISSING" ]; then
            echo "ERROR: function(s) neither deployed nor listed as unmanaged:$MISSING"
            exit 1
          fi
          echo "Coverage guard OK."
```

Delete the `Deploy generate-report` step entirely (old lines 41-45). Leave `send-notification`, `send-email` and `validate-inspection` exactly as they are.

- [ ] **Step 4: Push (or hand off).**

```bash
git add .github/workflows/deploy-edge-functions.yml
git commit -m "$(cat <<'EOF'
ci: drop the dead generate-report deploy step, correct the stale secrets header

generate-report has had no directory since dbe2328 removed it, so every
workflow_dispatch run of this file has failed at that step. The header's
claim that SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF "aren't bound" is
false: deploy-migrations.yml reads the same names from the same `production`
environment and runs green on every migration push.

The push trigger stays off, with the reason written down: this file names 3
of 20 function directories, so a green push run would assert more than it
proves. A coverage guard now fails the job on any function that is neither
deployed nor explicitly listed as unmanaged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD:chore/fix-edge-function-workflow
```

If the push is rejected with `refusing to allow an OAuth App to create or update workflow`, **that is the expected outcome with the current token** — stop and take fallback 1 or 2 from the top of this task. Do not attempt to work around it by modifying git config or by committing the file under a different path.

- [ ] **Step 5: Prove the fix — noting that this dispatch is a production deployment.**

```bash
gh workflow run deploy-edge-functions.yml && sleep 20 && gh run list --workflow=deploy-edge-functions.yml --limit 1
```

**This is not a dry check.** Dispatching the workflow really runs `supabase functions deploy` against production for `send-notification`, `send-email` and `validate-inspection`, from whatever is currently on `main`. Confirm nothing else is mid-deploy first, and expect the `production` environment gate if an approval is configured on it. It is nonetheless the cheapest available proof, because the workflow has no dry-run mode. Note also that `gh workflow run` only dispatches a workflow present on the **default branch**, so this step runs after merge.

Expected: a completed, successful run. Before this change it fails at `Deploy generate-report`; that failure is the proof the fix was needed.

---

## Done means

Item 0 is done when all of the following are true. **Task 12 is deliberately not on this list.**

- [ ] `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter web type-check` and `pnpm --filter web lint` are green from the repo root.
- [ ] `curl -X POST https://www.e-site.live/api/webhooks/resend -d '{}'` returns **401** — not 307, not 404, not 500. The same probe against `/api/paystack/webhook` also returns 401, where it returned 307 before.
- [ ] `public.email_events` holds at least one row with `source = 'webhook'`, read back out of production — not inferred from a green deploy.
- [ ] **`select count(*) from public.email_sequence_events where opened_at is not null` returns ≥ 1**, read back out of production. This is the column the item exists to populate; every other criterion can pass while it is still zero, which is the condition the item was written to end. It also catches Open Tracking not having been enabled.
- [ ] All nine `has_table_privilege('anon', …)` checks in Task 7 Step 5 return **false**, including INSERT, UPDATE and DELETE — and the scratch-table probe was run once to prove that check can fail.
- [ ] A project_manager reads **0** rows from `public.email_events`, verified in a rolled-back transaction, and the limitation is written in the note.
- [ ] The back-fill's live tally matches its dry-run tally, `source='send_failure'` is exactly 11, and the per-address and per-cohort rollups are both in the note.
- [ ] `docs/rbac-matrix.md`, `CONFORMANCE.md` and Appendix A(f)/A(g) all changed in the same commits as the code they describe.
- [ ] Every new test has been proven capable of failing by breaking the thing it guards — the four mutation steps (Task 2 Step 5, Task 3 Step 5, Task 4 Step 5, Task 6 Step 5) were each run and each produced the stated count.
- [ ] **Both PRs are merged**: `feat/resend-delivery-evidence` and `chore/resend-delivery-backfill-and-findings`. `apps/web/scripts/backfill-resend-delivery-evidence.ts` and `docs/superpowers/notes/2026-09-10-account-estate-and-email-delivery.md` are on a remote branch, confirmed with `git ls-tree`.
- [ ] The note carries no `[bracketed]` placeholder.

**Handed off, with owners, not blocking:**

- [ ] Task 12's workflow fix — **Arno**, needs `gh auth refresh -s workflow` or a web-UI edit.
- [ ] The Resend DPA — **Arno** (Task 10 Step 2).
- [ ] The Resend inbound entitlement ticket — **Arno** (Task 10 Step 3), an optimisation only.
- [ ] DMARC, if Task 7 Step 13 found it absent — **Arno**, a Google Cloud DNS record.
- [ ] The live `SITE_URL` edge-secret value — **Arno** (Task 9 Step 3), recorded in note §5.
- [ ] Wiring the suppression consult — **§13 item 7**, using `packages/shared/src/email/suppression.ts`. Until then the list is a record, not a control, and §15 §(b2) Rule 3's Monday review reads it.
