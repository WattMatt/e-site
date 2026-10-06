-- 00229_whatsapp_inspection_forms.sql
--
-- Inspection forms over WhatsApp (prompt E4, spec docs/superpowers/specs/2026-10-05-whatsapp-inspection-flows-design.md).
--
-- Adds, all dark until an org owner switches forms on AND the platform sending switch is on:
--   * whatsapp.org_settings.forms_enabled      per-org flag, DEFAULT false
--   * whatsapp.flows                           inspection template row -> published Meta Flow id
--   * whatsapp.form_sessions                   one WhatsApp form-filling session (hashed flow_token)
--   * whatsapp.form_links                      single-use signed web links (hashed token)
--   * whatsapp.inbound.meta_raw                Meta's original message JSON (a Flow reply lives only there)
--   * phone_links.current_form_session_id      which form a bare photo belongs to
--   * outbox triggers form_confirm / form_submitted, outbox.form_session_id
--   * via / submitted_via on inspections.responses, photos, inspections (the channel an answer came in on)
--   * bucket whatsapp-media                    service-only staging for inbound photos and outbound PDFs
--   * wa_inspection_* functions                act as the user under the real inspections RLS and ALSO require
--                                              the org flag and a non-client-viewer EFFECTIVE project role.
--                                              The inspection is read under RLS first: inspections_select_members
--                                              needs user_has_project_access(), which checks project_members.is_active,
--                                              so a deactivated member sees not_found (asserted). The project-role
--                                              check is needed because user_can_write_responses() looks only at the
--                                              ORG role, so a project-scoped client viewer whose org role is
--                                              contractor would otherwise pass (asserted, mutation-proven).
--
-- @verify:begin
-- table: whatsapp.org_settings
-- table: whatsapp.flows
-- table: whatsapp.form_sessions
-- table: whatsapp.form_links
-- column: whatsapp.inbound.meta_raw
-- column: whatsapp.phone_links.current_form_session_id
-- column: whatsapp.phone_links.current_form_session_at
-- column: whatsapp.outbox.form_session_id
-- column: inspections.responses.via
-- column: inspections.photos.via
-- column: inspections.inspections.submitted_via
-- function: whatsapp.forms_enabled(uuid)
-- function: whatsapp.inbound_immutable()
-- function: whatsapp._inspection_gate(uuid)
-- function: whatsapp.wa_inspection_gate(uuid,uuid)
-- function: whatsapp.wa_my_inspections(uuid,uuid)
-- function: whatsapp.wa_inspection_save(uuid,uuid,jsonb,uuid)
-- function: whatsapp.wa_inspection_add_photo(uuid,uuid,text,text,text,bigint,integer,integer)
-- function: whatsapp.wa_inspection_submit(uuid,uuid,uuid)
-- function: whatsapp.form_session_hold_photo(uuid,uuid)
-- function: whatsapp.form_session_release_photos(uuid,uuid[])
-- column: inspections.inspections.submitted_session_id
-- column: whatsapp.form_sessions.followup_notified_at
-- function: inspections.guard_submit_marker()
-- trigger: trg_guard_submit_marker ON inspections.inspections
-- sql: (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'inspections.guard_submit_marker()'::regprocedure)
-- function: whatsapp.enqueue_form_submitted(uuid)
-- function: whatsapp.form_receive_check(uuid)
-- constraint: outbox_trigger_check ON whatsapp.outbox
-- grant_absent: authenticated SELECT ON whatsapp.form_sessions
-- grant_absent: authenticated SELECT ON whatsapp.form_links
-- grant_absent: authenticated SELECT ON whatsapp.org_settings
-- anon_execute_absent: ALL prosecdef functions in whatsapp
-- sql: (SELECT bool_and(pg_get_userbyid(p.proowner) = 'whatsapp_actor') FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_inspection_gate','wa_my_inspections','wa_inspection_save','wa_inspection_add_photo','wa_inspection_submit'))
-- sql: (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.pronamespace = 'whatsapp'::regnamespace AND p.proname IN ('wa_inspection_gate','wa_my_inspections','wa_inspection_save','wa_inspection_add_photo','wa_inspection_submit','enqueue_form_submitted','form_receive_check','forms_enabled'))
-- sql: (SELECT pg_get_constraintdef(c.oid) LIKE '%form_submitted%' FROM pg_constraint c WHERE c.conrelid = 'whatsapp.outbox'::regclass AND c.conname = 'outbox_trigger_check')
-- sql: (SELECT column_default = 'false' FROM information_schema.columns WHERE table_schema = 'whatsapp' AND table_name = 'org_settings' AND column_name = 'forms_enabled')
-- sql: (SELECT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'whatsapp-media' AND b.public = false))
-- sql: (SELECT pg_get_functiondef('whatsapp.inbound_immutable()'::regprocedure) LIKE '%meta_raw%')
-- sql: (SELECT EXISTS (SELECT 1 FROM whatsapp.templates t WHERE t.name = 'esite_form_submitted' AND t.category = 'UTILITY'))
-- behaviour: refusal and positive paths proven by scripts/db/assert-whatsapp-inspections.sql
-- @verify:end

-- ── 1. Per-org flag ──────────────────────────────────────────────────────────
CREATE TABLE whatsapp.org_settings (
  organisation_id uuid PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
  forms_enabled   boolean NOT NULL DEFAULT false,
  updated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION whatsapp.forms_enabled(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT s.forms_enabled FROM whatsapp.org_settings s WHERE s.organisation_id = p_org), false)
$$;
REVOKE ALL ON FUNCTION whatsapp.forms_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.forms_enabled(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.forms_enabled(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.forms_enabled(uuid) TO whatsapp_actor, service_role;

-- ── 2. Published Flows, sessions, signed links ───────────────────────────────
CREATE TABLE whatsapp.flows (
  template_row_id  uuid PRIMARY KEY REFERENCES inspections.templates(id) ON DELETE CASCADE,
  meta_flow_id     text NOT NULL,
  flow_json_sha256 text NOT NULL CHECK (flow_json_sha256 ~ '^[0-9a-f]{64}$'),
  builder_version  text NOT NULL,
  status           text NOT NULL CHECK (status IN ('draft', 'published')),
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp.form_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          text NOT NULL UNIQUE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inspection_id       uuid NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  template_row_id     uuid NOT NULL REFERENCES inspections.templates(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'submitted', 'closed')),
  flow_message_id     text,
  answered_inbound_id uuid REFERENCES whatsapp.inbound(id) ON DELETE SET NULL,
  -- Photos waiting for an item number (WhatsApp captions only the first photo of an album).
  pending_photo_inbound_ids uuid[] NOT NULL DEFAULT '{}',
  -- The item the last numbered photo went to, and when: later uncaptioned photos follow it.
  last_photo_item     integer,
  last_photo_at       timestamptz,
  -- The verifier is told once per session, however often an interrupted follow-up is retried.
  followup_notified_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  submitted_at        timestamptz
);
-- One live session per person per inspection.
CREATE UNIQUE INDEX form_sessions_one_live ON whatsapp.form_sessions (user_id, inspection_id)
  WHERE status IN ('open', 'answered');
CREATE INDEX form_sessions_inspection ON whatsapp.form_sessions (inspection_id);

CREATE TABLE whatsapp.form_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text NOT NULL UNIQUE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  form_session_id uuid REFERENCES whatsapp.form_sessions(id) ON DELETE CASCADE,
  target_path     text NOT NULL CHECK (target_path ~ '^/projects/[0-9a-f-]{36}/inspections/[0-9a-f-]{36}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz
);

ALTER TABLE whatsapp.phone_links
  ADD COLUMN current_form_session_id uuid REFERENCES whatsapp.form_sessions(id) ON DELETE SET NULL,
  ADD COLUMN current_form_session_at timestamptz;

-- ── 3. Keep Meta's original message JSON (append-only like the rest of the row) ─
ALTER TABLE whatsapp.inbound ADD COLUMN meta_raw jsonb;

CREATE OR REPLACE FUNCTION whatsapp.inbound_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw IS DISTINCT FROM OLD.raw OR NEW.meta_message_id IS DISTINCT FROM OLD.meta_message_id
     OR NEW.from_e164 IS DISTINCT FROM OLD.from_e164 OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.meta_raw IS DISTINCT FROM OLD.meta_raw THEN
    RAISE EXCEPTION 'whatsapp.inbound is append-only: raw, meta_raw, meta_message_id, from_e164 and received_at never change';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION whatsapp.inbound_immutable() FROM PUBLIC, anon;

-- ── 4. Outbox: two new message kinds ─────────────────────────────────────────
ALTER TABLE whatsapp.outbox
  ADD COLUMN form_session_id uuid REFERENCES whatsapp.form_sessions(id) ON DELETE CASCADE;
ALTER TABLE whatsapp.outbox DROP CONSTRAINT outbox_trigger_check;
ALTER TABLE whatsapp.outbox ADD CONSTRAINT outbox_trigger_check
  CHECK (trigger IN ('assigned', 'due_tomorrow', 'overdue', 'otp', 'optin', 'fold', 'form_confirm', 'form_submitted'));

INSERT INTO whatsapp.templates (name, category, status) VALUES ('esite_form_submitted', 'UTILITY', 'pending')
  ON CONFLICT (name) DO NOTHING;

-- ── 5. Channel columns ───────────────────────────────────────────────────────
ALTER TABLE inspections.responses   ADD COLUMN via text CHECK (via IN ('web', 'mobile', 'whatsapp'));
ALTER TABLE inspections.photos      ADD COLUMN via text CHECK (via IN ('web', 'mobile', 'whatsapp'));
ALTER TABLE inspections.inspections ADD COLUMN submitted_via text CHECK (submitted_via IN ('web', 'mobile', 'whatsapp'));
-- The WhatsApp session whose SUBMIT moved the inspection, stamped in the same statement. A retry may
-- finish that submit's follow-up only when it is the same session (never someone else's submit).
ALTER TABLE inspections.inspections ADD COLUMN submitted_session_id uuid REFERENCES whatsapp.form_sessions(id) ON DELETE SET NULL;

-- Contributors may update inspections.inspections directly (inspections_update_contributors), so the
-- marker that lets a WhatsApp retry finish a submit's follow-up must not be writable by them: only
-- the WhatsApp actor (inside wa_inspection_submit) may SET it or mark a submit as 'whatsapp'; anyone
-- may clear it or record 'web' / 'mobile'. SECURITY INVOKER on purpose: current_user must be the
-- caller (a definer function would see its owner and wave everyone through).
CREATE OR REPLACE FUNCTION inspections.guard_submit_marker()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('whatsapp_actor', 'service_role', 'postgres', 'supabase_admin') THEN RETURN NEW; END IF;
  IF NEW.submitted_session_id IS NOT NULL AND NEW.submitted_session_id IS DISTINCT FROM OLD.submitted_session_id THEN
    RAISE EXCEPTION 'submitted_session_id is set only by a WhatsApp submit' USING ERRCODE = '42501';
  END IF;
  IF NEW.submitted_via = 'whatsapp' AND NEW.submitted_via IS DISTINCT FROM OLD.submitted_via THEN
    RAISE EXCEPTION 'submitted_via = whatsapp is set only by a WhatsApp submit' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION inspections.guard_submit_marker() FROM PUBLIC;
REVOKE ALL ON FUNCTION inspections.guard_submit_marker() FROM anon;
REVOKE ALL ON FUNCTION inspections.guard_submit_marker() FROM authenticated;
CREATE TRIGGER trg_guard_submit_marker BEFORE UPDATE OF submitted_session_id, submitted_via ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION inspections.guard_submit_marker();

-- ── 6. Grants: the new tables are service-role only ──────────────────────────
ALTER TABLE whatsapp.org_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.flows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.form_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.form_links    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp.org_settings, whatsapp.flows, whatsapp.form_sessions, whatsapp.form_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON whatsapp.org_settings, whatsapp.flows, whatsapp.form_sessions, whatsapp.form_links TO service_role;

-- ── 7. Staging bucket (service-only: no storage.objects policy is created) ───
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('whatsapp-media', 'whatsapp-media', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ── 8. The gate, run as the user after act_as ────────────────────────────────
-- Invoker function owned by whatsapp_actor; only the wa_* functions below call it.
CREATE OR REPLACE FUNCTION whatsapp._inspection_gate(p_inspection uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE r record;
BEGIN
  SELECT i.id, i.project_id, i.organisation_id, i.template_id, i.status, i.target_label
    INTO r FROM inspections.inspections i WHERE i.id = p_inspection;          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  IF NOT whatsapp.forms_enabled(r.organisation_id) THEN RETURN jsonb_build_object('code', 'flag_off'); END IF;
  IF COALESCE(public.user_effective_project_role(r.project_id, auth.uid()), 'client_viewer') = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access');
  END IF;
  IF NOT inspections.user_can_write_responses(r.id) THEN RETURN jsonb_build_object('code', 'not_writable'); END IF;
  RETURN jsonb_build_object('code', 'ok', 'inspection_id', r.id, 'project_id', r.project_id,
    'organisation_id', r.organisation_id, 'template_row_id', r.template_id, 'status', r.status, 'label', r.target_label);
END $$;

CREATE OR REPLACE FUNCTION whatsapp.wa_inspection_gate(p_user uuid, p_inspection uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN whatsapp._inspection_gate(p_inspection);
END $$;

CREATE OR REPLACE FUNCTION whatsapp.wa_my_inspections(p_user uuid, p_project uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'label', x.target_label, 'template_name', x.name,
                                        'template_row_id', x.template_id, 'status', x.status, 'mine', x.mine)
                     ORDER BY x.mine DESC, x.created_at)
      FROM (SELECT i.id, i.target_label, t.name, i.template_id, i.status, i.created_at,
                   COALESCE(i.assigned_to_id = p_user, false) AS mine
              FROM inspections.inspections i
              JOIN inspections.templates t ON t.id = i.template_id
             WHERE i.project_id = p_project
               AND whatsapp.forms_enabled(i.organisation_id)
               AND COALESCE(public.user_effective_project_role(i.project_id, p_user), 'client_viewer') <> 'client_viewer'
               AND inspections.user_can_write_responses(i.id)
             ORDER BY COALESCE(i.assigned_to_id = p_user, false) DESC, i.created_at
             LIMIT 10) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION whatsapp.wa_inspection_save(p_user uuid, p_inspection uuid, p_rows jsonb, p_inbound uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb; v_n int;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  v_gate := whatsapp._inspection_gate(p_inspection);
  IF v_gate->>'code' <> 'ok' THEN RETURN jsonb_build_object('code', v_gate->>'code'); END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 300 THEN
    RETURN jsonb_build_object('code', 'refused', 'message', 'rows must be a non-empty array of at most 300');
  END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) e
                WHERE COALESCE(e->>'section_id', '') !~ '^[a-z0-9_]{1,100}$'
                   OR COALESCE(e->>'field_id', '') !~ '^[a-z0-9_]{1,100}$') THEN
      RAISE EXCEPTION 'section_id and field_id must be template ids';
    END IF;
    INSERT INTO inspections.responses AS r (inspection_id, section_id, field_id, value_bool, value_number, value_text,
                                           value_array, pass_state, fail_reason, latest_responded_by, latest_responded_at, via)
    SELECT p_inspection, e->>'section_id', e->>'field_id', (e->>'value_bool')::boolean, (e->>'value_number')::numeric,
           left(e->>'value_text', 4000),
           CASE WHEN jsonb_typeof(e->'value_array') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(e->'value_array')) END,
           e->>'pass_state', left(e->>'fail_reason', 4000), p_user, now(), 'whatsapp'
      FROM jsonb_array_elements(p_rows) e
    ON CONFLICT (inspection_id, section_id, field_id) DO UPDATE
       SET value_bool = EXCLUDED.value_bool, value_number = EXCLUDED.value_number, value_text = EXCLUDED.value_text,
           value_array = EXCLUDED.value_array, pass_state = EXCLUDED.pass_state, fail_reason = EXCLUDED.fail_reason,
           latest_responded_by = EXCLUDED.latest_responded_by, latest_responded_at = EXCLUDED.latest_responded_at,
           via = EXCLUDED.via;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'saved', v_n);
END $$;

CREATE OR REPLACE FUNCTION whatsapp.wa_inspection_add_photo(p_user uuid, p_inspection uuid, p_section text, p_field text,
                                                            p_path text, p_size bigint, p_width integer, p_height integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  v_gate := whatsapp._inspection_gate(p_inspection);
  IF v_gate->>'code' <> 'ok' THEN RETURN jsonb_build_object('code', v_gate->>'code'); END IF;
  IF p_path IS NULL
     OR left(p_path, length((v_gate->>'project_id') || '/' || p_inspection::text || '/')) <> (v_gate->>'project_id') || '/' || p_inspection::text || '/'
     OR position('..' IN p_path) > 0 OR p_path !~ '^[A-Za-z0-9_./-]+$' THEN
    RETURN jsonb_build_object('code', 'bad_path');
  END IF;
  IF COALESCE(p_section, '') !~ '^[a-z0-9_]{1,100}$' OR COALESCE(p_field, '') !~ '^[a-z0-9_]{1,100}$' THEN
    RETURN jsonb_build_object('code', 'refused', 'message', 'section and field must be template ids');
  END IF;
  BEGIN
    INSERT INTO inspections.photos (inspection_id, section_id, field_id, storage_path, taken_at,
                                    width_px, height_px, file_size_bytes, uploaded_by, via)
    VALUES (p_inspection, p_section, p_field, p_path, now(), p_width, p_height, p_size, p_user, 'whatsapp')
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'id', v_id);
END $$;

-- Completeness (required answers, photos, signatures) is checked by the web app with the shared
-- engine BEFORE this is called; this function owns the status move and its race guard.
CREATE OR REPLACE FUNCTION whatsapp.wa_inspection_submit(p_user uuid, p_inspection uuid, p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_gate jsonb; v_verifier uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  v_gate := whatsapp._inspection_gate(p_inspection);
  IF v_gate->>'code' <> 'ok' THEN RETURN jsonb_build_object('code', v_gate->>'code'); END IF;
  IF v_gate->>'status' = 'assigned' THEN RETURN jsonb_build_object('code', 'nothing_answered'); END IF;
  BEGIN
    UPDATE inspections.inspections
       SET status = 'awaiting_verification', completed_at = now(), submitted_via = 'whatsapp', submitted_session_id = p_session
     WHERE id = p_inspection AND status IN ('in_progress', 're-inspect_required')
    RETURNING verifier_id INTO v_verifier;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_writable'); END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'verifier_id', v_verifier, 'project_id', v_gate->>'project_id');
END $$;

ALTER FUNCTION whatsapp._inspection_gate(uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_inspection_gate(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_my_inspections(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_inspection_save(uuid,uuid,jsonb,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_inspection_add_photo(uuid,uuid,text,text,text,bigint,integer,integer) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_inspection_submit(uuid,uuid,uuid) OWNER TO whatsapp_actor;
REVOKE ALL ON FUNCTION whatsapp._inspection_gate(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION whatsapp.wa_inspection_gate(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_my_inspections(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_inspection_save(uuid,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_inspection_add_photo(uuid,uuid,text,text,text,bigint,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_inspection_submit(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.wa_inspection_gate(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_my_inspections(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_inspection_save(uuid,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_inspection_add_photo(uuid,uuid,text,text,text,bigint,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_inspection_submit(uuid,uuid,uuid) TO service_role;

-- ── 9. Fan-out after a submit, and the send-time re-check ────────────────────
-- Recipients of the summary: active project members with an active org row, an active WhatsApp
-- link, not a client viewer (they cannot read an uncertified inspection), never the submitter,
-- on a project whose WhatsApp notifications are on. The submitter gets the confirmation.
CREATE OR REPLACE FUNCTION whatsapp.enqueue_form_submitted(p_session uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v record; n1 int := 0; n2 int := 0;
BEGIN
  SELECT s.id, s.user_id, s.inspection_id, i.project_id, i.organisation_id
    INTO v FROM whatsapp.form_sessions s JOIN inspections.inspections i ON i.id = s.inspection_id
   WHERE s.id = p_session;
  IF NOT FOUND OR NOT whatsapp.forms_enabled(v.organisation_id) THEN RETURN 0; END IF;

  -- The confirmation carries the PDF, which the web app renders AFTER queueing: give it a minute.
  INSERT INTO whatsapp.outbox (user_id, link_id, trigger, idempotency_key, payload, form_session_id, send_after)
  SELECT v.user_id, l.id, 'form_confirm', 'form_confirm:' || v.id,
         jsonb_build_object('inspection_id', v.inspection_id, 'project_id', v.project_id), v.id, now() + interval '60 seconds'
    FROM whatsapp.phone_links l WHERE l.user_id = v.user_id AND l.status = 'active'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n1 = ROW_COUNT;

  INSERT INTO whatsapp.outbox (user_id, link_id, trigger, idempotency_key, payload, form_session_id)
  SELECT pm.user_id, l.id, 'form_submitted', 'form_submitted:' || v.id || ':' || pm.user_id,
         jsonb_build_object('inspection_id', v.inspection_id, 'project_id', v.project_id, 'submitted_by', v.user_id), v.id
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id AND uo.is_active
    JOIN whatsapp.phone_links l ON l.user_id = pm.user_id AND l.status = 'active'
    JOIN projects.project_settings ps ON ps.project_id = pm.project_id AND ps.notify_whatsapp
   WHERE pm.project_id = v.project_id AND pm.is_active AND pm.user_id <> v.user_id
     AND COALESCE(public.user_effective_project_role(pm.project_id, pm.user_id), 'client_viewer') <> 'client_viewer'
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END $$;

-- Re-checked by the worker immediately before sending: things change between enqueue and send.
CREATE OR REPLACE FUNCTION whatsapp.form_receive_check(p_outbox uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v record;
BEGIN
  SELECT o.trigger, o.user_id, i.project_id, i.organisation_id
    INTO v FROM whatsapp.outbox o
    JOIN whatsapp.form_sessions s ON s.id = o.form_session_id
    JOIN inspections.inspections i ON i.id = s.inspection_id
   WHERE o.id = p_outbox;
  IF NOT FOUND THEN RETURN 'gone'; END IF;
  IF NOT whatsapp.forms_enabled(v.organisation_id) THEN RETURN 'flag_off'; END IF;
  IF v.trigger = 'form_submitted' AND NOT EXISTS (
       SELECT 1 FROM projects.project_settings ps WHERE ps.project_id = v.project_id AND ps.notify_whatsapp) THEN
    RETURN 'project_off';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM projects.project_members pm
         JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id AND uo.is_active
        WHERE pm.project_id = v.project_id AND pm.user_id = v.user_id AND pm.is_active)
     OR COALESCE(public.user_effective_project_role(v.project_id, v.user_id), 'client_viewer') = 'client_viewer' THEN
    RETURN 'no_access';
  END IF;
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION whatsapp.enqueue_form_submitted(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.enqueue_form_submitted(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.enqueue_form_submitted(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.form_receive_check(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.form_receive_check(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.form_receive_check(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.enqueue_form_submitted(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.form_receive_check(uuid) TO service_role;

-- ── 10. Held photos: append and release atomically (album photos arrive concurrently) ─
CREATE OR REPLACE FUNCTION whatsapp.form_session_hold_photo(p_session uuid, p_inbound uuid)
RETURNS uuid[] LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE whatsapp.form_sessions
     SET pending_photo_inbound_ids = CASE WHEN p_inbound = ANY (pending_photo_inbound_ids)
                                          THEN pending_photo_inbound_ids
                                          ELSE array_append(pending_photo_inbound_ids, p_inbound) END
   WHERE id = p_session
  RETURNING pending_photo_inbound_ids
$$;

CREATE OR REPLACE FUNCTION whatsapp.form_session_release_photos(p_session uuid, p_inbound uuid[])
RETURNS uuid[] LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE whatsapp.form_sessions
     SET pending_photo_inbound_ids = ARRAY(SELECT x FROM unnest(pending_photo_inbound_ids) WITH ORDINALITY AS u(x, n)
                                           WHERE NOT (x = ANY (p_inbound)) ORDER BY n)
   WHERE id = p_session
  RETURNING pending_photo_inbound_ids
$$;

REVOKE ALL ON FUNCTION whatsapp.form_session_hold_photo(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.form_session_hold_photo(uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.form_session_hold_photo(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.form_session_release_photos(uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.form_session_release_photos(uuid,uuid[]) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.form_session_release_photos(uuid,uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.form_session_hold_photo(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.form_session_release_photos(uuid,uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
