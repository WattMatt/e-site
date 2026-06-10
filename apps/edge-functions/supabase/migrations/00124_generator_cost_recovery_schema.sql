-- =============================================================================
-- Migration 00124 — generator cost-recovery schema (P2 data layer)
-- =============================================================================
-- Org+project-scoped tables feeding the @esite/shared generator-cost-recovery
-- engine, plus two tenant facets on structure.nodes. RLS mirrors structure.*:
-- SELECT via user_has_project_access(project_id); writes gated to the caller's
-- orgs and (consistent with the codebase) the org-membership check.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS gcr;

ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS shop_category TEXT
    CHECK (shop_category IN ('standard','fast_food','restaurant','national','other'));
ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS generator_participation TEXT NOT NULL DEFAULT 'shared'
    CHECK (generator_participation IN ('shared','own','none'));

CREATE TABLE IF NOT EXISTS gcr.settings (
  project_id       UUID PRIMARY KEY REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  standard_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  fast_food_kw_per_sqm  NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  restaurant_kw_per_sqm NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  national_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  capital_recovery_period_years   INTEGER NOT NULL DEFAULT 10,
  capital_recovery_rate_percent   NUMERIC(5,2) NOT NULL DEFAULT 12.00,
  rate_per_tenant_db    NUMERIC NOT NULL DEFAULT 0,
  num_main_boards       INTEGER NOT NULL DEFAULT 0,
  rate_per_main_board   NUMERIC NOT NULL DEFAULT 0,
  additional_cabling_cost NUMERIC NOT NULL DEFAULT 0,
  control_wiring_cost   NUMERIC NOT NULL DEFAULT 0,
  diesel_cost_per_litre NUMERIC NOT NULL DEFAULT 23.00,
  running_hours_per_month NUMERIC NOT NULL DEFAULT 100,
  maintenance_cost_annual NUMERIC NOT NULL DEFAULT 18800,
  power_factor          NUMERIC NOT NULL DEFAULT 0.95,
  running_load_percentage NUMERIC NOT NULL DEFAULT 75,
  maintenance_contingency_percent NUMERIC NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gcr.zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  zone_name       TEXT NOT NULL,
  zone_number     INTEGER NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, zone_number)
);

CREATE TABLE IF NOT EXISTS gcr.zone_generators (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id          UUID NOT NULL REFERENCES gcr.zones(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  generator_number INTEGER NOT NULL,
  generator_size   TEXT,
  generator_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
  UNIQUE (zone_id, generator_number)
);

CREATE TABLE IF NOT EXISTS gcr.tenant_assignments (
  node_id          UUID PRIMARY KEY REFERENCES structure.nodes(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  zone_id          UUID REFERENCES gcr.zones(id) ON DELETE SET NULL,
  manual_kw_override NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_zones_project ON gcr.zones(project_id);
CREATE INDEX IF NOT EXISTS idx_gcr_zone_generators_zone ON gcr.zone_generators(zone_id);
CREATE INDEX IF NOT EXISTS idx_gcr_tenant_assignments_project ON gcr.tenant_assignments(project_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','zones','zone_generators','tenant_assignments'] LOOP
    EXECUTE format('ALTER TABLE gcr.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS gcr_settings_select ON gcr.settings;
CREATE POLICY gcr_settings_select ON gcr.settings FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_settings_write ON gcr.settings;
CREATE POLICY gcr_settings_write ON gcr.settings FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS gcr_zones_select ON gcr.zones;
CREATE POLICY gcr_zones_select ON gcr.zones FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_zones_write ON gcr.zones;
CREATE POLICY gcr_zones_write ON gcr.zones FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS gcr_zone_generators_select ON gcr.zone_generators;
CREATE POLICY gcr_zone_generators_select ON gcr.zone_generators FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM gcr.zones z WHERE z.id = zone_id AND public.user_has_project_access(z.project_id)));
DROP POLICY IF EXISTS gcr_zone_generators_write ON gcr.zone_generators;
CREATE POLICY gcr_zone_generators_write ON gcr.zone_generators FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS gcr_tenant_assignments_select ON gcr.tenant_assignments;
CREATE POLICY gcr_tenant_assignments_select ON gcr.tenant_assignments FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_tenant_assignments_write ON gcr.tenant_assignments;
CREATE POLICY gcr_tenant_assignments_write ON gcr.tenant_assignments FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

NOTIFY pgrst, 'reload schema';
