-- Assertions for migration 00205 (tenants.floor_plan_markups).
--
-- Run RED first against a no-op so every line below has been seen to fail:
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-floor-plan-markups.sql
-- then green against the migration. A check never seen failing is decorative.
--
-- The behavioural half matters more than the structural half. Anyone can read a
-- CREATE TABLE; what has to be TRUE is that the bind trigger OVERRIDES a
-- client-supplied organisation_id — the hole 00200 had to close on the sibling
-- table — and that the write gate is RESTRICTIVE rather than a membership test
-- wearing an authorisation costume (the 00051 shape).

CREATE TEMP TABLE _probe (k text, v boolean) ON COMMIT DROP;

DO $$
DECLARE
  v_plan       UUID;
  v_org        UUID;
  v_proj       UUID;
  v_markup     UUID;
  v_wrote_org  UUID;
  v_wrote_proj UUID;
BEGIN
  SELECT fp.id, fp.organisation_id, fp.project_id
    INTO v_plan, v_org, v_proj
    FROM tenants.floor_plans fp
   WHERE fp.project_id IS NOT NULL
   LIMIT 1;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'no floor plan to test against';
  END IF;

  -- Names a DELIBERATELY WRONG org and project. Both must be overwritten by the
  -- trigger. Seeding them correct would make the assertion invisible, which is
  -- the fixture question asked directly.
  INSERT INTO tenants.floor_plan_markups
        (floor_plan_id, organisation_id, project_id, name, scene, file_path)
  VALUES (v_plan,
          '00000000-0000-0000-0000-0000000000ff',
          '00000000-0000-0000-0000-0000000000fe',
          'dry-run probe',
          '{"version":1,"canvas":{"w":10,"h":10},"shapes":[{"id":"a","points":[1.5,-2.25]}]}'::jsonb,
          'probe/path.pdf')
  RETURNING id, organisation_id, project_id
       INTO v_markup, v_wrote_org, v_wrote_proj;

  INSERT INTO _probe VALUES
    ('bound_org',            v_wrote_org  = v_org),
    ('bound_proj',           v_wrote_proj = v_proj),
    ('ignored_supplied_org', v_wrote_org <> '00000000-0000-0000-0000-0000000000ff'),
    -- The owner's actual question, asked of the storage layer rather than the
    -- client: does a coordinate survive the round trip byte for byte?
    ('points_exact',
       (SELECT scene->'shapes'->0->'points' FROM tenants.floor_plan_markups WHERE id = v_markup)
         = '[1.5,-2.25]'::jsonb);

  -- A blank name must be refused. Recorded as a probe rather than asserted on
  -- pg_constraint alone, because a constraint that exists and does not bite is
  -- the thing being guarded against.
  BEGIN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES (v_plan, '   ', '{}'::jsonb, 'probe/blank.pdf');
    INSERT INTO _probe VALUES ('blank_name_refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _probe VALUES ('blank_name_refused', true);
  END;

  -- Two layers on one drawing may not share a name.
  BEGIN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES (v_plan, 'dry-run probe', '{"version":1}'::jsonb, 'probe/dup.pdf');
    INSERT INTO _probe VALUES ('duplicate_name_refused', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _probe VALUES ('duplicate_name_refused', true);
  END;

  -- A markup against a drawing that does not exist must not land.
  BEGIN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'orphan', '{"version":1}'::jsonb, 'probe/orphan.pdf');
    INSERT INTO _probe VALUES ('orphan_refused', false);
  EXCEPTION WHEN foreign_key_violation OR not_null_violation THEN
    INSERT INTO _probe VALUES ('orphan_refused', true);
  END;
END $$;

SELECT * FROM (VALUES
  ('table exists',
     to_regclass('tenants.floor_plan_markups') IS NOT NULL),
  ('RLS enabled and forced',
     (SELECT relrowsecurity AND relforcerowsecurity
        FROM pg_class WHERE oid = 'tenants.floor_plan_markups'::regclass)),
  -- 00206 split the FOR ALL pair into per-verb policies, because FOR ALL
  -- includes SELECT and a RESTRICTIVE policy narrows every verb it covers.
  ('every write verb carries a RESTRICTIVE gate',
     (SELECT count(*) = 3 FROM pg_policy
       WHERE polrelid = 'tenants.floor_plan_markups'::regclass
         AND polpermissive = false AND polcmd IN ('a','w','d'))),
  ('no RESTRICTIVE policy touches SELECT',
     (SELECT count(*) = 0 FROM pg_policy
       WHERE polrelid = 'tenants.floor_plan_markups'::regclass
         AND polpermissive = false AND polcmd NOT IN ('a','w','d'))),
  ('exactly one policy covers SELECT',
     (SELECT count(*) = 1 FROM pg_policy
       WHERE polrelid = 'tenants.floor_plan_markups'::regclass
         AND polcmd IN ('r','*'))),
  ('the write gates name every MARKUP_WRITE_ROLE and no other',
     (SELECT bool_and(
               COALESCE(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) LIKE '%owner%'
           AND COALESCE(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) LIKE '%project_manager%'
           AND COALESCE(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) LIKE '%contractor%'
           AND COALESCE(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) NOT LIKE '%inspector%')
        FROM pg_policy WHERE polrelid = 'tenants.floor_plan_markups'::regclass
          AND polpermissive = false)),
  ('read policy excludes client_viewer',
     (SELECT pg_get_expr(polqual, polrelid) LIKE '%client_viewer%'
        FROM pg_policy WHERE polname = 'floor_plan_markups_select')),
  ('bind trigger exists on the table',
     (SELECT count(*) = 1 FROM pg_trigger
       WHERE tgname = 'floor_plan_markups_bind_parents' AND NOT tgisinternal)),
  ('anon holds no EXECUTE on the bind function',
     NOT has_function_privilege('anon', 'tenants.floor_plan_markups_bind_parents()', 'EXECUTE')),
  ('anon cannot select the table',
     NOT has_table_privilege('anon', 'tenants.floor_plan_markups', 'SELECT')),
  ('authenticated may insert',
     has_table_privilege('authenticated', 'tenants.floor_plan_markups', 'INSERT')),
  ('trigger bound organisation_id from the drawing',
     (SELECT v FROM _probe WHERE k = 'bound_org')),
  ('trigger bound project_id from the drawing',
     (SELECT v FROM _probe WHERE k = 'bound_proj')),
  ('trigger DISCARDED the client-supplied org',
     (SELECT v FROM _probe WHERE k = 'ignored_supplied_org')),
  ('coordinates round-trip through JSONB unchanged',
     (SELECT v FROM _probe WHERE k = 'points_exact')),
  ('a blank name is actually refused',
     (SELECT v FROM _probe WHERE k = 'blank_name_refused')),
  ('a duplicate name on one drawing is actually refused',
     (SELECT v FROM _probe WHERE k = 'duplicate_name_refused')),
  ('a markup against a non-existent drawing is refused',
     (SELECT v FROM _probe WHERE k = 'orphan_refused'))
) AS t("check", ok);
