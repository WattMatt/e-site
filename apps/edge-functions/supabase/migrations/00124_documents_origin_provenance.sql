-- =============================================================================
-- Migration: 00124_documents_origin_provenance.sql
-- Description: Auto-file provenance for tenants.documents.
--
--   When a document is auto-filed into the handover pack by another subsystem
--   (e.g. an inspection certificate + its supporting uploads), we tag the row
--   with (origin_kind, origin_id) so the set can be found and replaced on
--   re-issue without creating duplicates.
--
--   DISTINCT from the existing source_* columns (00041), which record an
--   INBOUND cloud → E-Site sync. origin_* records WHICH E-Site entity caused
--   the row to exist.
--
--   Plain column add → no PostgREST db_schema PATCH; NOTIFY reload is enough.
-- =============================================================================

ALTER TABLE tenants.documents
    ADD COLUMN origin_kind TEXT,   -- e.g. 'inspection'
    ADD COLUMN origin_id   UUID;   -- e.g. the inspections.inspections id

-- Lookup for dedup-on-re-issue: "all docs auto-filed for inspection X".
CREATE INDEX idx_documents_origin
    ON tenants.documents(origin_kind, origin_id)
    WHERE origin_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
