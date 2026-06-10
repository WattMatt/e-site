-- 00131_mv_user_subscription.sql
-- Medium-Voltage protection — the PER-USER access entitlement (paywall, Phase 7).
--
-- This is net-new billing and intentionally NOT modelled on the org-level
-- systems: the existing paid add-ons (billing.org_feature_unlocks, 00097) are
-- per-ORG one-time lifetime unlocks, and billing.subscriptions is per-ORG tier
-- billing. MV access is a per-USER, R2000/year recurring Paystack subscription
-- (a PLN_… plan the owner creates), so it gets its own table keyed on the user.
--
-- Access requires BOTH an active, in-date subscription AND a recorded
-- acceptance of the non-validation disclaimer (the engineer remains responsible
-- for validating every study per SANS 10142 / ECSA — the tool is a calculator,
-- not a validated authority). public.user_has_mv_access() enforces both.
--
-- Pricing/charge state is NOT modelled here — the amount lives on the Paystack
-- Plan; renewal cadence is driven by Paystack and reflected via the webhook
-- (/api/paystack/webhook, metadata.type === 'mv_subscription'). All writes come
-- from the webhook/subscribe route via the service role; there is deliberately
-- no client-writable RLS policy (SELECT-own only).

BEGIN;

-- ---------------------------------------------------------------------------
-- billing.user_mv_subscriptions — one row per user (the MV access entitlement)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.user_mv_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','past_due','expired')),
    current_period_end          TIMESTAMPTZ,                 -- access valid while > now()
    disclaimer_accepted_at      TIMESTAMPTZ,                 -- non-validation disclaimer acceptance
    paystack_customer_code      TEXT,
    paystack_subscription_code  TEXT,
    last_event_id               TEXT,                        -- webhook idempotency key
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_mv_subscriptions_updated_at
    BEFORE UPDATE ON billing.user_mv_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE billing.user_mv_subscriptions ENABLE ROW LEVEL SECURITY;

-- The user can see their own subscription row (so the client can render
-- locked/unlocked + renewal state). No INSERT/UPDATE/DELETE policy — writes go
-- through the service role from the Paystack webhook / mv-subscribe route.
CREATE POLICY "user_mv_subscriptions_select_own"
    ON billing.user_mv_subscriptions FOR SELECT
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- public.user_has_mv_access(user_id)
-- ---------------------------------------------------------------------------
-- TRUE only when the user has an active, in-date subscription AND has accepted
-- the non-validation disclaimer. Members of the WM-Consulting platform-owner
-- org bypass the gate (same convention as public.has_feature /
-- public.has_feature_seat) — the firm's own engineers use the firm's tool.
-- SECURITY DEFINER so it can read the service-role-owned table from an
-- RLS-bounded session.
CREATE OR REPLACE FUNCTION public.user_has_mv_access(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_organisations
        WHERE user_id         = p_user_id
          AND organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
          AND is_active
    )
    OR EXISTS (
        SELECT 1 FROM billing.user_mv_subscriptions
        WHERE user_id                = p_user_id
          AND status                 = 'active'
          AND current_period_end     > NOW()
          AND disclaimer_accepted_at IS NOT NULL
    );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_mv_access(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_has_mv_access(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
