-- =============================================================================
-- Migration: 00012_invites_storage.sql
-- Description: Org invite tokens + Supabase Storage buckets + storage RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.org_invites
-- ---------------------------------------------------------------------------
CREATE TABLE public.org_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'contractor'
                    CHECK (role IN ('admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer')),
    token           TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by      UUID NOT NULL REFERENCES public.profiles(id),
    accepted_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can manage invites"
    ON public.org_invites FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_organisations uo
            WHERE uo.organisation_id = org_invites.organisation_id
            AND uo.user_id = auth.uid()
            AND uo.role IN ('owner', 'admin')
            AND uo.is_active = TRUE
        )
    );

CREATE POLICY "Anyone can read invite by token"
    ON public.org_invites FOR SELECT
    USING (expires_at > NOW() AND accepted_at IS NULL);

CREATE INDEX idx_org_invites_token ON public.org_invites(token);
CREATE INDEX idx_org_invites_org   ON public.org_invites(organisation_id);
CREATE INDEX idx_org_invites_email ON public.org_invites(email);

-- ---------------------------------------------------------------------------
-- Storage buckets
-- Path conventions:
--   snag-photos    → {org_id}/{project_id}/{snag_id}/{filename}
--   coc-documents  → {org_id}/{site_id}/{subsection_id}/{filename}
--   drawings       → {org_id}/{project_id}/{filename}
--   avatars        → {user_id}/{filename}  (public bucket)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('snag-photos',   'snag-photos',   false, 10485760,  ARRAY['image/jpeg','image/png','image/webp','image/heic']),
    ('coc-documents', 'coc-documents', false, 52428800,  ARRAY['application/pdf','image/jpeg','image/png']),
    ('drawings',      'drawings',      false, 104857600, ARRAY['application/pdf','image/jpeg','image/png']),
    ('avatars',       'avatars',       true,  2097152,   ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Storage RLS — snag-photos (path prefix = org_id)
-- ---------------------------------------------------------------------------
CREATE POLICY "Org members can read snag photos"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'snag-photos'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload snag photos"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'snag-photos'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can delete snag photos"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'snag-photos'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

-- ---------------------------------------------------------------------------
-- Storage RLS — coc-documents
-- ---------------------------------------------------------------------------
CREATE POLICY "Org members can read COC documents"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'coc-documents'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload COC documents"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'coc-documents'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

-- ---------------------------------------------------------------------------
-- Storage RLS — drawings
-- ---------------------------------------------------------------------------
CREATE POLICY "Org members can read drawings"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'drawings'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload drawings"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'drawings'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

-- ---------------------------------------------------------------------------
-- Storage RLS — avatars (public read, own write)
-- ---------------------------------------------------------------------------
CREATE POLICY "Anyone can view avatars"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );

CREATE POLICY "Users can update their own avatar"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::TEXT
    );
