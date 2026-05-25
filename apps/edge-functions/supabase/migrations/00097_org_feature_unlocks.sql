-- 00097_org_feature_unlocks.sql
-- Generic paid-add-on system: per-org, per-feature lifetime unlocks paid via
-- Paystack one-time charges. Used initially for the inspections module
-- (R250 lifetime); the same table is intended to back the JBCC notices module
-- and any future paid add-ons (the `feature_key` discriminates).
--
-- Pricing/charge state is intentionally NOT modelled here — that lives on
-- billing.invoices via paystack_reference (which is also our idempotency key
-- against the Paystack webhook).
--
-- WM-Consulting (the platform owner org) bypasses unlock checks unconditionally
-- via public.has_feature(); see the function definition below.

BEGIN;

-- ---------------------------------------------------------------------------
-- billing.org_feature_unlocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.org_feature_unlocks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    feature_key         TEXT NOT NULL,
    paystack_reference  TEXT UNIQUE,                 -- webhook idempotency; NULL for manual grants
    amount_paid_kobo    BIGINT,                      -- NULL for manual grants
    unlocked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unlocked_by         UUID REFERENCES auth.users(id), -- NULL for webhook-driven grants
    notes               TEXT,
    UNIQUE (organisation_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_org_feature_unlocks_org
    ON billing.org_feature_unlocks (organisation_id);

ALTER TABLE billing.org_feature_unlocks ENABLE ROW LEVEL SECURITY;

-- Members of the org can see their own org's unlocks (so the client can render
-- locked/unlocked state). No INSERT/UPDATE/DELETE policy — writes go through
-- the service role from the Paystack webhook.
CREATE POLICY "org_feature_unlocks_select"
    ON billing.org_feature_unlocks FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- public.has_feature(org_id, feature_key)
-- ---------------------------------------------------------------------------
-- Returns TRUE if the org has the feature unlocked, OR if it is the platform
-- owner org (WM-Consulting), which has unrestricted access to every feature.
-- SECURITY DEFINER so it can be called from RLS policies without recursing.
CREATE OR REPLACE FUNCTION public.has_feature(p_org_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
        OR EXISTS (
            SELECT 1 FROM billing.org_feature_unlocks
            WHERE organisation_id = p_org_id
              AND feature_key     = p_feature_key
        );
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
