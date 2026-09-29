-- scripts/db/assert-whatsapp-actor.sql
-- Acting as the user under REAL RLS. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00222_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-actor.sql
-- Fixtures: C = rbac-test contractor (KINGSWALK member only); PM = KINGSWALK's PM;
-- item A (KINGSWALK, C holds the ball); item B (MAMAILA, C has no access).

SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.pm_m', projects.resolve_project_pm(current_setting('x.mamaila')::uuid)::text, true);

WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe A',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.a', (SELECT id::text FROM ins), true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe B',
         current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, 'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.mamaila')::uuid RETURNING id)
SELECT set_config('x.b', (SELECT id::text FROM ins), true);
-- Item D on KINGSWALK: assignee == gatekeeper == PM (Mark done closes directly).
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe D',
         current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'triage', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.d', (SELECT id::text FROM ins), true);

CREATE TEMP TABLE _r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _r TO service_role;
SET LOCAL ROLE service_role;   -- exactly how the edge function calls these
INSERT INTO _r VALUES
  ('ack_a_by_c',   whatsapp.wa_acknowledge(current_setting('x.c')::uuid, current_setting('x.a')::uuid)),
  ('done_b_by_c',  whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.b')::uuid)),
  ('note_b_by_c',  whatsapp.wa_add_note(current_setting('x.c')::uuid,    current_setting('x.b')::uuid, 'sneak', NULL)),
  ('done_a_by_pm_early', whatsapp.wa_mark_done(current_setting('x.pm')::uuid, current_setting('x.a')::uuid)),
  ('done_a_by_c',  whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.a')::uuid)),
  ('done_a_by_c2', whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.a')::uuid)),
  ('note_a_by_c',  whatsapp.wa_add_note(current_setting('x.c')::uuid,    current_setting('x.a')::uuid, 'Cover refitted', NULL)),
  ('att_bad_path', whatsapp.wa_add_attachment(current_setting('x.c')::uuid, current_setting('x.a')::uuid,
                     'work-item-attachments', 'ffffffff-ffff-4fff-8fff-ffffffffffff/x/y.jpg', 'image/jpeg', 'evidence', NULL)),
  ('done_a_by_pm', whatsapp.wa_mark_done(current_setting('x.pm')::uuid,  current_setting('x.a')::uuid)),
  ('done_d_by_pm', whatsapp.wa_mark_done(current_setting('x.pm')::uuid,  current_setting('x.d')::uuid)),
  ('open_c',       whatsapp.wa_open_items(current_setting('x.c')::uuid));
RESET ROLE;

-- Redaction: the author may, within 15 minutes; nobody else may.
SELECT set_config('x.note', (SELECT v->>'id' FROM _r WHERE k = 'note_a_by_c'), true);
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('redact_by_pm', whatsapp.wa_redact(current_setting('x.pm')::uuid, 'note', current_setting('x.note')::uuid)),
  ('redact_by_c',  whatsapp.wa_redact(current_setting('x.c')::uuid,  'note', current_setting('x.note')::uuid));
RESET ROLE;

-- Removal from the project stops WhatsApp actions at once (stricter than the web on purpose: spec §3.3).
UPDATE projects.project_members SET is_active = false
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('note_after_removal', whatsapp.wa_add_note(current_setting('x.c')::uuid, current_setting('x.a')::uuid, 'after removal', NULL));
RESET ROLE;

SELECT * FROM (VALUES
  ('wa_mark_done is owned by whatsapp_actor',
     (SELECT pg_get_userbyid(proowner) = 'whatsapp_actor' FROM pg_proc WHERE oid = 'whatsapp.wa_mark_done(uuid,uuid)'::regprocedure)),
  ('whatsapp_actor cannot bypass RLS, is not super, cannot log in',
     (SELECT NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin FROM pg_roles WHERE rolname = 'whatsapp_actor')),
  ('authenticated cannot execute wa_mark_done', NOT has_function_privilege('authenticated', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('anon cannot execute wa_mark_done',          NOT has_function_privilege('anon', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('authenticated cannot execute act_as',       NOT has_function_privilege('authenticated', 'whatsapp.act_as(uuid)', 'EXECUTE')),
  ('service_role can execute wa_mark_done',     has_function_privilege('service_role', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('ack on own item ok',                        (SELECT v->>'code' FROM _r WHERE k = 'ack_a_by_c') = 'ok'),
  ('RLS hides a MAMAILA item from mark done',   (SELECT v->>'code' FROM _r WHERE k = 'done_b_by_c') = 'not_found'),
  ('RLS hides a MAMAILA item from notes',       (SELECT v->>'code' FROM _r WHERE k = 'note_b_by_c') = 'not_found'),
  ('PM cannot mark done while contractor holds it', (SELECT v->>'code' FROM _r WHERE k = 'done_a_by_pm_early') = 'not_holder'),
  ('holder mark done -> answered, NOT closed',  (SELECT v->>'code' = 'ok' AND v->>'status' = 'answered' FROM _r WHERE k = 'done_a_by_c')),
  ('second tap after the ball moved',           (SELECT v->>'code' FROM _r WHERE k = 'done_a_by_c2') = 'not_holder'),
  ('note ok',                                   (SELECT v->>'code' FROM _r WHERE k = 'note_a_by_c') = 'ok'),
  ('foreign storage path refused',              (SELECT v->>'code' FROM _r WHERE k = 'att_bad_path') = 'refused'),
  ('gatekeeper closes',                         (SELECT v->>'code' = 'ok' AND v->>'status' = 'closed' FROM _r WHERE k = 'done_a_by_pm')),
  ('assignee == gatekeeper closes from triage', (SELECT v->>'code' = 'ok' AND v->>'status' = 'closed' FROM _r WHERE k = 'done_d_by_pm')),
  ('open items list excludes closed and foreign items',
     NOT (SELECT v::text LIKE '%' || current_setting('x.a') || '%' OR v::text LIKE '%' || current_setting('x.b') || '%'
            FROM _r WHERE k = 'open_c')),
  ('events attribute each step to the acting user',
     (SELECT string_agg(verb || ':' || coalesce(actor_id::text, '-'), ',' ORDER BY seq)
        FROM projects.work_item_events WHERE work_item_id = current_setting('x.a')::uuid)
     LIKE '%acknowledged:' || current_setting('x.c') || '%status_changed:' || current_setting('x.c')
          || '%closed:' || current_setting('x.pm') || '%'),
  ('note is bound to the item''s project and marked whatsapp',
     (SELECT project_id::text = current_setting('x.kw') AND via = 'whatsapp'
        FROM projects.work_item_notes WHERE id = current_setting('x.note')::uuid)),
  ('non-author cannot redact',                  (SELECT v->>'code' FROM _r WHERE k = 'redact_by_pm') = 'refused'),
  ('author redacts within the window',          (SELECT v->>'code' FROM _r WHERE k = 'redact_by_c') = 'ok'),
  ('redaction keeps the row and empties the body',
     (SELECT redacted_at IS NOT NULL AND body = '' FROM projects.work_item_notes WHERE id = current_setting('x.note')::uuid)),
  ('a removed member is refused',               (SELECT v->>'code' FROM _r WHERE k = 'note_after_removal') IN ('no_access', 'refused'))
) AS t("check", ok);
