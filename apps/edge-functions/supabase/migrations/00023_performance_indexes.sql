-- ---------------------------------------------------------------------------
-- Migration 00023: Performance indexes
-- Sprint 6, T-057
--
-- Adds indexes for the most common query patterns identified during
-- dashboard and list view implementation. Covers all major table scans.
-- ---------------------------------------------------------------------------

-- ─── public schema ──────────────────────────────────────────────────────────

-- user_organisations: fast org lookup for a user
CREATE INDEX IF NOT EXISTS idx_user_orgs_user_active
    ON public.user_organisations (user_id, is_active)
    WHERE is_active = TRUE;

-- user_organisations: fast member list for an org
CREATE INDEX IF NOT EXISTS idx_user_orgs_org_active
    ON public.user_organisations (organisation_id, is_active)
    WHERE is_active = TRUE;

-- notifications: unread count (used in header badge)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id, created_at DESC)
    WHERE is_read = FALSE;

-- ─── projects schema ────────────────────────────────────────────────────────

-- projects: org active projects (dashboard KPI + list)
CREATE INDEX IF NOT EXISTS idx_projects_org_status
    ON projects.projects (organisation_id, status, created_at DESC);

-- projects: end_date for deadline panel
CREATE INDEX IF NOT EXISTS idx_projects_org_end_date
    ON projects.projects (organisation_id, end_date ASC)
    WHERE end_date IS NOT NULL AND status = 'active';

-- project_members: find projects for a user
CREATE INDEX IF NOT EXISTS idx_project_members_user
    ON projects.project_members (user_id, project_id)
    WHERE is_active = TRUE;

-- site_diary_entries: org + date range (cross-project diary view)
CREATE INDEX IF NOT EXISTS idx_diary_org_date
    ON projects.site_diary_entries (organisation_id, date DESC);

-- site_diary_entries: org + entry_type filter
CREATE INDEX IF NOT EXISTS idx_diary_org_type
    ON projects.site_diary_entries (organisation_id, entry_type, date DESC)
    WHERE entry_type IS NOT NULL;

-- procurement_items: org + status (procurement list)
CREATE INDEX IF NOT EXISTS idx_procurement_org_status
    ON projects.procurement_items (organisation_id, status, created_at DESC);

-- ─── field schema ───────────────────────────────────────────────────────────

-- snags: org + status (KPI cards count)
CREATE INDEX IF NOT EXISTS idx_snags_org_status
    ON field.snags (organisation_id, status, created_at DESC);

-- snags: project + status (project detail page)
CREATE INDEX IF NOT EXISTS idx_snags_project_status
    ON field.snags (project_id, status, priority, created_at DESC);

-- snags: assigned_to (my snags view)
CREATE INDEX IF NOT EXISTS idx_snags_assigned_to
    ON field.snags (assigned_to, status, created_at DESC)
    WHERE assigned_to IS NOT NULL;

-- snag_photos: snag lookup
CREATE INDEX IF NOT EXISTS idx_snag_photos_snag
    ON field.snag_photos (snag_id, sort_order);

-- ─── compliance schema ──────────────────────────────────────────────────────

-- sites: org + status
CREATE INDEX IF NOT EXISTS idx_compliance_sites_org_status
    ON compliance.sites (organisation_id, status, created_at DESC);

-- subsections: site + coc_status (compliance score)
CREATE INDEX IF NOT EXISTS idx_subsections_site_status
    ON compliance.subsections (site_id, coc_status, sort_order);

-- subsections: org + coc_status (portfolio health KPI)
CREATE INDEX IF NOT EXISTS idx_subsections_org_status
    ON compliance.subsections (organisation_id, coc_status);

-- coc_uploads: subsection + status (latest upload)
CREATE INDEX IF NOT EXISTS idx_coc_uploads_subsection_status
    ON compliance.coc_uploads (subsection_id, status, created_at DESC);

-- coc_uploads: reviewer queue (admin review)
CREATE INDEX IF NOT EXISTS idx_coc_uploads_review_queue
    ON compliance.coc_uploads (status, created_at DESC)
    WHERE status IN ('submitted', 'under_review');

-- ─── marketplace schema ─────────────────────────────────────────────────────

-- orders: contractor org + status (my orders list)
CREATE INDEX IF NOT EXISTS idx_orders_contractor_status
    ON marketplace.orders (contractor_org_id, status, created_at DESC);

-- orders: supplier org + status (supplier order list)
CREATE INDEX IF NOT EXISTS idx_orders_supplier_status
    ON marketplace.orders (supplier_org_id, status, created_at DESC);

-- catalogue_items: supplier + visible (browse catalogue)
CREATE INDEX IF NOT EXISTS idx_catalogue_supplier_visible
    ON marketplace.catalogue_items (supplier_id, is_active, marketplace_visible, category);

-- supplier_ratings: supplier aggregation
CREATE INDEX IF NOT EXISTS idx_ratings_supplier
    ON marketplace.supplier_ratings (supplier_id, created_at DESC);

-- ─── suppliers schema ───────────────────────────────────────────────────────

-- suppliers: active + category browse (marketplace filter)
CREATE INDEX IF NOT EXISTS idx_suppliers_active_categories
    ON suppliers.suppliers USING GIN (categories)
    WHERE is_active = TRUE;

-- suppliers: text search by name (partial ilike support)
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
    ON suppliers.suppliers USING GIN (name gin_trgm_ops)
    WHERE is_active = TRUE;

-- ─── billing schema ─────────────────────────────────────────────────────────

-- subscriptions: org lookup (header tier check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org
    ON billing.subscriptions (organisation_id);

-- invoices: org + date
CREATE INDEX IF NOT EXISTS idx_invoices_org_date
    ON billing.invoices (organisation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ANALYSE all updated tables to refresh planner statistics
-- ---------------------------------------------------------------------------
ANALYZE public.user_organisations;
ANALYZE public.notifications;
ANALYZE projects.projects;
ANALYZE projects.site_diary_entries;
ANALYZE field.snags;
ANALYZE field.snag_photos;
ANALYZE compliance.sites;
ANALYZE compliance.subsections;
ANALYZE compliance.coc_uploads;
ANALYZE marketplace.orders;
ANALYZE marketplace.catalogue_items;
ANALYZE suppliers.suppliers;
ANALYZE billing.subscriptions;
