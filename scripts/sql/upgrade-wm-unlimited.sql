-- =============================================================================
-- One-off: upgrade Watson Mattheus Consulting to Enterprise tier (unlimited).
-- Run in Supabase Studio → SQL editor on the staging/prod project.
-- Idempotent: re-running is safe (UPSERT on UNIQUE(organisation_id)).
-- =============================================================================
-- Effect:
--   - tier='enterprise' → projects: -1 (unlimited), users: -1 (unlimited)
--   - status='active' (no past_due gating)
--   - paystack_subscription_code = NULL (no auto-billing, no webhook actions)
--   - amount_kobo = 0, no next_billing_date
-- Reversible with: UPDATE billing.subscriptions SET tier='free' WHERE organisation_id=$1
-- =============================================================================

WITH wm AS (
    SELECT id
    FROM public.organisations
    WHERE name ILIKE 'Watson Mattheus Consulting Electrical Engineer%'
    LIMIT 1
)
INSERT INTO billing.subscriptions (
    organisation_id, tier, billing_period, status,
    paystack_subscription_code, paystack_plan_code, paystack_customer_code,
    amount_kobo, next_billing_date, trial_ends_at, cancelled_at
)
SELECT
    wm.id, 'enterprise', 'annual', 'active',
    NULL, NULL, NULL,
    0, NULL, NULL, NULL
FROM wm
ON CONFLICT (organisation_id) DO UPDATE SET
    tier                       = 'enterprise',
    status                     = 'active',
    billing_period             = 'annual',
    paystack_subscription_code = NULL,
    paystack_plan_code         = NULL,
    amount_kobo                = 0,
    next_billing_date          = NULL,
    cancelled_at               = NULL,
    updated_at                 = NOW();

-- Verify:
SELECT o.name, s.tier, s.status, s.paystack_subscription_code, s.updated_at
FROM billing.subscriptions s
JOIN public.organisations o ON o.id = s.organisation_id
WHERE o.name ILIKE 'Watson Mattheus Consulting Electrical Engineer%';
