-- 00207_whatsapp_reply_to_act.sql
--
-- WhatsApp reply-to-act (spec docs/superpowers/specs/2026-09-28-whatsapp-reply-to-act-design.md,
-- §9 amendments win). Part A: schema, tables, grants, notes/attachments, verb, toggle.
-- Part B (Task 6): the whatsapp_actor role and the wa_* functions.
-- Part C (Task 7): outbox enqueue, due sweep, claim/receive helpers, cron.
--
-- ⚠ This migration CREATES a schema. After applying, PATCH PostgREST db_schema to
-- include `whatsapp` (docs/whatsapp-runbook.md §2), or REST returns PGRST002.
--
-- @verify:begin
-- (Task 8 writes the full block; keep this marker pair at the top of the file.)
-- @verify:end

CREATE SCHEMA IF NOT EXISTS whatsapp;
REVOKE ALL ON SCHEMA whatsapp FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA whatsapp TO authenticated, service_role;

-- ── platform settings (single row) ─────────────────────────────────────────
CREATE TABLE whatsapp.settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  sending_enabled       boolean NOT NULL DEFAULT false,
  alert_email           text,
  last_policy_error_at  timestamptz,
  last_policy_error     text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO whatsapp.settings (id) VALUES (true);

CREATE TABLE whatsapp.templates (
  name        text PRIMARY KEY,
  language    text NOT NULL DEFAULT 'en',
  category    text NOT NULL CHECK (category IN ('AUTHENTICATION','UTILITY')),
  status      text NOT NULL DEFAULT 'pending',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO whatsapp.templates (name, category) VALUES
  ('esite_otp','AUTHENTICATION'), ('esite_optin','UTILITY'),
  ('esite_item_assigned','UTILITY'), ('esite_item_due_tomorrow','UTILITY'),
  ('esite_item_overdue','UTILITY'), ('esite_items_waiting','UTILITY');

-- ── phone links ────────────────────────────────────────────────────────────
CREATE TABLE whatsapp.phone_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_e164            text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status                text NOT NULL CHECK (status IN
                          ('pending_otp','pending_optin','active','undeliverable','opted_out')),
  verified_at           timestamptz,
  consent_at            timestamptz,
  consent_text_version  text,
  invited_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_project_id    uuid REFERENCES projects.projects(id) ON DELETE SET NULL,
  otp_hash              text,
  otp_expires_at        timestamptz,
  otp_attempts          int NOT NULL DEFAULT 0,
  otp_window_start      timestamptz,
  otp_window_count      int NOT NULL DEFAULT 0,
  quiet_start           time NOT NULL DEFAULT '18:00',
  quiet_end             time NOT NULL DEFAULT '06:30',
  active_item_id        uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  active_item_at        timestamptz,
  pending_done_item_id  uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  pending_done_at       timestamptz,
  pending_done_wants    text CHECK (pending_done_wants IN ('photo','answer')),
  pending_inbound_id    uuid,
  last_confirm_item_id  uuid,
  last_confirm_at       timestamptz,
  undeliverable_reason  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR consent_at IS NOT NULL)
);
CREATE UNIQUE INDEX phone_links_live_phone_uidx ON whatsapp.phone_links (phone_e164)
  WHERE status IN ('pending_optin','active');
CREATE UNIQUE INDEX phone_links_live_user_uidx ON whatsapp.phone_links (user_id)
  WHERE status IN ('pending_otp','pending_optin','active');

-- ── outbox ─────────────────────────────────────────────────────────────────
CREATE TABLE whatsapp.outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_item_id     uuid REFERENCES projects.work_items(id) ON DELETE CASCADE,
  link_id          uuid REFERENCES whatsapp.phone_links(id) ON DELETE CASCADE,
  trigger          text NOT NULL CHECK (trigger IN
                     ('assigned','due_tomorrow','overdue','otp','optin','fold')),
  idempotency_key  text NOT NULL UNIQUE,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued','sending','retry','held_quiet','sent','delivered','read','failed','suppressed')),
  send_after       timestamptz NOT NULL DEFAULT now(),
  attempts         int NOT NULL DEFAULT 0,
  meta_message_id  text UNIQUE,
  error_code       int,
  error_text       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due_idx ON whatsapp.outbox (send_after) WHERE status IN ('queued','retry','held_quiet');
CREATE INDEX outbox_item_idx ON whatsapp.outbox (work_item_id, created_at);
CREATE INDEX outbox_user_day_idx ON whatsapp.outbox (user_id, sent_at);

-- ── inbound (append-only evidence log) ─────────────────────────────────────
CREATE TABLE whatsapp.inbound (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_message_id     text NOT NULL UNIQUE,
  from_e164           text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  raw                 jsonb NOT NULL,
  kind                text NOT NULL,
  context_message_id  text,
  resolved_user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_item_id    uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  outcome             text NOT NULL DEFAULT 'pending' CHECK (outcome IN
                        ('pending','applied','refused','unmatched','unknown_sender')),
  outcome_reason      text,
  attempts            int NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  processed_at        timestamptz
);
CREATE INDEX inbound_pending_idx ON whatsapp.inbound (received_at) WHERE outcome = 'pending';
CREATE INDEX inbound_item_idx ON whatsapp.inbound (resolved_item_id, received_at);

CREATE FUNCTION whatsapp.inbound_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.raw IS DISTINCT FROM OLD.raw OR NEW.meta_message_id IS DISTINCT FROM OLD.meta_message_id
     OR NEW.from_e164 IS DISTINCT FROM OLD.from_e164 OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'whatsapp.inbound is append-only: raw, meta_message_id, from_e164 and received_at never change';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER inbound_immutable_trg BEFORE UPDATE ON whatsapp.inbound
  FOR EACH ROW EXECUTE FUNCTION whatsapp.inbound_immutable();
REVOKE ALL ON FUNCTION whatsapp.inbound_immutable() FROM PUBLIC, anon;

CREATE TABLE whatsapp.unknown_senders (
  phone_e164       text PRIMARY KEY,
  last_replied_at  timestamptz NOT NULL
);

-- ── notes + attachments on work items ──────────────────────────────────────
CREATE TABLE projects.work_item_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id     uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  author_id        uuid NOT NULL REFERENCES public.profiles(id),
  body             text NOT NULL CHECK (length(body) <= 4096),
  via              text NOT NULL DEFAULT 'web' CHECK (via IN ('web','whatsapp')),
  inbound_id       uuid REFERENCES whatsapp.inbound(id) ON DELETE SET NULL,
  redacted_at      timestamptz,
  redacted_by      uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (redacted_at IS NOT NULL OR length(btrim(body)) > 0)
);
CREATE INDEX work_item_notes_item_idx ON projects.work_item_notes (work_item_id, created_at);

CREATE TABLE projects.work_item_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id     uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  uploaded_by      uuid NOT NULL REFERENCES public.profiles(id),
  bucket           text NOT NULL DEFAULT 'work-item-attachments'
                     CHECK (bucket IN ('work-item-attachments','snag-photos')),
  storage_path     text NOT NULL,
  mime_type        text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  role             text NOT NULL DEFAULT 'evidence' CHECK (role IN ('evidence','closeout')),
  via              text NOT NULL DEFAULT 'web' CHECK (via IN ('web','whatsapp')),
  inbound_id       uuid REFERENCES whatsapp.inbound(id) ON DELETE SET NULL,
  redacted_at      timestamptz,
  redacted_by      uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The path is bound to the item's own org/project: a client can never aim a row at another tenant's file.
  CHECK (storage_path LIKE organisation_id::text || '/' || project_id::text || '/%')
);
CREATE INDEX work_item_attachments_item_idx ON projects.work_item_attachments (work_item_id, created_at);

-- project_id / organisation_id are DERIVED from the item, never trusted from the caller.
CREATE FUNCTION projects.bind_work_item_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
BEGIN
  SELECT wi.project_id, wi.organisation_id INTO NEW.project_id, NEW.organisation_id
    FROM projects.work_items wi WHERE wi.id = NEW.work_item_id;
  IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'work item % not found', NEW.work_item_id; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION projects.bind_work_item_child() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_item_notes_bind BEFORE INSERT ON projects.work_item_notes
  FOR EACH ROW EXECUTE FUNCTION projects.bind_work_item_child();
CREATE TRIGGER work_item_attachments_bind BEFORE INSERT ON projects.work_item_attachments
  FOR EACH ROW EXECUTE FUNCTION projects.bind_work_item_child();

ALTER TABLE projects.work_item_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_item_notes_select ON projects.work_item_notes FOR SELECT TO authenticated
  USING (projects.user_can_read_work_item(work_item_id));
CREATE POLICY work_item_attachments_select ON projects.work_item_attachments FOR SELECT TO authenticated
  USING (projects.user_can_read_work_item(work_item_id));
REVOKE ALL ON projects.work_item_notes, projects.work_item_attachments FROM anon, authenticated;
GRANT SELECT ON projects.work_item_notes, projects.work_item_attachments TO authenticated;
GRANT ALL ON projects.work_item_notes, projects.work_item_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('work-item-attachments','work-item-attachments', false)
  ON CONFLICT (id) DO NOTHING;
-- Path convention: <org>/<project>/<work_item_id>/<file>. Writes happen only through the service role.
CREATE POLICY "work item attachments readable by item readers" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'work-item-attachments'
         AND (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$'
         AND projects.user_can_read_work_item(((storage.foldername(name))[3])::uuid));

-- ── acknowledged verb ──────────────────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'projects.work_item_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%verb%';
  IF c IS NULL THEN RAISE EXCEPTION 'work_item_events verb CHECK not found'; END IF;
  EXECUTE format('ALTER TABLE projects.work_item_events DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE projects.work_item_events ADD CONSTRAINT work_item_events_verb_check CHECK (verb IN
  ('created','assigned','reassigned','gatekeeper_changed','status_changed','due_changed',
   'closed','voided','acknowledged'));

-- ── per-project kill switch ────────────────────────────────────────────────
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS notify_whatsapp boolean NOT NULL DEFAULT false;

-- ── RLS + grants for the whatsapp schema ───────────────────────────────────
ALTER TABLE whatsapp.settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.phone_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.outbox          ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.inbound         ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.unknown_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY phone_links_select_own ON whatsapp.phone_links FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY outbox_select ON whatsapp.outbox FOR SELECT TO authenticated
  USING (work_item_id IS NOT NULL AND projects.user_can_read_work_item(work_item_id));
CREATE POLICY inbound_select ON whatsapp.inbound FOR SELECT TO authenticated
  USING (resolved_item_id IS NOT NULL AND projects.user_can_read_work_item(resolved_item_id));

REVOKE ALL ON ALL TABLES IN SCHEMA whatsapp FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA whatsapp TO service_role;
GRANT SELECT (id, user_id, phone_e164, status, verified_at, consent_at, quiet_start, quiet_end,
              undeliverable_reason, created_at) ON whatsapp.phone_links TO authenticated;
GRANT SELECT (id, work_item_id, trigger, status, error_code, error_text, created_at, sent_at, updated_at)
  ON whatsapp.outbox TO authenticated;
GRANT SELECT (id, received_at, kind, resolved_item_id, outcome, outcome_reason)
  ON whatsapp.inbound TO authenticated;

-- ═══ Part B: acting as the user ═══════════════════════════════════════════
-- whatsapp_actor OWNS the wa_* functions. It is a member of `authenticated` and
-- has no BYPASSRLS, so inside a wa_* function the table's REAL policies judge
-- the write. act_as() sets the user's claims first, so auth.uid(), every
-- auth.uid()-based helper and the work-item transition guard see the user.
-- Nothing here re-states a rule the web path enforces.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'whatsapp_actor') THEN
    CREATE ROLE whatsapp_actor NOLOGIN INHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT authenticated TO whatsapp_actor;
GRANT whatsapp_actor TO postgres;
GRANT USAGE, CREATE ON SCHEMA whatsapp TO whatsapp_actor;
GRANT INSERT ON projects.work_item_notes, projects.work_item_attachments TO whatsapp_actor;
GRANT UPDATE (body, redacted_at, redacted_by) ON projects.work_item_notes TO whatsapp_actor;
GRANT UPDATE (redacted_at, redacted_by) ON projects.work_item_attachments TO whatsapp_actor;

CREATE POLICY work_item_notes_insert_wa ON projects.work_item_notes FOR INSERT TO whatsapp_actor
  WITH CHECK (author_id = auth.uid() AND via = 'whatsapp'
              AND projects.user_can_read_work_item(work_item_id)
              AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer');
CREATE POLICY work_item_attachments_insert_wa ON projects.work_item_attachments FOR INSERT TO whatsapp_actor
  WITH CHECK (uploaded_by = auth.uid() AND via = 'whatsapp'
              AND projects.user_can_read_work_item(work_item_id)
              AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer');
CREATE POLICY work_item_notes_redact_wa ON projects.work_item_notes FOR UPDATE TO whatsapp_actor
  USING (author_id = auth.uid() AND redacted_at IS NULL AND created_at > now() - interval '15 minutes')
  WITH CHECK (redacted_by = auth.uid() AND redacted_at IS NOT NULL);
CREATE POLICY work_item_attachments_redact_wa ON projects.work_item_attachments FOR UPDATE TO whatsapp_actor
  USING (uploaded_by = auth.uid() AND redacted_at IS NULL AND created_at > now() - interval '15 minutes')
  WITH CHECK (redacted_by = auth.uid() AND redacted_at IS NOT NULL);

CREATE FUNCTION whatsapp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'act_as: a user is required'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION whatsapp.act_as(uuid) TO whatsapp_actor;

-- Events are trigger-written and `authenticated` has no INSERT, so the one verb
-- WhatsApp adds is written by this postgres-owned helper, gated on readability.
CREATE FUNCTION whatsapp.record_ack(p_item uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_wi    projects.work_items;
  v_last  record;
BEGIN
  IF v_actor IS NULL OR NOT projects.user_can_read_work_item(p_item) THEN RETURN false; END IF;
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;
  SELECT e.verb, e.actor_id INTO v_last FROM projects.work_item_events e
   WHERE e.work_item_id = p_item ORDER BY e.created_at DESC, e.seq DESC LIMIT 1;
  IF FOUND AND v_last.verb = 'acknowledged' AND v_last.actor_id = v_actor THEN RETURN true; END IF;
  INSERT INTO projects.work_item_events (work_item_id, project_id, organisation_id, verb, actor_id, actor_role,
                                         from_status, to_status, from_ball_in_court_id, to_ball_in_court_id)
  VALUES (p_item, v_wi.project_id, v_wi.organisation_id, 'acknowledged', v_actor,
          public.user_effective_project_role(v_wi.project_id, v_actor),
          v_wi.status, v_wi.status, v_wi.ball_in_court_id, v_wi.ball_in_court_id);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION whatsapp.record_ack(uuid) TO whatsapp_actor;

CREATE FUNCTION whatsapp.wa_acknowledge(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_wi projects.work_items; v_role text;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  v_role := public.user_effective_project_role(v_wi.project_id, p_user);
  IF v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access', 'ref', v_wi.ref);
  END IF;
  IF NOT whatsapp.record_ack(p_item) THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref, 'status', v_wi.status);
END $fn$;

CREATE FUNCTION whatsapp.wa_mark_done(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_wi projects.work_items; v_role text; v_target text; n int;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  v_role := public.user_effective_project_role(v_wi.project_id, p_user);
  IF v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access', 'ref', v_wi.ref);
  END IF;
  IF v_wi.status IN ('closed', 'void') THEN
    RETURN jsonb_build_object('code', 'already_closed', 'ref', v_wi.ref, 'status', v_wi.status);
  END IF;
  -- Mirrors take status FROM their source (#193 map_source_status). Phase 2
  -- (Task 21) replaces this arm with the snag and RFI adapters.
  IF v_wi.origin = 'mirror' THEN
    RETURN jsonb_build_object('code', 'use_module', 'ref', v_wi.ref, 'item_type', v_wi.item_type);
  END IF;
  IF v_wi.ball_in_court_id IS DISTINCT FROM p_user THEN
    RETURN jsonb_build_object('code', 'not_holder', 'ref', v_wi.ref,
      'holder_name', (SELECT full_name FROM public.profiles WHERE id = v_wi.ball_in_court_id));
  END IF;
  v_target := CASE WHEN v_wi.status = 'answered' OR v_wi.assignee_id = v_wi.gatekeeper_id
                   THEN 'closed' ELSE 'answered' END;
  BEGIN
    IF v_wi.status = 'triage' THEN
      UPDATE projects.work_items SET status = 'open' WHERE id = p_item AND status = 'triage';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
      v_wi.status := 'open';
    END IF;
    UPDATE projects.work_items SET status = v_target WHERE id = p_item AND status = v_wi.status;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    -- The guard's sentence ("Only the person who signs X off can close it…") is the message.
    RETURN jsonb_build_object('code', 'refused', 'ref', v_wi.ref, 'message', SQLERRM);
  END;
  IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref, 'status', v_target,
    'gatekeeper_name', (SELECT full_name FROM public.profiles WHERE id = v_wi.gatekeeper_id));
END $fn$;

CREATE FUNCTION whatsapp.wa_add_note(p_user uuid, p_item uuid, p_body text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ref text; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT ref INTO v_ref FROM projects.work_items WHERE id = p_item;       -- RLS, as the user
  IF v_ref IS NULL THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  BEGIN
    INSERT INTO projects.work_item_notes (work_item_id, author_id, body, via, inbound_id)
    VALUES (p_item, p_user, left(p_body, 4096), 'whatsapp', p_inbound)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_ref, 'id', v_id);
END $fn$;

CREATE FUNCTION whatsapp.wa_add_attachment(p_user uuid, p_item uuid, p_bucket text, p_path text,
                                           p_mime text, p_role text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ref text; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT ref INTO v_ref FROM projects.work_items WHERE id = p_item;       -- RLS, as the user
  IF v_ref IS NULL THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  BEGIN
    INSERT INTO projects.work_item_attachments (work_item_id, uploaded_by, bucket, storage_path, mime_type, role, via, inbound_id)
    VALUES (p_item, p_user, p_bucket, p_path, p_mime, p_role, 'whatsapp', p_inbound)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_ref, 'id', v_id);
END $fn$;

CREATE FUNCTION whatsapp.wa_redact(p_user uuid, p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n int := 0; v_ref text;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  BEGIN
    IF p_kind = 'note' THEN
      SELECT wi.ref INTO v_ref FROM projects.work_item_notes x JOIN projects.work_items wi ON wi.id = x.work_item_id WHERE x.id = p_id;
      UPDATE projects.work_item_notes SET body = '', redacted_at = now(), redacted_by = p_user
       WHERE id = p_id AND redacted_at IS NULL;
    ELSIF p_kind = 'attachment' THEN
      SELECT wi.ref INTO v_ref FROM projects.work_item_attachments x JOIN projects.work_items wi ON wi.id = x.work_item_id WHERE x.id = p_id;
      UPDATE projects.work_item_attachments SET redacted_at = now(), redacted_by = p_user
       WHERE id = p_id AND redacted_at IS NULL;
    ELSE
      RETURN jsonb_build_object('code', 'invalid');
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', CASE WHEN n = 1 THEN 'ok' ELSE 'refused' END, 'ref', v_ref);
END $fn$;

CREATE FUNCTION whatsapp.wa_open_items(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.due_date, x.ref) FROM (
      SELECT wi.id, wi.ref, wi.title, wi.due_date, p.name AS project_name
        FROM projects.work_items wi JOIN projects.projects p ON p.id = wi.project_id
       WHERE wi.ball_in_court_id = p_user AND wi.status IN ('triage', 'open', 'answered')
         AND COALESCE(public.user_effective_project_role(wi.project_id, p_user), 'client_viewer') <> 'client_viewer'
       ORDER BY wi.due_date, wi.ref LIMIT 10) x), '[]'::jsonb);
END $fn$;

-- Ownership + grants, written out one statement each: packages/db's static
-- scanners read this file's TEXT and cannot see a REVOKE built with format().
ALTER FUNCTION whatsapp.wa_acknowledge(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_mark_done(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_redact(uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_open_items(uuid) OWNER TO whatsapp_actor;
REVOKE ALL ON FUNCTION whatsapp.wa_acknowledge(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_mark_done(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_redact(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_open_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.wa_acknowledge(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_mark_done(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_redact(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_open_items(uuid) TO service_role;
