-- 00259_mcp_open_database.sql
--
-- The E-Site MCP server's "open database" slice: the person's own client reads and writes the exposed
-- schemas through PostgREST, under their own RLS. Three objects support that, all used AS THE PERSON:
--
--   public.mcp_previews        a person's update/delete previews. The row id is the previewId the client
--                              receives; a confirm must present it, unconsumed, under 24 h, with the same
--                              args digest. A person reads and writes only their own rows (user_id =
--                              auth.uid() in USING and WITH CHECK). matched_ids is NULL for a count-only
--                              preview. Written through the person's client, never the service key.
--
--   public.mcp_run_select(sql) one read-only SELECT, run as the caller. SECURITY INVOKER, so the dynamic
--                              statement runs as `authenticated` with the caller's claims and RLS applies
--                              exactly as for any PostgREST read. Three guards stop a write:
--                                (1) the text check: one statement starting with select/with, no inner ';'
--                                    (one trailing ';' is dropped), none of the listed functions as a word.
--                                    It runs on the comment-stripped text, and that text is what executes.
--                                (2) the function switches the TRANSACTION to read-only itself
--                                    (set_config('transaction_read_only','on',true), then checks it took).
--                                    Turning read-only ON mid-transaction is always allowed and OFF is not,
--                                    so nothing inside the statement can undo it. The rest of the caller's
--                                    transaction stays read-only too, except that a savepoint around the
--                                    call restores the parent's mode when it is released (measured).
--                                    THIS is the guard that stops a VOLATILE function
--                                    (SECURITY DEFINER included) called from inside the SELECT: its writes
--                                    fail 25006. Nothing is assumed about how PostgREST opened the
--                                    transaction.
--                                (3) STABLE: plpgsql runs the function's own SPI read-only, which refuses
--                                    SELECT … FOR UPDATE (0A000). It does NOT reach into a VOLATILE callee.
--                                    A data-modifying CTE is also refused because it cannot be nested in
--                                    the wrapper (0A000).
--                              The time cap is the `authenticated` role's statement_timeout (8 s on
--                              2026-11-03); the word list is not a time cap (U&"…" identifiers pass it).
--                              Fetch cap 1001 rows: the tool returns 1000 and flags truncation. The user's
--                              statement is wrapped as a subquery, so its own ORDER BY … LIMIT survives.
--                              Reach: anything `authenticated` can read, including pg_catalog,
--                              information_schema and storage (under RLS); vault, auth.users and cron.job
--                              are refused. ⚠ net._http_response and net.http_request_queue are granted
--                              to PUBLIC by supabase_admin (pg_net) and are readable; postgres cannot
--                              revoke that grant (it is not the grantor), so it is NOT closed here.
--                              Not granted to service_role: the tool calls it with the
--                              person's bearer, and the cost-role gate lives in the tool.
--
--   public.mcp_catalog(schema) the 14 exposed schemas (hard-coded, PostgREST db_schema order) with table
--                              counts; or one schema's tables and views with their columns. Read from
--                              information_schema, which already filters to what the role may touch. Any
--                              other schema name returns [].
--
-- Grants: Supabase's default privileges hand new public tables and functions to anon, authenticated and
-- service_role directly, so REVOKE … FROM PUBLIC alone removes nothing; every revoke names the roles.
-- authenticated is revoked too and then given exactly SELECT/INSERT/DELETE plus UPDATE of consumed_at only:
-- the default ALL would include TRUNCATE, which ignores row security, and a preview's other columns are
-- fixed once written.
--
-- @verify:begin
-- table: public.mcp_previews
-- policy: mcp_previews_own ON public.mcp_previews PERMISSIVE
-- function: public.mcp_run_select(text)
-- function: public.mcp_catalog(text)
-- grant_absent: anon EXECUTE ON public.mcp_run_select(text)
-- grant_absent: anon EXECUTE ON public.mcp_catalog(text)
-- grant_present: authenticated EXECUTE ON public.mcp_run_select(text)
-- grant_absent: service_role EXECUTE ON public.mcp_run_select(text)
-- grant_absent: anon SELECT ON public.mcp_previews
-- grant_absent: authenticated TRUNCATE ON public.mcp_previews
-- sql: (SELECT has_column_privilege('authenticated', 'public.mcp_previews', 'consumed_at', 'UPDATE'))
-- sql: (SELECT NOT has_column_privilege('authenticated', 'public.mcp_previews', 'created_at', 'UPDATE'))
-- sql: (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.mcp_run_select(text)'::regprocedure)
-- sql: (SELECT jsonb_array_length(public.mcp_catalog()) = 14)
-- behaviour: mcp_run_select runs as the caller under RLS and refuses anything but one read-only SELECT; mcp_catalog lists the 14 exposed schemas; a person reads and writes only their own mcp_previews rows; anon and service_role cannot execute; proven by scripts/db/assert-mcp-open-database.sql
-- @verify:end

-- ── 1. Previews ─────────────────────────────────────────────────────────────
CREATE TABLE public.mcp_previews (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL DEFAULT auth.uid(),
    tool         text        NOT NULL,
    args_digest  text        NOT NULL,
    matched_ids  jsonb,
    would_affect integer     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    consumed_at  timestamptz
);

CREATE INDEX mcp_previews_user_created_idx ON public.mcp_previews (user_id, created_at);

ALTER TABLE public.mcp_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_previews FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.mcp_previews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mcp_previews TO authenticated;
GRANT UPDATE (consumed_at) ON public.mcp_previews TO authenticated;
GRANT ALL ON public.mcp_previews TO service_role;

CREATE POLICY mcp_previews_own ON public.mcp_previews AS PERMISSIVE FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ── 2. One read-only SELECT, as the caller ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_run_select(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_sql    text;
    v_result jsonb;
BEGIN
    -- Comments become a space, as the lexer treats them; then trim.
    v_sql := regexp_replace(coalesce(p_sql, ''), '/\*.*?\*/', ' ', 'g');
    v_sql := regexp_replace(v_sql, '--[^\n]*', ' ', 'g');
    v_sql := btrim(v_sql, E' \t\r\n\f');
    -- Exactly one trailing ';' is tolerated ("select 1;"); a second one, or any inner one, is refused below.
    IF right(v_sql, 1) = ';' THEN
        v_sql := btrim(left(v_sql, -1), E' \t\r\n\f');
    END IF;

    IF v_sql !~* '^(select|with)\M'
       OR position(';' in v_sql) > 0
       OR v_sql ~* '\m(pg_sleep\w*|set_config|lo_import|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|pg_cancel_backend|pg_advisory\w*|pg_try_advisory\w*|dblink\w*)\M'
    THEN
        RAISE EXCEPTION 'Only one read-only SELECT is allowed here.' USING ERRCODE = 'P0001';
    END IF;

    -- The transaction becomes read-only from here on, for the caller too. ON is always allowed mid-
    -- transaction (OFF is not), so nothing later in this transaction can switch it back. SET LOCAL is a
    -- utility statement and is refused inside a STABLE function's SPI, hence set_config.
    PERFORM set_config('transaction_read_only', 'on', true);
    IF current_setting('transaction_read_only') <> 'on' THEN
        RAISE EXCEPTION 'Only one read-only SELECT is allowed here.' USING ERRCODE = 'P0001';
    END IF;

    -- Wrapped as a subquery so the statement's own ORDER BY … LIMIT is kept ("… limit 5 limit 1001" is a syntax error).
    EXECUTE format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (select * from (%s) s limit 1001) q', v_sql)
       INTO v_result;
    RETURN v_result;
END
$$;

-- ── 3. The catalogue of the exposed schemas ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_catalog(p_schema text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    WITH exposed (s, ord) AS (
        SELECT * FROM unnest(ARRAY[
            'public', 'projects', 'inspections', 'field', 'tenants', 'suppliers', 'billing',
            'marketplace', 'cable_schedule', 'structure', 'gcr', 'solar', 'tariffs', 'whatsapp'
        ]::text[]) WITH ORDINALITY
    )
    SELECT CASE
        WHEN p_schema IS NULL THEN (
            SELECT jsonb_agg(jsonb_build_object('schema', e.s, 'tables', coalesce(n.tables, 0)) ORDER BY e.ord)
              FROM exposed e
              LEFT JOIN (SELECT t.table_schema::text AS s, count(*) AS tables
                           FROM information_schema.tables t
                          GROUP BY t.table_schema) n ON n.s = e.s
        )
        WHEN p_schema IN (SELECT s FROM exposed) THEN coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'table',   t.table_name::text,
                       'kind',    CASE WHEN t.table_type = 'VIEW' THEN 'view' ELSE 'table' END,
                       'columns', coalesce(c.columns, '[]'::jsonb)
                   ) ORDER BY t.table_name)
              FROM information_schema.tables t
              LEFT JOIN (SELECT col.table_name::text AS table_name,
                                jsonb_agg(jsonb_build_object(
                                    'name',     col.column_name::text,
                                    'type',     col.data_type::text,
                                    'nullable', col.is_nullable = 'YES',
                                    'default',  col.column_default::text
                                ) ORDER BY col.ordinal_position) AS columns
                           FROM information_schema.columns col
                          WHERE col.table_schema = p_schema
                          GROUP BY col.table_name) c ON c.table_name = t.table_name::text
             WHERE t.table_schema = p_schema
        ), '[]'::jsonb)
        ELSE '[]'::jsonb
    END
$$;

-- Not service_role: the tool calls both with the person's bearer. Name anon (the 00162 finding).
REVOKE EXECUTE ON FUNCTION public.mcp_run_select(text) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.mcp_catalog(text)    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_run_select(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_catalog(text)    TO authenticated;

NOTIFY pgrst, 'reload schema';
