-- 13-backfill-fixtures.sql — Task 14: the two synthetic sources the backfill's
-- zero-row arms need. This file is NOT a probe: it produces no rows and it is
-- stacked as a --with file AHEAD of the migration.
--
-- ⚠ ORDER IS THE WHOLE POINT, and it is why this is a separate file rather than
-- a DO block at the top of 13-backfill.sql as the plan text had it. The probe
-- runs AFTER the migration, so a fixture written there is inserted with the
-- mirror triggers already installed: the LIVE trigger projects it, the row
-- exists, and every assertion about it passes whatever the backfill arm does —
-- Step 7's mutation (the snag arm's predicate replaced by WHERE false) cannot
-- go red. Seeded here, before section D creates any trigger, the ONLY thing
-- that can project these rows is section H's backfill. ("What would this
-- fixture have to look like for the test to be able to fail?")
--
-- Run (both --with files, in this order, then the probe):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/13-backfill.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
--
-- Both projects are named '_probe_%' so probe 13's live counts exclude them
-- (and so Task 17's full rehearsal, which concatenates every probe into one
-- transaction, excludes them too). Everything is rolled back.
--
-- Fixtures RAISE rather than skip: a NOTICE never reaches the Management API
-- caller, and a skipped fixture is a probe that cannot fail.

-- ── The QC arm (F4) ──────────────────────────────────────────────────────────
-- Live data carries ZERO conformance='fail' rows (11 entries, all 'na', on one
-- issued report — re-measured 2026-09-15), so without this the qc_defect arm of
-- the backfill inserts nothing and every assertion about it passes vacuously.
--
-- The report is issued with a HISTORICAL issued_at and its entries carry an
-- even older created_at, so the born-at-issue rule (deviation 18 (3):
-- opened_at = GREATEST(entry.created_at, COALESCE(report.issued_at, …)))
-- decides a value that neither stamp alone would give — the probe asserts the
-- item is dated at the ISSUE, not at the draft. Forty passing entries sit
-- beside the three failures: A(b)'s scope predicate is what stops one 43-line
-- report manufacturing 43 inbox items.
DO $qcfix$
DECLARE
  v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm   uuid;
  v_proj uuid;
  v_rep  uuid;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-15)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_qc_backfill', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- report_no is filled by qc_reports_ensure_no_trg (00172:104).
  -- qc_reports_status_guard_trg is BEFORE UPDATE only, so a report born
  -- 'issued' is legal; qc_report_children_frozen returns early for a NULL
  -- auth.uid() and only ever raises for a CLOSED report.
  INSERT INTO projects.qc_reports (project_id, organisation_id, title, status,
                                   raised_by, issued_at, issued_by, created_at)
  VALUES (v_proj, v_org, 'Synthetic issued report', 'issued',
          v_pm, now() - interval '30 days', v_pm, now() - interval '45 days')
  RETURNING id INTO v_rep;

  -- Three failures, three DISTINCT severities: minor → low, major → high,
  -- critical → critical (D.4). A flat 'medium' on all three is the regression
  -- qc_fixture_priority_spread reads.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                   conformance, severity, created_by, created_at, updated_at)
  SELECT v_rep, v_org, v_proj, 'Defect ' || g, 'fail',
         (ARRAY['minor','major','critical'])[g], v_pm,
         now() - interval '45 days', now() - interval '45 days'
    FROM generate_series(1, 3) g;

  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                   conformance, created_by, created_at, updated_at)
  SELECT v_rep, v_org, v_proj, 'Passing check ' || g, 'pass', v_pm,
         now() - interval '45 days', now() - interval '45 days'
    FROM generate_series(1, 40) g;

  IF (SELECT count(*) FROM projects.qc_entries WHERE report_id = v_rep) <> 43 THEN
    RAISE EXCEPTION 'fixture: the synthetic report holds % entries, not 43',
      (SELECT count(*) FROM projects.qc_entries WHERE report_id = v_rep);
  END IF;
  IF EXISTS (SELECT 1 FROM projects.work_items WHERE project_id = v_proj) THEN
    RAISE EXCEPTION 'fixture: the qc fixture projected an item before the migration was stacked — this file is in the wrong --with order';
  END IF;
END $qcfix$;

-- ── The snag arm (improvement 2) ─────────────────────────────────────────────
-- All six live snags are E-Site DEMO fixtures and the arm excludes that org, so
-- the live count is zero. A zero is not evidence the arm works — it is exactly
-- as consistent with "the arm is dead". This snag sits on a NON-demo project,
-- so the demo exclusion is proved to INCLUDE as well as exclude: Step 7's
-- mutation (the arm's predicate → WHERE false) reds this one row while every
-- live count stays green, and Step 8's mutation (the demo predicate deleted)
-- reds the live counts while this one stays green. This is the assertion that
-- stops improvement 2 being read as "snags are not mirrored".
-- It also carries the DEPARTED-RAISER case (#10, item 2's hand-off), which
-- nothing on the live estate can express: §11 seeds created_by as a watcher on
-- every INSERT regardless of membership, so a raiser with no effective role on
-- the project becomes a non-member watcher who can read the item through the
-- SELECT policy's watcher arm. Measured 2026-09-15: EVERY raiser, inspector,
-- verifier and author behind the 35 backfilled items still holds an effective
-- role on their project, so section H's sweep deletes ZERO live rows and
-- no_non_member_watchers_on_mirrors is vacuous without this snag. So the snag
-- is raised by an org contractor who is NOT a member of this project — a
-- departed raiser, without touching one live membership row.
DO $snagfix$
DECLARE
  v_org    uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_pm     uuid;
  v_raiser uuid;
  v_proj   uuid;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_snag_backfill', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;

  -- An org-level contractor with no project_members row on THIS project:
  -- 00107 gives only owner/admin/project_manager an effective role from
  -- user_organisations alone, so this person's effective role here is NULL.
  SELECT u.user_id INTO v_raiser FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'contractor' AND u.is_active
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = u.user_id)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_raiser IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active contractor with a profile (12 contractors on 2026-09-15)';
  END IF;
  IF public.user_effective_project_role(v_proj, v_raiser) IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the raiser holds effective role % on the fixture project — the departed-raiser watcher row could not fail',
      public.user_effective_project_role(v_proj, v_raiser);
  END IF;

  -- category defaults to 'general' (00004); raised_by is NOT NULL. Left
  -- unassigned deliberately: the arm's job is to project it at all, and an
  -- unassigned snag is born triage on its raiser as the spine's default
  -- holder — except that this raiser is ineligible, so the chain answers.
  INSERT INTO field.snags (project_id, organisation_id, title, location, priority,
                           status, raised_by, created_at, updated_at)
  VALUES (v_proj, v_org, 'Real-org snag', 'Level 1', 'medium', 'open', v_raiser,
          now() - interval '12 days', now() - interval '12 days');

  IF EXISTS (SELECT 1 FROM projects.work_items WHERE project_id = v_proj) THEN
    RAISE EXCEPTION 'fixture: the snag fixture projected an item before the migration was stacked — this file is in the wrong --with order';
  END IF;
END $snagfix$;
