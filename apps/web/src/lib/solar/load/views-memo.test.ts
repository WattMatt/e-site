// The per-request dedupe of the readiness aggregate. React's `cache` only memoises inside a server
// render, so it is stood in for here by a memoising one (one "request" = this file).
import { describe, it, expect, vi } from 'vitest'

vi.mock('react', async (orig) => ({
  ...(await orig<object>()),
  cache: <T,>(fn: () => T) => { let v: T | undefined; let set = false; return () => { if (!set) { v = fn(); set = true } return v as T } },
}))
vi.mock('./gather', async (orig) => ({ ...(await orig<object>()), gatherLoadInputs: vi.fn() }))
vi.mock('./readings', () => ({ channelSummaries: vi.fn(), readChannelReadings: vi.fn() }))

import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { loadLoadReadiness } from './views'

describe('loadLoadReadiness per-request dedupe', () => {
  it('the layout and the overview share one readiness read within a request, even with different client objects', async () => {
    const tables = { 'solar.studies': [{ id: 's1', project_id: 'p1', load_basis: 'S2', updated_at: '2025-01-01T00:00:00Z', schematic_waived: false }] }
    const a = fakeSupabase({ tables })
    const b = fakeSupabase({ tables })
    const [ra, rb] = await Promise.all([loadLoadReadiness(a.client as never, 'p1'), loadLoadReadiness(b.client as never, 'p1')])
    expect(rb).toBe(ra)
    expect(callsTo(a.calls, 'solar.studies', 'select').length + callsTo(b.calls, 'solar.studies', 'select').length).toBe(1)
  })
})
