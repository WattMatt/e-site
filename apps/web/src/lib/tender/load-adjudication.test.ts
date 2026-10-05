import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { gateMock } = vi.hoisted(() => ({ gateMock: vi.fn() }))
vi.mock('@/lib/tender/gate', () => ({ gateTender: gateMock }))

import { loadAdjudication } from './load-adjudication'

const T = 't1'
const tender = (status: string, closing_at = '2000-01-01T00:00:00Z') => ({ id: T, project_id: 'p', package: 'E', title: 'M', status, closing_at })

/** n priced items; bidder A (submitted) and C (submitted) rate every one; B is a draft. */
function world(n: number, opts: { lifted?: boolean; mayOpen?: boolean; dropLinesOf?: string } = {}) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: `i${String(i).padStart(5, '0')}`, tender_id: T, kind: 'item', sheet_name: 'B1', row_number: i + 5, bill_code: '1',
    code: `1.${i}`, description: `Item ${i}`, unit: 'm', quantity: 1, rate_cell_type: 'priced', fixed_amount: null,
  }))
  const subs = [
    { id: 'sA', tender_id: T, participant_id: 'pA', status: 'submitted', submitted_at: '2026-10-01T00:00:00Z', declarations: [] },
    { id: 'sB', tender_id: T, participant_id: 'pB', status: 'draft', submitted_at: null, declarations: [] },
    { id: 'sC', tender_id: T, participant_id: 'pC', status: 'submitted', submitted_at: '2026-10-01T00:00:00Z', declarations: [] },
  ]
  // The draft carries lines too: RLS would hide them, and the loader must not ask for them anyway.
  const lines = subs.flatMap((s) =>
    s.id === opts.dropLinesOf ? [] : items.map((it) => ({ submission_id: s.id, tender_id: T, item_id: it.id, rate: s.id === 'sA' ? 2 : s.id === 'sC' ? 3 : 1, not_priced: false })))
  return fakeSupabase({
    maxRows: 1000,
    rpc: {
      'projects.tender_seal_lifted': { data: opts.lifted ?? true, error: null },
      'projects.user_can_open_tender': { data: opts.mayOpen ?? true, error: null },
    },
    tables: {
      'projects.tender_boq_items': items,
      'projects.tender_estimate_lines': [],
      'projects.tender_participants': [
        { id: 'pA', tender_id: T, company_name: 'Alpha', cidb_grade: '7EP', bbbee_level: '1', registration_number: null, vat_number: null },
        { id: 'pB', tender_id: T, company_name: 'Bravo', cidb_grade: null, bbbee_level: null, registration_number: null, vat_number: null },
        { id: 'pC', tender_id: T, company_name: 'Charlie', cidb_grade: '6EP', bbbee_level: '2', registration_number: null, vat_number: null },
      ],
      'projects.tender_submissions': subs,
      'projects.tender_requirements': [],
      'projects.tender_submission_lines': lines,
      'projects.tender_submission_documents': [],
      'projects.projects': [{ id: 'p', name: 'Sunbird' }],
    },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('loadAdjudication', () => {
  it('refuses, and reads no bid, while the seal is on', async () => {
    const { client, calls } = world(3, { lifted: false })
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('issued', '2099-01-01T00:00:00Z') })
    expect(await loadAdjudication(T)).toEqual({ ok: false, error: 'Bids are sealed until the closing time.' })
    expect(calls).toEqual([])
  })

  it('refuses a caller the gate refuses, and one the database will not let open bids', async () => {
    gateMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await loadAdjudication(T)).toEqual({ ok: false, error: 'Your role (contractor) is not allowed' })
    const { client, calls } = world(3, { mayOpen: false })
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('closed') })
    expect(await loadAdjudication(T)).toEqual({ ok: false, error: 'Your role may not open the bids on this tender.' })
    expect(calls).toEqual([])
  })

  it('waits for the tender to be closed, and never opens a cancelled one', async () => {
    const { client, calls } = world(3)
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('issued') })
    expect(await loadAdjudication(T)).toMatchObject({ ok: false, error: expect.stringMatching(/Close the tender/) })
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('cancelled') })
    expect(await loadAdjudication(T)).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) })
    expect(calls).toEqual([])
  })

  it('reads past PostgREST max_rows: every item and every line of a 2 500-item tender', async () => {
    const { client } = world(2500)
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('closed') })
    const r = await loadAdjudication(T)
    if (!r.ok) throw new Error(r.error)
    expect(r.data.adjudication.rows).toHaveLength(2500)
    expect(r.data.adjudication.totals.map((t) => [t.company, t.total])).toEqual([['Alpha', 5000], ['Charlie', 7500]])
  })

  it('adjudicates submitted bids only, and lists a draft by name', async () => {
    const { client, calls } = world(3)
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('closed') })
    const r = await loadAdjudication(T)
    if (!r.ok) throw new Error(r.error)
    expect(r.data.adjudication.totals.map((t) => t.company)).toEqual(['Alpha', 'Charlie'])
    expect(r.data.draftsAtClosing).toEqual(['Bravo'])
    const lineReads = calls.filter((c) => c.table === 'projects.tender_submission_lines')
    expect(lineReads.length).toBeGreaterThan(0)
    expect(lineReads.every((c) => c.filters.some(([op, col, v]) => op === 'in' && col === 'submission_id' && !(v as string[]).includes('sB')))).toBe(true)
    expect(r.data.profiles.pA).toMatchObject({ cidb_grade: '7EP' })
  })

  it('refuses rather than ranks a submitted bid whose rates did not all arrive', async () => {
    const { client } = world(3, { dropLinesOf: 'sC' })
    gateMock.mockResolvedValue({ ok: true, supabase: client, tender: tender('closed') })
    expect(await loadAdjudication(T)).toMatchObject({ ok: false, error: expect.stringMatching(/Charlie \(3\)/) })
  })
})
