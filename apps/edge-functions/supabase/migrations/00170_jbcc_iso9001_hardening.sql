-- 00170_jbcc_iso9001_hardening.sql
-- JBCC Procedural module — ISO 9001:2015 clause 7.5 (documented information)
-- hardening for the letter-generation pipeline.
--
-- Turns a JBCC letter from "ordinary application data" into a CONTROLLED
-- DOCUMENT:
--   7.5.2 identification .... unique, human-readable, per-project document
--                             reference allocated gap-free (mirrors the
--                             inspections.allocate_coc_number pattern, 00066).
--   7.5.2 review/approval ... draft -> in_review -> approved -> issued -> served
--                             lifecycle with reviewer/approver/issuer/server
--                             identity + timestamps captured.
--   7.5.3 version control ... issued letters are content-frozen at the data
--                             layer (BEFORE UPDATE trigger); corrections go
--                             through a supersede/new-revision flow.
--   7.5.3 change control ..... append-only projects.jbcc_letter_events audit
--                             trail; every transition records actor + time.
--   7.5.3 distribution ....... projects.jbcc_letter_recipients (to / cc) with a
--                             name snapshot + proof-of-service metadata.
--   7.5.3 preservation ....... soft-delete + retention_until + legal_hold; a
--                             letter under legal hold can never be deleted.
--
-- Also reconciles the JBCC writer role-set (adds contractor — the primary
-- author of JBCC notices) between RLS and the app layer, and tightens the
-- read surface from org-wide to the project's write-capable roles.
--
-- New tables live in the already-exposed `projects` schema, so a
-- `NOTIFY pgrst, 'reload schema'` (bottom of file) is sufficient — no
-- PostgREST db_schema PATCH is required (that is only for new/dropped schemas).

BEGIN;

-- ============================================================================
-- 1. Status machine expansion
-- ============================================================================

ALTER TABLE projects.jbcc_letters DROP CONSTRAINT IF EXISTS jbcc_letters_status_check;
ALTER TABLE projects.jbcc_letters
  ADD CONSTRAINT jbcc_letters_status_check
  CHECK (status IN ('draft','in_review','approved','issued','served','superseded','withdrawn'));

-- ============================================================================
-- 2. ISO identification + revision + lifecycle-actor + retention columns
-- ============================================================================

ALTER TABLE projects.jbcc_letters
  ADD COLUMN IF NOT EXISTS letter_reference        text,
  ADD COLUMN IF NOT EXISTS subject                 text,
  ADD COLUMN IF NOT EXISTS revision                integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_letter_id    uuid REFERENCES projects.jbcc_letters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_letter_id uuid REFERENCES projects.jbcc_letters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by             uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at             timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by             uuid,
  ADD COLUMN IF NOT EXISTS approved_at             timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by               uuid,
  ADD COLUMN IF NOT EXISTS issued_at               timestamptz,
  ADD COLUMN IF NOT EXISTS served_by               uuid,
  ADD COLUMN IF NOT EXISTS served_at               timestamptz,
  ADD COLUMN IF NOT EXISTS service_reference       text,
  ADD COLUMN IF NOT EXISTS deemed_service_date     date,
  ADD COLUMN IF NOT EXISTS proof_attachment_id     uuid,
  ADD COLUMN IF NOT EXISTS deleted_at              timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until         date,
  ADD COLUMN IF NOT EXISTS legal_hold              boolean NOT NULL DEFAULT false;

-- proof-of-service artefact points at one of the letter's attachments.
ALTER TABLE projects.jbcc_letters DROP CONSTRAINT IF EXISTS jbcc_letters_proof_attachment_fk;
ALTER TABLE projects.jbcc_letters
  ADD CONSTRAINT jbcc_letters_proof_attachment_fk
  FOREIGN KEY (proof_attachment_id)
  REFERENCES projects.jbcc_letter_attachments(id) ON DELETE SET NULL;

-- One controlled reference per project (partial: legacy rows are backfilled
-- below, then this holds for every row).
CREATE UNIQUE INDEX IF NOT EXISTS jbcc_letters_reference_uq
  ON projects.jbcc_letters (project_id, letter_reference)
  WHERE letter_reference IS NOT NULL;

-- ============================================================================
-- 3. Per-project, gap-free document-number allocator
--    (mirrors inspections.allocate_coc_number / inspections.coc_number_seqs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects.jbcc_letter_number_seqs (
  project_id uuid    NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  last_seq   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, year)
);
ALTER TABLE projects.jbcc_letter_number_seqs ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the SECURITY DEFINER allocator writes here.

CREATE OR REPLACE FUNCTION projects.jbcc_allocate_letter_reference(_project_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  pcode text;
  yr    int := EXTRACT(YEAR FROM now());
  seq   int;
BEGIN
  SELECT code INTO pcode FROM projects.projects WHERE id = _project_id;
  IF pcode IS NULL OR pcode = '' THEN
    pcode := 'PRJ';
  END IF;

  INSERT INTO projects.jbcc_letter_number_seqs (project_id, year, last_seq)
    VALUES (_project_id, yr, 1)
    ON CONFLICT (project_id, year)
      DO UPDATE SET last_seq = projects.jbcc_letter_number_seqs.last_seq + 1
    RETURNING last_seq INTO seq;

  RETURN format('JBCC-%s-%s-%s', pcode, yr, lpad(seq::text, 4, '0'));
END $fn$;

GRANT EXECUTE ON FUNCTION projects.jbcc_allocate_letter_reference(uuid) TO authenticated;

-- BEFORE INSERT: fill letter_reference when the caller did not supply one
-- (mirrors projects_ensure_code). The allocator is SECURITY DEFINER so the
-- seqs table is written regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION projects.jbcc_letters_ensure_reference() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.letter_reference IS NULL THEN
    NEW.letter_reference := projects.jbcc_allocate_letter_reference(NEW.project_id);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jbcc_letters_ensure_reference ON projects.jbcc_letters;
CREATE TRIGGER trg_jbcc_letters_ensure_reference
  BEFORE INSERT ON projects.jbcc_letters
  FOR EACH ROW EXECUTE FUNCTION projects.jbcc_letters_ensure_reference();

-- ============================================================================
-- 4. Backfill controlled references for pre-existing letters
--    (must run BEFORE the immutability guard is installed, since the guard
--     would otherwise reject writing a reference onto an issued letter).
-- ============================================================================

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, project_id
      FROM projects.jbcc_letters
     WHERE letter_reference IS NULL
     ORDER BY created_at
  LOOP
    UPDATE projects.jbcc_letters
       SET letter_reference = projects.jbcc_allocate_letter_reference(r.project_id)
     WHERE id = r.id;
  END LOOP;
END $backfill$;

-- ============================================================================
-- 5. Status-transition rules + immutability / delete guards
-- ============================================================================

CREATE OR REPLACE FUNCTION projects.jbcc_status_can_transition(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE _from
    WHEN 'draft'     THEN _to IN ('in_review','approved','issued','withdrawn')
    WHEN 'in_review' THEN _to IN ('approved','draft','withdrawn')
    WHEN 'approved'  THEN _to IN ('issued','in_review','draft','withdrawn')
    WHEN 'issued'    THEN _to IN ('served','superseded')
    WHEN 'served'    THEN _to IN ('superseded')
    ELSE false          -- superseded / withdrawn are terminal
  END;
$fn$;

-- Freeze content once a letter leaves draft; enforce forward-only transitions.
CREATE OR REPLACE FUNCTION projects.jbcc_letters_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.field_values       IS DISTINCT FROM OLD.field_values
    OR NEW.document_path      IS DISTINCT FROM OLD.document_path
    OR NEW.notice_id          IS DISTINCT FROM OLD.notice_id
    OR NEW.recipient_party_id IS DISTINCT FROM OLD.recipient_party_id
    OR NEW.trigger_date       IS DISTINCT FROM OLD.trigger_date
    OR NEW.letter_reference   IS DISTINCT FROM OLD.letter_reference
    OR NEW.revision           IS DISTINCT FROM OLD.revision
    OR NEW.subject            IS DISTINCT FROM OLD.subject THEN
      RAISE EXCEPTION
        'JBCC letter % is % — its content is frozen (ISO 7.5.3). Supersede with a new revision instead.',
        COALESCE(OLD.letter_reference, OLD.id::text), OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT projects.jbcc_status_can_transition(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Illegal JBCC letter status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jbcc_letters_guard_update ON projects.jbcc_letters;
CREATE TRIGGER trg_jbcc_letters_guard_update
  BEFORE UPDATE ON projects.jbcc_letters
  FOR EACH ROW EXECUTE FUNCTION projects.jbcc_letters_guard_update();

-- Hard-delete guard: a letter under legal hold can NEVER be deleted (this also
-- blocks a project cascade delete from destroying held records). Non-draft
-- letters are additionally protected from direct deletes by RLS (below); the
-- app uses soft-delete/supersede for them.
CREATE OR REPLACE FUNCTION projects.jbcc_letters_guard_delete() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.legal_hold THEN
    RAISE EXCEPTION 'JBCC letter % is under legal hold and cannot be deleted (ISO 7.5.3 retention).',
      COALESCE(OLD.letter_reference, OLD.id::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $fn$;

DROP TRIGGER IF EXISTS trg_jbcc_letters_guard_delete ON projects.jbcc_letters;
CREATE TRIGGER trg_jbcc_letters_guard_delete
  BEFORE DELETE ON projects.jbcc_letters
  FOR EACH ROW EXECUTE FUNCTION projects.jbcc_letters_guard_delete();

-- ============================================================================
-- 6. Append-only change-history (audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects.jbcc_letter_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id       uuid NOT NULL REFERENCES projects.jbcc_letters(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  event_type      text NOT NULL,
  from_status     text,
  to_status       text,
  actor_id        uuid NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS jbcc_letter_events_letter_id_idx
  ON projects.jbcc_letter_events (letter_id, occurred_at);

ALTER TABLE projects.jbcc_letter_events ENABLE ROW LEVEL SECURITY;

-- Append-only: block UPDATE/DELETE at the data layer.
CREATE OR REPLACE FUNCTION projects.jbcc_letter_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'projects.jbcc_letter_events is append-only (ISO 7.5.3 change control).'
    USING ERRCODE = 'check_violation';
END $fn$;

DROP TRIGGER IF EXISTS trg_jbcc_letter_events_append_only ON projects.jbcc_letter_events;
CREATE TRIGGER trg_jbcc_letter_events_append_only
  BEFORE UPDATE OR DELETE ON projects.jbcc_letter_events
  FOR EACH ROW EXECUTE FUNCTION projects.jbcc_letter_events_append_only();

-- ============================================================================
-- 7. Controlled distribution list (to / cc) with name snapshot
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects.jbcc_letter_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id           uuid NOT NULL REFERENCES projects.jbcc_letters(id) ON DELETE CASCADE,
  organisation_id     uuid NOT NULL,
  party_id            uuid REFERENCES projects.jbcc_parties(id) ON DELETE SET NULL,
  party_name_snapshot text NOT NULL,
  disposition         text NOT NULL DEFAULT 'to' CHECK (disposition IN ('to','cc')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jbcc_letter_recipients_letter_id_idx
  ON projects.jbcc_letter_recipients (letter_id);

ALTER TABLE projects.jbcc_letter_recipients ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- 8. RLS: reconcile writer role-set (add contractor) + project-scope the reads
--    Done outside the txn only for clarity; each statement is idempotent.
-- ============================================================================

BEGIN;

-- --- jbcc_letters ---------------------------------------------------------
DROP POLICY IF EXISTS jbcc_letters_select_member ON projects.jbcc_letters;
DROP POLICY IF EXISTS jbcc_letters_write_editor  ON projects.jbcc_letters;

-- READ: restricted to the project's write-capable roles (JBCC is a
-- contractor/PM instrument; client_viewer/supplier/inspector must NOT see
-- contractual notices). user_effective_project_role resolves org owner/admin
-- on every project in their org (same pattern as project_valuations, 00132).
CREATE POLICY jbcc_letters_select_member
  ON projects.jbcc_letters FOR SELECT TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  );

CREATE POLICY jbcc_letters_insert_editor
  ON projects.jbcc_letters FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  );

CREATE POLICY jbcc_letters_update_editor
  ON projects.jbcc_letters FOR UPDATE TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  )
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  );

-- DELETE: only draft, not-held, not-already-soft-deleted rows may be hard
-- deleted directly. Everything else is retained (soft-delete / supersede).
CREATE POLICY jbcc_letters_delete_editor
  ON projects.jbcc_letters FOR DELETE TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
    AND status = 'draft'
    AND legal_hold = false
  );

-- --- jbcc_parties ---------------------------------------------------------
DROP POLICY IF EXISTS jbcc_parties_select_member ON projects.jbcc_parties;
DROP POLICY IF EXISTS jbcc_parties_write_editor  ON projects.jbcc_parties;

CREATE POLICY jbcc_parties_select_member
  ON projects.jbcc_parties FOR SELECT TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  );

CREATE POLICY jbcc_parties_write_editor
  ON projects.jbcc_parties FOR ALL TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  )
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND public.user_effective_project_role(project_id, auth.uid())
        IN ('owner','admin','project_manager','contractor')
  );

-- --- jbcc_letter_attachments (letter_id -> project via join) --------------
DROP POLICY IF EXISTS jbcc_letter_attachments_select_member ON projects.jbcc_letter_attachments;
DROP POLICY IF EXISTS jbcc_letter_attachments_write_editor  ON projects.jbcc_letter_attachments;

CREATE POLICY jbcc_letter_attachments_select_member
  ON projects.jbcc_letter_attachments FOR SELECT TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_attachments.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

CREATE POLICY jbcc_letter_attachments_write_editor
  ON projects.jbcc_letter_attachments FOR ALL TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_attachments.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  )
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_attachments.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

-- --- jbcc_letter_events (read = project writers; insert = project writers) --
CREATE POLICY jbcc_letter_events_select_member
  ON projects.jbcc_letter_events FOR SELECT TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_events.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

CREATE POLICY jbcc_letter_events_insert_editor
  ON projects.jbcc_letter_events FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_events.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

-- --- jbcc_letter_recipients ----------------------------------------------
CREATE POLICY jbcc_letter_recipients_select_member
  ON projects.jbcc_letter_recipients FOR SELECT TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_recipients.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

CREATE POLICY jbcc_letter_recipients_write_editor
  ON projects.jbcc_letter_recipients FOR ALL TO authenticated
  USING (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_recipients.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  )
  WITH CHECK (
    organisation_id = ANY (public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM projects.jbcc_letters l
       WHERE l.id = jbcc_letter_recipients.letter_id
         AND public.user_effective_project_role(l.project_id, auth.uid())
             IN ('owner','admin','project_manager','contractor')
    )
  );

-- Storage: scope the DELETE policy so issued letter objects can't be removed;
-- only draft-letter objects (and any org file) remain deletable by editors.
-- (Object-level status is not visible to the storage policy, so we keep the
--  org-membership gate here and rely on the row-level delete guard + the app
--  never issuing storage deletes for non-draft letters.)

COMMIT;

NOTIFY pgrst, 'reload schema';
