# Marketplace Phase 3 — Fulfilment & Deep Procurement Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inherit ALL conventions from `2026-07-13-marketplace-implementation-index.md` (worktree off `origin/main`, migrations auto-apply on merge, vitest gates, RBAC-matrix rule, commit trailer, feature flag `NEXT_PUBLIC_PHASE_2_MARKETPLACE`). Copy the TDD doc format of `2026-07-13-marketplace-phase-0-foundations.md`.

**Goal:** Turn a *paid/accepted* marketplace order into a tracked, fulfilled, project-integrated purchase: structured delivery-or-collection with a computed delivery fee, dispatch/delivery tracking with proof-of-delivery, a buyer "Confirm delivery" that completes the order and unlocks rating, and — the core of this phase — a report-back into E-Site's live material tracker (`structure.node_orders` + `structure.node_order_documents`) that advances `required → ordered → received` and attaches the tax invoice, **without regressing** the live tracker.

**Architecture:** Pure derivation logic in `@esite/shared/marketplace/*` (unit-tested exactly like `structure/node-order.service.ts`), persistence in `apps/web/src/actions/*` server actions gated by the require-role helpers, seven additive SQL migrations (`00200`–`00206`), one new private storage bucket, and net-new/extended UI on the existing marketplace surfaces. Everything stays behind the Phase-2 flag.

**Tech Stack:** Next.js 15 (App Router, server actions), TypeScript, Zod, Supabase/Postgres (RLS, SECURITY DEFINER helpers, PostgREST service-role writes, migrations), Resend (edge `send-email`), vitest.

**Scope (7 tasks):** 1) supplier fulfilment settings (extend `supplier_settings`) + pure delivery-fee engine · 2) structured `delivery_addresses` + delivery-vs-collection + fee line on `orders` · 3) `order_fulfilment` tracking + POD bucket + supplier dispatch/deliver actions · 4) buyer "Confirm delivery" → `completed` + rating unlock · 5) deep procurement integration (order-line ↔ `node_orders` linkage, monotonic advancement, tax-invoice flow-back) · 6) fulfilment emails (dispatched/delivered → buyer, delivery-confirmed → supplier) · 7) RBAC-matrix + Phase-3 verification sweep.

---

## ⚠ Cross-phase assumptions & a load-bearing correction (read before Task 1)

**Verified against live prod (`cbskbnvvgcybmfikxgky`, main = `f3d3e5a`) on 2026-07-14:**

1. **`projects.procurement_items` and `projects.supplier_invoices` DO NOT EXIST.** They were created in `00002`/`00049` and **dropped by migration `00087_drop_procurement_module.sql`** — the whole 5-stage BOM/procurement module was deliberately torn down and *replaced by the unified Material Order Tracker* (`structure.node_orders` + `structure.node_order_documents`, migrations `00083`/`00086`). The 2026-07-13 investigation §3.4 and the target spec §8 both describe these two tables as live integration targets — **that is stale.** `information_schema` on prod returns only `structure.node_orders`, `structure.node_order_documents`, `marketplace.{orders,order_items,catalogue_items,paystack_subaccounts,commission_records}`, `suppliers.{suppliers,organisation_suppliers}`.
   - **Consequence (this reshapes decision R3):** "deep procurement integration" re-targets onto the **live** tracker. The default R3 mapping "1 order line → 1 `procurement_items` row" is re-cast as **1 order line → optional tag of one `structure.node_orders` line** (`node_order_id`), with `node_id` stored for project/node display context and a **reserved, inert `procurement_item_id` column (no FK)** kept only to honour the spec's naming for a possible future procurement-module revival. *Alternative (noted, deferred):* revive `projects.procurement_items`/`supplier_invoices` wholesale — rejected: heavier, reintroduces the disjoint model `00087` intentionally removed, and would regress the live tracker.
   - **Invoice flow-back** therefore attaches to **`structure.node_order_documents`** (doc_type extended to include `'invoice'`), the live replacement for the dropped `supplier_invoices`.

2. **Phase 1 created `marketplace.supplier_settings`.** It does not exist on prod yet (Phase 1 unmerged). Task 1 is defensively self-contained (`CREATE TABLE IF NOT EXISTS` then `ADD COLUMN IF NOT EXISTS`) so it applies whether or not Phase 1's exact shape landed.

3. **Phase 0 gave `@esite/shared` the money helper + role groups.** This plan uses `randToCents`/`centsToRand`/`formatZARFromCents`/`addCents`, `MARKETPLACE_BUYER_ROLES`, `SUPPLIER_PORTAL_ROLES` (all Phase 0), and reuses `ORG_WRITE_ROLES` for `node_orders` writes (existing).

4. **Phase 2 owns the commercial order lifecycle on `orders.status`** (`pending_payment → paid → accepted → … → completed`, `payment_status` extension) and the pay-now/accept path. Phase 3 keeps the **operational fulfilment sub-status on its own table** (`order_fulfilment.status ∈ {preparing,dispatched,delivered}` — an orthogonal axis, not a duplicate of `orders.status`) and only writes `orders.status='completed'` at buyer confirm-delivery. **Assumption:** Phase 2 has already added `'completed'` (and `'accepted'`/`'paid'`) to the `orders_status_check`. If not yet present when this phase executes, Task 4 Step 0 reconciles the CHECK (a guarded DROP+ADD) — do NOT silently skip it. *(Live `orders_status_check` today is the pre-Phase-2 `draft/submitted/confirmed/in_transit/delivered/invoiced/cancelled`.)*

5. **Live helper functions confirmed present** and reused by new RLS: `public.get_user_org_ids()`, `public.user_is_client_viewer(uuid)`, `public.user_has_project_access(uuid)`, `public.user_can_manage_project(uuid)`, `public.user_effective_project_role(uuid)`. **No `public.user_org_role` exists** — do not reference it.

6. **Cross-schema write gotcha (still in force).** supabase-js `.schema('structure'|'marketplace').from(...).update()` strips the service-role header → RLS denies. All service-role writes go via raw `fetch` to PostgREST with `Content-Profile` + service key, exactly as `apps/web/src/actions/node-order.actions.ts` does. Reads use the cookie client.

---

## Task 1: Supplier fulfilment settings + pure delivery-fee engine

Extends the Phase-1 `marketplace.supplier_settings` with fulfilment configuration and adds the pure, unit-tested fee resolver used at checkout (Task 2).

**Files:**
- Create: `packages/shared/src/marketplace/delivery-fee.ts`
- Test: `packages/shared/src/__tests__/marketplace/delivery-fee.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Create: `apps/edge-functions/supabase/migrations/00200_supplier_settings_fulfilment.sql`
- Create: `apps/web/src/actions/supplier-fulfilment.actions.ts`
- Modify: `apps/web/src/app/(marketplace)/supplier/settings/page.tsx` (fulfilment section; create the route if Phase 1 has not)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/marketplace/delivery-fee.test.ts
import { describe, it, expect } from 'vitest'
import {
  computeDeliveryFeeCents,
  collectionFeeCents,
  type DeliveryFeeRule,
} from '../../marketplace/delivery-fee'

describe('computeDeliveryFeeCents', () => {
  it('flat rule returns the flat fee regardless of subtotal/province', () => {
    const rule: DeliveryFeeRule = { type: 'flat', feeCents: 8500 }
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 10000 })).toBe(8500)
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 9_000_000 })).toBe(8500)
  })

  it('free_over_threshold: free at/above threshold, fee below', () => {
    const rule: DeliveryFeeRule = { type: 'free_over_threshold', thresholdCents: 500000, feeCents: 12000 }
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 499999 })).toBe(12000)
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 500000 })).toBe(0) // boundary inclusive
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 500001 })).toBe(0)
  })

  it('by_province uses the province fee, falls back to default for unknown/missing', () => {
    const rule: DeliveryFeeRule = {
      type: 'by_province',
      feeByProvince: { 'Western Cape': 6000, Gauteng: 9000 },
      defaultCents: 15000,
    }
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 1, buyerProvince: 'Gauteng' })).toBe(9000)
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 1, buyerProvince: 'Limpopo' })).toBe(15000)
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 1, buyerProvince: null })).toBe(15000)
    expect(computeDeliveryFeeCents(rule, { subtotalExVatCents: 1 })).toBe(15000)
  })

  it('never returns a negative fee (clamps + rounds)', () => {
    expect(computeDeliveryFeeCents({ type: 'flat', feeCents: -50 }, { subtotalExVatCents: 0 })).toBe(0)
    expect(computeDeliveryFeeCents({ type: 'flat', feeCents: 8500.6 }, { subtotalExVatCents: 0 })).toBe(8501)
  })

  it('collection is always free', () => {
    expect(collectionFeeCents()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- delivery-fee`
Expected: FAIL — cannot resolve `../../marketplace/delivery-fee`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/marketplace/delivery-fee.ts
/**
 * Pure delivery-fee resolver (integer cents). Mirrors the node-order.service
 * philosophy: no DB calls, no side effects — the caller owns persistence.
 * Rule shapes cover spec §7 (flat / free-over-threshold / by-area). "by order
 * value" beyond a free-over threshold is intentionally deferred (note in the
 * plan); collection is always zero.
 */

export type DeliveryFeeRule =
  | { type: 'flat'; feeCents: number }
  | { type: 'free_over_threshold'; thresholdCents: number; feeCents: number }
  | { type: 'by_province'; feeByProvince: Record<string, number>; defaultCents: number }

export interface DeliveryFeeInput {
  /** Order subtotal ex-VAT, integer cents. */
  subtotalExVatCents: number
  /** Buyer delivery-address province (one of the 9 SA provinces). */
  buyerProvince?: string | null
}

function clamp(cents: number): number {
  return Math.max(0, Math.round(cents))
}

export function computeDeliveryFeeCents(rule: DeliveryFeeRule, input: DeliveryFeeInput): number {
  switch (rule.type) {
    case 'flat':
      return clamp(rule.feeCents)
    case 'free_over_threshold':
      return input.subtotalExVatCents >= rule.thresholdCents ? 0 : clamp(rule.feeCents)
    case 'by_province': {
      const prov = (input.buyerProvince ?? '').trim()
      const fee = prov && prov in rule.feeByProvince ? rule.feeByProvince[prov] : rule.defaultCents
      return clamp(fee)
    }
  }
}

/** Collection never incurs a delivery fee. */
export function collectionFeeCents(): number {
  return 0
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Add `export * from './marketplace/delivery-fee'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- delivery-fee`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00200_supplier_settings_fulfilment.sql
-- =============================================================================
-- Phase 3 · Task 1 — supplier fulfilment settings
-- Extends marketplace.supplier_settings (created in Phase 1) with fulfilment
-- configuration. Self-contained: creates a minimal table if Phase 1's did not
-- land, then adds fulfilment columns idempotently.
-- =============================================================================

CREATE TABLE IF NOT EXISTS marketplace.supplier_settings (
    supplier_id   UUID PRIMARY KEY REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketplace.supplier_settings
    ADD COLUMN IF NOT EXISTS offers_delivery        BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS offers_collection      BOOLEAN NOT NULL DEFAULT FALSE,
    -- DeliveryFeeRule discriminated union (see @esite/shared delivery-fee.ts).
    ADD COLUMN IF NOT EXISTS delivery_fee_rule      JSONB   NOT NULL DEFAULT '{"type":"flat","feeCents":0}'::jsonb,
    ADD COLUMN IF NOT EXISTS service_area_provinces TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS collection_address     TEXT,
    ADD COLUMN IF NOT EXISTS collection_hours       TEXT,
    ADD COLUMN IF NOT EXISTS dispatch_sla_days       INTEGER NOT NULL DEFAULT 1
        CONSTRAINT supplier_settings_dispatch_sla_nonneg CHECK (dispatch_sla_days >= 0);

-- updated_at trigger (guarded — Phase 1 may already have created it).
DROP TRIGGER IF EXISTS supplier_settings_updated_at ON marketplace.supplier_settings;
CREATE TRIGGER supplier_settings_updated_at
    BEFORE UPDATE ON marketplace.supplier_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE marketplace.supplier_settings ENABLE ROW LEVEL SECURITY;

-- Supplier org owner/admin manages its own settings; any linked buyer may read
-- (checkout needs offers_* + fee rule). SECURITY DEFINER helper avoids the
-- inline-RLS-join-returns-nothing bug (2026-05-21 storage-RLS lesson).
CREATE OR REPLACE FUNCTION marketplace.supplier_org_id(p_supplier_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT organisation_id FROM suppliers.suppliers WHERE id = p_supplier_id
$$;
GRANT EXECUTE ON FUNCTION marketplace.supplier_org_id(uuid) TO authenticated;

DROP POLICY IF EXISTS supplier_settings_select ON marketplace.supplier_settings;
CREATE POLICY supplier_settings_select ON marketplace.supplier_settings
    FOR SELECT TO authenticated
    USING (TRUE);  -- settings are non-sensitive; buyers need offers_*/fee at checkout

DROP POLICY IF EXISTS supplier_settings_write ON marketplace.supplier_settings;
CREATE POLICY supplier_settings_write ON marketplace.supplier_settings
    FOR ALL TO authenticated
    USING (
        marketplace.supplier_org_id(supplier_id) = ANY (public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(marketplace.supplier_org_id(supplier_id))
    )
    WITH CHECK (
        marketplace.supplier_org_id(supplier_id) = ANY (public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(marketplace.supplier_org_id(supplier_id))
    );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Write the settings action (ownership-gated)**

```ts
// apps/web/src/actions/supplier-fulfilment.actions.ts
'use server'

/**
 * Fulfilment settings for a supplier org. Gated on SUPPLIER_PORTAL_ROLES of the
 * org that OWNS the supplier row (ownership check — never id-only + RLS-only).
 * The delivery_fee_rule shape mirrors @esite/shared DeliveryFeeRule exactly.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { SUPPLIER_PORTAL_ROLES } from '@esite/shared'

const feeRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flat'), feeCents: z.number().int().min(0) }),
  z.object({ type: z.literal('free_over_threshold'), thresholdCents: z.number().int().min(0), feeCents: z.number().int().min(0) }),
  z.object({ type: z.literal('by_province'), feeByProvince: z.record(z.number().int().min(0)), defaultCents: z.number().int().min(0) }),
])

const settingsSchema = z.object({
  supplierId: z.string().uuid(),
  offersDelivery: z.boolean(),
  offersCollection: z.boolean(),
  deliveryFeeRule: feeRuleSchema,
  serviceAreaProvinces: z.array(z.string()).max(9),
  collectionAddress: z.string().max(500).nullish(),
  collectionHours: z.string().max(200).nullish(),
  dispatchSlaDays: z.number().int().min(0).max(60),
}).refine((v) => v.offersDelivery || v.offersCollection, {
  message: 'At least one of delivery or collection must be offered.',
})

export type UpdateFulfilmentSettingsResult = { ok: true } | { error: string }

export async function updateFulfilmentSettingsAction(
  input: unknown,
): Promise<UpdateFulfilmentSettingsResult> {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  const d = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve the org that owns this supplier row, then role-gate on it.
  const { data: supplierRow } = await supabase
    .schema('suppliers').from('suppliers')
    .select('organisation_id').eq('id', d.supplierId).maybeSingle()
  const ownerOrgId = (supplierRow as { organisation_id: string | null } | null)?.organisation_id
  if (!ownerOrgId) return { error: 'Supplier not found or not on-platform.' }

  const guard = await requireRole(supabase, ownerOrgId, SUPPLIER_PORTAL_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await supabase
    .schema('marketplace').from('supplier_settings')
    .upsert({
      supplier_id: d.supplierId,
      offers_delivery: d.offersDelivery,
      offers_collection: d.offersCollection,
      delivery_fee_rule: d.deliveryFeeRule,
      service_area_provinces: d.serviceAreaProvinces,
      collection_address: d.collectionAddress ?? null,
      collection_hours: d.collectionHours ?? null,
      dispatch_sla_days: d.dispatchSlaDays,
    }, { onConflict: 'supplier_id' })
  if (error) return { error: error.message }

  revalidatePath('/supplier/settings')
  return { ok: true }
}
```

**Verification note (do not skip):** confirm the RLS UPDATE path works for the supplier owner from a cookie client (the `supplier_settings_write` policy uses the SECURITY DEFINER `supplier_org_id`). If the upsert 401/403s, the supabase-js cross-schema header-strip may apply to `marketplace` writes — if so, switch this action to the `structurePost` service-role PostgREST pattern (Task 3), keeping the `requireRole` gate.

- [ ] **Step 7: Wire the settings UI**

In `(marketplace)/supplier/settings/page.tsx`, add a "Fulfilment" `Card` (create the page if Phase 1 has not): toggles for delivery/collection, a fee-rule editor (radio for `flat | free_over_threshold | by_province` + the numeric inputs, all captured in **rand, converted to cents via `randToCents` before submit**), a 9-province multiselect for service areas, collection address/hours text, dispatch-SLA number. Submit → `updateFulfilmentSettingsAction`. Gate the page with `requireRolePage(SUPPLIER_PORTAL_ROLES)`.

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. With the **run** skill, save a fee rule and confirm it round-trips.
```bash
git add packages/shared/src/marketplace/delivery-fee.ts packages/shared/src/__tests__/marketplace/delivery-fee.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/migrations/00200_supplier_settings_fulfilment.sql apps/web/src/actions/supplier-fulfilment.actions.ts apps/web/src/app/\(marketplace\)/supplier/settings/page.tsx
git commit -m "feat(marketplace): supplier fulfilment settings + pure delivery-fee engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Structured delivery address + delivery-vs-collection + fee line

Replaces "delivery folded into notes" (investigation §5.3) with a real `delivery_addresses` table and adds the fulfilment fields + fee line to `orders`, computed server-side at checkout.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00201_delivery_addresses.sql`
- Create: `apps/edge-functions/supabase/migrations/00202_orders_fulfilment_fields.sql`
- Modify: `apps/web/src/actions/supplier.actions.ts` (`placeOrderAction` — persist fulfilment_method/address/fee; use `computeDeliveryFeeCents`) OR the Phase-1 checkout action if it superseded it
- Modify: `apps/web/src/app/(admin)/marketplace/order/new/PlaceOrderForm.tsx` (delivery/collection choice + address form + fee preview)

- [ ] **Step 1: Write the address-table migration**

```sql
-- apps/edge-functions/supabase/migrations/00201_delivery_addresses.sql
-- =============================================================================
-- Phase 3 · Task 2 — structured buyer delivery addresses
-- Replaces the "delivery_address folded into orders.notes" hack (PlaceOrderForm).
-- Buyer-org owned; org-scoped RLS mirroring marketplace.orders (client_viewer
-- excluded from writes; no cross-org read).
-- =============================================================================

CREATE TABLE marketplace.delivery_addresses (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_org_id   UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    label          TEXT,                       -- "Site office", "Warehouse", …
    contact_name   TEXT NOT NULL,
    contact_phone  TEXT,
    line1          TEXT NOT NULL,
    line2          TEXT,
    suburb         TEXT,
    city           TEXT NOT NULL,
    province       TEXT NOT NULL,              -- one of the 9 SA provinces
    postal_code    TEXT,
    notes          TEXT,
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    created_by     UUID REFERENCES public.profiles(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_addresses_buyer ON marketplace.delivery_addresses (buyer_org_id);

CREATE TRIGGER delivery_addresses_updated_at
    BEFORE UPDATE ON marketplace.delivery_addresses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE marketplace.delivery_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY delivery_addresses_select ON marketplace.delivery_addresses
    FOR SELECT TO authenticated
    USING (buyer_org_id = ANY (public.get_user_org_ids()));

CREATE POLICY delivery_addresses_insert ON marketplace.delivery_addresses
    FOR INSERT TO authenticated
    WITH CHECK (
        buyer_org_id = ANY (public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(buyer_org_id)
    );

CREATE POLICY delivery_addresses_update ON marketplace.delivery_addresses
    FOR UPDATE TO authenticated
    USING (
        buyer_org_id = ANY (public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(buyer_org_id)
    );

CREATE POLICY delivery_addresses_delete ON marketplace.delivery_addresses
    FOR DELETE TO authenticated
    USING (
        buyer_org_id = ANY (public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(buyer_org_id)
    );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the orders-alter migration**

```sql
-- apps/edge-functions/supabase/migrations/00202_orders_fulfilment_fields.sql
-- =============================================================================
-- Phase 3 · Task 2 — fulfilment fields on marketplace.orders
-- fulfilment_method + delivery_address_id + delivery_fee_cents (integer cents,
-- server-computed). Does NOT touch orders.status (Phase 2 owns the commercial
-- lifecycle; the operational fulfilment sub-status lives on order_fulfilment).
-- =============================================================================

ALTER TABLE marketplace.orders
    ADD COLUMN IF NOT EXISTS fulfilment_method   TEXT
        CONSTRAINT orders_fulfilment_method_check
        CHECK (fulfilment_method IS NULL OR fulfilment_method IN ('delivery', 'collection')),
    ADD COLUMN IF NOT EXISTS delivery_address_id UUID
        REFERENCES marketplace.delivery_addresses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_fee_cents  INTEGER NOT NULL DEFAULT 0
        CONSTRAINT orders_delivery_fee_nonneg CHECK (delivery_fee_cents >= 0);

-- A delivery order must reference an address; a collection order must not.
-- Enforced as a table CHECK so a bad write can't slip through the action layer.
ALTER TABLE marketplace.orders
    DROP CONSTRAINT IF EXISTS orders_fulfilment_address_coherent;
ALTER TABLE marketplace.orders
    ADD CONSTRAINT orders_fulfilment_address_coherent CHECK (
        fulfilment_method IS DISTINCT FROM 'delivery' OR delivery_address_id IS NOT NULL
    );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Write a failing checkout test (fee is server-computed)**

Add a web test asserting `placeOrderAction` (or the Phase-1 checkout action) with `fulfilment_method='delivery'` + a chosen supplier fee rule persists `delivery_fee_cents = computeDeliveryFeeCents(rule, {subtotalExVatCents, buyerProvince})` and `delivery_address_id`, and that `fulfilment_method='collection'` persists `delivery_fee_cents = 0` and a null address. Mirror the existing action-test mock style (read a sibling in `apps/web/src/actions/__tests__` first; the dir is currently empty — reuse the e2e-cookie/gate harness from memory `e2e-test-cookie-gated-routes`).

Run: `pnpm --filter web test -- placeOrder` → Expected: FAIL (fields not persisted yet).

- [ ] **Step 4: Persist fulfilment in the checkout action**

In `placeOrderAction` (or the superseding Phase-1 checkout action): read the supplier's `supplier_settings.delivery_fee_rule` + `offers_*`; validate the buyer's chosen `fulfilment_method` is offered; for `delivery`, require a `delivery_address_id` owned by the buyer org, load its `province`, and set `delivery_fee_cents = computeDeliveryFeeCents(rule, { subtotalExVatCents, buyerProvince })`; for `collection`, set `delivery_fee_cents = 0` and null address. **Never trust a client-sent fee.** Keep the existing role gate (Phase 0 added `MARKETPLACE_BUYER_ROLES`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- placeOrder` → Expected: PASS.

- [ ] **Step 6: Wire the checkout UI**

In `PlaceOrderForm.tsx`: add a delivery/collection radio (only options the supplier offers), a saved-address picker + "add address" inline form (writes `delivery_addresses`), and a live fee + VAT + total preview using `formatZARFromCents`. Remove the delivery-address-into-notes concatenation.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint`
```bash
git add apps/edge-functions/supabase/migrations/00201_delivery_addresses.sql apps/edge-functions/supabase/migrations/00202_orders_fulfilment_fields.sql apps/web/src/actions/supplier.actions.ts apps/web/src/app/\(admin\)/marketplace/order/new/PlaceOrderForm.tsx apps/web/src/actions/__tests__
git commit -m "feat(marketplace): structured delivery address + fulfilment method + server-computed fee

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Order fulfilment tracking + POD bucket + supplier dispatch/deliver

The operational fulfilment sub-lifecycle (`preparing → dispatched → delivered`) with dispatch metadata + proof-of-delivery, on a dedicated 1:1 table. Pure state-machine in `@esite/shared`; supplier-gated service-role writes.

**Files:**
- Create: `packages/shared/src/marketplace/order-fulfilment.service.ts`
- Test: `packages/shared/src/__tests__/marketplace/order-fulfilment.service.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Create: `apps/edge-functions/supabase/migrations/00203_order_fulfilment.sql`
- Create: `apps/edge-functions/supabase/migrations/00204_marketplace_pod_bucket.sql`
- Create: `apps/web/src/actions/order-fulfilment.actions.ts`
- Modify: `apps/web/src/app/(marketplace)/supplier/orders/[orderId]/*` (dispatch + deliver + POD upload UI)

- [ ] **Step 1: Write the failing state-machine test**

```ts
// packages/shared/src/__tests__/marketplace/order-fulfilment.service.test.ts
import { describe, it, expect } from 'vitest'
import {
  planFulfilmentTransition,
  canConfirmDelivery,
  type FulfilmentStatus,
} from '../../marketplace/order-fulfilment.service'

describe('planFulfilmentTransition', () => {
  it('preparing --dispatch--> dispatched', () => {
    expect(planFulfilmentTransition('preparing', 'dispatch')).toEqual({ ok: true, next: 'dispatched' })
  })
  it('dispatched --deliver--> delivered', () => {
    expect(planFulfilmentTransition('dispatched', 'deliver')).toEqual({ ok: true, next: 'delivered' })
  })
  it('cannot dispatch a non-preparing order', () => {
    expect(planFulfilmentTransition('dispatched', 'dispatch').ok).toBe(false)
    expect(planFulfilmentTransition('delivered', 'dispatch').ok).toBe(false)
  })
  it('cannot deliver before dispatch', () => {
    expect(planFulfilmentTransition('preparing', 'deliver').ok).toBe(false)
    expect(planFulfilmentTransition('delivered', 'deliver').ok).toBe(false)
  })
})

describe('canConfirmDelivery', () => {
  it('only from delivered', () => {
    expect(canConfirmDelivery('delivered')).toEqual({ ok: true })
    for (const s of ['preparing', 'dispatched'] as FulfilmentStatus[]) {
      expect(canConfirmDelivery(s).ok).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- order-fulfilment` → Expected: FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/marketplace/order-fulfilment.service.ts
/**
 * Pure fulfilment state machine (spec §7). The operational fulfilment sub-status
 * is an axis ORTHOGONAL to the commercial orders.status (Phase 2): an order can
 * be commercially 'accepted' while operationally 'preparing'. Buyer confirm-
 * delivery is the join point — it requires 'delivered' and flips orders.status
 * to 'completed'. No DB calls; the caller owns persistence + auth.
 */

export type FulfilmentStatus = 'preparing' | 'dispatched' | 'delivered'
export type FulfilmentEvent = 'dispatch' | 'deliver'

export type FulfilmentTransitionResult =
  | { ok: true; next: FulfilmentStatus }
  | { ok: false; error: string }

export function planFulfilmentTransition(
  current: FulfilmentStatus,
  event: FulfilmentEvent,
): FulfilmentTransitionResult {
  if (event === 'dispatch') {
    return current === 'preparing'
      ? { ok: true, next: 'dispatched' }
      : { ok: false, error: `Cannot dispatch an order that is '${current}'` }
  }
  // event === 'deliver'
  return current === 'dispatched'
    ? { ok: true, next: 'delivered' }
    : { ok: false, error: `Cannot mark delivered from '${current}' — dispatch it first` }
}

/** Buyer confirm-delivery is valid only once the supplier marked 'delivered'. */
export function canConfirmDelivery(
  current: FulfilmentStatus,
): { ok: true } | { ok: false; error: string } {
  return current === 'delivered'
    ? { ok: true }
    : { ok: false, error: `Delivery can only be confirmed once 'delivered' (currently '${current}')` }
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Add `export * from './marketplace/order-fulfilment.service'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- order-fulfilment` → Expected: PASS.

- [ ] **Step 5: Write the order_fulfilment migration**

```sql
-- apps/edge-functions/supabase/migrations/00203_order_fulfilment.sql
-- =============================================================================
-- Phase 3 · Task 3 — order fulfilment tracking (1:1 with orders)
-- Holds the operational fulfilment sub-status + dispatch metadata + POD refs.
-- Writes are service-role only (the action layer enforces which party may do
-- what — mirrors commission_records). SELECT = both order parties via a
-- SECURITY DEFINER visibility helper (avoids inline-RLS-join-returns-nothing).
-- =============================================================================

-- Order visibility helper — reused by order_fulfilment + the POD bucket policy.
CREATE OR REPLACE FUNCTION marketplace.order_is_visible(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace.orders o
    WHERE o.id = p_order_id
      AND (
        (o.contractor_org_id = ANY (public.get_user_org_ids())
           AND NOT public.user_is_client_viewer(o.contractor_org_id))
        OR o.supplier_org_id = ANY (public.get_user_org_ids())
      )
  )
$$;
GRANT EXECUTE ON FUNCTION marketplace.order_is_visible(uuid) TO authenticated;

CREATE TABLE marketplace.order_fulfilment (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id             UUID NOT NULL UNIQUE REFERENCES marketplace.orders(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'preparing'
                         CHECK (status IN ('preparing', 'dispatched', 'delivered')),
    -- Dispatch metadata (supplier-entered).
    dispatched_at        TIMESTAMPTZ,
    courier_name         TEXT,
    waybill_ref          TEXT,
    dispatched_by        UUID REFERENCES public.profiles(id),
    -- Delivery + POD (supplier-recorded).
    delivered_recorded_at TIMESTAMPTZ,
    delivered_by         UUID REFERENCES public.profiles(id),
    pod_media_path       TEXT,   -- object key in the marketplace-pod bucket
    pod_signature_path   TEXT,
    -- Buyer confirmation.
    confirmed_at         TIMESTAMPTZ,
    confirmed_by         UUID REFERENCES public.profiles(id),
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_fulfilment_order ON marketplace.order_fulfilment (order_id);

CREATE TRIGGER order_fulfilment_updated_at
    BEFORE UPDATE ON marketplace.order_fulfilment
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE marketplace.order_fulfilment ENABLE ROW LEVEL SECURITY;

-- SELECT: both order parties (non-client_viewer buyer). No authenticated
-- INSERT/UPDATE/DELETE policy → writes are service-role only.
CREATE POLICY order_fulfilment_select ON marketplace.order_fulfilment
    FOR SELECT TO authenticated
    USING (marketplace.order_is_visible(order_id));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Write the POD bucket migration**

```sql
-- apps/edge-functions/supabase/migrations/00204_marketplace_pod_bucket.sql
-- =============================================================================
-- Phase 3 · Task 3 — private proof-of-delivery bucket
-- Path convention: {order_id}/{pod|signature}/{timestamp}-{file}. Reuses the
-- requisition-photos MIME allowlist (00050). Reads gated to both order parties
-- via marketplace.order_is_visible; writes service-role only (supplier action).
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'marketplace-pod', 'marketplace-pod', FALSE, 20971520,  -- 20 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "marketplace-pod read" ON storage.objects;
CREATE POLICY "marketplace-pod read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'marketplace-pod'
        AND marketplace.order_is_visible((storage.foldername(name))[1]::uuid)
    );

-- No authenticated INSERT/UPDATE/DELETE policy: POD is uploaded by the supplier
-- dispatch/deliver action via the service-role key (ownership enforced there).

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 7: Write the supplier dispatch/deliver actions**

```ts
// apps/web/src/actions/order-fulfilment.actions.ts
'use server'

/**
 * Supplier fulfilment actions (mark dispatched / mark delivered) + the buyer
 * confirm-delivery action (Task 4). All writes to marketplace.order_fulfilment /
 * marketplace.orders use the service-role PostgREST pattern (supabase-js strips
 * the header on cross-schema writes — see node-order.actions.ts). Reads use the
 * cookie client. Ownership is enforced HERE (order_fulfilment has no
 * authenticated write policy).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { planFulfilmentTransition, type FulfilmentStatus } from '@esite/shared'

const uuid = z.string().uuid()

function mpHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'marketplace',
    Prefer: 'return=minimal',
  }
}

async function mpPatch(
  url: string, key: string, table: string, filter: string, patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: mpHeaders(key), body: JSON.stringify(patch),
  })
  if (!res.ok) return { ok: false, error: `PATCH marketplace.${table} failed (${res.status}): ${(await res.text()).slice(0, 300)}` }
  return { ok: true }
}

async function mpUpsertFulfilment(
  url: string, key: string, row: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${url}/rest/v1/order_fulfilment?on_conflict=order_id`, {
    method: 'POST',
    headers: { ...mpHeaders(key), Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(row),
  })
  if (!res.ok) return { ok: false, error: `upsert order_fulfilment failed (${res.status}): ${(await res.text()).slice(0, 300)}` }
  return { ok: true }
}

/** Load order + its fulfilment row, and assert the caller is the supplier party. */
async function guardSupplierOfOrder(orderId: string): Promise<
  | { error: string }
  | {
      error?: undefined
      userId: string
      order: { id: string; project_id: string | null; supplier_org_id: string | null; contractor_org_id: string }
      fulfilmentStatus: FulfilmentStatus
    }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: order } = await supabase
    .schema('marketplace').from('orders')
    .select('id, project_id, supplier_org_id, contractor_org_id')
    .eq('id', orderId).maybeSingle()
  if (!order) return { error: 'Order not found or access denied' }
  const o = order as { id: string; project_id: string | null; supplier_org_id: string | null; contractor_org_id: string }

  // Caller must be an active member of the supplier org that owns this order.
  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id).eq('organisation_id', o.supplier_org_id ?? '').eq('is_active', true)
    .maybeSingle()
  if (!mem) return { error: 'Only the supplier for this order may update fulfilment.' }

  const { data: ful } = await supabase
    .schema('marketplace').from('order_fulfilment')
    .select('status').eq('order_id', orderId).maybeSingle()
  const status = ((ful as { status: FulfilmentStatus } | null)?.status ?? 'preparing') as FulfilmentStatus

  return { userId: user.id, order: o, fulfilmentStatus: status }
}

function env(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? { url, key } : null
}

const dispatchSchema = z.object({
  orderId: uuid,
  courierName: z.string().max(200).optional(),
  waybillRef: z.string().max(200).optional(),
})
export type FulfilmentResult = { ok: true } | { error: string }

export async function markDispatchedAction(input: unknown): Promise<FulfilmentResult> {
  const parsed = dispatchSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const g = await guardSupplierOfOrder(parsed.data.orderId)
  if (g.error !== undefined) return { error: g.error }

  const plan = planFulfilmentTransition(g.fulfilmentStatus, 'dispatch')
  if (!plan.ok) return { error: plan.error }

  const e = env(); if (!e) return { error: 'Server misconfigured' }
  const up = await mpUpsertFulfilment(e.url, e.key, {
    order_id: parsed.data.orderId,
    status: 'dispatched',
    dispatched_at: new Date().toISOString(),
    dispatched_by: g.userId,
    courier_name: parsed.data.courierName ?? null,
    waybill_ref: parsed.data.waybillRef ?? null,
  })
  if (!up.ok) return { error: up.error ?? 'Failed to mark dispatched' }

  // TODO(Task 6): dispatchOrderDispatchedEmail(orderId) — buyer email.
  revalidatePath(`/supplier/orders/${parsed.data.orderId}`)
  revalidatePath(`/marketplace/orders/${parsed.data.orderId}`)
  return { ok: true }
}

const deliverSchema = z.object({
  orderId: uuid,
  podMediaPath: z.string().max(500).optional(),
  podSignaturePath: z.string().max(500).optional(),
})

export async function markDeliveredAction(input: unknown): Promise<FulfilmentResult> {
  const parsed = deliverSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const g = await guardSupplierOfOrder(parsed.data.orderId)
  if (g.error !== undefined) return { error: g.error }

  const plan = planFulfilmentTransition(g.fulfilmentStatus, 'deliver')
  if (!plan.ok) return { error: plan.error }

  const e = env(); if (!e) return { error: 'Server misconfigured' }
  const up = await mpUpsertFulfilment(e.url, e.key, {
    order_id: parsed.data.orderId,
    status: 'delivered',
    delivered_recorded_at: new Date().toISOString(),
    delivered_by: g.userId,
    pod_media_path: parsed.data.podMediaPath ?? null,
    pod_signature_path: parsed.data.podSignaturePath ?? null,
  })
  if (!up.ok) return { error: up.error ?? 'Failed to mark delivered' }

  // TODO(Task 6): dispatchOrderDeliveredEmail(orderId) — buyer email.
  revalidatePath(`/supplier/orders/${parsed.data.orderId}`)
  revalidatePath(`/marketplace/orders/${parsed.data.orderId}`)
  return { ok: true }
}
```

**POD upload:** add a `POST /api/marketplace/pod/route.ts` (or reuse the Phase-1 upload route) that accepts the image/PDF, re-uses the client-side `compressImage` helper before upload, writes to `marketplace-pod` at `{orderId}/pod/{ts}-{file}` with the **service-role** client (bucket has no authenticated write policy), and returns the object key — the supplier passes it to `markDeliveredAction`. Gate the route on the same supplier-of-order ownership check.

- [ ] **Step 8: Wire the supplier order UI**

On the supplier order detail page, add: "Mark dispatched" (courier + waybill inputs) → `markDispatchedAction`; "Mark delivered" (POD photo/signature capture, reusing the inspection `InlinePhotoCapture`/`compressImage` pattern) → upload then `markDeliveredAction`. Render the current `order_fulfilment.status` as a badge.

- [ ] **Step 9: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
```bash
git add packages/shared/src/marketplace/order-fulfilment.service.ts packages/shared/src/__tests__/marketplace/order-fulfilment.service.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/migrations/00203_order_fulfilment.sql apps/edge-functions/supabase/migrations/00204_marketplace_pod_bucket.sql apps/web/src/actions/order-fulfilment.actions.ts apps/web/src/app/\(marketplace\)/supplier/orders
git commit -m "feat(marketplace): order fulfilment tracking + POD bucket + supplier dispatch/deliver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Buyer "Confirm delivery" → completed + rating unlock

The join point: a buyer with a delivered order confirms receipt, which flips the commercial `orders.status` to `completed`, records the confirmation, unlocks rating, and triggers the procurement `ordered → received` advancement (Task 5).

**Files:**
- Modify: `apps/web/src/actions/order-fulfilment.actions.ts` (`confirmDeliveryAction`)
- Modify: `apps/web/src/app/(admin)/marketplace/orders/[orderId]/*` (Confirm-delivery button; rating CTA appears on `completed`)
- (Rating gate) Modify: `apps/web/src/actions/rating.actions.ts` — change the eligibility check from `status='delivered'` to `status='completed'`

- [ ] **Step 0: (Guarded) reconcile the orders status CHECK**

If (and only if) `orders_status_check` does not yet permit `'completed'` (Phase 2 not landed), add a migration `00205`… — **but** `00205` is claimed by Task 5. To avoid renumbering, fold this reconcile into Task 5's `00205` as its first statement (a `DROP CONSTRAINT IF EXISTS orders_status_check; ADD … CHECK (status IN (…§5.4 canonical set…))`). Confirm the live CHECK first (`SELECT pg_get_constraintdef(...)`), and only widen — never narrow — the allowed set. Record the finding in the PR.

- [ ] **Step 1: Write the failing test**

Add to the fulfilment action test: a buyer (MARKETPLACE_BUYER_ROLES on the contractor org) with `order_fulfilment.status='delivered'` calling `confirmDeliveryAction(orderId)` → `orders.status` becomes `'completed'`, `order_fulfilment.confirmed_at`/`confirmed_by` set; a buyer calling it while `status='dispatched'` → rejected by `canConfirmDelivery`; an `inspector`/`client_viewer` → rejected by the role gate.

Run: `pnpm --filter web test -- order-fulfilment` → Expected: FAIL.

- [ ] **Step 2: Implement `confirmDeliveryAction`**

Append to `order-fulfilment.actions.ts`:

```ts
import { canConfirmDelivery } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { MARKETPLACE_BUYER_ROLES } from '@esite/shared'
import { advanceLinkedNodeOrders } from './order-procurement.actions' // Task 5

export async function confirmDeliveryAction(orderId: string): Promise<FulfilmentResult> {
  if (!uuid.safeParse(orderId).success) return { error: 'Invalid order id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: order } = await supabase
    .schema('marketplace').from('orders')
    .select('id, project_id, contractor_org_id')
    .eq('id', orderId).maybeSingle()
  if (!order) return { error: 'Order not found or access denied' }
  const o = order as { id: string; project_id: string | null; contractor_org_id: string }

  // Buyer role gate on the contractor (buyer) org.
  const guard = await requireRole(supabase, o.contractor_org_id, MARKETPLACE_BUYER_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: ful } = await supabase
    .schema('marketplace').from('order_fulfilment')
    .select('status').eq('order_id', orderId).maybeSingle()
  const status = ((ful as { status: FulfilmentStatus } | null)?.status ?? 'preparing') as FulfilmentStatus

  const ok = canConfirmDelivery(status)
  if (!ok.ok) return { error: ok.error }

  const e = env(); if (!e) return { error: 'Server misconfigured' }

  const now = new Date().toISOString()
  const fu = await mpPatch(e.url, e.key, 'order_fulfilment', `order_id=eq.${orderId}`, {
    confirmed_at: now, confirmed_by: user.id,
  })
  if (!fu.ok) return { error: fu.error ?? 'Failed to confirm delivery' }

  const os = await mpPatch(e.url, e.key, 'orders', `id=eq.${orderId}`, { status: 'completed' })
  if (!os.ok) return { error: os.error ?? 'Failed to complete order' }

  // Procurement report-back: advance linked node_orders ordered → received.
  // Soft-fails (best-effort) so a tracker hiccup never blocks completion.
  try { await advanceLinkedNodeOrders(orderId, 'received', { userId: user.id }) } catch { /* logged in Task 5 */ }

  // TODO(Task 6): dispatchDeliveryConfirmedEmail(orderId) — supplier email.
  revalidatePath(`/marketplace/orders/${orderId}`)
  revalidatePath(`/supplier/orders/${orderId}`)
  return { ok: true }
}
```

- [ ] **Step 3: Unlock rating on `completed`**

In `rating.actions.ts` `submitRatingAction`, change the eligibility check from `delivered` to `completed` (rating is now the reward for a confirmed, completed order). Keep the Phase-0 `MARKETPLACE_BUYER_ROLES` gate + one-rating-per-(order,user) rule.

- [ ] **Step 4: Wire the buyer UI**

On the buyer order detail page: show "Confirm delivery" only when `order_fulfilment.status='delivered'` and the caller is a buyer; on `orders.status='completed'`, hide it and surface the "Rate this supplier" CTA.

- [ ] **Step 5: Run tests + verify**

Run: `pnpm --filter web test -- 'order-fulfilment|rating' && pnpm --filter web type-check && pnpm --filter web lint`
Then with the **run** skill, walk dispatch → deliver → confirm on a flagged dev build and confirm the order shows `completed` + the rating CTA.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/order-fulfilment.actions.ts apps/web/src/actions/rating.actions.ts apps/web/src/app/\(admin\)/marketplace/orders
git commit -m "feat(marketplace): buyer confirm-delivery completes order + unlocks rating

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Deep procurement integration (order ↔ node_orders, monotonic advancement, invoice flow-back)

The core of the phase. Re-targeted onto the **live** material tracker (see the cross-phase correction — `procurement_items`/`supplier_invoices` were dropped in `00087`). Pure advancement logic in `@esite/shared`; service-role advancement gated exactly like `node-order.actions` (`ORG_WRITE_ROLES` via `requireEffectiveRole`); **must not regress the live tracker** (respect the `planTenantOrderReconcile` monotonic rule + the `00121` equipment auto-create invariant).

**Files:**
- Create: `packages/shared/src/marketplace/order-procurement.service.ts`
- Test: `packages/shared/src/__tests__/marketplace/order-procurement.service.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Create: `apps/edge-functions/supabase/migrations/00205_order_items_procurement_links.sql`
- Create: `apps/edge-functions/supabase/migrations/00206_node_order_documents_invoice_doctype.sql`
- Create: `apps/web/src/actions/order-procurement.actions.ts`
- Modify: the checkout/cart UI (`PlaceOrderForm.tsx` + Phase-1 cart) — per-line "buying for project / node" picker
- Modify: the order-accept / paid path (Phase 1/2 `updateOrderStatusAction` or the webhook handler) — call `advanceLinkedNodeOrders(orderId, 'ordered')`

- [ ] **Step 1: Write the failing advancement test**

```ts
// packages/shared/src/__tests__/marketplace/order-procurement.service.test.ts
import { describe, it, expect } from 'vitest'
import { planNodeOrderAdvance } from '../../marketplace/order-procurement.service'

describe('planNodeOrderAdvance — monotonic, never regresses the live tracker', () => {
  it('no linked node order → skip', () => {
    expect(planNodeOrderAdvance(null, 'ordered')).toEqual({ action: 'skip', reason: 'no linked node order' })
  })
  it('by_tenant lines are never marketplace-advanced', () => {
    expect(planNodeOrderAdvance('by_tenant', 'ordered').action).toBe('skip')
    expect(planNodeOrderAdvance('by_tenant', 'received').action).toBe('skip')
  })
  it('required --ordered--> advance', () => {
    expect(planNodeOrderAdvance('required', 'ordered')).toEqual({ action: 'advance', status: 'ordered' })
  })
  it('already ordered (or received) → skip when target is ordered (no regress, no dup)', () => {
    expect(planNodeOrderAdvance('ordered', 'ordered').action).toBe('skip')
    expect(planNodeOrderAdvance('received', 'ordered').action).toBe('skip')
  })
  it('ordered --received--> advance', () => {
    expect(planNodeOrderAdvance('ordered', 'received')).toEqual({ action: 'advance', status: 'received' })
  })
  it('required → received is NOT allowed (must pass through ordered)', () => {
    expect(planNodeOrderAdvance('required', 'received').action).toBe('skip')
  })
  it('already received → skip', () => {
    expect(planNodeOrderAdvance('received', 'received').action).toBe('skip')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- order-procurement` → Expected: FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/marketplace/order-procurement.service.ts
/**
 * Pure advancement logic mapping a marketplace order milestone onto the LIVE
 * material tracker (structure.node_orders). Re-scopes decision R3 for the real
 * schema: projects.procurement_items was dropped in migration 00087, so the
 * integration target is structure.node_orders (+ node_order_documents for the
 * invoice). Monotonic — mirrors planTenantOrderReconcile's no-regress rule so
 * a marketplace event can NEVER pull the tracker backwards or skip a stage.
 *
 * Lifecycle: by_tenant | required → ordered → received.
 *   - marketplace order paid/accepted  ⇒ target 'ordered'
 *   - marketplace delivery confirmed    ⇒ target 'received'
 */

import type { NodeOrderStatus } from '../structure/node-order.service'

export type NodeOrderAdvanceTarget = 'ordered' | 'received'

export type NodeOrderAdvancePlan =
  | { action: 'advance'; status: NodeOrderAdvanceTarget }
  | { action: 'skip'; reason: string }

export function planNodeOrderAdvance(
  current: NodeOrderStatus | null,
  target: NodeOrderAdvanceTarget,
): NodeOrderAdvancePlan {
  if (current === null) return { action: 'skip', reason: 'no linked node order' }
  // Tenant-provisioned lines are never a WM/marketplace order — leave untouched.
  if (current === 'by_tenant') return { action: 'skip', reason: 'by_tenant line — not a marketplace order' }

  if (target === 'ordered') {
    return current === 'required'
      ? { action: 'advance', status: 'ordered' }
      : { action: 'skip', reason: `already at or beyond 'ordered' (is '${current}')` }
  }
  // target === 'received' — only from 'ordered'; never from 'required' (no stage-skip).
  if (current === 'ordered') return { action: 'advance', status: 'received' }
  if (current === 'received') return { action: 'skip', reason: 'already received' }
  return { action: 'skip', reason: `cannot receive from '${current}' — must be 'ordered' first` }
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Add `export * from './marketplace/order-procurement.service'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- order-procurement` → Expected: PASS (7 tests).

- [ ] **Step 5: Write the order_items link migration**

```sql
-- apps/edge-functions/supabase/migrations/00205_order_items_procurement_links.sql
-- =============================================================================
-- Phase 3 · Task 5 — procurement links on marketplace.order_items
-- node_id + node_order_id are the LIVE links (structure.node_orders is the
-- tracker). procurement_item_id is a RESERVED, inert column (NO FK) kept only to
-- honour the spec's naming — projects.procurement_items was dropped in 00087.
-- (First: guarded reconcile of orders_status_check for 'completed' — Task 4 §0.)
-- =============================================================================

-- Guarded status-CHECK reconcile (only if Phase 2 has not already widened it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_status_check'
      AND pg_get_constraintdef(oid) LIKE '%completed%'
  ) THEN
    ALTER TABLE marketplace.orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE marketplace.orders ADD CONSTRAINT orders_status_check CHECK (
      status IN (
        'draft','pending_payment','submitted','paid','accepted','confirmed',
        'preparing','dispatched','in_transit','delivered','completed',
        'invoiced','cancelled','refunded','partially_refunded','disputed'
      )
    );
  END IF;
END $$;

ALTER TABLE marketplace.order_items
    ADD COLUMN IF NOT EXISTS node_id        UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS node_order_id  UUID REFERENCES structure.node_orders(id) ON DELETE SET NULL,
    -- RESERVED / inert: projects.procurement_items does not exist (dropped 00087).
    -- No FK. Present so a future procurement-module revival can back-fill it.
    ADD COLUMN IF NOT EXISTS procurement_item_id UUID;

CREATE INDEX IF NOT EXISTS idx_order_items_node_order ON marketplace.order_items (node_order_id);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Write the invoice-doctype migration**

```sql
-- apps/edge-functions/supabase/migrations/00206_node_order_documents_invoice_doctype.sql
-- =============================================================================
-- Phase 3 · Task 5 — allow 'invoice' documents on the live tracker
-- Invoice flow-back attaches the platform/supplier tax invoice to
-- structure.node_order_documents (the live replacement for the dropped
-- projects.supplier_invoices). Widen doc_type; keep the (node_order_id,doc_type)
-- UNIQUE so re-upload replaces the single invoice slot.
-- =============================================================================

ALTER TABLE structure.node_order_documents
    DROP CONSTRAINT IF EXISTS node_order_documents_doc_type_check;
ALTER TABLE structure.node_order_documents
    ADD CONSTRAINT node_order_documents_doc_type_check
    CHECK (doc_type IN ('quote', 'order_instruction', 'invoice'));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 7: Write the advancement + flow-back action**

```ts
// apps/web/src/actions/order-procurement.actions.ts
'use server'

/**
 * Marketplace → live material-tracker report-back. Advances linked
 * structure.node_orders monotonically (planNodeOrderAdvance) and attaches the
 * tax invoice to structure.node_order_documents. All structure writes use the
 * service-role PostgREST pattern (node-order.actions.ts) and are gated on
 * ORG_WRITE_ROLES via requireEffectiveRole — the SAME gate the live tracker
 * uses, so this cannot widen who may write node_orders (no regression).
 *
 * MUST NOT regress the tracker: skips by_tenant + already-advanced rows, never
 * stage-skips, never touches the 00121 equipment auto-create invariant.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  ORG_WRITE_ROLES,
  planNodeOrderAdvance,
  type NodeOrderAdvanceTarget,
} from '@esite/shared'

function structureHeaders(key: string): HeadersInit {
  return {
    apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json', 'Content-Profile': 'structure',
    Prefer: 'return=minimal',
  }
}

async function structurePatch(
  url: string, key: string, table: string, filter: string, patch: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: structureHeaders(key), body: JSON.stringify(patch),
  })
  return res.ok
}

export type AdvanceResult = {
  advanced: number
  skipped: number
  reason?: string
}

/**
 * Advance every node_order linked to `orderId`'s line items to `target`.
 * @param opts.userId  when present, gate on ORG_WRITE_ROLES of the order's
 *   project (buyer-initiated confirm-delivery). Omit for system/webhook calls
 *   (paid/accepted) which run with service trust after signature/idempotency.
 */
export async function advanceLinkedNodeOrders(
  orderId: string,
  target: NodeOrderAdvanceTarget,
  opts: { userId?: string } = {},
): Promise<AdvanceResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { advanced: 0, skipped: 0, reason: 'server-misconfigured' }

  const svc = createServiceClient()

  // Order → project, and its linked node_order lines.
  const { data: order } = await (svc as any)
    .schema('marketplace').from('orders').select('id, project_id').eq('id', orderId).maybeSingle()
  const projectId = (order as { project_id: string | null } | null)?.project_id ?? null
  if (!projectId) return { advanced: 0, skipped: 0, reason: 'order has no project link' }

  // User-initiated path: enforce the SAME node_orders write gate as the tracker.
  if (opts.userId) {
    const cookie = await createClient()
    const gate = await requireEffectiveRole(cookie, projectId, ORG_WRITE_ROLES)
    if (!gate.ok) return { advanced: 0, skipped: 0, reason: 'insufficient_project_role' }
  }

  const { data: items } = await (svc as any)
    .schema('marketplace').from('order_items')
    .select('node_order_id').eq('order_id', orderId).not('node_order_id', 'is', null)
  const ids = [...new Set((items ?? []).map((r: any) => r.node_order_id as string))]
  if (ids.length === 0) return { advanced: 0, skipped: 0, reason: 'no linked node orders' }

  // Read current status, plan per row, advance only 'advance' plans. The node_order
  // must belong to this project (defence-in-depth against a mis-linked line).
  const { data: rows } = await (svc as any)
    .schema('structure').from('node_orders')
    .select('id, status, project_id').in('id', ids).eq('project_id', projectId)

  let advanced = 0, skipped = 0
  for (const r of (rows ?? []) as Array<{ id: string; status: any }>) {
    const plan = planNodeOrderAdvance(r.status, target)
    if (plan.action !== 'advance') { skipped++; continue }
    const patch: Record<string, unknown> =
      target === 'ordered'
        ? { status: 'ordered', ordered_at: new Date().toISOString().slice(0, 10) }
        : { status: 'received', received_at: new Date().toISOString().slice(0, 10) }
    const ok = await structurePatch(url, key, 'node_orders', `id=eq.${r.id}`, patch)
    ok ? advanced++ : skipped++
  }
  return { advanced, skipped }
}

/**
 * Attach a tax-invoice PDF (already uploaded to the node-order-documents bucket)
 * to each linked node_order as a doc_type='invoice' row. Upsert on the
 * (node_order_id, doc_type) unique slot so a re-issue replaces the invoice.
 */
export async function attachInvoiceToLinkedNodeOrders(
  orderId: string,
  invoice: { storagePath: string; fileName: string; uploadedBy?: string },
): Promise<{ attached: number }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { attached: 0 }
  const svc = createServiceClient()

  const { data: items } = await (svc as any)
    .schema('marketplace').from('order_items')
    .select('node_order_id').eq('order_id', orderId).not('node_order_id', 'is', null)
  const ids = [...new Set((items ?? []).map((r: any) => r.node_order_id as string))]
  if (ids.length === 0) return { attached: 0 }

  const rows = ids.map((id) => ({
    node_order_id: id,
    doc_type: 'invoice',
    storage_path: invoice.storagePath,
    file_name: invoice.fileName,
    uploaded_by: invoice.uploadedBy ?? null,
  }))
  const res = await fetch(`${url}/rest/v1/node_order_documents?on_conflict=node_order_id,doc_type`, {
    method: 'POST',
    headers: { ...structureHeaders(key), Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  })
  return { attached: res.ok ? rows.length : 0 }
}
```

- [ ] **Step 8: Wire the line-linkage UI + the paid/accepted trigger**

- **Cart/checkout:** per order line, an optional "Buying for" picker — project → node → node_order (the specific `required` tracker line). Persist `node_id`/`node_order_id` on the `order_items` row at order create (default R3: one line → one node_order; multi-node-per-line is out of scope, noted). Only offer `required` node_orders in the buyer's projects.
- **Paid/accepted trigger:** in the order-accept path (`updateOrderStatusAction` or the Phase-2 webhook `charge.success` handler), after the order reaches `paid`/`accepted`, call `advanceLinkedNodeOrders(orderId, 'ordered')` (system call — omit `userId`). Best-effort; log failures.
- **Invoice flow-back:** when the Phase-2 tax invoice PDF is generated, upload it to `node-order-documents` at `{projectId}/{nodeOrderId}/invoice/{ts}-{file}` and call `attachInvoiceToLinkedNodeOrders(orderId, …)`.

- [ ] **Step 9: Write a route/gate integration test (no-regression proof)**

Add a web test proving: (a) a system call `advanceLinkedNodeOrders(order,'ordered')` advances only `required` links and skips `ordered`/`received`/`by_tenant` (uses `planNodeOrderAdvance` on real rows); (b) a buyer `confirmDeliveryAction` by a **contractor without ORG_WRITE_ROLES** completes the order but returns `insufficient_project_role` from advancement (tracker untouched) — the live authorization model is preserved. Reuse the e2e-cookie harness (memory `e2e-test-cookie-gated-routes`).

- [ ] **Step 10: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint`
Optionally, prove the advancement against a seeded row on prod with the **rolled-back RED→GREEN probe** (memory `rolled-back-prod-red-green-probe`): seed a `required` node_order, run the plan+patch inside a txn, assert `ordered`, RAISE to roll back.
```bash
git add packages/shared/src/marketplace/order-procurement.service.ts packages/shared/src/__tests__/marketplace/order-procurement.service.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/migrations/00205_order_items_procurement_links.sql apps/edge-functions/supabase/migrations/00206_node_order_documents_invoice_doctype.sql apps/web/src/actions/order-procurement.actions.ts
git commit -m "feat(marketplace): deep procurement integration — advance live node_orders + invoice flow-back

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Fulfilment emails (dispatched/delivered → buyer, confirmed → supplier)

Wires the three §10 fulfilment emails via the existing Resend `send-email` edge function. Render helpers are pure (in `@esite/shared`, unit-tested); web dispatchers are best-effort (never block the action).

**Files:**
- Create: `packages/shared/src/marketplace/fulfilment-emails.ts` (pure `render*Email → { subject, html }`)
- Test: `packages/shared/src/__tests__/marketplace/fulfilment-emails.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Create: `apps/web/src/lib/marketplace-email.ts` (`dispatchOrderDispatchedEmail`, `dispatchOrderDeliveredEmail`, `dispatchDeliveryConfirmedEmail`)
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (add 3 passthrough types)
- Modify: `apps/web/src/actions/order-fulfilment.actions.ts` (replace the Task-3/4 TODOs with real calls)

- [ ] **Step 1: Write the failing render test**

```ts
// packages/shared/src/__tests__/marketplace/fulfilment-emails.test.ts
import { describe, it, expect } from 'vitest'
import {
  renderOrderDispatchedEmail,
  renderOrderDeliveredEmail,
  renderDeliveryConfirmedEmail,
} from '../../marketplace/fulfilment-emails'

describe('fulfilment emails', () => {
  it('dispatched email names the order + courier', () => {
    const { subject, html } = renderOrderDispatchedEmail({
      orderRef: 'MO-1042', supplierName: 'Voltex', courierName: 'Dawn Wing',
      waybillRef: 'DW123', siteUrl: 'https://www.e-site.live',
    })
    expect(subject).toContain('MO-1042')
    expect(html).toContain('Dawn Wing')
    expect(html).toContain('DW123')
  })
  it('delivered email invites the buyer to confirm', () => {
    const { html } = renderOrderDeliveredEmail({ orderRef: 'MO-1042', supplierName: 'Voltex', siteUrl: 'https://x' })
    expect(html.toLowerCase()).toContain('confirm')
  })
  it('confirmed email tells the supplier the buyer confirmed', () => {
    const { subject, html } = renderDeliveryConfirmedEmail({ orderRef: 'MO-1042', buyerName: 'Acme', siteUrl: 'https://x' })
    expect(subject).toContain('confirmed')
    expect(html).toContain('Acme')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- fulfilment-emails` → Expected: FAIL.

- [ ] **Step 3: Implement the render helpers**

```ts
// packages/shared/src/marketplace/fulfilment-emails.ts
/** Pure marketplace fulfilment email renderers → { subject, html }. Matches the
 *  renderRfiCreatedEmail pattern: the web layer forwards { to, subject, html }
 *  to the send-email edge function. Minimal inline styles (Resend-safe). */

export interface RenderedEmail { subject: string; html: string }

function shell(inner: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
    `<body style="font-family:system-ui,sans-serif;color:#0f172a">` +
    `<div style="max-width:480px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px">` +
    `${inner}<p style="color:#64748b;font-size:12px;margin-top:24px">E-Site Marketplace · ` +
    `<a href="${siteUrl}" style="color:#3b82f6">${siteUrl.replace(/^https?:\/\//, '')}</a></p></div></body></html>`
}

export function renderOrderDispatchedEmail(a: {
  orderRef: string; supplierName: string; courierName?: string | null;
  waybillRef?: string | null; siteUrl: string
}): RenderedEmail {
  const courier = a.courierName ? `<p>Courier: <strong>${a.courierName}</strong>${a.waybillRef ? ` (waybill ${a.waybillRef})` : ''}</p>` : ''
  return {
    subject: `Order ${a.orderRef} dispatched`,
    html: shell(`<h2>Your order is on its way</h2>` +
      `<p>${a.supplierName} has dispatched order <strong>${a.orderRef}</strong>.</p>${courier}` +
      `<p>We'll ask you to confirm delivery once it arrives.</p>`, a.siteUrl),
  }
}

export function renderOrderDeliveredEmail(a: {
  orderRef: string; supplierName: string; siteUrl: string
}): RenderedEmail {
  return {
    subject: `Order ${a.orderRef} delivered — please confirm`,
    html: shell(`<h2>Order delivered</h2>` +
      `<p>${a.supplierName} has marked order <strong>${a.orderRef}</strong> as delivered.</p>` +
      `<p>Please <strong>confirm delivery</strong> in E-Site to complete the order and rate the supplier.</p>`, a.siteUrl),
  }
}

export function renderDeliveryConfirmedEmail(a: {
  orderRef: string; buyerName: string; siteUrl: string
}): RenderedEmail {
  return {
    subject: `Delivery confirmed for order ${a.orderRef}`,
    html: shell(`<h2>Delivery confirmed</h2>` +
      `<p><strong>${a.buyerName}</strong> has confirmed delivery of order <strong>${a.orderRef}</strong>. ` +
      `The order is now complete.</p>`, a.siteUrl),
  }
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Add `export * from './marketplace/fulfilment-emails'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- fulfilment-emails` → Expected: PASS.

- [ ] **Step 5: Add send-email passthrough types**

In `send-email/index.ts`, add three branches (each identical to the `rfi-created` passthrough — accept `{ to, subject, html }`, single recipient, validate, `sendEmail`): `marketplace-order-dispatched`, `marketplace-order-delivered`, `marketplace-delivery-confirmed`.

- [ ] **Step 6: Write the web dispatchers + wire into the actions**

`apps/web/src/lib/marketplace-email.ts`: three `async` functions that (service-role) resolve the recipient email + order ref + counterparty name, call the matching `render*Email`, then invoke `send-email` with the new type. Never throw. Replace the Task-3/4 `TODO(Task 6)` comments in `order-fulfilment.actions.ts` with the real calls (`dispatchOrderDispatchedEmail(orderId)` after dispatch, `dispatchOrderDeliveredEmail(orderId)` after deliver, `dispatchDeliveryConfirmedEmail(orderId)` after confirm).

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
```bash
git add packages/shared/src/marketplace/fulfilment-emails.ts packages/shared/src/__tests__/marketplace/fulfilment-emails.test.ts packages/shared/src/index.ts apps/web/src/lib/marketplace-email.ts apps/edge-functions/supabase/functions/send-email/index.ts apps/web/src/actions/order-fulfilment.actions.ts
git commit -m "feat(marketplace): fulfilment emails (dispatched/delivered/confirmed) via Resend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: RBAC matrix + Phase-3 verification sweep

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Itemise every Phase-3 route/action in the matrix**

Add rows for: `(marketplace)/supplier/settings` (SUPPLIER_PORTAL_ROLES), supplier order dispatch/deliver + POD route (supplier-of-order ownership), `(admin)/marketplace/orders/[orderId]` confirm-delivery (MARKETPLACE_BUYER_ROLES), the delivery-address CRUD (buyer org, non-client_viewer), and the actions `updateFulfilmentSettingsAction`, `markDispatchedAction`, `markDeliveredAction`, `confirmDeliveryAction`, `advanceLinkedNodeOrders` (system + ORG_WRITE_ROLES user gate), `attachInvoiceToLinkedNodeOrders`. Note the Phase-2 flag footnote and the "advancement reuses the live node_orders ORG_WRITE_ROLES gate" invariant.

- [ ] **Step 2: Run the Phase-3 completeness checks**

- `pnpm --filter @esite/shared test && pnpm --filter web test` → all green.
- `turbo run type-check lint` → clean.
- Migrations `00200`–`00206` are sequential; each ends with `NOTIFY pgrst` (no schema `CREATE`/`DROP` here → no PostgREST config PATCH needed); the POD bucket is created via `storage.buckets` insert + `storage.objects` RLS.
- Grep confirms: no `procurement_items`/`supplier_invoices` FK anywhere (the reserved column has no FK); no client-sent delivery fee trusted; `order_fulfilment` has no authenticated write policy.
- Confirm the live-tracker no-regression: `planNodeOrderAdvance` never returns `advance` for `by_tenant`/`ordered`/`received` (target ordered) or non-`ordered` (target received); the `00121` equipment trigger + `planTenantOrderReconcile` are untouched.

- [ ] **Step 3: Phase gate — review**

Run `superpowers:requesting-code-review`; run **security-review** (mandatory for this phase — new RLS, SECURITY DEFINER `order_is_visible`/`supplier_org_id`/`supplier_settings` search_path, service-role write ownership checks, POD bucket read scope, cross-schema advancement gate); recommend the user run `/code-review ultra`. Then `superpowers:finishing-a-development-branch`.

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise marketplace fulfilment + procurement routes/actions (Phase 3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** Task 1↔§2.4/§7 (fulfilment settings + fee rules); Task 2↔§7/§9 (`delivery_addresses`, orders fulfilment fields, server-computed fee); Task 3↔§7 (`order_fulfilment` `preparing→dispatched→delivered` + POD bucket); Task 4↔§5.4/§7 (confirm-delivery → `completed` + rating unlock); Task 5↔§8 (deep procurement integration — order↔node_orders linkage, monotonic advancement, invoice flow-back); Task 6↔§10 (dispatched/delivered/confirmed emails); Task 7↔§11 (RBAC matrix + security-review gate).
- **The load-bearing correction:** `projects.procurement_items`/`supplier_invoices` were verified ABSENT on prod (dropped by `00087`); the spec §8 / investigation §3.4 references are stale. R3 is re-scoped onto the live `structure.node_orders` tracker with an inert `procurement_item_id` reserved column, and invoice flow-back re-targeted onto `structure.node_order_documents` (doc_type widened). This is the single biggest deviation from the spec text and is called out up-front, not buried.
- **No-regression discipline:** every `node_orders` write reuses the exact live gate (`ORG_WRITE_ROLES` via `requireEffectiveRole`) and the monotonic `planNodeOrderAdvance` (mirrors `planTenantOrderReconcile`); `by_tenant`/already-advanced rows are skipped; the `00121` equipment auto-create invariant and `planTenantOrderReconcile` are untouched; Task 5 Step 9 is a dedicated no-regression proof.
- **Money:** all fees/thresholds are integer cents via the Phase-0 helper; UI converts rand↔cents at the edges; no float arithmetic.
- **Placeholders:** none. Steps that say "confirm the live CHECK first / read a sibling test / match the send-email contract" are deliberate verification steps, not deferred work. UI steps describe exact wiring + files (React bodies follow the existing design-system components, as in Phase 0).
- **Migrations:** `00200`–`00206`, sequential, additive, each `NOTIFY pgrst`; POD bucket via `storage.buckets`+`storage.objects` RLS; SECURITY DEFINER helpers pin `search_path=''`; the `orders_status_check` widen is guarded so it cannot conflict with Phase 2.
- **Known cross-phase seams (flagged inline):** Phase 1 must have created `marketplace.supplier_settings` (Task 1 is self-healing); Phase 2 owns `orders.status`'s commercial states + the paid/accepted trigger point that calls `advanceLinkedNodeOrders(...,'ordered')` + the tax-invoice PDF whose upload feeds `attachInvoiceToLinkedNodeOrders`. If Phase 2's checkout supersedes `placeOrderAction`, Task 2/5 wire the same logic into the superseding action.
