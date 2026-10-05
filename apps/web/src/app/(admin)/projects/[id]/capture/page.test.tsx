import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const getById = vi.fn()
// Named `effectiveRole`, not after the helper: role-gate-call-sites.contract.test.ts
// treats any `requireEffectiveRole(` call that never reads `.ok` as an inert gate.
const effectiveRole = vi.fn()
const hasFeature = vi.fn()
const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })

vi.mock('next/navigation', () => ({ notFound: () => notFound() }))
// The caller's role in the PROJECT's organisation, read for the inspection tile.
let orgRole: string | null = 'project_manager'
const orgRoleFilters: Array<[string, unknown]> = []
function orgRoleQuery() {
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { orgRoleFilters.push([c, v]); return q },
    maybeSingle: async () => ({ data: orgRole ? { role: orgRole } : null }),
  }
  return q
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => { if (t !== 'user_organisations') throw new Error(t); return orgRoleQuery() },
  }),
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => effectiveRole(...a) }))
vi.mock('@/lib/features', () => ({ hasFeature: (...a: unknown[]) => hasFeature(...a) }))
vi.mock('@esite/shared', async (orig) => {
  const actual = await orig<typeof import('@esite/shared')>()
  return { ...actual, projectService: { getById: (...a: unknown[]) => getById(...a) } }
})

import ProjectCapturePage from './page'

const params = Promise.resolve({ id: 'p1' })

beforeEach(() => {
  getById.mockReset().mockResolvedValue({ id: 'p1', name: 'KINGSWALK', organisation_id: 'o1' })
  effectiveRole.mockReset().mockResolvedValue({ ok: true, role: 'project_manager' })
  hasFeature.mockReset().mockResolvedValue(true)
  notFound.mockClear()
  orgRole = 'project_manager'
  orgRoleFilters.length = 0
})

const hrefs = () =>
  within(screen.getByRole('list', { name: 'Capture actions' }))
    .getAllByRole('link')
    .map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])

describe('/projects/[id]/capture', () => {
  it('offers the five capture actions, each scoped to this project', async () => {
    render(await ProjectCapturePage({ params }))
    expect(hrefs()).toEqual([
      ['Diary entry', '/projects/p1/diary?new=entry'],
      ['Snag', '/projects/p1/snags/new'],
      ['Site form', '/projects/p1/forms/new'],
      ['Inspection', '/projects/p1/inspections/new'],
      ['Photo', '/projects/p1/diary?new=photo'],
    ])
  })

  it('checks the inspections unlock against the project’s own organisation', async () => {
    render(await ProjectCapturePage({ params }))
    expect(hasFeature).toHaveBeenCalledWith('o1', 'inspections', expect.anything())
    expect(effectiveRole).toHaveBeenCalledWith(expect.anything(), 'p1', expect.any(Array))
  })

  it('shows the inspection as locked when the org has not unlocked it', async () => {
    hasFeature.mockResolvedValue(false)
    render(await ProjectCapturePage({ params }))
    const link = screen.getByRole('link', { name: 'Inspection (locked)' })
    expect(link.getAttribute('href')).toBe('/inspections/unlock')
  })

  it('reads the org role in the project’s own organisation for the inspection tile', async () => {
    render(await ProjectCapturePage({ params }))
    expect(orgRoleFilters).toEqual(expect.arrayContaining([['user_id', 'u1'], ['organisation_id', 'o1'], ['is_active', true]]))
  })

  it('hides the inspection from a contractor promoted to PM on this project only', async () => {
    effectiveRole.mockResolvedValue({ ok: true, role: 'project_manager' })
    orgRole = 'contractor'
    render(await ProjectCapturePage({ params }))
    expect(hrefs().map(([label]) => label)).toEqual(['Diary entry', 'Snag', 'Site form', 'Photo'])
  })

  it('gives each tile an accessible description', async () => {
    render(await ProjectCapturePage({ params }))
    const snag = screen.getByRole('link', { name: 'Snag' })
    const desc = document.getElementById(snag.getAttribute('aria-describedby')!)
    expect(desc?.textContent).toMatch(/Raise a defect/)
  })

  it('narrows to the caller’s role: an inspector sees snag and site form only', async () => {
    effectiveRole.mockResolvedValue({ ok: true, role: 'inspector' })
    orgRole = 'inspector'
    render(await ProjectCapturePage({ params }))
    expect(hrefs().map(([label]) => label)).toEqual(['Snag', 'Site form'])
  })

  it('a caller with no project role gets an explanation, not an empty grid', async () => {
    effectiveRole.mockResolvedValue({ ok: false, error: 'No access to this project' })
    render(await ProjectCapturePage({ params }))
    expect(screen.queryByRole('list', { name: 'Capture actions' })).toBeNull()
    expect(screen.getByText(/not on this project’s team yet/)).toBeTruthy()
  })

  it('404s for a project the caller cannot read', async () => {
    getById.mockResolvedValue(null)
    await expect(ProjectCapturePage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
