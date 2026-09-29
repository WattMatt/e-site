-- scripts/db/assert-whatsapp-schema.sql
-- Structure and grants of 00222. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00222_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-schema.sql
SELECT * FROM (VALUES
  ('schema whatsapp exists',            EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'whatsapp')),
  ('phone_links exists',                to_regclass('whatsapp.phone_links') IS NOT NULL),
  ('outbox exists',                     to_regclass('whatsapp.outbox') IS NOT NULL),
  ('inbound exists',                    to_regclass('whatsapp.inbound') IS NOT NULL),
  ('settings has exactly one row, sending OFF',
     (SELECT count(*) = 1 AND bool_and(NOT sending_enabled) FROM whatsapp.settings)),
  ('notes table exists',                to_regclass('projects.work_item_notes') IS NOT NULL),
  ('attachments table exists',          to_regclass('projects.work_item_attachments') IS NOT NULL),
  ('notify_whatsapp defaults false everywhere',
     (SELECT bool_and(NOT notify_whatsapp) FROM projects.project_settings)),
  ('verb CHECK admits acknowledged',
     (SELECT pg_get_constraintdef(c.oid) LIKE '%acknowledged%' FROM pg_constraint c
       WHERE c.conrelid = 'projects.work_item_events'::regclass AND c.conname = 'work_item_events_verb_check')),
  ('exactly one verb CHECK remains',
     (SELECT count(*) = 1 FROM pg_constraint c WHERE c.conrelid = 'projects.work_item_events'::regclass
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%verb%')),
  ('anon has no SELECT on phone_links', NOT has_table_privilege('anon', 'whatsapp.phone_links', 'SELECT')),
  ('authenticated cannot INSERT phone_links', NOT has_table_privilege('authenticated', 'whatsapp.phone_links', 'INSERT')),
  ('authenticated cannot read otp_hash',  NOT has_column_privilege('authenticated', 'whatsapp.phone_links', 'otp_hash', 'SELECT')),
  ('authenticated can read own phone column', has_column_privilege('authenticated', 'whatsapp.phone_links', 'phone_e164', 'SELECT')),
  ('authenticated cannot INSERT notes',   NOT has_table_privilege('authenticated', 'projects.work_item_notes', 'INSERT')),
  ('authenticated cannot UPDATE inbound', NOT has_table_privilege('authenticated', 'whatsapp.inbound', 'UPDATE')),
  ('RLS on every whatsapp table',
     (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'whatsapp' AND c.relkind = 'r')),
  ('attachment bucket is private',
     EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'work-item-attachments' AND public = false)),
  ('inbound raw is immutable', (
     SELECT prosrc LIKE '%raw%' FROM pg_proc WHERE proname = 'inbound_immutable' AND pronamespace = 'whatsapp'::regnamespace))
) AS t("check", ok);
