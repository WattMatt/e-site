-- 00144_tenant_incomer_electrical.sql
-- Persisted, derived incoming-supply electrical sizing for tenant nodes.
--
-- Computed from the cable schedule (latest revision of any status):
--   incomer_load_a      = the incomer supply's design_load_a
--   incomer_capacity_a  = sum of the incomer cables' derated_current_rating_a
--   incomer_breaker_a   = design load rounded up to the next standard breaker
--   incomer_pole_config = TP/SP from the incomer cable cores
--   incomer_under_protected = breaker > capacity (SANS 10142-1 coordination)
--   incomer_multiple_feeds  = >1 supply feeds this node (max-load one chosen)
-- Manual breaker_rating_a / pole_config (boards) are kept separate and win on display.
--
-- Additive + nullable — safe to apply ahead of the consuming code.

ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS incomer_breaker_a        numeric,
  ADD COLUMN IF NOT EXISTS incomer_pole_config      text
    CHECK (incomer_pole_config IS NULL OR incomer_pole_config IN ('SP','TP')),
  ADD COLUMN IF NOT EXISTS incomer_load_a           numeric,
  ADD COLUMN IF NOT EXISTS incomer_capacity_a       numeric,
  ADD COLUMN IF NOT EXISTS incomer_under_protected  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incomer_multiple_feeds   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incomer_source_revision_id uuid
    REFERENCES cable_schedule.revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incomer_computed_at      timestamptz;

-- Expose new columns to the PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
