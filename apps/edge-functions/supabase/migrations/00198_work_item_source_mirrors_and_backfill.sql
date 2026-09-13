-- =============================================================================
-- Migration: 00198_work_item_source_mirrors_and_backfill.sql
-- Appendix A(f) Q1 ordinal 9. Depends on 00194 (ordinal 1), 00195 (ordinal 6,
--   item 2's slice) and 00196 (ordinal 7) being APPLIED — all three since 2026-09-12.
-- Description: Six projection entry points push module status into
--              projects.work_items; assignment and due date write back to
--              projects.rfis and field.snags; six BEFORE DELETE triggers void an
--              orphaned item; item 2's transition guard is REPLACED with the
--              depth-scoped exemption the mirror needs (00196:1590-1605 names
--              it); the rfi registry row's gatekeeper_rule becomes 'creator';
--              then the entity backfill runs under notification suppression and
--              records its own completion into public.product_events as
--              event = 'backfill_completed'. structure.node_orders gets NO
--              trigger (A(b)).
--
-- go_live: DATE '2026-11-03'  (Tuesday). Due-date floor for backfilled OPEN
--          items = go_live + 5 office working days = DATE '2026-11-10'
--          (Wed 4, Thu 5, Fri 6, Mon 9, Tue 10 — no SA public holiday in range).
--          Both literals are re-derived at merge in Task 20 Step 4.
--
-- Role dependency: applied by `supabase db push`, which connects as `postgres`
--          with auth.uid() NULL — the guard's service path (00196:1540). The
--          backfill's INSERTs (no guard on INSERT) and the floor UPDATE are
--          exempt on that path, and §5 keeps a supplied opened_at there
--          (00196:629-636). Nothing else depends on the role: the backfill
--          calls projects.project_*() directly and never UPDATEs a source row,
--          so field.site_forms' enforce_site_form_transition (00179:347) is
--          never entered.
--
-- Restore: additive only, except the guard replacement and the registry row.
--          To undo:
--            DELETE FROM projects.work_items
--             WHERE origin = 'mirror' AND created_at <= <apply timestamp>;
--            UPDATE projects.rfis r SET assigned_to = b.assigned_to, due_date = b.due_date,
--                   updated_at = b.updated_at
--              FROM projects.backup_00198_source_assignees b
--             WHERE b.kind = 'rfi' AND b.id = r.id;
--            UPDATE field.snags s SET assigned_to = b.assigned_to, updated_at = b.updated_at
--              FROM projects.backup_00198_source_assignees b
--             WHERE b.kind = 'snag' AND b.id = s.id;
--            UPDATE projects.work_item_types SET gatekeeper_rule = 'project_pm' WHERE key = 'rfi';
--            -- and re-run 00196 §12's CREATE OR REPLACE FUNCTION projects.work_items_transition_guard()
--          No source row is destroyed. The write-back is the only thing this
--          migration changes on a source table, and it rewrites `updated_at`
--          via the pre-existing set_updated_at triggers (rfis_updated_at
--          00002:100, snags_updated_at 00004:33) on the rows it touches —
--          which is why updated_at is in the snapshot. The floor UPDATE in
--          section H also reaches projects.rfis.due_date on the 9 open RFIs
--          through the write-back (improvement 11 is two-way for due_date on
--          the spine side only); the snapshot's due_date column restores it.
--
-- @verify:begin
-- table: projects.backup_00198_source_assignees
-- function: projects.work_item_person_eligible(uuid,uuid)
-- function: projects.resolve_mirror_assignee(uuid,text,uuid)
-- function: projects.resolve_work_item_gatekeeper(uuid,uuid)
-- function: projects.map_source_status(text,text)
-- function: projects.work_item_status_for_mirror(text,text,boolean)
-- function: projects.work_item_mirror_due_date(date)
-- function: projects.diary_delay_text(text,text)
-- function: projects.project_rfi(uuid)
-- function: projects.project_snag(uuid)
-- function: projects.project_inspection(uuid)
-- function: projects.project_qc_entry(uuid)
-- function: projects.project_diary_action(uuid)
-- function: projects.project_form_action(uuid)
-- function: projects.mirror_rfi_work_item()
-- function: projects.mirror_snag_work_item()
-- function: projects.mirror_inspection_work_item()
-- function: projects.mirror_qc_defect_work_item()
-- function: projects.mirror_qc_report_defects()
-- function: projects.mirror_diary_action_work_item()
-- function: projects.mirror_form_action_work_item()
-- function: projects.work_item_assignment_writeback()
-- function: projects.void_work_item_on_source_delete()
-- function: projects.work_items_transition_guard()
-- sql: SELECT p.prosrc ~ 'pg_trigger_depth\(\)\s*>\s*1' AND p.prosrc ~ 'source_status\s+IS DISTINCT FROM' AND p.prosrc !~ 'pg_trigger_depth\(\)\s*>\s*0' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'work_items_transition_guard'
-- sql: SELECT gatekeeper_rule = 'creator' FROM projects.work_item_types WHERE key = 'rfi'
-- trigger: rfis_mirror_work_item_ins ON projects.rfis
-- trigger: rfis_mirror_work_item_upd ON projects.rfis
-- trigger: snags_mirror_work_item_ins ON field.snags
-- trigger: snags_mirror_work_item_upd ON field.snags
-- trigger: inspections_mirror_work_item_ins ON inspections.inspections
-- trigger: inspections_mirror_work_item_upd ON inspections.inspections
-- trigger: qc_entries_mirror_work_item_ins ON projects.qc_entries
-- trigger: qc_entries_mirror_work_item_upd ON projects.qc_entries
-- trigger: qc_reports_mirror_defects ON projects.qc_reports
-- trigger: site_diary_entries_mirror_work_item_ins ON projects.site_diary_entries
-- trigger: site_diary_entries_mirror_work_item_upd ON projects.site_diary_entries
-- trigger: site_forms_mirror_work_item_ins ON field.site_forms
-- trigger: site_forms_mirror_work_item_upd ON field.site_forms
-- trigger: work_items_assignment_writeback_ins ON projects.work_items
-- trigger: work_items_assignment_writeback_upd ON projects.work_items
-- trigger: rfis_void_work_item ON projects.rfis
-- trigger: snags_void_work_item ON field.snags
-- trigger: inspections_void_work_item ON inspections.inspections
-- trigger: qc_entries_void_work_item ON projects.qc_entries
-- trigger: site_diary_entries_void_work_item ON projects.site_diary_entries
-- trigger: site_forms_void_work_item ON field.site_forms
-- grant_absent: anon SELECT ON projects.backup_00198_source_assignees
-- grant_absent: anon EXECUTE ON projects.work_item_person_eligible(uuid,uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_mirror_assignee(uuid,text,uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_work_item_gatekeeper(uuid,uuid)
-- grant_absent: anon EXECUTE ON projects.map_source_status(text,text)
-- grant_absent: anon EXECUTE ON projects.work_item_status_for_mirror(text,text,boolean)
-- grant_absent: anon EXECUTE ON projects.work_item_mirror_due_date(date)
-- grant_absent: anon EXECUTE ON projects.diary_delay_text(text,text)
-- grant_absent: anon EXECUTE ON projects.project_rfi(uuid)
-- grant_absent: anon EXECUTE ON projects.project_snag(uuid)
-- grant_absent: anon EXECUTE ON projects.project_inspection(uuid)
-- grant_absent: anon EXECUTE ON projects.project_qc_entry(uuid)
-- grant_absent: anon EXECUTE ON projects.project_diary_action(uuid)
-- grant_absent: anon EXECUTE ON projects.project_form_action(uuid)
-- grant_absent: anon EXECUTE ON projects.mirror_rfi_work_item()
-- grant_absent: anon EXECUTE ON projects.mirror_snag_work_item()
-- grant_absent: anon EXECUTE ON projects.mirror_inspection_work_item()
-- grant_absent: anon EXECUTE ON projects.mirror_qc_defect_work_item()
-- grant_absent: anon EXECUTE ON projects.mirror_qc_report_defects()
-- grant_absent: anon EXECUTE ON projects.mirror_diary_action_work_item()
-- grant_absent: anon EXECUTE ON projects.mirror_form_action_work_item()
-- grant_absent: anon EXECUTE ON projects.work_item_assignment_writeback()
-- grant_absent: anon EXECUTE ON projects.void_work_item_on_source_delete()
-- grant_absent: anon EXECUTE ON projects.work_items_transition_guard()
-- @verify:end
-- =============================================================================

-- ─── A. Pre-flight. Expected to pass; catches a rollback or a diverged branch. ──
DO $preflight$
BEGIN
  IF to_regclass('projects.work_items') IS NULL THEN
    RAISE EXCEPTION 'A(f) ordinal 7 (00196, the spine) has not been applied';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='projects' AND table_name='qc_entries'
                    AND column_name IN ('conformance','severity')
                  HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'projects.qc_entries is missing conformance/severity (00176:54,56)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname IN ('qc_entries_conformance_check','qc_entries_severity_check')
                  HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'the qc_entries conformance/severity CHECKs are absent (00176:60,67)';
  END IF;

  -- 00195 (item 2's slice of A(f) ordinal 6) adds exactly four columns. There is
  -- no suppress_all_outbound: see Task 20 Step 5 (owner decision).
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='projects' AND table_name='project_settings'
         AND column_name IN ('work_item_defaults','triage_owner_id',
                             'builders_shutdown_start_md','builders_shutdown_end_md')) <> 4 THEN
    RAISE EXCEPTION '00195 (work_item_defaults / triage_owner_id / builders_shutdown_*_md) has not been applied';
  END IF;

  IF (SELECT count(*) FROM projects.work_item_types
       WHERE key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action')) <> 6 THEN
    RAISE EXCEPTION 'the six mirrored A(b) types are not all registered';
  END IF;

  -- §11 seeds watchers on the PK (work_item_id, user_id) (00196:450); nothing
  -- in this migration writes that table, but its shape is what makes the
  -- SELECT policy's watcher arm meaningful for mirrored items.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='projects' AND tablename='work_item_watchers'
                    AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
                    AND indexdef ILIKE '%work_item_id%' AND indexdef ILIKE '%user_id%') THEN
    RAISE EXCEPTION 'projects.work_item_watchers has no PK/UNIQUE on (work_item_id, user_id) — item 2 owns it';
  END IF;

  -- Section C' CREATE OR REPLACEs item 2's guard. A replace of a MISSING function
  -- would silently create a guard that no trigger calls — refuse instead.
  IF to_regprocedure('projects.work_items_transition_guard()') IS NULL THEN
    RAISE EXCEPTION 'projects.work_items_transition_guard() is absent — 00196 §12 has not been applied';
  END IF;

  IF to_regclass('public.product_events') IS NULL THEN
    RAISE EXCEPTION 'A(f) ordinal 1 (public.product_events) has not been applied';
  END IF;

  -- F11. product_events.event is a fixed CHECK vocabulary (00194:231-238); section
  -- I writes 'backfill_completed'. Checked here so the failure is a sentence at
  -- the top, not a 23514 after the whole backfill has run.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.product_events'::regclass
                    AND pg_get_constraintdef(c.oid) ~ '''backfill_completed''') THEN
    RAISE EXCEPTION 'public.product_events.event does not admit ''backfill_completed'' (F11)';
  END IF;
END $preflight$;

-- ─── B. The mirror's resolver ────────────────────────────────────────────────
-- All three are SECURITY DEFINER with row_security off because they read
-- membership tables the calling contractor cannot see, and none of them uses
-- current_user: inside SECURITY DEFINER it is the function OWNER, which is what
-- made the first site-form transition trigger silently inert (00179:341-346,
-- function at :347). They take no caller identity at all — they answer
-- "who owns this project", not "who is asking".
--
-- NOT here, deliberately: projects.resolve_project_pm (00195) and
-- projects.resolve_work_item_assignee (00196) are item 2's and are READ, never
-- redefined. The second carries a caller-access guard (00196:861-863) that
-- returns NULL inside a source writer's session for an org member with no
-- project_members row — and projects.rfis' write policies are org-wide
-- (00027:44-50), so the RFI insert would abort on assignee_id NOT NULL. The
-- mirror therefore has its own chain below, with no caller guard: it is only
-- ever called from a trigger or the backfill, never by a client.
--
-- Grants: none. The REVOKE ALL … FROM PUBLIC / REVOKE EXECUTE … FROM anon for
-- these three functions land in section G with every other revoke in this
-- file, in one place (Task 13); the @verify block above already carries their
-- grant_absent: lines. Nothing is GRANTed to authenticated: unlike 00196's
-- resolve_work_item_assignee these are never called by a client.

-- One place, and only one place, decides whether a person may hold an item.
CREATE OR REPLACE FUNCTION projects.work_item_person_eligible(
    p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
  SELECT p_user_id IS NOT NULL
     -- Redundant by FK (user_organisations.user_id and project_members.user_id
     -- both REFERENCE profiles ON DELETE CASCADE, so no role row can outlive
     -- its profile); kept because it mirrors work_items.assignee_id → profiles.
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id)
     -- §03 §1.9 defers the client viewer's write set to Q3. Until then an item
     -- that lands on one can never be cleared: 00161 blocks their writes and
     -- work_items_bic_present keeps the row pointing at them. Delete this one
     -- clause in Q3; it is one line, and stranded items are a data migration.
     AND COALESCE(public.user_effective_project_role(p_project_id, p_user_id), 'none')
           NOT IN ('none', 'client_viewer')
$fn$;

-- The mirror's chain. Same shape as 00196's resolve_work_item_assignee, three
-- differences, all deliberate: (1) NO caller-access guard — this is called
-- from triggers and the backfill only, never by a client, and inside a source
-- writer's session the guard would return NULL for an org member with no
-- project_members row; (2) every candidate goes through
-- work_item_person_eligible, so client_viewer is excluded (improvement 7 —
-- item 2's picker resolver admits them, by decision, 00196:911-913);
-- (3) step 1b, default_rfi_assignee_id (§12 §(d) line 133, 00101:29).
-- The PM step and the created_by terminus are 00195's resolve_project_pm,
-- read as-is; when it returns NULL (an orphaned project) this raises the
-- SAME sentence 00196:901 raises, so a PM sees one message whichever path
-- produced it.
CREATE OR REPLACE FUNCTION projects.resolve_mirror_assignee(
    p_project_id uuid, p_item_type text, p_explicit uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_candidate uuid;
BEGIN
  -- 1. explicit
  IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
    RETURN p_explicit;
  END IF;

  -- 1b. RFI only: the per-project default (§12 §(d) line 133,
  --     00101_project_settings.sql:29). rfiService.create applies this at the
  --     application layer (rfi.service.ts:75-83) and no project sets it today,
  --     but the backfill is exactly the path where that never ran.
  IF p_item_type = 'rfi' THEN
    SELECT s.default_rfi_assignee_id INTO v_candidate
      FROM projects.project_settings s WHERE s.project_id = p_project_id;
    IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END IF;

  -- 2. per-type work_item_defaults.<type>.triage_owner_id. No FK behind the
  --    jsonb (§03 §1.5), so a stale id is discarded rather than raising.
  SELECT NULLIF(s.work_item_defaults #>> ARRAY[p_item_type, 'triage_owner_id'], '')::uuid
    INTO v_candidate
    FROM projects.project_settings s WHERE s.project_id = p_project_id;
  IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
    RETURN v_candidate;
  END IF;

  -- 3. project triage_owner_id (nullable by decision, §03 §1.6)
  SELECT s.triage_owner_id INTO v_candidate
    FROM projects.project_settings s WHERE s.project_id = p_project_id;
  IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
    RETURN v_candidate;
  END IF;

  -- 4 + 5. 00195's PM chain, validated end to end, terminating at a validated
  --        created_by. NULL only for an orphaned project (00195:118-129).
  v_candidate := projects.resolve_project_pm(p_project_id);
  IF v_candidate IS NOT NULL THEN
    RETURN v_candidate;
  END IF;

  -- Item 2's sentence (00196:901), verbatim, so the PM reading a server
  -- action's error.message sees one message whichever resolver produced it.
  RAISE EXCEPTION 'This project has nobody who can own work — add a project manager to it first.'
    USING ERRCODE = 'raise_exception';
END $fn$;

CREATE OR REPLACE FUNCTION projects.resolve_work_item_gatekeeper(
    p_project_id uuid, p_explicit uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_candidate uuid;
BEGIN
  -- A(b), as amended in this PR: the gatekeeper is the project PM for snag,
  -- qc_defect, diary_action and form_action; verifier_id for inspection; and
  -- THE RAISER for rfi (improvement 4 — an RFI is closed by the person who
  -- asked, once they confirm the answer is usable; the registry row says
  -- 'creator', section C'). The caller supplies the exception as p_explicit;
  -- everyone else passes NULL. Delegates to 00195's resolve_project_pm.
  --
  -- When that chain is empty this RAISES item 2's sentence rather than
  -- returning NULL: work_items.gatekeeper_id is NOT NULL, and a NULL here
  -- would surface on the source insert as a generic 23502. The assignee
  -- resolver does NOT always raise first — a project whose only member is a
  -- contractor named as triage_owner_id resolves an assignee through arm 3
  -- while the PM chain stays NULL (probe 02, the pmless fixture) — so this
  -- function must carry the sentence itself. Byte-identical to the assignee
  -- resolver's, so a PM sees one message whichever resolver produced it.
  IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
    RETURN p_explicit;
  END IF;
  v_candidate := projects.resolve_project_pm(p_project_id);
  IF v_candidate IS NOT NULL THEN
    RETURN v_candidate;
  END IF;
  RAISE EXCEPTION 'This project has nobody who can own work — add a project manager to it first.'
    USING ERRCODE = 'raise_exception';
END $fn$;

-- ─── C. Status, due date, and what counts as a delay ─────────────────────────
-- Four pure functions with clearly separated jobs so each is independently
-- testable (probe scripts/db/probes/03-status-map.sql; contract test
-- apps/web/src/lib/work-items/source-status-map.contract.test.ts). None of
-- them reads a table or an identity; none is SECURITY DEFINER.
--
-- Grants: none here. The REVOKE ALL … FROM PUBLIC / REVOKE EXECUTE … FROM anon
-- for these four functions land in section G with every other revoke in this
-- file, in one place (Task 13); the @verify block above already carries their
-- grant_absent: lines.

-- Pure vocabulary. IMMUTABLE because it reads nothing. Every value in every
-- source table's own status CHECK has an arm here — mapped, or explicitly NULL
-- meaning "leaves the universal status unchanged" (§03 §1.8). A contract test
-- parses both sides and fails on any value with no arm. Source CHECKs read on
-- 2026-09-13: projects.rfis 00002:90, field.snags 00004:21,
-- inspections.inspections 00066:57-59, projects.qc_entries
-- qc_entries_conformance_check 00176:60-61 (the column was added by ALTER,
-- not in 00172's CREATE TABLE), field.site_forms 00179:81.
CREATE OR REPLACE FUNCTION projects.map_source_status(p_item_type text, p_source_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_item_type
    WHEN 'rfi' THEN CASE p_source_status
      -- No 'draft' arm with meaning: rfiService.create hardcodes status:'open'
      -- (rfi.service.ts:100) and no code path writes 'draft'; it exists only
      -- in the 00002:90 CHECK.
      WHEN 'draft'     THEN NULL
      WHEN 'open'      THEN 'open'
      WHEN 'responded' THEN 'answered'
      WHEN 'closed'    THEN 'closed'
      ELSE NULL END
    WHEN 'snag' THEN CASE p_source_status
      WHEN 'open'             THEN 'open'
      WHEN 'in_progress'      THEN 'open'
      -- resolved/pending_sign_off both mean "the contractor says it is done and
      -- the PM has the ball", which is exactly 'answered'. Sign-off is the PM's
      -- act (§03 §1.5: the snag gatekeeper is the PM, not the raiser).
      WHEN 'resolved'         THEN 'answered'
      WHEN 'pending_sign_off' THEN 'answered'
      WHEN 'signed_off'       THEN 'closed'
      WHEN 'closed'           THEN 'closed'
      ELSE NULL END
    WHEN 'inspection' THEN CASE p_source_status   -- §03 §1.10, verbatim
      WHEN 'assigned'              THEN 'open'
      WHEN 'in_progress'           THEN 'open'
      WHEN 'awaiting_verification' THEN 'answered'
      WHEN 'certified'             THEN 'closed'
      WHEN 're-inspect_required'   THEN 'open'
      WHEN 'abandoned'             THEN 'void'
      ELSE NULL END
    WHEN 'qc_defect' THEN CASE p_source_status    -- source_status mirrors conformance
      WHEN 'fail' THEN NULL                        -- in scope; triage/open rules decide
      WHEN 'pass' THEN 'closed'                    -- the defect was corrected
      -- 'na' is the column DEFAULT (00176:54) and all 11 live entries carry it.
      -- Reading it as a close would mass-close items on a default value.
      WHEN 'na'   THEN NULL
      ELSE NULL END
    WHEN 'form_action' THEN CASE p_source_status
      WHEN 'draft'       THEN NULL
      WHEN 'submitted'   THEN 'answered'
      WHEN 'distributed' THEN 'closed'
      WHEN 'void'        THEN 'void'
      ELSE NULL END
    -- projects.site_diary_entries has no status column at all (00002:146-158,
    -- 00017:14-18). The delay item's lifecycle is entirely spine-side.
    WHEN 'diary_action' THEN NULL
    ELSE NULL END
$fn$;

-- Policy. Reconciles a mapping with §03 §1.6's triage rule.
CREATE OR REPLACE FUNCTION projects.work_item_status_for_mirror(
    p_current text, p_mapped text, p_has_explicit_assignee boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    -- void is terminal (00196:1701-1709, and this plan's "no un-projection
    -- path"). Under the depth-scoped exemption the mirror bypasses item 2's
    -- machine, so this arm is the only thing stopping abandoned →
    -- re-inspect_required from un-voiding a row that still carries its old
    -- void_reason. A voided source that is genuinely revived is a new record.
    WHEN p_current = 'void' THEN 'void'
    -- Terminal states always win: a source that closed, was answered or was
    -- voided says so regardless of where the item sat.
    WHEN p_mapped IN ('answered','closed','void') THEN p_mapped
    -- Insert path (§03 §1.6).
    WHEN p_current IS NULL AND p_has_explicit_assignee THEN 'open'
    WHEN p_current IS NULL                             THEN 'triage'
    -- A source-side assignment UN-TRIAGES (decided 2026-09-13, Task 4 review
    -- carry-forward 2): a snag whose assigned_to goes NULL → person, or an
    -- RFI assigned on its own page, has been triaged at the source, and an
    -- item left in triage with an assignee_id is a contradiction. Every
    -- projection's UPDATE arm passes `<src>.assigned_to IS NOT NULL` here.
    WHEN p_current = 'triage' AND p_mapped = 'open' AND p_has_explicit_assignee THEN 'open'
    -- Otherwise a mapped 'open' must never un-triage: A(b) maps
    -- inspection.assigned → open, and every unowned inbound item is born
    -- triage. Only the triage owner's explicit assign moves it (§03 §1.6:
    -- assign, re-date, or void).
    WHEN p_current = 'triage'  THEN 'triage'
    WHEN p_mapped  = 'open'    THEN 'open'
    ELSE p_current
  END
$fn$;

-- Improvement 6: a projected item may never arrive already overdue.
-- Measured 2026-09-10: RFI "Drawings" was created AND due 2026-07-23; five
-- August RFIs were created 08-17 and due 08-18 against A(b)'s +7 wd default;
-- 15 of 18 inspections carry a scheduled_at in the past. Returning NULL hands
-- the decision to item 2's BEFORE INSERT trigger, which computes the TYPE's
-- offset on the TYPE's calendar (A(b), A(h)) — so no new calendar maths lives
-- here and there is nothing to keep in sync.
--
-- "Today" is the SAST calendar date, (now() AT TIME ZONE 'Africa/Johannesburg')::date
-- — the SAME expression §5 uses as day zero of its working-day arithmetic
-- (00196:670), so the floor and the default it hands over agree on what day it
-- is. CURRENT_DATE is the session-timezone (UTC) date, which is yesterday's
-- SAST date for the first two hours of every SA morning: with it, a source
-- dated "today" entered at 01:00 SAST would pass through as a future date and
-- arrive as a same-day deadline. A date AT OR BEFORE today becomes NULL;
-- strictly future passes through. STABLE, not IMMUTABLE: it reads now().
CREATE OR REPLACE FUNCTION projects.work_item_mirror_due_date(p_source date)
RETURNS date LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN p_source IS NULL THEN NULL
    WHEN p_source <= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN NULL
    ELSE p_source
  END
$fn$;

-- Improvement 1: what actually counts as a delay.
-- projects.site_diary_entries has no "was there a delay" flag, only two free
-- text columns (delays, 00002:154; delay_notes, 00017:18). Re-read 2026-09-13:
-- 6 of 57 entries carry a non-empty `delays`, and ALL SIX are negations —
--   'No delays or info required was noted in the site walk and or meeting'
--   'None,'  'None,'  'None'  'None'  'NO'
-- (the two non-empty `delay_notes` are both 'None', beside a 'None').
-- A non-empty test measures whether the box was filled in, not whether a delay
-- occurred — the same class of error as counting form_responses newlines.
-- Contractors will keep typing "None" daily, so this lives on the LIVE path,
-- not only in the backfill. Two rules: an exact-token stop-list (case- and
-- whitespace-insensitive, trailing punctuation ignored) and a sentence rule
-- for the 2026-06-02 entry, which no token list can catch.
--
-- Both rules are applied PER COLUMN and the first survivor wins (Task 4
-- review, I2): the earlier "first non-empty of (delays, delay_notes)" let a
-- 'None' typed into `delays` silence a real `delay_notes` — rehearsed:
-- ('None', 'Late delivery of DB-04A') → NULL.
--
-- The sentence rule is NARROW (Task 4 review, I1): the negation word must be
-- IMMEDIATELY followed by the delay noun, or by "to report" / "noted". The
-- earlier rule (`^(no|none|nil|nothing)\y[^.]{0,80}(delay|issue|problem|info)`)
-- swallowed real delays — rehearsed → NULL: 'No power on site — issue with
-- Eskom', 'None of the DB-04 deliveries arrived, delay of 2 days', 'Nothing
-- delivered; the info from the supplier was wrong', 'No sparks on site so the
-- electrical problem stays'. The narrow form was evaluated 10/10 on
-- production: it matches the live 2026-06-02 sentence, 'No issues noted',
-- 'Nothing to report', 'No delay', 'None noted', and none of those four real
-- delays nor 'Crane stood down 4h awaiting sparks'.
--
-- Whitespace is btrim'd with an explicit set (Task 4 review, S1): TRIM strips
-- spaces only, so E'\nNone' survived as a delay.
CREATE OR REPLACE FUNCTION projects.diary_delay_text(p_delays text, p_delay_notes text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  WITH cols(ord, t) AS (
    SELECT v.ord, NULLIF(btrim(v.t, E' \t\r\n'), '')
      FROM (VALUES (1, p_delays), (2, p_delay_notes)) AS v(ord, t)
  ),
  norm AS (
    SELECT c.ord, c.t,
           -- 'None,' / 'none.' / 'no!' → the bare token. Only sentence
           -- punctuation is stripped, so '-' (itself a listed token) survives.
           lower(regexp_replace(c.t, '[.,;:!?[:space:]]+$', '')) AS token
      FROM cols c
     WHERE c.t IS NOT NULL
  )
  SELECT n.t
    FROM norm n
   -- exact-token negations
   WHERE n.token NOT IN ('none','no','n/a','na','nil','nothing','-','0','none noted','no delays')
     -- sentence negations: the 2026-06-02 entry is a full sentence, so a token
     -- list alone would have let it through. A negation word at the start,
     -- IMMEDIATELY followed by the delay noun or by "to report" / "noted".
     AND lower(n.t) !~ '^(no|none|nil|nothing)\y\s*(to report|noted|(significant |major |notable |other )?(delays?|issues?|problems?|info(rmation)?))\y'
   ORDER BY n.ord
   LIMIT 1
$fn$;

-- ─── D. Projection ───────────────────────────────────────────────────────────
-- Every function here is SECURITY DEFINER (§03 §1.2): it writes assignee_id,
-- gatekeeper_id and due_date, which the contractor who raised the RFI must not
-- be able to forge, and without it item 2's RESTRICTIVE INSERT policy on
-- work_items would be evaluated against that contractor and their perfectly
-- legitimate RFI insert would fail. (Mechanism: the policies are TO
-- authenticated, 00196:1107-1229; a SECURITY DEFINER function owned by
-- postgres — table owner, BYPASSRLS — never evaluates them.) Attribution uses
-- auth.uid(), never current_user, which resolves to the function OWNER.
--
-- ⚠ F8. Being SECURITY DEFINER does NOT change auth.uid(): inside these
-- functions it is still the contractor who touched the source row, and item
-- 2's transition guard exempts only auth.uid() IS NULL (00196:1540). Every
-- UPDATE below would be refused in a signed-in session — clause (a) on a
-- move, (a2) on a title re-projection, (b)/(c)/(d) on people and status —
-- and the refusal would surface on the SOURCE edit. Section C' replaces the
-- guard with the depth-scoped exemption its own comment names
-- (pg_trigger_depth() > 1, 00196:1590-1605): these UPDATEs run at depth 2.
--
-- Two functions per source, and the split is load-bearing (improvement 10):
-- projects.project_<source>(uuid) is a plain function that does the whole
-- projection and carries NO recursion guard — the trigger wrapper calls it,
-- and section H's backfill calls it DIRECTLY, so 15 live RFIs are projected
-- without a single UPDATE on projects.rfis (every source table carries a
-- BEFORE UPDATE set_updated_at trigger — rfis_updated_at 00002:100 — and a
-- no-op UPDATE would rewrite updated_at on rows whose values span 24 Jun –
-- 2 Sep; with F7's WHEN predicates in place it would also fire nothing).
-- projects.mirror_<source>_work_item() is the trigger wrapper: the depth
-- guard, then one PERFORM.
--
-- Three loop defences, doing three different jobs (§03 §1.2), never collapsed:
--   1. the WHEN clause on the _upd trigger — the trigger does not fire at all
--      on an unrelated UPDATE (probe 04, same_value_write_does_not_reproject);
--   2. pg_trigger_depth() > 1 in the WRAPPER — this is what terminates the
--      mirror ⇄ write-back cycle (F2, measured: mirror@1 → writeback@2 →
--      mirror@3 → skipped; without it, 54001 stack depth exceeded);
--   3. the value-difference check in the write-back (section E) — prevents
--      write amplification and a spurious updated_at bump on the source, not
--      recursion.
--
-- Watchers: NOT seeded here. §11 (00196:1378-1387) seeds created_by,
-- assignee and gatekeeper on INSERT and on every people change, in an AFTER
-- ROW trigger that fires before any statement here could — every row a
-- seeder wrote would hit DO NOTHING. The mirror sets created_by = the raiser.
--
-- Historical stamps (#4): every INSERT supplies opened_at (= the source's
-- created_at; §5 keeps it on the service path, 00196:629-636, and §11 dates
-- the created event at it), last_activity_at, and for a terminal mapping the
-- source's own closed_at / closed_by / void reason. On the live path §5
-- overwrites the two timestamps with the same instant; on the backfill they
-- are what stop 34 items dating their created event in the apply week.
--
-- Grants: none here. The REVOKE ALL … FROM PUBLIC / REVOKE EXECUTE … FROM anon
-- for every function in this section land in section G with every other
-- revoke in this file, in one place (Task 13); the @verify block above already
-- carries their grant_absent: lines. Trigger functions get NO GRANT (F5).

-- ── D.1 RFI ──────────────────────────────────────────────────────────────────
-- The reference implementation; D.2-D.6 repeat it deliberately. Columns read
-- from projects.rfis (00002:79-98, re-read on production 2026-09-13): subject,
-- priority, status, due_date, raised_by, assigned_to, closed_at, closed_by,
-- created_at, updated_at, project_id, organisation_id. Both priority CHECKs
-- are the same four values (rfis 00002:87, work_items 00196:289), so priority
-- maps 1:1. projects.rfis has no void state (00002:90) and no void reason
-- column, so an RFI item is never born void — the only path to void is
-- section F's delete-to-void, which supplies its own reason.
--
-- The projection body. Plain function, no recursion guard, callable directly —
-- which is how the backfill projects 15 RFIs without touching a source row.
CREATE OR REPLACE FUNCTION projects.project_rfi(p_rfi_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  r          projects.rfis%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_mapped   text;
  v_moved    boolean;
BEGIN
  SELECT * INTO r FROM projects.rfis WHERE id = p_rfi_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE rfi_id = r.id AND origin = 'mirror';

  -- 'rfi' here and in the two resolver calls below must be exactly
  -- projects.work_item_types.key: it is an FK on the item row, but plain text
  -- on the resolver side, where a typo silently skips arms 1b/2. Probe 04
  -- pins it (item_type_is_registry_key).
  v_mapped := projects.map_source_status('rfi', r.status);

  IF v_item.id IS NULL THEN
    v_assignee := projects.resolve_mirror_assignee(r.project_id, 'rfi', r.assigned_to);
    -- Improvement 4: the RFI gatekeeper is the RAISER, not the project PM.
    -- Measured: triage_owner_id and the PM resolver both return the same person
    -- on 13 of 14 projects, so a PM gatekeeper makes assignee and gatekeeper
    -- identical on every live RFI and §03 §1.8's close gate vacuous. 12 of 15
    -- live RFIs were raised by contractors, and this is the only mechanism in
    -- Q1 that puts an item into a contractor's ball-in-court. If the raiser is
    -- ineligible (departed, a client viewer, or an org-level contractor with no
    -- project_members row — 00107 gives them no effective role) the resolver
    -- falls back to the PM. The registry row agrees: section C' sets
    -- rfi.gatekeeper_rule = 'creator'.
    v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id,
      opened_at, last_activity_at, closed_at, closed_by)
    VALUES (
      r.organisation_id, r.project_id, 'rfi', 'mirror', r.subject, r.priority,
      projects.work_item_status_for_mirror(NULL, v_mapped, r.assigned_to IS NOT NULL),
      r.status, v_assignee, v_gate,
      -- Improvement 6: a past or same-day source date becomes NULL so item 2's
      -- BEFORE INSERT trigger computes A(b)'s +7 wd on the office calendar.
      projects.work_item_mirror_due_date(r.due_date),
      r.raised_by, r.id,
      -- #4: historical stamps. §5 overwrites opened_at/last_activity_at for a
      -- client session (same instant — harmless) and keeps them on the service
      -- path, which is the backfill. closed_* only when the source is closed;
      -- a closed RFI with no closed_at (none live today) dates its close at
      -- the row's last write.
      r.created_at, r.updated_at,
      CASE WHEN r.status = 'closed' THEN COALESCE(r.closed_at, r.updated_at) END,
      CASE WHEN r.status = 'closed' THEN r.closed_by END)
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6).
    -- Measured: this swallows a duplicate projection (a concurrent second
    -- projection of the same new RFI), leaves an origin='split' row on the
    -- same source untouched, and STILL raises 23505 on a work_items_ref_unique
    -- collision — which the bare form would have hidden, turning a ref
    -- numbering race into a silently missing inbox item. The predicate is
    -- work_items_src_rfi_uidx's, verbatim (00196:371):
    --   (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section comment).
  ELSE
    -- Improvement 8: a project move re-resolves both people. §15's rollout has
    -- already decided "snags move to KINGSWALK", and correcting an RFI raised on
    -- the wrong project is routine in a 14-project estate. Without this the item
    -- keeps the old project's scope and counts and its assignee may not be a
    -- member of the new project at all — which item 2's assignee-membership
    -- trigger would have rejected had the row been inserted that way.
    -- ⚠ Clause (a) of the guard makes project_id/organisation_id immutable for
    -- a signed-in actor; this UPDATE runs at depth 2 and rides section C''s
    -- exemption. The membership trigger (00196:961-984, UPDATE OF … project_id)
    -- still re-validates both people and fires BEFORE the guard by name order,
    -- so a move to a project the people are not on reports the MEMBERSHIP
    -- sentence. §11 records NO event for a move — the feed shows it only through
    -- the people/status events beside it.
    v_moved := v_item.project_id IS DISTINCT FROM r.project_id;

    IF v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(r.project_id, 'rfi', r.assigned_to);
      v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);
    ELSE
      -- An eligible explicit source assignee wins; otherwise the spine's
      -- current holder stays (the spine owns assignment, §03 §1.2). This is
      -- also what makes section E's write-back converge instead of ping-pong.
      v_assignee := COALESCE(
        CASE WHEN projects.work_item_person_eligible(r.project_id, r.assigned_to)
             THEN r.assigned_to END,
        v_item.assignee_id);
      v_gate := v_item.gatekeeper_id;
    END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3) and a terminal mapping wins; void_reason is not in
    -- this SET list and is never blanked. The explicit-assignee flag is
    -- passed on UPDATE as well as INSERT (decided 2026-09-13, Task 4 review
    -- carry-forward 2): a source that names an assignee for the first time
    -- UN-TRIAGES its item — Tasks 7-11 pass `<src>.assigned_to IS NOT NULL`
    -- the same way (false for sources with no assignee column). On the
    -- service path the guard keeps a supplied closed_by across a close and
    -- stamps closed_at = now() on the transition (00196:1544-1547); the
    -- values below are what it sees.
    UPDATE projects.work_items
       SET project_id       = r.project_id,
           organisation_id  = r.organisation_id,
           title            = r.subject,
           priority         = r.priority,
           source_status    = r.status,
           status           = projects.work_item_status_for_mirror(v_item.status, v_mapped, r.assigned_to IS NOT NULL),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           closed_at        = CASE WHEN r.status = 'closed'
                                   THEN COALESCE(v_item.closed_at, r.closed_at, now())
                                   ELSE NULL END,
           closed_by        = CASE WHEN r.status = 'closed'
                                   THEN COALESCE(v_item.closed_by, r.closed_by) END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- The trigger wrapper. Two lines: the guard that terminates the mirror ⇄
-- write-back cycle (measured trace mirror@1 → writeback@2 → mirror@3 → skipped;
-- removing it and the write-back's value check produces
-- "ERROR: 54001: stack depth limit exceeded" — Task 6 Step 7 runs that
-- mutation once the write-back exists), then the projection.
CREATE OR REPLACE FUNCTION projects.mirror_rfi_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_rfi(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers, because PostgreSQL rejects a WHEN clause referencing OLD on
-- a trigger whose event list includes INSERT ("INSERT trigger's WHEN condition
-- cannot reference OLD values"). §03 §1.2's single declaration is not valid SQL.
DROP TRIGGER IF EXISTS rfis_mirror_work_item_ins ON projects.rfis;
CREATE TRIGGER rfis_mirror_work_item_ins
  AFTER INSERT ON projects.rfis
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_rfi_work_item();

-- The column list is every column the projection reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- description (or category) fires nothing (probe 04). created_at and
-- updated_at are read on INSERT only.
DROP TRIGGER IF EXISTS rfis_mirror_work_item_upd ON projects.rfis;
CREATE TRIGGER rfis_mirror_work_item_upd
  AFTER UPDATE OF subject, priority, status, due_date, assigned_to,
                  closed_at, closed_by, project_id, organisation_id
  ON projects.rfis
  FOR EACH ROW
  WHEN (OLD.subject         IS DISTINCT FROM NEW.subject
     OR OLD.priority        IS DISTINCT FROM NEW.priority
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.due_date        IS DISTINCT FROM NEW.due_date
     OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
     OR OLD.closed_at       IS DISTINCT FROM NEW.closed_at
     OR OLD.closed_by       IS DISTINCT FROM NEW.closed_by
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_rfi_work_item();
