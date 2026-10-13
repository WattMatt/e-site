-- assert-floor-plan-zones-retired.sql — migration 00251 (retire tenants.floor_plan_zones).
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-floor-plan-zones-retired.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql scripts/db/assert-floor-plan-zones-retired.sql
-- Rolled back by the harness. The siblings below must SURVIVE: page scales still hang
-- off floor_plans through the same site-scope resolver.

SELECT * FROM (VALUES
  ('floor_plan_zones is gone',
     to_regclass('tenants.floor_plan_zones') IS NULL),
  ('no policy is left on floor_plan_zones',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenants' AND tablename = 'floor_plan_zones')),
  ('tenants.floor_plans survives',
     to_regclass('tenants.floor_plans') IS NOT NULL),
  ('floor_plan_page_scales keeps its site_scope policy',
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenants' AND tablename = 'floor_plan_page_scales'
              AND policyname = 'site_scope' AND permissive = 'RESTRICTIVE')),
  ('the floor_plan site-scope resolver survives',
     to_regprocedure('public.site_project_of_floor_plan(uuid)') IS NOT NULL)
) AS t("check", ok);
