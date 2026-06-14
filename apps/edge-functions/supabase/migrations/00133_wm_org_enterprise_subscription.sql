-- 00133_wm_org_enterprise_subscription.sql
-- Platform-owner bypass for the subscription-tier quotas (projects / users).
--
-- Every other monetisation gate already exempts the WM-Consulting org
-- (dddddddd-0000-0000-0000-000000000001): has_feature (00097),
-- has_feature_seat (00125) and user_has_mv_access (00131) return TRUE for it
-- unconditionally. The per-tier quota gate (checkProjectQuota in
-- apps/web/src/actions/project.actions.ts: free=1 / starter=5 /
-- professional+=unlimited projects) was the one gate without the exemption —
-- the WM org has no billing.subscriptions row, so the app fell back to 'free'
-- and capped the platform owner at 1 project.
--
-- Fix in the data layer, consistent with the existing owner-bypass pattern:
-- seed a permanent 'enterprise' subscription (unlimited projects + users) for
-- the WM org. No Paystack linkage — the paystack_* columns stay NULL and
-- amount_kobo stays 0, so webhook writes (keyed on paystack_subscription_code
-- / paystack_customer_code / paystack_plan_code) can never touch this row.
--
-- Guarded by EXISTS so fresh databases (local dev / CI, where the WM org row
-- is not seeded) apply this migration as a no-op.

BEGIN;

INSERT INTO billing.subscriptions (organisation_id, tier, billing_period, status)
SELECT 'dddddddd-0000-0000-0000-000000000001'::uuid, 'enterprise', 'annual', 'active'
WHERE EXISTS (
    SELECT 1 FROM public.organisations
    WHERE id = 'dddddddd-0000-0000-0000-000000000001'::uuid
)
ON CONFLICT (organisation_id) DO UPDATE
    SET tier         = 'enterprise',
        status       = 'active',
        cancelled_at = NULL;

COMMIT;
