-- ---------------------------------------------------------------------------
-- Migration 00242: load-profile source roles + Solar library meters as sources
-- ---------------------------------------------------------------------------
-- Number claimed at MERGE time: re-check the ledger, origin/main and every open
-- PR's migration filenames immediately before merging, and renumber if needed.
--
-- WHY (owner report 2026-10-05, "we haven't loaded the CSV files"):
--   1. A profile summed EVERY included source. A site's meters overlap — the bulk
--      meter already contains every tenant, a check meter duplicates a supply,
--      solar and generator meters measure supply — so loading a whole site
--      double-counted (as-is/10 §1.5: Yarona tenants = 2.3–2.8 × "bulk").
--      Each source now has a ROLE; the app sums Σ bulk (else Σ tenant) + Σ addition
--      and shows check / solar / generator without adding them
--      (@esite/shared/load-profile roles.ts).
--   2. The 42-site meter archive is loaded into the Solar ORG meter library (owner
--      decision), so a profile can now reference a library meter
--      (kind 'library_meter', solar_meter_id) instead of a copied file.
--
-- RULES
--   * 00230's constraint names are kept (its @verify block names
--     load_profile_sources_synthetic_shape): dropped and re-added in one ALTER.
--   * A library meter must belong to the profile's organisation: checked by the
--     existing bind trigger, which runs as the caller, so a meter the caller cannot
--     read through Solar's RLS is "not found" (a refusal, never a leak).
--   * No transaction control here: the runner wraps the file.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- column: projects.load_profile_sources.role
-- column: projects.load_profile_sources.solar_meter_id
-- constraint: load_profile_sources_role_check ON projects.load_profile_sources
-- constraint: load_profile_sources_library_shape ON projects.load_profile_sources
-- constraint: load_profile_sources_library_key ON projects.load_profile_sources
-- constraint: load_profile_sources_synthetic_shape ON projects.load_profile_sources
-- function: projects.load_profile_sources_bind_parents()
-- sql: (SELECT strpos(pg_get_constraintdef(c.oid), 'library_meter') > 0 FROM pg_constraint c WHERE c.conname = 'load_profile_sources_kind_check' AND c.conrelid = 'projects.load_profile_sources'::regclass)
-- sql: (SELECT count(*) = 0 FROM projects.load_profile_sources WHERE kind = 'admd' AND role <> 'addition')
-- behaviour: scripts/db/assert-load-profile-roles.sql, every row ok
-- @verify:end

ALTER TABLE projects.load_profile_sources
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'tenant',
    ADD COLUMN IF NOT EXISTS solar_meter_id UUID REFERENCES solar.meters(id) ON DELETE CASCADE;

ALTER TABLE projects.load_profile_sources
    ADD CONSTRAINT load_profile_sources_role_check
        CHECK (role IN ('bulk', 'tenant', 'addition', 'check', 'submain', 'solar', 'generator')),
    DROP CONSTRAINT load_profile_sources_kind_check,
    ADD CONSTRAINT load_profile_sources_kind_check
        CHECK (kind IN ('meter', 'tenant_schedule', 'admd', 'library_meter')),
    DROP CONSTRAINT load_profile_sources_synthetic_shape,
    ADD CONSTRAINT load_profile_sources_synthetic_shape CHECK (
        kind NOT IN ('tenant_schedule', 'admd') OR (
            params IS NOT NULL AND jsonb_typeof(params) = 'object'
            AND "values" IS NULL AND quality IS NULL AND kva_values IS NULL AND file_sha256 IS NULL
            AND solar_meter_id IS NULL)),
    ADD CONSTRAINT load_profile_sources_library_shape CHECK (
        (kind = 'library_meter') = (solar_meter_id IS NOT NULL)
        AND (kind <> 'library_meter' OR (
            "values" IS NULL AND quality IS NULL AND kva_values IS NULL AND file_sha256 IS NULL AND params IS NULL))),
    -- One reference per library meter per profile. NULLS DISTINCT (00221): non-library rows never collide.
    ADD CONSTRAINT load_profile_sources_library_key UNIQUE (profile_id, solar_meter_id);

CREATE INDEX IF NOT EXISTS load_profile_sources_solar_meter_idx ON projects.load_profile_sources (solar_meter_id) WHERE solar_meter_id IS NOT NULL;

COMMENT ON COLUMN projects.load_profile_sources.role IS
'bulk | tenant | addition | check | submain | solar | generator. The profile is SUM(bulk) when any bulk source is included, else SUM(tenant), plus SUM(addition); check/submain/solar/generator are shown, never summed.';

-- An ADMD block is new load on top of whatever else is measured.
UPDATE projects.load_profile_sources SET role = 'addition' WHERE kind = 'admd';

-- Parents still derived from the profile; a library meter must be in the profile's organisation.
CREATE OR REPLACE FUNCTION projects.load_profile_sources_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_meter_org UUID;
BEGIN
  SELECT lp.project_id, lp.organisation_id
    INTO NEW.project_id, NEW.organisation_id
    FROM projects.load_profiles lp
   WHERE lp.id = NEW.profile_id;
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'load_profile_sources: profile % not found', NEW.profile_id USING ERRCODE = '23503';
  END IF;
  -- Checked when the meter reference is set or changed only: toggling `included` or `role` on an existing
  -- library source must not need Solar library access again.
  IF NEW.solar_meter_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.solar_meter_id IS DISTINCT FROM OLD.solar_meter_id) THEN
    SELECT m.organisation_id INTO v_meter_org FROM solar.meters m WHERE m.id = NEW.solar_meter_id;
    IF v_meter_org IS NULL OR v_meter_org <> NEW.organisation_id THEN
      RAISE EXCEPTION 'load_profile_sources: meter % is not in this organisation''s library', NEW.solar_meter_id USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION projects.load_profile_sources_bind_parents() FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.load_profile_sources_bind_parents() FROM anon;
