import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateMock } = vi.hoisted(() => ({ gateMock: vi.fn() }))
vi.mock('@/lib/tender/gate', () => ({ gateTender: gateMock }))

import { loadAdjudication } from './load-adjudication'

function client(lifted: boolean) {
  const reads: string[] = []
  const q = (t: string) => {
    reads.push(t)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'range', 'in']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve({ data: { name: 'P' }, error: null })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
    return b
  }
  return { reads, c: { schema: () => ({ rpc: async () => ({ data: lifted }), from: q }) } }
}

beforeEach(() => vi.clearAllMocks())

describe('loadAdjudication', () => {
  it('refuses, and reads no bid, while the seal is on', async () => {
    const { reads, c } = client(false)
    gateMock.mockResolvedValue({ ok: true, supabase: c, tender: { id: 't', project_id: 'p', package: 'E', title: 'M', status: 'issued', closing_at: '2099-01-01T00:00:00Z' } })
    expect(await loadAdjudication('t')).toEqual({ ok: false, error: 'Bids are sealed until the closing time.' })
    expect(reads).toEqual([])
  })

  it('refuses a caller the gate refuses', async () => {
    gateMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await loadAdjudication('t')).toEqual({ ok: false, error: 'Your role (contractor) is not allowed' })
  })

  it('loads once the seal has lifted', async () => {
    const { reads, c } = client(true)
    gateMock.mockResolvedValue({ ok: true, supabase: c, tender: { id: 't', project_id: 'p', package: 'E', title: 'M', status: 'issued', closing_at: '2000-01-01T00:00:00Z' } })
    const r = await loadAdjudication('t')
    expect(r.ok).toBe(true)
    expect(reads).toEqual(expect.arrayContaining(['tender_boq_items', 'tender_submissions', 'tender_participants']))
  })
})
