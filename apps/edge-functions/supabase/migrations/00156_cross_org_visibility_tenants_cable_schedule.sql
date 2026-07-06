-- ---------------------------------------------------------------------------
-- Migration 00156: cross-org project visibility — tenants.* + cable_schedule.*
-- ---------------------------------------------------------------------------
-- Follow-up to migration 00155 (cross-org project visibility). 00155 fixed the
-- per-project SELECT surfaces in the `projects.*` and `field.*` schemas so a
-- contractor from a SUB-ORG (e.g. Bob's Building), added to another org's
-- project via `projects.project_members`, can actually SEE that project's data.
-- 00155's own header named the adjacent per-project surfaces in the
-- `structure.*`, `tenants.*`, `cable_schedule.*`, `inspections.*` and `gcr.*`
-- schemas as a documented follow-up "once their exact predicates are confirmed".
--
-- This migration IS that follow-up. Each candidate table's CURRENT SELECT
-- policy was read verbatim before deciding — NOT assumed from the enumeration.
-- That verification materially narrowed the scope: most of the flagged
-- structure.*/inspections.*/gcr.* tables were already authored on the correct
-- `user_has_project_access(...)` pattern and never had the bug, while the
-- cable_schedule.* schema turned out to hold the bulk of the genuinely-broken
-- surfaces. See "Scope decisions" below for the per-table evidence.
--
-- The broken pattern (from the "00034 client_viewer" family): every SELECT
-- policy gates on
--
--     organisation_id = ANY(public.get_user_org_ids())
--
-- as a MANDATORY top-level AND. `get_user_org_ids()` returns only the caller's
-- OWN active `user_organisations` rows; a sub-org contractor has NO membership
-- in the project's OWNING org, so the row is filtered out even though they hold
-- a legitimate `project_members` row.
--
-- Fix (identical to 00155): ADD a second PERMISSIVE SELECT policy on each
-- affected table granting read whenever `public.user_has_project_access(
-- <project_id>)` is TRUE. PostgreSQL OR-combines permissive policies for the
-- same command, so this is purely ADDITIVE — the existing policies are
-- untouched, and the new grant can never widen access beyond a real project
-- membership (exactly what `user_has_project_access` enforces: an active
-- `project_members` row whose identity org matches, OR owner/admin/PM of the
-- project's org). `user_has_project_access(uuid)` is SECURITY DEFINER
-- (row_security off) with EXECUTE granted to `authenticated` (00066/00106/00113),
-- so it is safe to call inside these RLS predicates without recursion.
--
-- Client-viewer semantics are preserved on every table below: each already
-- grants a client_viewer project-scoped read (via `NOT user_is_client_viewer
-- OR EXISTS project_members`, or has no client-viewer narrowing at all), so
-- the additive plain `user_has_project_access` grant matches — it does not
-- defeat any tighter narrowing. (This is precisely why gcr.report_revisions and
-- inspections.inspections are EXCLUDED — they apply a client-viewer rule
-- STRICTER than project membership; see below.)
--
-- Sequencing: this migration is the logical successor to 00155 (PR #119) but is
-- INDEPENDENT of it — it only depends on `public.user_has_project_access`
-- (defined 00066, relaxed 00106), not on 00155's policies. It applies correctly
-- whether or not 00155 has been applied. It must merge AFTER 00155 to keep the
-- migration sequence gap-free.
--
-- ===========================================================================
-- Scope decisions (per-table verification result)
-- ===========================================================================
-- INCLUDED — genuinely broken (org-scoped AND-gate) + real project linkage:
--   tenants.documents ................ DIRECT project_id            (00041)
--   tenants.handover_folders ......... DIRECT project_id            (00045)
--   tenants.floor_plan_versions ...... DIRECT project_id            (00148)
--   cable_schedule.revisions ......... DIRECT project_id            (00051)
--   cable_schedule.sans_overrides .... DIRECT project_id            (00053)
--   cable_schedule.sources ........... via revisions               (00051)
--   cable_schedule.boards ............ via revisions               (00051)
--   cable_schedule.supplies .......... via revisions               (00051)
--   cable_schedule.cables ............ via revisions               (00051)
--   cable_schedule.terminations ...... via cables -> revisions      (00051)
--   cable_schedule.cable_tags ........ via cables -> revisions      (00051)
--   cable_schedule.cost_lines ........ via revisions               (00051)
--   cable_schedule.change_log ........ via revisions               (00051)
--   cable_schedule.mv_study_settings . via revisions               (00128)
--   cable_schedule.fault_sources ..... via revisions               (00128)
--   cable_schedule.protection_devices  via revisions               (00129)
--   cable_schedule.fault_results ..... via revisions               (00129)
--   cable_schedule.discrimination_checks via revisions             (00129)
--   cable_schedule.mv_study_signoff .. via revisions               (00130)
--
-- EXCLUDED — already on the correct `user_has_project_access` pattern (a
-- cross-org project member already passes; no bug, adding would be redundant):
--   inspections.inspections (00066); structure.nodes (00075);
--   structure.tenant_details / tenant_scope_items (00080);
--   structure.tenant_units (00116); structure.tenant_documents /
--   tenant_document_revisions (00118); gcr.report_revisions (00127) and all
--   other gcr.* SELECT policies (00124/00127).
--
-- EXCLUDED — adding a plain grant would OVER-GRANT (defeats a client-viewer
-- narrowing STRICTER than project membership), and they already work cross-org:
--   gcr.report_revisions (fully excludes client_viewers — cost data must never
--   reach the client portal); inspections.inspections (client_viewers see only
--   status = 'certified').
--
-- EXCLUDED — no project linkage, mechanical fix inapplicable (org-level data):
--   inspections.templates (00066) — org/system template library, no project_id;
--   structure.scope_item_types (00080) — org-level registry, no project_id.
--
-- EXCLUDED — world-readable already (SELECT USING (true)); nothing to fix:
--   cable_schedule.sans_tables, cable_schedule.sans_rows (00053).
--
-- EXCLUDED — deliberate product decision (confirmed): commercial rate data:
--   cable_schedule.rate_library — firm-wide rate card. It gained a project_id in
--   00092 but 00092 intentionally kept RLS org-scoped. Exposing an owning firm's
--   rate card to a sub-org contractor is a business decision, not a bug, so it
--   stays org-scoped.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- tenants schema — direct project_id column
-- ===========================================================================

DROP POLICY IF EXISTS "Project members can view documents (cross-org)" ON tenants.documents;
CREATE POLICY "Project members can view documents (cross-org)"
    ON tenants.documents FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view handover folders (cross-org)" ON tenants.handover_folders;
CREATE POLICY "Project members can view handover folders (cross-org)"
    ON tenants.handover_folders FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view floor plan versions (cross-org)" ON tenants.floor_plan_versions;
CREATE POLICY "Project members can view floor plan versions (cross-org)"
    ON tenants.floor_plan_versions FOR SELECT
    USING (public.user_has_project_access(project_id));


-- ===========================================================================
-- cable_schedule schema — direct project_id column
-- ===========================================================================

DROP POLICY IF EXISTS "Project members can view cable revisions (cross-org)" ON cable_schedule.revisions;
CREATE POLICY "Project members can view cable revisions (cross-org)"
    ON cable_schedule.revisions FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view SANS overrides (cross-org)" ON cable_schedule.sans_overrides;
CREATE POLICY "Project members can view SANS overrides (cross-org)"
    ON cable_schedule.sans_overrides FOR SELECT
    USING (public.user_has_project_access(project_id));


-- ===========================================================================
-- cable_schedule schema — project_id reached via the parent revision
-- (child.revision_id -> cable_schedule.revisions.project_id)
-- ===========================================================================

DROP POLICY IF EXISTS "Project members can view cable sources (cross-org)" ON cable_schedule.sources;
CREATE POLICY "Project members can view cable sources (cross-org)"
    ON cable_schedule.sources FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = sources.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view cable boards (cross-org)" ON cable_schedule.boards;
CREATE POLICY "Project members can view cable boards (cross-org)"
    ON cable_schedule.boards FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = boards.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view cable supplies (cross-org)" ON cable_schedule.supplies;
CREATE POLICY "Project members can view cable supplies (cross-org)"
    ON cable_schedule.supplies FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = supplies.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

-- Distinct label: field.cables already owns "…view cables (cross-org)" (00155).
DROP POLICY IF EXISTS "Project members can view cable-schedule cables (cross-org)" ON cable_schedule.cables;
CREATE POLICY "Project members can view cable-schedule cables (cross-org)"
    ON cable_schedule.cables FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = cables.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view cable cost lines (cross-org)" ON cable_schedule.cost_lines;
CREATE POLICY "Project members can view cable cost lines (cross-org)"
    ON cable_schedule.cost_lines FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = cost_lines.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view cable change log (cross-org)" ON cable_schedule.change_log;
CREATE POLICY "Project members can view cable change log (cross-org)"
    ON cable_schedule.change_log FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = change_log.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view MV study settings (cross-org)" ON cable_schedule.mv_study_settings;
CREATE POLICY "Project members can view MV study settings (cross-org)"
    ON cable_schedule.mv_study_settings FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = mv_study_settings.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view fault sources (cross-org)" ON cable_schedule.fault_sources;
CREATE POLICY "Project members can view fault sources (cross-org)"
    ON cable_schedule.fault_sources FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = fault_sources.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view protection devices (cross-org)" ON cable_schedule.protection_devices;
CREATE POLICY "Project members can view protection devices (cross-org)"
    ON cable_schedule.protection_devices FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = protection_devices.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view fault results (cross-org)" ON cable_schedule.fault_results;
CREATE POLICY "Project members can view fault results (cross-org)"
    ON cable_schedule.fault_results FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = fault_results.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view discrimination checks (cross-org)" ON cable_schedule.discrimination_checks;
CREATE POLICY "Project members can view discrimination checks (cross-org)"
    ON cable_schedule.discrimination_checks FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = discrimination_checks.revision_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view MV study signoff (cross-org)" ON cable_schedule.mv_study_signoff;
CREATE POLICY "Project members can view MV study signoff (cross-org)"
    ON cable_schedule.mv_study_signoff FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.revisions r
        WHERE r.id = mv_study_signoff.revision_id
          AND public.user_has_project_access(r.project_id)
    ));


-- ===========================================================================
-- cable_schedule schema — project_id reached via cable -> revision (2-level)
-- (child.cable_id -> cables.revision_id -> revisions.project_id)
-- ===========================================================================

DROP POLICY IF EXISTS "Project members can view cable terminations (cross-org)" ON cable_schedule.terminations;
CREATE POLICY "Project members can view cable terminations (cross-org)"
    ON cable_schedule.terminations FOR SELECT
    USING (EXISTS (
        SELECT 1
        FROM cable_schedule.cables c
        JOIN cable_schedule.revisions r ON r.id = c.revision_id
        WHERE c.id = terminations.cable_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view cable tags (cross-org)" ON cable_schedule.cable_tags;
CREATE POLICY "Project members can view cable tags (cross-org)"
    ON cable_schedule.cable_tags FOR SELECT
    USING (EXISTS (
        SELECT 1
        FROM cable_schedule.cables c
        JOIN cable_schedule.revisions r ON r.id = c.revision_id
        WHERE c.id = cable_tags.cable_id
          AND public.user_has_project_access(r.project_id)
    ));

-- ---------------------------------------------------------------------------
-- Verification (run against the demo seed, as a sub-org contractor added to a
-- cross-org project via projects.project_members):
--   * Before: SELECT from cable_schedule.revisions / tenants.documents for the
--     shared project returns 0 rows (org-membership AND-gate blocks them).
--   * After: the same SELECTs return the project's rows; a contractor with NO
--     project_members row still sees 0 (user_has_project_access = FALSE).
--   * Owner/admin/PM of the owning org: unchanged (they already passed the
--     org-scoped policy; user_has_project_access clause (b) also covers them).
--   * client_viewer: unchanged scope (still limited to assigned projects; the
--     excluded gcr/inspections tables retain their stricter viewer rules).
--
-- Rollback (forward-only repo; run manually if needed):
--   DROP POLICY IF EXISTS "<policy name>" ON <schema>.<table>;  -- for each above
-- ---------------------------------------------------------------------------
