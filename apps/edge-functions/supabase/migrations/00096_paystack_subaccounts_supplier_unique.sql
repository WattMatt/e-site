-- 00096_paystack_subaccounts_supplier_unique.sql
-- Adds a UNIQUE constraint on marketplace.paystack_subaccounts.supplier_id.
--
-- The table is "one row per supplier subaccount" (migration 00016), but 00016
-- only created a plain non-unique index (idx_paystack_subaccounts_supplier) on
-- supplier_id. The Paystack subaccount route
-- (apps/web/src/app/api/paystack/subaccount/route.ts) upserts with
-- `onConflict: 'supplier_id'`, which Postgres rejects at runtime unless a
-- UNIQUE or exclusion constraint matches the ON CONFLICT target. This adds the
-- constraint 00016 intended, and drops the now-redundant non-unique index —
-- the constraint's implicit unique index fully supersedes it.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'marketplace.paystack_subaccounts'::regclass
      AND conname  = 'paystack_subaccounts_supplier_id_key'
  ) THEN
    ALTER TABLE marketplace.paystack_subaccounts
      ADD CONSTRAINT paystack_subaccounts_supplier_id_key UNIQUE (supplier_id);
  END IF;
END $$;

DROP INDEX IF EXISTS marketplace.idx_paystack_subaccounts_supplier;

NOTIFY pgrst, 'reload schema';

COMMIT;
