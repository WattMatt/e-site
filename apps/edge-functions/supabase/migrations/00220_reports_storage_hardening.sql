-- ---------------------------------------------------------------------------
-- Migration 00220: the `reports` bucket is service-only; a report row's file
-- path must belong to the row
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claimed 2026-09-29 above every open PR's migration (the Solar
-- branches hold 00207-00219; #191 00201 and #193 00202 are stranded below the
-- ledger head 00206). RE-CLAIM AT APPLY TIME: check the ledger, origin/main and
-- every open PR's migration filenames immediately before applying, and rename
-- this file (and its assertion-file references) if anything has moved.
--
-- WHY. Proven on production in a rolled-back transaction
-- (scripts/db/assert-reports-storage-hardening.sql, 15 of 23 red before this
-- migration, 8 controls green):
--
--  1. 00117's four "Org members … reports" storage policies admit ANY active
--     org member, on the org folder alone. The rbac-test contractor (member of
--     one project) could read all 19 objects in the bucket - including the
--     equipment_materials PDFs (owner/admin/PM only in the app and behind
--     00183's RESTRICTIVE row gate) and every generator-cost-recovery PDF
--     (COST_VIEW_ROLES + a paid seat in the app) - and could upload, overwrite
--     and delete them. A client_viewer could read all 19 (00162 blocks only
--     their writes). 00183 closed the ROW; the FILE stayed open by path.
--  2. 00117's reports_write (FOR ALL, org owner/admin/PM) checks only that the
--     caller manages the row's organisation_id. It binds neither the path nor
--     the project: a row may name ANY storage_path, and may sit on another
--     org's project. Eight server paths then trust that path and act on it
--     with the SERVICE client (sign / download / remove):
--     getProjectReportUrlAction, deleteProjectReportAction, getPortalQcReport-
--     PdfUrlAction, the QC-issued email, getValuationReportUrlAction, the cable
--     route-sheet appendix, and (gcr.report_revisions, same shape, 00127's
--     insert policy) getGcrReportUrlAction / deleteGcrReportRevisionAction.
--     So an owner/admin/PM of ANY org - including one of the external orgs -
--     could have another org's PDF signed for them, or deleted, and could
--     plant a report (row + uploaded PDF) into another org's project list.
--
-- WHAT
--  * storage.objects, bucket `reports`: the four 00117 permissive policies
--    are dropped and four per-verb RESTRICTIVE policies refuse the bucket to
--    every session role (authenticated, anon). Every writer, signer and
--    downloader in the monorepo already uses the service client (which
--    bypasses RLS) after its own role gate; the one session signer (the
--    inspection certificate page) moves to the service client in the same PR.
--    Restrictive as well as dropping, so a later permissive re-grant cannot
--    silently re-open the bucket.
--  * projects.reports and gcr.report_revisions: RESTRICTIVE INSERT and UPDATE
--    policies require public.report_path_belongs(org, project, path): the
--    project belongs to the org, and the path is canonical
--    `<org uuid>/<project uuid>/[dir/…]<file>.pdf` under THAT org and project
--    with no `..`. Canonical matters because storage-js puts the path into the
--    URL unencoded and the URL parser rewrites `\`, TAB/CR/LF, `.`, `..` and
--    `%2e%2e` - a raw prefix test is not a test of the object that gets
--    signed. All 14 report rows and 6 gcr revisions in production satisfy it
--    (asserted). DELETE and SELECT are untouched.
--
-- RULES
--  * Per verb only, never RESTRICTIVE FOR ALL (FOR ALL narrows SELECT too -
--    the 00205/00206 lesson). SELECT on projects.reports stays exactly 00117 +
--    00183.
--  * No BEGIN/COMMIT: the runner wraps the file.
--  * Overlap with PR #217's 00216 (Solar): 00216 adds solar_pdfs_service_only_*
--    on storage.objects and reports_solar_service_only_* on projects.reports.
--    Both sets are RESTRICTIVE and AND together with these, so either order of
--    apply is correct; 00216's canonical-path clauses become redundant with
--    this migration but are harmless. See the PR body for the exact list.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- function: public.report_path_belongs(uuid, uuid, text)
-- grant_absent: anon EXECUTE ON public.report_path_belongs(uuid, uuid, text)
-- policy: reports_bucket_service_only_select ON storage.objects RESTRICTIVE
-- policy: reports_bucket_service_only_insert ON storage.objects RESTRICTIVE
-- policy: reports_bucket_service_only_update ON storage.objects RESTRICTIVE
-- policy: reports_bucket_service_only_delete ON storage.objects RESTRICTIVE
-- policy: reports_path_authz_insert ON projects.reports RESTRICTIVE
-- policy: reports_path_authz_update ON projects.reports RESTRICTIVE
-- policy: report_revisions_path_authz_insert ON gcr.report_revisions RESTRICTIVE
-- policy: report_revisions_path_authz_update ON gcr.report_revisions RESTRICTIVE
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('Org members read reports', 'Org members upload reports', 'Org members update reports', 'Org members delete reports'))
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE' AND strpos(coalesce(qual, '') || coalesce(with_check, ''), '''reports''::text') > 0)
-- sql: (SELECT count(*) = 4 AND count(DISTINCT cmd) = 4 AND bool_and(cmd <> 'ALL') FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'reports\_bucket\_service\_only\_%' AND permissive = 'RESTRICTIVE')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE ((schemaname = 'projects' AND tablename = 'reports') OR (schemaname = 'gcr' AND tablename = 'report_revisions')) AND permissive = 'RESTRICTIVE' AND policyname LIKE '%path\_authz%' AND cmd NOT IN ('INSERT', 'UPDATE'))
-- sql: (SELECT count(*) = 0 FROM projects.reports WHERE NOT public.report_path_belongs(organisation_id, project_id, storage_path))
-- sql: (SELECT count(*) = 0 FROM gcr.report_revisions WHERE NOT public.report_path_belongs(organisation_id, project_id, storage_path))
-- sql: (SELECT NOT public.report_path_belongs(p.organisation_id, p.id, p.organisation_id::text || '/' || p.id::text || '/../x.pdf') FROM projects.projects p ORDER BY p.created_at LIMIT 1)
-- behaviour: scripts/db/assert-reports-storage-hardening.sql is green through dry-run-migration.sh (contractor, client viewer, admin and external owner refused; controls pass)
-- @verify:end

-- ── 1. The path predicate ───────────────────────────────────────────────────
-- SECURITY DEFINER with row_security off so the project→org lookup does not
-- depend on what the caller can see (a caller who cannot see the project gets
-- FALSE either way, which is the right answer). Pure otherwise.
CREATE OR REPLACE FUNCTION public.report_path_belongs(_org UUID, _project UUID, _path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT _org IS NOT NULL
     AND _project IS NOT NULL
     AND coalesce(_path, '') ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.pdf$'
     AND strpos(_path, '..') = 0
     AND starts_with(_path, _org::text || '/' || _project::text || '/')
     AND EXISTS (SELECT 1 FROM projects.projects p WHERE p.id = _project AND p.organisation_id = _org)
$function$;
REVOKE ALL ON FUNCTION public.report_path_belongs(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_path_belongs(UUID, UUID, TEXT) TO authenticated, service_role;

-- ── 2. Bucket `reports`: service-only ────────────────────────────────────────
DROP POLICY IF EXISTS "Org members read reports"   ON storage.objects;
DROP POLICY IF EXISTS "Org members upload reports" ON storage.objects;
DROP POLICY IF EXISTS "Org members update reports" ON storage.objects;
DROP POLICY IF EXISTS "Org members delete reports" ON storage.objects;

DROP POLICY IF EXISTS reports_bucket_service_only_select ON storage.objects;
CREATE POLICY reports_bucket_service_only_select ON storage.objects
    AS RESTRICTIVE FOR SELECT TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports');
DROP POLICY IF EXISTS reports_bucket_service_only_insert ON storage.objects;
CREATE POLICY reports_bucket_service_only_insert ON storage.objects
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (bucket_id IS DISTINCT FROM 'reports');
DROP POLICY IF EXISTS reports_bucket_service_only_update ON storage.objects;
CREATE POLICY reports_bucket_service_only_update ON storage.objects
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports')
    WITH CHECK (bucket_id IS DISTINCT FROM 'reports');
DROP POLICY IF EXISTS reports_bucket_service_only_delete ON storage.objects;
CREATE POLICY reports_bucket_service_only_delete ON storage.objects
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (bucket_id IS DISTINCT FROM 'reports');

-- ── 3. projects.reports: a session-written row's path belongs to the row ────
DROP POLICY IF EXISTS reports_path_authz_insert ON projects.reports;
CREATE POLICY reports_path_authz_insert ON projects.reports
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.report_path_belongs(organisation_id, project_id, storage_path));
DROP POLICY IF EXISTS reports_path_authz_update ON projects.reports;
CREATE POLICY reports_path_authz_update ON projects.reports
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.report_path_belongs(organisation_id, project_id, storage_path))
    WITH CHECK (public.report_path_belongs(organisation_id, project_id, storage_path));

-- ── 4. gcr.report_revisions: same rule (getGcrReportUrlAction service-signs it)
DROP POLICY IF EXISTS report_revisions_path_authz_insert ON gcr.report_revisions;
CREATE POLICY report_revisions_path_authz_insert ON gcr.report_revisions
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.report_path_belongs(organisation_id, project_id, storage_path));
DROP POLICY IF EXISTS report_revisions_path_authz_update ON gcr.report_revisions;
CREATE POLICY report_revisions_path_authz_update ON gcr.report_revisions
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.report_path_belongs(organisation_id, project_id, storage_path))
    WITH CHECK (public.report_path_belongs(organisation_id, project_id, storage_path));

NOTIFY pgrst, 'reload schema';
