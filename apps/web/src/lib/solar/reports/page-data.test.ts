// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({
  sel: vi.fn(), money: vi.fn(), email: vi.fn(async () => true),
  narrative: vi.fn(() => ({ narrativeAvailable: false, narrativeReason: 'no key' as string | null })),
}))
vi.mock('./selected-case', () => ({ loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/page-data', () => ({ latestMoney: h.money }))
vi.mock('@/lib/solar/proposals/email-toggle', () => ({ solarEmailEnabled: h.email }))
vi.mock('@/lib/solar/proposals/narrative', () => ({ narrativeStatus: h.narrative }))
import { loadReportsPageData } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

const draft = { clientName: 'Acme', marginPct: 15, validityDays: 30, financeOptions: ['cash'], summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '' }
const proposals = [
  { id: 'a1', project_id: 'p1', family_id: 'a1', version: 1, status: 'issued', expires_at: '2099-01-01T00:00:00Z', issued_at: '2026-09-01T00:00:00Z', updated_at: 'T', draft, snapshot: { price: { offerExclVatZar: 1_150_000 } }, created_at: '2026-09-01' },
  { id: 'a2', project_id: 'p1', family_id: 'a1', version: 2, status: 'draft', expires_at: null, issued_at: null, updated_at: 'T2', draft, snapshot: null, created_at: '2026-09-02' },
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
    expect(d.proposals[1]!.offerExclVat).toBe('R 1 150 000.00') // zarCents, as the PDF and portal print it (review round 2, M1)
    expect(d.proposals[1]!.events[0]).toEqual({ kind: 'accepted', via: 'token', at: '2026-09-03T00:00:00Z', actorName: 'C', actorEmail: 'c@x.co', ip: '1.2.3.4', userAgent: 'ua', pdfSha256: 'a'.repeat(64), authority: true, reason: null, hasSignature: true })
    expect(d.clientContacts).toEqual([{ userId: 'cv1', name: 'Client Viewer', email: 'cv@acme.example' }])
    expect(d.narrative).toEqual({ available: false, reason: 'no key' })
    expect(d.emailEnabled).toBe(true)
    expect(JSON.parse(JSON.stringify(d))).toEqual(d) // JSON-only props
  })
  it('below money: no proposals, no clients, feasibility hidden, no money reads', async () => {
    const user = fakeSupabase({ tables: { 'solar.proposals': proposals } })
    const d = await loadReportsPageData(user.client as never, fakeSupabase().client as never, 'p1', 'edit')
    expect(d.proposals).toEqual([])
    expect(d.clientContacts).toEqual([])
    expect(d.feasibility).toEqual({ ok: false, reason: null })
    expect(d.emailEnabled).toBe(false)
    expect(h.money).not.toHaveBeenCalled()
    expect(user.calls.some((c) => c.table === 'solar.proposals')).toBe(false)
  })
  it('feasibility refused with the reason when the latest financials are on another run', async () => {
    h.money.mockResolvedValue(new Map([['c1', { case_run_id: 'r-old' }]]))
    const d = await loadReportsPageData(fakeSupabase().client as never, fakeSupabase().client as never, 'p1', 'edit_financials')
    expect(d.feasibility).toEqual({ ok: false, reason: 'Run financials for the selected case first (Financials tab).' })
  })
  it('layout sheet available only when an issued sheet exists for the case layout', async () => {
    h.sel.mockResolvedValue({ ok: true, caseRow: { id: 'c1', name: 'Base', pv_source: 'layout', layout_id: 'L1' }, run: { id: 'r1' } })
    const withSheet = fakeSupabase({ tables: { 'projects.reports': [{ id: 's1', project_id: 'p1', kind: 'solar_layout_sheet', source_id: 'L1', status: 'issued' }] } }).client
    expect((await loadReportsPageData(withSheet as never, fakeSupabase().client as never, 'p1', 'view')).layoutSheet).toEqual({ available: true, reason: null })
    expect((await loadReportsPageData(fakeSupabase().client as never, fakeSupabase().client as never, 'p1', 'view')).layoutSheet)
      .toEqual({ available: false, reason: 'Export a layout sheet on the Layout tab first.' })
  })
  it('carries the selected-case refusal (e.g. Stale)', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    const d = await loadReportsPageData(fakeSupabase().client as never, fakeSupabase().client as never, 'p1', 'view')
    expect(d.selected).toEqual({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
  })
})
