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
