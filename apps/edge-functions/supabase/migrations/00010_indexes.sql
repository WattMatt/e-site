-- =============================================================================
-- Migration: 00010_indexes.sql
-- Description: Performance indexes across all schemas.
--              Every table with organisation_id gets an index (critical for RLS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_user_organisations_user    ON public.user_organisations(user_id);
CREATE INDEX idx_user_organisations_org     ON public.user_organisations(organisation_id);
CREATE INDEX idx_user_organisations_active  ON public.user_organisations(user_id, organisation_id) WHERE is_active = TRUE;
CREATE INDEX idx_notifications_user         ON public.notifications(user_id, is_read);
CREATE INDEX idx_notifications_org          ON public.notifications(organisation_id);
CREATE INDEX idx_audit_log_entity           ON public.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_org              ON public.audit_log(organisation_id);
CREATE INDEX idx_attachments_entity         ON public.attachments(entity_type, entity_id);
CREATE INDEX idx_attachments_org            ON public.attachments(organisation_id);
CREATE INDEX idx_push_tokens_user           ON public.push_tokens(user_id);

-- ---------------------------------------------------------------------------
-- projects schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_projects_org               ON projects.projects(organisation_id);
CREATE INDEX idx_projects_status            ON projects.projects(status);
CREATE INDEX idx_project_members_project    ON projects.project_members(project_id);
CREATE INDEX idx_project_members_user       ON projects.project_members(user_id);
CREATE INDEX idx_rfis_project               ON projects.rfis(project_id);
CREATE INDEX idx_rfis_org                   ON projects.rfis(organisation_id);
CREATE INDEX idx_rfis_status                ON projects.rfis(status);
CREATE INDEX idx_procurement_project        ON projects.procurement_items(project_id);
CREATE INDEX idx_procurement_org            ON projects.procurement_items(organisation_id);
CREATE INDEX idx_diary_project              ON projects.site_diary_entries(project_id);
CREATE INDEX idx_diary_date                 ON projects.site_diary_entries(entry_date);

-- ---------------------------------------------------------------------------
-- compliance schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_sites_org                  ON compliance.sites(organisation_id);
CREATE INDEX idx_subsections_org            ON compliance.subsections(organisation_id);
CREATE INDEX idx_subsections_site           ON compliance.subsections(site_id);
CREATE INDEX idx_coc_uploads_subsection     ON compliance.coc_uploads(subsection_id);
CREATE INDEX idx_coc_uploads_org            ON compliance.coc_uploads(organisation_id);
CREATE INDEX idx_coc_uploads_status         ON compliance.coc_uploads(status);

-- ---------------------------------------------------------------------------
-- field schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_snags_project              ON field.snags(project_id);
CREATE INDEX idx_snags_org                  ON field.snags(organisation_id);
CREATE INDEX idx_snags_status               ON field.snags(status);
CREATE INDEX idx_snags_assigned             ON field.snags(assigned_to);
CREATE INDEX idx_snags_raised               ON field.snags(raised_by);

-- Composite for dashboard queries: open snags per project
CREATE INDEX idx_open_snags                 ON field.snags(project_id, status)
    WHERE status IN ('open', 'in_progress', 'pending_sign_off');

CREATE INDEX idx_snag_photos_snag           ON field.snag_photos(snag_id);
CREATE INDEX idx_cables_project             ON field.cables(project_id);

-- ---------------------------------------------------------------------------
-- suppliers + marketplace schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_catalogue_supplier         ON marketplace.catalogue_items(supplier_id);
CREATE INDEX idx_catalogue_category         ON marketplace.catalogue_items(category);
CREATE INDEX idx_catalogue_visible          ON marketplace.catalogue_items(marketplace_visible)
    WHERE is_active = TRUE;
CREATE INDEX idx_orders_contractor          ON marketplace.orders(contractor_org_id);
CREATE INDEX idx_orders_supplier            ON marketplace.orders(supplier_org_id);
CREATE INDEX idx_orders_status              ON marketplace.orders(status);
CREATE INDEX idx_order_items_order          ON marketplace.order_items(order_id);

-- ---------------------------------------------------------------------------
-- billing schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_subscriptions_org          ON billing.subscriptions(organisation_id);
CREATE INDEX idx_invoices_org               ON billing.invoices(organisation_id);

-- ---------------------------------------------------------------------------
-- tenants schema
-- ---------------------------------------------------------------------------
CREATE INDEX idx_floor_plans_org            ON tenants.floor_plans(organisation_id);
CREATE INDEX idx_floor_plans_project        ON tenants.floor_plans(project_id);
