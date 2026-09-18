-- assert-uhpa-org-admin-control.sql — clause (b) control for migration 00204.
--
-- 00204 touches clause (a) only. This proves clause (b) — the org-level
-- owner/admin/project_manager auto-pass that needs NO project_members row —
-- is untouched: an active admin of the project's organisation who holds no
-- KINGSWALK membership row still reads everything. The subject is resolved
-- at run time (no user id is checked in) and only read, never written.

SELECT set_config('x.kw', '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK

SELECT set_config('x.nodes_all',
  (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid)::text, true);

SELECT set_config('x.admin', COALESCE((
  SELECT uo.user_id::text
    FROM public.user_organisations uo
   WHERE uo.organisation_id = (SELECT organisation_id FROM projects.projects WHERE id = current_setting('x.kw')::uuid)
     AND uo.is_active
     AND uo.role IN ('owner', 'admin')
     AND NOT EXISTS (SELECT 1 FROM projects.project_members pm
                      WHERE pm.user_id = uo.user_id
                        AND pm.project_id = current_setting('x.kw')::uuid)
   ORDER BY uo.role, uo.user_id
   LIMIT 1), ''), true);

DO $$
BEGIN
  IF current_setting('x.admin') = '' THEN
    RAISE EXCEPTION 'no org owner/admin without a KINGSWALK membership row — clause (b) control is void';
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT * FROM (VALUES
  ('org admin without pm row (clause b control): user_has_project_access(KINGSWALK) IS TRUE',
     public.user_has_project_access(current_setting('x.kw')::uuid) IS TRUE),
  ('org admin without pm row (clause b control): effective role is owner/admin',
     public.user_effective_project_role(current_setting('x.kw')::uuid) IN ('owner', 'admin')),
  ('org admin without pm row (clause b control): sees every KINGSWALK node (' || current_setting('x.nodes_all') || ')',
     (SELECT count(*) FROM structure.nodes WHERE project_id = current_setting('x.kw')::uuid)
       = current_setting('x.nodes_all')::int)
) AS t("check", ok);
