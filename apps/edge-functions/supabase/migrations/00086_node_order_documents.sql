-- =============================================================================
-- Migration 00086 — structure.node_order_documents + node-order-documents bucket
-- =============================================================================
-- Adds per-node-order document slots for the unified Material Order Tracker.
-- Each node order can carry up to three documents — a Quote, an Order
-- Instruction, and a Shop Drawing (one per slot; re-upload replaces).
--
-- Purely additive — does not touch node_orders or anything else. Safe to apply
-- to the shared database independently of the procurement teardown.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS throughout.
-- =============================================================================

-- ── 1. node_order_documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS structure.node_order_documents (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_order_id   UUID        NOT NULL REFERENCES structure.node_orders(id) ON DELETE CASCADE,
    doc_type        TEXT        NOT NULL CHECK (doc_type IN ('quote', 'order_instruction', 'shop_drawing')),
    storage_path    TEXT        NOT NULL,
    file_name       TEXT        NOT NULL,
    uploaded_by     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One document per slot per order; re-upload replaces. Non-partial → a
    -- usable on_conflict target.
    UNIQUE (node_order_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_node_order_documents_order
    ON structure.node_order_documents (node_order_id);

DROP TRIGGER IF EXISTS node_order_documents_updated_at ON structure.node_order_documents;
CREATE TRIGGER node_order_documents_updated_at
    BEFORE UPDATE ON structure.node_order_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Helper — a node order's project_id (SECURITY DEFINER) ──────────────────
-- Used by the RLS policies below so they never inline-join RLS-protected tables
-- (the 2026-05-21 storage-RLS bug: an inline join to RLS-gated tables inside a
-- policy returns nothing). SECURITY DEFINER runs as the owner, bypassing RLS.
CREATE OR REPLACE FUNCTION structure.node_order_project_id(p_node_order_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT n.project_id
  FROM structure.node_orders o
  JOIN structure.nodes n ON n.id = o.node_id
  WHERE o.id = p_node_order_id
$$;
GRANT EXECUTE ON FUNCTION structure.node_order_project_id(uuid) TO authenticated;

-- ── 3. RLS — node_order_documents ────────────────────────────────────────────
ALTER TABLE structure.node_order_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_order_documents_select ON structure.node_order_documents;
CREATE POLICY node_order_documents_select ON structure.node_order_documents
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_documents_insert ON structure.node_order_documents;
CREATE POLICY node_order_documents_insert ON structure.node_order_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_documents_update ON structure.node_order_documents;
CREATE POLICY node_order_documents_update ON structure.node_order_documents
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_documents_delete ON structure.node_order_documents;
CREATE POLICY node_order_documents_delete ON structure.node_order_documents
  FOR DELETE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

-- ── 4. Storage bucket — node-order-documents ─────────────────────────────────
-- Path convention: {project_id}/{node_order_id}/{doc_type}/{timestamp}-{file}
-- structure.tenant_doc_project_id(name) extracts foldername[1] as the project
-- uuid (path-generic despite the name) — reused here.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('node-order-documents', 'node-order-documents', FALSE, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "node-order-documents read" ON storage.objects;
CREATE POLICY "node-order-documents read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'node-order-documents'
    AND public.user_has_project_access(structure.tenant_doc_project_id(name))
  );

DROP POLICY IF EXISTS "node-order-documents write" ON storage.objects;
CREATE POLICY "node-order-documents write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'node-order-documents'
    AND public.user_can_manage_project(structure.tenant_doc_project_id(name))
  );

DROP POLICY IF EXISTS "node-order-documents delete" ON storage.objects;
CREATE POLICY "node-order-documents delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'node-order-documents'
    AND public.user_can_manage_project(structure.tenant_doc_project_id(name))
  );
