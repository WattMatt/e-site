-- 00208_whatsapp_project_channel.sql
--
-- WhatsApp project channel (spec docs/superpowers/specs/2026-09-29-whatsapp-project-channel-design.md).
-- Depends on 00207 (whatsapp schema, whatsapp_actor, act_as). Renumbered together with 00207 at apply time.
-- Every wa_* function is owned by whatsapp_actor (member of authenticated, NO bypassrls) and acts as the
-- user via whatsapp.act_as(), so the tables' REAL policies decide — no rule is restated here except the
-- storage-path binding, which has no policy to lean on.
--
-- @verify:begin
-- column: whatsapp.phone_links.current_project_id
-- column: whatsapp.phone_links.pending_post
-- function: whatsapp.wa_my_projects(uuid)
-- function: whatsapp.wa_project_items(uuid,uuid,text)
-- function: whatsapp.wa_item_card(uuid,uuid)
-- function: whatsapp.wa_post_diary(uuid,uuid,text,uuid)
-- function: whatsapp.wa_add_diary_attachment(uuid,uuid,text,text,text,bigint,uuid)
-- function: whatsapp.wa_post_issue(uuid,uuid,text,uuid)
-- sql: (SELECT bool_and(pg_get_userbyid(p.proowner) = 'whatsapp_actor') FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_my_projects','wa_project_items','wa_item_card','wa_post_diary','wa_add_diary_attachment','wa_post_issue'))
-- sql: (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_my_projects','wa_project_items','wa_item_card','wa_post_diary','wa_add_diary_attachment','wa_post_issue'))
-- anon_execute_absent: ALL prosecdef functions in whatsapp
-- behaviour: acting-as-user outcomes proven by scripts/db/assert-whatsapp-channel.sql
-- @verify:end

ALTER TABLE whatsapp.phone_links
  ADD COLUMN current_project_id uuid REFERENCES projects.projects(id) ON DELETE SET NULL,
  ADD COLUMN current_project_at timestamptz,
  ADD COLUMN pending_post       jsonb;

CREATE FUNCTION whatsapp.wa_my_projects(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.last_activity DESC NULLS LAST, x.name) FROM (
      SELECT p.id, p.name, public.user_effective_project_role(p.id, p_user) AS role,
             (SELECT max(wi.last_activity_at) FROM projects.work_items wi WHERE wi.project_id = p.id) AS last_activity
        FROM projects.projects p                                   -- RLS, as the user
       WHERE public.user_effective_project_role(p.id, p_user) IS NOT NULL
       LIMIT 50) x), '[]'::jsonb);
END $fn$;

CREATE FUNCTION whatsapp.wa_project_items(p_user uuid, p_project uuid, p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.due_date, x.ref) FROM (
      SELECT wi.id, wi.ref, wi.title, wi.due_date, wi.status
        FROM projects.work_items wi                                -- RLS (work_items_select), as the user
       WHERE wi.project_id = p_project AND wi.status IN ('triage', 'open', 'answered')
         AND (p_scope <> 'mine' OR wi.ball_in_court_id = p_user)
       ORDER BY wi.due_date, wi.ref LIMIT 10) x), '[]'::jsonb);
END $fn$;

CREATE FUNCTION whatsapp.wa_item_card(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r record;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT wi.id, wi.ref, wi.title, wi.due_date, wi.status, wi.item_type, wi.project_id, p.name AS project_name
    INTO r FROM projects.work_items wi JOIN projects.projects p ON p.id = wi.project_id
   WHERE wi.id = p_item;                                          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  RETURN jsonb_build_object('code', 'ok', 'id', r.id, 'ref', r.ref, 'title', r.title, 'due_date', r.due_date,
    'status', r.status, 'item_type', r.item_type, 'project_id', r.project_id, 'project_name', r.project_name);
END $fn$;

CREATE FUNCTION whatsapp.wa_post_diary(p_user uuid, p_project uuid, p_body text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_org uuid; v_name text; v_role text; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT p.organisation_id, p.name INTO v_org, v_name FROM projects.projects p WHERE p.id = p_project;   -- RLS
  v_role := public.user_effective_project_role(p_project, p_user);
  IF v_org IS NULL OR v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access');
  END IF;
  BEGIN
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, entry_type, progress_notes, created_by)
    VALUES (p_project, v_org, (now() AT TIME ZONE 'Africa/Johannesburg')::date, 'general',
            left(COALESCE(NULLIF(btrim(p_body), ''), 'Photos sent via WhatsApp'), 8000), p_user)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'id', v_id, 'organisation_id', v_org, 'project_name', v_name);
END $fn$;

CREATE FUNCTION whatsapp.wa_add_diary_attachment(p_user uuid, p_entry uuid, p_path text, p_name text,
                                                 p_mime text, p_size bigint, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE e record; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT d.id, d.project_id, d.organisation_id, d.created_by INTO e
    FROM projects.site_diary_entries d WHERE d.id = p_entry;       -- RLS, as the user
  IF NOT FOUND OR e.created_by <> p_user THEN RETURN jsonb_build_object('code', 'refused', 'message', 'not your entry'); END IF;
  -- site_diary_attachments has no path constraint: bind the object to the entry's own folder here.
  IF p_path NOT LIKE e.organisation_id::text || '/' || e.project_id::text || '/' || e.id::text || '/%' THEN
    RETURN jsonb_build_object('code', 'refused', 'message', 'path outside the entry folder');
  END IF;
  BEGIN
    INSERT INTO projects.site_diary_attachments (diary_entry_id, file_path, file_name, mime_type, file_size_bytes, kind, uploaded_by)
    VALUES (p_entry, p_path, p_name, p_mime, p_size, 'image', p_user)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'id', v_id);
END $fn$;

CREATE FUNCTION whatsapp.wa_post_issue(p_user uuid, p_project uuid, p_title text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_org uuid; v_role text; v_owner uuid; v_id uuid; v_ref text;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = p_project;   -- RLS
  v_role := public.user_effective_project_role(p_project, p_user);
  IF v_org IS NULL OR v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access');
  END IF;
  v_owner := COALESCE(projects.resolve_triage_owner(p_project), projects.resolve_project_pm(p_project));
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('code', 'refused', 'message', 'No one is set to receive issues on this project.');
  END IF;
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, status, title,
                                     assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, p_project, 'task', 'manual', 'triage', left(COALESCE(NULLIF(btrim(p_title), ''), 'Photo from site'), 120),
            v_owner, p_user, p_user)
    RETURNING id, ref INTO v_id, v_ref;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'id', v_id, 'ref', v_ref, 'organisation_id', v_org,
    'assignee_name', (SELECT full_name FROM public.profiles WHERE id = v_owner));
END $fn$;

-- Ownership + grants, one statement each (packages/db scanners read this text).
ALTER FUNCTION whatsapp.wa_my_projects(uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_project_items(uuid,uuid,text) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_item_card(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_post_diary(uuid,uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_add_diary_attachment(uuid,uuid,text,text,text,bigint,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_post_issue(uuid,uuid,text,uuid) OWNER TO whatsapp_actor;
REVOKE ALL ON FUNCTION whatsapp.wa_my_projects(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_project_items(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_item_card(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_post_diary(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_add_diary_attachment(uuid,uuid,text,text,text,bigint,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_post_issue(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.wa_my_projects(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_project_items(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_item_card(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_post_diary(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_add_diary_attachment(uuid,uuid,text,text,text,bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_post_issue(uuid,uuid,text,uuid) TO service_role;
