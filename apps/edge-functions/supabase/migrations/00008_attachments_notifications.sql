-- =============================================================================
-- Migration: 00008_attachments_notifications.sql
-- Description: Universal attachment table + push notification tokens.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.attachments  (universal — replaces entity-specific file columns)
-- ---------------------------------------------------------------------------
CREATE TABLE public.attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    entity_type     TEXT NOT NULL,
    -- entity_type values: 'rfi' | 'rfi_response' | 'snag' | 'procurement_item'
    --                     | 'site_diary_entry' | 'drawing' | 'coc_upload' | 'handover'
    entity_id       UUID NOT NULL,
    file_path       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    file_size_bytes BIGINT,
    mime_type       TEXT,
    caption         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- public.push_tokens  (Expo push notification tokens)
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, token)
);
