-- =============================================================================
-- Migration: 00009_rls_policies.sql
-- Description: All Row Level Security policies across all schemas.
--              Relies on public.get_user_org_ids() from 00001.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.organisations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organisations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens          ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.drawings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.rfis               ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.rfi_responses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.procurement_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.site_diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.handover_checklist ENABLE ROW LEVEL SECURITY;

ALTER TABLE compliance.sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.project_sites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.subsections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.coc_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.qr_codes         ENABLE ROW LEVEL SECURITY;

ALTER TABLE field.snags                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.snag_photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.cables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.inspection_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.inspection_requests   ENABLE ROW LEVEL SECURITY;

ALTER TABLE suppliers.suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers.organisation_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers.supplier_contacts     ENABLE ROW LEVEL SECURITY;

ALTER TABLE marketplace.catalogue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.order_items     ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenants.floor_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.floor_plan_zones    ENABLE ROW LEVEL SECURITY;

ALTER TABLE billing.subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.usage_records       ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- public schema policies
-- ---------------------------------------------------------------------------

-- organisations: members can see their own orgs
CREATE POLICY "Members can view their organisations"
    ON public.organisations FOR SELECT
    USING (id = ANY(public.get_user_org_ids()));

CREATE POLICY "Owners can update their organisation"
    ON public.organisations FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.user_organisations
            WHERE organisation_id = id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
            AND is_active = TRUE
        )
    );

-- profiles: users see own profile; org members see each other
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can view org member profiles"
    ON public.profiles FOR SELECT
    USING (
        id IN (
            SELECT uo.user_id FROM public.user_organisations uo
            WHERE uo.organisation_id = ANY(public.get_user_org_ids())
            AND uo.is_active = TRUE
        )
    );

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid());

-- user_organisations: see memberships in own orgs
CREATE POLICY "Users can view memberships in their orgs"
    ON public.user_organisations FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Users can see their own membership"
    ON public.user_organisations FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage org memberships"
    ON public.user_organisations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_organisations uo
            WHERE uo.organisation_id = user_organisations.organisation_id
            AND uo.user_id = auth.uid()
            AND uo.role IN ('owner', 'admin')
            AND uo.is_active = TRUE
        )
    );

-- notifications: users see their own
CREATE POLICY "Users see their own notifications"
    ON public.notifications FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can mark their notifications read"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid());

-- attachments: org-scoped
CREATE POLICY "Org members can view attachments"
    ON public.attachments FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can upload attachments"
    ON public.attachments FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

-- push_tokens: own only
CREATE POLICY "Users manage their own push tokens"
    ON public.push_tokens FOR ALL
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- projects schema policies (standard org-scope pattern)
-- ---------------------------------------------------------------------------

CREATE POLICY "Org members can view projects"
    ON projects.projects FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "PMs and above can manage projects"
    ON projects.projects FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_organisations uo
            WHERE uo.organisation_id = projects.projects.organisation_id
            AND uo.user_id = auth.uid()
            AND uo.role IN ('owner', 'admin', 'project_manager')
            AND uo.is_active = TRUE
        )
    );

-- project_members: scoped to org
CREATE POLICY "Org members can view project members"
    ON projects.project_members FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- drawings, rfis, procurement, diary — all org-scoped SELECT, PMs+ for writes
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'projects.drawings',
        'projects.rfis',
        'projects.rfi_responses',
        'projects.procurement_items',
        'projects.site_diary_entries',
        'projects.contacts',
        'projects.handover_checklist'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY "Org members can view %1$s" ON %1$s FOR SELECT
             USING (organisation_id = ANY(public.get_user_org_ids()))',
            tbl
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- compliance schema policies
-- ---------------------------------------------------------------------------

CREATE POLICY "Org members can view sites"
    ON compliance.sites FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can manage sites"
    ON compliance.sites FOR ALL
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view subsections"
    ON compliance.subsections FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can manage subsections"
    ON compliance.subsections FOR ALL
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view COC uploads"
    ON compliance.coc_uploads FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can upload COCs"
    ON compliance.coc_uploads FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- field schema policies
-- ---------------------------------------------------------------------------

CREATE POLICY "Org members can view snags"
    ON field.snags FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Contractors and above can create snags"
    ON field.snags FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can update snags"
    ON field.snags FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view snag photos"
    ON field.snag_photos FOR SELECT
    USING (
        snag_id IN (
            SELECT id FROM field.snags
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

CREATE POLICY "Org members can view cables"
    ON field.cables FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view inspection milestones"
    ON field.inspection_milestones FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view inspection requests"
    ON field.inspection_requests FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- marketplace policies (dual-org: contractor AND supplier)
-- ---------------------------------------------------------------------------

CREATE POLICY "Linked contractors can see supplier catalogue items"
    ON marketplace.catalogue_items FOR SELECT
    USING (
        marketplace_visible = TRUE AND is_active = TRUE
        OR supplier_org_id = ANY(public.get_user_org_ids())
        OR EXISTS (
            SELECT 1 FROM suppliers.organisation_suppliers os
            WHERE os.supplier_id = marketplace.catalogue_items.supplier_id
            AND os.contractor_org_id = ANY(public.get_user_org_ids())
        )
    );

CREATE POLICY "Suppliers can manage their own catalogue"
    ON marketplace.catalogue_items FOR ALL
    USING (supplier_org_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Contractors can view their orders"
    ON marketplace.orders FOR SELECT
    USING (contractor_org_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Suppliers can view orders placed with them"
    ON marketplace.orders FOR SELECT
    USING (supplier_org_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Contractors can create orders"
    ON marketplace.orders FOR INSERT
    WITH CHECK (contractor_org_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Contractors and suppliers can update orders"
    ON marketplace.orders FOR UPDATE
    USING (
        contractor_org_id = ANY(public.get_user_org_ids())
        OR supplier_org_id = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Order parties can view order items"
    ON marketplace.order_items FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM marketplace.orders
            WHERE contractor_org_id = ANY(public.get_user_org_ids())
               OR supplier_org_id = ANY(public.get_user_org_ids())
        )
    );

-- ---------------------------------------------------------------------------
-- tenants schema policies
-- ---------------------------------------------------------------------------

CREATE POLICY "Org members can view floor plans"
    ON tenants.floor_plans FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can manage floor plans"
    ON tenants.floor_plans FOR ALL
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can view floor plan zones"
    ON tenants.floor_plan_zones FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- billing policies (own org only)
-- ---------------------------------------------------------------------------

CREATE POLICY "Org admins can view subscription"
    ON billing.subscriptions FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org admins can view invoices"
    ON billing.invoices FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- suppliers policies
-- ---------------------------------------------------------------------------

CREATE POLICY "Anyone can view active suppliers"
    ON suppliers.suppliers FOR SELECT
    USING (is_active = TRUE);

CREATE POLICY "Linked orgs can view their supplier relationships"
    ON suppliers.organisation_suppliers FOR SELECT
    USING (contractor_org_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Linked orgs can view supplier contacts"
    ON suppliers.supplier_contacts FOR SELECT
    USING (
        supplier_id IN (
            SELECT supplier_id FROM suppliers.organisation_suppliers
            WHERE contractor_org_id = ANY(public.get_user_org_ids())
        )
    );
