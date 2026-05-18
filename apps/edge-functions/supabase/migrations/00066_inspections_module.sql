-- 00066_inspections_module.sql
-- Replaces compliance.* with project-scoped, template-driven inspections.
-- See: SPEC DOCS/2026-05-18-inspections-module-design.md

BEGIN;

-- ============================================================================
-- 1. Schema
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS inspections;
GRANT USAGE ON SCHEMA inspections TO authenticated, service_role;

-- ============================================================================
-- 2. Templates
-- ============================================================================

CREATE TABLE inspections.templates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  template_id              TEXT NOT NULL,
  version                  TEXT NOT NULL,
  name                     TEXT NOT NULL,
  applies_to_node_types    TEXT[] NOT NULL CHECK (array_length(applies_to_node_types, 1) > 0),
  node_subtypes            TEXT[] NULL,
  sans_reference           TEXT NULL,
  deliverable_type         TEXT NOT NULL CHECK (deliverable_type IN ('coc','inspection_only','factory_test')),
  schema_json              JSONB NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_by               UUID NULL REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, template_id, version)
);

CREATE INDEX idx_templates_org_active ON inspections.templates (organisation_id, is_active);
CREATE INDEX idx_templates_deliverable ON inspections.templates (deliverable_type);

-- ============================================================================
-- 3. Inspections (assignment instances)
-- ============================================================================

CREATE TABLE inspections.inspections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          UUID NOT NULL REFERENCES public.organisations(id),
  project_id               UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  template_id              UUID NOT NULL REFERENCES inspections.templates(id),

  target_node_type         TEXT NOT NULL CHECK (target_node_type IN ('board','source','adhoc')),
  target_node_id           UUID NULL,
  target_label             TEXT NOT NULL,
  target_location          TEXT NULL,

  assigned_to_id           UUID NULL REFERENCES auth.users(id),
  verifier_id              UUID NULL REFERENCES auth.users(id),

  status                   TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
    'assigned','in_progress','awaiting_verification','certified','re-inspect_required','abandoned'
  )),
  overall_result           TEXT NULL CHECK (overall_result IN ('pass','fail','conditional_pass')),

  scheduled_at             TIMESTAMPTZ NULL,
  started_at               TIMESTAMPTZ NULL,
  completed_at             TIMESTAMPTZ NULL,
  certified_at             TIMESTAMPTZ NULL,
  abandoned_at             TIMESTAMPTZ NULL,
  abandon_reason           TEXT NULL,

  coc_number               TEXT NULL,
  parent_inspection_id     UUID NULL REFERENCES inspections.inspections(id),
  reinspection_notes       TEXT NULL,

  created_by               UUID NOT NULL REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (organisation_id, coc_number)
);

CREATE INDEX idx_inspections_project_status ON inspections.inspections (project_id, status);
CREATE INDEX idx_inspections_assigned ON inspections.inspections (assigned_to_id, status);
CREATE INDEX idx_inspections_verifier ON inspections.inspections (verifier_id, status);
CREATE INDEX idx_inspections_target ON inspections.inspections (target_node_type, target_node_id);
CREATE INDEX idx_inspections_org_status ON inspections.inspections (organisation_id, status);

-- ============================================================================
-- 4. Responses (current state, upserted on autosave)
-- ============================================================================

CREATE TABLE inspections.responses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id            UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  section_id               TEXT NOT NULL,
  field_id                 TEXT NOT NULL,

  value_bool               BOOLEAN NULL,
  value_number             NUMERIC NULL,
  value_text               TEXT NULL,
  value_array              TEXT[] NULL,
  value_json               JSONB NULL,

  pass_state               TEXT NULL CHECK (pass_state IN ('pass','fail','na','not_checked')),
  fail_reason              TEXT NULL,

  latest_responded_by      UUID NOT NULL REFERENCES auth.users(id),
  latest_responded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (inspection_id, section_id, field_id)
);

CREATE INDEX idx_responses_inspection ON inspections.responses (inspection_id);

-- ============================================================================
-- 5. Response history (append-only audit)
-- ============================================================================

CREATE TABLE inspections.response_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id            UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  section_id               TEXT NOT NULL,
  field_id                 TEXT NOT NULL,

  value_bool               BOOLEAN NULL,
  value_number             NUMERIC NULL,
  value_text               TEXT NULL,
  value_array              TEXT[] NULL,
  value_json               JSONB NULL,

  pass_state               TEXT NULL,
  fail_reason              TEXT NULL,

  responded_by             UUID NOT NULL REFERENCES auth.users(id),
  responded_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_response_history_inspection ON inspections.response_history (inspection_id, responded_at);
CREATE INDEX idx_response_history_contributor ON inspections.response_history (responded_by);

-- ============================================================================
-- 6. Photos
-- ============================================================================

CREATE TABLE inspections.photos (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id            UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  section_id               TEXT NOT NULL,
  field_id                 TEXT NOT NULL,
  storage_path             TEXT NOT NULL,
  caption                  TEXT NULL,
  gps_lat                  NUMERIC(9,6) NULL,
  gps_lng                  NUMERIC(9,6) NULL,
  taken_at                 TIMESTAMPTZ NULL,
  width_px                 INT NULL,
  height_px                INT NULL,
  uploaded_by              UUID NOT NULL REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photos_inspection ON inspections.photos (inspection_id);

-- ============================================================================
-- 7. Signatures
-- ============================================================================

CREATE TABLE inspections.signatures (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id            UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  role                     TEXT NOT NULL CHECK (role IN ('inspector','verifier','client','witness')),
  signatory_name           TEXT NOT NULL,
  signatory_title          TEXT NULL,
  registration_number      TEXT NULL,
  storage_path             TEXT NOT NULL,
  signed_by                UUID NOT NULL REFERENCES auth.users(id),
  signed_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signatures_inspection ON inspections.signatures (inspection_id);

-- ============================================================================
-- 8. Certificates (generated PDFs)
-- ============================================================================

CREATE TABLE inspections.certificates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id            UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  coc_number               TEXT NOT NULL,
  storage_path             TEXT NOT NULL,
  generated_by             UUID NOT NULL REFERENCES auth.users(id),
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at            TIMESTAMPTZ NULL,
  share_token              TEXT NULL UNIQUE,
  share_expires_at         TIMESTAMPTZ NULL,
  revoked_at               TIMESTAMPTZ NULL,
  revoked_by               UUID NULL REFERENCES auth.users(id),
  revoke_reason            TEXT NULL
);

CREATE INDEX idx_certificates_inspection ON inspections.certificates (inspection_id);
CREATE INDEX idx_certificates_share_token ON inspections.certificates (share_token) WHERE share_token IS NOT NULL;

-- ============================================================================
-- 9. COC number sequences (INS / FAT only — COC type is manually entered)
-- ============================================================================

CREATE TABLE inspections.coc_number_seqs (
  project_id               UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  year                     INT NOT NULL,
  prefix                   TEXT NOT NULL CHECK (prefix IN ('INS','FAT')),
  last_seq                 INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, year, prefix)
);

-- ============================================================================
-- 10. RLS helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION inspections.user_can_verify(_project_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
    JOIN public.user_organisations uo
      ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
    WHERE pm.project_id = _project_id
      AND pm.user_id = auth.uid()
      AND uo.role IN ('owner','admin','project_manager')
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.is_inspection_verifier(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections
    WHERE id = _inspection_id AND verifier_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.user_can_write_responses(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN public.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND uo.role <> 'client_viewer'
      AND i.status IN ('assigned','in_progress','re-inspect_required')
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.user_has_inspection_read(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN public.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND (
        uo.role <> 'client_viewer'
        OR (uo.role = 'client_viewer' AND i.status = 'certified')
      )
  );
$fn$;

-- ============================================================================
-- 11. COC number allocator (INS / FAT only — COC is manually entered)
-- ============================================================================

CREATE OR REPLACE FUNCTION inspections.allocate_coc_number(_inspection_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  pcode  TEXT;
  pid    UUID;
  ptype  TEXT;
  yr     INT := EXTRACT(YEAR FROM now());
  seq    INT;
  prefix TEXT;
BEGIN
  SELECT i.project_id, p.code, t.deliverable_type
    INTO pid, pcode, ptype
    FROM inspections.inspections i
    JOIN projects.projects p ON p.id = i.project_id
    JOIN inspections.templates t ON t.id = i.template_id
    WHERE i.id = _inspection_id;

  IF pid IS NULL THEN
    RAISE EXCEPTION 'Inspection % not found', _inspection_id;
  END IF;

  IF ptype = 'coc' THEN
    RAISE EXCEPTION 'COC numbers must be entered manually for deliverable_type = coc';
  END IF;

  prefix := CASE ptype
    WHEN 'inspection_only' THEN 'INS'
    WHEN 'factory_test' THEN 'FAT'
  END;

  INSERT INTO inspections.coc_number_seqs (project_id, year, prefix, last_seq)
    VALUES (pid, yr, prefix, 1)
    ON CONFLICT (project_id, year, prefix)
      DO UPDATE SET last_seq = inspections.coc_number_seqs.last_seq + 1
    RETURNING last_seq INTO seq;

  RETURN format('%s-%s-%s-%s', prefix, pcode, yr, lpad(seq::text, 4, '0'));
END $fn$;

GRANT EXECUTE ON FUNCTION inspections.user_can_verify(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION inspections.is_inspection_verifier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION inspections.user_can_write_responses(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION inspections.user_has_inspection_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION inspections.allocate_coc_number(UUID) TO service_role;

-- ============================================================================
-- 12. Triggers
-- ============================================================================

-- 12.1 Validate polymorphic target_node_id
CREATE OR REPLACE FUNCTION inspections.validate_target_node() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.target_node_type = 'board' THEN
    IF NEW.target_node_id IS NULL THEN
      RAISE EXCEPTION 'target_node_id must be set for target_node_type = board';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cable_schedule.boards WHERE id = NEW.target_node_id) THEN
      RAISE EXCEPTION 'target_node_id % does not exist in cable_schedule.boards', NEW.target_node_id;
    END IF;
  ELSIF NEW.target_node_type = 'source' THEN
    IF NEW.target_node_id IS NULL THEN
      RAISE EXCEPTION 'target_node_id must be set for target_node_type = source';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cable_schedule.sources WHERE id = NEW.target_node_id) THEN
      RAISE EXCEPTION 'target_node_id % does not exist in cable_schedule.sources', NEW.target_node_id;
    END IF;
  ELSIF NEW.target_node_type = 'adhoc' THEN
    IF NEW.target_node_id IS NOT NULL THEN
      RAISE EXCEPTION 'target_node_id must be NULL for target_node_type = adhoc';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_validate_target_node
  BEFORE INSERT OR UPDATE OF target_node_type, target_node_id ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION inspections.validate_target_node();

-- 12.2 Block DELETE on cable-schedule nodes referenced by active inspections
CREATE OR REPLACE FUNCTION inspections.guard_node_delete() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inspections.inspections
    WHERE target_node_type = TG_ARGV[0]
      AND target_node_id = OLD.id
      AND status NOT IN ('certified','abandoned')
  ) THEN
    RAISE EXCEPTION 'Cannot delete %: active inspection(s) reference this node. Abandon or complete first.', TG_ARGV[0];
  END IF;
  RETURN OLD;
END $fn$;

CREATE TRIGGER trg_guard_inspection_refs
  BEFORE DELETE ON cable_schedule.boards
  FOR EACH ROW EXECUTE FUNCTION inspections.guard_node_delete('board');

CREATE TRIGGER trg_guard_inspection_refs
  BEFORE DELETE ON cable_schedule.sources
  FOR EACH ROW EXECUTE FUNCTION inspections.guard_node_delete('source');

-- 12.3 Template schema_json immutability
CREATE OR REPLACE FUNCTION inspections.enforce_template_immutability() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.schema_json IS DISTINCT FROM OLD.schema_json THEN
    RAISE EXCEPTION 'schema_json is immutable; create a new template row with a bumped version instead';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_template_immutability
  BEFORE UPDATE ON inspections.templates
  FOR EACH ROW EXECUTE FUNCTION inspections.enforce_template_immutability();

-- 12.4 Auto-append to response_history on responses INSERT or UPDATE
CREATE OR REPLACE FUNCTION inspections.append_response_history() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO inspections.response_history (
    inspection_id, section_id, field_id,
    value_bool, value_number, value_text, value_array, value_json,
    pass_state, fail_reason, responded_by, responded_at
  ) VALUES (
    NEW.inspection_id, NEW.section_id, NEW.field_id,
    NEW.value_bool, NEW.value_number, NEW.value_text, NEW.value_array, NEW.value_json,
    NEW.pass_state, NEW.fail_reason, NEW.latest_responded_by, NEW.latest_responded_at
  );
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_append_response_history
  AFTER INSERT OR UPDATE ON inspections.responses
  FOR EACH ROW EXECUTE FUNCTION inspections.append_response_history();

-- 12.5 Auto-maintain updated_at
CREATE OR REPLACE FUNCTION inspections.set_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION inspections.set_updated_at();

CREATE TRIGGER trg_templates_updated_at
  BEFORE UPDATE ON inspections.templates
  FOR EACH ROW EXECUTE FUNCTION inspections.set_updated_at();

-- 12.6 Auto-set started_at on first response
CREATE OR REPLACE FUNCTION inspections.advance_status_on_first_response() RETURNS TRIGGER
  LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE inspections.inspections
    SET status = 'in_progress', started_at = COALESCE(started_at, now())
    WHERE id = NEW.inspection_id
      AND status IN ('assigned','re-inspect_required');
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_advance_on_first_response
  AFTER INSERT ON inspections.responses
  FOR EACH ROW EXECUTE FUNCTION inspections.advance_status_on_first_response();

-- ============================================================================
-- 13. Row-Level Security
-- ============================================================================

ALTER TABLE inspections.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.response_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections.coc_number_seqs ENABLE ROW LEVEL SECURITY;

-- ----- templates -----

CREATE POLICY templates_select ON inspections.templates FOR SELECT TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY templates_block_client_viewer ON inspections.templates AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY templates_insert ON inspections.templates FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = inspections.templates.organisation_id
        AND role IN ('owner','admin')
    )
  );

CREATE POLICY templates_update ON inspections.templates FOR UPDATE TO authenticated
  USING (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = inspections.templates.organisation_id
        AND role IN ('owner','admin')
    )
  );

-- ----- inspections -----

CREATE POLICY inspections_select_members ON inspections.inspections FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

CREATE POLICY inspections_select_client_viewer ON inspections.inspections FOR SELECT TO authenticated
  USING (
    public.user_is_client_viewer(organisation_id)
    AND public.user_has_project_access(project_id)
    AND status = 'certified'
  );

CREATE POLICY inspections_insert ON inspections.inspections FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = inspections.inspections.organisation_id
        AND role IN ('owner','admin','project_manager')
    )
  );

CREATE POLICY inspections_update_contributors ON inspections.inspections FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

-- ----- responses -----

CREATE POLICY responses_select ON inspections.responses FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

CREATE POLICY responses_insert_contributor ON inspections.responses FOR INSERT TO authenticated
  WITH CHECK (inspections.user_can_write_responses(inspection_id));

CREATE POLICY responses_update_contributor ON inspections.responses FOR UPDATE TO authenticated
  USING (inspections.user_can_write_responses(inspection_id))
  WITH CHECK (inspections.user_can_write_responses(inspection_id));

CREATE POLICY responses_update_verifier ON inspections.responses FOR UPDATE TO authenticated
  USING (
    inspections.is_inspection_verifier(inspection_id)
    AND EXISTS (SELECT 1 FROM inspections.inspections WHERE id = inspection_id AND status = 'awaiting_verification')
  );

-- ----- response_history -----

CREATE POLICY response_history_select ON inspections.response_history FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

-- ----- photos -----

CREATE POLICY photos_select ON inspections.photos FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

CREATE POLICY photos_insert ON inspections.photos FOR INSERT TO authenticated
  WITH CHECK (inspections.user_can_write_responses(inspection_id));

CREATE POLICY photos_delete ON inspections.photos FOR DELETE TO authenticated
  USING (
    inspections.user_can_write_responses(inspection_id)
    AND (
      uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM inspections.inspections i
        JOIN public.user_organisations uo ON uo.organisation_id = i.organisation_id AND uo.user_id = auth.uid()
        WHERE i.id = inspection_id AND uo.role IN ('owner','admin','project_manager')
      )
    )
  );

-- ----- signatures -----

CREATE POLICY signatures_select ON inspections.signatures FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

CREATE POLICY signatures_insert ON inspections.signatures FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections.inspections i
      JOIN public.user_organisations uo ON uo.organisation_id = i.organisation_id AND uo.user_id = auth.uid()
      WHERE i.id = inspection_id
        AND uo.role <> 'client_viewer'
        AND i.status NOT IN ('certified','abandoned')
    )
  );

CREATE POLICY signatures_delete_own ON inspections.signatures FOR DELETE TO authenticated
  USING (
    signed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM inspections.inspections
      WHERE id = inspection_id AND status NOT IN ('certified','abandoned')
    )
  );

-- ----- certificates -----

CREATE POLICY certificates_select ON inspections.certificates FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

COMMIT;
