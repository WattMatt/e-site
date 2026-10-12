-- ---------------------------------------------------------------------------
-- Migration 00248: tenant plans (status plans move under Tenants, own files)
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-12-tenant-plans-relocation-design.md (§3, §4)
--
-- WHAT CHANGES. A status plan was one page of a drawing in the shared register
-- (00245). It is now one tool per project per purpose: the tenant FLOOR PLAN
-- (purpose tenant_layout) and the LINE DIAGRAM (distribution_schematic), each
-- with its own uploaded files. So:
--   * status_plans loses floor_plan_id, page_index and source_file_path, binds
--     organisation_id from the PROJECT, and is unique per (project, purpose).
--   * status_plan_sheets is new: one row per sheet. A sheet is one page of one
--     file in the private tenant-plan-files bucket, at
--     {org}/{project}/{plan}/{folder}/{revision}.{pdf|png|jpg}. A PDF of N pages
--     is N sheets that share one file. The scale is per sheet.
--   * status_plan_shapes gains sheet_id NOT NULL. status_plan_id stays, so the
--     unique (status_plan_id, node_id) key still spans every sheet: a shop is
--     masked once across all floors.
-- Production holds 0 rows in both tables (checked 2026-10-12); the first
-- statement refuses to run if that is no longer true, because columns change in
-- place and there is no data step.
--
-- REPLACE AND RE-ANCHOR (owner decision A). Replacing a sheet's file is an
-- UPDATE of file_path. The trigger, not the client, then sets revision + 1,
-- replaced_at = now() and replaced_from_path = the old path. The masks and the
-- scale are kept; the page shows a banner until someone re-anchors, which is
-- an UPDATE setting replaced_at to NULL. replaced_at can be cleared, never
-- forged; page_index, mime and file_name change only together with the file.
--
-- PARENTS ARE DERIVED OR CHECKED, NEVER TRUSTED. organisation_id comes from the
-- project (plans) or the plan (sheets). A sheet's file must live under its own
-- plan's folder (org/project/plan prefix), so a sheet can never point the
-- service-side renderers at another project's object. A shape's sheet must
-- belong to the shape's plan and is fixed after creation. created_by is
-- auth.uid() on insert and may only become NULL afterwards (the FK SET NULL).
--
-- ROW SECURITY. Same shape as 00245: read for every project member (client
-- viewers included), write for owner / admin / project_manager through a
-- PERMISSIVE membership policy plus a RESTRICTIVE per-verb role gate. Never
-- FOR ALL for a role gate (00205 -> 00206). site_scope is the generator's text
-- byte for byte (tenant-plans-site-scope.contract.test.ts).
--
-- STORAGE. tenant-plan-files is private, 60 MB per file, PDF / PNG / JPEG.
-- tenants.tenant_plan_file_project(name) returns the project only when the
-- path's org / project / plan segments name a real plan of that project and
-- org, so a forged prefix reads as no project at all. Read: any member who can
-- read the plan. Insert and delete: owner / admin / PM of that project. No
-- UPDATE policy: a replacement is a new object at revision + 1. Plus the
-- generated site_scope_objects policy, re-created with the bucket added.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tenants.status_plan_sheets
-- column: tenants.status_plan_sheets.status_plan_id
-- column: tenants.status_plan_sheets.organisation_id
-- column: tenants.status_plan_sheets.sort_order
-- column: tenants.status_plan_sheets.label
-- column: tenants.status_plan_sheets.file_path
-- column: tenants.status_plan_sheets.page_index
-- column: tenants.status_plan_sheets.file_name
-- column: tenants.status_plan_sheets.mime
-- column: tenants.status_plan_sheets.revision
-- column: tenants.status_plan_sheets.replaced_at
-- column: tenants.status_plan_sheets.replaced_from_path
-- column: tenants.status_plan_sheets.pixels_per_meter
-- column: tenants.status_plan_sheets.calibration_points
-- column: tenants.status_plan_sheets.calibration_metres
-- column: tenants.status_plan_shapes.sheet_id
-- constraint: status_plans_project_purpose_key ON tenants.status_plans
-- constraint: status_plan_sheets_plan_order_key ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_sort_order_check ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_page_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_revision_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_mime_check ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_label_not_blank ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_file_name_not_blank ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_scale_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_calibration_shape ON tenants.status_plan_sheets
-- index: status_plan_shapes_sheet_idx ON tenants.status_plan_shapes
-- function: tenants.status_plans_bind_parents()
-- function: tenants.status_plan_sheets_bind_parents()
-- function: tenants.status_plan_shapes_check_link()
-- function: tenants.tenant_plan_file_project(text)
-- trigger: status_plans_bind_parents ON tenants.status_plans
-- trigger: status_plan_sheets_bind_parents ON tenants.status_plan_sheets
-- trigger: status_plan_sheets_updated_at ON tenants.status_plan_sheets
-- trigger: status_plan_shapes_check_link ON tenants.status_plan_shapes
-- policy: status_plan_sheets_select ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_insert ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_update ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_delete ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_insert_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: status_plan_sheets_update_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: status_plan_sheets_delete_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: site_scope ON tenants.status_plan_sheets RESTRICTIVE
-- policy: tenant_plan_files_read ON storage.objects PERMISSIVE
-- policy: tenant_plan_files_insert ON storage.objects PERMISSIVE
-- policy: tenant_plan_files_delete ON storage.objects PERMISSIVE
-- policy: site_scope_objects ON storage.objects RESTRICTIVE
-- grant_present: authenticated SELECT ON tenants.status_plan_sheets
-- grant_present: authenticated INSERT ON tenants.status_plan_sheets
-- grant_present: authenticated DELETE ON tenants.status_plan_sheets
-- grant_absent: anon SELECT ON tenants.status_plan_sheets
-- grant_absent: anon EXECUTE ON tenants.status_plan_sheets_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.tenant_plan_file_project(text)
-- grant_absent: anon EXECUTE ON tenants.status_plans_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.status_plan_shapes_check_link()
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plans' AND column_name IN ('floor_plan_id', 'page_index', 'source_file_path'))
-- sql: (SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plan_shapes' AND column_name = 'sheet_id')
-- sql: (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'tenants.status_plan_sheets'::regclass)
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plan_sheets'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 3 FROM pg_policy WHERE polrelid = 'tenants.status_plan_sheets'::regclass AND polpermissive = false AND polcmd IN ('a', 'w', 'd') AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) LIKE '%project_manager%' AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) NOT LIKE '%contractor%')
-- sql: (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'tenant-plan-files' AND public = false AND file_size_limit = 62914560)
-- sql: (SELECT count(*) = 3 AND bool_and(cmd IN ('SELECT', 'INSERT', 'DELETE')) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'tenant\_plan\_files\_%')
-- sql: (SELECT strpos(coalesce(qual, ''), 'tenant-plan-files') > 0 AND strpos(coalesce(with_check, ''), 'tenant-plan-files') > 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'site_scope_objects')
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plan_sheets' AND column_name IN ('colour', 'color', 'fill', 'status', 'area_m2', 'area_sqm'))
-- @verify:end

-- 0. Refuse to run over data ---------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants.status_plans) OR EXISTS (SELECT 1 FROM tenants.status_plan_shapes) THEN
    RAISE EXCEPTION 'tenant plans: tenants.status_plans already holds rows; this migration changes columns in place and has no data step'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- 1. Status plans: one per project per purpose, no drawing ----------------------

ALTER TABLE tenants.status_plans DROP CONSTRAINT IF EXISTS status_plans_drawing_page_purpose_key;
ALTER TABLE tenants.status_plans DROP CONSTRAINT IF EXISTS status_plans_page_positive;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS floor_plan_id;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS page_index;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS source_file_path;
ALTER TABLE tenants.status_plans ADD CONSTRAINT status_plans_project_purpose_key UNIQUE (project_id, purpose);

COMMENT ON TABLE tenants.status_plans IS
'A tenant plan: the tenant floor plan (purpose tenant_layout) or the line diagram (distribution_schematic) of a project, at most one of each. Its files are its sheets (tenants.status_plan_sheets). Holds no colour, status or area: those are computed at draw and render time from live tenant-schedule and order data. organisation_id is bound from the project by trigger; project and purpose are fixed.';

CREATE OR REPLACE FUNCTION tenants.status_plans_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'status_plans: the project and purpose of a plan are fixed' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'status_plans: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plans_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plans_bind_parents ON tenants.status_plans;
CREATE TRIGGER status_plans_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plans_bind_parents();

-- 2. Sheets ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plan_sheets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_plan_id      UUID NOT NULL REFERENCES tenants.status_plans(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    sort_order          INTEGER NOT NULL,
    label               TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    page_index          INTEGER NOT NULL DEFAULT 1,
    file_name           TEXT NOT NULL,
    mime                TEXT NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1,
    replaced_at         TIMESTAMPTZ,
    replaced_from_path  TEXT,
    pixels_per_meter    NUMERIC,
    calibration_points  JSONB,
    calibration_metres  NUMERIC,
    created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plan_sheets_plan_order_key UNIQUE (status_plan_id, sort_order),
    CONSTRAINT status_plan_sheets_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT status_plan_sheets_page_positive CHECK (page_index >= 1),
    CONSTRAINT status_plan_sheets_revision_positive CHECK (revision >= 1),
    CONSTRAINT status_plan_sheets_mime_check CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
    CONSTRAINT status_plan_sheets_label_not_blank CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    CONSTRAINT status_plan_sheets_file_name_not_blank CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
    CONSTRAINT status_plan_sheets_scale_positive CHECK (pixels_per_meter IS NULL OR pixels_per_meter > 0),
    CONSTRAINT status_plan_sheets_calibration_shape CHECK (CASE
      WHEN pixels_per_meter IS NULL THEN calibration_points IS NULL AND calibration_metres IS NULL
      WHEN calibration_metres IS NULL OR calibration_metres <= 0 THEN false
      WHEN calibration_points IS NULL OR jsonb_typeof(calibration_points) <> 'array' THEN false
      ELSE jsonb_array_length(calibration_points) = 4 AND NOT jsonb_path_exists(calibration_points, '$[*] ? (@.type() != "number")')
    END)
);

COMMENT ON TABLE tenants.status_plan_sheets IS
'One sheet of a tenant plan: one page (page_index) of one file in the tenant-plan-files bucket. A PDF of N pages is N sheets sharing a file. Replacing the file is an UPDATE of file_path; the trigger then sets revision + 1, replaced_at and replaced_from_path, and the shapes and scale are kept until someone re-anchors (replaced_at back to NULL). The scale (pixels_per_meter, from two calibration points and a distance) is per sheet.';

CREATE OR REPLACE FUNCTION tenants.status_plan_sheets_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project UUID;
  v_org     UUID;
  v_prefix  TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
    RAISE EXCEPTION 'status_plan_sheets: a sheet cannot move to another plan' USING ERRCODE = '23514';
  END IF;

  SELECT sp.project_id, sp.organisation_id INTO v_project, v_org
    FROM tenants.status_plans sp
   WHERE sp.id = NEW.status_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plan_sheets: status plan % not found', NEW.status_plan_id USING ERRCODE = '23503';
  END IF;
  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.revision := 1;
    NEW.replaced_at := NULL;
    NEW.replaced_from_path := NULL;
  ELSE
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      NEW.revision := OLD.revision + 1;
      NEW.replaced_at := now();
      NEW.replaced_from_path := OLD.file_path;
    ELSE
      NEW.revision := OLD.revision;
      NEW.replaced_from_path := OLD.replaced_from_path;
      NEW.page_index := OLD.page_index;
      NEW.mime := OLD.mime;
      NEW.file_name := OLD.file_name;
      NEW.replaced_at := CASE WHEN NEW.replaced_at IS NULL THEN NULL ELSE OLD.replaced_at END;
    END IF;
  END IF;

  v_prefix := v_org::text || '/' || v_project::text || '/' || NEW.status_plan_id::text || '/';
  IF NEW.file_path !~ ('^' || v_prefix || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,5}\.(pdf|png|jpg)$') THEN
    RAISE EXCEPTION 'status_plan_sheets: the file must be stored under this plan' USING ERRCODE = '23514';
  END IF;
  IF NOT ((NEW.mime = 'application/pdf' AND NEW.file_path ~ '\.pdf$')
       OR (NEW.mime = 'image/png' AND NEW.file_path ~ '\.png$')
       OR (NEW.mime = 'image/jpeg' AND NEW.file_path ~ '\.jpg$')) THEN
    RAISE EXCEPTION 'status_plan_sheets: the file type does not match its name' USING ERRCODE = '23514';
  END IF;
  IF NEW.mime <> 'application/pdf' AND NEW.page_index <> 1 THEN
    RAISE EXCEPTION 'status_plan_sheets: an image has one page' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plan_sheets_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plan_sheets_bind_parents ON tenants.status_plan_sheets;
CREATE TRIGGER status_plan_sheets_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plan_sheets
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plan_sheets_bind_parents();

DROP TRIGGER IF EXISTS status_plan_sheets_updated_at ON tenants.status_plan_sheets;
CREATE TRIGGER status_plan_sheets_updated_at
    BEFORE UPDATE ON tenants.status_plan_sheets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Shapes live on a sheet -------------------------------------------------------

ALTER TABLE tenants.status_plan_shapes
    ADD COLUMN IF NOT EXISTS sheet_id UUID NOT NULL REFERENCES tenants.status_plan_sheets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS status_plan_shapes_sheet_idx ON tenants.status_plan_shapes (sheet_id);

COMMENT ON COLUMN tenants.status_plan_shapes.sheet_id IS
'The sheet the shape is drawn on (image space of that sheet). Must belong to the shape''s plan and is fixed after creation. status_plan_id stays so a board appears at most once per plan across every sheet.';

CREATE OR REPLACE FUNCTION tenants.status_plan_shapes_check_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project      UUID;
  v_purpose      TEXT;
  v_sheet_plan   UUID;
  v_node_project UUID;
  v_node_kind    TEXT;
  v_node_deleted TIMESTAMPTZ;
  v_node_changed BOOLEAN;
  v_area_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    v_node_changed := NEW.node_id IS NOT NULL;
    v_area_changed := NEW.area_type IS NOT NULL;
    SELECT s.status_plan_id INTO v_sheet_plan FROM tenants.status_plan_sheets s WHERE s.id = NEW.sheet_id;
    IF v_sheet_plan IS NULL THEN
      RAISE EXCEPTION 'status_plan_shapes: sheet % not found', NEW.sheet_id USING ERRCODE = '23503';
    END IF;
    IF v_sheet_plan IS DISTINCT FROM NEW.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: that sheet belongs to another plan' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another plan' USING ERRCODE = '23514';
    END IF;
    IF NEW.sheet_id IS DISTINCT FROM OLD.sheet_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another sheet' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
    v_node_changed := NEW.node_id IS NOT NULL AND NEW.node_id IS DISTINCT FROM OLD.node_id;
    v_area_changed := NEW.area_type IS NOT NULL AND NEW.area_type IS DISTINCT FROM OLD.area_type;
  END IF;

  -- Geometry-only edits, unlinking, and the ON DELETE SET NULL fired by a
  -- hard-deleted node all leave here, so a plan can never block deleting a board.
  IF NOT v_node_changed AND NOT v_area_changed THEN
    RETURN NEW;
  END IF;

  SELECT sp.project_id, sp.purpose INTO v_project, v_purpose
    FROM tenants.status_plans sp
   WHERE sp.id = NEW.status_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plan_shapes: status plan % not found', NEW.status_plan_id USING ERRCODE = '23503';
  END IF;

  IF v_area_changed AND v_purpose <> 'tenant_layout' THEN
    RAISE EXCEPTION 'status_plan_shapes: area types belong on tenant layout plans only' USING ERRCODE = '23514';
  END IF;

  IF v_node_changed THEN
    SELECT n.project_id, n.kind, n.deleted_at
      INTO v_node_project, v_node_kind, v_node_deleted
      FROM structure.nodes n
     WHERE n.id = NEW.node_id;
    IF v_node_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'status_plan_shapes: that board is not on this project' USING ERRCODE = '23514';
    END IF;
    IF v_node_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'status_plan_shapes: that board has been deleted' USING ERRCODE = '23514';
    END IF;
    IF v_purpose = 'tenant_layout' AND v_node_kind <> 'tenant_db' THEN
      RAISE EXCEPTION 'status_plan_shapes: a tenant layout links tenant boards only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plan_shapes_check_link() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plan_shapes_check_link ON tenants.status_plan_shapes;
CREATE TRIGGER status_plan_shapes_check_link
    BEFORE INSERT OR UPDATE ON tenants.status_plan_shapes
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plan_shapes_check_link();

-- 4. Row security: status_plan_sheets ----------------------------------------------

ALTER TABLE tenants.status_plan_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plan_sheets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plan_sheets_select ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_select ON tenants.status_plan_sheets FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_insert ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_insert ON tenants.status_plan_sheets FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_update ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_update ON tenants.status_plan_sheets FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_delete ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_delete ON tenants.status_plan_sheets FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_insert_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_insert_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_sheets_update_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_update_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_sheets_delete_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_delete_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plan_sheets;
CREATE POLICY site_scope ON tenants.status_plan_sheets AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.status_plan_sheets TO authenticated;
GRANT ALL ON tenants.status_plan_sheets TO service_role;
REVOKE ALL ON tenants.status_plan_sheets FROM anon;

-- 5. Files: the tenant-plan-files bucket ---------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-plan-files', 'tenant-plan-files', false, 62914560, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION tenants.tenant_plan_file_project(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' AS $$
DECLARE
  v_project UUID;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,5}\.(pdf|png|jpg)$' THEN
    RETURN NULL;
  END IF;
  SELECT sp.project_id INTO v_project
    FROM tenants.status_plans sp
   WHERE sp.id = split_part(p_name, '/', 3)::uuid
     AND sp.project_id = split_part(p_name, '/', 2)::uuid
     AND sp.organisation_id = split_part(p_name, '/', 1)::uuid;
  RETURN v_project;
END $$;

REVOKE ALL ON FUNCTION tenants.tenant_plan_file_project(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tenants.tenant_plan_file_project(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS tenant_plan_files_read ON storage.objects;
CREATE POLICY tenant_plan_files_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_has_project_access(tenants.tenant_plan_file_project(name)), false));

DROP POLICY IF EXISTS tenant_plan_files_insert ON storage.objects;
CREATE POLICY tenant_plan_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_effective_project_role(tenants.tenant_plan_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS tenant_plan_files_delete ON storage.objects;
CREATE POLICY tenant_plan_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_effective_project_role(tenants.tenant_plan_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));

-- 6. Storage site scope (generator text, byte for byte; adds tenant-plan-files) --------

DROP POLICY IF EXISTS site_scope_objects ON storage.objects;
CREATE POLICY site_scope_objects ON storage.objects AS RESTRICTIVE FOR ALL
  USING (CASE WHEN bucket_id IN ('drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos', 'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence', 'tenant-plan-files') THEN public.storage_site_access(bucket_id, name) ELSE true END)
  WITH CHECK (CASE WHEN bucket_id IN ('drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos', 'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence', 'tenant-plan-files') THEN public.storage_site_access(bucket_id, name) ELSE true END);

NOTIFY pgrst, 'reload schema';
