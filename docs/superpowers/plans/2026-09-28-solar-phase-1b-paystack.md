# Solar Phase 1B — Paystack Org Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner/admin of a project's organisation buy the org-wide Solar subscription (R1,999/yr excl. VAT, Paystack recurring annual plan), and make `/api/paystack/webhook` the single writer of `billing.org_addon_subscriptions` across first charge, renewal, not-renew, disable, failure, refund and chargeback.

**Architecture:** `FEATURE_PRICES.solar` (model `org_subscription`) is the price source. A new `POST /api/paystack/solar-subscribe` derives the org from the **project**, gates on `requireRole(…, projectOrg, OWNER_ADMIN)`, 409s when `org_has_solar` is already true, and starts a Paystack plan checkout with `metadata.type = 'org_addon_subscription'`. It writes **nothing**. The webhook inserts the row on the first charge and moves it through `active → non_renewing / past_due / cancelled / refunded` afterwards. Idempotency uses `last_event_id` (the charge reference). A refund or chargeback finds its org through a `billing.payment_events` row that the charge branch writes. The one-time `/feature-unlock` route rejects subscription keys, and the callback allow-list gains the new type.

**Tech Stack:** Next.js 15 route handlers, Supabase (service client for webhook writes), zod, Vitest, pnpm/Turborepo.

**Spec:** `docs/solar/03-data-model-and-security.md` §2 (esp. §2.3 point 4), `docs/solar/06-open-decisions.md` D-01 / D-02, `docs/solar/01-functional-spec.md` §1.2, `docs/solar/05-development-plan.md` P1.

**Out of scope (Phase 1C):** the `/projects/[id]/solar/locked` page, its Subscribe button, the "activating Solar…" poll, sidebar, access panel. 1B ships only the API and webhook that 1C's Subscribe button calls.

---

## Ground rules (read once)

- Repo root is the worktree created in Task 1. All paths below are relative to it.
- **No migration.** 1A's `00207` already provides everything this plan writes to:
  - `billing.org_addon_subscriptions` has a status CHECK of `pending, active, non_renewing, past_due, cancelled, refunded`, plus `last_event_id`, `paystack_customer_code`, `paystack_subscription_code UNIQUE`, `started_at`, `cancelled_at` and `refunded_at` (`00207_solar_foundation.sql:147-167`).
  - `billing.payment_events.event_type` is free text, so new event types need no CHECK change (`00190_payment_events_and_unlock_revocation.sql:90-104`).
  - The notification types `billing_duplicate_charge` and `billing_refund_processed` are already legal (`00190`, the latest `notifications_type_check` re-declaration).
  - No plan-code column is needed: the plan code comes from `PAYSTACK_PLAN_SOLAR_ANNUAL` at request time.

  **If you find you need a migration, STOP and report why.** Do not write one.
- **The webhook is the only writer** of `billing.org_addon_subscriptions`. The subscribe route writes nothing. Task 13 pins this with a contract test.
- `requireRole` / `requireEffectiveRole` return an **object**. Always check `.ok`, never `if (!result)`.
- Every webhook write either succeeds or returns 500 so Paystack retries (`webhook/route.ts:28-35`). The exception is a condition a retry can never fix (unknown org, unplaceable Solar charge): log it to `billing.payment_events` and return 200.
- Run all three suites plus type-check at the end: `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`, `pnpm --filter web type-check`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Why no `pending` row (decision, justified)

`mv-subscribe` writes a `pending` row because it has something to record before payment: the disclaimer acceptance (`mv-subscribe/route.ts:50-83`). Solar has nothing to record at that point. Functional spec §1.2 says the Subscribe button "Writes nothing until the webhook". A pending row would add risk and no value:

1. It would make the route a second writer of the table. That is exactly how MV's upsert once downgraded an `active` subscriber to `pending` (`mv-subscribe/route.ts:53-68`).
2. It would need a service-client write from a user-facing route.
3. It would leave orphan `pending` rows for every abandoned checkout.

The CHECK `status = 'pending' OR current_period_end IS NOT NULL` (`00207:165-166`) is satisfied because the webhook inserts straight into `active` with a period end.

### Webhook event → state map

| Paystack event | Match | Effect on `billing.org_addon_subscriptions` |
|---|---|---|
| `charge.success`, `metadata.type='org_addon_subscription'` (first charge) | `metadata.org_id` (must exist in `public.organisations`) | insert, or update an existing row → `active`; `current_period_end = max(existing, paid_at + 1y)`; codes stored; `last_event_id = reference`. If the row is already live → **duplicate purchase**: no grant, admins notified, invoice marked DUPLICATE |
| `charge.success`, no metadata (renewal, `"metadata": 0`) | `subscription_code`, else `customer_code` + plan = `PAYSTACK_PLAN_SOLAR_ANNUAL` | → `active`, period extended (never shortened). An unplaceable Solar-plan charge is logged and **never** falls into Branch C |
| `subscription.create` | same matcher | store `paystack_subscription_code`; `current_period_end = max(existing, next_payment_date)`; status untouched |
| `invoice.update` paid / failed | `subscription_code` | paid → `active` + period from `next_payment_date`; failed → `past_due` (only from `active`) |
| `subscription.not_renew` | matcher | → `non_renewing` (only from `active`/`past_due`); period kept |
| `subscription.disable` | matcher | → `cancelled` + `cancelled_at` (only from `active`/`non_renewing`/`past_due`; never overwrites `refunded`) |
| `charge.failed` (renewal) / `invoice.payment_failed` | matcher | → `past_due` (only from `active`). A failed FIRST Solar charge touches nothing, **including the org's tier subscription** |
| `refund.processed` / `charge.dispute.resolve` with `resolution='merchant-accepted'` | reference → `billing.payment_events` (`charge.success.org_addon_subscription`) → org | → `refunded` + `refunded_at` (hidden but kept, D-02); admins notified once |

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/services/billing.service.ts` | `FEATURE_PRICES.solar`, `SubscriptionFeatureKey`, `OneTimeFeatureKey`, `isSubscriptionFeature`, `ONE_TIME_FEATURE_KEYS` |
| `packages/shared/src/__tests__/billing/billing.service.test.ts` | Tests for the above |
| `apps/web/src/app/api/paystack/feature-unlock/route.ts` (+ `.test.ts`) | Enum built from `ONE_TIME_FEATURE_KEYS` — rejects `solar` |
| `apps/web/src/lib/paystack/return-to.ts` (+ `.test.ts`) | `solarReturnTo(projectId)`, `'solar'` case |
| `apps/web/src/lib/paystack/org-addon.ts` (+ `.test.ts`) | Pure helpers: metadata/event-type constants, `solarPlanCode`, `planCodeOf`, `subscriptionCodeOf`, `nextAddonPeriodEnd` |
| `apps/web/src/app/api/paystack/solar-subscribe/route.ts` (+ `.test.ts`) | The purchase route |
| `apps/web/src/app/api/paystack/callback/route.ts` (+ `.test.ts`) | Allow-list `org_addon_subscription` |
| `apps/web/src/app/api/paystack/webhook/route.ts` (+ `.test.ts`) | All org-addon branches |
| `apps/web/src/lib/paystack/org-addon-single-writer.contract.test.ts` | Only the webhook route names the table |
| `docs/rbac-matrix.md` | Row + footnote ¹⁶ for the new route |

---

### Task 1: Worktree and baseline

**Files:** none (plus a copy of this plan)

- [ ] **Step 1: Create the worktree from the 1A branch**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a
git fetch origin -q
git worktree add -b feat/solar-phase-1b ~/.config/superpowers/worktrees/esite/solar-phase-1b origin/feat/solar-phase-1a
cd ~/.config/superpowers/worktrees/esite/solar-phase-1b
pnpm install --frozen-lockfile
```
Expected: the worktree is created on `feat/solar-phase-1b` and the install completes.

- [ ] **Step 2: Bring this plan into the branch**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-1b
cp /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a/docs/superpowers/plans/2026-09-28-solar-phase-1b-paystack.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-09-28-solar-phase-1b-paystack.md
git commit -m "docs(solar): Phase 1B implementation plan — Paystack org subscription

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Baseline the three suites and the type-check**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter web type-check 2>&1 | tail -3
```
Expected: everything passes. Record the pass counts for the PR body. If anything is red on the untouched branch, STOP and report. Do not build on a red baseline.

---

### Task 2: `FEATURE_PRICES.solar` and the one-time / subscription split

**Files:**
- Modify: `packages/shared/src/services/billing.service.ts:59-91`
- Test: `packages/shared/src/__tests__/billing/billing.service.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/shared/src/__tests__/billing/billing.service.test.ts`, and change its import line (line 2) to:

```ts
import {
  FEATURE_PRICES,
  ONE_TIME_FEATURE_KEYS,
  isSubscriptionFeature,
} from '../../services/billing.service'
```

Append:

```ts
describe('FEATURE_PRICES — solar org subscription (D-01)', () => {
  it('is an org-wide annual subscription at R1,999 excl. VAT', () => {
    expect(FEATURE_PRICES.solar.key).toBe('solar')
    expect(FEATURE_PRICES.solar.model).toBe('org_subscription')
    expect(FEATURE_PRICES.solar.interval).toBe('annual')
    expect(FEATURE_PRICES.solar.amountKobo).toBe(199900)
  })

  it('names the env var holding the Paystack plan code', () => {
    expect(FEATURE_PRICES.solar.planCodeEnv).toBe('PAYSTACK_PLAN_SOLAR_ANNUAL')
  })

  it('does not change the model of any existing entry', () => {
    expect(FEATURE_PRICES.inspections.model).toBe('org')
    expect(FEATURE_PRICES.jbcc.model).toBe('org')
    expect(FEATURE_PRICES.generator_cost_recovery.model).toBe('seat')
  })
})

describe('one-time vs subscription feature keys', () => {
  it('classifies solar as a subscription and the rest as one-time', () => {
    expect(isSubscriptionFeature('solar')).toBe(true)
    expect(isSubscriptionFeature('jbcc')).toBe(false)
    expect(isSubscriptionFeature('inspections')).toBe(false)
    expect(isSubscriptionFeature('generator_cost_recovery')).toBe(false)
  })

  it('answers false for a key that does not exist, including prototype names', () => {
    expect(isSubscriptionFeature('not_a_feature')).toBe(false)
    expect(isSubscriptionFeature('constructor')).toBe(false)
    expect(isSubscriptionFeature('toString')).toBe(false)
  })

  it('ONE_TIME_FEATURE_KEYS excludes every subscription key', () => {
    expect(ONE_TIME_FEATURE_KEYS).not.toContain('solar')
    for (const k of ONE_TIME_FEATURE_KEYS) expect(isSubscriptionFeature(k)).toBe(false)
  })

  it('ONE_TIME_FEATURE_KEYS keeps every existing one-time key', () => {
    expect([...ONE_TIME_FEATURE_KEYS].sort()).toEqual(['generator_cost_recovery', 'inspections', 'jbcc'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/__tests__/billing/billing.service.test.ts`
Expected: FAIL. `FEATURE_PRICES.solar` is undefined, and `ONE_TIME_FEATURE_KEYS` / `isSubscriptionFeature` are not exported.

- [ ] **Step 3: Implement.** Replace `billing.service.ts` lines 59-91 (from the `// FEATURE_PRICES — single source of truth` comment through `export type FeatureKey = keyof typeof FEATURE_PRICES`) with:

```ts
// FEATURE_PRICES — single source of truth for paid add-ons. Lives alongside
// PLANS but operates orthogonally to the subscription tier.
//
// model: 'org'              — one-time unlock per organisation (billing.org_feature_unlocks, migration 00097)
// model: 'seat'             — one-time unlock per user within an org (billing.org_feature_seats, migration 00125)
// model: 'org_subscription' — RECURRING org-wide plan (billing.org_addon_subscriptions, migration 00207).
//                             Bought only through its own route (/api/paystack/solar-subscribe) against
//                             the Paystack plan named by `planCodeEnv`. NEVER through the one-time
//                             /api/paystack/feature-unlock route, which rejects these keys: a one-time
//                             R1,999 charge there would grant nothing (no webhook branch writes an
//                             org_feature_unlocks row for a subscription key) while taking the money.
//
// Webhook flow lives in /api/paystack/webhook under metadata.type ===
// 'feature_unlock' | 'feature_seat' | 'org_addon_subscription'.
export const FEATURE_PRICES = {
  inspections: {
    key: 'inspections',
    label: 'Inspections module',
    amountKobo: 25000, // R250 lifetime
    description: 'All current and future inspection templates, lifetime access.',
    model: 'org' as const,
  },
  jbcc: {
    key: 'jbcc',
    label: 'JBCC Procedural Toolkit',
    amountKobo: 199900, // R1,999 lifetime
    description: 'JBCC Procedural Toolkit — clause reference, notice-letter generation, time-bar tracking',
    model: 'org' as const,
  },
  generator_cost_recovery: {
    key: 'generator_cost_recovery',
    label: 'Generator Cost-Recovery',
    amountKobo: 200000,
    description: 'Standby-generator cost-recovery: tenant apportionment + branded report. Per-user seat.',
    model: 'seat' as const,
  },
  solar: {
    key: 'solar',
    label: 'Solar module',
    amountKobo: 199900, // R1,999 per year excl. VAT (decision D-01)
    description: 'Solar design, simulation and client proposals on every project of your organisation. Annual subscription.',
    model: 'org_subscription' as const,
    interval: 'annual' as const,
    planCodeEnv: 'PAYSTACK_PLAN_SOLAR_ANNUAL',
  },
} as const

export type FeatureKey = keyof typeof FEATURE_PRICES

/** Keys sold as a recurring subscription rather than a one-time unlock. */
export type SubscriptionFeatureKey = {
  [K in FeatureKey]: (typeof FEATURE_PRICES)[K]['model'] extends 'org_subscription' ? K : never
}[FeatureKey]

/** Keys sold as a one-time charge — the only keys /api/paystack/feature-unlock may accept. */
export type OneTimeFeatureKey = Exclude<FeatureKey, SubscriptionFeatureKey>

export function isSubscriptionFeature(key: string): key is SubscriptionFeatureKey {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_PRICES, key)) return false
  return FEATURE_PRICES[key as FeatureKey].model === 'org_subscription'
}

export const ONE_TIME_FEATURE_KEYS: readonly OneTimeFeatureKey[] = (
  Object.keys(FEATURE_PRICES) as FeatureKey[]
).filter((k): k is OneTimeFeatureKey => !isSubscriptionFeature(k))
```

(`packages/shared/src/services/index.ts` already has `export * from './billing.service'`, so the new names reach `@esite/shared` without further edits.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/__tests__/billing/billing.service.test.ts`
Expected: PASS (6 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/billing.service.ts packages/shared/src/__tests__/billing/billing.service.test.ts
git commit -m "feat(billing): FEATURE_PRICES.solar as an org_subscription + one-time key split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `/api/paystack/feature-unlock` rejects subscription keys

Right now the zod enum is built from **every** `FEATURE_PRICES` key (`feature-unlock/route.ts:21-24`). After Task 2 that includes `solar`, so a POST with `{feature_key:'solar'}` would start a one-time R1,999 charge that no webhook branch turns into access.

**Files:**
- Modify: `apps/web/src/app/api/paystack/feature-unlock/route.ts:4,21-24`
- Test: `apps/web/src/app/api/paystack/feature-unlock/route.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `describe('POST /api/paystack/feature-unlock — existing gates are untouched', …)`, after the `'still rejects an unknown feature key'` test:

```ts
  it('refuses the Solar subscription key — it is an annual plan, not a one-time unlock', async () => {
    const res = await POST(req({ feature_key: 'solar' }))
    expect(res.status).toBe(400)
    expect(hasFeatureMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/feature-unlock/route.test.ts`
Expected: FAIL. The status is 200 and `fetch` was called, because `solar` is in the enum since Task 2.

- [ ] **Step 3: Implement.** In `feature-unlock/route.ts`, change line 4 to:

```ts
import { FEATURE_PRICES, ONE_TIME_FEATURE_KEYS, type OneTimeFeatureKey } from '@esite/shared'
```

and replace lines 21-24 with:

```ts
// ONE_TIME_FEATURE_KEYS, not Object.keys(FEATURE_PRICES): a subscription key
// (model 'org_subscription', e.g. solar) sold here would take a one-time
// charge that no webhook branch turns into access. Subscriptions have their
// own routes (/api/paystack/solar-subscribe).
const bodySchema = z.object({
  feature_key: z.enum(ONE_TIME_FEATURE_KEYS as unknown as [OneTimeFeatureKey, ...OneTimeFeatureKey[]]),
  return_to: z.string().optional(),
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/feature-unlock/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/feature-unlock/route.ts apps/web/src/app/api/paystack/feature-unlock/route.test.ts
git commit -m "fix(paystack): feature-unlock rejects subscription-model keys (solar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `return_to` for the project's Solar page

**Files:**
- Modify: `apps/web/src/lib/paystack/return-to.ts:54-74`
- Test: `apps/web/src/lib/paystack/return-to.test.ts`

- [ ] **Step 1: Write the failing tests.** Change the import on line 3 of `return-to.test.ts` to:

```ts
import { safeReturnTo, DEFAULT_RETURN_TO, returnToForFeature, solarReturnTo } from './return-to'
```

Append:

```ts
describe('solarReturnTo — the Solar payer lands back on the project that sold it', () => {
  it('returns the project Solar page', () => {
    expect(solarReturnTo('5a0e8f7c-1b2d-4c3e-9f4a-6b7c8d9e0f1a')).toBe(
      '/projects/5a0e8f7c-1b2d-4c3e-9f4a-6b7c8d9e0f1a/solar',
    )
  })

  it('is always a safe same-origin path', () => {
    for (const id of ['p1', '//evil.test', 'https://evil.test', '..\\x']) {
      const v = solarReturnTo(id)
      expect(safeReturnTo(v)).toBe(v)
      expect(new URL(v, 'https://www.e-site.live/api/paystack/callback').origin).toBe('https://www.e-site.live')
    }
  })

  it('returnToForFeature has an org-level fallback for solar', () => {
    expect(returnToForFeature('solar')).toBe(DEFAULT_RETURN_TO)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/paystack/return-to.test.ts`
Expected: FAIL. `solarReturnTo` is not exported.

- [ ] **Step 3: Implement.** In `return-to.ts`, replace lines 54-74 (from the `/**\n * Default landing path per paid feature.` comment to the end of the file) with:

```ts
/**
 * Default landing path per paid feature. Before this existed, every
 * feature-unlock checkout hardcoded `cancel_action` to `/inspections/unlock`,
 * so a JBCC buyer who cancelled was sent to the Inspections paywall — a page
 * about a module they were not buying.
 *
 * JBCC, generator cost-recovery and Solar are project-scoped (`/projects/[id]/…`),
 * so there is no org-level landing page for them; the calling route knows the
 * project and should pass an explicit `return_to` (Solar: solarReturnTo).
 * These are the fallbacks for when it does not.
 */
export function returnToForFeature(featureKey: FeatureKey | string): string {
  switch (featureKey) {
    case 'inspections':
      return '/inspections'
    case 'jbcc':
    case 'generator_cost_recovery':
    case 'solar':
    default:
      return DEFAULT_RETURN_TO
  }
}

/**
 * Where a Solar subscriber returns after Paystack: the Solar page of the
 * project they pressed Subscribe on. The org is bought org-wide (D-01), but the
 * payer started on one project and must see it unlock there. The id is
 * URI-encoded and the result validated, so even a hostile id cannot leave the
 * origin (the route also requires a uuid).
 */
export function solarReturnTo(projectId: string): string {
  return safeReturnTo(`/projects/${encodeURIComponent(projectId)}/solar`)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/paystack/return-to.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/paystack/return-to.ts apps/web/src/lib/paystack/return-to.test.ts
git commit -m "feat(paystack): solarReturnTo — return the Solar payer to the project page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pure org-addon helpers

**Files:**
- Create: `apps/web/src/lib/paystack/org-addon.ts`
- Test: `apps/web/src/lib/paystack/org-addon.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/web/src/lib/paystack/org-addon.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  ORG_ADDON_METADATA_TYPE,
  ORG_ADDON_CHARGE_EVENT,
  ORG_ADDON_DUPLICATE_EVENT,
  ORG_ADDON_UNMATCHED_EVENT,
  solarPlanCode,
  planCodeOf,
  subscriptionCodeOf,
  nextAddonPeriodEnd,
} from './org-addon'

describe('constants', () => {
  it('uses the metadata type the spec names', () => {
    expect(ORG_ADDON_METADATA_TYPE).toBe('org_addon_subscription')
  })

  it('keeps the three payment-event types distinct — a refund lookup keys on the first only', () => {
    const all = [ORG_ADDON_CHARGE_EVENT, ORG_ADDON_DUPLICATE_EVENT, ORG_ADDON_UNMATCHED_EVENT]
    expect(new Set(all).size).toBe(3)
    expect(ORG_ADDON_CHARGE_EVENT).toBe('charge.success.org_addon_subscription')
  })
})

describe('solarPlanCode', () => {
  it('reads PAYSTACK_PLAN_SOLAR_ANNUAL, trimmed', () => {
    expect(solarPlanCode({ PAYSTACK_PLAN_SOLAR_ANNUAL: '  PLN_x  ' })).toBe('PLN_x')
  })

  it('is undefined when unset or blank — the route then 503s', () => {
    expect(solarPlanCode({})).toBeUndefined()
    expect(solarPlanCode({ PAYSTACK_PLAN_SOLAR_ANNUAL: '   ' })).toBeUndefined()
  })
})

describe('planCodeOf / subscriptionCodeOf', () => {
  it('reads the plan code from an object, a plan_object, or a bare string', () => {
    expect(planCodeOf({ plan: { plan_code: 'PLN_a' } })).toBe('PLN_a')
    expect(planCodeOf({ plan: {}, plan_object: { plan_code: 'PLN_b' } })).toBe('PLN_b')
    expect(planCodeOf({ plan: 'PLN_c' })).toBe('PLN_c')
    expect(planCodeOf({ plan: '' })).toBeUndefined()
    expect(planCodeOf(null)).toBeUndefined()
  })

  it('reads the subscription code from subscription or plan_object', () => {
    expect(subscriptionCodeOf({ subscription: { subscription_code: 'SUB_a' } })).toBe('SUB_a')
    expect(subscriptionCodeOf({ plan_object: { subscription_code: 'SUB_b' } })).toBe('SUB_b')
    expect(subscriptionCodeOf({})).toBeUndefined()
    expect(subscriptionCodeOf(undefined)).toBeUndefined()
  })
})

describe('nextAddonPeriodEnd', () => {
  it('is paid_at + 1 year when nothing else is known', () => {
    expect(nextAddonPeriodEnd(null, '2026-09-28T10:00:00.000Z')).toBe('2027-09-28T10:00:00.000Z')
  })

  it('prefers Paystack next_payment_date when given', () => {
    expect(
      nextAddonPeriodEnd(null, '2026-09-28T10:00:00.000Z', '2027-10-01T00:00:00.000Z'),
    ).toBe('2027-10-01T00:00:00.000Z')
  })

  it('never shortens a period already paid for — an out-of-order event cannot take time away', () => {
    expect(nextAddonPeriodEnd('2029-01-01T00:00:00.000Z', '2026-09-28T10:00:00.000Z')).toBe(
      '2029-01-01T00:00:00.000Z',
    )
  })

  it('extends past an earlier stored end', () => {
    expect(nextAddonPeriodEnd('2026-12-31T00:00:00.000Z', '2026-12-30T08:00:00.000Z')).toBe(
      '2027-12-30T08:00:00.000Z',
    )
  })

  it('falls back to now + 1 year for an unparseable paid_at', () => {
    const got = new Date(nextAddonPeriodEnd(null, 'not a date'))
    const expected = new Date()
    expected.setUTCFullYear(expected.getUTCFullYear() + 1)
    expect(Math.abs(got.getTime() - expected.getTime())).toBeLessThan(60_000)
  })

  it('ignores an unparseable stored end rather than returning Invalid Date', () => {
    expect(nextAddonPeriodEnd('garbage', '2026-09-28T10:00:00.000Z')).toBe('2027-09-28T10:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/paystack/org-addon.test.ts`
Expected: FAIL. Cannot resolve `./org-addon`.

- [ ] **Step 3: Implement** — create `apps/web/src/lib/paystack/org-addon.ts`:

```ts
/**
 * Pure helpers for the org add-on subscription (Solar, billing.org_addon_subscriptions,
 * migration 00207). The DB-touching branches live in /api/paystack/webhook —
 * the ONLY writer of that table.
 */
import { FEATURE_PRICES } from '@esite/shared'

/** metadata.type set by /api/paystack/solar-subscribe and matched by the webhook + callback. */
export const ORG_ADDON_METADATA_TYPE = 'org_addon_subscription' as const

/**
 * billing.payment_events.event_type for a Solar charge that was APPLIED. The
 * table stores no references, so this row is the reference → org map a
 * refund or chargeback uses to find the subscription.
 */
export const ORG_ADDON_CHARGE_EVENT = 'charge.success.org_addon_subscription'

/**
 * A second first-charge while the subscription was live. Logged under its own
 * type so that refunding it — which the admins are told to do — can never
 * match the refund lookup and lock the org's live subscription.
 */
export const ORG_ADDON_DUPLICATE_EVENT = 'charge.success.org_addon_subscription.duplicate'

/** A Solar charge the webhook could not place (unknown org, unknown add-on, no matching row). */
export const ORG_ADDON_UNMATCHED_EVENT = 'charge.success.org_addon_subscription.unmatched'

/** The Paystack plan code for the Solar annual plan, read at call time. */
export function solarPlanCode(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | undefined {
  const value = env[FEATURE_PRICES.solar.planCodeEnv]?.trim()
  return value ? value : undefined
}

/** Plan code from a Paystack charge/subscription payload (object, plan_object, or bare string). */
export function planCodeOf(data: any): string | undefined {
  if (!data) return undefined
  if (typeof data.plan === 'string') return data.plan || undefined
  const code = data.plan?.plan_code ?? data.plan_object?.plan_code
  return typeof code === 'string' && code ? code : undefined
}

/** Subscription code from a Paystack charge payload (same fields the MV branch reads). */
export function subscriptionCodeOf(data: any): string | undefined {
  const code = data?.subscription?.subscription_code ?? data?.plan_object?.subscription_code
  return typeof code === 'string' && code ? code : undefined
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The new `current_period_end` after a charge or a renewal notice.
 *
 * Candidate = Paystack's `next_payment_date` when the event carries one
 * (subscription.create, invoice.update), else paid_at + 1 year (charge.success
 * carries no next date — same fallback as the MV branch). The result is the
 * LATER of the candidate and the stored end: an out-of-order or re-delivered
 * event must never take paid time away.
 */
export function nextAddonPeriodEnd(
  existingEnd: string | null | undefined,
  paidAt: string | null | undefined,
  nextPaymentDate?: string | null,
): string {
  let candidate = parseDate(nextPaymentDate)
  if (!candidate) {
    const from = parseDate(paidAt) ?? new Date()
    candidate = new Date(from.getTime())
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1)
  }
  const existing = parseDate(existingEnd)
  return (existing && existing.getTime() > candidate.getTime() ? existing : candidate).toISOString()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/paystack/org-addon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/paystack/org-addon.ts apps/web/src/lib/paystack/org-addon.test.ts
git commit -m "feat(paystack): pure helpers for the org add-on subscription

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /api/paystack/solar-subscribe`

Mirrors `mv-subscribe/route.ts` for the 503s, rate limit and plan-only initialize, with three differences. The org comes from the **project**. The gate is `requireRole(userClient, projectOrg, OWNER_ADMIN)`, which is the primitive against an entity-derived org, as `callback/route.ts:89-93` does: `require-role.ts:80-84` says org-wide billing surfaces use `requireRole`, and `requireRoleAPI` would pick the caller's *oldest* org. And the route writes nothing.

A project that the caller cannot see and a project whose org the caller is not owner/admin of both return the **same** 403. That way the route cannot be used to probe whether a project exists.

**Files:**
- Create: `apps/web/src/app/api/paystack/solar-subscribe/route.ts`
- Test: `apps/web/src/app/api/paystack/solar-subscribe/route.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/web/src/app/api/paystack/solar-subscribe/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OWNER_ADMIN } from '@esite/shared'

/**
 * /api/paystack/solar-subscribe starts the ORG-wide Solar subscription (D-01).
 *
 * Properties pinned:
 *  - the org is derived from the PROJECT, never from the caller's oldest org
 *    (requireRoleAPI's default) — a multi-org owner must buy for the project's
 *    org, and an owner of org A must not be able to buy "for" org B's project;
 *  - OWNER_ADMIN of that org only;
 *  - 409 when the org already has Solar (no second charge);
 *  - the route WRITES NOTHING: no service client is ever created — the
 *    webhook is the single writer (spec §1.2 "Writes nothing until the webhook");
 *  - return_to is the project's Solar page and cancel_action stays on-origin.
 */

const PROJECT_ID = '5a0e8f7c-1b2d-4c3e-9f4a-6b7c8d9e0f1a'
const PROJECT_ORG = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const {
  getUserMock,
  projectResult,
  projectFilters,
  requireRoleMock,
  orgHasSolarMock,
  rateLimitMock,
  fetchMock,
  serviceClientMock,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'
  return {
    getUserMock: vi.fn(),
    projectResult: { value: { data: null as any, error: null as any } },
    projectFilters: [] as Array<[string, unknown]>,
    requireRoleMock: vi.fn(),
    orgHasSolarMock: vi.fn(),
    rateLimitMock: vi.fn(),
    fetchMock: vi.fn(),
    serviceClientMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    schema: (s: string) => ({
      from: (t: string) => {
        const api: any = {
          select: () => api,
          eq: (c: string, v: unknown) => {
            projectFilters.push([`${s}.${t}.${c}`, v])
            return api
          },
          maybeSingle: () => Promise.resolve(projectResult.value),
        }
        return api
      },
    }),
  }),
  createServiceClient: (...a: unknown[]) => serviceClientMock(...a),
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a),
}))
vi.mock('@/lib/solar/access', () => ({
  orgHasSolar: (...a: unknown[]) => orgHasSolarMock(...a),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => rateLimitMock(...a),
}))

import { POST } from './route'

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

function sentInit() {
  return JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, any>
}

beforeEach(() => {
  process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = 'PLN_solar_annual'
  projectFilters.length = 0
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-owner', email: 'owner@org.co' } }, error: null })
  projectResult.value = { data: { id: PROJECT_ID, organisation_id: PROJECT_ORG }, error: null }
  requireRoleMock.mockReset().mockResolvedValue({ ok: true, role: 'owner' })
  orgHasSolarMock.mockReset().mockResolvedValue(false)
  rateLimitMock.mockReset().mockReturnValue(true)
  serviceClientMock.mockReset()
  fetchMock.mockReset().mockResolvedValue({
    json: async () => ({ status: true, data: { authorization_url: 'https://checkout.paystack.com/solar' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/paystack/solar-subscribe — configuration', () => {
  it('503s when the Solar plan is not configured, before touching the session', async () => {
    delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not configured/i)
    expect(getUserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/paystack/solar-subscribe — gates', () => {
  it('401s without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(401)
  })

  it('429s past 5 per minute per user', async () => {
    rateLimitMock.mockReturnValue(false)
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(429)
    expect(rateLimitMock).toHaveBeenCalledWith('solar-subscribe:u-owner', 5, 60_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ project_id: 'not-a-uuid' }], [{ project_id: 42 }], [null]])(
    '400s on a malformed body %j',
    async (body) => {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('400s when the body is not JSON rather than 500ing', async () => {
    const bad = { json: async () => { throw new SyntaxError('bad json') } } as unknown as Parameters<typeof POST>[0]
    const res = await POST(bad)
    expect(res.status).toBe(400)
  })

  it('reads the project by id through the CALLER session', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(projectFilters).toContainEqual(['projects.projects.id', PROJECT_ID])
  })

  it('403s for a project the caller cannot see, and never reaches the role gate', async () => {
    projectResult.value = { data: null, error: null }
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(requireRoleMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("gates on OWNER_ADMIN of the PROJECT's org — not the caller's primary org", async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(requireRoleMock).toHaveBeenCalledTimes(1)
    expect(requireRoleMock.mock.calls[0][1]).toBe(PROJECT_ORG)
    expect(requireRoleMock.mock.calls[0][2]).toEqual(OWNER_ADMIN)
  })

  it('403s a non-owner/admin with the SAME body as an invisible project — no existence oracle', async () => {
    projectResult.value = { data: null, error: null }
    const hidden = await (await POST(req({ project_id: PROJECT_ID }))).json()
    projectResult.value = { data: { id: PROJECT_ID, organisation_id: PROJECT_ORG }, error: null }
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(hidden)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('409s when the org already has Solar — asked about the PROJECT org', async () => {
    orgHasSolarMock.mockResolvedValue(true)
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(409)
    expect((await res.json()).alreadySubscribed).toBe(true)
    expect(orgHasSolarMock.mock.calls[0][0]).toBe(PROJECT_ORG)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/paystack/solar-subscribe — Paystack initialize', () => {
  it('subscribes to the Solar annual PLAN, sends no amount, and returns the hosted URL', async () => {
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authorization_url: 'https://checkout.paystack.com/solar' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/initialize')
    const init = sentInit()
    expect(init.plan).toBe('PLN_solar_annual')
    expect(init).not.toHaveProperty('amount')
    expect(init.currency).toBe('ZAR')
    expect(init.email).toBe('owner@org.co')
    expect(init.callback_url).toBe('https://www.e-site.live/api/paystack/callback')
  })

  it('carries the metadata the webhook and callback key on', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(sentInit().metadata).toMatchObject({
      type: 'org_addon_subscription',
      feature_key: 'solar',
      org_id: PROJECT_ORG,
      project_id: PROJECT_ID,
      user_id: 'u-owner',
      return_to: `/projects/${PROJECT_ID}/solar`,
    })
  })

  it('keeps cancel_action on-origin and on the project Solar page', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    const cancel = new URL(sentInit().metadata.cancel_action)
    expect(cancel.origin).toBe('https://www.e-site.live')
    expect(cancel.pathname).toBe(`/projects/${PROJECT_ID}/solar`)
  })

  it('writes NOTHING — no service client is ever created', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(serviceClientMock).not.toHaveBeenCalled()
  })

  it('502s when Paystack refuses', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: false, message: 'Invalid plan' }) })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Invalid plan')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/solar-subscribe/route.test.ts`
Expected: FAIL. Cannot resolve `./route`.

- [ ] **Step 3: Implement** — create `apps/web/src/app/api/paystack/solar-subscribe/route.ts`:

```ts
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { OWNER_ADMIN } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { orgHasSolar } from '@/lib/solar/access'
import { rateLimit } from '@/lib/rate-limit'
import { solarReturnTo } from '@/lib/paystack/return-to'
import { ORG_ADDON_METADATA_TYPE, solarPlanCode } from '@/lib/paystack/org-addon'

// Starts the ORG-wide Solar subscription (decision D-01: R1,999/yr excl. VAT,
// every project of the org) against the PAYSTACK_PLAN_SOLAR_ANNUAL recurring
// plan. Spec: docs/solar/03-data-model-and-security.md §2.3 point 4.
//
// WRITES NOTHING. Unlike /api/paystack/mv-subscribe there is no disclaimer to
// record, and a 'pending' row would make this route a second writer of
// billing.org_addon_subscriptions — the shape that once downgraded an active
// MV subscriber to 'pending' (see mv-subscribe/route.ts). The webhook
// (metadata.type === 'org_addon_subscription') inserts the row on the first
// successful charge and is the only writer thereafter.
//
// The ORG comes from the PROJECT, not from the caller's primary org: an owner
// of several orgs buys for the org that owns the project they are looking at.
// requireRole (the primitive) against that org — org-wide billing surfaces use
// requireRole, never requireEffectiveRole (see lib/auth/require-role.ts).
//
// OWNER ACTION REQUIRED: 503 until PAYSTACK_PLAN_SOLAR_ANNUAL holds a PLN_…
// code for an annual ZAR plan created on the Paystack dashboard.

const bodySchema = z.object({ project_id: z.string().uuid() })

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

/** One body for "no such project" and "not owner/admin of its org" — no existence oracle. */
const FORBIDDEN = {
  error: "Only an owner or admin of this project's organisation can subscribe to Solar",
}

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  // Plan-based only — there is no one-off fallback. Without a plan there is
  // nothing to subscribe the org to.
  const planCode = solarPlanCode()
  if (!planCode) {
    return NextResponse.json({ error: 'Solar subscription plan not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`solar-subscribe:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const projectId = parsed.data.project_id

  // Through the CALLER's session: a project they cannot see is refused here.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json(FORBIDDEN, { status: 403 })

  const guard = await requireRole(supabase as any, orgId, OWNER_ADMIN)
  if (!guard.ok) return NextResponse.json(FORBIDDEN, { status: 403 })

  // org_has_solar answers truthfully for an active member of the org, which
  // the gate above has just established. It fails closed (false) on an RPC
  // error, so a transient error lets the purchase proceed — the webhook's
  // duplicate-purchase handling is the backstop for that case.
  if (await orgHasSolar(orgId, supabase as any)) {
    return NextResponse.json(
      { error: 'Solar is already active for this organisation', alreadySubscribed: true },
      { status: 409 },
    )
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL
  const returnTo = solarReturnTo(projectId)
  const initBody = {
    email: user.email,
    currency: 'ZAR',
    plan: planCode,
    callback_url: `${site}/api/paystack/callback`,
    metadata: {
      type: ORG_ADDON_METADATA_TYPE,
      feature_key: 'solar' as const,
      org_id: orgId,
      project_id: projectId,
      user_id: user.id,
      return_to: returnTo,
      cancel_action: `${site}${returnTo}`,
    },
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(initBody),
  })

  const body = await response.json()
  if (!body.status) {
    return NextResponse.json({ error: body.message ?? 'Paystack error' }, { status: 502 })
  }

  return NextResponse.json({ authorization_url: body.data.authorization_url })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/solar-subscribe/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/solar-subscribe
git commit -m "feat(paystack): POST /api/paystack/solar-subscribe — org from the project, owner/admin, writes nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Callback allow-list gains `org_addon_subscription`

The Solar metadata carries `org_id` but no `tier`. Without this change the callback falls through to `if (!org_id || !tier)` (`callback/route.ts:68-71`) and sends a payer who has just been charged R1,999 to `?error=meta`.

**Files:**
- Modify: `apps/web/src/app/api/paystack/callback/route.ts:45-66`
- Test: `apps/web/src/app/api/paystack/callback/route.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `describe('GET /api/paystack/callback — non-subscription purchases (#18)', …)`, after `'returns an MV subscriber to a page their role can actually see'`:

```ts
  it('returns a Solar subscriber to the project Solar page, acknowledged, writing nothing', async () => {
    // org_addon_subscription metadata carries org_id but NO tier — under the
    // old allow-list this was a guaranteed ?error=meta after a R1,999 charge.
    const res = await purchase({
      type: 'org_addon_subscription',
      feature_key: 'solar',
      org_id: ORG_ID,
      project_id: 'p1',
      return_to: '/projects/p1/solar',
    })
    expect(location(res)).toContain('/projects/p1/solar')
    expect(location(res)).toMatch(/[?&]payment=received/)
    expect(location(res)).not.toContain('error=meta')
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/callback/route.test.ts`
Expected: FAIL. The location contains `error=meta`.

- [ ] **Step 3: Implement.** In `callback/route.ts`, replace lines 45-66 (the `// ── Non-subscription purchases` comment block through the closing `}` of the `if (purchaseType === …)` block) with:

```ts
  // ── Non-subscription purchases ───────────────────────────────────────────
  // Branch on metadata.type BEFORE the org_id/tier gate below. feature_unlock,
  // feature_seat, mv_subscription and org_addon_subscription carry no `tier`
  // (mv carries no `org_id` either), so every one of them used to fall into
  // ?error=meta — a customer who had just paid R250, R1,999 or R2,000 landed on
  // an unrelated page with no confirmation, which is the realistic path into
  // paying twice.
  //
  // The webhook remains the SOLE writer of these entitlements: a single writer
  // keeps the duplicate-purchase (23505 / live-subscription) handling in one
  // place. The buyer may therefore arrive a second or two before the grant
  // lands, so the destination is told `payment=received` rather than being
  // asserted as already unlocked (the Solar locked page polls — spec §1.2).
  const purchaseType = metadata.type
  if (
    purchaseType === 'feature_unlock' ||
    purchaseType === 'feature_seat' ||
    purchaseType === 'mv_subscription' ||
    purchaseType === 'org_addon_subscription'
  ) {
    return NextResponse.redirect(
      new URL(withParams(returnTo, { payment: 'received', ref: reference }), req.url),
    )
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/callback/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/callback/route.ts apps/web/src/app/api/paystack/callback/route.test.ts
git commit -m "fix(paystack): callback returns a Solar subscriber to the project, not ?error=meta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Webhook — first Solar charge

**Files:**
- Modify: `apps/web/src/app/api/paystack/webhook/route.ts` (imports :1-5; helpers after `resolveUserOrg` :174-185; new branch after the MV branch that ends at :407)
- Test: `apps/web/src/app/api/paystack/webhook/route.test.ts` (import line 2; append at end of file)

- [ ] **Step 1: Write the failing tests.** Change line 2 of `webhook/route.test.ts` to:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
```

Append this at the **end** of the file. Tasks 9-12 append further `describe` blocks after it and reuse its fixtures.

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Org add-on subscription — Solar (billing.org_addon_subscriptions, 00207)
//
// The webhook is the ONLY writer of that table. Every assertion below checks
// the WRITE (or its absence), never just the 200, for the reason given at the
// top of this file.
// ─────────────────────────────────────────────────────────────────────────────

const SOLAR_PLAN = 'PLN_solar_annual'
const SOLAR_ORG = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const ADDON = 'billing.org_addon_subscriptions'
const PAID_AT = '2026-09-28T10:00:00.000Z'

function solarFirstCharge(meta: Record<string, unknown> = {}) {
  return {
    event: 'charge.success',
    data: {
      reference: REF,
      amount: 199900,
      paid_at: PAID_AT,
      customer: { customer_code: 'CUS_solar' },
      plan: { plan_code: SOLAR_PLAN },
      metadata: {
        type: 'org_addon_subscription',
        feature_key: 'solar',
        org_id: SOLAR_ORG,
        project_id: 'p-1',
        user_id: 'u-owner',
        return_to: '/projects/p-1/solar',
        ...meta,
      },
    },
  }
}

/** The stored subscription row, as the webhook selects it. */
function addonRow(over: Record<string, unknown> = {}) {
  return {
    id: 'oas-1',
    organisation_id: SOLAR_ORG,
    status: 'active',
    current_period_end: '2027-09-28T10:00:00.000Z',
    last_event_id: REF,
    paystack_subscription_code: 'SUB_solar',
    ...over,
  }
}

const orgExists = { 'public.organisations.select': { data: { id: SOLAR_ORG }, error: null } }

describe('org add-on — first Solar charge', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  it('inserts an ACTIVE row with a one-year period — never pending', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    const ins = serviceClientRef.value.of(`${ADDON}.insert`)
    expect(ins).toHaveLength(1)
    expect(ins[0].payload).toMatchObject({
      organisation_id: SOLAR_ORG,
      feature_key: 'solar',
      status: 'active',
      amount_kobo: 199900,
      current_period_end: '2027-09-28T10:00:00.000Z',
      paystack_customer_code: 'CUS_solar',
      last_event_id: REF,
      started_at: PAID_AT,
    })
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('books the charge: invoice to the org + the reference→org payment event a refund needs', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(solarFirstCharge()))
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(SOLAR_ORG)
    expect(recordInvoiceMock.mock.calls[0][2]).toMatchObject({ paystackReference: REF, status: 'paid', amountKobo: 199900 })
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/Solar/)
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({
      event_type: 'charge.success.org_addon_subscription',
      paystack_reference: REF,
      organisation_id: SOLAR_ORG,
    })
  })

  it('never touches the org TIER subscription', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    await POST(signedReq(solarFirstCharge()))
    expect(upsertSubscriptionMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('a duplicate delivery re-grants nothing but still (idempotently) books the invoice', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: { data: addonRow({ last_event_id: REF }), error: null },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    // The invoice write is idempotent on paystack_reference; a first attempt
    // that 500'd AFTER the grant must still get its invoice on the retry.
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it('an unknown org: 200 (a retry cannot fix it), nothing granted, the money logged', async () => {
    serviceClientRef.value = makeClient({ 'public.organisations.select': { data: null, error: null } })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    const ev = serviceClientRef.value.of('billing.payment_events.upsert')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload).toMatchObject({
      event_type: 'charge.success.org_addon_subscription.unmatched',
      paystack_reference: REF,
      organisation_id: null,
    })
  })

  it('an unknown add-on key is logged, not granted, and never looks the org up', async () => {
    serviceClientRef.value = makeClient({ ...orgExists })
    const res = await POST(signedReq(solarFirstCharge({ feature_key: 'jbcc' })))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('public.organisations.select')).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })

  it('a resubscribe after a refund restores the row (D-02) and forgets the dead Paystack code', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: {
        data: addonRow({
          status: 'refunded',
          last_event_id: 'ref_old',
          current_period_end: '2026-03-01T00:00:00.000Z',
          paystack_subscription_code: 'SUB_old',
        }),
        error: null,
      },
    })
    await POST(signedReq(solarFirstCharge()))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2027-09-28T10:00:00.000Z',
      last_event_id: REF,
      paystack_subscription_code: null,
      started_at: PAID_AT,
      cancelled_at: null,
      refunded_at: null,
    })
    expect(upd[0].filters).toEqual([['eq', 'id', 'oas-1']])
  })

  it('a second first-charge while LIVE is a double purchase: no grant, admins told, invoice marked', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.select`]: {
        data: addonRow({ last_event_id: 'ref_other', current_period_end: '2027-12-31T00:00:00.000Z' }),
        error: null,
      },
      'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.insert`)).toHaveLength(0)
    const note = serviceClientRef.value.of('public.notifications.insert')
    expect(note).toHaveLength(1)
    expect(note[0].payload[0]).toMatchObject({ type: 'billing_duplicate_charge', organisation_id: SOLAR_ORG })
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/DUPLICATE/)
    // Logged under its OWN type, so refunding the duplicate can never lock the live subscription.
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.duplicate',
    )
  })

  it('a failed grant 500s BEFORE any invoice or payment event is written', async () => {
    serviceClientRef.value = makeClient({
      ...orgExists,
      [`${ADDON}.insert`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(0)
  })

  it('a failed organisation lookup 500s (retryable) rather than being logged as unmatched', async () => {
    serviceClientRef.value = makeClient({
      'public.organisations.select': { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarFirstCharge()))
    expect(res.status).toBe(500)
    expect(serviceClientRef.value.of('billing.payment_events.upsert')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts -t "first Solar charge"`
Expected: FAIL. No `org_addon_subscriptions.insert` is recorded: the metadata has no `tier`, so today it falls through to Branch C and the `renewalSub` lookup.

- [ ] **Step 3a: Implement — imports.** Replace `webhook/route.ts` lines 4-5 with:

```ts
import { billingService, FEATURE_PRICES } from '@esite/shared'
import { addBillingPeriod } from '@/lib/paystack/billing-period'
import {
  ORG_ADDON_METADATA_TYPE,
  ORG_ADDON_CHARGE_EVENT,
  ORG_ADDON_DUPLICATE_EVENT,
  ORG_ADDON_UNMATCHED_EVENT,
  nextAddonPeriodEnd,
  subscriptionCodeOf,
} from '@/lib/paystack/org-addon'
```

- [ ] **Step 3b: Implement — helpers.** Insert immediately after the closing `}` of `resolveUserOrg` (the line `  return (data as { organisation_id?: string } | null)?.organisation_id ?? null` followed by `}`) and before the `// ─────…` separator that precedes `export async function POST`:

```ts

// ── Org add-on subscriptions (Solar — billing.org_addon_subscriptions, 00207) ─
//
// THIS ROUTE IS THE ONLY WRITER of billing.org_addon_subscriptions (service
// client; the table has SELECT for org owner/admin and no write policy).
// /api/paystack/solar-subscribe writes nothing — the first successful charge
// INSERTS the row. Idempotency: `last_event_id` holds the Paystack charge
// REFERENCE of the last charge applied — unique per charge and always present.
// (MV keys on `event.id ?? reference`; Paystack documents no top-level event
// id, so that is the reference in practice anyway.)

interface AddonRow {
  id: string
  organisation_id: string
  status: string
  current_period_end: string | null
  last_event_id: string | null
  paystack_subscription_code: string | null
}

const ADDON_COLUMNS =
  'id, organisation_id, status, current_period_end, last_event_id, paystack_subscription_code'

function addonTable(supabase: Client) {
  return (supabase as any).schema('billing').from('org_addon_subscriptions')
}

/**
 * Apply one successful Solar charge (first or renewal) to the org's row, then
 * log it and invoice it. Order matters: grant → payment event → notification
 * → invoice, so a failure 500s before the invoice and the retry finds a
 * clean state (the same rule as every other branch in this file).
 */
async function applyOrgAddonCharge(
  supabase: Client,
  a: { orgId: string; existing: AddonRow | null; data: any; firstCharge: boolean },
): Promise<NextResponse> {
  const { orgId, existing, data, firstCharge } = a
  const reference = data.reference as string
  const amountKobo = (data.amount as number | undefined) ?? FEATURE_PRICES.solar.amountKobo
  const paidAt = (data.paid_at as string | undefined) ?? new Date().toISOString()
  const customerCode = data.customer?.customer_code as string | undefined
  const subscriptionCode = subscriptionCodeOf(data)

  // Already applied: a duplicate delivery, or a retry after a LATER write
  // failed. Skip only the grant — the payment event and invoice are idempotent
  // on the reference and must still land. (The MV branch returns early here,
  // which strands a charge with no invoice if its first attempt 500'd after
  // the grant.)
  const alreadyApplied = !!existing?.last_event_id && existing.last_event_id === reference

  // A FIRST charge (it carries initialize-time metadata) for an org whose
  // subscription is still live is a SECOND purchase — two tabs, or a race past
  // the route's 409. Money moved: book it and escalate it, never extend with it.
  const live =
    !!existing &&
    (existing.status === 'active' || existing.status === 'non_renewing') &&
    !!existing.current_period_end &&
    new Date(existing.current_period_end).getTime() > new Date(paidAt).getTime()
  const duplicatePurchase = firstCharge && !alreadyApplied && live

  if (!alreadyApplied && !duplicatePurchase) {
    const periodEnd = nextAddonPeriodEnd(existing?.current_period_end, paidAt)
    if (existing) {
      const patch: Record<string, unknown> = {
        status: 'active',
        current_period_end: periodEnd,
        amount_kobo: amountKobo,
        last_event_id: reference,
      }
      if (customerCode) patch.paystack_customer_code = customerCode
      if (firstCharge) {
        // A resubscribe after a lapse, cancel or refund — D-02: everything
        // returns. The old Paystack subscription is dead; forget its code so
        // subscription.create can bind the new one.
        patch.paystack_subscription_code = subscriptionCode ?? null
        patch.started_at = paidAt
        patch.cancelled_at = null
        patch.refunded_at = null
      } else if (subscriptionCode) {
        patch.paystack_subscription_code = subscriptionCode
      }
      const { error } = await addonTable(supabase).update(patch).eq('id', existing.id)
      if (error) return storageFailure('org_addon renewal', error)
    } else {
      const { error } = await addonTable(supabase).insert({
        organisation_id: orgId,
        feature_key: 'solar',
        status: 'active',
        amount_kobo: amountKobo,
        current_period_end: periodEnd,
        paystack_customer_code: customerCode ?? null,
        paystack_subscription_code: subscriptionCode ?? null,
        last_event_id: reference,
        started_at: paidAt,
      })
      // A 23505 on org_addon_subscriptions_org_feature_key means a concurrent
      // delivery inserted first: 500, and Paystack's retry takes the update path.
      if (error) return storageFailure('org_addon grant', error)
    }
  }

  // The reference → org map a refund or chargeback needs (the subscription
  // table stores no references). A duplicate purchase is logged under its OWN
  // type, so refunding it — which the notification asks for — never matches
  // the refund lookup and locks the org's live subscription.
  const logged = await logPaymentEvent(supabase, {
    eventType: duplicatePurchase ? ORG_ADDON_DUPLICATE_EVENT : ORG_ADDON_CHARGE_EVENT,
    reference,
    organisationId: orgId,
    amountKobo,
    payload: { first_charge: firstCharge, paid_at: paidAt, subscription_code: subscriptionCode ?? null },
  })
  if (logged.error) return storageFailure('org_addon payment-event log', logged.error)

  if (duplicatePurchase) {
    const notified = await notifyOrgAdmins(supabase, orgId, {
      type: 'billing_duplicate_charge',
      title: 'Duplicate payment received',
      body:
        `A second Solar subscription payment was taken (reference ${reference}) while Solar is ` +
        `already active for this organisation. A refund is required, and the extra Paystack ` +
        `subscription should be cancelled.`,
      data: { reference, feature_key: 'solar', amount_kobo: amountKobo },
    })
    if (notified.error) return storageFailure('duplicate-charge notification', notified.error)
  }

  try {
    await billingService.recordInvoice(supabase as any, orgId, {
      paystackReference: reference,
      amountKobo,
      status: 'paid',
      description: duplicatePurchase
        ? 'DUPLICATE PURCHASE — Solar module subscription (already active; refund required)'
        : `Solar module subscription (annual)${firstCharge ? ' — first charge' : ' — renewal'}`,
      paidAt,
    })
  } catch (err) {
    return storageFailure('org_addon invoice', err)
  }

  return ok()
}
```

- [ ] **Step 3c: Implement — the branch.** Insert immediately after the MV branch (after its closing `return ok()\n    }` at `route.ts:406-407`) and before the `// Branch B: subscription charge (recurring or one-off fallback).` comment:

```ts

    // Branch A3: org add-on subscription — FIRST charge (Solar, 00207).
    // Discriminated by metadata.type set in /api/paystack/solar-subscribe.
    // Must sit before Branch B: this metadata carries org_id but no tier, so
    // it would otherwise fall to Branch C and be matched against the org's
    // TIER subscription by customer code. Renewals (metadata 0) are matched
    // in Branch C0 below.
    if (metadata.type === ORG_ADDON_METADATA_TYPE) {
      const orgId = typeof metadata.org_id === 'string' ? metadata.org_id : null
      if (!orgId || metadata.feature_key !== 'solar') {
        const logged = await logPaymentEvent(supabase, {
          eventType: ORG_ADDON_UNMATCHED_EVENT,
          reference: data.reference,
          amountKobo: data.amount,
          payload: { reason: 'metadata names no org or an unknown add-on', metadata },
        })
        if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
        return ok()
      }

      // An org that does not exist is a condition no retry can fix (the FK
      // insert would 23503 forever — a poison pill). Record the money, ack.
      const { data: org, error: orgErr } = await (supabase as any)
        .from('organisations')
        .select('id')
        .eq('id', orgId)
        .maybeSingle()
      if (orgErr) return storageFailure('org_addon organisation lookup', orgErr)
      if (!org) {
        const logged = await logPaymentEvent(supabase, {
          eventType: ORG_ADDON_UNMATCHED_EVENT,
          reference: data.reference,
          amountKobo: data.amount,
          payload: { reason: 'organisation not found', org_id: orgId },
        })
        if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
        return ok()
      }

      const { data: existing, error: readErr } = await addonTable(supabase)
        .select(ADDON_COLUMNS)
        .eq('organisation_id', orgId)
        .eq('feature_key', 'solar')
        .maybeSingle()
      if (readErr) return storageFailure('org_addon read', readErr)

      return applyOrgAddonCharge(supabase, {
        orgId,
        existing: (existing as AddonRow | null) ?? null,
        data,
        firstCharge: true,
      })
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts`
Expected: PASS, the whole file (existing tests unchanged, plus the 10 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/webhook/route.ts apps/web/src/app/api/paystack/webhook/route.test.ts
git commit -m "feat(paystack): webhook grants the Solar org subscription on its first charge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Webhook — renewals (`charge.success` without metadata, `invoice.update`, `subscription.create`)

A renewal `charge.success` carries `"metadata": 0` (`route.ts:214-217`). Branch C (`:456-507`) matches such a charge against `billing.subscriptions` by subscription code, **then by customer code**. A Solar renewal paid by the same Paystack customer as the org's tier plan would be booked as a tier renewal, and it would flip the tier subscription to `active`. So Branch C0 must run first, and a Solar-plan charge must never reach Branch C.

**Files:**
- Modify: `apps/web/src/app/api/paystack/webhook/route.ts`
- Test: `apps/web/src/app/api/paystack/webhook/route.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to the end of `webhook/route.test.ts`:

```ts
describe('org add-on — renewals', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  const RENEW_REF = 'ref_renew_002'

  function solarRenewal(extra: Record<string, unknown> = {}) {
    return {
      event: 'charge.success',
      data: {
        reference: RENEW_REF,
        amount: 199900,
        paid_at: '2027-09-28T09:59:00.000Z',
        metadata: 0, // Paystack literally sends `"metadata": 0` on renewals
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_solar' },
        ...extra,
      },
    }
  }

  it('matches on subscription_code, extends the period and books the invoice to the org', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({
      status: 'active',
      current_period_end: '2028-09-28T09:59:00.000Z',
      last_event_id: RENEW_REF,
    })
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(SOLAR_ORG)
    expect(recordInvoiceMock.mock.calls[0][2].description).toMatch(/renewal/)
  })

  it('never reaches Branch C — the tier subscription is not even looked up', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('falls back to customer_code + Solar plan when the code was never stored', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    await POST(signedReq(solarRenewal({ subscription: undefined })))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('active')
  })

  it('an unplaceable Solar-plan charge is logged and NEVER booked as a tier renewal', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
    expect(serviceClientRef.value.of('billing.payment_events.upsert')[0].payload.event_type).toBe(
      'charge.success.org_addon_subscription.unmatched',
    )
  })

  it('a duplicate renewal delivery does not re-extend', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ last_event_id: RENEW_REF }), error: null },
    })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    expect(recordInvoiceMock).toHaveBeenCalledTimes(1)
  })

  it('never shortens a period already paid for', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow({ current_period_end: '2029-01-01T00:00:00.000Z' }), error: null },
    })
    await POST(signedReq(solarRenewal()))
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload.current_period_end).toBe(
      '2029-01-01T00:00:00.000Z',
    )
  })

  it('a non-Solar renewal still reaches Branch C untouched', async () => {
    serviceClientRef.value = makeClient({
      'billing.subscriptions.select': {
        data: { id: 's1', organisation_id: ORG, tier: 'starter', billing_period: 'monthly' },
        error: null,
      },
    })
    await POST(signedReq(solarRenewal({ plan: { plan_code: 'PLN_starter' }, subscription: undefined })))
    expect(recordInvoiceMock.mock.calls[0][1]).toBe(ORG)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  function solarInvoiceUpdate(status: 'success' | 'failed') {
    return {
      event: 'invoice.update',
      data: {
        status,
        amount: 199900,
        paid_at: '2027-09-28T09:59:00.000Z',
        transaction: { reference: RENEW_REF },
        subscription: { subscription_code: 'SUB_solar', next_payment_date: '2028-09-28T10:00:00.000Z' },
      },
    }
  }

  it('invoice.update paid → active with the period from next_payment_date', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq(solarInvoiceUpdate('success')))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'active', current_period_end: '2028-09-28T10:00:00.000Z' })
  })

  it('invoice.update failed → past_due, only from active', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq(solarInvoiceUpdate('failed')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd[0].payload).toEqual({ status: 'past_due' })
    expect(upd[0].filters).toEqual(expect.arrayContaining([['eq', 'id', 'oas-1'], ['eq', 'status', 'active']]))
  })

  it('subscription.create binds the Paystack code and never shortens or re-activates', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    const res = await POST(signedReq({
      event: 'subscription.create',
      data: {
        subscription_code: 'SUB_new',
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        next_payment_date: '2027-09-28T00:00:00.000Z',
      },
    }))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({
      paystack_subscription_code: 'SUB_new',
      current_period_end: '2027-09-28T10:00:00.000Z', // stored end is later — kept
    })
  })

  it('a lookup failure 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(solarRenewal()))
    expect(res.status).toBe(500)
    expect(recordInvoiceMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts -t "org add-on — renewals"`
Expected: FAIL. No addon update is recorded, and the unplaceable charge reaches `billing.subscriptions.select`.

- [ ] **Step 3a: Implement — imports.** Extend the `@/lib/paystack/org-addon` import from Task 8 so it reads:

```ts
import {
  ORG_ADDON_METADATA_TYPE,
  ORG_ADDON_CHARGE_EVENT,
  ORG_ADDON_DUPLICATE_EVENT,
  ORG_ADDON_UNMATCHED_EVENT,
  nextAddonPeriodEnd,
  planCodeOf,
  solarPlanCode,
  subscriptionCodeOf,
} from '@/lib/paystack/org-addon'
```

- [ ] **Step 3b: Implement — matcher + past-due helper.** Insert directly after the `addonTable` function from Task 8 (before the `applyOrgAddonCharge` doc comment):

```ts

/**
 * Find the org add-on row a Paystack event belongs to: by subscription code,
 * else by customer code — but ONLY when the event's plan is the Solar plan, so
 * a tier-plan event from the same payer is never mistaken for Solar.
 * `solarPlan` tells the caller the event IS a Solar-plan event even when no
 * row matched, so it can refuse to let the event fall into a tier branch.
 * More than one row for one customer code (one person paying for two orgs)
 * is ambiguous: no row, never a guess.
 */
async function findOrgAddon(
  supabase: Client,
  codes: { subscriptionCode?: string; customerCode?: string; planCode?: string },
): Promise<{ row: AddonRow | null; solarPlan: boolean; error: PgError }> {
  if (codes.subscriptionCode) {
    const { data, error } = await addonTable(supabase)
      .select(ADDON_COLUMNS)
      .eq('paystack_subscription_code', codes.subscriptionCode)
      .maybeSingle()
    if (error) return { row: null, solarPlan: false, error: error as PgError }
    if (data) return { row: data as AddonRow, solarPlan: true, error: null }
  }

  const plan = solarPlanCode()
  const solarPlan = !!plan && codes.planCode === plan
  if (!solarPlan || !codes.customerCode) return { row: null, solarPlan, error: null }

  const { data, error } = await addonTable(supabase)
    .select(ADDON_COLUMNS)
    .eq('paystack_customer_code', codes.customerCode)
    .eq('feature_key', 'solar')
    .maybeSingle()
  if (error) {
    if ((error as PgError)?.code === 'PGRST116') {
      console.warn(`Paystack webhook: customer ${codes.customerCode} holds several Solar subscriptions; not guessing`)
      return { row: null, solarPlan, error: null }
    }
    return { row: null, solarPlan, error: error as PgError }
  }
  return { row: (data as AddonRow | null) ?? null, solarPlan, error: null }
}

/** A failed renewal: active → past_due. Never resurrects a cancelled/refunded row. */
async function markOrgAddonPastDue(supabase: Client, row: AddonRow): Promise<PgError> {
  const { error } = await addonTable(supabase)
    .update({ status: 'past_due' })
    .eq('id', row.id)
    .eq('status', 'active')
  return (error as PgError) ?? null
}
```

- [ ] **Step 3c: Implement — Branch C0.** In the `charge.success` block, find these three lines (currently `:461-463`):

```ts
    const customerCode = data.customer?.customer_code as string | undefined
    const subCode = data.subscription?.subscription_code as string | undefined
    const renewalPlanCode = (data.plan?.plan_code ?? data.plan_object?.plan_code) as string | undefined
```

Insert immediately after them, before `const renewalSub = (await (async () => {`:

```ts

    // Branch C0: an org add-on (Solar) renewal. Must run BEFORE the tier
    // lookup below, which matches on customer_code — the same Paystack
    // customer often pays both the tier plan and Solar, and would have this
    // charge booked as a tier renewal (flipping that subscription 'active').
    const addonRenewal = await findOrgAddon(supabase, {
      subscriptionCode: subscriptionCodeOf(data),
      customerCode,
      planCode: planCodeOf(data),
    })
    if (addonRenewal.error) return storageFailure('org_addon renewal lookup', addonRenewal.error)
    if (addonRenewal.row) {
      return applyOrgAddonCharge(supabase, {
        orgId: addonRenewal.row.organisation_id,
        existing: addonRenewal.row,
        data,
        firstCharge: false,
      })
    }
    if (addonRenewal.solarPlan) {
      const logged = await logPaymentEvent(supabase, {
        eventType: ORG_ADDON_UNMATCHED_EVENT,
        reference: data.reference,
        amountKobo: data.amount,
        payload: { reason: 'Solar-plan charge matched no subscription', customer_code: customerCode ?? null },
      })
      if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
      return ok()
    }
```

- [ ] **Step 3d: Implement — `invoice.update`.** In the `invoice.update` block, replace:

```ts
    console.warn(`Webhook invoice.update: no subscription matched code=${subscriptionCode}`)
    return ok()
  }
```

with:

```ts
    // Not an org or MV subscription — try the org add-on (Solar).
    const addon = await findOrgAddon(supabase, { subscriptionCode })
    if (addon.error) return storageFailure('org_addon invoice lookup', addon.error)
    if (addon.row) {
      if (paid) {
        const { error: addonErr } = await addonTable(supabase)
          .update({
            status: 'active',
            current_period_end: nextAddonPeriodEnd(
              addon.row.current_period_end,
              inv.paid_at as string | undefined,
              nextPaymentDate,
            ),
          })
          .eq('id', addon.row.id)
        if (addonErr) return storageFailure('org_addon renewal update', addonErr)
      } else {
        const failErr = await markOrgAddonPastDue(supabase, addon.row)
        if (failErr) return storageFailure('org_addon past_due', failErr)
      }
      return ok()
    }

    console.warn(`Webhook invoice.update: no subscription matched code=${subscriptionCode}`)
    return ok()
  }
```

- [ ] **Step 3e: Implement — `subscription.create`.** Replace the whole `subscription.create` block (currently `:769-786`, from `if (event.event === 'subscription.create') {` to its closing `}`) with:

```ts
  if (event.event === 'subscription.create') {
    const sub = event.data
    const customerCode = sub.customer?.customer_code
    const planCode = sub.plan?.plan_code
    if (customerCode && planCode) {
      const { error } = await supabase
        .schema('billing')
        .from('subscriptions')
        .update({
          paystack_subscription_code: sub.subscription_code,
          next_billing_date: sub.next_payment_date ?? null,
          status: 'active',
        })
        .eq('paystack_customer_code', customerCode)
        .eq('paystack_plan_code', planCode)
      if (error) console.error('Webhook subscription.create error:', error)
    }

    // Org add-on (Solar): bind the Paystack subscription code the first
    // charge usually does not carry, so not_renew/disable/invoice.update can
    // find the row by code. Status is NOT touched — creating a subscription is
    // not payment, and must not resurrect a refunded row.
    const addon = await findOrgAddon(supabase, {
      subscriptionCode: sub.subscription_code,
      customerCode,
      planCode,
    })
    if (addon.error) return storageFailure('org_addon subscription.create lookup', addon.error)
    if (addon.row) {
      const patch: Record<string, unknown> = { paystack_subscription_code: sub.subscription_code }
      if (sub.next_payment_date) {
        patch.current_period_end = nextAddonPeriodEnd(addon.row.current_period_end, null, sub.next_payment_date)
      }
      const { error: bindErr } = await addonTable(supabase).update(patch).eq('id', addon.row.id)
      if (bindErr) return storageFailure('org_addon subscription.create', bindErr)
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts`
Expected: PASS, the whole file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/webhook/route.ts apps/web/src/app/api/paystack/webhook/route.test.ts
git commit -m "feat(paystack): webhook renews the Solar subscription; a Solar charge never reaches the tier branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Webhook — `subscription.not_renew` and `subscription.disable`

The existing block (`:788-806`) maps both events to `cancelled` for tier subscriptions. For Solar the spec asks for **different** states: `not_renew → non_renewing`, which keeps access until `current_period_end` because `solar.org_subscription_active` admits `non_renewing` (`00207:190-198`), and `disable → cancelled`. Status guards stop a late or re-delivered event from moving a row backwards.

**Files:**
- Modify: `apps/web/src/app/api/paystack/webhook/route.ts`
- Test: `apps/web/src/app/api/paystack/webhook/route.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```ts
describe('org add-on — not_renew / disable', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  function subEvent(event: string, extra: Record<string, unknown> = {}) {
    return {
      event,
      data: {
        subscription_code: 'SUB_solar',
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        ...extra,
      },
    }
  }

  it('not_renew → non_renewing, keeping the paid period (access runs to its end)', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq(subEvent('subscription.not_renew')))
    expect(res.status).toBe(200)
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'non_renewing' })
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['eq', 'id', 'oas-1'], ['in', 'status', ['active', 'past_due']]]),
    )
  })

  it('disable → cancelled + cancelled_at, never overwriting a refunded row', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq(subEvent('subscription.disable')))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('cancelled')
    expect(upd[0].payload.cancelled_at).toEqual(expect.any(String))
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([['in', 'status', ['active', 'non_renewing', 'past_due']]]),
    )
  })

  it('matches by customer + Solar plan when the code was never bound', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: (ctx: any) =>
        ctx.filters.some((f: any) => f[1] === 'paystack_customer_code')
          ? { data: addonRow({ paystack_subscription_code: null }), error: null }
          : { data: null, error: null },
    })
    await POST(signedReq(subEvent('subscription.not_renew')))
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload).toEqual({ status: 'non_renewing' })
  })

  it('an event for a subscription that is not Solar touches no add-on row', async () => {
    serviceClientRef.value = makeClient()
    await POST(signedReq(subEvent('subscription.disable', { plan: { plan_code: 'PLN_starter' } })))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed write 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      [`${ADDON}.select`]: { data: addonRow(), error: null },
      [`${ADDON}.update`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(subEvent('subscription.disable')))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts -t "not_renew / disable"`
Expected: FAIL. No addon update is recorded.

- [ ] **Step 3: Implement.** In the `subscription.disable || subscription.not_renew` block, find:

```ts
    if (mvCancelErr) console.error('Webhook mv cancel error:', mvCancelErr)
  }
```

and replace it with:

```ts
    if (mvCancelErr) console.error('Webhook mv cancel error:', mvCancelErr)

    // Org add-on (Solar). Unlike the tier subscription above, the two events
    // mean different things here (spec §2.3.4): not_renew keeps access until
    // current_period_end (org_subscription_active admits 'non_renewing');
    // disable ends it. The status guards stop a late or re-delivered event
    // from moving a row backwards (disable never overwrites 'refunded';
    // not_renew never revives 'cancelled').
    const addon = await findOrgAddon(supabase, {
      subscriptionCode: sub.subscription_code,
      customerCode: sub.customer?.customer_code,
      planCode: sub.plan?.plan_code,
    })
    if (addon.error) return storageFailure('org_addon cancel lookup', addon.error)
    if (addon.row) {
      const { error: addonCancelErr } =
        event.event === 'subscription.not_renew'
          ? await addonTable(supabase)
              .update({ status: 'non_renewing' })
              .eq('id', addon.row.id)
              .in('status', ['active', 'past_due'])
          : await addonTable(supabase)
              .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
              .eq('id', addon.row.id)
              .in('status', ['active', 'non_renewing', 'past_due'])
      if (addonCancelErr) return storageFailure('org_addon cancel', addonCancelErr)
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/webhook/route.ts apps/web/src/app/api/paystack/webhook/route.test.ts
git commit -m "feat(paystack): Solar not_renew → non_renewing, disable → cancelled

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Webhook — refund and chargeback → `refunded` (hidden but kept)

**Files:**
- Modify: `apps/web/src/app/api/paystack/webhook/route.ts` (refund block `:621-705`, dispute block `:713-750`)
- Test: `apps/web/src/app/api/paystack/webhook/route.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```ts
describe('org add-on — refund / chargeback → refunded (D-02: hidden but kept)', () => {
  const solarCharge = {
    'billing.payment_events.select': { data: { organisation_id: SOLAR_ORG }, error: null },
    'public.user_organisations.select': { data: [{ user_id: 'u-owner' }], error: null },
  }

  const refundProcessed = {
    event: 'refund.processed',
    data: { status: 'processed', amount: 199900, transaction_reference: REF },
  }

  it('finds the org through the charge payment-event and marks the row refunded', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(200)
    const lookup = serviceClientRef.value.of('billing.payment_events.select')
    expect(lookup[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'event_type', 'charge.success.org_addon_subscription'],
        ['eq', 'paystack_reference', REF],
      ]),
    )
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.status).toBe('refunded')
    expect(upd[0].payload.refunded_at).toEqual(expect.any(String))
    expect(upd[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'organisation_id', SOLAR_ORG],
        ['eq', 'feature_key', 'solar'],
        ['neq', 'status', 'refunded'],
      ]),
    )
  })

  it('tells the org owners/admins once, and says the data is kept', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    await POST(signedReq(refundProcessed))
    const note = serviceClientRef.value.of('public.notifications.insert')
    expect(note).toHaveLength(1)
    expect(note[0].payload[0]).toMatchObject({ type: 'billing_refund_processed', organisation_id: SOLAR_ORG })
    expect(note[0].payload[0].body).toMatch(/kept/i)
  })

  it('a duplicate refund delivery changes no row and notifies nobody', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [], error: null }, // already refunded → 0 rows
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('public.notifications.insert')).toHaveLength(0)
  })

  it('a refund for a reference that was never a Solar charge touches no add-on row', async () => {
    serviceClientRef.value = makeClient() // payment_events lookup → null
    await POST(signedReq(refundProcessed))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('refund.pending takes nothing away', async () => {
    serviceClientRef.value = makeClient({ ...solarCharge })
    await POST(signedReq({ ...refundProcessed, event: 'refund.pending' }))
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed revoke 500s so Paystack retries', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: null, error: { code: '08006', message: 'connection failure' } },
    })
    const res = await POST(signedReq(refundProcessed))
    expect(res.status).toBe(500)
  })

  it('a chargeback the merchant lost (dispute resolved merchant-accepted) → refunded', async () => {
    serviceClientRef.value = makeClient({
      ...solarCharge,
      [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null },
    })
    const res = await POST(signedReq({
      event: 'charge.dispute.resolve',
      data: { status: 'resolved', resolution: 'merchant-accepted', transaction: { reference: REF, amount: 199900 } },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload.status).toBe('refunded')
  })

  it('an OPENED dispute, or one the merchant won, takes nothing away', async () => {
    for (const ev of [
      { event: 'charge.dispute.create', data: { status: 'awaiting-merchant-feedback', transaction: { reference: REF } } },
      { event: 'charge.dispute.resolve', data: { status: 'resolved', resolution: 'declined', transaction: { reference: REF } } },
    ]) {
      serviceClientRef.value = makeClient({ ...solarCharge, [`${ADDON}.update`]: { data: [{ id: 'oas-1' }], error: null } })
      await POST(signedReq(ev))
      expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts -t "refund / chargeback"`
Expected: FAIL. No addon update is recorded.

- [ ] **Step 3a: Implement — helper.** Insert directly after `markOrgAddonPastDue` (Task 9):

```ts

/**
 * Refund or lost chargeback on a Solar charge → 'refunded'. Hidden but kept
 * (D-02): the helpers stop answering, every solar.* row stays untouched, and
 * a new first charge restores the lot. The org comes from the
 * payment-event row the charge branch wrote (the subscription table stores
 * no references). The `.select('id')` makes the admin notification fire only
 * when a row actually changed, so a re-delivered refund notifies nobody.
 */
async function refundOrgAddonForReference(
  supabase: Client,
  reference: string,
  how: string,
): Promise<{ error: PgError }> {
  const { data: charge, error: lookupErr } = await (supabase as any)
    .schema('billing')
    .from('payment_events')
    .select('organisation_id')
    .eq('event_type', ORG_ADDON_CHARGE_EVENT)
    .eq('paystack_reference', reference)
    .maybeSingle()
  if (lookupErr) return { error: lookupErr as PgError }
  const orgId = (charge as { organisation_id?: string | null } | null)?.organisation_id
  if (!orgId) return { error: null }

  const { data: changed, error: updErr } = await addonTable(supabase)
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('organisation_id', orgId)
    .eq('feature_key', 'solar')
    .neq('status', 'refunded')
    .select('id')
  if (updErr) return { error: updErr as PgError }
  if (!Array.isArray(changed) || changed.length === 0) return { error: null }

  return notifyOrgAdmins(supabase, orgId, {
    type: 'billing_refund_processed',
    title: 'Solar paused — payment refunded',
    body:
      `The Solar subscription payment ${reference} was ${how}. Solar is now locked on every ` +
      `project of this organisation. All Solar data is kept and returns if you subscribe again.`,
    data: { reference, feature_key: 'solar' },
  })
}
```

- [ ] **Step 3b: Implement — refund branch.** In the `refund.` block, find:

```ts
    if (seatRevokeErr) return storageFailure('feature-seat revoke', seatRevokeErr)

    return ok()
  }
```

and replace it with:

```ts
    if (seatRevokeErr) return storageFailure('feature-seat revoke', seatRevokeErr)

    const addonRefund = await refundOrgAddonForReference(supabase, reference, 'refunded')
    if (addonRefund.error) return storageFailure('org_addon refund', addonRefund.error)

    return ok()
  }
```

- [ ] **Step 3c: Implement — chargeback.** In the `charge.dispute.` block, find:

```ts
      if (notified.error) return storageFailure('dispute notification', notified.error)
    }

    return ok()
  }
```

and replace it with:

```ts
      if (notified.error) return storageFailure('dispute notification', notified.error)
    }

    // A chargeback the merchant LOST ('merchant-accepted') is money gone back
    // to the cardholder: Solar goes to 'refunded' (D-02). An opened or
    // merchant-won dispute takes nothing away. ⚠ Confirm the resolve
    // payload's `resolution` values in Paystack test mode (plan open question).
    if (event.event === 'charge.dispute.resolve' && data.resolution === 'merchant-accepted') {
      const addonChargeback = await refundOrgAddonForReference(supabase, reference, 'charged back')
      if (addonChargeback.error) return storageFailure('org_addon chargeback', addonChargeback.error)
    }

    return ok()
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts`
Expected: PASS, including the pre-existing `refunds — finding #16` and `disputes — finding #16` suites. Their refund fixtures return `null` for the payment-event lookup, so they take no addon path, and `payment_events.upsert` still happens exactly once.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/webhook/route.ts apps/web/src/app/api/paystack/webhook/route.test.ts
git commit -m "feat(paystack): Solar refund / lost chargeback → refunded (hidden but kept), admins told once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Webhook — failed charges must not touch the tier subscription

`charge.failed` (`:754-763`) looks up `billing.subscriptions` by `metadata.org_id`. A failed **first** Solar charge carries `org_id`, so today it would mark the org's **tier** plan `past_due` and start the payment-recovery cron, which ends in `projects.status='payment_paused'` write locks. A failed Solar **renewal** carries `metadata: 0`, is matched by `customer_code`, and would hit the same tier row.

**Files:**
- Modify: `apps/web/src/app/api/paystack/webhook/route.ts` (`charge.failed` `:754-763`, `invoice.payment_failed` `:810-817`)
- Test: `apps/web/src/app/api/paystack/webhook/route.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append:

```ts
describe('org add-on — failed charges', () => {
  beforeEach(() => { process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = SOLAR_PLAN })
  afterEach(() => { delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL })

  const tierSub = {
    'billing.subscriptions.select': {
      data: { id: 's1', payment_failure_count: 0, last_payment_failure_at: null },
      error: null,
    },
  }

  it('a failed FIRST Solar charge never marks the org tier plan past_due', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    const res = await POST(signedReq({
      event: 'charge.failed',
      data: {
        reference: REF,
        customer: { customer_code: 'CUS_solar' },
        metadata: { type: 'org_addon_subscription', feature_key: 'solar', org_id: SOLAR_ORG },
      },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of('billing.subscriptions.select')).toHaveLength(0)
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
    expect(serviceClientRef.value.of(`${ADDON}.update`)).toHaveLength(0)
  })

  it('a failed Solar RENEWAL → past_due on the add-on, and the tier plan untouched', async () => {
    serviceClientRef.value = makeClient({ ...tierSub, [`${ADDON}.select`]: { data: addonRow(), error: null } })
    await POST(signedReq({
      event: 'charge.failed',
      data: {
        reference: 'ref_fail',
        metadata: 0,
        customer: { customer_code: 'CUS_solar' },
        plan: { plan_code: SOLAR_PLAN },
        subscription: { subscription_code: 'SUB_solar' },
      },
    }))
    const upd = serviceClientRef.value.of(`${ADDON}.update`)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toEqual({ status: 'past_due' })
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('an unplaceable Solar-plan failure still never reaches the tier plan', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    await POST(signedReq({
      event: 'charge.failed',
      data: { reference: 'ref_fail', metadata: 0, customer: { customer_code: 'CUS_solar' }, plan: { plan_code: SOLAR_PLAN } },
    }))
    expect(serviceClientRef.value.of('billing.subscriptions.update')).toHaveLength(0)
  })

  it('a non-Solar failed charge still opens the tier recovery cycle (unchanged)', async () => {
    serviceClientRef.value = makeClient({ ...tierSub })
    await POST(signedReq({
      event: 'charge.failed',
      data: { reference: 'ref_fail', metadata: { org_id: ORG }, customer: { customer_code: 'CUS_x' } },
    }))
    expect(serviceClientRef.value.of('billing.subscriptions.update')[0].payload.status).toBe('past_due')
  })

  it('invoice.payment_failed on the Solar subscription → past_due', async () => {
    serviceClientRef.value = makeClient({ [`${ADDON}.select`]: { data: addonRow(), error: null } })
    const res = await POST(signedReq({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: 'SUB_solar' } },
    }))
    expect(res.status).toBe(200)
    expect(serviceClientRef.value.of(`${ADDON}.update`)[0].payload).toEqual({ status: 'past_due' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts -t "org add-on — failed charges"`
Expected: FAIL. The first test sees a `billing.subscriptions.select` by `organisation_id`, and no addon `past_due` update is recorded.

- [ ] **Step 3a: Implement — `charge.failed`.** Replace the whole `charge.failed` block (currently `:752-763`: the two comment lines `// A failed charge — …` / `// opens the payment-failure cycle …`, then `if (event.event === 'charge.failed') {` … closing `}`) with:

```ts
  // A failed charge — the initial checkout charge or a recurring renewal —
  // opens the payment-failure cycle the recovery cron escalates.
  if (event.event === 'charge.failed') {
    const data = event.data
    const failedMeta: Record<string, any> =
      data.metadata && typeof data.metadata === 'object' ? data.metadata : {}

    // Org add-on (Solar). A failed FIRST charge holds nothing (the row is only
    // created on success) and its metadata.org_id must NOT fall through to the
    // tier lookup below, which would mark the org's tier plan past_due and
    // start the payment-pause cron. A failed RENEWAL is the add-on's own
    // past_due. A Solar-plan failure matching no row is acknowledged, never
    // pinned on the tier plan.
    if (failedMeta.type === ORG_ADDON_METADATA_TYPE) return ok()
    const addonFailed = await findOrgAddon(supabase, {
      subscriptionCode: subscriptionCodeOf(data),
      customerCode: data.customer?.customer_code,
      planCode: planCodeOf(data),
    })
    if (addonFailed.error) return storageFailure('org_addon failure lookup', addonFailed.error)
    if (addonFailed.row) {
      const failErr = await markOrgAddonPastDue(supabase, addonFailed.row)
      if (failErr) return storageFailure('org_addon past_due', failErr)
      return ok()
    }
    if (addonFailed.solarPlan) return ok()

    const orgId = failedMeta.org_id as string | undefined
    const customerCode = data.customer?.customer_code as string | undefined
    const sub =
      (orgId ? await findSubscription(supabase, 'organisation_id', orgId) : null) ??
      (customerCode ? await findSubscription(supabase, 'paystack_customer_code', customerCode) : null)
    if (sub) await recordPaymentFailure(supabase, sub)
    else console.warn('Webhook charge.failed: no subscription matched')
  }
```

- [ ] **Step 3b: Implement — `invoice.payment_failed`.** Replace the block (currently `:808-817`, from `// A subscription renewal invoice failed` to its closing `}`) with:

```ts
  // A subscription renewal invoice failed — the primary Paystack signal for a
  // failed recurring charge. Open/extend the recovery cycle.
  if (event.event === 'invoice.payment_failed') {
    const inv = event.data
    const subCode = inv.subscription?.subscription_code as string | undefined
    if (subCode) {
      const sub = await findSubscription(supabase, 'paystack_subscription_code', subCode)
      if (sub) await recordPaymentFailure(supabase, sub)

      const addon = await findOrgAddon(supabase, { subscriptionCode: subCode })
      if (addon.error) return storageFailure('org_addon failure lookup', addon.error)
      if (addon.row) {
        const failErr = await markOrgAddonPastDue(supabase, addon.row)
        if (failErr) return storageFailure('org_addon past_due', failErr)
      }
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/app/api/paystack/webhook/route.test.ts`
Expected: PASS, the whole file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/paystack/webhook/route.ts apps/web/src/app/api/paystack/webhook/route.test.ts
git commit -m "fix(paystack): a failed Solar charge never marks the org tier plan past_due

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Single-writer contract test + RBAC matrix

**Files:**
- Create: `apps/web/src/lib/paystack/org-addon-single-writer.contract.test.ts`
- Modify: `docs/rbac-matrix.md` (API table after `:189`; footnote after `:240`)

- [ ] **Step 1: Write the contract test** — create `apps/web/src/lib/paystack/org-addon-single-writer.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * billing.org_addon_subscriptions has exactly ONE writer: the Paystack
 * webhook (service client). The subscribe route writes nothing (spec §1.2),
 * and a second writer is how mv-subscribe once downgraded an active
 * subscriber to 'pending'. This fails the build if any other non-test file
 * under apps/web/src names the table.
 *
 * A future READER (e.g. Phase 1C's locked-page poll) must be added to
 * ALLOWED with a comment saying it only SELECTs — the point is that the
 * decision is made on purpose, in review, not by accident.
 */

const WEB_SRC = resolve(__dirname, '../..') // apps/web/src

const ALLOWED = new Set<string>([
  'app/api/paystack/webhook/route.ts', // the single writer
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('billing.org_addon_subscriptions — single writer', () => {
  it('is named only by the webhook route', () => {
    const offenders = walk(WEB_SRC)
      .filter((f) => readFileSync(f, 'utf8').includes('org_addon_subscriptions'))
      .map((f) => relative(WEB_SRC, f))
      .filter((f) => !ALLOWED.has(f))
    expect(offenders).toEqual([])
  })

  it('the allowed writer actually names it (the check is not vacuous)', () => {
    const src = readFileSync(join(WEB_SRC, 'app/api/paystack/webhook/route.ts'), 'utf8')
    expect(src).toContain("from('org_addon_subscriptions')")
  })
})
```

- [ ] **Step 2: Run it** (it guards already-built code, so it should pass now; prove it can fail)

Run: `pnpm --filter web exec vitest run src/lib/paystack/org-addon-single-writer.contract.test.ts`
Expected: PASS.

Mutation check: temporarily add the line `// org_addon_subscriptions` to `apps/web/src/app/api/paystack/solar-subscribe/route.ts` and re-run. Expected: FAIL, naming `app/api/paystack/solar-subscribe/route.ts`. Revert the line and re-run. Expected: PASS.

- [ ] **Step 3: Update `docs/rbac-matrix.md`.** Directly after the row

```
| `POST /api/paystack/mv-subscribe` | W | W | W | W | W | W | W |¹⁴
```

insert:

```
| `POST /api/paystack/solar-subscribe` | W | W | — | — | — | — | — |¹⁶
```

Directly after the paragraph that begins `> **¹⁴ \`POST /api/paystack/mv-subscribe\``, insert a blank line and then:

```
> **¹⁶ `POST /api/paystack/solar-subscribe` — owner/admin of the PROJECT's organisation, rate-limited, writes nothing.** Added 2026-09-28 (Solar Phase 1B; spec `docs/solar/03-data-model-and-security.md` §2.3 point 4, decision D-01). Body `{ project_id: uuid }`. `503` if `PAYSTACK_SECRET_KEY` or **`PAYSTACK_PLAN_SOLAR_ANNUAL`** is unset (both evaluated before the session check, as `mv-subscribe`); `401` unauthenticated; `429` past `rateLimit('solar-subscribe:<user id>', 5, 60_000)`; `400` on a malformed body. The org is read from `projects.projects` **through the caller's session** (a project they cannot see is refused), then `requireRole(userClient, project.organisation_id, OWNER_ADMIN)` — the primitive against the project's org, never the caller's primary org. An invisible project and a non-owner/admin get the **same** `403` body, so the route is no project-existence oracle. `409` (`alreadySubscribed: true`) when `public.org_has_solar(org)` is already true — which includes WM-Consulting's internal bypass. Otherwise initialises a Paystack **plan** checkout (no `amount`) with `metadata { type: 'org_addon_subscription', feature_key: 'solar', org_id, project_id, user_id, return_to: '/projects/<id>/solar' }`. The route writes **nothing** — `billing.org_addon_subscriptions` is written only by `/api/paystack/webhook` (service client; the table has an owner/admin SELECT policy and no write policy, `00207`), pinned by `lib/paystack/org-addon-single-writer.contract.test.ts`. Project managers are **not** admitted: the subscription is org-wide billing, like `/api/paystack/checkout`. A non-admin's route to a subscription is "Ask an admin to subscribe" (Phase 1C, `solar.access_requests kind='subscribe'`). `/api/paystack/feature-unlock` rejects the `solar` key (`ONE_TIME_FEATURE_KEYS`), so the add-on cannot be bought as a one-time charge.
```

- [ ] **Step 4: Run the web suite**

Run: `pnpm --filter web test 2>&1 | tail -4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/paystack/org-addon-single-writer.contract.test.ts docs/rbac-matrix.md
git commit -m "test(paystack): webhook is the single writer of org_addon_subscriptions; rbac-matrix row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Full verification, push, draft PR

**Files:** none

- [ ] **Step 1: Run all three suites, type-check and lint**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-1b
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter web type-check 2>&1 | tail -3
pnpm --filter web lint 2>&1 | tail -5
```
Expected: all green. `type-check` exits 0. Each suite's count equals the Task 1 baseline plus the tests added. If `@esite/db` is red, read the failing contract test before touching anything: this plan adds no migration, so a red there means a test reads something this branch changed.

- [ ] **Step 2: Confirm no migration was added**

```bash
git diff --name-only origin/feat/solar-phase-1a...HEAD -- apps/edge-functions/supabase/migrations
```
Expected: empty output.

- [ ] **Step 3: Push**

```bash
git push -u origin feat/solar-phase-1b
```
(`origin` is `git@github.com:WattMatt/e-site.git` over SSH.)

- [ ] **Step 4: Write the PR body** to `/tmp/solar-1b-pr.md` with:

  1. **What.** The route, the webhook state map (copy the table from this plan's header), `FEATURE_PRICES.solar`, the `feature-unlock` rejection, the callback allow-list, and `solarReturnTo`.
  2. **No migration.** Say why, in one line per dependency: the table, CHECK and columns from `00207`; `payment_events` free text; notification types from `00190`.
  3. **Why no pending row.** Copy the three reasons from this plan.
  4. **Suite counts.** Before (Task 1) and after (Step 1) for shared / web / db, plus type-check.
  5. **Owner checklist before this can take money:**
     - Create an **annual ZAR plan** on the Paystack dashboard, in test mode and later live, at the amount decided under open question 1.
     - Set `PAYSTACK_PLAN_SOLAR_ANNUAL` in Vercel (Preview + Production). The route returns 503 until then.
     - Test-mode walk on a **throwaway org, not WM** (the WM bypass hides the paywall): subscribe → first charge → row `active` → replay renewal, `not_renew`, `disable`, `refund.processed` from the Paystack dashboard → confirm each row state by reading `billing.org_addon_subscriptions` back.
  6. **Open questions.** Copy the list at the end of this plan.
  7. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Open the draft PR against the 1A branch**

```bash
gh pr create --repo WattMatt/e-site --draft --base feat/solar-phase-1a --head feat/solar-phase-1b \
  --title "feat(solar): Phase 1B — Paystack org subscription (subscribe route + webhook)" \
  --body-file /tmp/solar-1b-pr.md
```
Expected: the PR URL is printed.

- [ ] **Step 6: Report** the PR URL, the suite counts and the open questions. Do not merge. Do not set any environment variable. Do not run a live or test Paystack charge: that is the owner's checklist item.

---

## Self-review (done while writing)

- **Spec coverage (§2.3 point 4, D-01, D-02, §1.2, P1 deliverables):**

  | Requirement | Where |
  |---|---|
  | Route at `/api/paystack/solar-subscribe`, org from the project, `OWNER_ADMIN`, 409 when active, rate-limited 5/min | Task 6 |
  | Plan `PAYSTACK_PLAN_SOLAR_ANNUAL`, 503 when missing | Tasks 5 and 6 |
  | Metadata `{type:'org_addon_subscription', feature_key:'solar', org_id, return_to}` | Task 6 |
  | "Writes nothing until the webhook" | Task 6 test, Task 13 contract |
  | First charge + renewal → `active`, period extended | Tasks 8 and 9 |
  | `not_renew` → `non_renewing` | Task 10 |
  | `disable` → `cancelled` | Task 10 |
  | Refund / reversal / chargeback → `refunded` | Task 11 |
  | Callback allow-list | Task 7 |
  | `FEATURE_PRICES.solar = {model:'org_subscription', interval:'annual', amountKobo:199900}` | Task 2 |
  | One-time route rejects subscription keys | Task 3 |
  | rbac-matrix rows | Task 13 |
  | Idempotency via `last_event_id` | Tasks 8 and 9 duplicate-delivery tests |
  | Unknown org | Task 8 |
  | Test for every webhook event | Tasks 8-12: charge.success first/renewal, invoice.update paid/failed, subscription.create, not_renew, disable, refund.processed/pending, dispute create/resolve, charge.failed first/renewal, invoice.payment_failed |

  Out of scope and deferred to 1C: the locked page UI and the 30-second poll.

- **Placeholders:** none. Every code step has complete code, and every run step has a command and an expected result.
- **Name consistency:** `ORG_ADDON_METADATA_TYPE`, `ORG_ADDON_CHARGE_EVENT`, `ORG_ADDON_DUPLICATE_EVENT`, `ORG_ADDON_UNMATCHED_EVENT`, `solarPlanCode`, `planCodeOf`, `subscriptionCodeOf` and `nextAddonPeriodEnd` are defined in Task 5 and used with the same signatures in Tasks 6-12. `AddonRow`, `ADDON_COLUMNS`, `addonTable` and `applyOrgAddonCharge` are defined in Task 8. `findOrgAddon` and `markOrgAddonPastDue` are defined in Task 9 and reused in 10 and 12. `refundOrgAddonForReference` is defined in Task 11. `solarReturnTo` is defined in Task 4 and used in Task 6. `ONE_TIME_FEATURE_KEYS`, `OneTimeFeatureKey` and `isSubscriptionFeature` are defined in Task 2 and used in Task 3.
- **Import hygiene:** Task 8 imports only what Task 8 uses; Task 9 adds `planCodeOf` and `solarPlanCode` when they are first used.

## Open questions for the owner (carried into the PR body)

1. **VAT on the Paystack plan amount.** D-01 says "R1,999 per year **excl.** VAT". Paystack charges whatever amount the plan carries. Should the plan be `199900` kobo, or VAT-inclusive (`229885` at 15%)? Nothing in the codebase adds VAT, and JBCC's R1,999 is charged as `199900`. The webhook records the amount actually charged, so either works technically.
2. **`subscription.disable` locks immediately.** Per spec, `disable → cancelled`, and `cancelled` is not admitted by `org_subscription_active`, so a merchant or API disable mid-period ends access at once. The customer-initiated path (`not_renew` → `non_renewing` → access to period end → `disable` at the end) behaves as expected. Should a mid-period `disable` keep access until `current_period_end`? That would mean either mapping it to `non_renewing` when the period is still in date, or a later migration widening the helper.
3. **A refund of an older year's charge locks the current, separately paid year.** Per spec, any refund goes to `refunded`. Confirm, or restrict refunds to the latest charge. The latter would need `last_event_id` compared with the refunded reference.
4. **Chargeback mapping.** This plan treats `charge.dispute.resolve` with `resolution === 'merchant-accepted'` as a lost chargeback, and treats `charge.dispute.create` as notify-only (existing behaviour). Paystack has no separate "reversal" webhook, so refunds and disputes cover that case. **Confirm the resolve payload's `resolution` values in test mode.**
5. **Return path and the "activating Solar…" poll (1C).** `return_to` is `/projects/[id]/solar` as asked. The callback appends `?payment=received&ref=…`. Phase 1C's `(gated)/layout.tsx` redirects an unsubscribed org to `/solar/locked`, and **that redirect must forward the `payment`/`ref` params**, or the locked page will never know to show the §1.2 poll. The alternative is to set `return_to` straight to `/projects/[id]/solar/locked`. Decide before 1C.
6. **`past_due` locks immediately.** `org_subscription_active` admits only `active` and `non_renewing`, so a failed renewal hides Solar at once. The period has ended at that point anyway, so there is no grace window. Confirm that no grace period is wanted.
7. **Environment.** `PAYSTACK_PLAN_SOLAR_ANNUAL` must be created on Paystack (test and live) and set in Vercel. The route returns 503 until then.
