-- =============================================================================
-- Migration: 00043_rename_documents_view_policy.sql
-- Description: Rename the documents-SELECT policy from 00041. PostgreSQL
--              truncates identifiers to 63 chars; the original policy name
--              "Org members and project-scoped client viewers can view
--              documents" was 64 chars and got silently truncated to
--              "...view document" (singular). This migration renames it to
--              a deliberately short, stable form.
-- =============================================================================

ALTER POLICY "Org members and project-scoped client viewers can view document"
    ON tenants.documents
    RENAME TO "Org members + scoped clients view documents";
