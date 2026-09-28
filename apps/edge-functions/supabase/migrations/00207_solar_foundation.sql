-- ---------------------------------------------------------------------------
-- Migration 00207: Solar add-on foundation
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §2–3; decisions D-01, D-02,
-- D-04 in docs/solar/06-open-decisions.md (owner, 2026-09-28).
--
-- WHAT. The access model for the paid Solar module, and its first table:
--   * billing.org_addon_subscriptions — an ORG-wide annual subscription
--     (R1,999/yr). Written only by the Paystack webhook (service role).
--   * solar.project_access — per-user level on a project: view / edit /
--     edit_financials, granted by the project org's owners/admins.
--   * solar.access_requests — "request access" / "ask an admin to subscribe".
--   * solar.studies — one per project; Site & Supply fields for Phase 1.
--   * solar.audit_events — append-only activity for the Overview tab.
--
-- ACCESS RULE (public.solar_access_level):
--   NULL unless the project's org has an active, in-date subscription;
--   'edit_financials' for owners/admins of the project's org;
--   NULL for non-members, client viewers and suppliers;
--   otherwise the caller's granted level (NULL when none).
-- LAPSE = HIDDEN BUT KEPT (D-02): every policy goes through the helper, so a
-- lapsed org reads and writes nothing while its rows stay untouched.
--
-- NEW SCHEMA CHECKLIST (00126): grants below (no anon), config.toml, AND the
-- production PostgREST db_schema PATCH at apply time — without the PATCH,
-- REST returns PGRST002 indefinitely.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: billing.org_addon_subscriptions
-- table: solar.project_access
-- table: solar.access_requests
-- table: solar.studies
-- table: solar.audit_events
-- function: public.org_has_solar(uuid)
-- function: public.solar_is_grantor(uuid)
-- function: public.solar_access_level(uuid)
-- function: public.solar_can_view(uuid)
-- function: public.solar_can_edit(uuid)
-- function: public.solar_can_see_money(uuid)
-- function: solar.project_access_bind()
-- function: solar.access_requests_guard()
-- function: solar.studies_bind()
-- function: solar.audit_events_bind()
-- trigger: project_access_bind ON solar.project_access
-- trigger: access_requests_guard ON solar.access_requests
-- trigger: studies_bind ON solar.studies
-- trigger: audit_events_bind ON solar.audit_events
-- policy: studies_select ON solar.studies PERMISSIVE
-- policy: studies_insert_authz ON solar.studies RESTRICTIVE
-- policy: studies_update_authz ON solar.studies RESTRICTIVE
-- policy: studies_delete_authz ON solar.studies RESTRICTIVE
-- grant_absent: anon SELECT ON solar.studies
-- grant_absent: anon SELECT ON solar.project_access
-- grant_absent: anon EXECUTE ON public.solar_access_level(uuid)
-- grant_absent: anon EXECUTE ON public.org_has_solar(uuid)
-- grant_absent: anon EXECUTE ON public.solar_is_grantor(uuid)
-- sql: (SELECT NOT has_schema_privilege('anon', 'solar', 'USAGE'))
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND p.polpermissive = false AND p.polcmd IN ('r', '*'))
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND c.relkind = 'r')
-- behaviour: scripts/db/assert-solar-foundation-roles.sql — every row ok
-- @verify:end

-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that "rolled-back" production
-- dry run permanent. (00205/00206 follow the same rule.)

-- ── 0. Schema and grants (no anon) ──────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS solar;
GRANT USAGE ON SCHEMA solar TO authenticated, service_role;
REVOKE ALL ON SCHEMA solar FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT USAGE ON SEQUENCES TO authenticated;

-- ── 1. The org subscription ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing.org_addon_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id             UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    feature_key                 TEXT NOT NULL CHECK (feature_key IN ('solar')),
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','non_renewing','past_due','cancelled','refunded')),
    amount_kobo                 BIGINT NOT NULL,
    current_period_end          TIMESTAMPTZ,
    paystack_customer_code      TEXT,
    paystack_subscription_code  TEXT UNIQUE,
    last_event_id               TEXT,
    started_at                  TIMESTAMPTZ,
    cancelled_at                TIMESTAMPTZ,
    refunded_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT org_addon_subscriptions_org_feature_key UNIQUE (organisation_id, feature_key)
);
CREATE TRIGGER org_addon_subscriptions_updated_at
    BEFORE UPDATE ON billing.org_addon_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE billing.org_addon_subscriptions ENABLE ROW LEVEL SECURITY;
-- Owners/admins of the org can see its subscription (00187 billing read gate).
-- No write policy: the webhook writes through the service role.
CREATE POLICY org_addon_subscriptions_select_owner_admin ON billing.org_addon_subscriptions
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_addon_subscriptions.organisation_id
           AND uo.is_active AND uo.role IN ('owner', 'admin')));
GRANT SELECT ON billing.org_addon_subscriptions TO authenticated;
GRANT ALL ON billing.org_addon_subscriptions TO service_role;
REVOKE ALL ON billing.org_addon_subscriptions FROM anon;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_has_solar(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid   -- WM-Consulting bypass, as has_feature
        OR EXISTS (
            SELECT 1 FROM billing.org_addon_subscriptions s
             WHERE s.organisation_id = p_org_id AND s.feature_key = 'solar'
               AND s.status IN ('active', 'non_renewing')
               AND s.current_period_end > NOW());
$$;

CREATE OR REPLACE FUNCTION public.solar_is_grantor(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.projects p
          JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
         WHERE p.id = p_project_id AND uo.user_id = auth.uid()
           AND uo.is_active AND uo.role IN ('owner', 'admin'));
$$;

CREATE OR REPLACE FUNCTION public.solar_access_level(p_project_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_org  UUID;
    v_role TEXT;
BEGIN
    SELECT organisation_id INTO v_org FROM projects.projects WHERE id = p_project_id;
    IF v_org IS NULL OR NOT public.org_has_solar(v_org) THEN RETURN NULL; END IF;
    IF public.solar_is_grantor(p_project_id) THEN RETURN 'edit_financials'; END IF;
    v_role := COALESCE(public.user_effective_project_role(p_project_id), '');
    IF v_role IN ('', 'client_viewer', 'supplier') THEN RETURN NULL; END IF;
    RETURN (SELECT pa.level FROM solar.project_access pa
             WHERE pa.project_id = p_project_id AND pa.user_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.solar_can_view(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.solar_access_level(p_project_id) IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION public.solar_can_edit(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(public.solar_access_level(p_project_id) IN ('edit', 'edit_financials'), false);
$$;
CREATE OR REPLACE FUNCTION public.solar_can_see_money(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(public.solar_access_level(p_project_id) = 'edit_financials', false);
$$;

-- Spelled out per function (not an EXECUTE format() loop): the repo-wide
-- anon-EXECUTE guard reads the migration TEXT and cannot see a dynamic REVOKE.
REVOKE ALL ON FUNCTION public.org_has_solar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_has_solar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_has_solar(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.solar_is_grantor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_is_grantor(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_is_grantor(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.solar_access_level(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_access_level(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_access_level(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.solar_can_view(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_can_view(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_can_view(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.solar_can_edit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_can_edit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_can_edit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.solar_can_see_money(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_can_see_money(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_can_see_money(uuid) TO authenticated, service_role;

-- ── 3. Per-user project access ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.project_access (
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    level            TEXT NOT NULL CHECK (level IN ('view', 'edit', 'edit_financials')),
    granted_by       UUID REFERENCES auth.users(id),
    granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- Binds organisation_id and granted_by; refuses grants to non-members,
-- client viewers and suppliers (a client never sees internal Solar data).
CREATE OR REPLACE FUNCTION solar.project_access_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.project_access: project % not found', NEW.project_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.project_members pm
                    WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.user_id
                      AND pm.is_active AND pm.role NOT IN ('client_viewer', 'supplier')) THEN
        RAISE EXCEPTION 'solar.project_access: user is not an eligible member of this project' USING ERRCODE = '23514';
    END IF;
    IF auth.uid() IS NOT NULL THEN NEW.granted_by := auth.uid(); END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.project_access_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.project_access_bind() FROM anon;
CREATE TRIGGER project_access_bind BEFORE INSERT OR UPDATE ON solar.project_access
    FOR EACH ROW EXECUTE FUNCTION solar.project_access_bind();

ALTER TABLE solar.project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.project_access FORCE ROW LEVEL SECURITY;
-- Grantors see every grant on the project; a user sees their own.
CREATE POLICY project_access_select ON solar.project_access FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.solar_is_grantor(project_id));
CREATE POLICY project_access_insert ON solar.project_access FOR INSERT TO authenticated
    WITH CHECK (public.solar_is_grantor(project_id));
CREATE POLICY project_access_update ON solar.project_access FOR UPDATE TO authenticated
    USING (public.solar_is_grantor(project_id)) WITH CHECK (public.solar_is_grantor(project_id));
CREATE POLICY project_access_delete ON solar.project_access FOR DELETE TO authenticated
    USING (public.solar_is_grantor(project_id));

-- ── 4. Access requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.access_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    requester_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('access', 'subscribe')),
    requested_level  TEXT CHECK (requested_level IN ('view', 'edit', 'edit_financials')),
    approved_level   TEXT CHECK (approved_level IN ('view', 'edit', 'edit_financials')),
    note             TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
    decided_by       UUID REFERENCES auth.users(id),
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending
    ON solar.access_requests (project_id, requester_id, kind) WHERE status = 'pending';

-- INSERT: requester, org and status are bound, never trusted.
-- UPDATE: a requester may only withdraw their own pending request; a grantor
-- may approve (with approved_level) or decline. Approval writes the grant.
CREATE OR REPLACE FUNCTION solar.access_requests_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF auth.uid() IS NOT NULL THEN NEW.requester_id := auth.uid(); END IF;
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        NEW.status := 'pending'; NEW.approved_level := NULL; NEW.decided_by := NULL; NEW.decided_at := NULL;
        RETURN NEW;
    END IF;
    IF NEW.project_id <> OLD.project_id OR NEW.requester_id <> OLD.requester_id OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'access_requests: identity columns are immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'access_requests: request already %', OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'withdrawn' THEN
        IF auth.uid() IS DISTINCT FROM OLD.requester_id THEN
            RAISE EXCEPTION 'access_requests: only the requester may withdraw' USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.status IN ('approved', 'declined') THEN
        IF auth.uid() IS NOT NULL AND NOT public.solar_is_grantor(NEW.project_id) THEN
            RAISE EXCEPTION 'access_requests: only an org owner/admin may decide' USING ERRCODE = '42501';
        END IF;
        NEW.decided_by := auth.uid(); NEW.decided_at := NOW();
        IF NEW.status = 'approved' AND NEW.kind = 'access' THEN
            IF NEW.approved_level IS NULL THEN
                RAISE EXCEPTION 'access_requests: approved_level is required' USING ERRCODE = '23514';
            END IF;
            INSERT INTO solar.project_access (project_id, user_id, level)
            VALUES (NEW.project_id, NEW.requester_id, NEW.approved_level)
            ON CONFLICT (project_id, user_id) DO UPDATE SET level = EXCLUDED.level;
        END IF;
    ELSIF NEW.status <> 'pending' THEN
        RAISE EXCEPTION 'access_requests: invalid status %', NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.access_requests_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.access_requests_guard() FROM anon;
CREATE TRIGGER access_requests_guard BEFORE INSERT OR UPDATE ON solar.access_requests
    FOR EACH ROW EXECUTE FUNCTION solar.access_requests_guard();

ALTER TABLE solar.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY access_requests_select ON solar.access_requests FOR SELECT TO authenticated
    USING (requester_id = auth.uid() OR public.solar_is_grantor(project_id));
CREATE POLICY access_requests_insert ON solar.access_requests FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id)
                AND COALESCE(public.user_effective_project_role(project_id), '') NOT IN ('', 'client_viewer', 'supplier'));
CREATE POLICY access_requests_update ON solar.access_requests FOR UPDATE TO authenticated
    USING (requester_id = auth.uid() OR public.solar_is_grantor(project_id))
    WITH CHECK (requester_id = auth.uid() OR public.solar_is_grantor(project_id));

-- ── 5. Studies (Phase 1 columns: Site & Supply) ─────────────────────────────
CREATE TABLE IF NOT EXISTS solar.studies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL UNIQUE REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    latitude            NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
    longitude           NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
    elevation_m         NUMERIC(7,1),
    licensee_name       TEXT,           -- becomes licensee_id → tariffs.licensee in Phase 2
    supply_type         TEXT CHECK (supply_type IN ('eskom_direct', 'municipal', 'private_resale')),
    nmd_kva             NUMERIC(10,2) CHECK (nmd_kva > 0),
    supply_voltage_v    INTEGER CHECK (supply_voltage_v > 0),
    poc_node_id         UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    export_mode         TEXT CHECK (export_mode IN ('net_billing', 'no_credit', 'zero_export')),
    export_limit_kw     NUMERIC(10,2) CHECK (export_limit_kw >= 0),
    constraints_note    TEXT,
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION solar.studies_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.studies: project % not found', NEW.project_id USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'INSERT' THEN NEW.created_by := COALESCE(auth.uid(), NEW.created_by); END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.studies_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_bind() FROM anon;
CREATE TRIGGER studies_bind BEFORE INSERT OR UPDATE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_bind();

ALTER TABLE solar.studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.studies FORCE ROW LEVEL SECURITY;
-- Exactly one policy covers SELECT. Writes: permissive membership + RESTRICTIVE
-- level gate, one per verb (never RESTRICTIVE FOR ALL — it narrows reads, 00205).
CREATE POLICY studies_select ON solar.studies FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY studies_insert ON solar.studies FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY studies_update ON solar.studies FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY studies_delete ON solar.studies FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY studies_insert_authz ON solar.studies AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY studies_update_authz ON solar.studies AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY studies_delete_authz ON solar.studies AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));   -- deleting a whole study: owner/admin/edit_financials only

-- ── 6. Audit events (append-only) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.audit_events (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    verb             TEXT NOT NULL CHECK (length(btrim(verb)) > 0),
    object_ref       JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id         UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_project_created_idx ON solar.audit_events (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION solar.audit_events_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF auth.uid() IS NOT NULL THEN NEW.actor_id := auth.uid(); END IF;
    NEW.created_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.audit_events_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.audit_events_bind() FROM anon;
CREATE TRIGGER audit_events_bind BEFORE INSERT ON solar.audit_events
    FOR EACH ROW EXECUTE FUNCTION solar.audit_events_bind();

ALTER TABLE solar.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_select ON solar.audit_events FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY audit_events_insert ON solar.audit_events FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
-- No UPDATE / DELETE policy: append-only.

-- ── 7. Table grants (explicit; the default privileges only cover future tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.project_access, solar.access_requests, solar.studies TO authenticated;
GRANT SELECT, INSERT ON solar.audit_events TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA solar TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA solar TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA solar FROM anon;

NOTIFY pgrst, 'reload schema';
