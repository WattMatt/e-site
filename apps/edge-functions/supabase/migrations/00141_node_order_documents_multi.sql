-- =============================================================================
-- Migration 00141 — node_order_documents: multi-document Quote / Order slots
-- =============================================================================
-- The Quote and Order Instruction slots become multi-document: a node order may
-- now carry several quotes (e.g. competing suppliers) and several order
-- instructions (revisions, variations). Each document gains an optional
-- free-text label (supplier / note) and a kind tag.
--
-- Non-destructive: existing rows are preserved and default to kind='original',
-- label=NULL. Only the one-document-per-slot UNIQUE constraint is dropped.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS throughout.
-- =============================================================================

-- ── 1. Drop the one-per-slot uniqueness (auto-named by 00086's inline UNIQUE) ──
ALTER TABLE structure.node_order_documents
  DROP CONSTRAINT IF EXISTS node_order_documents_node_order_id_doc_type_key;

-- ── 2. Per-document metadata ──────────────────────────────────────────────────
ALTER TABLE structure.node_order_documents
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS kind  TEXT NOT NULL DEFAULT 'original';

-- Constrain kind to the known set (separate + idempotent — ADD COLUMN cannot
-- re-add a CHECK on a re-run).
ALTER TABLE structure.node_order_documents
  DROP CONSTRAINT IF EXISTS node_order_documents_kind_check;
ALTER TABLE structure.node_order_documents
  ADD CONSTRAINT node_order_documents_kind_check
  CHECK (kind IN ('original', 'revision', 'variation'));
