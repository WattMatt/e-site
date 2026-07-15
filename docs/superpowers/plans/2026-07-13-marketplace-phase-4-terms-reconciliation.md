# Marketplace Phase 4 — On-account / Terms + Commission Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Inherit all conventions** from [`2026-07-13-marketplace-implementation-index.md`](./2026-07-13-marketplace-implementation-index.md): dedicated worktree off `origin/main`; migrations **auto-apply on merge** (`deploy-migrations.yml` runs `supabase db push` — do **NOT** hand-apply via the Management API); vitest gates per task; `docs/rbac-matrix.md` updated in the same change; money = integer cents via the `@esite/shared` helper; role groups imported from `@esite/shared` (never hardcode role strings); commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Goal:** Let a supplier sell on credit terms (no Paystack charge at checkout) while E-Site still earns its 5% commission — collected via a **monthly commission statement** to the supplier for the ex-VAT value of terms orders settled that month. Plus the settlement/payout notification emails that are missing today (they also serve Phase 2 pay-now auto-split).

**Spec:** [`../specs/2026-07-13-marketplace-target-spec.md`](../specs/2026-07-13-marketplace-target-spec.md) — §5.2 (on-account checkout), §6.2 (settlement/payout emails), §6.4 (on-account commission reconciliation), §6.5 (commission config), §10 (email matrix rows: *Payout / settlement*, *Payout failed*, *Monthly commission statement*).

**Depends on (forward references — treat as already built):**
- **Phase 1** — `marketplace.supplier_settings` (payment modes offered, default terms, auto-accept).
- **Phase 2** — pay-now checkout; `marketplace.orders.payment_mode` (`pay_now | on_account`); tax columns on `marketplace.orders` (`subtotal_ex_vat`, `vat_amount`, `total_incl_vat` — **integer cents**, per the index money rule); `marketplace.tax_invoices` (platform-issued supplier→buyer invoices + E-Site commission invoices); `marketplace.commission_config` (single-source rate, default **5%**, optional per-supplier override) and its reader `marketplace.commission_rate_for_supplier(uuid)`.

**Real code this phase builds on (verified):**
- `suppliers.organisation_suppliers` (`00005_suppliers_schema.sql`) — `contractor_org_id`, `supplier_id`, `account_number`, `credit_limit NUMERIC(12,2)`, `currency`, `payment_terms_days INTEGER`, `is_preferred`, `UNIQUE (contractor_org_id, supplier_id)`.
- `marketplace.orders` (`00005`) — `contractor_org_id`, `supplier_org_id`, `supplier_id`, `status`, `payment_status`, `paid_at`, `created_by`.
- `marketplace.commission_records` / `marketplace.commission_payouts` (`00016_commission_paystack.sql`) — kobo ledger; `payout_status IN ('pending','processing','paid','failed','refunded')`; written by the `paystack-webhook` edge fn (`transfer.success` → `paid`, `transfer.failed` → `failed`).
- Role helpers `apps/web/src/lib/auth/require-role.ts` — `requireRole(supabase, orgId, roles) → {ok:true,role}|{ok:false,error}`, `requireRoleAPI`, `requireRolePage`. Groups `SUPPLIER_PORTAL_ROLES` + `MARKETPLACE_BUYER_ROLES` from `@esite/shared` (Phase 0).
- Money helper `@esite/shared` — `randToCents`, `centsToRand`, `formatZARFromCents`, `addCents` (Phase 0).
- Email infra — `send-email` edge fn (Resend; `type` + `payload` body, service-role gated) with HTML templates in `apps/edge-functions/supabase/functions/_shared/email-templates/*` extending `base.ts`.
- Scheduled-job pattern — `cloud-sync-cron` edge fn driven by `pg_cron` (`cron.schedule` + `net.http_post` + `current_setting('app.settings.service_role_key', true)`), see `00148_floor_plan_versions_cloud_sync.sql`.
- PDF pattern — pure renderer `apps/web/src/lib/db-legend/render-legend-card.ts` (pdf-lib) served by a Next route (`api/tenant-schedule/legend-card/pdf/route.ts`) with a co-located test.

---

## Decision R2 (applied) — on-account commission collection

**Default (this plan): monthly E-Site commission statement to the supplier.** Each month E-Site raises a statement to the supplier for **5% of the ex-VAT value of terms orders marked settled that month**. Settlement signal = the supplier self-marks the order buyer-paid (§Task 4), optionally corroborated by a buyer confirmation. The statement doubles as E-Site's commission tax invoice to the supplier (subject to R5 sign-off — invoice numbering gated, data captured regardless).

Alternatives (not chosen, noted for the record):
- **Trusted-buyer-only terms** — restrict on-account to whitelisted buyer relationships and force everyone else to pay-now; cheapest to build, no reconciliation, but limits terms adoption.
- **Supplier-remits-on-settlement** — supplier pushes E-Site's 5% via a Paystack charge the moment they mark an order settled; real-time cash-flow but more moving parts per settlement and a payment surface on every settle.

---

## Migration range: **00210 – 00215** (6 files, in `apps/edge-functions/supabase/migrations/`)

| # | File | Purpose | PostgREST |
|---|---|---|---|
| 00210 | `00210_orders_terms_settlement.sql` | Terms/settlement columns on `marketplace.orders` | `NOTIFY pgrst` |
| 00211 | `00211_organisation_suppliers_terms_rls.sql` | `on_account_enabled` + supplier UPDATE RLS on `organisation_suppliers` | `NOTIFY pgrst` |
| 00212 | `00212_supplier_commission_statements.sql` | `supplier_commission_statements` (+ lines) tables + RLS | `NOTIFY pgrst` |
| 00213 | `00213_commission_statement_fns.sql` | `build_commission_statements()` + `supplier_buyer_outstanding_cents()` SECURITY DEFINER fns | `NOTIFY pgrst` |
| 00214 | `00214_tax_invoices_terms.sql` | Terms columns on Phase-2 `tax_invoices` + R5 gate flag | `NOTIFY pgrst` |
| 00215 | `00215_commission_run_cron.sql` | `pg_cron` monthly schedule (informational block) | — |

All six touch existing schemas (`marketplace`, `suppliers`) — no `CREATE SCHEMA`, so only `NOTIFY pgrst, 'reload schema'` is required (no PostgREST `db_schema` PATCH).

---

## File-structure map

```
packages/shared/src/
  marketplace/
    credit-terms.ts                      NEW  pure: evaluateCreditLimit, computeTermsDueDate
    render-commission-statement.ts       NEW  pure: renderCommissionStatementPdf (pdf-lib)
  __tests__/marketplace/
    credit-terms.test.ts                 NEW
    render-commission-statement.test.ts  NEW
  index.ts                               EDIT export the two modules

apps/web/src/
  actions/
    terms.actions.ts                     NEW  placeOnAccountOrderAction, setBuyerTermsAction,
                                              raiseTermsInvoiceAction, markTermsOrderSettledAction,
                                              confirmTermsPaymentAction
    __tests__/terms.actions.test.ts      NEW  role-gate + credit-limit + settlement tests
  app/(marketplace)/
    supplier/terms/page.tsx              NEW  supplier: per-buyer terms + credit-limit management
    supplier/payouts/statements/page.tsx NEW  supplier: monthly statements list
    supplier/payouts/statements/[id]/page.tsx NEW supplier: one statement + Download PDF
    checkout/OnAccountOption.tsx         NEW  buyer: "Buy on account (N days)" checkout branch
    orders/[id]/SettlementPanel.tsx      NEW  supplier mark-settled / buyer confirm-paid
  app/api/marketplace/commission-statement/pdf/route.ts        NEW  GET statement PDF (RLS-gated)
  app/api/marketplace/commission-statement/pdf/route.test.ts   NEW
  lib/marketplace/terms.ts               NEW  server helpers (outstanding, due-date, tax-invoice R5 flag read)

apps/edge-functions/supabase/functions/
  marketplace-commission-run/index.ts    NEW  monthly job: build statements + email each supplier
  _shared/email-templates/
    commission-statement.ts              NEW  monthly statement email
    payout-settled.ts                    NEW  settlement/payout notice
    payout-failed.ts                     NEW  payout-failed alert (+ admin copy)
  send-email/index.ts                    EDIT add 3 marketplace types
  paystack-webhook/index.ts              EDIT emit payout-settled / payout-failed on transfer.*

apps/edge-functions/supabase/migrations/
  00210_orders_terms_settlement.sql            NEW
  00211_organisation_suppliers_terms_rls.sql   NEW
  00212_supplier_commission_statements.sql     NEW
  00213_commission_statement_fns.sql           NEW
  00214_tax_invoices_terms.sql                 NEW
  00215_commission_run_cron.sql                NEW

docs/rbac-matrix.md                      EDIT add Phase-4 routes/actions
```

**Everything stays behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE`.** Terms features additionally read the supplier's `supplier_settings.payment_modes` — a supplier who does not offer on-account never sees the branch.

---

## Task 1: On-account checkout path (credit-limit + due date, no Paystack charge)

Spec §5.2 step 5. When a supplier offers `on_account` **and** the buyer relationship allows it, create the order `payment_mode='on_account'` at status `accepted` with **no** Paystack charge; enforce `credit_limit`; set `terms_due_date` from `payment_terms_days`.

**Files:**
- Create: `packages/shared/src/marketplace/credit-terms.ts`
- Test: `packages/shared/src/__tests__/marketplace/credit-terms.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/edge-functions/supabase/migrations/00210_orders_terms_settlement.sql`
- Create: `apps/web/src/actions/terms.actions.ts` (`placeOnAccountOrderAction`)
- Create: `apps/web/src/lib/marketplace/terms.ts`
- Create: `apps/web/src/app/(marketplace)/checkout/OnAccountOption.tsx`

- [ ] **Step 1: Write the failing pure-logic test**

```ts
// packages/shared/src/__tests__/marketplace/credit-terms.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateCreditLimit, computeTermsDueDate } from '../../marketplace/credit-terms'

describe('evaluateCreditLimit (integer cents)', () => {
  it('allows an order that stays within the limit', () => {
    const r = evaluateCreditLimit({ creditLimitCents: 500_00, outstandingCents: 100_00, orderTotalCents: 300_00 })
    expect(r).toEqual({ withinLimit: true, newOutstandingCents: 400_00, exceededByCents: 0 })
  })
  it('blocks an order that breaches the limit and reports the overage', () => {
    const r = evaluateCreditLimit({ creditLimitCents: 500_00, outstandingCents: 400_00, orderTotalCents: 300_00 })
    expect(r).toEqual({ withinLimit: false, newOutstandingCents: 700_00, exceededByCents: 200_00 })
  })
  it('treats a null/absent credit limit as unlimited (relationship exists, no cap set)', () => {
    const r = evaluateCreditLimit({ creditLimitCents: null, outstandingCents: 9_999_00, orderTotalCents: 1_000_00 })
    expect(r.withinLimit).toBe(true)
    expect(r.exceededByCents).toBe(0)
  })
  it('exact-limit order is allowed (<=, not <)', () => {
    expect(evaluateCreditLimit({ creditLimitCents: 500_00, outstandingCents: 200_00, orderTotalCents: 300_00 }).withinLimit).toBe(true)
  })
})

describe('computeTermsDueDate', () => {
  it('adds payment_terms_days to the acceptance date (UTC, date-only)', () => {
    expect(computeTermsDueDate('2026-07-14T09:30:00.000Z', 30)).toBe('2026-08-13')
  })
  it('defaults null terms to 30 days', () => {
    expect(computeTermsDueDate('2026-07-14T00:00:00.000Z', null)).toBe('2026-08-13')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared test -- credit-terms`
Expected: FAIL — `Cannot find module '../../marketplace/credit-terms'`.

- [ ] **Step 3: Implement the pure module**

```ts
// packages/shared/src/marketplace/credit-terms.ts
/**
 * On-account credit-limit + terms helpers. All money is integer cents (ZAR).
 * A null credit limit means "relationship exists, no cap" → unlimited.
 */
export interface CreditLimitInput {
  creditLimitCents: number | null
  outstandingCents: number
  orderTotalCents: number
}
export interface CreditLimitResult {
  withinLimit: boolean
  newOutstandingCents: number
  exceededByCents: number
}

export function evaluateCreditLimit(input: CreditLimitInput): CreditLimitResult {
  const newOutstandingCents = input.outstandingCents + input.orderTotalCents
  if (input.creditLimitCents === null) {
    return { withinLimit: true, newOutstandingCents, exceededByCents: 0 }
  }
  const over = newOutstandingCents - input.creditLimitCents
  return {
    withinLimit: over <= 0,
    newOutstandingCents,
    exceededByCents: over > 0 ? over : 0,
  }
}

/** Default terms when the relationship has no explicit payment_terms_days. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30

/** Returns a date-only (YYYY-MM-DD) due date = acceptedAtISO + termsDays, in UTC. */
export function computeTermsDueDate(acceptedAtISO: string, termsDays: number | null): string {
  const days = termsDays ?? DEFAULT_PAYMENT_TERMS_DAYS
  const d = new Date(acceptedAtISO)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Export + verify green**

Add to `packages/shared/src/index.ts`:
```ts
export * from './marketplace/credit-terms'
```
Run: `pnpm --filter @esite/shared test -- credit-terms`
Expected: PASS (6 tests).

- [ ] **Step 5: Migration — terms/settlement columns on `marketplace.orders`**

```sql
-- apps/edge-functions/supabase/migrations/00210_orders_terms_settlement.sql
-- Phase 4: on-account terms + settlement tracking on marketplace.orders.
-- payment_mode + the ex-VAT/incl-VAT cent columns are added by Phase 2; this
-- migration only adds the terms/settlement lifecycle fields. All money in cents.

ALTER TABLE marketplace.orders
  ADD COLUMN IF NOT EXISTS terms_days        INTEGER,        -- snapshot of payment_terms_days at acceptance
  ADD COLUMN IF NOT EXISTS terms_due_date    DATE,           -- accepted_at + terms_days
  ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMPTZ,    -- when the on-account order was accepted
  ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMPTZ,    -- supplier-marked buyer-paid (authoritative)
  ADD COLUMN IF NOT EXISTS settled_by        UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS settlement_method TEXT,           -- 'eft' | 'cash' | 'other' (free text ok)
  ADD COLUMN IF NOT EXISTS buyer_confirmed_at TIMESTAMPTZ;   -- optional buyer corroboration

-- Reconciliation reads by supplier + settled month; a partial index keeps the
-- monthly sweep cheap (only settled on-account rows matter).
CREATE INDEX IF NOT EXISTS idx_orders_settled_terms
  ON marketplace.orders (supplier_id, settled_at)
  WHERE payment_mode = 'on_account' AND settled_at IS NOT NULL;

-- Outstanding-credit reads: unsettled on-account rows per buyer+supplier.
CREATE INDEX IF NOT EXISTS idx_orders_outstanding_terms
  ON marketplace.orders (contractor_org_id, supplier_id)
  WHERE payment_mode = 'on_account' AND settled_at IS NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Server helper — outstanding balance + due date**

```ts
// apps/web/src/lib/marketplace/terms.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randToCents } from '@esite/shared'

/** Sum of unsettled on-account orders (incl-VAT cents) for a buyer↔supplier pair. */
export async function outstandingTermsCents(
  supabase: SupabaseClient,
  contractorOrgId: string,
  supplierId: string,
): Promise<number> {
  const { data, error } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .select('total_incl_vat')
    .eq('contractor_org_id', contractorOrgId)
    .eq('supplier_id', supplierId)
    .eq('payment_mode', 'on_account')
    .is('settled_at', null)
    .neq('status', 'cancelled')
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((sum: number, r: { total_incl_vat: number | null }) => sum + (r.total_incl_vat ?? 0), 0)
}

/** credit_limit is NUMERIC(12,2) rand in organisation_suppliers → cents (or null). */
export function creditLimitToCents(creditLimitRand: number | null): number | null {
  return creditLimitRand === null || creditLimitRand === undefined ? null : randToCents(creditLimitRand)
}
```

- [ ] **Step 7: `placeOnAccountOrderAction` (gated, ownership-checked, no charge)**

Add to a new `apps/web/src/actions/terms.actions.ts`. It mirrors the Phase-2 pay-now checkout action but takes the on-account branch. Read the Phase-2 checkout action first and reuse its cart→order snapshot builder (do **not** re-implement pricing). Skeleton with the real gate + credit check:

```ts
// apps/web/src/actions/terms.actions.ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { MARKETPLACE_BUYER_ROLES } from '@esite/shared'
import { evaluateCreditLimit, computeTermsDueDate } from '@esite/shared'
import { outstandingTermsCents, creditLimitToCents } from '@/lib/marketplace/terms'

export async function placeOnAccountOrderAction(input: {
  contractorOrgId: string
  supplierId: string
  supplierOrgId: string | null
  // ex-/incl-VAT totals already computed by the shared pricing service at checkout:
  subtotalExVatCents: number
  vatAmountCents: number
  totalInclVatCents: number
  orderItems: Array<{ catalogueItemId: string; description: string; quantity: number; unit: string; unitPriceCents: number }>
  projectId?: string | null
}): Promise<{ ok: true; orderId: string } | { ok: false; error: string; exceededByCents?: number }> {
  const supabase = await createClient()

  // 1. Buyer role gate (org-scoped).
  const guard = await requireRole(supabase, input.contractorOrgId, MARKETPLACE_BUYER_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // 2. Supplier must offer on-account AND the relationship must allow it.
  const { data: rel, error: relErr } = await (supabase as any)
    .schema('suppliers')
    .from('organisation_suppliers')
    .select('credit_limit, payment_terms_days, on_account_enabled')
    .eq('contractor_org_id', input.contractorOrgId)
    .eq('supplier_id', input.supplierId)
    .maybeSingle()
  if (relErr) return { ok: false, error: relErr.message }
  if (!rel || rel.on_account_enabled !== true) {
    return { ok: false, error: 'This supplier has not enabled on-account terms for your organisation.' }
  }

  // 3. Enforce credit limit against current outstanding.
  const outstandingCents = await outstandingTermsCents(supabase, input.contractorOrgId, input.supplierId)
  const verdict = evaluateCreditLimit({
    creditLimitCents: creditLimitToCents(rel.credit_limit),
    outstandingCents,
    orderTotalCents: input.totalInclVatCents,
  })
  if (!verdict.withinLimit) {
    return { ok: false, error: 'Order exceeds your available credit limit.', exceededByCents: verdict.exceededByCents }
  }

  // 4. Create the accepted, unpaid, on-account order (NO Paystack charge).
  const acceptedAt = new Date().toISOString()
  const { data: order, error: insErr } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .insert({
      contractor_org_id: input.contractorOrgId,
      supplier_org_id: input.supplierOrgId,
      supplier_id: input.supplierId,
      project_id: input.projectId ?? null,
      status: 'accepted',
      payment_mode: 'on_account',
      payment_status: 'pending',
      subtotal_ex_vat: input.subtotalExVatCents,
      vat_amount: input.vatAmountCents,
      total_incl_vat: input.totalInclVatCents,
      terms_days: rel.payment_terms_days ?? 30,
      terms_due_date: computeTermsDueDate(acceptedAt, rel.payment_terms_days),
      accepted_at: acceptedAt,
      created_by: guard.role ? (await supabase.auth.getUser()).data.user!.id : null,
    })
    .select('id')
    .single()
  if (insErr) return { ok: false, error: insErr.message }

  // Insert order_items (snapshot) — reuse the Phase-2 order-item writer here.
  // (omitted: identical to pay-now insert, minus the payment step)

  return { ok: true, orderId: order.id }
}
```
**Note:** `on_account_enabled` is added in Task 2's migration (00211). If executing tasks strictly in order, land 00211 before wiring this branch, or read the column defensively (`rel?.on_account_enabled === true`).

- [ ] **Step 8: Buyer checkout UI branch**

`checkout/OnAccountOption.tsx`: shown only when the supplier's `supplier_settings.payment_modes` includes `on_account` **and** the buyer relationship has `on_account_enabled`. Renders "Buy on account — payment due in N days" with the resolved `terms_due_date` preview and available-credit line (`formatZARFromCents(creditLimitCents - outstandingCents)`); the "Place order" button calls `placeOnAccountOrderAction`. On `exceededByCents`, show a danger banner ("Exceeds available credit by R…") and keep pay-now available as the fallback.

- [ ] **Step 9: Verify + commit**

Run: `pnpm --filter @esite/shared test -- credit-terms && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add packages/shared/src/marketplace/credit-terms.ts packages/shared/src/__tests__/marketplace/credit-terms.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/migrations/00210_orders_terms_settlement.sql apps/web/src/lib/marketplace/terms.ts apps/web/src/actions/terms.actions.ts apps/web/src/app/\(marketplace\)/checkout/OnAccountOption.tsx
git commit -m "feat(marketplace): on-account checkout path + credit-limit enforcement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Credit-limit + terms management (supplier sets per-buyer terms; buyer sees them)

Spec §5.2 / §2.4. Supplier owner/admin manages `credit_limit` + `payment_terms_days` + on/off per buyer via `organisation_suppliers`; the buyer sees their own terms read-only.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00211_organisation_suppliers_terms_rls.sql`
- Modify: `apps/web/src/actions/terms.actions.ts` (`setBuyerTermsAction`)
- Create: `apps/web/src/app/(marketplace)/supplier/terms/page.tsx`
- Modify: buyer storefront/relationship view to surface terms (read-only)

- [ ] **Step 1: Migration — supplier-managed terms + RLS**

`organisation_suppliers` today has no UPDATE policy for the supplier side. Add the on/off flag and a supplier-side UPDATE policy (the supplier org that owns `supplier_id` may edit the relationship's terms). Confirm the exact existing policy names first (Step 0: `SELECT policyname, cmd FROM pg_policies WHERE schemaname='suppliers' AND tablename='organisation_suppliers';`).

```sql
-- apps/edge-functions/supabase/migrations/00211_organisation_suppliers_terms_rls.sql
-- Phase 4: let a supplier org manage per-buyer on-account terms.

ALTER TABLE suppliers.organisation_suppliers
  ADD COLUMN IF NOT EXISTS on_account_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- The supplier org that owns supplier_id may read + update the relationship's
-- terms (credit_limit, payment_terms_days, on_account_enabled, is_preferred).
-- Mirrors the org-scoped ownership pattern used elsewhere; get_user_org_ids()
-- is the audited membership helper.
DROP POLICY IF EXISTS "supplier_org_manages_relationship" ON suppliers.organisation_suppliers;
CREATE POLICY "supplier_org_manages_relationship"
  ON suppliers.organisation_suppliers
  FOR UPDATE
  USING (
    supplier_id IN (
      SELECT s.id FROM suppliers.suppliers s
      WHERE s.organisation_id = ANY (public.get_user_org_ids())
    )
  )
  WITH CHECK (
    supplier_id IN (
      SELECT s.id FROM suppliers.suppliers s
      WHERE s.organisation_id = ANY (public.get_user_org_ids())
    )
  );

-- Buyer org keeps read visibility of its own relationship (add if not present).
DROP POLICY IF EXISTS "buyer_org_reads_relationship" ON suppliers.organisation_suppliers;
CREATE POLICY "buyer_org_reads_relationship"
  ON suppliers.organisation_suppliers
  FOR SELECT
  USING (
    contractor_org_id = ANY (public.get_user_org_ids())
    OR supplier_id IN (
      SELECT s.id FROM suppliers.suppliers s
      WHERE s.organisation_id = ANY (public.get_user_org_ids())
    )
  );

NOTIFY pgrst, 'reload schema';
```
**RED/GREEN probe (memory `rolled-back-prod-red-green-probe`):** in one rolled-back txn, prove a supplier-org member currently *cannot* UPDATE a buyer relationship (RED), apply the policy in-txn, prove they now can and a non-owner still cannot (GREEN), then `RAISE` to roll back.

- [ ] **Step 2: Write the failing action-gate test**

```ts
// apps/web/src/actions/__tests__/terms.actions.test.ts  (part 1)
// Mirror the existing gate-test harness (memory `e2e-test-cookie-gated-routes`).
// Assert setBuyerTermsAction:
//   - rejects a caller who is NOT owner/admin of the supplier org (403/error)
//   - rejects when the caller's supplier org does not own supplier_id (ownership)
//   - accepts an owner/admin of the owning supplier org and writes credit_limit + terms
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- terms.actions`
Expected: FAIL — `setBuyerTermsAction` does not exist yet.

- [ ] **Step 4: Implement `setBuyerTermsAction` (ownership-checked)**

```ts
// apps/web/src/actions/terms.actions.ts (append)
import { SUPPLIER_PORTAL_ROLES } from '@esite/shared'
import { z } from 'zod'

const BuyerTermsSchema = z.object({
  relationshipId: z.string().uuid(),
  supplierOrgId: z.string().uuid(),
  creditLimitRand: z.number().nonnegative().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).nullable(),
  onAccountEnabled: z.boolean(),
})

export async function setBuyerTermsAction(raw: z.input<typeof BuyerTermsSchema>) {
  const supabase = await createClient()
  const input = BuyerTermsSchema.parse(raw)

  // Supplier owner/admin only, on their own supplier org.
  const guard = await requireRole(supabase, input.supplierOrgId, SUPPLIER_PORTAL_ROLES)
  if (!guard.ok) return { ok: false as const, error: guard.error }

  // Ownership: the relationship's supplier_id must belong to this supplier org.
  // Enforced again by RLS (00211); this pre-check returns a friendly error.
  const { data, error } = await (supabase as any)
    .schema('suppliers')
    .from('organisation_suppliers')
    .update({
      credit_limit: input.creditLimitRand,
      payment_terms_days: input.paymentTermsDays,
      on_account_enabled: input.onAccountEnabled,
    })
    .eq('id', input.relationshipId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false as const, error: error.message }
  if (!data) return { ok: false as const, error: 'Relationship not found or not owned by your organisation.' }
  return { ok: true as const }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- terms.actions`
Expected: PASS.

- [ ] **Step 6: Supplier terms page + buyer read view**

`supplier/terms/page.tsx` (gated `requireRolePage(SUPPLIER_PORTAL_ROLES)`): table of the supplier's buyer relationships (`organisation_suppliers` joined to buyer org name) with inline editors for credit limit (R), terms days, and an on-account toggle → `setBuyerTermsAction`. Use `Card / CardHeader / CardBody` + badge variants. On the **buyer** side, add a read-only "Your terms" strip on the supplier storefront (credit limit, terms days, on/off) sourced from the buyer-readable `organisation_suppliers` row.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter web test -- terms.actions && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/edge-functions/supabase/migrations/00211_organisation_suppliers_terms_rls.sql apps/web/src/actions/terms.actions.ts apps/web/src/actions/__tests__/terms.actions.test.ts apps/web/src/app/\(marketplace\)/supplier/terms/page.tsx
git commit -m "feat(marketplace): supplier per-buyer terms + credit-limit management

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Terms invoice on acceptance/delivery (reuse Phase-2 `tax_invoices` + R5 flag)

Spec §5.2 step 5 + §10 ("Payment received (receipt + tax invoice)" adapted for terms). Raise the supplier→buyer tax invoice with terms N days; **R5** (platform-issued invoices under supplier VAT numbers) is unconfirmed → gate invoice-number issuance + PDF behind a flag, but **capture the invoice data regardless**.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00214_tax_invoices_terms.sql`
- Modify: `apps/web/src/actions/terms.actions.ts` (`raiseTermsInvoiceAction`)
- Modify: `apps/web/src/lib/marketplace/terms.ts` (`taxInvoicesEnabled()` reader)

- [ ] **Step 1: Migration — terms columns on `tax_invoices` + R5 flag**

`tax_invoices` is built by Phase 2 (invoice header: order_id, seller/buyer orgs, subtotal/vat/total cents, `invoice_number`, `issued_at`). Add terms-specific fields and the R5 gate. Confirm Phase-2 column names first; adjust `ADD COLUMN` list to only what's missing.

```sql
-- apps/edge-functions/supabase/migrations/00214_tax_invoices_terms.sql
-- Phase 4: terms metadata on Phase-2 tax_invoices + R5 issuance gate.

ALTER TABLE marketplace.tax_invoices
  ADD COLUMN IF NOT EXISTS invoice_kind  TEXT NOT NULL DEFAULT 'sale'
    CHECK (invoice_kind IN ('sale','terms','commission')),
  ADD COLUMN IF NOT EXISTS terms_days    INTEGER,
  ADD COLUMN IF NOT EXISTS due_date      DATE,
  ADD COLUMN IF NOT EXISTS number_issued BOOLEAN NOT NULL DEFAULT FALSE; -- false until R5 sign-off

-- R5 gate: a single platform flag. Until legal/accountant confirms, invoices
-- are captured (rows exist) but no VAT invoice_number is stamped and no PDF is
-- served. Flip this to true post-sign-off (Phase 2's commission_config is the
-- config home; add one row rather than a new table).
INSERT INTO marketplace.commission_config (key, value, description)
VALUES ('tax_invoices_enabled', 'false', 'R5 gate: issue platform tax-invoice numbers/PDFs (legal sign-off).')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```
**Note:** if Phase-2 `commission_config` is not a key/value table (e.g. it is a typed single-row config), store the flag in the shape Phase 2 actually chose — read the Phase-2 migration and match it. The R5 gate must live in the Phase-2 config, not a new table.

- [ ] **Step 2: R5 flag reader (failing test first)**

```ts
// apps/web/src/actions/__tests__/terms.actions.test.ts (part 2)
// Assert raiseTermsInvoiceAction:
//   - always inserts a tax_invoices row (invoice_kind='terms', due_date set, number_issued=false)
//   - does NOT stamp invoice_number while tax_invoices_enabled=false
//   - stamps a number when the flag is true
```

- [ ] **Step 3: Implement `raiseTermsInvoiceAction`**

Triggered when an on-account order transitions to `delivered`/`accepted` (call from the fulfilment-confirm path built in Phase 3, or from `markTermsOrderSettledAction`'s sibling). It: loads the order + its cent totals, reads `tax_invoices_enabled`, inserts a `tax_invoices` row (`invoice_kind='terms'`, `due_date = order.terms_due_date`, `terms_days = order.terms_days`, `number_issued = flag`), and — only when the flag is on — allocates the next `invoice_number`. Gate with `requireRole(supabase, supplierOrgId, SUPPLIER_PORTAL_ROLES)`. Best-effort email of the invoice is Task 6's `payout`-adjacent template set / Phase 5; here just capture the row.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter web test -- terms.actions && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/edge-functions/supabase/migrations/00214_tax_invoices_terms.sql apps/web/src/actions/terms.actions.ts apps/web/src/lib/marketplace/terms.ts apps/web/src/actions/__tests__/terms.actions.test.ts
git commit -m "feat(marketplace): raise terms tax invoice on acceptance (R5-gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Settlement tracking (supplier marks paid / buyer confirms)

Spec §6.4. The supplier self-marks a terms order buyer-paid (authoritative for reconciliation); the buyer may corroborate.

**Files:**
- Modify: `apps/web/src/actions/terms.actions.ts` (`markTermsOrderSettledAction`, `confirmTermsPaymentAction`)
- Create: `apps/web/src/app/(marketplace)/orders/[id]/SettlementPanel.tsx`

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/actions/__tests__/terms.actions.test.ts (part 3)
// markTermsOrderSettledAction:
//   - rejects a non-owner/admin of the supplier org (gate)
//   - sets settled_at + settled_by + settlement_method on an on-account order
//   - is idempotent: a second call does not move settled_at
//   - rejects a pay_now order (only on_account is settle-able here)
// confirmTermsPaymentAction:
//   - buyer (MARKETPLACE_BUYER_ROLES on contractor org) sets buyer_confirmed_at only
//   - does NOT set settled_at (supplier remains authoritative)
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- terms.actions`
Expected: FAIL — actions absent.

- [ ] **Step 3: Implement both actions**

```ts
// apps/web/src/actions/terms.actions.ts (append)
export async function markTermsOrderSettledAction(input: {
  orderId: string
  supplierOrgId: string
  settlementMethod?: string
}) {
  const supabase = await createClient()
  const guard = await requireRole(supabase, input.supplierOrgId, SUPPLIER_PORTAL_ROLES)
  if (!guard.ok) return { ok: false as const, error: guard.error }
  const { data: { user } } = await supabase.auth.getUser()

  // Only settle an unsettled on-account order owned by this supplier org (idempotent + typed).
  const { data, error } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .update({
      settled_at: new Date().toISOString(),
      settled_by: user!.id,
      settlement_method: input.settlementMethod ?? null,
    })
    .eq('id', input.orderId)
    .eq('supplier_org_id', input.supplierOrgId)
    .eq('payment_mode', 'on_account')
    .is('settled_at', null)
    .select('id, settled_at')
    .maybeSingle()
  if (error) return { ok: false as const, error: error.message }
  if (!data) return { ok: false as const, error: 'Order not found, not on-account, or already settled.' }
  // Fire the supplier settlement email (Task 6 template) — best-effort.
  return { ok: true as const, settledAt: data.settled_at }
}

export async function confirmTermsPaymentAction(input: { orderId: string; contractorOrgId: string }) {
  const supabase = await createClient()
  const guard = await requireRole(supabase, input.contractorOrgId, MARKETPLACE_BUYER_ROLES)
  if (!guard.ok) return { ok: false as const, error: guard.error }
  const { error } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .update({ buyer_confirmed_at: new Date().toISOString() })
    .eq('id', input.orderId)
    .eq('contractor_org_id', input.contractorOrgId)
    .eq('payment_mode', 'on_account')
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const }
}
```

- [ ] **Step 4: Settlement UI**

`orders/[id]/SettlementPanel.tsx`: for the supplier org, a "Mark buyer-paid" control (method dropdown → `markTermsOrderSettledAction`) shown only for unsettled on-account orders; for the buyer org, a "Confirm we've paid" control → `confirmTermsPaymentAction`. Show `settled_at`, `buyer_confirmed_at`, and `terms_due_date` with an overdue badge (danger variant when `terms_due_date < today` and unsettled).

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter web test -- terms.actions && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/web/src/actions/terms.actions.ts apps/web/src/actions/__tests__/terms.actions.test.ts apps/web/src/app/\(marketplace\)/orders/\[id\]/SettlementPanel.tsx
git commit -m "feat(marketplace): terms order settlement tracking (supplier + buyer)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Monthly commission reconciliation — `supplier_commission_statements` + scheduled job

Spec §6.4 / §10 ("Monthly commission statement | Supplier | Email (with statement PDF)"). Per supplier per month, sum **5% of the ex-VAT value** of terms orders settled that month, produce an idempotent statement, render a PDF, and email it.

**Architecture (chosen; alternative noted):**
- **Compute in Postgres** — a `SECURITY DEFINER` fn `marketplace.build_commission_statements(period)` upserts one header + N line rows per supplier, idempotent on `(supplier_id, period_month)`; only `draft` statements are recomputed (already-`sent` ones are frozen).
- **Schedule via `pg_cron`** — monthly `net.http_post` to a new edge fn `marketplace-commission-run` (mirrors `cloud-sync-cron`).
- **Edge fn** calls the build RPC, then for each statement with `email_sent_at IS NULL` POSTs `send-email` (`type: 'commission-statement'`) with a deep link to the supplier statement page, then stamps `email_sent_at` (idempotent email).
- **PDF** rendered on demand by a Next route from a pure `@esite/shared` renderer (pdf-lib), RLS-gated to the owning supplier org (mirrors legend-card).
- *Alternative:* render the PDF inside the edge fn (pdf-lib via esm.sh) and attach the bytes to the Resend email. Chosen against because on-demand render reuses the Node `@esite/shared` renderer + the audited legend-card route pattern and avoids cross-runtime PDF code; noted for Phase 5 if buyers ask for an attached PDF.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00212_supplier_commission_statements.sql`
- Create: `apps/edge-functions/supabase/migrations/00213_commission_statement_fns.sql`
- Create: `apps/edge-functions/supabase/migrations/00215_commission_run_cron.sql`
- Create: `apps/edge-functions/supabase/functions/marketplace-commission-run/index.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/commission-statement.ts`
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (add the type)
- Create: `packages/shared/src/marketplace/render-commission-statement.ts` (+ test)
- Create: `apps/web/src/app/api/marketplace/commission-statement/pdf/route.ts` (+ test)
- Create: `apps/web/src/app/(marketplace)/supplier/payouts/statements/page.tsx` + `[id]/page.tsx`

- [ ] **Step 1: Migration — statement tables + RLS**

```sql
-- apps/edge-functions/supabase/migrations/00212_supplier_commission_statements.sql
-- Phase 4: monthly E-Site commission statements for on-account (terms) orders.
-- All money in integer cents (ZAR). One statement per supplier per calendar month.

CREATE TABLE IF NOT EXISTS marketplace.supplier_commission_statements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    supplier_org_id     UUID REFERENCES public.organisations(id),
    period_month        DATE NOT NULL,                 -- first day of the settled month (UTC)
    orders_count        INTEGER NOT NULL DEFAULT 0,
    total_ex_vat_cents  BIGINT  NOT NULL DEFAULT 0,    -- Σ settled terms orders' ex-VAT value
    commission_rate     NUMERIC(5,4) NOT NULL,         -- effective platform rate (e.g. 0.0500)
    commission_cents    BIGINT  NOT NULL DEFAULT 0,    -- E-Site's 5% owed by the supplier
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','paid','void')),
    invoice_number      TEXT,                          -- allocated only when R5 flag on (Task 3 note)
    email_sent_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_commission_statements_supplier
    ON marketplace.supplier_commission_statements(supplier_id, period_month);

CREATE TRIGGER supplier_commission_statements_updated_at
    BEFORE UPDATE ON marketplace.supplier_commission_statements
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace.supplier_commission_statement_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id        UUID NOT NULL REFERENCES marketplace.supplier_commission_statements(id) ON DELETE CASCADE,
    order_id            UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
    settled_at          TIMESTAMPTZ NOT NULL,
    subtotal_ex_vat_cents BIGINT NOT NULL,
    commission_rate     NUMERIC(5,4) NOT NULL,
    commission_cents    BIGINT NOT NULL,
    UNIQUE (statement_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_commission_statement_lines_statement
    ON marketplace.supplier_commission_statement_lines(statement_id);

-- RLS: supplier org reads its own statements; only service role writes.
ALTER TABLE marketplace.supplier_commission_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.supplier_commission_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "statements_select_supplier_org"
  ON marketplace.supplier_commission_statements
  FOR SELECT USING (supplier_org_id = ANY (public.get_user_org_ids()));

CREATE POLICY "statement_lines_select_via_statement"
  ON marketplace.supplier_commission_statement_lines
  FOR SELECT USING (
    statement_id IN (
      SELECT s.id FROM marketplace.supplier_commission_statements s
      WHERE s.supplier_org_id = ANY (public.get_user_org_ids())
    )
  );

-- No INSERT/UPDATE/DELETE policies → writes are service-role only (RLS default deny).
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Migration — build + outstanding functions**

```sql
-- apps/edge-functions/supabase/migrations/00213_commission_statement_fns.sql
-- Phase 4: idempotent monthly statement builder + credit-outstanding helper.

-- Outstanding (incl-VAT cents) of unsettled on-account orders for a buyer↔supplier.
CREATE OR REPLACE FUNCTION marketplace.supplier_buyer_outstanding_cents(
  p_contractor_org UUID,
  p_supplier_id    UUID
) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = marketplace, public AS $$
  SELECT COALESCE(SUM(total_incl_vat), 0)::BIGINT
  FROM marketplace.orders
  WHERE contractor_org_id = p_contractor_org
    AND supplier_id       = p_supplier_id
    AND payment_mode      = 'on_account'
    AND settled_at IS NULL
    AND status <> 'cancelled';
$$;

-- Build/refresh statements for the calendar month containing p_period_month.
-- Idempotent: (supplier_id, period_month) is unique; a 'draft' statement is
-- recomputed (lines replaced); a 'sent'/'paid' statement is left untouched.
CREATE OR REPLACE FUNCTION marketplace.build_commission_statements(
  p_period_month DATE  -- any date in the target month; normalised to month start
) RETURNS TABLE (statement_id UUID, supplier_id UUID, commission_cents BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = marketplace, public AS $$
DECLARE
  v_month_start DATE := date_trunc('month', p_period_month)::DATE;
  v_month_end   DATE := (date_trunc('month', p_period_month) + INTERVAL '1 month')::DATE;
  r RECORD;
  v_stmt UUID;
  v_rate NUMERIC(5,4);
BEGIN
  FOR r IN
    SELECT o.supplier_id, o.supplier_org_id
    FROM marketplace.orders o
    WHERE o.payment_mode = 'on_account'
      AND o.settled_at >= v_month_start
      AND o.settled_at <  v_month_end
    GROUP BY o.supplier_id, o.supplier_org_id
  LOOP
    -- Effective rate from Phase-2 commission_config (fallback 5%).
    BEGIN
      v_rate := marketplace.commission_rate_for_supplier(r.supplier_id);
    EXCEPTION WHEN undefined_function THEN
      v_rate := 0.0500;
    END;

    -- Upsert the header (skip refresh if already frozen).
    SELECT id INTO v_stmt
    FROM marketplace.supplier_commission_statements
    WHERE supplier_id = r.supplier_id AND period_month = v_month_start;

    IF v_stmt IS NOT NULL THEN
      IF (SELECT status FROM marketplace.supplier_commission_statements WHERE id = v_stmt) <> 'draft' THEN
        statement_id := v_stmt; supplier_id := r.supplier_id;
        commission_cents := (SELECT commission_cents FROM marketplace.supplier_commission_statements WHERE id = v_stmt);
        RETURN NEXT; CONTINUE;
      END IF;
      DELETE FROM marketplace.supplier_commission_statement_lines WHERE statement_id = v_stmt;
    ELSE
      INSERT INTO marketplace.supplier_commission_statements
        (supplier_id, supplier_org_id, period_month, commission_rate)
      VALUES (r.supplier_id, r.supplier_org_id, v_month_start, v_rate)
      RETURNING id INTO v_stmt;
    END IF;

    -- Recompute lines (ceil per order — matches webhook Math.ceil rounding).
    INSERT INTO marketplace.supplier_commission_statement_lines
      (statement_id, order_id, settled_at, subtotal_ex_vat_cents, commission_rate, commission_cents)
    SELECT v_stmt, o.id, o.settled_at, o.subtotal_ex_vat, v_rate,
           CEIL(o.subtotal_ex_vat * v_rate)::BIGINT
    FROM marketplace.orders o
    WHERE o.supplier_id  = r.supplier_id
      AND o.payment_mode = 'on_account'
      AND o.settled_at >= v_month_start
      AND o.settled_at <  v_month_end;

    -- Roll the header up from its lines.
    UPDATE marketplace.supplier_commission_statements s
    SET orders_count       = agg.n,
        total_ex_vat_cents = agg.ex,
        commission_cents   = agg.comm,
        commission_rate    = v_rate
    FROM (
      SELECT COUNT(*) n, COALESCE(SUM(subtotal_ex_vat_cents),0) ex, COALESCE(SUM(commission_cents),0) comm
      FROM marketplace.supplier_commission_statement_lines WHERE statement_id = v_stmt
    ) agg
    WHERE s.id = v_stmt;

    statement_id := v_stmt; supplier_id := r.supplier_id;
    commission_cents := (SELECT commission_cents FROM marketplace.supplier_commission_statements WHERE id = v_stmt);
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION marketplace.build_commission_statements(DATE) FROM public;
NOTIFY pgrst, 'reload schema';
```
**Verify (rolled-back RED/GREEN probe):** seed two settled on-account orders (ex-VAT 100000c + 50000c) in month M for one supplier → run `build_commission_statements` → assert one statement with `total_ex_vat_cents=150000`, `commission_cents=7500` (5%), two lines; re-run → still exactly one statement, two lines (idempotent); mark it `sent`, add a third settled order, re-run → statement unchanged (frozen). `RAISE` to roll back.

- [ ] **Step 3: PDF renderer (pure) — failing test first**

```ts
// packages/shared/src/__tests__/marketplace/render-commission-statement.test.ts
import { describe, it, expect } from 'vitest'
import { renderCommissionStatementPdf } from '../../marketplace/render-commission-statement'

const stmt = {
  supplierName: 'Acme Electrical',
  periodMonth: '2026-06-01',
  commissionRate: 0.05,
  totalExVatCents: 150000,
  commissionCents: 7500,
  lines: [
    { orderRef: 'ORD-0001', settledAt: '2026-06-10T00:00:00Z', subtotalExVatCents: 100000, commissionCents: 5000 },
    { orderRef: 'ORD-0002', settledAt: '2026-06-20T00:00:00Z', subtotalExVatCents: 50000, commissionCents: 2500 },
  ],
}

describe('renderCommissionStatementPdf', () => {
  it('returns a non-empty PDF byte array', async () => {
    const bytes = await renderCommissionStatementPdf(stmt)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(500)
    // PDF magic number: %PDF
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
  })
})
```

- [ ] **Step 4: Run to verify fail, then implement the renderer**

Run: `pnpm --filter @esite/shared test -- render-commission-statement` → FAIL (module missing).

```ts
// packages/shared/src/marketplace/render-commission-statement.ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { formatZARFromCents } from '../money/money'

export interface CommissionStatementLine {
  orderRef: string
  settledAt: string
  subtotalExVatCents: number
  commissionCents: number
}
export interface CommissionStatementDoc {
  supplierName: string
  periodMonth: string           // YYYY-MM-01
  commissionRate: number        // 0.05
  totalExVatCents: number
  commissionCents: number
  lines: CommissionStatementLine[]
}

/** Single-page (paginated) E-Site commission statement PDF. Pure — no I/O. */
export async function renderCommissionStatementPdf(doc: CommissionStatementDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage([595.28, 841.89]) // A4 portrait
  const margin = 48
  let y = 841.89 - margin

  const text = (s: string, x: number, yy: number, f = font, size = 10) =>
    page.drawText(s, { x, y: yy, size, font: f, color: rgb(0.1, 0.1, 0.1) })

  text('E-Site — Marketplace Commission Statement', margin, y, bold, 15); y -= 26
  text(`Supplier: ${doc.supplierName}`, margin, y, font, 11); y -= 16
  text(`Period: ${doc.periodMonth.slice(0, 7)}`, margin, y); y -= 16
  text(`Commission rate: ${(doc.commissionRate * 100).toFixed(1)}%`, margin, y); y -= 24

  text('Order', margin, y, bold); text('Settled', margin + 130, y, bold)
  text('Ex-VAT', margin + 280, y, bold); text('Commission', margin + 390, y, bold); y -= 6
  page.drawLine({ start: { x: margin, y }, end: { x: 595.28 - margin, y }, thickness: 0.5 }); y -= 16

  for (const l of doc.lines) {
    if (y < margin + 60) { page = pdf.addPage([595.28, 841.89]); y = 841.89 - margin }
    text(l.orderRef, margin, y)
    text(l.settledAt.slice(0, 10), margin + 130, y)
    text(formatZARFromCents(l.subtotalExVatCents), margin + 280, y)
    text(formatZARFromCents(l.commissionCents), margin + 390, y)
    y -= 15
  }

  y -= 10
  page.drawLine({ start: { x: margin, y }, end: { x: 595.28 - margin, y }, thickness: 0.5 }); y -= 18
  text(`Total ex-VAT settled: ${formatZARFromCents(doc.totalExVatCents)}`, margin, y, bold); y -= 16
  text(`Commission due to E-Site: ${formatZARFromCents(doc.commissionCents)}`, margin, y, bold)

  return pdf.save()
}
```
Add `export * from './marketplace/render-commission-statement'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- render-commission-statement` → PASS.
(If `pdf-lib` is not yet a `@esite/shared` dependency, add it: `pnpm --filter @esite/shared add pdf-lib` — the app already ships it in `apps/web`.)

- [ ] **Step 5: PDF route (RLS-gated) + test**

```ts
// apps/web/src/app/api/marketplace/commission-statement/pdf/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderCommissionStatementPdf } from '@esite/shared'

export async function GET(req: NextRequest) {
  const statementId = req.nextUrl.searchParams.get('statementId')
  if (!statementId) return NextResponse.json({ error: 'statementId required' }, { status: 400 })

  // RLS is the gate: the SELECT policy only returns rows the caller's supplier org owns.
  const supabase = await createClient()
  const { data: stmt, error } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_commission_statements')
    .select('id, period_month, commission_rate, total_ex_vat_cents, commission_cents, supplier:suppliers!supplier_id(name)')
    .eq('id', statementId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!stmt) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // RLS-filtered → 404 for non-owners

  const { data: lines } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_commission_statement_lines')
    .select('order_id, settled_at, subtotal_ex_vat_cents, commission_cents')
    .eq('statement_id', statementId)
    .order('settled_at', { ascending: true })

  const bytes = await renderCommissionStatementPdf({
    supplierName: stmt.supplier?.name ?? 'Supplier',
    periodMonth: stmt.period_month,
    commissionRate: Number(stmt.commission_rate),
    totalExVatCents: stmt.total_ex_vat_cents,
    commissionCents: stmt.commission_cents,
    lines: (lines ?? []).map((l: any) => ({
      orderRef: String(l.order_id).slice(0, 8),
      settledAt: l.settled_at,
      subtotalExVatCents: l.subtotal_ex_vat_cents,
      commissionCents: l.commission_cents,
    })),
  })

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="commission-statement-${stmt.period_month.slice(0, 7)}.pdf"`,
    },
  })
}
```
Test `route.test.ts` (mirror `legend-card/pdf/route.test.ts`): a non-owning caller gets 404 (RLS filters the row); the owning supplier gets `application/pdf` bytes starting `%PDF`.

- [ ] **Step 6: `send-email` type + template**

Add to `send-email/index.ts` a `commission-statement` branch and a `payout-settled`/`payout-failed` branch (Task 6). Template:
```ts
// apps/edge-functions/supabase/functions/_shared/email-templates/commission-statement.ts
import { baseEmail } from './base.ts'
export function commissionStatementEmail(p: {
  supplierName: string; periodLabel: string; commissionZar: string; ordersCount: number; statementUrl: string
}): { subject: string; html: string } {
  return {
    subject: `Your E-Site commission statement — ${p.periodLabel}`,
    html: baseEmail(`
      <h1>Commission statement — ${p.periodLabel}</h1>
      <p>Hi ${p.supplierName},</p>
      <p>Your on-account (terms) orders settled in ${p.periodLabel}: <strong>${p.ordersCount}</strong>.</p>
      <p>Commission due to E-Site (5% of ex-VAT settled value): <strong>${p.commissionZar}</strong>.</p>
      <p><a href="${p.statementUrl}">View &amp; download your statement (PDF)</a></p>
    `),
  }
}
```
(Match `base.ts`'s actual export name/signature — read it first.)

- [ ] **Step 7: The monthly edge job**

```ts
// apps/edge-functions/supabase/functions/marketplace-commission-run/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.e-site.live'

function prevMonthStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return d.toISOString().slice(0, 10)
}
const zar = (cents: number) => `R ${(cents / 100).toFixed(2)}`

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const body = await req.json().catch(() => ({}))
  const period: string = body.periodMonth ?? prevMonthStart()

  // 1. Build/refresh statements for the period (idempotent).
  const { error: buildErr } = await supabase.schema('marketplace').rpc('build_commission_statements', { p_period_month: period })
  if (buildErr) return new Response(JSON.stringify({ error: buildErr.message }), { status: 500 })

  // 2. Email each not-yet-emailed statement (idempotent on email_sent_at).
  const { data: stmts, error } = await supabase
    .schema('marketplace')
    .from('supplier_commission_statements')
    .select('id, supplier_org_id, period_month, orders_count, commission_cents, supplier:suppliers!supplier_id(name)')
    .eq('period_month', period)
    .is('email_sent_at', null)
    .gt('commission_cents', 0)
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let emailed = 0
  for (const s of stmts ?? []) {
    // Resolve the supplier org's owner/admin email(s).
    const { data: admin } = await supabase
      .from('user_organisations')
      .select('user:profiles!user_id(email)')
      .eq('organisation_id', (s as any).supplier_org_id)
      .in('role', ['owner', 'admin'])
      .eq('is_active', true)
      .limit(1).maybeSingle()
    const to = (admin?.user as any)?.email
    if (!to) continue

    await supabase.functions.invoke('send-email', {
      body: {
        type: 'commission-statement',
        payload: {
          to,
          supplierName: (s as any).supplier?.name ?? 'Supplier',
          periodLabel: String((s as any).period_month).slice(0, 7),
          ordersCount: (s as any).orders_count,
          commissionZar: zar((s as any).commission_cents),
          statementUrl: `${SITE_URL}/supplier/payouts/statements/${(s as any).id}`,
        },
      },
    })
    await supabase.schema('marketplace').from('supplier_commission_statements')
      .update({ email_sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', (s as any).id)
    emailed++
  }

  return new Response(JSON.stringify({ period, statements: (stmts ?? []).length, emailed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 8: `pg_cron` schedule migration (informational block)**

```sql
-- apps/edge-functions/supabase/migrations/00215_commission_run_cron.sql
-- Phase 4: schedule the monthly commission run. Apply per environment after the
-- marketplace-commission-run Edge Function is deployed. Runs 06:00 UTC on the
-- 1st of each month for the PREVIOUS calendar month (the function defaults the
-- period to prevMonthStart()). Mirrors the cloud-sync-cron pattern (00148).
--
--   SELECT cron.schedule(
--     'marketplace-commission-run-monthly',
--     '0 6 1 * *',
--     $$ SELECT net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/marketplace-commission-run',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--            'Content-Type',  'application/json'
--          ),
--          body := '{}'::jsonb
--        ); $$
--   );
--
-- Idempotent by design: build_commission_statements upserts on (supplier_id,
-- period_month) and the edge fn only emails statements with email_sent_at IS
-- NULL, so a manual re-run or a cron double-fire cannot double-charge or
-- double-email.
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 9: Supplier statements pages**

`supplier/payouts/statements/page.tsx` (`requireRolePage(SUPPLIER_PORTAL_ROLES)`): list of the supplier's statements (period, orders_count, `formatZARFromCents(commission_cents)`, status badge). `[id]/page.tsx`: the statement's lines + a "Download PDF" button linking to `/api/marketplace/commission-statement/pdf?statementId=…`.

- [ ] **Step 10: Verify + commit**

Run: `pnpm --filter @esite/shared test -- render-commission-statement && pnpm --filter web test -- commission-statement && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. Then, with the **run** skill, invoke `marketplace-commission-run` locally against seeded settled orders and confirm exactly one statement + one email per supplier; re-invoke and confirm zero new emails.
```bash
git add apps/edge-functions/supabase/migrations/00212_supplier_commission_statements.sql apps/edge-functions/supabase/migrations/00213_commission_statement_fns.sql apps/edge-functions/supabase/migrations/00215_commission_run_cron.sql apps/edge-functions/supabase/functions/marketplace-commission-run apps/edge-functions/supabase/functions/_shared/email-templates/commission-statement.ts apps/edge-functions/supabase/functions/send-email/index.ts packages/shared/src/marketplace/render-commission-statement.ts packages/shared/src/__tests__/marketplace/render-commission-statement.test.ts packages/shared/src/index.ts apps/web/src/app/api/marketplace/commission-statement apps/web/src/app/\(marketplace\)/supplier/payouts
git commit -m "feat(marketplace): monthly commission reconciliation statements + job

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Settlement / payout notification emails

Spec §6.2 + §10 (*Payout / settlement* → supplier; *Payout failed* → supplier + admin). Missing today. Also serves **Phase 2 pay-now auto-split**: the `paystack-webhook` already flips `commission_records.payout_status` on `transfer.success`/`transfer.failed` but sends nothing.

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/payout-settled.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/payout-failed.ts`
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (2 types)
- Modify: `apps/edge-functions/supabase/functions/paystack-webhook/index.ts` (emit on transfer.*)
- Modify: `apps/web/src/actions/terms.actions.ts` (`markTermsOrderSettledAction` → settlement email)

- [ ] **Step 1: Templates**

```ts
// apps/edge-functions/supabase/functions/_shared/email-templates/payout-settled.ts
import { baseEmail } from './base.ts'
export function payoutSettledEmail(p: { supplierName: string; amountZar: string; ref: string; context: 'split' | 'terms' }): { subject: string; html: string } {
  const how = p.context === 'split' ? 'settled to your bank account by Paystack' : 'marked paid by the buyer'
  return {
    subject: `Payment ${p.context === 'split' ? 'settled' : 'received'} — ${p.amountZar}`,
    html: baseEmail(`
      <h1>Payment ${p.context === 'split' ? 'settled' : 'received'}</h1>
      <p>Hi ${p.supplierName},</p>
      <p>${p.amountZar} has been ${how} (ref ${p.ref}).</p>
    `),
  }
}
```
```ts
// apps/edge-functions/supabase/functions/_shared/email-templates/payout-failed.ts
import { baseEmail } from './base.ts'
export function payoutFailedEmail(p: { supplierName: string; amountZar: string; ref: string; reason: string }): { subject: string; html: string } {
  return {
    subject: `Action needed: payout failed — ${p.amountZar}`,
    html: baseEmail(`
      <h1>Payout failed</h1>
      <p>Hi ${p.supplierName},</p>
      <p>A payout of ${p.amountZar} (ref ${p.ref}) failed: ${p.reason}.</p>
      <p>Please check your banking details in the supplier portal. Our team has been alerted.</p>
    `),
  }
}
```

- [ ] **Step 2: Wire `send-email` + webhook**

Add `payout-settled` / `payout-failed` type branches in `send-email/index.ts`. In `paystack-webhook/index.ts`, in the existing `transfer.success` branch (after `commission_records.payout_status='paid'`) invoke `send-email` `payout-settled` (context `'split'`) to the supplier org admin; in `transfer.failed` (after `payout_status='failed'`) invoke `payout-failed` to the supplier **and** an admin copy (reuse the eft-invoice admin-lookup pattern). Best-effort — email failure must not throw inside the webhook (it must still 200 to Paystack).

- [ ] **Step 3: Wire the terms settlement email**

In `markTermsOrderSettledAction` (Task 4), after a successful settle, best-effort invoke `send-email` `payout-settled` (context `'terms'`) to the supplier org admin with the order's `total_incl_vat` formatted. Failure must not fail the action.

- [ ] **Step 4: Test**

Deno unit test for the two template functions (subject/`<h1>` present, amount interpolated). For the webhook wiring, add/extend the existing webhook test to assert `send-email` is invoked on `transfer.failed` with `type: 'payout-failed'` (mock the functions client).
Run: `pnpm --filter web test -- terms.actions` (settlement-email path) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/email-templates/payout-settled.ts apps/edge-functions/supabase/functions/_shared/email-templates/payout-failed.ts apps/edge-functions/supabase/functions/send-email/index.ts apps/edge-functions/supabase/functions/paystack-webhook/index.ts apps/web/src/actions/terms.actions.ts
git commit -m "feat(marketplace): settlement + payout-failed notification emails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: RBAC matrix + Phase-4 verification sweep

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Add every Phase-4 route/action to the matrix**

Pages: `/supplier/terms` (supplier W, others —), `/supplier/payouts/statements` + `/[id]` (supplier W/R, others —), `/orders/[id]` settlement panel (supplier W on own orders, buyer W on own, client_viewer —). API: `GET /api/marketplace/commission-statement/pdf` (supplier owner/admin of the owning org only — RLS-gated). Actions: `placeOnAccountOrderAction` (`MARKETPLACE_BUYER_ROLES`), `setBuyerTermsAction` / `raiseTermsInvoiceAction` / `markTermsOrderSettledAction` (`SUPPLIER_PORTAL_ROLES`), `confirmTermsPaymentAction` (`MARKETPLACE_BUYER_ROLES`). Note the `NEXT_PUBLIC_PHASE_2_MARKETPLACE` flag + the R5 `tax_invoices_enabled` gate footnotes.

- [ ] **Step 2: Completeness checks**

- `pnpm --filter @esite/shared test && pnpm --filter web test` → all green.
- `turbo run type-check lint` → clean.
- Migrations `00210`–`00215` are sequential; each ends with `NOTIFY pgrst, 'reload schema'` (except the pure-cron 00215 which has it too for the comment-only file); none create a schema (no PostgREST `db_schema` PATCH needed).
- Grep confirms no hardcoded commission rate in Phase-4 code — the statement builder reads `commission_rate_for_supplier` (fallback 0.05 only in the documented EXCEPTION branch).
- Idempotency asserted for both the statement builder (unique `(supplier_id, period_month)`, frozen-when-sent) and the edge email loop (`email_sent_at IS NULL`).

- [ ] **Step 3: Phase gate — reviews**

Run **superpowers:requesting-code-review**; run **security-review** + **security-audit** (mandatory for this phase per the index — focus: `organisation_suppliers` supplier-UPDATE RLS, statement tables service-role-write, PDF-route RLS-as-gate returning 404 for non-owners, `SECURITY DEFINER` `search_path` on the two SQL fns, webhook still returns 200 on email failure). Recommend the user run `/code-review ultra`. Then **superpowers:finishing-a-development-branch**.

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise marketplace Phase-4 terms/reconciliation routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** Task 1 ↔ §5.2 (on-account checkout, credit limit, due date); Task 2 ↔ §2.4/§5.2 (per-buyer terms mgmt); Task 3 ↔ §5.2/§10 + R5 (terms tax invoice, gated); Task 4 ↔ §6.4 (settlement tracking); Task 5 ↔ §6.4/§6.5/§10 (monthly reconciliation statement + PDF + email, idempotent); Task 6 ↔ §6.2/§10 (settlement + payout-failed emails, also Phase-2 pay-now); Task 7 ↔ §11 (RBAC matrix + review gates).
- **Decision R2:** default (monthly statement) applied; two alternatives recorded.
- **Canonical names honoured:** reuses `marketplace.orders`, `suppliers.organisation_suppliers` (`credit_limit`/`payment_terms_days`), `marketplace.commission_records`/`commission_payouts`, `send-email`, `_shared/email-templates/base.ts`, the `cloud-sync-cron`/`pg_cron` pattern, the `require-role` helpers, `SUPPLIER_PORTAL_ROLES`/`MARKETPLACE_BUYER_ROLES`, and the money helper — all verified against real code. Forward-refs to Phase 1 (`supplier_settings`) and Phase 2 (`payment_mode`, cent tax columns, `tax_invoices`, `commission_config`, `commission_rate_for_supplier`) are called out as such.
- **Placeholders:** none load-bearing. The two "reuse the Phase-2 checkout order-item writer" and "match `base.ts` signature" notes are deliberate read-first steps, not deferred work; the `placeOnAccountOrderAction` `order_items` insert is explicitly the same code as pay-now minus the charge.
- **Money:** all Phase-4 arithmetic is integer cents via `@esite/shared`; the one rand→cents boundary (`organisation_suppliers.credit_limit`) is converted in `creditLimitToCents`; per-order commission rounds with `CEIL` to match the webhook's `Math.ceil`.
- **Idempotency & safety:** statement builder is upsert + frozen-when-sent; edge loop guards on `email_sent_at`; cron double-fire is harmless; webhook email sends are best-effort and never block the 200.
- **Migrations:** 00210–00215, all in existing schemas → `NOTIFY pgrst` only. Supplier-side RLS on `organisation_suppliers` and the statement tables' service-role-write posture are the security-sensitive changes flagged for the mandatory security-review.

## Cross-phase assumptions (must hold before executing)

1. **Phase 2 shipped `marketplace.orders.payment_mode`** (`pay_now|on_account`) and the **integer-cent** tax columns `subtotal_ex_vat` / `vat_amount` / `total_incl_vat`. Phase 4 sums `subtotal_ex_vat` (ex-VAT, for commission) and `total_incl_vat` (for outstanding-credit). If Phase 2 stored these as rand `NUMERIC`, the money math + the `BIGINT` statement columns must be reconciled to cents first (index money rule).
2. **Phase 2 shipped `marketplace.commission_config`** with a reader `marketplace.commission_rate_for_supplier(uuid)` returning the effective rate (default 5%). The statement builder calls it and falls back to `0.05` only in a documented `EXCEPTION WHEN undefined_function` branch; the R5 flag (`tax_invoices_enabled`) is stored in that same config — Task 3's migration must match Phase 2's actual config shape (key/value vs typed row).
3. **Phase 2 shipped `marketplace.tax_invoices`** (order-linked invoice header with cent totals + `invoice_number` + `issued_at`); Phase 4 only `ALTER`s it (invoice_kind/terms/due_date/number_issued). Column names must be confirmed against the Phase-2 migration before writing 00214.
4. **Phase 1 shipped `marketplace.supplier_settings`** exposing `payment_modes` (which modes a supplier offers) and default terms; the on-account checkout branch and UI read it to decide visibility.
5. **`pg_cron` + `pg_net` are enabled** on the project (they are — see `00148`/`00031`) and `app.settings.service_role_key` is set per environment for the cron `net.http_post` auth.
6. **Phase 0 shipped** `SUPPLIER_PORTAL_ROLES`, `MARKETPLACE_BUYER_ROLES`, and the money helper in `@esite/shared`, and hardened `marketplace.orders` RLS (client_viewer exclusion) that these order reads/writes inherit.
