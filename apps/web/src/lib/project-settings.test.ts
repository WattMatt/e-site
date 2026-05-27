import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — must declare before importing the module under test.
const revalidateTagMock = vi.fn()

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

const serviceGetMock = vi.fn()
const serviceGetHistoryMock = vi.fn()
vi.mock('@esite/shared', () => ({
  projectSettingsService: {
    get: serviceGetMock,
    getHistory: serviceGetHistoryMock,
  },
}))

describe('project-settings web lib', () => {
  beforeEach(() => {
    revalidateTagMock.mockReset()
    createClientMock.mockReset()
    serviceGetMock.mockReset()
    serviceGetHistoryMock.mockReset()
  })

  it('getProjectSettingsCached fetches via the live client (not via unstable_cache)', async () => {
    const { getProjectSettingsCached } = await import('./project-settings')

    const fakeClient = { fakeClient: true }
    createClientMock.mockResolvedValue(fakeClient)
    serviceGetMock.mockResolvedValue({ id: 's1', projectId: 'p1' })

    const result = await getProjectSettingsCached('p1')

    // Regression: this function used to wrap the body in `unstable_cache`,
    // but Next.js forbids reading cookies inside that scope and createClient()
    // does so. The function now calls the service directly each time.
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(serviceGetMock).toHaveBeenCalledWith(fakeClient, 'p1')
    expect(result).toEqual({ id: 's1', projectId: 'p1' })
  })

  it('getProjectHistoryCached calls the history service with default limit', async () => {
    const { getProjectHistoryCached } = await import('./project-settings')

    createClientMock.mockResolvedValue({})
    serviceGetHistoryMock.mockResolvedValue([])

    await getProjectHistoryCached('p1')

    expect(serviceGetHistoryMock).toHaveBeenCalledWith({}, 'p1', { limit: 50 })
  })

  it('invalidateProjectSettings calls revalidateTag with the per-project tag', async () => {
    const { invalidateProjectSettings } = await import('./project-settings')

    invalidateProjectSettings('p1')

    expect(revalidateTagMock).toHaveBeenCalledWith('project-settings:p1')
  })
})
