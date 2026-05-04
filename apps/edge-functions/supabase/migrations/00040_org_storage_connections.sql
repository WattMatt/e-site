-- =============================================================================
-- Migration: 00040_org_storage_connections.sql
-- Description: Cloud-storage OAuth connections, owned at the organisation
--              level (decision #3 in docs/cloud-storage-integration-design.md).
--              Tokens are encrypted application-side (AES-256-GCM, key in
--              env STORAGE_TOKEN_ENC_KEY) and stored as BYTEA — the DB never
--              decrypts them. Any active member of the org can SELECT a
--              connection (so any teammate can drive sync); writes likewise
--              gated on org membership at the row level. Finer-grained
--              "only owners/PMs may connect" is enforced at the
--              server-action layer where role context is richer.
-- =============================================================================

CREATE TABLE public.org_storage_connections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL CHECK (provider IN ('dropbox', 'google_drive', 'onedrive')),
    account_email       TEXT NOT NULL,
    -- AES-256-GCM ciphertexts. Layout: [12-byte IV][ciphertext + 16-byte auth tag].
    -- Encrypt/decrypt helpers in packages/db/src/encryption.ts.
    access_token_enc    BYTEA NOT NULL,
    refresh_token_enc   BYTEA NOT NULL,
    scope               TEXT,
    expires_at          TIMESTAMPTZ,
    connected_by        UUID NOT NULL REFERENCES public.profiles(id),
    -- Whose Dropbox/Drive/OneDrive account this is. account_email is the
    -- display label on /settings/integrations; connected_by is the audit
    -- trail (which org member granted the OAuth consent).
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organisation_id, provider, account_email)
);

CREATE INDEX idx_org_storage_connections_org      ON public.org_storage_connections(organisation_id);
CREATE INDEX idx_org_storage_connections_provider ON public.org_storage_connections(provider);

CREATE TRIGGER org_storage_connections_updated_at
    BEFORE UPDATE ON public.org_storage_connections
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_storage_connections ENABLE ROW LEVEL SECURITY;

-- Permissive: any active org member may interact with their org's connections.
CREATE POLICY "Org members can view connections"
    ON public.org_storage_connections FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can insert connections"
    ON public.org_storage_connections FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND connected_by = auth.uid()
    );

CREATE POLICY "Org members can update connections"
    ON public.org_storage_connections FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can delete connections"
    ON public.org_storage_connections FOR DELETE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- Restrictive: client viewers (per migration 00034) cannot see or touch
-- cloud connections — they're project-scoped read-only and have no
-- legitimate need to drive org-wide sync.
CREATE POLICY "Client viewers blocked from cloud connections"
    ON public.org_storage_connections AS RESTRICTIVE FOR ALL
    USING (NOT public.user_is_client_viewer(organisation_id));

NOTIFY pgrst, 'reload schema';
