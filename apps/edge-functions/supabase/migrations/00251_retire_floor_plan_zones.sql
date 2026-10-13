-- ---------------------------------------------------------------------------
-- Migration 00251: retire tenants.floor_plan_zones
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-13-tenant-plans-followups-design.md (section 4)
--
-- WHAT. tenants.floor_plan_zones was created in 00006 for "spatial snag
-- pinning". No UI ever wrote it. On 2026-10-13 production held 0 rows, and no
-- view, function or foreign key depended on it. Its 00009 SELECT policy and its
-- 00238 site_scope policy are dropped with the table.
--
-- DEPLOY ORDER. cloud-sync-project's isAnnotated() queried this table and
-- FAILS CLOSED on a query error. The function must be deployed WITHOUT that
-- lookup before this migration is applied, or every drawing reads as annotated
-- and auto-adopt stops for the whole platform (the same rule as 00249).
--
-- EARLIER @verify. 00238's block named "policy: site_scope ON
-- tenants.floor_plan_zones". That directive was removed in the same change;
-- the verify sweep proves every earlier block still holds after this drop.
--
-- STEP 0 refuses to run if the table holds any row: this retires an unused
-- table and must never drop data. DROP TABLE has no CASCADE, so an unexpected
-- dependent object also stops it.
-- ---------------------------------------------------------------------------
-- @verify:begin
-- sql: (SELECT to_regclass('tenants.floor_plan_zones') IS NULL)
-- sql: (SELECT to_regclass('tenants.floor_plan_page_scales') IS NOT NULL)
-- @verify:end

-- Step 0: refuse to drop data.
DO $$
BEGIN
  IF to_regclass('tenants.floor_plan_zones') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM tenants.floor_plan_zones) THEN
      RAISE EXCEPTION '00251: tenants.floor_plan_zones holds rows; refusing to drop data';
    END IF;
  END IF;
END
$$;

-- Step 1: drop the table (its policies go with it).
DROP TABLE IF EXISTS tenants.floor_plan_zones;

NOTIFY pgrst, 'reload schema';
