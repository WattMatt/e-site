import { describe, it, expect } from 'vitest'
import { fakeSupabase, callsTo } from './fake-supabase'

describe('fakeSupabase extensions', () => {
  it('filters with is(col, null) and passes or/ilike/overlaps/not/range through', async () => {
    const { client } = fakeSupabase({ tables: { 'structure.nodes': [{ id: 'a', deleted_at: null }, { id: 'b', deleted_at: '2025-01-01' }, { id: 'c' }] } })
    const r = await client.schema('structure').from('nodes').select('id').is('deleted_at', null).or('x').ilike('a', 'b').overlaps('s', []).not('x', 'is', null).range(0, 9)
    expect((r.data as Array<{ id: string }>).map((x) => x.id)).toEqual(['a', 'c'])
  })
  it('records upsert like insert and echoes the payload', async () => {
    const { client, calls } = fakeSupabase({})
    const r = await client.schema('solar').from('site_load').upsert({ a: 1 }, { onConflict: 'x' }).select('id').single()
    expect(r.data).toEqual({ a: 1 })
    expect(callsTo(calls, 'solar.site_load', 'upsert')).toHaveLength(1)
  })
  it('routes schema(s).rpc(name) to rpc["s.name"]', async () => {
    const { client } = fakeSupabase({ rpc: { 'solar.channel_summaries': { data: [{ channel: 'c1' }], error: null } } })
    const r = await client.schema('solar').rpc('channel_summaries', { p_channel_ids: ['c1'] })
    expect(r.data).toEqual([{ channel: 'c1' }])
  })
})
