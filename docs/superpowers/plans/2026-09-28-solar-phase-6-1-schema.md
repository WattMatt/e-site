# Solar Phase 6 — Part 1: Schema (`00217_solar_proposals.sql`) and behavioural assertions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first (decisions, conventions, `$W`, `$S`).

---

### Task 1: Write migration `00217_solar_proposals.sql`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00217_solar_proposals.sql`

- [ ] **Step 1: Re-check the number immediately before writing.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 && git fetch origin && \
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -F '00217_' | sed "s|^|$r: |"; done
```
Expected: no output. Any output → STOP and ask for a number.

- [ ] **Step 2: Confirm the two CHECK lists you are about to re-declare.** The product-events list below is `00216`'s plus six; the notifications list is `00209`'s plus two. If Task 0 Step 4(c) named a LATER migration for either CHECK, open it and add every value it has that the lists below lack (never drop one).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
M=apps/edge-functions/supabase/migrations; S=/private/tmp/claude-501/solar-6; mkdir -p $S
awk '/product_events_event_check CHECK/,/\)\);/' $M/00216_solar_cases.sql | grep -o "'[a-z_]*'" | tr -d "'" | sort > $S/events-base.txt
wc -l < $S/events-base.txt
```
Expected: `22`.

- [ ] **Step 3: Write the migration.** No `BEGIN`/`COMMIT`. No em dash anywhere inside a `-- sql:` payload.

```sql
-- ---------------------------------------------------------------------------
-- Migration 00217: Solar reports and client proposals (Phase 6)
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
-- RULES
--   * 00208's schema-wide directives hold: FORCE RLS on every solar table, no RESTRICTIVE read
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
-- trigger: proposal_templates_bind ON solar.proposal_templates
-- trigger: proposals_guard ON solar.proposals
-- trigger: proposal_events_bind ON solar.proposal_events
-- trigger: proposal_events_append_only ON solar.proposal_events
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
-- sql: (SELECT prosrc LIKE '%solar_feasibility%' AND prosrc LIKE '%solar_technical%' AND prosrc LIKE '%solar_proposal%' AND prosrc LIKE '%solar_layout_sheet%' FROM pg_proc WHERE oid = 'public.user_can_read_report_kind(uuid, text)'::regprocedure)
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_proposal_accepted%' AND pg_get_constraintdef(oid) LIKE '%solar_proposal_declined%' AND pg_get_constraintdef(oid) LIKE '%solar_access_declined%' AND pg_get_constraintdef(oid) LIKE '%site_form_distributed%' FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check')
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_report_generated%' AND pg_get_constraintdef(oid) LIKE '%solar_proposal_issued%' AND pg_get_constraintdef(oid) LIKE '%solar_narrative_drafted%' AND pg_get_constraintdef(oid) LIKE '%solar_equipment_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
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

-- A portal user: an active project member who is a client viewer (project role or org role).
CREATE OR REPLACE FUNCTION solar.is_portal_member(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.project_members pm
         WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id AND pm.is_active
           AND (pm.role = 'client_viewer'
                OR EXISTS (SELECT 1 FROM public.user_organisations uo
                            WHERE uo.user_id = p_user_id AND uo.is_active AND uo.role = 'client_viewer')));
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
-- Redefines 00183's functions IN FULL. solar_layout_sheet is carried from 00212 (Phase 5) so the
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

-- ── 9. Project email toggle ─────────────────────────────────────────────────
ALTER TABLE projects.project_settings
    ADD COLUMN IF NOT EXISTS notify_solar_email BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 10. Notification types (re-declared in full: 00209's list + Phase 6) ────
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
        -- 00217: client responses to a proposal
        'solar_proposal_accepted',
        'solar_proposal_declined'
    ]::text[])
);

-- ── 11. Product events (re-declared in full: 00216's list + Phase 6) ────────
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
```

- [ ] **Step 4: Static sanity checks.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
M=apps/edge-functions/supabase/migrations/00217_solar_proposals.sql
grep -nE '^\s*(BEGIN|COMMIT)\s*;' $M ; echo "begin/commit lines: $?"
grep -n '^-- sql:' $M | grep -n '—' ; echo "em dash in sql payload: $?"
grep -c 'SECURITY DEFINER' $M
grep -c 'FROM anon;' $M
grep -n 'FOR ALL' $M ; echo "for-all policies: $?"
comm -13 <(sort /private/tmp/claude-501/solar-6/events-base.txt) <(awk '/product_events_event_check CHECK/,/\)\);/' $M | grep -o "'[a-z_]*'" | tr -d "'" | sort)
```
Expected: `begin/commit lines: 1`; `em dash in sql payload: 1`; `17` SECURITY DEFINER; at least `18` `FROM anon;`; `for-all policies: 1`; the `comm` output is exactly the six new events (`solar_narrative_drafted`, `solar_proposal_created`, `solar_proposal_issued`, `solar_proposal_responded`, `solar_proposal_withdrawn`, `solar_report_generated`) — nothing from the base list is missing.

- [ ] **Step 5: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add apps/edge-functions/supabase/migrations/00217_solar_proposals.sql
git commit -m "feat(solar): 00217 proposals, evidence events, service-only client access, report kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Behavioural assertions (write, then prove RED)

**Files:**
- Create: `scripts/db/assert-solar-proposals-roles.sql`

- [ ] **Step 1: Write the assertion file.** Same refusal pattern as 00216's file: a `…_REFUSED` check records `true` only on the promised SQLSTATE; a wrongly-allowed statement raises `P0001` so its write rolls back. All seeding as postgres before the first impersonation; `request.jwt.claims` is cleared before every later postgres step (it outlives `RESET ROLE`).

```sql
-- BEHAVIOURAL assertions for 00217_solar_proposals (Solar Phase 6), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00208..00211 (+00214) + 00216> scripts/db/assert-solar-proposals-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00208..00211 (+00214) + 00216 + 00217> scripts/db/assert-solar-proposals-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it
-- bypasses the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money   UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant UUID := gen_random_uuid();   -- contractor member, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p (FORGED edit_financials grant)
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_study   UUID;
  v_study2  UUID;
  v_w       UUID;
  v_case    UUID;
  v_run     UUID;
  v_prop    UUID;   -- family A (will be accepted)
  v_prop_b  UUID;   -- family B (expires)
  v_c1      UUID;   -- family C v1
  v_c2      UUID;   -- family C v2
  v_tmp     UUID;
  v_upd     TIMESTAMPTZ;
  v_j       JSONB;
  v_n       INT;
  v_status  TEXT;
  u         UUID;
  v_hash    CONSTANT TEXT := repeat('c', 64);
  v_pdfsha  CONSTANT TEXT := repeat('a', 64);
  v_tok_a   CONSTANT TEXT := rpad('tokA', 43, 'x');
  v_tok_b   CONSTANT TEXT := rpad('tokB', 43, 'y');
  v_tok_c1  CONSTANT TEXT := rpad('tokC1', 43, 'z');
  v_tok_c2  CONSTANT TEXT := rpad('tokC2', 43, 'w');
  v_tok_c2b CONSTANT TEXT := rpad('tokC2b', 43, 'v');
  v_snap    CONSTANT JSONB := '{"version":1,"issuer":{"orgName":"Probe","proposerName":"Pat Proposer","proposerEmail":"pat@example.invalid"},"system":{"dcKwp":100},"price":{"offerExclVatZar":1150000}}';
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-6-probe'), (v_org2, 'solar-6-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-6-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-6-probe-p', v_admin), (v_p2, v_org2, 'solar-6-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE),
    (v_p, v_view, v_org, 'contractor', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit_financials');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -26.20, 28.05, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Base', '{"version":1}') RETURNING id INTO v_case;
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run;
  UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{"dcKwp":100}}', hourly_path = 'h.csv.gz' WHERE id = v_run;
  UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study;
  INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version) VALUES
    (v_org, v_p, 'solar_technical', 't', 'x/t.pdf', 'issued', 1),
    (v_org, v_p, 'solar_feasibility', 'f', 'x/f.pdf', 'issued', 1),
    (v_org, v_p, 'solar_proposal', 'p', 'x/p.pdf', 'issued', 1);

  -- ── 1. Money user: drafts only ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, project_id, organisation_id, case_id, status, snapshot, share_token_hash, draft)
    VALUES (v_study, v_p2, v_org2, v_case, 'issued', v_snap, v_hash, '{"marginPct":15}')
    RETURNING id INTO v_prop;
    INSERT INTO _r VALUES ('draft_born_clean', (SELECT status = 'draft' AND snapshot IS NULL AND share_token_hash IS NULL
      AND family_id = id AND version = 1 AND project_id = v_p AND organisation_id = v_org FROM solar.proposals WHERE id = v_prop));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('draft_born_clean', false);
  END;
  BEGIN
    UPDATE solar.proposals SET draft = '{"marginPct":20}' WHERE id = v_prop;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('money_user_edits_draft', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_edits_draft', false);
  END;
  BEGIN
    UPDATE solar.proposals SET status = 'issued' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_issue_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_issue_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.proposals SET share_token_hash = v_hash WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('user_sets_token_on_draft_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_sets_token_on_draft_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_feasibility_kind', public.user_can_read_report_kind(v_p, 'solar_feasibility'));
  INSERT INTO _r VALUES ('money_user_lists_proposal_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal') = 1);
  -- Family B and family C drafts (created now, issued later as the service path)
  INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case) RETURNING id INTO v_prop_b;
  INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case) RETURNING id INTO v_c1;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 2. Editor (no money), View, client (forged grant), no grant, foreign ──
  FOREACH u IN ARRAY ARRAY[v_edit, v_view, v_client, v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('no_money_reads_no_proposals_' || CASE u WHEN v_edit THEN 'editor' WHEN v_view THEN 'view'
      WHEN v_client THEN 'client' WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.proposal_events WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_creates_proposal_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_creates_proposal_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('editor_cannot_read_feasibility_kind', NOT public.user_can_read_report_kind(v_p, 'solar_feasibility'));
  INSERT INTO _r VALUES ('editor_reads_technical_kind', public.user_can_read_report_kind(v_p, 'solar_technical'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_lists_technical_not_feasibility',
    (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_technical') = 1
    AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind IN ('solar_feasibility', 'solar_proposal')) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_solar_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind LIKE 'solar_%') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('client_reads_no_proposal_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 3. anon and authenticated have no client function; anon has no table ──
  INSERT INTO _r VALUES ('anon_no_table_privilege', NOT has_table_privilege('anon', 'solar.proposals', 'SELECT')
    AND NOT has_table_privilege('anon', 'solar.proposal_events', 'SELECT'));
  INSERT INTO _r VALUES ('client_functions_service_only',
    NOT has_function_privilege('anon', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_portal_respond(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE'));
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM solar.proposals;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('anon_reads_proposals_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('anon_reads_proposals_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. Issue family A (service path) ──────────────────────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_prop;
  v_j := public.solar_issue_proposal(v_prop, v_upd - interval '1 second', v_run, v_snap, 'o/p/a.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_a), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_stale_REFUSED', v_j ->> 'error' = 'stale');
  v_j := public.solar_issue_proposal(v_prop, v_upd, v_run, v_snap, 'o/p/a.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_a), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_ok', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'issued' AND issued_by = v_money AND case_run_id = v_run AND snapshot = v_snap FROM solar.proposals WHERE id = v_prop)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'issued' AND pdf_sha256 = v_pdfsha) = 1);
  INSERT INTO _r VALUES ('stored_hash_is_sha256_of_token',
    (SELECT share_token_hash = encode(sha256(convert_to(v_tok_a, 'UTF8')), 'hex') AND share_token_hash <> v_tok_a FROM solar.proposals WHERE id = v_prop));
  BEGIN
    UPDATE solar.proposals SET share_token_hash = v_tok_a WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('raw_token_storage_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('raw_token_storage_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.proposals SET snapshot = '{"forged":true}' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_snapshot_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_snapshot_immutable_REFUSED', false);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.proposals SET draft = '{"marginPct":1}' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_user_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_user_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.proposals WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_delete_REFUSED', false);
  END;
  -- Tamper: change the case and its money AFTER issue.
  UPDATE solar.cases SET config = config || '{"tampered":true}' WHERE id = v_case;
  INSERT INTO solar.case_financials (case_id, config) VALUES (v_case, '{"tampered":true}');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. Token view ─────────────────────────────────────────────────────────
  v_j := public.solar_proposal_by_token(v_tok_a, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('token_view_marks_viewed', v_j ->> 'state' = 'viewed'
    AND (v_j -> 'snapshot' -> 'system' ->> 'dcKwp')::int = 100 AND v_j ->> 'pdfSha256' = v_pdfsha);
  INSERT INTO _r VALUES ('snapshot_unchanged_after_case_edit', v_j -> 'snapshot' = v_snap
    AND (SELECT pdf_sha256 = v_pdfsha FROM solar.proposals WHERE id = v_prop));
  v_j := public.solar_proposal_by_token(v_tok_a, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('second_view_no_duplicate_event',
    (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'viewed') = 1);
  v_j := public.solar_proposal_by_token(encode(sha256(convert_to(v_tok_a, 'UTF8')), 'hex'), NULL, NULL);
  INSERT INTO _r VALUES ('lookup_by_hash_string_REFUSED', v_j ->> 'state' = 'not_found');
  v_j := public.solar_proposal_by_token(rpad('nope', 43, 'q'), NULL, NULL);
  INSERT INTO _r VALUES ('unknown_token_not_found', v_j ->> 'state' = 'not_found' AND v_j -> 'snapshot' IS NULL);

  -- ── 6. Respond ────────────────────────────────────────────────────────────
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', ' ', 'c@example.invalid', TRUE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('respond_validates_name', v_j ->> 'error' = 'invalid_name');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'not-an-email', TRUE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('respond_validates_email', v_j ->> 'error' = 'invalid_email');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'c@example.invalid', FALSE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('accept_requires_authority', v_j ->> 'error' = 'authority_required');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'C@Example.invalid', TRUE,
           'data:image/png;base64,iVBORw0KGgo=', NULL, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('accept_stamps_evidence', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'accepted' AND responded_at IS NOT NULL FROM solar.proposals WHERE id = v_prop)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'accepted'
          AND actor_name = 'Client Name' AND actor_email = 'c@example.invalid' AND authority_confirmed
          AND ip = '203.0.113.7' AND user_agent = 'probe-agent' AND pdf_sha256 = v_pdfsha
          AND signature_png LIKE 'data:image/png;base64,%' AND via = 'token') = 1);
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'declined', 'Client Name', 'c@example.invalid', FALSE, NULL, 'x', NULL, NULL);
  INSERT INTO _r VALUES ('second_response_REFUSED', v_j ->> 'error' = 'accepted');
  BEGIN
    UPDATE solar.proposal_events SET actor_name = 'Forged' WHERE proposal_id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('events_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('events_update_REFUSED', false);
  END;
  SET LOCAL ROLE service_role;
  BEGIN
    DELETE FROM solar.proposal_events WHERE proposal_id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('events_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('events_delete_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('money_user_reads_acceptance_record',
    (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind IN ('issued', 'viewed', 'accepted')) = 3);
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id) VALUES (v_study, v_prop, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('revise_accepted_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('revise_accepted_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 7. Expired (family B) ─────────────────────────────────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_prop_b;
  v_j := public.solar_issue_proposal(v_prop_b, v_upd, v_run, v_snap, 'o/p/b.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_b), now() + interval '1 day', NULL, v_money);
  SET LOCAL session_replication_role = replica;
  UPDATE solar.proposals SET expires_at = now() - interval '1 minute' WHERE id = v_prop_b;
  SET LOCAL session_replication_role = origin;
  v_j := public.solar_proposal_by_token(v_tok_b, NULL, NULL);
  INSERT INTO _r VALUES ('expired_token_REFUSED', v_j ->> 'state' = 'expired' AND v_j -> 'snapshot' IS NULL
    AND v_j -> 'issuer' ->> 'proposerName' = 'Pat Proposer');
  v_j := public.solar_proposal_respond_by_token(v_tok_b, 'accepted', 'Client Name', 'c@example.invalid', TRUE, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES ('expired_accept_REFUSED', v_j ->> 'error' = 'expired'
    AND (SELECT status = 'issued' FROM solar.proposals WHERE id = v_prop_b));

  -- ── 8. Family C: rotate, revise, supersede, withdraw ──────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_c1;
  v_j := public.solar_issue_proposal(v_c1, v_upd, v_run, v_snap, 'o/p/c1.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_c1), now() + interval '30 days', NULL, v_money);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id, draft) VALUES (v_study, v_c1, v_case, '{"marginPct":10}') RETURNING id INTO v_c2;
    INSERT INTO _r VALUES ('revision_is_next_version', (SELECT version = 2 AND family_id = v_c1 AND status = 'draft' FROM solar.proposals WHERE id = v_c2));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('revision_is_next_version', false);
  END;
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id) VALUES (v_study, v_c1, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_draft_in_family_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_draft_in_family_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_c2;
  v_j := public.solar_issue_proposal(v_c2, v_upd, v_run, v_snap, 'o/p/c2.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_c2), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_supersedes_previous', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'withdrawn' FROM solar.proposals WHERE id = v_c1)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_c1 AND kind = 'withdrawn' AND reason = 'Superseded by version 2') = 1);
  v_j := public.solar_proposal_by_token(v_tok_c1, NULL, NULL);
  INSERT INTO _r VALUES ('withdrawn_token_REFUSED', v_j ->> 'state' = 'withdrawn' AND v_j -> 'snapshot' IS NULL);
  v_j := public.solar_proposal_respond_by_token(v_tok_c1, 'accepted', 'Client Name', 'c@example.invalid', TRUE, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES ('withdrawn_accept_REFUSED', v_j ->> 'error' = 'withdrawn');
  v_j := public.solar_rotate_proposal_link(v_c2, solar.proposal_hash_token(v_tok_c2b), v_money);
  INSERT INTO _r VALUES ('rotate_kills_old_link', (v_j ->> 'ok')::boolean
    AND public.solar_proposal_by_token(v_tok_c2, NULL, NULL) ->> 'state' = 'not_found'
    AND public.solar_proposal_by_token(v_tok_c2b, NULL, NULL) ->> 'state' = 'viewed');

  -- ── 9. Portal ─────────────────────────────────────────────────────────────
  v_j := public.solar_portal_proposals(v_p, v_client);
  INSERT INTO _r VALUES ('portal_lists_for_client_viewer', jsonb_array_length(v_j) = 4
    AND NOT (v_j::text LIKE '%"snapshot"%'));
  INSERT INTO _r VALUES ('portal_refuses_non_client', public.solar_portal_proposals(v_p, v_edit) = '[]'::jsonb
    AND public.solar_portal_proposal(v_p, v_edit, v_c2, NULL, NULL) ->> 'state' = 'not_found');
  INSERT INTO _r VALUES ('portal_refuses_foreign_project', public.solar_portal_proposal(v_p2, v_client, v_c2, NULL, NULL) ->> 'state' = 'not_found');
  v_j := public.solar_portal_respond(v_p, v_client, v_c2, 'declined', 'Client Viewer', 'cv@example.invalid', NULL, NULL, 'Too expensive', '198.51.100.9', 'portal-agent');
  INSERT INTO _r VALUES ('portal_decline_stamps_user', (v_j ->> 'ok')::boolean
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_c2 AND kind = 'declined' AND via = 'portal'
          AND actor_user_id = v_client AND reason = 'Too expensive' AND signature_png IS NULL) = 1);
  v_j := public.solar_withdraw_proposal(v_c2, v_money);
  INSERT INTO _r VALUES ('withdraw_after_decline_REFUSED', v_j ->> 'error' = 'not_live');

  -- ── 10. Portfolio ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('portfolio_money_user', (SELECT count(*) = 1 AND bool_and(stage = 'accepted' AND selected_kwp = 100 AND can_see_money AND proposed_kwp = 100)
    FROM public.solar_portfolio(v_org)));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('portfolio_view_user_no_money', (SELECT count(*) = 1 AND bool_and(NOT can_see_money AND year1_saving_zar IS NULL)
    FROM public.solar_portfolio(v_org)));
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('portfolio_empty_' || CASE u WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM public.solar_portfolio(v_org)) = 0);
    RESET ROLE;
  END LOOP;

  -- ── 11. Templates ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposal_templates (organisation_id, terms_text, validity_days) VALUES (v_org, 'Terms v1', 45);
    INSERT INTO _r VALUES ('admin_writes_templates', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_writes_templates', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('money_user_reads_templates', (SELECT terms_text = 'Terms v1' FROM solar.proposal_templates WHERE organisation_id = v_org));
  UPDATE solar.proposal_templates SET terms_text = 'Forged' WHERE organisation_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('money_user_writes_templates_noop', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_no_templates', (SELECT count(*) FROM solar.proposal_templates WHERE organisation_id = v_org) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 12. Toggle column ─────────────────────────────────────────────────────
  INSERT INTO _r VALUES ('notify_solar_email_defaults_true', (SELECT column_default = 'true' AND is_nullable = 'NO'
    FROM information_schema.columns WHERE table_schema = 'projects' AND table_name = 'project_settings' AND column_name = 'notify_solar_email'));

  -- ── 13. Lapsed subscription: staff read nothing, rows kept, issued link still works ──
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_money_user_reads_nothing', (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 4);
  INSERT INTO _r VALUES ('lapsed_token_still_works', public.solar_proposal_by_token(v_tok_a, NULL, NULL) ->> 'state' = 'accepted');

  -- ── 14. A study delete cascades issued proposals and their evidence ──────
  BEGIN
    DELETE FROM solar.studies WHERE id = v_study;
    INSERT INTO _r VALUES ('study_delete_cascades_issued', (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.proposal_events WHERE project_id = v_p) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('study_delete_cascades_issued', false);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Build the RED bundle (base + 00216, no 00217) and run it.** If Task 0 Step 5 found `00214` on origin AND it is on this branch, insert it after `00211`.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6; M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql \
    $(ls $M/00214_*.sql 2>/dev/null) $M/00216_solar_cases.sql > $S/base.sql
grep -nE '^\s*(BEGIN|COMMIT)\s*;' $S/base.sql || echo "no-txn-control-ok"
scripts/db/dry-run-migration.sh $S/base.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | tail -20
```
Expected: `no-txn-control-ok`, then RED — the file aborts at the first `solar.proposals` statement (`relation "solar.proposals" does not exist`), reported as one failed assertion.

- [ ] **Step 3: Commit the assertions.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add scripts/db/assert-solar-proposals-roles.sql
git commit -m "test(solar): 00217 behavioural assertions (red without 00217)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prove GREEN, then prove the assertions can fail (mutations)

**Files:** none committed (scratch bundles only).

- [ ] **Step 1: GREEN run, plus the earlier Solar assertion files on top of 00217.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6; M=apps/edge-functions/supabase/migrations
cat $S/base.sql $M/00217_solar_proposals.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | tail -70
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-cases-roles.sql scripts/db/assert-solar-foundation-roles.sql \
  scripts/db/assert-solar-org-settings-roles.sql scripts/db/assert-solar-meter-data-roles.sql 2>&1 | grep -iE 'false|error' || echo "earlier Solar assertions still green"
```
Expected: 67 rows, every `ok` = `true`; then `earlier Solar assertions still green` (00217 re-declares both CHECKs and `user_can_read_report_kind`; those must not break 00208/00209/00211/00216 behaviour). Any `false`: fix the MIGRATION unless the assertion is demonstrably wrong, then re-run both commands. Count the rows: if the count is not 67, an assertion block aborted — read the error.

- [ ] **Step 2: Mutation 1 — expiry ignored ⇒ expired links work.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe "s/AND p_expires_at IS NOT NULL AND p_expires_at <= now\(\)/AND false/" $S/green.sql > $S/m1.sql
diff -q $S/green.sql $S/m1.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m1.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `expired_token_REFUSED` and `expired_accept_REFUSED` are `false` (the guard's own expiry RAISE still refuses the UPDATE, so the respond call aborts — either way the assertion goes red).

- [ ] **Step 3: Mutation 2 — withdrawn accepted.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe "s/IF v_eff NOT IN \('issued', 'viewed'\) THEN\n        RETURN jsonb_build_object\('ok', false, 'error', v_eff\);/IF v_eff NOT IN ('issued', 'viewed', 'withdrawn') THEN\n        RETURN jsonb_build_object('ok', false, 'error', v_eff);/" $S/green.sql > $S/m2.sql
diff -q $S/green.sql $S/m2.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m2.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `withdrawn_accept_REFUSED` is `false` (the function no longer refuses; the guard's transition rule then raises 23514 and the block aborts — the assertion is red either way).

- [ ] **Step 4: Mutation 3 — the token is compared raw (no hashing).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe 's/share_token_hash = solar\.proposal_hash_token\(p_token\)/share_token_hash = p_token/g' $S/green.sql > $S/m3.sql
diff -q $S/green.sql $S/m3.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m3.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `token_view_marks_viewed`, `accept_stamps_evidence`, `expired_token_REFUSED`, `withdrawn_token_REFUSED`, `rotate_kills_old_link` are `false`.

- [ ] **Step 5: Mutation 4 — the hash CHECK removed ⇒ a raw token can be stored.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe 's/ CONSTRAINT proposals_token_is_hash CHECK \(share_token_hash IS NULL OR share_token_hash ~ .\^\[0-9a-f\]\{64\}\$.\)//' $S/green.sql > $S/m4.sql
diff -q $S/green.sql $S/m4.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m4.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `raw_token_storage_REFUSED` is `false`. (If `diff` says the mutation did not apply, open `$S/green.sql`, find the column line, and edit a copy by hand to `share_token_hash  TEXT,` — the point is the red row, not the regex.)

- [ ] **Step 6: Mutation 5 — anon given a table grant.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
{ cat $S/green.sql; echo "GRANT SELECT ON solar.proposals TO anon;"; } > $S/m5.sql
scripts/db/dry-run-migration.sh $S/m5.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `anon_no_table_privilege` is `false`. (`anon_reads_proposals_REFUSED` may stay `true` if anon lacks USAGE on schema `solar` — the SELECT then still fails with 42501. That is precisely why the table privilege itself is asserted: with USAGE present, RLS has no anon policy, so the SELECT would silently return zero rows and only the privilege check would notice.)

- [ ] **Step 7: Mutation 6 — money read on `solar_can_view`.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe 's/(CREATE POLICY proposals_select ON solar\.proposals FOR SELECT TO authenticated\n    USING \(public\.)solar_can_see_money/${1}solar_can_view/' $S/green.sql > $S/m6.sql
diff -q $S/green.sql $S/m6.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m6.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `no_money_reads_no_proposals_editor` and `no_money_reads_no_proposals_view` are `false` (the client row stays true: its forged grant is capped to nothing by `user_max_grant_level`).

- [ ] **Step 8: Mutation 7 — the freeze removed.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6
perl -0pe "s/RAISE EXCEPTION 'solar\.proposals: an issued proposal is immutable' USING ERRCODE = '42501';/NULL;/" $S/green.sql > $S/m7.sql
diff -q $S/green.sql $S/m7.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m7.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -E 'false'
```
Expected: `issued_snapshot_immutable_REFUSED` is `false`.

- [ ] **Step 9: Record the mutation ledger** (seven mutations, each with the rows that went red) for the PR body. No commit.

---

### Task 4: Registries (product events, notification types) + `@esite/db` guards

**Files:**
- Modify: `packages/shared/src/lib/analytics/product-events.ts` (the `PRODUCT_EVENTS` array)
- Modify: `apps/web/src/lib/solar/notify.ts` (the `SolarNotificationType` union)

- [ ] **Step 1: Run the product-events contract test — expect RED.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -12
```
Expected: FAIL — the final CHECK (now `00217`) contains `solar_report_generated` … which `PRODUCT_EVENTS` lacks.

- [ ] **Step 2: Append to `PRODUCT_EVENTS`** (after `'solar_equipment_saved',`):

```ts
  'solar_report_generated',
  'solar_proposal_created',
  'solar_proposal_issued',
  'solar_proposal_withdrawn',
  'solar_proposal_responded',
  'solar_narrative_drafted',
```

- [ ] **Step 3: Widen the Solar notification union** in `apps/web/src/lib/solar/notify.ts`:

```ts
export type SolarNotificationType =
  | 'solar_subscribe_requested'
  | 'solar_access_requested'
  | 'solar_access_changed'
  | 'solar_access_declined'
  | 'solar_proposal_accepted'
  | 'solar_proposal_declined'
```
and change its header comment's "The four types are in notifications_type_check from 00209" to "The six types are in notifications_type_check (00209 + 00217)".

- [ ] **Step 4: Run the registries and the repo-wide migration guards.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -15
pnpm --filter web test -- src/lib/migration-verify-block.contract.test.ts src/lib/solar 2>&1 | tail -6
```
Expected: all PASS. `@esite/db` checks every SECURITY DEFINER function is revoked from anon in the TEXT (each one is spelled out, never an `EXECUTE format()` loop) and that no RESTRICTIVE `FOR ALL` exists; `migration-verify-block.contract.test.ts` parses `00217`'s block (unknown directive words, prose-only blocks and em dashes in `sql:` are refused). If `@esite/db` has a notification-type registry test, it now names the two new types; add them to whatever list it reads, the same way as Step 2.

- [ ] **Step 5: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add packages/shared/src/lib/analytics/product-events.ts apps/web/src/lib/solar/notify.ts
git commit -m "feat(solar): register Phase 6 product events and proposal notification types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
