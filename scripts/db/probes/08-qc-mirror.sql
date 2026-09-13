-- 08-qc-mirror.sql — Task 9: the qc_defect projection (00198 section D.4, the
-- third copy of D.1's template and the only one with TWO entry points).
-- Asserted against production inside one rolled-back transaction:
--   projects.project_qc_entry(uuid)          — the projection body (no recursion guard)
--   projects.mirror_qc_defect_work_item()    — the ENTRY-level trigger wrapper (depth guard, F2)
--   projects.mirror_qc_report_defects()      — the REPORT-level trigger wrapper (F4)
--   qc_entries_mirror_work_item_ins / _upd   — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--   qc_reports_mirror_defects                — AFTER UPDATE OF status, title ON qc_reports
--
-- The centrepiece is issue_report_projects_the_fail (F4): the scope predicate
-- — conformance = 'fail' AND the parent report's status IN ('issued','closed')
-- — spans two tables, and on the normal authoring path the entry never
-- changes: the fail verdict is written on a DRAFT report and the entry enters
-- scope when the REPORT is issued, an UPDATE on projects.qc_reports. A trigger
-- on qc_entries alone never fires there. Mutation: comment out
-- CREATE TRIGGER qc_reports_mirror_defects and every issue-path row goes red.
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/08-qc-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section D.4 existed this reported 2/27 (27 rows then; the Task 9
-- and Task 10 reviews added the rows past that count): draft_report_projects_nothing
-- and issue_report_ignores_the_rest pass VACUOUSLY (nothing projects
-- anything, so "no item" is trivially true — the fixture-quality question in
-- miniature; the scope-predicate mutation below is what makes the first one
-- non-vacuous) and every other row reads a NULL observation (a NULL `ok` is a
-- FAIL in the harness, never a coerced false). The direct call in the
-- backfill-shape block is guarded by to_regprocedure so that run reports FAIL
-- rows rather than aborting on 42883.
--
-- Walks from an empty project, never from seeded data (§12 §(h)): production
-- holds exactly one group — 11 entries, all conformance = 'na', on one issued
-- report (F4) — so a live fixture could never fail. Every fixture RAISEs
-- rather than skips: a NOTICE never reaches the Management API caller, and a
-- skipped fixture is a probe that cannot fail.
--
-- Runs as postgres with auth.uid() NULL throughout (no impersonation), which
-- is also why the report-close and the entry writes below pass
-- qc_report_children_frozen (00172:449-486, returns early on a NULL actor)
-- and qc_reports_status_guard (00172:249-263, role-only, no direction check —
-- measured live 2026-09-13: its body never mentions 'draft', so issued → draft
-- and closed → draft are LEGAL for an owner/admin/PM over PostgREST, though no
-- app action writes them; the withdrawal rows below exist because of that).
--
-- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
-- in a FROM clause (42601), and sibling parts of one statement read the
-- pre-update snapshot — so every "after" observation is a separate SELECT
-- after the write, recorded into the temp table for the final SELECT.
-- now() is fixed for the whole transaction, so "did not re-project" is
-- measured the way probes 06/07 measure it: one entry is inserted with a
-- HISTORICAL updated_at, the INSERT path copies it into last_activity_at, and
-- a projection that should not have fired would have stamped now() over it.

DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project (⇒ triage_owner_id), raises the report, authors the entries
  v_chain_pm uuid;   -- resolve_project_pm(v_proj): the oldest active org admin — the GATEKEEPER, never the author
  v_admin2   uuid;   -- arm 2 (work_item_defaults.qc_defect.triage_owner_id): distinct from every other arm's answer
  v_cv       uuid;   -- an active WM client viewer: never eligible on the probe project (F2) — authors one entry
  v_proj  uuid;
  v_proj2 uuid;   -- a second WM project: the closed-item move target (Task 8 review S1)
  v_triage_owner uuid;
  v_arm2_readback uuid;
  v_rep   uuid;   -- 'Level 3 handover QC': draft → issued → closed → issued → renamed → draft (withdrawn) → issued
  v_rep2  uuid;   -- 'Basement DB QC': the backfill shape — closed before the spine existed
  v_fail  uuid;   -- 'Earth continuity', fail/major: the plan's own fixture; later pass, then na, then fail again
  v_na    uuid;   -- 'Untested check', na: ignored at issue; then fail (second path), na (void), fail (void stays)
  v_minor uuid;   -- fail/minor → low; carries the rename check
  v_crit  uuid;   -- fail/critical → critical; the live item the withdrawal voids
  v_nosev uuid;   -- fail, NULL severity → medium; HISTORICAL stamps; the do-not-reproject sentinel
  v_cvfail uuid;  -- fail/major authored by the client viewer: the chain answers arm 2 (voided later by the withdrawal)
  v_mv    uuid;   -- a second client-viewer-authored fail on the re-issued report: closed, then MOVED (S1)
  v_pass  uuid;   -- pass on the draft report: never an obligation
  v_late  uuid;   -- fail/major INSERTed on the ISSUED report: the second path's insert half
  v_bf    uuid;   -- fail/critical on the closed report 2: projected by a DIRECT call, as the backfill would
  v_ans   uuid;   -- fail/major, moved to 'answered' ON THE SPINE: survives an entry edit and a report rename (Task 9 review)
  v_sc    uuid;   -- fail/major, CLOSED on the spine while the entry still reads fail: survives an unrelated edit
  v_cl    uuid;   -- fail/major → pass (closed) on the re-issued report: the closed-record rows (Task 10 review rule 1, Task 9 review I3)
  v_livecv uuid;  -- a client-viewer-authored LIVE fail on the re-issued report: moved to a project whose arm 2 differs (I1)
  v_draftfail uuid; -- fail INSERTed during the withdrawn (draft) window: projects at re-issue, not before
  v_admin3 uuid;  -- arm 2 on the THIRD project: distinct from admin2 and the owner, so a live move must re-run the chain to be seen
  v_proj3 uuid;   -- the live-move target (a moved item keeps its ref; two moves into one project collide on work_items_ref_unique)
  -- now() is fixed for the whole transaction, so these are exact targets.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_updated timestamptz := now() - interval '30 days';
  v_hist_issued  timestamptz := now() - interval '20 days';   -- report 1's issued_at: LATER than v_nosev's stamps (I4)
  v_bf_created   timestamptz := now() - interval '15 days';   -- report 2 keeps issued_at NULL: the entry's own stamp is the fallback (I4)
  -- What §5 computes for a qc_defect born with no usable date: A(b)'s +5
  -- site working days from the SAST day (00196:670), then the builders'
  -- shutdown push — the exact born date, not merely "after today".
  v_default_due date;
  v_draft_items  int;
  v_issued_fail  int;
  v_issued_rest  int;
  v_fi           record;   -- the fail item after issue
  v_minor_prio   text;
  v_crit_prio    text;
  v_nosev_prio   text;
  v_nosev_item   record;
  v_cvfail_item  record;
  v_na_fail      record;
  v_late_count   int;
  v_same_last    timestamptz;
  v_close_last   timestamptz;
  v_reopen_last  timestamptz;
  v_renamed      text;
  v_passed       record;
  v_pass_na      record;
  v_na_void      record;
  v_na_refail    record;
  v_refail       record;   -- the closed item after its entry crosses back INTO fail: reopened
  v_refail_ev    int;      -- status_changed events to 'open' on it
  v_ans_edit     text;     -- the answered item after an entry title edit
  v_ans_rename   text;     -- … after the report rename
  v_sc_after     text;     -- the spine-closed item after an entry title edit
  v_prio_spine   text;     -- v_late's priority after a spine-side edit
  v_prio_src     text;     -- … after an unrelated title edit on the entry
  v_wd_crit      record;
  v_wd_fail      record;
  v_wd_na        record;
  v_reissue_crit record;
  v_reissue_new  int;      -- items for the fail added during the draft window, after re-issue
  v_moved        record;   -- the closed client-viewer-authored item after its entry moved projects
  v_cl_ctid_before text;   -- the closed record's tuple identity before a severity-only edit
  v_cl_ctid_after  text;
  v_cl_prio_restamp text;
  v_cl_refiled   record;   -- after a title + severity edit on the closed entry
  v_rename2_na   text;     -- the void (N/A) item's title after a SECOND rename: frozen
  v_rename2_minor text;    -- a live item's title after it: follows
  v_livemv       record;   -- the client-viewer live item after its move
  v_bf_opened    timestamptz;
  v_bf_at_insert int;
  v_bf_before    int;
  v_bf_updated_before timestamptz;
  v_bf_updated_after  timestamptz;
  v_bf_item      record;
  v_fn_exists    boolean;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_qc_mirror', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

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

  -- F2: an active WM client viewer — ineligible on the probe project whatever
  -- their membership (client_viewer is excluded by the mirror's chain). A
  -- client viewer cannot author a QC entry through RLS (00176 write policies);
  -- postgres can, and the row is what proves the chain skips an ineligible
  -- created_by rather than handing the defect to the client.
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- Arm 2 of the mirror chain, work_item_defaults.qc_defect.triage_owner_id: an
  -- admin distinct from the owner (arm 3) and the PM-chain person (arm 4), so
  -- the 'qc_defect' literal project_qc_entry passes is load-bearing — a typo
  -- ('qc_defct') skips this arm and falls to the owner. Set BEFORE the first
  -- entry so born_triage_on_the_author also proves the author precedes this arm.
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
     SET work_item_defaults = jsonb_build_object('qc_defect', jsonb_build_object('triage_owner_id', v_admin2::text))
   WHERE project_id = v_proj;
  -- §13's validator NULLs an id with no effective role on the project; an org
  -- admin always has one (00107), but read it back rather than assume.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY['qc_defect', 'triage_owner_id'], '')::uuid INTO v_arm2_readback
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_arm2_readback IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: validate_work_item_defaults did not keep work_item_defaults.qc_defect.triage_owner_id = % (read back %)', v_admin2, v_arm2_readback;
  END IF;
  -- With no usable candidate the chain must answer arm 2 — asserted with NO
  -- candidate and with the ineligible client viewer, so the arm-2 row below
  -- measures project_qc_entry's literal, not section B (Task 7 review).
  IF projects.resolve_mirror_assignee(v_proj, 'qc_defect', NULL) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''qc_defect'', NULL) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'qc_defect', NULL), v_admin2;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj, 'qc_defect', v_cv) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''qc_defect'', <client viewer>) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'qc_defect', v_cv), v_admin2;
  END IF;

  -- The exact date §5 births a qc_defect on: A(b)'s +5 site working days from
  -- the SAST day, then the builders' shutdown push (00196 §5).
  v_default_due := projects.push_past_builders_shutdown(
    projects.add_working_days((now() AT TIME ZONE 'Africa/Johannesburg')::date, 5, v_proj, 'site'),
    v_proj);
  IF v_default_due IS NULL OR v_default_due <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: add_working_days(SAST today, 5, proj, site) answered % — the site calendar is not usable', v_default_due;
  END IF;

  -- ── Report 1, authored as a DRAFT: the normal path ─────────────────────────
  INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
  VALUES (v_proj, v_org, 'Level 3 handover QC', 'draft', v_pm) RETURNING id INTO v_rep;

  -- The verdicts are written while the report is a draft — exactly the live
  -- authoring order (F4). Seven entries: five failures across every severity
  -- value (major, minor, critical, NULL) and one client-viewer author, plus
  -- an 'na' and a 'pass' that must never become obligations.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Earth continuity', 'fail', 'major', v_pm) RETURNING id INTO v_fail;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, created_by)
  VALUES (v_rep, v_org, v_proj, 'Untested check', 'na', v_pm) RETURNING id INTO v_na;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Label missing', 'fail', 'minor', v_pm) RETURNING id INTO v_minor;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Exposed live conductor', 'fail', 'critical', v_pm) RETURNING id INTO v_crit;
  -- HISTORICAL created_at/updated_at: the backfill shape for the stamps (#4),
  -- and the sentinel for "did not re-project" — set_updated_at is BEFORE
  -- UPDATE only (00172:127), so the INSERT keeps the supplied value.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by,
                                   created_at, updated_at)
  VALUES (v_rep, v_org, v_proj, 'Unrated failure', 'fail', NULL, v_pm, v_hist_created, v_hist_updated)
  RETURNING id INTO v_nosev;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'CV-authored failure', 'fail', 'major', v_cv) RETURNING id INTO v_cvfail;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, created_by)
  VALUES (v_rep, v_org, v_proj, 'Polarity', 'pass', v_pm) RETURNING id INTO v_pass;

  SELECT count(*) INTO v_draft_items FROM projects.work_items
   WHERE qc_entry_id IN (v_fail, v_na, v_minor, v_crit, v_nosev, v_cvfail, v_pass);

  -- The path a trigger on qc_entries alone can never see (F4): the REPORT is
  -- issued, and every failed entry crosses into scope in one statement.
  -- issued_at is HISTORICAL and later than v_nosev's own stamps (I4): an
  -- item is born at issue, not pre-aged by the days the report sat in draft.
  UPDATE projects.qc_reports SET status = 'issued', issued_at = v_hist_issued, issued_by = v_pm WHERE id = v_rep;

  SELECT count(*) INTO v_issued_fail FROM projects.work_items WHERE qc_entry_id = v_fail;
  SELECT count(*) INTO v_issued_rest FROM projects.work_items WHERE qc_entry_id IN (v_na, v_pass);
  SELECT w.priority, w.source_status, w.title, w.status, w.assignee_id, w.gatekeeper_id,
         w.created_by, w.item_type, w.due_date, w.origin
    INTO v_fi
    FROM projects.work_items w WHERE w.qc_entry_id = v_fail AND w.origin = 'mirror';
  SELECT w.priority INTO v_minor_prio FROM projects.work_items w WHERE w.qc_entry_id = v_minor;
  SELECT w.priority INTO v_crit_prio  FROM projects.work_items w WHERE w.qc_entry_id = v_crit;
  SELECT w.priority INTO v_nosev_prio FROM projects.work_items w WHERE w.qc_entry_id = v_nosev;
  SELECT w.opened_at, w.last_activity_at INTO v_nosev_item
    FROM projects.work_items w WHERE w.qc_entry_id = v_nosev;
  SELECT w.assignee_id, w.status INTO v_cvfail_item
    FROM projects.work_items w WHERE w.qc_entry_id = v_cvfail;

  -- The second path, update half: an entry corrected to 'fail' while the
  -- report is already issued — the entry-level _upd trigger's job.
  UPDATE projects.qc_entries SET conformance = 'fail', severity = 'minor' WHERE id = v_na;
  SELECT count(*) AS n, min(w.status) AS status INTO v_na_fail
    FROM projects.work_items w WHERE w.qc_entry_id = v_na;

  -- The second path, insert half: a late finding added to the issued report —
  -- the entry-level _ins trigger's job (00176 leaves entries on an ISSUED
  -- report editable; only a CLOSED report freezes them).
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Late finding', 'fail', 'major', v_pm) RETURNING id INTO v_late;
  SELECT count(*) INTO v_late_count FROM projects.work_items WHERE qc_entry_id = v_late;

  -- Task 9 review, decision 1's other half: an item a human moved to
  -- 'answered' (service path here — the guard is exempt as postgres) must
  -- survive an unrelated entry edit and a report rename; the review measured
  -- the `fail → 'open'` map pulling every such item back to open on both.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Answered on the spine', 'fail', 'major', v_pm) RETURNING id INTO v_ans;
  UPDATE projects.work_items SET status = 'answered' WHERE qc_entry_id = v_ans AND origin = 'mirror';
  UPDATE projects.qc_entries SET title = 'Answered on the spine (rev)' WHERE id = v_ans;
  SELECT w.status INTO v_ans_edit FROM projects.work_items w WHERE w.qc_entry_id = v_ans;

  -- … and a defect CLOSED on the spine by its gatekeeper while the entry
  -- still reads 'fail' (source_status = 'fail'): the reopen rule keys on a
  -- CROSSING into fail, so an unrelated edit leaves it closed.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Closed on the spine', 'fail', 'major', v_pm) RETURNING id INTO v_sc;
  UPDATE projects.work_items SET status = 'closed', closed_by = v_pm WHERE qc_entry_id = v_sc AND origin = 'mirror';
  UPDATE projects.qc_entries SET title = 'Closed on the spine (rev)' WHERE id = v_sc;
  SELECT w.status INTO v_sc_after FROM projects.work_items w WHERE w.qc_entry_id = v_sc;

  -- Task 9 review I3, the honest row: a spine-side priority edit on a LIVE
  -- item lasts until the next watched source write while severity is set
  -- (the review's r1 L2 — its L3 measured that a signed-in owner CAN write
  -- priority on a mirror item; the service path is the same UPDATE).
  UPDATE projects.work_items SET priority = 'low' WHERE qc_entry_id = v_late AND origin = 'mirror';
  SELECT w.priority INTO v_prio_spine FROM projects.work_items w WHERE w.qc_entry_id = v_late;
  UPDATE projects.qc_entries SET title = 'Late finding (rev)' WHERE id = v_late;
  SELECT w.priority INTO v_prio_src FROM projects.work_items w WHERE w.qc_entry_id = v_late;

  -- An unwatched column: description is not in the _upd trigger's lists, so
  -- the projection must not fire — it would stamp last_activity_at = now()
  -- over the historical value the INSERT path kept.
  UPDATE projects.qc_entries SET description = 'Measured 0.4 Ω on the ring' WHERE id = v_nosev;
  SELECT w.last_activity_at INTO v_same_last FROM projects.work_items w WHERE w.qc_entry_id = v_nosev;

  -- issued → closed → issued: neither move crosses the scope boundary
  -- (both states are in scope), so the report-level trigger fires nothing —
  -- closing a report is not activity on its defects, and the plan's
  -- "OLD.status IS DISTINCT FROM NEW.status" would re-stamp every item.
  UPDATE projects.qc_reports SET status = 'closed' WHERE id = v_rep;
  SELECT w.last_activity_at INTO v_close_last FROM projects.work_items w WHERE w.qc_entry_id = v_nosev;
  UPDATE projects.qc_reports SET status = 'issued' WHERE id = v_rep;
  SELECT w.last_activity_at INTO v_reopen_last FROM projects.work_items w WHERE w.qc_entry_id = v_nosev;

  -- A report rename re-projects every item's title (the title embeds it).
  UPDATE projects.qc_reports SET title = 'Level 3 handover QC (rev B)' WHERE id = v_rep;
  SELECT w.title INTO v_renamed FROM projects.work_items w WHERE w.qc_entry_id = v_minor;
  SELECT w.status INTO v_ans_rename FROM projects.work_items w WHERE w.qc_entry_id = v_ans;

  -- fail → pass on the issued report: the defect was corrected. The app blanks
  -- severity with the pass (00176: "severity present iff conformance='fail'"),
  -- and the item must keep the priority it was recorded at.
  UPDATE projects.qc_entries SET conformance = 'pass', severity = NULL WHERE id = v_fail;
  SELECT w.status, w.closed_at, w.closed_by, w.priority, w.source_status INTO v_passed
    FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

  -- pass → na on a CLOSED item: 'na' maps to NULL (leave unchanged), so the
  -- item stays closed with its stamps — the guard restores closed_at/closed_by
  -- when the status does not change (00198 section C').
  UPDATE projects.qc_entries SET conformance = 'na' WHERE id = v_fail;
  SELECT w.status, w.closed_at, w.source_status INTO v_pass_na
    FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

  -- The N/A rule (controller decision, Task 9): a LIVE item whose entry is
  -- re-marked 'na' is voided with a reason — never left open for a defect the
  -- source no longer records.
  UPDATE projects.qc_entries SET conformance = 'na', severity = NULL WHERE id = v_na;
  SELECT w.status, w.void_reason, w.source_status INTO v_na_void
    FROM projects.work_items w WHERE w.qc_entry_id = v_na;

  -- void is terminal (Task 4's rule): re-marked 'fail' afterwards, the item
  -- stays void WITH its reason; a genuinely revived defect is a new entry.
  UPDATE projects.qc_entries SET conformance = 'fail', severity = 'minor' WHERE id = v_na;
  SELECT w.status, w.void_reason, w.source_status INTO v_na_refail
    FROM projects.work_items w WHERE w.qc_entry_id = v_na;

  -- Task 9 review, decision 1: a CLOSED item whose entry CROSSES INTO 'fail'
  -- (the previous verdict, source_status, was 'na') is REOPENED on its last
  -- holder, with one status_changed event. Section C still maps fail → NULL;
  -- the crossing rule in the projection decides. The priority it was
  -- recorded at is kept (I3 reads v_live before the reopen).
  UPDATE projects.qc_entries SET conformance = 'fail', severity = 'major' WHERE id = v_fail;
  SELECT w.status, w.assignee_id, w.ball_in_court_id, w.closed_at, w.priority INTO v_refail
    FROM projects.work_items w WHERE w.qc_entry_id = v_fail;
  SELECT count(*) INTO v_refail_ev FROM projects.work_item_events e
    JOIN projects.work_items w ON w.id = e.work_item_id
   WHERE w.qc_entry_id = v_fail AND e.verb = 'status_changed' AND e.to_status = 'open';

  -- Withdrawal (Task 9 review, decision 2): issued → draft is legal at the DB
  -- (role-only guard) though no app action writes it. The scope predicate
  -- gates BIRTH only: every existing item keeps its status — the triage one,
  -- the reopened one, and the N/A void with ITS reason (a void row is never
  -- re-reasoned). Nothing is voided as withdrawn.
  UPDATE projects.qc_reports SET status = 'draft' WHERE id = v_rep;
  SELECT w.status, w.void_reason INTO v_wd_crit FROM projects.work_items w WHERE w.qc_entry_id = v_crit;
  SELECT w.status, w.closed_at   INTO v_wd_fail FROM projects.work_items w WHERE w.qc_entry_id = v_fail;
  SELECT w.status, w.void_reason INTO v_wd_na   FROM projects.work_items w WHERE w.qc_entry_id = v_na;

  -- A fail found during the draft window is not yet an obligation (the
  -- report is out of scope) …
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Found during the draft cycle', 'fail', 'major', v_pm) RETURNING id INTO v_draftfail;
  -- … and the re-issue projects it, leaving the earlier items exactly as
  -- they were: no revival is needed because nothing was withdrawn.
  UPDATE projects.qc_reports SET status = 'issued' WHERE id = v_rep;
  SELECT w.status, w.void_reason INTO v_reissue_crit FROM projects.work_items w WHERE w.qc_entry_id = v_crit;
  SELECT count(*) INTO v_reissue_new FROM projects.work_items WHERE qc_entry_id = v_draftfail;

  -- Task 8 review S1: a CLOSED item's people are part of the record. The only
  -- projection that re-derives a qc_defect's people is a project MOVE, so a
  -- fresh client-viewer-authored defect on the re-issued report (arm 2 holds
  -- it — the earlier one, v_cvfail, is void since the withdrawal) is closed
  -- with a pass and its entry moved to a second project whose chain answers
  -- someone else (no work_item_defaults there: arm 3, the owner). The item
  -- moves (improvement 8); its people stay. The membership trigger
  -- re-validates both people on the new project first — both are org admins
  -- (00107), so it passes.
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_qc_mirror_2', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj2;
  IF projects.resolve_mirror_assignee(v_proj2, 'qc_defect', v_cv) IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: on the second project the chain answers % rather than arm 3''s owner % — the move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj2, 'qc_defect', v_cv), v_pm;
  END IF;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'CV-authored moved defect', 'fail', 'major', v_cv) RETURNING id INTO v_mv;
  -- No fixture RAISE on this item's birth (Task 9 review I2): a dropped _ins
  -- trigger must read as new_fail_entry_on_issued_report_projects going red,
  -- never as a fixture abort that hides every row.
  UPDATE projects.qc_entries SET conformance = 'pass', severity = NULL WHERE id = v_mv;
  UPDATE projects.qc_entries SET project_id = v_proj2 WHERE id = v_mv;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_moved
    FROM projects.work_items w WHERE w.qc_entry_id = v_mv AND w.origin = 'mirror';

  -- ── Task 10 review rule 1 / Task 9 review I3: the closed-record rows ───────
  -- A corrected defect on the re-issued report: pass → closed. Then a
  -- severity-only edit (watched, so the _upd trigger fires) changes nothing
  -- the closed record projects — the priority SET is gated on v_live — so the
  -- UPDATE arm returns early and the tuple is not rewritten (now() is fixed
  -- for the transaction, so the ctid is the signal). Then a title AND
  -- severity edit: the title changes, the UPDATE arm runs, and the closed
  -- record's priority is still not re-filed.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Corrected defect', 'fail', 'major', v_pm) RETURNING id INTO v_cl;
  UPDATE projects.qc_entries SET conformance = 'pass', severity = NULL WHERE id = v_cl;
  SELECT w.ctid::text INTO v_cl_ctid_before
    FROM projects.work_items w WHERE w.qc_entry_id = v_cl AND w.origin = 'mirror';
  UPDATE projects.qc_entries SET severity = 'critical' WHERE id = v_cl;
  SELECT w.ctid::text, w.priority INTO v_cl_ctid_after, v_cl_prio_restamp
    FROM projects.work_items w WHERE w.qc_entry_id = v_cl AND w.origin = 'mirror';
  UPDATE projects.qc_entries SET title = 'Corrected defect (rev)', severity = 'minor' WHERE id = v_cl;
  SELECT w.status, w.title, w.priority INTO v_cl_refiled
    FROM projects.work_items w WHERE w.qc_entry_id = v_cl AND w.origin = 'mirror';

  -- ── Task 10 review rule 2: a void row's title is frozen on a rename ────────
  -- v_na has been void since the N/A rule (its title carries the rev B name
  -- from the first rename); v_minor is live. A second rename retitles the
  -- live item and leaves the void one as the record of what was withdrawn.
  UPDATE projects.qc_reports SET title = 'Level 3 handover QC (rev C)' WHERE id = v_rep;
  SELECT w.title INTO v_rename2_na    FROM projects.work_items w WHERE w.qc_entry_id = v_na;
  SELECT w.title INTO v_rename2_minor FROM projects.work_items w WHERE w.qc_entry_id = v_minor;

  -- ── Task 9 review I1: a LIVE move re-runs the chain through the key ────────
  -- A third project whose arm 2 names a THIRD admin (the review's r1 L1
  -- shape): a client-viewer-authored live fail moved there resolves to
  -- admin3 — a different answer from the first project's arm 2 AND from arm
  -- 3 (the owner), so the move arm's resolver call and its literal are both
  -- load-bearing. A third project, not the second: a moved item keeps its
  -- ref and the allocator numbers per project, so a second move into proj2
  -- would collide on work_items_ref_unique (measured on the form arm).
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin besides the owner, the PM-chain person and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_qc_mirror_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('qc_defect', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'qc_defect', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'qc_defect', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'qc_defct', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'CV-authored live defect', 'fail', 'major', v_cv) RETURNING id INTO v_livecv;
  UPDATE projects.qc_entries SET project_id = v_proj3 WHERE id = v_livecv;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.qc_entry_id = v_livecv AND w.origin = 'mirror';

  -- ── Report 2: the backfill shape ───────────────────────────────────────────
  -- A failed entry on a report that was CLOSED before the spine existed: the
  -- close is written with triggers off (session_replication_role = replica,
  -- one statement), so no projection fires and the entry sits in scope with
  -- no item — exactly what section H meets. The backfill then calls
  -- project_qc_entry(id) DIRECTLY and never UPDATEs the entry, so
  -- qc_report_children_frozen (BEFORE on qc_entries) is never entered.
  INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
  VALUES (v_proj, v_org, 'Basement DB QC', 'draft', v_pm) RETURNING id INTO v_rep2;
  -- Historical stamps and NO issued_at on the report (the app never stamped
  -- it — the backfill shape): I4's GREATEST falls back to the entry's own.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by,
                                   created_at, updated_at)
  VALUES (v_rep2, v_org, v_proj, 'Bonding', 'fail', 'critical', v_pm, v_bf_created, v_bf_created) RETURNING id INTO v_bf;
  -- Counted twice: after the INSERT (a fail on a DRAFT report projects
  -- nothing — the scope predicate's report-status half, asserted in the
  -- backfill-shape row so a broken predicate reads as a FAIL there, not as a
  -- fixture abort) and after the replica-window close (the fixture RAISEs
  -- only if the window itself leaked a projection).
  SELECT count(*) INTO v_bf_at_insert FROM projects.work_items WHERE qc_entry_id = v_bf;
  EXECUTE 'SET LOCAL session_replication_role = replica';
  UPDATE projects.qc_reports SET status = 'closed' WHERE id = v_rep2;
  EXECUTE 'SET LOCAL session_replication_role = origin';
  SELECT count(*) INTO v_bf_before FROM projects.work_items WHERE qc_entry_id = v_bf;
  IF v_bf_before <> v_bf_at_insert THEN
    RAISE EXCEPTION 'fixture: the report-2 close projected % item(s) with triggers off — the replica window did not hold', v_bf_before - v_bf_at_insert;
  END IF;
  SELECT e.updated_at INTO v_bf_updated_before FROM projects.qc_entries e WHERE e.id = v_bf;
  -- Guarded so the pre-D.4 run reports a FAIL row rather than aborting (42883).
  v_fn_exists := to_regprocedure('projects.project_qc_entry(uuid)') IS NOT NULL;
  IF v_fn_exists THEN
    PERFORM projects.project_qc_entry(v_bf);
  END IF;
  SELECT w.status, w.title, w.priority, w.source_status, w.opened_at INTO v_bf_item
    FROM projects.work_items w WHERE w.qc_entry_id = v_bf AND w.origin = 'mirror';
  v_bf_opened := v_bf_item.opened_at;
  SELECT e.updated_at INTO v_bf_updated_after FROM projects.qc_entries e WHERE e.id = v_bf;

  CREATE TEMP TABLE qc_ctx(
    pm uuid, chain_pm uuid, admin2 uuid, admin3 uuid, cv uuid, proj3 uuid,
    default_due date, hist_created timestamptz, hist_updated timestamptz, hist_issued timestamptz,
    bf_created timestamptz, bf_opened timestamptz,
    refail_assignee uuid, refail_bic uuid, refail_closed_at timestamptz, refail_prio text, refail_ev int,
    ans_edit text, ans_rename text, sc_after text, prio_spine text, prio_src text,
    reissue_new int,
    cl_ctid_before text, cl_ctid_after text, cl_prio_restamp text,
    cl_refiled_status text, cl_refiled_title text, cl_refiled_prio text,
    rename2_na text, rename2_minor text,
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid,
    draft_items int, issued_fail int, issued_rest int,
    fi_priority text, fi_src text, fi_title text, fi_status text, fi_assignee uuid,
    fi_gate uuid, fi_created_by uuid, fi_type text, fi_due date, fi_origin text,
    minor_prio text, crit_prio text, nosev_prio text,
    nosev_opened timestamptz, nosev_last timestamptz,
    cvfail_assignee uuid, cvfail_status text,
    na_fail_n int, na_fail_status text, late_count int,
    same_last timestamptz, close_last timestamptz, reopen_last timestamptz,
    renamed text,
    passed_status text, passed_closed_at timestamptz, passed_closed_by uuid, passed_prio text, passed_src text,
    pass_na_status text, pass_na_closed_at timestamptz, pass_na_src text,
    na_void_status text, na_void_reason text, na_void_src text,
    na_refail_status text, na_refail_reason text, na_refail_src text,
    refail_status text,
    wd_crit_status text, wd_crit_reason text, wd_fail_status text, wd_fail_closed_at timestamptz,
    wd_na_status text, wd_na_reason text,
    reissue_crit_status text, reissue_crit_reason text,
    proj2 uuid, moved_status text, moved_project uuid, moved_assignee uuid, moved_gate uuid,
    bf_before int, bf_status text, bf_title text, bf_prio text, bf_src text,
    bf_updated_before timestamptz, bf_updated_after timestamptz) ON COMMIT DROP;
  INSERT INTO qc_ctx VALUES (
    v_pm, v_chain_pm, v_admin2, v_admin3, v_cv, v_proj3,
    v_default_due, v_hist_created, v_hist_updated, v_hist_issued,
    v_bf_created, v_bf_opened,
    v_refail.assignee_id, v_refail.ball_in_court_id, v_refail.closed_at, v_refail.priority, v_refail_ev,
    v_ans_edit, v_ans_rename, v_sc_after, v_prio_spine, v_prio_src,
    v_reissue_new,
    v_cl_ctid_before, v_cl_ctid_after, v_cl_prio_restamp,
    v_cl_refiled.status, v_cl_refiled.title, v_cl_refiled.priority,
    v_rename2_na, v_rename2_minor,
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id,
    v_draft_items, v_issued_fail, v_issued_rest,
    v_fi.priority, v_fi.source_status, v_fi.title, v_fi.status, v_fi.assignee_id,
    v_fi.gatekeeper_id, v_fi.created_by, v_fi.item_type, v_fi.due_date, v_fi.origin,
    v_minor_prio, v_crit_prio, v_nosev_prio,
    v_nosev_item.opened_at, v_nosev_item.last_activity_at,
    v_cvfail_item.assignee_id, v_cvfail_item.status,
    v_na_fail.n, v_na_fail.status, v_late_count,
    v_same_last, v_close_last, v_reopen_last,
    v_renamed,
    v_passed.status, v_passed.closed_at, v_passed.closed_by, v_passed.priority, v_passed.source_status,
    v_pass_na.status, v_pass_na.closed_at, v_pass_na.source_status,
    v_na_void.status, v_na_void.void_reason, v_na_void.source_status,
    v_na_refail.status, v_na_refail.void_reason, v_na_refail.source_status,
    v_refail.status,
    v_wd_crit.status, v_wd_crit.void_reason, v_wd_fail.status, v_wd_fail.closed_at,
    v_wd_na.status, v_wd_na.void_reason,
    v_reissue_crit.status, v_reissue_crit.void_reason,
    v_proj2, v_moved.status, v_moved.project_id, v_moved.assignee_id, v_moved.gatekeeper_id,
    v_bf_before, v_bf_item.status, v_bf_item.title, v_bf_item.priority, v_bf_item.source_status,
    v_bf_updated_before, v_bf_updated_after);
END $probe$;

SELECT 'draft_report_projects_nothing' AS probe,
       (SELECT c.draft_items = 0 FROM qc_ctx c) AS ok,
       'a fail on a DRAFT report is not yet an obligation: the scope predicate''s report-status half (vacuous before D.4; the predicate mutation makes it real)' AS detail
UNION ALL
SELECT 'issue_report_projects_the_fail',
       (SELECT c.issued_fail = 1 FROM qc_ctx c),
       'F4: issuing the REPORT is the normal path; an entry-only trigger never fires here'
UNION ALL
SELECT 'issue_report_ignores_the_rest',
       (SELECT c.issued_rest = 0 FROM qc_ctx c),
       'A(b): mirroring every issued entry manufactures ~40 items from one 40-line report — na and pass entries project nothing'
UNION ALL
SELECT 'severity_maps_to_priority',
       (SELECT c.fi_priority = 'high' AND c.minor_prio = 'low' AND c.crit_prio = 'critical' AND c.nosev_prio = 'medium'
          FROM qc_ctx c),
       '§03 §1.10: major → high, minor → low, critical → critical, NULL → medium — never a flat medium'
UNION ALL
SELECT 'source_status_is_conformance',
       (SELECT c.fi_src = 'fail' FROM qc_ctx c),
       'source_status mirrors conformance'
UNION ALL
-- Improvement 5.
SELECT 'title_carries_the_report',
       (SELECT c.fi_title = 'Earth continuity — Level 3 handover QC' FROM qc_ctx c),
       'qc_entries has no location column and its titles are checklist lines: <entry> — <report>, the template''s <thing> — <locator> shape'
UNION ALL
SELECT 'entry_pass_closes_item',
       (SELECT c.passed_status = 'closed' AND c.passed_closed_at IS NOT NULL AND c.passed_closed_by IS NULL
           AND c.passed_src = 'pass' FROM qc_ctx c),
       'fail → pass on an issued report closes the defect: closed_at stamped by the exempt guard, closed_by NULL (qc_entries has no updater column)'
UNION ALL
SELECT 'entry_fail_on_issued_report_projects',
       (SELECT c.na_fail_n = 1 AND c.na_fail_status = 'triage' FROM qc_ctx c),
       'the second path, update half: an entry corrected to fail while its report is already issued is projected by the entry-level _upd trigger'
UNION ALL
SELECT 'new_fail_entry_on_issued_report_projects',
       (SELECT c.late_count = 1 FROM qc_ctx c),
       'the second path, insert half: a late finding INSERTed on an issued report is projected by the entry-level _ins trigger'
UNION ALL
SELECT 'na_after_item_exists_voids_with_reason',
       (SELECT c.na_void_status = 'void' AND c.na_void_reason = 'marked N/A at source' AND c.na_void_src = 'na'
          FROM qc_ctx c),
       'controller decision: a live item whose entry is re-marked N/A is voided with a reason, never left open for a defect the source no longer records'
UNION ALL
SELECT 'void_is_terminal_when_remarked_fail',
       (SELECT c.na_refail_status = 'void' AND c.na_refail_reason = 'marked N/A at source' AND c.na_refail_src = 'fail'
          FROM qc_ctx c),
       'Task 4''s rule: void has no exit; an entry re-marked fail after the void stays void with its reason (source_status still follows)'
UNION ALL
SELECT 'report_rename_reprojects_titles',
       (SELECT c.renamed = 'Label missing — Level 3 handover QC (rev B)' FROM qc_ctx c),
       'the item title embeds the report title, so the report-level trigger watches title too and a rename re-projects every item of the report'
UNION ALL
SELECT 'closed_report_entry_still_projects_on_backfill_shape',
       (SELECT c.bf_before = 0 AND c.bf_status = 'triage' AND c.bf_title = 'Bonding — Basement DB QC'
           AND c.bf_prio = 'critical' AND c.bf_src = 'fail'
           AND c.bf_updated_after = c.bf_updated_before FROM qc_ctx c),
       'a closed report''s fail entry is in scope: project_qc_entry(id) called directly, as section H does, projects it and never writes the entry (qc_report_children_frozen is not entered)'
UNION ALL
SELECT 'arm_2_resolves_through_the_qc_key',
       (SELECT c.cvfail_assignee = c.admin2 AND c.cvfail_status = 'triage' FROM qc_ctx c),
       'the ''qc_defect'' literal passed to resolve_mirror_assignee reaches work_item_defaults.qc_defect.triage_owner_id: a client-viewer author is ineligible and the chain answers arm 2, born triage'
UNION ALL
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_issued FROM qc_ctx c),
       'the _upd trigger''s WHEN clause: an edit to an unwatched column (description) must not fire the projection (it would stamp last_activity_at = now() over the historical value — the issue stamp, I4)'
UNION ALL
SELECT 'report_close_does_not_reproject',
       (SELECT c.close_last = c.hist_issued AND c.reopen_last = c.hist_issued FROM qc_ctx c),
       'issued → closed → issued never crosses the scope boundary, so the report-level trigger''s WHEN fires nothing: closing a report is not activity on its defects'
UNION ALL
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'qc_defect')
       AND (SELECT c.fi_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'qc_defect') AND c.fi_origin = 'mirror'
              FROM qc_ctx c),
       'the literal ''qc_defect'' in project_qc_entry() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL
SELECT 'born_triage_on_the_author',
       (SELECT c.fi_status = 'triage' AND c.fi_assignee = c.pm AND c.fi_created_by = c.pm FROM qc_ctx c),
       '§12 §(d): created_by → the chain, and no explicit assignee ⇒ triage (§03 §1.6): the author holds the defect until someone is assigned to fix it; created_by is the entry''s author'
UNION ALL
SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.fi_gate = c.chain_pm AND c.fi_gate <> c.pm FROM qc_ctx c),
       'A(b) / 00196:241 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the entry''s author'
UNION ALL
SELECT 'due_date_is_the_registry_default',
       (SELECT c.fi_due = c.default_due FROM qc_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +5 site working days from the SAST day, shutdown-pushed'
UNION ALL
SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.nosev_opened = c.hist_issued AND c.nosev_last = c.hist_issued FROM qc_ctx c),
       '#4 / I4: opened_at = GREATEST(the entry''s created_at, the report''s issued_at) and last_activity_at = GREATEST(its updated_at, issued_at) on the INSERT path — supplied stamps, which §5 keeps on the service path (the backfill AND the live issue, which uses the service client)'
UNION ALL
SELECT 'entry_older_than_issue_is_born_at_issue',
       (SELECT c.hist_issued > c.hist_created AND c.hist_issued > c.hist_updated
           AND c.nosev_opened = c.hist_issued
           AND c.bf_opened = c.bf_created FROM qc_ctx c),
       'Task 9 review I4: an entry drafted 20 days before the report was issued is NOT born 20 days old — the item dates from the issue; a report with no issued_at (the backfill shape, report 2) falls back to the entry''s own created_at'
UNION ALL
SELECT 'pass_keeps_recorded_priority',
       (SELECT c.passed_prio = 'high' FROM qc_ctx c),
       'the app blanks severity with a pass; a NULL severity on an EXISTING item means "not stated", so the closed defect keeps the priority it was recorded at (NULL → medium is the INSERT path''s rule only)'
UNION ALL
SELECT 'pass_then_na_keeps_closed_stamps',
       (SELECT c.pass_na_status = 'closed' AND c.pass_na_closed_at = c.passed_closed_at AND c.pass_na_src = 'na'
          FROM qc_ctx c),
       'na maps to NULL (leave unchanged): a closed item whose entry is later marked N/A stays closed with its stamps — the void rule applies to LIVE items only'
UNION ALL
-- Task 9 review, decision 1: the crossing rule.
SELECT 'refail_reopens_a_closed_defect',
       (SELECT c.refail_status = 'open' AND c.refail_assignee = c.pm AND c.refail_bic = c.pm
           AND c.refail_closed_at IS NULL AND c.refail_ev = 1 AND c.refail_prio = 'high' FROM qc_ctx c),
       'a CLOSED defect whose entry crosses from na back INTO fail is reopened on its last holder (one status_changed event, closed_at cleared by the guard, the recorded priority kept); section C still maps fail → NULL — the projection''s crossing rule decides'
UNION ALL
SELECT 'answered_survives_an_unrelated_edit_and_a_rename',
       (SELECT c.ans_edit = 'answered' AND c.ans_rename = 'answered' FROM qc_ctx c),
       'an item a human moved to answered keeps it through an entry title edit and a report rename — the `fail → open` map the review measured would have pulled it back to open on both; the crossing rule touches closed items only'
UNION ALL
SELECT 'spine_closed_defect_survives_an_unrelated_edit',
       (SELECT c.sc_after = 'closed' FROM qc_ctx c),
       'a defect CLOSED on the spine while its entry still reads fail (source_status = fail) survives an unrelated title edit: only a CROSSING into fail reopens — drop the source_status clause and every such record reopens on its next edit'
UNION ALL
-- Task 9 review, decision 2: the scope predicate gates birth only.
SELECT 'report_withdrawal_keeps_live_items',
       (SELECT c.wd_crit_status = 'triage' AND c.wd_crit_reason IS NULL
           AND c.wd_fail_status = 'open'
           AND c.wd_na_status = 'void' AND c.wd_na_reason = 'marked N/A at source' FROM qc_ctx c),
       'issued → draft (legal at the DB, no app path) changes NOTHING on existing items: the triage defect stays triage, the reopened one stays open, the N/A void keeps its own reason — the first version voided them as ''report withdrawn'', which a re-issue could never undo'
UNION ALL
SELECT 'reissue_keeps_the_items_and_projects_new_fails',
       (SELECT c.reissue_crit_status = 'triage' AND c.reissue_crit_reason IS NULL AND c.reissue_new = 1 FROM qc_ctx c),
       'the re-issue leaves the earlier items exactly as they were and projects the fail added during the draft cycle — no revival needed because nothing was withdrawn'
UNION ALL
-- Task 9 review I3: priority is module-owned while severity is set.
SELECT 'spine_priority_edit_is_reverted_by_the_next_source_write',
       (SELECT c.prio_spine = 'low' AND c.prio_src = 'high' FROM qc_ctx c),
       'TRUE = transient, pinned honestly: a spine-side priority edit on a live qc_defect item lasts until the next watched source write of ANY kind while severity is non-NULL (a title edit here re-files major → high) — the module owns priority (Task 18: the Inbox''s priority control refuses item_type = qc_defect)'
UNION ALL
SELECT 'closed_item_priority_is_not_refiled',
       (SELECT c.cl_refiled_status = 'closed' AND c.cl_refiled_prio = 'high'
           AND c.cl_refiled_title = 'Corrected defect (rev) — Level 3 handover QC (rev B)' FROM qc_ctx c),
       'a title AND severity edit on a passed (closed) entry runs the UPDATE arm — the title follows — but the closed record keeps the priority it was recorded at: the priority SET is gated on v_live (I3)'
UNION ALL
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after AND c.cl_prio_restamp = 'high' FROM qc_ctx c),
       'a severity-only edit on a passed entry fires the _upd trigger (severity is watched) but changes nothing the closed record projects, so the UPDATE arm returns early and the tuple is not rewritten (same ctid) — before the early return the guard stamped last_activity_at = now() on it'
UNION ALL
-- Task 10 review, rule 2: a void row's title is frozen.
SELECT 'void_item_title_is_frozen_on_rename',
       (SELECT c.rename2_na = 'Untested check — Level 3 handover QC (rev B)'
           AND c.rename2_minor = 'Label missing — Level 3 handover QC (rev C)' FROM qc_ctx c),
       'a second report rename retitles the live items and leaves the void (N/A) item''s title as it was when the record was withdrawn'
UNION ALL
-- Task 9 review I1: the live-move arm.
SELECT 'live_move_reruns_the_chain_through_the_qc_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM qc_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''qc_defect'' literal — a typo key or a dropped v_live AND v_moved arm both leave it on admin2'
UNION ALL
-- Task 8 review S1: a closed item's people are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.moved_status = 'closed' AND c.moved_project = c.proj2
           AND c.moved_assignee = c.admin2 AND c.moved_assignee <> c.pm
           AND c.moved_gate = c.chain_pm FROM qc_ctx c),
       'a CLOSED defect moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself)';
