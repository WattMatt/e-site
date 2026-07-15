# Marketplace Phase 2 — Payments (pay-now) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inherit ALL conventions from [`2026-07-13-marketplace-implementation-index.md`](./2026-07-13-marketplace-implementation-index.md) (worktree off `origin/main`, migrations auto-apply on merge — **never hand-apply**, vitest gates, RBAC-matrix-same-change rule, integer-cents money helper, commit trailer). This plan assumes **Phase 0** (commission 5% + bearer subaccount reconciled, money helper, `MARKETPLACE_BUYER_ROLES`/`SUPPLIER_PORTAL_ROLES`, transactional registration, orders RLS hardening) and **Phase 1** (persistent cart, unified checkout that creates orders, `resolvePrice` snapshotting onto `order_items`, `catalogue_items` inventory + `tax_class`) are **merged**. Where a Phase-1 column may or may not already exist, this plan's migrations use `ADD COLUMN IF NOT EXISTS` and are safe either way.

**Goal:** Turn on real money. Wire the built-but-dark `marketplace-payment` + `paystack-webhook` edge functions end-to-end: a buyer clicks **Pay now** on a `pending_payment` order, pays via Paystack (supplier subaccount, server-computed 5%-of-ex-VAT commission, `bearer: subaccount`), and the webhook marks the order `paid`, writes the commission ledger, decrements inventory, generates tax-invoice data, and emails a receipt. Plus manual admin-mediated **refunds & disputes**, compliant **tax invoices** (behind a legal-signoff flag), and a **payment security** sweep.

**Architecture:** Five SQL migrations (`00190`–`00194`) alter `marketplace.orders` and add `commission_config`, subaccount link-states, `tax_invoices`, `order_disputes`, `refunds` + an invoices bucket. New pure functions in `@esite/shared` (VAT/totals, commission resolution, Paystack charge split) are unit-tested and mirrored into the Deno edge functions. New web server actions + one route wire the buyer **Pay now** button and the Paystack callback. The webhook is completed (inventory + invoice data + receipt email + refund events). A pdf-lib tax-invoice renderer + RLS-gated PDF route mirror the `db-legend` exemplar. Everything stays behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE`; **tax-invoice issuance** is additionally gated behind `MARKETPLACE_TAX_INVOICES_ENABLED` (decision **R5**).

**Tech Stack:** Next.js 15 (App Router, server actions, route handlers), TypeScript, Zod, Supabase/Postgres (RLS, RPC, migrations), Supabase Edge (Deno), Paystack (test mode), pdf-lib, Resend (via `send-email` edge fn), vitest.

**External blocker (explicit):** Paystack **live-mode KYC** for the seller-of-record entity is still Arno-owned (`SPEC DOCS/paystack/00-master-spec.md`, spec §13 R6). **Every task in this plan is buildable and testable in Paystack TEST mode now** — go-live is a config flip (live keys + webhook URL), not a code change. Do not block implementation on KYC.

**Decision defaults applied (alternative noted inline):**
- **R1 (payout):** assume Paystack **subaccount auto-split settles the supplier** on Paystack's cycle. This plan does **not** build E-Site-initiated transfers. *(Alt: E-Site-initiated `transfer.*` payouts — the existing webhook handlers stay dormant until proven needed.)*
- **R5 (VAT/legal):** capture **all** tax-invoice data and build generation now, but keep actual issuance behind `MARKETPLACE_TAX_INVOICES_ENABLED` until accountant sign-off. Draft renders carry a "NOT A VALID TAX INVOICE" watermark. *(Alt: hold all generation — rejected; we lose nothing by capturing data.)*
- **Split mechanism:** use a **per-transaction flat `transaction_charge` = server-computed commission (kobo)** with `subaccount` + `bearer: subaccount`, giving **exact 5%-of-ex-VAT** commission. *(Alt: the reusable fixed-% `split_code` — kept + created at onboarding per canon, but a fixed % charges commission on the VAT-inclusive gross, over-collecting; used only as the edge-fn fallback.)*

**Scope (11 tasks):** 1) orders payment/VAT/status columns · 2) `commission_config` single DB source + resolver · 3) `computeOrderTotals` + commission (shared, cents/VAT) · 4) subaccount `split_code` creation + real link-states + verification · 5) pay-now server action + `marketplace-payment` edge-fn fixes · 6) Pay-now UI + Paystack callback route · 7) marketplace payment email templates · 8) webhook completion (inventory + invoice data + receipt email + refund events) · 9) tax invoices (schema + renderer + PDF route + generation) · 10) refunds & disputes (schema + actions + Paystack refund + emails) · 11) payment-security review + RBAC matrix + Phase-2 verification sweep.

---

## Task 1: `marketplace.orders` payment / VAT / status columns

Adds the money-in-cents, VAT, `payment_mode`, and extended `status`/`payment_status` domain the pay-now flow and invoices need. Legacy `total_amount` (rand) is retained for back-compat display; the cents columns become the source of truth for the charge.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00190_marketplace_orders_payment_vat.sql`
- Modify: `packages/db/src/types.ts` (regenerate or hand-add the new nullable columns to `marketplace.orders` / `order_items` Row/Insert types — see CLAUDE.md gotcha on `gen types`)

- [ ] **Step 1: Confirm the current CHECK-constraint names (no code yet)**

Read-only (Management API `database/query`, or `supabase db` locally):
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'marketplace.orders'::regclass AND contype = 'c';
```
Expected default names: `orders_status_check`, `orders_payment_status_check`. Use the exact names returned in Step 2's `DROP CONSTRAINT`.

- [ ] **Step 2: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00190_marketplace_orders_payment_vat.sql
-- Phase 2: money-in-cents + VAT + payment_mode on marketplace.orders, and the
-- extended status / payment_status domain from target-spec §5.4. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so it is safe whether or not Phase 1 added a subset.
-- ZAR: 1 cent == 1 kobo, so *_cents columns are also the exact Paystack kobo amount.

-- ── Money-in-cents + VAT (integer cents; source of truth for the charge) ──────
ALTER TABLE marketplace.orders
  ADD COLUMN IF NOT EXISTS subtotal_ex_vat_cents  BIGINT,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount_cents        BIGINT,
  ADD COLUMN IF NOT EXISTS total_incl_vat_cents    BIGINT,
  ADD COLUMN IF NOT EXISTS commission_base_cents   BIGINT,     -- ex-VAT value commission is charged on
  ADD COLUMN IF NOT EXISTS payment_mode            TEXT NOT NULL DEFAULT 'pay_now',
  ADD COLUMN IF NOT EXISTS receipt_sent_at         TIMESTAMPTZ; -- receipt-email idempotency gate

-- ── order_items: per-line tax + VAT snapshot (Phase 1 may already have added) ─
ALTER TABLE marketplace.order_items
  ADD COLUMN IF NOT EXISTS tax_class     TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS line_vat_cents BIGINT;

-- ── payment_mode domain ──────────────────────────────────────────────────────
ALTER TABLE marketplace.orders DROP CONSTRAINT IF EXISTS orders_payment_mode_check;
ALTER TABLE marketplace.orders
  ADD CONSTRAINT orders_payment_mode_check CHECK (payment_mode IN ('pay_now','on_account'));

-- ── Extend payment_status: add partially_refunded (spec §5.4) ─────────────────
ALTER TABLE marketplace.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE marketplace.orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending','paid','refunded','partially_refunded','failed'));

-- ── Extend status: add pending_payment + post-paid states (spec §5.4). ────────
-- Preparing/dispatched/delivered/completed are Phase-3 fulfilment states; added
-- now so the domain is stable and Phase 3 does not have to re-migrate the CHECK.
ALTER TABLE marketplace.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE marketplace.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'draft','submitted','pending_payment','paid','accepted','preparing',
    'confirmed','in_transit','dispatched','delivered','completed',
    'invoiced','cancelled','refunded','partially_refunded','disputed'
  ));

-- tax_class domain
ALTER TABLE marketplace.order_items DROP CONSTRAINT IF EXISTS order_items_tax_class_check;
ALTER TABLE marketplace.order_items
  ADD CONSTRAINT order_items_tax_class_check
  CHECK (tax_class IN ('standard','zero_rated','exempt'));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Reflect the new columns in the DB types**

Run `pnpm --filter @esite/db gen-types` if a live DB is reachable, else hand-add the nullable columns to `packages/db/src/types.ts` under `marketplace.orders` and `marketplace.order_items` (all new money columns are `number | null`; `payment_mode`/`tax_class` are `string`). Re-apply the `slug?`/`code?` hand-patch per the CLAUDE.md gotcha if regenerating.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @esite/db type-check && pnpm --filter web type-check`
Expected: PASS (new optional columns, no call-site breaks).
```bash
git add apps/edge-functions/supabase/migrations/00190_marketplace_orders_payment_vat.sql packages/db/src/types.ts
git commit -m "feat(marketplace): orders payment/VAT/status columns (Phase 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `commission_config` single DB source + resolver

Phase 0 fixed the *constant* to 5%; this task makes the rate a queryable single source (platform default + optional per-supplier/per-category override) read by the checkout, edge fn, and invoice generation. Server never trusts a client-supplied rate.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00191_marketplace_commission_config.sql`
- Create: `packages/shared/src/marketplace/commission-config.ts` (typed reader over the RPC result)
- Test: `packages/shared/src/__tests__/marketplace/commission-config.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write the migration (table + resolver fn + seed)**

```sql
-- apps/edge-functions/supabase/migrations/00191_marketplace_commission_config.sql
-- Single source of truth for the marketplace commission rate + fee bearer.
-- Platform default row is 5% + bearer 'subaccount' (master spec D5/D6).
CREATE TABLE IF NOT EXISTS marketplace.commission_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT NOT NULL CHECK (scope IN ('platform','supplier','category')),
  scope_id      UUID,                                   -- supplier_id, or NULL for platform
  category      TEXT,                                   -- for scope='category'
  rate          NUMERIC(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  bearer        TEXT NOT NULL DEFAULT 'subaccount' CHECK (bearer IN ('subaccount','account','all')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Exactly one active platform default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_config_platform
  ON marketplace.commission_config (scope) WHERE scope = 'platform';
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_config_supplier
  ON marketplace.commission_config (scope, scope_id) WHERE scope = 'supplier';

INSERT INTO marketplace.commission_config (scope, rate, bearer)
SELECT 'platform', 0.0500, 'subaccount'
WHERE NOT EXISTS (SELECT 1 FROM marketplace.commission_config WHERE scope = 'platform');

-- Resolver: supplier override > platform default. SECURITY DEFINER so the edge
-- fn (service role) and cookie clients read the same effective rate.
CREATE OR REPLACE FUNCTION marketplace.get_commission_rate(p_supplier_id UUID)
RETURNS TABLE (rate NUMERIC, bearer TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = marketplace AS $$
  SELECT rate, bearer FROM marketplace.commission_config
  WHERE scope = 'supplier' AND scope_id = p_supplier_id
  UNION ALL
  SELECT rate, bearer FROM marketplace.commission_config WHERE scope = 'platform'
  LIMIT 1
$$;

-- RLS: readable to authenticated (rate is not secret); writes service-role only.
ALTER TABLE marketplace.commission_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commission_config_read ON marketplace.commission_config;
CREATE POLICY commission_config_read ON marketplace.commission_config
  FOR SELECT TO authenticated USING (true);

GRANT EXECUTE ON FUNCTION marketplace.get_commission_rate(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing test for the typed reader**

```ts
// packages/shared/src/__tests__/marketplace/commission-config.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCommission, DEFAULT_COMMISSION } from '../../marketplace/commission-config'

describe('commission-config reader', () => {
  it('falls back to the 5% platform default when no override row', () => {
    expect(resolveCommission(null)).toEqual({ rate: 0.05, bearer: 'subaccount' })
  })
  it('uses a supplier override row when present', () => {
    expect(resolveCommission({ rate: 0.04, bearer: 'subaccount' }))
      .toEqual({ rate: 0.04, bearer: 'subaccount' })
  })
  it('exposes the default constant', () => {
    expect(DEFAULT_COMMISSION).toEqual({ rate: 0.05, bearer: 'subaccount' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- commission-config`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the reader**

```ts
// packages/shared/src/marketplace/commission-config.ts
/** Effective commission for a supplier: DB override or the platform default. */
export interface CommissionRule {
  rate: number            // fraction, e.g. 0.05
  bearer: 'subaccount' | 'account' | 'all'
}

export const DEFAULT_COMMISSION: CommissionRule = { rate: 0.05, bearer: 'subaccount' }

/** Coerce a `get_commission_rate` RPC row (or null) into a CommissionRule. */
export function resolveCommission(
  row: { rate: number; bearer: string } | null | undefined,
): CommissionRule {
  if (!row) return DEFAULT_COMMISSION
  return {
    rate: Number(row.rate),
    bearer: (row.bearer as CommissionRule['bearer']) ?? 'subaccount',
  }
}
```

- [ ] **Step 5: Export + verify pass**

Add `export * from './marketplace/commission-config'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- commission-config`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00191_marketplace_commission_config.sql packages/shared/src/marketplace/commission-config.ts packages/shared/src/__tests__/marketplace/commission-config.test.ts packages/shared/src/index.ts
git commit -m "feat(marketplace): commission_config single source + resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `computeOrderTotals` + commission (shared, cents / VAT)

The pure money engine: from priced line items → subtotal ex-VAT, VAT @ 15% per `tax_class`, total incl-VAT, and the commission base + amount (5% of ex-VAT goods). All integer cents, `Math.ceil` for E-Site favour (matching the edge fn's existing rounding). Server-only; never trusts client amounts.

**Files:**
- Create: `packages/shared/src/marketplace/order-totals.ts`
- Test: `packages/shared/src/__tests__/marketplace/order-totals.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/marketplace/order-totals.test.ts
import { describe, it, expect } from 'vitest'
import { computeOrderTotals, VAT_RATE } from '../../marketplace/order-totals'

describe('computeOrderTotals', () => {
  it('VAT_RATE is 15%', () => {
    expect(VAT_RATE).toBe(0.15)
  })

  it('sums ex-VAT lines, applies 15% VAT on standard lines, and 5% commission on ex-VAT goods', () => {
    const t = computeOrderTotals({
      lines: [
        { qtyCents: 100_00, taxClass: 'standard' }, // R100.00 ex-VAT
        { qtyCents: 50_00,  taxClass: 'standard' }, // R50.00 ex-VAT
      ],
      deliveryFeeCents: 0,
      commissionRate: 0.05,
    })
    expect(t.subtotalExVatCents).toBe(150_00)
    expect(t.vatAmountCents).toBe(22_50)          // 15% of 150.00
    expect(t.totalInclVatCents).toBe(172_50)
    expect(t.commissionBaseCents).toBe(150_00)     // ex-VAT goods
    expect(t.commissionCents).toBe(7_50)           // 5% of 150.00
    expect(t.supplierCents).toBe(t.totalInclVatCents - t.commissionCents)
  })

  it('zero-rated and exempt lines attract no VAT but still count toward commission base', () => {
    const t = computeOrderTotals({
      lines: [
        { qtyCents: 100_00, taxClass: 'zero_rated' },
        { qtyCents: 100_00, taxClass: 'exempt' },
      ],
      deliveryFeeCents: 0,
      commissionRate: 0.05,
    })
    expect(t.vatAmountCents).toBe(0)
    expect(t.subtotalExVatCents).toBe(200_00)
    expect(t.totalInclVatCents).toBe(200_00)
    expect(t.commissionCents).toBe(10_00)
  })

  it('adds delivery fee (standard-rated) to the total but NOT to the commission base', () => {
    const t = computeOrderTotals({
      lines: [{ qtyCents: 100_00, taxClass: 'standard' }],
      deliveryFeeCents: 50_00,
      commissionRate: 0.05,
    })
    // goods 100 + delivery 50 = 150 ex-VAT; VAT 22.50; total 172.50
    expect(t.subtotalExVatCents).toBe(150_00)
    expect(t.vatAmountCents).toBe(22_50)
    expect(t.totalInclVatCents).toBe(172_50)
    expect(t.commissionBaseCents).toBe(100_00)     // goods only — delivery is a pass-through
    expect(t.commissionCents).toBe(5_00)
  })

  it('rounds commission UP (E-Site favour) and keeps the invariant supplier + commission == total', () => {
    const t = computeOrderTotals({
      lines: [{ qtyCents: 99_99, taxClass: 'zero_rated' }],
      deliveryFeeCents: 0,
      commissionRate: 0.05,
    })
    expect(t.commissionCents).toBe(Math.ceil(99_99 * 0.05)) // 500
    expect(t.supplierCents + t.commissionCents).toBe(t.totalInclVatCents)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- order-totals`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/marketplace/order-totals.ts
/** South African standard VAT rate. */
export const VAT_RATE = 0.15

export type TaxClass = 'standard' | 'zero_rated' | 'exempt'

export interface OrderLineInput {
  /** Line ex-VAT amount in integer cents (qty × snapshot unit price ex-VAT). */
  qtyCents: number
  taxClass: TaxClass
}

export interface OrderTotals {
  subtotalExVatCents: number    // goods + delivery, ex-VAT
  vatAmountCents: number
  totalInclVatCents: number
  deliveryFeeCents: number
  commissionBaseCents: number   // ex-VAT GOODS only (delivery excluded)
  commissionCents: number       // E-Site, rounded UP
  supplierCents: number         // total_incl_vat − commission (what the subaccount nets)
}

/**
 * Server-side order totals. Integer cents throughout (== kobo for ZAR).
 * Delivery fee is treated as a standard-rated supply and added to the taxable
 * base, but is NOT part of the commission base (commission is on goods).
 */
export function computeOrderTotals(params: {
  lines: OrderLineInput[]
  deliveryFeeCents: number
  commissionRate: number
}): OrderTotals {
  const { lines, deliveryFeeCents, commissionRate } = params
  if (commissionRate < 0 || commissionRate > 1) throw new Error('commissionRate out of range')

  let goodsExVat = 0
  let vat = 0
  for (const l of lines) {
    if (l.qtyCents < 0) throw new Error('line amount must be non-negative')
    goodsExVat += l.qtyCents
    if (l.taxClass === 'standard') vat += Math.round(l.qtyCents * VAT_RATE)
  }
  // Delivery is standard-rated.
  vat += Math.round(deliveryFeeCents * VAT_RATE)

  const subtotalExVatCents = goodsExVat + deliveryFeeCents
  const vatAmountCents = vat
  const totalInclVatCents = subtotalExVatCents + vatAmountCents

  const commissionBaseCents = goodsExVat
  const commissionCents = Math.ceil(commissionBaseCents * commissionRate)
  const supplierCents = totalInclVatCents - commissionCents

  return {
    subtotalExVatCents,
    vatAmountCents,
    totalInclVatCents,
    deliveryFeeCents,
    commissionBaseCents,
    commissionCents,
    supplierCents,
  }
}
```

- [ ] **Step 4: Export + verify pass**

Add `export * from './marketplace/order-totals'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- order-totals`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/marketplace/order-totals.ts packages/shared/src/__tests__/marketplace/order-totals.test.ts packages/shared/src/index.ts
git commit -m "feat(marketplace): computeOrderTotals (cents/VAT/commission)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Subaccount `split_code` creation + real link-states + verification

Payments require a **linked** subaccount with a **split_code**. Today onboarding never creates the split and hardcodes `is_verified = true`. This task: create + persist `split_code` at onboarding, introduce real `link_status` states (`unlinked → linked → verified`), verify via a Paystack account-resolve, and gate the route to the supplier org's owner/admin.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00192_paystack_subaccount_link_states.sql`
- Modify: `packages/db/src/services/payment.service.ts` (add `resolveAccount`)
- Modify: `apps/web/src/app/api/paystack/subaccount/route.ts` (create split, real verification, `SUPPLIER_PORTAL_ROLES` gate)
- Modify: `apps/web/src/app/(marketplace)/supplier/profile/PaystackOnboardingCard.tsx` (surface link state honestly)
- Test: `packages/db/src/services/__tests__/payment.service.resolve.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00192_paystack_subaccount_link_states.sql
-- Real subaccount states (spec §2.3): unlinked → linked → verified. Payments are
-- allowed at 'linked'; 'verified' requires a real Paystack account-resolve.
ALTER TABLE marketplace.paystack_subaccounts
  ADD COLUMN IF NOT EXISTS link_status        TEXT NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS resolved_account_name TEXT,
  ADD COLUMN IF NOT EXISTS verified_at        TIMESTAMPTZ;

ALTER TABLE marketplace.paystack_subaccounts DROP CONSTRAINT IF EXISTS paystack_subaccounts_link_status_check;
ALTER TABLE marketplace.paystack_subaccounts
  ADD CONSTRAINT paystack_subaccounts_link_status_check
  CHECK (link_status IN ('unlinked','linked','verified'));

-- Backfill: any existing row with a subaccount_code is at least 'linked'.
UPDATE marketplace.paystack_subaccounts
  SET link_status = 'linked'
  WHERE subaccount_code IS NOT NULL AND link_status = 'unlinked';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Add `resolveAccount` to the Paystack service (failing test first)**

```ts
// packages/db/src/services/__tests__/payment.service.resolve.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PaystackService } from '../payment.service'

afterEach(() => vi.restoreAllMocks())

describe('PaystackService.resolveAccount', () => {
  it('returns the resolved account name on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ status: true, message: 'ok', data: { account_number: '0123456789', account_name: 'ACME ELECTRICAL' } }),
      { status: 200 },
    ))
    const svc = new PaystackService('sk_test_x')
    const res = await svc.resolveAccount({ accountNumber: '0123456789', bankCode: '058' })
    expect(res.account_name).toBe('ACME ELECTRICAL')
  })

  it('throws on a Paystack error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ status: false, message: 'Could not resolve account' }),
      { status: 422 },
    ))
    const svc = new PaystackService('sk_test_x')
    await expect(svc.resolveAccount({ accountNumber: '0', bankCode: '058' }))
      .rejects.toThrow(/Could not resolve account/)
  })
})
```
Run: `pnpm --filter @esite/db test -- payment.service.resolve` → FAIL (method missing).

- [ ] **Step 3: Implement `resolveAccount`**

Add to `PaystackService` (near `listSABanks`):
```ts
  /**
   * Resolve a bank account to its registered name (real verification signal).
   * Paystack: GET /bank/resolve?account_number=&bank_code=
   */
  async resolveAccount(params: { accountNumber: string; bankCode: string }): Promise<{ account_number: string; account_name: string }> {
    return this.request<{ account_number: string; account_name: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(params.accountNumber)}&bank_code=${encodeURIComponent(params.bankCode)}`,
    )
  }
```
Run: `pnpm --filter @esite/db test -- payment.service.resolve` → PASS.

- [ ] **Step 4: Rewrite `POST /api/paystack/subaccount` — role gate, create split, real verify**

Replace the handler body so it (a) gates on `SUPPLIER_PORTAL_ROLES`, (b) confirms the caller owns the supplier org, (c) creates the subaccount at `percentage_charge: 5` (Phase-0 value), (d) **creates + persists the `split_code`** via `paystack.createSplit` (Phase 0 fixed it to `bearer: subaccount`), (e) attempts `resolveAccount` and sets `link_status` = `'verified'` (name resolved) or `'linked'` (created but unresolved), never a blind `true`:

```ts
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPaystackService } from '@esite/db'
import { requireRole } from '@/lib/auth/require-role'
import { SUPPLIER_PORTAL_ROLES } from '@esite/shared'

const bodySchema = z.object({
  supplierId: z.string().uuid(),
  bankCode: z.string().min(1).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  businessName: z.string().min(1).max(100),
  primaryContactEmail: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request body' }, { status: 400 })
  }
  const { supplierId, bankCode, accountNumber, businessName, primaryContactEmail } = parsed.data

  // Resolve the supplier's owning org, then enforce owner/admin of THAT org.
  const { data: supplier } = await supabase
    .schema('suppliers').from('suppliers')
    .select('id, organisation_id')
    .eq('id', supplierId)
    .single()
  if (!supplier?.organisation_id) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  const guard = await requireRole(supabase, supplier.organisation_id, SUPPLIER_PORTAL_ROLES)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 403 })

  try {
    const paystack = getPaystackService()
    const subaccount = await paystack.createSubaccount({
      businessName, settlementBank: bankCode, accountNumber,
      percentageCharge: 5, // E-Site commission % (Phase 0). Split share = 95%.
      primaryContactEmail,
    })

    // Create + persist the reusable split (canon requirement). bearer: subaccount
    // is set inside createSplit (Phase 0). 5% commission → 95% supplier share.
    const split = await paystack.createSplit({
      name: `${businessName} split`,
      supplierSubaccountCode: subaccount.subaccount_code,
      commissionPercent: 5,
    })

    // Real verification signal — resolve the account name; degrade to 'linked'.
    let linkStatus: 'linked' | 'verified' = 'linked'
    let resolvedName: string | null = null
    try {
      const resolved = await paystack.resolveAccount({ accountNumber, bankCode })
      resolvedName = resolved.account_name
      linkStatus = 'verified'
    } catch (e) {
      console.warn('subaccount account-resolve failed (staying linked):', e)
    }

    const { error: dbErr } = await supabase
      .schema('marketplace').from('paystack_subaccounts')
      .upsert({
        supplier_id: supplierId,
        supplier_org_id: supplier.organisation_id,
        subaccount_code: subaccount.subaccount_code,
        split_code: split.split_code,
        settlement_bank: bankCode,
        account_number: accountNumber,
        business_name: businessName,
        percentage_charge: 5,
        link_status: linkStatus,
        resolved_account_name: resolvedName,
        verified_at: linkStatus === 'verified' ? new Date().toISOString() : null,
        is_verified: linkStatus === 'verified', // keep legacy column consistent
      }, { onConflict: 'supplier_id' })

    if (dbErr) {
      console.error('Paystack subaccount DB error:', dbErr)
      return NextResponse.json({ error: 'Subaccount created in Paystack but failed to save' }, { status: 500 })
    }
    return NextResponse.json({ subaccount_code: subaccount.subaccount_code, split_code: split.split_code, link_status: linkStatus })
  } catch (err: any) {
    console.error('Paystack subaccount error:', err)
    return NextResponse.json({ error: err.message ?? 'Failed to create subaccount' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Surface the honest state in the onboarding card**

In `PaystackOnboardingCard.tsx`, replace the "Verified" badge that read `is_verified` with a 3-state chip driven by `link_status` (`unlinked` → grey "Not linked", `linked` → info "Linked — payments enabled", `verified` → success "Verified"). Add a one-line note that "Verified" means the bank account name was resolved with Paystack. Update `docs/rbac-matrix.md` entry for `POST /api/paystack/subaccount` to `SUPPLIER_PORTAL_ROLES` (deferred to Task 11's matrix sweep — leave a TODO comment in the PR).

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @esite/db test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. Then with the **run** skill (Paystack test keys), onboard a throwaway supplier and confirm the `paystack_subaccounts` row has a non-null `split_code` and `link_status='verified'` (or `'linked'` if resolve fails in test mode).
```bash
git add apps/edge-functions/supabase/migrations/00192_paystack_subaccount_link_states.sql packages/db/src/services/payment.service.ts packages/db/src/services/__tests__/payment.service.resolve.test.ts apps/web/src/app/api/paystack/subaccount/route.ts apps/web/src/app/\(marketplace\)/supplier/profile/PaystackOnboardingCard.tsx
git commit -m "feat(marketplace): create split_code + real subaccount link-states at onboarding

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Pay-now server action + `marketplace-payment` edge-fn fixes

The core wiring. A buyer-gated server action recomputes totals **server-side**, verifies the supplier can accept payments, persists the cents columns, and invokes `marketplace-payment`. The edge fn is corrected to: read the rate from `commission_config`, charge `total_incl_vat_cents`, keep exactly `commissionCents` via a per-transaction flat **`transaction_charge`** with `bearer: subaccount`, and fix the residual `bearer_type: 'all'` on the on-the-fly split fallback.

**Files:**
- Create: `apps/web/src/actions/marketplace-payment.actions.ts` (`initiateOrderPaymentAction`)
- Test: `apps/web/src/actions/__tests__/initiateOrderPayment.test.ts`
- Modify: `apps/edge-functions/supabase/functions/marketplace-payment/index.ts`
- Modify: `apps/web/src/actions/supplier.actions.ts` (`placeOrderAction`: set `payment_mode`, and `status='pending_payment'` for pay-now — small addition)

- [ ] **Step 1: Write the failing action test**

```ts
// apps/web/src/actions/__tests__/initiateOrderPayment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase server client + role guard. Match the mock style of a
// sibling action test (read apps/web/src/actions/__tests__/*.test.ts first).
const invoke = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { initiateOrderPaymentAction } from '../marketplace-payment.actions'

function clientWith(opts: {
  order: any
  items: any[]
  subaccount: any
  commission?: { rate: number; bearer: string }
}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'b@x.co' } } }) },
    functions: { invoke },
    rpc: vi.fn().mockResolvedValue({ data: [opts.commission ?? { rate: 0.05, bearer: 'subaccount' }] }),
    schema: () => ({
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ single: vi.fn().mockResolvedValue({ data: opts.order }) }),
            maybeSingle: vi.fn().mockResolvedValue({ data: opts.subaccount }),
            order: vi.fn().mockResolvedValue({ data: opts.items }),
            single: vi.fn().mockResolvedValue({ data: opts.order }),
          }),
        }),
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: vi.fn().mockResolvedValue({ data: { organisation_id: 'buyerOrg' } }) }) }) }) }) }),
  }
}

beforeEach(() => { invoke.mockReset(); (requireRole as any).mockResolvedValue({ ok: true, role: 'contractor' }) })

describe('initiateOrderPaymentAction', () => {
  it('rejects when the supplier subaccount is not linked (cannot accept payments)', async () => {
    ;(createClient as any).mockResolvedValue(clientWith({
      order: { id: 'o1', contractor_org_id: 'buyerOrg', supplier_id: 's1', payment_status: 'pending', payment_mode: 'pay_now' },
      items: [{ quantity: 1, unit_price: 100, tax_class: 'standard' }],
      subaccount: { subaccount_code: null, split_code: null, link_status: 'unlinked' },
    }))
    const res = await initiateOrderPaymentAction('o1')
    expect(res.error).toMatch(/payment setup/i)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects an already-paid order', async () => {
    ;(createClient as any).mockResolvedValue(clientWith({
      order: { id: 'o1', contractor_org_id: 'buyerOrg', supplier_id: 's1', payment_status: 'paid', payment_mode: 'pay_now' },
      items: [{ quantity: 1, unit_price: 100, tax_class: 'standard' }],
      subaccount: { subaccount_code: 'ACCT_x', split_code: 'SPL_x', link_status: 'linked' },
    }))
    const res = await initiateOrderPaymentAction('o1')
    expect(res.error).toMatch(/already paid/i)
  })

  it('computes totals server-side and returns the Paystack authorization URL', async () => {
    invoke.mockResolvedValue({ data: { authorizationUrl: 'https://checkout.paystack.com/abc', reference: 'ESITE-1' }, error: null })
    ;(createClient as any).mockResolvedValue(clientWith({
      order: { id: 'o1', contractor_org_id: 'buyerOrg', supplier_id: 's1', payment_status: 'pending', payment_mode: 'pay_now' },
      items: [{ quantity: 2, unit_price: 100, tax_class: 'standard' }], // R200 ex-VAT → R230 incl
      subaccount: { subaccount_code: 'ACCT_x', split_code: 'SPL_x', link_status: 'linked' },
    }))
    const res = await initiateOrderPaymentAction('o1')
    expect(res.authorizationUrl).toContain('checkout.paystack.com')
    expect(res.error).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- initiateOrderPayment`
Expected: FAIL — action module missing.

- [ ] **Step 3: Implement `initiateOrderPaymentAction`**

```ts
// apps/web/src/actions/marketplace-payment.actions.ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import {
  MARKETPLACE_BUYER_ROLES, computeOrderTotals, resolveCommission,
  randToCents, type TaxClass,
} from '@esite/shared'

/**
 * Prepare a pending_payment order for Paystack and return the checkout URL.
 * Server-computes totals from the persisted order_items (never trusts client
 * amounts); requires the supplier to have a linked subaccount; invokes the
 * marketplace-payment edge fn under the caller's JWT (its RLS load is the
 * ownership gate). The buyer role gate is enforced here as defence-in-depth.
 */
export async function initiateOrderPaymentAction(
  orderId: string,
): Promise<{ error?: string; authorizationUrl?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Caller's primary org (buyer side).
  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id').eq('user_id', user.id).eq('is_active', true).limit(1).single()
  if (!mem) return { error: 'No organisation found' }

  // Load the order scoped to the buyer org (ownership) — RLS also enforces this.
  const { data: order } = await supabase
    .schema('marketplace').from('orders')
    .select('id, contractor_org_id, supplier_id, payment_status, payment_mode, delivery_fee_cents')
    .eq('id', orderId).eq('contractor_org_id', mem.organisation_id).single()
  if (!order) return { error: 'Order not found' }

  const guard = await requireRole(supabase, order.contractor_org_id, MARKETPLACE_BUYER_ROLES)
  if (!guard.ok) return { error: 'Not authorised to pay for this order.' }

  if (order.payment_status === 'paid') return { error: 'This order is already paid.' }
  if (order.payment_mode !== 'pay_now') return { error: 'This order is not a pay-now order.' }

  // Supplier must be able to accept payments (linked or verified subaccount).
  const { data: sub } = await supabase
    .schema('marketplace').from('paystack_subaccounts')
    .select('subaccount_code, split_code, link_status')
    .eq('supplier_id', order.supplier_id).maybeSingle()
  if (!sub?.subaccount_code || sub.link_status === 'unlinked') {
    return { error: 'This supplier has not finished payment setup yet.' }
  }

  // Server-compute totals from the persisted (snapshot-priced) line items.
  const { data: items } = await supabase
    .schema('marketplace').from('order_items')
    .select('quantity, unit_price, tax_class').eq('order_id', orderId).order('created_at', { ascending: true })
  if (!items || items.length === 0) return { error: 'Order has no items.' }

  const { data: rateRows } = await supabase.rpc('get_commission_rate', { p_supplier_id: order.supplier_id })
  const { rate } = resolveCommission(Array.isArray(rateRows) ? rateRows[0] : rateRows)

  const totals = computeOrderTotals({
    lines: items.map((i: any) => ({
      qtyCents: randToCents(Number(i.unit_price) * Number(i.quantity)),
      taxClass: (i.tax_class ?? 'standard') as TaxClass,
    })),
    deliveryFeeCents: Number(order.delivery_fee_cents ?? 0),
    commissionRate: rate,
  })

  // Persist the authoritative amounts before charging.
  const { error: upErr } = await supabase
    .schema('marketplace').from('orders')
    .update({
      subtotal_ex_vat_cents: totals.subtotalExVatCents,
      vat_amount_cents: totals.vatAmountCents,
      total_incl_vat_cents: totals.totalInclVatCents,
      commission_base_cents: totals.commissionBaseCents,
      commission_rate: rate,
      commission_amount: totals.commissionCents / 100,
      total_amount: totals.totalInclVatCents / 100, // legacy rand column
      status: 'pending_payment',
    })
    .eq('id', orderId)
  if (upErr) return { error: upErr.message }

  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/marketplace-callback?orderId=${orderId}`
  const { data, error } = await supabase.functions.invoke('marketplace-payment', {
    body: { orderId, callbackUrl },
  })
  if (error) return { error: error.message ?? 'Could not start payment.' }
  const authorizationUrl = (data as { authorizationUrl?: string } | null)?.authorizationUrl
  if (!authorizationUrl) return { error: 'Payment provider did not return a checkout URL.' }
  return { authorizationUrl }
}
```

- [ ] **Step 4: Correct the `marketplace-payment` edge fn**

Make these precise edits to `apps/edge-functions/supabase/functions/marketplace-payment/index.ts`:

1. Rate from `commission_config`, cents amount, exact commission via flat `transaction_charge`. Replace the commission/amount block (current lines ~162–168) with:
```ts
    // Rate: DB single-source (supplier override > platform default). Fallback 0.05.
    const serviceSupabaseRate = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: rateRows } = await serviceSupabaseRate
      .schema('marketplace').rpc('get_commission_rate', { p_supplier_id: order.supplier_id })
    const rateRow = Array.isArray(rateRows) ? rateRows[0] : rateRows
    const commissionRate = rateRow ? Number(rateRow.rate) : 0.05

    // Amount == total_incl_vat_cents (== kobo for ZAR). Fallback to legacy rand.
    const totalKobo = order.total_incl_vat_cents != null
      ? Number(order.total_incl_vat_cents)
      : Math.round(Number(order.total_amount) * 100)

    // Commission is 5% of the EX-VAT goods base (persisted). Flat charge = exact.
    const commissionBase = order.commission_base_cents != null
      ? Number(order.commission_base_cents)
      : totalKobo // degrade to gross if pre-Phase-2 order
    const commissionKobo = Math.ceil(commissionBase * commissionRate)
    const supplierKobo = totalKobo - commissionKobo
```
Add `total_incl_vat_cents, commission_base_cents, supplier_id, supplier_org_id` to the order `.select(...)` (current lines ~132–138).

2. Fix the on-the-fly split fallback `bearer_type` (current line ~202): change `bearer_type: 'all'` → `bearer_type: 'subaccount'` and add `bearer_subaccount: sub.subaccount_code`.

3. Charge with `subaccount` + flat `transaction_charge` + `bearer` (exact commission) instead of the fixed-% `split_code`. In the `txPayload` (current lines ~225–247), after building `metadata`, replace the `if (splitCode) txPayload.split_code = splitCode` block with:
```ts
    // Prefer an exact per-transaction flat charge (commission on ex-VAT goods).
    // The supplier subaccount receives (total − commission); E-Site keeps the flat
    // transaction_charge. bearer 'subaccount' → supplier absorbs the Paystack fee.
    if (subaccountCode) {
      txPayload.subaccount = subaccountCode
      txPayload.transaction_charge = commissionKobo
      txPayload.bearer = 'subaccount'
    } else if (splitCode) {
      txPayload.split_code = splitCode // fallback: fixed-% split (commission on gross)
    }
```
where `subaccountCode` is captured alongside `splitCode` in the sub lookup (add `subaccount_code` to that `.select`, and hoist `let subaccountCode = order.subaccount_code ?? null` resolved from the same `paystack_subaccounts` read). Keep the metadata `commission_rate` and add `metadata.commission_base_kobo = commissionBase` so the webhook can reproduce the exact commission.

4. Update the DEFAULT comment header `DEFAULT_COMMISSION_RATE` (Phase 0 already set it to `0.05`) — leave as-is; the DB rate now wins.

- [ ] **Step 5: Set `payment_mode` + `pending_payment` in `placeOrderAction`**

In `apps/web/src/actions/supplier.actions.ts` `placeOrderAction`, add `payment_mode: 'pay_now'` to the order `.insert(...)` and change `status: 'submitted'` to `status: 'pending_payment'` (pay-now is now the default storefront path). Leave RFQ/on-account paths (Phase 1/Phase 4) unaffected. *(Coordination: if Phase 1 already replaced `placeOrderAction` with a unified checkout that sets these, skip this step — verify first.)*

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter web test -- initiateOrderPayment && pnpm --filter web type-check`
Expected: PASS. Edge-fn changes are type-checked by Deno separately (Step 7).

- [ ] **Step 7: Deno type-check the edge fn**

Run: `cd apps/edge-functions && deno check supabase/functions/marketplace-payment/index.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/actions/marketplace-payment.actions.ts apps/web/src/actions/__tests__/initiateOrderPayment.test.ts apps/edge-functions/supabase/functions/marketplace-payment/index.ts apps/web/src/actions/supplier.actions.ts
git commit -m "feat(marketplace): pay-now server action + exact-commission split charge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Pay-now UI + Paystack callback route

The key missing user-facing wiring: a **Pay now** button on the buyer order detail page that invokes the action and redirects to Paystack, and a callback route that verifies the transaction (belt-and-braces) and returns the buyer to the order page. The webhook remains the authoritative state change; the callback is UX only.

**Files:**
- Create: `apps/web/src/app/(admin)/marketplace/orders/[orderId]/PayNowButton.tsx` (client component)
- Modify: `apps/web/src/app/(admin)/marketplace/orders/[orderId]/page.tsx` (render the button + VAT breakdown)
- Create: `apps/web/src/app/api/paystack/marketplace-callback/route.ts`

- [ ] **Step 1: Build the Pay-now client component**

```tsx
// apps/web/src/app/(admin)/marketplace/orders/[orderId]/PayNowButton.tsx
'use client'
import { useState } from 'react'
import { initiateOrderPaymentAction } from '@/actions/marketplace-payment.actions'

export function PayNowButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setLoading(true); setError(null)
    const res = await initiateOrderPaymentAction(orderId)
    if (res.error) { setError(res.error); setLoading(false); return }
    if (res.authorizationUrl) { window.location.href = res.authorizationUrl; return }
    setError('Could not start payment.'); setLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button className="btn-primary-amber" onClick={pay} disabled={loading}
        style={{ padding: '12px 18px', textAlign: 'center' }}>
        {loading ? 'Starting secure checkout…' : '💳 Pay now'}
      </button>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Render the button + VAT breakdown on the order page**

In `orders/[orderId]/page.tsx`: import `PayNowButton`. Add `subtotal_ex_vat_cents, vat_amount_cents, total_incl_vat_cents, delivery_fee_cents, payment_mode` to the order select. In the totals panel, when the cents columns are populated show a breakdown (Subtotal (ex VAT) / Delivery / VAT 15% / **Total incl VAT**) using `formatZARFromCents` from `@esite/shared`; otherwise keep the legacy `formatZAR(order.total_amount)` row. Render `<PayNowButton orderId={orderId} />` when `order.payment_mode === 'pay_now' && order.payment_status === 'pending'`. Do **not** show the commission line to the buyer (commission is supplier-facing only — spec §5.2).

- [ ] **Step 3: Build the callback route**

```ts
// apps/web/src/app/api/paystack/marketplace-callback/route.ts
import { NextRequest, NextResponse } from 'next/server'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

// UX-only: verify the reference then bounce the buyer back to the order page.
// The webhook is the source of truth for `paid` + commission + inventory + email.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reference = searchParams.get('reference')
  const orderId = searchParams.get('orderId')
  const backBase = orderId ? `/marketplace/orders/${orderId}` : '/marketplace/orders'

  if (!reference || !PAYSTACK_SECRET) {
    return NextResponse.redirect(new URL(`${backBase}?payment=error`, req.url))
  }
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  })
  const body = await res.json()
  const ok = body?.status && body?.data?.status === 'success'
  return NextResponse.redirect(new URL(`${backBase}?payment=${ok ? 'success' : 'failed'}`, req.url))
}
```
On the order page, read `?payment=` and render a success/failed banner (payment reflects once the webhook lands — the banner should say "Payment received — finalising your order" on success to avoid a race where the webhook hasn't yet flipped `payment_status`).

- [ ] **Step 4: Verify end-to-end (test mode) + commit**

With the **run** skill + Paystack **test** keys and a test card: create a pending_payment order for a supplier with a linked subaccount, click **Pay now**, complete the test card, confirm the redirect lands on the order page with the success banner, and confirm (DB) the webhook flipped `payment_status='paid'` and wrote a `commission_records` row with `commission_kobo` == 5% of ex-VAT goods. (Webhook completion is Task 8; if running before Task 8, verify only the charge + redirect here and re-verify the full chain after Task 8.)
```bash
git add apps/web/src/app/\(admin\)/marketplace/orders/\[orderId\]/PayNowButton.tsx apps/web/src/app/\(admin\)/marketplace/orders/\[orderId\]/page.tsx apps/web/src/app/api/paystack/marketplace-callback/route.ts
git commit -m "feat(marketplace): Pay now button + Paystack callback + VAT breakdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Marketplace payment email templates

Build the transactional email set the payment flows fire (spec §10): buyer **payment receipt** (with a secure invoice link), **refund** (both parties), **dispute opened / resolved** (both parties). Templates live in the edge `_shared` folder (Deno) so both the webhook and the refund/dispute actions can render them consistently.

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-payment-receipt.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-refund.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-dispute.ts`
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (add the 4 new `type` cases)
- Test: `packages/shared/src/__tests__/marketplace/payment-emails.test.ts` (a mirror pure-render helper, unit-tested — see note)

> **Render-helper note.** The edge templates are Deno modules; to unit-test their pure text under vitest, add a mirrored pure builder in `@esite/shared` (`packages/shared/src/marketplace/payment-emails.ts`) that returns `{ subject, html }` from the same inputs, and have the edge templates import the field values / re-implement the identical string. Test the shared builder; keep the edge template a thin wrapper. (Same split used for `payment-day0-failed` etc.)

- [ ] **Step 1: Write the failing test for the shared email builders**

```ts
// packages/shared/src/__tests__/marketplace/payment-emails.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildPaymentReceiptEmail, buildRefundEmail, buildDisputeEmail,
} from '../../marketplace/payment-emails'

describe('marketplace payment emails', () => {
  it('receipt shows the order ref, total, and an invoice link', () => {
    const { subject, html } = buildPaymentReceiptEmail({
      orderShortId: 'A1B2C3D4', totalZAR: 'R 172,50',
      supplierName: 'Acme Electrical', invoiceUrl: 'https://www.e-site.live/inv/1',
    })
    expect(subject).toMatch(/payment received/i)
    expect(html).toContain('A1B2C3D4')
    expect(html).toContain('R 172,50')
    expect(html).toContain('https://www.e-site.live/inv/1')
  })
  it('refund email states the amount and whether partial', () => {
    const { subject, html } = buildRefundEmail({
      orderShortId: 'A1B2C3D4', amountZAR: 'R 50,00', partial: true, recipientRole: 'buyer',
    })
    expect(subject).toMatch(/refund/i)
    expect(html).toContain('R 50,00')
    expect(html).toMatch(/partial/i)
  })
  it('dispute email differs for opened vs resolved', () => {
    expect(buildDisputeEmail({ orderShortId: 'X', state: 'opened', reason: 'Damaged' }).subject).toMatch(/opened/i)
    expect(buildDisputeEmail({ orderShortId: 'X', state: 'resolved', reason: 'Refunded' }).subject).toMatch(/resolved/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails** → `pnpm --filter @esite/shared test -- payment-emails` → FAIL.

- [ ] **Step 3: Implement the shared builders**

```ts
// packages/shared/src/marketplace/payment-emails.ts
export function buildPaymentReceiptEmail(p: {
  orderShortId: string; totalZAR: string; supplierName: string; invoiceUrl: string
}): { subject: string; html: string } {
  return {
    subject: `Payment received — order #${p.orderShortId}`,
    html: `<h2>Payment received</h2>
<p>Thanks — your payment for order <strong>#${p.orderShortId}</strong> to ${p.supplierName} was successful.</p>
<p>Total paid: <strong>${p.totalZAR}</strong> (incl. VAT).</p>
<p><a class="btn" href="${p.invoiceUrl}">View tax invoice</a></p>`,
  }
}

export function buildRefundEmail(p: {
  orderShortId: string; amountZAR: string; partial: boolean; recipientRole: 'buyer' | 'supplier'
}): { subject: string; html: string } {
  const kind = p.partial ? 'A partial refund' : 'A full refund'
  return {
    subject: `Refund ${p.partial ? '(partial) ' : ''}— order #${p.orderShortId}`,
    html: `<h2>Refund processed</h2>
<p>${kind} of <strong>${p.amountZAR}</strong> has been processed for order <strong>#${p.orderShortId}</strong>.</p>
<p>${p.recipientRole === 'buyer' ? 'The amount will reflect on your card per your bank’s timelines.' : 'Your settlement for this order has been adjusted accordingly.'}</p>`,
  }
}

export function buildDisputeEmail(p: {
  orderShortId: string; state: 'opened' | 'resolved'; reason: string
}): { subject: string; html: string } {
  return {
    subject: `Dispute ${p.state} — order #${p.orderShortId}`,
    html: `<h2>Dispute ${p.state}</h2>
<p>A dispute on order <strong>#${p.orderShortId}</strong> was ${p.state}.</p>
<p>${p.state === 'opened' ? 'Reason' : 'Resolution'}: ${p.reason}</p>`,
  }
}
```

- [ ] **Step 4: Export + verify pass** — add `export * from './marketplace/payment-emails'` to the shared index; `pnpm --filter @esite/shared test -- payment-emails` → PASS.

- [ ] **Step 5: Add the 4 edge `send-email` types**

In `send-email/index.ts`, add cases `'marketplace-payment-receipt'`, `'marketplace-refund'`, `'marketplace-dispute-opened'`, `'marketplace-dispute-resolved'` that build `{ subject, html }` (re-using the identical strings — the thin Deno templates in the three new `_shared/email-templates/*` files) wrapped in the existing `baseTemplate(...)`, then `sendEmail({ to, subject, html })`. Follow the existing `type`-switch + payload shape.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/marketplace/payment-emails.ts packages/shared/src/__tests__/marketplace/payment-emails.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-payment-receipt.ts apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-refund.ts apps/edge-functions/supabase/functions/_shared/email-templates/marketplace-dispute.ts apps/edge-functions/supabase/functions/send-email/index.ts
git commit -m "feat(marketplace): payment/refund/dispute email templates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Webhook completion — inventory + invoice data + receipt email + refund events

The webhook already marks orders `paid` and writes an idempotent `commission_records` row. Complete the paid path (decrement inventory, persist tax-invoice **data** rows, fire the buyer receipt email — all guarded by the same idempotency gate) and add a `refund.processed`/`refund.failed` handler.

**Files:**
- Modify: `apps/edge-functions/supabase/functions/paystack-webhook/index.ts`
- Test: `packages/shared/src/__tests__/marketplace/inventory-decrement.test.ts` (pure helper)

> **Idempotency gate.** `handleChargeSuccess` already early-returns when a `commission_records` row exists for the reference. All new side effects (inventory, invoice rows, email) run **after** the successful commission insert, so they execute exactly once per reference. If any side effect throws, catch-and-log (do not re-throw) so Paystack is not driven to retry a charge that is already recorded.

- [ ] **Step 1: Extract + test a pure inventory-decrement planner**

```ts
// packages/shared/src/__tests__/marketplace/inventory-decrement.test.ts
import { describe, it, expect } from 'vitest'
import { planInventoryDecrements } from '../../marketplace/inventory'

describe('planInventoryDecrements', () => {
  it('only decrements tracked items and clamps at zero', () => {
    const plan = planInventoryDecrements([
      { catalogueItemId: 'a', quantity: 3, trackInventory: true, stockOnHand: 10 },
      { catalogueItemId: 'b', quantity: 5, trackInventory: false, stockOnHand: 2 },
      { catalogueItemId: 'c', quantity: 9, trackInventory: true, stockOnHand: 4 }, // oversell → clamp 0
      { catalogueItemId: null, quantity: 1, trackInventory: true, stockOnHand: 1 }, // free-text line ignored
    ])
    expect(plan).toEqual([
      { catalogueItemId: 'a', newStock: 7 },
      { catalogueItemId: 'c', newStock: 0 },
    ])
  })
})
```
Run: `pnpm --filter @esite/shared test -- inventory-decrement` → FAIL (module missing).

- [ ] **Step 2: Implement the planner + export**

```ts
// packages/shared/src/marketplace/inventory.ts
export interface InventoryLine {
  catalogueItemId: string | null
  quantity: number
  trackInventory: boolean
  stockOnHand: number
}
/** Pure: compute the new stock for each tracked, catalogue-linked line. */
export function planInventoryDecrements(
  lines: InventoryLine[],
): Array<{ catalogueItemId: string; newStock: number }> {
  const out: Array<{ catalogueItemId: string; newStock: number }> = []
  for (const l of lines) {
    if (!l.catalogueItemId || !l.trackInventory) continue
    out.push({ catalogueItemId: l.catalogueItemId, newStock: Math.max(0, l.stockOnHand - l.quantity) })
  }
  return out
}
```
Add `export * from './marketplace/inventory'` to the shared index. `pnpm --filter @esite/shared test -- inventory-decrement` → PASS.

- [ ] **Step 3: Complete `handleChargeSuccess` (edge fn)**

After the successful `commission_records` insert in `paystack-webhook/index.ts`, add (all best-effort, wrapped in try/catch that logs but does not re-throw):

1. **Inventory decrement.** Load `order_items(catalogue_item_id, quantity)` for the order, join `catalogue_items(id, track_inventory, stock_on_hand)`, apply the same `Math.max(0, stock − qty)` per tracked line (inline the planner logic — Deno can't import the workspace pkg), and `update` each `catalogue_items` row. *(Coordination: guarded by `track_inventory` existing — Phase 1. If the column is absent, the select simply skips; wrap in try/catch.)*
2. **Tax-invoice data rows.** Insert two `marketplace.tax_invoices` rows (Task 9's table) — `supplier_to_buyer` and `commission` — with amounts derived from `metadata.commission_base_kobo` + the order's persisted `*_cents` columns and a generated `invoice_number` (via the Task-9 numbering fn). `status='draft'` unless `MARKETPLACE_TAX_INVOICES_ENABLED` (Deno env) is set, in which case `status='issued'`, `issued_at=now()`. *(This step lands after Task 9 creates the table — order the subagent work so Task 9 precedes the invoice-row insert, or ship this sub-step in Task 9's commit.)*
3. **Buyer receipt email.** If `orders.receipt_sent_at` is null, invoke `send-email` (`type: 'marketplace-payment-receipt'`) to the order creator's email with `invoiceUrl = {SITE_URL}/api/marketplace/orders/{orderId}/tax-invoice/pdf?type=supplier`, then set `orders.receipt_sent_at = now()`. The null-check + set is the email idempotency gate.

- [ ] **Step 4: Add a refund webhook handler**

Add `handleRefundProcessed(supabase, data)` and route `case 'refund.processed'` / `case 'refund.failed'`: match `marketplace.refunds` by `paystack_refund_reference` (or the transaction reference), set `status='processed'|'failed'` + `processed_at`. Idempotent (only updates a matching pending row). This complements the admin-initiated refund action (Task 10) which creates the refund + optimistically updates the order.

- [ ] **Step 5: Deno type-check + commit**

Run: `cd apps/edge-functions && deno check supabase/functions/paystack-webhook/index.ts`
Expected: clean.
```bash
git add apps/edge-functions/supabase/functions/paystack-webhook/index.ts packages/shared/src/marketplace/inventory.ts packages/shared/src/__tests__/marketplace/inventory-decrement.test.ts packages/shared/src/index.ts
git commit -m "feat(marketplace): webhook inventory + invoice data + receipt email + refund events

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Tax invoices — schema + renderer + PDF route + generation

Two platform-issued documents per paid order (spec §6.3/§10, decision R5): a **supplier→buyer tax invoice** (supplier as seller-of-record, supplier VAT number) and a separate **E-Site→supplier commission tax invoice** (E-Site VAT number, 5% commission + VAT on commission). Capture all data + build generation now; **actual issuance is gated on `MARKETPLACE_TAX_INVOICES_ENABLED`** until accountant sign-off — draft renders carry a "NOT A VALID TAX INVOICE" watermark.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00193_marketplace_tax_invoices.sql`
- Create: `apps/web/src/lib/marketplace/render-tax-invoice.ts` (pdf-lib renderer, mirrors `db-legend`)
- Test: `apps/web/src/lib/marketplace/render-tax-invoice.test.ts`
- Create: `apps/web/src/app/api/marketplace/orders/[orderId]/tax-invoice/pdf/route.ts` (RLS-gated GET)

- [ ] **Step 1: Write the migration (table + numbering fn + bucket + RLS)**

```sql
-- apps/edge-functions/supabase/migrations/00193_marketplace_tax_invoices.sql
-- Platform-issued tax invoices: supplier→buyer + E-Site→supplier commission.
CREATE TABLE IF NOT EXISTS marketplace.tax_invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
  invoice_type         TEXT NOT NULL CHECK (invoice_type IN ('supplier_to_buyer','commission')),
  invoice_number       TEXT NOT NULL,
  issuer_org_id        UUID,                 -- supplier org, or E-Site (WM-Consulting) for commission
  issuer_vat_number    TEXT,
  recipient_org_id     UUID,
  recipient_vat_number TEXT,
  subtotal_ex_vat_cents BIGINT NOT NULL,
  vat_rate             NUMERIC(5,4) NOT NULL DEFAULT 0.1500,
  vat_amount_cents     BIGINT NOT NULL,
  total_incl_vat_cents BIGINT NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'ZAR',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void')),
  issued_at            TIMESTAMPTZ,
  pdf_path             TEXT,                 -- storage object path once rendered/stored
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, invoice_type)
);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_order ON marketplace.tax_invoices(order_id);

-- Per-issuer monotonic invoice numbers via a counters table + SECURITY DEFINER fn.
CREATE TABLE IF NOT EXISTS marketplace.invoice_counters (
  issuer_key TEXT PRIMARY KEY,   -- e.g. 'supplier:<org>' or 'esite'
  last_seq   BIGINT NOT NULL DEFAULT 0
);
CREATE OR REPLACE FUNCTION marketplace.next_invoice_number(p_issuer_key TEXT, p_prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = marketplace AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO marketplace.invoice_counters (issuer_key, last_seq) VALUES (p_issuer_key, 1)
    ON CONFLICT (issuer_key) DO UPDATE SET last_seq = marketplace.invoice_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;
  RETURN p_prefix || '-' || to_char(NOW(), 'YYYY') || '-' || lpad(v_seq::text, 6, '0');
END $$;

-- Invoice PDF storage bucket (private; served via the RLS-gated route only).
INSERT INTO storage.buckets (id, name, public)
SELECT 'marketplace-invoices', 'marketplace-invoices', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketplace-invoices');

-- RLS: buyer + supplier parties may read their order's invoices; writes service-role.
ALTER TABLE marketplace.tax_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_invoices_read ON marketplace.tax_invoices;
CREATE POLICY tax_invoices_read ON marketplace.tax_invoices
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM marketplace.orders o
      WHERE o.id = tax_invoices.order_id
        AND (o.contractor_org_id = ANY (public.get_user_org_ids())
             OR o.supplier_org_id = ANY (public.get_user_org_ids()))
    )
  );

GRANT EXECUTE ON FUNCTION marketplace.next_invoice_number(TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
```
*(Confirm the helper name `public.get_user_org_ids()` exists — it is referenced by the Phase-0 orders RLS. If the repo uses a different helper, mirror the exact expression the orders SELECT policy uses.)*

- [ ] **Step 2: Write the failing renderer test**

```ts
// apps/web/src/lib/marketplace/render-tax-invoice.test.ts
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderTaxInvoicePdf, type TaxInvoicePayload } from './render-tax-invoice'

const base: TaxInvoicePayload = {
  invoiceType: 'supplier_to_buyer',
  invoiceNumber: 'ACME-2026-000001',
  issuer: { name: 'Acme Electrical', vatNumber: '4123456789', addressLines: ['1 Main Rd', 'Cape Town'] },
  recipient: { name: 'BuildCo', vatNumber: '4987654321', addressLines: ['2 Site Ave'] },
  issuedAt: '2026-07-13',
  currency: 'ZAR',
  lines: [{ description: 'Cable 4mm²', qty: 100, unitPriceExVatCents: 5000, taxClass: 'standard' }],
  subtotalExVatCents: 500000,
  vatRate: 0.15,
  vatAmountCents: 75000,
  totalInclVatCents: 575000,
  draftWatermark: false,
}

describe('renderTaxInvoicePdf', () => {
  it('renders a single A4 page for an issued supplier→buyer invoice', async () => {
    const bytes = await renderTaxInvoicePdf(base)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(595.28, 1)
    expect(height).toBeCloseTo(841.89, 1)
  })
  it('renders a commission invoice variant', async () => {
    const bytes = await renderTaxInvoicePdf({ ...base, invoiceType: 'commission', invoiceNumber: 'ESITE-2026-000001' })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  it('produces a draft (watermarked) render without throwing', async () => {
    const bytes = await renderTaxInvoicePdf({ ...base, draftWatermark: true })
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})
```
Run: `pnpm --filter web test -- render-tax-invoice` → FAIL.

- [ ] **Step 3: Implement the renderer**

Build `renderTaxInvoicePdf(payload): Promise<Uint8Array>` in `render-tax-invoice.ts` following the `db-legend/render-legend-card.ts` exemplar exactly (A4 portrait 595.28×841.89, embedded Helvetica + Helvetica-Bold, absolute coordinates): header block ("TAX INVOICE" + invoice number + date), issuer + recipient blocks (name, VAT number, address lines), a line-items table (description / qty / unit ex-VAT / line ex-VAT), a totals block (Subtotal ex VAT / VAT @ 15% / **Total incl VAT** via `formatZARFromCents`), a footer (currency, "E-Site marketplace facilitated"). When `draftWatermark` is true, stamp a large diagonal light-grey "NOT A VALID TAX INVOICE" across the page. Export the `TaxInvoicePayload` interface used by the test. Keep the function pure (no I/O; caller supplies pre-formatted `issuedAt`).
Run: `pnpm --filter web test -- render-tax-invoice` → PASS.

- [ ] **Step 4: Build the RLS-gated PDF route**

`app/api/marketplace/orders/[orderId]/tax-invoice/pdf/route.ts` (mirror the `tenant-schedule/legend-card/pdf` route): cookie client; `?type=supplier|commission`. RLS-gated read of the order (+ its `tax_invoices` row + supplier/buyer org details for issuer/recipient blocks) doubles as the access gate — no row ⇒ 404. Compose the `TaxInvoicePayload` from the persisted invoice row + order + supplier/buyer profiles; set `draftWatermark = process.env.MARKETPLACE_TAX_INVOICES_ENABLED !== 'true' || invoiceRow.status !== 'issued'`. Return `application/pdf` with `Content-Disposition: attachment`. `export const runtime = 'nodejs'`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter web test -- render-tax-invoice && pnpm --filter web type-check && pnpm --filter web lint` → PASS. Then with the **run** skill, hit the route for a paid test order and eyeball both invoice types (draft watermark visible while the flag is off).
```bash
git add apps/edge-functions/supabase/migrations/00193_marketplace_tax_invoices.sql apps/web/src/lib/marketplace/render-tax-invoice.ts apps/web/src/lib/marketplace/render-tax-invoice.test.ts "apps/web/src/app/api/marketplace/orders/[orderId]/tax-invoice/pdf/route.ts"
git commit -m "feat(marketplace): tax invoices — schema, pdf renderer, gated route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Refunds & disputes — schema + actions + Paystack refund + emails

Manual admin-mediated flow (spec §6.3, assumption A4). A buyer opens a dispute; an admin mediates and issues a full/partial Paystack refund; the order's `payment_status`, `commission_records`, and inventory are reconciled; both parties are emailed.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00194_marketplace_disputes_refunds.sql`
- Modify: `packages/db/src/services/payment.service.ts` (add `createRefund`)
- Create: `apps/web/src/actions/marketplace-disputes.actions.ts` (`openDisputeAction`, `resolveDisputeAction`, `refundOrderAction`)
- Test: `packages/db/src/services/__tests__/payment.service.refund.test.ts`
- Test: `apps/web/src/actions/__tests__/refundOrder.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00194_marketplace_disputes_refunds.sql
CREATE TABLE IF NOT EXISTS marketplace.order_disputes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
  raised_by        UUID NOT NULL REFERENCES public.profiles(id),
  raised_by_org_id UUID NOT NULL REFERENCES public.organisations(id),
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','rejected')),
  resolution_notes TEXT,
  resolved_by      UUID REFERENCES public.profiles(id),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_order_disputes_order ON marketplace.order_disputes(order_id);

CREATE TABLE IF NOT EXISTS marketplace.refunds (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
  dispute_id               UUID REFERENCES marketplace.order_disputes(id),
  amount_cents             BIGINT NOT NULL CHECK (amount_cents > 0),
  is_partial               BOOLEAN NOT NULL DEFAULT FALSE,
  reason                   TEXT,
  paystack_refund_reference TEXT UNIQUE,     -- idempotency
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  created_by               UUID NOT NULL REFERENCES public.profiles(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON marketplace.refunds(order_id);

-- RLS: parties (buyer + supplier) read; buyer may INSERT a dispute; refunds +
-- dispute resolution are service-role writes (admin actions use service client).
ALTER TABLE marketplace.order_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disputes_read ON marketplace.order_disputes;
CREATE POLICY disputes_read ON marketplace.order_disputes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM marketplace.orders o WHERE o.id = order_disputes.order_id
    AND (o.contractor_org_id = ANY (public.get_user_org_ids()) OR o.supplier_org_id = ANY (public.get_user_org_ids())))
);
DROP POLICY IF EXISTS disputes_insert ON marketplace.order_disputes;
CREATE POLICY disputes_insert ON marketplace.order_disputes FOR INSERT TO authenticated WITH CHECK (
  raised_by_org_id = ANY (public.get_user_org_ids())
  AND public.user_org_role(raised_by_org_id) IS DISTINCT FROM 'client_viewer'
  AND EXISTS (SELECT 1 FROM marketplace.orders o WHERE o.id = order_disputes.order_id
    AND o.contractor_org_id = raised_by_org_id)
);
DROP POLICY IF EXISTS refunds_read ON marketplace.refunds;
CREATE POLICY refunds_read ON marketplace.refunds FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM marketplace.orders o WHERE o.id = refunds.order_id
    AND (o.contractor_org_id = ANY (public.get_user_org_ids()) OR o.supplier_org_id = ANY (public.get_user_org_ids())))
);

NOTIFY pgrst, 'reload schema';
```
*(Confirm `public.user_org_role(uuid)` exists — it is referenced by Phase-0's orders RLS hardening (Task 5 of Phase 0). If Phase 0 introduced a different helper, mirror it.)*

- [ ] **Step 2: Add `createRefund` to the Paystack service (failing test first)**

```ts
// packages/db/src/services/__tests__/payment.service.refund.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PaystackService } from '../payment.service'
afterEach(() => vi.restoreAllMocks())

describe('PaystackService.createRefund', () => {
  it('POSTs the transaction reference + amount in kobo', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ status: true, message: 'ok', data: { id: 1, status: 'pending', transaction: { reference: 'ESITE-1' } } }),
      { status: 200 }))
    const svc = new PaystackService('sk_test_x')
    const res = await svc.createRefund({ reference: 'ESITE-1', amountKobo: 5000 })
    expect(res.status).toBe('pending')
    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ transaction: 'ESITE-1', amount: 5000 })
  })
})
```
Run: `pnpm --filter @esite/db test -- payment.service.refund` → FAIL.

- [ ] **Step 3: Implement `createRefund`**

Add to `PaystackService`:
```ts
  /**
   * Refund a transaction, fully or partially. Paystack recovers a subaccount
   * transaction's refund proportionally per its settlement rules.
   * Paystack: POST /refund { transaction, amount }
   */
  async createRefund(params: { reference: string; amountKobo: number }): Promise<{ id: number; status: string }> {
    return this.request<{ id: number; status: string }>('POST', '/refund', {
      transaction: params.reference,
      amount: params.amountKobo,
    })
  }
```
Run: `pnpm --filter @esite/db test -- payment.service.refund` → PASS.

- [ ] **Step 4: Write the failing `refundOrderAction` test**

```ts
// apps/web/src/actions/__tests__/refundOrder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireRoleAPI: vi.fn(), requireRole: vi.fn() }))
vi.mock('@esite/db', () => ({ getPaystackService: vi.fn() }))

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { getPaystackService } from '@esite/db'
import { refundOrderAction } from '../marketplace-disputes.actions'

beforeEach(() => {
  ;(requireRole as any).mockResolvedValue({ ok: true, role: 'owner' })
  ;(getPaystackService as any).mockReturnValue({ createRefund: vi.fn().mockResolvedValue({ id: 1, status: 'pending' }) })
})

describe('refundOrderAction', () => {
  it('rejects a non-admin caller', async () => {
    ;(requireRole as any).mockResolvedValue({ ok: false, error: 'nope' })
    ;(createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: vi.fn().mockResolvedValue({ data: { organisation_id: 'esite' } }) }) }) }) }) }),
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'o1', payment_status: 'paid', paystack_reference: 'ESITE-1', total_incl_vat_cents: 57500 } }) }) }) }) }) }),
    })
    const res = await refundOrderAction({ orderId: 'o1', amountCents: 5000, reason: 'x' })
    expect(res.error).toBeTruthy()
  })

  it('rejects refunding more than the order total', async () => {
    ;(createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: vi.fn().mockResolvedValue({ data: { organisation_id: 'esite' } }) }) }) }) }) }),
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'o1', payment_status: 'paid', paystack_reference: 'ESITE-1', total_incl_vat_cents: 57500 } }) }) }) }) }) }),
    })
    const res = await refundOrderAction({ orderId: 'o1', amountCents: 99999999, reason: 'x' })
    expect(res.error).toMatch(/exceeds/i)
  })
})
```
Run: `pnpm --filter web test -- refundOrder` → FAIL.

- [ ] **Step 5: Implement the dispute + refund actions**

`marketplace-disputes.actions.ts` (`'use server'`):
- `openDisputeAction(formData)` — buyer-gated (`MARKETPLACE_BUYER_ROLES` on the order's `contractor_org_id`, resolved from the order); insert `order_disputes` (`status='open'`); set `orders.status='disputed'`; email supplier + admin (`marketplace-dispute-opened`).
- `resolveDisputeAction({ disputeId, resolution, notes })` — **admin-gated** (`OWNER_ADMIN` on the E-Site/WM-Consulting org via `requireRole`); update dispute `status='resolved'|'rejected'`; email both parties (`marketplace-dispute-resolved`).
- `refundOrderAction({ orderId, amountCents, reason, disputeId? })` — **admin-gated**; load the paid order (must be `payment_status IN ('paid','partially_refunded')`); reject `amountCents > total_incl_vat_cents − alreadyRefunded` ("exceeds"); call `getPaystackService().createRefund({ reference: order.paystack_reference, amountKobo: amountCents })`; insert a `marketplace.refunds` row (`is_partial = amountCents < total_incl_vat_cents`, `paystack_refund_reference` from Paystack response) using a **service client** (RLS is service-role-write); update `orders.payment_status` → `refunded` (full) or `partially_refunded` (partial) and `status` accordingly; update the order's `commission_records.payout_status='refunded'` (proportional note — the split reverses proportionally per Paystack); **restock inventory** by re-incrementing the tracked `catalogue_items.stock_on_hand` for the order's items on a **full** refund (partial refunds do not auto-restock — admin decides); email both parties (`marketplace-refund`). The webhook `refund.processed` handler (Task 8) later flips the `refunds` row to `processed`.

Guard every mutation; **server-computes** the refund cap; never trust a client `amountCents` beyond the DB-derived ceiling.

- [ ] **Step 6: (Buyer) minimal dispute affordance**

Add a small "Report a problem" form on the buyer order page for `delivered`/`paid` orders that posts `openDisputeAction`. (Full dispute UX + admin console is Phase 5; this is the minimum to exercise the flow.)

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @esite/db test && pnpm --filter web test -- refundOrder && pnpm --filter web type-check && pnpm --filter web lint` → PASS. Then with the **run** skill (test mode): pay an order, open a dispute, issue a partial refund, and confirm `refunds`/`payment_status='partially_refunded'`/emails.
```bash
git add apps/edge-functions/supabase/migrations/00194_marketplace_disputes_refunds.sql packages/db/src/services/payment.service.ts packages/db/src/services/__tests__/payment.service.refund.test.ts apps/web/src/actions/marketplace-disputes.actions.ts apps/web/src/actions/__tests__/refundOrder.test.ts
git commit -m "feat(marketplace): refunds + disputes (admin-mediated) + Paystack refund

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Payment-security review + RBAC matrix + Phase-2 verification sweep

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Itemise every Phase-2 route/action in the matrix**

Add rows (with the correct role groups): pages/routes — `POST /api/paystack/subaccount` (`SUPPLIER_PORTAL_ROLES`), `GET /api/paystack/marketplace-callback` (authenticated buyer; UX only), `GET /api/marketplace/orders/[orderId]/tax-invoice/pdf` (order party read — buyer/supplier of the order); actions — `initiateOrderPaymentAction` (`MARKETPLACE_BUYER_ROLES` + order ownership), `openDisputeAction` (`MARKETPLACE_BUYER_ROLES`), `resolveDisputeAction` + `refundOrderAction` (`OWNER_ADMIN` of E-Site). Note the `MARKETPLACE_TAX_INVOICES_ENABLED` issuance flag + the `NEXT_PUBLIC_PHASE_2_MARKETPLACE` flag footnotes. Confirm the edge fns (`marketplace-payment` requires user JWT; `paystack-webhook` requires HMAC signature) are documented as service-surfaces.

- [ ] **Step 2: Payment-security checklist (evidence required)**

Verify and record evidence for each:
- **Webhook signature** — `paystack-webhook` verifies HMAC SHA-512 (timing-safe `crypto.subtle.verify`) before any processing. ✔ existing; re-confirm the refund cases are inside the verified path.
- **Idempotency** — charge path keyed on `commission_records.paystack_reference` UNIQUE; refund path keyed on `refunds.paystack_refund_reference` UNIQUE; receipt email keyed on `orders.receipt_sent_at`. Confirm all three.
- **Server-computed money** — the charge amount = persisted `total_incl_vat_cents`; commission = `Math.ceil(commission_base_cents × rate)` from `commission_config`; refund cap = DB-derived. No client-supplied amount is trusted. Grep the pay-now + refund paths to prove no client amount reaches Paystack.
- **Ownership + role gates** — `initiateOrderPaymentAction` + order RLS; subaccount route `SUPPLIER_PORTAL_ROLES` + org-ownership; refund/dispute-resolve `OWNER_ADMIN`. 
- **RLS** — new tables (`commission_config`, `tax_invoices`, `order_disputes`, `refunds`) have policies; payment/commission tables stay service-role-write; `tax_invoices`/`refunds`/`disputes` reads are party-scoped.
- **Audit trail** — every state change writes a timestamped row (`commission_records`, `refunds`, `order_disputes`, `tax_invoices`, `orders.receipt_sent_at`/`paid_at`).
- **Split correctness** — exact-commission `transaction_charge` path; `bearer: subaccount`; on-the-fly split fallback `bearer_type` fixed to `subaccount`.

- [ ] **Step 3: Phase-2 completeness checks**

- `pnpm --filter @esite/shared test && pnpm --filter @esite/db test && pnpm --filter web test` → all green.
- `turbo run type-check lint` → clean; `cd apps/edge-functions && deno check supabase/functions/marketplace-payment/index.ts supabase/functions/paystack-webhook/index.ts` → clean.
- Grep confirms no remaining `bearer_type: 'all'` and no `0.06`/hardcoded-6% in the payment path; `DEFAULT_COMMISSION_RATE` is `0.05` and the DB rate wins.
- Migrations `00190`–`00194` are sequential, each ends with `NOTIFY pgrst` (no schema `CREATE`/`DROP` ⇒ no PostgREST `db_schema` PATCH needed; the `marketplace-invoices` bucket is via `storage.buckets` insert). None hand-applied — they auto-apply on merge.

- [ ] **Step 4: Phase gate — reviews**

Run `superpowers:requesting-code-review` on the branch; run **security-review** + **security-audit** (mandatory for payment phases per the index §4 — webhook signature/idempotency, split correctness, RLS, ownership, refund cap); recommend the user run `/code-review ultra`. Then `simplify` on the diff, then `superpowers:finishing-a-development-branch`.

- [ ] **Step 5: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise marketplace Phase-2 payment routes/actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** Task 1↔§5.2/§5.4/§9 (orders payment/VAT/status columns); Task 2↔§6.5 (commission single source); Task 3↔§5.2/§6.1 (server-computed totals + 5%-of-ex-VAT commission); Task 4↔§2.3/§6.1 (split_code creation + real `is_verified` states + verification); Task 5↔§5.2#4/§6.1 (wire `marketplace-payment` caller + exact split + `bearer: subaccount`); Task 6↔§2 (the missing "Pay now" UI + callback); Task 7↔§10 (payment/refund/dispute emails); Task 8↔§5.2#4/§6.1 (webhook → paid/commission/inventory + receipt email, idempotent); Task 9↔§6.3/§10, R5 (supplier→buyer + E-Site commission tax invoices, issuance behind the flag); Task 10↔§6.3/A4 (manual refunds & disputes, proportional split reversal); Task 11↔§11 (payment security + RBAC matrix + review gates).
- **Decision defaults:** R1 (auto-split settlement — no E-Site transfers built; `transfer.*` handlers stay dormant), R5 (capture-all + `MARKETPLACE_TAX_INVOICES_ENABLED` gate + draft watermark), and the `transaction_charge` exact-commission choice are each stated with their one-line alternative. Paystack live-KYC (R6) is called out as the sole external blocker; everything builds/tests in TEST mode.
- **Cross-phase coordination (assumptions surfaced):** depends on Phase 0 (commission 5% constant + `bearer: subaccount` in `payment.service.createSplit`, money helper `randToCents`/`formatZARFromCents`, `MARKETPLACE_BUYER_ROLES`/`SUPPLIER_PORTAL_ROLES`, orders RLS `public.get_user_org_ids()`/`public.user_org_role()` helpers, `commission.test.ts` at 5%) and Phase 1 (persistent cart + a checkout that creates orders, `resolvePrice` snapshot onto `order_items`, `catalogue_items.track_inventory`/`stock_on_hand`, `order_items.tax_class`). All Phase-1-owned columns are re-declared with `ADD COLUMN IF NOT EXISTS`, so the migrations are safe if Phase 1's shape differs. If Phase 1 already replaced `placeOrderAction` with a unified checkout, Task 5 Step 5 is skipped after verification.
- **Placeholders:** none. Steps that say "confirm the constraint/helper name first" (Task 1 Step 1, Task 9/10 RLS-helper confirmations) and "read a sibling test first" (action mocks) are deliberate verification steps, not deferred work. The one intra-phase ordering coupling (Task 8's invoice-row insert needs Task 9's table) is flagged inline with the fix (land that sub-step in Task 9's commit or order the subagents 9→8-completion).
- **Migrations:** `00190`–`00194`, sequential, in range, each `NOTIFY pgrst`; bucket via `storage.buckets` insert; no schema-level `CREATE`/`DROP` so no PostgREST `db_schema` PATCH; auto-apply on merge.
- **Type/name consistency:** `computeOrderTotals`/`VAT_RATE`/`resolveCommission`/`DEFAULT_COMMISSION`/`planInventoryDecrements`/`buildPaymentReceiptEmail`/`renderTaxInvoicePdf`/`initiateOrderPaymentAction`/`refundOrderAction`/`createRefund`/`resolveAccount` are referenced under the exact names they are defined with, and imported from `@esite/shared` / `@esite/db` per the repo's barrel exports.
