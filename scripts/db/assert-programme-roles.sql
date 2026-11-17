-- BEHAVIOURAL assertions for the programme schema (00261_programme_schema.sql,
-- number provisional), run as real roles against production inside one
-- rolled-back transaction.
--   Red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-programme-roles.sql
--   Green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00261_programme_schema.sql scripts/db/assert-programme-roles.sql
--
-- Fixtures are minted here (a fresh org, a contractor company org, auth users,
-- memberships, two projects, a Solar subscription and one Solar Edit grant);
-- WM-Consulting is NOT used (it bypasses the Solar paywall) and no production
-- user is read. Everything is rolled back.
--
-- Seeding happens as postgres BEFORE any impersonation; request.jwt.claims is
-- transaction-local and outlives RESET ROLE, so the claim is cleared before
-- any later postgres seeding and re-set before every impersonated call.
--
-- REFUSAL PATTERN: a refused call is run inside its own block; a call that is
-- wrongly ALLOWED raises P0001 itself, so its write rolls back and the row
-- reports "got P0001". Each refusal row passes only on the SQLSTATE the
-- design promises (42501 refused, 40001 stale, 22023 bad input, 23505
-- duplicate). Every read and every call is guarded, so with the schema absent
-- (the red run) the file still reports one failing row per check instead of
-- aborting.
--
-- Personas on project P (org O, Solar subscribed):
--   owner     org owner (no project row)            editor, cost
--   pm        org contractor, project project_manager editor, cost
--   orgpm     org project_manager, member of P only  editor on P, nothing on P2
--   offpm     org project_manager, NOT a member      nothing (00238 site scope)
--   con       contractor company (org C), project contractor, org-tagged code
--   insp      org inspector, project inspector, untagged
--   insp2     org inspector, project inspector, user-tagged code
--   client    client_viewer                          nothing
--   supplier  org C supplier, project supplier       reads; tagged but refused
--   nogrant   org contractor, project contractor, no Solar grant
--   solcon    org contractor, project contractor, Solar EDIT grant
--   lapsed    org membership INACTIVE, project row still active: nothing
--   stranger  an auth user with no membership       nothing

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

-- Guarded scalar read: the query runs as the CURRENT role (invoker), so under
-- SET LOCAL ROLE authenticated it is subject to RLS. -1 when it raises.
CREATE FUNCTION pg_temp.n(q text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE r bigint;
BEGIN
  EXECUTE q INTO r;
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $f$;

CREATE FUNCTION pg_temp.b(q text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE r boolean;
BEGIN
  EXECUTE q INTO r;
  RETURN coalesce(r, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $f$;

CREATE FUNCTION pg_temp.ver(p uuid) RETURNS timestamptz LANGUAGE plpgsql AS $f$
DECLARE r timestamptz;
BEGIN
  EXECUTE 'SELECT updated_at FROM programme.programmes WHERE id = $1' INTO r USING p;
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $f$;

-- Record a row; when it fails the observed value is appended for diagnosis.
CREATE FUNCTION pg_temp.r(k text, ok boolean, got text DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _r VALUES (k || CASE WHEN coalesce(ok, false) THEN '' ELSE ' [got ' || coalesce(got, 'NULL') || ']' END,
                         coalesce(ok, false));
$f$;

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_orgc     uuid := gen_random_uuid();   -- the contractor's own company
  v_p        uuid := gen_random_uuid();
  v_p2       uuid := gen_random_uuid();
  v_owner    uuid := gen_random_uuid();
  v_pm       uuid := gen_random_uuid();
  v_orgpm    uuid := gen_random_uuid();
  v_offpm    uuid := gen_random_uuid();
  v_con      uuid := gen_random_uuid();
  v_insp     uuid := gen_random_uuid();
  v_insp2    uuid := gen_random_uuid();
  v_client   uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_nogrant  uuid := gen_random_uuid();
  v_solcon   uuid := gen_random_uuid();
  v_lapsed   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_solview  uuid := gen_random_uuid();   -- Solar VIEW grant only
  u uuid; i int;
  v_users uuid[]; v_labels text[];
  v_prog uuid; v_prog2 uuid; v_mod uuid;
  v_ret jsonb; v_ver timestamptz; v_ver_after timestamptz; v_st text; v_n bigint; v_m bigint; v_int int;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_d1 uuid; v_d2 uuid; v_cv_org uuid; v_cv_user uuid;
  v_x2 uuid; v_h uuid; v_bare uuid; v_dh uuid;
  v_res uuid; v_asg uuid; v_period uuid;
  v_bl1 uuid; v_bl2 uuid; v_fu uuid; v_fu2 uuid;
  v_ms_start date; v_ms_finish date; v_ms_pct numeric;
  v_saves int := 0;          -- successful save_changes on v_prog
  v_mod_saves int := 0;      -- successful save_changes on v_mod
  v_e_prog bigint; v_e_act bigint; v_e_dep bigint; v_e_aud bigint;
  v_e_bact bigint; v_e_bcost bigint;
  v_txt text;
  v_ids uuid[];
  v_tb uuid; v_tf uuid; v_tc uuid; v_tw uuid; v_tp uuid; v_tpc uuid; v_wi uuid; v_mr uuid; v_masg uuid;
  v_fu3 uuid; v_fu4 uuid; v_fu5 uuid;
BEGIN
  -- ── 0. Fixtures (as postgres) ─────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES
    (v_org, 'programme-roles-probe'), (v_orgc, 'programme-roles-probe-contractor-co');
  FOREACH u IN ARRAY ARRAY[v_owner, v_pm, v_orgpm, v_offpm, v_con, v_insp, v_insp2, v_client, v_supplier,
                           v_nogrant, v_solcon, v_lapsed, v_stranger, v_solview] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'programme-roles-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_owner, v_org, 'owner', TRUE), (v_pm, v_org, 'contractor', TRUE),
    (v_orgpm, v_org, 'project_manager', TRUE), (v_offpm, v_org, 'project_manager', TRUE),
    (v_con, v_orgc, 'contractor', TRUE), (v_insp, v_org, 'inspector', TRUE), (v_insp2, v_org, 'inspector', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_supplier, v_orgc, 'supplier', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_solcon, v_org, 'contractor', TRUE),
    (v_lapsed, v_org, 'contractor', FALSE), (v_solview, v_org, 'contractor', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'programme-roles-probe', v_owner), (v_p2, v_org, 'programme-roles-probe-2', v_owner);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_pm, v_org, 'project_manager', TRUE), (v_p, v_orgpm, v_org, 'project_manager', TRUE),
    (v_p, v_con, v_orgc, 'contractor', TRUE), (v_p, v_insp, v_org, 'inspector', TRUE),
    (v_p, v_insp2, v_org, 'inspector', TRUE), (v_p, v_client, v_org, 'client_viewer', TRUE),
    (v_p, v_supplier, v_orgc, 'supplier', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_solcon, v_org, 'contractor', TRUE), (v_p, v_lapsed, v_org, 'contractor', TRUE),
    (v_p, v_solview, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');

  -- Premises, so no refusal below can pass for the wrong reason.
  PERFORM pg_temp.r('fixture_effective_roles_as_designed',
    public.user_effective_project_role(v_p, v_owner) = 'owner'
    AND public.user_effective_project_role(v_p, v_pm) = 'project_manager'
    AND public.user_effective_project_role(v_p, v_orgpm) = 'project_manager'
    AND public.user_effective_project_role(v_p2, v_orgpm) IS NULL
    AND public.user_effective_project_role(v_p, v_offpm) IS NULL
    AND public.user_effective_project_role(v_p, v_con) = 'contractor'
    AND public.user_effective_project_role(v_p, v_insp) = 'inspector'
    AND public.user_effective_project_role(v_p, v_client) = 'client_viewer'
    AND public.user_effective_project_role(v_p, v_supplier) = 'supplier'
    -- the lapsed member's project row is LIVE; only their org membership lapsed
    AND public.user_effective_project_role(v_p, v_lapsed) = 'contractor');

  -- The Solar Edit grant, written by the grantor (org owner) as 00208 requires.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p, v_solcon, 'edit'), (v_p, v_solview, 'view');
  RESET ROLE;

  -- ── 1. create_programme ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_prog := programme.create_programme(v_p, 'project', 'Probe programme', DATE '2026-03-02');
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  BEGIN
    v_prog2 := programme.create_programme(v_p2, 'project', 'Probe programme 2', DATE '2026-03-02');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    v_mod := programme.create_programme(v_p, 'module', 'Probe solar', DATE '2026-03-02', 'solar');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('owner_creates_project_programme', v_prog IS NOT NULL, v_st);
  PERFORM pg_temp.r('owner_creates_second_project_programme_on_p2', v_prog2 IS NOT NULL);
  PERFORM pg_temp.r('owner_creates_solar_module_programme', v_mod IS NOT NULL);
  PERFORM pg_temp.r('created_programme_has_two_calendars',
    pg_temp.n(format('SELECT count(*) FROM programme.calendars WHERE programme_id = %L', v_prog)) = 2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.create_programme(v_p, 'project', 'Again', DATE '2026-03-02');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('owner_second_project_programme_REFUSED_23505', v_st = '23505', v_st);

  v_users := ARRAY[v_con, v_client, v_offpm, v_lapsed, v_stranger, v_insp];
  v_labels := ARRAY['contractor', 'client_viewer', 'offsite_org_pm', 'lapsed_member', 'stranger', 'inspector'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL;
    BEGIN
      PERFORM programme.create_programme(v_p, 'contractor', 'Mine', DATE '2026-03-02', NULL, 'Probe Co ' || i);
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_create_REFUSED_42501', v_st = '42501', v_st);
  END LOOP;

  -- A member without a Solar grant cannot create the module programme (the
  -- permission check precedes the duplicate check).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.create_programme(v_p, 'module', 'Solar again', DATE '2026-03-02', 'solar');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('nogrant_create_module_REFUSED_42501', v_st = '42501', v_st);

  -- ── 2. save_changes (owner, project programme) ────────────────────────────
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_ret := programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'a1', 'fields', jsonb_build_object(
        'name', 'A1', 'type', 'task', 'original_duration', 5)),
      -- cache names in `fields` are silently ignored
      jsonb_build_object('op', 'upsert_activity', 'key', 'a2', 'fields', jsonb_build_object(
        'name', 'A2', 'type', 'task', 'original_duration', 3, 'early_start', '2001-01-01', 'is_critical', true)),
      jsonb_build_object('op', 'upsert_activity', 'key', 'a3', 'fields', jsonb_build_object(
        'name', 'A3', 'type', 'task', 'original_duration', 2, 'parent_id', 'a1')),
      jsonb_build_object('op', 'upsert_dependency', 'key', 'd1', 'pred', 'a1', 'succ', 'a2', 'type', 'FS'),
      jsonb_build_object('op', 'upsert_dependency', 'key', 'd2', 'pred', 'a2', 'succ', 'a3', 'type', 'FS'),
      jsonb_build_object('op', 'upsert_code_type', 'key', 'ct', 'name', 'Company'),
      jsonb_build_object('op', 'upsert_code_value', 'key', 'cvo', 'code_type', 'ct', 'value', 'Contractor Co',
                         'organisation_tag', v_orgc),
      jsonb_build_object('op', 'upsert_code_value', 'key', 'cvu', 'code_type', 'ct', 'value', 'Inspector two',
                         'user_tag', v_insp2),
      jsonb_build_object('op', 'set_activity_code', 'activity', 'a2', 'code_type', 'ct', 'code_value', 'cvo'),
      jsonb_build_object('op', 'set_activity_code', 'activity', 'a3', 'code_type', 'ct', 'code_value', 'cvu')),
      jsonb_build_object('project_finish', '2026-03-20', 'activities', jsonb_build_array(jsonb_build_object(
        'key', 'a1', 'early_start', '2026-03-02', 'early_finish', '2026-03-06', 'late_start', '2026-03-02',
        'late_finish', '2026-03-06', 'total_float', 0, 'free_float', 0, 'is_critical', true, 'is_driving', true))));
    v_saves := v_saves + 1;
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  v_a1 := (v_ret -> 'ids' ->> 'a1')::uuid; v_a2 := (v_ret -> 'ids' ->> 'a2')::uuid; v_a3 := (v_ret -> 'ids' ->> 'a3')::uuid;
  v_d1 := (v_ret -> 'ids' ->> 'd1')::uuid; v_d2 := (v_ret -> 'ids' ->> 'd2')::uuid;
  v_cv_org := (v_ret -> 'ids' ->> 'cvo')::uuid; v_cv_user := (v_ret -> 'ids' ->> 'cvu')::uuid;
  PERFORM pg_temp.r('save_inserts_3_activities_2_links_returns_ids',
    v_a1 IS NOT NULL AND v_a2 IS NOT NULL AND v_a3 IS NOT NULL AND v_d1 IS NOT NULL AND v_d2 IS NOT NULL
    AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L AND id IN (%L, %L, %L)', v_prog, v_a1, v_a2, v_a3)) = 3
    AND pg_temp.n(format('SELECT count(*) FROM programme.dependencies WHERE programme_id = %L AND id IN (%L, %L)', v_prog, v_d1, v_d2)) = 2,
    v_st);
  PERFORM pg_temp.r('save_returns_new_version_equal_to_row',
    (v_ret ->> 'version')::timestamptz > v_ver AND (v_ret ->> 'version')::timestamptz = pg_temp.ver(v_prog));
  PERFORM pg_temp.r('save_resolves_parent_key',
    pg_temp.b(format('SELECT parent_id = %L FROM programme.activities WHERE id = %L', v_a1, v_a3)));
  PERFORM pg_temp.r('save_writes_computed_cache',
    pg_temp.b(format($q$SELECT early_start = DATE '2026-03-02' AND early_finish = DATE '2026-03-06' AND is_critical AND is_driving
                         AND total_float = 0 FROM programme.activities WHERE id = %L$q$, v_a1))
    AND pg_temp.b(format($q$SELECT project_finish = DATE '2026-03-20' FROM programme.programmes WHERE id = %L$q$, v_prog)));
  PERFORM pg_temp.r('save_ignores_cache_names_in_fields',
    pg_temp.b(format('SELECT early_start IS NULL AND NOT is_critical FROM programme.activities WHERE id = %L', v_a2)));
  PERFORM pg_temp.r('save_stamps_created_by_owner',
    pg_temp.b(format('SELECT bool_and(created_by = %L) FROM programme.activities WHERE programme_id = %L', v_owner, v_prog)));

  -- Stale version: refused 40001 and nothing written.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_ver_after := pg_temp.ver(v_prog);
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 's', 'fields', jsonb_build_object('name', 'Stale', 'type', 'task'))), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('stale_version_REFUSED_40001', v_st = '40001', v_st);
  PERFORM pg_temp.r('stale_version_wrote_nothing',
    pg_temp.n(format($q$SELECT count(*) FROM programme.activities WHERE programme_id = %L AND name = 'Stale'$q$, v_prog)) = 0
    AND pg_temp.ver(v_prog) = v_ver_after);

  -- Unknown field name: refused 22023, nothing written.
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 't', 'fields', jsonb_build_object('name', 'Typo', 'type', 'task', 'nmae', 'x'))), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('unknown_field_REFUSED_22023', v_st = '22023', v_st);
  PERFORM pg_temp.r('unknown_field_wrote_nothing',
    pg_temp.n(format($q$SELECT count(*) FROM programme.activities WHERE programme_id = %L AND name = 'Typo'$q$, v_prog)) = 0);

  -- An activity on programme 2, then a cross-programme link from programme 1.
  v_ver := pg_temp.ver(v_prog2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_ret := programme.save_changes(v_prog2, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'x', 'fields', jsonb_build_object('name', 'X2', 'type', 'task'))), NULL);
    v_x2 := (v_ret -> 'ids' ->> 'x')::uuid;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_ver := pg_temp.ver(v_prog);
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_dependency', 'key', 'dx', 'pred', v_a1, 'succ', v_x2, 'type', 'FS')), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('fixture_activity_on_programme_2', v_x2 IS NOT NULL);
  PERFORM pg_temp.r('cross_programme_link_REFUSED_22023', v_st = '22023' AND v_x2 IS NOT NULL, v_st);

  -- Deleting a parent that still has a child: 22023.
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(jsonb_build_object('op', 'delete_activity', 'id', v_a1)), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('delete_parent_with_child_REFUSED_22023', v_st = '22023', v_st);

  -- Tombstone vs hard delete: H carries an import identity (history), B is bare.
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_ret := programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'h', 'fields', jsonb_build_object('name', 'H', 'type', 'task', 'external_uid', 'EXT-H')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'b', 'fields', jsonb_build_object('name', 'Bare', 'type', 'task')),
      -- TB: history = a baseline snapshot only (deleted after the baselines, section 5b)
      jsonb_build_object('op', 'upsert_activity', 'key', 'tb', 'fields', jsonb_build_object('name', 'TB baselined', 'type', 'task')),
      jsonb_build_object('op', 'upsert_dependency', 'key', 'dh', 'pred', v_a2, 'succ', 'h', 'type', 'FS')), NULL);
    v_saves := v_saves + 1;
    v_h := (v_ret -> 'ids' ->> 'h')::uuid; v_bare := (v_ret -> 'ids' ->> 'b')::uuid; v_dh := (v_ret -> 'ids' ->> 'dh')::uuid;
    v_tb := (v_ret -> 'ids' ->> 'tb')::uuid;
    v_ret := programme.save_changes(v_prog, (v_ret ->> 'version')::timestamptz, jsonb_build_array(
      jsonb_build_object('op', 'delete_activity', 'id', v_h),
      jsonb_build_object('op', 'delete_activity', 'id', v_bare)), NULL);
    v_saves := v_saves + 1;
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('delete_with_history_TOMBSTONES',
    v_h IS NOT NULL AND coalesce(v_ret -> 'tombstoned' @> to_jsonb(ARRAY[v_h]), false)
    AND pg_temp.b(format('SELECT is_tombstoned FROM programme.activities WHERE id = %L', v_h)), v_st);
  PERFORM pg_temp.r('delete_bare_HARD_DELETES',
    v_bare IS NOT NULL AND coalesce(v_ret -> 'deleted' @> to_jsonb(ARRAY[v_bare]), false)
    AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE id = %L', v_bare)) = 0);
  PERFORM pg_temp.r('tombstone_removes_its_links',
    v_dh IS NOT NULL AND pg_temp.n(format('SELECT count(*) FROM programme.dependencies WHERE id = %L', v_dh)) = 0);

  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'id', v_h, 'fields', jsonb_build_object('name', 'H revived'))), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('upsert_tombstoned_REFUSED_22023', v_st = '22023' AND v_h IS NOT NULL, v_st);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_dependency', 'key', 'dt', 'pred', v_a1, 'succ', v_h, 'type', 'FS')), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('link_to_tombstoned_REFUSED_22023', v_st = '22023' AND v_h IS NOT NULL, v_st);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'under_tomb', 'fields', jsonb_build_object('name', 'Under a removed parent', 'type', 'task', 'parent_id', v_h::text))), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('parent_tombstoned_REFUSED_22023', v_st = '22023 That activity was removed. Restore it first.' AND v_h IS NOT NULL, v_st);

  -- Direct DML: no table grant to clients, even the owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    EXECUTE format($q$INSERT INTO programme.activities (programme_id, name, type) VALUES (%L, 'Direct', 'task')$q$, v_prog);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('owner_direct_INSERT_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    EXECUTE format($q$UPDATE programme.activities SET name = 'Direct' WHERE id = %L$q$, v_a1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('owner_direct_UPDATE_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    EXECUTE format('DELETE FROM programme.activities WHERE id = %L', v_a1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('owner_direct_DELETE_REFUSED_42501', v_st = '42501', v_st);
  RESET ROLE;

  -- Editors and non-editors of the project programme.
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orgpm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'o', 'fields', jsonb_build_object('name', 'By org PM', 'type', 'task'))), NULL);
    v_saves := v_saves + 1;
    v_st := 'ok';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('orgpm_member_of_p_saves_on_p', v_st = 'ok', v_st);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orgpm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog2, pg_temp.ver(v_prog2), '[]'::jsonb, NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('orgpm_not_member_of_p2_save_REFUSED_42501', v_st = '42501', v_st);

  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'id', v_a1, 'fields', jsonb_build_object('code', 'A-001'))), NULL);
    v_saves := v_saves + 1;
    v_st := 'ok';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('project_pm_saves', v_st = 'ok', v_st);

  v_users := ARRAY[v_con, v_insp, v_supplier, v_client, v_offpm, v_lapsed, v_stranger, v_solcon];
  v_labels := ARRAY['contractor', 'inspector', 'supplier', 'client_viewer', 'offsite_org_pm', 'lapsed_member', 'stranger', 'solar_edit_contractor'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    v_ver := pg_temp.ver(v_prog);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL;
    BEGIN
      PERFORM programme.save_changes(v_prog, v_ver, jsonb_build_array(
        jsonb_build_object('op', 'upsert_activity', 'key', 'z', 'fields', jsonb_build_object('name', 'Not allowed', 'type', 'task'))), NULL);
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_save_project_programme_REFUSED_42501', v_st = '42501', v_st);
  END LOOP;

  -- ── 3. Cost rows (seeded as postgres; no P2 write path creates them) ──────
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    INSERT INTO programme.resources (organisation_id, name, kind) VALUES (v_org, 'Electrician', 'labour') RETURNING id INTO v_res;
    INSERT INTO programme.resource_rates (resource_id, organisation_id, rate) VALUES (v_res, v_org, 450);
    INSERT INTO programme.resource_assignments (programme_id, activity_id, resource_id, units_per_day, budgeted_qty)
      VALUES (v_prog, v_a1, v_res, 2, 10) RETURNING id INTO v_asg;
    INSERT INTO programme.assignment_costs (assignment_id, budgeted_cost, actual_cost) VALUES (v_asg, 9000, 0);
    INSERT INTO programme.progress_periods (programme_id, data_date, percent_complete) VALUES (v_prog, DATE '2026-03-31', 10)
      RETURNING id INTO v_period;
    INSERT INTO programme.progress_period_costs (period_id, pv, ev, ac) VALUES (v_period, 100, 90, 95);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM pg_temp.r('fixture_cost_rows_seeded', v_asg IS NOT NULL AND v_period IS NOT NULL);

  -- ── 4. Baselines ──────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_bl1 := programme.save_baseline(v_prog, 'B1', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('baseline_saved_active',
    v_bl1 IS NOT NULL AND pg_temp.b(format('SELECT is_active FROM programme.baselines WHERE id = %L', v_bl1)));
  PERFORM pg_temp.r('baseline_snapshots_live_activities_only',
    pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE baseline_id = %L', v_bl1))
      = pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L AND NOT is_tombstoned', v_prog))
    AND pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE baseline_id = %L AND activity_id = %L', v_bl1, v_h)) = 0);
  PERFORM pg_temp.r('baseline_costs_summed_from_assignments',
    pg_temp.b(format('SELECT budgeted_cost = 9000 FROM programme.baseline_costs WHERE baseline_id = %L AND activity_id = %L', v_bl1, v_a1)));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_bl2 := programme.save_baseline(v_prog, 'B2', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('second_active_baseline_clears_the_first',
    v_bl2 IS NOT NULL
    AND pg_temp.b(format('SELECT is_active FROM programme.baselines WHERE id = %L', v_bl2))
    AND pg_temp.b(format('SELECT NOT is_active FROM programme.baselines WHERE id = %L', v_bl1))
    AND pg_temp.n(format('SELECT count(*) FROM programme.baselines WHERE programme_id = %L AND is_active', v_prog)) = 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_baseline(v_prog, 'Contractor baseline', true);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('contractor_save_baseline_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    PERFORM programme.set_active_baseline(v_bl1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('contractor_set_active_baseline_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    PERFORM programme.delete_baseline(v_bl1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('contractor_delete_baseline_REFUSED_42501', v_st = '42501', v_st);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.set_active_baseline(v_bl1);
    v_st := 'ok';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('owner_reactivates_baseline_1',
    v_st = 'ok' AND pg_temp.b(format('SELECT is_active FROM programme.baselines WHERE id = %L', v_bl1))
    AND pg_temp.n(format('SELECT count(*) FROM programme.baselines WHERE programme_id = %L AND is_active', v_prog)) = 1, v_st);

  -- ── 5. Field updates ──────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_fu := programme.submit_field_update(v_a2, DATE '2026-03-09', NULL, 40, 2, 'Started on site');
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('org_tagged_contractor_submits_reported',
    v_fu IS NOT NULL AND pg_temp.b(format($q$SELECT status = 'reported' AND author_id = %L AND reported_percent = 40
                                             FROM programme.field_updates WHERE id = %L$q$, v_con, v_fu)), v_st);
  PERFORM pg_temp.r('submitted_update_moves_no_activity_field',
    pg_temp.b(format('SELECT actual_start IS NULL AND percent_complete = 0 AND remaining_duration IS NULL FROM programme.activities WHERE id = %L', v_a2)));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp2::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_fu2 := programme.submit_field_update(v_a3, NULL, NULL, 10, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('user_tagged_inspector_submits', v_fu2 IS NOT NULL, v_st);

  v_users := ARRAY[v_insp, v_supplier, v_client, v_nogrant, v_stranger];
  v_labels := ARRAY['untagged_inspector', 'tagged_supplier', 'client_viewer', 'untagged_contractor', 'stranger'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL;
    BEGIN
      PERFORM programme.submit_field_update(v_a2, NULL, NULL, 50, NULL, 'Not mine');
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_field_update_REFUSED_42501', v_st = '42501', v_st);
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.decide_field_updates(v_prog, jsonb_build_array(jsonb_build_object('id', v_fu, 'status', 'applied')));
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('contractor_decide_REFUSED_42501', v_st = '42501', v_st);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_int := programme.decide_field_updates(v_prog, jsonb_build_array(jsonb_build_object('id', v_fu, 'status', 'applied')));
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('editor_decides_applied',
    v_int = 1 AND pg_temp.b(format($q$SELECT status = 'applied' AND decided_by = %L AND decided_at IS NOT NULL
                                     FROM programme.field_updates WHERE id = %L$q$, v_owner, v_fu)), v_st);
  PERFORM pg_temp.r('decided_update_moves_no_activity_field',
    pg_temp.b(format('SELECT actual_start IS NULL AND percent_complete = 0 FROM programme.activities WHERE id = %L', v_a2)));

  -- ── 5a. Editor arm: an editor reports on an UNTAGGED activity (A1) ──────
  v_users := ARRAY[v_owner, v_pm];
  v_labels := ARRAY['owner', 'pm'];
  FOR i IN 1..2 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL; v_fu3 := NULL;
    BEGIN
      v_fu3 := programme.submit_field_update(v_a1, NULL, NULL, 20, NULL, 'Editor report');
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_editor_submits_on_untagged_activity_reported',
      v_fu3 IS NOT NULL AND pg_temp.b(format($q$SELECT status = 'reported' AND author_id = %L
                                               FROM programme.field_updates WHERE id = %L$q$, v_users[i], v_fu3)), v_st);
  END LOOP;

  -- ── 5b. Tombstone: one activity per history arm, nothing else on it ─────
  -- TB (baseline snapshot) was created before the baselines. The rest are
  -- created now, AFTER the baselines, so the snapshot arm does not cover them.
  v_ver := pg_temp.ver(v_prog);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_ret := programme.save_changes(v_prog, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'tf', 'fields', jsonb_build_object('name', 'TF field update', 'type', 'task')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'tc', 'fields', jsonb_build_object('name', 'TC coded', 'type', 'task')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'tw', 'fields', jsonb_build_object('name', 'TW work item', 'type', 'task')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'tp', 'fields', jsonb_build_object('name', 'TP parent', 'type', 'summary')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'tpc', 'fields', jsonb_build_object(
        'name', 'TPC child', 'type', 'task', 'parent_id', 'tp', 'external_uid', 'EXT-PC')),
      jsonb_build_object('op', 'upsert_code_type', 'key', 'ct2', 'name', 'Area'),
      jsonb_build_object('op', 'upsert_code_value', 'key', 'cv2', 'code_type', 'ct2', 'value', 'Roof'),
      jsonb_build_object('op', 'set_activity_code', 'activity', 'tc', 'code_type', 'ct2', 'code_value', 'cv2')), NULL);
    v_saves := v_saves + 1;
    v_tf := (v_ret -> 'ids' ->> 'tf')::uuid; v_tc := (v_ret -> 'ids' ->> 'tc')::uuid; v_tw := (v_ret -> 'ids' ->> 'tw')::uuid;
    v_tp := (v_ret -> 'ids' ->> 'tp')::uuid; v_tpc := (v_ret -> 'ids' ->> 'tpc')::uuid;
    v_fu5 := programme.submit_field_update(v_tf, NULL, NULL, 5, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
    VALUES (v_org, v_p, 'task', 'manual', 'Programme probe task', 'open', v_owner, v_owner, DATE '2026-11-20', v_owner)
    RETURNING id INTO v_wi;
    EXECUTE format('UPDATE programme.activities SET work_item_id = %L WHERE id = %L', v_wi, v_tw);
  EXCEPTION WHEN OTHERS THEN v_st := coalesce(v_st, '') || ' wi: ' || SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM pg_temp.r('fixture_tombstone_arm_activities',
    v_tf IS NOT NULL AND v_tc IS NOT NULL AND v_tw IS NOT NULL AND v_tp IS NOT NULL AND v_tpc IS NOT NULL AND v_tb IS NOT NULL
    AND v_fu5 IS NOT NULL AND v_wi IS NOT NULL
    AND pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE activity_id IN (%L, %L, %L, %L, %L)',
                         v_tf, v_tc, v_tw, v_tp, v_tpc)) = 0
    AND pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE activity_id = %L', v_tb)) >= 1, v_st);

  -- The child goes first (its own arm is external_uid), then the parent.
  v_ids := ARRAY[v_tpc, v_tf, v_tc, v_tb, v_tw, v_tp];
  v_labels := ARRAY['external_uid_child', 'field_update', 'activity_code', 'baseline_snapshot', 'work_item', 'sub_activity'];
  FOR i IN 1..6 LOOP
    v_ver := pg_temp.ver(v_prog);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL; v_ret := NULL;
    BEGIN
      v_ret := programme.save_changes(v_prog, v_ver, jsonb_build_array(jsonb_build_object('op', 'delete_activity', 'id', v_ids[i])), NULL);
      v_saves := v_saves + 1;
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r('tombstone_arm_' || v_labels[i],
      v_ids[i] IS NOT NULL AND coalesce(v_ret -> 'tombstoned' @> to_jsonb(ARRAY[v_ids[i]]), false)
      AND pg_temp.b(format('SELECT is_tombstoned FROM programme.activities WHERE id = %L', v_ids[i])),
      coalesce(v_st, v_ret::text));
  END LOOP;
  PERFORM pg_temp.r('tombstone_keeps_history_rows',
    pg_temp.n(format('SELECT count(*) FROM programme.field_updates WHERE id = %L AND activity_id = %L', v_fu5, v_tf)) = 1
    AND pg_temp.n(format('SELECT count(*) FROM programme.activity_codes WHERE activity_id = %L', v_tc)) = 1
    AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE id = %L AND work_item_id = %L', v_tw, v_wi)) = 1
    AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE id = %L AND parent_id = %L', v_tpc, v_tp)) = 1);

  -- ── 6. The Solar module programme ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.r('fixture_solcon_has_solar_edit', public.solar_can_edit(v_p));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.r('fixture_nogrant_has_no_solar_view', NOT coalesce(public.solar_can_view(v_p), false));
  RESET ROLE;

  v_ver := pg_temp.ver(v_mod);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    v_ret := programme.save_changes(v_mod, v_ver, jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'ma', 'fields', jsonb_build_object(
        'name', 'Mount', 'type', 'task', 'original_duration', 10, 'percent_complete', 50, 'actual_start', '2026-03-03')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'mb', 'fields', jsonb_build_object(
        'name', 'Wire', 'type', 'task', 'original_duration', 30)),
      jsonb_build_object('op', 'upsert_activity', 'key', 'ms', 'fields', jsonb_build_object(
        'name', 'Solar summary', 'type', 'summary', 'original_duration', 40)),
      jsonb_build_object('op', 'upsert_activity', 'key', 'mm', 'fields', jsonb_build_object(
        'name', 'Commissioned', 'type', 'finish_milestone', 'original_duration', 0, 'percent_complete', 100)),
      jsonb_build_object('op', 'upsert_activity', 'key', 'me', 'fields', jsonb_build_object(
        'name', 'Imported then removed', 'type', 'task', 'original_duration', 100, 'percent_complete', 100, 'external_uid', 'EXT-E')),
      jsonb_build_object('op', 'upsert_activity', 'key', 'mr', 'fields', jsonb_build_object(
        'name', 'Resourced then removed', 'type', 'task', 'original_duration', 5))),
      jsonb_build_object('activities', jsonb_build_array(
        jsonb_build_object('key', 'ma', 'early_start', '2026-03-02', 'early_finish', '2026-03-13'),
        jsonb_build_object('key', 'mb', 'early_start', '2026-03-16', 'early_finish', '2026-04-24'),
        jsonb_build_object('key', 'ms', 'early_start', '2026-01-01', 'early_finish', '2027-01-01'),
        jsonb_build_object('key', 'mm', 'early_start', '2026-04-24', 'early_finish', '2026-04-24'),
        jsonb_build_object('key', 'me', 'early_start', '2025-01-01', 'early_finish', '2028-01-01'))));
    v_mod_saves := v_mod_saves + 1;
    v_mr := (v_ret -> 'ids' ->> 'mr')::uuid;
    v_ret := programme.save_changes(v_mod, (v_ret ->> 'version')::timestamptz, jsonb_build_array(
      jsonb_build_object('op', 'delete_activity', 'id', v_ret -> 'ids' ->> 'me')), NULL);
    v_mod_saves := v_mod_saves + 1;
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('solar_edit_contractor_saves_module_programme', v_mod_saves = 2, v_st);
  PERFORM pg_temp.r('module_delete_with_import_identity_tombstones',
    jsonb_array_length(coalesce(v_ret -> 'tombstoned', '[]'::jsonb)) = 1
    AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L AND is_tombstoned', v_mod)) = 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.r('solar_edit_contractor_reads_module_activities',
    pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L', v_mod)) = 6);
  RESET ROLE;

  -- Resource-assignment arm: a Solar editor (who cannot see rands) deletes an
  -- assigned activity; it is tombstoned and the cost rows survive.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    INSERT INTO programme.resource_assignments (programme_id, activity_id, resource_id, units_per_day, budgeted_qty)
      VALUES (v_mod, v_mr, v_res, 1, 5) RETURNING id INTO v_masg;
    INSERT INTO programme.assignment_costs (assignment_id, budgeted_cost, actual_cost) VALUES (v_masg, 2500, 0);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_ver := pg_temp.ver(v_mod);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL; v_ret := NULL;
  BEGIN
    v_ret := programme.save_changes(v_mod, v_ver, jsonb_build_array(jsonb_build_object('op', 'delete_activity', 'id', v_mr)), NULL);
    v_mod_saves := v_mod_saves + 1;
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.r('tombstone_arm_resource_assignment_by_solar_editor',
    v_masg IS NOT NULL AND coalesce(v_ret -> 'tombstoned' @> to_jsonb(ARRAY[v_mr]), false)
    AND pg_temp.b(format('SELECT is_tombstoned FROM programme.activities WHERE id = %L', v_mr)), coalesce(v_st, v_ret::text));
  PERFORM pg_temp.r('assigned_activity_delete_keeps_assignment_and_cost',
    v_masg IS NOT NULL
    AND pg_temp.n(format('SELECT count(*) FROM programme.resource_assignments WHERE id = %L', v_masg)) = 1
    AND pg_temp.n(format('SELECT count(*) FROM programme.assignment_costs WHERE assignment_id = %L AND budgeted_cost = 2500', v_masg)) = 1);

  -- Solar VIEW only: reads the module programme, edits nothing on it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solview::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.r('fixture_solview_view_not_edit',
    coalesce(public.solar_can_view(v_p), false) AND NOT coalesce(public.solar_can_edit(v_p), false));
  v_txt := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE id = %L', v_mod)) || '/'
        || pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L', v_mod));
  RESET ROLE;
  PERFORM pg_temp.r('solar_view_reads_module_rows', v_txt = '1/6', v_txt);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solview::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    PERFORM programme.save_changes(v_mod, pg_temp.ver(v_mod), jsonb_build_array(
      jsonb_build_object('op', 'upsert_activity', 'key', 'v', 'fields', jsonb_build_object('name', 'Viewer edit', 'type', 'task'))), NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('solar_view_save_module_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    PERFORM programme.save_baseline(v_mod, 'Viewer baseline', true);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('solar_view_save_baseline_module_REFUSED_42501', v_st = '42501', v_st);
  v_st := NULL;
  BEGIN
    PERFORM programme.create_programme(v_p, 'module', 'Viewer solar', DATE '2026-03-02', 'solar');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
  END;
  PERFORM pg_temp.r('solar_view_create_module_REFUSED_42501', v_st = '42501', v_st);
  RESET ROLE;

  v_users := ARRAY[v_nogrant, v_con, v_insp];
  v_labels := ARRAY['nogrant', 'contractor_without_solar', 'inspector_without_solar'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_n := pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L', v_mod));
    v_m := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE id = %L', v_mod));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_sees_0_module_rows', v_n = 0 AND v_m = 0, v_n || '/' || v_m);
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_st := NULL;
  BEGIN
    SELECT s.start, s.finish, s.percent_complete INTO v_ms_start, v_ms_finish, v_ms_pct
      FROM programme.module_summary(v_p, 'solar') s;
  EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  -- live non-summary activities: Mount (actual 03-03, 10 d, 50 %), Wire
  -- (03-16..04-24, 30 d, 0 %), Commissioned (04-24, 0 d, 100 %); the summary
  -- and the tombstoned 100 d activity are excluded. (50*10 + 0 + 0) / 40 = 12.5.
  PERFORM pg_temp.r('module_summary_for_solar_blind_member',
    v_ms_start = DATE '2026-03-03' AND v_ms_finish = DATE '2026-04-24' AND v_ms_pct = 12.5,
    coalesce(v_st, v_ms_start || ' ' || v_ms_finish || ' ' || v_ms_pct));

  v_users := ARRAY[v_client, v_stranger, v_offpm, v_lapsed];
  v_labels := ARRAY['client_viewer', 'stranger', 'offsite_org_pm', 'lapsed_member'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_st := NULL;
    BEGIN
      PERFORM * FROM programme.module_summary(v_p, 'solar');
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN v_st := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_module_summary_REFUSED_42501', v_st = '42501', v_st);
  END LOOP;

  -- ── 7. Reads on the project programme ─────────────────────────────────────
  v_e_prog := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE id = %L', v_prog));
  v_e_act  := pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L', v_prog));
  v_e_dep  := pg_temp.n(format('SELECT count(*) FROM programme.dependencies WHERE programme_id = %L', v_prog));
  v_e_aud  := pg_temp.n(format('SELECT count(*) FROM programme.audit WHERE programme_id = %L', v_prog));
  PERFORM pg_temp.r('fixture_project_programme_has_rows',
    v_e_prog = 1 AND v_e_act >= 5 AND v_e_dep >= 2 AND v_e_aud >= 5,
    v_e_prog || '/' || v_e_act || '/' || v_e_dep || '/' || v_e_aud);

  v_users := ARRAY[v_owner, v_pm, v_orgpm, v_con, v_insp, v_supplier, v_nogrant, v_solcon];
  v_labels := ARRAY['owner', 'pm', 'orgpm', 'contractor', 'inspector', 'supplier', 'nogrant', 'solar_edit_contractor'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.dependencies WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.audit WHERE programme_id = %L', v_prog));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_reads_programme_activities_links_audit',
      v_txt = v_e_prog || '/' || v_e_act || '/' || v_e_dep || '/' || v_e_aud
      AND v_e_prog = 1 AND v_e_act > 0 AND v_e_dep > 0 AND v_e_aud > 0, v_txt);
  END LOOP;

  -- field_updates and baselines: the policy is can_read, so every reader
  -- (contractor and inspector included) sees ALL rows of the programme, not
  -- only their own.
  v_n := pg_temp.n(format('SELECT count(*) FROM programme.field_updates WHERE programme_id = %L', v_prog));
  v_m := pg_temp.n(format('SELECT count(*) FROM programme.baselines WHERE programme_id = %L', v_prog));
  PERFORM pg_temp.r('fixture_field_updates_and_baselines_exist', v_n = 5 AND v_m = 2, v_n || '/' || v_m);
  v_users := ARRAY[v_owner, v_pm, v_con, v_insp];
  v_labels := ARRAY['owner', 'pm', 'contractor', 'inspector'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := pg_temp.n(format('SELECT count(*) FROM programme.field_updates WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.baselines WHERE programme_id = %L', v_prog));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_reads_all_field_updates_and_baselines',
      v_txt = v_n || '/' || v_m AND v_n > 0 AND v_m > 0, v_txt);
  END LOOP;

  v_users := ARRAY[v_client, v_offpm, v_stranger, v_lapsed];
  v_labels := ARRAY['client_viewer', 'offsite_org_pm', 'stranger', 'lapsed_member'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE project_id = %L', v_p)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE project_id = %L', v_p)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.dependencies WHERE project_id = %L', v_p)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.audit WHERE project_id = %L', v_p)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.field_updates WHERE project_id = %L', v_p)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.baselines WHERE project_id = %L', v_p));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_reads_nothing', v_txt = '0/0/0/0/0/0', v_txt);
  END LOOP;

  -- The org PM who is a member of P only sees nothing of P2.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orgpm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := pg_temp.n(format('SELECT count(*) FROM programme.programmes WHERE project_id = %L', v_p2)) || '/'
        || pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE project_id = %L', v_p2));
  RESET ROLE;
  PERFORM pg_temp.r('orgpm_reads_nothing_on_p2',
    v_txt = '0/0' AND pg_temp.n(format('SELECT count(*) FROM programme.activities WHERE project_id = %L', v_p2)) >= 1, v_txt);

  -- ── 8. Cost: rands only for owner / admin / project_manager ───────────────
  v_e_bact  := pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE programme_id = %L', v_prog));
  v_e_bcost := pg_temp.n(format('SELECT count(*) FROM programme.baseline_costs WHERE programme_id = %L', v_prog));
  PERFORM pg_temp.r('fixture_cost_rows_exist', v_e_bact >= 1 AND v_e_bcost >= 1, v_e_bact || '/' || v_e_bcost);

  v_users := ARRAY[v_owner, v_pm, v_orgpm];
  v_labels := ARRAY['owner', 'pm', 'orgpm'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := pg_temp.n(format('SELECT count(*) FROM programme.assignment_costs WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.baseline_costs WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.progress_period_costs WHERE programme_id = %L', v_prog));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_sees_cost_rows', v_txt = '1/' || v_e_bcost || '/1', v_txt);
  END LOOP;

  v_users := ARRAY[v_con, v_insp, v_supplier, v_nogrant];
  v_labels := ARRAY['contractor', 'inspector', 'supplier', 'nogrant'];
  FOR i IN 1..array_length(v_users, 1) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_txt := pg_temp.n(format('SELECT count(*) FROM programme.assignment_costs WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.baseline_costs WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.progress_period_costs WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.resource_assignments WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.baseline_activities WHERE programme_id = %L', v_prog)) || '/'
          || pg_temp.n(format('SELECT count(*) FROM programme.progress_periods WHERE programme_id = %L', v_prog));
    RESET ROLE;
    PERFORM pg_temp.r(v_labels[i] || '_sees_no_cost_but_sees_assignments_and_baseline',
      v_txt = '0/0/0/1/' || v_e_bact || '/1', v_txt);
  END LOOP;

  -- Org library: an org member reads the resource; only cost roles read its rate.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := pg_temp.n(format('SELECT count(*) FROM programme.resources WHERE id = %L', v_res)) || '/'
        || pg_temp.n(format('SELECT count(*) FROM programme.resource_rates WHERE resource_id = %L', v_res));
  RESET ROLE;
  PERFORM pg_temp.r('owner_reads_resource_and_rate', v_txt = '1/1', v_txt);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := pg_temp.n(format('SELECT count(*) FROM programme.resources WHERE id = %L', v_res)) || '/'
        || pg_temp.n(format('SELECT count(*) FROM programme.resource_rates WHERE resource_id = %L', v_res));
  RESET ROLE;
  PERFORM pg_temp.r('org_contractor_reads_resource_not_rate', v_txt = '1/0', v_txt);

  -- ── 9. Audit: one row per successful write, attributed to the caller ──────
  PERFORM pg_temp.r('fixture_save_counters', v_saves = 12 AND v_mod_saves = 3, v_saves || '/' || v_mod_saves);
  v_txt := pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'programme.created' AND actor_id = %L$q$, v_prog, v_owner)) || '/'
        || pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'programme.saved'$q$, v_prog)) || '/'
        || pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'baseline.saved' AND actor_id = %L$q$, v_prog, v_owner)) || '/'
        || pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'baseline.activated' AND actor_id = %L$q$, v_prog, v_owner)) || '/'
        || pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'field_update.submitted'$q$, v_prog)) || '/'
        || pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'field_updates.decided' AND actor_id = %L$q$, v_prog, v_owner));
  PERFORM pg_temp.r('audit_rows_for_every_write_on_project_programme', v_txt = '1/' || v_saves || '/2/1/5/1', v_txt);
  PERFORM pg_temp.r('audit_save_actors_are_the_callers',
    pg_temp.n(format($q$SELECT count(DISTINCT actor_id) FROM programme.audit WHERE programme_id = %L AND verb = 'programme.saved'
                        AND actor_id IN (%L, %L, %L)$q$, v_prog, v_owner, v_orgpm, v_pm)) = 3
    AND pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'field_update.submitted'
                           AND actor_id IN (%L, %L, %L, %L)$q$, v_prog, v_con, v_insp2, v_owner, v_pm)) = 5);
  PERFORM pg_temp.r('audit_rows_for_module_and_p2',
    pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'programme.created'$q$, v_mod)) = 1
    AND pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L AND verb = 'programme.saved' AND actor_id = %L$q$, v_mod, v_solcon)) = v_mod_saves
    AND pg_temp.n(format($q$SELECT count(*) FROM programme.audit WHERE programme_id = %L$q$, v_prog2)) = 2);
  PERFORM pg_temp.r('audit_has_no_null_actor',
    pg_temp.n(format('SELECT count(*) FROM programme.audit WHERE project_id IN (%L, %L) AND actor_id IS NULL', v_p, v_p2)) = 0);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
