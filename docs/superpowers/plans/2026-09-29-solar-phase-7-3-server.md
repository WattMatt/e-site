# Solar Phase 7 — Part 3: Server (report kind, loaders, actions, lost revenue, monthly report)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-29-solar-phase-7-0-index.md` first.

Run any web test file with:
```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 && pnpm --filter web test -- <path> 2>&1 | tail -8
```
Test helpers used below (already on the base): `fakeSupabase`, `callsTo` (`@/test/fake-supabase`); `withStorage` (`@/test/fake-storage`, Phase 6); `extractPdfText`, `squash` (`@/test/pdf-text`, Phase 6); `jhbTmyCsv` (`@/lib/solar/cases/__fixtures__/weather`, 4b).

---

### Task 16: `solar_monthly` read on Edit + financials; never deleted

**Files:**
- Modify: `apps/web/src/lib/reports/report-kind-access.ts`
- Modify: `apps/web/src/actions/project-reports.actions.ts`
- Modify: `apps/web/src/components/reports/SavedReportsPanel.tsx`
- Create: `apps/web/src/actions/project-reports.solar-monthly.test.ts`

- [ ] **Step 1: Failing test** `project-reports.solar-monthly.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), level: vi.fn(),
  requireRole: vi.fn(async () => ({ ok: true })), requireEffectiveRole: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole, requireEffectiveRole: h.requireEffectiveRole }))

import { listProjectReportsAction, getProjectReportUrlAction, deleteProjectReportAction } from './project-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

const P = 'p1'
const rows = [{ id: 'm1', project_id: P, organisation_id: 'o1', kind: 'solar_monthly', title: 'March', storage_path: 'o1/p1/m.pdf', status: 'issued', version: 1 }]

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'projects.reports': rows, 'projects.projects': [{ id: P, organisation_id: 'o1' }] } }).client)
  h.createServiceClient.mockReturnValue(withStorage(fakeSupabase()).client)
})

describe('solar_monthly follows Edit + financials (00218 mirrors this)', () => {
  it('Edit cannot list or open it; Edit + financials can', async () => {
    h.level.mockResolvedValue('edit')
    await expect(listProjectReportsAction(P, 'solar_monthly')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(getProjectReportUrlAction(P, 'm1')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    h.level.mockResolvedValue('edit_financials')
    const list = await listProjectReportsAction(P, 'solar_monthly')
    expect(Array.isArray(list) && list.map((r) => r.id)).toEqual(['m1'])
    await expect(getProjectReportUrlAction(P, 'm1')).resolves.toEqual({ url: 'https://signed.example/x' })
  })
  it('a monthly report is the record of what the client received and is never deleted', async () => {
    h.level.mockResolvedValue('edit_financials')
    await expect(deleteProjectReportAction(P, 'm1')).resolves.toEqual({
      error: 'A monthly report is kept as the record of what the client received — generate a new version instead.',
    })
  })
})
```

- [ ] **Step 2: Run — FAIL** (`listProjectReportsAction` returns the row to an Edit user because the kind is unknown to the Solar map).

- [ ] **Step 3: Implement.**

In `report-kind-access.ts`, add to `SOLAR_READ_REPORT_KINDS` (after `solar_proposal`):
```ts
  // The client's monthly performance report: lost revenue at the pinned tariff — commercial.
  solar_monthly: 'edit_financials',
```

In `project-reports.actions.ts` `deleteProjectReportAction`, immediately after Phase 6's `solar_proposal` refusal:
```ts
  // A generated monthly report is the record of what the client received (00218 keeps its snapshot).
  if (report.kind === 'solar_monthly') {
    return { error: 'A monthly report is kept as the record of what the client received — generate a new version instead.' }
  }
```

In `SavedReportsPanel.tsx` add to `SUMMARY_LABELS`:
```ts
  // Solar monthly reports (Phase 7).
  period: '^period',
  actualKwh: 'kWh generated',
  guaranteeKwh: 'kWh guaranteed',
  variancePct: '% variance',
```

- [ ] **Step 4: Run — PASS, plus the report-kind contract (it now requires `solar_monthly` in the FINAL `user_can_read_report_kind()`, which 00218 has); commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/actions/project-reports src/lib/reports src/components/reports 2>&1 | tail -5
git add apps/web/src/lib/reports/report-kind-access.ts apps/web/src/actions/project-reports.actions.ts \
  apps/web/src/actions/project-reports.solar-monthly.test.ts apps/web/src/components/reports/SavedReportsPanel.tsx
git commit -m "feat(solar): solar_monthly reports read on Edit + financials and never deleted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Error sentences, RPC wrappers, and the installation seed from the accepted proposal

**Files:**
- Create: `apps/web/src/lib/solar/operations/errors.ts`, `errors.test.ts`
- Create: `apps/web/src/lib/solar/operations/series.ts`, `series.test.ts`
- Create: `apps/web/src/lib/solar/operations/baseline-loader.ts`, `baseline-loader.test.ts`

- [ ] **Step 1: Failing tests.**

`errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { opsError } from './errors'

describe('opsError', () => {
  it('turns 00218 trigger refusals into the sentence they carry', () => {
    expect(opsError({ code: '23514', message: 'solar.installation_meters: a generation meter must be a solar meter' })).toBe('A generation meter must be a solar meter.')
    expect(opsError({ code: '23P01', message: 'solar.downtime: this window overlaps recorded downtime' })).toBe('This window overlaps recorded downtime.')
    expect(opsError({ code: '42501', message: 'solar.installations: the installation identity and its modelled baseline are immutable' }))
      .toBe('The installation identity and its modelled baseline are immutable.')
  })
  it('never echoes any other database text', () => {
    expect(opsError({ code: '42501', message: 'new row violates row-level security policy for table "downtime"' })).toBe('You do not have permission to do that.')
    expect(opsError({ code: 'XX000', message: 'internal detail' })).toBe('Something went wrong — try again.')
  })
})
```

`series.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadMeterMonths, loadMonthSeries, monthsWithData } from './series'

describe('RPC wrappers', () => {
  it('parses the per-meter monthly totals (numbers may arrive as strings)', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_monthly_kwh: (args) => ({ data: args.p_role === 'generation'
      ? { m1: { '2026-03': { kwh: '900.5', n: 1488, intervalMin: 30 }, bogus: { kwh: 1, n: 1, intervalMin: 30 } } } : {}, error: null }) } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'generation')).resolves.toEqual({ m1: { '2026-03': { kwh: 900.5, n: 1488, intervalMin: 30 } } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'consumption')).resolves.toEqual({})
    expect(f.client.rpc).toHaveBeenCalledWith('solar_ops_monthly_kwh', { p_installation_id: 'i1', p_role: 'generation' })
  })
  it('parses the month series and passes the month as its first day', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_series: { data: { points: [[1773136800000, '7.5', 30]] }, error: null } } })
    await expect(loadMonthSeries(f.client as never, 'i1', 'generation', '2026-03')).resolves.toEqual([{ endMs: 1773136800000, kw: 7.5, intervalMin: 30 }])
    expect(f.client.rpc).toHaveBeenCalledWith('solar_ops_series', { p_installation_id: 'i1', p_role: 'generation', p_month: '2026-03-01' })
  })
  it('throws on an RPC error instead of reporting zero generation (WM M12)', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_monthly_kwh: { data: null, error: { message: 'boom' } } } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'generation')).rejects.toThrow('could not be read')
  })
  it('months with data, sorted, across meters', () => {
    expect(monthsWithData({ a: { '2026-04': { kwh: 1, n: 1, intervalMin: 30 } }, b: { '2026-02': { kwh: 1, n: 1, intervalMin: 30 }, '2026-04': { kwh: 1, n: 1, intervalMin: 30 } } }))
      .toEqual(['2026-02', '2026-04'])
  })
})
```

`baseline-loader.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { encodeHourlyCsv } from '@esite/shared/solar-cases'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'
import { jhbTmyCsv } from '@/lib/solar/cases/__fixtures__/weather'
import { acceptedProposal, INSTALL_REASONS, loadInstallationSeed } from './baseline-loader'

const Z = () => new Float64Array(8760)
const pvAc = Float64Array.from({ length: 8760 }, (_, h) => (h % 24 >= 8 && h % 24 < 16 ? 50 : 0))
const csv = encodeHourlyCsv({ load: Z(), pvAc, selfUse: Z(), import: Z(), export: Z(), curtail: Z(), soc: Z(), importPvOnly: Z(), exportPvOnly: Z() })
const monthly = Array.from({ length: 12 }, (_, k) => ({ month: k + 1, pvKwh: 10_000 + k }))
const config = {
  version: 1,
  pv: { source: 'manual', dcKwp: 100, acKw: 80, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked',
    module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'Acme', model: 'M-500', pmaxW: 500, gammaPmaxPctPerC: -0.35 },
    inverter: { equipmentId: '22222222-2222-4222-8222-222222222222', make: 'Volt', model: 'I-40', acKw: 40, euroEfficiencyPct: 98 } },
  battery: { enabled: false, unit: null, usableKwh: 0, maxDischargeKw: 0 },
  degradation: { firstYearPct: 2, annualPct: 0.45 },
}
const run = { id: 'run-1', status: 'succeeded', inputs_hash: 'h'.repeat(64), hourly_path: 'o/p/c/run-1.csv.gz', weather_dataset_id: 'w1',
  config_snapshot: config, outputs: { kpis: { dcKwp: 100, acKw: 80, performanceRatio: 0.79 }, monthly } }

function svcFor(over: { proposals?: unknown[]; runs?: unknown[]; weatherFails?: boolean } = {}) {
  const download = vi.fn(async (path: string) => {
    if (path === run.hourly_path) return { data: new Blob([gzipSync(csv)]), error: null }
    if (path === 'o/w1.csv.gz' && !over.weatherFails) return { data: new Blob([gzipSync(jhbTmyCsv())]), error: null }
    return { data: null, error: { message: 'not found' } }
  })
  return withStorage(fakeSupabase({ tables: {
    'solar.proposals': (over.proposals ?? [{ id: 'prop-1', version: 2, case_run_id: 'run-1', study_id: 's1', status: 'accepted' }]) as never,
    'solar.case_runs': (over.runs ?? [run]) as never,
    'solar.weather_datasets': [{ id: 'w1', storage_path: 'o/w1.csv.gz' }],
  } }), { download })
}

describe('acceptedProposal', () => {
  it('finds the accepted proposal of the study, or null', async () => {
    await expect(acceptedProposal(svcFor().client as never, 's1')).resolves.toEqual({ id: 'prop-1', version: 2, caseRunId: 'run-1' })
    await expect(acceptedProposal(svcFor({ proposals: [] }).client as never, 's1')).resolves.toBeNull()
  })
})

describe('loadInstallationSeed', () => {
  it('freezes the accepted run into a baseline and seeds the as-built record and degradation', async () => {
    const r = await loadInstallationSeed(svcFor().client as never, 's1')
    if (!r.ok) throw new Error(r.reason)
    expect(r.proposalId).toBe('prop-1')
    expect(r.baseline).toMatchObject({ caseRunId: 'run-1', dcKwp: 100, acKw: 80, performanceRatio: 0.79 })
    expect(r.baseline.monthlyKwh[11]).toBe(10_011)
    expect(r.baseline.diurnalKw[0]![9]).toBe(50)
    expect(r.baseline.ghiKwhM2).toHaveLength(12)
    expect(r.baseline.ghiKwhM2![0]).toBeGreaterThan(100)
    expect(r.asBuilt.equipment).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-500', rating: 500, unit: 'W', quantity: 200 },
      { kind: 'inverter', make: 'Volt', model: 'I-40', rating: 40, unit: 'kW', quantity: 2 },
    ])
    expect(r.degradationPctPerYear).toBe(0.45)
  })
  it('a missing weather file only drops the GHI correction', async () => {
    const r = await loadInstallationSeed(svcFor({ weatherFails: true }).client as never, 's1')
    expect(r.ok && r.baseline.ghiKwhM2).toBeNull()
  })
  it('names why it cannot seed', async () => {
    await expect(loadInstallationSeed(svcFor({ proposals: [] }).client as never, 's1')).resolves.toEqual({ ok: false, reason: INSTALL_REASONS.noAccepted })
    await expect(loadInstallationSeed(svcFor({ runs: [] }).client as never, 's1')).resolves.toEqual({ ok: false, reason: INSTALL_REASONS.runMissing })
    await expect(loadInstallationSeed(svcFor({ runs: [{ ...run, hourly_path: 'gone' }] }).client as never, 's1'))
      .resolves.toEqual({ ok: false, reason: INSTALL_REASONS.runUnreadable })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`errors.ts`:
```ts
/**
 * 00218's triggers raise "solar.<table>: <sentence>" with SQLSTATE 23514 / 23P01 / 23503 / 42501 / 23505.
 * Those sentences are written for people, so they are shown; anything else goes through
 * humanSolarError, which never echoes database text.
 */
import { humanSolarError } from '@/lib/solar/errors'

const PREFIX = /^solar\.[a-z_]+: /
const SHOWN = new Set(['23514', '23P01', '23503', '42501', '23505'])

export function opsError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (SHOWN.has(err?.code ?? '') && PREFIX.test(m)) {
    const s = m.replace(PREFIX, '').trim()
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return humanSolarError(err)
}
```

`series.ts`:
```ts
/**
 * Wrappers for 00218's two aggregation functions. They return ONE jsonb document, so no PostgREST
 * row cap can truncate a month (WM M3/G12), and they run as the caller (RLS decides).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMonthKey, monthFirstDay, type MeterMonths, type MonthKey, type SeriesPoint } from '@esite/shared/solar-operations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type MeterRole = 'generation' | 'consumption'

export async function loadMeterMonths(client: AnyClient, installationId: string, role: MeterRole): Promise<MeterMonths> {
  const { data, error } = await client.rpc('solar_ops_monthly_kwh', { p_installation_id: installationId, p_role: role })
  if (error) throw new Error(`meter totals could not be read: ${error.message}`)
  const out: MeterMonths = {}
  for (const [meterId, months] of Object.entries((data ?? {}) as Record<string, Record<string, Record<string, unknown>>>)) {
    const m: MeterMonths[string] = {}
    for (const [k, v] of Object.entries(months ?? {})) {
      if (isMonthKey(k)) m[k] = { kwh: Number(v.kwh), n: Number(v.n), intervalMin: Number(v.intervalMin) }
    }
    out[meterId] = m
  }
  return out
}

export async function loadMonthSeries(client: AnyClient, installationId: string, role: MeterRole, month: MonthKey): Promise<SeriesPoint[]> {
  const { data, error } = await client.rpc('solar_ops_series', { p_installation_id: installationId, p_role: role, p_month: monthFirstDay(month) })
  if (error) throw new Error(`the month's readings could not be read: ${error.message}`)
  const points = ((data as { points?: unknown[] } | null)?.points ?? []) as Array<[unknown, unknown, unknown]>
  return points.map(([t, kw, iv]) => ({ endMs: Number(t), kw: Number(kw), intervalMin: Number(iv) }))
}

export function monthsWithData(m: MeterMonths): MonthKey[] {
  const set = new Set<MonthKey>()
  for (const months of Object.values(m)) for (const [k, v] of Object.entries(months)) if (v.n > 0) set.add(k)
  return [...set].sort()
}
```

`baseline-loader.ts`:
```ts
import 'server-only'
/**
 * Seed an installation from the study's ACCEPTED proposal (spec §10): the run it froze → the
 * modelled baseline (frozen in the installation row) and the as-built record. Service client, used
 * only after the caller's Edit gate: proposals are a money table, but only their id / version /
 * run id are read here, and none of it is returned to the browser except the version number.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { decodeHourlyCsv } from '@esite/shared/solar-cases'
import { parsePvgisTmyCsv } from '@esite/shared/solar-engine'
import { asBuiltFromCase, buildBaseline, type AsBuilt, type OpsBaseline } from '@esite/shared/solar-operations'
import { getGzipText, RUNS_BUCKET, WEATHER_BUCKET } from '@/lib/solar/cases/storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const INSTALL_REASONS = {
  noStudy: 'Save Site & Supply first — the installation belongs to the study.',
  noAccepted: 'No accepted proposal yet. A client accepts a proposal on Reports & Proposal; the installation starts from it.',
  runMissing: 'The accepted proposal’s run is no longer stored, so its modelled baseline cannot be read.',
  runUnreadable: 'The accepted run’s hourly results could not be read — try again.',
  exists: 'This study already has an installation record.',
} as const

/** The parts of the stored case config the seed reads; passthrough so 4b's schema can grow. */
const SystemSnapshot = z.object({
  pv: z.object({
    dcKwp: z.number(), acKw: z.number(), tiltDeg: z.number(), azimuthDeg: z.number(),
    module: z.object({ make: z.string(), model: z.string(), pmaxW: z.number() }).passthrough().nullable(),
    inverter: z.object({ make: z.string(), model: z.string(), acKw: z.number() }).passthrough().nullable(),
  }).passthrough(),
  battery: z.object({
    enabled: z.boolean(),
    unit: z.object({ make: z.string(), model: z.string(), usableKwh: z.number(), powerKw: z.number() }).passthrough().nullable(),
    usableKwh: z.number(), maxDischargeKw: z.number(),
  }).passthrough(),
  degradation: z.object({ annualPct: z.number() }).passthrough(),
}).passthrough()

export async function acceptedProposal(svc: AnyClient, studyId: string): Promise<{ id: string; version: number; caseRunId: string | null } | null> {
  const { data } = await svc.schema('solar').from('proposals').select('id, version, case_run_id, issued_at')
    .eq('study_id', studyId).eq('status', 'accepted').order('issued_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  const r = data as Row
  return { id: String(r.id), version: Number(r.version), caseRunId: (r.case_run_id as string | null) ?? null }
}

export type InstallationSeed =
  | { ok: true; proposalId: string; baseline: OpsBaseline; asBuilt: AsBuilt; degradationPctPerYear: number }
  | { ok: false; reason: string }

export async function loadInstallationSeed(svc: AnyClient, studyId: string): Promise<InstallationSeed> {
  const prop = await acceptedProposal(svc, studyId)
  if (!prop) return { ok: false, reason: INSTALL_REASONS.noAccepted }
  if (!prop.caseRunId) return { ok: false, reason: INSTALL_REASONS.runMissing }
  const { data: runRow } = await svc.schema('solar').from('case_runs')
    .select('id, status, inputs_hash, hourly_path, weather_dataset_id, config_snapshot, outputs').eq('id', prop.caseRunId).maybeSingle()
  const run = runRow as Row | null
  if (!run || run.status !== 'succeeded' || !run.hourly_path) return { ok: false, reason: INSTALL_REASONS.runMissing }

  let pvAc: Float64Array
  try {
    pvAc = decodeHourlyCsv(await getGzipText(svc, RUNS_BUCKET, String(run.hourly_path))).pvAc
  } catch {
    return { ok: false, reason: INSTALL_REASONS.runUnreadable }
  }

  let tmyRows: Array<{ month: number; ghi: number }> | null = null
  try {
    const { data: w } = await svc.schema('solar').from('weather_datasets').select('storage_path').eq('id', String(run.weather_dataset_id)).maybeSingle()
    if (w) tmyRows = parsePvgisTmyCsv(await getGzipText(svc, WEATHER_BUCKET, String((w as Row).storage_path))).rows.map((r) => ({ month: r.month, ghi: r.ghi }))
  } catch {
    tmyRows = null
  }

  const outputs = (run.outputs ?? {}) as { kpis?: { dcKwp: number; acKw: number; performanceRatio: number }; monthly?: Array<{ month: number; pvKwh: number }> }
  if (!outputs.kpis || !outputs.monthly) return { ok: false, reason: INSTALL_REASONS.runMissing }
  let baseline: OpsBaseline
  try {
    baseline = buildBaseline({ caseRunId: String(run.id), inputsHash: String(run.inputs_hash), kpis: outputs.kpis, monthly: outputs.monthly, pvAc, tmyRows })
  } catch {
    return { ok: false, reason: INSTALL_REASONS.runMissing }
  }

  const sys = SystemSnapshot.safeParse(run.config_snapshot)
  const asBuilt: AsBuilt = sys.success
    ? asBuiltFromCase(sys.data)
    : { dcKwp: baseline.dcKwp, acKw: baseline.acKw, batteryKwh: null, batteryKw: null, tiltDeg: null, azimuthDeg: null, equipment: [] }
  return { ok: true, proposalId: prop.id, baseline, asBuilt, degradationPctPerYear: sys.success ? sys.data.degradation.annualPct : 0 }
}
```

- [ ] **Step 3: Run the three test files — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/operations 2>&1 | tail -5
git add apps/web/src/lib/solar/operations && git commit -m "feat(solar): operations errors, aggregation wrappers and the installation seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Operations view model loader

**Files:**
- Create: `apps/web/src/lib/solar/operations/data.ts`, `data.test.ts`

- [ ] **Step 1: Failing test** `data.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ tariff: vi.fn() }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))

import { fakeSupabase } from '@/test/fake-supabase'
import { loadOperationsReadiness, loadOperationsView } from './data'
import { INSTALL_REASONS } from './baseline-loader'

const baseline = {
  version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000),
  diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, hh) => (hh >= 8 && hh < 16 ? 5 : 0))),
  ghiKwhM2: null,
}
const asBuilt = { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
  equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }, { kind: 'inverter', make: 'V', model: 'I', rating: 80, unit: 'kW', quantity: 1 }] }
const at = (iso: string) => Date.parse(iso)
// 10 March: zero output 11:30–13:00 SAST (three 30-min intervals), else 40 kW in daylight.
const points = Array.from({ length: 48 }, (_, k) => {
  const end = at('2026-03-10T00:30:00+02:00') + k * 1_800_000
  const hhmm = new Date(end + 7_200_000).toISOString().slice(11, 16)
  const prod = hhmm >= '06:30' && hhmm <= '18:30' && !['12:00', '12:30', '13:00'].includes(hhmm)
  return [end, prod ? 40 : 0, 30]
})

function user(over: Record<string, unknown[]> = {}) {
  return fakeSupabase({
    tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', organisation_id: 'o1', latitude: -25.75, longitude: 28.19, elevation_m: 1339 }],
      'solar.installations': [{ id: 'i1', study_id: 's1', commissioning_date: '2026-02-15', baseline, as_built: asBuilt, notes: null, updated_at: 'T1' }],
      'solar.installation_meters': [{ installation_id: 'i1', meter_id: 'm1', role: 'generation', expected_share_pct: null }],
      'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }, { study_id: 's1', meter_id: 'm3' }],
      'solar.meters': [{ id: 'm1', label: 'PV main', kind: 'solar' }, { id: 'm2', label: 'Council', kind: 'council' }, { id: 'm3', label: 'Shop 1', kind: 'tenant' }],
      'solar.guarantees': [{ installation_id: 'i1', basis: 'p50', pct: null, manual_monthly_kwh: null, degradation_pct_per_year: '0', updated_at: 'G1' }],
      'solar.ops_irradiation': [],
      'solar.downtime': [],
      'solar.handover_items': [{ id: 'h1', installation_id: 'i1', item_key: 'coc', label: 'CoC', required: true, sort_order: 0, document_id: 'd1', not_applicable: false, note: null, completed_at: 'C1', updated_at: 'U1' }],
      'solar.handover_templates': [],
      'solar.monthly_report_notes': [{ installation_id: 'i1', period_month: '2026-03-01', section: 'summary', body: 'Good', updated_at: 'N1' }],
      'tenants.documents': [{ id: 'd1', project_id: 'p1', name: 'CoC.pdf' }],
      ...over,
    },
    rpc: {
      solar_ops_monthly_kwh: (args) => ({ data: args.p_role === 'generation' ? { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } } : {}, error: null }),
      solar_ops_series: { data: { points }, error: null },
    },
  })
}
const svc = (props: unknown[] = []) => fakeSupabase({ tables: { 'solar.proposals': props as never } })

beforeEach(() => { vi.clearAllMocks(); h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' }) })

describe('loadOperationsView', () => {
  it('no study: says why and loads nothing else', async () => {
    const v = await loadOperationsView({ user: user({ 'solar.studies': [] }).client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(v).toMatchObject({ installation: null, setupReason: INSTALL_REASONS.noStudy, readiness: null })
  })
  it('no installation: offers the accepted proposal, or says there is none', async () => {
    const u = user({ 'solar.installations': [] })
    const a = await loadOperationsView({ user: u.client as never, svc: svc([{ id: 'prop-1', version: 3, case_run_id: 'r', study_id: 's1', status: 'accepted' }]).client as never, projectId: 'p1', level: 'edit', month: null })
    expect(a).toMatchObject({ installation: null, acceptedProposal: { id: 'prop-1', version: 3 }, setupReason: null })
    const b = await loadOperationsView({ user: u.client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(b).toMatchObject({ acceptedProposal: null, setupReason: INSTALL_REASONS.noAccepted })
  })
  it('installed: performance from the aggregation, available meters exclude linked and non-generation kinds, candidates for an editor', async () => {
    const v = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(v.months).toEqual(['2026-03'])
    expect(v.selectedMonth).toBe('2026-03')
    expect(v.performance.map((r) => [r.month, r.actualKwh])).toEqual([['2026-02', null], ['2026-03', 900]])
    expect(v.meters).toEqual([{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation', sharePct: null }])
    expect(v.availableMeters).toEqual([{ meterId: 'm2', label: 'Council', kind: 'council' }])
    expect(v.candidates).toEqual([{ startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', intervals: 3, hours: 1.5 }])
    expect(v.handover.items[0]).toMatchObject({ key: 'coc', documentName: 'CoC.pdf' })
    expect(v.handover.completion).toMatchObject({ done: 1, total: 1, pct: 100 })
    expect(v.handover.templateName).toBe('Solar PV Handover')
    expect(v.monthly).toBeNull()
    expect(v.readiness).toEqual({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 1 })
  })
  it('a View user gets no candidates; a money user gets notes and the reason Generate is disabled', async () => {
    const view = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'view', month: null })
    expect(view.candidates).toEqual([])
    const money = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'edit_financials', month: '2026-03' })
    expect(money.monthly).toMatchObject({ generateReason: 'No tariff is pinned for this study — pin one on the Tariff tab.', tariffName: null })
    expect(money.monthly!.notes.summary).toBe('Good')
    expect(money.monthly!.notesUpdatedAt.summary).toBe('N1')
    expect(h.tariff).toHaveBeenCalledWith(expect.anything(), 'p1', expect.objectContaining({ year: 2026 }))
  })
  it('lost kWh is computed for downtime in the selected month', async () => {
    const dt = [{ id: 'd1', installation_id: 'i1', starts_at: '2026-03-10T09:30:00.000Z', ends_at: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault',
      description: null, excluded_from_guarantee: false, source: 'detected', updated_at: 'D1' }]
    const v = await loadOperationsView({ user: user({ 'solar.downtime': dt }).client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    // 1.5 h of an 8-producing-hour day in a 31-day month of 1000 kWh, all lost.
    expect(v.downtime[0]!.lostKwh).toBeCloseTo(1000 * 1.5 / (8 * 31), 3)
    expect(v.candidates).toEqual([])
  })
})

describe('loadOperationsReadiness', () => {
  it('null without an installation; otherwise the date and the months with data', async () => {
    await expect(loadOperationsReadiness(user({ 'solar.installations': [] }).client as never, 'p1')).resolves.toBeNull()
    await expect(loadOperationsReadiness(user().client as never, 'p1')).resolves.toEqual({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 1 })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `data.ts`:

```ts
import 'server-only'
/**
 * The Operations tab's view model (spec §10), read through the CALLER'S session so RLS decides every
 * row. The service client is used only for the accepted-proposal lookup (a status and a version, no
 * money) and the tariff check, after the page's gate. The result is JSON: it crosses into client
 * components.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OperationsReadinessInput, SolarAccessLevel } from '@esite/shared'
import {
  dateMonthKey, detectDowntimeCandidates, equipmentComplete, expectedForMonth, guaranteeFromRow, handoverCompletion,
  isMonthKey, lostKwh, lostSteps, monthEndMs, monthParts, monthRange, monthStartMs, NOTE_SECTIONS, parseAsBuilt,
  performanceRows, readBaseline, templateFromRow, totalsByMonth,
  type AsBuilt, type DowntimeCandidate, type DowntimeRecord, type Guarantee, type HandoverCompletion,
  type IrradiationRecord, type MonthKey, type NoteSection, type OpsBaseline, type PerformanceRow,
} from '@esite/shared/solar-operations'
import { resolveStudyTariff } from '@/lib/solar/cases/tariff'
import { acceptedProposal, INSTALL_REASONS } from './baseline-loader'
import { loadMeterMonths, loadMonthSeries, monthsWithData } from './series'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface OpsMeterView { meterId: string; label: string; kind: string; role: 'generation' | 'consumption'; sharePct: number | null }
export interface OpsAvailableMeter { meterId: string; label: string; kind: string }
export interface OpsDowntimeView extends DowntimeRecord { updatedAt: string; lostKwh: number | null }
export interface OpsHandoverItemView {
  id: string; key: string; label: string; required: boolean; sortOrder: number
  documentId: string | null; documentName: string | null; notApplicable: boolean; note: string | null
  completedAt: string | null; updatedAt: string
}
export interface OpsInstallationView {
  id: string; commissioningDate: string | null; asBuilt: AsBuilt; notes: string | null; updatedAt: string; baseline: OpsBaseline
  /** Σ of the baseline's 12 monthly P50 kWh, computed here so the browser formats but never adds. */
  annualP50Kwh: number
}
export interface OpsMonthlyView {
  notes: Record<NoteSection, string>
  notesUpdatedAt: Record<NoteSection, string | null>
  generateReason: string | null
  tariffName: string | null
}
export interface OperationsView {
  level: SolarAccessLevel
  canEdit: boolean
  canSeeMoney: boolean
  studyId: string | null
  organisationId: string | null
  setupReason: string | null
  acceptedProposal: { id: string; version: number } | null
  installation: OpsInstallationView | null
  meters: OpsMeterView[]
  availableMeters: OpsAvailableMeter[]
  guarantee: (Guarantee & { updatedAt: string }) | null
  irradiation: IrradiationRecord[]
  downtime: OpsDowntimeView[]
  months: MonthKey[]
  selectedMonth: MonthKey | null
  performance: PerformanceRow[]
  candidates: DowntimeCandidate[]
  handover: { items: OpsHandoverItemView[]; completion: HandoverCompletion; documents: Array<{ id: string; name: string }>; templateName: string }
  monthly: OpsMonthlyView | null
  readiness: OperationsReadinessInput | null
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const OPS_METER_KINDS = ['solar', 'council', 'bulk']

function emptyView(level: SolarAccessLevel, studyId: string | null, orgId: string | null, setupReason: string | null,
  accepted: { id: string; version: number } | null): OperationsView {
  return {
    level, canEdit: level !== 'view', canSeeMoney: level === 'edit_financials',
    studyId, organisationId: orgId, setupReason, acceptedProposal: accepted, installation: null,
    meters: [], availableMeters: [], guarantee: null, irradiation: [], downtime: [], months: [], selectedMonth: null,
    performance: [], candidates: [],
    handover: { items: [], completion: handoverCompletion([]), documents: [], templateName: '' },
    monthly: null, readiness: null,
  }
}

export async function loadOperationsView(a: {
  user: AnyClient; svc: AnyClient; projectId: string; level: SolarAccessLevel; month: string | null
}): Promise<OperationsView> {
  const canEdit = a.level !== 'view'
  const canSeeMoney = a.level === 'edit_financials'
  const solar = () => a.user.schema('solar')

  const { data: study } = await solar().from('studies').select('id, organisation_id, latitude, longitude, elevation_m')
    .eq('project_id', a.projectId).maybeSingle()
  if (!study) return emptyView(a.level, null, null, INSTALL_REASONS.noStudy, null)
  const s = study as Row
  const studyId = String(s.id)
  const orgId = String(s.organisation_id)

  const { data: inst } = await solar().from('installations').select('id, commissioning_date, baseline, as_built, notes, updated_at')
    .eq('study_id', studyId).maybeSingle()
  if (!inst) {
    const accepted = await acceptedProposal(a.svc, studyId)
    return emptyView(a.level, studyId, orgId, accepted ? null : INSTALL_REASONS.noAccepted, accepted ? { id: accepted.id, version: accepted.version } : null)
  }
  const i = inst as Row
  const installationId = String(i.id)
  const baseline = readBaseline(i.baseline)
  const parsed = parseAsBuilt(i.as_built)
  const asBuilt: AsBuilt = parsed.ok ? parsed.value
    : { dcKwp: baseline.dcKwp, acKw: baseline.acKw, batteryKwh: null, batteryKw: null, tiltDeg: null, azimuthDeg: null, equipment: [] }
  const commissioningDate = (i.commissioning_date as string | null) ?? null

  const [links, studyMeters, gRes, irrRes, dtRes, itemRes, tplRes, docRes, genMonths] = await Promise.all([
    solar().from('installation_meters').select('meter_id, role, expected_share_pct').eq('installation_id', installationId),
    solar().from('study_meters').select('meter_id').eq('study_id', studyId),
    solar().from('guarantees').select('basis, pct, manual_monthly_kwh, degradation_pct_per_year, updated_at').eq('installation_id', installationId).maybeSingle(),
    solar().from('ops_irradiation').select('month, plane, kwh_per_m2, source_note').eq('installation_id', installationId),
    solar().from('downtime').select('id, starts_at, ends_at, cause, description, excluded_from_guarantee, source, updated_at')
      .eq('installation_id', installationId).order('starts_at', { ascending: true }),
    solar().from('handover_items').select('id, item_key, label, required, sort_order, document_id, not_applicable, note, completed_at, updated_at')
      .eq('installation_id', installationId).order('sort_order', { ascending: true }),
    solar().from('handover_templates').select('name, items').eq('organisation_id', orgId).maybeSingle(),
    a.user.schema('tenants').from('documents').select('id, name').eq('project_id', a.projectId).order('name', { ascending: true }),
    loadMeterMonths(a.user, installationId, 'generation'),
  ])

  const linkRows = (links.data ?? []) as Row[]
  const meterIds = [...new Set([...linkRows.map((r) => String(r.meter_id)), ...((studyMeters.data ?? []) as Row[]).map((r) => String(r.meter_id))])]
  const { data: meterRows } = meterIds.length > 0
    ? await solar().from('meters').select('id, label, kind').in('id', meterIds)
    : { data: [] as Row[] }
  const meterById = new Map(((meterRows ?? []) as Row[]).map((m) => [String(m.id), m]))
  const meters: OpsMeterView[] = linkRows.map((r) => {
    const m = meterById.get(String(r.meter_id))
    return { meterId: String(r.meter_id), label: String(m?.label ?? 'Meter'), kind: String(m?.kind ?? 'unknown'),
      role: r.role as OpsMeterView['role'], sharePct: num(r.expected_share_pct) }
  })
  const linked = new Set(meters.map((m) => m.meterId))
  const availableMeters: OpsAvailableMeter[] = [...meterById.values()]
    .filter((m) => !linked.has(String(m.id)) && OPS_METER_KINDS.includes(String(m.kind)))
    .map((m) => ({ meterId: String(m.id), label: String(m.label), kind: String(m.kind) }))
    .sort((x, y) => x.label.localeCompare(y.label))

  const guarantee = gRes.data ? { ...guaranteeFromRow(gRes.data as Row), updatedAt: String((gRes.data as Row).updated_at) } : null
  const irradiation: IrradiationRecord[] = ((irrRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month).slice(0, 7), plane: r.plane as 'ghi' | 'poa', kwhPerM2: Number(r.kwh_per_m2), sourceNote: String(r.source_note),
  }))
  const dtRows = (dtRes.data ?? []) as Row[]
  const downtimeBase: DowntimeRecord[] = dtRows.map((r) => ({
    id: String(r.id), startsAt: String(r.starts_at), endsAt: String(r.ends_at), cause: String(r.cause),
    description: (r.description as string | null) ?? null, excludedFromGuarantee: Boolean(r.excluded_from_guarantee),
    source: r.source as DowntimeRecord['source'],
  }))

  const months = monthsWithData(genMonths)
  const selectedMonth = a.month && isMonthKey(a.month) && months.includes(a.month) ? a.month : (months[months.length - 1] ?? null)
  const genCount = meters.filter((m) => m.role === 'generation').length
  const performance = guarantee && commissioningDate
    ? performanceRows({
        months: monthRange(dateMonthKey(commissioningDate), months[months.length - 1] ?? dateMonthKey(commissioningDate)),
        baseline, guarantee, commissioningDate, dcKwp: asBuilt.dcKwp, actual: totalsByMonth(genMonths),
        generationMeterCount: genCount, downtime: downtimeBase, irradiation,
      })
    : []

  let candidates: DowntimeCandidate[] = []
  const lostById = new Map<string, number>()
  if (selectedMonth) {
    const points = await loadMonthSeries(a.user, installationId, 'generation', selectedMonth)
    const lat = num(s.latitude)
    const lng = num(s.longitude)
    if (canEdit && lat !== null && lng !== null) {
      candidates = detectDowntimeCandidates(points, { latitude: lat, longitude: lng, elevationM: num(s.elevation_m) ?? 0 }, asBuilt.acKw,
        downtimeBase.map((d) => ({ startMs: Date.parse(d.startsAt), endMs: Date.parse(d.endsAt) })))
    }
    if (guarantee && commissioningDate) {
      const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee, baseline, commissioningDate })?.fullKwh ?? 0
      const m0 = monthStartMs(selectedMonth)
      const m1 = monthEndMs(selectedMonth)
      for (const d of downtimeBase) {
        const w0 = Math.max(Date.parse(d.startsAt), m0)
        const w1 = Math.min(Date.parse(d.endsAt), m1)
        if (w1 > w0) lostById.set(d.id, Math.round(lostKwh(lostSteps({ startMs: w0, endMs: w1 }, points, baseline, fullFor)) * 1000) / 1000)
      }
    }
  }
  const downtime: OpsDowntimeView[] = downtimeBase.map((d, k) => ({ ...d, updatedAt: String(dtRows[k]!.updated_at), lostKwh: lostById.get(d.id) ?? null }))

  const documents = ((docRes.data ?? []) as Row[]).map((d) => ({ id: String(d.id), name: String(d.name) }))
  const docName = new Map(documents.map((d) => [d.id, d.name]))
  const items: OpsHandoverItemView[] = ((itemRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), key: String(r.item_key), label: String(r.label), required: Boolean(r.required), sortOrder: Number(r.sort_order),
    documentId: (r.document_id as string | null) ?? null,
    documentName: r.document_id ? (docName.get(String(r.document_id)) ?? 'Document not visible to you') : null,
    notApplicable: Boolean(r.not_applicable), note: (r.note as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null, updatedAt: String(r.updated_at),
  }))
  const template = templateFromRow((tplRes.data as { name: unknown; items: unknown } | null) ?? null)

  let monthly: OpsMonthlyView | null = null
  if (canSeeMoney) {
    const notes = Object.fromEntries(NOTE_SECTIONS.map((k) => [k, ''])) as Record<NoteSection, string>
    const notesUpdatedAt = Object.fromEntries(NOTE_SECTIONS.map((k) => [k, null])) as Record<NoteSection, string | null>
    if (selectedMonth) {
      const { data: noteRows } = await solar().from('monthly_report_notes').select('section, body, updated_at')
        .eq('installation_id', installationId).eq('period_month', `${selectedMonth}-01`)
      for (const r of (noteRows ?? []) as Row[]) {
        const k = r.section as NoteSection
        if ((NOTE_SECTIONS as readonly string[]).includes(k)) { notes[k] = String(r.body); notesUpdatedAt[k] = String(r.updated_at) }
      }
    }
    let generateReason: string | null = null
    let tariffName: string | null = null
    if (!selectedMonth) generateReason = 'Import generation data first.'
    else if (!commissioningDate) generateReason = 'Set the commissioning date first.'
    else if (!guarantee) generateReason = 'Save a guarantee basis first.'
    else {
      const eq = equipmentComplete(asBuilt)
      if (!eq.ok) generateReason = eq.reason
    }
    if (!generateReason && selectedMonth) {
      const t = await resolveStudyTariff(a.svc, a.projectId, { year: monthParts(selectedMonth).year })
      if (!t.ok) generateReason = t.reason
      else tariffName = `${t.tariffRef.tariffName} (${t.tariffRef.licenseeName}, ${t.tariffRef.financialYear})`
    }
    monthly = { notes, notesUpdatedAt, generateReason, tariffName }
  }

  return {
    level: a.level, canEdit, canSeeMoney, studyId, organisationId: orgId, setupReason: null, acceptedProposal: null,
    installation: {
      id: installationId, commissioningDate, asBuilt, notes: (i.notes as string | null) ?? null, updatedAt: String(i.updated_at), baseline,
      annualP50Kwh: Math.round(baseline.monthlyKwh.reduce((t, v) => t + v, 0)),
    },
    meters, availableMeters, guarantee, irradiation, downtime, months, selectedMonth, performance, candidates,
    handover: { items, completion: handoverCompletion(items), documents, templateName: template.name },
    monthly,
    readiness: { installed: true, commissioningDate, monthsWithData: months.length },
  }
}

/** The light read the tab dots use (loadSolarReadinessExtra). */
export async function loadOperationsReadiness(user: AnyClient, projectId: string): Promise<OperationsReadinessInput | null> {
  const { data: study } = await user.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  if (!study) return null
  const { data: inst } = await user.schema('solar').from('installations').select('id, commissioning_date').eq('study_id', String((study as Row).id)).maybeSingle()
  if (!inst) return null
  const i = inst as Row
  let months = 0
  try {
    months = monthsWithData(await loadMeterMonths(user, String(i.id), 'generation')).length
  } catch {
    months = 0
  }
  return { installed: true, commissioningDate: (i.commissioning_date as string | null) ?? null, monthsWithData: months }
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/operations/data.test.ts 2>&1 | tail -6
git add apps/web/src/lib/solar/operations/data.ts apps/web/src/lib/solar/operations/data.test.ts
git commit -m "feat(solar): operations view model (performance, candidates, handover, report readiness)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Installation actions (create from the accepted proposal; save as-built and commissioning)

**Files:**
- Create: `apps/web/src/actions/solar-operations.actions.ts`
- Create: `apps/web/src/actions/solar-operations.installation.test.ts`
- Create: `apps/web/src/actions/solar-operations.test-helpers.ts`

- [ ] **Step 1: Shared test helpers** `solar-operations.test-helpers.ts`:

```ts
// Constants only: vi.hoisted() runs before imports, so each test file declares its own mocks.
export const P = '11111111-1111-4111-8111-111111111111'
export const I = '22222222-2222-4222-8222-222222222222'
export const M = '33333333-3333-4333-8333-333333333333'
export const D = '44444444-4444-4444-8444-444444444444'
```

- [ ] **Step 2: Failing test** `solar-operations.installation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/operations/baseline-loader', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/operations/baseline-loader')>()), loadInstallationSeed: h.seed }))

import { createInstallationAction, saveInstallationAction } from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { INSTALL_REASONS } from '@/lib/solar/operations/baseline-loader'

const asBuilt = { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
  equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }] }
const baseline = { version: 1 }

function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1' }], 'solar.handover_templates': [] },
    writes: { 'solar.installations:insert': { data: [{ id: I }] } }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  h.seed.mockResolvedValue({ ok: true, proposalId: 'prop-1', baseline, asBuilt, degradationPctPerYear: 0.45 })
})

describe('createInstallationAction', () => {
  it('gates Edit FIRST, then inserts through the caller’s session with a P50 guarantee and the default checklist', async () => {
    const f = setup()
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ ok: true, installationId: I, warning: null })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(f.calls, 'solar.installations', 'insert')[0]!.payload).toEqual({ study_id: 's1', proposal_id: 'prop-1', baseline, as_built: asBuilt })
    expect(callsTo(f.calls, 'solar.guarantees', 'insert')[0]!.payload).toEqual({ installation_id: I, basis: 'p50', degradation_pct_per_year: 0.45 })
    const items = callsTo(f.calls, 'solar.handover_items', 'insert')[0]!.payload as Array<Record<string, unknown>>
    expect(items[0]).toEqual({ installation_id: I, item_key: 'coc', label: 'Certificate of Compliance (CoC)', required: true, sort_order: 0 })
    expect(items).toHaveLength(9)
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'installation_created', objectRef: { installationId: I, proposalId: 'prop-1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_installation_saved', properties: { action: 'created' } })
  })
  it('passes the seed’s reason through and writes nothing', async () => {
    const f = setup()
    h.seed.mockResolvedValue({ ok: false, reason: INSTALL_REASONS.noAccepted })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.noAccepted })
    expect(callsTo(f.calls, 'solar.installations', 'insert')).toHaveLength(0)
  })
  it('a second installation for the study is refused in words', async () => {
    setup({ writes: { 'solar.installations:insert': { error: { code: '23505', message: 'duplicate key' } } } })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.exists })
  })
  it('no study: says so', async () => {
    setup({ tables: { 'solar.studies': [] } })
    await expect(createInstallationAction({ projectId: P })).resolves.toEqual({ error: INSTALL_REASONS.noStudy })
  })
})

describe('saveInstallationAction', () => {
  it('validates the date and the as-built record before writing', async () => {
    const f = setup()
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-30', asBuilt, notes: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ fieldErrors: { commissioningDate: 'Enter a real date (YYYY-MM-DD).' } })
    const bad = await saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-15', asBuilt: { ...asBuilt, dcKwp: -1 }, notes: null, expectedUpdatedAt: 'T1' })
    expect(bad).toHaveProperty('fieldErrors.asBuilt')
    expect(callsTo(f.calls, 'solar.installations', 'update')).toHaveLength(0)
  })
  it('updates on the loaded version; a changed row is stale', async () => {
    const f = setup({ writes: { 'solar.installations:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: '2026-02-15', asBuilt, notes: '  Handed over  ', expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'T2' })
    const u = callsTo(f.calls, 'solar.installations', 'update')[0]!
    expect(u.payload).toEqual({ commissioning_date: '2026-02-15', as_built: asBuilt, notes: 'Handed over' })
    expect(u.filters).toEqual([['eq', 'id', I], ['eq', 'updated_at', 'T1']])
    setup({ writes: { 'solar.installations:update': { data: [] } } })
    await expect(saveInstallationAction({ projectId: P, installationId: I, commissioningDate: null, asBuilt, notes: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `apps/web/src/actions/solar-operations.actions.ts` (this task writes its header and the installation section; Tasks 20–21 append):

```ts
'use server'
/**
 * Operations tab actions (spec §10). Every action gates its Solar level FIRST (requireSolarLevel
 * redirects a lower level), writes through the caller's session so 00218's RESTRICTIVE policies and
 * bind triggers decide, and reports trigger refusals in their own words (opsError).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAsBuilt, templateFromRow } from '@esite/shared/solar-operations'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { INSTALL_REASONS, loadInstallationSeed } from '@/lib/solar/operations/baseline-loader'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type Err = { error: string }
type FieldErrors = { fieldErrors: Record<string, string> }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
function realDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && Number(m[1]) >= 2000
}

async function gate(projectId: string, need: 'view' | 'edit' | 'edit_financials'): Promise<{ supabase: AnyClient; userId: string } | Err> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}
const done = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

// ── Installation ──────────────────────────────────────────────────────────
export async function createInstallationAction(input: { projectId: string }): Promise<{ ok: true; installationId: string; warning: string | null } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { supabase, userId } = g
  const { data: study } = await supabase.schema('solar').from('studies').select('id, organisation_id').eq('project_id', input.projectId).maybeSingle()
  if (!study) return { error: INSTALL_REASONS.noStudy }
  const s = study as Row
  const seed = await loadInstallationSeed(createServiceClient() as unknown as AnyClient, String(s.id))
  if (!seed.ok) return { error: seed.reason }

  const { data, error } = await supabase.schema('solar').from('installations')
    .insert({ study_id: s.id, proposal_id: seed.proposalId, baseline: seed.baseline, as_built: seed.asBuilt }).select('id')
  if (error) return { error: error.code === '23505' ? INSTALL_REASONS.exists : opsError(error) }
  const installationId = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!installationId) return { error: 'Could not record the installation — try again.' }

  // The guarantee starts as the accepted case's P50 with the case's own degradation: nobody retypes it.
  const warnings: string[] = []
  const { error: gErr } = await supabase.schema('solar').from('guarantees')
    .insert({ installation_id: installationId, basis: 'p50', degradation_pct_per_year: seed.degradationPctPerYear })
  if (gErr) warnings.push('The guarantee basis could not be saved — set it on the Guarantee card.')
  const { data: tpl } = await supabase.schema('solar').from('handover_templates').select('name, items').eq('organisation_id', s.organisation_id).maybeSingle()
  const template = templateFromRow((tpl as { name: unknown; items: unknown } | null) ?? null)
  const { error: hErr } = await supabase.schema('solar').from('handover_items').insert(
    template.items.map((it, k) => ({ installation_id: installationId, item_key: it.key, label: it.label, required: it.required, sort_order: k })))
  if (hErr) warnings.push('The handover checklist could not be created — use "Add missing items" on the checklist.')

  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'installation_created', objectRef: { installationId, proposalId: seed.proposalId } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'created' } })
  done(input.projectId)
  return { ok: true, installationId, warning: warnings.length ? warnings.join(' ') : null }
}

export async function saveInstallationAction(input: {
  projectId: string; installationId: string; commissioningDate: string | null; asBuilt: unknown; notes: string | null; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const fieldErrors: Record<string, string> = {}
  const date = input.commissioningDate === null || input.commissioningDate === '' ? null : String(input.commissioningDate)
  if (date !== null && !realDate(date)) fieldErrors.commissioningDate = 'Enter a real date (YYYY-MM-DD).'
  const ab = parseAsBuilt(input.asBuilt)
  if (!ab.ok) fieldErrors.asBuilt = ab.errors.join('; ')
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (notes.length > 5000) fieldErrors.notes = 'At most 5000 characters.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const { data, error } = await g.supabase.schema('solar').from('installations')
    .update({ commissioning_date: date, as_built: ab.ok ? ab.value : null, notes: notes || null })
    .eq('id', input.installationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'installation_saved', objectRef: { installationId: input.installationId } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'saved' } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
```
(Tasks 20 and 21 widen this import as they add the code that uses more of the module.)

- [ ] **Step 4: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/actions/solar-operations.installation.test.ts 2>&1 | tail -5
git add apps/web/src/actions/solar-operations.actions.ts apps/web/src/actions/solar-operations.installation.test.ts apps/web/src/actions/solar-operations.test-helpers.ts
git commit -m "feat(solar): record the installation from the accepted proposal; save as-built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Meter, guarantee and irradiation actions

**Files:**
- Modify: `apps/web/src/actions/solar-operations.actions.ts` (append)
- Create: `apps/web/src/actions/solar-operations.inputs.test.ts`

- [ ] **Step 1: Failing test** `solar-operations.inputs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I, M } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  deleteIrradiationAction, linkMeterAction, saveGuaranteeAction, saveIrradiationAction, setMeterShareAction, unlinkMeterAction,
} from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('meters', () => {
  it('links a meter in a role; the trigger’s refusal is shown in its own words', async () => {
    const f = setup()
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'generation' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'insert')[0]!.payload).toEqual({ installation_id: I, meter_id: M, role: 'generation' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'meter_linked', objectRef: { meterId: M, role: 'generation' } })
    setup({ writes: { 'solar.installation_meters:insert': { error: { code: '23514', message: 'solar.installation_meters: a generation meter must be a solar meter' } } } })
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'generation' })).resolves.toEqual({ error: 'A generation meter must be a solar meter.' })
  })
  it('refuses an unknown role before any write', async () => {
    const f = setup()
    await expect(linkMeterAction({ projectId: P, installationId: I, meterId: M, role: 'tenant' as never })).resolves.toEqual({ error: 'Unknown meter role.' })
    expect(f.calls).toHaveLength(0)
  })
  it('unlinks and sets a share (null = equal split)', async () => {
    const f = setup()
    await expect(unlinkMeterAction({ projectId: P, installationId: I, meterId: M })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'delete')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'meter_id', M]])
    await expect(setMeterShareAction({ projectId: P, installationId: I, meterId: M, sharePct: 150 })).resolves.toEqual({ error: 'A share is between 0 and 100 %.' })
    await expect(setMeterShareAction({ projectId: P, installationId: I, meterId: M, sharePct: 60 })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.installation_meters', 'update')[0]!.payload).toEqual({ expected_share_pct: 60 })
  })
})

describe('guarantee', () => {
  it('field errors mirror the database CHECKs; no write', async () => {
    const f = setup()
    const r = await saveGuaranteeAction({ projectId: P, installationId: I, guarantee: { basis: 'pct_of_modelled', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }, expectedUpdatedAt: 'G1' })
    expect(r).toHaveProperty('fieldErrors.pct')
    expect(f.calls).toHaveLength(0)
  })
  it('updates on the loaded version, or inserts the first one', async () => {
    const f = setup({ writes: { 'solar.guarantees:update': { data: [{ updated_at: 'G2' }] } } })
    const g = { basis: 'manual', pct: null, manualMonthlyKwh: new Array(12).fill(1000), degradationPctPerYear: 0 }
    await expect(saveGuaranteeAction({ projectId: P, installationId: I, guarantee: g, expectedUpdatedAt: 'G1' })).resolves.toEqual({ ok: true, updatedAt: 'G2' })
    expect(callsTo(f.calls, 'solar.guarantees', 'update')[0]!.payload).toEqual({ basis: 'manual', pct: null, manual_monthly_kwh: new Array(12).fill(1000), degradation_pct_per_year: 0 })
    const f2 = setup({ writes: { 'solar.guarantees:insert': { data: [{ updated_at: 'G1' }] } } })
    await saveGuaranteeAction({ projectId: P, installationId: I, guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0.5 }, expectedUpdatedAt: null })
    expect(callsTo(f2.calls, 'solar.guarantees', 'insert')[0]!.payload).toMatchObject({ installation_id: I, basis: 'p50' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_guarantee_saved', properties: { basis: 'p50' } })
  })
})

describe('irradiation', () => {
  it('validates month, plane, value and source; replaces the month’s entry', async () => {
    const f = setup({ tables: { 'solar.ops_irradiation': [{ installation_id: I, month: '2026-03-01' }] } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-3', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station X' }))
      .resolves.toEqual({ fieldErrors: { month: 'Choose a month.' } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-03', plane: 'poa', kwhPerM2: 500, sourceNote: 'x' }))
      .resolves.toEqual({ fieldErrors: { kwhPerM2: 'Between 0 and 400 kWh/m².', sourceNote: 'Say where the figure comes from (3–300 characters).' } })
    await expect(saveIrradiationAction({ projectId: P, installationId: I, month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station X' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.ops_irradiation', 'update')[0]!.payload).toEqual({ plane: 'poa', kwh_per_m2: 150, source_note: 'Station X' })
    await expect(deleteIrradiationAction({ projectId: P, installationId: I, month: '2026-03' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.ops_irradiation', 'delete')[0]!.filters).toEqual([['eq', 'installation_id', I], ['eq', 'month', '2026-03-01']])
  })
})
```

- [ ] **Step 2: Run — FAIL. In `solar-operations.actions.ts` widen the shared import to**
```ts
import { isMonthKey, monthFirstDay, parseAsBuilt, parseGuarantee, templateFromRow } from '@esite/shared/solar-operations'
```
**and append:**

```ts
// ── Meters ────────────────────────────────────────────────────────────────
const ROLES = ['generation', 'consumption'] as const

export async function linkMeterAction(input: { projectId: string; installationId: string; meterId: string; role: 'generation' | 'consumption' }): Promise<{ ok: true } | Err> {
  if (!(ROLES as readonly string[]).includes(input.role)) return { error: 'Unknown meter role.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters')
    .insert({ installation_id: input.installationId, meter_id: input.meterId, role: input.role })
  if (error) return { error: error.code === '23505' ? 'That meter is already linked.' : opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'meter_linked', objectRef: { meterId: input.meterId, role: input.role } })
  done(input.projectId)
  return { ok: true }
}

export async function unlinkMeterAction(input: { projectId: string; installationId: string; meterId: string }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters').delete()
    .eq('installation_id', input.installationId).eq('meter_id', input.meterId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'meter_unlinked', objectRef: { meterId: input.meterId } })
  done(input.projectId)
  return { ok: true }
}

export async function setMeterShareAction(input: { projectId: string; installationId: string; meterId: string; sharePct: number | null }): Promise<{ ok: true } | Err> {
  if (input.sharePct !== null && !(typeof input.sharePct === 'number' && input.sharePct > 0 && input.sharePct <= 100)) return { error: 'A share is between 0 and 100 %.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters').update({ expected_share_pct: input.sharePct })
    .eq('installation_id', input.installationId).eq('meter_id', input.meterId)
  if (error) return { error: opsError(error) }
  done(input.projectId)
  return { ok: true }
}

// ── Guarantee ─────────────────────────────────────────────────────────────
export async function saveGuaranteeAction(input: { projectId: string; installationId: string; guarantee: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const parsed = parseGuarantee(input.guarantee)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const v = parsed.value
  const values = { basis: v.basis, pct: v.pct, manual_monthly_kwh: v.manualMonthlyKwh, degradation_pct_per_year: v.degradationPctPerYear }
  const t = () => g.supabase.schema('solar').from('guarantees')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ installation_id: input.installationId, ...values }).select('updated_at')
    : await t().update(values).eq('installation_id', input.installationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'guarantee_saved', objectRef: { basis: v.basis } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_guarantee_saved', properties: { basis: v.basis } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

// ── Irradiation ───────────────────────────────────────────────────────────
export async function saveIrradiationAction(input: {
  projectId: string; installationId: string; month: string; plane: 'ghi' | 'poa'; kwhPerM2: number; sourceNote: string
}): Promise<{ ok: true } | Err | FieldErrors> {
  const fieldErrors: Record<string, string> = {}
  if (!isMonthKey(input.month)) fieldErrors.month = 'Choose a month.'
  if (input.plane !== 'ghi' && input.plane !== 'poa') fieldErrors.plane = 'Choose horizontal (GHI) or plane of array (POA).'
  if (!(typeof input.kwhPerM2 === 'number' && input.kwhPerM2 > 0 && input.kwhPerM2 <= 400)) fieldErrors.kwhPerM2 = 'Between 0 and 400 kWh/m².'
  const note = typeof input.sourceNote === 'string' ? input.sourceNote.trim() : ''
  if (note.length < 3 || note.length > 300) fieldErrors.sourceNote = 'Say where the figure comes from (3–300 characters).'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const t = () => g.supabase.schema('solar').from('ops_irradiation')
  const month = monthFirstDay(input.month)
  const { data: existing } = await t().select('month').eq('installation_id', input.installationId).eq('month', month).maybeSingle()
  const values = { plane: input.plane, kwh_per_m2: input.kwhPerM2, source_note: note }
  const { error } = existing
    ? await t().update(values).eq('installation_id', input.installationId).eq('month', month)
    : await t().insert({ installation_id: input.installationId, month, ...values })
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'irradiation_saved', objectRef: { month: input.month, plane: input.plane } })
  done(input.projectId)
  return { ok: true }
}

export async function deleteIrradiationAction(input: { projectId: string; installationId: string; month: string }): Promise<{ ok: true } | Err> {
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('ops_irradiation').delete()
    .eq('installation_id', input.installationId).eq('month', monthFirstDay(input.month))
  if (error) return { error: opsError(error) }
  done(input.projectId)
  return { ok: true }
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/actions/solar-operations 2>&1 | tail -5
git add apps/web/src/actions/solar-operations.actions.ts apps/web/src/actions/solar-operations.inputs.test.ts
git commit -m "feat(solar): meter roles, guarantee basis and irradiation actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Downtime actions (add, confirm a candidate, edit, delete)

**Files:**
- Modify: `apps/web/src/actions/solar-operations.actions.ts` (append)
- Create: `apps/web/src/actions/solar-operations.downtime.test.ts`

- [ ] **Step 1: Failing test** `solar-operations.downtime.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { P, I, D } from './solar-operations.test-helpers'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit'),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), seed: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { addDowntimeAction, deleteDowntimeAction, updateDowntimeAction } from './solar-operations.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', writes: { 'solar.downtime:insert': { data: [{ id: D }] } }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
const good = { projectId: P, installationId: I, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T12:00', cause: 'inverter_fault', description: '', excludedFromGuarantee: false, source: 'manual' as const }
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('addDowntimeAction', () => {
  it('reads datetime-local as SAST and stores UTC', async () => {
    const f = setup()
    await expect(addDowntimeAction(good)).resolves.toEqual({ ok: true, id: D })
    expect(callsTo(f.calls, 'solar.downtime', 'insert')[0]!.payload).toEqual({
      installation_id: I, starts_at: '2026-03-10T08:00:00.000Z', ends_at: '2026-03-10T10:00:00.000Z',
      cause: 'inverter_fault', description: null, excluded_from_guarantee: false, source: 'manual',
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'downtime_added', objectRef: { id: D, hours: 2, source: 'manual' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_downtime_saved', properties: { action: 'added', source: 'manual' } })
  })
  it('a confirmed candidate arrives as ISO and is recorded as detected', async () => {
    const f = setup()
    await addDowntimeAction({ ...good, startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', source: 'detected' })
    expect(callsTo(f.calls, 'solar.downtime', 'insert')[0]!.payload).toMatchObject({ starts_at: '2026-03-10T09:30:00.000Z', source: 'detected' })
  })
  it('validates before writing', async () => {
    const f = setup()
    await expect(addDowntimeAction({ ...good, endsAt: '2026-03-10T09:00' })).resolves.toEqual({ fieldErrors: { endsAt: 'The end must be after the start.' } })
    await expect(addDowntimeAction({ ...good, endsAt: '2026-04-15T09:00' })).resolves.toEqual({ fieldErrors: { endsAt: 'One entry covers at most 31 days — split longer outages.' } })
    await expect(addDowntimeAction({ ...good, cause: 'aliens' })).resolves.toEqual({ fieldErrors: { cause: 'Choose a cause.' } })
    await expect(addDowntimeAction({ ...good, startsAt: 'yesterday' })).resolves.toEqual({ fieldErrors: { startsAt: 'Enter a date and time.' } })
    expect(f.calls).toHaveLength(0)
  })
  it('the overlap refusal is shown in words', async () => {
    setup({ writes: { 'solar.downtime:insert': { error: { code: '23P01', message: 'solar.downtime: this window overlaps recorded downtime' } } } })
    await expect(addDowntimeAction(good)).resolves.toEqual({ error: 'This window overlaps recorded downtime.' })
  })
})

describe('update / delete', () => {
  it('updates on the loaded version', async () => {
    const f = setup({ writes: { 'solar.downtime:update': { data: [{ updated_at: 'D2' }] } } })
    await expect(updateDowntimeAction({ projectId: P, id: D, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T11:00', cause: 'grid_outage', description: 'Eskom', excludedFromGuarantee: true, expectedUpdatedAt: 'D1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'D2' })
    const u = callsTo(f.calls, 'solar.downtime', 'update')[0]!
    expect(u.payload).toMatchObject({ cause: 'grid_outage', description: 'Eskom', excluded_from_guarantee: true })
    expect(u.filters).toEqual([['eq', 'id', D], ['eq', 'updated_at', 'D1']])
  })
  it('deletes (the history trigger keeps the old row)', async () => {
    const f = setup()
    await expect(deleteDowntimeAction({ projectId: P, id: D })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.downtime', 'delete')[0]!.filters).toEqual([['eq', 'id', D]])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'downtime_deleted', objectRef: { id: D } })
  })
})
```

- [ ] **Step 2: Run — FAIL. In `solar-operations.actions.ts` widen the shared import to**
```ts
import { isMonthKey, monthFirstDay, parseAsBuilt, parseGuarantee, sastLocalToIso, templateFromRow } from '@esite/shared/solar-operations'
```
**and append:**

```ts
// ── Downtime ──────────────────────────────────────────────────────────────
const CAUSES = ['grid_outage', 'inverter_fault', 'planned_maintenance', 'unplanned_maintenance', 'curtailment', 'communications', 'weather_damage', 'other']
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

/** A datetime-local value (read as SAST) or an ISO UTC instant (a confirmed candidate). */
function when(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (ISO_RE.test(v) && Number.isFinite(Date.parse(v))) return new Date(v).toISOString()
  return sastLocalToIso(v)
}

function checkDowntime(i: { startsAt: unknown; endsAt: unknown; cause: unknown; description: unknown }):
  { ok: true; startsAt: string; endsAt: string; description: string | null } | FieldErrors {
  const fieldErrors: Record<string, string> = {}
  const s = when(i.startsAt)
  const e = when(i.endsAt)
  if (!s) fieldErrors.startsAt = 'Enter a date and time.'
  if (!e) fieldErrors.endsAt = 'Enter a date and time.'
  if (s && e && Date.parse(e) <= Date.parse(s)) fieldErrors.endsAt = 'The end must be after the start.'
  else if (s && e && Date.parse(e) - Date.parse(s) > 31 * 86_400_000) fieldErrors.endsAt = 'One entry covers at most 31 days — split longer outages.'
  if (typeof i.cause !== 'string' || !CAUSES.includes(i.cause)) fieldErrors.cause = 'Choose a cause.'
  const d = typeof i.description === 'string' ? i.description.trim() : ''
  if (d.length > 2000) fieldErrors.description = 'At most 2000 characters.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  return { ok: true, startsAt: s!, endsAt: e!, description: d || null }
}

export async function addDowntimeAction(input: {
  projectId: string; installationId: string; startsAt: string; endsAt: string; cause: string; description: string
  excludedFromGuarantee: boolean; source: 'manual' | 'detected'
}): Promise<{ ok: true; id: string } | Err | FieldErrors> {
  const c = checkDowntime(input)
  if (!('ok' in c)) return c
  const source = input.source === 'detected' ? 'detected' : 'manual'
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('downtime').insert({
    installation_id: input.installationId, starts_at: c.startsAt, ends_at: c.endsAt, cause: input.cause,
    description: c.description, excluded_from_guarantee: input.excludedFromGuarantee === true, source,
  }).select('id')
  if (error) return { error: opsError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Could not record the downtime — try again.' }
  const hours = Math.round(((Date.parse(c.endsAt) - Date.parse(c.startsAt)) / 3_600_000) * 100) / 100
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_added', objectRef: { id, hours, source } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_downtime_saved', properties: { action: 'added', source } })
  done(input.projectId)
  return { ok: true, id }
}

export async function updateDowntimeAction(input: {
  projectId: string; id: string; startsAt: string; endsAt: string; cause: string; description: string
  excludedFromGuarantee: boolean; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const c = checkDowntime(input)
  if (!('ok' in c)) return c
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('downtime').update({
    starts_at: c.startsAt, ends_at: c.endsAt, cause: input.cause, description: c.description,
    excluded_from_guarantee: input.excludedFromGuarantee === true,
  }).eq('id', input.id).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_updated', objectRef: { id: input.id } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_downtime_saved', properties: { action: 'updated', source: 'manual' } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

export async function deleteDowntimeAction(input: { projectId: string; id: string }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('downtime').delete().eq('id', input.id)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_deleted', objectRef: { id: input.id } })
  done(input.projectId)
  return { ok: true }
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/actions/solar-operations 2>&1 | tail -5
git add apps/web/src/actions/solar-operations.actions.ts apps/web/src/actions/solar-operations.downtime.test.ts
git commit -m "feat(solar): downtime add / confirm candidate / edit / delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Handover actions + the org template action

**Files:**
- Create: `apps/web/src/actions/solar-handover.actions.ts`, `solar-handover.actions.test.ts`

- [ ] **Step 1: Failing test** `solar-handover.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), requireSolarLevel: vi.fn(async () => 'edit'), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}),
  revalidate: vi.fn(), org: vi.fn(async () => ({ organisationId: 'o1' })), requireRole: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.org }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))

import { linkHandoverDocumentAction, saveHandoverTemplateAction, setHandoverNotApplicableAction, syncHandoverItemsAction } from './solar-handover.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const item = { id: 'h1', installation_id: 'i1', item_key: 'coc', label: 'CoC' }
function setup(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const f = fakeSupabase({ userId: 'u1', tables: { 'solar.handover_items': [item] }, ...extra })
  h.createClient.mockResolvedValue(f.client)
  return f
}
beforeEach(() => { vi.clearAllMocks(); h.requireRole.mockResolvedValue({ ok: true }) })

describe('handover items', () => {
  it('links a Documents file (Edit, FIRST) and records who', async () => {
    const f = setup()
    await expect(linkHandoverDocumentAction({ projectId: P, itemId: 'h1', documentId: 'd1' })).resolves.toEqual({ ok: true })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(f.calls, 'solar.handover_items', 'update')[0]!.payload).toEqual({ document_id: 'd1', not_applicable: false })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'handover_updated', objectRef: { item: 'CoC', documentId: 'd1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_handover_updated', properties: { change: 'linked' } })
  })
  it('a document from another project is refused in words', async () => {
    setup({ writes: { 'solar.handover_items:update': { error: { code: '23514', message: 'solar.handover_items: the document belongs to another project' } } } })
    await expect(linkHandoverDocumentAction({ projectId: P, itemId: 'h1', documentId: 'd2' })).resolves.toEqual({ error: 'The document belongs to another project.' })
  })
  it('N/A clears the document and keeps a note', async () => {
    const f = setup()
    await expect(setHandoverNotApplicableAction({ projectId: P, itemId: 'h1', notApplicable: true, note: '  No battery  ' })).resolves.toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.handover_items', 'update')[0]!.payload).toEqual({ not_applicable: true, document_id: null, note: 'No battery' })
  })
  it('adds template items the checklist lacks, never duplicating', async () => {
    const f = setup({ tables: { 'solar.handover_items': [item], 'solar.installations': [{ id: 'i1', organisation_id: 'o1' }], 'solar.handover_templates': [] } })
    await expect(syncHandoverItemsAction({ projectId: P, installationId: 'i1' })).resolves.toEqual({ ok: true, added: 8 })
    const rows = callsTo(f.calls, 'solar.handover_items', 'insert')[0]!.payload as Array<Record<string, unknown>>
    expect(rows.map((r) => r.item_key)).not.toContain('coc')
  })
})

describe('saveHandoverTemplateAction', () => {
  it('owner/admin only, validated, stale-guarded', async () => {
    h.requireRole.mockResolvedValue({ ok: false })
    setup()
    await expect(saveHandoverTemplateAction({ name: 'X', items: [{ key: 'coc', label: 'CoC', required: true }], expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change the handover template.' })
    h.requireRole.mockResolvedValue({ ok: true })
    await expect(saveHandoverTemplateAction({ name: 'X', items: [], expectedUpdatedAt: null })).resolves.toHaveProperty('fieldErrors')
    const f = setup({ writes: { 'solar.handover_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveHandoverTemplateAction({ name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }], expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.handover_templates', 'insert')[0]!.payload).toEqual({ organisation_id: 'o1', name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }] })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `solar-handover.actions.ts`:

```ts
'use server'
/**
 * Handover checklist (spec §10): each item links ONE file of the project's E-Site Documents
 * (tenants.documents) or is marked N/A. The org template lives in /settings/solar (owner/admin).
 * 00218's bind trigger refuses a document from another project and stamps completion.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { parseHandoverTemplate, templateFromRow } from '@esite/shared/solar-operations'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type Err = { error: string }

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | Err> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

async function itemLabel(supabase: AnyClient, itemId: string): Promise<string | null> {
  const { data } = await supabase.schema('solar').from('handover_items').select('label').eq('id', itemId).maybeSingle()
  return data ? String((data as Row).label) : null
}

export async function linkHandoverDocumentAction(input: { projectId: string; itemId: string; documentId: string | null }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const label = await itemLabel(g.supabase, input.itemId)
  if (!label) return { error: 'That checklist item no longer exists — reload.' }
  const { error } = await g.supabase.schema('solar').from('handover_items')
    .update({ document_id: input.documentId, not_applicable: false }).eq('id', input.itemId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'handover_updated', objectRef: { item: label, documentId: input.documentId } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_handover_updated', properties: { change: input.documentId ? 'linked' : 'unlinked' } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function setHandoverNotApplicableAction(input: { projectId: string; itemId: string; notApplicable: boolean; note: string }): Promise<{ ok: true } | Err> {
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > 1000) return { error: 'The note is at most 1000 characters.' }
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const label = await itemLabel(g.supabase, input.itemId)
  if (!label) return { error: 'That checklist item no longer exists — reload.' }
  const payload = input.notApplicable === true ? { not_applicable: true, document_id: null, note: note || null } : { not_applicable: false, note: note || null }
  const { error } = await g.supabase.schema('solar').from('handover_items').update(payload).eq('id', input.itemId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'handover_updated', objectRef: { item: label, notApplicable: input.notApplicable === true } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_handover_updated', properties: { change: input.notApplicable ? 'not_applicable' : 'applicable' } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function syncHandoverItemsAction(input: { projectId: string; installationId: string }): Promise<{ ok: true; added: number } | Err> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const solar = () => g.supabase.schema('solar')
  const { data: inst } = await solar().from('installations').select('id, organisation_id').eq('id', input.installationId).maybeSingle()
  if (!inst) return { error: 'The installation could not be found — reload.' }
  const [{ data: tpl }, { data: have }] = await Promise.all([
    solar().from('handover_templates').select('name, items').eq('organisation_id', String((inst as Row).organisation_id)).maybeSingle(),
    solar().from('handover_items').select('item_key, sort_order').eq('installation_id', input.installationId),
  ])
  const existing = new Set(((have ?? []) as Row[]).map((r) => String(r.item_key)))
  const maxOrder = Math.max(-1, ...((have ?? []) as Row[]).map((r) => Number(r.sort_order ?? 0)))
  const missing = templateFromRow((tpl as { name: unknown; items: unknown } | null) ?? null).items.filter((it) => !existing.has(it.key))
  if (missing.length === 0) return { ok: true, added: 0 }
  const { error } = await solar().from('handover_items').insert(missing.map((it, k) => ({
    installation_id: input.installationId, item_key: it.key, label: it.label, required: it.required, sort_order: maxOrder + 1 + k,
  })))
  if (error) return { error: opsError(error) }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, added: missing.length }
}

export async function saveHandoverTemplateAction(input: { name: string; items: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; updatedAt: string } | Err | { fieldErrors: Record<string, string> }> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const r = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!r.ok) return { error: 'Only an organisation owner or admin can change the handover template.' }
  const parsed = parseHandoverTemplate({ name: typeof input.name === 'string' ? input.name.trim() : input.name, items: input.items })
  if (!parsed.ok) return { fieldErrors: { template: parsed.errors.join('; ') } }
  const values = { name: parsed.value.name, items: parsed.value.items }
  const t = () => supabase.schema('solar').from('handover_templates')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ organisation_id: ctx.organisationId, ...values }).select('updated_at')
    : await t().update(values).eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/actions/solar-handover.actions.test.ts 2>&1 | tail -5
git add apps/web/src/actions/solar-handover.actions.ts apps/web/src/actions/solar-handover.actions.test.ts
git commit -m "feat(solar): handover checklist actions linked to E-Site Documents; org template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Lost revenue through the bill engine

**Files:**
- Create: `apps/web/src/lib/solar/operations/lost-revenue.ts`, `lost-revenue.test.ts`

- [ ] **Step 1: Failing test** `lost-revenue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ tariff: vi.fn(), create: vi.fn(() => ({ monthlyBills: () => [] })) }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), createBillCalculator: h.create }))

import { energyOnlyBuild, valueLostEnergy } from './lost-revenue'

/** A tariff whose March energy costs R2/kWh; R100 fixed per month; demand would cost R50/kW if not forced to 0. */
const calc = {
  monthlyBills: ({ importKwh }: { importKwh: Float64Array }) => Array.from({ length: 12 }, (_, k) => ({
    month: k + 1, totalZar: 100 + (k === 2 ? importKwh.reduce((s, v) => s + v, 0) * 2 : 0), exportCreditUsedZar: 0,
  })),
  withExportRateScaled: () => calc,
}
const series = (hour: number, kwh: number) => { const s = new Float64Array(8760); s[hour] = kwh; return s }

beforeEach(() => {
  vi.clearAllMocks()
  h.tariff.mockResolvedValue({ ok: true, calc, calendar: {}, holidays: new Set(), year: 2026,
    tariffRef: { tariffId: 't', tariffName: 'Business 1', financialYear: '2026/27', licenseeName: 'City of Tshwane' } })
})

describe('valueLostEnergy', () => {
  it('values each event and the month as the marginal energy cost at the pinned tariff, fixed charges cancelling', async () => {
    const r = await valueLostEnergy({} as never, 'p1', '2026-03', [series(1600, 10), series(1601, 5)])
    expect(r).toEqual({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [20, 10], totalZar: 30 })
    expect(h.tariff).toHaveBeenCalledWith({}, 'p1', { year: 2026, build: energyOnlyBuild })
  })
  it('no events → zero, still naming the tariff', async () => {
    await expect(valueLostEnergy({} as never, 'p1', '2026-03', [])).resolves.toEqual({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [], totalZar: 0 })
  })
  it('passes the tariff reason through (Generate is disabled with it)', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(valueLostEnergy({} as never, 'p1', '2026-03', [series(1, 1)])).resolves.toEqual({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
})

describe('energyOnlyBuild', () => {
  it('forces maximum and peak-window demand to zero and keeps NMD', () => {
    energyOnlyBuild({} as never, {} as never, new Set(), { year: 2026, demandForMonth: () => ({ nmdKva: 500 }) } as never)
    const opts = (h.create.mock.calls[0] as unknown[])[3] as { demandForMonth: (m: number) => Record<string, number>; year: number }
    expect(opts.year).toBe(2026)
    expect(opts.demandForMonth(3)).toEqual({ nmdKva: 500, maxDemandKva: 0, maxDemandKw: 0, peakWindowMdKva: 0 })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `lost-revenue.ts`:

```ts
import 'server-only'
/**
 * Lost revenue for the monthly report (spec §10: "lost revenue at the pinned tariff's TOU rates via
 * the bill engine"; WM used one flat rate, G13). The lost kWh are placed on the bill engine's 8760
 * hours (lost-energy.ts) and costed as IMPORT on the pinned tariff for the report's calendar year,
 * so each kWh carries the TOU rate of the hour it was lost in. Maximum and peak-window demand are
 * forced to 0 so the lost energy cannot create a demand charge; fixed charges cancel because the
 * figure is bill(lost) − bill(nothing). Rand excl. VAT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBillCalculator } from '@esite/shared'
import { monthParts, type MonthKey } from '@esite/shared/solar-operations'
import { resolveStudyTariff } from '@/lib/solar/cases/tariff'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Build = NonNullable<NonNullable<Parameters<typeof resolveStudyTariff>[2]>['build']>

export const energyOnlyBuild: Build = (tariff, calendar, holidays, opts) =>
  createBillCalculator(tariff, calendar, holidays, {
    ...opts,
    demandForMonth: (m: number) => ({ ...(opts?.demandForMonth?.(m) ?? {}), maxDemandKva: 0, maxDemandKw: 0, peakWindowMdKva: 0 }),
  })

const r2 = (x: number) => Math.round(x * 100) / 100

export async function valueLostEnergy(svc: AnyClient, projectId: string, month: MonthKey, events: readonly Float64Array[]):
  Promise<{ ok: true; tariffName: string; perEventZar: number[]; totalZar: number } | { ok: false; reason: string }> {
  const { year, month: m } = monthParts(month)
  const t = await resolveStudyTariff(svc, projectId, { year, build: energyOnlyBuild })
  if (!t.ok) return { ok: false, reason: t.reason }
  const zeros = new Float64Array(8760)
  const bill = (imp: Float64Array) => t.calc.monthlyBills({ importKwh: imp, exportKwh: zeros })[m - 1]!.totalZar
  const base = bill(zeros)
  const perEventZar = events.map((e) => r2(bill(e) - base))
  let totalZar = 0
  if (events.length > 0) {
    const all = new Float64Array(8760)
    for (const e of events) for (let k = 0; k < 8760; k++) all[k] = all[k]! + e[k]!
    totalZar = r2(bill(all) - base)
  }
  const ref = t.tariffRef
  return { ok: true, tariffName: `${ref.tariffName} (${ref.licenseeName}, ${ref.financialYear})`, perEventZar, totalZar }
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): lost revenue at the pinned tariff's TOU rates via the bill engine").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/operations/lost-revenue.test.ts 2>&1 | tail -4
git add apps/web/src/lib/solar/operations/lost-revenue.ts apps/web/src/lib/solar/operations/lost-revenue.test.ts
git commit -m "feat(solar): lost revenue at the pinned tariff's TOU rates via the bill engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Monthly report PDF (glyph-safe)

**Files:**
- Create: `apps/web/src/lib/solar/operations/monthly-document.tsx`
- Create: `apps/web/src/lib/solar/operations/render-monthly.ts`, `render-monthly.render.test.ts`

- [ ] **Step 1: Failing test** `render-monthly.render.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildMonthlySnapshot, monthlyReportModel, performanceRows, sourceRows, yearToDate } from '@esite/shared/solar-operations'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderMonthlyReport } from './render-monthly'

const baseline = {
  version: 1 as const, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000), diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 14 ? 5 : 0))), ghiKwhM2: null,
}
const guarantee = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }
const rows = performanceRows({ months: ['2026-02', '2026-03'], baseline, guarantee, commissioningDate: '2026-02-15', dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 20160 }, '2026-03': { kwh: 900, coverageMinutes: 44640 } }, generationMeterCount: 1, downtime: [], irradiation: [] })
const snapshot = (hostile: boolean) => buildMonthlySnapshot({
  period: '2026-03', generatedAt: '2026-04-02T08:00:00.000Z', projectName: hostile ? 'Mall → North ≤ Ω ✓' : 'Acme Mall', commissioningDate: '2026-02-15',
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module', make: hostile ? 'Acme Ω' : 'Acme', model: 'M-550', rating: 550, unit: 'W', quantity: 182 }, { kind: 'inverter', make: 'Volt', model: 'I-80', rating: 80, unit: 'kW', quantity: 1 }] },
  baseline, guarantee, performance: rows[1]!,
  sources: sourceRows([{ meterId: 'm1', label: 'PV main', sharePct: null }], { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } }, '2026-03', rows[1]!.guaranteeKwh),
  downtime: [{ startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: hostile ? 'Trip ✓ → reset' : 'Trip',
    excludedFromGuarantee: false, source: 'detected', lostKwh: 16.13, lostZar: 42.5 }],
  lostZarTotal: 42.5, tariff: { name: 'Business 1 (City of Tshwane, 2026/27)' }, ytd: yearToDate(rows, '2026-03'),
  consumption: { gridKwh: 12000, meterLabels: ['Council main'] },
  notes: { summary: hostile ? 'Good ≥ plan ✓' : 'Good', actions: 'Replace fuse' },
})
const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' },
  { title: 'Solar monthly report', kicker: 'SOLAR MONTHLY REPORT', date: '2026-04-02' }).branding

describe('renderMonthlyReport (real render, decoded content streams)', () => {
  it('prints every section, the real YTD, the equipment from the record and the lost revenue', async () => {
    const text = squash(extractPdfText(await renderMonthlyReport(monthlyReportModel(snapshot(false)), brand)))
    for (const t of ['Performance summary', 'Expected vs actual per source', 'Year to date', 'Downtime', 'Realised consumption', 'Installed equipment', 'Commentary and actions', 'Basis of figures']) {
      expect(text).toContain(squash(t))
    }
    expect(text).toContain(squash('1 350'))
    expect(text).toContain(squash('M-550'))
    expect(text).toContain(squash('R 43'))
    expect(text).not.toMatch(/\[MODULE|PLACEHOLDER|Tie-In/)
  }, 30_000)
  it('no glyph outside WinAnsi reaches the PDF; hostile ones are spelled out', async () => {
    const text = extractPdfText(await renderMonthlyReport(monthlyReportModel(snapshot(true)), brand))
    expect([...text].filter((c) => c !== '\n' && !isWinAnsi(c))).toEqual([])
    expect(squash(text)).toContain(squash('Acme Ohm'))
    expect(squash(text)).toContain(squash('Trip Yes -> reset'))
    expect(squash(text)).toContain(squash('Good >= plan Yes'))
    expect(text).not.toContain('©')
  }, 30_000)
})
```

- [ ] **Step 2: Run — FAIL. Implement** `monthly-document.tsx`:

```tsx
/**
 * Solar monthly report PDF (spec §10). Server-side react-pdf only (no 'use client'). Renders the
 * model built from the STORED snapshot verbatim — every string through pdfText().
 */
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { Cover, Document, pageStyles } from '@/lib/reports/components'
import type { ReportSection, ReportTable } from '@esite/shared/solar-reports'
import { pdfText } from '@/lib/solar/reports/pdf-text'

export interface MonthlyReportModelView { title: string; kicker: string; sections: ReportSection[] }

const s = StyleSheet.create({
  body: { paddingBottom: 40 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4, color: '#222222' },
  table: { marginTop: 4, marginBottom: 8, borderTopWidth: 0.5, borderTopColor: '#999999' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD' },
  head: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: '#999999', backgroundColor: '#F4F5F7' },
  cell: { flex: 1, fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  cellHead: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2.5, paddingHorizontal: 3 },
  num: { textAlign: 'right' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
})

function Table({ t, accent }: { t: ReportTable; accent: string }) {
  return (
    <View style={[s.table, { borderTopColor: accent }]}>
      <View style={s.head} fixed>
        {t.columns.map((c, i) => <Text key={i} style={[s.cellHead, t.numeric[i] ? s.num : {}]}>{pdfText(c)}</Text>)}
      </View>
      {t.rows.map((r, ri) => (
        <View key={ri} style={s.row} wrap={false}>
          {r.map((c, ci) => <Text key={ci} style={[s.cell, t.numeric[ci] ? s.num : {}]}>{pdfText(c)}</Text>)}
        </View>
      ))}
    </View>
  )
}

export function MonthlyReportDocument({ model, branding }: { model: MonthlyReportModelView; branding: ResolvedBranding }) {
  return (
    <Document title={branding.title} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={branding} />
      </Page>
      <Page size="A4" style={pageStyles.page} wrap>
        <View style={s.body}>
          {model.sections.map((sec) => (
            <View key={sec.title}>
              <Text style={[s.h2, { color: branding.accent }]} minPresenceAhead={60}>{pdfText(sec.title)}</Text>
              {sec.paragraphs.map((p, i) => <Text key={i} style={s.p}>{pdfText(p)}</Text>)}
              {sec.tables.map((t, i) => <Table key={i} t={t} accent={branding.accent} />)}
            </View>
          ))}
        </View>
        <View style={s.footer} fixed>
          <Text>{branding.footerStamp}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
```

`render-monthly.ts`:
```ts
// Node-only: renderToBuffer is unavailable in the browser build. Tests use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { MonthlyReportDocument, type MonthlyReportModelView } from './monthly-document'

export async function renderMonthlyReport(model: MonthlyReportModelView, branding: ResolvedBranding): Promise<Buffer> {
  const el = React.createElement(MonthlyReportDocument, { model, branding }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
```
(`ReportSection` / `ReportTable` are re-exported by `@esite/shared/solar-reports`; if Task 14 Step 1 found them in a different file, import from the subpath anyway — the barrel re-exports every file.)

- [ ] **Step 3: Run — PASS.** If the glyph test fails, find the string that bypassed `pdfText` (the failing character names the field) — never loosen the assertion.

- [ ] **Step 4: Prove the glyph test can fail.** Temporarily change `pdfText(c)` in the table body cell of `monthly-document.tsx` to `c`, re-run: the equipment row (`Acme Ω`) must go red. Revert.

- [ ] **Step 5: Add the Watson Mattheus guard's new root.** In `apps/web/src/lib/solar/reports/branding.test.ts` (Phase 6), add `'lib/solar/operations'` to the `roots` array of "no hard-coded Watson Mattheus in Solar report code". Run it.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/operations/render-monthly.render.test.ts src/lib/solar/reports/branding.test.ts 2>&1 | tail -6
git add apps/web/src/lib/solar/operations/monthly-document.tsx apps/web/src/lib/solar/operations/render-monthly.ts \
  apps/web/src/lib/solar/operations/render-monthly.render.test.ts apps/web/src/lib/solar/reports/branding.test.ts
git commit -m "feat(solar): monthly report PDF (glyph-safe, no placeholders)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: Generate a monthly report version; save commentary

**Files:**
- Create: `apps/web/src/lib/solar/operations/monthly-report.ts`, `monthly-report.test.ts`
- Create: `apps/web/src/actions/solar-monthly-report.actions.ts`, `solar-monthly-report.actions.test.ts`
- Modify: `apps/web/src/lib/reports/report-kind-access.contract.test.ts` (writer scanner)

- [ ] **Step 1: Failing test** `monthly-report.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ view: vi.fn(), series: vi.fn(), months: vi.fn(), value: vi.fn(), brand: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-monthly')) }))
vi.mock('./data', () => ({ loadOperationsView: h.view }))
vi.mock('./series', () => ({ loadMonthSeries: h.series, loadMeterMonths: h.months }))
vi.mock('./lost-revenue', () => ({ valueLostEnergy: h.value }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brand }))
vi.mock('./render-monthly', () => ({ renderMonthlyReport: h.render }))

import { generateMonthlyReport, MONTHLY_ERRORS } from './monthly-report'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

const baseline = { version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000), diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, x) => (x >= 10 && x < 14 ? 5 : 0))), ghiKwhM2: null }
const perfRow = (month: string, actual: number | null) => ({ month, operatingYear: 1, expectedKwh: 1000, excludedKwh: 0, guaranteeKwh: 1000, actualKwh: actual,
  varianceKwh: actual === null ? null : actual - 1000, variancePct: actual === null ? null : (actual - 1000) / 10, performanceRatio: null, correctedExpectedKwh: null,
  irradiationPlane: null, downtimeHours: 0, excludedHours: 0, coveragePct: 100 })
const view = (over: Record<string, unknown> = {}) => ({
  level: 'edit_financials', canEdit: true, canSeeMoney: true, studyId: 's1', organisationId: 'o1', setupReason: null, acceptedProposal: null,
  installation: { id: 'i1', commissioningDate: '2026-01-10', notes: null, updatedAt: 'T', baseline,
    asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0, equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }, { kind: 'inverter', make: 'V', model: 'I', rating: 80, unit: 'kW', quantity: 1 }] } },
  meters: [{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation', sharePct: null }, { meterId: 'm2', label: 'Council', kind: 'council', role: 'consumption', sharePct: null }],
  availableMeters: [], guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0, updatedAt: 'G' }, irradiation: [],
  downtime: [{ id: 'd1', startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: null, excludedFromGuarantee: false, source: 'manual', updatedAt: 'D', lostKwh: 16 }],
  months: ['2026-01', '2026-02', '2026-03'], selectedMonth: '2026-03',
  performance: [perfRow('2026-01', 700), perfRow('2026-02', 950), perfRow('2026-03', 900)],
  candidates: [], handover: { items: [], completion: { done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 }, documents: [], templateName: 'x' },
  monthly: { notes: { summary: 'Good', performance: '', downtime: '', financial: '', actions: '' }, notesUpdatedAt: {}, generateReason: null, tariffName: 'Business 1' },
  readiness: null, ...over,
})

function setup(prior: Array<Record<string, unknown>> = [], writes: Record<string, unknown> = {}) {
  const svc = withStorage(fakeSupabase({ tables: { 'solar.monthly_reports': prior, 'projects.projects': [{ id: 'p1', name: 'Acme Mall' }] },
    writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] }, 'solar.monthly_reports:insert': { data: [{ id: 'mr-new' }] }, ...writes } as never }))
  return { svc, args: { projectId: 'p1', month: '2026-03', note: 'Rev A', userId: 'u1', user: fakeSupabase().client as never, svc: svc.client as never } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.view.mockResolvedValue(view())
  h.series.mockResolvedValue([])
  h.months.mockImplementation(async (_c: unknown, _i: string, role: string) => role === 'consumption'
    ? { m2: { '2026-03': { kwh: 12000, n: 1488, intervalMin: 30 } } } : { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } })
  h.value.mockResolvedValue({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [42.5], totalZar: 42.5 })
  h.brand.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: '#0055AA', projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' })
})

describe('generateMonthlyReport', () => {
  it('stores v1: PDF, a projects.reports row (solar_monthly, per-period version) and the frozen snapshot', async () => {
    const { svc, args } = setup()
    const r = await generateMonthlyReport(args)
    expect(r).toMatchObject({ ok: true, reportId: 'rep-new', version: 1 })
    const up = svc.bucket.upload.mock.calls[0] as unknown as [string, Uint8Array, unknown]
    expect(up[0]).toMatch(/^o1\/p1\/solar-monthly\/2026-03-v1-[0-9a-f]{12}\.pdf$/)
    const rep = callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(rep).toMatchObject({ kind: 'solar_monthly', source_table: 'solar.installations', source_id: 'i1', version: 1, status: 'issued', note: 'Rev A', generated_by: 'u1',
      summary: { period: '2026-03', actualKwh: 900, guaranteeKwh: 1000, variancePct: -10 } })
    const mr = callsTo(svc.calls, 'solar.monthly_reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(mr).toMatchObject({ installation_id: 'i1', period_month: '2026-03-01', version: 1, report_id: 'rep-new', generated_by: 'u1' })
    const snap = mr.snapshot as { ytd: { actualKwh: number }; lost: { zar: number }; consumption: { gridKwh: number }; notes: { summary: string } }
    expect(snap.ytd.actualKwh).toBe(2550)
    expect(snap.lost.zar).toBe(42.5)
    expect(snap.consumption.gridKwh).toBe(12000)
    expect(snap.notes.summary).toBe('Good')
    expect(mr.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(mr.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('v2 supersedes v1’s report row and never touches v1’s snapshot', async () => {
    const { svc, args } = setup([{ installation_id: 'i1', period_month: '2026-03-01', version: 1, report_id: 'rep-1' }])
    await expect(generateMonthlyReport(args)).resolves.toMatchObject({ ok: true, version: 2 })
    expect(callsTo(svc.calls, 'solar.monthly_reports', 'update')).toHaveLength(0)
    const upd = callsTo(svc.calls, 'projects.reports', 'update')[0]!
    expect(upd.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(upd.filters).toContainEqual(['eq', 'id', 'rep-1'])
  })
  it('refuses with the view’s reason, or when the month has no data', async () => {
    h.view.mockResolvedValue(view({ monthly: { ...view().monthly, generateReason: 'No tariff is pinned for this study — pin one on the Tariff tab.' } }))
    await expect(generateMonthlyReport(setup().args)).resolves.toEqual({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    h.view.mockResolvedValue(view({ selectedMonth: '2026-02' }))
    await expect(generateMonthlyReport(setup().args)).resolves.toEqual({ ok: false, error: 'There is no generation data for March 2026.' })
  })
  it('a concurrent generation loses cleanly: the report row and the PDF are removed', async () => {
    const { svc, args } = setup([], { 'solar.monthly_reports:insert': { error: { code: '23505', message: 'solar.monthly_reports: version 1 is not the next version' } } })
    await expect(generateMonthlyReport(args)).resolves.toEqual({ ok: false, error: MONTHLY_ERRORS.race })
    expect(callsTo(svc.calls, 'projects.reports', 'delete')[0]!.filters).toContainEqual(['eq', 'id', 'rep-new'])
    expect(svc.bucket.remove).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `monthly-report.ts`:

```ts
import 'server-only'
/**
 * Generate one monthly report VERSION (spec §10): the numbers come from the Operations view model
 * (the same code the tab shows), lost revenue from the bill engine, commentary from the notes table.
 * Everything the PDF prints is first frozen into a snapshot; the PDF is rendered from the snapshot;
 * both are stored (projects.reports + solar.monthly_reports). v(n+1) supersedes v(n)'s report row and
 * never edits v(n) — 00218 makes the snapshot table immutable. The caller has already gated Edit +
 * financials; `svc` writes the report tables and the PDF after that gate.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildMonthlySnapshot, expectedForMonth, lostHourlyKwh, lostKwh, lostSteps, monthEndMs, monthFirstDay, monthLabel,
  monthlyReportModel, monthStartMs, sourceRows, totalsByMonth, yearToDate, type MonthKey,
} from '@esite/shared/solar-operations'
import { solarBranding } from '@/lib/solar/reports/branding'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { loadOperationsView } from './data'
import { valueLostEnergy } from './lost-revenue'
import { renderMonthlyReport } from './render-monthly'
import { loadMeterMonths, loadMonthSeries } from './series'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const MONTHLY_ERRORS = {
  noInstallation: 'Record the installation first.',
  store: 'Could not store the report — try again.',
  save: 'Could not save the report — try again.',
  race: 'Someone generated this month at the same time — reload and try again.',
} as const

export interface GenerateMonthlyInput { projectId: string; month: MonthKey; note: string | null; userId: string; user: AnyClient; svc: AnyClient }
export type GenerateMonthlyResult = { ok: true; reportId: string; version: number; warning: string | null } | { ok: false; error: string }

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

export async function generateMonthlyReport(i: GenerateMonthlyInput): Promise<GenerateMonthlyResult> {
  const v = await loadOperationsView({ user: i.user, svc: i.svc, projectId: i.projectId, level: 'edit_financials', month: i.month })
  if (!v.installation || !v.organisationId) return { ok: false, error: MONTHLY_ERRORS.noInstallation }
  if (v.selectedMonth !== i.month) return { ok: false, error: `There is no generation data for ${monthLabel(i.month)}.` }
  if (v.monthly?.generateReason) return { ok: false, error: v.monthly.generateReason }
  const row = v.performance.find((r) => r.month === i.month)
  if (!row || !v.guarantee || !v.installation.commissioningDate) return { ok: false, error: `There is no generation data for ${monthLabel(i.month)}.` }
  const inst = v.installation
  const guarantee = v.guarantee
  const commissioningDate = inst.commissioningDate!

  // Lost energy per downtime event inside the month, on the bill engine's hours.
  const points = await loadMonthSeries(i.user, inst.id, 'generation', i.month)
  const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee, baseline: inst.baseline, commissioningDate })?.fullKwh ?? 0
  const m0 = monthStartMs(i.month)
  const m1 = monthEndMs(i.month)
  const events = v.downtime
    .map((d) => ({ d, w0: Math.max(Date.parse(d.startsAt), m0), w1: Math.min(Date.parse(d.endsAt), m1) }))
    .filter((x) => x.w1 > x.w0)
    .map((x) => ({ ...x, steps: lostSteps({ startMs: x.w0, endMs: x.w1 }, points, inst.baseline, fullFor) }))
  const valuation = await valueLostEnergy(i.svc, i.projectId, i.month, events.map((e) => lostHourlyKwh(e.steps)))
  if (!valuation.ok) return { ok: false, error: valuation.reason }

  const [genMonths, consMonths, { data: proj }] = await Promise.all([
    loadMeterMonths(i.user, inst.id, 'generation'),
    loadMeterMonths(i.user, inst.id, 'consumption'),
    i.svc.schema('projects').from('projects').select('name').eq('id', i.projectId).maybeSingle(),
  ])
  const consumptionMeters = v.meters.filter((m) => m.role === 'consumption')
  const generatedAt = new Date().toISOString()
  const snapshot = buildMonthlySnapshot({
    period: i.month, generatedAt, projectName: String((proj as Row | null)?.name ?? ''), commissioningDate,
    asBuilt: inst.asBuilt, baseline: inst.baseline, guarantee, performance: row,
    sources: sourceRows(v.meters.filter((m) => m.role === 'generation'), genMonths, i.month, row.guaranteeKwh),
    downtime: events.map((e, k) => ({
      startsAt: new Date(e.w0).toISOString(), endsAt: new Date(e.w1).toISOString(), cause: e.d.cause, description: e.d.description,
      excludedFromGuarantee: e.d.excludedFromGuarantee, source: e.d.source, lostKwh: lostKwh(e.steps), lostZar: valuation.perEventZar[k] ?? null,
    })),
    lostZarTotal: valuation.totalZar,
    tariff: { name: valuation.tariffName },
    ytd: yearToDate(v.performance, i.month),
    consumption: {
      gridKwh: consumptionMeters.length > 0 ? (totalsByMonth(consMonths)[i.month]?.kwh ?? null) : null,
      meterLabels: consumptionMeters.map((m) => m.label),
    },
    notes: v.monthly?.notes ?? {},
  })
  const model = monthlyReportModel(snapshot)
  const { branding, warning } = solarBranding(await loadSolarBrandingData(i.svc, i.projectId), { title: model.title, kicker: model.kicker, date: generatedAt.slice(0, 10) })
  const pdf = new Uint8Array(await renderMonthlyReport(model, branding))
  const pdfSha = sha256(pdf)
  const snapSha = sha256(JSON.stringify(snapshot))

  const { data: prior } = await i.svc.schema('solar').from('monthly_reports').select('version, report_id')
    .eq('installation_id', inst.id).eq('period_month', monthFirstDay(i.month)).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as Row).version) + 1 : 1
  const storagePath = `${v.organisationId}/${i.projectId}/solar-monthly/${i.month}-v${version}-${snapSha.slice(0, 12)}.pdf`
  const { error: upErr } = await i.svc.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { ok: false, error: MONTHLY_ERRORS.store }

  // The kind is written as a LITERAL: report-kind-access.contract.test.ts finds writers by scanning for it.
  const { data: rep, error: insErr } = await i.svc.schema('projects').from('reports').insert({
    organisation_id: v.organisationId, project_id: i.projectId, kind: 'solar_monthly',
    source_table: 'solar.installations', source_id: inst.id, title: model.title,
    storage_path: storagePath, mime_type: 'application/pdf', size_bytes: pdf.length,
    status: 'issued', version, summary: model.summary, note: i.note, generated_by: i.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: MONTHLY_ERRORS.save }
  }
  const { error: snapErr } = await i.svc.schema('solar').from('monthly_reports').insert({
    installation_id: inst.id, period_month: monthFirstDay(i.month), version, report_id: reportId,
    snapshot, snapshot_sha256: snapSha, pdf_sha256: pdfSha, generated_by: i.userId,
  })
  if (snapErr) {
    await i.svc.schema('projects').from('reports').delete().eq('id', reportId)
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: snapErr.code === '23505' ? MONTHLY_ERRORS.race : MONTHLY_ERRORS.save }
  }
  const priorReportId = (prior as Row | null)?.report_id as string | undefined
  if (priorReportId) await i.svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', priorReportId)
  return { ok: true, reportId, version, warning }
}
```

- [ ] **Step 3: Failing test** `solar-monthly-report.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(async () => 'edit_financials'),
  gen: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/operations/monthly-report', () => ({ generateMonthlyReport: h.gen }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { generateSolarMonthlyReportAction, saveMonthlyReportNoteAction } from './solar-monthly-report.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1' }).client)
  h.gen.mockResolvedValue({ ok: true, reportId: 'rep1', version: 2, warning: null })
})

describe('generateSolarMonthlyReportAction', () => {
  it('gates Edit + financials FIRST; validates before any work; records audit and event', async () => {
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-3', note: '' })).resolves.toEqual({ error: 'Choose a month.' })
    expect(h.gen).not.toHaveBeenCalled()
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '  Rev B ' })).resolves.toEqual({ ok: true, reportId: 'rep1', version: 2, warning: null })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, month: '2026-03', note: 'Rev B', userId: 'u1' }))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'monthly_report_generated', objectRef: { period: '2026-03', version: 2, reportId: 'rep1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_monthly_report_generated', properties: { period: '2026-03' } })
  })
  it('refuses an overlong note; rate-limits; passes refusals through without side effects', async () => {
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: 'x'.repeat(2001) })).resolves.toEqual({ error: 'The revision note is at most 2000 characters.' })
    h.rateLimit.mockReturnValueOnce(false)
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '' })).resolves.toEqual({ error: 'Too many reports at once — wait a minute and try again.' })
    h.gen.mockResolvedValue({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(generateSolarMonthlyReportAction({ projectId: P, month: '2026-03', note: '' })).resolves.toEqual({ error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('saveMonthlyReportNoteAction', () => {
  it('inserts the first note, then updates on the loaded version; never touches a stored report', async () => {
    const f = fakeSupabase({ userId: 'u1', writes: { 'solar.monthly_report_notes:insert': { data: [{ updated_at: 'N1' }] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveMonthlyReportNoteAction({ projectId: P, installationId: 'i1', month: '2026-03', section: 'summary', body: ' Good ', expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'N1' })
    expect(callsTo(f.calls, 'solar.monthly_report_notes', 'insert')[0]!.payload).toEqual({ installation_id: 'i1', period_month: '2026-03-01', section: 'summary', body: 'Good' })
    expect(callsTo(f.calls, 'solar.monthly_reports', 'update')).toHaveLength(0)
    await expect(saveMonthlyReportNoteAction({ projectId: P, installationId: 'i1', month: '2026-03', section: 'nope' as never, body: '', expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Unknown commentary section.' })
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** `solar-monthly-report.actions.ts`:

```ts
'use server'
/**
 * Monthly client report (spec §10). Generate = Edit + financials ("write ∩ cost-view"); commentary
 * = Edit + financials (it sits in the money report). The gate runs FIRST.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMonthKey, monthFirstDay, NOTE_SECTIONS, type NoteSection } from '@esite/shared/solar-operations'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { rateLimit } from '@/lib/rate-limit'
import { generateMonthlyReport } from '@/lib/solar/operations/monthly-report'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export async function generateSolarMonthlyReportAction(input: { projectId: string; month: string; note: string | null }):
  Promise<{ ok: true; reportId: string; version: number; warning: string | null } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > 2000)) return { error: 'The revision note is at most 2000 characters.' }
  if (!rateLimit(`solar-monthly:${user.id}`, 6, 60_000)) return { error: 'Too many reports at once — wait a minute and try again.' }
  const r = await generateMonthlyReport({
    projectId: input.projectId, month: input.month, note: input.note?.trim() || null, userId: user.id,
    user: supabase, svc: createServiceClient() as unknown as AnyClient,
  })
  if (!r.ok) return { error: r.error }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'monthly_report_generated', objectRef: { period: input.month, version: r.version, reportId: r.reportId } })
  await emitProductEvent({ actorId: user.id, projectId: input.projectId, event: 'solar_monthly_report_generated', properties: { period: input.month } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, reportId: r.reportId, version: r.version, warning: r.warning }
}

export async function saveMonthlyReportNoteAction(input: {
  projectId: string; installationId: string; month: string; section: NoteSection; body: string; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | { error: string }> {
  if (!(NOTE_SECTIONS as readonly string[]).includes(input.section)) return { error: 'Unknown commentary section.' }
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (body.length > 5000) return { error: 'At most 5000 characters.' }
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const t = () => supabase.schema('solar').from('monthly_report_notes')
  const period = monthFirstDay(input.month)
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ installation_id: input.installationId, period_month: period, section: input.section, body }).select('updated_at')
    : await t().update({ body }).eq('installation_id', input.installationId).eq('period_month', period).eq('section', input.section)
        .eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
```

- [ ] **Step 5: The report-kind scanner now guards the new writer.** In `report-kind-access.contract.test.ts`, add `'solar_monthly'` to the expected list in "finds the known report writers" (after `'solar_proposal'`).

- [ ] **Step 6: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/operations src/actions/solar-monthly-report src/lib/reports/report-kind-access 2>&1 | tail -6
git add apps/web/src/lib/solar/operations/monthly-report.ts apps/web/src/lib/solar/operations/monthly-report.test.ts \
  apps/web/src/actions/solar-monthly-report.actions.ts apps/web/src/actions/solar-monthly-report.actions.test.ts \
  apps/web/src/lib/reports/report-kind-access.contract.test.ts
git commit -m "feat(solar): generate immutable monthly report versions; commentary kept separate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
