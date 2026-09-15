-- 10-form-mirror.sql — Task 11: the form_action projection (00199 section D.6,
-- the fifth copy of D.1's template and the one that is BORN OPEN — F10).
-- Asserted against production inside one rolled-back transaction:
--   projects.project_form_action(uuid)        — the projection body (no recursion guard)
--   projects.mirror_form_action_work_item()   — the trigger wrapper (depth guard, F2)
--   site_forms_mirror_work_item_ins / _upd    — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--
-- F10 — a site form is born OPEN on its author, and that is a decision, not
-- an accident. field.site_forms.created_by is NOT NULL DEFAULT auth.uid()
-- (00179:83), so the plan's original `created_by IS NOT NULL` test was a
-- tautology. Decided: a site form IS the thing its author must finish (a
-- Termination & Making Safe record feeding a supplementary CoC, EIR reg
-- 7(4)), so the author is an EXPLICIT owner and the item is born open on
-- them. The projection expresses it through the template's eligibility flag
-- (v_explicit := work_item_person_eligible(project, created_by)), identical
-- for every real author — a client viewer cannot create a form
-- (site_forms_insert, 00179:452-458) — and improvement 7 still catches a row
-- a trusted role inserts with an ineligible created_by. draft_is_open_on_its_author
-- asserts = 'open', NEVER IN ('triage','open'): the mutation that flips the
-- flag to false (Task 11 Step 5) must red exactly that row.
--
-- ⚠ trg_site_forms_transition (00179:415, BEFORE UPDATE, SECURITY INVOKER by
-- design) runs before the mirror, which is AFTER and stays AFTER. As postgres
-- (current_user exempt, 00179:352-354) every transition below is legal — so
-- the one ILLEGAL transition is attempted under impersonation, in the second
-- DO block, and pinned on the guard's own sentence: the mirror never fires,
-- the item does not move.
--
-- Run (00199 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/10-form-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
-- Before section D.6 existed this reported 1/23 (23 rows then; the Task 10
-- review added three): closed_clears_bic passes VACUOUSLY (there is no ball
-- to clear — the plan's Step 2 names it); every other row reads a NULL
-- observation (a NULL `ok` is a FAIL in the harness, never a coerced false)
-- or a false count.
--
-- Walks from an empty project, never from seeded data (§12 §(h)): production
-- holds ONE form (TMS-PNP2-2026-0001 on (649) PNP FAERIE GLEN, draft, authored
-- by the org owner — eligible, measured 2026-09-13), so a live fixture could
-- never fail most of these. Every fixture RAISEs rather than skips: a NOTICE
-- never reaches the Management API caller, and a skipped fixture is a probe
-- that cannot fail. An active field.form_templates row must exist (1 of 2 on
-- 2026-09-13) — template_row_id is NOT NULL.
--
-- Runs as postgres with auth.uid() NULL throughout the first block (no
-- impersonation) — the SERVICE PATH of the transition guard (00199 section C':
-- v_actor IS NULL skips authority and the machine, stamps closed_at = now() on
-- a close, keeps the supplied closed_by, clears both on any other status
-- change). The second block impersonates the owner for ONE statement, then
-- RESET ROLE + a cleared claim; exactly ONE row-producing statement, last.
-- set_config(…, true) is TRANSACTION-local and outlives RESET ROLE — hence
-- the explicit clear and the auth.uid() IS NULL assertion after it.
--
-- ⚠ Every mutation is inside a DO block. `UPDATE … RETURNING` cannot appear in
-- a FROM clause (42601), and sibling parts of one statement read the
-- pre-update snapshot — so every "after" observation is a separate SELECT
-- after the write, recorded into the temp table for the final SELECT. now() is
-- fixed for the whole transaction, so "did not re-project" is measured the way
-- probes 06-09 measure it: one form is inserted with a HISTORICAL updated_at,
-- the INSERT path copies it into last_activity_at, and a projection that
-- should not have fired would have stamped now() over it (site_forms_updated_at
-- is BEFORE UPDATE only, 00179:631, so the INSERT keeps the supplied value).
--
-- Expected: 26 rows. If the printed `assertions seen:` list is shorter than
-- twenty-six names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org      uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm       uuid;   -- the org owner: creates the project (⇒ triage_owner_id), authors most forms
  v_chain_pm uuid;   -- resolve_project_pm(v_proj): the oldest active org admin — the GATEKEEPER, never the author
  v_admin2   uuid;   -- arm 2 (work_item_defaults.form_action.triage_owner_id): distinct from every other arm's answer
  v_admin3   uuid;   -- arm 2 on the SECOND project: a different answer, so a live move must re-run the chain to be seen
  v_cv       uuid;   -- an active WM client viewer: never eligible on the probe project — authors three forms as postgres
  v_tpl      uuid;   -- an ACTIVE field.form_templates row (template_row_id is NOT NULL)
  v_proj     uuid;
  v_proj2    uuid;   -- a second WM project: the LIVE move target
  v_proj3    uuid;   -- a third: the CLOSED move target (a moved item carries its ref — two moves
                     -- into one project collide on work_items_ref_unique, measured 2026-09-13)
  v_triage_owner uuid;
  v_arm2_readback uuid;
  -- the forms
  v_f1       uuid;   -- the subject: born without a form_no (the app's shape), numbered, submitted, distributed
  v_fblank   uuid;   -- whitespace board_label: the title falls to board_ref
  v_fhist    uuid;   -- HISTORICAL stamps: the stamps subject and the do-not-reproject sentinel
  v_fdist    uuid;   -- inserted already distributed: the backfill shape (born closed)
  v_fbvoid   uuid;   -- inserted already void: the backfill shape (born void)
  v_fvoid    uuid;   -- live → void with a reason, then a trusted-role resurrection (void stays)
  v_fdv      uuid;   -- distributed → void (legal for a manager, 00179:399-401)
  v_fcv      uuid;   -- authored by the client viewer: arm 2, born triage; then MOVED live
  v_fmv      uuid;   -- authored by the client viewer, distributed, then MOVED closed (Task 8 review S1)
  v_fill     uuid;   -- the illegal-transition subject (second block)
  -- now() is fixed for the whole transaction, so these are exact targets.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_updated timestamptz := now() - interval '30 days';
  v_hist_dist    timestamptz := now() - interval '10 days';
  -- What §5 computes for a form_action born with no usable date: A(b)'s +3
  -- SITE working days from the SAST day (00196:244, 00196:670), then the
  -- builders' shutdown push — the exact born date, not merely "after today".
  v_default_due date;
  -- observations
  v_f1_n        int;
  v_b           record;   -- the subject as born
  v_numbered    text;
  v_blank_title text;
  v_h           record;   -- the historical-stamps item as born
  v_sub         record;   -- the subject after draft → submitted
  v_dist        record;   -- … after submitted → distributed
  v_bd          record;   -- the born-distributed item
  v_cl_restamp  record;   -- … after a distributed_by re-stamp (rule 1: not rewritten)
  v_cl_renamed  record;   -- … after a board rename (a closed row's title follows)
  v_bv          record;   -- the born-void item
  v_bv_renamed  record;   -- … after a board rename (rule 2: the title is frozen)
  v_vlive       record;   -- the void candidate while live
  v_void        record;   -- … after the void
  v_vback       record;   -- … after a trusted-role resurrection of the source
  v_dv          record;   -- the distributed-then-void item
  v_dv_voided_n int;      -- the `voided` event §11 writes for that void (Task 11 review S2)
  v_dv_voided_actor_null boolean;
  v_cvi         record;   -- the client-viewer-authored item as born
  v_cvmoved     record;   -- … after a LIVE move
  v_same_last   timestamptz;
  v_mvclosed    record;   -- the closed client-viewer item before the move
  v_mvmoved     record;   -- … after the move
  v_ill_before  record;   -- the illegal-transition subject before the attempt
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: auth.uid() is % — the first block relies on the guard''s service path (no impersonation in it)', auth.uid();
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  SELECT t.id INTO v_tpl FROM field.form_templates t
   WHERE t.is_active ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl IS NULL THEN
    RAISE EXCEPTION 'fixture: field.form_templates has no active row (1 of 2 on 2026-09-13) — site_forms.template_row_id is NOT NULL';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_form', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- F10's row measures the projection's flag, not the fixture: the author
  -- must be eligible on the probe project (the live form's author is, measured).
  IF NOT projects.work_item_person_eligible(v_proj, v_pm) THEN
    RAISE EXCEPTION 'fixture: the owner (%) is not eligible on the probe project — F10 could not be measured', v_pm;
  END IF;

  -- The PM chain: no project PM, no org PM, so the oldest active org admin.
  -- Never the owner, so the gatekeeper (the PM chain) and the assignee (the
  -- author, the owner) are DIFFERENT people — gatekeeper_is_the_pm_not_the_author
  -- measures the NULL passed to resolve_work_item_gatekeeper, not a coincidence.
  v_chain_pm := projects.resolve_project_pm(v_proj);
  IF v_chain_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: the probe project resolves no PM — WM-Consulting has lost its owner/admins';
  END IF;
  IF v_chain_pm = v_pm THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the owner (%), who is also the author — gatekeeper and assignee would coincide', v_pm;
  END IF;
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded triage_owner_id = % (expected created_by = the owner %)', v_triage_owner, v_pm;
  END IF;

  -- Improvement 7: an active WM client viewer — ineligible on the probe
  -- project whatever their membership (client_viewer is excluded by the
  -- mirror's chain). A client viewer cannot create a form through RLS
  -- (site_forms_insert, 00179:452-458); postgres can, with an explicit
  -- created_by that bypasses 00179:83's DEFAULT — the row that proves the
  -- flag is eligibility, not a tautology.
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- Arm 2 of the mirror chain, work_item_defaults.form_action.triage_owner_id:
  -- an admin distinct from the owner (arm 3) and the PM-chain person (arm 4),
  -- so the 'form_action' literal project_form_action passes is load-bearing
  -- — a typo ('form_actoin') skips this arm and falls to the owner. Set
  -- BEFORE the first form so draft_is_open_on_its_author also proves the
  -- author precedes this arm.
  SELECT u.user_id INTO v_admin2 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin2 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin (11 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin2) THEN
    RAISE EXCEPTION 'fixture: the second admin (%) is not eligible on the probe project', v_admin2;
  END IF;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('form_action', jsonb_build_object('triage_owner_id', v_admin2::text))
   WHERE project_id = v_proj;
  -- §13's validator NULLs an id with no effective role on the project; an org
  -- admin always has one (00107), but read it back rather than assume.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY['form_action', 'triage_owner_id'], '')::uuid INTO v_arm2_readback
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_arm2_readback IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: validate_work_item_defaults did not keep work_item_defaults.form_action.triage_owner_id = % (read back %)', v_admin2, v_arm2_readback;
  END IF;
  -- With no usable candidate the chain must answer arm 2 — asserted with NO
  -- candidate and with the ineligible client viewer, so the arm-2 row below
  -- measures project_form_action's literal, not section B (Task 7 review).
  IF projects.resolve_mirror_assignee(v_proj, 'form_action', NULL) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''form_action'', NULL) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'form_action', NULL), v_admin2;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj, 'form_action', v_cv) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''form_action'', <client viewer>) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'form_action', v_cv), v_admin2;
  END IF;

  -- The exact date §5 births a form_action on: A(b)'s +3 site working days
  -- from the SAST day, then the builders' shutdown push (00196 §5).
  v_default_due := projects.push_past_builders_shutdown(
    projects.add_working_days((now() AT TIME ZONE 'Africa/Johannesburg')::date, 3, v_proj, 'site'),
    v_proj);
  IF v_default_due IS NULL OR v_default_due <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: add_working_days(SAST today, 3, proj, site) answered % — the site calendar is not usable', v_default_due;
  END IF;

  -- ── the subject: the app's shape — a draft with NO form_no yet ────────────
  -- createSiteFormAction inserts without a number (site-forms.actions.ts:405-414)
  -- and stamps form_no with the service client on the same request (:426-432).
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'DB-PROBE', 'Probe board', 'draft', v_pm)
  RETURNING id INTO v_f1;
  SELECT count(*) INTO v_f1_n FROM projects.work_items WHERE site_form_id = v_f1;
  SELECT w.title, w.status, w.assignee_id, w.ball_in_court_id, w.gatekeeper_id, w.created_by,
         w.item_type, w.origin, w.due_date, w.priority, w.source_status
    INTO v_b
    FROM projects.work_items w WHERE w.site_form_id = v_f1 AND w.origin = 'mirror';

  -- the allocation: form_no is watched, so the number reaches the title
  UPDATE field.site_forms SET form_no = 'TMS-PRB-2026-0001' WHERE id = v_f1;
  SELECT w.title INTO v_numbered FROM projects.work_items w WHERE w.site_form_id = v_f1 AND w.origin = 'mirror';

  -- ── a whitespace board_label: the title falls to board_ref ────────────────
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'DB-PROBE-2', '   ', 'draft', v_pm)
  RETURNING id INTO v_fblank;
  SELECT w.title INTO v_blank_title FROM projects.work_items w WHERE w.site_form_id = v_fblank AND w.origin = 'mirror';

  -- ── HISTORICAL stamps: the backfill shape for #4 and the sentinel ─────────
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by,
                                created_at, updated_at)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0002', 'DB-H', 'Historical board', 'draft', v_pm,
          v_hist_created, v_hist_updated)
  RETURNING id INTO v_fhist;
  SELECT w.opened_at, w.last_activity_at INTO v_h
    FROM projects.work_items w WHERE w.site_form_id = v_fhist AND w.origin = 'mirror';

  -- ── the life of the record: draft → submitted → distributed ───────────────
  -- submitSiteFormAction's UPDATE (site-forms.actions.ts:580-590) and
  -- distributeSiteFormAction's service-client stamp (:249-260), as postgres.
  UPDATE field.site_forms
     SET status = 'submitted', submitted_at = now(), submitted_by = created_by
   WHERE id = v_f1;
  SELECT w.status, w.ball_in_court_id, w.gatekeeper_id, w.source_status INTO v_sub
    FROM projects.work_items w WHERE w.site_form_id = v_f1 AND w.origin = 'mirror';
  UPDATE field.site_forms
     SET status = 'distributed', distributed_at = now(), distributed_by = created_by
   WHERE id = v_f1;
  SELECT w.status, w.ball_in_court_id, w.closed_at, w.closed_by, w.source_status INTO v_dist
    FROM projects.work_items w WHERE w.site_form_id = v_f1 AND w.origin = 'mirror';

  -- ── born distributed / born void: the backfill and import shapes ──────────
  -- work_items_insert_gate would refuse these for a client; the projection is
  -- SECURITY DEFINER and owned by postgres, so the terminal state and its
  -- stamps land on the INSERT (D.6 header).
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by,
                                submitted_at, submitted_by, distributed_at, distributed_by, created_at, updated_at)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0003', 'DB-D', 'Distributed board', 'distributed', v_pm,
          v_hist_dist - interval '1 hour', v_pm, v_hist_dist, v_pm, v_hist_created, v_hist_dist)
  RETURNING id INTO v_fdist;
  SELECT w.status, w.closed_at, w.closed_by, w.opened_at, w.last_activity_at, w.ball_in_court_id INTO v_bd
    FROM projects.work_items w WHERE w.site_form_id = v_fdist AND w.origin = 'mirror';

  -- ── Task 10 review, rule 1: a closed record is not rewritten for nothing ──
  -- distributed_by is WATCHED (the close stamps are projected), so the _upd
  -- trigger fires on a re-stamp — but the item keeps its first closer (D.1's
  -- rule), so nothing it projects changes and the UPDATE arm must return
  -- before the guard can stamp last_activity_at = now() over the historical
  -- value. Then a board rename on the same closed form DOES retitle it: a
  -- closed row's title follows the source (rule 2 freezes void rows only).
  UPDATE field.site_forms SET distributed_by = v_admin2 WHERE id = v_fdist;
  SELECT w.last_activity_at, w.closed_by, w.status INTO v_cl_restamp
    FROM projects.work_items w WHERE w.site_form_id = v_fdist AND w.origin = 'mirror';
  UPDATE field.site_forms SET board_label = 'Distributed board (renamed)' WHERE id = v_fdist;
  SELECT w.title, w.status, w.closed_by INTO v_cl_renamed
    FROM projects.work_items w WHERE w.site_form_id = v_fdist AND w.origin = 'mirror';

  -- HISTORICAL stamps: the INSERT path copies updated_at into last_activity_at,
  -- so a rename that REWROTE the void record would show as the guard's now()
  -- over it (Task 11 review I2 — measured: the frozen title held but the
  -- tuple was rewritten, last_activity_at 2026-08-14 → now()).
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by, void_reason,
                                created_at, updated_at)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0004', 'DB-V', 'Void board', 'void', v_pm, 'Probe: created in error',
          v_hist_created, v_hist_updated)
  RETURNING id INTO v_fbvoid;
  SELECT w.status, w.void_reason, w.closed_at, w.title INTO v_bv
    FROM projects.work_items w WHERE w.site_form_id = v_fbvoid AND w.origin = 'mirror';
  -- Task 10 review, rule 2: a VOID row's title is frozen — the record of
  -- what was withdrawn. A trusted-role rename of the board on the void form
  -- (the guard refuses in-place edits of a non-draft for anyone else,
  -- 00179:384-390) changes nothing on the item's title — and (Task 11 review
  -- I2) does not rewrite the record either: rule 1's early return never
  -- compares a void row's title.
  UPDATE field.site_forms SET board_label = 'Void board (renamed)' WHERE id = v_fbvoid;
  SELECT w.title, w.status, w.void_reason, w.last_activity_at INTO v_bv_renamed
    FROM projects.work_items w WHERE w.site_form_id = v_fbvoid AND w.origin = 'mirror';

  -- ── live → void with a reason; void is terminal ───────────────────────────
  -- voidSiteFormAction (site-forms.actions.ts:629-635) writes status + reason
  -- in one statement; the source CHECK (00179:102-104) makes the reason
  -- non-blank. Captured live first, so the void row cannot pass on an item
  -- that was never live.
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0005', 'DB-W', 'Wrong board', 'draft', v_pm)
  RETURNING id INTO v_fvoid;
  SELECT w.status, w.void_reason INTO v_vlive
    FROM projects.work_items w WHERE w.site_form_id = v_fvoid AND w.origin = 'mirror';
  UPDATE field.site_forms SET status = 'void', void_reason = 'Probe: wrong board' WHERE id = v_fvoid;
  SELECT w.status, w.void_reason, w.title INTO v_void
    FROM projects.work_items w WHERE w.site_form_id = v_fvoid AND w.origin = 'mirror';
  -- Only a trusted role can move a void form anywhere (00179:352-354; the
  -- distribute action's `.in('status', [submitted, distributed])` exists so
  -- the service client does not resurrect one by accident —
  -- site-forms-distribute.actions.ts:259; 242-247 is its comment). If one
  -- does, the item stays void with its reason: void has no exit (Task 4's
  -- arm of work_item_status_for_mirror); the title is frozen (rule 2).
  UPDATE field.site_forms SET status = 'submitted', submitted_at = now(), submitted_by = created_by WHERE id = v_fvoid;
  SELECT w.status, w.void_reason, w.source_status INTO v_vback
    FROM projects.work_items w WHERE w.site_form_id = v_fvoid AND w.origin = 'mirror';

  -- ── distributed → void: a manager withdrawing an issued record ────────────
  -- Legal on the source (00179:399-401; the void action's `.neq('status','void')`
  -- admits a distributed form): closed → void on the spine, and the guard's
  -- exempt path clears closed_at / closed_by on any non-close status change.
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by,
                                submitted_at, submitted_by, distributed_at, distributed_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0006', 'DB-X', 'Withdrawn board', 'distributed', v_pm,
          now(), v_pm, now(), v_pm)
  RETURNING id INTO v_fdv;
  UPDATE field.site_forms SET status = 'void', void_reason = 'Probe: issued against the wrong DB' WHERE id = v_fdv;
  SELECT w.status, w.void_reason, w.closed_at, w.closed_by, w.ball_in_court_id INTO v_dv
    FROM projects.work_items w WHERE w.site_form_id = v_fdv AND w.origin = 'mirror';
  -- Task 11 review S2: §11 records the trigger-driven void as ONE `voided`
  -- event (actor NULL on the service path — the shape probe 09 pins).
  SELECT count(*), bool_and(e.actor_id IS NULL) INTO v_dv_voided_n, v_dv_voided_actor_null
    FROM projects.work_item_events e
    JOIN projects.work_items w ON w.id = e.work_item_id
   WHERE w.site_form_id = v_fdv AND w.origin = 'mirror' AND e.verb = 'voided';

  -- ── an INELIGIBLE author: the flag is eligibility, not a tautology ────────
  -- Explicit created_by bypasses 00179:83's DEFAULT auth.uid(); the chain
  -- skips the client viewer and answers arm 2, and the item is born TRIAGE.
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0007', 'DB-CV', 'Client board', 'draft', v_cv)
  RETURNING id INTO v_fcv;
  SELECT w.status, w.assignee_id, w.ball_in_court_id, w.gatekeeper_id, w.created_by INTO v_cvi
    FROM projects.work_items w WHERE w.site_form_id = v_fcv AND w.origin = 'mirror';

  -- ── a LIVE move re-runs the chain through the 'form_action' key ───────────
  -- The second project's arm 2 names a THIRD admin (the Task 9 review's L1
  -- shape): the client viewer's form resolves to admin3 there, a different
  -- answer from the first project's arm 2 AND from arm 3 (the owner), so the
  -- move arm's resolver call and its literal are both load-bearing — a typo
  -- key skips arm 2 on the second project and falls to the owner.
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin besides the owner, the PM-chain person and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_form_2', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj2;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('form_action', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj2;
  IF projects.resolve_mirror_assignee(v_proj2, 'form_action', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the second project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj2, 'form_action', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj2, 'form_actoin', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the second project too — the live-move row could not discriminate the literal';
  END IF;
  IF projects.resolve_project_pm(v_proj2) IS DISTINCT FROM v_chain_pm THEN
    RAISE EXCEPTION 'fixture: the second project resolves PM % rather than % — the org-level chain should answer the same admin', projects.resolve_project_pm(v_proj2), v_chain_pm;
  END IF;
  UPDATE field.site_forms SET project_id = v_proj2 WHERE id = v_fcv;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_cvmoved
    FROM projects.work_items w WHERE w.site_form_id = v_fcv AND w.origin = 'mirror';

  -- ── the WHEN clause: a full-row save that changes nothing it watches ───────
  -- Every watched column is in the SET list with its old value (as_left_status
  -- is the only real change, and it is not watched — the app writes it on
  -- submit). The _upd trigger's column list admits the statement; only the
  -- WHEN clause stops it firing. If it fired, the UPDATE arm would stamp
  -- last_activity_at = now() over the historical value the INSERT path kept.
  UPDATE field.site_forms
     SET as_left_status = 'made_safe_de_energised',
         form_no = form_no, board_ref = board_ref, board_label = board_label, status = status,
         distributed_at = distributed_at, distributed_by = distributed_by, void_reason = void_reason,
         project_id = project_id, organisation_id = organisation_id
   WHERE id = v_fhist;
  SELECT w.last_activity_at INTO v_same_last
    FROM projects.work_items w WHERE w.site_form_id = v_fhist AND w.origin = 'mirror';

  -- ── Task 8 review S1: a CLOSED item's people are part of the record ────────
  -- A client-viewer-authored form (arm 2 holds it, the PM chain gates it) is
  -- distributed — closed on the source's own path — and then moved to a
  -- THIRD project, whose chain answers the owner. The item moves
  -- (improvement 8); its people stay: the chain is re-run for a LIVE item only.
  -- A third project, not the second: a moved item keeps its ref, the
  -- allocator numbers per project, and the second move into one project
  -- collided on work_items_ref_unique (FORM-8) — a property of improvement
  -- 8 itself, not of this projection; reported with Task 11.
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_form_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'form_action', v_cv) IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 3''s owner % — the closed-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'form_action', v_cv), v_pm;
  END IF;
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0008', 'DB-MV', 'Moved board', 'draft', v_cv)
  RETURNING id INTO v_fmv;
  UPDATE field.site_forms SET status = 'submitted', submitted_at = now(), submitted_by = v_pm WHERE id = v_fmv;
  UPDATE field.site_forms SET status = 'distributed', distributed_at = now(), distributed_by = v_pm WHERE id = v_fmv;
  SELECT w.status, w.assignee_id, w.gatekeeper_id INTO v_mvclosed
    FROM projects.work_items w WHERE w.site_form_id = v_fmv AND w.origin = 'mirror';
  UPDATE field.site_forms SET project_id = v_proj3 WHERE id = v_fmv;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_mvmoved
    FROM projects.work_items w WHERE w.site_form_id = v_fmv AND w.origin = 'mirror';

  -- ── the illegal-transition subject (attempted in the second block) ─────────
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0009', 'DB-ILL', 'Guarded board', 'draft', v_pm)
  RETURNING id INTO v_fill;
  SELECT w.status, w.closed_at, w.source_status INTO v_ill_before
    FROM projects.work_items w WHERE w.site_form_id = v_fill AND w.origin = 'mirror';

  CREATE TEMP TABLE fm_ctx(
    pm uuid, chain_pm uuid, admin2 uuid, admin3 uuid, cv uuid, proj uuid, proj2 uuid, proj3 uuid,
    default_due date, hist_created timestamptz, hist_updated timestamptz, hist_dist timestamptz,
    f1_n int,
    b_title text, b_status text, b_assignee uuid, b_bic uuid, b_gate uuid, b_created_by uuid,
    b_type text, b_origin text, b_due date, b_prio text, b_src text,
    numbered text, blank_title text,
    h_opened timestamptz, h_last timestamptz,
    sub_status text, sub_bic uuid, sub_gate uuid, sub_src text,
    dist_status text, dist_bic uuid, dist_closed_at timestamptz, dist_closed_by uuid, dist_src text,
    bd_status text, bd_closed_at timestamptz, bd_closed_by uuid, bd_opened timestamptz, bd_last timestamptz, bd_bic uuid,
    cl_restamp_last timestamptz, cl_restamp_closed_by uuid, cl_restamp_status text,
    cl_renamed_title text, cl_renamed_status text, cl_renamed_closed_by uuid,
    bv_status text, bv_reason text, bv_closed_at timestamptz, bv_title text,
    bv_renamed_title text, bv_renamed_status text, bv_renamed_reason text, bv_renamed_last timestamptz,
    vlive_status text, vlive_reason text,
    void_status text, void_reason text, void_title text,
    vback_status text, vback_reason text, vback_src text,
    dv_status text, dv_reason text, dv_closed_at timestamptz, dv_closed_by uuid, dv_bic uuid,
    dv_voided_n int, dv_voided_actor_null boolean,
    cv_status text, cv_assignee uuid, cv_bic uuid, cv_gate uuid, cv_created_by uuid,
    cvm_status text, cvm_project uuid, cvm_assignee uuid, cvm_gate uuid,
    same_last timestamptz,
    mvc_status text, mvc_assignee uuid, mvc_gate uuid,
    mvm_status text, mvm_project uuid, mvm_assignee uuid, mvm_gate uuid,
    form_ill uuid, ill_before_status text, ill_before_closed_at timestamptz, ill_before_src text,
    -- written by the second block
    ill_err text, ill_sqlstate text, ill_uid uuid, ill_after_status text, ill_after_closed_at timestamptz,
    ill_after_src text, ill_form_status text, ill_cleared boolean) ON COMMIT DROP;
  INSERT INTO fm_ctx (
    pm, chain_pm, admin2, admin3, cv, proj, proj2, proj3,
    default_due, hist_created, hist_updated, hist_dist,
    f1_n,
    b_title, b_status, b_assignee, b_bic, b_gate, b_created_by, b_type, b_origin, b_due, b_prio, b_src,
    numbered, blank_title,
    h_opened, h_last,
    sub_status, sub_bic, sub_gate, sub_src,
    dist_status, dist_bic, dist_closed_at, dist_closed_by, dist_src,
    bd_status, bd_closed_at, bd_closed_by, bd_opened, bd_last, bd_bic,
    cl_restamp_last, cl_restamp_closed_by, cl_restamp_status,
    cl_renamed_title, cl_renamed_status, cl_renamed_closed_by,
    bv_status, bv_reason, bv_closed_at, bv_title,
    bv_renamed_title, bv_renamed_status, bv_renamed_reason, bv_renamed_last,
    vlive_status, vlive_reason,
    void_status, void_reason, void_title,
    vback_status, vback_reason, vback_src,
    dv_status, dv_reason, dv_closed_at, dv_closed_by, dv_bic,
    dv_voided_n, dv_voided_actor_null,
    cv_status, cv_assignee, cv_bic, cv_gate, cv_created_by,
    cvm_status, cvm_project, cvm_assignee, cvm_gate,
    same_last,
    mvc_status, mvc_assignee, mvc_gate,
    mvm_status, mvm_project, mvm_assignee, mvm_gate,
    form_ill, ill_before_status, ill_before_closed_at, ill_before_src)
  VALUES (
    v_pm, v_chain_pm, v_admin2, v_admin3, v_cv, v_proj, v_proj2, v_proj3,
    v_default_due, v_hist_created, v_hist_updated, v_hist_dist,
    v_f1_n,
    v_b.title, v_b.status, v_b.assignee_id, v_b.ball_in_court_id, v_b.gatekeeper_id, v_b.created_by,
    v_b.item_type, v_b.origin, v_b.due_date, v_b.priority, v_b.source_status,
    v_numbered, v_blank_title,
    v_h.opened_at, v_h.last_activity_at,
    v_sub.status, v_sub.ball_in_court_id, v_sub.gatekeeper_id, v_sub.source_status,
    v_dist.status, v_dist.ball_in_court_id, v_dist.closed_at, v_dist.closed_by, v_dist.source_status,
    v_bd.status, v_bd.closed_at, v_bd.closed_by, v_bd.opened_at, v_bd.last_activity_at, v_bd.ball_in_court_id,
    v_cl_restamp.last_activity_at, v_cl_restamp.closed_by, v_cl_restamp.status,
    v_cl_renamed.title, v_cl_renamed.status, v_cl_renamed.closed_by,
    v_bv.status, v_bv.void_reason, v_bv.closed_at, v_bv.title,
    v_bv_renamed.title, v_bv_renamed.status, v_bv_renamed.void_reason, v_bv_renamed.last_activity_at,
    v_vlive.status, v_vlive.void_reason,
    v_void.status, v_void.void_reason, v_void.title,
    v_vback.status, v_vback.void_reason, v_vback.source_status,
    v_dv.status, v_dv.void_reason, v_dv.closed_at, v_dv.closed_by, v_dv.ball_in_court_id,
    v_dv_voided_n, v_dv_voided_actor_null,
    v_cvi.status, v_cvi.assignee_id, v_cvi.ball_in_court_id, v_cvi.gatekeeper_id, v_cvi.created_by,
    v_cvmoved.status, v_cvmoved.project_id, v_cvmoved.assignee_id, v_cvmoved.gatekeeper_id,
    v_same_last,
    v_mvclosed.status, v_mvclosed.assignee_id, v_mvclosed.gatekeeper_id,
    v_mvmoved.status, v_mvmoved.project_id, v_mvmoved.assignee_id, v_mvmoved.gatekeeper_id,
    v_fill, v_ill_before.status, v_ill_before.closed_at, v_ill_before.source_status);
END $probe$;

-- The ONE illegal transition, under impersonation. As the owner (authenticated,
-- not exempt from 00179:352-354) `draft → distributed` directly — the plan
-- text's example — is refused by field.enforce_site_form_transition with its
-- own sentence at depth 1, BEFORE the mirror's AFTER trigger could fire. No
-- stamps are supplied with it: the identity/lifecycle check (00179:361-380)
-- would raise its OTHER sentence first and the row would pin the wrong gate.
-- The claim is set as postgres before the role switch and cleared after it
-- (transaction-local, outlives RESET ROLE); the temp table is read and written
-- as postgres only, so no GRANT to authenticated is needed.
DO $illegal$
DECLARE
  v_form uuid; v_pm uuid; v_err text; v_state text; v_uid uuid; v_n int;
  v_after record; v_form_status text;
BEGIN
  SELECT c.form_ill, c.pm INTO v_form, v_pm FROM fm_ctx c;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_uid := auth.uid();
  IF v_uid IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the owner', v_uid;
  END IF;

  BEGIN
    UPDATE field.site_forms SET status = 'distributed' WHERE id = v_form;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    -- Reached only if the guard admitted it (or RLS filtered the row to zero,
    -- v_n = 0): either way the row below reads a NULL sentence and FAILS.
    v_err := NULL;
    v_state := format('no error, %s row(s)', v_n);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim did not clear — auth.uid() is still %', auth.uid();
  END IF;

  SELECT w.status, w.closed_at, w.source_status INTO v_after
    FROM projects.work_items w WHERE w.site_form_id = v_form AND w.origin = 'mirror';
  SELECT f.status INTO v_form_status FROM field.site_forms f WHERE f.id = v_form;

  UPDATE fm_ctx
     SET ill_err = v_err, ill_sqlstate = v_state, ill_uid = v_uid,
         ill_after_status = v_after.status, ill_after_closed_at = v_after.closed_at,
         ill_after_src = v_after.source_status, ill_form_status = v_form_status,
         ill_cleared = (auth.uid() IS NULL);
END $illegal$;

SELECT 'form_item_created' AS probe,
       (SELECT c.f1_n = 1 FROM fm_ctx c) AS ok,
       'a draft form is already an obligation: somebody has to finish it' AS detail
UNION ALL
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'form_action')
       AND (SELECT c.b_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'form_action') AND c.b_origin = 'mirror'
              FROM fm_ctx c),
       'the literal ''form_action'' in project_form_action() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL
SELECT 'title_names_the_board',
       (SELECT c.b_title = 'Site form — Probe board' FROM fm_ctx c),
       'the item must name the board without opening the form: <form_no or Site form> — <board_label>; a form has no number for the first statement of its life'
UNION ALL
SELECT 'form_no_allocation_retitles',
       (SELECT c.numbered = 'TMS-PRB-2026-0001 — Probe board' FROM fm_ctx c),
       'the app numbers the form with the service client on the same request (site-forms.actions.ts:432): form_no is watched, and the statutory reference reaches the title'
UNION ALL
SELECT 'blank_label_falls_to_board_ref',
       (SELECT c.blank_title = 'Site form — DB-PROBE-2' FROM fm_ctx c),
       'board_label is the as-found nameplate and may be blank; site_forms_board_identified guarantees board_ref (or a node), so the title falls to the schedule tag'
UNION ALL
-- F10, decided rather than accidental.
SELECT 'draft_is_open_on_its_author',
       (SELECT c.b_status = 'open' AND c.b_assignee = c.pm AND c.b_bic = c.pm AND c.b_created_by = c.pm
           AND c.b_prio = 'medium' AND c.b_src = 'draft' FROM fm_ctx c),
       'F10: a site form IS the thing its author must finish, so it is born open on them, not triage — asserted = open, never IN (triage, open); created_by is the author; priority is the literal medium'
UNION ALL
SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.b_gate = c.chain_pm AND c.b_gate <> c.pm FROM fm_ctx c),
       'A(b) / 00196:244 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the author (distributing is a management action on the source too)'
UNION ALL
SELECT 'due_date_is_the_registry_default',
       (SELECT c.b_due = c.default_due FROM fm_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +3 SITE working days from the SAST day, shutdown-pushed — set by what the record is FOR (EIR reg 7(4)), not by how long the form takes'
UNION ALL
SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.h_opened = c.hist_created AND c.h_last = c.hist_updated FROM fm_ctx c),
       '#4: opened_at = the form''s created_at and last_activity_at = its updated_at on the INSERT path (§5 keeps them on the service path)'
UNION ALL
SELECT 'submitted_is_answered',
       (SELECT c.sub_status = 'answered' AND c.sub_bic = c.sub_gate AND c.sub_src = 'submitted' FROM fm_ctx c),
       'draft → submitted maps to answered (section C): the ball passes to the gatekeeper, who distributes or voids'
UNION ALL
SELECT 'distributed_is_closed',
       (SELECT c.dist_status = 'closed' AND c.dist_closed_at IS NOT NULL AND c.dist_closed_by = c.pm
           AND c.dist_src = 'distributed' FROM fm_ctx c),
       'submitted → distributed → closed: the guard stamps closed_at on the transition at depth 2 and keeps the supplied closed_by = distributed_by'
UNION ALL
SELECT 'closed_clears_bic',
       (SELECT c.dist_status = 'closed' AND c.dist_bic IS NULL FROM fm_ctx c),
       'A(a): the item leaves every inbox on closed — anchored on the item being closed, so the row cannot pass on a missing item (Task 11 review S1)'
UNION ALL
SELECT 'born_distributed_carries_source_stamps',
       (SELECT c.bd_status = 'closed' AND c.bd_closed_at = c.hist_dist AND c.bd_closed_by = c.pm
           AND c.bd_opened = c.hist_created AND c.bd_last = c.hist_dist AND c.bd_bic IS NULL FROM fm_ctx c),
       '#4, the backfill shape: a form inserted already distributed is born closed with closed_at = distributed_at (historical), closed_by = distributed_by, opened_at = created_at'
UNION ALL
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_restamp_status = 'closed' AND c.cl_restamp_last = c.hist_dist
           AND c.cl_restamp_closed_by = c.pm AND c.cl_restamp_closed_by <> c.admin2 FROM fm_ctx c),
       'a distributed_by re-stamp on a DISTRIBUTED form fires the _upd trigger (the column is watched) but changes nothing the closed record projects — first closer wins — so the UPDATE arm returns early and last_activity_at keeps its historical value instead of the guard''s now()'
UNION ALL
SELECT 'closed_item_title_follows_the_source',
       (SELECT c.cl_renamed_status = 'closed' AND c.cl_renamed_title = 'TMS-PRB-2026-0003 — Distributed board (renamed)'
           AND c.cl_renamed_closed_by = c.pm FROM fm_ctx c),
       'the early return is keyed on what the row projects: a board rename on a CLOSED form still retitles the record (a typo corrected) and its people stay'
UNION ALL
SELECT 'born_void_carries_source_reason',
       (SELECT c.bv_status = 'void' AND c.bv_reason = 'Probe: created in error' AND c.bv_closed_at IS NULL FROM fm_ctx c),
       '#4 / #3: a form inserted already void is born void carrying the source''s reason (the guard''s void-reason check does not run on INSERT — the projection is the only reason-supplier)'
UNION ALL
-- Task 10 review, rule 2: a void row's title is frozen.
SELECT 'void_item_title_is_frozen',
       (SELECT c.bv_title = 'TMS-PRB-2026-0004 — Void board' AND c.bv_renamed_title = c.bv_title
           AND c.bv_renamed_status = 'void' AND c.bv_renamed_reason = 'Probe: created in error'
           AND c.bv_renamed_last = c.hist_updated FROM fm_ctx c),
       'a board rename on a VOID form leaves the item''s title as it was when the record was withdrawn; status and reason untouched, and the record is NOT rewritten — last_activity_at keeps its historical value instead of the guard''s now() (Task 11 review I2: rule 1''s early return never compares a void row''s title; a closed row''s title keeps following — closed_item_title_follows_the_source)'
UNION ALL
SELECT 'void_carries_reason',
       (SELECT c.vlive_status IN ('triage','open') AND c.vlive_reason IS NULL
           AND c.void_status = 'void' AND c.void_reason = 'Probe: wrong board' FROM fm_ctx c),
       'a LIVE item whose form is voided carries the form''s own reason (voidSiteFormAction writes status + reason in one statement); the exempt guard path performs no reason check at depth 2, so the projection must supply it'
UNION ALL
SELECT 'void_is_terminal',
       (SELECT c.vback_status = 'void' AND c.vback_reason = 'Probe: wrong board' AND c.vback_src = 'submitted' FROM fm_ctx c),
       'Task 4''s rule: void has no exit — a trusted-role resurrection of the source (the only actor that can) leaves the item void with its reason; source_status follows the source'
UNION ALL
SELECT 'distributed_then_void_is_void',
       (SELECT c.dv_status = 'void' AND c.dv_reason = 'Probe: issued against the wrong DB'
           AND c.dv_closed_at IS NULL AND c.dv_closed_by IS NULL AND c.dv_bic IS NULL
           AND c.dv_voided_n = 1 AND c.dv_voided_actor_null FROM fm_ctx c),
       'a manager may void a distributed form (00179:399-401; the void action admits it): closed → void on the spine with the reason, the guard''s exempt path clears closed_at / closed_by on the non-close transition, and §11 records exactly one voided event (actor NULL on the service path — Task 11 review S2)'
UNION ALL
SELECT 'ineligible_author_falls_to_triage',
       (SELECT c.cv_status = 'triage' AND c.cv_bic = c.admin2 AND c.cv_created_by = c.cv AND c.cv_gate = c.chain_pm FROM fm_ctx c),
       'the F10 flag is ELIGIBILITY, not created_by IS NOT NULL: a client-viewer author (a trusted-role insert with an explicit created_by) is not an explicit owner, so the item is born triage on the chain''s answer; created_by still records the author'
UNION ALL
SELECT 'arm_2_resolves_through_the_form_key',
       (SELECT c.cv_assignee = c.admin2 FROM fm_ctx c),
       'the ''form_action'' literal passed to resolve_mirror_assignee reaches work_item_defaults.form_action.triage_owner_id: the chain skips the ineligible author and answers arm 2'
UNION ALL
SELECT 'live_move_reruns_the_chain_through_the_form_key',
       (SELECT c.cvm_status = 'triage' AND c.cvm_project = c.proj2 AND c.cvm_assignee = c.admin3
           AND c.cvm_assignee <> c.admin2 AND c.cvm_assignee <> c.pm AND c.cvm_gate = c.chain_pm FROM fm_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''form_action'' literal — a typo key would fall to the owner; the gatekeeper is the PM chain again'
UNION ALL
-- F7 / §03 §1.2: the WHEN clause.
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_updated FROM fm_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes only as_left_status (unwatched) must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL
-- Task 8 review S1: a closed item's people are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.mvc_status = 'closed' AND c.mvc_assignee = c.admin2 AND c.mvc_gate = c.chain_pm
           AND c.mvm_status = 'closed' AND c.mvm_project = c.proj3
           AND c.mvm_assignee = c.admin2 AND c.mvm_assignee <> c.pm
           AND c.mvm_gate = c.chain_pm FROM fm_ctx c),
       'a DISTRIBUTED form moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only'
UNION ALL
-- The state machine runs BEFORE the mirror.
SELECT 'illegal_transition_leaves_the_item',
       (SELECT c.ill_uid = c.pm AND c.ill_cleared
           AND c.ill_err LIKE 'Illegal site-form transition draft -> distributed%'
           AND c.ill_sqlstate = '42501'
           AND c.ill_form_status = 'draft'
           AND c.ill_after_status = c.ill_before_status AND c.ill_before_status IN ('triage','open')
           AND c.ill_after_closed_at IS NULL AND c.ill_before_closed_at IS NULL
           AND c.ill_after_src = 'draft' FROM fm_ctx c),
       'trg_site_forms_transition (BEFORE, 00179:415) refuses draft → distributed for a signed-in owner with its own sentence at depth 1; the mirror is AFTER and never fires, so the item stays open and unclosed — never convert the mirror to BEFORE';
