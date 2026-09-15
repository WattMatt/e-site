-- assert-uhpa-deactivated-member.sql — subject A for migration 00197.
--
-- Run through scripts/db/dry-run-migration.sh, which wraps this file as
--   BEGIN; <migration>; <this file>; ROLLBACK;
-- so NOTHING here persists: the rbac-test fixture's KINGSWALK membership is
-- soft-deactivated inside the transaction, read as that user exactly as
-- PostgREST would (request.jwt.claims + SET LOCAL ROLE authenticated), and
-- rolled back with the rest.
--
-- Red/green: run it first against a no-op migration and watch the first four
-- rows fail — that is the leak. Against 00197 every row must be ok.
--
-- structure.nodes and projects.qc_reports are used because on production
-- user_has_project_access is their ONLY permissive SELECT gate (16 such
-- tables were measured on 2026-09-12). projects.rfis is NOT a clean probe for
-- this fixture: its "Org members can view" policy also admits any active
-- non-client-viewer member of the project's org, which the fixture is.

SELECT set_config('x.kw',      '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK
SELECT set_config('x.fixture', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);  -- rbac-test@e-site.live

-- Ground truth, captured as postgres BEFORE impersonation so every count
-- below is a diff against the real row count, not an absolute.
SELECT set_config('x.nodes_all',
  (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.qc_all',
  (SELECT count(*) FROM projects.qc_reports WHERE project_id = current_setting('x.kw')::uuid)::text, true);

-- The act under test: soft-deactivate, do not delete.
UPDATE projects.project_members
   SET is_active = false
 WHERE user_id    = current_setting('x.fixture')::uuid
   AND project_id = current_setting('x.kw')::uuid;

-- Guard: exactly one row flipped, or the probe proves nothing.
DO $$
BEGIN
  IF (SELECT count(*) FROM projects.project_members
       WHERE user_id = current_setting('x.fixture')::uuid
         AND project_id = current_setting('x.kw')::uuid
         AND NOT is_active) <> 1 THEN
    RAISE EXCEPTION 'fixture membership was not deactivated — probe is void';
  END IF;
END $$;

-- Impersonate as PostgREST does.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.fixture'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT * FROM (VALUES
  ('deactivated member: user_has_project_access(KINGSWALK) IS FALSE',
     public.user_has_project_access(current_setting('x.kw')::uuid) IS FALSE),
  ('deactivated member: user_effective_project_role(KINGSWALK) IS NULL (app gate, unchanged by 00197)',
     public.user_effective_project_role(current_setting('x.kw')::uuid) IS NULL),
  ('deactivated member: structure.nodes on KINGSWALK -> 0 of ' || current_setting('x.nodes_all'),
     (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid) = 0),
  ('deactivated member: projects.qc_reports on KINGSWALK -> 0 of ' || current_setting('x.qc_all'),
     (SELECT count(*) FROM projects.qc_reports WHERE project_id = current_setting('x.kw')::uuid) = 0),
  ('ground truth: KINGSWALK has nodes to hide (probe is not vacuous)',
     current_setting('x.nodes_all')::int > 0)
) AS t("check", ok);
