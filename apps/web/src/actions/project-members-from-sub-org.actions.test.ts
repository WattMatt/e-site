import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const requireRoleMock = vi.fn()
const createClientMock = vi.fn()
const revalidatePathMock = vi.fn()

vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: vi.fn(),
}))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual }
})

// ─── IDs ──────────────────────────────────────────────────────────────────────

const PROJECT_ID    = '00000000-0000-0000-0000-000000000010'
const PROJECT_ORG_ID = '00000000-0000-0000-0000-000000000001'
const SUB_ORG_ID    = '00000000-0000-0000-0000-000000000002'
const WRONG_ORG_ID  = '00000000-0000-0000-0000-000000000099'
const USER_A        = '00000000-0000-0000-0000-000000000020'
const USER_B        = '00000000-0000-0000-0000-000000000021'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a supabase mock client.
 *
 * The action calls the client in this order:
 *   1. .schema('projects').from('projects').select().eq().maybeSingle()  → project row
 *   2. requireRole (called with supabase, projectOrgId)                  → provided via requireRoleMock
 *   3. .from('organisations').select().eq().maybeSingle()                → sub-org row
 *   4. .from('user_organisations').select().eq().eq().in()               → roster rows (array)
 *   5. .schema('projects').from('project_members').select().eq().in()    → existing on-project rows
 *   6. per-user: .schema('projects').from('project_members').insert()    → { error }
 */
function makeClient({
  projectRow,
  subOrgRow,
  rosterRows,
  existingOnProject,
  insertErrors,
}: {
  projectRow:        { organisation_id: string } | null
  subOrgRow:         { id: string; parent_organisation_id: string | null; is_shadow: boolean; is_active: boolean } | null
  rosterRows:        Array<{ user_id: string }>
  existingOnProject: Array<{ user_id: string }>
  insertErrors?:     (null | { message: string })[]
}) {
  const insertErrorList = insertErrors ?? []
  let insertCallIndex = 0

  // schema().from() factory — returns different objects per from() call
  const schemaFrom = vi.fn()
    // Call 1: schema('projects').from('projects')
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnValueOnce({
          maybeSingle: vi.fn().mockResolvedValueOnce({ data: projectRow, error: null }),
        }),
      }),
    })
    // Call 2: schema('projects').from('project_members') — existing check
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnValueOnce({
          in: vi.fn().mockResolvedValueOnce({ data: existingOnProject, error: null }),
        }),
      }),
    })
    // Call 3+: schema('projects').from('project_members') — per-user inserts
    .mockImplementation(() => {
      const err = insertErrorList[insertCallIndex++] ?? null
      return {
        insert: vi.fn().mockResolvedValueOnce({ error: err }),
      }
    })

  const schema = vi.fn().mockReturnValue({ from: schemaFrom })

  // regular from() factory (no schema prefix)
  const regularFrom = vi.fn()
    // Call 1: from('organisations') → sub-org lookup
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnValueOnce({
          maybeSingle: vi.fn().mockResolvedValueOnce({ data: subOrgRow, error: null }),
        }),
      }),
    })
    // Call 2: from('user_organisations') → roster check
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        eq: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            in: vi.fn().mockResolvedValueOnce({ data: rosterRows, error: null }),
          }),
        }),
      }),
    })

  return { schema, from: regularFrom }
}

const VALID_INPUT = {
  projectId:   PROJECT_ID,
  subOrgId:    SUB_ORG_ID,
  userIds:     [USER_A],
  projectRole: 'contractor' as const,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('addProjectMembersFromSubOrg', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ok:false with zod error when userIds is missing', async () => {
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    // @ts-expect-error — intentionally invalid
    const result = await addProjectMembersFromSubOrg({ projectId: PROJECT_ID, subOrgId: SUB_ORG_ID, projectRole: 'contractor' })
    expect(result.ok).toBe(false)
  })

  it('returns ok:false "Project not found." when project row is null', async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce(
      makeClient({ projectRow: null, subOrgRow: null, rosterRows: [], existingOnProject: [] }),
    )
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg(VALID_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Project not found/i)
  })

  it('returns ok:false "Sub-organisation not found." when sub-org row is null', async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce(
      makeClient({
        projectRow: { organisation_id: PROJECT_ORG_ID },
        subOrgRow: null,
        rosterRows: [],
        existingOnProject: [],
      }),
    )
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg(VALID_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Sub-organisation not found/i)
  })

  it("returns ok:false when sub-org belongs to a different parent org", async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce(
      makeClient({
        projectRow: { organisation_id: PROJECT_ORG_ID },
        subOrgRow:  { id: SUB_ORG_ID, parent_organisation_id: WRONG_ORG_ID, is_shadow: true, is_active: true },
        rosterRows: [],
        existingOnProject: [],
      }),
    )
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg(VALID_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/does not belong/i)
  })

  it('returns ok:false when sub-org is_active=false (deactivated)', async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce(
      makeClient({
        projectRow: { organisation_id: PROJECT_ORG_ID },
        subOrgRow:  { id: SUB_ORG_ID, parent_organisation_id: PROJECT_ORG_ID, is_shadow: true, is_active: false },
        rosterRows: [],
        existingOnProject: [],
      }),
    )
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg(VALID_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/deactivated/i)
  })

  it('returns ok:false when sub-org is_shadow=false (claimed)', async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce(
      makeClient({
        projectRow: { organisation_id: PROJECT_ORG_ID },
        subOrgRow:  { id: SUB_ORG_ID, parent_organisation_id: PROJECT_ORG_ID, is_shadow: false, is_active: true },
        rosterRows: [],
        existingOnProject: [],
      }),
    )
    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg(VALID_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/claimed/i)
  })

  it('happy path: adds user in roster, skips user already on project — correct summary counts', async () => {
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })

    const client = makeClient({
      projectRow:        { organisation_id: PROJECT_ORG_ID },
      subOrgRow:         { id: SUB_ORG_ID, parent_organisation_id: PROJECT_ORG_ID, is_shadow: true, is_active: true },
      rosterRows:        [{ user_id: USER_A }, { user_id: USER_B }],
      existingOnProject: [{ user_id: USER_B }],   // USER_B already on project → skipped
      insertErrors:      [null],                    // USER_A insert succeeds
    })
    createClientMock.mockResolvedValueOnce(client)

    const { addProjectMembersFromSubOrg } = await import('./project-members-from-sub-org.actions')
    const result = await addProjectMembersFromSubOrg({
      projectId:   PROJECT_ID,
      subOrgId:    SUB_ORG_ID,
      userIds:     [USER_A, USER_B],
      projectRole: 'contractor',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.added).toBe(1)
      expect(result.summary.skipped).toBe(1)
      expect(result.summary.failed).toBe(0)
      const addedDetail = result.details.find((d) => d.user_id === USER_A)
      const skippedDetail = result.details.find((d) => d.user_id === USER_B)
      expect(addedDetail?.status).toBe('added')
      expect(skippedDetail?.status).toBe('skipped-already-on-project')
    }
  })
})
