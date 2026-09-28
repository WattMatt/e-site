# Solar Phase 6 — Part 5: UI (Reports & Proposal tab, client view, token page, portal, Overview, settings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first.

UI rules (spec §0.4): controls above the caller's level are HIDDEN; every async button disables + shows progress and reports completion only after the server confirms; destructive/irreversible buttons use `useArmedConfirm` (first press arms, second commits); every failure is a sentence (`role="alert"`); every list has an empty state with the one action that fills it. Page → client props are JSON only.

---

### Task 25: Reports page data, page shell, report generator

**Files:**
- Create: `apps/web/src/lib/solar/reports/page-data.ts`, `page-data.test.ts`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/ReportGenerator.tsx`, `ReportGenerator.test.tsx`

- [ ] **Step 1: Failing test** `page-data.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ sel: vi.fn(), money: vi.fn(), email: vi.fn(async () => true), narrative: vi.fn(() => false) }))
vi.mock('./selected-case', () => ({ loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/page-data', () => ({ latestMoney: h.money }))
vi.mock('@/lib/solar/proposals/email-toggle', () => ({ solarEmailEnabled: h.email }))
vi.mock('@/lib/solar/proposals/narrative', () => ({ narrativeAvailable: h.narrative, NO_KEY_REASON: 'no key' }))
import { loadReportsPageData } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

const draft = { clientName: 'Acme', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '' }
const proposals = [
  { id: 'a1', family_id: 'a1', version: 1, status: 'issued', expires_at: '2099-01-01T00:00:00Z', issued_at: '2026-09-01T00:00:00Z', updated_at: 'T', draft, snapshot: { price: { offerExclVatZar: 1_150_000 } }, created_at: '2026-09-01' },
  { id: 'a2', family_id: 'a1', version: 2, status: 'draft', expires_at: null, issued_at: null, updated_at: 'T2', draft, snapshot: null, created_at: '2026-09-02' },
]
const events = [{ proposal_id: 'a1', kind: 'accepted', via: 'token', at: '2026-09-03T00:00:00Z', actor_name: 'C', actor_email: 'c@x.co', ip: '1.2.3.4', user_agent: 'ua', pdf_sha256: 'a'.repeat(64), authority_confirmed: true, reason: null, signature_png: 'data:image/png;base64,AA' }]

beforeEach(() => {
  vi.clearAllMocks()
  h.sel.mockResolvedValue({ ok: true, caseRow: { id: 'c1', name: 'Base', pv_source: 'manual', layout_id: null }, run: { id: 'r1' } })
  h.money.mockResolvedValue(new Map([['c1', { case_run_id: 'r1' }]]))
})

describe('loadReportsPageData', () => {
  it('money level: proposals with controls and evidence, clients, feasibility readiness', async () => {
    const user = fakeSupabase({ tables: { 'solar.proposals': proposals, 'solar.proposal_events': events } }).client
    const svc = fakeSupabase({ tables: {
      'projects.project_members': [{ project_id: 'p1', user_id: 'cv1', role: 'client_viewer', is_active: true }],
      'public.profiles': [{ id: 'cv1', full_name: 'Client Viewer', email: 'cv@acme.example' }],
    } }).client
    const d = await loadReportsPageData(user as never, svc as never, 'p1', 'edit_financials')
    expect(d.selected).toEqual({ ok: true, caseId: 'c1', caseName: 'Base', runId: 'r1' })
    expect(d.feasibility).toEqual({ ok: true, reason: null })
    expect(d.layoutSheet).toEqual({ available: false, reason: 'This case uses a manual system size.' })
    expect(d.proposals.map((p) => [p.id, p.effectiveStatus, p.controls.canRevise, p.controls.canWithdraw])).toEqual([['a2', 'draft', false, false], ['a1', 'issued', false, true]])
    expect(d.proposals[1]!.offerExclVat).toBe('R 1 150 000')
    expect(d.proposals[1]!.events[0]).toEqual({ kind: 'accepted', via: 'token', at: '2026-09-03T00:00:00Z', actorName: 'C', actorEmail: 'c@x.co', ip: '1.2.3.4', userAgent: 'ua', pdfSha256: 'a'.repeat(64), authority: true, reason: null, hasSignature: true })
    expect(d.clientContacts).toEqual([{ userId: 'cv1', name: 'Client Viewer', email: 'cv@acme.example' }])
    expect(d.narrative).toEqual({ available: false, reason: 'no key' })
    expect(d.emailEnabled).toBe(true)
    expect(JSON.parse(JSON.stringify(d))).toEqual(d) // JSON-only props
  })
  it('below money: no proposals, no clients, feasibility hidden', async () => {
    const d = await loadReportsPageData(fakeSupabase().client as never, fakeSupabase().client as never, 'p1', 'edit')
    expect(d.proposals).toEqual([])
    expect(d.clientContacts).toEqual([])
    expect(d.feasibility).toEqual({ ok: false, reason: null })
  })
  it('carries the selected-case refusal (e.g. Stale)', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    const d = await loadReportsPageData(fakeSupabase().client as never, fakeSupabase().client as never, 'p1', 'view')
    expect(d.selected).toEqual({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/page-data.ts`:

```ts
import 'server-only'
/** Reports & Proposal tab view model (spec §9). JSON only; money parts empty below Edit + financials. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolarAccessLevel } from '@esite/shared'
import {
  effectiveProposalStatus, proposalControls, readProposalDraft, zar,
  type EffectiveProposalStatus, type ProposalControls, type ProposalDraft, type ProposalStatus,
} from '@esite/shared/solar-reports'
import { latestMoney } from '@/lib/solar/cases/page-data'
import { solarEmailEnabled } from '@/lib/solar/proposals/email-toggle'
import { narrativeAvailable, NO_KEY_REASON } from '@/lib/solar/proposals/narrative'
import { loadSelectedCase } from './selected-case'
import { REPORT_ERRORS } from './generate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface ProposalEventView {
  kind: string; via: string; at: string; actorName: string | null; actorEmail: string | null
  ip: string | null; userAgent: string | null; pdfSha256: string | null; authority: boolean | null; reason: string | null; hasSignature: boolean
}
export interface ProposalListItem {
  id: string; familyId: string; version: number; status: ProposalStatus; effectiveStatus: EffectiveProposalStatus
  expiresAt: string | null; issuedAt: string | null; updatedAt: string; draft: ProposalDraft
  offerExclVat: string | null; controls: ProposalControls; events: ProposalEventView[]
}
export interface ReportsPageData {
  level: SolarAccessLevel
  selected: { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }
  feasibility: { ok: boolean; reason: string | null }
  layoutSheet: { available: boolean; reason: string | null }
  proposals: ProposalListItem[]
  clientContacts: Array<{ userId: string; name: string; email: string }>
  narrative: { available: boolean; reason: string | null }
  emailEnabled: boolean
}

export async function loadReportsPageData(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel): Promise<ReportsPageData> {
  const money = level === 'edit_financials'
  const sel = await loadSelectedCase(user, svc, projectId)
  const selected: ReportsPageData['selected'] = sel.ok
    ? { ok: true, caseId: sel.caseRow.id, caseName: sel.caseRow.name, runId: sel.run.id }
    : { ok: false, stale: sel.stale, reason: sel.reason }

  let feasibility: ReportsPageData['feasibility'] = { ok: false, reason: null }
  if (money && sel.ok) {
    const fin = (await latestMoney(user, [sel.caseRow.id])).get(sel.caseRow.id) as Row | undefined
    feasibility = fin && fin.case_run_id === sel.run.id ? { ok: true, reason: null } : { ok: false, reason: REPORT_ERRORS.noFinancials }
  }

  let layoutSheet: ReportsPageData['layoutSheet'] = { available: false, reason: 'Choose a selected case first.' }
  if (sel.ok) {
    if (sel.caseRow.pv_source !== 'layout' || !sel.caseRow.layout_id) layoutSheet = { available: false, reason: 'This case uses a manual system size.' }
    else {
      const { data } = await user.schema('projects').from('reports').select('id').eq('project_id', projectId)
        .eq('kind', 'solar_layout_sheet').eq('source_id', sel.caseRow.layout_id).eq('status', 'issued').limit(1)
      layoutSheet = Array.isArray(data) && data.length ? { available: true, reason: null } : { available: false, reason: REPORT_ERRORS.noSheet }
    }
  }

  let proposals: ProposalListItem[] = []
  let clientContacts: ReportsPageData['clientContacts'] = []
  if (money) {
    const { data: rows } = await user.schema('solar').from('proposals')
      .select('id, family_id, version, status, expires_at, issued_at, updated_at, draft, snapshot, created_at').eq('project_id', projectId).order('created_at', { ascending: false })
    const list = (rows ?? []) as Row[]
    const ids = list.map((r) => String(r.id))
    const { data: evs } = ids.length
      ? await user.schema('solar').from('proposal_events').select('proposal_id, kind, via, at, actor_name, actor_email, ip, user_agent, pdf_sha256, authority_confirmed, reason, signature_png').in('proposal_id', ids).order('at', { ascending: true })
      : { data: [] }
    const now = Date.now()
    const byFamily = new Map<string, Row[]>()
    for (const r of list) byFamily.set(String(r.family_id), [...(byFamily.get(String(r.family_id)) ?? []), r])
    proposals = list
      .sort((a, b) => String(a.family_id).localeCompare(String(b.family_id)) || Number(b.version) - Number(a.version))
      .map((r) => {
        const fam = byFamily.get(String(r.family_id)) ?? []
        const status = r.status as ProposalStatus
        const expiresAt = (r.expires_at as string | null) ?? null
        const price = (r.snapshot as { price?: { offerExclVatZar?: number } } | null)?.price?.offerExclVatZar
        return {
          id: String(r.id), familyId: String(r.family_id), version: Number(r.version), status,
          effectiveStatus: effectiveProposalStatus(status, expiresAt, now),
          expiresAt, issuedAt: (r.issued_at as string | null) ?? null, updatedAt: String(r.updated_at),
          draft: readProposalDraft(r.draft),
          offerExclVat: typeof price === 'number' ? zar(price) : null,
          controls: proposalControls({
            status, expiresAt,
            isLatest: Number(r.version) === Math.max(...fam.map((f) => Number(f.version))),
            familyHasDraft: fam.some((f) => f.status === 'draft'),
            familyHasAccepted: fam.some((f) => f.status === 'accepted'),
          }, now),
          events: ((evs ?? []) as Row[]).filter((e) => e.proposal_id === r.id).map((e) => ({
            kind: String(e.kind), via: String(e.via), at: String(e.at),
            actorName: (e.actor_name as string | null) ?? null, actorEmail: (e.actor_email as string | null) ?? null,
            ip: (e.ip as string | null) ?? null, userAgent: (e.user_agent as string | null) ?? null,
            pdfSha256: (e.pdf_sha256 as string | null) ?? null, authority: (e.authority_confirmed as boolean | null) ?? null,
            reason: (e.reason as string | null) ?? null, hasSignature: typeof e.signature_png === 'string',
          })),
        }
      })
    const { data: members } = await svc.schema('projects').from('project_members').select('user_id')
      .eq('project_id', projectId).eq('role', 'client_viewer').eq('is_active', true)
    const cids = ((members ?? []) as Row[]).map((m) => String(m.user_id))
    const { data: profs } = cids.length ? await svc.from('profiles').select('id, full_name, email').in('id', cids) : { data: [] }
    clientContacts = ((profs ?? []) as Row[])
      .filter((p) => typeof p.email === 'string')
      .map((p) => ({ userId: String(p.id), name: ((p.full_name as string | null) ?? '').trim() || String(p.email), email: String(p.email) }))
  }

  return {
    level, selected, feasibility, layoutSheet, proposals, clientContacts,
    narrative: narrativeAvailable() ? { available: true, reason: null } : { available: false, reason: NO_KEY_REASON },
    emailEnabled: money ? await solarEmailEnabled(projectId) : false,
  }
}
```
(Draft first within a family: the sort is family, then version descending.)

- [ ] **Step 3: Failing test** `ReportGenerator.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: h.gen }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { ReportGenerator } from './ReportGenerator'

const ok = { ok: true as const, caseId: 'c1', caseName: 'Base', runId: 'r1' }
beforeEach(() => vi.clearAllMocks())

describe('ReportGenerator (§9.2)', () => {
  it('View: renders nothing (controls above the level are hidden)', () => {
    const { container } = render(<ReportGenerator projectId="p1" level="view" selected={ok} feasibility={{ ok: false, reason: null }} layoutSheet={{ available: false, reason: 'x' }} />)
    expect(container.innerHTML).toBe('')
  })
  it('Edit: technical only; both disabled with the reason when Stale', () => {
    render(<ReportGenerator projectId="p1" level="edit" selected={{ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' }} feasibility={{ ok: false, reason: null }} layoutSheet={{ available: false, reason: 'x' }} />)
    const t = screen.getByRole('button', { name: 'Generate technical report' }) as HTMLButtonElement
    expect(t.disabled).toBe(true)
    expect(t.title).toBe('The selected case is stale — re-run it first.')
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })
  it('options: layout sheet disabled with its reason; bill check disabled until Phase 2b', () => {
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: false, reason: 'This case uses a manual system size.' }} />)
    expect((screen.getByLabelText('Include layout sheet') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('This case uses a manual system size.')).toBeTruthy()
    expect((screen.getByLabelText('Include bill check') as HTMLInputElement).disabled).toBe(true)
  })
  it('generates with the note and options, then reports the version and any branding warning', async () => {
    h.gen.mockResolvedValue({ ok: true, reportId: 'r', version: 3, warning: 'Your organisation has no report branding, so a neutral template was used.' })
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: true, reason: null }} />)
    fireEvent.change(screen.getByLabelText('Revision note'), { target: { value: 'Rev C' } })
    fireEvent.click(screen.getByLabelText('Include 8760 appendix'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', kind: 'feasibility', note: 'Rev C', options: { includeLayoutSheet: false, include8760: true } }))
    expect(await screen.findByText('Feasibility report v3 saved.')).toBeTruthy()
    expect(screen.getByText(/neutral template/)).toBeTruthy()
    expect(h.refresh).toHaveBeenCalled()
  })
  it('shows a refusal as a sentence', async () => {
    h.gen.mockResolvedValue({ error: 'Run financials for the selected case first (Financials tab).' })
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: true, reason: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate technical report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run financials for the selected case first (Financials tab).')
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** `ReportGenerator.tsx`:

```tsx
'use client'
/** Generate feasibility / technical report (spec §9.2) with revision note and report options. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { generateSolarReportAction } from '@/actions/solar-reports.actions'

type Selected = { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }

export function ReportGenerator({ projectId, level, selected, feasibility, layoutSheet }: {
  projectId: string; level: SolarAccessLevel; selected: Selected
  feasibility: { ok: boolean; reason: string | null }; layoutSheet: { available: boolean; reason: string | null }
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [sheet, setSheet] = useState(false)
  const [hourly, setHourly] = useState(false)
  const [busy, setBusy] = useState<null | 'feasibility' | 'technical'>(null)
  const [done, setDone] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (level === 'view') return null
  const blocked = selected.ok ? null : selected.reason

  async function go(kind: 'feasibility' | 'technical') {
    setBusy(kind); setError(null); setDone(null); setWarning(null)
    const r = await generateSolarReportAction({ projectId, kind, note, options: { includeLayoutSheet: sheet, include8760: hourly } })
    setBusy(null)
    if ('error' in r) { setError(r.error); return }
    setDone(`${kind === 'feasibility' ? 'Feasibility' : 'Technical'} report v${r.version} saved.`)
    setWarning(r.warning)
    setNote('')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">{`Generate a report${selected.ok ? ` — ${selected.caseName}` : ''}`}</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 0 }}>Reports are built from the selected case’s stored run — nothing is recomputed.</p>
        <label htmlFor="solar-report-note" style={{ fontSize: 12 }}>Revision note</label>
        <textarea id="solar-report-note" aria-label="Revision note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={2} style={{ width: '100%', display: 'block', marginBottom: 8 }} />
        <div style={{ display: 'grid', gap: 4, fontSize: 13, marginBottom: 12 }}>
          <label><input type="checkbox" aria-label="Include layout sheet" disabled={!layoutSheet.available} checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Include layout sheet</label>
          {!layoutSheet.available && layoutSheet.reason && <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 22 }}>{layoutSheet.reason}</span>}
          <label><input type="checkbox" aria-label="Include 8760 appendix" checked={hourly} onChange={(e) => setHourly(e.target.checked)} /> Include 8760 appendix (names the run and its hourly CSV export)</label>
          <label><input type="checkbox" aria-label="Include bill check" disabled /> Include bill check</label>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 22 }}>Bill check arrives with the Tariff tab (Phase 2b).</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" size="sm" variant="secondary" disabled={Boolean(blocked) || busy !== null} title={blocked ?? undefined} onClick={() => go('technical')}>
            {busy === 'technical' ? 'Generating…' : 'Generate technical report'}
          </Button>
          {level === 'edit_financials' && (
            <Button type="button" size="sm" disabled={Boolean(blocked) || !feasibility.ok || busy !== null} title={blocked ?? feasibility.reason ?? undefined} onClick={() => go('feasibility')}>
              {busy === 'feasibility' ? 'Generating…' : 'Generate feasibility report'}
            </Button>
          )}
        </div>
        {done && <p role="status" style={{ fontSize: 13 }}>{done}</p>}
        {warning && <p style={{ fontSize: 12, color: 'var(--c-warning, #b45309)' }}>{warning}</p>}
        {error && <p role="alert" style={{ fontSize: 13, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 5: Implement the page** `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/page.tsx`:

```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadReportsPageData } from '@/lib/solar/reports/page-data'
import { loadSolarReadinessExtra } from '@/lib/solar/cases/page-data'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { StaleBanner } from '../../_components/StaleBanner'
import { ReportGenerator } from './ReportGenerator'
import { ProposalsPanel } from './ProposalsPanel'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Reports & Proposal (spec §9). Technical for View+; feasibility and proposals for Edit + financials only. */
export default async function SolarReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const svc = createServiceClient() as unknown as AnyClient
  const [data, extra, { data: isGrantor }] = await Promise.all([
    loadReportsPageData(supabase, svc, id, level),
    loadSolarReadinessExtra(supabase, svc, id, level),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
  ])
  const money = level === 'edit_financials'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {extra.stale && <StaleBanner projectId={id} caseId={extra.stale.caseId} caseName={extra.stale.caseName} canRun={level !== 'view'} />}
      <ReportGenerator projectId={id} level={level} selected={data.selected} feasibility={data.feasibility} layoutSheet={data.layoutSheet} />
      <SavedReportsPanel projectId={id} kind="solar_technical" title="Technical reports" canManage={isGrantor === true} />
      {money && <SavedReportsPanel projectId={id} kind="solar_feasibility" title="Feasibility reports" canManage={isGrantor === true} />}
      {money && (
        <ProposalsPanel
          projectId={id} proposals={data.proposals} selected={data.selected} clientContacts={data.clientContacts}
          narrative={data.narrative} emailEnabled={data.emailEnabled}
        />
      )}
      {money && <SavedReportsPanel projectId={id} kind="solar_proposal" title="Issued proposal PDFs" canManage={false} />}
    </div>
  )
}
```
(`canManage` = delete; spec §9.2 says Delete is `OWNER_ADMIN`, i.e. the Solar grantors; `deleteProjectReportAction` also requires Solar Edit and never deletes a proposal PDF.)

- [ ] **Step 6: Run — PASS (the page is exercised by `next build` in Task 34); commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/page-data.test.ts 'src/app/(admin)/projects/[id]/solar/(gated)/reports/ReportGenerator' 2>&1 | tail -5
git add apps/web/src/lib/solar/reports/page-data.ts apps/web/src/lib/solar/reports/page-data.test.ts 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/page.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/ReportGenerator.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/ReportGenerator.test.tsx'
git commit -m "feat(solar): Reports & Proposal tab shell and report generator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(The commit will not type-check until `ProposalsPanel` exists — Task 26 adds it before any build runs. If the executor type-checks per task, create `ProposalsPanel.tsx` exporting `export function ProposalsPanel(_: unknown) { return null }` here and replace it in Task 26.)

---

### Task 26: Proposals panel — editor, preview, issue, withdraw, revise, new link, acceptance record

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/ProposalsPanel.tsx`, `ProposalEditor.tsx`, `IssueDialog.tsx`, `AcceptanceRecord.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/ProposalsPanel.test.tsx`

- [ ] **Step 1: Failing test** `ProposalsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
const h = vi.hoisted(() => ({
  create: vi.fn(), save: vi.fn(), del: vi.fn(), revise: vi.fn(), issue: vi.fn(), withdraw: vi.fn(), link: vi.fn(), narrative: vi.fn(), refresh: vi.fn(),
}))
vi.mock('@/actions/solar-proposals.actions', () => ({
  createSolarProposalAction: h.create, saveSolarProposalDraftAction: h.save, deleteSolarProposalDraftAction: h.del,
  reviseSolarProposalAction: h.revise, issueSolarProposalAction: h.issue, withdrawSolarProposalAction: h.withdraw,
  newSolarProposalLinkAction: h.link, draftSolarProposalNarrativeAction: h.narrative,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { ProposalsPanel } from './ProposalsPanel'
import type { ProposalListItem } from '@/lib/solar/reports/page-data'

const draft = { clientName: 'Acme', marginPct: 0, validityDays: 30, financeOptions: ['cash' as const], summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '' }
const controls = (o: Partial<ProposalListItem['controls']> = {}) => ({ canEdit: false, canIssue: false, canDelete: false, canWithdraw: false, canRotate: false, canRevise: false, ...o })
const item = (o: Partial<ProposalListItem>): ProposalListItem => ({
  id: 'd1', familyId: 'f1', version: 1, status: 'draft', effectiveStatus: 'draft', expiresAt: null, issuedAt: null, updatedAt: 'T0', draft, offerExclVat: null, controls: controls(), events: [], ...o,
})
const selected = { ok: true as const, caseId: 'c1', caseName: 'Base', runId: 'r1' }
const base = { projectId: 'p1', selected, clientContacts: [{ userId: 'cv1', name: 'Client Viewer', email: 'cv@acme.example' }], narrative: { available: true, reason: null }, emailEnabled: true }

beforeEach(() => vi.clearAllMocks())

describe('ProposalsPanel (§9.3)', () => {
  it('empty state with New proposal; disabled with the reason when no selected case', () => {
    const { rerender } = render(<ProposalsPanel {...base} proposals={[]} />)
    expect(screen.getByText('No proposals yet')).toBeTruthy()
    rerender(<ProposalsPanel {...base} selected={{ ok: false, stale: false, reason: 'Choose a selected case on the Overview first.' }} proposals={[]} />)
    const b = screen.getByRole('button', { name: 'New proposal' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('Choose a selected case on the Overview first.')
  })
  it('draft: edit and save with the stale guard; margin 0 is flagged; field errors shown', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { clientName: 'Enter the client name' } }).mockResolvedValueOnce({ ok: true, updatedAt: 'T1' })
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true, canIssue: true, canDelete: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft v1' }))
    expect(screen.getByText('Margin is 0 % — set one here, or a default margin on the org rate card.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Enter the client name')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Acme Retail' } })
    fireEvent.change(screen.getByLabelText('Inclusions (one per line)'), { target: { value: 'Monitoring\n\nCleaning' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(h.save).toHaveBeenLastCalledWith({ projectId: 'p1', proposalId: 'd1', expectedUpdatedAt: 'T0', draft: expect.objectContaining({ clientName: 'Acme Retail', inclusions: ['Monitoring', 'Cleaning'] }) }))
  })
  it('Preview PDF opens the preview route', () => {
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true, canIssue: true }) })]} />)
    expect(screen.getByRole('link', { name: 'Preview PDF' }).getAttribute('href')).toBe('/api/projects/p1/solar/proposals/d1/preview')
  })
  it('Issue is two-step, sends the chosen client ids, then shows the link ONCE with the email note', async () => {
    h.issue.mockResolvedValue({ ok: true, link: 'https://www.e-site.live/proposal/TOKEN', emailed: 0, emailNote: 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.' })
    render(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canIssue: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issue v1' }))
    fireEvent.click(screen.getByLabelText('Email Client Viewer (cv@acme.example)'))
    const issue = screen.getByRole('button', { name: 'Issue proposal' })
    fireEvent.click(issue)
    expect(h.issue).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm issue' }))
    await waitFor(() => expect(h.issue).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'd1', expectedUpdatedAt: 'T0', emailClientUserIds: ['cv1'] }))
    expect((await screen.findByLabelText('Client link')) as HTMLInputElement).toHaveProperty('value', 'https://www.e-site.live/proposal/TOKEN')
    expect(screen.getByText(/shown once/)).toBeTruthy()
    expect(screen.getByText(/Solar emails are off/)).toBeTruthy()
  })
  it('email choices are disabled with the reason when the project toggle is off', () => {
    render(<ProposalsPanel {...base} emailEnabled={false} proposals={[item({ controls: controls({ canIssue: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Issue v1' }))
    expect((screen.getByLabelText('Email Client Viewer (cv@acme.example)') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Solar emails are off for this project — turn them on under Project settings, Integrations.')).toBeTruthy()
  })
  it('issued: status chip, Withdraw two-step, New link, Revise', async () => {
    h.withdraw.mockResolvedValue({ ok: true })
    h.revise.mockResolvedValue({ ok: true, proposalId: 'd2', version: 2 })
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i1', status: 'viewed', effectiveStatus: 'viewed', expiresAt: '2026-10-29T08:00:00Z', issuedAt: '2026-09-29T08:00:00Z', offerExclVat: 'R 1 150 000', controls: controls({ canWithdraw: true, canRotate: true, canRevise: true }) })]} />)
    expect(screen.getByText('Viewed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw v1' }))
    expect(h.withdraw).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdraw v1' }))
    await waitFor(() => expect(h.withdraw).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revise v1' }))
    await waitFor(() => expect(h.revise).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'i1' }))
    expect(screen.getByRole('button', { name: 'New link for v1' })).toBeTruthy()
  })
  it('acceptance record shows the stamped evidence', () => {
    render(<ProposalsPanel {...base} proposals={[item({ id: 'i1', status: 'accepted', effectiveStatus: 'accepted', events: [
      { kind: 'accepted', via: 'token', at: '2026-10-01T10:00:00Z', actorName: 'Client Name', actorEmail: 'c@acme.example', ip: '203.0.113.7', userAgent: 'agent', pdfSha256: 'a'.repeat(64), authority: true, reason: null, hasSignature: true },
    ] })]} />)
    const rec = screen.getByRole('table', { name: 'Acceptance record v1' })
    for (const t of ['Client Name', 'c@acme.example', '203.0.113.7', 'agent', 'a'.repeat(64), 'Yes', 'Signed']) expect(within(rec).getByText(t)).toBeTruthy()
  })
  it('Draft narrative: disabled with the reason when unavailable; inserts and keeps the saved text', async () => {
    const { rerender } = render(<ProposalsPanel {...base} narrative={{ available: false, reason: 'no key' }} proposals={[item({ controls: controls({ canEdit: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft v1' }))
    const b = screen.getByRole('button', { name: 'Draft narrative' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('no key')
    h.narrative.mockResolvedValue({ ok: true, narrative: 'Drafted text.', updatedAt: 'T9' })
    rerender(<ProposalsPanel {...base} proposals={[item({ controls: controls({ canEdit: true }) })]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft narrative' }))
    await waitFor(() => expect((screen.getByLabelText('About this proposal (narrative)') as HTMLTextAreaElement).value).toBe('Drafted text.'))
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** the four components.

`AcceptanceRecord.tsx`:
```tsx
'use client'
/** Evidence panel (spec §9.3 "Acceptance record"): exactly what the server stamped. */
import type { ProposalEventView } from '@/lib/solar/reports/page-data'

const KIND: Record<string, string> = { issued: 'Issued', viewed: 'Viewed', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', link_rotated: 'New link' }
const VIA: Record<string, string> = { app: 'E-Site', token: 'Secure link', portal: 'Client portal' }

export function AcceptanceRecord({ version, events }: { version: number; events: ProposalEventView[] }) {
  if (events.length === 0) return null
  return (
    <table aria-label={`Acceptance record v${version}`} style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr>{['Event', 'When (UTC)', 'Via', 'Name', 'Email', 'IP', 'User agent', 'PDF SHA-256', 'Authority', 'Signature', 'Reason'].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--c-border)', padding: 4 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={i}>
            <td style={{ padding: 4 }}>{KIND[e.kind] ?? e.kind}</td>
            <td style={{ padding: 4 }}>{e.at.replace('T', ' ').slice(0, 19)}</td>
            <td style={{ padding: 4 }}>{VIA[e.via] ?? e.via}</td>
            <td style={{ padding: 4 }}>{e.actorName ?? ''}</td>
            <td style={{ padding: 4 }}>{e.actorEmail ?? ''}</td>
            <td style={{ padding: 4 }}>{e.ip ?? ''}</td>
            <td style={{ padding: 4, maxWidth: 160, overflowWrap: 'anywhere' }}>{e.userAgent ?? ''}</td>
            <td style={{ padding: 4, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{e.pdfSha256 ?? ''}</td>
            <td style={{ padding: 4 }}>{e.authority === null ? '' : e.authority ? 'Yes' : 'No'}</td>
            <td style={{ padding: 4 }}>{e.hasSignature ? 'Signed' : ''}</td>
            <td style={{ padding: 4 }}>{e.reason ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

`ProposalEditor.tsx`:
```tsx
'use client'
/** Draft editor (spec §9.3): structured fields, optional AI narrative (D-17), explicit Save (stale-guarded). */
import { useState } from 'react'
import { FINANCE_OPTION_KINDS, FINANCE_OPTION_LABELS, type FinanceOptionKind, type ProposalDraft } from '@esite/shared/solar-reports'
import { Button } from '@/components/ui/Button'
import { draftSolarProposalNarrativeAction, saveSolarProposalDraftAction } from '@/actions/solar-proposals.actions'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export function ProposalEditor({ projectId, proposalId, version, initial, updatedAt, narrative, onSaved }: {
  projectId: string; proposalId: string; version: number; initial: ProposalDraft; updatedAt: string
  narrative: { available: boolean; reason: string | null }; onSaved: (updatedAt: string) => void
}) {
  const [d, setD] = useState<ProposalDraft>(initial)
  const [inc, setInc] = useState(initial.inclusions.join('\n'))
  const [exc, setExc] = useState(initial.exclusions.join('\n'))
  const [stamp, setStamp] = useState(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | 'save' | 'ai'>(null)
  const [message, setMessage] = useState<string | null>(null)
  const set = <K extends keyof ProposalDraft>(k: K, v: ProposalDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const field = (k: keyof ProposalDraft, label: string, rows = 3) => (
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
      {label}
      <textarea aria-label={label} rows={rows} value={d[k] as string} onChange={(e) => set(k, e.target.value as never)} />
      {errors[k] && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors[k]}</span>}
    </label>
  )

  async function save() {
    setBusy('save'); setErrors({}); setMessage(null)
    const draft = { ...d, inclusions: lines(inc), exclusions: lines(exc) }
    const r = await saveSolarProposalDraftAction({ projectId, proposalId, draft, expectedUpdatedAt: stamp })
    setBusy(null)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    if ('error' in r) { setMessage(r.error); return }
    setStamp(r.updatedAt); setMessage('Draft saved.'); onSaved(r.updatedAt)
  }
  async function ai() {
    setBusy('ai'); setMessage(null)
    const r = await draftSolarProposalNarrativeAction({ projectId, proposalId, expectedUpdatedAt: stamp })
    setBusy(null)
    if ('error' in r) { setMessage(r.error); return }
    set('narrative', r.narrative); setStamp(r.updatedAt); onSaved(r.updatedAt)
    setMessage('Narrative drafted and saved — edit it as you like.')
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 8, border: '1px solid var(--c-border)', borderRadius: 6 }}>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
        Client name
        <input aria-label="Client name" value={d.clientName} onChange={(e) => set('clientName', e.target.value)} />
        {errors.clientName && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors.clientName}</span>}
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>Margin (%) <input aria-label="Margin (%)" type="number" min={0} max={100} step="0.1" value={d.marginPct} onChange={(e) => set('marginPct', Number(e.target.value))} /></label>
        <label style={{ fontSize: 12 }}>Validity (days) <input aria-label="Validity (days)" type="number" min={1} max={365} value={d.validityDays} onChange={(e) => set('validityDays', Math.trunc(Number(e.target.value)))} /></label>
      </div>
      {d.marginPct === 0 && <p style={{ fontSize: 12, margin: 0 }}>Margin is 0 % — set one here, or a default margin on the org rate card.</p>}
      {(errors.marginPct || errors.validityDays) && <span role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{errors.marginPct ?? errors.validityDays}</span>}
      <fieldset style={{ fontSize: 12 }}>
        <legend>Finance options offered</legend>
        {FINANCE_OPTION_KINDS.map((k: FinanceOptionKind) => (
          <label key={k} style={{ marginRight: 12 }}>
            <input type="checkbox" aria-label={FINANCE_OPTION_LABELS[k]} checked={d.financeOptions.includes(k)}
              onChange={(e) => set('financeOptions', e.target.checked ? FINANCE_OPTION_KINDS.filter((x) => x === k || d.financeOptions.includes(x)) : d.financeOptions.filter((x) => x !== k))} />
            {' '}{FINANCE_OPTION_LABELS[k]}
          </label>
        ))}
        <div style={{ color: 'var(--c-text-dim)' }}>Each option’s inputs come from the case’s Financials tab; the client price is the capex plus your margin.</div>
        {errors.financeOptions && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors.financeOptions}</span>}
      </fieldset>
      {field('summary', 'Summary')}
      <div style={{ display: 'grid', gap: 4 }}>
        {field('narrative', 'About this proposal (narrative)', 5)}
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={!narrative.available || busy !== null} title={narrative.reason ?? undefined} onClick={ai}>
            {busy === 'ai' ? 'Drafting…' : 'Draft narrative'}
          </Button>
        </div>
      </div>
      {field('scope', 'Scope', 4)}
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Inclusions (one per line)<textarea aria-label="Inclusions (one per line)" rows={3} value={inc} onChange={(e) => setInc(e.target.value)} /></label>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Exclusions (one per line)<textarea aria-label="Exclusions (one per line)" rows={3} value={exc} onChange={(e) => setExc(e.target.value)} /></label>
      {field('priceTerms', 'Price and payment terms')}
      {field('assumptions', 'Assumptions')}
      {field('terms', 'Terms and conditions', 5)}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button type="button" size="sm" disabled={busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`Draft v${version}`}</span>
      </div>
      {message && <p role="status" style={{ fontSize: 12, margin: 0 }}>{message}</p>}
    </div>
  )
}
```

`IssueDialog.tsx`:
```tsx
'use client'
/** Issue (spec §9.3): two-step; freezes the snapshot + PDF + SHA-256 and returns the client link ONCE. */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { issueSolarProposalAction } from '@/actions/solar-proposals.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export function IssueDialog({ projectId, proposalId, updatedAt, validityDays, clientContacts, emailEnabled, onIssued }: {
  projectId: string; proposalId: string; updatedAt: string; validityDays: number
  clientContacts: Array<{ userId: string; name: string; email: string }>; emailEnabled: boolean
  onIssued: (r: { link: string; emailNote: string | null; emailed: number }) => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { armed, arm, disarm } = useArmedConfirm()
  const validUntil = new Date(Date.now() + validityDays * 86_400_000).toISOString().slice(0, 10)

  async function issue() {
    disarm(); setBusy(true); setError(null)
    const r = await issueSolarProposalAction({ projectId, proposalId, expectedUpdatedAt: updatedAt, emailClientUserIds: chosen })
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    onIssued({ link: r.link, emailNote: r.emailNote, emailed: r.emailed })
  }

  return (
    <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--c-border)', borderRadius: 6 }}>
      <p style={{ fontSize: 12, margin: 0 }}>{`Issuing freezes this version: the figures, the PDF and its SHA-256 can no longer change. The client link expires on ${validUntil}.`}</p>
      {clientContacts.length === 0
        ? <p style={{ fontSize: 12, margin: 0 }}>No client contacts on this project — copy the link after issuing, or add a client viewer to email it.</p>
        : clientContacts.map((c) => (
          <label key={c.userId} style={{ fontSize: 12 }}>
            <input type="checkbox" aria-label={`Email ${c.name} (${c.email})`} disabled={!emailEnabled} checked={chosen.includes(c.userId)}
              onChange={(e) => setChosen((x) => (e.target.checked ? [...x, c.userId] : x.filter((y) => y !== c.userId)))} />
            {` Email ${c.name} (${c.email})`}
          </label>
        ))}
      {!emailEnabled && clientContacts.length > 0 && <p style={{ fontSize: 12, margin: 0 }}>Solar emails are off for this project — turn them on under Project settings, Integrations.</p>}
      <div>
        {armed
          ? <Button type="button" size="sm" variant="danger" disabled={busy} onClick={issue}>Confirm issue</Button>
          : <Button type="button" size="sm" disabled={busy} onClick={arm}>{busy ? 'Issuing…' : 'Issue proposal'}</Button>}
      </div>
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)', margin: 0 }}>{error}</p>}
    </div>
  )
}
```

`ProposalsPanel.tsx`:
```tsx
'use client'
/** Proposals (spec §9.3): list, New, draft editor, Preview, Issue, Withdraw, Revise, New link, acceptance record. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSignature } from 'lucide-react'
import { PROPOSAL_STATUS_LABELS } from '@esite/shared/solar-reports'
import type { ProposalListItem } from '@/lib/solar/reports/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  createSolarProposalAction, deleteSolarProposalDraftAction, newSolarProposalLinkAction, reviseSolarProposalAction, withdrawSolarProposalAction,
} from '@/actions/solar-proposals.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { ProposalEditor } from './ProposalEditor'
import { IssueDialog } from './IssueDialog'
import { AcceptanceRecord } from './AcceptanceRecord'

type Selected = { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }
interface Props {
  projectId: string; proposals: ProposalListItem[]; selected: Selected
  clientContacts: Array<{ userId: string; name: string; email: string }>
  narrative: { available: boolean; reason: string | null }; emailEnabled: boolean
}

function LinkOnce({ link, note }: { link: string; note: string | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 4, padding: 8, background: 'var(--c-amber-dim)', borderRadius: 6 }}>
      <label style={{ fontSize: 12 }}>Client link
        <input aria-label="Client link" readOnly value={link} style={{ width: '100%' }} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button type="button" size="sm" variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(link); setCopied(true) }}>{copied ? 'Copied' : 'Copy link'}</Button>
        <span style={{ fontSize: 12 }}>This link is shown once. Keep it; use New link to replace it (the old one stops working).</span>
      </div>
      {note && <p style={{ fontSize: 12, margin: 0 }}>{note}</p>}
    </div>
  )
}

function Row({ p, props }: { p: ProposalListItem; props: Props }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(p.updatedAt)
  const [link, setLink] = useState<{ link: string; note: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const del = useArmedConfirm(), wd = useArmedConfirm()
  const run = async (f: () => Promise<{ error?: string } | Record<string, unknown>>) => {
    setBusy(true); setError(null)
    const r = await f()
    setBusy(false)
    if (r && 'error' in r && r.error) { setError(String(r.error)); return false }
    router.refresh()
    return true
  }
  const c = p.controls
  return (
    <li style={{ borderTop: '1px solid var(--c-border)', padding: '8px 0', listStyle: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{`v${p.version}`}</strong>
        <span className="badge">{PROPOSAL_STATUS_LABELS[p.effectiveStatus]}</span>
        {p.offerExclVat && <span style={{ fontSize: 12 }}>{`${p.offerExclVat} excl. VAT`}</span>}
        {p.issuedAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`issued ${p.issuedAt.slice(0, 10)}`}</span>}
        {p.expiresAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`valid until ${p.expiresAt.slice(0, 10)}`}</span>}
        <span style={{ flex: 1 }} />
        {c.canEdit && <Button type="button" size="sm" variant="secondary" aria-label={`Edit draft v${p.version}`} onClick={() => setEditing((x) => !x)}>{editing ? 'Close editor' : 'Edit'}</Button>}
        {c.canIssue && <a href={`/api/projects/${props.projectId}/solar/proposals/${p.id}/preview`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Preview PDF</a>}
        {c.canIssue && <Button type="button" size="sm" aria-label={`Issue v${p.version}`} onClick={() => setIssuing((x) => !x)}>Issue</Button>}
        {c.canDelete && (del.armed
          ? <Button type="button" size="sm" variant="danger" aria-label={`Confirm delete draft v${p.version}`} disabled={busy} onClick={() => { del.disarm(); void run(() => deleteSolarProposalDraftAction({ projectId: props.projectId, proposalId: p.id })) }}>Confirm delete</Button>
          : <Button type="button" size="sm" variant="ghost" aria-label={`Delete draft v${p.version}`} onClick={del.arm}>Delete</Button>)}
        {c.canWithdraw && (wd.armed
          ? <Button type="button" size="sm" variant="danger" aria-label={`Confirm withdraw v${p.version}`} disabled={busy} onClick={() => { wd.disarm(); void run(() => withdrawSolarProposalAction({ projectId: props.projectId, proposalId: p.id })) }}>Confirm withdraw</Button>
          : <Button type="button" size="sm" variant="secondary" aria-label={`Withdraw v${p.version}`} onClick={wd.arm}>Withdraw</Button>)}
        {c.canRotate && <Button type="button" size="sm" variant="secondary" aria-label={`New link for v${p.version}`} disabled={busy}
          onClick={async () => { setBusy(true); const r = await newSolarProposalLinkAction({ projectId: props.projectId, proposalId: p.id }); setBusy(false); if ('error' in r) setError(r.error); else setLink({ link: r.link, note: null }) }}>New link</Button>}
        {c.canRevise && <Button type="button" size="sm" variant="secondary" aria-label={`Revise v${p.version}`} disabled={busy} onClick={() => void run(() => reviseSolarProposalAction({ projectId: props.projectId, proposalId: p.id }))}>Revise</Button>}
      </div>
      {editing && <ProposalEditor projectId={props.projectId} proposalId={p.id} version={p.version} initial={p.draft} updatedAt={updatedAt} narrative={props.narrative} onSaved={setUpdatedAt} />}
      {issuing && !link && (
        <IssueDialog projectId={props.projectId} proposalId={p.id} updatedAt={updatedAt} validityDays={p.draft.validityDays}
          clientContacts={props.clientContacts} emailEnabled={props.emailEnabled}
          onIssued={(r) => { setLink({ link: r.link, note: r.emailNote }); router.refresh() }} />
      )}
      {link && <LinkOnce link={link.link} note={link.note} />}
      <AcceptanceRecord version={p.version} events={p.events} />
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
    </li>
  )
}

export function ProposalsPanel(props: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = props.selected.ok ? null : props.selected.reason
  const create = async () => {
    setBusy(true); setError(null)
    const r = await createSolarProposalAction({ projectId: props.projectId })
    setBusy(false)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Client proposals</span></CardHeader>
      <CardBody>
        <Button type="button" size="sm" disabled={Boolean(blocked) || busy} title={blocked ?? undefined} onClick={create}>{busy ? 'Creating…' : 'New proposal'}</Button>
        {props.proposals.length === 0
          ? <EmptyState icon={FileSignature} dense title="No proposals yet" description="Draft a client offer from the selected case." />
          : <ul style={{ margin: '8px 0 0', padding: 0 }}>{props.proposals.map((p) => <Row key={p.id} p={p} props={props} />)}</ul>}
        {error && <p role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
      </CardBody>
    </Card>
  )
}
```
Check the test's button names against the `aria-label`s above (they win over text for accessible names): `Edit draft v1`, `Issue v1`, `Withdraw v1` / `Confirm withdraw v1`, `Revise v1`, `New link for v1`, `Issue proposal` / `Confirm issue`. If `EmptyState` has no `description` prop, drop it.

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar/(gated)/reports' 2>&1 | tail -5
git add 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports'
git commit -m "feat(solar): proposal editor, preview, issue, withdraw, revise, new link, acceptance record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: The client view (shared by the token page and the portal) + signature pad

**Files:**
- Create: `apps/web/src/components/solar/proposal/SignaturePad.tsx`
- Create: `apps/web/src/components/solar/proposal/ProposalClientView.tsx`, `ProposalClientView.test.tsx`

- [ ] **Step 1: Failing test** `ProposalClientView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ portalRespond: vi.fn(), portalPdf: vi.fn() }))
vi.mock('@/actions/solar-portal-proposals.actions', () => ({ respondToPortalProposalAction: h.portalRespond, getPortalProposalPdfUrlAction: h.portalPdf }))
import { financeOptionTable, keyFigures } from '@esite/shared/solar-reports'
import { proposalSnapshot } from '@/test/proposal-fixture'
import { ProposalClientView } from './ProposalClientView'
import type { ClientProposalView } from '@/lib/solar/proposals/client'

const snap = proposalSnapshot()
const view = (o: Partial<ClientProposalView> = {}): ClientProposalView => ({ state: 'viewed', version: 2, expiresAt: snap.proposal.validUntil, snapshot: snap, issuer: snap.issuer, response: null, ...o })
const TOKEN = 'A'.repeat(43)
const fetchMock = vi.fn()
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock) })

describe('ProposalClientView (§9.4)', () => {
  it('prints EXACTLY the snapshot’s key figures and finance table — the same strings the PDF prints', () => {
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    keyFigures(snap).forEach((f, i) => {
      expect(screen.getByTestId(`kf-label-${i}`).textContent).toBe(f.label)
      expect(screen.getByTestId(`kf-value-${i}`).textContent).toBe(f.value)
    })
    const t = financeOptionTable(snap)
    t.rows.forEach((r, ri) => r.forEach((c, ci) => expect(screen.getByTestId(`fo-${ri}-${ci}`).textContent).toBe(c)))
  })
  it('expired / withdrawn / not found: the no-longer-available message naming the proposer, no figures', () => {
    const { rerender } = render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'expired', snapshot: null })} />)
    expect(screen.getByText('This proposal has expired — contact Pat Proposer (pat@sun.example).')).toBeTruthy()
    expect(screen.queryByTestId('kf-value-0')).toBeNull()
    rerender(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'withdrawn', snapshot: null })} />)
    expect(screen.getByText('This proposal is no longer available — contact Pat Proposer (pat@sun.example).')).toBeTruthy()
    rerender(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'not_found', snapshot: null, issuer: null })} />)
    expect(screen.getByText('This proposal is no longer available.')).toBeTruthy()
  })
  it('Accept (token): typed name, email, authority tick; two-step; posts to the public route; shows the result', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, state: 'accepted' }) })
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'c@acme.example' } })
    const accept = screen.getByRole('button', { name: 'Accept proposal' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('I have authority to accept on behalf of Acme Retail (Pty) Ltd'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm acceptance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/solar/proposal-response', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body).toEqual({ token: TOKEN, decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null })
    expect(await screen.findByText('Thank you — you accepted this proposal.')).toBeTruthy()
  })
  it('Decline (portal) with a reason goes through the portal action', async () => {
    h.portalRespond.mockResolvedValue({ ok: true, state: 'declined' })
    render(<ProposalClientView mode={{ kind: 'portal', projectId: 'p1', proposalId: 'pr1' }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'CV' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'cv@acme.example' } })
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Too expensive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline proposal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))
    await waitFor(() => expect(h.portalRespond).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'pr1', decision: 'declined', name: 'CV', email: 'cv@acme.example', authority: false, signature: null, reason: 'Too expensive' }))
    expect(await screen.findByText('You declined this proposal.')).toBeTruthy()
  })
  it('a refusal from the server is shown as the sentence', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'This proposal has expired.' }) })
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'c@acme.example' } })
    fireEvent.click(screen.getByLabelText('I have authority to accept on behalf of Acme Retail (Pty) Ltd'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm acceptance' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This proposal has expired.')
  })
  it('already answered: shows who answered, no form', () => {
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'accepted', response: { kind: 'accepted', name: 'Client Name', at: '2026-10-01T10:00:00Z' } })} />)
    expect(screen.getByText('Accepted by Client Name on 2026-10-01.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept proposal' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `SignaturePad.tsx`:

```tsx
'use client'
/** Optional drawn signature (spec §9.4). Emits a PNG data URL (≤ 400 KB, 00216 CHECK) or null. */
import { useRef } from 'react'

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const ctx = () => ref.current?.getContext('2d') ?? null
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <canvas
        ref={ref} width={400} height={120} aria-label="Signature (optional)" role="img"
        style={{ border: '1px solid var(--c-border)', borderRadius: 4, touchAction: 'none', background: '#fff', maxWidth: '100%' }}
        onPointerDown={(e) => { const c = ctx(); if (!c) return; drawing.current = true; const p = pos(e); c.beginPath(); c.moveTo(p.x, p.y) }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); if (!c) return; const p = pos(e); c.lineWidth = 2; c.lineCap = 'round'; c.strokeStyle = '#111'; c.lineTo(p.x, p.y); c.stroke() }}
        onPointerUp={() => {
          if (!drawing.current) return
          drawing.current = false
          const url = ref.current?.toDataURL('image/png') ?? null
          onChange(url && url.length <= 400_000 ? url : null)
        }}
      />
      <button type="button" style={{ justifySelf: 'start', fontSize: 12 }} onClick={() => { const c = ctx(); if (c && ref.current) c.clearRect(0, 0, ref.current.width, ref.current.height); onChange(null) }}>Clear signature</button>
    </div>
  )
}
```

`ProposalClientView.tsx`:
```tsx
'use client'
/**
 * What the client sees (spec §9.4) — by secure link or in the portal. Renders ONLY the frozen
 * snapshot, through keyFigures() / financeOptionTable(): the same functions the PDF uses, so the
 * numbers are the same strings (the WM defect this replaces showed different assumptions).
 * Accept / Decline are two-step; the server stamps time, IP, user agent and the PDF hash.
 */
import { useState } from 'react'
import { FINANCE_OPTION_LABELS, financeOptionTable, isoDate, keyFigures } from '@esite/shared/solar-reports'
import type { ClientProposalView } from '@/lib/solar/proposals/client'
import { getPortalProposalPdfUrlAction, respondToPortalProposalAction } from '@/actions/solar-portal-proposals.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { SignaturePad } from './SignaturePad'

type Mode = { kind: 'token'; token: string } | { kind: 'portal'; projectId: string; proposalId: string }
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600 }

function contact(issuer: ClientProposalView['issuer']): string {
  return issuer ? ` — contact ${issuer.proposerName}${issuer.proposerEmail ? ` (${issuer.proposerEmail})` : ''}.` : '.'
}

export function ProposalClientView({ mode, view }: { mode: Mode; view: ClientProposalView }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [authority, setAuthority] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answered, setAnswered] = useState<null | 'accepted' | 'declined'>(null)
  const acc = useArmedConfirm(), dec = useArmedConfirm()

  if (!view.snapshot || view.state === 'expired' || view.state === 'withdrawn' || view.state === 'not_found') {
    const text = view.state === 'expired' ? `This proposal has expired${contact(view.issuer)}` : `This proposal is no longer available${contact(view.issuer)}`
    return <p style={{ fontSize: 15 }}>{text}</p>
  }
  const s = view.snapshot
  const t = financeOptionTable(s)

  async function respond(decision: 'accepted' | 'declined') {
    acc.disarm(); dec.disarm(); setBusy(true); setError(null)
    const body = { decision, name, email, authority: decision === 'accepted' ? authority : false, signature: decision === 'accepted' ? signature : null, reason: decision === 'declined' ? reason || null : null }
    let err: string | null = null
    if (mode.kind === 'token') {
      const res = await fetch('/api/solar/proposal-response', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: mode.token, ...body }) })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) err = j.error ?? 'Something went wrong — try again.'
    } else {
      const r = await respondToPortalProposalAction({ projectId: mode.projectId, proposalId: mode.proposalId, ...body })
      if ('error' in r) err = r.error
    }
    setBusy(false)
    if (err) setError(err); else setAnswered(decision)
  }
  async function download() {
    setError(null)
    if (mode.kind === 'token') {
      const res = await fetch('/api/solar/proposal-download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: mode.token }) })
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (j.url) window.location.href = j.url; else setError(j.error ?? 'The PDF could not be prepared — try again.')
    } else {
      const r = await getPortalProposalPdfUrlAction({ projectId: mode.projectId, proposalId: mode.proposalId })
      if ('url' in r) window.location.href = r.url; else setError(r.error)
    }
  }

  const done = answered ?? (view.state === 'accepted' || view.state === 'declined' ? view.state : null)
  const section = (title: string, body: string) => body.trim() ? <section><h3 style={{ fontSize: 15 }}>{title}</h3>{body.split('\n').map((l, i) => <p key={i} style={{ margin: '2px 0' }}>{l}</p>)}</section> : null
  const list = (title: string, items: string[]) => items.length ? <section><h3 style={{ fontSize: 15 }}>{title}</h3><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></section> : null

  return (
    <article style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <header>
        <p style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.issuer.orgName}</p>
        <h1 style={{ margin: '4px 0', fontSize: 22 }}>{s.proposal.title}</h1>
        <p style={{ margin: 0, fontSize: 13 }}>{`Prepared for ${s.client.name} · ${s.project.name}${s.project.address ? `, ${s.project.address}` : ''} · version ${s.proposal.version} · valid until ${isoDate(s.proposal.validUntil)}`}</p>
      </header>
      <section>
        <h2 style={{ fontSize: 17 }}>Key figures</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: '4px 12px', margin: 0 }}>
          {keyFigures(s).map((f, i) => (
            <div key={f.label} style={{ display: 'contents' }}>
              <dt data-testid={`kf-label-${i}`}>{f.label}</dt>
              <dd data-testid={`kf-value-${i}`} style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {section('Summary', s.text.summary)}
      {section('About this proposal', s.text.narrative)}
      {section('Scope', s.text.scope)}
      {list('Included', s.text.inclusions)}
      {list('Excluded', s.text.exclusions)}
      <section style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: 17 }}>Finance options</h2>
        <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
          <thead><tr>{t.columns.map((c, i) => <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1', padding: 4 }}>{c}</th>)}</tr></thead>
          <tbody>{t.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ci === 0 ? <th key={ci} data-testid={`fo-${ri}-${ci}`} style={{ textAlign: 'left', padding: 4 }}>{c}</th> : <td key={ci} data-testid={`fo-${ri}-${ci}`} style={{ padding: 4 }}>{c}</td>))}</tr>)}</tbody>
        </table>
        <p style={{ fontSize: 12 }}>{`Options offered: ${s.financeOptions.map((o) => FINANCE_OPTION_LABELS[o.kind]).join(', ')}. Figures are estimates from a modelled year; prices exclude VAT unless marked.`}</p>
      </section>
      {section('Price and payment terms', s.text.priceTerms)}
      {section('Assumptions', s.text.assumptions)}
      {section('Terms and conditions', s.text.terms)}
      {section('Disclaimer', s.text.disclaimer)}
      <p style={{ fontSize: 13 }}>{`Questions? Contact ${s.issuer.proposerName}${s.issuer.proposerEmail ? ` (${s.issuer.proposerEmail})` : ''}.`}</p>
      <div><button type="button" style={btn} onClick={download}>Download PDF</button></div>

      {done ? (
        <p role="status" style={{ fontSize: 15, fontWeight: 600 }}>
          {answered === 'accepted' ? 'Thank you — you accepted this proposal.'
            : answered === 'declined' ? 'You declined this proposal.'
            : view.response ? `${view.response.kind === 'accepted' ? 'Accepted' : 'Declined'} by ${view.response.name} on ${view.response.at.slice(0, 10)}.`
            : done === 'accepted' ? 'This proposal has been accepted.' : 'This proposal has been declined.'}
        </p>
      ) : (
        <section style={{ display: 'grid', gap: 8, borderTop: '1px solid #cbd5e1', paddingTop: 12 }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Your response</h2>
          <label style={{ display: 'grid', gap: 2 }}>Your full name<input aria-label="Your full name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ display: 'grid', gap: 2 }}>Your email<input aria-label="Your email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><input type="checkbox" aria-label={`I have authority to accept on behalf of ${s.client.name}`} checked={authority} onChange={(e) => setAuthority(e.target.checked)} />{` I have authority to accept on behalf of ${s.client.name}`}</label>
          <SignaturePad onChange={setSignature} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {acc.armed
              ? <button type="button" style={{ ...btn, background: '#166534', color: '#fff' }} disabled={busy} onClick={() => respond('accepted')}>Confirm acceptance</button>
              : <button type="button" style={btn} disabled={busy || !name.trim() || !email.trim() || !authority} onClick={acc.arm}>Accept proposal</button>}
          </div>
          <label style={{ display: 'grid', gap: 2 }}>Reason (optional)<textarea aria-label="Reason (optional)" value={reason} maxLength={2000} rows={2} onChange={(e) => setReason(e.target.value)} /></label>
          <div>
            {dec.armed
              ? <button type="button" style={{ ...btn, background: '#991b1b', color: '#fff' }} disabled={busy} onClick={() => respond('declined')}>Confirm decline</button>
              : <button type="button" style={btn} disabled={busy || !name.trim() || !email.trim()} onClick={dec.arm}>Decline proposal</button>}
          </div>
          <p style={{ fontSize: 12, margin: 0 }}>When you respond we record the time, your IP address and browser, and the fingerprint (SHA-256) of the PDF you were shown.</p>
        </section>
      )}
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    </article>
  )
}
```
Importing `useArmedConfirm` from the admin route group keeps one implementation; if lint forbids cross-group imports, move it to `apps/web/src/components/solar/useArmedConfirm.ts` and re-export it from the old path.

- [ ] **Step 3: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/components/solar/proposal 2>&1 | tail -5
git add apps/web/src/components/solar/proposal
git commit -m "feat(solar): client proposal view (same figures as the PDF) with evidential accept/decline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Public token page (no login)

**Files:**
- Create: `apps/web/src/app/(proposal)/layout.tsx`
- Modify (replace the Task 23 placeholder): `apps/web/src/app/(proposal)/proposal/[token]/page.tsx`

- [ ] **Step 1: Implement the layout** — neutral chrome, no app navigation, no E-Site marketing, `noindex`:

```tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = { title: 'Proposal', robots: { index: false, follow: false } }

/** Public proposal chrome (spec §9.4, D-18): no login, no app navigation. Branding lives in the content. */
export default function ProposalLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <main style={{ maxWidth: 860, margin: '0 auto', background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Implement the page:**

```tsx
import { headers } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'
import { loadProposalByToken } from '@/lib/solar/proposals/client'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'
import { ProposalClientView } from '@/components/solar/proposal/ProposalClientView'

export const dynamic = 'force-dynamic'

/**
 * A client opens an issued proposal by secure link (spec §9.4). The token is hashed IN SQL by a
 * service-only definer function; only the frozen snapshot comes back. Rate-limited per IP.
 * Opening it marks the proposal "viewed" (once) with the stamped IP/UA.
 */
export default async function ProposalTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const ip = clientIp(h)
  if (!rateLimit(`solar-proposal-view:${ip ?? 'unknown'}`, 60, 60_000)) {
    return <p>Too many requests — wait a minute and reload.</p>
  }
  const { view } = await loadProposalByToken(token, { ip, ua: userAgent(h) })
  return <ProposalClientView mode={{ kind: 'token', token }} view={view} />
}
```

- [ ] **Step 3: Run the middleware contract and the client view tests; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/middleware.test.ts src/components/solar/proposal 2>&1 | tail -4
git add 'apps/web/src/app/(proposal)'
git commit -m "feat(solar): public proposal page by secure link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: Portal — Proposals tab, list and detail

**Files:**
- Modify: `apps/web/src/components/portal/PortalProjectNav.tsx`, `PortalProjectNav.test.tsx`
- Create: `apps/web/src/app/(portal)/portal/[projectId]/proposals/page.tsx`
- Create: `apps/web/src/app/(portal)/portal/[projectId]/proposals/[proposalId]/page.tsx`

- [ ] **Step 1: Failing test** — in `PortalProjectNav.test.tsx` change the expected label list to end with `'Tenant Schedule', 'Proposals'`. (The "never links to financial or admin surfaces" test still holds: `proposals` is not a banned word and the link stays under `/portal/p1`.)

- [ ] **Step 2: Run — FAIL. Add the tab** to `TABS` in `PortalProjectNav.tsx`, last:
```ts
  { slug: 'proposals',         label: 'Proposals' },
```
and extend the header comment: "Proposals (Solar §9.4, D-18): issued offers only, rendered from their frozen snapshot."

- [ ] **Step 3: Implement the list page** `apps/web/src/app/(portal)/portal/[projectId]/proposals/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PROPOSAL_STATUS_LABELS, zar, type EffectiveProposalStatus } from '@esite/shared/solar-reports'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadPortalProposals } from '@/lib/solar/proposals/client'

export const dynamic = 'force-dynamic'

/** Issued Solar proposals for a portal user on this project (spec §9.4, D-18). */
export default async function PortalProposalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) notFound()
  const rows = await loadPortalProposals(projectId, access.userId)
  if (rows.length === 0) return <p style={{ fontSize: 13 }}>No proposals have been issued to you on this project.</p>
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((r) => {
        const state = String(r.state) as EffectiveProposalStatus
        const offer = typeof r.offerExclVatZar === 'number' ? `${zar(r.offerExclVatZar)} excl. VAT` : null
        return (
          <li key={String(r.proposalId)} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 12 }}>
            <Link href={`/portal/${projectId}/proposals/${String(r.proposalId)}`}>{String(r.title ?? 'Solar proposal')}</Link>
            <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
              {[`v${String(r.version)}`, PROPOSAL_STATUS_LABELS[state] ?? state, offer, r.expiresAt ? `valid until ${String(r.expiresAt).slice(0, 10)}` : null].filter(Boolean).join(' · ')}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 4: Implement the detail page** `apps/web/src/app/(portal)/portal/[projectId]/proposals/[proposalId]/page.tsx`:

```tsx
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadPortalProposal } from '@/lib/solar/proposals/client'
import { clientIp, userAgent } from '@/lib/solar/proposals/request-meta'
import { ProposalClientView } from '@/components/solar/proposal/ProposalClientView'

export const dynamic = 'force-dynamic'

/** One proposal for a portal user — the SAME view the token page renders (identical figures). */
export default async function PortalProposalPage({ params }: { params: Promise<{ projectId: string; proposalId: string }> }) {
  const { projectId, proposalId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) notFound()
  const h = await headers()
  const { view } = await loadPortalProposal(projectId, access.userId, proposalId, { ip: clientIp(h), ua: userAgent(h) })
  if (view.state === 'not_found') notFound()
  return <ProposalClientView mode={{ kind: 'portal', projectId, proposalId }} view={view} />
}
```

- [ ] **Step 5: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/components/portal 2>&1 | tail -4
git add apps/web/src/components/portal 'apps/web/src/app/(portal)/portal/[projectId]/proposals'
git commit -m "feat(solar): portal Proposals tab (list and detail from the frozen snapshot)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 30: Overview shortcut live; Reports readiness on tab dots; activity links

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/_components/GenerateFeasibilityButton.tsx`, `GenerateFeasibilityButton.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.tsx` (+ test)
- Modify: `apps/web/src/lib/solar/cases/page-data.ts` (`loadSolarReadinessExtra` fills `reports`)
- Modify: `apps/web/src/lib/solar/activity-types.ts` (if it restates the target union), `apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx` (+ test)

- [ ] **Step 1: Failing test** `GenerateFeasibilityButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(), push: vi.fn() }))
vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: h.gen }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }))
import { GenerateFeasibilityButton } from './GenerateFeasibilityButton'

beforeEach(() => vi.clearAllMocks())

describe('GenerateFeasibilityButton (Overview §2.2 shortcut = Reports → Generate)', () => {
  it('disabled with the reason', () => {
    render(<GenerateFeasibilityButton projectId="p1" disabledReason="The selected case is stale — re-run it first" />)
    const b = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('The selected case is stale — re-run it first')
  })
  it('runs the SAME action as the Reports tab, then opens the Reports tab', async () => {
    h.gen.mockResolvedValue({ ok: true, reportId: 'r', version: 1, warning: null })
    render(<GenerateFeasibilityButton projectId="p1" disabledReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: false } }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/reports')
  })
  it('shows a refusal as a sentence', async () => {
    h.gen.mockResolvedValue({ error: 'Run financials for the selected case first (Financials tab).' })
    render(<GenerateFeasibilityButton projectId="p1" disabledReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run financials for the selected case first (Financials tab).')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `GenerateFeasibilityButton.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateSolarReportAction } from '@/actions/solar-reports.actions'

/** Overview shortcut (spec §2.2): the same action as Reports → Generate feasibility report. */
export function GenerateFeasibilityButton({ projectId, disabledReason }: { projectId: string; disabledReason: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Button type="button" size="sm" variant="secondary" disabled={Boolean(disabledReason) || busy} title={disabledReason ?? undefined}
        onClick={async () => {
          setBusy(true); setError(null)
          const r = await generateSolarReportAction({ projectId, kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: false } })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.push(`/projects/${projectId}/solar/reports`)
        }}>
        {busy ? 'Generating…' : 'Generate feasibility report'}
      </Button>
      {error && <span role="alert" style={{ fontSize: 12 }}>{error}</span>}
    </>
  )
}
```

- [ ] **Step 3: Wire it into `OverviewKpis.tsx`** (the 4b version). Replace the disabled `<Button … title={stale ? … : 'Available with Reports & Proposal'}>Generate feasibility report</Button>` block with:
```tsx
          {canMoney && (
            <GenerateFeasibilityButton
              projectId={projectId}
              disabledReason={!kpis ? 'Run a case on Yield & Scenarios first' : stale ? 'The selected case is stale — re-run it first' : !m ? 'Run financials for the selected case first' : null}
            />
          )}
```
add `import { GenerateFeasibilityButton } from './GenerateFeasibilityButton'`, and remove the now-unused `Button` import if nothing else uses it. In `OverviewKpis.test.tsx` add `vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: vi.fn() }))` and add `push: vi.fn()` to the `useRouter` mock; the existing stale assertion (`disabled`, title `'The selected case is stale — re-run it first'`) keeps passing. Append:
```tsx
  it('Generate feasibility report is enabled when current and priced', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect((screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement).disabled).toBe(false)
  })
```

- [ ] **Step 4: Reports readiness in the tab dots.** In `apps/web/src/lib/solar/cases/page-data.ts` `loadSolarReadinessExtra`, before its `return`, add:
```ts
  let reports: { hasCurrentFeasibility: boolean } | null = null
  if (sel && level === 'edit_financials') {
    const { ok } = await runsByCase(user, projectId)
    const lastOk = ok.get(sel.id)
    if (lastOk) {
      const { data } = await user.schema('projects').from('reports').select('id')
        .eq('project_id', projectId).eq('kind', 'solar_feasibility').eq('source_id', lastOk.id as string).in('status', ['issued', 'superseded']).limit(1)
      reports = { hasCurrentFeasibility: Array.isArray(data) && data.length > 0 }
    } else reports = { hasCurrentFeasibility: false }
  }
```
and add `reports,` to the returned object. (A feasibility report for the CURRENT run, i.e. its `source_id`; a superseded version for the same run still counts.) Add a separate test file `apps/web/src/lib/solar/cases/page-data.reports.test.ts` (its own mocks, so it does not disturb the 4b suite):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', async (orig) => ({ ...(await orig<typeof import('./run-context')>()), loadStudyInputs: h.load, contextForCase: h.ctx }))
import { loadSolarReadinessExtra } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

const H = 'a'.repeat(64)
const user = (sourceId: string) => fakeSupabase({ tables: {
  'solar.cases': [{ id: 'c1', study_id: 's1', project_id: 'p1', name: 'Base', pv_source: 'manual', config: {}, updated_at: 'T' }],
  'solar.case_runs': [{ id: 'r1', case_id: 'c1', project_id: 'p1', status: 'succeeded', inputs_hash: H, started_at: new Date().toISOString(), finished_at: 'T', run_by: 'u' }],
  'solar.case_financials': [],
  'projects.reports': [{ id: 'f1', project_id: 'p1', kind: 'solar_feasibility', source_id: sourceId, status: 'issued' }],
} }).client

beforeEach(() => {
  vi.clearAllMocks()
  h.load.mockResolvedValue({ study: { id: 's1', organisation_id: 'o1', selected_case_id: 'c1', updated_at: 'T' }, siteLoad: null, tariff: { ok: false, reason: 'x' }, touPeriods: null })
  h.ctx.mockResolvedValue({ ok: true, ctx: { currentHash: H } })
})

describe('loadSolarReadinessExtra — Reports (Phase 6)', () => {
  it('green only when a feasibility report exists for the selected case’s latest run', async () => {
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: true } })
    await expect(loadSolarReadinessExtra(user('r-old') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: false } })
  })
  it('null below Edit + financials (they cannot see feasibility reports)', async () => {
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit')).resolves.toMatchObject({ reports: null })
  })
})
```

- [ ] **Step 5: Activity links.** In `ActivityList.tsx` `hrefFor`, add:
```ts
    if (target === 'reports') return `/projects/${projectId}/solar/reports`
```
(`activity-types.ts` imports `SolarActivityTarget` from `@esite/shared`, so Task 10's union change already covers it.) Append to `ActivityList.test.tsx`:
```tsx
  it('links report and proposal events to the Reports tab', () => {
    render(<ActivityList projectId="p1" items={[{ id: 3, at: '2026-09-29T09:00:00Z', actorName: 'The client', text: 'Proposal v2 accepted by the client', target: 'reports' as const }]} isGrantor={false} />)
    expect(screen.getByRole('link', { name: 'Proposal v2 accepted by the client' }).getAttribute('href')).toBe('/projects/p1/solar/reports')
  })
```
Client responses are audited with `actor_id = NULL` (Task 17 Step 1). Open `apps/web/src/lib/solar/activity.ts`, find where each row's `actorName` is resolved from `actor_id`, and make a NULL `actor_id` resolve to `'The client'` (not a lookup, not "Someone"); add the matching case to `activity.test.ts` (a row with `actor_id: null` yields `actorName: 'The client'`).

- [ ] **Step 6: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar' src/lib/solar/cases/page-data 2>&1 | tail -5
git add 'apps/web/src/app/(admin)/projects/[id]/solar/_components' apps/web/src/lib/solar/cases/page-data.ts apps/web/src/lib/solar/cases/page-data.reports.test.ts apps/web/src/lib/solar/activity.ts apps/web/src/lib/solar/activity.test.ts
git commit -m "feat(solar): Overview feasibility shortcut live; Reports readiness and activity links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 31: Org proposal templates card on `/settings/solar`

**Files:**
- Create: `apps/web/src/app/(admin)/settings/solar/ProposalTemplatesForm.tsx`, `ProposalTemplatesForm.test.tsx`
- Modify: `apps/web/src/app/(admin)/settings/solar/page.tsx`

- [ ] **Step 1: Failing test** `ProposalTemplatesForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/actions/solar-proposal-templates.actions', () => ({ saveSolarProposalTemplatesAction: h.save }))
import { ProposalTemplatesForm } from './ProposalTemplatesForm'

beforeEach(() => vi.clearAllMocks())

describe('ProposalTemplatesForm', () => {
  it('saves terms, disclaimer and validity with the stale guard, then keeps the new stamp', async () => {
    h.save.mockResolvedValueOnce({ ok: true, updatedAt: 'T1' }).mockResolvedValueOnce({ ok: true, updatedAt: 'T2' })
    render(<ProposalTemplatesForm initial={{ termsText: 'Old', disclaimerText: '', validityDays: 30 }} updatedAt={null} />)
    fireEvent.change(screen.getByLabelText('Proposal terms and conditions'), { target: { value: 'New terms' } })
    fireEvent.change(screen.getByLabelText('Default validity (days)'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ termsText: 'New terms', disclaimerText: '', validityDays: 45, expectedUpdatedAt: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' })))
  })
  it('shows field errors', async () => {
    h.save.mockResolvedValue({ fieldErrors: { validityDays: 'Between 1 and 365 days' } })
    render(<ProposalTemplatesForm initial={{ termsText: '', disclaimerText: '', validityDays: 30 }} updatedAt="T0" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    expect(await screen.findByText('Between 1 and 365 days')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `ProposalTemplatesForm.tsx`:

```tsx
'use client'
/** Org proposal templates (spec §11 "Branding for Solar reports": terms and disclaimer; default validity). */
import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { saveSolarProposalTemplatesAction } from '@/actions/solar-proposal-templates.actions'

export function ProposalTemplatesForm({ initial, updatedAt }: { initial: { termsText: string; disclaimerText: string; validityDays: number }; updatedAt: string | null }) {
  const [v, setV] = useState(initial)
  const [stamp, setStamp] = useState(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setErrors({}); setMsg(null)
    const r = await saveSolarProposalTemplatesAction({ ...v, expectedUpdatedAt: stamp })
    setBusy(false)
    if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else if ('error' in r) setMsg(r.error)
    else { setStamp(r.updatedAt); setMsg('Templates saved.') }
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Proposal and report templates</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Proposal terms and conditions
            <textarea aria-label="Proposal terms and conditions" rows={6} maxLength={20000} value={v.termsText} onChange={(e) => setV({ ...v, termsText: e.target.value })} />
            {errors.termsText && <span role="alert">{errors.termsText}</span>}
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Disclaimer on Solar reports and proposals
            <textarea aria-label="Disclaimer on Solar reports and proposals" rows={3} maxLength={5000} value={v.disclaimerText} onChange={(e) => setV({ ...v, disclaimerText: e.target.value })} />
            {errors.disclaimerText && <span role="alert">{errors.disclaimerText}</span>}
          </label>
          <label style={{ fontSize: 12 }}>Default validity (days){' '}
            <input aria-label="Default validity (days)" type="number" min={1} max={365} value={v.validityDays} onChange={(e) => setV({ ...v, validityDays: Math.trunc(Number(e.target.value)) })} />
          </label>
          {errors.validityDays && <span role="alert" style={{ fontSize: 12 }}>{errors.validityDays}</span>}
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>The default margin for proposals is the “Margin” field of the rate card above. New proposals copy these; an issued proposal keeps the text it was issued with.</p>
          <div><Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save templates'}</Button></div>
          {msg && <p role="status" style={{ fontSize: 12, margin: 0 }}>{msg}</p>}
        </div>
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 3: Wire the page.** In `apps/web/src/app/(admin)/settings/solar/page.tsx`: remove the `{ title: 'Branding for Solar reports', … }` entry from the `LATER` array; load the templates next to the settings read:
```tsx
  const { data: tpl } = await supabase.schema('solar').from('proposal_templates')
    .select('terms_text, disclaimer_text, validity_days, updated_at').eq('organisation_id', ctx.organisationId).maybeSingle()
  const t = tpl as { terms_text?: string; disclaimer_text?: string; validity_days?: number; updated_at?: string } | null
```
and render, after the settings form (before the LATER cards):
```tsx
      <div style={{ marginTop: 16 }}>
        <ProposalTemplatesForm
          initial={{ termsText: t?.terms_text ?? '', disclaimerText: t?.disclaimer_text ?? '', validityDays: t?.validity_days ?? 30 }}
          updatedAt={t?.updated_at ?? null}
        />
      </div>
```
with `import { ProposalTemplatesForm } from './ProposalTemplatesForm'`. (An owner/admin of a subscribed org reads the row through 00216's SELECT policy; an unsubscribed org simply shows the defaults — saving then fails with the RLS sentence, which is correct: templates are a Solar feature.)

- [ ] **Step 4: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- 'src/app/(admin)/settings/solar' 2>&1 | tail -4
git add 'apps/web/src/app/(admin)/settings/solar'
git commit -m "feat(solar): org proposal terms, disclaimer and validity on Solar settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
