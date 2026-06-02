-- =============================================================================
-- Migration 00115 — structure.node_order_shop_drawings + handover routing
-- =============================================================================
-- Promotes the single shop-drawing slot of node_order_documents into a
-- first-class, multi-row table with a progressing status
-- (awaiting → received → approved) and a link to the handover document the
-- approval creates. Adds two nullable handover-routing override columns.
--
-- Mirrors the RLS + bucket conventions of 00086 (node_order_documents) and
-- reuses the existing structure.node_order_project_id() SECURITY DEFINER
-- helper and the 'node-order-documents' storage bucket.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS throughout.
-- =============================================================================

-- ── 1. node_order_shop_drawings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS structure.node_order_shop_drawings (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_order_id         UUID        NOT NULL REFERENCES structure.node_orders(id) ON DELETE CASCADE,
    storage_path          TEXT        NOT NULL,
    file_name             TEXT        NOT NULL,
    title                 TEXT,
    status                TEXT        NOT NULL DEFAULT 'awaiting'
                                      CHECK (status IN ('awaiting', 'received', 'approved')),
    received_at           TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    approved_by           UUID,
    -- The tenants.documents row created on approval. Plain UUID (no cross-schema
    -- FK), matching node_order_documents.uploaded_by. NULL until approved;
    -- doubles as the idempotency guard (set → re-approve is a no-op).
    handover_document_id  UUID,
    -- Category the drawing was filed into — display mirror for the
    -- "Filed › <Category>" chip; set on approval, cleared on revert.
    handover_category     TEXT,
    uploaded_by           UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    -- No UNIQUE on node_order_id — many drawings per order.
);

CREATE INDEX IF NOT EXISTS idx_node_order_shop_drawings_order
    ON structure.node_order_shop_drawings (node_order_id);

DROP TRIGGER IF EXISTS node_order_shop_drawings_updated_at ON structure.node_order_shop_drawings;
CREATE TRIGGER node_order_shop_drawings_updated_at
    BEFORE UPDATE ON structure.node_order_shop_drawings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS — node_order_shop_drawings (reuses structure.node_order_project_id) ─
ALTER TABLE structure.node_order_shop_drawings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_order_shop_drawings_select ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_select ON structure.node_order_shop_drawings
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_insert ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_insert ON structure.node_order_shop_drawings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_update ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_update ON structure.node_order_shop_drawings
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_delete ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_delete ON structure.node_order_shop_drawings
  FOR DELETE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

-- ── 3. Handover-routing override columns ─────────────────────────────────────
-- Equipment orders (one order per node) remember their category on the node;
-- tenant scope orders remember per scope-item-type (one node can host a DB and
-- a Lighting order, which must route differently). Built-in types resolve from
-- code defaults and never need these set.
ALTER TABLE structure.nodes
    ADD COLUMN IF NOT EXISTS handover_category TEXT;
ALTER TABLE structure.scope_item_types
    ADD COLUMN IF NOT EXISTS handover_category TEXT;

-- ── 4. Back-migrate existing single shop drawings ────────────────────────────
-- The file demonstrably exists, so seed status 'received' (never assume approval).
INSERT INTO structure.node_order_shop_drawings
    (node_order_id, storage_path, file_name, status, received_at, uploaded_by, created_at)
SELECT
    d.node_order_id, d.storage_path, d.file_name, 'received', d.created_at, d.uploaded_by, d.created_at
FROM structure.node_order_documents d
WHERE d.doc_type = 'shop_drawing';

DELETE FROM structure.node_order_documents WHERE doc_type = 'shop_drawing';

-- ── 5. Tighten node_order_documents to the two remaining single slots ─────────
-- Inline CHECK constraints are auto-named <table>_<col>_check. Drop + re-add.
ALTER TABLE structure.node_order_documents
    DROP CONSTRAINT IF EXISTS node_order_documents_doc_type_check;
ALTER TABLE structure.node_order_documents
    ADD CONSTRAINT node_order_documents_doc_type_check
    CHECK (doc_type IN ('quote', 'order_instruction'));
