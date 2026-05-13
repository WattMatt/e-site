-- =============================================================================
-- Migration 00050 — Requisition photos (mobile field capture)
-- =============================================================================
-- Background:
--   Phase 3 slice 3 — adds a photo_paths array to procurement_items so the
--   mobile field-requisition flow can attach product / packaging /
--   on-site photos at the moment of raising the requisition.
--
-- Schema delta:
--   ALTER projects.procurement_items + photo_paths TEXT[] DEFAULT '{}'
--   + storage.buckets 'requisition-photos' (20 MB, images + PDF)
--   + RLS policies on storage.objects scoped to the org prefix.
-- =============================================================================

ALTER TABLE projects.procurement_items
    ADD COLUMN IF NOT EXISTS photo_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'requisition-photos',
    'requisition-photos',
    false,
    20971520,  -- 20 MB
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'application/pdf'
    ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can read requisition photo objects"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'requisition-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Org members can insert requisition photo objects"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'requisition-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can update requisition photo objects"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'requisition-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can delete requisition photo objects"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'requisition-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

NOTIFY pgrst, 'reload schema';
