-- ---------------------------------------------------------------------------
-- Migration 00216: Solar cases, stored runs, weather cache, equipment, case financials (Phase 4b)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §7, §8, §11; docs/solar/03-data-model-and-security.md
-- §3, §3.1, §3.2; decisions D-05, D-07, D-14, D-15, D-16, D-19 (docs/solar/06-open-decisions.md).
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-4b-1-schema.md
--
-- WHAT
--   * solar.cases               design options per study; config JSONB holds NO money. Equipment
--                               snapshots in config are rebuilt from solar.equipment by cases_bind.
--   * solar.case_runs           one row per Run: inputs snapshot, inputs_hash, engine_version,
--                               outputs, hourly CSV path. Users INSERT (always as 'running');
--                               only the service role UPDATEs, only while running; then frozen.
--   * solar.weather_datasets    PVGIS TMY cache per organisation at 0.01 deg (service-written).
--   * solar.equipment           modules / inverters / batteries. organisation_id NULL = platform
--                               catalogue (service-written). Never deleted: retired_at instead.
--   * solar.case_financials     money inputs per case (capex, opex, finance models, analysis).
--   * solar.case_run_financials immutable financial results on a succeeded run. SERVICE-written:
--                               the gated server action inserts them after its edit_financials check.
--   * solar.studies.selected_case_id  the case reports/proposals use; must have a succeeded run.
--   * buckets solar-runs, solar-weather: private and SERVICE-ONLY (no authenticated policy).
--   * product_events: solar_case_created, solar_case_run, solar_weather_fetched,
--     solar_financials_run, solar_equipment_saved.
-- RULES
--   * Money tables: every verb on public.solar_can_see_money (03 §3.1).
--   * layout_id has no FK yet: solar.layouts is 00212 on feat/solar-phase-5; the Phase 5
--     integration merge adds it. pv_source='layout' is refused by the app until then.
--   * The 00208 schema-wide directives hold: FORCE RLS on every solar table, no RESTRICTIVE
--     read policy in schema solar, every SECURITY DEFINER function revoked from anon.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.cases
-- table: solar.case_runs
-- table: solar.weather_datasets
-- table: solar.equipment
-- table: solar.case_financials
-- table: solar.case_run_financials
-- constraint: cases_layout_pairing ON solar.cases
-- constraint: case_runs_finished_iff_terminal ON solar.case_runs
-- constraint: case_runs_success_has_outputs ON solar.case_runs
-- constraint: case_runs_failure_has_error ON solar.case_runs
-- constraint: equipment_specs_shape ON solar.equipment
-- index: cases_study_name_uniq ON solar.cases
-- index: case_runs_one_running ON solar.case_runs
-- index: weather_datasets_cache_key ON solar.weather_datasets
-- index: equipment_identity_uniq ON solar.equipment
-- function: solar.cases_bind()
-- function: solar.case_runs_bind()
-- function: solar.case_runs_freeze()
-- function: solar.case_financials_bind()
-- function: solar.case_run_financials_bind()
-- function: solar.equipment_bind()
-- function: solar.studies_selected_case_check()
-- trigger: cases_bind ON solar.cases
-- trigger: case_runs_bind ON solar.case_runs
-- trigger: case_runs_freeze ON solar.case_runs
-- trigger: case_financials_bind ON solar.case_financials
-- trigger: case_run_financials_bind ON solar.case_run_financials
-- trigger: equipment_bind ON solar.equipment
-- trigger: studies_selected_case_check ON solar.studies
-- policy: cases_select ON solar.cases PERMISSIVE
-- policy: cases_insert ON solar.cases PERMISSIVE
-- policy: cases_update ON solar.cases PERMISSIVE
-- policy: cases_delete ON solar.cases PERMISSIVE
-- policy: cases_insert_authz ON solar.cases RESTRICTIVE
-- policy: cases_update_authz ON solar.cases RESTRICTIVE
-- policy: cases_delete_authz ON solar.cases RESTRICTIVE
-- policy: case_runs_select ON solar.case_runs PERMISSIVE
-- policy: case_runs_insert ON solar.case_runs PERMISSIVE
-- policy: case_runs_insert_authz ON solar.case_runs RESTRICTIVE
-- policy: weather_datasets_select ON solar.weather_datasets PERMISSIVE
-- policy: equipment_select ON solar.equipment PERMISSIVE
-- policy: equipment_insert ON solar.equipment PERMISSIVE
-- policy: equipment_update ON solar.equipment PERMISSIVE
-- policy: equipment_insert_authz ON solar.equipment RESTRICTIVE
-- policy: equipment_update_authz ON solar.equipment RESTRICTIVE
-- policy: case_financials_select ON solar.case_financials PERMISSIVE
-- policy: case_financials_insert ON solar.case_financials PERMISSIVE
-- policy: case_financials_update ON solar.case_financials PERMISSIVE
-- policy: case_financials_delete ON solar.case_financials PERMISSIVE
-- policy: case_financials_insert_authz ON solar.case_financials RESTRICTIVE
-- policy: case_financials_update_authz ON solar.case_financials RESTRICTIVE
-- policy: case_financials_delete_authz ON solar.case_financials RESTRICTIVE
-- policy: case_run_financials_select ON solar.case_run_financials PERMISSIVE
-- grant_absent: anon SELECT ON solar.cases
-- grant_absent: anon SELECT ON solar.case_runs
-- grant_absent: anon SELECT ON solar.weather_datasets
-- grant_absent: anon SELECT ON solar.equipment
-- grant_absent: anon SELECT ON solar.case_financials
-- grant_absent: anon SELECT ON solar.case_run_financials
-- grant_absent: authenticated UPDATE ON solar.case_runs
-- grant_absent: authenticated DELETE ON solar.case_runs
-- grant_absent: authenticated INSERT ON solar.weather_datasets
-- grant_absent: authenticated UPDATE ON solar.weather_datasets
-- grant_absent: authenticated DELETE ON solar.weather_datasets
-- grant_absent: authenticated DELETE ON solar.equipment
-- grant_absent: authenticated INSERT ON solar.case_run_financials
-- grant_absent: authenticated UPDATE ON solar.case_run_financials
-- grant_absent: authenticated DELETE ON solar.case_run_financials
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'solar' AND table_name = 'studies' AND column_name = 'selected_case_id')
-- sql: (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = 'solar.studies'::regclass AND conname = 'studies_selected_case_fk' AND confdeltype = 'a')
-- sql: (SELECT count(*) = 2 FROM storage.buckets WHERE id IN ('solar-runs', 'solar-weather') AND NOT public)
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'solar-(runs|weather)')
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('case_financials', 'case_run_financials') AND cmd = 'SELECT')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'case_run_financials' AND cmd <> 'SELECT')
-- sql: (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('case_financials', 'case_run_financials') AND permissive = 'RESTRICTIVE' AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'solar_can_see_money') > 0)
-- sql: (SELECT count(*) = 3 FROM solar.equipment WHERE organisation_id IS NULL AND make = 'Generic' AND (kind, model) IN (('module', 'Mono PERC 550 W (typical values, not a datasheet)'), ('inverter', 'String inverter 100 kW (typical values, not a datasheet)'), ('battery', 'LFP 100 kWh / 50 kW (typical values, not a datasheet)')))
-- sql: (SELECT strpos(prosrc, 'jsonb_build_object(''equipmentId'', e.id') > 0 FROM pg_proc WHERE oid = 'solar.cases_bind()'::regprocedure)
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_case_created%' AND pg_get_constraintdef(oid) LIKE '%solar_case_run%' AND pg_get_constraintdef(oid) LIKE '%solar_weather_fetched%' AND pg_get_constraintdef(oid) LIKE '%solar_financials_run%' AND pg_get_constraintdef(oid) LIKE '%solar_equipment_saved%' AND pg_get_constraintdef(oid) LIKE '%solar_settings_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- behaviour: scripts/db/assert-solar-cases-roles.sql — every row ok
-- @verify:end

-- NO BEGIN/COMMIT: scripts/db/dry-run-migration.sh wraps this file in BEGIN … ROLLBACK.

-- ── 1. Weather cache (per organisation; service-written) ────────────────────
CREATE TABLE IF NOT EXISTS solar.weather_datasets (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id           UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    source                    TEXT NOT NULL CHECK (source IN ('pvgis_tmy', 'upload')),
    lat_round                 NUMERIC(6,2) NOT NULL CHECK (lat_round BETWEEN -90 AND 90),
    lng_round                 NUMERIC(6,2) NOT NULL CHECK (lng_round BETWEEN -180 AND 180),
    radiation_db              TEXT,
    elevation_m               NUMERIC(7,1),
    storage_path              TEXT NOT NULL UNIQUE,
    content_sha256            TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    gsa_pvout_kwh_per_kwp     NUMERIC(7,1) CHECK (gsa_pvout_kwh_per_kwp > 0),
    meta                      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
    fetched_by                UUID REFERENCES auth.users(id),
    fetched_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS weather_datasets_cache_key
    ON solar.weather_datasets (organisation_id, source, lat_round, lng_round) WHERE source = 'pvgis_tmy';

ALTER TABLE solar.weather_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.weather_datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY weather_datasets_select ON solar.weather_datasets FOR SELECT TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('view')));
-- No write policy and no write grant: written by the gated server route with the service client.

-- ── 2. Equipment catalogue (org library + platform rows) ───────────────────
CREATE TABLE IF NOT EXISTS solar.equipment (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID REFERENCES public.organisations(id) ON DELETE CASCADE,  -- NULL = platform
    kind             TEXT NOT NULL CHECK (kind IN ('module', 'inverter', 'battery')),
    make             TEXT NOT NULL CHECK (length(btrim(make)) BETWEEN 1 AND 120),
    model            TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 120),
    specs            JSONB NOT NULL CHECK (jsonb_typeof(specs) = 'object'),
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'seed')),
    retired_at       TIMESTAMPTZ,
    created_by       UUID REFERENCES auth.users(id),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT equipment_specs_shape CHECK (
        CASE kind
          WHEN 'module' THEN
               CASE WHEN jsonb_typeof(specs->'pmaxW') = 'number' THEN (specs->>'pmaxW')::numeric > 0 ELSE false END
           AND jsonb_typeof(specs->'gammaPmaxPctPerC') = 'number'
          WHEN 'inverter' THEN
               CASE WHEN jsonb_typeof(specs->'acKw') = 'number' THEN (specs->>'acKw')::numeric > 0 ELSE false END
           AND CASE WHEN jsonb_typeof(specs->'euroEfficiencyPct') = 'number'
                    THEN (specs->>'euroEfficiencyPct')::numeric BETWEEN 50 AND 100 ELSE false END
          WHEN 'battery' THEN
               CASE WHEN jsonb_typeof(specs->'usableKwh') = 'number' THEN (specs->>'usableKwh')::numeric > 0 ELSE false END
           AND CASE WHEN jsonb_typeof(specs->'powerKw') = 'number' THEN (specs->>'powerKw')::numeric > 0 ELSE false END
           AND CASE WHEN jsonb_typeof(specs->'rtePct') = 'number' THEN (specs->>'rtePct')::numeric BETWEEN 50 AND 100 ELSE false END
          ELSE false
        END)
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_identity_uniq ON solar.equipment
    (COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(btrim(make)), lower(btrim(model)));

CREATE OR REPLACE FUNCTION solar.equipment_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Platform rows (organisation_id NULL) are E-Site's: never written from a user session.
    IF auth.uid() IS NOT NULL AND (NEW.organisation_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.organisation_id IS NULL)) THEN
        RAISE EXCEPTION 'solar.equipment: the platform catalogue is maintained by E-Site' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.kind <> OLD.kind THEN
            RAISE EXCEPTION 'solar.equipment: organisation and kind are immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.equipment_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.equipment_bind() FROM anon;
CREATE TRIGGER equipment_bind BEFORE INSERT OR UPDATE ON solar.equipment
    FOR EACH ROW EXECUTE FUNCTION solar.equipment_bind();

ALTER TABLE solar.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.equipment FORCE ROW LEVEL SECURITY;
-- Read: the caller's library orgs, plus the platform rows for anyone who has a library at all.
CREATE POLICY equipment_select ON solar.equipment FOR SELECT TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('view'))
           OR (organisation_id IS NULL AND cardinality(solar.library_orgs('view')) > 0));
-- Write: the catalogue lives in /settings/solar, so owner/admin of the org ('admin' library level).
CREATE POLICY equipment_insert ON solar.equipment FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY (solar.library_orgs('view')));
CREATE POLICY equipment_update ON solar.equipment FOR UPDATE TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('view')))
    WITH CHECK (organisation_id = ANY (solar.library_orgs('view')));
CREATE POLICY equipment_insert_authz ON solar.equipment AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY (solar.library_orgs('admin')));
CREATE POLICY equipment_update_authz ON solar.equipment AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('admin')))
    WITH CHECK (organisation_id = ANY (solar.library_orgs('admin')));
-- No DELETE policy and no DELETE grant: retire, never delete (cases reference equipment).

-- Platform seed: typical values, NOT a datasheet (make 'Generic').
INSERT INTO solar.equipment (organisation_id, kind, make, model, specs, source)
SELECT NULL, v.kind, 'Generic', v.model, v.specs, 'seed'
  FROM (VALUES
    ('module', 'Mono PERC 550 W (typical values, not a datasheet)',
     '{"pmaxW":550,"vocV":49.6,"iscA":14.0,"vmpV":41.7,"impA":13.19,"gammaPmaxPctPerC":-0.35,"betaVocPctPerC":-0.27,"gammaVmpPctPerC":-0.35,"lengthMm":2278,"widthMm":1134,"bifacial":false}'::jsonb),
    ('inverter', 'String inverter 100 kW (typical values, not a datasheet)',
     '{"acKw":100,"euroEfficiencyPct":98.0,"mppts":10,"vDcMax":1100,"vMpptMin":200,"vMpptMax":1000,"iMpptMaxA":40}'::jsonb),
    ('battery', 'LFP 100 kWh / 50 kW (typical values, not a datasheet)',
     '{"usableKwh":100,"powerKw":50,"rtePct":90,"warrantyCycles":6000}'::jsonb)
  ) AS v(kind, model, specs)
 WHERE NOT EXISTS (SELECT 1 FROM solar.equipment e
                    WHERE e.organisation_id IS NULL AND e.kind = v.kind AND e.make = 'Generic' AND e.model = v.model);

-- ── 3. Cases ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.cases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    name             TEXT NOT NULL CONSTRAINT cases_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    pv_source        TEXT NOT NULL DEFAULT 'manual' CHECK (pv_source IN ('manual', 'layout')),
    layout_id        UUID,   -- FK to solar.layouts added by the Phase 5 integration merge (00212)
    config           JSONB NOT NULL CONSTRAINT cases_config_is_object CHECK (jsonb_typeof(config) = 'object'),
    config_version   INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    created_by       UUID REFERENCES auth.users(id),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cases_layout_pairing CHECK ((pv_source = 'layout') = (layout_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cases_study_name_uniq ON solar.cases (study_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS cases_project_idx ON solar.cases (project_id);

CREATE OR REPLACE FUNCTION solar.cases_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_kind TEXT;
    v_path TEXT[];
    v_snap JSONB;
    e      RECORD;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id <> OLD.study_id THEN
            RAISE EXCEPTION 'solar.cases: study_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    END IF;
    SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.studies s WHERE s.id = NEW.study_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.cases: study % not found', NEW.study_id USING ERRCODE = '23503';
    END IF;
    -- Equipment snapshots (pv.module, pv.inverter, battery.unit) are REBUILT from the catalogue row
    -- whenever they are written: a PATCH cannot carry its own temperature coefficient under a real
    -- equipmentId. The shape is moduleSnapshot / inverterSnapshot / batterySnapshot in
    -- packages/shared/src/solar/cases/equipment.ts (pinned by equipment-snapshot-sql.contract.test.ts).
    -- An unchanged snapshot is left alone, so a later catalogue edit or retirement never blocks a save.
    -- snapshot-rebuild:begin
    FOREACH v_kind IN ARRAY ARRAY['module', 'inverter', 'battery'] LOOP
        v_path := CASE v_kind WHEN 'battery' THEN ARRAY['battery', 'unit'] ELSE ARRAY['pv', v_kind] END;
        v_snap := NEW.config #> v_path;
        CONTINUE WHEN v_snap IS NULL OR jsonb_typeof(v_snap) = 'null';
        CONTINUE WHEN TG_OP = 'UPDATE' AND v_snap IS NOT DISTINCT FROM (OLD.config #> v_path);
        IF jsonb_typeof(v_snap) <> 'object'
           OR coalesce(v_snap->>'equipmentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'solar.cases: the % must name a catalogue item', v_kind USING ERRCODE = '23514';
        END IF;
        SELECT eq.id, eq.make, eq.model, eq.specs INTO e
          FROM solar.equipment eq
         WHERE eq.id = (v_snap->>'equipmentId')::uuid AND eq.kind = v_kind
           AND (eq.organisation_id IS NULL OR eq.organisation_id = NEW.organisation_id);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'solar.cases: the % is not in this organisation''s catalogue', v_kind USING ERRCODE = '23514';
        END IF;
        NEW.config := jsonb_set(NEW.config, v_path, CASE v_kind
            WHEN 'module' THEN jsonb_build_object('equipmentId', e.id, 'make', e.make, 'model', e.model,
                'pmaxW', e.specs->'pmaxW', 'gammaPmaxPctPerC', e.specs->'gammaPmaxPctPerC')
            WHEN 'inverter' THEN jsonb_build_object('equipmentId', e.id, 'make', e.make, 'model', e.model,
                'acKw', e.specs->'acKw', 'euroEfficiencyPct', e.specs->'euroEfficiencyPct')
            ELSE jsonb_build_object('equipmentId', e.id, 'make', e.make, 'model', e.model,
                'usableKwh', e.specs->'usableKwh', 'powerKw', e.specs->'powerKw', 'rtePct', e.specs->'rtePct')
        END);
    END LOOP;
    -- snapshot-rebuild:end
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.cases_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.cases_bind() FROM anon;
CREATE TRIGGER cases_bind BEFORE INSERT OR UPDATE ON solar.cases
    FOR EACH ROW EXECUTE FUNCTION solar.cases_bind();

ALTER TABLE solar.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.cases FORCE ROW LEVEL SECURITY;
CREATE POLICY cases_select ON solar.cases FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY cases_insert ON solar.cases FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY cases_update ON solar.cases FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY cases_delete ON solar.cases FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY cases_insert_authz ON solar.cases AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY cases_update_authz ON solar.cases AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY cases_delete_authz ON solar.cases AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 4. Selected case on the study ───────────────────────────────────────────
-- NO ACTION (not RESTRICT): deleting the whole study cascades its cases in the same statement and
-- the check runs at statement end, when the study row is gone. Deleting ONLY the selected case
-- fails with 23503, which the app words as "choose another selected case first".
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS selected_case_id UUID
    CONSTRAINT studies_selected_case_fk REFERENCES solar.cases(id) ON DELETE NO ACTION;

CREATE OR REPLACE FUNCTION solar.studies_selected_case_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.selected_case_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.selected_case_id IS DISTINCT FROM OLD.selected_case_id) THEN
        IF NOT EXISTS (SELECT 1 FROM solar.cases c WHERE c.id = NEW.selected_case_id AND c.study_id = NEW.id)
           OR NOT EXISTS (SELECT 1 FROM solar.case_runs r WHERE r.case_id = NEW.selected_case_id AND r.status = 'succeeded') THEN
            RAISE EXCEPTION 'solar.studies: the selected case must belong to this study and have a completed run'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.studies_selected_case_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_selected_case_check() FROM anon;

-- ── 5. Runs (immutable after finish) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.case_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id             UUID NOT NULL REFERENCES solar.cases(id) ON DELETE CASCADE,
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
    engine_version      TEXT NOT NULL CHECK (engine_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    inputs              JSONB NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
    inputs_hash         TEXT NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
    config_snapshot     JSONB NOT NULL CHECK (jsonb_typeof(config_snapshot) = 'object'),
    weather_dataset_id  UUID NOT NULL REFERENCES solar.weather_datasets(id),
    tariff_ref          JSONB,
    outputs             JSONB,
    hourly_path         TEXT,
    error               TEXT,
    run_by              UUID REFERENCES auth.users(id),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    CONSTRAINT case_runs_finished_iff_terminal CHECK ((status = 'running') = (finished_at IS NULL)),
    CONSTRAINT case_runs_success_has_outputs CHECK (status <> 'succeeded' OR (outputs IS NOT NULL AND hourly_path IS NOT NULL)),
    CONSTRAINT case_runs_failure_has_error CHECK (status <> 'failed' OR length(btrim(coalesce(error, ''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS case_runs_one_running ON solar.case_runs (case_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS case_runs_case_started_idx ON solar.case_runs (case_id, started_at DESC);

CREATE OR REPLACE FUNCTION solar.case_runs_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT c.study_id, c.project_id, c.organisation_id INTO NEW.study_id, NEW.project_id, NEW.organisation_id
      FROM solar.cases c WHERE c.id = NEW.case_id;
    IF NEW.study_id IS NULL THEN
        RAISE EXCEPTION 'solar.case_runs: case % not found', NEW.case_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.weather_datasets w
                    WHERE w.id = NEW.weather_dataset_id AND w.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.case_runs: the weather dataset belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    -- A run is always born running; only the service path finishes it (freeze trigger).
    NEW.status      := 'running';
    NEW.outputs     := NULL;
    NEW.hourly_path := NULL;
    NEW.error       := NULL;
    NEW.finished_at := NULL;
    NEW.started_at  := NOW();
    NEW.run_by      := COALESCE(auth.uid(), NEW.run_by);
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.case_runs_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.case_runs_bind() FROM anon;
CREATE TRIGGER case_runs_bind BEFORE INSERT ON solar.case_runs
    FOR EACH ROW EXECUTE FUNCTION solar.case_runs_bind();

CREATE OR REPLACE FUNCTION solar.case_runs_freeze()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF OLD.status <> 'running' THEN
        RAISE EXCEPTION 'solar.case_runs: a finished run is immutable' USING ERRCODE = '42501';
    END IF;
    IF (NEW.case_id, NEW.study_id, NEW.project_id, NEW.organisation_id, NEW.engine_version, NEW.inputs,
        NEW.inputs_hash, NEW.config_snapshot, NEW.weather_dataset_id, NEW.tariff_ref, NEW.run_by, NEW.started_at)
       IS DISTINCT FROM
       (OLD.case_id, OLD.study_id, OLD.project_id, OLD.organisation_id, OLD.engine_version, OLD.inputs,
        OLD.inputs_hash, OLD.config_snapshot, OLD.weather_dataset_id, OLD.tariff_ref, OLD.run_by, OLD.started_at) THEN
        RAISE EXCEPTION 'solar.case_runs: the identity of a run is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'running' THEN
        RAISE EXCEPTION 'solar.case_runs: an update must finish the run' USING ERRCODE = '23514';
    END IF;
    NEW.finished_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.case_runs_freeze() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.case_runs_freeze() FROM anon;
CREATE TRIGGER case_runs_freeze BEFORE UPDATE ON solar.case_runs
    FOR EACH ROW EXECUTE FUNCTION solar.case_runs_freeze();

ALTER TABLE solar.case_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.case_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY case_runs_select ON solar.case_runs FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY case_runs_insert ON solar.case_runs FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY case_runs_insert_authz ON solar.case_runs AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
-- No UPDATE / DELETE policy or grant for authenticated: finishing is service-only, runs are never deleted
-- by users (a case delete cascades them as the table owner).

-- The selected-case trigger reads case_runs, so it is created after the table exists.
CREATE TRIGGER studies_selected_case_check BEFORE INSERT OR UPDATE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_selected_case_check();

-- ── 6. Case financials (money) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.case_financials (
    case_id          UUID PRIMARY KEY REFERENCES solar.cases(id) ON DELETE CASCADE,
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    config           JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
    config_version   INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
    created_by       UUID REFERENCES auth.users(id),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION solar.case_financials_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.case_id <> OLD.case_id THEN
            RAISE EXCEPTION 'solar.case_financials: case_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    END IF;
    SELECT c.study_id, c.project_id, c.organisation_id INTO NEW.study_id, NEW.project_id, NEW.organisation_id
      FROM solar.cases c WHERE c.id = NEW.case_id;
    IF NEW.study_id IS NULL THEN
        RAISE EXCEPTION 'solar.case_financials: case % not found', NEW.case_id USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.case_financials_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.case_financials_bind() FROM anon;
CREATE TRIGGER case_financials_bind BEFORE INSERT OR UPDATE ON solar.case_financials
    FOR EACH ROW EXECUTE FUNCTION solar.case_financials_bind();

ALTER TABLE solar.case_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.case_financials FORCE ROW LEVEL SECURITY;
CREATE POLICY case_financials_select ON solar.case_financials FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
CREATE POLICY case_financials_insert ON solar.case_financials FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY case_financials_update ON solar.case_financials FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY case_financials_delete ON solar.case_financials FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY case_financials_insert_authz ON solar.case_financials AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY case_financials_update_authz ON solar.case_financials AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY case_financials_delete_authz ON solar.case_financials AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));

-- ── 7. Run financials (money; immutable) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.case_run_financials (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_run_id      UUID NOT NULL REFERENCES solar.case_runs(id) ON DELETE CASCADE,
    case_id          UUID NOT NULL REFERENCES solar.cases(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    engine_version   TEXT NOT NULL CHECK (engine_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    fin_inputs       JSONB NOT NULL CHECK (jsonb_typeof(fin_inputs) = 'object'),
    fin_inputs_hash  TEXT NOT NULL CHECK (fin_inputs_hash ~ '^[0-9a-f]{64}$'),
    tariff_ref       JSONB NOT NULL CHECK (jsonb_typeof(tariff_ref) = 'object'),
    results          JSONB NOT NULL CHECK (jsonb_typeof(results) = 'object'),
    run_by           UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS case_run_financials_case_idx ON solar.case_run_financials (case_id, created_at DESC);

CREATE OR REPLACE FUNCTION solar.case_run_financials_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT r.case_id, r.project_id, r.organisation_id, r.status
      INTO NEW.case_id, NEW.project_id, NEW.organisation_id, v_status
      FROM solar.case_runs r WHERE r.id = NEW.case_run_id;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'solar.case_run_financials: run % not found', NEW.case_run_id USING ERRCODE = '23503';
    END IF;
    IF v_status <> 'succeeded' THEN
        RAISE EXCEPTION 'solar.case_run_financials: financials need a completed run' USING ERRCODE = '23514';
    END IF;
    NEW.run_by := COALESCE(auth.uid(), NEW.run_by);
    NEW.created_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.case_run_financials_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.case_run_financials_bind() FROM anon;
CREATE TRIGGER case_run_financials_bind BEFORE INSERT ON solar.case_run_financials
    FOR EACH ROW EXECUTE FUNCTION solar.case_run_financials_bind();

ALTER TABLE solar.case_run_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.case_run_financials FORCE ROW LEVEL SECURITY;
CREATE POLICY case_run_financials_select ON solar.case_run_financials FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
-- No INSERT / UPDATE / DELETE policy or grant for authenticated: the result is computed on the server
-- and inserted by the service client AFTER the action's edit_financials gate (a user-session INSERT
-- would let a money user post any figures). run_by is supplied by that action (auth.uid() is NULL there).

-- ── 8. Storage: private, service-only buckets ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('solar-runs', 'solar-runs', false, 10485760, ARRAY['application/gzip']),
       ('solar-weather', 'solar-weather', false, 10485760, ARRAY['application/gzip'])
ON CONFLICT (id) DO NOTHING;
-- Deliberately NO storage.objects policy for either bucket: every read and write goes through a
-- gated server route/action using the service client; downloads are short-lived signed URLs.

-- ── 9. Product events (re-declared in full: 00209's list + Phase 4b) ────────
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved',
    'solar_case_created',
    'solar_case_run',
    'solar_weather_fetched',
    'solar_financials_run',
    'solar_equipment_saved'
));

-- ── 10. Table privileges (00208's default privileges granted too much) ──────
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.cases, solar.case_financials TO authenticated;
GRANT SELECT, INSERT ON solar.case_runs TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON solar.case_runs FROM authenticated;
GRANT SELECT ON solar.case_run_financials TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.case_run_financials FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.equipment TO authenticated;
REVOKE DELETE, TRUNCATE ON solar.equipment FROM authenticated;
GRANT SELECT ON solar.weather_datasets TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.weather_datasets FROM authenticated;
GRANT ALL ON solar.cases, solar.case_runs, solar.weather_datasets, solar.equipment,
    solar.case_financials, solar.case_run_financials TO service_role;
REVOKE ALL ON solar.cases, solar.case_runs, solar.weather_datasets, solar.equipment,
    solar.case_financials, solar.case_run_financials FROM anon;

NOTIFY pgrst, 'reload schema';
