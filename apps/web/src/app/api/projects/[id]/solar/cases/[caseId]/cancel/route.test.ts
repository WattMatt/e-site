import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: { current: null as unknown }, audit: vi.fn(async () => {}), svcCalled: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})), createServiceClient: () => { h.svcCalled(); return h.svc.current } }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
import { POST, runtime } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', R = '33333333-3333-4333-8333-333333333333'
const call = (c = C) => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: P, caseId: c }) })
beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' }) })

// Case-level: the browser that pressed Run does not know the run id until the POST returns.
describe('POST …/cases/[caseId]/cancel', () => {
  it('declares nodejs', () => { expect(runtime).toBe('nodejs') })
  it('gates Solar Edit FIRST; the service client is never touched when refused', async () => {
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith({}, P, 'edit')
    expect(h.svcCalled).not.toHaveBeenCalled()
    expect((await call('nope')).status).toBe(400)
  })
  it('flips only the running run of this case and project', async () => {
    const f = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [{ id: R }] } } }); h.svc.current = f.client
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'cancelled', runId: R })
    const u = callsTo(f.calls, 'solar.case_runs', 'update')[0]!
    expect(u.payload).toEqual({ status: 'cancelled' })
    expect(u.filters).toEqual([['eq', 'case_id', C], ['eq', 'project_id', P], ['eq', 'status', 'running']])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'case_run_cancelled', objectRef: { caseId: C, runId: R } })
  })
  it('a finished run → 409 sentence', async () => {
    h.svc.current = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [] } } }).client
    const res = await call()
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'This run has already finished.' })
  })
  it('a DB error → 500 sentence', async () => {
    h.svc.current = fakeSupabase({ writes: { 'solar.case_runs:update': { error: { code: '42501', message: 'x' } } } }).client
    const res = await call()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'The run could not be cancelled — try again.' })
  })
})
