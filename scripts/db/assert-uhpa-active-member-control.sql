-- assert-uhpa-active-member-control.sql — control for migration 00197.
--
-- The same fixture, membership left ACTIVE. Proves the fix narrows only what
-- it should: an active contractor's reads are unchanged before and after.
-- Rolled back by the harness; the fixture is read, never written.

SELECT set_config('x.kw',      '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK
SELECT set_config('x.fixture', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);  -- rbac-test@e-site.live

SELECT set_config('x.nodes_all',
  (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.qc_all',
  (SELECT count(*) FROM projects.qc_reports WHERE project_id = current_setting('x.kw')::uuid)::text, true);

-- Guard: the fixture IS an active member, or this is not a control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects.project_members
                  WHERE user_id = current_setting('x.fixture')::uuid
                    AND project_id = current_setting('x.kw')::uuid
                    AND is_active) THEN
    RAISE EXCEPTION 'rbac-test fixture is not an active KINGSWALK member — control is void';
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.fixture'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT * FROM (VALUES
  ('active member (control): user_has_project_access(KINGSWALK) IS TRUE',
     public.user_has_project_access(current_setting('x.kw')::uuid) IS TRUE),
  ('active member (control): user_effective_project_role(KINGSWALK) = contractor',
     public.user_effective_project_role(current_setting('x.kw')::uuid) = 'contractor'),
  ('active member (control): sees every KINGSWALK node (' || current_setting('x.nodes_all') || ')',
     (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid)
       = current_setting('x.nodes_all')::int),
  ('active member (control): sees every KINGSWALK qc_report (' || current_setting('x.qc_all') || ')',
     (SELECT count(*) FROM projects.qc_reports WHERE project_id = current_setting('x.kw')::uuid)
       = current_setting('x.qc_all')::int)
) AS t("check", ok);
