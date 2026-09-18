-- 17-full-rehearsal.sql — Task 17. The whole of 00202 rehearsed END TO END
-- against real production data inside ONE transaction that is rolled back:
-- every mirror, the write-back, the guard exemption, delete-to-void, the
-- backfill over the live estate, and the same run seen through a real
-- contractor's signed-in session. Nothing here is hand-written; the file is
-- assembled, mechanically, out of probes 04-16.
--
-- ⚠ GENERATED FILE. Edit the probe it came from, then re-assemble. The whole
-- transformation is four rules, listed below, and is small enough to redo by
-- hand.
--
-- Run (fixtures FIRST, then the migration, then this file):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/17-full-rehearsal.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00202_work_item_source_mirrors_and_backfill.sql
--
-- ⚠ WHY THIS IS NOT TWELVE PROBE FILES CONCATENATED. The Management API
-- returns rows from the LAST row-producing statement only (measured:
-- `SELECT 1 AS a; SELECT 2 AS b;` returns `[{"b":2}]`). A concatenation would
-- discard eleven probes SILENTLY and report the twelfth's count as the total —
-- the one test in the plan structurally incapable of failing. So the file is:
--   1. every fixture `DO $…$ … END $…$;` block, in probe order, verbatim, each
--      with its own `CREATE TEMP TABLE … ON COMMIT DROP` context table
--      (rfi_ctx, wb_ctx, sn_ctx, in_ctx, qc_ctx, di_ctx, fm_ctx, del_ctx,
--      imp_ctx, gd_ctx, rls_ctx — checked distinct across all eleven files
--      before assembly; the plan text's `d_ctx`/`f_ctx` are `di_ctx`/`fm_ctx`);
--   2. then ONE `SELECT … UNION ALL …`, the arms of every probe end to end.
-- The two impersonating probes (05b, 16) go LAST: each clears its claim (the
-- harness's rule 3), but `set_config(…, true)` is TRANSACTION-local, so every
-- postgres block that depends on the service path is run before any
-- impersonation at all.
--
-- The only edits made to the borrowed text, all mechanical:
--   - the trailing `;` is dropped from every probe's assertion but the last;
--   - a line that is exactly `UNION ALL` is dropped and the `SELECT '…'` that
--     follows it (comments in between are left where they are) is prefixed with
--     `UNION ALL `, so exactly ONE line in this file begins with `SELECT '`.
--     That is the shape check: `grep -c "^SELECT '"` must print 1;
--   - probe 13's `WITH live / floors / holders` clause is hoisted to the top of
--     the single statement, where its CTEs are visible to every arm. `live`
--     excludes projects named `_probe_%`, which is what keeps the ten other
--     probes' fixtures out of the live counts — without it `total_live_items`
--     reads forty-odd instead of 35, for a reason that has nothing to do with
--     the backfill.
--
-- ⚠ PROBE 14 IS DELIBERATELY NOT IN THIS FILE. It is the one probe whose arms
-- are estate-wide snapshots — "nothing moved since section H ran" — and in a
-- transaction where ten other probes have already added, closed, voided and
-- deleted sources that sentence is simply false. Measured 2026-09-15, all
-- three ways it goes wrong:
--   · THREE arms red for the company they keep, not for anything 00202 did:
--     `every_source_in_scope_carries_exactly_one_item` (probe 11 has DELETED an
--     RFI whose void item survives with a NULL FK, and probe 08 has re-marked a
--     failing entry `na`, so the mirror count can no longer equal the source
--     count), `live_records_are_rewritten_by_a_reprojection` (probe 09's diary
--     items are live and probe 14's re-run loop has no diary arm, so they keep
--     their ctid) and `one_item_per_source_row` / `a_reprojection_changes_no_
--     column_value` depending on which fixtures are present.
--   · Worse, it makes the whole rehearsal NON-DETERMINISTIC. Probe 14 inserts
--     a deliberate `origin='split'` row picked by `ORDER BY w.id LIMIT 1` over
--     every rfi mirror item; `id` is a uuid, so in the assembly that lands on
--     an arbitrary item — sometimes one of probe 04's fixtures. Probe 04's
--     `reprojection_kept_the_status` arm reads
--     `(SELECT w.status FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id =
--     c.rfi)` with no `origin` predicate, so the split makes it a two-row
--     scalar subquery and the ENTIRE run dies with
--     `21000: more than one row returned by a subquery used as an expression`
--     — no assertion rows at all, exit 5. That is what a first assembly of all
--     twelve probes actually did.
--   · Rewriting those arms to survive the company would make them assert less
--     than they do standing alone, which is the opposite of the point.
-- So probe 14 is run as its own rehearsal, on the same --with stack, exactly
-- the way the four stateless probes are:
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/14-idempotency.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00202_work_item_source_mirrors_and_backfill.sql
-- (Two latent nits it surfaced in probes that are otherwise fine standing
-- alone, both PATCHED rather than merely recorded — `0b657df`: probe 04's
-- `reprojection_kept_the_status` and probe 05's `closed_item_still_exists`
-- identified "the item for this source" by `rfi_id` alone, with no
-- `origin = 'mirror'` predicate. Nothing in production can put a second row
-- there — only a probe can, and probe 14's `origin='split'` row is what did —
-- so both arms now say `origin = 'mirror'`, and they are safe in any company
-- rather than only while probe 14 is kept out of the assembly.)
--
-- Expected: 266 rows, all PASS — 04:26 05:22 06:25 07:39 08:35 09:23 10:26
-- 11:15 13:30 05b:9 16:16. If the printed `assertions seen:` list is shorter
-- than 266 names, an arm was lost in the assembly: READ THE LIST, NOT THE
-- TOTAL. The proof that the assembly discards nothing is Task 17 Step 4 — break
-- one arm in the middle of the file and EXACTLY ONE row must red while the
-- other 265 still report. Measured 2026-09-15 with probe 06's
-- `gatekeeper_is_pm_not_raiser` expectation flipped from `c.pm` to `c.ctr`:
-- 265/266, that row alone red.

-- ══ fixtures from 04-rfi-mirror.sql ═════════════════════════════════════════
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project, closes the born-closed RFI
  v_other uuid;   -- a contractor: raises both RFIs (12 of 15 live RFIs were raised by contractors)
  v_proj  uuid;
  v_rfi   uuid;
  v_closed_rfi uuid;
  -- Historical stamps for the born-closed RFI. now() is fixed for the whole
  -- transaction, so these are exact equality targets, not approximations.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_closed  timestamptz := now() - interval '20 days';
  v_after_insert  record;
  v_after_assign  record;
  v_after_respond record;
  v_closed_item   record;
  v_closed_last_activity timestamptz;
  v_cv        uuid;   -- an active WM client viewer: never eligible on the probe project (F2)
  v_chain_pm  uuid;   -- resolve_project_pm(v_proj): the oldest active org admin (F3/F4)
  v_admin2    uuid;   -- a second active org admin: the un-triage target, distinct from every chain answer
  v_triage_owner uuid;
  v_cv_rfi    uuid;
  v_after_cv   record;
  v_after_same record;
  v_cv_item    record;
  v_redate     record;
  v_closed_people record;   -- the born-closed item's people after a post-close source reassignment (Task 8 review S1)
  v_admin3    uuid;   -- arm 2 on the THIRD project: distinct from arm 1b's chain_pm, admin2 and the owner, so a live move must re-run the chain to be seen
  v_proj3     uuid;   -- the live-move target (a moved item keeps its ref; two moves into one project collide on work_items_ref_unique)
  v_livemv    record; -- the client-viewer-named RFI's item, re-pointed at the viewer and then moved
  v_livemv_err text;  -- the move's error, if any: a dropped move arm leaves the raiser as gatekeeper on a project he is not on, and the membership trigger refuses the move
  v_cl_ctid_before text;   -- the born-closed record's tuple identity before an unrelated watched edit (Task 10 review, rule 1)
  v_cl_restamp     record; -- …and its ctid / last_activity_at / closed_by after a closed_by re-stamp on the source
  v_void_rfi   uuid;       -- a fourth RFI, voided ON THE SPINE while the source stays alive (rule 2, via Task 14)
  v_void_at    record;     -- the item as the void left it: title + ctid
  v_void_ren1  record;     -- after a source RENAME alone — rule 1 must return early, so the tuple is not even rewritten
  v_void_ren2  record;     -- after a rename PAIRED with a status edit — the arm runs, and rule 2 freezes the title
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  SELECT u.user_id INTO v_other FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'contractor' AND u.is_active
     AND u.user_id <> v_pm
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active contractor in user_organisations (12 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rfi_mirror', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has NO effective role on a project they are not a
  -- member of (00107: only owner/admin/project_manager "always win"; everyone
  -- else falls back to project_members). Without this row the raiser is
  -- ineligible, the gatekeeper falls back to the PM, and gatekeeper_is_the_raiser
  -- would fail for a fixture reason. project_members.organisation_id is NOT NULL.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_other, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_other) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_other);
  END IF;

  -- The assignee chain (no explicit, no per-project defaults on a fresh
  -- settings row) ends in 00195's PM chain: no project PM, no org PM, so the
  -- oldest active org admin. That is never the contractor — asserted here so
  -- assignee_is_not_the_gatekeeper below measures the mirror, not the fixture.
  IF projects.resolve_project_pm(v_proj) IS NULL THEN
    RAISE EXCEPTION 'fixture: the probe project resolves no PM — WM-Consulting has lost its owner/admins';
  END IF;
  IF projects.resolve_project_pm(v_proj) = v_other THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the contractor (%), so assignee and gatekeeper would coincide for a fixture reason', v_other;
  END IF;
  v_chain_pm := projects.resolve_project_pm(v_proj);

  -- Task 5 review F3 + F4, one fixture. F4: resolver arm 1b
  -- (project_settings.default_rfi_assignee_id) must DECIDE the born assignee,
  -- so the 'rfi' literal project_rfi passes is load-bearing — a typo ('rfl')
  -- skips arm 1b and falls to the triage owner, who must therefore be a
  -- DIFFERENT person (ensure_project_settings_row seeds it as created_by, the
  -- owner). F3: under the owner default the gatekeeper is the raiser; a
  -- gatekeeper that fell back to the PM chain must COINCIDE with the assignee
  -- so assignee_is_not_the_gatekeeper and bic_moves_to_gatekeeper can go red
  -- — hence the default is exactly resolve_project_pm(v_proj). (The review's
  -- own fixture set triage_owner_id to that person instead; with arm 1b also
  -- pointing there the F4 row could never fail, so the two are reconciled
  -- this way.)
  IF v_chain_pm = v_pm THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the owner (%), who is also the triage owner — arm 1b and the triage-owner arm would answer alike', v_pm;
  END IF;
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded triage_owner_id = % (expected created_by = the owner %)', v_triage_owner, v_pm;
  END IF;
  UPDATE projects.project_settings SET default_rfi_assignee_id = v_chain_pm WHERE project_id = v_proj;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row did not seed a settings row for the probe project';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_chain_pm) THEN
    RAISE EXCEPTION 'fixture: the PM-chain person (%) is not eligible on the probe project', v_chain_pm;
  END IF;

  -- The un-triage target: eligible (an org admin always wins, 00107) and
  -- DIFFERENT from both the arm-1b answer and the triage-owner fallback, so
  -- source_assignment_untriages_item measures the flag whichever arm answered.
  SELECT u.user_id INTO v_admin2 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other, v_chain_pm)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin2 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin besides the PM-chain person (7 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin2) THEN
    RAISE EXCEPTION 'fixture: the second admin (%) is not eligible on the probe project', v_admin2;
  END IF;

  -- F2: an active WM client viewer — ineligible on the probe project whatever
  -- their membership (client_viewer is excluded by the mirror's chain).
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- Raised by the contractor, with NO assignee and a due date of TODAY — the
  -- exact live shape of RFI "Drawings" (created and due 2026-07-23).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, due_date)
  VALUES (v_proj, v_org, 'Probe RFI', 'body', 'high', 'open', v_other, CURRENT_DATE)
  RETURNING id INTO v_rfi;

  SELECT w.id, w.item_type, w.title, w.priority, w.status, w.source_status,
         w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date, w.origin,
         w.opened_at, w.closed_at, w.closed_by
    INTO v_after_insert
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- F2 (a): assigned at the source to an INELIGIBLE person. The un-triage flag
  -- is "eligible AND different from what the item holds"; a client viewer is
  -- not eligible, so the item stays in triage on the chain's answer.
  UPDATE projects.rfis SET assigned_to = v_cv WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_after_cv
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- F2 (b): assigned at the source to EXACTLY what the item already holds —
  -- the shape section E's write-back produces for a triage item. Eligible,
  -- but not different: the item stays in triage. (The CURRENT holder, read
  -- back, not a fixture guess at it — so this row measures the flag, not
  -- which chain arm answered.)
  UPDATE projects.rfis SET assigned_to = v_after_cv.assignee_id WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_after_same
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- A source-side assignment to an ELIGIBLE, DIFFERENT person (the RFI page's
  -- own assign control) UN-TRIAGES the item (decided 2026-09-13, Task 4
  -- review carry-forward 2; flag revised by the Task 5 review, F2).
  UPDATE projects.rfis SET assigned_to = v_admin2 WHERE id = v_rfi;

  SELECT w.status, w.assignee_id INTO v_after_assign
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- Push-back from the source. This probe runs as postgres (auth.uid() NULL),
  -- which is the guard's SERVICE path — so this UPDATE cannot be refused here
  -- whatever the guard says. F8's evidence is probe 05b (Task 5½), which does
  -- the same thing as a signed-in contractor.
  UPDATE projects.rfis SET status = 'responded' WHERE id = v_rfi;

  SELECT w.status, w.ball_in_court_id INTO v_after_respond
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- A second projection through a column in the UPDATE OF list that does NOT
  -- change status. If the existing-row lookup were wrong the INSERT arm would
  -- run again: with the explicit ON CONFLICT target it is swallowed (and the
  -- status push-back below is lost); with no ON CONFLICT it is 23505 on
  -- work_items_src_rfi_uidx. Either way there is never a second item while
  -- that index exists — which is F6's whole point.
  UPDATE projects.rfis SET priority = 'low' WHERE id = v_rfi;

  -- A BORN-CLOSED source with historical stamps — the shape of the 6 closed
  -- RFIs the backfill will project (#4). On the service path §5 keeps a
  -- supplied opened_at (00196:629-636) and there is no guard on INSERT, so
  -- what the projection supplies is what the row carries. updated_at is set
  -- explicitly too, so last_activity_at has a value a re-projection would
  -- visibly disturb (see the same-value write below).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by,
                             created_at, updated_at)
  VALUES (v_proj, v_org, 'Probe closed RFI', 'body', 'low', 'closed', v_other,
          v_hist_closed, v_pm, v_hist_created, v_hist_closed)
  RETURNING id INTO v_closed_rfi;

  SELECT w.status, w.opened_at, w.closed_at, w.closed_by, w.due_date INTO v_closed_item
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- A full-row save that changes only the description: every watched column
  -- is in the SET list with its old value. The _upd trigger's column list
  -- admits it; only the WHEN clause stops it firing. If it fired, the UPDATE
  -- arm would stamp last_activity_at = now() over the historical value.
  UPDATE projects.rfis
     SET description = 'edited', subject = subject, priority = priority,
         status = status, due_date = due_date, assigned_to = assigned_to
   WHERE id = v_closed_rfi;

  SELECT w.last_activity_at INTO v_closed_last_activity
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- F1: a source RE-DATE. due_date is read on INSERT only — the spine owns the
  -- due date once the item exists (improvement 11 is spine → source only) —
  -- so it is no longer in the _upd trigger's lists and this must not fire a
  -- projection at all: neither the item's due_date nor its historical
  -- last_activity_at moves.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 40 WHERE id = v_closed_rfi;
  SELECT w.due_date, w.last_activity_at INTO v_redate
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- A source reassignment AFTER the close (the RFI page's assign control on
  -- a closed RFI — nothing stops it): the closed item's people are part of
  -- the record and must not follow (Task 8 review S1). v_admin2 is eligible
  -- and different from what the item holds (arm 1b's answer), so without the
  -- rule the forward read would move assignee_id here.
  UPDATE projects.rfis SET assigned_to = v_admin2 WHERE id = v_closed_rfi;
  SELECT w.status, w.assignee_id, w.gatekeeper_id INTO v_closed_people
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- Task 10 review, rule 1 (via Task 13): a closed_by RE-STAMP on the closed
  -- source — watched, so the _upd trigger fires — changes nothing the closed
  -- record projects (first closer wins: closed_by = COALESCE(the item's, the
  -- source's)), so the UPDATE arm must return early and leave the tuple
  -- alone. Measured by ctid AND by the historical last_activity_at the INSERT
  -- path kept: without the rule the arm rewrote the tuple and stamped now()
  -- over it — the same signal same_value_write_does_not_reproject reads.
  SELECT w.ctid::text INTO v_cl_ctid_before
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';
  UPDATE projects.rfis SET closed_by = v_chain_pm WHERE id = v_closed_rfi;
  SELECT w.ctid::text AS ctid_after, w.last_activity_at, w.closed_by, w.status INTO v_cl_restamp
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- F2 (c): BORN with an ineligible explicit assignee. Nobody eligible was
  -- named, so §03 §1.6 says triage, on the chain's answer (arm 1b here).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, assigned_to)
  VALUES (v_proj, v_org, 'Probe CV RFI', 'body', 'high', 'open', v_other, v_cv)
  RETURNING id INTO v_cv_rfi;
  SELECT w.status, w.assignee_id INTO v_cv_item
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';

  -- ── Task 9 review I1 (via Task 12): a LIVE move re-runs the chain ─────────
  -- A THIRD project whose arm 2 (work_item_defaults.rfi.triage_owner_id)
  -- names a THIRD admin — distinct from arm 1b's answer on the first project
  -- (chain_pm), from admin2 and from the owner (arm 3) — so the move arm's
  -- resolver call and its 'rfi' literal are both load-bearing: a typo key
  -- falls to the owner (proj3's triage owner), a dropped `ELSIF v_moved` arm
  -- keeps chain_pm. The moved RFI must name nobody ELIGIBLE at move time, or
  -- arm 1 answers on the new project too: section E wrote arm 1b's answer
  -- back to rfis.assigned_to at birth, so the source is re-pointed at the
  -- client viewer first (a later source edit naming an ineligible person
  -- stays on the source and moves nothing on the spine — improvement 7,
  -- deviation 11; asserted so the row measures the move). A fresh third
  -- project: a moved item keeps its ref and the allocator numbers per
  -- project (deviation 20).
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin besides the PM-chain person and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rfi_mirror_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('rfi', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'rfi', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'rfi', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'rfl', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  UPDATE projects.rfis SET assigned_to = v_cv WHERE id = v_cv_rfi;
  SELECT w.status, w.assignee_id INTO v_livemv
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';
  IF v_livemv.status <> 'triage' OR v_livemv.assignee_id IS DISTINCT FROM v_cv_item.assignee_id THEN
    RAISE EXCEPTION 'fixture: re-pointing the source at the client viewer moved the item (% on %) — the live-move row would measure that, not the move',
      v_livemv.status, v_livemv.assignee_id;
  END IF;
  -- The move itself, error captured: with the move arm dropped the gatekeeper
  -- stays the raiser (a contractor who is NOT on proj3) and item 2's
  -- membership trigger refuses the whole UPDATE with its sentence — captured
  -- so that mutation reads as this row going red, not as the probe aborting.
  BEGIN
    UPDATE projects.rfis SET project_id = v_proj3 WHERE id = v_cv_rfi;
    v_livemv_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_livemv_err = MESSAGE_TEXT;
  END;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';

  -- ── Rule 2 (Task 10 review; landed in D.1 by Task 14): a VOID row's title is
  --    FROZEN, while a closed row keeps following the source ────────────────
  -- The case is the SPINE-side void with the source still alive: a person
  -- voids the ITEM with a reason (§03 §1.7), the RFI lives on, and the record
  -- must keep saying what it said when it was voided. Section F's
  -- delete-to-void cannot express this — it nulls rfi_id, which puts the row
  -- beyond project_rfi() forever.
  --   1. a source RENAME alone: rule 1's early return fires (a void row's
  --      title is never compared), so the tuple is not even rewritten;
  --   2. a rename PAIRED with a status edit: source_status moves, rule 1
  --      cannot return, the UPDATE arm runs — and everything it projects
  --      follows the source EXCEPT the title. source_status is asserted below
  --      precisely so this row cannot pass by the arm never running.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe VOID RFI', 'body', 'medium', 'open', v_other)
  RETURNING id INTO v_void_rfi;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, source still live'
   WHERE rfi_id = v_void_rfi AND origin = 'mirror';
  SELECT w.title, w.ctid::text AS ctid INTO v_void_at
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';
  IF v_void_at.title IS DISTINCT FROM 'Probe VOID RFI' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "Probe VOID RFI" (got %)', v_void_at.title;
  END IF;

  UPDATE projects.rfis SET subject = 'Renamed once' WHERE id = v_void_rfi;
  SELECT w.title, w.ctid::text AS ctid INTO v_void_ren1
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';

  UPDATE projects.rfis SET subject = 'Renamed twice', status = 'responded'
   WHERE id = v_void_rfi;
  SELECT w.title, w.status, w.source_status, w.void_reason INTO v_void_ren2
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';

  CREATE TEMP TABLE rfi_ctx(
    rfi uuid, closed_rfi uuid, proj uuid, pm uuid, other uuid,
    ins_status text, ins_bic uuid, ins_assignee uuid, ins_gate uuid,
    ins_due date, ins_title text, ins_priority text, ins_source_status text, ins_type text,
    ins_opened_at timestamptz,
    assign_status text, assign_assignee uuid,
    resp_status text, resp_bic uuid,
    closed_status text, closed_opened_at timestamptz, closed_closed_at timestamptz, closed_closed_by uuid,
    closed_last_activity timestamptz, hist_created timestamptz, hist_closed timestamptz,
    chain_pm uuid, admin2 uuid, cv uuid, cv_rfi uuid,
    cv_assign_status text, cv_assign_assignee uuid,
    same_status text, same_assignee uuid,
    closed_due_before date, redate_due date, redate_last_activity timestamptz,
    cv_status text, cv_assignee uuid,
    closed_people_status text, closed_people_assignee uuid, closed_people_gate uuid,
    proj3 uuid, admin3 uuid,
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid, livemv_err text,
    cl_ctid_before text, cl_ctid_after text, cl_restamp_last_activity timestamptz,
    cl_restamp_closed_by uuid, cl_restamp_status text,
    void_rfi uuid, void_title_at_void text, void_ctid_at_void text,
    void_title_ren1 text, void_ctid_ren1 text,
    void_title_ren2 text, void_status_ren2 text, void_source_status_ren2 text,
    void_reason_ren2 text)
    ON COMMIT DROP;
  INSERT INTO rfi_ctx VALUES (
    v_rfi, v_closed_rfi, v_proj, v_pm, v_other,
    v_after_insert.status, v_after_insert.ball_in_court_id, v_after_insert.assignee_id,
    v_after_insert.gatekeeper_id, v_after_insert.due_date, v_after_insert.title,
    v_after_insert.priority, v_after_insert.source_status, v_after_insert.item_type,
    v_after_insert.opened_at,
    v_after_assign.status, v_after_assign.assignee_id,
    v_after_respond.status, v_after_respond.ball_in_court_id,
    v_closed_item.status, v_closed_item.opened_at, v_closed_item.closed_at, v_closed_item.closed_by,
    v_closed_last_activity, v_hist_created, v_hist_closed,
    v_chain_pm, v_admin2, v_cv, v_cv_rfi,
    v_after_cv.status, v_after_cv.assignee_id,
    v_after_same.status, v_after_same.assignee_id,
    v_closed_item.due_date, v_redate.due_date, v_redate.last_activity_at,
    v_cv_item.status, v_cv_item.assignee_id,
    v_closed_people.status, v_closed_people.assignee_id, v_closed_people.gatekeeper_id,
    v_proj3, v_admin3,
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id, v_livemv_err,
    v_cl_ctid_before, v_cl_restamp.ctid_after, v_cl_restamp.last_activity_at,
    v_cl_restamp.closed_by, v_cl_restamp.status,
    v_void_rfi, v_void_at.title, v_void_at.ctid,
    v_void_ren1.title, v_void_ren1.ctid,
    v_void_ren2.title, v_void_ren2.status, v_void_ren2.source_status,
    v_void_ren2.void_reason);
END $probe$;

-- ══ fixtures from 05-writeback.sql ══════════════════════════════════════════
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project, so ensure_project_settings_row makes them the triage owner
  v_other uuid;   -- an active org admin: eligible on any org project with no project_members row (00107)
  v_third uuid;   -- a second active org admin: the spine reassign target, distinct from every chain answer
  v_proj  uuid;
  v_triage_owner uuid;
  -- (a)/(b)/(c): the task's three rules
  v_rfi uuid; v_closed uuid;
  v_a1 uuid; v_d1 date; v_a2 uuid; v_d2 date;
  v_ins_status text; v_ins_assignee uuid; v_ins_due date;
  v_unrel_status text; v_unrel_assignee uuid;
  v_untriage_assignee uuid; v_untriage_source uuid;
  v_upd_before bigint; v_upd_after bigint;
  v_after_src_redate_due date;
  v_closed_assignee uuid; v_closed_due date; v_closed_updated_at timestamptz;
  v_hist timestamptz := now() - interval '20 days';
  -- the round trip
  v_rt uuid;
  v_rt_born_status text;
  v_rt_source_after_reassign uuid; v_rt_item_after_reassign uuid; v_rt_item_after_edit uuid;
  -- the reopen shape: an OPEN item on a CLOSED source
  v_reopen uuid; v_reopen_item uuid; v_reopen_source_assignee uuid; v_reopen_item_status text;
  -- the spine-closed shape: a CLOSED item on a still-OPEN source
  v_sc uuid; v_sc_item uuid; v_sc_due_before date; v_sc_due_after date; v_sc_item_status text;
  -- the wrapper's depth guard, observed as work_items tuple updates per spine statement
  v_wi_upd_before bigint; v_wi_upd_after bigint;
  -- the snag arm
  v_snag uuid; v_snag_item uuid; v_snag_item_assignee uuid; v_snag_item_status text;
  v_snag_a1 uuid; v_snag_a2 uuid; v_snag_a3 uuid;
  v_snag_so uuid; v_snag_so_item uuid; v_snag_so_status text; v_snag_so_a_insert uuid; v_snag_so_a_reassign uuid;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  -- Admins, not contractors: an org-level contractor has NO effective role on a
  -- project they are not a member of (00107), so item 2's membership trigger
  -- would refuse the spine reassign for a fixture reason. Owner/admin always win.
  SELECT u.user_id INTO v_other FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active AND u.user_id <> v_pm
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active admin in user_organisations (7 on 2026-09-13)';
  END IF;
  SELECT u.user_id INTO v_third FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_third IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin (7 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_writeback', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  IF NOT projects.work_item_person_eligible(v_proj, v_other)
     OR NOT projects.work_item_person_eligible(v_proj, v_third) THEN
    RAISE EXCEPTION 'fixture: an admin (% / %) is not eligible on the probe project', v_other, v_third;
  END IF;
  -- The chain's answer for an RFI raised with no assignee on a fresh settings
  -- row: no explicit, no default_rfi_assignee_id, no per-type default, so the
  -- project triage owner — seeded as created_by, the owner. Read back, not
  -- assumed, so triage_holder_is_written_back measures the write-back and not
  -- the seeding.
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS NULL OR NOT projects.work_item_person_eligible(v_proj, v_triage_owner) THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded no eligible triage_owner_id (got %)', v_triage_owner;
  END IF;
  IF v_triage_owner IN (v_other, v_third) THEN
    RAISE EXCEPTION 'fixture: the triage owner (%) coincides with a reassign target', v_triage_owner;
  END IF;

  -- ── (a) raised with NO assignee: the resolved holder must reach rfis.assigned_to
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe writeback', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi;

  SELECT r.assigned_to, r.due_date INTO v_a1, v_d1 FROM projects.rfis r WHERE r.id = v_rfi;
  SELECT w.status, w.assignee_id, w.due_date INTO v_ins_status, v_ins_assignee, v_ins_due
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- Inertness: the write-back's value now sits in rfis.assigned_to. An
  -- unrelated source edit re-projects; the item must stay in triage on the same
  -- holder (D.1's un-triage flag is "eligible AND distinct from what the item
  -- holds", and the source now names exactly what the item holds).
  UPDATE projects.rfis SET priority = 'high' WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_unrel_status, v_unrel_assignee
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- Write amplification, measured. A source-side assign to an eligible,
  -- different person un-triages the item (probe 04) and CHANGES its assignee,
  -- so the write-back's _upd trigger fires — and finds the source already
  -- naming that person. The value predicate must write nothing: exactly ONE
  -- tuple update on projects.rfis for this statement (the client's own).
  -- Without the predicate the write-back rewrites the row with its own values
  -- (2 updates) and rfis_updated_at bumps updated_at for nothing.
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_upd_before
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'rfis';
  UPDATE projects.rfis SET assigned_to = v_other WHERE id = v_rfi;
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_upd_after
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'rfis';
  SELECT w.assignee_id INTO v_untriage_assignee
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';
  SELECT r.assigned_to INTO v_untriage_source FROM projects.rfis r WHERE r.id = v_rfi;

  -- ── (b) reassign + re-date on the spine ⇒ both reach the source.
  -- Measured on projects.work_items as well: ONE tuple update for this
  -- statement. The write-back's UPDATE on rfis fires rfis_mirror_work_item_upd
  -- (assigned_to moved), whose wrapper runs at depth 2 and must return before
  -- project_rfi() — otherwise the spine's own write is re-projected back over
  -- itself (a second work_items update, last_activity_at re-stamped, §11
  -- re-entered). That extra hop is the wrapper's depth guard's only observable
  -- while the values converge, so it is what pins the guard (Step 7, G0 alone).
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_wi_upd_before
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'work_items';
  UPDATE projects.work_items
     SET assignee_id = v_third, due_date = CURRENT_DATE + 21
   WHERE rfi_id = v_rfi AND origin = 'mirror';
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_wi_upd_after
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'work_items';

  SELECT r.assigned_to, r.due_date INTO v_a2, v_d2 FROM projects.rfis r WHERE r.id = v_rfi;

  -- A later SOURCE re-date: due_date is not in the _upd trigger's lists (Task 5
  -- review F1), so this fires no projection and the spine's date stays. The
  -- source now disagrees with the spine — improvement 11 is spine → source
  -- only, by design; the RFI page's own re-date control is item 4's to point
  -- at the spine.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 40 WHERE id = v_rfi;
  SELECT w.due_date INTO v_after_src_redate_due
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- ── (c) a CLOSED record must not acquire an assignee it never had. Inserted
  -- with a historical updated_at so that ANY write — even a same-value one —
  -- is visible as a bump to now().
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by,
                             created_at, updated_at)
  VALUES (v_proj, v_org, 'Probe closed', 'body', 'medium', 'closed', v_pm, v_hist, v_pm,
          v_hist - interval '10 days', v_hist)
  RETURNING id INTO v_closed;

  SELECT r.assigned_to, r.due_date, r.updated_at
    INTO v_closed_assignee, v_closed_due, v_closed_updated_at
    FROM projects.rfis r WHERE r.id = v_closed;

  -- ── The ROUND TRIP (Task 5 review, pA case 2). Raised WITH an explicit,
  -- eligible assignee (the owner), so D.1's UPDATE arm will keep preferring the
  -- source's name over the spine's holder. A spine reassign must reach the
  -- source, so that the next unrelated source edit re-projects the SAME person
  -- and the reassignment survives. Without the write-back it reverts.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, assigned_to)
  VALUES (v_proj, v_org, 'Probe round trip', 'body', 'medium', 'open', v_pm, v_pm)
  RETURNING id INTO v_rt;
  SELECT w.status INTO v_rt_born_status
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';
  IF v_rt_born_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'fixture: the round-trip RFI was born % (expected open — an explicit eligible assignee)', v_rt_born_status;
  END IF;

  UPDATE projects.work_items SET assignee_id = v_other
   WHERE rfi_id = v_rt AND origin = 'mirror';
  SELECT r.assigned_to INTO v_rt_source_after_reassign FROM projects.rfis r WHERE r.id = v_rt;
  SELECT w.assignee_id INTO v_rt_item_after_reassign
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';

  UPDATE projects.rfis SET priority = 'low' WHERE id = v_rt;   -- unrelated, but watched: re-projects
  SELECT w.assignee_id INTO v_rt_item_after_edit
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';

  -- ── The REOPEN shape: an OPEN item on a CLOSED source. A closed RFI's mirror
  -- is born closed; the spine reopens it (closed → open is legal, §12 (c)) while
  -- the source stays closed; then a spine reassign fires the write-back with an
  -- open item — and the SOURCE-status predicate is the only thing between that
  -- reassign and an assignee stamped on a closed RFI.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by)
  VALUES (v_proj, v_org, 'Probe reopen', 'body', 'medium', 'closed', v_pm, now(), v_pm)
  RETURNING id INTO v_reopen;
  SELECT w.id INTO v_reopen_item
    FROM projects.work_items w WHERE w.rfi_id = v_reopen AND w.origin = 'mirror';
  IF v_reopen_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the closed RFI projected no mirror item (section D)';
  END IF;
  UPDATE projects.work_items SET status = 'open' WHERE id = v_reopen_item;
  UPDATE projects.work_items SET assignee_id = v_other WHERE id = v_reopen_item;
  SELECT w.status INTO v_reopen_item_status FROM projects.work_items w WHERE w.id = v_reopen_item;
  SELECT r.assigned_to INTO v_reopen_source_assignee FROM projects.rfis r WHERE r.id = v_reopen;

  -- ── The SPINE-CLOSED shape: a CLOSED item on a still-OPEN source. Nothing in
  -- Q1 writes status back to a source, so an item the gatekeeper closes on the
  -- spine sits closed over an RFI that is still 'open' at the source until
  -- someone closes it there. §12 (a4) lets the project team re-date a closed
  -- item, and the source-status predicate admits the open source — so the
  -- ITEM-status rule (`NEW.status IN ('closed','void') → RETURN`) is the only
  -- thing between that re-date and a new deadline on a record that is finished.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe spine-closed', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_sc;
  SELECT w.id INTO v_sc_item
    FROM projects.work_items w WHERE w.rfi_id = v_sc AND w.origin = 'mirror';
  IF v_sc_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the open RFI projected no mirror item (section D)';
  END IF;
  SELECT r.due_date INTO v_sc_due_before FROM projects.rfis r WHERE r.id = v_sc;
  -- A precondition, not the verdict: the write-back's INSERT arm has already
  -- put the spine's computed date on the source. Raised here so the row below
  -- is about the item-status rule alone.
  IF v_sc_due_before IS NULL THEN
    RAISE EXCEPTION 'fixture: the spine-closed RFI carries no due_date after projection — the write-back''s INSERT arm should have written the computed date';
  END IF;
  UPDATE projects.work_items SET status = 'closed' WHERE id = v_sc_item;   -- service path: §12 stamps closed_at
  UPDATE projects.work_items SET due_date = CURRENT_DATE + 30 WHERE id = v_sc_item;
  SELECT w.status INTO v_sc_item_status FROM projects.work_items w WHERE w.id = v_sc_item;
  SELECT r.due_date INTO v_sc_due_after FROM projects.rfis r WHERE r.id = v_sc;

  -- ── The SNAG arm. field.snags has no due_date column (00004:10-31), so
  -- assignment only. Section D.2's snags_mirror_work_item_ins projects the
  -- item on this INSERT (born TRIAGE on the raiser — the owner here, eligible
  -- with no assigned_to), and this write-back fires on that projection's
  -- INSERT and SKIPS it (controller decision, Task 7 review: a triage snag's
  -- raiser is the spine's default holder, not "assigned to fix"). The item is
  -- READ back, never inserted here: a direct insert would collide with the
  -- mirror's on work_items_src_snag_uidx (23505).
  INSERT INTO field.snags (project_id, organisation_id, title, raised_by)
  VALUES (v_proj, v_org, 'Probe snag', v_pm)
  RETURNING id INTO v_snag;
  SELECT w.id, w.assignee_id, w.status INTO v_snag_item, v_snag_item_assignee, v_snag_item_status
    FROM projects.work_items w WHERE w.snag_id = v_snag AND w.origin = 'mirror';
  IF v_snag_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the open snag projected no mirror item (section D.2)';
  END IF;
  SELECT s.assigned_to INTO v_snag_a1 FROM field.snags s WHERE s.id = v_snag;

  -- The spine's un-triage (§03 §1.6: the triage owner's explicit assign is
  -- status + assignee in one statement): the item is now OPEN, so the arm
  -- writes.
  UPDATE projects.work_items SET status = 'open', assignee_id = v_other WHERE id = v_snag_item;
  SELECT s.assigned_to INTO v_snag_a2 FROM field.snags s WHERE s.id = v_snag;

  -- A plain reassign of the now-open item.
  UPDATE projects.work_items SET assignee_id = v_third WHERE id = v_snag_item;
  SELECT s.assigned_to INTO v_snag_a3 FROM field.snags s WHERE s.id = v_snag;

  -- A signed-off snag: D.2 projects it born CLOSED (signed_off maps to closed,
  -- stamps from signed_off_at/_by), so the write-back is skipped on the closed
  -- item's INSERT (item-status rule), and — in the reopen shape — skipped by
  -- the source-status rule alone.
  INSERT INTO field.snags (project_id, organisation_id, title, raised_by,
                           status, signed_off_by, signed_off_at)
  VALUES (v_proj, v_org, 'Probe signed-off snag', v_pm, 'signed_off', v_pm, now())
  RETURNING id INTO v_snag_so;
  SELECT w.id, w.status INTO v_snag_so_item, v_snag_so_status
    FROM projects.work_items w WHERE w.snag_id = v_snag_so AND w.origin = 'mirror';
  IF v_snag_so_item IS NULL OR v_snag_so_status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'fixture: the signed-off snag was not projected as a closed mirror item (section D.2; got %)', v_snag_so_status;
  END IF;
  SELECT s.assigned_to INTO v_snag_so_a_insert FROM field.snags s WHERE s.id = v_snag_so;
  UPDATE projects.work_items SET status = 'open' WHERE id = v_snag_so_item;
  UPDATE projects.work_items SET assignee_id = v_other WHERE id = v_snag_so_item;
  SELECT s.assigned_to INTO v_snag_so_a_reassign FROM field.snags s WHERE s.id = v_snag_so;

  CREATE TEMP TABLE wb_ctx(
    rfi uuid, closed uuid, rt uuid, reopen uuid, snag uuid, snag_so uuid,
    pm uuid, other uuid, third uuid, triage_owner uuid,
    a1 uuid, d1 date, a2 uuid, d2 date,
    ins_status text, ins_assignee uuid, ins_due date,
    unrel_status text, unrel_assignee uuid,
    untriage_assignee uuid, untriage_source uuid, upd_delta bigint,
    after_src_redate_due date,
    ca uuid, cd date, closed_updated_at timestamptz, hist timestamptz,
    rt_source_after_reassign uuid, rt_item_after_reassign uuid, rt_item_after_edit uuid,
    reopen_item_status text, reopen_source_assignee uuid,
    sc_item_status text, sc_due_before date, sc_due_after date,
    wi_upd_delta bigint,
    snag_item_assignee uuid, snag_item_status text, snag_a1 uuid, snag_a2 uuid, snag_a3 uuid,
    snag_so_a_insert uuid, snag_so_a_reassign uuid)
    ON COMMIT DROP;
  INSERT INTO wb_ctx VALUES (
    v_rfi, v_closed, v_rt, v_reopen, v_snag, v_snag_so,
    v_pm, v_other, v_third, v_triage_owner,
    v_a1, v_d1, v_a2, v_d2,
    v_ins_status, v_ins_assignee, v_ins_due,
    v_unrel_status, v_unrel_assignee,
    v_untriage_assignee, v_untriage_source, v_upd_after - v_upd_before,
    v_after_src_redate_due,
    v_closed_assignee, v_closed_due, v_closed_updated_at, v_hist,
    v_rt_source_after_reassign, v_rt_item_after_reassign, v_rt_item_after_edit,
    v_reopen_item_status, v_reopen_source_assignee,
    v_sc_item_status, v_sc_due_before, v_sc_due_after,
    v_wi_upd_after - v_wi_upd_before,
    v_snag_item_assignee, v_snag_item_status, v_snag_a1, v_snag_a2, v_snag_a3,
    v_snag_so_a_insert, v_snag_so_a_reassign);
END $probe$;

-- ══ fixtures from 06-snag-mirror.sql ════════════════════════════════════════
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
  v_bs_ctid_before text;   -- the born-signed-off record's tuple identity before an unrelated watched edit (Task 10 review, rule 1)
  v_bs_restamp     record; -- …and its ctid / last_activity_at / closed_by after a signed_off_by re-stamp on the source
  v_void_snag  uuid;       -- a snag whose item is voided ON THE SPINE while the source stays alive (rule 2, via Task 14)
  v_void_at    record;     -- the item as the void left it: title + ctid
  v_void_ren1  record;     -- after a source RENAME alone — rule 1 must return early, so the tuple is not even rewritten
  v_void_ren2  record;     -- after a rename PAIRED with a status edit — the arm runs, and rule 2 freezes the title
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

  -- Task 10 review, rule 1 (via Task 13): a signed_off_by RE-STAMP on the
  -- born-signed-off source — watched, so the _upd trigger fires — changes
  -- nothing the closed record projects (first closer wins: closed_by =
  -- COALESCE(the item's, the source's)), so the UPDATE arm must return early
  -- and leave the tuple alone. Measured by ctid AND by the historical
  -- last_activity_at the INSERT path kept: without the rule the arm rewrote
  -- the tuple and stamped now() over it.
  SELECT w.ctid::text INTO v_bs_ctid_before
    FROM projects.work_items w WHERE w.snag_id = v_born_so AND w.origin = 'mirror';
  UPDATE field.snags SET signed_off_by = v_admin2 WHERE id = v_born_so;
  SELECT w.ctid::text AS ctid_after, w.last_activity_at, w.closed_by, w.status INTO v_bs_restamp
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

  -- ── Rule 2 (Task 10 review; landed in D.2 by Task 14): a VOID row's title is
  --    FROZEN, while a closed row keeps following the source ────────────────
  -- field.snags has no void state, so the only way a snag item is void with
  -- its source still alive is a SPINE-side void (§03 §1.7) — section F's
  -- delete-to-void nulls snag_id and puts the row beyond project_snag()
  -- forever. A source rename ALONE returns early on rule 1 (a void row's
  -- title is never compared), so the tuple is not even rewritten; a rename
  -- PAIRED with a status edit moves source_status, the UPDATE arm runs, and
  -- everything it projects follows the source EXCEPT the title. source_status
  -- is asserted below precisely so this row cannot pass by the arm never
  -- running.
  INSERT INTO field.snags (project_id, organisation_id, title, location, priority,
                           status, raised_by)
  VALUES (v_proj, v_org, 'Probe VOID snag', 'Level 3', 'medium', 'open', v_ctr)
  RETURNING id INTO v_void_snag;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, source still live'
   WHERE snag_id = v_void_snag AND origin = 'mirror';
  SELECT w.title, w.ctid::text AS ctid INTO v_void_at
    FROM projects.work_items w WHERE w.snag_id = v_void_snag AND w.origin = 'mirror';
  IF v_void_at.title IS DISTINCT FROM 'Probe VOID snag — Level 3' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "Probe VOID snag — Level 3" (got %)', v_void_at.title;
  END IF;

  UPDATE field.snags SET title = 'Renamed once' WHERE id = v_void_snag;
  SELECT w.title, w.ctid::text AS ctid INTO v_void_ren1
    FROM projects.work_items w WHERE w.snag_id = v_void_snag AND w.origin = 'mirror';

  UPDATE field.snags SET title = 'Renamed twice', status = 'in_progress'
   WHERE id = v_void_snag;
  SELECT w.title, w.status, w.source_status, w.void_reason INTO v_void_ren2
    FROM projects.work_items w WHERE w.snag_id = v_void_snag AND w.origin = 'mirror';

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
    proj3 uuid, livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid,
    bs_ctid_before text, bs_ctid_after text, bs_restamp_last_activity timestamptz,
    bs_restamp_closed_by uuid, bs_restamp_status text,
    void_snag uuid, void_title_at_void text, void_ctid_at_void text,
    void_title_ren1 text, void_ctid_ren1 text,
    void_title_ren2 text, void_status_ren2 text, void_source_status_ren2 text,
    void_reason_ren2 text)
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
    v_proj3, v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id,
    v_bs_ctid_before, v_bs_restamp.ctid_after, v_bs_restamp.last_activity_at,
    v_bs_restamp.closed_by, v_bs_restamp.status,
    v_void_snag, v_void_at.title, v_void_at.ctid,
    v_void_ren1.title, v_void_ren1.ctid,
    v_void_ren2.title, v_void_ren2.status, v_void_ren2.source_status,
    v_void_ren2.void_reason);
END $probe$;

-- ══ fixtures from 07-inspection-mirror.sql ══════════════════════════════════
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

-- ══ fixtures from 08-qc-mirror.sql ══════════════════════════════════════════
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
  v_na_ctid_before text;   -- … and its tuple identity around that rename: not rewritten (Task 11 review I2)
  v_na_ctid_after  text;
  v_rename2_minor text;    -- a live item's title after it: follows
  v_sv           uuid;     -- 'Spine-void defect': voided ON THE SPINE while its entry stays live
  v_sv_title_at_void text; -- its title at the moment of the spine-side void
  v_sv_after     record;   -- … after a source edit that moves the title input AND the verdict (the UPDATE arm)
  v_draftfail_before int;  -- items for the draft-window fail BEFORE the re-issue: 0 (Task 11 review S4)
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
  -- when the status does not change (00202 section C').
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
  -- the crossing rule in the projection decides. Re-failed at a DIFFERENT
  -- severity than it was born with (major/high → critical): the reopen is
  -- the module re-filing the defect, so the item is re-filed with it (Task
  -- 11 review I1 — re-failed with the same 'major', the priority clause could
  -- not fail either way, and on v_live alone the reopened item sat at its
  -- old priority until the next unrelated edit re-filed it).
  UPDATE projects.qc_entries SET conformance = 'fail', severity = 'critical' WHERE id = v_fail;
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
  SELECT count(*) INTO v_draftfail_before FROM projects.work_items WHERE qc_entry_id = v_draftfail;
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
  -- Task 11 review I2: the void row is not REWRITTEN either — a void row's
  -- title is never compared by rule 1's early return. now() is fixed for the
  -- transaction, so the tuple identity (ctid) is the signal, as in
  -- closed_item_unrelated_source_edit_leaves_the_record.
  SELECT w.ctid::text INTO v_na_ctid_before FROM projects.work_items w WHERE w.qc_entry_id = v_na;
  UPDATE projects.qc_reports SET title = 'Level 3 handover QC (rev C)' WHERE id = v_rep;
  SELECT w.title, w.ctid::text INTO v_rename2_na, v_na_ctid_after FROM projects.work_items w WHERE w.qc_entry_id = v_na;
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

  -- ── Task 10 review rule 2, ON THE UPDATE ARM ───────────────────────────────
  -- The rename block above pins rule 1's EARLY RETURN, not rule 2's frozen
  -- title: a rename-only edit on a void record returns before the UPDATE arm
  -- is reached (whole-branch review, finding 1). Rule 2's CASE lives ON the
  -- arm, so pinning it needs a void item whose source edit rule 1 cannot
  -- swallow — and no entry-driven void can supply one. A born-void or
  -- N/A-voided entry carries source_status = its own conformance, so the
  -- early return's `e.conformance IS NOT DISTINCT FROM v_item.source_status`
  -- half holds through any rename and the arm is unreachable by a rename at
  -- all. The shape that DOES reach it is the SPINE-side void with the entry
  -- still live — probes 04 and 06's spine_voided_item_title_is_frozen: a
  -- person voids the ITEM with a reason (§03 §1.7), the entry lives on, and
  -- the record must keep saying what it said when it was voided.
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Spine-void defect', 'fail', 'major', v_pm) RETURNING id INTO v_sv;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, entry still live'
   WHERE qc_entry_id = v_sv AND origin = 'mirror';
  SELECT w.title INTO v_sv_title_at_void
    FROM projects.work_items w WHERE w.qc_entry_id = v_sv AND w.origin = 'mirror';
  IF v_sv_title_at_void IS DISTINCT FROM 'Spine-void defect — Level 3 handover QC (rev C)' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "Spine-void defect — Level 3 handover QC (rev C)" (got %)', v_sv_title_at_void;
  END IF;
  -- The title input AND the verdict move in ONE statement: conformance now
  -- differs from source_status, so rule 1 cannot return and the UPDATE arm
  -- runs with v_item.status = 'void'. source_status is asserted below
  -- precisely so this row cannot pass by the arm never running.
  UPDATE projects.qc_entries SET title = 'Spine-void defect (rev)', conformance = 'na', severity = NULL
   WHERE id = v_sv;
  SELECT w.title, w.status, w.source_status, w.void_reason, w.priority INTO v_sv_after
    FROM projects.work_items w WHERE w.qc_entry_id = v_sv AND w.origin = 'mirror';

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
    reissue_new int, draftfail_before int,
    cl_ctid_before text, cl_ctid_after text, cl_prio_restamp text,
    cl_refiled_status text, cl_refiled_title text, cl_refiled_prio text,
    rename2_na text, rename2_minor text, na_ctid_before text, na_ctid_after text,
    sv uuid, sv_title_at_void text, sv_title_after text, sv_status_after text,
    sv_src_after text, sv_reason_after text, sv_prio_after text,
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
    v_reissue_new, v_draftfail_before,
    v_cl_ctid_before, v_cl_ctid_after, v_cl_prio_restamp,
    v_cl_refiled.status, v_cl_refiled.title, v_cl_refiled.priority,
    v_rename2_na, v_rename2_minor, v_na_ctid_before, v_na_ctid_after,
    v_sv, v_sv_title_at_void, v_sv_after.title, v_sv_after.status,
    v_sv_after.source_status, v_sv_after.void_reason, v_sv_after.priority,
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

-- ══ fixtures from 09-diary-mirror.sql ═══════════════════════════════════════
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project (⇒ triage_owner_id), authors most entries
  v_chain_pm uuid;   -- resolve_project_pm(v_proj): the oldest active org admin — the GATEKEEPER, never the author
  v_admin2   uuid;   -- arm 2 (work_item_defaults.diary_action.triage_owner_id): distinct from every other arm's answer
  v_cv       uuid;   -- an active WM client viewer: never eligible on the probe project (F2) — authors two entries
  v_proj  uuid;
  v_proj2 uuid;   -- a second WM project: the closed-item move target (Task 8 review S1)
  v_triage_owner uuid;
  v_arm2_readback uuid;
  -- the entries
  v_plain    uuid;   -- (a) no delay text at all — 51 of 57 live entries; later edited INTO scope
  v_none     uuid;   -- (b) 'None,' — 2 of the 6 live values say exactly this
  v_sentence uuid;   -- (b) the 2026-06-02 sentence — a token stop-list alone cannot catch it
  v_delay    uuid;   -- (c) a real delay, dated 2026-06-24, HISTORICAL stamps: the title/people/due/stamps subject and the do-not-reproject sentinel
  v_percol   uuid;   -- delays = 'None' beside a real delay_notes: the per-column stop-list (Task 4 review I2)
  v_wd       uuid;   -- a real delay later WITHDRAWN (→ void), then re-recorded (void stays)
  v_closed   uuid;   -- a real delay whose item is CLOSED, then withdrawn (closed stays)
  v_cvdelay  uuid;   -- a real delay authored by the client viewer: the chain answers arm 2
  v_mv       uuid;   -- a second client-viewer-authored delay: closed, then MOVED (S1)
  v_eskom    uuid;   -- 'No power on site — issue with Eskom': a negation WORD before a real delay (Task 4's narrowed rule)
  -- now() is fixed for the whole transaction, so these are exact targets.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_updated timestamptz := now() - interval '30 days';
  -- What §5 computes for a diary_action born with no usable date: A(b)'s +2
  -- SITE working days from the SAST day (00196:243, 00196:670), then the
  -- builders' shutdown push — the exact born date, not merely "after today".
  v_default_due date;
  -- observations
  v_none_n      int;
  v_sentence_n  int;
  v_delay_n     int;
  v_di          record;   -- the real-delay item as born
  v_upgraded    int;
  v_percol_item record;
  v_redated     text;
  v_wd_live     record;   -- the withdrawal candidate before the withdrawal
  v_wd_void     record;
  v_wd_voided_n int;      -- the `voided` event §11 writes for the trigger-driven void (S4)
  v_wd_voided_actor_null boolean;
  v_wd_return   record;
  v_cl_before   record;   -- the closed item right after the close
  v_cl_ctid_before text;  -- its tuple identity — now() is fixed, so a bump is invisible; a rewrite is not (rule 1)
  v_cl_after    record;   -- … and after the withdrawal
  v_cl_ctid_after  text;
  v_eskom_title text;
  v_eskom_n     int;
  v_cv_item     record;
  v_same_last   timestamptz;
  v_moved       record;
  v_wd_ctid_before text;  -- the void item's tuple identity before the delay returns (Task 11 review I2: not rewritten)
  v_admin3      uuid;     -- arm 2 on the THIRD project: distinct from admin2, the PM chain and the owner, so a live move must re-run the chain to be seen
  v_proj3       uuid;     -- the live-move target (a moved item keeps its ref; two moves into one project collide on work_item_ref_unique — deviation 20)
  v_livemv      record;   -- the client-viewer-authored LIVE delay's item after its move
  v_sv          uuid;     -- a real delay whose item is voided ON THE SPINE while the entry stays live
  v_proj4       uuid;     -- its move target: on D.5 a MOVE is the only source edit a void row's early return cannot swallow
  v_sv_title_at_void text;
  v_sv_after    record;   -- the void item after the paired delay-text edit + move (the UPDATE arm)
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: auth.uid() is % — this probe relies on the guard''s service path (no impersonation anywhere in it)', auth.uid();
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_diary', 'active', 'ZAR', v_pm)
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
  -- client viewer cannot author a diary entry through RLS (00145:25-36);
  -- postgres can, and the row is what proves the chain skips an ineligible
  -- created_by rather than handing the delay to the client.
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
  END IF;

  -- Arm 2 of the mirror chain, work_item_defaults.diary_action.triage_owner_id:
  -- an admin distinct from the owner (arm 3) and the PM-chain person (arm 4),
  -- so the 'diary_action' literal project_diary_action passes is load-bearing
  -- — a typo ('diary_actoin') skips this arm and falls to the owner. Set
  -- BEFORE the first entry so born_triage_on_the_author also proves the author
  -- precedes this arm.
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
     SET work_item_defaults = jsonb_build_object('diary_action', jsonb_build_object('triage_owner_id', v_admin2::text))
   WHERE project_id = v_proj;
  -- §13's validator NULLs an id with no effective role on the project; an org
  -- admin always has one (00107), but read it back rather than assume.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY['diary_action', 'triage_owner_id'], '')::uuid INTO v_arm2_readback
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_arm2_readback IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: validate_work_item_defaults did not keep work_item_defaults.diary_action.triage_owner_id = % (read back %)', v_admin2, v_arm2_readback;
  END IF;
  -- With no usable candidate the chain must answer arm 2 — asserted with NO
  -- candidate and with the ineligible client viewer, so the arm-2 row below
  -- measures project_diary_action's literal, not section B (Task 7 review).
  IF projects.resolve_mirror_assignee(v_proj, 'diary_action', NULL) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''diary_action'', NULL) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'diary_action', NULL), v_admin2;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj, 'diary_action', v_cv) IS DISTINCT FROM v_admin2 THEN
    RAISE EXCEPTION 'fixture: resolve_mirror_assignee(proj, ''diary_action'', <client viewer>) answered % rather than arm 2''s %',
      projects.resolve_mirror_assignee(v_proj, 'diary_action', v_cv), v_admin2;
  END IF;

  -- The exact date §5 births a diary_action on: A(b)'s +2 site working days
  -- from the SAST day, then the builders' shutdown push (00196 §5).
  v_default_due := projects.push_past_builders_shutdown(
    projects.add_working_days((now() AT TIME ZONE 'Africa/Johannesburg')::date, 2, v_proj, 'site'),
    v_proj);
  IF v_default_due IS NULL OR v_default_due <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'fixture: add_working_days(SAST today, 2, proj, site) answered % — the site calendar is not usable', v_default_due;
  END IF;

  -- ── (a) no delay text at all — the shape of 51 of 57 live entries ─────────
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-01', 'Slab poured, no issues', v_pm) RETURNING id INTO v_plain;

  -- ── (b) the exact live values — 6 of 6 of them are one of these two shapes ──
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-02', 'Rain', 'None,', v_pm) RETURNING id INTO v_none;
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-03', 'Walk',
          'No delays or info required was noted in the site walk and or meeting', v_pm)
  RETURNING id INTO v_sentence;
  SELECT count(*) INTO v_none_n     FROM projects.work_items WHERE diary_id = v_none;
  SELECT count(*) INTO v_sentence_n FROM projects.work_items WHERE diary_id = v_sentence;

  -- ── (c) an actual delay, with HISTORICAL stamps ────────────────────────────
  -- created_at/updated_at supplied: the backfill shape for #4 and the sentinel
  -- for "did not re-project" (set_updated_at is BEFORE UPDATE only).
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by,
                                           created_at, updated_at)
  VALUES (v_proj, v_org, DATE '2026-06-24', 'Rain', 'Crane stood down 4h awaiting sparks', v_pm,
          v_hist_created, v_hist_updated)
  RETURNING id INTO v_delay;
  SELECT count(*) INTO v_delay_n FROM projects.work_items WHERE diary_id = v_delay;
  SELECT w.title, w.source_status, w.status, w.assignee_id, w.gatekeeper_id, w.created_by,
         w.item_type, w.origin, w.due_date, w.priority, w.opened_at, w.last_activity_at
    INTO v_di
    FROM projects.work_items w WHERE w.diary_id = v_delay AND w.origin = 'mirror';

  -- ── (d) the upgrade path: a plain entry later edited to record a real delay ─
  UPDATE projects.site_diary_entries SET delay_notes = 'Late delivery of DB-04A' WHERE id = v_plain;
  SELECT count(*) INTO v_upgraded FROM projects.work_items WHERE diary_id = v_plain;

  -- ── the per-column stop-list (Task 4 review I2) ────────────────────────────
  -- 'None' typed into `delays` must not silence a real `delay_notes`: the
  -- first non-empty-then-stop-listed form returned NULL for exactly this pair.
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, delay_notes, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-04', 'Second fix', 'None', 'Late delivery of DB-04A', v_pm)
  RETURNING id INTO v_percol;
  SELECT w.title, w.status INTO v_percol_item
    FROM projects.work_items w WHERE w.diary_id = v_percol AND w.origin = 'mirror';

  -- ── entry_date is watched: a re-date retitles the item ─────────────────────
  UPDATE projects.site_diary_entries SET entry_date = DATE '2026-09-05' WHERE id = v_percol;
  SELECT w.title INTO v_redated FROM projects.work_items w WHERE w.diary_id = v_percol AND w.origin = 'mirror';

  -- ── the DOWNGRADE path (controller decision, Task 10) ──────────────────────
  -- A live item whose delay text is later edited to a negation is voided with
  -- a reason — never left in an inbox with a +2 wd due date for a delay the
  -- diarist withdrew. Captured live first, so the void row cannot pass on an
  -- item that was never live.
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-08', 'Rain', 'Rain stopped work, 3h lost', v_pm)
  RETURNING id INTO v_wd;
  SELECT w.status, w.title, w.void_reason INTO v_wd_live
    FROM projects.work_items w WHERE w.diary_id = v_wd AND w.origin = 'mirror';
  UPDATE projects.site_diary_entries SET delays = 'None' WHERE id = v_wd;
  SELECT w.status, w.title, w.void_reason INTO v_wd_void
    FROM projects.work_items w WHERE w.diary_id = v_wd AND w.origin = 'mirror';
  -- S4: the detail text claims a `voided` event — measure it (§11 at depth 2,
  -- actor NULL on the service path).
  SELECT count(*), bool_and(e.actor_id IS NULL) INTO v_wd_voided_n, v_wd_voided_actor_null
    FROM projects.work_item_events e
    JOIN projects.work_items w ON w.id = e.work_item_id
   WHERE w.diary_id = v_wd AND w.origin = 'mirror' AND e.verb = 'voided';
  -- void is terminal (Task 4's arm of work_item_status_for_mirror): the delay
  -- re-recorded afterwards does NOT revive the item; the title is FROZEN
  -- (Task 10 review, rule 2 — the record of what was withdrawn) and the
  -- reason is never rewritten. A genuinely new delay is a new entry.
  -- Task 11 review I2: the void row is not REWRITTEN by the returning delay
  -- either — a void row's title is never compared by rule 1's early return.
  -- now() is fixed for the transaction, so the tuple identity (ctid) is the
  -- signal, as in closed_item_unrelated_source_edit_leaves_the_record.
  SELECT w.ctid::text INTO v_wd_ctid_before
    FROM projects.work_items w WHERE w.diary_id = v_wd AND w.origin = 'mirror';
  UPDATE projects.site_diary_entries SET delays = 'Rain again, 2h lost' WHERE id = v_wd;
  SELECT w.status, w.title, w.void_reason, w.ctid::text AS ctid INTO v_wd_return
    FROM projects.work_items w WHERE w.diary_id = v_wd AND w.origin = 'mirror';

  -- ── a CLOSED item survives a withdrawal ────────────────────────────────────
  -- The delay was acted on and signed off; the diarist tidying the text
  -- afterwards must not rewrite that history. Closed on the service path (the
  -- header explains), closed_by supplied — C' keeps it and stamps closed_at.
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-09', 'DB-02', 'Sparks no-show, DB-02 not wired', v_pm)
  RETURNING id INTO v_closed;
  UPDATE projects.work_items SET status = 'closed', closed_by = v_pm
   WHERE diary_id = v_closed AND origin = 'mirror';
  SELECT w.status, w.title, w.closed_at, w.closed_by, w.ctid::text INTO v_cl_before
    FROM projects.work_items w WHERE w.diary_id = v_closed AND w.origin = 'mirror';
  v_cl_ctid_before := v_cl_before.ctid;
  -- Task 10 review, rule 1: the withdrawal must not REWRITE the closed
  -- record either — now() is fixed for the transaction, so a bumped
  -- last_activity_at cannot show here; a new tuple version (a changed ctid)
  -- can, and did before the early return existed (measured by the review).
  UPDATE projects.site_diary_entries SET delays = 'None' WHERE id = v_closed;
  SELECT w.status, w.title, w.closed_at, w.closed_by, w.void_reason, w.ctid::text INTO v_cl_after
    FROM projects.work_items w WHERE w.diary_id = v_closed AND w.origin = 'mirror';
  v_cl_ctid_after := v_cl_after.ctid;

  -- ── Task 4's narrowed sentence rule, the positive side (S5) ────────────────
  -- A negation WORD followed by a real delay is a delay: the plan's
  -- `[^.]{0,80}` rule swallowed four live-shaped delays of this form (Task 4
  -- review). Measured 2026-09-13: projects verbatim.
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-12', 'Eskom', 'No power on site — issue with Eskom', v_pm)
  RETURNING id INTO v_eskom;
  SELECT count(*), min(w.title) INTO v_eskom_n, v_eskom_title
    FROM projects.work_items w WHERE w.diary_id = v_eskom AND w.origin = 'mirror';

  -- ── arm 2 through the 'diary_action' key ───────────────────────────────────
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-10', 'Level 2', 'Access blocked by tenant fit-out', v_cv)
  RETURNING id INTO v_cvdelay;
  SELECT w.assignee_id, w.status INTO v_cv_item
    FROM projects.work_items w WHERE w.diary_id = v_cvdelay AND w.origin = 'mirror';

  -- ── the WHEN clause: a full-row save that changes nothing it watches ───────
  -- Every watched column is in the SET list with its old value (progress_notes
  -- is the only real change, and it is not watched). The _upd trigger's
  -- column list admits the statement; only the WHEN clause stops it firing.
  -- If it fired, the UPDATE arm would stamp last_activity_at = now() over the
  -- historical value the INSERT path kept on v_delay.
  UPDATE projects.site_diary_entries
     SET progress_notes = 'Rain (edited)',
         delays = delays, delay_notes = delay_notes, entry_date = entry_date,
         project_id = project_id, organisation_id = organisation_id
   WHERE id = v_delay;
  SELECT w.last_activity_at INTO v_same_last
    FROM projects.work_items w WHERE w.diary_id = v_delay AND w.origin = 'mirror';

  -- ── Task 8 review S1: a CLOSED item's people are part of the record ────────
  -- The only projection that re-derives a diary_action's people is a project
  -- MOVE. A client-viewer-authored delay (arm 2 holds it) is closed on the
  -- service path and its entry moved to a second project whose chain answers
  -- someone else (no work_item_defaults there: arm 3, the owner). The item
  -- moves (improvement 8); its people stay. The membership trigger
  -- re-validates both people on the new project first — both are org admins
  -- (00107), so it passes.
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_diary_2', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj2;
  IF projects.resolve_mirror_assignee(v_proj2, 'diary_action', v_cv) IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: on the second project the chain answers % rather than arm 3''s owner % — the move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj2, 'diary_action', v_cv), v_pm;
  END IF;
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-11', 'Lifts', 'Lift out of service, materials carried by hand', v_cv)
  RETURNING id INTO v_mv;
  UPDATE projects.work_items SET status = 'closed', closed_by = v_pm
   WHERE diary_id = v_mv AND origin = 'mirror';
  UPDATE projects.site_diary_entries SET project_id = v_proj2 WHERE id = v_mv;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_moved
    FROM projects.work_items w WHERE w.diary_id = v_mv AND w.origin = 'mirror';

  -- ── Task 9 review I1 (via Task 12): a LIVE move re-runs the chain ─────────
  -- A THIRD project whose arm 2 (work_item_defaults.diary_action.triage_owner_id)
  -- names a THIRD admin — distinct from the first project's arm 2 (admin2),
  -- the PM chain and the owner (arm 3) — so the move arm's resolver call and
  -- its 'diary_action' literal are both load-bearing: a typo key falls to
  -- the owner, a dropped `v_live AND v_moved` arm keeps admin2. The
  -- client-viewer-authored LIVE delay (triage on admin2; its author is the
  -- chain's ineligible candidate) moves there — an owner-authored one would
  -- resolve to the author on the new project too (arm 1). A fresh third
  -- project, not proj2: a moved item keeps its ref and the allocator numbers
  -- per project, so a second move into proj2 could collide on
  -- work_items_ref_unique (measured on the form arm, deviation 20).
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin besides the owner, the PM-chain person and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_diary_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('diary_action', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'diary_action', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'diary_action', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'diary_actoin', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  UPDATE projects.site_diary_entries SET project_id = v_proj3 WHERE id = v_cvdelay;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.diary_id = v_cvdelay AND w.origin = 'mirror';

  -- ── Task 10 review rule 2, ON THE UPDATE ARM ─────────────────────────
  -- void_is_terminal_when_delay_returns above pins rule 1's EARLY RETURN, not
  -- rule 2's frozen title: the returning delay never reaches the UPDATE arm
  -- (whole-branch review, finding 1). Rule 2's CASE lives ON the arm, and on
  -- D.5 reaching it with a void row takes more than any text edit can do.
  -- D.5's early return is
  --   NOT v_live AND NOT v_moved AND <same org>
  --   AND (v_item.status = 'void' OR v_delay IS NULL OR v_title = v_item.title)
  -- so on a void row that parenthesis is TRUE whatever the diarist types: a
  -- delay-text edit ALONE can never run the arm, and a source-driven void
  -- (the withdrawal) has nothing else to offer either. What is left is
  -- `NOT v_moved` — a project MOVE. So: a spine-side void with the entry still
  -- live (probes 04 and 06's spine_voided_item_title_is_frozen), then the
  -- delay text and the project moved in ONE statement. The move is what opens
  -- the arm; the new delay text is what makes the frozen title a real claim
  -- (with the old text v_title would equal the frozen title and thawing the
  -- CASE could not be seen).
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, DATE '2026-09-15', 'Crane', 'Crane breakdown, 4h lost', v_pm)
  RETURNING id INTO v_sv;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, entry still live'
   WHERE diary_id = v_sv AND origin = 'mirror';
  SELECT w.title INTO v_sv_title_at_void
    FROM projects.work_items w WHERE w.diary_id = v_sv AND w.origin = 'mirror';
  IF v_sv_title_at_void IS DISTINCT FROM 'Delay 2026-09-15: Crane breakdown, 4h lost' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "Delay 2026-09-15: Crane breakdown, 4h lost" (got %)', v_sv_title_at_void;
  END IF;
  -- A FOURTH project, not proj2 or proj3: a moved item keeps its ref and the
  -- allocator numbers per project, so a second move into either would risk
  -- work_items_ref_unique (deviation 20). No work_item_defaults are needed —
  -- a non-live move re-resolves nobody (improvement 8 is gated on v_live), so
  -- this project only has to exist and admit the two people the membership
  -- trigger re-validates (both org admins, eligible on any project — 00107).
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_diary_4', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj4;
  UPDATE projects.site_diary_entries
     SET delays = 'Crane back, 1h lost', project_id = v_proj4
   WHERE id = v_sv;
  SELECT w.title, w.status, w.void_reason, w.project_id, w.source_status,
         w.assignee_id, w.gatekeeper_id INTO v_sv_after
    FROM projects.work_items w WHERE w.diary_id = v_sv AND w.origin = 'mirror';

  CREATE TEMP TABLE di_ctx(
    pm uuid, chain_pm uuid, admin2 uuid, cv uuid,
    default_due date, hist_created timestamptz, hist_updated timestamptz,
    none_n int, sentence_n int, delay_n int,
    di_title text, di_src text, di_status text, di_assignee uuid, di_gate uuid, di_created_by uuid,
    di_type text, di_origin text, di_due date, di_prio text, di_opened timestamptz, di_last timestamptz,
    upgraded int,
    percol_title text, percol_status text, redated text,
    wd_live_status text, wd_live_title text, wd_live_reason text,
    wd_void_status text, wd_void_title text, wd_void_reason text,
    wd_voided_n int, wd_voided_actor_null boolean,
    wd_return_status text, wd_return_title text, wd_return_reason text,
    wd_ctid_before text, wd_ctid_after text,
    cl_before_status text, cl_before_title text, cl_before_closed_at timestamptz, cl_before_closed_by uuid,
    cl_after_status text, cl_after_title text, cl_after_closed_at timestamptz, cl_after_closed_by uuid, cl_after_reason text,
    cl_ctid_before text, cl_ctid_after text,
    eskom_n int, eskom_title text,
    cv_assignee uuid, cv_status text,
    same_last timestamptz,
    proj2 uuid, moved_status text, moved_project uuid, moved_assignee uuid, moved_gate uuid,
    proj3 uuid, admin3 uuid,
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid,
    sv uuid, proj4 uuid, sv_title_at_void text, sv_title_after text, sv_status_after text,
    sv_reason_after text, sv_project_after uuid, sv_src_after text,
    sv_assignee_after uuid, sv_gate_after uuid) ON COMMIT DROP;
  INSERT INTO di_ctx VALUES (
    v_pm, v_chain_pm, v_admin2, v_cv,
    v_default_due, v_hist_created, v_hist_updated,
    v_none_n, v_sentence_n, v_delay_n,
    v_di.title, v_di.source_status, v_di.status, v_di.assignee_id, v_di.gatekeeper_id, v_di.created_by,
    v_di.item_type, v_di.origin, v_di.due_date, v_di.priority, v_di.opened_at, v_di.last_activity_at,
    v_upgraded,
    v_percol_item.title, v_percol_item.status, v_redated,
    v_wd_live.status, v_wd_live.title, v_wd_live.void_reason,
    v_wd_void.status, v_wd_void.title, v_wd_void.void_reason,
    v_wd_voided_n, v_wd_voided_actor_null,
    v_wd_return.status, v_wd_return.title, v_wd_return.void_reason,
    v_wd_ctid_before, v_wd_return.ctid,
    v_cl_before.status, v_cl_before.title, v_cl_before.closed_at, v_cl_before.closed_by,
    v_cl_after.status, v_cl_after.title, v_cl_after.closed_at, v_cl_after.closed_by, v_cl_after.void_reason,
    v_cl_ctid_before, v_cl_ctid_after,
    v_eskom_n, v_eskom_title,
    v_cv_item.assignee_id, v_cv_item.status,
    v_same_last,
    v_proj2, v_moved.status, v_moved.project_id, v_moved.assignee_id, v_moved.gatekeeper_id,
    v_proj3, v_admin3,
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id,
    v_sv, v_proj4, v_sv_title_at_void, v_sv_after.title, v_sv_after.status,
    v_sv_after.void_reason, v_sv_after.project_id, v_sv_after.source_status,
    v_sv_after.assignee_id, v_sv_after.gatekeeper_id);
END $probe$;

-- ══ fixtures from 10-form-mirror.sql ════════════════════════════════════════
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
  v_fsv      uuid;   -- voided ON THE SPINE while the form stays live: rule 2's only reachable shape
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
  v_sv_title_at_void text;  -- the spine-voided item's title at the moment of the void
  v_sv_after    record;   -- … after a board rename PAIRED with a source status move (the UPDATE arm)
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

  -- ── Task 10 review rule 2, ON THE UPDATE ARM ─────────────────────────
  -- The born-void rename above pins rule 1's EARLY RETURN, not rule 2's frozen
  -- title: a rename-only edit on a void record returns before the UPDATE arm
  -- is reached (whole-branch review, finding 1). And a BORN-void form can
  -- never reach that arm by a rename at all — its source_status already
  -- equals f.status ('void'), so the early return's
  -- `f.status IS NOT DISTINCT FROM v_item.source_status` half holds through
  -- every rename. The shape that reaches it is the SPINE-side void with the
  -- form still live (probes 04 and 06's spine_voided_item_title_is_frozen):
  -- someone voids the ITEM with a reason (§03 §1.7), the form lives on, and
  -- the record must keep saying what it said when it was voided. The board
  -- rename and the form's own status move in ONE statement, so f.status
  -- differs from source_status and rule 1 cannot return.
  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, form_no, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl, 'TMS-PRB-2026-0010', 'DB-SV', 'Spine-void board', 'draft', v_pm)
  RETURNING id INTO v_fsv;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, form still live'
   WHERE site_form_id = v_fsv AND origin = 'mirror';
  SELECT w.title INTO v_sv_title_at_void
    FROM projects.work_items w WHERE w.site_form_id = v_fsv AND w.origin = 'mirror';
  IF v_sv_title_at_void IS DISTINCT FROM 'TMS-PRB-2026-0010 — Spine-void board' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "TMS-PRB-2026-0010 — Spine-void board" (got %)', v_sv_title_at_void;
  END IF;
  UPDATE field.site_forms
     SET board_label = 'Spine-void board (renamed)',
         status = 'submitted', submitted_at = now(), submitted_by = v_pm
   WHERE id = v_fsv;
  SELECT w.title, w.status, w.source_status, w.void_reason, w.closed_at INTO v_sv_after
    FROM projects.work_items w WHERE w.site_form_id = v_fsv AND w.origin = 'mirror';

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
    form_sv uuid, sv_title_at_void text, sv_title_after text, sv_status_after text,
    sv_src_after text, sv_reason_after text, sv_closed_at_after timestamptz,
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
    form_ill, ill_before_status, ill_before_closed_at, ill_before_src,
    form_sv, sv_title_at_void, sv_title_after, sv_status_after,
    sv_src_after, sv_reason_after, sv_closed_at_after)
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
    v_fill, v_ill_before.status, v_ill_before.closed_at, v_ill_before.source_status,
    v_fsv, v_sv_title_at_void, v_sv_after.title, v_sv_after.status,
    v_sv_after.source_status, v_sv_after.void_reason, v_sv_after.closed_at);
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

-- ══ fixtures from 11-delete-to-void.sql ═════════════════════════════════════
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr   uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor: authors + deletes the two diary entries
  v_pm    uuid;   -- the org owner: creates the project, raises every other source, closes the closed diary item
  v_proj  uuid;
  v_tpl_insp uuid;   -- an active inspections.templates row for the org (39 on 2026-09-13)
  v_tpl_form uuid;   -- an active field.form_templates row (1 of 2 on 2026-09-13)
  -- the sources, one live item each (two for the report)
  v_rfi   uuid;
  v_snag  uuid;
  v_insp  uuid;
  v_form  uuid;
  v_rep   uuid;   -- deleted as a REPORT: the entries go by cascade
  v_qc1   uuid;
  v_qc2   uuid;
  v_aband uuid;   -- born abandoned WITH a reason: an already-void item
  v_diary_live   uuid;   -- authored by rbac-test, live, deleted under impersonation
  v_diary_closed uuid;   -- authored by rbac-test, CLOSED on the spine, deleted under impersonation
  v_n     int;
  v_kinds int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: auth.uid() is % before the first impersonation — the seed must run as postgres', auth.uid();
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the owner IS rbac-test — the actor rows could not discriminate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test (%) is not an active WM-Consulting member — the diary DELETE policy needs organisation_id = ANY(get_user_org_ids())', v_ctr;
  END IF;

  SELECT t.id INTO v_tpl_insp FROM inspections.templates t
   WHERE t.organisation_id = v_org AND t.is_active
   ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl_insp IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active inspections.templates row (39 on 2026-09-13)';
  END IF;
  SELECT t.id INTO v_tpl_form FROM field.form_templates t
   WHERE t.is_active ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl_form IS NULL THEN
    RAISE EXCEPTION 'fixture: field.form_templates has no active row (1 of 2 on 2026-09-13) — site_forms.template_row_id is NOT NULL';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_delete_to_void', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- rbac-test needs a project_members row to be a person on this project
  -- (00107: an org-level contractor has no effective role on a project they
  -- are not a member of); it is what makes the diary item's author eligible
  -- and what stamps actor_role on the `voided` event. The DELETE policy itself
  -- reads org membership, not project membership.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: rbac-test''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;

  -- ── the six sources, each projecting a LIVE item ──────────────────────────
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed RFI', 'x', 'medium', 'open', v_pm) RETURNING id INTO v_rfi;

  INSERT INTO field.snags (project_id, organisation_id, title, location, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed snag', 'Unit 1 — DB-01', 'medium', 'open', v_pm) RETURNING id INTO v_snag;

  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status, created_by)
  VALUES (v_org, v_proj, v_tpl_insp, 'adhoc', 'Doomed board', v_pm, v_pm, 'assigned', v_pm)
  RETURNING id INTO v_insp;

  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl_form, 'DB-DOOMED', 'Doomed form board', 'draft', v_pm)
  RETURNING id INTO v_form;

  -- A report ISSUED with two failing entries: both project at issue (D.4's
  -- report-level entry point), and the report is what gets deleted.
  INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed handover QC', 'draft', v_pm) RETURNING id INTO v_rep;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Earth continuity', 'fail', 'major', v_pm) RETURNING id INTO v_qc1;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Label missing', 'fail', 'minor', v_pm) RETURNING id INTO v_qc2;
  UPDATE projects.qc_reports SET status = 'issued', issued_at = now(), issued_by = v_pm WHERE id = v_rep;

  -- An already-VOID item: born abandoned with the module's reason (probe 07
  -- abandoned_voids_with_reason). The delete must leave its reason alone.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    abandoned_at, abandoned_by, abandoned_reason, created_by)
  VALUES (v_org, v_proj, v_tpl_insp, 'adhoc', 'Abandoned board', v_pm, v_pm, 'abandoned',
          now() - interval '2 days', v_pm, 'Probe: site closed for the season', v_pm)
  RETURNING id INTO v_aband;

  -- The two diary entries rbac-test authored (the DELETE policy's created_by =
  -- auth.uid()). Real delays, so both project (improvement 1's stop-list).
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, CURRENT_DATE, 'Crane', 'Crane stood down 4h awaiting sparks', v_ctr)
  RETURNING id INTO v_diary_live;
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, CURRENT_DATE - 1, 'DB-02', 'Sparks no-show, DB-02 not wired', v_ctr)
  RETURNING id INTO v_diary_closed;
  -- Closed on the service path (as postgres, auth.uid() NULL — the shape
  -- section H's backfill and item 2's service client write; probe 09 does the
  -- same). closed_by supplied; C' keeps it and stamps closed_at = now().
  UPDATE projects.work_items SET status = 'closed', closed_by = v_pm
   WHERE diary_id = v_diary_closed AND origin = 'mirror';

  -- ── capture every item LIVE, before any delete ────────────────────────────
  -- pre_voided_n is the `voided` event count before the delete: 0 for every
  -- item here — a born-void item's only event is `created` (§11 writes
  -- `voided` on a transition, not on a void INSERT; measured, Task 12 Step 2).
  CREATE TEMP TABLE del_ctx(
    kind text, src uuid, item uuid,
    pre_status text, pre_reason text, pre_closed_at timestamptz, pre_closed_by uuid,
    pre_voided_n int) ON COMMIT DROP;
  INSERT INTO del_ctx
  SELECT k.kind, k.src, w.id, w.status, w.void_reason, w.closed_at, w.closed_by,
         (SELECT count(*) FROM projects.work_item_events e WHERE e.work_item_id = w.id AND e.verb = 'voided')
    FROM (VALUES ('rfi', v_rfi), ('snag', v_snag), ('inspection', v_insp), ('form', v_form),
                 ('qc', v_qc1), ('qc', v_qc2), ('void_inspection', v_aband),
                 ('diary_live', v_diary_live), ('diary_closed', v_diary_closed)) AS k(kind, src)
    JOIN projects.work_items w
      ON w.origin = 'mirror'
     AND w.id = CASE k.kind
                  WHEN 'rfi'             THEN (SELECT x.id FROM projects.work_items x WHERE x.rfi_id        = k.src AND x.origin = 'mirror')
                  WHEN 'snag'            THEN (SELECT x.id FROM projects.work_items x WHERE x.snag_id       = k.src AND x.origin = 'mirror')
                  WHEN 'inspection'      THEN (SELECT x.id FROM projects.work_items x WHERE x.inspection_id = k.src AND x.origin = 'mirror')
                  WHEN 'void_inspection' THEN (SELECT x.id FROM projects.work_items x WHERE x.inspection_id = k.src AND x.origin = 'mirror')
                  WHEN 'form'            THEN (SELECT x.id FROM projects.work_items x WHERE x.site_form_id  = k.src AND x.origin = 'mirror')
                  WHEN 'qc'              THEN (SELECT x.id FROM projects.work_items x WHERE x.qc_entry_id   = k.src AND x.origin = 'mirror')
                  ELSE                        (SELECT x.id FROM projects.work_items x WHERE x.diary_id      = k.src AND x.origin = 'mirror')
                END;

  -- The fixture must have produced every item, in the state each row assumes,
  -- or the rows below pass on nothing.
  SELECT count(*), count(DISTINCT kind) INTO v_n, v_kinds FROM del_ctx;
  IF v_n <> 9 OR v_kinds <> 8 THEN
    RAISE EXCEPTION 'fixture: expected 9 mirror items across 8 kinds before the deletes, found % across % (kinds: %)',
      v_n, v_kinds, (SELECT string_agg(kind, ',' ORDER BY kind) FROM del_ctx);
  END IF;
  IF EXISTS (SELECT 1 FROM del_ctx d WHERE d.kind IN ('rfi','snag','inspection','form','qc','diary_live')
                                       AND d.pre_status NOT IN ('triage','open')) THEN
    RAISE EXCEPTION 'fixture: a source that should project a LIVE item did not (%)',
      (SELECT string_agg(d.kind || '=' || d.pre_status, ',') FROM del_ctx d WHERE d.pre_status NOT IN ('triage','open'));
  END IF;
  IF (SELECT d.pre_status FROM del_ctx d WHERE d.kind = 'void_inspection') IS DISTINCT FROM 'void'
     OR (SELECT d.pre_reason FROM del_ctx d WHERE d.kind = 'void_inspection') IS DISTINCT FROM 'Probe: site closed for the season' THEN
    RAISE EXCEPTION 'fixture: the born-abandoned inspection did not project a void item carrying its reason';
  END IF;
  IF (SELECT d.pre_status FROM del_ctx d WHERE d.kind = 'diary_closed') IS DISTINCT FROM 'closed'
     OR (SELECT d.pre_closed_at FROM del_ctx d WHERE d.kind = 'diary_closed') IS NULL
     OR (SELECT d.pre_closed_by FROM del_ctx d WHERE d.kind = 'diary_closed') IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: the closed diary item is not closed with both stamps before its delete';
  END IF;

  -- ── the service-path deletes (postgres, auth.uid() NULL) ──────────────────
  -- ⚠ Before section F existed the FIRST of these aborted the whole probe with
  -- 23514 work_items_source_required — the finding. ROW_COUNT is read after
  -- each so a trigger that RETURNs NULL (silently suppressing the delete) is a
  -- fixture abort, never a quietly-passing row.
  DELETE FROM projects.rfis WHERE id = v_rfi;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the RFI delete touched % rows', v_n; END IF;
  DELETE FROM field.snags WHERE id = v_snag;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the snag delete touched % rows', v_n; END IF;
  DELETE FROM inspections.inspections WHERE id = v_insp;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the inspection delete touched % rows', v_n; END IF;
  DELETE FROM field.site_forms WHERE id = v_form;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the site-form delete touched % rows', v_n; END IF;
  -- The REPORT, not the entries: qc_entries.report_id ON DELETE CASCADE.
  DELETE FROM projects.qc_reports WHERE id = v_rep;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the report delete touched % rows', v_n; END IF;
  DELETE FROM inspections.inspections WHERE id = v_aband;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the abandoned-inspection delete touched % rows', v_n; END IF;

  -- What the impersonated block needs, on a table it can read.
  CREATE TEMP TABLE imp_ctx(
    ctr uuid, diary_live uuid, diary_closed uuid,
    n_live int, n_closed int, who text, uid uuid) ON COMMIT DROP;
  INSERT INTO imp_ctx (ctr, diary_live, diary_closed) VALUES (v_ctr, v_diary_live, v_diary_closed);
  GRANT SELECT, UPDATE ON imp_ctx TO authenticated;
END $probe$;

-- ── rbac-test deletes the two diary entries they authored ───────────────────
DO $imp$
DECLARE
  c   record;
  v_n int;
BEGIN
  SELECT * INTO c FROM imp_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected rbac-test', auth.uid();
  END IF;

  -- RLS turns a refused DELETE into a silent zero-row, so ROW_COUNT is the
  -- evidence that the author policy admitted it.
  DELETE FROM projects.site_diary_entries WHERE id = c.diary_live;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete of the LIVE diary entry touched % rows — the author DELETE policy (00149:30-36) did not admit rbac-test', v_n;
  END IF;
  UPDATE imp_ctx SET n_live = v_n;

  -- The CLOSED item: closed → void is illegal on the machine at depth 1, so
  -- this DELETE succeeds only because the void UPDATE runs at depth 2, exempt.
  DELETE FROM projects.site_diary_entries WHERE id = c.diary_closed;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete of the CLOSED diary entry touched % rows', v_n;
  END IF;
  UPDATE imp_ctx SET n_closed = v_n, who = current_user, uid = auth.uid();

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $imp$;

-- ══ fixtures from 05b-guard-exemption.sql ═══════════════════════════════════
DO $setup$
DECLARE
  v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
  v_pm   uuid; v_proj uuid; v_rfi1 uuid; v_rfi2 uuid; v_rfi3 uuid;
  v_n    int;
  v_row  record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres with no claim (auth.uid() = %)', auth.uid();
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres (current_user = %)', current_user;
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the org owner IS rbac-test — the governing and contractor actors would coincide';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org
                    AND u.role = 'contractor' AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test is not an active contractor on WM-Consulting';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_guard', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has no effective role on a project they are not a
  -- member of (00107); project_members.organisation_id is NOT NULL.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;
  IF COALESCE(public.user_effective_project_role(v_proj, v_pm), 'client_viewer')
     NOT IN ('owner','admin','project_manager') THEN
    RAISE EXCEPTION 'fixture: the org owner is not a governing actor on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_pm);
  END IF;

  -- Seeded as postgres (service path): all three born triage.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 1', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi1;
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 2', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi2;
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 3', 'body', 'medium', 'open', v_pm)  RETURNING id INTO v_rfi3;

  SELECT count(*) INTO v_n FROM projects.work_items w WHERE w.rfi_id IN (v_rfi1, v_rfi2, v_rfi3);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'fixture: expected 3 mirrored items, found % — is 00202 stacked with --with?', v_n;
  END IF;
  FOR v_row IN
    SELECT w.rfi_id, w.status, w.gatekeeper_id, w.origin, r.raised_by
      FROM projects.work_items w JOIN projects.rfis r ON r.id = w.rfi_id
     WHERE w.rfi_id IN (v_rfi1, v_rfi2, v_rfi3)
  LOOP
    IF v_row.origin <> 'mirror' OR v_row.status <> 'triage' THEN
      RAISE EXCEPTION 'fixture: a fresh RFI mirror is not (mirror, triage) — got (%, %)', v_row.origin, v_row.status;
    END IF;
    IF v_row.gatekeeper_id IS DISTINCT FROM v_row.raised_by THEN
      RAISE EXCEPTION 'fixture: the mirror''s gatekeeper (%) is not the raiser (%) — improvement 4 / gatekeeper_rule = creator is not in force',
        v_row.gatekeeper_id, v_row.raised_by;
    END IF;
  END LOOP;

  -- rfi3: assigned to the contractor at the SOURCE, on the service path. The
  -- projection's un-triage rule (probe 04 source_assignment_untriages_item)
  -- moves it to open with the contractor as assignee and the PM (its raiser)
  -- still the gatekeeper. Pinned here so the (d) arm below measures the guard,
  -- not the fixture.
  UPDATE projects.rfis SET assigned_to = v_ctr WHERE id = v_rfi3;
  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id INTO v_row
    FROM projects.work_items w WHERE w.rfi_id = v_rfi3;
  IF v_row.status <> 'open' OR v_row.assignee_id IS DISTINCT FROM v_ctr
     OR v_row.gatekeeper_id IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: rfi3 after source assignment is (%, assignee %, gatekeeper %) — expected (open, contractor, PM)',
      v_row.status, v_row.assignee_id, v_row.gatekeeper_id;
  END IF;

  CREATE TEMP TABLE gd_ctx(
    proj uuid, ctr uuid, pm uuid, rfi1 uuid, rfi2 uuid, rfi3 uuid,
    who text, ctr_uid uuid, pm_uid uuid,
    resp_status text, title_err text, src_status_err text, close_err text,
    close_status text, close_by uuid,
    pm_close_status text, pm_gate uuid, pm_gate_err text
  ) ON COMMIT DROP;
  INSERT INTO gd_ctx (proj, ctr, pm, rfi1, rfi2, rfi3)
  VALUES (v_proj, v_ctr, v_pm, v_rfi1, v_rfi2, v_rfi3);
  -- A postgres temp table is unreadable after SET LOCAL ROLE (item 2, measured).
  GRANT SELECT, UPDATE ON gd_ctx TO authenticated;
END $setup$;

DO $as_contractor$
DECLARE
  c record; v_err text; v_status text; v_by uuid; v_n int;
BEGIN
  SELECT * INTO c FROM gd_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE gd_ctx SET who = current_user, ctr_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the contractor', auth.uid();
  END IF;

  -- 1. The contractor responds to their own UNTRIAGED RFI: triage → answered
  --    through the mirror, at depth 2. Clause (c) forbids triage→answered for
  --    a client; the exemption must let the trigger-driven UPDATE through.
  --    Without it the refusal lands HERE, on the RFI respond (F8).
  UPDATE projects.rfis SET status = 'responded' WHERE id = c.rfi1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the contractor''s respond touched % rows of projects.rfis — RLS filtered it, the guard was never reached', v_n;
  END IF;
  SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET resp_status = v_status;

  -- 2. The same contractor edits the mirror row DIRECTLY: still refused. This
  --    is the assertion that proves the exemption is depth-scoped and not
  --    `> 0`: a client statement is depth 1 and (a2) still bites.
  BEGIN
    UPDATE projects.work_items SET title = 'hand edit' WHERE rfi_id = c.rfi1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET title_err = v_err;

  -- 3. source_status is now in clause (a): a direct edit is refused too.
  BEGIN
    UPDATE projects.work_items SET source_status = 'hacked' WHERE rfi_id = c.rfi1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET src_status_err = v_err;

  -- 4. A NON-GATEKEEPER's direct close: rfi3 is open, the contractor holds the
  --    ball, the PM is the gatekeeper. (c) admits open→closed, so the clause
  --    that answers is (d) — the exemption did not open the close gate to a
  --    depth-1 client.
  BEGIN
    UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET close_err = v_err;

  -- 5. The raiser (= gatekeeper) closes through the source. Under the
  --    exemption the guard stamps closed_at := now() and keeps the closed_by
  --    the mirror supplied (00196:1540-1547 — the service-path treatment).
  UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.ctr WHERE id = c.rfi1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the contractor''s close touched % rows of projects.rfis — RLS filtered it', v_n;
  END IF;
  SELECT w.status, w.closed_by INTO v_status, v_by FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the closed mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET close_status = v_status, close_by = v_by;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_contractor$;

DO $as_pm$
DECLARE
  c record; v_status text; v_gate uuid; v_err text; v_n int;
BEGIN
  SELECT * INTO c FROM gd_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.pm::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE gd_ctx SET pm_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.pm THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the PM', auth.uid();
  END IF;

  -- 6. The PM closes an RFI they did NOT raise, through the RFI module's own
  --    path. Clause (d) would refuse a non-gatekeeper close on the spine; the
  --    module already gated the source write, and the mirror follows at depth 2.
  UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.pm WHERE id = c.rfi2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the PM''s close touched % rows of projects.rfis — RLS filtered it', v_n;
  END IF;
  SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi2;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the PM cannot see the mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET pm_close_status = v_status;

  -- 7. A GOVERNED direct write still works: the PM re-seats rfi3's gatekeeper
  --    on the spine, directly, at depth 1. Clause (b) admits a governing actor
  --    in any live state; the exemption narrowed nothing for a client that
  --    was already allowed.
  BEGIN
    UPDATE projects.work_items SET gatekeeper_id = c.ctr WHERE rfi_id = c.rfi3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  SELECT w.gatekeeper_id INTO v_gate FROM projects.work_items w WHERE w.rfi_id = c.rfi3;
  UPDATE gd_ctx SET pm_gate = v_gate, pm_gate_err = v_err;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_pm$;

-- ══ fixtures from 16-as-a-real-user.sql ═════════════════════════════════════
DO $setup$
DECLARE
  v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
  v_pm   uuid; v_proj uuid; v_rfi_b uuid;
  v_row  record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres with no claim (auth.uid() = %)', auth.uid();
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres (current_user = %)', current_user;
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-15)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the org owner IS rbac-test — the governing and contractor actors would coincide';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org
                    AND u.role = 'contractor' AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test is not an active contractor on WM-Consulting — the rfis INSERT policy (00027:42-46) needs organisation_id = ANY(get_user_org_ids())';
  END IF;

  -- status 'active', never 'payment_paused': 00145's diary INSERT policy
  -- refuses a paused project outright and the diary arm would measure nothing.
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rls_identity', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has no EFFECTIVE role on a project they are not a
  -- member of (00107), and project_members.organisation_id is NOT NULL.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;
  IF COALESCE(public.user_effective_project_role(v_proj, v_pm), 'client_viewer')
     NOT IN ('owner','admin','project_manager') THEN
    RAISE EXCEPTION 'fixture: the org owner is not a governing actor on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_pm);
  END IF;

  -- rfi_b: raised by the owner (so the OWNER is its gatekeeper under
  -- gatekeeper_rule = 'creator'), then assigned to the contractor at the
  -- SOURCE. The projection's un-triage rule moves it to open with the
  -- contractor as assignee, so the contractor's close below reaches clause (d)
  -- and not the status machine.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Owner-raised, contractor-assigned', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi_b;
  UPDATE projects.rfis SET assigned_to = v_ctr WHERE id = v_rfi_b;

  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.origin INTO v_row
    FROM projects.work_items w WHERE w.rfi_id = v_rfi_b AND w.origin = 'mirror';
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'fixture: rfi_b was not mirrored at all — is 00202 stacked with --with?';
  END IF;
  IF v_row.status <> 'open' OR v_row.assignee_id IS DISTINCT FROM v_ctr
     OR v_row.gatekeeper_id IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: rfi_b after source assignment is (%, assignee %, gatekeeper %) — expected (open, contractor, owner)',
      v_row.status, v_row.assignee_id, v_row.gatekeeper_id;
  END IF;

  CREATE TEMP TABLE rls_ctx(
    proj uuid, ctr uuid, pm uuid, rfi_b uuid,
    who text, ctr_uid uuid, pm_uid uuid,
    rfi_a uuid, a_item uuid, a_visible boolean,
    arm_access boolean, arm_assignee boolean, arm_gatekeeper boolean, arm_watcher boolean,
    ins_err text, ins_state text,
    close_err text, close_state text,
    subject_after text, subject_rows int,
    pm_close_rows int,
    diary uuid, diary_item uuid, diary_rows int
  ) ON COMMIT DROP;
  INSERT INTO rls_ctx (proj, ctr, pm, rfi_b) VALUES (v_proj, v_ctr, v_pm, v_rfi_b);
  -- A postgres temp table is unreadable after SET LOCAL ROLE (item 2, measured).
  GRANT SELECT, UPDATE ON rls_ctx TO authenticated;
END $setup$;

DO $as_contractor$
DECLARE
  c        record;
  v_rfi_a  uuid;
  v_item   uuid;
  v_diary  uuid;
  v_err    text; v_state text;
  v_n      int;
  v_a      boolean; v_b boolean; v_g boolean; v_w boolean;
  v_subj   text := 'RFI raised as a contractor — subject edited in the same session';
BEGIN
  SELECT * INTO c FROM rls_ctx;

  -- Become a real, non-privileged user. postgres holds rolbypassrls, so
  -- without these two lines every RLS policy in the database is inert here.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE rls_ctx SET who = current_user, ctr_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the contractor', auth.uid();
  END IF;

  -- 1. THE ORDINARY ACT. A contractor raises an RFI on a project they belong
  --    to. The mirror then INSERTs into projects.work_items, which item 2
  --    gates with a RESTRICTIVE INSERT policy this session cannot satisfy
  --    (arm 5 below is the same session's proof). It only works because
  --    projects.project_rfi is SECURITY DEFINER with row_security off.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (c.proj, (SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
          'RFI raised as a contractor', 'body', 'medium', 'open', c.ctr)
  RETURNING id INTO v_rfi_a;
  UPDATE rls_ctx SET rfi_a = v_rfi_a;

  -- 2. Can they SEE the item their own act created, and through WHICH arm of
  --    work_items_select (00196:1107-1119)? Visibility alone says nothing:
  --    the policy has four independent arms and a reader needs to know which
  --    one is load-bearing before item 5/6 builds an inbox query on it.
  SELECT w.id INTO v_item FROM projects.work_items w
   WHERE w.rfi_id = v_rfi_a AND w.origin = 'mirror';
  UPDATE rls_ctx SET a_item = v_item, a_visible = (v_item IS NOT NULL);
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the mirror of the RFI they just raised — work_items_select admitted no arm, so arms 2-4 below cannot be measured';
  END IF;

  -- The four arms, evaluated exactly as the policy writes them.
  SELECT public.user_has_project_access(c.proj)
         AND COALESCE(public.user_effective_project_role(c.proj, auth.uid()), 'client_viewer')
             <> 'client_viewer'
    INTO v_a;
  SELECT w.assignee_id = auth.uid(), w.gatekeeper_id = auth.uid()
    INTO v_b, v_g
    FROM projects.work_items w WHERE w.id = v_item;
  SELECT EXISTS (SELECT 1 FROM projects.work_item_watchers w
                  WHERE w.work_item_id = v_item AND w.user_id = auth.uid())
    INTO v_w;
  UPDATE rls_ctx SET arm_access = v_a, arm_assignee = v_b,
                     arm_gatekeeper = v_g, arm_watcher = v_w;

  -- 3. THE COUNTERPART. The same session, doing by hand what the mirror just
  --    did for it: a mirrored-type item on the spine. Every CHECK is satisfied
  --    (origin 'split' keeps work_items_src_rfi_uidx out of the way and
  --    work_items_source_required is met by rfi_id), the BEFORE triggers fill
  --    ref and due_date, and the permissive work_items_insert passes — so the
  --    ONLY thing that can refuse this row is the RESTRICTIVE gate's
  --    item_type = 'task' arm. 42501, and the message names work_items.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, origin, title,
       assignee_id, gatekeeper_id, created_by, rfi_id)
    VALUES ((SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
            c.proj, 'rfi', 'split', 'hand-built mirror',
            c.ctr, c.ctr, c.ctr, v_rfi_a);
    v_err := '<no error>'; v_state := '<none>';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;
  UPDATE rls_ctx SET ins_err = v_err, ins_state = v_state;

  -- 4. The contractor cannot CLOSE what they do not gatekeep. rfi_b is open,
  --    they hold the ball, the owner signs it off. (c) admits open → closed,
  --    so the clause that answers is (d) — and it is compared against
  --    auth.uid(), which inside a SECURITY DEFINER function is still them.
  BEGIN
    UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi_b AND origin = 'mirror';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
    v_state := '<none>';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;
  UPDATE rls_ctx SET close_err = v_err, close_state = v_state;

  -- 5. Their own later edit of the RFI's subject re-projects the title. The
  --    source write is admitted by "Org members can update rfis" (00027:47-51,
  --    org-scoped) and 00161's RESTRICTIVE client-viewer block passes them;
  --    the re-projection then runs at depth 2 and rides C''s exemption, which
  --    is the only reason (a2) does not refuse the title change.
  UPDATE projects.rfis SET subject = v_subj WHERE id = v_rfi_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET subject_after = v_subj, subject_rows = v_n;

  -- 6. The delete-to-void path a person can actually reach. The contractor
  --    authors the entry themselves — so the diary INSERT policy (00145:25-36)
  --    and the diary projection both run under their identity — and the delay
  --    text is one the stop-list treats as a real delay.
  INSERT INTO projects.site_diary_entries
    (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (c.proj, (SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
          DATE '2026-09-14', 'Second fix', 'Crane stood down 4h awaiting sparks', c.ctr)
  RETURNING id INTO v_diary;
  -- Captured BEFORE the delete: RI's ON DELETE SET NULL nulls diary_id, after
  -- which the item cannot be found from the source side at all.
  SELECT w.id INTO v_item FROM projects.work_items w
   WHERE w.diary_id = v_diary AND w.origin = 'mirror';
  UPDATE rls_ctx SET diary = v_diary, diary_item = v_item;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor''s diary entry with a real delay did not mirror';
  END IF;

  DELETE FROM projects.site_diary_entries WHERE id = v_diary;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET diary_rows = v_n;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete touched % rows — "Authors can delete their diary entries" (00149:30-36) did not admit rbac-test', v_n;
  END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_contractor$;

DO $as_owner$
DECLARE
  c record; v_n int;
BEGIN
  SELECT * INTO c FROM rls_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.pm::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE rls_ctx SET pm_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.pm THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the owner', auth.uid();
  END IF;

  -- 7. The same statement the contractor was refused in arm 4, by the person
  --    who signs the item off. Nothing about it is service-path: depth 1, a
  --    real claim, (d) satisfied because v_actor = NEW.gatekeeper_id. The
  --    guard stamps closed_at and closed_by := auth.uid() itself.
  UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi_b AND origin = 'mirror';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET pm_close_rows = v_n;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_owner$;

-- ══ THE ONE ASSERTION SELECT ════════════════════════════════════════════════
-- Every arm of every probe above, in probe order, as one UNION ALL. Probe
-- 13's CTEs are hoisted here so its arms can see them.
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
-- ── 04-rfi-mirror.sql ─────────────────────────────────────────────
SELECT 'item_created' AS probe,
       (SELECT count(*) FROM projects.work_items w, rfi_ctx c
         WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 1 AS ok,
       'one mirror item per RFI' AS detail
UNION ALL SELECT 'item_shape',
       (SELECT c.ins_type = 'rfi' AND c.ins_title = 'Probe RFI' AND c.ins_priority = 'high'
           AND c.ins_source_status = 'open' AND c.ins_assignee IS NOT NULL
           AND c.ins_gate IS NOT NULL AND c.ins_due IS NOT NULL FROM rfi_ctx c),
       'type/title/priority/source_status/people/due all set at insert'
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'rfi')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'rfi')
              FROM rfi_ctx c),
       'the literal ''rfi'' in project_rfi() is exactly projects.work_item_types.key — a typo skips resolver arms silently'
UNION ALL SELECT 'born_in_triage',
       (SELECT c.ins_status = 'triage' FROM rfi_ctx c),
       '§03 §1.6: no explicit assignee ⇒ triage'
UNION ALL SELECT 'bic_is_the_assignee',
       (SELECT c.ins_bic = c.ins_assignee FROM rfi_ctx c),
       'A(a): non-null from the first millisecond, and on triage it is the assignee'
-- Task 5 review F4: resolver arm 1b decides the born assignee, so the 'rfi'
-- literal passed to resolve_mirror_assignee is load-bearing ('rfl' skips it
-- and falls to the triage owner — a different person by fixture).
UNION ALL SELECT 'default_rfi_assignee_resolves_through_arm_1b',
       (SELECT c.ins_assignee = c.chain_pm AND c.ins_assignee <> c.pm FROM rfi_ctx c),
       'project_settings.default_rfi_assignee_id is arm 1b of the mirror chain — reachable only when project_rfi passes exactly ''rfi''; the triage owner (the owner) is the fallback and must not be the answer'
-- Improvement 4.
UNION ALL SELECT 'gatekeeper_is_the_raiser',
       (SELECT c.ins_gate = c.other FROM rfi_ctx c),
       'A(b) as amended: an RFI is closed by the person who asked, once the answer is usable'
UNION ALL SELECT 'assignee_is_not_the_gatekeeper',
       (SELECT c.ins_assignee <> c.ins_gate FROM rfi_ctx c),
       '§03 §1.8''s "only the gatekeeper may close" is vacuous when they are the same person'
-- Improvement 6.
UNION ALL SELECT 'not_born_overdue',
       (SELECT c.ins_due > CURRENT_DATE FROM rfi_ctx c),
       'the source said due TODAY; item 2''s trigger must have computed +7 wd instead'
UNION ALL SELECT 'raiser_is_watcher',
       EXISTS (SELECT 1 FROM projects.work_item_watchers ww
                 JOIN projects.work_items w ON w.id = ww.work_item_id
                 JOIN rfi_ctx c ON c.rfi = w.rfi_id
                WHERE ww.user_id = c.other AND ww.reason = 'creator'),
       '§03 §1.5: the raiser is a watcher WITH reason = creator — seeded by item 2''s §11 from created_by (00196:1378-1387), which the mirror sets to raised_by; this migration seeds nothing (S1: the reason is asserted, not only the row)'
-- Task 4 review carry-forward 2, revised by the Task 5 review (F2): the UPDATE
-- arm's un-triage flag is "an ELIGIBLE source assignee DIFFERENT from what the
-- item holds", so assigning an eligible newcomer at the source un-triages.
UNION ALL SELECT 'source_assignment_untriages_item',
       (SELECT c.assign_status = 'open' AND c.assign_assignee = c.admin2 FROM rfi_ctx c),
       'rfis.assigned_to → a second admin on the RFI page (eligible, different from the item''s assignee): the item leaves triage and carries that assignee'
UNION ALL SELECT 'ineligible_source_assignment_does_not_untriage',
       (SELECT c.cv_assign_status = 'triage' AND c.cv_assign_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: assigning a client viewer at the source must not un-triage the item, nor move it off the chain''s answer (the old flag, r.assigned_to IS NOT NULL, was eligibility-blind)'
UNION ALL SELECT 'same_assignee_on_source_does_not_untriage',
       (SELECT c.same_status = 'triage' AND c.same_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: the source naming exactly what the item holds — section E''s write-back shape for a triage item — must not un-triage it on the next edit'
UNION ALL SELECT 'ineligible_explicit_is_born_triage',
       (SELECT c.cv_status = 'triage' AND c.cv_assignee <> c.cv AND c.cv_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: born with a client viewer named — nobody eligible was named, so §03 §1.6 says triage on the chain''s answer, the same answer the first RFI was born with (improvement 7: the viewer never holds it)'
-- Service-path push-back. NOT F8's evidence: as postgres the guard is exempt.
UNION ALL SELECT 'status_pushback',
       (SELECT c.resp_status = 'answered' FROM rfi_ctx c),
       'responded ⇒ answered on the service path. The signed-in case is probe 05b (Task 5½)'
UNION ALL SELECT 'bic_moves_to_gatekeeper',
       (SELECT c.resp_bic = c.other FROM rfi_ctx c),
       'answered ⇒ the ball is with the person who ASKED — compared to the raiser directly, not to whatever the gatekeeper resolved to (F3: against ins_gate this row could not fail when the gatekeeper fell back to the PM)'
UNION ALL SELECT 'idempotent_reprojection',
       (SELECT count(*) FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id = c.rfi) = 1,
       'a second projection (priority edit) must not create a second item'
UNION ALL SELECT 'reprojection_kept_the_status',
       -- origin = 'mirror' is load-bearing, not decoration: without it this
       -- scalar subquery returns two rows and aborts with 21000 the moment any
       -- other row carries the same rfi_id (probe 14 inserts an origin='split'
       -- one — measured in Task 17's first full-rehearsal assembly).
       (SELECT w.status FROM projects.work_items w, rfi_ctx c
         WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 'answered',
       'the update arm must not reset a terminal status on an unrelated edit'
-- #4: historical stamps travel with the projection.
UNION ALL SELECT 'opened_at_is_source_created_at',
       (SELECT c.closed_opened_at = c.hist_created
           AND c.closed_opened_at = (SELECT r.created_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
          FROM rfi_ctx c),
       '#4: opened_at = rfis.created_at, kept on the service path (00196:629-636); §11 dates the created event at it'
UNION ALL SELECT 'born_closed_carries_source_stamps',
       (SELECT c.closed_status = 'closed'
           AND c.closed_closed_at = c.hist_closed
           AND c.closed_closed_at = (SELECT r.closed_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
           AND c.closed_closed_by = c.pm
          FROM rfi_ctx c),
       '#4: a born-closed RFI carries closed_at/closed_by from the source, or metric 7 and the feed lie for the 6 closed live RFIs'
-- F7 / §03 §1.2: the WHEN clause. A same-value write of every watched column
-- (a full-row save that changed only the description) must not re-project.
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.closed_last_activity = c.hist_closed FROM rfi_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
-- Task 5 review F1: due_date left the _upd trigger's UPDATE OF and WHEN lists.
UNION ALL SELECT 'source_redate_does_not_fire_a_projection',
       (SELECT c.redate_due IS NOT DISTINCT FROM c.closed_due_before
           AND c.redate_last_activity = c.hist_closed FROM rfi_ctx c),
       'rfis.due_date moved +40: the spine owns the due date once the item exists, so the re-date fires nothing — the item''s due_date and its historical last_activity_at are untouched (with due_date watched, a no-op projection stamped now() over the history)'
-- Task 8 review S1: a closed item's people are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.chain_pm
           AND c.closed_people_assignee <> c.admin2 AND c.closed_people_gate = c.other FROM rfi_ctx c),
       'rfis.assigned_to → a second admin AFTER the close: the closed record keeps the people it was closed with (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself) — without the rule the forward read would move assignee_id'
-- Task 9 review I1 (via Task 12): the live-move arm.
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_rfi_key',
       (SELECT c.livemv_err IS NULL
           AND c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.chain_pm AND c.livemv_assignee <> c.pm
           AND c.livemv_gate = c.chain_pm AND c.livemv_gate <> c.other FROM rfi_ctx c),
       'improvement 8 on a LIVE item: the move re-runs BOTH people on the NEW project — arm 2 there (admin3) through the move arm''s ''rfi'' literal (a typo key falls to the owner), and the gatekeeper falls from the raiser (not a member of the new project) to the PM chain; a dropped ELSIF v_moved arm leaves the raiser as gatekeeper and item 2''s membership trigger refuses the whole move ("That person is not on this project…" — captured into livemv_err)'
-- Task 10 review, rule 1 (via Task 13): a closed record is not rewritten by a
-- source edit that changes nothing it projects.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after
           AND c.cl_restamp_last_activity = c.hist_closed
           AND c.cl_restamp_closed_by = c.pm AND c.cl_restamp_status = 'closed'
           AND (SELECT r.closed_by FROM projects.rfis r WHERE r.id = c.closed_rfi) = c.chain_pm
          FROM rfi_ctx c),
       'a closed_by re-stamp on a CLOSED RFI fires the _upd trigger (the column is watched) but changes nothing the closed record projects — first closer wins — so the UPDATE arm returns early: same ctid, last_activity_at keeps its historical value instead of the guard''s now(), and the record still names the first closer while the source names the second'
-- Task 10 review, rule 2 (via Task 14): a VOID row's title is frozen.
UNION ALL SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.void_title_at_void = 'Probe VOID RFI'
           AND c.void_title_ren1 = 'Probe VOID RFI' AND c.void_ctid_ren1 = c.void_ctid_at_void
           AND c.void_title_ren2 = 'Probe VOID RFI'
           AND c.void_status_ren2 = 'void' AND c.void_source_status_ren2 = 'responded'
           AND c.void_reason_ren2 = 'voided on the spine, source still live'
           AND (SELECT r.subject FROM projects.rfis r WHERE r.id = c.void_rfi) = 'Renamed twice'
          FROM rfi_ctx c),
       'an item voided ON THE SPINE while its RFI lives on keeps the title it was voided with: a rename ALONE returns early on rule 1 (same ctid — the tuple is not even rewritten), and a rename PAIRED with a status edit runs the UPDATE arm — source_status follows to ''responded'' and void_reason survives, but the title does not move, while the source now reads "Renamed twice"'
-- ── 05-writeback.sql ──────────────────────────────────────────────
UNION ALL SELECT 'holder_reaches_source' AS probe,
       (SELECT c.a1 IS NOT NULL FROM wb_ctx c) AS ok,
       'F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing' AS detail
UNION ALL SELECT 'source_matches_item',
       (SELECT c.a1 = c.ins_assignee FROM wb_ctx c),
       'rfis.assigned_to and work_items.assignee_id agree'
UNION ALL SELECT 'reassign_flows_to_source',
       (SELECT c.a2 = c.third FROM wb_ctx c),
       'a work-item reassign writes projects.rfis.assigned_to'
-- Improvement 11.
UNION ALL SELECT 'redate_flows_to_source',
       (SELECT c.d2 = CURRENT_DATE + 21 FROM wb_ctx c),
       'a work-item re-date writes projects.rfis.due_date, or the RFI page and the Inbox disagree'
-- Improvement 9. The historical updated_at is asserted too: a same-value write
-- would be invisible in assigned_to/due_date but bumps updated_at to now().
UNION ALL SELECT 'closed_record_untouched',
       (SELECT c.ca IS NULL AND c.cd IS NULL AND c.closed_updated_at = c.hist FROM wb_ctx c),
       '6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson'
UNION ALL SELECT 'closed_item_still_exists',
       -- origin = 'mirror' for the same reason as probe 04's
       -- reprojection_kept_the_status: a non-mirror row on the same source
       -- would inflate this count and the row would read as a duplicate.
       (SELECT count(*) FROM projects.work_items w, wb_ctx c
         WHERE w.rfi_id = c.closed AND w.origin = 'mirror') = 1,
       'the item is still projected — only the write-back is skipped'
UNION ALL SELECT 'no_runaway_recursion', true,
       'reaching this row at all proves the mirror ⇄ write-back cycle terminated'
-- The plan's rule (a) for a TRIAGE item (controller decision, 2026-09-13).
UNION ALL SELECT 'triage_holder_is_written_back',
       (SELECT c.ins_status = 'triage' AND c.a1 = c.triage_owner FROM wb_ctx c),
       'an RFI raised with no assignee is born triage on the triage owner, and THAT person reaches rfis.assigned_to — the RFI page renders the resolved holder for the first time'
UNION ALL SELECT 'writeback_value_is_inert_on_reprojection',
       (SELECT c.unrel_status = 'triage' AND c.unrel_assignee = c.ins_assignee FROM wb_ctx c),
       'after the write-back the source names exactly what the item holds, so an unrelated source edit (priority) re-projects without un-triaging the item (D.1''s flag: eligible AND distinct)'
-- Improvement 11 on the insert path: the source had no due date; the spine
-- computed A(b)''s +7 wd; the source now shows the same date.
UNION ALL SELECT 'due_date_reaches_source_on_insert',
       (SELECT c.d1 IS NOT NULL AND c.d1 = c.ins_due FROM wb_ctx c),
       'the spine''s computed due date is written to rfis.due_date on projection — one answer to "when is this due"'
UNION ALL SELECT 'source_redate_does_not_move_the_spine',
       (SELECT c.after_src_redate_due = CURRENT_DATE + 21 FROM wb_ctx c),
       'a later rfis.due_date edit fires no projection (D.1 does not watch it): the spine keeps the re-date it was given — improvement 11 is spine → source only'
-- The round trip (Task 5 review pA case 2).
UNION ALL SELECT 'round_trip_source_updated',
       (SELECT c.rt_source_after_reassign = c.other AND c.rt_item_after_reassign = c.other FROM wb_ctx c),
       'an RFI raised WITH an explicit assignee: a spine reassign reaches rfis.assigned_to'
UNION ALL SELECT 'round_trip_spine_assignee_unchanged_by_unrelated_edit',
       (SELECT c.rt_item_after_edit = c.other FROM wb_ctx c),
       'the next unrelated source edit re-projects the person the write-back put on the source — without the write-back the explicit source assignee REVERTS the spine reassignment'
UNION ALL SELECT 'value_predicate_stops_write_amplification',
       (SELECT c.untriage_assignee = c.other AND c.untriage_source = c.other AND c.upd_delta = 1 FROM wb_ctx c),
       'a source-side assign un-triages the item and CHANGES its assignee, so the write-back fires — and must write nothing back to a source that already agrees: exactly 1 tuple update on projects.rfis (pg_stat_xact_user_tables), not 2'
-- Improvement 9, the source-status rule on its own.
UNION ALL SELECT 'reopened_item_on_closed_source_untouched',
       (SELECT c.reopen_item_status = 'open' AND c.reopen_source_assignee IS NULL FROM wb_ctx c),
       'a closed RFI''s item reopened on the spine, then reassigned: the item is open, so only `status NOT IN (''closed'')` on projects.rfis stops the write — the closed RFI keeps no assignee'
-- Improvement 9, the item-status rule on its own.
UNION ALL SELECT 'closed_item_does_not_write_to_open_source',
       (SELECT c.sc_item_status = 'closed' AND c.sc_due_after = c.sc_due_before FROM wb_ctx c),
       'an item closed on the spine over a still-open RFI, then re-dated: the source is open, so only `NEW.status IN (''closed'',''void'') → RETURN` stops the write — the RFI keeps the date it had'
-- F2''s other half: the WRAPPER''s depth guard, observed.
UNION ALL SELECT 'depth_guard_stops_reprojection_of_spine_writes',
       (SELECT c.wi_upd_delta = 1 FROM wb_ctx c),
       'a spine reassign + re-date is exactly 1 tuple update on projects.work_items (pg_stat_xact_user_tables): the write-back reaches rfis, rfis_mirror_work_item_upd fires, and the wrapper returns at depth 2 instead of re-projecting the spine''s own write back over itself'
-- The snag arm (assignment only; triage items skipped — Task 7 review).
UNION ALL SELECT 'snag_triage_item_leaves_source_unassigned',
       (SELECT c.snag_item_status = 'triage' AND c.snag_item_assignee = c.pm AND c.snag_a1 IS NULL FROM wb_ctx c),
       'section D.2''s INSERT fires this write-back and it SKIPS the triage item: the raiser holds it as the spine''s default holder, and field.snags.assigned_to ("assigned to fix") stays NULL until someone is assigned'
UNION ALL SELECT 'snag_assignment_reaches_source',
       (SELECT c.snag_a2 = c.other FROM wb_ctx c),
       'the spine''s un-triage (status → open with an assignee, one statement) leaves triage, so field.snags.assigned_to = that assignee'
UNION ALL SELECT 'snag_reassign_flows_to_source',
       (SELECT c.snag_a3 = c.third FROM wb_ctx c),
       'a spine reassign of an OPEN snag item writes field.snags.assigned_to'
UNION ALL SELECT 'snag_signed_off_source_untouched',
       (SELECT c.snag_so_a_insert IS NULL AND c.snag_so_a_reassign IS NULL FROM wb_ctx c),
       'improvement 9 for snags: skipped on the closed item''s INSERT, and — reopened on the spine, then reassigned — skipped by `status NOT IN (''signed_off'',''closed'')` on field.snags alone'
UNION ALL SELECT 'snag_has_no_due_date_column',
       NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'field' AND table_name = 'snags' AND column_name = 'due_date'),
       'the snag arm writes assignment only because field.snags has no due_date (00004:10-32); if this row ever fails, the arm must start writing it'
-- ── 06-snag-mirror.sql ────────────────────────────────────────────
UNION ALL SELECT 'snag_item_created' AS probe,
       (SELECT count(*) FROM projects.work_items w, sn_ctx c
         WHERE w.snag_id = c.snag AND w.origin = 'mirror') = 1 AS ok,
       'one mirror item per snag — still one after four re-projections (the explicit partial-index ON CONFLICT target, F6)' AS detail
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'snag')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'snag')
              FROM sn_ctx c),
       'the literal ''snag'' in project_snag() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
-- Improvement 5.
UNION ALL SELECT 'title_carries_the_location',
       (SELECT c.ins_title = 'DB labelling incomplete — Unit 5 — DB-05' FROM sn_ctx c),
       '6 of 6 live snags carry a location and 0 carry a floor_plan_pin; the title is all that reaches the recap'
UNION ALL SELECT 'blank_location_adds_no_dash',
       (SELECT w.title FROM projects.work_items w, sn_ctx c WHERE w.snag_id = c.nowhere)
         = 'No location snag',
       'a whitespace-only location must not produce a trailing em-dash'
-- Section E's snag arm, both sides (controller decision, Task 7 review).
UNION ALL SELECT 'unassigned_snag_source_stays_unassigned',
       (SELECT c.ins_status = 'triage' AND c.ins_assignee = c.ctr AND c.assigned_after IS NULL FROM sn_ctx c),
       'a raiser-held TRIAGE item is not written back: snags.assigned_to means "assigned to fix", and writing the raiser there on the same request would make notifySnagCreatedAction''s email render the raiser as the assignee'
UNION ALL SELECT 'assigned_snag_reaches_source',
       (SELECT c.sp_status = 'open' AND c.sp_assignee = c.admin3 AND c.sp_src = c.admin3 FROM sn_ctx c),
       'the spine''s un-triage (status → open with an assignee, one statement) leaves triage, so section E writes field.snags.assigned_to = that assignee (assignment only — snags have no due_date)'
-- §12 §(d), ordering A: an eligible raiser precedes the chain — arm 2 points
-- at a different person and must not answer.
UNION ALL SELECT 'assignee_is_the_raiser',
       (SELECT c.ins_assignee = c.ctr AND c.ins_assignee <> c.admin2 FROM sn_ctx c),
       '§12 §(d): assigned_to → raised_by → the chain; with work_item_defaults.snag.triage_owner_id set to someone else, the raiser still wins'
UNION ALL SELECT 'raiser_is_default_assignee',
       (SELECT c.ins_status = 'triage' AND c.ins_bic = c.ctr FROM sn_ctx c),
       'the raiser is a DEFAULT holder, not an explicit assignee: §03 §1.6 says no explicit assignee ⇒ triage, and the INSERT flag reads assigned_to — the contractor who found it holds it in triage until someone is assigned to fix it'
UNION ALL SELECT 'client_viewer_raiser_falls_to_chain',
       (SELECT c.cv_assignee <> c.cv AND c.cv_status = 'triage' FROM sn_ctx c),
       'F2 / improvement 7: a client-viewer raiser is not eligible, so raised_by is skipped and the chain answers; born triage'
-- Task 7 review: the first ELIGIBLE of (assigned_to, raised_by), never COALESCE.
UNION ALL SELECT 'ineligible_assigned_to_does_not_hide_the_raiser',
       (SELECT c.hidden_assignee = c.ctr AND c.hidden_status = 'triage' AND c.hidden_assignee <> c.admin2 FROM sn_ctx c),
       'assigned_to = a client viewer, raised_by = an eligible contractor: the raiser is the candidate (COALESCE would hand the client viewer in and fall to arm 2''s admin); not an explicit assignment, so triage'
-- §12 §(d), ordering B: an ineligible raiser falls to the chain, whose arm 2
-- is reachable only through exactly 'snag'.
UNION ALL SELECT 'arm_2_resolves_through_the_snag_key',
       (SELECT c.cv_assignee = c.admin2 AND c.admin2 <> c.pm AND c.admin2 <> c.chain_pm FROM sn_ctx c),
       'work_item_defaults.snag.triage_owner_id is arm 2 of the mirror chain — reachable only when project_snag passes exactly ''snag''; the owner (arm 3) and the PM-chain person (arm 4) are different people and must not be the answer'
-- §03 §1.5.
UNION ALL SELECT 'gatekeeper_is_pm_not_raiser',
       (SELECT c.ins_gate = projects.resolve_project_pm(c.proj) AND c.ins_gate <> c.ctr FROM sn_ctx c),
       '§03 §1.5: a defect is not signed off by the person who reported it'
UNION ALL SELECT 'due_computed_by_the_spine',
       (SELECT c.ins_due = c.default_due FROM sn_ctx c),
       'field.snags has no due_date column, so item 2''s trigger computes exactly A(b)''s +5 site working days from the SAST day (then the shutdown push) — the exact born date, not merely "after today"'
-- Task 4 review carry-forward 2, revised by the Task 5 review (F2): the UPDATE
-- arm's un-triage flag is "an ELIGIBLE source assignee DIFFERENT from what the
-- item holds".
UNION ALL SELECT 'source_assignment_change_untriages_or_reassigns',
       (SELECT c.assign_status = 'open' AND c.assign_assignee = c.admin3 FROM sn_ctx c),
       'snags.assigned_to → a third admin on the snag page (eligible, different from the raiser the item held): the item leaves triage and carries that assignee'
UNION ALL SELECT 'writeback_value_is_inert_on_reprojection',
       (SELECT c.sp_after_status = 'open' AND c.sp_after_assignee = c.admin3 FROM sn_ctx c),
       'after section E wrote the spine''s un-triage assignee to snags.assigned_to, an unrelated edit (priority) re-projects with the source naming exactly what the item holds: nothing moves — the round trip converges'
UNION ALL SELECT 'resolved_is_answered',
       (SELECT c.res_status = 'answered' AND c.res_bic = projects.resolve_project_pm(c.proj) AND c.res_bic <> c.ctr FROM sn_ctx c),
       'resolved ⇒ answered ⇒ the PM holds the ball — compared to the PM directly, not to whatever the gatekeeper resolved to (probe 04 F3: against ins_gate this row could not go red under a raiser gatekeeper)'
UNION ALL SELECT 'signed_off_is_closed',
       (SELECT c.sof_status = 'closed' AND c.sof_closed IS NOT NULL FROM sn_ctx c),
       'signed_off ⇒ closed, with a closed_at'
UNION ALL SELECT 'signed_off_carries_stamps',
       (SELECT c.sof_closed_by = c.pm AND c.sof_closed = now() FROM sn_ctx c),
       'closed_by = signed_off_by travels through; closed_at is stamped by the exempt guard at the transition (now()), not copied from the hour-old signed_off_at — the projection''s signed_off_at fallback is reached only on the INSERT path'
-- #4: historical stamps travel with the projection on the INSERT path.
UNION ALL SELECT 'born_signed_off_carries_source_stamps',
       (SELECT c.born_status = 'closed'
           AND c.born_opened_at = c.hist_created
           AND c.born_closed_at = c.hist_signed
           AND c.born_closed_at = (SELECT s.signed_off_at FROM field.snags s WHERE s.id = c.born_so)
           AND c.born_closed_by = c.pm
          FROM sn_ctx c),
       '#4: a born-signed-off snag carries opened_at = created_at and closed_at/closed_by from signed_off_at/signed_off_by (field.snags has no closed_at/closed_by), or metric 7 and the feed lie for every backfilled closed snag'
-- F7 / §03 §1.2: the WHEN clause.
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last_activity = c.hist_signed FROM sn_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL SELECT 'closed_clears_bic',
       (SELECT c.sof_bic IS NULL FROM sn_ctx c),
       'A(a): the generated column is NULL on closed, so the item leaves every inbox'
-- Task 8 review S1: a closed item's people are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.admin3
           AND c.closed_people_assignee <> c.admin2 AND c.closed_people_gate = c.chain_pm FROM sn_ctx c),
       'snags.assigned_to → a second admin AFTER the sign-off: the closed record keeps the people it was closed with (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself) — without the rule the forward read would move assignee_id'
-- Task 9 review I1 (via Task 12): the live-move arm.
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_snag_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM sn_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''snag'' literal — a typo key falls to the owner, a dropped ELSIF v_moved arm leaves it on admin2; the gatekeeper is the PM chain again'
-- Task 10 review, rule 1 (via Task 13): a closed record is not rewritten by a
-- source edit that changes nothing it projects.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.bs_ctid_before = c.bs_ctid_after
           AND c.bs_restamp_last_activity = c.hist_signed
           AND c.bs_restamp_closed_by = c.pm AND c.bs_restamp_status = 'closed'
           AND (SELECT s.signed_off_by FROM field.snags s WHERE s.id = c.born_so) = c.admin2
          FROM sn_ctx c),
       'a signed_off_by re-stamp on a SIGNED-OFF snag fires the _upd trigger (the column is watched) but changes nothing the closed record projects — first closer wins — so the UPDATE arm returns early: same ctid, last_activity_at keeps its historical value instead of the guard''s now(), and the record still names the first closer while the source names the second'
-- Task 10 review, rule 2 (via Task 14): a VOID row's title is frozen.
UNION ALL SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.void_title_at_void = 'Probe VOID snag — Level 3'
           AND c.void_title_ren1 = 'Probe VOID snag — Level 3' AND c.void_ctid_ren1 = c.void_ctid_at_void
           AND c.void_title_ren2 = 'Probe VOID snag — Level 3'
           AND c.void_status_ren2 = 'void' AND c.void_source_status_ren2 = 'in_progress'
           AND c.void_reason_ren2 = 'voided on the spine, source still live'
           AND (SELECT s.title FROM field.snags s WHERE s.id = c.void_snag) = 'Renamed twice'
          FROM sn_ctx c),
       'field.snags has no void state, so an item voided ON THE SPINE with its snag still live keeps the title it was voided with (location included): a rename ALONE returns early on rule 1 (same ctid — the tuple is not even rewritten), and a rename PAIRED with a status edit runs the UPDATE arm — source_status follows to ''in_progress'' and void_reason survives, but the title does not move, while the source now reads "Renamed twice"'
-- ── 07-inspection-mirror.sql ──────────────────────────────────────
UNION ALL SELECT 'insp_item_created' AS probe,
       (SELECT count(*) FROM projects.work_items w, in_ctx c
         WHERE w.inspection_id = c.insp AND w.origin = 'mirror') = 1 AS ok,
       'one mirror item per inspection — still one after five re-projections (the explicit partial-index ON CONFLICT target, F6)' AS detail
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'inspection')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'inspection')
              FROM in_ctx c),
       'the literal ''inspection'' in project_inspection() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL SELECT 'title_names_the_place',
       (SELECT c.ins_title = 'Probe board — Level 2 — Riser' FROM in_ctx c),
       'target_location is the only locator an inspection has (4 of 19 live rows carry one); the title is what reaches the recap'
UNION ALL SELECT 'blank_location_adds_no_dash',
       (SELECT w.title FROM projects.work_items w, in_ctx c WHERE w.inspection_id = c.nowhere)
         = 'No location board',
       'a whitespace-only target_location must not produce a trailing em-dash'
-- A(b): the explicit assignee precedes the chain — arm 2 points at a
-- different person and must not answer.
UNION ALL SELECT 'assignee_seeds_from_source',
       (SELECT c.ins_assignee = c.pm AND c.ins_assignee <> c.admin2 FROM in_ctx c),
       'A(b): an existing eligible assigned_to_id is the assignee; with work_item_defaults.inspection.triage_owner_id set to someone else, the source still wins'
UNION ALL SELECT 'gatekeeper_is_verifier',
       (SELECT c.ins_gate = c.verifier AND c.ins_gate <> c.chain_pm FROM in_ctx c),
       'A(b) verifier_else_pm: verifier_id is the gatekeeper, and the fixture keeps the verifier distinct from the PM chain''s answer so a PM-only gatekeeper goes red here'
UNION ALL SELECT 'born_open_not_triage',
       (SELECT c.ins_status = 'open' AND c.ins_bic = c.pm FROM in_ctx c),
       'an inspection arrives already assigned to an eligible person, so it is born open on them, not triage (§03 §1.6)'
UNION ALL SELECT 'unscheduled_due_computed_by_the_spine',
       (SELECT c.ins_due = c.default_due FROM in_ctx c),
       'no scheduled_at ⇒ NULL through the floor, so item 2''s trigger computes exactly A(b)''s +3 site working days from the SAST day (then the shutdown push) — the exact born date, not merely "after today"'
-- Improvement 6, on the source §12 §(d) explicitly told us to pass through.
UNION ALL SELECT 'past_scheduled_is_floored',
       (SELECT c.past_due = c.default_due FROM in_ctx c),
       '16 of 19 live inspections are scheduled in the past; §12 §(d) says scheduled_at::date and that would be overdue on day one — the floor hands NULL to §5, which computes the same +3 site wd as an unscheduled one'
-- Task 4 review carry-forward: the floor and §5 must agree on what day it is.
UNION ALL SELECT 'due_from_scheduled_uses_sast_day',
       (SELECT c.sast_due = c.utc_day + 1 FROM in_ctx c),
       'scheduled_at at 23:30 UTC is 01:30 SAST the next day: the projection passes (scheduled_at AT TIME ZONE ''Africa/Johannesburg'')::date, so the item is due on the SAST day (+11), not the session-UTC day (+10)'
-- Arm 2 is reachable only through exactly 'inspection'.
UNION ALL SELECT 'arm_2_resolves_through_the_inspection_key',
       (SELECT c.arm2_assignee = c.admin2 AND c.admin2 <> c.pm AND c.admin2 <> c.chain_pm FROM in_ctx c),
       'work_item_defaults.inspection.triage_owner_id is arm 2 of the mirror chain — reachable only when project_inspection passes exactly ''inspection''; the owner (arm 3) and the PM-chain person (arm 4) are different people and must not be the answer'
UNION ALL SELECT 'unassigned_is_born_triage',
       (SELECT c.arm2_status = 'triage' AND c.arm2_bic = c.admin2 FROM in_ctx c),
       'no explicit assignee ⇒ triage on the chain''s answer (§03 §1.6); 0 of 19 live rows are unassigned, which measures the module''s age, not its risk'
UNION ALL SELECT 'absent_verifier_falls_to_pm',
       (SELECT c.arm2_gate = projects.resolve_project_pm(c.proj) AND c.arm2_gate <> c.pm FROM in_ctx c),
       'A(b) verifier_else_pm: a NULL verifier_id resolves the gatekeeper through the PM chain'
-- F2 / improvement 7, on both people.
UNION ALL SELECT 'ineligible_assignee_falls_to_arm_2',
       (SELECT c.cvi_status = 'triage' AND c.cvi_assignee = c.admin2 AND c.cvi_assignee <> c.cv FROM in_ctx c),
       'a client viewer named as assigned_to_id is not eligible: the chain answers arm 2 and the item is born triage, never on the client viewer'
UNION ALL SELECT 'ineligible_verifier_falls_to_pm',
       (SELECT c.cvi_gate = projects.resolve_project_pm(c.proj) AND c.cvi_gate <> c.cv FROM in_ctx c),
       'a client viewer named as verifier_id is not eligible: the resolver''s explicit arm skips them and the PM chain answers'
-- §03 §1.2: no write-back arm for inspections — and the row is NOT vacuous.
UNION ALL SELECT 'no_writeback_to_source',
       (SELECT c.arm2_assignee IS NOT NULL AND c.arm2_src IS NULL
           AND c.cvi_assignee IS NOT NULL AND c.cvi_src = c.cv
           AND (SELECT i.assigned_to_id FROM inspections.inspections i WHERE i.id = c.insp) = c.cv
          FROM in_ctx c),
       'the source is unchanged by the spine: an item exists holding the chain''s answer while inspections.assigned_to_id stays NULL / stays the client viewer — 00066''s flow is the system of record (§03 §1.2)'
-- The forward-assignment rule.
UNION ALL SELECT 'forward_reassignment_moves_the_ball',
       (SELECT c.re_status = 'open' AND c.re_assignee = c.third AND c.re_bic = c.third FROM in_ctx c),
       '00066 owns the column, but the spine must FOLLOW it or the Inbox names the previous person forever: assigned_to_id → an eligible contractor moves assignee_id and ball_in_court_id'
UNION ALL SELECT 'ineligible_reassignment_keeps_the_holder',
       (SELECT c.cvre_status = 'open' AND c.cvre_assignee = c.third FROM in_ctx c),
       'improvement 7 on the UPDATE arm: assigned_to_id → a client viewer is not eligible, so the spine''s current holder stays'
UNION ALL SELECT 'awaiting_verification_is_answered',
       (SELECT c.aw_status = 'answered' AND c.aw_bic = c.verifier FROM in_ctx c),
       'awaiting_verification ⇒ answered ⇒ the ball moves to the verifier'
UNION ALL SELECT 'verifier_change_moves_the_gatekeeper',
       (SELECT c.vch_status = 'answered' AND c.vch_gate = c.admin2 AND c.vch_bic = c.admin2 FROM in_ctx c),
       'verifier_id is read forward like assigned_to_id: a new eligible verifier on the source becomes the gatekeeper, and while answered the ball follows'
UNION ALL SELECT 'certified_is_closed',
       (SELECT c.cert_status = 'closed' AND c.cert_closed IS NOT NULL FROM in_ctx c),
       'certified ⇒ closed, with a closed_at'
UNION ALL SELECT 'certified_carries_stamps',
       (SELECT c.cert_closed_by = c.admin2 AND c.cert_closed = now() FROM in_ctx c),
       'closed_by = the verifier at certification (inspections has no certified_by column); closed_at is stamped by the exempt guard at the transition (now()), not copied from the hour-old certified_at — the projection''s certified_at fallback is reached only on the INSERT path'
UNION ALL SELECT 'closed_clears_bic',
       (SELECT c.cert_status = 'closed' AND c.cert_bic IS NULL FROM in_ctx c),
       'A(a): the generated column is NULL on closed, so the item leaves every inbox (not vacuous: the item must exist and be closed)'
-- The void arm (abandoned), keyed on v_mapped, with the module's reason.
UNION ALL SELECT 'abandoned_voids_with_reason',
       (SELECT c.ab_status = 'void' AND c.ab_reason = 'Site closed for the season' AND c.ab_bic IS NULL FROM in_ctx c),
       'abandoned ⇒ void, void_reason = the trimmed abandoned_reason (00072, the column abandonInspectionAction writes); the ball is nobody''s'
UNION ALL SELECT 'abandoned_without_a_reason_gets_the_default',
       (SELECT c.liveab_status = 'void' AND c.liveab_reason = 'inspection abandoned at source' FROM in_ctx c),
       'the live path with no reason on the source: the projection supplies the fallback, because the exempt guard skips its void-reason check and the next signed-in UPDATE of a reason-less void row is refused'
UNION ALL SELECT 'void_is_terminal_on_source_reactivation',
       (SELECT c.revive_status = 'void' AND c.revive_reason = 'inspection abandoned at source'
           AND c.revive_source_status = 're-inspect_required' FROM in_ctx c),
       'abandoned → re-inspect_required maps to open, but void is terminal (Task 4''s work_item_status_for_mirror arm): the item stays void with its reason; only source_status follows'
-- #4: historical stamps travel with the projection on the INSERT path.
UNION ALL SELECT 'born_certified_carries_source_stamps',
       (SELECT c.born_status = 'closed'
           AND c.born_opened_at = c.hist_created
           AND c.born_closed_at = c.hist_certified
           AND c.born_closed_at = (SELECT i.certified_at FROM inspections.inspections i WHERE i.id = c.born)
           AND c.born_closed_by = c.verifier
          FROM in_ctx c),
       '#4: a born-certified inspection carries opened_at = created_at, closed_at = certified_at and closed_by = verifier_id, or metric 7 and the feed lie for every backfilled closed inspection'
-- F7 / §03 §1.2: the WHEN clause.
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last_activity = c.hist_certified FROM in_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
-- Task 8 review I1: scheduled_at is read forward on a live item.
UNION ALL SELECT 'source_reschedule_moves_the_spine_due',
       (SELECT c.live_resched_status = 'open' AND c.live_resched_due = c.resched_day FROM in_ctx c),
       'scheduled_at moved +40 days on an OPEN item: no write-back exists in either direction for inspections, so the module''s date is read forward — due_date = the SAST day of the new scheduled_at (pushed past the band; identity by fixture). Under 87acf65 the item stayed on its birth date forever'
UNION ALL SELECT 'spine_due_edit_is_reverted_by_a_reschedule',
       (SELECT c.spine_due = c.resched_day - 10 AND c.spine_due <> c.resched_day
           AND c.live_resched_due = c.resched_day FROM in_ctx c),
       'TRUE = transient, pinned honestly (Task 9 review S2): a spine-side due edit on a live inspection item holds until the module reschedules, and the reschedule''s SAST day replaces it — inspection due dates are module-owned while scheduled_at is in the future (Task 18: the Inbox''s due control refuses item_type = inspection)'
UNION ALL SELECT 'reschedule_to_the_past_keeps_the_current_due',
       (SELECT c.live_past_due = c.live_resched_due FROM in_ctx c),
       'scheduled_at moved into the past: the floor hands NULL and the UPDATE arm keeps what the item holds — an item is never made overdue by a re-projection (improvement 6 on the UPDATE arm)'
-- Task 8 review S1: a closed item's people and due date are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.pm
           AND c.closed_people_gate = c.verifier AND c.closed_people_due = c.born_due
           AND c.closed_people_assignee <> c.third AND c.closed_people_gate <> c.admin2
           AND c.closed_people_due <> c.resched_day FROM in_ctx c),
       'assigned_to_id, verifier_id AND scheduled_at all changed on a CERTIFIED source: the closed record keeps the people it was closed with and its date — the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself'
-- The honest rows (Task 8 review, controller decision): TRUE = transient.
UNION ALL SELECT 'spine_reassignment_is_reverted_by_the_next_source_write',
       (SELECT c.rt_before_assignee = c.admin2 AND c.rt_after_assignee = c.pm AND c.rt_after_assignee <> c.admin2 FROM in_ctx c),
       'TRUE = transient, pinned honestly: a spine-side reassignment of an inspection item lasts until the next watched write of ANY kind on the source (a title edit here) — the forward read runs on every projection and no write-back keeps the source in step; the module is the durable control (Task 18: the spine''s reassign action refuses item_type = inspection)'
UNION ALL SELECT 'spine_gatekeeper_correction_is_reverted_by_the_next_source_write',
       (SELECT c.rt_before_gate = c.admin2 AND c.rt_after_gate = c.verifier AND c.rt_after_gate <> c.admin2 FROM in_ctx c),
       'TRUE = transient, pinned honestly: the verifier is read forward on every projection of a live item, so a spine-side gatekeeper correction is undone by the next watched source write; the inspection page''s verifier is the durable control'
-- Task 9 review I1 (via Task 12): the live-move arm.
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_inspection_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM in_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''inspection'' literal — a typo key falls to the owner, a dropped ELSIF v_moved arm leaves it on admin2; the ineligible verifier falls to the PM chain again'
-- Task 10 review, rule 1 (via Task 13): a closed record is not rewritten by a
-- source edit that changes nothing it projects.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after
           AND c.cl_restamp_last_activity = c.hist_certified
           AND c.cl_restamp_assignee = c.pm AND c.cl_restamp_status = 'closed' FROM in_ctx c),
       'assigned_to_id → a second admin on a CERTIFIED source fires the _upd trigger (watched) but changes nothing the closed record projects (its people are kept), so the UPDATE arm returns early: same ctid, last_activity_at keeps its historical value instead of the guard''s now()'
-- Task 10 review, rules 1 + 2 (via Task 13), on the born-abandoned void record.
UNION ALL SELECT 'void_item_source_title_edit_leaves_the_record',
       (SELECT c.vd_ctid_before = c.vd_ctid_after AND c.vd_rename_title = 'Abandoned board'
           AND c.vd_rename_status = 'void' AND c.vd_rename_last_activity = c.hist_abandoned FROM in_ctx c),
       'a target_label edit on a VOID (abandoned) inspection fires the _upd trigger (watched), but a void row''s title is frozen and never compared by rule 1''s early return (Task 11 review I2), so the tuple is not rewritten: same ctid, last_activity_at keeps its historical value'
UNION ALL SELECT 'void_reason_edit_reaches_the_record',
       (SELECT c.vd_reason_status = 'void' AND c.vd_reason_reason = 'Site closed — season over'
           AND c.vd_reason_title = 'Abandoned board' FROM in_ctx c),
       'an abandoned_reason edit while the source is still abandoned DOES project — on a void mapping the source''s words win — so rule 1''s early return must compare the projected void_reason and not swallow it (the title stays frozen)'
UNION ALL SELECT 'void_item_title_is_frozen',
       (SELECT c.vd_revive_title = 'Abandoned board' AND c.vd_revive_status = 'void'
           AND c.vd_revive_source_status = 're-inspect_required'
           AND c.vd_revive_reason = 'Site closed — season over' FROM in_ctx c),
       'Task 10 review, rule 2: a label edit COMBINED with a revival runs the UPDATE arm (source_status changes — asserted, so the row is not vacuous) and the void record keeps the title it was withdrawn with; void is terminal and the reason is kept (a closed row''s title keeps following the source)'
-- ── 08-qc-mirror.sql ──────────────────────────────────────────────
UNION ALL SELECT 'draft_report_projects_nothing' AS probe,
       (SELECT c.draft_items = 0 FROM qc_ctx c) AS ok,
       'a fail on a DRAFT report is not yet an obligation: the scope predicate''s report-status half (vacuous before D.4; the predicate mutation makes it real)' AS detail
UNION ALL SELECT 'issue_report_projects_the_fail',
       (SELECT c.issued_fail = 1 FROM qc_ctx c),
       'F4: issuing the REPORT is the normal path; an entry-only trigger never fires here'
UNION ALL SELECT 'issue_report_ignores_the_rest',
       (SELECT c.issued_rest = 0 FROM qc_ctx c),
       'A(b): mirroring every issued entry manufactures ~40 items from one 40-line report — na and pass entries project nothing'
UNION ALL SELECT 'severity_maps_to_priority',
       (SELECT c.fi_priority = 'high' AND c.minor_prio = 'low' AND c.crit_prio = 'critical' AND c.nosev_prio = 'medium'
          FROM qc_ctx c),
       '§03 §1.10: major → high, minor → low, critical → critical, NULL → medium — never a flat medium'
UNION ALL SELECT 'source_status_is_conformance',
       (SELECT c.fi_src = 'fail' FROM qc_ctx c),
       'source_status mirrors conformance'
-- Improvement 5.
UNION ALL SELECT 'title_carries_the_report',
       (SELECT c.fi_title = 'Earth continuity — Level 3 handover QC' FROM qc_ctx c),
       'qc_entries has no location column and its titles are checklist lines: <entry> — <report>, the template''s <thing> — <locator> shape'
UNION ALL SELECT 'entry_pass_closes_item',
       (SELECT c.passed_status = 'closed' AND c.passed_closed_at IS NOT NULL AND c.passed_closed_by IS NULL
           AND c.passed_src = 'pass' FROM qc_ctx c),
       'fail → pass on an issued report closes the defect: closed_at stamped by the exempt guard, closed_by NULL (qc_entries has no updater column)'
UNION ALL SELECT 'entry_fail_on_issued_report_projects',
       (SELECT c.na_fail_n = 1 AND c.na_fail_status = 'triage' FROM qc_ctx c),
       'the second path, update half: an entry corrected to fail while its report is already issued is projected by the entry-level _upd trigger'
UNION ALL SELECT 'new_fail_entry_on_issued_report_projects',
       (SELECT c.late_count = 1 FROM qc_ctx c),
       'the second path, insert half: a late finding INSERTed on an issued report is projected by the entry-level _ins trigger'
UNION ALL SELECT 'na_after_item_exists_voids_with_reason',
       (SELECT c.na_void_status = 'void' AND c.na_void_reason = 'marked N/A at source' AND c.na_void_src = 'na'
          FROM qc_ctx c),
       'controller decision: a live item whose entry is re-marked N/A is voided with a reason, never left open for a defect the source no longer records'
UNION ALL SELECT 'void_is_terminal_when_remarked_fail',
       (SELECT c.na_refail_status = 'void' AND c.na_refail_reason = 'marked N/A at source' AND c.na_refail_src = 'fail'
          FROM qc_ctx c),
       'Task 4''s rule: void has no exit; an entry re-marked fail after the void stays void with its reason (source_status still follows)'
UNION ALL SELECT 'report_rename_reprojects_titles',
       (SELECT c.renamed = 'Label missing — Level 3 handover QC (rev B)' FROM qc_ctx c),
       'the item title embeds the report title, so the report-level trigger watches title too and a rename re-projects every item of the report'
UNION ALL SELECT 'closed_report_entry_still_projects_on_backfill_shape',
       (SELECT c.bf_before = 0 AND c.bf_status = 'triage' AND c.bf_title = 'Bonding — Basement DB QC'
           AND c.bf_prio = 'critical' AND c.bf_src = 'fail'
           AND c.bf_updated_after = c.bf_updated_before FROM qc_ctx c),
       'a closed report''s fail entry is in scope: project_qc_entry(id) called directly, as section H does, projects it and never writes the entry (qc_report_children_frozen is not entered)'
UNION ALL SELECT 'arm_2_resolves_through_the_qc_key',
       (SELECT c.cvfail_assignee = c.admin2 AND c.cvfail_status = 'triage' FROM qc_ctx c),
       'the ''qc_defect'' literal passed to resolve_mirror_assignee reaches work_item_defaults.qc_defect.triage_owner_id: a client-viewer author is ineligible and the chain answers arm 2, born triage'
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_issued FROM qc_ctx c),
       'the _upd trigger''s WHEN clause: an edit to an unwatched column (description) must not fire the projection (it would stamp last_activity_at = now() over the historical value — the issue stamp, I4)'
UNION ALL SELECT 'report_close_does_not_reproject',
       (SELECT c.close_last = c.hist_issued AND c.reopen_last = c.hist_issued FROM qc_ctx c),
       'issued → closed → issued never crosses the scope boundary, so the report-level trigger''s WHEN fires nothing: closing a report is not activity on its defects'
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'qc_defect')
       AND (SELECT c.fi_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'qc_defect') AND c.fi_origin = 'mirror'
              FROM qc_ctx c),
       'the literal ''qc_defect'' in project_qc_entry() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL SELECT 'born_triage_on_the_author',
       (SELECT c.fi_status = 'triage' AND c.fi_assignee = c.pm AND c.fi_created_by = c.pm FROM qc_ctx c),
       '§12 §(d): created_by → the chain, and no explicit assignee ⇒ triage (§03 §1.6): the author holds the defect until someone is assigned to fix it; created_by is the entry''s author'
UNION ALL SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.fi_gate = c.chain_pm AND c.fi_gate <> c.pm FROM qc_ctx c),
       'A(b) / 00196:241 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the entry''s author'
UNION ALL SELECT 'due_date_is_the_registry_default',
       (SELECT c.fi_due = c.default_due FROM qc_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +5 site working days from the SAST day, shutdown-pushed'
UNION ALL SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.nosev_opened = c.hist_issued AND c.nosev_last = c.hist_issued FROM qc_ctx c),
       '#4 / I4: opened_at = GREATEST(the entry''s created_at, the report''s issued_at) and last_activity_at = GREATEST(its updated_at, issued_at) on the INSERT path — supplied stamps, which §5 keeps on the service path (the backfill AND the live issue, which uses the service client)'
UNION ALL SELECT 'entry_older_than_issue_is_born_at_issue',
       (SELECT c.hist_issued > c.hist_created AND c.hist_issued > c.hist_updated
           AND c.nosev_opened = c.hist_issued
           AND c.bf_opened = c.bf_created FROM qc_ctx c),
       'Task 9 review I4: an entry drafted 20 days before the report was issued is NOT born 20 days old — the item dates from the issue; a report with no issued_at (the backfill shape, report 2) falls back to the entry''s own created_at'
UNION ALL SELECT 'pass_keeps_recorded_priority',
       (SELECT c.passed_prio = 'high' FROM qc_ctx c),
       'the app blanks severity with a pass; a NULL severity on an EXISTING item means "not stated", so the closed defect keeps the priority it was recorded at (NULL → medium is the INSERT path''s rule only)'
UNION ALL SELECT 'pass_then_na_keeps_closed_stamps',
       (SELECT c.pass_na_status = 'closed' AND c.pass_na_closed_at = c.passed_closed_at AND c.pass_na_src = 'na'
          FROM qc_ctx c),
       'na maps to NULL (leave unchanged): a closed item whose entry is later marked N/A stays closed with its stamps — the void rule applies to LIVE items only'
-- Task 9 review, decision 1: the crossing rule.
UNION ALL SELECT 'refail_reopens_a_closed_defect',
       (SELECT c.refail_status = 'open' AND c.refail_assignee = c.pm AND c.refail_bic = c.pm
           AND c.refail_closed_at IS NULL AND c.refail_ev = 1 AND c.refail_prio = 'critical' FROM qc_ctx c),
       'a CLOSED defect whose entry crosses from na back INTO fail is reopened on its last holder (one status_changed event, closed_at cleared by the guard) and RE-FILED at the severity it was re-failed with — born major/high, re-failed critical (Task 11 review I1); section C still maps fail → NULL — the projection''s crossing rule decides'
UNION ALL SELECT 'answered_survives_an_unrelated_edit_and_a_rename',
       (SELECT c.ans_edit = 'answered' AND c.ans_rename = 'answered' FROM qc_ctx c),
       'an item a human moved to answered keeps it through an entry title edit and a report rename — the `fail → open` map the review measured would have pulled it back to open on both; the crossing rule touches closed items only'
UNION ALL SELECT 'spine_closed_defect_survives_an_unrelated_edit',
       (SELECT c.sc_after = 'closed' FROM qc_ctx c),
       'a defect CLOSED on the spine while its entry still reads fail (source_status = fail) survives an unrelated title edit: only a CROSSING into fail reopens — drop the source_status clause and every such record reopens on its next edit'
-- Task 9 review, decision 2: the scope predicate gates birth only.
UNION ALL SELECT 'report_withdrawal_keeps_live_items',
       (SELECT c.wd_crit_status = 'triage' AND c.wd_crit_reason IS NULL
           AND c.wd_fail_status = 'open'
           AND c.wd_na_status = 'void' AND c.wd_na_reason = 'marked N/A at source' FROM qc_ctx c),
       'issued → draft (legal at the DB, no app path) changes NOTHING on existing items: the triage defect stays triage, the reopened one stays open, the N/A void keeps its own reason — the first version voided them as ''report withdrawn'', which a re-issue could never undo'
UNION ALL SELECT 'reissue_keeps_the_items_and_projects_new_fails',
       (SELECT c.reissue_crit_status = 'triage' AND c.reissue_crit_reason IS NULL
           AND c.draftfail_before = 0 AND c.reissue_new = 1 FROM qc_ctx c),
       'the re-issue leaves the earlier items exactly as they were and projects the fail added during the draft cycle (0 items before the re-issue, 1 after — self-contained, Task 11 review S4) — no revival needed because nothing was withdrawn'
-- Task 9 review I3: priority is module-owned while severity is set.
UNION ALL SELECT 'spine_priority_edit_is_reverted_by_the_next_source_write',
       (SELECT c.prio_spine = 'low' AND c.prio_src = 'high' FROM qc_ctx c),
       'TRUE = transient, pinned honestly: a spine-side priority edit on a live qc_defect item lasts until the next watched source write of ANY kind while severity is non-NULL (a title edit here re-files major → high) — the module owns priority (Task 18: the Inbox''s priority control refuses item_type = qc_defect)'
UNION ALL SELECT 'closed_item_priority_is_not_refiled',
       (SELECT c.cl_refiled_status = 'closed' AND c.cl_refiled_prio = 'high'
           AND c.cl_refiled_title = 'Corrected defect (rev) — Level 3 handover QC (rev B)' FROM qc_ctx c),
       'a title AND severity edit on a passed (closed) entry runs the UPDATE arm — the title follows — but the closed record keeps the priority it was recorded at: the priority SET is gated on v_live (I3)'
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after AND c.cl_prio_restamp = 'high' FROM qc_ctx c),
       'a severity-only edit on a passed entry fires the _upd trigger (severity is watched) but changes nothing the closed record projects, so the UPDATE arm returns early and the tuple is not rewritten (same ctid) — before the early return the guard stamped last_activity_at = now() on it'
-- Task 10 review, rule 1 on a VOID row. This row pins the EARLY RETURN's void
-- clause, NOT rule 2's frozen title: a rename-only edit on a void record
-- returns before the UPDATE arm is reached, so thawing rule 2's CASE cannot
-- redden it (whole-branch review, finding 1). Rule 2 is the row below.
UNION ALL SELECT 'void_item_rename_alone_leaves_the_record',
       (SELECT c.rename2_na = 'Untested check — Level 3 handover QC (rev B)'
           AND c.rename2_minor = 'Label missing — Level 3 handover QC (rev C)'
           AND c.na_ctid_before = c.na_ctid_after FROM qc_ctx c),
       'a second report rename retitles the live items; on the void (N/A) item it is a RENAME-ONLY source edit, so rule 1''s early return fires — its `v_item.status = ''void''` clause stands in for the title comparison — and the record is not even REWRITTEN: same ctid, the title still reading what it read when the record was withdrawn. Task 11 review I2: under the plain title comparison the frozen title still ran the arm and the guard re-stamped last_activity_at. Dropping the void clause reddens this row; thawing rule 2''s CASE says nothing about it'
-- Task 10 review, rule 2: a void row's title is frozen ON THE UPDATE ARM.
UNION ALL SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.sv_title_at_void = 'Spine-void defect — Level 3 handover QC (rev C)'
           AND c.sv_title_after = c.sv_title_at_void
           AND c.sv_status_after = 'void' AND c.sv_src_after = 'na'
           AND c.sv_reason_after = 'voided on the spine, entry still live'
           AND c.sv_prio_after = 'high'
           AND (SELECT e.title FROM projects.qc_entries e WHERE e.id = c.sv) = 'Spine-void defect (rev)'
          FROM qc_ctx c),
       'an item voided ON THE SPINE while its entry lives on keeps the title it was voided with. The entry title and the verdict move in ONE statement, so the early return cannot fire (conformance ''na'' <> source_status ''fail'') and the UPDATE arm runs with v_item.status = ''void'': source_status follows to ''na'', the reason survives and the closed record''s priority is not re-filed — but the title does not move, while the entry now reads "Spine-void defect (rev)". No entry-driven void can reach this arm (a born-void or N/A-voided entry''s source_status already equals its conformance, so a rename always returns early), which is why the shape is the spine-side void of probes 04 and 06. Thawing rule 2''s CASE reddens this row'
-- Task 9 review I1: the live-move arm.
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_qc_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM qc_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''qc_defect'' literal — a typo key or a dropped v_live AND v_moved arm both leave it on admin2'
-- Task 8 review S1: a closed item's people are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.moved_status = 'closed' AND c.moved_project = c.proj2
           AND c.moved_assignee = c.admin2 AND c.moved_assignee <> c.pm
           AND c.moved_gate = c.chain_pm FROM qc_ctx c),
       'a CLOSED defect moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself)'
-- ── 09-diary-mirror.sql ───────────────────────────────────────────
UNION ALL SELECT 'empty_entry_not_mirrored' AS probe,
       (SELECT c.none_n = 0 FROM di_ctx c) AS ok,
       'the string is literally "None," — 2 of the 6 live rows say exactly this (vacuous before D.5; the non-empty-predicate mutation makes it real)' AS detail
UNION ALL SELECT 'sentence_negation_not_mirrored',
       (SELECT c.sentence_n = 0 FROM di_ctx c),
       'the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough'
UNION ALL SELECT 'real_delay_mirrored',
       (SELECT c.delay_n = 1 FROM di_ctx c),
       'a genuine delay must still project, or the stop-list has eaten the feature'
UNION ALL SELECT 'title_carries_the_delay',
       (SELECT c.di_title = 'Delay 2026-06-24: Crane stood down 4h awaiting sparks' FROM di_ctx c),
       'the item must be readable in an inbox without opening the diary: Delay <entry_date>: <text>'
UNION ALL SELECT 'source_status_is_null',
       (SELECT c.delay_n = 1 AND c.di_src IS NULL FROM di_ctx c),
       'the source has no status column, so there is nothing to mirror (NULL on both paths; map_source_status(''diary_action'', …) is always NULL) — on an item that EXISTS, so the row is not vacuous (S3)'
UNION ALL SELECT 'negation_word_before_a_real_delay_projects',
       (SELECT c.eskom_n = 1 AND c.eskom_title = 'Delay 2026-09-12: No power on site — issue with Eskom' FROM di_ctx c),
       'Task 4''s narrowed sentence rule, the positive side: ''No power on site — issue with Eskom'' is a delay that begins with a negation word — the plan''s [^.]{0,80} rule swallowed it; it projects verbatim (S5)'
UNION ALL SELECT 'edit_into_scope_mirrors',
       (SELECT c.upgraded = 1 FROM di_ctx c),
       'adding real delay_notes to an existing entry brings it into scope — the _upd trigger''s delay_notes arm'
-- Task 4 review I2: the stop-list is applied PER COLUMN.
UNION ALL SELECT 'delay_notes_alone_projects',
       (SELECT c.percol_title = 'Delay 2026-09-04: Late delivery of DB-04A' AND c.percol_status = 'triage' FROM di_ctx c),
       'delays = ''None'' beside delay_notes = ''Late delivery of DB-04A'' projects, titled from the surviving column: a None typed into one box must not silence a real delay in the other'
UNION ALL SELECT 'redate_retitles_the_item',
       (SELECT c.redated = 'Delay 2026-09-05: Late delivery of DB-04A' FROM di_ctx c),
       'entry_date is in the title, so the _upd trigger watches it and a re-dated entry re-projects its title'
-- Controller decision, Task 10: the downgrade path.
UNION ALL SELECT 'withdrawn_delay_voids_with_reason',
       (SELECT c.wd_live_status = 'triage' AND c.wd_live_reason IS NULL
           AND c.wd_void_status = 'void' AND c.wd_void_reason = 'delay withdrawn at source'
           AND c.wd_void_title = c.wd_live_title FROM di_ctx c),
       'a LIVE item whose delay text is edited to a negation is voided with a reason (a voided event and a reason, not a silent deletion); the title is kept — a NULL delay has nothing to say'
UNION ALL SELECT 'withdrawal_writes_a_voided_event',
       (SELECT c.wd_voided_n = 1 AND c.wd_voided_actor_null FROM di_ctx c),
       '§11 records the trigger-driven void as one `voided` event (actor NULL on the service path; the PM on the live path) — the claim the row above makes, measured (S4)'
-- Task 10 review, rule 1 on a VOID row. This row pins the EARLY RETURN's void
-- clause, NOT rule 2's frozen title: the returning delay never reaches the
-- UPDATE arm, so thawing rule 2's CASE cannot redden it (whole-branch review,
-- finding 1). Rule 2's arm-side claim is spine_voided_item_title_is_frozen.
UNION ALL SELECT 'void_item_delay_edit_alone_leaves_the_record',
       (SELECT c.wd_return_status = 'void' AND c.wd_return_reason = 'delay withdrawn at source'
           AND c.wd_return_title = c.wd_void_title
           AND c.wd_return_title <> 'Delay 2026-09-08: Rain again, 2h lost'
           AND c.wd_ctid_before = c.wd_ctid_after FROM di_ctx c),
       'a delay re-recorded on an entry whose item is already void is a TEXT-ONLY source edit, so rule 1''s early return fires — its `v_item.status = ''void''` clause stands in for the title comparison — and the record is not even REWRITTEN: same ctid, still void with its reason, the title still reading what was withdrawn rather than "Rain again, 2h lost". Nothing was written, so this says nothing about rule 2''s CASE (nor, strictly, about void terminality — the arm that keeps void through a write is the row below); dropping the void clause is what reddens it, and a genuinely new delay is a new entry'
-- Task 10 review, rule 2: a void row's title is frozen ON THE UPDATE ARM.
UNION ALL SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.sv_title_at_void = 'Delay 2026-09-15: Crane breakdown, 4h lost'
           AND c.sv_title_after = c.sv_title_at_void
           AND c.sv_status_after = 'void'
           AND c.sv_reason_after = 'voided on the spine, entry still live'
           AND c.sv_src_after IS NULL
           AND c.sv_project_after = c.proj4
           AND c.sv_assignee_after = c.pm AND c.sv_gate_after = c.chain_pm
           AND (SELECT d.delays FROM projects.site_diary_entries d WHERE d.id = c.sv) = 'Crane back, 1h lost'
          FROM di_ctx c),
       'an item voided ON THE SPINE while its entry lives on keeps the title it was voided with. On D.5 no text edit can reach the UPDATE arm of a void row — the early return''s parenthesis is TRUE for any delay — so the delay text and the PROJECT move in one statement: project_id = proj4 proves the arm ran, and with it the title would have followed to "Delay 2026-09-15: Crane back, 1h lost". It does not; void stays void with its reason, source_status stays NULL, and the people are not re-resolved (improvement 8 is gated on v_live). Thawing rule 2''s CASE reddens this row'
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after AND c.cl_after_status = 'closed' FROM di_ctx c),
       'a withdrawal on an entry whose item is CLOSED changes nothing the record projects, so the UPDATE arm returns early and the tuple is not rewritten (same ctid) — before the early return the guard stamped last_activity_at = now() on it (measured by the review by ctid; now() is fixed here, so the ctid is the signal)'
UNION ALL SELECT 'closed_item_survives_withdrawal',
       (SELECT c.cl_before_status = 'closed' AND c.cl_before_closed_at IS NOT NULL AND c.cl_before_closed_by = c.pm
           AND c.cl_after_status = 'closed' AND c.cl_after_closed_at = c.cl_before_closed_at
           AND c.cl_after_closed_by = c.pm AND c.cl_after_reason IS NULL
           AND c.cl_after_title = c.cl_before_title FROM di_ctx c),
       'the void rule applies to LIVE items only: a closed item (the delay was acted on) whose entry is later tidied to None stays closed with its stamps and title'
UNION ALL SELECT 'arm_2_resolves_through_the_diary_key',
       (SELECT c.cv_assignee = c.admin2 AND c.cv_status = 'triage' FROM di_ctx c),
       'the ''diary_action'' literal passed to resolve_mirror_assignee reaches work_item_defaults.diary_action.triage_owner_id: a client-viewer author is ineligible and the chain answers arm 2, born triage'
-- F7 / §03 §1.2: the WHEN clause.
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_updated FROM di_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
-- Task 8 review S1: a closed item's people are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.moved_status = 'closed' AND c.moved_project = c.proj2
           AND c.moved_assignee = c.admin2 AND c.moved_assignee <> c.pm
           AND c.moved_gate = c.chain_pm FROM di_ctx c),
       'a CLOSED delay moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only'
-- Task 9 review I1 (via Task 12): the live-move arm.
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_diary_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM di_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''diary_action'' literal — a typo key falls to the owner, a dropped v_live AND v_moved arm leaves it on admin2; the gatekeeper is the PM chain again'
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'diary_action')
       AND (SELECT c.di_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'diary_action') AND c.di_origin = 'mirror'
              FROM di_ctx c),
       'the literal ''diary_action'' in project_diary_action() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL SELECT 'born_triage_on_the_author',
       (SELECT c.di_status = 'triage' AND c.di_assignee = c.pm AND c.di_created_by = c.pm AND c.di_prio = 'medium' FROM di_ctx c),
       '§12 §(d): created_by → the chain, and no explicit assignee ⇒ triage (§03 §1.6): the diarist holds the delay until someone is assigned to act on it; created_by is the entry''s author; priority is the literal medium (no severity on the source)'
UNION ALL SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.di_gate = c.chain_pm AND c.di_gate <> c.pm FROM di_ctx c),
       'A(b) / 00196:243 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the entry''s author'
UNION ALL SELECT 'due_date_is_the_registry_default',
       (SELECT c.di_due = c.default_due FROM di_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +2 SITE working days from the SAST day, shutdown-pushed — the shortest offset on the board'
UNION ALL SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.di_opened = c.hist_created AND c.di_last = c.hist_updated FROM di_ctx c),
       '#4: opened_at = the entry''s created_at and last_activity_at = its updated_at on the INSERT path (§5 keeps them on the service path)'
-- ── 10-form-mirror.sql ────────────────────────────────────────────
UNION ALL SELECT 'form_item_created' AS probe,
       (SELECT c.f1_n = 1 FROM fm_ctx c) AS ok,
       'a draft form is already an obligation: somebody has to finish it' AS detail
UNION ALL SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'form_action')
       AND (SELECT c.b_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'form_action') AND c.b_origin = 'mirror'
              FROM fm_ctx c),
       'the literal ''form_action'' in project_form_action() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL SELECT 'title_names_the_board',
       (SELECT c.b_title = 'Site form — Probe board' FROM fm_ctx c),
       'the item must name the board without opening the form: <form_no or Site form> — <board_label>; a form has no number for the first statement of its life'
UNION ALL SELECT 'form_no_allocation_retitles',
       (SELECT c.numbered = 'TMS-PRB-2026-0001 — Probe board' FROM fm_ctx c),
       'the app numbers the form with the service client on the same request (site-forms.actions.ts:432): form_no is watched, and the statutory reference reaches the title'
UNION ALL SELECT 'blank_label_falls_to_board_ref',
       (SELECT c.blank_title = 'Site form — DB-PROBE-2' FROM fm_ctx c),
       'board_label is the as-found nameplate and may be blank; site_forms_board_identified guarantees board_ref (or a node), so the title falls to the schedule tag'
-- F10, decided rather than accidental.
UNION ALL SELECT 'draft_is_open_on_its_author',
       (SELECT c.b_status = 'open' AND c.b_assignee = c.pm AND c.b_bic = c.pm AND c.b_created_by = c.pm
           AND c.b_prio = 'medium' AND c.b_src = 'draft' FROM fm_ctx c),
       'F10: a site form IS the thing its author must finish, so it is born open on them, not triage — asserted = open, never IN (triage, open); created_by is the author; priority is the literal medium'
UNION ALL SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.b_gate = c.chain_pm AND c.b_gate <> c.pm FROM fm_ctx c),
       'A(b) / 00196:244 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the author (distributing is a management action on the source too)'
UNION ALL SELECT 'due_date_is_the_registry_default',
       (SELECT c.b_due = c.default_due FROM fm_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +3 SITE working days from the SAST day, shutdown-pushed — set by what the record is FOR (EIR reg 7(4)), not by how long the form takes'
UNION ALL SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.h_opened = c.hist_created AND c.h_last = c.hist_updated FROM fm_ctx c),
       '#4: opened_at = the form''s created_at and last_activity_at = its updated_at on the INSERT path (§5 keeps them on the service path)'
UNION ALL SELECT 'submitted_is_answered',
       (SELECT c.sub_status = 'answered' AND c.sub_bic = c.sub_gate AND c.sub_src = 'submitted' FROM fm_ctx c),
       'draft → submitted maps to answered (section C): the ball passes to the gatekeeper, who distributes or voids'
UNION ALL SELECT 'distributed_is_closed',
       (SELECT c.dist_status = 'closed' AND c.dist_closed_at IS NOT NULL AND c.dist_closed_by = c.pm
           AND c.dist_src = 'distributed' FROM fm_ctx c),
       'submitted → distributed → closed: the guard stamps closed_at on the transition at depth 2 and keeps the supplied closed_by = distributed_by'
UNION ALL SELECT 'closed_clears_bic',
       (SELECT c.dist_status = 'closed' AND c.dist_bic IS NULL FROM fm_ctx c),
       'A(a): the item leaves every inbox on closed — anchored on the item being closed, so the row cannot pass on a missing item (Task 11 review S1)'
UNION ALL SELECT 'born_distributed_carries_source_stamps',
       (SELECT c.bd_status = 'closed' AND c.bd_closed_at = c.hist_dist AND c.bd_closed_by = c.pm
           AND c.bd_opened = c.hist_created AND c.bd_last = c.hist_dist AND c.bd_bic IS NULL FROM fm_ctx c),
       '#4, the backfill shape: a form inserted already distributed is born closed with closed_at = distributed_at (historical), closed_by = distributed_by, opened_at = created_at'
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
UNION ALL SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_restamp_status = 'closed' AND c.cl_restamp_last = c.hist_dist
           AND c.cl_restamp_closed_by = c.pm AND c.cl_restamp_closed_by <> c.admin2 FROM fm_ctx c),
       'a distributed_by re-stamp on a DISTRIBUTED form fires the _upd trigger (the column is watched) but changes nothing the closed record projects — first closer wins — so the UPDATE arm returns early and last_activity_at keeps its historical value instead of the guard''s now()'
UNION ALL SELECT 'closed_item_title_follows_the_source',
       (SELECT c.cl_renamed_status = 'closed' AND c.cl_renamed_title = 'TMS-PRB-2026-0003 — Distributed board (renamed)'
           AND c.cl_renamed_closed_by = c.pm FROM fm_ctx c),
       'the early return is keyed on what the row projects: a board rename on a CLOSED form still retitles the record (a typo corrected) and its people stay'
UNION ALL SELECT 'born_void_carries_source_reason',
       (SELECT c.bv_status = 'void' AND c.bv_reason = 'Probe: created in error' AND c.bv_closed_at IS NULL FROM fm_ctx c),
       '#4 / #3: a form inserted already void is born void carrying the source''s reason (the guard''s void-reason check does not run on INSERT — the projection is the only reason-supplier)'
-- Task 10 review, rule 1 on a VOID row. This row pins the EARLY RETURN's void
-- clause, NOT rule 2's frozen title: a rename-only edit on a void record
-- returns before the UPDATE arm is reached, so thawing rule 2's CASE cannot
-- redden it (whole-branch review, finding 1). Rule 2 is the row below.
UNION ALL SELECT 'void_item_rename_alone_leaves_the_record',
       (SELECT c.bv_title = 'TMS-PRB-2026-0004 — Void board' AND c.bv_renamed_title = c.bv_title
           AND c.bv_renamed_status = 'void' AND c.bv_renamed_reason = 'Probe: created in error'
           AND c.bv_renamed_last = c.hist_updated FROM fm_ctx c),
       'a board rename on a BORN-void form is a rename-only source edit, so rule 1''s early return fires — its `v_item.status = ''void''` clause stands in for the title comparison — and the record is not even REWRITTEN: last_activity_at keeps its historical value instead of the guard''s now(), the title still reading what it read when the record was withdrawn (Task 11 review I2). A born-void form can reach the UPDATE arm by NO rename at all, since its source_status already equals f.status: dropping the void clause reddens this row, and thawing rule 2''s CASE says nothing about it (a closed row''s title keeps following — closed_item_title_follows_the_source)'
-- Task 10 review, rule 2: a void row's title is frozen ON THE UPDATE ARM.
UNION ALL SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.sv_title_at_void = 'TMS-PRB-2026-0010 — Spine-void board'
           AND c.sv_title_after = c.sv_title_at_void
           AND c.sv_status_after = 'void' AND c.sv_src_after = 'submitted'
           AND c.sv_reason_after = 'voided on the spine, form still live'
           AND c.sv_closed_at_after IS NULL
           AND (SELECT f.board_label FROM field.site_forms f WHERE f.id = c.form_sv) = 'Spine-void board (renamed)'
          FROM fm_ctx c),
       'an item voided ON THE SPINE while its form lives on keeps the title it was voided with. The board rename and the form''s own status move in ONE statement, so the early return cannot fire (f.status ''submitted'' <> source_status ''draft'') and the UPDATE arm runs with v_item.status = ''void'': source_status follows to ''submitted'' and the spine''s reason survives the answered mapping, but the title does not move, while the form now reads "Spine-void board (renamed)". Thawing rule 2''s CASE reddens this row'
UNION ALL SELECT 'void_carries_reason',
       (SELECT c.vlive_status IN ('triage','open') AND c.vlive_reason IS NULL
           AND c.void_status = 'void' AND c.void_reason = 'Probe: wrong board' FROM fm_ctx c),
       'a LIVE item whose form is voided carries the form''s own reason (voidSiteFormAction writes status + reason in one statement); the exempt guard path performs no reason check at depth 2, so the projection must supply it'
UNION ALL SELECT 'void_is_terminal',
       (SELECT c.vback_status = 'void' AND c.vback_reason = 'Probe: wrong board' AND c.vback_src = 'submitted' FROM fm_ctx c),
       'Task 4''s rule: void has no exit — a trusted-role resurrection of the source (the only actor that can) leaves the item void with its reason; source_status follows the source'
UNION ALL SELECT 'distributed_then_void_is_void',
       (SELECT c.dv_status = 'void' AND c.dv_reason = 'Probe: issued against the wrong DB'
           AND c.dv_closed_at IS NULL AND c.dv_closed_by IS NULL AND c.dv_bic IS NULL
           AND c.dv_voided_n = 1 AND c.dv_voided_actor_null FROM fm_ctx c),
       'a manager may void a distributed form (00179:399-401; the void action admits it): closed → void on the spine with the reason, the guard''s exempt path clears closed_at / closed_by on the non-close transition, and §11 records exactly one voided event (actor NULL on the service path — Task 11 review S2)'
UNION ALL SELECT 'ineligible_author_falls_to_triage',
       (SELECT c.cv_status = 'triage' AND c.cv_bic = c.admin2 AND c.cv_created_by = c.cv AND c.cv_gate = c.chain_pm FROM fm_ctx c),
       'the F10 flag is ELIGIBILITY, not created_by IS NOT NULL: a client-viewer author (a trusted-role insert with an explicit created_by) is not an explicit owner, so the item is born triage on the chain''s answer; created_by still records the author'
UNION ALL SELECT 'arm_2_resolves_through_the_form_key',
       (SELECT c.cv_assignee = c.admin2 FROM fm_ctx c),
       'the ''form_action'' literal passed to resolve_mirror_assignee reaches work_item_defaults.form_action.triage_owner_id: the chain skips the ineligible author and answers arm 2'
UNION ALL SELECT 'live_move_reruns_the_chain_through_the_form_key',
       (SELECT c.cvm_status = 'triage' AND c.cvm_project = c.proj2 AND c.cvm_assignee = c.admin3
           AND c.cvm_assignee <> c.admin2 AND c.cvm_assignee <> c.pm AND c.cvm_gate = c.chain_pm FROM fm_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''form_action'' literal — a typo key would fall to the owner; the gatekeeper is the PM chain again'
-- F7 / §03 §1.2: the WHEN clause.
UNION ALL SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_updated FROM fm_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes only as_left_status (unwatched) must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
-- Task 8 review S1: a closed item's people are part of the record.
UNION ALL SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.mvc_status = 'closed' AND c.mvc_assignee = c.admin2 AND c.mvc_gate = c.chain_pm
           AND c.mvm_status = 'closed' AND c.mvm_project = c.proj3
           AND c.mvm_assignee = c.admin2 AND c.mvm_assignee <> c.pm
           AND c.mvm_gate = c.chain_pm FROM fm_ctx c),
       'a DISTRIBUTED form moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only'
-- The state machine runs BEFORE the mirror.
UNION ALL SELECT 'illegal_transition_leaves_the_item',
       (SELECT c.ill_uid = c.pm AND c.ill_cleared
           AND c.ill_err LIKE 'Illegal site-form transition draft -> distributed%'
           AND c.ill_sqlstate = '42501'
           AND c.ill_form_status = 'draft'
           AND c.ill_after_status = c.ill_before_status AND c.ill_before_status IN ('triage','open')
           AND c.ill_after_closed_at IS NULL AND c.ill_before_closed_at IS NULL
           AND c.ill_after_src = 'draft' FROM fm_ctx c),
       'trg_site_forms_transition (BEFORE, 00179:415) refuses draft → distributed for a signed-in owner with its own sentence at depth 1; the mirror is AFTER and never fires, so the item stays open and unclosed — never convert the mirror to BEFORE'
-- ── 11-delete-to-void.sql ─────────────────────────────────────────
UNION ALL SELECT 'nine_items_existed' AS probe,
       (SELECT count(*) FROM del_ctx) = 9
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status IN ('triage','open')) = 7
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status = 'closed') = 1
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status = 'void') = 1 AS ok,
       'the fixture must actually have produced items — seven live, one closed, one already void — or every row below passes vacuously' AS detail
UNION ALL SELECT 'deletes_succeeded',
       NOT EXISTS (SELECT 1 FROM projects.rfis r               JOIN del_ctx d ON d.src = r.id)
       AND NOT EXISTS (SELECT 1 FROM field.snags s             JOIN del_ctx d ON d.src = s.id)
       AND NOT EXISTS (SELECT 1 FROM inspections.inspections i JOIN del_ctx d ON d.src = i.id)
       AND NOT EXISTS (SELECT 1 FROM field.site_forms f        JOIN del_ctx d ON d.src = f.id)
       AND NOT EXISTS (SELECT 1 FROM projects.qc_entries e     JOIN del_ctx d ON d.src = e.id)
       AND NOT EXISTS (SELECT 1 FROM projects.site_diary_entries y JOIN del_ctx d ON d.src = y.id),
       'F1: every source row is gone — with AFTER DELETE (or no trigger) the DELETE itself aborts on work_items_source_required and this probe returns no rows at all'
UNION ALL SELECT 'all_voided_with_reason',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE d.pre_status <> 'void' AND w.status = 'void' AND w.void_reason = 'source deleted') = 8,
       'the eight non-void items (seven live, one closed) are voided BEFORE the RI SET NULL empties their source column, with the reason on the same statement — the exempt guard path performs no reason check at depth 2, so the trigger is the only reason-supplier'
UNION ALL SELECT 'fk_is_null',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE w.rfi_id IS NULL AND w.snag_id IS NULL AND w.inspection_id IS NULL
           AND w.qc_entry_id IS NULL AND w.diary_id IS NULL AND w.site_form_id IS NULL) = 9,
       'ON DELETE SET NULL still applied, after the void — on a void row work_items_source_required and work_items_one_source both pass'
UNION ALL SELECT 'bic_cleared',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE w.ball_in_court_id IS NULL) = 9,
       'A(a): the generated column is NULL on void, so the item leaves every inbox — nothing in the trigger clears it'
UNION ALL SELECT 'events_survive',
       (SELECT count(DISTINCT d.item) FROM del_ctx d
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'created') = 9,
       '§03 §1.2: the events are why this is SET NULL and not a CASCADE — every item still carries its created event after its source is gone'
UNION ALL SELECT 'voided_event_written_once',
       (SELECT count(*) FROM del_ctx d
         WHERE d.pre_status <> 'void'
           AND (SELECT count(*) FROM projects.work_item_events e
                 WHERE e.work_item_id = d.item AND e.verb = 'voided'
                   AND e.from_status = d.pre_status AND e.to_status = 'void') = 1) = 8,
       '§11 at depth 2: exactly one `voided` event per newly-voided item, from its pre-delete status to void'
UNION ALL SELECT 'voided_event_actor_is_the_deleter',
       (SELECT count(*) FROM del_ctx d JOIN imp_ctx c ON true
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'voided'
         WHERE d.kind IN ('diary_live','diary_closed') AND e.actor_id = c.ctr AND e.actor_role = 'contractor') = 2,
       '§11 writes the event with auth.uid(): under impersonation the actor is rbac-test, the person who deleted the entry, stamped with their effective role — a definer trigger reading current_user would have recorded postgres'
UNION ALL SELECT 'service_path_voided_event_actor_is_null',
       (SELECT count(*) FROM del_ctx d
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'voided'
         WHERE d.kind IN ('rfi','snag','inspection','form','qc') AND e.actor_id IS NULL) = 6,
       'the six service-path deletes (deleteDiaryEntryAction''s shape: the service client, auth.uid() NULL) record no actor — nobody is invented'
UNION ALL SELECT 'impersonation_took',
       (SELECT c.who = 'authenticated' AND c.uid = c.ctr AND c.n_live = 1 AND c.n_closed = 1 FROM imp_ctx c),
       'both diary deletes ran as authenticated with auth.uid() = rbac-test and each touched exactly one row: the author DELETE policy (00149) admitted them and no trigger suppressed them'
UNION ALL SELECT 'report_delete_voids_entry_items',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE d.kind = 'qc' AND w.status = 'void' AND w.void_reason = 'source deleted' AND w.qc_entry_id IS NULL) = 2
       AND NOT EXISTS (SELECT 1 FROM projects.qc_entries e JOIN del_ctx d ON d.src = e.id WHERE d.kind = 'qc'),
       'qc_entries.report_id is ON DELETE CASCADE (00172:112): deleting the REPORT cascades to both entries, the entry-level BEFORE DELETE fires once per cascaded row (depth 2; the void UPDATE at depth 3, still exempt) and both items are voided before their FK is nulled'
UNION ALL SELECT 'closed_item_is_voided_on_source_delete',
       (SELECT d.pre_status = 'closed' AND w.status = 'void' AND w.void_reason = 'source deleted'
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'diary_closed'),
       'FORCED, not chosen: work_items_source_required admits a source-less mirror item only while void, so a closed item left closed with its FK nulled would abort the DELETE; closed → void is illegal on the machine at depth 1, so under impersonation this delete succeeds only through C''s depth-2 exemption'
UNION ALL SELECT 'closed_stamps_are_cleared_by_the_void',
       (SELECT d.pre_closed_at IS NOT NULL AND d.pre_closed_by IS NOT NULL
           AND w.closed_at IS NULL AND w.closed_by IS NULL
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'diary_closed'),
       'the negation of closed_stamps_survive_the_void, pinned honestly: the VOID is a constraint necessity (work_items_source_required forces void for a source-less mirror item; no constraint names closed_at / closed_by), the STAMP LOSS is C''s exempt-path rule (IF NEW.status = ''closed'' THEN closed_at := now() ELSE closed_at := NULL; closed_by := NULL — inherited from 00196:1545-1546), which section F cannot preserve — so WHEN and BY WHOM the item was closed survive only in the closed and voided events. Kept as built: stamps ⇔ closed stays a simple invariant. Alternatives for the owner: keep the stamps on closed → void in C''s exempt path (one line, item 3''s migration — a void row would then carry close stamps), or admit closed in work_items_source_required (item 2) — deviation 21'
UNION ALL SELECT 'void_item_keeps_its_reason',
       (SELECT d.pre_status = 'void' AND w.status = 'void'
           AND w.void_reason = 'Probe: site closed for the season' AND w.void_reason = d.pre_reason
           AND w.inspection_id IS NULL
           AND (SELECT count(*) FROM projects.work_item_events e WHERE e.work_item_id = w.id AND e.verb = 'voided') = d.pre_voided_n
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'void_inspection'),
       'an already-void item is left alone (status <> ''void'' in the trigger''s WHERE): it keeps the reason its own projection supplied and gains no voided event (a born-void item''s only event is created — the count is compared to its pre-delete value, not to a literal); only the RI SET NULL touches it'
UNION ALL SELECT 'claim_cleared',
       auth.uid() IS NULL,
       'set_config(…, true) outlives RESET ROLE; the impersonating block must clear the claim before the service-path rows above are read'
-- ── 13-backfill.sql ───────────────────────────────────────────────
UNION ALL SELECT 'rfi_count' AS probe, count(*) = 15 AS ok, 'got ' || count(*) || ' of 15' AS detail
  FROM live WHERE item_type = 'rfi' AND origin = 'mirror'
UNION ALL SELECT 'inspection_count', count(*) = 19, 'got ' || count(*) || ' of 19 (the plan says 18; 19 since 2026-09-13)'
  FROM live WHERE item_type = 'inspection' AND origin = 'mirror'
UNION ALL SELECT 'form_count', count(*) = 1, 'got ' || count(*) || ' of 1'
  FROM live WHERE item_type = 'form_action' AND origin = 'mirror'
UNION ALL SELECT 'snag_count_is_zero', count(*) = 0,
       'improvement 2: all 6 live snags are E-Site DEMO fixtures; got ' || count(*)
  FROM live WHERE item_type = 'snag' AND origin = 'mirror'
UNION ALL SELECT 'diary_count_is_zero', count(*) = 0,
       'improvement 1: all 6 of 6 live "delays" say None; got ' || count(*) ||
       ' (the only count with no positive counterpart here — the diary arm is deliberately absent from the backfill, and probe 09 is where the live trigger IS proved to project a real delay)'
  FROM live WHERE item_type = 'diary_action' AND origin = 'mirror'
UNION ALL SELECT 'qc_count_is_zero', count(*) = 0,
       'F4: zero conformance=fail rows exist on the live estate; the arm is exercised by the synthetic fixture below, not here; got ' || count(*)
  FROM live WHERE item_type = 'qc_defect' AND origin = 'mirror'
UNION ALL SELECT 'no_order_followup_anywhere', count(*) = 0,
       '453 structure.node_orders rows (the plan said 440), deliberately zero items — A(b) gives order_followup no automatic path'
  FROM projects.work_items WHERE item_type = 'order_followup'
UNION ALL SELECT 'total_live_items', count(*) = 35,
       'got ' || count(*) || ' of 35 expected (15 rfi + 19 inspection + 1 form; the plan''s 34 counted 18 inspections on 2026-09-10)'
  FROM live WHERE origin = 'mirror'
UNION ALL SELECT 'nothing_from_the_demo_org', count(*) = 0,
       'improvement 2: no item may belong to E-Site DEMO; got ' || count(*)
  FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
 WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001' AND w.origin = 'mirror'
-- Improvement 9, both halves. The write-back fires during the backfill (rule
-- (a) is the point) and must leave every finished record alone.
UNION ALL SELECT 'writeback_skipped_closed_rfis',
       (SELECT count(*) FROM projects.rfis r JOIN projects.projects p ON p.id = r.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND r.assigned_to IS NULL) = 6,
       'before: 15 unassigned. after: 6 — exactly the 6 CLOSED RFIs, which must not acquire an assignee they never had'
UNION ALL SELECT 'writeback_filled_open_rfis',
       (SELECT count(*) FROM projects.rfis r JOIN projects.projects p ON p.id = r.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND r.status <> 'closed' AND r.assigned_to IS NULL) = 0,
       'all 9 non-closed RFIs (8 open + 1 responded) now render a holder on rfis/[id] instead of "unassigned"'
UNION ALL SELECT 'snag_assignees_untouched',
       (SELECT count(*) FROM field.snags s JOIN projects.projects p ON p.id = s.project_id
         WHERE p.name NOT LIKE '\_probe\_%' AND s.assigned_to IS NULL) = 6,
       'no live snag was backfilled, so no live snag acquired an assignee'
-- The floor, per project (improvements 6 + 9). Section H computes it through
-- projects.add_working_days + push_past_builders_shutdown so each project's own
-- calendar and shutdown band decide it; the plan's single DATE '2026-11-10'
-- literal was a second calendar.
UNION ALL SELECT 'due_dates_floored', count(*) = 0,
       'no OPEN backfilled item may be due before its project''s go_live + 5 office working days; got ' || count(*)
  FROM live l JOIN floors f ON f.project_id = l.project_id
 WHERE l.origin = 'mirror' AND l.status IN ('triage','open','answered')
   AND l.due_date < f.floor
-- I3 (whole-branch review). The two rows above hold just as well against a
-- hard-coded DATE '2026-11-10': every LIVE project answers exactly that date,
-- so neither of them can tell section H's per-project computation from the
-- literal the plan first specified (measured — swapping the literal in left the
-- whole rehearsal at 266/266). This row can, and it reads the ITEM's own
-- due_date rather than the probe's `floors` CTE — the CTE recomputes the floor
-- with the same two functions and would agree with itself whatever H did.
-- _probe_snag_backfill carries a builders' shutdown band over 2026-11-10
-- (13-backfill-fixtures.sql), so its backfilled item must be floored PAST the
-- band, to 2026-11-21. Under the literal it would sit on 2026-11-10.
UNION ALL SELECT 'floor_is_computed_per_project',
       (SELECT w.due_date FROM projects.work_items w
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_snag_backfill' AND w.origin = 'mirror'
           AND w.status IN ('triage','open','answered')
         ORDER BY w.due_date DESC LIMIT 1)
         = projects.push_past_builders_shutdown(
             projects.add_working_days(DATE '2026-11-03', 5,
               (SELECT id FROM projects.projects WHERE name = '_probe_snag_backfill'), 'office'),
             (SELECT id FROM projects.projects WHERE name = '_probe_snag_backfill')),
       'the shutdown-band project''s item must be floored past its band (2026-11-21), not to the 2026-11-10 every other project gets; got '
         || COALESCE((SELECT w.due_date::text FROM projects.work_items w
                        JOIN projects.projects p ON p.id = w.project_id
                       WHERE p.name = '_probe_snag_backfill' AND w.origin = 'mirror'
                         AND w.status IN ('triage','open','answered')
                       ORDER BY w.due_date DESC LIMIT 1), '<no live item>')
UNION ALL SELECT 'closed_items_not_refloored', count(*) = 0,
       'improvement 9: a July record must not acquire a November deadline; got ' || count(*)
  FROM live l JOIN floors f ON f.project_id = l.project_id
 WHERE l.origin = 'mirror' AND l.status IN ('closed','void') AND l.due_date = f.floor
-- The floor UPDATE runs on the spine and reaches the SOURCE through section E
-- (depth 1). Without this row the floor could be applied to the spine alone and
-- the RFI page would keep showing the old, already-overdue date.
UNION ALL SELECT 'floor_reaches_the_rfi_source',
       (SELECT count(*) FROM live l
          JOIN projects.rfis r ON r.id = l.rfi_id
          JOIN floors f ON f.project_id = l.project_id
         WHERE l.origin = 'mirror' AND l.status IN ('triage','open','answered')
           AND r.due_date IS DISTINCT FROM f.floor) = 0
       AND (SELECT count(*) FROM live l
             WHERE l.origin = 'mirror' AND l.item_type = 'rfi'
               AND l.status IN ('triage','open','answered')) = 9,
       'all 9 open RFIs carry the floored date on projects.rfis too — the spine UPDATE fires the write-back at depth 1 and the chain ends there (rfis.due_date is not in the mirror _upd trigger''s UPDATE OF list)'
UNION ALL SELECT 'every_open_item_has_a_holder', count(*) = 0,
       'A(a): ball_in_court_id is NOT NULL on every non-terminal item; got ' || count(*)
  FROM live
 WHERE origin = 'mirror' AND status IN ('triage','open','answered') AND ball_in_court_id IS NULL
UNION ALL SELECT 'events_written_but_no_bells',
       (SELECT count(*) FROM projects.work_item_events) > 0
   AND (SELECT count(*) FROM public.notifications
         WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
       '§12 §(d): events ARE written (the metrics need them); the bell half is VACUOUS until item 4 adds the emit and the esite.suppress_notifications guard to §11 (00196:1354-1356) — and none of those three types is in notifications_type_check yet either. Kept so the assertion is already in place'
-- Section I. F11: `event` is a fixed CHECK vocabulary (00194:231-238) and
-- 'backfill_completed' is its arm for this.
UNION ALL SELECT 'completion_event_written',
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
-- #4: the backfill keeps history; §11 dates `created` at opened_at.
-- MAX, not the plan's MIN: with MIN a regression in ONE arm is invisible
-- behind the oldest item of another (the oldest inspection is 2026-05-21).
-- ⚠ The window below is a COARSE guard and it decays: raise one RFI in the 24h
-- before a rehearsal and it reds for a reason that has nothing to do with the
-- backfill. opened_at_matches_each_source is the exact, non-decaying half — it
-- compares every item to ITS OWN source row, so it is the one to read first.
UNION ALL SELECT 'opened_at_matches_each_source',
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
UNION ALL SELECT 'opened_at_is_historical',
       (SELECT max(opened_at) FROM live WHERE origin = 'mirror') < now() - interval '1 day',
       'every INSERT supplies opened_at = the source''s created_at (qc: GREATEST(entry, issued_at)) and §5 keeps it on the service path (00196:629-636); the NEWEST backfilled item must still predate the apply, or metric 5''s denominator gets 35 items in one week. Newest live source: an inspection of 2026-09-11'
-- ⚠ Measured: this row pins ITEM 2's §11, not item 3's arms. Replacing D.1 and
-- D.3's opened_at with now() reds opened_at_is_historical and leaves this GREEN
-- — §11 dates the created event at NEW.opened_at whatever that value is, so the
-- two stay equal. It is kept because it is the other half of the invariant: if
-- item 4's CREATE OR REPLACE of append_work_item_event() ever dates `created`
-- at now(), the backfill's whole history lands in the apply week and only this
-- row says so.
UNION ALL SELECT 'created_event_dated_at_opened_at',
       NOT EXISTS (SELECT 1 FROM projects.work_item_events e JOIN live w ON w.id = e.work_item_id
                    WHERE w.origin = 'mirror' AND e.verb = 'created' AND e.created_at <> w.opened_at)
       AND (SELECT count(*) FROM projects.work_item_events e JOIN live w ON w.id = e.work_item_id
             WHERE w.origin = 'mirror' AND e.verb = 'created') = 35,
       '00196:1366-1376: the created event is dated at NEW.opened_at, so a historical opened_at dates the event historically — and there are exactly 35 of them, so the row cannot pass on an empty join'
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
UNION ALL SELECT 'no_non_member_watchers_on_mirrors',
       (SELECT count(*) FROM projects.work_item_watchers ww
          JOIN projects.work_items w ON w.id = ww.work_item_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE w.origin = 'mirror'
           AND (p.name NOT LIKE '\_probe\_%' OR p.name = '_probe_snag_backfill')
           AND public.user_effective_project_role(w.project_id, ww.user_id) IS NULL) = 0,
       'section H''s last statement removes watchers with no effective role on the project (backfill-only: a live-path raiser is a current member by construction)'
-- Improvement 3: the distribution, not just the totals. This detail string is
-- the day-one list the owner reviews (Task 19).
UNION ALL SELECT 'at_least_three_distinct_holders',
       (SELECT count(*) FROM holders) >= 3,
       'holders: ' || COALESCE((SELECT string_agg(COALESCE(pr.full_name, h.uid::text) || '=' || h.n, ', ' ORDER BY h.n DESC)
                                  FROM holders h LEFT JOIN public.profiles pr ON pr.id = h.uid), '(none)')
-- §15: an empty inbox cannot be driven to zero, and neither can a forty-item
-- one. Measured 2026-09-15 — the day-one list, which is Task 19's input:
--   Arno Mattheus 17 · johanb 6 · chris 5 · Admin Siyaya 1  (= 29; the other 6
--   are the closed RFIs, whose ball_in_court_id is NULL by A(a)).
-- The org owner's 17 is 9 open RFIs (all fifteen are unassigned, so each
-- resolves through the chain to its project's triage owner — the project's
-- creator) + 7 inspections + the 1 form. The plan's ceiling of 20 holds.
UNION ALL SELECT 'no_holder_over_twenty',
       COALESCE((SELECT max(n) FROM holders), 0) <= 20,
       'heaviest inbox on day one: ' || COALESCE((SELECT max(n)::text FROM holders), '0')
       || ' of ' || (SELECT count(*) FROM live WHERE origin = 'mirror')
       || ' items (17 measured 2026-09-15; a chain regression that hands one person everything reads 29)'
UNION ALL SELECT 'no_item_on_a_client_viewer',
       (SELECT count(*) FROM live l
         WHERE l.origin = 'mirror' AND l.ball_in_court_id IS NOT NULL
           AND public.user_effective_project_role(l.project_id, l.ball_in_court_id) = 'client_viewer') = 0,
       'improvement 7: a client viewer cannot clear an item until Q3, so no backfilled item may land on one'
-- ── The synthetic QC fixture (F4). Seeded by 13-backfill-fixtures.sql BEFORE
--    the migration, so the BACKFILL arm is what projects it. These rows read
--    projects.work_items directly: the fixture project IS a '_probe_%' project.
UNION ALL SELECT 'qc_fixture_projects_three',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance = 'fail') = 3,
       'three failures out of a 43-line issued report reach the spine (0 means the qc arm or the fixture stack order is wrong)'
UNION ALL SELECT 'qc_fixture_ignores_forty',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance <> 'fail') = 0,
       'A(b): mirroring every issued entry would manufacture ~40 items from one report'
UNION ALL SELECT 'qc_fixture_priority_spread',
       (SELECT count(DISTINCT w.priority) FROM projects.work_items w
          JOIN projects.qc_entries e ON e.id = w.qc_entry_id
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_qc_backfill' AND e.conformance = 'fail') = 3,
       'severity maps to three distinct priorities (minor→low, major→high, critical→critical), never a flat medium'
-- Deviation 18 (3): a defect is born at ISSUE, not pre-aged to its draft date.
-- The fixture's entries are 45 days old and the report was issued 30 days ago,
-- so GREATEST picks the issue and neither stamp alone would give that answer.
UNION ALL SELECT 'qc_fixture_is_born_at_issue',
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
-- ── The synthetic snag (improvement 2). The demo exclusion must exclude the
--    DEMO ORG, not disable the snag arm.
UNION ALL SELECT 'snag_arm_includes_non_demo_orgs',
       (SELECT count(*) FROM projects.work_items w
          JOIN projects.projects p ON p.id = w.project_id
         WHERE p.name = '_probe_snag_backfill' AND w.item_type = 'snag' AND w.origin = 'mirror') = 1,
       'a snag on a NON-demo project IS backfilled — this is the assertion that stops improvement 2 being read as "snags are not mirrored"'
-- ── 05b-guard-exemption.sql ───────────────────────────────────────
UNION ALL SELECT 'ran_as_authenticated' AS probe,
       (SELECT who = 'authenticated' AND ctr_uid = ctr AND pm_uid = pm FROM gd_ctx) AS ok,
       'without this a probe that silently stayed postgres is indistinguishable from one that worked' AS detail
UNION ALL SELECT 'contractor_respond_pushed_back',
       (SELECT resp_status = 'answered' FROM gd_ctx),
       'F8: triage → answered through the mirror in a signed-in session. Without the exemption item 2''s (c) refuses it ON THE RFI RESPOND. Got: ' || (SELECT COALESCE(resp_status, '<null>') FROM gd_ctx)
UNION ALL SELECT 'direct_title_edit_refused',
       (SELECT title_err LIKE '%mirrored from its source record%' FROM gd_ctx),
       'the exemption is depth-scoped: a client statement is depth 1 and (a2) still bites. Got: ' || (SELECT title_err FROM gd_ctx)
UNION ALL SELECT 'direct_source_status_edit_refused',
       (SELECT src_status_err LIKE '%cannot be renumbered, retyped or moved%' FROM gd_ctx),
       'source_status joined clause (a) (00196:1600-1605 books it here). Got: ' || (SELECT src_status_err FROM gd_ctx)
UNION ALL SELECT 'direct_status_change_refused_for_non_gatekeeper',
       (SELECT close_err LIKE '%Only the person who signs%off can close it%' FROM gd_ctx),
       '(d) still answers a depth-1 close by the holder who is not the gatekeeper. Got: ' || (SELECT close_err FROM gd_ctx)
UNION ALL SELECT 'raiser_close_pushed_back',
       (SELECT close_status = 'closed' AND close_by = ctr FROM gd_ctx),
       'the raiser-gatekeeper closes through the source; closed_by is what the mirror supplied. Got: ' || (SELECT COALESCE(close_status, '<null>') || ' by ' || COALESCE(close_by::text, '<null>') FROM gd_ctx)
UNION ALL SELECT 'pm_close_through_source_succeeds',
       (SELECT pm_close_status = 'closed' FROM gd_ctx),
       'a non-gatekeeper close through the module''s own path is followed by the spine; (d) is skipped at depth 2. Got: ' || (SELECT COALESCE(pm_close_status, '<null>') FROM gd_ctx)
UNION ALL SELECT 'governed_direct_write_still_works',
       (SELECT pm_gate = ctr AND pm_gate_err = '<no error>' FROM gd_ctx),
       'clause (b): the PM re-seats an open item''s gatekeeper directly at depth 1 — the exemption narrowed nothing for a governing client. Got: ' || (SELECT pm_gate_err || ', gatekeeper ' || COALESCE(pm_gate::text, '<null>') FROM gd_ctx)
UNION ALL SELECT 'claim_cleared',
       current_user = 'postgres' AND auth.uid() IS NULL,
       'Task 1 rule 3: the claim is transaction-local and must be cleared before the assertion SELECT'
-- ── 16-as-a-real-user.sql ─────────────────────────────────────────
UNION ALL SELECT 'identity_cleared' AS probe,
       current_user = 'postgres' AND auth.uid() IS NULL AS ok,
       'Task 1 rule 3: the claim is transaction-local and outlives RESET ROLE, so every assertion below is read as postgres with no identity' AS detail
UNION ALL SELECT 'insert_really_ran_as_authenticated',
       (SELECT who = 'authenticated' AND ctr_uid = ctr AND pm_uid = pm FROM rls_ctx),
       'without this, a probe that silently fell back to postgres looks identical to one that worked. Got: ' ||
       (SELECT COALESCE(who, '<null>') || ', contractor uid ' || COALESCE(ctr_uid::text, '<null>')
               || ', owner uid ' || COALESCE(pm_uid::text, '<null>') FROM rls_ctx)
UNION ALL SELECT 'contractor_rfi_insert_succeeded',
       (SELECT rfi_a IS NOT NULL FROM rls_ctx),
       'F9: as authenticated, not postgres — the whole point of SECURITY DEFINER on the mirror. (This row cannot print FAIL: a refused INSERT aborts the whole rehearsal, which is exactly how the stripped-definer mutant manifests. It is here to name the precondition the rows below depend on.)'
UNION ALL SELECT 'item_was_projected_under_the_contractors_identity',
       (SELECT count(*) FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror') = 1,
       'the projection ran inside a signed-in session and still wrote projects.work_items'
UNION ALL SELECT 'contractor_cannot_write_that_row_by_hand',
       (SELECT ins_state = '42501'
               AND ins_err LIKE '%row-level security policy%'
               AND ins_err LIKE '%work_items%' FROM rls_ctx),
       'item 2''s RESTRICTIVE INSERT gate (00196:1174-1196) refuses every mirrored type to a client session — the refusal names work_items, not rfis. Got: ' ||
       (SELECT COALESCE(ins_state, '<null>') || ' ' || COALESCE(ins_err, '<null>') FROM rls_ctx)
UNION ALL SELECT 'holder_is_not_the_contractor',
       (SELECT w.assignee_id <> c.ctr FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'the resolved holder is a value the contractor could not have written themselves'
UNION ALL SELECT 'gatekeeper_is_the_contractor',
       (SELECT w.gatekeeper_id = c.ctr FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'improvement 4 / gatekeeper_rule = creator: the raiser signs it off, and here the raiser is a contractor'
-- ⚠ This row states FACTS the arms key on; it does not exercise the policy.
-- Measured (Task 16 review): stripping the assignee, gatekeeper and watcher
-- arms out of work_items_select entirely leaves this probe 16/16 and still
-- printing gatekeeper=true watcher=true — because project_access alone already
-- admits the reader, so the other arms are not load-bearing for the raiser and
-- cannot be isolated by this fixture. The half that carries weight is
-- NOT arm_assignee.
UNION ALL SELECT 'select_arm_facts_for_the_raiser',
       (SELECT arm_access AND NOT arm_assignee AND arm_gatekeeper AND arm_watcher FROM rls_ctx),
       'the raiser is NOT the assignee — items 5 and 6 must not build "my work" on assignee_id. project_access alone already admits them; this row pins the facts the arms key on, not which arm answers. Got: ' ||
       (SELECT 'project_access=' || COALESCE(arm_access::text, '<null>')
             || ' assignee=' || COALESCE(arm_assignee::text, '<null>')
             || ' gatekeeper=' || COALESCE(arm_gatekeeper::text, '<null>')
             || ' watcher=' || COALESCE(arm_watcher::text, '<null>') FROM rls_ctx)
UNION ALL SELECT 'writeback_reached_the_source',
       (SELECT r.assigned_to IS NOT NULL AND r.assigned_to = w.assignee_id AND r.due_date = w.due_date
          FROM projects.rfis r, projects.work_items w, rls_ctx c
         WHERE r.id = c.rfi_a AND w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'the write-back is SECURITY DEFINER too and bypasses the RLS on projects.rfis. Got: ' ||
       (SELECT COALESCE(r.assigned_to::text, '<null>') || ' due ' || COALESCE(r.due_date::text, '<null>')
          FROM projects.rfis r, rls_ctx c WHERE r.id = c.rfi_a)
UNION ALL SELECT 'contractor_subject_edit_reprojects_the_title',
       (SELECT c.subject_rows = 1 AND w.title = c.subject_after
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       '(a2) would refuse a hand edit of a mirrored title at depth 1; the source edit re-projects at depth 2. Got: ' ||
       (SELECT COALESCE(c.subject_rows::text, '<null>') || ' row(s), title ' || COALESCE(w.title, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror')
-- ⚠ Near-duplicate of 05b's direct_status_change_refused_for_non_gatekeeper
-- (same shape, same sentence, RFI seeded as postgres in both) — kept for a
-- readable narrative here, but it carries no identity increment over 05b. The
-- row BELOW it does: 05b has no close performed BY the gatekeeper at depth 1.
UNION ALL SELECT 'contractor_cannot_close_what_they_do_not_gatekeep',
       (SELECT close_state = 'P0001'
               AND close_err LIKE '%Only the person who signs%off can close it%' FROM rls_ctx),
       'clause (d), at depth 1, against auth.uid(). Got: ' ||
       (SELECT COALESCE(close_state, '<null>') || ' ' || COALESCE(close_err, '<null>') FROM rls_ctx)
UNION ALL SELECT 'the_gatekeeper_can_close_it',
       (SELECT c.pm_close_rows = 1 AND w.status = 'closed' AND w.closed_by = c.pm
               AND w.closed_at IS NOT NULL
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_b AND w.origin = 'mirror'),
       'the same statement, by the person the item points at: the guard stamps closed_by := auth.uid(). Got: ' ||
       (SELECT COALESCE(c.pm_close_rows::text, '<null>') || ' row(s), ' || w.status
               || ' by ' || COALESCE(w.closed_by::text, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_b AND w.origin = 'mirror')
UNION ALL SELECT 'contractor_diary_entry_mirrored',
       (SELECT c.diary_item IS NOT NULL AND w.item_type = 'diary_action'
               AND w.created_by = c.ctr AND w.title LIKE 'Delay 2026-09-14: Crane stood down%'
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item),
       'a second source type projected under the same identity. Got: ' ||
       (SELECT COALESCE(w.title, '<null>') FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item)
UNION ALL SELECT 'authors_delete_voided_its_item',
       (SELECT c.diary_rows = 1 AND w.status = 'void' AND w.void_reason = 'source deleted'
               AND w.diary_id IS NULL
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item),
       'BEFORE DELETE voids first, then RI SET NULL lands on a void row. Got: ' ||
       (SELECT w.status || ' / ' || COALESCE(w.void_reason, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item)
-- ⚠ Probe 11 already pins the voided actor (voided_event_actor_is_the_deleter,
-- same actor_role = 'contractor' check) on the service side. This probe's
-- increment is upstream of the assertion: the contractor AUTHORS the diary
-- entry in their own signed-in session, so the mirror runs inside that session
-- rather than under a postgres-seeded fixture.
UNION ALL SELECT 'voided_event_actor_is_the_contractor',
       (SELECT count(*) FROM projects.work_item_events e, rls_ctx c
         WHERE e.work_item_id = c.diary_item AND e.verb = 'voided'
           AND e.actor_id = c.ctr AND e.actor_role = 'contractor') = 1,
       'probe 11 pins this shape; here the deleter is a real session, not the service path. Got: ' ||
       (SELECT COALESCE(string_agg(e.verb || '/' || COALESCE(e.actor_id::text, '<null>')
                                   || '/' || COALESCE(e.actor_role, '<null>'), ', ' ORDER BY e.seq), '<none>')
          FROM projects.work_item_events e, rls_ctx c WHERE e.work_item_id = c.diary_item)
UNION ALL SELECT 'source_row_is_gone',
       (SELECT NOT EXISTS (SELECT 1 FROM projects.site_diary_entries d, rls_ctx c WHERE d.id = c.diary)),
       'the DELETE completed: the void is what let work_items_source_required pass on the RI SET NULL';
