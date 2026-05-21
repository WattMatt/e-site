-- ---------------------------------------------------------------------------
-- 00091_site_diary_attachments.sql
-- File / photo / video attachments for site diary entries.
-- New table projects.site_diary_attachments + private bucket 'diary-attachments'.
-- Mirrors the field.snag_photos pattern. No new schema => no PostgREST PATCH.
-- GRANTs are inherited automatically from ALTER DEFAULT PRIVILEGES (00025).
-- ---------------------------------------------------------------------------

-- 1. Table -------------------------------------------------------------------
CREATE TABLE projects.site_diary_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diary_entry_id  UUID NOT NULL REFERENCES projects.site_diary_entries(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('image', 'video', 'document')),
    caption         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX site_diary_attachments_entry_idx
    ON projects.site_diary_attachments (diary_entry_id, sort_order);

-- 2. Table RLS — scoped through the parent entry (mirrors field.snag_photos) --
ALTER TABLE projects.site_diary_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view diary attachments"
    ON projects.site_diary_attachments FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects.site_diary_entries e
            WHERE e.id = projects.site_diary_attachments.diary_entry_id
              AND e.organisation_id = ANY(public.get_user_org_ids())
              AND (
                  NOT public.user_is_client_viewer(e.organisation_id)
                  OR e.project_id IN (
                      SELECT project_id FROM projects.project_members
                      WHERE user_id = auth.uid()
                  )
              )
        )
    );

CREATE POLICY "Org members can add diary attachments"
    ON projects.site_diary_attachments FOR INSERT
    WITH CHECK (
        diary_entry_id IN (
            SELECT id FROM projects.site_diary_entries
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

CREATE POLICY "Org members can update diary attachments"
    ON projects.site_diary_attachments FOR UPDATE
    USING (
        diary_entry_id IN (
            SELECT id FROM projects.site_diary_entries
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

CREATE POLICY "Org members can delete diary attachments"
    ON projects.site_diary_attachments FOR DELETE
    USING (
        diary_entry_id IN (
            SELECT id FROM projects.site_diary_entries
            WHERE organisation_id = ANY(public.get_user_org_ids())
        )
    );

-- 3. Storage bucket ----------------------------------------------------------
-- Path convention: {org_id}/{project_id}/{diary_entry_id}/{timestamp}-{index}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'diary-attachments',
    'diary-attachments',
    false,
    104857600,  -- 100 MiB
    ARRAY[
        'image/jpeg','image/png','image/webp','image/heic',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'video/mp4','video/quicktime'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage object policies (mirror snag-photos) ----------------------------
CREATE POLICY "Org members can read diary attachments"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'diary-attachments'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload diary attachments"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'diary-attachments'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can delete diary attachments"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'diary-attachments'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );
