# Solar Phase 4b — Part 1: Schema (`00216_solar_cases.sql`) and behavioural assertions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-4b-0-index.md` first (worktree, conventions, decisions).

**Goal:** One migration that holds cases, immutable runs, the weather cache, the equipment catalogue and the two money tables, proven by impersonation assertions that go red before the migration and green after, and by four mutations that each turn a named assertion red.

**Architecture:** Every project-scoped table binds `study_id`/`project_id`/`organisation_id` in a SECURITY DEFINER BEFORE trigger (never trusted from the client), has exactly one PERMISSIVE SELECT policy, and one PERMISSIVE + one RESTRICTIVE policy **per write verb** (never a RESTRICTIVE `FOR ALL` — 00205). Runs are INSERT-only for users; only the service role may UPDATE, and only while `status='running'` (freeze trigger). Money tables read and write on `solar_can_see_money`. Org-library tables (equipment, weather) use 00211's `solar.library_orgs(level)`.

**Tech Stack:** Postgres 15 (Supabase), `scripts/db/dry-run-migration.sh` (Management API, rolled back), `scripts/verify-migration-applied.ts` grammar.

---

### Task 1: Write migration `00216_solar_cases.sql`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00216_solar_cases.sql`

- [ ] **Step 1: Re-check the number immediately before writing** (Task 0 Step 5 again; numbers move).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && git fetch origin && \
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -F '00216_' | sed "s|^|$r: |"; done
```
Expected: no output. Any output → STOP and ask for a number.

- [ ] **Step 2: Write the migration.** No `BEGIN`/`COMMIT` (the dry-run wraps it). No em dash inside any `sql:` payload.

```sql
-- ---------------------------------------------------------------------------
-- Migration 00216: Solar cases, stored runs, weather cache, equipment, case financials (Phase 4b)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §7, §8, §11; docs/solar/03-data-model-and-security.md
-- §3, §3.1, §3.2; decisions D-05, D-07, D-14, D-15, D-16, D-19 (docs/solar/06-open-decisions.md).
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-4b-1-schema.md
--
-- WHAT
--   * solar.cases               design options per study; config JSONB holds NO money.
--   * solar.case_runs           one row per Run: inputs snapshot, inputs_hash, engine_version,
--                               outputs, hourly CSV path. Users INSERT (always as 'running');
--                               only the service role UPDATEs, only while running; then frozen.
--   * solar.weather_datasets    PVGIS TMY cache per organisation at 0.01 deg (service-written).
--   * solar.equipment           modules / inverters / batteries. organisation_id NULL = platform
--                               catalogue (service-written). Never deleted: retired_at instead.
--   * solar.case_financials     money inputs per case (capex, opex, finance models, analysis).
--   * solar.case_run_financials immutable financial results on a succeeded run.
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
-- policy: case_run_financials_insert ON solar.case_run_financials PERMISSIVE
-- policy: case_run_financials_insert_authz ON solar.case_run_financials RESTRICTIVE
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
-- grant_absent: authenticated UPDATE ON solar.case_run_financials
-- grant_absent: authenticated DELETE ON solar.case_run_financials
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'solar' AND table_name = 'studies' AND column_name = 'selected_case_id')
-- sql: (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = 'solar.studies'::regclass AND conname = 'studies_selected_case_fk' AND confdeltype = 'a')
-- sql: (SELECT count(*) = 2 FROM storage.buckets WHERE id IN ('solar-runs', 'solar-weather') AND NOT public)
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'solar-(runs|weather)')
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('case_financials', 'case_run_financials') AND cmd = 'SELECT')
-- sql: (SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('case_financials', 'case_run_financials') AND permissive = 'RESTRICTIVE' AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'solar_can_see_money') > 0)
-- sql: (SELECT count(*) = 3 FROM solar.equipment WHERE organisation_id IS NULL AND make = 'Generic')
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
CREATE POLICY case_run_financials_insert ON solar.case_run_financials FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY case_run_financials_insert_authz ON solar.case_run_financials AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id));

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
GRANT SELECT, INSERT ON solar.case_runs, solar.case_run_financials TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON solar.case_runs, solar.case_run_financials FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.equipment TO authenticated;
REVOKE DELETE, TRUNCATE ON solar.equipment FROM authenticated;
GRANT SELECT ON solar.weather_datasets TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.weather_datasets FROM authenticated;
GRANT ALL ON solar.cases, solar.case_runs, solar.weather_datasets, solar.equipment,
    solar.case_financials, solar.case_run_financials TO service_role;
REVOKE ALL ON solar.cases, solar.case_runs, solar.weather_datasets, solar.equipment,
    solar.case_financials, solar.case_run_financials FROM anon;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Static sanity checks.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
M=apps/edge-functions/supabase/migrations/00216_solar_cases.sql
grep -nE '^\s*(BEGIN|COMMIT)\s*;' $M ; echo "begin/commit lines: $?"
grep -n '^-- sql:' $M | grep -n '—' ; echo "em dash in sql payload: $?"
grep -c 'SECURITY DEFINER' $M; grep -c 'FROM anon;' $M
```
Expected: `begin/commit lines: 1`, `em dash in sql payload: 1` (grep found nothing), 7 SECURITY DEFINER functions, and at least 7 `FROM anon;` function revokes (plus table revokes).

- [ ] **Step 4: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git add apps/edge-functions/supabase/migrations/00216_solar_cases.sql
git commit -m "feat(solar): 00216 cases, immutable runs, weather cache, equipment, case financials

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Behavioural assertions (write, then prove RED)

**Files:**
- Create: `scripts/db/assert-solar-cases-roles.sql`

- [ ] **Step 1: Write the assertion file.** Refusal pattern as 00208/00211: a `…_REFUSED` check catches ONLY the promised SQLSTATE; if the statement is wrongly allowed the block raises `P0001` so the write rolls back; any other error records `false`. All seeding happens as postgres before the first impersonation; `request.jwt.claims` is cleared before every later postgres step.

```sql
-- BEHAVIOURAL assertions for 00216_solar_cases (Solar Phase 4b), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00208..00211 concatenated> scripts/db/assert-solar-cases-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00208..00211 + 00216 concatenated> scripts/db/assert-solar-cases-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses
-- the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org (grantor)
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_money   UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_study   UUID;
  v_study2  UUID;
  v_w       UUID;
  v_w2      UUID;
  v_case    UUID;
  v_case2   UUID;
  v_run     UUID;
  v_run2    UUID;
  v_fin     UUID;
  v_eq      UUID;
  v_platform UUID;
  v_org_out UUID;
  v_proj_out UUID;
  v_status  TEXT;
  v_n       INT;
  v_b       BOOLEAN;
  u         UUID;
  v_hash CONSTANT TEXT := repeat('c', 64);
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-4b-probe'), (v_org2, 'solar-4b-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-4b-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-4b-probe-p', v_admin), (v_p2, v_org2, 'solar-4b-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE),
    (v_p, v_view, v_org, 'contractor', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -26.20, 28.05, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org2, 'pvgis_tmy', -26.20, 28.05, v_org2 || '/w2.csv.gz', v_hash) RETURNING id INTO v_w2;
  SELECT id INTO v_platform FROM solar.equipment WHERE organisation_id IS NULL AND kind = 'module' LIMIT 1;
  INSERT INTO _r VALUES ('platform_catalogue_seeded', v_platform IS NOT NULL);

  -- ── 1. Editor: cases ──────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.cases (study_id, project_id, organisation_id, name, config)
    VALUES (v_study, v_p2, v_org2, 'Base', '{"version":1}')
    RETURNING id, organisation_id, project_id INTO v_case, v_org_out, v_proj_out;
    INSERT INTO _r VALUES ('editor_creates_case_org_bound', v_org_out = v_org AND v_proj_out = v_p);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_case_org_bound', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, ' base ', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('duplicate_case_name_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('duplicate_case_name_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, pv_source, config) VALUES (v_study, 'Layout without id', 'layout', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('layout_pairing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_pairing_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.cases SET study_id = v_study2 WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('case_study_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('case_study_immutable_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Alt', '{}') RETURNING id INTO v_case2;
    INSERT INTO _r VALUES ('editor_creates_second_case', v_case2 IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_second_case', false);
  END;

  -- ── 2. Editor: runs ───────────────────────────────────────────────────────
  BEGIN
    INSERT INTO solar.case_runs (case_id, status, engine_version, inputs, inputs_hash, config_snapshot,
                                 weather_dataset_id, outputs, finished_at)
    VALUES (v_case, 'succeeded', '0.1.0', '{}', v_hash, '{}', v_w, '{"forged":true}', now())
    RETURNING id, status INTO v_run, v_status;
    INSERT INTO _r VALUES ('editor_run_born_running', v_status = 'running'
      AND (SELECT outputs IS NULL AND finished_at IS NULL FROM solar.case_runs WHERE id = v_run));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_run_born_running', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_running_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_running_run_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_weather_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_weather_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET status = 'failed', error = 'x' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_updates_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_updates_run_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.case_runs WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_deletes_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_deletes_run_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
    VALUES (v_org, 'pvgis_tmy', -25.00, 28.00, v_org || '/w9.csv.gz', v_hash);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_weather_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_weather_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('editor_reads_own_org_weather_only',
    (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w) = 1
    AND (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w2) = 0);
  INSERT INTO _r VALUES ('editor_reads_platform_catalogue',
    (SELECT count(*) FROM solar.equipment WHERE organisation_id IS NULL) >= 3);
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'battery', 'X', 'Y', '{"usableKwh":10,"powerKw":5,"rtePct":90}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_equipment_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_equipment_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 3. Service role finishes the run; then it is frozen ──────────────────
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE solar.case_runs SET inputs_hash = repeat('d', 64), status = 'failed', error = 'x' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('run_identity_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('run_identity_immutable_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{}}', hourly_path = 'p.csv.gz'
     WHERE id = v_run RETURNING finished_at IS NOT NULL INTO v_b;
    INSERT INTO _r VALUES ('service_finishes_run', coalesce(v_b, false));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_finishes_run', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET error = 'late edit' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('finished_run_frozen_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('finished_run_frozen_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run2;
    UPDATE solar.case_runs SET error = 'still running' WHERE id = v_run2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('update_must_finish_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('update_must_finish_REFUSED', false);
  END;
  -- the check_violation above rolled back v_run2's insert with its sub-block; make a running run on case 2 again
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run2;
  RESET ROLE;

  -- ── 4. Edit + financials: money tables ────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.case_financials (case_id, study_id, project_id, organisation_id, config)
    VALUES (v_case, v_study2, v_p2, v_org2, '{"version":1}') RETURNING organisation_id INTO v_org_out;
    INSERT INTO _r VALUES ('money_user_writes_financials_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_writes_financials_org_bound', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_financials', (SELECT count(*) FROM solar.case_financials WHERE case_id = v_case) = 1);
  BEGIN
    INSERT INTO solar.case_run_financials (case_run_id, engine_version, fin_inputs, fin_inputs_hash, tariff_ref, results)
    VALUES (v_run, '0.1.0', '{}', v_hash, '{"tariffId":"t"}', '{}') RETURNING id INTO v_fin;
    INSERT INTO _r VALUES ('money_user_records_run_financials', v_fin IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_records_run_financials', false);
  END;
  BEGIN
    INSERT INTO solar.case_run_financials (case_run_id, engine_version, fin_inputs, fin_inputs_hash, tariff_ref, results)
    VALUES (v_run2, '0.1.0', '{}', v_hash, '{"tariffId":"t"}', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('financials_on_unfinished_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('financials_on_unfinished_run_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_run_financials SET results = '{"x":1}' WHERE id = v_fin;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('run_financials_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('run_financials_immutable_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. Edit (no financials): sees and writes no money ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('editor_reads_no_money',
    (SELECT count(*) FROM solar.case_financials) = 0 AND (SELECT count(*) FROM solar.case_run_financials) = 0);
  BEGIN
    INSERT INTO solar.case_financials (case_id, config) VALUES (v_case2, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_money_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_money_REFUSED', false);
  END;
  UPDATE solar.case_financials SET config = '{"forged":true}' WHERE case_id = v_case;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_updates_money_noop', v_n = 0);

  -- ── 6. Selected case ─────────────────────────────────────────────────────
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case2 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('select_case_without_completed_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('select_case_without_completed_run_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study;
    INSERT INTO _r VALUES ('editor_selects_case', (SELECT selected_case_id = v_case FROM solar.studies WHERE id = v_study));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_selects_case', false);
  END;
  BEGIN
    DELETE FROM solar.cases WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('delete_selected_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('delete_selected_case_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.cases WHERE id = v_case2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('editor_deletes_unselected_case_cascading_runs', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_deletes_unselected_case_cascading_runs', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('cascade_removed_case2_runs', (SELECT count(*) FROM solar.case_runs WHERE id = v_run2) = 0);
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('select_foreign_study_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('select_foreign_study_case_REFUSED', false);
  END;

  -- ── 7. View user: reads, never writes, no money ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_case_and_run',
    (SELECT count(*) FROM solar.cases WHERE id = v_case) = 1 AND (SELECT count(*) FROM solar.case_runs WHERE id = v_run) = 1);
  INSERT INTO _r VALUES ('view_user_reads_no_money', (SELECT count(*) FROM solar.case_financials) = 0);
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'View attempt', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_creates_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_creates_case_REFUSED', false);
  END;
  UPDATE solar.cases SET name = 'Renamed by view' WHERE id = v_case;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_rename_noop', v_n = 0);
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_runs_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_runs_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 8. No grant / forged client grant / foreign admin: read nothing ──────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('outsider_reads_nothing_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 9. Equipment: org admin writes; retire, never delete; platform rows untouchable ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'module', 'Acme', 'M-600', '{"pmaxW":600,"gammaPmaxPctPerC":-0.34}') RETURNING id INTO v_eq;
    INSERT INTO _r VALUES ('admin_adds_equipment', v_eq IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_adds_equipment', false);
  END;
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'module', 'Acme', 'M-bad', '{"gammaPmaxPctPerC":-0.34}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('equipment_without_pmax_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('equipment_without_pmax_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.equipment SET retired_at = now() WHERE id = v_eq;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_retires_equipment', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_retires_equipment', false);
  END;
  BEGIN
    DELETE FROM solar.equipment WHERE id = v_eq;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('equipment_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('equipment_delete_REFUSED', false);
  END;
  UPDATE solar.equipment SET model = 'hijacked' WHERE id = v_platform;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_updates_platform_row_noop', v_n = 0);
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (NULL, 'battery', 'Fake', 'Platform', '{"usableKwh":10,"powerKw":5,"rtePct":90}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_writes_platform_row_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_writes_platform_row_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('foreign_admin_reads_platform_not_org_equipment',
    (SELECT count(*) FROM solar.equipment WHERE id = v_eq) = 0
    AND (SELECT count(*) FROM solar.equipment WHERE organisation_id IS NULL) >= 3);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_equipment', (SELECT count(*) FROM solar.equipment) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 10. Lapse: hidden but kept ────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day'
   WHERE organisation_id = v_org;
  FOREACH u IN ARRAY ARRAY[v_edit, v_admin] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('lapsed_reads_nothing_' || CASE u WHEN v_edit THEN 'editor' ELSE 'admin' END,
      (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Lapsed attempt', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_write_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_write_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept',
    (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 1);

  -- ── 11. Service role bypasses RLS ─────────────────────────────────────────
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_all',
    (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_run_financials WHERE project_id = v_p) = 1);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Build the RED bundle (base migrations only) and run it.** None of 00208–00211 is in the production ledger yet (head `00206`), so they are concatenated in front. If Task 0 Step 5 found `00214` on origin, append it after `00211` (both bundles).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b && mkdir -p $S
M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql > $S/base.sql
scripts/db/dry-run-migration.sh $S/base.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | tail -20
```
Expected: RED — the DO block errors with `relation "solar.weather_datasets" does not exist` (the first fixture that touches a 00216 object), i.e. no `ok` rows are green.

- [ ] **Step 3: Commit the assertions.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git add scripts/db/assert-solar-cases-roles.sql
git commit -m "test(solar): 00216 behavioural assertions (red against 00208..00211)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prove GREEN, then prove the assertions can fail (mutations)

**Files:** none committed (scratch bundles only).

- [ ] **Step 1: GREEN run.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b; M=apps/edge-functions/supabase/migrations
cat $S/base.sql $M/00216_solar_cases.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | tail -60
```
Expected: 54 rows, every `ok` = `true`. Any `false`: fix the MIGRATION (not the assertion) unless the assertion is demonstrably wrong; re-run.

- [ ] **Step 2: Mutation 1 — freeze trigger removed ⇒ frozen/identity checks go red.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b
perl -0pe 's/CREATE TRIGGER case_runs_freeze BEFORE UPDATE ON solar.case_runs\n    FOR EACH ROW EXECUTE FUNCTION solar.case_runs_freeze\(\);//' $S/green.sql > $S/m1.sql
diff -q $S/green.sql $S/m1.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m1.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | grep -E 'false' 
```
Expected: `finished_run_frozen_REFUSED`, `run_identity_immutable_REFUSED`, `update_must_finish_REFUSED` are `false`.

- [ ] **Step 3: Mutation 2 — money read on `solar_can_view` ⇒ editor sees money.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b
perl -0pe 's/(CREATE POLICY case_financials_select ON solar.case_financials FOR SELECT TO authenticated\n    USING \(public\.)solar_can_see_money/${1}solar_can_view/' $S/green.sql > $S/m2.sql
diff -q $S/green.sql $S/m2.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m2.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | grep -E 'false'
```
Expected: `editor_reads_no_money` and `view_user_reads_no_money` are `false`.

- [ ] **Step 4: Mutation 3 — restrictive insert gate removed ⇒ View creates cases.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b
perl -0pe 's/CREATE POLICY cases_insert_authz ON solar.cases AS RESTRICTIVE FOR INSERT TO authenticated\n    WITH CHECK \(public.solar_can_edit\(project_id\)\);//' $S/green.sql > $S/m3.sql
diff -q $S/green.sql $S/m3.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m3.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | grep -E 'false'
```
Expected: `view_user_creates_case_REFUSED` and `lapsed_write_REFUSED` are `false` (both pass the permissive `user_has_project_access` policy, which is all that is left).

- [ ] **Step 5: Mutation 4 — bind trigger stops forcing `running` ⇒ forged status survives.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
S=/private/tmp/claude-501/solar-4b
perl -0pe "s/    NEW.status      := 'running';\n//" $S/green.sql > $S/m4.sql
diff -q $S/green.sql $S/m4.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m4.sql scripts/db/assert-solar-cases-roles.sql 2>&1 | grep -E 'false|error' | head
```
Expected: `editor_run_born_running` is `false` (the forged `succeeded` row now violates `case_runs_success_has_outputs`… it has `outputs` NULLed and `hourly_path` NULL, so the INSERT itself fails with check_violation and the block records false).

- [ ] **Step 6: Record the mutation ledger** (paste into the PR body later): four mutations, each with the checks that went red. No commit.

---

### Task 4: Product-event registry + `@esite/db` guards

**Files:**
- Modify: `packages/shared/src/lib/analytics/product-events.ts:7-28`

- [ ] **Step 1: Run the contract test to see it fail on the new CHECK values.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -15
```
Expected: FAIL — the CHECK (read from `00216`, the last migration that redefines it) contains `solar_case_created` … which `PRODUCT_EVENTS` lacks.

- [ ] **Step 2: Add the five events** to the end of the `PRODUCT_EVENTS` array (after `'solar_settings_saved',`):

```ts
  'solar_case_created',
  'solar_case_run',
  'solar_weather_fetched',
  'solar_financials_run',
  'solar_equipment_saved',
```

- [ ] **Step 3: Re-run; then run the repo-wide migration guards.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -15
pnpm --filter web test -- src/lib/migration-verify-block.contract.test.ts 2>&1 | tail -5
```
Expected: contract test PASS; `@esite/db` PASS (anon-EXECUTE guard sees every SECURITY DEFINER function revoked in the text; no RESTRICTIVE `FOR ALL`); `migration-verify-block.contract.test.ts` PASS — it parses every `@verify` block ≥ 00185 with `parseVerifyBlock` (unknown directive words and prose-only blocks are refused, and an em dash in a `sql:` payload is refused). The live verifier (`node --experimental-strip-types scripts/verify-migration-applied.ts --file 00216_solar_cases.sql`) needs the migration APPLIED and is run at apply time, not here.

- [ ] **Step 4: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git add packages/shared/src/lib/analytics/product-events.ts
git commit -m "feat(solar): register Phase 4b product events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
