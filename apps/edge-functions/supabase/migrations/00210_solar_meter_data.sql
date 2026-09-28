-- ---------------------------------------------------------------------------
-- Migration 00210: Solar meter data core (Phase 3a)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §1, §3, §3.1, §3.2; decision D-23.
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-3a-ii-meter-data-storage-pipeline.md
--
-- WHAT.
--   Org meter LIBRARY (shared by every study in the org):
--     meter_files, meters, meter_series_hashes, meter_register, meter_channels,
--     meter_import_reports, meter_readings (HASH(channel_id) x 8 partitions).
--   STUDY-scoped: study_meters, tenant_load_basis, site_load.
--   PLATFORM: load_archetypes (seeded; == LOAD_ARCHETYPES in @esite/shared, contract-tested).
--   solar.studies gains load_basis, reference_year, common_area_pct, diversity_factor.
--   Storage bucket solar-meter-raw (private), path <org>/<project>/<sha256>.<ext>.
--
-- ACCESS.
--   Library rows: visible to ACTIVE members of the row's org whose org subscription is live and who
--   hold at least View on any of the org's projects (owners/admins always); writes need Edit;
--   deletes need owner/admin. One helper, solar.library_orgs(level), returns the caller's orgs as an
--   array, so a policy is `organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[])`: evaluated
--   once per statement (InitPlan), not once per row, which matters at millions of readings.
--   Study rows: exactly the solar.studies pattern (00207).
--   Readings: SELECT policy only; no INSERT/UPDATE/DELETE grant; written by solar.write_readings.
--   Lapse = hidden but kept (every helper goes through solar.org_subscription_active).
--   LINKED meters (owner decision 2, 2026-09-28): an external project member with a View grant is
--   outside the org library, but may READ the meters linked (solar.study_meters) to a study on a
--   project they can view, with those meters' channels and readings. The SELECT policies of meters,
--   meter_channels and meter_readings carry one extra OR arm through solar.linked_meter_ids() /
--   solar.linked_channel_ids() (caller-scoped, once per statement, re-applying
--   public.solar_can_view per project, so a revoked grant, a lapse or an unlink hides them again).
--   No write policy calls them. meter_files, meter_register, meter_import_reports and
--   meter_series_hashes stay library-only: charting a linked meter needs none of them, and the
--   register carries org-wide tenant data. The raw object in solar-meter-raw follows its
--   meter_files record: solar.raw_path_allowed(…, 'view') needs the org library at View.
--
-- 00207's schema-wide directives re-run on every deploy and this migration conforms: every table
-- AND partition has FORCE RLS; no RESTRICTIVE policy covers SELECT; every SECURITY DEFINER function
-- in solar has its anon EXECUTE revoked.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.meter_files
-- table: solar.meters
-- table: solar.meter_series_hashes
-- table: solar.meter_register
-- table: solar.meter_channels
-- table: solar.meter_import_reports
-- table: solar.meter_readings
-- table: solar.study_meters
-- table: solar.tenant_load_basis
-- table: solar.load_archetypes
-- table: solar.site_load
-- column: solar.studies.load_basis
-- column: solar.studies.reference_year
-- column: solar.studies.common_area_pct
-- column: solar.studies.diversity_factor
-- constraint: meter_files_org_sha_key ON solar.meter_files
-- constraint: meter_channels_source_key ON solar.meter_channels
-- constraint: site_load_series_8760 ON solar.site_load
-- function: solar.try_uuid(text)
-- function: solar.library_orgs(text)
-- function: solar.raw_path_allowed(text, text)
-- function: solar.write_readings(uuid, timestamptz[], double precision[], smallint[])
-- function: solar.meter_files_bind()
-- function: solar.meters_bind()
-- function: solar.meter_series_hashes_bind()
-- function: solar.meter_register_bind()
-- function: solar.meter_channels_bind()
-- function: solar.meter_import_reports_bind()
-- function: solar.study_scoped_bind()
-- function: solar.tenant_load_basis_check()
-- trigger: meter_files_bind ON solar.meter_files
-- trigger: meters_bind ON solar.meters
-- trigger: meter_series_hashes_bind ON solar.meter_series_hashes
-- trigger: meter_register_bind ON solar.meter_register
-- trigger: meter_channels_bind ON solar.meter_channels
-- trigger: meter_import_reports_bind ON solar.meter_import_reports
-- trigger: study_meters_bind ON solar.study_meters
-- trigger: tenant_load_basis_bind ON solar.tenant_load_basis
-- trigger: tenant_load_basis_check ON solar.tenant_load_basis
-- trigger: site_load_bind ON solar.site_load
-- function: solar.study_meters_check()
-- trigger: study_meters_check ON solar.study_meters
-- policy: meter_files_select ON solar.meter_files PERMISSIVE
-- policy: meter_files_insert ON solar.meter_files PERMISSIVE
-- policy: meter_files_update ON solar.meter_files PERMISSIVE
-- policy: meter_files_delete ON solar.meter_files PERMISSIVE
-- policy: meter_files_insert_authz ON solar.meter_files RESTRICTIVE
-- policy: meter_files_update_authz ON solar.meter_files RESTRICTIVE
-- policy: meter_files_delete_authz ON solar.meter_files RESTRICTIVE
-- policy: meters_select ON solar.meters PERMISSIVE
-- policy: meters_insert ON solar.meters PERMISSIVE
-- policy: meters_update ON solar.meters PERMISSIVE
-- policy: meters_delete ON solar.meters PERMISSIVE
-- policy: meters_insert_authz ON solar.meters RESTRICTIVE
-- policy: meters_update_authz ON solar.meters RESTRICTIVE
-- policy: meters_delete_authz ON solar.meters RESTRICTIVE
-- policy: meter_series_hashes_select ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_insert ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_delete ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_insert_authz ON solar.meter_series_hashes RESTRICTIVE
-- policy: meter_series_hashes_delete_authz ON solar.meter_series_hashes RESTRICTIVE
-- policy: meter_register_select ON solar.meter_register PERMISSIVE
-- policy: meter_register_insert ON solar.meter_register PERMISSIVE
-- policy: meter_register_update ON solar.meter_register PERMISSIVE
-- policy: meter_register_delete ON solar.meter_register PERMISSIVE
-- policy: meter_register_insert_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_register_update_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_register_delete_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_channels_select ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_insert ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_update ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_delete ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_insert_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_channels_update_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_channels_delete_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_import_reports_select ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_insert ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_update ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_insert_authz ON solar.meter_import_reports RESTRICTIVE
-- policy: meter_import_reports_update_authz ON solar.meter_import_reports RESTRICTIVE
-- policy: meter_readings_select ON solar.meter_readings PERMISSIVE
-- policy: study_meters_select ON solar.study_meters PERMISSIVE
-- policy: study_meters_insert ON solar.study_meters PERMISSIVE
-- policy: study_meters_delete ON solar.study_meters PERMISSIVE
-- policy: study_meters_insert_authz ON solar.study_meters RESTRICTIVE
-- policy: study_meters_delete_authz ON solar.study_meters RESTRICTIVE
-- policy: tenant_load_basis_select ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_insert ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_update ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_delete ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_insert_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: tenant_load_basis_update_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: tenant_load_basis_delete_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: site_load_select ON solar.site_load PERMISSIVE
-- policy: site_load_insert ON solar.site_load PERMISSIVE
-- policy: site_load_update ON solar.site_load PERMISSIVE
-- policy: site_load_delete ON solar.site_load PERMISSIVE
-- policy: site_load_insert_authz ON solar.site_load RESTRICTIVE
-- policy: site_load_update_authz ON solar.site_load RESTRICTIVE
-- policy: site_load_delete_authz ON solar.site_load RESTRICTIVE
-- policy: load_archetypes_select ON solar.load_archetypes PERMISSIVE
-- policy: solar_meter_raw_read ON storage.objects PERMISSIVE
-- policy: solar_meter_raw_insert ON storage.objects PERMISSIVE
-- grant_absent: anon SELECT ON solar.meter_readings
-- grant_absent: authenticated INSERT ON solar.meter_readings
-- grant_absent: authenticated UPDATE ON solar.meter_readings
-- grant_absent: authenticated DELETE ON solar.meter_readings
-- grant_absent: authenticated INSERT ON solar.load_archetypes
-- grant_absent: authenticated UPDATE ON solar.load_archetypes
-- grant_absent: authenticated DELETE ON solar.load_archetypes
-- grant_absent: authenticated UPDATE ON solar.meter_series_hashes
-- grant_absent: anon EXECUTE ON solar.library_orgs(text)
-- grant_absent: anon EXECUTE ON solar.raw_path_allowed(text, text)
-- grant_absent: anon EXECUTE ON solar.write_readings(uuid, timestamptz[], double precision[], smallint[])
-- grant_absent: anon EXECUTE ON solar.try_uuid(text)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT c.relkind = 'p' FROM pg_class c WHERE c.oid = 'solar.meter_readings'::regclass)
-- sql: (SELECT count(*) = 8 FROM pg_inherits WHERE inhparent = 'solar.meter_readings'::regclass)
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'solar.meter_readings'::regclass)
-- sql: (SELECT count(*) = 8 FROM solar.load_archetypes WHERE is_current)
-- sql: (SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-meter-raw' AND NOT public))
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'solar_meter_raw%' AND cmd IN ('UPDATE', 'DELETE', 'ALL')))
-- function: solar.linked_meter_ids()
-- function: solar.linked_channel_ids()
-- index: study_meters_project_idx ON solar.study_meters
-- grant_absent: anon EXECUTE ON solar.linked_meter_ids()
-- grant_absent: anon EXECUTE ON solar.linked_channel_ids()
-- sql: (SELECT strpos(qual, 'linked_meter_ids') > 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'meters' AND policyname = 'meters_select')
-- sql: (SELECT strpos(qual, 'linked_meter_ids') > 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'meter_channels' AND policyname = 'meter_channels_select')
-- sql: (SELECT strpos(qual, 'linked_channel_ids') > 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'meter_readings' AND policyname = 'meter_readings_select')
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'solar' AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'linked_') > 0 AND policyname NOT IN ('meters_select', 'meter_channels_select', 'meter_readings_select')))
-- sql: (SELECT strpos(pg_get_functiondef('solar.raw_path_allowed(text, text)'::regprocedure), 'library_orgs') > 0)
-- behaviour: scripts/db/assert-solar-meter-data-roles.sql - every row ok
-- @verify:end

-- NO BEGIN/COMMIT (scripts/db/dry-run-migration.sh wraps this file in BEGIN … ROLLBACK).

-- ── 0. solar.studies: load settings ──────────────────────────────────────────
ALTER TABLE solar.studies
    ADD COLUMN IF NOT EXISTS load_basis       TEXT CHECK (load_basis IN ('S1', 'S2', 'S3', 'S4')),
    ADD COLUMN IF NOT EXISTS reference_year   INTEGER CHECK (reference_year BETWEEN 2000 AND 2100),
    ADD COLUMN IF NOT EXISTS common_area_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (common_area_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS diversity_factor NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (diversity_factor > 0 AND diversity_factor <= 1);

-- ── 1. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION solar.try_uuid(p TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
    RETURN p::uuid;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- The caller's orgs whose meter library they may see ('view'), change ('edit') or prune ('admin').
-- Caller-scoped (auth.uid()), so it is not an oracle about anyone else. Empty for the service path.
CREATE OR REPLACE FUNCTION solar.library_orgs(p_min TEXT)
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_ranks CONSTANT TEXT[] := ARRAY['view', 'edit', 'edit_financials'];
    v_need  INT;
    v_out   UUID[];
BEGIN
    IF auth.uid() IS NULL THEN RETURN '{}'::uuid[]; END IF;
    IF p_min = 'admin' THEN
        SELECT COALESCE(array_agg(uo.organisation_id), '{}'::uuid[]) INTO v_out
          FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin')
           AND solar.org_subscription_active(uo.organisation_id);
        RETURN v_out;
    END IF;
    v_need := array_position(v_ranks, p_min);
    IF v_need IS NULL THEN
        RAISE EXCEPTION 'solar.library_orgs: unknown level %', p_min USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT uo.organisation_id), '{}'::uuid[]) INTO v_out
      FROM public.user_organisations uo
     WHERE uo.user_id = auth.uid() AND uo.is_active
       AND solar.org_subscription_active(uo.organisation_id)
       AND (uo.role IN ('owner', 'admin')
            OR EXISTS (SELECT 1 FROM solar.project_access pa
                         JOIN projects.projects p ON p.id = pa.project_id
                        WHERE pa.user_id = auth.uid() AND p.organisation_id = uo.organisation_id
                          AND array_position(v_ranks, public.solar_access_level(pa.project_id)) >= v_need));
    RETURN v_out;
END $$;

-- Storage path rule for solar-meter-raw: <org>/<project>/<sha256>.<ext>, the org segment must be the
-- project's org. Read needs the org library at View AND View on that project (the same audience as
-- the meter_files record); upload needs Edit on that project.
CREATE OR REPLACE FUNCTION solar.raw_path_allowed(p_name TEXT, p_need TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_parts   TEXT[] := string_to_array(p_name, '/');
    v_org     UUID;
    v_project UUID;
    v_owner   UUID;
BEGIN
    IF coalesce(array_length(v_parts, 1), 0) <> 3 THEN RETURN FALSE; END IF;
    IF v_parts[3] !~ '^[0-9a-f]{64}\.(csv|txt|xlsx|xls)$' THEN RETURN FALSE; END IF;
    v_org := solar.try_uuid(v_parts[1]);
    v_project := solar.try_uuid(v_parts[2]);
    IF v_org IS NULL OR v_project IS NULL THEN RETURN FALSE; END IF;
    SELECT organisation_id INTO v_owner FROM projects.projects WHERE id = v_project;
    IF v_owner IS DISTINCT FROM v_org THEN RETURN FALSE; END IF;
    -- Read = whoever can read the meter_files record: the org library at View (so an external
    -- project member with a View grant, who sees only LINKED meters, never reads a raw file), AND
    -- View on the project the file came through.
    IF p_need = 'view' THEN
        RETURN v_org = ANY (solar.library_orgs('view')) AND public.solar_can_view(v_project);
    END IF;
    IF p_need = 'edit' THEN RETURN public.solar_can_edit(v_project); END IF;
    RETURN FALSE;
END $$;

-- ── 2. Meter files (raw, kept once per org) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.meter_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes       BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
    storage_path     TEXT NOT NULL,
    original_name    TEXT NOT NULL CHECK (length(btrim(original_name)) > 0),
    parsed_filename  JSONB,
    detected_format  TEXT CHECK (detected_format IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'generic', 'empty')),
    delimiter        TEXT,
    decimal_sep      TEXT CHECK (decimal_sep IN ('.', ',')),
    header_row       INTEGER,
    encoding         TEXT,
    body_sha256      TEXT CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    source_serials   TEXT[] NOT NULL DEFAULT '{}',
    ts_convention    TEXT CHECK (ts_convention IN ('begin', 'end')),
    row_order        TEXT CHECK (row_order IN ('ascending', 'descending', 'unordered')),
    status           TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'accepted', 'skipped', 'failed')),
    skip_reason      TEXT,
    uploaded_by      UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_files_org_sha_key UNIQUE (organisation_id, sha256),
    CONSTRAINT meter_files_skip_reason CHECK (status <> 'skipped' OR length(btrim(coalesce(skip_reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS meter_files_org_body_idx ON solar.meter_files (organisation_id, body_sha256);
CREATE INDEX IF NOT EXISTS meter_files_project_idx ON solar.meter_files (project_id);

CREATE OR REPLACE FUNCTION solar.meter_files_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id <> OLD.project_id OR NEW.sha256 <> OLD.sha256 OR NEW.storage_path <> OLD.storage_path
           OR NEW.organisation_id <> OLD.organisation_id OR NEW.size_bytes <> OLD.size_bytes THEN
            RAISE EXCEPTION 'solar.meter_files: project, hash, size and path are immutable' USING ERRCODE = '42501';
        END IF;
        NEW.uploaded_by := OLD.uploaded_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        IF NEW.organisation_id IS NULL THEN
            RAISE EXCEPTION 'solar.meter_files: project % not found', NEW.project_id USING ERRCODE = '23503';
        END IF;
        IF NEW.storage_path !~ ('^' || NEW.organisation_id::text || '/' || NEW.project_id::text || '/' || NEW.sha256 || '\.(csv|txt|xlsx|xls)$') THEN
            RAISE EXCEPTION 'solar.meter_files: storage_path must be <org>/<project>/<sha256>.<ext>' USING ERRCODE = '23514';
        END IF;
        IF auth.uid() IS NOT NULL THEN
            NEW.uploaded_by := auth.uid();
            NEW.created_at := NOW();
        END IF;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_files_bind BEFORE INSERT OR UPDATE ON solar.meter_files
    FOR EACH ROW EXECUTE FUNCTION solar.meter_files_bind();

-- ── 3. Meters (org library) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.meters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    site_label              TEXT,
    label                   TEXT NOT NULL CHECK (length(btrim(label)) > 0),
    serials                 TEXT[] NOT NULL DEFAULT '{}',
    shop_no                 TEXT,
    area_m2                 NUMERIC(10,2) CHECK (area_m2 > 0),
    area_source             TEXT CHECK (area_source IN ('register_exact', 'register_llm', 'filename', 'manual')),
    kind                    TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (kind IN ('tenant', 'bulk', 'council', 'generator', 'solar', 'common', 'vacant', 'check', 'virtual', 'water', 'unknown')),
    supply_point_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
    node_id                 UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    parent_meter_id         UUID REFERENCES solar.meters(id) ON DELETE SET NULL,
    existing_pv_channel_id  UUID,
    created_by              UUID REFERENCES auth.users(id),
    updated_by              UUID REFERENCES auth.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meters_supply_point_bulk_only CHECK (NOT supply_point_confirmed OR kind = 'bulk'),
    CONSTRAINT meters_area_with_source CHECK ((area_m2 IS NULL) = (area_source IS NULL))
);
CREATE INDEX IF NOT EXISTS meters_org_idx ON solar.meters (organisation_id);
CREATE INDEX IF NOT EXISTS meters_serials_gin ON solar.meters USING gin (serials);

CREATE OR REPLACE FUNCTION solar.meters_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.meters: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSIF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
    END IF;
    IF NEW.node_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM structure.nodes n JOIN projects.projects p ON p.id = n.project_id
         WHERE n.id = NEW.node_id AND p.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: node belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_meter_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meters m WHERE m.id = NEW.parent_meter_id AND m.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: parent meter belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF NEW.existing_pv_channel_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_channels c WHERE c.id = NEW.existing_pv_channel_id AND c.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: PV channel belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meters_bind BEFORE INSERT OR UPDATE ON solar.meters
    FOR EACH ROW EXECUTE FUNCTION solar.meters_bind();

-- ── 4. Channels ──────────────────────────────────────────────────────────────
-- unit is the STORED unit (energy per interval is stored as average power). There is no 'unknown':
-- the database refuses a channel whose unit nobody chose (engine spec §2.1 step 3).
CREATE TABLE IF NOT EXISTS solar.meter_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    meter_id        UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    file_id         UUID REFERENCES solar.meter_files(id) ON DELETE SET NULL,
    source_column   TEXT NOT NULL CHECK (length(btrim(source_column)) > 0),
    quantity        TEXT NOT NULL CHECK (quantity IN ('active_power', 'reactive_power', 'apparent_power', 'active_energy',
                                                      'reactive_energy', 'apparent_energy', 'voltage', 'current', 'power_factor')),
    direction       TEXT NOT NULL CHECK (direction IN ('import', 'export', 'none')),
    phase           TEXT CHECK (phase IN ('l1', 'l2', 'l3')),
    source_unit     TEXT NOT NULL CHECK (source_unit IN ('kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'PF')),
    unit            TEXT NOT NULL CHECK (unit IN ('kW', 'kvar', 'kVA', 'V', 'A', 'PF')),
    interval_min    INTEGER NOT NULL CHECK (interval_min > 0 AND interval_min <= 1440),
    is_cumulative   BOOLEAN NOT NULL DEFAULT FALSE,
    tz_convention   TEXT NOT NULL CHECK (tz_convention IN ('begin', 'end')),
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    coverage_only   BOOLEAN NOT NULL DEFAULT FALSE,
    parser_version  TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_channels_source_key UNIQUE NULLS NOT DISTINCT (meter_id, file_id, source_column)
);
CREATE UNIQUE INDEX IF NOT EXISTS meter_channels_one_primary_per_file ON solar.meter_channels (meter_id, file_id) WHERE is_primary;
ALTER TABLE solar.meters
    ADD CONSTRAINT meters_existing_pv_channel_fk FOREIGN KEY (existing_pv_channel_id) REFERENCES solar.meter_channels(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION solar.meter_channels_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.meter_id <> OLD.meter_id THEN
        RAISE EXCEPTION 'solar.meter_channels: meter_id is immutable' USING ERRCODE = '42501';
    END IF;
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meters WHERE id = NEW.meter_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_channels: meter % not found', NEW.meter_id USING ERRCODE = '23503';
    END IF;
    IF NEW.file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_channels: file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_channels_bind BEFORE INSERT OR UPDATE ON solar.meter_channels
    FOR EACH ROW EXECUTE FUNCTION solar.meter_channels_bind();

-- ── 5. Readings (D-23: partitioned Postgres table; see the volume test) ─────
CREATE TABLE IF NOT EXISTS solar.meter_readings (
    channel_id       UUID NOT NULL REFERENCES solar.meter_channels(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL,
    ts_end           TIMESTAMPTZ NOT NULL,
    value            DOUBLE PRECISION,
    quality          SMALLINT NOT NULL CHECK (quality BETWEEN 0 AND 7),
    CONSTRAINT meter_readings_value_or_missing CHECK (value IS NOT NULL OR quality IN (1, 4)),
    PRIMARY KEY (channel_id, ts_end)
) PARTITION BY HASH (channel_id);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p0 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 0);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p1 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 1);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p2 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 2);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p3 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 3);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p4 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 4);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p5 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 5);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p6 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 6);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p7 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 7);

-- The only write path for readings: Edit on the channel's org library, checked once per call.
CREATE OR REPLACE FUNCTION solar.write_readings(
    p_channel_id UUID, p_ts_end TIMESTAMPTZ[], p_value DOUBLE PRECISION[], p_quality SMALLINT[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_org UUID;
    v_n   INTEGER;
BEGIN
    SELECT organisation_id INTO v_org FROM solar.meter_channels WHERE id = p_channel_id;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'solar.write_readings: channel % not found', p_channel_id USING ERRCODE = '23503';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT (v_org = ANY (solar.library_orgs('edit'))) THEN
        RAISE EXCEPTION 'solar.write_readings: no Edit access to this meter library' USING ERRCODE = '42501';
    END IF;
    IF cardinality(p_ts_end) <> cardinality(p_value) OR cardinality(p_ts_end) <> cardinality(p_quality) THEN
        RAISE EXCEPTION 'solar.write_readings: arrays differ in length' USING ERRCODE = '22023';
    END IF;
    IF cardinality(p_ts_end) > 20000 THEN
        RAISE EXCEPTION 'solar.write_readings: at most 20000 readings per call' USING ERRCODE = '54000';
    END IF;
    INSERT INTO solar.meter_readings AS r (channel_id, organisation_id, ts_end, value, quality)
    SELECT p_channel_id, v_org, u.t, u.v, u.q FROM unnest(p_ts_end, p_value, p_quality) AS u(t, v, q)
    ON CONFLICT (channel_id, ts_end) DO UPDATE SET value = EXCLUDED.value, quality = EXCLUDED.quality;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- ── 6. Identity hashes, registers, import reports ───────────────────────────
CREATE TABLE IF NOT EXISTS solar.meter_series_hashes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    body_hash        TEXT NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    file_id          UUID NOT NULL REFERENCES solar.meter_files(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_series_hashes_key UNIQUE (organisation_id, body_hash, file_id)
);
CREATE INDEX IF NOT EXISTS meter_series_hashes_lookup ON solar.meter_series_hashes (organisation_id, body_hash);

CREATE OR REPLACE FUNCTION solar.meter_series_hashes_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meters WHERE id = NEW.meter_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_series_hashes: meter % not found', NEW.meter_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_series_hashes: file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_series_hashes_bind BEFORE INSERT ON solar.meter_series_hashes
    FOR EACH ROW EXECUTE FUNCTION solar.meter_series_hashes_bind();

CREATE TABLE IF NOT EXISTS solar.meter_register (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    source_file_id   UUID REFERENCES solar.meter_files(id) ON DELETE SET NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('summary', 'download_log')),
    site_label       TEXT,
    file_name        TEXT,
    tenant_name      TEXT,
    shop_no          TEXT,
    area_m2          NUMERIC(10,2) CHECK (area_m2 > 0),
    match_method     TEXT NOT NULL DEFAULT 'none' CHECK (match_method IN ('exact', 'llm', 'unmapped', 'manual', 'none')),
    serial           TEXT,
    mall_name        TEXT,
    downloaded       BOOLEAN,
    qa               JSONB NOT NULL DEFAULT '{}'::jsonb,
    confirmed_by     UUID REFERENCES auth.users(id),
    confirmed_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_register_confirm_pair CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS meter_register_serial_idx ON solar.meter_register (organisation_id, serial);
CREATE INDEX IF NOT EXISTS meter_register_shop_idx ON solar.meter_register (organisation_id, shop_no);

CREATE OR REPLACE FUNCTION solar.meter_register_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.meter_register: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
            NEW.confirmed_by := COALESCE(auth.uid(), NEW.confirmed_by);
        END IF;
    ELSIF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
        NEW.confirmed_by := CASE WHEN NEW.confirmed_at IS NULL THEN NULL ELSE auth.uid() END;
    END IF;
    IF NEW.source_file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.source_file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_register: source file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER meter_register_bind BEFORE INSERT OR UPDATE ON solar.meter_register
    FOR EACH ROW EXECUTE FUNCTION solar.meter_register_bind();

CREATE TABLE IF NOT EXISTS solar.meter_import_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    file_id          UUID NOT NULL REFERENCES solar.meter_files(id) ON DELETE CASCADE,
    parser_version   TEXT NOT NULL,
    options          JSONB NOT NULL DEFAULT '{}'::jsonb,
    report           JSONB NOT NULL,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_by      UUID REFERENCES auth.users(id),
    accepted_at      TIMESTAMPTZ,
    CONSTRAINT meter_import_reports_accept_pair CHECK ((accepted_by IS NULL) = (accepted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS meter_import_reports_file_idx ON solar.meter_import_reports (file_id, created_at DESC);

CREATE OR REPLACE FUNCTION solar.meter_import_reports_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.file_id <> OLD.file_id OR NEW.report <> OLD.report OR NEW.options <> OLD.options THEN
            RAISE EXCEPTION 'solar.meter_import_reports: a report is immutable; only acceptance may be recorded' USING ERRCODE = '42501';
        END IF;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
            NEW.accepted_by := COALESCE(auth.uid(), NEW.accepted_by);
            NEW.accepted_at := NOW();
        ELSE
            NEW.accepted_by := OLD.accepted_by;
            NEW.accepted_at := OLD.accepted_at;
        END IF;
        RETURN NEW;
    END IF;
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meter_files WHERE id = NEW.file_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_import_reports: file % not found', NEW.file_id USING ERRCODE = '23503';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
    END IF;
    NEW.accepted_by := NULL;
    NEW.accepted_at := NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER meter_import_reports_bind BEFORE INSERT OR UPDATE ON solar.meter_import_reports
    FOR EACH ROW EXECUTE FUNCTION solar.meter_import_reports_bind();

-- ── 7. Study-scoped tables ───────────────────────────────────────────────────
-- One bind for all three: project and org come from the study; the study is immutable.
CREATE OR REPLACE FUNCTION solar.study_scoped_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.study_id <> OLD.study_id THEN
        RAISE EXCEPTION '%: study_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id FROM solar.studies s WHERE s.id = NEW.study_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION '%: study % not found', TG_TABLE_NAME, NEW.study_id USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS solar.study_meters (
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    added_by         UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (study_id, meter_id)
);
CREATE TRIGGER study_meters_bind BEFORE INSERT ON solar.study_meters
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

CREATE TABLE IF NOT EXISTS solar.tenant_load_basis (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id               UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id             UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id        UUID NOT NULL REFERENCES public.organisations(id),
    node_id                UUID NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    source                 TEXT NOT NULL CHECK (source IN ('metered', 'synthesised', 'excluded')),
    meters                 JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(meters) = 'array'),
    archetype              TEXT CHECK (archetype IN ('retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant')),
    density_override_w_m2  NUMERIC(8,2) CHECK (density_override_w_m2 > 0),
    updated_by             UUID REFERENCES auth.users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_load_basis_node_key UNIQUE (study_id, node_id),
    CONSTRAINT tenant_load_basis_metered_has_meters CHECK (source <> 'metered' OR jsonb_array_length(meters) > 0)
);
CREATE TRIGGER tenant_load_basis_bind BEFORE INSERT OR UPDATE ON solar.tenant_load_basis
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

-- Runs after the bind (trigger names sort: _bind < _check). The node is on the study's project;
-- every meters[] element is {meter_id: <a meter of the same org>, weight: > 0}.
CREATE OR REPLACE FUNCTION solar.tenant_load_basis_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_el    JSONB;
    v_meter UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = NEW.node_id AND n.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'solar.tenant_load_basis: node belongs to another project' USING ERRCODE = '23514';
    END IF;
    FOR v_el IN SELECT value FROM jsonb_array_elements(NEW.meters) LOOP
        v_meter := solar.try_uuid(v_el ->> 'meter_id');
        IF v_meter IS NULL OR NOT EXISTS (SELECT 1 FROM solar.meters m WHERE m.id = v_meter AND m.organisation_id = NEW.organisation_id) THEN
            RAISE EXCEPTION 'solar.tenant_load_basis: meter % is not in this organisation', v_el ->> 'meter_id' USING ERRCODE = '23514';
        END IF;
        IF jsonb_typeof(v_el -> 'weight') IS DISTINCT FROM 'number' OR (v_el ->> 'weight')::numeric <= 0 THEN
            RAISE EXCEPTION 'solar.tenant_load_basis: every meter weight must be a number > 0' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER tenant_load_basis_check BEFORE INSERT OR UPDATE ON solar.tenant_load_basis
    FOR EACH ROW EXECUTE FUNCTION solar.tenant_load_basis_check();

CREATE TABLE IF NOT EXISTS solar.site_load (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    basis            TEXT NOT NULL CHECK (basis IN ('S1', 'S2', 'S3', 'S4')),
    reference_year   INTEGER NOT NULL CHECK (reference_year BETWEEN 2000 AND 2100),
    series           REAL[] NOT NULL,
    md_monthly       JSONB NOT NULL DEFAULT '[]'::jsonb,
    coverage         JSONB NOT NULL DEFAULT '{}'::jsonb,
    inputs_hash      TEXT NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
    engine_version   TEXT NOT NULL,
    built_by         UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    built_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT site_load_series_8760 CHECK (cardinality(series) = 8760),
    CONSTRAINT site_load_key UNIQUE (study_id, basis, reference_year)
);
CREATE TRIGGER site_load_bind BEFORE INSERT OR UPDATE ON solar.site_load
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

-- study_meters: the meter must be in the study's organisation. A trigger (not a CHECK) because it
-- reads another table; named to run after study_meters_bind.
CREATE OR REPLACE FUNCTION solar.study_meters_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM solar.meters m WHERE m.id = NEW.meter_id AND m.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.study_meters: the meter belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.added_by := COALESCE(auth.uid(), NEW.added_by);
    NEW.added_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER study_meters_check BEFORE INSERT ON solar.study_meters
    FOR EACH ROW EXECUTE FUNCTION solar.study_meters_check();
CREATE INDEX IF NOT EXISTS study_meters_project_idx ON solar.study_meters (project_id);
CREATE INDEX IF NOT EXISTS study_meters_meter_idx ON solar.study_meters (meter_id);

-- Decision 2 (owner, 2026-09-28): the meters LINKED to a study on a project the caller can view.
-- It is the read path for an external project member with a View grant (outside the org library);
-- for an org member it adds nothing solar.library_orgs('view') does not already give (owners and
-- admins, who need no grant row, are in the library already). Caller-scoped (auth.uid()), so it is
-- not an oracle about anyone else; empty for the service path. It re-applies public.solar_can_view
-- per project, which is where the subscription, the grant, the eligibility cap and the member's
-- activity are checked, so a lapse, a revoked grant or a removed link hides the meters again.
-- Only SELECT policies call it: it never admits a write.
CREATE OR REPLACE FUNCTION solar.linked_meter_ids()
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_out UUID[];
BEGIN
    IF auth.uid() IS NULL THEN RETURN '{}'::uuid[]; END IF;
    SELECT COALESCE(array_agg(DISTINCT sm.meter_id), '{}'::uuid[]) INTO v_out
      FROM solar.study_meters sm
     WHERE sm.project_id IN (SELECT pa.project_id FROM solar.project_access pa
                              WHERE pa.user_id = auth.uid() AND public.solar_can_view(pa.project_id));
    RETURN v_out;
END $$;

-- The channels of those meters (the readings policy filters on channel_id, the partition key).
CREATE OR REPLACE FUNCTION solar.linked_channel_ids()
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_meters UUID[];
    v_out    UUID[];
BEGIN
    v_meters := solar.linked_meter_ids();
    IF cardinality(v_meters) = 0 THEN RETURN '{}'::uuid[]; END IF;
    SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v_out
      FROM solar.meter_channels c WHERE c.meter_id = ANY (v_meters);
    RETURN v_out;
END $$;

-- ── 8. Load archetypes (platform data; == LOAD_ARCHETYPES in @esite/shared) ─
CREATE TABLE IF NOT EXISTS solar.load_archetypes (
    code        TEXT NOT NULL CHECK (code IN ('retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant')),
    version     INTEGER NOT NULL CHECK (version > 0),
    name        TEXT NOT NULL,
    profiles    JSONB NOT NULL,
    operating   JSONB NOT NULL,
    seasonal    JSONB NOT NULL CHECK (jsonb_array_length(seasonal) = 12),
    is_current  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS load_archetypes_one_current ON solar.load_archetypes (code) WHERE is_current;

INSERT INTO solar.load_archetypes (code, version, name, profiles, operating, seasonal) VALUES
    ('retail', 1, 'Retail (09:00-18:00 Mon-Sat)',
     '{"weekday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.5,1,1,1,1,1,1,1,1,1,0.5,0.15,0.15,0.15,0.15,0.15],"saturday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.5,1,1,1,1,1,1,1,1,1,0.5,0.15,0.15,0.15,0.15,0.15],"sunday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15],"holiday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15]}'::jsonb,
     '{"weekday":[9,18],"saturday":[9,18],"sunday":null,"holiday":null}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('fast_food', 1, 'Fast food (07:00-22:00 daily)',
     '{"weekday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"saturday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"sunday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"holiday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2]}'::jsonb,
     '{"weekday":[7,22],"saturday":[7,22],"sunday":[7,22],"holiday":[7,22]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('restaurant', 1, 'Restaurant (11:00-22:00 daily)',
     '{"weekday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"saturday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"sunday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"holiday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2]}'::jsonb,
     '{"weekday":[11,22],"saturday":[11,22],"sunday":[11,22],"holiday":[11,22]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('supermarket', 1, 'Supermarket (refrigeration base 35 %)',
     '{"weekday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35],"saturday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35],"sunday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35,0.35,0.35,0.35],"holiday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35,0.35,0.35,0.35]}'::jsonb,
     '{"weekday":[8,20],"saturday":[8,20],"sunday":[8,17],"holiday":[8,17]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('office_bank', 1, 'Office / bank (07:00-18:00 Mon-Fri)',
     '{"weekday":[0.1,0.1,0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1,0.1,0.1,0.1],"saturday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1],"sunday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1],"holiday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1]}'::jsonb,
     '{"weekday":[7,18],"saturday":null,"sunday":null,"holiday":null}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('gym', 1, 'Gym (05:00-21:00 daily)',
     '{"weekday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"saturday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"sunday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"holiday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1]}'::jsonb,
     '{"weekday":[5,21],"saturday":[5,21],"sunday":[5,21],"holiday":[5,21]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('anchor_24h', 1, 'Anchor (24 h base 60 %, trading 08:00-21:00)',
     '{"weekday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"saturday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"sunday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"holiday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6]}'::jsonb,
     '{"weekday":[8,21],"saturday":[8,21],"sunday":[8,21],"holiday":[8,21]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('vacant', 1, 'Vacant (no load)',
     '{"weekday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"saturday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"sunday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"holiday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb,
     '{"weekday":null,"saturday":null,"sunday":null,"holiday":null}'::jsonb,
     '[1,1,1,1,1,1,1,1,1,1,1,1]'::jsonb)
ON CONFLICT (code, version) DO NOTHING;

-- ── 9. Function privileges (spelled out: the anon-EXECUTE guard reads this text) ─
REVOKE ALL ON FUNCTION solar.try_uuid(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.try_uuid(text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.try_uuid(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.library_orgs(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.library_orgs(text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.library_orgs(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.raw_path_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.raw_path_allowed(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.raw_path_allowed(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) FROM anon;
GRANT EXECUTE ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.meter_files_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_files_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meters_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meters_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_channels_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_channels_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_series_hashes_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_series_hashes_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_register_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_register_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_import_reports_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_import_reports_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.study_scoped_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.study_scoped_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.tenant_load_basis_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.tenant_load_basis_check() FROM anon;
REVOKE ALL ON FUNCTION solar.study_meters_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.study_meters_check() FROM anon;
REVOKE ALL ON FUNCTION solar.linked_meter_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.linked_meter_ids() FROM anon;
GRANT EXECUTE ON FUNCTION solar.linked_meter_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.linked_channel_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.linked_channel_ids() FROM anon;
GRANT EXECUTE ON FUNCTION solar.linked_channel_ids() TO authenticated, service_role;

-- ── 10. Row level security ───────────────────────────────────────────────────
ALTER TABLE solar.meter_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_files FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meters FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_series_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_series_hashes FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_register FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_import_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_import_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p0 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p0 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p1 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p2 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p3 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p4 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p5 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p5 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p6 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p6 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p7 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p7 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.study_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.study_meters FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.tenant_load_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tenant_load_basis FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.site_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.site_load FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.load_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.load_archetypes FORCE ROW LEVEL SECURITY;

-- Library tables. V = view set, E = edit set, A = owner/admin set; each (SELECT …) is an InitPlan.
CREATE POLICY meter_files_select ON solar.meter_files FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_files_insert ON solar.meter_files FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_files_update ON solar.meter_files FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_files_delete ON solar.meter_files FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_files_insert_authz ON solar.meter_files AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]) AND public.solar_can_edit(project_id));
CREATE POLICY meter_files_update_authz ON solar.meter_files AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_files_delete_authz ON solar.meter_files AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]));

CREATE POLICY meters_select ON solar.meters FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[])
           OR id = ANY ((SELECT solar.linked_meter_ids())::uuid[]));
CREATE POLICY meters_insert ON solar.meters FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meters_update ON solar.meters FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meters_delete ON solar.meters FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meters_insert_authz ON solar.meters AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meters_update_authz ON solar.meters AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meters_delete_authz ON solar.meters AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]));

CREATE POLICY meter_series_hashes_select ON solar.meter_series_hashes FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_series_hashes_insert ON solar.meter_series_hashes FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_series_hashes_delete ON solar.meter_series_hashes FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_series_hashes_insert_authz ON solar.meter_series_hashes AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_series_hashes_delete_authz ON solar.meter_series_hashes AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));

CREATE POLICY meter_register_select ON solar.meter_register FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_register_insert ON solar.meter_register FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_register_update ON solar.meter_register FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_register_delete ON solar.meter_register FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_register_insert_authz ON solar.meter_register AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_register_update_authz ON solar.meter_register AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_register_delete_authz ON solar.meter_register AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]));

CREATE POLICY meter_channels_select ON solar.meter_channels FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[])
           OR meter_id = ANY ((SELECT solar.linked_meter_ids())::uuid[]));
CREATE POLICY meter_channels_insert ON solar.meter_channels FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_channels_update ON solar.meter_channels FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_channels_delete ON solar.meter_channels FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_channels_insert_authz ON solar.meter_channels AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_channels_update_authz ON solar.meter_channels AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_channels_delete_authz ON solar.meter_channels AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));

CREATE POLICY meter_import_reports_select ON solar.meter_import_reports FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_import_reports_insert ON solar.meter_import_reports FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_import_reports_update ON solar.meter_import_reports FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY meter_import_reports_insert_authz ON solar.meter_import_reports AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));
CREATE POLICY meter_import_reports_update_authz ON solar.meter_import_reports AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))::uuid[]));

-- Readings: read-only for users; writes go through solar.write_readings.
CREATE POLICY meter_readings_select ON solar.meter_readings FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[])
           OR channel_id = ANY ((SELECT solar.linked_channel_ids())::uuid[]));

-- Study-scoped tables: the solar.studies (00207) shape.
CREATE POLICY study_meters_select ON solar.study_meters FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY study_meters_insert ON solar.study_meters FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY study_meters_delete ON solar.study_meters FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY study_meters_insert_authz ON solar.study_meters AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY study_meters_delete_authz ON solar.study_meters AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY tenant_load_basis_select ON solar.tenant_load_basis FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY tenant_load_basis_insert ON solar.tenant_load_basis FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_update ON solar.tenant_load_basis FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_delete ON solar.tenant_load_basis FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_insert_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY tenant_load_basis_update_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY tenant_load_basis_delete_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY site_load_select ON solar.site_load FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY site_load_insert ON solar.site_load FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY site_load_update ON solar.site_load FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY site_load_delete ON solar.site_load FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY site_load_insert_authz ON solar.site_load AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY site_load_update_authz ON solar.site_load AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY site_load_delete_authz ON solar.site_load AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- Platform shapes: generic, not customer data; readable by any signed-in user, written by migrations.
CREATE POLICY load_archetypes_select ON solar.load_archetypes FOR SELECT TO authenticated USING (true);

-- ── 11. Storage: private raw-file bucket; read + insert only (raw files are never changed) ─
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('solar-meter-raw', 'solar-meter-raw', false, 52428800,
        ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY solar_meter_raw_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'solar-meter-raw' AND solar.raw_path_allowed(name, 'view'));
CREATE POLICY solar_meter_raw_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'solar-meter-raw' AND solar.raw_path_allowed(name, 'edit'));

-- ── 12. Table privileges (default privileges from 00207 granted too much to new tables) ─
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.meter_files, solar.meters, solar.meter_register, solar.meter_channels,
    solar.tenant_load_basis, solar.site_load TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.meter_series_hashes, solar.study_meters TO authenticated;
REVOKE UPDATE, TRUNCATE ON solar.meter_series_hashes, solar.study_meters FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.meter_import_reports TO authenticated;
REVOKE DELETE, TRUNCATE ON solar.meter_import_reports FROM authenticated;
GRANT SELECT ON solar.meter_readings, solar.load_archetypes TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.meter_readings, solar.load_archetypes FROM authenticated;
REVOKE ALL ON solar.meter_readings_p0, solar.meter_readings_p1, solar.meter_readings_p2, solar.meter_readings_p3,
    solar.meter_readings_p4, solar.meter_readings_p5, solar.meter_readings_p6, solar.meter_readings_p7 FROM authenticated, anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA solar TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA solar TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA solar TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA solar FROM anon;

NOTIFY pgrst, 'reload schema';
