// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ portal: vi.fn(), load: vi.fn(), render: vi.fn(), service: vi.fn(), upload: vi.fn(), sign: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ tag: 'session' }), createServiceClient: m.service }))
vi.mock('@/lib/portal/data', () => ({ requirePortalAccess: m.portal }))
vi.mock('@/lib/status-plans/plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))
vi.mock('@/lib/status-plans/render-plan-page', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/render-plan-page')>('@/lib/status-plans/render-plan-page')
  return { ...actual, renderStatusPlanPdf: m.render }
})

import { GET } from './route'
import { StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'

const PLAN = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const call = () => GET(new NextRequest(`http://localhost/api/portal/p1/status-plans/${PLAN}/pdf`), { params: Promise.resolve({ projectId: 'p1', planId: PLAN }) })
const input = { planName: 'Ground floor', pageIndex: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  m.portal.mockResolvedValue({ userId: 'u', organisationId: 'o', projectId: 'p1' })
  m.upload.mockResolvedValue({ error: null })
  m.sign.mockResolvedValue({ data: { signedUrl: 'https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t' }, error: null })
  m.service.mockReturnValue({ storage: { from: () => ({ upload: m.upload, createSignedUrl: m.sign }) } })
  m.load.mockResolvedValue({ inputs: [input], omitted: [], organisationId: 'org-1' })
  m.render.mockResolvedValue(new Uint8Array([0x25]))
})

describe('GET portal status plan PDF', () => {
  it('a planId that is not a uuid → 404, nothing is queried (not a 500)', async () => {
    const res = await GET(new NextRequest('http://localhost/api/portal/p1/status-plans/s1/pdf'), { params: Promise.resolve({ projectId: 'p1', planId: 's1' }) })
    expect(res.status).toBe(404)
    expect(m.load).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('only a client viewer with an active membership on THIS project gets it', async () => {
    m.portal.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.portal).toHaveBeenCalledWith('p1')
    expect(m.load).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('reads plan rows as the viewer, renders this plan only (A3), and hands it over inline through storage', async () => {
    const res = await call()
    const [clients, args] = m.load.mock.calls[0]!
    expect(clients.db).toEqual({ tag: 'session' })
    expect(args).toMatchObject({ projectId: 'p1', planIds: [PLAN], maxPlans: 1 })
    expect(m.render).toHaveBeenCalledWith(input, 'a3')
    expect(m.upload).toHaveBeenCalledWith(`org-1/p1/status-plans/${PLAN}/portal.pdf`, expect.any(ArrayBuffer), expect.objectContaining({ contentType: 'application/pdf', upsert: true }))
    // No download name: the signed URL opens inline in the tab the portal link opened.
    expect(m.sign).toHaveBeenCalledWith(`org-1/p1/status-plans/${PLAN}/portal.pdf`, 600, undefined)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('https://ref.supabase.co/storage/v1/object/sign/reports/x?token=t')
  })
  it('unknown plan → 404', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [] })
    expect((await call()).status).toBe(404)
  })
  it('a drawing that cannot be used → 422 sentence, not a 500', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [{ title: 't', reason: 'the drawing is no longer available' }] })
    const res = await call()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('This plan cannot be shown: the drawing is no longer available.')
    m.load.mockResolvedValue({ inputs: [input], omitted: [], organisationId: 'org-1' })
    m.render.mockRejectedValue(new StatusPlanSourceError('the drawing PDF could not be read'))
    const res2 = await call()
    expect(res2.status).toBe(422)
    expect((await res2.json()).error).toBe('This plan cannot be shown: the drawing PDF could not be read.')
  })
  it('a load failure → 500 sentence', async () => {
    m.load.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('This plan could not be loaded — try again.')
  })
})
