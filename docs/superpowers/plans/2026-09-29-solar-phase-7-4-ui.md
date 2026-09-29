# Solar Phase 7 — Part 4: UI (Operations tab, settings template card)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-29-solar-phase-7-0-index.md` first.

Directory for the tab: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/` (below: `$OPS`). Every client component imports runtime values ONLY from `@esite/shared/solar-operations/client` (engine-free) and types from `@esite/shared/solar-operations` / `@/lib/solar/operations/data`; the page hands them JSON. UI primitives: `Card`/`CardHeader`/`CardBody` (`@/components/ui/Card`), `Button` (`variant: primary|secondary|ghost|danger`, `size: sm|md|lg`), `FormField`/`TextInput`/`Select`/`Textarea` (`@/components/ui/FormField`).

Run the tab's tests with:
```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 && pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations' 2>&1 | tail -8
```

---

### Task 26: Client-safe subpath, the page, readiness dots, activity links

**Files:**
- Create: `packages/shared/src/solar/operations/client.ts`
- Modify: `packages/shared/package.json`
- Modify: `apps/web/src/lib/solar/no-browser-engine.contract.test.ts`
- Create: `apps/web/src/components/solar/ops-format.ts`, `ops-format.test.ts`
- Create: `$OPS/page.tsx`, `$OPS/OperationsTab.tsx`, `$OPS/OperationsTab.test.tsx`
- Modify: `apps/web/src/lib/solar/cases/page-data.ts` (`loadSolarReadinessExtra`)
- Create: `apps/web/src/lib/solar/cases/page-data.operations.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx` (+ its test)

- [ ] **Step 1: The engine-free subpath.** `packages/shared/src/solar/operations/client.ts`:

```ts
/**
 * The engine-free part of @esite/shared/solar-operations, for 'use client' files: labels, schemas
 * and calendar helpers only. The full subpath re-exports downtime-detect, which imports the SPA —
 * the browser must never run the engine (no-browser-engine.contract.test.ts).
 */
export * from './time'
export * from './as-built'
export { GUARANTEE_BASES, GUARANTEE_BASIS_LABELS, type Guarantee, type GuaranteeBasis } from './guarantee'
export { DEFAULT_HANDOVER_TEMPLATE, templateFromRow, type HandoverTemplate } from './handover'
export { CAUSE_LABELS, NOTE_SECTIONS, NOTE_SECTION_LABELS, type NoteSection } from './report'
```
Add to `packages/shared/package.json` exports, after `"./solar-operations"`:
```json
    "./solar-operations/client": "./src/solar/operations/client.ts",
```

- [ ] **Step 2: Extend the browser-engine contract.** In `apps/web/src/lib/solar/no-browser-engine.contract.test.ts`, add `'@esite/shared/solar-operations'` to `FORBIDDEN_MODULES` (the `/client` subpath is a different specifier, so it stays allowed). Run it — PASS (no client file exists yet).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -3
```

- [ ] **Step 3: Failing tests.**

`apps/web/src/components/solar/ops-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { kwh, pctSigned, sastDateTime } from './ops-format'

describe('ops-format (locale-free, same bytes on server and browser)', () => {
  it('groups thousands with a space and signs percentages', () => {
    expect(kwh(12345.6)).toBe('12 346')
    expect(kwh(null)).toBe('—')
    expect(pctSigned(-10)).toBe('-10.0 %')
    expect(pctSigned(2.345)).toBe('+2.3 %')
    expect(pctSigned(null)).toBe('—')
  })
  it('prints an instant in SAST', () => {
    expect(sastDateTime('2026-03-10T08:00:00.000Z')).toBe('2026-03-10 10:00')
  })
})
```

`$OPS/OperationsTab.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('./InstallationCard', () => ({ InstallationCard: () => <div data-testid="installation" /> }))
vi.mock('./MetersCard', () => ({ MetersCard: () => <div data-testid="meters" /> }))
vi.mock('./GuaranteeCard', () => ({ GuaranteeCard: () => <div data-testid="guarantee" /> }))
vi.mock('./PerformanceTable', () => ({ PerformanceTable: () => <div data-testid="performance" /> }))
vi.mock('./IrradiationCard', () => ({ IrradiationCard: () => <div data-testid="irradiation" /> }))
vi.mock('./DowntimeLog', () => ({ DowntimeLog: () => <div data-testid="downtime" /> }))
vi.mock('./MonthlyReportPanel', () => ({ MonthlyReportPanel: () => <div data-testid="monthly" /> }))
vi.mock('./HandoverChecklist', () => ({ HandoverChecklist: () => <div data-testid="handover" /> }))
import { OperationsTab } from './OperationsTab'
import type { OperationsView } from '@/lib/solar/operations/data'

const base: OperationsView = {
  level: 'edit', canEdit: true, canSeeMoney: false, studyId: 's1', organisationId: 'o1', setupReason: null, acceptedProposal: null,
  installation: null, meters: [], availableMeters: [], guarantee: null, irradiation: [], downtime: [], months: [], selectedMonth: null,
  performance: [], candidates: [], handover: { items: [], completion: { done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 }, documents: [], templateName: '' },
  monthly: null, readiness: null,
}
const installed = { ...base, installation: { id: 'i1', commissioningDate: '2026-02-15', notes: null, updatedAt: 'T', annualP50Kwh: 12000,
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0, equipment: [] },
  baseline: { version: 1, caseRunId: 'r', inputsHash: 'h', dcKwp: 100, acKw: 80, performanceRatio: 0.8, monthlyKwh: new Array(12).fill(1000), diurnalKw: [], ghiKwhM2: null } } } as unknown as OperationsView

describe('OperationsTab', () => {
  it('before installation: only the installation card', () => {
    render(<OperationsTab projectId="p1" view={base} />)
    expect(screen.getByTestId('installation')).toBeTruthy()
    expect(screen.queryByTestId('performance')).toBeNull()
  })
  it('installed, no money: every section except the monthly report', () => {
    render(<OperationsTab projectId="p1" view={installed} />)
    for (const id of ['installation', 'meters', 'guarantee', 'performance', 'irradiation', 'downtime', 'handover']) expect(screen.getByTestId(id)).toBeTruthy()
    expect(screen.queryByTestId('monthly')).toBeNull()
  })
  it('money level: the monthly report panel appears', () => {
    render(<OperationsTab projectId="p1" view={{ ...installed, canSeeMoney: true, monthly: { notes: {} as never, notesUpdatedAt: {} as never, generateReason: 'x', tariffName: null } }} />)
    expect(screen.getByTestId('monthly')).toBeTruthy()
  })
})
```

`apps/web/src/lib/solar/cases/page-data.operations.test.ts` (own mocks, so the 4b suite is undisturbed):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), ops: vi.fn() }))
vi.mock('./run-context', async (orig) => ({ ...(await orig<typeof import('./run-context')>()), loadStudyInputs: h.load }))
vi.mock('@/lib/solar/operations/data', () => ({ loadOperationsReadiness: h.ops }))
import { loadSolarReadinessExtra } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

beforeEach(() => {
  vi.clearAllMocks()
  h.load.mockResolvedValue({ study: { id: 's1', organisation_id: 'o1', selected_case_id: null, updated_at: 'T' }, siteLoad: null, tariff: { ok: false, reason: 'x' }, touPeriods: null })
  h.ops.mockResolvedValue({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 2 })
})

describe('loadSolarReadinessExtra — Operations (Phase 7)', () => {
  it('carries the operations readiness input for every level', async () => {
    const user = fakeSupabase({ tables: { 'solar.cases': [] } }).client
    await expect(loadSolarReadinessExtra(user as never, {} as never, 'p1', 'view')).resolves.toMatchObject({ operations: { installed: true, monthsWithData: 2 } })
    expect(h.ops).toHaveBeenCalledWith(user, 'p1')
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement.**

`apps/web/src/components/solar/ops-format.ts`:
```ts
/** Locale-free formatting for the Operations tab (toLocaleString differs between Node and browsers). */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function kwh(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return `${r < 0 ? '-' : ''}${group(String(Math.abs(r)))}`
}

export function pctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} %`
}

export function sastDateTime(iso: string): string {
  return new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
}
```

`$OPS/OperationsTab.tsx` (server component — no `'use client'`):
```tsx
/**
 * Operations tab (spec §10). Composes the cards from ONE server-built view model; money (the monthly
 * report panel) renders only at Edit + financials. Anything handed to a client card is JSON.
 */
import type { OperationsView } from '@/lib/solar/operations/data'
import { InstallationCard } from './InstallationCard'
import { MetersCard } from './MetersCard'
import { GuaranteeCard } from './GuaranteeCard'
import { PerformanceTable } from './PerformanceTable'
import { IrradiationCard } from './IrradiationCard'
import { DowntimeLog } from './DowntimeLog'
import { MonthlyReportPanel } from './MonthlyReportPanel'
import { HandoverChecklist } from './HandoverChecklist'

export function OperationsTab({ projectId, view }: { projectId: string; view: OperationsView }) {
  if (!view.installation) {
    return (
      <InstallationCard projectId={projectId} canEdit={view.canEdit} installation={null}
        acceptedProposal={view.acceptedProposal} setupReason={view.setupReason} />
    )
  }
  const inst = view.installation
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <InstallationCard projectId={projectId} canEdit={view.canEdit} installation={inst} acceptedProposal={null} setupReason={null} />
      <MetersCard projectId={projectId} installationId={inst.id} organisationId={view.organisationId ?? ''} canEdit={view.canEdit}
        meters={view.meters} availableMeters={view.availableMeters} />
      <GuaranteeCard projectId={projectId} installationId={inst.id} canEdit={view.canEdit} guarantee={view.guarantee} />
      <PerformanceTable projectId={projectId} rows={view.performance} selectedMonth={view.selectedMonth} />
      <IrradiationCard projectId={projectId} installationId={inst.id} canEdit={view.canEdit} entries={view.irradiation} />
      <DowntimeLog projectId={projectId} installationId={inst.id} canEdit={view.canEdit} downtime={view.downtime}
        candidates={view.candidates} selectedMonth={view.selectedMonth} />
      {view.canSeeMoney && view.monthly
        ? <MonthlyReportPanel projectId={projectId} installationId={inst.id} month={view.selectedMonth} monthly={view.monthly} />
        : null}
      <HandoverChecklist projectId={projectId} installationId={inst.id} canEdit={view.canEdit} handover={view.handover} />
    </div>
  )
}
```

`$OPS/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadOperationsView } from '@/lib/solar/operations/data'
import { OperationsTab } from './OperationsTab'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Operations (spec §10). View level reads everything technical; Edit writes; Edit + financials sees the monthly report. */
export default async function SolarOperationsPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { id } = await params
  const { month } = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const view = await loadOperationsView({
    user: supabase, svc: createServiceClient() as unknown as AnyClient, projectId: id, level, month: typeof month === 'string' ? month : null,
  })
  return <OperationsTab projectId={id} view={view} />
}
```

In `apps/web/src/lib/solar/cases/page-data.ts` `loadSolarReadinessExtra`: add the import
```ts
import { loadOperationsReadiness } from '@/lib/solar/operations/data'
```
and immediately before the function's `return {`, add
```ts
  const operations = await loadOperationsReadiness(user, projectId)
```
then add `operations,` to the returned object.

In `ActivityList.tsx` `hrefFor`, add:
```ts
    if (target === 'operations') return `/projects/${projectId}/solar/operations`
```
and append to `ActivityList.test.tsx`:
```tsx
  it('links operations activity to the Operations tab', () => {
    render(<ActivityList projectId="p1" items={[{ id: 4, at: '2026-09-29T09:00:00Z', actorName: 'Ann', text: 'Downtime recorded (2 h)', target: 'operations' as const }]} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Downtime recorded (2 h)' }).getAttribute('href')).toBe('/projects/p1/solar/operations')
  })
```

- [ ] **Step 5: Create placeholder components so the tab compiles** — Tasks 27–31 replace each file's whole content. Create these eight files, each with exactly the two lines shown (the first line is omitted for `PerformanceTable`, which is a server component):

`$OPS/InstallationCard.tsx`:
```tsx
'use client'
export function InstallationCard(_props: Record<string, unknown>) { return null }
```
`$OPS/MetersCard.tsx`:
```tsx
'use client'
export function MetersCard(_props: Record<string, unknown>) { return null }
```
`$OPS/GuaranteeCard.tsx`:
```tsx
'use client'
export function GuaranteeCard(_props: Record<string, unknown>) { return null }
```
`$OPS/IrradiationCard.tsx`:
```tsx
'use client'
export function IrradiationCard(_props: Record<string, unknown>) { return null }
```
`$OPS/DowntimeLog.tsx`:
```tsx
'use client'
export function DowntimeLog(_props: Record<string, unknown>) { return null }
```
`$OPS/MonthlyReportPanel.tsx`:
```tsx
'use client'
export function MonthlyReportPanel(_props: Record<string, unknown>) { return null }
```
`$OPS/HandoverChecklist.tsx`:
```tsx
'use client'
export function HandoverChecklist(_props: Record<string, unknown>) { return null }
```
`$OPS/PerformanceTable.tsx`:
```tsx
export function PerformanceTable(_props: Record<string, unknown>) { return null }
```

- [ ] **Step 6: Run — PASS; type-check; commit.** Also run every existing `page-data` test: `loadSolarReadinessExtra` now returns an `operations` key (null when their fakes hold no `solar.studies` row). If one of them asserts the WHOLE returned object with `toEqual`, add `operations: null` to that expectation — change nothing else.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/cases/page-data 2>&1 | tail -4
pnpm --filter web test -- src/components/solar/ops-format.test.ts 'src/app/(admin)/projects/[id]/solar' src/lib/solar/cases/page-data.operations.test.ts src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -6
pnpm --filter web type-check 2>&1 | tail -5
git add packages/shared/src/solar/operations/client.ts packages/shared/package.json apps/web/src/lib/solar/no-browser-engine.contract.test.ts \
  apps/web/src/components/solar/ops-format.ts apps/web/src/components/solar/ops-format.test.ts \
  'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations' apps/web/src/lib/solar/cases/page-data.ts apps/web/src/lib/solar/cases/page-data.operations.test.ts \
  'apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.test.tsx'
git commit -m "feat(solar): Operations page shell, readiness dots and activity links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: Installation card, meters card, generation import

**Files:**
- Replace: `$OPS/InstallationCard.tsx`; Create: `$OPS/InstallationCard.test.tsx`
- Replace: `$OPS/MetersCard.tsx`; Create: `$OPS/MetersCard.test.tsx`
- Create: `$OPS/GenerationImport.tsx`, `$OPS/GenerationImport.test.tsx`

- [ ] **Step 1: Failing tests.**

`InstallationCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ createInstallationAction: h.create, saveInstallationAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { InstallationCard } from './InstallationCard'

const inst = {
  id: 'i1', commissioningDate: '2026-02-15', notes: null, updatedAt: 'T1', annualP50Kwh: 150_000,
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module' as const, make: 'Acme', model: 'M-500', rating: 500, unit: 'W' as const, quantity: 200 }] },
  baseline: { version: 1 as const, caseRunId: 'run-1234abcd', inputsHash: 'h', dcKwp: 100, acKw: 80, performanceRatio: 0.81, monthlyKwh: [], diurnalKw: [], ghiKwhM2: null },
}
beforeEach(() => vi.clearAllMocks())

describe('InstallationCard — before installation', () => {
  it('shows the reason when it cannot be created', () => {
    render(<InstallationCard projectId="p1" canEdit installation={null} acceptedProposal={null} setupReason="No accepted proposal yet." />)
    expect(screen.getByText('No accepted proposal yet.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('records the installation from the accepted proposal', async () => {
    h.create.mockResolvedValue({ ok: true, installationId: 'i1', warning: null })
    render(<InstallationCard projectId="p1" canEdit installation={null} acceptedProposal={{ id: 'prop', version: 3 }} setupReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record installation from proposal v3' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1' }))
    expect(h.refresh).toHaveBeenCalled()
  })
  it('a View user is told who records it', () => {
    render(<InstallationCard projectId="p1" canEdit={false} installation={null} acceptedProposal={{ id: 'prop', version: 3 }} setupReason={null} />)
    expect(screen.getByText(/Someone with Solar Edit access records the installation/)).toBeTruthy()
  })
})

describe('InstallationCard — as-built', () => {
  it('saves commissioning date, sizes and equipment as numbers', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<InstallationCard projectId="p1" canEdit installation={inst} acceptedProposal={null} setupReason={null} />)
    expect(screen.getByText(/150 000 kWh a year \(P50\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Commissioning date'), { target: { value: '2026-02-20' } })
    fireEvent.change(screen.getByLabelText('DC kWp'), { target: { value: '101.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save installation' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0]).toMatchObject({
      projectId: 'p1', installationId: 'i1', commissioningDate: '2026-02-20', expectedUpdatedAt: 'T1',
      asBuilt: { dcKwp: 101.5, acKw: 80, batteryKwh: null, equipment: [{ kind: 'module', make: 'Acme', model: 'M-500', rating: 500, unit: 'W', quantity: 200 }] },
    })
  })
  it('shows field errors from the action', async () => {
    h.save.mockResolvedValue({ fieldErrors: { commissioningDate: 'Enter a real date (YYYY-MM-DD).' } })
    render(<InstallationCard projectId="p1" canEdit installation={inst} acceptedProposal={null} setupReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save installation' }))
    expect(await screen.findByText('Enter a real date (YYYY-MM-DD).')).toBeTruthy()
  })
  it('View level is read-only', () => {
    render(<InstallationCard projectId="p1" canEdit={false} installation={inst} acceptedProposal={null} setupReason={null} />)
    expect(screen.queryByRole('button', { name: 'Save installation' })).toBeNull()
    expect((screen.getByLabelText('DC kWp') as HTMLInputElement).disabled).toBe(true)
  })
})
```

`MetersCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ link: vi.fn(async () => ({ ok: true })), unlink: vi.fn(async () => ({ ok: true })), share: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ linkMeterAction: h.link, unlinkMeterAction: h.unlink, setMeterShareAction: h.share }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('./GenerationImport', () => ({ GenerationImport: () => <div data-testid="import" /> }))
import { MetersCard } from './MetersCard'

const props = {
  projectId: 'p1', installationId: 'i1', organisationId: 'o1', canEdit: true,
  meters: [{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation' as const, sharePct: null }],
  availableMeters: [{ meterId: 'm2', label: 'Council', kind: 'council' }, { meterId: 'm3', label: 'PV roof B', kind: 'solar' }],
}
beforeEach(() => vi.clearAllMocks())

describe('MetersCard', () => {
  it('links an available meter in the role its kind allows', async () => {
    render(<MetersCard {...props} />)
    fireEvent.change(screen.getByLabelText('Meter to link'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link meter' }))
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm2', role: 'consumption' }))
    fireEvent.change(screen.getByLabelText('Meter to link'), { target: { value: 'm3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link meter' }))
    await waitFor(() => expect(h.link).toHaveBeenLastCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm3', role: 'generation' }))
  })
  it('unlink needs a second press', async () => {
    render(<MetersCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unlink PV main' }))
    expect(h.unlink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unlink PV main' }))
    await waitFor(() => expect(h.unlink).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm1' }))
  })
  it('says when shares are equal, and offers the import', () => {
    render(<MetersCard {...props} />)
    expect(screen.getByText(/allocated equally/)).toBeTruthy()
    expect(screen.getByTestId('import')).toBeTruthy()
  })
  it('View level: no controls', () => {
    render(<MetersCard {...props} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Link meter' })).toBeNull()
    expect(screen.queryByTestId('import')).toBeNull()
  })
})
```

`GenerationImport.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
const h = vi.hoisted(() => ({ upload: vi.fn(async () => ({ error: null })), link: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), sha: vi.fn(async () => 'a'.repeat(64)) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ upload: h.upload }) } }) }))
vi.mock('@/actions/solar-operations.actions', () => ({ linkMeterAction: h.link }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@esite/shared/meter-data', () => ({ sha256Hex: h.sha }))
import { GenerationImport } from './GenerationImport'

const review = (over: Record<string, unknown> = {}) => ({ fileId: 'f1', outcome: 'series', canAccept: true, blockingErrors: [], choicesNeeded: [], ...over })
/** Plain response objects (the component reads only ok / status / json()), so no global Response is needed. */
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
function mockFetch(reviewOver: Record<string, unknown> = {}, committed = { meterId: 'm9', meterLabel: 'PV new' }) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/meter-files')) return res(201, { fileId: 'f1', duplicate: false })
    if (url.endsWith('/parse')) return res(200, { results: [{ fileId: 'f1', reviews: [review(reviewOver)] }] })
    if (url.endsWith('/commit')) return res(200, { ...committed, channels: [] })
    return res(404, {})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const file = () => new File(['ts,kW\n2026-03-10 12:00,7'], 'March.CSV', { type: 'text/csv' })
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('GenerationImport (the existing meter pipeline, meter kind solar)', () => {
  it('uploads by hash, registers, parses, commits to a NEW solar meter and links it for generation', async () => {
    const f = mockFetch()
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[]} />)
    fireEvent.change(screen.getByLabelText('New meter name'), { target: { value: 'PV new' } })
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    await screen.findByText(/Imported to PV new/)
    expect(h.upload).toHaveBeenCalledWith(`o1/p1/${'a'.repeat(64)}.csv`, expect.any(File), { upsert: false })
    const commit = f.mock.calls.find(([u]) => String(u).endsWith('/commit'))!
    expect(JSON.parse(String((commit[1] as RequestInit).body))).toEqual({ mode: 'series', fileId: 'f1', meter: { new: { label: 'PV new', kind: 'solar' } }, identity: { resolution: 'none' } })
    expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm9', role: 'generation' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('an existing generation meter receives the file (re-import replaces its intervals) and is not re-linked', async () => {
    const f = mockFetch({}, { meterId: 'm1', meterLabel: 'PV main' })
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    await screen.findByText(/Imported to PV main/)
    const commit = f.mock.calls.find(([u]) => String(u).endsWith('/commit'))!
    expect(JSON.parse(String((commit[1] as RequestInit).body)).meter).toEqual({ existingMeterId: 'm1' })
    expect(h.link).not.toHaveBeenCalled()
  })
  it('a file that needs choices is not committed; the reasons are shown', async () => {
    const f = mockFetch({ canAccept: false, blockingErrors: ['Timestamps go backwards at row 12'], choicesNeeded: ['unit for column "Energy"'] })
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    expect(await screen.findByText('Timestamps go backwards at row 12')).toBeTruthy()
    expect(screen.getByText('unit for column "Energy"')).toBeTruthy()
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/commit'))).toBe(false)
  })
  it('refuses a file type the pipeline cannot store', async () => {
    mockFetch()
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [new File(['x'], 'data.pdf')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    expect(await screen.findByText('Choose a .csv, .txt, .xlsx or .xls export.')).toBeTruthy()
    expect(h.upload).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`$OPS/InstallationCard.tsx`:
```tsx
'use client'
/**
 * Installation (spec §10): created from the ACCEPTED proposal (its run frozen as the baseline), then
 * the as-built record — commissioning date, sizes and the equipment table the monthly report prints.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EQUIPMENT_KINDS, EQUIPMENT_UNITS, type AsBuilt, type EquipmentLine } from '@esite/shared/solar-operations/client'
import type { OpsInstallationView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput, Textarea } from '@/components/ui/FormField'
import { createInstallationAction, saveInstallationAction } from '@/actions/solar-operations.actions'
import { kwh } from '@/components/solar/ops-format'

interface Props {
  projectId: string
  canEdit: boolean
  installation: OpsInstallationView | null
  acceptedProposal: { id: string; version: number } | null
  setupReason: string | null
}

const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const
const str = (v: number | null) => (v === null ? '' : String(v))
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

export function InstallationCard(p: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (!p.installation) {
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Installation</span></CardHeader>
        <CardBody>
          {p.setupReason ? <p style={HINT}>{p.setupReason}</p>
            : p.acceptedProposal && p.canEdit ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={HINT}>{`Proposal v${p.acceptedProposal.version} was accepted. Recording the installation freezes its modelled generation as the baseline the guarantee is measured against.`}</p>
                <div>
                  <Button disabled={busy} onClick={async () => {
                    setBusy(true)
                    const r = await createInstallationAction({ projectId: p.projectId })
                    setBusy(false)
                    if ('error' in r) { setMsg(r.error); return }
                    setMsg(r.warning)
                    router.refresh()
                  }}>{`Record installation from proposal v${p.acceptedProposal.version}`}</Button>
                </div>
              </div>
            ) : <p style={HINT}>{`Proposal v${p.acceptedProposal?.version ?? ''} was accepted. Someone with Solar Edit access records the installation.`}</p>}
          {msg ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)', marginTop: 8 }}>{msg}</p> : null}
        </CardBody>
      </Card>
    )
  }
  return <InstallationForm {...p} installation={p.installation} />
}

interface LineForm { kind: EquipmentLine['kind']; make: string; model: string; rating: string; unit: EquipmentLine['unit']; quantity: string }

function InstallationForm({ projectId, canEdit, installation }: Props & { installation: OpsInstallationView }) {
  const router = useRouter()
  const a = installation.asBuilt
  const [date, setDate] = useState(installation.commissioningDate ?? '')
  const [dcKwp, setDcKwp] = useState(String(a.dcKwp))
  const [acKw, setAcKw] = useState(String(a.acKw))
  const [batteryKwh, setBatteryKwh] = useState(str(a.batteryKwh))
  const [batteryKw, setBatteryKw] = useState(str(a.batteryKw))
  const [tilt, setTilt] = useState(str(a.tiltDeg))
  const [azimuth, setAzimuth] = useState(str(a.azimuthDeg))
  const [notes, setNotes] = useState(installation.notes ?? '')
  const [lines, setLines] = useState<LineForm[]>(a.equipment.map((e) => ({ ...e, rating: String(e.rating), quantity: String(e.quantity) })))
  const [updatedAt, setUpdatedAt] = useState(installation.updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setLine = (k: number, patch: Partial<LineForm>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...patch } : l)))

  async function save() {
    const asBuilt: AsBuilt = {
      dcKwp: Number(dcKwp), acKw: Number(acKw), batteryKwh: numOrNull(batteryKwh), batteryKw: numOrNull(batteryKw),
      tiltDeg: numOrNull(tilt), azimuthDeg: numOrNull(azimuth),
      equipment: lines.map((l) => ({ kind: l.kind, make: l.make, model: l.model, rating: Number(l.rating), unit: l.unit, quantity: Number(l.quantity) })),
    }
    setBusy(true)
    const r = await saveInstallationAction({ projectId, installationId: installation.id, commissioningDate: date || null, asBuilt, notes, expectedUpdatedAt: updatedAt })
    setBusy(false)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    setErrors({})
    if ('error' in r) { setMsg(r.error); return }
    setUpdatedAt(r.updatedAt)
    setMsg('Saved.')
    router.refresh()
  }

  const b = installation.baseline
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Installation (as built)</span></CardHeader>
      <CardBody>
        <p style={{ ...HINT, marginBottom: 12 }}>
          {`Modelled baseline: accepted run ${b.caseRunId.slice(0, 8)} — ${kwh(installation.annualP50Kwh)} kWh a year (P50), design PR ${b.performanceRatio.toFixed(2)}. Frozen when the installation was recorded.`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <FormField label="Commissioning date" htmlFor="ops-comm" error={errors.commissioningDate}>
            <TextInput id="ops-comm" type="date" value={date} disabled={!canEdit} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="DC kWp" htmlFor="ops-dc"><TextInput id="ops-dc" inputMode="decimal" value={dcKwp} disabled={!canEdit} onChange={(e) => setDcKwp(e.target.value)} /></FormField>
          <FormField label="AC kW" htmlFor="ops-ac"><TextInput id="ops-ac" inputMode="decimal" value={acKw} disabled={!canEdit} onChange={(e) => setAcKw(e.target.value)} /></FormField>
          <FormField label="Battery kWh" htmlFor="ops-bkwh"><TextInput id="ops-bkwh" inputMode="decimal" value={batteryKwh} disabled={!canEdit} onChange={(e) => setBatteryKwh(e.target.value)} /></FormField>
          <FormField label="Battery kW" htmlFor="ops-bkw"><TextInput id="ops-bkw" inputMode="decimal" value={batteryKw} disabled={!canEdit} onChange={(e) => setBatteryKw(e.target.value)} /></FormField>
          <FormField label="Tilt °" htmlFor="ops-tilt"><TextInput id="ops-tilt" inputMode="decimal" value={tilt} disabled={!canEdit} onChange={(e) => setTilt(e.target.value)} /></FormField>
          <FormField label="Azimuth °" htmlFor="ops-az"><TextInput id="ops-az" inputMode="decimal" value={azimuth} disabled={!canEdit} onChange={(e) => setAzimuth(e.target.value)} /></FormField>
        </div>
        <table style={{ width: '100%', marginTop: 16, fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr><th align="left">Kind</th><th align="left">Make</th><th align="left">Model</th><th align="right">Rating</th><th align="left">Unit</th><th align="right">Qty</th><th /></tr></thead>
          <tbody>
            {lines.map((l, k) => (
              <tr key={k}>
                <td><Select aria-label={`Kind of line ${k + 1}`} value={l.kind} disabled={!canEdit} onChange={(e) => setLine(k, { kind: e.target.value as LineForm['kind'] })}>
                  {EQUIPMENT_KINDS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></td>
                <td><TextInput aria-label={`Make of line ${k + 1}`} value={l.make} disabled={!canEdit} onChange={(e) => setLine(k, { make: e.target.value })} /></td>
                <td><TextInput aria-label={`Model of line ${k + 1}`} value={l.model} disabled={!canEdit} onChange={(e) => setLine(k, { model: e.target.value })} /></td>
                <td><TextInput aria-label={`Rating of line ${k + 1}`} inputMode="decimal" value={l.rating} disabled={!canEdit} onChange={(e) => setLine(k, { rating: e.target.value })} /></td>
                <td><Select aria-label={`Unit of line ${k + 1}`} value={l.unit} disabled={!canEdit} onChange={(e) => setLine(k, { unit: e.target.value as LineForm['unit'] })}>
                  {EQUIPMENT_UNITS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></td>
                <td><TextInput aria-label={`Quantity of line ${k + 1}`} inputMode="numeric" value={l.quantity} disabled={!canEdit} onChange={(e) => setLine(k, { quantity: e.target.value })} /></td>
                <td>{canEdit ? <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, i) => i !== k))}>Remove</Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.asBuilt ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)' }}>{errors.asBuilt}</p> : null}
        {canEdit ? <Button variant="secondary" size="sm" style={{ marginTop: 8 }}
          onClick={() => setLines((ls) => [...ls, { kind: 'module', make: '', model: '', rating: '', unit: 'W', quantity: '1' }])}>Add equipment line</Button> : null}
        <div style={{ marginTop: 12 }}>
          <FormField label="Notes" htmlFor="ops-notes" error={errors.notes}>
            <Textarea id="ops-notes" rows={3} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
        {canEdit ? <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button disabled={busy} onClick={save}>Save installation</Button>
          {msg ? <span role="status" style={HINT}>{msg}</span> : null}
        </div> : null}
      </CardBody>
    </Card>
  )
}
```

`$OPS/MetersCard.tsx`:
```tsx
'use client'
/**
 * Meters (spec §10): generation meters (kind solar) and the council/bulk meter for realised
 * consumption. The role follows the meter's kind, so a council meter can never be linked as
 * generation (00217 refuses it too).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OpsAvailableMeter, OpsMeterView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { linkMeterAction, setMeterShareAction, unlinkMeterAction } from '@/actions/solar-operations.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { GenerationImport } from './GenerationImport'

interface Props {
  projectId: string; installationId: string; organisationId: string; canEdit: boolean
  meters: OpsMeterView[]; availableMeters: OpsAvailableMeter[]
}
const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const

function MeterRow({ p, m }: { p: Props; m: OpsMeterView }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const [share, setShare] = useState(m.sharePct === null ? '' : String(m.sharePct))
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <tr>
      <td>{m.label}</td>
      <td>{m.role === 'generation' ? 'Generation' : 'Consumption (grid)'}</td>
      <td>
        {m.role === 'generation' ? (p.canEdit ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <TextInput aria-label={`Expected share of ${m.label}`} inputMode="decimal" value={share} style={{ width: 80 }} onChange={(e) => setShare(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={async () => {
              const r = await setMeterShareAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId, sharePct: share.trim() === '' ? null : Number(share) })
              if ('error' in r) setMsg(r.error); else router.refresh()
            }}>Save share</Button>
          </span>
        ) : (m.sharePct === null ? 'equal' : `${m.sharePct} %`)) : '—'}
        {msg ? <span role="alert" style={{ color: 'var(--c-red)', marginLeft: 8 }}>{msg}</span> : null}
      </td>
      <td>
        {p.canEdit ? (armed
          ? <Button size="sm" variant="danger" aria-label={`Confirm unlink ${m.label}`} onClick={async () => {
              disarm()
              const r = await unlinkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId })
              if ('error' in r) setMsg(r.error); else router.refresh()
            }}>Confirm</Button>
          : <Button size="sm" variant="ghost" aria-label={`Unlink ${m.label}`} onClick={arm}>Unlink</Button>) : null}
      </td>
    </tr>
  )
}

export function MetersCard(p: Props) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const generation = p.meters.filter((m) => m.role === 'generation')
  const equal = generation.length > 0 && generation.every((m) => m.sharePct === null)
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Meters</span></CardHeader>
      <CardBody>
        {p.meters.length === 0 ? <p style={HINT}>No meter is linked yet. Import generation data below, or link a meter already in the study.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Meter</th><th align="left">Role</th><th align="left">Expected share</th><th /></tr></thead>
            <tbody>{p.meters.map((m) => <MeterRow key={m.meterId} p={p} m={m} />)}</tbody>
          </table>
        )}
        {equal ? <p style={{ ...HINT, marginTop: 8 }}>The guarantee is allocated equally between the generation meters until you set shares.</p> : null}
        {p.canEdit && p.availableMeters.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
            <FormField label="Meter to link" htmlFor="ops-link">
              <Select id="ops-link" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {p.availableMeters.map((m) => <option key={m.meterId} value={m.meterId}>{`${m.label} (${m.kind})`}</option>)}
              </Select>
            </FormField>
            <Button disabled={!pick} onClick={async () => {
              const m = p.availableMeters.find((x) => x.meterId === pick)
              if (!m) return
              const r = await linkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId, role: m.kind === 'solar' ? 'generation' : 'consumption' })
              if ('error' in r) { setMsg(r.error); return }
              setPick('')
              router.refresh()
            }}>Link meter</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)', marginTop: 8 }}>{msg}</p> : null}
        {p.canEdit ? (
          <div style={{ marginTop: 16 }}>
            <GenerationImport projectId={p.projectId} organisationId={p.organisationId} installationId={p.installationId}
              generationMeters={generation.map((m) => ({ meterId: m.meterId, label: m.label }))} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
```

`$OPS/GenerationImport.tsx`:
```tsx
'use client'
/**
 * Import generation data (spec §10) through the EXISTING meter pipeline (Phase 3a): upload the raw file
 * to solar-meter-raw by its SHA-256, register it, parse it server-side, commit it as a series to a solar
 * meter. Readings upsert on (channel, interval end) and the Operations aggregation keeps one reading per
 * meter per interval, so importing the same or an overlapping export REPLACES those intervals. Months
 * come from the file's own timestamps.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { linkMeterAction } from '@/actions/solar-operations.actions'

interface Props {
  projectId: string
  organisationId: string
  installationId: string
  generationMeters: Array<{ meterId: string; label: string }>
}
interface Review { fileId: string; outcome: string; canAccept: boolean; blockingErrors: string[]; choicesNeeded: string[] }

const EXT = /\.(csv|txt|xlsx|xls)$/i

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export function GenerationImport(p: Props) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState(p.generationMeters[0]?.meterId ?? 'new')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null); setProblems([]); setDone(null)
    if (!file) { setError('Choose a file first.'); return }
    const ext = EXT.exec(file.name)?.[1]?.toLowerCase()
    if (!ext) { setError('Choose a .csv, .txt, .xlsx or .xls export.'); return }
    if (target === 'new' && newLabel.trim() === '') { setError('Name the new meter.'); return }
    setBusy(true)
    try {
      const sha = await sha256Hex(await readBytes(file))
      const storagePath = `${p.organisationId}/${p.projectId}/${sha}.${ext}`
      const { error: upErr } = await createClient().storage.from('solar-meter-raw').upload(storagePath, file, { upsert: false })
      if (upErr && !/exist/i.test(upErr.message ?? '')) { setError('The file could not be uploaded — try again.'); return }
      const base = `/api/projects/${p.projectId}/solar/meter-files`
      const reg = await postJson(base, { storagePath, originalName: file.name })
      if (!reg.ok) {
        setError(reg.json.error === 'duplicate_in_other_project' ? 'This exact file is already imported on another project.' : 'The file could not be registered — try again.')
        return
      }
      const fileId = String(reg.json.fileId)
      const parsed = await postJson(`${base}/parse`, { fileIds: [fileId] })
      const review = ((parsed.json.results as Array<{ reviews?: Review[] }> | undefined)?.[0]?.reviews?.[0]) ?? null
      if (!parsed.ok || !review) { setError('The file could not be read.'); return }
      if (review.outcome !== 'series' || !review.canAccept) {
        setProblems([...(review.blockingErrors ?? []), ...(review.choicesNeeded ?? [])])
        if (review.outcome !== 'series') setError('This is not a time series of readings.')
        return
      }
      const meter = target === 'new' ? { new: { label: newLabel.trim(), kind: 'solar' } } : { existingMeterId: target }
      const commit = await postJson(`${base}/commit`, { mode: 'series', fileId, meter, identity: { resolution: 'none' } })
      if (!commit.ok) { setError(typeof commit.json.error === 'string' ? `The import was refused: ${commit.json.error}.` : 'The import failed — try again.'); return }
      const meterId = String(commit.json.meterId)
      if (!p.generationMeters.some((m) => m.meterId === meterId)) {
        const r = await linkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId, role: 'generation' })
        if ('error' in r) { setError(r.error); return }
      }
      setDone(`Imported to ${String(commit.json.meterLabel ?? 'the meter')}. Months are taken from the file’s own timestamps; re-importing replaces those intervals.`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span className="data-panel-title">Import generation data</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <FormField label="Generation file" htmlFor="ops-gen-file">
          <input id="ops-gen-file" type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
        <FormField label="Into meter" htmlFor="ops-gen-target">
          <Select id="ops-gen-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {p.generationMeters.map((m) => <option key={m.meterId} value={m.meterId}>{m.label}</option>)}
            <option value="new">New solar meter…</option>
          </Select>
        </FormField>
        {target === 'new' ? (
          <FormField label="New meter name" htmlFor="ops-gen-name">
            <TextInput id="ops-gen-name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </FormField>
        ) : null}
        <Button disabled={busy} onClick={run}>Import generation data</Button>
      </div>
      {problems.length > 0 ? (
        <div role="alert">
          <p style={{ fontSize: 13, margin: 0 }}>This file needs attention before it can be imported:</p>
          <ul style={{ fontSize: 13 }}>{problems.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {error ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)', margin: 0 }}>{error}</p> : null}
      {done ? <p role="status" style={{ fontSize: 13, margin: 0 }}>{done}</p> : null}
    </div>
  )
}
```

- [ ] **Step 3: Run — PASS (the three files + the browser-engine contract); commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations' src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -6
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations'
git commit -m "feat(solar): installation, meters and generation import (existing meter pipeline)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Guarantee card, irradiation card, performance table

**Files:**
- Replace: `$OPS/GuaranteeCard.tsx`, `$OPS/IrradiationCard.tsx`, `$OPS/PerformanceTable.tsx`
- Create: `$OPS/GuaranteeCard.test.tsx`, `$OPS/IrradiationCard.test.tsx`, `$OPS/PerformanceTable.test.tsx`

- [ ] **Step 1: Failing tests.**

`GuaranteeCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true, updatedAt: 'G2' })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ saveGuaranteeAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { GuaranteeCard } from './GuaranteeCard'

const g = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0.45, updatedAt: 'G1' }
beforeEach(() => vi.clearAllMocks())

describe('GuaranteeCard', () => {
  it('saves % of modelled with its percentage', async () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    fireEvent.change(screen.getByLabelText('Guarantee basis'), { target: { value: 'pct_of_modelled' } })
    fireEvent.change(screen.getByLabelText('Percentage of modelled'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save guarantee' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', expectedUpdatedAt: 'G1',
      guarantee: { basis: 'pct_of_modelled', pct: 90, manualMonthlyKwh: null, degradationPctPerYear: 0.45 } }))
  })
  it('manual basis offers twelve months', async () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    fireEvent.change(screen.getByLabelText('Guarantee basis'), { target: { value: 'manual' } })
    expect(screen.getAllByLabelText(/kWh guaranteed in/)).toHaveLength(12)
  })
  it('explains that nobody retypes it monthly', () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit={false} guarantee={g} />)
    expect(screen.getByText(/derived for every month automatically/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save guarantee' })).toBeNull()
  })
})
```

`IrradiationCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true })), del: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ saveIrradiationAction: h.save, deleteIrradiationAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { IrradiationCard } from './IrradiationCard'
beforeEach(() => vi.clearAllMocks())

describe('IrradiationCard', () => {
  it('records a month with its plane and source', async () => {
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit entries={[]} />)
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-03' } })
    fireEvent.change(screen.getByLabelText('Plane'), { target: { value: 'poa' } })
    fireEvent.change(screen.getByLabelText('Irradiation kWh/m²'), { target: { value: '150.5' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Site pyranometer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save irradiation' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03', plane: 'poa', kwhPerM2: 150.5, sourceNote: 'Site pyranometer' }))
  })
  it('lists entries and removes one', async () => {
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit entries={[{ month: '2026-03', plane: 'ghi', kwhPerM2: 180, sourceNote: 'Portal' }]} />)
    expect(screen.getByText('March 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove March 2026' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03' }))
  })
})
```

`PerformanceTable.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceTable } from './PerformanceTable'

const row = (month: string, actual: number | null, pr: number | null = null) => ({ month, operatingYear: 1, expectedKwh: 1000, excludedKwh: 16, guaranteeKwh: 984,
  actualKwh: actual, varianceKwh: actual === null ? null : actual - 984, variancePct: actual === null ? null : ((actual - 984) / 984) * 100,
  performanceRatio: pr, correctedExpectedKwh: pr === null ? null : 1100, irradiationPlane: pr === null ? null : ('poa' as const), downtimeHours: 2, excludedHours: 1, coveragePct: actual === null ? null : 99.5 })

describe('PerformanceTable', () => {
  it('one row per month with expected, actual, variance, PR, corrected expected, downtime and coverage', () => {
    render(<PerformanceTable projectId="p1" rows={[row('2026-02', null), row('2026-03', 900, 0.79)]} selectedMonth="2026-03" />)
    const march = screen.getByRole('row', { name: /March 2026/ })
    expect(march.textContent).toContain('984')
    expect(march.textContent).toContain('900')
    expect(march.textContent).toContain('-8.5 %')
    expect(march.textContent).toContain('0.79')
    expect(march.textContent).toContain('1 100')
    expect(march.textContent).toContain('99.5 %')
    expect(screen.getByRole('row', { name: /February 2026/ }).textContent).toContain('no data')
    expect(screen.getByRole('link', { name: 'February 2026' }).getAttribute('href')).toBe('/projects/p1/solar/operations?month=2026-02')
  })
  it('an empty table says what to do', () => {
    render(<PerformanceTable projectId="p1" rows={[]} selectedMonth={null} />)
    expect(screen.getByText(/Set the commissioning date and import generation data/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`$OPS/GuaranteeCard.tsx`:
```tsx
'use client'
/** Guarantee basis (spec §10): expected kWh is derived for every month automatically — never retyped (WM D.7). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GUARANTEE_BASES, GUARANTEE_BASIS_LABELS, MONTH_NAMES, type Guarantee, type GuaranteeBasis } from '@esite/shared/solar-operations/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { saveGuaranteeAction } from '@/actions/solar-operations.actions'

interface Props { projectId: string; installationId: string; canEdit: boolean; guarantee: (Guarantee & { updatedAt: string }) | null }

export function GuaranteeCard({ projectId, installationId, canEdit, guarantee }: Props) {
  const router = useRouter()
  const [basis, setBasis] = useState<GuaranteeBasis>(guarantee?.basis ?? 'p50')
  const [pct, setPct] = useState(guarantee?.pct === null || guarantee?.pct === undefined ? '' : String(guarantee.pct))
  const [deg, setDeg] = useState(String(guarantee?.degradationPctPerYear ?? 0))
  const [manual, setManual] = useState<string[]>((guarantee?.manualMonthlyKwh ?? new Array(12).fill('')).map((v) => String(v)))
  const [updatedAt, setUpdatedAt] = useState<string | null>(guarantee?.updatedAt ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    const r = await saveGuaranteeAction({
      projectId, installationId, expectedUpdatedAt: updatedAt,
      guarantee: {
        basis, pct: basis === 'pct_of_modelled' ? Number(pct) : null,
        manualMonthlyKwh: basis === 'manual' ? manual.map((v) => Number(v)) : null,
        degradationPctPerYear: Number(deg),
      },
    })
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    setErrors({})
    if ('error' in r) { setMsg(r.error); return }
    setUpdatedAt(r.updatedAt)
    setMsg('Saved.')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Guarantee</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>
          Expected generation is derived for every month automatically from this basis and the frozen baseline. The commissioning month is prorated; degradation applies from operating year 2 (not to a manual schedule).
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <FormField label="Guarantee basis" htmlFor="ops-basis" error={errors.basis}>
            <Select id="ops-basis" value={basis} disabled={!canEdit} onChange={(e) => setBasis(e.target.value as GuaranteeBasis)}>
              {GUARANTEE_BASES.map((b) => <option key={b} value={b}>{GUARANTEE_BASIS_LABELS[b]}</option>)}
            </Select>
          </FormField>
          {basis === 'pct_of_modelled' ? (
            <FormField label="Percentage of modelled" htmlFor="ops-pct" error={errors.pct}>
              <TextInput id="ops-pct" inputMode="decimal" value={pct} disabled={!canEdit} onChange={(e) => setPct(e.target.value)} />
            </FormField>
          ) : null}
          {basis !== 'manual' ? (
            <FormField label="Degradation % a year" htmlFor="ops-deg" error={errors.degradationPctPerYear}>
              <TextInput id="ops-deg" inputMode="decimal" value={deg} disabled={!canEdit} onChange={(e) => setDeg(e.target.value)} />
            </FormField>
          ) : null}
        </div>
        {basis === 'manual' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
            {MONTH_NAMES.map((name, k) => (
              <FormField key={name} label={name} htmlFor={`ops-man-${k}`}>
                <TextInput id={`ops-man-${k}`} aria-label={`kWh guaranteed in ${name}`} inputMode="decimal" value={manual[k] ?? ''} disabled={!canEdit}
                  onChange={(e) => setManual((m) => m.map((v, i) => (i === k ? e.target.value : v)))} />
              </FormField>
            ))}
            {errors.manualMonthlyKwh ? <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.manualMonthlyKwh}</p> : null}
          </div>
        ) : null}
        {canEdit ? <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button onClick={save}>Save guarantee</Button>
          {msg ? <span role="status" style={{ fontSize: 13 }}>{msg}</span> : null}
        </div> : null}
      </CardBody>
    </Card>
  )
}
```

`$OPS/IrradiationCard.tsx`:
```tsx
'use client'
/**
 * Measured irradiation per month ("irradiation-corrected expected, if weather uploaded"): plane of array
 * gives PR; horizontal (GHI) gives a ratio correction against the TMY. A source note is mandatory.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { monthLabel } from '@esite/shared/solar-operations/client'
import type { IrradiationRecord } from '@esite/shared/solar-operations'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { deleteIrradiationAction, saveIrradiationAction } from '@/actions/solar-operations.actions'

interface Props { projectId: string; installationId: string; canEdit: boolean; entries: IrradiationRecord[] }

export function IrradiationCard({ projectId, installationId, canEdit, entries }: Props) {
  const router = useRouter()
  const [month, setMonth] = useState('')
  const [plane, setPlane] = useState<'ghi' | 'poa'>('poa')
  const [value, setValue] = useState('')
  const [source, setSource] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Measured irradiation</span></CardHeader>
      <CardBody>
        {entries.length === 0 ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>None recorded. Without it the table shows no PR and no irradiation-corrected expectation.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Month</th><th align="left">Plane</th><th align="right">kWh/m²</th><th align="left">Source</th><th /></tr></thead>
            <tbody>{entries.map((e) => (
              <tr key={e.month}>
                <td>{monthLabel(e.month)}</td><td>{e.plane === 'poa' ? 'Plane of array' : 'Horizontal (GHI)'}</td>
                <td align="right">{e.kwhPerM2}</td><td>{e.sourceNote}</td>
                <td>{canEdit ? <Button size="sm" variant="ghost" aria-label={`Remove ${monthLabel(e.month)}`} onClick={async () => {
                  const r = await deleteIrradiationAction({ projectId, installationId, month: e.month })
                  if ('error' in r) setMsg(r.error); else router.refresh()
                }}>Remove</Button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <FormField label="Month" htmlFor="ops-irr-month" error={errors.month}><TextInput id="ops-irr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField>
            <FormField label="Plane" htmlFor="ops-irr-plane"><Select id="ops-irr-plane" value={plane} onChange={(e) => setPlane(e.target.value as 'ghi' | 'poa')}>
              <option value="poa">Plane of array (POA)</option><option value="ghi">Horizontal (GHI)</option></Select></FormField>
            <FormField label="Irradiation kWh/m²" htmlFor="ops-irr-val" error={errors.kwhPerM2}><TextInput id="ops-irr-val" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></FormField>
            <FormField label="Source" htmlFor="ops-irr-src" error={errors.sourceNote}><TextInput id="ops-irr-src" value={source} onChange={(e) => setSource(e.target.value)} /></FormField>
            <Button onClick={async () => {
              const r = await saveIrradiationAction({ projectId, installationId, month, plane, kwhPerM2: Number(value), sourceNote: source })
              if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
              setErrors({})
              if ('error' in r) { setMsg(r.error); return }
              setMonth(''); setValue(''); setSource('')
              router.refresh()
            }}>Save irradiation</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
```

`$OPS/PerformanceTable.tsx` (server-rendered, no hooks):
```tsx
/** Monthly performance (spec §10): one row per month from the shared calculation; the month link selects it. */
import Link from 'next/link'
import { monthLabel } from '@esite/shared/solar-operations/client'
import type { PerformanceRow } from '@esite/shared/solar-operations'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { kwh, pctSigned } from '@/components/solar/ops-format'

interface Props { projectId: string; rows: PerformanceRow[]; selectedMonth: string | null }

export function PerformanceTable({ projectId, rows, selectedMonth }: Props) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Monthly performance</span></CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>Set the commissioning date and import generation data to see monthly performance.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Month</th><th align="right">Expected kWh</th><th align="right">Excluded kWh</th><th align="right">Guarantee kWh</th>
                <th align="right">Actual kWh</th><th align="right">Variance</th><th align="right">PR</th><th align="right">Irradiation-corrected kWh</th>
                <th align="right">Downtime h</th><th align="right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} aria-label={monthLabel(r.month)} style={r.month === selectedMonth ? { background: 'var(--c-panel)' } : undefined}>
                  <td><Link href={`/projects/${projectId}/solar/operations?month=${r.month}`}>{monthLabel(r.month)}</Link></td>
                  <td align="right">{kwh(r.expectedKwh)}</td>
                  <td align="right">{kwh(r.excludedKwh)}</td>
                  <td align="right">{kwh(r.guaranteeKwh)}</td>
                  <td align="right">{r.actualKwh === null ? 'no data' : kwh(r.actualKwh)}</td>
                  <td align="right">{pctSigned(r.variancePct)}</td>
                  <td align="right">{r.performanceRatio === null ? '—' : r.performanceRatio.toFixed(2)}</td>
                  <td align="right">{kwh(r.correctedExpectedKwh)}</td>
                  <td align="right">{`${r.downtimeHours.toFixed(1)}${r.excludedHours > 0 ? ` (${r.excludedHours.toFixed(1)} excl.)` : ''}`}</td>
                  <td align="right">{r.coveragePct === null ? '—' : `${r.coveragePct.toFixed(1)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations' src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -6
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations'
git commit -m "feat(solar): guarantee basis, measured irradiation and the monthly performance table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: Downtime log with auto-detected candidates

**Files:**
- Replace: `$OPS/DowntimeLog.tsx`; Create: `$OPS/DowntimeLog.test.tsx`

- [ ] **Step 1: Failing test** `DowntimeLog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ add: vi.fn(async () => ({ ok: true, id: 'd9' })), upd: vi.fn(async () => ({ ok: true, updatedAt: 'D2' })), del: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ addDowntimeAction: h.add, updateDowntimeAction: h.upd, deleteDowntimeAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { DowntimeLog } from './DowntimeLog'

const row = { id: 'd1', startsAt: '2026-03-10T08:00:00.000Z', endsAt: '2026-03-10T10:00:00.000Z', cause: 'grid_outage', description: 'Eskom',
  excludedFromGuarantee: true, source: 'manual' as const, updatedAt: 'D1', lostKwh: 16.1 }
const cand = { startsAt: '2026-03-12T09:30:00.000Z', endsAt: '2026-03-12T11:00:00.000Z', intervals: 3, hours: 1.5 }
beforeEach(() => vi.clearAllMocks())

describe('DowntimeLog', () => {
  it('lists downtime in SAST with lost kWh and the guarantee flag', () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    const r = screen.getByRole('row', { name: /2026-03-10 10:00/ })
    expect(r.textContent).toContain('2026-03-10 12:00')
    expect(r.textContent).toContain('Grid outage')
    expect(r.textContent).toContain('Excluded')
    expect(r.textContent).toContain('16')
  })
  it('adds downtime from the form (datetime-local is SAST)', async () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[]} selectedMonth="2026-03" />)
    fireEvent.change(screen.getByLabelText('Start (SAST)'), { target: { value: '2026-03-11T10:00' } })
    fireEvent.change(screen.getByLabelText('End (SAST)'), { target: { value: '2026-03-11T12:00' } })
    fireEvent.change(screen.getByLabelText('Cause'), { target: { value: 'inverter_fault' } })
    fireEvent.click(screen.getByLabelText('Excluded from the guarantee'))
    fireEvent.click(screen.getByRole('button', { name: 'Add downtime' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', startsAt: '2026-03-11T10:00', endsAt: '2026-03-11T12:00',
      cause: 'inverter_fault', description: '', excludedFromGuarantee: true, source: 'manual' }))
  })
  it('confirming a candidate records it as detected with the chosen cause', async () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[cand]} selectedMonth="2026-03" />)
    expect(screen.getByText(/zero output while the sun was more than 5°/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cause for 2026-03-12 11:30'), { target: { value: 'communications' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 2026-03-12 11:30' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith(expect.objectContaining({ startsAt: cand.startsAt, endsAt: cand.endsAt, cause: 'communications', source: 'detected' })))
  })
  it('dismiss hides a candidate without writing', () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[cand]} selectedMonth="2026-03" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2026-03-12 11:30' }))
    expect(screen.queryByRole('button', { name: 'Confirm 2026-03-12 11:30' })).toBeNull()
    expect(h.add).not.toHaveBeenCalled()
  })
  it('delete needs a second press; View level has no controls', async () => {
    const { unmount } = render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete downtime 2026-03-10 10:00' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete 2026-03-10 10:00' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', id: 'd1' }))
    unmount()
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit={false} downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    expect(screen.queryByRole('button', { name: 'Add downtime' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `$OPS/DowntimeLog.tsx`:

```tsx
'use client'
/**
 * Downtime log (spec §10): recorded outages (start, end, cause, excluded from the guarantee?) and the
 * auto-detected candidates for the selected month — zero output while the sun is above 5° (the engine's
 * SPA, computed on the server), never a missing reading. Confirm records a candidate; every edit and
 * delete is kept in solar.downtime_history.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAUSE_LABELS, isoToSastLocal, monthLabel } from '@esite/shared/solar-operations/client'
import type { DowntimeCandidate } from '@esite/shared/solar-operations'
import type { OpsDowntimeView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { addDowntimeAction, deleteDowntimeAction, updateDowntimeAction } from '@/actions/solar-operations.actions'
import { kwh, sastDateTime } from '@/components/solar/ops-format'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

interface Props {
  projectId: string; installationId: string; canEdit: boolean
  downtime: OpsDowntimeView[]; candidates: DowntimeCandidate[]; selectedMonth: string | null
}
const CAUSES = Object.keys(CAUSE_LABELS)
const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const

function DowntimeRow({ p, d }: { p: Props; d: OpsDowntimeView }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(isoToSastLocal(d.startsAt))
  const [end, setEnd] = useState(isoToSastLocal(d.endsAt))
  const [cause, setCause] = useState(d.cause)
  const [excluded, setExcluded] = useState(d.excludedFromGuarantee)
  const [msg, setMsg] = useState<string | null>(null)
  const label = sastDateTime(d.startsAt)
  if (editing) {
    return (
      <tr><td colSpan={7}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <FormField label="Start (SAST)" htmlFor={`e-s-${d.id}`}><TextInput id={`e-s-${d.id}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="End (SAST)" htmlFor={`e-e-${d.id}`}><TextInput id={`e-e-${d.id}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
          <FormField label="Cause" htmlFor={`e-c-${d.id}`}><Select id={`e-c-${d.id}`} value={cause} onChange={(e) => setCause(e.target.value)}>
            {CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABELS[c]}</option>)}</Select></FormField>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Excluded from the guarantee</label>
          <Button size="sm" onClick={async () => {
            const r = await updateDowntimeAction({ projectId: p.projectId, id: d.id, startsAt: start, endsAt: end, cause, description: d.description ?? '', excludedFromGuarantee: excluded, expectedUpdatedAt: d.updatedAt })
            if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
            if ('error' in r) { setMsg(r.error); return }
            setEditing(false)
            router.refresh()
          }}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          {msg ? <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{msg}</span> : null}
        </div>
      </td></tr>
    )
  }
  return (
    <tr aria-label={label}>
      <td>{label}</td>
      <td>{sastDateTime(d.endsAt)}</td>
      <td>{d.description ? `${CAUSE_LABELS[d.cause] ?? d.cause}: ${d.description}` : (CAUSE_LABELS[d.cause] ?? d.cause)}</td>
      <td>{d.excludedFromGuarantee ? 'Excluded' : 'Counts'}</td>
      <td>{d.source === 'detected' ? 'Detected' : 'Manual'}</td>
      <td align="right">{d.lostKwh === null ? '—' : kwh(d.lostKwh)}</td>
      <td>
        {p.canEdit ? <span style={{ display: 'inline-flex', gap: 4 }}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          {armed
            ? <Button size="sm" variant="danger" aria-label={`Confirm delete ${label}`} onClick={async () => {
                disarm()
                const r = await deleteDowntimeAction({ projectId: p.projectId, id: d.id })
                if ('error' in r) setMsg(r.error); else router.refresh()
              }}>Confirm</Button>
            : <Button size="sm" variant="ghost" aria-label={`Delete downtime ${label}`} onClick={arm}>Delete</Button>}
        </span> : null}
        {msg ? <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{msg}</span> : null}
      </td>
    </tr>
  )
}

export function DowntimeLog(p: Props) {
  const router = useRouter()
  const [hidden, setHidden] = useState<string[]>([])
  const [candCause, setCandCause] = useState<Record<string, string>>({})
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cause, setCause] = useState('grid_outage')
  const [description, setDescription] = useState('')
  const [excluded, setExcluded] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const visible = p.candidates.filter((c) => !hidden.includes(c.startsAt))

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Downtime</span></CardHeader>
      <CardBody>
        {p.downtime.length === 0 ? <p style={HINT}>No downtime recorded.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Start (SAST)</th><th align="left">End (SAST)</th><th align="left">Cause</th><th align="left">Guarantee</th><th align="left">Source</th>
              <th align="right">{`Lost kWh${p.selectedMonth ? ` (${monthLabel(p.selectedMonth)})` : ''}`}</th><th /></tr></thead>
            <tbody>{p.downtime.map((d) => <DowntimeRow key={d.id} p={p} d={d} />)}</tbody>
          </table>
        )}
        {p.canEdit && visible.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <p style={HINT}>{`Possible downtime in ${p.selectedMonth ? monthLabel(p.selectedMonth) : 'this month'}: zero output while the sun was more than 5° above the horizon. Missing readings are never proposed.`}</p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {visible.map((c) => {
                const l = sastDateTime(c.startsAt)
                return (
                  <li key={c.startsAt} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ minWidth: 260, fontSize: 13 }}>{`${l} to ${sastDateTime(c.endsAt)} (${c.hours} h)`}</span>
                    <Select aria-label={`Cause for ${l}`} value={candCause[c.startsAt] ?? 'other'} onChange={(e) => setCandCause((m) => ({ ...m, [c.startsAt]: e.target.value }))}>
                      {CAUSES.map((x) => <option key={x} value={x}>{CAUSE_LABELS[x]}</option>)}
                    </Select>
                    <Button size="sm" aria-label={`Confirm ${l}`} onClick={async () => {
                      const r = await addDowntimeAction({ projectId: p.projectId, installationId: p.installationId, startsAt: c.startsAt, endsAt: c.endsAt,
                        cause: candCause[c.startsAt] ?? 'other', description: '', excludedFromGuarantee: false, source: 'detected' })
                      if ('error' in r) { setMsg(r.error); return }
                      if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
                      router.refresh()
                    }}>Confirm</Button>
                    <Button size="sm" variant="ghost" aria-label={`Dismiss ${l}`} onClick={() => setHidden((hs) => [...hs, c.startsAt])}>Dismiss</Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {p.canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 }}>
            <FormField label="Start (SAST)" htmlFor="dt-start" error={errors.startsAt}><TextInput id="dt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
            <FormField label="End (SAST)" htmlFor="dt-end" error={errors.endsAt}><TextInput id="dt-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
            <FormField label="Cause" htmlFor="dt-cause" error={errors.cause}><Select id="dt-cause" value={cause} onChange={(e) => setCause(e.target.value)}>
              {CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABELS[c]}</option>)}</Select></FormField>
            <FormField label="Description" htmlFor="dt-desc" error={errors.description}><TextInput id="dt-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Excluded from the guarantee</label>
            <Button onClick={async () => {
              const r = await addDowntimeAction({ projectId: p.projectId, installationId: p.installationId, startsAt: start, endsAt: end, cause, description, excludedFromGuarantee: excluded, source: 'manual' })
              if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
              setErrors({})
              if ('error' in r) { setMsg(r.error); return }
              setStart(''); setEnd(''); setDescription(''); setExcluded(false)
              router.refresh()
            }}>Add downtime</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
```
(The checkbox's accessible name is its wrapping `<label>` text, so `getByLabelText('Excluded from the guarantee')` finds it. When a row is in edit mode a second checkbox with the same label exists; the test does not open an editor.)

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations/DowntimeLog' 2>&1 | tail -6
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/DowntimeLog.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/DowntimeLog.test.tsx'
git commit -m "feat(solar): downtime log with SPA-detected candidates to confirm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 30: Monthly report panel (commentary + Generate + versions)

**Files:**
- Replace: `$OPS/MonthlyReportPanel.tsx`; Create: `$OPS/MonthlyReportPanel.test.tsx`

- [ ] **Step 1: Failing test** `MonthlyReportPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(async () => ({ ok: true, reportId: 'r2', version: 2, warning: null })), note: vi.fn(async () => ({ ok: true, updatedAt: 'N2' })), refresh: vi.fn() }))
vi.mock('@/actions/solar-monthly-report.actions', () => ({ generateSolarMonthlyReportAction: h.gen, saveMonthlyReportNoteAction: h.note }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: (p: { kind: string; source?: { table: string; id: string } }) => <div data-testid="saved">{`${p.kind}:${p.source?.table}:${p.source?.id}`}</div> }))
import { MonthlyReportPanel } from './MonthlyReportPanel'

const monthly = (reason: string | null) => ({
  notes: { summary: 'Good', performance: '', downtime: '', financial: '', actions: '' },
  notesUpdatedAt: { summary: 'N1', performance: null, downtime: null, financial: null, actions: null },
  generateReason: reason, tariffName: reason ? null : 'Business 1 (City of Tshwane, 2026/27)',
})
beforeEach(() => vi.clearAllMocks())

describe('MonthlyReportPanel', () => {
  it('Generate is disabled with the reason (e.g. no pinned tariff)', () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly('No tariff is pinned for this study — pin one on the Tariff tab.')} />)
    expect((screen.getByRole('button', { name: 'Generate report for March 2026' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('No tariff is pinned for this study — pin one on the Tariff tab.')).toBeTruthy()
  })
  it('generates a new version with the revision note and lists versions for the installation', async () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly(null)} />)
    expect(screen.getByText(/Business 1 \(City of Tshwane, 2026\/27\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Revision note'), { target: { value: 'Rev B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate report for March 2026' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-03', note: 'Rev B' }))
    expect(await screen.findByText('Version 2 saved.')).toBeTruthy()
    expect(screen.getByTestId('saved').textContent).toBe('solar_monthly:solar.installations:i1')
  })
  it('saves one commentary section on its own version (numbers are never frozen by typing)', async () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly(null)} />)
    fireEvent.change(screen.getByLabelText('Summary commentary'), { target: { value: 'Great month' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Summary commentary' }))
    await waitFor(() => expect(h.note).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03', section: 'summary', body: 'Great month', expectedUpdatedAt: 'N1' }))
    fireEvent.change(screen.getByLabelText('Actions'), { target: { value: 'Replace fuse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Actions' }))
    await waitFor(() => expect(h.note).toHaveBeenLastCalledWith(expect.objectContaining({ section: 'actions', expectedUpdatedAt: null })))
  })
  it('no month yet: says why', () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month={null} monthly={monthly('Import generation data first.')} />)
    expect(screen.getByText('Import generation data first.')).toBeTruthy()
    expect(screen.queryByLabelText('Summary commentary')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `$OPS/MonthlyReportPanel.tsx`:

```tsx
'use client'
/**
 * Monthly client report (spec §10), Edit + financials only. Commentary is stored per section and month
 * (solar.monthly_report_notes) — typing never freezes a number (WM M1). Generate freezes a snapshot and
 * a PDF as a NEW version; earlier versions are listed and never edited.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { monthLabel, NOTE_SECTION_LABELS, NOTE_SECTIONS, type NoteSection } from '@esite/shared/solar-operations/client'
import type { OpsMonthlyView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Textarea } from '@/components/ui/FormField'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { generateSolarMonthlyReportAction, saveMonthlyReportNoteAction } from '@/actions/solar-monthly-report.actions'

interface Props { projectId: string; installationId: string; month: string | null; monthly: OpsMonthlyView }

function NoteField({ p, section }: { p: Props & { month: string }; section: NoteSection }) {
  const [body, setBody] = useState(p.monthly.notes[section])
  const [updatedAt, setUpdatedAt] = useState<string | null>(p.monthly.notesUpdatedAt[section])
  const [msg, setMsg] = useState<string | null>(null)
  const label = NOTE_SECTION_LABELS[section]
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <FormField label={label} htmlFor={`note-${section}`}>
        <Textarea id={`note-${section}`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="sm" variant="secondary" aria-label={`Save ${label}`} onClick={async () => {
          const r = await saveMonthlyReportNoteAction({ projectId: p.projectId, installationId: p.installationId, month: p.month, section, body, expectedUpdatedAt: updatedAt })
          if ('error' in r) { setMsg(r.error); return }
          setUpdatedAt(r.updatedAt)
          setMsg('Saved.')
        }}>Save</Button>
        {msg ? <span role="status" style={{ fontSize: 12 }}>{msg}</span> : null}
      </div>
    </div>
  )
}

export function MonthlyReportPanel(p: Props) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reason = p.monthly.generateReason
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{p.month ? `Monthly report — ${monthLabel(p.month)}` : 'Monthly report'}</span></CardHeader>
      <CardBody>
        {reason ? <p role="note" style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>{reason}</p> : null}
        {p.monthly.tariffName ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>{`Lost revenue is valued at ${p.monthly.tariffName} time-of-use rates.`}</p> : null}
        {p.month ? (
          <>
            <div style={{ display: 'grid', gap: 12 }}>
              {NOTE_SECTIONS.map((s) => <NoteField key={`${p.month}-${s}`} p={{ ...p, month: p.month! }} section={s} />)}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 16 }}>
              <FormField label="Revision note" htmlFor="monthly-note"><TextInput id="monthly-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
              <Button disabled={busy || reason !== null} onClick={async () => {
                setBusy(true)
                const r = await generateSolarMonthlyReportAction({ projectId: p.projectId, month: p.month!, note })
                setBusy(false)
                if ('error' in r) { setMsg(r.error); return }
                setMsg(r.warning ? `Version ${r.version} saved. ${r.warning}` : `Version ${r.version} saved.`)
                setNote('')
                setReloadKey((k) => k + 1)
                router.refresh()
              }}>{`Generate report for ${monthLabel(p.month)}`}</Button>
            </div>
            {msg ? <p role="status" style={{ fontSize: 13 }}>{msg}</p> : null}
          </>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <SavedReportsPanel projectId={p.projectId} kind="solar_monthly" source={{ table: 'solar.installations', id: p.installationId }}
            canManage={false} title="Monthly reports" reloadKey={reloadKey} />
        </div>
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations/MonthlyReportPanel' 2>&1 | tail -6
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/MonthlyReportPanel.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/MonthlyReportPanel.test.tsx'
git commit -m "feat(solar): monthly report panel — separate commentary, versioned generation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 31: Handover checklist + the org template card in `/settings/solar`

**Files:**
- Replace: `$OPS/HandoverChecklist.tsx`; Create: `$OPS/HandoverChecklist.test.tsx`
- Create: `apps/web/src/app/(admin)/settings/solar/HandoverTemplateForm.tsx`, `HandoverTemplateForm.test.tsx`
- Modify: `apps/web/src/app/(admin)/settings/solar/page.tsx`

- [ ] **Step 1: Failing tests.**

`HandoverChecklist.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ link: vi.fn(async () => ({ ok: true })), na: vi.fn(async () => ({ ok: true })), sync: vi.fn(async () => ({ ok: true, added: 2 })), refresh: vi.fn() }))
vi.mock('@/actions/solar-handover.actions', () => ({ linkHandoverDocumentAction: h.link, setHandoverNotApplicableAction: h.na, syncHandoverItemsAction: h.sync }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { HandoverChecklist } from './HandoverChecklist'

const item = (over: Record<string, unknown>) => ({ id: 'h1', key: 'coc', label: 'Certificate of Compliance (CoC)', required: true, sortOrder: 0, documentId: null, documentName: null,
  notApplicable: false, note: null, completedAt: null, updatedAt: 'U', ...over })
const handover = {
  items: [item({}), item({ id: 'h2', key: 'om_manual', label: 'O&M manual', documentId: 'd2', documentName: 'OM.pdf', completedAt: 'C' })],
  completion: { done: 1, total: 2, pct: 50, requiredDone: 1, requiredTotal: 2 },
  documents: [{ id: 'd1', name: 'CoC.pdf' }, { id: 'd2', name: 'OM.pdf' }],
  templateName: 'Solar PV Handover',
}
beforeEach(() => vi.clearAllMocks())

describe('HandoverChecklist', () => {
  it('shows completion and links a Documents file to an item', async () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit handover={handover} />)
    expect(screen.getByText('1 of 2 items (50 %) · 1 of 2 required')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Document for Certificate of Compliance (CoC)'), { target: { value: 'd1' } })
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', itemId: 'h1', documentId: 'd1' }))
    expect(screen.getByRole('link', { name: 'Upload to Documents' }).getAttribute('href')).toBe('/projects/p1/documents')
  })
  it('marks an item N/A and adds missing template items', async () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit handover={handover} />)
    fireEvent.click(screen.getByLabelText('Certificate of Compliance (CoC) not applicable'))
    await waitFor(() => expect(h.na).toHaveBeenCalledWith({ projectId: 'p1', itemId: 'h1', notApplicable: true, note: '' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add missing items from the template' }))
    await waitFor(() => expect(h.sync).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1' }))
  })
  it('View level shows linked file names only', () => {
    render(<HandoverChecklist projectId="p1" installationId="i1" canEdit={false} handover={handover} />)
    expect(screen.getByText('OM.pdf')).toBeTruthy()
    expect(screen.queryByLabelText('Document for Certificate of Compliance (CoC)')).toBeNull()
  })
})
```

`HandoverTemplateForm.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true, updatedAt: 'T2' })) }))
vi.mock('@/actions/solar-handover.actions', () => ({ saveHandoverTemplateAction: h.save }))
import { HandoverTemplateForm } from './HandoverTemplateForm'
beforeEach(() => vi.clearAllMocks())

describe('HandoverTemplateForm', () => {
  it('edits, adds and removes items, then saves on the loaded version', async () => {
    render(<HandoverTemplateForm initial={{ name: 'Solar PV Handover', items: [{ key: 'coc', label: 'CoC', required: true }] }} updatedAt="T1" />)
    fireEvent.change(screen.getByLabelText('Label of item 1'), { target: { value: 'Certificate of Compliance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    fireEvent.change(screen.getByLabelText('Key of item 2'), { target: { value: 'eskom_letter' } })
    fireEvent.change(screen.getByLabelText('Label of item 2'), { target: { value: 'Eskom approval letter' } })
    fireEvent.click(screen.getByLabelText('Item 2 required'))
    fireEvent.click(screen.getByRole('button', { name: 'Save handover template' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ name: 'Solar PV Handover', expectedUpdatedAt: 'T1', items: [
      { key: 'coc', label: 'Certificate of Compliance', required: true },
      { key: 'eskom_letter', label: 'Eskom approval letter', required: false },
    ] }))
  })
  it('shows a validation error', async () => {
    h.save.mockResolvedValue({ fieldErrors: { template: 'items.0.key: Use lower-case letters, digits and underscores.' } } as never)
    render(<HandoverTemplateForm initial={{ name: 'X', items: [{ key: 'coc', label: 'CoC', required: true }] }} updatedAt={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save handover template' }))
    expect(await screen.findByText('items.0.key: Use lower-case letters, digits and underscores.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`$OPS/HandoverChecklist.tsx`:
```tsx
'use client'
/**
 * Handover checklist (spec §10): each item links ONE file in E-Site Documents (tenants.documents of this
 * project) or is marked N/A. Upload happens in the Documents module; nothing here depends on folder names.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { OperationsView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormField'
import { linkHandoverDocumentAction, setHandoverNotApplicableAction, syncHandoverItemsAction } from '@/actions/solar-handover.actions'
import { useState } from 'react'

interface Props { projectId: string; installationId: string; canEdit: boolean; handover: OperationsView['handover'] }

export function HandoverChecklist({ projectId, installationId, canEdit, handover }: Props) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const c = handover.completion
  const after = (r: { ok: true } | { error: string }) => { if ('error' in r) setMsg(r.error); else router.refresh() }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{`Handover — ${handover.templateName || 'checklist'}`}</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, marginTop: 0 }}>{`${c.done} of ${c.total} items (${c.pct} %) · ${c.requiredDone} of ${c.requiredTotal} required`}</p>
        <div role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, background: 'var(--c-border)', borderRadius: 3, marginBottom: 12 }}>
          <div style={{ width: `${c.pct}%`, height: 6, background: 'var(--c-amber)', borderRadius: 3 }} />
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {handover.items.map((i) => (
              <tr key={i.id}>
                <td>{i.label}{i.required ? <span style={{ color: 'var(--c-amber)', marginLeft: 4 }}>*</span> : null}</td>
                <td>
                  {canEdit ? (
                    <Select aria-label={`Document for ${i.label}`} value={i.documentId ?? ''} disabled={i.notApplicable}
                      onChange={async (e) => after(await linkHandoverDocumentAction({ projectId, itemId: i.id, documentId: e.target.value || null }))}>
                      <option value="">No document linked</option>
                      {handover.documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Select>
                  ) : (i.notApplicable ? 'Not applicable' : (i.documentName ?? 'Missing'))}
                </td>
                <td>
                  {canEdit ? (
                    <label style={{ fontSize: 12 }}>
                      <input type="checkbox" aria-label={`${i.label} not applicable`} checked={i.notApplicable}
                        onChange={async (e) => after(await setHandoverNotApplicableAction({ projectId, itemId: i.id, notApplicable: e.target.checked, note: i.note ?? '' }))} />
                      {' N/A'}
                    </label>
                  ) : null}
                </td>
                <td style={{ color: 'var(--c-text-dim)' }}>{i.completedAt ? 'Complete' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <Link href={`/projects/${projectId}/documents`}>Upload to Documents</Link>
          {canEdit ? <Button size="sm" variant="secondary" onClick={async () => {
            const r = await syncHandoverItemsAction({ projectId, installationId })
            if ('error' in r) setMsg(r.error)
            else { setMsg(r.added === 0 ? 'The checklist already has every template item.' : `${r.added} item(s) added.`); router.refresh() }
          }}>Add missing items from the template</Button> : null}
        </div>
        {msg ? <p role="status" style={{ fontSize: 13 }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
```

`apps/web/src/app/(admin)/settings/solar/HandoverTemplateForm.tsx`:
```tsx
'use client'
/** Org handover template (spec §10: "template editable in org settings"). Owner/admin; checked again by the action and 00217. */
import { useState } from 'react'
import type { HandoverTemplate } from '@esite/shared/solar-operations/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { saveHandoverTemplateAction } from '@/actions/solar-handover.actions'

export function HandoverTemplateForm({ initial, updatedAt }: { initial: HandoverTemplate; updatedAt: string | null }) {
  const [name, setName] = useState(initial.name)
  const [items, setItems] = useState(initial.items.map((i) => ({ ...i })))
  const [version, setVersion] = useState(updatedAt)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: number, patch: Partial<HandoverTemplate['items'][number]>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Solar handover checklist template</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>New installations copy these items. Each item is later linked to one file in the project’s Documents.</p>
        <FormField label="Template name" htmlFor="ho-name"><TextInput id="ho-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <table style={{ width: '100%', fontSize: 13, marginTop: 12, borderCollapse: 'collapse' }}>
          <thead><tr><th align="left">Key</th><th align="left">Label</th><th align="left">Required</th><th /></tr></thead>
          <tbody>
            {items.map((it, k) => (
              <tr key={k}>
                <td><TextInput aria-label={`Key of item ${k + 1}`} value={it.key} onChange={(e) => set(k, { key: e.target.value })} /></td>
                <td><TextInput aria-label={`Label of item ${k + 1}`} value={it.label} onChange={(e) => set(k, { label: e.target.value })} /></td>
                <td><input type="checkbox" aria-label={`Item ${k + 1} required`} checked={it.required} onChange={(e) => set(k, { required: e.target.checked })} /></td>
                <td><Button size="sm" variant="ghost" onClick={() => setItems((xs) => xs.filter((_, i) => i !== k))}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Button size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs, { key: '', label: '', required: true }])}>Add item</Button>
          <Button onClick={async () => {
            const r = await saveHandoverTemplateAction({ name, items, expectedUpdatedAt: version })
            if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
            if ('error' in r) { setMsg(r.error); return }
            setVersion(r.updatedAt)
            setMsg('Saved.')
          }}>Save handover template</Button>
          {msg ? <span role="status" style={{ fontSize: 13 }}>{msg}</span> : null}
        </div>
      </CardBody>
    </Card>
  )
}
```

In `apps/web/src/app/(admin)/settings/solar/page.tsx`: add the imports
```ts
import { templateFromRow } from '@esite/shared/solar-operations/client'
import { HandoverTemplateForm } from './HandoverTemplateForm'
```
(`templateFromRow` is exported by `client.ts` since Task 26.) Then, after the settings read in the page (next to Phase 6's proposal-templates read), load the template:
```ts
  const { data: hoRow } = await supabase.schema('solar').from('handover_templates')
    .select('name, items, updated_at').eq('organisation_id', ctx.organisationId).maybeSingle()
  const ho = hoRow as { name?: unknown; items?: unknown; updated_at?: string } | null
```
and render, directly after Phase 6's proposal-templates card:
```tsx
      <div style={{ marginTop: 16 }}>
        <HandoverTemplateForm initial={templateFromRow(ho ? { name: ho.name, items: ho.items } : null)} updatedAt={ho?.updated_at ?? null} />
      </div>
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/operations' 'src/app/(admin)/settings/solar' src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -6
pnpm --filter web type-check 2>&1 | tail -5
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations' 'apps/web/src/app/(admin)/settings/solar' packages/shared/src/solar/operations/client.ts
git commit -m "feat(solar): handover checklist linked to Documents; org template card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
