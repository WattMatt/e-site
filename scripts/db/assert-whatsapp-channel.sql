-- scripts/db/assert-whatsapp-channel.sql
-- Run: cat apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql \
--          apps/edge-functions/supabase/migrations/00208_whatsapp_project_channel.sql > $TMPDIR/wa-both.sql
--      scripts/db/dry-run-migration.sh $TMPDIR/wa-both.sql scripts/db/assert-whatsapp-channel.sql
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.triage', COALESCE(projects.resolve_triage_owner(current_setting('x.kw')::uuid),
                                       projects.resolve_project_pm(current_setting('x.kw')::uuid))::text, true);
-- A real client viewer and one of their projects (4 exist in production).
SELECT set_config('x.cv', (SELECT pm.user_id::text FROM projects.project_members pm
                            WHERE pm.is_active AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'client_viewer'
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.cv_proj', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.cv')::uuid AND pm.is_active LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.cv', true) IS NULL OR current_setting('x.triage', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK, a client viewer, or a triage owner is missing — the probes would be vacuous';
  END IF;
  IF current_setting('x.triage') = current_setting('x.c') THEN
    RAISE EXCEPTION 'the fixture contractor is the triage owner — the issue probe could not tell creator from assignee';
  END IF;
END $$;

-- An item assigned to C and one assigned to the PM on KINGSWALK.
WITH ins AS (INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, assignee_id, gatekeeper_id, created_by, status)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA ch mine', current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open'
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.mine', (SELECT id::text FROM ins), true);
WITH ins AS (INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, assignee_id, gatekeeper_id, created_by, status)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA ch pm', current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open'
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.pmitem', (SELECT id::text FROM ins), true);
-- The triage owner is linked and KINGSWALK has WhatsApp on, so a raised issue must enqueue their card.
UPDATE projects.project_settings SET notify_whatsapp = true WHERE project_id = current_setting('x.kw')::uuid;
INSERT INTO whatsapp.phone_links (user_id, phone_e164, status, verified_at, consent_at, consent_text_version)
VALUES (current_setting('x.triage')::uuid, '+27000000009', 'active', now(), now(), 'test');

CREATE TEMP TABLE _r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _r TO service_role;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('projects_c',     whatsapp.wa_my_projects(current_setting('x.c')::uuid)),
  ('mine_c',         whatsapp.wa_project_items(current_setting('x.c')::uuid, current_setting('x.kw')::uuid, 'mine')),
  ('proj_c',         whatsapp.wa_project_items(current_setting('x.c')::uuid, current_setting('x.kw')::uuid, 'project')),
  ('mamaila_items',  whatsapp.wa_project_items(current_setting('x.c')::uuid, current_setting('x.mamaila')::uuid, 'project')),
  ('card_mine',      whatsapp.wa_item_card(current_setting('x.c')::uuid, current_setting('x.mine')::uuid)),
  ('diary_c',        whatsapp.wa_post_diary(current_setting('x.c')::uuid, current_setting('x.kw')::uuid, 'Cable pulled to DB-3', NULL)),
  ('diary_mamaila',  whatsapp.wa_post_diary(current_setting('x.c')::uuid, current_setting('x.mamaila')::uuid, 'sneak', NULL)),
  ('diary_cv',       whatsapp.wa_post_diary(current_setting('x.cv')::uuid, current_setting('x.cv_proj')::uuid, 'viewer post', NULL)),
  ('issue_cv',       whatsapp.wa_post_issue(current_setting('x.cv')::uuid, current_setting('x.cv_proj')::uuid, 'viewer issue', NULL)),
  ('issue_c',        whatsapp.wa_post_issue(current_setting('x.c')::uuid, current_setting('x.kw')::uuid, 'Loose cover on DB-3', NULL));
RESET ROLE;
SELECT set_config('x.entry', (SELECT v->>'id' FROM _r WHERE k = 'diary_c'), true);
SELECT set_config('x.org', (SELECT v->>'organisation_id' FROM _r WHERE k = 'diary_c'), true);
SELECT set_config('x.issue', (SELECT v->>'id' FROM _r WHERE k = 'issue_c'), true);
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('att_bad',  whatsapp.wa_add_diary_attachment(current_setting('x.c')::uuid, current_setting('x.entry')::uuid,
                 'ffffffff-ffff-4fff-8fff-ffffffffffff/x/y/z.jpg', 'z.jpg', 'image/jpeg', 10, NULL)),
  ('att_good', whatsapp.wa_add_diary_attachment(current_setting('x.c')::uuid, current_setting('x.entry')::uuid,
                 current_setting('x.org') || '/' || current_setting('x.kw') || '/' || current_setting('x.entry') || '/wa-1.jpg',
                 'wa-1.jpg', 'image/jpeg', 10, NULL));
RESET ROLE;
UPDATE projects.projects SET status = 'payment_paused' WHERE id = current_setting('x.kw')::uuid;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES ('diary_paused', whatsapp.wa_post_diary(current_setting('x.c')::uuid, current_setting('x.kw')::uuid, 'paused', NULL));
RESET ROLE;

SELECT * FROM (VALUES
  ('C lists KINGSWALK',                     (SELECT v::text LIKE '%' || current_setting('x.kw') || '%' FROM _r WHERE k = 'projects_c')),
  ('C does not list MAMAILA',               (SELECT v::text NOT LIKE '%' || current_setting('x.mamaila') || '%' FROM _r WHERE k = 'projects_c')),
  ('my items: has mine, not the PM''s',     (SELECT v::text LIKE '%' || current_setting('x.mine') || '%' AND v::text NOT LIKE '%' || current_setting('x.pmitem') || '%' FROM _r WHERE k = 'mine_c')),
  ('project items: has both',               (SELECT v::text LIKE '%' || current_setting('x.mine') || '%' AND v::text LIKE '%' || current_setting('x.pmitem') || '%' FROM _r WHERE k = 'proj_c')),
  ('MAMAILA items invisible to C',          (SELECT v = '[]'::jsonb FROM _r WHERE k = 'mamaila_items')),
  ('item card ok with its project',         (SELECT v->>'code' = 'ok' AND v->>'project_id' = current_setting('x.kw') FROM _r WHERE k = 'card_mine')),
  ('diary post ok as C',                    (SELECT v->>'code' FROM _r WHERE k = 'diary_c') = 'ok'),
  ('diary row: general, by C, today',       (SELECT entry_type::text = 'general' AND created_by::text = current_setting('x.c')
                                                    AND entry_date = (now() AT TIME ZONE 'Africa/Johannesburg')::date
                                               FROM projects.site_diary_entries WHERE id = current_setting('x.entry')::uuid)),
  ('diary refused on MAMAILA',              (SELECT v->>'code' FROM _r WHERE k = 'diary_mamaila') IN ('no_access', 'refused')),
  ('client viewer cannot post diary',       (SELECT v->>'code' FROM _r WHERE k = 'diary_cv') IN ('no_access', 'refused')),
  ('client viewer cannot raise issue',      (SELECT v->>'code' FROM _r WHERE k = 'issue_cv') IN ('no_access', 'refused')),
  ('foreign attachment path refused',       (SELECT v->>'code' FROM _r WHERE k = 'att_bad') = 'refused'),
  ('own attachment path ok',                (SELECT v->>'code' FROM _r WHERE k = 'att_good') = 'ok'),
  ('issue ok',                              (SELECT v->>'code' FROM _r WHERE k = 'issue_c') = 'ok'),
  ('issue: task/manual/triage, TASK- ref, assigned to triage owner, gatekeeper + creator = C',
     (SELECT item_type = 'task' AND origin = 'manual' AND status = 'triage' AND ref LIKE 'TASK-%'
             AND assignee_id::text = current_setting('x.triage') AND gatekeeper_id::text = current_setting('x.c')
             AND created_by::text = current_setting('x.c')
        FROM projects.work_items WHERE id = current_setting('x.issue')::uuid)),
  ('issue enqueued the triage owner''s WhatsApp card',
     EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.issue')::uuid
              AND trigger = 'assigned' AND user_id::text = current_setting('x.triage'))),
  ('payment-paused project refuses a diary post', (SELECT v->>'code' FROM _r WHERE k = 'diary_paused') IN ('no_access', 'refused')),
  ('wa_post_diary owned by whatsapp_actor',
     (SELECT pg_get_userbyid(proowner) = 'whatsapp_actor' FROM pg_proc WHERE oid = 'whatsapp.wa_post_diary(uuid,uuid,text,uuid)'::regprocedure)),
  ('authenticated cannot execute wa_post_issue',
     NOT has_function_privilege('authenticated', 'whatsapp.wa_post_issue(uuid,uuid,text,uuid)', 'EXECUTE'))
) AS t("check", ok);
