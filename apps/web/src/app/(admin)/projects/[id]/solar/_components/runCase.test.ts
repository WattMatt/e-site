import { describe, it, expect, vi, afterEach } from 'vitest'
import { postRun, postCancel } from './runCase'

afterEach(() => vi.restoreAllMocks())
describe('runCase fetch helpers (server sentence verbatim)', () => {
  it('postRun: ok → runId; refusal → the route’s sentence; network error → a sentence', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'r1', status: 'succeeded' }), { status: 200 }))
    expect(await postRun('p1', 'c1')).toEqual({ ok: true, runId: 'r1' })
    expect(f).toHaveBeenCalledWith('/api/projects/p1/solar/cases/c1/run', { method: 'POST' })
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'A run is already in progress for this case.' }), { status: 409 }))
    expect(await postRun('p1', 'c1')).toEqual({ ok: false, error: 'A run is already in progress for this case.' })
    f.mockResolvedValueOnce(new Response('not json', { status: 502 }))
    expect(await postRun('p1', 'c1')).toEqual({ ok: false, error: 'The run failed — try again.' })
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await postRun('p1', 'c1')).ok).toBe(false)
  })
  it('postCancel', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cancelled', runId: 'r1' }), { status: 200 }))
    expect(await postCancel('p1', 'c1')).toEqual({ ok: true })
    expect(f).toHaveBeenCalledWith('/api/projects/p1/solar/cases/c1/cancel', { method: 'POST' })
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'This run has already finished.' }), { status: 409 }))
    expect(await postCancel('p1', 'c1')).toEqual({ ok: false, error: 'This run has already finished.' })
  })
})
