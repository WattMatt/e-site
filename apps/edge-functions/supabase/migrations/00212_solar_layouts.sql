-- ---------------------------------------------------------------------------
-- Migration 00212: Solar layouts on drawings (Solar Phase 5)
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (00210 tariffs and
-- 00211 meter data are claimed by sibling Solar branches). If 00212 is taken,
-- renumber this file and the header of scripts/db/assert-solar-layouts-roles.sql.
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- DEPENDS ON 00208 (schema solar, solar.studies, public.solar_can_view/_edit).
-- While 00208/00209 are not in the ledger, dry runs concatenate 00208 + 00209
-- + 00212.
--
-- Spec: docs/solar/01-functional-spec.md §6 (Layout tab) and §3.2 C (roof
-- sources); 02-calculation-engine-spec.md §3.1-§3.3; 03-data-model-and-
-- security.md §3 (roof_sources, layouts, layout_objects), §3.1 (RLS pattern),
-- §3.2 (solar-roof-images bucket).
--
-- WHAT.
--   1. solar.roof_sources: the sheet a layout is drawn on. A drawing page is
--      anchored like tenants.floor_plan_markups (00205): file_path and
--      source_revision_id are STAMPED from the drawing at creation and pinned,
--      so the page can warn "The drawing has changed since this layout was
--      drawn". A satellite capture carries its own metres-per-pixel and its
--      attribution. North lives here (it belongs to the sheet).
--   2. solar.layouts: named design options per study, bound to one roof source
--      for life (changing it would misalign every object). `summary` is a
--      cache the save ACTION computes so the list and readiness never load
--      geometry. It is display-only: an Edit user calling the RPC over
--      PostgREST can write any summary for their own project, which moves only
--      that project's readiness dot, so it gates nothing. Readers of geometry
--      (loader, export) drop rows that fail the save-time shape check.
--   3. solar.layout_objects: geometry in IMAGE PIXELS, with the scale stamped by
--      the database at first save and pinned forever after (a recalibration
--      never moves a saved design's metres). floor_plan_id and page_index are
--      denormalised from the roof source so cloud-sync's isAnnotated() can see
--      them with one lookup.
--   4. public.solar_save_layout_objects(): one atomic, stale-refusing save
--      (upserts + deletes + summary). SECURITY INVOKER: RLS decides.
--   5. solar-roof-images: private bucket, read-gated on solar_can_view by the
--      path's project segment; writes only through the service role.
--   6. public.user_can_read_report_kind(): 'solar_layout_sheet' reads follow the
--      Solar level (solar_can_view), not an E-Site role. Mirrored in
--      apps/web/src/lib/reports/report-kind-access.ts SOLAR_READ_REPORT_KINDS.
--
-- DRAWING DELETES. floor_plan_id FKs are NO ACTION (not CASCADE): a stray hard
-- delete of a drawing must not silently destroy a PV design. NO ACTION is
-- checked at the END of the statement, so deleting the whole project (which
-- cascades to both the drawing and the study) still works.
--
-- 00208's schema-wide @verify directives (re-run on every deploy) are honoured:
-- FORCE RLS on each new table; no RESTRICTIVE policy covering SELECT or ALL
-- anywhere in solar; each SECURITY DEFINER function in solar revokes EXECUTE
-- from PUBLIC and anon; solar.studies still has exactly one SELECT policy.
--
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.roof_sources
-- table: solar.layouts
-- table: solar.layout_objects
-- column: solar.layout_objects.floor_plan_id
-- column: solar.layout_objects.pixels_per_meter
-- column: solar.roof_sources.file_path
-- column: solar.layouts.summary
-- constraint: roof_sources_shape ON solar.roof_sources
-- constraint: layouts_name_not_blank ON solar.layouts
-- constraint: layout_objects_kind_check ON solar.layout_objects
-- index: roof_sources_drawing_page_key ON solar.roof_sources
-- index: layouts_study_name_key ON solar.layouts
-- index: layout_objects_layout_idx ON solar.layout_objects
-- index: layout_objects_floor_plan_idx ON solar.layout_objects
-- function: solar.roof_sources_bind()
-- function: solar.layouts_bind()
-- function: solar.layout_objects_bind()
-- function: public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)
-- function: public.user_can_read_report_kind(uuid, text)
-- trigger: roof_sources_bind ON solar.roof_sources
-- trigger: layouts_bind ON solar.layouts
-- trigger: layout_objects_bind ON solar.layout_objects
-- policy: roof_sources_select ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_insert ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_update ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_delete ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_insert_authz ON solar.roof_sources RESTRICTIVE
-- policy: roof_sources_update_authz ON solar.roof_sources RESTRICTIVE
-- policy: roof_sources_delete_authz ON solar.roof_sources RESTRICTIVE
-- policy: layouts_select ON solar.layouts PERMISSIVE
-- policy: layouts_insert ON solar.layouts PERMISSIVE
-- policy: layouts_update ON solar.layouts PERMISSIVE
-- policy: layouts_delete ON solar.layouts PERMISSIVE
-- policy: layouts_insert_authz ON solar.layouts RESTRICTIVE
-- policy: layouts_update_authz ON solar.layouts RESTRICTIVE
-- policy: layouts_delete_authz ON solar.layouts RESTRICTIVE
-- policy: layout_objects_select ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_insert ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_update ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_delete ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_insert_authz ON solar.layout_objects RESTRICTIVE
-- policy: layout_objects_update_authz ON solar.layout_objects RESTRICTIVE
-- policy: layout_objects_delete_authz ON solar.layout_objects RESTRICTIVE
-- grant_absent: anon SELECT ON solar.roof_sources
-- grant_absent: anon SELECT ON solar.layouts
-- grant_absent: anon SELECT ON solar.layout_objects
-- grant_absent: anon EXECUTE ON public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)
-- grant_absent: anon EXECUTE ON solar.roof_sources_bind()
-- grant_absent: anon EXECUTE ON solar.layouts_bind()
-- grant_absent: anon EXECUTE ON solar.layout_objects_bind()
-- grant_absent: anon EXECUTE ON public.user_can_read_report_kind(uuid, text)
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid IN ('solar.roof_sources'::regclass, 'solar.layouts'::regclass, 'solar.layout_objects'::regclass))
-- sql: (SELECT count(*) = 3 FROM pg_policy WHERE polrelid IN ('solar.roof_sources'::regclass, 'solar.layouts'::regclass, 'solar.layout_objects'::regclass) AND polcmd IN ('r', '*'))
-- sql: (SELECT confdeltype = 'a' FROM pg_constraint WHERE conrelid = 'solar.roof_sources'::regclass AND contype = 'f' AND confrelid = 'tenants.floor_plans'::regclass)
-- sql: (SELECT prosrc LIKE '%solar_layout_sheet%' AND prosrc LIKE '%solar_can_view%' FROM pg_proc WHERE oid = 'public.user_can_read_report_kind(uuid, text)'::regprocedure)
-- sql: EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-roof-images' AND public = false)
-- behaviour: scripts/db/assert-solar-layouts-roles.sql, every row ok
-- @verify:end

-- ── 0. Storage: satellite roof captures (private) ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('solar-roof-images', 'solar-roof-images', false, 20971520, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Path: <organisation_id>/<project_id>/<file>. Reads need a Solar level on the
-- project in segment 2; a non-uuid segment reads nothing (never a cast error).
-- The regex guards the cast inside a CASE: Postgres does not promise to
-- evaluate AND operands left to right, so `regex AND f(x::uuid)` could cast
-- first and raise on another bucket's non-uuid path.
-- No INSERT/UPDATE/DELETE policy: only the service role writes (the capture route).
DROP POLICY IF EXISTS solar_roof_images_select ON storage.objects;
CREATE POLICY solar_roof_images_select ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'solar-roof-images'
        AND CASE
            WHEN (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.solar_can_view(((storage.foldername(name))[2])::uuid)
            ELSE false
        END
    );

-- ── 1. Roof sources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.roof_sources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    kind                TEXT NOT NULL CHECK (kind IN ('drawing', 'satellite')),
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),     -- NO ACTION, see header
    page_index          INTEGER NOT NULL DEFAULT 1 CHECK (page_index >= 1),
    /* The file this sheet was when the roof source was made. Stamped from the
       drawing by the bind trigger and pinned; compared on open (00205 pattern). */
    file_path           TEXT,
    source_revision_id  TEXT,
    storage_path        TEXT,
    m_per_px            NUMERIC CHECK (m_per_px > 0),
    north_bearing_deg   NUMERIC CHECK (north_bearing_deg >= 0 AND north_bearing_deg < 360),
    north_points        JSONB CHECK (north_points IS NULL OR (jsonb_typeof(north_points) = 'array' AND jsonb_array_length(north_points) = 4)),
    attribution         TEXT,
    capture_meta        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capture_meta) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roof_sources_shape CHECK (
        (kind = 'drawing' AND floor_plan_id IS NOT NULL AND file_path IS NOT NULL AND storage_path IS NULL AND m_per_px IS NULL)
        OR (kind = 'satellite' AND floor_plan_id IS NULL AND storage_path IS NOT NULL AND m_per_px IS NOT NULL
            AND attribution IS NOT NULL AND length(btrim(attribution)) > 0)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS roof_sources_drawing_page_key
    ON solar.roof_sources (study_id, floor_plan_id, page_index) WHERE kind = 'drawing';
CREATE INDEX IF NOT EXISTS roof_sources_floor_plan_idx ON solar.roof_sources (floor_plan_id);

CREATE OR REPLACE FUNCTION solar.roof_sources_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_fp_project UUID;
    v_fp_path    TEXT;
    v_fp_rev     TEXT;
    v_fp_active  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.kind IS DISTINCT FROM OLD.kind
           OR NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id OR NEW.page_index IS DISTINCT FROM OLD.page_index
           OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.m_per_px IS DISTINCT FROM OLD.m_per_px THEN
            RAISE EXCEPTION 'solar.roof_sources: the sheet of a roof source cannot change; add a new roof source instead'
                USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.file_path := OLD.file_path;
        NEW.source_revision_id := OLD.source_revision_id;
        NEW.attribution := OLD.attribution;
        NEW.capture_meta := OLD.capture_meta;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.roof_sources: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        IF NEW.kind = 'drawing' THEN
            SELECT fp.project_id, fp.file_path, fp.source_revision_id, fp.is_active
              INTO v_fp_project, v_fp_path, v_fp_rev, v_fp_active
              FROM tenants.floor_plans fp WHERE fp.id = NEW.floor_plan_id;
            IF v_fp_project IS NULL OR v_fp_project <> NEW.project_id THEN
                RAISE EXCEPTION 'solar.roof_sources: the drawing belongs to another project' USING ERRCODE = '23514';
            END IF;
            IF NOT v_fp_active THEN
                RAISE EXCEPTION 'solar.roof_sources: the drawing is no longer active' USING ERRCODE = '23514';
            END IF;
            NEW.file_path := v_fp_path;
            NEW.source_revision_id := v_fp_rev;
        ELSE
            NEW.file_path := NULL;
            NEW.source_revision_id := NULL;
            IF split_part(COALESCE(NEW.storage_path, ''), '/', 1) <> NEW.organisation_id::text
               OR split_part(COALESCE(NEW.storage_path, ''), '/', 2) <> NEW.project_id::text THEN
                RAISE EXCEPTION 'solar.roof_sources: the satellite image is stored under another project' USING ERRCODE = '23514';
            END IF;
            NEW.north_bearing_deg := COALESCE(NEW.north_bearing_deg, 0);
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.roof_sources_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.roof_sources_bind() FROM anon;
CREATE TRIGGER roof_sources_bind BEFORE INSERT OR UPDATE ON solar.roof_sources
    FOR EACH ROW EXECUTE FUNCTION solar.roof_sources_bind();

ALTER TABLE solar.roof_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.roof_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY roof_sources_select ON solar.roof_sources FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY roof_sources_insert ON solar.roof_sources FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY roof_sources_update ON solar.roof_sources FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY roof_sources_delete ON solar.roof_sources FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY roof_sources_insert_authz ON solar.roof_sources AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY roof_sources_update_authz ON solar.roof_sources AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY roof_sources_delete_authz ON solar.roof_sources AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 2. Layouts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.layouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    roof_source_id      UUID NOT NULL REFERENCES solar.roof_sources(id),   -- NO ACTION: a used roof source cannot be removed
    name                TEXT NOT NULL,
    /* Equipment catalogue arrives with the Financials phase; the FK is added then.
       module_spec is the snapshot the design was made with and never follows the catalogue. */
    module_id           UUID,
    module_spec         JSONB NOT NULL CHECK (jsonb_typeof(module_spec) = 'object'),
    default_tilt_deg    NUMERIC(4,1) NOT NULL DEFAULT 10 CHECK (default_tilt_deg >= 0 AND default_tilt_deg <= 60),
    design_t_min_c      NUMERIC(4,1) NOT NULL DEFAULT -5 CHECK (design_t_min_c BETWEEN -40 AND 30),
    design_t_amb_max_c  NUMERIC(4,1) NOT NULL DEFAULT 35 CHECK (design_t_amb_max_c BETWEEN 10 AND 60),
    summary             JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT layouts_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS layouts_study_name_key ON solar.layouts (study_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS layouts_roof_source_idx ON solar.layouts (roof_source_id);

CREATE OR REPLACE FUNCTION solar.layouts_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_rs_study UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.roof_source_id IS DISTINCT FROM OLD.roof_source_id THEN
            RAISE EXCEPTION 'solar.layouts: a layout stays on the sheet it was drawn on' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.layouts: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        SELECT rs.study_id INTO v_rs_study FROM solar.roof_sources rs WHERE rs.id = NEW.roof_source_id;
        IF v_rs_study IS NULL OR v_rs_study <> NEW.study_id THEN
            RAISE EXCEPTION 'solar.layouts: the roof source belongs to another study' USING ERRCODE = '23514';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.name := btrim(NEW.name);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.layouts_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.layouts_bind() FROM anon;
CREATE TRIGGER layouts_bind BEFORE INSERT OR UPDATE ON solar.layouts
    FOR EACH ROW EXECUTE FUNCTION solar.layouts_bind();

ALTER TABLE solar.layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY layouts_select ON solar.layouts FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layouts_insert ON solar.layouts FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layouts_update ON solar.layouts FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layouts_delete ON solar.layouts FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layouts_insert_authz ON solar.layouts AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layouts_update_authz ON solar.layouts AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layouts_delete_authz ON solar.layouts AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 3. Layout objects ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.layout_objects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id           UUID NOT NULL REFERENCES solar.layouts(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    /* Denormalised from the roof source by the bind trigger, never trusted from
       the caller: cloud-sync-project's isAnnotated() looks the drawing up here. */
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),     -- NO ACTION, see header
    page_index          INTEGER,
    kind                TEXT NOT NULL CONSTRAINT layout_objects_kind_check
                          CHECK (kind IN ('roof', 'obstruction', 'array', 'module_block', 'inverter', 'string', 'equipment', 'north')),
    geometry            JSONB NOT NULL CHECK (jsonb_typeof(geometry) = 'object'),
    /* Image pixels per metre when the object was FIRST saved; pinned on update. */
    pixels_per_meter    NUMERIC CHECK (pixels_per_meter > 0),
    props               JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS layout_objects_layout_idx ON solar.layout_objects (layout_id);
CREATE INDEX IF NOT EXISTS layout_objects_floor_plan_idx ON solar.layout_objects (floor_plan_id);

CREATE OR REPLACE FUNCTION solar.layout_objects_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_org     UUID;
    v_kind    TEXT;
    v_fp      UUID;
    v_page    INTEGER;
    v_mpp     NUMERIC;
    v_ppm     NUMERIC;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.layout_id IS DISTINCT FROM OLD.layout_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
            RAISE EXCEPTION 'solar.layout_objects: an object cannot move to another layout or change kind' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.floor_plan_id := OLD.floor_plan_id;
        NEW.page_index := OLD.page_index;
        NEW.pixels_per_meter := OLD.pixels_per_meter;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT l.project_id, l.organisation_id, rs.kind, rs.floor_plan_id, rs.page_index, rs.m_per_px
          INTO v_project, v_org, v_kind, v_fp, v_page, v_mpp
          FROM solar.layouts l JOIN solar.roof_sources rs ON rs.id = l.roof_source_id
         WHERE l.id = NEW.layout_id;
        IF v_project IS NULL THEN
            RAISE EXCEPTION 'solar.layout_objects: layout % not found', NEW.layout_id USING ERRCODE = '23503';
        END IF;
        NEW.project_id := v_project;
        NEW.organisation_id := v_org;
        NEW.floor_plan_id := v_fp;
        NEW.page_index := CASE WHEN v_kind = 'drawing' THEN v_page ELSE NULL END;
        IF v_kind = 'satellite' THEN
            v_ppm := 1 / v_mpp;
        ELSE
            -- A page other than 1 has its own scale (00199); page 1 falls back to
            -- the drawing's. The caller's idea of the scale is never consulted.
            SELECT ps.pixels_per_meter INTO v_ppm
              FROM tenants.floor_plan_page_scales ps
             WHERE ps.floor_plan_id = v_fp AND ps.page_index = v_page;
            IF v_ppm IS NULL AND v_page = 1 THEN
                SELECT fp.pixels_per_meter INTO v_ppm FROM tenants.floor_plans fp WHERE fp.id = v_fp;
            END IF;
        END IF;
        IF v_ppm IS NULL AND NEW.kind <> 'north' THEN
            RAISE EXCEPTION 'solar.layout_objects: the roof source has no scale; calibrate this page first' USING ERRCODE = '23514';
        END IF;
        NEW.pixels_per_meter := v_ppm;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    IF NEW.kind = 'equipment' THEN
        IF NEW.props->>'equipmentKind' = 'db' AND NULLIF(NEW.props->>'nodeId', '') IS NULL THEN
            RAISE EXCEPTION 'solar.layout_objects: a DB symbol must link to a board' USING ERRCODE = '23514';
        END IF;
        IF NULLIF(NEW.props->>'nodeId', '') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM structure.nodes n WHERE n.id::text = NEW.props->>'nodeId' AND n.project_id = NEW.project_id) THEN
            RAISE EXCEPTION 'solar.layout_objects: the equipment board belongs to another project' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.layout_objects_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.layout_objects_bind() FROM anon;
CREATE TRIGGER layout_objects_bind BEFORE INSERT OR UPDATE ON solar.layout_objects
    FOR EACH ROW EXECUTE FUNCTION solar.layout_objects_bind();

ALTER TABLE solar.layout_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.layout_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY layout_objects_select ON solar.layout_objects FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layout_objects_insert ON solar.layout_objects FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layout_objects_update ON solar.layout_objects FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layout_objects_delete ON solar.layout_objects FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layout_objects_insert_authz ON solar.layout_objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layout_objects_update_authz ON solar.layout_objects AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layout_objects_delete_authz ON solar.layout_objects AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.roof_sources, solar.layouts, solar.layout_objects TO authenticated;
GRANT ALL ON solar.roof_sources, solar.layouts, solar.layout_objects TO service_role;
REVOKE ALL ON solar.roof_sources, solar.layouts, solar.layout_objects FROM anon;

-- ── 4. The save: one transaction, stale-refusing, RLS-decided ────────────────
CREATE OR REPLACE FUNCTION public.solar_save_layout_objects(
    p_layout_id           UUID,
    p_expected_updated_at TIMESTAMPTZ,
    p_upserts             JSONB,
    p_deletes             UUID[],
    p_summary             JSONB
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_updated TIMESTAMPTZ;
    v_obj     JSONB;
    v_n       INTEGER;
BEGIN
    IF p_upserts IS NULL OR jsonb_typeof(p_upserts) <> 'array' THEN
        RAISE EXCEPTION 'solar_save_layout_objects: upserts must be an array' USING ERRCODE = '22023';
    END IF;
    IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
        RAISE EXCEPTION 'solar_save_layout_objects: summary must be an object' USING ERRCODE = '22023';
    END IF;
    SELECT l.project_id INTO v_project FROM solar.layouts l WHERE l.id = p_layout_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.layouts: layout not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.solar_can_edit(v_project) THEN
        RAISE EXCEPTION 'solar.layouts: you cannot edit this layout' USING ERRCODE = '42501';
    END IF;
    SELECT l.updated_at INTO v_updated FROM solar.layouts l WHERE l.id = p_layout_id FOR UPDATE;
    IF v_updated IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.layouts: stale layout' USING ERRCODE = '40001';
    END IF;
    DELETE FROM solar.layout_objects o
     WHERE o.layout_id = p_layout_id AND o.id = ANY (COALESCE(p_deletes, ARRAY[]::uuid[]));
    FOR v_obj IN SELECT value FROM jsonb_array_elements(p_upserts) LOOP
        INSERT INTO solar.layout_objects AS o (id, layout_id, kind, geometry, props)
        VALUES ((v_obj->>'id')::uuid, p_layout_id, v_obj->>'kind', v_obj->'geometry', COALESCE(v_obj->'props', '{}'::jsonb))
        ON CONFLICT (id) DO UPDATE SET geometry = EXCLUDED.geometry, props = EXCLUDED.props
         WHERE o.layout_id = EXCLUDED.layout_id AND o.kind = EXCLUDED.kind;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'solar.layout_objects: object % belongs to another layout or changed kind', v_obj->>'id'
                USING ERRCODE = '42501';
        END IF;
    END LOOP;
    UPDATE solar.layouts l SET summary = p_summary WHERE l.id = p_layout_id RETURNING l.updated_at INTO v_updated;
    RETURN v_updated;
END $$;
REVOKE ALL ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) TO authenticated, service_role;

-- ── 5. Saved layout sheets read like the Solar module ────────────────────────
-- Redefines 00183's function IN FULL (a CREATE OR REPLACE replaces the body).
-- Every branch 00183 had is kept byte-for-byte in meaning; the new first branch
-- gates exactly one kind. A future Solar kind carrying money (a proposal) must
-- use solar_can_see_money, so this names the kind rather than matching solar_%.
CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
