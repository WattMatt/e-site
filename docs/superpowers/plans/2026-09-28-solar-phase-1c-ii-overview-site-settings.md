# Solar Phase 1C-ii — Overview, Site & Supply, Org Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Solar module's first two tabs — the Overview (study header, readiness checklist, KPI empty state, recent activity) and Site & Supply (location, supply authority & connection, site constraints, with roof sources and solar resource marked "coming in a later phase") — and add the `/settings/solar` org-defaults skeleton seeded with the decided defaults.

**Architecture:** Validation and defaults are pure modules in `@esite/shared` used by both the client form (instant feedback) and the server action (the real check). Saves go through server actions that re-check the Solar level (`requireSolarLevel`) or the org role (`requireRole`), carry `expectedUpdatedAt`, write through the caller's session so 00208/00209 RLS decides, then record an audit event and a `product_events` row. Pages pass JSON-only props to client forms.

**Tech Stack:** Next.js 15 App Router, Supabase (RLS; `solar.studies` from 00208, `solar.org_settings` from 00209), Vitest + @testing-library/react + user-event, pnpm.

**Spec:** `docs/solar/01-functional-spec.md` §2 (Overview; §2.3 only the Site & Supply rule is live), §3 (Site & Supply; §3.2 without roof sources / satellite / calibration — Phase 5; without §3.3 solar resource — Phase 4; without "Locate from address"; licensee is free text `licensee_name` until Phase 2), §11 (org settings skeleton). Defaults: `docs/solar/06-open-decisions.md` D-05, D-07, D-16 and `docs/solar/02-calculation-engine-spec.md` defaults table.

**Prerequisite:** plan `docs/superpowers/plans/2026-09-28-solar-phase-1c-i-entry-and-access.md` fully executed on branch `feat/solar-phase-1c` (worktree `~/.config/superpowers/worktrees/esite/solar-phase-1c`), including migration `00209` (which creates `solar.org_settings` and the `solar_site_saved` / `solar_settings_saved` product events), the test fake `apps/web/src/test/fake-supabase.ts`, `lib/solar/{errors,audit,dirty-store}.ts`, and `solar/_components/{ReadinessChecklist,StatusDot}.tsx`.

---

## Ground rules

The 1C-i ground rules apply unchanged (never trust the page gate; JSON-only props; two-step confirm for destructive actions; `expectedUpdatedAt` on every save with the exact stale sentence; human sentences only; controls above the level hidden, not disabled; block-bodied `beforeEach`; `vi.hoisted`; cast to `AnyClient` for non-generated schemas; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Commands run from the worktree root.

**No map component exists in `apps/web`** (checked: no leaflet/maplibre/mapbox dependency or import), so Site & Supply uses numeric latitude/longitude inputs only; the draggable pin arrives with a later phase.

---

## File structure

**Shared (`packages/shared/src/solar/`)**
- `activity.ts` — `describeSolarAuditEvent` (audit verb → sentence + link target).
- `site-supply.ts` — option lists, `SiteSupplyForm`, `validateSiteSupply`, `siteSupplyFormFromRow`.
- `org-settings.ts` — `SOLAR_SETTING_FIELDS` (seeded defaults), `readSolarOrgSettings`, `solarSettingsToForm`, `validateSolarOrgSettings`.
- `index.ts` — re-exports.

**Web — lib / actions**
- `apps/web/src/lib/solar/activity.ts` — `loadSolarActivity` (last 10 audit events with actor names); `activity-types.ts` — the client-safe item type.
- `apps/web/src/actions/solar-site.actions.ts` — `saveSolarSiteAction`.
- `apps/web/src/actions/solar-settings.actions.ts` — `saveSolarOrgSettingsAction`.

**Web — UI**
- `.../solar/_components/StudyHeader.tsx`, `OverviewKpis.tsx`, `ActivityList.tsx` (+ tests).
- `.../solar/(gated)/overview/page.tsx` — replaced with the full Overview.
- `.../solar/(gated)/site/page.tsx`, `.../solar/(gated)/site/SiteSupplyForm.tsx` (+ test).
- `apps/web/src/app/(admin)/settings/solar/page.tsx`, `SolarSettingsForm.tsx` (+ test).
- `apps/web/src/app/(admin)/settings/page.tsx` — one "Solar defaults" card.

**Docs**
- `docs/rbac-matrix.md` — Site & Supply and `/settings/solar` rows; two action rows.

(`...` = `apps/web/src/app/(admin)/projects/[id]`.)

---

### Task 1: Audit-event sentences and the activity loader

**Files:**
- Create: `packages/shared/src/solar/activity.ts`, `packages/shared/src/solar/activity.test.ts`
- Modify: `packages/shared/src/solar/index.ts`
- Create: `apps/web/src/lib/solar/activity.ts`, `apps/web/src/lib/solar/activity.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/activity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { describeSolarAuditEvent } from './activity'

describe('describeSolarAuditEvent', () => {
  it('turns every 1C verb into a sentence and a link target', () => {
    expect(describeSolarAuditEvent('access_granted', { level: 'edit' })).toEqual({ text: 'Solar access granted (Edit)', target: 'access' })
    expect(describeSolarAuditEvent('access_changed', { level: 'edit_financials' })).toEqual({ text: 'Solar access changed to Edit + financials', target: 'access' })
    expect(describeSolarAuditEvent('access_removed', {})).toEqual({ text: 'Solar access removed', target: 'access' })
    expect(describeSolarAuditEvent('access_request_approved', { level: 'view' })).toEqual({ text: 'Access request approved (View)', target: 'access' })
    expect(describeSolarAuditEvent('access_request_declined', { reason: 'x' })).toEqual({ text: 'Access request declined', target: 'access' })
    expect(describeSolarAuditEvent('access_copied', { copied: 3 })).toEqual({ text: 'Access copied from another project (3 copied)', target: 'access' })
    expect(describeSolarAuditEvent('site_saved', {})).toEqual({ text: 'Site & Supply saved', target: 'site' })
  })
  it('falls back to a readable verb with no link for anything newer', () => {
    expect(describeSolarAuditEvent('case_run_finished', {})).toEqual({ text: 'case run finished', target: null })
  })
})
```

`apps/web/src/lib/solar/activity.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ service: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createServiceClient: () => h.service }))

import { loadSolarActivity } from './activity'
import { fakeSupabase } from '@/test/fake-supabase'

describe('loadSolarActivity', () => {
  it('returns the project’s events with actor names and sentences', async () => {
    const { client } = fakeSupabase({
      tables: {
        'solar.audit_events': [
          { id: 2, project_id: 'p1', verb: 'site_saved', object_ref: {}, actor_id: 'u1', created_at: '2026-09-28T09:00:00Z' },
          { id: 1, project_id: 'p1', verb: 'access_granted', object_ref: { level: 'view' }, actor_id: 'u2', created_at: '2026-09-28T08:00:00Z' },
          { id: 9, project_id: 'p-other', verb: 'site_saved', object_ref: {}, actor_id: 'u1', created_at: '2026-09-28T07:00:00Z' },
        ],
      },
    })
    h.service = fakeSupabase({ tables: { 'public.profiles': [{ id: 'u1', full_name: 'Ann' }, { id: 'u2', full_name: null }] } }).client
    await expect(loadSolarActivity('p1', client as never)).resolves.toEqual([
      { id: 2, at: '2026-09-28T09:00:00Z', actorName: 'Ann', text: 'Site & Supply saved', target: 'site' },
      { id: 1, at: '2026-09-28T08:00:00Z', actorName: 'Someone', text: 'Solar access granted (View)', target: 'access' },
    ])
  })

  it('returns an empty list when nothing happened yet', async () => {
    const { client } = fakeSupabase()
    await expect(loadSolarActivity('p1', client as never)).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/activity.test.ts && pnpm --filter web exec vitest run src/lib/solar/activity.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/activity.ts`:
```ts
/** solar.audit_events row → one sentence for Overview → Recent activity (spec §2.1 item 4). */
import { isSolarAccessLevel } from './access'
import { SOLAR_LEVEL_LABELS } from './entry'

export type SolarActivityTarget = 'access' | 'site' | null

export function describeSolarAuditEvent(
  verb: string,
  ref: Record<string, unknown>,
): { text: string; target: SolarActivityTarget } {
  const level = isSolarAccessLevel(ref.level) ? SOLAR_LEVEL_LABELS[ref.level] : null
  switch (verb) {
    case 'access_granted':
      return { text: level ? `Solar access granted (${level})` : 'Solar access granted', target: 'access' }
    case 'access_changed':
      return { text: level ? `Solar access changed to ${level}` : 'Solar access changed', target: 'access' }
    case 'access_removed':
      return { text: 'Solar access removed', target: 'access' }
    case 'access_request_approved':
      return { text: level ? `Access request approved (${level})` : 'Access request approved', target: 'access' }
    case 'access_request_declined':
      return { text: 'Access request declined', target: 'access' }
    case 'access_copied':
      return { text: `Access copied from another project (${Number(ref.copied ?? 0)} copied)`, target: 'access' }
    case 'site_saved':
      return { text: 'Site & Supply saved', target: 'site' }
    default:
      return { text: verb.replace(/_/g, ' '), target: null }
  }
}
```

Append to `packages/shared/src/solar/index.ts`:
```ts
export * from './activity'
```

`apps/web/src/lib/solar/activity-types.ts` (client-safe: the Overview's `ActivityList` imports this type without pulling in the server-only loader):
```ts
import type { SolarActivityTarget } from '@esite/shared'

export interface SolarActivityItem {
  id: number
  at: string
  actorName: string
  text: string
  target: SolarActivityTarget
}
```

`apps/web/src/lib/solar/activity.ts`:
```ts
import 'server-only'
/**
 * Last 10 Solar audit events for a project, newest first. The events are read
 * through the CALLER's session (audit_events_select = solar_can_view), so a
 * caller without a level gets nothing. Actor names are resolved with the
 * service client afterwards (profiles are own-row-only under RLS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { describeSolarAuditEvent } from '@esite/shared'
import type { SolarActivityItem } from './activity-types'

export type { SolarActivityItem }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

interface AuditRow { id: number; verb: string; object_ref: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function loadSolarActivity(projectId: string, supabase: AnyClient): Promise<SolarActivityItem[]> {
  const { data, error } = await supabase
    .schema('solar').from('audit_events')
    .select('id, verb, object_ref, actor_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(10)
  const rows = (error ? [] : (data ?? [])) as AuditRow[]
  if (rows.length === 0) return []

  const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: profiles } = await svc.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name?.trim()) names.set(p.id, p.full_name.trim())
    }
  }

  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    actorName: (r.actor_id && names.get(r.actor_id)) || 'Someone',
    ...describeSolarAuditEvent(r.verb, r.object_ref ?? {}),
  }))
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/ && pnpm --filter web exec vitest run src/lib/solar/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar apps/web/src/lib/solar/activity.ts apps/web/src/lib/solar/activity-types.ts apps/web/src/lib/solar/activity.test.ts
git commit -m "feat(solar): audit-event sentences and recent-activity loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Overview — header, KPI empty state, activity

**Files:**
- Create: `.../solar/_components/StudyHeader.tsx`
- Create: `.../solar/_components/OverviewKpis.tsx`, `OverviewKpis.test.tsx`
- Create: `.../solar/_components/ActivityList.tsx`, `ActivityList.test.tsx`
- Replace: `.../solar/(gated)/overview/page.tsx`

- [ ] **Step 1: Write the failing tests**

`.../solar/_components/OverviewKpis.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OverviewKpis } from './OverviewKpis'

describe('OverviewKpis (spec §2.4 empty state + §2.2 case controls)', () => {
  it('View: the empty state only — controls above the level are hidden', () => {
    render(<OverviewKpis projectId="p1" level="view" />)
    expect(screen.getByText('No case has been run yet — start at Site & Supply.')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Go to Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByLabelText('Change selected case')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })

  it('Edit: the selected-case control, disabled with its reason; no report button', () => {
    render(<OverviewKpis projectId="p1" level="edit" />)
    expect((screen.getByLabelText('Change selected case') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('Run a case on Yield & Scenarios first')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })

  it('Edit + financials: the report shortcut too, disabled with its reason', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" />)
    const btn = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('Available once a case has been run')
  })
})
```

`.../solar/_components/ActivityList.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityList } from './ActivityList'

const items = [
  { id: 2, at: '2026-09-28T09:00:00Z', actorName: 'Ann', text: 'Site & Supply saved', target: 'site' as const },
  { id: 1, at: '2026-09-28T08:00:00Z', actorName: 'Ben', text: 'Solar access granted (View)', target: 'access' as const },
]

describe('ActivityList', () => {
  it('empty state', () => {
    render(<ActivityList projectId="p1" items={[]} isGrantor={false} />)
    expect(screen.getByText('No activity yet')).toBeDefined()
  })

  it('links Site & Supply for everyone, the Access panel only for grantors', () => {
    const { rerender } = render(<ActivityList projectId="p1" items={items} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Site & Supply saved' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByRole('link', { name: 'Solar access granted (View)' })).toBeNull()
    expect(screen.getByText('Solar access granted (View)')).toBeDefined()
    rerender(<ActivityList projectId="p1" items={items} isGrantor />)
    expect(screen.getByRole('link', { name: 'Solar access granted (View)' }).getAttribute('href')).toBe('/projects/p1/solar/access')
  })

  it('shows who and when', () => {
    render(<ActivityList projectId="p1" items={items} isGrantor={false} />)
    expect(screen.getByText('28 Sep 2026 · Ann')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.test.tsx" "src/app/(admin)/projects/[id]/solar/_components/ActivityList.test.tsx"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`.../solar/_components/StudyHeader.tsx`:
```tsx
import type { CSSProperties } from 'react'
import { Card, CardBody } from '@/components/ui/Card'

const DT: CSSProperties = { fontSize: 11, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const DD: CSSProperties = { margin: '2px 0 0', fontSize: 13, color: 'var(--c-text)' }

/**
 * Study header (spec §2.1 item 1). The tariff and the selected case are shown
 * "if chosen" — neither can exist in Phase 1 (tariffs: Phase 2, cases: Phase 6),
 * so they are not rendered.
 */
export function StudyHeader({
  projectName,
  address,
  supplyAuthority,
}: {
  projectName: string
  address: string | null
  supplyAuthority: string | null
}) {
  return (
    <Card>
      <CardBody>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: 0 }}>
          <div><dt style={DT}>Project</dt><dd style={DD}>{projectName}</dd></div>
          <div><dt style={DT}>Site address</dt><dd style={DD}>{address ?? 'No address on the project'}</dd></div>
          <div><dt style={DT}>Supply authority</dt><dd style={DD}>{supplyAuthority ?? 'Not set — add it on Site & Supply'}</dd></div>
        </dl>
      </CardBody>
    </Card>
  )
}
```

`.../solar/_components/OverviewKpis.tsx`:
```tsx
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import type { SolarAccessLevel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

/**
 * Headline KPIs of the selected case (spec §2.4) — in Phase 1 no case can
 * exist, so this is the empty state plus the §2.2 case controls in their
 * documented disabled states. Controls above the caller's level are hidden:
 * "Change selected case" needs Edit; "Generate feasibility report" needs Edit
 * AND financials.
 */
export function OverviewKpis({ projectId, level }: { projectId: string; level: SolarAccessLevel }) {
  const canWrite = level === 'edit' || level === 'edit_financials'
  const canMoney = level === 'edit_financials'
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Headline results</span></CardHeader>
      <CardBody>
        <EmptyState
          icon={BarChart3}
          dense
          title="No case has been run yet — start at Site & Supply."
          action={<Link href={`/projects/${projectId}/solar/site`}>Go to Site & Supply</Link>}
        />
        {canWrite && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <label htmlFor="solar-selected-case" style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Change selected case</label>
            <select id="solar-selected-case" disabled>
              <option>No completed runs</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Run a case on Yield & Scenarios first</span>
            {canMoney && (
              <Button type="button" size="sm" variant="secondary" disabled title="Available once a case has been run">
                Generate feasibility report
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
```

`.../solar/_components/ActivityList.tsx`:
```tsx
import Link from 'next/link'
import { formatSolarDate } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import type { SolarActivityItem } from '@/lib/solar/activity-types'

/** Recent activity (spec §2.1 item 4, §2.2 "Activity item"). */
export function ActivityList({ projectId, items, isGrantor }: { projectId: string; items: SolarActivityItem[]; isGrantor: boolean }) {
  const hrefFor = (target: SolarActivityItem['target']): string | null => {
    if (target === 'site') return `/projects/${projectId}/solar/site`
    if (target === 'access' && isGrantor) return `/projects/${projectId}/solar/access`
    return null
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Recent activity</span></CardHeader>
      <CardBody>
        {items.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>No activity yet</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((it) => {
                const href = hrefFor(it.target)
                return (
                  <li key={it.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--c-border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--c-text-dim)', minWidth: 160 }}>{`${formatSolarDate(it.at)} · ${it.actorName}`}</span>
                    {href ? <Link href={href}>{it.text}</Link> : <span>{it.text}</span>}
                  </li>
                )
              })}
            </ul>}
      </CardBody>
    </Card>
  )
}
```

Replace `.../solar/(gated)/overview/page.tsx` entirely:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSolarActivity } from '@/lib/solar/activity'
import { computeSolarReadiness, toSiteReadinessInput } from '@esite/shared'
import { ReadinessChecklist } from '../../_components/ReadinessChecklist'
import { StudyHeader } from '../../_components/StudyHeader'
import { OverviewKpis } from '../../_components/OverviewKpis'
import { ActivityList } from '../../_components/ActivityList'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Overview (spec §2): header · readiness · headline KPIs · recent activity. */
export default async function SolarOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)

  const [{ data: project }, { data: study }, { data: isGrantor }, activity] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, address, city, province').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
    loadSolarActivity(id, supabase),
  ])
  const p = (project ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const licensee = (study as { licensee_name?: string | null } | null)?.licensee_name?.trim() || null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StudyHeader projectName={p.name ?? ''} address={address} supplyAuthority={licensee} />
      <ReadinessChecklist projectId={id} steps={computeSolarReadiness(toSiteReadinessInput(study), level)} />
      <OverviewKpis projectId={id} level={level} />
      <ActivityList projectId={id} items={activity} isGrantor={isGrantor === true} />
    </div>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar" src/lib/solar/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar"
git commit -m "feat(solar): Overview — study header, readiness, KPI empty state, recent activity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared Site & Supply validation

**Files:**
- Create: `packages/shared/src/solar/site-supply.ts`, `packages/shared/src/solar/site-supply.test.ts`
- Modify: `packages/shared/src/solar/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/site-supply.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { EMPTY_SITE_SUPPLY_FORM, validateSiteSupply, siteSupplyFormFromRow, type SiteSupplyForm } from './site-supply'

const form = (patch: Partial<SiteSupplyForm>): SiteSupplyForm => ({ ...EMPTY_SITE_SUPPLY_FORM, ...patch })

describe('validateSiteSupply', () => {
  it('an empty form is valid and saves all NULLs', () => {
    const r = validateSiteSupply(EMPTY_SITE_SUPPLY_FORM)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({
      latitude: null, longitude: null, elevation_m: null, licensee_name: null, supply_type: null,
      nmd_kva: null, supply_voltage_v: null, poc_node_id: null, export_mode: null, export_limit_kw: null,
      constraints_note: null,
    })
  })

  it('parses and rounds numbers (6 dp coordinates, comma decimals accepted)', () => {
    const r = validateSiteSupply(form({ latitude: '-26,1234567', longitude: '28.0473051', nmdKva: '500.456', elevationM: '1753.46' }))
    expect(r.errors).toEqual({})
    expect(r.values).toMatchObject({ latitude: -26.123457, longitude: 28.047305, nmd_kva: 500.46, elevation_m: 1753.5 })
  })

  it('refuses non-numbers and out-of-range coordinates', () => {
    const r = validateSiteSupply(form({ latitude: 'abc', longitude: '200' }))
    expect(r.errors.latitude).toBe('Enter a number')
    expect(r.errors.longitude).toBe('Longitude must be between -180 and 180')
  })

  it('needs both coordinates or neither', () => {
    expect(validateSiteSupply(form({ latitude: '-26' })).errors.longitude).toBe('Enter both latitude and longitude')
    expect(validateSiteSupply(form({ longitude: '28' })).errors.latitude).toBe('Enter both latitude and longitude')
  })

  it('warns — does not block — outside South Africa', () => {
    const r = validateSiteSupply(form({ latitude: '26', longitude: '28' }))
    expect(r.errors).toEqual({})
    expect(r.warnings.latitude).toBe('These coordinates are outside South Africa (latitude -35 to -22, longitude 16 to 33) — check the signs.')
  })

  it('NMD must be positive; voltage must be whole volts', () => {
    const r = validateSiteSupply(form({ nmdKva: '0', supplyVoltageV: '400.5' }))
    expect(r.errors.nmdKva).toBe('NMD must be more than 0 kVA')
    expect(r.errors.supplyVoltageV).toBe('Enter the supply voltage in whole volts')
  })

  it('only known customer types and export modes', () => {
    const r = validateSiteSupply(form({ supplyType: 'bartering', exportMode: 'sometimes' }))
    expect(r.errors.supplyType).toBe('Choose a customer type')
    expect(r.errors.exportMode).toBe('Choose whether export is allowed')
  })

  it('the export limit is kept only when export is allowed', () => {
    expect(validateSiteSupply(form({ exportMode: 'net_billing', exportLimitKw: '90' })).values.export_limit_kw).toBe(90)
    expect(validateSiteSupply(form({ exportMode: 'zero_export', exportLimitKw: '90' })).values.export_limit_kw).toBeNull()
    expect(validateSiteSupply(form({ exportMode: 'no_credit', exportLimitKw: '-1' })).errors.exportLimitKw).toBe('Export limit cannot be negative')
  })

  it('trims text and caps its length', () => {
    expect(validateSiteSupply(form({ licenseeName: '  City Power  ' })).values.licensee_name).toBe('City Power')
    expect(validateSiteSupply(form({ licenseeName: 'x'.repeat(201) })).errors.licenseeName).toBe('Keep the supply authority under 200 characters')
    expect(validateSiteSupply(form({ constraintsNote: 'x'.repeat(5001) })).errors.constraintsNote).toBe('Keep the notes under 5000 characters')
  })

  it('elevation must be plausible', () => {
    expect(validateSiteSupply(form({ elevationM: '12000' })).errors.elevationM).toBe('Elevation must be between -500 m and 9000 m')
  })
})

describe('siteSupplyFormFromRow', () => {
  it('turns a studies row into form strings and NULLs into empty strings', () => {
    expect(siteSupplyFormFromRow({ latitude: -26.1, longitude: '28.05', nmd_kva: '500.00', supply_voltage_v: 400, supply_type: 'municipal', licensee_name: null })).toEqual({
      ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', nmdKva: '500', supplyVoltageV: '400', supplyType: 'municipal',
    })
    expect(siteSupplyFormFromRow(null)).toEqual(EMPTY_SITE_SUPPLY_FORM)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/site-supply.test.ts`
Expected: FAIL — cannot resolve `./site-supply`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/site-supply.ts`:
```ts
/**
 * Site & Supply (spec §3.2) — option lists and validation shared by the form
 * (instant feedback) and saveSolarSiteAction (the real check). Column names
 * and CHECKs come from solar.studies in migration 00208; this module never
 * accepts a value the table would refuse. Warnings never block a save.
 */
import { isInSouthAfrica } from './readiness'

export const SOLAR_SUPPLY_TYPES = [
  { value: 'eskom_direct', label: 'Eskom direct' },
  { value: 'municipal', label: 'Municipal' },
  { value: 'private_resale', label: 'Private (embedded network, e.g. landlord resale)' },
] as const
export type SolarSupplyType = (typeof SOLAR_SUPPLY_TYPES)[number]['value']

export const SOLAR_EXPORT_MODES = [
  { value: 'net_billing', label: 'Yes (net billing)' },
  { value: 'no_credit', label: 'Yes (no credit)' },
  { value: 'zero_export', label: 'No (zero-export controller)' },
] as const
export type SolarExportMode = (typeof SOLAR_EXPORT_MODES)[number]['value']

export const SOLAR_VOLTAGE_PRESETS = [
  { volts: 400, label: 'LV 400 V' },
  { volts: 11000, label: 'MV 11 kV' },
  { volts: 22000, label: 'MV 22 kV' },
] as const

/** Raw form state — every value as typed. */
export interface SiteSupplyForm {
  latitude: string
  longitude: string
  elevationM: string
  licenseeName: string
  supplyType: string
  nmdKva: string
  supplyVoltageV: string
  pocNodeId: string
  exportMode: string
  exportLimitKw: string
  constraintsNote: string
}
export type SiteSupplyField = keyof SiteSupplyForm

/** Exactly the solar.studies columns this tab writes. */
export interface SiteSupplyValues {
  latitude: number | null
  longitude: number | null
  elevation_m: number | null
  licensee_name: string | null
  supply_type: SolarSupplyType | null
  nmd_kva: number | null
  supply_voltage_v: number | null
  poc_node_id: string | null
  export_mode: SolarExportMode | null
  export_limit_kw: number | null
  constraints_note: string | null
}

export interface SiteSupplyCheck {
  values: SiteSupplyValues
  errors: Partial<Record<SiteSupplyField, string>>
  warnings: Partial<Record<SiteSupplyField, string>>
}

export const EMPTY_SITE_SUPPLY_FORM: SiteSupplyForm = {
  latitude: '', longitude: '', elevationM: '', licenseeName: '', supplyType: '', nmdKva: '',
  supplyVoltageV: '', pocNodeId: '', exportMode: '', exportLimitKw: '', constraintsNote: '',
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

function parseNumber(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(',', '.')
  if (!s) return null
  if (!NUMBER.test(s)) return 'invalid'
  return Number(s)
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

const EXPORT_ALLOWED: readonly string[] = ['net_billing', 'no_credit']

export function validateSiteSupply(f: SiteSupplyForm): SiteSupplyCheck {
  const errors: SiteSupplyCheck['errors'] = {}
  const warnings: SiteSupplyCheck['warnings'] = {}
  const num = (field: SiteSupplyField, dp: number): number | null => {
    const v = parseNumber(f[field])
    if (v === 'invalid') { errors[field] = 'Enter a number'; return null }
    return v === null ? null : round(v, dp)
  }

  const latitude = num('latitude', 6)
  const longitude = num('longitude', 6)
  if (latitude !== null && (latitude < -90 || latitude > 90)) errors.latitude = 'Latitude must be between -90 and 90'
  if (longitude !== null && (longitude < -180 || longitude > 180)) errors.longitude = 'Longitude must be between -180 and 180'
  if (!errors.latitude && !errors.longitude) {
    if (latitude !== null && longitude === null) errors.longitude = 'Enter both latitude and longitude'
    if (longitude !== null && latitude === null) errors.latitude = 'Enter both latitude and longitude'
    if (latitude !== null && longitude !== null && !isInSouthAfrica(latitude, longitude)) {
      warnings.latitude = 'These coordinates are outside South Africa (latitude -35 to -22, longitude 16 to 33) — check the signs.'
    }
  }

  const elevation = num('elevationM', 1)
  if (elevation !== null && (elevation < -500 || elevation > 9000)) errors.elevationM = 'Elevation must be between -500 m and 9000 m'

  const licensee = f.licenseeName.trim()
  if (licensee.length > 200) errors.licenseeName = 'Keep the supply authority under 200 characters'

  const supplyType = f.supplyType.trim()
  if (supplyType && !SOLAR_SUPPLY_TYPES.some((t) => t.value === supplyType)) errors.supplyType = 'Choose a customer type'

  const nmd = num('nmdKva', 2)
  if (nmd !== null && nmd <= 0) errors.nmdKva = 'NMD must be more than 0 kVA'
  else if (nmd !== null && nmd > 99_999_999.99) errors.nmdKva = 'That NMD is too large — check the value'

  let voltage: number | null = null
  const rawVoltage = parseNumber(f.supplyVoltageV)
  if (rawVoltage === 'invalid' || (rawVoltage !== null && (!Number.isInteger(rawVoltage) || rawVoltage <= 0 || rawVoltage > 1_000_000))) {
    errors.supplyVoltageV = 'Enter the supply voltage in whole volts'
  } else {
    voltage = rawVoltage
  }

  const exportMode = f.exportMode.trim()
  if (exportMode && !SOLAR_EXPORT_MODES.some((m) => m.value === exportMode)) errors.exportMode = 'Choose whether export is allowed'
  let exportLimit = num('exportLimitKw', 2)
  if (!EXPORT_ALLOWED.includes(exportMode)) {
    exportLimit = null
    delete errors.exportLimitKw
  } else if (exportLimit !== null && exportLimit < 0) {
    errors.exportLimitKw = 'Export limit cannot be negative'
  }

  const note = f.constraintsNote.trim()
  if (note.length > 5000) errors.constraintsNote = 'Keep the notes under 5000 characters'

  return {
    values: {
      latitude: errors.latitude ? null : latitude,
      longitude: errors.longitude ? null : longitude,
      elevation_m: elevation,
      licensee_name: licensee || null,
      supply_type: (supplyType || null) as SolarSupplyType | null,
      nmd_kva: nmd,
      supply_voltage_v: voltage,
      poc_node_id: f.pocNodeId.trim() || null,
      export_mode: (exportMode || null) as SolarExportMode | null,
      export_limit_kw: exportLimit,
      constraints_note: note || null,
    },
    errors,
    warnings,
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    const n = Number(v)
    return v.trim() !== '' && Number.isFinite(n) && /^[-+]?\d/.test(v) ? String(n) : v
  }
  return ''
}

/** A solar.studies row (or null) → form strings. */
export function siteSupplyFormFromRow(row: Record<string, unknown> | null | undefined): SiteSupplyForm {
  if (!row) return { ...EMPTY_SITE_SUPPLY_FORM }
  return {
    latitude: str(row.latitude),
    longitude: str(row.longitude),
    elevationM: str(row.elevation_m),
    licenseeName: typeof row.licensee_name === 'string' ? row.licensee_name : '',
    supplyType: typeof row.supply_type === 'string' ? row.supply_type : '',
    nmdKva: str(row.nmd_kva),
    supplyVoltageV: str(row.supply_voltage_v),
    pocNodeId: typeof row.poc_node_id === 'string' ? row.poc_node_id : '',
    exportMode: typeof row.export_mode === 'string' ? row.export_mode : '',
    exportLimitKw: str(row.export_limit_kw),
    constraintsNote: typeof row.constraints_note === 'string' ? row.constraints_note : '',
  }
}
```

Append to `packages/shared/src/solar/index.ts`:
```ts
export * from './site-supply'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar
git commit -m "feat(solar): Site & Supply validation shared by form and server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `saveSolarSiteAction`

**Files:**
- Create: `apps/web/src/actions/solar-site.actions.ts`, `apps/web/src/actions/solar-site.actions.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-site.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMPTY_SITE_SUPPLY_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveSolarSiteAction } from './solar-site.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = 'p1'
const U = 'user-1'
const STALE = 'Someone else changed this — reload to see their version.'
const form = { ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', licenseeName: 'City Power', nmdKva: '500' }

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('saveSolarSiteAction', () => {
  it('re-checks Edit level itself (a View user is redirected to the locked screen)', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('returns field errors without writing', async () => {
    const { calls } = setup()
    const res = await saveSolarSiteAction({ projectId: P, form: { ...form, latitude: '-95' }, expectedUpdatedAt: null })
    expect(res).toEqual({ fieldErrors: { latitude: 'Latitude must be between -90 and 90' } })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('first save inserts the study and records audit + product event', async () => {
    const { calls } = setup({ writes: { 'solar.studies:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'insert')[0].payload).toMatchObject({
      project_id: P, latitude: -26.1, longitude: 28.05, licensee_name: 'City Power', nmd_kva: 500,
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'site_saved' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_site_saved' })
    expect(h.revalidate).toHaveBeenCalledWith(`/projects/${P}/solar`, 'layout')
  })

  it('a second first-save (someone created the study meanwhile) is stale', async () => {
    setup({ writes: { 'solar.studies:insert': { error: { code: '23505', message: 'duplicate key' } } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: null })).resolves.toEqual({ error: STALE })
  })

  it('later saves update only if updated_at still matches', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: 'T1' })).resolves.toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(calls, 'solar.studies', 'update')[0].filters).toEqual(expect.arrayContaining([['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
  })

  it('0 rows updated → stale, nothing recorded', async () => {
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    await expect(saveSolarSiteAction({ projectId: P, form, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('a point-of-connection board from another project is a sentence, not a raw error', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'solar.studies: point-of-connection node belongs to another project' } } } })
    await expect(saveSolarSiteAction({ projectId: P, form: { ...form, pocNodeId: 'n-x' }, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'That board belongs to another project.' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/solar-site.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-site.actions`.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-site.actions.ts`:
```ts
'use server'
/**
 * Save Site & Supply (spec §3.2). Re-checks Edit level itself
 * (requireSolarLevel redirects a lower level to /solar/locked), validates with
 * the same rules as the form, and writes through the caller's session so
 * 00208's studies_*_authz RESTRICTIVE policies and studies_bind (org binding,
 * PoC node must belong to this project, attribution) decide. First save
 * inserts; later saves are conditioned on the updated_at the user loaded.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { validateSiteSupply, type SiteSupplyField, type SiteSupplyForm } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SaveSiteResult =
  | { ok: true; updatedAt: string }
  | { error: string }
  | { fieldErrors: Partial<Record<SiteSupplyField, string>> }

export async function saveSolarSiteAction(input: {
  projectId: string
  form: SiteSupplyForm
  expectedUpdatedAt: string | null
}): Promise<SaveSiteResult> {
  const { projectId, expectedUpdatedAt } = input
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const check = validateSiteSupply(input.form)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }

  const studies = () => supabase.schema('solar').from('studies')
  let updatedAt: string | undefined
  if (expectedUpdatedAt === null) {
    const { data, error } = await studies().insert({ project_id: projectId, ...check.values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined
  } else {
    const { data, error } = await studies().update(check.values)
      .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = data[0]?.updated_at as string | undefined
  }

  await recordSolarAudit({ projectId, actorId: user.id, verb: 'site_saved' })
  await emitProductEvent({ actorId: user.id, projectId, event: 'solar_site_saved' })
  revalidatePath(`/projects/${projectId}/solar`, 'layout')
  return { ok: true, updatedAt: updatedAt ?? '' }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/solar-site.actions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-site.actions.ts apps/web/src/actions/solar-site.actions.test.ts
git commit -m "feat(solar): saveSolarSiteAction — level re-check, validation, stale-write refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Site & Supply page and form

**Files:**
- Create: `.../solar/(gated)/site/page.tsx`
- Create: `.../solar/(gated)/site/SiteSupplyForm.tsx`, `SiteSupplyForm.test.tsx`

- [ ] **Step 1: Write the failing test**

`.../solar/(gated)/site/SiteSupplyForm.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_SITE_SUPPLY_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-site.actions', () => ({ saveSolarSiteAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))

import { SiteSupplyForm, type SiteSupplyFormProps } from './SiteSupplyForm'
import { isSolarDirty, setSolarDirty } from '@/lib/solar/dirty-store'

const props: SiteSupplyFormProps = {
  projectId: 'p1',
  initialForm: { ...EMPTY_SITE_SUPPLY_FORM },
  updatedAt: null,
  canEdit: true,
  address: '1 Main Rd, Pretoria, Gauteng',
  nodes: [
    { id: 'n1', label: 'MB-1 — Main board', kind: 'main_board', ratingKva: 1000 },
    { id: 'n2', label: 'RMU-1', kind: 'rmu', ratingKva: null },
  ],
  nmdPrefill: { value: '1000', from: 'MB-1 — Main board' },
}

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })
afterEach(() => { setSolarDirty(false) })

describe('SiteSupplyForm', () => {
  it('shows the project address read-only with a link to project settings', () => {
    render(<SiteSupplyForm {...props} />)
    expect(screen.getByText('1 Main Rd, Pretoria, Gauteng')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Edit in project settings' }).getAttribute('href')).toBe('/projects/p1/settings/site')
  })

  it('pre-fills NMD from the main incomer and says where it came from', () => {
    render(<SiteSupplyForm {...props} />)
    expect((screen.getByLabelText('Notified maximum demand (NMD, kVA)') as HTMLInputElement).value).toBe('1000')
    expect(screen.getByText('Pre-filled from MB-1 — Main board')).toBeDefined()
  })

  it('an invalid latitude shows the error and does not call the server', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.type(screen.getByLabelText('Latitude'), '-95')
    await user.type(screen.getByLabelText('Longitude'), '28')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Latitude must be between -90 and 90')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('outside South Africa warns but still saves', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.type(screen.getByLabelText('Latitude'), '26')
    await user.type(screen.getByLabelText('Longitude'), '28')
    expect(screen.getByText(/outside South Africa/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', expectedUpdatedAt: null,
      form: expect.objectContaining({ latitude: '26', longitude: '28', nmdKva: '1000' }),
    }))
    expect(await screen.findByText('Saved')).toBeDefined()
    expect(h.refresh).toHaveBeenCalled()
  })

  it('sends the new updated_at on the next save', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    await user.type(screen.getByLabelText('Supply authority'), 'City Power')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' }))
  })

  it('shows the stale sentence', async () => {
    h.save.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<SiteSupplyForm {...props} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Someone else changed this — reload to see their version.')).toBeDefined()
  })

  it('export limit appears only when export is allowed', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    expect(screen.queryByLabelText('Export limit (kW)')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Export allowed?'), 'net_billing')
    expect(screen.getByLabelText('Export limit (kW)')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Export allowed?'), 'zero_export')
    expect(screen.queryByLabelText('Export limit (kW)')).toBeNull()
  })

  it('supply voltage "Other" reveals a volts input', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.selectOptions(screen.getByLabelText('Supply voltage'), 'other')
    await user.type(screen.getByLabelText('Supply voltage (V)'), '6600')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ form: expect.objectContaining({ supplyVoltageV: '6600' }) }))
  })

  it('picking the point of connection shows that board’s rating', async () => {
    const user = userEvent.setup()
    render(<SiteSupplyForm {...props} />)
    await user.selectOptions(screen.getByLabelText('Point of connection'), 'n1')
    expect(screen.getByText('Transformer / mini-sub rating: 1000 kVA')).toBeDefined()
  })

  it('editing marks the page dirty for the tab bar guard', async () => {
    render(<SiteSupplyForm {...props} />)
    expect(isSolarDirty()).toBe(false)
    await userEvent.setup().type(screen.getByLabelText('Supply authority'), 'X')
    expect(isSolarDirty()).toBe(true)
  })

  it('View level: values as text, no inputs, no Save', () => {
    render(<SiteSupplyForm {...props} canEdit={false} initialForm={{ ...EMPTY_SITE_SUPPLY_FORM, latitude: '-26.1', longitude: '28.05', licenseeName: 'City Power' }} />)
    expect(screen.getByText('City Power')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByLabelText('Latitude')).toBeNull()
  })

  it('marks roof sources and solar resource as coming in a later phase', () => {
    render(<SiteSupplyForm {...props} />)
    expect(screen.getByText('Roof sources — coming in a later phase')).toBeDefined()
    expect(screen.getByText('Solar resource — coming in a later phase')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/site"`
Expected: FAIL — cannot resolve `./SiteSupplyForm`.

- [ ] **Step 3: Implement the form**

`.../solar/(gated)/site/SiteSupplyForm.tsx`:
```tsx
'use client'
/**
 * Site & Supply (spec §3). Sections A Location · B Supply authority &
 * connection · C Roof sources (Phase 5) · D Site constraints · E Solar
 * resource (Phase 4). Not in Phase 1C: "Locate from address" (geocoding,
 * D-08), the map pin (no map component exists), roof sources / satellite /
 * calibration, the solar-resource fetch. The supply authority is free text
 * (licensee_name) until the Phase 2 tariff library replaces it with a select.
 * Saves explicitly (no auto-save); unsaved edits arm the tab-bar guard and
 * the browser's beforeunload prompt.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SOLAR_EXPORT_MODES, SOLAR_SUPPLY_TYPES, SOLAR_VOLTAGE_PRESETS, validateSiteSupply,
  type SiteSupplyField, type SiteSupplyForm as SiteForm,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput, Textarea } from '@/components/ui/FormField'
import { saveSolarSiteAction } from '@/actions/solar-site.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'

export interface SiteNode {
  id: string
  label: string
  kind: string
  ratingKva: number | null
}

export interface SiteSupplyFormProps {
  projectId: string
  initialForm: SiteForm
  updatedAt: string | null
  canEdit: boolean
  address: string | null
  nodes: SiteNode[]
  /** NMD proposed from the main incomer's rating when the study has none. */
  nmdPrefill: { value: string; from: string } | null
}

const PRESET_VALUES = SOLAR_VOLTAGE_PRESETS.map((p) => String(p.volts))
const EXPORT_ALLOWED = ['net_billing', 'no_credit']
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }
const WARN: CSSProperties = { fontSize: 11, color: 'var(--c-amber)', margin: '4px 0 0' }
const HINT: CSSProperties = { fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }

function labelOf(list: ReadonlyArray<{ value: string; label: string }>, v: string): string {
  return list.find((o) => o.value === v)?.label ?? '—'
}

export function SiteSupplyForm(p: SiteSupplyFormProps) {
  const router = useRouter()
  const start = useMemo<SiteForm>(
    () => (p.nmdPrefill && !p.initialForm.nmdKva ? { ...p.initialForm, nmdKva: p.nmdPrefill.value } : p.initialForm),
    [p.initialForm, p.nmdPrefill],
  )
  const [baseline, setBaseline] = useState<SiteForm>(start)
  const [form, setForm] = useState<SiteForm>(start)
  const [token, setToken] = useState<string | null>(p.updatedAt)
  const [voltageChoice, setVoltageChoice] = useState<string>(
    start.supplyVoltageV === '' ? '' : PRESET_VALUES.includes(start.supplyVoltageV) ? start.supplyVoltageV : 'other',
  )
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<SiteSupplyField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = validateSiteSupply(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  useSolarDirtyGuard(p.canEdit && dirty)
  const errorOf = (f: SiteSupplyField) => serverErrors[f] ?? (showErrors ? check.errors[f] : undefined)
  const set = (f: SiteSupplyField) => (value: string) => {
    setForm((prev) => ({ ...prev, [f]: value }))
    setServerErrors((prev) => ({ ...prev, [f]: undefined }))
    setMessage(null)
  }
  const poc = p.nodes.find((n) => n.id === form.pocNodeId)
  const exportAllowed = EXPORT_ALLOWED.includes(form.exportMode)

  async function save() {
    setShowErrors(true)
    setError(null)
    setMessage(null)
    if (Object.keys(check.errors).length > 0) return
    setBusy(true)
    const res = await saveSolarSiteAction({ projectId: p.projectId, form, expectedUpdatedAt: token })
    setBusy(false)
    if ('fieldErrors' in res) { setServerErrors(res.fieldErrors); return }
    if ('error' in res) { setError(res.error); return }
    setToken(res.updatedAt)
    setBaseline(form)
    setShowErrors(false)
    setMessage('Saved')
    router.refresh()
  }

  const later = (title: string, body: string) => (
    <Card>
      <CardHeader><span className="data-panel-title">{title}</span></CardHeader>
      <CardBody><p style={{ ...HINT, margin: 0, fontSize: 13 }}>{body}</p></CardBody>
    </Card>
  )

  if (!p.canEdit) {
    const v = (s: string, unit = '') => (s ? `${s}${unit}` : '—')
    const row = (label: string, value: string) => (
      <div><dt style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{label}</dt><dd style={{ margin: '2px 0 0', fontSize: 13 }}>{value}</dd></div>
    )
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Card>
          <CardHeader><span className="data-panel-title">Location and supply</span></CardHeader>
          <CardBody>
            <dl style={{ ...GRID, margin: 0 }}>
              {row('Address', p.address ?? 'No address on the project')}
              {row('Latitude', v(form.latitude))}
              {row('Longitude', v(form.longitude))}
              {row('Elevation', v(form.elevationM, ' m'))}
              {row('Supply authority', v(form.licenseeName))}
              {row('Customer type', form.supplyType ? labelOf(SOLAR_SUPPLY_TYPES, form.supplyType) : '—')}
              {row('NMD', v(form.nmdKva, ' kVA'))}
              {row('Supply voltage', v(form.supplyVoltageV, ' V'))}
              {row('Point of connection', poc?.label ?? '—')}
              {row('Export allowed?', form.exportMode ? labelOf(SOLAR_EXPORT_MODES, form.exportMode) : '—')}
              {exportAllowed && row('Export limit', v(form.exportLimitKw, ' kW'))}
              {row('Site constraints', v(form.constraintsNote))}
            </dl>
          </CardBody>
        </Card>
        {later('Roof sources — coming in a later phase', 'Roof plans from the project drawings, scale calibration and a satellite capture arrive with the PV layout tool.')}
        {later('Solar resource — coming in a later phase', 'Long-term irradiation for the site (Global Solar Atlas and PVGIS) arrives with the yield model.')}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">A. Location</span></CardHeader>
        <CardBody>
          <div style={{ marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Address</div>
            <span>{p.address ?? 'No address on the project'}</span>{' '}
            <Link href={`/projects/${p.projectId}/settings/site`} style={{ fontSize: 12 }}>Edit in project settings</Link>
          </div>
          <div style={GRID}>
            <div>
              <FormField label="Latitude" htmlFor="solar-lat" error={errorOf('latitude')}>
                <TextInput id="solar-lat" inputMode="decimal" value={form.latitude} onChange={(e) => set('latitude')(e.target.value)} invalid={Boolean(errorOf('latitude'))} />
              </FormField>
              {check.warnings.latitude && <p role="status" style={WARN}>{check.warnings.latitude}</p>}
            </div>
            <FormField label="Longitude" htmlFor="solar-lng" error={errorOf('longitude')}>
              <TextInput id="solar-lng" inputMode="decimal" value={form.longitude} onChange={(e) => set('longitude')(e.target.value)} invalid={Boolean(errorOf('longitude'))} />
            </FormField>
            <FormField label="Elevation (m)" htmlFor="solar-elev" error={errorOf('elevationM')} hint="Used by the weather and temperature model">
              <TextInput id="solar-elev" inputMode="decimal" value={form.elevationM} onChange={(e) => set('elevationM')(e.target.value)} />
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">B. Supply authority and connection</span></CardHeader>
        <CardBody>
          <div style={GRID}>
            <FormField label="Supply authority" htmlFor="solar-licensee" error={errorOf('licenseeName')} hint="Eskom or the municipality that bills the site">
              <TextInput id="solar-licensee" value={form.licenseeName} maxLength={200} onChange={(e) => set('licenseeName')(e.target.value)} />
            </FormField>
            <div>
              <FormField label="Customer type" htmlFor="solar-supply-type" error={errorOf('supplyType')}>
                <Select id="solar-supply-type" value={form.supplyType} onChange={(e) => set('supplyType')(e.target.value)}>
                  <option value="">Choose…</option>
                  {SOLAR_SUPPLY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </FormField>
              {form.supplyType === 'private_resale' && (
                <p style={HINT}>Resale tariff basis is set with the tariff library in a later phase.</p>
              )}
            </div>
            <div>
              <FormField label="Notified maximum demand (NMD, kVA)" htmlFor="solar-nmd" error={errorOf('nmdKva')}>
                <TextInput id="solar-nmd" inputMode="decimal" value={form.nmdKva} onChange={(e) => set('nmdKva')(e.target.value)} invalid={Boolean(errorOf('nmdKva'))} />
              </FormField>
              {p.nmdPrefill && form.nmdKva === p.nmdPrefill.value && !p.initialForm.nmdKva && (
                <p style={HINT}>Pre-filled from {p.nmdPrefill.from}</p>
              )}
            </div>
            <div>
              <FormField label="Supply voltage" htmlFor="solar-voltage" error={voltageChoice === 'other' ? undefined : errorOf('supplyVoltageV')}>
                <Select
                  id="solar-voltage"
                  value={voltageChoice}
                  onChange={(e) => {
                    const v = e.target.value
                    setVoltageChoice(v)
                    set('supplyVoltageV')(v === 'other' ? (PRESET_VALUES.includes(form.supplyVoltageV) ? '' : form.supplyVoltageV) : v)
                  }}
                >
                  <option value="">Choose…</option>
                  {SOLAR_VOLTAGE_PRESETS.map((v) => <option key={v.volts} value={String(v.volts)}>{v.label}</option>)}
                  <option value="other">Other (V)</option>
                </Select>
              </FormField>
              {voltageChoice === 'other' && (
                <div style={{ marginTop: 8 }}>
                  <FormField label="Supply voltage (V)" htmlFor="solar-voltage-other" error={errorOf('supplyVoltageV')}>
                    <TextInput id="solar-voltage-other" inputMode="numeric" value={form.supplyVoltageV} onChange={(e) => set('supplyVoltageV')(e.target.value)} />
                  </FormField>
                </div>
              )}
            </div>
            <div>
              <FormField label="Point of connection" htmlFor="solar-poc" error={errorOf('pocNodeId')} hint={p.nodes.length === 0 ? 'No main boards, mini-subs or RMUs on this project yet' : undefined}>
                <Select id="solar-poc" value={form.pocNodeId} onChange={(e) => set('pocNodeId')(e.target.value)}>
                  <option value="">Not chosen</option>
                  {p.nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.ratingKva !== null ? `${n.label} (${n.ratingKva} kVA)` : n.label}</option>
                  ))}
                </Select>
              </FormField>
              <p style={HINT}>{`Transformer / mini-sub rating: ${poc?.ratingKva != null ? `${poc.ratingKva} kVA` : '—'}`}</p>
            </div>
            <FormField label="Export allowed?" htmlFor="solar-export" error={errorOf('exportMode')}>
              <Select id="solar-export" value={form.exportMode} onChange={(e) => set('exportMode')(e.target.value)}>
                <option value="">Choose…</option>
                {SOLAR_EXPORT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </FormField>
            {exportAllowed && (
              <FormField label="Export limit (kW)" htmlFor="solar-export-limit" error={errorOf('exportLimitKw')}>
                <TextInput id="solar-export-limit" inputMode="decimal" value={form.exportLimitKw} onChange={(e) => set('exportLimitKw')(e.target.value)} />
              </FormField>
            )}
          </div>
        </CardBody>
      </Card>

      {later('Roof sources — coming in a later phase', 'Roof plans from the project drawings, scale calibration and a satellite capture arrive with the PV layout tool.')}

      <Card>
        <CardHeader><span className="data-panel-title">D. Site constraints</span></CardHeader>
        <CardBody>
          <FormField label="Site constraints notes" htmlFor="solar-constraints" error={errorOf('constraintsNote')} hint="Shading objects, structural limits, access — printed in the report appendix">
            <Textarea id="solar-constraints" rows={4} maxLength={5000} value={form.constraintsNote} onChange={(e) => set('constraintsNote')(e.target.value)} />
          </FormField>
        </CardBody>
      </Card>

      {later('Solar resource — coming in a later phase', 'Long-term irradiation for the site (Global Solar Atlas and PVGIS) arrives with the yield model.')}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="button" onClick={() => void save()} isLoading={busy}>Save</Button>
        {message && <span role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{message}</span>}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
      </div>
    </div>
  )
}
```

(`Select` and `Textarea` in `apps/web/src/components/ui/FormField.tsx:107-150` spread `...rest` onto the native element, so `id`, `value`, `onChange`, `rows` and `maxLength` reach it — `getByLabelText` works through `FormField`'s `htmlFor`.)

- [ ] **Step 4: Implement the page**

`.../solar/(gated)/site/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { siteSupplyFormFromRow } from '@esite/shared'
import { SiteSupplyForm, type SiteNode } from './SiteSupplyForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const STUDY_COLUMNS =
  'latitude, longitude, elevation_m, licensee_name, supply_type, nmd_kva, supply_voltage_v, poc_node_id, export_mode, export_limit_kw, constraints_note, updated_at'
const POC_KINDS = ['main_board', 'mini_sub', 'rmu']
const INCOMER_KINDS = ['main_board', 'mini_sub']

/** Site & Supply (spec §3). View level renders read-only; Edit and above can save. */
export default async function SolarSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)

  const [{ data: project }, { data: study }, { data: nodeRows }] = await Promise.all([
    supabase.schema('projects').from('projects').select('address, city, province').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select(STUDY_COLUMNS).eq('project_id', id).maybeSingle(),
    supabase.schema('structure').from('nodes').select('id, code, name, kind, rating_kva')
      .eq('project_id', id).eq('status', 'active').in('kind', POC_KINDS).order('code'),
  ])

  const p = (project ?? {}) as { address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const nodes: SiteNode[] = ((nodeRows ?? []) as Array<{ id: string; code: string; name: string | null; kind: string; rating_kva: number | string | null }>)
    .map((n) => {
      const rating = n.rating_kva === null || n.rating_kva === '' ? null : Number(n.rating_kva)
      return {
        id: n.id,
        label: n.name ? `${n.code} — ${n.name}` : n.code,
        kind: n.kind,
        ratingKva: rating !== null && Number.isFinite(rating) ? rating : null,
      }
    })
  const s = study as Record<string, unknown> | null
  const incomer = s?.nmd_kva == null ? nodes.find((n) => INCOMER_KINDS.includes(n.kind) && n.ratingKva !== null) : undefined

  return (
    <SiteSupplyForm
      projectId={id}
      initialForm={siteSupplyFormFromRow(s)}
      updatedAt={(s?.updated_at as string | undefined) ?? null}
      canEdit={level !== 'view'}
      address={address}
      nodes={nodes}
      nmdPrefill={incomer ? { value: String(incomer.ratingKva), from: incomer.label } : null}
    />
  )
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar"`
Expected: PASS (SiteSupplyForm 12 tests plus everything from 1C-i).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site"
git commit -m "feat(solar): Site & Supply tab — location, supply & connection, constraints; later phases marked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shared org-settings defaults and validation

**Files:**
- Create: `packages/shared/src/solar/org-settings.ts`, `packages/shared/src/solar/org-settings.test.ts`
- Modify: `packages/shared/src/solar/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/org-settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  SOLAR_SETTING_FIELDS, SOLAR_ORG_SETTINGS_VERSION, solarOrgSettingDefaults, readSolarOrgSettings,
  solarSettingsToForm, validateSolarOrgSettings,
} from './org-settings'

describe('Solar org settings', () => {
  it('seeds the decided defaults (D-05, D-07, D-16 and the engine defaults table)', () => {
    const d = solarOrgSettingDefaults()
    expect(d).toMatchObject({
      discount_rate_pct: 11, cpi_pct: 5, escalation_start_pct: 9, escalation_year10_pct: 7,
      escalation_after_cpi_plus_pct: 1, analysis_years: 25, section_12b_default: false, tax_rate_pct: null,
      om_r_per_kwp_yr: 150, insurance_pct_of_capex: 0.5,
      inverter_replacement_year: 12, inverter_replacement_pct: 60, battery_replacement_year: 10, battery_replacement_pct: 50,
      soiling_pct: 2, mismatch_pct: 1, dc_wiring_pct: 1.5, ac_wiring_pct: 1, lid_pct: 1.5, availability_pct: 99,
      albedo: 0.2, degradation_first_year_pct: 2, degradation_annual_pct: 0.5,
    })
    expect(SOLAR_ORG_SETTINGS_VERSION).toBe(1)
    expect(new Set(SOLAR_SETTING_FIELDS.map((f) => f.key)).size).toBe(SOLAR_SETTING_FIELDS.length)
  })

  it('reads stored values over the defaults and ignores junk', () => {
    const v = readSolarOrgSettings({ version: 1, values: { discount_rate_pct: 12, cpi_pct: 'x', unknown_key: 5, section_12b_default: true, tax_rate_pct: 27 } })
    expect(v.discount_rate_pct).toBe(12)
    expect(v.cpi_pct).toBe(5)
    expect(v.section_12b_default).toBe(true)
    expect(v.tax_rate_pct).toBe(27)
    expect('unknown_key' in v).toBe(false)
    expect(readSolarOrgSettings(null)).toEqual(solarOrgSettingDefaults())
  })

  it('round-trips through form strings', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    expect(form.discount_rate_pct).toBe('11')
    expect(form.tax_rate_pct).toBe('')
    expect(form.section_12b_default).toBe(false)
    expect(validateSolarOrgSettings(form)).toEqual({ values: solarOrgSettingDefaults(), errors: {} })
  })

  it('refuses non-numbers, out-of-range values and unknown keys', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    const r = validateSolarOrgSettings({ ...form, discount_rate_pct: 'lots', availability_pct: '101', albedo: '0,25', bogus: '1' })
    expect(r.errors.discount_rate_pct).toBe('Enter a number')
    expect(r.errors.availability_pct).toBe('Must be between 50 and 100 %')
    expect(r.errors.bogus).toBe('Unknown setting')
    expect(r.values.albedo).toBe(0.25)
  })

  it('an emptied field is saved as not set (null)', () => {
    const form = solarSettingsToForm(solarOrgSettingDefaults())
    expect(validateSolarOrgSettings({ ...form, om_r_per_kwp_yr: '' }).values.om_r_per_kwp_yr).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/org-settings.test.ts`
Expected: FAIL — cannot resolve `./org-settings`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/org-settings.ts`:
```ts
/**
 * Solar org defaults (spec §11) — the skeleton: Finance, Opex and Loss
 * defaults, seeded with the decided values (D-05 insurance, D-07 finance/O&M,
 * D-16 12B off; engine spec defaults table for losses and replacements).
 * Stored in solar.org_settings.settings as { version, values } (00209). A
 * case copies these at creation, so later edits never alter past results.
 * Rate card, load densities, equipment catalogue and report branding arrive
 * with the phases that use them.
 */
export type SolarSettingSection = 'finance' | 'opex' | 'losses'

export interface SolarSettingField {
  key: string
  section: SolarSettingSection
  label: string
  unit: string
  kind: 'number' | 'boolean'
  min?: number
  max?: number
  defaultValue: number | boolean | null
  /** Decision reference shown as a hint. */
  source?: string
}

export const SOLAR_ORG_SETTINGS_VERSION = 1

export const SOLAR_SETTING_SECTIONS: ReadonlyArray<{ key: SolarSettingSection; title: string }> = [
  { key: 'finance', title: 'Finance defaults' },
  { key: 'opex', title: 'Opex defaults' },
  { key: 'losses', title: 'Loss defaults' },
]

export const SOLAR_SETTING_FIELDS: readonly SolarSettingField[] = [
  { key: 'discount_rate_pct', section: 'finance', label: 'Discount rate', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 11, source: 'D-07' },
  { key: 'cpi_pct', section: 'finance', label: 'CPI', unit: '%', kind: 'number', min: 0, max: 30, defaultValue: 5, source: 'D-07' },
  { key: 'escalation_start_pct', section: 'finance', label: 'Tariff escalation beyond published years (year 1)', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 9, source: 'D-07' },
  { key: 'escalation_year10_pct', section: 'finance', label: 'Tariff escalation at year 10 (linear from year 1)', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 7, source: 'D-07' },
  { key: 'escalation_after_cpi_plus_pct', section: 'finance', label: 'Tariff escalation after year 10 (CPI plus)', unit: '%', kind: 'number', min: -5, max: 20, defaultValue: 1, source: 'D-07' },
  { key: 'analysis_years', section: 'finance', label: 'Analysis period', unit: 'years', kind: 'number', min: 1, max: 40, defaultValue: 25, source: 'D-07' },
  { key: 'tax_rate_pct', section: 'finance', label: 'Company tax rate', unit: '%', kind: 'number', min: 0, max: 60, defaultValue: null },
  { key: 'section_12b_default', section: 'finance', label: 'Section 12B allowance on by default', unit: '', kind: 'boolean', defaultValue: false, source: 'D-16' },
  { key: 'om_r_per_kwp_yr', section: 'opex', label: 'O&M', unit: 'R/kWp/yr', kind: 'number', min: 0, max: 10000, defaultValue: 150, source: 'D-07' },
  { key: 'insurance_pct_of_capex', section: 'opex', label: 'Insurance (annual, of capex)', unit: '%', kind: 'number', min: 0, max: 10, defaultValue: 0.5, source: 'D-05' },
  { key: 'monitoring_r_per_yr', section: 'opex', label: 'Monitoring', unit: 'R/yr', kind: 'number', min: 0, max: 10_000_000, defaultValue: null },
  { key: 'inverter_replacement_year', section: 'opex', label: 'Inverter replacement year', unit: 'year', kind: 'number', min: 1, max: 40, defaultValue: 12 },
  { key: 'inverter_replacement_pct', section: 'opex', label: 'Inverter replacement cost (of inverter capex)', unit: '%', kind: 'number', min: 0, max: 200, defaultValue: 60 },
  { key: 'battery_replacement_year', section: 'opex', label: 'Battery replacement year', unit: 'year', kind: 'number', min: 1, max: 40, defaultValue: 10 },
  { key: 'battery_replacement_pct', section: 'opex', label: 'Battery replacement cost (of battery capex)', unit: '%', kind: 'number', min: 0, max: 200, defaultValue: 50 },
  { key: 'soiling_pct', section: 'losses', label: 'Soiling', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 2 },
  { key: 'mismatch_pct', section: 'losses', label: 'Mismatch', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1 },
  { key: 'dc_wiring_pct', section: 'losses', label: 'DC wiring', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1.5 },
  { key: 'ac_wiring_pct', section: 'losses', label: 'AC wiring', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1 },
  { key: 'lid_pct', section: 'losses', label: 'LID / LeTID', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1.5 },
  { key: 'availability_pct', section: 'losses', label: 'Availability', unit: '%', kind: 'number', min: 50, max: 100, defaultValue: 99 },
  { key: 'albedo', section: 'losses', label: 'Albedo', unit: '', kind: 'number', min: 0, max: 1, defaultValue: 0.2 },
  { key: 'degradation_first_year_pct', section: 'losses', label: 'First-year degradation', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 2 },
  { key: 'degradation_annual_pct', section: 'losses', label: 'Annual degradation', unit: '%/yr', kind: 'number', min: 0, max: 5, defaultValue: 0.5 },
]

export type SolarOrgSettingValues = Record<string, number | boolean | null>
export type SolarOrgSettingForm = Record<string, string | boolean>

const BY_KEY = new Map(SOLAR_SETTING_FIELDS.map((f) => [f.key, f]))
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

export function solarOrgSettingDefaults(): SolarOrgSettingValues {
  return Object.fromEntries(SOLAR_SETTING_FIELDS.map((f) => [f.key, f.defaultValue]))
}

/** Stored JSON (or null) → values; anything of the wrong type falls back to the default. */
export function readSolarOrgSettings(stored: unknown): SolarOrgSettingValues {
  const out = solarOrgSettingDefaults()
  const values = (stored && typeof stored === 'object' ? (stored as { values?: unknown }).values : null) as Record<string, unknown> | null
  if (!values || typeof values !== 'object') return out
  for (const f of SOLAR_SETTING_FIELDS) {
    const v = values[f.key]
    if (f.kind === 'boolean' && typeof v === 'boolean') out[f.key] = v
    if (f.kind === 'number' && (v === null || (typeof v === 'number' && Number.isFinite(v)))) out[f.key] = v
  }
  return out
}

export function solarSettingsToForm(values: SolarOrgSettingValues): SolarOrgSettingForm {
  return Object.fromEntries(SOLAR_SETTING_FIELDS.map((f) => {
    const v = values[f.key]
    if (f.kind === 'boolean') return [f.key, v === true]
    return [f.key, typeof v === 'number' ? String(v) : '']
  }))
}

export function validateSolarOrgSettings(form: SolarOrgSettingForm): { values: SolarOrgSettingValues; errors: Record<string, string> } {
  const values: SolarOrgSettingValues = {}
  const errors: Record<string, string> = {}
  for (const key of Object.keys(form)) {
    if (!BY_KEY.has(key)) errors[key] = 'Unknown setting'
  }
  for (const f of SOLAR_SETTING_FIELDS) {
    const raw = form[f.key]
    if (f.kind === 'boolean') { values[f.key] = raw === true; continue }
    const s = String(raw ?? '').trim().replace(',', '.')
    if (s === '') { values[f.key] = null; continue }
    if (!NUMBER.test(s)) { errors[f.key] = 'Enter a number'; continue }
    const n = Number(s)
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
      errors[f.key] = `Must be between ${f.min} and ${f.max} ${f.unit}`.trim()
      continue
    }
    values[f.key] = n
  }
  return { values, errors }
}
```

Append to `packages/shared/src/solar/index.ts`:
```ts
export * from './org-settings'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar
git commit -m "feat(solar): org-defaults skeleton — finance, opex and loss defaults seeded from D-05/D-07/D-16

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `saveSolarOrgSettingsAction`

**Files:**
- Create: `apps/web/src/actions/solar-settings.actions.ts`, `apps/web/src/actions/solar-settings.actions.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-settings.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { solarOrgSettingDefaults, solarSettingsToForm } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  getOrgContext: vi.fn(),
  requireRole: vi.fn(),
  emit: vi.fn(async () => {}),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.getOrgContext }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveSolarOrgSettingsAction } from './solar-settings.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const ORG = 'org-1'
const U = 'admin-1'
const STALE = 'Someone else changed this — reload to see their version.'
const form = solarSettingsToForm(solarOrgSettingDefaults())

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getOrgContext.mockResolvedValue({ userId: U, organisationId: ORG, role: 'admin' })
  h.requireRole.mockResolvedValue({ ok: true, role: 'admin' })
})

describe('saveSolarOrgSettingsAction', () => {
  it('re-checks owner/admin on the active org (requireRole returns an object — test .ok)', async () => {
    const { calls } = setup()
    h.requireRole.mockResolvedValueOnce({ ok: false, error: 'nope' })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change Solar defaults.' })
    expect(h.requireRole).toHaveBeenCalledWith(expect.anything(), ORG, ['owner', 'admin'])
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('returns field errors without writing', async () => {
    setup()
    await expect(saveSolarOrgSettingsAction({ form: { ...form, cpi_pct: 'x' }, expectedUpdatedAt: null }))
      .resolves.toEqual({ fieldErrors: { cpi_pct: 'Enter a number' } })
  })

  it('first save inserts { version, values } for the active org', async () => {
    const { calls } = setup({ writes: { 'solar.org_settings:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.org_settings', 'insert')[0].payload).toEqual({
      organisation_id: ORG, version: 1, settings: { version: 1, values: solarOrgSettingDefaults() },
    })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: null, organisationId: ORG, event: 'solar_settings_saved' })
    expect(h.revalidate).toHaveBeenCalledWith('/settings/solar')
  })

  it('later saves are conditioned on updated_at; 0 rows → stale', async () => {
    const { calls } = setup({ writes: { 'solar.org_settings:update': { data: [] } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.org_settings', 'update')[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'organisation_id', ORG], ['eq', 'updated_at', 'T0'],
    ]))
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('a concurrent first save is stale', async () => {
    setup({ writes: { 'solar.org_settings:insert': { error: { code: '23505', message: 'duplicate' } } } })
    await expect(saveSolarOrgSettingsAction({ form, expectedUpdatedAt: null })).resolves.toEqual({ error: STALE })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/solar-settings.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-settings.actions`.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-settings.actions.ts`:
```ts
'use server'
/**
 * Save the active organisation's Solar defaults (spec §11). Re-checks
 * owner/admin of THAT org with requireRole (never the page gate; note it
 * returns an object — `.ok`). Writes through the caller's session, so
 * 00209's org_settings policies (owner/admin of the row's org) and bind
 * trigger (org immutable, updated_by bound) decide. Stale-guarded.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import {
  OWNER_ADMIN, SOLAR_ORG_SETTINGS_VERSION, validateSolarOrgSettings, type SolarOrgSettingForm,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SaveSolarSettingsResult =
  | { ok: true; updatedAt: string }
  | { error: string }
  | { fieldErrors: Record<string, string> }

const NOT_ADMIN = 'Only an organisation owner or admin can change Solar defaults.'

export async function saveSolarOrgSettingsAction(input: {
  form: SolarOrgSettingForm
  expectedUpdatedAt: string | null
}): Promise<SaveSolarSettingsResult> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!gate.ok) return { error: NOT_ADMIN }

  const check = validateSolarOrgSettings(input.form)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }
  const settings = { version: SOLAR_ORG_SETTINGS_VERSION, values: check.values }

  const table = () => supabase.schema('solar').from('org_settings')
  let updatedAt: string | undefined
  if (input.expectedUpdatedAt === null) {
    const { data, error } = await table()
      .insert({ organisation_id: ctx.organisationId, version: SOLAR_ORG_SETTINGS_VERSION, settings })
      .select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined
  } else {
    const { data, error } = await table()
      .update({ version: SOLAR_ORG_SETTINGS_VERSION, settings })
      .eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = data[0]?.updated_at as string | undefined
  }

  await emitProductEvent({ actorId: ctx.userId, projectId: null, organisationId: ctx.organisationId, event: 'solar_settings_saved' })
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: updatedAt ?? '' }
}
```
The `supabase as never` cast is only because `requireRole` is typed against the generated client; it is the same object.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/solar-settings.actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-settings.actions.ts apps/web/src/actions/solar-settings.actions.test.ts
git commit -m "feat(solar): saveSolarOrgSettingsAction — owner/admin re-check, stale guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `/settings/solar` page, form and settings-index card

**Files:**
- Create: `apps/web/src/app/(admin)/settings/solar/page.tsx`
- Create: `apps/web/src/app/(admin)/settings/solar/SolarSettingsForm.tsx`, `SolarSettingsForm.test.tsx`
- Modify: `apps/web/src/app/(admin)/settings/page.tsx` (insert one card before the `{/* Security */}` comment, after the Billing card at `page.tsx:122-143`)

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/(admin)/settings/solar/SolarSettingsForm.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { solarOrgSettingDefaults, solarSettingsToForm } from '@esite/shared'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-settings.actions', () => ({ saveSolarOrgSettingsAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))

import { SolarSettingsForm } from './SolarSettingsForm'

const initial = solarSettingsToForm(solarOrgSettingDefaults())

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('SolarSettingsForm', () => {
  it('shows the seeded defaults with units', () => {
    render(<SolarSettingsForm initial={initial} updatedAt={null} />)
    expect((screen.getByLabelText('Discount rate (%)') as HTMLInputElement).value).toBe('11')
    expect((screen.getByLabelText('O&M (R/kWp/yr)') as HTMLInputElement).value).toBe('150')
    expect((screen.getByLabelText('Section 12B allowance on by default') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('Finance defaults')).toBeDefined()
    expect(screen.getByText('Loss defaults')).toBeDefined()
  })

  it('an out-of-range value blocks the save with its sentence', async () => {
    const user = userEvent.setup()
    render(<SolarSettingsForm initial={initial} updatedAt={null} />)
    const field = screen.getByLabelText('Availability (%)')
    await user.clear(field)
    await user.type(field, '120')
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(screen.getByText('Must be between 50 and 100 %')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('saves the form with the stale token and then uses the new one', async () => {
    const user = userEvent.setup()
    render(<SolarSettingsForm initial={initial} updatedAt="T0" />)
    await user.click(screen.getByLabelText('Section 12B allowance on by default'))
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(h.save).toHaveBeenCalledWith({ form: { ...initial, section_12b_default: true }, expectedUpdatedAt: 'T0' })
    expect(await screen.findByText('Saved')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' }))
  })

  it('shows the stale sentence', async () => {
    h.save.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<SolarSettingsForm initial={initial} updatedAt="T0" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(await screen.findByText('Someone else changed this — reload to see their version.')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/settings/solar"`
Expected: FAIL — cannot resolve `./SolarSettingsForm`.

- [ ] **Step 3: Implement**

`apps/web/src/app/(admin)/settings/solar/SolarSettingsForm.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SOLAR_SETTING_FIELDS, SOLAR_SETTING_SECTIONS, validateSolarOrgSettings, type SolarOrgSettingForm,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { saveSolarOrgSettingsAction } from '@/actions/solar-settings.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'

export function SolarSettingsForm({ initial, updatedAt }: { initial: SolarOrgSettingForm; updatedAt: string | null }) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<SolarOrgSettingForm>(initial)
  const [form, setForm] = useState<SolarOrgSettingForm>(initial)
  const [token, setToken] = useState<string | null>(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useSolarDirtyGuard(JSON.stringify(form) !== JSON.stringify(baseline))

  const set = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next })
    setMessage(null)
  }

  async function save() {
    setError(null)
    setMessage(null)
    const check = validateSolarOrgSettings(form)
    if (Object.keys(check.errors).length > 0) { setErrors(check.errors); return }
    setBusy(true)
    const res = await saveSolarOrgSettingsAction({ form, expectedUpdatedAt: token })
    setBusy(false)
    if ('fieldErrors' in res) { setErrors(res.fieldErrors); return }
    if ('error' in res) { setError(res.error); return }
    setToken(res.updatedAt)
    setBaseline(form)
    setMessage('Saved')
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SOLAR_SETTING_SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader><span className="data-panel-title">{section.title}</span></CardHeader>
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              {SOLAR_SETTING_FIELDS.filter((f) => f.section === section.key).map((f) => {
                const id = `solar-setting-${f.key}`
                if (f.kind === 'boolean') {
                  return (
                    <label key={f.key} htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input id={id} type="checkbox" checked={form[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
                      {f.label}
                    </label>
                  )
                }
                return (
                  <FormField
                    key={f.key}
                    label={f.unit ? `${f.label} (${f.unit})` : f.label}
                    htmlFor={id}
                    error={errors[f.key]}
                    hint={f.source ? `Default decided in ${f.source}` : undefined}
                  >
                    <TextInput id={id} inputMode="decimal" value={String(form[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} invalid={Boolean(errors[f.key])} />
                  </FormField>
                )
              })}
            </div>
          </CardBody>
        </Card>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="button" onClick={() => void save()} isLoading={busy}>Save defaults</Button>
        {message && <span role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{message}</span>}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
      </div>
    </div>
  )
}
```

`apps/web/src/app/(admin)/settings/solar/page.tsx`:
```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN, readSolarOrgSettings, solarSettingsToForm } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { SolarSettingsForm } from './SolarSettingsForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar defaults' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const LATER = [
  { title: 'Rate card', body: 'R/Wp by size band, battery and inverter rates, BOS, fees, PM, contingency and margin — with the financial model.' },
  { title: 'Load densities', body: 'W/m² per tenant category and archetype mapping — with the load modelling tab.' },
  { title: 'Equipment catalogue', body: 'Modules, inverters and batteries (add, edit, retire, import) — with the PV layout tool.' },
  { title: 'Branding for Solar reports', body: 'Solar-specific disclaimer and terms — with feasibility reports and proposals.' },
]

/** /settings/solar (spec §11) — org owners/admins. A skeleton: three sections live, four later. */
export default async function SolarSettingsPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .schema('solar').from('org_settings').select('settings, updated_at')
    .eq('organisation_id', ctx.organisationId).maybeSingle()
  const row = data as { settings?: unknown; updated_at?: string } | null

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}>
          ← Settings
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar defaults</h1>
          <p className="page-subtitle">Every new case copies these. A case keeps its own copy, so changing them never alters past results.</p>
        </div>
      </div>
      <SolarSettingsForm initial={solarSettingsToForm(readSolarOrgSettings(row?.settings ?? null))} updatedAt={row?.updated_at ?? null} />
      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        {LATER.map((s) => (
          <Card key={s.title}>
            <CardHeader><span className="data-panel-title">{`${s.title} — coming in a later phase`}</span></CardHeader>
            <CardBody><p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>{s.body}</p></CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

In `apps/web/src/app/(admin)/settings/page.tsx`, insert immediately before the line `        {/* Security */}`:
```tsx
        {/* Solar defaults */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Solar defaults</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
              Finance, opex and loss defaults every new Solar case copies.
            </p>
            <Link
              href="/settings/solar"
              style={{
                display: 'inline-block',
                fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                textDecoration: 'none',
              }}
            >
              Solar defaults →
            </Link>
          </div>
        </div>

```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/settings"`
Expected: PASS (SolarSettingsForm 4 tests plus existing settings tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/settings/solar" "apps/web/src/app/(admin)/settings/page.tsx"
git commit -m "feat(solar): /settings/solar defaults skeleton and settings-index card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: RBAC matrix rows, full suites, push, owner walk

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: RBAC rows**

In the Solar route table added by 1C-i, insert after the `/projects/[id]/solar/overview` row:
```markdown
| `/projects/[id]/solar/site` | W | W | W | R (values as text, no Save) | → locked | → locked | → locked |
```
In the "Page routes" table, insert after the `/settings/billing` row:
```markdown
| `/settings/solar` | W | W | — | — | — | — | — |
```
In the "Solar server actions" table, append:
```markdown
| `saveSolarSiteAction` (`solar-site.actions.ts`) | `requireSolarLevel(project, 'edit')` (lower levels are redirected to `/solar/locked`); `expectedUpdatedAt` stale guard | `studies_insert_authz` / `studies_update_authz` (RESTRICTIVE, `solar_can_edit`); `studies_bind` binds the org and refuses a PoC node from another project |
| `saveSolarOrgSettingsAction` (`solar-settings.actions.ts`) | `requireRole(active org, OWNER_ADMIN)`; `expectedUpdatedAt` stale guard | `00209` `org_settings_*` policies (owner/admin of the row's org); no DELETE policy or grant; bind trigger pins the org and `updated_by` |
```

- [ ] **Step 2: Run every suite and the type-check**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter web type-check 2>&1 | tail -5
pnpm --filter @esite/db test:ci 2>&1 | tail -15
```
Expected: all green; counts above the 1C-i figures by the tests added here. If a guard fails, fix the code, never the guard; if a guard is genuinely inapplicable, stop and report its name and message.

- [ ] **Step 3: Commit and push**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): Site & Supply, /settings/solar and their actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push git@github.com:WattMatt/e-site.git feat/solar-phase-1c
```

- [ ] **Step 4: Update the draft PR body**

Append to `/tmp/solar-1c-pr.md` a "1C-ii" section (Overview, Site & Supply, `/settings/solar`, suite counts), keep the apply checklist from 1C-i, add the owner walk below, keep the final line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, then:
```bash
gh pr edit --repo WattMatt/e-site feat/solar-phase-1c --body-file /tmp/solar-1c-pr.md
```

**Owner signed-in walk (cannot be done from an agent session — signing in means entering a password; a local dev-server check through the preview tools is therefore not possible either).** Owner, after `00208` + `00209` are applied and 1B's Paystack test mode is configured, on a throwaway org (not WM-Consulting, which bypasses the paywall):
1. As an org **contractor** on a project: the sidebar shows **Solar** with a lock; opening it shows "Solar is not active for <org>" + **Ask an admin to subscribe**; press it → "Requested on <date>"; the org admin's bell shows "<name> would like Solar for <project>".
2. As the **admin**: Solar → locked screen with price + **Subscribe** → Paystack test card → returned to `/solar/locked?payment=received` → "Payment received — activating Solar…" → lands on the Overview once the webhook arrives (or the 30 s sentence).
3. As the contractor again: sidebar lock remains; the locked page offers **Request access** (View / Edit / Edit + financials) → send with a note → the sidebar shows a clock; the page says "Request sent to <admins> on <date>"; **Withdraw request** works; send again.
4. As the admin: open the bell notification → `/solar/access` → approve as **View** → the contractor's bell says access was granted.
5. As the contractor: the Overview shows the readiness checklist (Site & Supply grey, the rest "available in a later phase"), no case controls, the View-only banner; Site & Supply is read-only; no Tariff/Financials tabs; **Request edit access** sends a request.
6. As the admin: change the contractor to **Edit + financials**; as the contractor, Site & Supply now saves; enter coordinates, supply authority and NMD → the Site & Supply dot turns green; a second browser tab saving an older copy gets "Someone else changed this — reload to see their version."; the Overview's recent activity lists the saves and access changes.
7. As the admin: `/settings/solar` shows the seeded defaults (11 %, 5 %, R150/kWp/yr, 0.5 %…); change one, save; reload shows it.
8. A **supplier** or **client viewer** member sees no Solar entry at all, and `/projects/<id>/solar/locked` sends them back to the project.

---

## Self-review (done while writing)

- **Spec coverage.** §2.1 layout 1–4 → Task 2 (header, checklist from 1C-i, KPIs, activity). §2.2 controls: checklist rows (1C-i), Change selected case (disabled with its documented reason, Edit+), Open case (not rendered — no case can exist), Generate feasibility report (disabled, Edit ∩ financials), activity items (linked where the target is reachable). §2.3 only the Site & Supply rule live (1C-i `siteReadiness`). §2.4 empty state. §3.1 sections A–E (C and E marked "coming in a later phase"). §3.2: address read-only + link ✓; Locate from address — out of scope ✓ (not rendered); map pin — no map component ✓; lat/lng with SA warning ✓; elevation ✓; supply authority as free text ✓; customer type incl. Private hint ✓; NMD with incomer prefill ✓; supply voltage presets + other ✓; PoC select with rating ✓; transformer rating derived ✓ (the 75 % hosting warning needs PV AC size — Phase 5/6); export allowed + limit shown only when allowed ✓; roof sources / calibrate / satellite → placeholder ✓; constraints notes ✓. §3.3 → placeholder ✓. §11 → Finance/Opex/Loss live with seeded defaults; Rate card/Load densities/Equipment/Branding placeholders. §0.4: stale guard on both saves, human errors, units in every label, spinner via `isLoading`, product events `solar_site_saved` / `solar_settings_saved`.
- **Placeholders:** none in code steps.
- **Type consistency:** `SiteSupplyForm` (shared type, aliased `SiteForm` inside the component to avoid clashing with the component name), `SiteSupplyField`, `SaveSiteResult`, `SolarOrgSettingForm`, `SaveSolarSettingsResult`, `SolarActivityItem` (defined in `activity-types.ts`, Task 1) are used identically in tests and code.
