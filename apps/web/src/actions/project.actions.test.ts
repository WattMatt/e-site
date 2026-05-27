import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const requireRoleMock = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

// Avoid importing analytics / PLANS which have side effects in the module.
vi.mock('@/lib/analytics', () => ({
  trackServer: vi.fn(),
  ANALYTICS_EVENTS: { PROJECT_CREATED: 'project_created', PROJECT_DELETED: 'project_deleted' },
}))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
  unstable_cache: (fn: any) => fn,
}))

// ─── Supabase mock builder ─────────────────────────────────────────────────────

/** Builds a supabase-like chainable mock.
 *  - `maybeSingleData`: what .maybeSingle() resolves to (org lookup).
 *  - `updateError`: error returned from .update().eq() if non-null.
 */
function makeClient(
  maybySingleData: { organisation_id: string } | null,
  updateError: { message: string } | null = null,
) {
  const updateEq = vi.fn().mockResolvedValue({ error: updateError })
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq })

  return {
    // org lookup chain: .schema().from().select().eq().maybeSingle()
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: maybySingleData, error: null }),
          }),
        }),
        update: updateFn,
      }),
    }),
    _updateFn: updateFn,
    _updateEq: updateEq,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('updateProjectAction', () => {
  beforeEach(() => {
    requireRoleMock.mockReset()
    createClientMock.mockReset()
    revalidatePathMock.mockReset()
  })

  it('returns { error: "Project not found" } when project is missing', async () => {
    createClientMock.mockResolvedValue(makeClient(null))
    const { updateProjectAction } = await import('./project.actions')

    const result = await updateProjectAction('no-such-id', { name: 'X' })

    expect(result).toEqual({ error: 'Project not found' })
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it('returns { error } when role gate fails', async () => {
    createClientMock.mockResolvedValue(makeClient({ organisation_id: 'org-1' }))
    requireRoleMock.mockResolvedValue({
      ok: false,
      error: 'Your role (contractor) is not allowed to perform this action',
    })
    const { updateProjectAction } = await import('./project.actions')

    const result = await updateProjectAction('proj-1', { name: 'X' })

    expect(result).toEqual({
      error: 'Your role (contractor) is not allowed to perform this action',
    })
  })

  it('returns { ok: true } on success and maps camelCase → snake_case columns', async () => {
    const client = makeClient({ organisation_id: 'org-1' })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { updateProjectAction } = await import('./project.actions')

    const result = await updateProjectAction('proj-1', {
      name: 'New Name',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      clientName: 'Acme Corp',
      clientContact: 'john@acme.com',
    })

    expect(result).toEqual({ ok: true })

    // Verify the snake_case mapping was sent to .update()
    expect(client._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Name',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        client_name: 'Acme Corp',
        client_contact: 'john@acme.com',
      }),
    )

    // Should NOT include keys that were never in the input
    const calledWith = client._updateFn.mock.calls[0][0] as Record<string, unknown>
    expect('description' in calledWith).toBe(false)
    expect('city' in calledWith).toBe(false)

    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/proj-1', 'layout')
  })
})
