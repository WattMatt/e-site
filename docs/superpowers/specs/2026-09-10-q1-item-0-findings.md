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
between 2026-04-20 and 2026-08-30. `resend_message_id` is populated on all but two, so Resend accepted
them.

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

## 5. Two facts item 2 and item 3 depend on, now confirmed

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
