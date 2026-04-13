-- =============================================================================
-- Migration: 00007_billing_schema.sql
-- Description: billing schema — subscriptions, invoices, usage_records.
--              Paystack-native (ZAR). No Stripe Connect.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- billing.subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE billing.subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id             UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    tier                        TEXT NOT NULL DEFAULT 'free'
                                CHECK (tier IN ('free', 'starter', 'professional', 'enterprise')),
    billing_period              TEXT NOT NULL DEFAULT 'monthly'
                                CHECK (billing_period IN ('monthly', 'annual')),
    status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
    -- Paystack subscription fields
    paystack_subscription_code  TEXT UNIQUE,
    paystack_plan_code          TEXT,
    paystack_customer_code      TEXT,
    amount_kobo                 BIGINT NOT NULL DEFAULT 0, -- ZAR in kobo (smallest unit)
    next_billing_date           DATE,
    trial_ends_at               TIMESTAMPTZ,
    cancelled_at                TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organisation_id)
);

CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON billing.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- billing.invoices
-- ---------------------------------------------------------------------------
CREATE TABLE billing.invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    subscription_id     UUID REFERENCES billing.subscriptions(id),
    paystack_reference  TEXT UNIQUE,
    amount_kobo         BIGINT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'ZAR',
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'voided')),
    description         TEXT,
    billing_period_start DATE,
    billing_period_end   DATE,
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- billing.usage_records  (for storage / API metering)
-- ---------------------------------------------------------------------------
CREATE TABLE billing.usage_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    metric          TEXT NOT NULL, -- 'storage_bytes' | 'api_calls' | 'projects'
    value           BIGINT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
