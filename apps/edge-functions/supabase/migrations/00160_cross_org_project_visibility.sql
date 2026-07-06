-- ---------------------------------------------------------------------------
-- Migration 00160: cross-org project visibility
-- ---------------------------------------------------------------------------
-- Fixes a latent, high-severity intent-vs-implementation bug.
--
-- The membership spec (docs/.../2026-05-29-membership-system-design.md §2.4)
-- and the app-layer comments (apps/web/src/app/(admin)/projects/page.tsx,
-- packages/shared/src/services/project.service.ts) both assert that a user
-- from a contractor SUB-ORG (e.g. Bob's Building), when added to another org's
-- project via project_members, WILL see that project. In reality they could
-- not: every per-project SELECT policy from migration 00034 gates on
--
--     organisation_id = ANY(public.get_user_org_ids())
--
-- as a MANDATORY top-level AND. `get_user_org_ids()` returns only the caller's
-- OWN active `user_organisations` rows, and a sub-org contractor has NO
-- membership in the project's OWNING org — so the project row, its members,
-- RFIs, snags, diary, drawings, cables, inspections, etc. were all filtered
-- out of their lists. (The deeper tables gated by `user_has_project_access()`
-- — valuations, variations, reports, boq — already worked; the surfaces below
-- did not, so the experience was inconsistent and, for the headline "shared
-- sites appear in the contractor's project list", simply broken.)
--
-- Fix: ADD a second PERMISSIVE SELECT policy on each affected table that grants
-- read access whenever `public.user_has_project_access(<project_id>)` is TRUE.
-- Because PostgreSQL OR-combines permissive policies for the same command, this
-- is purely ADDITIVE — the existing 00034 policies are untouched, and the new
-- grant can never widen access beyond a real project membership (that is
-- exactly what `user_has_project_access` enforces: an active project_members
-- row whose identity org matches, OR owner/admin/PM of the project's org).
-- Client-viewer narrowing is preserved: a client_viewer only passes
-- `user_has_project_access` for projects they hold a project_members row on.
--
-- `user_has_project_access(uuid)` is SECURITY DEFINER (row_security off), and
-- EXECUTE is granted to `authenticated` (00068 / 00113), so it is safe to call
-- inside these RLS predicates without recursion.
--
-- Scope: the per-project SELECT surfaces defined by the "00034 client_viewer"
-- pattern. Adjacent per-project surfaces in the structure.*, tenants.*,
-- cable_schedule.*, inspections.* and gcr.* schemas share the same pattern and
-- are a documented follow-up (see the spec) — they take the identical additive
-- fix once their exact predicates are confirmed.
-- ---------------------------------------------------------------------------

-- ── projects schema: direct project_id (or id) column ──────────────────────

DROP POLICY IF EXISTS "Project members can view projects (cross-org)" ON projects.projects;
CREATE POLICY "Project members can view projects (cross-org)"
    ON projects.projects FOR SELECT
    USING (public.user_has_project_access(id));

DROP POLICY IF EXISTS "Project members can view project members (cross-org)" ON projects.project_members;
CREATE POLICY "Project members can view project members (cross-org)"
    ON projects.project_members FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view diary entries (cross-org)" ON projects.site_diary_entries;
CREATE POLICY "Project members can view diary entries (cross-org)"
    ON projects.site_diary_entries FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view rfis (cross-org)" ON projects.rfis;
CREATE POLICY "Project members can view rfis (cross-org)"
    ON projects.rfis FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view drawings (cross-org)" ON projects.drawings;
CREATE POLICY "Project members can view drawings (cross-org)"
    ON projects.drawings FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view contacts (cross-org)" ON projects.contacts;
CREATE POLICY "Project members can view contacts (cross-org)"
    ON projects.contacts FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view handover checklist (cross-org)" ON projects.handover_checklist;
CREATE POLICY "Project members can view handover checklist (cross-org)"
    ON projects.handover_checklist FOR SELECT
    USING (public.user_has_project_access(project_id));

-- ── projects schema: project_id reached via a parent row ───────────────────

DROP POLICY IF EXISTS "Project members can view rfi responses (cross-org)" ON projects.rfi_responses;
CREATE POLICY "Project members can view rfi responses (cross-org)"
    ON projects.rfi_responses FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM projects.rfis r
        WHERE r.id = rfi_responses.rfi_id
          AND public.user_has_project_access(r.project_id)
    ));

DROP POLICY IF EXISTS "Project members can view diary attachments (cross-org)" ON projects.site_diary_attachments;
CREATE POLICY "Project members can view diary attachments (cross-org)"
    ON projects.site_diary_attachments FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM projects.site_diary_entries e
        WHERE e.id = site_diary_attachments.diary_entry_id
          AND public.user_has_project_access(e.project_id)
    ));

-- ── field schema: direct project_id column ─────────────────────────────────

DROP POLICY IF EXISTS "Project members can view snags (cross-org)" ON field.snags;
CREATE POLICY "Project members can view snags (cross-org)"
    ON field.snags FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view cables (cross-org)" ON field.cables;
CREATE POLICY "Project members can view cables (cross-org)"
    ON field.cables FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view inspection milestones (cross-org)" ON field.inspection_milestones;
CREATE POLICY "Project members can view inspection milestones (cross-org)"
    ON field.inspection_milestones FOR SELECT
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Project members can view inspection requests (cross-org)" ON field.inspection_requests;
CREATE POLICY "Project members can view inspection requests (cross-org)"
    ON field.inspection_requests FOR SELECT
    USING (public.user_has_project_access(project_id));

-- ── field schema: project_id reached via a parent row ──────────────────────

DROP POLICY IF EXISTS "Project members can view snag photos (cross-org)" ON field.snag_photos;
CREATE POLICY "Project members can view snag photos (cross-org)"
    ON field.snag_photos FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM field.snags s
        WHERE s.id = snag_photos.snag_id
          AND public.user_has_project_access(s.project_id)
    ));
