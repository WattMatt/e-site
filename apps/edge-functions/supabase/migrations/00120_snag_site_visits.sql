-- =============================================================================
-- Migration 00120 — snag site visits + carry-forward stamps (backlog #5)
-- =============================================================================
-- Additive, idempotent, paused-payment-aware. `field` is already PostgREST-
-- exposed (no schema create) -> a trailing NOTIFY suffices, no config PATCH.
--
-- Write policies mirror the current field.snags write policies verbatim:
--   INSERT: org membership (get_user_org_ids) + payment_paused block     (00009 + 00032)
--   UPDATE: org membership (get_user_org_ids) + payment_paused block     (00009 + 00032)
--   DELETE: none — field.snags has no DELETE policy; we mirror that.
-- =============================================================================

-- 1. field.snag_visits ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS field.snag_visits (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id      UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    visit_no        INT         NOT NULL DEFAULT 0, -- overridden by snag_visits_ensure_no() trigger for non-backlog rows; 0 only stands for backlog rows
    is_backlog      BOOLEAN     NOT NULL DEFAULT false,
    visit_date      DATE        NOT NULL,
    conducted_by    UUID        NOT NULL REFERENCES public.profiles(id),
    attendees       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    title           TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_attendees_array;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_attendees_array CHECK (jsonb_typeof(attendees) = 'array');
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_project_no_uniq;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_project_no_uniq UNIQUE (project_id, visit_no);
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_project_id_uniq;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_project_id_uniq UNIQUE (project_id, id);

CREATE INDEX IF NOT EXISTS snag_visits_project_idx ON field.snag_visits (project_id, visit_no);

DROP TRIGGER IF EXISTS snag_visits_updated_at ON field.snag_visits;
CREATE TRIGGER snag_visits_updated_at BEFORE UPDATE ON field.snag_visits
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION field.snag_visits_ensure_no() RETURNS TRIGGER
    SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.is_backlog THEN
    NEW.visit_no := 0;
  ELSIF NEW.visit_no IS NULL OR NEW.visit_no = 0 THEN
    SELECT COALESCE(MAX(visit_no), 0) + 1 INTO NEW.visit_no
      FROM field.snag_visits WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS snag_visits_ensure_no_trg ON field.snag_visits;
CREATE TRIGGER snag_visits_ensure_no_trg BEFORE INSERT ON field.snag_visits
    FOR EACH ROW EXECUTE FUNCTION field.snag_visits_ensure_no();

-- 2. snag stamps ---------------------------------------------------------------
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS raised_on_visit_id UUID;
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS closed_on_visit_id UUID;

ALTER TABLE field.snags DROP CONSTRAINT IF EXISTS snags_raised_on_visit_fk;
ALTER TABLE field.snags ADD  CONSTRAINT snags_raised_on_visit_fk
    FOREIGN KEY (project_id, raised_on_visit_id)
    REFERENCES field.snag_visits(project_id, id) ON DELETE NO ACTION;
ALTER TABLE field.snags DROP CONSTRAINT IF EXISTS snags_closed_on_visit_fk;
ALTER TABLE field.snags ADD  CONSTRAINT snags_closed_on_visit_fk
    FOREIGN KEY (project_id, closed_on_visit_id)
    REFERENCES field.snag_visits(project_id, id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS snags_raised_on_visit_idx ON field.snags (raised_on_visit_id);
CREATE INDEX IF NOT EXISTS snags_closed_on_visit_idx ON field.snags (closed_on_visit_id);

-- 3. photo visit tag -----------------------------------------------------------
ALTER TABLE field.snag_photos ADD COLUMN IF NOT EXISTS visit_id UUID;
ALTER TABLE field.snag_photos DROP CONSTRAINT IF EXISTS snag_photos_visit_fk;
ALTER TABLE field.snag_photos ADD  CONSTRAINT snag_photos_visit_fk
    FOREIGN KEY (visit_id) REFERENCES field.snag_visits(id) ON DELETE SET NULL;

-- 4. backfill legacy snags into a per-project "Initial backlog" visit -----------
DO $$
DECLARE r RECORD; v_id UUID; v_raiser UUID;
BEGIN
  FOR r IN
    SELECT s.project_id, p.organisation_id, MIN(s.created_at)::date AS first_date
      FROM field.snags s
      JOIN projects.projects p ON p.id = s.project_id
      WHERE s.raised_on_visit_id IS NULL
      GROUP BY s.project_id, p.organisation_id
  LOOP
    SELECT raised_by INTO v_raiser FROM field.snags
      WHERE project_id = r.project_id AND raised_on_visit_id IS NULL
      ORDER BY created_at ASC LIMIT 1;
    INSERT INTO field.snag_visits (organisation_id, project_id, visit_no, is_backlog, visit_date, conducted_by, title)
      VALUES (r.organisation_id, r.project_id, 0, true, r.first_date, v_raiser, 'Initial backlog')
      RETURNING id INTO v_id;
    UPDATE field.snags SET raised_on_visit_id = v_id
      WHERE project_id = r.project_id AND raised_on_visit_id IS NULL;
  END LOOP;
END $$;

-- 5. RLS — mirror field.snags write policies (from 00009 + 00032) --------------
--    SELECT: project-scoped access via user_has_project_access(project_id) — consistent
--            with all other project-scoped tables (structure.*, inspections.*, etc.).
--            Intentionally broader/cleaner than the legacy field.snags SELECT which
--            gates on org membership via get_user_org_ids(); snag_visits is a
--            project-level resource, so the project-scoped helper is the right gate.
--    INSERT: org membership + payment_paused block (mirroring 00032 "Contractors and above can create snags")
--    UPDATE: org membership + payment_paused block (mirroring 00032 "Org members can update snags")
--    DELETE: none — field.snags has no DELETE policy; snag_visits mirrors that.
ALTER TABLE field.snag_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snag_visits_select ON field.snag_visits;
CREATE POLICY snag_visits_select ON field.snag_visits
    FOR SELECT TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS snag_visits_insert ON field.snag_visits;
CREATE POLICY snag_visits_insert ON field.snag_visits
    FOR INSERT TO authenticated
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

DROP POLICY IF EXISTS snag_visits_update ON field.snag_visits;
CREATE POLICY snag_visits_update ON field.snag_visits
    FOR UPDATE TO authenticated
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    )
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

NOTIFY pgrst, 'reload schema';
