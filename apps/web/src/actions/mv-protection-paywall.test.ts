// @vitest-environment node
/**
 * The R2 000/user/yr Medium-Voltage paywall must hold on the SERVER ACTIONS,
 * not only in page.tsx (finding #20).
 *
 * `grep -r 'requireMvAccess\|hasMvAccess' apps/web/src/actions apps/web/src/app/api`
 * returned NOTHING before this change: the gate lived in five page components
 * and nowhere else. Server actions are directly invocable — this repo has
 * shipped that exact bug before (tenant-schedule import, PR #135; saved-report
 * reads, PR #162) — so at go-live any owner/admin/PM of a paying org could
 * produce and store the entire paid deliverable without a subscription.
 *
 * ⚠ THE DELIBERATE DIVERGENCE, and the fixture that protects it.
 * `overrideFaultLevel` shares resolveWritableRevision with the four gated
 * actions but must stay UNGATED: it is called from FaultLevelEditor in the
 * FREE cable-schedule workspace on every DRAFT revision, and it is the only
 * writer of revisions.fault_level_ka — the input to the LV schedule's
 * short-circuit check. Putting the paywall inside the shared helper (the
 * obvious one-line implementation) would silently break short-circuit checking
 * for every LV cable-schedule user. The last test in this file is the fixture
 * that can fail on that: it drives overrideFaultLevel with MV access OFF and
 * asserts the write still lands.
 *
 * The gate is exercised through the REAL lib/mv-access.ts against a stubbed
 * `user_has_mv_access` RPC, so the fail-closed-on-error behaviour is under
 * test too, not mocked away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const REVISION = 'aaaaaaaa-0000-4000-8000-000000000001'
const PROJECT = 'bbbbbbbb-0000-4000-8000-000000000002'
const ORG = 'cccccccc-0000-4000-8000-000000000003'

const { mvRpc, revisionRow, roleResult, serviceCalls, revisionUpdates } = vi.hoisted(() => ({
  mvRpc: { value: { data: false as unknown, error: null as unknown } },
  revisionRow: { value: null as any },
  roleResult: { value: { ok: true, role: 'owner' } as any },
  serviceCalls: [] as string[],
  revisionUpdates: [] as any[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-mv' } }, error: null }) },
    rpc: async (name: string) => (name === 'user_has_mv_access' ? mvRpc.value : { data: null, error: null }),
    schema: (_s: string) => ({
      from: (t: string) => {
        const b: any = {}
        const chain = () => b
        b.select = chain
        b.eq = (..._a: unknown[]) => {
          if (b._pending) {
            const p = b._pending; b._pending = null
            revisionUpdates.push(p)
            return Promise.resolve({ error: null })
          }
          return b
        }
        b.update = (p: any) => { b._pending = p; return b }
        b.insert = async () => ({ error: null })
        b.maybeSingle = async () =>
          t === 'revisions' ? { data: revisionRow.value, error: null } : { data: null, error: null }
        return b
      },
    }),
  }),
}))

vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: async () => roleResult.value,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  const track = (name: string) => async () => { serviceCalls.push(name); return { id: 'x' } }
  return {
    ...actual,
    mvProtectionService: {
      upsertMvStudySettings: track('upsertMvStudySettings'),
      upsertFaultSource: track('upsertFaultSource'),
      upsertProtectionDevice: track('upsertProtectionDevice'),
      upsertMvStudySignoff: track('upsertMvStudySignoff'),
    },
  }
})

import {
  upsertMvStudySettings,
  upsertFaultSource,
  upsertProtectionDevice,
  upsertMvStudySignoff,
  overrideFaultLevel,
} from './mv-protection.actions'

/** The four actions that ARE the paid Medium-Voltage module. */
const GATED: Array<[string, () => Promise<any>]> = [
  ['upsertMvStudySettings', () => upsertMvStudySettings({ revisionId: REVISION } as any)],
  ['upsertFaultSource', () => upsertFaultSource({ revisionId: REVISION } as any)],
  ['upsertProtectionDevice', () => upsertProtectionDevice({ revisionId: REVISION } as any)],
  ['upsertMvStudySignoff', () => upsertMvStudySignoff({ revisionId: REVISION } as any)],
]

beforeEach(() => {
  revisionRow.value = { id: REVISION, status: 'DRAFT', project_id: PROJECT, organisation_id: ORG }
  roleResult.value = { ok: true, role: 'owner' }
  mvRpc.value = { data: false, error: null }
  serviceCalls.length = 0
  revisionUpdates.length = 0
})

describe('MV server actions — subscription required, role alone is not enough', () => {
  for (const [name, call] of GATED) {
    it(`${name} refuses an owner with no MV subscription, and writes nothing`, async () => {
      const res = await call()
      expect(res).toHaveProperty('error')
      expect(String((res as any).error)).toMatch(/Medium-Voltage subscription/i)
      // The gate is worthless if the service ran anyway.
      expect(serviceCalls).toHaveLength(0)
    })

    it(`${name} allows a subscriber`, async () => {
      mvRpc.value = { data: true, error: null }
      const res = await call()
      expect(res).toHaveProperty('data')
      expect(serviceCalls).toEqual([name])
    })

    it(`${name} fails CLOSED when the entitlement lookup errors`, async () => {
      mvRpc.value = { data: null, error: { message: 'rpc exploded' } }
      const res = await call()
      expect(res).toHaveProperty('error')
      expect(serviceCalls).toHaveLength(0)
    })
  }

  it('the role gate still runs first — a contractor is refused on role, not on billing', async () => {
    mvRpc.value = { data: true, error: null }
    roleResult.value = { ok: false, error: 'Your role (contractor) is not allowed to perform this action' }
    const res = await upsertFaultSource({ revisionId: REVISION } as any)
    expect(String((res as any).error)).toMatch(/not allowed/i)
    expect(serviceCalls).toHaveLength(0)
  })
})

describe('overrideFaultLevel stays FREE — it feeds the LV short-circuit check', () => {
  it('writes fault_level_ka for a user with NO MV subscription', async () => {
    mvRpc.value = { data: false, error: null }
    const res = await overrideFaultLevel({ revisionId: REVISION, faultLevelKa: 12.5 })
    expect(res).toEqual({ data: { faultLevelKa: 12.5 } })
    // If the paywall is ever moved into resolveWritableRevision, this write
    // disappears and short-circuit checking breaks for every LV user.
    expect(revisionUpdates).toContainEqual({ fault_level_ka: 12.5 })
  })

  it('is still refused on role for a contractor', async () => {
    roleResult.value = { ok: false, error: 'Your role (contractor) is not allowed to perform this action' }
    const res = await overrideFaultLevel({ revisionId: REVISION, faultLevelKa: 12.5 })
    expect(res).toHaveProperty('error')
    expect(revisionUpdates).toHaveLength(0)
  })
})
