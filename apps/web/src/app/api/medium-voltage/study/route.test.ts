// @vitest-environment node
/**
 * POST /api/medium-voltage/study — the paid Z-bus + earth-fault solve.
 *
 * Part of finding #20. This route IS the paid deliverable: it runs the full
 * three-phase and zero-sequence solve and caches the per-node results. Its
 * only gate was requireRoleAPI(ORG_WRITE_ROLES), so at go-live any
 * owner/admin/PM of a paying org could obtain the entire R2 000/user/yr
 * output by POSTing { revisionId } with no subscription at all. Route handlers
 * sit outside the (admin) layout and are directly invocable — the five
 * page.tsx gates never applied here.
 *
 * THE FIXTURE RULE. Asserting `res.status === 402` alone would pass even if
 * the solve ran and saveFaultResults wrote the cache before the response was
 * built — which is exactly the shape that leaks the deliverable, since the
 * results are then readable over PostgREST. Every refusal test therefore
 * asserts that the solver and the save were NOT called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const REVISION = 'dddddddd-0000-4000-8000-000000000004'

const { mvRpc, revisionRow, guardResult, solved, saveMock } = vi.hoisted(() => ({
  mvRpc: { value: { data: false as unknown, error: null as unknown } },
  revisionRow: { value: null as any },
  guardResult: { value: null as any },
  solved: [] as string[],
  saveMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-mv' } }, error: null }) },
    rpc: async (name: string) => (name === 'user_has_mv_access' ? mvRpc.value : { data: null, error: null }),
    schema: () => ({
      from: () => {
        const b: any = {}
        const chain = () => b
        b.select = chain; b.eq = chain
        b.maybeSingle = async () => ({ data: revisionRow.value, error: null })
        return b
      },
    }),
  }),
}))

vi.mock('@/lib/auth/require-role', () => ({
  requireRoleAPI: async () => guardResult.value,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  return {
    ...actual,
    mvProtectionService: {
      loadStudyGraph: async () => {
        solved.push('loadStudyGraph')
        return { input: {}, organisationId: 'org', projectId: 'proj' }
      },
      saveFaultResults: (...a: unknown[]) => { solved.push('saveFaultResults'); return saveMock(...a) },
    },
    buildMvNetwork: () => { solved.push('buildMvNetwork'); return { buses: [{ id: 'n1' }] } },
    faultsForNetwork: () => { solved.push('faultsForNetwork'); return { n1: { islanded: false, ik3MaxKa: 1, ik3MinKa: 1, xrRatio: 1, ipKa: 1, basis: 'b' } } },
    earthFaultForNetwork: () => { solved.push('earthFaultForNetwork'); return { n1: { ik1Ka: 1, ik1MinKa: 1, basis: 'b' } } },
  }
})

import { POST } from './route'

const req = (body: unknown = { revisionId: REVISION }) =>
  ({ json: async () => body }) as unknown as Request

beforeEach(() => {
  revisionRow.value = { id: REVISION, status: 'DRAFT', project_id: 'proj', organisation_id: 'org' }
  guardResult.value = { ok: true, ctx: { userId: 'u-mv', organisationId: 'org', role: 'owner' }, user: { id: 'u-mv' } }
  mvRpc.value = { data: false, error: null }
  solved.length = 0
  saveMock.mockReset()
  saveMock.mockResolvedValue(1)
})

describe('POST /api/medium-voltage/study — MV subscription required', () => {
  it('402s an owner with no subscription and never runs the solve', async () => {
    const res = await POST(req())
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Medium-Voltage subscription/i) })
    expect(solved).toHaveLength(0)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('fails CLOSED when the entitlement lookup errors', async () => {
    mvRpc.value = { data: null, error: { message: 'rpc exploded' } }
    const res = await POST(req())
    expect(res.status).toBe(402)
    expect(solved).toHaveLength(0)
  })

  it('runs the solve and caches results for a subscriber', async () => {
    mvRpc.value = { data: true, error: null }
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(solved).toContain('saveFaultResults')
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('the role gate still runs first — a contractor is refused on role', async () => {
    mvRpc.value = { data: true, error: null }
    guardResult.value = { ok: false, response: new Response(null, { status: 403 }) }
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(solved).toHaveLength(0)
  })

  it('a frozen revision is still refused before anything else', async () => {
    mvRpc.value = { data: true, error: null }
    revisionRow.value = { ...revisionRow.value, status: 'ISSUED' }
    const res = await POST(req())
    expect(res.status).toBe(422)
    expect(solved).toHaveLength(0)
  })

  it('400 without a revisionId', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
    expect(solved).toHaveLength(0)
  })
})
