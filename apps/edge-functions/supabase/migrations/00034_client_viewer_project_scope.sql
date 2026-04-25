-- ---------------------------------------------------------------------------
-- Migration 00034: client_viewer project-scoped RLS
-- ---------------------------------------------------------------------------
-- Spec §3 (line 110): `Client Viewer (site/project-scoped, read-only)`.
--
-- Pre-fix (bug surfaced 2026-04-21 staging QA): every SELECT policy on the
-- main entity tables only checked `organisation_id = ANY(get_user_org_ids())`,
-- which meant a `client_viewer` placed in `project_members` for ONE project
-- could read every project, snag, RFI, COC, diary entry, and order in the
-- entire organisation. This is a privacy/data-leak issue for any third-party
-- client placed on the org as a viewer.
--
-- Fix:
--   1. Helper `public.user_is_client_viewer(org_id)` — true iff the caller's
--      membership in that org is `client_viewer` (per-org, not global —
--      a user can be PM in one org and viewer in another).
--   2. Rewrite SELECT policies so that:
--        - Internal roles (owner/admin/project_manager/contractor) see all
--          org data — unchanged behaviour.
--        - client_viewer is restricted to projects where they're a member
--          via `projects.project_members`.
--   3. For tables with no project link (`compliance.*`, `marketplace.*`,
--      `field.cables`/`inspection_*`), block client_viewer entirely until
--      a per-project scope mechanism is designed (compliance schema lacks
--      a project_id FK; marketplace is Phase 2).
--   4. `projects.project_members`: client_viewer can only see their own
--      membership rows.
--
-- Tables touched: 16 (+1 helper function).
-- ---------------------------------------------------------------------------

-- ── Helper: is the caller a client_viewer in this org? ─────────────────────
-- SECURITY DEFINER + row_security=off so it can read user_organisations
-- without triggering recursive RLS checks.

CREATE OR REPLACE FUNCTION public.user_is_client_viewer(org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_organisations
        WHERE user_id = auth.uid()
          AND organisation_id = org_id
          AND is_active = TRUE
          AND role = 'client_viewer'
    )
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- projects.projects — `id` is the project itself
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can view projects" ON projects.projects;
CREATE POLICY "Org members can view projects"
    ON projects.projects FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- projects.project_members — clients see only their own row
-- (internal roles see all members of their org's projects)
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can view project members" ON projects.project_members;
CREATE POLICY "Org members can view project members"
    ON projects.project_members FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR user_id = auth.uid()
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- projects.* — direct project_id, scope client_viewer to assigned projects
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Org members can view projects.site_diary_entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can view projects.site_diary_entries"
    ON projects.site_diary_entries FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view projects.rfis" ON projects.rfis;
CREATE POLICY "Org members can view projects.rfis"
    ON projects.rfis FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view projects.drawings" ON projects.drawings;
CREATE POLICY "Org members can view projects.drawings"
    ON projects.drawings FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view projects.contacts" ON projects.contacts;
CREATE POLICY "Org members can view projects.contacts"
    ON projects.contacts FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view projects.handover_checklist" ON projects.handover_checklist;
CREATE POLICY "Org members can view projects.handover_checklist"
    ON projects.handover_checklist FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view projects.procurement_items" ON projects.procurement_items;
CREATE POLICY "Org members can view projects.procurement_items"
    ON projects.procurement_items FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- projects.rfi_responses — indirect (via rfi → project)
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can view rfi_responses" ON projects.rfi_responses;
CREATE POLICY "Org members can view rfi_responses"
    ON projects.rfi_responses FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects.rfis r
            WHERE r.id = projects.rfi_responses.rfi_id
              AND r.organisation_id = ANY(public.get_user_org_ids())
              AND (
                  NOT public.user_is_client_viewer(r.organisation_id)
                  OR r.project_id IN (
                      SELECT project_id FROM projects.project_members
                      WHERE user_id = auth.uid()
                  )
              )
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- field.snags + field.snag_photos
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can view snags" ON field.snags;
CREATE POLICY "Org members can view snags"
    ON field.snags FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view snag photos" ON field.snag_photos;
CREATE POLICY "Org members can view snag photos"
    ON field.snag_photos FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM field.snags s
            WHERE s.id = field.snag_photos.snag_id
              AND s.organisation_id = ANY(public.get_user_org_ids())
              AND (
                  NOT public.user_is_client_viewer(s.organisation_id)
                  OR s.project_id IN (
                      SELECT project_id FROM projects.project_members
                      WHERE user_id = auth.uid()
                  )
              )
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- field.cables / field.inspection_milestones / field.inspection_requests
-- All have project_id (verified via \d). Same pattern.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can view cables" ON field.cables;
CREATE POLICY "Org members can view cables"
    ON field.cables FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view inspection milestones" ON field.inspection_milestones;
CREATE POLICY "Org members can view inspection milestones"
    ON field.inspection_milestones FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Org members can view inspection requests" ON field.inspection_requests;
CREATE POLICY "Org members can view inspection requests"
    ON field.inspection_requests FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR project_id IN (
                SELECT project_id FROM projects.project_members
                WHERE user_id = auth.uid()
            )
        )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- compliance.* + marketplace.* — block client_viewer entirely.
--
-- Note: existing `ALL` policies (e.g. "Org members can manage sites") cover
-- SELECT and are OR'd with our SELECT-only policy by Postgres, defeating
-- the deny. The clean solution is RESTRICTIVE policies, which AND with
-- the permissive set. Internal roles unaffected because they're not
-- client_viewers.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Block client_viewer from compliance.sites" ON compliance.sites;
CREATE POLICY "Block client_viewer from compliance.sites"
    ON compliance.sites AS RESTRICTIVE FOR SELECT
    USING (NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "Block client_viewer from compliance.subsections" ON compliance.subsections;
CREATE POLICY "Block client_viewer from compliance.subsections"
    ON compliance.subsections AS RESTRICTIVE FOR SELECT
    USING (NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "Block client_viewer from compliance.coc_uploads" ON compliance.coc_uploads;
CREATE POLICY "Block client_viewer from compliance.coc_uploads"
    ON compliance.coc_uploads AS RESTRICTIVE FOR SELECT
    USING (NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "Block client_viewer from marketplace.orders" ON marketplace.orders;
CREATE POLICY "Block client_viewer from marketplace.orders"
    ON marketplace.orders AS RESTRICTIVE FOR SELECT
    USING (NOT public.user_is_client_viewer(contractor_org_id));

DROP POLICY IF EXISTS "Block client_viewer from marketplace.order_items" ON marketplace.order_items;
CREATE POLICY "Block client_viewer from marketplace.order_items"
    ON marketplace.order_items AS RESTRICTIVE FOR SELECT
    USING (
        NOT EXISTS (
            SELECT 1 FROM marketplace.orders o
            WHERE o.id = marketplace.order_items.order_id
              AND public.user_is_client_viewer(o.contractor_org_id)
        )
    );

-- Drop my earlier SELECT-only policies that were ineffective due to the
-- existing `ALL` permissive policies. The RESTRICTIVE policies above
-- handle the deny; the existing ALL policies handle the allow.
DROP POLICY IF EXISTS "Org members can view sites" ON compliance.sites;
DROP POLICY IF EXISTS "Org members can view subsections" ON compliance.subsections;
DROP POLICY IF EXISTS "Org members can view COC uploads" ON compliance.coc_uploads;
DROP POLICY IF EXISTS "Contractors can view their orders" ON marketplace.orders;
DROP POLICY IF EXISTS "Order parties can view order items" ON marketplace.order_items;

-- Re-create the marketplace.orders + order_items SELECT policies that
-- existed before (we dropped them in the same pass to keep the migration
-- idempotent on staging where the original policies still exist).
CREATE POLICY "Contractors can view their orders"
    ON marketplace.orders FOR SELECT
    USING (
        contractor_org_id = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Order parties can view order items"
    ON marketplace.order_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM marketplace.orders o
            WHERE o.id = marketplace.order_items.order_id
              AND (
                  o.contractor_org_id = ANY(public.get_user_org_ids())
                  OR o.supplier_org_id = ANY(public.get_user_org_ids())
              )
        )
    );

-- ---------------------------------------------------------------------------
-- Note on internal-role behaviour:
--   Owner/admin/project_manager/contractor see exactly what they did before
--   this migration — `NOT user_is_client_viewer(org_id)` short-circuits the
--   AND, so the project_members subquery is never evaluated for them.
--
-- Verification (run against the demo seed):
--   Owner/PM/Field on demo.owner/pm/field@wmeng.co.za → see 3 projects,
--     10+ snags, 3 sites, 5 diary entries, 2 orders.
--   Client on demo.client@wmeng.co.za → sees 1 project (Centurion),
--     0 snags (Centurion has none in seed), 0 sites, 1 diary entry,
--     0 orders.
-- ---------------------------------------------------------------------------
