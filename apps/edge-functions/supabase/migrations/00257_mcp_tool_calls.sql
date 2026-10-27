-- 00257_mcp_tool_calls.sql
--
-- Audit trail for the E-Site MCP server (slice 1). Every tool call the server handles (read, preview
-- or write; ok, refused or error) is recorded once, by the server, through a definer RPC. Nobody
-- writes the table directly: there is no INSERT/UPDATE/DELETE grant for authenticated or anon and no
-- write policy, so a signed-in user cannot forge, edit or erase an audit row over REST.
--
-- What is stored: who (user_id, client_id), where (organisation_id, project_id), what (tool, kind,
-- args_digest = a digest of the arguments, never the arguments), the outcome and refusal sentence,
-- the ids the call produced (result_ids) and how long it took. user_id has no foreign key on purpose:
-- an audit row outlives the account it describes.
--
-- Who may read: a member reads their own rows, and only those on projects they can still access; an
-- org owner/admin reads every row of their org. The RESTRICTIVE `site_scope` policy carries that rule
-- (the name scripts/db/assert-site-scope-coverage.sql looks for on a table with a project_id column);
-- the PERMISSIVE `mcp_tool_calls_select` carries the same rule, because a RESTRICTIVE policy only
-- narrows and nothing would otherwise admit a row. `WITH CHECK (false)` on the RESTRICTIVE ALL policy
-- means that even if someone later grants INSERT and adds a permissive write policy, rows still cannot
-- be written by a session.
--
-- Two RPCs, SECURITY DEFINER, executable by service_role only:
--   public.mcp_rate_status(p_user)  calls and writes (preview + write) in the last 60 seconds.
--   public.record_mcp_call(...)     inserts one row and returns its id.
-- The definer is postgres, which has BYPASSRLS, so the FORCEd row security does not block them. Neither
-- function authorises with current_user; the only caller allowed is service_role, by grant.
--
-- Also re-declares public.product_events' event CHECK in full (00218's 31 events, same order) with
-- 'mcp_tool_called' appended.
--
-- @verify:begin
-- table: public.mcp_tool_calls
-- policy: site_scope ON public.mcp_tool_calls RESTRICTIVE
-- policy: mcp_tool_calls_select ON public.mcp_tool_calls PERMISSIVE
-- function: public.mcp_rate_status(uuid)
-- function: public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)
-- grant_absent: anon EXECUTE ON public.mcp_rate_status(uuid)
-- grant_absent: authenticated EXECUTE ON public.mcp_rate_status(uuid)
-- grant_absent: anon EXECUTE ON public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)
-- grant_absent: authenticated EXECUTE ON public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)
-- grant_present: service_role EXECUTE ON public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)
-- grant_absent: anon SELECT ON public.mcp_tool_calls
-- grant_absent: authenticated INSERT ON public.mcp_tool_calls
-- grant_absent: authenticated UPDATE ON public.mcp_tool_calls
-- grant_absent: authenticated DELETE ON public.mcp_tool_calls
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%mcp_tool_called%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- behaviour: a user reads only their own rows and rows of projects they can access; an org owner/admin reads the org's rows; anon and authenticated cannot insert; proven by scripts/db/assert-mcp-tool-calls.sql
-- @verify:end

-- ── 1. The audit table ──────────────────────────────────────────────────────
CREATE TABLE public.mcp_tool_calls (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL,
    client_id       text,
    organisation_id uuid,
    project_id      uuid,
    tool            text        NOT NULL,
    kind            text        NOT NULL CHECK (kind IN ('read', 'preview', 'write')),
    args_digest     text        NOT NULL,
    outcome         text        NOT NULL CHECK (outcome IN ('ok', 'refused', 'error')),
    refusal         text,
    result_ids      jsonb,
    duration_ms     integer     NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_tool_calls_user_created_idx    ON public.mcp_tool_calls (user_id, created_at DESC);
CREATE INDEX mcp_tool_calls_project_created_idx ON public.mcp_tool_calls (project_id, created_at DESC);

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tool_calls FORCE ROW LEVEL SECURITY;

-- Supabase's default privileges hand new public tables to anon/authenticated/service_role. Start from nothing.
REVOKE ALL ON public.mcp_tool_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mcp_tool_calls TO authenticated;
GRANT ALL ON public.mcp_tool_calls TO service_role;

-- ── 2. Row security ─────────────────────────────────────────────────────────
-- RESTRICTIVE FOR ALL named `site_scope` (the coverage assertion's contract). USING is the read rule;
-- WITH CHECK (false) makes the table unwritable by any session whatever is granted or added later.
CREATE POLICY site_scope ON public.mcp_tool_calls AS RESTRICTIVE FOR ALL
    USING (
        (user_id = auth.uid() OR public.user_is_org_admin(organisation_id))
        AND (project_id IS NULL OR public.user_has_project_access(project_id))
    )
    WITH CHECK (false);

-- The one permissive policy: SELECT only, same rule. No write policy exists, deliberately.
CREATE POLICY mcp_tool_calls_select ON public.mcp_tool_calls AS PERMISSIVE FOR SELECT TO authenticated
    USING (
        (user_id = auth.uid() OR public.user_is_org_admin(organisation_id))
        AND (project_id IS NULL OR public.user_has_project_access(project_id))
    );

-- ── 3. RPCs (service_role only) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_rate_status(p_user uuid)
RETURNS TABLE (calls integer, writes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::integer,
           (count(*) FILTER (WHERE kind IN ('preview', 'write')))::integer
      FROM public.mcp_tool_calls
     WHERE user_id = p_user
       AND created_at > now() - interval '60 seconds'
$$;

CREATE OR REPLACE FUNCTION public.record_mcp_call(
    p_user uuid, p_client text, p_org uuid, p_project uuid,
    p_tool text, p_kind text, p_args_digest text, p_outcome text,
    p_refusal text, p_result_ids jsonb, p_duration_ms integer
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO public.mcp_tool_calls
        (user_id, client_id, organisation_id, project_id, tool, kind, args_digest, outcome, refusal, result_ids, duration_ms)
    VALUES
        (p_user, p_client, p_org, p_project, p_tool, p_kind, p_args_digest, p_outcome, p_refusal, p_result_ids, p_duration_ms)
    RETURNING id
$$;

-- REVOKE FROM PUBLIC does not remove anon's direct default-privilege EXECUTE (the 00162 finding): name anon.
REVOKE EXECUTE ON FUNCTION public.mcp_rate_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_mcp_call(uuid, text, uuid, uuid, text, text, text, text, text, jsonb, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_rate_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mcp_call(uuid, text, uuid, uuid, text, text, text, text, text, jsonb, integer)
    TO service_role;

-- ── 4. Product events (re-declared in full: 00218's list + mcp_tool_called) ──
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
    'solar_narrative_drafted',
    'solar_installation_saved',
    'solar_guarantee_saved',
    'solar_downtime_saved',
    'solar_monthly_report_generated',
    'solar_handover_updated',
    -- 00257: the MCP server
    'mcp_tool_called'
));

NOTIFY pgrst, 'reload schema';
