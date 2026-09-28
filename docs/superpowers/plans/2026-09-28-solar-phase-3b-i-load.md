# Solar Phase 3b-i — Load tab (Meters · Tenants · Site profile · Checks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/projects/[id]/solar/load` exactly as functional spec §4: the load-basis select, the Meters sub-tab (direct-to-Storage upload, Dropbox folder import, copy from the org meter library, import meter register, the per-file import review dialog with identity panel and validation summary, meters table and detail drawer with chart / heatmap / edit mapping / remove / normalised CSV), the Tenants sub-tab (sources, weighted meter assignment, density and archetype, BO date, auto-match with review, exclude vacant, common-area %), the Site profile sub-tab (settings, rebuild with progress, KPI strip, five charts, reconciliation card) and the Checks sub-tab (acknowledgements).

**Architecture:** Server-only data layer in `apps/web/src/lib/solar/load/` gathers study rows and readings (through the two INVOKER RPCs of 00214, so RLS decides), calls the pure `buildSiteLoad` from plan 3b-0, and stores `solar.site_load`. Charts receive server-derived aggregates only (`siteProfileCharts`, `minMaxBuckets`); CSV downloads are full resolution from server routes. The UI reuses the 3a routes (`meter-files`, `parse`, `commit`) unchanged in behaviour. Charts are small in-house SVG/canvas components (no chart library exists in the repo — see decision 1).

**Tech Stack:** Next.js 15 App Router (server components, server actions, route handlers with NDJSON streaming), supabase-js, `@esite/shared` (`/solar-load`, `/meter-data`), React 19 + Testing Library + Vitest (jsdom).

**Prerequisite:** plan `2026-09-28-solar-phase-3b-0-foundation.md` complete on `feat/solar-phase-3b` (same worktree).

---

## Ground rules

- Worktree `~/.config/superpowers/worktrees/esite/solar-phase-3b`, branch `feat/solar-phase-3b`. Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every page, action and route gates itself.** Pages: `requireSolarLevel(projectId, 'view')`; actions: `requireSolarLevel(projectId, 'edit')`; routes (`app/api/*` is outside `(admin)/layout.tsx`): `requireSolarLevelAPI(supabase, projectId, 'view' | 'edit')`. Everything is written with the CALLER's client (RLS applies) — the service key is used only by `recordSolarAudit` / `emitProductEvent`, as in 1c.
- **Never compute load in the browser.** Client components receive aggregates and call routes/actions. Client code may import from `@esite/shared` (root) and `normShop` from `@esite/shared/solar-load`; it must never import `@esite/shared/meter-data` at runtime (exceljs) — `import type` only.
- **Spec §0.4 rules on every control:** two-step inline confirm for destructive actions (`useArmedConfirm`), `expectedUpdatedAt` on every save (`STALE_MESSAGE`), units on every number, spinner + disabled while async, human sentences only, an empty state with its one action, controls above the user's level **hidden** (not disabled).
- View level sees kW/kWh only — nothing on the Load tab carries a rand value.
- Before `pnpm --filter web test`, load the `dataviz` skill once before Task 10 (charts) and keep its colour/axis rules; the palette below already follows them.

## Design decisions made in this plan (owner should see them)

1. **Charts: in-house SVG + canvas, no new library.** Nothing in the monorepo draws charts today (`grep recharts|visx|chart.js` → none). The five chart types needed are a line (with a min/max band), grouped bars, and a heatmap; the data arrives pre-aggregated (≤ 1,200 buckets, 365 days, 12×24). ~400 lines of SVG give PNG export via `XMLSerializer`→canvas without CSS-variable loss, hover, legend toggles and drag-to-zoom, with no bundle cost. **Open question:** adopt Recharts instead (≈ 100 kB gz) if the owner wants richer interaction later.
2. **One basis select, at the top of the tab** (§4.2). The Site profile sub-tab shows the rest of the settings; it does not repeat the basis control (one control, one job). Changing the basis saves and immediately rebuilds.
3. **Rebuild is a streaming route** (`POST …/site-load/rebuild`, NDJSON progress lines, `maxDuration` 300) so "Server job; shows progress" is literal: *Reading meter data 3/7 → Building → Saving*.
4. **Stale detection** compares the stored `inputs_hash` with a hash recomputed from rows + per-channel summaries (no readings read). Load growth is not in the hash (it affects only the cashflow).
5. **Tenant summaries (annual kWh, W/m², peak) come from the last build** (`site_load.coverage.tenants`); before the first build the columns show "—".
6. **Meters table figures come from `solar.channel_summaries`** (period, completeness, true interval peak, annual kWh scaled to 365 days) — readable by external View members through the linked-meter arm, unlike import reports.
7. **Remove from study** also removes the meter from tenant assignments (a tenant left with no meters becomes *Synthesised*) and from this study's schematics. "Also delete from library" is offered only to grantors (owners/admins, the only readers of every study link) and only when no other study links the meter.
8. **Dropbox import** browses from the project's mapped folder (sub-folders navigable), filters to `.csv .txt .xlsx .xls` ≤ 50 MB, and copies the bytes server-side into `solar-meter-raw` with the caller's client (bucket policy applies), then the same register → parse → review pipeline.
9. **TOU split** on the KPI strip shows "Pin a tariff on the Tariff tab to see the TOU split" until a pinned tariff exists on `solar.studies` (none does yet; the Tariff tab is a later phase).

## File structure

| File | Responsibility |
|---|---|
| `apps/web/src/test/fake-supabase.ts` | + `is`, passthrough `or/ilike/overlaps/not/range`, `upsert`, `schema(s).rpc` |
| `apps/web/src/lib/solar/load/view-types.ts` | Client-safe view models, `RebuildEvent`, unit list |
| `apps/web/src/lib/solar/load/readings.ts` (+ test) | `readChannelReadings`, `channelSummaries` (00214 RPCs) |
| `apps/web/src/lib/solar/load/gather.ts` (+ test) | Rows + readings → `BuildSiteLoadInput`, inputs hash, channel picking |
| `apps/web/src/lib/solar/load/messages.ts` | Error code → sentence |
| `apps/web/src/lib/solar/load/site-load-service.ts` (+ test) | Rebuild: gather → build → store; audit + product event |
| `apps/web/src/lib/solar/load/meter-access.ts` | `loadStudyMeter` (the meter must be linked to this project's study) |
| `apps/web/src/lib/solar/load/views.ts` (+ test) | Loaders for the four sub-tabs and the readiness aggregate |
| `apps/web/src/lib/solar/load/ndjson.ts` (+ test) | NDJSON chunk parser (client) |
| `apps/web/src/lib/solar/load/use-rebuild.ts` | Client hook driving the rebuild route |
| `apps/web/src/lib/solar/load/import-client.ts` (+ test) | Browser: sha256, upload, register, parse, commit calls |
| `apps/web/src/lib/solar/meter-import/register.ts` (+ test) | Register logic lifted out of the 3a route (reused by Dropbox import) |
| `apps/web/src/services/cloud-storage-folder.server.ts` | + `downloadCloudFile` |
| `apps/web/src/app/api/projects/[id]/solar/site-load/rebuild/route.ts` (+ test) | NDJSON rebuild |
| `apps/web/src/app/api/projects/[id]/solar/site-load/csv/route.ts` (+ test) | Per-chart CSV |
| `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/series/route.ts` (+ test) | Downsampled chart data + gaps |
| `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/heatmap/route.ts` (+ test) | Day × hour |
| `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/csv/route.ts` (+ test) | Normalised CSV |
| `apps/web/src/app/api/projects/[id]/solar/cloud-files/route.ts` and `…/cloud-files/import/route.ts` (+ tests) | Dropbox list / import |
| `apps/web/src/actions/solar-load.actions.ts` (+ test) | Study, settings, basis, meters, library, tenants, auto-match, vacant, acks, register confirm |
| `apps/web/src/components/charts/*` (+ tests) | `scale.ts`, `palette.ts`, `export.ts`, `LineChart`, `BarChart`, `HeatmapCanvas`, `ChartCard` |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/page.tsx` | The tab |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/*` (+ tests) | Sub-tab UI |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx` | Load readiness wired |
| `docs/rbac-matrix.md` | Load rows |

---

### Task 1: Extend the Supabase test fake

**Files:**
- Modify: `apps/web/src/test/fake-supabase.ts`
- Test: `apps/web/src/test/fake-supabase.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase, callsTo } from './fake-supabase'

describe('fakeSupabase extensions', () => {
  it('filters with is(col, null) and passes or/ilike/overlaps/not/range through', async () => {
    const { client } = fakeSupabase({ tables: { 'structure.nodes': [{ id: 'a', deleted_at: null }, { id: 'b', deleted_at: '2025-01-01' }, { id: 'c' }] } })
    const r = await client.schema('structure').from('nodes').select('id').is('deleted_at', null).or('x').ilike('a', 'b').overlaps('s', []).not('x', 'is', null).range(0, 9)
    expect((r.data as Array<{ id: string }>).map((x) => x.id)).toEqual(['a', 'c'])
  })
  it('records upsert like insert and echoes the payload', async () => {
    const { client, calls } = fakeSupabase({})
    const r = await client.schema('solar').from('site_load').upsert({ a: 1 }, { onConflict: 'x' }).select('id').single()
    expect(r.data).toEqual({ a: 1 })
    expect(callsTo(calls, 'solar.site_load', 'upsert')).toHaveLength(1)
  })
  it('routes schema(s).rpc(name) to rpc["s.name"]', async () => {
    const { client } = fakeSupabase({ rpc: { 'solar.channel_summaries': { data: [{ channel: 'c1' }], error: null } } })
    const r = await client.schema('solar').rpc('channel_summaries', { p_channel_ids: ['c1'] })
    expect(r.data).toEqual([{ channel: 'c1' }])
  })
})
```

Run: `pnpm --filter web test -- src/test/fake-supabase` → Expected: FAIL (`is is not a function`).

- [ ] **Step 2: Implement**

In `fake-supabase.ts`:

1. Change the `Filter` type and `FakeCall['op']`:

```ts
type Filter = ['eq' | 'neq' | 'in' | 'gte' | 'is', string, unknown]

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  payload?: unknown
  filters: Filter[]
}
```

2. Replace `matches`:

```ts
  const matches = (row: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) =>
      op === 'eq' ? row[col] === val
        : op === 'neq' ? row[col] !== val
          : op === 'gte' ? String(row[col] ?? '') >= String(val)
            : op === 'is' ? (row[col] ?? null) === val
              : (val as unknown[]).includes(row[col]))
```

3. In `builder`, add after `gte`:

```ts
      is: (c: string, v: unknown) => { state.filters.push(['is', c, v]); return b },
      upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; return b },
      or: () => b,
      ilike: () => b,
      overlaps: () => b,
      not: () => b,
      range: () => b,
```

4. Replace the `client` construction so `schema()` also exposes `rpc`:

```ts
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const r = opts.rpc?.[name]
    if (!r) return { data: null, error: null }
    return typeof r === 'function' ? r(args) : r
  })
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc,
    schema: (s: string) => ({ from: (t: string) => builder(`${s}.${t}`), rpc: (name: string, args: Record<string, unknown>) => rpc(`${s}.${name}`, args) }),
    from: (t: string) => builder(`public.${t}`),
  }
```

- [ ] **Step 3: Run the new test and the whole web suite** (existing users of the fake must stay green)

```bash
pnpm --filter web test -- src/test/fake-supabase 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
```

Expected: PASS; web suite count = baseline + 3.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/test/fake-supabase.ts apps/web/src/test/fake-supabase.test.ts
git commit -m "test(solar): fake-supabase gains is/upsert/passthroughs and schema-scoped rpc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client-safe view types and bulk reads

**Files:**
- Create: `apps/web/src/lib/solar/load/view-types.ts`
- Create: `apps/web/src/lib/solar/load/readings.ts`
- Test: `apps/web/src/lib/solar/load/readings.test.ts`
- Test: `apps/web/src/lib/solar/load/view-types.contract.test.ts`

- [ ] **Step 1: Write the view types (no runtime imports besides `@esite/shared` types)**

```ts
// apps/web/src/lib/solar/load/view-types.ts
/**
 * View models the Load tab's server loaders hand to client components. JSON only (a function prop
 * across the server → client boundary fails at render, CLAUDE.md 2026-09-22). Type-only imports.
 */
import type { BillsForm, LoadSettingsForm } from '@esite/shared'
import type { BulkReconciliation, MdMonth, ParentReconciliation, SiteLoadCoverage, SiteProfileCharts } from '@esite/shared/solar-load'

export type MeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export const METER_KIND_OPTIONS: ReadonlyArray<{ value: MeterKind; label: string }> = [
  { value: 'tenant', label: 'Tenant' }, { value: 'bulk', label: 'Bulk' }, { value: 'council', label: 'Council' },
  { value: 'generator', label: 'Generator' }, { value: 'solar', label: 'Solar' }, { value: 'common', label: 'Common area' },
  { value: 'vacant', label: 'Vacant' }, { value: 'check', label: 'Check' }, { value: 'virtual', label: 'Virtual (multi-serial)' },
  { value: 'water', label: 'Water' }, { value: 'unknown', label: 'Unknown' },
]
/** Units the commit route accepts (== COMMITTABLE_UNITS in meter-import/commit.ts; contract-tested). */
export const UNIT_OPTIONS = ['kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'PF'] as const
export const ARCHETYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'retail', label: 'Retail' }, { value: 'fast_food', label: 'Fast food' }, { value: 'restaurant', label: 'Restaurant' },
  { value: 'supermarket', label: 'Supermarket (refrigeration)' }, { value: 'office_bank', label: 'Bank / office' },
  { value: 'gym', label: 'Gym' }, { value: 'anchor_24h', label: 'Anchor (24 h)' }, { value: 'vacant', label: 'Vacant' },
]

export interface NodeOption { id: string; label: string; shopNumber: string | null }

export interface MeterView {
  id: string
  label: string
  kind: MeterKind
  siteLabel: string | null
  serials: string[]
  nodeId: string | null
  tenantLabel: string | null
  shopNo: string | null
  areaM2: number | null
  supplyPointConfirmed: boolean
  updatedAt: string
  primaryChannelId: string | null
  intervalMin: number | null
  periodStart: string | null
  periodEnd: string | null
  completeness: number | null
  peakKw: number | null
  annualKwh: number | null
  fileIds: string[]
  otherStudyLinks: number
  status: 'imported' | 'no_data'
}
export interface RegisterRowView {
  id: string
  siteLabel: string | null
  fileName: string | null
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: string
  confirmed: boolean
  fileImported: boolean
}
export interface MetersView {
  studyId: string | null
  orgId: string
  meters: MeterView[]
  nodes: NodeOption[]
  register: RegisterRowView[]
  cloudMapped: boolean
  isGrantor: boolean
  bulkRecon: BulkReconciliation[]
}

export interface TenantBasisView {
  id: string
  source: 'metered' | 'synthesised' | 'excluded'
  meters: Array<{ meterId: string; weight: number }>
  archetype: string | null
  densityOverride: number | null
  updatedAt: string
}
export interface TenantRowView {
  nodeId: string
  shopNumber: string | null
  name: string
  category: string | null
  areaM2: number | null
  boDate: string | null
  basis: TenantBasisView | null
  summary: { source: string; annualKwh: number; peakKw: number; wPerM2: number | null } | null
  vacant: boolean
  defaultDensity: number
  defaultArchetype: string
}
export interface AutoMatchView {
  nodeId: string
  nodeLabel: string
  meterId: string
  meterLabel: string
  source: string
  confidence: 'high' | 'medium' | 'low'
  preTicked: boolean
  note: string
}
export interface TenantsView {
  studyId: string | null
  studyUpdatedAt: string | null
  commonAreaPct: number
  tenants: TenantRowView[]
  studyMeters: Array<{ id: string; label: string; kind: MeterKind }>
  proposals: AutoMatchView[]
}

export interface SiteLoadView {
  basis: 'S1' | 'S2' | 'S3' | 'S4'
  referenceYear: number
  builtAt: string
  stale: boolean
  charts: SiteProfileCharts
  coverage: SiteLoadCoverage
  md: MdMonth[]
  designMdKw: number | null
  bulkRecon: BulkReconciliation[]
  parentRecon: ParentReconciliation[]
}
export interface ProfileView {
  studyId: string | null
  studyUpdatedAt: string | null
  form: LoadSettingsForm
  bills: BillsForm
  diversityApplies: boolean
  years: number[]
  siteLoad: SiteLoadView | null
}

export interface CheckView {
  key: string
  severity: 'error' | 'warning' | 'info'
  message: string
  meterId?: string
  nodeId?: string
  ack: { at: string; note: string | null } | null
}
export interface ImportReportView {
  fileId: string
  fileName: string
  format: string | null
  acceptedAt: string | null
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
}
export interface ChecksView { studyId: string | null; builtAt: string | null; checks: CheckView[]; imports: ImportReportView[] }

export type RebuildEvent =
  | { type: 'progress'; stage: 'reading' | 'building' | 'saving'; done: number; total: number }
  | { type: 'done'; siteLoadId: string; basis: string; referenceYear: number; checks: number }
  | { type: 'error'; code: string; message: string }
```

- [ ] **Step 2: Contract test — the client unit list equals the commit route's**

```ts
// apps/web/src/lib/solar/load/view-types.contract.test.ts
import { describe, it, expect } from 'vitest'
import { COMMITTABLE_UNITS } from '@/lib/solar/meter-import/commit'
import { UNIT_OPTIONS } from './view-types'

describe('UNIT_OPTIONS', () => {
  it('is exactly the set the commit route accepts', () => {
    expect([...UNIT_OPTIONS].sort()).toEqual([...COMMITTABLE_UNITS].sort())
  })
})
```

- [ ] **Step 3: Write the failing readings test**

```ts
// apps/web/src/lib/solar/load/readings.test.ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { channelSummaries, readChannelReadings } from './readings'

describe('readChannelReadings', () => {
  it('batches channels (10 per call), converts arrays to readings, and returns [] for silent channels', async () => {
    const seen: string[][] = []
    const { client } = fakeSupabase({
      rpc: {
        'solar.channel_readings': (a) => {
          const ids = a.p_channel_ids as string[]
          seen.push(ids)
          return { data: ids.includes('c1') ? [{ channel: 'c1', ts_ends: ['2025-03-10T00:30:00+00:00'], vals: [1.5], quals: [0] }] : [], error: null }
        },
      },
    })
    const ids = Array.from({ length: 12 }, (_, i) => `c${i + 1}`)
    const progress: Array<[number, number]> = []
    const out = await readChannelReadings(client as never, ids, 0, 1000, (d, t) => progress.push([d, t]))
    expect(seen.map((s) => s.length)).toEqual([10, 2])
    expect(out.get('c1')).toEqual([{ tsEnd: Date.parse('2025-03-10T00:30:00Z'), value: 1.5, quality: 0 }])
    expect(out.get('c12')).toEqual([])
    expect(progress).toEqual([[10, 12], [12, 12]])
  })
  it('throws a plain error when the RPC fails', async () => {
    const { client } = fakeSupabase({ rpc: { 'solar.channel_readings': { data: null, error: { message: 'boom' } } } })
    await expect(readChannelReadings(client as never, ['c1'], 0, 1)).rejects.toThrow('channel readings: boom')
  })
})

describe('channelSummaries', () => {
  it('maps rows and skips the call for no channels', async () => {
    const { client } = fakeSupabase({
      rpc: { 'solar.channel_summaries': { data: [{ channel: 'c1', first_ts: '2025-01-01T00:30:00Z', last_ts: '2025-12-31T22:00:00Z', n_rows: 17520, n_usable: 17500, max_value: 42.5, sum_value: 100000 }], error: null } },
    })
    const m = await channelSummaries(client as never, ['c1'])
    expect(m.get('c1')).toEqual({ channelId: 'c1', firstTs: Date.parse('2025-01-01T00:30:00Z'), lastTs: Date.parse('2025-12-31T22:00:00Z'), nRows: 17520, nUsable: 17500, maxValue: 42.5, sumValue: 100000 })
    expect((await channelSummaries(client as never, [])).size).toBe(0)
  })
})
```

Run: `pnpm --filter web test -- lib/solar/load/readings view-types.contract` → FAIL (module missing).

- [ ] **Step 4: Implement `readings.ts`**

```ts
// apps/web/src/lib/solar/load/readings.ts
import 'server-only'
/**
 * Bulk reads through 00214's SECURITY INVOKER RPCs: one row per channel with parallel arrays, so a
 * year of readings does not hit PostgREST's 1,000-row cap. meter_readings_select (RLS) decides what
 * comes back; a channel the caller may not read simply returns nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reading } from '@esite/shared/meter-data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export const READ_BATCH = 10

export interface ChannelSummary {
  channelId: string
  firstTs: number | null
  lastTs: number | null
  nRows: number
  nUsable: number
  maxValue: number | null
  sumValue: number | null
}

export async function readChannelReadings(
  supabase: AnyClient, channelIds: string[], fromMs: number, toMs: number,
  onBatch?: (done: number, total: number) => void,
): Promise<Map<string, Reading[]>> {
  const out = new Map<string, Reading[]>()
  for (let i = 0; i < channelIds.length; i += READ_BATCH) {
    const batch = channelIds.slice(i, i + READ_BATCH)
    const { data, error } = await supabase.schema('solar').rpc('channel_readings', {
      p_channel_ids: batch, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString(),
    })
    if (error) throw new Error(`channel readings: ${error.message}`)
    for (const row of (data ?? []) as Array<{ channel: string; ts_ends: string[]; vals: Array<number | null>; quals: number[] }>) {
      out.set(row.channel, row.ts_ends.map((t, k) => ({ tsEnd: Date.parse(t), value: row.vals[k], quality: row.quals[k] as Reading['quality'] })))
    }
    onBatch?.(Math.min(i + READ_BATCH, channelIds.length), channelIds.length)
  }
  for (const id of channelIds) if (!out.has(id)) out.set(id, [])
  return out
}

export async function channelSummaries(supabase: AnyClient, channelIds: string[]): Promise<Map<string, ChannelSummary>> {
  const out = new Map<string, ChannelSummary>()
  if (channelIds.length === 0) return out
  const { data, error } = await supabase.schema('solar').rpc('channel_summaries', { p_channel_ids: channelIds })
  if (error) throw new Error(`channel summaries: ${error.message}`)
  for (const r of (data ?? []) as Array<{ channel: string; first_ts: string | null; last_ts: string | null; n_rows: number; n_usable: number; max_value: number | null; sum_value: number | null }>) {
    out.set(r.channel, {
      channelId: r.channel,
      firstTs: r.first_ts ? Date.parse(r.first_ts) : null,
      lastTs: r.last_ts ? Date.parse(r.last_ts) : null,
      nRows: Number(r.n_rows),
      nUsable: Number(r.n_usable),
      maxValue: r.max_value === null ? null : Number(r.max_value),
      sumValue: r.sum_value === null ? null : Number(r.sum_value),
    })
  }
  return out
}
```

- [ ] **Step 5: Run to pass and commit**

```bash
pnpm --filter web test -- lib/solar/load/readings view-types.contract 2>&1 | tail -4
git add apps/web/src/lib/solar/load/view-types.ts apps/web/src/lib/solar/load/view-types.contract.test.ts apps/web/src/lib/solar/load/readings.ts apps/web/src/lib/solar/load/readings.test.ts
git commit -m "feat(solar): load view types and bulk channel reads through the 00214 RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (4 tests).

---

### Task 3: Gather the build inputs and the inputs hash

**Files:**
- Create: `apps/web/src/lib/solar/load/gather.ts`
- Test: `apps/web/src/lib/solar/load/gather.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import { gatherLoadInputs, mergeChannelData, pickChannels, type ChannelRow } from './gather'

const P = 'p1'
const ch = (id: string, over: Partial<ChannelRow> = {}): ChannelRow => ({
  id, meter_id: 'm1', file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW',
  interval_min: 30, is_primary: true, coverage_only: false, updated_at: '2025-01-01T00:00:00Z', ...over,
})
function tables(over: Record<string, Array<Record<string, unknown>>> = {}): FakeOptions {
  return {
    tables: {
      'solar.studies': [{ id: 's1', project_id: P, load_basis: 'S2', reference_year: null, common_area_pct: '10.00', diversity_factor: '1.000', load_growth_pct: '0', monthly_bills: null, schematic_waived: false, updated_at: 'T0' }],
      'projects.projects': [{ id: P, opening_date: '2026-06-01' }],
      'structure.nodes': [
        { id: 'n1', project_id: P, kind: 'tenant_db', code: 'T1', name: null, shop_number: '12', shop_name: 'Pep', shop_area_m2: '120', shop_category: 'standard', status: 'active' },
        { id: 'n2', project_id: P, kind: 'tenant_db', code: 'T2', name: 'Old', shop_number: '13', shop_name: null, shop_area_m2: null, shop_category: null, status: 'decommissioned' },
      ],
      'structure.tenant_details': [{ node_id: 'n1', bo_period_days: 30, bo_date_override: null }],
      'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }], archetype: null, density_override_w_m2: null, updated_at: 'T1' }],
      'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }],
      'solar.meters': [{ id: 'm1', label: 'Pep meter', kind: 'tenant', site_label: 'YA', serials: ['S1'], supply_point_confirmed: false, existing_pv_channel_id: null, node_id: 'n1', shop_no: '12', area_m2: null, area_source: null, updated_at: 'T2' }],
      'solar.meter_channels': [ch('c1')],
      'solar.schematic_lines': [],
      ...over,
    },
    rpc: {
      'solar.channel_summaries': { data: [{ channel: 'c1', first_ts: '2025-01-01T00:30:00Z', last_ts: '2025-12-31T22:00:00Z', n_rows: 3, n_usable: 3, max_value: 5, sum_value: 9 }], error: null },
      'solar.channel_readings': { data: [{ channel: 'c1', ts_ends: ['2025-03-10T00:30:00Z'], vals: [2], quals: [0] }], error: null },
    },
  }
}

describe('pickChannels / mergeChannelData', () => {
  it('takes every primary kW channel at the newest interval, kVA at that interval, and the PV channel', () => {
    const chans = [
      ch('old', { updated_at: '2024-01-01T00:00:00Z' }), ch('new', { updated_at: '2025-06-01T00:00:00Z' }),
      ch('daily', { interval_min: 1440 }), ch('kva', { is_primary: false, quantity: 'apparent_power', unit: 'kVA' }),
      ch('pv', { meter_id: 'm9', is_primary: false }),
    ]
    const p = pickChannels({ id: 'm1', existing_pv_channel_id: 'pv' }, chans)
    expect(p.primary.map((c) => c.id)).toEqual(['new', 'old'])
    expect(p.kva.map((c) => c.id)).toEqual(['kva'])
    expect(p.pv?.id).toBe('pv')
  })
  it('merges files with the newer one winning a shared timestamp', () => {
    const m = mergeChannelData([ch('new'), ch('old')], new Map([
      ['old', [{ tsEnd: 1, value: 1, quality: 0 as const }, { tsEnd: 2, value: 1, quality: 0 as const }]],
      ['new', [{ tsEnd: 2, value: 9, quality: 0 as const }]],
    ]))
    expect(m).toEqual({ intervalMin: 30, readings: [{ tsEnd: 1, value: 1, quality: 0 }, { tsEnd: 2, value: 9, quality: 0 }] })
  })
})

describe('gatherLoadInputs', () => {
  it('builds tenants (active only, BO date computed), meters and settings', async () => {
    const { client } = fakeSupabase(tables())
    const g = await gatherLoadInputs(client as never, P, { readReadings: true, now: new Date('2026-09-28T00:00:00Z') })
    if (!g.ok) throw new Error('expected ok')
    expect(g.input.tenants).toEqual([{
      nodeId: 'n1', label: '12 · Pep', areaM2: 120, category: 'standard', source: 'metered', meters: [{ meterId: 'm1', weight: 1 }],
      archetype: null, densityOverrideWPerM2: null, boDate: '2026-05-02',
    }])
    expect(g.input).toMatchObject({ basis: 'S2', referenceYear: null, fallbackYear: 2025, commonAreaPct: 10, diversityFactor: 1 })
    expect(g.input.meters[0].primary?.readings).toHaveLength(1)
    expect(g.inputsHash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('does not read readings when asked not to, and the hash does not depend on them', async () => {
    const a = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: false })
    const b = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: true })
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.input.meters[0].primary?.readings).toEqual([])
    expect(a.inputsHash).toBe(b.inputsHash)
  })
  it('the hash changes when a weight changes', async () => {
    const a = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: false })
    const b = await gatherLoadInputs(fakeSupabase(tables({
      'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 0.5 }], archetype: null, density_override_w_m2: null, updated_at: 'T1' }],
    })).client as never, P, { readReadings: false })
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.inputsHash).not.toBe(b.inputsHash)
  })
  it('reports no_study', async () => {
    const g = await gatherLoadInputs(fakeSupabase(tables({ 'solar.studies': [] })).client as never, P, { readReadings: false })
    expect(g).toEqual({ ok: false, error: 'no_study' })
  })
})
```

Run: `pnpm --filter web test -- lib/solar/load/gather` → FAIL.

- [ ] **Step 2: Implement `gather.ts`**

```ts
// apps/web/src/lib/solar/load/gather.ts
import 'server-only'
/**
 * Everything buildSiteLoad needs for one study, read with the CALLER's client (RLS decides), plus a
 * sha256 of the inputs so the Site profile can say "stale" without reading any readings. Load growth
 * is deliberately NOT in the hash: it changes only the cashflow, never the site series.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBoDate } from '@esite/shared'
import { sha256Hex, type Reading } from '@esite/shared/meter-data'
import {
  SITE_LOAD_ENGINE_VERSION, type ArchetypeCode, type BuildMeter, type BuildMeterKind, type BuildSiteLoadInput,
  type BuildTenant, type ChannelData, type LoadBasis, type MonthlyBills, type TenantSource,
} from '@esite/shared/solar-load'
import { channelSummaries, readChannelReadings, type ChannelSummary } from './readings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const DAY_MS = 86_400_000
/** Readings older than this before the newest reading are not read (3 years is ample for a 12-month window). */
export const READ_WINDOW_DAYS = 1100

export const STUDY_LOAD_COLUMNS = 'id, load_basis, reference_year, common_area_pct, diversity_factor, load_growth_pct, monthly_bills, schematic_waived, updated_at'
export const METER_COLUMNS = 'id, label, kind, site_label, serials, supply_point_confirmed, existing_pv_channel_id, node_id, shop_no, area_m2, area_source, updated_at'
export const CHANNEL_COLUMNS = 'id, meter_id, file_id, source_column, quantity, direction, unit, interval_min, is_primary, coverage_only, updated_at'
export const NODE_COLUMNS = 'id, code, name, shop_number, shop_name, shop_area_m2, shop_category, status'

export interface StudyLoadRow {
  id: string
  load_basis: LoadBasis | null
  reference_year: number | null
  common_area_pct: number | string
  diversity_factor: number | string
  load_growth_pct: number | string
  monthly_bills: MonthlyBills | null
  schematic_waived: boolean
  updated_at: string
}
export interface ChannelRow {
  id: string
  meter_id: string
  file_id: string | null
  source_column: string
  quantity: string
  direction: string
  unit: string
  interval_min: number
  is_primary: boolean
  coverage_only: boolean
  updated_at: string
}
export interface MeterRow {
  id: string
  label: string
  kind: BuildMeterKind
  site_label: string | null
  serials: string[] | null
  supply_point_confirmed: boolean
  existing_pv_channel_id: string | null
  node_id: string | null
  shop_no: string | null
  area_m2: number | string | null
  area_source: string | null
  updated_at: string
}
export interface TenantNodeRow {
  id: string
  code: string | null
  name: string | null
  shop_number: string | null
  shop_name: string | null
  shop_area_m2: number | string | null
  shop_category: BuildTenant['category']
  status: string
}
export interface BasisRow {
  id: string
  node_id: string
  source: 'metered' | 'synthesised' | 'excluded'
  meters: Array<{ meter_id: string; weight: number }>
  archetype: ArchetypeCode | null
  density_override_w_m2: number | string | null
  updated_at: string
}
export interface MeterChannels { primary: ChannelRow[]; kva: ChannelRow[]; pv: ChannelRow | null }

export function tenantLabel(n: Pick<TenantNodeRow, 'shop_number' | 'shop_name' | 'name' | 'code'>): string {
  const name = n.shop_name ?? n.name ?? n.code ?? 'Tenant'
  return n.shop_number ? `${n.shop_number} · ${name}` : name
}

const newestFirst = (a: ChannelRow, b: ChannelRow) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)

/** A meter's primary kW channels (one per file; the newest's interval wins), kVA at that interval, and its PV channel. */
export function pickChannels(meter: Pick<MeterRow, 'id' | 'existing_pv_channel_id'>, channels: ChannelRow[]): MeterChannels {
  const own = channels.filter((c) => c.meter_id === meter.id && !c.coverage_only)
  const primaries = own.filter((c) => c.is_primary && c.unit === 'kW' && c.quantity === 'active_power').sort(newestFirst)
  const candidates = primaries.length > 0
    ? primaries
    : own.filter((c) => c.unit === 'kW' && c.quantity === 'active_power' && c.direction !== 'export').sort(newestFirst).slice(0, 1)
  const interval = candidates[0]?.interval_min
  return {
    primary: candidates.filter((c) => c.interval_min === interval),
    kva: own.filter((c) => c.quantity === 'apparent_power' && c.unit === 'kVA' && c.interval_min === interval).sort(newestFirst),
    pv: meter.existing_pv_channel_id ? channels.find((c) => c.id === meter.existing_pv_channel_id) ?? null : null,
  }
}

/** Several files' channels of one meter as one reading list; a newer file wins a shared timestamp. */
export function mergeChannelData(list: ChannelRow[], readings: Map<string, Reading[]>): ChannelData | null {
  if (list.length === 0) return null
  const byTs = new Map<number, Reading>()
  for (const c of [...list].reverse()) for (const r of readings.get(c.id) ?? []) byTs.set(r.tsEnd, r)
  return { intervalMin: list[0].interval_min, readings: [...byTs.values()].sort((a, b) => a.tsEnd - b.tsEnd) }
}

export type GatherResult =
  | {
      ok: true
      study: StudyLoadRow
      input: BuildSiteLoadInput
      inputsHash: string
      nodes: TenantNodeRow[]
      basisRows: BasisRow[]
      meters: MeterRow[]
      channels: ChannelRow[]
      picked: Map<string, MeterChannels>
      summaries: Map<string, ChannelSummary>
    }
  | { ok: false; error: 'no_study' }

export async function gatherLoadInputs(
  supabase: AnyClient, projectId: string,
  opts: { readReadings: boolean; onProgress?: (done: number, total: number) => void; now?: Date },
): Promise<GatherResult> {
  const solar = () => supabase.schema('solar')
  const { data: studyRow } = await solar().from('studies').select(STUDY_LOAD_COLUMNS).eq('project_id', projectId).maybeSingle()
  if (!studyRow) return { ok: false, error: 'no_study' }
  const study = studyRow as StudyLoadRow

  const [projectRes, nodesRes, basisRes, linksRes, linesRes] = await Promise.all([
    supabase.schema('projects').from('projects').select('opening_date').eq('id', projectId).maybeSingle(),
    supabase.schema('structure').from('nodes').select(NODE_COLUMNS).eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null),
    solar().from('tenant_load_basis').select('id, node_id, source, meters, archetype, density_override_w_m2, updated_at').eq('study_id', study.id),
    solar().from('study_meters').select('meter_id').eq('study_id', study.id),
    solar().from('schematic_lines').select('from_meter_id, to_meter_id, line_type').eq('project_id', projectId),
  ])
  const nodes = ((nodesRes.data ?? []) as TenantNodeRow[]).filter((n) => n.status !== 'decommissioned')
  const nodeIds = nodes.map((n) => n.id)
  const { data: details } = nodeIds.length
    ? await supabase.schema('structure').from('tenant_details').select('node_id, bo_period_days, bo_date_override').in('node_id', nodeIds)
    : { data: [] }

  const meterIds = ((linksRes.data ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  const [meterRes, channelRes] = meterIds.length
    ? await Promise.all([
        solar().from('meters').select(METER_COLUMNS).in('id', meterIds),
        solar().from('meter_channels').select(CHANNEL_COLUMNS).in('meter_id', meterIds),
      ])
    : [{ data: [] }, { data: [] }]
  const meters = (meterRes.data ?? []) as MeterRow[]
  const channels = [...((channelRes.data ?? []) as ChannelRow[])]
  const pvIds = meters.map((m) => m.existing_pv_channel_id).filter((x): x is string => !!x && !channels.some((c) => c.id === x))
  if (pvIds.length > 0) {
    const { data } = await solar().from('meter_channels').select(CHANNEL_COLUMNS).in('id', pvIds)
    channels.push(...((data ?? []) as ChannelRow[]))
  }
  const picked = new Map(meters.map((m) => [m.id, pickChannels(m, channels)]))
  const usedIds = [...new Set([...picked.values()].flatMap((p) => [...p.primary, ...p.kva, ...(p.pv ? [p.pv] : [])].map((c) => c.id)))]
  const summaries = await channelSummaries(supabase, usedIds)
  let readings = new Map<string, Reading[]>()
  if (opts.readReadings && usedIds.length > 0) {
    const last = Math.max(0, ...[...summaries.values()].map((s) => s.lastTs ?? 0))
    if (last > 0) readings = await readChannelReadings(supabase, usedIds, last - READ_WINDOW_DAYS * DAY_MS, last + 1000, opts.onProgress)
  }

  const opening = (projectRes.data as { opening_date?: string | null } | null)?.opening_date ?? null
  const bo = new Map(((details ?? []) as Array<{ node_id: string; bo_period_days: number | null; bo_date_override: string | null }>).map((d) => [d.node_id, d]))
  const basisRows = (basisRes.data ?? []) as BasisRow[]
  const basisByNode = new Map(basisRows.map((b) => [b.node_id, b]))
  const tenants: BuildTenant[] = nodes.map((n) => {
    const b = basisByNode.get(n.id)
    const d = bo.get(n.id)
    return {
      nodeId: n.id,
      label: tenantLabel(n),
      areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2),
      category: n.shop_category ?? null,
      source: (b?.source ?? 'unassigned') as TenantSource,
      meters: (b?.meters ?? []).map((x) => ({ meterId: x.meter_id, weight: Number(x.weight) })),
      archetype: b?.archetype ?? null,
      densityOverrideWPerM2: b?.density_override_w_m2 == null ? null : Number(b.density_override_w_m2),
      boDate: computeBoDate(opening, d?.bo_period_days ?? null, d?.bo_date_override ?? null),
    }
  })
  const buildMeters: BuildMeter[] = meters.map((m) => {
    const p = picked.get(m.id) as MeterChannels
    return {
      meterId: m.id, label: m.label, kind: m.kind, supplyPointConfirmed: m.supply_point_confirmed, serials: m.serials ?? [],
      primary: mergeChannelData(p.primary, readings), kva: mergeChannelData(p.kva, readings),
      existingPv: p.pv ? mergeChannelData([p.pv], readings) : null,
    }
  })
  const lines = ((linesRes.data ?? []) as Array<{ from_meter_id: string; to_meter_id: string; line_type: 'supply' | 'check' }>)
    .map((l) => ({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type }))
  const input: BuildSiteLoadInput = {
    basis: study.load_basis ?? 'S2',
    referenceYear: study.reference_year,
    fallbackYear: (opts.now ?? new Date()).getUTCFullYear() - 1,
    commonAreaPct: Number(study.common_area_pct),
    diversityFactor: Number(study.diversity_factor),
    tenants,
    meters: buildMeters,
    lines,
    bills: study.monthly_bills ?? null,
  }

  const summaryKey = (id: string) => {
    const s = summaries.get(id)
    return [id, s?.nRows ?? 0, s?.lastTs ?? null, s?.sumValue ?? null]
  }
  const canonical = {
    engine: SITE_LOAD_ENGINE_VERSION,
    settings: [input.basis, input.referenceYear, input.commonAreaPct, input.diversityFactor, input.bills],
    tenants: tenants.map((t) => JSON.stringify(t)).sort(),
    meters: meters.map((m) => {
      const p = picked.get(m.id) as MeterChannels
      return JSON.stringify([m.id, m.kind, m.supply_point_confirmed, [...(m.serials ?? [])].sort(),
        p.primary.map((c) => summaryKey(c.id)), p.kva.map((c) => summaryKey(c.id)), p.pv ? summaryKey(p.pv.id) : null])
    }).sort(),
    lines: lines.map((l) => JSON.stringify(l)).sort(),
  }
  return {
    ok: true, study, input, inputsHash: await sha256Hex(JSON.stringify(canonical)),
    nodes, basisRows, meters, channels, picked, summaries,
  }
}
```

The BO date in the test: opening `2026-06-01` − 30 days = `2026-05-02`.

- [ ] **Step 3: Run to pass, type-check, commit**

```bash
pnpm --filter web test -- lib/solar/load/gather 2>&1 | tail -4
pnpm --filter web type-check
git add apps/web/src/lib/solar/load/gather.ts apps/web/src/lib/solar/load/gather.test.ts
git commit -m "feat(solar): gather site-load inputs (RLS-scoped) and a readings-free inputs hash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (6 tests), type-check clean.

---

### Task 4: Messages and the rebuild service

**Files:**
- Create: `apps/web/src/lib/solar/load/messages.ts`
- Create: `apps/web/src/lib/solar/load/site-load-service.ts`
- Test: `apps/web/src/lib/solar/load/site-load-service.test.ts`

- [ ] **Step 1: Write `messages.ts`**

```ts
// apps/web/src/lib/solar/load/messages.ts
/** Error code → one human sentence (spec §0.4 rule 5). Codes come from the 3a routes, 00214 and the builder. */
export const LOAD_MESSAGES: Record<string, string> = {
  no_study: 'Set up the study first — save Site & Supply or any Load setting.',
  save_failed: 'The site profile could not be saved — try again.',
  rebuild_failed: 'The site profile could not be built — try again.',
  no_mapping: 'This project has no cloud folder mapped. Map one on the Floor Plans or Documents page.',
  daily_interval: 'This meter has only daily data, so it has no time-of-day pattern.',
  not_found: 'That meter is not in this study.',
  identity_conflict: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.',
  override_needs_reason: 'Give a reason for the override (at least 5 characters).',
  link_needs_existing_meter: 'Choose the existing meter to link to.',
  unresolved_errors: 'The file still has errors — make the choices it asks for, or skip it.',
  already_imported: 'This file is already imported.',
  duplicate_in_other_project: 'These bytes are already imported through another project — use Copy from org meter library.',
  water_is_not_load: 'A water meter is never load data.',
  multi_serial_meter_is_virtual: 'This file holds several meter serials, so its meter kind must be Virtual (multi-serial).',
  primary_not_eligible: 'That channel cannot be the primary channel (it is excluded or its time labels lag).',
  one_primary_channel: 'Choose one primary channel.',
  sha256_mismatch: 'The stored file does not match its fingerprint — upload it again.',
  raw_file_missing: 'The stored file is missing — upload it again.',
  raw_path_invalid: 'The stored file is not where it should be — upload it again.',
  file_too_large: 'The file is larger than 50 MB.',
  commit_failed: 'The import could not be completed — try again.',
  readings_verification_failed: 'The readings did not all save — try again.',
  not_a_meter_series: 'This file is not meter data.',
  not_a_register: 'This file is not a meter register.',
  sheet_not_found: 'That sheet is no longer in the workbook.',
  stale: 'Someone else changed this — reload to see their version.',
}
export function loadErrorMessage(code: string | null | undefined): string {
  return (code && LOAD_MESSAGES[code]) || 'Something went wrong — try again.'
}
```

- [ ] **Step 2: Write the failing service test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ gather: vi.fn(), build: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
vi.mock('./gather', () => ({ gatherLoadInputs: h.gather }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@esite/shared/solar-load', async (orig) => {
  const real = await orig<typeof import('@esite/shared/solar-load')>()
  return { ...real, buildSiteLoad: h.build }
})

import { LoadModelError } from '@esite/shared/solar-load'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { rebuildSiteLoad } from './site-load-service'
import type { RebuildEvent } from './view-types'

const result = {
  basis: 'S2', referenceYear: 2025, series: new Float64Array(HOURS_PER_YEAR).fill(1.23456), mdMonthly: [], designMdKw: null,
  coverage: { metered: 1 }, reconciliation: { bulk: [], parents: [] }, tenants: [], checks: [{ key: 'x' }],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.gather.mockResolvedValue({ ok: true, study: { id: 's1' }, input: {}, inputsHash: 'a'.repeat(64) })
  h.build.mockReturnValue(result)
})

describe('rebuildSiteLoad', () => {
  it('builds, upserts one row per study (3 dp), removes older rows, audits, and reports done', async () => {
    const { client, calls } = fakeSupabase({ writes: { 'solar.site_load:upsert': { data: [{ id: 'sl1' }] } } })
    const events: RebuildEvent[] = []
    const r = await rebuildSiteLoad(client as never, 'p1', 'u1', (e) => events.push(e))
    expect(r).toEqual({ ok: true, siteLoadId: 'sl1' })
    const up = callsTo(calls, 'solar.site_load', 'upsert')[0].payload as Record<string, unknown>
    expect(up).toMatchObject({ study_id: 's1', basis: 'S2', reference_year: 2025, inputs_hash: 'a'.repeat(64), built_by: 'u1' })
    expect((up.series as number[])[0]).toBe(1.235)
    expect((up.coverage as Record<string, unknown>).checks).toEqual([{ key: 'x' }])
    expect(callsTo(calls, 'solar.site_load', 'delete')[0].filters).toEqual([['eq', 'study_id', 's1'], ['neq', 'id', 'sl1']])
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'site_load_built' }))
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: 'p1', event: 'solar_site_load_built' })
    expect(events.at(-1)).toEqual({ type: 'done', siteLoadId: 'sl1', basis: 'S2', referenceYear: 2025, checks: 1 })
  })
  it('turns a LoadModelError into its sentence and writes nothing', async () => {
    h.build.mockImplementation(() => { throw new LoadModelError('no_confirmed_bulk', 'Confirm a bulk meter first.') })
    const { client, calls } = fakeSupabase({})
    const events: RebuildEvent[] = []
    expect(await rebuildSiteLoad(client as never, 'p1', 'u1', (e) => events.push(e))).toEqual({ ok: false })
    expect(events.at(-1)).toEqual({ type: 'error', code: 'no_confirmed_bulk', message: 'Confirm a bulk meter first.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
  it('reports a missing study', async () => {
    h.gather.mockResolvedValue({ ok: false, error: 'no_study' })
    const events: RebuildEvent[] = []
    await rebuildSiteLoad(fakeSupabase({}).client as never, 'p1', 'u1', (e) => events.push(e))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'no_study' })
  })
})
```

Run: `pnpm --filter web test -- site-load-service` → FAIL.

- [ ] **Step 3: Implement the service**

```ts
// apps/web/src/lib/solar/load/site-load-service.ts
import 'server-only'
/**
 * Rebuild the study's site series (functional spec §4.5 "Rebuild site profile"): gather → the pure
 * builder → one solar.site_load row per study (older bases/years are removed so "the profile" is
 * unambiguous). Written with the caller's client; site_load's RESTRICTIVE policies need Solar Edit.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSiteLoad, LoadModelError, SITE_LOAD_ENGINE_VERSION } from '@esite/shared/solar-load'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { gatherLoadInputs } from './gather'
import { loadErrorMessage } from './messages'
import type { RebuildEvent } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function rebuildSiteLoad(
  supabase: AnyClient, projectId: string, userId: string, emit: (e: RebuildEvent) => void,
): Promise<{ ok: true; siteLoadId: string } | { ok: false }> {
  emit({ type: 'progress', stage: 'reading', done: 0, total: 1 })
  const g = await gatherLoadInputs(supabase, projectId, {
    readReadings: true,
    onProgress: (done, total) => emit({ type: 'progress', stage: 'reading', done, total }),
  })
  if (!g.ok) {
    emit({ type: 'error', code: g.error, message: loadErrorMessage(g.error) })
    return { ok: false }
  }
  emit({ type: 'progress', stage: 'building', done: 0, total: 1 })
  let r: ReturnType<typeof buildSiteLoad>
  try {
    r = buildSiteLoad(g.input)
  } catch (e) {
    if (e instanceof LoadModelError) {
      emit({ type: 'error', code: e.code, message: e.message })
      return { ok: false }
    }
    throw e
  }
  emit({ type: 'progress', stage: 'saving', done: 0, total: 1 })
  const { data, error } = await supabase.schema('solar').from('site_load').upsert({
    study_id: g.study.id,
    basis: r.basis,
    reference_year: r.referenceYear,
    series: Array.from(r.series, (v) => Math.round(v * 1000) / 1000),
    md_monthly: r.mdMonthly,
    coverage: { ...r.coverage, designMdKw: r.designMdKw, checks: r.checks, reconciliation: r.reconciliation, tenants: r.tenants },
    inputs_hash: g.inputsHash,
    engine_version: SITE_LOAD_ENGINE_VERSION,
    built_by: userId,
    built_at: new Date().toISOString(),
  }, { onConflict: 'study_id,basis,reference_year' }).select('id').single()
  const id = (data as { id?: string } | null)?.id
  if (error || !id) {
    emit({ type: 'error', code: 'save_failed', message: loadErrorMessage('save_failed') })
    return { ok: false }
  }
  await supabase.schema('solar').from('site_load').delete().eq('study_id', g.study.id).neq('id', id)
  await recordSolarAudit({ projectId, actorId: userId, verb: 'site_load_built', objectRef: { basis: r.basis, referenceYear: r.referenceYear } })
  await emitProductEvent({ actorId: userId, projectId, event: 'solar_site_load_built' })
  emit({ type: 'done', siteLoadId: id, basis: r.basis, referenceYear: r.referenceYear, checks: r.checks.length })
  return { ok: true, siteLoadId: id }
}
```

(If `HOURS_PER_YEAR` is not re-exported by the barrel, it is: `calendar.ts` is in `index.ts` since 3a.)

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- site-load-service 2>&1 | tail -4
git add apps/web/src/lib/solar/load/messages.ts apps/web/src/lib/solar/load/site-load-service.ts apps/web/src/lib/solar/load/site-load-service.test.ts
git commit -m "feat(solar): site-load rebuild service (gather, build, store one profile per study)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (3 tests).

---

### Task 5: `POST /api/projects/[id]/solar/site-load/rebuild` (NDJSON progress)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/site-load/rebuild/route.ts`
- Test: `…/rebuild/route.test.ts`
- Create: `apps/web/src/lib/solar/load/ndjson.ts` (+ `ndjson.test.ts`)

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/lib/solar/load/ndjson.test.ts
import { describe, it, expect } from 'vitest'
import { parseNdjson } from './ndjson'

describe('parseNdjson', () => {
  it('returns whole lines as events and keeps the partial tail', () => {
    const a = parseNdjson('', '{"type":"progress","stage":"reading","done":1,"total":2}\n{"type":"do')
    expect(a.events).toEqual([{ type: 'progress', stage: 'reading', done: 1, total: 2 }])
    const b = parseNdjson(a.rest, 'ne","siteLoadId":"x","basis":"S2","referenceYear":2025,"checks":0}\n\n')
    expect(b.events).toEqual([{ type: 'done', siteLoadId: 'x', basis: 'S2', referenceYear: 2025, checks: 0 }])
    expect(b.rest).toBe('')
  })
})
```

```ts
// apps/web/src/app/api/projects/[id]/solar/site-load/rebuild/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ createClient: vi.fn(), gate: vi.fn(), rebuild: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/load/site-load-service', () => ({ rebuildSiteLoad: h.rebuild }))

import { POST } from './route'

const P = '00000000-0000-0000-0000-000000000001'
const call = (id = P) => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({})
  h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
})

describe('POST site-load/rebuild', () => {
  it('400 on a bad id', async () => expect((await call('x')).status).toBe(400))
  it('gates on Solar Edit', async () => {
    h.gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Solar access required' }, { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith({}, P, 'edit')
    expect(h.rebuild).not.toHaveBeenCalled()
  })
  it('streams the service events as NDJSON', async () => {
    h.rebuild.mockImplementation(async (_s, _p, _u, emit) => {
      emit({ type: 'progress', stage: 'reading', done: 1, total: 1 })
      emit({ type: 'done', siteLoadId: 'sl', basis: 'S2', referenceYear: 2025, checks: 0 })
      return { ok: true, siteLoadId: 'sl' }
    })
    const res = await call()
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.type)).toEqual(['progress', 'done'])
  })
  it('a thrown error becomes one generic error line', async () => {
    h.rebuild.mockRejectedValue(new Error('pg exploded: secret detail'))
    const text = await (await call()).text()
    expect(JSON.parse(text.trim())).toEqual({ type: 'error', code: 'rebuild_failed', message: 'The site profile could not be built — try again.' })
    expect(text).not.toContain('secret')
  })
})
```

Run: `pnpm --filter web test -- ndjson site-load/rebuild` → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/solar/load/ndjson.ts
import type { RebuildEvent } from './view-types'

/** Split a streamed NDJSON buffer into complete events and the unfinished tail. */
export function parseNdjson(rest: string, chunk: string): { events: RebuildEvent[]; rest: string } {
  const buf = rest + chunk
  const parts = buf.split('\n')
  const tail = parts.pop() ?? ''
  const events = parts.filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as RebuildEvent)
  return { events, rest: tail }
}
```

```ts
// apps/web/src/app/api/projects/[id]/solar/site-load/rebuild/route.ts
/**
 * POST /api/projects/[id]/solar/site-load/rebuild — rebuild the study's site series, streaming
 * progress as NDJSON (functional spec §4.5 "Server job; shows progress"). Gate: Solar Edit.
 * app/api/* is outside (admin)/layout.tsx, so this route gates itself.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { rebuildSiteLoad } from '@/lib/solar/load/site-load-service'
import { loadErrorMessage } from '@/lib/solar/load/messages'
import type { RebuildEvent } from '@/lib/solar/load/view-types'

export const runtime = 'nodejs'
export const maxDuration = 300
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const emit = (e: RebuildEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'))
      try {
        await rebuildSiteLoad(supabase, projectId, gate.userId, emit)
      } catch (err) {
        console.error('[solar/site-load/rebuild]', { projectId, error: err instanceof Error ? err.message : String(err) })
        emit({ type: 'error', code: 'rebuild_failed', message: loadErrorMessage('rebuild_failed') })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- ndjson site-load/rebuild 2>&1 | tail -4
git add apps/web/src/lib/solar/load/ndjson.ts apps/web/src/lib/solar/load/ndjson.test.ts "apps/web/src/app/api/projects/[id]/solar/site-load/rebuild"
git commit -m "feat(solar): streaming site-load rebuild route (NDJSON progress, generic errors)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (5 tests).

### Task 6: Meter chart, heatmap and normalised-CSV routes

**Files:**
- Create: `apps/web/src/lib/solar/load/meter-access.ts`
- Create: `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/series/route.ts`
- Create: `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/heatmap/route.ts`
- Create: `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/csv/route.ts`
- Test: `apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/routes.test.ts`

- [ ] **Step 1: Write `meter-access.ts`**

```ts
// apps/web/src/lib/solar/load/meter-access.ts
import 'server-only'
/**
 * A meter is reachable from a project's Load tab only when it is LINKED to that project's study
 * (solar.study_meters). RLS decides whether the caller can read the rows at all; this decides
 * whether the meter belongs on THIS page (a library meter of another study is a 404 here).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CHANNEL_COLUMNS, METER_COLUMNS, pickChannels, type ChannelRow, type MeterChannels, type MeterRow } from './gather'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StudyMeter { studyId: string; meter: MeterRow; channels: ChannelRow[]; picked: MeterChannels }

export async function loadStudyMeter(supabase: AnyClient, projectId: string, meterId: string): Promise<StudyMeter | null> {
  const solar = () => supabase.schema('solar')
  const { data: study } = await solar().from('studies').select('id').eq('project_id', projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  if (!studyId) return null
  const { data: link } = await solar().from('study_meters').select('meter_id').eq('study_id', studyId).eq('meter_id', meterId).maybeSingle()
  if (!link) return null
  const { data: meter } = await solar().from('meters').select(METER_COLUMNS).eq('id', meterId).maybeSingle()
  if (!meter) return null
  const { data: channels } = await solar().from('meter_channels').select(CHANNEL_COLUMNS).eq('meter_id', meterId)
  const rows = (channels ?? []) as ChannelRow[]
  return { studyId, meter: meter as MeterRow, channels: rows, picked: pickChannels(meter as MeterRow, rows) }
}

/** Local SAST time label for a CSV row (the spec's `ts_end (SAST)`). */
export function sastLabel(tsEnd: number): string {
  return new Date(tsEnd + 7_200_000).toISOString().slice(0, 16).replace('T', ' ')
}

/** RFC 4180 CSV (quotes only when needed). */
export function toCsvText(rows: Array<Array<string | number | null>>): string {
  return rows.map((r) => r.map((c) => {
    const s = c === null ? '' : String(c)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n') + '\r\n'
}

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._ -]+/g, '_').trim().slice(0, 80) || 'meter'
}
```

- [ ] **Step 2: Write the failing route tests**

```ts
// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ createClient: vi.fn(), gate: vi.fn(), load: vi.fn(), read: vi.fn(), sums: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/load/meter-access', async (orig) => ({ ...(await orig<object>()), loadStudyMeter: h.load }))
vi.mock('@/lib/solar/load/readings', () => ({ readChannelReadings: h.read, channelSummaries: h.sums }))

import { GET as series } from './series/route'
import { GET as heatmap } from './heatmap/route'
import { GET as csv } from './csv/route'

const P = '00000000-0000-0000-0000-000000000001'
const M = '00000000-0000-0000-0000-000000000002'
const ctx = { params: Promise.resolve({ id: P, meterId: M }) }
const CH = { id: 'c1', meter_id: M, file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW', interval_min: 30, is_primary: true, coverage_only: false, updated_at: 't' }
const T0 = Date.parse('2025-03-10T00:00:00+02:00')
const readings = Array.from({ length: 96 }, (_, i) => ({ tsEnd: T0 + (i + 1) * 1_800_000, value: i === 5 ? null : 3, quality: i === 5 ? 1 : 0 }))

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({})
  h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u1' })
  h.load.mockResolvedValue({ studyId: 's1', meter: { id: M, label: 'Shop 12' }, channels: [CH], picked: { primary: [CH], kva: [], pv: null } })
  h.sums.mockResolvedValue(new Map([['c1', { channelId: 'c1', firstTs: readings[0].tsEnd, lastTs: readings[95].tsEnd, nRows: 96, nUsable: 95, maxValue: 3, sumValue: 285 }]]))
  h.read.mockResolvedValue(new Map([['c1', readings]]))
})

describe('meter series', () => {
  it('gates on Solar View and 404s a meter outside the study', async () => {
    h.load.mockResolvedValue(null)
    const res = await series(new Request('http://x/series'), ctx)
    expect(h.gate).toHaveBeenCalledWith({}, P, 'view')
    expect(res.status).toBe(404)
  })
  it('refuses without Solar View', async () => {
    h.gate.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await series(new Request('http://x/series'), ctx)).status).toBe(403)
  })
  it('returns full-resolution points for a small window, with the missing value as a gap', async () => {
    const body = await (await series(new Request('http://x/series'), ctx)).json()
    expect(body.fullResolution).toBe(true)
    expect(body.buckets).toHaveLength(96)
    expect(body.gaps).toEqual([{ from: readings[5].tsEnd - 1_800_000, to: readings[5].tsEnd }])
    expect(body.channel).toMatchObject({ id: 'c1', unit: 'kW' })
  })
  it('refuses a channel of another meter', async () => {
    expect((await series(new Request('http://x/series?channel=zz'), ctx)).status).toBe(404)
  })
})

describe('meter heatmap', () => {
  it('returns day × hour cells', async () => {
    const body = await (await heatmap(new Request('http://x/heatmap'), ctx)).json()
    expect(body.dates).toEqual(['2025-03-10', '2025-03-11'])
    expect(body.cells[0]).toHaveLength(24)
  })
  it('422 for a daily channel', async () => {
    const daily = { ...CH, interval_min: 1440 }
    h.load.mockResolvedValue({ studyId: 's1', meter: { id: M, label: 'x' }, channels: [daily], picked: { primary: [daily], kva: [], pv: null } })
    expect((await heatmap(new Request('http://x/heatmap'), ctx)).status).toBe(422)
  })
})

describe('meter csv', () => {
  it('downloads ts_end (SAST), value, unit, quality with a safe file name', async () => {
    const res = await csv(new Request('http://x/csv'), ctx)
    expect(res.headers.get('content-disposition')).toContain('Shop 12-normalised.csv')
    const text = await res.text()
    expect(text.split('\r\n')[0]).toBe('ts_end (SAST),value,unit,quality')
    expect(text.split('\r\n')[1]).toBe('2025-03-10 00:30,3,kW,0')
    expect(text.split('\r\n')[6]).toBe('2025-03-10 03:00,,kW,1')
  })
})
```

Run: `pnpm --filter web test -- solar/meters/` → FAIL.

- [ ] **Step 3: Implement the three routes**

```ts
// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/series/route.ts
/**
 * GET …/meters/[meterId]/series?channel=&from=&to= — chart data for the meter drawer (spec §4.3).
 * A window of ≤ 1,200 readings is returned at full resolution; a larger one as min/max/mean buckets
 * (a spike is never averaged away). Gaps are explicit ranges. Gate: Solar View.
 */
import { NextResponse } from 'next/server'
import { gapRanges, minMaxBuckets } from '@esite/shared/solar-load'
import { isUsable } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'

export const runtime = 'nodejs'
export const maxDuration = 60
const BUCKETS = 1200
const DAY = 86_400_000
const MAX_WINDOW = 1400 * DAY

export async function GET(req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const url = new URL(req.url)
  const channelId = url.searchParams.get('channel') ?? sm.picked.primary[0]?.id ?? null
  const channel = sm.channels.find((c) => c.id === channelId)
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sum = (await channelSummaries(supabase, [channel.id])).get(channel.id)
  const first = sum?.firstTs ?? null
  const last = sum?.lastTs ?? null
  const channels = sm.channels.map((c) => ({ id: c.id, label: `${c.source_column} (${c.unit}${c.direction !== 'none' ? `, ${c.direction}` : ''})`, unit: c.unit }))
  if (first === null || last === null) {
    return NextResponse.json({ channel: { id: channel.id, unit: channel.unit, label: channel.source_column }, channels, intervalMin: channel.interval_min, extent: null, window: null, fullResolution: true, buckets: [], gaps: [] })
  }
  const qFrom = Date.parse(url.searchParams.get('from') ?? '')
  const qTo = Date.parse(url.searchParams.get('to') ?? '')
  const to = Number.isFinite(qTo) ? Math.min(qTo, last) : last
  let from = Number.isFinite(qFrom) ? Math.max(qFrom, first - 1) : Math.max(first - 1, to - 365 * DAY)
  if (to - from > MAX_WINDOW) from = to - MAX_WINDOW
  const readings = (await readChannelReadings(supabase, [channel.id], from, to)).get(channel.id) ?? []
  const ts = readings.map((r) => r.tsEnd)
  const values = readings.map((r) => (isUsable(r) ? (r.value as number) : null))
  return NextResponse.json({
    channel: { id: channel.id, unit: channel.unit, label: channel.source_column },
    channels,
    intervalMin: channel.interval_min,
    extent: { first, last },
    window: { from, to },
    fullResolution: readings.length <= BUCKETS,
    buckets: minMaxBuckets(ts, values, BUCKETS),
    gaps: gapRanges(ts, values, channel.interval_min),
  })
}
```

```ts
// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/heatmap/route.ts
/** GET …/meters/[meterId]/heatmap — the primary channel's last 365 days as local date × hour (spec §4.3). Gate: Solar View. */
import { NextResponse } from 'next/server'
import { dailyHeatmap } from '@esite/shared/solar-load'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'
import { mergeChannelData } from '@/lib/solar/load/gather'
import { loadErrorMessage } from '@/lib/solar/load/messages'

export const runtime = 'nodejs'
export const maxDuration = 60
const DAY = 86_400_000

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm || sm.picked.primary.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const interval = sm.picked.primary[0].interval_min
  if (interval > 60 || 60 % interval !== 0) return NextResponse.json({ error: 'daily_interval', message: loadErrorMessage('daily_interval') }, { status: 422 })
  const ids = sm.picked.primary.map((c) => c.id)
  const sums = await channelSummaries(supabase, ids)
  const last = Math.max(0, ...[...sums.values()].map((s) => s.lastTs ?? 0))
  if (last === 0) return NextResponse.json({ dates: [], cells: [], unit: 'kW' })
  const merged = mergeChannelData(sm.picked.primary, await readChannelReadings(supabase, ids, last - 365 * DAY, last))
  const h = dailyHeatmap(merged?.readings ?? [], interval)
  return NextResponse.json({ ...h, unit: 'kW' })
}
```

```ts
// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/csv/route.ts
/**
 * GET …/meters/[meterId]/csv?channel= — normalised readings, full resolution (spec §4.3):
 * `ts_end (SAST), value, unit, quality`. Missing values are empty cells, never 0. Gate: Solar View.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, safeFileName, sastLabel, toCsvText, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'

export const runtime = 'nodejs'
export const maxDuration = 120
const DAY = 86_400_000
const CHUNK = 1400 * DAY

export async function GET(req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const channelId = new URL(req.url).searchParams.get('channel') ?? sm.picked.primary[0]?.id ?? null
  const channel = sm.channels.find((c) => c.id === channelId)
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const sum = (await channelSummaries(supabase, [channel.id])).get(channel.id)
  const rows: Array<Array<string | number | null>> = [['ts_end (SAST)', 'value', 'unit', 'quality']]
  if (sum?.firstTs != null && sum.lastTs != null) {
    for (let from = sum.firstTs - 1; from < sum.lastTs; from += CHUNK) {
      const part = (await readChannelReadings(supabase, [channel.id], from, Math.min(from + CHUNK, sum.lastTs))).get(channel.id) ?? []
      for (const r of part) rows.push([sastLabel(r.tsEnd), r.value, channel.unit, r.quality])
    }
  }
  return new Response(toCsvText(rows), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${safeFileName(sm.meter.label)}-normalised.csv"`,
      'cache-control': 'no-store',
    },
  })
}
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- solar/meters/ 2>&1 | tail -4
git add apps/web/src/lib/solar/load/meter-access.ts "apps/web/src/app/api/projects/[id]/solar/meters"
git commit -m "feat(solar): meter drawer routes — downsampled series with gaps, heatmap, normalised CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (7 tests).

---

### Task 7: Site-profile CSV route (full resolution per chart)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/site-load/csv/route.ts`
- Test: `…/site-load/csv/route.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ createClient: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))

import { fakeSupabase } from '@/test/fake-supabase'
import { GET } from './route'

const P = '00000000-0000-0000-0000-000000000001'
const call = (q: string) => GET(new Request(`http://x/csv?${q}`), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u' })
  h.createClient.mockResolvedValue(fakeSupabase({
    tables: {
      'solar.studies': [{ id: 's1', project_id: P }],
      'solar.site_load': [{ id: 'sl', study_id: 's1', reference_year: 2025, series: Array(HOURS_PER_YEAR).fill(2), built_at: 't' }],
    },
  }).client)
})

describe('site-load csv', () => {
  it('annual = 8,760 hourly rows', async () => {
    const text = await (await call('chart=annual')).text()
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(HOURS_PER_YEAR + 1)
  })
  it('monthly energy, average day, day types and LDC', async () => {
    expect((await (await call('chart=monthly')).text()).split('\r\n')[1]).toBe('January,1488.000')
    expect((await (await call('chart=avgday')).text()).split('\r\n')[0]).toContain('hour,January')
    expect((await (await call('chart=daytype')).text()).split('\r\n')[0]).toBe('hour,weekday_kW,saturday_kW,sunday_holiday_kW')
    expect((await (await call('chart=ldc')).text()).split('\r\n')[1]).toBe('0,2.000')
  })
  it('400 on an unknown chart; 404 with no profile', async () => {
    expect((await call('chart=nope')).status).toBe(400)
    h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.studies': [{ id: 's1', project_id: P }] } }).client)
    expect((await call('chart=annual')).status).toBe(404)
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/app/api/projects/[id]/solar/site-load/csv/route.ts
/** GET …/site-load/csv?chart=annual|monthly|avgday|daytype|ldc — each Site-profile chart's data at full resolution. Gate: Solar View. */
import { NextResponse } from 'next/server'
import { seriesCsvRows, siteProfileCharts } from '@esite/shared/solar-load'
import { MONTH_NAMES } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { toCsvText, UUID_RE } from '@/lib/solar/load/meter-access'

export const runtime = 'nodejs'
const CHARTS = ['annual', 'monthly', 'avgday', 'daytype', 'ldc'] as const
type Chart = (typeof CHARTS)[number]
const f3 = (n: number) => n.toFixed(3)

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const chart = new URL(req.url).searchParams.get('chart') as Chart | null
  if (!chart || !CHARTS.includes(chart)) return NextResponse.json({ error: 'unknown chart' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const { data: study } = await supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  const { data: sl } = studyId
    ? await supabase.schema('solar').from('site_load').select('series, reference_year, built_at').eq('study_id', studyId).order('built_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
  const row = sl as { series: number[]; reference_year: number } | null
  if (!row) return NextResponse.json({ error: 'no site profile yet' }, { status: 404 })
  const year = row.reference_year
  const c = siteProfileCharts(row.series, year)
  let rows: Array<Array<string | number>>
  if (chart === 'annual') rows = seriesCsvRows(row.series, year)
  else if (chart === 'monthly') rows = [['month', 'kWh'], ...c.monthlyKwh.map((v, i) => [MONTH_NAMES[i], f3(v)])]
  else if (chart === 'avgday') rows = [['hour', ...MONTH_NAMES.map((m) => `${m}`)], ...Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, '0')}:00`, ...c.avgDayByMonth.map((m) => f3(m[h]))])]
  else if (chart === 'daytype') rows = [['hour', 'weekday_kW', 'saturday_kW', 'sunday_holiday_kW'], ...Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, '0')}:00`, f3(c.dayTypeProfiles.weekday[h]), f3(c.dayTypeProfiles.saturday[h]), f3(c.dayTypeProfiles.sunday[h])])]
  else rows = [['percent_of_hours', 'kW'], ...c.ldc.map((p) => [p.pct, f3(p.kw)])]
  return new Response(toCsvText(rows), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="site-load-${chart}-${year}.csv"`, 'cache-control': 'no-store' },
  })
}
```

(The fake's `.order()` is a passthrough; `limit(1)` then `maybeSingle()` returns the only row.)

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- site-load/csv 2>&1 | tail -4
git add "apps/web/src/app/api/projects/[id]/solar/site-load/csv"
git commit -m "feat(solar): site-profile CSV downloads per chart at full resolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (3 tests). January of a flat 2 kW year = 31 × 24 × 2 = 1,488 kWh.

### Task 8: Import from the project's Dropbox folder

**Files:**
- Create: `apps/web/src/lib/solar/meter-import/register.ts` (lifted from the 3a route)
- Modify: `apps/web/src/app/api/projects/[id]/solar/meter-files/route.ts` (call the helper; behaviour unchanged)
- Modify: `apps/web/src/services/cloud-storage-folder.server.ts` (+ `downloadCloudFile`)
- Create: `apps/web/src/app/api/projects/[id]/solar/cloud-files/route.ts` (GET list)
- Create: `apps/web/src/app/api/projects/[id]/solar/cloud-files/import/route.ts` (POST import)
- Test: `apps/web/src/lib/solar/meter-import/register.test.ts`, `…/cloud-files/routes.test.ts`

- [ ] **Step 1: Lift the register logic (test first)**

```ts
// apps/web/src/lib/solar/meter-import/register.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeRepo } from './fake-repo'
import { registerStoredRawFile } from './register'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const P2 = '11111111-1111-4111-8111-111111111111'
const bytes = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n')
const sha = createHash('sha256').update(bytes).digest('hex')

describe('registerStoredRawFile', () => {
  it('registers once (201), then reports the duplicate (200)', async () => {
    const f = createFakeRepo({ orgByProject: { [P]: ORG } })
    const path = `${ORG}/${P}/${sha}.csv`
    const a = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: path, originalName: 'a.csv', bytes, sha })
    expect(a.status).toBe(201)
    const b = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: path, originalName: 'a.csv', bytes, sha })
    expect(b).toMatchObject({ status: 200, body: { duplicate: true } })
  })
  it('409 with the meters when the same bytes came through another project', async () => {
    const f = createFakeRepo({ orgByProject: { [P]: ORG, [P2]: ORG } })
    await registerStoredRawFile(f.repo, { projectId: P2, orgId: ORG, storagePath: `${ORG}/${P2}/${sha}.csv`, originalName: 'a.csv', bytes, sha })
    const r = await registerStoredRawFile(f.repo, { projectId: P, orgId: ORG, storagePath: `${ORG}/${P}/${sha}.csv`, originalName: 'a.csv', bytes, sha })
    expect(r).toMatchObject({ status: 409, body: { error: 'duplicate_in_other_project' } })
  })
})
```

```ts
// apps/web/src/lib/solar/meter-import/register.ts
/**
 * Register raw bytes already in solar-meter-raw at <org>/<project>/<sha256>.<ext> as a
 * solar.meter_files row. Shared by POST …/meter-files (browser upload) and the Dropbox import.
 * The caller has already proved the path and recomputed the sha from the bytes.
 */
import type { FileMeter, MeterImportRepo } from './repo'

export type RegisterOutcome =
  | { status: 201; body: { fileId: string; duplicate: false } }
  | { status: 200; body: { fileId: string; duplicate: true; status: string } }
  | { status: 409; body: { error: 'duplicate_in_other_project'; fileId: string; meters: FileMeter[] } }

export async function registerStoredRawFile(repo: MeterImportRepo, a: {
  projectId: string; orgId: string; storagePath: string; originalName: string; bytes: Uint8Array; sha: string
}): Promise<RegisterOutcome> {
  const existing = await repo.fileBySha(a.orgId, a.sha)
  if (existing && existing.project_id !== a.projectId) {
    // meter_files is unique per (org, sha256): these bytes cannot get a row of their own here. Say where
    // the data already lives so the dialog can offer "Same data as <meter> at <site>" → Copy from library.
    return { status: 409, body: { error: 'duplicate_in_other_project', fileId: existing.id, meters: await repo.metersForFile(existing.id) } }
  }
  if (existing) return { status: 200, body: { fileId: existing.id, duplicate: true, status: existing.status } }
  const row = await repo.insertFile({
    project_id: a.projectId, organisation_id: a.orgId, sha256: a.sha, size_bytes: a.bytes.byteLength,
    storage_path: a.storagePath, original_name: a.originalName,
  })
  return { status: 201, body: { fileId: row.id, duplicate: false } }
}
```

In `app/api/projects/[id]/solar/meter-files/route.ts`, replace everything from `const existing = await repo.fileBySha(orgId, sha)` to the final `return` with:

```ts
  const out = await registerStoredRawFile(repo, { projectId, orgId, storagePath: parsed.data.storagePath, originalName: parsed.data.originalName, bytes, sha })
  return NextResponse.json(out.body, { status: out.status })
```

and add `import { registerStoredRawFile } from '@/lib/solar/meter-import/register'`. Run `pnpm --filter web test -- meter-import/register solar/meter-files/route` → both PASS (the 3a route tests prove behaviour is unchanged).

- [ ] **Step 2: `downloadCloudFile` in the folder service**

Append to `services/cloud-storage-folder.server.ts` (after `listCloudFolder`):

```ts
/**
 * Download one file from the connected provider into memory, refusing anything over `maxBytes`
 * (the stream is cancelled at the cap). Same token refresh-on-401 as listCloudFolder.
 */
export async function downloadCloudFile(
  args: { connectionId: string; fileId: string; maxBytes: number },
  supabase: SupabaseClient,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const conn = await loadConnection(args.connectionId, supabase)
  const provider = getCloudStorageProvider(conn.provider)
  let accessToken = await getActiveAccessToken(conn, supabase)
  let res
  try {
    res = await provider.downloadFile({ fileId: args.fileId, accessToken })
  } catch (e) {
    if (!(e instanceof CloudStorageError && e.status === 401)) throw e
    accessToken = await refreshAndPersist(conn, supabase)
    res = await provider.downloadFile({ fileId: args.fileId, accessToken })
  }
  if (res.contentLength !== undefined && res.contentLength > args.maxBytes) throw new Error('too_large')
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > args.maxBytes) {
      await reader.cancel()
      throw new Error('too_large')
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(total)
  let off = 0
  for (const p of parts) { bytes.set(p, off); off += p.byteLength }
  return { bytes, filename: res.filename }
}
```

- [ ] **Step 3: Failing route tests**

```ts
// apps/web/src/app/api/projects/[id]/solar/cloud-files/routes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), download: vi.fn(), upload: vi.fn(), fake: { current: null as unknown }, project: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.project.current }) }) }) }) }),
    storage: { from: () => ({ upload: h.upload }) },
  }),
}))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => h.gate(...a) }))
vi.mock('@/services/cloud-storage-folder.server', () => ({ listCloudFolder: h.list, downloadCloudFile: h.download }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (h.fake.current as { repo: unknown }).repo }
})

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { GET } from './route'
import { POST } from './import/route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const ctx = { params: Promise.resolve({ id: P }) }
const bytes = new TextEncoder().encode('date,p14\n')
const sha = createHash('sha256').update(bytes).digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  h.project.current = { organisation_id: ORG, cloud_storage_connection_id: 'conn-1', cloud_storage_folder_id: 'root', cloud_storage_folder_path: '/Meters' }
  h.fake.current = createFakeRepo({ orgByProject: { [P]: ORG } })
  h.upload.mockResolvedValue({ error: null })
})

describe('GET cloud-files', () => {
  it('lists folders and meter files only, from the mapped folder by default', async () => {
    h.list.mockResolvedValue({ items: [
      { id: 'd', name: 'Sub', type: 'folder' }, { id: 'a', name: 'a.CSV', type: 'file', size: 10 },
      { id: 'b', name: 'b.pdf', type: 'file', size: 10 }, { id: 'c', name: 'c.xlsx', type: 'file', size: 60 * 1024 * 1024 },
    ] })
    const body = await (await GET(new Request('http://x/cloud-files'), ctx)).json()
    expect(h.list).toHaveBeenCalledWith({ connectionId: 'conn-1', folderId: 'root', pageToken: undefined }, expect.anything())
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['d', 'a'])
    expect(body.rootPath).toBe('/Meters')
  })
  it('404 no_mapping when the project has no cloud folder', async () => {
    h.project.current = { organisation_id: ORG, cloud_storage_connection_id: null, cloud_storage_folder_id: null }
    expect((await GET(new Request('http://x/cloud-files'), ctx)).status).toBe(404)
  })
})

describe('POST cloud-files/import', () => {
  it('copies the bytes to <org>/<project>/<sha>.<ext> and registers them', async () => {
    h.download.mockResolvedValue({ bytes, filename: 'a.csv' })
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', name: 'a.csv' }] }) }), ctx)
    const body = await res.json()
    expect(h.upload).toHaveBeenCalledWith(`${ORG}/${P}/${sha}.csv`, bytes, { contentType: 'text/csv', upsert: false })
    expect(body.results[0]).toMatchObject({ name: 'a.csv', duplicate: false })
    expect(body.results[0].fileId).toBeTruthy()
  })
  it('treats an already-stored object as fine (same bytes by construction)', async () => {
    h.download.mockResolvedValue({ bytes, filename: 'a.csv' })
    h.upload.mockResolvedValue({ error: { message: 'The resource already exists', statusCode: '409' } })
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', name: 'a.csv' }] }) }), ctx)).json()
    expect(body.results[0].fileId).toBeTruthy()
  })
  it('refuses a disallowed extension and an oversized file per item', async () => {
    h.download.mockRejectedValue(new Error('too_large'))
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'x', name: 'x.pdf' }, { id: 'y', name: 'y.csv' }] }) }), ctx)).json()
    expect(body.results).toEqual([{ name: 'x.pdf', error: 'not_a_meter_file' }, { name: 'y.csv', error: 'file_too_large' }])
  })
})
```

Run → FAIL.

- [ ] **Step 4: Implement the shared helper and the two routes**

```ts
// apps/web/src/lib/solar/load/cloud.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export const METER_FILE_RE = /\.(csv|txt|xlsx|xls)$/i
export interface ProjectMapping {
  organisation_id: string
  cloud_storage_connection_id: string | null
  cloud_storage_folder_id: string | null
  cloud_storage_folder_path?: string | null
}

/** The project's cloud mapping, read through the caller's session (RLS on projects.projects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function projectMapping(supabase: SupabaseClient<any, any, any>, projectId: string): Promise<ProjectMapping | null> {
  const { data } = await supabase.schema('projects').from('projects')
    .select('organisation_id, cloud_storage_connection_id, cloud_storage_folder_id, cloud_storage_folder_path').eq('id', projectId).maybeSingle()
  return (data as ProjectMapping | null) ?? null
}
```

```ts
// apps/web/src/app/api/projects/[id]/solar/cloud-files/route.ts
/**
 * GET …/solar/cloud-files?folderId=&pageToken= — browse the project's mapped cloud folder for meter
 * exports (spec §4.3 "Import from Dropbox folder"). Folders + .csv/.txt/.xlsx/.xls ≤ 50 MB only.
 * Gate: Solar Edit (only editors import). The connection row is read through RLS.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { listCloudFolder } from '@/services/cloud-storage-folder.server'
import { UUID_RE } from '@/lib/solar/load/meter-access'
import { METER_FILE_RE, projectMapping } from '@/lib/solar/load/cloud'
import { MAX_METER_FILE_BYTES } from '@/lib/solar/meter-import/repo'

// A route module may export only route fields (Next 15 type-checks this at build): helpers live in lib/solar/load/cloud.ts.
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const m = await projectMapping(supabase, projectId)
  if (!m?.cloud_storage_connection_id || !m.cloud_storage_folder_id) return NextResponse.json({ error: 'no_mapping' }, { status: 404 })
  const url = new URL(req.url)
  try {
    const r = await listCloudFolder({
      connectionId: m.cloud_storage_connection_id,
      folderId: url.searchParams.get('folderId') ?? m.cloud_storage_folder_id,
      pageToken: url.searchParams.get('pageToken') ?? undefined,
    }, supabase as unknown as SupabaseClient)
    const items = r.items
      .filter((i) => i.type === 'folder' || (METER_FILE_RE.test(i.name) && (i.size ?? 0) <= MAX_METER_FILE_BYTES))
      .map((i) => ({ id: i.id, name: i.name, type: i.type, size: i.size ?? null, path: i.path ?? null }))
    return NextResponse.json({ rootFolderId: m.cloud_storage_folder_id, rootPath: m.cloud_storage_folder_path ?? null, items, nextPageToken: r.nextPageToken ?? null })
  } catch (e) {
    console.error('[solar/cloud-files]', { projectId, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'cloud_list_failed' }, { status: 502 })
  }
}
```

```ts
// apps/web/src/app/api/projects/[id]/solar/cloud-files/import/route.ts
/**
 * POST …/solar/cloud-files/import { items: [{ id, name }] (1..20) } — copy each chosen cloud file
 * into solar-meter-raw at <org>/<project>/<sha256>.<ext> with the CALLER's client (bucket policy:
 * Solar Edit on the project), then register it exactly like a browser upload. The dialog then calls
 * …/meter-files/parse with the returned file ids. Gate: Solar Edit.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { downloadCloudFile } from '@/services/cloud-storage-folder.server'
import { createMeterImportRepo, MAX_METER_FILE_BYTES, METER_RAW_BUCKET } from '@/lib/solar/meter-import/repo'
import { registerStoredRawFile } from '@/lib/solar/meter-import/register'
import { UUID_RE } from '@/lib/solar/load/meter-access'
import { METER_FILE_RE, projectMapping } from '@/lib/solar/load/cloud'

export const runtime = 'nodejs'
export const maxDuration = 300

const Body = z.object({ items: z.array(z.object({ id: z.string().min(1).max(500), name: z.string().trim().min(1).max(255) }).strict()).min(1).max(20) }).strict()
const MIME: Record<string, string> = {
  csv: 'text/csv', txt: 'text/plain', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  const m = await projectMapping(supabase, projectId)
  if (!m?.cloud_storage_connection_id) return NextResponse.json({ error: 'no_mapping' }, { status: 404 })
  const repo = createMeterImportRepo(supabase)

  const results: Array<Record<string, unknown>> = []
  for (const item of parsed.data.items) {
    const ext = item.name.match(METER_FILE_RE)?.[1]?.toLowerCase()
    if (!ext) { results.push({ name: item.name, error: 'not_a_meter_file' }); continue }
    let bytes: Uint8Array
    try {
      bytes = (await downloadCloudFile({ connectionId: m.cloud_storage_connection_id, fileId: item.id, maxBytes: MAX_METER_FILE_BYTES }, supabase as unknown as SupabaseClient)).bytes
    } catch (e) {
      results.push({ name: item.name, error: e instanceof Error && e.message === 'too_large' ? 'file_too_large' : 'cloud_download_failed' })
      continue
    }
    const sha = await sha256Hex(bytes)
    const storagePath = `${m.organisation_id}/${projectId}/${sha}.${ext}`
    const up = await supabase.storage.from(METER_RAW_BUCKET).upload(storagePath, bytes, { contentType: MIME[ext], upsert: false })
    const exists = up.error && /exist|duplicate/i.test(up.error.message)
    if (up.error && !exists) { results.push({ name: item.name, error: 'storage_upload_failed' }); continue }
    const out = await registerStoredRawFile(repo, { projectId, orgId: m.organisation_id, storagePath, originalName: item.name, bytes, sha })
    results.push(out.status === 409 ? { name: item.name, ...out.body } : { name: item.name, fileId: out.body.fileId, duplicate: out.body.duplicate })
  }
  return NextResponse.json({ results }, { status: 200 })
}
```

- [ ] **Step 5: Run, type-check, commit**

```bash
pnpm --filter web test -- meter-import/register solar/meter-files cloud-files 2>&1 | tail -4
pnpm --filter web type-check
git add apps/web/src/lib/solar/meter-import/register.ts apps/web/src/lib/solar/meter-import/register.test.ts apps/web/src/lib/solar/load/cloud.ts "apps/web/src/app/api/projects/[id]/solar/meter-files/route.ts" apps/web/src/services/cloud-storage-folder.server.ts "apps/web/src/app/api/projects/[id]/solar/cloud-files"
git commit -m "feat(solar): import meter files from the project's mapped cloud folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS; the 3a route suite unchanged in count and green.

### Task 9: Load server actions

**Files:**
- Create: `apps/web/src/actions/solar-load.actions.ts`
- Test: `apps/web/src/actions/solar-load.actions.test.ts`

Every action: `requireSolarLevel(projectId, 'edit', supabase)` first (lower levels are redirected to `/solar/locked`), the caller's client for every write (RLS decides), human sentences only, `recordSolarAudit` after success, `revalidatePath('/projects/<id>/solar/load')`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMPTY_BILLS_FORM } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import {
  applyAutoMatchAction, acknowledgeCheckAction, ensureSolarStudyAction, excludeVacantAction, removeStudyMeterAction,
  saveLoadBasisAction, saveLoadSettingsAction, saveTenantBasisAction, updateStudyMeterAction,
} from './solar-load.actions'

const P = 'p1'
const STALE = 'Someone else changed this — reload to see their version.'
const base: FakeOptions['tables'] = {
  'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }],
  'solar.meters': [{ id: 'm1', kind: 'tenant', updated_at: 'M0' }, { id: 'm2', kind: 'bulk', updated_at: 'M0' }],
  'structure.nodes': [{ id: 'n1', project_id: P, kind: 'tenant_db' }, { id: 'n9', project_id: 'other', kind: 'tenant_db' }],
  'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }, { meter_id: 'm2', weight: 1 }], updated_at: 'B0' }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: base, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('solar-load actions', () => {
  it('every action re-checks Edit', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(ensureSolarStudyAction(P)).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('ensureSolarStudyAction returns the existing study without writing', async () => {
    const { calls } = setup()
    expect(await ensureSolarStudyAction(P)).toEqual({ ok: true, studyId: 's1', updatedAt: 'T0' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('saveLoadBasisAction writes the basis on the loaded version; a stale write is refused', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T1' }] } } })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S1', expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'update')[0]).toMatchObject({ payload: { load_basis: 'S1' }, filters: [['eq', 'project_id', P], ['eq', 'updated_at', 'T0']] })
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S1', expectedUpdatedAt: 'T0' })).toEqual({ error: STALE })
    expect(await saveLoadBasisAction({ projectId: P, basis: 'S9' as never, expectedUpdatedAt: 'T0' })).toEqual({ error: 'Choose a load basis.' })
  })

  it('saveLoadSettingsAction returns field errors without writing', async () => {
    const { calls } = setup()
    const r = await saveLoadSettingsAction({ projectId: P, form: { loadBasis: 'S2', referenceYear: '1999', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '' }, bills: EMPTY_BILLS_FORM, expectedUpdatedAt: 'T0' })
    expect(r).toEqual({ fieldErrors: { referenceYear: 'Reference year must be between 2000 and 2100' } })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('updateStudyMeterAction refuses a meter outside the study and a node of another project; confirms supply point only for bulk', async () => {
    setup()
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'mX', patch: { label: 'x' }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'That meter is not in this study.' })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm1', patch: { nodeId: 'n9' }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'That tenant is not in this project.' })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm1', patch: { supplyPointConfirmed: true }, expectedUpdatedAt: 'M0' })).toEqual({ error: 'Only a bulk meter can be the point of supply.' })
    const { calls } = setup({ writes: { 'solar.meters:update': { data: [{ updated_at: 'M1' }] } } })
    expect(await updateStudyMeterAction({ projectId: P, meterId: 'm2', patch: { supplyPointConfirmed: true, areaM2: 50 }, expectedUpdatedAt: 'M0' })).toEqual({ ok: true, updatedAt: 'M1' })
    expect(callsTo(calls, 'solar.meters', 'update')[0].payload).toEqual({ supply_point_confirmed: true, area_m2: 50, area_source: 'manual' })
  })

  it('removeStudyMeterAction unlinks, strips the meter from tenant assignments, and drops its schematic cards', async () => {
    const { calls } = setup({ tables: { ...base, 'solar.schematics': [{ id: 'sc1', study_id: 's1' }] } })
    expect(await removeStudyMeterAction({ projectId: P, meterId: 'm1', alsoDeleteFromLibrary: false })).toEqual({ ok: true, deletedFromLibrary: false })
    expect(callsTo(calls, 'solar.study_meters', 'delete')[0].filters).toEqual([['eq', 'study_id', 's1'], ['eq', 'meter_id', 'm1']])
    expect(callsTo(calls, 'solar.tenant_load_basis', 'update')[0].payload).toEqual({ meters: [{ meter_id: 'm2', weight: 1 }], source: 'metered' })
    expect(callsTo(calls, 'solar.schematic_cards', 'delete')[0].filters).toEqual([['in', 'schematic_id', ['sc1']], ['eq', 'meter_id', 'm1']])
  })

  it('saveTenantBasisAction validates source, meters and weights', async () => {
    setup()
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'A metered tenant needs at least one meter.' })
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [{ meterId: 'm1', weight: 0 }], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'Every meter weight must be greater than 0.' })
    expect(await saveTenantBasisAction({ projectId: P, nodeId: 'n1', source: 'metered', meters: [{ meterId: 'mX', weight: 1 }], archetype: null, densityOverride: null, expectedUpdatedAt: 'B0' }))
      .toEqual({ error: 'That meter is not in this study.' })
  })

  it('applyAutoMatchAction appends meters, links meters to their tenant, and counts', async () => {
    const { calls } = setup({ writes: { 'solar.tenant_load_basis:update': { data: [{ id: 'b1' }] } } })
    expect(await applyAutoMatchAction({ projectId: P, pairs: [{ nodeId: 'n1', meterId: 'm2' }] })).toEqual({ ok: true, applied: 1 })
    expect(callsTo(calls, 'solar.meters', 'update')[0]).toMatchObject({ payload: { node_id: 'n1' }, filters: [['eq', 'id', 'm2']] })
  })

  it('excludeVacantAction excludes each node and reports the count', async () => {
    const { calls } = setup()
    expect(await excludeVacantAction({ projectId: P, nodeIds: ['n1'] })).toEqual({ ok: true, count: 1 })
    expect(callsTo(calls, 'solar.tenant_load_basis', 'update')[0].payload).toEqual({ source: 'excluded', meters: [] })
  })

  it('acknowledgeCheckAction records the key and note', async () => {
    const { calls } = setup()
    expect(await acknowledgeCheckAction({ projectId: P, checkKey: 'recon_bulk:b:3', note: 'common area' })).toEqual({ ok: true })
    expect(callsTo(calls, 'solar.load_check_acks', 'insert')[0].payload).toEqual({ study_id: 's1', check_key: 'recon_bulk:b:3', note: 'common area' })
  })
})
```

Run: `pnpm --filter web test -- actions/solar-load` → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/actions/solar-load.actions.ts
'use server'
/**
 * Load tab writes (functional spec §4). Each action re-checks Solar Edit itself and writes with the
 * caller's session, so 00210/00214's RESTRICTIVE solar_can_edit policies and bind triggers decide;
 * library writes (meters, register) additionally need the org library at Edit. Saves carry
 * expectedUpdatedAt and a stale write is refused (spec §0.4 rule 2).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'
import {
  EMPTY_BILLS_FORM, validateLoadSettings, type BillsForm, type LoadBasisChoice, type LoadSettingsField, type LoadSettingsForm,
} from '@esite/shared'
import { ARCHETYPE_OPTIONS, METER_KIND_OPTIONS, type MeterKind } from '@/lib/solar/load/view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok<T = object> = { ok: true } & T
type Err = { error: string }

const NOT_IN_STUDY = 'That meter is not in this study.'
const path = (projectId: string) => `/projects/${projectId}/solar/load`

async function ctx(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
async function studyOf(supabase: AnyClient, projectId: string): Promise<{ id: string; updated_at: string } | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as { id: string; updated_at: string } | null) ?? null
}
async function inStudy(supabase: AnyClient, studyId: string, meterIds: string[]): Promise<boolean> {
  if (meterIds.length === 0) return true
  const { data } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', studyId).in('meter_id', meterIds)
  return new Set(((data ?? []) as Array<{ meter_id: string }>).map((r) => r.meter_id)).size === new Set(meterIds).size
}
async function projectNode(supabase: AnyClient, projectId: string, nodeId: string): Promise<boolean> {
  const { data } = await supabase.schema('structure').from('nodes').select('id').eq('id', nodeId).eq('project_id', projectId).eq('kind', 'tenant_db').maybeSingle()
  return Boolean(data)
}
function human(err: { code?: string; message?: string } | null): string {
  const m = err?.message ?? ''
  if (err?.code === '42501') return 'You do not have permission to do that.'
  if (m.includes('another organisation')) return 'That belongs to another organisation.'
  if (m.includes('another project')) return 'That tenant is not in this project.'
  if (m.includes('weight')) return 'Every meter weight must be greater than 0.'
  if (err?.code === '23505') return STALE_MESSAGE
  return GENERIC_ERROR
}

export async function ensureSolarStudyAction(projectId: string): Promise<Ok<{ studyId: string; updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const s = await studyOf(supabase, projectId)
  if (s) return { ok: true, studyId: s.id, updatedAt: s.updated_at }
  const { data, error } = await supabase.schema('solar').from('studies').insert({ project_id: projectId }).select('id, updated_at')
  const row = Array.isArray(data) ? (data[0] as { id: string; updated_at: string } | undefined) : undefined
  if (error || !row) {
    const again = await studyOf(supabase, projectId)  // a concurrent first save
    return again ? { ok: true, studyId: again.id, updatedAt: again.updated_at } : { error: human(error) }
  }
  return { ok: true, studyId: row.id, updatedAt: row.updated_at }
}

async function updateStudy(supabase: AnyClient, projectId: string, values: Record<string, unknown>, expectedUpdatedAt: string | null): Promise<Ok<{ updatedAt: string }> | Err> {
  if (expectedUpdatedAt === null) {
    const { data, error } = await supabase.schema('solar').from('studies').insert({ project_id: projectId, ...values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : human(error) }
    return { ok: true, updatedAt: (Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined) ?? '' }
  }
  const { data, error } = await supabase.schema('solar').from('studies').update(values)
    .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function saveLoadBasisAction(input: { projectId: string; basis: LoadBasisChoice; expectedUpdatedAt: string | null }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!['S1', 'S2', 'S4'].includes(input.basis)) return { error: 'Choose a load basis.' }
  const r = await updateStudy(supabase, input.projectId, { load_basis: input.basis }, input.expectedUpdatedAt)
  if ('ok' in r) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'load_basis_saved', objectRef: { basis: input.basis } })
    revalidatePath(path(input.projectId))
  }
  return r
}

export async function saveLoadSettingsAction(input: {
  projectId: string; form: LoadSettingsForm; bills: BillsForm; expectedUpdatedAt: string | null
}): Promise<Ok<{ updatedAt: string }> | Err | { fieldErrors: Partial<Record<LoadSettingsField, string>> }> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  // Directly invocable: coerce every field to a string so a malformed body gets sentences, not a TypeError.
  const f = (input.form ?? {}) as unknown as Record<string, unknown>
  const s = (k: string) => (f[k] == null ? '' : String(f[k]))
  const form: LoadSettingsForm = { loadBasis: s('loadBasis') as LoadSettingsForm['loadBasis'], referenceYear: s('referenceYear'), loadGrowthPct: s('loadGrowthPct'), diversityFactor: s('diversityFactor'), commonAreaPct: s('commonAreaPct') }
  const b = input.bills && Array.isArray(input.bills.months) && input.bills.months.length === 12 ? input.bills : EMPTY_BILLS_FORM
  const bills: BillsForm = { archetype: b.archetype, powerFactor: String(b.powerFactor ?? ''), months: b.months.map((m) => ({ kwh: String(m?.kwh ?? ''), kva: String(m?.kva ?? '') })) }
  const check = validateLoadSettings(form, bills)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }
  const r = await updateStudy(supabase, input.projectId, check.values as unknown as Record<string, unknown>, input.expectedUpdatedAt)
  if ('ok' in r) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'load_settings_saved' })
    revalidatePath(path(input.projectId))
  }
  return r
}

export async function saveCommonAreaAction(input: { projectId: string; commonAreaPct: number; expectedUpdatedAt: string | null }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!(Number.isFinite(input.commonAreaPct) && input.commonAreaPct >= 0 && input.commonAreaPct <= 100)) return { error: 'Common-area allowance must be between 0 and 100 %' }
  const r = await updateStudy(supabase, input.projectId, { common_area_pct: input.commonAreaPct }, input.expectedUpdatedAt)
  if ('ok' in r) revalidatePath(path(input.projectId))
  return r
}

export interface MeterPatch { label?: string; kind?: MeterKind; nodeId?: string | null; supplyPointConfirmed?: boolean; areaM2?: number | null }

export async function updateStudyMeterAction(input: { projectId: string; meterId: string; patch: MeterPatch; expectedUpdatedAt: string }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || !(await inStudy(supabase, study.id, [input.meterId]))) return { error: NOT_IN_STUDY }
  const p = input.patch ?? {}
  const values: Record<string, unknown> = {}
  if (p.label !== undefined) {
    if (typeof p.label !== 'string' || p.label.trim().length === 0 || p.label.length > 200) return { error: 'A meter needs a label.' }
    values.label = p.label.trim()
  }
  if (p.kind !== undefined) {
    if (!METER_KIND_OPTIONS.some((k) => k.value === p.kind)) return { error: 'Choose a meter kind.' }
    values.kind = p.kind
  }
  if (p.nodeId !== undefined) {
    if (p.nodeId !== null && !(await projectNode(supabase, input.projectId, p.nodeId))) return { error: 'That tenant is not in this project.' }
    values.node_id = p.nodeId
  }
  if (p.supplyPointConfirmed !== undefined) {
    const { data: m } = await supabase.schema('solar').from('meters').select('kind').eq('id', input.meterId).maybeSingle()
    const kind = (values.kind as string | undefined) ?? (m as { kind?: string } | null)?.kind
    if (p.supplyPointConfirmed && kind !== 'bulk') return { error: 'Only a bulk meter can be the point of supply.' }
    values.supply_point_confirmed = Boolean(p.supplyPointConfirmed)
  }
  if (values.kind !== undefined && values.kind !== 'bulk') values.supply_point_confirmed = false
  if (p.areaM2 !== undefined) {
    if (p.areaM2 !== null && !(Number.isFinite(p.areaM2) && p.areaM2 > 0)) return { error: 'Area must be a positive number of m².' }
    values.area_m2 = p.areaM2
    values.area_source = p.areaM2 === null ? null : 'manual'
  }
  if (Object.keys(values).length === 0) return { error: 'Nothing to save.' }
  const { data, error } = await supabase.schema('solar').from('meters').update(values)
    .eq('id', input.meterId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_updated', objectRef: { meterId: input.meterId, fields: Object.keys(values) } })
  revalidatePath(path(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function removeStudyMeterAction(input: { projectId: string; meterId: string; alsoDeleteFromLibrary: boolean }): Promise<Ok<{ deletedFromLibrary: boolean }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || !(await inStudy(supabase, study.id, [input.meterId]))) return { error: NOT_IN_STUDY }
  const solar = () => supabase.schema('solar')

  const { data: basisRows } = await solar().from('tenant_load_basis').select('id, source, meters').eq('study_id', study.id)
  for (const b of (basisRows ?? []) as Array<{ id: string; source: string; meters: Array<{ meter_id: string; weight: number }> }>) {
    if (!b.meters.some((m) => m.meter_id === input.meterId)) continue
    const meters = b.meters.filter((m) => m.meter_id !== input.meterId)
    const { error } = await solar().from('tenant_load_basis').update({ meters, source: b.source === 'metered' && meters.length === 0 ? 'synthesised' : b.source }).eq('id', b.id)
    if (error) return { error: human(error) }
  }
  const { data: schematics } = await solar().from('schematics').select('id').eq('study_id', study.id)
  const schematicIds = ((schematics ?? []) as Array<{ id: string }>).map((s) => s.id)
  if (schematicIds.length > 0) {
    const { error } = await solar().from('schematic_cards').delete().in('schematic_id', schematicIds).eq('meter_id', input.meterId)
    if (error) return { error: human(error) }
  }
  const { error: unlinkErr } = await solar().from('study_meters').delete().eq('study_id', study.id).eq('meter_id', input.meterId)
  if (unlinkErr) return { error: human(unlinkErr) }

  let deleted = false
  if (input.alsoDeleteFromLibrary) {
    const { data: others } = await solar().from('study_meters').select('study_id').eq('meter_id', input.meterId)
    if (Array.isArray(others) && others.length > 0) return { error: 'Removed from this study; the meter is still used by another study, so it stays in the library.' }
    const { data, error } = await solar().from('meters').delete().eq('id', input.meterId).select('id')
    if (error) return { error: human(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: 'Removed from this study; only an org owner or admin can delete it from the library.' }
    deleted = true
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: deleted ? 'meter_deleted_from_library' : 'meter_removed_from_study', objectRef: { meterId: input.meterId } })
  revalidatePath(path(input.projectId))
  return { ok: true, deletedFromLibrary: deleted }
}

export interface LibraryMeterHit { id: string; label: string; siteLabel: string | null; kind: string; serials: string[] }

export async function searchLibraryMetersAction(input: { projectId: string; query: string }): Promise<Ok<{ meters: LibraryMeterHit[] }> | Err> {
  const { supabase } = await ctx(input.projectId)
  const q = String(input.query ?? '').trim().slice(0, 80)
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  if (!orgId) return { error: GENERIC_ERROR }
  const study = await studyOf(supabase, input.projectId)
  const linked = study
    ? new Set((((await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', study.id)).data ?? []) as Array<{ meter_id: string }>).map((r) => r.meter_id))
    : new Set<string>()
  const esc = q.replace(/[\\%_,()]/g, (c) => `\\${c}`)
  let query = supabase.schema('solar').from('meters').select('id, label, site_label, kind, serials').eq('organisation_id', orgId)
  if (q) query = query.or(`label.ilike.%${esc}%,site_label.ilike.%${esc}%,serials.cs.{${esc}}`)
  const { data, error } = await query.order('label').limit(50)
  if (error) return { error: human(error) }
  return {
    ok: true,
    meters: ((data ?? []) as Array<{ id: string; label: string; site_label: string | null; kind: string; serials: string[] | null }>)
      .filter((m) => !linked.has(m.id))
      .map((m) => ({ id: m.id, label: m.label, siteLabel: m.site_label, kind: m.kind, serials: m.serials ?? [] })),
  }
}

export async function linkLibraryMetersAction(input: { projectId: string; meterIds: string[] }): Promise<Ok<{ linked: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const ids = [...new Set((input.meterIds ?? []).filter((x) => typeof x === 'string'))].slice(0, 200)
  if (ids.length === 0) return { error: 'Choose at least one meter.' }
  const ensured = await ensureSolarStudyAction(input.projectId)
  if ('error' in ensured) return ensured
  const { error } = await supabase.schema('solar').from('study_meters')
    .upsert(ids.map((meter_id) => ({ study_id: ensured.studyId, meter_id })), { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
  if (error) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meters_copied_from_library', objectRef: { count: ids.length } })
  revalidatePath(path(input.projectId))
  return { ok: true, linked: ids.length }
}

export async function saveTenantBasisAction(input: {
  projectId: string; nodeId: string; source: 'metered' | 'synthesised' | 'excluded'; meters: Array<{ meterId: string; weight: number }>
  archetype: string | null; densityOverride: number | null; expectedUpdatedAt: string | null
}): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!['metered', 'synthesised', 'excluded'].includes(input.source)) return { error: 'Choose a load source.' }
  const meters = Array.isArray(input.meters) ? input.meters : []
  if (input.source === 'metered' && meters.length === 0) return { error: 'A metered tenant needs at least one meter.' }
  if (meters.some((m) => !(typeof m.weight === 'number' && Number.isFinite(m.weight) && m.weight > 0))) return { error: 'Every meter weight must be greater than 0.' }
  if (input.archetype !== null && !ARCHETYPE_OPTIONS.some((a) => a.value === input.archetype)) return { error: 'Choose an archetype.' }
  if (input.densityOverride !== null && !(Number.isFinite(input.densityOverride) && input.densityOverride > 0 && input.densityOverride <= 2000)) return { error: 'Density must be between 0 and 2,000 W/m².' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  if (!(await inStudy(supabase, study.id, meters.map((m) => m.meterId)))) return { error: NOT_IN_STUDY }
  if (!(await projectNode(supabase, input.projectId, input.nodeId))) return { error: 'That tenant is not in this project.' }
  const row = {
    source: input.source,
    meters: meters.map((m) => ({ meter_id: m.meterId, weight: m.weight })),
    archetype: input.archetype,
    density_override_w_m2: input.densityOverride,
  }
  const t = supabase.schema('solar').from('tenant_load_basis')
  const res = input.expectedUpdatedAt === null
    ? await t.insert({ study_id: study.id, node_id: input.nodeId, ...row }).select('updated_at')
    : await t.update(row).eq('study_id', study.id).eq('node_id', input.nodeId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : human(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'tenant_load_basis_saved', objectRef: { nodeId: input.nodeId, source: input.source } })
  revalidatePath(path(input.projectId))
  return { ok: true, updatedAt: res.data[0]?.updated_at as string }
}

export async function applyAutoMatchAction(input: { projectId: string; pairs: Array<{ nodeId: string; meterId: string }> }): Promise<Ok<{ applied: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const pairs = (input.pairs ?? []).slice(0, 500)
  if (pairs.length === 0) return { error: 'Tick at least one proposed pair.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  if (!(await inStudy(supabase, study.id, pairs.map((p) => p.meterId)))) return { error: NOT_IN_STUDY }
  const solar = () => supabase.schema('solar')
  const { data: rows } = await solar().from('tenant_load_basis').select('node_id, meters').eq('study_id', study.id)
  const existing = new Map(((rows ?? []) as Array<{ node_id: string; meters: Array<{ meter_id: string; weight: number }> }>).map((r) => [r.node_id, r.meters]))
  const byNode = new Map<string, string[]>()
  for (const p of pairs) byNode.set(p.nodeId, [...(byNode.get(p.nodeId) ?? []), p.meterId])
  let applied = 0
  for (const [nodeId, meterIds] of byNode) {
    if (!(await projectNode(supabase, input.projectId, nodeId))) return { error: 'That tenant is not in this project.' }
    const have = existing.get(nodeId)
    const merged = [...(have ?? []), ...meterIds.filter((id) => !(have ?? []).some((m) => m.meter_id === id)).map((meter_id) => ({ meter_id, weight: 1 }))]
    const res = have
      ? await solar().from('tenant_load_basis').update({ source: 'metered', meters: merged }).eq('study_id', study.id).eq('node_id', nodeId).select('id')
      : await solar().from('tenant_load_basis').insert({ study_id: study.id, node_id: nodeId, source: 'metered', meters: merged }).select('id')
    if (res.error) return { error: human(res.error) }
    for (const meterId of meterIds) {
      const { error } = await solar().from('meters').update({ node_id: nodeId }).eq('id', meterId)
      if (error) return { error: human(error) }
      applied++
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meters_auto_matched', objectRef: { applied } })
  revalidatePath(path(input.projectId))
  return { ok: true, applied }
}

export async function excludeVacantAction(input: { projectId: string; nodeIds: string[] }): Promise<Ok<{ count: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const nodeIds = [...new Set(input.nodeIds ?? [])].slice(0, 1000)
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  const solar = () => supabase.schema('solar')
  const { data: rows } = await solar().from('tenant_load_basis').select('node_id').eq('study_id', study.id).in('node_id', nodeIds)
  const have = new Set(((rows ?? []) as Array<{ node_id: string }>).map((r) => r.node_id))
  for (const nodeId of nodeIds) {
    const res = have.has(nodeId)
      ? await solar().from('tenant_load_basis').update({ source: 'excluded', meters: [] }).eq('study_id', study.id).eq('node_id', nodeId)
      : await solar().from('tenant_load_basis').insert({ study_id: study.id, node_id: nodeId, source: 'excluded', meters: [] })
    if (res.error) return { error: human(res.error) }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'vacant_tenants_excluded', objectRef: { count: nodeIds.length } })
  revalidatePath(path(input.projectId))
  return { ok: true, count: nodeIds.length }
}

export async function acknowledgeCheckAction(input: { projectId: string; checkKey: string; note: string | null }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const key = String(input.checkKey ?? '').trim()
  if (key.length === 0 || key.length > 300) return { error: GENERIC_ERROR }
  const note = input.note == null ? null : String(input.note).slice(0, 1000)
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { error } = await supabase.schema('solar').from('load_check_acks').insert({ study_id: study.id, check_key: key, note })
  if (error && error.code !== '23505') return { error: human(error) }
  revalidatePath(path(input.projectId))
  return { ok: true }
}

export async function unacknowledgeCheckAction(input: { projectId: string; checkKey: string }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { error } = await supabase.schema('solar').from('load_check_acks').delete().eq('study_id', study.id).eq('check_key', String(input.checkKey ?? ''))
  if (error) return { error: human(error) }
  revalidatePath(path(input.projectId))
  return { ok: true }
}

export async function confirmRegisterRowAction(input: { projectId: string; rowId: string }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  const { data, error } = await supabase.schema('solar').from('meter_register').update({ confirmed_at: new Date().toISOString() })
    .eq('id', input.rowId).eq('organisation_id', orgId ?? '').is('confirmed_at', null).select('id')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_register_row_confirmed', objectRef: { rowId: input.rowId } })
  revalidatePath(path(input.projectId))
  return { ok: true }
}
```

Note on `removeStudyMeterAction`: the fake does not filter `update` by payload, so the test's single `tenant_load_basis` row (`m1`, `m2`) is rewritten without `m1`, source kept `metered`.

- [ ] **Step 3: Run, type-check, commit**

```bash
pnpm --filter web test -- actions/solar-load 2>&1 | tail -4
pnpm --filter web type-check
git add apps/web/src/actions/solar-load.actions.ts apps/web/src/actions/solar-load.actions.test.ts
git commit -m "feat(solar): load actions — study, basis/settings, meters, library copy, tenant basis, auto-match, vacant, acks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (10 tests).

### Task 10: Sub-tab loaders and the readiness aggregate

**Files:**
- Create: `apps/web/src/lib/solar/load/views.ts`
- Test: `apps/web/src/lib/solar/load/views.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ gather: vi.fn(), sums: vi.fn() }))
vi.mock('./gather', async (orig) => ({ ...(await orig<object>()), gatherLoadInputs: h.gather }))
vi.mock('./readings', () => ({ channelSummaries: h.sums, readChannelReadings: vi.fn() }))

import { fakeSupabase } from '@/test/fake-supabase'
import { loadChecksView, loadLoadReadiness, loadMetersView, loadProfileView, loadTenantsView } from './views'

const P = 'p1'
const CH = { id: 'c1', meter_id: 'm1', file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW', interval_min: 30, is_primary: true, coverage_only: false, updated_at: 't' }
const tables = {
  'projects.projects': [{ id: P, organisation_id: 'o1', cloud_storage_connection_id: 'c', cloud_storage_folder_id: 'f' }],
  'solar.studies': [{ id: 's1', project_id: P, load_basis: 'S2', reference_year: null, common_area_pct: '5', diversity_factor: '1', load_growth_pct: '0', monthly_bills: null, schematic_waived: false, updated_at: 'T0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }],
  'solar.meters': [{ id: 'm1', label: 'Pep', kind: 'tenant', site_label: 'YA', serials: [], supply_point_confirmed: false, existing_pv_channel_id: null, node_id: 'n1', shop_no: '12', area_m2: null, area_source: null, updated_at: 'M0' }],
  'solar.meter_channels': [CH],
  'structure.nodes': [
    { id: 'n1', project_id: P, kind: 'tenant_db', code: 'T1', name: null, shop_number: '12', shop_name: 'Pep', shop_area_m2: '100', shop_category: 'standard', status: 'active' },
    { id: 'n2', project_id: P, kind: 'tenant_db', code: 'T2', name: null, shop_number: '13', shop_name: 'VACANT', shop_area_m2: '50', shop_category: null, status: 'active' },
  ],
  'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }], archetype: null, density_override_w_m2: null, updated_at: 'B0' }],
  'solar.meter_register': [
    { id: 'r1', organisation_id: 'o1', kind: 'summary', site_label: 'YA', file_name: 'Pep.csv', tenant_name: 'Pep', shop_no: '12', area_m2: 100, match_method: 'llm', confirmed_at: null },
    { id: 'r2', organisation_id: 'o1', kind: 'summary', site_label: 'YA', file_name: 'Missing.csv', tenant_name: 'X', shop_no: '99', area_m2: null, match_method: 'exact', confirmed_at: null },
  ],
  'solar.meter_files': [{ id: 'f1', organisation_id: 'o1', original_name: 'Pep.csv' }],
  'solar.site_load': [{ id: 'sl', study_id: 's1', basis: 'S2', reference_year: 2025, series: Array(HOURS_PER_YEAR).fill(1), md_monthly: [], inputs_hash: 'h1', built_at: '2025-09-01T00:00:00Z',
    coverage: { metered: 1, unassigned: 1, fullYearFromData: true, designMdKw: null, checks: [{ key: 'k1', severity: 'warning', message: 'm' }], reconciliation: { bulk: [], parents: [] }, tenants: [{ nodeId: 'n1', source: 'metered', annualKwh: 8760, peakKw: 1, wPerM2: 10 }] } }],
  'solar.load_check_acks': [{ study_id: 's1', check_key: 'k1', note: 'ok', acknowledged_at: '2025-09-02T00:00:00Z' }],
  'solar.schematics': [],
  'solar.schematic_cards': [],
  'solar.meter_import_reports': [],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.sums.mockResolvedValue(new Map([['c1', { channelId: 'c1', firstTs: Date.parse('2025-01-01T00:30:00Z'), lastTs: Date.parse('2025-12-31T23:00:00Z'), nRows: 17520, nUsable: 17000, maxValue: 12, sumValue: 175200 }]]))
  h.gather.mockResolvedValue({ ok: true, inputsHash: 'h2' })
})
const client = () => fakeSupabase({ tables }).client as never

describe('load views', () => {
  it('meters view: summaries, tenant label, register flags', async () => {
    const v = await loadMetersView(client(), P, false)
    expect(v.meters[0]).toMatchObject({ id: 'm1', tenantLabel: '12 · Pep', intervalMin: 30, peakKw: 12, status: 'imported', fileIds: ['f1'] })
    expect(v.meters[0].annualKwh).toBeCloseTo(87_600, -2)
    expect(v.meters[0].completeness).toBeCloseTo(17000 / 17520, 2)
    expect(v.register.find((r) => r.id === 'r2')?.fileImported).toBe(false)
    expect(v.cloudMapped).toBe(true)
  })
  it('tenants view: basis, last-build summary, vacant flag, and never pre-ticks an LLM register match', async () => {
    const v = await loadTenantsView(client(), P)
    expect(v.tenants.find((t) => t.nodeId === 'n1')?.summary).toMatchObject({ annualKwh: 8760 })
    expect(v.tenants.find((t) => t.nodeId === 'n2')?.vacant).toBe(true)
    expect(v.proposals.every((p) => p.meterId !== 'm1')).toBe(true) // m1 is already assigned
  })
  it('profile view: charts from the stored series and stale when the hash moved', async () => {
    const v = await loadProfileView(client(), P)
    expect(v.siteLoad?.stale).toBe(true)
    expect(v.siteLoad?.charts.kpis.annualKwh).toBeCloseTo(8760)
    expect(v.years).toEqual([2025])
  })
  it('checks view: acknowledged rows carry the note', async () => {
    const v = await loadChecksView(client(), P)
    expect(v.checks[0]).toMatchObject({ key: 'k1', ack: { note: 'ok' } })
  })
  it('readiness aggregate: counts unassigned tenants from the current rows', async () => {
    const r = await loadLoadReadiness(client(), P)
    expect(r).toMatchObject({ load: { hasSiteLoad: true, unassignedTenants: 1, totalTenants: 2, basis: 'S2' } })
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement `views.ts`**

```ts
// apps/web/src/lib/solar/load/views.ts
import 'server-only'
/**
 * Server loaders for the Load tab's four sub-tabs and the gated layout's readiness aggregate. Read
 * with the caller's client; everything a client component receives is JSON (view-types.ts).
 * Nothing here computes load: charts come from siteProfileCharts over the STORED series.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeBoDate, loadSettingsFormFromRow, type LoadReadinessInput, type SchematicsReadinessInput } from '@esite/shared'
import {
  autoMatchMeters, CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, siteProfileCharts, type BulkReconciliation, type LoadCheck,
  type MdMonth, type ParentReconciliation, type SiteLoadCoverage, type TenantSummary,
} from '@esite/shared/solar-load'
import {
  CHANNEL_COLUMNS, gatherLoadInputs, METER_COLUMNS, NODE_COLUMNS, pickChannels, STUDY_LOAD_COLUMNS, tenantLabel,
  type ChannelRow, type MeterRow, type StudyLoadRow, type TenantNodeRow,
} from './gather'
import { channelSummaries } from './readings'
import type { AutoMatchView, ChecksView, MetersView, MeterView, ProfileView, TenantRowView, TenantsView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const DAY = 86_400_000

interface SiteLoadRow {
  id: string
  basis: 'S1' | 'S2' | 'S3' | 'S4'
  reference_year: number
  series: number[]
  md_monthly: MdMonth[]
  inputs_hash: string
  built_at: string
  coverage: SiteLoadCoverage & { designMdKw: number | null; checks: LoadCheck[]; reconciliation: { bulk: BulkReconciliation[]; parents: ParentReconciliation[] }; tenants: TenantSummary[] }
}

async function study(supabase: AnyClient, projectId: string): Promise<StudyLoadRow | null> {
  const { data } = await supabase.schema('solar').from('studies').select(STUDY_LOAD_COLUMNS).eq('project_id', projectId).maybeSingle()
  return (data as StudyLoadRow | null) ?? null
}
async function latestSiteLoad(supabase: AnyClient, studyId: string): Promise<SiteLoadRow | null> {
  const { data } = await supabase.schema('solar').from('site_load').select('id, basis, reference_year, series, md_monthly, inputs_hash, built_at, coverage')
    .eq('study_id', studyId).order('built_at', { ascending: false }).limit(1).maybeSingle()
  return (data as SiteLoadRow | null) ?? null
}
async function tenantNodes(supabase: AnyClient, projectId: string): Promise<TenantNodeRow[]> {
  const { data } = await supabase.schema('structure').from('nodes').select(NODE_COLUMNS).eq('project_id', projectId).eq('kind', 'tenant_db').is('deleted_at', null)
  return ((data ?? []) as TenantNodeRow[]).filter((n) => n.status !== 'decommissioned').sort((a, b) => (a.shop_number ?? '').localeCompare(b.shop_number ?? '', undefined, { numeric: true }))
}
async function studyMeters(supabase: AnyClient, studyId: string): Promise<{ meters: MeterRow[]; channels: ChannelRow[] }> {
  const { data: links } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', studyId)
  const ids = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  if (ids.length === 0) return { meters: [], channels: [] }
  const [m, c] = await Promise.all([
    supabase.schema('solar').from('meters').select(METER_COLUMNS).in('id', ids),
    supabase.schema('solar').from('meter_channels').select(CHANNEL_COLUMNS).in('meter_id', ids),
  ])
  return { meters: ((m.data ?? []) as MeterRow[]).sort((a, b) => a.label.localeCompare(b.label)), channels: (c.data ?? []) as ChannelRow[] }
}
const isVacant = (n: TenantNodeRow) => /\bvacant\b/i.test(`${n.shop_name ?? ''} ${n.name ?? ''}`)

export async function loadMetersView(supabase: AnyClient, projectId: string, isGrantor: boolean): Promise<MetersView> {
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id, cloud_storage_connection_id, cloud_storage_folder_id').eq('id', projectId).maybeSingle()
  const p = (project ?? {}) as { organisation_id?: string; cloud_storage_connection_id?: string | null; cloud_storage_folder_id?: string | null }
  const s = await study(supabase, projectId)
  const nodes = await tenantNodes(supabase, projectId)
  const nodeLabel = new Map(nodes.map((n) => [n.id, tenantLabel(n)]))
  const { meters, channels } = s ? await studyMeters(supabase, s.id) : { meters: [], channels: [] }
  const picked = new Map(meters.map((m) => [m.id, pickChannels(m, channels)]))
  const primaryIds = [...picked.values()].flatMap((x) => x.primary.map((c) => c.id))
  const sums = await channelSummaries(supabase, primaryIds)
  const otherLinks = new Map<string, number>()
  if (isGrantor && meters.length > 0) {
    const { data } = await supabase.schema('solar').from('study_meters').select('meter_id, study_id').in('meter_id', meters.map((m) => m.id))
    for (const r of (data ?? []) as Array<{ meter_id: string; study_id: string }>) if (r.study_id !== s?.id) otherLinks.set(r.meter_id, (otherLinks.get(r.meter_id) ?? 0) + 1)
  }
  const view: MeterView[] = meters.map((m) => {
    const pc = picked.get(m.id) as ReturnType<typeof pickChannels>
    const ss = pc.primary.map((c) => sums.get(c.id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    const interval = pc.primary[0]?.interval_min ?? null
    const first = ss.length ? Math.min(...ss.map((x) => x.firstTs ?? Infinity)) : null
    const last = ss.length ? Math.max(...ss.map((x) => x.lastTs ?? 0)) : null
    const nUsable = ss.reduce((a, x) => a + x.nUsable, 0)
    const sum = ss.reduce((a, x) => a + (x.sumValue ?? 0), 0)
    const slots = first !== null && last !== null && interval ? Math.round((last - first) / (interval * 60_000)) + 1 : null
    const spanDays = first !== null && last !== null && interval ? (last - first) / DAY + interval / 1440 : null
    return {
      id: m.id, label: m.label, kind: m.kind, siteLabel: m.site_label, serials: m.serials ?? [], nodeId: m.node_id,
      tenantLabel: m.node_id ? nodeLabel.get(m.node_id) ?? null : null, shopNo: m.shop_no,
      areaM2: m.area_m2 == null ? null : Number(m.area_m2), supplyPointConfirmed: m.supply_point_confirmed, updatedAt: m.updated_at,
      primaryChannelId: pc.primary[0]?.id ?? null, intervalMin: interval,
      periodStart: first !== null && Number.isFinite(first) ? new Date(first).toISOString() : null,
      periodEnd: last ? new Date(last).toISOString() : null,
      completeness: slots ? nUsable / slots : null,
      peakKw: ss.length ? Math.max(...ss.map((x) => x.maxValue ?? 0)) : null,
      annualKwh: spanDays && interval ? (sum * (interval / 60) * 365) / spanDays : null,
      fileIds: [...new Set(channels.filter((c) => c.meter_id === m.id && c.file_id).map((c) => c.file_id as string))],
      otherStudyLinks: otherLinks.get(m.id) ?? 0,
      status: pc.primary.length > 0 && ss.length > 0 ? 'imported' : 'no_data',
    }
  })
  const orgId = p.organisation_id ?? ''
  const [{ data: reg }, { data: files }] = await Promise.all([
    supabase.schema('solar').from('meter_register').select('id, site_label, file_name, tenant_name, shop_no, area_m2, match_method, confirmed_at, kind').eq('organisation_id', orgId).eq('kind', 'summary').limit(2000),
    supabase.schema('solar').from('meter_files').select('original_name').eq('organisation_id', orgId).limit(5000),
  ])
  const imported = new Set(((files ?? []) as Array<{ original_name: string }>).map((f) => f.original_name.toLowerCase()))
  const sl = s ? await latestSiteLoad(supabase, s.id) : null
  return {
    studyId: s?.id ?? null,
    orgId,
    meters: view,
    nodes: nodes.map((n) => ({ id: n.id, label: tenantLabel(n), shopNumber: n.shop_number })),
    register: ((reg ?? []) as Array<{ id: string; site_label: string | null; file_name: string | null; tenant_name: string | null; shop_no: string | null; area_m2: number | null; match_method: string; confirmed_at: string | null }>).map((r) => ({
      id: r.id, siteLabel: r.site_label, fileName: r.file_name, tenantName: r.tenant_name, shopNo: r.shop_no,
      areaM2: r.area_m2 == null ? null : Number(r.area_m2), matchMethod: r.match_method, confirmed: r.confirmed_at !== null,
      fileImported: r.file_name ? imported.has(r.file_name.toLowerCase()) : false,
    })),
    cloudMapped: Boolean(p.cloud_storage_connection_id && p.cloud_storage_folder_id),
    isGrantor,
    bulkRecon: sl?.coverage.reconciliation?.bulk ?? [],
  }
}

export async function loadTenantsView(supabase: AnyClient, projectId: string): Promise<TenantsView> {
  const s = await study(supabase, projectId)
  const nodes = await tenantNodes(supabase, projectId)
  const { meters } = s ? await studyMeters(supabase, s.id) : { meters: [] }
  const { data: basisRows } = s ? await supabase.schema('solar').from('tenant_load_basis').select('id, node_id, source, meters, archetype, density_override_w_m2, updated_at').eq('study_id', s.id) : { data: [] }
  const basis = new Map(((basisRows ?? []) as Array<{ id: string; node_id: string; source: 'metered' | 'synthesised' | 'excluded'; meters: Array<{ meter_id: string; weight: number }>; archetype: string | null; density_override_w_m2: number | null; updated_at: string }>).map((b) => [b.node_id, b]))
  const nodeIds = nodes.map((n) => n.id)
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id, opening_date').eq('id', projectId).maybeSingle()
  const opening = (project as { opening_date?: string | null } | null)?.opening_date ?? null
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id ?? ''
  const { data: details } = nodeIds.length ? await supabase.schema('structure').from('tenant_details').select('node_id, bo_period_days, bo_date_override').in('node_id', nodeIds) : { data: [] }
  const bo = new Map(((details ?? []) as Array<{ node_id: string; bo_period_days: number | null; bo_date_override: string | null }>).map((d) => [d.node_id, computeBoDate(opening, d.bo_period_days, d.bo_date_override)]))
  const sl = s ? await latestSiteLoad(supabase, s.id) : null
  const summaries = new Map((sl?.coverage.tenants ?? []).map((t) => [t.nodeId, t]))
  const tenants: TenantRowView[] = nodes.map((n) => {
    const b = basis.get(n.id)
    const cat = n.shop_category ?? 'standard'
    return {
      nodeId: n.id, shopNumber: n.shop_number, name: n.shop_name ?? n.name ?? n.code ?? 'Tenant', category: n.shop_category,
      areaM2: n.shop_area_m2 == null ? null : Number(n.shop_area_m2), boDate: bo.get(n.id) ?? null,
      basis: b ? { id: b.id, source: b.source, meters: b.meters.map((m) => ({ meterId: m.meter_id, weight: Number(m.weight) })), archetype: b.archetype, densityOverride: b.density_override_w_m2 == null ? null : Number(b.density_override_w_m2), updatedAt: b.updated_at } : null,
      summary: summaries.get(n.id) ?? null,
      vacant: isVacant(n),
      defaultDensity: DEFAULT_DENSITY_W_PER_M2[cat],
      defaultArchetype: CATEGORY_ARCHETYPE[cat],
    }
  })
  const assigned = new Set([...basis.values()].flatMap((b) => b.meters.map((m) => m.meter_id)))
  const { data: reg } = await supabase.schema('solar').from('meter_register').select('file_name, shop_no, tenant_name, serial, match_method, confirmed_at').eq('organisation_id', orgId).eq('kind', 'summary').limit(2000)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const meterById = new Map(meters.map((m) => [m.id, m]))
  const proposals: AutoMatchView[] = autoMatchMeters({
    meters: meters.map((m) => ({ meterId: m.id, label: m.label, kind: m.kind, serials: m.serials ?? [], shopNo: m.shop_no })),
    tenants: nodes.map((n) => ({ nodeId: n.id, shopNumber: n.shop_number, name: n.shop_name ?? n.name })),
    register: ((reg ?? []) as Array<{ file_name: string | null; shop_no: string | null; tenant_name: string | null; serial: string | null; match_method: 'exact' | 'llm' | 'unmapped' | 'manual' | 'none'; confirmed_at: string | null }>).map((r) => ({
      fileName: r.file_name, shopNo: r.shop_no, tenantName: r.tenant_name, serial: r.serial, matchMethod: r.match_method, confirmed: r.confirmed_at !== null,
    })),
    assignedMeterIds: assigned,
  }).map((p) => ({
    ...p, nodeLabel: tenantLabel(nodeById.get(p.nodeId) as TenantNodeRow), meterLabel: meterById.get(p.meterId)?.label ?? p.meterId,
  }))
  return {
    studyId: s?.id ?? null, studyUpdatedAt: s?.updated_at ?? null, commonAreaPct: s ? Number(s.common_area_pct) : 0,
    tenants, studyMeters: meters.map((m) => ({ id: m.id, label: m.label, kind: m.kind })), proposals,
  }
}

export async function loadProfileView(supabase: AnyClient, projectId: string): Promise<ProfileView> {
  const s = await study(supabase, projectId)
  const { form, bills } = loadSettingsFormFromRow(s as unknown as Record<string, unknown> | null)
  if (!s) return { studyId: null, studyUpdatedAt: null, form, bills, diversityApplies: true, years: [], siteLoad: null }
  const sl = await latestSiteLoad(supabase, s.id)
  const { meters, channels } = await studyMeters(supabase, s.id)
  const ids = meters.flatMap((m) => pickChannels(m, channels).primary.map((c) => c.id))
  const sums = await channelSummaries(supabase, ids)
  const years = new Set<number>()
  for (const x of sums.values()) {
    if (x.firstTs === null || x.lastTs === null) continue
    for (let y = new Date(x.firstTs).getUTCFullYear(); y <= new Date(x.lastTs).getUTCFullYear(); y++) years.add(y)
  }
  let stale = false
  if (sl) {
    const g = await gatherLoadInputs(supabase, projectId, { readReadings: false })
    stale = g.ok ? g.inputsHash !== sl.inputs_hash : false
  }
  const { data: metered } = await supabase.schema('solar').from('tenant_load_basis').select('id').eq('study_id', s.id).eq('source', 'metered').limit(1)
  const diversityApplies = sl ? sl.basis === 'S3' : form.loadBasis === 'S2' && !(Array.isArray(metered) && metered.length > 0)
  return {
    studyId: s.id, studyUpdatedAt: s.updated_at, form, bills, diversityApplies, years: [...years].sort(),
    siteLoad: sl ? {
      basis: sl.basis, referenceYear: sl.reference_year, builtAt: sl.built_at, stale,
      charts: siteProfileCharts(sl.series, sl.reference_year),
      coverage: sl.coverage, md: sl.md_monthly, designMdKw: sl.coverage.designMdKw ?? null,
      bulkRecon: sl.coverage.reconciliation?.bulk ?? [], parentRecon: sl.coverage.reconciliation?.parents ?? [],
    } : null,
  }
}

export async function loadChecksView(supabase: AnyClient, projectId: string): Promise<ChecksView> {
  const s = await study(supabase, projectId)
  if (!s) return { studyId: null, builtAt: null, checks: [], imports: [] }
  const sl = await latestSiteLoad(supabase, s.id)
  const { data: acks } = await supabase.schema('solar').from('load_check_acks').select('check_key, note, acknowledged_at').eq('study_id', s.id)
  const ackBy = new Map(((acks ?? []) as Array<{ check_key: string; note: string | null; acknowledged_at: string }>).map((a) => [a.check_key, { at: a.acknowledged_at, note: a.note }]))
  const order = { error: 0, warning: 1, info: 2 }
  const checks = (sl?.coverage.checks ?? [])
    .map((c) => ({ ...c, ack: ackBy.get(c.key) ?? null }))
    .sort((a, b) => order[a.severity] - order[b.severity])
  const { channels } = await studyMeters(supabase, s.id)
  const fileIds = [...new Set(channels.map((c) => c.file_id).filter((x): x is string => Boolean(x)))]
  const { data: files } = fileIds.length ? await supabase.schema('solar').from('meter_files').select('id, original_name, detected_format').in('id', fileIds) : { data: [] }
  const { data: reports } = fileIds.length ? await supabase.schema('solar').from('meter_import_reports').select('file_id, report, accepted_at, created_at').in('file_id', fileIds).order('created_at', { ascending: false }) : { data: [] }
  const latest = new Map<string, { report: { errors?: Array<{ code: string; message: string }>; warnings?: Array<{ code: string; message: string }> }; accepted_at: string | null }>()
  for (const r of (reports ?? []) as Array<{ file_id: string; report: never; accepted_at: string | null }>) if (!latest.has(r.file_id) && r.accepted_at) latest.set(r.file_id, r)
  return {
    studyId: s.id,
    builtAt: sl?.built_at ?? null,
    checks,
    imports: ((files ?? []) as Array<{ id: string; original_name: string; detected_format: string | null }>).map((f) => {
      const r = latest.get(f.id)
      return { fileId: f.id, fileName: f.original_name, format: f.detected_format, acceptedAt: r?.accepted_at ?? null, errors: r?.report.errors ?? [], warnings: r?.report.warnings ?? [] }
    }),
  }
}

/** For the gated layout's tab dots (spec §2.3). Cheap: no summaries, no readings; staleness is shown on the Site profile tab. */
export async function loadLoadReadiness(supabase: AnyClient, projectId: string): Promise<{ load: LoadReadinessInput | null; schematics: SchematicsReadinessInput | null }> {
  const s = await study(supabase, projectId)
  if (!s) return { load: null, schematics: null }
  const [sl, nodes, { data: basisRows }, { data: links }, { data: schematics }] = await Promise.all([
    latestSiteLoad(supabase, s.id),
    tenantNodes(supabase, projectId),
    supabase.schema('solar').from('tenant_load_basis').select('node_id').eq('study_id', s.id),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id),
    supabase.schema('solar').from('schematics').select('id').eq('study_id', s.id),
  ])
  const assigned = new Set(((basisRows ?? []) as Array<{ node_id: string }>).map((b) => b.node_id))
  const schematicIds = ((schematics ?? []) as Array<{ id: string }>).map((x) => x.id)
  const { data: cards } = schematicIds.length ? await supabase.schema('solar').from('schematic_cards').select('meter_id').in('schematic_id', schematicIds) : { data: [] }
  const studyMeterIds = new Set(((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id))
  const placed = new Set(((cards ?? []) as Array<{ meter_id: string }>).map((c) => c.meter_id).filter((id) => studyMeterIds.has(id)))
  return {
    load: {
      hasSiteLoad: sl !== null,
      stale: false,
      basis: sl?.basis ?? s.load_basis,
      fullYearFromData: sl?.coverage.fullYearFromData ?? false,
      unassignedTenants: nodes.filter((n) => !assigned.has(n.id)).length,
      totalTenants: nodes.length,
      // An accepted import cannot carry an error: commit refuses one (3a commit.ts `unresolved_errors`).
      failingAcceptedImports: 0,
    },
    schematics: { waived: s.schematic_waived, schematics: schematicIds.length, studyMeters: studyMeterIds.size, placedMeters: placed.size },
  }
}
```

- [ ] **Step 3: Run, type-check, commit**

```bash
pnpm --filter web test -- lib/solar/load/views 2>&1 | tail -4
pnpm --filter web type-check
git add apps/web/src/lib/solar/load/views.ts apps/web/src/lib/solar/load/views.test.ts
git commit -m "feat(solar): load sub-tab loaders and the readiness aggregate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (5 tests).

### Task 11: Chart primitives (SVG line and bars, canvas heatmap, PNG/CSV export)

**Files:**
- Create: `apps/web/src/components/charts/scale.ts` (+ `scale.test.ts`)
- Create: `apps/web/src/components/charts/palette.ts`
- Create: `apps/web/src/components/charts/export.ts`
- Create: `apps/web/src/components/charts/LineChart.tsx` (+ `LineChart.test.tsx`)
- Create: `apps/web/src/components/charts/BarChart.tsx` (+ `BarChart.test.tsx`)
- Create: `apps/web/src/components/charts/HeatmapCanvas.tsx` (+ `HeatmapCanvas.test.tsx`)
- Create: `apps/web/src/components/charts/ChartCard.tsx`

Load the `dataviz` skill before this task. Colours are fixed hex (not CSS variables) so a PNG export renders identically; they read on both themes. No `innerHTML` anywhere (spec 03 §5 rule 5): SVG is React-rendered and exported with `XMLSerializer`.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/components/charts/scale.test.ts
import { describe, it, expect } from 'vitest'
import { linear, niceTicks, formatNumber } from './scale'

describe('chart scale', () => {
  it('nice ticks cover the range with round steps', () => {
    expect(niceTicks(0, 87, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0.1, 0.43, 4)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
    expect(niceTicks(5, 5, 5)).toEqual([4, 4.5, 5, 5.5, 6])
  })
  it('linear maps domain to range', () => {
    const s = linear([0, 10], [100, 0])
    expect(s(0)).toBe(100)
    expect(s(5)).toBe(50)
    expect(s.invert(25)).toBe(7.5)
  })
  it('formats with thousands separators', () => {
    expect(formatNumber(87600)).toBe('87 600')
    expect(formatNumber(1.2345, 2)).toBe('1.23')
  })
})
```

```tsx
// apps/web/src/components/charts/LineChart.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LineChart } from './LineChart'

const series = [
  { key: 'a', label: 'Weekday', colour: '#2563eb', points: [{ x: 0, y: 1 }, { x: 1, y: null }, { x: 2, y: 3 }] },
  { key: 'b', label: 'Sunday', colour: '#d97706', points: [{ x: 0, y: 2 }, { x: 2, y: 2 }] },
]

describe('LineChart', () => {
  it('draws one path per visible series, breaking at null, and labels the unit', () => {
    const { container } = render(<LineChart title="Day types" series={series} yUnit="kW" xFormat={(x) => `${x}`} />)
    expect(container.querySelectorAll('path[data-series="a"]')).toHaveLength(1)
    expect(container.querySelector('path[data-series="a"]')?.getAttribute('d')).toMatch(/^M.*M/)
    expect(screen.getByText('kW')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Day types' })).toBeInTheDocument()
  })
  it('the legend toggles a series off and on', async () => {
    const { container } = render(<LineChart title="t" series={series} yUnit="kW" xFormat={(x) => `${x}`} />)
    await userEvent.click(screen.getByRole('button', { name: /Sunday/ }))
    expect(container.querySelector('path[data-series="b"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Sunday/ }))
    expect(container.querySelector('path[data-series="b"]')).not.toBeNull()
  })
  it('shades gaps and draws a min/max band', () => {
    const { container } = render(<LineChart title="t" yUnit="kW" xFormat={(x) => `${x}`} gaps={[{ from: 0.5, to: 1.5 }]}
      series={[{ ...series[0], band: [{ x: 0, lo: 0, hi: 2 }, { x: 2, lo: 2, hi: 4 }] }]} />)
    expect(container.querySelectorAll('rect[data-gap]')).toHaveLength(1)
    expect(container.querySelector('path[data-band="a"]')).not.toBeNull()
  })
})
```

```tsx
// apps/web/src/components/charts/BarChart.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart } from './BarChart'

describe('BarChart', () => {
  it('draws a bar per category per series with a hover title carrying the unit', () => {
    const { container } = render(<BarChart title="Monthly energy" yUnit="kWh" categories={['Jan', 'Feb']}
      series={[{ key: 'e', label: 'Energy', colour: '#2563eb', values: [100, 200] }]} />)
    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(2)
    expect(screen.getByText('Feb: 200 kWh')).toBeInTheDocument()
  })
})
```

```tsx
// apps/web/src/components/charts/HeatmapCanvas.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatmapCanvas } from './HeatmapCanvas'

describe('HeatmapCanvas', () => {
  it('renders a labelled canvas and the colour-scale range with its unit', () => {
    render(<HeatmapCanvas title="Heatmap" rows={['2025-03-10', '2025-03-11']} cells={[[1, 2], [null, 4]]} unit="kW" />)
    expect(screen.getByRole('img', { name: 'Heatmap' })).toBeInTheDocument()
    expect(screen.getByText('1 kW')).toBeInTheDocument()
    expect(screen.getByText('4 kW')).toBeInTheDocument()
    expect(screen.getByText(/No data/)).toBeInTheDocument()
  })
})
```

Run: `pnpm --filter web test -- components/charts` → FAIL.

- [ ] **Step 2: Implement `scale.ts`, `palette.ts`, `export.ts`**

```ts
// apps/web/src/components/charts/scale.ts
export interface LinearScale { (v: number): number; invert: (p: number) => number }

export function linear(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  const f = ((v: number) => r0 + (v - d0) * k) as LinearScale
  f.invert = (p: number) => (k === 0 ? d0 : d0 + (p - r0) / k)
  return f
}

/** Round tick values covering [min, max] with about `count` steps (1/2/5 × 10^n). */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [0, 1]
  if (min === max) { min -= 1; max += 1 }
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) as number
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export function formatNumber(v: number, dp = 0): string {
  const s = v.toFixed(dp)
  const [i, f] = s.split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return f ? `${grouped}.${f}` : grouped
}
```

```ts
// apps/web/src/components/charts/palette.ts
/** Fixed hex so PNG export matches the screen; chosen to read on light and dark themes. */
export const SERIES_COLOURS = ['#2563eb', '#d97706', '#0d9488', '#7c3aed', '#dc2626', '#64748b'] as const
export const AXIS_TEXT = '#64748b'
export const GRID = '#94a3b8'
export const GAP_FILL = '#94a3b8'
/** Sequential ramp for heatmaps (low → high). */
export const HEAT_LOW: [number, number, number] = [254, 243, 199]
export const HEAT_HIGH: [number, number, number] = [180, 83, 9]
export const HEAT_NULL = '#e2e8f0'

export function heatColour(t: number): string {
  const c = HEAT_LOW.map((lo, i) => Math.round(lo + (HEAT_HIGH[i] - lo) * Math.max(0, Math.min(1, t))))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
```

```ts
// apps/web/src/components/charts/export.ts
'use client'
/** Download helpers. No innerHTML: SVG is serialised with XMLSerializer and drawn to a canvas. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const vb = svg.viewBox.baseVal
  const w = vb && vb.width ? vb.width : svg.clientWidth || 800
  const h = vb && vb.height ? vb.height : svg.clientHeight || 300
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const src = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvasToPng(canvas)
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png failed'))), 'image/png'))
}

/** PNG of the first chart (svg, else canvas) inside `container`. */
export async function downloadChartPng(container: HTMLElement, filename: string): Promise<void> {
  const svg = container.querySelector('svg[data-chart]') as SVGSVGElement | null
  if (svg) return downloadBlob(await svgToPng(svg), filename)
  const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
  if (canvas) return downloadBlob(await canvasToPng(canvas), filename)
}
```

- [ ] **Step 3: Implement the three components and `ChartCard`**

```tsx
// apps/web/src/components/charts/LineChart.tsx
'use client'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { AXIS_TEXT, GAP_FILL, GRID } from './palette'
import { formatNumber, linear, niceTicks } from './scale'

export interface LinePoint { x: number; y: number | null }
export interface LineSeries {
  key: string
  label: string
  colour: string
  points: LinePoint[]
  band?: Array<{ x: number; lo: number | null; hi: number | null }>
}
export interface LineChartProps {
  title: string
  series: LineSeries[]
  yUnit: string
  xFormat: (x: number) => string
  height?: number
  gaps?: Array<{ from: number; to: number }>
  /** Drag across the plot to choose a range (the meter chart zooms with it). */
  onSelectRange?: (from: number, to: number) => void
}

const W = 800
const M = { l: 56, r: 12, t: 12, b: 28 }

function pathOf(pts: LinePoint[], x: (v: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  for (const p of pts) {
    if (p.y === null || !Number.isFinite(p.y)) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`
    pen = true
  }
  return d
}

export function LineChart({ title, series, yUnit, xFormat, height = 280, gaps = [], onSelectRange }: LineChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const visible = series.filter((s) => !hidden.has(s.key))

  const { xs, ys, xTicks, yTicks } = useMemo(() => {
    const allX = series.flatMap((s) => s.points.map((p) => p.x))
    const allY = visible.flatMap((s) => [...s.points.map((p) => p.y), ...(s.band ?? []).flatMap((b) => [b.lo, b.hi])]).filter((v): v is number => v !== null && Number.isFinite(v))
    const x0 = allX.length ? Math.min(...allX) : 0
    const x1 = allX.length ? Math.max(...allX) : 1
    const yt = niceTicks(allY.length ? Math.min(0, ...allY) : 0, allY.length ? Math.max(...allY) : 1, 5)
    const xsc = linear([x0, x1 === x0 ? x0 + 1 : x1], [M.l, W - M.r])
    const ysc = linear([yt[0], yt[yt.length - 1]], [height - M.b, M.t])
    const xt = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5)
    return { xs: xsc, ys: ysc, xTicks: xt, yTicks: yt }
  }, [series, visible, height])

  const toX = (e: MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect()
    const px = r && r.width > 0 ? ((e.clientX - r.left) / r.width) * W : M.l
    return xs.invert(Math.max(M.l, Math.min(W - M.r, px)))
  }
  const nearest = (s: LineSeries, x: number) => {
    let best: LinePoint | null = null
    for (const p of s.points) if (p.y !== null && (!best || Math.abs(p.x - x) < Math.abs(best.x - x))) best = p
    return best
  }

  return (
    <div>
      <svg
        ref={svgRef}
        data-chart
        role="img"
        aria-label={title}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        onMouseMove={(e) => { const x = toX(e); setHover(x); if (drag) setDrag({ ...drag, x1: x }) }}
        onMouseLeave={() => { setHover(null); setDrag(null) }}
        onMouseDown={(e) => { if (onSelectRange) { const x = toX(e); setDrag({ x0: x, x1: x }) } }}
        onMouseUp={() => {
          if (drag && onSelectRange && Math.abs(xs(drag.x1) - xs(drag.x0)) > 8) onSelectRange(Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1))
          setDrag(null)
        }}
      >
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeOpacity={0.3} />
            <text x={M.l - 6} y={ys(t) + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>{formatNumber(t, Math.abs(t) < 10 && t % 1 !== 0 ? 1 : 0)}</text>
          </g>
        ))}
        <text x={4} y={M.t + 4} fontSize={11} fill={AXIS_TEXT}>{yUnit}</text>
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={xs(t)} y={height - 8} fontSize={11} textAnchor={i === 0 ? 'start' : i === 5 ? 'end' : 'middle'} fill={AXIS_TEXT}>{xFormat(t)}</text>
        ))}
        {gaps.map((g, i) => (
          <rect key={`g${i}`} data-gap x={xs(g.from)} y={M.t} width={Math.max(1, xs(g.to) - xs(g.from))} height={height - M.t - M.b} fill={GAP_FILL} fillOpacity={0.18} />
        ))}
        {visible.map((s) => s.band && (
          <path key={`b${s.key}`} data-band={s.key} fill={s.colour} fillOpacity={0.18} stroke="none"
            d={(() => {
              const pts = s.band.filter((b) => b.lo !== null && b.hi !== null) as Array<{ x: number; lo: number; hi: number }>
              if (pts.length === 0) return ''
              const top = pts.map((b, i) => `${i ? 'L' : 'M'}${xs(b.x).toFixed(1)},${ys(b.hi).toFixed(1)}`).join('')
              const bottom = [...pts].reverse().map((b) => `L${xs(b.x).toFixed(1)},${ys(b.lo).toFixed(1)}`).join('')
              return `${top}${bottom}Z`
            })()} />
        ))}
        {visible.map((s) => <path key={s.key} data-series={s.key} d={pathOf(s.points, xs, ys)} fill="none" stroke={s.colour} strokeWidth={1.5} />)}
        {drag && <rect x={xs(Math.min(drag.x0, drag.x1))} y={M.t} width={Math.abs(xs(drag.x1) - xs(drag.x0))} height={height - M.t - M.b} fill="#2563eb" fillOpacity={0.1} />}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={M.t} y2={height - M.b} stroke={AXIS_TEXT} strokeDasharray="3 3" />}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 4 }}>
        {series.map((s) => (
          <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)}
            onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-mid)', opacity: hidden.has(s.key) ? 0.4 : 1 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.colour, display: 'inline-block' }} />{s.label}
          </button>
        ))}
        {hover !== null && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
            {xFormat(hover)} · {visible.map((s) => { const p = nearest(s, hover); return p && p.y !== null ? `${s.label} ${formatNumber(p.y, 2)} ${yUnit}` : null }).filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}
```

```tsx
// apps/web/src/components/charts/BarChart.tsx
'use client'
import { useState } from 'react'
import { AXIS_TEXT, GRID } from './palette'
import { formatNumber, linear, niceTicks } from './scale'

export interface BarSeries { key: string; label: string; colour: string; values: number[] }
const W = 800
const M = { l: 64, r: 12, t: 12, b: 28 }

export function BarChart({ title, categories, series, yUnit, height = 260 }: { title: string; categories: string[]; series: BarSeries[]; yUnit: string; height?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = series.filter((s) => !hidden.has(s.key))
  const yt = niceTicks(0, Math.max(1, ...visible.flatMap((s) => s.values)), 5)
  const ys = linear([0, yt[yt.length - 1]], [height - M.b, M.t])
  const band = (W - M.l - M.r) / Math.max(1, categories.length)
  const bw = (band * 0.8) / Math.max(1, visible.length)
  return (
    <div>
      <svg data-chart role="img" aria-label={title} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yt.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeOpacity={0.3} />
            <text x={M.l - 6} y={ys(t) + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>{formatNumber(t)}</text>
          </g>
        ))}
        <text x={4} y={M.t + 4} fontSize={11} fill={AXIS_TEXT}>{yUnit}</text>
        {categories.map((c, i) => (
          <g key={c}>
            <text x={M.l + band * i + band / 2} y={height - 8} fontSize={11} textAnchor="middle" fill={AXIS_TEXT}>{c}</text>
            {visible.map((s, k) => (
              <rect key={s.key} data-bar x={M.l + band * i + band * 0.1 + k * bw} y={ys(s.values[i] ?? 0)} width={bw} height={Math.max(0, ys(0) - ys(s.values[i] ?? 0))} fill={s.colour}>
                <title>{`${c}: ${formatNumber(s.values[i] ?? 0)} ${yUnit}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          {series.map((s) => (
            <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: hidden.has(s.key) ? 0.4 : 1, color: 'var(--c-text-mid)' }}>
              <span style={{ width: 10, height: 10, background: s.colour, display: 'inline-block', marginRight: 4 }} />{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

```tsx
// apps/web/src/components/charts/HeatmapCanvas.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { HEAT_NULL, heatColour } from './palette'
import { formatNumber } from './scale'

/** Rows (dates or months) × 24 hours on a canvas. Null cells are grey ("No data"). */
export function HeatmapCanvas({ title, rows, cells, unit, cellH }: { title: string; rows: string[]; cells: Array<Array<number | null>>; unit: string; cellH?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const values = cells.flat().filter((v): v is number => v !== null)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const ch = cellH ?? (rows.length > 60 ? 2 : 16)
  const cw = 24
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    cells.forEach((row, r) => row.forEach((v, c) => {
      ctx.fillStyle = v === null ? HEAT_NULL : heatColour(hi > lo ? (v - lo) / (hi - lo) : 0.5)
      ctx.fillRect(c * cw, r * ch, cw, ch)
    }))
  }, [cells, lo, hi, ch])
  return (
    <div>
      <canvas ref={ref} role="img" aria-label={title} width={24 * cw} height={Math.max(1, rows.length) * ch}
        style={{ width: '100%', maxWidth: 24 * cw, imageRendering: 'pixelated', display: 'block' }}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          if (b.width === 0) return
          const c = Math.floor(((e.clientX - b.left) / b.width) * 24)
          const r = Math.floor(((e.clientY - b.top) / b.height) * rows.length)
          const v = cells[r]?.[c]
          setHover(rows[r] === undefined ? null : `${rows[r]} ${String(c).padStart(2, '0')}:00 · ${v === null || v === undefined ? 'no data' : `${formatNumber(v, 2)} ${unit}`}`)
        }}
        onMouseLeave={() => setHover(null)} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, marginTop: 4, color: 'var(--c-text-mid)' }}>
        <span>{`${formatNumber(lo, Number.isInteger(lo) ? 0 : 1)} ${unit}`}</span>
        <span style={{ width: 120, height: 8, background: `linear-gradient(90deg, ${heatColour(0)}, ${heatColour(1)})` }} />
        <span>{`${formatNumber(hi, Number.isInteger(hi) ? 0 : 1)} ${unit}`}</span>
        <span><span style={{ width: 10, height: 10, background: HEAT_NULL, display: 'inline-block', marginRight: 4 }} />No data</span>
        {hover && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{hover}</span>}
      </div>
    </div>
  )
}
```

```tsx
// apps/web/src/components/charts/ChartCard.tsx
'use client'
import { useRef, useState, type ReactNode } from 'react'
import { downloadChartPng } from './export'

/** A titled chart with "Download PNG" (client) and "Download CSV" (a server route at full resolution). */
export function ChartCard({ title, pngName, csvHref, children }: { title: string; pngName: string; csvHref?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <section style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, background: 'var(--c-panel)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 12 }}>
          <button type="button" disabled={busy} onClick={async () => { if (!ref.current) return; setBusy(true); try { await downloadChartPng(ref.current, pngName) } finally { setBusy(false) } }}>
            {busy ? 'Preparing…' : 'Download PNG'}
          </button>
          {csvHref && <a href={csvHref} download>Download CSV</a>}
        </span>
      </header>
      <div ref={ref}>{children}</div>
    </section>
  )
}
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- components/charts 2>&1 | tail -4
git add apps/web/src/components/charts
git commit -m "feat(solar): in-house chart primitives — line with band and gaps, bars, heatmap, PNG/CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (8 tests). In the LineChart null test, series `a` has points y=1, null, 3 → path `M…M…` (the null breaks the pen).

### Task 12: Tab plumbing — sub-tabs, the rebuild hook, the load-basis bar

**Files:**
- Create: `apps/web/src/lib/solar/load/subtabs.ts` (+ `subtabs.test.ts`)
- Create: `apps/web/src/lib/solar/load/use-rebuild.ts` (+ `use-rebuild.test.ts`)
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/LoadSubTabs.tsx`
- Create: `…/load/_components/RebuildStatus.tsx`
- Create: `…/load/_components/LoadBasisBar.tsx` (+ `LoadBasisBar.test.tsx`)

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/lib/solar/load/subtabs.test.ts
import { describe, it, expect } from 'vitest'
import { loadHref, parseSubTab } from './subtabs'

describe('load sub-tabs', () => {
  it('defaults to meters and accepts known keys only', () => {
    expect(parseSubTab(undefined)).toBe('meters')
    expect(parseSubTab('profile')).toBe('profile')
    expect(parseSubTab(['checks'])).toBe('checks')
    expect(parseSubTab('nope')).toBe('meters')
  })
  it('builds hrefs', () => {
    expect(loadHref('p1', 'meters', { meter: 'm1' })).toBe('/projects/p1/solar/load?tab=meters&meter=m1')
  })
})
```

```ts
// apps/web/src/lib/solar/load/use-rebuild.test.ts
import { describe, it, expect } from 'vitest'
import { rebuildMessage } from './use-rebuild'

describe('rebuildMessage', () => {
  it('describes each stage', () => {
    expect(rebuildMessage({ type: 'progress', stage: 'reading', done: 3, total: 7 })).toBe('Reading meter data… 3 of 7 channels')
    expect(rebuildMessage({ type: 'progress', stage: 'building', done: 0, total: 1 })).toBe('Building the site profile…')
    expect(rebuildMessage({ type: 'progress', stage: 'saving', done: 0, total: 1 })).toBe('Saving…')
    expect(rebuildMessage({ type: 'done', siteLoadId: 'x', basis: 'S2', referenceYear: 2025, checks: 4 })).toBe('Site profile rebuilt — basis S2, reference year 2025, 4 checks to review.')
  })
})
```

```tsx
// apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/LoadBasisBar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn(async () => true) }))
vi.mock('@/actions/solar-load.actions', () => ({ saveLoadBasisAction: h.save }))
vi.mock('@/lib/solar/load/use-rebuild', async (orig) => ({
  ...(await orig<object>()),
  useRebuild: () => ({ state: { running: false, message: null, error: null, done: null }, run: h.run }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { LoadBasisBar } from './LoadBasisBar'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('LoadBasisBar', () => {
  it('saves the basis on the loaded version, then rebuilds', async () => {
    render(<LoadBasisBar projectId="p1" basis="S2" updatedAt="T0" canEdit hint={null} />)
    await userEvent.selectOptions(screen.getByLabelText('Load basis'), 'S4')
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', basis: 'S4', expectedUpdatedAt: 'T0' })
    expect(h.run).toHaveBeenCalled()
  })
  it('shows a stale refusal and does not rebuild', async () => {
    h.save.mockResolvedValue({ error: 'Someone else changed this — reload to see their version.' })
    render(<LoadBasisBar projectId="p1" basis="S2" updatedAt="T0" canEdit hint={null} />)
    await userEvent.selectOptions(screen.getByLabelText('Load basis'), 'S1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this')
    expect(h.run).not.toHaveBeenCalled()
  })
  it('a View user sees the basis as text, no control', () => {
    render(<LoadBasisBar projectId="p1" basis="S1" updatedAt="T0" canEdit={false} hint={null} />)
    expect(screen.queryByLabelText('Load basis')).toBeNull()
    expect(screen.getByText(/Bulk meter \(S1\)/)).toBeInTheDocument()
  })
})
```

Run: `pnpm --filter web test -- subtabs use-rebuild LoadBasisBar` → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/solar/load/subtabs.ts
export const LOAD_SUBTABS = [
  { key: 'meters', label: 'Meters' },
  { key: 'tenants', label: 'Tenants' },
  { key: 'profile', label: 'Site profile' },
  { key: 'checks', label: 'Checks' },
] as const
export type LoadSubTab = (typeof LOAD_SUBTABS)[number]['key']

export function parseSubTab(v: string | string[] | undefined): LoadSubTab {
  const s = Array.isArray(v) ? v[0] : v
  return (LOAD_SUBTABS.some((t) => t.key === s) ? s : 'meters') as LoadSubTab
}

export function loadHref(projectId: string, tab: LoadSubTab, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ tab, ...extra })
  return `/projects/${projectId}/solar/load?${q.toString()}`
}
```

```ts
// apps/web/src/lib/solar/load/use-rebuild.ts
'use client'
/** Drives POST …/site-load/rebuild and reports its NDJSON progress (spec §4.5 "Server job; shows progress"). */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseNdjson } from './ndjson'
import type { RebuildEvent } from './view-types'

export interface RebuildState {
  running: boolean
  message: string | null
  error: string | null
  done: { basis: string; referenceYear: number; checks: number } | null
}

export function rebuildMessage(e: RebuildEvent): string {
  if (e.type === 'error') return e.message
  if (e.type === 'done') return `Site profile rebuilt — basis ${e.basis}, reference year ${e.referenceYear}, ${e.checks} checks to review.`
  if (e.stage === 'reading') return e.total > 1 ? `Reading meter data… ${e.done} of ${e.total} channels` : 'Reading meter data…'
  return e.stage === 'building' ? 'Building the site profile…' : 'Saving…'
}

export function useRebuild(projectId: string) {
  const router = useRouter()
  const [state, setState] = useState<RebuildState>({ running: false, message: null, error: null, done: null })
  const run = useCallback(async (): Promise<boolean> => {
    setState({ running: true, message: 'Starting…', error: null, done: null })
    let ok = false
    try {
      const res = await fetch(`/api/projects/${projectId}/solar/site-load/rebuild`, { method: 'POST' })
      if (!res.ok || !res.body) {
        setState({ running: false, message: null, done: null, error: res.status === 403 ? 'You need Solar edit access to rebuild the profile.' : 'The site profile could not be built — try again.' })
        return false
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let rest = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseNdjson(rest, dec.decode(value, { stream: true }))
        rest = parsed.rest
        for (const e of parsed.events) {
          if (e.type === 'progress') setState((s) => ({ ...s, message: rebuildMessage(e) }))
          else if (e.type === 'error') setState({ running: false, message: null, done: null, error: e.message })
          else { ok = true; setState({ running: false, message: rebuildMessage(e), error: null, done: { basis: e.basis, referenceYear: e.referenceYear, checks: e.checks } }) }
        }
      }
      if (ok) router.refresh()
      else setState((s) => (s.error ? s : { running: false, message: null, done: null, error: 'The site profile could not be built — try again.' }))
    } catch {
      setState({ running: false, message: null, done: null, error: 'The site profile could not be built — check your connection and try again.' })
    }
    return ok
  }, [projectId, router])
  return { state, run }
}
```

```tsx
// …/load/_components/LoadSubTabs.tsx
import Link from 'next/link'
import { LOAD_SUBTABS, loadHref, type LoadSubTab } from '@/lib/solar/load/subtabs'

export function LoadSubTabs({ projectId, active }: { projectId: string; active: LoadSubTab }) {
  return (
    <nav aria-label="Load sections" style={{ display: 'flex', gap: 4, margin: '12px 0' }}>
      {LOAD_SUBTABS.map((t) => (
        <Link key={t.key} href={loadHref(projectId, t.key)} aria-current={t.key === active ? 'page' : undefined}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, textDecoration: 'none',
            background: t.key === active ? 'var(--c-amber-dim)' : 'transparent', color: t.key === active ? 'var(--c-text)' : 'var(--c-text-mid)' }}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
```

```tsx
// …/load/_components/RebuildStatus.tsx
'use client'
import type { RebuildState } from '@/lib/solar/load/use-rebuild'

export function RebuildStatus({ state }: { state: RebuildState }) {
  if (state.error) return <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '6px 0' }}>{state.error}</p>
  if (!state.message) return null
  return (
    <p role="status" aria-live="polite" style={{ fontSize: 13, color: 'var(--c-text-mid)', margin: '6px 0' }}>
      {state.running && <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, border: '2px solid var(--c-amber)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
      {state.message}
    </p>
  )
}
```

```tsx
// …/load/_components/LoadBasisBar.tsx
'use client'
/**
 * The ONE load-basis control (spec §4.2 "Load basis select at the top of the tab"). Changing it saves on
 * the loaded version (stale refused) and immediately rebuilds the site profile, because the basis
 * changes the series (spec §4.5 "Saving recomputes solar.site_load").
 */
import { useState } from 'react'
import { LOAD_BASIS_OPTIONS, type LoadBasisChoice } from '@esite/shared'
import { saveLoadBasisAction } from '@/actions/solar-load.actions'
import { useRebuild } from '@/lib/solar/load/use-rebuild'
import { RebuildStatus } from './RebuildStatus'

export function LoadBasisBar({ projectId, basis, updatedAt, canEdit, hint }: {
  projectId: string; basis: LoadBasisChoice | ''; updatedAt: string | null; canEdit: boolean; hint: string | null
}) {
  const [value, setValue] = useState<LoadBasisChoice | ''>(basis)
  const [version, setVersion] = useState(updatedAt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { state, run } = useRebuild(projectId)
  const label = LOAD_BASIS_OPTIONS.find((o) => o.value === value)?.label ?? 'Not chosen — Sum of tenants is used'

  if (!canEdit) {
    return <p style={{ fontSize: 13, margin: '8px 0' }}><strong>Load basis:</strong> {label}</p>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
      <label htmlFor="load-basis" style={{ fontSize: 13, fontWeight: 600 }}>Load basis</label>
      <select id="load-basis" value={value} disabled={saving || state.running}
        onChange={async (e) => {
          const next = e.target.value as LoadBasisChoice
          const prev = value
          setValue(next)
          setError(null)
          setSaving(true)
          const r = await saveLoadBasisAction({ projectId, basis: next, expectedUpdatedAt: version })
          setSaving(false)
          if ('error' in r) { setValue(prev); setError(r.error); return }
          setVersion(r.updatedAt)
          await run()
        }}>
        {value === '' && <option value="">Choose…</option>}
        {LOAD_BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {saving && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Saving…</span>}
      {hint && <span style={{ fontSize: 12, color: 'var(--c-amber)' }}>{hint}</span>}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13, width: '100%', margin: 0 }}>{error}</p>}
      <div style={{ width: '100%' }}><RebuildStatus state={state} /></div>
    </div>
  )
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- subtabs use-rebuild LoadBasisBar 2>&1 | tail -4
git add apps/web/src/lib/solar/load/subtabs.ts apps/web/src/lib/solar/load/subtabs.test.ts apps/web/src/lib/solar/load/use-rebuild.ts apps/web/src/lib/solar/load/use-rebuild.test.ts "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): load sub-tabs, streaming rebuild hook, the single load-basis control

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (6 tests).

### Task 13: Browser import client and "Upload meter files" (direct to Storage)

**Files:**
- Create: `apps/web/src/lib/solar/load/import-client.ts` (+ `import-client.test.ts`)
- Create: `…/load/_components/UploadMeterFiles.tsx` (+ `UploadMeterFiles.test.tsx`)

The browser uploads **directly to Storage** (`solar-meter-raw/<org>/<project>/<sha256>.<ext>`), never through a Vercel function (4.5 MB body cap), then calls the 3a register and parse routes.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/lib/solar/load/import-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitReview, parseFiles, rawPath, registerRawFile } from './import-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => { vi.restoreAllMocks() })

describe('import client', () => {
  it('builds the raw path from the sha and a lower-cased allowed extension', () => {
    expect(rawPath('o', 'p', 'a'.repeat(64), 'Shop 12.CSV')).toBe(`o/p/${'a'.repeat(64)}.csv`)
    expect(rawPath('o', 'p', 'a'.repeat(64), 'x.pdf')).toBeNull()
  })
  it('register: 201/200 ok, 409 names where the data lives', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(201, { fileId: 'f1', duplicate: false }))
    expect(await registerRawFile('p', 'o/p/x.csv', 'x.csv')).toEqual({ ok: true, fileId: 'f1', duplicate: false })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { error: 'duplicate_in_other_project', fileId: 'f9', meters: [{ meterId: 'm', label: 'Shop 7', siteLabel: 'YA' }] }))
    expect(await registerRawFile('p', 'o/p/x.csv', 'x.csv')).toEqual({ ok: false, error: 'duplicate_in_other_project', message: 'Same data as Shop 7 at YA — use Copy from org meter library.' })
  })
  it('parse: flattens reviews and keeps per-file failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { results: [{ fileId: 'f1', reviews: [{ fileId: 'f1' }] }, { fileId: 'f2', error: 'sha256_mismatch' }] }))
    const r = await parseFiles('p', ['f1', 'f2'])
    expect(r.reviews).toEqual([{ fileId: 'f1' }])
    expect(r.failed).toEqual([{ fileId: 'f2', message: 'The stored file does not match its fingerprint — upload it again.' }])
  })
  it('commit: maps an error code to its sentence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(409, { error: 'identity_conflict' }))
    expect(await commitReview('p', { mode: 'skip', fileId: 'f', reason: 'bad' })).toEqual({ ok: false, message: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.' })
  })
})
```

```tsx
// …/load/_components/UploadMeterFiles.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ ensure: vi.fn(), register: vi.fn(), parse: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ ensureSolarStudyAction: h.ensure }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), registerRawFile: h.register, parseFiles: h.parse }))

import { UploadMeterFiles } from './UploadMeterFiles'

const SHA = 'b'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  h.ensure.mockResolvedValue({ ok: true, studyId: 's1', updatedAt: 'T0' })
  h.register.mockResolvedValue({ ok: true, fileId: 'f1', duplicate: false })
  h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] })
})

describe('UploadMeterFiles', () => {
  it('uploads to <org>/<project>/<sha>.<ext>, registers, parses and hands the reviews over', async () => {
    const upload = vi.fn(async () => null)
    const onReviews = vi.fn()
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={onReviews} upload={upload} hash={async () => SHA} />)
    await userEvent.upload(screen.getByLabelText('Upload meter files'), new File(['date,p14\n'], 'Shop 12.csv', { type: 'text/csv' }))
    expect(upload).toHaveBeenCalledWith(`o1/p1/${SHA}.csv`, expect.any(File))
    expect(h.register).toHaveBeenCalledWith('p1', `o1/p1/${SHA}.csv`, 'Shop 12.csv')
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(onReviews).toHaveBeenCalledWith([{ fileId: 'f1' }])
  })
  it('refuses a wrong extension and an oversized file before uploading', async () => {
    const upload = vi.fn(async () => null)
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={vi.fn()} upload={upload} hash={async () => SHA} />)
    const big = new File(['x'], 'big.csv')
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
    await userEvent.upload(screen.getByLabelText('Upload meter files'), [new File(['x'], 'a.pdf'), big], { applyAccept: false })
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByText(/a\.pdf: only \.csv, \.txt, \.xlsx or \.xls/)).toBeInTheDocument()
    expect(screen.getByText(/big\.csv: larger than 50 MB/)).toBeInTheDocument()
  })
  it('shows the duplicate-elsewhere sentence', async () => {
    h.register.mockResolvedValue({ ok: false, error: 'duplicate_in_other_project', message: 'Same data as Shop 7 at YA — use Copy from org meter library.' })
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv" onReviews={vi.fn()} upload={async () => null} hash={async () => SHA} />)
    await userEvent.upload(screen.getByLabelText('Upload meter files'), new File(['x'], 'a.csv'))
    expect(await screen.findByText(/Same data as Shop 7 at YA/)).toBeInTheDocument()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement `import-client.ts`**

```ts
// apps/web/src/lib/solar/load/import-client.ts
'use client'
/** Browser half of the meter import: hash, raw path, and the 3a register / parse / commit routes. */
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { loadErrorMessage } from './messages'

export const METER_UPLOAD_RE = /\.(csv|txt|xlsx|xls)$/i
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function sha256OfBlob(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

export function rawPath(orgId: string, projectId: string, sha: string, fileName: string): string | null {
  const ext = fileName.match(METER_UPLOAD_RE)?.[1]?.toLowerCase()
  return ext ? `${orgId}/${projectId}/${sha}.${ext}` : null
}

async function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

export type RegisterResponse = { ok: true; fileId: string; duplicate: boolean } | { ok: false; error: string; message: string }

export async function registerRawFile(projectId: string, storagePath: string, originalName: string): Promise<RegisterResponse> {
  const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files`, { storagePath, originalName })
  if (status === 200 || status === 201) return { ok: true, fileId: String(json.fileId), duplicate: Boolean(json.duplicate) }
  if (status === 409 && json.error === 'duplicate_in_other_project') {
    const m = (json.meters as Array<{ label: string; siteLabel: string | null }> | undefined)?.[0]
    return { ok: false, error: 'duplicate_in_other_project', message: m ? `Same data as ${m.label}${m.siteLabel ? ` at ${m.siteLabel}` : ''} — use Copy from org meter library.` : loadErrorMessage('duplicate_in_other_project') }
  }
  const code = typeof json.error === 'string' ? json.error : 'commit_failed'
  return { ok: false, error: code, message: status === 403 ? 'You need Solar edit access to import.' : loadErrorMessage(code) }
}

export interface ParseOptionsInput { dateOrder?: 'DMY' | 'MDY' | 'YMD'; tsConvention?: 'begin' | 'end'; units?: Record<string, string>; areaM2?: number | null }

export async function parseFiles(projectId: string, fileIds: string[], options?: Record<string, ParseOptionsInput>): Promise<{ reviews: ReviewModel[]; failed: Array<{ fileId: string; message: string }> }> {
  const reviews: ReviewModel[] = []
  const failed: Array<{ fileId: string; message: string }> = []
  for (let i = 0; i < fileIds.length; i += 20) {
    const ids = fileIds.slice(i, i + 20)
    const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files/parse`, options ? { fileIds: ids, options } : { fileIds: ids })
    if (status !== 200) { for (const id of ids) failed.push({ fileId: id, message: loadErrorMessage(String(json.error ?? 'commit_failed')) }); continue }
    for (const r of (json.results as Array<{ fileId: string; reviews?: ReviewModel[]; error?: string }>)) {
      if (r.reviews) reviews.push(...r.reviews)
      else failed.push({ fileId: r.fileId, message: loadErrorMessage(r.error) })
    }
  }
  return { reviews, failed }
}

export type CommitResult = { ok: true; meterId?: string; meterLabel?: string; reusedMeter?: boolean; registerRows?: number; skipped?: boolean } | { ok: false; message: string }

export async function commitReview(projectId: string, body: Record<string, unknown>): Promise<CommitResult> {
  const { status, json } = await post(`/api/projects/${projectId}/solar/meter-files/commit`, body)
  if (status === 200) return { ok: true, ...(json as object) }
  return { ok: false, message: status === 403 ? 'You need Solar edit access to import.' : loadErrorMessage(String(json.error ?? 'commit_failed')) }
}
```

- [ ] **Step 3: Implement `UploadMeterFiles.tsx`**

```tsx
// …/load/_components/UploadMeterFiles.tsx
'use client'
/**
 * "Upload meter files" / "Import meter register" (spec §4.3): multi-file picker + drop zone. Each file is
 * hashed in the browser, uploaded DIRECTLY to Storage at <org>/<project>/<sha256>.<ext> (never through a
 * Vercel function), registered, then parsed server-side; the reviews go to the import dialog.
 */
import { useId, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureSolarStudyAction } from '@/actions/solar-load.actions'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { MAX_UPLOAD_BYTES, METER_UPLOAD_RE, parseFiles, rawPath, registerRawFile, sha256OfBlob } from '@/lib/solar/load/import-client'

type Uploader = (path: string, file: File) => Promise<string | null>

const defaultUpload: Uploader = async (path, file) => {
  const { error } = await createClient().storage.from('solar-meter-raw').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
  if (!error) return null
  return /exist|duplicate/i.test(error.message) ? null : 'The upload failed — try again.'
}

export function UploadMeterFiles({ projectId, orgId, label, accept, onReviews, upload = defaultUpload, hash = sha256OfBlob }: {
  projectId: string; orgId: string; label: string; accept: string; onReviews: (r: ReviewModel[]) => void
  upload?: Uploader; hash?: (f: File) => Promise<string>
}) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [over, setOver] = useState(false)

  async function handle(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    const out: string[] = []
    const ids: string[] = []
    const ensured = await ensureSolarStudyAction(projectId)
    if ('error' in ensured) { setLines([ensured.error]); setBusy(false); return }
    for (const f of files) {
      if (!METER_UPLOAD_RE.test(f.name)) { out.push(`${f.name}: only .csv, .txt, .xlsx or .xls meter exports can be imported.`); continue }
      if (f.size > MAX_UPLOAD_BYTES) { out.push(`${f.name}: larger than 50 MB.`); continue }
      out.push(`${f.name}: uploading…`)
      setLines([...out])
      const sha = await hash(f)
      const path = rawPath(orgId, projectId, sha, f.name) as string
      const upErr = await upload(path, f)
      if (upErr) { out[out.length - 1] = `${f.name}: ${upErr}`; continue }
      const reg = await registerRawFile(projectId, path, f.name)
      if (!reg.ok) { out[out.length - 1] = `${f.name}: ${reg.message}`; continue }
      ids.push(reg.fileId)
      out[out.length - 1] = `${f.name}: ${reg.duplicate ? 'already uploaded — reviewing again' : 'uploaded'}`
    }
    setLines([...out])
    if (ids.length > 0) {
      const parsed = await parseFiles(projectId, ids)
      for (const x of parsed.failed) out.push(x.message)
      setLines([...out])
      if (parsed.reviews.length > 0) onReviews(parsed.reviews)
    }
    setBusy(false)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void handle(Array.from(e.dataTransfer.files)) }}
      style={{ border: `1px dashed ${over ? 'var(--c-amber)' : 'var(--c-border)'}`, borderRadius: 8, padding: 10 }}
    >
      <label htmlFor={inputId} style={{ cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>{busy ? 'Working…' : label}</label>
      <input id={inputId} type="file" multiple accept={accept} disabled={busy} aria-label={label}
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void handle(fs) }}
        style={{ marginLeft: 8, fontSize: 12 }} />
      <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 8 }}>or drop files here · ≤ 50 MB each</span>
      {lines.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  )
}
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- import-client UploadMeterFiles 2>&1 | tail -4
git add apps/web/src/lib/solar/load/import-client.ts apps/web/src/lib/solar/load/import-client.test.ts "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/UploadMeterFiles.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/UploadMeterFiles.test.tsx"
git commit -m "feat(solar): direct-to-Storage meter upload, register and parse from the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (7 tests). `messages.ts` has no `server-only` import, so the client may use it.

### Task 14: Import review dialog (identity panel, validation summary, unit override, kind, tenant, accept/skip)

**Files:**
- Create: `…/load/_components/review-choices.ts` (+ `review-choices.test.ts`) — pure dialog state
- Create: `…/load/_components/ImportReviewDialog.tsx` (+ `ImportReviewDialog.test.tsx`)

- [ ] **Step 1: Failing tests for the pure state**

```ts
// …/load/_components/review-fixture.ts  (test fixture shared by two test files; not a test itself)
import type { ReviewModel } from '@/lib/solar/meter-import/review'

export function review(over: Partial<ReviewModel> = {}): ReviewModel {
  return {
    fileId: 'f1', fileName: 'SITE YA, SHOP 012, PEP, 120.csv', sheetName: null, reportId: 'r1', outcome: 'series', format: 'A',
    report: { format: 'A', formatLabel: 'A', periodStart: '2025-01-01T00:30:00Z', periodEnd: '2025-12-31T23:30:00Z', rowOrder: 'ascending', tsConvention: 'begin', dateOrder: 'DMY', dateOrderAmbiguous: false, intervalMin: 30, dailyInterval: false, duplicates: 0, twentyFourHundredRows: 0, calcShare: null, impliedWPerM2: null, errors: [], warnings: [], channels: [] } as never,
    hints: { site: 'SITE YA', shopNo: '012', label: 'PEP', areaM2: 120, serial: null, register: [] },
    channels: [{ column: 'p14', quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', storedUnit: 'kW', unitFromTable: true, suggestedUnit: null, intervalMin: 30, coverageOnly: false, isCumulative: false, isPrimaryDefault: true, completeness: 0.99, meanStored: 4, maxStored: 9, levelShiftSegments: 0 }],
    preview: [], identity: { sourceSerials: [], filenameSerial: null, conflicts: [], blocking: false }, registerRows: 0,
    choicesNeeded: [], blockingErrors: [], canAccept: true, ...over,
  }
}
```

```ts
// …/load/_components/review-choices.test.ts
import { describe, it, expect } from 'vitest'
import { acceptBlockers, buildCommitBody, guessKind, initialChoices } from './review-choices'
import { review } from './review-fixture'

const nodes = [{ id: 'n12', label: '12 · Pep', shopNumber: '12' }]

describe('review choices', () => {
  it('pre-fills label, a guessed kind, and the tenant by shop number', () => {
    const c = initialChoices(review(), nodes, null)
    expect(c).toMatchObject({ label: 'PEP', kind: 'tenant', nodeId: 'n12', areaM2: '120', primary: 'p14', include: { p14: true }, meterMode: 'new' })
    expect(guessKind('BULK METER')).toBe('bulk')
    expect(guessKind('SOLAR PLANT 360')).toBe('solar')
  })
  it('an identity conflict blocks until linked or overridden with a reason', () => {
    const r = review({ identity: { sourceSerials: ['S'], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as X.', meterId: 'mX' }], blocking: true } })
    const c = initialChoices(r, nodes, null)
    expect(acceptBlockers(r, c, false)).toContain('Resolve the identity conflict.')
    expect(acceptBlockers(r, { ...c, resolution: 'override', reason: 'ok' }, false)).toContain('Give a reason of at least 5 characters for the override.')
    expect(acceptBlockers(r, { ...c, resolution: 'override', reason: 'Different tenant, same CT' }, false)).toEqual([])
    expect(acceptBlockers(r, { ...c, resolution: 'link', meterMode: 'existing', existingMeterId: 'mX' }, false)).toEqual([])
  })
  it('unresolved choices and unapplied options block Accept', () => {
    const r = review({ canAccept: false, choicesNeeded: ['unknown_unit'] })
    expect(acceptBlockers(r, initialChoices(r, nodes, null), false)).toContain('Choose every unit the file does not state, then Re-run preview.')
    expect(acceptBlockers(review(), initialChoices(review(), nodes, null), true)).toContain('Re-run preview to apply your changes.')
    expect(acceptBlockers(review(), initialChoices(review(), nodes, null), false)).toEqual([])
  })
  it('builds the commit body for a new meter', () => {
    const r = review()
    const body = buildCommitBody(r, { ...initialChoices(r, nodes, null), siteLabel: 'YA' }, {})
    expect(body).toEqual({
      mode: 'series', fileId: 'f1',
      meter: { new: { label: 'PEP', kind: 'tenant', siteLabel: 'YA', shopNo: '012', areaM2: 120, areaSource: 'filename', nodeId: 'n12' } },
      identity: { resolution: 'none' },
      channels: [{ sourceColumn: 'p14', include: true, isPrimary: true }],
      options: {},
    })
  })
  it('edit mapping commits to the existing meter', () => {
    const r = review()
    const body = buildCommitBody(r, initialChoices(r, nodes, 'm1'), { tsConvention: 'end' })
    expect(body.meter).toEqual({ existingMeterId: 'm1' })
    expect(body.options).toEqual({ tsConvention: 'end' })
  })
})
```

Run: `pnpm --filter web test -- review-choices` → FAIL.

- [ ] **Step 2: Implement `review-choices.ts`**

```ts
// …/load/_components/review-choices.ts
import { normShop } from '@esite/shared/solar-load'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import type { ParseOptionsInput } from '@/lib/solar/load/import-client'
import type { MeterKind, NodeOption } from '@/lib/solar/load/view-types'

export interface Choices {
  dateOrder: '' | 'DMY' | 'MDY' | 'YMD'
  tsConvention: '' | 'begin' | 'end'
  units: Record<string, string>
  areaM2: string
  meterMode: 'new' | 'existing'
  existingMeterId: string
  label: string
  kind: MeterKind | ''
  siteLabel: string
  shopNo: string
  nodeId: string
  resolution: 'none' | 'link' | 'override'
  reason: string
  include: Record<string, boolean>
  primary: string
  skipReason: string
  registerSite: string
}

export function guessKind(label: string | null | undefined): MeterKind {
  const s = label ?? ''
  if (/\b(bulk|incomer)\b/i.test(s)) return 'bulk'
  if (/\bsolar\b|\bpv\b/i.test(s)) return 'solar'
  if (/\bgen(erator)?\b/i.test(s)) return 'generator'
  if (/\bcheck\b/i.test(s)) return 'check'
  if (/\bcouncil\b/i.test(s)) return 'council'
  if (/\bcommon\b/i.test(s)) return 'common'
  if (/\bvacant\b/i.test(s)) return 'vacant'
  return 'tenant'
}

export function initialChoices(r: ReviewModel, nodes: NodeOption[], editMeterId: string | null): Choices {
  const shop = normShop(r.hints.shopNo)
  const label = r.hints.label ?? r.fileName.replace(/\.[^.]+$/, '')
  return {
    dateOrder: '', tsConvention: '', units: {}, areaM2: r.hints.areaM2 == null ? '' : String(r.hints.areaM2),
    meterMode: editMeterId ? 'existing' : 'new', existingMeterId: editMeterId ?? '',
    label, kind: guessKind(label), siteLabel: r.hints.site ?? '', shopNo: r.hints.shopNo ?? '',
    nodeId: (shop ? nodes.find((n) => normShop(n.shopNumber) === shop)?.id : undefined) ?? '',
    resolution: 'none', reason: '',
    include: Object.fromEntries(r.channels.map((c) => [c.column, c.sourceUnit !== 'unknown'])),
    primary: r.channels.find((c) => c.isPrimaryDefault)?.column ?? '',
    skipReason: r.blockingErrors.length > 0 ? `Cannot import: ${r.report.errors.map((e) => e.message).join('; ')}`.slice(0, 480) : '',
    registerSite: r.hints.site ?? '',
  }
}

/** The options the user changed that the preview has not applied yet. */
export function optionsFrom(c: Choices): ParseOptionsInput {
  const o: ParseOptionsInput = {}
  if (c.dateOrder) o.dateOrder = c.dateOrder
  if (c.tsConvention) o.tsConvention = c.tsConvention
  if (Object.keys(c.units).length > 0) o.units = c.units
  const a = Number(c.areaM2)
  if (c.areaM2.trim() !== '' && Number.isFinite(a) && a > 0) o.areaM2 = a
  return o
}

/** Why Accept is disabled (empty = enabled). */
export function acceptBlockers(r: ReviewModel, c: Choices, optionsDirty: boolean): string[] {
  const out: string[] = []
  if (r.outcome !== 'series') return ['This file is not meter data.']
  if (r.blockingErrors.length > 0) return ['The file has errors that cannot be fixed here — skip it with the reason shown.']
  if (optionsDirty) out.push('Re-run preview to apply your changes.')
  else if (!r.canAccept) out.push('Choose every unit the file does not state, then Re-run preview.')
  if (c.meterMode === 'existing' ? !c.existingMeterId : !(c.label.trim() && c.kind)) out.push('Name the meter and choose its kind.')
  if (!c.primary || !c.include[c.primary]) out.push('Choose an included primary channel.')
  if (r.identity?.blocking) {
    if (c.resolution === 'none') out.push('Resolve the identity conflict.')
    if (c.resolution === 'override' && c.reason.trim().length < 5) out.push('Give a reason of at least 5 characters for the override.')
    if (c.resolution === 'link' && !(c.meterMode === 'existing' && c.existingMeterId)) out.push('Choose the existing meter to link to.')
  }
  return out
}

export function buildCommitBody(r: ReviewModel, c: Choices, applied: ParseOptionsInput): Record<string, unknown> {
  const area = Number(c.areaM2)
  const hasArea = c.areaM2.trim() !== '' && Number.isFinite(area) && area > 0
  const reg = r.hints.register.find((x) => x.areaM2 === area)
  const areaSource = !hasArea ? null
    : r.hints.areaM2 === area ? 'filename'
      : reg ? (reg.matchMethod === 'exact' || reg.matchMethod === 'manual' ? 'register_exact' : 'register_llm')
        : 'manual'
  return {
    mode: 'series',
    fileId: r.fileId,
    ...(r.sheetName ? { sheet: r.sheetName } : {}),
    meter: c.meterMode === 'existing'
      ? { existingMeterId: c.existingMeterId }
      : { new: { label: c.label.trim(), kind: c.kind, siteLabel: c.siteLabel.trim() || null, shopNo: c.shopNo.trim() || null, areaM2: hasArea ? area : null, areaSource, nodeId: c.nodeId || null } },
    identity: c.resolution === 'override' ? { resolution: 'override', reason: c.reason.trim() } : { resolution: c.resolution },
    channels: r.channels.map((ch) => ({ sourceColumn: ch.column, include: Boolean(c.include[ch.column]), isPrimary: ch.column === c.primary })),
    options: applied,
  }
}
```

- [ ] **Step 3: Failing dialog test**

```tsx
// …/load/_components/ImportReviewDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ commit: vi.fn(), parse: vi.fn() }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), commitReview: h.commit, parseFiles: h.parse }))

import { ImportReviewDialog } from './ImportReviewDialog'
import { review } from './review-fixture'

const nodes = [{ id: 'n12', label: '12 · Pep', shopNumber: '12' }]
beforeEach(() => { vi.clearAllMocks(); h.commit.mockResolvedValue({ ok: true, meterLabel: 'PEP' }) })

describe('ImportReviewDialog', () => {
  it('accepts a clean file and finishes', async () => {
    const onFinished = vi.fn()
    render(<ImportReviewDialog projectId="p1" reviews={[review()]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={onFinished} />)
    expect(screen.getByRole('region', { name: 'Validation summary' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Accept & import' }))
    expect(h.commit).toHaveBeenCalledWith('p1', expect.objectContaining({ mode: 'series', fileId: 'f1' }))
    expect(onFinished).toHaveBeenCalledWith({ imported: 1, skipped: 0, registers: 0 })
  })
  it('keeps Accept disabled until an identity conflict is overridden with a reason', async () => {
    const r = review({ identity: { sourceSerials: ['S'], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as Shop 7 at YA.', meterId: 'm7' }], blocking: true } })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    expect(screen.getByText('Same data as Shop 7 at YA.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept & import' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Override with reason'))
    await userEvent.type(screen.getByLabelText('Override reason'), 'Different tenant on the same CT')
    expect(screen.getByRole('button', { name: 'Accept & import' })).toBeEnabled()
  })
  it('a generic unit must be chosen and the preview re-run before Accept', async () => {
    const r = review({ canAccept: false, choicesNeeded: ['unknown_unit'], channels: [{ ...review().channels[0], sourceUnit: 'unknown', storedUnit: 'unknown', unitFromTable: false }] })
    h.parse.mockResolvedValue({ reviews: [review()], failed: [] })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('Unit for p14'), 'kWh')
    await userEvent.click(screen.getByRole('button', { name: 'Re-run preview' }))
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'], { f1: { units: { p14: 'kWh' }, areaM2: 120 } })
    expect(screen.getByRole('button', { name: 'Accept & import' })).toBeEnabled()
  })
  it('a file with errors offers Skip with the reason pre-filled', async () => {
    const r = review({ canAccept: false, blockingErrors: ['low_completeness'], report: { ...review().report, errors: [{ code: 'low_completeness', message: 'Only 31 % of intervals have data.' }] } as never })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Skip this file' }))
    expect(h.commit).toHaveBeenCalledWith('p1', { mode: 'skip', fileId: 'f1', reason: 'Cannot import: Only 31 % of intervals have data.' })
  })
  it('a meter register imports as a register', async () => {
    const r = review({ outcome: 'register', registerRows: 21, canAccept: false, channels: [] })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Import register (21 rows)' }))
    expect(h.commit).toHaveBeenCalledWith('p1', { mode: 'register', fileId: 'f1', siteLabel: 'SITE YA' })
  })
})
```

Run → FAIL.

- [ ] **Step 4: Implement the dialog**

```tsx
// …/load/_components/ImportReviewDialog.tsx
'use client'
/**
 * Import review dialog (functional spec §4.3), one step per parsed file/sheet: what the parser found,
 * the choices it needs (date order, time-label convention, units — never defaulted on the generic path),
 * the identity panel, the validation summary, the meter (kind, tenant), and Accept / Skip. The server
 * re-parses on commit; this dialog never parses anything itself.
 */
import { useMemo, useState } from 'react'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { commitReview, parseFiles, type ParseOptionsInput } from '@/lib/solar/load/import-client'
import { METER_KIND_OPTIONS, UNIT_OPTIONS, type MeterKind, type NodeOption } from '@/lib/solar/load/view-types'
import { acceptBlockers, buildCommitBody, initialChoices, optionsFrom, type Choices } from './review-choices'

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`)
const box = { border: '1px solid var(--c-border)', borderRadius: 6, padding: 10, marginTop: 10 } as const

export function ImportReviewDialog({ projectId, reviews, nodes, studyMeters, editMeterId, onClose, onFinished }: {
  projectId: string
  reviews: ReviewModel[]
  nodes: NodeOption[]
  studyMeters: Array<{ id: string; label: string; siteLabel: string | null }>
  editMeterId: string | null
  onClose: () => void
  onFinished: (s: { imported: number; skipped: number; registers: number }) => void
}) {
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<ReviewModel>(reviews[0])
  const [choices, setChoices] = useState<Choices>(() => initialChoices(reviews[0], nodes, editMeterId))
  // The pre-filled area (a file-name hint) counts as applied: it changes only the implied-density check,
  // so it must not force a re-run before the first Accept.
  const [applied, setApplied] = useState<ParseOptionsInput>(() => optionsFrom(initialChoices(reviews[0], nodes, editMeterId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tally, setTally] = useState({ imported: 0, skipped: 0, registers: 0 })
  const set = <K extends keyof Choices>(k: K, v: Choices[K]) => setChoices((c) => ({ ...c, [k]: v }))
  const optionsDirty = JSON.stringify(optionsFrom(choices)) !== JSON.stringify(applied)
  const blockers = useMemo(() => acceptBlockers(current, choices, optionsDirty), [current, choices, optionsDirty])
  const r = current.report
  const primaryCh = current.channels.find((c) => c.column === choices.primary)
  const conflictMeters = (current.identity?.conflicts ?? []).filter((c) => c.meterId).map((c) => ({ id: c.meterId as string, label: c.message }))

  function next(t: typeof tally) {
    setTally(t)
    if (index + 1 >= reviews.length) { onFinished(t); return }
    const n = reviews[index + 1]
    setIndex(index + 1)
    setCurrent(n)
    const init = initialChoices(n, nodes, editMeterId)
    setChoices(init)
    setApplied(optionsFrom(init))
    setError(null)
  }
  async function act(body: Record<string, unknown>, kind: 'imported' | 'skipped' | 'registers') {
    setBusy(true)
    setError(null)
    const res = await commitReview(projectId, body)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    next({ ...tally, [kind]: tally[kind] + 1 })
  }
  async function rerun() {
    setBusy(true)
    setError(null)
    const opts = optionsFrom(choices)
    const res = await parseFiles(projectId, [current.fileId], { [current.fileId]: opts })
    setBusy(false)
    const again = res.reviews.find((x) => x.sheetName === current.sheetName) ?? res.reviews[0]
    if (!again) { setError(res.failed[0]?.message ?? 'The preview could not be refreshed — try again.'); return }
    setCurrent(again)
    setApplied(opts)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Review meter import" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 920, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>{current.fileName}{current.sheetName ? ` — ${current.sheetName}` : ''}</h2>
          <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>File {index + 1} of {reviews.length}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>

        <section style={box} aria-label="Detected format">
          <p style={{ margin: 0, fontSize: 13 }}><strong>Format:</strong> {r.formatLabel} · delimiter {r.delimiter ?? '—'} · header row {r.headerRow ?? '—'} · row order {r.rowOrder ?? '—'} · interval {r.intervalMin ?? '—'} min{r.dailyInterval ? ' (daily file: coverage only, never load)' : ''}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}><strong>Period:</strong> {r.periodStart?.slice(0, 10) ?? '—'} → {r.periodEnd?.slice(0, 10) ?? '—'} · time labels: {r.tsConvention === 'begin' ? 'interval-beginning' : r.tsConvention === 'end' ? 'interval-ending' : 'not set'}{r.tsConventionSource === 'format' ? ' (fixed by the format)' : ''}</p>
          {(r.dateOrderAmbiguous || current.choicesNeeded.includes('ambiguous_date_order')) && (
            <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>Date order (must be confirmed){' '}
              <select aria-label="Date order" value={choices.dateOrder} onChange={(e) => set('dateOrder', e.target.value as Choices['dateOrder'])}>
                <option value="">Choose…</option><option value="DMY">Day/Month/Year</option><option value="MDY">Month/Day/Year</option><option value="YMD">Year-Month-Day</option>
              </select>
            </label>
          )}
          {current.choicesNeeded.includes('convention_required') && (
            <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>Time labels mark the{' '}
              <select aria-label="Time-label convention" value={choices.tsConvention} onChange={(e) => set('tsConvention', e.target.value as Choices['tsConvention'])}>
                <option value="">Choose…</option><option value="begin">start of each interval</option><option value="end">end of each interval</option>
              </select>
            </label>
          )}
        </section>

        {current.outcome === 'series' && (
          <section style={box} aria-label="Channels">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">Include</th><th align="left">Primary</th><th align="left">Column</th><th align="left">Quantity</th><th align="left">Direction</th><th align="left">Unit</th><th align="right">Completeness</th><th align="right">Max</th></tr></thead>
              <tbody>
                {current.channels.map((c) => {
                  const lagged = r.laggedChannels?.some((l) => l.column === c.column)
                  return (
                    <tr key={c.column}>
                      <td><input type="checkbox" aria-label={`Include ${c.column}`} checked={Boolean(choices.include[c.column])} onChange={(e) => set('include', { ...choices.include, [c.column]: e.target.checked })} /></td>
                      <td><input type="radio" name="primary" aria-label={`Primary ${c.column}`} disabled={lagged} checked={choices.primary === c.column} onChange={() => set('primary', c.column)} /></td>
                      <td>{c.column}{c.coverageOnly ? ' (daily)' : ''}{c.isCumulative ? ' (cumulative → interval)' : ''}</td>
                      <td>{c.quantity}</td>
                      <td>{c.direction}</td>
                      <td>
                        <select aria-label={`Unit for ${c.column}`} value={choices.units[c.column] ?? (c.sourceUnit === 'unknown' ? '' : c.sourceUnit)}
                          onChange={(e) => {
                            const unit = e.target.value
                            // Choosing a unit for a channel the parser could not type includes it (it was excluded only for want of a unit).
                            setChoices((s) => ({ ...s, units: { ...s.units, [c.column]: unit }, include: { ...s.include, [c.column]: true } }))
                          }}>
                          {c.sourceUnit === 'unknown' && !choices.units[c.column] && <option value="">Choose… {c.suggestedUnit ? `(maybe ${c.suggestedUnit})` : ''}</option>}
                          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {c.unitFromTable && !choices.units[c.column] && <span style={{ color: 'var(--c-text-dim)' }}> from the format</span>}
                      </td>
                      <td align="right">{pct(c.completeness)}</td>
                      <td align="right">{c.maxStored == null ? '—' : `${c.maxStored.toFixed(2)} ${c.storedUnit}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        {current.outcome === 'series' && (
          <section style={box} aria-label="Validation summary">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Validation summary</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, columns: 2 }}>
              <li>Completeness (primary): {pct(primaryCh?.completeness)}</li>
              <li>Longest gap: {r.channels.find((c) => c.column === choices.primary)?.stats.longestGapHours?.toFixed(1) ?? '—'} h</li>
              <li>Zero runs ≥ 6 h: {r.channels.find((c) => c.column === choices.primary)?.stats.zeroRunsOver6h ?? '—'}</li>
              <li>Negatives: {(() => { const s = r.channels.find((c) => c.column === choices.primary)?.stats; return s ? s.tinyNegatives + s.largeNegatives : '—' })()}</li>
              <li>Reset pairs: {r.channels.find((c) => c.column === choices.primary)?.stats.resetPairs ?? '—'}</li>
              <li>Spikes: {r.channels.find((c) => c.column === choices.primary)?.stats.spikes ?? '—'}</li>
              <li>Level shifts / scale segments: {primaryCh?.levelShiftSegments ?? 0}</li>
              <li>Rollovers: {r.channels.find((c) => c.column === choices.primary)?.stats.rollovers ?? '—'}</li>
              <li>Duplicate timestamps: {r.duplicates}</li>
              <li>“24:00” rows: {r.twentyFourHundredRows}</li>
              <li>Estimated (Calc) share: {pct(r.calcShare)}</li>
              <li>Implied density: {r.impliedWPerM2 ? `${r.impliedWPerM2.value.toFixed(1)} W/m² over ${r.impliedWPerM2.areaM2} m²${r.impliedWPerM2.outOfBand ? ' — outside 2–150 W/m²' : ''}` : '—'}</li>
            </ul>
            {r.warnings.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--c-amber)' }}>{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
          </section>
        )}

        {current.identity && (current.identity.conflicts.length > 0 || current.identity.sourceSerials.length > 0) && (
          <section style={box} aria-label="Identity">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Identity</h3>
            <p style={{ fontSize: 12, margin: 0 }}>Serial(s) in the file: {current.identity.sourceSerials.join(', ') || '—'}{current.identity.filenameSerial ? ` · file name says ${current.identity.filenameSerial}` : ''}</p>
            {current.identity.conflicts.map((c, i) => <p key={i} style={{ fontSize: 12, margin: '4px 0', color: '#b45309' }}>{c.message}</p>)}
            {current.identity.blocking && !editMeterId && (
              <fieldset style={{ border: 'none', padding: 0, fontSize: 13 }}>
                <label><input type="radio" name="res" checked={choices.resolution === 'link'} onChange={() => { set('resolution', 'link'); set('meterMode', 'existing'); set('existingMeterId', conflictMeters[0]?.id ?? '') }} /> Link to existing meter</label>{' '}
                <label><input type="radio" name="res" checked={choices.resolution === 'override'} onChange={() => { set('resolution', 'override'); set('meterMode', 'new') }} /> Override with reason</label>
                {choices.resolution === 'override' && (
                  <input aria-label="Override reason" value={choices.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Why this is a different meter" style={{ display: 'block', width: '100%', marginTop: 4 }} />
                )}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c-text-dim)' }}>Or skip the file below.</span>
              </fieldset>
            )}
          </section>
        )}

        {current.outcome === 'series' && !editMeterId && (
          <section style={box} aria-label="Meter">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Meter</h3>
            {choices.meterMode === 'existing' ? (
              <label style={{ fontSize: 13 }}>Existing meter{' '}
                <select aria-label="Existing meter" value={choices.existingMeterId} onChange={(e) => set('existingMeterId', e.target.value)}>
                  <option value="">Choose…</option>
                  {[...conflictMeters, ...studyMeters.map((m) => ({ id: m.id, label: `${m.label}${m.siteLabel ? ` (${m.siteLabel})` : ''}` }))].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 13 }}>
                <label>Label <input aria-label="Meter label" value={choices.label} onChange={(e) => set('label', e.target.value)} /></label>
                <label>Kind <select aria-label="Meter kind" value={choices.kind} onChange={(e) => set('kind', e.target.value as MeterKind)}>
                  <option value="">Choose…</option>{METER_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select></label>
                <label>Site <input aria-label="Site label" value={choices.siteLabel} onChange={(e) => set('siteLabel', e.target.value)} /></label>
                <label>Shop no. <input aria-label="Shop number" value={choices.shopNo} onChange={(e) => set('shopNo', e.target.value)} /></label>
                <label>Area (m²) <input aria-label="Area m2" inputMode="decimal" value={choices.areaM2} onChange={(e) => set('areaM2', e.target.value)} /></label>
                <label>Link to tenant <select aria-label="Link to tenant" value={choices.nodeId} onChange={(e) => set('nodeId', e.target.value)}>
                  <option value="">None</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select></label>
              </div>
            )}
            {choices.kind === 'bulk' && <p style={{ fontSize: 12, color: 'var(--c-amber)', margin: '6px 0 0' }}>A bulk meter is used as the site supply only after you confirm it is the point of supply (meter details, after the reconciliation is shown).</p>}
            {['solar', 'generator', 'check', 'water'].includes(choices.kind) && <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '6px 0 0' }}>This kind is never counted as load.</p>}
          </section>
        )}

        {current.outcome === 'register' && (
          <section style={box} aria-label="Meter register">
            <p style={{ fontSize: 13, margin: 0 }}>This file is a meter register (consolidation summary) with {current.registerRows} rows. Rows matched by an LLM or marked UNMAPPED are imported as unconfirmed and never applied automatically.</p>
            <label style={{ fontSize: 13 }}>Site <input aria-label="Register site" value={choices.registerSite} onChange={(e) => set('registerSite', e.target.value)} /></label>
          </section>
        )}

        {current.blockingErrors.length > 0 && (
          <section style={{ ...box, borderColor: '#dc2626' }} aria-label="Errors">
            <p style={{ fontSize: 13, margin: 0, color: '#dc2626' }}>This file cannot be imported:</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>{r.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </section>
        )}

        <section style={box} aria-label="Skip">
          <label style={{ fontSize: 13 }}>Reason to skip <input aria-label="Skip reason" value={choices.skipReason} onChange={(e) => set('skipReason', e.target.value)} style={{ width: '70%' }} /></label>
        </section>

        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {current.outcome === 'series' && blockers.length > 0 && <ul style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}

        <footer style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          {current.outcome === 'series' && optionsDirty && <button type="button" disabled={busy} onClick={rerun}>Re-run preview</button>}
          <button type="button" disabled={busy || choices.skipReason.trim().length < 3}
            onClick={() => act({ mode: 'skip', fileId: current.fileId, reason: choices.skipReason.trim() }, 'skipped')}>Skip this file</button>
          {current.outcome === 'register' && (
            <button type="button" disabled={busy} onClick={() => act({ mode: 'register', fileId: current.fileId, siteLabel: choices.registerSite.trim() || null }, 'registers')}>
              {`Import register (${current.registerRows} rows)`}
            </button>
          )}
          {current.outcome === 'series' && (
            <button type="button" disabled={busy || blockers.length > 0} onClick={() => act(buildCommitBody(current, choices, applied), 'imported')}>
              {busy ? 'Importing…' : 'Accept & import'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
```

(`ValidationReport.channels[].stats` carries `longestGapHours`, `zeroRunsOver6h`, `tinyNegatives`, `largeNegatives`, `resetPairs`, `spikes`, `rollovers` — `report.ts` `channelReport`.)

In the unit test the initial area is `'120'`, so `optionsFrom` yields `areaM2: 120`, which is why the re-run call carries it.

- [ ] **Step 5: Run, commit**

```bash
pnpm --filter web test -- review-choices ImportReviewDialog 2>&1 | tail -4
pnpm --filter web type-check
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/review-choices.ts" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/review-choices.test.ts" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/review-fixture.ts" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/ImportReviewDialog.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components/ImportReviewDialog.test.tsx"
git commit -m "feat(solar): meter import review dialog — identity, validation summary, units, kind, tenant, accept/skip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (10 tests).

### Task 15: Dropbox import dialog, copy from the org library, meter register panel

**Files:**
- Create: `…/load/_components/CloudImportDialog.tsx` (+ test)
- Create: `…/load/_components/LibraryCopyDialog.tsx` (+ test)
- Create: `…/load/_components/RegisterPanel.tsx` (+ test)

- [ ] **Step 1: Failing tests**

```tsx
// …/load/_components/CloudImportDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ parse: vi.fn() }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), parseFiles: h.parse }))
import { CloudImportDialog } from './CloudImportDialog'

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
beforeEach(() => { vi.restoreAllMocks(); h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] }) })

describe('CloudImportDialog', () => {
  it('lists the mapped folder, imports the ticked files and hands their reviews over', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ rootFolderId: 'root', rootPath: '/Meters', items: [{ id: 'd', name: 'Sub', type: 'folder' }, { id: 'a', name: 'a.csv', type: 'file', size: 10 }] }))
      .mockResolvedValueOnce(json({ results: [{ name: 'a.csv', fileId: 'f1', duplicate: false }] }))
    const onReviews = vi.fn()
    render(<CloudImportDialog projectId="p1" onReviews={onReviews} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByLabelText('a.csv'))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 file' }))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/p1/solar/cloud-files/import')
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ items: [{ id: 'a', name: 'a.csv' }] })
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(onReviews).toHaveBeenCalledWith([{ fileId: 'f1' }])
  })
  it('says so when the project has no mapped folder', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'no_mapping' }, 404))
    render(<CloudImportDialog projectId="p1" onReviews={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('no cloud folder mapped')
  })
})
```

```tsx
// …/load/_components/LibraryCopyDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ search: vi.fn(), link: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ searchLibraryMetersAction: h.search, linkLibraryMetersAction: h.link }))
import { LibraryCopyDialog } from './LibraryCopyDialog'

beforeEach(() => {
  vi.clearAllMocks()
  h.search.mockResolvedValue({ ok: true, meters: [{ id: 'm7', label: 'Shop 7', siteLabel: 'YA', kind: 'tenant', serials: ['S7'] }] })
  h.link.mockResolvedValue({ ok: true, linked: 1 })
})

describe('LibraryCopyDialog', () => {
  it('searches the org library and links the chosen meters (a reference, no copy of data)', async () => {
    const onLinked = vi.fn()
    render(<LibraryCopyDialog projectId="p1" onClose={vi.fn()} onLinked={onLinked} />)
    await userEvent.type(screen.getByLabelText('Search the org meter library'), 'shop{enter}')
    expect(h.search).toHaveBeenCalledWith({ projectId: 'p1', query: 'shop' })
    await userEvent.click(await screen.findByLabelText(/Shop 7/))
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 meter to this study' }))
    expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', meterIds: ['m7'] })
    expect(onLinked).toHaveBeenCalledWith(1)
  })
})
```

```tsx
// …/load/_components/RegisterPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ confirm: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/actions/solar-load.actions', () => ({ confirmRegisterRowAction: h.confirm }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { RegisterPanel } from './RegisterPanel'

const rows = [
  { id: 'r1', siteLabel: 'YA', fileName: 'a.csv', tenantName: 'Pep', shopNo: '12', areaM2: 120, matchMethod: 'llm', confirmed: false, fileImported: true },
  { id: 'r2', siteLabel: 'YA', fileName: 'b.csv', tenantName: 'Mr P', shopNo: '13', areaM2: null, matchMethod: 'exact', confirmed: false, fileImported: false },
]
beforeEach(() => vi.clearAllMocks())

describe('RegisterPanel', () => {
  it('marks LLM rows unconfirmed with a Confirm button, and files not yet imported', async () => {
    render(<RegisterPanel projectId="p1" rows={rows} canEdit />)
    expect(screen.getAllByRole('button', { name: /Confirm/ })).toHaveLength(1)
    expect(screen.getByText('file not yet imported')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Pep' }))
    expect(h.confirm).toHaveBeenCalledWith({ projectId: 'p1', rowId: 'r1' })
  })
  it('View users get no Confirm', () => {
    render(<RegisterPanel projectId="p1" rows={rows} canEdit={false} />)
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement the three components**

```tsx
// …/load/_components/CloudImportDialog.tsx
'use client'
/** "Import from Dropbox folder" (spec §4.3): browse the project's mapped folder, tick meter files, copy them into Solar storage, review. */
import { useCallback, useEffect, useState } from 'react'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { parseFiles } from '@/lib/solar/load/import-client'
import { loadErrorMessage } from '@/lib/solar/load/messages'

interface Item { id: string; name: string; type: 'file' | 'folder'; size: number | null }

export function CloudImportDialog({ projectId, onReviews, onClose }: { projectId: string; onReviews: (r: ReviewModel[]) => void; onClose: () => void }) {
  const [stack, setStack] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: 'Mapped folder' }])
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const folder = stack[stack.length - 1]

  const load = useCallback(async (folderId: string | null) => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/cloud-files${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`)
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(loadErrorMessage(body.error === 'no_mapping' ? 'no_mapping' : 'commit_failed')); return }
    setItems(body.items as Item[])
  }, [projectId])
  useEffect(() => { void load(folder.id) }, [folder.id, load])

  async function doImport() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/cloud-files/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [...picked].map(([id, name]) => ({ id, name })) }),
    })
    const body = await res.json().catch(() => ({ results: [] }))
    const ids: string[] = []
    const out: string[] = []
    for (const r of (body.results ?? []) as Array<{ name: string; fileId?: string; error?: string; meters?: Array<{ label: string; siteLabel: string | null }> }>) {
      if (r.error === 'duplicate_in_other_project') out.push(`${r.name}: Same data as ${r.meters?.[0]?.label ?? 'a meter'}${r.meters?.[0]?.siteLabel ? ` at ${r.meters[0].siteLabel}` : ''} — use Copy from org meter library.`)
      else if (r.error) out.push(`${r.name}: ${loadErrorMessage(r.error)}`)
      else if (r.fileId) ids.push(r.fileId)
    }
    if (ids.length > 0) {
      const parsed = await parseFiles(projectId, ids)
      out.push(...parsed.failed.map((f) => f.message))
      setNotes(out)
      setBusy(false)
      if (parsed.reviews.length > 0) onReviews(parsed.reviews)
      return
    }
    setNotes(out)
    setBusy(false)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Import from Dropbox folder" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Import from Dropbox folder</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>
        <nav aria-label="Folder path" style={{ fontSize: 12, margin: '8px 0' }}>
          {stack.map((f, i) => (
            <span key={`${f.id}-${i}`}>{i > 0 && ' / '}
              <button type="button" disabled={i === stack.length - 1} onClick={() => setStack(stack.slice(0, i + 1))} style={{ background: 'none', border: 'none', color: 'var(--c-amber)', cursor: 'pointer' }}>{f.name}</button>
            </span>
          ))}
        </nav>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {!error && items.length === 0 && !busy && <p style={{ fontSize: 13 }}>No meter files (.csv, .txt, .xlsx, .xls) in this folder.</p>}
        <ul style={{ listStyle: 'none', padding: 0, maxHeight: 360, overflow: 'auto', fontSize: 13 }}>
          {items.map((it) => (
            <li key={it.id} style={{ padding: '3px 0' }}>
              {it.type === 'folder' ? (
                <button type="button" onClick={() => setStack([...stack, { id: it.id, name: it.name }])} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>📁 {it.name}</button>
              ) : (
                <label><input type="checkbox" checked={picked.has(it.id)} disabled={!picked.has(it.id) && picked.size >= 20}
                  onChange={(e) => setPicked((p) => { const n = new Map(p); if (e.target.checked) n.set(it.id, it.name); else n.delete(it.id); return n })} /> {it.name}{it.size ? ` · ${(it.size / 1_048_576).toFixed(1)} MB` : ''}</label>
              )}
            </li>
          ))}
        </ul>
        {notes.length > 0 && <ul style={{ fontSize: 12 }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', alignSelf: 'center' }}>Up to 20 files at a time</span>
          <button type="button" disabled={busy || picked.size === 0} onClick={doImport}>{busy ? 'Working…' : `Import ${picked.size} file${picked.size === 1 ? '' : 's'}`}</button>
        </footer>
      </div>
    </div>
  )
}
```

```tsx
// …/load/_components/LibraryCopyDialog.tsx
'use client'
/** "Copy from org meter library" (spec §4.3): links a meter already imported for another study — a reference, no data copied. Same-org meters only (RLS + the action). */
import { useState } from 'react'
import { linkLibraryMetersAction, searchLibraryMetersAction, type LibraryMeterHit } from '@/actions/solar-load.actions'

export function LibraryCopyDialog({ projectId, onClose, onLinked }: { projectId: string; onClose: () => void; onLinked: (n: number) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<LibraryMeterHit[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="dialog" aria-modal="true" aria-label="Copy from org meter library" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Copy from org meter library</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true); setError(null)
          const r = await searchLibraryMetersAction({ projectId, query: q })
          setBusy(false)
          if ('error' in r) setError(r.error); else setHits(r.meters)
        }} style={{ margin: '8px 0' }}>
          <input aria-label="Search the org meter library" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Site, label or serial" style={{ width: '70%' }} />
          <button type="submit" disabled={busy}>Search</button>
        </form>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {hits !== null && hits.length === 0 && <p style={{ fontSize: 13 }}>No meters in your organisation's library match — upload the meter files instead.</p>}
        <ul style={{ listStyle: 'none', padding: 0, maxHeight: 360, overflow: 'auto', fontSize: 13 }}>
          {(hits ?? []).map((m) => (
            <li key={m.id}><label>
              <input type="checkbox" checked={picked.has(m.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })} />
              {' '}{m.label}{m.siteLabel ? ` · ${m.siteLabel}` : ''} · {m.kind}{m.serials.length ? ` · ${m.serials.join(', ')}` : ''}
            </label></li>
          ))}
        </ul>
        <footer style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy || picked.size === 0} onClick={async () => {
            setBusy(true); setError(null)
            const r = await linkLibraryMetersAction({ projectId, meterIds: [...picked] })
            setBusy(false)
            if ('error' in r) setError(r.error); else onLinked(r.linked)
          }}>{busy ? 'Adding…' : `Add ${picked.size} meter${picked.size === 1 ? '' : 's'} to this study`}</button>
        </footer>
      </div>
    </div>
  )
}
```

```tsx
// …/load/_components/RegisterPanel.tsx
'use client'
/** Meter register rows (spec §4.3 "Import meter register"): LLM / UNMAPPED matches are unconfirmed and never auto-applied. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmRegisterRowAction } from '@/actions/solar-load.actions'
import type { RegisterRowView } from '@/lib/solar/load/view-types'

export function RegisterPanel({ projectId, rows, canEdit }: { projectId: string; rows: RegisterRowView[]; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (rows.length === 0) return null
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Meter register ({rows.length} rows)</summary>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
        <thead><tr><th align="left">Site</th><th align="left">File</th><th align="left">Tenant</th><th align="left">Shop</th><th align="right">Area (m²)</th><th align="left">Match</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const untrusted = (r.matchMethod === 'llm' || r.matchMethod === 'unmapped') && !r.confirmed
            return (
              <tr key={r.id}>
                <td>{r.siteLabel ?? '—'}</td>
                <td>{r.fileName ?? '—'}{r.fileName && !r.fileImported && <span style={{ marginLeft: 6, color: 'var(--c-amber)' }}>file not yet imported</span>}</td>
                <td>{r.tenantName ?? '—'}</td>
                <td>{r.shopNo ?? '—'}</td>
                <td align="right">{r.areaM2 ?? '—'}</td>
                <td>{r.matchMethod.toUpperCase()}{r.confirmed ? ' · confirmed' : untrusted ? ' · unconfirmed' : ''}</td>
                <td>{canEdit && untrusted && (
                  <button type="button" disabled={busy === r.id} aria-label={`Confirm ${r.tenantName ?? r.fileName ?? 'row'}`} onClick={async () => {
                    setBusy(r.id); setError(null)
                    const res = await confirmRegisterRowAction({ projectId, rowId: r.id })
                    setBusy(null)
                    if ('error' in res) setError(res.error); else router.refresh()
                  }}>Confirm</button>
                )}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}
```

(`LibraryMeterHit` is exported from the actions module as a type; a `'use server'` file may export types.)

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- CloudImportDialog LibraryCopyDialog RegisterPanel 2>&1 | tail -4
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): Dropbox folder import, copy from the org meter library, register panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (5 tests). The register table is inside a closed `<details>`; Testing Library still finds the button (it is in the DOM).

### Task 16: Meters sub-tab — table, detail drawer (chart, heatmap, edit mapping, remove, CSV), panel

**Files:**
- Create: `…/load/_components/MeterSeriesChart.tsx`
- Create: `…/load/_components/MeterDrawer.tsx` (+ test)
- Create: `…/load/_components/MetersPanel.tsx` (+ test)

- [ ] **Step 1: Failing tests**

```tsx
// …/load/_components/MeterDrawer.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn(), parse: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ updateStudyMeterAction: h.update, removeStudyMeterAction: h.remove }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), parseFiles: h.parse }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./MeterSeriesChart', () => ({ MeterSeriesChart: () => <div>chart</div> }))
import { MeterDrawer } from './MeterDrawer'
import type { MeterView } from '@/lib/solar/load/view-types'

const meter: MeterView = {
  id: 'm1', label: 'Bulk', kind: 'bulk', siteLabel: 'YA', serials: [], nodeId: null, tenantLabel: null, shopNo: null, areaM2: null,
  supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: 'c1', intervalMin: 30, periodStart: null, periodEnd: null,
  completeness: 0.99, peakKw: 400, annualKwh: 1_000_000, fileIds: ['f1'], otherStudyLinks: 0, status: 'imported',
}
const base = { projectId: 'p1', nodes: [], canEdit: true, isGrantor: true, bulkRecon: [], onClose: vi.fn(), onEditMapping: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  h.update.mockResolvedValue({ ok: true, updatedAt: 'M1' })
  h.remove.mockResolvedValue({ ok: true, deletedFromLibrary: false })
  h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] })
})

describe('MeterDrawer', () => {
  it('confirming the point of supply is offered for a bulk meter and saved on the loaded version', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByLabelText(/This meter is the point of supply/))
    await userEvent.click(screen.getByRole('button', { name: 'Save meter' }))
    expect(h.update).toHaveBeenCalledWith({ projectId: 'p1', meterId: 'm1', patch: { supplyPointConfirmed: true }, expectedUpdatedAt: 'M0' })
  })
  it('remove is two-step; a grantor may also delete from the library', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByLabelText('Also delete from library'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove from study' }))
    expect(h.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(h.remove).toHaveBeenCalledWith({ projectId: 'p1', meterId: 'm1', alsoDeleteFromLibrary: true })
  })
  it('edit mapping re-parses the meter’s files for the review dialog', async () => {
    render(<MeterDrawer meter={meter} {...base} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit mapping' }))
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(base.onEditMapping).toHaveBeenCalledWith([{ fileId: 'f1' }], 'm1')
  })
  it('View level: chart, heatmap and CSV only', async () => {
    render(<MeterDrawer meter={meter} {...base} canEdit={false} />)
    expect(screen.getByRole('link', { name: 'Download normalised CSV' })).toHaveAttribute('href', '/api/projects/p1/solar/meters/m1/csv')
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.queryByRole('button', { name: 'Remove from study' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save meter' })).toBeNull()
  })
})
```

```tsx
// …/load/_components/MetersPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/actions/solar-load.actions', () => ({
  ensureSolarStudyAction: vi.fn(), searchLibraryMetersAction: vi.fn(), linkLibraryMetersAction: vi.fn(),
  confirmRegisterRowAction: vi.fn(), updateStudyMeterAction: vi.fn(), removeStudyMeterAction: vi.fn(),
}))
import { MetersPanel } from './MetersPanel'
import type { MetersView } from '@/lib/solar/load/view-types'

const view: MetersView = { studyId: 's1', orgId: 'o1', meters: [], nodes: [], register: [], cloudMapped: false, isGrantor: false, bulkRecon: [] }

describe('MetersPanel', () => {
  it('empty state names the actions that fill it; Dropbox hidden without a mapping', () => {
    render(<MetersPanel projectId="p1" view={view} canEdit openMeterId={null} />)
    expect(screen.getByText(/Upload meter exports or synthesise load from the tenant schedule/)).toBeInTheDocument()
    expect(screen.getByLabelText('Upload meter files')).toBeInTheDocument()
    expect(screen.getByLabelText('Import meter register')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import from Dropbox folder' })).toBeNull()
  })
  it('View users get the table only', () => {
    render(<MetersPanel projectId="p1" view={{ ...view, cloudMapped: true }} canEdit={false} openMeterId={null} />)
    expect(screen.queryByLabelText('Upload meter files')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy from org meter library' })).toBeNull()
  })
  it('lists meters with units on every number', () => {
    render(<MetersPanel projectId="p1" canEdit openMeterId={null} view={{ ...view, meters: [{
      id: 'm1', label: 'Pep', kind: 'tenant', siteLabel: 'YA', serials: [], nodeId: 'n1', tenantLabel: '12 · Pep', shopNo: '12', areaM2: null,
      supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: 'c1', intervalMin: 30, periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-12-31T23:30:00Z',
      completeness: 0.985, peakKw: 12.34, annualKwh: 87600, fileIds: ['f1'], otherStudyLinks: 0, status: 'imported' }] }} />)
    expect(screen.getByText('12.3 kW')).toBeInTheDocument()
    expect(screen.getByText('87 600 kWh')).toBeInTheDocument()
    expect(screen.getByText('98.5 %')).toBeInTheDocument()
    expect(screen.getByText('30 min')).toBeInTheDocument()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement `MeterSeriesChart.tsx`**

```tsx
// …/load/_components/MeterSeriesChart.tsx
'use client'
/** Meter drawer → Chart (spec §4.3): zoomable, full resolution when zoomed in, gaps shaded, channel toggle. Data comes from the series route. */
import { useEffect, useState } from 'react'
import { LineChart } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'

interface SeriesBody {
  channel: { id: string; unit: string; label: string }
  channels: Array<{ id: string; label: string; unit: string }>
  intervalMin: number
  extent: { first: number; last: number } | null
  window: { from: number; to: number } | null
  fullResolution: boolean
  buckets: Array<{ t0: number; t1: number; min: number | null; max: number | null; mean: number | null }>
  gaps: Array<{ from: number; to: number }>
}
const DAY = 86_400_000
const sast = (t: number, long: boolean) => new Date(t + 7_200_000).toISOString().slice(0, long ? 16 : 10).replace('T', ' ')

export function MeterSeriesChart({ projectId, meterId }: { projectId: string; meterId: string }) {
  const [channel, setChannel] = useState<string | null>(null)
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [body, setBody] = useState<SeriesBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams()
    if (channel) q.set('channel', channel)
    if (range) { q.set('from', new Date(range.from).toISOString()); q.set('to', new Date(range.to).toISOString()) }
    let cancelled = false
    fetch(`/api/projects/${projectId}/solar/meters/${meterId}/series?${q.toString()}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<SeriesBody> })
      .then((b) => { if (!cancelled) { setBody(b); setError(null) } })
      .catch(() => { if (!cancelled) setError('The chart could not be loaded — try again.') })
    return () => { cancelled = true }
  }, [projectId, meterId, channel, range])

  if (error) return <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>
  if (!body) return <p style={{ fontSize: 13 }}>Loading chart…</p>
  if (!body.extent) return <p style={{ fontSize: 13 }}>This channel has no readings.</p>
  const span = body.window ? body.window.to - body.window.from : 0
  const long = span <= 14 * DAY
  const x = (b: SeriesBody['buckets'][number]) => (b.t0 + b.t1) / 2
  const presets: Array<[string, number | null]> = [['All', null], ['Year', 365 * DAY], ['Month', 31 * DAY], ['Week', 7 * DAY]]
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
        {presets.map(([label, d]) => (
          <button key={label} type="button" onClick={() => setRange(d === null ? { from: body.extent!.first - 1, to: body.extent!.last } : { from: body.extent!.last - d, to: body.extent!.last })}>{label}</button>
        ))}
        <label style={{ marginLeft: 'auto' }}>Channel{' '}
          <select value={channel ?? body.channel.id} onChange={(e) => setChannel(e.target.value)}>
            {body.channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <LineChart
        title={`${body.channel.label} readings`}
        yUnit={body.channel.unit}
        xFormat={(t) => sast(t, long)}
        gaps={body.gaps}
        onSelectRange={(from, to) => setRange({ from, to })}
        series={[{
          key: 'v', label: body.fullResolution ? `${body.channel.label} (every reading)` : `${body.channel.label} (mean, min–max band)`, colour: SERIES_COLOURS[0],
          points: body.buckets.map((b) => ({ x: x(b), y: b.mean })),
          band: body.fullResolution ? undefined : body.buckets.map((b) => ({ x: x(b), lo: b.min, hi: b.max })),
        }]}
      />
      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }}>Drag across the chart to zoom. Times are SAST, interval ends. Shaded = no data.</p>
    </div>
  )
}
```

- [ ] **Step 3: Implement `MeterDrawer.tsx`**

```tsx
// …/load/_components/MeterDrawer.tsx
'use client'
/** Meter detail drawer (spec §4.3): Chart · Heatmap · Details (kind, tenant, area, point of supply, edit mapping, remove) · normalised CSV. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BulkReconciliation } from '@esite/shared/solar-load'
import { removeStudyMeterAction, updateStudyMeterAction, type MeterPatch } from '@/actions/solar-load.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { HeatmapCanvas } from '@/components/charts/HeatmapCanvas'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { parseFiles } from '@/lib/solar/load/import-client'
import { METER_KIND_OPTIONS, type MeterKind, type MeterView, type NodeOption } from '@/lib/solar/load/view-types'
import { MeterSeriesChart } from './MeterSeriesChart'

type Tab = 'chart' | 'heatmap' | 'details'

function Heatmap({ projectId, meterId }: { projectId: string; meterId: string }) {
  const [data, setData] = useState<{ dates: string[]; cells: Array<Array<number | null>>; unit: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/projects/${projectId}/solar/meters/${meterId}/heatmap`)
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.message ?? 'The heatmap could not be loaded — try again.'); setData(b) })
      .catch((e: Error) => setMsg(e.message))
  }, [projectId, meterId])
  if (msg) return <p role="alert" style={{ fontSize: 13 }}>{msg}</p>
  if (!data) return <p style={{ fontSize: 13 }}>Loading heatmap…</p>
  if (data.dates.length === 0) return <p style={{ fontSize: 13 }}>No readings in the last 12 months.</p>
  return <HeatmapCanvas title="Day × time-of-day heatmap (last 12 months)" rows={data.dates} cells={data.cells} unit={data.unit} />
}

export function MeterDrawer({ projectId, meter, nodes, canEdit, isGrantor, bulkRecon, onClose, onEditMapping }: {
  projectId: string; meter: MeterView; nodes: NodeOption[]; canEdit: boolean; isGrantor: boolean; bulkRecon: BulkReconciliation[]
  onClose: () => void; onEditMapping: (reviews: ReviewModel[], meterId: string) => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('chart')
  const [label, setLabel] = useState(meter.label)
  const [kind, setKind] = useState<MeterKind>(meter.kind)
  const [nodeId, setNodeId] = useState(meter.nodeId ?? '')
  const [area, setArea] = useState(meter.areaM2 == null ? '' : String(meter.areaM2))
  const [supply, setSupply] = useState(meter.supplyPointConfirmed)
  const [version, setVersion] = useState(meter.updatedAt)
  const [alsoLibrary, setAlsoLibrary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const remove = useArmedConfirm()
  const recon = bulkRecon.find((b) => b.meterId === meter.id)

  async function save() {
    const patch: MeterPatch = {}
    if (label !== meter.label) patch.label = label
    if (kind !== meter.kind) patch.kind = kind
    if (nodeId !== (meter.nodeId ?? '')) patch.nodeId = nodeId || null
    const a = area.trim() === '' ? null : Number(area)
    if (a !== meter.areaM2) patch.areaM2 = a
    if (supply !== meter.supplyPointConfirmed) patch.supplyPointConfirmed = supply
    if (Object.keys(patch).length === 0) { setMsg({ ok: true, text: 'Nothing changed.' }); return }
    setBusy(true)
    const r = await updateStudyMeterAction({ projectId, meterId: meter.id, patch, expectedUpdatedAt: version })
    setBusy(false)
    if ('error' in r) { setMsg({ ok: false, text: r.error }); return }
    setVersion(r.updatedAt)
    setMsg({ ok: true, text: 'Saved. Rebuild the site profile to use the change.' })
    router.refresh()
  }

  return (
    <aside aria-label={`Meter ${meter.label}`} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px, 100vw)', background: 'var(--c-bg)', borderLeft: '1px solid var(--c-border)', zIndex: 40, overflow: 'auto', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{meter.label}</h2>
        <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{meter.siteLabel ?? ''}</span>
        <a href={`/api/projects/${projectId}/solar/meters/${meter.id}/csv`} style={{ marginLeft: 'auto', fontSize: 12 }}>Download normalised CSV</a>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div role="tablist" style={{ display: 'flex', gap: 4, margin: '10px 0' }}>
        {(['chart', 'heatmap', 'details'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}>{t === 'chart' ? 'Chart' : t === 'heatmap' ? 'Heatmap' : 'Details'}</button>
        ))}
      </div>
      {tab === 'chart' && <MeterSeriesChart projectId={projectId} meterId={meter.id} />}
      {tab === 'heatmap' && <Heatmap projectId={projectId} meterId={meter.id} />}
      {tab === 'details' && (
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          {canEdit ? (
            <>
              <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
              <label>Kind <select value={kind} onChange={(e) => { setKind(e.target.value as MeterKind); if (e.target.value !== 'bulk') setSupply(false) }}>
                {METER_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select></label>
              <label>Link to tenant <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                <option value="">None</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select></label>
              <label>Area (m²) <input inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
            </>
          ) : (
            <p style={{ margin: 0 }}>Kind: {METER_KIND_OPTIONS.find((k) => k.value === meter.kind)?.label} · Tenant: {meter.tenantLabel ?? '—'} · Area: {meter.areaM2 == null ? '—' : `${meter.areaM2} m²`}</p>
          )}
          {kind === 'bulk' && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>Reconciliation: Σ metered tenants vs this meter</h3>
              {recon && recon.months.length > 0 ? (
                <table style={{ fontSize: 12, width: '100%' }}>
                  <thead><tr><th align="left">Month</th><th align="right">Bulk kWh</th><th align="right">Σ tenants kWh</th><th align="right">Tenants / bulk</th></tr></thead>
                  <tbody>{recon.months.map((m) => (
                    <tr key={m.month} style={{ color: m.flagged ? '#b45309' : undefined }}>
                      <td>{m.month}</td><td align="right">{Math.round(m.bulkKwh).toLocaleString('en-ZA')}</td><td align="right">{Math.round(m.tenantsKwh).toLocaleString('en-ZA')}</td>
                      <td align="right">{m.ratio === null ? '—' : `${Math.round(m.ratio * 100)} %`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p style={{ fontSize: 12, margin: 0 }}>Assign tenant meters and rebuild the site profile to see the reconciliation.</p>}
              {canEdit && (
                <label style={{ display: 'block', marginTop: 6 }}>
                  <input type="checkbox" checked={supply} onChange={(e) => setSupply(e.target.checked)} /> This meter is the point of supply (basis "Bulk meter" may use it)
                </label>
              )}
              {!canEdit && <p style={{ fontSize: 12, margin: '4px 0 0' }}>Point of supply: {meter.supplyPointConfirmed ? 'confirmed' : 'not confirmed'}</p>}
            </div>
          )}
          {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-text-mid)' : '#dc2626', margin: 0 }}>{msg.text}</p>}
          {canEdit && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" disabled={busy} onClick={save}>Save meter</button>
              <button type="button" disabled={busy || meter.fileIds.length === 0} onClick={async () => {
                setBusy(true)
                const r = await parseFiles(projectId, meter.fileIds)
                setBusy(false)
                if (r.reviews.length === 0) { setMsg({ ok: false, text: r.failed[0]?.message ?? 'The stored file could not be read.' }); return }
                onEditMapping(r.reviews, meter.id)
              }}>Edit mapping</button>
              {isGrantor && meter.otherStudyLinks === 0 && (
                <label><input type="checkbox" checked={alsoLibrary} onChange={(e) => setAlsoLibrary(e.target.checked)} /> Also delete from library</label>
              )}
              {!remove.armed ? (
                <button type="button" disabled={busy} onClick={remove.arm}>Remove from study</button>
              ) : (
                <button type="button" disabled={busy} style={{ color: '#dc2626' }} onClick={async () => {
                  remove.disarm()
                  setBusy(true)
                  const r = await removeStudyMeterAction({ projectId, meterId: meter.id, alsoDeleteFromLibrary: alsoLibrary })
                  setBusy(false)
                  if ('error' in r) { setMsg({ ok: false, text: r.error }); return }
                  router.refresh()
                  onClose()
                }}>Confirm remove</button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Implement `MetersPanel.tsx`**

```tsx
// …/load/_components/MetersPanel.tsx
'use client'
/** Meters sub-tab (spec §4.3): import controls (Edit), meters table, detail drawer, the review dialog. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { formatNumber } from '@/components/charts/scale'
import { METER_KIND_OPTIONS, type MetersView } from '@/lib/solar/load/view-types'
import { CloudImportDialog } from './CloudImportDialog'
import { ImportReviewDialog } from './ImportReviewDialog'
import { LibraryCopyDialog } from './LibraryCopyDialog'
import { MeterDrawer } from './MeterDrawer'
import { RegisterPanel } from './RegisterPanel'
import { UploadMeterFiles } from './UploadMeterFiles'

const day = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 7_200_000).toISOString().slice(0, 10) : '—')

export function MetersPanel({ projectId, view, canEdit, openMeterId }: { projectId: string; view: MetersView; canEdit: boolean; openMeterId: string | null }) {
  const router = useRouter()
  const [reviews, setReviews] = useState<{ list: ReviewModel[]; editMeterId: string | null } | null>(null)
  const [dialog, setDialog] = useState<'cloud' | 'library' | null>(null)
  const [selected, setSelected] = useState<string | null>(openMeterId)
  const [notice, setNotice] = useState<string | null>(null)
  const meter = view.meters.find((m) => m.id === selected) ?? null

  return (
    <div>
      {canEdit && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <UploadMeterFiles projectId={projectId} orgId={view.orgId} label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={(list) => setReviews({ list, editMeterId: null })} />
          <UploadMeterFiles projectId={projectId} orgId={view.orgId} label="Import meter register" accept=".csv" onReviews={(list) => setReviews({ list, editMeterId: null })} />
          <div style={{ display: 'flex', gap: 8 }}>
            {view.cloudMapped && <button type="button" onClick={() => setDialog('cloud')}>Import from Dropbox folder</button>}
            <button type="button" onClick={() => setDialog('library')}>Copy from org meter library</button>
          </div>
        </div>
      )}
      {notice && <p role="status" style={{ fontSize: 13 }}>{notice}</p>}
      {view.meters.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>No meters in this study yet. Upload meter exports or synthesise load from the tenant schedule (Tenants).</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr>
              <th align="left">Label</th><th align="left">Kind</th><th align="left">Tenant</th><th align="left">Period</th><th align="right">Interval</th>
              <th align="right">Completeness</th><th align="right">Peak (interval max)</th><th align="right">Annual energy</th><th align="left">Status</th>
            </tr></thead>
            <tbody>
              {view.meters.map((m) => (
                <tr key={m.id} onClick={() => setSelected(m.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--c-border)' }}>
                  <td><button type="button" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--c-amber)', cursor: 'pointer' }}>{m.label}</button></td>
                  <td>{METER_KIND_OPTIONS.find((k) => k.value === m.kind)?.label}{m.kind === 'bulk' && m.supplyPointConfirmed ? ' · point of supply' : ''}</td>
                  <td>{m.tenantLabel ?? '—'}</td>
                  <td>{day(m.periodStart)} → {day(m.periodEnd)}</td>
                  <td align="right">{m.intervalMin == null ? '—' : `${m.intervalMin} min`}</td>
                  <td align="right">{m.completeness == null ? '—' : `${(m.completeness * 100).toFixed(1)} %`}</td>
                  <td align="right">{m.peakKw == null ? '—' : `${m.peakKw.toFixed(1)} kW`}</td>
                  <td align="right">{m.annualKwh == null ? '—' : `${formatNumber(m.annualKwh)} kWh`}</td>
                  <td>{m.status === 'imported' ? 'Imported' : 'No data'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RegisterPanel projectId={projectId} rows={view.register} canEdit={canEdit} />
      {meter && (
        <MeterDrawer projectId={projectId} meter={meter} nodes={view.nodes} canEdit={canEdit} isGrantor={view.isGrantor} bulkRecon={view.bulkRecon}
          onClose={() => setSelected(null)} onEditMapping={(list, editMeterId) => { setSelected(null); setReviews({ list, editMeterId }) }} />
      )}
      {dialog === 'cloud' && <CloudImportDialog projectId={projectId} onClose={() => setDialog(null)} onReviews={(list) => { setDialog(null); setReviews({ list, editMeterId: null }) }} />}
      {dialog === 'library' && <LibraryCopyDialog projectId={projectId} onClose={() => setDialog(null)} onLinked={(n) => { setDialog(null); setNotice(`${n} meter(s) added to this study. Rebuild the site profile to use them.`); router.refresh() }} />}
      {reviews && (
        <ImportReviewDialog projectId={projectId} reviews={reviews.list} nodes={view.nodes}
          studyMeters={view.meters.map((m) => ({ id: m.id, label: m.label, siteLabel: m.siteLabel }))} editMeterId={reviews.editMeterId}
          onClose={() => { setReviews(null); router.refresh() }}
          onFinished={(s) => { setReviews(null); setNotice(`Imported ${s.imported}, registers ${s.registers}, skipped ${s.skipped}. Rebuild the site profile to use new data.`); router.refresh() }} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run, commit**

```bash
pnpm --filter web test -- MeterDrawer MetersPanel 2>&1 | tail -4
pnpm --filter web type-check
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): meters table and detail drawer (chart, heatmap, mapping, point of supply, remove, CSV)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (7 tests).

### Task 17: Tenants sub-tab — sources, weighted meters, density, archetype, auto-match, exclude vacant, common area

**Files:**
- Create: `…/load/_components/AssignMetersDialog.tsx`
- Create: `…/load/_components/AutoMatchDialog.tsx`
- Create: `…/load/_components/TenantsPanel.tsx` (+ `TenantsPanel.test.tsx`)

- [ ] **Step 1: Failing test**

```tsx
// …/load/_components/TenantsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), vacant: vi.fn(), common: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ saveTenantBasisAction: h.save, applyAutoMatchAction: h.apply, excludeVacantAction: h.vacant, saveCommonAreaAction: h.common }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { TenantsPanel } from './TenantsPanel'
import type { TenantsView } from '@/lib/solar/load/view-types'

const view: TenantsView = {
  studyId: 's1', studyUpdatedAt: 'T0', commonAreaPct: 5,
  tenants: [
    { nodeId: 'n1', shopNumber: '12', name: 'Pep', category: 'standard', areaM2: 100, boDate: '2026-05-02', basis: null, summary: null, vacant: false, defaultDensity: 25, defaultArchetype: 'retail' },
    { nodeId: 'n2', shopNumber: '13', name: 'VACANT', category: null, areaM2: 50, boDate: null, basis: null, summary: null, vacant: true, defaultDensity: 25, defaultArchetype: 'retail' },
  ],
  studyMeters: [{ id: 'm1', label: 'Pep meter', kind: 'tenant' }],
  proposals: [
    { nodeId: 'n1', nodeLabel: '12 · Pep', meterId: 'm1', meterLabel: 'Pep meter', source: 'register', confidence: 'low', preTicked: false, note: 'Meter register row matched by an LLM — check before applying' },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({ ok: true, updatedAt: 'B1' })
  h.apply.mockResolvedValue({ ok: true, applied: 1 })
  h.vacant.mockResolvedValue({ ok: true, count: 1 })
})

describe('TenantsPanel', () => {
  it('Metered needs at least one meter; assigning meters with a weight saves them', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    const row = screen.getByRole('row', { name: /Pep/ })
    expect(within(row).getByRole('option', { name: 'Metered' })).toBeDisabled()
    await userEvent.click(within(row).getByRole('button', { name: 'Assign meters' }))
    await userEvent.click(screen.getByLabelText('Pep meter'))
    await userEvent.clear(screen.getByLabelText('Weight for Pep meter'))
    await userEvent.type(screen.getByLabelText('Weight for Pep meter'), '0')
    expect(screen.getByText('Every weight must be greater than 0.')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Weight for Pep meter'))
    await userEvent.type(screen.getByLabelText('Weight for Pep meter'), '0.5')
    await userEvent.click(screen.getByRole('button', { name: 'Use these meters' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', nodeId: 'n1', source: 'metered', meters: [{ meterId: 'm1', weight: 0.5 }], archetype: null, densityOverride: null, expectedUpdatedAt: null })
  })
  it('auto-match never pre-ticks an LLM match and applies only ticked pairs', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-match meters' }))
    const box = screen.getByLabelText(/Pep meter → 12 · Pep/)
    expect(box).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Apply 0 pairs' })).toBeDisabled()
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Apply 1 pair' }))
    expect(h.apply).toHaveBeenCalledWith({ projectId: 'p1', pairs: [{ nodeId: 'n1', meterId: 'm1' }] })
  })
  it('exclude vacant is two-step and shows the count', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Exclude vacant (1)' }))
    expect(h.vacant).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Exclude 1 vacant tenant?' }))
    expect(h.vacant).toHaveBeenCalledWith({ projectId: 'p1', nodeIds: ['n2'] })
  })
  it('empty state points to the Tenant Schedule; View users see values, no controls', () => {
    const { unmount } = render(<TenantsPanel projectId="p1" view={{ ...view, tenants: [] }} canEdit />)
    expect(screen.getByText(/No tenants in the tenant schedule/)).toBeInTheDocument()
    unmount()
    render(<TenantsPanel projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Auto-match meters' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement the dialogs**

```tsx
// …/load/_components/AssignMetersDialog.tsx
'use client'
/** Assign meters to a tenant (spec §4.4): tenant series = Σ (weight × meter series) — summed, weighted, explicit. */
import { useState } from 'react'
import type { MeterKind } from '@/lib/solar/load/view-types'

const NOT_LOAD: MeterKind[] = ['solar', 'generator', 'check', 'water']

export function AssignMetersDialog({ tenantLabel, meters, initial, onUse, onClose }: {
  tenantLabel: string
  meters: Array<{ id: string; label: string; kind: MeterKind }>
  initial: Array<{ meterId: string; weight: number }>
  onUse: (m: Array<{ meterId: string; weight: number }>) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Map<string, string>>(new Map(initial.map((m) => [m.meterId, String(m.weight)])))
  const weights = [...picked.values()].map(Number)
  const bad = weights.some((w) => !(Number.isFinite(w) && w > 0))
  const sum = bad ? null : weights.reduce((a, b) => a + b, 0)
  const usable = meters.filter((m) => !NOT_LOAD.includes(m.kind))
  return (
    <div role="dialog" aria-modal="true" aria-label={`Assign meters to ${tenantLabel}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 520, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Meters for {tenantLabel}</h2>
        {usable.length === 0 && <p>No load meters in this study — import them on Meters.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {usable.map((m) => (
            <li key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <label style={{ flex: 1 }}><input type="checkbox" checked={picked.has(m.id)} onChange={(e) => setPicked((p) => { const n = new Map(p); if (e.target.checked) n.set(m.id, '1'); else n.delete(m.id); return n })} /> {m.label}</label>
              {picked.has(m.id) && (
                <input aria-label={`Weight for ${m.label}`} inputMode="decimal" value={picked.get(m.id)} style={{ width: 70 }}
                  onChange={(e) => setPicked((p) => new Map(p).set(m.id, e.target.value))} />
              )}
            </li>
          ))}
        </ul>
        <p style={{ margin: '6px 0' }}>{bad ? <span role="alert" style={{ color: '#dc2626' }}>Every weight must be greater than 0.</span> : `Sum of weights: ${sum?.toFixed(2)}`}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={bad || picked.size === 0} onClick={() => onUse([...picked].map(([meterId, w]) => ({ meterId, weight: Number(w) })))}>Use these meters</button>
        </div>
      </div>
    </div>
  )
}
```

```tsx
// …/load/_components/AutoMatchDialog.tsx
'use client'
/** Auto-match review (spec §4.4): proposals with confidence and source; the user ticks and applies. LLM/UNMAPPED rows never arrive pre-ticked. */
import { useState } from 'react'
import type { AutoMatchView } from '@/lib/solar/load/view-types'

export function AutoMatchDialog({ proposals, busy, error, onApply, onClose }: {
  proposals: AutoMatchView[]; busy: boolean; error: string | null
  onApply: (pairs: Array<{ nodeId: string; meterId: string }>) => void; onClose: () => void
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set(proposals.filter((p) => p.preTicked).map((p) => p.meterId)))
  const n = ticked.size
  return (
    <div role="dialog" aria-modal="true" aria-label="Auto-match meters" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Auto-match meters to tenants</h2>
        {proposals.length === 0 ? <p>No unassigned meter matches a tenant by register, serial, shop number or name.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: 420, overflow: 'auto' }}>
            {proposals.map((p) => (
              <li key={p.meterId} style={{ padding: '3px 0' }}>
                <label>
                  <input type="checkbox" checked={ticked.has(p.meterId)} onChange={(e) => setTicked((t) => { const s = new Set(t); if (e.target.checked) s.add(p.meterId); else s.delete(p.meterId); return s })} />
                  {' '}{p.meterLabel} → {p.nodeLabel}
                </label>
                <span style={{ marginLeft: 8, fontSize: 12, color: p.confidence === 'low' ? '#b45309' : 'var(--c-text-mid)' }}>{p.confidence} · {p.source.replace('_', ' ')} · {p.note}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" disabled={busy || n === 0} onClick={() => onApply(proposals.filter((p) => ticked.has(p.meterId)).map((p) => ({ nodeId: p.nodeId, meterId: p.meterId })))}>
            {busy ? 'Applying…' : `Apply ${n} pair${n === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement `TenantsPanel.tsx`**

```tsx
// …/load/_components/TenantsPanel.tsx
'use client'
/**
 * Tenants sub-tab (spec §4.4): one row per tenant from the tenant schedule (no separate tenant list).
 * Source, meters (weighted), density override, archetype; BO date read-only. Each row saves explicitly
 * on its loaded version; figures come from the last build.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { applyAutoMatchAction, excludeVacantAction, saveCommonAreaAction, saveTenantBasisAction } from '@/actions/solar-load.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { formatNumber } from '@/components/charts/scale'
import { ARCHETYPE_OPTIONS, type TenantRowView, type TenantsView } from '@/lib/solar/load/view-types'
import { AssignMetersDialog } from './AssignMetersDialog'
import { AutoMatchDialog } from './AutoMatchDialog'

type Source = 'metered' | 'synthesised' | 'excluded' | ''

function TenantRow({ projectId, t, meters, canEdit }: { projectId: string; t: TenantRowView; meters: TenantsView['studyMeters']; canEdit: boolean }) {
  const router = useRouter()
  const [source, setSource] = useState<Source>(t.basis?.source ?? '')
  const [assigned, setAssigned] = useState(t.basis?.meters ?? [])
  const [density, setDensity] = useState(t.basis?.densityOverride == null ? '' : String(t.basis.densityOverride))
  const [archetype, setArchetype] = useState(t.basis?.archetype ?? '')
  const [version, setVersion] = useState(t.basis?.updatedAt ?? null)
  const [assign, setAssign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const label = `${t.shopNumber ?? ''} ${t.name}`.trim()
  const meterLabels = assigned.map((a) => `${meters.find((m) => m.id === a.meterId)?.label ?? 'meter'}${a.weight !== 1 ? ` ×${a.weight}` : ''}`).join(', ')
  return (
    <tr aria-label={label} style={{ borderTop: '1px solid var(--c-border)' }}>
      <td>{t.shopNumber ?? '—'}</td>
      <td>{t.name}</td>
      <td>{t.category ?? '—'}</td>
      <td align="right">{t.areaM2 == null ? '—' : `${formatNumber(t.areaM2)} m²`}</td>
      <td>
        {canEdit ? (
          <select aria-label={`Source for ${label}`} value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="" disabled>Unassigned (synthesised)</option>
            <option value="metered" disabled={assigned.length === 0}>Metered</option>
            <option value="synthesised">Synthesised</option>
            <option value="excluded">Excluded</option>
          </select>
        ) : (source === '' ? 'Unassigned (synthesised)' : source[0].toUpperCase() + source.slice(1))}
      </td>
      <td>{meterLabels || '—'}{canEdit && <> <button type="button" onClick={() => setAssign(true)}>Assign meters</button></>}</td>
      <td>
        {canEdit ? <input aria-label={`Density for ${label}`} inputMode="decimal" placeholder={`${t.defaultDensity}`} value={density} onChange={(e) => setDensity(e.target.value)} style={{ width: 64 }} /> : density || t.defaultDensity}
        {' '}W/m²
      </td>
      <td>
        {canEdit ? (
          <select aria-label={`Archetype for ${label}`} value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            <option value="">Default ({ARCHETYPE_OPTIONS.find((a) => a.value === t.defaultArchetype)?.label})</option>
            {ARCHETYPE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        ) : (ARCHETYPE_OPTIONS.find((a) => a.value === (archetype || t.defaultArchetype))?.label)}
      </td>
      <td>{t.boDate ?? '—'}</td>
      <td align="right">{t.summary ? `${formatNumber(t.summary.annualKwh)} kWh` : '—'}</td>
      <td align="right">{t.summary?.wPerM2 == null ? '—' : `${t.summary.wPerM2.toFixed(1)} W/m²`}</td>
      <td align="right">{t.summary ? `${t.summary.peakKw.toFixed(1)} kW` : '—'}</td>
      <td>
        {canEdit && (
          <button type="button" disabled={busy || source === ''} onClick={async () => {
            const d = density.trim() === '' ? null : Number(density)
            setBusy(true); setMsg(null)
            const r = await saveTenantBasisAction({ projectId, nodeId: t.nodeId, source: source as Exclude<Source, ''>, meters: source === 'excluded' ? [] : assigned, archetype: archetype || null, densityOverride: d, expectedUpdatedAt: version })
            setBusy(false)
            if ('error' in r) { setMsg(r.error); return }
            setVersion(r.updatedAt)
            setMsg('Saved')
            router.refresh()
          }}>Save</button>
        )}
        {msg && <span role={msg === 'Saved' ? 'status' : 'alert'} style={{ marginLeft: 4, fontSize: 11, color: msg === 'Saved' ? 'var(--c-text-mid)' : '#dc2626' }}>{msg}</span>}
        {assign && (
          <AssignMetersDialog tenantLabel={label} meters={meters} initial={assigned} onClose={() => setAssign(false)}
            onUse={(m) => { setAssigned(m); setSource(m.length > 0 ? 'metered' : source === 'metered' ? 'synthesised' : source); setAssign(false) }} />
        )}
      </td>
    </tr>
  )
}

export function TenantsPanel({ projectId, view, canEdit }: { projectId: string; view: TenantsView; canEdit: boolean }) {
  const router = useRouter()
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [common, setCommon] = useState(String(view.commonAreaPct))
  const [commonVersion, setCommonVersion] = useState(view.studyUpdatedAt)
  const [notice, setNotice] = useState<string | null>(null)
  const vacant = view.tenants.filter((t) => t.vacant && t.basis?.source !== 'excluded')
  const confirmVacant = useArmedConfirm()

  if (view.tenants.length === 0) {
    return <p style={{ fontSize: 13 }}>No tenants in the tenant schedule — import one on the Tenant Schedule page, or use Bulk meter / Monthly bills basis.</p>
  }
  return (
    <div>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
          <button type="button" onClick={() => setAuto(true)}>Auto-match meters</button>
          {vacant.length > 0 && (!confirmVacant.armed
            ? <button type="button" onClick={confirmVacant.arm}>{`Exclude vacant (${vacant.length})`}</button>
            : <button type="button" style={{ color: '#dc2626' }} onClick={async () => {
                confirmVacant.disarm()
                setBusy(true); setError(null)
                const r = await excludeVacantAction({ projectId, nodeIds: vacant.map((t) => t.nodeId) })
                setBusy(false)
                if ('error' in r) setError(r.error); else { setNotice(`${r.count} vacant tenant(s) excluded.`); router.refresh() }
              }}>{`Exclude ${vacant.length} vacant tenant${vacant.length === 1 ? '' : 's'}?`}</button>)}
          <label style={{ marginLeft: 'auto' }}>Common-area allowance{' '}
            <input aria-label="Common-area allowance (%)" inputMode="decimal" value={common} onChange={(e) => setCommon(e.target.value)} style={{ width: 60 }} /> %
          </label>
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError(null)
            const r = await saveCommonAreaAction({ projectId, commonAreaPct: Number(common), expectedUpdatedAt: commonVersion })
            setBusy(false)
            if ('error' in r) setError(r.error); else { setCommonVersion(r.updatedAt); setNotice('Common-area allowance saved. Rebuild the site profile to use it.') }
          }}>Save allowance</button>
        </div>
      )}
      {!canEdit && <p style={{ fontSize: 13 }}>Common-area allowance: {view.commonAreaPct} %</p>}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {notice && <p role="status" style={{ fontSize: 13 }}>{notice}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr>
            <th align="left">Shop</th><th align="left">Name</th><th align="left">Category</th><th align="right">Area</th><th align="left">Source</th><th align="left">Meter(s)</th>
            <th align="left">Density</th><th align="left">Archetype</th><th align="left">BO date</th><th align="right">Annual energy</th><th align="right">Average</th><th align="right">Peak</th><th />
          </tr></thead>
          <tbody>{view.tenants.map((t) => <TenantRow key={t.nodeId} projectId={projectId} t={t} meters={view.studyMeters} canEdit={canEdit} />)}</tbody>
        </table>
      </div>
      {auto && (
        <AutoMatchDialog proposals={view.proposals} busy={busy} error={error} onClose={() => setAuto(false)} onApply={async (pairs) => {
          setBusy(true); setError(null)
          const r = await applyAutoMatchAction({ projectId, pairs })
          setBusy(false)
          if ('error' in r) { setError(r.error); return }
          setAuto(false)
          setNotice(`${r.applied} meter(s) assigned. Rebuild the site profile to use them.`)
          router.refresh()
        }} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- TenantsPanel 2>&1 | tail -4
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): tenants sub-tab — weighted meters, density, archetype, auto-match review, exclude vacant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (4 tests).

### Task 18: Site profile sub-tab — settings, bills, rebuild, KPI strip, five charts, reconciliation

**Files:**
- Create: `…/load/_components/SiteProfilePanel.tsx` (+ `SiteProfilePanel.test.tsx`)

- [ ] **Step 1: Failing test**

```tsx
// …/load/_components/SiteProfilePanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_BILLS_FORM } from '@esite/shared'
import { siteProfileCharts, HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn(async () => true) }))
vi.mock('@/actions/solar-load.actions', () => ({ saveLoadSettingsAction: h.save }))
vi.mock('@/lib/solar/load/use-rebuild', async (orig) => ({ ...(await orig<object>()), useRebuild: () => ({ state: { running: false, message: null, error: null, done: null }, run: h.run }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { SiteProfilePanel } from './SiteProfilePanel'
import type { ProfileView } from '@/lib/solar/load/view-types'

const charts = siteProfileCharts(new Float64Array(HOURS_PER_YEAR).fill(10), 2025)
const view: ProfileView = {
  studyId: 's1', studyUpdatedAt: 'T0', diversityApplies: false, years: [2024, 2025],
  form: { loadBasis: 'S2', referenceYear: '', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '' }, bills: EMPTY_BILLS_FORM,
  siteLoad: {
    basis: 'S2', referenceYear: 2025, builtAt: '2025-09-01T10:00:00Z', stale: true, charts, md: [], designMdKw: null,
    coverage: { window: null, commonShare: 1, meetsThreshold: true, metered: 3, synthesised: 1, excluded: 0, unassigned: 0, coveredByChildren: 0, shapeOnlyMeters: [], fullYearFromData: true, peakKw: 42.5, peakSource: 'interval', resolutionMin: 30 },
    bulkRecon: [{ meterId: 'b', label: 'Bulk', months: [{ month: 1, bulkKwh: 1000, tenantsKwh: 850, ratio: 0.85, flagged: true }] }], parentRecon: [],
  },
}
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('SiteProfilePanel', () => {
  it('shows the stale banner, the KPI strip with units and no rand, and the five charts', () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    expect(screen.getByText(/Inputs changed since this profile was built/)).toBeInTheDocument()
    expect(screen.getByText('87 600 kWh')).toBeInTheDocument()
    expect(screen.getByText('42.5 kW')).toBeInTheDocument()
    expect(screen.getByText('50 % / 50 %')).toBeInTheDocument()
    expect(screen.getByText(/Pin a tariff on the Tariff tab/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bR\s?\d/)
    for (const t of ['Annual (8,760 hours)', 'Average day by month', 'Weekday / Saturday / Sunday', 'Monthly energy', 'Load duration curve']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    }
    expect(screen.getByText('85 %')).toBeInTheDocument()
  })
  it('diversity is disabled for measured data with the reason', () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    expect(screen.getByLabelText('Diversity factor')).toBeDisabled()
    expect(screen.getByText('Measured data already reflects diversity')).toBeInTheDocument()
  })
  it('saves settings on the loaded version, then rebuilds', async () => {
    render(<SiteProfilePanel projectId="p1" view={view} canEdit />)
    await userEvent.selectOptions(screen.getByLabelText('Reference year'), '2024')
    await userEvent.click(screen.getByRole('button', { name: 'Save and rebuild' }))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', expectedUpdatedAt: 'T0', form: expect.objectContaining({ referenceYear: '2024' }) }))
    expect(h.run).toHaveBeenCalled()
  })
  it('an empty study says how to start; View has no save or rebuild', () => {
    render(<SiteProfilePanel projectId="p1" view={{ ...view, siteLoad: null }} canEdit={false} />)
    expect(screen.getByText(/No site profile yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rebuild/i })).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

```tsx
// …/load/_components/SiteProfilePanel.tsx
'use client'
/**
 * Site profile sub-tab (spec §4.5). Everything shown is derived on the server from the STORED series
 * (siteProfileCharts); this component only draws it. Rand values never appear on the Load tab.
 */
import { useState } from 'react'
import { MONTH_NAMES, type BillsForm, type LoadSettingsField, type LoadSettingsForm } from '@esite/shared'
import { saveLoadSettingsAction } from '@/actions/solar-load.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { useRebuild } from '@/lib/solar/load/use-rebuild'
import { ARCHETYPE_OPTIONS, type ProfileView } from '@/lib/solar/load/view-types'
import { BarChart } from '@/components/charts/BarChart'
import { ChartCard } from '@/components/charts/ChartCard'
import { HeatmapCanvas } from '@/components/charts/HeatmapCanvas'
import { LineChart } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import { formatNumber } from '@/components/charts/scale'
import { RebuildStatus } from './RebuildStatus'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DIVERSITY_REASON = 'Measured data already reflects diversity'

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 10px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

export function SiteProfilePanel({ projectId, view, canEdit }: { projectId: string; view: ProfileView; canEdit: boolean }) {
  const [form, setForm] = useState<LoadSettingsForm>(view.form)
  const [bills, setBills] = useState<BillsForm>(view.bills)
  const [version, setVersion] = useState(view.studyUpdatedAt)
  const [errors, setErrors] = useState<Partial<Record<LoadSettingsField, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { state, run } = useRebuild(projectId)
  useSolarDirtyGuard(dirty)
  const set = <K extends keyof LoadSettingsForm>(k: K, v: LoadSettingsForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true) }
  const sl = view.siteLoad
  const csv = (chart: string) => `/api/projects/${projectId}/solar/site-load/csv?chart=${chart}`
  const dayLabel = (x: number) => sl?.charts.annual[Math.max(0, Math.min(sl.charts.annual.length - 1, Math.round(x)))]?.day ?? ''

  async function save() {
    setBusy(true); setError(null); setErrors({})
    const r = await saveLoadSettingsAction({ projectId, form, bills, expectedUpdatedAt: version })
    setBusy(false)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    if ('error' in r) { setError(r.error); return }
    setVersion(r.updatedAt)
    setDirty(false)
    await run()
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section aria-label="Settings" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', fontSize: 13 }}>
        <label>Reference year<br />
          <select aria-label="Reference year" disabled={!canEdit} value={form.referenceYear} onChange={(e) => set('referenceYear', e.target.value)}>
            <option value="">Latest 12 months of data</option>
            {view.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          {errors.referenceYear && <span role="alert" style={{ color: '#dc2626', display: 'block' }}>{errors.referenceYear}</span>}
        </label>
        <label>Load growth (%/yr)<br />
          <input aria-label="Load growth" disabled={!canEdit} inputMode="decimal" value={form.loadGrowthPct} placeholder="0" onChange={(e) => set('loadGrowthPct', e.target.value)} style={{ width: 70 }} />
          <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-dim)' }}>Cashflow only</span>
          {errors.loadGrowthPct && <span role="alert" style={{ color: '#dc2626', display: 'block' }}>{errors.loadGrowthPct}</span>}
        </label>
        <label>Diversity factor<br />
          <input aria-label="Diversity factor" disabled={!canEdit || !view.diversityApplies} inputMode="decimal" value={form.diversityFactor} placeholder="1.0" onChange={(e) => set('diversityFactor', e.target.value)} style={{ width: 70 }} />
          {!view.diversityApplies && <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-dim)' }}>{DIVERSITY_REASON}</span>}
          {errors.diversityFactor && <span role="alert" style={{ color: '#dc2626', display: 'block' }}>{errors.diversityFactor}</span>}
        </label>
        {canEdit && <button type="button" disabled={busy || state.running} onClick={save}>{dirty ? 'Save and rebuild' : 'Rebuild site profile'}</button>}
      </section>

      {form.loadBasis === 'S4' && (
        <section aria-label="Monthly bills" style={{ fontSize: 13 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Monthly bills (basis S4)</h3>
          <label>Daily shape{' '}
            <select aria-label="Bills shape" disabled={!canEdit} value={bills.archetype} onChange={(e) => { setBills({ ...bills, archetype: e.target.value as BillsForm['archetype'] }); setDirty(true) }}>
              {ARCHETYPE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>{' '}
          <label>Power factor <input aria-label="Power factor" disabled={!canEdit} value={bills.powerFactor} onChange={(e) => { setBills({ ...bills, powerFactor: e.target.value }); setDirty(true) }} style={{ width: 60 }} /></label>
          <table style={{ fontSize: 12, marginTop: 6 }}>
            <thead><tr><th align="left">Month</th><th>Energy (kWh)</th><th>Billed demand (kVA, optional)</th></tr></thead>
            <tbody>{bills.months.map((m, i) => (
              <tr key={i}><td>{MONTH_NAMES[i]}</td>
                <td><input aria-label={`${MONTH_NAMES[i]} kWh`} disabled={!canEdit} value={m.kwh} onChange={(e) => { const months = [...bills.months]; months[i] = { ...m, kwh: e.target.value }; setBills({ ...bills, months }); setDirty(true) }} /></td>
                <td><input aria-label={`${MONTH_NAMES[i]} kVA`} disabled={!canEdit} value={m.kva} onChange={(e) => { const months = [...bills.months]; months[i] = { ...m, kva: e.target.value }; setBills({ ...bills, months }); setDirty(true) }} /></td>
              </tr>
            ))}</tbody>
          </table>
          {errors.bills && <p role="alert" style={{ color: '#dc2626' }}>{errors.bills}</p>}
        </section>
      )}

      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      <RebuildStatus state={state} />

      {!sl ? (
        <p style={{ fontSize: 13 }}>No site profile yet. Choose the load basis above{canEdit ? ' and press Rebuild site profile' : ' — someone with edit access builds it'}.</p>
      ) : (
        <>
          {sl.stale && (
            <p role="status" style={{ background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)', borderRadius: 6, padding: '6px 10px', fontSize: 13, margin: 0 }}>
              Inputs changed since this profile was built ({new Date(sl.builtAt).toLocaleString('en-ZA')}).{canEdit ? ' Rebuild to bring it up to date.' : ''}
            </p>
          )}
          <section aria-label="Key figures" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Kpi label="Annual energy" value={`${formatNumber(sl.charts.kpis.annualKwh)} kWh`} />
            <Kpi label={sl.coverage.peakSource === 'interval' ? 'Peak (interval max)' : 'Peak (hourly)'} value={`${(sl.coverage.peakSource === 'interval' ? sl.coverage.peakKw : sl.charts.kpis.peakKw).toFixed(1)} kW`} />
            <Kpi label="Load factor" value={`${(sl.charts.kpis.loadFactor * 100).toFixed(0)} %`} />
            <Kpi label="Day / night (06:00–18:00)" value={`${sl.charts.kpis.dayPct.toFixed(0)} % / ${(100 - sl.charts.kpis.dayPct).toFixed(0)} %`} />
            <Kpi label="TOU split" value="Pin a tariff on the Tariff tab to see the TOU split" />
            {sl.designMdKw !== null && <Kpi label="Design max demand (synthesised)" value={`${sl.designMdKw.toFixed(1)} kW`} />}
            <Kpi label="Basis · year" value={`${sl.basis} · ${sl.referenceYear}`} />
          </section>

          <ChartCard title="Annual (8,760 hours)" pngName={`site-load-annual-${sl.referenceYear}.png`} csvHref={csv('annual')}>
            <LineChart title="Annual load, daily band" yUnit="kW" xFormat={dayLabel} series={[{
              key: 'mean', label: 'Daily mean (min–max band)', colour: SERIES_COLOURS[0],
              points: sl.charts.annual.map((d, i) => ({ x: i, y: d.mean })), band: sl.charts.annual.map((d, i) => ({ x: i, lo: d.min, hi: d.max })),
            }]} />
          </ChartCard>
          <ChartCard title="Average day by month" pngName={`site-load-average-day-${sl.referenceYear}.png`} csvHref={csv('avgday')}>
            <HeatmapCanvas title="Average day by month (12 × 24)" rows={SHORT} cells={sl.charts.avgDayByMonth} unit="kW" cellH={18} />
          </ChartCard>
          <ChartCard title="Weekday / Saturday / Sunday" pngName={`site-load-day-types-${sl.referenceYear}.png`} csvHref={csv('daytype')}>
            <LineChart title="Average day by day type" yUnit="kW" xFormat={(x) => `${String(Math.round(x)).padStart(2, '0')}:00`} series={[
              { key: 'wd', label: 'Weekday', colour: SERIES_COLOURS[0], points: sl.charts.dayTypeProfiles.weekday.map((y, x) => ({ x, y })) },
              { key: 'sa', label: 'Saturday', colour: SERIES_COLOURS[1], points: sl.charts.dayTypeProfiles.saturday.map((y, x) => ({ x, y })) },
              { key: 'su', label: 'Sunday & public holiday', colour: SERIES_COLOURS[2], points: sl.charts.dayTypeProfiles.sunday.map((y, x) => ({ x, y })) },
            ]} />
          </ChartCard>
          <ChartCard title="Monthly energy" pngName={`site-load-monthly-${sl.referenceYear}.png`} csvHref={csv('monthly')}>
            <BarChart title="Monthly energy" yUnit="kWh" categories={SHORT} series={[{ key: 'e', label: 'Energy', colour: SERIES_COLOURS[0], values: sl.charts.monthlyKwh }]} />
          </ChartCard>
          <ChartCard title="Load duration curve" pngName={`site-load-duration-${sl.referenceYear}.png`} csvHref={csv('ldc')}>
            <LineChart title="Load duration curve" yUnit="kW" xFormat={(x) => `${Math.round(x)} %`} series={[{ key: 'ldc', label: 'Share of hours at or above', colour: SERIES_COLOURS[3], points: sl.charts.ldc.map((p) => ({ x: p.pct, y: p.kw })) }]} />
          </ChartCard>

          {sl.bulkRecon.length > 0 && (
            <section aria-label="Reconciliation" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Reconciliation — Σ metered tenants vs bulk (flag beyond ±10 %)</h3>
              {sl.bulkRecon.map((b) => (
                <table key={b.meterId} style={{ fontSize: 12, width: '100%', marginBottom: 8 }}>
                  <caption style={{ textAlign: 'left' }}>{b.label}</caption>
                  <thead><tr><th align="left">Month</th><th align="right">Bulk (kWh)</th><th align="right">Σ tenants (kWh)</th><th align="right">Tenants / bulk</th></tr></thead>
                  <tbody>{b.months.map((m) => (
                    <tr key={m.month} style={{ color: m.flagged ? '#b45309' : undefined }}>
                      <td>{MONTH_NAMES[m.month - 1]}</td><td align="right">{formatNumber(m.bulkKwh)}</td><td align="right">{formatNumber(m.tenantsKwh)}</td>
                      <td align="right">{m.ratio === null ? '—' : `${Math.round(m.ratio * 100)} %`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- SiteProfilePanel 2>&1 | tail -4
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): site profile sub-tab — settings, bills, rebuild, KPIs, five charts, reconciliation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (4 tests). The rand check asserts no `R 123`-style text anywhere on the panel.

### Task 19: Checks sub-tab

**Files:**
- Create: `…/load/_components/ChecksPanel.tsx` (+ `ChecksPanel.test.tsx`)

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ ack: vi.fn(async () => ({ ok: true })), unack: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/actions/solar-load.actions', () => ({ acknowledgeCheckAction: h.ack, unacknowledgeCheckAction: h.unack }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { ChecksPanel } from './ChecksPanel'
import type { ChecksView } from '@/lib/solar/load/view-types'

const view: ChecksView = {
  studyId: 's1', builtAt: '2025-09-01T00:00:00Z',
  checks: [
    { key: 'recon_bulk:b:3', severity: 'warning', message: 'Month 3: Σ metered tenants is 85 % of Bulk.', meterId: 'b', ack: null },
    { key: 'excluded_kind:pv', severity: 'info', message: 'PV is a solar meter and is never counted as load.', meterId: 'pv', ack: { at: '2025-09-02T00:00:00Z', note: 'expected' } },
  ],
  imports: [{ fileId: 'f1', fileName: 'Shop 12.csv', format: 'A', acceptedAt: '2025-08-30T00:00:00Z', errors: [], warnings: [{ code: 'spikes', message: '3 spikes flagged.' }] }],
}
beforeEach(() => vi.clearAllMocks())

describe('ChecksPanel', () => {
  it('lists site checks with links to the object and import reports with their warnings', () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit />)
    expect(screen.getByText('Month 3: Σ metered tenants is 85 % of Bulk.')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Open meter' })[0]).toHaveAttribute('href', '/projects/p1/solar/load?tab=meters&meter=b')
    expect(screen.getByText('3 spikes flagged.')).toBeInTheDocument()
    expect(screen.getByText(/Acknowledged .*expected/)).toBeInTheDocument()
  })
  it('acknowledges a warning with a note', async () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit />)
    await userEvent.type(screen.getByLabelText('Note for recon_bulk:b:3'), 'common area')
    await userEvent.click(screen.getByRole('button', { name: 'Mark as acknowledged' }))
    expect(h.ack).toHaveBeenCalledWith({ projectId: 'p1', checkKey: 'recon_bulk:b:3', note: 'common area' })
  })
  it('View users cannot acknowledge', () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Mark as acknowledged' })).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

```tsx
// …/load/_components/ChecksPanel.tsx
'use client'
/** Checks sub-tab (spec §4.6): every site-level check from the last build and every import report; Edit may acknowledge a warning. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acknowledgeCheckAction, unacknowledgeCheckAction } from '@/actions/solar-load.actions'
import { loadHref } from '@/lib/solar/load/subtabs'
import type { ChecksView } from '@/lib/solar/load/view-types'

const COLOUR = { error: '#dc2626', warning: '#b45309', info: 'var(--c-text-mid)' } as const

export function ChecksPanel({ projectId, view, canEdit }: { projectId: string; view: ChecksView; canEdit: boolean }) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <section aria-label="Site checks">
        <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Site checks{view.builtAt ? ` (profile built ${new Date(view.builtAt).toLocaleString('en-ZA')})` : ''}</h3>
        {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
        {view.checks.length === 0 ? <p>{view.builtAt ? 'No checks raised.' : 'Build the site profile (Site profile tab) to run the checks.'}</p> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {view.checks.map((c) => (
                <tr key={c.key} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={{ color: COLOUR[c.severity], textTransform: 'uppercase', fontSize: 11, width: 70 }}>{c.severity}</td>
                  <td>{c.message}{' '}
                    {c.meterId && <a href={loadHref(projectId, 'meters', { meter: c.meterId })}>Open meter</a>}
                    {c.nodeId && <a href={loadHref(projectId, 'tenants')}>Open tenants</a>}
                  </td>
                  <td style={{ width: 280 }}>
                    {c.ack ? (
                      <span>Acknowledged {c.ack.at.slice(0, 10)}{c.ack.note ? ` — ${c.ack.note}` : ''}{canEdit && (
                        <> <button type="button" disabled={busy === c.key} onClick={async () => {
                          setBusy(c.key); const r = await unacknowledgeCheckAction({ projectId, checkKey: c.key }); setBusy(null)
                          if ('error' in r) setError(r.error); else router.refresh()
                        }}>Undo</button></>
                      )}</span>
                    ) : canEdit && c.severity !== 'info' ? (
                      <span>
                        <input aria-label={`Note for ${c.key}`} placeholder="Note (optional)" value={notes[c.key] ?? ''} onChange={(e) => setNotes({ ...notes, [c.key]: e.target.value })} style={{ width: 130 }} />{' '}
                        <button type="button" disabled={busy === c.key} onClick={async () => {
                          setBusy(c.key); setError(null)
                          const r = await acknowledgeCheckAction({ projectId, checkKey: c.key, note: notes[c.key]?.trim() || null })
                          setBusy(null)
                          if ('error' in r) setError(r.error); else router.refresh()
                        }}>Mark as acknowledged</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Import reports">
        <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Import reports</h3>
        {view.imports.length === 0 ? <p>No imported meter files in this study.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {view.imports.map((f) => (
              <li key={f.fileId}>
                <strong>{f.fileName}</strong> · format {f.format ?? '—'} · {f.acceptedAt ? `accepted ${f.acceptedAt.slice(0, 10)}` : 'not accepted'}
                {(f.errors.length > 0 || f.warnings.length > 0) && (
                  <ul style={{ fontSize: 12 }}>
                    {f.errors.map((e, i) => <li key={`e${i}`} style={{ color: '#dc2626' }}>{e.message}</li>)}
                    {f.warnings.map((w, i) => <li key={`w${i}`} style={{ color: '#b45309' }}>{w.message}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- ChecksPanel 2>&1 | tail -4
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/_components"
git commit -m "feat(solar): checks sub-tab — site checks, import reports, acknowledgements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (3 tests). (Only the warning row shows "Mark as acknowledged": the info row is already acknowledged and info rows need none.)

---

### Task 20: The Load page, readiness wiring, RBAC rows, suites

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/page.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/_components/SolarTabBar.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.test.tsx` (mock the new loader)
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Write the page**

```tsx
// apps/web/src/app/(admin)/projects/[id]/solar/(gated)/load/page.tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { parseSubTab } from '@/lib/solar/load/subtabs'
import { loadChecksView, loadMetersView, loadProfileView, loadTenantsView } from '@/lib/solar/load/views'
import { LoadBasisBar } from './_components/LoadBasisBar'
import { LoadSubTabs } from './_components/LoadSubTabs'
import { MetersPanel } from './_components/MetersPanel'
import { TenantsPanel } from './_components/TenantsPanel'
import { SiteProfilePanel } from './_components/SiteProfilePanel'
import { ChecksPanel } from './_components/ChecksPanel'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Load tab (functional spec §4). View reads kW/kWh; Edit changes. Controls above the level are hidden, not disabled. */
export default async function SolarLoadPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string | string[]; meter?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const canEdit = level !== 'view'
  const tab = parseSubTab(sp.tab)
  const [{ data: study }, grantor] = await Promise.all([
    supabase.schema('solar').from('studies').select('id, load_basis, updated_at').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
  ])
  const s = study as { id: string; load_basis: 'S1' | 'S2' | 'S3' | 'S4' | null; updated_at: string } | null
  const basis = s?.load_basis === 'S3' ? 'S2' : (s?.load_basis ?? '')
  let hint: string | null = null
  if (s && basis === 'S1') {
    const { data: links } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id)
    const ids = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
    const { data: bulk } = ids.length
      ? await supabase.schema('solar').from('meters').select('id').in('id', ids).eq('kind', 'bulk').eq('supply_point_confirmed', true).limit(1)
      : { data: [] }
    if (!Array.isArray(bulk) || bulk.length === 0) hint = 'Confirm a bulk meter as the point of supply first (Meters → the meter → Details).'
  }

  return (
    <div>
      <LoadBasisBar projectId={id} basis={basis} updatedAt={s?.updated_at ?? null} canEdit={canEdit} hint={hint} />
      <LoadSubTabs projectId={id} active={tab} />
      {tab === 'meters' && <MetersPanel projectId={id} canEdit={canEdit} openMeterId={sp.meter ?? null} view={await loadMetersView(supabase, id, !grantor.error && grantor.data === true)} />}
      {tab === 'tenants' && <TenantsPanel projectId={id} canEdit={canEdit} view={await loadTenantsView(supabase, id)} />}
      {tab === 'profile' && <SiteProfilePanel projectId={id} canEdit={canEdit} view={await loadProfileView(supabase, id)} />}
      {tab === 'checks' && <ChecksPanel projectId={id} canEdit={canEdit} view={await loadChecksView(supabase, id)} />}
    </div>
  )
}
```

- [ ] **Step 2: Wire Load readiness into the gated layout**

In `(gated)/layout.tsx`: add `import { loadLoadReadiness } from '@/lib/solar/load/views'`; add `loadLoadReadiness(supabase, id)` as a fifth element of the `Promise.all` (destructure it as `loadReady`); and change the readiness line to:

```ts
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level, { load: loadReady.load, schematics: loadReady.schematics })
```

(If Phase 5 is merged, keep its `layoutReady` argument third and pass this object fourth.) The Schematics dot becomes live once plan 3b-ii builds the tab; `loadLoadReadiness` already returns its aggregate.

In `(gated)/layout.test.tsx`, add next to the other mocks:

```ts
vi.mock('@/lib/solar/load/views', () => ({ loadLoadReadiness: vi.fn(async () => ({ load: null, schematics: null })) }))
```

- [ ] **Step 3: Update the tab-bar test** (Load is built now)

In `SolarTabBar.test.tsx`, in the test 'links built tabs, disables the rest…', replace the three `load` lines with:

```ts
    expect(screen.getByRole('link', { name: /Load/ })).toHaveAttribute('href', '/projects/p1/solar/load')
    const yieldTab = screen.getByText('Yield & Scenarios').closest('[aria-disabled="true"]') as HTMLElement
    expect(yieldTab.getAttribute('title')).toBe('Coming in a later phase')
```

(Use the project id the existing test renders with, if it is not `p1`.)

- [ ] **Step 4: RBAC rows**

In `docs/rbac-matrix.md`, in the Solar route table (after `/projects/[id]/solar/site`), add:

```md
| `/projects/[id]/solar/load` (Meters · Tenants · Site profile · Checks) | W | W | W | R (kW/kWh only; no import, save, rebuild, acknowledge) | → locked | → locked | → locked |
```

In "Solar server actions", add:

```md
| `ensureSolarStudyAction`, `saveLoadBasisAction`, `saveLoadSettingsAction`, `saveCommonAreaAction` (`solar-load.actions.ts`) | `requireSolarLevel(project, 'edit')`; `expectedUpdatedAt` stale guard | `studies_*_authz` (RESTRICTIVE, `solar_can_edit`); CHECKs on `load_growth_pct`, `monthly_bills`, `diversity_factor`, `common_area_pct` (00210/00214) |
| `updateStudyMeterAction`, `removeStudyMeterAction`, `searchLibraryMetersAction`, `linkLibraryMetersAction`, `confirmRegisterRowAction` | Solar Edit; the meter must be linked to THIS project's study; `expectedUpdatedAt` on meter edits | library RLS (`solar.library_orgs('edit')`; deleting a library meter needs `'admin'` = org owner/admin); `study_meters_*_authz`; `meters_bind` refuses a node/parent of another org |
| `saveTenantBasisAction`, `applyAutoMatchAction`, `excludeVacantAction` | Solar Edit; meters must be study meters; node must be a `tenant_db` of this project; weights > 0 | `tenant_load_basis_*_authz` + `tenant_load_basis_check` (same-org meters, weight > 0) |
| `acknowledgeCheckAction`, `unacknowledgeCheckAction` | Solar Edit | `load_check_acks_*_authz` (00214); `acknowledged_by` stamped by trigger; no UPDATE grant |
```

In the "Solar meter data API" section, add rows:

```md
| `POST /api/projects/[id]/solar/site-load/rebuild` | Solar Edit | `solar.site_load` (one row per study; NDJSON progress; generic error line, never a raw message) |
| `GET /api/projects/[id]/solar/site-load/csv?chart=` | Solar View | reads `solar.site_load` |
| `GET /api/projects/[id]/solar/meters/[meterId]/series` · `/heatmap` · `/csv` | Solar View; the meter must be linked to this project's study (404 otherwise) | reads through `solar.channel_readings` / `solar.channel_summaries` (SECURITY INVOKER — `meter_readings_select` decides, incl. the linked-meter arm) |
| `GET /api/projects/[id]/solar/cloud-files` · `POST …/cloud-files/import` | Solar Edit; project must have a cloud mapping | connection read through RLS; bytes copied into `solar-meter-raw` with the caller's client (bucket insert policy), then registered like a browser upload |
```

- [ ] **Step 5: Full verification for 3b-i**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check && pnpm --filter web type-check
pnpm --filter web lint 2>&1 | tail -6
pnpm --filter web build 2>&1 | tail -15
```

Expected: all green; `next build` exit 0 (it type-checks route export shapes — Task 8's helper move exists for this). Fix any red before committing; do not skip a failing test.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar" docs/rbac-matrix.md
git commit -m "feat(solar): Load tab page, Load readiness on the tab dots, RBAC rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Nothing is pushed yet — plan 3b-ii ends with the push and the draft PR.

---

## Self-review (done)

- Spec §4 coverage: load basis select (Task 12), upload direct-to-Storage (13), import review dialog with identity panel, validation summary, unit override, kind, tenant, accept/skip (14), Import meter register incl. unconfirmed LLM/UNMAPPED and "file not yet imported" (13–15), Dropbox folder import (8, 15), copy from org library (9, 15), meters table + drawer with chart (zoom, full resolution, gaps), heatmap, edit mapping, remove (+ library delete for grantors), normalised CSV (6, 16), Tenants sub-tab: source, weighted meters, density, archetype, BO date, auto-match with review (never pre-ticking LLM/UNMAPPED), exclude vacant with count, common-area % (9, 10, 17), Site profile: reference year, load growth, diversity (disabled for measured), rebuild with progress, five charts with PNG + full-resolution CSV, KPI strip, reconciliation card (4, 5, 7, 18), Checks with acknowledgement (10, 19). Large series downsampled server-side (6); library called, never recomputed in the browser (3, 4, 10).
- Gaps knowingly left (recorded as open questions): TOU split awaits a pinned tariff; "meter comparison overlay" (dev plan P3) is not in spec §4 and is not built.
- Placeholders: none. Type names match 3b-0 (`BuildSiteLoadInput`, `siteProfileCharts`, `LoadSettingsForm`, `BillsForm`, `LOAD_BASIS_OPTIONS`, `MONTH_NAMES`, `LoadReadinessInput`, `SchematicsReadinessInput`, `autoMatchMeters`, `normShop`).

