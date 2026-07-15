# Marketplace Phase 1 — Storefront + Rich Catalogue (no payments) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inherit ALL conventions from `2026-07-13-marketplace-implementation-index.md` (worktree, migrations auto-apply on merge, vitest gates, RBAC-matrix rule, commit trailer) and everything Phase 0 (`2026-07-13-marketplace-phase-0-foundations.md`) shipped: the money helper (`randToCents/centsToRand/addCents/formatZARFromCents` in `@esite/shared`), the canonical taxonomy (`MARKETPLACE_CATEGORIES/isMarketplaceCategory`), the role groups (`MARKETPLACE_BUYER_ROLES`, `SUPPLIER_PORTAL_ROLES`), the 5%/`bearer:subaccount` commission reconciliation, and the `marketplace.orders` RLS hardening (migration `00174`).

**Goal:** Ship the buyer-facing marketplace as a live **directory + rich catalogue + persistent cart + RFQ** experience — media, tiered/contract pricing, inventory, a shared pricing-resolution service, bulk import, a unified server-action checkout, and the emails these flows need — **without any Paystack/payment wiring** (Phase 2). Everything stays behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE`; Phase 1 may be flipped on as directory+cart+RFQ independently of payments.

**Architecture:** Net-new `@esite/shared` pure modules (VAT/tax, `resolvePrice`, stock status, order-status transitions, catalogue import parser/differ, email renderers), eight sequential SQL migrations (`00176`–`00183`) that add media/pricing/inventory/settings/cart/RFQ tables + a `catalogue-media` bucket and extend `orders`/`order_items`, new server actions that are **role-gated + ownership-checked** (replacing the ad-hoc `getUser()`-only guards), and net-new storefront/product/cart/RFQ UI conforming to the E-Site design system. Money is integer **cents** everywhere new; existing `numeric` rand columns are bridged with the money helper. Nothing bypasses the feature flag.

**Tech Stack:** Next.js 15 (App Router, server actions), TypeScript, Zod, Supabase/Postgres (RLS, RPC, migrations, storage), `exceljs` (xlsx/CSV parse — the repo's spreadsheet lib; **not** SheetJS), Resend (`send-email` edge fn) + Expo (`send-notification` edge fn), vitest.

**Scope (15 tasks):** 1) supplier-portal context + sub-roles · 2) VAT/tax-class helper · 3) `resolvePrice` pricing service · 4) catalogue media (table + `catalogue-media` bucket + upload UI + gallery) · 5) inventory/stock columns + `stockStatus` helper · 6) tiered/volume pricing · 7) per-buyer contract pricing · 8) `supplier_settings` · 9) bulk catalogue import (CSV/XLSX) · 10) discovery/directory hardening + storefront + product page · 11) persistent per-supplier cart · 12) unified server-action checkout + order-status model · 13) RFQ → quote → accept flow · 14) marketplace transactional emails · 15) RBAC-matrix + Phase-1 verification sweep.

**Decision defaults applied (from the index decision-gate table; alternative noted inline):**
- Phase 1 exposes **on-account/`submitted` checkout only** — `pay_now` is hidden until Phase 2 wires Paystack. *(Alt: expose pay-now stub — rejected, KYC-blocked.)*
- Supplier **sub-roles** are role-group capabilities over the existing `OrgRole` set, not a new DB enum. *(Alt: a dedicated `supplier_staff` OrgRole — heavier, deferred.)*
- `catalogue-media` bucket is **public-read** (product photos are non-sensitive), write-gated by supplier-org RLS. *(Alt: private bucket + signed URLs — more plumbing, deferred.)*
- Inventory **decrements on `paid` (pay-now, Phase 2) or on `accepted` (on-account, this phase)**; Phase 1 wires the `accepted`-time decrement + oversell guard, and documents the pay-now rule for Phase 2.
- R3 (procurement mapping) is **out of Phase 1** — order/line `node_id`/`procurement_item_id` linkage is Phase 3; nullable columns are NOT added here.

---

## File Structure (net-new + touched)

```
packages/shared/src/marketplace/
  tax.ts                         (T2)  VAT_RATE, TaxClass, vatRateForClass, computeLineVatCents
  pricing.ts                     (T3)  resolvePrice + PriceTier/ContractPrice/ResolvePriceItem types
  stock.ts                       (T5)  StockStatus, stockStatus()
  order-status.ts                (T12) MARKETPLACE_ORDER_STATUSES, canTransition()
  catalogue-import-parser.ts     (T9)  parseCatalogueImport(buffer, filename)
  catalogue-import-preview.ts    (T9)  diffCatalogue()
packages/shared/src/email/
  marketplace-email.ts           (T14) render* email builders (return {subject, html})
packages/shared/src/types/index.ts          (T1)  + SUPPLIER_STAFF_ROLES
packages/shared/src/index.ts                 (T2,3,5,9,12) + barrel exports
packages/shared/src/__tests__/marketplace/   (T2,3,5,9,12) *.test.ts

apps/web/src/lib/auth-org.ts                 (T1)  + getSupplierContext()
apps/web/src/lib/images/compress-image.ts    (T4)  shared compressImage (lifted)
apps/web/src/lib/marketplace-email.ts        (T14) web wrappers → send-email edge fn
apps/web/src/actions/
  supplier.actions.ts            (T1,4,5,6,7,12) gate + ownership-check + snapshot pricing
  supplier-settings.actions.ts   (T8)  updateSupplierSettingsAction
  catalogue-media.actions.ts     (T4)  add/delete/setPrimary
  cart.actions.ts                (T11) add/update/remove/clear
  rfq.actions.ts                 (T13) create/quote/accept
apps/web/src/app/api/catalogue-import/{parse,commit}/route.ts   (T9)
apps/web/src/app/(marketplace)/
  layout.tsx                     (T1)  mount OrgSwitcher
  supplier/settings/page.tsx     (T8)
  supplier/catalogue/[itemId]/    (T4,6,7) media/tiers/contract editors
  supplier/catalogue/import/page.tsx  (T9) ImportFlow
  supplier/rfqs/…                (T13) list + [rfqId] quote form
apps/web/src/app/(admin)/marketplace/
  page.tsx                       (T10) directory (facets, pagination)
  [supplierId]/page.tsx          (T10) storefront (buyer-specific pricing)
  [supplierId]/item/[itemId]/page.tsx  (T10) product page (gallery + price breaks)
  cart/[supplierId]/page.tsx     (T11) cart
  cart/[supplierId]/checkout/page.tsx  (T12) checkout
  rfqs/…                         (T13) buyer RFQ list + request
apps/edge-functions/supabase/migrations/
  00176_marketplace_catalogue_media.sql        (T4)
  00177_marketplace_catalogue_inventory.sql    (T5)
  00178_marketplace_price_tiers.sql            (T6)
  00179_marketplace_contract_prices.sql        (T7)
  00180_marketplace_supplier_settings.sql      (T8)
  00181_marketplace_carts.sql                  (T11)
  00182_marketplace_orders_ecommerce.sql       (T12)
  00183_marketplace_rfqs.sql                   (T13)
apps/edge-functions/supabase/functions/send-email/index.ts   (T14) + 'marketplace-email' type
docs/rbac-matrix.md                            (T15)
```

**Grounding facts (verified in the codebase — do not re-derive):** spreadsheet lib is `exceljs` (`import ExcelJS from 'exceljs'`); tenant-import mirror lives at `packages/shared/src/structure/tenant-import-parser.ts` (`parseTenantSchedule(buffer)`) + `import-preview.ts` (`diffTenantSchedule`), with routes `apps/web/src/app/api/tenant-schedule/{parse,commit}/route.ts` gated by `requireEffectiveRole(..., ORG_WRITE_ROLES)` and a client `ImportFlow.tsx`; the commit route re-parses server-side and writes via a raw PostgREST `fetch` with `Content-Profile` header + service-role key (`structurePost`/`structurePatch` pattern in `apps/web/src/actions/db-legend.actions.ts`) — **but** `supplier.actions.ts` writes the `marketplace`/`suppliers` schemas via the **user cookie client** `supabase.schema('marketplace').from(...)` (RLS-enforced) and that works, so new marketplace writes use the user client, not service-role. Design-system primitives: `import { Card, CardHeader, CardBody } from '@/components/ui/Card'` and `import { Badge } from '@/components/ui/Badge'` (variants `default|success|warning|danger|info|ghost`); existing marketplace pages use raw `data-panel` CSS classes — net-new surfaces here standardise on `Card`/`Badge`. RLS helpers that exist: `public.get_user_org_ids()` (org membership array), `public.user_is_client_viewer(org_id)`; the owner/admin write idiom is a `user_organisations` subquery (see `00165`). Storage bucket idiom: `INSERT INTO storage.buckets … ON CONFLICT DO NOTHING` + `storage.objects` policies keyed on `(storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())` (see `00050_requisition_photos.sql`). Client image compression: `compressImage(file: File): Promise<File>` copy-defined in `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/useFieldPhotos.ts`. Emails: `send-email` edge fn takes `{ type, payload }`; rich HTML is rendered web/shared-side and forwarded as `{to, subject, html}` (see the `rfi-created` type + `packages/shared/src/email/rfi-email.ts`). In-app/push: `dispatchNotification({ userIds, title, body, route, type, entityType?, entityId? })` from `apps/web/src/lib/notifications.ts`. Org switch: `OrgSwitcher` (`apps/web/src/components/layout/OrgSwitcher.tsx`) + `setActiveOrganisation` writing `profiles.active_organisation_id`, read by `getOrgContext()` in `apps/web/src/lib/auth-org.ts` (falls back to oldest membership).

---

## Task 1: Supplier-portal context + supplier sub-roles

Fixes spec §1.2: the `getOrgContext()` "oldest membership" hazard for dual firm+supplier users, an explicit context switch in the portal, and the `supplier_admin` (manage) vs `supplier_staff` (process orders only) distinction.

**Files:**
- Modify: `packages/shared/src/types/index.ts` (add `SUPPLIER_STAFF_ROLES`)
- Test: `packages/shared/src/__tests__/marketplace/supplier-roles.test.ts`
- Modify: `apps/web/src/lib/auth-org.ts` (add `getSupplierContext()`)
- Modify: `apps/web/src/app/(marketplace)/layout.tsx` (mount `OrgSwitcher`)
- Modify: `apps/web/src/app/(marketplace)/supplier/{profile,catalogue,orders}/page.tsx` (call `getSupplierContext()`, redirect if null)

- [ ] **Step 1: Write the failing role-group test**

```ts
// packages/shared/src/__tests__/marketplace/supplier-roles.test.ts
import { describe, it, expect } from 'vitest'
import { SUPPLIER_PORTAL_ROLES, SUPPLIER_STAFF_ROLES } from '../../types'

describe('supplier sub-roles', () => {
  it('portal (admin) roles are owner/admin', () => {
    expect([...SUPPLIER_PORTAL_ROLES].sort()).toEqual(['admin', 'owner'])
  })
  it('staff roles are a superset that also includes project_manager', () => {
    for (const r of SUPPLIER_PORTAL_ROLES) expect(SUPPLIER_STAFF_ROLES).toContain(r)
    expect(SUPPLIER_STAFF_ROLES).toContain('project_manager')
  })
  it('staff roles exclude read-only site roles', () => {
    expect(SUPPLIER_STAFF_ROLES).not.toContain('client_viewer')
    expect(SUPPLIER_STAFF_ROLES).not.toContain('inspector')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- supplier-roles`
Expected: FAIL — `SUPPLIER_STAFF_ROLES` is not exported.

- [ ] **Step 3: Add the group**

Append to `packages/shared/src/types/index.ts` next to `SUPPLIER_PORTAL_ROLES` (Phase 0):
```ts
/**
 * Supplier-portal STAFF capability: may process orders/RFQs but NOT manage
 * profile/banking/catalogue/pricing/settings (those are SUPPLIER_PORTAL_ROLES).
 * Superset of SUPPLIER_PORTAL_ROLES (owner/admin) + project_manager.
 */
export const SUPPLIER_STAFF_ROLES: readonly OrgRole[] = ['owner', 'admin', 'project_manager']
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @esite/shared test -- supplier-roles`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `getSupplierContext()`**

Append to `apps/web/src/lib/auth-org.ts` (reuse the existing `createClient` import + `getOrgContext`):
```ts
export interface SupplierContext {
  userId: string
  organisationId: string
  role: OrgRole
  supplierId: string
}

/**
 * Resolves the caller's ACTIVE org to a supplier profile deterministically.
 * Returns null if the active org is not a supplier org (the caller should then
 * be prompted to switch context via OrgSwitcher). This replaces the implicit
 * "oldest membership has a suppliers row" assumption in the portal.
 */
export async function getSupplierContext(): Promise<SupplierContext | null> {
  const ctx = await getOrgContext()
  if (!ctx) return null
  const supabase = await createClient()
  const { data: supplier } = await supabase
    .schema('suppliers')
    .from('suppliers')
    .select('id')
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (!supplier) return null
  return { userId: ctx.userId, organisationId: ctx.organisationId, role: ctx.role, supplierId: supplier.id }
}
```

- [ ] **Step 6: Mount `OrgSwitcher` in the portal shell + gate portal pages**

In `apps/web/src/app/(marketplace)/layout.tsx`, after the `isMarketplaceEnabled()` guard, render the portal shell with `<OrgSwitcher memberships={…} />` at the top (import `OrgSwitcher` from `@/components/layout/OrgSwitcher`; source memberships via `listMyOrganisations()` from `@/actions/active-organisation.actions`). Leave `/register` (public) unaffected — the switcher only shows when the user is authenticated. In each of `supplier/profile/page.tsx`, `supplier/catalogue/page.tsx`, `supplier/orders/page.tsx`, replace the current implicit lookup with:
```ts
import { getSupplierContext } from '@/lib/auth-org'
import { redirect } from 'next/navigation'
// …
const supplierCtx = await getSupplierContext()
if (!supplierCtx) redirect('/supplier/switch?reason=not-supplier-org')
```
Add a lightweight `supplier/switch/page.tsx` server component that explains "Your active organisation is not a supplier — switch to your supplier org" and renders `OrgSwitcher`. **Sub-role gate:** catalogue/profile/settings pages additionally require `SUPPLIER_PORTAL_ROLES` (call `requireRole(supabase, supplierCtx.organisationId, SUPPLIER_PORTAL_ROLES)` and redirect on `!ok`); the orders/RFQ pages require `SUPPLIER_STAFF_ROLES`.

- [ ] **Step 7: Verify types + lint**

Run: `pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. With the **run** skill, confirm (behind the flag) that a dual firm+supplier user sees the switcher, that a firm-org context redirects to `/supplier/switch`, and that switching to the supplier org renders the portal.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/index.ts packages/shared/src/__tests__/marketplace/supplier-roles.test.ts apps/web/src/lib/auth-org.ts apps/web/src/app/\(marketplace\)
git commit -m "feat(marketplace): supplier-portal context + sub-roles (context switch, staff vs admin)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: VAT / tax-class helper (`@esite/shared`)

There is no VAT constant in the repo today (15% is a magic number in two files). Add one canonical, tested source used by pricing, cart, checkout, and quotes. Spec §3.2 tax classes.

**Files:**
- Create: `packages/shared/src/marketplace/tax.ts`
- Test: `packages/shared/src/__tests__/marketplace/tax.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/marketplace/tax.test.ts
import { describe, it, expect } from 'vitest'
import { VAT_RATE, TAX_CLASS_VALUES, vatRateForClass, computeLineVatCents } from '../../marketplace/tax'

describe('VAT / tax classes', () => {
  it('VAT_RATE is 0.15', () => expect(VAT_RATE).toBe(0.15))
  it('exposes the three tax classes', () =>
    expect([...TAX_CLASS_VALUES].sort()).toEqual(['exempt', 'standard', 'zero_rated']))
  it('rate is 15% for standard, 0 for zero-rated/exempt', () => {
    expect(vatRateForClass('standard')).toBe(0.15)
    expect(vatRateForClass('zero_rated')).toBe(0)
    expect(vatRateForClass('exempt')).toBe(0)
  })
  it('computes integer-cent VAT with round-half-up', () => {
    expect(computeLineVatCents(10000, 'standard')).toBe(1500) // R100.00 -> R15.00
    expect(computeLineVatCents(3333, 'standard')).toBe(500)   // 499.95 -> 500
    expect(computeLineVatCents(10000, 'zero_rated')).toBe(0)
    expect(computeLineVatCents(10000, 'exempt')).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- tax`
Expected: FAIL — cannot resolve `../../marketplace/tax`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/marketplace/tax.ts
/** South African VAT. Ex-VAT prices are stored; VAT is applied per tax class at checkout. */
export const VAT_RATE = 0.15

export const TAX_CLASS_VALUES = ['standard', 'zero_rated', 'exempt'] as const
export type TaxClass = (typeof TAX_CLASS_VALUES)[number]

export function isTaxClass(v: string): v is TaxClass {
  return (TAX_CLASS_VALUES as readonly string[]).includes(v)
}

export function vatRateForClass(taxClass: TaxClass): number {
  return taxClass === 'standard' ? VAT_RATE : 0
}

/** VAT on an ex-VAT line, in integer cents (round half up). */
export function computeLineVatCents(exVatCents: number, taxClass: TaxClass): number {
  return Math.round(exVatCents * vatRateForClass(taxClass))
}
```

- [ ] **Step 4: Export + verify it passes**

Add `export * from './marketplace/tax'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- tax`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/marketplace/tax.ts packages/shared/src/__tests__/marketplace/tax.test.ts packages/shared/src/index.ts
git commit -m "feat(marketplace): canonical VAT rate + tax-class helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `resolvePrice` pricing-resolution service (`@esite/shared`)

The single pure function that resolves a buyer's unit price. Precedence **contract > tier > list**. Pure (no I/O — the caller pre-fetches tiers/contracts), so it is exhaustively unit-testable. Consumed by storefront, product page, cart, checkout, and RFQ.

**Files:**
- Create: `packages/shared/src/marketplace/pricing.ts`
- Test: `packages/shared/src/__tests__/marketplace/pricing.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/marketplace/pricing.test.ts
import { describe, it, expect } from 'vitest'
import { resolvePrice, type ResolvePriceItem } from '../../marketplace/pricing'

const base: ResolvePriceItem = { listPriceExVatCents: 10000, taxClass: 'standard', tiers: [], contracts: [] }

describe('resolvePrice', () => {
  it('falls back to list price with no tiers/contracts', () => {
    const r = resolvePrice(base, 'buyer-1', 1)
    expect(r).toEqual({ unitPriceExVatCents: 10000, tierApplied: null, contractApplied: false, taxClass: 'standard' })
  })
  it('applies the best volume tier whose minQty <= qty', () => {
    const item = { ...base, tiers: [{ minQty: 10, unitPriceExVatCents: 9000 }, { minQty: 50, unitPriceExVatCents: 8000 }] }
    expect(resolvePrice(item, 'buyer-1', 5).unitPriceExVatCents).toBe(10000)
    expect(resolvePrice(item, 'buyer-1', 10).unitPriceExVatCents).toBe(9000)
    expect(resolvePrice(item, 'buyer-1', 60).unitPriceExVatCents).toBe(8000)
  })
  it('contract price overrides tier and list', () => {
    const item = {
      ...base,
      tiers: [{ minQty: 10, unitPriceExVatCents: 9000 }],
      contracts: [{ buyerOrgId: 'buyer-1', unitPriceExVatCents: 7500, discountPct: null, validFrom: null, validTo: null }],
    }
    const r = resolvePrice(item, 'buyer-1', 50)
    expect(r.unitPriceExVatCents).toBe(7500)
    expect(r.contractApplied).toBe(true)
    expect(r.tierApplied).toBeNull()
  })
  it('contract percentage discount applies to list', () => {
    const item = { ...base, contracts: [{ buyerOrgId: 'buyer-1', unitPriceExVatCents: null, discountPct: 10, validFrom: null, validTo: null }] }
    expect(resolvePrice(item, 'buyer-1', 1).unitPriceExVatCents).toBe(9000)
  })
  it('ignores a contract for a different buyer or outside its validity window', () => {
    const item = {
      ...base,
      contracts: [
        { buyerOrgId: 'buyer-2', unitPriceExVatCents: 1, discountPct: null, validFrom: null, validTo: null },
        { buyerOrgId: 'buyer-1', unitPriceExVatCents: 1, discountPct: null, validFrom: '2000-01-01', validTo: '2000-12-31' },
      ],
    }
    expect(resolvePrice(item, 'buyer-1', 1, new Date('2026-07-13')).unitPriceExVatCents).toBe(10000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- pricing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/marketplace/pricing.ts
import type { TaxClass } from './tax'

export interface PriceTier {
  minQty: number
  unitPriceExVatCents: number
}
export interface ContractPrice {
  buyerOrgId: string
  unitPriceExVatCents: number | null
  discountPct: number | null
  validFrom: string | null // ISO date, inclusive
  validTo: string | null   // ISO date, inclusive
}
export interface ResolvePriceItem {
  listPriceExVatCents: number
  taxClass: TaxClass
  tiers: PriceTier[]
  contracts: ContractPrice[]
}
export interface ResolvedPrice {
  unitPriceExVatCents: number
  tierApplied: PriceTier | null
  contractApplied: boolean
  taxClass: TaxClass
}

function contractIsActive(c: ContractPrice, now: Date): boolean {
  if (c.validFrom && new Date(c.validFrom) > now) return false
  if (c.validTo && new Date(`${c.validTo}T23:59:59`) < now) return false
  return true
}

/**
 * Resolve the ex-VAT unit price for a buyer. Precedence: contract > tier > list.
 * Pure — caller supplies the item's tiers/contracts. Prices are integer cents.
 */
export function resolvePrice(
  item: ResolvePriceItem,
  buyerOrgId: string,
  qty: number,
  now: Date = new Date(),
): ResolvedPrice {
  const list = item.listPriceExVatCents

  const contract = item.contracts.find((c) => c.buyerOrgId === buyerOrgId && contractIsActive(c, now))
  if (contract) {
    const unit =
      contract.unitPriceExVatCents != null
        ? contract.unitPriceExVatCents
        : Math.round(list * (1 - (contract.discountPct ?? 0) / 100))
    return { unitPriceExVatCents: unit, tierApplied: null, contractApplied: true, taxClass: item.taxClass }
  }

  const tier = item.tiers.filter((t) => t.minQty <= qty).sort((a, b) => b.minQty - a.minQty)[0] ?? null
  if (tier) {
    return { unitPriceExVatCents: tier.unitPriceExVatCents, tierApplied: tier, contractApplied: false, taxClass: item.taxClass }
  }

  return { unitPriceExVatCents: list, tierApplied: null, contractApplied: false, taxClass: item.taxClass }
}
```

- [ ] **Step 4: Export + verify it passes**

Add `export * from './marketplace/pricing'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- pricing`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/marketplace/pricing.ts packages/shared/src/__tests__/marketplace/pricing.test.ts packages/shared/src/index.ts
git commit -m "feat(marketplace): resolvePrice service (contract > tier > list)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Catalogue media (table + `catalogue-media` bucket + upload UI + gallery)

Spec §3.2 media. New table + a public-read bucket + a `primary_media_id` on `catalogue_items`; upload reuses the existing `compressImage` (lifted to a shared util); buyer gallery is added in Task 10's product page.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00176_marketplace_catalogue_media.sql`
- Create: `apps/web/src/lib/images/compress-image.ts` (lifted shared helper)
- Modify: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/useFieldPhotos.ts` (import the shared helper instead of its local copy)
- Create: `apps/web/src/actions/catalogue-media.actions.ts`
- Create: `apps/web/src/app/(marketplace)/supplier/catalogue/[itemId]/CatalogueMediaManager.tsx`
- Modify: `apps/web/src/app/(marketplace)/supplier/catalogue/[itemId]/page.tsx` (mount the manager)

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00176_marketplace_catalogue_media.sql
-- Catalogue item media (images/spec-sheets) + public-read storage bucket.

CREATE TABLE marketplace.catalogue_item_media (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_item_id UUID NOT NULL REFERENCES marketplace.catalogue_items(id) ON DELETE CASCADE,
  supplier_org_id   UUID REFERENCES public.organisations(id),
  storage_path      TEXT NOT NULL,
  media_type        TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'spec_sheet')),
  content_type      TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_catalogue_item_media_item ON marketplace.catalogue_item_media(catalogue_item_id, sort_order);

ALTER TABLE marketplace.catalogue_items
  ADD COLUMN primary_media_id UUID REFERENCES marketplace.catalogue_item_media(id) ON DELETE SET NULL;

ALTER TABLE marketplace.catalogue_item_media ENABLE ROW LEVEL SECURITY;

-- SELECT: owning supplier org, OR media of a publicly-listed item.
CREATE POLICY "catalogue_media_select" ON marketplace.catalogue_item_media
  FOR SELECT USING (
    supplier_org_id = ANY(public.get_user_org_ids())
    OR EXISTS (
      SELECT 1 FROM marketplace.catalogue_items ci
      WHERE ci.id = catalogue_item_id AND ci.marketplace_visible = TRUE AND ci.is_active = TRUE
    )
  );
CREATE POLICY "catalogue_media_write" ON marketplace.catalogue_item_media
  FOR ALL USING (supplier_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "catalogue_media_no_client_viewer" ON marketplace.catalogue_item_media
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id))
  WITH CHECK (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id));

-- Public-read product-media bucket (product photos are non-sensitive); writes RLS-gated.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catalogue-media', 'catalogue-media', TRUE, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Object path convention: {supplier_org_id}/{catalogue_item_id}/{timestamp}-{file}
CREATE POLICY "catalogue_media_obj_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalogue-media'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
  );
CREATE POLICY "catalogue_media_obj_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'catalogue-media' AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids()));
CREATE POLICY "catalogue_media_obj_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'catalogue-media' AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids()));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Lift `compressImage` into a shared util**

Create `apps/web/src/lib/images/compress-image.ts` with the exact body of the copy in `useFieldPhotos.ts` (`export async function compressImage(file: File): Promise<File>` — `MAX_WIDTH = 2048`, `QUALITY = 0.85`, `createImageBitmap(...{ imageOrientation: 'from-image' })` → canvas → `toBlob('image/jpeg', 0.85)`, bail to original on any failure or non-image). Then in `useFieldPhotos.ts` delete the local `compressImage` and `import { compressImage } from '@/lib/images/compress-image'`.

- [ ] **Step 3: Write the media server actions**

```ts
// apps/web/src/actions/catalogue-media.actions.ts
'use server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { getSupplierContext } from '@/lib/auth-org'
import { SUPPLIER_PORTAL_ROLES } from '@esite/shared'
import { revalidatePath } from 'next/cache'

async function assertOwnsItem(itemId: string) {
  const ctx = await getSupplierContext()
  if (!ctx) return { error: 'Not a supplier context.' as const }
  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, SUPPLIER_PORTAL_ROLES)
  if (!guard.ok) return { error: guard.error }
  const { data: item } = await supabase
    .schema('marketplace').from('catalogue_items')
    .select('id, supplier_org_id').eq('id', itemId).maybeSingle()
  if (!item || item.supplier_org_id !== ctx.organisationId) return { error: 'Item not found.' as const }
  return { supabase, ctx }
}

export async function addCatalogueMediaAction(input: {
  itemId: string; storagePath: string; contentType: string; mediaType?: 'image' | 'spec_sheet'
}): Promise<{ error?: string; id?: string }> {
  const parsed = z.object({
    itemId: z.string().uuid(), storagePath: z.string().min(1),
    contentType: z.string().min(1), mediaType: z.enum(['image', 'spec_sheet']).default('image'),
  }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid media.' }
  const ok = await assertOwnsItem(parsed.data.itemId)
  if ('error' in ok) return { error: ok.error }
  const { supabase, ctx } = ok
  const { data, error } = await supabase.schema('marketplace').from('catalogue_item_media')
    .insert({
      catalogue_item_id: parsed.data.itemId, supplier_org_id: ctx.organisationId,
      storage_path: parsed.data.storagePath, content_type: parsed.data.contentType, media_type: parsed.data.mediaType,
    }).select('id').single()
  if (error) return { error: error.message }
  // First image becomes primary automatically.
  await supabase.schema('marketplace').from('catalogue_items')
    .update({ primary_media_id: data.id }).eq('id', parsed.data.itemId).is('primary_media_id', null)
  revalidatePath(`/supplier/catalogue/${parsed.data.itemId}`)
  return { id: data.id }
}

export async function setPrimaryMediaAction(itemId: string, mediaId: string): Promise<{ error?: string }> {
  const ok = await assertOwnsItem(itemId)
  if ('error' in ok) return { error: ok.error }
  const { error } = await ok.supabase.schema('marketplace').from('catalogue_items')
    .update({ primary_media_id: mediaId }).eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/supplier/catalogue/${itemId}`)
  return {}
}

export async function deleteCatalogueMediaAction(itemId: string, mediaId: string): Promise<{ error?: string }> {
  const ok = await assertOwnsItem(itemId)
  if ('error' in ok) return { error: ok.error }
  const { supabase } = ok
  const { data: media } = await supabase.schema('marketplace').from('catalogue_item_media')
    .select('storage_path').eq('id', mediaId).maybeSingle()
  await supabase.schema('marketplace').from('catalogue_item_media').delete().eq('id', mediaId)
  if (media?.storage_path) await supabase.storage.from('catalogue-media').remove([media.storage_path])
  revalidatePath(`/supplier/catalogue/${itemId}`)
  return {}
}
```

- [ ] **Step 4: Write the upload UI component**

`CatalogueMediaManager.tsx` (`'use client'`): a thumbnail grid of existing media (each with a "Set primary" star + a two-step inline delete — mirror the `useFieldPhotos` Safari-safe two-tap confirm) plus a hidden `<input type="file" accept="image/*,application/pdf" multiple>`. On file select, for each file: `const prepared = await compressImage(file)` (from `@/lib/images/compress-image`), build `path = ${ctx.organisationId}/${itemId}/${Date.now()}-${safeName}`, `await supabase.storage.from('catalogue-media').upload(path, prepared, { contentType: prepared.type })` using the **browser** client (`@/lib/supabase/client`), then `await addCatalogueMediaAction({ itemId, storagePath: path, contentType: prepared.type })`. Bytes go browser→Storage directly (no Vercel 4.5 MB cap). Render existing images from the public URL `supabase.storage.from('catalogue-media').getPublicUrl(path)`.

- [ ] **Step 5: Mount in the item edit page + verify**

In `supplier/catalogue/[itemId]/page.tsx`, after `getSupplierContext()`/ownership check, load the item's media rows and render `<CatalogueMediaManager itemId={item.id} orgId={supplierCtx.organisationId} media={media} primaryMediaId={item.primary_media_id} />`.
Run: `pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. With the **run** skill, upload 2 images to a test item, set a primary, delete one; confirm the bucket objects + `catalogue_item_media` rows track and `primary_media_id` updates.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00176_marketplace_catalogue_media.sql apps/web/src/lib/images/compress-image.ts apps/web/src/actions/catalogue-media.actions.ts apps/web/src/app/\(marketplace\)/supplier/catalogue apps/web/src/app/\(admin\)/projects/\[id\]/inspections
git commit -m "feat(marketplace): catalogue media table + public bucket + upload UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Inventory / stock columns + `stockStatus` helper

Spec §3.2 inventory. Columns on `catalogue_items`, a supplier capture UI, a pure `stockStatus` helper for display, and the **decrement rule** (deferred to accept/paid — enforced in Task 12).

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00177_marketplace_catalogue_inventory.sql`
- Create: `packages/shared/src/marketplace/stock.ts`
- Test: `packages/shared/src/__tests__/marketplace/stock.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `apps/web/src/app/(marketplace)/supplier/catalogue/CatalogueItemForm.tsx` (add stock/tax fields)
- Modify: `apps/web/src/actions/supplier.actions.ts` (`create`/`updateCatalogueItemAction` capture the new columns)

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00177_marketplace_catalogue_inventory.sql
-- Inventory + tax-class on catalogue items.
ALTER TABLE marketplace.catalogue_items
  ADD COLUMN track_inventory      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN stock_on_hand        NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN backorder_allowed    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN restock_lead_days    INTEGER,
  ADD COLUMN low_stock_threshold  NUMERIC NOT NULL DEFAULT 5,
  ADD COLUMN tax_class            TEXT NOT NULL DEFAULT 'standard'
    CHECK (tax_class IN ('standard', 'zero_rated', 'exempt'));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing `stockStatus` test**

```ts
// packages/shared/src/__tests__/marketplace/stock.test.ts
import { describe, it, expect } from 'vitest'
import { stockStatus } from '../../marketplace/stock'

describe('stockStatus', () => {
  it('untracked inventory is always in_stock', () =>
    expect(stockStatus({ trackInventory: false, stockOnHand: 0, backorderAllowed: false, lowStockThreshold: 5 })).toBe('in_stock'))
  it('above threshold is in_stock', () =>
    expect(stockStatus({ trackInventory: true, stockOnHand: 20, backorderAllowed: false, lowStockThreshold: 5 })).toBe('in_stock'))
  it('at or below threshold (but >0) is low', () =>
    expect(stockStatus({ trackInventory: true, stockOnHand: 5, backorderAllowed: false, lowStockThreshold: 5 })).toBe('low'))
  it('zero with backorder is backorder', () =>
    expect(stockStatus({ trackInventory: true, stockOnHand: 0, backorderAllowed: true, lowStockThreshold: 5 })).toBe('backorder'))
  it('zero without backorder is out_of_stock', () =>
    expect(stockStatus({ trackInventory: true, stockOnHand: 0, backorderAllowed: false, lowStockThreshold: 5 })).toBe('out_of_stock'))
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- stock`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// packages/shared/src/marketplace/stock.ts
export type StockStatus = 'in_stock' | 'low' | 'backorder' | 'out_of_stock'

export interface StockInput {
  trackInventory: boolean
  stockOnHand: number
  backorderAllowed: boolean
  lowStockThreshold: number
}

export function stockStatus(item: StockInput): StockStatus {
  if (!item.trackInventory) return 'in_stock'
  if (item.stockOnHand <= 0) return item.backorderAllowed ? 'backorder' : 'out_of_stock'
  if (item.stockOnHand <= item.lowStockThreshold) return 'low'
  return 'in_stock'
}

/** Would selling `qty` oversell? True = block (unless backorder allowed). */
export function wouldOversell(item: StockInput, qty: number): boolean {
  if (!item.trackInventory || item.backorderAllowed) return false
  return qty > item.stockOnHand
}
```

- [ ] **Step 5: Export + verify it passes**

Add `export * from './marketplace/stock'` to `packages/shared/src/index.ts`.
Run: `pnpm --filter @esite/shared test -- stock`
Expected: PASS (5 tests).

- [ ] **Step 6: Add the supplier capture fields**

In `CatalogueItemForm.tsx`: add a "Stock & tax" fieldset — a `track_inventory` checkbox, `stock_on_hand` (number, shown when tracking), `backorder_allowed` checkbox, `restock_lead_days` (number, optional), `low_stock_threshold` (number, default 5), and a `tax_class` `<select>` (`standard`/`zero_rated`/`exempt`, labels "Standard 15% / Zero-rated / Exempt"). In `createCatalogueItemAction`/`updateCatalogueItemAction` (`supplier.actions.ts`), extend the Zod schema + insert/update payloads to include `track_inventory` (`'on'→bool`), `stock_on_hand` (coerce number ≥0), `backorder_allowed`, `restock_lead_days` (int|null), `low_stock_threshold` (number ≥0), `tax_class` (`z.enum([...])` — import `TAX_CLASS_VALUES` from `@esite/shared`). **While here, close the Phase-0-flagged gaps in these two actions:** add `getSupplierContext()` + `requireRole(..., SUPPLIER_PORTAL_ROLES)` and `.eq('supplier_org_id', ctx.organisationId)` ownership scoping (today `updateCatalogueItemAction`/`toggleCatalogueVisibilityAction` have **no auth gate at all**).

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/edge-functions/supabase/migrations/00177_marketplace_catalogue_inventory.sql packages/shared/src/marketplace/stock.ts packages/shared/src/__tests__/marketplace/stock.test.ts packages/shared/src/index.ts apps/web/src/app/\(marketplace\)/supplier/catalogue/CatalogueItemForm.tsx apps/web/src/actions/supplier.actions.ts
git commit -m "feat(marketplace): inventory columns + stockStatus helper + tax_class capture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Tiered / volume pricing

Spec §3.2 tiered pricing. New table (cents), a supplier editor, and wiring into `resolvePrice`.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00178_marketplace_price_tiers.sql`
- Modify: `apps/web/src/actions/supplier.actions.ts` (add `setPriceTiersAction`)
- Create: `apps/web/src/app/(marketplace)/supplier/catalogue/[itemId]/PriceTiersEditor.tsx`
- Modify: `apps/web/src/app/(marketplace)/supplier/catalogue/[itemId]/page.tsx` (mount editor)

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00178_marketplace_price_tiers.sql
CREATE TABLE marketplace.catalogue_price_tiers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_item_id      UUID NOT NULL REFERENCES marketplace.catalogue_items(id) ON DELETE CASCADE,
  supplier_org_id        UUID REFERENCES public.organisations(id),
  min_qty                NUMERIC NOT NULL CHECK (min_qty > 0),
  unit_price_ex_vat_cents BIGINT NOT NULL CHECK (unit_price_ex_vat_cents >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (catalogue_item_id, min_qty)
);
CREATE INDEX idx_price_tiers_item ON marketplace.catalogue_price_tiers(catalogue_item_id, min_qty);

ALTER TABLE marketplace.catalogue_price_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_tiers_select" ON marketplace.catalogue_price_tiers
  FOR SELECT USING (
    supplier_org_id = ANY(public.get_user_org_ids())
    OR EXISTS (
      SELECT 1 FROM marketplace.catalogue_items ci
      WHERE ci.id = catalogue_item_id AND ci.marketplace_visible = TRUE AND ci.is_active = TRUE
    )
  );
CREATE POLICY "price_tiers_write" ON marketplace.catalogue_price_tiers
  FOR ALL USING (supplier_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "price_tiers_no_client_viewer" ON marketplace.catalogue_price_tiers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id))
  WITH CHECK (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Add `setPriceTiersAction`**

In `supplier.actions.ts` (reuse the ownership helper from Task 4/5): `setPriceTiersAction(itemId: string, tiers: { minQty: number; unitPriceRand: number }[])` — gate with `getSupplierContext()` + `requireRole(..., SUPPLIER_PORTAL_ROLES)` + item ownership; Zod-validate (`minQty > 0`, `unitPriceRand >= 0`, dedupe `minQty`); convert `unit_price_ex_vat_cents = randToCents(unitPriceRand)` (import `randToCents` from `@esite/shared`); replace the item's tiers transactionally (`delete().eq('catalogue_item_id', itemId)` then `insert(rows with supplier_org_id = ctx.organisationId)`). Return `{ error? }`. `revalidatePath`.

- [ ] **Step 3: Write the editor UI**

`PriceTiersEditor.tsx` (`'use client'`): an editable table of rows `{ minQty, unitPriceRand }` with add/remove, sorted by `minQty`; a "Save tiers" button calling `setPriceTiersAction`. Show a live "e.g. buying 50 ⇒ R…" preview using the same precedence rule as `resolvePrice` (client-side call is fine; the server snapshots at order time). Format money with `formatZAR` from `@esite/shared`.

- [ ] **Step 4: Mount + verify + commit**

Mount `<PriceTiersEditor itemId={item.id} tiers={tiers} listPrice={item.unit_price} />` in the item edit page.
Run: `pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill, add tiers (10 → R90, 50 → R80) and confirm rows persist as cents.
```bash
git add apps/edge-functions/supabase/migrations/00178_marketplace_price_tiers.sql apps/web/src/actions/supplier.actions.ts apps/web/src/app/\(marketplace\)/supplier/catalogue/\[itemId\]
git commit -m "feat(marketplace): tiered/volume pricing (table + editor + resolvePrice wiring)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Per-buyer contract pricing

Spec §3.2 contract pricing + precedence. New table (cents), a supplier editor keyed to a buyer org, and precedence confirmation in `resolvePrice`.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00179_marketplace_contract_prices.sql`
- Modify: `apps/web/src/actions/supplier.actions.ts` (add `setContractPriceAction`, `deleteContractPriceAction`)
- Create: `apps/web/src/app/(marketplace)/supplier/catalogue/[itemId]/ContractPricesEditor.tsx`
- Modify: item edit page (mount editor)

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00179_marketplace_contract_prices.sql
CREATE TABLE marketplace.contract_prices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id             UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  supplier_org_id         UUID REFERENCES public.organisations(id),
  buyer_org_id            UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  catalogue_item_id       UUID REFERENCES marketplace.catalogue_items(id) ON DELETE CASCADE,
  unit_price_ex_vat_cents BIGINT CHECK (unit_price_ex_vat_cents >= 0),
  discount_pct            NUMERIC CHECK (discount_pct >= 0 AND discount_pct <= 100),
  valid_from              DATE,
  valid_to                DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contract_price_one_of CHECK (unit_price_ex_vat_cents IS NOT NULL OR discount_pct IS NOT NULL)
);
CREATE INDEX idx_contract_prices_lookup ON marketplace.contract_prices(catalogue_item_id, buyer_org_id);

ALTER TABLE marketplace.contract_prices ENABLE ROW LEVEL SECURITY;

-- Buyer may READ its own contract prices (to see negotiated pricing); supplier org manages.
CREATE POLICY "contract_prices_select" ON marketplace.contract_prices
  FOR SELECT USING (
    supplier_org_id = ANY(public.get_user_org_ids())
    OR buyer_org_id = ANY(public.get_user_org_ids())
  );
CREATE POLICY "contract_prices_write" ON marketplace.contract_prices
  FOR ALL USING (supplier_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "contract_prices_no_client_viewer" ON marketplace.contract_prices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id))
  WITH CHECK (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Add the actions**

`setContractPriceAction(input: { itemId: string; buyerOrgId: string; unitPriceRand?: number; discountPct?: number; validFrom?: string; validTo?: string })` and `deleteContractPriceAction(contractId: string)` in `supplier.actions.ts`. Gate with supplier context + `SUPPLIER_PORTAL_ROLES` + item ownership; Zod-validate "exactly one of unitPriceRand/discountPct"; convert `unit_price_ex_vat_cents = randToCents(unitPriceRand)`; set `supplier_id`/`supplier_org_id` from context; upsert on `(catalogue_item_id, buyer_org_id)` via `supabase.schema('marketplace').from('contract_prices').upsert(row, { onConflict: 'catalogue_item_id,buyer_org_id' })` (user-client upsert emits the `Prefer: resolution=merge-duplicates` header correctly — the raw-fetch Prefer-header gotcha does not apply here). Add a unique partial index only if upsert conflict-target requires it; otherwise use delete-then-insert. `revalidatePath`.

- [ ] **Step 3: Editor UI + verify + commit**

`ContractPricesEditor.tsx` (`'use client'`): a buyer-org picker (search the buyer orgs the supplier already trades with via `suppliers.organisation_suppliers`, else any org id), a price-or-discount toggle, optional validity dates, and a list of existing contract rows with delete. Save via the actions.
Run: `pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill, set a R75 contract for a buyer org and confirm the storefront (Task 10) shows R75 for that buyer, tier/list for others.
```bash
git add apps/edge-functions/supabase/migrations/00179_marketplace_contract_prices.sql apps/web/src/actions/supplier.actions.ts apps/web/src/app/\(marketplace\)/supplier/catalogue/\[itemId\]
git commit -m "feat(marketplace): per-buyer contract pricing (table + editor, precedence over tier/list)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `supplier_settings` (payment modes, fulfilment, terms, auto-accept)

Spec §2.4. Schema + a supplier settings page. Fields are captured now and consumed by checkout (Task 12) and later phases.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00180_marketplace_supplier_settings.sql`
- Create: `apps/web/src/actions/supplier-settings.actions.ts`
- Create: `apps/web/src/app/(marketplace)/supplier/settings/page.tsx` + `SupplierSettingsForm.tsx`

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00180_marketplace_supplier_settings.sql
CREATE TABLE marketplace.supplier_settings (
  supplier_id          UUID PRIMARY KEY REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  supplier_org_id      UUID REFERENCES public.organisations(id),
  payment_modes        TEXT[] NOT NULL DEFAULT ARRAY['on_account']
    CHECK (payment_modes <@ ARRAY['pay_now', 'on_account']),
  offers_delivery      BOOLEAN NOT NULL DEFAULT TRUE,
  offers_collection    BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_fee_cents   BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  free_delivery_over_cents BIGINT CHECK (free_delivery_over_cents >= 0),
  default_terms_days   INTEGER,
  default_lead_days    INTEGER,
  return_policy        TEXT,
  auto_accept_orders   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE marketplace.supplier_settings ENABLE ROW LEVEL SECURITY;

-- Readable by the owning supplier org AND by any buyer (checkout needs payment_modes/fulfilment).
CREATE POLICY "supplier_settings_select" ON marketplace.supplier_settings
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "supplier_settings_write" ON marketplace.supplier_settings
  FOR ALL USING (supplier_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "supplier_settings_no_client_viewer" ON marketplace.supplier_settings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id))
  WITH CHECK (supplier_org_id IS NULL OR NOT public.user_is_client_viewer(supplier_org_id));

NOTIFY pgrst, 'reload schema';
```
*(Note: `supplier_settings` is world-readable to authenticated users like `suppliers`/`supplier_ratings` — checkout must read another supplier's `payment_modes`/fulfilment. Sensitive commercial fields stay elsewhere.)*

- [ ] **Step 2: Write `updateSupplierSettingsAction`**

`apps/web/src/actions/supplier-settings.actions.ts`: `updateSupplierSettingsAction(formData: FormData)` — gate with `getSupplierContext()` + `requireRole(..., SUPPLIER_PORTAL_ROLES)`; Zod-parse `payment_modes` (getAll, subset of `['pay_now','on_account']`; **Phase 1 note:** if `pay_now` is selected, still accept it but the buyer checkout hides it until Phase 2), `offers_delivery`/`offers_collection`/`auto_accept_orders` (`'on'→bool`), `delivery_fee` + `free_delivery_over` (rand → `randToCents`), `default_terms_days`/`default_lead_days` (int|null), `return_policy` (text). Upsert on `supplier_id` (PK) with `supplier_org_id = ctx.organisationId`. `revalidatePath('/supplier/settings')`.

- [ ] **Step 3: Settings page + verify + commit**

`supplier/settings/page.tsx` (server): `getSupplierContext()` → redirect if null → `requireRole(SUPPLIER_PORTAL_ROLES)` → load existing settings → render `SupplierSettingsForm`. Use `Card/CardHeader/CardBody`. Add "Settings" to the portal nav and mark item ⑤ of the setup checklist (spec §2.1) done when a row exists.
Run: `pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill, save settings and re-load to confirm persistence.
```bash
git add apps/edge-functions/supabase/migrations/00180_marketplace_supplier_settings.sql apps/web/src/actions/supplier-settings.actions.ts apps/web/src/app/\(marketplace\)/supplier/settings
git commit -m "feat(marketplace): supplier_settings (payment modes, fulfilment, terms, auto-accept)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Bulk catalogue import (CSV/XLSX — parse → preview → commit)

Spec §3.3. Mirror the tenant-schedule import exactly: a pure shared parser + differ, two role-gated API routes that re-parse server-side, and an `ImportFlow` UI. **Never silently drop rows** — bad rows surface as per-row errors.

**Files:**
- Create: `packages/shared/src/marketplace/catalogue-import-parser.ts`
- Create: `packages/shared/src/marketplace/catalogue-import-preview.ts`
- Test: `packages/shared/src/__tests__/marketplace/catalogue-import.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Create: `apps/web/src/app/api/catalogue-import/parse/route.ts`, `.../commit/route.ts`
- Create: `apps/web/src/app/(marketplace)/supplier/catalogue/import/{page.tsx,ImportFlow.tsx}` + a downloadable template

- [ ] **Step 1: Write the failing parser/differ test**

```ts
// packages/shared/src/__tests__/marketplace/catalogue-import.test.ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseCatalogueImport } from '../../marketplace/catalogue-import-parser'
import { diffCatalogue } from '../../marketplace/catalogue-import-preview'

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Catalogue')
  rows.forEach((r) => ws.addRow(r))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const HEADER = ['sku', 'name', 'category', 'unit', 'unit_price', 'min_order_qty', 'lead_time_days', 'tax_class']

describe('catalogue import', () => {
  it('parses valid rows and flags a bad-price row as an error (never dropping it silently)', async () => {
    const buf = await xlsx([
      HEADER,
      ['SKU-1', 'Cable 2.5mm', 'electrical', 'm', 12.5, 100, 3, 'standard'],
      ['SKU-2', 'Bad Price', 'electrical', 'ea', 'abc', 1, 1, 'standard'],
    ])
    const res = await parseCatalogueImport(buf, 'catalogue.xlsx')
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].sku).toBe('SKU-1')
    expect(res.rows[0].unitPriceExVatCents).toBe(1250)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].sku).toBe('SKU-2')
  })
  it('rejects an unknown category as a per-row error', async () => {
    const buf = await xlsx([HEADER, ['SKU-3', 'X', 'plumbing', 'ea', 5, 1, 1, 'standard']])
    const res = await parseCatalogueImport(buf, 'catalogue.xlsx')
    expect(res.rows).toHaveLength(0)
    expect(res.errors[0].message).toMatch(/category/i)
  })
  it('diffs new vs updated by SKU', () => {
    const rows = [{ source_row: 2, sku: 'SKU-1', name: 'Cable', category: 'electrical', unit: 'm', unitPriceExVatCents: 1250, minOrderQty: 100, leadTimeDays: 3, taxClass: 'standard' as const }]
    const preview = diffCatalogue(rows, [], [{ id: 'x', sku: 'SKU-1', name: 'Old', unit_price: 10 }])
    expect(preview.updated_entries).toHaveLength(1)
    expect(preview.new_entries).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- catalogue-import`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the parser**

Create `catalogue-import-parser.ts` modelled on `structure/tenant-import-parser.ts`:
```ts
// packages/shared/src/marketplace/catalogue-import-parser.ts
import ExcelJS from 'exceljs'
import { isMarketplaceCategory } from './categories'
import { isTaxClass, type TaxClass } from './tax'
import { randToCents } from '../money/money'

export interface CatalogueImportRow {
  source_row: number
  sku: string
  name: string
  category: string
  unit: string
  unitPriceExVatCents: number
  minOrderQty: number
  leadTimeDays: number | null
  taxClass: TaxClass
}
export interface CatalogueImportError { source_row: number; message: string; sku?: string }
export interface CatalogueImportResult {
  rows: CatalogueImportRow[]
  errors: CatalogueImportError[]
  warnings: CatalogueImportError[]
}

const HEADERS = ['sku', 'name', 'category', 'unit', 'unit_price', 'min_order_qty', 'lead_time_days', 'tax_class'] as const

export async function parseCatalogueImport(buffer: Buffer, filename: string): Promise<CatalogueImportResult> {
  const wb = new ExcelJS.Workbook()
  if (filename.toLowerCase().endsWith('.csv')) await wb.csv.read(bufferToStream(buffer))
  else await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  const rows: CatalogueImportRow[] = []
  const errors: CatalogueImportError[] = []
  const warnings: CatalogueImportError[] = []
  if (!ws) return { rows, errors: [{ source_row: 0, message: 'No worksheet found.' }], warnings }

  const headerRow = ws.getRow(1)
  const colIndex = mapHeaders(headerRow) // { sku: 1, name: 2, ... } tolerant to order/aliases
  const missing = HEADERS.filter((h) => !(h in colIndex) && h !== 'tax_class' && h !== 'lead_time_days')
  if (missing.length) return { rows, errors: [{ source_row: 1, message: `Missing columns: ${missing.join(', ')}` }], warnings }

  const seen = new Set<string>()
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const cell = (h: (typeof HEADERS)[number]) => (colIndex[h] ? String(row.getCell(colIndex[h]).value ?? '').trim() : '')
    const sku = cell('sku')
    const name = cell('name')
    if (!sku && !name) return // genuinely blank row
    if (!sku) { errors.push({ source_row: rowNumber, message: 'Missing SKU.' }); return }
    if (!name) { errors.push({ source_row: rowNumber, message: 'Missing name.', sku }); return }
    if (seen.has(sku)) { errors.push({ source_row: rowNumber, message: `Duplicate SKU in file: ${sku}`, sku }); return }
    const category = cell('category').toLowerCase()
    if (!isMarketplaceCategory(category)) { errors.push({ source_row: rowNumber, message: `Unknown category: ${category}`, sku }); return }
    const priceNum = Number(cell('unit_price'))
    if (!Number.isFinite(priceNum) || priceNum < 0) { errors.push({ source_row: rowNumber, message: `Invalid unit_price: ${cell('unit_price')}`, sku }); return }
    const minQty = Number(cell('min_order_qty') || '1')
    if (!Number.isFinite(minQty) || minQty < 1) { errors.push({ source_row: rowNumber, message: 'Invalid min_order_qty.', sku }); return }
    const leadRaw = cell('lead_time_days')
    const leadTimeDays = leadRaw ? Number(leadRaw) : null
    const taxRaw = cell('tax_class') || 'standard'
    if (!isTaxClass(taxRaw)) { errors.push({ source_row: rowNumber, message: `Invalid tax_class: ${taxRaw}`, sku }); return }
    seen.add(sku)
    rows.push({
      source_row: rowNumber, sku, name, category, unit: cell('unit') || 'each',
      unitPriceExVatCents: randToCents(priceNum), minOrderQty: minQty,
      leadTimeDays: leadTimeDays != null && Number.isFinite(leadTimeDays) ? leadTimeDays : null, taxClass: taxRaw,
    })
  })
  return { rows, errors, warnings }
}
```
Include the small helpers `mapHeaders(headerRow)` (lower-case + alias match, mirroring the tenant parser's tolerant header logic) and `bufferToStream(buffer)` (a `Readable` from the buffer for `wb.csv.read`) in the same file.

- [ ] **Step 4: Implement the differ**

```ts
// packages/shared/src/marketplace/catalogue-import-preview.ts
import type { CatalogueImportRow, CatalogueImportError } from './catalogue-import-parser'

export interface ExistingCatalogueItem { id: string; sku: string | null; name: string; unit_price: number }
export interface CataloguePreview {
  new_entries: CatalogueImportRow[]
  updated_entries: { row: CatalogueImportRow; existing: ExistingCatalogueItem }[]
  parse_errors: CatalogueImportError[]
  warnings: CatalogueImportError[]
  parsed_row_count: number
}

export function diffCatalogue(
  rows: CatalogueImportRow[],
  parseErrors: CatalogueImportError[],
  existing: ExistingCatalogueItem[],
  warnings: CatalogueImportError[] = [],
): CataloguePreview {
  const bySku = new Map(existing.filter((e) => e.sku).map((e) => [e.sku as string, e]))
  const new_entries: CatalogueImportRow[] = []
  const updated_entries: { row: CatalogueImportRow; existing: ExistingCatalogueItem }[] = []
  for (const row of rows) {
    const match = bySku.get(row.sku)
    if (match) updated_entries.push({ row, existing: match })
    else new_entries.push(row)
  }
  return { new_entries, updated_entries, parse_errors: parseErrors, warnings, parsed_row_count: rows.length }
}
```
Add `export * from './marketplace/catalogue-import-parser'` and `export * from './marketplace/catalogue-import-preview'` to `packages/shared/src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @esite/shared test -- catalogue-import`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the two API routes**

`parse/route.ts` and `commit/route.ts` under `apps/web/src/app/api/catalogue-import/` — mirror `api/tenant-schedule/{parse,commit}/route.ts` (`runtime='nodejs'`, multipart `file` + no projectId), but gate on the **supplier org**, not a project:
```ts
// gate (both routes)
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
const supplierCtx = await getSupplierContext()
if (!supplierCtx) return NextResponse.json({ error: 'Not a supplier context' }, { status: 403 })
const guard = await requireRole(supabase, supplierCtx.organisationId, SUPPLIER_PORTAL_ROLES)
if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 403 })
```
`parse` → `parseCatalogueImport(buffer, file.name)` → load the supplier's existing items (`sku,id,name,unit_price` for `supplier_id = supplierCtx.supplierId`) → `diffCatalogue(...)` → return the `CataloguePreview` JSON. `commit` → **re-parse + re-diff server-side** (never trust a client diff), then for each `new_entries`/`updated_entries` insert/update `marketplace.catalogue_items` via the **user client** (`supabase.schema('marketplace').from('catalogue_items')`), stamping `supplier_id`/`supplier_org_id` from context and writing `unit_price = centsToRand(row.unitPriceExVatCents)`, `category/unit/min_order_qty/lead_time_days/tax_class`. Skip errored rows (report counts). Return a `CommitResult`-style `{ ok, created, updated, skipped_errors, write_errors }`.

- [ ] **Step 7: Write the `ImportFlow` UI + template**

`supplier/catalogue/import/ImportFlow.tsx` (`'use client'`): copy the state machine from the tenant `ImportFlow.tsx` (`idle→parsing→preview→committing→done`), POSTing the `FormData` to `/api/catalogue-import/parse` then `/commit`, rendering new/updated counts and a **highlighted per-row error list** (each `{ source_row, sku, message }`). Add a "Download template" link serving a static CSV with the header row `sku,name,category,unit,unit_price,min_order_qty,lead_time_days,tax_class`. `import/page.tsx` gates (`getSupplierContext` + `SUPPLIER_PORTAL_ROLES`) and mounts it; link it from the catalogue list page.

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill, import a 3-row file with one bad price and confirm 2 committed + 1 reported error (nothing silently dropped).
```bash
git add packages/shared/src/marketplace/catalogue-import-parser.ts packages/shared/src/marketplace/catalogue-import-preview.ts packages/shared/src/__tests__/marketplace/catalogue-import.test.ts packages/shared/src/index.ts apps/web/src/app/api/catalogue-import apps/web/src/app/\(marketplace\)/supplier/catalogue/import
git commit -m "feat(marketplace): bulk catalogue import (CSV/XLSX parse-preview-commit, per-row errors)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Discovery/directory hardening + storefront + product page

Spec §4. Filter the directory to **listed** suppliers, add province + category/subcategory facets + search + pagination, and add a supplier storefront + a product page showing **buyer-specific** pricing (via `resolvePrice`), stock, media gallery, and price breaks.

**Files:**
- Modify: `packages/shared/src/services/supplier.service.ts` (`listAll` → visibility + province + pagination)
- Modify: `apps/web/src/app/(admin)/marketplace/page.tsx` (facets + pagination; use `MARKETPLACE_CATEGORIES`)
- Modify: `apps/web/src/app/(admin)/marketplace/[supplierId]/page.tsx` (buyer-specific pricing, stock, gallery thumb)
- Create: `apps/web/src/app/(admin)/marketplace/[supplierId]/item/[itemId]/page.tsx` (product page)
- Create: `apps/web/src/lib/marketplace/resolve-catalogue-price.ts` (server helper that fetches tiers/contracts + calls `resolvePrice`)

- [ ] **Step 1: Harden `supplier.service.ts:listAll`**

Change `listAll(client, filters)` to accept `{ category?, search?, province?, limit?, offset? }` and constrain to suppliers that have at least one visible catalogue item (a "listed" supplier), e.g. add `.eq('is_active', true)` (unchanged) plus a filter to those with `EXISTS (visible catalogue_items)` — implement as a two-step (fetch supplier ids that own a `marketplace_visible AND is_active` item, then `.in('id', ids)`), and add `.eq('province', province)` when provided and `.range(offset, offset + limit - 1)`. Return `{ suppliers, total }`. *(Alt considered: a DB view — deferred; the two-step keeps it in the service layer.)*

- [ ] **Step 2: Add the server pricing helper**

```ts
// apps/web/src/lib/marketplace/resolve-catalogue-price.ts
import 'server-only'
import { resolvePrice, type ResolvePriceItem } from '@esite/shared'
import { randToCents } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Fetch tiers + contracts for an item and resolve the buyer's unit price. */
export async function resolveCataloguePrice(
  supabase: SupabaseClient, item: { id: string; unit_price: number; tax_class: string },
  buyerOrgId: string, qty: number,
) {
  const [{ data: tiers }, { data: contracts }] = await Promise.all([
    supabase.schema('marketplace').from('catalogue_price_tiers')
      .select('min_qty, unit_price_ex_vat_cents').eq('catalogue_item_id', item.id),
    supabase.schema('marketplace').from('contract_prices')
      .select('buyer_org_id, unit_price_ex_vat_cents, discount_pct, valid_from, valid_to')
      .eq('catalogue_item_id', item.id).eq('buyer_org_id', buyerOrgId),
  ])
  const resolveItem: ResolvePriceItem = {
    listPriceExVatCents: randToCents(item.unit_price),
    taxClass: (item.tax_class as ResolvePriceItem['taxClass']) ?? 'standard',
    tiers: (tiers ?? []).map((t) => ({ minQty: Number(t.min_qty), unitPriceExVatCents: Number(t.unit_price_ex_vat_cents) })),
    contracts: (contracts ?? []).map((c) => ({
      buyerOrgId: c.buyer_org_id, unitPriceExVatCents: c.unit_price_ex_vat_cents,
      discountPct: c.discount_pct, validFrom: c.valid_from, validTo: c.valid_to,
    })),
  }
  return resolvePrice(resolveItem, buyerOrgId, qty)
}
```

- [ ] **Step 3: Directory facets + pagination**

In `(admin)/marketplace/page.tsx`: delete the local `CATEGORIES` + `CATEGORY_ICONS` and import `MARKETPLACE_CATEGORIES` from `@esite/shared` (icon read from it). Read `category`, `q`, `province`, `page` from `searchParams`; call `supplierService.listAll` with them + `limit=24`, `offset=(page-1)*24`; render category pills (from the shared taxonomy), a province `<select>` (9 SA provinces), a search box, and prev/next pagination. Use `Card/CardHeader/CardBody` for the supplier cards; show the honest verified `Badge` (`success` only when `is_verified`).

- [ ] **Step 4: Storefront buyer-specific pricing + stock**

In `[supplierId]/page.tsx`: for the logged-in buyer org (from `getOrgContext()`), for each visible catalogue item render `resolveCataloguePrice(...qty=item.min_order_qty)` → show the buyer's unit price (with a "contract"/"volume" `Badge` when `contractApplied`/`tierApplied`), `formatZAR` formatted, plus a stock `Badge` from `stockStatus(...)` and the primary media thumbnail. Each item links to the product page and (Task 11) the cart add control.

- [ ] **Step 5: Product page**

Create `[supplierId]/item/[itemId]/page.tsx`: full description/specs, a **media gallery** (all `catalogue_item_media` via `getPublicUrl`, primary first), a **price-breaks table** (list + each tier, buyer-specific contract highlighted), stock status, min-order + lead time, and an **Add to cart** / **Request a quote** control (wired in Tasks 11/13). Gate the page under the existing `(admin)/marketplace` flag layout; buyer role gate via `requireRolePage(MARKETPLACE_BUYER_ROLES)`.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill: confirm the directory only lists suppliers with visible items, province/category/search filter, pagination works, and the storefront/product page shows contract price to the contracted buyer and list/tier to others.
```bash
git add packages/shared/src/services/supplier.service.ts apps/web/src/lib/marketplace apps/web/src/app/\(admin\)/marketplace/page.tsx apps/web/src/app/\(admin\)/marketplace/\[supplierId\]
git commit -m "feat(marketplace): directory facets/pagination + storefront + product page (buyer-specific pricing)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Persistent per-supplier cart

Spec §5.1. One cart per (buyer_org, supplier). Persists across sessions; shows resolved buyer-specific pricing, VAT preview, min-order + stock checks.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00181_marketplace_carts.sql`
- Create: `apps/web/src/actions/cart.actions.ts`
- Create: `apps/web/src/app/(admin)/marketplace/cart/[supplierId]/{page.tsx,CartView.tsx}`
- Modify: product/storefront pages (wire "Add to cart")

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00181_marketplace_carts.sql
CREATE TABLE marketplace.carts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id    UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  supplier_org_id UUID REFERENCES public.organisations(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (buyer_org_id, supplier_id)
);
CREATE TABLE marketplace.cart_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id           UUID NOT NULL REFERENCES marketplace.carts(id) ON DELETE CASCADE,
  catalogue_item_id UUID NOT NULL REFERENCES marketplace.catalogue_items(id) ON DELETE CASCADE,
  quantity          NUMERIC NOT NULL CHECK (quantity > 0),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cart_id, catalogue_item_id)
);
ALTER TABLE marketplace.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts_rw" ON marketplace.carts
  FOR ALL USING (buyer_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (buyer_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "carts_no_client_viewer" ON marketplace.carts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.user_is_client_viewer(buyer_org_id))
  WITH CHECK (NOT public.user_is_client_viewer(buyer_org_id));

CREATE POLICY "cart_items_rw" ON marketplace.cart_items
  FOR ALL USING (
    cart_id IN (SELECT id FROM marketplace.carts WHERE buyer_org_id = ANY(public.get_user_org_ids()))
  ) WITH CHECK (
    cart_id IN (SELECT id FROM marketplace.carts WHERE buyer_org_id = ANY(public.get_user_org_ids()))
  );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write `cart.actions.ts`**

Actions (all gate with `getOrgContext()` → buyer org + `requireRole(supabase, buyerOrgId, MARKETPLACE_BUYER_ROLES)`):
- `addToCartAction({ supplierId, catalogueItemId, quantity })` — upsert the `(buyer_org_id, supplier_id)` cart (`.upsert(..., { onConflict: 'buyer_org_id,supplier_id' })`, stamping `supplier_org_id`), then upsert the `cart_items` row on `(cart_id, catalogue_item_id)` **adding** to any existing qty. Enforce `quantity >= item.min_order_qty` and `wouldOversell(...)` (import from `@esite/shared`) — return a friendly error, do not write. `revalidatePath`.
- `updateCartItemAction(cartItemId, quantity)` / `removeCartItemAction(cartItemId)` / `clearCartAction(supplierId)` — same gate + ownership via the parent cart.

- [ ] **Step 3: Cart UI**

`cart/[supplierId]/page.tsx` (server): resolve buyer org, load the cart + items joined to catalogue items, and for each line call `resolveCataloguePrice(...qty)`; compute per-line ex-VAT, `computeLineVatCents`, and totals; render `CartView` with editable quantities (calls the actions), a **VAT preview** (subtotal ex-VAT, VAT, total incl-VAT via `formatZAR`), min-order + stock warnings, and a "Proceed to checkout" button → `cart/[supplierId]/checkout`. Use `Card/CardHeader/CardBody`. Wire "Add to cart" on the product + storefront pages to `addToCartAction`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill: add 2 items, change a qty, see VAT preview recompute, hit a min-order block and an oversell block; confirm the cart persists across a reload.
```bash
git add apps/edge-functions/supabase/migrations/00181_marketplace_carts.sql apps/web/src/actions/cart.actions.ts apps/web/src/app/\(admin\)/marketplace/cart
git commit -m "feat(marketplace): persistent per-supplier cart (pricing + VAT preview + min-order/stock checks)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Unified server-action checkout + order-status model

Spec §5.2/§5.4. Replace the dual order-creation paths (`OrderButton` client-insert + `placeOrderAction`) with ONE role-gated server-action checkout that snapshots pricing/VAT, creates a `marketplace.orders` row at the correct non-payment status, and enforces server-side status transitions.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00182_marketplace_orders_ecommerce.sql`
- Create: `packages/shared/src/marketplace/order-status.ts`
- Test: `packages/shared/src/__tests__/marketplace/order-status.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `apps/web/src/actions/supplier.actions.ts` (add `checkoutCartAction`; harden `updateOrderStatusAction`; retire the `OrderButton`/`placeOrderAction` client path)
- Delete/deprecate: `apps/web/src/app/(admin)/marketplace/[supplierId]/OrderButton.tsx`

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00182_marketplace_orders_ecommerce.sql
-- Extend orders/order_items toward the unified e-commerce model. Phase 1 uses the
-- non-payment states only; pay_now/paid/refunded wiring lands in Phase 2.

ALTER TABLE marketplace.orders
  ADD COLUMN order_type          TEXT NOT NULL DEFAULT 'checkout' CHECK (order_type IN ('checkout', 'rfq')),
  ADD COLUMN payment_mode        TEXT NOT NULL DEFAULT 'on_account' CHECK (payment_mode IN ('pay_now', 'on_account')),
  ADD COLUMN fulfilment_method   TEXT CHECK (fulfilment_method IN ('delivery', 'collection')),
  ADD COLUMN subtotal_ex_vat_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN vat_amount_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN total_incl_vat_cents  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN accepted_at         TIMESTAMPTZ;

-- Widen the status CHECK to the unified model (superset of the legacy values so
-- existing rows stay valid). Payment states are reserved for Phase 2.
ALTER TABLE marketplace.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE marketplace.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'draft', 'pending_payment', 'paid', 'submitted', 'accepted', 'preparing',
  'dispatched', 'delivered', 'completed', 'cancelled', 'refunded',
  'partially_refunded', 'disputed',
  -- legacy values retained so historical rows remain valid:
  'confirmed', 'in_transit', 'invoiced'
));

ALTER TABLE marketplace.order_items
  ADD COLUMN unit_price_ex_vat_cents BIGINT,
  ADD COLUMN line_vat_cents          BIGINT,
  ADD COLUMN tax_class               TEXT DEFAULT 'standard',
  ADD COLUMN tier_applied            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN contract_applied        BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
```
*(RLS DELETE-deny + client_viewer exclusion on `orders` were added by Phase 0 migration `00174`; this migration only extends columns/constraints.)*

- [ ] **Step 2: Write the failing transition test**

```ts
// packages/shared/src/__tests__/marketplace/order-status.test.ts
import { describe, it, expect } from 'vitest'
import { canTransition, MARKETPLACE_ORDER_STATUSES } from '../../marketplace/order-status'

describe('order status transitions', () => {
  it('allows the happy on-account path', () => {
    expect(canTransition('submitted', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'preparing')).toBe(true)
    expect(canTransition('preparing', 'dispatched')).toBe(true)
    expect(canTransition('dispatched', 'delivered')).toBe(true)
    expect(canTransition('delivered', 'completed')).toBe(true)
  })
  it('allows cancel before dispatch, not after', () => {
    expect(canTransition('accepted', 'cancelled')).toBe(true)
    expect(canTransition('dispatched', 'cancelled')).toBe(false)
  })
  it('rejects skips and reversals', () => {
    expect(canTransition('submitted', 'dispatched')).toBe(false)
    expect(canTransition('delivered', 'preparing')).toBe(false)
  })
  it('exposes the full status vocabulary', () => {
    expect(MARKETPLACE_ORDER_STATUSES).toContain('completed')
    expect(MARKETPLACE_ORDER_STATUSES).toContain('pending_payment')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- order-status`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the transition machine**

```ts
// packages/shared/src/marketplace/order-status.ts
export const MARKETPLACE_ORDER_STATUSES = [
  'draft', 'pending_payment', 'paid', 'submitted', 'accepted', 'preparing',
  'dispatched', 'delivered', 'completed', 'cancelled', 'refunded',
  'partially_refunded', 'disputed',
] as const
export type MarketplaceOrderStatus = (typeof MARKETPLACE_ORDER_STATUSES)[number]

// Phase 1 wires the non-payment path; pay_now edges (pending_payment→paid→accepted)
// and refund/dispute edges are reserved for Phase 2.
const TRANSITIONS: Record<MarketplaceOrderStatus, MarketplaceOrderStatus[]> = {
  draft: ['pending_payment', 'submitted', 'cancelled'],
  pending_payment: ['paid', 'cancelled'],
  paid: ['accepted', 'cancelled', 'refunded'],
  submitted: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['dispatched', 'cancelled'],
  dispatched: ['delivered'],
  delivered: ['completed', 'disputed'],
  completed: ['disputed'],
  cancelled: [],
  refunded: [],
  partially_refunded: [],
  disputed: ['refunded', 'partially_refunded', 'completed'],
}

export function canTransition(from: MarketplaceOrderStatus, to: MarketplaceOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}
```
Add `export * from './marketplace/order-status'` to `packages/shared/src/index.ts`. Run `pnpm --filter @esite/shared test -- order-status` → PASS (4 tests).

- [ ] **Step 5: Write `checkoutCartAction`**

In `supplier.actions.ts`:
```ts
export async function checkoutCartAction(input: {
  supplierId: string
  fulfilmentMethod: 'delivery' | 'collection'
  notes?: string
  projectId?: string
}): Promise<{ error?: string; orderId?: string }> {
  const parsed = z.object({
    supplierId: z.string().uuid(),
    fulfilmentMethod: z.enum(['delivery', 'collection']),
    notes: z.string().max(2000).optional(),
    projectId: z.string().uuid().optional(),
  }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid checkout.' }

  const supabase = await createClient()
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'Not authenticated.' }
  const guard = await requireRole(supabase, ctx.organisationId, MARKETPLACE_BUYER_ROLES)
  if (!guard.ok) return { error: 'Not authorised to place orders.' }

  // Load cart + items
  const { data: cart } = await supabase.schema('marketplace').from('carts')
    .select('id, supplier_id, supplier_org_id').eq('buyer_org_id', ctx.organisationId)
    .eq('supplier_id', parsed.data.supplierId).maybeSingle()
  if (!cart) return { error: 'Cart is empty.' }
  const { data: items } = await supabase.schema('marketplace').from('cart_items')
    .select('catalogue_item_id, quantity').eq('cart_id', cart.id)
  if (!items?.length) return { error: 'Cart is empty.' }

  // Snapshot pricing + VAT per line; oversell + min-order guard.
  let subtotal = 0, vat = 0
  const lineRows: Record<string, unknown>[] = []
  for (const ci of items) {
    const { data: item } = await supabase.schema('marketplace').from('catalogue_items')
      .select('id, name, unit, unit_price, tax_class, min_order_qty, track_inventory, stock_on_hand, backorder_allowed')
      .eq('id', ci.catalogue_item_id).single()
    if (!item) return { error: 'A cart item no longer exists.' }
    const qty = Number(ci.quantity)
    if (qty < Number(item.min_order_qty)) return { error: `${item.name}: below minimum order qty.` }
    if (wouldOversell({ trackInventory: item.track_inventory, stockOnHand: Number(item.stock_on_hand), backorderAllowed: item.backorder_allowed, lowStockThreshold: 0 }, qty))
      return { error: `${item.name}: insufficient stock.` }
    const resolved = await resolveCataloguePrice(supabase, item, ctx.organisationId, qty)
    const lineEx = resolved.unitPriceExVatCents * qty
    const lineVat = computeLineVatCents(lineEx, resolved.taxClass)
    subtotal += lineEx; vat += lineVat
    lineRows.push({
      catalogue_item_id: item.id, description: item.name, quantity: qty, unit: item.unit,
      unit_price: centsToRand(resolved.unitPriceExVatCents), unit_price_ex_vat_cents: resolved.unitPriceExVatCents,
      line_vat_cents: lineVat, tax_class: resolved.taxClass,
      tier_applied: resolved.tierApplied != null, contract_applied: resolved.contractApplied,
    })
  }
  const total = subtotal + vat

  // Auto-accept? (supplier_settings)
  const { data: settings } = await supabase.schema('marketplace').from('supplier_settings')
    .select('auto_accept_orders').eq('supplier_id', parsed.data.supplierId).maybeSingle()
  const status = settings?.auto_accept_orders ? 'accepted' : 'submitted'

  // Create order (payment_mode on_account — pay_now deferred to Phase 2).
  const { data: order, error: orderErr } = await supabase.schema('marketplace').from('orders').insert({
    contractor_org_id: ctx.organisationId, supplier_org_id: cart.supplier_org_id, supplier_id: cart.supplier_id,
    project_id: parsed.data.projectId ?? null, order_type: 'checkout', payment_mode: 'on_account',
    fulfilment_method: parsed.data.fulfilmentMethod, status, notes: parsed.data.notes ?? null,
    subtotal_ex_vat_cents: subtotal, vat_amount_cents: vat, total_incl_vat_cents: total,
    total_amount: centsToRand(total), commission_rate: 0.05, commission_amount: centsToRand(Math.round(subtotal * 0.05)),
    created_by: ctx.userId, accepted_at: status === 'accepted' ? new Date().toISOString() : null,
  }).select('id').single()
  if (orderErr || !order) return { error: orderErr?.message ?? 'Could not create order.' }

  await supabase.schema('marketplace').from('order_items').insert(lineRows.map((r) => ({ ...r, order_id: order.id })))
  // Decrement stock for tracked items when auto-accepted (accept-time rule).
  if (status === 'accepted') await decrementStockForOrder(supabase, lineRows)
  // Clear the cart.
  await supabase.schema('marketplace').from('carts').delete().eq('id', cart.id)

  await notifySupplierNewOrder(supabase, order.id, cart.supplier_org_id) // in-app now; email in Task 14
  revalidatePath('/marketplace/orders')
  return { orderId: order.id }
}
```
Add the small internal helpers `decrementStockForOrder` (only for `track_inventory` items: `stock_on_hand = stock_on_hand - qty`) and `notifySupplierNewOrder` (uses `dispatchNotification` from `@/lib/notifications` to the supplier org's members). Import `centsToRand`, `computeLineVatCents`, `wouldOversell`, `MARKETPLACE_BUYER_ROLES` from `@esite/shared` and `resolveCataloguePrice` from `@/lib/marketplace/resolve-catalogue-price`. **Decrement rule (documented):** on-account orders decrement at **accept**; pay-now orders will decrement at **paid** in Phase 2 (not wired here).

- [ ] **Step 6: Harden `updateOrderStatusAction` + retire the client path**

Rewrite `updateOrderStatusAction(orderId, status, extras?)`: gate with `requireRole` — supplier-driven transitions (`submitted→accepted→preparing→dispatched`) require the caller's active org to be the order's `supplier_org_id` with `SUPPLIER_STAFF_ROLES`; the buyer-driven `dispatched→delivered` (confirm delivery) and `delivered→completed` require the `contractor_org_id` with `MARKETPLACE_BUYER_ROLES`. Load the order, `if (!canTransition(order.status, status)) return { error: 'Invalid status change.' }`, update, decrement stock if entering `accepted` from `submitted`, and fire the relevant notification/email. **Delete `OrderButton.tsx`** and the client-insert path; point every "order" affordance on the storefront/product pages at the cart→checkout flow. Remove the now-unused `placeOrderAction` (or leave it but route the UI exclusively through `checkoutCartAction`); if removed, delete `(admin)/marketplace/order/new/*`.

- [ ] **Step 7: Write a route-gate integration test**

Add a web test (mirror the tenant/cable gate tests referenced in memory `e2e-test-cookie-gated-routes`) asserting `checkoutCartAction` rejects a `client_viewer`/`inspector` caller and allows an `owner`/`contractor`; and that `updateOrderStatusAction` rejects an invalid transition (`submitted→dispatched`).
Run: `pnpm --filter web test -- checkout` → PASS.

- [ ] **Step 8: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill: checkout a 2-line cart, confirm one order at `submitted` (or `accepted` with auto-accept + stock decremented), the cart cleared, and the supplier sees an in-app notification.
```bash
git add apps/edge-functions/supabase/migrations/00182_marketplace_orders_ecommerce.sql packages/shared/src/marketplace/order-status.ts packages/shared/src/__tests__/marketplace/order-status.test.ts packages/shared/src/index.ts apps/web/src/actions/supplier.actions.ts apps/web/src/app/\(admin\)/marketplace
git commit -m "feat(marketplace): unified checkout server action + order-status model + gates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: RFQ → quote → accept flow

Spec §5.3. Buyer requests a quote → supplier quotes → buyer accepts → converts to an order. Reuses the pricing snapshot + VAT + commission logic.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00183_marketplace_rfqs.sql`
- Create: `apps/web/src/actions/rfq.actions.ts`
- Create buyer UI: `apps/web/src/app/(admin)/marketplace/rfqs/{page.tsx,new/…,[rfqId]/page.tsx}`
- Create supplier UI: `apps/web/src/app/(marketplace)/supplier/rfqs/{page.tsx,[rfqId]/QuoteForm.tsx}`

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00183_marketplace_rfqs.sql
CREATE TABLE marketplace.rfqs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id    UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  supplier_org_id UUID REFERENCES public.organisations(id),
  project_id      UUID REFERENCES projects.projects(id),
  status          TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'quoted', 'accepted', 'declined', 'expired', 'cancelled')),
  message         TEXT,
  created_by      UUID NOT NULL REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE marketplace.rfq_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id            UUID NOT NULL REFERENCES marketplace.rfqs(id) ON DELETE CASCADE,
  catalogue_item_id UUID REFERENCES marketplace.catalogue_items(id) ON DELETE SET NULL, -- null = free-text
  description       TEXT NOT NULL,
  quantity          NUMERIC NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL DEFAULT 'each',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE marketplace.quotes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id                 UUID NOT NULL REFERENCES marketplace.rfqs(id) ON DELETE CASCADE,
  supplier_id            UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  supplier_org_id        UUID REFERENCES public.organisations(id),
  status                 TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  valid_until            DATE,
  lead_time_days         INTEGER,
  delivery_note          TEXT,
  subtotal_ex_vat_cents  BIGINT NOT NULL DEFAULT 0,
  vat_amount_cents       BIGINT NOT NULL DEFAULT 0,
  total_incl_vat_cents   BIGINT NOT NULL DEFAULT 0,
  created_by             UUID NOT NULL REFERENCES public.profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE marketplace.quote_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                UUID NOT NULL REFERENCES marketplace.quotes(id) ON DELETE CASCADE,
  rfq_item_id             UUID REFERENCES marketplace.rfq_items(id) ON DELETE SET NULL,
  description             TEXT NOT NULL,
  quantity                NUMERIC NOT NULL CHECK (quantity > 0),
  unit                    TEXT NOT NULL DEFAULT 'each',
  unit_price_ex_vat_cents BIGINT NOT NULL CHECK (unit_price_ex_vat_cents >= 0),
  tax_class               TEXT NOT NULL DEFAULT 'standard' CHECK (tax_class IN ('standard', 'zero_rated', 'exempt'))
);

ALTER TABLE marketplace.rfqs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.rfq_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.quotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace.quote_items ENABLE ROW LEVEL SECURITY;

-- rfqs: both parties read; buyer creates; both may update (status).
CREATE POLICY "rfqs_select" ON marketplace.rfqs FOR SELECT USING (
  buyer_org_id = ANY(public.get_user_org_ids()) OR supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "rfqs_insert" ON marketplace.rfqs FOR INSERT WITH CHECK (buyer_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "rfqs_update" ON marketplace.rfqs FOR UPDATE USING (
  buyer_org_id = ANY(public.get_user_org_ids()) OR supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "rfqs_no_client_viewer" ON marketplace.rfqs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.user_is_client_viewer(buyer_org_id));

CREATE POLICY "rfq_items_rw" ON marketplace.rfq_items FOR ALL USING (
  rfq_id IN (SELECT id FROM marketplace.rfqs WHERE buyer_org_id = ANY(public.get_user_org_ids()) OR supplier_org_id = ANY(public.get_user_org_ids()))
) WITH CHECK (
  rfq_id IN (SELECT id FROM marketplace.rfqs WHERE buyer_org_id = ANY(public.get_user_org_ids())));

CREATE POLICY "quotes_select" ON marketplace.quotes FOR SELECT USING (
  supplier_org_id = ANY(public.get_user_org_ids())
  OR rfq_id IN (SELECT id FROM marketplace.rfqs WHERE buyer_org_id = ANY(public.get_user_org_ids())));
CREATE POLICY "quotes_write" ON marketplace.quotes FOR ALL
  USING (supplier_org_id = ANY(public.get_user_org_ids()))
  WITH CHECK (supplier_org_id = ANY(public.get_user_org_ids()));
CREATE POLICY "quote_items_rw" ON marketplace.quote_items FOR ALL USING (
  quote_id IN (SELECT id FROM marketplace.quotes WHERE supplier_org_id = ANY(public.get_user_org_ids())
    OR rfq_id IN (SELECT id FROM marketplace.rfqs WHERE buyer_org_id = ANY(public.get_user_org_ids())))
) WITH CHECK (
  quote_id IN (SELECT id FROM marketplace.quotes WHERE supplier_org_id = ANY(public.get_user_org_ids())));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write `rfq.actions.ts`**

Three actions:
- `createRfqAction({ supplierId, projectId?, message?, items: { catalogueItemId?, description, quantity, unit }[] })` — gate `getOrgContext()` + `requireRole(MARKETPLACE_BUYER_ROLES)`; insert `rfqs` (status `requested`, `supplier_org_id` resolved from the supplier row) + `rfq_items`; notify the supplier (in-app now, email Task 14). Return `{ rfqId }`.
- `submitQuoteAction({ rfqId, validUntil?, leadTimeDays?, deliveryNote?, lines: { rfqItemId?, description, quantity, unit, unitPriceRand, taxClass }[] })` — gate supplier context + `SUPPLIER_STAFF_ROLES` + verify the RFQ's `supplier_org_id` is the caller's org; compute `subtotal_ex_vat_cents = Σ round(randToCents(unitPriceRand) * quantity)` and `vat_amount_cents = Σ computeLineVatCents(lineEx, taxClass)`; insert `quotes` (status `sent`) + `quote_items`; set the RFQ `status = 'quoted'`; notify the buyer. Return `{ quoteId }`.
- `acceptQuoteAction(quoteId)` — gate buyer context + `MARKETPLACE_BUYER_ROLES` + verify the quote's RFQ `buyer_org_id` is the caller's org; **convert to an order**: insert `marketplace.orders` (`order_type='rfq'`, `payment_mode='on_account'`, status per supplier `auto_accept_orders` else `accepted` — an accepted quote is a firm order, so default `accepted`; snapshot `subtotal/vat/total` from the quote) + `order_items` from `quote_items` (with `unit_price_ex_vat_cents`, `line_vat_cents`, `tax_class`); decrement stock for tracked catalogue-linked lines; set `quotes.status='accepted'` + `rfqs.status='accepted'`; notify the supplier. Return `{ orderId }`.

- [ ] **Step 3: RFQ UI (buyer + supplier)**

Buyer: `(admin)/marketplace/rfqs/page.tsx` (list of the buyer's RFQs + statuses), a "Request a quote" entry from the product/cart pages that opens `rfqs/new` (pre-filled from cart or free-form lines) calling `createRfqAction`, and `rfqs/[rfqId]/page.tsx` showing the received quote with an **Accept** button (`acceptQuoteAction`). Supplier: `(marketplace)/supplier/rfqs/page.tsx` (inbound RFQs) + `[rfqId]/QuoteForm.tsx` (per-line price entry) calling `submitQuoteAction`. Gate the supplier pages with `SUPPLIER_STAFF_ROLES`, the buyer pages with `MARKETPLACE_BUYER_ROLES`. Use `Card/CardHeader/CardBody` + `Badge` for statuses.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill: buyer raises an RFQ → supplier quotes → buyer accepts → confirm an order row (`order_type='rfq'`) with the snapshotted totals and the RFQ/quote marked `accepted`.
```bash
git add apps/edge-functions/supabase/migrations/00183_marketplace_rfqs.sql apps/web/src/actions/rfq.actions.ts apps/web/src/app/\(admin\)/marketplace/rfqs apps/web/src/app/\(marketplace\)/supplier/rfqs
git commit -m "feat(marketplace): RFQ -> quote -> accept flow (converts to order)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Marketplace transactional emails (order + RFQ events)

Spec §10 — the emails this phase's flows need: **new order received** + **new RFQ received** → supplier; **order accepted** + **quote ready** → buyer. In-app/push already fire (Tasks 12/13); this adds the email channel via the existing Resend `send-email` edge fn.

**Files:**
- Create: `packages/shared/src/email/marketplace-email.ts` (pure `render*` builders)
- Test: `packages/shared/src/__tests__/email/marketplace-email.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (add a `marketplace-email` pass-through type)
- Create: `apps/web/src/lib/marketplace-email.ts` (web wrappers → edge fn)
- Modify: `apps/web/src/actions/{supplier,rfq}.actions.ts` (fire emails alongside the in-app notifications)

- [ ] **Step 1: Write the failing renderer test**

```ts
// packages/shared/src/__tests__/email/marketplace-email.test.ts
import { describe, it, expect } from 'vitest'
import {
  renderNewOrderEmail, renderRfqReceivedEmail, renderQuoteReadyEmail, renderOrderAcceptedEmail,
} from '../../email/marketplace-email'

describe('marketplace emails', () => {
  it('new-order email names the buyer + total and links the order', () => {
    const e = renderNewOrderEmail({ supplierName: 'Acme', buyerName: 'BuildCo', orderRef: 'ORD-1', totalInclVatCents: 115000, orderUrl: 'https://x/y' })
    expect(e.subject).toMatch(/new order/i)
    expect(e.html).toContain('BuildCo')
    expect(e.html).toContain('R 1 150.00'.slice(0, 2)) // contains a rand-formatted total
    expect(e.html).toContain('https://x/y')
  })
  it('quote-ready email is addressed to the buyer', () => {
    const e = renderQuoteReadyEmail({ buyerName: 'BuildCo', supplierName: 'Acme', rfqRef: 'RFQ-1', totalInclVatCents: 50000, quoteUrl: 'https://x/q' })
    expect(e.subject).toMatch(/quote/i)
    expect(e.html).toContain('Acme')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- marketplace-email`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderers**

Create `packages/shared/src/email/marketplace-email.ts` mirroring `email/rfi-email.ts` (a shared `baseTemplate(bodyHtml)` card + typed `render*` functions each returning `{ subject: string; html: string }`). Format money with `formatZARFromCents` (Phase 0 money helper). Provide `renderNewOrderEmail`, `renderRfqReceivedEmail`, `renderQuoteReadyEmail`, `renderOrderAcceptedEmail`. Add `export * from './email/marketplace-email'` to `packages/shared/src/index.ts`. Run `pnpm --filter @esite/shared test -- marketplace-email` → PASS.

- [ ] **Step 4: Add the edge-fn pass-through type**

In `apps/edge-functions/supabase/functions/send-email/index.ts`, add a `marketplace-email` case to the type switch that accepts `payload: { to: string | string[]; subject: string; html: string }` and forwards to Resend (single or `/emails/batch`) — identical handling to the existing `rfi-created` pass-through. (Keeps all body composition in `@esite/shared`.)

- [ ] **Step 5: Web wrappers + wire into the actions**

`apps/web/src/lib/marketplace-email.ts`: thin functions (e.g. `sendNewOrderEmail(args)`) that call the shared `render*`, look up recipient emails (`profiles.email` for the target org's members), and `fetch(\`${supabaseUrl}/functions/v1/send-email\`, { headers: { Authorization: \`Bearer ${serviceKey}\` }, body: JSON.stringify({ type: 'marketplace-email', payload: { to, subject, html } }) }).catch(() => {})` (best-effort, never throws — mirror `lib/rfi-email.ts`). In `checkoutCartAction` add `sendNewOrderEmail`; in `updateOrderStatusAction` on `→accepted` add `sendOrderAcceptedEmail`; in `createRfqAction` add `sendRfqReceivedEmail`; in `submitQuoteAction` add `sendQuoteReadyEmail`. Keep the existing `dispatchNotification` in-app/push calls.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill + a throwaway inbox, drive checkout + RFQ and confirm the supplier/buyer emails arrive (and that a send failure does not break the flow).
```bash
git add packages/shared/src/email/marketplace-email.ts packages/shared/src/__tests__/email/marketplace-email.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/functions/send-email/index.ts apps/web/src/lib/marketplace-email.ts apps/web/src/actions/supplier.actions.ts apps/web/src/actions/rfq.actions.ts
git commit -m "feat(marketplace): transactional emails for order + RFQ events

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: RBAC matrix + Phase-1 verification sweep

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Itemise every new route/action in the matrix**

Add rows (with the role groups used) for: pages `(marketplace)/supplier/{settings,catalogue/import,catalogue/[itemId],rfqs,switch}`, `(admin)/marketplace/{[supplierId]/item/[itemId],cart/[supplierId],cart/[supplierId]/checkout,rfqs,rfqs/new,rfqs/[rfqId]}`; API `api/catalogue-import/{parse,commit}`; actions `getSupplierContext`-gated `catalogue-media.actions` (`SUPPLIER_PORTAL_ROLES`), `setPriceTiersAction`/`setContractPriceAction`/`deleteContractPriceAction` (`SUPPLIER_PORTAL_ROLES`), `updateSupplierSettingsAction` (`SUPPLIER_PORTAL_ROLES`), `cart.actions.*` + `checkoutCartAction` (`MARKETPLACE_BUYER_ROLES`), `updateOrderStatusAction` (supplier transitions `SUPPLIER_STAFF_ROLES` / buyer transitions `MARKETPLACE_BUYER_ROLES`), `rfq.actions.*` (`MARKETPLACE_BUYER_ROLES` buyer / `SUPPLIER_STAFF_ROLES` supplier). Note the `NEXT_PUBLIC_PHASE_2_MARKETPLACE` flag footnote and the "pay_now hidden until Phase 2" note.

- [ ] **Step 2: Run the Phase-1 completeness checks (index §3)**

- `pnpm --filter @esite/shared test && pnpm --filter web test` → all green.
- `turbo run type-check lint` → clean.
- **Pages:** every new route renders, is role-gated, matches the design system, and is in `rbac-matrix.md`.
- **Buckets:** `catalogue-media` created via migration with `storage.objects` write RLS + public read; `NOTIFY pgrst` present.
- **RLS:** every new table (`catalogue_item_media`, `catalogue_price_tiers`, `contract_prices`, `supplier_settings`, `carts`, `cart_items`, `rfqs`, `rfq_items`, `quotes`, `quote_items`) has policies mirroring the audited patterns + a client_viewer write block; `orders`/`order_items` alters keep the `00174` DELETE-deny/client_viewer exclusion intact.
- **Money:** grep confirms all new price/tax columns are `*_cents BIGINT` and all new arithmetic goes through the `@esite/shared` money/VAT helpers (no new float rand math).
- **Emails:** the four Phase-1 events (new order, RFQ received, quote ready, order accepted) each have a renderer + test + a wired send.
- **Flows (≥1 integration/verify each):** context switch, catalogue media, tiers, contract pricing, bulk import (per-row errors), pricing resolution, directory/storefront/product, cart, checkout (on-account), RFQ→quote→accept.
- Confirm migrations `00176`–`00183` are sequential, within the assigned `00176`–`00189` range, and each ends with the correct `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 3: Phase gate — review**

Run `superpowers:requesting-code-review` on the branch; run **security-review** (RLS on all 10 new tables + the bucket, ownership checks on every supplier/buyer mutation, no service-role writes trusting client input, transition validation); recommend the user run `/code-review ultra`. Then `superpowers:finishing-a-development-branch`. **Launch decision:** Phase 1 may be flipped on (flag → `true`) as directory+cart+RFQ **without** Paystack; leave the flag off in prod until the user clears it.

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise Phase-1 marketplace routes/actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** T1↔§1.2 (portal context + sub-roles); T2↔§3.2/§5.2 (VAT/tax classes); T3↔§3.4 (`resolvePrice`, precedence, snapshot); T4↔§3.2 (media + `catalogue-media` bucket); T5↔§3.2 (inventory + oversell + decrement rule); T6↔§3.2 (tiered pricing); T7↔§3.2 (contract pricing + precedence); T8↔§2.4 (`supplier_settings`); T9↔§3.3 (bulk import, per-row errors, never drop); T10↔§4 (directory hardening + storefront + product page); T11↔§5.1 (persistent per-supplier cart); T12↔§5.2/§5.4 (unified checkout + status model + gates); T13↔§5.3 (RFQ→quote→accept); T14↔§10 (order/RFQ emails); T15↔§11 (RBAC matrix + security sweep). Table names match spec §9 exactly (`catalogue_item_media`, `catalogue_price_tiers`, `contract_prices`, `supplier_settings`, `carts`/`cart_items`, `rfqs`/`rfq_items`/`quotes`; `catalogue_items`/`orders`/`order_items` altered).
- **Out of scope (correctly deferred):** payments/pay-now, Paystack split, receipts/tax-invoice PDFs (Phase 2); delivery fees/tracking/POD + procurement `node_orders`/`procurement_items` linkage (Phase 3); on-account terms/credit limits/commission statements (Phase 4); admin console + full email matrix (Phase 5). `quote_items` is the line detail of the canon `quotes` subsystem.
- **Canon compliance:** migrations `00176`–`00183` (within `00176`–`00189`), each ends `NOTIFY pgrst`; new bucket via `storage.buckets` insert + `storage.objects` RLS; money in integer cents via the Phase-0 helper (existing `numeric` rand bridged with `randToCents`/`centsToRand`); role gates via `requireRole`/`requireRolePage` with groups from `@esite/shared` (`MARKETPLACE_BUYER_ROLES`, `SUPPLIER_PORTAL_ROLES`, new `SUPPLIER_STAFF_ROLES`); taxonomy from `MARKETPLACE_CATEGORIES`/`isMarketplaceCategory`; `resolvePrice` pure + unit-tested with contract>tier>list precedence; import mirrors the tenant-schedule parse→preview→commit with per-row errors; everything behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE`.
- **Type consistency:** `SUPPLIER_STAFF_ROLES`, `VAT_RATE`/`vatRateForClass`/`computeLineVatCents`, `resolvePrice`/`ResolvePriceItem`/`ResolvedPrice`, `stockStatus`/`wouldOversell`, `canTransition`/`MARKETPLACE_ORDER_STATUSES`, `parseCatalogueImport`/`diffCatalogue`, `getSupplierContext`/`SupplierContext`, `resolveCataloguePrice`, `render*Email` are referenced by the exact names they are defined under.
- **Deliberate verification steps (not placeholders):** "mirror the tenant `ImportFlow`/`structurePost` pattern", "read the sibling gate test", and "match `lib/rfi-email.ts` best-effort send" are real read-first steps, consistent with the Phase-0 style; every shared module + migration + core action carries complete code.
- **Known follow-through:** T10 Step 1 "listed supplier" filter is a two-step service query (a DB view is the noted alternative); T12 retires `OrderButton`/`placeOrderAction` — confirm no other caller before deletion; T14 requires the new `marketplace-email` type deployed with the edge-function bundle (Supabase functions deploy, separate from the migration auto-apply).
