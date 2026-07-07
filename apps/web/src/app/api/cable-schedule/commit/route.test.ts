// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env before route.ts module-level consts evaluate.
const { getUserMock, rpcMock, projectResult, roleResult, writeSpy } =
  vi.hoisted(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    return {
      getUserMock: vi.fn(),
      rpcMock: vi.fn(),
      projectResult: { value: { data: null as any, error: null as any } },
      roleResult: { value: { data: null as any, error: null as any } },
      // Counts every insert() the route attempts — proves an unauthorised
      // caller never reaches the write phase (revision / sources / nodes /
      // supplies / cables / change_log).
      writeSpy: vi.fn(),
    }
  })

// One fake client serves auth.getUser (route + the real requireEffectiveRole),
// the projects.projects access read, the user_effective_project_role RPC (the
// gate under test), and a minimal happy-path write chain for the 200 case.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: (...a: unknown[]) => rpcMock(...a),
    schema: (schemaName: string) => ({
      from: (table: string) => {
        if (schemaName === 'projects' && table === 'projects') {
          return {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve(projectResult.value) }),
            }),
          }
        }
        if (table === 'revisions') {
          return {
            // select('code').eq('project_id', …) is awaited directly (thenable);
            // the intoRevisionId path chains .eq().eq().single() instead.
            select: () => {
              const q: any = {
                eq: () => q,
                single: () => Promise.resolve({ data: { id: 'rev1', status: 'DRAFT' }, error: null }),
                then: (onOk: (v: unknown) => unknown) =>
                  Promise.resolve({ data: [], error: null }).then(onOk),
              }
              return q
            },
            insert: (rows: unknown) => {
              writeSpy(table, rows)
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: { id: 'rev1' }, error: null }),
                }),
              }
            },
          }
        }
        // supplies / sources / nodes: insert(rows).select(…) awaited.
        // change_log: insert(row) awaited directly.
        return {
          insert: (rows: unknown) => {
            writeSpy(table, rows)
            const p: any = Promise.resolve({ data: [], error: null })
            p.select = () => Promise.resolve({ data: [], error: null })
            return p
          },
          select: () => {
            const q: any = {
              eq: () => q,
              in: () => Promise.resolve({ data: [], error: null }),
              single: () => Promise.resolve({ data: null, error: null }),
            }
            return q
          },
        }
      },
    }),
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { POST } from './route'

const PROJECT_ID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'

function reqWithBody(projectId: string = PROJECT_ID) {
  return {
    json: async () => ({
      projectId,
      fileName: 'schedule.xlsx',
      fileSizeBytes: 123,
      cables: [],
    }),
  } as unknown as Request
}

beforeEach(() => {
  getUserMock.mockReset()
  rpcMock.mockReset()
  writeSpy.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  projectResult.value = { data: { id: PROJECT_ID, organisation_id: 'o1', name: 'P' }, error: null }
  rpcMock.mockImplementation(async () => roleResult.value)
})

describe('POST /api/cable-schedule/commit — role gate (writes a whole DRAFT revision)', () => {
  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(reqWithBody())
    expect(res.status).toBe(401)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('403 when the project is not accessible', async () => {
    projectResult.value = { data: null, error: { message: 'no' } }
    const res = await POST(reqWithBody())
    expect(res.status).toBe(403)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('403 for a client_viewer — NO revision / supply / cable write attempted', async () => {
    roleResult.value = { data: 'client_viewer', error: null }
    const res = await POST(reqWithBody())
    expect(res.status).toBe(403)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('403 for a contractor effective role (not in ORG_WRITE_ROLES)', async () => {
    roleResult.value = { data: 'contractor', error: null }
    const res = await POST(reqWithBody())
    expect(res.status).toBe(403)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('proceeds (200) for a project_manager effective role and reaches the write phase', async () => {
    roleResult.value = { data: 'project_manager', error: null }
    const res = await POST(reqWithBody())
    expect(res.status).toBe(200)
    // Empty import still opens a DRAFT revision + logs the import.
    expect(writeSpy).toHaveBeenCalledWith('revisions', expect.anything())
    expect(writeSpy).toHaveBeenCalledWith('change_log', expect.anything())
  })

  it('proceeds (200) for an owner effective role', async () => {
    roleResult.value = { data: 'owner', error: null }
    const res = await POST(reqWithBody())
    expect(res.status).toBe(200)
  })
})
