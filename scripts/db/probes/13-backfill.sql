-- 13-backfill.sql — Task 14: sections H and I of 00199 (renumbered to 00199 at
-- merge; the snapshot table is already named for it). Asserted against
-- production inside one rolled-back transaction:
--   H  the pre-migration snapshot, the six backfill arms, the due-date floor
--      and the departed-watcher sweep
--   I  the completion event (public.product_events, 'backfill_completed')
--
-- ⚠ THIS PROBE RUNS THE BACKFILL OVER THE WHOLE LIVE ESTATE — every RFI, every
-- inspection and the one site form on the platform are projected, and the
-- write-back rewrites assigned_to / due_date / updated_at on the nine open
-- RFIs. It is safe ONLY inside rehearse-sql.ts, whose transaction always
-- ROLLBACKs. Never run this file any other way. It is also the slowest probe
-- (one advisory-locked ref allocation per item): run it LAST and once per
-- change.
--
-- Run (fixtures FIRST, then the migration, then this file):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/13-backfill.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
--
-- The fixture file is separate and stacked AHEAD of the migration on purpose:
-- the qc and snag arms project ZERO live rows, and a fixture created by this
-- probe — i.e. after the migration — would be projected by the LIVE trigger
-- instead, so the arm could be deleted outright and every assertion about it
-- would still pass. Read 13-backfill-fixtures.sql's header.
--
-- COUNTS ARE MEASUREMENTS, re-measured against production on 2026-09-15 (the
-- plan's table is 2026-09-10). Differences, all reported rather than silently
-- edited:
--   rfis          15 = 6 closed + 8 open + 1 responded, ALL fifteen unassigned
--                 (plan 15 ✓)
--   inspections   19, every one 'assigned' with both people set (plan 18; Task
--                 8 already measured 19 on 2026-09-13 — two were raised since)
--   site forms     1, the draft on (649) PNP FAERIE GLEN (plan 1 ✓)
--   snags          6, ALL in the E-Site DEMO org → 0 backfilled (plan ✓)
--   diary          6 non-empty `delays` + 2 `delay_notes`, every one a negation
--                 → 0, and no arm at all (improvement 1; plan ✓)
--   qc             11 entries, ALL conformance='na', on ONE issued report → 0
--                 (F4; plan ✓)
--   node_orders  453 rows, deliberately zero items (plan said 440)
--   ⇒ 35 items, not the plan's 34. projects.work_items is EMPTY on production
--     today (0 rows of any origin), so 35 is also the whole table.
--
-- Every count excludes projects named '_probe_%': this file is concatenated
-- into Task 17's full rehearsal, where other probes' fixtures live in the same
-- transaction and would otherwise inflate every number — and this probe's own
-- two fixture projects would too.
--
-- Contract: exactly ONE row-producing statement, last in the file. No DO block,
-- no impersonation, no mutation: the backfill has already run, inside the
-- migration, and everything below is an observation of what it left.
--
-- Expected: 29 rows. If the printed `assertions seen:` list is shorter than
-- twenty-nine names, a UNION ALL arm was dropped — read the list, not the total.

WITH live AS (
  -- The LIVE estate only.
  SELECT w.* FROM projects.work_items w
    JOIN projects.projects p ON p.id = w.project_id
   WHERE p.name NOT LIKE '\_probe\_%'
), floors AS (
  -- The floor, derived through the SAME two functions section H uses — never a
  -- hand-computed date. go_live is the one literal, and it is the migration
  -- header's literal: Task 20 Step 4 re-derives BOTH to the planned apply date.
  -- Measured 2026-09-15: all five projects holding a backfilled item answer
  -- 2026-11-10 for a 2026-11-03 go-live (no SA public holiday in the window;
  -- every project's builders' shutdown band is 12-15..01-15, so nothing is
  -- pushed).
  SELECT p.id AS project_id,
         projects.push_past_builders_shutdown(
           projects.add_working_days(DATE '2026-11-03', 5, p.id, 'office'), p.id) AS floor
    FROM projects.projects p
   WHERE EXISTS (SELECT 1 FROM projects.work_items w
                  WHERE w.project_id = p.id AND w.origin = 'mirror')
), holders AS (
  SELECT l.ball_in_court_id AS uid, count(*) AS n
    FROM live l
   WHERE l.origin = 'mirror' AND l.ball_in_court_id IS NOT NULL
   GROUP BY 1
)
SELECT 'rfi_count' AS probe, count(*) = 15 AS ok, 'got ' || count(*) || ' of 15' AS detail
  FROM live WHERE item_type = 'rfi' AND origin = 'mirror'
UNION ALL
SELECT 'inspection_count', count(*) = 19, 'got ' || count(*) || ' of 19 (the plan says 18; 19 since 2026-09-13)'
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
       'improvement 1: all 6 of 6 live "delays" say None; got ' || count(*) ||
       ' (the only count with no positive counterpart here — the diary arm is deliberately absent from the backfill, and probe 09 is where the live trigger IS proved to project a real delay)'
  FROM live WHERE item_type = 'diary_action' AND origin = 'mirror'
UNION ALL
SELECT 'qc_count_is_zero', count(*) = 0,
       'F4: zero conformance=fail rows exist on the live estate; the arm is exercised by the synthetic fixture below, not here; got ' || count(*)
  FROM live WHERE item_type = 'qc_defect' AND origin = 'mirror'
UNION ALL
SELECT 'no_order_followup_anywhere', count(*) = 0,
       '453 structure.node_orders rows (the plan said 440), deliberately zero items — A(b) gives order_followup no automatic path'
  FROM projects.work_items WHERE item_type = 'order_followup'
UNION ALL
SELECT 'total_live_items', count(*) = 35,
       'got ' || count(*) || ' of 35 expected (15 rfi + 19 inspection + 1 form; the plan''s 34 counted 18 inspections on 2026-09-10)'
  FROM live WHERE origin = 'mirror'
UNION ALL
SELECT 'nothing_from_the_demo_org', count(*) = 0,
       'improvement 2: no item may belong to E-Site DEMO; got ' || count(*)
  FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
 WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001' AND w.origin = 'mirror'
UNION ALL
-- Improvement 9, both halves. The write-back fires during the backfill (rule
-- (a) is the point) and must leave every finished record alone.
SELECT 'writeback_skipped_closed_rfis',
       (SELECT count(*) FROM projects.rfis r JOIN projects.projects p ON p.id = r.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND r.assigned_to IS NULL) = 6,
       'before: 15 unassigned. after: 6 — exactly the 6 CLOSED RFIs, which must not acquire an assignee they never had'
UNION ALL
SELECT 'writeback_filled_open_rfis',
       (SELECT count(*) FROM projects.rfis r JOIN projects.projects p ON p.id = r.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND r.status <> 'closed' AND r.assigned_to IS NULL) = 0,
       'all 9 non-closed RFIs (8 open + 1 responded) now render a holder on rfis/[id] instead of "unassigned"'
UNION ALL
SELECT 'snag_assignees_untouched',
       (SELECT count(*) FROM field.snags s JOIN projects.projects p ON p.id = s.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND s.assigned_to IS NULL) = 6,
       'no live snag was backfilled, so no live snag acquired an assignee'
UNION ALL
-- The floor, per project (improvements 6 + 9). Section H computes it through
-- projects.add_working_days + push_past_builders_shutdown so each project's own
-- calendar and shutdown band decide it; the plan's single DATE '2026-11-10'
-- literal was a second calendar.
SELECT 'due_dates_floored', count(*) = 0,
       'no OPEN backfilled item may be due before its project''s go_live + 5 office working days; got ' || count(*)
  FROM live l JOIN floors f ON f.project_id = l.project_id
 WHERE l.origin = 'mirror' AND l.status IN ('triage','open','answered')
   AND l.due_date < f.floor
UNION ALL
SELECT 'closed_items_not_refloored', count(*) = 0,
       'improvement 9: a July record must not acquire a November deadline; got ' || count(*)
  FROM live l JOIN floors f ON f.project_id = l.project_id
 WHERE l.origin = 'mirror' AND l.status IN ('closed','void') AND l.due_date = f.floor
UNION ALL
-- The floor UPDATE runs on the spine and reaches the SOURCE through section E
-- (depth 1). Without this row the floor could be applied to the spine alone and
-- the RFI page would keep showing the old, already-overdue date.
SELECT 'floor_reaches_the_rfi_source',
       (SELECT count(*) FROM live l
          JOIN projects.rfis r ON r.id = l.rfi_id
          JOIN floors f ON f.project_id = l.project_id
         WHERE l.origin = 'mirror' AND l.status IN ('triage','open','answered')
           AND r.due_date IS DISTINCT FROM f.floor) = 0
       AND (SELECT count(*) FROM live l
             WHERE l.origin = 'mirror' AND l.item_type = 'rfi'
               AND l.status IN ('triage','open','answered')) = 9,
       'all 9 open RFIs carry the floored date on projects.rfis too — the spine UPDATE fires the write-back at depth 1 and the chain ends there (rfis.due_date is not in the mirror _upd trigger''s UPDATE OF list)'
UNION ALL
SELECT 'every_open_item_has_a_holder', count(*) = 0,
       'A(a): ball_in_court_id is NOT NULL on every non-terminal item; got ' || count(*)
  FROM live
 WHERE origin = 'mirror' AND status IN ('triage','open','answered') AND ball_in_court_id IS NULL
UNION ALL
SELECT 'events_written_but_no_bells',
       (SELECT count(*) FROM projects.work_item_events) > 0
   AND (SELECT count(*) FROM public.notifications
         WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
       '§12 §(d): events ARE written (the metrics need them); the bell half is VACUOUS until item 4 adds the emit and the esite.suppress_notifications guard to §11 (00196:1354-1356) — and none of those three types is in notifications_type_check yet either. Kept so the assertion is already in place'
UNION ALL
-- Section I. F11: `event` is a fixed CHECK vocabulary (00194:231-238) and
-- 'backfill_completed' is its arm for this.
SELECT 'completion_event_written',
       (SELECT count(*) FROM public.product_events
         WHERE event = 'backfill_completed'
           AND properties->>'migration' = 'work_item_source_mirrors_and_backfill'
           AND properties ? 'backfill_completed_at')
       = (SELECT count(DISTINCT p.organisation_id)
            FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
           WHERE w.origin = 'mirror')
       AND (SELECT count(*) FROM public.product_events WHERE event = 'backfill_completed') >= 1
       AND (SELECT count(DISTINCT properties->>'backfill_completed_at') FROM public.product_events
             WHERE event = 'backfill_completed') = 1
       AND (SELECT bool_and(actor_id IS NULL AND project_id IS NULL) FROM public.product_events
             WHERE event = 'backfill_completed'),
       'one org-level row per organisation touched (1 today — every backfilled item belongs to WM-Consulting), all carrying the SAME backfill_completed_at, actor NULL. Without it item 4''s first 07:00 recap lists all 35 backfilled items'
UNION ALL
-- #4: the backfill keeps history; §11 dates `created` at opened_at.
-- MAX, not the plan's MIN: with MIN a regression in ONE arm is invisible
-- behind the oldest item of another (the oldest inspection is 2026-05-21).
-- ⚠ The window below is a COARSE guard and it decays: raise one RFI in the 24h
-- before a rehearsal and it reds for a reason that has nothing to do with the
-- backfill. opened_at_matches_each_source is the exact, non-decaying half — it
-- compares every item to ITS OWN source row, so it is the one to read first.
SELECT 'opened_at_matches_each_source',
       NOT EXISTS (
         SELECT 1 FROM live w
          WHERE w.origin = 'mirror'
            AND w.opened_at IS DISTINCT FROM CASE
                  WHEN w.rfi_id        IS NOT NULL THEN (SELECT r.created_at FROM projects.rfis r WHERE r.id = w.rfi_id)
                  WHEN w.inspection_id IS NOT NULL THEN (SELECT i.created_at FROM inspections.inspections i WHERE i.id = w.inspection_id)
                  WHEN w.site_form_id  IS NOT NULL THEN (SELECT f.created_at FROM field.site_forms f WHERE f.id = w.site_form_id)
                  WHEN w.snag_id       IS NOT NULL THEN (SELECT sn.created_at FROM field.snags sn WHERE sn.id = w.snag_id)
                  WHEN w.qc_entry_id   IS NOT NULL THEN (SELECT GREATEST(e.created_at, COALESCE(rp.issued_at, e.created_at))
                                                           FROM projects.qc_entries e
                                                           JOIN projects.qc_reports rp ON rp.id = e.report_id
                                                          WHERE e.id = w.qc_entry_id)
                  ELSE w.opened_at END),
       'each backfilled item carries ITS OWN source''s created_at (qc: GREATEST(entry, issued_at)) — the exact form, unlike the 1-day window below, which decays as live data is raised'
UNION ALL
SELECT 'opened_at_is_historical',
       (SELECT max(opened_at) FROM live WHERE origin = 'mirror') < now() - interval '1 day',
       'every INSERT supplies opened_at = the source''s created_at (qc: GREATEST(entry, issued_at)) and §5 keeps it on the service path (00196:629-636); the NEWEST backfilled item must still predate the apply, or metric 5''s denominator gets 35 items in one week. Newest live source: an inspection of 2026-09-11'
UNION ALL
-- ⚠ Measured: this row pins ITEM 2's §11, not item 3's arms. Replacing D.1 and
-- D.3's opened_at with now() reds opened_at_is_historical and leaves this GREEN
-- — §11 dates the created event at NEW.opened_at whatever that value is, so the
-- two stay equal. It is kept because it is the other half of the invariant: if
-- item 4's CREATE OR REPLACE of append_work_item_event() ever dates `created`
-- at now(), the backfill's whole history lands in the apply week and only this
-- row says so.
SELECT 'created_event_dated_at_opened_at',
       NOT EXISTS (SELECT 1 FROM projects.work_item_events e JOIN live w ON w.id = e.work_item_id
                    WHERE w.origin = 'mirror' AND e.verb = 'created' AND e.created_at <> w.opened_at)
       AND (SELECT count(*) FROM projects.work_item_events e JOIN live w ON w.id = e.work_item_id
             WHERE w.origin = 'mirror' AND e.verb = 'created') = 35,
       '00196:1366-1376: the created event is dated at NEW.opened_at, so a historical opened_at dates the event historically — and there are exactly 35 of them, so the row cannot pass on an empty join'
UNION ALL
-- #10 (item 2's hand-off): §11 seeds created_by as a watcher on EVERY insert
-- regardless of membership, so a departed raiser becomes a non-member watcher
-- who can read the item through the SELECT policy's watcher arm.
-- ⚠ Measured 2026-09-15: every raiser / inspector / verifier / author behind
-- the 35 live items still holds an effective role, so the sweep deletes ZERO
-- live rows and this assertion is VACUOUS on live data alone. The fixture
-- file's snag is raised by an org contractor with no membership on its project
-- — that is the row that makes it real, so '_probe_snag_backfill' is included
-- here deliberately while every other '_probe_%' project stays out (Task 17
-- concatenates probes whose items are created AFTER the migration, which the
-- sweep cannot have seen).
SELECT 'no_non_member_watchers_on_mirrors',
       (SELECT count(*) FROM projects.work_item_watchers ww
          JOIN projects.work_items w ON w.id = ww.work_item_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE w.origin = 'mirror'
           AND (p.name NOT LIKE '\_probe\_%' OR p.name = '_probe_snag_backfill')
           AND public.user_effective_project_role(w.project_id, ww.user_id) IS NULL) = 0,
       'section H''s last statement removes watchers with no effective role on the project (backfill-only: a live-path raiser is a current member by construction)'
UNION ALL
-- Improvement 3: the distribution, not just the totals. This detail string is
-- the day-one list the owner reviews (Task 19).
SELECT 'at_least_three_distinct_holders',
       (SELECT count(*) FROM holders) >= 3,
       'holders: ' || COALESCE((SELECT string_agg(COALESCE(pr.full_name, h.uid::text) || '=' || h.n, ', ' ORDER BY h.n DESC)
                                  FROM holders h LEFT JOIN public.profiles pr ON pr.id = h.uid), '(none)')
UNION ALL
-- §15: an empty inbox cannot be driven to zero, and neither can a forty-item
-- one. Measured 2026-09-15 — the day-one list, which is Task 19's input:
--   Arno Mattheus 17 · johanb 6 · chris 5 · Admin Siyaya 1  (= 29; the other 6
--   are the closed RFIs, whose ball_in_court_id is NULL by A(a)).
-- The org owner's 17 is 9 open RFIs (all fifteen are unassigned, so each
-- resolves through the chain to its project's triage owner — the project's
-- creator) + 7 inspections + the 1 form. The plan's ceiling of 20 holds.
SELECT 'no_holder_over_twenty',
       COALESCE((SELECT max(n) FROM holders), 0) <= 20,
       'heaviest inbox on day one: ' || COALESCE((SELECT max(n)::text FROM holders), '0')
       || ' of ' || (SELECT count(*) FROM live WHERE origin = 'mirror')
       || ' items (17 measured 2026-09-15; a chain regression that hands one person everything reads 29)'
UNION ALL
SELECT 'no_item_on_a_client_viewer',
       (SELECT count(*) FROM live l
         WHERE l.origin = 'mirror' AND l.ball_in_court_id IS NOT NULL
           AND public.user_effective_project_role(l.project_id, l.ball_in_court_id) = 'client_viewer') = 0,
       'improvement 7: a client viewer cannot clear an item until Q3, so no backfilled item may land on one'
UNION ALL
-- ── The synthetic QC fixture (F4). Seeded by 13-backfill-fixtures.sql BEFORE
--    the migration, so the BACKFILL arm is what projects it. These rows read
--    projects.work_items directly: the fixture project IS a '_probe_%' project.
SELECT 'qc_fixture_projects_three',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance = 'fail') = 3,
       'three failures out of a 43-line issued report reach the spine (0 means the qc arm or the fixture stack order is wrong)'
UNION ALL
SELECT 'qc_fixture_ignores_forty',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance <> 'fail') = 0,
       'A(b): mirroring every issued entry would manufacture ~40 items from one report'
UNION ALL
SELECT 'qc_fixture_priority_spread',
       (SELECT count(DISTINCT w.priority) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance = 'fail') = 3,
       'severity maps to three distinct priorities (minor→low, major→high, critical→critical), never a flat medium'
UNION ALL
-- Deviation 18 (3): a defect is born at ISSUE, not pre-aged to its draft date.
-- The fixture's entries are 45 days old and the report was issued 30 days ago,
-- so GREATEST picks the issue and neither stamp alone would give that answer.
SELECT 'qc_fixture_is_born_at_issue',
       (SELECT count(*) = 3
           AND bool_and(w.opened_at = GREATEST(e.created_at, rep.issued_at))
           AND bool_and(w.opened_at > e.created_at)
           AND bool_and(w.opened_at < now() - interval '25 days')
          FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.qc_reports rep ON rep.id = e.report_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance = 'fail'),
       'opened_at = GREATEST(entry.created_at, report.issued_at): the backfill dates a defect at the issue of its report (entries drafted 45 d ago, report issued 30 d ago), not at the draft and not at the apply'
UNION ALL
-- ── The synthetic snag (improvement 2). The demo exclusion must exclude the
--    DEMO ORG, not disable the snag arm.
SELECT 'snag_arm_includes_non_demo_orgs',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_snag_backfill' AND w.item_type = 'snag' AND w.origin = 'mirror') = 1,
       'a snag on a NON-demo project IS backfilled — this is the assertion that stops improvement 2 being read as "snags are not mirrored"';
