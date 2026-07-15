# E-Site Marketplace — Current-State Investigation

**Date:** 2026-07-13
**Status:** Investigation (facts only — no target design yet)
**Author:** Claude (deep-dive investigation round)
**Commit investigated:** `8de6f9c` on `feat/jbcc-production`
**Scope:** Every layer of the marketplace as it exists today — data model, vendor/supplier journey, buyer/ordering flow, payments/commission, email/notifications, RBAC/identity/gating. Read-only. Nothing changed.

> This document is deliberately **descriptive, not prescriptive**. It records what is built today and where the gaps are. The target design / build spec is a separate document produced after the decisions in §9 are made.

---

## 1. Executive verdict

**The marketplace is fully coded but completely dark.** Both the buyer side (`app/(admin)/marketplace/*`) and the seller portal (`app/(marketplace)/supplier/*`) are hidden behind a single feature flag, `NEXT_PUBLIC_PHASE_2_MARKETPLACE`, which is **off by default and off in production**. When off, every marketplace route renders an `InDevelopmentNotice` placeholder ("Marketplace is launching in Phase 2"). The sidebar shows a "Marketplace" item with an "In Dev" badge.

Functionally, what exists today is a **B2B supplier directory + RFQ / order-tracking workflow with a dormant split-payment engine bolted on**. It is *not* a live e-commerce/payments product. The catalogue, order lifecycle, ratings, Paystack subaccount onboarding, split-payment edge function, commission ledger and payout tracking are all coded, but they are not wired end-to-end and not exposed to users.

**Three system-level facts frame everything below:**

1. **There are THREE unrelated "order"/procurement concepts** that share vocabulary but no schema, FKs, or money flow:
   - `marketplace.orders` — the real supplier marketplace purchase order (this investigation's subject).
   - `structure.node_orders` — a per-project "material order tracker" (status only: `by_tenant/required/ordered/received`; no price, supplier, or money). Heavily used, live.
   - `projects.procurement_items` — a BOM/procurement pipeline with `supplier_id`, quotes, GRNs, and `supplier_invoices` (AP). Separate again.
   None are joined. A key design decision (§9) is whether the marketplace should feed the project-side material tracker or stay standalone.

2. **Two notions of "supplier"** exist and must not be conflated:
   - A marketplace **seller** = a separate `organisations` row with `type='supplier'`, whose registrant becomes its **`owner`**.
   - The **`supplier` OrgRole** = a near-powerless staff role assignable inside an engineering org (read-only SANS + snag field entry only). It is *not* how sellers exist.

3. **The order-payment backend exists but is unwired.** The split-charge initializer and the order/payout webhook are built as Supabase edge functions, but nothing in the web app calls them, and the split code they depend on is never created.

---

## 2. Live-vs-stubbed & gating

| Aspect | State |
|---|---|
| Feature flag | `NEXT_PUBLIC_PHASE_2_MARKETPLACE === 'true'` — off by default, off in prod |
| Buyer routes gate | `(admin)/marketplace/layout.tsx` → renders `InDevelopmentNotice` when off |
| Seller routes gate | `(marketplace)/layout.tsx` → same placeholder when off |
| Dashboard | Marketplace KPI + "Active Marketplace Orders" panel hidden when off |
| Sidebar | "Marketplace" nav item always shown, carries "In Dev" badge when off |
| Payment "Pay now" | **Not wired at all** — the order detail page only *displays* `payment_status`; no button initiates payment |
| Early access | `mailto:hello@e-site.live` link only |

Even with the flag flipped on, the product is incomplete: no payment initiation UI, zero marketplace emails, and several unaudited write paths (see §6, §7).

---

## 3. Data model (current)

### 3.1 `suppliers` schema
- **`suppliers.suppliers`** — seller org profile. Columns: `organisation_id` (NULL = external/off-platform supplier), `name`, `trading_name`, `registration_no`, `vat_number`, `province`, `address`, `website`, `is_verified` (default false), `categories text[]`, `is_active`. RLS: **any authenticated user can read every active supplier** (`USING is_active = TRUE`) — global directory by design. INSERT hardened in `00165` to org owner/admin; UPDATE/DELETE service-role only.
- **`suppliers.organisation_suppliers`** — contractor↔supplier account terms (`account_number`, `credit_limit`, `payment_terms_days`, `is_preferred`). SELECT-only RLS; writes service-role.
- **`suppliers.supplier_contacts`** — `name/role/email/phone/is_primary`. SELECT-only RLS.

### 3.2 `marketplace` schema — catalogue & orders
- **`marketplace.catalogue_items`** — `sku`, `name`, `description`, `category`, `unit` (default 'each'), **`unit_price numeric(10,2)` — single flat price, no tiers**, `currency` (ZAR), `min_order_qty`, `lead_time_days`, `marketplace_visible` (default **false**), `is_active`, `metadata jsonb`. **No image/media columns, no stock/inventory.** RLS: visible to linked contractors when `marketplace_visible AND is_active`; sellers manage own via `supplier_org_id`.
- **`marketplace.orders`** — `contractor_org_id` (buyer), `supplier_org_id` (NULL for external), `supplier_id`, `project_id` (optional), `status` CHECK `('draft','submitted','confirmed','in_transit','delivered','invoiced','cancelled')`, `total_amount`, `paystack_reference` (unique), `paystack_split_code`, `commission_rate`, `commission_amount`, `payment_status` CHECK `('pending','paid','refunded','failed')`, `paid_at`, `notes`, `created_by`. RLS: both parties SELECT; contractor INSERT/UPDATE; **no DELETE policy, no client_viewer exclusion** (predates the `00166` hardening).
- **`marketplace.order_items`** — `catalogue_item_id` (nullable → free-text lines), `description`, `quantity`, `unit`, `unit_price`, `line_total` **GENERATED** `(quantity*unit_price)`. Price snapshot at order time.

### 3.3 `marketplace` schema — payments, commission, ratings
- **`marketplace.paystack_subaccounts`** — one per supplier (`UNIQUE supplier_id`). `subaccount_code`, `split_code` (unique, `SPL_…`), `settlement_bank`, `account_number`, `business_name`, **`percentage_charge numeric(5,2) DEFAULT 6.00`**, `is_verified`. **`split_code` is never populated** (createSplit is not called at onboarding).
- **`marketplace.commission_records`** — per-order money ledger, **amounts in kobo (ZAR×100, bigint)**. `gross_amount_kobo`, `commission_kobo` (E-Site), `supplier_kobo`, `payout_status` CHECK `('pending','processing','paid','failed','refunded')`, `paystack_reference` unique (idempotency). Written only by the edge webhook.
- **`marketplace.commission_payouts`** — aggregate batch payouts. `commission_record_ids uuid[]` (denormalised — **no join table**).
- **`marketplace.supplier_ratings`** — 4 axes (delivery/quality/communication/pricing, 1–5) + comment. Unique `(order_id, rated_by)`. RLS: **world-readable to any authenticated user** (`USING TRUE`).
- **`marketplace.supplier_rating_summary`** — materialized view, refreshed via `rpc('refresh_supplier_rating_summary')` (no auto-trigger).

### 3.4 Adjacent (not marketplace, but relevant to §9 "connect procurement?")
- **`structure.node_orders`** (+ `node_order_documents`, `node_order_shop_drawings`) — project material tracker, status-only, no money. Auto-created per equipment node by a trigger.
- ~~**`projects.procurement_items`** + **`projects.supplier_invoices`** — BOM pipeline with `supplier_id` FK, quotes, GRNs, AP invoices.~~ **⚠ CORRECTION (2026-07-13): these tables were DROPPED by `00087_drop_procurement_module.sql`** (superseded by `structure.node_orders` + `node_order_documents`) and do not exist. This bullet reflected the **stale** `packages/db/src/types.ts`, which still lists them but was never regenerated after `00087`. The deep-integration target (spec §8, Phase 3) is `structure.node_orders`/`node_order_documents`; regenerate `types.ts`. See reconciliation register RR-1.
- **`billing.org_feature_unlocks`** — SaaS one-time module unlocks (Inspections R250, JBCC R1999), gated by `public.has_feature()`.

### 3.5 Unit inconsistency
Orders/catalogue/invoices are in **rand** (`numeric`); commission/payout tables are in **kobo** (`bigint`). Mixed across the domain.

---

## 4. Vendor / supplier journey (current)

1. **Registration** — self-serve, public, **no admin approval**. `RegisterSupplierForm` collects: email, password (≥8), company_name, trading_name?, registration_no (CIPC)?, vat_number?, province (9 SA), address?, categories (≥1 of **electrical/mechanical/civil/safety/general**), POPIA consent (mandatory). `registerSupplierAction` does **4 non-transactional sequential writes**: `auth.signUp` (metadata `role:'supplier'`) → `organisations{type:'supplier'}` → `user_organisations{role:'owner'}` → `suppliers.suppliers{is_verified:false}`. **Risks:** if email confirmation is on, steps 2–4 run without a session and fail RLS → half-created account; no rollback; no de-dup.
2. **Profile** — `SupplierProfileForm` edits name, trading_name, registration_no, vat_number, province, address, **website** (a field not on register), categories. Saved by id with **no ownership check** (RLS-only). Completeness banner: needs reg_no + province + ≥1 category. "Verified" badge reads `is_verified`.
3. **Banking (Paystack)** — `PaystackOnboardingCard` collects business_name, bank_code (9 hardcoded SA banks), account_number (10 digits), contact_email → `POST /api/paystack/subaccount` → Paystack `POST /subaccount` at `percentage_charge: 94` → upserts subaccount row with **`is_verified: true` unconditionally**. **"Verified" = "a subaccount was created", not a real bank check.** No `split_code` created.
4. **Catalogue / costings** — `CatalogueItemForm`: name, sku?, category (7: adds tools/materials — **diverges from register's 5**), description?, **unit_price (single ZAR price)**, unit (9), min_order_qty, lead_time_days, marketplace_visible (default off). **No images, no bulk/CSV import, no cost-vs-markup breakdown, no currency choice, no volume/tier pricing.** Visibility toggle optimistic, id-only update.
5. **Orders (seller view)** — sellers **respond**, they don't create. See non-draft orders for their org. Can set a **quoted amount** (at `submitted`) and advance status: `submitted→confirmed|cancelled`, `confirmed→in_transit|cancelled`, `in_transit→delivered`, `delivered→invoiced`. Transition validity enforced **only by which buttons render** (server action is id-only, no server-side transition check).
6. **Auth** — **no `requireRole` anywhere in the portal.** Access = "any authenticated user whose oldest org membership has a `suppliers` row." Several mutations are id-only (RLS is the sole backstop). The layout doesn't even verify the caller is a supplier.

---

## 5. Buyer / ordering journey (current)

1. **Directory** (`/marketplace`) — grid of **all `is_active` suppliers** (does **not** filter on `is_verified` — "Verified" is a badge only), name search + 5 category pills.
2. **Supplier detail** — profile, aggregate ratings (from the matview), contacts, catalogue grouped by category (items require `is_active AND marketplace_visible`).
3. **Two order-creation paths (design inconsistency):**
   - **`OrderButton`** (inline, actually wired) — client-side direct insert, **single item**, `status:'draft'`, no project link, RLS-only auth.
   - **`PlaceOrderForm`** (`/marketplace/order/new`, standalone route not linked from detail) — full **multi-item cart**, optional project, required_by, delivery_address, notes → `placeOrderAction`, `status:'submitted'`. **delivery_address + required_by are folded into `notes`, not columns.**
4. **Order lifecycle (buyer)** — buyer's only mutation is **Confirm Delivery** (`in_transit→delivered`). `submitted→confirmed→in_transit` are seller-driven. Payment strip only *displays* `payment_status`.
5. **Ratings** — gated to `delivered` orders, one per (order, user); 4 stars + comment.
6. **Access** — `(admin)` shell bounces `client_viewer` to `/portal`; otherwise **any org member** (owner/admin/PM/contractor/inspector/supplier) can reach it. **No `ORG_WRITE_ROLES` gate on order/rating writes** (unlike the audited tenant/cable/node-order routes) — latent, currently masked by the flag.

---

## 6. Payments & commission (current)

- **What's live:** only **platform/SaaS billing** — org subscriptions (`/api/paystack/checkout`), feature unlocks, feature seats, MV subscription. All charge E-Site's own account; no split. Webhook (Next.js route) handles only SaaS events.
- **Order-payment backend (built, unwired):**
  - Edge function **`marketplace-payment`** — initializes a Paystack split charge for an `orderId`, returns `authorizationUrl` + `commissionKobo`/`supplierKobo`. **No caller in `apps/web`.**
  - Edge function **`paystack-webhook`** — `charge.success` (with `metadata.order_id`) → mark order paid + write `commission_records`; `transfer.success/failed` → payout status on `commission_records`/`commission_payouts`. Idempotent on `paystack_reference`.
- **Broken links in the chain:** (a) no "Pay now" UI; (b) `paystack_subaccounts.split_code` is never created, and `orders.paystack_split_code` is never set, so the split has nothing to reference; (c) supplier `is_verified` is faked.
- **Commission rate is contradictory in three places** — code + DB default + onboarding UI say **6%** (`percentage_charge DEFAULT 6.00`, `DEFAULT_COMMISSION_RATE = 0.06`, "E-Site deducts 6%"), while the business decision of record (`SPEC DOCS/paystack/00-master-spec.md` D5/D6) is **5% + `bearer: subaccount`**. The shipped split uses `bearer_type: 'all'`. Unreconciled.
- **Go-live is a business gate, not a code gate:** blocked on Paystack live-mode KYC for **Lenchen Engineering (Pty) Ltd** (CIPC + docs staged; final blocker is Arno sending the KYC response email). Marketplace split settlement is explicitly deferred to a Phase-2 pilot.

---

## 7. Email / notifications & RBAC (current)

- **Emails for the marketplace: none.** Order-placed and status-change fire **in-app bell + Expo push only** (`send-notification` edge fn, called directly server-side). The order/payout webhooks write DB only. Registration triggers only the generic "Confirm your signup" auth email.
- **Missing emails for a functioning marketplace:** buyer order confirmation/receipt, supplier new-order email, payment receipt, payout/settlement notice, payout-failed alert, supplier welcome, KYC/verification-approved (there is **no admin supplier-approval flow at all**), order accepted/quoted/rejected, delivery receipt.
- **Identity/auth gaps:** supplier portal layout gates on flag + any authenticated user (no supplier-identity check); `getOrgContext()` picks the **oldest** membership, so a dual firm+supplier user is a latent routing hazard; no dedicated `(supplier)` route-group isolation.
- **RBAC gaps:** the concrete `supplier.actions.ts` write actions and marketplace pages are **not itemised** in `docs/rbac-matrix.md`; order/rating writes lack `ORG_WRITE_ROLES` gating; `/api/notifications/dispatch` is "not yet audited".

---

## 8. What exists vs what's missing (consolidated)

**Exists & coded:** supplier directory + profile, self-serve registration, flat-price catalogue with visibility, order lifecycle + line items, 4-axis ratings + aggregate, Paystack subaccount onboarding, split-charge edge fn, commission/payout ledger, in-app/push order notifications, SaaS billing.

**Missing / stubbed / weak:**
- No cart/basket persistence; two inconsistent order-creation paths.
- No product images/media; no bulk/CSV catalogue import.
- No pricing tiers / volume breaks / contract (per-buyer) pricing; no discounts/promotions.
- No inventory/stock/availability.
- No real bank verification; `split_code` never created; supplier `is_verified` faked.
- No "Pay now" UI → order payment not wired end-to-end.
- No unified payments/refunds ledger; no order-level VAT/tax; kobo/rand unit split.
- No shipping/fulfilment/delivery model (address folded into notes; `in_transit/delivered` are status flags with no logistics data).
- Zero marketplace emails; no supplier-approval/KYC workflow.
- Commission rate contradictory (6% code vs 5% decision); `bearer` mismatch.
- Missing role gates on marketplace writes; RLS oddities (world-readable suppliers & ratings; orders lack DELETE policy + client_viewer exclusion); id-only mutations rely solely on RLS.
- Three disjoint procurement models, unconnected.

---

## 9. Key decisions to firm up (feeds the target spec)

These are product/business forks that determine the target design. They are **not yet answered** — they are the agenda for the design conversation.

1. **Ambition of this round** — refine & launch the existing Phase-2 design roughly as-is (close gaps, go live) vs expand toward a fuller e-commerce marketplace (cart, images, tiers, inventory, fulfilment) vs document + gap-analysis only.
2. **Transaction model** — true payments marketplace (buyer pays through platform, Paystack split, E-Site commission) vs RFQ/directory + offline settlement vs hybrid (RFQ now, payments later).
3. **Supplier acquisition & vetting** — self-serve public signup (as coded) vs admin-vetted/invite-only vs both; and whether there is an explicit verification/KYC approval step (with email).
4. **Relationship to internal procurement** — should a marketplace order feed `structure.node_orders` / `projects.procurement_items`, or stay standalone?
5. **Commission** — reconcile to one number (5% vs 6%) and one fee-bearer (`subaccount` vs `all`).
6. **Catalogue richness** — flat price only vs images + tiers/volume + per-buyer contract pricing + bulk import.
7. **Buyer scope** — buyers are only engineering-firm staff (contractors), or also others?
8. **Email/notification set** — the definitive list of transactional emails to build.
9. **Security/RBAC hardening** — role gates, RLS hardening, supplier-portal isolation, dual-membership routing — as launch blockers.

---

## Appendix — key file map

| Concern | Path |
|---|---|
| Feature flag / placeholder | `apps/web/src/components/marketplace/InDevelopmentNotice.tsx` |
| Seller portal | `apps/web/src/app/(marketplace)/…` (register, supplier/profile, supplier/catalogue, supplier/orders) |
| Buyer marketplace | `apps/web/src/app/(admin)/marketplace/…` (directory, `[supplierId]`, order/new, orders, rate) |
| Server actions | `apps/web/src/actions/supplier.actions.ts`, `apps/web/src/actions/rating.actions.ts` |
| Shared service | `packages/shared/src/services/supplier.service.ts` |
| Paystack client | `packages/db/src/services/payment.service.ts` (split/commission/transfer methods **unused**) |
| Paystack routes (SaaS) | `apps/web/src/app/api/paystack/{checkout,callback,webhook,feature-unlock,feature-seat,mv-subscribe,subaccount}/route.ts` |
| Order-payment edge fns | `apps/edge-functions/supabase/functions/{marketplace-payment,paystack-webhook}/index.ts` |
| Migrations | `00005` suppliers, `00016` commission/paystack, `00021` ratings, `00096` subaccount unique, `00165` supplier INSERT authz, `00166` client_viewer node-order block |
| Go-live / KYC | `docs/paystack-go-live-roadmap.md`, `SPEC DOCS/paystack/00-master-spec.md`, `01-kyc-response-pack.md` |
