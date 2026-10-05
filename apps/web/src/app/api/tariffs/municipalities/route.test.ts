import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ user: null as null | { id: string } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }))

import { GET } from './route'

beforeEach(() => { h.user = null })
afterEach(() => { delete process.env.TARIFF_MAP_ENABLED })

describe('GET /api/tariffs/municipalities', () => {
  it('is 404 while the map flag is off, even when signed in', async () => {
    h.user = { id: 'u' }
    expect((await GET()).status).toBe(404)
  })
  it('is 401 when signed out with the flag on', async () => {
    process.env.TARIFF_MAP_ENABLED = '1'
    expect((await GET()).status).toBe(401)
  })
  it('returns the 213 MDB municipalities, each with a unique code, when on and signed in', async () => {
    process.env.TARIFF_MAP_ENABLED = '1'
    h.user = { id: 'u' }
    const r = await GET()
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('private')
    const g = await r.json() as { features: Array<{ properties: { code: string } }> }
    expect(g.features).toHaveLength(213)
    expect(new Set(g.features.map((f) => f.properties.code)).size).toBe(213)
  })
})
