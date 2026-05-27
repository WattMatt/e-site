import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const updateMock = vi.fn()
const resetMock = vi.fn()
const restoreMock = vi.fn()
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    projectSettingsService: {
      update: updateMock,
      reset: resetMock,
      restore: restoreMock,
    },
  }
})

const revalidatePathMock = vi.fn()
const revalidateTagMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
  unstable_cache: (fn: any) => fn,
}))

function makeClient(projectOrgId: string | null) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(
              projectOrgId ? { data: { organisation_id: projectOrgId }, error: null }
                           : { data: null, error: null },
            ),
          }),
        }),
      }),
    }),
  }
}

describe('updateProjectSettingsAction', () => {
  beforeEach(() => {
    requireRoleMock.mockReset()
    createClientMock.mockReset()
    updateMock.mockReset()
    revalidatePathMock.mockReset()
    revalidateTagMock.mockReset()
  })

  it('returns an error when the project cannot be found', async () => {
    createClientMock.mockResolvedValue(makeClient(null))
    const { updateProjectSettingsAction } = await import('./project-settings.actions')

    const result = await updateProjectSettingsAction('missing-id', { retentionPct: 7.5 })

    expect(result).toEqual({ error: 'Project not found' })
    expect(requireRoleMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('returns an error when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient('org-1'))
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    const { updateProjectSettingsAction } = await import('./project-settings.actions')

    const result = await updateProjectSettingsAction('p1', { retentionPct: 7.5 })

    expect(result).toEqual({ error: 'Your role (contractor) is not allowed to perform this action' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('delegates to service.update + revalidates on success', async () => {
    const client = makeClient('org-1')
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    updateMock.mockResolvedValue({ id: 's1', projectId: 'p1', retentionPct: 7.5 })

    const { updateProjectSettingsAction } = await import('./project-settings.actions')

    const result = await updateProjectSettingsAction('p1', { retentionPct: 7.5 })

    expect(updateMock).toHaveBeenCalledWith(client, 'p1', { retentionPct: 7.5 })
    expect(revalidateTagMock).toHaveBeenCalledWith('project-settings:p1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p1/settings', 'layout')
    expect(result).toMatchObject({ settings: { retentionPct: 7.5 } })
  })

  it('catches Zod validation errors and returns { error }', async () => {
    createClientMock.mockResolvedValue(makeClient('org-1'))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    updateMock.mockRejectedValue(new Error('working_days must contain at least one day'))

    const { updateProjectSettingsAction } = await import('./project-settings.actions')

    const result = await updateProjectSettingsAction('p1', { workingDays: [] })

    expect(result).toEqual({ error: 'working_days must contain at least one day' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('resetProjectSettingsAction', () => {
  beforeEach(() => {
    requireRoleMock.mockReset()
    createClientMock.mockReset()
    resetMock.mockReset()
  })

  it('delegates to service.reset with the named fields', async () => {
    createClientMock.mockResolvedValue(makeClient('org-1'))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    resetMock.mockResolvedValue({ id: 's1', projectId: 'p1', retentionPct: 5.0 })

    const { resetProjectSettingsAction } = await import('./project-settings.actions')

    const result = await resetProjectSettingsAction('p1', ['retentionPct'])

    expect(resetMock).toHaveBeenCalledWith(expect.anything(), 'p1', ['retentionPct'])
    expect(result).toMatchObject({ settings: { retentionPct: 5.0 } })
  })
})

describe('restoreProjectSettingsAction', () => {
  beforeEach(() => {
    requireRoleMock.mockReset()
    createClientMock.mockReset()
    restoreMock.mockReset()
  })

  it('delegates to service.restore with the history-row id', async () => {
    createClientMock.mockResolvedValue(makeClient('org-1'))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    restoreMock.mockResolvedValue({ id: 's1', projectId: 'p1' })

    const { restoreProjectSettingsAction } = await import('./project-settings.actions')

    const result = await restoreProjectSettingsAction('p1', 'history-row-9')

    expect(restoreMock).toHaveBeenCalledWith(expect.anything(), 'p1', 'history-row-9')
    expect(result).toMatchObject({ settings: { id: 's1' } })
  })
})
