-- 00179_site_forms.sql
-- Site Forms module: per-board termination & making-safe records.
--
-- Schema placement: the `field` schema is already exposed to PostgREST and
-- already carries ALTER DEFAULT PRIVILEGES for TABLES and SEQUENCES (verified
-- against prod 2026-08-12), so tables created here inherit
--   anon          -> SELECT
--   authenticated -> SELECT, INSERT, UPDATE, DELETE
--   service_role  -> ALL
-- automatically. It has NO default ACL for FUNCTIONS, so the helpers below are
-- granted explicitly. Because no schema is created, no PostgREST config PATCH
-- is required and the trailing NOTIFY suffices (cf. 00120, and contrast 00069
-- where missing grants on a new schema returned PGRST002 across the ENTIRE
-- REST API until they were added).
--
-- Helper functions called here and verified present in prod on 2026-08-12:
--   public.set_updated_at()                  -> trigger  (used by every field table)
--   public.get_user_org_ids()                -> uuid[]
--   public.user_is_client_viewer(uuid)       -> boolean
--   public.user_has_project_access(uuid)     -> boolean
--   public.user_effective_project_role(uuid, uuid DEFAULT auth.uid()) -> text

BEGIN;

-- ─── 1. Templates ────────────────────────────────────────────────────────────
CREATE TABLE field.form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES public.organisations(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  schema_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE field.form_templates IS
  'Versioned site-form definitions. schema_json is immutable; corrections ship as a new version row.';
COMMENT ON COLUMN field.form_templates.organisation_id IS
  'NULL = system template, available to every organisation.';

-- Partial unique indexes: a plain UNIQUE would not bite for system templates,
-- because NULL organisation_id never equals itself.
CREATE UNIQUE INDEX form_templates_org_key_version_idx
  ON field.form_templates (organisation_id, template_key, version)
  WHERE organisation_id IS NOT NULL;
CREATE UNIQUE INDEX form_templates_system_key_version_idx
  ON field.form_templates (template_key, version)
  WHERE organisation_id IS NULL;

CREATE OR REPLACE FUNCTION field.enforce_form_template_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.schema_json IS DISTINCT FROM OLD.schema_json THEN
    RAISE EXCEPTION 'schema_json is immutable; insert a new row with a bumped version instead';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_form_template_immutability
  BEFORE UPDATE ON field.form_templates
  FOR EACH ROW EXECUTE FUNCTION field.enforce_form_template_immutability();

-- ─── 2. Form instances ───────────────────────────────────────────────────────
CREATE TABLE field.site_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  template_row_id UUID NOT NULL REFERENCES field.form_templates(id),
  form_no TEXT,
  -- ON DELETE SET NULL, never CASCADE: deleting a board must not delete the
  -- record of having made it safe. board_ref/board_label preserve identity.
  node_id UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
  board_ref TEXT,
  board_label TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'distributed', 'void')),
  as_left_status TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  submitted_by UUID REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  distributed_by UUID REFERENCES public.profiles(id),
  distributed_at TIMESTAMPTZ,
  report_id UUID REFERENCES projects.reports(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A form must identify its board one way or the other.
  CONSTRAINT site_forms_board_identified CHECK (
    node_id IS NOT NULL OR NULLIF(TRIM(board_ref), '') IS NOT NULL
  ),
  CONSTRAINT site_forms_submitted_consistent CHECK (
    submitted_by IS NULL OR submitted_at IS NOT NULL
  ),
  CONSTRAINT site_forms_distributed_consistent CHECK (
    distributed_by IS NULL OR distributed_at IS NOT NULL
  ),
  CONSTRAINT site_forms_void_reason_required CHECK (
    status <> 'void' OR NULLIF(TRIM(void_reason), '') IS NOT NULL
  )
);

COMMENT ON COLUMN field.site_forms.board_label IS
  'The as-found name on the board nameplate, which routinely differs from structure.nodes.name on a revamp. Both are kept deliberately.';
COMMENT ON COLUMN field.site_forms.as_left_status IS
  'Denormalised copy of the handover answer, written at submit so the list page can filter without loading every form''s responses. The response row remains the source of truth.';

CREATE INDEX site_forms_project_status_idx ON field.site_forms (project_id, status);
CREATE INDEX site_forms_node_idx ON field.site_forms (node_id) WHERE node_id IS NOT NULL;

-- ─── 3. Form numbering ───────────────────────────────────────────────────────
CREATE TABLE field.form_number_seqs (
  project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  year INT NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, prefix, year)
);

CREATE OR REPLACE FUNCTION field.allocate_form_no(p_form_id UUID, p_prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'field', 'projects', 'public' AS $fn$
DECLARE
  v_project UUID;
  v_code    TEXT;
  v_year    INT;
  v_next    INT;
BEGIN
  SELECT sf.project_id INTO v_project FROM field.site_forms sf WHERE sf.id = p_form_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Unknown form %', p_form_id;
  END IF;

  SELECT p.code INTO v_code FROM projects.projects p WHERE p.id = v_project;
  v_year := EXTRACT(YEAR FROM now())::INT;

  INSERT INTO field.form_number_seqs (project_id, prefix, year, last_no)
  VALUES (v_project, p_prefix, v_year, 1)
  ON CONFLICT (project_id, prefix, year)
  DO UPDATE SET last_no = field.form_number_seqs.last_no + 1
  RETURNING last_no INTO v_next;

  RETURN p_prefix || '-' || COALESCE(v_code, 'PROJ') || '-' || v_year::TEXT
         || '-' || LPAD(v_next::TEXT, 4, '0');
END $fn$;

-- ─── 4. Responses + append-only history ──────────────────────────────────────
CREATE TABLE field.form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value_bool BOOLEAN,
  value_number NUMERIC,
  value_text TEXT,
  value_array TEXT[],
  value_json JSONB,
  pass_state TEXT CHECK (pass_state IN ('pass', 'fail', 'na', 'not_checked')),
  fail_reason TEXT,
  latest_responded_by UUID REFERENCES public.profiles(id),
  latest_responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, section_id, field_id)
);
CREATE INDEX form_responses_form_idx ON field.form_responses (form_id);

CREATE TABLE field.form_response_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value_bool BOOLEAN,
  value_number NUMERIC,
  value_text TEXT,
  value_array TEXT[],
  value_json JSONB,
  pass_state TEXT,
  fail_reason TEXT,
  responded_by UUID REFERENCES public.profiles(id),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE field.form_response_history IS
  'Append-only audit trail. For a safety record this is the difference between a document and a checkbox in an incident enquiry.';

CREATE INDEX form_response_history_form_idx
  ON field.form_response_history (form_id, responded_at);

CREATE OR REPLACE FUNCTION field.append_form_response_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'field', 'public' AS $fn$
BEGIN
  INSERT INTO field.form_response_history (
    form_id, section_id, field_id, value_bool, value_number, value_text,
    value_array, value_json, pass_state, fail_reason, responded_by, responded_at
  ) VALUES (
    NEW.form_id, NEW.section_id, NEW.field_id, NEW.value_bool, NEW.value_number,
    NEW.value_text, NEW.value_array, NEW.value_json, NEW.pass_state,
    NEW.fail_reason, NEW.latest_responded_by, NEW.latest_responded_at
  );
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_append_form_response_history
  AFTER INSERT OR UPDATE ON field.form_responses
  FOR EACH ROW EXECUTE FUNCTION field.append_form_response_history();

-- ─── 5. Photos + signatures ──────────────────────────────────────────────────
CREATE TABLE field.form_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  gps_lat NUMERIC,
  gps_lng NUMERIC,
  taken_at TIMESTAMPTZ,
  width_px INT,
  height_px INT,
  file_size_bytes INT,
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX form_photos_form_field_idx
  ON field.form_photos (form_id, section_id, field_id);

CREATE TABLE field.form_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL
    CHECK (block_id IN ('electrician', 'registered_person', 'supervisor', 'client_witness')),
  signatory_name TEXT NOT NULL,
  signatory_role TEXT,
  registration_category TEXT,
  registration_number TEXT,
  storage_path TEXT NOT NULL,
  signed_by UUID REFERENCES public.profiles(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, block_id)
);

-- ─── 6. Access helpers (SECURITY DEFINER keeps the policies one-liners) ──────
CREATE OR REPLACE FUNCTION field.user_has_form_read(p_form_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'field', 'public' SET row_security TO 'off' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM field.site_forms f
    WHERE f.id = p_form_id
      AND public.user_has_project_access(f.project_id)
      AND (NOT public.user_is_client_viewer(f.organisation_id) OR f.status = 'distributed')
  )
$fn$;

CREATE OR REPLACE FUNCTION field.user_can_write_form(p_form_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'field', 'public' SET row_security TO 'off' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM field.site_forms f
    WHERE f.id = p_form_id
      AND f.status = 'draft'                        -- the write window
      AND public.user_has_project_access(f.project_id)
      AND NOT public.user_is_client_viewer(f.organisation_id)
  )
$fn$;

CREATE OR REPLACE FUNCTION field.user_can_manage_form(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off' AS $fn$
  SELECT public.user_effective_project_role(p_project_id)
         IN ('owner', 'admin', 'project_manager')
$fn$;

-- The `field` schema has no default ACL for FUNCTIONS (verified against prod),
-- so EXECUTE must be granted explicitly here.
GRANT EXECUTE ON FUNCTION field.user_has_form_read(UUID)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.user_can_write_form(UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.user_can_manage_form(UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.allocate_form_no(UUID, TEXT) TO service_role;

-- ─── 7. State-transition guard ───────────────────────────────────────────────
-- RLS can gate WHO may update a row, but not WHICH transition they may make.
-- Without this, any project member could PATCH status='distributed' straight
-- over PostgREST and bypass the server-action role gate entirely -- the same
-- class of hole 00177 had to close for project_members self-promotion.
-- Deliberately SECURITY INVOKER (the default). Under SECURITY DEFINER,
-- `current_user` is the function OWNER, so the trusted-role exemption below
-- would be true for every caller and this trigger would silently enforce
-- nothing at all. It needs no elevated rights: it only reads OLD/NEW and calls
-- user_can_manage_form(), which is itself SECURITY DEFINER and granted to
-- authenticated.
CREATE OR REPLACE FUNCTION field.enforce_site_form_transition()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path TO 'field', 'public' AS $fn$
BEGIN
  -- Trusted callers (migrations, service-role server actions) are unrestricted;
  -- the action layer is what gates them.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    -- Editing in place is only ever allowed while the form is a draft.
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Form % is % and can no longer be edited', OLD.id, OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- draft -> submitted: any project member who may write the form.
  IF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  -- Everything else is a management action.
  IF NEW.status = 'void' AND OLD.status <> 'void'
     AND field.user_can_manage_form(NEW.project_id) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'distributed'
     AND field.user_can_manage_form(NEW.project_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal site-form transition % -> % (or insufficient role)',
    OLD.status, NEW.status USING ERRCODE = '42501';
END $fn$;

CREATE TRIGGER trg_site_forms_transition
  BEFORE UPDATE ON field.site_forms
  FOR EACH ROW EXECUTE FUNCTION field.enforce_site_form_transition();

-- ─── 8. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE field.form_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.site_forms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_responses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_response_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_signatures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_number_seqs      ENABLE ROW LEVEL SECURITY;

-- Templates: system templates are visible to everyone; org templates to that org.
-- No write policy for `authenticated` -- template authoring is service-role only.
CREATE POLICY form_templates_select ON field.form_templates
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = ANY (public.get_user_org_ids()));

CREATE POLICY site_forms_select ON field.site_forms
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND (NOT public.user_is_client_viewer(organisation_id) OR status = 'distributed')
  );

CREATE POLICY site_forms_insert ON field.site_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND status = 'draft'
  );

-- WITH CHECK is present from day one; 00067 had to retrofit it for inspections
-- to stop callers moving a row into another org/project mid-update.
-- The WITH CHECK independently refuses to let a non-manager leave a row in
-- `distributed` or `void`, so the management gate does not rest on the
-- transition trigger alone. Belt and braces, deliberately: the first version of
-- that trigger was inert (SECURITY DEFINER made its role check always true) and
-- this predicate is what would have caught it.
CREATE POLICY site_forms_update ON field.site_forms
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  )
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND (status <> 'distributed' OR field.user_can_manage_form(project_id))
    AND (status <> 'void' OR field.user_can_manage_form(project_id))
  );

CREATE POLICY site_forms_delete ON field.site_forms
  FOR DELETE TO authenticated
  USING (status = 'draft' AND field.user_can_manage_form(project_id));

-- Child tables derive access from the parent form (the node_circuits pattern).
CREATE POLICY form_responses_select ON field.form_responses
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_responses_insert ON field.form_responses
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_responses_update ON field.form_responses
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_responses_delete ON field.form_responses
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

-- History is written only by the SECURITY DEFINER trigger; no write policy.
CREATE POLICY form_response_history_select ON field.form_response_history
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));

CREATE POLICY form_photos_select ON field.form_photos
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_photos_insert ON field.form_photos
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_photos_update ON field.form_photos
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_photos_delete ON field.form_photos
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

CREATE POLICY form_signatures_select ON field.form_signatures
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_signatures_insert ON field.form_signatures
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_signatures_update ON field.form_signatures
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_signatures_delete ON field.form_signatures
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

-- field.form_number_seqs deliberately has RLS enabled and no policy: it is
-- reachable only through allocate_form_no(), which is SECURITY DEFINER.

-- ─── 9. Storage buckets + policies (read AND write, per the 00073 lesson) ────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('site-form-photos', 'site-form-photos', false, 10485760,
   ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('site-form-signatures', 'site-form-signatures', false, 524288,
   ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

-- Path convention {project_id}/{form_id}/{...}, so foldername()[2] is the form
-- id. Every policy below keys on that -- changing the layout silently denies.
CREATE POLICY site_form_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-form-photos'
         AND field.user_has_form_read(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-form-photos'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-form-photos'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));

CREATE POLICY site_form_sigs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-form-signatures'
         AND field.user_has_form_read(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_sigs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-form-signatures'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_sigs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-form-signatures'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));

-- ─── 10. Notification type ───────────────────────────────────────────────────
-- The constraint is re-declared wholesale each time (00066 -> 00072 -> 00173
-- -> 00176 -> 00178 -> here), so every existing value must be re-listed, not
-- appended. Note 'general' is deliberately absent, as it has always been.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    -- pre-existing types (from 00066)
    'snag_status_changed',
    'rfi_assigned',
    'rfi_closed',
    'rfi_response',
    'grn_recorded',
    -- inspection lifecycle types (from 00066)
    'inspection_assigned',
    'inspection_awaiting_verification',
    'inspection_certified',
    'inspection_re_inspect_required',
    'inspection_revoked',
    -- abandon event (from 00072)
    'inspection_abandoned',
    -- QC reports + previously-missing "created" bells (from 00173)
    'qc_issued',
    'rfi_created',
    'snag_created',
    'diary_created',
    -- QC per-photo/entry comment bell (from 00176)
    'qc_comment',
    -- snag site visit completed (from 00178)
    'snag_visit_completed',
    -- new (00179): site form distributed to the project team
    'site_form_distributed'
  )
);

-- ─── 11. Per-project email toggle ────────────────────────────────────────────
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS notify_form_email BOOLEAN NOT NULL DEFAULT true;

-- ─── 12. updated_at triggers ─────────────────────────────────────────────────
CREATE TRIGGER site_forms_updated_at BEFORE UPDATE ON field.site_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER form_templates_updated_at BEFORE UPDATE ON field.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

NOTIFY pgrst, 'reload schema';
