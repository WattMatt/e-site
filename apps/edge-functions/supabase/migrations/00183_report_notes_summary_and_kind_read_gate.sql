-- =============================================================================
-- Migration 00183 — saved-report notes/summary + per-kind read gating
-- =============================================================================
-- Two changes to projects.reports (00117), both additive and idempotent:
--
--   1. `note` + `summary` columns. The generator cost-recovery module forked its
--      own gcr.report_revisions table (00127) — AFTER 00117 shipped — largely
--      because the unified table could not carry a revision note or headline
--      figures for the history list. Adding them here removes the reason to
--      fork a third time, and every existing kind gains them for free.
--
--   2. A per-kind READ gate. The saved-report read path is currently role-blind:
--      reports_select (00117) gates only on public.user_has_project_access(),
--      which returns TRUE for ANY projects.project_members row regardless of
--      role (00106 clause (a)). Neither listProjectReportsAction nor
--      getProjectReportUrlAction re-checks role before minting a service-client
--      signed URL — the only role gate in project-reports.actions.ts is on
--      DELETE. A client_viewer with project access can therefore list and
--      download any saved report of any kind by invoking the server action
--      directly; page-level gating is not a gate (the PR #135 lesson).
--
--      That is tolerable for kinds whose content the viewer can already see on
--      screen (inspection, snag, qc, site_form, tenant_schedule). It is NOT
--      tolerable for kinds carrying commercial detail the portal deliberately
--      withholds:
--        • equipment_materials — order notes + quote/order-instruction status
--        • valuation           — payment certificates
--
--      A RESTRICTIVE policy is used so it INTERSECTS with reports_select rather
--      than widening it (00171 pattern), closing direct PostgREST as well as
--      the server actions. The application layer enforces the same map in
--      REPORT_KIND_READ_ROLES; this is the defence that does not depend on it.
--
-- Non-destructive, additive, idempotent (safe to re-run). projects is already
-- PostgREST-exposed and no schema is created, so a trailing NOTIFY suffices —
-- no config PATCH (00117 precedent).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Revision note + headline summary
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects.reports
  ADD COLUMN IF NOT EXISTS note    TEXT,
  ADD COLUMN IF NOT EXISTS summary JSONB;

COMMENT ON COLUMN projects.reports.note IS
  'Optional free-text note captured at generate time, shown in the history list.';
COMMENT ON COLUMN projects.reports.summary IS
  'Headline figures for the history list, so listing never re-runs the gather or touches storage.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-kind read gate
-- ─────────────────────────────────────────────────────────────────────────────

-- Sensitive kinds are listed in ONE place. Adding a kind here is the only change
-- needed to gate it; the application-side contract test asserts that every kind
-- the codebase writes has a declared read policy.
CREATE OR REPLACE FUNCTION public.report_kind_is_sensitive(_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT _kind IN ('equipment_materials', 'valuation')
$function$;

-- TRUE when the caller may read a saved report of this kind for this project.
-- Non-sensitive kinds keep today's behaviour (project access, enforced by the
-- permissive reports_select policy that this one intersects with).
--
-- SECURITY DEFINER + row_security=off so the policy never inline-joins
-- RLS-protected tables (the 2026-05-21 storage-RLS bug). current_user is NOT
-- consulted for authorisation — under SECURITY DEFINER it is the function owner,
-- which is what made the site-forms state-transition trigger inert (PR #160 #2).
CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    -- COALESCE, not a bare IN: user_effective_project_role returns NULL for a
    -- non-member, and `NULL IN (...)` is NULL, not FALSE. A RESTRICTIVE USING
    -- treats NULL as false so the row is still hidden, but a boolean gate that
    -- can return NULL is one refactor away from being read as "unknown =
    -- allowed". Verified on prod: a caller with no role now gets FALSE.
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;

-- Postgres grants EXECUTE to PUBLIC by default, so restrict before granting or
-- the GRANT merely adds (the PR #160 #1 lesson).
--
-- REVOKing PUBLIC is NOT sufficient here. Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated, service_role`, which grants `anon` DIRECTLY at creation
-- time — a separate grant that a REVOKE FROM PUBLIC does not touch. Verified on
-- prod: after the first apply, `anon` still held EXECUTE on both functions.
-- anon must be named explicitly.
REVOKE ALL ON FUNCTION public.report_kind_is_sensitive(TEXT)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_kind_is_sensitive(TEXT)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS reports_kind_read_gate ON projects.reports;
CREATE POLICY reports_kind_read_gate
    ON projects.reports
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (public.user_can_read_report_kind(project_id, kind));

-- Adding a policy does not change the schema cache, but the new columns do.
NOTIFY pgrst, 'reload schema';
