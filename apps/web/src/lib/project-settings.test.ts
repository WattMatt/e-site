import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — must declare before importing the module under test.
const revalidateTagMock = vi.fn()
const unstableCacheMock = vi.fn((fn: any, _keys?: unknown, _opts?: unknown) => fn)

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
  unstable_cache: unstableCacheMock,
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
    unstableCacheMock.mockClear()
    createClientMock.mockReset()
    serviceGetMock.mockReset()
    serviceGetHistoryMock.mockReset()
  })

  it('getProjectSettingsCached registers an unstable_cache wrapper keyed by projectId', async () => {
    const { getProjectSettingsCached } = await import('./project-settings')

    const fakeClient = { fakeClient: true }
    createClientMock.mockResolvedValue(fakeClient)
    serviceGetMock.mockResolvedValue({ id: 's1', projectId: 'p1' })

    const result = await getProjectSettingsCached('p1')

    expect(serviceGetMock).toHaveBeenCalledWith(fakeClient, 'p1')
    expect(result).toEqual({ id: 's1', projectId: 'p1' })

    // unstable_cache called with (fn, keyParts, opts) — verify keyParts + tag include projectId.
    const callArgs = unstableCacheMock.mock.calls[0]
    expect(callArgs[1]).toEqual(['project-settings', 'p1'])
    expect(callArgs[2]).toMatchObject({
      tags: ['project-settings:p1'],
    })
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
