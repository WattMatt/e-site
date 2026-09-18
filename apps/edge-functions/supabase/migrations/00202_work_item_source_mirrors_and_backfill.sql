-- =============================================================================
-- Migration: 00202_work_item_source_mirrors_and_backfill.sql
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
--          ⚠ ORDER AND session_replication_role ARE LOAD-BEARING. The obvious
--          recipe — delete the items, then restore the sources — does NOT work,
--          and was measured failing before it shipped: the source UPDATEs fire
--          rfis_mirror_work_item_upd, which RESURRECTS 9 items with fresh refs
--          (RFI-1…RFI-5, status 'triage'), section E then re-assigns and
--          re-floors all 9 RFIs, and §11 writes 9 more 'created' events. Restore
--          the SOURCES FIRST with triggers off, then delete the items:
--            BEGIN;
--            SET LOCAL session_replication_role = replica;  -- stops BOTH the mirror _upd and set_updated_at
--            UPDATE projects.rfis r SET assigned_to = b.assigned_to, due_date = b.due_date,
--                   updated_at = b.updated_at
--              FROM projects.backup_00202_source_assignees b
--             WHERE b.kind = 'rfi' AND b.id = r.id;
--            UPDATE field.snags s SET assigned_to = b.assigned_to, updated_at = b.updated_at
--              FROM projects.backup_00202_source_assignees b
--             WHERE b.kind = 'snag' AND b.id = s.id;
--            SET LOCAL session_replication_role = origin;   -- RI back on, so the DELETE cascades events + watchers
--            DELETE FROM projects.work_items
--             WHERE origin = 'mirror' AND created_at <= <apply timestamp>;
--            DELETE FROM public.product_events
--             WHERE event = 'backfill_completed'
--               AND properties->>'migration' = 'work_item_source_mirrors_and_backfill';
--            UPDATE projects.work_item_types SET gatekeeper_rule = 'project_pm' WHERE key = 'rfi';
--            COMMIT;
--            -- and re-run 00196 §12's CREATE OR REPLACE FUNCTION projects.work_items_transition_guard()
--          Measured after this form (rolled back, 2026-09-15): 0 mirror items,
--          0 assigned RFIs, 0 due_date / updated_at / snag diffs, 0 orphaned
--          events or watchers, registry back to 'project_pm', and no
--          backfill_completed event left behind. ⚠ updated_at is
--          restorable ONLY inside the replica window — rfis_updated_at
--          (00002:100) overwrites it on any ordinary UPDATE, so the snapshot's
--          updated_at column is unusable without it.
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
-- table: projects.backup_00202_source_assignees
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
-- sql: SELECT p.prosrc ~ 'v_actor IS NULL OR pg_trigger_depth\(\)\s*>\s*1' AND p.prosrc ~ 'source_status\s+IS DISTINCT FROM' AND p.prosrc !~ 'pg_trigger_depth\(\)\s*>\s*0' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'work_items_transition_guard'
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
-- sql: SELECT bool_and((tgtype & 66) = 0) AND count(*) >= 13 FROM pg_trigger WHERE NOT tgisinternal AND tgname ~ '_mirror_(work_item|defects)'
-- trigger: work_items_assignment_writeback_ins ON projects.work_items
-- trigger: work_items_assignment_writeback_upd ON projects.work_items
-- trigger: rfis_void_work_item ON projects.rfis
-- trigger: snags_void_work_item ON field.snags
-- trigger: inspections_void_work_item ON inspections.inspections
-- trigger: qc_entries_void_work_item ON projects.qc_entries
-- trigger: site_diary_entries_void_work_item ON projects.site_diary_entries
-- trigger: site_forms_void_work_item ON field.site_forms
-- grant_absent: anon SELECT ON projects.backup_00202_source_assignees
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

-- ─── C'. Amendments to item 2's objects ──────────────────────────────────────
-- (1) The transition guard. 00196 §12 (lines 1509-1759) copied verbatim, then
--     edited in three places — the first two booked by item 2's own comment at
--     00196:1590-1605, the third that comment itself:
--       (i)   the early return becomes
--               IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN
--             A mirror UPDATE runs at depth 2 (source statement → AFTER trigger
--             → this BEFORE UPDATE guard) and gets the service-path treatment:
--             stamps kept, authority and the machine skipped. A client
--             statement is always depth 1 and is unchanged. NOT `> 0` — that
--             exempts every client write, i.e. disables the guard; probe 05b's
--             direct_title_edit_refused is the assertion that catches it.
--       (ii)  source_status joins clause (a)'s immutable list:
--               OR NEW.source_status   IS DISTINCT FROM OLD.source_status
--             because from this migration the projection is its only writer.
--       (iii) the (a2) comment, which described (i) and (ii) as item 3's
--             future work, now describes them as shipped.
--     The @verify sql: line pins the CODE form (v_actor IS NULL OR
--     pg_trigger_depth() > 1): item 2's body already mentioned the bare
--     `pg_trigger_depth() > 1` in a comment, so the looser form could not
--     tell the two bodies apart (Task 2 review). It also refuses a `> 0` body.
--     CREATE OR REPLACE keeps the function's ACL; the revokes are re-issued so
--     the @verify grant_absent: line is provably true of THIS file. The
--     trigger work_items_transition_guard_trg (00196:1761-1764) is untouched:
--     it already calls this function. Rollback: re-run 00196 §12's CREATE OR
--     REPLACE (the header's ROLLBACK block).
CREATE OR REPLACE FUNCTION projects.work_items_transition_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'projects', 'public'
AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_may_write  boolean;
  v_may_govern boolean;
  v_is_holder  boolean;
  v_may_manage boolean;
BEGIN
  -- Stamped on every UPDATE, on both paths — including item 3's delete-to-void
  -- RI ON DELETE SET NULL on a void row, which is acceptable: a source
  -- deletion IS activity on the item.
  NEW.last_activity_at := now();

  -- THE STAMPS ARE THE GUARD'S, NEVER THE CALLER'S. closed_at / closed_by are
  -- written only by a status change (below, on either path); on every other
  -- UPDATE they are restored from OLD. void_reason may be written only while
  -- the row IS void — set with the void, or edited afterwards; on any other
  -- row it is restored. Restored, not refused: these are stamps, not
  -- identity, and a refusal would turn an innocent full-row save into an
  -- error. Asserted by work-item-transition.sql 7g and 16.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.closed_at := OLD.closed_at;
    NEW.closed_by := OLD.closed_by;
  END IF;
  IF NEW.status <> 'void' THEN
    NEW.void_reason := OLD.void_reason;
  END IF;

  IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN
    -- Service client / migration, OR a trigger-driven write — item 3's mirror,
    -- write-back and delete-to-void (00202). The action layer, or the source
    -- module's own gates, are what authorised these. A client statement is
    -- depth 1 and its guard call runs there, so a person's direct write is NOT
    -- exempt; a mirror UPDATE (source statement → AFTER trigger → this guard)
    -- runs at depth 2 and is. Proved under impersonation by probe 05b.
    -- A close stamps the moment; closed_by stays whatever the caller supplied —
    -- a backfill knows who closed the source, and there is no actor to invent.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'closed' THEN NEW.closed_at := now();
      ELSE NEW.closed_at := NULL; NEW.closed_by := NULL; END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Authority is resolved against the row AS IT IS (OLD): clause (a) makes
  -- project_id and item_type immutable, so NEW carries the same values or is
  -- a refused row.
  v_may_write  := projects.user_can_write_work_item(OLD.project_id, OLD.item_type);
  -- GOVERNANCE is owner / admin / project manager — §03 §1.4's "ORG_WRITE_ROLES
  -- user" — and it is NOT the type's write set: write_roles includes contractor
  -- for six of the eight Q1 types, and on the write set alone a contractor
  -- took over the gatekeeper seat and closed an open rfi and an answered task
  -- in one statement, and pulled an answered task back to themselves (proven
  -- on production in review). Who signs off, and who is named on an answered
  -- item, is governance; the triage/open hand-off and the void stay on the
  -- write set or the holder. COALESCEd: a non-member's role is NULL.
  v_may_govern := COALESCE(
    public.user_effective_project_role(OLD.project_id, v_actor) IN ('owner','admin','project_manager'),
    FALSE);
  -- COALESCEd: ball_in_court_id is NULL on a closed or void row, `uuid = NULL`
  -- is NULL, and NOT NULL is NULL — which never raises. Fail closed.
  v_is_holder  := COALESCE(v_actor = OLD.ball_in_court_id, FALSE);
  v_may_manage := v_may_write OR v_is_holder;

  -- (a) Immutable columns. ref is immutable because it is a permanent identifier
  --     in emails, PDFs and other people's notes (§15 §(e)) — which is exactly
  --     why §6's suffix parse tolerates a junk ref: there is no repair path.
  --     opened_at pre-ages every escalation and created_at is when the item
  --     was raised: §5 stamps opened_at for a client INSERT, and without this
  --     a client UPDATE could backdate it by 400 days (proven in review). The
  --     service path skips (a) — item 3's backfill keeps historical values.
  --     source_status is the projection's alone (item 3): the mirror rewrites
  --     it at depth 2, under the exemption above; a client may not.
  IF NEW.project_id      IS DISTINCT FROM OLD.project_id
  OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
  OR NEW.item_type       IS DISTINCT FROM OLD.item_type
  OR NEW.ref             IS DISTINCT FROM OLD.ref
  OR NEW.origin          IS DISTINCT FROM OLD.origin
  OR NEW.created_by      IS DISTINCT FROM OLD.created_by
  OR NEW.opened_at       IS DISTINCT FROM OLD.opened_at
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  OR NEW.source_status   IS DISTINCT FROM OLD.source_status THEN
    RAISE EXCEPTION '% cannot be renumbered, retyped or moved to another project — those details are fixed when the item is created.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (a2) A MIRRORED item's title belongs to its source row: a hand edit here
  --      and the projection would otherwise silently overwrite each other.
  --      A mirror trigger runs in the SOURCE WRITER's session, where
  --      auth.uid() is a person, so the projection's own title rewrite reaches
  --      this function too — at depth 2, where the exemption above returns
  --      before this clause (item 3, 00202 section C'). A person's hand edit
  --      is depth 1 and is refused here. source_status sits in clause (a) for
  --      the same reason: from 00202 the projection is its only writer.
  IF OLD.origin = 'mirror' AND NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION '% is mirrored from its source record, so its title is edited there and updates here automatically.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (a3) A source FK may change ONLY to NULL — item 3's delete-to-void RI path
  --      (ON DELETE SET NULL on a void row). Anything else re-points a mirrored
  --      item at a different source: the partial UNIQUEs stop two items per
  --      source, not one item per two sources, and the PERMISSIVE UPDATE
  --      policy would otherwise admit it for an assignee. On a LIVE row a
  --      NULL-ing already fails work_items_source_required, so "only to NULL"
  --      is the whole rule. The RI UPDATE on a void row passes every clause
  --      here (status, people and immutables unchanged) and is stamped only
  --      at last_activity_at.
  IF (NEW.rfi_id        IS DISTINCT FROM OLD.rfi_id        AND NEW.rfi_id        IS NOT NULL)
  OR (NEW.snag_id       IS DISTINCT FROM OLD.snag_id       AND NEW.snag_id       IS NOT NULL)
  OR (NEW.qc_entry_id   IS DISTINCT FROM OLD.qc_entry_id   AND NEW.qc_entry_id   IS NOT NULL)
  OR (NEW.diary_id      IS DISTINCT FROM OLD.diary_id      AND NEW.diary_id      IS NOT NULL)
  OR (NEW.site_form_id  IS DISTINCT FROM OLD.site_form_id  AND NEW.site_form_id  IS NOT NULL)
  OR (NEW.node_order_id IS DISTINCT FROM OLD.node_order_id AND NEW.node_order_id IS NOT NULL)
  OR (NEW.inspection_id IS DISTINCT FROM OLD.inspection_id AND NEW.inspection_id IS NOT NULL) THEN
    RAISE EXCEPTION '% is linked to its source record and cannot be re-linked.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (a4) The due date is the REVIEWER's. The project team, or whoever signs the
  --      item off, sets the deadline; the person doing the work cannot extend
  --      their own (an assignee extended theirs by 365 days in a probe).
  --      Compared against OLD.gatekeeper_id — the gatekeeper as they are, not
  --      as the same statement might try to make them.
  IF NEW.due_date IS DISTINCT FROM OLD.due_date
     AND NOT (v_may_write OR COALESCE(v_actor = OLD.gatekeeper_id, FALSE)) THEN
    RAISE EXCEPTION 'Only the project team, or whoever signs % off, can change when it is due.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (b) The person columns.
  --     * A closed or void item's people are part of the record.
  --     * The BALL-IN-COURT HOLDER may only shift the column the CURRENT status
  --       selects (§03 §1.4): assignee while triage/open, gatekeeper while
  --       answered. Writing the other one regenerates an unchanged
  --       ball-in-court and looks like a broken control.
  --     * A GOVERNING actor — owner, admin or project manager (§03 §1.4's
  --       "ORG_WRITE_ROLES user") — may CORRECT either column in any live
  --       state. §1.4's restriction is about which column MOVES THE BALL;
  --       correcting a gatekeeper while the item is open moves nothing. A(b)
  --       makes task's gatekeeper the creator, so without this a
  --       contractor-raised task on a WM engineer has the contractor as its
  --       only possible closer for the whole of its open life.
  --     * The TYPE's write set (v_may_write) still admits the triage/open
  --       hand-off — the events file's contractor reassignments — and the
  --       void. It does NOT admit a gatekeeper change, nor an assignee change
  --       while answered: see v_may_govern above for what that let a
  --       contractor do.
  --     * The gatekeeper arm is two checks, IN THIS ORDER. First: only a
  --       governing actor or the current holder may touch the column at all —
  --       a write-role holder who is neither gets the governance sentence.
  --       Second: a non-governing holder may do so only while the item is
  --       answered (where the holder IS the gatekeeper, handing the review
  --       on). The second check is what closes the ONE-STATEMENT
  --       SELF-APPOINTMENT (proven on production): an assignee holding an open
  --       item writes gatekeeper_id = auth.uid() together with a new assignee
  --       and passes §9's WITH CHECK; the assignee arm admits the hand-off
  --       (they hold the ball), and this check refuses the seat change with
  --       "still being worked on". A governing actor passes both and may take
  --       the seat and close in one statement — see (d).
  IF (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
   OR NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id)
   AND OLD.status IN ('closed','void') THEN
    RAISE EXCEPTION '% is %. Reopen it before changing who it belongs to.', OLD.ref, OLD.status
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NOT v_may_govern AND OLD.status NOT IN ('triage','open') THEN
      RAISE EXCEPTION '% is with the reviewer. Change the reviewer, not the person who did the work.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT v_may_manage THEN
      RAISE EXCEPTION 'Only the project team, or whoever is holding %, can hand it to someone else.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  IF NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id THEN
    IF NOT (v_may_govern OR v_is_holder) THEN
      RAISE EXCEPTION 'Only the project''s owners, admins or project managers can change who signs % off.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT v_may_govern AND OLD.status <> 'answered' THEN
      RAISE EXCEPTION '% is still being worked on. Change who it is assigned to, not who signs it off.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- (c) The status machine. void is terminal; closed reopens only to open.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ( (OLD.status = 'triage'   AND NEW.status IN ('open','void'))
          OR (OLD.status = 'open'     AND NEW.status IN ('answered','closed','void'))
          OR (OLD.status = 'answered' AND NEW.status IN ('open','closed','void'))
          OR (OLD.status = 'closed'   AND NEW.status = 'open') ) THEN
      RAISE EXCEPTION '% cannot move from "%" to "%".', OLD.ref, OLD.status, NEW.status
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (c2) REOPENING is the reviewer's, or the team's. The only legal move out
    --      of closed is to open (above), and an assignee reopening what the
    --      gatekeeper closed is a nuisance to the reviewer and inflates
    --      metric 7 — every re-close counts as a close.
    IF OLD.status = 'closed'
       AND NOT (v_may_write OR COALESCE(v_actor = OLD.gatekeeper_id, FALSE)) THEN
      RAISE EXCEPTION 'Only the project team, or whoever signed % off, can reopen it.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (d) ONLY THE GATEKEEPER CLOSES. Compared against auth.uid(), never
    --     current_user, and against NEW.gatekeeper_id: a governing actor who
    --     needs to close takes the seat and closes in ONE statement
    --     (gatekeeper_id = auth.uid(), status = 'closed') — (b) admits the
    --     seat change, this check sees the new seat, and §11 records
    --     gatekeeper_changed (seq n) before closed (seq n + 1). Anyone else
    --     gets this sentence.
    IF NEW.status = 'closed' AND v_actor IS DISTINCT FROM NEW.gatekeeper_id THEN
      RAISE EXCEPTION 'Only the person who signs % off can close it. Take it over first, or ask them to close it.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.status = 'void' AND NOT v_may_manage THEN
      RAISE EXCEPTION 'Only the project team, or whoever is holding %, can drop it.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.status = 'closed' THEN
      NEW.closed_at := now(); NEW.closed_by := v_actor;
    ELSE
      NEW.closed_at := NULL;  NEW.closed_by := NULL;
    END IF;
  END IF;

  -- A VOID row always carries its reason: required with the void, and never
  -- blanked afterwards. void_reason is editable while void (the restore rule
  -- above leaves it alone), so an empty edit reaches this check rather than
  -- being quietly restored — it applies to every void row, not only to the
  -- transition. Enforced here rather than as a sixth CHECK, so A(a)'s
  -- constraint set stays reproduced exactly and §12 §(h)'s DDL diff keeps
  -- working.
  IF NEW.status = 'void' AND COALESCE(btrim(NEW.void_reason), '') = '' THEN
    RAISE EXCEPTION 'Dropping % needs a short reason. Say why it is no longer needed.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION projects.work_items_transition_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_items_transition_guard() FROM anon;

-- (2) The rfi registry row (improvement 4; ⚠ OWNER DECISION, default taken —
--     recorded in the plan's Task 5½ and in the PR body). The mirror sets
--     created_by = raised_by and the gatekeeper to the raiser, so 'creator' is
--     the truthful rule for the readers in items 4-6; item 2 seeded
--     'project_pm' (00196:239) before improvement 4 was measured (13 of 14
--     projects resolve the PM and the triage owner to one person; 12 of 15
--     RFIs were raised by contractors). The CHECK (00196:202) already admits
--     it. The TS mirror (packages/shared/src/work-items/types.ts) changes in
--     the same commit, and its contract test applies this UPDATE to the seed
--     it parses, so the three registries stay in lockstep. If the owner
--     declines: delete this statement and the `sql: SELECT gatekeeper_rule =
--     'creator' …` directive, revert types.ts, and change project_rfi's
--     gatekeeper call to resolve_work_item_gatekeeper(r.project_id, NULL) in
--     both arms.
UPDATE projects.work_item_types SET gatekeeper_rule = 'creator' WHERE key = 'rfi';

-- ─── D. Projection ───────────────────────────────────────────────────────────
-- Every function here is SECURITY DEFINER (§03 §1.2): it writes assignee_id,
-- gatekeeper_id and due_date, which the contractor who raised the RFI must not
-- be able to forge, and without it their perfectly legitimate RFI insert would
-- fail. (Mechanism: the policies are TO authenticated, 00196:1107-1229; a
-- SECURITY DEFINER function owned by postgres — table owner, BYPASSRLS — never
-- evaluates them.) Attribution uses auth.uid(), never current_user, which
-- resolves to the function OWNER.
--
-- ⚠ WHICH definer is load-bearing, and which layer actually refuses — measured
--    (probe 16, Task 16 + its review), because the obvious answer is wrong. It
--    is the WRAPPER, mirror_<src>_work_item(), not project_<src>(): making
--    project_rfi INVOKER on its own changes nothing at all (probe 16 stays
--    16/16), since the wrapper still runs the whole projection as postgres and
--    its own SET row_security TO 'off' still applies. project_<src>()'s
--    declaration is defence-in-depth — its only callers are that wrapper and
--    section H as postgres. And the layers do not refuse in the order the
--    sentence above implies: strip the wrapper's definer and section G's
--    EXECUTE revoke answers FIRST (42501 permission denied for function
--    project_rfi), never the policy. Only after also granting EXECUTE to
--    authenticated does item 2's RESTRICTIVE gate become the thing that
--    refuses, naming work_items rather than rfis. So on the shipped path RLS
--    never refuses this projection at all; the proof that the spine gate does
--    bite a real client session is probe 16's arm 3, where the contractor
--    writes the spine row by hand.
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
-- without a single UPDATE on projects.rfis FROM THE PROJECTION ITSELF (every
-- source table carries a BEFORE UPDATE set_updated_at trigger —
-- rfis_updated_at 00002:100 — and a no-op UPDATE would rewrite updated_at on
-- rows whose values span 24 Jun – 2 Sep; with F7's WHEN predicates in place
-- it would also fire nothing). Section E's _ins write-back still fires on the
-- backfill's INSERT and writes the resolved holder and the computed due date
-- back to the 9 open RFIs (assigned_to, due_date, and updated_at through
-- rfis_updated_at) — see the header's Restore note, which snapshots exactly
-- those columns for that reason.
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
  v_live     boolean;   -- the item is neither closed nor void (Task 8 review S1)
  v_explicit boolean;   -- an ELIGIBLE explicit source assignee (Task 5 review F2)
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
  -- An ELIGIBLE explicit source assignee (Task 5 review F2). The raw
  -- `r.assigned_to IS NOT NULL` was eligibility-blind: a client viewer named
  -- on the source was born open on the triage owner, or un-triaged the item.
  -- Computed once; both arms use it — as the assignee VALUE's condition and as
  -- the un-triage FLAG. A NULL assigned_to is not eligible. Tasks 7-11 copy
  -- this line (false for sources with no assignee column).
  v_explicit := COALESCE(projects.work_item_person_eligible(r.project_id, r.assigned_to), FALSE);

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
      projects.work_item_status_for_mirror(NULL, v_mapped, v_explicit),
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
      -- Keyed on the MAPPED status, never on a source-status literal (template
      -- rule, Task 5 review S2): identical for RFI, but snag has two closing
      -- states and a copier of `r.status = 'closed'` would miss one.
      CASE WHEN v_mapped = 'closed' THEN COALESCE(r.closed_at, r.updated_at) END,
      CASE WHEN v_mapped = 'closed' THEN r.closed_by END)
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
    v_live  := v_item.status NOT IN ('closed','void');

    -- Rule 1 (Task 10 review; D.4-D.6's form, landed here by Task 13): a
    -- closed or void record is not REWRITTEN by a source edit that changes
    -- nothing it projects. Without this a closed_by re-stamp on a closed RFI
    -- — watched, so the _upd trigger fires; first closer wins below, so
    -- nothing projected changes — rewrote the tuple and stamped
    -- last_activity_at = now() on a record nothing else changed: the very
    -- signal probe 04 same_value_write_does_not_reproject treats as a failure
    -- (measured by ctid on the diary arm). What a non-live row still projects
    -- is its project / org (a move), its title (a closed row follows a
    -- rename; a void row's is never compared — the Task 11 review's I2
    -- tightening; an RFI record is void only through section F, which nulls
    -- rfi_id, or through a spine-side void with the source still live), its
    -- priority (SET from the source unconditionally here, unlike D.4's) and
    -- source_status. People are re-derived on a live item only (below) and
    -- the closed stamps keep the first closer — and a record with no recorded
    -- closer keeps none (closed_by is SET but not compared, so a later source
    -- stamp does not back-fill it; 0 of the 6 closed RFIs have a NULL closer
    -- and rfi.actions.ts:214 always stamps, so this has no live instance).
    -- Neither is compared. Probe 04
    -- closed_item_unrelated_source_edit_leaves_the_record.
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM r.organisation_id
       AND (v_item.status = 'void' OR r.subject = v_item.title)
       AND r.priority IS NOT DISTINCT FROM v_item.priority
       AND r.status IS NOT DISTINCT FROM v_item.source_status THEN
      RETURN;
    END IF;

    -- A closed or void item's people are part of the record (the guard's
    -- clause (b) sentence — which this UPDATE never reaches, at depth 2 or on
    -- the service path). Re-deriving them here would silently rewrite who
    -- closed what: a departed raiser's replacement, or a source reassigned
    -- after the close, must not become the record's holder on the next
    -- unrelated edit (Task 8 review S1; probe 04
    -- closed_item_people_are_not_reprojected). Template rule for D.2-D.6:
    -- people (and any source-derived due date) are re-derived on a LIVE item
    -- only; a terminal item keeps what it holds.
    IF NOT v_live THEN
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    ELSIF v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(r.project_id, 'rfi', r.assigned_to);
      v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);
    ELSE
      -- An eligible explicit source assignee wins; otherwise the spine's
      -- current holder stays (the spine owns assignment, §03 §1.2). This is
      -- also what makes section E's write-back converge instead of ping-pong.
      v_assignee := COALESCE(CASE WHEN v_explicit THEN r.assigned_to END, v_item.assignee_id);
      v_gate := v_item.gatekeeper_id;
    END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3) and a terminal mapping wins; void_reason is not in
    -- this SET list and is never blanked. The un-triage flag on UPDATE (Task
    -- 5 review F2 + the controller's revised semantics) is "the source names
    -- someone ELIGIBLE and DIFFERENT from what the item holds": an ineligible
    -- name (a client viewer) never un-triages, and section E's write-back —
    -- which writes the resolved triage owner back to rfis.assigned_to for a
    -- triage item — cannot un-triage the item on the next unrelated edit,
    -- because the source then names exactly what the item holds. Tasks 7-11
    -- copy both v_explicit and this flag. On the service path, and at depth
    -- 2 under section C''s exemption, the guard keeps a supplied closed_by
    -- across a close and stamps closed_at = now() on the transition
    -- (00196:1544-1547); the values below are what it sees.
    UPDATE projects.work_items
       SET project_id       = r.project_id,
           organisation_id  = r.organisation_id,
           -- Rule 2 (Task 10 review; D.4-D.6's form, landed here by Task 14): a
           -- VOID row's title is FROZEN, while a closed row keeps following the
           -- source (a typo correction on a closed record is still worth
           -- having). An RFI item reaches 'void' two ways: section F nulls
           -- rfi_id on a source delete — after which this function can never
           -- run for it again — or a person voids the ITEM on the spine with a
           -- reason while the RFI lives on. The second is the one this clause
           -- is for: the void record says what it said when it was voided, and
           -- a later rename of the RFI (which, paired with a status edit,
           -- slips past rule 1's early return above) must not rewrite it.
           -- Probe 04 spine_voided_item_title_is_frozen.
           title            = CASE WHEN v_item.status = 'void' THEN v_item.title
                                   ELSE r.subject END,
           priority         = r.priority,
           source_status    = r.status,
           status           = projects.work_item_status_for_mirror(
                                v_item.status, v_mapped,
                                v_explicit AND r.assigned_to IS DISTINCT FROM v_item.assignee_id),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           -- Closed stamps key on the MAPPED status, never on a source-status
           -- literal (template rule, Task 5 review S2): identical for RFI, but
           -- snag has two closing states and a copier of `r.status = 'closed'`
           -- would miss one.
           closed_at        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_at, r.closed_at, now())
                                   ELSE NULL END,
           closed_by        = CASE WHEN v_mapped = 'closed'
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

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- description (or category) fires nothing (probe 04). due_date, created_at
-- and updated_at are read on INSERT only: the spine owns the due date once
-- the item exists (improvement 11 is spine → source only), so a source
-- re-date must not fire a no-op projection whose only effect is
-- last_activity_at = now() over a historical value (Task 5 review F1; probe
-- 04 source_redate_does_not_fire_a_projection).
DROP TRIGGER IF EXISTS rfis_mirror_work_item_upd ON projects.rfis;
CREATE TRIGGER rfis_mirror_work_item_upd
  AFTER UPDATE OF subject, priority, status, assigned_to,
                  closed_at, closed_by, project_id, organisation_id
  ON projects.rfis
  FOR EACH ROW
  WHEN (OLD.subject         IS DISTINCT FROM NEW.subject
     OR OLD.priority        IS DISTINCT FROM NEW.priority
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
     OR OLD.closed_at       IS DISTINCT FROM NEW.closed_at
     OR OLD.closed_by       IS DISTINCT FROM NEW.closed_by
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_rfi_work_item();

-- ─── E. Assignment and due-date write-back ───────────────────────────────────
-- Two sources only. inspections.inspections.assigned_to_id is deliberately NOT
-- written back (§03 §1.2): the inspection engine's own assignment flow (00066)
-- stays the system of record for that column, and a third write-back is a third
-- loop to reason about. (The inspection mirror still READS that column forward —
-- see Task 8. "System of record" is an argument for not writing back, not for
-- not reading forward.)
--
-- ⚠ NO pg_trigger_depth() guard here, and that asymmetry is load-bearing (F2).
-- Measured: with a uniform guard, an RFI raised with no assignee ends up with
-- work_items.assignee_id = the resolved holder and rfis.assigned_to = NULL — the
-- write-back silently buys nothing. Termination is the WRAPPER's guard, not this
-- one; the value-difference predicates below only stop write amplification and a
-- spurious rfis_updated_at bump (00002:100-102).
--
-- The two cycles, with pg_trigger_depth() at each hop (probe 05):
--   source-originated  INSERT/UPDATE projects.rfis (a client statement, depth 0)
--     → rfis_mirror_work_item_ins/_upd → mirror_rfi_work_item() @1 → project_rfi()
--     → INSERT/UPDATE work_items: §7/§6/§5 BEFORE, §12 guard (exempt @2), then the
--       AFTER pair in name order — append_work_item_event_trg (§11: events and
--       watchers; fires on EVERY work_items write, this one included, and writes
--       nothing that fires anything) and work_items_assignment_writeback_* @2
--     → UPDATE rfis (assigned_to / due_date, only when they differ)
--     → rfis_updated_at (BEFORE) + rfis_mirror_work_item_upd (UPDATE OF assigned_to,
--       WHEN true because the value moved) → mirror_rfi_work_item() @3
--     → pg_trigger_depth() > 1 → RETURN.  Terminated.
--   spine-originated   UPDATE work_items SET assignee_id / due_date (client, depth 0)
--     → §12 guard @1 (a person's authority is checked HERE), §11 @1, this trigger @1
--     → UPDATE rfis → rfis_mirror_work_item_upd → mirror_rfi_work_item() @2
--     → pg_trigger_depth() > 1 → RETURN.  Terminated: the spine's own write is
--       never re-projected back over itself.
-- Termination matrix, MEASURED on scratch copies of this file (Task 6 Step 7,
-- probe 05, 21 rows, rfi arm; G = the wrapper's depth guard, V = the value
-- predicate below, W = the WHEN on both _upd triggers):
--   G0 V0 W0  →  ERROR 54001 stack depth limit exceeded (the loop is real);
--   G0 V0 W1  →  19/21 — the plan's own Step 7 mutation no longer overflows:
--                F7's WHEN makes value-equality a FIRING condition, so the
--                cycle dies on the first hop that changes nothing;
--   G1 V0 W0  →  20/21, G1 V0 W1 → 20/21 — the guard terminates it; the
--                red row is value_predicate_stops_write_amplification (2 rfis
--                tuple updates for 1 statement — rfis_updated_at bumped for
--                nothing);
--   G0 V1 W0  →  20/21, G0 V1 W1 → 20/21 — equality terminates it; the red
--                row is depth_guard_stops_reprojection_of_spine_writes (2
--                work_items tuple updates for 1 spine statement: the spine's
--                own reassign is re-projected back over itself at depth 2,
--                §11 re-entered, last_activity_at re-stamped);
--   G1 V1 W0  →  21/21 — nothing here sees the WHENs; their evidence is probe
--                04 (same_value_write_does_not_reproject,
--                source_redate_does_not_fire_a_projection).
-- So ANY ONE of the three ends the cycle and all three must be gone for it to
-- run away. The depth guard is kept as THE termination guard because it is
-- the only one that does not depend on the values converging — a future arm
-- that writes something the projection then rewrites differently (a
-- normalised title, a floored date) would loop under V and W alone — and it
-- is the one §03 §1.2 mandates and the mirror-triggers contract test (a later
-- task in this plan) pins. V is what stops write amplification; W is what
-- stops firing at all.
--
-- triage items ARE written back on the RFI arm (the plan's rule (a): the RFI
-- page renders the resolved holder for the first time). The next unrelated
-- source edit cannot un-triage the item on the strength of that value: D.1's
-- un-triage flag is "eligible AND distinct from what the item holds", and
-- after this write the source names exactly what the item holds (probe 05
-- writeback_value_is_inert_on_reprojection). The SNAG arm SKIPS triage items
-- (controller decision, Task 7 review): on snags assigned_to means "assigned
-- to fix"; an unassigned snag is born triage on its RAISER as the spine's
-- default holder (D.2), and writing the raiser to snags.assigned_to on the
-- same request would make notifySnagCreatedAction's creation email
-- (snag.actions.ts:36-46) render the raiser as the assignee. An open snag —
-- assigned at creation, un-triaged on the snag page, or un-triaged on the
-- spine — is written back as before (probe 05 snag_assignment_reaches_source,
-- probe 06 assigned_snag_reaches_source).
--
-- Improvement 11 is spine → source only: a later edit of rfis.due_date is not in
-- D.1's UPDATE OF list and moves nothing on the spine (probe 05
-- source_redate_does_not_move_the_spine); on projection a past or same-day
-- source date is floored by section C and the spine's computed date is what
-- comes back to rfis.due_date (due_date_reaches_source_on_insert).
--
-- Grants: none here — section G (Task 13) carries the REVOKE ALL … FROM PUBLIC /
-- REVOKE EXECUTE … FROM anon, and the @verify block already declares the
-- grant_absent: line. A trigger function gets NO GRANT (F5).
CREATE OR REPLACE FUNCTION projects.work_item_assignment_writeback()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'field'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF NEW.origin <> 'mirror' THEN RETURN NULL; END IF;   -- splits own their own lifecycle

  -- Improvement 9: never invent an assignee or a future deadline on a record
  -- that is already finished. 6 of 15 live RFIs are closed.
  IF NEW.status IN ('closed','void') THEN RETURN NULL; END IF;

  IF NEW.rfi_id IS NOT NULL THEN
    UPDATE projects.rfis
       SET assigned_to = NEW.assignee_id,
           due_date    = NEW.due_date
     WHERE id = NEW.rfi_id
       AND status NOT IN ('closed')
       AND (assigned_to IS DISTINCT FROM NEW.assignee_id
         OR due_date    IS DISTINCT FROM NEW.due_date);
  ELSIF NEW.snag_id IS NOT NULL THEN
    -- A triage snag is held by its raiser as the spine's DEFAULT holder;
    -- snags.assigned_to means "assigned to fix" and stays as the source left
    -- it until the item leaves triage (see the section comment). Probe 06
    -- unassigned_snag_source_stays_unassigned; probe 05
    -- snag_triage_item_leaves_source_unassigned.
    IF NEW.status = 'triage' THEN RETURN NULL; END IF;
    -- field.snags has no due_date column (00004:10-32), so assignment only.
    UPDATE field.snags
       SET assigned_to = NEW.assignee_id
     WHERE id = NEW.snag_id
       AND status NOT IN ('signed_off','closed')
       AND assigned_to IS DISTINCT FROM NEW.assignee_id;
  END IF;

  RETURN NULL;
END $fn$;

COMMENT ON FUNCTION projects.work_item_assignment_writeback() IS
  'Writes work_items.assignee_id and due_date back to projects.rfis, and assignee_id to '
  'field.snags (which has no due_date column; a TRIAGE snag item is skipped — its raiser is the '
  'spine''s default holder, not the person assigned to fix). Skips closed and void records so a '
  'historical row never acquires an assignee it never had. '
  'Known divergence: createRfiAction reads rfi.assigned_to from the INSERT''s RETURNING clause '
  '(rfi.actions.ts:104), which is computed before this AFTER trigger runs — so an RFI raised '
  'with no assignee still emails "unassigned" while the row already names the resolved holder. '
  'OPEN; NOT closed by item 2, which shipped five server actions and no module UI '
  '(createRfiAction is untouched). Candidates: re-read the row after insert in createRfiAction, '
  'or make assignee required on the create form (§03 §1.10) — neither is in this migration.';

-- F7 again: an INSERT arm cannot carry a WHEN referencing OLD.
DROP TRIGGER IF EXISTS work_items_assignment_writeback_ins ON projects.work_items;
CREATE TRIGGER work_items_assignment_writeback_ins
  AFTER INSERT ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_item_assignment_writeback();

DROP TRIGGER IF EXISTS work_items_assignment_writeback_upd ON projects.work_items;
CREATE TRIGGER work_items_assignment_writeback_upd
  AFTER UPDATE OF assignee_id, due_date ON projects.work_items
  FOR EACH ROW
  WHEN (OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
     OR OLD.due_date    IS DISTINCT FROM NEW.due_date)
  EXECUTE FUNCTION projects.work_item_assignment_writeback();

-- ── D.2 Snag ─────────────────────────────────────────────────────────────────
-- The D sections continue here, AFTER section E: D.1 and the write-back were
-- committed as one reviewable pair and the file is append-only from that
-- point. The section letters are the plan's; the order is the history's.
-- D.3-D.6 follow this one. Nothing here depends on E having run first — the
-- triggers created below fire only on rows written after this file applies.
--
-- D.1's template, copied deliberately. Columns read from field.snags
-- (00004:10-31 + 00120:61-62, re-read on production 2026-09-13 through
-- information_schema): title, location, priority, status, assigned_to,
-- raised_by (NOT NULL, 00004:23), signed_off_by, signed_off_at, created_at,
-- updated_at, project_id, organisation_id. NOT read: description, category,
-- floor_plan_pin (0 of 6 live snags carry one), signature_path, resolved_at
-- (the spine has no "answered at" stamp), raised_on_visit_id and
-- closed_on_visit_id. field.snags has NO closed_at, NO closed_by and NO
-- due_date column, and its status CHECK has NO void state (open, in_progress,
-- resolved, pending_sign_off, signed_off, closed) — so a snag item is never
-- born void and carries no void_reason; the only path to void is section F's
-- delete-to-void, which supplies its own reason. Both priority CHECKs are the
-- same four values (snags 00004:19, work_items 00196:289): priority maps 1:1.
--
-- Four differences from D.1, each named where it lands:
--   1. the default assignee falls to raised_by BEFORE the chain (§12 §(d));
--   2. the gatekeeper is the project PM, never the raiser (§03 §1.5);
--   3. the title carries the location (improvement 5);
--   4. no due date: NULL, so item 2's §5 computes A(b)'s +5 wd on the site
--      calendar; section E writes assignment only.
-- TWO closing states — signed_off AND closed both map to 'closed' (section C)
-- — which is why every stamp below keys on v_mapped, never on a literal.
--
-- Born-closed on INSERT (Task 4 review): work_items_insert_gate limits an
-- authenticated INSERT to item_type = 'task' in triage|open, so a live-path
-- insert of an already-signed-off snag (neither create path does; an import
-- might) relies on this function being SECURITY DEFINER and owned by postgres
-- — the table owner, BYPASSRLS — which never evaluates that policy. The INSERT
-- supplies the terminal state and its stamps in the same statement.
--
-- search_path (settled here for every projection, Task 7 review): 'projects',
-- 'public', then the SOURCE's own schema only where the source lives outside
-- those two — 'field' here and for site_forms (D.6), 'inspections' for D.3;
-- rfis, qc_entries and site_diary_entries (D.1, D.4, D.5) add nothing. Every
-- table reference in the body is schema-qualified regardless; the entry is so
-- the %ROWTYPE and any unqualified call into that schema resolve, and so a
-- copier does not inherit a schema its source does not use.
CREATE OR REPLACE FUNCTION projects.project_snag(p_snag_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'field'
SET row_security TO 'off'
AS $fn$
DECLARE
  s          field.snags%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_mapped   text;
  v_title    text;
  v_moved    boolean;
  v_live     boolean;   -- the item is neither closed nor void (Task 8 review S1)
  v_explicit boolean;   -- an ELIGIBLE explicit source assignee (Task 5 review F2)
BEGIN
  SELECT * INTO s FROM field.snags WHERE id = p_snag_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE snag_id = s.id AND origin = 'mirror';

  -- 'snag' here, in the INSERT and in both resolve_mirror_assignee calls must
  -- be exactly projects.work_item_types.key: an FK on the item row, but plain
  -- text on the resolver side, where a typo silently skips arm 2. Probe 06
  -- pins it (item_type_is_registry_key, arm_2_resolves_through_the_snag_key).
  v_mapped := projects.map_source_status('snag', s.status);

  -- Improvement 5. 6 of 6 live snags carry a location and 0 carry a
  -- floor_plan_pin, so this text column is the only locator that exists — and
  -- the title is the whole of what travels into the 07:00 recap email. A NULL
  -- or whitespace-only location adds nothing, never a dangling em-dash.
  v_title := s.title || COALESCE(' — ' || NULLIF(btrim(s.location), ''), '');

  -- An ELIGIBLE explicit source assignee (D.1's line, F2) — and it reads
  -- assigned_to ALONE, not the raiser. raised_by is §12 §(d)'s DEFAULT holder
  -- (the candidate handed to the chain below), not an explicit assignment, so
  -- an unassigned snag is born TRIAGE on its raiser (§03 §1.6: no explicit
  -- assignee ⇒ triage): the person who found the defect holds it until
  -- someone is assigned to fix it, on the snag page or on the spine.
  -- Both create paths offer an OPTIONAL assignee — the snag page's
  -- client-side insert (app/(admin)/projects/[id]/snags/new/page.tsx:84,
  -- `assigned_to: input.assignedTo || null`) and addSnagToVisitAction
  -- (snag-visit.actions.ts:261, `snagFields.assignedTo ?? null`) — so a
  -- raiser CAN name someone at creation (born open on that person) and
  -- otherwise leaves the column NULL; notifySnagCreatedAction then emails
  -- raiser and assignee as two different people (snag.actions.ts:36-46), so
  -- the module agrees the raiser is not "assigned to fix". Both arms use
  -- v_explicit — as the assignee VALUE's condition and as the un-triage
  -- FLAG. A NULL assigned_to is not eligible.
  v_explicit := COALESCE(projects.work_item_person_eligible(s.project_id, s.assigned_to), FALSE);

  IF v_item.id IS NULL THEN
    -- §12 §(d): assigned_to → raised_by → the chain. raised_by is NOT NULL
    -- (00004:23), so with an eligible raiser this resolves at the chain's
    -- explicit step; a client-viewer raiser (F2, improvement 7) is not
    -- eligible and falls to arm 2 (work_item_defaults.snag.triage_owner_id)
    -- onwards. The candidate is the first ELIGIBLE of the two, never
    -- COALESCE(assigned_to, raised_by): a non-null but ineligible assigned_to
    -- (a client viewer) would hide an eligible raiser and fall to arm 2
    -- (Task 7 review, measured: assignee = the arm-2 admin). v_explicit IS
    -- the eligibility test, so there is no second call. Template rule for
    -- D.3 and later copies: two candidate holders → CASE WHEN v_explicit THEN
    -- <explicit> ELSE <fallback> END. 0 of 6 live snags are assigned.
    v_assignee := projects.resolve_mirror_assignee(
                    s.project_id, 'snag', CASE WHEN v_explicit THEN s.assigned_to ELSE s.raised_by END);
    -- §03 §1.5: the PM, never the raiser. NULL is deliberate, not an oversight;
    -- compare project_rfi, which passes r.raised_by for the opposite reason.
    -- signOffSnagAction today stamps whoever clicked, with no role gate beyond
    -- authentication, so a raiser-closes default would hand close authority
    -- to the contractor who reported the defect. The registry row agrees
    -- (00196:240, gatekeeper_rule = 'project_pm').
    v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, snag_id,
      opened_at, last_activity_at, closed_at, closed_by)
    VALUES (
      s.organisation_id, s.project_id, 'snag', 'mirror', v_title, s.priority,
      projects.work_item_status_for_mirror(NULL, v_mapped, v_explicit),
      s.status, v_assignee, v_gate,
      -- No due_date column on field.snags: NULL, through section C's floor so
      -- a future column is floored by this same line, and item 2's BEFORE
      -- INSERT trigger computes A(b)'s +5 wd on the SITE calendar.
      projects.work_item_mirror_due_date(NULL::date),
      s.raised_by, s.id,
      -- #4: historical stamps. §5 overwrites opened_at/last_activity_at for a
      -- client session (same instant — harmless) and keeps them on the service
      -- path, which is the backfill. closed_* only when the MAPPED status is
      -- closed (signed_off and closed both are), from the sign-off stamps —
      -- field.snags has no closed_at/closed_by. A snag set to 'closed' with no
      -- sign-off dates its close at the row's last write and names no closer.
      s.created_at, s.updated_at,
      CASE WHEN v_mapped = 'closed' THEN COALESCE(s.signed_off_at, s.updated_at) END,
      CASE WHEN v_mapped = 'closed' THEN s.signed_off_by END)
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6):
    -- a duplicate projection is swallowed, an origin='split' row is untouched,
    -- and a work_items_ref_unique collision still raises 23505. The predicate
    -- is work_items_src_snag_uidx's, verbatim (00196:372):
    --   (snag_id) WHERE snag_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (snag_id) WHERE snag_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section D comment).
  ELSE
    -- Improvement 8: a project move re-resolves both people — §15's rollout
    -- has already decided "snags move to KINGSWALK". Runs at depth 2 under
    -- section C''s exemption (clause (a) makes project_id immutable for a
    -- signed-in actor); the membership trigger (00196:961-984) still
    -- re-validates both people first, by name order. D.1 has the full
    -- reasoning; nothing about it is snag-specific.
    v_moved := v_item.project_id IS DISTINCT FROM s.project_id;
    v_live  := v_item.status NOT IN ('closed','void');

    -- D.1's rule 1 (Task 10 review, via Task 13): a closed or void record is
    -- not REWRITTEN by a source edit that changes nothing it projects — a
    -- signed_off_by re-stamp on a signed-off snag is watched and fires the
    -- _upd trigger, but first closer wins below, so the tuple must be left
    -- alone rather than re-stamped last_activity_at = now(). What a non-live
    -- row still projects: project / org (a move), title (a closed row follows
    -- a rename; a void row's is never compared — a snag record is void only
    -- through section F, which nulls snag_id, or through a spine-side void),
    -- priority (SET from the source unconditionally) and source_status. The
    -- closed stamps keep the first closer — and a record with no recorded
    -- closer keeps none: closed_by is SET but not compared, so a later
    -- signed_off_by stamp on an already-closed snag does not back-fill it.
    -- Probe 06 closed_item_unrelated_source_edit_leaves_the_record.
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM s.organisation_id
       AND (v_item.status = 'void' OR v_title = v_item.title)
       AND s.priority IS NOT DISTINCT FROM v_item.priority
       AND s.status IS NOT DISTINCT FROM v_item.source_status THEN
      RETURN;
    END IF;

    -- D.1's rule (Task 8 review S1): a closed item's people are part of the
    -- record — a snag reassigned after its sign-off must not rewrite who the
    -- record names (probe 06 closed_item_people_are_not_reprojected).
    IF NOT v_live THEN
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    ELSIF v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(
                      s.project_id, 'snag', CASE WHEN v_explicit THEN s.assigned_to ELSE s.raised_by END);
      v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);
    ELSE
      -- An eligible explicit source assignee wins; otherwise the spine's
      -- current holder stays (the spine owns assignment, §03 §1.2). This is
      -- also what makes section E's write-back converge instead of ping-pong.
      v_assignee := COALESCE(CASE WHEN v_explicit THEN s.assigned_to END, v_item.assignee_id);
      v_gate := v_item.gatekeeper_id;
    END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3 — reachable for a snag only through section F) and a
    -- terminal mapping wins; void_reason is not in this SET list. The
    -- un-triage flag is D.1's: "the source names someone ELIGIBLE and
    -- DIFFERENT from what the item holds". Section E skips a TRIAGE snag
    -- entirely (the raiser is the spine's default holder, not "assigned to
    -- fix" — probe 06 unassigned_snag_source_stays_unassigned), and after a
    -- spine un-triage the source names exactly what the item holds, so an
    -- unrelated edit cannot move it (writeback_value_is_inert_on_reprojection),
    -- while the snag page's own assign control does
    -- (source_assignment_change_untriages_or_reassigns). At depth 2 the guard
    -- stamps closed_at = now() on the transition and keeps the supplied
    -- closed_by (probe 06 signed_off_carries_stamps); the signed_off_at
    -- fallback below therefore decides the value only for a row that was
    -- ALREADY closed and is being re-projected.
    UPDATE projects.work_items
       SET project_id       = s.project_id,
           organisation_id  = s.organisation_id,
           -- D.1's rule 2 (Task 10 review, via Task 14): a VOID row's title is
           -- FROZEN; a closed row keeps following the source. field.snags has
           -- no void state, so a snag item is void only through section F
           -- (which nulls snag_id and puts the row beyond this function) or
           -- through a spine-side void with the snag still live — the case
           -- this clause is for: a later rename or re-location of the snag,
           -- paired with a status edit so rule 1's early return does not fire,
           -- must not rewrite what the void record says. Probe 06
           -- spine_voided_item_title_is_frozen.
           title            = CASE WHEN v_item.status = 'void' THEN v_item.title
                                   ELSE v_title END,
           priority         = s.priority,
           source_status    = s.status,
           status           = projects.work_item_status_for_mirror(
                                v_item.status, v_mapped,
                                v_explicit AND s.assigned_to IS DISTINCT FROM v_item.assignee_id),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           -- Keyed on the MAPPED status (template rule): signed_off and closed
           -- both close, and a copier of `s.status = 'closed'` would miss one.
           closed_at        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_at, s.signed_off_at, now())
                                   ELSE NULL END,
           closed_by        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_by, s.signed_off_by) END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- The trigger wrapper: the depth guard that terminates the mirror ⇄ write-back
-- cycle (section E's termination matrix, measured on the rfi arm — this
-- wrapper is the same two lines), then the projection.
CREATE OR REPLACE FUNCTION projects.mirror_snag_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'field'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_snag(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers (an INSERT trigger's WHEN cannot reference OLD).
DROP TRIGGER IF EXISTS snags_mirror_work_item_ins ON field.snags;
CREATE TRIGGER snags_mirror_work_item_ins
  AFTER INSERT ON field.snags
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_snag_work_item();

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- description (or category, a photo path, a visit link) fires nothing (probe
-- 06 same_value_write_does_not_reproject). raised_by is read only on a move,
-- which project_id already fires; created_at and updated_at are read on
-- INSERT only; there is no due_date to watch.
DROP TRIGGER IF EXISTS snags_mirror_work_item_upd ON field.snags;
CREATE TRIGGER snags_mirror_work_item_upd
  AFTER UPDATE OF title, location, priority, status, assigned_to,
                  signed_off_by, signed_off_at, project_id, organisation_id
  ON field.snags
  FOR EACH ROW
  WHEN (OLD.title           IS DISTINCT FROM NEW.title
     OR OLD.location        IS DISTINCT FROM NEW.location
     OR OLD.priority        IS DISTINCT FROM NEW.priority
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
     OR OLD.signed_off_by   IS DISTINCT FROM NEW.signed_off_by
     OR OLD.signed_off_at   IS DISTINCT FROM NEW.signed_off_at
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_snag_work_item();

-- ── D.3 Inspection ───────────────────────────────────────────────────────────
-- D.1's template, copied deliberately — D.2 is the closer sibling (a source the
-- write-back does not touch), so this section reads like it. Columns read
-- from inspections.inspections (00066:43-78 + 00072:16-17, re-read on
-- production 2026-09-13 through information_schema): target_label (NOT
-- NULL), target_location, status, assigned_to_id, verifier_id, scheduled_at,
-- certified_at, abandoned_reason (00072 — the column abandonInspectionAction
-- writes, inspections.actions.ts:616), abandon_reason (00066 — never written
-- by the app; read as a fallback so a row carrying only it is not voided
-- reasonless), created_by (NOT NULL), created_at, updated_at, project_id,
-- organisation_id. NOT read: template_id, target_node_type, target_node_id,
-- overall_result, started_at, completed_at (the moment the inspector
-- submitted, not the close — the spine has no "answered at" stamp),
-- abandoned_at, abandoned_by (the void actor; the spine has no voided_by),
-- coc_number, parent_inspection_id, reinspection_notes. The table has NO
-- priority column (so 'medium', A(a)'s default), NO closed_at/closed_by
-- (certified_at and verifier_id stand in) and NO certified_by. Its status
-- CHECK (00066:57-59, read live 2026-09-13) is assigned | in_progress |
-- awaiting_verification | certified | re-inspect_required | abandoned —
-- every value has an arm in section C's map, and abandoned is the first
-- source VOID state a projection meets. The only other trigger on the table
-- is trg_inspections_updated_at (BEFORE UPDATE); nothing gates a transition.
--
-- Measured 2026-09-13: 19 live inspections (the plan's 18), ALL 'assigned',
-- ALL with an assigned_to_id and a verifier_id (8 self-verified), 16 with a
-- scheduled_at and ALL 16 in the past by SAST day (the plan's 15 of 18), 4
-- with a target_location, 0 in the demo org, 0 referencing a missing profile.
--
-- Differences from D.2, each named where it lands:
--   1. NO write-back (section E, §03 §1.2): the inspections module's own
--      assignment flow (00066) stays the system of record for assigned_to_id
--      AND verifier_id — but both are READ FORWARD on every projection. The
--      _upd trigger watches them, so a reassignment or a verifier change on
--      the inspection page moves work_items.assignee_id / gatekeeper_id,
--      ball_in_court_id, the Inbox and My Work with it. Without that line the
--      spine points at the previous person forever. "System of record" is an
--      argument for not writing back, not for not reading forward. ⚠ The
--      honest consequence (Task 8 review, measured): a SPINE-side
--      reassignment or gatekeeper correction on an inspection item is
--      TRANSIENT — it lasts until the next watched write of ANY kind on the
--      source (a title edit, the inspector pressing start: assigned →
--      in_progress), because the forward read runs on every projection and
--      nothing keeps the source in step. Probe 07 pins it
--      (spine_reassignment_is_reverted_by_the_next_source_write,
--      spine_gatekeeper_correction_is_reverted_by_the_next_source_write);
--      Task 18's matrix records the decision: the module is the durable
--      control, and the spine's reassign/gatekeeper actions refuse
--      item_type = 'inspection' with a sentence pointing at it;
--   2. the explicit assignee is assigned_to_id and nothing else — an
--      inspection has no raiser-holds-it default (compare D.2's raised_by);
--      an unassigned or client-viewer-assigned inspection falls to the chain
--      (arm 2: work_item_defaults.inspection.triage_owner_id) and is born
--      TRIAGE. 0 of 19 live rows are unassigned — the module's age, not its
--      risk;
--   3. the gatekeeper is A(b)'s verifier_else_pm (00196:242):
--      resolve_work_item_gatekeeper(project, verifier_id) on INSERT and on a
--      move — the resolver's explicit arm skips an ineligible verifier (a
--      client viewer, a departed user) and the PM chain answers. On every
--      other projection of a LIVE item the verifier is READ FORWARD (the
--      module owns verifier_id, difference 1): an eligible verifier_id is
--      the gatekeeper, an absent or ineligible one leaves the item's current
--      gatekeeper alone — the PM chain is never re-run on an existing item,
--      so a PM-less project with a departed verifier does not raise on an
--      unrelated title edit (Task 8 review S2);
--   4. the title carries target_location (improvement 5 again): the only
--      locator an inspection has, with no dangling em-dash for a blank one;
--   5. the due date comes from scheduled_at — through section C's floor, on
--      the SAST calendar day. §12 §(d) line 136 says scheduled_at::date; 16 of
--      19 live inspections are scheduled in the PAST, so passing it through
--      births every one of them overdue (improvement 6). And the date must be
--      the SAST day, (scheduled_at AT TIME ZONE 'Africa/Johannesburg')::date,
--      never scheduled_at::date: that cast reads the SESSION time zone (UTC on
--      the API and on Vercel), so an inspection scheduled for 01:30 SAST would
--      be floored against the wrong day and §5's day zero (00196:670) would
--      disagree with the floor (Task 4 review). And it IS read on UPDATE too
--      (Task 8 review I1): D.1's "the spine owns the due date once the item
--      exists" holds for RFIs because section E writes the spine's date BACK
--      to rfis.due_date; inspections have no write-back in either direction,
--      so a module reschedule would otherwise leave the spine on the birth
--      date forever (measured: due unchanged after scheduled_at moved +40 d).
--      So scheduled_at is in the _upd trigger's lists, and the UPDATE arm
--      sets due_date from a FUTURE scheduled_at — through the floor, then
--      through push_past_builders_shutdown, because §5 is BEFORE INSERT only
--      and would not push a date landing in the band — and keeps the item's
--      current date for a past or absent one (never overdue by
--      re-projection). Consequence, pinned in probe 07
--      (spine_due_edit_is_reverted_by_a_reschedule): a spine-side due edit
--      on an inspection item is transient while scheduled_at is in the
--      future — the module's date wins on the next reschedule;
--   6. a VOID arm: abandoned maps to 'void' (section C), so a projection
--      supplies void_reason on the same statement — the trimmed
--      abandoned_reason, else 00066's abandon_reason, else a fixed sentence.
--      The reason is never blanked afterwards and void is terminal (Task 4's
--      work_item_status_for_mirror arm): abandoned → re-inspect_required maps
--      to open and must NOT un-void the row (probe 07
--      void_is_terminal_on_source_reactivation);
--   7. closed stamps: closed_at = certified_at (else updated_at) and
--      closed_by = verifier_id on the INSERT path — inspections has no
--      certified_by; certifyInspectionAction is the verifier's act
--      (inspections-certify.actions.ts:229-234), so the verifier is the
--      truthful closer. On the live path the exempt guard stamps closed_at =
--      now() at the transition and keeps the supplied closed_by;
--   8. rule 1 (Task 10 review, via Task 13 — D.1 and D.2 carry it too): a
--      closed or void record is not rewritten by a source edit that changes
--      nothing it projects — the early return before the people arms. Here
--      the projected void_reason is compared as well, because an
--      abandoned_reason edit on a void row legitimately projects (the
--      source's words win on a void mapping) and must not be swallowed;
--   9. rule 2 (Task 10 review, via Task 13): a VOID row's title is frozen —
--      the record of what was abandoned; a closed row's keeps following the
--      source. D.1 and D.2 have no source void state, so the rule lands on
--      the first projection that meets one. Probe 07 void_item_title_is_frozen,
--      void_item_source_title_edit_leaves_the_record,
--      void_reason_edit_reaches_the_record.
--
-- Born-closed / born-void on INSERT (Task 4 review): work_items_insert_gate
-- limits an authenticated INSERT to item_type = 'task' in triage|open with no
-- closed_at/void_reason, so a live-path insert of an already-certified or
-- already-abandoned inspection (no action does; an import might) relies on
-- this function being SECURITY DEFINER and owned by postgres — the table
-- owner, BYPASSRLS — which never evaluates that policy. The INSERT supplies
-- the terminal state and its stamps in the same statement.
--
-- The profiles edge case. public.profiles.id is itself REFERENCES
-- auth.users(id) (00001:62) and handle_new_user inserts a profiles row on
-- every auth.users insert (00001:77-92), so assigned_to_id / verifier_id /
-- created_by (00066:54-55,73 — REFERENCES auth.users) already hold the UUIDs
-- work_items' profiles FKs need. Measured: 0 auth users without a profile, 0
-- of 19 inspections referencing a missing profile — which measures the
-- estate's age, not its risk, so the edge is handled anyway, on the way in:
-- work_item_person_eligible covers the assignee (an existence test is its
-- first clause) and the gatekeeper (through the resolver); created_by and
-- closed_by are existence-tested inline. The backfill adds no second,
-- contradictory guard (Task 14 Step 3, item 3).
CREATE OR REPLACE FUNCTION projects.project_inspection(p_inspection_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'inspections'
SET row_security TO 'off'
AS $fn$
DECLARE
  i          inspections.inspections%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_mapped   text;
  v_title    text;
  v_moved    boolean;
  v_live     boolean;   -- the item is neither closed nor void (Task 8 review S1)
  v_explicit boolean;   -- an ELIGIBLE explicit source assignee (Task 5 review F2)
  v_creator  uuid;
  v_closer   uuid;      -- verifier_id when it names a profile (closed_by REFERENCES profiles)
  v_reason   text;      -- the source's abandon reason, trimmed, or NULL
  v_sched    date;      -- the SAST day of scheduled_at through section C's floor, or NULL
BEGIN
  SELECT * INTO i FROM inspections.inspections WHERE id = p_inspection_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE inspection_id = i.id AND origin = 'mirror';

  -- 'inspection' here, in the INSERT and in both resolve_mirror_assignee calls
  -- must be exactly projects.work_item_types.key: an FK on the item row, but
  -- plain text on the resolver side, where a typo silently skips arm 2. Probe
  -- 07 pins it (item_type_is_registry_key,
  -- arm_2_resolves_through_the_inspection_key).
  v_mapped := projects.map_source_status('inspection', i.status);

  -- Improvement 5. target_location (00066:47) is the only locator an
  -- inspection carries (4 of 19 live rows have one), and the title is the
  -- whole of what travels into the 07:00 recap email. A NULL or
  -- whitespace-only location adds nothing, never a dangling em-dash.
  v_title := i.target_label || COALESCE(' — ' || NULLIF(btrim(i.target_location), ''), '');

  -- An ELIGIBLE explicit source assignee (D.1's line, F2). assigned_to_id is
  -- the ONLY explicit candidate — an inspection has no raiser default. Both
  -- arms use v_explicit — as the assignee VALUE's condition and as the
  -- un-triage FLAG. A NULL assigned_to_id is not eligible.
  v_explicit := COALESCE(projects.work_item_person_eligible(i.project_id, i.assigned_to_id), FALSE);

  -- Difference 5, the date: the SAST day of scheduled_at through section C's
  -- floor — NULL for an absent, past or same-day date. Read on INSERT (hands
  -- NULL to §5, which computes A(b)'s +3 wd) and on every projection of a
  -- live item (below), where a NULL keeps the item's current date.
  v_sched := projects.work_item_mirror_due_date((i.scheduled_at AT TIME ZONE 'Africa/Johannesburg')::date);

  -- Difference 7 and the profiles edge case: closed_by REFERENCES
  -- public.profiles, so a verifier UUID with no profiles row is not copied
  -- (closed_by is nullable; created_by, NOT NULL, falls back to the assignee
  -- below).
  v_closer := CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.verifier_id)
                   THEN i.verifier_id END;

  -- Difference 6: the source's own words for the void, trimmed. 00072's
  -- abandoned_reason is what the app writes; 00066's abandon_reason is read
  -- in case a row carries only it.
  v_reason := COALESCE(NULLIF(btrim(i.abandoned_reason), ''), NULLIF(btrim(i.abandon_reason), ''));

  IF v_item.id IS NULL THEN
    -- A(b): assigned_to_id, else the chain — arm 2 is
    -- work_item_defaults.inspection.triage_owner_id (probe 07 pins the key).
    -- An ineligible assigned_to_id (a client viewer, F2 / improvement 7) is
    -- skipped by the resolver's own explicit arm, so the raw column is passed.
    v_assignee := projects.resolve_mirror_assignee(i.project_id, 'inspection', i.assigned_to_id);
    -- Difference 3: A(b) verifier_else_pm. RAISES item 2's sentence for a
    -- PM-less project whose verifier is absent or ineligible — on the source
    -- INSERT, where the person who can fix it is.
    v_gate     := projects.resolve_work_item_gatekeeper(i.project_id, i.verifier_id);
    v_creator  := CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.created_by)
                       THEN i.created_by ELSE v_assignee END;

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, inspection_id,
      opened_at, last_activity_at, closed_at, closed_by, void_reason)
    VALUES (
      i.organisation_id, i.project_id, 'inspection', 'mirror', v_title, 'medium',
      projects.work_item_status_for_mirror(NULL, v_mapped, v_explicit),
      i.status, v_assignee, v_gate,
      -- Difference 5. The SAST calendar day of scheduled_at, through section
      -- C's floor: a past or same-day date becomes NULL and item 2's BEFORE
      -- INSERT trigger computes A(b)'s +3 wd on the SITE calendar instead. A
      -- future date passes through as THAT SAST date (§5 then only applies
      -- the builders' shutdown push). NEVER scheduled_at::date — the session
      -- time zone is UTC and 01:30 SAST is yesterday there.
      v_sched,
      v_creator, i.id,
      -- #4: historical stamps. §5 overwrites opened_at/last_activity_at for a
      -- client session (same instant — harmless) and keeps them on the service
      -- path, which is the backfill. Keyed on the MAPPED status (template
      -- rule), never on a source-status literal: closed stamps when 'closed'
      -- (certified — from certified_at, else the row's last write — and the
      -- verifier), a void reason when 'void' (abandoned).
      i.created_at, i.updated_at,
      CASE WHEN v_mapped = 'closed' THEN COALESCE(i.certified_at, i.updated_at) END,
      CASE WHEN v_mapped = 'closed' THEN v_closer END,
      -- A born-void row MUST carry a reason: the guard's void-reason check
      -- does not run on an INSERT (no guard) nor on the exempt UPDATE path,
      -- and would bite on the first signed-in UPDATE of the row instead
      -- (section C', "Dropping … needs a short reason") — a source delete or
      -- a hand edit, failing for a reason nobody can see.
      CASE WHEN v_mapped = 'void' THEN COALESCE(v_reason, 'inspection abandoned at source') END)
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6):
    -- a duplicate projection is swallowed, an origin='split' row is untouched,
    -- and a work_items_ref_unique collision still raises 23505. The predicate
    -- is work_items_src_inspection_uidx's, verbatim (00196:377):
    --   (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section D comment).
  ELSE
    -- Improvement 8: a project move re-resolves the assignee through the
    -- chain (the gatekeeper is re-resolved on every projection anyway,
    -- difference 3). Runs at depth 2 under section C''s exemption (clause (a)
    -- makes project_id immutable for a signed-in actor); the membership
    -- trigger (00196:961-984) still re-validates both people first, by name
    -- order. D.1 has the full reasoning; nothing about it is
    -- inspection-specific.
    v_moved := v_item.project_id IS DISTINCT FROM i.project_id;
    v_live  := v_item.status NOT IN ('closed','void');

    -- Difference 8 (Task 10 review, rule 1): a closed or void record is not
    -- REWRITTEN by a source edit that changes nothing it projects — an
    -- assigned_to_id change on a certified inspection, or a label edit on an
    -- abandoned one, fires the _upd trigger but must leave the tuple alone
    -- rather than re-stamp last_activity_at = now(). What a non-live row still
    -- projects: project / org (a move), title (a closed row follows a rename;
    -- a void row's is frozen — difference 9 — and never compared, the Task 11
    -- review's I2 tightening), source_status, and the void_reason projection
    -- exactly as the SET below computes it: on a void mapping the source's
    -- words win, so an abandoned_reason edit on a void row DOES project and
    -- is not swallowed (probe 07 void_reason_edit_reaches_the_record). due_date
    -- and the people are gated on v_live below; the closed stamps keep the
    -- first closer; neither is compared. Probe 07
    -- closed_item_unrelated_source_edit_leaves_the_record,
    -- void_item_source_title_edit_leaves_the_record.
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM i.organisation_id
       AND (v_item.status = 'void' OR v_title = v_item.title)
       AND i.status IS NOT DISTINCT FROM v_item.source_status
       AND (CASE WHEN v_mapped = 'void'
                 THEN COALESCE(v_reason, v_item.void_reason, 'inspection abandoned at source')
                 ELSE v_item.void_reason END) IS NOT DISTINCT FROM v_item.void_reason THEN
      RETURN;
    END IF;

    -- D.1's rule (Task 8 review S1): a closed or void item's people — and
    -- here its due date — are part of the record. Without this a departed
    -- verifier on a certified inspection would become "gatekeeper = PM" on
    -- the next title edit, and a reschedule would re-date a closed item
    -- (probe 07 closed_item_people_are_not_reprojected).
    IF NOT v_live THEN
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    ELSIF v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(i.project_id, 'inspection', i.assigned_to_id);
      v_gate     := projects.resolve_work_item_gatekeeper(i.project_id, i.verifier_id);
    ELSE
      -- Difference 1, the forward read: an ELIGIBLE explicit source assignee
      -- wins — 00066's flow owns inspections.assigned_to_id and this
      -- migration never writes it back, but the spine must FOLLOW it, or
      -- reassigning an inspection leaves work_items.assignee_id (and
      -- therefore ball_in_court_id, the Inbox and My Work) on the previous
      -- person forever. Otherwise the spine's current holder stays (an
      -- ineligible name — a client viewer — never moves the ball, improvement
      -- 7). ⚠ With no write-back, a spine-side reassignment of an inspection
      -- item lasts only until the next watched write of ANY kind on the
      -- source (the forward read runs on every projection); the durable
      -- control is the inspection page's own assign (probe 07
      -- spine_reassignment_is_reverted_by_the_next_source_write).
      v_assignee := COALESCE(CASE WHEN v_explicit THEN i.assigned_to_id END, v_item.assignee_id);
      -- Difference 3, the forward read of the verifier (Task 8 review S2):
      -- an eligible verifier_id is the gatekeeper; an absent or ineligible
      -- one leaves the item's current gatekeeper alone. NEVER the resolver
      -- here — it re-runs the PM chain and RAISES on a PM-less project, on
      -- an unrelated edit, for a person who cannot fix it. The same
      -- transience applies (spine_gatekeeper_correction_is_reverted_by_the_next_source_write).
      v_gate := CASE WHEN projects.work_item_person_eligible(i.project_id, i.verifier_id)
                     THEN i.verifier_id ELSE v_item.gatekeeper_id END;
    END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3 — abandoned → re-inspect_required maps to open and
    -- must not un-void the row) and a terminal mapping wins. The un-triage
    -- flag is D.1's: "the source names someone ELIGIBLE and DIFFERENT from
    -- what the item holds". At depth 2 the guard stamps closed_at = now() on
    -- the transition and keeps the supplied closed_by (probe 07
    -- certified_carries_stamps); the certified_at fallback below therefore
    -- decides the value only for a row that was ALREADY closed and is being
    -- re-projected. void_reason is never blanked: on a void mapping the
    -- source's words win, else what the row already carries, else the fixed
    -- sentence; on any other mapping the row keeps its own (a revived
    -- abandoned inspection stays void WITH its reason) — the exempt guard
    -- skips its void-reason check here and the next signed-in UPDATE of a
    -- reason-less void row would be refused instead.
    UPDATE projects.work_items
       SET project_id       = i.project_id,
           organisation_id  = i.organisation_id,
           -- Difference 9 (Task 10 review, rule 2): a void row's title is
           -- frozen — the record of what was abandoned; a closed row keeps
           -- following the source (a typo corrected on the board label).
           title            = CASE WHEN v_item.status = 'void' THEN v_item.title ELSE v_title END,
           source_status    = i.status,
           -- Difference 5 on UPDATE (Task 8 review I1): a FUTURE scheduled_at
           -- re-dates a LIVE item — floored (v_sched), then pushed past the
           -- builders' shutdown because §5 is BEFORE INSERT only. A CASE, not
           -- COALESCE(push(v_sched), …): push_past_builders_shutdown(NULL, …)
           -- raises 22004 while the band is on. A past/absent date, or a
           -- closed/void item, keeps what the item holds.
           due_date         = CASE WHEN v_live AND v_sched IS NOT NULL
                                   THEN projects.push_past_builders_shutdown(v_sched, i.project_id)
                                   ELSE v_item.due_date END,
           status           = projects.work_item_status_for_mirror(
                                v_item.status, v_mapped,
                                v_explicit AND i.assigned_to_id IS DISTINCT FROM v_item.assignee_id),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           -- Keyed on the MAPPED status (template rule).
           closed_at        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_at, i.certified_at, now())
                                   ELSE NULL END,
           closed_by        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_by, v_closer) END,
           void_reason      = CASE WHEN v_mapped = 'void'
                                   THEN COALESCE(v_reason, v_item.void_reason, 'inspection abandoned at source')
                                   ELSE v_item.void_reason END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- The trigger wrapper: the same two lines as D.1's and D.2's. There is no
-- write-back arm for inspections, so no mirror ⇄ write-back cycle to
-- terminate today; the depth guard stays because §03 §1.2 mandates it on
-- every wrapper, the mirror-triggers contract test (a later task) pins it,
-- and it is what stops a future trigger on inspections.inspections that
-- writes work_items from re-entering this projection.
CREATE OR REPLACE FUNCTION projects.mirror_inspection_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'inspections'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_inspection(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers (an INSERT trigger's WHEN cannot reference OLD).
DROP TRIGGER IF EXISTS inspections_mirror_work_item_ins ON inspections.inspections;
CREATE TRIGGER inspections_mirror_work_item_ins
  AFTER INSERT ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_inspection_work_item();

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- reinspection_notes (or overall_result, a coc_number, started_at) fires
-- nothing (probe 07 same_value_write_does_not_reproject). assigned_to_id and
-- verifier_id are here BECAUSE they are read forward (difference 1), and
-- scheduled_at because the UPDATE arm re-dates a live item from it
-- (difference 5, Task 8 review I1 — probe 07
-- source_reschedule_moves_the_spine_due; a past date fires a projection
-- that keeps the current due, reschedule_to_the_past_keeps_the_current_due).
-- created_at and updated_at are read on INSERT only.
DROP TRIGGER IF EXISTS inspections_mirror_work_item_upd ON inspections.inspections;
CREATE TRIGGER inspections_mirror_work_item_upd
  AFTER UPDATE OF target_label, target_location, status, assigned_to_id, verifier_id,
                  scheduled_at, certified_at, abandoned_reason, abandon_reason, project_id, organisation_id
  ON inspections.inspections
  FOR EACH ROW
  WHEN (OLD.target_label     IS DISTINCT FROM NEW.target_label
     OR OLD.target_location  IS DISTINCT FROM NEW.target_location
     OR OLD.status           IS DISTINCT FROM NEW.status
     OR OLD.assigned_to_id   IS DISTINCT FROM NEW.assigned_to_id
     OR OLD.verifier_id      IS DISTINCT FROM NEW.verifier_id
     OR OLD.scheduled_at     IS DISTINCT FROM NEW.scheduled_at
     OR OLD.certified_at     IS DISTINCT FROM NEW.certified_at
     OR OLD.abandoned_reason IS DISTINCT FROM NEW.abandoned_reason
     OR OLD.abandon_reason   IS DISTINCT FROM NEW.abandon_reason
     OR OLD.project_id       IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id  IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_inspection_work_item();

-- ── D.4 QC defect ────────────────────────────────────────────────────────────
-- D.1's template, copied deliberately — D.3 is the closer sibling (a source
-- the write-back does not touch, no raiser-holds-it default column), so this
-- section reads like it. Columns read from projects.qc_entries (00172:110-121
-- + 00176:53-68, re-read on production 2026-09-13 through
-- information_schema): title (NOT NULL), conformance (NOT NULL DEFAULT 'na',
-- qc_entries_conformance_check: pass | fail | na), severity (NULL, or
-- qc_entries_severity_check: minor | major | critical), report_id (NOT NULL,
-- ON DELETE CASCADE), created_by (NOT NULL, REFERENCES public.profiles — so no
-- existence test is needed, unlike D.3's auth.users columns), created_at,
-- updated_at, project_id, organisation_id. NOT read: description, sort_order.
-- And from projects.qc_reports (00172:57-72): title (NOT NULL) and status
-- (NOT NULL DEFAULT 'draft', qc_reports_status_check: draft | issued |
-- closed). NOT read: description, location (a report-level locator; the
-- entry's own title plus the report's title is what improvement 5 asks for),
-- inspection_date, report_no, raised_by, issued_by. issued_at IS read, on
-- the INSERT arm only (difference 7: an item is born at issue, not
-- pre-aged). Neither table has an assignee, a due date, a
-- closed_at/closed_by, a void state or an updater column: closed_by is NULL,
-- priority comes from severity, and the one void reason below is the
-- projection's own.
--
-- Measured 2026-09-13: 11 live entries, ALL conformance = 'na', on ONE issued
-- report; 2 draft reports, 0 closed; conformance = 'fail' has ZERO rows in
-- the database (F4) — so section H's qc arm backfills nothing today and
-- probe 08 walks from an empty project.
--
-- THE SCOPE PREDICATE SPANS TWO TABLES (F4, §03 §1.2 line 173): an entry is
-- an obligation only where conformance = 'fail' AND its report's status IN
-- ('issued','closed'). A QC report is a checklist — mirroring every issued
-- entry would manufacture ~40 items from one 40-line report, the poisoning
-- A(b) refuses. And an entry does not cross that predicate on its own: the
-- fail verdict is written while the report is a DRAFT (the live authoring
-- order — issueQcReportAction flips status LAST, qc.actions.ts:638) and the
-- entry enters scope when the REPORT is issued, an UPDATE on qc_reports. So
-- there are TWO entry points into one projection body:
--   1. qc_entries_mirror_work_item_ins / _upd — the entry itself changed
--      (a late finding INSERTed on an issued report; an entry corrected to
--      fail, or to pass / na, while its report is issued);
--   2. qc_reports_mirror_defects — the report crossed the scope boundary or
--      was renamed: it loops the report's entries and calls project_qc_entry
--      directly, exactly as section H does.
-- Without entry point 2 a report can be issued with failed entries and
-- nothing reaches anybody's inbox (probe 08 issue_report_projects_the_fail;
-- the mutation is the whole finding). §12 §(c) hard dependency 5 ("the six
-- automatic sources, and only those") is amended in this PR to name this
-- seventh table (Task 18); structure.node_orders still gets no trigger.
--
-- Differences from D.3, each named where it lands:
--   1. the chain's candidate is created_by (§12 §(d) line 134: created_by →
--      triage_owner_id → org owner) and there is NO explicit assignee —
--      the flag is false in both arms, so a defect is born TRIAGE on its
--      author (§03 §1.6) until someone is assigned to fix it, on the spine.
--      An ineligible author (a client viewer, improvement 7) falls to arm 2
--      (work_item_defaults.qc_defect.triage_owner_id — probe 08 pins the
--      key). There is no source assignee to read forward and nothing to
--      write back (section E has no qc arm);
--   2. the gatekeeper is A(b)'s project_pm (00196:241):
--      resolve_work_item_gatekeeper(project, NULL) — never the author, who
--      is the person who recorded the failure, not the one who signs its
--      correction off. Re-resolved only on a project move;
--   3. severity maps onto priority (§03 §1.10): minor → low, major → high,
--      critical → critical, never a flat medium. A NULL severity is medium
--      on INSERT (00176:63-68 leaves "severity present iff fail" to the app
--      layer, so a fail with no severity is possible) but on UPDATE keeps
--      the item's recorded priority: the app blanks severity WITH a pass,
--      and a corrected 'major' defect must not be re-filed as 'medium'
--      (probe 08 pass_keeps_recorded_priority). The priority SET runs for a
--      LIVE item only (Task 9 review I3 — the I2 class): a severity edit on
--      a passed entry must not re-file the closed record (probe 08
--      closed_item_priority_is_not_refiled). Consequence, pinned honestly: a
--      spine-side priority edit on a qc_defect item lasts until the next
--      watched source write while `severity` is non-NULL (probe 08
--      spine_priority_edit_is_reverted_by_the_next_source_write) — the
--      module owns priority the way inspections own their people (Task 18:
--      the Inbox's priority control refuses item_type = 'qc_defect');
--   4. the title carries the PARENT REPORT (improvement 5): qc_entries has
--      no location column and its titles are checklist lines ("Earth
--      continuity", "Failed check"), unreadable in an inbox without the
--      report they came from. <entry> — <report>, the template's
--      <thing> — <locator> shape; qc_reports.title is NOT NULL (00172:62),
--      so there is never a dangling em-dash. A report RENAME therefore
--      re-projects every item's title (entry point 2 watches title);
--   5. no due date on either table: NULL through section C's floor, so
--      item 2's §5 computes A(b)'s +5 wd on the SITE calendar;
--   6. ONE projection-level VOID rule and ONE REOPEN rule, decided in Task 9
--      and revised by its review — section C maps 'na' to NULL (leave
--      unchanged: it is the column DEFAULT and every live entry carries it,
--      so reading it as a close would mass-close on a default value — probe
--      03 qc_na_null), which is right for an entry that never projected but
--      WRONG for a LIVE item whose entry is re-marked N/A: it would leave an
--      open obligation for a defect the source no longer records. So, on the
--      UPDATE arm only and only while the item is live (not closed, not
--      void): conformance = 'na' → void, 'marked N/A at source'. A terminal
--      source mapping wins first (pass → closed is the map's); void is
--      terminal (Task 4's arm of work_item_status_for_mirror) and a void row
--      is never re-reasoned, so a later 'fail' leaves the item void with its
--      reason. THE SCOPE PREDICATE GATES BIRTH ONLY: an existing item follows
--      the entry's own verdict regardless of the report's status — a report
--      leaving scope (issued → draft: legal at the DB, qc_reports_status_guard
--      is role-only and never reads the direction, 00172:249-263; no app
--      action writes it) changes NOTHING on existing items (the loop
--      re-projects them and, by difference 8, rewrites none), and a re-issue
--      needs no revival: it projects the fails added during the draft cycle
--      and leaves the rest as they were (probe 08
--      report_withdrawal_keeps_live_items,
--      reissue_keeps_the_items_and_projects_new_fails). The 'report
--      withdrawn' void the first version carried is gone: issued → draft is
--      unreachable from the app, void is irreversible on the spine and
--      work_items_src_qc_uidx admits one item per entry, so that void would
--      have silently and permanently emptied a re-issued report's failures
--      from every inbox; leave-live is recoverable both ways (a human can
--      void with a reason). THE REOPEN RULE: a CLOSED item whose entry
--      CROSSES INTO 'fail' — source_status, the previous verdict, was not
--      'fail' — is reopened (v_mapped := 'open'; the policy's mapped-open arm
--      reopens a closed item) on its last holder (probe 08
--      refail_reopens_a_closed_defect, one status_changed event). The map
--      itself stays fail → NULL: a `fail → 'open'` map would pull every item
--      a human moved to 'answered' back to 'open' on any unrelated entry edit
--      or report rename (measured by the review), and a defect closed on the
--      spine while its entry still reads 'fail' must survive an unrelated
--      edit (probe 08 answered_survives_an_unrelated_edit_and_a_rename,
--      spine_closed_defect_survives_an_unrelated_edit). The plan's D.4 text
--      had no un-project path and no reopen path at all;
--   7. closed stamps: closed_by NULL (no updater column; §11's closed event
--      reads the actor); closed_at is the exempt guard's now() at the live
--      transition. The UPDATE arm's COALESCE(v_item.closed_at, e.updated_at)
--      is the template's shape and its updated_at fallback is UNREACHABLE
--      (a qc_defect is never born closed; on the transition the guard's
--      stamp wins; on a re-projection of an already-closed row
--      v_item.closed_at is set) — kept so the arm reads like D.1–D.3's (Task
--      9 review S1). A qc_defect is never BORN closed or void: the INSERT arm
--      admits conformance = 'fail' only (a pass or na entry that never
--      projected is not an obligation and never was one on the spine), so
--      the INSERT supplies no terminal stamps — v_mapped is NULL there by
--      construction, and work_items_insert_gate's triage|open limit is never
--      in question (the function is SECURITY DEFINER and owned by postgres
--      regardless, section D's preamble, which is what lets a contractor's
--      entry write project at all). BORN AT ISSUE, NOT PRE-AGED (Task 9
--      review I4): the INSERT's opened_at is GREATEST(entry created_at,
--      report issued_at) and last_activity_at GREATEST(entry updated_at,
--      report issued_at). The fail verdict is written days before the report
--      is issued (the live authoring order above) and issueQcReportAction
--      flips the report with the service client, so auth.uid() is NULL
--      inside the mirror and §5 KEEPS the supplied stamps: an entry drafted
--      14 days before issue was birthing a 14-day-old item with a `created`
--      event dated before the report existed (measured by the review). A
--      NULL issued_at (the backfill shape — a report closed before the
--      spine, or one the app never stamped) falls back to the entry's own
--      stamps (probe 08 entry_older_than_issue_is_born_at_issue, and the
--      backfill-shape row);
--   8. (Task 10 review, rule 1) a closed or void record is not REWRITTEN by
--      a source edit that changes nothing it projects: the UPDATE arm returns
--      early unless the move, the title (closed rows) or the verdict
--      (source_status) would change. priority is NOT compared: its SET is
--      gated on v_live (difference 3), so a severity edit on a passed entry
--      projects nothing and leaves the tuple alone (probe 08
--      closed_item_unrelated_source_edit_leaves_the_record, by ctid);
--   9. (Task 10 review, rule 2) a VOID row's title is frozen — the record of
--      what was withdrawn (probe 08 void_item_title_is_frozen_on_rename); a
--      closed row's title keeps following a rename.
--
-- Entry point 1 fires for an INSERT and for an UPDATE of exactly the columns
-- the body reads that can change — title, conformance, severity, report_id
-- (the parent lookup), project_id, organisation_id (template rule: UPDATE OF
-- == WHEN == what the arm reads; description and sort_order fire nothing —
-- probe 08 same_value_write_does_not_reproject). Entry point 2 fires when
-- the report crosses the scope boundary in EITHER direction, or is renamed —
-- NOT on every status change: issued ↔ closed never changes an item, and
-- the plan's "OLD.status IS DISTINCT FROM NEW.status" would re-stamp every
-- item of a 40-line report on close (probe 08 report_close_does_not_reproject).
-- Its loop takes the report's entries that are 'fail' OR already carry a
-- mirror item, in checklist order, so the issue projects the failures, a
-- rename retitles every live and closed item (a void one keeps its frozen
-- title, difference 9) and a re-issue projects the fails added during the
-- draft cycle; a withdrawal visits the existing items and changes nothing on
-- them (difference 6). A rename therefore re-stamps last_activity_at on the
-- closed records it retitles — by design: they are retitled — and on
-- nothing else (difference 8); a pass or na entry with no item is not
-- visited. On a CLOSED report qc_report_children_frozen
-- (00172:449-486) refuses entry writes from a signed-in actor, so on the live
-- path entry point 1 is reached only while the report is draft or issued;
-- entry point 2 and section H never UPDATE an entry and never enter that
-- guard.
--
-- search_path: 'projects', 'public' — both tables live in projects (the
-- section D.2 note); every reference is schema-qualified regardless.
CREATE OR REPLACE FUNCTION projects.project_qc_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  e          projects.qc_entries%ROWTYPE;
  rep        projects.qc_reports%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_mapped   text;
  v_title    text;
  v_priority text;
  v_moved    boolean;
  v_in_scope boolean;   -- conformance = 'fail' AND the report is issued or closed (F4)
  v_live     boolean;   -- the item exists and is neither closed nor void
  v_reason   text;      -- a projection-level void reason (difference 6), or NULL
BEGIN
  SELECT * INTO e FROM projects.qc_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The parent report. report_id is NOT NULL with ON DELETE CASCADE, so an
  -- entry with no report is mid-cascade (section F's BEFORE DELETE has
  -- already voided the item) — nothing to project.
  SELECT * INTO rep FROM projects.qc_reports WHERE id = e.report_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE qc_entry_id = e.id AND origin = 'mirror';

  -- The scope predicate (F4). Out of scope and never projected: nothing to
  -- do — a fail on a draft is not yet an obligation, a pass or an na never
  -- was one. Out of scope but already projected falls through to the UPDATE
  -- arm, which decides between the map (pass → closed) and difference 6.
  v_in_scope := e.conformance = 'fail' AND rep.status IN ('issued','closed');
  IF v_item.id IS NULL AND NOT v_in_scope THEN RETURN; END IF;

  -- 'qc_defect' here, in the INSERT and in both resolve_mirror_assignee calls
  -- must be exactly projects.work_item_types.key: an FK on the item row, but
  -- plain text on the resolver side, where a typo silently skips arm 2. Probe
  -- 08 pins it (item_type_is_registry_key, arm_2_resolves_through_the_qc_key).
  v_mapped := projects.map_source_status('qc_defect', e.conformance);

  -- Difference 4 (improvement 5).
  v_title := e.title || ' — ' || rep.title;

  -- Difference 3. Total over qc_entries_severity_check's domain plus NULL.
  v_priority := CASE e.severity
                  WHEN 'minor'    THEN 'low'
                  WHEN 'major'    THEN 'high'
                  WHEN 'critical' THEN 'critical'
                  ELSE 'medium' END;

  IF v_item.id IS NULL THEN
    -- Difference 1: created_by → the chain (§12 §(d) line 134). The author
    -- is the chain's CANDIDATE, not an explicit assignment, so the third
    -- argument of work_item_status_for_mirror is false and the item is born
    -- triage on whoever the chain answers (compare D.2, where raised_by
    -- plays the same part). An ineligible author is skipped by the
    -- resolver's own explicit arm, so the raw column is passed.
    v_assignee := projects.resolve_mirror_assignee(e.project_id, 'qc_defect', e.created_by);
    -- Difference 2: the PM, never the author (A(b) gatekeeper_rule =
    -- project_pm, 00196:241). NULL is deliberate, not an oversight.
    v_gate     := projects.resolve_work_item_gatekeeper(e.project_id, NULL);

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, qc_entry_id,
      opened_at, last_activity_at)
    VALUES (
      e.organisation_id, e.project_id, 'qc_defect', 'mirror', v_title, v_priority,
      projects.work_item_status_for_mirror(NULL, v_mapped, false),
      e.conformance, v_assignee, v_gate,
      -- Difference 5. No due date on either table: NULL, through section C's
      -- floor so a future column is floored by this same line, and item 2's
      -- BEFORE INSERT trigger computes A(b)'s +5 wd on the SITE calendar.
      projects.work_item_mirror_due_date(NULL::date),
      e.created_by, e.id,
      -- #4 / difference 7: born at ISSUE, not pre-aged — the later of the
      -- entry's own stamp and the report's issued_at (NULL → the entry's).
      -- §5 overwrites both for a client session (same instant — harmless)
      -- and keeps them on the service path: the backfill AND the live issue
      -- path (issueQcReportAction uses the service client). No closed_* /
      -- void_reason: this arm is reached on conformance = 'fail' only, so
      -- v_mapped is NULL here and there is no terminal stamp to supply.
      GREATEST(e.created_at, COALESCE(rep.issued_at, e.created_at)),
      GREATEST(e.updated_at, COALESCE(rep.issued_at, e.updated_at)))
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6):
    -- a duplicate projection is swallowed, an origin='split' row is untouched,
    -- and a work_items_ref_unique collision still raises 23505. The predicate
    -- is work_items_src_qc_uidx's, verbatim (00196:373):
    --   (qc_entry_id) WHERE qc_entry_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (qc_entry_id) WHERE qc_entry_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section D comment).
  ELSE
    -- Improvement 8: a project move re-resolves both people — of a LIVE item
    -- (D.1's rule, Task 8 review S1: a closed or void item's people are part
    -- of the record; probe 08 closed_item_people_are_not_reprojected moves a
    -- closed defect and its people stay). Runs at depth 2 under section C''s
    -- exemption (clause (a) makes project_id immutable for a signed-in
    -- actor); the membership trigger (00196:961-984) still re-validates both
    -- people first, by name order. D.1 has the full reasoning; nothing about
    -- it is qc-specific.
    v_moved := v_item.project_id IS DISTINCT FROM e.project_id;
    v_live  := v_item.status NOT IN ('closed','void');

    -- Difference 8 (Task 10 review, rule 1): a closed or void record is not
    -- rewritten by a source edit that changes nothing it projects — else the
    -- guard stamps last_activity_at = now() on a record nothing else changed
    -- (measured by ctid on the diary arm). What a non-live row still
    -- projects is its project / org (a move), its title (a closed row
    -- follows a rename; a void row is frozen — difference 9 — so a void
    -- row's title is never compared: under `v_title = v_item.title` alone a
    -- rename on a void record ran the arm and rewrote the tuple for nothing,
    -- Task 11 review I2) and the verdict (source_status — a crossing into
    -- 'fail' is the reopen rule below). priority is not compared: its SET is
    -- gated on v_live.
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM e.organisation_id
       AND (v_item.status = 'void' OR v_title = v_item.title)
       AND e.conformance IS NOT DISTINCT FROM v_item.source_status THEN
      RETURN;
    END IF;

    IF v_live AND v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(e.project_id, 'qc_defect', e.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(e.project_id, NULL);
    ELSE
      -- No source assignee to read forward (difference 1): the spine's
      -- current holder stays (the spine owns assignment, §03 §1.2).
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    END IF;

    -- Difference 6. Evaluated AFTER the map: a terminal mapping (pass →
    -- closed) is the source's own word and wins; the N/A void applies to a
    -- LIVE item only, so a closed record re-marked N/A stays closed (probe
    -- 08 pass_then_na_keeps_closed_stamps) and a void one keeps its reason.
    -- The report's status is NOT consulted here: it gates birth only, and a
    -- withdrawn report's items stay as they are. Overriding v_mapped, rather
    -- than the status directly, keeps every stamp below keyed on the mapped
    -- status (the template rule).
    v_reason := CASE
                  WHEN NOT v_live OR v_mapped = 'closed' THEN NULL
                  WHEN e.conformance = 'na'              THEN 'marked N/A at source'
                  ELSE NULL END;
    IF v_reason IS NOT NULL THEN v_mapped := 'void'; END IF;

    -- The reopen rule (difference 6): a CLOSED item whose entry crosses INTO
    -- 'fail' — the previous verdict, held in source_status, was something
    -- else — is reopened. Only the crossing: a closed item whose entry still
    -- reads 'fail' (closed on the spine by its gatekeeper) survives an
    -- unrelated edit, and an 'answered' item is not closed, so this rule
    -- never touches it and it survives too.
    IF v_item.status = 'closed' AND e.conformance = 'fail'
       AND v_item.source_status IS DISTINCT FROM 'fail' THEN v_mapped := 'open'; END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3) and a terminal mapping wins; 'fail' maps to NULL,
    -- which keeps the current status unless the crossing rule above turned
    -- it into a reopen (probe 08 refail_reopens_a_closed_defect; an answered
    -- item keeps its status through edits and renames —
    -- answered_survives_an_unrelated_edit_and_a_rename). The
    -- explicit-assignee flag is false: nothing on the source can un-triage a
    -- qc_defect; only the triage owner's assign on the spine does. At depth 2
    -- the guard stamps closed_at = now() on the transition, keeps the
    -- supplied closed_by, restores both when the status does not change, and
    -- skips its void-reason check — which is why the reason travels on this
    -- same statement (section C', "Dropping … needs a short reason").
    -- void_reason is never blanked: the projection's reason on a void
    -- mapping (reached from a live row only, so the row carries none yet),
    -- else what the row already carries.
    UPDATE projects.work_items
       SET project_id       = e.project_id,
           organisation_id  = e.organisation_id,
           -- Difference 9: a void row's title is frozen; a closed row follows.
           title            = CASE WHEN v_item.status = 'void' THEN v_item.title ELSE v_title END,
           -- Difference 3, the UPDATE half: a NULL severity says nothing, and
           -- a closed or void record is never re-filed (I3). A REOPENED
           -- defect is re-filed at the severity it was re-failed with — the
           -- reopen IS the module re-filing it (Task 11 review I1: v_live is
           -- read before the crossing rule, so on v_live alone a defect born
           -- minor, passed and re-failed critical reopened at low until the
           -- next unrelated edit re-filed it — a one-write artefact).
           priority         = CASE WHEN (v_live OR v_mapped = 'open') AND e.severity IS NOT NULL THEN v_priority
                                   ELSE v_item.priority END,
           source_status    = e.conformance,
           status           = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           -- Keyed on the MAPPED status (template rule).
           closed_at        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_at, e.updated_at)
                                   ELSE NULL END,
           closed_by        = CASE WHEN v_mapped = 'closed' THEN v_item.closed_by END,
           void_reason      = CASE WHEN v_mapped = 'void' THEN v_reason ELSE v_item.void_reason END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- Entry point 1, the trigger wrapper: the same two lines as D.1-D.3's. There
-- is no write-back arm for qc, so no mirror ⇄ write-back cycle to terminate
-- today; the depth guard stays because §03 §1.2 mandates it on every wrapper,
-- the mirror-triggers contract test (a later task) pins it, and it is what
-- stops a future trigger on projects.qc_entries that writes work_items from
-- re-entering this projection.
CREATE OR REPLACE FUNCTION projects.mirror_qc_defect_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_qc_entry(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- Entry point 2: the REPORT crossed the scope boundary or was renamed. One
-- statement on qc_reports brings every failed entry into scope (or takes
-- every live item out of it, or retitles them all); the entries themselves
-- do not change, so entry point 1 never fires (F4). Loops the entries that
-- are 'fail' or already carry a mirror item, in checklist order (the ref
-- allocator numbers them in call order), and calls the body directly — the
-- same call section H makes. Same depth guard, same reason.
CREATE OR REPLACE FUNCTION projects.mirror_qc_report_defects()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  FOR v_id IN
    SELECT e.id FROM projects.qc_entries e
     WHERE e.report_id = NEW.id
       AND (e.conformance = 'fail'
            OR EXISTS (SELECT 1 FROM projects.work_items w
                        WHERE w.qc_entry_id = e.id AND w.origin = 'mirror'))
     ORDER BY e.sort_order, e.created_at, e.id
  LOOP
    PERFORM projects.project_qc_entry(v_id);
  END LOOP;
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers (an INSERT trigger's WHEN cannot reference OLD).
DROP TRIGGER IF EXISTS qc_entries_mirror_work_item_ins ON projects.qc_entries;
CREATE TRIGGER qc_entries_mirror_work_item_ins
  AFTER INSERT ON projects.qc_entries
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- description or sort_order fires nothing (probe 08
-- same_value_write_does_not_reproject). report_id is here because the body
-- reads the parent through it (a re-parented entry changes both its scope
-- and its title). created_by is read on a move, which project_id already
-- fires; created_at and updated_at are read on INSERT only; there is no
-- due_date to watch.
DROP TRIGGER IF EXISTS qc_entries_mirror_work_item_upd ON projects.qc_entries;
CREATE TRIGGER qc_entries_mirror_work_item_upd
  AFTER UPDATE OF title, conformance, severity, report_id, project_id, organisation_id
  ON projects.qc_entries
  FOR EACH ROW
  WHEN (OLD.title           IS DISTINCT FROM NEW.title
     OR OLD.conformance     IS DISTINCT FROM NEW.conformance
     OR OLD.severity        IS DISTINCT FROM NEW.severity
     OR OLD.report_id       IS DISTINCT FROM NEW.report_id
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

-- ⚠ §12 §(c) hard dependency 5 says the projection triggers cover the six
-- automatic A(b) sources "and only those". This is a SEVENTH table, and it is
-- required: the qc_defect scope predicate spans two tables and an entry does
-- not cross it on its own (F4). Task 18 amends §12 §(c) to say so.
-- Fires when the report ENTERS or LEAVES scope (draft ↔ issued/closed), or is
-- renamed — not on issued ↔ closed, which changes no item (probe 08
-- report_close_does_not_reproject). status is NOT NULL, so neither IN is NULL.
DROP TRIGGER IF EXISTS qc_reports_mirror_defects ON projects.qc_reports;
CREATE TRIGGER qc_reports_mirror_defects
  AFTER UPDATE OF status, title ON projects.qc_reports
  FOR EACH ROW
  WHEN ((OLD.status IN ('issued','closed')) IS DISTINCT FROM (NEW.status IN ('issued','closed'))
     OR OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION projects.mirror_qc_report_defects();

-- ── D.5 Diary action ─────────────────────────────────────────────────────────
-- D.1's template, copied deliberately — D.4 is the closer sibling (no explicit
-- assignee, the PM as gatekeeper, a projection-level void rule), so this
-- section reads like it. Columns read from projects.site_diary_entries
-- (00002:146-158 + 00017:14-18, re-read on production 2026-09-13):
-- entry_date (DATE NOT NULL), delays (TEXT), delay_notes (TEXT), created_by
-- (NOT NULL, REFERENCES public.profiles — no existence test needed), created_at,
-- updated_at (NOT NULL DEFAULT now(), bumped by site_diary_entries_updated_at
-- BEFORE UPDATE, 00002:160), project_id, organisation_id. NOT read: weather,
-- workers_on_site, progress_notes, entry_type, safety_notes, quality_notes.
-- THE EMPTIEST ROW IN §03 §1.1's TABLE: no status, no owner, no due date, no
-- close stamp, no void state, no reason column. Everything about a delay
-- item's lifecycle is spine-side — which is why this type carries the
-- shortest offset on the board, +2 working days on the SITE calendar (A(b),
-- 00196:243): a delay recorded today is stale by Friday (§03 §1.5).
--
-- Measured 2026-09-13: 57 live entries; 6 carry a non-empty `delays` and ALL
-- SIX are negations ('No delays or info required was noted in the site walk
-- and or meeting', 'None,', 'None,', 'None', 'None', 'NO'); the two
-- non-empty `delay_notes` are both 'None'. Zero of them is a delay — so the
-- backfill has NO diary arm (section H, improvement 1) and probe 09 walks
-- from an empty project.
--
-- THE SCOPE PREDICATE IS projects.diary_delay_text(delays, delay_notes) IS NOT
-- NULL (section B), never "the text box is non-empty": a non-empty test
-- measures whether the box was filled in, not whether a delay occurred, and
-- shipped that way day one puts six items titled `Delay 2026-06-24: None,`
-- with a +2 wd due date in the owner's own inbox. Contractors will keep
-- typing "None" daily, so the stop-list lives HERE, on the live trigger, not
-- only in a backfill that does not exist. It is applied PER COLUMN (Task 4
-- review I2): 'None' typed into `delays` beside a real `delay_notes` projects
-- the real one (probe 09 delay_notes_alone_projects).
--
-- Write paths: an entry is created by diaryService.create
-- (packages/shared/src/services/diary.service.ts:183-198, from
-- createDiaryEntryAction, apps/web/src/actions/diary.actions.ts:25), which
-- writes both delays and delay_notes on the INSERT. NO app path UPDATEs a
-- diary entry today — the shared service has create / getEntryForGate /
-- hardDelete / deleteAttachment, and the mobile app writes attachments only —
-- so the _upd arms below (edit into scope, withdrawal, re-date, move) are
-- reachable only over direct PostgREST, through "Org members can update
-- diary entries" (00145:39-50: org-wide, non-client-viewer, no WITH CHECK, no
-- column restriction). They are built and pinned regardless: the first edit
-- control the diary page grows lands on them, and the matrix (Task 18) lists
-- the source's write gate beside the spine's, as for rfis.
--
-- Differences from D.4, each named where it lands:
--   1. the scope predicate is one column-pair function, not a two-table
--      predicate; out of scope and never projected → nothing to do; out of
--      scope but already projected falls through to the UPDATE arm
--      (difference 4). A NULL delay never births an item, so the INSERT arm
--      supplies no terminal stamps (v_mapped is NULL there by construction
--      and work_items_insert_gate's triage|open limit is never in question —
--      the function is SECURITY DEFINER and owned by postgres regardless,
--      section D's preamble, which is what lets a contractor's entry write
--      project at all);
--   2. the title is `Delay <entry_date YYYY-MM-DD>: <delay text, ≤120>` — the
--      date IS the locator (the template's <thing> — <locator> shape: a diary
--      is a dated record and the inbox reader needs the day, not a location).
--      entry_date is therefore watched and a re-dated entry re-projects its
--      title (probe 09 redate_retitles_the_item). On the withdrawal path the
--      title is KEPT: a NULL delay has nothing to say, and title is NOT NULL;
--   3. the chain's candidate is created_by (§12 §(d): created_by →
--      triage_owner_id → org owner) and there is NO explicit assignee — the
--      flag is false in both arms, so a delay is born TRIAGE on the diarist
--      (§03 §1.6) until someone is assigned to act on it, on the spine. An
--      ineligible author (a client viewer, improvement 7) falls to arm 2
--      (work_item_defaults.diary_action.triage_owner_id — probe 09 pins the
--      key). The gatekeeper is A(b)'s project_pm (00196:243):
--      resolve_work_item_gatekeeper(project, NULL), never the author.
--      Priority is the literal 'medium': the source has no severity.
--      source_status is NULL on both paths (no source vocabulary at all —
--      section C's map answers NULL for this type unconditionally), so the
--      status is decided by the insert rule and by difference 4 only; nothing
--      on the source can un-triage a diary_action;
--   4. THE DOWNGRADE PATH (decided in Task 10, replacing the plan's "an entry
--      edited to REMOVE its delay keeps its item" paragraph). On the UPDATE
--      arm only, and only while the item is LIVE (not closed, not void): if
--      diary_delay_text() now returns NULL — the diarist blanked the box or
--      typed a negation over the delay — the item is VOIDED with
--      void_reason = 'delay withdrawn at source', the projection-level rule
--      D.4 applies to an N/A. The plan feared silent deletion; a void is not
--      that — it carries a `voided` event (§11) and a reason on the row — and
--      an open inbox item with a +2 wd due date for a delay the diarist
--      withdrew is the worse outcome. void is terminal (Task 4's arm of
--      work_item_status_for_mirror) and a void row is never re-reasoned, so
--      an entry re-edited back into scope does NOT revive the item (status,
--      reason AND title stay — the title of a void row is frozen, difference
--      9; probe 09 void_is_terminal_when_delay_returns); a genuinely new
--      delay is a new entry. A CLOSED item stays closed: the delay was acted on and signed
--      off, and the diarist tidying the text afterwards must not rewrite
--      that history (probe 09 closed_item_survives_withdrawal);
--   5. no closed mapping exists, so NO closed stamp is written on either arm:
--      a diary_action is never born closed (difference 1) and the UPDATE
--      leaves closed_at / closed_by untouched — the guard would restore them
--      from OLD anyway when the status does not change (section C'), but
--      there is nothing to key them on and so nothing to SET. The only paths
--      to closed are the spine's (the gatekeeper's close) and the service
--      client's;
--   6. no due date on the source: NULL through section C's floor, so item
--      2's §5 computes A(b)'s +2 wd on the SITE calendar; there is no source
--      date to watch (Task 8 review I1 does not apply);
--   7. stamps: opened_at = the entry's created_at and last_activity_at = its
--      updated_at — NOT NULL (00002:157), so the plan's
--      COALESCE(updated_at, created_at) had no arm to reach and is not here.
--      On the live path §5 overwrites both with the same instant; the
--      historical values matter only to a direct call, which section H never
--      makes for this type (probe 09 pins them on the INSERT path anyway,
--      the template rule);
--   8. (Task 10 review, rule 1) a closed or void record is not REWRITTEN by
--      a source edit that changes nothing it projects: the UPDATE arm returns
--      early unless the move or the projected title would change, so a
--      withdrawal on a closed item leaves its tuple — and last_activity_at —
--      alone (probe 09 closed_item_unrelated_source_edit_leaves_the_record);
--   9. (Task 10 review, rule 2) a VOID row's title is frozen — the record of
--      what was withdrawn (probe 09 void_is_terminal_when_delay_returns
--      asserts the title is unchanged); a closed row's title keeps following
--      a real delay's text.
--
-- The _upd trigger fires for an UPDATE of exactly the columns the body reads
-- that can change — delays, delay_notes, entry_date, project_id,
-- organisation_id (template rule: UPDATE OF == WHEN == what the arm reads;
-- progress_notes, weather and the rest fire nothing — probe 09
-- same_value_write_does_not_reproject). created_by is read on a move, which
-- project_id already fires; created_at and updated_at are read on INSERT
-- only.
--
-- search_path: 'projects', 'public' — the table lives in projects (the
-- section D.2 note); every reference is schema-qualified regardless.
CREATE OR REPLACE FUNCTION projects.project_diary_action(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  d          projects.site_diary_entries%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_delay    text;      -- the delay as the stop-list reads it, or NULL (improvement 1)
  v_mapped   text;      -- NULL, or the projection-level 'void' (difference 4)
  v_title    text;
  v_moved    boolean;
  v_live     boolean;   -- the item exists and is neither closed nor void
BEGIN
  SELECT * INTO d FROM projects.site_diary_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Improvement 1. NOT "the text box is non-empty": all 6 of 6 live values a
  -- non-empty test would project are the word None. See projects.diary_delay_text.
  v_delay := projects.diary_delay_text(d.delays, d.delay_notes);

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE diary_id = d.id AND origin = 'mirror';

  -- No delay and never projected: nothing to do. No delay but already
  -- projected falls through to the UPDATE arm, which decides between "leave
  -- it" (closed / void) and the withdrawal void (difference 4).
  IF v_item.id IS NULL AND v_delay IS NULL THEN RETURN; END IF;

  -- Difference 2. NULL when the delay is NULL — used only on the INSERT arm
  -- (never reached with a NULL delay) and guarded on the UPDATE arm.
  v_title := 'Delay ' || to_char(d.entry_date, 'YYYY-MM-DD') || ': ' || left(v_delay, 120);

  IF v_item.id IS NULL THEN
    -- Difference 3: created_by → the chain (§12 §(d)). The diarist is the
    -- chain's CANDIDATE, not an explicit assignment, so the third argument of
    -- work_item_status_for_mirror is false and the item is born triage on
    -- whoever the chain answers. An ineligible author is skipped by the
    -- resolver's own explicit arm, so the raw column is passed.
    -- 'diary_action' here, in the INSERT and in the UPDATE arm's resolver
    -- call must be exactly projects.work_item_types.key: an FK on the item
    -- row, but plain text on the resolver side, where a typo silently skips
    -- arm 2. Probe 09 pins it (item_type_is_registry_key,
    -- arm_2_resolves_through_the_diary_key).
    v_assignee := projects.resolve_mirror_assignee(d.project_id, 'diary_action', d.created_by);
    -- The PM, never the author (A(b) gatekeeper_rule = project_pm,
    -- 00196:243). NULL is deliberate, not an oversight.
    v_gate     := projects.resolve_work_item_gatekeeper(d.project_id, NULL);

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, diary_id,
      opened_at, last_activity_at)
    VALUES (
      d.organisation_id, d.project_id, 'diary_action', 'mirror', v_title, 'medium',
      projects.work_item_status_for_mirror(NULL, NULL, false),
      NULL,                  -- the source has no status vocabulary at all (difference 3)
      v_assignee, v_gate,
      -- Difference 6. No due date on the source: NULL, through section C's
      -- floor so a future column is floored by this same line, and item 2's
      -- BEFORE INSERT trigger computes A(b)'s +2 wd on the SITE calendar.
      projects.work_item_mirror_due_date(NULL::date),
      d.created_by, d.id,
      -- Difference 7 (#4): historical stamps. §5 overwrites both for a client
      -- session (same instant — harmless) and keeps them on the service path.
      -- No closed_* / void_reason: this arm is reached on a real delay only
      -- (difference 1), so there is no terminal stamp to supply.
      d.created_at, d.updated_at)
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6):
    -- a duplicate projection is swallowed, an origin='split' row is untouched,
    -- and a work_items_ref_unique collision still raises 23505. The predicate
    -- is work_items_src_diary_uidx's, verbatim (00196:374):
    --   (diary_id) WHERE diary_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (diary_id) WHERE diary_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section D comment).
  ELSE
    -- Improvement 8: a project move re-resolves both people — of a LIVE item
    -- (D.1's rule, Task 8 review S1: a closed or void item's people are part
    -- of the record; probe 09 closed_item_people_are_not_reprojected moves a
    -- closed delay and its people stay). Runs at depth 2 under section C''s
    -- exemption (clause (a) makes project_id immutable for a signed-in
    -- actor); the membership trigger (00196:961-984) still re-validates both
    -- people first, by name order. D.1 has the full reasoning; nothing about
    -- it is diary-specific.
    v_moved := v_item.project_id IS DISTINCT FROM d.project_id;
    v_live  := v_item.status NOT IN ('closed','void');

    -- Difference 8 (Task 10 review, rule 1): a closed or void record is not
    -- rewritten by a source edit that changes nothing it projects. Measured
    -- by ctid: a withdrawal on an entry whose item is closed rewrote the
    -- tuple, so the guard stamped last_activity_at = now() on a record
    -- nothing else changed — the very signal probe 09
    -- same_value_write_does_not_reproject treats as a failure. What a
    -- non-live row still projects is its project / org (a move) and, while
    -- the delay is real, its title — a CLOSED row's; a void row's is frozen
    -- (difference 9) and is never compared, so a returning delay on a void
    -- record does not rewrite the tuple (Task 11 review I2).
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM d.organisation_id
       AND (v_item.status = 'void' OR v_delay IS NULL OR v_title = v_item.title) THEN RETURN; END IF;

    IF v_live AND v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(d.project_id, 'diary_action', d.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(d.project_id, NULL);
    ELSE
      -- No source assignee to read forward (difference 3): the spine's
      -- current holder stays (the spine owns assignment, §03 §1.2), and the
      -- PM chain is never re-run on an existing item (a PM-less project must
      -- not raise on an unrelated edit — Task 8 review).
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    END IF;

    -- Difference 4. The withdrawal applies to a LIVE item only: a closed
    -- record whose entry is tidied to None stays closed with its stamps, and
    -- a void one keeps its reason. Overriding v_mapped, rather than the
    -- status directly, keeps the reason keyed on the mapped status (the
    -- template rule).
    v_mapped := CASE WHEN v_live AND v_delay IS NULL THEN 'void' ELSE NULL END;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3); a NULL mapping keeps the current status. The
    -- explicit-assignee flag is false: nothing on the source can un-triage a
    -- diary_action; only the triage owner's assign on the spine does. At
    -- depth 2 the guard skips its void-reason check — which is why the reason
    -- travels on this same statement (section C', "Dropping … needs a short
    -- reason") — and restores closed_at / closed_by when the status does not
    -- change (difference 5: neither is SET here). void_reason is never
    -- blanked: the projection's reason on a void mapping (reached from a live
    -- row only, so the row carries none yet), else what the row already
    -- carries. The title is re-projected from a real delay only; a withdrawn
    -- delay leaves the title the item had (difference 2), and a VOID row's
    -- title is frozen whatever the source now says (difference 9).
    UPDATE projects.work_items
       SET project_id       = d.project_id,
           organisation_id  = d.organisation_id,
           title            = CASE WHEN v_delay IS NULL OR v_item.status = 'void' THEN v_item.title ELSE v_title END,
           source_status    = NULL,   -- difference 3: NULL on both paths
           status           = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           void_reason      = CASE WHEN v_mapped = 'void' THEN 'delay withdrawn at source'
                                   ELSE v_item.void_reason END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- The trigger wrapper: the same two lines as D.1-D.4's. There is no write-back
-- arm for diaries, so no mirror ⇄ write-back cycle to terminate today; the
-- depth guard stays because §03 §1.2 mandates it on every wrapper, the
-- mirror-triggers contract test (a later task) pins it, and it is what stops
-- a future trigger on projects.site_diary_entries that writes work_items
-- from re-entering this projection.
CREATE OR REPLACE FUNCTION projects.mirror_diary_action_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_diary_action(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers (an INSERT trigger's WHEN cannot reference OLD).
DROP TRIGGER IF EXISTS site_diary_entries_mirror_work_item_ins ON projects.site_diary_entries;
CREATE TRIGGER site_diary_entries_mirror_work_item_ins
  AFTER INSERT ON projects.site_diary_entries
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_diary_action_work_item();

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- progress_notes (or weather, workers_on_site, the other note columns) fires
-- nothing (probe 09 same_value_write_does_not_reproject). entry_date is here
-- because the title embeds it (difference 2). created_by is read on a move,
-- which project_id already fires; created_at and updated_at are read on
-- INSERT only; there is no due date, no assignee and no status to watch.
DROP TRIGGER IF EXISTS site_diary_entries_mirror_work_item_upd ON projects.site_diary_entries;
CREATE TRIGGER site_diary_entries_mirror_work_item_upd
  AFTER UPDATE OF delays, delay_notes, entry_date, project_id, organisation_id
  ON projects.site_diary_entries
  FOR EACH ROW
  WHEN (OLD.delays          IS DISTINCT FROM NEW.delays
     OR OLD.delay_notes     IS DISTINCT FROM NEW.delay_notes
     OR OLD.entry_date      IS DISTINCT FROM NEW.entry_date
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_diary_action_work_item();

-- ── D.6 Form action ──────────────────────────────────────────────────────────
-- D.1's template, copied deliberately — D.2 is the closer sibling (a source
-- in the field schema with a reason column and terminal stamps on both arms;
-- here the explicit assignee is the AUTHOR, F10), so this section reads like
-- it. Columns read from field.site_forms (00179:70-105, re-read on production
-- 2026-09-13): form_no (TEXT — NULL on the INSERT and stamped by
-- allocate_form_no with the service client on the same request,
-- site-forms.actions.ts:405-432), board_ref, board_label, status (NOT NULL,
-- CHECK draft | submitted | distributed | void, 00179:80-81), created_by
-- (NOT NULL DEFAULT auth.uid() REFERENCES public.profiles, 00179:83 — no
-- existence test needed), distributed_by, distributed_at, void_reason (TEXT;
-- site_forms_void_reason_required, 00179:102-104, makes it non-blank on
-- every void row), created_at, updated_at (NOT NULL DEFAULT now(), bumped by
-- site_forms_updated_at BEFORE UPDATE, 00179:631), project_id,
-- organisation_id. NOT read: node_id (board_ref / board_label carry the
-- board's identity past a node delete, 00179:75-77), template_row_id,
-- as_left_status, submitted_by / submitted_at (the spine has no "answered
-- at" stamp), report_id.
--
-- Measured 2026-09-13: ONE live form (TMS-PNP2-2026-0001 on (649) PNP FAERIE
-- GLEN, draft, board_ref 'EXISTING EXAMPLE', board_label NULL), authored by
-- the org owner — eligible, so the backfill births it open on them (F10);
-- 2 templates, 1 active.
--
-- ⚠ trg_site_forms_transition (00179:415; field.enforce_site_form_transition
-- 00179:347, BEFORE UPDATE, SECURITY INVOKER by design — 00179:341-346: under
-- SECURITY DEFINER its trusted-role exemption was true for every caller) runs
-- BEFORE this mirror. The mirror is AFTER and STAYS AFTER: it only ever sees a
-- transition the state machine admitted (draft → submitted by any form
-- writer; submitted → distributed and anything → void by a manager; postgres
-- / service_role / supabase_admin unrestricted, 00179:352-354 — the action
-- layer gates those, site-forms-distribute.actions.ts:241-260). An illegal
-- transition raises at depth 1 with the guard's own sentence and this trigger
-- never fires (probe 10 illegal_transition_leaves_the_item). Never convert
-- it to BEFORE, for any reason.
--
-- F10 — A SITE FORM IS BORN OPEN ON ITS AUTHOR, AND THAT IS A DECISION. The
-- plan's original flag was `NEW.created_by IS NOT NULL`, which 00179:83 makes
-- a tautology (NOT NULL DEFAULT auth.uid()), so the outcome was accidental.
-- Decided: a site form IS the thing its author must finish — a Termination &
-- Making Safe record that feeds a supplementary CoC under EIR reg 7(4) — so
-- the author is an EXPLICIT owner, not the chain's candidate, and the item is
-- born `open` on them rather than entering the triage queue. The flag is
-- expressed through the template's eligibility test, v_explicit :=
-- work_item_person_eligible(project, created_by), not the plan's literal
-- `true`: identical for every real author — FORMS_FIELD_ROLES is owner /
-- admin / project_manager / contractor / inspector / supplier (00196:244)
-- and site_forms_insert refuses a client viewer (00179:452-458) — and it
-- keeps improvement 7 for a row a trusted role inserts with an ineligible
-- created_by (probe 10 ineligible_author_falls_to_triage: the chain answers,
-- born triage). Probe 10 draft_is_open_on_its_author asserts = 'open', never
-- IN ('triage','open'), so nobody flips this back to an accident without a
-- failing probe (Task 11 Step 5's mutation is v_explicit := false).
--
-- Differences from D.2, each named where it lands:
--   1. the explicit assignee IS created_by (F10 above): ONE candidate, so no
--      CASE WHEN v_explicit THEN … ELSE … END (the Task 7 review's form is
--      for two); the chain's candidate is the same column, so an ineligible
--      author is skipped by the resolver's own explicit arm and falls to
--      arm 2 (work_item_defaults.form_action.triage_owner_id — probe 10
--      pins the key);
--   2. the title is `<form_no, else 'Site form'> — <board_label, else
--      board_ref, else 'board'>`: form_no is the statutory reference the
--      record is cited by (00179:359) and is NULL for the first statement of
--      its life — the app numbers it on the same request, so form_no is
--      watched and the allocation retitles (probe 10
--      form_no_allocation_retitles). board_label is the as-found nameplate
--      (00179:107-108) and board_ref the schedule tag;
--      site_forms_board_identified (00179:93-95) guarantees node_id or
--      board_ref, not board_label, hence the third arm;
--   3. the gatekeeper is A(b)'s project_pm (00196:244):
--      resolve_work_item_gatekeeper(project, NULL), never the author — the
--      author is the ASSIGNEE, and distributing (the close) is a management
--      action on the source too (00179:404-407). Re-resolved only on a
--      project move;
--   4. no due date on the source: NULL through section C's floor, so item
--      2's §5 computes A(b)'s +3 wd on the SITE calendar (00196:244) — set by
--      what the record is FOR (a supplementary CoC, EIR reg 7(4)), not by how
--      long a form takes to fill (§03 §1.5). Nothing to watch (Task 8 review
--      I1 does not apply);
--   5. closed stamps keyed on v_mapped (template rule): closed_at =
--      COALESCE(distributed_at, updated_at), closed_by = distributed_by on
--      INSERT (a born-distributed row — the backfill shape, or a trusted-role
--      import); on UPDATE COALESCE(v_item.closed_at, distributed_at, now()) —
--      the exempt guard stamps now() on the live transition, so the fallbacks
--      decide only for a row already closed and re-projected. A DISTRIBUTED
--      form can still be voided (00179:399-401; voidSiteFormAction's
--      `.neq('status','void')`, site-forms.actions.ts:629-635): closed → void
--      on the spine, and closed_at / closed_by are cleared — the guard's
--      exempt path does the same on every non-close status change (probe 10
--      distributed_then_void_is_void);
--   6. void_reason = COALESCE(NULLIF(btrim(f.void_reason), ''), <the item's>,
--      'form voided at source') on a void mapping: the source's CHECK makes
--      the literal unreachable for a void form; kept as the template's shape
--      (D.3 has the same). A void row is never re-reasoned to blank; void is
--      terminal (probe 10 void_is_terminal: a trusted-role resurrection of the
--      source — the only actor that can, 00179:352-354 — leaves the item void
--      with its reason; source_status follows the source, the title is
--      frozen — difference 10);
--   7. created_by is NOT forward-read on the non-move arm: the transition
--      guard refuses any change to it for a signed-in caller (00179:361-380,
--      42501 "Identity and lifecycle columns on a site form are not
--      editable"), no app path UPDATEs it, and only a trusted role could —
--      it is immutable on the source for every real actor. The un-triage flag
--      keeps D.1's shape (v_explicit AND created_by IS DISTINCT FROM the
--      item's assignee) so the diff against D.1 is structural; it is moot for
--      an item born open;
--   8. people SETs on a move only, and only while the item is LIVE (Task 8
--      review S1): a distributed form moved between projects keeps the people
--      it was closed with (probe 10 closed_item_people_are_not_reprojected);
--      a live one is re-resolved on the new project (probe 10
--      live_move_reruns_the_chain_through_the_form_key);
--   9. (Task 10 review, rule 1) a closed or void record is not REWRITTEN by
--      a source edit that changes nothing it projects — the UPDATE arm
--      returns early unless the move, the title (closed rows) or
--      source_status would change, so a distributed_by re-stamp on a
--      distributed form leaves last_activity_at alone (probe 10
--      closed_item_unrelated_source_edit_leaves_the_record) while a board
--      rename on one still retitles it (closed_item_title_follows_the_source);
--  10. (Task 10 review, rule 2) a VOID row's title is frozen — the record of
--      what was withdrawn (probe 10 void_item_title_is_frozen); a closed
--      row's title keeps following the source (a typo correction).
--
-- Born-closed / born-void on INSERT (Task 4 review): work_items_insert_gate
-- limits an authenticated INSERT to item_type = 'task' in triage|open, so a
-- direct insert of an already-distributed or void form (the backfill; an
-- import) relies on this function being SECURITY DEFINER and owned by
-- postgres — the table owner, BYPASSRLS — which never evaluates that policy.
-- The INSERT supplies the terminal state and its stamps in the same
-- statement (probe 10 born_distributed_carries_source_stamps,
-- born_void_carries_source_reason).
--
-- search_path: 'projects', 'public', 'field' — the source lives in field (the
-- D.2 note); every reference in the body is schema-qualified regardless.
CREATE OR REPLACE FUNCTION projects.project_form_action(p_form_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'field'
SET row_security TO 'off'
AS $fn$
DECLARE
  f          field.site_forms%ROWTYPE;
  v_item     projects.work_items%ROWTYPE;
  v_assignee uuid;
  v_gate     uuid;
  v_mapped   text;
  v_title    text;
  v_moved    boolean;
  v_live     boolean;   -- the item is neither closed nor void (Task 8 review S1)
  v_explicit boolean;   -- F10: the author is an ELIGIBLE explicit owner
BEGIN
  SELECT * INTO f FROM field.site_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- The existing MIRROR item, if any. origin = 'split' rows on the same source
  -- are deliberately not this function's (§03 §1.3) and are never touched.
  SELECT * INTO v_item FROM projects.work_items
   WHERE site_form_id = f.id AND origin = 'mirror';

  -- 'form_action' here, in the INSERT and in both resolve_mirror_assignee
  -- calls must be exactly projects.work_item_types.key: an FK on the item
  -- row, but plain text on the resolver side, where a typo silently skips
  -- arm 2. Probe 10 pins it (item_type_is_registry_key,
  -- arm_2_resolves_through_the_form_key, live_move_reruns_the_chain_through_the_form_key).
  v_mapped := projects.map_source_status('form_action', f.status);

  -- Difference 2. board_label is the as-found nameplate and board_ref the
  -- schedule tag; site_forms_board_identified (00179:93-95) guarantees a
  -- node or a board_ref, so 'board' is reached only through a node-only form.
  v_title := COALESCE(f.form_no, 'Site form') || ' — '
             || COALESCE(NULLIF(TRIM(f.board_label), ''), f.board_ref, 'board');

  -- F10 (difference 1). NOT `f.created_by IS NOT NULL` — 00179:83 makes that
  -- a tautology and the outcome an accident. The author is an explicit owner
  -- because a site form IS the thing its author must finish; the flag is the
  -- template's eligibility test so an ineligible created_by (a trusted-role
  -- insert naming a client viewer) still falls to the chain and triage
  -- (improvement 7). Both arms use v_explicit — as the INSERT's status flag
  -- and in the UPDATE's un-triage flag. A real author is always eligible.
  v_explicit := COALESCE(projects.work_item_person_eligible(f.project_id, f.created_by), FALSE);

  IF v_item.id IS NULL THEN
    -- §12 §(d): created_by → the chain. With an eligible author this resolves
    -- at the chain's explicit step and, with v_explicit true, the item is born
    -- OPEN on them (F10); a client-viewer author is not eligible and falls to
    -- arm 2 onwards, born triage.
    v_assignee := projects.resolve_mirror_assignee(f.project_id, 'form_action', f.created_by);
    -- Difference 3: the PM, never the author (A(b) gatekeeper_rule =
    -- project_pm, 00196:244). NULL is deliberate, not an oversight.
    v_gate     := projects.resolve_work_item_gatekeeper(f.project_id, NULL);

    INSERT INTO projects.work_items (
      organisation_id, project_id, item_type, origin, title, priority,
      status, source_status, assignee_id, gatekeeper_id, due_date, created_by, site_form_id,
      opened_at, last_activity_at, closed_at, closed_by, void_reason)
    VALUES (
      f.organisation_id, f.project_id, 'form_action', 'mirror', v_title, 'medium',
      -- F10: born open on an eligible author (probe 10 asserts = 'open').
      projects.work_item_status_for_mirror(NULL, v_mapped, v_explicit),
      f.status, v_assignee, v_gate,
      -- Difference 4. No due date on field.site_forms: NULL, through section
      -- C's floor so a future column is floored by this same line, and item
      -- 2's BEFORE INSERT trigger computes A(b)'s +3 wd on the SITE calendar.
      projects.work_item_mirror_due_date(NULL::date),
      f.created_by, f.id,
      -- #4: historical stamps. §5 overwrites opened_at/last_activity_at for a
      -- client session (same instant — harmless) and keeps them on the service
      -- path, which is the backfill. The one live form may be distributed
      -- (born closed) or void by then; both shapes carry their source stamps
      -- (difference 5, difference 6), keyed on the MAPPED status.
      f.created_at, f.updated_at,
      CASE WHEN v_mapped = 'closed' THEN COALESCE(f.distributed_at, f.updated_at) END,
      CASE WHEN v_mapped = 'closed' THEN f.distributed_by END,
      CASE WHEN v_mapped = 'void'
           THEN COALESCE(NULLIF(btrim(f.void_reason), ''), 'form voided at source') END)
    -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6):
    -- a duplicate projection is swallowed, an origin='split' row is untouched,
    -- and a work_items_ref_unique collision still raises 23505. The predicate
    -- is work_items_src_form_uidx's, verbatim (00196:375):
    --   (site_form_id) WHERE site_form_id IS NOT NULL AND origin = 'mirror'
    ON CONFLICT (site_form_id) WHERE site_form_id IS NOT NULL AND origin = 'mirror' DO NOTHING
    RETURNING * INTO v_item;
    -- No watcher seeding: §11 has already done it (see the section D comment).
  ELSE
    -- Improvement 8: a project move re-resolves both people — of a LIVE item
    -- (D.1's rule, Task 8 review S1: a closed or void item's people are part
    -- of the record). Runs at depth 2 under section C''s exemption (clause
    -- (a) makes project_id immutable for a signed-in actor); the membership
    -- trigger (00196:961-984) still re-validates both people first, by name
    -- order. D.1 has the full reasoning; nothing about it is form-specific.
    v_moved := v_item.project_id IS DISTINCT FROM f.project_id;
    v_live  := v_item.status NOT IN ('closed','void');

    -- Difference 9 (Task 10 review, rule 1): a closed or void record is not
    -- rewritten by a source edit that changes nothing it projects. Without
    -- this a distributed_by re-stamp on a distributed form — watched, so the
    -- _upd trigger fires — rewrites the tuple and the guard stamps
    -- last_activity_at = now() on a record nothing else changed: the very
    -- signal probe 10 same_value_write_does_not_reproject treats as a failure
    -- (measured by ctid on the diary arm). What a non-live row still projects
    -- is its project / org (a move), its title (a closed row follows a
    -- rename; a void row is frozen — difference 10 — and is never compared:
    -- a board rename on a born-void form kept the frozen title but rewrote
    -- the tuple, last_activity_at 2026-08-14 → now(), Task 11 review I2) and
    -- source_status.
    IF NOT v_live AND NOT v_moved
       AND v_item.organisation_id IS NOT DISTINCT FROM f.organisation_id
       AND (v_item.status = 'void' OR v_title = v_item.title)
       AND f.status IS NOT DISTINCT FROM v_item.source_status THEN
      RETURN;
    END IF;

    IF NOT v_live THEN
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    ELSIF v_moved THEN
      v_assignee := projects.resolve_mirror_assignee(f.project_id, 'form_action', f.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(f.project_id, NULL);
    ELSE
      -- Difference 7: no forward read of created_by (immutable on the source
      -- for every real actor); the spine's current holder stays (the spine
      -- owns assignment, §03 §1.2) and the PM chain is never re-run on an
      -- existing item (a PM-less project must not raise on an unrelated
      -- edit — Task 8 review).
      v_assignee := v_item.assignee_id;
      v_gate     := v_item.gatekeeper_id;
    END IF;

    -- Status: the CURRENT status is passed in, so void stays void (terminal,
    -- reconciliation #3 — probe 10 void_is_terminal) and a terminal mapping
    -- wins (submitted → answered, distributed → closed, void → void). The
    -- un-triage flag is D.1's shape, "the source names someone ELIGIBLE and
    -- DIFFERENT from what the item holds" — moot here (born open, created_by
    -- immutable), kept so the diff against D.1 is structural. At depth 2 the
    -- guard stamps closed_at = now() on the close transition, keeps the
    -- supplied closed_by, clears both on any other status change, restores
    -- both when the status does not change, and skips its void-reason check
    -- — which is why the reason travels on this same statement (section C',
    -- "Dropping … needs a short reason"). void_reason is never blanked: the
    -- source's reason on a void mapping (non-blank by the source's CHECK),
    -- else what the row already carries.
    UPDATE projects.work_items
       SET project_id       = f.project_id,
           organisation_id  = f.organisation_id,
           -- Difference 10 (Task 10 review, rule 2): a void row's title is
           -- frozen — the record of what was withdrawn; a closed row keeps
           -- following the source (a typo corrected on the board label).
           title            = CASE WHEN v_item.status = 'void' THEN v_item.title ELSE v_title END,
           source_status    = f.status,
           status           = projects.work_item_status_for_mirror(
                                v_item.status, v_mapped,
                                v_explicit AND f.created_by IS DISTINCT FROM v_item.assignee_id),
           assignee_id      = v_assignee,
           gatekeeper_id    = v_gate,
           -- Keyed on the MAPPED status (template rule).
           closed_at        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_at, f.distributed_at, now())
                                   ELSE NULL END,
           closed_by        = CASE WHEN v_mapped = 'closed'
                                   THEN COALESCE(v_item.closed_by, f.distributed_by) END,
           void_reason      = CASE WHEN v_mapped = 'void'
                                   THEN COALESCE(NULLIF(btrim(f.void_reason), ''), v_item.void_reason,
                                                 'form voided at source')
                                   ELSE v_item.void_reason END,
           last_activity_at = now()
     WHERE id = v_item.id;
  END IF;
END $fn$;

-- The trigger wrapper: the same two lines as D.1-D.5's. There is no write-back
-- arm for forms, so no mirror ⇄ write-back cycle to terminate today; the
-- depth guard stays because §03 §1.2 mandates it on every wrapper, the
-- mirror-triggers contract test (a later task) pins it, and it is what stops
-- a future trigger on field.site_forms that writes work_items from
-- re-entering this projection.
CREATE OR REPLACE FUNCTION projects.mirror_form_action_work_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public', 'field'
SET row_security TO 'off'
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM projects.project_form_action(NEW.id);
  RETURN NULL;   -- AFTER trigger; the return value is ignored
END $fn$;

-- F7: two triggers (an INSERT trigger's WHEN cannot reference OLD). Both are
-- AFTER: trg_site_forms_transition (BEFORE) has already admitted the row.
DROP TRIGGER IF EXISTS site_forms_mirror_work_item_ins ON field.site_forms;
CREATE TRIGGER site_forms_mirror_work_item_ins
  AFTER INSERT ON field.site_forms
  FOR EACH ROW EXECUTE FUNCTION projects.mirror_form_action_work_item();

-- The column list is every column the UPDATE arm reads that can change; the
-- WHEN clause is the same list, so a full-row save that changes only
-- as_left_status (or node_id, report_id, the submitted_* stamps) fires
-- nothing (probe 10 same_value_write_does_not_reproject). form_no is here
-- because the app allocates it AFTER the insert (difference 2); created_by is
-- read on a move (which project_id already fires) and, in the un-triage flag,
-- on every UPDATE-arm run — moot, since enforce_site_form_transition makes it
-- immutable for every signed-in caller (difference 7); created_at and
-- updated_at are read on INSERT only; there is no due date to watch.
DROP TRIGGER IF EXISTS site_forms_mirror_work_item_upd ON field.site_forms;
CREATE TRIGGER site_forms_mirror_work_item_upd
  AFTER UPDATE OF form_no, board_ref, board_label, status,
                  distributed_at, distributed_by, void_reason, project_id, organisation_id
  ON field.site_forms
  FOR EACH ROW
  WHEN (OLD.form_no         IS DISTINCT FROM NEW.form_no
     OR OLD.board_ref       IS DISTINCT FROM NEW.board_ref
     OR OLD.board_label     IS DISTINCT FROM NEW.board_label
     OR OLD.status          IS DISTINCT FROM NEW.status
     OR OLD.distributed_at  IS DISTINCT FROM NEW.distributed_at
     OR OLD.distributed_by  IS DISTINCT FROM NEW.distributed_by
     OR OLD.void_reason     IS DISTINCT FROM NEW.void_reason
     OR OLD.project_id      IS DISTINCT FROM NEW.project_id
     OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
  EXECUTE FUNCTION projects.mirror_form_action_work_item();

-- ─── F. Delete-to-void ───────────────────────────────────────────────────────
-- ⚠ BEFORE DELETE, not AFTER. §03 §1.2 says AFTER; that is measurably wrong.
-- The ON DELETE SET NULL referential action runs before a user AFTER DELETE
-- trigger (RI's AFTER triggers fire first, by name), so the AFTER form's
-- UPDATE matches nothing — and A(a)'s work_items_source_required is
-- re-evaluated on that SET NULL while the item is still status = 'open' with
-- zero sources, so the DELETE ABORTS with 23514. Measured against the real
-- table (probe 11, Task 12 Steps 2 and 5 — the earlier synthetic-table probe
-- that reported a silent orphan is withdrawn):
--   ERROR:  23514: new row for relation "work_items" violates check constraint
--           "work_items_source_required"
--   CONTEXT: SQL statement "UPDATE ONLY "projects"."work_items" SET "rfi_id" = NULL …"
--            SQL statement "DELETE FROM projects.rfis WHERE id = …"
-- Deleting a diary entry (deleteDiaryEntryAction,
-- apps/web/src/actions/diary.actions.ts:109 — a live, gated action), an RFI or
-- a snag would simply stop working the moment a mirror item existed.
-- BEFORE DELETE voids first, so both work_items_source_required and
-- work_items_bic_present pass on their 'void' arms and the delete proceeds.
--
-- The trace, pinned by probe 11: the void UPDATE runs at depth 2 (DELETE →
-- this BEFORE trigger → work_items' BEFORE UPDATE guard), so section C''s
-- exemption applies whoever the actor is — the guard restores nothing (the
-- status changes), skips its void-reason check (the reason travels on this
-- statement), and clears closed_at / closed_by on the non-close transition;
-- §11 writes one `voided` event with auth.uid() as the actor (the deleter on
-- a signed-in path, NULL on the service path); section E does not fire
-- (assignee_id and due_date are untouched); then the RI SET NULL lands on a
-- void row (depth 2 again, exempt; clause (a3) admits a FK going to NULL) and
-- both CHECKs pass. On a cascade (qc_reports → qc_entries ON DELETE CASCADE,
-- 00172:112) this fires once per cascaded entry at depth 2 and the UPDATE
-- runs at depth 3 — still exempt. qc_entries_frozen_guard (BEFORE, 00172:491)
-- sorts before qc_entries_void_work_item and runs first, as it should.
--
-- A CLOSED item is voided too, and that is FORCED, not chosen:
-- work_items_source_required admits a source-less mirror item only while
-- status = 'void', so a closed item left closed with its FK nulled fails the
-- CHECK on the SET NULL and the DELETE aborts. closed → void is illegal on
-- the machine at depth 1 (clause (c)), so a signed-in delete of a closed
-- item's source succeeds only through the depth-2 exemption — probe 11 runs
-- exactly that under impersonation. The VOID is the constraint's necessity
-- (no constraint names closed_at or closed_by); the STAMP LOSS is a different
-- thing — C''s exempt-path rule (IF NEW.status = 'closed' THEN closed_at :=
-- now() ELSE closed_at := NULL; closed_by := NULL, inherited from
-- 00196:1545-1546) clears closed_at / closed_by on this transition, and this
-- trigger cannot preserve them. Kept as built (Task 12 review): the `closed`
-- event (§11) preserves who closed it and when, and "stamps ⇔ closed" stays a
-- simple invariant, so no future consumer filtering on closed_at IS NOT NULL
-- reads a void row as closed. Probe 11 pins both
-- (closed_item_is_voided_on_source_delete,
-- closed_stamps_are_cleared_by_the_void). Alternatives for the owner: keep
-- the stamps on closed → void in C''s exempt path (one line, item 3's
-- migration — a void row would then carry close stamps), or admit 'closed' in
-- work_items_source_required (item 2) — deviation 21. An already-void item is
-- left alone (status <> 'void'): it keeps its own reason and gains no `voided`
-- event (void_item_keeps_its_reason).
--
-- One function serves all six, keyed on TG_ARGV[0]. format('%I') quotes the
-- identifier, and TG_ARGV is developer-supplied in this file, so there is no
-- injection surface. Grants: none here — section G (Task 13) carries the
-- REVOKE ALL … FROM PUBLIC / REVOKE EXECUTE … FROM anon; the @verify block
-- already carries the grant_absent: line. Trigger-function EXECUTE is checked
-- at CREATE TRIGGER, not at fire time (F5), so nothing is GRANTed.
CREATE OR REPLACE FUNCTION projects.void_work_item_on_source_delete()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
  -- %I quotes the identifier; TG_ARGV[0] is set by the six CREATE TRIGGER
  -- statements below and is never user input.
  -- origin = 'mirror' makes A(a)'s partial source index usable (measured: seq scan without it) and leaves a manual task that links a source alone.
  -- ball_in_court_id needs no clearing: it is a STORED generated column over
  -- status and goes NULL on 'void' by itself (A(a)).
  EXECUTE format(
    'UPDATE projects.work_items
        SET status = ''void'', void_reason = $1, last_activity_at = now()
      WHERE %I = $2 AND origin = ''mirror'' AND status <> ''void''', TG_ARGV[0])
    USING 'source deleted', OLD.id;
  RETURN OLD;   -- BEFORE trigger: returning OLD lets the DELETE proceed
END $fn$;

DROP TRIGGER IF EXISTS rfis_void_work_item ON projects.rfis;
CREATE TRIGGER rfis_void_work_item BEFORE DELETE ON projects.rfis
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('rfi_id');
DROP TRIGGER IF EXISTS snags_void_work_item ON field.snags;
CREATE TRIGGER snags_void_work_item BEFORE DELETE ON field.snags
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('snag_id');
DROP TRIGGER IF EXISTS inspections_void_work_item ON inspections.inspections;
CREATE TRIGGER inspections_void_work_item BEFORE DELETE ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('inspection_id');
DROP TRIGGER IF EXISTS qc_entries_void_work_item ON projects.qc_entries;
CREATE TRIGGER qc_entries_void_work_item BEFORE DELETE ON projects.qc_entries
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('qc_entry_id');
DROP TRIGGER IF EXISTS site_diary_entries_void_work_item ON projects.site_diary_entries;
CREATE TRIGGER site_diary_entries_void_work_item BEFORE DELETE ON projects.site_diary_entries
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('diary_id');
DROP TRIGGER IF EXISTS site_forms_void_work_item ON field.site_forms;
CREATE TRIGGER site_forms_void_work_item BEFORE DELETE ON field.site_forms
  FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('site_form_id');

-- ─── G. Grants ───────────────────────────────────────────────────────────────
-- Two obligations, routinely confused (§12 §(b) rule 5), and this file has
-- both: the twenty-two functions it creates — every function: line of the
-- @verify block except the replaced guard, which section C' re-revokes — and
-- the snapshot table, whose REVOKE lives with its CREATE in section H (Task
-- 14). Only the functions are here.
--
-- In `projects` a new function's anon EXECUTE is Postgres's built-in PUBLIC
-- grant — pg_default_acl carries NO function default for this schema (item 2
-- measured it; re-read live 2026-09-13: one sequence (S) and one table (r)
-- entry, both postgres's, nothing for functions), unlike `public`, where
-- 00113's precedent pairs FROM PUBLIC with FROM anon because Supabase's
-- bootstrap ALTER DEFAULT PRIVILEGES grants anon EXECUTE directly at creation,
-- which is why 00113 pairs both revokes in `public`. `field` is like
-- `projects` — no function default — so 00179:314-320's bare FROM PUBLIC
-- sufficed there; field.allocate_form_no shipped open because 00179:326's
-- GRANT … TO service_role was issued with no revoke at all. Both
-- revokes are issued anyway: belt and braces, and every grant_absent: line
-- above then holds whichever convention a later migration copies. So the
-- mutation that proves this block bites is dropping the FROM PUBLIC line
-- (the assertion below names all twenty-two); dropping FROM anon alone leaves
-- the block silent in this schema — there is no direct anon grant to remove —
-- which is exactly why the 2026-09-10 mutation could not fail. Verified with
-- has_function_privilege, never proacl: a NULL proacl looks empty but IS the
-- PUBLIC grant.
--
-- No GRANT follows. Measured (F5): a trigger fires for a caller with no EXECUTE
-- on its function (privileges are checked at CREATE TRIGGER time, not at fire
-- time), and every function below is reached only from a trigger or from
-- another SECURITY DEFINER function owned by the same role — the backfill
-- (section H) calls the project_*() bodies as postgres, their owner. Granting
-- EXECUTE would widen the surface for nothing. Item 2 follows the same posture
-- (00196:1041-1064, 1461-1462, 1770-1771); its GRANT of
-- resolve_work_item_assignee to authenticated (00196:1078, the people-picker)
-- is not touched here and is not what the assertion tests.
-- ⚠ WRITTEN OUT, one statement per function, NOT a DO-block loop over
--    pg_proc. The loop revoked correctly — probe 12 proved it at runtime — but
--    packages/db's anon-execute-secdef.test.ts scans this file's TEXT for a
--    REVOKE naming each SECURITY DEFINER function it creates, and a revoke
--    assembled inside EXECUTE format() is invisible to it. That test is a
--    repo-wide guard over every migration, so the migration bends, not the
--    guard: it cannot verify dynamic SQL, and a static list is also what a
--    human reads in the diff. It removes a second hazard too — a typo in the
--    loop's proname list revoked nothing for that name and only the assertion
--    below would have caught it.
REVOKE ALL     ON FUNCTION projects.work_item_person_eligible(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_item_person_eligible(uuid,uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.resolve_mirror_assignee(uuid,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.resolve_mirror_assignee(uuid,text,uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.resolve_work_item_gatekeeper(uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.resolve_work_item_gatekeeper(uuid,uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.map_source_status(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.map_source_status(text,text) FROM anon;
REVOKE ALL     ON FUNCTION projects.work_item_status_for_mirror(text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_item_status_for_mirror(text,text,boolean) FROM anon;
REVOKE ALL     ON FUNCTION projects.work_item_mirror_due_date(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_item_mirror_due_date(date) FROM anon;
REVOKE ALL     ON FUNCTION projects.diary_delay_text(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.diary_delay_text(text,text) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_rfi(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_rfi(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_snag(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_snag(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_inspection(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_inspection(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_qc_entry(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_qc_entry(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_diary_action(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_diary_action(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.project_form_action(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_form_action(uuid) FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_rfi_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_rfi_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_snag_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_snag_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_inspection_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_inspection_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_qc_defect_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_qc_defect_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_qc_report_defects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_qc_report_defects() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_diary_action_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_diary_action_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.mirror_form_action_work_item() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.mirror_form_action_work_item() FROM anon;
REVOKE ALL     ON FUNCTION projects.work_item_assignment_writeback() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_item_assignment_writeback() FROM anon;
REVOKE ALL     ON FUNCTION projects.void_work_item_on_source_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.void_work_item_on_source_delete() FROM anon;

-- Assert the revoke actually took, in the same transaction that made it.
-- The LIKE ANY pattern is deliberately BROADER than the explicit list above, so
-- a function added to this migration later and forgotten in the DO block fails
-- the apply rather than shipping open (Task 13 Step 5: a scratch
-- projects.work_item_scratch() left out of the list is named here). It also
-- sweeps the earlier functions of this schema that share these prefixes — read
-- live 2026-09-13: project_had_activity, project_settings_audit,
-- resolve_project_pm, resolve_triage_owner, resolve_work_item_assignee and
-- work_items_transition_guard, every one already revoked — so the assertion is
-- true today. It is NOT a durable tripwire: this DO block runs once, at this
-- apply. The estate-wide one re-evaluated on every deploy is 00186's
-- `anon_execute_absent: … projects …`, and it filters prosecdef — so the four
-- SECURITY INVOKER helpers here (map_source_status, work_item_status_for_mirror,
-- work_item_mirror_due_date, diary_delay_text) are covered by this file's
-- grant_absent: lines and by nothing else, and a future INVOKER projects.mirror_*
-- leak would be caught by neither.
DO $assert_grants$
DECLARE v_leak text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname) INTO v_leak
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'projects'
     AND p.proname LIKE ANY (ARRAY['mirror\_%','resolve\_%','project\_%','map\_source\_status',
                                   'work\_item\_%','work\_items\_transition\_guard',
                                   'void\_work\_item\_%','diary\_delay\_text'])
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'anon retains EXECUTE on: %. Add each to section G''s DO $grants$ list.', v_leak;
  END IF;
END $assert_grants$;

-- ─── H. Pre-migration snapshot, then the backfill ────────────────────────────
-- R52 (A(f)): every migration that overwrites a column takes a snapshot into a
-- timestamped backup_<version>_<object> table in the same transaction, with the
-- restore statement named in the header. updated_at is included because the
-- write-back fires rfis_updated_at (00002:100) and snags_updated_at (00004:33)
-- on the rows it touches. due_date is included because the floor UPDATE below
-- reaches projects.rfis.due_date through the write-back on the open RFIs.
--
-- Measured 2026-09-15, which is what the snapshot has to be able to undo: 15
-- RFIs (6 closed / 8 open / 1 responded), ALL FIFTEEN with assigned_to NULL and
-- every non-closed one already past its due date; 6 snags, all in the E-Site
-- DEMO org and all unassigned. So the write-back's live effect is exactly nine
-- rows on projects.rfis — assigned_to, due_date and updated_at — and zero rows
-- on field.snags. Both tables are snapshotted whole anyway: the restore must
-- not depend on today's measurement being right.
CREATE TABLE IF NOT EXISTS projects.backup_00202_source_assignees AS
  SELECT 'rfi'::text AS kind, id, assigned_to, due_date, updated_at
    FROM projects.rfis
  UNION ALL
  SELECT 'snag', id, assigned_to, NULL::date, updated_at
    FROM field.snags;

-- 00196:1310 ran ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON
-- TABLES FROM anon, so this table is NOT born anon-readable (the 00025:26
-- default no longer applies in this schema). Revoked explicitly anyway: it
-- holds the assignee of every RFI and snag on the platform, and the revoke is
-- true whichever default a later migration re-establishes. ⚠ Deleting this
-- line does NOT turn probe 12's snapshot_table_not_anon_readable red today —
-- there is nothing for it to remove — which is why the proving mutation is a
-- GRANT SELECT … TO anon placed immediately BEFORE it (still 8/8: the revoke
-- removed the grant) and then immediately AFTER it (red).
REVOKE SELECT ON projects.backup_00202_source_assignees FROM anon;
ALTER TABLE projects.backup_00202_source_assignees ENABLE ROW LEVEL SECURITY;
-- No policy, deliberately: RLS with no policy is deny-all for every role except
-- the table owner and service_role. Nothing in the app reads this table.

-- ⚠ Notification suppression — forward-looking, and vacuous today. Item 2's
-- §11 writes NO bell and reads NO GUC ("Nothing here writes a bell",
-- 00196:1354-1356); item 4 adds the emit and the
-- current_setting('esite.suppress_notifications', true) guard to that same
-- function by CREATE OR REPLACE. This SET LOCAL is the exact GUC item 4 will
-- honour, so it is set here on principle: against an estate where 964
-- notifications have produced 57 reads, ~35 assignment bells plus overdue
-- bells plus a 07:00 recap listing 35 stale items is the failure this
-- programme exists to reverse, and a backfill that runs after item 4 lands
-- (a re-run, a restore) must already carry it. work_item_events rows are
-- STILL written — the metrics need them.
SET LOCAL esite.suppress_notifications = 'on';

DO $backfill$
DECLARE
  -- ⚠ ONE literal, re-derived at merge to the planned APPLY date (Task 20
  --   Step 4). Everything else is computed from it: the floor for a backfilled
  --   OPEN item is go_live + 5 office working days on THAT PROJECT's calendar,
  --   pushed past that project's builders' shutdown band — projects.
  --   add_working_days and push_past_builders_shutdown are item 2's §5
  --   functions, the same two §5 uses to compute every live due date, so the
  --   backfill and the live path cannot disagree about what a working day is.
  --   (The plan's hand-derived DATE '2026-11-10' literal was a second
  --   calendar; it happens to be what all five projects holding a backfilled
  --   item answer today, which is exactly how a second calendar survives
  --   review.)
  v_go_live  CONSTANT date := DATE '2026-11-03';   -- Tuesday; set at merge to the planned apply date (Task 20 Step 4)
  v_demo     CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';  -- E-Site DEMO
  v_row  record;
  v_n    int;
BEGIN
  -- ⚠ Lock order (#18, item 2 hand-off). §6's ref allocator takes a
  --    per-(project, type) advisory lock held to COMMIT (00196:752-803). One
  --    LOOP per type, each ordered by (project_id, source id), gives every
  --    session the same acquisition order; a concurrent client insert during
  --    the apply could otherwise deadlock (40P01 — aborted cleanly, retry-safe,
  --    but it would abort db push).
  --
  -- ⚠ A LOOP, not the plan's `PERFORM projects.project_rfi(r.id) FROM … ORDER
  --    BY …`. The ordering above is the whole point of the clause, and a LOOP
  --    is the only form that states it as a guarantee rather than leaving it to
  --    the planner's target-list placement. (An earlier comment here claimed a
  --    volatile function in a target list is evaluated BELOW the Sort and so
  --    runs in scan order. That is FALSE on 17.6 and was measured: over 40 rows
  --    `PERFORM f(s.v) FROM _src s ORDER BY s.k` recorded 40,39,38,37,36 — sort
  --    order, not scan order (1,2,3,4,5), because make_sort_input_target()
  --    unconditionally postpones volatile expressions ABOVE the Sort. The loop
  --    is kept because it does not depend on that behaviour holding.)

  -- 1. RFIs — 15 on 2026-09-15 (6 closed, 8 open, 1 responded; the plan's 15).
  --    Projected DIRECTLY through projects.project_rfi(), never by touching the
  --    source row: every source table carries a BEFORE UPDATE set_updated_at
  --    trigger, and with the F7 WHEN predicates in place a no-op UPDATE would
  --    fire nothing anyway. Historical stamps travel with the projection (#4):
  --    opened_at = rfis.created_at, closed_at/closed_by for the 6 closed ones —
  --    kept because this runs on the service path (auth.uid() IS NULL under
  --    db push, so §5 does not re-stamp opened_at).
  --    The INSERT fires section E at depth 1: each open RFI receives the
  --    resolved holder and the spine's computed due date on projects.rfis, and
  --    the re-entrant mirror at depth 2 returns on the wrapper's guard. That
  --    write-back is the point (rule (a)) — the RFI page renders a holder for
  --    the first time — and the snapshot above is its undo.
  v_n := 0;
  FOR v_row IN
    SELECT r.id FROM projects.rfis r
      JOIN projects.projects p ON p.id = r.project_id
     WHERE p.organisation_id <> v_demo
     ORDER BY p.id, r.id
  LOOP
    PERFORM projects.project_rfi(v_row.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'backfill: projected % rfis (15 expected on 2026-09-15 data)', v_n;

  -- 2. Inspections — 19 on 2026-09-15 (the plan says 18; two were raised since
  --    2026-09-10 and Task 8 already measured 19 on 2026-09-13). Every one is
  --    at status 'assigned' with both assigned_to_id and verifier_id set.
  --    No profiles guard here: projects.project_inspection() already handles an
  --    auth user with no profiles row via work_item_person_eligible, and a
  --    second WHERE EXISTS would SKIP a row the projection would have handled
  --    correctly, turning a data question into a count mismatch. Measured: 0
  --    such rows exist today.
  v_n := 0;
  FOR v_row IN
    SELECT i.id FROM inspections.inspections i
      JOIN projects.projects p ON p.id = i.project_id
     WHERE p.organisation_id <> v_demo
     ORDER BY p.id, i.id
  LOOP
    PERFORM projects.project_inspection(v_row.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'backfill: projected % inspections (19 expected on 2026-09-15 data)', v_n;

  -- 3. Snags — improvement 2. All six live rows are seeded E-Site DEMO fixtures
  --    (identical created_at, one demo contractor as raiser, a project whose
  --    creator resolves to contractor and would therefore be his own
  --    gatekeeper). Backfilling them manufactures defects no real person owes
  --    and pollutes metric 2a's contractor numerator with a fixture account.
  --    The snag spine goes live EMPTY; the live trigger is unaffected. The
  --    predicate is written out rather than the arm deleted, so the intent
  --    survives the demo data — and probe 13's snag_arm_includes_non_demo_orgs
  --    projects a synthetic snag on a REAL-org project through this exact arm,
  --    so "0 rows" can never be read as "snags are not mirrored".
  v_n := 0;
  FOR v_row IN
    SELECT s.id FROM field.snags s
      JOIN projects.projects p ON p.id = s.project_id
     WHERE p.organisation_id <> v_demo AND p.status = 'active'
     ORDER BY p.id, s.id
  LOOP
    PERFORM projects.project_snag(v_row.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'backfill: projected % snags (0 expected — all 6 live rows are demo)', v_n;

  -- 4. QC defects — failed entries on issued/closed reports only.
  --    Expected to project ZERO rows today: all 11 live entries are
  --    conformance='na', on one issued report (F4, re-measured 2026-09-15).
  --    That is not a reason to widen the predicate. A defect projected here is
  --    born at its report's ISSUE, not at its draft (deviation 18 (3):
  --    opened_at = GREATEST(entry.created_at, report.issued_at)).
  v_n := 0;
  FOR v_row IN
    SELECT e.id FROM projects.qc_entries e
      JOIN projects.qc_reports r ON r.id = e.report_id
      JOIN projects.projects p ON p.id = e.project_id
     WHERE e.conformance = 'fail' AND r.status IN ('issued','closed')
       AND p.organisation_id <> v_demo
     ORDER BY p.id, e.id
  LOOP
    PERFORM projects.project_qc_entry(v_row.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'backfill: projected % qc defects (0 expected on 2026-09-15 live data)', v_n;

  -- 5. Diary — NO ARM. Improvement 1. All 6 of 6 entries a non-empty test would
  --    have projected are negations ("None," ×2, "None" ×2, "NO", and "No delays
  --    or info required was noted in the site walk and or meeting"; plus two
  --    delay_notes both reading "None" — re-measured 2026-09-15). Zero of them
  --    is a delay, so there is nothing historical to project. Entries written
  --    from go-live onward are projected by the live trigger, which carries the
  --    same stop-list. A filtered arm that selects zero rows is omitted rather
  --    than written, because a zero-row filter invites someone to "fix" it.

  -- 6. Site forms — the single live row (the draft on (649) PNP FAERIE GLEN;
  --    its author is the org owner, so F10 births it 'open' on him).
  v_n := 0;
  FOR v_row IN
    SELECT f.id FROM field.site_forms f
      JOIN projects.projects p ON p.id = f.project_id
     WHERE p.organisation_id <> v_demo
     ORDER BY p.id, f.id
  LOOP
    PERFORM projects.project_form_action(v_row.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'backfill: projected % site forms (1 expected on 2026-09-15 data)', v_n;

  -- 7. structure.node_orders: NOTHING. 453 rows (440 on 2026-09-10), no
  --    trigger, no backfill. A(b): order_followup is created only by the
  --    explicit chase control on an order line. Projecting 453 procurement rows
  --    into an inbox that is read 6% of the time is the fastest way to prove
  --    the new inbox is also noise.

  -- 8. Floor every backfilled OPEN due date. An item months overdue on day one
  --    is a red inbox nobody opens (§03 §1.10) — and on today's data EVERY one
  --    of the nine non-closed RFIs is already past its due date. Closed and
  --    void items are NOT floored (improvement 9): giving a July record a
  --    November deadline sorts finished work into My Work's date bands.
  --    GREATEST, so an item whose computed date is already beyond the floor
  --    keeps it; the WHERE makes that case a no-op rather than a rewrite.
  --    This UPDATE runs on the service path (auth.uid() NULL under db push), so
  --    the guard's clause (a4) does not apply; it reaches projects.rfis.due_date
  --    on the open RFIs through the write-back at depth 1 (and bumps their
  --    updated_at — the snapshot's due_date/updated_at columns are the
  --    restore). The chain ends there: due_date is not in
  --    rfis_mirror_work_item_upd's UPDATE OF list, so the source write fires no
  --    projection at all.
  --    Neither helper can return NULL here, so there is no 22004 to guard and no
  --    §5-style no_data_found handler: add_working_days walks a calendar seeded
  --    2024→2035 (checked at Task 14), and push_past_builders_shutdown returns a
  --    date for every input — measured on the worst case, a floor inside a
  --    shutdown band: push(add(2026-12-20, 5)) = 2027-01-16, not NULL. A future
  --    go_live beyond the seeded calendar is the only way to reach one, and the
  --    seed's own guard raises there first.
  --    `due_date IS NULL` is never floored — the comparison is NULL, so the row
  --    is not matched. No mirrored item has a NULL due date today (§5 computes
  --    one for every type), and a floor on an item with no deadline would be
  --    inventing a deadline, which is the one thing this clause must not do.
  UPDATE projects.work_items w
     SET due_date = GREATEST(w.due_date,
                      projects.push_past_builders_shutdown(
                        projects.add_working_days(v_go_live, 5, w.project_id, 'office'),
                        w.project_id))
   WHERE w.origin = 'mirror'
     AND w.status IN ('triage','open','answered')
     AND w.due_date < projects.push_past_builders_shutdown(
                        projects.add_working_days(v_go_live, 5, w.project_id, 'office'),
                        w.project_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'backfill: floored % open due dates to go_live(%) + 5 office working days, per project', v_n, v_go_live;

  -- 9. Departed watchers (#10, item 2 hand-off). §11 seeds created_by as a
  --    watcher on every INSERT regardless of membership, so a raiser who has
  --    since left the project becomes a non-member watcher who can read the
  --    item through the SELECT policy's watcher arm. Backfill-only: the live
  --    path's raiser is, by construction, a current member.
  --    ⚠ Measured 2026-09-15: every raiser, inspector, verifier and author
  --    behind the 35 live items still holds an effective role, so this deletes
  --    ZERO rows today. It is kept because "zero" here measures the estate's
  --    current staffing, not the absence of the case — the same mistake as the
  --    form_response newline count — and probe 13 makes it bite with a snag
  --    raised by an org contractor who is not a member of its project.
  DELETE FROM projects.work_item_watchers w
   USING projects.work_items wi
   WHERE wi.id = w.work_item_id AND wi.origin = 'mirror'
     AND public.user_effective_project_role(wi.project_id, w.user_id) IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'backfill: removed % non-member watchers', v_n;
END $backfill$;

-- ─── I. The completion event ─────────────────────────────────────────────────
-- A(f) ordinal 9, and §12 §(d): "The first recap after go-live carries only
-- items whose events post-date the backfill timestamp, recorded as
-- product_events.properties->>'backfill_completed_at'". Without this row, item
-- 4's 07:00 recap on day one lists all 35 backfilled items — the exact failure
-- the suppression GUC above exists to avoid.
-- F11: `event` is a fixed CHECK vocabulary (00194:231-238) and
-- 'backfill_completed' is its arm for this (section A refuses the apply if the
-- constraint does not admit it, so the failure is a sentence at the top rather
-- than a 23514 after the whole backfill has run); properties.migration says
-- WHICH backfill. Direct INSERT, not emit_product_event() — that raises on an
-- absent project, and these are org-level rows (project_id nullable).
-- public.product_events.organisation_id is NOT NULL (§12 §(i)), so one row is
-- written per organisation touched, each carrying the same timestamp (now() is
-- fixed for the transaction). That is also the more correct shape: each org's
-- recap reads its own row. One row today — every backfilled item belongs to
-- WM-Consulting.
INSERT INTO public.product_events (organisation_id, project_id, actor_id, event, properties)
SELECT o.organisation_id, NULL, NULL, 'backfill_completed',
       jsonb_build_object(
         'backfill_completed_at', now(),
         'items', o.n,
         'migration', 'work_item_source_mirrors_and_backfill')
  FROM (SELECT p.organisation_id, count(*) AS n
          FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
         WHERE w.origin = 'mirror'
         GROUP BY p.organisation_id) o
 -- One row per organisation, EVER. A second apply would otherwise write a
 -- second row per org, and item 4's recap reads
 -- properties->>'backfill_completed_at' — with two rows it silently picks one
 -- and the first post-go-live recap either repeats or skips a week of items.
 -- product_events has no natural key to put an ON CONFLICT on, so the guard is
 -- a NOT EXISTS on this migration's own marker.
 WHERE NOT EXISTS (
         SELECT 1 FROM public.product_events pe
          WHERE pe.event = 'backfill_completed'
            AND pe.organisation_id = o.organisation_id
            AND pe.properties->>'migration' = 'work_item_source_mirrors_and_backfill');

-- Post-conditions, asserted in the same transaction that made them.
DO $postcheck$
DECLARE v_total int; v_orders int; v_stranded int;
BEGIN
  SELECT count(*) INTO v_total FROM projects.work_items WHERE origin = 'mirror';
  IF v_total = 0 THEN
    RAISE EXCEPTION 'the backfill projected nothing at all';
  END IF;

  SELECT count(*) INTO v_orders FROM projects.work_items WHERE item_type = 'order_followup';
  IF v_orders > 0 THEN
    RAISE EXCEPTION 'order_followup items exist (%) — A(b) forbids an automatic path', v_orders;
  END IF;

  SELECT count(*) INTO v_stranded
    FROM projects.work_items w
   WHERE w.origin = 'mirror' AND w.status IN ('triage','open','answered')
     AND public.user_effective_project_role(w.project_id, w.ball_in_court_id) = 'client_viewer';
  IF v_stranded > 0 THEN
    RAISE EXCEPTION '% items land on a client viewer, who cannot clear them until Q3', v_stranded;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_events
                  WHERE event = 'backfill_completed'
                    AND properties->>'migration' = 'work_item_source_mirrors_and_backfill') THEN
    RAISE EXCEPTION 'no backfill-completion event was written (§12 §(d))';
  END IF;
END $postcheck$;
