-- ---------------------------------------------------------------------------
-- Migration 00216: Solar reports and client proposals (Phase 6)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §9, §15, §2.2; docs/solar/03-data-model-and-security.md
-- §3 (proposals, proposal_events), §3.1, §5 items 5-7; decisions D-15, D-17, D-18.
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-6-1-schema.md
--
-- WHAT
--   * solar.proposal_templates  per-org terms, disclaimer and default validity (owner/admin write).
--   * solar.proposals           money table. Drafts are edited through the user's session; every
--                               status change happens in a SERVICE-ONLY definer function. Once
--                               issued, the snapshot, PDF path, PDF hash, expiry and draft are frozen.
--   * solar.proposal_events     append-only evidence (issued / viewed / accepted / declined /
--                               withdrawn / link_rotated). No UPDATE for anyone; no DELETE grant.
--   * Service-only client functions: solar_proposal_by_token, solar_proposal_respond_by_token,
--     solar_portal_proposals, solar_portal_proposal, solar_portal_respond. The raw token is hashed
--     IN SQL; only the SHA-256 hex is ever stored (CHECK). No anon grant exists anywhere.
--   * Service-only state changes: solar_issue_proposal, solar_withdraw_proposal,
--     solar_rotate_proposal_link.
--   * public.solar_portfolio(org): the §15 portfolio rows the caller may see.
--   * public.user_can_read_report_kind(): Solar kinds read on the Solar level (layout sheet and
--     technical on View; feasibility and proposal on Edit + financials).
--   * projects.project_settings.notify_solar_email; two notification types; six product events.
--   * Solar PDFs in bucket 'reports' (<org>/<project>/solar-reports/ and /solar-proposals/) are
--     SERVICE-ONLY: per-verb RESTRICTIVE storage.objects policies refuse them to every session
--     role (00117's bucket policies admit any org member). No session inserts or updates a Solar
--     report row (kind solar_*) or any row whose storage_path is a Solar PDF (00117 reports_write
--     is FOR ALL, and the report-URL action service-signs a row's path after gating on its kind);
--     the solar_proposal row cannot be deleted through a session either.
--   * A study or case that an issued proposal depends on cannot be deleted directly; a project
--     delete (an FK cascade, trigger depth > 1) still removes everything.
-- RULES
--   * 00207's schema-wide directives hold: FORCE RLS on every solar table, no RESTRICTIVE read
--     policy in schema solar, every SECURITY DEFINER function revoked from anon.
--   * Per-verb write policies only (never RESTRICTIVE FOR ALL: it narrows reads too, the 00205 lesson).
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.proposal_templates
-- table: solar.proposals
-- table: solar.proposal_events
-- constraint: proposals_token_is_hash ON solar.proposals
-- constraint: proposals_frozen_when_issued ON solar.proposals
-- constraint: proposals_draft_unfrozen ON solar.proposals
-- index: proposals_family_version_uniq ON solar.proposals
-- index: proposals_one_draft_per_family ON solar.proposals
-- index: proposals_token_hash_uniq ON solar.proposals
-- function: solar.proposal_templates_bind()
-- function: solar.proposals_guard()
-- function: solar.proposal_events_bind()
-- function: solar.proposal_events_append_only()
-- function: solar.proposal_effective_status(text, timestamptz)
-- function: solar.proposal_hash_token(text)
-- function: solar.proposal_client_view(uuid, text, text, text)
-- function: solar.proposal_record_response(uuid, text, uuid, text, text, text, boolean, text, text, text, text)
-- function: solar.is_portal_member(uuid, uuid)
-- function: public.solar_proposal_by_token(text, text, text)
-- function: public.solar_proposal_respond_by_token(text, text, text, text, boolean, text, text, text, text)
-- function: public.solar_portal_proposals(uuid, uuid)
-- function: public.solar_portal_proposal(uuid, uuid, uuid, text, text)
-- function: public.solar_portal_respond(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)
-- function: public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)
-- function: public.solar_withdraw_proposal(uuid, uuid)
-- function: public.solar_rotate_proposal_link(uuid, text, uuid)
-- function: public.solar_portfolio(uuid)
-- function: public.user_can_read_report_kind(uuid, text)
-- function: public.report_kind_is_sensitive(text)
-- trigger: proposal_templates_bind ON solar.proposal_templates
-- trigger: proposals_guard ON solar.proposals
-- trigger: proposal_events_bind ON solar.proposal_events
-- trigger: proposal_events_append_only ON solar.proposal_events
-- function: solar.studies_keep_issued_proposals()
-- function: solar.cases_keep_issued_proposals()
-- trigger: studies_keep_issued_proposals ON solar.studies
-- trigger: cases_keep_issued_proposals ON solar.cases
-- policy: solar_pdfs_service_only_select ON storage.objects RESTRICTIVE
-- policy: solar_pdfs_service_only_insert ON storage.objects RESTRICTIVE
-- policy: solar_pdfs_service_only_update ON storage.objects RESTRICTIVE
-- policy: solar_pdfs_service_only_delete ON storage.objects RESTRICTIVE
-- policy: reports_solar_service_only_insert ON projects.reports RESTRICTIVE
-- policy: reports_solar_service_only_update ON projects.reports RESTRICTIVE
-- policy: reports_solar_proposal_delete_authz ON projects.reports RESTRICTIVE
-- policy: proposal_templates_select ON solar.proposal_templates PERMISSIVE
-- policy: proposal_templates_insert ON solar.proposal_templates PERMISSIVE
-- policy: proposal_templates_update ON solar.proposal_templates PERMISSIVE
-- policy: proposal_templates_insert_authz ON solar.proposal_templates RESTRICTIVE
-- policy: proposal_templates_update_authz ON solar.proposal_templates RESTRICTIVE
-- policy: proposals_select ON solar.proposals PERMISSIVE
-- policy: proposals_insert ON solar.proposals PERMISSIVE
-- policy: proposals_update ON solar.proposals PERMISSIVE
-- policy: proposals_delete ON solar.proposals PERMISSIVE
-- policy: proposals_insert_authz ON solar.proposals RESTRICTIVE
-- policy: proposals_update_authz ON solar.proposals RESTRICTIVE
-- policy: proposals_delete_authz ON solar.proposals RESTRICTIVE
-- policy: proposal_events_select ON solar.proposal_events PERMISSIVE
-- column: projects.project_settings.notify_solar_email
-- grant_absent: anon SELECT ON solar.proposals
-- grant_absent: anon SELECT ON solar.proposal_events
-- grant_absent: anon SELECT ON solar.proposal_templates
-- grant_absent: authenticated INSERT ON solar.proposal_events
-- grant_absent: authenticated UPDATE ON solar.proposal_events
-- grant_absent: authenticated DELETE ON solar.proposal_events
-- grant_absent: service_role DELETE ON solar.proposal_events
-- grant_absent: authenticated DELETE ON solar.proposal_templates
-- grant_absent: anon EXECUTE ON public.solar_proposal_by_token(text, text, text)
-- grant_absent: authenticated EXECUTE ON public.solar_proposal_by_token(text, text, text)
-- grant_absent: authenticated EXECUTE ON public.solar_proposal_respond_by_token(text, text, text, text, boolean, text, text, text, text)
-- grant_absent: authenticated EXECUTE ON public.solar_portal_proposals(uuid, uuid)
-- grant_absent: authenticated EXECUTE ON public.solar_portal_proposal(uuid, uuid, uuid, text, text)
-- grant_absent: authenticated EXECUTE ON public.solar_portal_respond(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)
-- grant_absent: authenticated EXECUTE ON public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)
-- grant_absent: authenticated EXECUTE ON public.solar_withdraw_proposal(uuid, uuid)
-- grant_absent: authenticated EXECUTE ON public.solar_rotate_proposal_link(uuid, text, uuid)
-- grant_present: service_role EXECUTE ON public.solar_proposal_by_token(text, text, text)
-- grant_present: authenticated EXECUTE ON public.solar_portfolio(uuid)
-- anon_execute_absent: ALL prosecdef functions in solar
-- grant_absent: anon EXECUTE ON public.solar_proposal_respond_by_token(text, text, text, text, boolean, text, text, text, text)
-- grant_absent: anon EXECUTE ON public.solar_portal_proposals(uuid, uuid)
-- grant_absent: anon EXECUTE ON public.solar_portal_proposal(uuid, uuid, uuid, text, text)
-- grant_absent: anon EXECUTE ON public.solar_portal_respond(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)
-- grant_absent: anon EXECUTE ON public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)
-- grant_absent: anon EXECUTE ON public.solar_withdraw_proposal(uuid, uuid)
-- grant_absent: anon EXECUTE ON public.solar_rotate_proposal_link(uuid, text, uuid)
-- grant_absent: anon EXECUTE ON public.solar_portfolio(uuid)
-- grant_absent: anon EXECUTE ON public.user_can_read_report_kind(uuid, text)
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('proposals', 'proposal_events') AND cmd = 'SELECT')
-- sql: (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'proposals' AND permissive = 'RESTRICTIVE' AND strpos(coalesce(qual, '') || coalesce(with_check, ''), 'solar_can_see_money') > 0)
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('proposals', 'proposal_events', 'proposal_templates') AND cmd = 'ALL')
-- sql: (SELECT prosrc LIKE '%solar_feasibility%' AND prosrc LIKE '%solar_proposal%' FROM pg_proc WHERE oid = 'public.report_kind_is_sensitive(text)'::regprocedure)
-- sql: (SELECT prosrc LIKE '%solar_feasibility%' AND prosrc LIKE '%solar_technical%' AND prosrc LIKE '%solar_proposal%' AND prosrc LIKE '%solar_layout_sheet%' FROM pg_proc WHERE oid = 'public.user_can_read_report_kind(uuid, text)'::regprocedure)
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_proposal_accepted%' AND pg_get_constraintdef(oid) LIKE '%solar_proposal_declined%' AND pg_get_constraintdef(oid) LIKE '%solar_access_declined%' AND pg_get_constraintdef(oid) LIKE '%site_form_distributed%' FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check')
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_report_generated%' AND pg_get_constraintdef(oid) LIKE '%solar_proposal_issued%' AND pg_get_constraintdef(oid) LIKE '%solar_narrative_drafted%' AND pg_get_constraintdef(oid) LIKE '%solar_equipment_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- sql: (SELECT count(DISTINCT cmd) = 4 AND count(*) = 4 AND bool_and(strpos(coalesce(qual, '') || coalesce(with_check, ''), 'solar-(reports|proposals)') > 0) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'solar_pdfs_service_only_%' AND permissive = 'RESTRICTIVE' AND cmd <> 'ALL')
-- sql: (SELECT count(*) = 2 AND bool_and(strpos(coalesce(with_check, ''), 'solar-(reports|proposals)') > 0 AND strpos(coalesce(with_check, ''), 'solar\_%') > 0) AND bool_and(cmd = 'INSERT' OR strpos(coalesce(qual, ''), 'solar-(reports|proposals)') > 0) FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'reports' AND policyname LIKE 'reports_solar_service_only_%' AND permissive = 'RESTRICTIVE' AND cmd IN ('INSERT', 'UPDATE'))
-- sql: (SELECT prosrc LIKE '%family_accepted%' FROM pg_proc WHERE oid = 'public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)'::regprocedure)
-- sql: (SELECT prosrc LIKE '%family_accepted%' FROM pg_proc WHERE oid = 'solar.proposal_record_response(uuid, text, uuid, text, text, text, boolean, text, text, text, text)'::regprocedure)
-- sql: (SELECT prosrc LIKE '%uo.organisation_id%' FROM pg_proc WHERE oid = 'solar.is_portal_member(uuid, uuid)'::regprocedure)
-- behaviour: scripts/db/assert-solar-proposals-roles.sql, every row ok
-- @verify:end

-- NO BEGIN/COMMIT: scripts/db/dry-run-migration.sh wraps this file in BEGIN … ROLLBACK.

-- ── 1. Proposal templates (org) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.proposal_templates (
    organisation_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
    terms_text       TEXT NOT NULL DEFAULT '' CHECK (length(terms_text) <= 20000),
    disclaimer_text  TEXT NOT NULL DEFAULT '' CHECK (length(disclaimer_text) <= 5000),
    validity_days    INTEGER NOT NULL DEFAULT 30 CHECK (validity_days BETWEEN 1 AND 365),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION solar.proposal_templates_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.proposal_templates: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    ELSE
        NEW.created_at := NOW();
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.proposal_templates_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_templates_bind() FROM anon;
CREATE TRIGGER proposal_templates_bind BEFORE INSERT OR UPDATE ON solar.proposal_templates
    FOR EACH ROW EXECUTE FUNCTION solar.proposal_templates_bind();

ALTER TABLE solar.proposal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.proposal_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_templates_select ON solar.proposal_templates FOR SELECT TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('edit_financials')));
CREATE POLICY proposal_templates_insert ON solar.proposal_templates FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY (solar.library_orgs('edit_financials')));
CREATE POLICY proposal_templates_update ON solar.proposal_templates FOR UPDATE TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('edit_financials')))
    WITH CHECK (organisation_id = ANY (solar.library_orgs('edit_financials')));
CREATE POLICY proposal_templates_insert_authz ON solar.proposal_templates AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY (solar.library_orgs('admin')));
CREATE POLICY proposal_templates_update_authz ON solar.proposal_templates AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY (solar.library_orgs('admin')))
    WITH CHECK (organisation_id = ANY (solar.library_orgs('admin')));

-- ── 2. Proposals (money) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.proposals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id          UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id   UUID NOT NULL REFERENCES public.organisations(id),
    family_id         UUID NOT NULL,
    version           INTEGER NOT NULL CHECK (version >= 1),
    case_id           UUID REFERENCES solar.cases(id) ON DELETE SET NULL,
    case_run_id       UUID REFERENCES solar.case_runs(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'issued', 'viewed', 'accepted', 'declined', 'withdrawn')),
    draft             JSONB NOT NULL DEFAULT '{}'::jsonb CONSTRAINT proposals_draft_is_object CHECK (jsonb_typeof(draft) = 'object'),
    snapshot          JSONB CONSTRAINT proposals_snapshot_is_object CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'),
    pdf_path          TEXT,
    pdf_sha256        TEXT CONSTRAINT proposals_pdf_sha256_hex CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
    report_id         UUID REFERENCES projects.reports(id) ON DELETE SET NULL,
    -- SHA-256 hex of the 43-char base64url token. A raw token cannot satisfy this.
    share_token_hash  TEXT CONSTRAINT proposals_token_is_hash CHECK (share_token_hash IS NULL OR share_token_hash ~ '^[0-9a-f]{64}$'),
    expires_at        TIMESTAMPTZ,
    issued_by         UUID REFERENCES auth.users(id),
    issued_at         TIMESTAMPTZ,
    withdrawn_by      UUID REFERENCES auth.users(id),
    withdrawn_at      TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    created_by        UUID REFERENCES auth.users(id),
    updated_by        UUID REFERENCES auth.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT proposals_frozen_when_issued CHECK (status = 'draft' OR (snapshot IS NOT NULL AND pdf_path IS NOT NULL
        AND pdf_sha256 IS NOT NULL AND share_token_hash IS NOT NULL AND expires_at IS NOT NULL AND issued_at IS NOT NULL)),
    CONSTRAINT proposals_draft_unfrozen CHECK (status <> 'draft' OR (snapshot IS NULL AND pdf_path IS NULL
        AND pdf_sha256 IS NULL AND share_token_hash IS NULL AND issued_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_family_version_uniq ON solar.proposals (family_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_one_draft_per_family ON solar.proposals (family_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS proposals_token_hash_uniq ON solar.proposals (share_token_hash) WHERE share_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposals_project_idx ON solar.proposals (project_id, created_at DESC);

-- One trigger binds, versions and guards. Depth > 1 is an FK action (a project/study cascade, a
-- case/run/report SET NULL) and passes untouched; every direct statement is depth 1.
CREATE OR REPLACE FUNCTION solar.proposals_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_max INTEGER;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'solar.proposals: an issued proposal is kept as evidence and cannot be deleted' USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.proposals: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        IF NEW.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM solar.cases c WHERE c.id = NEW.case_id AND c.study_id = NEW.study_id) THEN
            RAISE EXCEPTION 'solar.proposals: the case belongs to another study' USING ERRCODE = '23514';
        END IF;
        IF NEW.family_id IS NULL THEN
            NEW.family_id := NEW.id;
            NEW.version := 1;
        ELSE
            SELECT max(p.version) INTO v_max FROM solar.proposals p
             WHERE p.family_id = NEW.family_id AND p.study_id = NEW.study_id;
            IF v_max IS NULL THEN
                RAISE EXCEPTION 'solar.proposals: proposal family not found in this study' USING ERRCODE = '23503';
            END IF;
            IF EXISTS (SELECT 1 FROM solar.proposals p WHERE p.family_id = NEW.family_id AND p.status = 'accepted') THEN
                RAISE EXCEPTION 'solar.proposals: an accepted proposal cannot be revised' USING ERRCODE = '23514';
            END IF;
            NEW.version := v_max + 1;
        END IF;
        NEW.status := 'draft';
        NEW.snapshot := NULL; NEW.pdf_path := NULL; NEW.pdf_sha256 := NULL; NEW.report_id := NULL;
        NEW.share_token_hash := NULL; NEW.expires_at := NULL; NEW.case_run_id := NULL;
        NEW.issued_by := NULL; NEW.issued_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_at := NULL;
        NEW.responded_at := NULL;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.updated_by := NEW.created_by;
        NEW.created_at := NOW();
        NEW.updated_at := NOW();
        RETURN NEW;
    END IF;

    -- UPDATE
    IF (NEW.id, NEW.study_id, NEW.project_id, NEW.organisation_id, NEW.family_id, NEW.version, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.study_id, OLD.project_id, OLD.organisation_id, OLD.family_id, OLD.version, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'solar.proposals: the identity of a proposal is immutable' USING ERRCODE = '42501';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
        IF NEW.case_id IS DISTINCT FROM OLD.case_id AND NEW.case_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM solar.cases c WHERE c.id = NEW.case_id AND c.study_id = NEW.study_id) THEN
            RAISE EXCEPTION 'solar.proposals: the case belongs to another study' USING ERRCODE = '23514';
        END IF;
        NEW.case_run_id := NULL;
    ELSE
        IF auth.uid() IS NOT NULL THEN
            RAISE EXCEPTION 'solar.proposals: only E-Site can change an issued proposal' USING ERRCODE = '42501';
        END IF;
        IF NOT (
            (OLD.status = 'draft' AND NEW.status = 'issued')
            OR (OLD.status IN ('issued', 'viewed') AND NEW.status IN ('viewed', 'accepted', 'declined', 'withdrawn'))
            OR (OLD.status IN ('issued', 'viewed') AND NEW.status = OLD.status)
        ) THEN
            RAISE EXCEPTION 'solar.proposals: invalid status change % to %', OLD.status, NEW.status USING ERRCODE = '23514';
        END IF;
        IF OLD.status <> 'draft' AND
           (NEW.snapshot, NEW.pdf_path, NEW.pdf_sha256, NEW.issued_by, NEW.issued_at, NEW.expires_at, NEW.draft,
            NEW.case_id, NEW.case_run_id, NEW.report_id)
           IS DISTINCT FROM
           (OLD.snapshot, OLD.pdf_path, OLD.pdf_sha256, OLD.issued_by, OLD.issued_at, OLD.expires_at, OLD.draft,
            OLD.case_id, OLD.case_run_id, OLD.report_id) THEN
            RAISE EXCEPTION 'solar.proposals: an issued proposal is immutable' USING ERRCODE = '42501';
        END IF;
        IF NEW.status IN ('accepted', 'declined') AND OLD.expires_at <= NOW() THEN
            RAISE EXCEPTION 'solar.proposals: the proposal has expired' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.proposals_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposals_guard() FROM anon;
CREATE TRIGGER proposals_guard BEFORE INSERT OR UPDATE OR DELETE ON solar.proposals
    FOR EACH ROW EXECUTE FUNCTION solar.proposals_guard();

ALTER TABLE solar.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY proposals_select ON solar.proposals FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
CREATE POLICY proposals_insert ON solar.proposals FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY proposals_update ON solar.proposals FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY proposals_delete ON solar.proposals FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY proposals_insert_authz ON solar.proposals AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY proposals_update_authz ON solar.proposals AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY proposals_delete_authz ON solar.proposals AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));

-- An issued proposal's study and case are its provenance. Deleting either directly would cascade the
-- evidence away (study) or null its case reference (case) through the depth > 1 bypass above, so both
-- are refused while a non-draft proposal depends on them. Depth > 1 (a project-delete cascade) passes.
CREATE OR REPLACE FUNCTION solar.studies_keep_issued_proposals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM solar.proposals p WHERE p.study_id = OLD.id AND p.status <> 'draft') THEN
        RAISE EXCEPTION 'solar.studies: an issued proposal depends on this study and is kept as evidence' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION solar.studies_keep_issued_proposals() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_keep_issued_proposals() FROM anon;
CREATE TRIGGER studies_keep_issued_proposals BEFORE DELETE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_keep_issued_proposals();

CREATE OR REPLACE FUNCTION solar.cases_keep_issued_proposals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM solar.proposals p WHERE p.case_id = OLD.id AND p.status <> 'draft') THEN
        RAISE EXCEPTION 'solar.cases: an issued proposal depends on this case and is kept as evidence' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION solar.cases_keep_issued_proposals() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.cases_keep_issued_proposals() FROM anon;
CREATE TRIGGER cases_keep_issued_proposals BEFORE DELETE ON solar.cases
    FOR EACH ROW EXECUTE FUNCTION solar.cases_keep_issued_proposals();

-- ── 3. Proposal events (append-only evidence) ───────────────────────────────
CREATE TABLE IF NOT EXISTS solar.proposal_events (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proposal_id          UUID NOT NULL REFERENCES solar.proposals(id) ON DELETE CASCADE,
    project_id           UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
    kind                 TEXT NOT NULL CHECK (kind IN ('issued', 'viewed', 'accepted', 'declined', 'withdrawn', 'link_rotated')),
    via                  TEXT NOT NULL CHECK (via IN ('app', 'token', 'portal')),
    actor_user_id        UUID REFERENCES auth.users(id),
    actor_name           TEXT CHECK (actor_name IS NULL OR length(actor_name) <= 200),
    actor_email          TEXT CHECK (actor_email IS NULL OR length(actor_email) <= 254),
    authority_confirmed  BOOLEAN,
    signature_png        TEXT CHECK (signature_png IS NULL OR (length(signature_png) <= 400000 AND signature_png LIKE 'data:image/png;base64,%')),
    reason               TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
    ip                   TEXT CHECK (ip IS NULL OR length(ip) <= 64),
    user_agent           TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 512),
    pdf_sha256           TEXT CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
    at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposal_events_proposal_idx ON solar.proposal_events (proposal_id, at);

CREATE OR REPLACE FUNCTION solar.proposal_events_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT p.project_id, p.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.proposals p WHERE p.id = NEW.proposal_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.proposal_events: proposal % not found', NEW.proposal_id USING ERRCODE = '23503';
    END IF;
    NEW.at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.proposal_events_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_events_bind() FROM anon;
CREATE TRIGGER proposal_events_bind BEFORE INSERT ON solar.proposal_events
    FOR EACH ROW EXECUTE FUNCTION solar.proposal_events_bind();

CREATE OR REPLACE FUNCTION solar.proposal_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'solar.proposal_events: evidence is append-only' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION solar.proposal_events_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_events_append_only() FROM anon;
CREATE TRIGGER proposal_events_append_only BEFORE UPDATE ON solar.proposal_events
    FOR EACH ROW EXECUTE FUNCTION solar.proposal_events_append_only();

ALTER TABLE solar.proposal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.proposal_events FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_events_select ON solar.proposal_events FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
-- No INSERT/UPDATE/DELETE policy: events are written only by the definer functions below.

-- ── 4. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION solar.proposal_effective_status(p_status TEXT, p_expires_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT CASE WHEN p_status IN ('issued', 'viewed') AND p_expires_at IS NOT NULL AND p_expires_at <= now()
                THEN 'expired' ELSE p_status END;
$$;
REVOKE ALL ON FUNCTION solar.proposal_effective_status(TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_effective_status(TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION solar.proposal_effective_status(TEXT, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION solar.proposal_hash_token(p_token TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION solar.proposal_hash_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_hash_token(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION solar.proposal_hash_token(TEXT) TO service_role;

-- The client's view of one proposal: ONLY the frozen snapshot and its evidence fields.
-- Marks an issued proposal viewed (once). Internal: called by the service-only entry points.
CREATE OR REPLACE FUNCTION solar.proposal_client_view(p_id UUID, p_via TEXT, p_ip TEXT, p_ua TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p      solar.proposals%ROWTYPE;
    v_eff  TEXT;
    v_resp JSONB;
BEGIN
    SELECT * INTO p FROM solar.proposals WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR p.status = 'draft' THEN
        RETURN jsonb_build_object('state', 'not_found');
    END IF;
    v_eff := solar.proposal_effective_status(p.status, p.expires_at);
    IF v_eff IN ('withdrawn', 'expired') THEN
        RETURN jsonb_build_object('state', v_eff, 'issuer', p.snapshot -> 'issuer', 'version', p.version);
    END IF;
    IF p.status = 'issued' THEN
        UPDATE solar.proposals SET status = 'viewed' WHERE id = p.id;
        INSERT INTO solar.proposal_events (proposal_id, kind, via, ip, user_agent, pdf_sha256)
        VALUES (p.id, 'viewed', p_via, left(p_ip, 64), left(p_ua, 512), p.pdf_sha256);
        p.status := 'viewed';
    END IF;
    SELECT jsonb_build_object('kind', e.kind, 'name', e.actor_name, 'at', e.at) INTO v_resp
      FROM solar.proposal_events e
     WHERE e.proposal_id = p.id AND e.kind IN ('accepted', 'declined')
     ORDER BY e.at DESC LIMIT 1;
    RETURN jsonb_build_object(
        'state', p.status, 'proposalId', p.id, 'projectId', p.project_id, 'version', p.version,
        'expiresAt', p.expires_at, 'snapshot', p.snapshot, 'pdfSha256', p.pdf_sha256,
        'pdfPath', p.pdf_path, 'response', v_resp);
END $$;
REVOKE ALL ON FUNCTION solar.proposal_client_view(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_client_view(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION solar.proposal_client_view(UUID, TEXT, TEXT, TEXT) FROM authenticated;

-- Accept / decline. Returns {ok:false,error} for every refusal the web layer words; the stamp
-- (time, IP, UA, PDF hash) is taken here, never from the client.
CREATE OR REPLACE FUNCTION solar.proposal_record_response(
    p_id UUID, p_via TEXT, p_user UUID, p_decision TEXT, p_name TEXT, p_email TEXT,
    p_authority BOOLEAN, p_signature TEXT, p_reason TEXT, p_ip TEXT, p_ua TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p       solar.proposals%ROWTYPE;
    v_eff   TEXT;
    v_name  TEXT := btrim(coalesce(p_name, ''));
    v_email TEXT := lower(btrim(coalesce(p_email, '')));
BEGIN
    IF p_decision IS NULL OR p_decision NOT IN ('accepted', 'declined') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
    END IF;
    SELECT * INTO p FROM solar.proposals WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR p.status = 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    v_eff := solar.proposal_effective_status(p.status, p.expires_at);
    IF v_eff NOT IN ('issued', 'viewed') THEN
        RETURN jsonb_build_object('ok', false, 'error', v_eff);
    END IF;
    IF EXISTS (SELECT 1 FROM solar.proposals x WHERE x.family_id = p.family_id AND x.id <> p.id AND x.status = 'accepted') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'family_accepted');
    END IF;
    IF length(v_name) < 2 OR length(v_name) > 200 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_name');
    END IF;
    IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
    END IF;
    IF p_decision = 'accepted' AND p_authority IS NOT TRUE THEN
        RETURN jsonb_build_object('ok', false, 'error', 'authority_required');
    END IF;
    IF p_signature IS NOT NULL AND (length(p_signature) > 400000 OR p_signature NOT LIKE 'data:image/png;base64,%') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_signature');
    END IF;
    IF p_reason IS NOT NULL AND length(p_reason) > 2000 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_reason');
    END IF;
    UPDATE solar.proposals SET status = p_decision, responded_at = now() WHERE id = p.id;
    INSERT INTO solar.proposal_events (proposal_id, kind, via, actor_user_id, actor_name, actor_email,
        authority_confirmed, signature_png, reason, ip, user_agent, pdf_sha256)
    VALUES (p.id, p_decision, p_via, p_user, v_name, v_email,
        CASE WHEN p_decision = 'accepted' THEN TRUE ELSE p_authority END,
        CASE WHEN p_decision = 'accepted' THEN p_signature END,
        CASE WHEN p_decision = 'declined' THEN nullif(btrim(coalesce(p_reason, '')), '') END,
        left(p_ip, 64), left(p_ua, 512), p.pdf_sha256);
    RETURN jsonb_build_object('ok', true, 'state', p_decision, 'proposalId', p.id, 'projectId', p.project_id,
        'issuedBy', p.issued_by, 'version', p.version);
END $$;
REVOKE ALL ON FUNCTION solar.proposal_record_response(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.proposal_record_response(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION solar.proposal_record_response(UUID, TEXT, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM authenticated;

-- A portal user: an active project member who is a client viewer (project role, or org role IN
-- THE PROJECT'S ORGANISATION; a client viewer of some other org is not this project's client).
CREATE OR REPLACE FUNCTION solar.is_portal_member(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.project_members pm
          JOIN projects.projects pr ON pr.id = pm.project_id
         WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id AND pm.is_active
           AND (pm.role = 'client_viewer'
                OR EXISTS (SELECT 1 FROM public.user_organisations uo
                            WHERE uo.user_id = p_user_id AND uo.organisation_id = pr.organisation_id
                              AND uo.is_active AND uo.role = 'client_viewer')));
$$;
REVOKE ALL ON FUNCTION solar.is_portal_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.is_portal_member(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION solar.is_portal_member(UUID, UUID) FROM authenticated;

-- ── 5. Service-only client entry points ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.solar_proposal_by_token(p_token TEXT, p_ip TEXT DEFAULT NULL, p_ua TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
        RETURN jsonb_build_object('state', 'not_found');
    END IF;
    SELECT p.id INTO v_id FROM solar.proposals p WHERE p.share_token_hash = solar.proposal_hash_token(p_token);
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('state', 'not_found');
    END IF;
    RETURN solar.proposal_client_view(v_id, 'token', p_ip, p_ua);
END $$;
REVOKE ALL ON FUNCTION public.solar_proposal_by_token(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_proposal_by_token(TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.solar_proposal_by_token(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_proposal_by_token(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_proposal_respond_by_token(
    p_token TEXT, p_decision TEXT, p_name TEXT, p_email TEXT, p_authority BOOLEAN,
    p_signature TEXT, p_reason TEXT, p_ip TEXT, p_ua TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    SELECT p.id INTO v_id FROM solar.proposals p WHERE p.share_token_hash = solar.proposal_hash_token(p_token);
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    RETURN solar.proposal_record_response(v_id, 'token', NULL, p_decision, p_name, p_email, p_authority, p_signature, p_reason, p_ip, p_ua);
END $$;
REVOKE ALL ON FUNCTION public.solar_proposal_respond_by_token(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_proposal_respond_by_token(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.solar_proposal_respond_by_token(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_proposal_respond_by_token(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_portal_proposals(p_project_id UUID, p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT solar.is_portal_member(p_project_id, p_user_id) THEN
        RETURN '[]'::jsonb;
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'proposalId', p.id, 'version', p.version,
            'state', solar.proposal_effective_status(p.status, p.expires_at),
            'issuedAt', p.issued_at, 'expiresAt', p.expires_at,
            'title', p.snapshot -> 'proposal' ->> 'title',
            'offerExclVatZar', p.snapshot -> 'price' -> 'offerExclVatZar')
            ORDER BY p.issued_at DESC)
          FROM solar.proposals p
         WHERE p.project_id = p_project_id AND p.status <> 'draft'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.solar_portal_proposals(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_portal_proposals(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.solar_portal_proposals(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_portal_proposals(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_portal_proposal(p_project_id UUID, p_user_id UUID, p_proposal_id UUID, p_ip TEXT, p_ua TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT solar.is_portal_member(p_project_id, p_user_id)
       OR NOT EXISTS (SELECT 1 FROM solar.proposals p WHERE p.id = p_proposal_id AND p.project_id = p_project_id) THEN
        RETURN jsonb_build_object('state', 'not_found');
    END IF;
    RETURN solar.proposal_client_view(p_proposal_id, 'portal', p_ip, p_ua);
END $$;
REVOKE ALL ON FUNCTION public.solar_portal_proposal(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_portal_proposal(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.solar_portal_proposal(UUID, UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_portal_proposal(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_portal_respond(
    p_project_id UUID, p_user_id UUID, p_proposal_id UUID, p_decision TEXT, p_name TEXT, p_email TEXT,
    p_authority BOOLEAN, p_signature TEXT, p_reason TEXT, p_ip TEXT, p_ua TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT solar.is_portal_member(p_project_id, p_user_id)
       OR NOT EXISTS (SELECT 1 FROM solar.proposals p WHERE p.id = p_proposal_id AND p.project_id = p_project_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    RETURN solar.proposal_record_response(p_proposal_id, 'portal', p_user_id, p_decision, p_name, p_email,
        p_authority, p_signature, p_reason, p_ip, p_ua);
END $$;
REVOKE ALL ON FUNCTION public.solar_portal_respond(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_portal_respond(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.solar_portal_respond(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_portal_respond(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 6. Service-only state changes ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.solar_issue_proposal(
    p_proposal_id UUID, p_expected_updated_at TIMESTAMPTZ, p_case_run_id UUID, p_snapshot JSONB,
    p_pdf_path TEXT, p_pdf_sha256 TEXT, p_token_hash TEXT, p_expires_at TIMESTAMPTZ, p_report_id UUID, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p      solar.proposals%ROWTYPE;
    v_prev RECORD;
BEGIN
    SELECT * INTO p FROM solar.proposals WHERE id = p_proposal_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    IF p.status <> 'draft' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_draft'); END IF;
    -- One acceptance per family: a draft revision made before v1 was accepted can never be issued.
    IF EXISTS (SELECT 1 FROM solar.proposals x WHERE x.family_id = p.family_id AND x.status = 'accepted') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'family_accepted');
    END IF;
    IF p.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'stale');
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '366 days' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_expiry');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.case_runs r
                    WHERE r.id = p_case_run_id AND r.status = 'succeeded' AND r.case_id = p.case_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'run_mismatch');
    END IF;
    FOR v_prev IN
        SELECT x.id, x.pdf_sha256 FROM solar.proposals x
         WHERE x.family_id = p.family_id AND x.id <> p.id AND x.status IN ('issued', 'viewed')
    LOOP
        UPDATE solar.proposals SET status = 'withdrawn', withdrawn_by = p_actor, withdrawn_at = now() WHERE id = v_prev.id;
        INSERT INTO solar.proposal_events (proposal_id, kind, via, actor_user_id, reason, pdf_sha256)
        VALUES (v_prev.id, 'withdrawn', 'app', p_actor, 'Superseded by version ' || p.version, v_prev.pdf_sha256);
    END LOOP;
    UPDATE solar.proposals
       SET status = 'issued', case_run_id = p_case_run_id, snapshot = p_snapshot, pdf_path = p_pdf_path,
           pdf_sha256 = p_pdf_sha256, share_token_hash = p_token_hash, expires_at = p_expires_at,
           report_id = p_report_id, issued_by = p_actor, issued_at = now()
     WHERE id = p.id;
    INSERT INTO solar.proposal_events (proposal_id, kind, via, actor_user_id, pdf_sha256)
    VALUES (p.id, 'issued', 'app', p_actor, p_pdf_sha256);
    RETURN jsonb_build_object('ok', true, 'version', p.version);
END $$;
REVOKE ALL ON FUNCTION public.solar_issue_proposal(UUID, TIMESTAMPTZ, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_issue_proposal(UUID, TIMESTAMPTZ, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.solar_issue_proposal(UUID, TIMESTAMPTZ, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_issue_proposal(UUID, TIMESTAMPTZ, UUID, JSONB, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_withdraw_proposal(p_proposal_id UUID, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p solar.proposals%ROWTYPE;
BEGIN
    SELECT * INTO p FROM solar.proposals WHERE id = p_proposal_id FOR UPDATE;
    IF NOT FOUND OR p.status NOT IN ('issued', 'viewed') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_live');
    END IF;
    UPDATE solar.proposals SET status = 'withdrawn', withdrawn_by = p_actor, withdrawn_at = now() WHERE id = p.id;
    INSERT INTO solar.proposal_events (proposal_id, kind, via, actor_user_id, pdf_sha256)
    VALUES (p.id, 'withdrawn', 'app', p_actor, p.pdf_sha256);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.solar_withdraw_proposal(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_withdraw_proposal(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.solar_withdraw_proposal(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_withdraw_proposal(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_rotate_proposal_link(p_proposal_id UUID, p_token_hash TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p solar.proposals%ROWTYPE;
BEGIN
    SELECT * INTO p FROM solar.proposals WHERE id = p_proposal_id FOR UPDATE;
    IF NOT FOUND OR solar.proposal_effective_status(p.status, p.expires_at) NOT IN ('issued', 'viewed') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_live');
    END IF;
    UPDATE solar.proposals SET share_token_hash = p_token_hash WHERE id = p.id;
    INSERT INTO solar.proposal_events (proposal_id, kind, via, actor_user_id, pdf_sha256)
    VALUES (p.id, 'link_rotated', 'app', p_actor, p.pdf_sha256);
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.solar_rotate_proposal_link(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_rotate_proposal_link(UUID, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.solar_rotate_proposal_link(UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.solar_rotate_proposal_link(UUID, TEXT, UUID) TO service_role;

-- ── 7. Portfolio (§15) ──────────────────────────────────────────────────────
-- Rows the CALLER may see (solar_can_view per project); the saving only with money.
CREATE OR REPLACE FUNCTION public.solar_portfolio(p_org_id UUID)
RETURNS TABLE (
    project_id UUID, project_name TEXT, province TEXT, city TEXT, licensee_name TEXT, stage TEXT,
    selected_case_name TEXT, selected_kwp NUMERIC, proposed_kwp NUMERIC, year1_saving_zar NUMERIC,
    last_activity TIMESTAMPTZ, can_see_money BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH vis AS (
        SELECT s.project_id, s.licensee_name, s.selected_case_id, s.updated_at,
               public.solar_can_see_money(s.project_id) AS money
          FROM solar.studies s JOIN projects.projects p ON p.id = s.project_id
         WHERE p.organisation_id = p_org_id AND public.solar_can_view(s.project_id)
    ), lastrun AS (
        SELECT DISTINCT ON (r.case_id) r.case_id, r.id, r.outputs
          FROM solar.case_runs r JOIN vis ON vis.selected_case_id = r.case_id
         WHERE r.status = 'succeeded'
         ORDER BY r.case_id, r.started_at DESC
    )
    SELECT vis.project_id, p.name, p.province, p.city, vis.licensee_name,
           CASE WHEN EXISTS (SELECT 1 FROM solar.proposals x WHERE x.project_id = vis.project_id AND x.status = 'accepted') THEN 'accepted'
                WHEN EXISTS (SELECT 1 FROM solar.proposals x WHERE x.project_id = vis.project_id
                              AND solar.proposal_effective_status(x.status, x.expires_at) IN ('issued', 'viewed')) THEN 'proposal_issued'
                ELSE 'study' END,
           c.name,
           (lr.outputs -> 'kpis' ->> 'dcKwp')::numeric,
           (SELECT (x.snapshot -> 'system' ->> 'dcKwp')::numeric FROM solar.proposals x
             WHERE x.project_id = vis.project_id AND x.status IN ('issued', 'viewed', 'accepted')
             ORDER BY x.issued_at DESC LIMIT 1),
           CASE WHEN vis.money THEN (
               SELECT (f.results -> 'year1Bills' ->> 'beforeZar')::numeric - (f.results -> 'year1Bills' ->> 'afterZar')::numeric
                 FROM solar.case_run_financials f WHERE f.case_run_id = lr.id ORDER BY f.created_at DESC LIMIT 1) END,
           GREATEST(vis.updated_at, (SELECT max(a.created_at) FROM solar.audit_events a WHERE a.project_id = vis.project_id)),
           vis.money
      FROM vis
      JOIN projects.projects p ON p.id = vis.project_id
      LEFT JOIN solar.cases c ON c.id = vis.selected_case_id
      LEFT JOIN lastrun lr ON lr.case_id = vis.selected_case_id
     ORDER BY p.name;
$$;
REVOKE ALL ON FUNCTION public.solar_portfolio(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_portfolio(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_portfolio(UUID) TO authenticated, service_role;

-- ── 8. Saved Solar reports read on the Solar level ──────────────────────────
-- Redefines 00183's functions IN FULL. solar_layout_sheet is carried from 00211 (Phase 5) so the
-- FINAL definition gates every Solar kind whichever branch lands first.
CREATE OR REPLACE FUNCTION public.report_kind_is_sensitive(_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT _kind IN ('equipment_materials', 'valuation', 'solar_feasibility', 'solar_proposal')
$function$;

CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_technical' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_feasibility' THEN COALESCE(public.solar_can_see_money(_project_id), FALSE)
    WHEN _kind = 'solar_proposal' THEN COALESCE(public.solar_can_see_money(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.report_kind_is_sensitive(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_kind_is_sensitive(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

-- ── 8b. Solar PDFs are service-only (bucket 'reports', 00117) ───────────────
-- 00117's bucket policies admit ANY active org member to read, upload, overwrite and delete every
-- object under <org>/. Solar feasibility and proposal PDFs are money, and an accepted proposal's PDF
-- is the evidence its hash is stamped against. Every app read, sign, upload and remove of these paths
-- goes through the service client after the Solar gate, so a session role needs none of them.
-- Per verb (never RESTRICTIVE FOR ALL); every other bucket and path is untouched.
DROP POLICY IF EXISTS solar_pdfs_service_only_select ON storage.objects;
CREATE POLICY solar_pdfs_service_only_select ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports' OR coalesce(name, '') !~ '/solar-(reports|proposals)/');
DROP POLICY IF EXISTS solar_pdfs_service_only_insert ON storage.objects;
CREATE POLICY solar_pdfs_service_only_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (bucket_id IS DISTINCT FROM 'reports' OR coalesce(name, '') !~ '/solar-(reports|proposals)/');
DROP POLICY IF EXISTS solar_pdfs_service_only_update ON storage.objects;
CREATE POLICY solar_pdfs_service_only_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports' OR coalesce(name, '') !~ '/solar-(reports|proposals)/')
    WITH CHECK (bucket_id IS DISTINCT FROM 'reports' OR coalesce(name, '') !~ '/solar-(reports|proposals)/');
DROP POLICY IF EXISTS solar_pdfs_service_only_delete ON storage.objects;
CREATE POLICY solar_pdfs_service_only_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports' OR coalesce(name, '') !~ '/solar-(reports|proposals)/');

-- Every Solar report row (feasibility, technical, layout sheet, proposal) is inserted and superseded
-- only by the service client after the Solar gate. 00117's reports_write (FOR ALL, owner/admin/PM)
-- would otherwise let a session forge a row: getProjectReportUrlAction gates on the row's KIND and
-- then service-signs its storage_path, so a technical (View) or open-kind row pointed at a
-- deterministic feasibility path would hand money PDFs to a user without financials. So no session
-- inserts or updates a row whose kind is solar_* OR whose path is a Solar PDF (USING and WITH CHECK).
-- DELETE stays narrow: deleteProjectReportAction removes feasibility/technical rows through the
-- session (OWNER_ADMIN + Solar Edit); only the proposal row is evidence.
CREATE POLICY reports_solar_service_only_insert ON projects.reports AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (coalesce(kind, '') NOT LIKE 'solar\_%' AND coalesce(storage_path, '') !~ '/solar-(reports|proposals)/');
CREATE POLICY reports_solar_service_only_update ON projects.reports AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (coalesce(kind, '') NOT LIKE 'solar\_%' AND coalesce(storage_path, '') !~ '/solar-(reports|proposals)/')
    WITH CHECK (coalesce(kind, '') NOT LIKE 'solar\_%' AND coalesce(storage_path, '') !~ '/solar-(reports|proposals)/');
CREATE POLICY reports_solar_proposal_delete_authz ON projects.reports AS RESTRICTIVE FOR DELETE TO authenticated
    USING (kind IS DISTINCT FROM 'solar_proposal');

-- ── 9. Project email toggle ─────────────────────────────────────────────────
ALTER TABLE projects.project_settings
    ADD COLUMN IF NOT EXISTS notify_solar_email BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 10. Notification types (re-declared in full: 00208's list + Phase 6) ────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
        'snag_status_changed',
        'rfi_assigned',
        'rfi_closed',
        'rfi_response',
        'grn_recorded',
        'inspection_assigned',
        'inspection_awaiting_verification',
        'inspection_certified',
        'inspection_re_inspect_required',
        'inspection_revoked',
        'inspection_abandoned',
        'qc_issued',
        'rfi_created',
        'snag_created',
        'diary_created',
        'qc_comment',
        'snag_visit_completed',
        'site_form_distributed',
        'billing_duplicate_charge',
        'billing_refund_processed',
        'billing_dispute_opened',
        'solar_subscribe_requested',
        'solar_access_requested',
        'solar_access_changed',
        'solar_access_declined',
        -- 00216: client responses to a proposal
        'solar_proposal_accepted',
        'solar_proposal_declined'
    ]::text[])
);

-- ── 11. Product events (re-declared in full: 00215's list + Phase 6) ────────
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved',
    'solar_case_created',
    'solar_case_run',
    'solar_weather_fetched',
    'solar_financials_run',
    'solar_equipment_saved',
    'solar_report_generated',
    'solar_proposal_created',
    'solar_proposal_issued',
    'solar_proposal_withdrawn',
    'solar_proposal_responded',
    'solar_narrative_drafted'
));

-- ── 12. Table privileges ────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON solar.proposal_templates TO authenticated;
REVOKE DELETE, TRUNCATE ON solar.proposal_templates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.proposals TO authenticated;
REVOKE TRUNCATE ON solar.proposals FROM authenticated;
GRANT SELECT ON solar.proposal_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.proposal_events FROM authenticated;
GRANT ALL ON solar.proposal_templates, solar.proposals TO service_role;
GRANT SELECT, INSERT ON solar.proposal_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON solar.proposal_events FROM service_role;
REVOKE ALL ON solar.proposal_templates, solar.proposals, solar.proposal_events FROM anon;

NOTIFY pgrst, 'reload schema';
