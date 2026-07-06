-- ---------------------------------------------------------------------------
-- 00161_client_viewer_readonly_write_block.sql
--
-- SECURITY (defense-in-depth / authz gap): make `client_viewer` read-only at
-- the DATABASE layer, matching the web-UI restriction.
--
-- Root cause
-- ----------
-- Write policies on org-scoped tables authorise by ORG MEMBERSHIP alone
-- (`organisation_id = ANY(public.get_user_org_ids())`). A client_viewer IS an
-- active org member, so those checks pass. Verified in production: a
-- client_viewer created a `field.snags` row via the REST API (HTTP 201). The
-- offending policy is even mislabelled "Contractors and above can create snags"
-- (00032) yet performs no role check.
--
-- Why RESTRICTIVE (not editing each permissive policy)
-- ----------------------------------------------------
-- PostgreSQL OR-combines PERMISSIVE policies: guarding one permissive write
-- policy does nothing if another (present or future) permissive policy also
-- grants the write. A RESTRICTIVE policy is AND-combined, so it blocks the
-- write regardless of how many permissive policies exist now or later. This
-- codebase already uses this pattern to fence out client_viewer
-- (00040 org_storage_connections, 00066 templates_block_client_viewer,
-- 00148 cloud_sync_runs).
--
-- Scope: TABLE write surfaces only. Restrictive policies here are scoped to
-- INSERT / UPDATE / DELETE — SELECT is deliberately left untouched so
-- client_viewer keeps its (already project-scoped, per 00034) read access.
-- Because `NOT public.user_is_client_viewer(org)` is TRUE for every non-viewer,
-- this migration cannot change behaviour for any non-viewer role.
--
-- NOT covered here (deliberately):
--   * storage.objects bucket write policies (rfi-/diary-/project-documents/
--     snag-photos/report-logos/reports/jbcc-letters/drawings) — a parallel gap,
--     handled as a fast-follow.
--   * suppliers.suppliers INSERT "Org admins can insert suppliers" has
--     WITH CHECK (TRUE) — a SEPARATE over-permissive bug (open to any
--     authenticated user, not client_viewer-specific). Tracked separately.
--   * compliance.* — the schema was dropped by 00066 (DROP SCHEMA CASCADE);
--     the coc_uploads/sites/subsections tables named in early reports no longer
--     exist.
--   * Already-guarded surfaces (unchanged): diary (00145/00149), inspections.*
--     (helper checks role <> 'client_viewer'), cable_schedule.*, engineer
--     schedule, GRN, shop drawings, node docs, gcr.report_revisions,
--     org_storage_connections, and every policy using role IN (...) /
--     user_can_manage_project / user_effective_project_role.
--
-- Helper: public.user_is_client_viewer(org_id) — SECURITY DEFINER, STABLE,
-- true iff the caller is a client_viewer in that org (00034).
-- ---------------------------------------------------------------------------

-- ── Group A: tables with a direct organisation-id column ───────────────────
-- Identical policy logic is generated per table so the block cannot diverge
-- by copy-paste. The VALUES list below IS the reviewable coverage surface.
DO $mig$
DECLARE
    t   RECORD;
    org TEXT;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
            ('field',       'snags',             'organisation_id'),
            ('field',       'snag_visits',       'organisation_id'),
            ('projects',    'rfis',              'organisation_id'),
            ('projects',    'drawings',          'organisation_id'),
            ('projects',    'project_members',   'organisation_id'),
            ('public',      'attachments',       'organisation_id'),
            ('public',      'rfi_annotations',   'organisation_id'),
            ('tenants',     'floor_plans',       'organisation_id'),
            ('gcr',         'settings',          'organisation_id'),
            ('gcr',         'zones',             'organisation_id'),
            ('gcr',         'zone_generators',   'organisation_id'),
            ('gcr',         'tenant_assignments','organisation_id'),
            ('marketplace', 'catalogue_items',   'supplier_org_id')
        ) AS v(schema_name, table_name, org_col)
    LOOP
        org := quote_ident(t.org_col);

        EXECUTE format(
            'DROP POLICY IF EXISTS "client_viewer_no_insert" ON %I.%I',
            t.schema_name, t.table_name);
        EXECUTE format(
            'DROP POLICY IF EXISTS "client_viewer_no_update" ON %I.%I',
            t.schema_name, t.table_name);
        EXECUTE format(
            'DROP POLICY IF EXISTS "client_viewer_no_delete" ON %I.%I',
            t.schema_name, t.table_name);

        EXECUTE format(
            'CREATE POLICY "client_viewer_no_insert" ON %I.%I '
            'AS RESTRICTIVE FOR INSERT TO authenticated '
            'WITH CHECK (NOT public.user_is_client_viewer(%s))',
            t.schema_name, t.table_name, org);

        EXECUTE format(
            'CREATE POLICY "client_viewer_no_update" ON %I.%I '
            'AS RESTRICTIVE FOR UPDATE TO authenticated '
            'USING (NOT public.user_is_client_viewer(%s)) '
            'WITH CHECK (NOT public.user_is_client_viewer(%s))',
            t.schema_name, t.table_name, org, org);

        EXECUTE format(
            'CREATE POLICY "client_viewer_no_delete" ON %I.%I '
            'AS RESTRICTIVE FOR DELETE TO authenticated '
            'USING (NOT public.user_is_client_viewer(%s))',
            t.schema_name, t.table_name, org);
    END LOOP;
END
$mig$;

-- ── Group B: child tables — org resolved through the parent row ────────────

-- field.snag_photos → field.snags.organisation_id (via snag_id)
DROP POLICY IF EXISTS "client_viewer_no_insert" ON field.snag_photos;
DROP POLICY IF EXISTS "client_viewer_no_update" ON field.snag_photos;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON field.snag_photos;

CREATE POLICY "client_viewer_no_insert" ON field.snag_photos
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM field.snags WHERE id = snag_id)));
CREATE POLICY "client_viewer_no_update" ON field.snag_photos
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM field.snags WHERE id = snag_id)))
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM field.snags WHERE id = snag_id)));
CREATE POLICY "client_viewer_no_delete" ON field.snag_photos
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM field.snags WHERE id = snag_id)));

-- projects.rfi_responses → projects.rfis.organisation_id (via rfi_id)
DROP POLICY IF EXISTS "client_viewer_no_insert" ON projects.rfi_responses;
DROP POLICY IF EXISTS "client_viewer_no_update" ON projects.rfi_responses;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON projects.rfi_responses;

CREATE POLICY "client_viewer_no_insert" ON projects.rfi_responses
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.rfis WHERE id = rfi_id)));
CREATE POLICY "client_viewer_no_update" ON projects.rfi_responses
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.rfis WHERE id = rfi_id)))
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.rfis WHERE id = rfi_id)));
CREATE POLICY "client_viewer_no_delete" ON projects.rfi_responses
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.rfis WHERE id = rfi_id)));

-- projects.site_diary_attachments → projects.site_diary_entries.organisation_id
-- (INSERT/UPDATE were guarded by 00145; the DELETE policy was missed — cover
--  all three here for completeness.)
DROP POLICY IF EXISTS "client_viewer_no_insert" ON projects.site_diary_attachments;
DROP POLICY IF EXISTS "client_viewer_no_update" ON projects.site_diary_attachments;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON projects.site_diary_attachments;

CREATE POLICY "client_viewer_no_insert" ON projects.site_diary_attachments
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.site_diary_entries WHERE id = diary_entry_id)));
CREATE POLICY "client_viewer_no_update" ON projects.site_diary_attachments
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.site_diary_entries WHERE id = diary_entry_id)))
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.site_diary_entries WHERE id = diary_entry_id)));
CREATE POLICY "client_viewer_no_delete" ON projects.site_diary_attachments
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT organisation_id FROM projects.site_diary_entries WHERE id = diary_entry_id)));

-- ── Group C: marketplace — orders carry two org columns; order_items via order
-- A client_viewer is a member of exactly one side; NOT user_is_client_viewer()
-- is TRUE for any org the caller is not a viewer in (and for NULL org columns),
-- so writes are blocked only for the viewer's own side.
DROP POLICY IF EXISTS "client_viewer_no_insert" ON marketplace.orders;
DROP POLICY IF EXISTS "client_viewer_no_update" ON marketplace.orders;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON marketplace.orders;

CREATE POLICY "client_viewer_no_insert" ON marketplace.orders
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(contractor_org_id));
CREATE POLICY "client_viewer_no_update" ON marketplace.orders
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(contractor_org_id)
       AND NOT public.user_is_client_viewer(supplier_org_id))
    WITH CHECK (NOT public.user_is_client_viewer(contractor_org_id)
       AND NOT public.user_is_client_viewer(supplier_org_id));
CREATE POLICY "client_viewer_no_delete" ON marketplace.orders
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(contractor_org_id)
       AND NOT public.user_is_client_viewer(supplier_org_id));

-- marketplace.order_items → marketplace.orders.contractor_org_id (via order_id)
DROP POLICY IF EXISTS "client_viewer_no_insert" ON marketplace.order_items;
DROP POLICY IF EXISTS "client_viewer_no_update" ON marketplace.order_items;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON marketplace.order_items;

CREATE POLICY "client_viewer_no_insert" ON marketplace.order_items
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT contractor_org_id FROM marketplace.orders WHERE id = order_id)));
CREATE POLICY "client_viewer_no_update" ON marketplace.order_items
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT contractor_org_id FROM marketplace.orders WHERE id = order_id)))
    WITH CHECK (NOT public.user_is_client_viewer(
        (SELECT contractor_org_id FROM marketplace.orders WHERE id = order_id)));
CREATE POLICY "client_viewer_no_delete" ON marketplace.order_items
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(
        (SELECT contractor_org_id FROM marketplace.orders WHERE id = order_id)));
