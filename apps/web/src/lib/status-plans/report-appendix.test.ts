// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: m.access }))
vi.mock('./plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: m.service }))

import { loadReportAppendix } from './report-appendix'

const session = { tag: 'session' } as never
const base = { sessionClient: session, projectId: 'p1', today: '2026-10-09' }

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({ ok: true })
  m.service.mockReturnValue({ storage: { tag: 'storage' } })
  m.load.mockResolvedValue({ inputs: [], omitted: [] })
})

describe('loadReportAppendix', () => {
  it('no params → no appendix, no gate call, no load', async () => {
    expect(await loadReportAppendix({ ...base, url: 'http://x/r' })).toEqual({ ok: true, appendix: null })
    expect(m.access).not.toHaveBeenCalled()
    expect(m.load).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('gates on project access before reading anything', async () => {
    m.access.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    expect(await loadReportAppendix({ ...base, url: 'http://x/r?tenantPlans=1' })).toEqual({ ok: false, status: 404, error: 'Project not found' })
    expect(m.access).toHaveBeenCalledWith(session, 'p1')
    expect(m.load).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
  it('loads the chosen purposes with the session client for rows and the service client for facts and bytes', async () => {
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?tenantPlans=1&schematicPlans=1' })
    expect(r).toEqual({ ok: true, appendix: { load: { inputs: [], omitted: [] }, generatedOn: '2026-10-09' } })
    const [clients, args] = m.load.mock.calls[0]!
    expect(clients.db).toBe(session)
    expect(clients.facts).toEqual({ storage: { tag: 'storage' } })
    expect(clients.storage).toEqual({ tag: 'storage' })
    expect(args).toEqual({ projectId: 'p1', today: '2026-10-09', purposes: ['tenant_layout', 'distribution_schematic'] })
  })
  it('only the ticked purpose is loaded', async () => {
    await loadReportAppendix({ ...base, url: 'http://x/r?schematicPlans=1' })
    expect(m.load.mock.calls[0]![1].purposes).toEqual(['distribution_schematic'])
  })
  it('a load failure becomes one "not included" line, never an error', async () => {
    m.load.mockRejectedValue(new Error('status plans could not be read: boom'))
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?schematicPlans=1' })
    expect(r).toEqual({ ok: true, appendix: { load: { inputs: [], omitted: [{ title: 'Tenant status plans', reason: 'the plans could not be loaded — generate the report again' }] }, generatedOn: '2026-10-09' } })
  })
})
