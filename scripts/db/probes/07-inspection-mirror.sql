-- 07-inspection-mirror.sql — Task 8: the inspection projection (00198 section
-- D.3, the second copy of D.1's template). Asserted against production inside
-- one rolled-back transaction:
--   projects.project_inspection(uuid)        — the projection body (no recursion guard)
--   projects.mirror_inspection_work_item()   — the trigger wrapper (depth guard, F2)
--   inspections_mirror_work_item_ins / _upd  — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
-- There is NO write-back arm for inspections (section E, §03 §1.2): the
-- inspections module stays the system of record for assigned_to_id and
-- verifier_id, and this probe asserts the source is never written
-- (no_writeback_to_source) — but both columns are READ FORWARD on every
-- projection of a live item (forward_reassignment_moves_the_ball,
-- verifier_change_moves_the_gatekeeper), and so is scheduled_at (Task 8
-- review I1: source_reschedule_moves_the_spine_due). The honest consequence
-- is pinned too: a SPINE-side reassignment or gatekeeper correction on an
-- inspection item is transient — the next watched source write of any kind
-- reverts it (spine_reassignment_is_reverted_by_the_next_source_write,
-- spine_gatekeeper_correction_is_reverted_by_the_next_source_write). A
-- CLOSED item's people and due date are part of the record and never
-- re-derived (closed_item_people_are_not_reprojected, Task 8 review S1).
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/07-inspection-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section D.3 existed this reported 0/29: no trigger fires, no
-- inspection projects anything, every recorded observation is NULL (a NULL
-- `ok` is a FAIL in the harness, never a coerced false). no_writeback_to_source
-- and closed_clears_bic are deliberately NOT vacuous — each requires the item
-- to exist, so both are red until D.3 exists (the first is red again if a
-- write-back arm ever appears).
--
-- Walks from an empty project, never from seeded data (§12 §(h)). Every
-- fixture RAISEs rather than skips: a NOTICE never reaches the Management API
-- caller, and a skipped fixture is a probe that cannot fail.
--
-- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
-- in a FROM clause (42601), and sibling parts of one statement read the
-- pre-update snapshot — so an assertion that "the status changed" written as a
-- subquery beside the UPDATE can never be true.
--
-- ⚠ This probe runs as postgres with auth.uid() NULL (F9) — the guard's
-- service path. Under section C''s replacement guard the mirror's UPDATEs run
-- at depth 2 and are exempt whatever the actor; the signed-in evidence for the
-- exemption is probe 05b (Task 5½). What the exempt path DOES on a close is
-- pinned here: it stamps closed_at = now() and keeps the supplied closed_by
-- (certified_carries_stamps), so "closed_at = certified_at" is only ever true
-- on the INSERT path, where no guard runs (born_certified_carries_source_stamps).
-- The exempt path does NOT run the guard's void-reason check either — a
-- reason-less void would be refused only on the next signed-in UPDATE — so
-- abandoned_without_a_reason_gets_the_default measures the projection, not
-- the guard.
--
-- inspections.inspections carries no sequence, so nothing here outlives the
-- rollback. work_items.ref is a per-project counter. inspections.templates is
-- read (a fixture template must exist; 39 WM templates on 2026-09-13), never
-- written.
--
-- Measured on production 2026-09-13 (the plan's 2026-09-10 numbers in
-- brackets): 19 [18] inspections, ALL status = 'assigned', ALL with an
-- assigned_to_id AND a verifier_id (8 self-verified), 16 [15] with a
-- scheduled_at and ALL 16 of those in the past (SAST day), 4 with a
-- target_location, 0 in the demo org, 0 referencing a missing profile.
--
-- The SAST fixture (due_from_scheduled_uses_sast_day): scheduled_at is set to
-- 23:30 UTC on a day ten days out, which is 01:30 SAST on the FOLLOWING day.
-- The projection must hand work_item_mirror_due_date() the SAST date, so the
-- item is due on day +11; a `scheduled_at::date` (session UTC) projection
-- says day +10 and goes red. Ten days out is outside the builders' shutdown
-- band (12-15..01-15, builders_holiday defaults true) — asserted by the
-- fixture, since §5 pushes a supplied date that lands in the band and both
-- dates would then collapse onto one band end.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation.
--
-- Expected: 39 rows. If the printed `assertions seen:` list is shorter than
-- thirty-nine names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project (⇒ triage_owner_id), is the explicit assignee
  v_v     uuid;   -- an org admin: the verifier — the GATEKEEPER, distinct from the PM chain's answer
  v_chain_pm uuid;   -- resolve_project_pm(v_proj): the oldest active org admin — where an ineligible/absent verifier falls
  v_admin2   uuid;   -- arm 2 (work_item_defaults.inspection.triage_owner_id): distinct from every other arm's answer; later the replacement verifier
  v_third    uuid;   -- a contractor with a project_members row: the forward-reassignment target
  v_cv       uuid;   -- an active WM client viewer: never eligible on the probe project (F2)
  v_proj  uuid;
  v_tpl   uuid;
  v_triage_owner uuid;
  v_arm2_readback uuid;
  v_insp     uuid;   -- assigned to the owner, verified by v_v, a location, no scheduled_at: the live shape minus the past date
  v_nowhere  uuid;   -- whitespace-only location
  v_past     uuid;   -- scheduled 30 days ago: 16 of 19 live inspections
  v_sast     uuid;   -- scheduled at 23:30 UTC = 01:30 SAST next day
  v_arm2     uuid;   -- assigned_to_id NULL, verifier_id NULL: the chain answers arm 2, the PM chain answers the gate
  v_cvi      uuid;   -- assigned_to_id = the client viewer, verifier_id = the client viewer: both ineligible
  v_aband    uuid;   -- born abandoned with a reason: the backfill shape for a void
  v_live_ab  uuid;   -- abandoned on the live path with NO reason, then "revived"
  v_born     uuid;   -- born certified with historical stamps: the backfill shape for a close
  -- The SAST fixture day. now() is fixed for the whole transaction.
  v_utc_day  date := (now() AT TIME ZONE 'UTC')::date + 10;
  v_sast_sched timestamptz;
  -- now() is fixed for the whole transaction, so these are exact targets.
  v_hist_created   timestamptz := now() - interval '40 days';
  v_hist_certified timestamptz := now() - interval '20 days';
  v_ins      record;
  v_past_due date;
  v_sast_due date;
  -- What §5 computes for an inspection born with no usable date: A(b)'s +3
  -- site working days from the SAST day (00196:670), then the builders'
  -- shutdown push — the exact born date, not merely "after today".
  v_default_due date;
  v_arm2_item record;
  v_arm2_src  uuid;
  v_cvi_item  record;
  v_cvi_src   uuid;
  v_re        record;
  v_cvre      record;
  v_aw        record;
  v_vch       record;
  v_cert      record;
  v_ab        record;
  v_liveab    record;
  v_revive    record;
  v_bornrec   record;
  v_same_last_activity timestamptz;
  -- Task 8 review: a re-schedule 40 days out, band-guarded on its SAST day.
  v_resched_at    timestamptz := now() + interval '40 days';
  v_closed_people record;   -- the certified item after a post-close reassign + verifier change + reschedule (S1)
  v_spine_due     date;     -- a SPINE-side due edit on the open item, before the reschedule (Task 9 review S2)
  v_live_resched  record;   -- the open item after a future reschedule (I1)
  v_live_past     record;   -- …then after a reschedule into the past
  v_rt_before     record;   -- the open item after the SPINE's reassign + gatekeeper correction
  v_rt_after      record;   -- …after an unrelated watched source write (the honest rows)
  v_admin3        uuid;     -- arm 2 on the THIRD project: distinct from admin2, the verifier and the owner, so a live move must re-run the chain to be seen
  v_proj3         uuid;     -- the live-move target (a moved item keeps its ref; two moves into one project collide on work_items_ref_unique)
  v_livemv        record;   -- the client-named board's item after its move
  -- Task 10 review, rules 1 and 2 (via Task 13).
  v_hist_abandoned timestamptz := now() - interval '2 days';   -- the born-abandoned fixture's stamps; its last_activity_at on the INSERT path
  v_cl_ctid_before text;    -- the born-certified record's tuple identity before an unrelated watched edit (rule 1)
  v_cl_restamp     record;  -- …and after an assigned_to_id change on the certified source
  v_vd_ctid_before text;    -- the born-abandoned (void) record's tuple identity before a label edit (rule 1, the void tightening)
  v_vd_rename      record;  -- …after that label edit: title frozen, tuple untouched
  v_vd_reason      record;  -- after an abandoned_reason edit on the void row: the source's words reach the record
  v_vd_revive      record;  -- after a label edit COMBINED with a revival (the arm runs): title frozen (rule 2)
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  SELECT t.id INTO v_tpl FROM inspections.templates t
   WHERE t.organisation_id = v_org AND t.is_active
   ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active inspections.templates row (39 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_inspection_mirror', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- The PM chain: no project PM, no org PM, so the oldest active org admin.
  -- Never the owner, so arm 3 (the triage owner = the owner) and arm 4 of the
  -- assignee chain answer DIFFERENT people.
  v_chain_pm := projects.resolve_project_pm(v_proj);
  IF v_chain_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: the probe project resolves no PM — WM-Consulting has lost its owner/admins';
  END IF;
  IF v_chain_pm = v_pm THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the owner (%), who is also the triage owner — arm 3 and arm 4 would answer alike', v_pm;
  END IF;
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded triage_owner_id = % (expected created_by = the owner %)', v_triage_owner, v_pm;
  END IF;

  -- The verifier: an org admin distinct from the owner AND from the PM chain's
  -- answer, so gatekeeper_is_verifier measures the verifier arm, not a
  -- coincidence with the PM fallback — under a PM-only mutation the two must
  -- differ for the row to go red.
  SELECT u.user_id INTO v_v FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_v IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active admin besides the PM-chain person (11 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_v) THEN
    RAISE EXCEPTION 'fixture: the verifier (%) is not eligible on the probe project', v_v;
  END IF;

  -- Arm 2 of the mirror chain, work_item_defaults.inspection.triage_owner_id: a
  -- third admin, distinct from the owner (arm 3), the PM-chain person (arm 4)
  -- and the verifier, so the 'inspection' literal project_inspection passes is
  -- load-bearing — a typo ('inspectoin') skips this arm and falls to the owner.
  -- Set BEFORE the first inspection so assignee_seeds_from_source also proves
  -- the explicit assignee precedes this arm.
  SELECT u.user_id INTO v_admin2 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_v)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin2 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin (11 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin2) THEN
    RAISE EXCEPTION 'fixture: the second admin (%) is not eligible on the probe project', v_admin2;
  END IF;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('inspection', jsonb_build_object('triage_owner_id', v_admin2::text))
   WHERE project_id = v_proj;
  -- §13's validator NULLs an id with no effective role on the project; an org
  -- admin always has one (00107), but read it back rather than assume.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY['inspection', 'triage_owner_id'], '')::uuid INTO v_arm2_readback
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_arm2_readback IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: validate_work_item_defaults did not keep work_item_defaults.inspection.triage_owner_id = % (read back %)', v_admin2, v_arm2_readback;
  END IF;
  -- With no usable explicit candidate the chain must answer arm 2 — asserted so
  -- the arm-2 rows below measure project_inspection's literal, not section B.
  IF projects.resolve_mirror_assignee(v_proj, 'inspection', NULL) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''inspection'', NULL) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'inspection', NULL), v_admin2;
  END IF;

  -- The forward-reassignment target: a contractor, made eligible by a
  -- project_members row (an org-level contractor has NO effective role on a
  -- project they are not a member of, 00107). Distinct from every admin above
  -- by role, so forward_reassignment_moves_the_ball cannot pass on a coincidence.
  SELECT u.user_id INTO v_third FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'contractor' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_v, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_third IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active contractor in user_organisations (12 on 2026-09-13)';
  END IF;
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_third, v_org, 'contractor', true);
  IF NOT projects.work_item_person_eligible(v_proj, v_third) THEN
    RAISE EXCEPTION 'fixture: the contractor (%) is not eligible on the probe project after the membership row', v_third;
  END IF;

  -- F2: an active WM client viewer — ineligible on the probe project whatever
  -- their membership (client_viewer is excluded by the mirror's chain).
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_v, v_admin2, v_third)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- The SAST fixture day must sit outside the builders' shutdown band on both
  -- readings (UTC day and SAST day), or §5's push collapses them onto one date
  -- and the UTC mutation cannot go red.
  v_sast_sched := (v_utc_day::timestamp + time '23:30') AT TIME ZONE 'UTC';
  IF projects.push_past_builders_shutdown(v_utc_day, v_proj) <> v_utc_day
     OR projects.push_past_builders_shutdown(v_utc_day + 1, v_proj) <> v_utc_day + 1 THEN
    RAISE EXCEPTION 'fixture: the SAST fixture day % / % falls in the builders'' shutdown band; pick another offset', v_utc_day, v_utc_day + 1;
  END IF;
  IF (v_sast_sched AT TIME ZONE 'Africa/Johannesburg')::date <> v_utc_day + 1
     OR (v_sast_sched AT TIME ZONE 'UTC')::date <> v_utc_day THEN
    RAISE EXCEPTION 'fixture: the SAST fixture % does not straddle midnight (SAST day %, UTC day %)',
      v_sast_sched, (v_sast_sched AT TIME ZONE 'Africa/Johannesburg')::date, (v_sast_sched AT TIME ZONE 'UTC')::date;
  END IF;
  -- The reschedule day must sit outside the band too, or the push moves it
  -- and source_reschedule_moves_the_spine_due compares against the wrong day.
  IF projects.push_past_builders_shutdown((v_resched_at AT TIME ZONE 'Africa/Johannesburg')::date, v_proj)
     <> (v_resched_at AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: the reschedule day % falls in the builders'' shutdown band; pick another offset',
      (v_resched_at AT TIME ZONE 'Africa/Johannesburg')::date;
  END IF;

  -- The registry's default for 'inspection' is 3 site working days (00196:242);
  -- the probe project carries no days_to_respond override (fresh settings row).
  v_default_due := projects.push_past_builders_shutdown(
    projects.add_working_days((now() AT TIME ZONE 'Africa/Johannesburg')::date, 3, v_proj, 'site'),
    v_proj);
  IF v_default_due IS NULL OR v_default_due <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: add_working_days(SAST today, 3, proj, site) answered % — the site calendar is not usable', v_default_due;
  END IF;

  -- Shaped like a live row minus the past date: assigned, verified, a location.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, target_location, assigned_to_id, verifier_id,
    status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Probe board', 'Level 2 — Riser',
          v_pm, v_v, 'assigned', v_pm)
  RETURNING id INTO v_insp;
  SELECT w.item_type, w.title, w.status, w.source_status, w.assignee_id, w.gatekeeper_id,
         w.ball_in_court_id, w.due_date
    INTO v_ins FROM projects.work_items w WHERE w.inspection_id = v_insp AND w.origin = 'mirror';

  -- A whitespace-only location must not gain a dangling em-dash.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, target_location, assigned_to_id, verifier_id,
    status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'No location board', '   ', v_pm, v_v, 'assigned', v_pm)
  RETURNING id INTO v_nowhere;

  -- 16 of 19 live inspections are scheduled in the past.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    scheduled_at, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Past board', v_pm, v_v, 'assigned',
          now() - interval '30 days', v_pm)
  RETURNING id INTO v_past;
  SELECT w.due_date INTO v_past_due FROM projects.work_items w WHERE w.inspection_id = v_past;

  -- 23:30 UTC = 01:30 SAST the next day: a future date on both readings, but a
  -- DIFFERENT date on each.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    scheduled_at, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Late-night board', v_pm, v_v, 'assigned',
          v_sast_sched, v_pm)
  RETURNING id INTO v_sast;
  SELECT w.due_date INTO v_sast_due FROM projects.work_items w WHERE w.inspection_id = v_sast;

  -- Nobody named at all (assigned_to_id and verifier_id both NULL; 0 of 19
  -- live rows, but the CHECK admits it): the chain answers arm 2, the PM
  -- chain answers the gate, and the item is born TRIAGE.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Unowned board', 'assigned', v_pm)
  RETURNING id INTO v_arm2;
  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id INTO v_arm2_item
    FROM projects.work_items w WHERE w.inspection_id = v_arm2 AND w.origin = 'mirror';
  -- No write-back: the source's assigned_to_id must still be NULL.
  SELECT i.assigned_to_id INTO v_arm2_src FROM inspections.inspections i WHERE i.id = v_arm2;

  -- Both people named but ineligible (a client viewer, F2 / improvement 7).
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Client-named board', v_cv, v_cv, 'assigned', v_pm)
  RETURNING id INTO v_cvi;
  SELECT w.status, w.assignee_id, w.gatekeeper_id INTO v_cvi_item
    FROM projects.work_items w WHERE w.inspection_id = v_cvi AND w.origin = 'mirror';
  SELECT i.assigned_to_id INTO v_cvi_src FROM inspections.inspections i WHERE i.id = v_cvi;

  -- Forward assignment: reassignment inside the inspections module reaches the
  -- spine — an ELIGIBLE new assignee moves assignee_id and the ball.
  UPDATE inspections.inspections SET assigned_to_id = v_third WHERE id = v_insp;
  SELECT w.status, w.assignee_id, w.ball_in_court_id INTO v_re
    FROM projects.work_items w WHERE w.inspection_id = v_insp;

  -- …but an INELIGIBLE one (a client viewer) leaves the spine's holder alone
  -- (improvement 7). The source now names the client viewer and the item does
  -- not — which is also what no_writeback_to_source measures.
  UPDATE inspections.inspections SET assigned_to_id = v_cv WHERE id = v_insp;
  SELECT w.status, w.assignee_id INTO v_cvre
    FROM projects.work_items w WHERE w.inspection_id = v_insp;

  -- Push-back from the source (service path — the guard is exempt as postgres
  -- AND at depth 2; probe 05b is the signed-in evidence).
  UPDATE inspections.inspections SET status = 'awaiting_verification', completed_at = now()
   WHERE id = v_insp;
  SELECT w.status, w.ball_in_court_id INTO v_aw
    FROM projects.work_items w WHERE w.inspection_id = v_insp;

  -- The verifier is changed on the source while the item is answered: the
  -- gatekeeper (and therefore the ball) must follow — the module owns
  -- verifier_id and A(b)'s rule is verifier_else_pm, re-evaluated on every
  -- projection.
  UPDATE inspections.inspections SET verifier_id = v_admin2 WHERE id = v_insp;
  SELECT w.status, w.gatekeeper_id, w.ball_in_court_id INTO v_vch
    FROM projects.work_items w WHERE w.inspection_id = v_insp;

  -- Certification, with certified_at deliberately an hour OLD: the exempt
  -- guard stamps closed_at = now() on the transition and keeps closed_by, so
  -- the item's closed_at is the transition moment, not the source's stamp.
  UPDATE inspections.inspections
     SET status = 'certified', certified_at = now() - interval '1 hour'
   WHERE id = v_insp;
  SELECT w.status, w.ball_in_court_id, w.closed_at, w.closed_by INTO v_cert
    FROM projects.work_items w WHERE w.inspection_id = v_insp;

  -- A BORN-ABANDONED source with the module's reason column
  -- (abandoned_reason, 00072 — the one abandonInspectionAction writes; 00066's
  -- abandon_reason is read as a fallback and never written by the app). With
  -- HISTORICAL stamps (created_at / updated_at), so the void record's
  -- last_activity_at has a value a re-projection would visibly disturb.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    abandoned_at, abandoned_by, abandoned_reason, created_at, updated_at, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Abandoned board', v_pm, v_v, 'abandoned',
          v_hist_abandoned, v_pm, '  Site closed for the season  ', v_hist_created, v_hist_abandoned, v_pm)
  RETURNING id INTO v_aband;
  SELECT w.status, w.void_reason, w.ball_in_court_id INTO v_ab
    FROM projects.work_items w WHERE w.inspection_id = v_aband AND w.origin = 'mirror';

  -- Task 10 review, rules 1 and 2 (via Task 13), on that VOID record.
  -- (1) A label edit alone: watched, so the _upd trigger fires, but a void
  -- row's title is frozen (rule 2) and never compared by rule 1's early return
  -- (the Task 11 review's I2 tightening), so nothing projected changes and the
  -- tuple is left alone — by ctid and by the historical last_activity_at.
  -- (2) An abandoned_reason edit while still abandoned DOES project — on a void
  -- mapping the source's words win — so the early return must compare the
  -- projected void_reason and not swallow it. (3) A label edit COMBINED with a
  -- revival (abandoned → re-inspect_required maps to open): source_status
  -- differs, so the arm RUNS — void is terminal, the reason is kept, and the
  -- title stays what the record was withdrawn with.
  SELECT w.ctid::text INTO v_vd_ctid_before
    FROM projects.work_items w WHERE w.inspection_id = v_aband AND w.origin = 'mirror';
  UPDATE inspections.inspections SET target_label = 'Abandoned board (renamed)' WHERE id = v_aband;
  SELECT w.ctid::text AS ctid_after, w.title, w.status, w.last_activity_at INTO v_vd_rename
    FROM projects.work_items w WHERE w.inspection_id = v_aband AND w.origin = 'mirror';
  UPDATE inspections.inspections SET abandoned_reason = 'Site closed — season over' WHERE id = v_aband;
  SELECT w.status, w.void_reason, w.title INTO v_vd_reason
    FROM projects.work_items w WHERE w.inspection_id = v_aband AND w.origin = 'mirror';
  UPDATE inspections.inspections
     SET target_label = 'Abandoned board (revived)', status = 're-inspect_required'
   WHERE id = v_aband;
  SELECT w.title, w.status, w.source_status, w.void_reason INTO v_vd_revive
    FROM projects.work_items w WHERE w.inspection_id = v_aband AND w.origin = 'mirror';

  -- Abandoned on the LIVE path with no reason at all (the CHECK admits it;
  -- abandonInspectionAction always supplies one): the projection must invent
  -- the fallback reason, or the row is a void with no reason that the guard
  -- refuses on the next signed-in UPDATE ("Dropping … needs a short reason").
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Dropped board', v_pm, v_v, 'assigned', v_pm)
  RETURNING id INTO v_live_ab;
  UPDATE inspections.inspections SET status = 'abandoned' WHERE id = v_live_ab;
  SELECT w.status, w.void_reason INTO v_liveab
    FROM projects.work_items w WHERE w.inspection_id = v_live_ab;

  -- void is terminal (reconciliation #3): a source "revived" out of abandoned
  -- (abandoned → re-inspect_required maps to open; nothing on the table
  -- forbids the transition) must not un-void the item or blank its reason.
  UPDATE inspections.inspections SET status = 're-inspect_required' WHERE id = v_live_ab;
  SELECT w.status, w.void_reason, w.source_status INTO v_revive
    FROM projects.work_items w WHERE w.inspection_id = v_live_ab;

  -- A BORN-CERTIFIED source with historical stamps — the backfill shape (#4;
  -- none live today, 0 of 19 are certified). No guard runs on INSERT and §5
  -- keeps a supplied opened_at on the service path, so what the projection
  -- supplies is what the row carries. updated_at is set explicitly so
  -- last_activity_at has a value a re-projection would visibly disturb.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    completed_at, certified_at, created_at, updated_at, created_by)
  VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Born-certified board', v_pm, v_v, 'certified',
          v_hist_certified - interval '1 day', v_hist_certified, v_hist_created, v_hist_certified, v_pm)
  RETURNING id INTO v_born;
  SELECT w.status, w.opened_at, w.closed_at, w.closed_by, w.due_date INTO v_bornrec
    FROM projects.work_items w WHERE w.inspection_id = v_born AND w.origin = 'mirror';

  -- A full-row save that changes only reinspection_notes: every watched column
  -- is in the SET list with its old value. The _upd trigger's column list
  -- admits it; only the WHEN clause stops it firing. If it fired, the UPDATE
  -- arm would stamp last_activity_at = now() over the historical value.
  UPDATE inspections.inspections
     SET reinspection_notes = 'edited',
         target_label = target_label, target_location = target_location,
         status = status, assigned_to_id = assigned_to_id, verifier_id = verifier_id,
         certified_at = certified_at, abandoned_reason = abandoned_reason,
         abandon_reason = abandon_reason
   WHERE id = v_born;
  SELECT w.last_activity_at INTO v_same_last_activity
    FROM projects.work_items w WHERE w.inspection_id = v_born AND w.origin = 'mirror';

  -- Task 10 review, rule 1 (via Task 13): an assigned_to_id change on the
  -- CERTIFIED source — watched, so the _upd trigger fires — changes nothing
  -- the closed record projects (its people are kept, S1 below), so the UPDATE
  -- arm must return early and leave the tuple alone: same ctid, and the
  -- historical last_activity_at the INSERT path kept instead of now(). admin2
  -- is eligible and different from what the item holds (the owner): without
  -- S1's rule the forward read would move assignee_id, and without rule 1 the
  -- tuple was rewritten even though nothing on it changed.
  SELECT w.ctid::text INTO v_cl_ctid_before
    FROM projects.work_items w WHERE w.inspection_id = v_born AND w.origin = 'mirror';
  UPDATE inspections.inspections SET assigned_to_id = v_admin2 WHERE id = v_born;
  SELECT w.ctid::text AS ctid_after, w.last_activity_at, w.assignee_id, w.status INTO v_cl_restamp
    FROM projects.work_items w WHERE w.inspection_id = v_born AND w.origin = 'mirror';

  -- Task 8 review S1: a CLOSED item's people and due date are part of the
  -- record. Reassign, change the verifier AND reschedule the certified source
  -- in one statement — every one is watched and every name is eligible, so
  -- without the rule the forward read would move all three.
  UPDATE inspections.inspections
     SET assigned_to_id = v_third, verifier_id = v_admin2, scheduled_at = v_resched_at
   WHERE id = v_born;
  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.due_date INTO v_closed_people
    FROM projects.work_items w WHERE w.inspection_id = v_born AND w.origin = 'mirror';

  -- Task 9 review S2: a SPINE-side due edit first (service path — the guard
  -- is exempt as postgres; a PM's edit through the action is the same
  -- UPDATE), so the reschedule below measurably REVERTS it rather than
  -- merely setting a date. Ten days short of the reschedule day: distinct
  -- from it and from the born default.
  UPDATE projects.work_items
     SET due_date = (v_resched_at AT TIME ZONE 'Africa/Johannesburg')::date - 10
   WHERE inspection_id = v_nowhere AND origin = 'mirror';
  SELECT w.due_date INTO v_spine_due
    FROM projects.work_items w WHERE w.inspection_id = v_nowhere AND w.origin = 'mirror';

  -- Task 8 review I1: a source RE-SCHEDULE on a LIVE item reaches the spine.
  -- There is no write-back in either direction for inspections, so the
  -- module's date must be read forward or the spine sits on the birth date
  -- forever. Future → the SAST day (pushed past the band — identity here by
  -- fixture); past → the floor hands NULL and the item keeps its current due.
  UPDATE inspections.inspections SET scheduled_at = v_resched_at WHERE id = v_nowhere;
  SELECT w.due_date, w.status INTO v_live_resched
    FROM projects.work_items w WHERE w.inspection_id = v_nowhere AND w.origin = 'mirror';
  UPDATE inspections.inspections SET scheduled_at = now() - interval '3 days' WHERE id = v_nowhere;
  SELECT w.due_date INTO v_live_past
    FROM projects.work_items w WHERE w.inspection_id = v_nowhere AND w.origin = 'mirror';

  -- The honest rows (Task 8 review, controller decision): a SPINE-side
  -- reassignment and gatekeeper correction on a live inspection item are
  -- TRANSIENT. Service path here (the guard is exempt as postgres); then an
  -- unrelated watched source write (the title) re-projects, and the forward
  -- read puts both people back to the source's columns.
  UPDATE projects.work_items SET assignee_id = v_admin2, gatekeeper_id = v_admin2
   WHERE inspection_id = v_sast AND origin = 'mirror';
  SELECT w.assignee_id, w.gatekeeper_id INTO v_rt_before
    FROM projects.work_items w WHERE w.inspection_id = v_sast AND w.origin = 'mirror';
  UPDATE inspections.inspections SET target_label = 'Late-night board (renamed)' WHERE id = v_sast;
  SELECT w.assignee_id, w.gatekeeper_id INTO v_rt_after
    FROM projects.work_items w WHERE w.inspection_id = v_sast AND w.origin = 'mirror';

  -- ── Task 9 review I1 (via Task 12): a LIVE move re-runs the chain ─────────
  -- A THIRD project whose arm 2 (work_item_defaults.inspection.triage_owner_id)
  -- names a THIRD admin — distinct from the first project's arm 2 (admin2),
  -- the verifier and the owner (arm 3) — so the move arm's resolver call and
  -- its 'inspection' literal are both load-bearing: a typo key falls to the
  -- owner, a dropped `ELSIF v_moved` arm keeps admin2. The client-named
  -- board (both people ineligible: triage on admin2, gatekeeper the PM
  -- chain) moves there — a board whose inspector is eligible would resolve
  -- to the inspector on the new project too (arm 1) and the row could not
  -- see the literal. A fresh third project: a moved item keeps its ref and
  -- the allocator numbers per project (deviation 20).
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_v, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no fourth active admin besides the PM-chain person, the verifier and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_inspection_mirror_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('inspection', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'inspection', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'inspection', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'inspectoin', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  UPDATE inspections.inspections SET project_id = v_proj3 WHERE id = v_cvi;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.inspection_id = v_cvi AND w.origin = 'mirror';

  CREATE TEMP TABLE in_ctx(
    insp uuid, nowhere uuid, past uuid, sast uuid, arm2 uuid, cvi uuid, aband uuid,
    live_ab uuid, born uuid, proj uuid,
    pm uuid, verifier uuid, chain_pm uuid, admin2 uuid, third uuid, cv uuid,
    utc_day date, default_due date,
    ins_type text, ins_title text, ins_status text, ins_source_status text,
    ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
    past_due date, sast_due date,
    arm2_status text, arm2_assignee uuid, arm2_gate uuid, arm2_bic uuid, arm2_src uuid,
    cvi_status text, cvi_assignee uuid, cvi_gate uuid, cvi_src uuid,
    re_status text, re_assignee uuid, re_bic uuid,
    cvre_status text, cvre_assignee uuid,
    aw_status text, aw_bic uuid,
    vch_status text, vch_gate uuid, vch_bic uuid,
    cert_status text, cert_bic uuid, cert_closed timestamptz, cert_closed_by uuid,
    ab_status text, ab_reason text, ab_bic uuid,
    liveab_status text, liveab_reason text,
    revive_status text, revive_reason text, revive_source_status text,
    born_status text, born_opened_at timestamptz, born_closed_at timestamptz,
    born_closed_by uuid, born_due date,
    hist_created timestamptz, hist_certified timestamptz,
    same_last_activity timestamptz,
    resched_day date,
    closed_people_status text, closed_people_assignee uuid, closed_people_gate uuid, closed_people_due date,
    spine_due date,
    live_resched_due date, live_resched_status text, live_past_due date,
    rt_before_assignee uuid, rt_before_gate uuid, rt_after_assignee uuid, rt_after_gate uuid,
    proj3 uuid, admin3 uuid,
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid,
    hist_abandoned timestamptz,
    cl_ctid_before text, cl_ctid_after text, cl_restamp_last_activity timestamptz,
    cl_restamp_assignee uuid, cl_restamp_status text,
    vd_ctid_before text, vd_ctid_after text, vd_rename_title text, vd_rename_status text,
    vd_rename_last_activity timestamptz,
    vd_reason_status text, vd_reason_reason text, vd_reason_title text,
    vd_revive_title text, vd_revive_status text, vd_revive_source_status text, vd_revive_reason text)
    ON COMMIT DROP;
  INSERT INTO in_ctx VALUES (
    v_insp, v_nowhere, v_past, v_sast, v_arm2, v_cvi, v_aband,
    v_live_ab, v_born, v_proj,
    v_pm, v_v, v_chain_pm, v_admin2, v_third, v_cv,
    v_utc_day, v_default_due,
    v_ins.item_type, v_ins.title, v_ins.status, v_ins.source_status,
    v_ins.assignee_id, v_ins.gatekeeper_id, v_ins.ball_in_court_id, v_ins.due_date,
    v_past_due, v_sast_due,
    v_arm2_item.status, v_arm2_item.assignee_id, v_arm2_item.gatekeeper_id, v_arm2_item.ball_in_court_id, v_arm2_src,
    v_cvi_item.status, v_cvi_item.assignee_id, v_cvi_item.gatekeeper_id, v_cvi_src,
    v_re.status, v_re.assignee_id, v_re.ball_in_court_id,
    v_cvre.status, v_cvre.assignee_id,
    v_aw.status, v_aw.ball_in_court_id,
    v_vch.status, v_vch.gatekeeper_id, v_vch.ball_in_court_id,
    v_cert.status, v_cert.ball_in_court_id, v_cert.closed_at, v_cert.closed_by,
    v_ab.status, v_ab.void_reason, v_ab.ball_in_court_id,
    v_liveab.status, v_liveab.void_reason,
    v_revive.status, v_revive.void_reason, v_revive.source_status,
    v_bornrec.status, v_bornrec.opened_at, v_bornrec.closed_at,
    v_bornrec.closed_by, v_bornrec.due_date,
    v_hist_created, v_hist_certified,
    v_same_last_activity,
    (v_resched_at AT TIME ZONE 'Africa/Johannesburg')::date,
    v_closed_people.status, v_closed_people.assignee_id, v_closed_people.gatekeeper_id, v_closed_people.due_date,
    v_spine_due,
    v_live_resched.due_date, v_live_resched.status, v_live_past.due_date,
    v_rt_before.assignee_id, v_rt_before.gatekeeper_id, v_rt_after.assignee_id, v_rt_after.gatekeeper_id,
    v_proj3, v_admin3,
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id,
    v_hist_abandoned,
    v_cl_ctid_before, v_cl_restamp.ctid_after, v_cl_restamp.last_activity_at,
    v_cl_restamp.assignee_id, v_cl_restamp.status,
    v_vd_ctid_before, v_vd_rename.ctid_after, v_vd_rename.title, v_vd_rename.status,
    v_vd_rename.last_activity_at,
    v_vd_reason.status, v_vd_reason.void_reason, v_vd_reason.title,
    v_vd_revive.title, v_vd_revive.status, v_vd_revive.source_status, v_vd_revive.void_reason);
END $probe$;

SELECT 'insp_item_created' AS probe,
       (SELECT count(*) FROM projects.work_items w, in_ctx c
         WHERE w.inspection_id = c.insp AND w.origin = 'mirror') = 1 AS ok,
       'one mirror item per inspection — still one after five re-projections (the explicit partial-index ON CONFLICT target, F6)' AS detail
UNION ALL
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'inspection')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'inspection')
              FROM in_ctx c),
       'the literal ''inspection'' in project_inspection() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL
SELECT 'title_names_the_place',
       (SELECT c.ins_title = 'Probe board — Level 2 — Riser' FROM in_ctx c),
       'target_location is the only locator an inspection has (4 of 19 live rows carry one); the title is what reaches the recap'
UNION ALL
SELECT 'blank_location_adds_no_dash',
       (SELECT w.title FROM projects.work_items w, in_ctx c WHERE w.inspection_id = c.nowhere)
         = 'No location board',
       'a whitespace-only target_location must not produce a trailing em-dash'
UNION ALL
-- A(b): the explicit assignee precedes the chain — arm 2 points at a
-- different person and must not answer.
SELECT 'assignee_seeds_from_source',
       (SELECT c.ins_assignee = c.pm AND c.ins_assignee <> c.admin2 FROM in_ctx c),
       'A(b): an existing eligible assigned_to_id is the assignee; with work_item_defaults.inspection.triage_owner_id set to someone else, the source still wins'
UNION ALL
SELECT 'gatekeeper_is_verifier',
       (SELECT c.ins_gate = c.verifier AND c.ins_gate <> c.chain_pm FROM in_ctx c),
       'A(b) verifier_else_pm: verifier_id is the gatekeeper, and the fixture keeps the verifier distinct from the PM chain''s answer so a PM-only gatekeeper goes red here'
UNION ALL
SELECT 'born_open_not_triage',
       (SELECT c.ins_status = 'open' AND c.ins_bic = c.pm FROM in_ctx c),
       'an inspection arrives already assigned to an eligible person, so it is born open on them, not triage (§03 §1.6)'
UNION ALL
SELECT 'unscheduled_due_computed_by_the_spine',
       (SELECT c.ins_due = c.default_due FROM in_ctx c),
       'no scheduled_at ⇒ NULL through the floor, so item 2''s trigger computes exactly A(b)''s +3 site working days from the SAST day (then the shutdown push) — the exact born date, not merely "after today"'
UNION ALL
-- Improvement 6, on the source §12 §(d) explicitly told us to pass through.
SELECT 'past_scheduled_is_floored',
       (SELECT c.past_due = c.default_due FROM in_ctx c),
       '16 of 19 live inspections are scheduled in the past; §12 §(d) says scheduled_at::date and that would be overdue on day one — the floor hands NULL to §5, which computes the same +3 site wd as an unscheduled one'
UNION ALL
-- Task 4 review carry-forward: the floor and §5 must agree on what day it is.
SELECT 'due_from_scheduled_uses_sast_day',
       (SELECT c.sast_due = c.utc_day + 1 FROM in_ctx c),
       'scheduled_at at 23:30 UTC is 01:30 SAST the next day: the projection passes (scheduled_at AT TIME ZONE ''Africa/Johannesburg'')::date, so the item is due on the SAST day (+11), not the session-UTC day (+10)'
UNION ALL
-- Arm 2 is reachable only through exactly 'inspection'.
SELECT 'arm_2_resolves_through_the_inspection_key',
       (SELECT c.arm2_assignee = c.admin2 AND c.admin2 <> c.pm AND c.admin2 <> c.chain_pm FROM in_ctx c),
       'work_item_defaults.inspection.triage_owner_id is arm 2 of the mirror chain — reachable only when project_inspection passes exactly ''inspection''; the owner (arm 3) and the PM-chain person (arm 4) are different people and must not be the answer'
UNION ALL
SELECT 'unassigned_is_born_triage',
       (SELECT c.arm2_status = 'triage' AND c.arm2_bic = c.admin2 FROM in_ctx c),
       'no explicit assignee ⇒ triage on the chain''s answer (§03 §1.6); 0 of 19 live rows are unassigned, which measures the module''s age, not its risk'
UNION ALL
SELECT 'absent_verifier_falls_to_pm',
       (SELECT c.arm2_gate = projects.resolve_project_pm(c.proj) AND c.arm2_gate <> c.pm FROM in_ctx c),
       'A(b) verifier_else_pm: a NULL verifier_id resolves the gatekeeper through the PM chain'
UNION ALL
-- F2 / improvement 7, on both people.
SELECT 'ineligible_assignee_falls_to_arm_2',
       (SELECT c.cvi_status = 'triage' AND c.cvi_assignee = c.admin2 AND c.cvi_assignee <> c.cv FROM in_ctx c),
       'a client viewer named as assigned_to_id is not eligible: the chain answers arm 2 and the item is born triage, never on the client viewer'
UNION ALL
SELECT 'ineligible_verifier_falls_to_pm',
       (SELECT c.cvi_gate = projects.resolve_project_pm(c.proj) AND c.cvi_gate <> c.cv FROM in_ctx c),
       'a client viewer named as verifier_id is not eligible: the resolver''s explicit arm skips them and the PM chain answers'
UNION ALL
-- §03 §1.2: no write-back arm for inspections — and the row is NOT vacuous.
SELECT 'no_writeback_to_source',
       (SELECT c.arm2_assignee IS NOT NULL AND c.arm2_src IS NULL
           AND c.cvi_assignee IS NOT NULL AND c.cvi_src = c.cv
           AND (SELECT i.assigned_to_id FROM inspections.inspections i WHERE i.id = c.insp) = c.cv
          FROM in_ctx c),
       'the source is unchanged by the spine: an item exists holding the chain''s answer while inspections.assigned_to_id stays NULL / stays the client viewer — 00066''s flow is the system of record (§03 §1.2)'
UNION ALL
-- The forward-assignment rule.
SELECT 'forward_reassignment_moves_the_ball',
       (SELECT c.re_status = 'open' AND c.re_assignee = c.third AND c.re_bic = c.third FROM in_ctx c),
       '00066 owns the column, but the spine must FOLLOW it or the Inbox names the previous person forever: assigned_to_id → an eligible contractor moves assignee_id and ball_in_court_id'
UNION ALL
SELECT 'ineligible_reassignment_keeps_the_holder',
       (SELECT c.cvre_status = 'open' AND c.cvre_assignee = c.third FROM in_ctx c),
       'improvement 7 on the UPDATE arm: assigned_to_id → a client viewer is not eligible, so the spine''s current holder stays'
UNION ALL
SELECT 'awaiting_verification_is_answered',
       (SELECT c.aw_status = 'answered' AND c.aw_bic = c.verifier FROM in_ctx c),
       'awaiting_verification ⇒ answered ⇒ the ball moves to the verifier'
UNION ALL
SELECT 'verifier_change_moves_the_gatekeeper',
       (SELECT c.vch_status = 'answered' AND c.vch_gate = c.admin2 AND c.vch_bic = c.admin2 FROM in_ctx c),
       'verifier_id is read forward like assigned_to_id: a new eligible verifier on the source becomes the gatekeeper, and while answered the ball follows'
UNION ALL
SELECT 'certified_is_closed',
       (SELECT c.cert_status = 'closed' AND c.cert_closed IS NOT NULL FROM in_ctx c),
       'certified ⇒ closed, with a closed_at'
UNION ALL
SELECT 'certified_carries_stamps',
       (SELECT c.cert_closed_by = c.admin2 AND c.cert_closed = now() FROM in_ctx c),
       'closed_by = the verifier at certification (inspections has no certified_by column); closed_at is stamped by the exempt guard at the transition (now()), not copied from the hour-old certified_at — the projection''s certified_at fallback is reached only on the INSERT path'
UNION ALL
SELECT 'closed_clears_bic',
       (SELECT c.cert_status = 'closed' AND c.cert_bic IS NULL FROM in_ctx c),
       'A(a): the generated column is NULL on closed, so the item leaves every inbox (not vacuous: the item must exist and be closed)'
UNION ALL
-- The void arm (abandoned), keyed on v_mapped, with the module's reason.
SELECT 'abandoned_voids_with_reason',
       (SELECT c.ab_status = 'void' AND c.ab_reason = 'Site closed for the season' AND c.ab_bic IS NULL FROM in_ctx c),
       'abandoned ⇒ void, void_reason = the trimmed abandoned_reason (00072, the column abandonInspectionAction writes); the ball is nobody''s'
UNION ALL
SELECT 'abandoned_without_a_reason_gets_the_default',
       (SELECT c.liveab_status = 'void' AND c.liveab_reason = 'inspection abandoned at source' FROM in_ctx c),
       'the live path with no reason on the source: the projection supplies the fallback, because the exempt guard skips its void-reason check and the next signed-in UPDATE of a reason-less void row is refused'
UNION ALL
SELECT 'void_is_terminal_on_source_reactivation',
       (SELECT c.revive_status = 'void' AND c.revive_reason = 'inspection abandoned at source'
           AND c.revive_source_status = 're-inspect_required' FROM in_ctx c),
       'abandoned → re-inspect_required maps to open, but void is terminal (Task 4''s work_item_status_for_mirror arm): the item stays void with its reason; only source_status follows'
UNION ALL
-- #4: historical stamps travel with the projection on the INSERT path.
SELECT 'born_certified_carries_source_stamps',
       (SELECT c.born_status = 'closed'
           AND c.born_opened_at = c.hist_created
           AND c.born_closed_at = c.hist_certified
           AND c.born_closed_at = (SELECT i.certified_at FROM inspections.inspections i WHERE i.id = c.born)
           AND c.born_closed_by = c.verifier
          FROM in_ctx c),
       '#4: a born-certified inspection carries opened_at = created_at, closed_at = certified_at and closed_by = verifier_id, or metric 7 and the feed lie for every backfilled closed inspection'
UNION ALL
-- F7 / §03 §1.2: the WHEN clause.
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last_activity = c.hist_certified FROM in_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL
-- Task 8 review I1: scheduled_at is read forward on a live item.
SELECT 'source_reschedule_moves_the_spine_due',
       (SELECT c.live_resched_status = 'open' AND c.live_resched_due = c.resched_day FROM in_ctx c),
       'scheduled_at moved +40 days on an OPEN item: no write-back exists in either direction for inspections, so the module''s date is read forward — due_date = the SAST day of the new scheduled_at (pushed past the band; identity by fixture). Under 87acf65 the item stayed on its birth date forever'
UNION ALL
SELECT 'spine_due_edit_is_reverted_by_a_reschedule',
       (SELECT c.spine_due = c.resched_day - 10 AND c.spine_due <> c.resched_day
           AND c.live_resched_due = c.resched_day FROM in_ctx c),
       'TRUE = transient, pinned honestly (Task 9 review S2): a spine-side due edit on a live inspection item holds until the module reschedules, and the reschedule''s SAST day replaces it — inspection due dates are module-owned while scheduled_at is in the future (Task 18: the Inbox''s due control refuses item_type = inspection)'
UNION ALL
SELECT 'reschedule_to_the_past_keeps_the_current_due',
       (SELECT c.live_past_due = c.live_resched_due FROM in_ctx c),
       'scheduled_at moved into the past: the floor hands NULL and the UPDATE arm keeps what the item holds — an item is never made overdue by a re-projection (improvement 6 on the UPDATE arm)'
UNION ALL
-- Task 8 review S1: a closed item's people and due date are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.pm
           AND c.closed_people_gate = c.verifier AND c.closed_people_due = c.born_due
           AND c.closed_people_assignee <> c.third AND c.closed_people_gate <> c.admin2
           AND c.closed_people_due <> c.resched_day FROM in_ctx c),
       'assigned_to_id, verifier_id AND scheduled_at all changed on a CERTIFIED source: the closed record keeps the people it was closed with and its date — the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself'
UNION ALL
-- The honest rows (Task 8 review, controller decision): TRUE = transient.
SELECT 'spine_reassignment_is_reverted_by_the_next_source_write',
       (SELECT c.rt_before_assignee = c.admin2 AND c.rt_after_assignee = c.pm AND c.rt_after_assignee <> c.admin2 FROM in_ctx c),
       'TRUE = transient, pinned honestly: a spine-side reassignment of an inspection item lasts until the next watched write of ANY kind on the source (a title edit here) — the forward read runs on every projection and no write-back keeps the source in step; the module is the durable control (Task 18: the spine''s reassign action refuses item_type = inspection)'
UNION ALL
SELECT 'spine_gatekeeper_correction_is_reverted_by_the_next_source_write',
       (SELECT c.rt_before_gate = c.admin2 AND c.rt_after_gate = c.verifier AND c.rt_after_gate <> c.admin2 FROM in_ctx c),
       'TRUE = transient, pinned honestly: the verifier is read forward on every projection of a live item, so a spine-side gatekeeper correction is undone by the next watched source write; the inspection page''s verifier is the durable control'
UNION ALL
-- Task 9 review I1 (via Task 12): the live-move arm.
SELECT 'live_move_reruns_the_chain_through_the_inspection_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM in_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''inspection'' literal — a typo key falls to the owner, a dropped ELSIF v_moved arm leaves it on admin2; the ineligible verifier falls to the PM chain again'
UNION ALL
-- Task 10 review, rule 1 (via Task 13): a closed record is not rewritten by a
-- source edit that changes nothing it projects.
SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after
           AND c.cl_restamp_last_activity = c.hist_certified
           AND c.cl_restamp_assignee = c.pm AND c.cl_restamp_status = 'closed' FROM in_ctx c),
       'assigned_to_id → a second admin on a CERTIFIED source fires the _upd trigger (watched) but changes nothing the closed record projects (its people are kept), so the UPDATE arm returns early: same ctid, last_activity_at keeps its historical value instead of the guard''s now()'
UNION ALL
-- Task 10 review, rules 1 + 2 (via Task 13), on the born-abandoned void record.
SELECT 'void_item_source_title_edit_leaves_the_record',
       (SELECT c.vd_ctid_before = c.vd_ctid_after AND c.vd_rename_title = 'Abandoned board'
           AND c.vd_rename_status = 'void' AND c.vd_rename_last_activity = c.hist_abandoned FROM in_ctx c),
       'a target_label edit on a VOID (abandoned) inspection fires the _upd trigger (watched), but a void row''s title is frozen and never compared by rule 1''s early return (Task 11 review I2), so the tuple is not rewritten: same ctid, last_activity_at keeps its historical value'
UNION ALL
SELECT 'void_reason_edit_reaches_the_record',
       (SELECT c.vd_reason_status = 'void' AND c.vd_reason_reason = 'Site closed — season over'
           AND c.vd_reason_title = 'Abandoned board' FROM in_ctx c),
       'an abandoned_reason edit while the source is still abandoned DOES project — on a void mapping the source''s words win — so rule 1''s early return must compare the projected void_reason and not swallow it (the title stays frozen)'
UNION ALL
SELECT 'void_item_title_is_frozen',
       (SELECT c.vd_revive_title = 'Abandoned board' AND c.vd_revive_status = 'void'
           AND c.vd_revive_source_status = 're-inspect_required'
           AND c.vd_revive_reason = 'Site closed — season over' FROM in_ctx c),
       'Task 10 review, rule 2: a label edit COMBINED with a revival runs the UPDATE arm (source_status changes — asserted, so the row is not vacuous) and the void record keeps the title it was withdrawn with; void is terminal and the reason is kept (a closed row''s title keeps following the source)';
