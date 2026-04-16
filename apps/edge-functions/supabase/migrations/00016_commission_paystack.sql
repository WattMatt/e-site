-- =============================================================================
-- Migration: 00016_commission_paystack.sql
-- Description: Paystack subaccounts, commission records, commission payouts.
--              All amounts stored in kobo (ZAR × 100).
-- Spec § 7.5, § 8.1, T-007, T-020
-- =============================================================================

-- ---------------------------------------------------------------------------
-- marketplace.paystack_subaccounts — one row per supplier subaccount
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace.paystack_subaccounts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id             UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    supplier_org_id         UUID REFERENCES public.organisations(id),
    subaccount_code         TEXT NOT NULL UNIQUE,      -- e.g. ACCT_xxxxxxxxxxxxxxx
    split_code              TEXT UNIQUE,               -- e.g. SPL_xxxxxxxxxxxxxxx
    business_name           TEXT NOT NULL,
    settlement_bank         TEXT NOT NULL,             -- bank code e.g. '058'
    account_number          TEXT NOT NULL,
    percentage_charge       NUMERIC(5,2) NOT NULL DEFAULT 6.00, -- E-Site commission %
    is_verified             BOOLEAN NOT NULL DEFAULT FALSE,
    paystack_id             BIGINT,                    -- numeric ID from Paystack
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paystack_subaccounts_supplier
    ON marketplace.paystack_subaccounts(supplier_id);

CREATE TRIGGER paystack_subaccounts_updated_at
    BEFORE UPDATE ON marketplace.paystack_subaccounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketplace.commission_records — one row per paid marketplace order
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace.commission_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
    contractor_org_id       UUID NOT NULL REFERENCES public.organisations(id),
    supplier_org_id         UUID REFERENCES public.organisations(id),
    supplier_subaccount_code TEXT,                     -- Paystack subaccount that received payout
    paystack_reference      TEXT NOT NULL UNIQUE,      -- charge reference from Paystack
    paystack_split_code     TEXT,
    -- Amounts in kobo (ZAR × 100)
    gross_amount_kobo       BIGINT NOT NULL,           -- total order amount
    commission_rate         NUMERIC(5,4) NOT NULL,     -- e.g. 0.0600 = 6%
    commission_kobo         BIGINT NOT NULL,           -- E-Site takes this
    supplier_kobo           BIGINT NOT NULL,           -- supplier receives this
    -- Payout tracking
    payout_status           TEXT NOT NULL DEFAULT 'pending'
                            CHECK (payout_status IN ('pending', 'processing', 'paid', 'failed', 'refunded')),
    payout_reference        TEXT,                      -- Paystack transfer reference
    payout_initiated_at     TIMESTAMPTZ,
    payout_completed_at     TIMESTAMPTZ,
    payout_failed_at        TIMESTAMPTZ,
    payout_failure_reason   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_records_order
    ON marketplace.commission_records(order_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_paystack_ref
    ON marketplace.commission_records(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_commission_records_payout_status
    ON marketplace.commission_records(payout_status);

CREATE TRIGGER commission_records_updated_at
    BEFORE UPDATE ON marketplace.commission_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketplace.commission_payouts — aggregate payout batches (optional)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace.commission_payouts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id             UUID NOT NULL REFERENCES suppliers.suppliers(id),
    supplier_subaccount_code TEXT NOT NULL,
    paystack_transfer_code  TEXT UNIQUE,
    paystack_recipient_code TEXT,
    amount_kobo             BIGINT NOT NULL,           -- total payout amount
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'otp', 'processing', 'success', 'failed', 'reversed')),
    commission_record_ids   UUID[] NOT NULL DEFAULT '{}',
    initiated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    failure_reason          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_supplier
    ON marketplace.commission_payouts(supplier_id);

CREATE TRIGGER commission_payouts_updated_at
    BEFORE UPDATE ON marketplace.commission_payouts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- paystack_subaccounts: supplier org admin can view their own; esite admin (service role) manages all
ALTER TABLE marketplace.paystack_subaccounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subaccounts_select_own_org" ON marketplace.paystack_subaccounts
    FOR SELECT USING (
        supplier_org_id = ANY(public.get_user_org_ids())
    );

-- commission_records: both contractor and supplier orgs can view
ALTER TABLE marketplace.commission_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commission_records_select_own_orgs" ON marketplace.commission_records
    FOR SELECT USING (
        contractor_org_id = ANY(public.get_user_org_ids())
        OR supplier_org_id = ANY(public.get_user_org_ids())
    );

-- commission_payouts: supplier org can view their payouts
ALTER TABLE marketplace.commission_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commission_payouts_select_supplier_org" ON marketplace.commission_payouts
    FOR SELECT USING (
        supplier_id IN (
            SELECT s.id FROM suppliers.suppliers s
            WHERE s.organisation_id = ANY(public.get_user_org_ids())
        )
    );
