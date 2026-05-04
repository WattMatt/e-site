-- =============================================================================
-- Migration: 00042_project_documents_storage_bucket.sql
-- Description: Supabase Storage bucket + RLS for tenants.documents.
--              Path convention {org_id}/{project_id}/{filename}. 50MB cap
--              (handles typical contract PDFs, multi-page drawing PDFs,
--              photo bundles). MIME types unrestricted because the
--              `documents` table is a generic dumping ground — DOCX, XLSX,
--              ZIP, JPG, MP4 inspection videos, etc. all welcome.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'project-documents',
    'project-documents',
    false,
    52428800,  -- 50MB
    NULL       -- unrestricted; the table.mime_type column carries the actual MIME
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Storage RLS — same {org_id}/... folder convention as the rfi-attachments
-- bucket from 00033. Client-viewer scoping is enforced at the table layer
-- (tenants.documents); the bucket only checks org membership because
-- storage.foldername doesn't have project context.
-- ---------------------------------------------------------------------------
CREATE POLICY "Org members can read project documents"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'project-documents'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload project documents"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'project-documents'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can update project documents"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'project-documents'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can delete project documents"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'project-documents'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );
