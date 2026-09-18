// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import zlib from 'node:zlib'

/**
 * cable-route.actions.ts — the two separations its module header declares.
 *
 *  1. MEASURING IS NOT ASSIGNING. `saveSupplyRouteAction` records geometry and
 *     must not write a cable length. `applyRouteToScheduleAction` is the only
 *     writer of `measured_length_m`, and it refuses to replace an existing
 *     figure without `confirmOverwrite` — KINGSWALK holds 162 hand-entered
 *     lengths and a traced route is a second opinion, not a replacement.
 *
 *  2. THE CLIENT SENDS GEOMETRY, THE SERVER DECIDES LENGTH. Metres are derived
 *     from `tenants.floor_plans.pixels_per_meter`, read server-side. Anything
 *     the caller asserts about scale or length is ignored, because a length a
 *     client can assert is a length anyone with the page open can assert, and
 *     this one ends up on an issued schedule.
 *
 * Plus the three refusals that make those separations real: an uncalibrated
 * drawing, a drawing from another project (RLS scopes to the ORG, so the
 * project check is the only thing standing there), an ISSUED revision, and the
 * `ROLE_CAPS[...].editMeasured` capability gate on both actions.
 *
 * ⚠ FIXTURE DISCIPLINE. Every fixture below is chosen so the assertion is ABLE
 * to fail. The two that matter most are called out inline:
 *   - the drawing's ppm produces a DIFFERENT number from the caller's claim
 *     (test 1) — equal numbers would prove nothing about which one was used;
 *   - the existing `measured_length_m` DIFFERS from the proposed total
 *     (test 6) — seeding them equal makes the overwrite gate invisible.
 */

const {
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  requireRoleForRevisionMock,
  lookupCableRoleMock,
  requireEffectiveRoleMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  requireRoleForRevisionMock: vi.fn(),
  lookupCableRoleMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a),
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

// Hand-written to match the real module's exports: `ROLES_ENGINEER_AND_FIELD`
// and `ROLES_ENGINEER` are both aliases of `ORG_WRITE_ROLES`
// (['owner','admin','project_manager']) — see lib/cable-schedule/require-role.ts.
vi.mock('@/lib/cable-schedule/require-role', () => ({
  requireRoleForRevision: (...a: unknown[]) => requireRoleForRevisionMock(...a),
  requireRole: vi.fn(),
  ROLES_ENGINEER: ['owner', 'admin', 'project_manager'] as const,
  ROLES_ENGINEER_AND_FIELD: ['owner', 'admin', 'project_manager'] as const,
}))

// Only the DB lookup is stubbed. ROLE_CAPS stays REAL, so the capability test
// below is pinned against the shipped table rather than a copy of it that
// could drift into agreeing with whatever the action does.
vi.mock('@/lib/cable-schedule/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cable-schedule/roles')>()
  return { ...actual, lookupCableRole: (...a: unknown[]) => lookupCableRoleMock(...a) }
})

import {
  restoreRouteHistoryAction,
  remeasureRouteLegsAction,
  revertRouteAssignmentAction,
  calibrateFloorPlanAction as calibrateAction,
  exportRouteSheetAction,
  calibrateFloorPlanAction,
  saveSupplyRouteAction,
  applyRouteToScheduleAction,
} from './cable-route.actions'
import { ROLE_CAPS } from '@/lib/cable-schedule/roles'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const SUPPLY_ID = '22222222-2222-2222-2222-222222222222'
const REVISION_ID = '33333333-3333-3333-3333-333333333333'
const PROJECT_ID = '44444444-4444-4444-4444-444444444444'
const OTHER_PROJECT_ID = '55555555-5555-5555-5555-555555555555'
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001'
const PLAN_A = '66666666-6666-6666-6666-666666666666'
const PLAN_B = '77777777-7777-7777-7777-777777777777'
const ROUTE_ID = '88888888-8888-8888-8888-888888888888'
const CABLE_1 = '99999999-9999-9999-9999-999999999991'
const CABLE_2 = '99999999-9999-9999-9999-999999999992'

/* ───────────────────────────── the fake database ───────────────────────────── */

type Write = {
  schema: string
  table: string
  op: 'insert' | 'update' | 'upsert' | 'delete'
  payload?: any
  opts?: any
  /** Same array instance the builder mutates, so `.eq()` calls land here. */
  filters: Array<{ col: string; val: unknown }>
}

interface Fixture {
  /** cable_schedule.supplies → the single() read in loadSupplyContext. */
  supply: any | null
  /** tenants.floor_plans → the .in() read. RLS has already allowed these. */
  plans: any[]
  /** cable_schedule.supply_routes → the maybeSingle() read in apply. */
  route: any | null
  /** cable_schedule.cables → the strands of the supply. */
  cables: any[]
  /** Force a write failure on one table, to exercise the error paths. */
  failWriteOn?: string
  /** tenants.floor_plans → the .eq(id).maybeSingle() ROW read. */
  planSingle?: any
}

let writes: Write[] = []

function makeClient(fx: Fixture) {
  function builder(schema: string, table: string) {
    const filters: Write['filters'] = []
    let op: 'select' | Write['op'] = 'select'

    const record = (w: Omit<Write, 'filters'>) => {
      writes.push({ ...w, filters })
    }

    let single = false
    const result = () => {
      if (op !== 'select' && fx.failWriteOn === table) {
        return { data: null, error: { message: 'permission denied for table ' + table } }
      }
      if (op !== 'select') {
        // Two non-select read-backs: the route upsert's .select('id').single(),
        // and the segment insert's .select(...) which echoes the rows back with
        // ids so the canvas can draw and edit them without a reload.
        // The route row comes back with its trigger-maintained updated_at, for
        // both the upsert (save) and the update (restore) read-backs.
        if ((op === 'upsert' || op === 'update') && table === 'supply_routes') {
          return { data: { id: ROUTE_ID, updated_at: '2026-09-15T10:00:00.000Z' }, error: null }
        }
        if (op === 'insert' && table === 'route_segments') {
          const last = writes[writes.length - 1]
          const rows = Array.isArray(last?.payload) ? last.payload : []
          return { data: rows.map((r: any, i: number) => ({ id: `seg-${i + 1}`, ...r })), error: null }
        }
        return { data: null, error: null }
      }
      // Generic fallback: a fixture may describe any table's rows directly.
      // A `.maybeSingle()`/`.single()` read returns the first row.
      const keyed = (fx as any).tables?.[`${schema}.${table}`]
      if (keyed !== undefined) {
        return { data: single ? (Array.isArray(keyed) ? (keyed[0] ?? null) : keyed) : keyed, error: null }
      }
      if (schema === 'cable_schedule' && table === 'supplies') {
        return fx.supply
          ? { data: fx.supply, error: null }
          : { data: null, error: { message: 'no rows' } }
      }
      if (schema === 'tenants' && table === 'floor_plans') {
        // calibrateFloorPlanAction does .eq(id).maybeSingle() and gets a ROW;
        // saveSupplyRouteAction does .in(ids) and gets a LIST. The real client
        // distinguishes these, so the fake must too — returning [] for the row
        // read leaves `plan` truthy but every field undefined, which is exactly
        // how a missing project-scope check would slip through unnoticed.
        return single
          ? { data: (fx as any).planSingle ?? null, error: null }
          : { data: fx.plans, error: null }
      }
      if (schema === 'cable_schedule' && table === 'supply_routes') {
        return { data: fx.route, error: null }
      }
      if (schema === 'cable_schedule' && table === 'cables') {
        return { data: fx.cables, error: null }
      }
      return { data: null, error: null }
    }

    const api: any = {
      // emitProductEvent (00194) calls .rpc on the same client; it swallows a
      // failure, but a fake without it logs a TypeError on every save.
      rpc: async () => ({ data: null, error: null }),
      select: () => api,
      eq: (col: string, val: unknown) => { filters.push({ col, val }); return api },
      in: (col: string, val: unknown) => { filters.push({ col, val }); return api },
      order: () => api,
      limit: () => api,
      insert: (payload: any) => { op = 'insert'; record({ schema, table, op, payload }); return api },
      update: (payload: any) => { op = 'update'; record({ schema, table, op, payload }); return api },
      upsert: (payload: any, opts: any) => {
        op = 'upsert'; record({ schema, table, op, payload, opts }); return api
      },
      delete: () => { op = 'delete'; record({ schema, table, op }); return api },
      single: () => { single = true; return Promise.resolve(result()) },
      maybeSingle: () => { single = true; return Promise.resolve(result()) },
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    }
    return api
  }

  return {
    // emitProductEvent (00194) calls .rpc on the caller's client and swallows a failure.
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    // lookupCableRole is mocked, so the public-schema path is never taken.
    from: (table: string) => builder('public', table),
    schema: (schema: string) => ({ from: (table: string) => builder(schema, table) }),
  }
}

const DRAFT_SUPPLY = {
  id: SUPPLY_ID,
  revision_id: REVISION_ID,
  organisation_id: ORG_ID,
  revision: { id: REVISION_ID, status: 'DRAFT', project_id: PROJECT_ID },
}

/**
 * ⚠ FIXTURE — 10 px per metre. The caller's bogus claim below is 2 px/m, which
 * would make the same polyline five times longer. If both were 10 the test
 * could not tell which number the server used, and would pass with the
 * calibration read deleted.
 */
const PLAN_A_PPM = 10

function calibratedPlanA() {
  return { id: PLAN_A, name: 'POWER LAYOUT PORTION A', pixels_per_meter: PLAN_A_PPM, project_id: PROJECT_ID }
}

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    supply: DRAFT_SUPPLY,
    plans: [calibratedPlanA()],
    route: null,
    cables: [],
    ...over,
  }
}

function use(fx: Fixture) {
  createClientMock.mockResolvedValue(makeClient(fx))
}

function writesTo(table: string) {
  return writes.filter((w) => w.table === table)
}

/** One straight leg 100 px long → 10.00 m at 10 px/m, 50.00 m at the claimed 2 px/m. */
const HUNDRED_PX = [0, 0, 100, 0]

/**
 * A save payload carrying the two keys a client must not be able to assert.
 * They are extra keys the zod schema does not declare, so they should be
 * stripped before anything sees them.
 */
function payloadWithClientClaims(over: Record<string, unknown> = {}) {
  return {
    supplyId: SUPPLY_ID,
    segments: [
      {
        floorPlanId: PLAN_A,
        pageIndex: 1,
        points: HUNDRED_PX,
        pixelsPerMeter: 2,   // a lie: would yield 50.00 m
        lengthM: 999,        // a bigger lie
      },
    ],
    pixelsPerMeter: 2,
    lengthM: 999,
    ...over,
  } as any
}

beforeEach(() => {
  writes = []
  createClientMock.mockReset()
  // emitProductEvent (00194) runs its RPC on the service client and swallows a
  // failure; without a default here every save logs a TypeError.
  createServiceClientMock.mockReset().mockReturnValue({ rpc: async () => ({ data: null, error: null }) })
  revalidatePathMock.mockReset()
  requireRoleForRevisionMock.mockReset().mockResolvedValue({ ok: true, role: 'admin' })
  lookupCableRoleMock.mockReset().mockResolvedValue('Admin')
  use(fixture())
})

/* ─────────────── 1. the server computes length, the client cannot ─────────────── */

describe('saveSupplyRouteAction — the server decides length', () => {
  it('measures from the DRAWING calibration, not from anything the caller sent', async () => {
    use(fixture())
    const res = await saveSupplyRouteAction(payloadWithClientClaims())

    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)

    const [insert] = writesTo('route_segments').filter((w) => w.op === 'insert')
    expect(insert).toBeDefined()
    const row = insert.payload[0]

    // 100 px ÷ 10 px/m. The caller's 2 px/m would have produced 50.
    expect(row.length_m).toBe(10)
    expect(row.length_m).not.toBe(50)
    expect(row.length_m).not.toBe(999)
    expect(row.pixels_per_meter).toBe(PLAN_A_PPM)

    // And the claims never reach the row at all — the schema strips them.
    expect(row).not.toHaveProperty('pixelsPerMeter')
    expect(row).not.toHaveProperty('lengthM')

    // What the caller is told to display is the server's figure.
    expect(res.tracedM).toBe(10)
    expect(res.totalM).toBe(10)
  })

  it('adds rise and drop to the traced metres without changing the traced figure', async () => {
    use(fixture())
    const res = await saveSupplyRouteAction(
      payloadWithClientClaims({ riseM: 3.5, dropM: 0.5 }),
    )
    expect(res.tracedM).toBe(10)
    expect(res.totalM).toBe(14)
  })

  it('returns the persisted segments with ids, so the sheet can draw and edit them without a reload', async () => {
    // After the first cut, a saved leg vanished until a hard reload: the
    // action returned only totals, so the viewer had nothing to draw with.
    use(fixture())
    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID,
      riseM: 0,
      dropM: 0,
      segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: [0, 0, 300, 0, 300, 400] }],
    })
    expect(res.ok).toBe(true)
    expect(res.segments).toHaveLength(1)
    expect(res.segments![0]).toMatchObject({ id: 'seg-1', floorPlanId: PLAN_A, pageIndex: 1, points: [0, 0, 300, 0, 300, 400] })
    expect(res.segments![0].lengthM).toBe(70)   // 700 px along the path at PLAN_A's 10 px/m
    expect(res.segments![0].pixelsPerMeter).toBe(PLAN_A_PPM)
  })

  it('sends merge-duplicates as a Prefer header via onConflict, not only in the query string', async () => {
    // The failure mode PR #142/#143 shipped twice: on_conflict= in the URL with
    // no Prefer header plain-INSERTs and 409s on the second save of a run.
    use(fixture())
    await saveSupplyRouteAction(payloadWithClientClaims())
    const [upsert] = writesTo('supply_routes').filter((w) => w.op === 'upsert')
    expect(upsert.opts).toMatchObject({ onConflict: 'supply_id', ignoreDuplicates: false })
  })
})

/* ───────────────────────── 2. uncalibrated drawing ───────────────────────── */

describe('saveSupplyRouteAction — uncalibrated drawing', () => {
  it('refuses, and names only the uncalibrated plan so the UI can offer calibration', async () => {
    // ⚠ FIXTURE — TWO plans, one calibrated and one not. With a single
    // uncalibrated plan the assertion would also pass for an implementation
    // that returned every plan id in the route, which is a different (and
    // useless) message for the UI to act on.
    use(fixture({
      plans: [
        calibratedPlanA(),
        { id: PLAN_B, name: 'PORTION B', pixels_per_meter: null, project_id: PROJECT_ID },
      ],
    }))

    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID,
      segments: [
        { floorPlanId: PLAN_A, pageIndex: 1, points: HUNDRED_PX },
        { floorPlanId: PLAN_B, pageIndex: 1, points: HUNDRED_PX },
      ],
    } as any)

    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/calibrate/i)
    expect(res.uncalibratedPlanIds).toEqual([PLAN_B])

    // Refusing means refusing: no partial route for the calibrated sheet.
    expect(writesTo('supply_routes')).toHaveLength(0)
    expect(writesTo('route_segments')).toHaveLength(0)
  })

  it('treats a zero calibration as uncalibrated rather than dividing by it', async () => {
    use(fixture({
      plans: [{ id: PLAN_A, name: 'A', pixels_per_meter: 0, project_id: PROJECT_ID }],
    }))
    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID,
      segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: HUNDRED_PX }],
    } as any)
    expect(res.uncalibratedPlanIds).toEqual([PLAN_A])
    expect(writesTo('route_segments')).toHaveLength(0)
  })
})

/* ─────────────────────── 3. a drawing from another project ─────────────────────── */

describe('saveSupplyRouteAction — cross-project drawing', () => {
  it('refuses a drawing belonging to another project, even though RLS returned it', async () => {
    // ⚠ FIXTURE — the plan row IS returned by the query. That is the whole
    // point: RLS scopes floor_plans to the ORG, so a sister project's sheet
    // reads fine and only the project check in the action stops it. Omitting
    // the row would exercise the "not found" path instead and would still pass
    // with the project check deleted.
    use(fixture({
      plans: [{
        id: PLAN_A,
        name: 'SISTER PROJECT PORTION A',
        pixels_per_meter: 25,
        project_id: OTHER_PROJECT_ID,
      }],
    }))

    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID,
      segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: HUNDRED_PX }],
    } as any)

    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/not part of this project/i)
    expect(writesTo('supply_routes')).toHaveLength(0)
    expect(writesTo('route_segments')).toHaveLength(0)
  })
})

/* ───────────────────────────── 4. ISSUED revisions ───────────────────────────── */

describe('ISSUED revisions are frozen', () => {
  const issued = () =>
    fixture({
      supply: { ...DRAFT_SUPPLY, revision: { id: REVISION_ID, status: 'ISSUED', project_id: PROJECT_ID } },
      route: { id: ROUTE_ID, total_length_m: 137.25, traced_length_m: 133.25 },
      cables: [{ id: CABLE_1, measured_length_m: null, confirmed_length_m: null, length_status: null }],
    })

  it('refuses to save a route onto an issued revision', async () => {
    use(issued())
    const res = await saveSupplyRouteAction(payloadWithClientClaims())
    expect(res.error).toMatch(/start a new revision/i)
    expect(writes).toHaveLength(0)
  })

  it('refuses to apply a route onto an issued revision', async () => {
    use(issued())
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID })
    expect(res.error).toMatch(/start a new revision/i)
    expect(writes).toHaveLength(0)
  })
})

/* ─────────────────── 5. measuring does not write a cable length ─────────────────── */

describe('measuring is not assigning', () => {
  it('writes no cable length when a route is saved', async () => {
    // The fixture deliberately HAS strands, so a stray write would have
    // somewhere to land. With no cables seeded an absent write proves nothing.
    use(fixture({
      cables: [
        { id: CABLE_1, measured_length_m: null, confirmed_length_m: null, length_status: null },
        { id: CABLE_2, measured_length_m: null, confirmed_length_m: null, length_status: null },
      ],
    }))

    const res = await saveSupplyRouteAction(payloadWithClientClaims())
    expect(res.ok).toBe(true)

    expect(writesTo('cables')).toHaveLength(0)
    expect(writesTo('change_log')).toHaveLength(0)
  })
})

/* ─────────────── 6-9. applyRouteToScheduleAction ─────────────── */

/**
 * ⚠ FIXTURE — 42.5 existing vs 137.25 proposed. These MUST differ: the action
 * only raises `needsConfirmation` when the stored value differs from the
 * proposal, so seeding them equal would make every assertion below pass with
 * the overwrite gate removed.
 */
const PROPOSED_M = 137.25
const EXISTING_M = 42.5

function applyFixture(over: Partial<Fixture> = {}): Fixture {
  return fixture({
    route: { id: ROUTE_ID, total_length_m: PROPOSED_M, traced_length_m: 133.25 },
    cables: [
      // Two strands of one parallel run. Their PRIOR lengths differ (one set,
      // one null) so "one change_log row per strand carrying old and new"
      // cannot be satisfied by a single constant repeated per row.
      { id: CABLE_1, measured_length_m: EXISTING_M, confirmed_length_m: 40, length_status: 'MEASURED' },
      { id: CABLE_2, measured_length_m: null, confirmed_length_m: null, length_status: 'DESIGN' },
    ],
    ...over,
  })
}

describe('applyRouteToScheduleAction — the overwrite gate', () => {
  it('refuses to replace an existing length silently, and reports both figures', async () => {
    use(applyFixture())
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID })

    expect(res.ok).toBeUndefined()
    expect(res.needsConfirmation).toEqual({
      existingM: EXISTING_M,
      proposedM: PROPOSED_M,
      strands: 2,
      // Every distinct length actually on the run, not just the first strand's.
      // Parallels are not forced to agree, so confirming against one figure
      // while overwriting another is a confirmation that hides what it costs.
      existingValuesM: [EXISTING_M],
    })

    // Refusing must be a no-op, not a write plus a warning.
    expect(writesTo('cables')).toHaveLength(0)
    expect(writesTo('change_log')).toHaveLength(0)
  })

  it('reports EVERY distinct existing length when parallel strands disagree', async () => {
    // ⚠ The fixture is the test. Nothing in the schema forces parallel strands
    // to carry the same measured_length_m, and the default fixture has one
    // value plus a null, so a buggy "show strands[0]" would pass it. Here the
    // two strands hold DIFFERENT real lengths: reporting only the first would
    // ask the user to approve replacing 42.5 while silently also replacing 61,
    // a figure they were never shown.
    use(
      applyFixture({
        cables: [
          { id: CABLE_1, measured_length_m: 61, confirmed_length_m: null, length_status: 'MEASURED' },
          { id: CABLE_2, measured_length_m: 42.5, confirmed_length_m: null, length_status: 'MEASURED' },
        ],
      } as any),
    )
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID })

    expect(res.needsConfirmation?.existingValuesM).toEqual([42.5, 61])
    expect(writesTo('cables')).toHaveLength(0)
  })

  it('reports a failed audit-log write instead of returning ok', async () => {
    // The lengths are already on the cables by the time change_log is written,
    // so this cannot roll back — but silently returning ok would leave the
    // schedule changed with no record of who changed it or from what, which is
    // the half an issued revision is audited on. It must say so.
    use(applyFixture({ failWriteOn: 'change_log' } as any))
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })

    expect(writesTo('cables').filter((w) => w.op === 'update')).toHaveLength(2)   // the length DID apply (fields, then status)
    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/audit log/i)
    expect(res.error).toMatch(/applied to 2 strands/i)
  })

  it('writes once confirmOverwrite is given', async () => {
    use(applyFixture())
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })

    expect(res.needsConfirmation).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.appliedM).toBe(PROPOSED_M)
    expect(res.strands).toBe(2)
    expect(writesTo('cables').filter((w) => w.op === 'update')).toHaveLength(2)
  })

  it('does not stall on a first application, when there is nothing to overwrite', async () => {
    use(applyFixture({
      cables: [{ id: CABLE_1, measured_length_m: null, confirmed_length_m: null, length_status: 'DESIGN' }],
    }))
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID })
    expect(res.needsConfirmation).toBeUndefined()
    expect(res.ok).toBe(true)
  })
})

describe('applyRouteToScheduleAction — what it writes', () => {
  it('applies to every strand of the supply, as a measured SCALE_RULE length', async () => {
    use(applyFixture())
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })
    expect(res.ok).toBe(true)

    const [update, status] = writesTo('cables').filter((w) => w.op === 'update')
    expect(update).toBeDefined()
    expect(update.payload).toMatchObject({
      measured_length_m: PROPOSED_M,
      measured_length_method: 'SCALE_RULE',
      measured_length_by: USER_ID,
    })
    // Status is a second, narrower write: only UNMEASURED strands are promoted.
    expect(status.payload).toEqual({ length_status: 'MEASURED' })
    // Parallels share a route, so the filter is the supply — not one cable id.
    expect(update.filters).toEqual([{ col: 'supply_id', val: SUPPLY_ID }])
    expect(update.filters.some((f) => f.col === 'id')).toBe(false)
  })

  it('logs one change_log row per strand, carrying that strand\'s old value', async () => {
    use(applyFixture())
    await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })

    const [log] = writesTo('change_log').filter((w) => w.op === 'insert')
    expect(log).toBeDefined()
    expect(log.payload).toHaveLength(2)

    const byEntity = Object.fromEntries(log.payload.map((r: any) => [r.entity_id, r]))
    expect(byEntity[CABLE_1]).toMatchObject({
      revision_id: REVISION_ID,
      organisation_id: ORG_ID,
      entity_type: 'cable',
      field_name: 'measured_length_m',
      old_value: EXISTING_M,
      new_value: PROPOSED_M,
      changed_by: USER_ID,
    })
    // The second strand had no prior length. A constant old_value fails here.
    expect(byEntity[CABLE_2]).toMatchObject({ old_value: null, new_value: PROPOSED_M })
  })

  it('never touches confirmed_length_m', async () => {
    // ⚠ FIXTURE — CABLE_1 carries confirmed_length_m: 40, a site figure that
    // disagrees with the proposal. A null fixture would make "does not write
    // it" indistinguishable from "wrote null over null".
    use(applyFixture())
    await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })

    const [update] = writesTo('cables').filter((w) => w.op === 'update')
    expect(update.payload).not.toHaveProperty('confirmed_length_m')
    expect(update.payload).not.toHaveProperty('confirmed_length_by')
    expect(update.payload).not.toHaveProperty('confirmed_length_at')
    expect(Object.keys(update.payload).join(' ')).not.toMatch(/confirmed/)
  })
})

describe('applyRouteToScheduleAction — degenerate routes', () => {
  it('refuses a zero-length route', async () => {
    use(applyFixture({ route: { id: ROUTE_ID, total_length_m: 0, traced_length_m: 0 } }))
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })
    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/zero/i)
    expect(writesTo('cables')).toHaveLength(0)
    expect(writesTo('change_log')).toHaveLength(0)
  })

  it('refuses when there is no route at all', async () => {
    use(applyFixture({ route: null }))
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })
    expect(res.error).toMatch(/no measured route/i)
    expect(writesTo('cables')).toHaveLength(0)
  })
})

/* ───────────────────────────── 10. role gating ───────────────────────────── */

describe('role gating — the same gate on both halves', () => {
  // Guard on the fixture itself: if ROLE_CAPS ever grants these, the tests
  // below would be asserting nothing.
  it.each(['Viewer', 'SiteOperator'] as const)(
    '%s genuinely cannot editMeasured (fixture precondition)',
    (role) => {
      expect(ROLE_CAPS[role].editMeasured).toBe(false)
    },
  )

  it.each(['Viewer', 'SiteOperator'] as const)(
    'refuses %s on saveSupplyRouteAction and writes nothing',
    async (role) => {
      use(fixture())
      lookupCableRoleMock.mockResolvedValue(role)
      const res = await saveSupplyRouteAction(payloadWithClientClaims())
      expect(res.ok).toBeUndefined()
      expect(res.error).toContain(role)
      expect(res.error).toMatch(/cannot measure/i)
      expect(writesTo('supply_routes')).toHaveLength(0)
      expect(writesTo('route_segments')).toHaveLength(0)
    },
  )

  it.each(['Viewer', 'SiteOperator'] as const)(
    'refuses %s on applyRouteToScheduleAction and writes nothing',
    async (role) => {
      use(applyFixture())
      lookupCableRoleMock.mockResolvedValue(role)
      const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })
      expect(res.ok).toBeUndefined()
      expect(res.error).toMatch(/cannot measure/i)
      expect(writesTo('cables')).toHaveLength(0)
      expect(writesTo('change_log')).toHaveLength(0)
    },
  )

  it.each([
    ['saveSupplyRouteAction', () => saveSupplyRouteAction(payloadWithClientClaims())],
    ['applyRouteToScheduleAction', () => applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })],
  ] as const)('%s also honours the coarse requireRoleForRevision gate', async (_name, call) => {
    use(applyFixture())
    // Role caps say Admin, so only the coarse gate can refuse — if the action
    // dropped requireRoleForRevision this call would succeed.
    lookupCableRoleMock.mockResolvedValue('Admin')
    requireRoleForRevisionMock.mockResolvedValue({ ok: false, error: 'Insufficient permissions' })
    const res: any = await call()
    expect(res.ok).toBeUndefined()
    expect(res.error).toBe('Insufficient permissions')
    expect(writesTo('cables')).toHaveLength(0)
    expect(writesTo('supply_routes')).toHaveLength(0)
  })

  it('refuses an unauthenticated caller before reading anything', async () => {
    createClientMock.mockResolvedValue({
      ...makeClient(fixture()),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    })
    const res = await saveSupplyRouteAction(payloadWithClientClaims())
    expect(res.error).toBe('Not authenticated')
    expect(writes).toHaveLength(0)
  })
})


describe('calibrateFloorPlanAction — who may set a drawing\'s scale', () => {
  const PLAN = '55555555-5555-5555-5555-555555555555'
  const PROJECT = '66666666-6666-6666-6666-666666666666'

  function calibFixture(): any {
    return {
      supply: null,
      plans: [],
      route: null,
      cables: [],
      planSingle: { id: PLAN, project_id: PROJECT },
    }
  }

  beforeEach(() => {
    requireEffectiveRoleMock.mockReset()
  })

  it('refuses a caller without the project write role, and writes nothing', async () => {
    // Calibration is not a private value. It is the scale every route on the
    // sheet is measured against, so changing it makes every stored segment on
    // that drawing stale. A directly-invocable server action that rewrites it
    // needs the same gate as the schedule.
    // The real helper resolves to a RESULT OBJECT, never a boolean. Mocking a
    // boolean here is what made this suite incapable of catching the inert
    // `if (!allowed)` gate that shipped in PR #180 — `!{}` is always false, and
    // `!false` is always true, so a boolean mock passes either way.
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    use(calibFixture())

    const res = await calibrateFloorPlanAction({
      floorPlanId: PLAN,
      points: [0, 0, 250, 0],
      realMetres: 5,
    })

    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/permission/i)
    expect(writesTo('floor_plans')).toHaveLength(0)
  })

  it('derives px/m from the drawn line for a permitted caller', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    use(calibFixture())

    const res = await calibrateFloorPlanAction({
      floorPlanId: PLAN,
      points: [0, 0, 250, 0],
      realMetres: 5,
    })

    // 250 px over 5 m. A dx-only or bounding-box bug would not give 50 here,
    // and a hard-coded default would not depend on the inputs at all.
    expect(res.ok).toBe(true)
    expect(res.pixelsPerMeter).toBe(50)
    const w = writesTo('floor_plans')
    expect(w).toHaveLength(1)
    expect((w[0].payload as any).pixels_per_meter).toBe(50)
    // The two points and the metres are stored WITH the scale. Without them a
    // calibrated sheet shows a number and nothing else — nobody can see where
    // the scale was taken, so nobody can tell whether it was taken sensibly.
    expect((w[0].payload as any).calibration_points).toEqual([0, 0, 250, 0])
    expect((w[0].payload as any).calibration_metres).toBe(5)
    expect((w[0].payload as any).calibration_page_index).toBe(1)
  })

  it('gates on the plan\'s OWN project, not one the caller names', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    use(calibFixture())
    await calibrateFloorPlanAction({ floorPlanId: PLAN, points: [0, 0, 250, 0], realMetres: 5 })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, expect.anything())
  })
})

/* ─────────────── 5. exporting a sheet keeps a record, not a download ─────────────── */

describe('exportRouteSheetAction — the sheet becomes a versioned report', () => {
  const PLAN_ROW = { id: PLAN_A, name: 'POWER LAYOUT A', project_id: PROJECT_ID, organisation_id: ORG_ID, pixels_per_meter: 10, calibration_metres: 5 }
  const REV_ROW = { id: REVISION_ID, code: 'Rev 0', project_id: PROJECT_ID }
  // A real 1x1 JPEG (generated with sips) — pdf-lib checks the SOI marker.
  const JPEG_1PX = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k='

  type ServiceWrite = { table: string; op: 'insert' | 'update'; payload: unknown }
  let serviceWrites: ServiceWrite[] = []
  let uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }> = []
  let removed: string[] = []

  function fakeService(opts: { insertFails?: boolean } = {}) {
    const builder = (table: string) => {
      let op: 'select' | 'insert' | 'update' = 'select'
      const api: any = {
        select: () => api,
        eq: () => api,
        neq: () => api,
        order: () => api,
        limit: () => api,
        insert: (payload: unknown) => { op = 'insert'; serviceWrites.push({ table, op, payload }); return api },
        update: (payload: unknown) => { op = 'update'; serviceWrites.push({ table, op, payload }); return api },
        single: () => Promise.resolve(
          op === 'insert'
            ? (opts.insertFails ? { data: null, error: { message: 'boom' } } : { data: { id: 'report-1' }, error: null })
            : { data: null, error: null },
        ),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej),
      }
      return api
    }
    return {
      rpc: async () => ({ data: null, error: null }),
      schema: () => ({ from: builder }),
      storage: {
        from: () => ({
          upload: async (path: string, bytes: Uint8Array, o: { contentType: string }) => { uploads.push({ path, bytes, contentType: o.contentType }); return { error: null } },
          remove: async (paths: string[]) => { removed.push(...paths); return { error: null } },
        }),
      },
    }
  }

  /**
   * The drawn text of every content stream. pdf-lib writes standard-font text
   * as HEX strings (`<7363616c65…> Tj`), so the streams are inflated where
   * Flate-encoded and the hex literals decoded — an ASCII search on the raw
   * bytes finds nothing. Latin1 is enough here: the header line is ASCII.
   */
  function pdfStreamsText(buf: Buffer): string {
    let text = ''
    const streamMarker = Buffer.from('stream')
    const endMarker = Buffer.from('endstream')
    let cursor = 0
    for (;;) {
      const start = buf.indexOf(streamMarker, cursor)
      if (start === -1) break
      const end = buf.indexOf(endMarker, start)
      if (end === -1) break
      let dataStart = start + streamMarker.length
      while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
      const chunk = buf.subarray(dataStart, end)
      let decoded: string
      try { decoded = zlib.inflateSync(chunk).toString('latin1') } catch { decoded = chunk.toString('latin1') }
      for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(m[1], 'hex').toString('latin1')
      text += '\n'
      cursor = end + endMarker.length
    }
    return text
  }

  function sheetFixture(): Fixture {
    return fixture({
      tables: {
        'tenants.floor_plans': [PLAN_ROW],
        'cable_schedule.revisions': [REV_ROW],
        'projects.projects': [{ name: 'KINGSWALK', code: '643' }],
        'cable_schedule.supply_routes': [{ id: ROUTE_ID, supply_id: SUPPLY_ID, total_length_m: 73.5 }],
        // One leg on this sheet, one on another — the legend must say so.
        'cable_schedule.route_segments': [
          { route_id: ROUTE_ID, floor_plan_id: PLAN_A, page_index: 1, length_m: 70 },
          { route_id: ROUTE_ID, floor_plan_id: PLAN_B, page_index: 1, length_m: 3.5 },
        ],
        'cable_schedule.supplies': [{ id: SUPPLY_ID, from_node_id: 'n1', to_node_id: 'n2' }],
        'structure.nodes': [{ id: 'n1', code: 'MB 1.1' }, { id: 'n2', code: 'DB-10' }],
      },
    } as any)
  }

  beforeEach(() => {
    serviceWrites = []
    uploads = []
    removed = []
    createServiceClientMock.mockReset().mockReturnValue(fakeService())
    requireEffectiveRoleMock.mockReset()
  })

  it('refuses a caller without the schedule write role, and touches neither storage nor the reports table', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    use(sheetFixture())
    const res = await exportRouteSheetAction({ floorPlanId: PLAN_A, revisionId: REVISION_ID, pageIndex: 1, jpegBase64: JPEG_1PX })
    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/permission/i)
    expect(uploads).toHaveLength(0)
    expect(serviceWrites).toHaveLength(0)
  })

  it('renders a PDF, uploads it, and records a versioned report row for THIS sheet', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    use(sheetFixture())
    const res = await exportRouteSheetAction({ floorPlanId: PLAN_A, revisionId: REVISION_ID, pageIndex: 1, jpegBase64: JPEG_1PX })
    expect(res.error).toBeUndefined()
    expect(res).toMatchObject({ ok: true, reportId: 'report-1', version: 1, runs: 1 })
    expect(uploads).toHaveLength(1)
    expect(uploads[0].contentType).toBe('application/pdf')
    expect(Buffer.from(uploads[0].bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(uploads[0].path).toBe(`${ORG_ID}/${PROJECT_ID}/cable-route-sheets/${PLAN_A}-p1-v1.pdf`)
    const [insert] = serviceWrites.filter((w) => w.op === 'insert')
    expect(insert.table).toBe('reports')
    expect(insert.payload).toMatchObject({
      kind: 'cable_route_sheet',
      source_table: 'tenants.floor_plans',
      source_id: PLAN_A,
      status: 'issued',
      version: 1,
      generated_by: USER_ID,
      // The legend is computed here from the stored segments: one 70 m leg on
      // this sheet, of a 73.5 m run that continues elsewhere. `page` and
      // `revisionId` identify the sheet — the schedule's report pack finds
      // "the applicable sheets" for a revision by them.
      summary: { runs: 1, legsHere: 1, onSheetM: 70, page: 1, revisionId: REVISION_ID },
    })
    expect(removed).toHaveLength(0)
  })

  it('refuses to export a page with nothing traced on it, before touching storage', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    use(sheetFixture())
    const res = await exportRouteSheetAction({ floorPlanId: PLAN_A, revisionId: REVISION_ID, pageIndex: 2, jpegBase64: JPEG_1PX })
    expect(res.error).toMatch(/nothing is traced/i)
    expect(uploads).toHaveLength(0)
    expect(serviceWrites).toHaveLength(0)
  })

  it('prints the exported PAGE\'s own scale on the sheet, not page 1\'s', async () => {
    // Page 2 of a multi-page PDF has its own row in floor_plan_page_scales
    // (00199). The header line used to read floor_plans.pixels_per_meter —
    // page 1's figure — on every page, so a page-2 sheet was issued with the
    // wrong scale printed on it.
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    use(fixture({
      tables: {
        'tenants.floor_plans': [PLAN_ROW],                         // 10 px/m across 5 m — page 1
        'tenants.floor_plan_page_scales': [{ floor_plan_id: PLAN_A, page_index: 2, pixels_per_meter: 20, calibration_metres: 4 }],
        'cable_schedule.revisions': [REV_ROW],
        'projects.projects': [{ name: 'KINGSWALK', code: '643' }],
        'cable_schedule.supply_routes': [{ id: ROUTE_ID, supply_id: SUPPLY_ID, total_length_m: 12 }],
        'cable_schedule.route_segments': [{ route_id: ROUTE_ID, floor_plan_id: PLAN_A, page_index: 2, length_m: 12 }],
        'cable_schedule.supplies': [{ id: SUPPLY_ID, from_node_id: 'n1', to_node_id: 'n2' }],
        'structure.nodes': [{ id: 'n1', code: 'MB 1.1' }, { id: 'n2', code: 'DB-10' }],
      },
    } as any))
    const res = await exportRouteSheetAction({ floorPlanId: PLAN_A, revisionId: REVISION_ID, pageIndex: 2, jpegBase64: JPEG_1PX })
    expect(res.error).toBeUndefined()
    expect(uploads).toHaveLength(1)
    const text = pdfStreamsText(Buffer.from(uploads[0].bytes))
    expect(text).toContain('scale 20.0 px/m (set across 4.00 m)')
    expect(text).not.toContain('scale 10.0 px/m')
    expect(uploads[0].path).toBe(`${ORG_ID}/${PROJECT_ID}/cable-route-sheets/${PLAN_A}-p2-v1.pdf`)
  })

  it('removes the uploaded object when the report row fails to insert — no orphan in the bucket', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    createServiceClientMock.mockReturnValue(fakeService({ insertFails: true }))
    use(sheetFixture())
    const res = await exportRouteSheetAction({ floorPlanId: PLAN_A, revisionId: REVISION_ID, pageIndex: 1, jpegBase64: JPEG_1PX })
    expect(res.error).toMatch(/failed to save report/i)
    expect(uploads).toHaveLength(1)
    expect(removed).toEqual([uploads[0].path])
  })
})

describe('applyRouteToScheduleAction — status follows the grid rule', () => {
  it('promotes only UNMEASURED strands to MEASURED and leaves a CONFIRMED strand alone', async () => {
    // A site-confirmed strand must keep its status: demoting it to MEASURED
    // would flip as-built volt-drop and cost back to the designer's figure.
    use(applyFixture({
      cables: [
        { id: CABLE_1, measured_length_m: EXISTING_M, confirmed_length_m: EXISTING_M, length_status: 'CONFIRMED' },
        { id: CABLE_2, measured_length_m: null, confirmed_length_m: null, length_status: 'UNMEASURED' },
      ],
    } as any))
    const res = await applyRouteToScheduleAction({ supplyId: SUPPLY_ID, confirmOverwrite: true })
    expect(res.error).toBeUndefined()
    const updates = writesTo('cables').filter((w) => w.op === 'update')
    expect(updates).toHaveLength(2)
    // The length write carries no status at all…
    expect(updates[0].payload).not.toHaveProperty('length_status')
    expect(updates[0].payload).toMatchObject({ measured_length_method: 'SCALE_RULE' })
    // …and the status write is scoped to strands that were UNMEASURED.
    expect(updates[1].payload).toEqual({ length_status: 'MEASURED' })
    expect(updates[1].filters).toEqual(expect.arrayContaining([{ col: 'length_status', val: 'UNMEASURED' }]))
  })
})

/* ─────────────── 6. history, concurrency, per-page scale ─────────────── */

describe('saveSupplyRouteAction — trail and guards', () => {
  it('writes one route_history row per save, holding the whole list as stored', async () => {
    use(fixture())
    const res = await saveSupplyRouteAction({ supplyId: SUPPLY_ID, riseM: 1, dropM: 2, segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: [0, 0, 300, 0] }] })
    expect(res.ok).toBe(true)
    const [hist] = writesTo('route_history').filter((w) => w.op === 'insert')
    expect(hist).toBeDefined()
    const p = hist.payload as any
    expect(p).toMatchObject({ route_id: ROUTE_ID, supply_id: SUPPLY_ID, reason: 'save', rise_m: 1, drop_m: 2, saved_by: USER_ID })
    expect(Array.isArray(p.snapshot)).toBe(true)
    expect(p.snapshot[0]).toMatchObject({ seq: 1, floor_plan_id: PLAN_A, length_m: 30, pixels_per_meter: PLAN_A_PPM })
    expect(res.updatedAt).toBeDefined()
  })

  it('refuses to overwrite a route someone else saved since the caller loaded it, and writes nothing', async () => {
    use(fixture({ route: { id: ROUTE_ID, total_length_m: 5, traced_length_m: 5, updated_at: '2026-09-15T10:00:00.000Z' } as any }))
    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID, riseM: 0, dropM: 0, segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: HUNDRED_PX }],
      expectedUpdatedAt: '2026-09-15T09:00:00.000Z',
    })
    expect(res.ok).toBeUndefined()
    expect(res.error).toMatch(/saved by someone else/i)
    expect(res.conflict?.updatedAt).toBe('2026-09-15T10:00:00.000Z')
    expect(writesTo('supply_routes')).toHaveLength(0)
    expect(writesTo('route_segments')).toHaveLength(0)
  })

  it('accepts a save whose token matches the stored updated_at', async () => {
    use(fixture({ route: { id: ROUTE_ID, total_length_m: 5, traced_length_m: 5, updated_at: '2026-09-15T10:00:00.000Z' } as any }))
    const res = await saveSupplyRouteAction({
      supplyId: SUPPLY_ID, riseM: 0, dropM: 0, segments: [{ floorPlanId: PLAN_A, pageIndex: 1, points: HUNDRED_PX }],
      expectedUpdatedAt: '2026-09-15T10:00:00.000Z',
    })
    expect(res.ok).toBe(true)
  })

  it('refuses a leg on page 2 of a drawing with no page-2 scale, naming the page', async () => {
    use(fixture())
    const res = await saveSupplyRouteAction({ supplyId: SUPPLY_ID, riseM: 0, dropM: 0, segments: [{ floorPlanId: PLAN_A, pageIndex: 2, points: HUNDRED_PX }] })
    expect(res.error).toMatch(/page 2/i)
    expect(writesTo('route_segments')).toHaveLength(0)
  })

  it('measures a page-2 leg with the PAGE scale, not the drawing scale', async () => {
    // Drawing scale 10 px/m would give 10.00 m for 100 px; the page-2 scale of
    // 20 px/m gives 5.00 m. Only one of those is the page the leg is on.
    use(fixture({ tables: { 'tenants.floor_plan_page_scales': [{ floor_plan_id: PLAN_A, page_index: 2, pixels_per_meter: 20 }] } } as any))
    const res = await saveSupplyRouteAction({ supplyId: SUPPLY_ID, riseM: 0, dropM: 0, segments: [{ floorPlanId: PLAN_A, pageIndex: 2, points: HUNDRED_PX }] })
    expect(res.error).toBeUndefined()
    const [insert] = writesTo('route_segments').filter((w) => w.op === 'insert')
    expect((insert.payload as any[])[0]).toMatchObject({ page_index: 2, pixels_per_meter: 20, length_m: 5 })
  })
})

describe('restoreRouteHistoryAction — a prior state comes back verbatim', () => {
  it('re-inserts the snapshot as stored, restores rise/drop, and logs the restore', async () => {
    use(fixture({
      route: { id: ROUTE_ID, total_length_m: 5, traced_length_m: 5 },
      tables: {
        'cable_schedule.route_history': [{
          id: '99999999-9999-9999-9999-999999999999', route_id: ROUTE_ID, supply_id: SUPPLY_ID, rise_m: 3, drop_m: 1,
          // Stored under an OLD scale of 8 px/m: restore must keep 8 and 12.5, not re-measure at the drawing's 10.
          snapshot: [{ floor_plan_id: PLAN_A, floor_plan_name: 'A', page_index: 1, points: [0, 0, 100, 0], pixels_per_meter: 8, length_m: 12.5 }],
        }],
      },
    } as any))
    const res = await restoreRouteHistoryAction({ supplyId: SUPPLY_ID, historyId: '99999999-9999-9999-9999-999999999999' })
    expect(res.error).toBeUndefined()
    const [ins] = writesTo('route_segments').filter((w) => w.op === 'insert')
    expect((ins.payload as any[])[0]).toMatchObject({ pixels_per_meter: 8, length_m: 12.5, route_id: ROUTE_ID })
    const [upd] = writesTo('supply_routes').filter((w) => w.op === 'update')
    expect(upd.payload).toMatchObject({ rise_m: 3, drop_m: 1 })
    const [hist] = writesTo('route_history').filter((w) => w.op === 'insert')
    expect(hist.payload).toMatchObject({ reason: 'restore' })
    expect(res.totalM).toBe(16.5)
  })
})

describe('remeasureRouteLegsAction — after a rescale, points stay and lengths follow', () => {
  const stale = { id: 'seg-a', seq: 1, points: [0, 0, 100, 0], pixels_per_meter: 5, length_m: 20, floor_plan_id: PLAN_A, floor_plan_name: 'A', page_index: 1 }
  const fresh = { id: 'seg-b', seq: 2, points: [0, 0, 50, 0], pixels_per_meter: PLAN_A_PPM, length_m: 5, floor_plan_id: PLAN_A, floor_plan_name: 'A', page_index: 1 }

  it('previews before/after for only the legs whose scale differs, writing nothing on a dry run', async () => {
    use(fixture({ route: { id: ROUTE_ID, rise_m: 0, drop_m: 0 }, planSingle: { id: PLAN_A, pixels_per_meter: PLAN_A_PPM }, tables: { 'cable_schedule.route_segments': [stale, fresh] } } as any))
    const res = await remeasureRouteLegsAction({ supplyId: SUPPLY_ID, floorPlanId: PLAN_A, pageIndex: 1, dryRun: true })
    expect(res.preview).toBe(true)
    expect(res.legs).toEqual([{ id: 'seg-a', seq: 1, beforeM: 20, afterM: 10, beforePpm: 5, afterPpm: PLAN_A_PPM }])
    expect(writesTo('route_segments')).toHaveLength(0)
  })

  it('rewrites the stale leg\'s scale and length, leaves the fresh one, and logs a remeasure', async () => {
    use(fixture({ route: { id: ROUTE_ID, rise_m: 0, drop_m: 0 }, planSingle: { id: PLAN_A, pixels_per_meter: PLAN_A_PPM }, tables: { 'cable_schedule.route_segments': [stale, fresh] } } as any))
    const res = await remeasureRouteLegsAction({ supplyId: SUPPLY_ID, floorPlanId: PLAN_A, pageIndex: 1 })
    expect(res.error).toBeUndefined()
    const updates = writesTo('route_segments').filter((w) => w.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ pixels_per_meter: PLAN_A_PPM, length_m: 10 })
    expect(writesTo('route_history').filter((w) => w.op === 'insert')[0].payload).toMatchObject({ reason: 'remeasure' })
  })
})

describe('revertRouteAssignmentAction — the schedule goes back to what it held', () => {
  it('restores each strand\'s prior length from the change log, as MANUAL, and logs the reversal', async () => {
    use(applyFixture({
      tables: {
        'cable_schedule.change_log': [
          { entity_id: CABLE_1, old_value: 99, new_value: 137.25, changed_at: '2026-09-15T01:00:00Z' },
          { entity_id: CABLE_1, old_value: 80, new_value: 99, changed_at: '2026-09-14T01:00:00Z' },   // older: must be ignored
          { entity_id: CABLE_2, old_value: null, new_value: 137.25, changed_at: '2026-09-15T01:00:00Z' },
        ],
      },
    } as any))
    const res = await revertRouteAssignmentAction({ supplyId: SUPPLY_ID })
    expect(res.error).toBeUndefined()
    expect(res.strands).toBe(2)
    const updates = writesTo('cables').filter((w) => w.op === 'update')
    expect(updates).toHaveLength(2)
    expect(updates[0].payload).toMatchObject({ measured_length_m: 99, measured_length_method: 'MANUAL' })
    expect(updates[0].payload).not.toHaveProperty('length_status')
    // A strand that had NO length before goes back to unmeasured, method cleared.
    expect(updates[1].payload).toMatchObject({ measured_length_m: null, measured_length_method: null, length_status: 'UNMEASURED' })
    const [log] = writesTo('change_log').filter((w) => w.op === 'insert')
    expect((log.payload as any[])[0]).toMatchObject({ field_name: 'measured_length_m', new_value: 99, reason: expect.stringMatching(/revert/i) })
  })

  it('refuses when no assignment was ever recorded', async () => {
    use(applyFixture({ tables: { 'cable_schedule.change_log': [] } } as any))
    const res = await revertRouteAssignmentAction({ supplyId: SUPPLY_ID })
    expect(res.error).toMatch(/nothing to revert/i)
    expect(writesTo('cables')).toHaveLength(0)
  })
})

describe('calibrateFloorPlanAction — a page other than 1 has its own scale', () => {
  it('writes page 2 to floor_plan_page_scales and leaves the drawing-level scale alone', async () => {
    requireEffectiveRoleMock.mockReset().mockResolvedValue({ ok: true, role: 'admin' })
    use(fixture({ planSingle: { id: PLAN_A, project_id: PROJECT_ID, organisation_id: ORG_ID } } as any))
    const res = await calibrateAction({ floorPlanId: PLAN_A, points: [0, 0, 250, 0], realMetres: 5, pageIndex: 2 })
    expect(res.ok).toBe(true)
    expect(writesTo('floor_plans')).toHaveLength(0)
    const [up] = writesTo('floor_plan_page_scales').filter((w) => w.op === 'upsert')
    expect(up.payload).toMatchObject({ floor_plan_id: PLAN_A, page_index: 2, pixels_per_meter: 50, calibration_metres: 5 })
    expect((up as any).opts).toMatchObject({ onConflict: 'floor_plan_id,page_index' })
  })
})
