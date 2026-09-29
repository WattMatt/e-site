-- scripts/db/assert-whatsapp-actor-spike.sql
-- Proves the whatsapp_actor pattern inside a rolled-back transaction:
--   (1) postgres can CREATE ROLE and GRANT authenticated to it,
--   (2) a SECURITY DEFINER function owned by it is subject to RLS,
--   (3) set_config('request.jwt.claims') inside it makes auth.uid() the user,
--   (4) the work-item transition guard fires under that identity.
-- Run: scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-whatsapp-actor-spike.sql

CREATE ROLE whatsapp_actor_spike NOLOGIN NOINHERIT;
ALTER ROLE whatsapp_actor_spike INHERIT;
GRANT authenticated TO whatsapp_actor_spike;
GRANT whatsapp_actor_spike TO postgres;
CREATE SCHEMA wa_spike;
GRANT USAGE, CREATE ON SCHEMA wa_spike TO whatsapp_actor_spike;  -- ALTER OWNER needs CREATE on the schema

SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.pm_m', projects.resolve_project_pm(current_setting('x.mamaila')::uuid)::text, true);

DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.pm', true) IS NULL
     OR current_setting('x.pm_m', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition: KINGSWALK/MAMAILA or their PMs not resolvable';
  END IF;
END $$;

-- Item A on KINGSWALK: the contractor holds the ball, the PM signs off.
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA spike A',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid,
         'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid
  RETURNING id)
SELECT set_config('x.a', (SELECT id::text FROM ins), true);

-- Item B on MAMAILA: the contractor has no access at all.
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA spike B',
         current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid,
         'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.mamaila')::uuid
  RETURNING id)
SELECT set_config('x.b', (SELECT id::text FROM ins), true);

CREATE FUNCTION wa_spike.wa_spike_advance(p_user uuid, p_item uuid, p_to text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  UPDATE projects.work_items SET status = p_to WHERE id = p_item;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $fn$;
ALTER FUNCTION wa_spike.wa_spike_advance(uuid,uuid,text) OWNER TO whatsapp_actor_spike;

CREATE TEMP TABLE _r (k text PRIMARY KEY, v text);
INSERT INTO _r VALUES
  ('owner',       (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'wa_spike.wa_spike_advance(uuid,uuid,text)'::regprocedure)),
  ('b_by_c',      wa_spike.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.b')::uuid, 'answered')::text),
  ('a_close_by_c',wa_spike.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.a')::uuid, 'closed')::text),
  ('a_ans_by_c',  wa_spike.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.a')::uuid, 'answered')::text),
  ('a_close_by_pm',wa_spike.wa_spike_advance(current_setting('x.pm')::uuid, current_setting('x.a')::uuid, 'closed')::text);
INSERT INTO _r VALUES
  ('a_status', (SELECT status FROM projects.work_items WHERE id = current_setting('x.a')::uuid)),
  ('ev_actor', (SELECT string_agg(coalesce(actor_id::text,'NULL') || ':' || verb, ',' ORDER BY seq)
                  FROM projects.work_item_events WHERE work_item_id = current_setting('x.a')::uuid));

SELECT * FROM (VALUES
  ('function is owned by the spike role',               (SELECT v FROM _r WHERE k='owner') = 'whatsapp_actor_spike'),
  ('RLS applies: contractor sees 0 rows of a MAMAILA item', (SELECT v FROM _r WHERE k='b_by_c') = '0'),
  ('guard applies: contractor cannot close (raises)',   (SELECT v FROM _r WHERE k='a_close_by_c') = '-1'),
  ('holder may move open -> answered',                  (SELECT v FROM _r WHERE k='a_ans_by_c') = '1'),
  ('gatekeeper may close',                              (SELECT v FROM _r WHERE k='a_close_by_pm') = '1'),
  ('final status is closed',                            (SELECT v FROM _r WHERE k='a_status') = 'closed'),
  ('events carry the acting user, not NULL',            (SELECT v FROM _r WHERE k='ev_actor')
                                                           LIKE '%' || current_setting('x.c') || ':status_changed%'
                                                       AND (SELECT v FROM _r WHERE k='ev_actor')
                                                           LIKE '%' || current_setting('x.pm') || ':closed%')
) AS t("check", ok);
