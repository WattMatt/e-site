# Marketplace E-Commerce — Implementation Program Index

> **For agentic workers:** This is the PROGRAM index, not a task plan. It decomposes the marketplace build into per-phase plans (per the writing-plans "one plan per subsystem" rule), and defines the shared conventions, completeness checklists, and decision gates every phase plan inherits. Execute each phase plan with **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**.

**Spec:** [`../specs/2026-07-13-marketplace-target-spec.md`](../specs/2026-07-13-marketplace-target-spec.md)
**Current state:** [`../specs/2026-07-13-marketplace-investigation.md`](../specs/2026-07-13-marketplace-investigation.md)
**Goal:** Turn the dark, RFQ-only marketplace into a full B2B e-commerce marketplace (payments, commission, fulfilment, tax, deep procurement integration) shipped in independently-valuable phases.

---

## 1. Why a plan SET, not one plan

The spec covers 10 modules; forcing them into one plan would violate bite-sized decomposition and couple unrelated risk. Each phase below is its own plan file that produces **working, testable software on its own** and is authored just-in-time (later phases depend on earlier outcomes and the open decisions R1/R2/R5).

| Phase | Plan file | Ships (value on its own) | Depends on | Ext. blocker |
|---|---|---|---|---|
| **0 — Foundations & reconciliation** | `2026-07-13-marketplace-phase-0-foundations.md` ✅ authored | Canonical taxonomy, one commission source (5%), money helper, marketplace role gates, RLS hardening, transactional supplier registration, RBAC-matrix. No user-visible launch — de-risks all later phases. | — | none |
| **1 — Storefront + rich catalogue (no payments)** | `…-phase-1-storefront-catalogue.md` (author at Phase 0 done) | Media, tiered/contract pricing, inventory, pricing-resolution service, bulk import, discovery/product pages, persistent per-supplier cart, unified order model, RFQ. Can go live behind the flag as directory+cart+RFQ **without Paystack**. | Phase 0 | none |
| **2 — Payments (pay-now)** | `…-phase-2-payments.md` | Wire `marketplace-payment` caller + split creation + verified banking; pay-now checkout; webhook→paid/commission/inventory; receipts + tax invoices; manual refunds/disputes. | Phase 1 | **Paystack live-mode KYC**; decisions **R1, R5** |
| **3 — Fulfilment + procurement integration** | `…-phase-3-fulfilment-procurement.md` | Delivery/collection + fees + tracking/POD; order→`node_orders`/`procurement_items` advancement; invoice flow-back to `supplier_invoices`. | Phase 2 | decision **R3** |
| **4 — On-account / terms + reconciliation** | `…-phase-4-terms-reconciliation.md` | Terms checkout, credit limits, monthly commission statements, settlement/payout emails. | Phase 2 | decision **R2** |
| **5 — Emails, admin console, analytics, polish** | `…-phase-5-admin-notifications.md` | Full transactional email set, admin moderation/dispute/commission/payout console, marketplace analytics. | Phases 1–4 | — |

> Emails land incrementally inside each phase (each phase wires the emails its flows need); Phase 5 closes gaps + builds the admin console.

---

## 2. Shared conventions (every phase inherits)

**Repo / branch.** Work in a dedicated worktree off `origin/main` (NOT the current `feat/jbcc-production`). One feature branch per phase, e.g. `feat/marketplace-phase-0`. Use **superpowers:using-git-worktrees**.

**Migrations.**
- Source of truth: `apps/edge-functions/supabase/migrations/`. **Next free number is `00173`** (repo is at `00172`).
- Migrations **auto-apply on merge to `main`** via `deploy-migrations.yml` (`supabase db push`). **Do NOT hand-apply via the Management API** — it desyncs `schema_migrations`. (This supersedes the older manual-apply note in CLAUDE.md; see memory `migrations-auto-apply-on-merge`.)
- Any migration that `CREATE`/`DROP`s a **schema** must PATCH the PostgREST `db_schema` config (schema-cache reload); a plain new table/column only needs `NOTIFY pgrst, 'reload schema'`. New **storage buckets** are created via SQL migration (`storage.buckets` insert + `storage.objects` RLS policies).

**Testing / gates (per task, TDD).** Runner is **vitest**.
- Shared pkg: `pnpm --filter @esite/shared test` (`vitest run`).
- Web: `pnpm --filter web test`.
- Always end a task green on: `pnpm --filter <pkg> test` + `pnpm --filter <pkg> type-check` + `pnpm --filter <pkg> lint` (or `turbo run test type-check lint`).

**Commits.** Frequent, one logical change each. End messages with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

**RBAC.** Every new route/page/action gets a row in `docs/rbac-matrix.md` **in the same change**. Gate with `requireRolePage` / `requireRoleAPI` (from `@/lib/auth/require-role`); import role groups from `@esite/shared` — never hardcode role strings. New groups this program adds: `MARKETPLACE_BUYER_ROLES`, `SUPPLIER_PORTAL_ROLES` (defined in Phase 0).

**Money.** One internal representation via a shared money helper (Phase 0 Task 3): store/compute in integer cents; format at the edges. Reconcile the existing kobo (bigint) vs rand (numeric) split as tables are touched.

**UI / design system.** Follow existing E-Site conventions: `Card / CardHeader / CardBody`, badge variants `default|ghost|info|warning|success|danger`, CSS-var styling (`var(--c-amber)`), routes use `[id]`. Use the **frontend-design** skill only for net-new storefront surfaces, conforming to the system. Verify every page visually with the **run** skill / in-app browser.

**Feature flag.** Everything stays behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE` until a phase is explicitly cleared for launch. Phase 1 may be exposed (directory+cart+RFQ) independently of payments.

---

## 3. Master completeness checklists (verified in each phase's final sweep)

These are the "nothing missed" guarantees. The final task of every phase re-runs the relevant checklist.

**Pages** — every spec route exists, renders, is role-gated, matches the design system, and is listed in `rbac-matrix.md`. Supplier: register, profile, banking, settings, catalogue (list/new/edit/media/import), orders, RFQs, payouts. Buyer: directory, supplier storefront, product, cart, checkout, orders, RFQs, disputes. Admin: supplier moderation, disputes, commission config, payouts, analytics.

**API / server actions** — every action gated; server-computes money/splits; ownership-checked (no id-only mutations relying on RLS alone).

**Buckets** — created via migration **with storage RLS**: `catalogue-media` (public-read for listed items), proof-of-delivery, invoice/statement PDFs. PostgREST reload applied.

**RLS** — every new table has policies mirroring the audited patterns; `marketplace.orders` gains its missing DELETE policy + client_viewer exclusion; payment/commission tables stay service-role-write.

**Emails** — the 14-row matrix in spec §10; each event has a template + trigger + test.

**Processes / flows** — each has ≥1 integration test: signup, catalogue CRUD+media+import, pricing resolution, cart, checkout (pay-now), checkout (terms), settlement, fulfilment, procurement sync, refund/dispute, all emails.

---

## 4. Verification & review gates (per phase)

1. **TDD** every task (superpowers:test-driven-development).
2. **verify** — exercise each new flow end-to-end in the running app (not just unit tests).
3. **superpowers:verification-before-completion** — evidence before any "done" claim.
4. **superpowers:requesting-code-review** — adversarial review vs spec + standards after the phase.
5. **security-review** (+ security-audit) — **mandatory** for Phases 0, 2, 3, 4 (payments, splits, RLS, ownership, webhook signature/idempotency).
6. **/code-review ultra** (ultrareview) — user-triggered heavyweight multi-agent branch review at each phase gate (billed; cannot be self-launched).
7. **simplify** — quality/dedup pass on the diff.
8. **superpowers:finishing-a-development-branch** — merge/PR/cleanup.

---

## 5. Decision gates (resolve before the dependent phase)

| ID | Question | Blocks | Default if unanswered |
|---|---|---|---|
| R1 | Paystack subaccount auto-split vs E-Site-initiated transfers for payout | Phase 2 settlement | Assume auto-split; skip transfer code until proven needed |
| R2 | On-account commission collection (monthly statement vs trusted-buyer-only vs supplier-remits) | Phase 4 | Monthly commission statement |
| R3 | Order-line ↔ BOM/node mapping granularity | Phase 3 | 1 order line → 1 procurement_item; node link optional |
| R5 | Platform-issued tax invoices under supplier VAT numbers — legal/accountant sign-off | Phase 2 invoicing | Hold invoice generation until confirmed; capture data regardless |
| R4/R6/R7/R8 | Escrow deferral / Paystack go-live / multi-org UX / migration safety | see spec §13 | as noted in spec |

---

## 5b. Cross-plan reconciliation register (AUTHORITATIVE — overrides any phase plan that conflicts)

All six plans are authored (Phase 0 + Phases 1–5). A cross-plan consistency pass found the seams below. **Executors MUST honour this register over the individual phase docs where they differ.**

- **RR-1 — Procurement module is DROPPED (spec/investigation correction).** `projects.procurement_items`, `projects.supplier_invoices` and the whole 5-stage BOM pipeline were removed by `00087_drop_procurement_module.sql`, superseded by `structure.node_orders` + `node_order_documents`. `packages/db/src/types.ts` **still lists them — it is STALE; regenerate types.** Deep procurement integration (spec §8 / Phase 3) targets `structure.node_orders` (status advancement) + `structure.node_order_documents` (new `'invoice'` doc_type for flow-back). `order_items.procurement_item_id` is an **inert reserved** column only. (Investigation §3.4 and spec §8 corrected accordingly.)
- **RR-2 — `commission_config` has ONE owner: Phase 2 (`00191`).** It creates the table, seeds platform 5%, and defines the SQL resolver `get_commission_rate(p_supplier_org_id uuid, p_category text)` + the shared TS `resolveCommissionRate`. Phase 5 `00218` must **NOT recreate the table** — it only adds the admin editor UI + override rows. Phase 4 and Phase 5 call **`get_commission_rate`** (retire the divergent names `commission_rate_for` and `commission_rate_for_supplier`).
- **RR-3 — VAT helper has ONE source: Phase 1** (`@esite/shared`: `VAT_RATE`, `computeLineVatCents`). Phase 2 `computeOrderTotals` **imports** these; it does not re-declare the rate.
- **RR-4 — Tax-invoice R5 gate is ONE DB flag:** `commission_config.tax_invoices_enabled` (boolean, default false), added when Phase 2 creates `commission_config`. Phases 2/4/5 read the DB flag. The env var `MARKETPLACE_TAX_INVOICES_ENABLED` is **dropped**.
- **RR-5 — `tax_invoices` has ONE owner: Phase 2 (`00193`).** Phase 4 `00214` only `ALTER`s it (terms columns).
- **RR-6 — Inventory decrements EXACTLY ONCE**, on the order-confirming event: pay-now → on `paid` (Phase 2 webhook); on-account → on `accepted` (Phase 1/4). Idempotent per order; no double-decrement. Phase 5 stock alerts hook the same decrement.
- **RR-7 — Supplier welcome email: Phase 0 owns the trigger;** Phase 5 consolidates the template into the shared marketplace-email module and Phase 0's call is refactored to import it (no duplicate template).
- **RR-8 — On-account sequencing.** `payment_mode` is added in Phase 2 (`00190`), which runs **after** Phase 1 (`00176–00183`). Therefore Phase 1's checkout is **status-only** (`submitted`/`accepted`, no-charge) and must not reference `payment_mode`. Phase 4 formalises `payment_mode='on_account'` + credit limits + terms invoicing + monthly reconciliation.
- **RR-9 — Migration numbers are INDICATIVE; rebase to next-free at execution.** Planned ranges were P0 `173–175`, P1 `176–183`, P2 `190–194`, P3 `200–206`, P4 `210–215`, P5 `216–220`. **⚠ 2026-07-15 UPDATE:** `origin/main` (`0c13306`) is already at **`00173`** (`00172_qc_reports`, `00173_notifications_type_qc_and_created` — QC module merged 07-14), so every planned number shifts up by ≥1. **Phase 0 actual numbers: commission = `00174`, orders-RLS = `00175`, register-RPC = `00176`** (confirm next-free against current `main` at execution). **Contention:** the open `fix/tenant-documents-effective-role-rls` branch also renumbers a migration to `00174` on rebase — last-to-merge renumbers. Always `git ls-tree origin/main …/migrations | tail` immediately before creating any migration and take the next free number; treat all downstream plan numbers as relative offsets, not fixed filenames.
- **RR-10 — `public.user_org_role()` does NOT exist.** Phase 0 Task 5's orders-RLS migration (`00174`) references it; Phase 3 confirmed it is absent (existing helpers: `get_user_org_ids`, `user_is_client_viewer`, `user_has_project_access`, `user_can_manage_project`, `user_effective_project_role`). **Phase 0 must create `public.user_org_role(uuid)` in `00174`** (SECURITY DEFINER, returns the caller's role in the given org) or rewrite the policy against an existing helper.
- **RR-11 — Minor:** Phase 5's `renderBankVerifiedEmail` import at line ~902 is a "see note" soft reference — resolve it to the concrete template name when executing Phase 5.

## 6. Execution model

Recommended: **superpowers:subagent-driven-development** — fresh subagent per task, two-stage (spec + quality) review between tasks, exactly as PRs #142/#143 were built. Alternative: **superpowers:executing-plans** (inline, batched with checkpoints).

**Start:** author is running Phase 0. On approval, execute `2026-07-13-marketplace-phase-0-foundations.md` task-by-task, then author Phase 1.
