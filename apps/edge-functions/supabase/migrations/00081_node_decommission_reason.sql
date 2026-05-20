-- =============================================================================
-- Migration 00081 — dedicated decommission_reason column on structure.nodes
-- =============================================================================
-- Background:
--   The decommission/reactivate actions were storing the decommission reason in
--   structure.nodes.notes (a shared general-purpose column) by prefixing it with
--   "[Decommissioned] ". This overwrites any pre-existing notes, and reactivating
--   destroys them. This migration adds a dedicated nullable column so the two
--   concerns are cleanly separated.
--
-- No PostgREST db_schema config PATCH is needed — this only ADDs a column to an
-- existing table in the already-exposed `structure` schema.
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

ALTER TABLE structure.nodes ADD COLUMN decommission_reason TEXT;
