# Solar Phase 1C-i — Entry, Locked Screen, Access Requests and Access Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every eligible project member a way into Solar — a per-project/per-user sidebar entry, a locked screen that offers exactly the one action that unlocks it (Subscribe / Ask an admin / Request access / Withdraw), the gated module chrome (tab bar with status dots, View-only banner), and the grantor Access panel (levels, requests, copy access, subscription card).

**Architecture:** One pure resolver in `@esite/shared` (`resolveSolarEntry`) turns the database's answers (`user_effective_project_role`, `solar_access_level`, `solar_is_grantor`, own-org membership, `org_has_solar`, the caller's pending requests) into one of the five §0.2 situations. A server loader (`loadSolarEntry`) gathers those answers; the sidebar item, the `/solar` redirect, the locked page and every request action all read the same state, so they can never disagree. Grantor actions re-check `solar_is_grantor` themselves and rely on 00208's RLS, bind trigger and request guard as the load-bearing layer. Migration `00209` adds the notification types, product-event verbs and the `solar.org_settings` table that plan 1C-ii's settings page needs (one migration for the whole of 1C, built here).

**Tech Stack:** Next.js 15 App Router (server components, server actions, `'use client'` components), Supabase (PostgREST, RLS, 00208 helpers), Postgres migration with `@verify` block, `scripts/db/dry-run-migration.sh`, Vitest + @testing-library/react + user-event, pnpm/Turborepo.

**Spec:** `docs/solar/01-functional-spec.md` §0 (access model, legend, §0.2 what each user sees, §0.3 chrome, §0.4 control rules), §1.1, §1.2, §1.3. Data model: `apps/edge-functions/supabase/migrations/00208_solar_foundation.sql`.

**Companion plan:** `docs/superpowers/plans/2026-09-28-solar-phase-1c-ii-overview-site-settings.md` (Overview, Site & Supply, `/settings/solar`). Execute this plan first; 1C-ii continues on the same branch and PR.

---

## Ground rules (read once)

1. **Never trust the page gate.** Every server action re-checks: request actions through `loadSolarEntry` (state), grantor actions through `solar_is_grantor`. RLS + 00208 triggers remain the last word.
2. **Page → client props must be JSON.** No functions, no `Date`, no `Map` across the server → client boundary (the PR #201 rule). Dates travel as ISO strings.
3. **Two-step inline confirm** for destructive actions (remove access, copy access): first press arms, second commits, 3 s auto-disarm. Never `window.confirm`.
4. **Every save carries `expectedUpdatedAt`.** Stale writes are refused with exactly: `Someone else changed this — reload to see their version.`
5. **Every failure is a human sentence.** Map Postgres errors through `humanSolarError`; never show `error.message`.
6. **Controls above the user's level are hidden, not disabled.**
7. In Vitest, `beforeEach` bodies that call `mockClear`/`clearAllMocks` must be **block bodies** (`beforeEach(() => { vi.clearAllMocks() })`). An implicit return is treated as a cleanup callback.
8. Use `vi.hoisted` for mock handles referenced inside `vi.mock` factories.
9. `requireEffectiveRole` returns an object — test `.ok`, never truthiness.
10. **Tables in `solar`, `projects`, `billing`, `structure` are not in the generated types** — cast the client: `(await createClient()) as unknown as AnyClient` with `type AnyClient = SupabaseClient<any, any, any>`.
11. Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
12. All commands run from the worktree root `~/.config/superpowers/worktrees/esite/solar-phase-1c` unless stated.

---

## File structure

**Shared (`packages/shared/src/solar/`)**
- `entry.ts` — `resolveSolarEntry`, `solarNavBadge`, `requestableLevels`, `SOLAR_LEVEL_LABELS`, `SOLAR_EXCLUDED_ROLES` (pure).
- `format.ts` — `formatSolarDate` (SAST, ICU-free), `formatRandWhole`, `joinNames` (pure).
- `readiness.ts` — `SOLAR_TABS`, `visibleSolarTabs`, `computeSolarReadiness`, `siteReadiness`, `toSiteReadinessInput`, `isInSouthAfrica` (pure; single source for tab dots and the Overview checklist).
- `index.ts` — re-exports.

**Database**
- `apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql` — `solar.org_settings`; `notifications_type_check` + 4 solar types; `product_events_event_check` + 5 solar verbs.
- `scripts/db/assert-solar-org-settings-roles.sql` — behavioural assertions (red → green).
- `packages/shared/src/lib/analytics/product-events.ts` (+ contract test) — registry gains the 5 verbs; the contract test reads the **last** migration that re-declares the CHECK.

**Web — lib (`apps/web/src/lib/solar/`)**
- `entry-loader.ts` — `loadSolarEntry(projectId, client?)` (server-only).
- `grantors.ts` — `listSolarGrantors`, `grantorDisplayNames`, `profileName` (server-only, service client).
- `notify.ts` — `notifySolarUsers` (bell via `dispatchNotification`, optional email via `send-email`).
- `audit.ts` — `recordSolarAudit` (service client, never throws).
- `errors.ts` — `humanSolarError`, `STALE_MESSAGE`, `ALREADY_ANSWERED`.
- `price.ts` — `solarPriceLine` (reads `FEATURE_PRICES.solar` from 1B if present, falls back to R1,999).
- `dirty-store.ts` — unsaved-changes flag shared by the tab bar and forms.
- `access-panel-types.ts`, `access-panel.ts` — Access panel data (types are client-safe; loader is server-only).
- `apps/web/src/test/fake-supabase.ts` — a small chainable Supabase fake for action/loader tests.

**Web — actions**
- `apps/web/src/actions/solar-requests.actions.ts` — nav state, subscription state, request access, ask an admin, withdraw.
- `apps/web/src/actions/solar-access.actions.ts` — set member level, decide request, copy access (grantors).

**Web — UI**
- `apps/web/src/components/layout/SolarNavItem.tsx` + `Sidebar.tsx` (modify).
- `apps/web/src/app/(admin)/projects/[id]/solar/page.tsx` — redirect.
- `.../solar/locked/page.tsx` — locked screen (outside `(gated)`).
- `.../solar/access/page.tsx`, `.../solar/access/AccessPanel.tsx` — grantors (outside `(gated)`: grants may be set before the org subscribes).
- `.../solar/_components/` — `LockedScreen.tsx`, `FeatureSummary.tsx`, `SubscribeButton.tsx`, `PaymentReturnPoller.tsx`, `SolarTabBar.tsx`, `StatusDot.tsx`, `ViewOnlyBanner.tsx`, `ReadinessChecklist.tsx`, `useArmedConfirm.ts`.
- `.../solar/(gated)/layout.tsx` — gate + chrome.
- `.../solar/(gated)/overview/page.tsx` — readiness checklist (1C-ii completes the Overview).

**Docs**
- `docs/rbac-matrix.md` — Solar section (routes + actions) and the `send-email` caller row.

Tab routes for unbuilt tabs (`load`, `schematics`, `tariff`, `layout`, `yield`, `financials`, `reports`, `schedule`, `operations`) are **not created**; the tab bar renders them disabled.

---

### Task 1: Worktree and branch

**Files:** none

- [ ] **Step 1: Create the worktree from 1B (fallback 1A)**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-1a
git fetch origin
if git rev-parse --verify -q origin/feat/solar-phase-1b >/dev/null; then
  BASE=origin/feat/solar-phase-1b; PR_BASE=feat/solar-phase-1b
else
  BASE=origin/feat/solar-phase-1a; PR_BASE=feat/solar-phase-1a
fi
echo "BASE=$BASE PR_BASE=$PR_BASE" | tee /tmp/solar-1c-base.txt
git worktree add ~/.config/superpowers/worktrees/esite/solar-phase-1c -b feat/solar-phase-1c "$BASE"
cd ~/.config/superpowers/worktrees/esite/solar-phase-1c
pnpm install --frozen-lockfile
```
Expected: worktree created on `feat/solar-phase-1c`; install succeeds.

- [ ] **Step 2: Record baseline suite counts**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
```
Write the three "Tests N passed" lines into `/tmp/solar-1c-baseline.txt`. All must be green before starting; if not, stop and report.

- [ ] **Step 3: Check what 1B changed that 1C depends on**

```bash
ls apps/edge-functions/supabase/migrations | tail -4
grep -ln "ADD CONSTRAINT notifications_type_check" apps/edge-functions/supabase/migrations/*.sql | tail -1
grep -ln "ADD CONSTRAINT product_events_event_check" apps/edge-functions/supabase/migrations/*.sql | tail -1
grep -n "solar" packages/shared/src/services/billing.service.ts | head -5
ls apps/web/src/app/api/paystack/solar-subscribe 2>/dev/null
```
Expected on a 1A base: the newest migration is `00208_solar_foundation.sql`; the latest re-declarations are `00190_…` (notifications) and `00199_…` (product events); no `solar` in billing.service; no subscribe route.
**If 1B added a migration** (anything after `00208`), 1C's migration takes the next free number instead of `00209` — rename every `00209` in this plan accordingly. **If 1B re-declared either CHECK**, copy that file's list (not the 00190 / 00199 list below) as the base of Task 4's re-declaration. Record what you found in `/tmp/solar-1c-base.txt`.

---

### Task 2: Shared entry resolver and formatters

**Files:**
- Create: `packages/shared/src/solar/entry.ts`, `packages/shared/src/solar/entry.test.ts`
- Create: `packages/shared/src/solar/format.ts`, `packages/shared/src/solar/format.test.ts`
- Modify: `packages/shared/src/solar/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/entry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveSolarEntry, solarNavBadge, requestableLevels, type SolarEntryInput } from './entry'

const base: SolarEntryInput = {
  effectiveRole: 'contractor',
  level: null,
  isGrantor: false,
  isOwnOrgMember: true,
  orgSubscribed: true,
  pendingAccessRequestAt: null,
  pendingSubscribeRequestAt: null,
}

describe('resolveSolarEntry — the five rows of spec §0.2', () => {
  it('row 1: org not subscribed, owner/admin → subscribe', () => {
    expect(resolveSolarEntry({ ...base, effectiveRole: 'admin', isGrantor: true, orgSubscribed: false }))
      .toEqual({ kind: 'subscribe' })
  })

  it('row 2: org not subscribed, any other member → ask an admin (not yet asked)', () => {
    expect(resolveSolarEntry({ ...base, orgSubscribed: false })).toEqual({ kind: 'ask_admin', requestedAt: null })
  })

  it('row 2: already asked → carries the date', () => {
    expect(resolveSolarEntry({ ...base, orgSubscribed: false, pendingSubscribeRequestAt: '2026-09-28T08:00:00Z' }))
      .toEqual({ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('row 3: subscribed, no grant → request access up to edit + financials for own-org members', () => {
    expect(resolveSolarEntry(base)).toEqual({ kind: 'request_access', maxLevel: 'edit_financials' })
  })

  it('row 3: an external member (not in the project org) may only ask for View', () => {
    expect(resolveSolarEntry({ ...base, isOwnOrgMember: false, orgSubscribed: false }))
      .toEqual({ kind: 'request_access', maxLevel: 'view' })
  })

  it('row 4: request pending → pending with its date', () => {
    expect(resolveSolarEntry({ ...base, pendingAccessRequestAt: '2026-09-28T08:00:00Z' }))
      .toEqual({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('row 5: granted → granted at that level', () => {
    expect(resolveSolarEntry({ ...base, level: 'view' })).toEqual({ kind: 'granted', level: 'view' })
  })

  it('suppliers, client viewers and non-members never see Solar', () => {
    expect(resolveSolarEntry({ ...base, effectiveRole: 'supplier' })).toEqual({ kind: 'hidden' })
    expect(resolveSolarEntry({ ...base, effectiveRole: 'client_viewer' })).toEqual({ kind: 'hidden' })
    expect(resolveSolarEntry({ ...base, effectiveRole: null })).toEqual({ kind: 'hidden' })
  })
})

describe('solarNavBadge', () => {
  it('maps each state to the sidebar badge', () => {
    expect(solarNavBadge({ kind: 'hidden' })).toBe('hidden')
    expect(solarNavBadge({ kind: 'granted', level: 'edit' })).toBe('open')
    expect(solarNavBadge({ kind: 'pending', requestedAt: 'x' })).toBe('pending')
    expect(solarNavBadge({ kind: 'subscribe' })).toBe('locked')
    expect(solarNavBadge({ kind: 'ask_admin', requestedAt: 'x' })).toBe('locked')
    expect(solarNavBadge({ kind: 'request_access', maxLevel: 'view' })).toBe('locked')
  })
})

describe('requestableLevels', () => {
  it('lists every level up to and including the maximum', () => {
    expect(requestableLevels('view')).toEqual(['view'])
    expect(requestableLevels('edit_financials')).toEqual(['view', 'edit', 'edit_financials'])
  })
})
```

`packages/shared/src/solar/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatSolarDate, formatRandWhole, joinNames } from './format'

describe('formatSolarDate', () => {
  it('formats in SAST (UTC+2) without relying on ICU month names', () => {
    expect(formatSolarDate('2026-09-28T08:00:00Z')).toBe('28 Sep 2026')
    // 23:30 UTC on the 28th is already the 29th in Johannesburg.
    expect(formatSolarDate('2026-09-28T23:30:00Z')).toBe('29 Sep 2026')
  })
  it('returns an empty string for garbage', () => {
    expect(formatSolarDate('not a date')).toBe('')
  })
})

describe('formatRandWhole', () => {
  it('formats whole rand with comma thousands', () => {
    expect(formatRandWhole(199900)).toBe('R1,999')
    expect(formatRandWhole(123456700)).toBe('R1,234,567')
    expect(formatRandWhole(5000)).toBe('R50')
  })
})

describe('joinNames', () => {
  it('joins with commas and a final "and"', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Ann'])).toBe('Ann')
    expect(joinNames(['Ann', 'Ben'])).toBe('Ann and Ben')
    expect(joinNames(['Ann', 'Ben', 'Cy'])).toBe('Ann, Ben and Cy')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/entry.test.ts src/solar/format.test.ts`
Expected: FAIL — `Failed to resolve import "./entry"` / `"./format"`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/entry.ts`:
```ts
/**
 * What a user sees when they open Solar on a project (spec §0.2), as a pure
 * function of the database's answers. The web loader gathers the inputs; the
 * sidebar badge, the /solar redirect, the locked screen and every request
 * action read the SAME resolved state, so they cannot disagree.
 *
 * orgSubscribed comes from public.org_has_solar, which answers only for
 * ACTIVE MEMBERS of the org (false for everyone else). An external member's
 * `false` therefore means "unknown", not "unsubscribed": externals always land
 * on request_access (00208 lets them request View whether or not the org has
 * paid; a grant confers nothing until it does).
 */
import { SOLAR_ACCESS_LEVELS, type SolarAccessLevel } from './access'

/** E-Site roles that can never hold Solar access [D-04b]. */
export const SOLAR_EXCLUDED_ROLES = ['supplier', 'client_viewer'] as const

export const SOLAR_LEVEL_LABELS: Record<SolarAccessLevel, string> = {
  view: 'View',
  edit: 'Edit',
  edit_financials: 'Edit + financials',
}

export interface SolarEntryInput {
  /** public.user_effective_project_role(project, me); null = not a member. */
  effectiveRole: string | null
  /** public.solar_access_level(project); null = no access. */
  level: SolarAccessLevel | null
  /** public.solar_is_grantor(project): org owner/admin of the project's org. */
  isGrantor: boolean
  /** Active member of the project's organisation (own user_organisations row). */
  isOwnOrgMember: boolean
  /** public.org_has_solar(org) — meaningful only when isOwnOrgMember. */
  orgSubscribed: boolean
  /** created_at of my pending 'access' request on THIS project. */
  pendingAccessRequestAt: string | null
  /** created_at of my pending 'subscribe' request on ANY project of this org. */
  pendingSubscribeRequestAt: string | null
}

export type SolarEntryState =
  | { kind: 'hidden' }
  | { kind: 'granted'; level: SolarAccessLevel }
  | { kind: 'subscribe' }
  | { kind: 'ask_admin'; requestedAt: string | null }
  | { kind: 'request_access'; maxLevel: SolarAccessLevel }
  | { kind: 'pending'; requestedAt: string }

export function resolveSolarEntry(i: SolarEntryInput): SolarEntryState {
  if (!i.effectiveRole || (SOLAR_EXCLUDED_ROLES as readonly string[]).includes(i.effectiveRole)) {
    return { kind: 'hidden' }
  }
  if (i.level) return { kind: 'granted', level: i.level }
  if (i.isOwnOrgMember && !i.orgSubscribed) {
    if (i.isGrantor) return { kind: 'subscribe' }
    return { kind: 'ask_admin', requestedAt: i.pendingSubscribeRequestAt }
  }
  if (i.pendingAccessRequestAt) return { kind: 'pending', requestedAt: i.pendingAccessRequestAt }
  return { kind: 'request_access', maxLevel: i.isOwnOrgMember ? 'edit_financials' : 'view' }
}

export type SolarNavBadge = 'hidden' | 'locked' | 'pending' | 'open'

export function solarNavBadge(s: SolarEntryState): SolarNavBadge {
  switch (s.kind) {
    case 'hidden': return 'hidden'
    case 'granted': return 'open'
    case 'pending': return 'pending'
    default: return 'locked'
  }
}

/** Every level up to and including `max` (the order is view < edit < edit_financials). */
export function requestableLevels(max: SolarAccessLevel): SolarAccessLevel[] {
  return SOLAR_ACCESS_LEVELS.slice(0, SOLAR_ACCESS_LEVELS.indexOf(max) + 1)
}
```

`packages/shared/src/solar/format.ts`:
```ts
/** Display helpers for Solar screens. Deterministic: no ICU, no locale. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000 // South Africa has no DST

/** "28 Sep 2026" in Africa/Johannesburg. Empty string for an unparseable value. */
export function formatSolarDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t + SAST_OFFSET_MS)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Whole rand with comma thousands: 199900 kobo → "R1,999". */
export function formatRandWhole(kobo: number): string {
  const rands = Math.round(kobo / 100)
  return 'R' + String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** ["Ann","Ben","Cy"] → "Ann, Ben and Cy". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
```

`packages/shared/src/solar/index.ts` (replace the whole file):
```ts
export * from './access'
export * from './entry'
export * from './format'
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/`
Expected: PASS (access + entry + format).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar
git commit -m "feat(solar): shared entry resolver and display formatters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared tabs and readiness rules

**Files:**
- Create: `packages/shared/src/solar/readiness.ts`, `packages/shared/src/solar/readiness.test.ts`
- Modify: `packages/shared/src/solar/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/readiness.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  SOLAR_TABS, visibleSolarTabs, siteReadiness, computeSolarReadiness, toSiteReadinessInput,
  isInSouthAfrica, LATER_PHASE_REASON,
} from './readiness'

const full = { latitude: -26.1, longitude: 28.05, licenseeName: 'City Power', nmdKva: 500 }

describe('tabs', () => {
  it('lists the eleven spec tabs in order', () => {
    expect(SOLAR_TABS.map((t) => t.slug)).toEqual([
      'overview', 'site', 'load', 'schematics', 'tariff', 'layout', 'yield', 'financials', 'reports', 'schedule', 'operations',
    ])
  })
  it('only Overview and Site & Supply are built in Phase 1', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site'])
  })
  it('hides Tariff and Financials below Edit + financials, and Operations for everyone', () => {
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('tariff')
    expect(visibleSolarTabs('edit').map((t) => t.slug)).not.toContain('financials')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).toContain('financials')
    expect(visibleSolarTabs('edit_financials').map((t) => t.slug)).not.toContain('operations')
  })
})

describe('siteReadiness (spec §2.3, Site & Supply row)', () => {
  it('grey when no study exists or nothing is set', () => {
    expect(siteReadiness(null).status).toBe('grey')
    expect(siteReadiness({ latitude: null, longitude: null, licenseeName: null, nmdKva: null }).status).toBe('grey')
  })
  it('amber lists what is missing', () => {
    expect(siteReadiness({ ...full, nmdKva: null })).toEqual({
      status: 'amber', reason: 'Missing: connection capacity (NMD kVA)',
    })
    expect(siteReadiness({ ...full, latitude: null, licenseeName: '  ' }).reason)
      .toBe('Missing: coordinates, supply authority')
  })
  it('green when coordinates, supply authority and NMD are all set', () => {
    expect(siteReadiness(full).status).toBe('green')
  })
  it('red when the coordinates are outside South Africa', () => {
    expect(siteReadiness({ ...full, latitude: 26.1 })).toEqual({
      status: 'red', reason: 'Coordinates are outside South Africa — check the location',
    })
  })
})

describe('isInSouthAfrica', () => {
  it('uses the -35..-22 / 16..33 box', () => {
    expect(isInSouthAfrica(-33.9, 18.4)).toBe(true)
    expect(isInSouthAfrica(-21.9, 28)).toBe(false)
    expect(isInSouthAfrica(-26, 33.1)).toBe(false)
  })
})

describe('computeSolarReadiness', () => {
  it('has one row per visible tab except Overview; only Site & Supply is live', () => {
    const steps = computeSolarReadiness(full, 'view')
    expect(steps.map((s) => s.slug)).toEqual(['site', 'load', 'schematics', 'layout', 'yield', 'reports', 'schedule'])
    expect(steps[0]).toMatchObject({ slug: 'site', status: 'green', live: true })
    for (const s of steps.slice(1)) {
      expect(s).toMatchObject({ status: 'grey', reason: LATER_PHASE_REASON, live: false })
    }
  })
  it('includes Tariff and Financials for Edit + financials', () => {
    expect(computeSolarReadiness(null, 'edit_financials').map((s) => s.slug)).toContain('tariff')
  })
})

describe('toSiteReadinessInput', () => {
  it('coerces PostgREST numerics and tolerates a missing row', () => {
    expect(toSiteReadinessInput(null)).toBeNull()
    expect(toSiteReadinessInput({ latitude: '-26.1', longitude: 28.05, licensee_name: 'X', nmd_kva: '500.00' }))
      .toEqual({ latitude: -26.1, longitude: 28.05, licenseeName: 'X', nmdKva: 500 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/readiness.test.ts`
Expected: FAIL — cannot resolve `./readiness`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/readiness.ts`:
```ts
/**
 * Solar tabs and readiness (spec §0.3 status dots, §2.3 readiness rules) —
 * the single source for the tab bar and the Overview checklist. Phase 1 has
 * ONE live rule (Site & Supply); every other step is grey "available in a
 * later phase". No statuses are hard-coded per project.
 */
import type { SolarAccessLevel } from './access'

export type SolarTabSlug =
  | 'overview' | 'site' | 'load' | 'schematics' | 'tariff' | 'layout'
  | 'yield' | 'financials' | 'reports' | 'schedule' | 'operations'

export interface SolarTab {
  slug: SolarTabSlug
  label: string
  /** A route exists for this tab. Unbuilt tabs render disabled. */
  built: boolean
  /** Visible only at Edit + financials (COST_VIEW legend). */
  financial: boolean
  /** Not shown at all yet (Operations until Phase 7, D-12). */
  hidden: boolean
}

export const SOLAR_TABS: readonly SolarTab[] = [
  { slug: 'overview',   label: 'Overview',           built: true,  financial: false, hidden: false },
  { slug: 'site',       label: 'Site & Supply',      built: true,  financial: false, hidden: false },
  { slug: 'load',       label: 'Load',               built: false, financial: false, hidden: false },
  { slug: 'schematics', label: 'Schematics',         built: false, financial: false, hidden: false },
  { slug: 'tariff',     label: 'Tariff',             built: false, financial: true,  hidden: false },
  { slug: 'layout',     label: 'Layout',             built: false, financial: false, hidden: false },
  { slug: 'yield',      label: 'Yield & Scenarios',  built: false, financial: false, hidden: false },
  { slug: 'financials', label: 'Financials',         built: false, financial: true,  hidden: false },
  { slug: 'reports',    label: 'Reports & Proposal', built: false, financial: false, hidden: false },
  { slug: 'schedule',   label: 'Schedule',           built: false, financial: false, hidden: false },
  { slug: 'operations', label: 'Operations',         built: false, financial: false, hidden: true },
]

export function visibleSolarTabs(level: SolarAccessLevel): SolarTab[] {
  return SOLAR_TABS.filter((t) => !t.hidden && (!t.financial || level === 'edit_financials'))
}

export type ReadinessStatus = 'grey' | 'amber' | 'green' | 'red'

export interface ReadinessStep {
  slug: Exclude<SolarTabSlug, 'overview'>
  label: string
  status: ReadinessStatus
  /** The exact rule outcome — used as the dot tooltip and the checklist text. */
  reason: string
  /** The step's tab exists (so the checklist row can link to it). */
  live: boolean
}

export interface SiteReadinessInput {
  latitude: number | null
  longitude: number | null
  licenseeName: string | null
  nmdKva: number | null
}

export const SA_BOUNDS = { latMin: -35, latMax: -22, lngMin: 16, lngMax: 33 } as const
export const LATER_PHASE_REASON = 'Not started — available in a later phase'

export function isInSouthAfrica(lat: number, lng: number): boolean {
  return lat >= SA_BOUNDS.latMin && lat <= SA_BOUNDS.latMax && lng >= SA_BOUNDS.lngMin && lng <= SA_BOUNDS.lngMax
}

export function siteReadiness(s: SiteReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!s) return { status: 'grey', reason: 'Not started' }
  const hasCoords = s.latitude !== null && s.longitude !== null
  const missing: string[] = []
  if (!hasCoords) missing.push('coordinates')
  if (!s.licenseeName || !s.licenseeName.trim()) missing.push('supply authority')
  if (s.nmdKva === null) missing.push('connection capacity (NMD kVA)')
  if (hasCoords && !isInSouthAfrica(s.latitude as number, s.longitude as number)) {
    return { status: 'red', reason: 'Coordinates are outside South Africa — check the location' }
  }
  if (missing.length === 3) return { status: 'grey', reason: 'Not started' }
  if (missing.length > 0) return { status: 'amber', reason: `Missing: ${missing.join(', ')}` }
  return { status: 'green', reason: 'Coordinates, supply authority and NMD are set' }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** A solar.studies row (or null) → the readiness input. */
export function toSiteReadinessInput(row: Record<string, unknown> | null | undefined): SiteReadinessInput | null {
  if (!row) return null
  return {
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    licenseeName: typeof row.licensee_name === 'string' ? row.licensee_name : null,
    nmdKva: num(row.nmd_kva),
  }
}

export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
```

Append to `packages/shared/src/solar/index.ts`:
```ts
export * from './readiness'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar
git commit -m "feat(solar): tab list and readiness rules (Site & Supply live, later phases grey)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration 00209 — org settings, notification types, product events (red → green)

**Files:**
- Create: `scripts/db/assert-solar-org-settings-roles.sql`
- Create: `apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql`
- Modify: `packages/shared/src/lib/analytics/product-events.ts`
- Modify: `packages/shared/src/lib/analytics/product-events.contract.test.ts`

- [ ] **Step 1: Write the behavioural assertions (they must fail before the migration exists)**

`scripts/db/assert-solar-org-settings-roles.sql`:
```sql
-- BEHAVIOURAL assertions for 00209_solar_org_settings, run as real roles.
--   Red:   scripts/db/dry-run-migration.sh <red.sql>   scripts/db/assert-solar-org-settings-roles.sql
--   Green: scripts/db/dry-run-migration.sh <green.sql> scripts/db/assert-solar-org-settings-roles.sql
-- where red.sql / green.sql are built in the plan (Task 4 Step 2): 00208 must be in
-- front of 00209 while 00208 is not yet applied to production.
-- Fixtures are minted inside the transaction and rolled back. Seeding happens as
-- postgres before any impersonation (request.jwt.claims outlives RESET ROLE).
-- REFUSAL PATTERN: a "…_REFUSED" check catches only the SQLSTATE the design
-- promises; an allowed statement raises P0001 itself so the write rolls back.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org (settings writer)
  v_con     UUID := gen_random_uuid();   -- contractor of v_org
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_n       INT;
  v_by      UUID;
  u         UUID;
  t         TEXT;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES
    (v_org, 'solar-settings-probe'), (v_org2, 'solar-settings-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_con, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-settings-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_con, v_org, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);

  -- ── 1. Admin writes own org's settings; updated_by is bound, not trusted ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.org_settings (organisation_id, settings, updated_by)
    VALUES (v_org, '{"version":1,"values":{"discount_rate_pct":11}}'::jsonb, v_con);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_inserts_own_org', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_inserts_own_org', false);
  END;
  SELECT updated_by INTO v_by FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('updated_by_bound_to_caller', v_by IS NOT DISTINCT FROM v_admin);
  BEGIN
    UPDATE solar.org_settings SET settings = '{"version":1,"values":{"discount_rate_pct":12}}'::jsonb
     WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_updates_own_org', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_updates_own_org', false);
  END;
  BEGIN
    UPDATE solar.org_settings SET settings = '[]'::jsonb WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('non_object_settings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('non_object_settings_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.org_settings SET organisation_id = v_org2 WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('org_move_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('org_move_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.org_settings WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_delete_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.org_settings (organisation_id) VALUES (v_org2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_insert_foreign_org_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_insert_foreign_org_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 2. Contractor of the same org: reads nothing, writes nothing ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('contractor_reads_nothing', v_n = 0);
  BEGIN
    UPDATE solar.org_settings SET settings = '{}'::jsonb WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('contractor_update_affects_nothing', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('contractor_update_affects_nothing', false);
  END;
  RESET ROLE;

  -- ── 3. Admin of another org: reads nothing, writes nothing ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('foreign_admin_reads_nothing', v_n = 0);
  BEGIN
    UPDATE solar.org_settings SET settings = '{}'::jsonb WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('foreign_admin_update_affects_nothing', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('foreign_admin_update_affects_nothing', false);
  END;
  RESET ROLE;

  -- ── 4. anon has no access at all ─────────────────────────────────────────
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.org_settings LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 5. The re-declared CHECKs accept the new values, keep the old, refuse junk
  FOREACH t IN ARRAY ARRAY['solar_subscribe_requested', 'solar_access_requested',
                           'solar_access_changed', 'solar_access_declined', 'billing_dispute_opened'] LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, organisation_id, type, title) VALUES (v_admin, v_org, t, 'probe');
      INSERT INTO _r VALUES ('notification_type_' || t, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _r VALUES ('notification_type_' || t, false);
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.notifications (user_id, organisation_id, type, title) VALUES (v_admin, v_org, 'solar_bogus', 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('notification_unknown_type_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('notification_unknown_type_REFUSED', false);
  END;
  FOREACH t IN ARRAY ARRAY['solar_subscribe_requested', 'solar_access_requested', 'solar_access_changed',
                           'solar_site_saved', 'solar_settings_saved', 'cable_route_sheet_exported'] LOOP
    BEGIN
      INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, t);
      INSERT INTO _r VALUES ('product_event_' || t, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _r VALUES ('product_event_' || t, false);
    END;
  END LOOP;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it RED**

First learn whether 00208 is already in production:
```bash
bash -c '. scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head, bool_or(version = '"'"'00208'"'"') AS has_00208 FROM supabase_migrations.schema_migrations;"'
```
Build the two input files in the session scratchpad (`$S`, e.g. `S=$(mktemp -d)`):
- If `has_00208` is **false**: `cp apps/edge-functions/supabase/migrations/00208_solar_foundation.sql "$S/red.sql"`
- If `has_00208` is **true**: `echo 'SELECT 1;' > "$S/red.sql"`

```bash
scripts/db/dry-run-migration.sh "$S/red.sql" scripts/db/assert-solar-org-settings-roles.sql
```
Expected: RED — the file aborts (`relation "solar.org_settings" does not exist`) and is reported as one failed assertion.

- [ ] **Step 3: Write the migration**

`apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql`:
```sql
-- ---------------------------------------------------------------------------
-- Migration 00209: Solar org settings, notification types, product events
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (feat/solar-phase-1b
-- included). If 00209 is taken, renumber this file (and the header of
-- scripts/db/assert-solar-org-settings-roles.sql) above the head first.
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- Spec: docs/solar/01-functional-spec.md §11 (org settings), §1.2/§1.3
-- (request + approval notifications), §0.4 rule 8 (solar_* product events);
-- docs/solar/03-data-model-and-security.md §2 (org_settings: org_id,
-- settings jsonb versioned, updated_by). Defaults live in code
-- (@esite/shared solar/org-settings.ts), seeded from D-05, D-07, D-16.
--
-- WHAT.
--   1. solar.org_settings — one row per organisation; the JSON of defaults
--      every new case copies. Owners/admins of the org read and write it;
--      nobody deletes it (a case snapshot never depends on the row existing).
--   2. public.notifications type CHECK re-declared IN FULL with four Solar
--      types (00190's list + solar_*). A type missing here makes the bell
--      insert fail silently in send-notification.
--   3. public.product_events event CHECK re-declared IN FULL with five
--      solar_* verbs (00199's list + solar_*). packages/shared PRODUCT_EVENTS
--      and its contract test change in the same PR.
--
-- 00208's schema-wide @verify directives are re-checked on every deploy and
-- this migration conforms to each: FORCE RLS on the new relkind 'r' table; no
-- RESTRICTIVE policy covering SELECT anywhere in solar; the SECURITY DEFINER
-- bind function revokes EXECUTE from PUBLIC and anon.
--
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.org_settings
-- constraint: org_settings_settings_is_object ON solar.org_settings
-- function: solar.org_settings_bind()
-- trigger: org_settings_bind ON solar.org_settings
-- policy: org_settings_select ON solar.org_settings PERMISSIVE
-- policy: org_settings_insert ON solar.org_settings PERMISSIVE
-- policy: org_settings_update ON solar.org_settings PERMISSIVE
-- grant_absent: anon SELECT ON solar.org_settings
-- grant_absent: authenticated DELETE ON solar.org_settings
-- grant_absent: anon EXECUTE ON solar.org_settings_bind()
-- sql: (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'solar.org_settings'::regclass)
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid = 'solar.org_settings'::regclass AND polcmd IN ('d', '*'))
-- constraint: notifications_type_check ON public.notifications
-- sql: EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%solar_subscribe_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_changed%' AND pg_get_constraintdef(oid) LIKE '%solar_access_declined%' AND pg_get_constraintdef(oid) LIKE '%billing_dispute_opened%' AND pg_get_constraintdef(oid) LIKE '%site_form_distributed%')
-- constraint: product_events_event_check ON public.product_events
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_subscribe_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_changed%' AND pg_get_constraintdef(oid) LIKE '%solar_site_saved%' AND pg_get_constraintdef(oid) LIKE '%solar_settings_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conname = 'product_events_event_check')
-- behaviour: scripts/db/assert-solar-org-settings-roles.sql — every row ok
-- @verify:end

-- ── 1. solar.org_settings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.org_settings (
    organisation_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
    settings         JSONB NOT NULL DEFAULT '{}'::jsonb
                       CONSTRAINT org_settings_settings_is_object CHECK (jsonb_typeof(settings) = 'object'),
    version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The organisation is the row's identity: immutable. Attribution and
-- timestamps are bound, never trusted from the client.
CREATE OR REPLACE FUNCTION solar.org_settings_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.org_settings: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    END IF;
    IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.org_settings_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.org_settings_bind() FROM anon;
CREATE TRIGGER org_settings_bind BEFORE INSERT OR UPDATE ON solar.org_settings
    FOR EACH ROW EXECUTE FUNCTION solar.org_settings_bind();

ALTER TABLE solar.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.org_settings FORCE ROW LEVEL SECURITY;
-- Per verb, PERMISSIVE only (00208 forbids a RESTRICTIVE read policy in solar).
-- Owners/admins of the org only: the defaults include rate cards (money).
CREATE POLICY org_settings_select ON solar.org_settings FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                      AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY org_settings_insert ON solar.org_settings FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo
                         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                           AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY org_settings_update ON solar.org_settings FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                      AND uo.is_active AND uo.role IN ('owner', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo
                         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                           AND uo.is_active AND uo.role IN ('owner', 'admin')));
-- No DELETE policy and no DELETE grant.

GRANT SELECT, INSERT, UPDATE ON solar.org_settings TO authenticated;
-- The schema's default privileges granted DELETE/TRUNCATE at CREATE TABLE; take them back.
REVOKE DELETE, TRUNCATE ON solar.org_settings FROM authenticated;
GRANT ALL ON solar.org_settings TO service_role;
REVOKE ALL ON solar.org_settings FROM anon;

-- ── 2. Notification types (re-declared in full: 00190's list + Solar) ───────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
        'snag_status_changed',
        'rfi_assigned',
        'rfi_closed',
        'rfi_response',
        'grn_recorded',
        'inspection_assigned',
        'inspection_awaiting_verification',
        'inspection_certified',
        'inspection_re_inspect_required',
        'inspection_revoked',
        'inspection_abandoned',
        'qc_issued',
        'rfi_created',
        'snag_created',
        'diary_created',
        'qc_comment',
        'snag_visit_completed',
        'site_form_distributed',
        'billing_duplicate_charge',
        'billing_refund_processed',
        'billing_dispute_opened',
        -- 00209: Solar access requests and decisions
        'solar_subscribe_requested',
        'solar_access_requested',
        'solar_access_changed',
        'solar_access_declined'
    ]::text[])
);

-- ── 3. Product events (re-declared in full: 00199's list + Solar) ───────────
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved'
));

NOTIFY pgrst, 'reload schema';
```
If Task 1 Step 3 found that 1B re-declared either CHECK, replace the corresponding list above with 1B's list plus the Solar lines, and add each of 1B's new values to the matching `sql:` directive's `LIKE` chain.

- [ ] **Step 4: Run it GREEN**

```bash
grep -n "COMMIT\|BEGIN;" apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql   # must print nothing
```
- If `has_00208` was **false**: `cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql > "$S/green.sql"`
- If **true**: `cp apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql "$S/green.sql"`

```bash
scripts/db/dry-run-migration.sh "$S/green.sql" scripts/db/assert-solar-org-settings-roles.sql
```
Expected: every row `ok = t` (24 checks). If one is `f`, fix the **migration**, not the assertion.

- [ ] **Step 5: Mutation checks (prove two checks can fail)**

(a) Change `org_settings_select`'s `USING (…)` to `USING (true)`; rebuild `green.sql`; re-run → `contractor_reads_nothing` and `foreign_admin_reads_nothing` go `f`. Revert.
(b) Delete the line `NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);`; rebuild; re-run → `updated_by_bound_to_caller` goes `f`. Revert, rebuild, re-run → all `t`.
Save the red, green and both mutation outputs to `/tmp/solar-1c-dryrun.txt` for the PR body.

- [ ] **Step 6: Registry + contract test**

In `packages/shared/src/lib/analytics/product-events.ts`, replace the tail of `PRODUCT_EVENTS`:
```ts
  // Cable route measurement (00199).
  'cable_route_leg_saved',
  'cable_route_assigned',
  'cable_route_sheet_exported',
  // Solar (00209).
  'solar_subscribe_requested',
  'solar_access_requested',
  'solar_access_changed',
  'solar_site_saved',
  'solar_settings_saved',
] as const
```

In `packages/shared/src/lib/analytics/product-events.contract.test.ts`, add below `migrationContaining`:
```ts
/**
 * The LAST migration (by filename) containing `needle` — for a CHECK that is
 * dropped and re-added by later migrations (00199, then 00209 …), the
 * definition in force is the newest one.
 */
function lastMigrationContaining(needle: string): string {
  const sources = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8')))
  const sql = [...sources].reverse().find((s) => s.includes(needle))
  if (!sql) throw new Error(`No migration contains ${needle}`)
  return sql
}
```
and change the product-event test body's first line to:
```ts
    const sql = lastMigrationContaining('ADD CONSTRAINT product_events_event_check')
```

- [ ] **Step 7: Run shared + db suites**

```bash
pnpm --filter @esite/shared exec vitest run src/lib/analytics/product-events.contract.test.ts
pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
pnpm --filter @esite/db test:ci 2>&1 | tail -8
```
Expected: all PASS. (The web contract test parses the new `@verify` block; an unknown directive or an em dash in a `sql:` payload fails it.)

- [ ] **Step 8: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql scripts/db/assert-solar-org-settings-roles.sql packages/shared/src/lib/analytics
git commit -m "feat(solar): 00209 — org settings table, Solar notification types and product events

Dry run red (relation missing) → green 24/24; mutation-proven on the read
policy and the updated_by binding.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Test fake, error mapping, price line, dirty store

**Files:**
- Create: `apps/web/src/test/fake-supabase.ts`
- Create: `apps/web/src/lib/solar/errors.ts`, `apps/web/src/lib/solar/errors.test.ts`
- Create: `apps/web/src/lib/solar/price.ts`, `apps/web/src/lib/solar/price.test.ts`
- Create: `apps/web/src/lib/solar/dirty-store.ts`, `apps/web/src/lib/solar/dirty-store.test.ts`

- [ ] **Step 1: Write the fake (test infrastructure, no test of its own)**

`apps/web/src/test/fake-supabase.ts`:
```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A small chainable Supabase fake for server-action and loader tests.
 *
 *   const { client, calls } = fakeSupabase({
 *     userId: 'u1',
 *     rpc: { solar_is_grantor: { data: true, error: null } },
 *     tables: { 'solar.project_access': [{ project_id: 'p1', user_id: 'u2', level: 'view' }] },
 *     writes: { 'solar.project_access:update': { data: [] } },   // 0 rows affected
 *   })
 *
 * SELECTs filter `tables[schema.table]` by eq / neq / in. Writes are recorded
 * in `calls` and resolve to `writes['schema.table:op']` (default: the payload
 * echoed back as one row; delete → []). `client.from(t)` is schema `public`.
 */
import { vi } from 'vitest'

export type FakeError = { message: string; code?: string }
export type FakeResult = { data: unknown; error: FakeError | null }
type Filter = ['eq' | 'neq' | 'in', string, unknown]

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: unknown
  filters: Filter[]
}

export interface FakeOptions {
  userId?: string | null
  rpc?: Record<string, FakeResult | ((args: Record<string, unknown>) => FakeResult)>
  tables?: Record<string, Array<Record<string, unknown>>>
  writes?: Record<string, Partial<FakeResult>>
}

export function fakeSupabase(opts: FakeOptions = {}) {
  const calls: FakeCall[] = []
  const userId = opts.userId === undefined ? 'user-1' : opts.userId

  const matches = (row: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) =>
      op === 'eq' ? row[col] === val : op === 'neq' ? row[col] !== val : (val as unknown[]).includes(row[col]))

  function builder(table: string) {
    const state: { op: FakeCall['op']; payload?: unknown; filters: Filter[]; limit?: number } = { op: 'select', filters: [] }
    const run = (): Promise<FakeResult> => {
      calls.push({ table, op: state.op, payload: state.payload, filters: [...state.filters] })
      if (state.op === 'select') {
        let rows = (opts.tables?.[table] ?? []).filter((r) => matches(r, state.filters))
        if (state.limit !== undefined) rows = rows.slice(0, state.limit)
        return Promise.resolve({ data: rows, error: null })
      }
      const w = opts.writes?.[`${table}:${state.op}`]
      const echo = state.op === 'delete' ? [] : Array.isArray(state.payload) ? state.payload : [state.payload]
      return Promise.resolve({ data: w?.data ?? echo, error: w?.error ?? null })
    }
    const first = () =>
      run().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }))
    const b: any = {
      select: () => b,
      insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return b },
      update: (p: unknown) => { state.op = 'update'; state.payload = p; return b },
      delete: () => { state.op = 'delete'; return b },
      eq: (c: string, v: unknown) => { state.filters.push(['eq', c, v]); return b },
      neq: (c: string, v: unknown) => { state.filters.push(['neq', c, v]); return b },
      in: (c: string, v: unknown[]) => { state.filters.push(['in', c, v]); return b },
      order: () => b,
      limit: (n: number) => { state.limit = n; return b },
      maybeSingle: first,
      single: first,
      then: (res: (v: FakeResult) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    }
    return b
  }

  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      const r = opts.rpc?.[name]
      if (!r) return { data: null, error: null }
      return typeof r === 'function' ? r(args) : r
    }),
    schema: (s: string) => ({ from: (t: string) => builder(`${s}.${t}`) }),
    from: (t: string) => builder(`public.${t}`),
  }
  return { client, calls }
}

export function callsTo(calls: FakeCall[], table: string, op: FakeCall['op']): FakeCall[] {
  return calls.filter((c) => c.table === table && c.op === op)
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/solar/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { humanSolarError, STALE_MESSAGE } from './errors'

describe('humanSolarError', () => {
  it('maps the 00208 guard and bind sentences to plain English', () => {
    expect(humanSolarError({ code: '23505', message: 'duplicate key value violates unique constraint "access_requests_one_pending"' }))
      .toBe('You already have a request waiting for an answer.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: requester is not an eligible member of this project' }))
      .toBe('Your account cannot be given Solar access on this project.')
    expect(humanSolarError({ code: '23514', message: 'solar.project_access: user is not an eligible member of this project' }))
      .toBe('This person cannot be given Solar access on this project. Clients and suppliers never can, and only active project members can.')
    expect(humanSolarError({ code: '23514', message: 'solar.project_access: level edit exceeds this user\'s maximum (view)' }))
      .toBe('That level is higher than this person can hold. Members from outside the organisation can have View only.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: request already approved' }))
      .toBe('This request has already been answered — reload to see it.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: only members of the project\'s organisation may request a subscription' }))
      .toBe('Only members of this project’s organisation can ask for a subscription.')
  })
  it('never leaks a raw message', () => {
    expect(humanSolarError({ code: 'XX000', message: 'internal error at pg_foo.c:12' })).toBe('Something went wrong — try again.')
    expect(humanSolarError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('You do not have permission to do that.')
    expect(humanSolarError(null)).toBe('Something went wrong — try again.')
  })
  it('exports the stale-write sentence verbatim', () => {
    expect(STALE_MESSAGE).toBe('Someone else changed this — reload to see their version.')
  })
})
```

`apps/web/src/lib/solar/price.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { solarPriceLine } from './price'

describe('solarPriceLine', () => {
  it('reads the annual price and states the org-wide, VAT-exclusive scope', () => {
    expect(solarPriceLine()).toBe('R1,999 per year excl. VAT for your whole organisation — every project')
  })
})
```

`apps/web/src/lib/solar/dirty-store.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { isSolarDirty, setSolarDirty, useSolarDirtyGuard } from './dirty-store'

afterEach(() => { setSolarDirty(false) })

describe('solar dirty store', () => {
  it('holds a single unsaved-changes flag', () => {
    expect(isSolarDirty()).toBe(false)
    setSolarDirty(true)
    expect(isSolarDirty()).toBe(true)
  })

  it('the guard mirrors the form state, arms beforeunload, and clears on unmount', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useSolarDirtyGuard(dirty), { initialProps: { dirty: false } })
    expect(isSolarDirty()).toBe(false)
    rerender({ dirty: true })
    expect(isSolarDirty()).toBe(true)
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    unmount()
    expect(isSolarDirty()).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/solar/errors.test.ts src/lib/solar/price.test.ts src/lib/solar/dirty-store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/web/src/lib/solar/errors.ts`:
```ts
/**
 * Postgres/PostgREST errors from the Solar tables → one human sentence
 * (spec §0.4 rule 5). Keyed on the SQLSTATE and the exact sentences raised by
 * 00208's bind trigger and request guard. Never returns the raw message.
 */
export const STALE_MESSAGE = 'Someone else changed this — reload to see their version.'
export const ALREADY_ANSWERED = 'This request has already been answered — reload to see it.'
export const GENERIC_ERROR = 'Something went wrong — try again.'

export function humanSolarError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (err?.code === '23505') return 'You already have a request waiting for an answer.'
  if (m.includes('requester is not an eligible member')) return 'Your account cannot be given Solar access on this project.'
  if (m.includes('not an eligible member')) {
    return 'This person cannot be given Solar access on this project. Clients and suppliers never can, and only active project members can.'
  }
  if (m.includes('exceeds')) {
    return 'That level is higher than this person can hold. Members from outside the organisation can have View only.'
  }
  if (m.includes('request a subscription')) return 'Only members of this project’s organisation can ask for a subscription.'
  if (m.includes('request already')) return ALREADY_ANSWERED
  if (m.includes('point-of-connection node')) return 'That board belongs to another project.'
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return GENERIC_ERROR
}
```

`apps/web/src/lib/solar/price.ts`:
```ts
import { FEATURE_PRICES, formatRandWhole } from '@esite/shared'

/**
 * The Solar annual price. Phase 1B adds FEATURE_PRICES.solar; until that
 * branch is merged underneath this one the decided price (D-01: R1,999/year
 * excl. VAT) is the fallback, so the page never shows a blank price.
 */
export const SOLAR_ANNUAL_FALLBACK_KOBO = 199900

export function solarAnnualPriceKobo(): number {
  const p = (FEATURE_PRICES as unknown as Record<string, { amountKobo?: unknown } | undefined>).solar
  return typeof p?.amountKobo === 'number' ? p.amountKobo : SOLAR_ANNUAL_FALLBACK_KOBO
}

export function solarPriceLine(): string {
  return `${formatRandWhole(solarAnnualPriceKobo())} per year excl. VAT for your whole organisation — every project`
}
```
If 1B's `FEATURE_PRICES.solar.amountKobo` is not `199900`, the price test must be updated to the formatted 1B figure (1B is the source of truth).

`apps/web/src/lib/solar/dirty-store.ts`:
```ts
'use client'

/**
 * One "unsaved changes" flag for the Solar module. A form sets it through
 * useSolarDirtyGuard; the tab bar reads it before navigating and asks
 * "Discard unsaved changes?" inline (never window.confirm). The guard also
 * arms the browser's beforeunload prompt for tab-close / reload.
 */
import { useEffect } from 'react'

let dirty = false

export function isSolarDirty(): boolean {
  return dirty
}

export function setSolarDirty(value: boolean): void {
  dirty = value
}

export function useSolarDirtyGuard(isDirty: boolean): void {
  useEffect(() => {
    setSolarDirty(isDirty)
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => () => setSolarDirty(false), [])
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/solar/`
Expected: PASS (including 1A's `access.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test/fake-supabase.ts apps/web/src/lib/solar
git commit -m "feat(solar): error sentences, price line, unsaved-changes store, Supabase test fake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `loadSolarEntry` — gather the database's answers

**Files:**
- Create: `apps/web/src/lib/solar/entry-loader.ts`, `apps/web/src/lib/solar/entry-loader.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/entry-loader.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { loadSolarEntry } from './entry-loader'
import { fakeSupabase } from '@/test/fake-supabase'

const P = 'p1'
const ORG = 'org-1'
const U = 'user-1'

function setup(o: {
  role?: string | null
  level?: string | null
  levelError?: boolean
  grantor?: boolean
  member?: boolean
  subscribed?: boolean
  requests?: Array<Record<string, unknown>>
  project?: boolean
} = {}) {
  return fakeSupabase({
    userId: U,
    rpc: {
      user_effective_project_role: { data: o.role === undefined ? 'contractor' : o.role, error: null },
      solar_access_level: o.levelError ? { data: 'edit', error: { message: 'boom' } } : { data: o.level ?? null, error: null },
      solar_is_grantor: { data: o.grantor ?? false, error: null },
      org_has_solar: { data: o.subscribed ?? false, error: null },
    },
    tables: {
      'projects.projects': o.project === false ? [] : [{ id: P, name: 'Mall', organisation_id: ORG }],
      'public.user_organisations': o.member === false ? [] : [{ user_id: U, organisation_id: ORG, is_active: true }],
      'solar.access_requests': o.requests ?? [],
    },
  })
}

describe('loadSolarEntry', () => {
  it('returns null for an unknown project', async () => {
    const { client } = setup({ project: false })
    await expect(loadSolarEntry(P, client as never)).resolves.toBeNull()
  })

  it('own-org member, subscribed, no grant → request access up to edit + financials', async () => {
    const { client } = setup({ subscribed: true })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx).toEqual({
      projectId: P, projectName: 'Mall', organisationId: ORG, userId: U,
      state: { kind: 'request_access', maxLevel: 'edit_financials' },
    })
  })

  it('finds my pending access request on this project', async () => {
    const { client } = setup({
      subscribed: true,
      requests: [{ project_id: P, requester_id: U, organisation_id: ORG, kind: 'access', status: 'pending', created_at: '2026-09-28T08:00:00Z' }],
    })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('finds a pending subscribe request raised from ANOTHER project of the org', async () => {
    const { client } = setup({
      subscribed: false,
      requests: [{ project_id: 'p-other', requester_id: U, organisation_id: ORG, kind: 'subscribe', status: 'pending', created_at: '2026-09-27T08:00:00Z' }],
    })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'ask_admin', requestedAt: '2026-09-27T08:00:00Z' })
  })

  it('an external member never asks org_has_solar (it is false for non-members) and may request View', async () => {
    const { client } = setup({ member: false, subscribed: true })
    const ctx = await loadSolarEntry(P, client as never)
    expect(ctx?.state).toEqual({ kind: 'request_access', maxLevel: 'view' })
    expect(client.rpc).not.toHaveBeenCalledWith('org_has_solar', expect.anything())
  })

  it('grantor of an unsubscribed org → subscribe', async () => {
    const { client } = setup({ role: 'admin', grantor: true, subscribed: false })
    expect((await loadSolarEntry(P, client as never))?.state).toEqual({ kind: 'subscribe' })
  })

  it('a supplier is hidden', async () => {
    const { client } = setup({ role: 'supplier' })
    expect((await loadSolarEntry(P, client as never))?.state).toEqual({ kind: 'hidden' })
  })

  it('an RPC error on the level fails closed (treated as no access)', async () => {
    const { client } = setup({ levelError: true, subscribed: true })
    expect((await loadSolarEntry(P, client as never))?.state.kind).toBe('request_access')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/solar/entry-loader.test.ts`
Expected: FAIL — cannot resolve `./entry-loader`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/entry-loader.ts`:
```ts
import 'server-only'
/**
 * Gather everything resolveSolarEntry needs, from the caller's own session.
 * Every read is something the caller is allowed to see (own org membership,
 * own requests, SECURITY DEFINER helpers that answer only for the caller).
 * Fails closed: an RPC error counts as "no".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, resolveSolarEntry, type SolarEntryState } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface SolarEntryContext {
  projectId: string
  projectName: string
  organisationId: string
  userId: string
  state: SolarEntryState
}

interface PendingRow { project_id: string; kind: string; created_at: string }

export async function loadSolarEntry(projectId: string, supabase?: AnyClient): Promise<SolarEntryContext | null> {
  const client = supabase ?? ((await createClient()) as unknown as AnyClient)
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null

  const { data: project } = await client
    .schema('projects').from('projects')
    .select('id, name, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null
  const organisationId = project.organisation_id as string

  const [roleRes, levelRes, grantorRes, memberRes, pendingRes] = await Promise.all([
    client.rpc('user_effective_project_role', { p_project_id: projectId, p_user_id: user.id }),
    client.rpc('solar_access_level', { p_project_id: projectId }),
    client.rpc('solar_is_grantor', { p_project_id: projectId }),
    client.from('user_organisations').select('organisation_id')
      .eq('user_id', user.id).eq('organisation_id', organisationId).eq('is_active', true).limit(1),
    client.schema('solar').from('access_requests').select('project_id, kind, created_at')
      .eq('requester_id', user.id).eq('organisation_id', organisationId).eq('status', 'pending'),
  ])

  const isOwnOrgMember = Array.isArray(memberRes.data) && memberRes.data.length > 0
  // org_has_solar is false for non-members of the org; asking it for an
  // external member would read "unsubscribed" when the truth is "unknown".
  const subRes = isOwnOrgMember
    ? await client.rpc('org_has_solar', { p_org_id: organisationId })
    : { data: false, error: null }
  const pending = (pendingRes.data ?? []) as PendingRow[]

  const state = resolveSolarEntry({
    effectiveRole: roleRes.error ? null : ((roleRes.data as string | null) ?? null),
    level: !levelRes.error && isSolarAccessLevel(levelRes.data) ? levelRes.data : null,
    isGrantor: !grantorRes.error && grantorRes.data === true,
    isOwnOrgMember,
    orgSubscribed: !subRes.error && subRes.data === true,
    pendingAccessRequestAt: pending.find((r) => r.kind === 'access' && r.project_id === projectId)?.created_at ?? null,
    pendingSubscribeRequestAt: pending.find((r) => r.kind === 'subscribe')?.created_at ?? null,
  })

  return { projectId, projectName: project.name as string, organisationId, userId: user.id, state }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/solar/entry-loader.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/entry-loader.ts apps/web/src/lib/solar/entry-loader.test.ts
git commit -m "feat(solar): loadSolarEntry — one resolved state for sidebar, redirect, locked page and actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Grantors, notifications and audit helpers

**Files:**
- Create: `apps/web/src/lib/solar/grantors.ts`
- Create: `apps/web/src/lib/solar/notify.ts`, `apps/web/src/lib/solar/notify.test.ts`
- Create: `apps/web/src/lib/solar/audit.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/notify.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {}),
  filter: vi.fn(async (_c: unknown, emails: string[]) => ({
    allowed: emails.filter((e) => e !== 'bounced@x.test'),
    suppressed: emails.filter((e) => e === 'bounced@x.test'),
  })),
  fetch: vi.fn(async () => new Response('{}', { status: 200 })),
}))

vi.mock('@/lib/notifications', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: vi.fn(() => ({})) }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await orig<typeof import('@esite/shared')>()),
  filterSuppressed: h.filter,
}))

import { notifySolarUsers } from './notify'

const notice = {
  type: 'solar_access_requested' as const,
  projectId: 'p1',
  projectName: 'Mall',
  title: 'Bob asked for Solar access',
  body: 'Bob asked for Edit access to Solar on Mall.',
  route: '/projects/p1/solar/access',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', h.fetch)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.e-site.live')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('notifySolarUsers', () => {
  it('always sends the bell with the Solar type and route', async () => {
    await notifySolarUsers(['a1'], [], { ...notice, email: false })
    expect(h.dispatch).toHaveBeenCalledWith({
      userIds: ['a1'], title: notice.title, body: notice.body, route: notice.route,
      type: 'solar_access_requested', entityType: 'solar_project', entityId: 'p1',
    })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('emails only unsuppressed addresses through send-email', async () => {
    await notifySolarUsers(['a1', 'a2'], ['ann@x.test', 'bounced@x.test'], { ...notice, email: true })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sb.test/functions/v1/send-email')
    const body = JSON.parse(String(init.body))
    expect(body.type).toBe('rfi-created')
    expect(body.payload.to).toEqual(['ann@x.test'])
    expect(body.payload.subject).toBe(notice.title)
    expect(body.payload.html).toContain('https://www.e-site.live/projects/p1/solar/access')
  })

  it('does nothing for an empty audience', async () => {
    await notifySolarUsers([], [], { ...notice, email: true })
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/solar/notify.test.ts`
Expected: FAIL — cannot resolve `./notify`.

- [ ] **Step 3: Implement the three helpers**

`apps/web/src/lib/solar/grantors.ts`:
```ts
import 'server-only'
/**
 * Owners/admins of an organisation — the Solar grantors (00208
 * public.solar_is_grantor). Read with the service client because
 * user_organisations RLS is own-row-only; callers only use this AFTER their
 * own gate (a requester notifying the people who can answer, or naming them
 * on the "Request sent to …" line).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface SolarGrantor {
  userId: string
  fullName: string | null
  email: string | null
}

export async function listSolarGrantors(organisationId: string): Promise<SolarGrantor[]> {
  const svc = createServiceClient() as unknown as AnyClient
  const { data: rows, error } = await svc
    .from('user_organisations').select('user_id')
    .eq('organisation_id', organisationId).eq('is_active', true).in('role', ['owner', 'admin'])
  if (error || !rows?.length) return []
  const ids = [...new Set(rows.map((r: { user_id: string }) => r.user_id))]
  const { data: profiles } = await svc.from('profiles').select('id, full_name, email').in('id', ids)
  const byId = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]))
  return ids.map((id) => ({ userId: id, fullName: byId.get(id)?.full_name ?? null, email: byId.get(id)?.email ?? null }))
}

/** Names for "Request sent to Ann and Ben" — never an email address. */
export function grantorDisplayNames(grantors: SolarGrantor[]): string[] {
  const names = grantors.map((g) => g.fullName?.trim() || 'an organisation admin')
  return [...new Set(names)]
}

/** A user's display name for notification text. */
export async function profileName(userId: string): Promise<string> {
  const svc = createServiceClient() as unknown as AnyClient
  const { data } = await svc.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  const name = (data as { full_name?: string | null } | null)?.full_name?.trim()
  return name || 'A project member'
}
```

`apps/web/src/lib/solar/notify.ts`:
```ts
import 'server-only'
/**
 * Solar notifications: bell (+push) through dispatchNotification, optional
 * branded email through send-email. Unlike lib/notify.ts this does NOT go to
 * the project roster — Solar requests go to the org's owners/admins and
 * decisions go to one person. Never throws (a failed notification must not
 * fail the user's action). The four types are in notifications_type_check
 * from 00209; a type missing there makes the bell insert fail silently.
 *
 * Email uses send-email's `rfi-created` passthrough ({to, subject, html}),
 * the same shape lib/notify.ts uses for every module.
 */
import { DEFAULT_ACCENT_COLOR, escapeHtml, filterSuppressed, renderBrandedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

export type SolarNotificationType =
  | 'solar_subscribe_requested'
  | 'solar_access_requested'
  | 'solar_access_changed'
  | 'solar_access_declined'

export interface SolarNotice {
  type: SolarNotificationType
  projectId: string
  projectName: string
  title: string
  body: string
  /** App route, e.g. /projects/<id>/solar/access */
  route: string
  email: boolean
}

export async function notifySolarUsers(userIds: string[], emails: string[], n: SolarNotice): Promise<void> {
  if (userIds.length === 0) return
  await dispatchNotification({
    userIds, title: n.title, body: n.body, route: n.route,
    type: n.type, entityType: 'solar_project', entityId: n.projectId,
  })
  if (!n.email || emails.length === 0) return
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const { allowed } = await filterSuppressed(createServiceClient() as never, emails)
    if (allowed.length === 0) return
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')
    const link = `${siteUrl}${n.route}`
    const html = renderBrandedEmail({
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      projectName: n.projectName,
      title: n.title,
      contentHtml: `<p>${escapeHtml(n.body)}</p><p><a href="${escapeHtml(link)}">Open in E-Site</a></p>`,
      siteUrl,
    })
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: allowed, subject: n.title, html } }),
    })
    if (!res.ok) console.error('[solar-notify] email failed', { type: n.type, status: res.status })
  } catch (e) {
    console.error('[solar-notify] email threw', { type: n.type, err: String(e) })
  }
}
```

`apps/web/src/lib/solar/audit.ts`:
```ts
import 'server-only'
/**
 * Append one row to solar.audit_events (feeds Overview → Recent activity).
 * Written with the service client AFTER the action's own gate has passed:
 * the RLS insert policy requires solar_can_edit, which is false while the org
 * is unsubscribed — and grantors may legitimately grant access before paying.
 * The bind trigger derives organisation_id from the project; actor_id is kept
 * as passed because auth.uid() is NULL on the service path.
 * Never throws: an audit failure must not fail the user's action.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function recordSolarAudit(a: {
  projectId: string
  actorId: string
  verb: string
  objectRef?: Record<string, unknown>
}): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as AnyClient
    const { error } = await svc.schema('solar').from('audit_events').insert({
      project_id: a.projectId, actor_id: a.actorId, verb: a.verb, object_ref: a.objectRef ?? {},
    })
    if (error) console.error('[solar-audit] insert failed', { verb: a.verb, code: error.code })
  } catch (e) {
    console.error('[solar-audit] threw', { verb: a.verb, err: String(e) })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/solar/notify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/grantors.ts apps/web/src/lib/solar/notify.ts apps/web/src/lib/solar/notify.test.ts apps/web/src/lib/solar/audit.ts
git commit -m "feat(solar): grantor lookup, bell+email notifier, audit writer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Request actions (request access, ask an admin, withdraw, nav/subscription state)

**Files:**
- Create: `apps/web/src/actions/solar-requests.actions.ts`, `apps/web/src/actions/solar-requests.actions.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-requests.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadSolarEntry: vi.fn(),
  listSolarGrantors: vi.fn(),
  profileName: vi.fn(),
  notify: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/entry-loader', () => ({ loadSolarEntry: h.loadSolarEntry }))
vi.mock('@/lib/solar/grantors', () => ({ listSolarGrantors: h.listSolarGrantors, profileName: h.profileName }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  requestSolarAccessAction, askAdminToSubscribeAction, withdrawSolarRequestAction,
  getSolarNavStateAction, getSolarSubscriptionStateAction,
} from './solar-requests.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = 'p1'
const ORG = 'org-1'
const U = 'user-1'
const ctx = (state: unknown) => ({ projectId: P, projectName: 'Mall', organisationId: ORG, userId: U, state })

beforeEach(() => {
  vi.clearAllMocks()
  h.listSolarGrantors.mockResolvedValue([
    { userId: 'admin-1', fullName: 'Ann', email: 'ann@x.test' },
    { userId: U, fullName: 'Me', email: 'me@x.test' },
  ])
  h.profileName.mockResolvedValue('Bob')
})

describe('getSolarNavStateAction', () => {
  it('maps the resolved state to a badge, hidden when there is no context', async () => {
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'pending', requestedAt: 'x' }))
    await expect(getSolarNavStateAction(P)).resolves.toBe('pending')
    h.loadSolarEntry.mockResolvedValueOnce(null)
    await expect(getSolarNavStateAction(P)).resolves.toBe('hidden')
  })
})

describe('getSolarSubscriptionStateAction', () => {
  it('is active only once the caller resolves to granted', async () => {
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'subscribe' }))
    await expect(getSolarSubscriptionStateAction(P)).resolves.toEqual({ active: false })
    h.loadSolarEntry.mockResolvedValueOnce(ctx({ kind: 'granted', level: 'edit_financials' }))
    await expect(getSolarSubscriptionStateAction(P)).resolves.toEqual({ active: true })
  })
})

describe('requestSolarAccessAction', () => {
  it('refuses an unknown level before touching the database', async () => {
    await expect(requestSolarAccessAction({ projectId: P, level: 'owner' })).resolves.toEqual({ error: 'Choose the level you need.' })
    expect(h.createClient).not.toHaveBeenCalled()
  })

  it('refuses when a request is already pending (the page gate is not trusted)', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'pending', requestedAt: 'x' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'view' }))
      .resolves.toEqual({ error: 'You already have a request waiting for an answer.' })
    expect(callsTo(calls, 'solar.access_requests', 'insert')).toHaveLength(0)
  })

  it('inserts the request, notifies the grantors except the requester, and records the event', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'request_access', maxLevel: 'edit_financials' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'edit', note: '  need it  ' })).resolves.toEqual({ ok: true })
    expect(h.loadSolarEntry).toHaveBeenCalledWith(P, client)
    expect(callsTo(calls, 'solar.access_requests', 'insert')[0].payload).toMatchObject({
      project_id: P, requester_id: U, kind: 'access', requested_level: 'edit', note: 'need it',
    })
    expect(h.notify).toHaveBeenCalledWith(['admin-1'], ['ann@x.test'], expect.objectContaining({
      type: 'solar_access_requested',
      title: 'Bob asked for Solar access',
      body: 'Bob asked for Edit access to Solar on Mall. Note: "need it"',
      route: `/projects/${P}/solar/access`,
      email: true,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_access_requested', projectId: P, actorId: U }))
    expect(h.revalidate).toHaveBeenCalledWith(`/projects/${P}/solar/locked`)
  })

  it('lets a View user ask for Edit (the View-only banner)', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'view' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'edit' })).resolves.toEqual({ ok: true })
  })

  it('maps a duplicate pending request to a sentence', async () => {
    const { client } = fakeSupabase({
      userId: U,
      writes: { 'solar.access_requests:insert': { error: { code: '23505', message: 'duplicate key' } } },
    })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'request_access', maxLevel: 'view' }))
    await expect(requestSolarAccessAction({ projectId: P, level: 'view' }))
      .resolves.toEqual({ error: 'You already have a request waiting for an answer.' })
    expect(h.notify).not.toHaveBeenCalled()
  })
})

describe('askAdminToSubscribeAction', () => {
  it('refuses once already asked', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ error: 'You have already asked — the admins have been told.' })
  })

  it('refuses an owner/admin (they subscribe themselves)', async () => {
    const { client } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'subscribe' }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ error: 'There is nothing to request here.' })
  })

  it('records a subscribe request and tells the admins "<name> would like Solar for <project>"', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'ask_admin', requestedAt: null }))
    await expect(askAdminToSubscribeAction(P)).resolves.toEqual({ ok: true })
    expect(callsTo(calls, 'solar.access_requests', 'insert')[0].payload).toMatchObject({ kind: 'subscribe', requested_level: null })
    expect(h.notify).toHaveBeenCalledWith(['admin-1'], ['ann@x.test'], expect.objectContaining({
      type: 'solar_subscribe_requested', title: 'Bob would like Solar for Mall', email: true,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_subscribe_requested' }))
  })
})

describe('withdrawSolarRequestAction', () => {
  it('withdraws my pending access request', async () => {
    const { client, calls } = fakeSupabase({ userId: U })
    h.createClient.mockResolvedValue(client)
    await expect(withdrawSolarRequestAction(P)).resolves.toEqual({ ok: true })
    const upd = callsTo(calls, 'solar.access_requests', 'update')[0]
    expect(upd.payload).toEqual({ status: 'withdrawn' })
    expect(upd.filters).toEqual(expect.arrayContaining([
      ['eq', 'project_id', P], ['eq', 'requester_id', U], ['eq', 'kind', 'access'], ['eq', 'status', 'pending'],
    ]))
  })

  it('says so when nothing was waiting', async () => {
    const { client } = fakeSupabase({ userId: U, writes: { 'solar.access_requests:update': { data: [] } } })
    h.createClient.mockResolvedValue(client)
    await expect(withdrawSolarRequestAction(P)).resolves.toEqual({ error: 'There was no request waiting — reload the page.' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/solar-requests.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-requests.actions`.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-requests.actions.ts`:
```ts
'use server'
/**
 * Solar entry actions for NON-grantors (and the sidebar). Each re-resolves the
 * caller's state with loadSolarEntry — the locked page's rendering is never
 * trusted. 00208's access_requests_guard is the last word on eligibility
 * (it binds requester/org/status, clamps the level, and refuses externals'
 * subscribe requests); these actions only decide which button made sense.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, solarNavBadge, SOLAR_LEVEL_LABELS, type SolarNavBadge } from '@esite/shared'
import { loadSolarEntry } from '@/lib/solar/entry-loader'
import { listSolarGrantors, profileName } from '@/lib/solar/grantors'
import { notifySolarUsers, type SolarNotice } from '@/lib/solar/notify'
import { humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type SolarActionResult = { ok: true } | { error: string }

const NOTE_MAX = 500
const lockedPath = (projectId: string) => `/projects/${projectId}/solar/locked`

async function notifyGrantors(organisationId: string, actorId: string, n: SolarNotice): Promise<void> {
  const grantors = (await listSolarGrantors(organisationId)).filter((g) => g.userId !== actorId)
  await notifySolarUsers(
    grantors.map((g) => g.userId),
    grantors.map((g) => g.email).filter((e): e is string => Boolean(e)),
    n,
  )
}

/** Sidebar badge for the current project. Only ever describes the caller. */
export async function getSolarNavStateAction(projectId: string): Promise<SolarNavBadge> {
  const ctx = await loadSolarEntry(projectId)
  return ctx ? solarNavBadge(ctx.state) : 'hidden'
}

/** Polled after the Paystack return: true once the webhook has activated the org. */
export async function getSolarSubscriptionStateAction(projectId: string): Promise<{ active: boolean }> {
  const ctx = await loadSolarEntry(projectId)
  return { active: ctx?.state.kind === 'granted' }
}

export async function requestSolarAccessAction(input: {
  projectId: string
  level: string
  note?: string
}): Promise<SolarActionResult> {
  const level = input.level
  if (!isSolarAccessLevel(level)) return { error: 'Choose the level you need.' }
  const note = (input.note ?? '').trim()
  if (note.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} characters.` }

  const supabase = (await createClient()) as unknown as AnyClient
  const ctx = await loadSolarEntry(input.projectId, supabase)
  if (!ctx) return { error: 'Project not found.' }
  const s = ctx.state
  const mayAsk = s.kind === 'request_access' || (s.kind === 'granted' && s.level !== 'edit_financials')
  if (!mayAsk) {
    return { error: s.kind === 'pending' ? 'You already have a request waiting for an answer.' : 'There is nothing to request here.' }
  }

  const { error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'access',
    requested_level: level,
    note: note || null,
  })
  if (error) return { error: humanSolarError(error) }

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_access_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} asked for Solar access`,
    body: `${who} asked for ${SOLAR_LEVEL_LABELS[level]} access to Solar on ${ctx.projectName}.${note ? ` Note: "${note}"` : ''}`,
    route: `/projects/${ctx.projectId}/solar/access`,
    email: true,
  })
  await emitProductEvent({ actorId: ctx.userId, projectId: ctx.projectId, event: 'solar_access_requested', properties: { level } })
  revalidatePath(lockedPath(ctx.projectId))
  return { ok: true }
}

export async function askAdminToSubscribeAction(projectId: string): Promise<SolarActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const ctx = await loadSolarEntry(projectId, supabase)
  if (!ctx) return { error: 'Project not found.' }
  if (ctx.state.kind !== 'ask_admin') return { error: 'There is nothing to request here.' }
  // One open request per user per ORG (the DB index is per project).
  if (ctx.state.requestedAt) return { error: 'You have already asked — the admins have been told.' }

  const { error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'subscribe',
    requested_level: null,
    note: null,
  })
  if (error) return { error: humanSolarError(error) }

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_subscribe_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} would like Solar for ${ctx.projectName}`,
    body: `${who} would like Solar for ${ctx.projectName}. One subscription covers every project in your organisation.`,
    route: lockedPath(ctx.projectId),
    email: true,
  })
  await emitProductEvent({ actorId: ctx.userId, projectId: ctx.projectId, event: 'solar_subscribe_requested' })
  revalidatePath(lockedPath(ctx.projectId))
  return { ok: true }
}

export async function withdrawSolarRequestAction(projectId: string): Promise<SolarActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.schema('solar').from('access_requests')
    .update({ status: 'withdrawn' })
    .eq('project_id', projectId).eq('requester_id', user.id).eq('kind', 'access').eq('status', 'pending')
    .select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'There was no request waiting — reload the page.' }
  revalidatePath(lockedPath(projectId))
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/solar-requests.actions.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-requests.actions.ts apps/web/src/actions/solar-requests.actions.test.ts
git commit -m "feat(solar): request access / ask an admin / withdraw actions with grantor notifications

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sidebar entry with per-project/per-user badge

**Files:**
- Create: `apps/web/src/components/layout/SolarNavItem.tsx`, `apps/web/src/components/layout/SolarNavItem.test.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx:7-13` (imports), `:80-81` (nav list), `:154-176` (render)

Why this shape (least invasive): the admin layout (`apps/web/src/app/(admin)/layout.tsx:32-60`) computes lock flags once per **primary org** and never sees the project id; Solar's badge depends on the project **and** the user. A tiny client component that calls one server action per project id keeps the layout untouched and costs one request per project change.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/layout/SolarNavItem.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ navState: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({ getSolarNavStateAction: h.navState }))

import { SolarNavItem } from './SolarNavItem'

beforeEach(() => { h.navState.mockReset() })

describe('SolarNavItem', () => {
  it('renders nothing for suppliers / client viewers (hidden)', async () => {
    h.navState.mockResolvedValue('hidden')
    const { container } = render(<SolarNavItem projectId="p1" active={false} />)
    await waitFor(() => expect(h.navState).toHaveBeenCalledWith('p1'))
    expect(container.innerHTML).toBe('')
  })

  it('shows a lock badge when locked', async () => {
    h.navState.mockResolvedValue('locked')
    render(<SolarNavItem projectId="p1" active={false} />)
    expect(await screen.findByLabelText('Solar is locked')).toBeDefined()
    expect(screen.getByRole('link', { name: /Solar/ }).getAttribute('href')).toBe('/projects/p1/solar')
  })

  it('shows a clock badge while a request is pending', async () => {
    h.navState.mockResolvedValue('pending')
    render(<SolarNavItem projectId="p1" active={false} />)
    expect(await screen.findByLabelText('Solar access request pending')).toBeDefined()
  })

  it('shows no badge when granted', async () => {
    h.navState.mockResolvedValue('open')
    render(<SolarNavItem projectId="p1" active />)
    const link = await screen.findByRole('link', { name: 'Solar' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(screen.queryByLabelText('Solar is locked')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/layout/SolarNavItem.test.tsx`
Expected: FAIL — cannot resolve `./SolarNavItem`.

- [ ] **Step 3: Implement**

`apps/web/src/components/layout/SolarNavItem.tsx`:
```tsx
'use client'
/**
 * Sidebar "Solar" entry (spec §1.1). Visible to every project member except
 * suppliers and client viewers; badge per project AND user: lock (not
 * subscribed / no grant), clock (request pending), none (granted). Renders
 * nothing until the state is known so a supplier never sees it flash.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock, Lock, Sun } from 'lucide-react'
import type { SolarNavBadge } from '@esite/shared'
import { getSolarNavStateAction } from '@/actions/solar-requests.actions'

export function SolarNavItem({ projectId, active }: { projectId: string; active: boolean }) {
  const [badge, setBadge] = useState<SolarNavBadge | null>(null)

  useEffect(() => {
    let live = true
    setBadge(null)
    getSolarNavStateAction(projectId)
      .then((b) => { if (live) setBadge(b) })
      .catch(() => { if (live) setBadge('hidden') })
    return () => { live = false }
  }, [projectId])

  if (badge === null || badge === 'hidden') return null

  return (
    <Link
      href={`/projects/${projectId}/solar`}
      className={`sidebar-nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Sun className="sidebar-nav-icon" size={16} />
      Solar
      {badge === 'locked' && <Lock size={12} aria-label="Solar is locked" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
      {badge === 'pending' && <Clock size={12} aria-label="Solar access request pending" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
    </Link>
  )
}
```

Modify `apps/web/src/components/layout/Sidebar.tsx`:

(a) imports — add `Sun` to the lucide list and import the item:
```tsx
import {
  LayoutGrid, FolderOpen, AlertTriangle, BookOpen,
  MessageSquare, ShoppingBag,
  Settings, LogOut, Map, ClipboardCheck, ArrowLeft,
  Cable, BookMarked, HardHat, Package, Store, Lock, ScrollText, Zap,
  ShieldCheck, FileText, BarChart3, Sun,
} from 'lucide-react'
import { SolarNavItem } from './SolarNavItem'
```

(b) `projectNav` — insert after the Medium Voltage line (`Sidebar.tsx:80`):
```tsx
    { href: `/projects/${id}/medium-voltage`,      label: 'Medium Voltage',     Icon: Zap,           exact: false },
    { href: `/projects/${id}/solar`,               label: 'Solar',              Icon: Sun,           exact: false },
```

(c) render — inside the `.map(({ href, label, Icon, exact }) => {` body, after `const isMv = …` (`Sidebar.tsx:162`) and before `return (`:
```tsx
              if (basePath === `/projects/${projectId}/solar`) {
                return <SolarNavItem key={href} projectId={projectId} active={active} />
              }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/layout/`
Expected: PASS (SolarNavItem 4 tests, plus any existing Sidebar tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/SolarNavItem.tsx apps/web/src/components/layout/SolarNavItem.test.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(solar): sidebar Solar entry with per-project, per-user lock/clock badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Locked screen — components

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/_components/FeatureSummary.tsx`
- Create: `.../solar/_components/SubscribeButton.tsx`, `SubscribeButton.test.tsx`
- Create: `.../solar/_components/PaymentReturnPoller.tsx`, `PaymentReturnPoller.test.tsx`
- Create: `.../solar/_components/LockedScreen.tsx`, `LockedScreen.test.tsx`

(`...` = `apps/web/src/app/(admin)/projects/[id]`.)

- [ ] **Step 1: Write the failing tests**

`.../solar/_components/SubscribeButton.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ push: vi.fn(), assign: vi.fn(), fetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: h.push }) }))

import { SubscribeButton } from './SubscribeButton'

const originalLocation = window.location
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', h.fetch)
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: h.assign } })
})
afterAll(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('SubscribeButton', () => {
  it('POSTs the project to the 1B route and follows authorization_url', async () => {
    h.fetch.mockResolvedValue(json(200, { authorization_url: 'https://checkout.paystack.com/abc' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(h.fetch).toHaveBeenCalledWith('/api/paystack/solar-subscribe', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ projectId: 'p1' }),
    }))
    expect(h.assign).toHaveBeenCalledWith('https://checkout.paystack.com/abc')
  })

  it('403 (not owner/admin, or project not visible — one message) shows the route’s sentence', async () => {
    h.fetch.mockResolvedValue(json(403, { error: 'Only an organisation owner or admin can subscribe.' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an organisation owner or admin can subscribe.')
  })

  it('403 without a body falls back to a fixed sentence', async () => {
    h.fetch.mockResolvedValue(json(403, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an organisation owner or admin can subscribe.')
  })

  it('503 (plan not configured) → "Solar can’t be purchased yet — ask E-Site support"', async () => {
    h.fetch.mockResolvedValue(json(503, { error: 'Solar subscription plan not configured' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Solar can't be purchased yet — ask E-Site support")
  })

  it('429 → wait and try again', async () => {
    h.fetch.mockResolvedValue(json(429, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts — wait a minute and try again.')
  })

  it('409 already subscribed → straight to the Overview', async () => {
    h.fetch.mockResolvedValue(json(409, { error: 'Solar is already active for this organisation.' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/overview')
  })

  it('anything else → "Payment could not start — try again."', async () => {
    h.fetch.mockResolvedValue(json(500, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Payment could not start — try again.')
  })
})
```

`.../solar/_components/PaymentReturnPoller.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ push: vi.fn(), state: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('@/actions/solar-requests.actions', () => ({ getSolarSubscriptionStateAction: h.state }))

import { PaymentReturnPoller } from './PaymentReturnPoller'

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('PaymentReturnPoller', () => {
  it('polls until the webhook has activated Solar, then opens the Overview', async () => {
    h.state.mockResolvedValueOnce({ active: false }).mockResolvedValueOnce({ active: true })
    render(<PaymentReturnPoller projectId="p1" />)
    expect(screen.getByRole('status').textContent).toBe('Payment received — activating Solar…')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.push).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/overview')
  })

  it('after 30 s says Paystack has not confirmed yet', async () => {
    h.state.mockResolvedValue({ active: false })
    render(<PaymentReturnPoller projectId="p1" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(screen.getByRole('status').textContent)
      .toBe('We have not received confirmation from Paystack yet. This page will update when it arrives.')
  })
})
```

`.../solar/_components/LockedScreen.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  ask: vi.fn(async () => ({ ok: true })),
  request: vi.fn(async () => ({ ok: true })),
  withdraw: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-requests.actions', () => ({
  askAdminToSubscribeAction: h.ask,
  requestSolarAccessAction: h.request,
  withdrawSolarRequestAction: h.withdraw,
  getSolarSubscriptionStateAction: vi.fn(async () => ({ active: false })),
}))

import { LockedScreen, type LockedScreenProps } from './LockedScreen'

const PRICE = 'R1,999 per year excl. VAT for your whole organisation — every project'
const base: Omit<LockedScreenProps, 'state'> = {
  projectId: 'p1', projectName: 'Kings Mall', orgName: 'WM Org', priceLine: PRICE, grantorNames: [], paymentReturn: false,
}

beforeEach(() => { vi.clearAllMocks() })

describe('LockedScreen — the §0.2 rows', () => {
  it('row 1 (owner/admin, not subscribed): price + Subscribe, no request buttons', () => {
    render(<LockedScreen {...base} state={{ kind: 'subscribe' }} />)
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.getByText(PRICE)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask an admin to subscribe' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull()
  })

  it('row 2 (member, not subscribed): Ask an admin sends the request and refreshes', async () => {
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: null }} />)
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask an admin to subscribe' }))
    expect(h.ask).toHaveBeenCalledWith('p1')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('row 2, already asked: "Requested on <date>" and no button', () => {
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' }} />)
    expect(screen.getByText('Requested on 28 Sep 2026')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask an admin to subscribe' })).toBeNull()
  })

  it('row 3 (subscribed, no grant): Request access with level + note; externals see View only', async () => {
    const user = userEvent.setup()
    render(<LockedScreen {...base} state={{ kind: 'request_access', maxLevel: 'view' }} />)
    expect(screen.queryByText(PRICE)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Request access' }))
    const select = screen.getByLabelText('Level') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['View'])
    await user.type(screen.getByLabelText('Note (optional)'), 'Doing the PV design')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(h.request).toHaveBeenCalledWith({ projectId: 'p1', level: 'view', note: 'Doing the PV design' })
    expect(h.refresh).toHaveBeenCalled()
  })

  it('row 3, own-org member: all three levels offered', async () => {
    render(<LockedScreen {...base} state={{ kind: 'request_access', maxLevel: 'edit_financials' }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request access' }))
    const select = screen.getByLabelText('Level') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['View', 'Edit', 'Edit + financials'])
  })

  it('row 4 (pending): names the admins and the date, and offers Withdraw', async () => {
    render(<LockedScreen {...base} grantorNames={['Ann', 'Ben']} state={{ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' }} />)
    expect(screen.getByText('Request sent to Ann and Ben on 28 Sep 2026')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(h.withdraw).toHaveBeenCalledWith('p1')
  })

  it('shows an action error as a sentence', async () => {
    h.ask.mockResolvedValueOnce({ error: 'You have already asked — the admins have been told.' } as never)
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: null }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask an admin to subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You have already asked — the admins have been told.')
  })

  it('always shows the feature summary', () => {
    render(<LockedScreen {...base} state={{ kind: 'subscribe' }} />)
    expect(screen.getByText('What Solar does')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/_components"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`.../solar/_components/FeatureSummary.tsx`:
```tsx
import { Check } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

const FEATURES = [
  'Tariff library',
  'Meter-data load modelling',
  'Schematics',
  'PV layout on project drawings with 3D',
  'Yield & battery simulation',
  'Financial model (cash / debt / PPA / lease)',
  'Feasibility reports',
  'Client proposals with e-acceptance',
  'Schedule',
  'Operations',
]

export function FeatureSummary() {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">What Solar does</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {FEATURES.map((f) => (
            <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--c-text-mid)' }}>
              <Check size={14} style={{ color: 'var(--c-green)', marginTop: 2 }} aria-hidden="true" />
              {f}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
```

`.../solar/_components/SubscribeButton.tsx`:
```tsx
'use client'
/**
 * Start the org subscription (spec §1.2). The route belongs to Phase 1B:
 * POST /api/paystack/solar-subscribe {projectId}; the org is derived from the
 * PROJECT server-side. Responses (1B contract, 2026-09-28):
 *   200 {authorization_url}  → go to Paystack; it returns the user to
 *                              /projects/<id>/solar/locked?payment=received
 *   403  not owner/admin of the project's org, or project not visible (one message)
 *   409  already subscribed  → straight to the Overview
 *   429  rate limited
 *   503  plan not configured → "Solar can't be purchased yet — ask E-Site support"
 * Nothing is written until the webhook.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

const FALLBACK = 'Payment could not start — try again.'
const NOT_ADMIN = 'Only an organisation owner or admin can subscribe.'
const NOT_CONFIGURED = "Solar can't be purchased yet — ask E-Site support"
const RATE_LIMITED = 'Too many attempts — wait a minute and try again.'

export function SubscribeButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/solar-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const body = (await res.json().catch(() => ({}))) as { authorization_url?: unknown; error?: unknown }
      const said = typeof body.error === 'string' && body.error.trim() ? body.error : null
      if (res.ok && typeof body.authorization_url === 'string') {
        window.location.assign(body.authorization_url)
        return
      }
      if (res.status === 409) {
        router.push(`/projects/${projectId}/solar/overview`)
        return
      }
      if (res.status === 503) { setError(NOT_CONFIGURED); return }
      if (res.status === 403) { setError(said ?? NOT_ADMIN); return }
      if (res.status === 429) { setError(said ?? RATE_LIMITED); return }
      setError(FALLBACK)
    } catch {
      setError(FALLBACK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Button type="button" onClick={start} isLoading={busy}>Subscribe</Button>
      {error && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--c-red)' }}>{error}</p>}
    </div>
  )
}
```

`.../solar/_components/PaymentReturnPoller.tsx`:
```tsx
'use client'
/**
 * After Paystack returns the owner to /solar/locked?payment=received (1B's
 * callback), poll the server — the WEBHOOK is the only writer (spec §1.2
 * "Return handling"). getSolarSubscriptionStateAction is true only when the
 * org is subscribed AND the caller has a level (org_has_solar + level via
 * loadSolarEntry); then open the Overview. Every 3 s for 30 s, then every
 * 10 s with the "not yet" sentence, so the page still updates when it lands.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSolarSubscriptionStateAction } from '@/actions/solar-requests.actions'

const WAITING = 'Payment received — activating Solar…'
const SLOW = 'We have not received confirmation from Paystack yet. This page will update when it arrives.'

export function PaymentReturnPoller({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    let stopped = false
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stopped) return
      const { active } = await getSolarSubscriptionStateAction(projectId).catch(() => ({ active: false }))
      if (stopped) return
      if (active) {
        router.push(`/projects/${projectId}/solar/overview`)
        return
      }
      const late = Date.now() - started >= 30_000
      if (late) setSlow(true)
      timer = setTimeout(tick, late ? 10_000 : 3_000)
    }
    timer = setTimeout(tick, 0)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [projectId, router])

  return <p role="status" style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{slow ? SLOW : WAITING}</p>
}
```

`.../solar/_components/LockedScreen.tsx`:
```tsx
'use client'
/**
 * /solar/locked (spec §1.2): why Solar is locked and the ONE action that
 * unlocks it, per the §0.2 row the server resolved. Props are JSON only.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import {
  SOLAR_LEVEL_LABELS, formatSolarDate, joinNames, requestableLevels,
  type SolarAccessLevel, type SolarEntryState,
} from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  askAdminToSubscribeAction, requestSolarAccessAction, withdrawSolarRequestAction,
} from '@/actions/solar-requests.actions'
import { FeatureSummary } from './FeatureSummary'
import { SubscribeButton } from './SubscribeButton'
import { PaymentReturnPoller } from './PaymentReturnPoller'

export type LockedState = Exclude<SolarEntryState, { kind: 'hidden' } | { kind: 'granted' }>

export interface LockedScreenProps {
  projectId: string
  projectName: string
  orgName: string
  state: LockedState
  priceLine: string
  /** Owners/admins who will see a pending request ("Request sent to …"). */
  grantorNames: string[]
  /** Back from Paystack (?payment=received, set by 1B): poll instead of offering Subscribe. */
  paymentReturn: boolean
}

const H2: CSSProperties = { fontSize: 16, fontWeight: 600, color: 'var(--c-text)', margin: '0 0 8px' }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--c-text-mid)', margin: '0 0 12px' }
const ERR: CSSProperties = { marginTop: 8, fontSize: 12, color: 'var(--c-red)' }

export function LockedScreen(p: LockedScreenProps) {
  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} aria-hidden="true" />
            Solar
          </h1>
          <p className="page-subtitle">{p.projectName}</p>
        </div>
      </div>
      <Card><CardBody><LockedAction {...p} /></CardBody></Card>
      <div style={{ marginTop: 16 }}><FeatureSummary /></div>
    </div>
  )
}

function LockedAction(p: LockedScreenProps) {
  const s = p.state
  switch (s.kind) {
    case 'subscribe':
      return (
        <>
          <h2 style={H2}>Solar is not active for {p.orgName}</h2>
          <p style={MUTED}>{p.priceLine}</p>
          {p.paymentReturn ? <PaymentReturnPoller projectId={p.projectId} /> : <SubscribeButton projectId={p.projectId} />}
        </>
      )
    case 'ask_admin':
      return (
        <>
          <h2 style={H2}>Solar is not active for {p.orgName}</h2>
          <p style={MUTED}>{p.priceLine}</p>
          <AskAdmin projectId={p.projectId} requestedAt={s.requestedAt} />
        </>
      )
    case 'request_access':
      return (
        <>
          <h2 style={H2}>You do not have Solar access on {p.projectName}</h2>
          <RequestAccess projectId={p.projectId} maxLevel={s.maxLevel} />
        </>
      )
    case 'pending':
      return (
        <>
          <h2 style={H2}>Your request is waiting for an answer</h2>
          <Pending projectId={p.projectId} requestedAt={s.requestedAt} names={p.grantorNames} />
        </>
      )
  }
}

function AskAdmin({ projectId, requestedAt }: { projectId: string; requestedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (requestedAt) return <p style={MUTED}>Requested on {formatSolarDate(requestedAt)}</p>

  async function ask() {
    setBusy(true)
    setError(null)
    const res = await askAdminToSubscribeAction(projectId)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div>
      <Button type="button" onClick={ask} isLoading={busy}>Ask an admin to subscribe</Button>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}

function RequestAccess({ projectId, maxLevel }: { projectId: string; maxLevel: SolarAccessLevel }) {
  const router = useRouter()
  const levels = requestableLevels(maxLevel)
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<SolarAccessLevel>(levels[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return <Button type="button" onClick={() => setOpen(true)}>Request access</Button>

  async function send() {
    setBusy(true)
    setError(null)
    const res = await requestSolarAccessAction({ projectId, level, note })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      <label style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
        Level
        <select
          aria-label="Level"
          value={level}
          onChange={(e) => setLevel(e.target.value as SolarAccessLevel)}
          style={{ display: 'block', marginTop: 4, width: '100%' }}
        >
          {levels.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
        Note (optional)
        <textarea
          aria-label="Note (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ display: 'block', marginTop: 4, width: '100%' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" onClick={send} isLoading={busy}>Send request</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}

function Pending({ projectId, requestedAt, names }: { projectId: string; requestedAt: string; names: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const to = names.length ? joinNames(names) : 'the organisation admins'

  async function withdraw() {
    setBusy(true)
    setError(null)
    const res = await withdrawSolarRequestAction(projectId)
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    router.refresh()
  }
  return (
    <div>
      <p style={MUTED}>{`Request sent to ${to} on ${formatSolarDate(requestedAt)}`}</p>
      <Button type="button" variant="secondary" onClick={withdraw} isLoading={busy}>Withdraw request</Button>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/_components"`
Expected: PASS (SubscribeButton 7, PaymentReturnPoller 2, LockedScreen 8).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/_components"
git commit -m "feat(solar): locked screen — subscribe, ask an admin, request access, pending/withdraw, payment return

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `/solar` redirect and `/solar/locked` page

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/locked/page.tsx`, `locked/page.test.tsx`

- [ ] **Step 1: Write the failing test**

`.../solar/locked/page.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`) }),
  loadSolarEntry: vi.fn(),
  listSolarGrantors: vi.fn(async () => [{ userId: 'a', fullName: 'Ann', email: null }]),
  createClient: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (p: string) => h.redirect(p),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/solar/entry-loader', () => ({ loadSolarEntry: h.loadSolarEntry }))
vi.mock('@/lib/solar/grantors', async (orig) => ({
  ...(await orig<typeof import('@/lib/solar/grantors')>()),
  listSolarGrantors: h.listSolarGrantors,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({
  askAdminToSubscribeAction: vi.fn(), requestSolarAccessAction: vi.fn(), withdrawSolarRequestAction: vi.fn(),
  getSolarSubscriptionStateAction: vi.fn(async () => ({ active: false })),
}))

import SolarLockedPage from './page'
import { fakeSupabase } from '@/test/fake-supabase'

const ctx = (state: unknown) => ({ projectId: 'p1', projectName: 'Kings Mall', organisationId: 'org-1', userId: 'u1', state })
const args = (payment?: string) => ({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve(payment ? { payment } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'public.organisations': [{ id: 'org-1', name: 'WM Org' }] } }).client)
})

describe('/solar/locked page', () => {
  it('row 5 (granted) never sees the locked screen — straight to the Overview', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'view' }))
    await expect(SolarLockedPage(args())).rejects.toThrow('REDIRECT:/projects/p1/solar/overview')
  })

  it('suppliers and client viewers go back to the project', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'hidden' }))
    await expect(SolarLockedPage(args())).rejects.toThrow('REDIRECT:/projects/p1')
  })

  it('a pending requester sees the admins’ names', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' }))
    render(await SolarLockedPage(args()))
    expect(screen.getByText('Request sent to Ann on 28 Sep 2026')).toBeDefined()
  })

  it('an owner back from Paystack sees the activation poller', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'subscribe' }))
    render(await SolarLockedPage(args('received')))
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Payment received — activating Solar…')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/locked"`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Implement**

`.../solar/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { getSolarAccessLevel } from '@/lib/solar/access'

export const dynamic = 'force-dynamic'

/** Sidebar target: into the module when the caller has a level, else the locked screen. */
export default async function SolarIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const level = await getSolarAccessLevel(id)
  redirect(level ? `/projects/${id}/solar/overview` : `/projects/${id}/solar/locked`)
}
```

`.../solar/locked/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadSolarEntry } from '@/lib/solar/entry-loader'
import { grantorDisplayNames, listSolarGrantors } from '@/lib/solar/grantors'
import { solarPriceLine } from '@/lib/solar/price'
import { LockedScreen } from '../_components/LockedScreen'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar' }

/**
 * Lives OUTSIDE solar/(gated) so the gate's redirect here can never loop
 * (the jbcc/unlock pattern, apps/web/src/app/(admin)/projects/[id]/jbcc/unlock/page.tsx).
 */
export default async function SolarLockedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ payment?: string }>
}) {
  const { id } = await params
  const { payment } = await searchParams
  const ctx = await loadSolarEntry(id)
  if (!ctx) redirect('/dashboard')
  const state = ctx.state
  if (state.kind === 'hidden') redirect(`/projects/${id}`)
  if (state.kind === 'granted') redirect(`/projects/${id}/solar/overview`)

  const supabase = await createClient()
  const { data: org } = await supabase.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle()
  const orgName = (org as { name?: string } | null)?.name ?? 'your organisation'
  const grantorNames = state.kind === 'pending'
    ? grantorDisplayNames(await listSolarGrantors(ctx.organisationId))
    : []

  return (
    <LockedScreen
      projectId={id}
      projectName={ctx.projectName}
      orgName={orgName}
      state={state}
      priceLine={solarPriceLine()}
      grantorNames={grantorNames}
      paymentReturn={payment === 'received'}
    />
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/locked"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/page.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/locked"
git commit -m "feat(solar): /solar redirect and /solar/locked page outside the gated group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Gated layout, tab bar with status dots, View-only banner, readiness checklist

**Files:**
- Create: `.../solar/_components/StatusDot.tsx`
- Create: `.../solar/_components/SolarTabBar.tsx`, `SolarTabBar.test.tsx`
- Create: `.../solar/_components/ViewOnlyBanner.tsx`, `ViewOnlyBanner.test.tsx`
- Create: `.../solar/_components/ReadinessChecklist.tsx`, `ReadinessChecklist.test.tsx`
- Create: `.../solar/(gated)/layout.tsx`
- Create: `.../solar/(gated)/overview/page.tsx`

- [ ] **Step 1: Write the failing tests**

`.../solar/_components/SolarTabBar.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeSolarReadiness } from '@esite/shared'

const h = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/p1/solar/overview',
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
}))

import { SolarTabBar } from './SolarTabBar'
import { setSolarDirty } from '@/lib/solar/dirty-store'

const site = { latitude: -26, longitude: 28, licenseeName: null, nmdKva: 400 }

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { setSolarDirty(false) })

describe('SolarTabBar', () => {
  it('links built tabs, disables the rest with "Coming in a later phase"', () => {
    render(<SolarTabBar projectId="p1" level="view" readiness={computeSolarReadiness(site, 'view')} />)
    expect(screen.getByRole('link', { name: /Overview/ }).getAttribute('href')).toBe('/projects/p1/solar/overview')
    expect(screen.getByRole('link', { name: /Site & Supply/ }).getAttribute('href')).toBe('/projects/p1/solar/site')
    const load = screen.getByText('Load').closest('[aria-disabled="true"]') as HTMLElement
    expect(load.getAttribute('title')).toBe('Coming in a later phase')
    expect(screen.queryByRole('link', { name: /Load/ })).toBeNull()
  })

  it('hides Tariff and Financials below Edit + financials, shows them at it; never Operations', () => {
    const { rerender } = render(<SolarTabBar projectId="p1" level="edit" readiness={[]} />)
    expect(screen.queryByText('Tariff')).toBeNull()
    expect(screen.queryByText('Financials')).toBeNull()
    rerender(<SolarTabBar projectId="p1" level="edit_financials" readiness={[]} />)
    expect(screen.getByText('Tariff')).toBeDefined()
    expect(screen.getByText('Financials')).toBeDefined()
    expect(screen.queryByText('Operations')).toBeNull()
  })

  it('puts the rule outcome on the Site & Supply dot', () => {
    render(<SolarTabBar projectId="p1" level="view" readiness={computeSolarReadiness(site, 'view')} />)
    expect(screen.getByLabelText('Incomplete: Missing: supply authority')).toBeDefined()
  })

  it('with unsaved changes, asks "Discard unsaved changes?" inline before leaving', async () => {
    const user = userEvent.setup()
    setSolarDirty(true)
    render(<SolarTabBar projectId="p1" level="view" readiness={[]} />)
    await user.click(screen.getByRole('link', { name: /Site & Supply/ }))
    expect(screen.getByText('Discard unsaved changes?')).toBeDefined()
    expect(h.push).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/site')
  })

  it('Stay keeps the user on the page', async () => {
    const user = userEvent.setup()
    setSolarDirty(true)
    render(<SolarTabBar projectId="p1" level="view" readiness={[]} />)
    await user.click(screen.getByRole('link', { name: /Site & Supply/ }))
    await user.click(screen.getByRole('button', { name: 'Stay' }))
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull()
    expect(h.push).not.toHaveBeenCalled()
  })
})
```

`.../solar/_components/ViewOnlyBanner.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({ requestSolarAccessAction: h.request }))

import { ViewOnlyBanner } from './ViewOnlyBanner'

beforeEach(() => { h.request.mockReset() })

describe('ViewOnlyBanner', () => {
  it('explains the level and requests Edit', async () => {
    h.request.mockResolvedValue({ ok: true })
    render(<ViewOnlyBanner projectId="p1" />)
    expect(screen.getByText('You have view access — ask an admin for edit access')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request edit access' }))
    expect(h.request).toHaveBeenCalledWith({ projectId: 'p1', level: 'edit' })
    expect(await screen.findByText('Request sent — the organisation admins have been told.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Request edit access' })).toBeNull()
  })

  it('shows the action’s sentence on failure', async () => {
    h.request.mockResolvedValue({ error: 'You already have a request waiting for an answer.' })
    render(<ViewOnlyBanner projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request edit access' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You already have a request waiting for an answer.')
  })
})
```

`.../solar/_components/ReadinessChecklist.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { computeSolarReadiness } from '@esite/shared'
import { ReadinessChecklist } from './ReadinessChecklist'

describe('ReadinessChecklist', () => {
  it('links live steps to their tab and greys out later phases', () => {
    render(<ReadinessChecklist projectId="p1" steps={computeSolarReadiness(null, 'edit')} />)
    expect(screen.getByRole('link', { name: 'Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByRole('link', { name: 'Load' })).toBeNull()
    expect(screen.getAllByText('Not started — available in a later phase').length).toBe(6)
    expect(screen.getByText('Not started')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/_components"`
Expected: the three new files FAIL (modules not found); Task 10's tests still pass.

- [ ] **Step 3: Implement**

`.../solar/_components/StatusDot.tsx`:
```tsx
import type { ReadinessStatus } from '@esite/shared'

const COLOURS: Record<ReadinessStatus, string> = {
  grey: 'var(--c-text-dim)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  red: 'var(--c-red)',
}
const WORDS: Record<ReadinessStatus, string> = {
  grey: 'Not started',
  amber: 'Incomplete',
  green: 'Complete',
  red: 'Blocking',
}

/** Readiness dot (spec §0.3): tooltip = the exact rule outcome. */
export function StatusDot({ status, reason }: { status: ReadinessStatus; reason: string }) {
  return (
    <span
      role="img"
      aria-label={`${WORDS[status]}: ${reason}`}
      title={reason}
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLOURS[status], marginRight: 6, flexShrink: 0 }}
    />
  )
}
```

`.../solar/_components/SolarTabBar.tsx`:
```tsx
'use client'
/**
 * Solar tab bar (spec §0.3). Built tabs are links; unbuilt tabs render
 * disabled with "Coming in a later phase" — their routes do not exist.
 * Tariff + Financials only at Edit + financials; Operations hidden (D-12).
 * No auto-save on tab change: with unsaved changes, an inline
 * "Discard unsaved changes?" replaces navigation (never window.confirm).
 */
import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { visibleSolarTabs, type ReadinessStep, type SolarAccessLevel } from '@esite/shared'
import { isSolarDirty, setSolarDirty } from '@/lib/solar/dirty-store'
import { StatusDot } from './StatusDot'

const TAB: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '8px 12px', fontSize: 13,
  color: 'var(--c-text-mid)', textDecoration: 'none', borderBottom: '2px solid transparent',
}
const ACTIVE: CSSProperties = { color: 'var(--c-text)', borderBottomColor: 'var(--c-amber)' }

export function SolarTabBar({
  projectId,
  level,
  readiness,
}: {
  projectId: string
  level: SolarAccessLevel
  readiness: ReadinessStep[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const bySlug = new Map<string, ReadinessStep>(readiness.map((s) => [s.slug, s]))

  return (
    <div>
      <nav aria-label="Solar steps" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
        {visibleSolarTabs(level).map((tab) => {
          const href = `/projects/${projectId}/solar/${tab.slug}`
          const active = pathname === href || pathname.startsWith(href + '/')
          const step = bySlug.get(tab.slug)
          const dot = step ? <StatusDot status={step.status} reason={step.reason} /> : null
          if (!tab.built) {
            return (
              <span key={tab.slug} aria-disabled="true" title="Coming in a later phase" style={{ ...TAB, opacity: 0.55, cursor: 'not-allowed' }}>
                {dot}{tab.label}
              </span>
            )
          }
          return (
            <Link
              key={tab.slug}
              href={href}
              aria-current={active ? 'page' : undefined}
              style={{ ...TAB, ...(active ? ACTIVE : {}) }}
              onClick={(e) => {
                if (!active && isSolarDirty()) {
                  e.preventDefault()
                  setPendingHref(href)
                }
              }}
            >
              {dot}{tab.label}
            </Link>
          )
        })}
      </nav>
      {pendingHref && (
        <div
          role="alertdialog"
          aria-label="Discard unsaved changes?"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', border: '1px solid var(--c-amber-mid)', background: 'var(--c-amber-dim)', borderRadius: 6, fontSize: 13 }}
        >
          <span>Discard unsaved changes?</span>
          <button
            type="button"
            onClick={() => {
              const target = pendingHref
              setSolarDirty(false)
              setPendingHref(null)
              router.push(target)
            }}
          >
            Discard
          </button>
          <button type="button" onClick={() => setPendingHref(null)}>Stay</button>
        </div>
      )}
    </div>
  )
}
```

`.../solar/_components/ViewOnlyBanner.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { requestSolarAccessAction } from '@/actions/solar-requests.actions'

/** Spec §0.3: shown to View-level users only. */
export function ViewOnlyBanner({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask() {
    setBusy(true)
    setError(null)
    const res = await requestSolarAccessAction({ projectId, level: 'edit' })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setSent(true)
  }

  return (
    <div
      role="note"
      style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', margin: '0 0 12px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)', fontSize: 13, color: 'var(--c-text-mid)' }}
    >
      <span>You have view access — ask an admin for edit access</span>
      {sent
        ? <span>Request sent — the organisation admins have been told.</span>
        : <Button type="button" size="sm" variant="secondary" onClick={ask} isLoading={busy}>Request edit access</Button>}
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
```

`.../solar/_components/ReadinessChecklist.tsx`:
```tsx
import Link from 'next/link'
import type { ReadinessStep } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatusDot } from './StatusDot'

/** Overview checklist (spec §2.2): one row per step, same rules as the tab dots. */
export function ReadinessChecklist({ projectId, steps }: { projectId: string; steps: ReadinessStep[] }) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Readiness</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((s) => (
            <li key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--c-border)', fontSize: 13 }}>
              <StatusDot status={s.status} reason={s.reason} />
              {s.live
                ? <Link href={`/projects/${projectId}/solar/${s.slug}`}>{s.label}</Link>
                : <span style={{ color: 'var(--c-text-dim)' }}>{s.label}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-dim)' }}>{s.reason}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
```

`.../solar/(gated)/layout.tsx`:
```tsx
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { computeSolarReadiness, toSiteReadinessInput } from '@esite/shared'
import { SolarTabBar } from '../_components/SolarTabBar'
import { ViewOnlyBanner } from '../_components/ViewOnlyBanner'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Gate for every Solar module page (spec §0.3). Anyone without a level —
 * unsubscribed org, no grant, supplier, client viewer, non-member — is sent to
 * /solar/locked, which lives OUTSIDE this group (no loop) and itself sends
 * suppliers/client viewers back to the project. Each page and action
 * re-checks its own level; this gate is not the only one.
 */
export default async function SolarGatedLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const level = await requireSolarLevel(id, 'view', supabase)
  const [{ data: project }, { data: study }] = await Promise.all([
    supabase.schema('projects').from('projects').select('name').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle(),
  ])
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level)

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar</h1>
          <p className="page-subtitle">{(project as { name?: string } | null)?.name ?? ''}</p>
        </div>
      </div>
      {level === 'view' && <ViewOnlyBanner projectId={id} />}
      <SolarTabBar projectId={id} level={level} readiness={readiness} />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
```

`.../solar/(gated)/overview/page.tsx` (plan 1C-ii replaces this file with the full Overview):
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { computeSolarReadiness, toSiteReadinessInput } from '@esite/shared'
import { ReadinessChecklist } from '../../_components/ReadinessChecklist'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export default async function SolarOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const { data: study } = await supabase
    .schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle()
  return <ReadinessChecklist projectId={id} steps={computeSolarReadiness(toSiteReadinessInput(study), level)} />
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar"`
Expected: PASS (all solar route tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar"
git commit -m "feat(solar): gated layout — tab bar with readiness dots, view-only banner, readiness checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Grantor actions (set level, decide request, copy access)

**Files:**
- Create: `apps/web/src/actions/solar-access.actions.ts`, `apps/web/src/actions/solar-access.actions.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-access.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  notify: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  setSolarMemberLevelAction, decideSolarRequestAction, copySolarAccessFromProjectAction,
} from './solar-access.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = 'p1'
const P2 = 'p2'
const PX = 'p-foreign'
const ADMIN = 'admin-1'
const STALE = 'Someone else changed this — reload to see their version.'

function setup(extra: Partial<FakeOptions> = {}, grantorOn: string[] = [P, P2]) {
  const fake = fakeSupabase({
    userId: ADMIN,
    rpc: { solar_is_grantor: (args) => ({ data: grantorOn.includes(args.p_project_id as string), error: null }) },
    ...extra,
    tables: {
      'projects.projects': [
        { id: P, name: 'Kings Mall', organisation_id: 'org-1' },
        { id: P2, name: 'Other Mall', organisation_id: 'org-1' },
        { id: PX, name: 'Foreign', organisation_id: 'org-2' },
      ],
      ...(extra.tables ?? {}),
    },
  })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => { vi.clearAllMocks() })

describe('setSolarMemberLevelAction', () => {
  it('refuses a non-grantor before any write', async () => {
    const { calls } = setup({}, [])
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'view', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can manage Solar access.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('grants (insert) when the member has no grant yet, notifies them and audits', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'edit', expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.project_access', 'insert')[0].payload).toEqual({ project_id: P, user_id: 'u2', level: 'edit' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: ADMIN, verb: 'access_granted', objectRef: { user_id: 'u2', level: 'edit' } })
    expect(h.notify).toHaveBeenCalledWith(['u2'], [], expect.objectContaining({
      type: 'solar_access_changed', body: 'You now have Edit access to Solar on Kings Mall.', email: false,
    }))
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ event: 'solar_access_changed', projectId: P }))
  })

  it('a concurrent grant (unique violation) is reported as stale', async () => {
    setup({ writes: { 'solar.project_access:insert': { error: { code: '23505', message: 'duplicate' } } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'view', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: STALE })
  })

  it('changes a level only if nobody changed it since the page loaded', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:update': { data: [] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: 'edit', expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.project_access', 'update')[0].filters).toEqual(expect.arrayContaining([['eq', 'updated_at', 'T0']]))
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('removes access with the same stale guard', async () => {
    const { calls } = setup({ writes: { 'solar.project_access:delete': { data: [{ user_id: 'u2' }] } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'u2', level: null, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ ok: true, updatedAt: null })
    expect(callsTo(calls, 'solar.project_access', 'delete')[0].filters).toEqual(expect.arrayContaining([['eq', 'updated_at', 'T0']]))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'access_removed' }))
  })

  it('maps the bind trigger’s "exceeds maximum" to a sentence', async () => {
    setup({ writes: { 'solar.project_access:insert': { error: { code: '23514', message: "solar.project_access: level edit exceeds this user's maximum (view)" } } } })
    await expect(setSolarMemberLevelAction({ projectId: P, userId: 'ext', level: 'edit', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'That level is higher than this person can hold. Members from outside the organisation can have View only.' })
  })
})

describe('decideSolarRequestAction', () => {
  const pending = { id: 'r1', project_id: P, requester_id: 'u3', kind: 'access', status: 'pending' }

  it('approves with the chosen level, conditioned on the request still being pending', async () => {
    const { calls } = setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve', level: 'view' })).resolves.toEqual({ ok: true })
    const upd = callsTo(calls, 'solar.access_requests', 'update')[0]
    expect(upd.payload).toEqual({ status: 'approved', approved_level: 'view' })
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'pending']]))
    expect(h.notify).toHaveBeenCalledWith(['u3'], [], expect.objectContaining({
      type: 'solar_access_changed', title: 'Your Solar access request was approved',
    }))
  })

  it('declines with an optional reason carried to the requester and the audit trail', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'decline', reason: ' Not on this job ' })).resolves.toEqual({ ok: true })
    expect(h.notify).toHaveBeenCalledWith(['u3'], [], expect.objectContaining({
      type: 'solar_access_declined',
      body: 'Your request for Solar access on Kings Mall was declined. Reason: Not on this job',
    }))
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'access_request_declined', objectRef: expect.objectContaining({ reason: 'Not on this job' }),
    }))
  })

  it('says "already answered" when someone else decided first', async () => {
    setup({ tables: { 'solar.access_requests': [pending] }, writes: { 'solar.access_requests:update': { data: [] } } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve', level: 'view' }))
      .resolves.toEqual({ error: 'This request has already been answered — reload to see it.' })
  })

  it('needs a level to approve an access request', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } })
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'approve' }))
      .resolves.toEqual({ error: 'Choose the level to approve.' })
  })

  it('refuses a non-grantor', async () => {
    setup({ tables: { 'solar.access_requests': [pending] } }, [])
    await expect(decideSolarRequestAction({ requestId: 'r1', decision: 'decline' }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can manage Solar access.' })
  })
})

describe('copySolarAccessFromProjectAction', () => {
  it('refuses a source project in another organisation', async () => {
    setup({}, [P, PX])
    await expect(copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: PX }))
      .resolves.toEqual({ error: 'Copy only works between projects of the same organisation.' })
  })

  it('inserts missing grants, updates different ones, skips equal ones, counts refusals', async () => {
    const { calls } = setup({
      tables: {
        'solar.project_access': [
          { project_id: P2, user_id: 'a', level: 'view' },   // not on target → insert (refused below)
          { project_id: P2, user_id: 'b', level: 'edit' },   // target has view → update
          { project_id: P2, user_id: 'c', level: 'view' },   // target has view → unchanged
          { project_id: P, user_id: 'b', level: 'view' },
          { project_id: P, user_id: 'c', level: 'view' },
        ],
      },
      writes: { 'solar.project_access:insert': { error: { code: '23514', message: 'not an eligible member' } } },
    })
    await expect(copySolarAccessFromProjectAction({ projectId: P, sourceProjectId: P2 }))
      .resolves.toEqual({ ok: true, copied: 1, skipped: 1 })
    expect(callsTo(calls, 'solar.project_access', 'update')[0]).toMatchObject({
      payload: { level: 'edit' }, filters: expect.arrayContaining([['eq', 'project_id', P], ['eq', 'user_id', 'b']]),
    })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'access_copied', objectRef: { source_project_id: P2, copied: 1, skipped: 1 } }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/solar-access.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-access.actions`.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-access.actions.ts`:
```ts
'use server'
/**
 * Grantor actions for the Solar Access panel (spec §1.3). Each re-checks
 * public.solar_is_grantor (org owner/admin of the project's org) — never the
 * page gate. The database remains the last word: 00208's project_access RLS
 * (grantor-only writes), project_access_bind (eligibility + per-user maximum:
 * externals cap at View, clients/suppliers refused) and access_requests_guard
 * (approval writes the grant). Every write is conditioned on what the grantor
 * saw (updated_at / status = 'pending') so a concurrent change is refused.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, SOLAR_LEVEL_LABELS } from '@esite/shared'
import { notifySolarUsers } from '@/lib/solar/notify'
import { recordSolarAudit } from '@/lib/solar/audit'
import { ALREADY_ANSWERED, STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SolarAccessActionResult = { ok: true } | { error: string }
export type SetLevelResult = { ok: true; updatedAt: string | null } | { error: string }
export type CopyAccessResult = { ok: true; copied: number; skipped: number } | { error: string }

const NOT_GRANTOR = 'Only an organisation owner or admin can manage Solar access.'
const accessPath = (projectId: string) => `/projects/${projectId}/solar/access`

async function grantorCheck(supabase: AnyClient, projectId: string): Promise<{ userId: string } | { error: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.rpc('solar_is_grantor', { p_project_id: projectId })
  if (error || data !== true) return { error: NOT_GRANTOR }
  return { userId: user.id }
}

async function projectName(supabase: AnyClient, projectId: string): Promise<string> {
  const { data } = await supabase.schema('projects').from('projects').select('name').eq('id', projectId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? 'this project'
}

export async function setSolarMemberLevelAction(input: {
  projectId: string
  userId: string
  level: string | null
  expectedUpdatedAt: string | null
}): Promise<SetLevelResult> {
  const { projectId, userId, expectedUpdatedAt } = input
  const level = input.level
  if (level !== null && !isSolarAccessLevel(level)) return { error: 'Choose a level.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await grantorCheck(supabase, projectId)
  if ('error' in gate) return gate

  const table = () => supabase.schema('solar').from('project_access')
  let updatedAt: string | null = null
  let verb: 'access_granted' | 'access_changed' | 'access_removed'

  if (level === null) {
    if (!expectedUpdatedAt) return { error: 'This member has no Solar access to remove.' }
    const { data, error } = await table().delete()
      .eq('project_id', projectId).eq('user_id', userId).eq('updated_at', expectedUpdatedAt)
      .select('user_id')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    verb = 'access_removed'
  } else if (!expectedUpdatedAt) {
    // organisation_id, granted_by and granted_at are bound by project_access_bind.
    const { data, error } = await table().insert({ project_id: projectId, user_id: userId, level }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = (Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined) ?? null
    verb = 'access_granted'
  } else {
    const { data, error } = await table().update({ level })
      .eq('project_id', projectId).eq('user_id', userId).eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = (data[0]?.updated_at as string | undefined) ?? null
    verb = 'access_changed'
  }

  const name = await projectName(supabase, projectId)
  await recordSolarAudit({ projectId, actorId: gate.userId, verb, objectRef: { user_id: userId, level } })
  await notifySolarUsers([userId], [], {
    type: 'solar_access_changed',
    projectId,
    projectName: name,
    title: level ? 'Your Solar access changed' : 'Your Solar access was removed',
    body: level
      ? `You now have ${SOLAR_LEVEL_LABELS[level]} access to Solar on ${name}.`
      : `Your Solar access on ${name} was removed.`,
    route: `/projects/${projectId}/solar`,
    email: false,
  })
  await emitProductEvent({ actorId: gate.userId, projectId, event: 'solar_access_changed', properties: { level, via: 'panel' } })
  revalidatePath(accessPath(projectId))
  return { ok: true, updatedAt }
}

export async function decideSolarRequestAction(input: {
  requestId: string
  decision: 'approve' | 'decline'
  level?: string
  reason?: string
}): Promise<SolarAccessActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: req } = await supabase.schema('solar').from('access_requests')
    .select('id, project_id, requester_id, kind, status')
    .eq('id', input.requestId)
    .maybeSingle()
  if (!req) return { error: 'Request not found.' }
  const r = req as { id: string; project_id: string; requester_id: string; kind: string; status: string }

  const gate = await grantorCheck(supabase, r.project_id)
  if ('error' in gate) return gate
  if (r.status !== 'pending') return { error: ALREADY_ANSWERED }

  const approve = input.decision === 'approve'
  const level = input.level
  const approvedLevel = approve && r.kind === 'access' && isSolarAccessLevel(level) ? level : null
  if (approve && r.kind === 'access' && !approvedLevel) return { error: 'Choose the level to approve.' }
  const reason = (input.reason ?? '').trim().slice(0, 500)

  const { data, error } = await supabase.schema('solar').from('access_requests')
    .update({ status: approve ? 'approved' : 'declined', approved_level: approvedLevel })
    .eq('id', r.id).eq('status', 'pending')
    .select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: ALREADY_ANSWERED }

  const name = await projectName(supabase, r.project_id)
  await recordSolarAudit({
    projectId: r.project_id,
    actorId: gate.userId,
    verb: approve ? 'access_request_approved' : 'access_request_declined',
    objectRef: { request_id: r.id, user_id: r.requester_id, level: approvedLevel, ...(!approve && reason ? { reason } : {}) },
  })
  await notifySolarUsers([r.requester_id], [], approve
    ? {
        type: 'solar_access_changed',
        projectId: r.project_id,
        projectName: name,
        title: 'Your Solar access request was approved',
        body: approvedLevel
          ? `You now have ${SOLAR_LEVEL_LABELS[approvedLevel]} access to Solar on ${name}.`
          : `Your Solar request on ${name} was approved.`,
        route: `/projects/${r.project_id}/solar`,
        email: false,
      }
    : {
        type: 'solar_access_declined',
        projectId: r.project_id,
        projectName: name,
        title: 'Your Solar access request was declined',
        body: `Your request for Solar access on ${name} was declined.${reason ? ` Reason: ${reason}` : ''}`,
        route: `/projects/${r.project_id}/solar`,
        email: false,
      })
  if (approvedLevel) {
    await emitProductEvent({ actorId: gate.userId, projectId: r.project_id, event: 'solar_access_changed', properties: { level: approvedLevel, via: 'request' } })
  }
  revalidatePath(accessPath(r.project_id))
  return { ok: true }
}

export async function copySolarAccessFromProjectAction(input: {
  projectId: string
  sourceProjectId: string
}): Promise<CopyAccessResult> {
  const { projectId, sourceProjectId } = input
  if (projectId === sourceProjectId) return { error: 'Choose a different project to copy from.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await grantorCheck(supabase, projectId)
  if ('error' in gate) return gate
  const { data: projects } = await supabase.schema('projects').from('projects')
    .select('id, organisation_id').in('id', [projectId, sourceProjectId])
  const rows = (projects ?? []) as Array<{ id: string; organisation_id: string }>
  if (rows.length !== 2 || new Set(rows.map((p) => p.organisation_id)).size !== 1) {
    return { error: 'Copy only works between projects of the same organisation.' }
  }
  const sourceGate = await grantorCheck(supabase, sourceProjectId)
  if ('error' in sourceGate) return sourceGate

  const pa = () => supabase.schema('solar').from('project_access')
  const [{ data: source }, { data: target }] = await Promise.all([
    pa().select('user_id, level').eq('project_id', sourceProjectId),
    pa().select('user_id, level').eq('project_id', projectId),
  ])
  const current = new Map(((target ?? []) as Array<{ user_id: string; level: string }>).map((g) => [g.user_id, g.level]))

  let copied = 0
  let skipped = 0
  for (const g of (source ?? []) as Array<{ user_id: string; level: string }>) {
    const have = current.get(g.user_id)
    if (have === g.level) continue
    // A member not on this project (or not eligible here) is refused by
    // project_access_bind — counted as skipped, never an error for the batch.
    const { error } = have === undefined
      ? await pa().insert({ project_id: projectId, user_id: g.user_id, level: g.level })
      : await pa().update({ level: g.level }).eq('project_id', projectId).eq('user_id', g.user_id)
    if (error) skipped += 1
    else copied += 1
  }

  await recordSolarAudit({ projectId, actorId: gate.userId, verb: 'access_copied', objectRef: { source_project_id: sourceProjectId, copied, skipped } })
  if (copied > 0) {
    await emitProductEvent({ actorId: gate.userId, projectId, event: 'solar_access_changed', properties: { via: 'copy', copied } })
  }
  revalidatePath(accessPath(projectId))
  return { ok: true, copied, skipped }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/solar-access.actions.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-access.actions.ts apps/web/src/actions/solar-access.actions.test.ts
git commit -m "feat(solar): grantor actions — set level, approve/decline, copy access, all stale-guarded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Access panel — loader, page and component

**Files:**
- Create: `apps/web/src/lib/solar/access-panel-types.ts`
- Create: `apps/web/src/lib/solar/access-panel.ts`
- Create: `.../solar/_components/useArmedConfirm.ts`
- Create: `.../solar/access/page.tsx`
- Create: `.../solar/access/AccessPanel.tsx`, `.../solar/access/AccessPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

`.../solar/access/AccessPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  setLevel: vi.fn(),
  decide: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-access.actions', () => ({
  setSolarMemberLevelAction: h.setLevel,
  decideSolarRequestAction: h.decide,
  copySolarAccessFromProjectAction: h.copy,
}))

import { AccessPanel } from './AccessPanel'
import type { AccessPanelData } from '@/lib/solar/access-panel-types'

const T1 = '2026-09-28T08:00:00.000000+00:00'
const data: AccessPanelData = {
  projectId: 'p1',
  projectName: 'Kings Mall',
  organisationId: 'org-1',
  members: [
    { userId: 'u-own', name: 'Olive Owner', email: 'o@x.test', role: 'owner', external: false, implicit: true, level: 'edit_financials', grantedByName: null, grantedAt: null, updatedAt: null },
    { userId: 'u-con', name: 'Carl Contractor', email: 'c@x.test', role: 'contractor', external: false, implicit: false, level: 'view', grantedByName: 'Olive Owner', grantedAt: T1, updatedAt: T1 },
    { userId: 'u-ext', name: 'Eve External', email: 'e@x.test', role: 'contractor', external: true, implicit: false, level: null, grantedByName: null, grantedAt: null, updatedAt: null },
  ],
  requests: [
    { id: 'r1', requesterId: 'u-req', requesterName: 'Rita Requester', requestedLevel: 'edit', maxLevel: 'edit_financials', note: 'For the PV design', createdAt: T1 },
  ],
  otherProjects: [{ id: 'p2', name: 'Other Mall' }],
  subscription: { status: 'active', currentPeriodEnd: '2027-09-28T08:00:00Z' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.setLevel.mockResolvedValue({ ok: true, updatedAt: 'T2' })
  h.decide.mockResolvedValue({ ok: true })
  h.copy.mockResolvedValue({ ok: true, copied: 2, skipped: 1 })
})

describe('AccessPanel', () => {
  it('shows owners/admins as implicit Edit + financials, with no control', () => {
    render(<AccessPanel data={data} />)
    expect(screen.getByText('Edit + financials (owner/admin)')).toBeDefined()
    expect(screen.queryByLabelText('Solar level for Olive Owner')).toBeNull()
  })

  it('saves a level change immediately with the row’s expectedUpdatedAt', async () => {
    render(<AccessPanel data={data} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'edit')
    expect(h.setLevel).toHaveBeenCalledWith({ projectId: 'p1', userId: 'u-con', level: 'edit', expectedUpdatedAt: T1 })
    expect(h.refresh).toHaveBeenCalled()
  })

  it('removing access needs a second press', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'none')
    expect(h.setLevel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(h.setLevel).toHaveBeenCalledWith({ projectId: 'p1', userId: 'u-con', level: null, expectedUpdatedAt: T1 })
  })

  it('an external member can only be given View', () => {
    render(<AccessPanel data={data} />)
    const select = screen.getByLabelText('Solar level for Eve External') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['None', 'View'])
  })

  it('shows a stale save as the reload sentence', async () => {
    h.setLevel.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<AccessPanel data={data} />)
    await userEvent.setup().selectOptions(screen.getByLabelText('Solar level for Carl Contractor'), 'edit')
    expect((await screen.findByRole('alert')).textContent).toBe('Someone else changed this — reload to see their version.')
  })

  it('approves a request at the chosen level', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    expect(screen.getByText('“For the PV design”')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Approve Rita Requester as'), 'view')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(h.decide).toHaveBeenCalledWith({ requestId: 'r1', decision: 'approve', level: 'view' })
  })

  it('declines with an optional reason', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.type(screen.getByLabelText('Reason (optional)'), 'Not on this job')
    await user.click(screen.getByRole('button', { name: 'Confirm decline' }))
    expect(h.decide).toHaveBeenCalledWith({ requestId: 'r1', decision: 'decline', reason: 'Not on this job' })
  })

  it('copy access needs two presses and reports the counts', async () => {
    const user = userEvent.setup()
    render(<AccessPanel data={data} />)
    await user.click(screen.getByRole('button', { name: 'Copy access from project' }))
    expect(h.copy).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Press again to copy from Other Mall' }))
    expect(h.copy).toHaveBeenCalledWith({ projectId: 'p1', sourceProjectId: 'p2' })
    expect(await screen.findByText('Copied 2; skipped 1 not eligible on this project.')).toBeDefined()
  })

  it('shows the subscription state and a Manage subscription link', () => {
    render(<AccessPanel data={data} />)
    expect(screen.getByText('Subscription')).toBeDefined()
    expect(screen.getByText('Active — renews 28 Sep 2027')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Manage subscription' }).getAttribute('href')).toBe('/settings/billing')
  })

  it('a cancelled-mid-year subscription stays active until the paid year ends (1B: non_renewing)', () => {
    render(<AccessPanel data={{ ...data, subscription: { status: 'non_renewing', currentPeriodEnd: '2027-09-28T08:00:00Z' } }} />)
    expect(screen.getByText('Active — ends 28 Sep 2027')).toBeDefined()
  })

  it('empty states', () => {
    render(<AccessPanel data={{ ...data, members: [], requests: [], otherProjects: [], subscription: null }} />)
    expect(screen.getByText('No requests waiting.')).toBeDefined()
    expect(screen.getByText('No project members yet — add them in project settings.')).toBeDefined()
    expect(screen.getByText('No other projects in this organisation.')).toBeDefined()
    expect(screen.getByText('Not subscribed')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/access"`
Expected: FAIL — cannot resolve `./AccessPanel`.

- [ ] **Step 3: Implement types, loader, hook, page and component**

`apps/web/src/lib/solar/access-panel-types.ts`:
```ts
/** Access panel data — JSON only (crosses the server → client boundary). */
import type { SolarAccessLevel } from '@esite/shared'

export interface AccessPanelMember {
  userId: string
  name: string
  email: string | null
  /** E-Site role on the project (org role for owners/admins/PMs, else the project_members role). */
  role: string
  /** Not an active member of the project's organisation → capped at View. */
  external: boolean
  /** Org owner/admin: Edit + financials implicitly, cannot be changed here. */
  implicit: boolean
  level: SolarAccessLevel | null
  grantedByName: string | null
  grantedAt: string | null
  /** project_access.updated_at — the stale-write token for this row. */
  updatedAt: string | null
}

export interface AccessPanelRequest {
  id: string
  requesterId: string
  requesterName: string
  requestedLevel: SolarAccessLevel | null
  maxLevel: SolarAccessLevel
  note: string | null
  createdAt: string
}

export interface AccessPanelData {
  projectId: string
  projectName: string
  organisationId: string
  members: AccessPanelMember[]
  requests: AccessPanelRequest[]
  otherProjects: Array<{ id: string; name: string }>
  subscription: { status: string; currentPeriodEnd: string | null } | null
}
```

`apps/web/src/lib/solar/access-panel.ts`:
```ts
import 'server-only'
/**
 * Data for /solar/access (spec §1.3). Returns null unless the caller is a
 * grantor (solar_is_grantor). Identities (other members' org roles, names)
 * are read with the service client AFTER that gate — user_organisations and
 * profiles are own-row-only under RLS (the pattern in
 * apps/web/src/actions/project-members.actions.ts:96-125). Grants, requests,
 * sibling projects and the subscription are read through the caller's own
 * session, so RLS still scopes them.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, SOLAR_EXCLUDED_ROLES } from '@esite/shared'
import type { AccessPanelData, AccessPanelMember, AccessPanelRequest } from './access-panel-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const EXCLUDED = SOLAR_EXCLUDED_ROLES as readonly string[]

export async function loadSolarAccessPanel(projectId: string): Promise<AccessPanelData | null> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: isGrantor } = await supabase.rpc('solar_is_grantor', { p_project_id: projectId })
  if (isGrantor !== true) return null
  const { data: project } = await supabase.schema('projects').from('projects')
    .select('id, name, organisation_id').eq('id', projectId).maybeSingle()
  if (!project) return null
  const orgId = project.organisation_id as string
  const svc = createServiceClient() as unknown as AnyClient

  const [pmRes, orgRes, grantsRes, reqRes, projRes, subRes] = await Promise.all([
    svc.schema('projects').from('project_members').select('user_id, role, organisation_id')
      .eq('project_id', projectId).eq('is_active', true),
    svc.from('user_organisations').select('user_id, role').eq('organisation_id', orgId).eq('is_active', true),
    supabase.schema('solar').from('project_access').select('user_id, level, granted_by, granted_at, updated_at')
      .eq('project_id', projectId),
    supabase.schema('solar').from('access_requests').select('id, requester_id, requested_level, note, created_at')
      .eq('project_id', projectId).eq('kind', 'access').eq('status', 'pending').order('created_at'),
    supabase.schema('projects').from('projects').select('id, name')
      .eq('organisation_id', orgId).neq('id', projectId).order('name'),
    supabase.schema('billing').from('org_addon_subscriptions').select('status, current_period_end')
      .eq('organisation_id', orgId).eq('feature_key', 'solar').maybeSingle(),
  ])

  const orgRole = new Map<string, string>(((orgRes.data ?? []) as Row[]).map((r) => [r.user_id as string, r.role as string]))
  const entries = new Map<string, { role: string; external: boolean; implicit: boolean }>()
  for (const [uid, role] of orgRole) {
    if (role === 'owner' || role === 'admin') entries.set(uid, { role, external: false, implicit: true })
    else if (role === 'project_manager') entries.set(uid, { role, external: false, implicit: false })
  }
  for (const r of (pmRes.data ?? []) as Row[]) {
    const uid = r.user_id as string
    if (entries.has(uid)) continue
    const own = orgRole.get(uid)
    const role = r.role as string
    if (EXCLUDED.includes(role) || (own !== undefined && EXCLUDED.includes(own))) continue
    entries.set(uid, { role, external: own === undefined, implicit: false })
  }

  const grants = new Map<string, Row>(((grantsRes.data ?? []) as Row[]).map((g) => [g.user_id as string, g]))
  const requests = (reqRes.data ?? []) as Row[]
  const ids = new Set<string>([
    ...entries.keys(),
    ...requests.map((r) => r.requester_id as string),
    ...[...grants.values()].map((g) => g.granted_by as string | null).filter((v): v is string => Boolean(v)),
  ])
  const { data: profiles } = ids.size
    ? await svc.from('profiles').select('id, full_name, email').in('id', [...ids])
    : { data: [] as Row[] }
  const prof = new Map<string, Row>(((profiles ?? []) as Row[]).map((p) => [p.id as string, p]))
  const nameOf = (id: string): string =>
    (prof.get(id)?.full_name as string | null)?.trim() || (prof.get(id)?.email as string | null) || 'Unknown user'

  const members: AccessPanelMember[] = [...entries].map(([uid, e]) => {
    const g = grants.get(uid)
    return {
      userId: uid,
      name: nameOf(uid),
      email: (prof.get(uid)?.email as string | null) ?? null,
      role: e.role,
      external: e.external,
      implicit: e.implicit,
      level: e.implicit ? 'edit_financials' : g && isSolarAccessLevel(g.level) ? g.level : null,
      grantedByName: g?.granted_by ? nameOf(g.granted_by as string) : null,
      grantedAt: (g?.granted_at as string | undefined) ?? null,
      updatedAt: (g?.updated_at as string | undefined) ?? null,
    }
  }).sort((a, b) => Number(b.implicit) - Number(a.implicit) || a.name.localeCompare(b.name))

  const reqs: AccessPanelRequest[] = requests.map((r) => ({
    id: r.id as string,
    requesterId: r.requester_id as string,
    requesterName: nameOf(r.requester_id as string),
    requestedLevel: isSolarAccessLevel(r.requested_level) ? r.requested_level : null,
    maxLevel: orgRole.has(r.requester_id as string) ? 'edit_financials' : 'view',
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))

  const sub = subRes.data as Row | null
  return {
    projectId,
    projectName: project.name as string,
    organisationId: orgId,
    members,
    requests: reqs,
    otherProjects: ((projRes.data ?? []) as Row[]).map((p) => ({ id: p.id as string, name: p.name as string })),
    subscription: sub ? { status: sub.status as string, currentPeriodEnd: (sub.current_period_end as string | null) ?? null } : null,
  }
}
```

`.../solar/_components/useArmedConfirm.ts`:
```ts
'use client'
/** Two-step inline confirm (spec §0.4 rule 1): first press arms, second commits, 3 s auto-disarm. */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useArmedConfirm(ms = 3000) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])
  const disarm = useCallback(() => { clear(); setArmed(false) }, [clear])
  const arm = useCallback(() => {
    clear()
    setArmed(true)
    timer.current = setTimeout(() => { timer.current = null; setArmed(false) }, ms)
  }, [clear, ms])

  useEffect(() => clear, [clear])
  return { armed, arm, disarm }
}
```

`.../solar/access/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { loadSolarAccessPanel } from '@/lib/solar/access-panel'
import { AccessPanel } from './AccessPanel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar access' }

/**
 * Grantors only (spec §1.3). OUTSIDE solar/(gated): owners/admins may set up
 * grants before the org subscribes (00208 keeps project_access ungated by
 * subscription), and the gated layout would bounce them to /locked.
 */
export default async function SolarAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await loadSolarAccessPanel(id)
  if (!data) redirect(`/projects/${id}/solar`)
  return (
    <div className="animate-fadeup" style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${id}/solar`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Solar
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar access</h1>
          <p className="page-subtitle">{data.projectName}</p>
        </div>
      </div>
      <AccessPanel data={data} />
    </div>
  )
}
```

`.../solar/access/AccessPanel.tsx`:
```tsx
'use client'
/**
 * Solar Access panel (spec §1.3). Level changes save immediately (with the
 * row's updated_at as expectedUpdatedAt); removing access and copying access
 * are two-step. After every successful write the server data is refreshed.
 */
import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SOLAR_LEVEL_LABELS, formatSolarDate, isSolarAccessLevel, requestableLevels, type SolarAccessLevel,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  copySolarAccessFromProjectAction, decideSolarRequestAction, setSolarMemberLevelAction,
} from '@/actions/solar-access.actions'
import type { AccessPanelData, AccessPanelMember, AccessPanelRequest } from '@/lib/solar/access-panel-types'
import { useArmedConfirm } from '../_components/useArmedConfirm'

const ERR: CSSProperties = { margin: '4px 0 0', fontSize: 12, color: 'var(--c-red)' }
const TH: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const MUTED: CSSProperties = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }

export function AccessPanel({ data }: { data: AccessPanelData }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubscriptionCard subscription={data.subscription} />
      <Card>
        <CardHeader><span className="data-panel-title">Requests</span></CardHeader>
        <CardBody>
          {data.requests.length === 0
            ? <p style={MUTED}>No requests waiting.</p>
            : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
                {data.requests.map((r) => <RequestRow key={r.id} request={r} onDone={refresh} />)}
              </ul>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Members</span></CardHeader>
        <CardBody>
          {data.members.length === 0
            ? <p style={MUTED}>
                <span>No project members yet — add them in project settings.</span>{' '}
                <Link href={`/projects/${data.projectId}/settings/members`}>Project members</Link>
              </p>
            : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr><th style={TH}>Member</th><th style={TH}>E-Site role</th><th style={TH}>Solar level</th><th style={TH}>Granted by</th><th style={TH}>Granted on</th></tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <MemberRow key={`${m.userId}:${m.updatedAt ?? 'none'}`} projectId={data.projectId} member={m} onSaved={refresh} />
                    ))}
                  </tbody>
                </table>
              </div>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Copy access from another project</span></CardHeader>
        <CardBody><CopyAccess projectId={data.projectId} projects={data.otherProjects} onDone={refresh} /></CardBody>
      </Card>
    </div>
  )
}

function SubscriptionCard({ subscription }: { subscription: AccessPanelData['subscription'] }) {
  let text = 'Not subscribed'
  if (subscription) {
    const end = subscription.currentPeriodEnd
    const lapsed = end !== null && Date.parse(end) <= Date.now()
    if ((subscription.status === 'active' || subscription.status === 'non_renewing') && end) {
      text = lapsed
        ? `Lapsed on ${formatSolarDate(end)}`
        : `${subscription.status === 'active' ? 'Active — renews' : 'Active — ends'} ${formatSolarDate(end)}`
    } else {
      text = ({ pending: 'Waiting for payment', past_due: 'Payment overdue', cancelled: 'Cancelled', refunded: 'Refunded' } as Record<string, string>)[subscription.status] ?? subscription.status
    }
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Subscription</span></CardHeader>
      <CardBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13 }}>{text}</span>
          <Link href="/settings/billing" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-amber)' }}>Manage subscription</Link>
        </div>
      </CardBody>
    </Card>
  )
}

function MemberRow({ projectId, member, onSaved }: { projectId: string; member: AccessPanelMember; onSaved: () => void }) {
  const [level, setLevel] = useState<SolarAccessLevel | null>(member.level)
  const [updatedAt, setUpdatedAt] = useState<string | null>(member.updatedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = useArmedConfirm()
  const options = requestableLevels(member.external ? 'view' : 'edit_financials')

  async function save(next: SolarAccessLevel | null) {
    setBusy(true)
    setError(null)
    const res = await setSolarMemberLevelAction({ projectId, userId: member.userId, level: next, expectedUpdatedAt: updatedAt })
    setBusy(false)
    remove.disarm()
    if ('error' in res) { setError(res.error); return }
    setLevel(next)
    setUpdatedAt(res.updatedAt)
    onSaved()
  }

  function onChange(value: string) {
    if (value === 'none') {
      if (level !== null) remove.arm()
      return
    }
    remove.disarm()
    if (isSolarAccessLevel(value) && value !== level) void save(value)
  }

  return (
    <tr>
      <td style={TD}>
        {member.name}{' '}
        {member.external && <Badge variant="ghost">external</Badge>}
      </td>
      <td style={TD}>{member.role.replace(/_/g, ' ')}</td>
      <td style={TD}>
        {member.implicit
          ? <span>Edit + financials (owner/admin)</span>
          : <>
              <select
                aria-label={`Solar level for ${member.name}`}
                value={remove.armed ? 'none' : (level ?? 'none')}
                disabled={busy}
                onChange={(e) => onChange(e.target.value)}
              >
                <option value="none">None</option>
                {options.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
              </select>
              {remove.armed && (
                <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                  Remove access?
                  <Button type="button" size="sm" variant="danger" onClick={() => void save(null)} isLoading={busy}>Remove</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={remove.disarm}>Cancel</Button>
                </span>
              )}
              {error && <p role="alert" style={ERR}>{error}</p>}
            </>}
      </td>
      <td style={TD}>{member.grantedByName ?? '—'}</td>
      <td style={TD}>{member.grantedAt ? formatSolarDate(member.grantedAt) : '—'}</td>
    </tr>
  )
}

function RequestRow({ request, onDone }: { request: AccessPanelRequest; onDone: () => void }) {
  const levels = requestableLevels(request.maxLevel)
  const initial = request.requestedLevel && levels.includes(request.requestedLevel) ? request.requestedLevel : levels[0]
  const [level, setLevel] = useState<SolarAccessLevel>(initial)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true)
    setError(null)
    const res = await decideSolarRequestAction(
      decision === 'approve'
        ? { requestId: request.id, decision, level }
        : { requestId: request.id, decision, reason },
    )
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    onDone()
  }

  return (
    <li style={{ borderBottom: '1px solid var(--c-border)', paddingBottom: 12 }}>
      <div style={{ fontSize: 13 }}>
        <strong>{request.requesterName}</strong> asked for{' '}
        {request.requestedLevel ? SOLAR_LEVEL_LABELS[request.requestedLevel] : 'access'} on {formatSolarDate(request.createdAt)}
      </div>
      {request.note && <p style={{ ...MUTED, marginTop: 4 }}>{`“${request.note}”`}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <select aria-label={`Approve ${request.requesterName} as`} value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as SolarAccessLevel)}>
          {levels.map((l) => <option key={l} value={l}>{SOLAR_LEVEL_LABELS[l]}</option>)}
        </select>
        <Button type="button" size="sm" onClick={() => void decide('approve')} isLoading={busy && !declining}>Approve</Button>
        {!declining
          ? <Button type="button" size="sm" variant="secondary" onClick={() => setDeclining(true)} disabled={busy}>Decline</Button>
          : <>
              <input aria-label="Reason (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
              <Button type="button" size="sm" variant="danger" onClick={() => void decide('decline')} isLoading={busy}>Confirm decline</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>Cancel</Button>
            </>}
      </div>
      {error && <p role="alert" style={ERR}>{error}</p>}
    </li>
  )
}

function CopyAccess({ projectId, projects, onDone }: { projectId: string; projects: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [source, setSource] = useState(projects[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirm = useArmedConfirm()
  if (projects.length === 0) return <p style={MUTED}>No other projects in this organisation.</p>
  const sourceName = projects.find((p) => p.id === source)?.name ?? ''

  async function onClick() {
    if (!confirm.armed) { confirm.arm(); return }
    confirm.disarm()
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await copySolarAccessFromProjectAction({ projectId, sourceProjectId: source })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setMessage(`Copied ${res.copied}; skipped ${res.skipped} not eligible on this project.`)
    onDone()
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <select aria-label="Copy access from" value={source} onChange={(e) => { setSource(e.target.value); confirm.disarm() }} disabled={busy}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button type="button" size="sm" variant={confirm.armed ? 'danger' : 'secondary'} onClick={() => void onClick()} isLoading={busy}>
        {confirm.armed ? `Press again to copy from ${sourceName}` : 'Copy access from project'}
      </Button>
      {message && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{message}</span>}
      {error && <p role="alert" style={ERR}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/access"`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/access-panel-types.ts apps/web/src/lib/solar/access-panel.ts "apps/web/src/app/(admin)/projects/[id]/solar/access" "apps/web/src/app/(admin)/projects/[id]/solar/_components/useArmedConfirm.ts"
git commit -m "feat(solar): Access panel — members, levels, requests, copy access, subscription card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `docs/rbac-matrix.md` — Solar routes, actions, email caller

**Files:**
- Modify: `docs/rbac-matrix.md` (insert a new section immediately before `## Client portal (`; add one row to the `send-email` caller table)

- [ ] **Step 1: Insert the Solar section**

Insert before the line `## Client portal (\`apps/web/src/app/(portal)/portal/*\`)`:
```markdown
## Solar (`apps/web/src/app/(admin)/projects/[id]/solar/*`)

Solar is **not** gated by the E-Site role. Two things decide it (migration `00208`): the project org's Solar subscription (`public.org_has_solar`) and the caller's **per-user level** on the project (`public.solar_access_level` → `view` / `edit` / `edit_financials`). Org owners/admins of the project's org are **grantors** and hold Edit + financials implicitly while the org is subscribed. Suppliers and client viewers can never hold a level; a project member who is not an active member of the project's org ("external") is capped at View. The columns below are therefore Solar situations, not E-Site roles. Every page, action and RLS policy asks the database; the page gate is never the only gate.

| Route | Grantor (org owner/admin) | Edit + financials | Edit | View | Own-org member, no grant | External member, no grant | supplier / client_viewer |
|---|---|---|---|---|---|---|---|
| `/projects/[id]/solar` (redirect) | → overview (subscribed) / → locked | → overview | → overview | → overview | → locked | → locked | → locked → project |
| `/projects/[id]/solar/locked` | W — **Subscribe** (unsubscribed) | → overview | → overview | → overview | W — **Ask an admin to subscribe** (unsubscribed) / **Request access** (subscribed) / **Withdraw** | W — **Request access** (View) / **Withdraw** | → `/projects/[id]` |
| `/projects/[id]/solar/overview` | W | W | W | R | → locked | → locked | → locked |
| `/projects/[id]/solar/access` | W (subscribed or not) | → `/solar` | → `/solar` | → `/solar` | → `/solar` | → `/solar` | → `/solar` |

> `/solar/locked` and `/solar/access` sit **outside** `solar/(gated)` so the gate's redirect cannot loop and grantors can set grants before paying (00208 leaves `project_access`/`access_requests` ungated by subscription; a grant confers nothing until the org subscribes). Tabs other than Overview and Site & Supply have **no route** in Phase 1 — the tab bar renders them disabled ("Coming in a later phase"). Tariff and Financials are hidden below Edit + financials; Operations is hidden for everyone until Phase 7 (D-12).

### Solar server actions

| Action | Gate (re-checked in the action) | DB layer that decides |
|---|---|---|
| `getSolarNavStateAction` (`solar-requests.actions.ts`) | signed-in; describes only the caller | the 00208 helpers it calls |
| `getSolarSubscriptionStateAction` | signed-in; describes only the caller | `solar_access_level` |
| `requestSolarAccessAction` | resolved state is *request access*, or *granted* below Edit + financials (View-only banner) | `access_requests_guard` binds requester/org/status, clamps the level to the requester's maximum, refuses ineligible requesters |
| `askAdminToSubscribeAction` | resolved state is *ask an admin* (own-org non-grantor, org unsubscribed); one open request per user per **org** | guard refuses externals' subscribe requests |
| `withdrawSolarRequestAction` | requester's own pending `access` request | RLS (requester) + guard (only the requester may withdraw) |
| `setSolarMemberLevelAction` (`solar-access.actions.ts`) | `solar_is_grantor(project)`; `expectedUpdatedAt` stale guard | RLS grantor-only writes; `project_access_bind` refuses clients/suppliers/non-members and caps externals at View |
| `decideSolarRequestAction` | `solar_is_grantor(request's project)`; conditioned on `status = 'pending'` | guard: only a grantor decides; approval writes the grant, never above the requester's maximum |
| `copySolarAccessFromProjectAction` | `solar_is_grantor` on **both** projects; same organisation | per-row `project_access_bind` — refusals are counted as skipped |

> Every Solar write records a `solar.audit_events` row (service client, after the action's gate — the RLS insert policy needs `solar_can_edit`, which is false while unsubscribed) and, for primary actions, a `product_events` row (`solar_*` verbs, `00209`). Request/decision notifications use the four `solar_*` types added to `notifications_type_check` in `00209`: requests go to the org's owners/admins (bell + email), decisions to the requester (bell).
```

- [ ] **Step 2: Add the send-email caller**

In the table under `## Edge function callers — \`send-email\``, change the first row's caller list from
`lib/{invite-email,rfi-email,snag-email,notify,diary-email,qc-email,site-form-email}.ts`
to
`lib/{invite-email,rfi-email,snag-email,notify,diary-email,qc-email,site-form-email}.ts`, `lib/solar/notify.ts`

- [ ] **Step 3: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): Solar routes, actions and send-email caller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Suites, type-check, push, draft PR

**Files:** only whatever a failing guard names.

- [ ] **Step 1: Run every suite and the type-check**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter web type-check 2>&1 | tail -5
pnpm --filter @esite/db test:ci 2>&1 | tail -15
```
Expected: all green; web and shared counts above the Task 1 baseline by the tests added here. Pay attention to:
- `apps/web/src/lib/migration-verify-block.contract.test.ts` (parses 00209's `@verify` block).
- `packages/db` migration-text guards (anon EXECUTE on SECURITY DEFINER functions, write-role RLS shapes). A guard failure means the migration shape is wrong — fix the migration, never weaken the guard; if a guard is genuinely inapplicable, stop and report its name and message.
- `apps/web/src/lib/analytics/product-events.contract.test.ts` — every file that calls `trackServer` must also call `emitProductEvent` (the new actions call only `emitProductEvent`, which is allowed).

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix(solar): satisfy repo guards for 1C-i

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Skip if nothing changed.)

- [ ] **Step 3: Push and open the draft PR**

```bash
. /tmp/solar-1c-base.txt 2>/dev/null; PR_BASE=${PR_BASE:-feat/solar-phase-1b}
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-1c
gh pr create --repo WattMatt/e-site --draft --base "$PR_BASE" --head feat/solar-phase-1c \
  --title "feat(solar): Phase 1C — first screens (entry, locked, access, overview, site & supply, settings)" \
  --body-file /tmp/solar-1c-pr.md
```
Before pushing, confirm the 1B contract still matches (it was given to this plan on 2026-09-28): `grep -rn "payment=received" apps/web/src/app/api/paystack` should find 1B's `return_to`/callback, and the subscribe route's 403/409/429/503 codes should be unchanged. If 1B renamed the query parameter, change `payment === 'received'` in `solar/locked/page.tsx` and the page test to match.

`/tmp/solar-1c-pr.md` must contain: what 1C-i adds (sidebar entry, `/solar` redirect, locked screen, gated chrome, Access panel, request/decision notifications, migration `00209`); the dry-run evidence from `/tmp/solar-1c-dryrun.txt`; suite counts before/after; "1C-ii (Overview, Site & Supply, `/settings/solar`) follows on this branch"; and this **apply checklist**:
1. `00208` must be applied first (Phase 1A). Re-check ledger `max(version)`, `origin/main` and open-PR migration filenames immediately before applying; renumber `00209` if taken.
2. Merge → deploy workflow applies → `scripts/verify-migration-applied.ts` checks the `@verify` block (and re-checks 00208's schema-wide directives, which 00209 conforms to).
3. Re-run `scripts/db/assert-solar-org-settings-roles.sql` against production with a no-op migration → all `t`.
4. **Owner signed-in walk** (not possible from an agent session — it would need a password): see the checklist in plan 1C-ii Task 9.

End the body with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Report** the PR URL, suite counts and dry-run result, then continue with plan 1C-ii on the same branch.

---

## Self-review (done while writing)

- **Spec coverage.** §0.1 two layers → `loadSolarEntry` + gated layout + actions; legend → `visibleSolarTabs`, level-hidden controls. §0.2 five rows → `resolveSolarEntry` (Task 2), `LockedScreen` rows 1–4 (Task 10), row 5 redirect (Task 11), badge (Task 9). §0.3 tab bar + dots + no-auto-save + in-app discard confirm + beforeunload → Task 5 (dirty store) + Task 12; View-only banner → Task 12; "Stale" banner — **not built**: there are no cases or runs in Phase 1 (engine spec §1.3), so it can never show. §0.4: rule 1 two-step (remove/copy), rule 2 `expectedUpdatedAt` (level saves; decisions conditioned on `status='pending'`), rule 4 spinner + disabled (`isLoading`), rule 5 `humanSolarError`, rule 6 empty states (requests, members, projects, subscription), rule 8 `product_events` (00209). Rule 7 (PDF strings) — no PDF in 1C. §1.1 → Task 9. §1.2 all five controls incl. return handling → Tasks 10–11. §1.3 all five controls → Tasks 13–14.
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `SolarEntryState`, `SolarNavBadge`, `requestableLevels`, `SOLAR_LEVEL_LABELS`, `ReadinessStep`, `AccessPanelData`, action names and result shapes are identical across tasks and tests.
