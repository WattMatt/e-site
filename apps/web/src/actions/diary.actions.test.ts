import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so mocks exist before the hoisted vi.mock factories run.
const {
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  getEntryForGateMock,
  hardDeleteMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  getEntryForGateMock: vi.fn(),
  hardDeleteMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    diaryService: {
      ...actual.diaryService,
      getEntryForGate: getEntryForGateMock,
      hardDelete: hardDeleteMock,
    },
  }
})

import { deleteDiaryEntryAction } from './diary.actions'

const ENTRY_ID   = '11111111-1111-1111-1111-111111111111'
const PROJECT_ID = '22222222-2222-2222-2222-222222222222'
const AUTHOR_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

/** Cookie client mock: auth.getUser + rpc (rpc feeds the real requireEffectiveRole). */
function mockClient(opts: { userId?: string; role?: string | null } = {}) {
  const { userId = AUTHOR_ID, role = 'project_manager' } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
  }
}

beforeEach(() => {
  createClientMock.mockReset()
  createServiceClientMock.mockReset()
  revalidatePathMock.mockReset()
  getEntryForGateMock.mockReset()
  hardDeleteMock.mockReset()

  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue({})
  getEntryForGateMock.mockResolvedValue({
    id: ENTRY_ID, project_id: PROJECT_ID, organisation_id: 'org-1', created_by: AUTHOR_ID,
  })
  hardDeleteMock.mockResolvedValue(undefined)
})

describe('deleteDiaryEntryAction — validation', () => {
  it('rejects a non-uuid entryId before any I/O', async () => {
    const res = await deleteDiaryEntryAction('not-a-uuid')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — auth + existence', () => {
  it('rejects when unauthenticated', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    })
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'Not authenticated' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })

  it('returns "Entry not found" when the entry is not visible (other org / missing)', async () => {
    getEntryForGateMock.mockResolvedValue(null)
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'Entry not found' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — author-or-PM gate', () => {
  it('lets the AUTHOR delete their own entry without a role check', async () => {
    // Author is a plain contractor — author short-circuit must still allow it.
    createClientMock.mockResolvedValue(mockClient({ userId: AUTHOR_ID, role: 'contractor' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({})
    expect(hardDeleteMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/diary`)
  })

  it('lets a PM delete ANOTHER user\'s entry', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: 'project_manager' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({})
    expect(hardDeleteMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID)
  })

  it('blocks a non-author who is not owner/admin/PM', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: 'contractor' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'You do not have permission to delete this entry.' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })

  it('blocks a non-author with no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: null }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'You do not have permission to delete this entry.' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })

  it('does not short-circuit on a null author — a null-authored entry still requires the role gate', async () => {
    // A null created_by must never satisfy the author check (null === uuid is false),
    // so a non-write-role user cannot delete a null-authored entry.
    getEntryForGateMock.mockResolvedValue({
      id: ENTRY_ID, project_id: PROJECT_ID, organisation_id: 'org-1', created_by: null,
    })
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: 'contractor' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'You do not have permission to delete this entry.' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — failure handling', () => {
  it('surfaces a hardDelete error', async () => {
    hardDeleteMock.mockRejectedValue(new Error('db exploded'))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'db exploded' })
  })
})
