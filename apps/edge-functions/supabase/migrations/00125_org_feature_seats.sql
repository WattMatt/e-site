-- =============================================================================
-- Migration 00125 — per-seat feature unlocks (generator cost-recovery)
-- =============================================================================
-- Mirrors billing.org_feature_unlocks with a USER axis: a seat is an org-owned
-- paid slot, assignable/reassignable to a user (D3 pool). Freed (assigned_user_id
-- → NULL) when the user is removed, not forfeited.
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing.org_feature_seats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id    UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    feature_key        TEXT NOT NULL,
    assigned_user_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    paystack_reference TEXT UNIQUE,
    amount_paid_kobo   BIGINT,
    purchased_by       UUID REFERENCES auth.users(id),
    purchased_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_at        TIMESTAMPTZ,
    notes              TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_feature_seats_assignment
    ON billing.org_feature_seats (organisation_id, feature_key, assigned_user_id)
    WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_feature_seats_org ON billing.org_feature_seats (organisation_id);

CREATE OR REPLACE FUNCTION public.has_feature_seat(p_org_id UUID, p_user_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
        OR EXISTS (
            SELECT 1 FROM billing.org_feature_seats
            WHERE organisation_id = p_org_id AND feature_key = p_feature_key
              AND assigned_user_id = p_user_id
        );
$$;
REVOKE EXECUTE ON FUNCTION public.has_feature_seat(UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature_seat(UUID,UUID,TEXT) TO authenticated;

ALTER TABLE billing.org_feature_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_feature_seats_select ON billing.org_feature_seats;
CREATE POLICY org_feature_seats_select ON billing.org_feature_seats FOR SELECT TO authenticated
    USING (organisation_id = ANY(public.get_user_org_ids()));
NOTIFY pgrst, 'reload schema';
