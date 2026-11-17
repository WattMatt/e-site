import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  enabled: vi.fn(() => true), gate: vi.fn(), view: vi.fn(), solar: vi.fn(), client: vi.fn(), form: vi.fn(),
  supabase: { from: vi.fn(), schema: vi.fn(), auth: { getUser: vi.fn() } },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.supabase }))
vi.mock('@/lib/programme/flag', () => ({ programmeEnabled: h.enabled }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.gate }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.solar }))
vi.mock('@/lib/programme/view-data', () => ({ loadProgrammeView: h.view }))
vi.mock('./ProgrammeClient', () => ({ ProgrammeClient: (p: unknown) => { h.client(p); return <div>client stub</div> } }))
vi.mock('./CreateProgrammeForm', () => ({ CreateProgrammeForm: (p: unknown) => { h.form(p); return <div>create form</div> } }))
import Page from './page'

const view = { state: { programme: { id: 'g1', kind: 'project', name: 'Main' } }, version: 'v', activeBaseline: null, baselines: [] }
const params = Promise.resolve({ id: 'P1' })
const run = async (searchParams: Record<string, string> = {}) =>
  render(await Page({ params, searchParams: Promise.resolve(searchParams) }))

beforeEach(() => {
  vi.clearAllMocks()
  h.enabled.mockReturnValue(true)
  h.gate.mockResolvedValue({ ok: true, role: 'owner' })
  h.view.mockResolvedValue({ ok: true, view, programmes: [{ id: 'g1', kind: 'project', name: 'Main', module_key: null, contractor_label: null }] })
  h.solar.mockResolvedValue('edit')
  h.supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  // projects.projects start_date lookup
  h.supabase.schema.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { start_date: '2026-05-04' }, error: null }) }) }) }) })
})

describe('Programme page', () => {
  it('flag off: the not-switched-on card, nothing loaded', async () => {
    h.enabled.mockReturnValue(false)
    await run()
    expect(screen.getByText('The programme module is not switched on yet.')).toBeTruthy()
    expect(h.gate).not.toHaveBeenCalled()
    expect(h.view).not.toHaveBeenCalled()
  })
  it('client_viewer is refused with an inline card and the loader is never reached', async () => {
    h.gate.mockResolvedValue({ ok: false })
    await run()
    expect(screen.getByText(/do not have access to this project/i)).toBeTruthy()
    expect(h.view).not.toHaveBeenCalled()
    const roles = h.gate.mock.calls[0][2] as string[]
    expect(roles).not.toContain('client_viewer')
    expect(roles).toContain('contractor')
  })
  it('contractor with no programme sees "No programme yet."', async () => {
    h.gate.mockResolvedValue({ ok: true, role: 'contractor' })
    h.view.mockResolvedValue({ ok: true, view: null, programmes: [] })
    await run()
    expect(screen.getByText('No programme yet.')).toBeTruthy()
    expect(h.form).not.toHaveBeenCalled()
  })
  it('owner with no programme gets the create form with the project start', async () => {
    h.view.mockResolvedValue({ ok: true, view: null, programmes: [] })
    await run()
    expect(h.form).toHaveBeenCalledWith({ projectId: 'p1', defaultStart: '2026-05-04' })
  })
  it('?module=solar with no module programme says so to every role and never offers the project form', async () => {
    h.view.mockResolvedValue({ ok: true, view: null, programmes: [] })
    for (const role of ['owner', 'contractor']) {
      h.gate.mockResolvedValue({ ok: true, role })
      const { unmount } = await run({ module: 'solar' })
      expect(screen.getByText('No Solar programme yet.')).toBeTruthy()
      expect(h.form).not.toHaveBeenCalled()
      unmount()
    }
  })
  it('an existing programme renders the client; canEdit follows the role', async () => {
    await run()
    expect(h.view).toHaveBeenCalledWith(expect.anything(), 'p1', { programmeId: undefined, module: undefined })
    expect(h.client.mock.calls[0][0]).toMatchObject({ projectId: 'p1', view, canEdit: true })
    h.client.mockClear()
    h.gate.mockResolvedValue({ ok: true, role: 'contractor' })
    await run()
    expect(h.client.mock.calls[0][0]).toMatchObject({ canEdit: false })
  })
  it('passes the signed-in user id, so the grid remembers column choices per user', async () => {
    await run()
    expect(h.client.mock.calls[0][0]).toMatchObject({ userId: 'user-1' })
    h.client.mockClear()
    h.supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    await run()
    expect(h.client.mock.calls[0][0]).toMatchObject({ userId: null })
  })
  it('props are JSON only', async () => {
    await run()
    for (const v of Object.values(h.client.mock.calls[0][0])) expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
  it('a module programme edits by Solar access, not by role', async () => {
    h.view.mockResolvedValue({ ok: true, view: { ...view, state: { programme: { id: 'g2', kind: 'module', name: 'Solar' } } }, programmes: [] })
    h.gate.mockResolvedValue({ ok: true, role: 'contractor' })
    h.solar.mockResolvedValue('edit')
    await run({ module: 'solar' })
    expect(h.view).toHaveBeenCalledWith(expect.anything(), 'p1', { programmeId: undefined, module: 'solar' })
    expect(h.client.mock.calls[0][0]).toMatchObject({ canEdit: true })
    h.client.mockClear()
    h.solar.mockResolvedValue('view')
    h.gate.mockResolvedValue({ ok: true, role: 'owner' })
    await run({ module: 'solar' })
    expect(h.client.mock.calls[0][0]).toMatchObject({ canEdit: false })
  })
  it('a load failure shows its sentence', async () => {
    h.view.mockResolvedValue({ ok: false, error: 'That programme no longer exists, or you do not have access to it.' })
    await run({ programme: 'zzz' })
    expect(screen.getByRole('alert').textContent).toContain('no longer exists')
  })
})
