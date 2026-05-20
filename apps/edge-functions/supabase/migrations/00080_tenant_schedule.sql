-- =============================================================================
-- Migration 00080 — tenant schedule tables + scope registry + storage bucket
-- =============================================================================
-- Background:
--   Adds the database layer for the Tenant Schedule module. Three new tables
--   in the existing `structure` schema (created in 00074):
--
--     structure.scope_item_types  — org-level registry of scope items (db,
--                                   lighting, …); user-extensible via UI.
--     structure.tenant_details    — 1:1 with tenant_db nodes; holds mutable
--                                   workflow state (scope status, layout
--                                   status, storage paths for documents).
--     structure.tenant_scope_items — per-tenant per-item Landlord vs Tenant
--                                   split; one row per (node, scope_item_type).
--
--   Also creates the `tenant-documents` Supabase Storage bucket (no app-imposed
--   size cap) with SELECT, INSERT, and DELETE policies on storage.objects.
--
-- RLS: mirrors 00075 (structure.nodes) — org membership + project access gate;
--      client_viewer SELECT-only; owner/admin/project_manager write access.
--      DELETE policies included on all tables (a missing DELETE policy silently
--      no-ops; see Session 32 post-mortem).
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. structure.scope_item_types
--    Org-level registry of scope-of-work items. Seeded with 'db' and
--    'lighting'. Users extend it via the "add" button in the UI.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE structure.scope_item_types (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,

    key             TEXT        NOT NULL,          -- slug, e.g. 'db', 'lighting'
    label           TEXT        NOT NULL,          -- display name, e.g. 'DB', 'Lighting'
    sort_order      INTEGER     NOT NULL DEFAULT 0, -- controls column ordering in UI

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organisation_id, key)
);

CREATE INDEX idx_scope_item_types_org
    ON structure.scope_item_types (organisation_id, sort_order);

CREATE TRIGGER scope_item_types_updated_at
    BEFORE UPDATE ON structure.scope_item_types
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. structure.tenant_details
--    1:1 with structure.nodes where kind = 'tenant_db'. Holds mutable
--    workflow state so the nodes table stays stable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE structure.tenant_details (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id                 UUID        NOT NULL UNIQUE REFERENCES structure.nodes(id) ON DELETE CASCADE,

    -- Scope of work (T2)
    scope_status            TEXT        NOT NULL DEFAULT 'awaited'
                            CHECK (scope_status IN ('awaited', 'received')),
    scope_document_path     TEXT,       -- storage path in tenant-documents bucket

    -- Layout issued (T1)
    layout_status           TEXT        NOT NULL DEFAULT 'not_issued'
                            CHECK (layout_status IN ('not_issued', 'issued')),
    layout_issued_at        DATE,       -- date the layout was issued
    layout_drawing_path     TEXT,       -- storage path in tenant-documents bucket

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tenant_details_updated_at
    BEFORE UPDATE ON structure.tenant_details
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. structure.tenant_scope_items
--    One row per (tenant node, scope item type). Records whether the item
--    is Landlord scope (WM executes, order raised) or Tenant scope (by tenant,
--    no WM order).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE structure.tenant_scope_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id             UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    scope_item_type_id  UUID        NOT NULL REFERENCES structure.scope_item_types(id) ON DELETE CASCADE,

    party               TEXT        NOT NULL CHECK (party IN ('landlord', 'tenant')),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (node_id, scope_item_type_id)
);

CREATE INDEX idx_tenant_scope_items_node
    ON structure.tenant_scope_items (node_id);

CREATE TRIGGER tenant_scope_items_updated_at
    BEFORE UPDATE ON structure.tenant_scope_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed scope_item_types — the two built-in item types ('db', 'lighting').
--    scope_item_types is org-scoped (organisation_id NOT NULL), so there is no
--    single global seed row — seed both built-ins for every EXISTING
--    organisation. ON CONFLICT keeps this idempotent.
--
--    Future organisations get these two types seeded by the application layer
--    (an idempotent ensure at tenant-schedule import / scope-UI time) — a
--    migration cannot seed organisations that do not exist yet.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO structure.scope_item_types (organisation_id, key, label, sort_order)
SELECT id, 'db', 'DB', 0
FROM   public.organisations
ON CONFLICT (organisation_id, key) DO NOTHING;

INSERT INTO structure.scope_item_types (organisation_id, key, label, sort_order)
SELECT id, 'lighting', 'Lighting', 1
FROM   public.organisations
ON CONFLICT (organisation_id, key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — scope_item_types
--    Org-level table; no project_id. Gate on org membership.
--    client_viewer: SELECT only. owner/admin/project_manager: full write.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.scope_item_types ENABLE ROW LEVEL SECURITY;

-- SELECT: org members (non-client_viewer) see their org's types.
CREATE POLICY scope_item_types_select_members ON structure.scope_item_types
  FOR SELECT TO authenticated
  USING (
    organisation_id = ANY(public.get_user_org_ids())
    AND NOT public.user_is_client_viewer(organisation_id)
  );

-- client_viewer: also allowed to read (needed to render scope columns in UI).
CREATE POLICY scope_item_types_select_client_viewer ON structure.scope_item_types
  FOR SELECT TO authenticated
  USING (
    public.user_is_client_viewer(organisation_id)
    AND organisation_id = ANY(public.get_user_org_ids())
  );

-- INSERT: owner/admin/project_manager only.
CREATE POLICY scope_item_types_insert ON structure.scope_item_types
  FOR INSERT TO authenticated
  WITH CHECK (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.scope_item_types.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- UPDATE: owner/admin/project_manager only.
CREATE POLICY scope_item_types_update ON structure.scope_item_types
  FOR UPDATE TO authenticated
  USING (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.scope_item_types.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- DELETE: owner/admin/project_manager only.
CREATE POLICY scope_item_types_delete ON structure.scope_item_types
  FOR DELETE TO authenticated
  USING (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.scope_item_types.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — tenant_details
--    Access is derived from the linked node's project. Join to nodes to get
--    project_id and organisation_id for the helper functions.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.tenant_details ENABLE ROW LEVEL SECURITY;

-- SELECT: org members with project access (non-client_viewer).
CREATE POLICY tenant_details_select_members ON structure.tenant_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_details.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

-- SELECT: client_viewer — project-scoped, read-only.
CREATE POLICY tenant_details_select_client_viewer ON structure.tenant_details
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_details.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

-- INSERT: owner/admin/project_manager with project access.
CREATE POLICY tenant_details_insert ON structure.tenant_details
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_details.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- UPDATE: owner/admin/project_manager with project access.
CREATE POLICY tenant_details_update ON structure.tenant_details
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_details.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- DELETE: owner/admin/project_manager with project access.
CREATE POLICY tenant_details_delete ON structure.tenant_details
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_details.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — tenant_scope_items
--    Same shape as tenant_details (join to nodes for project/org context).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.tenant_scope_items ENABLE ROW LEVEL SECURITY;

-- SELECT: org members with project access (non-client_viewer).
CREATE POLICY tenant_scope_items_select_members ON structure.tenant_scope_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_scope_items.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

-- SELECT: client_viewer — project-scoped, read-only.
CREATE POLICY tenant_scope_items_select_client_viewer ON structure.tenant_scope_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_scope_items.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

-- INSERT: owner/admin/project_manager with project access.
CREATE POLICY tenant_scope_items_insert ON structure.tenant_scope_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_scope_items.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- UPDATE: owner/admin/project_manager with project access.
CREATE POLICY tenant_scope_items_update ON structure.tenant_scope_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_scope_items.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- DELETE: owner/admin/project_manager with project access.
CREATE POLICY tenant_scope_items_delete ON structure.tenant_scope_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_scope_items.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Grants
--    Mirror 00075 — extend the existing structure schema grants to cover
--    the three new tables and future tables added to the schema.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON structure.scope_item_types  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON structure.tenant_details     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON structure.tenant_scope_items TO authenticated;

GRANT ALL ON structure.scope_item_types  TO service_role;
GRANT ALL ON structure.tenant_details    TO service_role;
GRANT ALL ON structure.tenant_scope_items TO service_role;

GRANT SELECT ON structure.scope_item_types  TO anon;
GRANT SELECT ON structure.tenant_details    TO anon;
GRANT SELECT ON structure.tenant_scope_items TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Storage bucket — tenant-documents
--    No app-imposed file-size limit (T1). Stores layout drawings and scope
--    documents. File path convention: {project_id}/{node_id}/{filename}
--    so storage.foldername(name)[1] = project_id.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-documents',
  'tenant-documents',
  FALSE,
  NULL,     -- no app-imposed size cap (T1 requirement)
  NULL      -- accept any MIME type (layout drawings can be PDF, DWG, DXF, etc.)
);

-- SELECT: org members with project access see their project's documents.
CREATE POLICY "tenant-documents read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND public.user_has_project_access((storage.foldername(name))[1]::UUID)
  );

-- INSERT: owner/admin/project_manager with project access.
CREATE POLICY "tenant-documents write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-documents'
    AND public.user_has_project_access((storage.foldername(name))[1]::UUID)
    AND EXISTS (
      SELECT 1 FROM projects.projects p
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = p.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE p.id = (storage.foldername(name))[1]::UUID
    )
  );

-- DELETE: same gate as INSERT.
CREATE POLICY "tenant-documents delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND public.user_has_project_access((storage.foldername(name))[1]::UUID)
    AND EXISTS (
      SELECT 1 FROM projects.projects p
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = p.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE p.id = (storage.foldername(name))[1]::UUID
    )
  );
