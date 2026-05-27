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

/** Builds a supabase mock that returns `orgId` for project lookups and
 *  `contactProjectId` for contact lookups (used in update/delete path).
 *  Pass null to simulate "not found" for the first query in that chain.
 */
function makeClient({
  projectOrgId,
  contactProjectId,
  insertData,
  updateData,
}: {
  projectOrgId: string | null
  contactProjectId?: string | null
  insertData?: Record<string, unknown> | null
  updateData?: Record<string, unknown> | null
}) {
  let callCount = 0

  const maybeReturn = (idx: number) => {
    // First call = contact lookup (project_id)
    // Second call = project lookup (organisation_id)
    if (contactProjectId !== undefined) {
      if (idx === 0) {
        return Promise.resolve(
          contactProjectId
            ? { data: { project_id: contactProjectId }, error: null }
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
                  : { data: { id: 'c-1', name: 'Test', project_id: 'p-1', organisation_id: 'org-1' }, error: null },
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
                    : { data: { id: 'c-1', name: 'Updated' }, error: null },
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

describe('listProjectContacts', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
  })

  it('returns contacts for a project', async () => {
    const contacts = [
      { id: 'c-1', project_id: 'p-1', name: 'Alice', role: 'PM', company: null, email: null, phone: null, created_at: '' },
    ]
    createClientMock.mockResolvedValue({
      schema: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: contacts, error: null }),
            }),
          }),
        }),
      }),
    })

    const { listProjectContacts } = await import('./project-contacts.actions')
    const result = await listProjectContacts('p-1')

    expect(result).toEqual({ contacts })
  })
})

describe('createProjectContact', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('creates a contact and returns it', async () => {
    const created = { id: 'c-new', project_id: 'p-1', organisation_id: 'org-1', name: 'Bob', role: 'Site Manager', company: null, email: null, phone: null, created_at: '' }
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1', insertData: created }))
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { createProjectContact } = await import('./project-contacts.actions')
    const result = await createProjectContact('p-1', { name: 'Bob', role: 'Site Manager' })

    expect(result).toEqual({ contact: created })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/settings/contacts')
  })

  it('returns error when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient({ projectOrgId: 'org-1' }))
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Forbidden' })

    const { createProjectContact } = await import('./project-contacts.actions')
    const result = await createProjectContact('p-1', { name: 'Bob' })

    expect(result).toEqual({ error: 'Forbidden' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('updateProjectContact', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('updates a contact and returns it', async () => {
    const updated = { id: 'c-1', project_id: 'p-1', name: 'Bob Updated', role: null, company: null, email: null, phone: null, created_at: '' }
    createClientMock.mockResolvedValue(
      makeClient({ projectOrgId: 'org-1', contactProjectId: 'p-1', updateData: updated }),
    )
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { updateProjectContact } = await import('./project-contacts.actions')
    const result = await updateProjectContact('c-1', { name: 'Bob Updated' })

    expect(result).toEqual({ contact: updated })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/settings/contacts')
  })
})

describe('deleteProjectContact', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    requireRoleMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('deletes a contact and returns ok', async () => {
    createClientMock.mockResolvedValue(
      makeClient({ projectOrgId: 'org-1', contactProjectId: 'p-1' }),
    )
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteProjectContact } = await import('./project-contacts.actions')
    const result = await deleteProjectContact('c-1')

    expect(result).toEqual({ ok: true })
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/p-1/settings/contacts')
  })
})
