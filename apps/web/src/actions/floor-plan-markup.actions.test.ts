// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * floor-plan-markup.actions.ts — saved markup layers on a drawing.
 *
 * THE HEADLINE TEST IS THE ROUND TRIP. The owner's question was "will marked-up
 * items load in exactly the same position after being saved and opened again",
 * and until now nothing in this repo asserted that about anything. A test that
 * checked "a scene came back" would pass while every coordinate was mangled —
 * the same vacuous shape as the latin1 PDF extractor and the 1x1-PNG fixture.
 * So the fixture below is built to be ABLE to fail:
 *
 *   - coordinates are non-integer (612.375), so a round through a 32-bit float
 *     or an accidental Math.round shows up;
 *   - one is negative (-0.5), so an abs() or a clamp shows up;
 *   - rotation is fractional and negative;
 *   - shapes sit on DIFFERENT pages, so a flatten-to-page-1 shows up;
 *   - the scene has more than one shape, so an off-by-one slice shows up.
 *
 * The assertion is on deep equality of the points themselves, not on the scene
 * being truthy.
 *
 * The other two invariants are the ones a client must not be able to override:
 * `file_path` is stamped from the DRAWING (it is the anchor that later says
 * "this was drawn on an older revision"), and `organisation_id` / `project_id`
 * are never sent at all, because 00205's bind trigger derives them. A test that
 * asserted the action sends the right org would be asserting the wrong design.
 */

const { createClientMock, revalidatePathMock, requireEffectiveRoleMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a),
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

import {
  saveFloorPlanMarkupAction,
  listFloorPlanMarkupsAction,
  renameFloorPlanMarkupAction,
  deleteFloorPlanMarkupAction,
} from './floor-plan-markup.actions'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const PLAN_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const MARKUP_ID = '44444444-4444-4444-4444-444444444444'

/**
 * A scene whose every number is chosen so a lossy round trip is visible.
 * See the file header for why each one is what it is.
 */
const AWKWARD_SCENE = {
  version: 1,
  canvas: { w: 3370, h: 2384 },
  pageCount: 3,
  shapes: [
    { id: 's1', type: 'polyline', color: '#dc2626', pageIndex: 1, points: [612.375, -0.5, 1024.125, 2383.9375] },
    { id: 's2', type: 'rect', color: '#f59e0b', pageIndex: 3, x: 0.125, y: 1199.0625, width: 44.5, height: 0.75, rotation: -12.25 },
    { id: 's3', type: 'text', color: '#dc2626', pageIndex: 2, x: 2048.5, y: 96.125, text: 'DB 3.1 → MB 5.3' },
  ],
}

type Fixture = {
  plan: { id: string; project_id: string; file_path: string; source_revision_id: string | null } | null
  markups: any[]
  /** Force the write to fail with this postgrest error. */
  writeError?: { code?: string; message: string }
  /** Return zero rows from the write, as RLS does when it refuses silently. */
  writeReturnsNoRow?: boolean
}

let writes: Array<{ table: string; op: string; payload: any }> = []

function makeClient(fx: Fixture) {
  function builder(table: string) {
    let op = 'select'
    let payload: any
    const b: any = {
      select: () => b,
      eq: () => b,
      order: () => b,
      insert: (p: any) => { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); return b },
      update: (p: any) => { op = 'update'; payload = p; writes.push({ table, op, payload: p }); return b },
      delete: () => { op = 'delete'; writes.push({ table, op, payload: undefined }); return b },
      maybeSingle: async () => {
        if (table === 'floor_plans') return { data: fx.plan, error: null }
        if (op === 'select') return { data: fx.markups[0] ?? null, error: null }
        if (fx.writeError) return { data: null, error: fx.writeError }
        if (fx.writeReturnsNoRow) return { data: null, error: null }
        // Echo what the caller wrote, the way `.select()` after a write does.
        return {
          data: {
            id: MARKUP_ID,
            name: payload?.name ?? fx.markups[0]?.name,
            scene: payload?.scene ?? fx.markups[0]?.scene,
            file_path: payload?.file_path ?? fx.markups[0]?.file_path,
            source_revision_id: payload?.source_revision_id ?? null,
            updated_at: '2026-09-21T10:00:00.000Z',
            updated_by: USER_ID,
            project_id: PROJECT_ID,
            floor_plan_id: PLAN_ID,
          },
          error: null,
        }
      },
      then: (resolve: any) => resolve({ data: fx.markups, error: null }),
    }
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    schema: () => ({ from: (t: string) => builder(t) }),
    from: (t: string) => builder(t),
  }
}

const PLAN = { id: PLAN_ID, project_id: PROJECT_ID, file_path: 'org/proj/643-E-110-rev-C.pdf', source_revision_id: 'rev-C' }

beforeEach(() => {
  writes = []
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'contractor' })
})

describe('a saved markup reopens in exactly the position it was saved', () => {
  it('round-trips every coordinate unchanged, across pages', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))

    const saved = await saveFloorPlanMarkupAction({
      floorPlanId: PLAN_ID,
      name: 'Cable pull route A',
      scene: AWKWARD_SCENE,
    })
    expect(saved.error).toBeUndefined()

    // What actually went to the database, not what the action returned.
    const insert = writes.find((w) => w.op === 'insert')
    expect(insert, 'the action wrote nothing').toBeDefined()

    // Simulate the row coming back out on a later page load.
    createClientMock.mockResolvedValue(
      makeClient({
        plan: PLAN,
        markups: [{
          id: MARKUP_ID,
          name: 'Cable pull route A',
          scene: insert!.payload.scene,
          file_path: insert!.payload.file_path,
          source_revision_id: insert!.payload.source_revision_id,
          updated_at: '2026-09-21T10:00:00.000Z',
          updated_by: USER_ID,
        }],
      }),
    )
    const { markups } = await listFloorPlanMarkupsAction({ floorPlanId: PLAN_ID })
    const reopened = markups![0].scene

    // The whole point. Deep equality on the geometry, not "a scene exists".
    expect(reopened).toEqual(AWKWARD_SCENE)
    expect((reopened.shapes[0] as any).points).toEqual([612.375, -0.5, 1024.125, 2383.9375])
    expect((reopened.shapes[1] as any).rotation).toBe(-12.25)
    expect(reopened.shapes.map((s: any) => s.pageIndex)).toEqual([1, 3, 2])
    expect(reopened.canvas).toEqual({ w: 3370, h: 2384 })
  })

  it('the fixture can actually fail — a perturbed coordinate is caught', () => {
    const mangled = JSON.parse(JSON.stringify(AWKWARD_SCENE))
    mangled.shapes[0].points[0] = 612.875 // half a pixel
    expect(mangled).not.toEqual(AWKWARD_SCENE)
    // And a rounding pass, which is the realistic corruption:
    const rounded = JSON.parse(JSON.stringify(AWKWARD_SCENE))
    rounded.shapes[0].points = rounded.shapes[0].points.map(Math.round)
    expect(rounded).not.toEqual(AWKWARD_SCENE)
  })
})

describe('what the client does not get to decide', () => {
  it('stamps file_path from the drawing, ignoring anything the caller sends', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))
    await saveFloorPlanMarkupAction({
      floorPlanId: PLAN_ID,
      name: 'A',
      scene: AWKWARD_SCENE,
      // A caller trying to claim a different anchor:
      file_path: 'somewhere/else.pdf',
      source_revision_id: 'rev-Z',
    } as any)

    const insert = writes.find((w) => w.op === 'insert')!
    expect(insert.payload.file_path).toBe(PLAN.file_path)
    expect(insert.payload.source_revision_id).toBe('rev-C')
  })

  it('never sends organisation_id or project_id — 00205 binds them by trigger', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))
    await saveFloorPlanMarkupAction({
      floorPlanId: PLAN_ID,
      name: 'A',
      scene: AWKWARD_SCENE,
      organisation_id: 'ffffffff-0000-0000-0000-000000000001',
      project_id: 'ffffffff-0000-0000-0000-000000000002',
    } as any)

    const insert = writes.find((w) => w.op === 'insert')!
    expect(insert.payload).not.toHaveProperty('organisation_id')
    expect(insert.payload).not.toHaveProperty('project_id')
  })
})

describe('staleness against the drawing', () => {
  it('flags a markup drawn on a file the drawing no longer serves', async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        plan: { ...PLAN, file_path: 'org/proj/643-E-110-rev-D.pdf', source_revision_id: 'rev-D' },
        markups: [{
          id: MARKUP_ID, name: 'A', scene: AWKWARD_SCENE,
          file_path: 'org/proj/643-E-110-rev-C.pdf', source_revision_id: 'rev-C',
          updated_at: '2026-09-21T10:00:00.000Z', updated_by: USER_ID,
        }],
      }),
    )
    const { markups } = await listFloorPlanMarkupsAction({ floorPlanId: PLAN_ID })
    expect(markups![0].staleAgainstDrawing).toBe(true)
  })

  it('does not flag one drawn on the file still being served', async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        plan: PLAN,
        markups: [{
          id: MARKUP_ID, name: 'A', scene: AWKWARD_SCENE,
          file_path: PLAN.file_path, source_revision_id: 'rev-C',
          updated_at: '2026-09-21T10:00:00.000Z', updated_by: USER_ID,
        }],
      }),
    )
    const { markups } = await listFloorPlanMarkupsAction({ floorPlanId: PLAN_ID })
    expect(markups![0].staleAgainstDrawing).toBe(false)
  })
})

describe('refusals', () => {
  it('refuses a stale overwrite rather than merging it', async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        plan: PLAN,
        markups: [{ updated_at: '2026-09-21T11:30:00.000Z', name: 'Cable pull route A' }],
      }),
    )
    const res = await saveFloorPlanMarkupAction({
      floorPlanId: PLAN_ID,
      markupId: MARKUP_ID,
      name: 'Cable pull route A',
      scene: AWKWARD_SCENE,
      expectedUpdatedAt: '2026-09-21T10:00:00.000Z',
    })
    expect(res.error).toMatch(/saved by someone else/)
    expect(res.conflict?.updatedAt).toBe('2026-09-21T11:30:00.000Z')
    expect(writes.some((w) => w.op === 'update'), 'a stale write must not reach the database').toBe(false)
  })

  it('refuses a caller outside MARKUP_WRITE_ROLES', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await saveFloorPlanMarkupAction({ floorPlanId: PLAN_ID, name: 'A', scene: AWKWARD_SCENE })
    expect(res.error).toMatch(/do not have permission/)
    expect(writes.length, 'a refused caller must not reach the database').toBe(0)
  })

  it('gates on MARKUP_WRITE_ROLES, which includes contractor', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))
    await saveFloorPlanMarkupAction({ floorPlanId: PLAN_ID, name: 'A', scene: AWKWARD_SCENE })
    const roles = requireEffectiveRoleMock.mock.calls[0][2] as string[]
    expect(roles).toContain('contractor')
    expect(roles).not.toContain('client_viewer')
    expect(roles).not.toContain('inspector')
  })

  it('turns a duplicate name into an instruction, not a constraint name', async () => {
    createClientMock.mockResolvedValue(
      makeClient({ plan: PLAN, markups: [], writeError: { code: '23505', message: 'duplicate key value violates unique constraint "floor_plan_markups_plan_name_key"' } }),
    )
    const res = await saveFloorPlanMarkupAction({ floorPlanId: PLAN_ID, name: 'Route A', scene: AWKWARD_SCENE })
    expect(res.error).toMatch(/already has a markup called "Route A"/)
    expect(res.error).not.toMatch(/constraint/)
  })

  it('reports a silent RLS refusal instead of claiming success', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [], writeReturnsNoRow: true }))
    const res = await saveFloorPlanMarkupAction({ floorPlanId: PLAN_ID, name: 'A', scene: AWKWARD_SCENE })
    expect(res.markup).toBeUndefined()
    expect(res.error).toMatch(/Nothing was saved/)
  })

  it('refuses a blank name', async () => {
    createClientMock.mockResolvedValue(makeClient({ plan: PLAN, markups: [] }))
    const res = await saveFloorPlanMarkupAction({ floorPlanId: PLAN_ID, name: '   ', scene: AWKWARD_SCENE })
    expect(res.error).toMatch(/name/i)
    expect(writes.length).toBe(0)
  })
})

describe('rename and delete', () => {
  it('renames through the same role gate', async () => {
    createClientMock.mockResolvedValue(
      makeClient({ plan: PLAN, markups: [{ project_id: PROJECT_ID, floor_plan_id: PLAN_ID }] }),
    )
    const res = await renameFloorPlanMarkupAction({ markupId: MARKUP_ID, name: 'Renamed' })
    expect(res.ok).toBe(true)
    expect(requireEffectiveRoleMock.mock.calls[0][2]).toContain('contractor')
  })

  it('refuses a delete from a caller the gate rejects', async () => {
    createClientMock.mockResolvedValue(
      makeClient({ plan: PLAN, markups: [{ project_id: PROJECT_ID, floor_plan_id: PLAN_ID }] }),
    )
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access' })
    const res = await deleteFloorPlanMarkupAction({ markupId: MARKUP_ID })
    expect(res.error).toMatch(/do not have permission/)
    expect(writes.some((w) => w.op === 'delete')).toBe(false)
  })
})
