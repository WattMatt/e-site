import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './fake-supabase'

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
