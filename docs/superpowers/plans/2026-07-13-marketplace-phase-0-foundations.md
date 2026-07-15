# Marketplace Phase 0 — Foundations & Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inherit all conventions from `2026-07-13-marketplace-implementation-index.md` (worktree, migrations auto-apply on merge, vitest gates, RBAC-matrix rule, commit trailer).

**Goal:** Remove the latent inconsistencies and security debt in the existing marketplace code so every later phase builds on solid, single-source foundations — no user-visible launch.

**Architecture:** Small, independent, mostly-mechanical changes in `@esite/shared`, `@esite/db`, `apps/web` server actions/UI, and two SQL migrations. Each task is self-contained and independently revertable. Nothing is un-gated from the `NEXT_PUBLIC_PHASE_2_MARKETPLACE` flag.

**Tech Stack:** Next.js 15 (App Router, server actions), TypeScript, Zod, Supabase/Postgres (RLS, RPC, migrations), Paystack, vitest.

**Scope (7 tasks):** 1) canonical category taxonomy · 2) single-source commission (5% + bearer subaccount) · 3) money helper (cents) · 4) marketplace role groups + gate existing writes + supplier ownership checks · 5) `marketplace.orders` RLS hardening · 6) transactional supplier registration + welcome email · 7) RBAC-matrix + Phase-0 verification sweep.

---

## Task 1: Canonical marketplace category taxonomy

Resolves the 5 (register) / 7 (catalogue) / 5 (buyer directory) divergence into one shared source.

**Files:**
- Create: `packages/shared/src/marketplace/categories.ts`
- Test: `packages/shared/src/__tests__/marketplace/categories.test.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Modify: `apps/web/src/app/(marketplace)/register/RegisterSupplierForm.tsx` (replace local `CATEGORIES`)
- Modify: `apps/web/src/app/(marketplace)/supplier/catalogue/CatalogueItemForm.tsx` (replace local `CATEGORIES`)
- Modify: `apps/web/src/app/(admin)/marketplace/page.tsx` (replace local `CATEGORIES` + icon map)
- Modify: `apps/web/src/actions/supplier.actions.ts` (category zod → shared values)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/marketplace/categories.test.ts
import { describe, it, expect } from 'vitest'
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_VALUES,
  isMarketplaceCategory,
} from '../../marketplace/categories'

describe('marketplace categories', () => {
  it('exposes the 7 canonical categories in order', () => {
    expect(MARKETPLACE_CATEGORY_VALUES).toEqual([
      'electrical', 'mechanical', 'civil', 'safety', 'tools', 'materials', 'general',
    ])
  })
  it('includes tools and materials (the catalogue-only values)', () => {
    expect(MARKETPLACE_CATEGORY_VALUES).toContain('tools')
    expect(MARKETPLACE_CATEGORY_VALUES).toContain('materials')
  })
  it('every category has a label and an icon', () => {
    for (const c of MARKETPLACE_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.icon.length).toBeGreaterThan(0)
    }
  })
  it('validates membership', () => {
    expect(isMarketplaceCategory('electrical')).toBe(true)
    expect(isMarketplaceCategory('plumbing')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- categories`
Expected: FAIL — cannot resolve `../../marketplace/categories`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/marketplace/categories.ts
/** Canonical marketplace supplier/catalogue category taxonomy — single source. */
export interface MarketplaceCategory {
  value: string
  label: string
  icon: string
}

export const MARKETPLACE_CATEGORIES: readonly MarketplaceCategory[] = [
  { value: 'electrical', label: 'Electrical', icon: '⚡' },
  { value: 'mechanical', label: 'Mechanical', icon: '⚙' },
  { value: 'civil',      label: 'Civil',      icon: '🏗' },
  { value: 'safety',     label: 'Safety',     icon: '🦺' },
  { value: 'tools',      label: 'Tools',      icon: '🔧' },
  { value: 'materials',  label: 'Materials',  icon: '🧱' },
  { value: 'general',    label: 'General',    icon: '📦' },
] as const

export const MARKETPLACE_CATEGORY_VALUES: readonly string[] =
  MARKETPLACE_CATEGORIES.map((c) => c.value)

export function isMarketplaceCategory(value: string): boolean {
  return MARKETPLACE_CATEGORY_VALUES.includes(value)
}
```

- [ ] **Step 4: Export from the shared package index**

Add to `packages/shared/src/index.ts`:
```ts
export * from './marketplace/categories'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @esite/shared test -- categories`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the three UIs + the action to the shared source**

In `RegisterSupplierForm.tsx` and `CatalogueItemForm.tsx`: delete the local `const CATEGORIES = …` and instead `import { MARKETPLACE_CATEGORIES } from '@esite/shared'`; render from it (map `value`/`label`). In `(admin)/marketplace/page.tsx`: delete the local `CATEGORIES` array and the icon map; import `MARKETPLACE_CATEGORIES` and read `icon` from it. In `supplier.actions.ts`, change the catalogue/register category validation to `z.string().refine(isMarketplaceCategory, 'Unknown category.')` (import `isMarketplaceCategory` from `@esite/shared`).

- [ ] **Step 7: Verify types, lint, and render**

Run: `pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. Then with the **run** skill, visually confirm all 7 categories render on register, catalogue-new, and the buyer directory (behind the flag).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/marketplace apps/web/src/app apps/web/src/actions/supplier.actions.ts packages/shared/src/index.ts packages/shared/src/__tests__/marketplace
git commit -m "feat(marketplace): canonical category taxonomy in @esite/shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Single-source commission — 5% + bearer subaccount

Reconciles the three-way 6%-vs-5% conflict and the `bearer_type: 'all'` vs decided `subaccount`.

**Files:**
- Modify: `packages/db/src/services/payment.service.ts:16` (`DEFAULT_COMMISSION_RATE`), `:215-244` (`createSplit` bearer), createSubaccount call semantics
- Modify: `packages/shared/src/__tests__/commission/commission.test.ts` (6% → 5% expectations)
- Modify: `apps/web/src/app/(marketplace)/supplier/profile/PaystackOnboardingCard.tsx` (UI copy 6% → 5%)
- Modify: `apps/web/src/app/api/paystack/subaccount/route.ts` (percentageCharge value)
- Create: `apps/edge-functions/supabase/migrations/00173_marketplace_commission_rate_5pct.sql`
- Also: `apps/edge-functions/supabase/functions/marketplace-payment/index.ts` (`DEFAULT_COMMISSION_RATE = 0.06` → `0.05`)

- [ ] **Step 1: Update the commission test to the 5% contract (failing)**

In `commission.test.ts`, change the "Standard commission split" expectations from 6% to 5% (e.g. on R1,000.00 = 100000 kobo → `commissionKobo = 5000` (E-Site, rounds up), `supplierKobo = 95000`; keep the "commissionKobo + supplierKobo === totalKobo" invariant test). Update the header comment "Standard 6%" → "Standard 5%".

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- commission`
Expected: FAIL — current logic still computes 6%.

- [ ] **Step 3: Change the single rate constant**

`packages/db/src/services/payment.service.ts:16`:
```ts
const DEFAULT_COMMISSION_RATE = 0.05 // 5% — E-Site marketplace commission (master spec D5)
```
And the edge fn `marketplace-payment/index.ts`: `const DEFAULT_COMMISSION_RATE = 0.05`.

- [ ] **Step 4: Fix the split bearer to subaccount**

`payment.service.ts` `createSplit` (~:231): change
```ts
bearer_type: 'all',
```
to
```ts
bearer_type: 'subaccount',           // supplier absorbs the Paystack fee (master spec D6)
bearer_subaccount: params.supplierSubaccountCode,
```
(The `SplitPayload` interface already has `bearer_subaccount: string | null`; ensure `createSplit`'s params expose `supplierSubaccountCode`.)

- [ ] **Step 5: Set the subaccount percentage_charge to the commission**

In `api/paystack/subaccount/route.ts`, pass `percentageCharge: 5` (E-Site's commission — the value `createSubaccount` writes to Paystack's `percentage_charge`).
**Verification note (do not skip):** confirm against Paystack ZA docs that subaccount `percentage_charge` = *the platform's charge on the subaccount* (not the supplier's share). The current call passing `94` is inconsistent with the DB column semantics (`percentage_charge` = E-Site's cut, default 6.00). If Paystack semantics differ, adjust and record the finding in the plan/PR before proceeding.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @esite/shared test -- commission`
Expected: PASS (5% split, invariant holds).

- [ ] **Step 7: DB default migration**

```sql
-- apps/edge-functions/supabase/migrations/00173_marketplace_commission_rate_5pct.sql
-- Reconcile the marketplace commission default to 5% (master spec D5).
ALTER TABLE marketplace.paystack_subaccounts
  ALTER COLUMN percentage_charge SET DEFAULT 5.00;

-- Note: existing subaccount rows created at 6.00 must be re-synced with Paystack
-- when the split is (re)created in Phase 2; this migration only fixes the default.
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 8: Update onboarding UI copy**

In `PaystackOnboardingCard.tsx`, change "E-Site deducts 6% commission" → "E-Site deducts 5% commission" (and any "94%" wording → "95%").

- [ ] **Step 9: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add packages/db/src/services/payment.service.ts packages/shared/src/__tests__/commission apps/web/src/app/\(marketplace\)/supplier/profile/PaystackOnboardingCard.tsx apps/web/src/app/api/paystack/subaccount/route.ts apps/edge-functions/supabase/migrations/00173_marketplace_commission_rate_5pct.sql apps/edge-functions/supabase/functions/marketplace-payment/index.ts
git commit -m "fix(marketplace): reconcile commission to 5% + bearer subaccount

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Money helper (integer cents)

One representation for money so the kobo/rand split stops being a foot-gun. Adopted incrementally as tables are touched in later phases.

**Files:**
- Create: `packages/shared/src/money/money.ts`
- Test: `packages/shared/src/__tests__/money/money.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/money/money.test.ts
import { describe, it, expect } from 'vitest'
import { randToCents, centsToRand, formatZARFromCents, addCents } from '../../money/money'

describe('money helper (cents)', () => {
  it('converts rand to integer cents without float drift', () => {
    expect(randToCents(19.99)).toBe(1999)
    expect(randToCents(0.1 + 0.2)).toBe(30) // 0.30, not 0.30000000004
  })
  it('converts cents back to rand', () => {
    expect(centsToRand(1999)).toBe(19.99)
  })
  it('formats ZAR from cents', () => {
    expect(formatZARFromCents(123456)).toBe('R 1 234,56')
  })
  it('adds cents exactly', () => {
    expect(addCents(1999, 1)).toBe(2000)
  })
})
```
(If the repo already exposes a `formatZAR` with a specific glyph/format, match that format string exactly instead of the assertion above — read `apps/web/src/lib/format` or the existing `formatZAR` first and align the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- money`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/money/money.ts
/** Money is represented as integer cents (ZAR). Never do arithmetic on floats. */
export function randToCents(rand: number): number {
  return Math.round(rand * 100)
}
export function centsToRand(cents: number): number {
  return cents / 100
}
export function addCents(...values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
export function formatZARFromCents(cents: number): string {
  const rand = centsToRand(cents)
  // Match the existing formatZAR output format used across the app.
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
  }).format(rand)
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Add `export * from './money/money'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- money`
Expected: PASS. (Adjust `formatZARFromCents`'s locale/format to match the repo's existing formatter if the assertion differs.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/money packages/shared/src/__tests__/money packages/shared/src/index.ts
git commit -m "feat(shared): integer-cents money helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Marketplace role groups + gate existing writes + supplier ownership checks

Closes the "no role gate on marketplace writes" + "id-only mutations" gaps (currently masked only by the feature flag).

**Files:**
- Modify: `packages/shared/src/types/index.ts` (add `MARKETPLACE_BUYER_ROLES`, `SUPPLIER_PORTAL_ROLES`)
- Test: `packages/shared/src/__tests__/marketplace/roles.test.ts`
- Modify: `apps/web/src/actions/supplier.actions.ts` (gate `placeOrderAction`, `updateOrderStatusAction`; ownership check on `updateSupplierProfileAction`, `updateCatalogueItemAction`, `toggleCatalogueVisibilityAction`)
- Modify: `apps/web/src/actions/rating.actions.ts` (gate `submitRatingAction`)

- [ ] **Step 1: Write the failing test for the role groups**

```ts
// packages/shared/src/__tests__/marketplace/roles.test.ts
import { describe, it, expect } from 'vitest'
import { MARKETPLACE_BUYER_ROLES, SUPPLIER_PORTAL_ROLES } from '../../types'

describe('marketplace role groups', () => {
  it('buyer roles are the write-capable firm roles incl. contractor, excl. read-only site roles', () => {
    expect([...MARKETPLACE_BUYER_ROLES].sort()).toEqual(
      ['admin', 'contractor', 'owner', 'project_manager'])
    expect(MARKETPLACE_BUYER_ROLES).not.toContain('client_viewer')
    expect(MARKETPLACE_BUYER_ROLES).not.toContain('inspector')
  })
  it('supplier-portal roles are the owner/admin of the supplier org', () => {
    expect([...SUPPLIER_PORTAL_ROLES].sort()).toEqual(['admin', 'owner'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- roles`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Add the groups**

Append to `packages/shared/src/types/index.ts` (next to the other groups):
```ts
/**
 * Firm-side roles allowed to browse/cart/checkout/pay/rate in the marketplace.
 * Mirrors MARKUP_WRITE_ROLES (owner/admin/PM/contractor) — the contractor buys —
 * and excludes the read-only site roles (inspector/supplier/client_viewer).
 */
export const MARKETPLACE_BUYER_ROLES: readonly OrgRole[] =
  ['owner', 'admin', 'project_manager', 'contractor']

/** Roles that may manage a supplier org's marketplace presence (its own org). */
export const SUPPLIER_PORTAL_ROLES: readonly OrgRole[] = ['owner', 'admin']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @esite/shared test -- roles`
Expected: PASS.

- [ ] **Step 5: Gate the buyer write actions**

In `supplier.actions.ts` `placeOrderAction` and `updateOrderStatusAction`, and `rating.actions.ts` `submitRatingAction`: after resolving the caller's org, replace the auth-only guard with a role check using the existing helper, e.g.:
```ts
import { requireRole } from '@/lib/auth/require-role'
import { MARKETPLACE_BUYER_ROLES } from '@esite/shared'
// …
const guard = await requireRole(supabase, contractorOrgId, MARKETPLACE_BUYER_ROLES)
if ('error' in guard) return { error: 'Not authorised.' }
```
(Match the actual `requireRole` return shape from `apps/web/src/lib/auth/require-role.ts` — read it first; use `requireRoleAPI` in route handlers.)

- [ ] **Step 6: Add ownership checks to supplier mutations**

In `updateSupplierProfileAction`, `updateCatalogueItemAction`, `toggleCatalogueVisibilityAction`: before the id-only `.update(...)`, resolve the caller's supplier org and add `.eq('supplier_org_id', callerSupplierOrgId)` (catalogue) / verify the `suppliers.suppliers` row's `organisation_id` is a `SUPPLIER_PORTAL_ROLES` membership of the caller (profile). Do not rely on RLS alone.

- [ ] **Step 7: Write a route-gate integration test**

Add a web test (mirror the pattern in `apps/web` tenant/cable gate tests) asserting a `client_viewer`/`inspector` caller is rejected by `placeOrderAction` / `submitRatingAction` and an `owner`/`contractor` is allowed. (Reuse the existing e2e-cookie/gate harness referenced in memory `e2e-test-cookie-gated-routes`.)

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add packages/shared/src/types/index.ts packages/shared/src/__tests__/marketplace/roles.test.ts apps/web/src/actions/supplier.actions.ts apps/web/src/actions/rating.actions.ts
git commit -m "fix(marketplace): role-gate buyer writes + ownership-check supplier mutations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `marketplace.orders` RLS hardening

Adds the missing client_viewer exclusion + an explicit DELETE deny, mirroring the audited node_orders hardening (00161/00166).

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00174_marketplace_orders_rls_hardening.sql`

- [ ] **Step 1: Read the current policies (no code yet)**

Run (Management API read-only, or `supabase db` locally):
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'marketplace' AND tablename IN ('orders','order_items','supplier_ratings');
```
Confirm exact current policy names/definitions before writing DROP/CREATE.

- [ ] **Step 2: Write a failing check (RED probe)**

Using the rolled-back prod RED→GREEN probe pattern (memory `rolled-back-prod-red-green-probe`), in one transaction: seed a `client_viewer` membership on a buyer org with an order, assert it can currently SELECT/UPDATE the order (RED), then `RAISE` to roll back. This proves the gap before the fix.

- [ ] **Step 3: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00174_marketplace_orders_rls_hardening.sql
-- Exclude effective client_viewers from marketplace order read/write, and make
-- DELETE an explicit deny. Mirrors node_orders hardening (00161/00166).

-- Replace SELECT/UPDATE policies with client_viewer-excluding versions.
-- (Use the exact existing policy names confirmed in Step 1.)
DROP POLICY IF EXISTS "Contractors can view their orders" ON marketplace.orders;
CREATE POLICY "Contractors can view their orders" ON marketplace.orders
  FOR SELECT USING (
    contractor_org_id = ANY (public.get_user_org_ids())
    AND public.user_org_role(contractor_org_id) IS DISTINCT FROM 'client_viewer'
  );

DROP POLICY IF EXISTS "Contractors and suppliers can update orders" ON marketplace.orders;
CREATE POLICY "Contractors and suppliers can update orders" ON marketplace.orders
  FOR UPDATE USING (
    (contractor_org_id = ANY (public.get_user_org_ids())
       AND public.user_org_role(contractor_org_id) IS DISTINCT FROM 'client_viewer')
    OR (supplier_org_id = ANY (public.get_user_org_ids()))
  );

-- Explicit DELETE deny (belt-and-braces; no permissive DELETE policy exists).
CREATE POLICY "orders_no_delete" ON marketplace.orders
  FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
```
**Note:** if a `public.user_org_role(uuid)` helper does not exist, either reuse the effective-role helper used by node_orders (`user_effective_project_role` is project-scoped — orders are org-scoped, so prefer an org-role lookup) or add a small `SECURITY DEFINER` helper in this migration. Confirm in Step 1.

- [ ] **Step 4: Prove GREEN (rolled-back)**

Re-run the Step 2 probe with `CREATE OR REPLACE`/policy applied inside the same transaction; assert the `client_viewer` now gets zero rows on SELECT and a blocked UPDATE (GREEN), then roll back.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00174_marketplace_orders_rls_hardening.sql
git commit -m "fix(marketplace): harden orders RLS (client_viewer exclusion + delete deny)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Transactional supplier registration + welcome email

Makes `registerSupplierAction` all-or-nothing, email-confirmation-aware, and de-duplicated; sends a branded welcome (not just the generic auth confirm).

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00175_supplier_register_rpc.sql` (SECURITY DEFINER RPC)
- Modify: `apps/web/src/actions/supplier.actions.ts` (`registerSupplierAction` → call RPC; add `completeSupplierSetupAction`)
- Modify: `apps/web/src/app/(marketplace)/supplier/profile/page.tsx` (call `completeSupplierSetupAction` when no supplier row yet)
- Create: welcome email template + send (reuse the existing `send-email` edge function / Resend infra)
- Test: `apps/web/src/actions/__tests__/registerSupplier.test.ts` (dedupe + no-session behaviour)

- [ ] **Step 1: Write the RPC migration**

```sql
-- apps/edge-functions/supabase/migrations/00175_supplier_register_rpc.sql
-- Atomically create a supplier org + owner membership + supplier profile for the
-- authenticated caller. SECURITY DEFINER so it runs after the auth user exists.
CREATE OR REPLACE FUNCTION suppliers.register_supplier_org(
  p_company_name   text,
  p_trading_name   text,
  p_registration_no text,
  p_vat_number     text,
  p_province       text,
  p_address        text,
  p_categories     text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, suppliers AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_supplier uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Idempotency: reuse an existing supplier-type org the caller already owns.
  SELECT o.id INTO v_org
  FROM public.organisations o
  JOIN public.user_organisations m ON m.organisation_id = o.id
  WHERE m.user_id = v_uid AND o.type = 'supplier' AND m.is_active
  LIMIT 1;

  IF v_org IS NULL THEN
    INSERT INTO public.organisations (name, type) VALUES (p_company_name, 'supplier')
      RETURNING id INTO v_org;
    INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
      VALUES (v_uid, v_org, 'owner', true);
  END IF;

  SELECT id INTO v_supplier FROM suppliers.suppliers WHERE organisation_id = v_org;
  IF v_supplier IS NULL THEN
    INSERT INTO suppliers.suppliers
      (organisation_id, name, trading_name, registration_no, vat_number,
       province, address, categories, is_verified, is_active)
      VALUES (v_org, p_company_name, p_trading_name, p_registration_no, p_vat_number,
              p_province, p_address, p_categories, false, true)
      RETURNING id INTO v_supplier;
  END IF;

  RETURN v_supplier;
END $$;

REVOKE ALL ON FUNCTION suppliers.register_supplier_org(text,text,text,text,text,text,text[]) FROM public;
GRANT EXECUTE ON FUNCTION suppliers.register_supplier_org(text,text,text,text,text,text,text[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing action test**

```ts
// apps/web/src/actions/__tests__/registerSupplier.test.ts
import { describe, it, expect, vi } from 'vitest'
// Mock the Supabase client so signUp returns a user with NO session (email-confirm on)
// and assert registerSupplierAction does NOT attempt org/supplier inserts directly,
// but returns a "confirm your email" state; and that a second call with the same email
// does not create a duplicate org (dedupe via the RPC).
```
(Flesh out with the repo's existing server-action test harness/mocks — read a sibling action test first to match the mock style.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- registerSupplier`
Expected: FAIL — action still does 4 raw inserts.

- [ ] **Step 4: Rewrite `registerSupplierAction`**

Replace the 4 sequential inserts with: `signUp` → if a session exists, call `supabase.rpc('register_supplier_org', {...})` (schema `suppliers`), then send the welcome email, then `redirect('/supplier/profile?registered=1')`. If `signUp` returns a user but **no session** (email confirmation on), return `{ pendingConfirmation: true }` and do NOT insert — org/supplier creation is deferred to `completeSupplierSetupAction` on first authenticated load. Keep the Zod parse + POPIA consent as-is.

- [ ] **Step 5: Add `completeSupplierSetupAction` + call it from the profile page**

New action: for an authenticated caller with metadata `role='supplier'` but no `suppliers.suppliers` row, call the same RPC with the values persisted at signup (store the registration fields in `auth` user metadata at signUp, or in a lightweight pending row). `supplier/profile/page.tsx`: if the caller has no supplier row yet, invoke `completeSupplierSetupAction` before rendering.

- [ ] **Step 6: Wire the welcome email**

After a supplier row is created, invoke the existing `send-email` edge function (Resend) with a new `marketplace-supplier-welcome` template (subject + branded body + setup-checklist link). Add the template alongside the other transactional templates. Best-effort (failure must not break registration).

- [ ] **Step 7: Run tests to verify they pass + manual flow**

Run: `pnpm --filter web test -- registerSupplier`
Expected: PASS. Then, with the **run** skill + a throwaway email, walk the full journey (with and without email-confirmation) and confirm exactly one org/supplier row and one welcome email.

- [ ] **Step 8: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00175_supplier_register_rpc.sql apps/web/src/actions/supplier.actions.ts apps/web/src/app/\(marketplace\)/supplier/profile/page.tsx apps/web/src/actions/__tests__/registerSupplier.test.ts
git commit -m "fix(marketplace): transactional supplier registration + welcome email

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: RBAC matrix + Phase-0 verification sweep

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Itemise every marketplace route/action in the matrix**

Add rows for: `(marketplace)/register`, `/supplier/profile|catalogue|orders`, `(admin)/marketplace`, `/marketplace/[supplierId]`, `/marketplace/order/new`, `/marketplace/orders`, `/marketplace/[supplierId]/rate`, and the actions `registerSupplierAction`, `updateSupplierProfileAction`, `create/update/toggleCatalogueItemAction`, `placeOrderAction`, `updateOrderStatusAction`, `submitRatingAction` — with the role groups from Task 4. Note the Phase-2 flag footnote.

- [ ] **Step 2: Run the Phase-0 completeness checks**

- `pnpm --filter @esite/shared test && pnpm --filter web test` → all green.
- `turbo run type-check lint` → clean.
- Grep confirms no remaining local `CATEGORIES` arrays in the 3 UIs and no remaining `0.06`/`6%`/`bearer_type: 'all'` in the commission path.
- Confirm migrations `00173`–`00175` are sequential and each has the correct `NOTIFY`/PostgREST handling.

- [ ] **Step 3: Phase gate — review**

Run `superpowers:requesting-code-review` on the branch; run **security-review** (RLS + role gates + RPC `SECURITY DEFINER` search_path); recommend the user run `/code-review ultra`. Then `superpowers:finishing-a-development-branch`.

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise marketplace routes/actions (Phase 0)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** Task 1↔spec §3.1 (taxonomy); Task 2↔§0#12/§6.5 (commission); Task 3↔§9 (money units); Task 4↔§11 (role gates/ownership); Task 5↔§9/§11 (orders RLS); Task 6↔§2.1 (registration hardening + welcome email §10); Task 7↔§11 (RBAC matrix). Supplier-portal *context/sub-roles* (§1.2) is intentionally deferred to Phase 1 where the portal UI is exercised — noted in the index.
- **Placeholders:** none in-task; Steps that say "read the sibling test / confirm current policy names first" are deliberate verification steps, not deferred work.
- **Type consistency:** `MARKETPLACE_BUYER_ROLES`/`SUPPLIER_PORTAL_ROLES`/`MARKETPLACE_CATEGORIES`/`isMarketplaceCategory`/money helpers are referenced with the same names they are defined under.
- **Known follow-through:** Task 2 Step 5 (Paystack `percentage_charge` semantics) and Task 5 Step 1/Task 6 harness must confirm real signatures/policy names against the live code before writing — flagged inline.
