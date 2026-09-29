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

describe('fakeSupabase schema rpc', () => {
  it('resolves schema-qualified rpc results and records the call', async () => {
    const { client, rpcCalls } = fakeSupabase({
      rpc: { 'solar.schedule_delete_tasks': ({ p_task_ids }) => ({ data: (p_task_ids as string[]).length, error: null }) },
    })
    const res = await client.schema('solar').rpc('schedule_delete_tasks', { p_project_id: 'p', p_task_ids: ['a', 'b'] })
    expect(res).toEqual({ data: 2, error: null })
    expect(rpcCalls).toEqual([{ name: 'solar.schedule_delete_tasks', args: { p_project_id: 'p', p_task_ids: ['a', 'b'] } }])
  })
  it('an unconfigured schema rpc returns null data', async () => {
    const { client } = fakeSupabase()
    await expect(client.schema('solar').rpc('nope', {})).resolves.toEqual({ data: null, error: null })
  })
})
