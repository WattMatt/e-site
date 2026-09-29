-- scripts/db/assert-whatsapp-enqueue.sql
-- Outbox enqueue on ball moves, the due sweep, and the claim/receive helpers. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-enqueue.sql
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.today', ((now() AT TIME ZONE 'Africa/Johannesburg')::date)::text, true);

UPDATE projects.project_settings SET notify_whatsapp = true WHERE project_id = current_setting('x.kw')::uuid;
INSERT INTO whatsapp.phone_links (user_id, phone_e164, status, verified_at, consent_at, consent_text_version)
VALUES (current_setting('x.c')::uuid, '+27000000001', 'active', now(), now(), 'test');

-- 1. A PM assigns an item to C  -> one 'assigned' row for C.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.pm'), 'role', 'authenticated')::text, true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 1',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i1', (SELECT id::text FROM ins), true);

-- 2. C creates an item assigned to themselves -> nothing (no self-notification).
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 2',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.c')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i2', (SELECT id::text FROM ins), true);

-- 3. A service-path (no actor) creation -> nothing (backfills must never page people).
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 3',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i3', (SELECT id::text FROM ins), true);

-- Due-date fixtures (service path, so the guard lets us backdate).
UPDATE projects.work_items SET due_date = current_setting('x.today')::date + 1 WHERE id = current_setting('x.i1')::uuid;
UPDATE projects.work_items SET due_date = current_setting('x.today')::date - 1 WHERE id = current_setting('x.i2')::uuid;
UPDATE projects.work_items SET due_date = current_setting('x.today')::date - 2 WHERE id = current_setting('x.i3')::uuid;

CREATE TEMP TABLE _r (k text PRIMARY KEY, v text);
INSERT INTO _r VALUES
  ('sweep1', whatsapp.sweep_due(current_setting('x.today')::date)::text),
  ('sweep2', whatsapp.sweep_due(current_setting('x.today')::date)::text),
  ('rc_c',   whatsapp.receive_check(current_setting('x.c')::uuid,  current_setting('x.i1')::uuid)::text),
  ('rc_pm',  whatsapp.receive_check(current_setting('x.pm')::uuid, current_setting('x.i1')::uuid)::text);
INSERT INTO _r VALUES ('claim1', (SELECT count(*) FROM whatsapp.claim_outbox(50))::text);
INSERT INTO _r VALUES ('claim2', (SELECT count(*) FROM whatsapp.claim_outbox(50))::text);
SELECT whatsapp.enqueue_fold(current_setting('x.c')::uuid, current_setting('x.today')::date);
SELECT whatsapp.enqueue_fold(current_setting('x.c')::uuid, current_setting('x.today')::date);

SELECT * FROM (VALUES
  ('PM assignment enqueues one assigned row for C',
     (SELECT count(*) = 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i1')::uuid AND trigger = 'assigned'
         AND user_id = current_setting('x.c')::uuid)),
  ('self-assignment enqueues nothing',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i2')::uuid AND trigger = 'assigned')),
  ('service-path creation enqueues nothing',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i3')::uuid AND trigger = 'assigned')),
  ('due tomorrow swept',
     EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i1')::uuid AND trigger = 'due_tomorrow')),
  ('1 day overdue swept',
     EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i2')::uuid AND trigger = 'overdue')),
  ('2 days overdue NOT swept (every 3 days)',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i3')::uuid AND trigger = 'overdue')),
  ('sweep is idempotent per day',        (SELECT v FROM _r WHERE k = 'sweep2') = '0'),
  ('receive_check ok for the holder',    (SELECT v::jsonb->>'ok' FROM _r WHERE k = 'rc_c') = 'true'),
  ('receive_check refuses a non-holder', (SELECT v::jsonb->>'reason' FROM _r WHERE k = 'rc_pm') = 'ball_moved'),
  ('claim takes queued rows once',       (SELECT v::int > 0 FROM _r WHERE k = 'claim1') AND (SELECT v FROM _r WHERE k = 'claim2') = '0'),
  ('fold row counts overflow in one row',
     (SELECT (payload->>'count')::int = 2 FROM whatsapp.outbox WHERE user_id = current_setting('x.c')::uuid AND trigger = 'fold')),
  ('cron job scheduled',                 EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-due-sweep' AND schedule = '30 4 * * *')),
  ('service_role cannot be bypassed: anon has no execute on sweep',
     NOT has_function_privilege('anon', 'whatsapp.sweep_due(date)', 'EXECUTE'))
) AS t("check", ok);
