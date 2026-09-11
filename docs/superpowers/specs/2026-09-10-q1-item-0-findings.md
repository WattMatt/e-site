# Q1 item 0 — account estate and email-delivery findings

**Date:** 2026-09-10
**Status:** Measured. These findings supersede the assumptions in `2026-09-09-v2-platform-roadmap/13-roadmap-q1-q2.md` item 0.
**Method:** Direct queries against production (Supabase `cbskbnvvgcybmfikxgky`) via the Management API, plus reads of the working tree at `origin/main` (70ac208).

Item 0 asked four questions before the quarter is designed on top of email. All four are now answered, and
three of the four answers are different from what the spec assumed. One is serious enough to change what
item 0 builds.

---

## 1. The re-engagement cron was scheduled, and it ran

The spec posed an either/or: either the dormant contractors burnt all three re-engagement emails without
returning, or the cron was never scheduled — the `cloud-sync-poll` failure mode, where a job existed in
code and nothing ever invoked it.

**It is the first.** `reengagement-check` is `pg_cron` job 6, schedule `20 1 * * *`, active, with **144 runs
and 144 successes**, most recently on 2026-09-10. All eight cron jobs are active and none has ever failed.

| Job | Schedule | Runs | Succeeded |
|---|---|---|---|
| `calculate-health-scores-daily` | `0 0 * * *` | 144 | 144 |
| `onboarding-email-d1` | `0 1 * * *` | 144 | 144 |
| `reengagement-check` | `20 1 * * *` | 144 | 144 |
| `cloud-sync-poll` | `*/15 * * * *` | 4652 | 4652 |

No investigation into cron scheduling is needed. That part of item 0 is closed.

## 2. The account estate is healthy, so re-invitation is not the fix

The spec planned to "re-invite every stranded account" with the `token_hash` link form proven in PR #138.
That plan rests on the accounts being stranded. They are not.

| Check | Result |
|---|---|
| Accounts | 36 |
| Password set | **36 of 36** |
| Email confirmed | **36 of 36** |
| `invited_at` populated | **0 of 36** — every account was created through the admin API, not the GoTrue invite flow |
| Never signed in | 5 |

The five who have never signed in are three at `aeec.co.za`, one at `matlaqs.co.za`, and one client viewer
at `gmigroup.co.za`. **None of them is locked out.** Each has a working password and a confirmed address.
They simply never came.

**This changes the diagnosis from a delivery problem to a product problem**, and it changes the Wave 1
rollout: sending these five a fresh invitation link would repeat something that has already worked
mechanically and failed to produce a sign-in. The correct response is the one Q1 is already built around —
give them something worth opening, addressed to them personally, with one obligation.

Re-invitation stays available as a remedy for a specific person who reports a broken link. It is not the
programme's answer to dormancy.

## 3. E-Site has never measured whether a single email was opened

This is the finding that changes what item 0 builds.

**246 automated emails have been sent** — four onboarding plus three re-engagement, to all 36 users —
between 2026-04-20 and 2026-08-30. `resend_message_id` is populated on **235 of the 246**, so Resend
accepted those. The other **11 sends errored** and are worth naming rather than rounding away: they are
4.5% of every automated email this platform has ever attempted, all of them in April 2026, split 7 at
`wmeng.co.za` and 4 at `esite-staging.co.za`. **None is on a contractor domain**, so the historical send
failures do not explain contractor dormancy.

| Sequence | Step | Sent | Opened | Clicked |
|---|---|---|---|---|
| onboarding | d1 | 33 | 0 | 0 |
| onboarding | d3 | 36 | 0 | 0 |
| onboarding | d7 | 36 | 0 | 0 |
| onboarding | d14 | 36 | 0 | 0 |
| reengagement | inactive_7d | 36 | 0 | 0 |
| reengagement | inactive_14d | 36 | 0 | 0 |
| reengagement | inactive_30d | 33 | 0 | 0 |
| **Total** | | **246** | **0** | **0** |

**That zero is not a measurement of behaviour. It is the absence of measurement.**
`00030_email_sequences.sql:24-25` declares both columns with the comment "populated by Resend webhook
(Phase 2)". Phase 2 never shipped. There is no Resend webhook route anywhere under
`apps/web/src/app/api/`, and a repository-wide search finds nothing that writes `opened_at` or
`clicked_at` in any file.

So the honest statement is: **we do not know whether any E-Site email has ever been opened, delivered, or
bounced.** Zero opens and 100% opens are equally consistent with the data.

### Why this blocks the quarter as designed

Q1's proving outcome is a contractor foreman opening the 07:00 recap on his phone. Metric 2a is measured
on whether contractors come back. Both are delivered over email, and email is the one channel this
platform has never instrumented. Shipping the recap onto it without the webhook would repeat the exact
failure the recap is meant to fix — an outbound channel with no evidence of receipt.

**Item 0 therefore builds a Resend event webhook before item 7 designs the recap on the same channel.**
It handles `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened` and `clicked`,
writing back to `email_sequence_events` by `resend_message_id` and to a new `email_events` table for mail
that is not sequence mail. A backfill pulls historical per-message status from the Resend API so the
October baseline carries a real delivery figure rather than a null one.

### The pattern behind three defects

This is the third instance of one failure mode in this codebase, and it is worth naming:

| Column | Declared | Written by | Consequence |
|---|---|---|---|
| `public.notifications.read_at` | `00001`, initial schema | **nothing, ever** | Inbox engagement unmeasurable; 57/964 is reconstructed from a separate boolean |
| `email_sequence_events.opened_at` / `clicked_at` | `00030`, "Phase 2" | **nothing, ever** | 246 emails with no evidence of receipt |
| `field.snag_photos.photo_type` | `00xxx` CHECK set | a value outside the CHECK | Every mobile photo insert failed; zero snag photos in 18 months |

**A column provisioned for a later phase, that nothing ever writes, does not degrade gracefully — it
silently converts a metric into a decoration.** The v2 rule follows from it: no metric ships without its
writer in the same migration, and every new instrumentation column gets a test that fails when nothing
writes it.

## 4. Repository and workflow prerequisites

| Prerequisite | State |
|---|---|
| Migrations `00183`, `00184` in the tree | **Present.** The worktree is cut from `origin/main` and matches production at 00184. The spec's warning that the tree was two behind is resolved; no renumber is needed. |
| `deploy-migrations.yml` secrets | Header records all three bound on 2026-06-02, and the workflow auto-runs on any push to `main` touching a migration. |
| `deploy-edge-functions.yml` secrets | Header claims two "aren't bound" and disabled its own push trigger on that basis. **This header is stale** — both workflows read the same repository secrets. Confirm by reading the Actions secret list, then correct the header. |
| `generate-report` deploy step | **Dead.** `.github/workflows/deploy-edge-functions.yml:41-45` deploys a function with no directory under `apps/edge-functions/supabase/functions/`. It was removed deliberately by `dbe2328` ("PDF standardization: remove dead edge fns") and the workflow step was left behind, so **any dispatch run of that workflow fails at that step today.** Delete the step. |
| Workflow-scoped token | Still required to edit either file. Q1 adds no edge function, so nothing in this quarter is gated on it; Q2's `inbound-email` and `send-web-push` are. Nominating Arno to edit both files by hand is an acceptable and cheaper answer. |

## 5. "Zero contractors active" is a broken measurement, not a true zero

The roadmap's most-quoted figure — **0 of 13 contractor accounts active in 30 days** — is computed from
`auth.users.last_sign_in_at`. That column is updated only on an explicit credential login. **It is not
updated when a returning cookie session is resumed**, which is how anyone who stays signed in on a phone
or a laptop actually uses the product.

Measured over the trailing 28 days, using the author columns that already carry history rather than
sign-in timestamps:

| Role | Domain | Writes | People |
|---|---|---|---|
| contractor | siyayapower.co.za | 27 | 2 |
| admin | wmeng.co.za | 13 | 2 |
| owner | wmeng.co.za | 6 | 1 |
| contractor | qualelect.co.za | 1 | 1 |
| **Total** | | **35** | **5** |

**Three of the five people who wrote to E-Site in the last four weeks are contractors** — and both Siyaya
Power accounts show a `last_sign_in_at` of 21 July, seven weeks before writes they demonstrably made. The
sign-in column is stale, not the users.

This does not soften the diagnosis. Five active people out of 36 accounts is still a product that almost
nobody opens, and Siyaya alone accounts for most site-originated content. But it changes two things:

1. **The Q1 baseline must be published on writes, not sign-ins**, or the programme will appear to
   manufacture contractor engagement in October that in fact already existed in September. Item 1's
   rollup unions the author columns for exactly this reason — it is the only arm measurable
   retrospectively, because `user_sessions` has no writer until item 4.
2. **`last_sign_in_at` must never again be a metric source.** It joins `notifications.read_at` and
   `email_sequence_events.opened_at` on the list of columns that look like measurements and are not.
   §15's metric 7 already refuses `auth_events` for the same reason; the same refusal applies here.

## 6. Facts items 2 and 3 depend on, now confirmed

- **`projects.qc_entries` carries `conformance` and `severity`** (added by `00176`). A section of the spec
  claimed otherwise and has been corrected. The `qc_defect` mirror's failed-entry predicate is expressible,
  and the migration does not need an abort path.
- **13 of 14 projects have at least one `project_manager` membership.** Only the Sandton demo project has
  none, so the triage-owner fallback chain — oldest project manager, then `created_by`, then org owner — is
  exercised by exactly one row in production. That is the row the fallback test should be written against.
- **Backfill volumes, measured:** 15 RFIs (all with `assigned_to` NULL, so all fifteen resolve through the
  fallback), 18 inspections at `status='assigned'`, 6 snags on active projects, 11 QC entries on issued or
  closed reports, 6 diary entries carrying delays, and 440 `node_orders` which are deliberately **not**
  back-filled.
- **No name collisions.** None of the planned Q1 or Q2 objects exists yet.
- **All six live snags belong to the E-Site DEMO organisation.** There are exactly six snags in
  production and every one is a seeded demo row, so the snag arm of the backfill touches no real work.
- **All six diary entries carrying "delays" say there were none.** The distinct values are `NO`, `None`,
  `None,` and "No delays or info required was noted in the site walk and or meeting". Mirroring them
  would manufacture six work items instructing somebody to action a non-delay, so the `diary_action` arm
  is excluded from the backfill. The trigger still fires for future entries.
- Together these drop the measured backfill from 46 items to **34** — 15 RFIs, 18 inspections and 1 site
  form.

## 7. Two defects in the spec, caught while planning against it

Planning surfaced two errors in the design that would have failed at implementation time.

1. **The single trigger declaration §03 §1.2 mandates is invalid PostgreSQL.** An `INSERT` trigger's
   `WHEN` clause cannot reference `OLD`, so the combined `INSERT OR UPDATE` trigger carrying the spec's
   `WHEN` would fail with `42P17`. Each source therefore gets a separate `_ins` and `_upd` trigger, with
   the `WHEN` on the update half only. This is also why the original "no-op `UPDATE … SET status = status`"
   backfill could never have worked.
2. **Item 2's gatekeeper guard must exempt `pg_trigger_depth() > 0`.** Without the exemption, a
   contractor closing their own RFI aborts the RFI close, because the mirror's write-back re-enters the
   guard as the contractor rather than the gatekeeper. This is a requirement item 3 places on item 2, and
   item 3's migration refuses to apply without it.
