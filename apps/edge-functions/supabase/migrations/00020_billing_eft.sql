-- ---------------------------------------------------------------------------
-- Migration 00020: EFT invoice support
-- Adds metadata column and pending_eft status to billing.invoices
-- ---------------------------------------------------------------------------

ALTER TABLE billing.invoices
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Replace status check to include pending_eft
ALTER TABLE billing.invoices
    DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE billing.invoices
    ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('pending', 'pending_eft', 'paid', 'failed', 'refunded', 'voided'));
