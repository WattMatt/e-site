import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ gather: vi.fn(), build: vi.fn(), audit: vi.fn(async () => {}) }))
vi.mock('./gather', () => ({ gatherLoadInputs: h.gather }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@esite/shared/solar-load', async (orig) => {
  const real = await orig<typeof import('@esite/shared/solar-load')>()
  return { ...real, buildSiteLoad: h.build }
})

import { LoadModelError } from '@esite/shared/solar-load'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { rebuildSiteLoad } from './site-load-service'
import type { RebuildEvent } from './view-types'

const result = {
  basis: 'S2', referenceYear: 2025, series: new Float64Array(HOURS_PER_YEAR).fill(1.23456), mdMonthly: [], designMdKw: null,
  coverage: { metered: 1 }, reconciliation: { bulk: [], parents: [] }, tenants: [], checks: [{ key: 'x' }],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.gather.mockResolvedValue({ ok: true, study: { id: 's1' }, input: {}, inputsHash: 'a'.repeat(64), inputCounts: { studyMeters: 3, schematicLines: 2, basisRows: 4 } })
  h.build.mockReturnValue(result)
})

describe('rebuildSiteLoad', () => {
  it('builds, upserts one row per study (3 dp), removes older rows, audits, and reports done', async () => {
    const { client, calls } = fakeSupabase({ writes: { 'solar.site_load:upsert': { data: [{ id: 'sl1' }] } } })
    const events: RebuildEvent[] = []
    const r = await rebuildSiteLoad(client as never, 'p1', 'u1', (e) => events.push(e))
    expect(r).toEqual({ ok: true, siteLoadId: 'sl1' })
    const up = callsTo(calls, 'solar.site_load', 'upsert')[0].payload as Record<string, unknown>
    expect(up).toMatchObject({ study_id: 's1', basis: 'S2', reference_year: 2025, inputs_hash: 'a'.repeat(64), built_by: 'u1' })
    expect((up.series as number[])[0]).toBe(1.235)
    expect((up.coverage as Record<string, unknown>).checks).toEqual([{ key: 'x' }])
    expect((up.coverage as Record<string, unknown>).inputCounts).toEqual({ studyMeters: 3, schematicLines: 2, basisRows: 4 })
    expect(callsTo(calls, 'solar.site_load', 'delete')[0].filters).toEqual([['eq', 'study_id', 's1'], ['neq', 'id', 'sl1']])
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'site_load_built' }))
    expect(events.at(-1)).toEqual({ type: 'done', siteLoadId: 'sl1', basis: 'S2', referenceYear: 2025, checks: 1 })
  })
  it('stamps built_at with the time BEFORE the inputs were read, so an edit during a long build is not missed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'))
      h.gather.mockImplementation(async () => {
        vi.setSystemTime(new Date('2026-09-29T10:05:00.000Z')) // a slow read
        return { ok: true, study: { id: 's1' }, input: {}, inputsHash: 'a'.repeat(64), inputCounts: { studyMeters: 0, schematicLines: 0, basisRows: 0 } }
      })
      const { client, calls } = fakeSupabase({ writes: { 'solar.site_load:upsert': { data: [{ id: 'sl1' }] } } })
      await rebuildSiteLoad(client as never, 'p1', 'u1', () => {})
      const up = callsTo(calls, 'solar.site_load', 'upsert')[0].payload as Record<string, unknown>
      expect(up.built_at).toBe('2026-09-29T10:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
  it('turns a LoadModelError into its sentence and writes nothing', async () => {
    h.build.mockImplementation(() => { throw new LoadModelError('no_confirmed_bulk', 'Confirm a bulk meter first.') })
    const { client, calls } = fakeSupabase({})
    const events: RebuildEvent[] = []
    expect(await rebuildSiteLoad(client as never, 'p1', 'u1', (e) => events.push(e))).toEqual({ ok: false })
    expect(events.at(-1)).toEqual({ type: 'error', code: 'no_confirmed_bulk', message: 'Confirm a bulk meter first.' })
    expect(calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
  it('reports a missing study', async () => {
    h.gather.mockResolvedValue({ ok: false, error: 'no_study' })
    const events: RebuildEvent[] = []
    await rebuildSiteLoad(fakeSupabase({}).client as never, 'p1', 'u1', (e) => events.push(e))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'no_study' })
  })
})
