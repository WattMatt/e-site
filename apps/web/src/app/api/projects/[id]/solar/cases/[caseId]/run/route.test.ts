import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ gate: vi.fn(), exec: vi.fn(), rl: vi.fn(() => true), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), reval: vi.fn(), createClient: vi.fn(async () => ({ tag: 'user' })), svc: vi.fn(() => ({ tag: 'svc' })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.svc }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/run-case', () => ({ executeCaseRun: h.exec }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rl }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
import { POST, runtime, maxDuration } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222'
const call = (p = P, c = C) => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: p, caseId: c }) })

beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' }) })

describe('POST …/cases/[caseId]/run', () => {
  it('declares nodejs and 60 s', () => { expect(runtime).toBe('nodejs'); expect(maxDuration).toBe(60) })
  it('gates Solar Edit FIRST', async () => {
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Solar access required' }, { status: 403 }) })
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith({ tag: 'user' }, P, 'edit')
    expect(h.exec).not.toHaveBeenCalled()
    expect(h.svc).not.toHaveBeenCalled()
  })
  it('refuses a malformed id before any lookup', async () => {
    expect((await call('nope')).status).toBe(400)
    expect((await call(P, 'nope')).status).toBe(400)
    expect(h.gate).not.toHaveBeenCalled()
  })
  it('429 past the per-user limit', async () => {
    h.rl.mockReturnValueOnce(false)
    const res = await call()
    expect(res.status).toBe(429)
    expect(h.rl).toHaveBeenCalledWith('solar-run:u1', 10, 60_000)
    expect(h.exec).not.toHaveBeenCalled()
  })
  it('success → 200, audit + product event + revalidate', async () => {
    h.exec.mockResolvedValue({ ok: true, runId: 'r1', status: 'succeeded' })
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ runId: 'r1', status: 'succeeded' })
    expect(h.exec).toHaveBeenCalledWith({ user: { tag: 'user' }, svc: { tag: 'svc' }, projectId: P, caseId: C, userId: 'u1' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'case_run', objectRef: { caseId: C, runId: 'r1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_case_run' })
    expect(h.reval).toHaveBeenCalledWith(`/projects/${P}/solar`, 'layout')
  })
  it('failure → its status and sentence; no product event', async () => {
    h.exec.mockResolvedValue({ ok: false, status: 422, error: 'Build the site load on the Load tab first.' })
    const res = await call()
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Build the site load on the Load tab first.' })
    expect(h.emit).not.toHaveBeenCalled()
  })
  it('a failure that created a run returns its id', async () => {
    h.exec.mockResolvedValue({ ok: false, status: 409, error: 'The run was cancelled.', runId: 'r1' })
    const res = await call()
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'The run was cancelled.', runId: 'r1' })
  })
})
