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
BEGIN
  -- A(b), as amended in this PR: the gatekeeper is the project PM for snag,
  -- qc_defect, diary_action and form_action; verifier_id for inspection; and
  -- THE RAISER for rfi (improvement 4 — an RFI is closed by the person who
  -- asked, once they confirm the answer is usable; the registry row says
  -- 'creator', section C'). The caller supplies the exception as p_explicit;
  -- everyone else passes NULL. Delegates to 00195's resolve_project_pm; an
  -- orphaned project returns NULL here and the mirror's assignee call raises
  -- first, so no second sentence is needed.
  IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
    RETURN p_explicit;
  END IF;
  RETURN projects.resolve_project_pm(p_project_id);
END $fn$;
