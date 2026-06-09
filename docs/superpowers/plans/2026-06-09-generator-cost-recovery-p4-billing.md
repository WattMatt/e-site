# Generator Cost-Recovery — P4: Per-Seat Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the generator cost-recovery report a **per-seat paid extra (R2 000/user)** — a new `billing.org_feature_seats` entitlement mirroring the per-org `org_feature_unlocks` pattern, gating the feature, with admin purchase/assign + the WM-Consulting platform-owner bypass (so WM uses it free).

**Architecture:** Mirror the per-org unlock 1:1, extended with a user axis. **D3 (locked):** a reassignable **seat pool** — a seat is org-owned (`assigned_user_id` nullable, freed on user removal, reassignable). Gate keyed on `(org, user)`.

**Tech Stack:** Supabase migration (00125), Paystack (test mode), `@react-pdf` route gating, Next 15 actions/route.

**Spec:** `../specs/2026-06-08-generator-cost-recovery-design.md` §5.3 (seats table + `has_feature_seat`) + §8 (entitlement flow). **Mirror exactly:** `migrations/00097_org_feature_unlocks.sql`, `apps/web/src/lib/features.ts`, `apps/web/src/app/api/paystack/{feature-unlock/route.ts, webhook/route.ts}`, `apps/web/src/app/(admin)/inspections/unlock/*`, `packages/shared/src/services/billing.service.ts`.

**Scope:** the per-seat entitlement + gate + purchase + seats panel. Live selling is gated on your Paystack go-live (separate) — built code is test-mode-safe and 503s if `PAYSTACK_SECRET_KEY` is unset.

## Plan index
P1 engine · P2 data+capture · P3 report — *done* → **P4 per-seat billing** *(this)*.

## File structure
```
apps/edge-functions/supabase/migrations/00125_org_feature_seats.sql   # seats pool + has_feature_seat fn + RLS
scripts/db/smoke-test-org-feature-seats.sh
packages/shared/src/services/billing.service.ts                       # +FEATURE_PRICES entry (model:'seat')
apps/web/src/lib/features.ts                                          # +hasFeatureSeat / requireFeatureSeat
apps/web/src/lib/reports/generator-report-data.ts                    # +seat gate in the gather (or the route/page)
apps/web/src/app/api/projects/[id]/generator-cost-recovery/report-preview/route.ts  # +requireFeatureSeat gate
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/page.tsx             # +paywall redirect when no seat
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/unlock/page.tsx      # paywall
apps/web/src/app/api/paystack/feature-seat/route.ts                  # purchase (target user)
apps/web/src/app/api/paystack/webhook/route.ts                       # +feature_seat branch
apps/web/src/app/(admin)/settings/billing/seats/*                    # seats-management panel
```

---

### Task 1: Migration 00125 — seats pool + `has_feature_seat`

**Files:** Create `…/migrations/00125_org_feature_seats.sql`; Create `scripts/db/smoke-test-org-feature-seats.sh`

- [ ] **Step 1: Migration** (mirror 00097 + the seat/user axis; pool = nullable `assigned_user_id`):
```sql
-- =============================================================================
-- Migration 00125 — per-seat feature unlocks (generator cost-recovery)
-- =============================================================================
-- Mirrors billing.org_feature_unlocks but adds a USER axis: a seat is an
-- org-owned paid slot, assignable/reassignable to a user (D3 pool). Freed
-- (assigned_user_id → NULL) when the user is removed, not forfeited.
-- =============================================================================
CREATE TABLE IF NOT EXISTS billing.org_feature_seats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id    UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    feature_key        TEXT NOT NULL,
    assigned_user_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- NULL = free seat in the pool
    paystack_reference TEXT UNIQUE,                 -- webhook idempotency; NULL for manual grants
    amount_paid_kobo   BIGINT,
    purchased_by       UUID REFERENCES auth.users(id),
    purchased_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_at        TIMESTAMPTZ,
    notes              TEXT
);
-- a user holds at most one seat per feature per org
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_feature_seats_assignment
    ON billing.org_feature_seats (organisation_id, feature_key, assigned_user_id)
    WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_feature_seats_org ON billing.org_feature_seats (organisation_id);

CREATE OR REPLACE FUNCTION public.has_feature_seat(p_org_id UUID, p_user_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid   -- WM-Consulting platform-owner bypass
        OR EXISTS (
            SELECT 1 FROM billing.org_feature_seats
            WHERE organisation_id = p_org_id AND feature_key = p_feature_key
              AND assigned_user_id = p_user_id
        );
$$;
REVOKE EXECUTE ON FUNCTION public.has_feature_seat(UUID,UUID,TEXT) FROM PUBLIC;

ALTER TABLE billing.org_feature_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_feature_seats_select ON billing.org_feature_seats;
CREATE POLICY org_feature_seats_select ON billing.org_feature_seats FOR SELECT TO authenticated
    USING (organisation_id = ANY(public.get_user_org_ids()));
-- writes happen via the webhook (service role) + admin actions (service role); no authenticated write policy.
NOTIFY pgrst, 'reload schema';
```
- [ ] **Step 2: Smoke test** `scripts/db/smoke-test-org-feature-seats.sh` (mirror `smoke-test-generator-cost-recovery.sh`): transactional — assert the table + the `has_feature_seat` fn exist, an insert+assign yields `has_feature_seat(org,user,'generator_cost_recovery')=true`, an unassigned seat does not, and the WM-Consulting org returns true with no row; end with the `RAISE EXCEPTION` sentinel (rolls back). Run it (transactional, persists nothing).
- [ ] **Step 3: Commit** `feat(gcr): migration 00125 — per-seat feature unlocks + has_feature_seat`.

---

### Task 2: FEATURE_PRICES entry + the guard

**Files:** Modify `packages/shared/src/services/billing.service.ts`, `apps/web/src/lib/features.ts`

- [ ] **Step 1:** Add to `FEATURE_PRICES`:
```typescript
  generator_cost_recovery: {
    key: 'generator_cost_recovery',
    label: 'Generator Cost-Recovery',
    amountKobo: 200000, // R2 000 per seat
    description: 'Standby-generator cost-recovery: tenant apportionment + branded report. Per-user seat.',
    model: 'seat' as const,
  },
```
(Add `model?: 'org' | 'seat'` to the existing entries' type by adding `model: 'org' as const` to inspections/jbcc, or make `model` optional — keep `FeatureKey` working.)
- [ ] **Step 2:** In `features.ts`, add (mirror `hasFeature`/`requireFeature`):
```typescript
export async function hasFeatureSeat(organisationId: string, userId: string, featureKey: FeatureKey, supabase?: AnyClient): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('has_feature_seat', { p_org_id: organisationId, p_user_id: userId, p_feature_key: featureKey })
  if (error) return false
  return data === true
}
export async function requireFeatureSeat(organisationId: string, userId: string, featureKey: FeatureKey, supabase?: AnyClient, paywallPath?: string): Promise<void> {
  const ok = await hasFeatureSeat(organisationId, userId, featureKey, supabase)
  if (!ok) redirect(paywallPath ?? '/')   // route gate handles its own 402 instead (Task 3)
}
```
- [ ] **Step 3:** Tests for the guard (mock the rpc) + `pnpm --filter @esite/shared type-check` + `pnpm --filter web type-check`. Commit `feat(gcr): seat pricing + hasFeatureSeat guard`.

---

### Task 3: Gate the feature + paywall

**Files:** Modify the report route + the gcr `page.tsx`; Create `…/generator-cost-recovery/unlock/page.tsx`

- [ ] **Step 1:** In `report-preview/route.ts` (after auth, before/after gather): resolve the project's org + the current `user.id`; if `!await hasFeatureSeat(orgId, user.id, 'generator_cost_recovery', supabase)` → return `402` JSON `{ error: 'No generator cost-recovery seat', unlockPath: '/projects/'+id+'/generator-cost-recovery/unlock' }`. (The WM-Consulting bypass is inside the SQL fn, so WM passes.)
- [ ] **Step 2:** In the gcr `page.tsx`: after the COST_VIEW gate, if the current user lacks a seat, render a **locked state** (a banner "Generator Cost-Recovery is a paid add-on — R2 000/seat" + a link to the unlock page) instead of the tabs; OR redirect to the unlock page. Keep config visible to admins? (Decision: show the locked banner; only seat-holders/WM see the tabs.)
- [ ] **Step 3:** `unlock/page.tsx` — mirror `inspections/unlock/page.tsx`: explains the R2 000/seat add-on; an owner/admin sees a "Buy a seat" button (Task 5's purchase) and a "manage seats" link; a non-admin sees "ask your admin". Commit `feat(gcr): seat gate + paywall`.

---

### Task 4: Paystack feature-seat route + webhook branch

**Files:** Create `apps/web/src/app/api/paystack/feature-seat/route.ts`; Modify `apps/web/src/app/api/paystack/webhook/route.ts`

- [ ] **Step 1:** `feature-seat/route.ts` — copy `feature-unlock/route.ts`; body `{ feature_key: 'generator_cost_recovery', target_user_id: uuid }`; owner/admin gate (same membership query); 409 if `await hasFeatureSeat(org, target_user_id, feature_key)`; `transaction/initialize` with `metadata: { type: 'feature_seat', feature_key, org_id, user_id: target_user_id, amount_kobo }`. Same 503/rate-limit/502 handling.
- [ ] **Step 2:** In `webhook/route.ts` `charge.success`, add a branch BEFORE the feature_unlock one:
```typescript
if (metadata.type === 'feature_seat' && metadata.org_id && metadata.user_id && metadata.feature_key) {
  await (supabase as any).schema('billing').from('org_feature_seats').upsert({
    organisation_id: metadata.org_id, feature_key: metadata.feature_key,
    assigned_user_id: metadata.user_id, paystack_reference: data.reference,
    amount_paid_kobo: (metadata.amount_kobo as number | undefined) ?? data.amount,
    assigned_at: new Date().toISOString(),
  }, { onConflict: 'paystack_reference', ignoreDuplicates: true })
  await billingService.recordInvoice(supabase as any, metadata.org_id as string, {
    paystackReference: data.reference, amountKobo: (metadata.amount_kobo as number) ?? data.amount,
    status: 'paid', description: `Seat: ${metadata.feature_key} → ${metadata.user_id}`, paidAt: new Date().toISOString(),
  }).catch(console.error)
  return NextResponse.json({ received: true })
}
```
- [ ] **Step 3:** Action tests where feasible (the route's gate/409). Type-check + build. Commit `feat(gcr): paystack feature-seat purchase + webhook branch`.

---

### Task 5: Seats-management panel

**Files:** Create `apps/web/src/app/(admin)/settings/billing/seats/*` (+ a `seats.actions.ts`)

- [ ] A page (owner/admin only) listing the org's users (`user_organisations` joined to `profiles`) with their `generator_cost_recovery` seat state (held / none), the count of purchased vs assigned seats, and actions: **Buy a seat for {user}** (calls `/api/paystack/feature-seat` → redirect to Paystack), **Assign a free seat** / **Reassign** (a `reassignSeatAction` updating `assigned_user_id`, service-role + owner/admin gate), **Free a seat** (set `assigned_user_id = null`). Mirror the inspections-unlock button's fetch+redirect. Commit `feat(gcr): seats-management panel`.

---

## Self-Review (completed)
- **Spec coverage:** §5.3 seats pool + `has_feature_seat` → Task 1; §8 entitlement flow (price · guard · gate · paywall · purchase · webhook · seats panel) → Tasks 2–5; D2 admin-buys-&-assigns + D3 reassignable-pool → Tasks 4/5 (target_user_id at purchase; reassign/free actions); WM bypass → the SQL fn. ✅
- **Placeholder scan:** the migration SQL, the guard, the FEATURE_PRICES entry, the route metadata, and the webhook branch are complete; UI tasks reference concrete in-repo templates (`inspections/unlock/*`) with named actions. ✅
- **Type consistency:** `hasFeatureSeat(org,user,key)` ↔ the SQL `has_feature_seat(p_org_id,p_user_id,p_feature_key)`; `metadata.type==='feature_seat'` consistent route↔webhook; `feature_key: 'generator_cost_recovery'` everywhere. ✅

## Execution handoff
**superpowers:subagent-driven-development.** Live payments are **test-mode** — the purchase flow is built but won't move real money until your Paystack go-live; the gate + WM bypass work immediately (WM uses the feature free). Suggested order: Task 1 → 2 → 3 (the gate, the high-value core) → 4 → 5.
