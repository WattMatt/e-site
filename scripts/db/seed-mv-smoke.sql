-- seed-mv-smoke.sql — LOCAL-ONLY seed for smoke-testing the MV protection module
-- (branch feat/mv-protection). Run against the LOCAL supabase db only:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/db/seed-mv-smoke.sql
-- Assumes the test auth user already exists (created via the admin API) with
-- id 9e8f0a00-0000-4000-8000-000000000001 (the handle_new_user trigger makes the profile).

BEGIN;

-- Fixed UUIDs so the smoke test is deterministic / re-runnable.
-- user: 9e8f0a00-0000-4000-8000-000000000001
INSERT INTO public.organisations (id, name, slug)
VALUES ('a0000000-0000-4000-8000-000000000001', 'Watson Mattheus (smoke)', 'wm-smoke')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_organisations (user_id, organisation_id, role, accepted_at)
VALUES ('9e8f0a00-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner', NOW())
ON CONFLICT (user_id, organisation_id) DO NOTHING;

INSERT INTO projects.projects (id, organisation_id, name, created_by)
VALUES ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'MV Smoke Test Mall', '9e8f0a00-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Cable revision (the MV study attaches to this)
INSERT INTO cable_schedule.revisions (id, project_id, organisation_id, code, status, created_by)
VALUES ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Rev 0', 'DRAFT', '9e8f0a00-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Network vertices: RMU (11 kV) -> mini-sub (transformer, 400 V side) -> main board
INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code, name, voltage_v, rating_kva)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'rmu',        'RMU-1', 'Council RMU 11 kV', 11000, NULL),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'mini_sub',   'MS-1',  'Mini-sub 1 MVA',      400, 1000),
  ('d0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'main_board', 'MB-1',  'Main board',          400, NULL)
ON CONFLICT (id) DO NOTHING;

-- Utility source feeding the RMU
INSERT INTO cable_schedule.sources (id, revision_id, organisation_id, code, type, rating_kva, voltage_v)
VALUES ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'ESKOM', 'UTILITY', NULL, 11000)
ON CONFLICT (id) DO NOTHING;

-- Edges: utility -> RMU (11 kV), RMU -> mini-sub (transformer edge), mini-sub -> main board (LV cable)
INSERT INTO cable_schedule.supplies (id, revision_id, organisation_id, from_source_id, from_node_id, to_node_id, voltage_v, design_load_a)
VALUES
  ('f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', NULL, 'd0000000-0000-4000-8000-000000000001', 11000, 100),
  ('f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NULL, 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 11000, 60),
  ('f0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NULL, 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 400, 800)
ON CONFLICT (id) DO NOTHING;

-- One LV cable on the mini-sub -> main board edge (185mm2 Cu XLPE-ish numbers)
INSERT INTO cable_schedule.cables (id, supply_id, revision_id, organisation_id, cable_no, size_mm2, cores, conductor, insulation, measured_length_m, measured_length_method, ohm_per_km, x_per_km)
VALUES ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1, 185, '4', 'CU', 'XLPE', 50, 'MANUAL', 0.127, 0.074)
ON CONFLICT (id) DO NOTHING;

-- Paywall: active per-user MV subscription with disclaimer accepted (so the
-- smoke user passes requireMvAccess). This is the local stand-in for a real
-- Paystack-driven grant.
INSERT INTO billing.user_mv_subscriptions (user_id, status, current_period_end, disclaimer_accepted_at)
VALUES ('9e8f0a00-0000-4000-8000-000000000001', 'active', NOW() + INTERVAL '1 year', NOW())
ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = NOW() + INTERVAL '1 year', disclaimer_accepted_at = NOW();

COMMIT;

-- Sanity readback
SELECT 'orgs' t, count(*) FROM public.organisations WHERE slug='wm-smoke'
UNION ALL SELECT 'revisions', count(*) FROM cable_schedule.revisions WHERE id='c0000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'nodes', count(*) FROM structure.nodes WHERE project_id='b0000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'supplies', count(*) FROM cable_schedule.supplies WHERE revision_id='c0000000-0000-4000-8000-000000000001'
UNION ALL SELECT 'mv_sub', count(*) FROM billing.user_mv_subscriptions WHERE user_id='9e8f0a00-0000-4000-8000-000000000001';
