import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
  unstable_cache: (fn: any) => fn,
}))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClient({
  projectOrgId,
  partyProjectId,
  insertData,
  updateData,
}: {
  projectOrgId: string | null
  partyProjectId?: string | null
  insertData?: Record<string, unknown> | null
  updateData?: Record<string, unknown> | null
}) {
  let callCount = 0

  const maybeReturn = (idx: number) => {
    if (partyProjectId !== undefined) {
      if (idx === 0) {
        return Promise.resolve(
          partyProjectId
            ? { data: { project_id: partyProjectId }, error: null }
            : { data: null, error: null },
        )
      }
      if (idx === 1) {
        return Promise.resolve(
          projectOrgId
            ? { data: { organisation_id: projectOrgId }, error: null }
            : { data: null, error: null },
        )
      }
    }
    return Promise.resolve(
      projectOrgId
        ? { data: { organisation_id: projectOrgId }, error: null }
        : { data: null, error: null },
    )
  }

  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              const result = maybeReturn(callCount)
              callCount++
              return result
            },
            order: () => Promise.resolve({ data: [], error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve(
                insertData !== undefined
                  ? { data: insertData, error: insertData ? null : { message: 'insert failed' } }
                  : { data: { id: 'p-new', party_role: 'Employer', name: 'ACME', project_id: 'proj-1', organisation_id: 'org-1' }, error: null },
              ),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () =>
                Promise.resolve(
                  updateData !== undefined
                    ? { data: updateData, error: updateData ? null : { message: 'update failed' } }
                    : { data: { id: 'p-1', party_role: 'Contractor', name: 'BuildCo' }, error: null },
                ),
            }),
          }),
        }),
        delete: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    }),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('listJbccParties', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
  })

  it('returns parties for a project', async () => {
    const parties = [
      { id: 'p-1', project_id: 'proj-1', party_role: 'Employer', name: 'ACME Corp', company: null, address: null, email: null, phone: null, created_by: null, created_at: '', updated_at: '' },
    ]
    createClientMock.mockResolvedValue({
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: parties, error: null }),
            }),
          }),
        }),
      }),
    })

    const { listJbccParties } = await import('./jbcc-parties.actions')
    const result = await listJbccParties('proj-1')

    expect(result).toEqual({ parties })
  })
})

describe('createJbccParty', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('creates a party and returns it', async () => {
    const created = { id: 'p-new', project_id: 'proj-1', organisation_id: 'org-1', party_role: 'Employer', name: 'ACME Corp', company: null, address: null, email: null, phone: null, created_by: null, created_at: '', updated_at: '' }
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1', insertData: created }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { createJbccParty } = await import('./jbcc-parties.actions')
    const result = await createJbccParty('proj-1', { party_role: 'Employer', name: 'ACME Corp' })

    expect(result).toEqual({ party: created })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/proj-1/settings/jbcc-parties')
  })

  it('returns error when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })

    const { createJbccParty } = await import('./jbcc-parties.actions')
    const result = await createJbccParty('proj-1', { party_role: 'Employer', name: 'ACME' })

    expect(result).toEqual({ error: 'Forbidden' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('updateJbccParty', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('updates a party and returns it', async () => {
    const updated = { id: 'p-1', project_id: 'proj-1', party_role: 'Contractor', name: 'BuildCo', company: null, address: null, email: null, phone: null, created_by: null, created_at: '', updated_at: '' }
    createClientMock.mockResolvedValue(
      makeClient({ projectOrgId: 'org-1', partyProjectId: 'proj-1', updateData: updated }),
    )
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { updateJbccParty } = await import('./jbcc-parties.actions')
    const result = await updateJbccParty('p-1', { party_role: 'Contractor', name: 'BuildCo' })

    expect(result).toEqual({ party: updated })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/proj-1/settings/jbcc-parties')
  })
})

describe('deleteJbccParty', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('deletes a party and returns ok', async () => {
    createClientMock.mockResolvedValue(
      makeClient({ projectOrgId: 'org-1', partyProjectId: 'proj-1' }),
    )
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteJbccParty } = await import('./jbcc-parties.actions')
    const result = await deleteJbccParty('p-1')

    expect(result).toEqual({ ok: true })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/proj-1/settings/jbcc-parties')
  })
})
