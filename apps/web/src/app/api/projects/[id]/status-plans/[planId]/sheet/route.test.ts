// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), load: vi.fn(), render: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: m.getUser } }),
  createServiceClient: m.service,
}))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: m.access }))
vi.mock('@/lib/status-plans/plan-render-data', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/plan-render-data')>('@/lib/status-plans/plan-render-data')
  return { ...actual, loadStatusPlanRenderInputs: m.load }
})
vi.mock('@/lib/status-plans/render-plan-page', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/render-plan-page')>('@/lib/status-plans/render-plan-page')
  return { ...actual, renderStatusPlanPdf: m.render }
})

import { GET } from './route'
import { StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'

const PID = 'proj-1'
const PLAN = 'plan-1'
const call = () => GET(new NextRequest(`http://localhost/api/projects/${PID}/status-plans/${PLAN}/sheet`), { params: Promise.resolve({ id: PID, planId: PLAN }) })
const input = { planId: PLAN, planName: 'Main board 3.1 / Level 2', pageIndex: 1, generatedOn: '2026-10-09' }

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.access.mockResolvedValue({ ok: true })
  m.service.mockReturnValue({ storage: { tag: 'storage' } })
  m.load.mockResolvedValue({ inputs: [input], omitted: [] })
  m.render.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
})

describe('GET status plan Export sheet', () => {
  it('signed out → 401', async () => {
    m.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
    expect(m.access).not.toHaveBeenCalled()
  })
  it('no project access → 404 and nothing is read', async () => {
    m.access.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    expect((await call()).status).toBe(404)
    expect(m.load).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('renders this plan only, at source size, as an attachment', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const [clients, args] = m.load.mock.calls[0]!
    expect(clients.storage).toEqual({ tag: 'storage' })
    expect(args).toMatchObject({ projectId: PID, planIds: [PLAN], purposes: ['tenant_layout', 'distribution_schematic'], maxPlans: 1 })
    expect(m.render).toHaveBeenCalledWith(input, 'source')
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="main-board-3-1-level-2-p1-\d{4}-\d{2}-\d{2}\.pdf"$/)
  })
  it('unknown plan → 404', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [] })
    expect((await call()).status).toBe(404)
  })
  it('a load failure → 500 with a sentence, not a stack', async () => {
    m.load.mockRejectedValue(new Error('status plans could not be read: boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('The plan could not be loaded — try again.')
  })
  it('a drawing that cannot be used → 422 with the sentence', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [{ title: 'x', reason: 'the drawing file could not be read (Object not found)' }] })
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'This sheet could not be exported: the drawing file could not be read (Object not found).' })
    m.load.mockResolvedValue({ inputs: [input], omitted: [] })
    m.render.mockRejectedValue(new StatusPlanSourceError('the drawing PDF is password-protected'))
    const res2 = await call()
    expect(res2.status).toBe(422)
    expect((await res2.json()).error).toBe('This sheet could not be exported: the drawing PDF is password-protected.')
  })
})
