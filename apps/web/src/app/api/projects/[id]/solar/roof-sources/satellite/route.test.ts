import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), getSolarAccessLevel: vi.fn(), rateLimit: vi.fn(() => true),
  audit: vi.fn(async () => {}), upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.getSolarAccessLevel }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import { POST } from './route'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const ORG = '99999999-9999-4999-8999-999999999999'
const ctx = { params: Promise.resolve({ id: P }) }
const req = (body: unknown = {}) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    userId: 'u1',
    tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05 }] },
    writes: { 'solar.roof_sources:insert': { data: [{ id: 'rs-new' }] } },
    ...o,
  })
  h.createClient.mockResolvedValue(fake.client)
  h.createServiceClient.mockReturnValue({ storage: { from: () => ({ upload: h.upload, remove: h.remove }) } })
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MAPBOX_ACCESS_TOKEN = 'pk.test'
  h.getSolarAccessLevel.mockResolvedValue('edit')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })))
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.MAPBOX_ACCESS_TOKEN })

describe('POST satellite capture', () => {
  it('503 before touching the session when the token is not configured', async () => {
    delete process.env.MAPBOX_ACCESS_TOKEN
    const res = await POST(req(), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Satellite capture is not configured' })
    expect(h.createClient).not.toHaveBeenCalled()
  })
  it('403 below Edit', async () => {
    setup()
    h.getSolarAccessLevel.mockResolvedValue('view')
    expect((await POST(req(), ctx)).status).toBe(403)
  })
  it('409 without a site location', async () => {
    setup({ tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: ORG, latitude: null, longitude: null }] } })
    expect((await POST(req(), ctx)).status).toBe(409)
  })
  it('429 when rate limited', async () => {
    setup()
    h.rateLimit.mockReturnValueOnce(false)
    expect((await POST(req(), ctx)).status).toBe(429)
  })
  it('502 when Mapbox does not answer with an image', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect((await POST(req(), ctx)).status).toBe(502)
  })
  it('201: stores the image under org/project, records m/px from the tile maths and the attribution', async () => {
    const { calls } = setup()
    const res = await POST(req({ zoom: 19 }), ctx)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ roofSourceId: 'rs-new' })
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])
    expect(url).toContain('/static/28.05,-26.2,19,0,0/1280x1280@2x?access_token=pk.test')
    const path = (h.upload.mock.calls[0] as unknown[])[0] as string
    expect(path).toMatch(new RegExp(`^${ORG}/${P}/satellite-\\d+\\.png$`))
    const ins = callsTo(calls, 'solar.roof_sources', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ study_id: 's1', kind: 'satellite', storage_path: path, attribution: '© Mapbox © OpenStreetMap © Maxar' })
    expect(ins.m_per_px as number).toBeCloseTo(0.0669763, 6)
  })
  it('removes the stored image when the row is refused', async () => {
    setup({ writes: { 'solar.roof_sources:insert': { error: { code: '42501', message: 'new row violates row-level security policy' } } } })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(403)
    expect(h.remove).toHaveBeenCalledTimes(1)
  })
})

describe('POST satellite capture — review fix', () => {
  it('bounds the Mapbox request with a timeout', async () => {
    setup()
    await POST(req(), ctx)
    const init = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
