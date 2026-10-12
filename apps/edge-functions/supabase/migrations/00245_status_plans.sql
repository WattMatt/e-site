-- ---------------------------------------------------------------------------
-- Migration 00245: status plans (tenant layout masking + schematic DB hatching)
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-09-status-plans-design.md (section 4)
--
-- WHAT A STATUS PLAN IS. One page of a drawing in the register, marked with a
-- purpose: 'tenant_layout' (shop masks coloured by tenant progress) or
-- 'distribution_schematic' (DB blocks on a 300 drawing hatched by DB order
-- status). Its shapes store GEOMETRY + LINK + TYPE ONLY. Every colour, hatch
-- and area is derived at draw/render time from live data, so there is
-- deliberately no colour, status or area column anywhere in this file. A
-- stored colour is what made WM Office Web's masking plan go stale.
--
-- GEOMETRY. points are image-space pixels of the page rasterised at the fixed
-- getViewport({ scale: 2 }) used by apps/web/src/lib/sheet, flat
-- [x0, y0, x1, y1, ...]. They replay exactly on any device. What can change is
-- the FILE: cloud-sync adopts a newer revision by swapping file_path on the
-- same drawing row. So source_file_path is stamped from the drawing at
-- creation (the client's value is discarded) for the plan page to warn on,
-- and cloud-sync's isAnnotated() treats a drawing with a status plan as
-- annotated, so it is never silently swapped (the 00205 reasoning).
--
-- PARENTS ARE DERIVED OR CHECKED, NEVER TRUSTED. organisation_id and
-- source_file_path come from the drawing. project_id must equal the drawing's
-- and is refused rather than corrected, so a client bug surfaces. A plan's
-- drawing, page, purpose and project are fixed after creation. A shape's node
-- must be on the plan's project and not soft-deleted, and a tenant layout links
-- tenant_db nodes only. created_by is auth.uid(), never the client's value.
--
-- ROW SECURITY. Read: every project member, client_viewer included (a status
-- plan is a progress picture made to be shown). Write: ORG_WRITE_ROLES
-- (owner, admin, project_manager). Each write verb has a PERMISSIVE membership
-- policy and a RESTRICTIVE role gate. Never FOR ALL for the role gate: FOR ALL
-- includes SELECT, and 00205 shipped exactly that and narrowed reads to the
-- write set (00206). The only FOR ALL policy here is site_scope, whose
-- expression is the read predicate itself. site_scope and its resolver are
-- the generator's text byte for byte (packages/db/src/site-scope/generate.ts,
-- pinned by status-plans-site-scope.contract.test.ts).
--
-- Schema only. No backfill: nothing exists to backfill.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tenants.status_plans
-- table: tenants.status_plan_shapes
-- column: tenants.status_plans.purpose
-- column: tenants.status_plans.page_index
-- column: tenants.status_plans.source_file_path
-- column: tenants.status_plans.organisation_id
-- column: tenants.status_plan_shapes.points
-- column: tenants.status_plan_shapes.node_id
-- column: tenants.status_plan_shapes.area_type
-- column: tenants.status_plan_shapes.detected_tag
-- column: tenants.status_plan_shapes.source
-- constraint: status_plans_page_positive ON tenants.status_plans
-- constraint: status_plans_purpose_check ON tenants.status_plans
-- constraint: status_plans_name_not_blank ON tenants.status_plans
-- constraint: status_plans_drawing_page_purpose_key ON tenants.status_plans
-- constraint: status_plan_shapes_shape_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_area_type_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_source_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_link_or_area ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_points_shape ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_tag_length ON tenants.status_plan_shapes
-- index: status_plans_project_idx ON tenants.status_plans
-- index: status_plan_shapes_plan_idx ON tenants.status_plan_shapes
-- index: status_plan_shapes_plan_node_key ON tenants.status_plan_shapes
-- index: status_plan_shapes_node_idx ON tenants.status_plan_shapes
-- function: tenants.status_plans_bind_parents()
-- function: tenants.status_plan_shapes_check_link()
-- function: public.site_project_of_status_plan(uuid)
-- trigger: status_plans_bind_parents ON tenants.status_plans
-- trigger: status_plans_updated_at ON tenants.status_plans
-- trigger: status_plan_shapes_check_link ON tenants.status_plan_shapes
-- trigger: status_plan_shapes_updated_at ON tenants.status_plan_shapes
-- policy: status_plans_select ON tenants.status_plans PERMISSIVE
-- policy: status_plans_insert ON tenants.status_plans PERMISSIVE
-- policy: status_plans_update ON tenants.status_plans PERMISSIVE
-- policy: status_plans_delete ON tenants.status_plans PERMISSIVE
-- policy: status_plans_insert_authz ON tenants.status_plans RESTRICTIVE
-- policy: status_plans_update_authz ON tenants.status_plans RESTRICTIVE
-- policy: status_plans_delete_authz ON tenants.status_plans RESTRICTIVE
-- policy: site_scope ON tenants.status_plans RESTRICTIVE
-- policy: status_plan_shapes_select ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_insert ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_update ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_delete ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_insert_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: status_plan_shapes_update_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: status_plan_shapes_delete_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: site_scope ON tenants.status_plan_shapes RESTRICTIVE
-- grant_present: authenticated SELECT ON tenants.status_plans
-- grant_present: authenticated INSERT ON tenants.status_plans
-- grant_present: authenticated SELECT ON tenants.status_plan_shapes
-- grant_present: authenticated DELETE ON tenants.status_plan_shapes
-- grant_absent: anon SELECT ON tenants.status_plans
-- grant_absent: anon SELECT ON tenants.status_plan_shapes
-- grant_absent: anon EXECUTE ON public.site_project_of_status_plan(uuid)
-- grant_absent: anon EXECUTE ON tenants.status_plans_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.status_plan_shapes_check_link()
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass))
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plans'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plan_shapes'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass) AND polpermissive = false AND polcmd NOT IN ('a', 'w', 'd') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 6 FROM pg_policy WHERE polrelid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass) AND polpermissive = false AND polcmd IN ('a', 'w', 'd') AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) LIKE '%project_manager%' AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) NOT LIKE '%contractor%')
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name IN ('status_plans', 'status_plan_shapes') AND column_name IN ('colour', 'color', 'fill', 'status', 'area_m2', 'area_sqm'))
-- @verify:end

-- 1. Status plans ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id   UUID NOT NULL REFERENCES public.organisations(id),
    floor_plan_id     UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,
    page_index        INTEGER NOT NULL,
    purpose           TEXT NOT NULL,
    name              TEXT NOT NULL,
    source_file_path  TEXT NOT NULL,
    created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plans_page_positive CHECK (page_index >= 1),
    CONSTRAINT status_plans_purpose_check CHECK (purpose IN ('tenant_layout', 'distribution_schematic')),
    CONSTRAINT status_plans_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT status_plans_drawing_page_purpose_key UNIQUE (floor_plan_id, page_index, purpose)
);

CREATE INDEX IF NOT EXISTS status_plans_project_idx ON tenants.status_plans (project_id);

COMMENT ON TABLE tenants.status_plans IS
'One page of a drawing marked with a purpose (tenant_layout or distribution_schematic). Holds no colour, status or area: those are computed at draw and render time from live tenant-schedule and order data, so a plan cannot lag the schedule. organisation_id and source_file_path are bound from the drawing by trigger; drawing, page, purpose and project are fixed after creation.';

COMMENT ON COLUMN tenants.status_plans.source_file_path IS
'The drawing file the shapes were drawn against, stamped from tenants.floor_plans.file_path at creation. The plan page warns when the drawing''s current file differs. It may only be updated to the drawing''s current file (re-anchoring after a deliberate adopt).';

-- 2. Shapes -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plan_shapes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_plan_id  UUID NOT NULL REFERENCES tenants.status_plans(id) ON DELETE CASCADE,
    shape           TEXT NOT NULL,
    points          JSONB NOT NULL,
    node_id         UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    area_type       TEXT,
    detected_tag    TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',
    created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plan_shapes_shape_check CHECK (shape IN ('polygon', 'rect')),
    CONSTRAINT status_plan_shapes_area_type_check CHECK (area_type IS NULL OR area_type IN ('common', 'plant_room', 'services', 'vacant')),
    CONSTRAINT status_plan_shapes_source_check CHECK (source IN ('manual', 'detected')),
    CONSTRAINT status_plan_shapes_link_or_area CHECK (node_id IS NULL OR area_type IS NULL),
    CONSTRAINT status_plan_shapes_points_shape CHECK (CASE WHEN jsonb_typeof(points) = 'array' THEN (jsonb_array_length(points) BETWEEN 6 AND 4000 AND jsonb_array_length(points) % 2 = 0 AND (shape <> 'rect' OR jsonb_array_length(points) = 8) AND NOT jsonb_path_exists(points, '$[*] ? (@.type() != "number")')) ELSE false END),
    CONSTRAINT status_plan_shapes_tag_length CHECK (detected_tag IS NULL OR length(detected_tag) <= 64)
);

CREATE INDEX IF NOT EXISTS status_plan_shapes_plan_idx ON tenants.status_plan_shapes (status_plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS status_plan_shapes_plan_node_key ON tenants.status_plan_shapes (status_plan_id, node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS status_plan_shapes_node_idx ON tenants.status_plan_shapes (node_id) WHERE node_id IS NOT NULL;

COMMENT ON TABLE tenants.status_plan_shapes IS
'A polygon or rectangle on a status plan: geometry (image-space pixels at scale 2), an optional link to a structure.nodes row OR an area type, and nothing derived. A node appears at most once per plan. A hard-deleted node sets node_id NULL and the shape falls back to unlinked.';

-- 3. Parents are derived or checked, never trusted -----------------------------

CREATE OR REPLACE FUNCTION tenants.status_plans_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project UUID;
  v_org     UUID;
  v_file    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id
       OR NEW.page_index IS DISTINCT FROM OLD.page_index
       OR NEW.purpose    IS DISTINCT FROM OLD.purpose
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'status_plans: the drawing, page and purpose of a plan are fixed; create a new plan instead'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT fp.project_id, fp.organisation_id, fp.file_path
    INTO v_project, v_org, v_file
    FROM tenants.floor_plans fp
   WHERE fp.id = NEW.floor_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plans: drawing % not found', NEW.floor_plan_id USING ERRCODE = '23503';
  END IF;
  IF NEW.project_id IS DISTINCT FROM v_project THEN
    RAISE EXCEPTION 'status_plans: that drawing belongs to another project' USING ERRCODE = '23514';
  END IF;

  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.source_file_path := v_file;
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
    IF NEW.source_file_path IS DISTINCT FROM OLD.source_file_path
       AND NEW.source_file_path IS DISTINCT FROM v_file THEN
      RAISE EXCEPTION 'status_plans: a plan can only be re-anchored to its drawing''s current file'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plans_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plans_bind_parents ON tenants.status_plans;
CREATE TRIGGER status_plans_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plans_bind_parents();

DROP TRIGGER IF EXISTS status_plans_updated_at ON tenants.status_plans;
CREATE TRIGGER status_plans_updated_at
    BEFORE UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION tenants.status_plan_shapes_check_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project      UUID;
  v_purpose      TEXT;
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
  ELSE
    IF NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another plan' USING ERRCODE = '23514';
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

DROP TRIGGER IF EXISTS status_plan_shapes_updated_at ON tenants.status_plan_shapes;
CREATE TRIGGER status_plan_shapes_updated_at
    BEFORE UPDATE ON tenants.status_plan_shapes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Site-scope resolver (generator text, byte for byte) -----------------------

CREATE OR REPLACE FUNCTION public.site_project_of_status_plan(p_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$ SELECT project_id FROM tenants.status_plans WHERE id = p_id $f$;
REVOKE ALL ON FUNCTION public.site_project_of_status_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_project_of_status_plan(uuid) TO authenticated, service_role;

-- 5. Row security: status_plans ------------------------------------------------

ALTER TABLE tenants.status_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plans_select ON tenants.status_plans;
CREATE POLICY status_plans_select ON tenants.status_plans FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_insert ON tenants.status_plans;
CREATE POLICY status_plans_insert ON tenants.status_plans FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_update ON tenants.status_plans;
CREATE POLICY status_plans_update ON tenants.status_plans FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(project_id))
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_delete ON tenants.status_plans;
CREATE POLICY status_plans_delete ON tenants.status_plans FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_insert_authz ON tenants.status_plans;
CREATE POLICY status_plans_insert_authz ON tenants.status_plans
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plans_update_authz ON tenants.status_plans;
CREATE POLICY status_plans_update_authz ON tenants.status_plans
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plans_delete_authz ON tenants.status_plans;
CREATE POLICY status_plans_delete_authz ON tenants.status_plans
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plans;
CREATE POLICY site_scope ON tenants.status_plans AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));

-- 6. Row security: status_plan_shapes ------------------------------------------

ALTER TABLE tenants.status_plan_shapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plan_shapes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plan_shapes_select ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_select ON tenants.status_plan_shapes FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_insert ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_insert ON tenants.status_plan_shapes FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_update ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_update ON tenants.status_plan_shapes FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_delete ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_delete ON tenants.status_plan_shapes FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_insert_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_insert_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_shapes_update_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_update_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_shapes_delete_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_delete_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plan_shapes;
CREATE POLICY site_scope ON tenants.status_plan_shapes AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

-- 7. Grants ---------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.status_plans, tenants.status_plan_shapes TO authenticated;
GRANT ALL ON tenants.status_plans, tenants.status_plan_shapes TO service_role;
REVOKE ALL ON tenants.status_plans, tenants.status_plan_shapes FROM anon;

NOTIFY pgrst, 'reload schema';
