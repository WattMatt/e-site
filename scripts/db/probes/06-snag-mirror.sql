-- 06-snag-mirror.sql — Task 7: the snag projection (00198 section D.2, the
-- first copy of D.1's template). Asserted against production inside one
-- rolled-back transaction:
--   projects.project_snag(uuid)          — the projection body (no recursion guard)
--   projects.mirror_snag_work_item()     — the trigger wrapper (depth guard, F2)
--   snags_mirror_work_item_ins / _upd    — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
-- and section E's snag arm on both sides: a TRIAGE item leaves
-- field.snags.assigned_to alone (unassigned_snag_source_stays_unassigned —
-- the raiser is the spine's default holder, not "assigned to fix") and an
-- OPEN one reaches it (assigned_snag_reaches_source, on a spine un-triage).
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/06-snag-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section D.2 existed this reported 1/20: no trigger fires, no snag
-- projects anything, every recorded observation is NULL (a NULL `ok` is a FAIL
-- in the harness, never a coerced false), and closed_clears_bic passes
-- VACUOUSLY — there is no item to hold a ball at all. Section D.2 is what
-- makes that row mean something.
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
-- (signed_off_carries_stamps), so "closed_at = signed_off_at" is only ever
-- true on the INSERT path, where no guard runs
-- (born_signed_off_carries_source_stamps).
--
-- field.snags carries no sequence (no snag number), so unlike probe 04 nothing
-- here outlives the rollback. work_items.ref is a per-project counter.
--
-- The born status of an unassigned snag is TRIAGE on the raiser, not open:
-- §12 §(d)'s "assigned_to → raised_by → the chain" is the DEFAULT-holder chain
-- and §03 §1.6's explicit-assignee test decides open vs triage — the
-- projection's INSERT flag reads assigned_to (as the plan text does), so an
-- eligible raiser holds the item in triage until someone is assigned to fix
-- it, on the snag page (source_assignment_change_untriages_or_reassigns) or on
-- the spine. The module agrees: both create paths offer an OPTIONAL assignee
-- (the snag page's client-side insert, snags/new/page.tsx:84,
-- `assigned_to: input.assignedTo || null`; addSnagToVisitAction,
-- snag-visit.actions.ts:261, `snagFields.assignedTo ?? null`) and
-- notifySnagCreatedAction emails raiser and assignee as two different people
-- (snag.actions.ts:36-46). Section E therefore SKIPS a triage snag: the raiser
-- stays off snags.assigned_to until someone is assigned to fix.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation.
--
-- Expected: 23 rows. If the printed `assertions seen:` list is shorter than
-- twenty-three names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project (⇒ triage_owner_id), signs the snag off
  v_ctr   uuid;   -- a contractor: raises the snag (all 6 live snags were raised by a contractor)
  v_proj  uuid;
  v_chain_pm uuid;   -- resolve_project_pm(v_proj): the oldest active org admin — the GATEKEEPER
  v_admin2   uuid;   -- arm 2 (work_item_defaults.snag.triage_owner_id): distinct from every other arm's answer
  v_admin3   uuid;   -- the un-triage target on the snag page: distinct from everyone above
  v_cv       uuid;   -- an active WM client viewer: never eligible on the probe project (F2)
  v_triage_owner uuid;
  v_arm2_readback uuid;
  v_snag     uuid;   -- contractor-raised, no assignee, a location: the live shape
  v_nowhere  uuid;   -- whitespace-only location
  v_cv_snag  uuid;   -- raised by the client viewer: the raiser is ineligible, so the chain answers
  v_hidden   uuid;   -- raised by the contractor, assigned_to = the client viewer: an ineligible name must not hide the raiser
  v_born_so  uuid;   -- born signed_off with historical stamps: the backfill shape
  -- What §5 computes for a snag born with no date: A(b)'s +5 site working
  -- days from the SAST day (00196:670), then the builders' shutdown push —
  -- the exact born date, not merely "after today".
  v_default_due date;
  -- now() is fixed for the whole transaction, so these are exact targets.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_signed  timestamptz := now() - interval '20 days';
  v_ins      record;
  v_assigned_after uuid;
  v_cv_item  record;
  v_hidden_item record;
  v_assign   record;
  v_sp       record;   -- the item after the spine's un-triage of v_nowhere
  v_sp_src   uuid;     -- field.snags.assigned_to after that un-triage
  v_sp_after record;   -- the item after an unrelated source edit that follows it
  v_res      record;
  v_sof      record;
  v_born     record;
  v_same_last_activity timestamptz;
  v_closed_people record;   -- the signed-off item's people after a post-sign-off source reassignment (Task 8 review S1)
  v_proj3    uuid;   -- the live-move target: its arm 2 names admin3 (a moved item keeps its ref; two moves into one project collide on work_items_ref_unique)
  v_livemv   record; -- the client-viewer-raised snag's item after its move
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  SELECT u.user_id INTO v_ctr FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'contractor' AND u.is_active
     AND u.user_id <> v_pm
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_ctr IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active contractor in user_organisations (12 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_snag_mirror', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has NO effective role on a project they are not a
  -- member of (00107). Without this row the raiser is ineligible, falls to the
  -- chain, and assignee_is_the_raiser would fail for a fixture reason.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_ctr) THEN
    RAISE EXCEPTION 'fixture: the contractor (%) is not eligible on the probe project', v_ctr;
  END IF;

  -- The gatekeeper: 00195's PM chain — no project PM, no org PM, so the oldest
  -- active org admin. Never the contractor (asserted, so gatekeeper_is_pm_not_raiser
  -- measures the mirror, not the fixture) and never the owner (so arm 2, arm 3
  -- and arm 4 of the assignee chain all answer DIFFERENT people).
  v_chain_pm := projects.resolve_project_pm(v_proj);
  IF v_chain_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: the probe project resolves no PM — WM-Consulting has lost its owner/admins';
  END IF;
  IF v_chain_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the contractor (%), so gatekeeper and raiser would coincide for a fixture reason', v_ctr;
  END IF;
  IF v_chain_pm = v_pm THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the owner (%), who is also the triage owner — arm 3 and arm 4 would answer alike', v_pm;
  END IF;
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded triage_owner_id = % (expected created_by = the owner %)', v_triage_owner, v_pm;
  END IF;

  -- Arm 2 of the mirror chain, work_item_defaults.snag.triage_owner_id: a
  -- second admin, distinct from the owner (arm 3) and from the PM-chain person
  -- (arm 4), so the 'snag' literal project_snag passes is load-bearing — a typo
  -- ('snaag') skips this arm and falls to the owner. Set BEFORE the first snag
  -- so assignee_is_the_raiser also proves the raiser precedes this arm.
  SELECT u.user_id INTO v_admin2 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_ctr, v_chain_pm)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin2 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin besides the PM-chain person (7 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin2) THEN
    RAISE EXCEPTION 'fixture: the second admin (%) is not eligible on the probe project', v_admin2;
  END IF;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('snag', jsonb_build_object('triage_owner_id', v_admin2::text))
   WHERE project_id = v_proj;
  -- §13's validator NULLs an id with no effective role on the project; an org
  -- admin always has one (00107), but read it back rather than assume.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY['snag', 'triage_owner_id'], '')::uuid INTO v_arm2_readback
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_arm2_readback IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: validate_work_item_defaults did not keep work_item_defaults.snag.triage_owner_id = % (read back %)', v_admin2, v_arm2_readback;
  END IF;
  -- With no usable explicit candidate the chain must answer arm 2 — asserted so
  -- the arm-2 row below measures project_snag's literal, not section B.
  IF projects.resolve_mirror_assignee(v_proj, 'snag', NULL) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''snag'', NULL) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'snag', NULL), v_admin2;
  END IF;

  -- The un-triage target: a third admin, eligible and distinct from everyone
  -- above, so the assignment row cannot pass on a coincidence.
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_ctr, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin (7 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin3) THEN
    RAISE EXCEPTION 'fixture: the third admin (%) is not eligible on the probe project', v_admin3;
  END IF;

  -- F2: an active WM client viewer — ineligible on the probe project whatever
  -- their membership (client_viewer is excluded by the mirror's chain).
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_ctr)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- The registry's default for 'snag' is 5 site working days (00196:240); the
  -- probe project carries no days_to_respond override (fresh settings row).
  v_default_due := projects.push_past_builders_shutdown(
    projects.add_working_days((now() AT TIME ZONE 'Africa/Johannesburg')::date, 5, v_proj, 'site'),
    v_proj);
  IF v_default_due IS NULL OR v_default_due <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: add_working_days(SAST today, 5, proj, site) answered % — the site calendar is not usable', v_default_due;
  END IF;

  -- Shaped like a live row: a contractor raises it, no assignee, a location.
  INSERT INTO field.snags (project_id, organisation_id, title, location,
                           priority, status, raised_by)
  VALUES (v_proj, v_org, 'DB labelling incomplete', 'Unit 5 — DB-05',
          'high', 'open', v_ctr)
  RETURNING id INTO v_snag;

  SELECT w.item_type, w.title, w.status, w.source_status, w.assignee_id, w.gatekeeper_id,
         w.ball_in_court_id, w.due_date
    INTO v_ins FROM projects.work_items w WHERE w.snag_id = v_snag AND w.origin = 'mirror';

  -- Section E fired on that INSERT and must have SKIPPED it: the item is
  -- triage, so the raiser stays off the source's assigned_to.
  SELECT s.assigned_to INTO v_assigned_after FROM field.snags s WHERE s.id = v_snag;

  -- A snag with NO location must not gain a dangling em-dash.
  INSERT INTO field.snags (project_id, organisation_id, title, location,
                           priority, status, raised_by)
  VALUES (v_proj, v_org, 'No location snag', '   ', 'low', 'open', v_ctr)
  RETURNING id INTO v_nowhere;

  -- Raised by the client viewer, no assignee: assigned_to → raised_by both
  -- unusable, so the chain answers — arm 2 by fixture.
  INSERT INTO field.snags (project_id, organisation_id, title, location,
                           priority, status, raised_by)
  VALUES (v_proj, v_org, 'CV-raised snag', 'Floor 2 — Comms', 'medium', 'open', v_cv)
  RETURNING id INTO v_cv_snag;
  SELECT w.status, w.assignee_id INTO v_cv_item
    FROM projects.work_items w WHERE w.snag_id = v_cv_snag AND w.origin = 'mirror';

  -- Raised by the contractor but assigned_to a CLIENT VIEWER (Task 7 review):
  -- the ineligible name must not hide the eligible raiser from the chain.
  -- COALESCE(assigned_to, raised_by) handed the client viewer in and fell to
  -- arm 2 (measured: assignee = admin2); the first-ELIGIBLE form hands the
  -- raiser in. Not an explicit assignment (the named person is ineligible),
  -- so the item is born triage — and section E leaves the client viewer on
  -- the source, since a triage snag is never written back.
  INSERT INTO field.snags (project_id, organisation_id, title, location,
                           priority, status, raised_by, assigned_to)
  VALUES (v_proj, v_org, 'Client-assigned snag', 'Roof — PV inverter', 'medium', 'open',
          v_ctr, v_cv)
  RETURNING id INTO v_hidden;
  SELECT w.status, w.assignee_id INTO v_hidden_item
    FROM projects.work_items w WHERE w.snag_id = v_hidden AND w.origin = 'mirror';

  -- The snag page's own assign control: an ELIGIBLE person DIFFERENT from what
  -- the item holds (the raiser) un-triages the item.
  UPDATE field.snags SET assigned_to = v_admin3 WHERE id = v_snag;
  SELECT w.status, w.assignee_id INTO v_assign
    FROM projects.work_items w WHERE w.snag_id = v_snag;

  -- The SPINE's un-triage of the no-location snag (§03 §1.6: the triage
  -- owner's explicit assign is status + assignee in one statement; service
  -- path here, probe 05b is the signed-in evidence). The item is now OPEN, so
  -- section E writes the assignee to field.snags.assigned_to.
  UPDATE projects.work_items SET status = 'open', assignee_id = v_admin3
   WHERE snag_id = v_nowhere AND origin = 'mirror';
  SELECT w.status, w.assignee_id INTO v_sp
    FROM projects.work_items w WHERE w.snag_id = v_nowhere AND w.origin = 'mirror';
  SELECT s.assigned_to INTO v_sp_src FROM field.snags s WHERE s.id = v_nowhere;

  -- An unrelated source edit re-projects: the source now names EXACTLY what
  -- the item holds (the write-back's value), so the un-triage flag is false
  -- and nothing moves — the round trip converges instead of ping-ponging.
  UPDATE field.snags SET priority = 'medium' WHERE id = v_nowhere;
  SELECT w.status, w.assignee_id INTO v_sp_after
    FROM projects.work_items w WHERE w.snag_id = v_nowhere AND w.origin = 'mirror';

  -- Push-back from the source (service path — the guard is exempt as postgres
  -- AND at depth 2; probe 05b is the signed-in evidence).
  UPDATE field.snags SET status = 'resolved' WHERE id = v_snag;
  SELECT w.status, w.ball_in_court_id INTO v_res
    FROM projects.work_items w WHERE w.snag_id = v_snag;

  -- The sign-off, with signed_off_at deliberately an hour OLD: the exempt
  -- guard stamps closed_at = now() on the transition and keeps closed_by, so
  -- the item's closed_at is the transition moment, not the source's stamp.
  UPDATE field.snags
     SET status = 'signed_off', signed_off_by = v_pm, signed_off_at = now() - interval '1 hour'
   WHERE id = v_snag;
  SELECT w.status, w.ball_in_court_id, w.closed_at, w.closed_by INTO v_sof
    FROM projects.work_items w WHERE w.snag_id = v_snag;

  -- A source reassignment AFTER the sign-off (the snag page's assign control
  -- on a signed-off snag): the closed item's people are part of the record
  -- and must not follow (Task 8 review S1). v_admin2 is eligible and
  -- different from what the item holds (admin3), so without the rule the
  -- forward read would move assignee_id here.
  UPDATE field.snags SET assigned_to = v_admin2 WHERE id = v_snag;
  SELECT w.status, w.assignee_id, w.gatekeeper_id INTO v_closed_people
    FROM projects.work_items w WHERE w.snag_id = v_snag AND w.origin = 'mirror';

  -- A BORN-SIGNED-OFF source with historical stamps — the backfill shape (#4;
  -- none live today, 0 of 6 are signed off). No guard runs on INSERT and §5
  -- keeps a supplied opened_at on the service path, so what the projection
  -- supplies is what the row carries. updated_at is set explicitly so
  -- last_activity_at has a value a re-projection would visibly disturb.
  INSERT INTO field.snags (project_id, organisation_id, title, location, priority, status,
                           raised_by, signed_off_by, signed_off_at, created_at, updated_at)
  VALUES (v_proj, v_org, 'Born signed-off snag', 'Basement — MCC Panel', 'low', 'signed_off',
          v_ctr, v_pm, v_hist_signed, v_hist_created, v_hist_signed)
  RETURNING id INTO v_born_so;
  SELECT w.status, w.opened_at, w.closed_at, w.closed_by INTO v_born
    FROM projects.work_items w WHERE w.snag_id = v_born_so AND w.origin = 'mirror';

  -- A full-row save that changes only the description: every watched column
  -- is in the SET list with its old value. The _upd trigger's column list
  -- admits it; only the WHEN clause stops it firing. If it fired, the UPDATE
  -- arm would stamp last_activity_at = now() over the historical value.
  UPDATE field.snags
     SET description = 'edited', title = title, location = location, priority = priority,
         status = status, assigned_to = assigned_to,
         signed_off_by = signed_off_by, signed_off_at = signed_off_at
   WHERE id = v_born_so;
  SELECT w.last_activity_at INTO v_same_last_activity
    FROM projects.work_items w WHERE w.snag_id = v_born_so AND w.origin = 'mirror';

  -- ── Task 9 review I1 (via Task 12): a LIVE move re-runs the chain ─────────
  -- A THIRD project whose arm 2 (work_item_defaults.snag.triage_owner_id)
  -- names admin3 — the un-triage target above, never named on the moved
  -- snag, distinct from the first project's arm 2 (admin2) and from arm 3
  -- (the owner) — so the move arm's resolver call and its 'snag' literal are
  -- both load-bearing: a typo key falls to the owner, a dropped `ELSIF
  -- v_moved` arm keeps admin2. The client-viewer-raised snag (triage on
  -- admin2, assigned_to NULL — section E never writes a triage snag back, so
  -- the move arm's candidate is the ineligible raiser) moves there. A fresh
  -- third project: a moved item keeps its ref and the allocator numbers per
  -- project (deviation 20).
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_snag_mirror_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('snag', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'snag', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'snag', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'snaag', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  UPDATE field.snags SET project_id = v_proj3 WHERE id = v_cv_snag;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.snag_id = v_cv_snag AND w.origin = 'mirror';

  CREATE TEMP TABLE sn_ctx(
    snag uuid, nowhere uuid, cv_snag uuid, hidden uuid, born_so uuid, proj uuid,
    pm uuid, ctr uuid, chain_pm uuid, admin2 uuid, admin3 uuid, cv uuid,
    default_due date,
    ins_type text, ins_title text, ins_status text, ins_source_status text,
    ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
    assigned_after uuid,
    cv_status text, cv_assignee uuid,
    hidden_status text, hidden_assignee uuid,
    assign_status text, assign_assignee uuid,
    sp_status text, sp_assignee uuid, sp_src uuid,
    sp_after_status text, sp_after_assignee uuid,
    res_status text, res_bic uuid,
    sof_status text, sof_bic uuid, sof_closed timestamptz, sof_closed_by uuid,
    born_status text, born_opened_at timestamptz, born_closed_at timestamptz, born_closed_by uuid,
    hist_created timestamptz, hist_signed timestamptz,
    same_last_activity timestamptz,
    closed_people_status text, closed_people_assignee uuid, closed_people_gate uuid,
    proj3 uuid, livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid)
    ON COMMIT DROP;
  INSERT INTO sn_ctx VALUES (
    v_snag, v_nowhere, v_cv_snag, v_hidden, v_born_so, v_proj,
    v_pm, v_ctr, v_chain_pm, v_admin2, v_admin3, v_cv,
    v_default_due,
    v_ins.item_type, v_ins.title, v_ins.status, v_ins.source_status,
    v_ins.assignee_id, v_ins.gatekeeper_id, v_ins.ball_in_court_id, v_ins.due_date,
    v_assigned_after,
    v_cv_item.status, v_cv_item.assignee_id,
    v_hidden_item.status, v_hidden_item.assignee_id,
    v_assign.status, v_assign.assignee_id,
    v_sp.status, v_sp.assignee_id, v_sp_src,
    v_sp_after.status, v_sp_after.assignee_id,
    v_res.status, v_res.ball_in_court_id,
    v_sof.status, v_sof.ball_in_court_id, v_sof.closed_at, v_sof.closed_by,
    v_born.status, v_born.opened_at, v_born.closed_at, v_born.closed_by,
    v_hist_created, v_hist_signed,
    v_same_last_activity,
    v_closed_people.status, v_closed_people.assignee_id, v_closed_people.gatekeeper_id,
    v_proj3, v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id);
END $probe$;

SELECT 'snag_item_created' AS probe,
       (SELECT count(*) FROM projects.work_items w, sn_ctx c
         WHERE w.snag_id = c.snag AND w.origin = 'mirror') = 1 AS ok,
       'one mirror item per snag — still one after four re-projections (the explicit partial-index ON CONFLICT target, F6)' AS detail
UNION ALL
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'snag')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'snag')
              FROM sn_ctx c),
       'the literal ''snag'' in project_snag() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL
-- Improvement 5.
SELECT 'title_carries_the_location',
       (SELECT c.ins_title = 'DB labelling incomplete — Unit 5 — DB-05' FROM sn_ctx c),
       '6 of 6 live snags carry a location and 0 carry a floor_plan_pin; the title is all that reaches the recap'
UNION ALL
SELECT 'blank_location_adds_no_dash',
       (SELECT w.title FROM projects.work_items w, sn_ctx c WHERE w.snag_id = c.nowhere)
         = 'No location snag',
       'a whitespace-only location must not produce a trailing em-dash'
UNION ALL
-- Section E's snag arm, both sides (controller decision, Task 7 review).
SELECT 'unassigned_snag_source_stays_unassigned',
       (SELECT c.ins_status = 'triage' AND c.ins_assignee = c.ctr AND c.assigned_after IS NULL FROM sn_ctx c),
       'a raiser-held TRIAGE item is not written back: snags.assigned_to means "assigned to fix", and writing the raiser there on the same request would make notifySnagCreatedAction''s email render the raiser as the assignee'
UNION ALL
SELECT 'assigned_snag_reaches_source',
       (SELECT c.sp_status = 'open' AND c.sp_assignee = c.admin3 AND c.sp_src = c.admin3 FROM sn_ctx c),
       'the spine''s un-triage (status → open with an assignee, one statement) leaves triage, so section E writes field.snags.assigned_to = that assignee (assignment only — snags have no due_date)'
UNION ALL
-- §12 §(d), ordering A: an eligible raiser precedes the chain — arm 2 points
-- at a different person and must not answer.
SELECT 'assignee_is_the_raiser',
       (SELECT c.ins_assignee = c.ctr AND c.ins_assignee <> c.admin2 FROM sn_ctx c),
       '§12 §(d): assigned_to → raised_by → the chain; with work_item_defaults.snag.triage_owner_id set to someone else, the raiser still wins'
UNION ALL
SELECT 'raiser_is_default_assignee',
       (SELECT c.ins_status = 'triage' AND c.ins_bic = c.ctr FROM sn_ctx c),
       'the raiser is a DEFAULT holder, not an explicit assignee: §03 §1.6 says no explicit assignee ⇒ triage, and the INSERT flag reads assigned_to — the contractor who found it holds it in triage until someone is assigned to fix it'
UNION ALL
SELECT 'client_viewer_raiser_falls_to_chain',
       (SELECT c.cv_assignee <> c.cv AND c.cv_status = 'triage' FROM sn_ctx c),
       'F2 / improvement 7: a client-viewer raiser is not eligible, so raised_by is skipped and the chain answers; born triage'
UNION ALL
-- Task 7 review: the first ELIGIBLE of (assigned_to, raised_by), never COALESCE.
SELECT 'ineligible_assigned_to_does_not_hide_the_raiser',
       (SELECT c.hidden_assignee = c.ctr AND c.hidden_status = 'triage' AND c.hidden_assignee <> c.admin2 FROM sn_ctx c),
       'assigned_to = a client viewer, raised_by = an eligible contractor: the raiser is the candidate (COALESCE would hand the client viewer in and fall to arm 2''s admin); not an explicit assignment, so triage'
UNION ALL
-- §12 §(d), ordering B: an ineligible raiser falls to the chain, whose arm 2
-- is reachable only through exactly 'snag'.
SELECT 'arm_2_resolves_through_the_snag_key',
       (SELECT c.cv_assignee = c.admin2 AND c.admin2 <> c.pm AND c.admin2 <> c.chain_pm FROM sn_ctx c),
       'work_item_defaults.snag.triage_owner_id is arm 2 of the mirror chain — reachable only when project_snag passes exactly ''snag''; the owner (arm 3) and the PM-chain person (arm 4) are different people and must not be the answer'
UNION ALL
-- §03 §1.5.
SELECT 'gatekeeper_is_pm_not_raiser',
       (SELECT c.ins_gate = projects.resolve_project_pm(c.proj) AND c.ins_gate <> c.ctr FROM sn_ctx c),
       '§03 §1.5: a defect is not signed off by the person who reported it'
UNION ALL
SELECT 'due_computed_by_the_spine',
       (SELECT c.ins_due = c.default_due FROM sn_ctx c),
       'field.snags has no due_date column, so item 2''s trigger computes exactly A(b)''s +5 site working days from the SAST day (then the shutdown push) — the exact born date, not merely "after today"'
UNION ALL
-- Task 4 review carry-forward 2, revised by the Task 5 review (F2): the UPDATE
-- arm's un-triage flag is "an ELIGIBLE source assignee DIFFERENT from what the
-- item holds".
SELECT 'source_assignment_change_untriages_or_reassigns',
       (SELECT c.assign_status = 'open' AND c.assign_assignee = c.admin3 FROM sn_ctx c),
       'snags.assigned_to → a third admin on the snag page (eligible, different from the raiser the item held): the item leaves triage and carries that assignee'
UNION ALL
SELECT 'writeback_value_is_inert_on_reprojection',
       (SELECT c.sp_after_status = 'open' AND c.sp_after_assignee = c.admin3 FROM sn_ctx c),
       'after section E wrote the spine''s un-triage assignee to snags.assigned_to, an unrelated edit (priority) re-projects with the source naming exactly what the item holds: nothing moves — the round trip converges'
UNION ALL
SELECT 'resolved_is_answered',
       (SELECT c.res_status = 'answered' AND c.res_bic = projects.resolve_project_pm(c.proj) AND c.res_bic <> c.ctr FROM sn_ctx c),
       'resolved ⇒ answered ⇒ the PM holds the ball — compared to the PM directly, not to whatever the gatekeeper resolved to (probe 04 F3: against ins_gate this row could not go red under a raiser gatekeeper)'
UNION ALL
SELECT 'signed_off_is_closed',
       (SELECT c.sof_status = 'closed' AND c.sof_closed IS NOT NULL FROM sn_ctx c),
       'signed_off ⇒ closed, with a closed_at'
UNION ALL
SELECT 'signed_off_carries_stamps',
       (SELECT c.sof_closed_by = c.pm AND c.sof_closed = now() FROM sn_ctx c),
       'closed_by = signed_off_by travels through; closed_at is stamped by the exempt guard at the transition (now()), not copied from the hour-old signed_off_at — the projection''s signed_off_at fallback is reached only on the INSERT path'
UNION ALL
-- #4: historical stamps travel with the projection on the INSERT path.
SELECT 'born_signed_off_carries_source_stamps',
       (SELECT c.born_status = 'closed'
           AND c.born_opened_at = c.hist_created
           AND c.born_closed_at = c.hist_signed
           AND c.born_closed_at = (SELECT s.signed_off_at FROM field.snags s WHERE s.id = c.born_so)
           AND c.born_closed_by = c.pm
          FROM sn_ctx c),
       '#4: a born-signed-off snag carries opened_at = created_at and closed_at/closed_by from signed_off_at/signed_off_by (field.snags has no closed_at/closed_by), or metric 7 and the feed lie for every backfilled closed snag'
UNION ALL
-- F7 / §03 §1.2: the WHEN clause.
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last_activity = c.hist_signed FROM sn_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL
SELECT 'closed_clears_bic',
       (SELECT c.sof_bic IS NULL FROM sn_ctx c),
       'A(a): the generated column is NULL on closed, so the item leaves every inbox'
UNION ALL
-- Task 8 review S1: a closed item's people are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.admin3
           AND c.closed_people_assignee <> c.admin2 AND c.closed_people_gate = c.chain_pm FROM sn_ctx c),
       'snags.assigned_to → a second admin AFTER the sign-off: the closed record keeps the people it was closed with (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself) — without the rule the forward read would move assignee_id'
UNION ALL
-- Task 9 review I1 (via Task 12): the live-move arm.
SELECT 'live_move_reruns_the_chain_through_the_snag_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM sn_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''snag'' literal — a typo key falls to the owner, a dropped ELSIF v_moved arm leaves it on admin2; the gatekeeper is the PM chain again';
