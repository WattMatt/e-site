-- ---------------------------------------------------------------------------
-- 00166_client_viewer_node_order_read_block.sql
--
-- SECURITY (confirmed live leak): a project-scoped client_viewer could read
-- COMMERCIAL procurement artefacts directly via their own JWT + the public
-- anon key — verified in production against KINGSWALK with a probe client:
--   * structure.node_orders               → whole row incl. `notes` (HTTP 206)
--   * structure.node_order_documents      → quote / order-instruction metadata
--                                           + storage paths (HTTP 206)
--   * structure.node_order_shop_drawings  → drawing metadata + storage paths
--   * storage.objects (node-order-documents bucket) → the quote PDF itself
--                                           downloaded (HTTP 200, 256 KB)
--
-- Root cause
-- ----------
--   * node_orders_select_client_viewer (00083) granted client_viewer the WHOLE
--     node_orders row (RLS is row-level, not column-level) — including `notes`.
--   * node_order_documents_select (00086) / node_order_shop_drawings_select
--     (00115) / the "node-order-documents read" storage policy (00086) each
--     authorise with a BARE public.user_has_project_access(...) — no
--     client_viewer exclusion. A portal-eligible client_viewer holds an active
--     project_members row, so user_has_project_access() (00106 clause a) is TRUE
--     and every read passes.
--
-- Fix
-- ---
-- The client-facing Equipment & Materials portal tab now reads this data via
-- the SERVICE role behind requirePortalAccess, with an explicit column
-- allow-list that never selects notes/documents/drawings
-- (apps/web/src/lib/portal/data.ts:getPortalEquipmentMaterials). So the client
-- JWT needs ZERO direct access to these surfaces:
--   1. DROP node_orders_select_client_viewer  → client JWT reads no node_orders.
--   2. Re-guard the documents / drawings / storage SELECT policies to exclude
--      any EFFECTIVE client_viewer.
--
-- Why user_effective_project_role (not user_is_client_viewer)
-- ----------------------------------------------------------
-- user_is_client_viewer(org) only catches a client whose role in THAT org is
-- client_viewer. It misses a cross-org (sub-org identity) client whose
-- project_members.role='client_viewer' but who is not a member of the project's
-- owning org. user_effective_project_role(project_id) resolves the true
-- per-project role (org-admin auto-win, else the project_members row — 00107),
-- catching every client. It is SECURITY DEFINER, granted to authenticated, and
-- already used by production RLS (valuations / variations / boq policies).
--
-- NOT touched: SELECT policies for non-client roles (node_orders_select_members
-- already excludes client_viewer) and all write policies (owner/admin/PM only).
-- Because `IS DISTINCT FROM 'client_viewer'` is TRUE for every non-client
-- effective role, this migration cannot change behaviour for any staff role.
-- ---------------------------------------------------------------------------

-- 1. node_orders — clients read this only via the service-role portal now.
DROP POLICY IF EXISTS node_orders_select_client_viewer ON structure.node_orders;

-- 2. node_order_documents — exclude effective client_viewers.
DROP POLICY IF EXISTS node_order_documents_select ON structure.node_order_documents;
CREATE POLICY node_order_documents_select ON structure.node_order_documents
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(structure.node_order_project_id(node_order_id))
    AND public.user_effective_project_role(structure.node_order_project_id(node_order_id))
        IS DISTINCT FROM 'client_viewer'
  );

-- 3. node_order_shop_drawings — exclude effective client_viewers.
DROP POLICY IF EXISTS node_order_shop_drawings_select ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_select ON structure.node_order_shop_drawings
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(structure.node_order_project_id(node_order_id))
    AND public.user_effective_project_role(structure.node_order_project_id(node_order_id))
        IS DISTINCT FROM 'client_viewer'
  );

-- 4. storage.objects (node-order-documents bucket) — block the file download.
--    structure.tenant_doc_project_id(name) extracts foldername[1] as the
--    project uuid (path-generic despite the name; reused by 00086).
DROP POLICY IF EXISTS "node-order-documents read" ON storage.objects;
CREATE POLICY "node-order-documents read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'node-order-documents'
    AND public.user_has_project_access(structure.tenant_doc_project_id(name))
    AND public.user_effective_project_role(structure.tenant_doc_project_id(name))
        IS DISTINCT FROM 'client_viewer'
  );
