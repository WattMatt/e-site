// apps/web/src/lib/solar/load/readings.test.ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { channelSummaries, readChannelReadings } from './readings'

describe('readChannelReadings', () => {
  it('batches channels (10 per call), converts arrays to readings, and returns [] for silent channels', async () => {
    const seen: string[][] = []
    const { client } = fakeSupabase({
      rpc: {
        'solar.channel_readings': (a) => {
          const ids = a.p_channel_ids as string[]
          seen.push(ids)
          return { data: ids.includes('c1') ? [{ channel: 'c1', ts_ends: ['2025-03-10T00:30:00+00:00'], vals: [1.5], quals: [0] }] : [], error: null }
        },
      },
    })
    const ids = Array.from({ length: 12 }, (_, i) => `c${i + 1}`)
    const progress: Array<[number, number]> = []
    const out = await readChannelReadings(client as never, ids, 0, 1000, (d, t) => progress.push([d, t]))
    expect(seen.map((s) => s.length)).toEqual([10, 2])
    expect(out.get('c1')).toEqual([{ tsEnd: Date.parse('2025-03-10T00:30:00Z'), value: 1.5, quality: 0 }])
    expect(out.get('c12')).toEqual([])
    expect(progress).toEqual([[10, 12], [12, 12]])
  })
  it('throws a plain error when the RPC fails', async () => {
    const { client } = fakeSupabase({ rpc: { 'solar.channel_readings': { data: null, error: { message: 'boom' } } } })
    await expect(readChannelReadings(client as never, ['c1'], 0, 1)).rejects.toThrow('channel readings: boom')
  })
})

describe('channelSummaries', () => {
  it('maps rows and skips the call for no channels', async () => {
    const { client } = fakeSupabase({
      rpc: { 'solar.channel_summaries': { data: [{ channel: 'c1', first_ts: '2025-01-01T00:30:00Z', last_ts: '2025-12-31T22:00:00Z', n_rows: 17520, n_usable: 17500, max_value: 42.5, sum_value: 100000 }], error: null } },
    })
    const m = await channelSummaries(client as never, ['c1'])
    expect(m.get('c1')).toEqual({ channelId: 'c1', firstTs: Date.parse('2025-01-01T00:30:00Z'), lastTs: Date.parse('2025-12-31T22:00:00Z'), nRows: 17520, nUsable: 17500, maxValue: 42.5, sumValue: 100000 })
    expect((await channelSummaries(client as never, [])).size).toBe(0)
  })
})
