-- whatsapp_files_reports.sql — WhatsApp sub-projects 3 + 4: drawings, documents and reports on request.
-- (Numbered at apply time; spec docs/superpowers/specs/2026-10-06-whatsapp-files-reports-design.md.)
--
-- Every wa_* function is owned by whatsapp_actor (member of authenticated, NO bypassrls) and acts as the
-- user via whatsapp.act_as(), so the tables' REAL policies decide — including site_scope (00238) and the
-- report-kind read gate (00183). A row the person cannot see returns not_found; the edge only fetches
-- the file from storage (service key) after one of these functions said ok.
--
-- @verify:begin
-- column: whatsapp.phone_links.pending_search_at
-- function: whatsapp.wa_project_files(uuid,uuid,text)
-- function: whatsapp.wa_file(uuid,text,uuid)
-- function: whatsapp.wa_project_reports(uuid,uuid)
-- function: whatsapp.wa_report(uuid,uuid)
-- sql: (SELECT bool_and(pg_get_userbyid(p.proowner) = 'whatsapp_actor') FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_project_files','wa_file','wa_project_reports','wa_report'))
-- sql: (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_project_files','wa_file','wa_project_reports','wa_report'))
-- anon_execute_absent: ALL prosecdef functions in whatsapp
-- behaviour: acting-as-user outcomes proven by scripts/db/assert-whatsapp-files.sql
-- @verify:end

ALTER TABLE whatsapp.phone_links ADD COLUMN pending_search_at timestamptz;

-- Up to 10 drawings (active floor plans) and project documents, newest first; p_query filters by name.
CREATE FUNCTION whatsapp.wa_project_files(p_user uuid, p_project uuid, p_query text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_like text := '%' || replace(replace(replace(coalesce(btrim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC, x.name) FROM (
      SELECT * FROM (
        SELECT 'p'::text AS kind, fp.id, fp.name, fp.level AS sub, fp.updated_at
          FROM tenants.floor_plans fp                               -- RLS + site_scope, as the user
         WHERE fp.project_id = p_project AND fp.is_active AND fp.name ILIKE v_like
        UNION ALL
        SELECT 'd', d.id, d.name, d.category, d.updated_at
          FROM tenants.documents d                                  -- RLS + site_scope, as the user
         WHERE d.project_id = p_project AND d.name ILIKE v_like) u
       ORDER BY u.updated_at DESC, u.name LIMIT 10) x), '[]'::jsonb);
END $fn$;

-- One file, if the person can see it: where it lives, so the edge can fetch it.
CREATE FUNCTION whatsapp.wa_file(p_user uuid, p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r record;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  IF p_kind = 'p' THEN
    SELECT fp.name, fp.file_path AS path, fp.project_id INTO r
      FROM tenants.floor_plans fp WHERE fp.id = p_id AND fp.is_active;         -- RLS, as the user
    IF FOUND AND r.path IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'ok', 'bucket', 'drawings', 'path', r.path, 'name', r.name,
        'mime', 'application/pdf', 'project_id', r.project_id);
    END IF;
  ELSIF p_kind = 'd' THEN
    SELECT d.name, d.storage_path AS path, d.mime_type AS mime, d.project_id INTO r
      FROM tenants.documents d WHERE d.id = p_id;                             -- RLS, as the user
    IF FOUND AND r.path IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'ok', 'bucket', 'project-documents', 'path', r.path, 'name', r.name,
        'mime', coalesce(r.mime, 'application/octet-stream'), 'project_id', r.project_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('code', 'not_found');
END $fn$;

-- The latest issued saved report of each kind the person may read, and whether a cable schedule
-- revision is visible to them (the cable schedule PDF is built on demand by the web app).
CREATE FUNCTION whatsapp.wa_project_reports(p_user uuid, p_project uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN jsonb_build_object(
    'reports', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.generated_at DESC) FROM (
        SELECT DISTINCT ON (r.kind) r.id, r.kind, r.title, r.version, r.generated_at
          FROM projects.reports r                     -- RLS + report-kind gate (00183) + site_scope, as the user
         WHERE r.project_id = p_project AND r.status = 'issued'
         ORDER BY r.kind, r.generated_at DESC) x), '[]'::jsonb),
    'cable_schedule', EXISTS (
      SELECT 1 FROM cable_schedule.revisions rv WHERE rv.project_id = p_project));   -- RLS, as the user
END $fn$;

-- One saved report, if the person may read it.
CREATE FUNCTION whatsapp.wa_report(p_user uuid, p_report uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r record;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT rp.title, rp.storage_path, rp.mime_type, rp.version, rp.project_id INTO r
    FROM projects.reports rp WHERE rp.id = p_report AND rp.status = 'issued';   -- RLS + kind gate, as the user
  IF NOT FOUND OR r.storage_path IS NULL THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  RETURN jsonb_build_object('code', 'ok', 'bucket', 'reports', 'path', r.storage_path, 'name', r.title,
    'mime', coalesce(r.mime_type, 'application/pdf'), 'version', r.version, 'project_id', r.project_id);
END $fn$;

-- Ownership + grants, one statement each (packages/db scanners read this text).
ALTER FUNCTION whatsapp.wa_project_files(uuid,uuid,text) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_file(uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_project_reports(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_report(uuid,uuid) OWNER TO whatsapp_actor;
REVOKE ALL ON FUNCTION whatsapp.wa_project_files(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_file(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_project_reports(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_report(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.wa_project_files(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_file(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_project_reports(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_report(uuid,uuid) TO service_role;
