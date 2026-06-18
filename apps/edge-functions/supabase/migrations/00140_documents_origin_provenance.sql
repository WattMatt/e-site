-- 00140_documents_origin_provenance.sql
-- Records which E-Site entity (e.g. an inspection) auto-filed a handover
-- document, so a re-issue can dedup its own prior artefacts without touching
-- manually-uploaded docs. Distinct from the existing source_* cloud-sync family.

ALTER TABLE tenants.documents
    ADD COLUMN IF NOT EXISTS origin_kind TEXT,   -- e.g. 'inspection'
    ADD COLUMN IF NOT EXISTS origin_id   UUID;   -- the inspections.inspections id

CREATE INDEX IF NOT EXISTS idx_documents_origin
    ON tenants.documents (origin_kind, origin_id)
    WHERE origin_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
