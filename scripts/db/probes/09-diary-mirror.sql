-- 09-diary-mirror.sql — Task 10: the diary_action projection (00198 section D.5,
-- the fourth copy of D.1's template and the one with the EMPTIEST source).
-- Asserted against production inside one rolled-back transaction:
--   projects.project_diary_action(uuid)        — the projection body (no recursion guard)
--   projects.mirror_diary_action_work_item()   — the trigger wrapper (depth guard, F2)
--   site_diary_entries_mirror_work_item_ins / _upd — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--
-- The centrepiece is the scope predicate (improvement 1): NOT "the text box
-- is non-empty" but projects.diary_delay_text(delays, delay_notes) IS NOT
-- NULL. Measured on production 2026-09-10 and re-read 2026-09-13: 6 of 6
-- entries a non-empty test would project are negations — 'None,' twice,
-- 'None' twice, 'NO', and the 2026-06-02 sentence 'No delays or info
-- required was noted in the site walk and or meeting'. Zero of the six is a
-- delay. The fixtures below are those live strings, verbatim, beside real
-- delays; the mutation that makes the two negative rows non-vacuous is the
-- plan's own (Task 10 Step 5: swap the predicate for
-- COALESCE(NULLIF(TRIM(delays),''), NULLIF(TRIM(delay_notes),'')) → both red).
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/09-diary-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section D.5 existed this reported 3/19: empty_entry_not_mirrored,
-- sentence_negation_not_mirrored and source_status_is_null pass VACUOUSLY
-- (nothing projects anything, so "no item" and "NULL source_status" are
-- trivially true — the fixture-quality warning the plan's Step 2 names); every
-- other row reads a NULL observation (a NULL `ok` is a FAIL in the harness,
-- never a coerced false). The plan's `no_delay_text_not_mirrored` row is NOT
-- here: it was a tautology, deleted as Step 4 instructs; edit_into_scope_mirrors
-- covers the property by projecting the same row only AFTER real text lands.
--
-- Walks from an empty project, never from seeded data (§12 §(h)): production's
-- 57 entries hold no delay at all, so a live fixture could never fail. Every
-- fixture RAISEs rather than skips: a NOTICE never reaches the Management API
-- caller, and a skipped fixture is a probe that cannot fail.
--
-- Runs as postgres with auth.uid() NULL throughout (no impersonation) — which
-- is the SERVICE PATH of the transition guard (00198 section C': v_actor IS
-- NULL skips authority and the machine, stamps closed_at = now() on a close,
-- keeps the supplied closed_by). That is how a diary item is CLOSED here:
-- projects.site_diary_entries has no closing state, so nothing on the source
-- can close one; the two closed-item rows close their item with a direct
-- UPDATE, exactly the shape section H's backfill and item 2's service client
-- write. §11 records a `closed` event with a NULL actor (the born-closed
-- backfill shape). A person's close goes through the machine on the spine
-- (triage → open → closed, gatekeeper only); that path is item 2's and
-- work-item-transition.sql already pins it.
--
-- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
-- in a FROM clause (42601), and sibling parts of one statement read the
-- pre-update snapshot — so every "after" observation is a separate SELECT
-- after the write, recorded into the temp table for the final SELECT.
-- now() is fixed for the whole transaction, so "did not re-project" is
-- measured the way probes 06/07/08 measure it: one entry is inserted with a
-- HISTORICAL updated_at, the INSERT path copies it into last_activity_at, and
-- a projection that should not have fired would have stamped now() over it.
-- (set_updated_at on site_diary_entries is BEFORE UPDATE only, 00002:160, so
-- the INSERT keeps the supplied value.)

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
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid) ON COMMIT DROP;
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
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id);
END $probe$;

SELECT 'empty_entry_not_mirrored' AS probe,
       (SELECT c.none_n = 0 FROM di_ctx c) AS ok,
       'the string is literally "None," — 2 of the 6 live rows say exactly this (vacuous before D.5; the non-empty-predicate mutation makes it real)' AS detail
UNION ALL
SELECT 'sentence_negation_not_mirrored',
       (SELECT c.sentence_n = 0 FROM di_ctx c),
       'the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough'
UNION ALL
SELECT 'real_delay_mirrored',
       (SELECT c.delay_n = 1 FROM di_ctx c),
       'a genuine delay must still project, or the stop-list has eaten the feature'
UNION ALL
SELECT 'title_carries_the_delay',
       (SELECT c.di_title = 'Delay 2026-06-24: Crane stood down 4h awaiting sparks' FROM di_ctx c),
       'the item must be readable in an inbox without opening the diary: Delay <entry_date>: <text>'
UNION ALL
SELECT 'source_status_is_null',
       (SELECT c.delay_n = 1 AND c.di_src IS NULL FROM di_ctx c),
       'the source has no status column, so there is nothing to mirror (NULL on both paths; map_source_status(''diary_action'', …) is always NULL) — on an item that EXISTS, so the row is not vacuous (S3)'
UNION ALL
SELECT 'negation_word_before_a_real_delay_projects',
       (SELECT c.eskom_n = 1 AND c.eskom_title = 'Delay 2026-09-12: No power on site — issue with Eskom' FROM di_ctx c),
       'Task 4''s narrowed sentence rule, the positive side: ''No power on site — issue with Eskom'' is a delay that begins with a negation word — the plan''s [^.]{0,80} rule swallowed it; it projects verbatim (S5)'
UNION ALL
SELECT 'edit_into_scope_mirrors',
       (SELECT c.upgraded = 1 FROM di_ctx c),
       'adding real delay_notes to an existing entry brings it into scope — the _upd trigger''s delay_notes arm'
UNION ALL
-- Task 4 review I2: the stop-list is applied PER COLUMN.
SELECT 'delay_notes_alone_projects',
       (SELECT c.percol_title = 'Delay 2026-09-04: Late delivery of DB-04A' AND c.percol_status = 'triage' FROM di_ctx c),
       'delays = ''None'' beside delay_notes = ''Late delivery of DB-04A'' projects, titled from the surviving column: a None typed into one box must not silence a real delay in the other'
UNION ALL
SELECT 'redate_retitles_the_item',
       (SELECT c.redated = 'Delay 2026-09-05: Late delivery of DB-04A' FROM di_ctx c),
       'entry_date is in the title, so the _upd trigger watches it and a re-dated entry re-projects its title'
UNION ALL
-- Controller decision, Task 10: the downgrade path.
SELECT 'withdrawn_delay_voids_with_reason',
       (SELECT c.wd_live_status = 'triage' AND c.wd_live_reason IS NULL
           AND c.wd_void_status = 'void' AND c.wd_void_reason = 'delay withdrawn at source'
           AND c.wd_void_title = c.wd_live_title FROM di_ctx c),
       'a LIVE item whose delay text is edited to a negation is voided with a reason (a voided event and a reason, not a silent deletion); the title is kept — a NULL delay has nothing to say'
UNION ALL
SELECT 'withdrawal_writes_a_voided_event',
       (SELECT c.wd_voided_n = 1 AND c.wd_voided_actor_null FROM di_ctx c),
       '§11 records the trigger-driven void as one `voided` event (actor NULL on the service path; the PM on the live path) — the claim the row above makes, measured (S4)'
UNION ALL
SELECT 'void_is_terminal_when_delay_returns',
       (SELECT c.wd_return_status = 'void' AND c.wd_return_reason = 'delay withdrawn at source'
           AND c.wd_return_title = c.wd_void_title
           AND c.wd_return_title <> 'Delay 2026-09-08: Rain again, 2h lost'
           AND c.wd_ctid_before = c.wd_ctid_after FROM di_ctx c),
       'Task 4''s rule: void has no exit; an entry re-edited back into scope leaves the item void with its reason AND its title (Task 10 review, rule 2: a void row''s title is frozen — the record of what was withdrawn) and does not rewrite its tuple (same ctid — Task 11 review I2: rule 1''s early return never compares a void row''s title) — a genuinely new delay is a new entry'
UNION ALL
-- Task 10 review, rule 1: a closed record is not rewritten for nothing.
SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after AND c.cl_after_status = 'closed' FROM di_ctx c),
       'a withdrawal on an entry whose item is CLOSED changes nothing the record projects, so the UPDATE arm returns early and the tuple is not rewritten (same ctid) — before the early return the guard stamped last_activity_at = now() on it (measured by the review by ctid; now() is fixed here, so the ctid is the signal)'
UNION ALL
SELECT 'closed_item_survives_withdrawal',
       (SELECT c.cl_before_status = 'closed' AND c.cl_before_closed_at IS NOT NULL AND c.cl_before_closed_by = c.pm
           AND c.cl_after_status = 'closed' AND c.cl_after_closed_at = c.cl_before_closed_at
           AND c.cl_after_closed_by = c.pm AND c.cl_after_reason IS NULL
           AND c.cl_after_title = c.cl_before_title FROM di_ctx c),
       'the void rule applies to LIVE items only: a closed item (the delay was acted on) whose entry is later tidied to None stays closed with its stamps and title'
UNION ALL
SELECT 'arm_2_resolves_through_the_diary_key',
       (SELECT c.cv_assignee = c.admin2 AND c.cv_status = 'triage' FROM di_ctx c),
       'the ''diary_action'' literal passed to resolve_mirror_assignee reaches work_item_defaults.diary_action.triage_owner_id: a client-viewer author is ineligible and the chain answers arm 2, born triage'
UNION ALL
-- F7 / §03 §1.2: the WHEN clause.
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.same_last = c.hist_updated FROM di_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL
-- Task 8 review S1: a closed item's people are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.moved_status = 'closed' AND c.moved_project = c.proj2
           AND c.moved_assignee = c.admin2 AND c.moved_assignee <> c.pm
           AND c.moved_gate = c.chain_pm FROM di_ctx c),
       'a CLOSED delay moved to a project whose chain answers the owner: the item moves (improvement 8) but keeps the people it was closed with — the chain is re-run for a LIVE item only'
UNION ALL
-- Task 9 review I1 (via Task 12): the live-move arm.
SELECT 'live_move_reruns_the_chain_through_the_diary_key',
       (SELECT c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.admin2 AND c.livemv_assignee <> c.pm AND c.livemv_gate = c.chain_pm FROM di_ctx c),
       'improvement 8 on a LIVE item: the move re-runs the chain on the NEW project (arm 2 there = admin3) through the move arm''s ''diary_action'' literal — a typo key falls to the owner, a dropped v_live AND v_moved arm leaves it on admin2; the gatekeeper is the PM chain again'
UNION ALL
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'diary_action')
       AND (SELECT c.di_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'diary_action') AND c.di_origin = 'mirror'
              FROM di_ctx c),
       'the literal ''diary_action'' in project_diary_action() is exactly projects.work_item_types.key — a typo skips resolver arm 2 silently'
UNION ALL
SELECT 'born_triage_on_the_author',
       (SELECT c.di_status = 'triage' AND c.di_assignee = c.pm AND c.di_created_by = c.pm AND c.di_prio = 'medium' FROM di_ctx c),
       '§12 §(d): created_by → the chain, and no explicit assignee ⇒ triage (§03 §1.6): the diarist holds the delay until someone is assigned to act on it; created_by is the entry''s author; priority is the literal medium (no severity on the source)'
UNION ALL
SELECT 'gatekeeper_is_the_pm_not_the_author',
       (SELECT c.di_gate = c.chain_pm AND c.di_gate <> c.pm FROM di_ctx c),
       'A(b) / 00196:243 gatekeeper_rule = project_pm: resolve_work_item_gatekeeper(project, NULL) — the PM chain, never the entry''s author'
UNION ALL
SELECT 'due_date_is_the_registry_default',
       (SELECT c.di_due = c.default_due FROM di_ctx c),
       'no due date on the source: NULL through the floor, and §5 births A(b)''s +2 SITE working days from the SAST day, shutdown-pushed — the shortest offset on the board'
UNION ALL
SELECT 'historical_stamps_kept_on_insert',
       (SELECT c.di_opened = c.hist_created AND c.di_last = c.hist_updated FROM di_ctx c),
       '#4: opened_at = the entry''s created_at and last_activity_at = its updated_at on the INSERT path (§5 keeps them on the service path)';
