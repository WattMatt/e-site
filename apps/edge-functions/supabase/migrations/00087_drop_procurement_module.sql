-- =============================================================================
-- Migration 00087 — DROP the procurement / 5-stage BOM module
-- =============================================================================
-- DESTRUCTIVE. Removes the entire Procurement module (the Plan → Quote → Order
-- → Deliver → Pay pipeline over engineer_equipment_schedule). It is superseded
-- by the unified Material Order Tracker — structure.node_orders +
-- structure.node_order_documents (migration 00086).
--
-- ⚠  APPLY ONLY AFTER the consolidation branch has been fast-forwarded to
--    `main`. The database is shared between production and preview branches;
--    dropping these tables while production still runs the old procurement
--    code would break production. Apply this once production carries the new
--    code (the same discipline as migration 00082's board-drop).
--
-- The 39 engineer_equipment_schedule rows — the only procurement data; every
-- other procurement table is empty — are snapshotted at:
--   apps/edge-functions/supabase/migration-snapshots/
--     2026-05-21-procurement-module-pre-teardown.json
--
-- Idempotent: DROP ... IF EXISTS throughout.
-- =============================================================================

-- ── 1. Procurement tables (CASCADE also drops their indexes, FKs, triggers, RLS)
DROP TABLE IF EXISTS
  projects.supplier_invoices,
  projects.shop_drawing_approvals,
  projects.shop_drawings,
  projects.goods_received_notes,
  projects.procurement_quotes,
  projects.procurement_items,
  projects.engineer_equipment_schedule
  CASCADE;

-- ── 2. Project budget columns (added by migration 00048) ─────────────────────
ALTER TABLE projects.projects DROP COLUMN IF EXISTS budget_amount;
ALTER TABLE projects.projects DROP COLUMN IF EXISTS budget_currency;

-- ── 3. Procurement storage buckets — policies, objects, then the buckets ──────
DROP POLICY IF EXISTS "Org members can insert quote objects"             ON storage.objects;
DROP POLICY IF EXISTS "Org members can read quote objects"               ON storage.objects;
DROP POLICY IF EXISTS "Org members can update quote objects"             ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete quote objects"             ON storage.objects;
DROP POLICY IF EXISTS "Org members can insert shop drawing objects"      ON storage.objects;
DROP POLICY IF EXISTS "Org members can read shop drawing objects"        ON storage.objects;
DROP POLICY IF EXISTS "Org members can update shop drawing objects"      ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete shop drawing objects"      ON storage.objects;
DROP POLICY IF EXISTS "Org members can insert GRN photo objects"         ON storage.objects;
DROP POLICY IF EXISTS "Org members can read GRN photo objects"           ON storage.objects;
DROP POLICY IF EXISTS "Org members can update GRN photo objects"         ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete GRN photo objects"         ON storage.objects;
DROP POLICY IF EXISTS "Org members can insert requisition photo objects" ON storage.objects;
DROP POLICY IF EXISTS "Org members can read requisition photo objects"   ON storage.objects;
DROP POLICY IF EXISTS "Org members can update requisition photo objects" ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete requisition photo objects" ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id IN ('quotes', 'shop-drawings', 'grn-photos', 'requisition-photos');
DELETE FROM storage.buckets WHERE id     IN ('quotes', 'shop-drawings', 'grn-photos', 'requisition-photos');

-- PostgREST schema-cache refresh (procurement tables left the projects schema).
NOTIFY pgrst, 'reload schema';
