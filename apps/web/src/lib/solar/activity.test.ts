import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ service: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createServiceClient: () => h.service }))

import { loadSolarActivity } from './activity'
import { fakeSupabase } from '@/test/fake-supabase'

describe('loadSolarActivity', () => {
  it('returns the project’s events with actor names and sentences', async () => {
    const { client } = fakeSupabase({
      tables: {
        'solar.audit_events': [
          { id: 2, project_id: 'p1', verb: 'site_saved', object_ref: {}, actor_id: 'u1', created_at: '2026-09-28T09:00:00Z' },
          { id: 1, project_id: 'p1', verb: 'access_granted', object_ref: { level: 'view' }, actor_id: 'u2', created_at: '2026-09-28T08:00:00Z' },
          { id: 9, project_id: 'p-other', verb: 'site_saved', object_ref: {}, actor_id: 'u1', created_at: '2026-09-28T07:00:00Z' },
        ],
      },
    })
    h.service = fakeSupabase({ tables: { 'public.profiles': [{ id: 'u1', full_name: 'Ann' }, { id: 'u2', full_name: null }] } }).client
    await expect(loadSolarActivity('p1', client as never)).resolves.toEqual([
      { id: 2, at: '2026-09-28T09:00:00Z', actorName: 'Ann', text: 'Site & Supply saved', target: 'site' },
      { id: 1, at: '2026-09-28T08:00:00Z', actorName: 'Someone', text: 'Solar access granted (View)', target: 'access' },
    ])
  })

  it('returns an empty list when nothing happened yet', async () => {
    const { client } = fakeSupabase()
    await expect(loadSolarActivity('p1', client as never)).resolves.toEqual([])
  })
  it('a token response (no actor) reads "The client"; any other actorless event stays "Someone"', async () => {
    const { client } = fakeSupabase({
      tables: {
        'solar.audit_events': [
          { id: 5, project_id: 'p1', verb: 'proposal_accepted', object_ref: { version: 2, via: 'token' }, actor_id: null, created_at: '2026-09-29T09:00:00Z' },
          { id: 4, project_id: 'p1', verb: 'site_saved', object_ref: {}, actor_id: null, created_at: '2026-09-29T08:00:00Z' },
        ],
      },
    })
    h.service = fakeSupabase().client
    const items = await loadSolarActivity('p1', client as never)
    expect(items.map((i) => [i.id, i.actorName, i.target])).toEqual([[5, 'The client', 'reports'], [4, 'Someone', 'site']])
  })
})
