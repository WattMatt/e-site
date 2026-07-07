# Client Portal — Design Spec

**Date:** 2026-07-06 · **Author:** Arno + Claude · **Branch:** `feat/client-portal` (off main)
**Trigger:** "We don't have the correct layout/setup for the client portal — needs to be viewing-only and limited to certain aspects of the project."

## 1. Root cause (investigated)

There is no client portal. `client_viewer` renders inside the full admin shell — the `(admin)`
layout only checks *authenticated* ([layout.tsx:20](../../apps/web/src/app/(admin)/layout.tsx)) —
with subtractive patches spread over five inconsistent mechanisms (sidebar filtering, per-page
redirects, post-render redirects, soft conditional UI, RLS-blanking). All 13 project tabs render
for clients (Cables, MV, Generator Cost-Recovery, JBCC, Settings…); "+ New Snag" and the diary
"Add Entry" form render and rely on server rejection. Every new admin feature is client-visible
by default: **fail-open for the one audience that must be fail-closed.** The `(portal)` route
group exists as an empty stub (rbac-matrix.md:185 specified a client compliance view, never built).

## 2. Design

**A dedicated viewing-only portal at `/portal`, rebuilt in the existing `(portal)` route group.**

### Gating (fail-closed at both shell boundaries)
- `(portal)/layout.tsx`: `getOrgContext()`; not authenticated → `/login`; `role !== 'client_viewer'`
  → `redirect('/dashboard')`.
- `(admin)/layout.tsx`: `role === 'client_viewer'` (via `getOrgContext`, the *active*-org role)
  → `redirect('/portal')`. This catches every deep link into the admin shell — no per-page gates
  needed for clients ever again.
- Login/callback keep sending to `/dashboard`; the admin layout bounces clients to `/portal`
  (one server-side hop). Middleware untouched (stays fast).
- Multi-org users: shell follows the **active org's** role; `OrgSwitcher` is present in the portal
  header, so a PM-in-org-A / client-in-org-B lands correctly per switch.

### Navigation (fixed, per user decision 2026-07-06)
`/portal` → project list (RLS-scoped: clients see only `project_members` projects, migr 00034).
`/portal/[projectId]` → Overview (no contract value) + fixed tabs, exactly the 8 chosen aspects:
**Site Diary, Snags, Inspections, Cable Schedule, Generator Recovery, Floor Plans, Handover,
Tenant Schedule.** Excluded permanently: financials (contract value, BOQ, valuations, variations,
rates), members/settings, marketplace, MV, JBCC, RFIs (not chosen).

> **Amendment 2026-07-07 (user decision):** Equipment & Materials is now INCLUDED as a tenth
> view-only tab (`/portal/[projectId]/equipment-materials`) — board register + procurement
> status/dates/required-by. Served by a curated **service-role** read behind `requirePortalAccess`
> (like cables/gcr): order notes, quote/order-instruction documents and shop drawings are never
> selected, and migration 00166 blocks the client JWT from reading node_orders / node_order_documents
> / node_order_shop_drawings + the node-order-documents storage bucket directly (a confirmed
> pre-existing leak). The original equipment-&-materials exclusion above is superseded.

### Data access rules
- **Membership check first** on every `[projectId]` page: active `client_viewer` +
  `project_members` row, else `notFound()`.
- Default: **RLS-gated user-client reads** (diary, snags, floor plans, handover, tenant schedule —
  client_viewer project-scoped per the 00034 policy family).
- Where RLS deliberately blocks client_viewer (cable_schedule.*, gcr.*, inspections.*): a curated
  server-only data module `apps/web/src/lib/portal/data.ts` does **service-role reads with explicit
  column allow-lists** after the membership check. The DB posture for the client's own JWT stays
  fully blocked (fail-closed API surface); only the curated server components expose data.
- **Cable schedule: rates/costs never selected** (same redaction rule as
  `lib/cable-schedule/export-role.ts`). Generator recovery shows the client's own recovery report
  (the client is the recovery beneficiary — user's explicit choice).
- Zero write affordances by construction: portal pages are read-only server components; no forms,
  no actions imported.

### Phase 2 (deferred, agreed)
Per-project "Client portal" visibility toggles (`project_settings.client_visible_aspects`) +
settings tab; portal nav reads the toggles. RLS-level enforcement decision at that point.

## 3. Verification plan (stated upfront)
1. Unit: layout gate logic (client → portal, non-client bounced, unauthenticated → login);
   portal data module membership checks + column allow-lists (no rate fields selected).
2. Type-check + lint + full web suite.
3. Live: sign in as `demo.client@esite-demo.co.za` (prod demo account) on the PR preview —
   lands on `/portal`, sees only the 8 aspects, no financials anywhere, `/dashboard` and
   `/projects/...` deep links bounce back to `/portal`. Sign in as contractor demo — unchanged
   admin experience, `/portal` bounces to `/dashboard`.
4. Failure of any check returns to design — no patch-on-patch.
