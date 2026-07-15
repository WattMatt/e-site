# Marketplace Phase 5 — Emails, Admin Console, Analytics & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inherit all conventions from [`2026-07-13-marketplace-implementation-index.md`](./2026-07-13-marketplace-implementation-index.md) (worktree, migrations auto-apply on merge, vitest gates, RBAC-matrix rule, commit trailer, money-in-cents, feature flag).

**Goal:** Close every gap the earlier phases leave: a single, consistent marketplace transactional-email module covering all 14 spec §10 events; an E-Site **platform-admin** console (supplier moderation, dispute/refund mediation, commission config, payout/settlement reconciliation, analytics); a server-aggregated marketplace analytics dashboard (dataviz charts); trust/abuse controls; and the **final cross-program completeness sweep** that runs the master checklists from the index §3.

**Architecture:** Pure, runtime-agnostic email renderers in `@esite/shared/email` (the existing `rfi-email.ts` pattern) + one `send-email` passthrough type + one org-scoped web dispatch helper (the `notify.ts` pattern). A new platform-admin capability (`PLATFORM_ADMIN_ORG_ID` + `is_platform_admin()` DB helper + `requirePlatformAdmin*` gates), keyed on owner/admin membership of the WM-Consulting operator org (`dddddddd-0000-0000-0000-000000000001`) which already bypasses `has_feature`. Admin pages live under `apps/web/src/app/(admin)/marketplace/admin/*` behind a `requirePlatformAdminPage` layout. Analytics uses a `SECURITY DEFINER` aggregation RPC + inline-SVG charts (the **dataviz** approach — brand-neutral, CSS-var, light/dark). Five migrations `00216`–`00220`.

**Tech Stack:** Next.js 15 (App Router, server actions, RSC), TypeScript, Zod, Supabase/Postgres (RLS, `SECURITY DEFINER` RPC, migrations), pdf-lib, Resend (existing `send-email` edge fn), vitest.

**Scope (10 tasks):** 1) marketplace email template module + `send-email` passthrough + web dispatch · 2) org-scoped marketplace notification helper (bell+push+email) · 3) platform-admin capability + admin audit log (**00216**) · 4) supplier moderation console + directory visibility (**00217**) · 5) commission config editor (**00218**) · 6) dispute/refund mediation queue · 7) low-stock / out-of-stock alerts (**00219**) · 8) marketplace analytics dashboard (**00220**) · 9) monthly commission statement + payout/settlement emails · 10) RBAC matrix + FINAL cross-program completeness sweep + review gates.

**Cross-phase assumptions (verified in Task 10, remediated if false):**
- **Phase 1** added catalogue inventory columns (`stock_on_hand`, `track_inventory`, `backorder_allowed`, `restock_lead_days`) and the `catalogue-media` bucket; unified order model + cart/RFQ tables exist with RLS.
- **Phase 2** created `order_disputes` + `refunds` tables, the tax-invoice generator + `marketplace-docs`/invoice bucket, and wired `marketplace-payment` + `paystack-webhook` (charge → `paid`/`commission_records`/inventory decrement; `transfer.*` → payout status). Phase 5 adds the **admin mediation UI + emails + audit** on top and the **payout emails** into the existing webhook `transfer.*` branch.
- **Phase 3** created `order_fulfilment` + POD bucket + `delivery_addresses`.
- **Phase 4** may have created `supplier_commission_statements`; Task 9 aggregates `commission_records` on the fly and reuses that table only if present (no new statements table here).
- **Phase 0** shipped: `MARKETPLACE_BUYER_ROLES`/`SUPPLIER_PORTAL_ROLES`, the money helper (`randToCents`/`centsToRand`/`addCents`/`formatZARFromCents`), `MARKETPLACE_CATEGORIES`, `require-role` helpers, orders RLS hardening (00174), and a `marketplace-supplier-welcome` send that Task 1 makes canonical.

If any assumption is false at execution time, its dependent task's Step 1 says exactly what to add (guarded `IF NOT EXISTS` migration or a stub) and the final sweep (Task 10) records the remediation.

---

## Task 1: Marketplace email template module + `send-email` passthrough + web dispatch

Builds the single consistent transactional-email system for the marketplace: pure renderers in `@esite/shared` (mirrors `packages/shared/src/email/rfi-email.ts`), one new `send-email` type that forwards pre-rendered `{ to, subject, html, attachments? }` (attachments carry invoice/statement PDFs), and one web helper that posts to it with the service-role key (mirrors `apps/web/src/lib/notify.ts`).

**Files:**
- Create: `packages/shared/src/email/marketplace-email.ts`
- Create: `packages/shared/src/email/marketplace-email.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts` (add `marketplace` passthrough type + attachment support)
- Create: `apps/web/src/lib/marketplace-email.ts` (web dispatch helper)
- Create: `apps/web/src/lib/marketplace-email.test.ts`

- [ ] **Step 1: Write the failing renderer test**

```ts
// packages/shared/src/email/marketplace-email.test.ts
import { describe, it, expect } from 'vitest'
import {
  renderSupplierWelcomeEmail,
  renderBankVerifiedEmail,
  renderNewOrderEmail,
  renderOrderAcceptedEmail,
  renderPaymentReceiptEmail,
  renderOrderDispatchedEmail,
  renderDeliveryConfirmedEmail,
  renderPayoutEmail,
  renderPayoutFailedEmail,
  renderRefundEmail,
  renderDisputeEmail,
  renderLowStockEmail,
  renderCommissionStatementEmail,
  renderAbandonedCartEmail,
  MARKETPLACE_EMAIL_EVENTS,
} from './marketplace-email'

const site = 'https://www.e-site.live'

describe('marketplace email renderers', () => {
  it('covers all 14 spec §10 events in the registry', () => {
    expect(MARKETPLACE_EMAIL_EVENTS).toHaveLength(14)
  })

  it('supplier welcome names the company and links to setup', () => {
    const { subject, html } = renderSupplierWelcomeEmail({ companyName: 'Acme <Electrical>', siteUrl: site })
    expect(subject).toContain('Acme')
    expect(html).toContain('Acme &lt;Electrical&gt;') // escaped
    expect(html).toContain(`${site}/supplier/profile`)
  })

  it('new-order email deep-links the supplier order and shows the total', () => {
    const { subject, html } = renderNewOrderEmail({
      orderNumber: 'ORD-1234', buyerName: 'BuildCo', totalCents: 123456, orderId: 'o-1', siteUrl: site,
    })
    expect(subject).toContain('ORD-1234')
    expect(html).toContain(`${site}/supplier/orders/o-1`)
    expect(html).toContain('R 1 234,56') // formatZARFromCents
  })

  it('payment receipt states the amount paid and references the invoice attachment', () => {
    const { subject, html } = renderPaymentReceiptEmail({
      orderNumber: 'ORD-1', amountCents: 5000, invoiceNumber: 'INV-9', orderId: 'o-9', siteUrl: site,
    })
    expect(subject).toMatch(/receipt/i)
    expect(html).toContain('INV-9')
    expect(html).toContain('R 50,00')
  })

  it('payout-failed email is flagged for the supplier and admin alert copy', () => {
    const { subject, html } = renderPayoutFailedEmail({
      supplierName: 'Acme', amountCents: 9500, reason: 'account closed', siteUrl: site,
    })
    expect(subject).toMatch(/failed/i)
    expect(html).toContain('account closed')
  })

  it('low-stock email names the item and current stock', () => {
    const { subject, html } = renderLowStockEmail({
      itemName: 'CBI 20A', kind: 'out_of_stock', stockOnHand: 0, itemId: 'i-1', siteUrl: site,
    })
    expect(subject).toMatch(/out of stock/i)
    expect(html).toContain('CBI 20A')
    expect(html).toContain(`${site}/supplier/catalogue/i-1`)
  })

  it('commission statement email states the period and total', () => {
    const { subject, html } = renderCommissionStatementEmail({
      periodLabel: 'July 2026', commissionCents: 250000, siteUrl: site,
    })
    expect(subject).toContain('July 2026')
    expect(html).toContain('R 2 500,00')
  })

  it('every renderer returns a full HTML document with the E-Site footer', () => {
    const all = [
      renderBankVerifiedEmail({ supplierName: 'A', siteUrl: site }),
      renderOrderAcceptedEmail({ orderNumber: 'O', supplierName: 'A', orderId: 'x', siteUrl: site }),
      renderOrderDispatchedEmail({ orderNumber: 'O', courierRef: 'W1', orderId: 'x', siteUrl: site }),
      renderDeliveryConfirmedEmail({ orderNumber: 'O', buyerName: 'B', orderId: 'x', siteUrl: site }),
      renderPayoutEmail({ supplierName: 'A', amountCents: 100, siteUrl: site }),
      renderRefundEmail({ orderNumber: 'O', amountCents: 100, recipient: 'buyer', siteUrl: site }),
      renderDisputeEmail({ orderNumber: 'O', state: 'opened', recipient: 'supplier', orderId: 'x', siteUrl: site }),
      renderAbandonedCartEmail({ buyerName: 'B', supplierName: 'A', itemCount: 3, siteUrl: site }),
    ]
    for (const { subject, html } of all) {
      expect(subject.length).toBeGreaterThan(0)
      expect(html).toMatch(/^<!DOCTYPE html>/)
      expect(html).toContain('app.e-site.live')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- marketplace-email`
Expected: FAIL — cannot resolve `./marketplace-email`.

- [ ] **Step 3: Write the renderer module**

```ts
// packages/shared/src/email/marketplace-email.ts
/**
 * Marketplace transactional email renderers — pure, runtime-agnostic (no Deno/
 * Node globals) so they unit-test in @esite/shared and are called from the web
 * `sendMarketplaceEmail` helper, which forwards { to, subject, html, attachments }
 * to the `send-email` Edge Function's `marketplace` passthrough branch.
 *
 * Covers the full spec §10 matrix (14 events). Money is integer cents; format
 * with the shared formatZARFromCents. Keeps the dark-card wrapper consistent
 * with rfi-email.ts / the other send-email templates.
 */
import { formatZARFromCents } from '../money/money'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Dark-card transactional wrapper matching rfi-email.ts. */
function base(content: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:560px;margin:0 auto}
h2{color:#F8FAFC;font-size:19px;margin:0 0 14px}
p{line-height:1.55;font-size:14px;margin:0 0 12px}
.btn{display:inline-block;margin-top:8px;padding:10px 18px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px}
.amount{font-size:22px;font-weight:700;color:#F8FAFC}
.meta{font-size:12px;color:#94A3B8}
.warn{color:#F59E0B;font-weight:600}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${siteUrl}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`
}

function button(href: string, label: string): string {
  return `<a class="btn" href="${href}">${escapeHtml(label)}</a>`
}

type Rendered = { subject: string; html: string }

// 1 — Supplier registration
export function renderSupplierWelcomeEmail(v: { companyName: string; siteUrl: string }): Rendered {
  return {
    subject: `Welcome to the E-Site marketplace, ${v.companyName}`,
    html: base(
      `<h2>You're live on the E-Site marketplace</h2>
      <p>Welcome, <strong>${escapeHtml(v.companyName)}</strong>. Your supplier account is active. Finish setup so buyers can find and order from you:</p>
      <p class="meta">1. Complete your profile &amp; categories · 2. Link your bank (Paystack) to receive payouts · 3. Add catalogue items and make them marketplace-visible.</p>
      ${button(`${v.siteUrl}/supplier/profile`, 'Complete your profile')}`,
      v.siteUrl,
    ),
  }
}

// 2 — Bank linked / verified
export function renderBankVerifiedEmail(v: { supplierName: string; siteUrl: string }): Rendered {
  return {
    subject: 'Your bank account is verified — payouts enabled',
    html: base(
      `<h2>Bank account verified</h2>
      <p>Hi ${escapeHtml(v.supplierName)}, your Paystack subaccount is verified. Marketplace payouts will settle to this account automatically.</p>
      ${button(`${v.siteUrl}/supplier/profile`, 'View banking')}`,
      v.siteUrl,
    ),
  }
}

// 3 — New order / RFQ received (supplier)
export function renderNewOrderEmail(v: { orderNumber: string; buyerName: string; totalCents: number; orderId: string; siteUrl: string }): Rendered {
  return {
    subject: `New order ${v.orderNumber} — ${formatZARFromCents(v.totalCents)}`,
    html: base(
      `<h2>New order received</h2>
      <p><strong>${escapeHtml(v.buyerName)}</strong> placed order <strong>${escapeHtml(v.orderNumber)}</strong>.</p>
      <p class="amount">${formatZARFromCents(v.totalCents)}</p>
      ${button(`${v.siteUrl}/supplier/orders/${v.orderId}`, 'Review order')}`,
      v.siteUrl,
    ),
  }
}

// 4 — Order accepted / quoted (buyer)
export function renderOrderAcceptedEmail(v: { orderNumber: string; supplierName: string; orderId: string; siteUrl: string }): Rendered {
  return {
    subject: `Order ${v.orderNumber} accepted`,
    html: base(
      `<h2>Your order was accepted</h2>
      <p><strong>${escapeHtml(v.supplierName)}</strong> accepted order <strong>${escapeHtml(v.orderNumber)}</strong>.</p>
      ${button(`${v.siteUrl}/marketplace/orders/${v.orderId}`, 'View order')}`,
      v.siteUrl,
    ),
  }
}

// 5 — Payment received (buyer, invoice PDF attached)
export function renderPaymentReceiptEmail(v: { orderNumber: string; amountCents: number; invoiceNumber: string; orderId: string; siteUrl: string }): Rendered {
  return {
    subject: `Payment receipt — order ${v.orderNumber}`,
    html: base(
      `<h2>Payment received</h2>
      <p>We received <span class="amount">${formatZARFromCents(v.amountCents)}</span> for order <strong>${escapeHtml(v.orderNumber)}</strong>.</p>
      <p class="meta">Tax invoice <strong>${escapeHtml(v.invoiceNumber)}</strong> is attached (PDF).</p>
      ${button(`${v.siteUrl}/marketplace/orders/${v.orderId}`, 'View order')}`,
      v.siteUrl,
    ),
  }
}

// 6 — Order dispatched / delivered (buyer)
export function renderOrderDispatchedEmail(v: { orderNumber: string; courierRef: string | null; orderId: string; siteUrl: string }): Rendered {
  return {
    subject: `Order ${v.orderNumber} dispatched`,
    html: base(
      `<h2>Your order is on the way</h2>
      <p>Order <strong>${escapeHtml(v.orderNumber)}</strong> has been dispatched.${v.courierRef ? ` Reference: <strong>${escapeHtml(v.courierRef)}</strong>.` : ''}</p>
      ${button(`${v.siteUrl}/marketplace/orders/${v.orderId}`, 'Track order')}`,
      v.siteUrl,
    ),
  }
}

// 7 — Delivery confirmed (supplier)
export function renderDeliveryConfirmedEmail(v: { orderNumber: string; buyerName: string; orderId: string; siteUrl: string }): Rendered {
  return {
    subject: `Delivery confirmed — order ${v.orderNumber}`,
    html: base(
      `<h2>Delivery confirmed</h2>
      <p><strong>${escapeHtml(v.buyerName)}</strong> confirmed delivery of order <strong>${escapeHtml(v.orderNumber)}</strong>. It is now complete.</p>
      ${button(`${v.siteUrl}/supplier/orders/${v.orderId}`, 'View order')}`,
      v.siteUrl,
    ),
  }
}

// 8 — Payout / settlement (supplier)
export function renderPayoutEmail(v: { supplierName: string; amountCents: number; siteUrl: string }): Rendered {
  return {
    subject: `Payout of ${formatZARFromCents(v.amountCents)} settled`,
    html: base(
      `<h2>Payout settled</h2>
      <p>Hi ${escapeHtml(v.supplierName)}, <span class="amount">${formatZARFromCents(v.amountCents)}</span> has settled to your bank account.</p>
      ${button(`${v.siteUrl}/supplier/orders`, 'View orders')}`,
      v.siteUrl,
    ),
  }
}

// 9 — Payout failed (supplier + admin alert)
export function renderPayoutFailedEmail(v: { supplierName: string; amountCents: number; reason: string; siteUrl: string }): Rendered {
  return {
    subject: `Payout failed — action needed`,
    html: base(
      `<h2 class="warn">Payout failed</h2>
      <p>Hi ${escapeHtml(v.supplierName)}, a payout of <strong>${formatZARFromCents(v.amountCents)}</strong> could not be settled.</p>
      <p class="meta">Reason: ${escapeHtml(v.reason)}. Please check your banking details; the E-Site team has been notified.</p>
      ${button(`${v.siteUrl}/supplier/profile`, 'Check banking')}`,
      v.siteUrl,
    ),
  }
}

// 10 — Refund issued (buyer + supplier)
export function renderRefundEmail(v: { orderNumber: string; amountCents: number; recipient: 'buyer' | 'supplier'; siteUrl: string }): Rendered {
  const who = v.recipient === 'buyer' ? 'You have been refunded' : 'A refund was issued'
  return {
    subject: `Refund for order ${v.orderNumber}`,
    html: base(
      `<h2>${who}</h2>
      <p>A refund of <span class="amount">${formatZARFromCents(v.amountCents)}</span> was processed for order <strong>${escapeHtml(v.orderNumber)}</strong>.</p>`,
      v.siteUrl,
    ),
  }
}

// 11 — Dispute opened / resolved (both + admin)
export function renderDisputeEmail(v: { orderNumber: string; state: 'opened' | 'resolved'; recipient: 'buyer' | 'supplier' | 'admin'; orderId: string; siteUrl: string }): Rendered {
  const path = v.recipient === 'admin'
    ? `${v.siteUrl}/marketplace/admin/disputes`
    : v.recipient === 'supplier'
      ? `${v.siteUrl}/supplier/orders/${v.orderId}`
      : `${v.siteUrl}/marketplace/orders/${v.orderId}`
  return {
    subject: `Dispute ${v.state} — order ${v.orderNumber}`,
    html: base(
      `<h2>Dispute ${escapeHtml(v.state)}</h2>
      <p>A dispute on order <strong>${escapeHtml(v.orderNumber)}</strong> has been ${escapeHtml(v.state)}.</p>
      ${button(path, 'View dispute')}`,
      v.siteUrl,
    ),
  }
}

// 12 — Low-stock / out-of-stock (supplier)
export function renderLowStockEmail(v: { itemName: string; kind: 'low_stock' | 'out_of_stock'; stockOnHand: number; itemId: string; siteUrl: string }): Rendered {
  const label = v.kind === 'out_of_stock' ? 'Out of stock' : 'Low stock'
  return {
    subject: `${label}: ${v.itemName}`,
    html: base(
      `<h2 class="warn">${label}</h2>
      <p><strong>${escapeHtml(v.itemName)}</strong> is ${v.kind === 'out_of_stock' ? 'out of stock' : 'running low'} (on hand: <strong>${v.stockOnHand}</strong>). Restock to keep it visible and orderable.</p>
      ${button(`${v.siteUrl}/supplier/catalogue/${v.itemId}`, 'Update stock')}`,
      v.siteUrl,
    ),
  }
}

// 13 — Monthly commission statement (supplier, statement PDF attached)
export function renderCommissionStatementEmail(v: { periodLabel: string; commissionCents: number; siteUrl: string }): Rendered {
  return {
    subject: `Commission statement — ${v.periodLabel}`,
    html: base(
      `<h2>Your ${escapeHtml(v.periodLabel)} commission statement</h2>
      <p>E-Site marketplace commission for <strong>${escapeHtml(v.periodLabel)}</strong>: <span class="amount">${formatZARFromCents(v.commissionCents)}</span>.</p>
      <p class="meta">The full statement is attached (PDF).</p>
      ${button(`${v.siteUrl}/supplier/orders`, 'View orders')}`,
      v.siteUrl,
    ),
  }
}

// 14 — Abandoned cart (optional, buyer)
export function renderAbandonedCartEmail(v: { buyerName: string; supplierName: string; itemCount: number; siteUrl: string }): Rendered {
  return {
    subject: `You left ${v.itemCount} item${v.itemCount === 1 ? '' : 's'} in your cart`,
    html: base(
      `<h2>Still need these?</h2>
      <p>Hi ${escapeHtml(v.buyerName)}, your cart with <strong>${escapeHtml(v.supplierName)}</strong> has <strong>${v.itemCount}</strong> item${v.itemCount === 1 ? '' : 's'} waiting.</p>
      ${button(`${v.siteUrl}/marketplace`, 'Return to cart')}`,
      v.siteUrl,
    ),
  }
}

/** Canonical event registry — one row per spec §10 matrix event (14). */
export const MARKETPLACE_EMAIL_EVENTS = [
  'supplier_welcome', 'bank_verified', 'new_order', 'order_accepted', 'payment_receipt',
  'order_dispatched', 'delivery_confirmed', 'payout', 'payout_failed', 'refund',
  'dispute', 'low_stock', 'commission_statement', 'abandoned_cart',
] as const
export type MarketplaceEmailEvent = (typeof MARKETPLACE_EMAIL_EVENTS)[number]
```

- [ ] **Step 4: Export + run renderer test green**

Add to `packages/shared/src/index.ts`:
```ts
export * from './email/marketplace-email'
```
Run: `pnpm --filter @esite/shared test -- marketplace-email`
Expected: PASS (8 tests). If `formatZARFromCents` emits a different NBSP/format than the `R 1 234,56` assertions, align the two assertions to the actual `formatZARFromCents` output (read `packages/shared/src/money/money.ts` first — it is the single source).

- [ ] **Step 5: Add the `marketplace` passthrough type to `send-email`**

In `apps/edge-functions/supabase/functions/send-email/index.ts`, add a branch alongside `rfi-created` (service-role only — `marketplace` is NOT added to `PUBLIC_TYPES`). It accepts a pre-rendered payload and optional base64 attachments (invoice/statement PDFs), batching via the existing `sendEmailBatch`:

```ts
else if (type === 'marketplace') {
  // Pre-rendered marketplace transactional email(s). The web `sendMarketplaceEmail`
  // helper renders via @esite/shared and forwards { to, subject, html, attachments? }.
  // `to` may be a single address or an array; sent as one Resend batch so the
  // per-request rate limit can't silently drop recipients.
  const { to, subject, html, attachments } = payload as {
    to: string | string[]; subject: string; html: string
    attachments?: Array<{ filename: string; content: string }> // content = base64
  }
  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'marketplace requires to, subject, html' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  const recipients: string[] = Array.isArray(to) ? to : [to]
  const result = await sendEmailBatch(
    recipients.map((addr) => ({ to: addr, subject, html, ...(attachments ? { attachments } : {}) })),
  )
  if (result.sent === 0 && result.failed > 0) {
    return new Response(JSON.stringify({ error: 'All marketplace email batches failed', ...result }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ sent: true, ...result }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```
**Verification note (do not skip):** read the existing `sendEmail`/`sendEmailBatch` signatures at the top of `send-email/index.ts` and confirm they pass an `attachments` field through to the Resend `POST /emails` body (Resend supports `attachments: [{ filename, content }]` where `content` is base64). If `sendEmailBatch` strips unknown fields, extend its per-message type to forward `attachments`. Update the file header comment's "Supported types" list to include `marketplace`.

- [ ] **Step 6: Write the failing web-dispatch test**

```ts
// apps/web/src/lib/marketplace-email.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendMarketplaceEmail } from './marketplace-email'

describe('sendMarketplaceEmail', () => {
  const OLD = process.env
  beforeEach(() => {
    process.env = { ...OLD, NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' }
  })
  afterEach(() => { process.env = OLD; vi.restoreAllMocks() })

  it('POSTs the marketplace type to send-email with the service-role bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    await sendMarketplaceEmail({ to: 'a@b.com', subject: 'S', html: '<p>x</p>' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://x.supabase.co/functions/v1/send-email')
    expect((init as any).headers.Authorization).toBe('Bearer svc')
    const body = JSON.parse((init as any).body)
    expect(body.type).toBe('marketplace')
    expect(body.payload.to).toBe('a@b.com')
  })

  it('never throws when env is missing (best-effort)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await expect(sendMarketplaceEmail({ to: 'a@b.com', subject: 'S', html: '<p>x</p>' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter web test -- marketplace-email`
Expected: FAIL — module `./marketplace-email` not found.

- [ ] **Step 8: Implement the web dispatch helper**

```ts
// apps/web/src/lib/marketplace-email.ts
/**
 * Best-effort marketplace transactional email dispatch. Renders happen in
 * @esite/shared (renderXEmail → { subject, html }); this posts the pre-rendered
 * payload to the `send-email` Edge Function's `marketplace` branch with the
 * service-role key. Never throws — an email failure must not block the action.
 * Mirrors the email path in apps/web/src/lib/notify.ts.
 */
export interface MarketplaceEmailInput {
  to: string | string[]
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: string }> // content = base64
}

export async function sendMarketplaceEmail(input: MarketplaceEmailInput): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return
  const recipients = Array.isArray(input.to) ? input.to.filter(Boolean) : [input.to]
  if (recipients.length === 0) return
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ type: 'marketplace', payload: { ...input, to: recipients } }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[marketplace-email] failed', { status: res.status, body: body.slice(0, 200) })
    }
  } catch (e) {
    console.error('[marketplace-email] threw', { err: String(e) })
  }
}
```

- [ ] **Step 9: Run all tests + verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test -- marketplace-email && pnpm --filter @esite/shared type-check && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add packages/shared/src/email/marketplace-email.ts packages/shared/src/email/marketplace-email.test.ts packages/shared/src/index.ts apps/edge-functions/supabase/functions/send-email/index.ts apps/web/src/lib/marketplace-email.ts apps/web/src/lib/marketplace-email.test.ts
git commit -m "feat(marketplace): consistent transactional email module + dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Org-scoped marketplace notification helper (bell + push + email)

Every §10 event that has an in-app/push channel (new order, bank verified, dispatched, delivered, dispute, low-stock) needs a single helper that resolves the target **org's** members (supplier org or buyer org — marketplace events are org-scoped, unlike `notify.ts` which is project-scoped) and fans out to the bell (`dispatchNotification`) + email (`sendMarketplaceEmail`). This is the reusable primitive Tasks 4–9 call.

**Files:**
- Create: `apps/web/src/lib/marketplace-notify.ts`
- Create: `apps/web/src/lib/marketplace-notify.test.ts`

- [ ] **Step 1: Confirm the dependency signatures (no code yet)**

Read `apps/web/src/lib/notifications.ts` for the exact `dispatchNotification` signature (from `notify.ts` it is `dispatchNotification({ userIds, title, body, route, type, entityType?, entityId? })`, never-throws). Read how `resolveProjectRecipients` (`apps/web/src/lib/recipients.ts`) queries members via the service-role client — mirror that org-member query here.

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/src/lib/marketplace-notify.test.ts
import { describe, it, expect, vi } from 'vitest'

const dispatchNotification = vi.fn().mockResolvedValue(undefined)
const sendMarketplaceEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('./notifications', () => ({ dispatchNotification }))
vi.mock('./marketplace-email', () => ({ sendMarketplaceEmail }))

// Service-role member lookup mocked to two members of the target org.
const resolveOrgRecipients = vi.fn().mockResolvedValue([
  { userId: 'u1', email: 'u1@x.com' },
  { userId: 'u2', email: 'u2@x.com' },
])
vi.mock('./recipients', () => ({ resolveOrgRecipients }))

import { notifyMarketplaceOrg } from './marketplace-notify'

describe('notifyMarketplaceOrg', () => {
  it('rings the bell for all org members and emails them, excluding the actor from the bell', async () => {
    await notifyMarketplaceOrg({
      orgId: 'org-1', actorId: 'u1',
      bell: { title: 'New order', body: 'ORD-1', route: '/supplier/orders/o1', type: 'marketplace_order' },
      email: { subject: 'New order ORD-1', html: '<p>x</p>' },
    })
    expect(dispatchNotification).toHaveBeenCalledOnce()
    expect(dispatchNotification.mock.calls[0][0].userIds).toEqual(['u2']) // actor excluded
    expect(sendMarketplaceEmail).toHaveBeenCalledOnce()
    expect(sendMarketplaceEmail.mock.calls[0][0].to.sort()).toEqual(['u1@x.com', 'u2@x.com'])
  })

  it('skips the email channel when no email payload is given', async () => {
    sendMarketplaceEmail.mockClear()
    await notifyMarketplaceOrg({
      orgId: 'org-1', actorId: null,
      bell: { title: 'x', body: 'y', route: '/z', type: 'marketplace_order' },
    })
    expect(sendMarketplaceEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- marketplace-notify`
Expected: FAIL — `notifyMarketplaceOrg` / `resolveOrgRecipients` not found.

- [ ] **Step 4: Add `resolveOrgRecipients` + implement the helper**

Add `resolveOrgRecipients(orgId)` to `apps/web/src/lib/recipients.ts` (service-role client → `user_organisations` join `profiles`, `is_active`, returning `{ userId, email }[]`), mirroring `resolveProjectRecipients`. Then:

```ts
// apps/web/src/lib/marketplace-notify.ts
/**
 * Org-scoped marketplace notifier — bell (+push) + email for a supplier or buyer
 * org. Marketplace events are org-scoped (not project-scoped like notify.ts).
 * Best-effort, never throws.
 */
import { resolveOrgRecipients } from './recipients'
import { dispatchNotification } from './notifications'
import { sendMarketplaceEmail } from './marketplace-email'

export interface NotifyMarketplaceArgs {
  orgId: string
  /** Actor excluded from the in-app bell (no self-ping). null → notify everyone. */
  actorId: string | null
  bell: { title: string; body: string; route: string; type: string; entityType?: string; entityId?: string }
  /** Email channel; omit to skip email. */
  email?: { subject: string; html: string; attachments?: Array<{ filename: string; content: string }> }
}

export async function notifyMarketplaceOrg(args: NotifyMarketplaceArgs): Promise<void> {
  try {
    const recipients = await resolveOrgRecipients(args.orgId)
    const bellUserIds = recipients.filter((r) => r.userId !== args.actorId).map((r) => r.userId)
    const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

    if (bellUserIds.length) {
      await dispatchNotification({ userIds: bellUserIds, ...args.bell })
    }
    if (args.email && emails.length) {
      await sendMarketplaceEmail({ to: emails, subject: args.email.subject, html: args.email.html, attachments: args.email.attachments })
    }
  } catch (e) {
    console.error('[marketplace-notify] failed', { orgId: args.orgId, err: String(e) })
  }
}
```

- [ ] **Step 5: Run test green + verify + commit**

Run: `pnpm --filter web test -- marketplace-notify && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/web/src/lib/marketplace-notify.ts apps/web/src/lib/marketplace-notify.test.ts apps/web/src/lib/recipients.ts
git commit -m "feat(marketplace): org-scoped bell+push+email notifier

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Platform-admin capability + admin audit log (migration 00216)

Defines the E-Site platform-admin gate distinct from org owner/admin. Platform admin = owner/admin membership of the WM-Consulting operator org (`dddddddd-0000-0000-0000-000000000001`), which already bypasses `has_feature`. Adds the shared constant, the `require-role` gates, the DB helper for RLS, and the admin action audit log every admin task writes to.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00216_platform_admin_and_audit.sql`
- Modify: `packages/shared/src/types/index.ts` (add `PLATFORM_ADMIN_ORG_ID`)
- Test: `packages/shared/src/__tests__/marketplace/platform-admin.test.ts`
- Modify: `apps/web/src/lib/auth/require-role.ts` (add `requirePlatformAdminPage` / `requirePlatformAdminAPI` / `isPlatformAdmin`)
- Create: `apps/web/src/lib/marketplace-audit.ts` (write helper)

- [ ] **Step 1: Write the failing constant test**

```ts
// packages/shared/src/__tests__/marketplace/platform-admin.test.ts
import { describe, it, expect } from 'vitest'
import { PLATFORM_ADMIN_ORG_ID, PLATFORM_ADMIN_ROLES } from '../../types'

describe('platform admin identity', () => {
  it('pins the WM-Consulting operator org id', () => {
    expect(PLATFORM_ADMIN_ORG_ID).toBe('dddddddd-0000-0000-0000-000000000001')
  })
  it('platform-admin roles are owner + admin of the operator org', () => {
    expect([...PLATFORM_ADMIN_ROLES].sort()).toEqual(['admin', 'owner'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- platform-admin`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Add the shared constant + role group**

Append to `packages/shared/src/types/index.ts`:
```ts
/**
 * The WM-Consulting operator org — the E-Site platform admin. This org already
 * bypasses every has_feature/seat gate (migrations 00097/00125). A caller is a
 * platform admin iff they hold an owner/admin membership of THIS org.
 */
export const PLATFORM_ADMIN_ORG_ID = 'dddddddd-0000-0000-0000-000000000001'
/** Roles within the operator org that grant platform-admin console access. */
export const PLATFORM_ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin']
```

- [ ] **Step 4: Run test green**

Run: `pnpm --filter @esite/shared test -- platform-admin`
Expected: PASS.

- [ ] **Step 5: Write the DB migration (helper + audit log)**

```sql
-- apps/edge-functions/supabase/migrations/00216_platform_admin_and_audit.sql
-- E-Site platform-admin capability + admin action audit log.
-- Platform admin = owner/admin membership of the WM-Consulting operator org
-- (dddddddd-0000-0000-0000-000000000001), which already bypasses has_feature.

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organisations m
    WHERE m.user_id = p_uid
      AND m.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
      AND m.role IN ('owner', 'admin')
      AND m.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

-- Audit trail for every platform-admin action (suspend, refund, commission edit…).
CREATE TABLE IF NOT EXISTS marketplace.admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID NOT NULL REFERENCES public.profiles(id),
  action       TEXT NOT NULL,     -- supplier_suspend | supplier_flag | supplier_reinstate
                                   -- | refund_approve | dispute_resolve | commission_config_update
  entity_type  TEXT NOT NULL,     -- supplier | order | dispute | commission_config
  entity_id    UUID,
  detail       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON marketplace.admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON marketplace.admin_audit_log(created_at DESC);

ALTER TABLE marketplace.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- Platform admins read; writes happen via service-role server actions only
-- (no INSERT/UPDATE/DELETE policy → clients cannot write).
CREATE POLICY "admin_audit_read" ON marketplace.admin_audit_log
  FOR SELECT USING (public.is_platform_admin());

NOTIFY pgrst, 'reload schema';
```
**Note:** `marketplace` schema already exists (00005), so this only needs `NOTIFY pgrst` — not a PostgREST `db_schema` config PATCH.

- [ ] **Step 6: Add the web gates + audit helper**

In `apps/web/src/lib/auth/require-role.ts` (read the file first to match the return shapes of `requireRolePage`/`requireRoleAPI`), add:
```ts
import { PLATFORM_ADMIN_ORG_ID, PLATFORM_ADMIN_ROLES } from '@esite/shared'

/** True iff the current user is an owner/admin of the WM-Consulting operator org. */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', PLATFORM_ADMIN_ORG_ID)
    .eq('is_active', true)
    .maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return !!role && (PLATFORM_ADMIN_ROLES as readonly string[]).includes(role)
}

/** Server-component gate: redirect non-platform-admins away from the admin console. */
export async function requirePlatformAdminPage(redirectTo = '/dashboard'): Promise<void> {
  if (!(await isPlatformAdmin())) redirect(redirectTo)
}

/** Route-handler gate: 403 for non-platform-admins. */
export async function requirePlatformAdminAPI(): Promise<null | NextResponse> {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
```
(Match the file's existing imports for `createClient`, `redirect`, `NextResponse`.)

Then the audit-write helper:
```ts
// apps/web/src/lib/marketplace-audit.ts
import { createServiceRoleClient } from '@/lib/supabase/service' // read the repo's service-role factory name first

export async function writeAdminAudit(input: {
  actorId: string
  action: string
  entityType: 'supplier' | 'order' | 'dispute' | 'commission_config'
  entityId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  try {
    const svc = createServiceRoleClient()
    await (svc as any).schema('marketplace').from('admin_audit_log').insert({
      actor_id: input.actorId, action: input.action, entity_type: input.entityType,
      entity_id: input.entityId ?? null, detail: input.detail ?? {},
    })
  } catch (e) {
    console.error('[admin-audit] failed', { action: input.action, err: String(e) })
  }
}
```
**Verification note:** confirm the repo's service-role client factory name/path (grep `SUPABASE_SERVICE_ROLE_KEY` in `apps/web/src/lib/supabase`) and the `marketplace` schema-access cast pattern used by existing marketplace reads; align the import + `.schema('marketplace')` usage.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/edge-functions/supabase/migrations/00216_platform_admin_and_audit.sql packages/shared/src/types/index.ts packages/shared/src/__tests__/marketplace/platform-admin.test.ts apps/web/src/lib/auth/require-role.ts apps/web/src/lib/marketplace-audit.ts
git commit -m "feat(marketplace): platform-admin capability + admin audit log (00216)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Supplier moderation console + directory visibility (migration 00217)

Suppliers are instantly live (decision #3), so the platform needs a suspend/flag control that removes a supplier from the buyer directory. Adds the moderation table, a suspended-supplier directory filter, the admin moderation page + action (audited, emails the supplier), and a "new supplier" trust indicator.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00217_supplier_moderation.sql`
- Create: `apps/web/src/app/(admin)/marketplace/admin/layout.tsx` (platform-admin gate for the whole console)
- Create: `apps/web/src/app/(admin)/marketplace/admin/moderation/page.tsx`
- Create: `apps/web/src/app/(admin)/marketplace/admin/moderation/ModerationActions.tsx`
- Create: `apps/web/src/actions/marketplace-admin.actions.ts` (`setSupplierModerationAction`)
- Test: `apps/web/src/actions/__tests__/supplierModeration.test.ts`
- Modify: the buyer directory read (`supplierService.listAll` in `@esite/shared` or `(admin)/marketplace/page.tsx`) to exclude suspended suppliers + show a "New" badge

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00217_supplier_moderation.sql
-- Supplier moderation state (suspend/flag despite self-serve instant-live).
CREATE TABLE IF NOT EXISTS marketplace.supplier_moderation (
  supplier_id   UUID PRIMARY KEY REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'flagged', 'suspended')),
  reason        TEXT,
  moderated_by  UUID REFERENCES public.profiles(id),
  moderated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER supplier_moderation_updated_at
  BEFORE UPDATE ON marketplace.supplier_moderation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE marketplace.supplier_moderation ENABLE ROW LEVEL SECURITY;
-- Platform admins read/write; a supplier may read its own status (portal banner).
CREATE POLICY "moderation_admin_all" ON marketplace.supplier_moderation
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "moderation_supplier_read_own" ON marketplace.supplier_moderation
  FOR SELECT USING (
    supplier_id IN (
      SELECT s.id FROM suppliers.suppliers s
      WHERE s.organisation_id = ANY (public.get_user_org_ids())
    )
  );

-- Directory-visibility helper: TRUE when a supplier is suspended (hidden from buyers).
CREATE OR REPLACE FUNCTION marketplace.supplier_is_suspended(p_supplier_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = marketplace, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace.supplier_moderation m
    WHERE m.supplier_id = p_supplier_id AND m.status = 'suspended'
  );
$$;
GRANT EXECUTE ON FUNCTION marketplace.supplier_is_suspended(UUID) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
```
**Verification note:** confirm `public.get_user_org_ids()` exists (used by node_orders/orders RLS). If the helper is named differently, use the repo's actual org-ids helper.

- [ ] **Step 2: Write the failing action gate test**

```ts
// apps/web/src/actions/__tests__/supplierModeration.test.ts
// Mirror the existing route/action-gate harness (see memory e2e-test-cookie-gated-routes
// and the tenant/cable gate tests). Assert:
//  - a non-platform-admin caller (org owner of a NON-operator org) is rejected by
//    setSupplierModerationAction with { error } and writes nothing;
//  - a WM-Consulting owner/admin caller succeeds, upserts status='suspended',
//    and an audit row + supplier email are dispatched (mock writeAdminAudit +
//    notifyMarketplaceOrg / sendMarketplaceEmail).
```
(Flesh out with the repo's server-action test mocks — read a sibling action test to match the Supabase-client mock style before writing.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- supplierModeration`
Expected: FAIL — `setSupplierModerationAction` not found.

- [ ] **Step 4: Implement the moderation action**

```ts
// apps/web/src/actions/marketplace-admin.actions.ts  (new file, 'use server')
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/auth/require-role'
import { writeAdminAudit } from '@/lib/marketplace-audit'
import { notifyMarketplaceOrg } from '@/lib/marketplace-notify'
import { renderBankVerifiedEmail } from '@esite/shared' // placeholder import line — see note

const ModerationSchema = z.object({
  supplierId: z.string().uuid(),
  status: z.enum(['active', 'flagged', 'suspended']),
  reason: z.string().max(500).optional(),
})

export async function setSupplierModerationAction(input: z.infer<typeof ModerationSchema>) {
  const parsed = ModerationSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid input.' }
  if (!(await isPlatformAdmin())) return { error: 'Not authorised.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { error } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_moderation')
    .upsert(
      { supplier_id: parsed.data.supplierId, status: parsed.data.status,
        reason: parsed.data.reason ?? null, moderated_by: user.id, moderated_at: new Date().toISOString() },
      { onConflict: 'supplier_id' },
    )
  if (error) return { error: 'Could not update moderation status.' }

  await writeAdminAudit({
    actorId: user.id,
    action: parsed.data.status === 'suspended' ? 'supplier_suspend'
      : parsed.data.status === 'flagged' ? 'supplier_flag' : 'supplier_reinstate',
    entityType: 'supplier', entityId: parsed.data.supplierId,
    detail: { status: parsed.data.status, reason: parsed.data.reason ?? null },
  })

  // Notify the supplier org (best-effort). Resolve its org id + name, then email.
  // (Use a plain sendMarketplaceEmail with a short status message; a dedicated
  // renderer is optional — the moderation notice is admin↔supplier, not in §10.)

  revalidatePath('/marketplace/admin/moderation')
  return { success: true }
}
```
**Note:** the `renderBankVerifiedEmail` import above is a **placeholder to delete** — the moderation notice is not one of the 14 §10 events; send a short inline `base`-styled message via `sendMarketplaceEmail`, or add a small `renderModerationNoticeEmail` to `marketplace-email.ts` if you prefer a typed renderer (then also bump the registry comment — it is admin↔supplier, kept out of the 14-count). Use `onConflict: 'supplier_id'` **as an HTTP `Prefer: resolution=merge-duplicates` header** — Supabase-js `.upsert()` sends this automatically, but confirm (see memory `postgrest-upsert-prefer-header`; assert the merge in a test if using raw PostgREST).

- [ ] **Step 5: Build the admin console shell + moderation page**

Create `apps/web/src/app/(admin)/marketplace/admin/layout.tsx` — the single gate for the whole platform-admin console:
```tsx
import { requirePlatformAdminPage } from '@/lib/auth/require-role'
export default async function MarketplaceAdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdminPage()
  return <>{children}</>
}
```
Create `moderation/page.tsx` (RSC): list suppliers with their moderation status + a "New" indicator (created within N days, from `suppliers.suppliers.created_at`), using the E-Site `Card/CardHeader/CardBody` + badge variants (`success` active, `warning` flagged, `danger` suspended). `ModerationActions.tsx` is a client component calling `setSupplierModerationAction` (suspend/flag/reinstate + reason). Follow the existing `(admin)/marketplace/page.tsx` styling conventions.

- [ ] **Step 6: Hide suspended suppliers from the buyer directory + add the "new" badge**

In the buyer directory read path (`supplierService.listAll` in `@esite/shared`, or the query in `(admin)/marketplace/page.tsx` — read which one owns the list), exclude suppliers where `supplier_is_suspended(id)` is true (LEFT JOIN `marketplace.supplier_moderation` and filter `status IS DISTINCT FROM 'suspended'`), and surface a `NEW` badge for suppliers created within 30 days (trust indicator, spec §11 abuse/trust). Add a unit test for the filter predicate if `listAll` gains a pure helper.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter web test -- supplierModeration && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS. Then with the **run** skill, sign in as a WM-Consulting admin, suspend a test supplier, and confirm it disappears from the buyer directory; sign in as a non-operator admin and confirm `/marketplace/admin/moderation` redirects to `/dashboard`.
```bash
git add apps/edge-functions/supabase/migrations/00217_supplier_moderation.sql "apps/web/src/app/(admin)/marketplace/admin" apps/web/src/actions/marketplace-admin.actions.ts apps/web/src/actions/__tests__/supplierModeration.test.ts
git commit -m "feat(marketplace): supplier moderation console + directory visibility (00217)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Commission config editor (migration 00218)

Single source of truth for the commission rate (spec §6.5): a platform default (5%, seeded) plus optional per-supplier / per-category overrides, a resolver used by pricing/checkout/webhook, and a platform-admin editor.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00218_commission_config.sql`
- Create: `apps/web/src/app/(admin)/marketplace/admin/commission/page.tsx`
- Create: `apps/web/src/app/(admin)/marketplace/admin/commission/CommissionConfigForm.tsx`
- Modify: `apps/web/src/actions/marketplace-admin.actions.ts` (`upsertCommissionConfigAction`)
- Test: `packages/shared/src/__tests__/marketplace/commission-resolve.test.ts` (resolver precedence)

- [ ] **Step 1: Write the migration**

```sql
-- apps/edge-functions/supabase/migrations/00218_commission_config.sql
-- Single-source commission config: platform default + per-supplier/-category overrides.
CREATE TABLE IF NOT EXISTS marketplace.commission_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('platform', 'supplier', 'category')),
  supplier_id UUID REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
  category    TEXT,
  rate        NUMERIC(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Exactly one active platform default; one active override per supplier / category.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_platform
  ON marketplace.commission_config(scope) WHERE scope = 'platform' AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_supplier
  ON marketplace.commission_config(supplier_id) WHERE scope = 'supplier' AND is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_category
  ON marketplace.commission_config(category) WHERE scope = 'category' AND is_active;
CREATE TRIGGER commission_config_updated_at
  BEFORE UPDATE ON marketplace.commission_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the platform default at 5% (master spec D5) if none active.
INSERT INTO marketplace.commission_config (scope, rate)
  SELECT 'platform', 0.0500
  WHERE NOT EXISTS (
    SELECT 1 FROM marketplace.commission_config WHERE scope = 'platform' AND is_active
  );

-- Resolver: supplier override > category override > platform default > 0.05 fallback.
CREATE OR REPLACE FUNCTION marketplace.commission_rate_for(p_supplier_id UUID, p_category TEXT DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = marketplace, public AS $$
  SELECT COALESCE(
    (SELECT rate FROM marketplace.commission_config WHERE scope = 'supplier' AND supplier_id = p_supplier_id AND is_active LIMIT 1),
    (SELECT rate FROM marketplace.commission_config WHERE scope = 'category' AND category = p_category AND is_active LIMIT 1),
    (SELECT rate FROM marketplace.commission_config WHERE scope = 'platform' AND is_active LIMIT 1),
    0.0500
  );
$$;
GRANT EXECUTE ON FUNCTION marketplace.commission_rate_for(UUID, TEXT) TO authenticated, service_role;

ALTER TABLE marketplace.commission_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_config_admin_all" ON marketplace.commission_config
  FOR ALL USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
-- Authenticated read (pricing/checkout need the rate); no anon.
CREATE POLICY "commission_config_read" ON marketplace.commission_config
  FOR SELECT USING (auth.role() = 'authenticated');

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing resolver-precedence test (pure, shared)**

Add a pure helper `resolveCommissionRate(config, { supplierId, category })` to `packages/shared/src/marketplace/commission-config.ts` mirroring the SQL precedence (so the app can resolve client-side for previews and it is unit-testable without a DB), and test it:
```ts
// packages/shared/src/__tests__/marketplace/commission-resolve.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCommissionRate } from '../../marketplace/commission-config'

const cfg = [
  { scope: 'platform', rate: 0.05, is_active: true },
  { scope: 'category', category: 'electrical', rate: 0.04, is_active: true },
  { scope: 'supplier', supplier_id: 's1', rate: 0.03, is_active: true },
] as const

describe('resolveCommissionRate', () => {
  it('supplier override wins', () => {
    expect(resolveCommissionRate(cfg, { supplierId: 's1', category: 'electrical' })).toBe(0.03)
  })
  it('category override applies when no supplier override', () => {
    expect(resolveCommissionRate(cfg, { supplierId: 's2', category: 'electrical' })).toBe(0.04)
  })
  it('falls back to platform default', () => {
    expect(resolveCommissionRate(cfg, { supplierId: 's2', category: 'civil' })).toBe(0.05)
  })
  it('falls back to 0.05 when config is empty', () => {
    expect(resolveCommissionRate([], { supplierId: 's2', category: 'civil' })).toBe(0.05)
  })
})
```

- [ ] **Step 3: Run to fail, implement, run to pass**

Run: `pnpm --filter @esite/shared test -- commission-resolve` → FAIL (module missing). Implement `resolveCommissionRate` (same precedence as the SQL; only `is_active` rows), export from `packages/shared/src/index.ts`, then re-run → PASS (4 tests).

- [ ] **Step 4: Build the editor page + action**

Add `upsertCommissionConfigAction` to `marketplace-admin.actions.ts` (Zod: `scope`/`supplierId?`/`category?`/`rate` 0–1; `isPlatformAdmin()` gate; `.schema('marketplace').from('commission_config').upsert(...)`; audit `commission_config_update`; deactivate the prior active row for that scope key in the same call). Build `commission/page.tsx` (list active configs + effective platform rate) and `CommissionConfigForm.tsx` (add/override; category from `MARKETPLACE_CATEGORIES`). E-Site card/badge styling.

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS.
```bash
git add apps/edge-functions/supabase/migrations/00218_commission_config.sql packages/shared/src/marketplace/commission-config.ts packages/shared/src/__tests__/marketplace/commission-resolve.test.ts packages/shared/src/index.ts "apps/web/src/app/(admin)/marketplace/admin/commission" apps/web/src/actions/marketplace-admin.actions.ts
git commit -m "feat(marketplace): commission config table + resolver + admin editor (00218)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **Cross-phase note:** Phase 2's checkout/webhook should resolve the rate via `marketplace.commission_rate_for(...)` instead of the hardcoded `DEFAULT_COMMISSION_RATE`. Task 10's sweep greps for remaining hardcoded rates and records remediation; if Phase 2 already wired it, no change.

---

## Task 6: Dispute / refund mediation queue

Admin console over the Phase-2 `order_disputes` + `refunds` tables: a mediation queue, resolve-dispute + approve-refund actions (audited), and the §10 refund + dispute emails to buyer/supplier/admin.

**Files:**
- Create: `apps/web/src/app/(admin)/marketplace/admin/disputes/page.tsx`
- Create: `apps/web/src/app/(admin)/marketplace/admin/disputes/DisputeMediation.tsx`
- Modify: `apps/web/src/actions/marketplace-admin.actions.ts` (`resolveDisputeAction`, `approveRefundAction`)
- Test: `apps/web/src/actions/__tests__/disputeMediation.test.ts`

- [ ] **Step 1: Confirm the Phase-2 dispute/refund schema (no code yet)**

Read the Phase-2 migration(s) for `order_disputes` / `refunds` column names (status, order_id, amount, resolution). **If Phase 2 has not shipped them yet**, this task's Step 1 becomes: add a guarded migration `00218b`→ renumber to keep 00216–00220 (or fold minimal `order_disputes`/`refunds` DDL here) with RLS mirroring `marketplace.orders` (buyer/supplier org read; platform-admin all; service-role write on `refunds`). Record which path was taken in the PR + Task 10 sweep.

- [ ] **Step 2: Write the failing action-gate test**

```ts
// apps/web/src/actions/__tests__/disputeMediation.test.ts
// Assert: approveRefundAction rejects a non-platform-admin; a WM-Consulting admin
// succeeds → updates orders.payment_status='refunded' + refunds row + commission
// record 'refunded' + emits refund emails to BOTH buyer and supplier (mock
// notifyMarketplaceOrg/sendMarketplaceEmail) + writes an audit row.
```

- [ ] **Step 3: Run to fail**

Run: `pnpm --filter web test -- disputeMediation` → FAIL.

- [ ] **Step 4: Implement the mediation actions**

`resolveDisputeAction({ disputeId, resolution })` and `approveRefundAction({ orderId, amountCents, reason })` in `marketplace-admin.actions.ts`: `isPlatformAdmin()` gate; server-compute the refund amount (never trust client); update the Phase-2 tables + `orders.payment_status`/`commission_records.payout_status='refunded'`; write audit; then emit emails via the shared renderers:
```ts
import { renderRefundEmail, renderDisputeEmail } from '@esite/shared'
// buyer + supplier:
await notifyMarketplaceOrg({ orgId: buyerOrgId, actorId: null,
  bell: { title: 'Refund issued', body: orderNumber, route: `/marketplace/orders/${orderId}`, type: 'marketplace_refund' },
  email: renderRefundEmail({ orderNumber, amountCents, recipient: 'buyer', siteUrl }) })
await notifyMarketplaceOrg({ orgId: supplierOrgId, actorId: null,
  bell: { title: 'Refund issued', body: orderNumber, route: `/supplier/orders/${orderId}`, type: 'marketplace_refund' },
  email: renderRefundEmail({ orderNumber, amountCents, recipient: 'supplier', siteUrl }) })
```
**Note (R4/refund-reversal):** actual Paystack refund/split-reversal is a Phase-2 concern; if the Phase-2 refund edge path exists, call it; otherwise this action records the manual refund state + emails and the PR notes the Paystack-side step is manual (spec §6.3 "v1 manual"). Keep money in cents; `orders.total_amount` is rand — convert with `randToCents`.

- [ ] **Step 5: Build the queue page**

`disputes/page.tsx` (RSC): open disputes + refundable orders, buyer/supplier/amount/age, using card/badge styling. `DisputeMediation.tsx`: resolve + approve-refund controls (two-step confirm for the irreversible refund, matching the app's inline-confirm pattern).

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter web test -- disputeMediation && pnpm --filter web type-check && pnpm --filter web lint` → PASS.
```bash
git add "apps/web/src/app/(admin)/marketplace/admin/disputes" apps/web/src/actions/marketplace-admin.actions.ts apps/web/src/actions/__tests__/disputeMediation.test.ts
git commit -m "feat(marketplace): dispute/refund mediation queue + emails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Low-stock / out-of-stock alerts (migration 00219)

Supplier gets an email + bell when a catalogue item crosses its low-stock threshold or hits zero, deduped so a stalled item isn't re-alerted every decrement (mirrors `email_sequence_events` dedup thinking).

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00219_stock_alerts.sql`
- Create: `packages/shared/src/marketplace/stock-alerts.ts` (pure evaluator)
- Test: `packages/shared/src/__tests__/marketplace/stock-alerts.test.ts`
- Create: `apps/web/src/lib/marketplace-stock.ts` (`maybeSendStockAlerts(supabase, itemId)`)
- Modify: the inventory-decrement call site (Phase-2 `paystack-webhook` post-decrement block, and any Phase-3 fulfilment decrement) to call `maybeSendStockAlerts`

- [ ] **Step 1: Write the migration (alert-state columns)**

```sql
-- apps/edge-functions/supabase/migrations/00219_stock_alerts.sql
-- Low-stock alerting state on catalogue items (dedup so we alert once per crossing).
-- Depends on Phase 1's stock_on_hand/track_inventory columns.
ALTER TABLE marketplace.catalogue_items
  ADD COLUMN IF NOT EXISTS low_stock_threshold  INTEGER,                       -- supplier reorder point (null = disabled)
  ADD COLUMN IF NOT EXISTS low_stock_alerted    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS out_of_stock_alerted BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
```
**Cross-phase note:** if `stock_on_hand`/`track_inventory` don't yet exist (Phase 1 not merged), add them here too (`ADD COLUMN IF NOT EXISTS stock_on_hand INTEGER`, `track_inventory BOOLEAN NOT NULL DEFAULT FALSE`) and record it in the PR so Phase 1 can reconcile (`IF NOT EXISTS` makes it idempotent).

- [ ] **Step 2: Write the failing evaluator test**

```ts
// packages/shared/src/__tests__/marketplace/stock-alerts.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateStockAlerts } from '../../marketplace/stock-alerts'

describe('evaluateStockAlerts', () => {
  const base = { trackInventory: true, threshold: 5, lowAlerted: false, outAlerted: false }
  it('fires out_of_stock when stock hits zero (once)', () => {
    expect(evaluateStockAlerts({ ...base, stockOnHand: 0 })).toEqual({ fire: 'out_of_stock', setLowAlerted: true, setOutAlerted: true })
  })
  it('fires low_stock when at/below threshold but above zero', () => {
    expect(evaluateStockAlerts({ ...base, stockOnHand: 4 })).toEqual({ fire: 'low_stock', setLowAlerted: true, setOutAlerted: false })
  })
  it('does not re-fire low_stock if already alerted', () => {
    expect(evaluateStockAlerts({ ...base, stockOnHand: 4, lowAlerted: true })).toEqual({ fire: null, setLowAlerted: true, setOutAlerted: false })
  })
  it('clears alerts when restocked above threshold', () => {
    expect(evaluateStockAlerts({ ...base, stockOnHand: 20, lowAlerted: true, outAlerted: true })).toEqual({ fire: null, setLowAlerted: false, setOutAlerted: false })
  })
  it('never fires when inventory is not tracked or threshold is null', () => {
    expect(evaluateStockAlerts({ ...base, trackInventory: false, stockOnHand: 0 }).fire).toBeNull()
    expect(evaluateStockAlerts({ ...base, threshold: null, stockOnHand: 0 }).fire).toBeNull()
  })
})
```

- [ ] **Step 3: Run to fail, implement, run to pass**

Run: `pnpm --filter @esite/shared test -- stock-alerts` → FAIL. Implement:
```ts
// packages/shared/src/marketplace/stock-alerts.ts
export interface StockAlertState {
  trackInventory: boolean
  threshold: number | null
  stockOnHand: number
  lowAlerted?: boolean
  outAlerted?: boolean
}
export interface StockAlertResult {
  fire: 'low_stock' | 'out_of_stock' | null
  setLowAlerted: boolean
  setOutAlerted: boolean
}
/** Pure crossing evaluator: fire once per crossing, clear when restocked. */
export function evaluateStockAlerts(s: StockAlertState): StockAlertResult {
  if (!s.trackInventory || s.threshold == null) {
    return { fire: null, setLowAlerted: false, setOutAlerted: false }
  }
  const low = s.stockOnHand <= s.threshold
  const out = s.stockOnHand <= 0
  if (!low) return { fire: null, setLowAlerted: false, setOutAlerted: false } // restocked → clear
  if (out) {
    return { fire: s.outAlerted ? null : 'out_of_stock', setLowAlerted: true, setOutAlerted: true }
  }
  return { fire: s.lowAlerted ? null : 'low_stock', setLowAlerted: true, setOutAlerted: false }
}
```
Export from `packages/shared/src/index.ts`; re-run → PASS (5 tests).

- [ ] **Step 4: Implement the DB-backed emitter + wire it in**

```ts
// apps/web/src/lib/marketplace-stock.ts
import { evaluateStockAlerts } from '@esite/shared'
import { renderLowStockEmail } from '@esite/shared'
import { notifyMarketplaceOrg } from '@/lib/marketplace-notify'
import { getSiteUrl } from '@/lib/site-url' // read the repo's site-url helper name first

/** Call after any stock mutation. Reads the item, evaluates, fires once, persists flags. */
export async function maybeSendStockAlerts(svc: any, itemId: string): Promise<void> {
  try {
    const { data: item } = await svc.schema('marketplace').from('catalogue_items')
      .select('id, name, supplier_org_id, stock_on_hand, track_inventory, low_stock_threshold, low_stock_alerted, out_of_stock_alerted')
      .eq('id', itemId).maybeSingle()
    if (!item) return
    const r = evaluateStockAlerts({
      trackInventory: item.track_inventory, threshold: item.low_stock_threshold,
      stockOnHand: item.stock_on_hand ?? 0, lowAlerted: item.low_stock_alerted, outAlerted: item.out_of_stock_alerted,
    })
    // Persist flag transitions even when not firing (so restock clears them).
    if (r.setLowAlerted !== item.low_stock_alerted || r.setOutAlerted !== item.out_of_stock_alerted) {
      await svc.schema('marketplace').from('catalogue_items')
        .update({ low_stock_alerted: r.setLowAlerted, out_of_stock_alerted: r.setOutAlerted }).eq('id', itemId)
    }
    if (r.fire && item.supplier_org_id) {
      const email = renderLowStockEmail({ itemName: item.name, kind: r.fire, stockOnHand: item.stock_on_hand ?? 0, itemId: item.id, siteUrl: getSiteUrl() })
      await notifyMarketplaceOrg({
        orgId: item.supplier_org_id, actorId: null,
        bell: { title: email.subject, body: item.name, route: `/supplier/catalogue/${item.id}`, type: 'marketplace_stock' },
        email,
      })
    }
  } catch (e) {
    console.error('[stock-alert] failed', { itemId, err: String(e) })
  }
}
```
Wire `maybeSendStockAlerts(svc, itemId)` into the guaranteed decrement site — the Phase-2 `paystack-webhook` inventory-decrement block (for each paid order item) — and any Phase-3 fulfilment decrement. **Cross-phase note:** the webhook is a Deno edge fn, so port `evaluateStockAlerts` inline there (it's pure) or, preferred, call this from the web-side post-payment reconcile if one exists. Record the exact call site in the PR + Task 10 sweep.
**Verification note:** confirm the repo's `getSiteUrl`/site-url helper and the service-role client factory before finalising imports.

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint` → PASS.
```bash
git add apps/edge-functions/supabase/migrations/00219_stock_alerts.sql packages/shared/src/marketplace/stock-alerts.ts packages/shared/src/__tests__/marketplace/stock-alerts.test.ts packages/shared/src/index.ts apps/web/src/lib/marketplace-stock.ts
git commit -m "feat(marketplace): low-stock/out-of-stock supplier alerts (00219)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Marketplace analytics dashboard (migration 00220)

Server-aggregated GMV, commission earned, paid-order count, GMV-by-day, and top suppliers — surfaced as inline-SVG charts following the **dataviz** approach (brand-neutral CSS-var palette, theme-aware light/dark, accessible). Platform-admin only.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00220_marketplace_analytics_rpc.sql`
- Create: `packages/shared/src/marketplace/analytics.ts` (pure chart-data transform)
- Test: `packages/shared/src/__tests__/marketplace/analytics.test.ts`
- Create: `apps/web/src/app/(admin)/marketplace/admin/analytics/page.tsx`
- Create: `apps/web/src/app/(admin)/marketplace/admin/analytics/AnalyticsCharts.tsx` (SVG bar/line)

- [ ] **Step 1: Write the aggregation RPC migration**

```sql
-- apps/edge-functions/supabase/migrations/00220_marketplace_analytics_rpc.sql
-- Platform-admin marketplace analytics aggregation. Money in kobo/cents.
CREATE OR REPLACE FUNCTION marketplace.admin_analytics(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = marketplace, public AS $$
DECLARE v JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'gmv_cents',        COALESCE((SELECT SUM(gross_amount_kobo) FROM marketplace.commission_records
                                   WHERE created_at::date BETWEEN p_from AND p_to), 0),
    'commission_cents', COALESCE((SELECT SUM(commission_kobo) FROM marketplace.commission_records
                                   WHERE created_at::date BETWEEN p_from AND p_to), 0),
    'orders_paid',      COALESCE((SELECT COUNT(*) FROM marketplace.orders
                                   WHERE payment_status = 'paid' AND paid_at::date BETWEEN p_from AND p_to), 0),
    'gmv_by_day',       COALESCE((
        SELECT jsonb_agg(row ORDER BY (row->>'day'))
        FROM (
          SELECT jsonb_build_object('day', created_at::date,
                                    'gmv_cents', SUM(gross_amount_kobo),
                                    'commission_cents', SUM(commission_kobo)) AS row
          FROM marketplace.commission_records
          WHERE created_at::date BETWEEN p_from AND p_to
          GROUP BY created_at::date
        ) s), '[]'::jsonb),
    'top_suppliers',    COALESCE((
        SELECT jsonb_agg(row)
        FROM (
          SELECT jsonb_build_object('supplier_org_id', cr.supplier_org_id, 'name', COALESCE(o.name, 'Unknown'),
                                    'gmv_cents', SUM(cr.gross_amount_kobo), 'orders', COUNT(*)) AS row
          FROM marketplace.commission_records cr
          LEFT JOIN public.organisations o ON o.id = cr.supplier_org_id
          WHERE cr.created_at::date BETWEEN p_from AND p_to
          GROUP BY cr.supplier_org_id, o.name
          ORDER BY SUM(cr.gross_amount_kobo) DESC
          LIMIT 10
        ) s), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION marketplace.admin_analytics(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace.admin_analytics(DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Prove the auth guard (rolled-back RED→GREEN probe)**

Using the `rolled-back-prod-red-green-probe` pattern (memory), in one transaction: call `marketplace.admin_analytics` as a non-operator user (expect `42501`), then as a WM-Consulting admin (expect a JSON object). This proves the `SECURITY DEFINER` gate before relying on it. (No local Docker needed — one DO-block txn against prod, `RAISE` to roll back.)

- [ ] **Step 3: Write the failing chart-transform test**

```ts
// packages/shared/src/__tests__/marketplace/analytics.test.ts
import { describe, it, expect } from 'vitest'
import { buildAnalyticsView } from '../../marketplace/analytics'

const raw = {
  gmv_cents: 1000000, commission_cents: 50000, orders_paid: 12,
  gmv_by_day: [{ day: '2026-07-01', gmv_cents: 400000, commission_cents: 20000 },
               { day: '2026-07-02', gmv_cents: 600000, commission_cents: 30000 }],
  top_suppliers: [{ supplier_org_id: 's1', name: 'Acme', gmv_cents: 700000, orders: 8 }],
}

describe('buildAnalyticsView', () => {
  it('formats totals as ZAR from cents', () => {
    const v = buildAnalyticsView(raw)
    expect(v.totals.gmv).toBe('R 10 000,00')
    expect(v.totals.commission).toBe('R 500,00')
    expect(v.totals.ordersPaid).toBe(12)
  })
  it('produces a day series with scaled bar heights (0..1)', () => {
    const v = buildAnalyticsView(raw)
    expect(v.daySeries.map((d) => d.day)).toEqual(['2026-07-01', '2026-07-02'])
    expect(v.daySeries[1].scale).toBe(1)     // max day
    expect(v.daySeries[0].scale).toBeCloseTo(0.6667, 3)
  })
  it('handles an empty range without dividing by zero', () => {
    const v = buildAnalyticsView({ gmv_cents: 0, commission_cents: 0, orders_paid: 0, gmv_by_day: [], top_suppliers: [] })
    expect(v.daySeries).toEqual([])
    expect(v.totals.gmv).toBe('R 0,00')
  })
})
```

- [ ] **Step 4: Run to fail, implement, run to pass**

Run: `pnpm --filter @esite/shared test -- analytics` → FAIL. Implement `buildAnalyticsView(raw)` in `packages/shared/src/marketplace/analytics.ts` (uses `formatZARFromCents`; computes each day's `scale = gmv_cents / maxGmvCents` guarding max=0; passes top suppliers through with formatted GMV). Export from index; re-run → PASS (3 tests). Align the ZAR assertions to the real `formatZARFromCents` glyph if needed.

- [ ] **Step 5: Build the dashboard page + SVG charts (dataviz approach)**

`analytics/page.tsx` (RSC): parse a date range (`?from&to`, default last 30 days), call `supabase.rpc('admin_analytics', { p_from, p_to })` (schema `marketplace`), pass through `buildAnalyticsView`, render KPI tiles (GMV, commission, orders) + `AnalyticsCharts`. `AnalyticsCharts.tsx` renders **inline SVG** (no external chart lib) per the dataviz rules: a GMV-by-day bar chart + a top-suppliers ranked bar list, colors from the app's CSS vars (`var(--c-amber)`, `var(--c-panel)`, `var(--c-border)`, `var(--c-text-mid)`) so it is theme-aware in light/dark; every bar has a `<title>`/`aria-label` for accessibility; wide charts sit in an `overflow-x:auto` container. Follow the **dataviz** skill's form heuristic (bars for categorical/day series) and one-system palette; do not introduce a new color system — reuse the E-Site tokens.

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web lint` → PASS. Then with the **run** skill, load `/marketplace/admin/analytics` as a WM-Consulting admin and confirm KPIs + charts render in both light and dark; confirm a non-operator admin is redirected.
```bash
git add apps/edge-functions/supabase/migrations/00220_marketplace_analytics_rpc.sql packages/shared/src/marketplace/analytics.ts packages/shared/src/__tests__/marketplace/analytics.test.ts packages/shared/src/index.ts "apps/web/src/app/(admin)/marketplace/admin/analytics"
git commit -m "feat(marketplace): platform analytics dashboard + aggregation RPC (00220)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Monthly commission statement + payout/settlement emails

Completes the last two §10 email rows the earlier phases don't own: the monthly commission **statement** (PDF attached, aggregated from `commission_records`) and the **payout / payout-failed** emails wired into the webhook `transfer.*` branch. Also adds the payout/settlement reconciliation view for admins.

**Files:**
- Create: `apps/web/src/lib/marketplace/render-commission-statement.ts` (pdf-lib, mirrors `render-legend-card.ts`)
- Create: `apps/web/src/lib/marketplace/render-commission-statement.test.ts`
- Create: `apps/web/src/app/(admin)/marketplace/admin/payouts/page.tsx` (reconciliation view)
- Modify: `apps/edge-functions/supabase/functions/paystack-webhook/index.ts` (`transfer.success`/`transfer.failed` → payout emails via the shared renderers)
- Create/modify: a monthly statement trigger — `apps/edge-functions/supabase/functions/marketplace-statement-cron/index.ts` OR an admin "Generate statement" action (see Step 4)

- [ ] **Step 1: Write the failing statement-PDF test**

```ts
// apps/web/src/lib/marketplace/render-commission-statement.test.ts
import { describe, it, expect } from 'vitest'
import { renderCommissionStatementPdf, computeStatementTotals } from './render-commission-statement'

const rows = [
  { orderNumber: 'ORD-1', date: '2026-07-03', grossCents: 400000, commissionCents: 20000 },
  { orderNumber: 'ORD-2', date: '2026-07-18', grossCents: 600000, commissionCents: 30000 },
]

describe('commission statement', () => {
  it('sums gross + commission exactly (integer cents)', () => {
    const t = computeStatementTotals(rows)
    expect(t.grossCents).toBe(1000000)
    expect(t.commissionCents).toBe(50000)
    expect(t.rowCount).toBe(2)
  })
  it('renders a non-empty PDF for the supplier + period', async () => {
    const bytes = await renderCommissionStatementPdf({
      supplierName: 'Acme Electrical', periodLabel: 'July 2026', rows, generatedAt: '2026-08-01',
    })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(500)
    // pdf-lib documents start with the %PDF- header
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `pnpm --filter web test -- render-commission-statement` → FAIL (module missing).

- [ ] **Step 3: Implement the statement renderer (pdf-lib)**

Model on `apps/web/src/lib/db-legend/render-legend-card.ts` (absolute-coordinate pdf-lib layout, embedded Helvetica, paginated table with repeated header, page numbers). `computeStatementTotals(rows)` sums integer cents; `renderCommissionStatementPdf({ supplierName, periodLabel, rows, generatedAt })` draws a header (supplier, period, E-Site branding), a table (order #, date, gross, commission — formatted with `formatZARFromCents`), and a totals row; returns `Uint8Array`. Keep it pure (caller supplies formatted date), like the legend-card renderer.

- [ ] **Step 4: Wire statement generation + email**

Preferred (deterministic, no new schema): a platform-admin action `generateSupplierStatementAction({ supplierOrgId, from, to })` in `marketplace-admin.actions.ts` that (a) queries `commission_records` for the supplier + period, (b) `computeStatementTotals` + `renderCommissionStatementPdf`, (c) base64-encodes the bytes, (d) emails the supplier via `sendMarketplaceEmail({ to, ...renderCommissionStatementEmail(...), attachments: [{ filename: 'statement.pdf', content: base64 }] })`, (e) writes an audit row. Add a "Generate & send statement" button on the payouts page per supplier + period. **Cross-phase note:** if Phase 4 shipped `supplier_commission_statements` + a monthly cron, reuse that table for idempotency (write a statement row keyed on supplier+period) and skip the ad-hoc action; otherwise the on-demand admin action is the v1 mechanism (spec §6.4 "monthly"). No new migration required — statements aggregate existing `commission_records`.

- [ ] **Step 5: Payout + payout-failed emails in the webhook**

In `paystack-webhook/index.ts`, in the existing `transfer.success` / `transfer.failed` handling (which already updates `commission_records.payout_status`), add the supplier email (payout success) and supplier + platform-admin alert (payout failed) using the shared renderers. Since the webhook is a Deno edge fn, either import the renderers from `@esite/shared` if the edge build resolves it, or inline the same `renderPayoutEmail`/`renderPayoutFailedEmail` HTML (they are pure, no deps beyond `formatZARFromCents`) and POST to `send-email` type `marketplace`. Admin alert recipient = the WM-Consulting org members (resolve via service-role, or a fixed ops address from env). Keep it best-effort.

- [ ] **Step 6: Build the payout reconciliation view**

`payouts/page.tsx` (RSC, platform-admin): list `commission_records` grouped by `payout_status` (pending/processing/paid/failed/refunded) with supplier, gross/commission/supplier split (kobo → `formatZARFromCents`), and totals per status — the settlement reconciliation surface (spec §11). Card/badge styling; failed rows flagged `danger` with the failure reason.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter web test -- render-commission-statement && pnpm --filter web type-check && pnpm --filter web lint` → PASS. With the **run** skill, generate a statement for a test supplier and confirm the PDF downloads/attaches and the totals match `commission_records`.
```bash
git add apps/web/src/lib/marketplace/render-commission-statement.ts apps/web/src/lib/marketplace/render-commission-statement.test.ts "apps/web/src/app/(admin)/marketplace/admin/payouts" apps/web/src/actions/marketplace-admin.actions.ts apps/edge-functions/supabase/functions/paystack-webhook/index.ts
git commit -m "feat(marketplace): commission statement PDF + payout/settlement emails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: RBAC matrix + FINAL cross-program completeness sweep

The single clean sweep: re-run every master checklist from index §3 across the whole marketplace program (Phases 0–5), fix anything missing, update the RBAC matrix, then run the review gates. Each check below is a concrete command; each records remediation if it fails.

**Files:**
- Modify: `docs/rbac-matrix.md`
- (Remediation edits as the sweep finds gaps — scoped to the failing item, each its own commit.)

- [ ] **Step 1: RBAC matrix — itemise every Phase-5 route/action**

Add rows for the platform-admin console (all `owner`/`admin` of WM-Consulting only, everyone else `→ /dashboard`): `/marketplace/admin/moderation`, `/marketplace/admin/commission`, `/marketplace/admin/disputes`, `/marketplace/admin/analytics`, `/marketplace/admin/payouts`; and the actions `setSupplierModerationAction`, `upsertCommissionConfigAction`, `resolveDisputeAction`, `approveRefundAction`, `generateSupplierStatementAction`. Note the platform-admin gate = `requirePlatformAdminPage`/`requirePlatformAdminAPI` (WM-Consulting owner/admin), distinct from org `OWNER_ADMIN`. Add a "Platform admin" note to the Roles legend.

- [ ] **Step 2: Pages inventory check (index §3)**

Confirm every spec route exists, renders, is role-gated, and is in the matrix. Concrete: `find apps/web/src/app -path '*marketplace*' -name page.tsx` and cross-check against the §3 Pages list (supplier: register/profile/banking/settings/catalogue{list,new,edit,media,import}/orders/RFQs/payouts; buyer: directory/storefront/product/cart/checkout/orders/RFQs/disputes; admin: moderation/disputes/commission/payouts/analytics). For each **missing** page, record which phase owns it and whether it shipped; if a Phase-5-owned page is missing, add it. Verify each `(admin)/marketplace/admin/*` page is under the `requirePlatformAdminPage` layout.

- [ ] **Step 3: API / actions inventory check**

`grep -rn 'export async function' apps/web/src/actions/*marketplace* apps/web/src/actions/supplier.actions.ts apps/web/src/actions/rating.actions.ts` and confirm each mutating action starts with a role/ownership gate (`requireRole*`/`isPlatformAdmin`/ownership `.eq(...)`), server-computes money/splits, and never trusts client amounts. Grep for any remaining hardcoded commission rate: `grep -rn '0\.06\|0\.05\|bearer_type' apps packages | grep -iv test` — remediate any that should read `marketplace.commission_rate_for`.

- [ ] **Step 4: Buckets inventory check**

Confirm each bucket exists via migration with storage RLS + PostgREST reload: `catalogue-media` (Phase 1), proof-of-delivery (Phase 3), invoice/statement PDFs (`marketplace-docs`, Phase 2). Concrete: `grep -rn "storage.buckets\|storage.objects" apps/edge-functions/supabase/migrations | grep -i 'catalogue\|delivery\|invoice\|docs\|media'`. For any missing bucket that a shipped flow needs, add a guarded migration (next free number after 00220) creating the bucket + `storage.objects` RLS (owner-write, public/authenticated read as the spec dictates) + `NOTIFY pgrst`. Record it.

- [ ] **Step 5: RLS inventory check**

Every new marketplace table has RLS enabled with policies mirroring the audited patterns; `marketplace.orders` has its DELETE policy + client_viewer exclusion (Phase 0 00174); payment/commission tables are service-role-write. Concrete probe (read-only, Management API): 
```sql
SELECT n.nspname, c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'marketplace' AND c.relkind = 'r'
ORDER BY c.relname;
```
Any table with `relrowsecurity = false` is a finding → add a remediation migration enabling RLS + policies. Confirm `admin_audit_log`/`commission_config`/`supplier_moderation` policies match Tasks 3–5.

- [ ] **Step 6: Emails inventory check (14-row matrix)**

Confirm each spec §10 event has a template + trigger + test. Concrete: `grep -c 'export function render' packages/shared/src/email/marketplace-email.ts` (expect ≥14) and that `MARKETPLACE_EMAIL_EVENTS.length === 14` (Task 1 test). Cross-check each event has a **trigger** call site: `grep -rn 'render\(SupplierWelcome\|BankVerified\|NewOrder\|OrderAccepted\|PaymentReceipt\|OrderDispatched\|DeliveryConfirmed\|Payout\|PayoutFailed\|Refund\|Dispute\|LowStock\|CommissionStatement\|AbandonedCart\)Email' apps` — every renderer used by at least one flow (welcome=Phase 0/registration; bank_verified=Phase 2 banking; new_order/order_accepted=Phase 1/2 order flow; payment_receipt=Phase 2 webhook; dispatched/delivered/delivery_confirmed=Phase 3; payout/payout_failed=Task 9; refund/dispute=Task 6; low_stock=Task 7; commission_statement=Task 9; abandoned_cart=optional, may be unused). For any renderer with **no** trigger call site that a shipped flow needs, wire it (best-effort) in the owning path. Record abandoned_cart as intentionally-optional if not wired.

- [ ] **Step 7: Processes / flows inventory check**

Each flow has ≥1 integration test: signup, catalogue CRUD+media+import, pricing resolution, cart, checkout (pay-now), checkout (terms), settlement, fulfilment, procurement sync, refund/dispute, all emails. Concrete: `find apps -name '*.test.ts' -o -name '*.integration.test.ts' | xargs grep -l 'marketplace\|supplier\|order\|commission\|dispute\|payout'` and map to the flow list. For any flow with **no** test, note the owning phase; add a Phase-5-level integration test for the flows Phase 5 introduced (moderation gate, commission-config resolve, dispute/refund mediation, low-stock, analytics auth, statement).

- [ ] **Step 8: Full test + type + lint gate**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test && turbo run type-check lint`
Expected: all green. Confirm migrations `00216`–`00220` are sequential, each has the correct `NOTIFY pgrst` (none `CREATE`/`DROP`s a schema, so no PostgREST `db_schema` PATCH needed), and any remediation bucket migration (Step 4) is numbered after 00220.

- [ ] **Step 9: Phase gate — reviews**

Run `superpowers:requesting-code-review` on the branch (adversarial vs spec §10/§11 + standards). Run **security-review** (+ security-audit): platform-admin gate can't be reached by a non-operator org; RLS on all new tables; `SECURITY DEFINER` functions all `SET search_path`; refund/commission actions server-compute money; audit-log is read-only to clients; no client-writable payment/commission tables. Recommend the user run `/code-review ultra` (heavyweight multi-agent branch review — billed, cannot self-launch). Run **simplify** on the diff. Then `superpowers:finishing-a-development-branch`.

- [ ] **Step 10: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): itemise marketplace platform-admin console + Phase-5 sweep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review (author)

- **Spec coverage:** Task 1↔§10 (full 14-row email module + PDF-attachment plumbing); Task 2↔§10 (in-app/push channel); Task 3↔§11 (admin capability, audit trail); Task 4↔§11 (supplier moderation, directory visibility, "new supplier" trust indicator); Task 5↔§6.5 (commission config single source); Task 6↔§6.3/§11 (dispute/refund mediation); Task 7↔§10 (low/out-of-stock); Task 8↔§11 (marketplace analytics GMV/commission/orders/top-suppliers, dataviz); Task 9↔§6.2/§6.4/§10 (payout + monthly statement emails + reconciliation); Task 10↔index §3 (final master-checklist sweep) + §11 (RBAC matrix).
- **Migrations:** exactly five, ascending in task order — 00216 (platform-admin helper + audit log), 00217 (moderation), 00218 (commission config + resolver), 00219 (stock-alert columns), 00220 (analytics RPC). None creates/drops a schema (`marketplace` exists since 00005), so each needs only `NOTIFY pgrst`. Any bucket/RLS remediation the sweep finds is numbered after 00220.
- **Money:** all new money is integer cents via the Phase-0 helper (`formatZARFromCents`); `commission_records` are already kobo; `orders.total_amount` (rand) is converted with `randToCents` at the edges. No float arithmetic on money.
- **Consistency:** renderer names (`renderXEmail`), helpers (`sendMarketplaceEmail`, `notifyMarketplaceOrg`, `maybeSendStockAlerts`, `evaluateStockAlerts`, `resolveCommissionRate`, `buildAnalyticsView`, `isPlatformAdmin`/`requirePlatformAdmin*`), constants (`PLATFORM_ADMIN_ORG_ID`, `MARKETPLACE_EMAIL_EVENTS`) are referenced under the same names they are defined.
- **Deliberate verification steps (not placeholders):** "read the sibling test / confirm the service-role factory / confirm `get_user_org_ids` / align the `formatZARFromCents` glyph / confirm the Phase-2 dispute schema" are real pre-write confirmations against live code, flagged inline — the cross-phase assumptions block lists exactly what to add if an earlier phase's artifact is absent.
- **Known cross-phase couplings:** dispute/refund tables (Phase 2), inventory columns + `catalogue-media` (Phase 1), fulfilment/POD (Phase 3), `supplier_commission_statements` (Phase 4). Each is guarded (`IF NOT EXISTS` / on-the-fly aggregation) so Phase 5 is executable even if a prior phase slipped, and Task 10 reconciles.
