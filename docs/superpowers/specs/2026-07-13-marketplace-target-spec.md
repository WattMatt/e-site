# E-Site Marketplace — Target Design Spec (Full E-Commerce)

**Date:** 2026-07-13
**Status:** DESIGN SPEC — for review. No code, migrations, or implementation this round.
**Companion:** [`2026-07-13-marketplace-investigation.md`](./2026-07-13-marketplace-investigation.md) (current-state facts)
**Author:** Claude (brainstorming → spec)

> **Purpose.** Firm up *what we will build* to turn today's dark, RFQ-only marketplace into a full B2B e-commerce marketplace with in-platform payments, commission, fulfilment, tax invoicing, and deep integration into E-Site's project procurement. This document is the single source of truth for scope; the implementation plan (tasks, migrations, TDD) is a **separate** later deliverable.

---

## 0. Decision register (locked this round)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Ambition | Full e-commerce expansion | Cart, images, tiers, contract pricing, inventory, fulfilment, tax, payments, deep integration |
| 2 | Transaction model | Payments marketplace | Buyer pays through platform; Paystack split; E-Site commission |
| 3 | Supplier vetting | Self-serve, instantly live | No admin gate to list; trust handled by ratings + dispute + optional badges |
| 4 | Procurement | Deep integration | Marketplace order advances `node_orders` / creates `procurement_items`; **project = source of truth** |
| 5 | Payment timing | Both (supplier-configurable) | Two buyer flows: **pay-now** (Paystack) and **on-account/terms** (invoice) |
| 6 | Cart scope | One order per supplier | Cart keyed by supplier; multi-supplier basket = multiple orders |
| 7 | Catalogue | Images + tiered/volume + per-buyer contract pricing + inventory | New pricing + media + stock subsystems |
| 8 | Settlement | Immediate Paystack split | Supplier subaccount settles on Paystack cycle (~T+1/2); no escrow (v1) |
| 9 | Fulfilment | Delivery + collection, fee per order, basic tracking | Delivery fee line + dispatch/delivered states; no carrier integration |
| 10 | VAT/tax | Ex-VAT prices, VAT @ checkout, platform-issued tax invoice | Supplier = seller-of-record; E-Site issues its own commission tax invoice |
| 11 | Order model | Both — cart checkout + RFQ | Storefront checkout + quote-then-accept path |
| 12 | Commission | 5% + `bearer: subaccount` | Reconcile 6%/`all` in code; supplier absorbs Paystack fee |

**Assumptions to confirm (not blocking the spec):**
- **A1. Buyers** are existing on-platform engineering/contractor organisations (any org member above `client_viewer`, subject to a new marketplace role gate). No public/consumer buyers.
- **A2. Currency** is ZAR only.
- **A3. Legal seller-of-record** on each sale is the supplier; E-Site is a marketplace facilitator (affects invoicing + Paystack KYC framing — already the model in `SPEC DOCS/paystack`).
- **A4. Refunds/disputes** exist in v1 as a manual admin-mediated flow (full/partial refund via Paystack) — not automated escrow.

---

## 1. Actors, roles & identity

### 1.1 Actors
- **Supplier org** (`organisations.type='supplier'`) — sells. Members: **Supplier Owner/Admin** (manage profile, banking, catalogue, pricing, fulfilment, payouts) and optionally **Supplier Staff** (process orders only).
- **Buyer org** (existing engineering/contractor org) — buys. Members act per a new marketplace permission set.
- **E-Site platform admin** — oversight: supplier moderation, disputes/refunds, commission config, payout reconciliation, tax-invoice oversight.
- **Guest/visitor** — may reach the public supplier registration + a public storefront landing (read-only), but must authenticate to buy.

### 1.2 Identity decisions (fix current gaps)
- **Dedicated supplier context.** Introduce a first-class supplier portal context so a supplier's session resolves to their supplier org deterministically (fix `getOrgContext()` "oldest membership" hazard for dual firm+supplier users). A user may hold both a buyer-org and a supplier-org membership; the UI must let them switch context explicitly.
- **Supplier sub-roles.** Add `supplier_admin` vs `supplier_staff` distinction within the supplier org (either as OrgRoles scoped to supplier-type orgs, or a supplier-portal capability flag). Owner = admin by default.
- **Registration hardening.** Make `registerSupplierAction` **transactional/idempotent** (all-or-nothing across auth user + org + membership + supplier row; handle the email-confirmation/no-session case; dedupe on email/CIPC). See §2.1.
- **Buyer gate.** Marketplace buyer actions gate on a defined role set (see §11), not just "authenticated + any membership".

---

## 2. Module A — Supplier onboarding & identity

### 2.1 Registration (self-serve, instantly live)
**Flow:** public `/register` → create account → land in supplier portal with a guided setup checklist. Supplier can list catalogue items immediately (decision #3) but **cannot receive payments** until banking is linked.

**Fields** (superset of today; reconcile register vs profile divergence): email, password, company_name, trading_name?, CIPC registration_no?, VAT number?, province (9 SA), address?, **contact person (name/email/phone)**, **categories** (single canonical taxonomy — see §3.1), POPIA consent.

**Hardening requirements:**
- Transactional creation with rollback + cleanup of the auth user on failure.
- Email-confirmation aware: if `signUp` yields no session, defer org/supplier creation to first authenticated load (or use a service-role completion step keyed to the confirmed user).
- Duplicate guard on email + CIPC reg no.
- Fire a **branded "Welcome / next steps" email** (not just the generic auth confirm) — see §10.

**Setup checklist (portal home):** ① Complete profile ② Link bank account (Paystack) ③ Add first catalogue item ④ Set fulfilment options ⑤ Set payment terms policy. "Ready to sell" badge when ①–④ done.

### 2.2 Profile
Editable: identity fields above, website, logo (new), short description (new), service areas/provinces served (new), categories. Server actions must enforce **org ownership** (not id-only + RLS-only).

### 2.3 Banking & Paystack subaccount (fix the faked verification)
- Collect business_name, bank, account_number, contact_email → create Paystack subaccount **with `percentage_charge` = commission (5%)** and **`bearer: subaccount`**.
- **Create the transaction split (`split_code`) at onboarding** and persist it on `paystack_subaccounts.split_code` (today it is never created → the whole split path is dead).
- **Real verification state:** `is_verified` must reflect an actual signal (Paystack account resolve/bank-name match, or admin confirmation), not be hardcoded true. Introduce states: `unlinked → linked → verified`. Payments can be enabled at `linked` but flag `verified` only on a real check.
- Role: **owner/admin of the supplier org only** (today any member can).

### 2.4 Supplier settings (new)
Per-supplier configuration surface: **payment modes offered** (pay-now / on-account / both — decision #5), **default terms** (credit terms days, per-buyer credit limits via `organisation_suppliers`), **fulfilment options** (delivery/collection, delivery fee rules, service areas), **lead-time defaults**, **return/refund policy text**, **auto-accept vs manual-accept orders**.

---

## 3. Module B — Catalogue & costing

### 3.1 Canonical category taxonomy
Resolve the 5-vs-7 divergence. Define one taxonomy (e.g. electrical, mechanical, civil, safety, tools, materials, general) used by register, profile, catalogue, and buyer filters. Consider a two-level taxonomy (category → subcategory) for discovery.

### 3.2 Catalogue item (extended)
Existing: sku, name, description, category, unit, min_order_qty, lead_time_days, marketplace_visible, is_active. **Add:**
- **Media** (decision #7): 1..N images/spec-sheets per item → new `catalogue_item_media` table + a `catalogue-media` storage bucket (public-read for listed items; RLS write = owning supplier). Client-side compression (reuse the existing `compressImage` pattern). Primary image + gallery.
- **Pricing model** (decision #7):
  - **List price** (ex-VAT) — base.
  - **Tiered/volume pricing** → new `catalogue_price_tiers` (item_id, min_qty, unit_price). Resolve applicable tier by ordered qty.
  - **Per-buyer contract pricing** → new `contract_prices` (supplier_id, buyer_org_id, item_id OR category, unit_price or % discount, valid_from/to). Precedence: contract price > tier price > list price.
- **Inventory** (decision #7): `stock_on_hand`, `track_inventory` (bool), `backorder_allowed` (bool), `restock_lead_days`. Decrement on **paid** order (pay-now) or on **accepted** order (terms); guard against oversell; surface "In stock / Low / Backorder / Out of stock".
- **Tax:** `tax_class` (standard 15% / zero-rated / exempt) for correct VAT at checkout.

### 3.3 Bulk import (new, recommended)
CSV/XLSX catalogue import + template (mirror the tenant-schedule import pattern: parse → diff/preview → commit, with per-row error reporting; do **not** silently drop rows). Optional but high-value for suppliers with large ranges.

### 3.4 Pricing resolution service (new, shared)
A single pure function `resolvePrice(item, buyerOrg, qty) → { unitPriceExVat, tierApplied, contractApplied, taxClass }` in `@esite/shared`, unit-tested. Price is **snapshotted** onto `order_items` at order/quote-accept time so later catalogue changes don't mutate historic orders.

---

## 4. Module C — Discovery / storefront (buyer)

- **Directory:** filter to **listed** suppliers (respect visibility; today lists all `is_active`). Search + category/subcategory facets, province/service-area filter, sort (rating, name). Show verified/badge state honestly.
- **Supplier storefront:** profile, ratings, catalogue grouped/filterable, stock + price (buyer-specific: contract/tier price shown to the logged-in buyer), min-order and lead-time, fulfilment options.
- **Product page:** media gallery, full description/specs, price breaks, stock, add-to-cart / request-quote.
- **Global product search** across suppliers (optional v2) — search catalogue items, not just suppliers.

---

## 5. Module D — Cart, checkout & RFQ

### 5.1 Cart (new, persistent)
- **Per-supplier cart** (decision #6): new `carts` + `cart_items` (buyer_org_id, supplier_id, item_id, qty, snapshot price at add-time but re-resolved at checkout). Multiple concurrent carts (one per supplier). Persist across sessions.
- Cart shows resolved buyer-specific pricing, VAT preview, delivery estimate, min-order enforcement, stock checks.

### 5.2 Checkout (storefront path)
1. Review cart (single supplier) → choose **fulfilment** (delivery to address / collection) → delivery fee computed → choose **payment mode** offered by supplier (pay-now / on-account).
2. **Compute totals:** line subtotals (ex-VAT) → order subtotal → delivery fee → **VAT 15%** per tax class → **order total (incl-VAT)** → **commission (5% of ex-VAT order value)** shown to supplier, not buyer.
3. Create `marketplace.orders` (+ `order_items` with snapshot pricing, tier/contract flags, tax) in status `pending_payment` (pay-now) or `submitted`/`accepted` (on-account).
4. **Pay-now:** call the **`marketplace-payment`** edge fn (wire the missing caller) → Paystack split checkout (subaccount + split_code + bearer subaccount) → redirect → on `charge.success` webhook: mark `paid`, write `commission_records`, decrement inventory, advance procurement (§8), send emails (§10).
5. **On-account:** no upfront charge; order goes to supplier for acceptance; on delivery/acceptance, a **tax invoice** is raised (terms N days). Commission on terms orders is **reconciled monthly** (see §6.4).

### 5.3 RFQ path (decision #11)
- Buyer "Request a quote" (from a product, cart, or a free-form request incl. non-catalogue items) → new `rfqs` + `rfq_items`.
- Supplier receives RFQ, responds with a **quote** (line prices, validity, delivery, lead time) → new `quotes` (or quote fields on the RFQ).
- Buyer **accepts** → converts to a `marketplace.orders` (pay-now or on-account per supplier settings) → same fulfilment/settlement path as §5.2.
- Reuses the pricing snapshot + VAT + commission logic.

### 5.4 Order lifecycle (unified, replace the dual path)
Deprecate the inconsistent `OrderButton` (client-side draft insert) in favour of one server-action checkout. Proposed status model:

```
[cart] → pending_payment → paid ─┐
                                  ├→ accepted → preparing → dispatched → delivered → completed
        submitted (on-account) ──┘
   (any pre-dispatch) → cancelled
   (post-paid) → refunded / partially_refunded / disputed
```
- `payment_status`: `pending | paid | refunded | partially_refunded | failed` (extend current enum).
- Server-side transition validation (today only the UI enforces it).

---

## 6. Module E — Payments, commission & settlement

### 6.1 Pay-now (Paystack split)
- Reuse the built **`marketplace-payment`** + **`paystack-webhook`** edge functions; **wire the web caller** ("Pay now" button + checkout redirect) which is the key missing link.
- **Split correctness:** split created at onboarding (§2.3); order carries `paystack_split_code`; charge uses subaccount split with **`bearer: subaccount`**; commission = **5%** (reconcile the hardcoded `0.06` / `percentage_charge DEFAULT 6.00`).
- Webhook writes `commission_records` (kobo) idempotently on `paystack_reference`.

### 6.2 Settlement / payout
- **Immediate split** (decision #8): supplier's share lands in their subaccount, settled by Paystack on its normal cycle. `commission_records.payout_status` tracked via `transfer.*` (already handled) — but with subaccount auto-split, E-Site may not run manual transfers; confirm whether payouts are Paystack-automatic (subaccount) vs E-Site-initiated transfers. **Sub-decision R1 (§13).**
- **Payout/settlement notification email** to supplier (missing today).

### 6.3 Refunds & disputes (v1 manual)
- Buyer raises a dispute (post-delivery window) → admin mediates → **full/partial refund** via Paystack (reverse split proportionally) → update `orders.payment_status`, `commission_records` (`refunded`), inventory restock, emails. New `order_disputes` + `refunds` tables.

### 6.4 On-account commission reconciliation (new)
Because terms orders don't pass through the Paystack split, E-Site must still earn 5%. Proposed: platform tracks terms orders, and **monthly raises an E-Site commission invoice to the supplier** for 5% of the ex-VAT value of terms orders marked settled that month (supplier self-marks buyer payment received, or buyer confirms). New `supplier_commission_statements`. **Sub-decision R2 (§13)** — alternative: require all first-time/untrusted buyers to pay-now, terms only for whitelisted relationships.

### 6.5 Commission config (new)
Single source of truth for the rate (replace scattered 6% defaults): a config (per-platform default 5%, optional per-supplier/per-category override), read by pricing, checkout, edge fns, and onboarding UI copy.

---

## 7. Module F — Fulfilment (decision #9)

- **Supplier fulfilment settings:** offers delivery and/or collection; delivery fee rule (flat / by area / by order value / free over threshold); service areas; collection address + hours; dispatch SLA.
- **At checkout:** buyer picks delivery (to a captured **structured delivery address** — not folded into notes) or collection; fee added as an explicit order line/field.
- **Order fulfilment tracking:** states `preparing → dispatched → delivered`; capture dispatch date, optional courier/waybill reference (free text), proof-of-delivery (photo/signature — reuse inspection photo patterns); buyer **Confirm delivery** triggers `delivered → completed` and unlocks rating + advances procurement (§8).
- New columns/table for delivery details + tracking; storage for POD.

---

## 8. Module G — Deep procurement integration (decision #4)

> **⚠ Correction (2026-07-13, post-planning):** `projects.procurement_items` and `projects.supplier_invoices` were **DROPPED** by `00087_drop_procurement_module.sql` and no longer exist (the generated `packages/db/src/types.ts` still lists them — it is stale). The live procurement tracker is **`structure.node_orders` + `structure.node_order_documents`**. This section is corrected to target those. See reconciliation register RR-1.

**Principle:** the **project** (`structure.node_orders`) remains the source of truth for *what is required*; the marketplace is a *fulfilment channel* that reports back.

**Linkage:**
- Order/line linkage: allow a `marketplace.order_items` line (and/or the order) to reference a **project**, a **`structure.node_id`**, and/or a **`structure.node_orders` row** it fulfils (buyer selects "buying for project X / DB-3" at cart/checkout). `order_items.procurement_item_id` is kept as an **inert reserved** column only (the procurement module is gone).
- **On paid/accepted order:** advance the linked `structure.node_orders` from `required → ordered` (respecting the existing `planTenantOrderReconcile` no-regression rule).
- **On delivery confirmed:** advance `node_orders → received`.
- **Invoice flow-back:** the platform-issued tax invoice attaches to `structure.node_order_documents` (new `'invoice'` doc_type) for the buyer's project cost tracking.

**Constraints:** cross-schema, security-definer helpers, and RLS already exist for `node_orders`; reuse `node-order.actions` patterns and `ORG_WRITE_ROLES` gating. Must not regress the live material-tracker workflow (74 refs). **Sub-decision R3 (§13):** exact mapping when an order line spans multiple BOM lines or non-project stock.

---

## 9. Module H — Data model delta (design, not migrations)

New/changed (illustrative — final columns in the plan):

| Table (new unless noted) | Purpose |
|---|---|
| `catalogue_item_media` | item images/spec-sheets (+ `catalogue-media` bucket) |
| `catalogue_price_tiers` | volume price breaks |
| `contract_prices` | per-buyer negotiated prices/discounts |
| `catalogue_items` (alter) | `stock_on_hand`, `track_inventory`, `backorder_allowed`, `restock_lead_days`, `tax_class`, `primary_media_id` |
| `supplier_settings` | payment modes, fulfilment, terms policy, auto-accept |
| `carts`, `cart_items` | persistent per-supplier cart |
| `rfqs`, `rfq_items`, `quotes` | RFQ/quote flow |
| `marketplace.orders` (alter) | `order_type` (checkout/rfq), `payment_mode` (pay_now/on_account), fulfilment (`fulfilment_method`, delivery address FK, `delivery_fee`), tax (`subtotal_ex_vat`, `vat_amount`, `total_incl_vat`), extended `status`/`payment_status`, project/node linkage, DELETE policy + client_viewer exclusion |
| `order_items` (alter) | `tier_applied`, `contract_applied`, `tax_class`, `line_vat`, `node_id?`, `procurement_item_id?` |
| `delivery_addresses` | structured buyer delivery addresses |
| `order_fulfilment` | dispatch/delivery tracking + POD |
| `order_disputes`, `refunds` | dispute/refund flow |
| `supplier_commission_statements` | monthly commission reconciliation (on-account) |
| `commission_config` | single source for commission rate/overrides |
| `paystack_subaccounts` (fix) | actually populate `split_code`; real `is_verified` |
| `tax_invoices` | platform-issued tax invoices (supplier→buyer) + E-Site commission invoices |

**Cross-cutting:** reconcile **kobo vs rand** (pick one internal money representation + a money helper); add **VAT** everywhere; harden **RLS** (world-readable suppliers/ratings review; orders DELETE + client_viewer exclusion; ownership-checked writes).

---

## 10. Module I — Email & notifications

Today: **zero marketplace emails** (in-app bell + push only). Build a marketplace transactional email set (Resend, via the existing email infra) **plus** keep in-app/push. Matrix:

| Event | Recipient | Channel |
|---|---|---|
| Supplier registration | Supplier | Email (branded welcome + checklist) |
| Bank linked / verified | Supplier | Email + in-app |
| New order / RFQ received | Supplier | Email + in-app + push |
| Order accepted / quoted | Buyer | Email + in-app |
| Payment received (receipt + tax invoice) | Buyer | Email (with invoice PDF) |
| Order dispatched / delivered | Buyer | Email + in-app |
| Delivery confirmed | Supplier | Email + in-app |
| Payout / settlement | Supplier | Email |
| Payout failed | Supplier | Email + admin alert |
| Refund issued | Buyer + Supplier | Email |
| Dispute opened / resolved | Both + admin | Email + in-app |
| Low-stock / out-of-stock | Supplier | Email + in-app |
| Monthly commission statement | Supplier | Email (with statement PDF) |
| Abandoned cart (optional) | Buyer | Email |

Invoice/statement PDFs reuse the existing PDF generation approach (pdf-lib/report infra).

---

## 11. Module J — Admin, RBAC & security (launch blockers)

- **Buyer role gate:** define which buyer roles may browse/cart/checkout/pay/dispute; enforce with `requireRoleAPI`/`requireRolePage` + `ORG_WRITE_ROLES`-style groups (today marketplace writes have **no role gate**). Add all routes/actions to `docs/rbac-matrix.md` in the same change.
- **Supplier portal isolation:** dedicated context + gates so only the owning supplier org can read/write its data; replace id-only mutations with ownership-checked ones.
- **RLS hardening:** orders need a DELETE policy + client_viewer exclusion; review world-readable `suppliers`/`supplier_ratings`; new tables get RLS mirroring the audited patterns; payment/commission tables stay service-role-write.
- **Admin console:** supplier moderation (suspend/flag despite self-serve), dispute/refund mediation, commission config, payout/settlement reconciliation, tax-invoice oversight, marketplace analytics.
- **Payment security:** webhook signature (already), idempotency (already), amount/split server-computed (never trust client), full audit trail.
- **Abuse/trust:** since suppliers are instantly live (decision #3), lean on ratings, dispute flow, admin suspend, and a "new supplier" indicator rather than pre-vetting.

---

## 12. Phased build roadmap (proposal — open to change)

The end-state is large; ship in vertical, independently valuable slices. **Recommended sequencing** (alternatives noted):

- **Phase 0 — Foundations & reconciliation.** Canonical taxonomy; commission config (5%); money-unit reconciliation; registration hardening; supplier portal context + role gates + RLS hardening; RBAC-matrix update. *(No user-visible launch; de-risks everything.)*
- **Phase 1 — Storefront + catalogue richness (no payments).** Media, tiered/contract pricing, inventory, pricing-resolution service, bulk import, discovery/product pages, persistent cart. Can go live behind the flag as a **directory + cart + RFQ** experience without Paystack. *(Not payment-blocked → shippable before KYC clears.)*
- **Phase 2 — Payments (pay-now).** Wire `marketplace-payment` caller + split creation + verified banking; checkout pay-now; webhook → paid/commission/inventory; receipts + tax invoices; refunds/disputes (manual). **Gated on Paystack live-mode KYC.**
- **Phase 3 — Fulfilment + deep procurement integration.** Delivery/collection, delivery fees, tracking/POD, confirm-delivery; order→`node_orders`/`procurement_items` advancement + invoice flow-back.
- **Phase 4 — On-account/terms + reconciliation.** Terms checkout, credit limits, monthly commission statements, settlement/payout emails.
- **Phase 5 — Email/notification completeness, admin console, analytics, polish.** (Emails land incrementally within each phase; this phase closes gaps + admin tooling.)

**Alternative sequencings considered:** (B) *Payments-first* — fastest to monetise but hard-blocked on KYC and highest risk; (C) *Single thin end-to-end slice first* (one supplier→buyer→pay→deliver→settle→integrate) — good for validating the whole chain early, at the cost of breadth. Recommendation is the phased plan above because Phase 1 delivers user-visible value **without** the KYC blocker, while Phase 0 removes the latent security/consistency debt first.

---

## 13. Open sub-decisions & risks (to resolve before/within implementation)

- **R1 — Payout mechanism:** with Paystack **subaccount auto-split**, is settlement fully Paystack-automatic (no E-Site transfer step), or do we run E-Site-initiated transfers? Determines whether `commission_payouts`/`transfer.*` handling is used at all. *(Confirm against Paystack ZA subaccount settlement behaviour + the pilot log.)*
- **R2 — On-account commission collection:** monthly supplier commission invoice vs restricting terms to trusted buyers vs supplier-remits-on-settlement. Affects trust, cash-flow, and build complexity.
- **R3 — Procurement mapping granularity:** how an order line maps to BOM lines / node orders when it spans multiple requirements or includes non-project stock.
- **R4 — Escrow deferred:** v1 pays supplier before delivery (immediate split) + self-serve suppliers → buyer risk. Mitigation = dispute/refund + admin suspend; revisit escrow if fraud emerges.
- **R5 — Seller-of-record & VAT invoicing** must be legally validated (platform issuing tax invoices under supplier VAT numbers; E-Site commission VAT treatment). Confirm with accountant / align to Paystack KYC framing.
- **R6 — Paystack go-live** remains the hard external dependency for all pay-now flows (KYC email is Arno-owned).
- **R7 — Multi-org UX** (dual firm+supplier users) context-switching design.
- **R8 — Migration safety:** all schema changes must not regress the live `node_orders` material tracker; PostgREST schema-cache reloads for any new/changed schema.

---

## 14. Explicitly out of scope (v1)
- Public/consumer (B2C) buyers; multi-currency; international shipping.
- Carrier/logistics integrations, live shipping rates, real-time tracking.
- Automated escrow/marketplace-wallet.
- Full product-review moderation workflow beyond current ratings + admin suspend.
- Supplier analytics beyond basic order/GMV/commission reporting.

---

## 15. What this round did NOT do (next steps)
- No code, migrations, or config changes were made.
- Next deliverable (separate): an **implementation plan** (module-by-module tasks, migrations, TDD, RBAC-matrix updates, rollout behind the flag) — produced only on your go-ahead.
- Recommend resolving **R1, R2, R5** before Phase 2/4 planning.
