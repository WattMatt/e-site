-- ---------------------------------------------------------------------------
-- Migration 00230: project load profiles (E8 — the Load profile tab)
-- ---------------------------------------------------------------------------
-- Number claimed at MERGE time: re-check the ledger, origin/main and every open
-- PR's migration filenames immediately before merging, and renumber if the head
-- moved (claiming a number is not holding it).
--
-- WHY A NEW HOME, NOT solar.meter_*: every Solar meter table, the solar-meter-raw
-- bucket and the tariffs schema admit only orgs with a live Solar subscription
-- (solar.library_orgs / caller_has_any_solar_org). The Load profile tab is for
-- every plan (owner decision E8-D1), so it cannot read or write those through the
-- caller's session. Production held zero solar.meter_* rows on 2026-10-05, so
-- nothing moves. The parsers and the load maths are reused unchanged; only the
-- storage is new.
--
-- SHAPE
--   * projects.load_profiles — one per project (settings: reference year, PF,
--     chosen tariff, confirmed NMD).
--   * projects.load_profile_sources — one row per imported channel or synthetic
--     block. A measured channel is stored as ONE contiguous fixed-interval run
--     (first interval end + interval + parallel real[]/smallint[] arrays), which
--     the parser already produces (it inserts a MISSING slot for every absent
--     interval). Up to 420 000 slots = four years at 5 minutes.
--   * bucket load-profile-files: the raw upload, {project_id}/{sha256}.{ext}, so
--     the server re-parses the stored file and never trusts the browser's parse.
--
-- ACCESS (docs/rbac-matrix.md "Load profile")
--   read  = any effective project role except client_viewer (SNAG_FIELD_ROLES)
--   write = owner / admin / project_manager (ORG_WRITE_ROLES)
--   One PERMISSIVE policy per verb carrying the whole condition: no RESTRICTIVE
--   FOR ALL (00205/00206 — FOR ALL includes SELECT and narrows reads), and no
--   second permissive policy that could OR a wider read in.
--   user_effective_project_role returns NULL for a non-member; COALESCE so the
--   predicate is FALSE, not NULL (00183).
--
-- RULES
--   * Parents are derived by trigger, never supplied (00199/00205 binding shape).
--   * The re-import key is NULLS DISTINCT (00221: NULLS NOT DISTINCT on a key
--     whose column can go NULL broke project deletes).
--   * No transaction control here: the runner wraps the file.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: projects.load_profiles
-- table: projects.load_profile_sources
-- column: projects.load_profile_sources.values
-- column: projects.load_profile_sources.kva_values
-- column: projects.load_profile_sources.params
-- constraint: load_profiles_project_key ON projects.load_profiles
-- constraint: load_profile_sources_meter_shape ON projects.load_profile_sources
-- constraint: load_profile_sources_synthetic_shape ON projects.load_profile_sources
-- constraint: load_profile_sources_channel_key ON projects.load_profile_sources
-- function: projects.load_profiles_bind_parents()
-- function: projects.load_profile_sources_bind_parents()
-- function: projects.load_profile_file_project(text)
-- trigger: load_profiles_bind_parents ON projects.load_profiles
-- trigger: load_profile_sources_bind_parents ON projects.load_profile_sources
-- policy: load_profiles_select ON projects.load_profiles
-- policy: load_profiles_insert ON projects.load_profiles
-- policy: load_profiles_update ON projects.load_profiles
-- policy: load_profiles_delete ON projects.load_profiles
-- policy: load_profile_sources_select ON projects.load_profile_sources
-- policy: load_profile_sources_insert ON projects.load_profile_sources
-- policy: load_profile_sources_update ON projects.load_profile_sources
-- policy: load_profile_sources_delete ON projects.load_profile_sources
-- grant_present: authenticated SELECT ON projects.load_profiles
-- grant_present: authenticated SELECT ON projects.load_profile_sources
-- grant_absent: anon SELECT ON projects.load_profiles
-- grant_absent: anon SELECT ON projects.load_profile_sources
-- grant_absent: anon EXECUTE ON projects.load_profile_file_project(text)
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('projects.load_profiles'::regclass, 'projects.load_profile_sources'::regclass))
-- sql: (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'load-profile-files' AND public = false)
-- sql: (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'load_profile_files_%')
-- sql: (SELECT count(*) = 1 FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'load_profile_sources' AND cmd IN ('SELECT', 'ALL') AND policyname <> 'site_scope')
-- sql: (SELECT strpos(pg_get_constraintdef(c.oid), 'NULLS NOT DISTINCT') = 0 FROM pg_constraint c WHERE c.conname = 'load_profile_sources_channel_key')
-- behaviour: scripts/db/assert-load-profile-rls.sql, every row ok
-- @verify:end

-- ── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects.load_profiles (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    reference_year   INTEGER NOT NULL DEFAULT 2025 CHECK (reference_year BETWEEN 2000 AND 2100),
    power_factor     NUMERIC(4,3) NOT NULL DEFAULT 0.95 CHECK (power_factor > 0 AND power_factor <= 1),
    tariff_id        UUID REFERENCES tariffs.tariff(id) ON DELETE SET NULL,
    nmd_kva          NUMERIC(12,2) CHECK (nmd_kva IS NULL OR nmd_kva > 0),
    created_by       UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT load_profiles_project_key UNIQUE (project_id)
);

COMMENT ON TABLE projects.load_profiles IS
'E8 Load profile tab: one per project. The profile itself is derived on read from load_profile_sources; nothing here caches it.';

CREATE TABLE IF NOT EXISTS projects.load_profile_sources (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id       UUID NOT NULL REFERENCES projects.load_profiles(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('meter', 'tenant_schedule', 'admd')),
    label            TEXT NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 200),
    included         BOOLEAN NOT NULL DEFAULT TRUE,
    -- measured channel
    file_path        TEXT,
    file_name        TEXT,
    file_sha256      TEXT CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
    format           TEXT,
    source_column    TEXT,
    kva_column       TEXT,
    interval_min     INTEGER CHECK (interval_min IS NULL OR interval_min IN (5, 10, 15, 30, 60)),
    first_ts_end     TIMESTAMPTZ,
    "values"         REAL[],
    quality          SMALLINT[],
    kva_values       REAL[],
    conversion       TEXT,
    quality_report   JSONB,
    parser_version   TEXT,
    -- synthetic block
    params           JSONB,
    created_by       UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT load_profile_sources_meter_shape CHECK (
        kind <> 'meter' OR (
            file_sha256 IS NOT NULL AND source_column IS NOT NULL AND interval_min IS NOT NULL
            AND first_ts_end IS NOT NULL AND "values" IS NOT NULL AND quality IS NOT NULL
            AND cardinality("values") BETWEEN 1 AND 420000
            AND cardinality(quality) = cardinality("values")
            AND (kva_values IS NULL OR cardinality(kva_values) = cardinality("values"))
            AND params IS NULL)),
    CONSTRAINT load_profile_sources_synthetic_shape CHECK (
        kind = 'meter' OR (
            params IS NOT NULL AND jsonb_typeof(params) = 'object'
            AND "values" IS NULL AND quality IS NULL AND kva_values IS NULL AND file_sha256 IS NULL)),
    -- Re-importing the same column of the same file replaces it. NULLS DISTINCT (00221).
    CONSTRAINT load_profile_sources_channel_key UNIQUE (profile_id, file_sha256, source_column)
);

CREATE INDEX IF NOT EXISTS load_profile_sources_profile_idx ON projects.load_profile_sources (profile_id, created_at);

COMMENT ON COLUMN projects.load_profile_sources."values" IS
'Stored kW (energy channels already converted kWh x 60 / interval), slot i ends at first_ts_end + i x interval_min. NULL = no usable value; quality[i] carries the parser''s code (meter-data QUALITY).';
COMMENT ON COLUMN projects.load_profile_sources.kva_values IS
'The paired measured kVA channel on the same slot grid, used for maximum demand only, never summed into load.';

-- ── 2. Parents are derived, never supplied ───────────────────────────────────

CREATE OR REPLACE FUNCTION projects.load_profiles_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT p.organisation_id INTO NEW.organisation_id FROM projects.projects p WHERE p.id = NEW.project_id;
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'load_profiles: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION projects.load_profile_sources_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT lp.project_id, lp.organisation_id
    INTO NEW.project_id, NEW.organisation_id
    FROM projects.load_profiles lp
   WHERE lp.id = NEW.profile_id;
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'load_profile_sources: profile % not found', NEW.profile_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION projects.load_profiles_bind_parents() FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.load_profiles_bind_parents() FROM anon;
REVOKE ALL ON FUNCTION projects.load_profile_sources_bind_parents() FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.load_profile_sources_bind_parents() FROM anon;

DROP TRIGGER IF EXISTS load_profiles_bind_parents ON projects.load_profiles;
CREATE TRIGGER load_profiles_bind_parents
    BEFORE INSERT OR UPDATE ON projects.load_profiles
    FOR EACH ROW EXECUTE FUNCTION projects.load_profiles_bind_parents();
DROP TRIGGER IF EXISTS load_profiles_updated_at ON projects.load_profiles;
CREATE TRIGGER load_profiles_updated_at
    BEFORE UPDATE ON projects.load_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS load_profile_sources_bind_parents ON projects.load_profile_sources;
CREATE TRIGGER load_profile_sources_bind_parents
    BEFORE INSERT OR UPDATE ON projects.load_profile_sources
    FOR EACH ROW EXECUTE FUNCTION projects.load_profile_sources_bind_parents();
DROP TRIGGER IF EXISTS load_profile_sources_updated_at ON projects.load_profile_sources;
CREATE TRIGGER load_profile_sources_updated_at
    BEFORE UPDATE ON projects.load_profile_sources
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Row security ──────────────────────────────────────────────────────────

ALTER TABLE projects.load_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.load_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.load_profile_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.load_profile_sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS load_profiles_select ON projects.load_profiles;
CREATE POLICY load_profiles_select ON projects.load_profiles FOR SELECT TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), 'client_viewer') <> 'client_viewer');
DROP POLICY IF EXISTS load_profiles_insert ON projects.load_profiles;
CREATE POLICY load_profiles_insert ON projects.load_profiles FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));
DROP POLICY IF EXISTS load_profiles_update ON projects.load_profiles;
CREATE POLICY load_profiles_update ON projects.load_profiles FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));
DROP POLICY IF EXISTS load_profiles_delete ON projects.load_profiles;
CREATE POLICY load_profiles_delete ON projects.load_profiles FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS load_profile_sources_select ON projects.load_profile_sources;
CREATE POLICY load_profile_sources_select ON projects.load_profile_sources FOR SELECT TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), 'client_viewer') <> 'client_viewer');
DROP POLICY IF EXISTS load_profile_sources_insert ON projects.load_profile_sources;
CREATE POLICY load_profile_sources_insert ON projects.load_profile_sources FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));
DROP POLICY IF EXISTS load_profile_sources_update ON projects.load_profile_sources;
CREATE POLICY load_profile_sources_update ON projects.load_profile_sources FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));
DROP POLICY IF EXISTS load_profile_sources_delete ON projects.load_profile_sources;
CREATE POLICY load_profile_sources_delete ON projects.load_profile_sources FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON projects.load_profiles, projects.load_profile_sources TO authenticated;
GRANT ALL ON projects.load_profiles, projects.load_profile_sources TO service_role;
REVOKE ALL ON projects.load_profiles, projects.load_profile_sources FROM anon;

-- ── 4. Raw-file bucket ───────────────────────────────────────────────────────
-- Path {project_id}/{sha256}.{csv|txt|xlsx}. foldername()[1] is the project id;
-- a malformed path yields NULL and therefore no access.

CREATE OR REPLACE FUNCTION projects.load_profile_file_project(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p_name !~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.(csv|txt|xlsx)$' THEN
    RETURN NULL;
  END IF;
  RETURN split_part(p_name, '/', 1)::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION projects.load_profile_file_project(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.load_profile_file_project(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION projects.load_profile_file_project(TEXT) TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('load-profile-files', 'load-profile-files', false, 52428800,
        ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS load_profile_files_read ON storage.objects;
CREATE POLICY load_profile_files_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'load-profile-files'
           AND COALESCE(public.user_effective_project_role(projects.load_profile_file_project(name)), 'client_viewer') <> 'client_viewer');
DROP POLICY IF EXISTS load_profile_files_insert ON storage.objects;
CREATE POLICY load_profile_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'load-profile-files'
           AND COALESCE(public.user_effective_project_role(projects.load_profile_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));
DROP POLICY IF EXISTS load_profile_files_delete ON storage.objects;
CREATE POLICY load_profile_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'load-profile-files'
           AND COALESCE(public.user_effective_project_role(projects.load_profile_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));
