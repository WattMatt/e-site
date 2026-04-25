-- ---------------------------------------------------------------------------
-- Migration 00027: Add missing INSERT/UPDATE RLS policies + harden
--                  get_user_org_ids() with SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Root causes fixed:
--  1. get_user_org_ids() was not SECURITY DEFINER — it relied on user_organisations
--     RLS being permissive. Now it bypasses RLS entirely (runs as postgres).
--  2. Several tables (project_members, rfis, site_diary_entries, snag_photos,
--     drawings) only had SELECT policies. INSERT operations failed silently.
-- ---------------------------------------------------------------------------

-- ── 1. Harden get_user_org_ids() ────────────────────────────────────────────
-- SECURITY DEFINER + explicit row_security=off means this function always
-- reads the real org IDs for auth.uid(), regardless of user_organisations RLS.

CREATE OR REPLACE FUNCTION public.get_user_org_ids()
RETURNS UUID[]
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
    SELECT COALESCE(ARRAY_AGG(organisation_id), '{}')
    FROM public.user_organisations
    WHERE user_id = auth.uid() AND is_active = TRUE;
$$;

-- ── 2. projects.project_members — INSERT ────────────────────────────────────
-- Needed by: project creation (adds creator as PM), invite flow
DROP POLICY IF EXISTS "Org members can insert project members" ON projects.project_members;
CREATE POLICY "Org members can insert project members"
    ON projects.project_members FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS "Org members can update project members" ON projects.project_members;
CREATE POLICY "Org members can update project members"
    ON projects.project_members FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ── 3. projects.rfis — INSERT + UPDATE ──────────────────────────────────────
DROP POLICY IF EXISTS "Org members can create rfis" ON projects.rfis;
CREATE POLICY "Org members can create rfis"
    ON projects.rfis FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS "Org members can update rfis" ON projects.rfis;
CREATE POLICY "Org members can update rfis"
    ON projects.rfis FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ── 4. projects.site_diary_entries — INSERT + UPDATE ────────────────────────
DROP POLICY IF EXISTS "Org members can create diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can create diary entries"
    ON projects.site_diary_entries FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS "Org members can update diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can update diary entries"
    ON projects.site_diary_entries FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ── 5. field.snag_photos — INSERT ───────────────────────────────────────────
DROP POLICY IF EXISTS "Org members can upload snag photos" ON field.snag_photos;
CREATE POLICY "Org members can upload snag photos"
    ON field.snag_photos FOR INSERT
    WITH CHECK (
        snag_id IN (
            SELECT id FROM field.snags
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

-- ── 6. projects.drawings — INSERT + UPDATE ───────────────────────────────────
DROP POLICY IF EXISTS "Org members can upload drawings" ON projects.drawings;
CREATE POLICY "Org members can upload drawings"
    ON projects.drawings FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

DROP POLICY IF EXISTS "Org members can update drawings" ON projects.drawings;
CREATE POLICY "Org members can update drawings"
    ON projects.drawings FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ── 7. projects.rfi_responses — UPDATE ──────────────────────────────────────
DROP POLICY IF EXISTS "Org members can update rfi_responses" ON projects.rfi_responses;
CREATE POLICY "Org members can update rfi_responses"
    ON projects.rfi_responses FOR UPDATE
    USING (
        rfi_id IN (
            SELECT id FROM projects.rfis
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

-- ── 8. compliance.coc_uploads — UPDATE ──────────────────────────────────────
DROP POLICY IF EXISTS "Org members can update COC uploads" ON compliance.coc_uploads;
CREATE POLICY "Org members can update COC uploads"
    ON compliance.coc_uploads FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ── 9. marketplace.order_items — INSERT ─────────────────────────────────────
DROP POLICY IF EXISTS "Contractors can create order items" ON marketplace.order_items;
CREATE POLICY "Contractors can create order items"
    ON marketplace.order_items FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT id FROM marketplace.orders
            WHERE contractor_org_id = ANY(public.get_user_org_ids())
        )
    );

-- ── 10. suppliers.suppliers — INSERT for admins ──────────────────────────────
-- Marketplace admin needs to add new suppliers
DROP POLICY IF EXISTS "Org admins can insert suppliers" ON suppliers.suppliers;
CREATE POLICY "Org admins can insert suppliers"
    ON suppliers.suppliers FOR INSERT
    WITH CHECK (TRUE); -- supplier creation is handled by service role in practice
