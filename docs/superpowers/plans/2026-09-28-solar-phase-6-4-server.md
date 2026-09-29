# Solar Phase 6 — Part 4: Server (report kinds, report generation, proposals, client access)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first.

Shared test helper used below — create it in Task 15 Step 1:

`apps/web/src/test/fake-storage.ts`:
```ts
/** Adds a `storage` fake (and captures) to a fakeSupabase client, for service-client tests. */
import { vi } from 'vitest'

export function withStorage<T extends { client: Record<string, unknown> }>(fake: T, over: Partial<Record<'upload' | 'remove' | 'download' | 'createSignedUrl', unknown>> = {}) {
  const bucket = {
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null })),
    download: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null })),
    ...over,
  }
  const from = vi.fn(() => bucket)
  return { ...fake, client: { ...fake.client, storage: { from } }, bucket, storageFrom: from }
}
```

---

### Task 15: Solar report kinds read on the Solar level (+ never delete a proposal PDF)

**Files:**
- Create: `apps/web/src/test/fake-storage.ts` (above)
- Modify: `apps/web/src/lib/reports/report-kind-access.ts`, `report-kind-access.contract.test.ts`
- Modify: `apps/web/src/actions/project-reports.actions.ts`
- Create: `apps/web/src/actions/project-reports.solar-kinds.test.ts`
- Modify: `apps/web/src/components/reports/SavedReportsPanel.tsx` (summary labels)

- [ ] **Step 1: Create `fake-storage.ts`** (content above).

- [ ] **Step 2: Failing test** `apps/web/src/actions/project-reports.solar-kinds.test.ts`:

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
const rows = [
  { id: 'r1', project_id: P, organisation_id: 'o1', kind: 'solar_feasibility', title: 'F', storage_path: 'o1/p1/f.pdf', status: 'issued', version: 1 },
  { id: 'r2', project_id: P, organisation_id: 'o1', kind: 'solar_technical', title: 'T', storage_path: 'o1/p1/t.pdf', status: 'issued', version: 1 },
  { id: 'r3', project_id: P, organisation_id: 'o1', kind: 'solar_proposal', title: 'Pr', storage_path: 'o1/p1/p.pdf', status: 'issued', version: 1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  const fake = fakeSupabase({ tables: { 'projects.reports': rows, 'projects.projects': [{ id: P, organisation_id: 'o1' }] } })
  h.createClient.mockResolvedValue(fake.client)
  h.createServiceClient.mockReturnValue(withStorage(fakeSupabase()).client)
})

describe('Solar report kinds follow the Solar level (00216 mirrors this)', () => {
  it('feasibility and proposal need Edit + financials; technical needs View', async () => {
    h.level.mockResolvedValue('edit')
    await expect(listProjectReportsAction(P, 'solar_feasibility')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(listProjectReportsAction(P, 'solar_proposal')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    const tech = await listProjectReportsAction(P, 'solar_technical')
    expect(Array.isArray(tech) && tech.map((r) => r.id)).toEqual(['r2'])
    h.level.mockResolvedValue('edit_financials')
    const fea = await listProjectReportsAction(P, 'solar_feasibility')
    expect(Array.isArray(fea) && fea.map((r) => r.id)).toEqual(['r1'])
  })
  it('no Solar level reads no Solar kind, even technical', async () => {
    h.level.mockResolvedValue(null)
    await expect(listProjectReportsAction(P, 'solar_technical')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    await expect(getProjectReportUrlAction(P, 'r2')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('a signed URL for a proposal PDF needs Edit + financials', async () => {
    h.level.mockResolvedValue('edit')
    await expect(getProjectReportUrlAction(P, 'r3')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
    h.level.mockResolvedValue('edit_financials')
    await expect(getProjectReportUrlAction(P, 'r3')).resolves.toEqual({ url: 'https://signed.example/x' })
  })
  it('an issued proposal PDF is evidence and is never deleted', async () => {
    h.level.mockResolvedValue('edit_financials')
    await expect(deleteProjectReportAction(P, 'r3')).resolves.toEqual({
      error: 'An issued proposal’s PDF is kept as evidence and cannot be deleted — withdraw the proposal instead.',
    })
  })
  it('deleting a Solar report needs Solar Edit', async () => {
    h.level.mockResolvedValue('view')
    await expect(deleteProjectReportAction(P, 'r2')).resolves.toEqual({ error: 'You do not have Solar edit access on this project.' })
  })
})
```

- [ ] **Step 3: Run — FAIL.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 && pnpm --filter web test -- src/actions/project-reports.solar-kinds.test.ts 2>&1 | tail -8
```

- [ ] **Step 4: Implement `report-kind-access.ts`.** If Task 0 Step 4(a) found `SOLAR_READ_REPORT_KINDS` already on the base (Phase 5 merged), only ADD the three new entries to the existing map. Otherwise make these three edits (they are Phase 5's code verbatim plus the new kinds, so a later merge of `feat/solar-phase-5` conflicts only on the map's lines — take the union):

(a) Change the shared import to:
```ts
import { ORG_WRITE_ROLES, COST_VIEW_ROLES, type OrgRole, type SolarAccessLevel } from '@esite/shared'
```
(b) After `OPEN_READ_REPORT_KINDS`, add:
```ts
/**
 * Kinds whose read follows the Solar module's own gate: the caller's per-user
 * Solar level on the project (00207, decision D-04), not an E-Site role. A
 * contractor with a View grant reads a layout sheet or a technical report; a
 * project manager with no grant does not. Mirrored in
 * public.user_can_read_report_kind() (00211 / 00216) and pinned by
 * report-kind-access.contract.test.ts against the FINAL definition.
 */
export const SOLAR_READ_REPORT_KINDS: Readonly<Record<string, SolarAccessLevel>> = {
  // A drawing crop with arrays, strings, a legend and a title block — no rand values.
  solar_layout_sheet: 'view',
  // The feasibility content without any rand value (spec §9.1).
  solar_technical: 'view',
  // Capex, bills, cashflow, IRR — commercial.
  solar_feasibility: 'edit_financials',
  // The issued client offer. Clients read it through the token page / portal only.
  solar_proposal: 'edit_financials',
}

/** The Solar level required to read this kind, or null when it is not a Solar kind. */
export function solarLevelForKind(kind: string): SolarAccessLevel | null {
  return SOLAR_READ_REPORT_KINDS[kind] ?? null
}
```
(c) Change `hasDeclaredReadPolicy` to:
```ts
export function hasDeclaredReadPolicy(kind: string): boolean {
  return kind in REPORT_KIND_READ_ROLES || OPEN_READ_REPORT_KINDS.includes(kind) || kind in SOLAR_READ_REPORT_KINDS
}
```

- [ ] **Step 5: Extend the contract test** `report-kind-access.contract.test.ts` (skip the two `it` blocks if Phase 5 already added them — then only Step 6 applies): add `SOLAR_READ_REPORT_KINDS,` to the import from `./report-kind-access`, and append inside the existing `describe`:

```ts
  it('a kind is in exactly one of the three sets', () => {
    const solar = Object.keys(SOLAR_READ_REPORT_KINDS)
    for (const k of solar) {
      expect(k in REPORT_KIND_READ_ROLES, `${k} is both Solar-gated and role-gated`).toBe(false)
      expect(OPEN_READ_REPORT_KINDS.includes(k), `${k} is both Solar-gated and open`).toBe(false)
    }
  })

  it('every Solar-gated kind is gated in the FINAL user_can_read_report_kind()', () => {
    const dir = path.resolve(SRC_ROOT, '../../edge-functions/supabase/migrations')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    let body: string | null = null
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(')
      if (i === -1) continue
      const start = sql.indexOf('$function$', i)
      const end = sql.indexOf('$function$', start + 10)
      if (start !== -1 && end !== -1) body = sql.slice(start + 10, end)
    }
    expect(body, 'user_can_read_report_kind() not found in any migration').toBeTruthy()
    for (const [kind, level] of Object.entries(SOLAR_READ_REPORT_KINDS)) {
      const helper = level === 'view' ? 'solar_can_view' : level === 'edit' ? 'solar_can_edit' : 'solar_can_see_money'
      expect(body!, `${kind} is not gated in the final user_can_read_report_kind()`).toMatch(
        new RegExp(`_kind = '${kind}' THEN COALESCE\\(public\\.${helper}\\(_project_id\\), FALSE\\)`),
      )
    }
  })
```

- [ ] **Step 6: Implement the action gates** in `apps/web/src/actions/project-reports.actions.ts` (skip (a)–(c) if Phase 5 already added them; (d) is always new):

(a) Imports — change `import { readRolesForKind } from '@/lib/reports/report-kind-access'` to:
```ts
import { readRolesForKind, solarLevelForKind } from '@/lib/reports/report-kind-access'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { solarLevelAllows } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
```
and add below `type ErrResult = …`:
```ts
const NO_SOLAR_ACCESS = 'You do not have Solar access on this project.'

/** Solar kinds read on the caller's Solar level (00211/00216 mirror this in SQL). Null when allowed or not a Solar kind. */
async function solarReadDenied(supabase: unknown, projectId: string, kind: string): Promise<string | null> {
  const need = solarLevelForKind(kind)
  if (!need) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
  return solarLevelAllows(level, need) ? null : NO_SOLAR_ACCESS
}
```
(b) In `listProjectReportsAction`, immediately after the `if (readRoles) { … }` block:
```ts
  const solarDenied = await solarReadDenied(supabase, projectId, kind)
  if (solarDenied) return { error: solarDenied }
```
(c) In `getProjectReportUrlAction`, immediately after its `if (readRoles) { … }` block:
```ts
  const solarDenied = await solarReadDenied(supabase, projectId, report.kind)
  if (solarDenied) return { error: solarDenied }
```
(d) In `deleteProjectReportAction`, immediately after `if (!report) return { error: 'Not found' }`:
```ts
  // An issued proposal's PDF is the evidence the client's acceptance is stamped against (00216).
  if (report.kind === 'solar_proposal') {
    return { error: 'An issued proposal’s PDF is kept as evidence and cannot be deleted — withdraw the proposal instead.' }
  }
  // A Solar kind is removed on the Solar EDIT level, not just an org write role.
  if (solarLevelForKind(report.kind)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
    if (!solarLevelAllows(level, 'edit')) return { error: 'You do not have Solar edit access on this project.' }
  }
```

- [ ] **Step 7: Summary labels** in `SavedReportsPanel.tsx` — add to `SUMMARY_LABELS`:
```ts
  // Solar reports and proposals (Phase 6).
  kwp: 'kWp',
  mwhYear1: 'MWh in year 1',
  saving: 'year-1 saving',
  irrPct: '% IRR',
  offer: 'offer excl. VAT',
```
and change `HIDDEN_SUMMARY_KEYS` to `new Set(['revisionId', 'runId', 'familyId'])`.

- [ ] **Step 8: Run — PASS; run the whole reports folder; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/actions/project-reports src/lib/reports src/components/reports 2>&1 | tail -5
git add apps/web/src/test/fake-storage.ts apps/web/src/lib/reports/report-kind-access.ts apps/web/src/lib/reports/report-kind-access.contract.test.ts \
  apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.solar-kinds.test.ts apps/web/src/components/reports/SavedReportsPanel.tsx
git commit -m "feat(solar): Solar report kinds read on the Solar level; proposal PDFs never deleted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The selected case, its stored run, and the Stale refusal

**Files:**
- Create: `apps/web/src/lib/solar/reports/selected-case.ts`, `selected-case.test.ts`

- [ ] **Step 1: Failing test** `selected-case.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ loadStudyInputs: vi.fn(), contextForCase: vi.fn(), runsByCase: vi.fn() }))
vi.mock('@/lib/solar/cases/run-context', () => ({ loadStudyInputs: h.loadStudyInputs, contextForCase: h.contextForCase }))
vi.mock('@/lib/solar/cases/page-data', () => ({ runsByCase: h.runsByCase }))

import { loadSelectedCase, SELECTED_CASE_REASONS } from './selected-case'
import { fakeSupabase } from '@/test/fake-supabase'

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64)
const study = { id: 's1', project_id: 'p1', organisation_id: 'o1', selected_case_id: 'c1', updated_at: 'T' }
const caseRow = { id: 'c1', study_id: 's1', project_id: 'p1', name: 'Base', pv_source: 'manual', layout_id: null, config: {}, updated_at: 'T' }
const runRow = { id: 'r1', case_id: 'c1', status: 'succeeded', inputs_hash: H1, started_at: new Date().toISOString(), finished_at: '2026-09-28T10:00:00Z', outputs: { kpis: { dcKwp: 500 } }, config_snapshot: {}, hourly_path: 'o1/r1.csv.gz' }
const user = () => fakeSupabase({ tables: { 'solar.cases': [caseRow], 'solar.case_runs': [runRow] } }).client

beforeEach(() => {
  vi.clearAllMocks()
  h.loadStudyInputs.mockResolvedValue({ study })
  h.runsByCase.mockResolvedValue({ latest: new Map([['c1', runRow]]), ok: new Map([['c1', runRow]]) })
  h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: H1 } })
})

describe('loadSelectedCase', () => {
  it('returns the selected case and its latest succeeded run when current', async () => {
    const r = await loadSelectedCase(user() as never, {} as never, 'p1')
    expect(r).toMatchObject({ ok: true, caseRow: { id: 'c1', name: 'Base' }, run: { id: 'r1', inputsHash: H1, hourlyPath: 'o1/r1.csv.gz' } })
  })
  it('refuses a Stale case (current inputs hash differs from the run’s)', async () => {
    h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: H2 } })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toEqual({ ok: false, stale: true, reason: SELECTED_CASE_REASONS.stale })
  })
  it('refuses when inputs are incomplete (Stale by the rule)', async () => {
    h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: null } })
    expect((await loadSelectedCase(user() as never, {} as never, 'p1')).ok).toBe(false)
  })
  it('names every other missing step', async () => {
    h.loadStudyInputs.mockResolvedValueOnce(null)
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noStudy })
    h.loadStudyInputs.mockResolvedValueOnce({ study: { ...study, selected_case_id: null } })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noSelection })
    h.runsByCase.mockResolvedValueOnce({ latest: new Map(), ok: new Map() })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noRun })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `selected-case.ts`:

```ts
import 'server-only'
/**
 * The selected case (spec §2.2) and its latest SUCCEEDED run — the only thing reports and proposals
 * are generated from (never recomputed). Refuses when the case is Stale by the 4b rule (the current
 * inputs' hash differs from the run's), running, or failed. The same builder that computes the
 * Stale banner's hash (contextForCase) is used here, so the two can never disagree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { caseStatus, type CaseRunOutputs } from '@esite/shared/solar-cases'
import { contextForCase, loadStudyInputs, type StudyInputs } from '@/lib/solar/cases/run-context'
import { runsByCase } from '@/lib/solar/cases/page-data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const SELECTED_CASE_REASONS = {
  noStudy: 'Save Site & Supply first.',
  noSelection: 'Choose a selected case on the Overview first.',
  noRun: 'Run the selected case on Yield & Scenarios first.',
  stale: 'The selected case is stale — re-run it first.',
  running: 'The selected case is running — wait for it to finish.',
  failed: 'The selected case’s last run failed — fix it and re-run.',
} as const

export interface SelectedCaseRow { id: string; study_id: string; project_id: string; name: string; pv_source: string; layout_id: string | null; config: unknown; updated_at: string }
export interface SelectedCaseOk {
  ok: true
  shared: StudyInputs
  caseRow: SelectedCaseRow
  run: { id: string; finishedAt: string; inputsHash: string; outputs: CaseRunOutputs; configSnapshot: unknown; hourlyPath: string }
}
export type SelectedCaseResult = SelectedCaseOk | { ok: false; stale: boolean; reason: string }

const no = (reason: string, stale = false): SelectedCaseResult => ({ ok: false, stale, reason })

export async function loadSelectedCase(user: AnyClient, svc: AnyClient, projectId: string): Promise<SelectedCaseResult> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return no(SELECTED_CASE_REASONS.noStudy)
  const selId = shared.study.selected_case_id
  if (!selId) return no(SELECTED_CASE_REASONS.noSelection)
  const { data: c } = await user.schema('solar').from('cases')
    .select('id, study_id, project_id, name, pv_source, layout_id, config, updated_at').eq('id', selId).eq('project_id', projectId).maybeSingle()
  if (!c) return no(SELECTED_CASE_REASONS.noSelection)
  const caseRow = c as SelectedCaseRow
  const { latest, ok } = await runsByCase(user, projectId)
  const last = latest.get(selId) as Row | undefined
  const lastOk = ok.get(selId) as Row | undefined
  if (!lastOk) return no(SELECTED_CASE_REASONS.noRun)
  const ctx = await contextForCase(svc, shared, caseRow as never)
  const st = caseStatus(
    last ? { status: last.status as never, inputsHash: String(last.inputs_hash), startedAt: String(last.started_at) } : null,
    { inputsHash: String(lastOk.inputs_hash) },
    ctx.ok ? ctx.ctx.currentHash : null,
    Date.now(),
  )
  if (st.status === 'stale') return no(SELECTED_CASE_REASONS.stale, true)
  if (st.status === 'running') return no(SELECTED_CASE_REASONS.running)
  if (st.status === 'failed') return no(SELECTED_CASE_REASONS.failed)
  const { data: r } = await user.schema('solar').from('case_runs')
    .select('id, finished_at, inputs_hash, outputs, config_snapshot, hourly_path').eq('id', lastOk.id as string).maybeSingle()
  const run = r as Row | null
  if (!run?.outputs || !run.hourly_path) return no(SELECTED_CASE_REASONS.noRun)
  return {
    ok: true, shared, caseRow,
    run: {
      id: String(run.id), finishedAt: String(run.finished_at), inputsHash: String(run.inputs_hash),
      outputs: run.outputs as CaseRunOutputs, configSnapshot: run.config_snapshot, hourlyPath: String(run.hourly_path),
    },
  }
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): selected-case loader with the Stale refusal").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/selected-case.test.ts 2>&1 | tail -4
git add apps/web/src/lib/solar/reports/selected-case.ts apps/web/src/lib/solar/reports/selected-case.test.ts
git commit -m "feat(solar): selected-case loader with the Stale refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Generate feasibility / technical report (+ layout sheet, 8760 appendix)

**Files:**
- Create: `apps/web/src/lib/solar/reports/generate.ts`, `generate.test.ts`
- Create: `apps/web/src/actions/solar-reports.actions.ts`, `solar-reports.actions.test.ts`
- Modify: `apps/web/src/lib/solar/audit.ts` (`actorId: string | null`)
- Modify: `apps/web/src/lib/reports/report-kind-access.contract.test.ts` (scanner expects the Solar writers)

- [ ] **Step 1: Widen the audit actor** in `apps/web/src/lib/solar/audit.ts`: change `actorId: string` to `actorId: string | null` (client responses have no E-Site user; `solar.audit_events.actor_id` is nullable). No other change.

- [ ] **Step 2: Failing test** `apps/web/src/lib/solar/reports/generate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sel: vi.fn(), money: vi.fn(), brandData: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-report')),
}))
vi.mock('./selected-case', async (orig) => ({ ...(await orig<typeof import('./selected-case')>()), loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/page-data', () => ({ latestMoney: h.money }))
vi.mock('./branding-loader', () => ({ loadSolarBrandingData: h.brandData }))
vi.mock('./render-report', () => ({ renderSolarReport: h.render }))

import { generateSolarReport } from './generate'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

const outputs = {
  version: 1, kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.8, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 0, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000, solarFraction: 0.49, selfConsumption: 0.83, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly: [], typicalDays: [], daily: [], waterfall: [], checks: [],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w', weatherSource: 'PVGIS TMY', weatherFetchedAt: null, gsaPvoutKwhPerKwp: null, tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
}
const selOk = (pv: 'manual' | 'layout' = 'manual') => ({
  ok: true,
  shared: { study: { id: 's1', organisation_id: 'o1', latitude: -25.7, longitude: 28.2, export_mode: 'net_billing', export_limit_kw: null, nmd_kva: 800 } },
  caseRow: { id: 'c1', name: 'Base', pv_source: pv, layout_id: pv === 'layout' ? 'L1' : null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00Z', inputsHash: 'a'.repeat(64), outputs, configSnapshot: {}, hourlyPath: 'x' },
})
const finRow = { case_id: 'c1', case_run_id: 'r1', results: {
  capex: { exclVatZar: 1, vatZar: 0, inclVatZar: 1, zarPerWp: null, inverterZar: 0, batteryZar: 0, qualifying12bZar: 0, byCategory: {} },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: null, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1, npvZar: 1, irr: 0.2, simplePaybackYears: 3, discountedPaybackYears: 4, rows: [] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 1, swing: 0.2, bars: [], omitted: [] } } }

function setup(reportRows: Array<Record<string, unknown>> = []) {
  const svc = withStorage(fakeSupabase({ tables: {
    'projects.reports': reportRows, 'projects.projects': [{ id: 'p1', name: 'Acme', address: null, city: null, province: null }],
    'solar.studies': [{ project_id: 'p1', licensee_name: 'City of Tshwane' }], 'solar.proposal_templates': [],
  }, writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] } } }))
  const user = fakeSupabase({ tables: { 'projects.reports': reportRows } })
  return { svc, user }
}
const base = (kind: 'feasibility' | 'technical', extra: Partial<Parameters<typeof generateSolarReport>[0]> = {}) => {
  const { svc, user } = setup()
  return { svc, args: { projectId: 'p1', kind, note: 'Rev A', options: { includeLayoutSheet: false, include8760: false }, userId: 'u1', user: user.client as never, svc: svc.client as never, ...extra } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sel.mockResolvedValue(selOk())
  h.money.mockResolvedValue(new Map([['c1', finRow]]))
  h.brandData.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme' })
})

describe('generateSolarReport', () => {
  it('refuses a Stale selected case with the reason, writing nothing', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    const { svc, args } = base('technical')
    await expect(generateSolarReport(args)).resolves.toEqual({ ok: false, error: 'The selected case is stale — re-run it first.' })
    expect(svc.bucket.upload).not.toHaveBeenCalled()
  })
  it('feasibility needs financial results for THIS run', async () => {
    h.money.mockResolvedValue(new Map([['c1', { ...finRow, case_run_id: 'r-old' }]]))
    await expect(generateSolarReport(base('feasibility').args)).resolves.toEqual({ ok: false, error: 'Run financials for the selected case first (Financials tab).' })
  })
  it('technical: stores v1 as solar_technical against the run, with a money-free summary and the neutral-branding warning', async () => {
    const { svc, args } = base('technical')
    const r = await generateSolarReport(args)
    expect(r).toEqual({ ok: true, reportId: 'rep-new', version: 1, warning: expect.stringContaining('neutral template') })
    expect(svc.storageFrom).toHaveBeenCalledWith('reports')
    expect(svc.bucket.upload).toHaveBeenCalledWith('o1/p1/solar-reports/solar_technical-v1-r1.pdf', expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    const ins = callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ kind: 'solar_technical', source_table: 'solar.case_runs', source_id: 'r1', version: 1, status: 'issued', note: 'Rev A', generated_by: 'u1' })
    expect(ins.summary).toEqual({ kwp: 500, mwhYear1: 845, runId: 'r1' })
  })
  it('supersedes the previous version of the same kind', async () => {
    const { svc, user } = setup([{ id: 'rep-old', project_id: 'p1', kind: 'solar_feasibility', status: 'issued', version: 3 }])
    const r = await generateSolarReport({ projectId: 'p1', kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: true }, userId: 'u1', user: user.client as never, svc: svc.client as never })
    expect(r).toMatchObject({ ok: true, version: 4 })
    const upd = callsTo(svc.calls, 'projects.reports', 'update')[0]!
    expect(upd.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(upd.filters).toContainEqual(['eq', 'id', 'rep-old'])
  })
  it('layout sheet option: refused for a manual-size case', async () => {
    await expect(generateSolarReport(base('technical', { options: { includeLayoutSheet: true, include8760: false } }).args))
      .resolves.toEqual({ ok: false, error: 'This case uses a manual system size, so there is no layout sheet to attach.' })
  })
  it('layout sheet option: refused when no sheet has been exported', async () => {
    h.sel.mockResolvedValue(selOk('layout'))
    await expect(generateSolarReport(base('technical', { options: { includeLayoutSheet: true, include8760: false } }).args))
      .resolves.toEqual({ ok: false, error: 'Export a layout sheet on the Layout tab first.' })
  })
  it('removes the stored PDF when the row cannot be written', async () => {
    const svc = withStorage(fakeSupabase({ tables: { 'projects.projects': [{ id: 'p1', name: 'Acme' }] }, writes: { 'projects.reports:insert': { error: { message: 'x', code: '23505' } } } }))
    const r = await generateSolarReport({ ...base('technical').args, svc: svc.client as never })
    expect(r).toEqual({ ok: false, error: 'Could not save the report — try again.' })
    expect(svc.bucket.remove).toHaveBeenCalledWith(['o1/p1/solar-reports/solar_technical-v1-r1.pdf'])
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/generate.ts`:

```ts
import 'server-only'
/**
 * Generate a feasibility (money) or technical (no money) report from the SELECTED case's stored run
 * (spec §9.2). Never recomputes: the model is built from case_runs.outputs and, for feasibility,
 * the latest case_run_financials row FOR THAT RUN. Stored as the next version in projects.reports
 * (supersede chain), source = the run, so "a feasibility report exists for the current run" is a
 * lookup. The caller has already gated the Solar level; `svc` is used only after that gate.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { buildSolarReportModel, type SolarReportMoney } from '@esite/shared/solar-reports'
import { latestMoney } from '@/lib/solar/cases/page-data'
import { loadSelectedCase } from './selected-case'
import { loadSolarBrandingData } from './branding-loader'
import { solarBranding } from './branding'
import { renderSolarReport } from './render-report'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface GenerateReportInput {
  projectId: string
  kind: 'feasibility' | 'technical'
  note: string | null
  options: { includeLayoutSheet: boolean; include8760: boolean }
  userId: string
  user: AnyClient
  svc: AnyClient
}
export type GenerateReportResult = { ok: true; reportId: string; version: number; warning: string | null } | { ok: false; error: string }

export const REPORT_ERRORS = {
  noFinancials: 'Run financials for the selected case first (Financials tab).',
  manualCase: 'This case uses a manual system size, so there is no layout sheet to attach.',
  noSheet: 'Export a layout sheet on the Layout tab first.',
  sheetUnreadable: 'The layout sheet could not be read — export it again.',
  store: 'Could not store the report — try again.',
  save: 'Could not save the report — try again.',
} as const

async function appendPdf(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base)
  const src = await PDFDocument.load(extra)
  for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p)
  return doc.save()
}

export async function generateSolarReport(i: GenerateReportInput): Promise<GenerateReportResult> {
  const sel = await loadSelectedCase(i.user, i.svc, i.projectId)
  if (!sel.ok) return { ok: false, error: sel.reason }
  const { caseRow, run, shared } = sel

  let money: SolarReportMoney | null = null
  if (i.kind === 'feasibility') {
    const fin = (await latestMoney(i.user, [caseRow.id])).get(caseRow.id) as Row | undefined
    if (!fin || fin.case_run_id !== run.id) return { ok: false, error: REPORT_ERRORS.noFinancials }
    const r = fin.results as Omit<SolarReportMoney, 'tariffName'>
    const t = run.outputs.provenance.tariffRef
    money = { ...r, tariffName: t ? `${t.tariffName} (${t.licenseeName}, ${t.financialYear})` : null }
  }

  let sheet: Uint8Array | null = null
  if (i.options.includeLayoutSheet) {
    if (caseRow.pv_source !== 'layout' || !caseRow.layout_id) return { ok: false, error: REPORT_ERRORS.manualCase }
    // Through the caller's session: the kind gate (View) decides whether they may use the sheet.
    const { data: s } = await i.user.schema('projects').from('reports').select('id, storage_path')
      .eq('project_id', i.projectId).eq('kind', 'solar_layout_sheet').eq('source_id', caseRow.layout_id).eq('status', 'issued')
      .order('version', { ascending: false }).limit(1).maybeSingle()
    if (!s) return { ok: false, error: REPORT_ERRORS.noSheet }
    const { data: blob } = await i.svc.storage.from('reports').download(String((s as Row).storage_path))
    if (!blob) return { ok: false, error: REPORT_ERRORS.sheetUnreadable }
    sheet = new Uint8Array(await blob.arrayBuffer())
  }

  const [{ data: proj }, { data: studyExtra }, { data: tpl }] = await Promise.all([
    i.svc.schema('projects').from('projects').select('name, address, city, province').eq('id', i.projectId).maybeSingle(),
    i.svc.schema('solar').from('studies').select('licensee_name').eq('project_id', i.projectId).maybeSingle(),
    i.svc.schema('solar').from('proposal_templates').select('disclaimer_text').eq('organisation_id', shared.study.organisation_id).maybeSingle(),
  ])
  const p = (proj ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const st = shared.study as unknown as Row
  const generatedAt = new Date().toISOString()

  const model = buildSolarReportModel({
    kind: i.kind, projectName: p.name ?? '', address, caseName: caseRow.name,
    site: {
      latitude: st.latitude === null || st.latitude === undefined ? null : Number(st.latitude),
      longitude: st.longitude === null || st.longitude === undefined ? null : Number(st.longitude),
      licenseeName: ((studyExtra as Row | null)?.licensee_name as string | null) ?? null,
      nmdKva: st.nmd_kva === null || st.nmd_kva === undefined ? null : Number(st.nmd_kva),
      exportMode: (st.export_mode as string | null) ?? null,
      exportLimitKw: st.export_limit_kw === null || st.export_limit_kw === undefined ? null : Number(st.export_limit_kw),
    },
    run: { id: run.id, finishedAt: run.finishedAt, outputs: run.outputs },
    money,
    options: { layoutSheetAttached: sheet !== null, include8760: i.options.include8760 },
    disclaimer: ((tpl as Row | null)?.disclaimer_text as string | undefined) ?? '',
    generatedAt,
  })
  const { branding, warning } = solarBranding(await loadSolarBrandingData(i.svc, i.projectId), { title: model.title, kicker: model.kicker, date: generatedAt.slice(0, 10) })

  let pdf: Uint8Array = new Uint8Array(await renderSolarReport(model, branding))
  if (sheet) {
    try { pdf = await appendPdf(pdf, sheet) } catch { return { ok: false, error: REPORT_ERRORS.sheetUnreadable } }
  }

  // The kind is written as a LITERAL at each .from('reports') call on purpose:
  // report-kind-access.contract.test.ts finds writers by scanning for them.
  const priorQuery = i.kind === 'feasibility'
    ? i.svc.schema('projects').from('reports').select('id, version').eq('project_id', i.projectId).eq('kind', 'solar_feasibility').eq('status', 'issued')
    : i.svc.schema('projects').from('reports').select('id, version').eq('project_id', i.projectId).eq('kind', 'solar_technical').eq('status', 'issued')
  const { data: prior } = await priorQuery.order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as Row).version) + 1 : 1
  const kind = i.kind === 'feasibility' ? 'solar_feasibility' : 'solar_technical'

  const storagePath = `${shared.study.organisation_id}/${i.projectId}/solar-reports/${kind}-v${version}-${run.id}.pdf`
  const { error: upErr } = await i.svc.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { ok: false, error: REPORT_ERRORS.store }
  const { data: rep, error: insErr } = await i.svc.schema('projects').from('reports').insert({
    organisation_id: shared.study.organisation_id,
    project_id: i.projectId,
    kind,
    source_table: 'solar.case_runs',
    source_id: run.id,
    title: `${model.title} — ${caseRow.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: model.summary,
    note: i.note,
    generated_by: i.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: REPORT_ERRORS.save }
  }
  if (prior) await i.svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as Row).id as string)
  return { ok: true, reportId, version, warning }
}
```
(Upload paths use the run id so a re-generation after a re-run never overwrites another version's object.)

- [ ] **Step 4: Failing test** `apps/web/src/actions/solar-reports.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(() => ({})), requireSolarLevel: vi.fn(), gen: vi.fn(),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/reports/generate', () => ({ generateSolarReport: h.gen }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { generateSolarReportAction } from './solar-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1' }).client)
  h.requireSolarLevel.mockResolvedValue('edit_financials')
  h.gen.mockResolvedValue({ ok: true, reportId: 'rep1', version: 2, warning: null })
})

describe('generateSolarReportAction', () => {
  it('feasibility gates Edit + financials; technical gates Edit — FIRST', async () => {
    await generateSolarReportAction({ projectId: P, kind: 'feasibility', note: '', options: { includeLayoutSheet: false, include8760: false } })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    await generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } })
    expect(h.requireSolarLevel).toHaveBeenLastCalledWith(P, 'edit', expect.anything())
  })
  it('refuses a bad kind or an overlong note before any work', async () => {
    await expect(generateSolarReportAction({ projectId: P, kind: 'monthly' as never, note: '', options: { includeLayoutSheet: false, include8760: false } })).resolves.toEqual({ error: 'Unknown report type.' })
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: 'x'.repeat(2001), options: { includeLayoutSheet: false, include8760: false } })).resolves.toEqual({ error: 'The revision note is too long (2000 characters at most).' })
    expect(h.gen).not.toHaveBeenCalled()
  })
  it('records audit + product event on success, with a trimmed note', async () => {
    await expect(generateSolarReportAction({ projectId: P, kind: 'feasibility', note: '  Rev B ', options: { includeLayoutSheet: false, include8760: true } }))
      .resolves.toEqual({ ok: true, reportId: 'rep1', version: 2, warning: null })
    expect(h.gen).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, kind: 'feasibility', note: 'Rev B', userId: 'u1', options: { includeLayoutSheet: false, include8760: true } }))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'report_generated', objectRef: { kind: 'feasibility', version: 2, reportId: 'rep1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_report_generated', properties: { kind: 'feasibility' } })
  })
  it('passes the refusal through without side effects', async () => {
    h.gen.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } }))
      .resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('rate-limits per user', async () => {
    h.rateLimit.mockReturnValueOnce(false)
    await expect(generateSolarReportAction({ projectId: P, kind: 'technical', note: '', options: { includeLayoutSheet: false, include8760: false } }))
      .resolves.toEqual({ error: 'Too many reports at once — wait a minute and try again.' })
  })
})
```

- [ ] **Step 5: Run — FAIL. Implement** `apps/web/src/actions/solar-reports.actions.ts`:

```ts
'use server'
/**
 * Generate feasibility / technical report (spec §9.2 and the Overview shortcut §2.2).
 * Feasibility = Solar Edit + financials; technical = Solar Edit. The gate runs FIRST.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { rateLimit } from '@/lib/rate-limit'
import { generateSolarReport } from '@/lib/solar/reports/generate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const MAX_NOTE = 2000

export async function generateSolarReportAction(input: {
  projectId: string
  kind: 'feasibility' | 'technical'
  note: string | null
  options: { includeLayoutSheet: boolean; include8760: boolean }
}): Promise<{ ok: true; reportId: string; version: number; warning: string | null } | { error: string }> {
  if (input.kind !== 'feasibility' && input.kind !== 'technical') return { error: 'Unknown report type.' }
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, input.kind === 'feasibility' ? 'edit_financials' : 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > MAX_NOTE)) {
    return { error: 'The revision note is too long (2000 characters at most).' }
  }
  if (!rateLimit(`solar-report:${user.id}`, 6, 60_000)) return { error: 'Too many reports at once — wait a minute and try again.' }
  const o = input.options ?? { includeLayoutSheet: false, include8760: false }
  const note = input.note?.trim() || null
  const r = await generateSolarReport({
    projectId: input.projectId, kind: input.kind, note,
    options: { includeLayoutSheet: o.includeLayoutSheet === true, include8760: o.include8760 === true },
    userId: user.id, user: supabase, svc: createServiceClient() as unknown as AnyClient,
  })
  if (!r.ok) return { error: r.error }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'report_generated', objectRef: { kind: input.kind, version: r.version, reportId: r.reportId } })
  await emitProductEvent({ actorId: user.id, projectId: input.projectId, event: 'solar_report_generated', properties: { kind: input.kind } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, reportId: r.reportId, version: r.version, warning: r.warning }
}
```

- [ ] **Step 6: Make the report-kind scanner guard the new writers.** In `report-kind-access.contract.test.ts`, extend the expected list in "finds the known report writers" to:
```ts
    for (const expected of ['tenant_schedule', 'qc', 'snag', 'valuation', 'inspection', 'site_form', 'solar_feasibility', 'solar_technical']) {
```
(`solar_proposal` joins it in Task 21 when its writer exists.)

- [ ] **Step 7: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports src/actions/solar-reports src/lib/reports/report-kind-access 2>&1 | tail -5
git add apps/web/src/lib/solar/audit.ts apps/web/src/lib/solar/reports/generate.ts apps/web/src/lib/solar/reports/generate.test.ts \
  apps/web/src/actions/solar-reports.actions.ts apps/web/src/actions/solar-reports.actions.test.ts apps/web/src/lib/reports/report-kind-access.contract.test.ts
git commit -m "feat(solar): generate feasibility and technical reports from the stored run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: `notify_solar_email` through the settings chain

**Files:**
- Modify: `packages/shared/src/schemas/project-settings.schema.ts` (schema ~line 76, defaults ~line 118)
- Modify: `packages/shared/src/services/_project-settings-mappers.ts` (row type ~38, `rowToSettings` ~83, `patchToRow` ~116)
- Modify: `packages/shared/src/services/project-settings.service.ts` (`restore` ~309, `getNotificationConfig` ~388 and ~405)
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/integrations/IntegrationsPanel.tsx`, `page.tsx`
- Create: `apps/web/src/lib/solar/proposals/email-toggle.ts`, `email-toggle.test.ts`

- [ ] **Step 1: Failing test** `apps/web/src/lib/solar/proposals/email-toggle.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ cfg: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), projectSettingsService: { getNotificationConfig: h.cfg } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { solarEmailEnabled } from './email-toggle'

describe('solarEmailEnabled', () => {
  it('reads cfg.solarEmail', async () => {
    h.cfg.mockResolvedValueOnce({ solarEmail: true })
    await expect(solarEmailEnabled('p1')).resolves.toBe(true)
    h.cfg.mockResolvedValueOnce({ solarEmail: false })
    await expect(solarEmailEnabled('p1')).resolves.toBe(false)
  })
  it('fails CLOSED (no email) on a read error', async () => {
    h.cfg.mockRejectedValueOnce(new Error('boom'))
    await expect(solarEmailEnabled('p1')).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run the new test and the toggle contract — expect FAIL.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/proposals/email-toggle.test.ts 'src/app/(admin)/projects/[id]/settings/integrations' 2>&1 | tail -8
```

- [ ] **Step 3: Wire the column.**

`project-settings.schema.ts` — after `notifyFormEmail: z.boolean(),` add `notifySolarEmail: z.boolean(),`; in the defaults after `notifyFormEmail: true,` add `notifySolarEmail: true,` (mirrors the column DEFAULT TRUE in 00216).

`_project-settings-mappers.ts` — row type: after `notify_form_email: boolean` add `notify_solar_email: boolean`; `rowToSettings`: after `notifyFormEmail: row.notify_form_email,` add `notifySolarEmail: row.notify_solar_email,`; `patchToRow`: after the `notifyFormEmail` line add
```ts
  if (patch.notifySolarEmail !== undefined) out.notify_solar_email = patch.notifySolarEmail
```

`project-settings.service.ts` — in `restore`'s patch after `notifyFormEmail: snap.notifyFormEmail,` add `notifySolarEmail: snap.notifySolarEmail,`; in `getNotificationConfig` add `solarEmail: projectSettingsDefaults.notifySolarEmail,` to the defaults object and `solarEmail: s.notifySolarEmail,` to the returned one.

`IntegrationsPanel.tsx` — add `| 'notifySolarEmail'` to `ToggleField`; `initialNotifySolarEmail: boolean` to `Props` and the destructuring; `notifySolarEmail: initialNotifySolarEmail,` to the `useState` object; and append to `TOGGLES`:
```ts
    {
      field: 'notifySolarEmail',
      label: 'Solar proposal email notifications',
      description:
        'Allow emailing an issued Solar proposal link to the client, and email the proposer when the client accepts or declines. Turning this off leaves the in-app notification in place.',
    },
```
`page.tsx` — after the `notifyFormEmail` fallback add `const notifySolarEmail = settings?.notifySolarEmail ?? true` (the column DEFAULT is TRUE), and pass `initialNotifySolarEmail={notifySolarEmail}` to `<IntegrationsPanel>`.

- [ ] **Step 4: Implement the consumer** `apps/web/src/lib/solar/proposals/email-toggle.ts`:

```ts
import 'server-only'
/**
 * Project toggle `notify_solar_email` (00216). Gates the optional client email at Issue and the
 * proposer's accept/decline email; the in-app bell is never gated. Fails CLOSED: a read error sends
 * no email (probes on WM projects resolve 12-13 real recipients).
 */
import { projectSettingsService } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'

export async function solarEmailEnabled(projectId: string): Promise<boolean> {
  try {
    const cfg = await projectSettingsService.getNotificationConfig(createServiceClient() as never, projectId)
    return Boolean(cfg.solarEmail)
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Run — PASS (the contract test finds the consumer `.solarEmail`, the control, the page prop and the restore line).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- project-settings 2>&1 | tail -3
pnpm --filter web test -- src/lib/solar/proposals/email-toggle.test.ts 'src/app/(admin)/projects/[id]/settings/integrations' 2>&1 | tail -4
git add packages/shared/src/schemas/project-settings.schema.ts packages/shared/src/services/_project-settings-mappers.ts packages/shared/src/services/project-settings.service.ts \
  'apps/web/src/app/(admin)/projects/[id]/settings/integrations' apps/web/src/lib/solar/proposals/email-toggle.ts apps/web/src/lib/solar/proposals/email-toggle.test.ts
git commit -m "feat(solar): notify_solar_email project toggle, wired end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Proposal libs — share token and the prepared snapshot

**Files:**
- Create: `apps/web/src/lib/solar/proposals/token.ts`, `token.test.ts`
- Create: `apps/web/src/lib/solar/proposals/prepare.ts`, `prepare.test.ts`

- [ ] **Step 1: Failing test** `token.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { hashShareToken, isShareToken, newShareToken } from './token'

describe('share token (spec §5 item 6)', () => {
  it('is 32 random bytes, base64url (43 chars), and differs every time', () => {
    const a = newShareToken(), b = newShareToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
  })
  it('stores only the SHA-256 hex of the token — the same formula as solar.proposal_hash_token()', () => {
    const { token, hash } = newShareToken()
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(hashShareToken(token)).toBe(hash)
  })
  it('recognises only the token shape (the stored hash is not a token)', () => {
    const { token, hash } = newShareToken()
    expect(isShareToken(token)).toBe(true)
    expect(isShareToken(hash)).toBe(false)
    expect(isShareToken('short')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `token.ts`:

```ts
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

const SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The raw token leaves the server exactly once (the link shown after Issue / New link). */
export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashShareToken(token) }
}

/** = solar.proposal_hash_token(): encode(sha256(convert_to(token, 'UTF8')), 'hex'). */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export const isShareToken = (s: unknown): s is string => typeof s === 'string' && SHAPE.test(s)
```
(`token.test.ts` needs `vi.mock('server-only', () => ({}))` only if the repo's vitest config does not already alias `server-only` — it does, per `apps/web/vitest.config.ts`.)

- [ ] **Step 3: Failing test** `prepare.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sel: vi.fn(), tariff: vi.fn(), gz: vi.fn(async () => 'csv'), run: vi.fn(), decode: vi.fn(() => ({ hours: 8760 })) }))
vi.mock('@/lib/solar/reports/selected-case', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/reports/selected-case')>()), loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))
vi.mock('@/lib/solar/cases/storage', () => ({ getGzipText: h.gz, RUNS_BUCKET: 'solar-runs' }))
vi.mock('@esite/shared/solar-cases', async (orig) => ({ ...(await orig<typeof import('@esite/shared/solar-cases')>()), runStoredFinancials: h.run, decodeHourlyCsv: h.decode }))

import { defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { prepareProposalSnapshot, PREPARE_ERRORS } from './prepare'
import { fakeSupabase } from '@/test/fake-supabase'

const settings = readSolarOrgSettings(null)
const cfg = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })
const fin = {
  ...defaultFinanceConfig(settings),
  capex: [
    { id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 2, qualifies12b: true, source: 'manual' },
    { id: 'b', category: 'margin', description: 'Old margin line', qty: 1, unit: 'lot', rateZar: 100_000, qualifies12b: false, source: 'manual' },
  ],
  models: { ...defaultFinanceConfig(settings).models, cash: { ...defaultFinanceConfig(settings).models.cash, enabled: true } },
}
const outputs = { kpis: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, deliveredKwh: 840_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.83, solarFraction: 0.58, exportKwh: 140_000 }, provenance: { engineVersion: '0.1.0' } }
const sel = {
  ok: true, shared: { study: { id: 's1', organisation_id: 'o1' } },
  caseRow: { id: 'c1', name: 'Base', pv_source: 'manual', layout_id: null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00Z', inputsHash: 'a'.repeat(64), outputs, configSnapshot: cfg, hourlyPath: 'o1/r1.csv.gz' },
}
const draft = { clientName: 'Acme', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: 'S ≤ Ω', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: 'T', narrative: '' }
const finResult = { year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 1, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_150_000, npvZar: 1, irr: 0.2, simplePaybackYears: 3, discountedPaybackYears: 4, rows: [{ netZar: 390_000, cumulativeZar: -760_000 }] }] }] } }

const args = (over: Record<string, unknown> = {}) => {
  const user = fakeSupabase({ tables: { 'solar.case_financials': [{ case_id: 'c1', config: fin }] } }).client
  const svc = fakeSupabase({ tables: {
    'projects.projects': [{ id: 'p1', name: 'Acme Mall', address: '1 Main Rd', city: null, province: null }],
    'public.organisations': [{ id: 'o1', name: 'Sun Co' }], 'solar.proposal_templates': [{ organisation_id: 'o1', disclaimer_text: 'D' }],
  } }).client
  return {
    user: user as never, svc: svc as never, projectId: 'p1',
    proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft },
    actor: { id: 'u1', name: 'Pat', email: 'pat@sun.example' },
    issuedAt: new Date('2026-09-29T08:00:00.000Z'),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sel.mockResolvedValue(sel)
  h.tariff.mockResolvedValue({ ok: true, calc: {}, tariffRef: { tariffId: 't', tariffName: 'B1', financialYear: '2026/27', licenseeName: 'City' } })
  h.run.mockReturnValue(finResult)
})

describe('prepareProposalSnapshot', () => {
  it('prices capex (minus margin lines) + margin, runs finance on the STORED run at the offer price, freezes a sanitised snapshot', async () => {
    const r = await prepareProposalSnapshot(args())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // base = 1 000 000 (modules) — the 100 000 "margin" capex line is excluded; offer = base × 1.15
    expect(r.snapshot.price).toEqual({ offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500 })
    const fi = h.run.mock.calls[0]![1] as { capex: { totalZar: number }; models: Array<{ kind: string }> }
    expect(fi.capex.totalZar).toBe(1_150_000)
    expect(fi.models.map((m) => m.kind)).toEqual(['cash'])
    expect(h.gz).toHaveBeenCalledWith(expect.anything(), 'solar-runs', 'o1/r1.csv.gz')
    expect(r.snapshot.bills).toEqual({ beforeZar: 1_000_000, afterZar: 600_000, savingZar: 400_000 })
    expect(r.snapshot.proposal.validUntil).toBe('2026-10-29T08:00:00.000Z')
    expect(r.snapshot.text.summary).toBe('S <= Ohm')
    expect(r.snapshot.issuer).toEqual({ orgName: 'Sun Co', proposerName: 'Pat', proposerEmail: 'pat@sun.example' })
    expect(r.runId).toBe('r1')
    expect(JSON.stringify(r.snapshot)).not.toContain('marginPct')
  })
  it('refuses when the selected case is Stale', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    await expect(prepareProposalSnapshot(args())).resolves.toEqual({ ok: false, error: 'The selected case is stale — re-run it first.' })
  })
  it('refuses when the draft’s case is no longer the selected case', async () => {
    await expect(prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c-other', draft } })))
      .resolves.toEqual({ ok: false, error: PREPARE_ERRORS.caseChanged })
  })
  it('names an offered model with no inputs on the case', async () => {
    await expect(prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft: { ...draft, financeOptions: ['cash', 'lease'] } } })))
      .resolves.toEqual({ ok: false, error: 'Enable Lease / rent-to-own on the Financials tab first — its inputs live there.' })
  })
  it('passes the tariff reason through (Run financials needs a pinned tariff)', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(prepareProposalSnapshot(args())).resolves.toEqual({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
  it('returns field errors for an incomplete draft', async () => {
    const r = await prepareProposalSnapshot(args({ proposal: { id: 'pr1', family_id: 'pr1', version: 1, case_id: 'c1', draft: { ...draft, clientName: '' } } }))
    expect(r).toMatchObject({ ok: false, error: PREPARE_ERRORS.incomplete, fieldErrors: { clientName: 'Enter the client name' } })
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** `apps/web/src/lib/solar/proposals/prepare.ts`:

```ts
import 'server-only'
/**
 * Build the frozen proposal snapshot (spec §9.3) from the SELECTED case's stored run. Finance options
 * are the engine's (D-15), computed on the STORED hourly series at the offer price — the 4b
 * runStoredFinancials path, not a re-simulation. Used by Preview (watermarked) and Issue (frozen).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildFinanceInput, capexTotals, decodeHourlyCsv, parseCaseConfig, parseFinanceConfig, runStoredFinancials,
} from '@esite/shared/solar-cases'
import { inputsHash } from '@esite/shared/solar-engine'
import {
  FINANCE_OPTION_LABELS, buildProposalSnapshot, offerBaseZar, offerPrice, parseProposalDraft, proposalFinanceInput,
  summariseFinanceOptions, type ProposalSnapshot,
} from '@esite/shared/solar-reports'
import { loadSelectedCase } from '@/lib/solar/reports/selected-case'
import { resolveStudyTariff } from '@/lib/solar/cases/tariff'
import { getGzipText, RUNS_BUCKET } from '@/lib/solar/cases/storage'
import { pdfText } from '@/lib/solar/reports/pdf-text'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const PREPARE_ERRORS = {
  incomplete: 'The proposal is incomplete — check the highlighted fields.',
  caseChanged: 'The selected case changed since this draft was saved — save the draft again to use it.',
  noFinancials: 'Save the Financials tab for the selected case first.',
  badFinancials: 'The saved financials are invalid — review them on the Financials tab.',
  badRun: 'The run’s stored configuration could not be read — re-run the case.',
  noCapex: 'Add capex on the Financials tab first.',
  compute: 'The finance options could not be computed — try again.',
} as const

export interface PrepareInput {
  user: AnyClient
  svc: AnyClient
  projectId: string
  proposal: { id: string; family_id: string; version: number; case_id: string | null; draft: unknown }
  actor: { id: string; name: string; email: string | null }
  issuedAt: Date
}
export type PrepareResult =
  | { ok: true; snapshot: ProposalSnapshot; runId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function prepareProposalSnapshot(a: PrepareInput): Promise<PrepareResult> {
  const sel = await loadSelectedCase(a.user, a.svc, a.projectId)
  if (!sel.ok) return { ok: false, error: sel.reason }
  if (a.proposal.case_id !== sel.caseRow.id) return { ok: false, error: PREPARE_ERRORS.caseChanged }
  const d = parseProposalDraft(a.proposal.draft)
  if (!d.ok) return { ok: false, error: PREPARE_ERRORS.incomplete, fieldErrors: d.errors }
  const draft = d.draft

  const { data: finRows } = await a.user.schema('solar').from('case_financials').select('config').eq('case_id', sel.caseRow.id)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  if (!finRow) return { ok: false, error: PREPARE_ERRORS.noFinancials }
  const fin = parseFinanceConfig(finRow.config)
  if (!fin.ok) return { ok: false, error: PREPARE_ERRORS.badFinancials }
  const cfg = parseCaseConfig(sel.run.configSnapshot)
  if (!cfg.ok) return { ok: false, error: PREPARE_ERRORS.badRun }
  const k = sel.run.outputs.kpis

  const base = offerBaseZar(capexTotals(fin.fin.capex, k.dcKwp))
  if (!(base > 0)) return { ok: false, error: PREPARE_ERRORS.noCapex }
  const price = offerPrice(base, draft.marginPct)

  const built = buildFinanceInput(fin.fin, cfg.config, { dcKwp: k.dcKwp, acKw: k.acKw })
  if (!built.ok) return { ok: false, error: built.reasons.join(' ') }
  const priced = proposalFinanceInput(built.input, price.offerExclVatZar, draft.financeOptions)
  if (!priced.ok) {
    return { ok: false, error: `Enable ${priced.missing.map((m) => FINANCE_OPTION_LABELS[m]).join(', ')} on the Financials tab first — its inputs live there.` }
  }
  const tariff = await resolveStudyTariff(a.svc, a.projectId)
  if (!tariff.ok) return { ok: false, error: tariff.reason }

  let options: ReturnType<typeof summariseFinanceOptions>
  let bills: { beforeZar: number; afterZar: number }
  try {
    const hourly = decodeHourlyCsv(await getGzipText(a.svc, RUNS_BUCKET, sel.run.hourlyPath))
    const result = runStoredFinancials({ hourly, year1PvKwh: k.annualAcKwh, year1DeliveredKwh: k.deliveredKwh }, priced.input, tariff.calc)
    options = summariseFinanceOptions(result.finance, priced.input.models)
    bills = { beforeZar: result.year1Bills.beforeZar, afterZar: result.year1Bills.afterZar }
  } catch (e) {
    console.error('[solar-proposal] finance failed', { projectId: a.projectId, err: String(e) })
    return { ok: false, error: PREPARE_ERRORS.compute }
  }

  const [{ data: proj }, { data: org }, { data: tpl }] = await Promise.all([
    a.svc.schema('projects').from('projects').select('name, address, city, province').eq('id', a.projectId).maybeSingle(),
    a.svc.from('organisations').select('name').eq('id', sel.shared.study.organisation_id).maybeSingle(),
    a.svc.schema('solar').from('proposal_templates').select('disclaimer_text').eq('organisation_id', sel.shared.study.organisation_id).maybeSingle(),
  ])
  const p = (proj ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const validUntil = new Date(a.issuedAt.getTime() + draft.validityDays * 86_400_000).toISOString()

  const snapshot = buildProposalSnapshot({
    proposal: { id: a.proposal.id, familyId: a.proposal.family_id, version: a.proposal.version, title: `Solar PV proposal for ${draft.clientName}`, issuedAt: a.issuedAt.toISOString(), validUntil },
    issuer: { orgName: ((org as Row | null)?.name as string | undefined) ?? 'Organisation', proposerName: a.actor.name, proposerEmail: a.actor.email },
    project: { name: p.name ?? '', address },
    case: { id: sel.caseRow.id, name: sel.caseRow.name, runId: sel.run.id, inputsHash: sel.run.inputsHash, engineVersion: sel.run.outputs.provenance.engineVersion, runFinishedAt: sel.run.finishedAt },
    kpis: k, price, bills, financeOptions: options, draft,
    disclaimer: ((tpl as Row | null)?.disclaimer_text as string | undefined) ?? '',
    provenance: { financeInputsHash: inputsHash({ input: priced.input, tariffRef: tariff.tariffRef, runId: sel.run.id }), tariff: tariff.tariffRef },
  }, pdfText)
  return { ok: true, snapshot, runId: sel.run.id }
}
```

- [ ] **Step 5: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/proposals 2>&1 | tail -5
git add apps/web/src/lib/solar/proposals/token.ts apps/web/src/lib/solar/proposals/token.test.ts apps/web/src/lib/solar/proposals/prepare.ts apps/web/src/lib/solar/proposals/prepare.test.ts
git commit -m "feat(solar): share tokens and the prepared proposal snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Draft actions (create / save / delete / revise) + org templates action

**Files:**
- Create: `apps/web/src/actions/solar-proposals.actions.ts`, `solar-proposals.actions.test.ts` (drafts part; Task 21/22 append)
- Create: `apps/web/src/actions/solar-proposal-templates.actions.ts`, `solar-proposal-templates.actions.test.ts`

- [ ] **Step 1: Failing test** `solar-proposals.actions.test.ts` (this file is extended in Tasks 21–22; keep its `h` and imports at the top):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), rateLimit: vi.fn(() => true),
  prepare: vi.fn(), brandData: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-proposal')),
  token: vi.fn(() => ({ token: 'T'.repeat(43), hash: 'f'.repeat(64) })), emailOn: vi.fn(async () => false), sendClients: vi.fn(async () => 0),
  narrative: vi.fn(), narrativeAvailable: vi.fn(() => true),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/proposals/prepare', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/prepare')>()), prepareProposalSnapshot: h.prepare }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brandData }))
vi.mock('@/lib/solar/reports/render-proposal', () => ({ renderProposalPdf: h.render }))
vi.mock('@/lib/solar/proposals/token', () => ({ newShareToken: h.token }))
vi.mock('@/lib/solar/proposals/email-toggle', () => ({ solarEmailEnabled: h.emailOn }))
vi.mock('@/lib/solar/proposals/notify', () => ({ sendProposalToClients: h.sendClients }))
vi.mock('@/lib/solar/proposals/narrative', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/narrative')>()), draftNarrative: h.narrative, narrativeAvailable: h.narrativeAvailable }))

import {
  createSolarProposalAction, saveSolarProposalDraftAction, deleteSolarProposalDraftAction, reviseSolarProposalAction,
} from './solar-proposals.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

export const P = '11111111-1111-4111-8111-111111111111'
export const PR = '22222222-2222-4222-8222-222222222222'
export const U = 'user-1'
const STALE = 'Someone else changed this — reload to see their version.'
export const goodDraft = {
  clientName: 'Acme Retail', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: '', scope: '', priceTerms: '',
  assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '',
}

export function setupUser(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: U, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
export function setupSvc(extra: Partial<FakeOptions> = {}) {
  const svc = withStorage(fakeSupabase(extra))
  h.createServiceClient.mockReturnValue(svc.client)
  return svc
}
export { h }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_SITE_URL
  h.requireSolarLevel.mockResolvedValue('edit_financials')
  h.emailOn.mockResolvedValue(false)
  h.rateLimit.mockReturnValue(true)
  h.narrativeAvailable.mockReturnValue(true)
})

describe('createSolarProposalAction', () => {
  it('gates Edit + financials FIRST', async () => {
    setupUser(); setupSvc()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(createSolarProposalAction({ projectId: P })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
  })
  it('needs a selected case', async () => {
    setupUser({ tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', selected_case_id: null }] } }); setupSvc()
    await expect(createSolarProposalAction({ projectId: P })).resolves.toEqual({ error: 'Choose a selected case on the Overview first.' })
  })
  it('drafts from the selected case with org defaults (margin from the rate card, validity + terms from templates, enabled models)', async () => {
    const user = setupUser({
      tables: {
        'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', selected_case_id: 'c1' }],
        'projects.projects': [{ id: P, client_name: 'Acme Retail' }],
        'solar.case_financials': [{ case_id: 'c1', config: { models: { cash: { enabled: true }, debt: { enabled: false }, ppa: { enabled: true }, lease: { enabled: false } } } }],
      },
      writes: { 'solar.proposals:insert': { data: [{ id: PR, version: 1 }] } },
    })
    setupSvc({ tables: {
      'solar.org_settings': [{ organisation_id: 'o1', settings: { version: 1, values: { rc_margin_pct: 12 } } }],
      'solar.proposal_templates': [{ organisation_id: 'o1', terms_text: 'Org terms', validity_days: 45 }],
    } })
    await expect(createSolarProposalAction({ projectId: P })).resolves.toEqual({ ok: true, proposalId: PR })
    const ins = callsTo(user.calls, 'solar.proposals', 'insert')[0]!.payload as { study_id: string; case_id: string; draft: Record<string, unknown> }
    expect(ins.study_id).toBe('s1')
    expect(ins.case_id).toBe('c1')
    expect(ins.draft).toMatchObject({ clientName: 'Acme Retail', marginPct: 12, validityDays: 45, terms: 'Org terms', financeOptions: ['cash', 'ppa'] })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'proposal_created', objectRef: { proposalId: PR, version: 1 } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_proposal_created' })
  })
})

describe('saveSolarProposalDraftAction', () => {
  it('returns field errors without writing', async () => {
    const user = setupUser(); setupSvc()
    const r = await saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: { ...goodDraft, clientName: '' }, expectedUpdatedAt: 'T0' })
    expect(r).toEqual({ fieldErrors: { clientName: 'Enter the client name' } })
    expect(user.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
  it('saves only a draft, stale-guarded, pointing it at the CURRENT selected case', async () => {
    const user = setupUser({
      tables: { 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c2' }] },
      writes: { 'solar.proposals:update': { data: [{ updated_at: 'T1' }] } },
    }); setupSvc()
    await expect(saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: goodDraft, expectedUpdatedAt: 'T0' })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    const up = callsTo(user.calls, 'solar.proposals', 'update')[0]!
    expect(up.payload).toEqual({ draft: goodDraft, case_id: 'c2' })
    expect(up.filters).toEqual(expect.arrayContaining([['eq', 'id', PR], ['eq', 'project_id', P], ['eq', 'status', 'draft'], ['eq', 'updated_at', 'T0']]))
  })
  it('zero rows = stale', async () => {
    setupUser({ tables: { 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c2' }] }, writes: { 'solar.proposals:update': { data: [] } } }); setupSvc()
    await expect(saveSolarProposalDraftAction({ projectId: P, proposalId: PR, draft: goodDraft, expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
  })
})

describe('deleteSolarProposalDraftAction / reviseSolarProposalAction', () => {
  it('deletes a draft only', async () => {
    const user = setupUser({ writes: { 'solar.proposals:delete': { data: [] } } }); setupSvc()
    await expect(deleteSolarProposalDraftAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'Only a draft can be deleted — withdraw an issued proposal instead.' })
    expect(callsTo(user.calls, 'solar.proposals', 'delete')[0]!.filters).toContainEqual(['eq', 'status', 'draft'])
  })
  it('revise copies the latest version’s draft into v(n+1) on the current selected case', async () => {
    const user = setupUser({
      tables: {
        'solar.proposals': [{ id: PR, project_id: P, study_id: 's1', family_id: PR, version: 1, status: 'issued', draft: goodDraft }],
        'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c3' }],
      },
      writes: { 'solar.proposals:insert': { data: [{ id: 'new', version: 2 }] } },
    }); setupSvc()
    await expect(reviseSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ ok: true, proposalId: 'new', version: 2 })
    expect(callsTo(user.calls, 'solar.proposals', 'insert')[0]!.payload).toEqual({ study_id: 's1', family_id: PR, case_id: 'c3', draft: goodDraft })
  })
  it('words the database refusals', async () => {
    setupUser({
      tables: { 'solar.proposals': [{ id: PR, project_id: P, study_id: 's1', family_id: PR, version: 1, status: 'issued', draft: goodDraft }], 'solar.studies': [{ id: 's1', project_id: P, selected_case_id: 'c3' }] },
      writes: { 'solar.proposals:insert': { error: { code: '23505', message: 'proposals_one_draft_per_family' } } },
    }); setupSvc()
    await expect(reviseSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'A draft of this proposal already exists — edit it instead.' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** the first part of `apps/web/src/actions/solar-proposals.actions.ts`:

```ts
'use server'
/**
 * Solar proposals (spec §9.3). Every action gates Solar Edit + financials FIRST (proposals are a
 * money table). Drafts are written through the caller's session — 00216's RLS and guard decide.
 * Issue / withdraw / new link run the SERVICE-ONLY definer functions after the gate (Task 21).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { defaultProposalDraft, parseProposalDraft, readProposalDraft, type FinanceOptionKind } from '@esite/shared/solar-reports'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

const NO_SELECTION = 'Choose a selected case on the Overview first.'
const revalidate = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

async function selectedCase(supabase: AnyClient, projectId: string): Promise<{ studyId: string; orgId: string; caseId: string } | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, organisation_id, selected_case_id').eq('project_id', projectId).maybeSingle()
  const s = data as Row | null
  if (!s?.selected_case_id) return null
  return { studyId: String(s.id), orgId: String(s.organisation_id ?? ''), caseId: String(s.selected_case_id) }
}

export async function createSolarProposalAction(input: { projectId: string }): Promise<{ ok: true; proposalId: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const svc = createServiceClient() as unknown as AnyClient
  const [{ data: proj }, { data: finRows }, { data: os }, { data: tpl }] = await Promise.all([
    g.supabase.schema('projects').from('projects').select('client_name').eq('id', input.projectId).maybeSingle(),
    g.supabase.schema('solar').from('case_financials').select('config').eq('case_id', sel.caseId),
    svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', sel.orgId).maybeSingle(),
    svc.schema('solar').from('proposal_templates').select('terms_text, validity_days').eq('organisation_id', sel.orgId).maybeSingle(),
  ])
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  const fin = finRow ? parseFinanceConfig(finRow.config) : null
  const models = (fin?.ok ? fin.fin.models : (finRow?.config as { models?: Record<string, { enabled?: boolean }> } | undefined)?.models) ?? {}
  const enabledKinds = (['cash', 'debt', 'ppa', 'lease'] as FinanceOptionKind[]).filter((k) => (models as Record<string, { enabled?: boolean }>)[k]?.enabled)
  const margin = readSolarOrgSettings((os as Row | null)?.settings ?? null).rc_margin_pct
  const t = tpl as Row | null
  const draft = defaultProposalDraft({
    clientName: ((proj as Row | null)?.client_name as string | null) ?? null,
    marginPct: typeof margin === 'number' ? margin : null,
    validityDays: typeof t?.validity_days === 'number' ? (t.validity_days as number) : null,
    termsText: (t?.terms_text as string | null) ?? null,
    enabledKinds,
  })
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .insert({ study_id: sel.studyId, case_id: sel.caseId, draft }).select('id, version')
  if (error) return { error: humanSolarError(error) }
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
  if (!row?.id) return { error: humanSolarError(null) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_created', objectRef: { proposalId: row.id, version: row.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_created' })
  revalidate(input.projectId)
  return { ok: true, proposalId: String(row.id) }
}

export async function saveSolarProposalDraftAction(input: { projectId: string; proposalId: string; draft: unknown; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const d = parseProposalDraft(input.draft)
  if (!d.ok) return { fieldErrors: d.errors }
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .update({ draft: d.draft, case_id: sel.caseId })
    .eq('id', input.proposalId).eq('project_id', input.projectId).eq('status', 'draft').eq('updated_at', input.expectedUpdatedAt)
    .select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidate(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

export async function deleteSolarProposalDraftAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .delete().eq('id', input.proposalId).eq('project_id', input.projectId).eq('status', 'draft').select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Only a draft can be deleted — withdraw an issued proposal instead.' }
  revalidate(input.projectId)
  return { ok: true }
}

export async function reviseSolarProposalAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true; proposalId: string; version: number } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data: src } = await g.supabase.schema('solar').from('proposals')
    .select('id, study_id, family_id, version, status, draft').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const s = src as Row | null
  if (!s) return { error: 'This proposal no longer exists — reload.' }
  if (s.status === 'draft') return { error: 'Edit the draft instead of revising it.' }
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .insert({ study_id: s.study_id, family_id: s.family_id, case_id: sel.caseId, draft: readProposalDraft(s.draft) }).select('id, version')
  if (error) {
    if (error.code === '23505') return { error: 'A draft of this proposal already exists — edit it instead.' }
    if (error.code === '23514' && /accepted/.test(error.message ?? '')) return { error: 'An accepted proposal cannot be revised.' }
    return { error: humanSolarError(error) }
  }
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
  if (!row?.id) return { error: humanSolarError(null) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_created', objectRef: { proposalId: row.id, version: row.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_created' })
  revalidate(input.projectId)
  return { ok: true, proposalId: String(row.id), version: Number(row.version) }
}
```
Note the revise test's expected payload is `draft: goodDraft` — `readProposalDraft(goodDraft)` returns an equal object.

- [ ] **Step 3: Failing test** `apps/web/src/actions/solar-proposal-templates.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ createClient: vi.fn(), ctx: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.ctx }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
import { saveSolarProposalTemplatesAction } from './solar-proposal-templates.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

beforeEach(() => {
  vi.clearAllMocks()
  h.ctx.mockResolvedValue({ userId: 'u1', organisationId: 'o1', role: 'admin' })
  h.requireRole.mockResolvedValue({ ok: true })
})

describe('saveSolarProposalTemplatesAction', () => {
  it('owner/admin only (the result object, .ok)', async () => {
    h.createClient.mockResolvedValue(fakeSupabase().client)
    h.requireRole.mockResolvedValue({ ok: false, error: 'nope' })
    await expect(saveSolarProposalTemplatesAction({ termsText: '', disclaimerText: '', validityDays: 30, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change proposal templates.' })
  })
  it('validates, then inserts the first time', async () => {
    const f = fakeSupabase({ writes: { 'solar.proposal_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 400, expectedUpdatedAt: null }))
      .resolves.toEqual({ fieldErrors: { validityDays: 'Between 1 and 365 days' } })
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 45, expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.proposal_templates', 'insert')[0]!.payload).toEqual({ organisation_id: 'o1', terms_text: 'T', disclaimer_text: 'D', validity_days: 45 })
  })
  it('updates stale-guarded afterwards', async () => {
    const f = fakeSupabase({ writes: { 'solar.proposal_templates:update': { data: [] } } })
    h.createClient.mockResolvedValue(f.client)
    await expect(saveSolarProposalTemplatesAction({ termsText: 'T', disclaimerText: 'D', validityDays: 30, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** `apps/web/src/actions/solar-proposal-templates.actions.ts`:

```ts
'use server'
/** Org proposal templates (spec §11 "Branding for Solar reports": disclaimer and terms). Owner/admin. */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function saveSolarProposalTemplatesAction(input: {
  termsText: string; disclaimerText: string; validityDays: number; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const g = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!g.ok) return { error: 'Only an organisation owner or admin can change proposal templates.' }
  const errors: Record<string, string> = {}
  if (typeof input.termsText !== 'string' || input.termsText.length > 20000) errors.termsText = 'At most 20000 characters'
  if (typeof input.disclaimerText !== 'string' || input.disclaimerText.length > 5000) errors.disclaimerText = 'At most 5000 characters'
  if (!Number.isInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > 365) errors.validityDays = 'Between 1 and 365 days'
  if (Object.keys(errors).length) return { fieldErrors: errors }
  const values = { terms_text: input.termsText, disclaimer_text: input.disclaimerText, validity_days: input.validityDays }
  const t = () => supabase.schema('solar').from('proposal_templates')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ organisation_id: ctx.organisationId, ...values }).select('updated_at')
    : await t().update(values).eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String((data[0] as { updated_at: string }).updated_at) }
}
```

- [ ] **Step 5: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/actions/solar-proposals.actions.test.ts src/actions/solar-proposal-templates 2>&1 | tail -5
git add apps/web/src/actions/solar-proposals.actions.ts apps/web/src/actions/solar-proposals.actions.test.ts apps/web/src/actions/solar-proposal-templates.actions.ts apps/web/src/actions/solar-proposal-templates.actions.test.ts
git commit -m "feat(solar): proposal draft actions and org proposal templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Preview route; Issue / Withdraw / New link; client email

**Files:**
- Create: `apps/web/src/lib/solar/proposals/notify.ts`, `notify.test.ts`
- Create: `apps/web/src/app/api/projects/[id]/solar/proposals/[proposalId]/preview/route.ts`, `route.test.ts`
- Modify: `apps/web/src/actions/solar-proposals.actions.ts` (+ test)
- Modify: `apps/web/src/lib/reports/report-kind-access.contract.test.ts` (scanner expects `solar_proposal`)

- [ ] **Step 1: Failing test** `apps/web/src/lib/solar/proposals/notify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ filter: vi.fn(async (_c: unknown, e: string[]) => ({ allowed: e, suppressed: [] })), notify: vi.fn(async () => {}), enabled: vi.fn(async () => false), svc: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), filterSuppressed: h.filter }))
vi.mock('@/lib/solar/notify', () => ({ notifySolarUsers: h.notify }))
vi.mock('./email-toggle', () => ({ solarEmailEnabled: h.enabled }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { notifyProposalResponse, sendProposalToClients } from './notify'
import { fakeSupabase } from '@/test/fake-supabase'

const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  h.svc.mockReturnValue(fakeSupabase({ tables: { 'public.profiles': [{ id: 'u1', email: 'pat@sun.example', full_name: 'Pat' }], 'projects.projects': [{ id: 'p1', name: 'Acme Mall' }] } }).client)
})

describe('sendProposalToClients', () => {
  it('sends one branded email with the link, never the token hash, and HTML-escapes names', async () => {
    const n = await sendProposalToClients({ emails: ['c@acme.example'], projectName: 'Acme <Mall>', orgName: 'Sun Co', link: 'https://www.e-site.live/proposal/TOKEN', validUntil: '2026-10-29T08:00:00Z', accent: null })
    expect(n).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, { body: string }]
    expect(url).toBe('https://sb.test/functions/v1/send-email')
    const body = JSON.parse(init.body) as { payload: { to: string[]; subject: string; html: string } }
    expect(body.payload.to).toEqual(['c@acme.example'])
    expect(body.payload.html).toContain('https://www.e-site.live/proposal/TOKEN')
    expect(body.payload.html).toContain('Acme &lt;Mall&gt;')
    expect(body.payload.html).toContain('2026-10-29')
  })
  it('sends nothing for an empty list', async () => {
    await expect(sendProposalToClients({ emails: [], projectName: 'A', orgName: 'S', link: 'x', validUntil: '2026-10-29', accent: null })).resolves.toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notifyProposalResponse', () => {
  it('bells the issuer; emails only when the project toggle is on', async () => {
    await notifyProposalResponse({ projectId: 'p1', issuedBy: 'u1', version: 2, decision: 'accepted', actorName: 'Client Name' })
    expect(h.notify).toHaveBeenCalledWith(['u1'], ['pat@sun.example'], expect.objectContaining({
      type: 'solar_proposal_accepted', title: 'Proposal v2 accepted', body: 'Client Name accepted proposal v2 for Acme Mall.', route: '/projects/p1/solar/reports', email: false,
    }))
    h.enabled.mockResolvedValueOnce(true)
    await notifyProposalResponse({ projectId: 'p1', issuedBy: 'u1', version: 2, decision: 'declined', actorName: 'Client Name' })
    expect(h.notify).toHaveBeenLastCalledWith(['u1'], ['pat@sun.example'], expect.objectContaining({ type: 'solar_proposal_declined', email: true }))
  })
  it('does nothing without an issuer', async () => {
    await notifyProposalResponse({ projectId: 'p1', issuedBy: null, version: 1, decision: 'accepted', actorName: 'X' })
    expect(h.notify).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/proposals/notify.ts`:

```ts
import 'server-only'
/**
 * Proposal notifications. Never throws. The client email is sent ONLY when the issuer ticked it AND
 * the project's notify_solar_email is on (checked by the caller); the issuer's bell always fires on
 * a response, the email only with the toggle on. Uses send-email's `rfi-created` passthrough.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeHtml, filterSuppressed, renderBrandedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifySolarUsers } from '@/lib/solar/notify'
import { NEUTRAL_ACCENT } from '@/lib/solar/reports/branding'
import { solarEmailEnabled } from './email-toggle'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')

export async function sendProposalToClients(a: {
  emails: string[]; projectName: string; orgName: string; link: string; validUntil: string; accent: string | null
}): Promise<number> {
  if (a.emails.length === 0) return 0
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return 0
    const { allowed } = await filterSuppressed(createServiceClient() as never, a.emails)
    if (allowed.length === 0) return 0
    const title = `${a.orgName}: solar proposal for ${a.projectName}`
    const html = renderBrandedEmail({
      accentColor: a.accent && /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent : NEUTRAL_ACCENT,
      logoUrl: null,
      projectName: a.projectName,
      title,
      contentHtml:
        `<p>${escapeHtml(a.orgName)} has sent you a solar PV proposal for ${escapeHtml(a.projectName)}.</p>` +
        `<p><a href="${escapeHtml(a.link)}">Open the proposal</a> to read it, download the PDF, and accept or decline.</p>` +
        `<p>The offer is valid until ${escapeHtml(a.validUntil.slice(0, 10))}. The link is personal to you — please do not forward it.</p>`,
      siteUrl: siteUrl(),
    })
    const res = await fetch(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: allowed, subject: title, html } }),
    })
    if (!res.ok) { console.error('[solar-proposal] client email failed', { status: res.status }); return 0 }
    return allowed.length
  } catch (e) {
    console.error('[solar-proposal] client email threw', { err: String(e) })
    return 0
  }
}

export async function notifyProposalResponse(a: {
  projectId: string; issuedBy: string | null; version: number; decision: 'accepted' | 'declined'; actorName: string
}): Promise<void> {
  if (!a.issuedBy) return
  try {
    const svc = createServiceClient() as unknown as AnyClient
    const [{ data: prof }, { data: proj }] = await Promise.all([
      svc.from('profiles').select('email').eq('id', a.issuedBy).maybeSingle(),
      svc.schema('projects').from('projects').select('name').eq('id', a.projectId).maybeSingle(),
    ])
    const email = (prof as { email?: string | null } | null)?.email ?? null
    const projectName = (proj as { name?: string } | null)?.name ?? 'the project'
    const verb = a.decision === 'accepted' ? 'accepted' : 'declined'
    await notifySolarUsers([a.issuedBy], email ? [email] : [], {
      type: a.decision === 'accepted' ? 'solar_proposal_accepted' : 'solar_proposal_declined',
      projectId: a.projectId, projectName,
      title: `Proposal v${a.version} ${verb}`,
      body: `${a.actorName} ${verb} proposal v${a.version} for ${projectName}.`,
      route: `/projects/${a.projectId}/solar/reports`,
      email: await solarEmailEnabled(a.projectId),
    })
  } catch (e) {
    console.error('[solar-proposal] response notification failed', { err: String(e) })
  }
}
```

- [ ] **Step 3: Failing test** `apps/web/src/app/api/projects/[id]/solar/proposals/[proposalId]/preview/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Pat', email: 'pat@x' } }) }) }) }) })), gate: vi.fn(), prepare: vi.fn(), brand: vi.fn(async () => ({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'A' })), render: vi.fn(async () => Buffer.from('%PDF-preview')), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/proposals/prepare', () => ({ prepareProposalSnapshot: h.prepare }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brand }))
vi.mock('@/lib/solar/reports/render-proposal', () => ({ renderProposalPdf: h.render }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
import { GET } from './route'
import { fakeSupabase } from '@/test/fake-supabase'
import { proposalSnapshot } from '@/test/proposal-fixture'

const P = '11111111-1111-4111-8111-111111111111', PR = '22222222-2222-4222-8222-222222222222'
const call = (id = P, proposalId = PR) => GET(new Request('http://x'), { params: Promise.resolve({ id, proposalId }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'edit_financials', userId: 'u1' })
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.proposals': [{ id: PR, project_id: P, family_id: PR, version: 1, status: 'draft', case_id: 'c1', draft: {} }] } }).client)
  h.prepare.mockResolvedValue({ ok: true, snapshot: proposalSnapshot(), runId: 'r1' })
})

describe('GET preview', () => {
  it('gates Edit + financials first (JSON 403)', async () => {
    h.gate.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Solar access required' }), { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), P, 'edit_financials')
    expect(h.prepare).not.toHaveBeenCalled()
  })
  it('400 on a non-UUID param', async () => {
    expect((await call('x')).status).toBe(400)
  })
  it('renders a watermarked PDF inline', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(h.render).toHaveBeenCalledWith(expect.anything(), expect.anything(), { preview: true })
  })
  it('422 with the reason when the case is Stale', async () => {
    h.prepare.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    const res = await call()
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
  })
  it('409 for an issued proposal (its frozen PDF is in the list)', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.proposals': [{ id: PR, project_id: P, status: 'issued' }] } }).client)
    expect((await call()).status).toBe(409)
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** the route `apps/web/src/app/api/projects/[id]/solar/proposals/[proposalId]/preview/route.ts`:

```ts
/**
 * GET preview of a DRAFT proposal (spec §9.3 Preview PDF): same snapshot builder as Issue, rendered
 * with a PREVIEW watermark, nothing stored. Sits outside (admin)/layout.tsx, so it gates itself.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { rateLimit } from '@/lib/rate-limit'
import { prepareProposalSnapshot } from '@/lib/solar/proposals/prepare'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'

export const runtime = 'nodejs'
export const maxDuration = 60
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params
  if (!UUID.test(id) || !UUID.test(proposalId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireSolarLevelAPI(supabase, id, 'edit_financials')
  if (!gate.ok) return gate.response
  if (!rateLimit(`solar-preview:${gate.userId}`, 20, 60_000)) return NextResponse.json({ error: 'Too many previews — wait a minute.' }, { status: 429 })
  const { data } = await supabase.schema('solar').from('proposals')
    .select('id, project_id, family_id, version, status, case_id, draft').eq('id', proposalId).eq('project_id', id).maybeSingle()
  const p = data as { id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown } | null
  if (!p) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (p.status !== 'draft') return NextResponse.json({ error: 'This proposal has been issued — open its PDF from the list.' }, { status: 409 })
  const svc = createServiceClient() as unknown as AnyClient
  const { data: prof } = await svc.from('profiles').select('full_name, email').eq('id', gate.userId).maybeSingle()
  const actor = { id: gate.userId, name: ((prof as { full_name?: string } | null)?.full_name ?? '').trim() || 'Your proposer', email: (prof as { email?: string } | null)?.email ?? null }
  const prepared = await prepareProposalSnapshot({ user: supabase, svc, projectId: id, proposal: p, actor, issuedAt: new Date() })
  if (!prepared.ok) return NextResponse.json({ error: prepared.error, ...(prepared.fieldErrors ? { fieldErrors: prepared.fieldErrors } : {}) }, { status: 422 })
  const { branding } = solarBranding(await loadSolarBrandingData(svc, id), { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: new Date().toISOString().slice(0, 10) })
  const pdf = await renderProposalPdf(prepared.snapshot, branding, { preview: true })
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="proposal-v${p.version}-preview.pdf"`, 'cache-control': 'no-store' },
  })
}
```

- [ ] **Step 5: Append Issue / Withdraw / New link tests** to `solar-proposals.actions.test.ts` (add `issueSolarProposalAction, withdrawSolarProposalAction, newSolarProposalLinkAction` to its import from `./solar-proposals.actions`, and put the two `import` lines below at the TOP of the file with the others — lint enforces imports first):

```ts
import { createHash } from 'node:crypto'
import { proposalSnapshot } from '@/test/proposal-fixture'

const draftRow = { id: PR, project_id: P, study_id: 's1', organisation_id: 'o1', family_id: PR, version: 2, status: 'draft', case_id: 'c1', draft: goodDraft, updated_at: 'T0' }
const issueSetup = (rpc: unknown = { data: { ok: true, version: 2 }, error: null }) => {
  const user = setupUser({ tables: { 'solar.proposals': [draftRow, { id: 'old', project_id: P, family_id: PR, version: 1, status: 'issued' }] } })
  const svc = setupSvc({
    tables: { 'public.profiles': [{ id: U, full_name: 'Pat', email: 'pat@sun.example' }, { id: 'cv1', email: 'client@acme.example' }], 'projects.reports': [{ id: 'rep-old', project_id: P, kind: 'solar_proposal', source_id: 'old', status: 'issued' }], 'projects.projects': [{ id: P, name: 'Acme Mall', organisation_id: 'o1' }], 'projects.project_members': [{ project_id: P, user_id: 'cv1', role: 'client_viewer', is_active: true }] },
    writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] } },
    rpc: { solar_issue_proposal: rpc as never },
  })
  h.prepare.mockResolvedValue({ ok: true, snapshot: proposalSnapshot(), runId: 'r1' })
  h.brandData.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' })
  return { user, svc }
}

describe('issueSolarProposalAction', () => {
  it('freezes: stores the PDF, records its SHA-256, passes the token HASH (never the token) and the snapshot to the service function', async () => {
    const { svc } = issueSetup()
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })
    expect(r).toEqual({ ok: true, link: `https://www.e-site.live/proposal/${'T'.repeat(43)}`, emailed: 0, emailNote: null })
    const path = `o1/${P}/solar-proposals/${PR}-v2.pdf`
    expect(svc.bucket.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    const rpc = (svc.client.rpc as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'solar_issue_proposal')![1] as Record<string, unknown>
    expect(rpc).toMatchObject({
      p_proposal_id: PR, p_expected_updated_at: 'T0', p_case_run_id: 'r1', p_pdf_path: path,
      p_pdf_sha256: createHash('sha256').update(Buffer.from('%PDF-proposal')).digest('hex'),
      p_token_hash: 'f'.repeat(64), p_report_id: 'rep-new', p_actor: U,
      p_snapshot: proposalSnapshot(), p_expires_at: proposalSnapshot().proposal.validUntil,
    })
    expect(JSON.stringify(rpc)).not.toContain('T'.repeat(43))
    expect(callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload).toMatchObject({ kind: 'solar_proposal', source_table: 'solar.proposals', source_id: PR, version: 2, status: 'issued' })
    expect(callsTo(svc.calls, 'projects.reports', 'update')[0]!.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_proposal_issued', properties: { version: 2, emailed: 0 } })
  })
  it('never emails when the project toggle is off, and says so', async () => {
    issueSetup()
    h.emailOn.mockResolvedValue(false)
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1'] })
    expect(r).toMatchObject({ ok: true, emailed: 0, emailNote: 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.' })
    expect(h.sendClients).not.toHaveBeenCalled()
  })
  it('emails only project client viewers among the ids given, when the toggle is on', async () => {
    issueSetup()
    h.emailOn.mockResolvedValue(true)
    h.sendClients.mockResolvedValue(1)
    const r = await issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1', 'not-a-client'] })
    expect(r).toMatchObject({ ok: true, emailed: 1 })
    expect(h.sendClients).toHaveBeenCalledWith(expect.objectContaining({ emails: ['client@acme.example'] }))
  })
  it('refuses when prepare refuses (Stale), writing nothing', async () => {
    const { svc } = issueSetup()
    h.prepare.mockResolvedValue({ ok: false, error: 'The selected case is stale — re-run it first.' })
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })).resolves.toEqual({ error: 'The selected case is stale — re-run it first.' })
    expect(svc.bucket.upload).not.toHaveBeenCalled()
  })
  it('rolls back the stored PDF and report row when the database refuses (stale)', async () => {
    const { svc } = issueSetup({ data: { ok: false, error: 'stale' }, error: null })
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0', emailClientUserIds: [] })).resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
    expect(svc.bucket.remove).toHaveBeenCalledWith([`o1/${P}/solar-proposals/${PR}-v2.pdf`])
    expect(callsTo(svc.calls, 'projects.reports', 'delete')[0]!.filters).toContainEqual(['eq', 'id', 'rep-new'])
  })
  it('refuses a stale expectedUpdatedAt before rendering', async () => {
    issueSetup()
    await expect(issueSolarProposalAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T-old', emailClientUserIds: [] })).resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
    expect(h.render).not.toHaveBeenCalled()
  })
})

describe('withdraw / new link', () => {
  it('withdraw calls the service function with the actor and words not_live', async () => {
    setupUser({ tables: { 'solar.proposals': [{ id: PR, project_id: P, version: 2 }] } })
    const svc = setupSvc({ rpc: { solar_withdraw_proposal: { data: { ok: false, error: 'not_live' }, error: null } } })
    await expect(withdrawSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'Only an issued proposal can be withdrawn.' })
    expect(svc.client.rpc).toHaveBeenCalledWith('solar_withdraw_proposal', { p_proposal_id: PR, p_actor: U })
  })
  it('new link rotates to a fresh token hash and returns the new link once', async () => {
    setupUser({ tables: { 'solar.proposals': [{ id: PR, project_id: P, version: 2 }] } })
    const svc = setupSvc({ rpc: { solar_rotate_proposal_link: { data: { ok: true }, error: null } } })
    await expect(newSolarProposalLinkAction({ projectId: P, proposalId: PR })).resolves.toEqual({ ok: true, link: `https://www.e-site.live/proposal/${'T'.repeat(43)}` })
    expect(svc.client.rpc).toHaveBeenCalledWith('solar_rotate_proposal_link', { p_proposal_id: PR, p_token_hash: 'f'.repeat(64), p_actor: U })
  })
  it('a proposal the caller cannot see is not found (RLS read through the session)', async () => {
    setupUser(); setupSvc()
    await expect(withdrawSolarProposalAction({ projectId: P, proposalId: PR })).resolves.toEqual({ error: 'This proposal no longer exists — reload.' })
  })
})
```

- [ ] **Step 6: Run — FAIL. Append the implementation** to `apps/web/src/actions/solar-proposals.actions.ts` (add these imports at the top of the file, beside the existing ones):

```ts
import { createHash } from 'node:crypto'
import { rateLimit } from '@/lib/rate-limit'
import { prepareProposalSnapshot } from '@/lib/solar/proposals/prepare'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'
import { newShareToken } from '@/lib/solar/proposals/token'
import { solarEmailEnabled } from '@/lib/solar/proposals/email-toggle'
import { sendProposalToClients } from '@/lib/solar/proposals/notify'
import { zar } from '@esite/shared/solar-reports'
```
and append:
```ts
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')
const proposalLink = (token: string) => `${siteUrl()}/proposal/${token}`
const NOT_FOUND = 'This proposal no longer exists — reload.'
const ISSUE_ERRORS: Record<string, string> = {
  stale: STALE_MESSAGE,
  not_draft: 'This proposal has already been issued — reload.',
  run_mismatch: 'The selected case’s run changed — preview the proposal again, then issue it.',
  invalid_expiry: 'Set a validity between 1 and 365 days.',
  not_found: NOT_FOUND,
}
const EMAIL_OFF = 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.'

async function actorOf(svc: AnyClient, userId: string) {
  const { data } = await svc.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return { id: userId, name: p?.full_name?.trim() || 'Your proposer', email: p?.email ?? null }
}

export async function issueSolarProposalAction(input: {
  projectId: string; proposalId: string; expectedUpdatedAt: string; emailClientUserIds: string[]
}): Promise<{ ok: true; link: string; emailed: number; emailNote: string | null } | { error: string } | { error: string; fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!rateLimit(`solar-issue:${g.userId}`, 5, 60_000)) return { error: 'Too many issues at once — wait a minute and try again.' }
  const { data: row } = await g.supabase.schema('solar').from('proposals')
    .select('id, project_id, organisation_id, family_id, version, status, case_id, draft, updated_at').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const p = row as { id: string; organisation_id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown; updated_at: string } | null
  if (!p) return { error: NOT_FOUND }
  if (p.status !== 'draft') return { error: ISSUE_ERRORS.not_draft! }
  if (p.updated_at !== input.expectedUpdatedAt) return { error: STALE_MESSAGE }

  const svc = createServiceClient() as unknown as AnyClient
  const actor = await actorOf(svc, g.userId)
  const prepared = await prepareProposalSnapshot({ user: g.supabase, svc, projectId: input.projectId, proposal: p, actor, issuedAt: new Date() })
  if (!prepared.ok) return prepared.fieldErrors ? { error: prepared.error, fieldErrors: prepared.fieldErrors } : { error: prepared.error }
  const snap = prepared.snapshot
  const brandData = await loadSolarBrandingData(svc, input.projectId)
  const { branding } = solarBranding(brandData, { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: snap.proposal.issuedAt.slice(0, 10) })
  const pdf = new Uint8Array(await renderProposalPdf(snap, branding, { preview: false }))
  const sha = createHash('sha256').update(pdf).digest('hex')

  const path = `${p.organisation_id}/${input.projectId}/solar-proposals/${p.id}-v${p.version}.pdf`
  const { error: upErr } = await svc.storage.from('reports').upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the proposal PDF — try again.' }
  const { data: rep, error: repErr } = await svc.schema('projects').from('reports').insert({
    organisation_id: p.organisation_id,
    project_id: input.projectId,
    kind: 'solar_proposal',
    source_table: 'solar.proposals',
    source_id: p.id,
    title: `Solar proposal v${p.version} — ${snap.client.name}`,
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version: p.version,
    summary: { kwp: Math.round(snap.system.dcKwp * 10) / 10, offer: zar(snap.price.offerExclVatZar), familyId: p.family_id },
    generated_by: g.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (repErr || !reportId) {
    await svc.storage.from('reports').remove([path])
    return { error: 'Could not save the proposal — try again.' }
  }

  const { token, hash } = newShareToken()
  const { data: res, error: rpcErr } = await svc.rpc('solar_issue_proposal', {
    p_proposal_id: p.id, p_expected_updated_at: p.updated_at, p_case_run_id: prepared.runId, p_snapshot: snap,
    p_pdf_path: path, p_pdf_sha256: sha, p_token_hash: hash, p_expires_at: snap.proposal.validUntil,
    p_report_id: reportId, p_actor: g.userId,
  })
  const out = res as { ok?: boolean; error?: string } | null
  if (rpcErr || !out?.ok) {
    await svc.storage.from('reports').remove([path])
    await svc.schema('projects').from('reports').delete().eq('id', reportId)
    return { error: ISSUE_ERRORS[out?.error ?? ''] ?? humanSolarError(rpcErr) }
  }

  // Supersede the family's earlier proposal PDF rows (the DB already withdrew their proposals).
  const { data: fam } = await g.supabase.schema('solar').from('proposals').select('id').eq('family_id', p.family_id)
  const famIds = ((fam ?? []) as Row[]).map((r) => String(r.id)).filter((id) => id !== p.id)
  if (famIds.length) {
    await svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId })
      .eq('project_id', input.projectId).eq('kind', 'solar_proposal').eq('status', 'issued').in('source_id', famIds)
  }

  const link = proposalLink(token)
  let emailed = 0
  let emailNote: string | null = null
  const wanted = (input.emailClientUserIds ?? []).filter((id) => typeof id === 'string')
  if (wanted.length) {
    if (!(await solarEmailEnabled(input.projectId))) emailNote = EMAIL_OFF
    else {
      const { data: members } = await svc.schema('projects').from('project_members').select('user_id')
        .eq('project_id', input.projectId).eq('role', 'client_viewer').eq('is_active', true).in('user_id', wanted)
      const ids = ((members ?? []) as Row[]).map((m) => String(m.user_id))
      const { data: profs } = ids.length ? await svc.from('profiles').select('id, email').in('id', ids) : { data: [] }
      const emails = ((profs ?? []) as Row[]).map((x) => x.email).filter((e): e is string => typeof e === 'string' && e.includes('@'))
      emailed = await sendProposalToClients({ emails, projectName: snap.project.name, orgName: snap.issuer.orgName, link, validUntil: snap.proposal.validUntil, accent: brandData.projectAccent ?? brandData.orgAccent })
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_issued', objectRef: { proposalId: p.id, version: p.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_issued', properties: { version: p.version, emailed } })
  revalidate(input.projectId)
  return { ok: true, link, emailed, emailNote }
}

async function visibleProposal(supabase: AnyClient, projectId: string, proposalId: string): Promise<{ id: string; version: number } | null> {
  const { data } = await supabase.schema('solar').from('proposals').select('id, version').eq('id', proposalId).eq('project_id', projectId).maybeSingle()
  return (data as { id: string; version: number } | null) ?? null
}

export async function withdrawSolarProposalAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const p = await visibleProposal(g.supabase, input.projectId, input.proposalId)
  if (!p) return { error: NOT_FOUND }
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.rpc('solar_withdraw_proposal', { p_proposal_id: p.id, p_actor: g.userId })
  const out = data as { ok?: boolean; error?: string } | null
  if (error || !out?.ok) return { error: out?.error === 'not_live' ? 'Only an issued proposal can be withdrawn.' : humanSolarError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_withdrawn', objectRef: { proposalId: p.id, version: p.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_withdrawn' })
  revalidate(input.projectId)
  return { ok: true }
}

export async function newSolarProposalLinkAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true; link: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const p = await visibleProposal(g.supabase, input.projectId, input.proposalId)
  if (!p) return { error: NOT_FOUND }
  const { token, hash } = newShareToken()
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.rpc('solar_rotate_proposal_link', { p_proposal_id: p.id, p_token_hash: hash, p_actor: g.userId })
  const out = data as { ok?: boolean; error?: string } | null
  if (error || !out?.ok) return { error: out?.error === 'not_live' ? 'Only a live (issued, unexpired) proposal can get a new link.' : humanSolarError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_link_rotated', objectRef: { proposalId: p.id, version: p.version } })
  revalidate(input.projectId)
  return { ok: true, link: proposalLink(token) }
}
```
The fake's `delete()` echo is `[]`; the rollback path only needs the call recorded. If `fakeSupabase` lacks `in` on update chains it already has `in` — it is chainable after `update`.

- [ ] **Step 7: Scanner** — add `'solar_proposal'` to the expected list in `report-kind-access.contract.test.ts` ("finds the known report writers").

- [ ] **Step 8: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/actions/solar-proposals.actions.test.ts src/lib/solar/proposals 'src/app/api/projects/[id]/solar/proposals' src/lib/reports/report-kind-access 2>&1 | tail -6
git add apps/web/src/lib/solar/proposals/notify.ts apps/web/src/lib/solar/proposals/notify.test.ts 'apps/web/src/app/api/projects/[id]/solar/proposals' \
  apps/web/src/actions/solar-proposals.actions.ts apps/web/src/actions/solar-proposals.actions.test.ts apps/web/src/lib/reports/report-kind-access.contract.test.ts
git commit -m "feat(solar): preview, issue (frozen snapshot + PDF + SHA-256 + hashed link), withdraw, new link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: AI narrative (D-17) — server-side, optional, saved

**Files:**
- Modify: `apps/web/package.json` (dependency)
- Create: `apps/web/src/lib/solar/proposals/narrative.ts`, `narrative.test.ts`
- Modify: `apps/web/src/actions/solar-proposals.actions.ts` (+ test)

- [ ] **Step 1: Add the SDK** (server-only use; never imported by a `'use client'` file):

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 && pnpm --filter web add @anthropic-ai/sdk
```

- [ ] **Step 2: Failing test** `narrative.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({ beta: { messages: { create: h.create } } })) }))
import { draftNarrative, narrativeAvailable, NO_KEY_REASON, NARRATIVE_MODEL } from './narrative'

const facts = { projectName: 'Acme Mall', clientName: 'Acme Retail', dcKwp: 500, acKw: 400, batteryKwh: null, year1Mwh: 845, solarSharePct: 58.1, offerExclVat: 'R 1 150 000.00', financeOptions: ['Cash purchase'] }

beforeEach(() => { vi.clearAllMocks(); delete process.env.ANTHROPIC_API_KEY })

describe('narrative (D-17)', () => {
  it('is unavailable without a server key, with a reason', () => {
    expect(narrativeAvailable()).toBe(false)
    expect(NO_KEY_REASON).toBe('The AI narrative is not configured on this server (no Anthropic API key).')
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    expect(narrativeAvailable()).toBe(true)
  })
  it('calls the model server-side with only the facts, and returns the text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    h.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '  A 500 kWp system for Acme.  ' }] })
    await expect(draftNarrative(facts)).resolves.toEqual({ ok: true, text: 'A 500 kWp system for Acme.' })
    const req = h.create.mock.calls[0]![0] as { model: string; messages: Array<{ content: string }>; system: string; fallbacks: unknown; betas: string[] }
    expect(req.model).toBe(NARRATIVE_MODEL)
    expect(req.betas).toEqual(['server-side-fallback-2026-06-01'])
    expect(req.fallbacks).toEqual([{ model: 'claude-opus-4-8' }])
    expect(req.system).toContain('Never invent a number')
    expect(JSON.parse(req.messages[0]!.content)).toEqual(facts)
  })
  it('turns a refusal or an error into a sentence', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    h.create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] })
    await expect(draftNarrative(facts)).resolves.toEqual({ ok: false, error: 'The AI declined to draft this narrative — write it yourself.' })
    h.create.mockRejectedValueOnce(new Error('network'))
    await expect(draftNarrative(facts)).resolves.toEqual({ ok: false, error: 'The AI narrative could not be drafted — try again, or write it yourself.' })
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `apps/web/src/lib/solar/proposals/narrative.ts`:

```ts
import 'server-only'
/**
 * Optional AI narrative (decision D-17): server-side only, key from the server environment (never
 * typed by a user — security baseline item 2), only the proposal's figures and names are sent, the
 * result is returned as editable text that the caller saves into the draft.
 * Model: claude-opus-5 (override with SOLAR_NARRATIVE_MODEL). A server-side refusal fallback to
 * claude-opus-4-8 is enabled; a refusal of the whole chain becomes a sentence.
 */
import Anthropic from '@anthropic-ai/sdk'

export const NARRATIVE_MODEL = process.env.SOLAR_NARRATIVE_MODEL || 'claude-opus-5'
export const NO_KEY_REASON = 'The AI narrative is not configured on this server (no Anthropic API key).'

export interface NarrativeFacts {
  projectName: string; clientName: string
  dcKwp: number; acKw: number; batteryKwh: number | null
  year1Mwh: number; solarSharePct: number
  offerExclVat: string; financeOptions: string[]
}

const SYSTEM =
  'You write the "About this proposal" section of a commercial rooftop solar PV proposal for a South African client. ' +
  'Write 120 to 250 words of plain, professional English in two or three short paragraphs: no headings, no bullet points, no markdown. ' +
  'Use only the facts in the JSON the user sends. Never invent a number, a saving, a guarantee or a date. Prices exclude VAT. ' +
  'Do not promise savings; say they are estimates based on a modelled year.'

export function narrativeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function draftNarrative(facts: NarrativeFacts): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!narrativeAvailable()) return { ok: false, error: NO_KEY_REASON }
  try {
    const client = new Anthropic()
    const res = await client.beta.messages.create({
      model: NARRATIVE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    })
    if (res.stop_reason === 'refusal') return { ok: false, error: 'The AI declined to draft this narrative — write it yourself.' }
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
    if (!text) return { ok: false, error: 'The AI narrative could not be drafted — try again, or write it yourself.' }
    return { ok: true, text: text.slice(0, 8000) }
  } catch (e) {
    console.error('[solar-narrative] failed', { err: String(e) })
    return { ok: false, error: 'The AI narrative could not be drafted — try again, or write it yourself.' }
  }
}
```
If `tsc` rejects `fallbacks` on the installed SDK version, check `node_modules/@anthropic-ai/sdk` for the beta param name and the claude-api skill's `shared/model-migration.md` refusal section; do NOT drop the refusal handling.

- [ ] **Step 4: Append the action test** to `solar-proposals.actions.test.ts` (import `draftSolarProposalNarrativeAction`):

```ts
describe('draftSolarProposalNarrativeAction', () => {
  const row = { id: PR, project_id: P, organisation_id: 'o1', status: 'draft', draft: goodDraft, updated_at: 'T0' }
  it('disabled with the reason when there is no key', async () => {
    setupUser({ tables: { 'solar.proposals': [row] } }); setupSvc()
    h.narrativeAvailable.mockReturnValueOnce(false)
    await expect(draftSolarProposalNarrativeAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: 'The AI narrative is not configured on this server (no Anthropic API key).' })
  })
  it('drafts from the selected case’s stored figures and SAVES the text into the draft (stale-guarded)', async () => {
    const user = setupUser({
      tables: { 'solar.proposals': [row], 'projects.projects': [{ id: P, name: 'Acme Mall' }] },
      writes: { 'solar.proposals:update': { data: [{ updated_at: 'T1' }] } },
    }); setupSvc()
    h.prepare.mockResolvedValue({ ok: true, snapshot: proposalSnapshot(), runId: 'r1' })
    h.narrative.mockResolvedValue({ ok: true, text: 'Narrative text.' })
    await expect(draftSolarProposalNarrativeAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ ok: true, narrative: 'Narrative text.', updatedAt: 'T1' })
    expect(h.narrative).toHaveBeenCalledWith(expect.objectContaining({ clientName: 'Acme Retail (Pty) Ltd', dcKwp: 500, offerExclVat: 'R 1 150 000.00', financeOptions: ['Cash purchase', 'Power purchase agreement (PPA)'] }))
    const up = callsTo(user.calls, 'solar.proposals', 'update')[0]!
    expect(up.payload).toEqual({ draft: { ...goodDraft, narrative: 'Narrative text.' } })
    expect(up.filters).toContainEqual(['eq', 'updated_at', 'T0'])
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_narrative_drafted' })
  })
  it('rate-limits per organisation', async () => {
    setupUser({ tables: { 'solar.proposals': [row] } }); setupSvc()
    h.rateLimit.mockReturnValueOnce(false)
    await expect(draftSolarProposalNarrativeAction({ projectId: P, proposalId: PR, expectedUpdatedAt: 'T0' }))
      .resolves.toEqual({ error: 'Too many AI drafts for your organisation — try again in a few minutes.' })
  })
})
```

- [ ] **Step 5: Run — FAIL. Append the action** (imports: `import { draftNarrative, narrativeAvailable, NO_KEY_REASON } from '@/lib/solar/proposals/narrative'` and add `FINANCE_OPTION_LABELS, keyFigures` to the `@esite/shared/solar-reports` import):

```ts
export async function draftSolarProposalNarrativeAction(input: { projectId: string; proposalId: string; expectedUpdatedAt: string }):
  Promise<{ ok: true; narrative: string; updatedAt: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!narrativeAvailable()) return { error: NO_KEY_REASON }
  const { data: row } = await g.supabase.schema('solar').from('proposals')
    .select('id, organisation_id, family_id, version, status, case_id, draft, updated_at').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const p = row as { id: string; organisation_id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown; updated_at: string } | null
  if (!p) return { error: NOT_FOUND }
  if (p.status !== 'draft') return { error: 'Only a draft can be changed.' }
  if (!rateLimit(`solar-narrative:${p.organisation_id}`, 10, 10 * 60_000)) return { error: 'Too many AI drafts for your organisation — try again in a few minutes.' }
  const svc = createServiceClient() as unknown as AnyClient
  const prepared = await prepareProposalSnapshot({ user: g.supabase, svc, projectId: input.projectId, proposal: p, actor: await actorOf(svc, g.userId), issuedAt: new Date() })
  if (!prepared.ok) return { error: prepared.error }
  const s = prepared.snapshot
  const r = await draftNarrative({
    projectName: s.project.name, clientName: s.client.name,
    dcKwp: s.system.dcKwp, acKw: s.system.acKw, batteryKwh: s.system.batteryKwh,
    year1Mwh: Math.round(s.system.year1PvKwh / 100) / 10, solarSharePct: Math.round(s.system.solarFraction * 1000) / 10,
    offerExclVat: keyFigures(s).find((f) => f.label === 'Offer price (excl. VAT)')!.value,
    financeOptions: s.financeOptions.map((o) => FINANCE_OPTION_LABELS[o.kind]),
  })
  if (!r.ok) return { error: r.error }
  const draft = { ...readProposalDraft(p.draft), narrative: r.text }
  const { data, error } = await g.supabase.schema('solar').from('proposals').update({ draft })
    .eq('id', p.id).eq('project_id', input.projectId).eq('status', 'draft').eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_narrative_drafted' })
  revalidate(input.projectId)
  return { ok: true, narrative: r.text, updatedAt: String((data[0] as Row).updated_at) }
}
```

- [ ] **Step 6: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/proposals/narrative.test.ts src/actions/solar-proposals.actions.test.ts 2>&1 | tail -5
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/solar/proposals/narrative.ts apps/web/src/lib/solar/proposals/narrative.test.ts \
  apps/web/src/actions/solar-proposals.actions.ts apps/web/src/actions/solar-proposals.actions.test.ts
git commit -m "feat(solar): optional server-side AI proposal narrative (D-17)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Client access by token — loaders, two public API routes, middleware, tamper test

**Files:**
- Create: `apps/web/src/lib/solar/proposals/request-meta.ts`
- Create: `apps/web/src/lib/solar/proposals/client.ts`, `client.test.ts`, `tamper.render.test.ts`
- Create: `apps/web/src/app/api/solar/proposal-response/route.ts`, `route.test.ts`
- Create: `apps/web/src/app/api/solar/proposal-download/route.ts`, `route.test.ts`
- Modify: `apps/web/src/middleware.ts`, `middleware.test.ts`

- [ ] **Step 1: Implement** `request-meta.ts` (no test of its own; exercised by the route tests):

```ts
/** Server-stamped request evidence (spec §9.4): never taken from the request body. */
export function clientIp(h: Headers): string | null {
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = fwd || h.get('x-real-ip')?.trim() || null
  return ip ? ip.slice(0, 64) : null
}
export function userAgent(h: Headers): string | null {
  const ua = h.get('user-agent')
  return ua ? ua.slice(0, 512) : null
}
```

- [ ] **Step 2: Failing test** `client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ svc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { loadProposalByToken, respondByToken, signedProposalPdfUrl, RESPONSE_ERRORS, loadPortalProposals, respondPortal } from './client'
import { fakeSupabase } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'
import { proposalSnapshot } from '@/test/proposal-fixture'

const TOKEN = 'A'.repeat(43)
const stored = { state: 'viewed', proposalId: 'p1', projectId: 'proj1', version: 2, expiresAt: '2026-10-29T08:00:00Z', snapshot: proposalSnapshot(), pdfSha256: 'a'.repeat(64), pdfPath: 'o/p/x.pdf', response: null }
let fake: ReturnType<typeof withStorage>
beforeEach(() => {
  vi.clearAllMocks()
  fake = withStorage(fakeSupabase({ rpc: {
    solar_proposal_by_token: { data: stored, error: null },
    solar_proposal_respond_by_token: { data: { ok: true, state: 'accepted', proposalId: 'p1', projectId: 'proj1', issuedBy: 'u1', version: 2 }, error: null },
    solar_portal_proposals: { data: [{ proposalId: 'p1', version: 2, state: 'viewed' }], error: null },
    solar_portal_respond: { data: { ok: false, error: 'expired' }, error: null },
  } }))
  h.svc.mockReturnValue(fake.client)
})

describe('loadProposalByToken', () => {
  it('never calls the database for a string that is not token-shaped', async () => {
    await expect(loadProposalByToken('a'.repeat(64), { ip: null, ua: null })).resolves.toMatchObject({ view: { state: 'not_found', snapshot: null } })
    expect(fake.client.rpc).not.toHaveBeenCalled()
  })
  it('passes the RAW token + server-stamped ip/ua to the service function; strips internal fields from the view', async () => {
    const r = await loadProposalByToken(TOKEN, { ip: '203.0.113.7', ua: 'agent' })
    expect(fake.client.rpc).toHaveBeenCalledWith('solar_proposal_by_token', { p_token: TOKEN, p_ip: '203.0.113.7', p_ua: 'agent' })
    expect(r.view).toEqual({ state: 'viewed', version: 2, expiresAt: '2026-10-29T08:00:00Z', snapshot: proposalSnapshot(), issuer: proposalSnapshot().issuer, response: null })
    expect(JSON.stringify(r.view)).not.toContain('pdfPath')
    expect(JSON.stringify(r.view)).not.toContain('projectId')
    expect(r.pdfPath).toBe('o/p/x.pdf')
  })
})

describe('respondByToken / respondPortal', () => {
  it('maps success and refusals to sentences', async () => {
    await expect(respondByToken(TOKEN, { decision: 'accepted', name: 'N', email: 'e@x.co', authority: true, signature: null, reason: null }, { ip: '1', ua: 'u' }))
      .resolves.toEqual({ ok: true, state: 'accepted', projectId: 'proj1', issuedBy: 'u1', version: 2 })
    await expect(respondPortal('proj1', 'cv1', 'p1', { decision: 'accepted', name: 'N', email: 'e@x.co', authority: true, signature: null, reason: null }, { ip: null, ua: null }))
      .resolves.toEqual({ ok: false, error: RESPONSE_ERRORS.expired })
  })
  it('lists portal proposals for a verified portal user', async () => {
    await expect(loadPortalProposals('proj1', 'cv1')).resolves.toEqual([{ proposalId: 'p1', version: 2, state: 'viewed' }])
    expect(fake.client.rpc).toHaveBeenCalledWith('solar_portal_proposals', { p_project_id: 'proj1', p_user_id: 'cv1' })
  })
})

describe('signedProposalPdfUrl', () => {
  it('signs for 7 days with a download filename', async () => {
    await expect(signedProposalPdfUrl('o/p/x.pdf', 2)).resolves.toBe('https://signed.example/x')
    expect(fake.bucket.createSignedUrl).toHaveBeenCalledWith('o/p/x.pdf', 604_800, { download: 'solar-proposal-v2.pdf' })
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `apps/web/src/lib/solar/proposals/client.ts`:

```ts
import 'server-only'
/**
 * Client-side access to an issued proposal (spec §9.4, D-18): by secure token (no login) or as a
 * portal user. Everything goes through 00216's SERVICE-ONLY definer functions — the raw token is
 * hashed in SQL, only the frozen snapshot is returned. The caller has already applied its own gate
 * (token shape + rate limit, or requirePortalAccess). `ClientProposalView` is what reaches the
 * browser: no storage path, no project id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProposalSnapshot } from '@esite/shared/solar-reports'
import { createServiceClient } from '@/lib/supabase/server'
import { isShareToken } from './token'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Json = Record<string, unknown>

export type ClientState = 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'not_found'
export interface ClientProposalView {
  state: ClientState
  version: number | null
  expiresAt: string | null
  snapshot: ProposalSnapshot | null
  issuer: ProposalSnapshot['issuer'] | null
  response: { kind: 'accepted' | 'declined'; name: string; at: string } | null
}
export interface ResponseBody { decision: 'accepted' | 'declined'; name: string; email: string; authority: boolean; signature: string | null; reason: string | null }
export interface Meta { ip: string | null; ua: string | null }

export const RESPONSE_ERRORS: Record<string, string> = {
  invalid_name: 'Enter your full name.',
  invalid_email: 'Enter a valid email address.',
  authority_required: 'Tick the box to confirm you have authority to accept.',
  invalid_signature: 'The signature could not be read — clear it and sign again.',
  invalid_reason: 'The reason is too long (2000 characters at most).',
  expired: 'This proposal has expired.',
  withdrawn: 'This proposal has been withdrawn.',
  accepted: 'This proposal has already been accepted.',
  declined: 'This proposal has already been declined.',
  not_found: 'This proposal is no longer available.',
  invalid_decision: 'Something went wrong — try again.',
}

const svc = () => createServiceClient() as unknown as AnyClient
const NOT_FOUND_VIEW: ClientProposalView = { state: 'not_found', version: null, expiresAt: null, snapshot: null, issuer: null, response: null }

function toView(j: Json | null): ClientProposalView {
  if (!j || typeof j.state !== 'string') return NOT_FOUND_VIEW
  const snapshot = (j.snapshot as ProposalSnapshot | undefined) ?? null
  return {
    state: j.state as ClientState,
    version: typeof j.version === 'number' ? j.version : null,
    expiresAt: typeof j.expiresAt === 'string' ? j.expiresAt : null,
    snapshot,
    issuer: snapshot?.issuer ?? ((j.issuer as ProposalSnapshot['issuer'] | undefined) ?? null),
    response: (j.response as ClientProposalView['response']) ?? null,
  }
}

export async function loadProposalByToken(token: string, meta: Meta): Promise<{ view: ClientProposalView; pdfPath: string | null; projectId: string | null }> {
  if (!isShareToken(token)) return { view: NOT_FOUND_VIEW, pdfPath: null, projectId: null }
  const { data, error } = await svc().rpc('solar_proposal_by_token', { p_token: token, p_ip: meta.ip, p_ua: meta.ua })
  if (error) { console.error('[solar-proposal] token lookup failed', { code: error.code }); return { view: NOT_FOUND_VIEW, pdfPath: null, projectId: null } }
  const j = data as Json | null
  return { view: toView(j), pdfPath: (j?.pdfPath as string | undefined) ?? null, projectId: (j?.projectId as string | undefined) ?? null }
}

type RespondResult = { ok: true; state: 'accepted' | 'declined'; projectId: string; issuedBy: string | null; version: number } | { ok: false; error: string }

function mapResponse(data: unknown, error: { code?: string } | null): RespondResult {
  const j = data as Json | null
  if (error || !j) return { ok: false, error: RESPONSE_ERRORS.invalid_decision! }
  if (j.ok !== true) return { ok: false, error: RESPONSE_ERRORS[String(j.error)] ?? RESPONSE_ERRORS.invalid_decision! }
  return { ok: true, state: j.state as 'accepted' | 'declined', projectId: String(j.projectId), issuedBy: (j.issuedBy as string | null) ?? null, version: Number(j.version) }
}

export async function respondByToken(token: string, b: ResponseBody, meta: Meta): Promise<RespondResult> {
  if (!isShareToken(token)) return { ok: false, error: RESPONSE_ERRORS.not_found! }
  const { data, error } = await svc().rpc('solar_proposal_respond_by_token', {
    p_token: token, p_decision: b.decision, p_name: b.name, p_email: b.email, p_authority: b.authority,
    p_signature: b.signature, p_reason: b.reason, p_ip: meta.ip, p_ua: meta.ua,
  })
  return mapResponse(data, error)
}

export async function loadPortalProposals(projectId: string, userId: string): Promise<Json[]> {
  const { data } = await svc().rpc('solar_portal_proposals', { p_project_id: projectId, p_user_id: userId })
  return Array.isArray(data) ? (data as Json[]) : []
}

export async function loadPortalProposal(projectId: string, userId: string, proposalId: string, meta: Meta): Promise<{ view: ClientProposalView; pdfPath: string | null }> {
  const { data } = await svc().rpc('solar_portal_proposal', { p_project_id: projectId, p_user_id: userId, p_proposal_id: proposalId, p_ip: meta.ip, p_ua: meta.ua })
  const j = data as Json | null
  return { view: toView(j), pdfPath: (j?.pdfPath as string | undefined) ?? null }
}

export async function respondPortal(projectId: string, userId: string, proposalId: string, b: ResponseBody, meta: Meta): Promise<RespondResult> {
  const { data, error } = await svc().rpc('solar_portal_respond', {
    p_project_id: projectId, p_user_id: userId, p_proposal_id: proposalId, p_decision: b.decision, p_name: b.name, p_email: b.email,
    p_authority: b.authority, p_signature: b.signature, p_reason: b.reason, p_ip: meta.ip, p_ua: meta.ua,
  })
  return mapResponse(data, error)
}

/** 7-day signed download (spec §5 item 7: ≤ 7 days). */
export async function signedProposalPdfUrl(pdfPath: string, version: number): Promise<string | null> {
  const { data, error } = await svc().storage.from('reports').createSignedUrl(pdfPath, 604_800, { download: `solar-proposal-v${version}.pdf` })
  return error || !data?.signedUrl ? null : (data.signedUrl as string)
}

/** Validates a response body from an untrusted client. */
export function parseResponseBody(raw: unknown): ResponseBody | null {
  const o = raw as Json | null
  if (!o || typeof o !== 'object') return null
  if (o.decision !== 'accepted' && o.decision !== 'declined') return null
  if (typeof o.name !== 'string' || o.name.length > 300 || typeof o.email !== 'string' || o.email.length > 300) return null
  const signature = typeof o.signature === 'string' && o.signature.length <= 400_000 ? o.signature : null
  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 2001) : null
  return { decision: o.decision, name: o.name, email: o.email, authority: o.authority === true, signature, reason }
}
```

- [ ] **Step 4: The tamper test** `apps/web/src/lib/solar/proposals/tamper.render.test.ts` — proves the §9.4 invariant end to end: what a client is served after the case changes is the frozen snapshot, and its figures are the ones printed in the issued PDF, not recomputed ones.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ svc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
import { createHash } from 'node:crypto'
import { keyFigures, offerPrice } from '@esite/shared/solar-reports'
import { extractPdfText, squash } from '@/test/pdf-text'
import { proposalSnapshot, proposalSnapshotInput } from '@/test/proposal-fixture'
import { fakeSupabase } from '@/test/fake-supabase'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'
import { loadProposalByToken } from './client'

const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' }, { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }).branding

describe('tamper: changing the case after issue changes nothing the client sees', () => {
  let store: { snapshot: ReturnType<typeof proposalSnapshot>; pdfSha256: string }
  let pdf: Buffer
  beforeEach(async () => {
    const issued = proposalSnapshot()
    pdf = await renderProposalPdf(issued, brand, { preview: false })
    store = { snapshot: issued, pdfSha256: createHash('sha256').update(pdf).digest('hex') }
    h.svc.mockReturnValue(fakeSupabase({ rpc: { solar_proposal_by_token: () => ({ data: { state: 'viewed', version: 2, expiresAt: issued.proposal.validUntil, snapshot: store.snapshot, pdfSha256: store.pdfSha256, pdfPath: 'x', projectId: 'p' }, error: null }) } }).client)
  }, 30_000)

  it('serves the frozen snapshot, whose figures are exactly those in the issued PDF', async () => {
    // "Change the case": a bigger system at a higher price — what a recompute would now produce.
    const recomputed = proposalSnapshot({ kpis: { ...proposalSnapshotInput().kpis, dcKwp: 900, acKw: 700, annualAcKwh: 1_500_000 }, price: offerPrice(2_000_000, 15) })
    const { view } = await loadProposalByToken('A'.repeat(43), { ip: null, ua: null })
    expect(view.snapshot).toEqual(store.snapshot)
    expect(view.snapshot).not.toEqual(recomputed)
    const text = squash(extractPdfText(pdf))
    for (const f of keyFigures(view.snapshot!)) expect(text).toContain(squash(f.value))
    expect(text).not.toContain(squash(keyFigures(recomputed).find((f) => f.label === 'Offer price (excl. VAT)')!.value))
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(store.pdfSha256)
  }, 30_000)
})
```

- [ ] **Step 5: Failing route tests.**

`apps/web/src/app/api/solar/proposal-response/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ respond: vi.fn(), notify: vi.fn(async () => {}), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/solar/proposals/client', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/client')>()), respondByToken: h.respond }))
vi.mock('@/lib/solar/proposals/notify', () => ({ notifyProposalResponse: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { POST } from './route'

const TOKEN = 'A'.repeat(43)
const req = (body: unknown, headers: Record<string, string> = {}) => new Request('http://x/api/solar/proposal-response', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'agent', ...headers }, body: JSON.stringify(body),
})
const body = { token: TOKEN, decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null, ip: '6.6.6.6' }

beforeEach(() => { vi.clearAllMocks(); h.respond.mockResolvedValue({ ok: true, state: 'accepted', projectId: 'proj1', issuedBy: 'u1', version: 2 }) })

describe('POST /api/solar/proposal-response (public, token in the body)', () => {
  it('stamps IP/UA from the REQUEST headers, never from the body', async () => {
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(h.respond).toHaveBeenCalledWith(TOKEN, { decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null }, { ip: '203.0.113.7', ua: 'agent' })
  })
  it('notifies the proposer, audits without a user, emits the event', async () => {
    await POST(req(body))
    expect(h.notify).toHaveBeenCalledWith({ projectId: 'proj1', issuedBy: 'u1', version: 2, decision: 'accepted', actorName: 'Client Name' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: 'proj1', actorId: null, verb: 'proposal_accepted', objectRef: { version: 2, via: 'token' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: null, projectId: 'proj1', event: 'solar_proposal_responded', properties: { decision: 'accepted', via: 'token' } })
  })
  it('400 on a malformed body; 422 with the sentence on a refusal; 429 when rate-limited', async () => {
    expect((await POST(req({ token: TOKEN }))).status).toBe(400)
    h.respond.mockResolvedValue({ ok: false, error: 'This proposal has expired.' })
    const r = await POST(req(body))
    expect(r.status).toBe(422)
    await expect(r.json()).resolves.toEqual({ error: 'This proposal has expired.' })
    h.rateLimit.mockReturnValueOnce(false)
    expect((await POST(req(body))).status).toBe(429)
  })
})
```

`apps/web/src/app/api/solar/proposal-download/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), sign: vi.fn(async () => 'https://signed.example/x'), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/solar/proposals/client', () => ({ loadProposalByToken: h.load, signedProposalPdfUrl: h.sign }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
import { POST } from './route'

const TOKEN = 'A'.repeat(43)
const req = (b: unknown) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
beforeEach(() => vi.clearAllMocks())

describe('POST /api/solar/proposal-download', () => {
  it('returns a 7-day signed URL for a readable proposal', async () => {
    h.load.mockResolvedValue({ view: { state: 'accepted', version: 2 }, pdfPath: 'o/p/x.pdf', projectId: 'p' })
    const r = await POST(req({ token: TOKEN }))
    await expect(r.json()).resolves.toEqual({ url: 'https://signed.example/x' })
    expect(h.sign).toHaveBeenCalledWith('o/p/x.pdf', 2)
  })
  it('410 for an expired or withdrawn proposal (no URL)', async () => {
    h.load.mockResolvedValue({ view: { state: 'withdrawn', version: 2 }, pdfPath: null, projectId: null })
    expect((await POST(req({ token: TOKEN }))).status).toBe(410)
    expect(h.sign).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run — FAIL. Implement the routes.**

`apps/web/src/app/api/solar/proposal-response/route.ts`:
```ts
/**
 * Public accept / decline for a proposal opened by secure link (spec §9.4, D-18). No session: the
 * token is the bearer, carried in the BODY (never a path segment, so this is one exact public path).
 * Rate-limited per IP and per token. IP/UA are stamped from request headers here and stored by the
 * SQL function — nothing in the body can set them.
 */
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { parseResponseBody, respondByToken } from '@/lib/solar/proposals/client'
import { notifyProposalResponse } from '@/lib/solar/proposals/notify'
import { hashShareToken, isShareToken } from '@/lib/solar/proposals/token'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  const raw = await req.json().catch(() => null) as { token?: unknown } | null
  const token = raw?.token
  const body = parseResponseBody(raw)
  if (!isShareToken(token) || !body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  if (!rateLimit(`solar-proposal-respond:${ip ?? 'unknown'}`, 10, 10 * 60_000) || !rateLimit(`solar-proposal-respond-t:${hashShareToken(token)}`, 5, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — wait a few minutes and try again.' }, { status: 429 })
  }
  const r = await respondByToken(token, body, { ip, ua: userAgent(req.headers) })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 })
  await notifyProposalResponse({ projectId: r.projectId, issuedBy: r.issuedBy, version: r.version, decision: r.state, actorName: body.name.trim() })
  await recordSolarAudit({ projectId: r.projectId, actorId: null, verb: r.state === 'accepted' ? 'proposal_accepted' : 'proposal_declined', objectRef: { version: r.version, via: 'token' } })
  await emitProductEvent({ actorId: null, projectId: r.projectId, event: 'solar_proposal_responded', properties: { decision: r.state, via: 'token' } })
  return NextResponse.json({ ok: true, state: r.state })
}
```
(`token.ts` imports `server-only`; route handlers are server code, so that is fine.)

`apps/web/src/app/api/solar/proposal-download/route.ts`:
```ts
/** Public 7-day signed download of an issued proposal PDF, by secure link (token in the body). */
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { loadProposalByToken, signedProposalPdfUrl } from '@/lib/solar/proposals/client'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

export const runtime = 'nodejs'
const READABLE = new Set(['viewed', 'accepted', 'declined'])

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  if (!rateLimit(`solar-proposal-download:${ip ?? 'unknown'}`, 20, 60_000)) return NextResponse.json({ error: 'Too many requests — wait a minute.' }, { status: 429 })
  const raw = await req.json().catch(() => null) as { token?: unknown } | null
  if (typeof raw?.token !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { view, pdfPath } = await loadProposalByToken(raw.token, { ip, ua: userAgent(req.headers) })
  if (!READABLE.has(view.state) || !pdfPath || view.version === null) return NextResponse.json({ error: 'This proposal is no longer available.' }, { status: 410 })
  const url = await signedProposalPdfUrl(pdfPath, view.version)
  if (!url) return NextResponse.json({ error: 'The PDF could not be prepared — try again.' }, { status: 500 })
  return NextResponse.json({ url })
}
```

- [ ] **Step 7: Middleware** — in `apps/web/src/middleware.ts`:
  - add `'/proposal/',` to `PUBLIC_PATHS` (after `'/inspection',`) with the comment `// Client proposal by secure link (Solar §9.4, D-18): no login.`;
  - add `'/proposal/',` to `PUBLIC_CONTENT_PREFIXES` (a signed-in client must not be bounced to /dashboard, and email-verify/MFA gates must not intercept a link mailed to them);
  - change `PUBLIC_API_PATHS` to `['/api/unsubscribe', '/api/solar/proposal-response', '/api/solar/proposal-download']`.

In `apps/web/src/middleware.test.ts`:
  - change `const PUBLIC_CONTENT_PAGES = [...LEGAL_PAGES, ...PUBLIC_PAGES]` to
    ```ts
    const PROPOSAL_PAGES = pagesUnder('(proposal)')
    const PUBLIC_CONTENT_PAGES = [...LEGAL_PAGES, ...PUBLIC_PAGES, ...PROPOSAL_PAGES]
    ```
    and in "enumerates the groups from disk" add `expect(PROPOSAL_PAGES).toEqual(['/proposal/[token]'])`;
  - append:
    ```ts
    describe('middleware — public proposal endpoints (Solar §9.4)', () => {
      it.each(['/api/solar/proposal-response', '/api/solar/proposal-download'])('never redirects an anonymous POST to %s', async (p) => {
        state.user = null
        const res = await run(p)
        expect(res.headers.get('location')).toBeNull()
      })
      it('does not open a neighbouring path', async () => {
        state.user = null
        expect(locationOf(await run('/proposals')).pathname).toBe('/login')
        expect(locationOf(await run('/api/solar/proposal-responses')).pathname).toBe('/login')
      })
    })
    ```
The `(proposal)` page itself is created in Task 28; until then `pagesUnder('(proposal)')` throws on a missing directory — so create the directory now with a placeholder that Task 28 replaces:

`apps/web/src/app/(proposal)/proposal/[token]/page.tsx`:
```tsx
export default function ProposalPage() {
  return null
}
```

- [ ] **Step 8: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/proposals src/app/api/solar src/middleware.test.ts 2>&1 | tail -6
git add apps/web/src/lib/solar/proposals apps/web/src/app/api/solar apps/web/src/middleware.ts apps/web/src/middleware.test.ts 'apps/web/src/app/(proposal)'
git commit -m "feat(solar): client access by secure link (service-only lookups, stamped responses, rate limits)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Portal access — respond and download as a portal user

**Files:**
- Create: `apps/web/src/actions/solar-portal-proposals.actions.ts`, `solar-portal-proposals.actions.test.ts`

- [ ] **Step 1: Failing test**:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ access: vi.fn(), respond: vi.fn(), load: vi.fn(), sign: vi.fn(async () => 'https://signed.example/x'), notify: vi.fn(async () => {}), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), rateLimit: vi.fn(() => true), headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '198.51.100.9', 'user-agent': 'portal-agent' })) }))
vi.mock('@/lib/portal/data', () => ({ requirePortalAccess: h.access }))
vi.mock('@/lib/solar/proposals/client', async (orig) => ({ ...(await orig<typeof import('@/lib/solar/proposals/client')>()), respondPortal: h.respond, loadPortalProposal: h.load, signedProposalPdfUrl: h.sign }))
vi.mock('@/lib/solar/proposals/notify', () => ({ notifyProposalResponse: h.notify }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { respondToPortalProposalAction, getPortalProposalPdfUrlAction } from './solar-portal-proposals.actions'

const body = { decision: 'accepted' as const, name: 'Client Viewer', email: 'cv@acme.example', authority: true, signature: null, reason: null }
beforeEach(() => { vi.clearAllMocks(); h.access.mockResolvedValue({ userId: 'cv1', organisationId: 'o1', projectId: 'p1' }) })

describe('portal proposal actions', () => {
  it('refuse anyone who is not a portal member of the project', async () => {
    h.access.mockResolvedValue(null)
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ error: 'You do not have access to this project.' })
    expect(h.respond).not.toHaveBeenCalled()
  })
  it('respond passes the VERIFIED user id and header-stamped ip/ua', async () => {
    h.respond.mockResolvedValue({ ok: true, state: 'accepted', projectId: 'p1', issuedBy: 'u1', version: 3 })
    await expect(respondToPortalProposalAction({ projectId: 'p1', proposalId: 'pr1', ...body })).resolves.toEqual({ ok: true, state: 'accepted' })
    expect(h.respond).toHaveBeenCalledWith('p1', 'cv1', 'pr1', body, { ip: '198.51.100.9', ua: 'portal-agent' })
    expect(h.notify).toHaveBeenCalledWith({ projectId: 'p1', issuedBy: 'u1', version: 3, decision: 'accepted', actorName: 'Client Viewer' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: 'p1', actorId: 'cv1', verb: 'proposal_accepted', objectRef: { version: 3, via: 'portal' } })
  })
  it('download signs 7 days only for a readable proposal', async () => {
    h.load.mockResolvedValue({ view: { state: 'viewed', version: 3 }, pdfPath: 'o/p/x.pdf' })
    await expect(getPortalProposalPdfUrlAction({ projectId: 'p1', proposalId: 'pr1' })).resolves.toEqual({ url: 'https://signed.example/x' })
    h.load.mockResolvedValue({ view: { state: 'expired', version: 3 }, pdfPath: null })
    await expect(getPortalProposalPdfUrlAction({ projectId: 'p1', proposalId: 'pr1' })).resolves.toEqual({ error: 'This proposal is no longer available.' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/actions/solar-portal-proposals.actions.ts`:

```ts
'use server'
/**
 * Portal users (client viewers on the project) accept / decline / download an issued proposal
 * (spec §9.4, D-18 "portal users also see them in the portal"). Gate: requirePortalAccess — the same
 * gate the portal layout runs. The service-only SQL function re-checks portal membership itself.
 */
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requirePortalAccess } from '@/lib/portal/data'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { loadPortalProposal, parseResponseBody, respondPortal, signedProposalPdfUrl } from '@/lib/solar/proposals/client'
import { notifyProposalResponse } from '@/lib/solar/proposals/notify'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'

const NO_ACCESS = 'You do not have access to this project.'

export async function respondToPortalProposalAction(input: {
  projectId: string; proposalId: string; decision: 'accepted' | 'declined'; name: string; email: string
  authority: boolean; signature: string | null; reason: string | null
}): Promise<{ ok: true; state: 'accepted' | 'declined' } | { error: string }> {
  const access = await requirePortalAccess(input.projectId)
  if (!access) return { error: NO_ACCESS }
  const body = parseResponseBody(input)
  if (!body) return { error: 'Something went wrong — try again.' }
  if (!rateLimit(`solar-portal-respond:${access.userId}`, 5, 10 * 60_000)) return { error: 'Too many attempts — wait a few minutes and try again.' }
  const h = await headers()
  const r = await respondPortal(input.projectId, access.userId, input.proposalId, body, { ip: clientIp(h), ua: userAgent(h) })
  if (!r.ok) return { error: r.error }
  await notifyProposalResponse({ projectId: r.projectId, issuedBy: r.issuedBy, version: r.version, decision: r.state, actorName: body.name.trim() })
  await recordSolarAudit({ projectId: r.projectId, actorId: access.userId, verb: r.state === 'accepted' ? 'proposal_accepted' : 'proposal_declined', objectRef: { version: r.version, via: 'portal' } })
  await emitProductEvent({ actorId: access.userId, projectId: r.projectId, event: 'solar_proposal_responded', properties: { decision: r.state, via: 'portal' } })
  revalidatePath(`/portal/${input.projectId}/proposals`)
  return { ok: true, state: r.state }
}

export async function getPortalProposalPdfUrlAction(input: { projectId: string; proposalId: string }): Promise<{ url: string } | { error: string }> {
  const access = await requirePortalAccess(input.projectId)
  if (!access) return { error: NO_ACCESS }
  const h = await headers()
  const { view, pdfPath } = await loadPortalProposal(input.projectId, access.userId, input.proposalId, { ip: clientIp(h), ua: userAgent(h) })
  if (!['viewed', 'accepted', 'declined'].includes(view.state) || !pdfPath || view.version === null) return { error: 'This proposal is no longer available.' }
  const url = await signedProposalPdfUrl(pdfPath, view.version)
  return url ? { url } : { error: 'The PDF could not be prepared — try again.' }
}
```

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/actions/solar-portal-proposals 2>&1 | tail -4
git add apps/web/src/actions/solar-portal-proposals.actions.ts apps/web/src/actions/solar-portal-proposals.actions.test.ts
git commit -m "feat(solar): portal users accept, decline and download issued proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
