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

COMMIT;
