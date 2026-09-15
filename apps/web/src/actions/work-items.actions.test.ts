import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MARKUP_WRITE_ROLES, ORG_WRITE_ROLES } from '@esite/shared'

const { createClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))

import {
  createWorkItemTaskAction,
  reassignWorkItemAction,
  advanceWorkItemStatusAction,
  setWorkItemDueDateAction,
  voidWorkItemAction,
  refuseModuleOwnedEdit,
} from './work-items.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const ITEM    = '44444444-4444-4444-4444-444444444444'
const USER    = '22222222-2222-2222-2222-222222222222'
const OTHER   = '33333333-3333-3333-3333-333333333333'
const THIRD   = '55555555-5555-5555-5555-555555555555'

type Result = { data: any; error: any }

/** A work-item row as the single pre-read returns it. Defaults: a `task`
 *  that is `open`, assigned to OTHER, gatekept by THIRD (so USER is neither). */
function item(overrides: Record<string, unknown> = {}) {
  const row: any = {
    project_id: PROJECT,
    item_type: 'task',
    ref: 'TASK-7',
    status: 'open',
    assignee_id: OTHER,
    gatekeeper_id: THIRD,
    ...overrides,
  }
  // Mirror of the STORED generated column, so a test only states the people.
  if (!('ball_in_court_id' in overrides)) {
    row.ball_in_court_id =
      row.status === 'triage' || row.status === 'open' ? row.assignee_id
      : row.status === 'answered' ? row.gatekeeper_id
      : null
  }
  return row
}

/** `row` is whatever the single pre-read returns: the project row for create,
 *  the work-item row for every other verb. `eqSpy` sees every `.eq` on the
 *  UPDATE chain, in order. */
function client(
  insertSpy = vi.fn(),
  updateSpy = vi.fn(),
  row: any = { organisation_id: 'org-1' },
  opts: { insert?: Result; update?: Result; eqSpy?: ReturnType<typeof vi.fn> } = {},
) {
  const insertResult = opts.insert ?? { data: { id: 'wi-1', ref: 'TASK-1' }, error: null }
  const updateResult = opts.update ?? { data: { id: 'wi-1' }, error: null }
  const eqSpy = opts.eqSpy ?? vi.fn()
  const builder: any = {
    insert: (v: any) => { insertSpy(v); return { select: () => ({ single: async () => insertResult }) } },
    update: (v: any) => {
      updateSpy(v)
      const chain: any = {
        eq: (col: string, val: unknown) => { eqSpy(col, val); return chain },
        select: () => ({ maybeSingle: async () => updateResult }),
      }
      return chain
    },
    select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    schema: () => ({ from: () => builder }),
    from: () => builder,
  }
}

const DENIED = { ok: false, error: 'Your role (client_viewer) is not allowed to perform this action' }
const ALLOWED_PM = { ok: true, role: 'project_manager' }

beforeEach(() => { vi.clearAllMocks(); createClientMock.mockResolvedValue(client()) })

describe('createWorkItemTaskAction', () => {
  it('refuses a client_viewer', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(r.error).toMatch(/not allowed/)
  })

  it('refuses an inspector', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (inspector) is not allowed to perform this action' })
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(r.error).toBeTruthy()
  })

  it('forces created_by, item_type, origin, status and gatekeeper, and forwards no source FK, ref, stamp or date', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'contractor' })
    await createWorkItemTaskAction({
      projectId: PROJECT, title: 'x', assigneeId: OTHER,
      // a hostile client payload — every column §9's insert gate would refuse,
      // plus the ones it cannot pin and the guard makes immutable
      ...({
        created_by: OTHER, gatekeeper_id: OTHER, status: 'closed', origin: 'mirror',
        item_type: 'rfi', ref: 'RFI-1', ball_in_court_id: OTHER,
        rfi_id: 'r', snag_id: 's', qc_entry_id: 'q', diary_id: 'd',
        site_form_id: 'f', node_order_id: 'n', inspection_id: 'i',
        opened_at: '2020-01-01', created_at: '2020-01-01',
        closed_at: '2020-01-01', closed_by: OTHER, void_reason: 'x',
      } as any),
    } as any)
    const payload = insertSpy.mock.calls[0][0]
    expect(payload.created_by).toBe(USER)
    expect(payload.gatekeeper_id).toBe(USER)   // A(b): task's gatekeeper is the creator
    expect(payload.assignee_id).toBe(OTHER)
    expect(payload.item_type).toBe('task')
    // §9 (c): the column DEFAULTS to 'mirror'; the action says 'manual' itself.
    expect(payload.origin).toBe('manual')
    // §03 §1.6 — an item created WITH an explicit assignee is born open, so a
    // PM-created task does not land in the Triage filter and dilute the metric.
    expect(payload.status).toBe('open')
    for (const col of [
      'rfi_id', 'snag_id', 'qc_entry_id', 'diary_id', 'site_form_id', 'node_order_id', 'inspection_id',
      'ref', 'ball_in_court_id', 'due_date',
      'opened_at', 'created_at', 'closed_at', 'closed_by', 'void_reason',
    ]) {
      expect(payload, col).not.toHaveProperty(col)
    }
  })

  it('gates on the PROJECT role with the task write set (the registry\'s MARKUP_WRITE_ROLES)', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, MARKUP_WRITE_ROLES)
  })

  it('passes a supplied due date through — "by Friday" must not become next Thursday', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER, dueDate: '2026-10-02' })
    expect(insertSpy.mock.calls[0][0].due_date).toBe('2026-10-02')
  })

  it('accepts every registry priority and nothing else', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    for (const priority of ['low', 'medium', 'high', 'critical'] as const) {
      await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER, priority })
    }
    expect(insertSpy.mock.calls.map((c) => c[0].priority)).toEqual(['low', 'medium', 'high', 'critical'])
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER, priority: 'urgent' as any })
    expect(r.error).toBeTruthy()
    expect(insertSpy).toHaveBeenCalledTimes(4)
  })

  it('requires an assignee — a manual task is always born with a named person', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x' } as any)
    expect(r.error).toBeTruthy()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('does not pre-validate the assignee — the membership trigger is the last word and its sentence is returned verbatim', async () => {
    const sentence = 'The person you are assigning this to is not on this project. Add them first.'
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), { organisation_id: 'org-1' }, {
      insert: { data: null, error: { message: sentence, code: 'P0001' } },
    }))
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: OTHER })
    expect(r.error).toBe(sentence)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

// ─── the write set is the REGISTRY's, resolved by the row's item_type ────────
// Replacing writeRolesFor(item.item_type) with ORG_WRITE_ROLES in any verb
// would silently take "move" and "drop" away from a non-holder contractor on
// every task (contractor ∈ MARKUP_WRITE_ROLES, ∉ ORG_WRITE_ROLES).

const WRITE_SET_VERBS = [
  ['reassignWorkItemAction',      () => reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })],
  ['advanceWorkItemStatusAction', () => advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })],
  ['voidWorkItemAction',          () => voidWorkItemAction({ workItemId: ITEM, reason: 'duplicate' })],
] as const

describe.each(WRITE_SET_VERBS)('%s resolves the write set from the registry', (_name, call) => {
  it('task → MARKUP_WRITE_ROLES', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ item_type: 'task' })))
    await call()
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, MARKUP_WRITE_ROLES)
  })

  it('inspection → ORG_WRITE_ROLES', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ item_type: 'inspection' })))
    await call()
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, ORG_WRITE_ROLES)
  })

  it('an unregistered item_type → [] (fails closed)', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ item_type: 'not_a_type' })))
    await call()
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, [])
  })
})

// ─── every UPDATE is conditioned on the status the decision was made from ────
// Without the second .eq a governing actor whose row flipped open → answered
// between the pre-read and the write would change the ASSIGNEE of an answered
// item — ball-in-court unchanged, `reassigned` evented, reported ok.

const UPDATE_VERBS = [
  ['reassignWorkItemAction',      'triage',   () => reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })],
  ['advanceWorkItemStatusAction', 'open',     () => advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })],
  ['setWorkItemDueDateAction',    'answered', () => setWorkItemDueDateAction({ workItemId: ITEM, dueDate: '2026-10-02' })],
  ['voidWorkItemAction',          'open',     () => voidWorkItemAction({ workItemId: ITEM, reason: 'duplicate' })],
] as const

describe.each(UPDATE_VERBS)('%s filters the write on the pre-read status', (_name, status, call) => {
  it(`writes only a row still in "${status}"`, async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const eqSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ status }), { eqSpy }))
    const r = await call()
    expect(r.error).toBeUndefined()
    expect(eqSpy.mock.calls).toEqual([['id', ITEM], ['status', status]])
  })
})

describe('reassignWorkItemAction', () => {
  it('writes assignee_id while triage or open and gatekeeper_id while answered', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)

    let updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'triage' })))
    await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(updateSpy.mock.calls[0][0]).toEqual({ assignee_id: OTHER })

    updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open' })))
    await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(updateSpy.mock.calls[0][0]).toEqual({ assignee_id: OTHER })

    updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'answered' })))
    await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(updateSpy.mock.calls[0][0]).toEqual({ gatekeeper_id: OTHER })
  })

  it('refuses to write either column on a closed item, with the guard\'s own sentence', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'closed' })))
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBe('TASK-7 is closed. Reopen it before changing who it belongs to.')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('refuses a caller without the type write role — even the current holder — without touching the database', async () => {
    // Not the plan's "admits the holder". A bare holder's hand-off passes the
    // BEFORE UPDATE guard (v_is_holder) and is THEN refused by §9's RESTRICTIVE
    // update gate — RLS WITH CHECK runs after the row triggers — because the
    // actor is no longer assignee or gatekeeper on the new row (42501).
    // Admitting them here would only swap the role sentence for a raw
    // "new row violates row-level security policy".
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toMatch(/not allowed/)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  // 00199 option (a): the three module-owned refusals. The role gate is mocked
  // OPEN in both, so it is the type refusal — not authorisation — that answers;
  // delete the refusal and each test reaches updateItem and returns ok.
  it('refuses an inspection item in the ASSIGNEE arm (triage/open) — the Inspections module owns the column', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(
      client(vi.fn(), updateSpy, item({ item_type: 'inspection', ref: 'INSP-4', status: 'open' })),
    )
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBe(
      'Inspections are assigned from the Inspections module — change the inspector or verifier there.',
    )
    expect(r.ok).toBeUndefined()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('refuses an inspection item in the GATEKEEPER arm (answered) with the same sentence — the verifier is module-owned too', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(
      client(vi.fn(), updateSpy, item({ item_type: 'inspection', ref: 'INSP-4', status: 'answered' })),
    )
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBe(
      'Inspections are assigned from the Inspections module — change the inspector or verifier there.',
    )
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does NOT refuse the types the spine owns — an rfi item still reassigns', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(
      client(vi.fn(), updateSpy, item({ item_type: 'rfi', ref: 'RFI-1', status: 'open' })),
    )
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.ok).toBe(true)
    expect(updateSpy.mock.calls[0][0]).toEqual({ assignee_id: OTHER })
  })

  it('returns the transition guard\'s sentence verbatim — it is the copy the user sees', async () => {
    const sentence = "Only the project's owners, admins or project managers can change who signs TASK-7 off."
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'contractor' })
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ status: 'answered' }), {
      update: { data: null, error: { message: sentence, code: 'P0001' } },
    }))
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBe(sentence)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('refuseModuleOwnedEdit — the third 00199 refusal, which has no verb yet', () => {
  // Q1 ships no priority verb (item 2 shipped five: create, reassign, advance,
  // due date, void), so the qc_defect sentence is exported rather than wired
  // into an action. The Inbox's priority control (§04, items 5/6) calls this so
  // there is exactly one copy of the wording.
  it('names a qc_defect priority edit as module-owned, with the sentence pointing at the QC report', async () => {
    await expect(refuseModuleOwnedEdit('qc_defect', 'priority')).resolves.toBe(
      "A QC defect's priority follows its severity in the QC report — change the severity there.",
    )
  })

  it('refuses only what the source module owns — every other pair is the spine\'s', async () => {
    // inspection PEOPLE are module-owned; an inspection's priority is not
    // (00199 files it `medium` once and never re-reads it).
    await expect(refuseModuleOwnedEdit('inspection', 'people')).resolves.toMatch(/Inspections module/)
    await expect(refuseModuleOwnedEdit('inspection', 'priority')).resolves.toBeNull()
    // qc_defect PRIORITY is module-owned; its people are the spine's.
    await expect(refuseModuleOwnedEdit('qc_defect', 'people')).resolves.toBeNull()
    for (const key of ['rfi', 'snag', 'diary_action', 'form_action', 'task', 'order_followup']) {
      expect(await refuseModuleOwnedEdit(key, 'people'), key).toBeNull()
      expect(await refuseModuleOwnedEdit(key, 'priority'), key).toBeNull()
    }
    // An unregistered key is not a module-owned edit either — it fails closed
    // at the write-set gate, not here.
    await expect(refuseModuleOwnedEdit('not_a_type', 'people')).resolves.toBeNull()
  })
})

describe('advanceWorkItemStatusAction', () => {
  it('lets the ball-in-court holder move their own item forward', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })
    expect(r.error).toBeUndefined()
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'answered' })
  })

  it('refuses a bystander with no write role and no ball', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open' })))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('accepts only open, answered and closed — void goes through voidWorkItemAction', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'void' as any })
    expect(r.error).toBeTruthy()
  })

  it('a move to the status the item already holds is a no-op — ok, no write, no revalidate', async () => {
    // The guard's machine has no same-state arm; a write would only bump
    // last_activity_at for nothing. Still gated: a bystander gets the sentence.
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'open' })
    expect(r).toEqual({ ok: true })
    expect(updateSpy).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()

    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open' })))
    const bystander = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'open' })
    expect(bystander.error).toMatch(/not allowed/)
  })

  it('reopen (closed → open): admits the closing gatekeeper without a write role, refuses anyone else without one', async () => {
    // §12 (c2): a closed row has no ball-in-court, so the holder arm can never
    // admit a reopen; the DB admits a write role OR the gatekeeper who closed.
    requireEffectiveRoleMock.mockResolvedValue(DENIED)

    let updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'closed', gatekeeper_id: USER })))
    let r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'open' })
    expect(r.error).toBeUndefined()
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'open' })

    updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'closed', assignee_id: USER })))
    r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'open' })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does not pre-empt the close — the guard decides, and its sentence comes back verbatim', async () => {
    const sentence = 'Only the person who signs TASK-7 off can close it. Take it over first, or ask them to close it.'
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'answered' }), {
      update: { data: null, error: { message: sentence, code: 'P0001' } },
    }))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'closed' })
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'closed' })
    expect(r.error).toBe(sentence)
  })

  it('reports a zero-row update as an error, never as success', async () => {
    // A client_viewer assignee passes the holder arm here and is refused
    // silently by §9's RESTRICTIVE gate; a row that moved on between the
    // pre-read and the write misses the status filter the same way. PostgREST
    // matches zero rows and raises nothing (the E8 failure class). The action
    // asserts rows affected.
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    createClientMock.mockResolvedValue(client(vi.fn(), vi.fn(), item({ status: 'open', assignee_id: USER }), {
      update: { data: null, error: null },
    }))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })
    expect(r.ok).toBeUndefined()
    expect(r.error).toMatch(/Nothing was changed/)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('voidWorkItemAction', () => {
  it('requires a non-blank reason before the database is touched', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item()))
    for (const reason of ['', '  ', '\n\t']) {
      const r = await voidWorkItemAction({ workItemId: ITEM, reason })
      expect(r.error, JSON.stringify(reason)).toMatch(/needs a short reason/)
    }
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('accepts a one-character reason — the rule is non-blank, not a minimum length', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item()))
    const r = await voidWorkItemAction({ workItemId: ITEM, reason: ' x ' })
    expect(r.error).toBeUndefined()
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'void', void_reason: 'x' })
  })

  it('writes the status and the reason together', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item()))
    await voidWorkItemAction({ workItemId: ITEM, reason: 'raised in error' })
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'void', void_reason: 'raised in error' })
  })

  it('admits the current holder without a write role (the guard\'s v_may_manage) and refuses a bystander', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)

    let updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    let r = await voidWorkItemAction({ workItemId: ITEM, reason: 'duplicate' })
    expect(r.error).toBeUndefined()
    expect(updateSpy).toHaveBeenCalledTimes(1)

    updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open' })))
    r = await voidWorkItemAction({ workItemId: ITEM, reason: 'duplicate' })
    expect(r.error).toMatch(/not allowed/)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe('setWorkItemDueDateAction', () => {
  it('refuses a contractor — a due date is a management decision (§13 item 2)', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    const r = await setWorkItemDueDateAction({ workItemId: ITEM, dueDate: '2026-10-02' })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, ORG_WRITE_ROLES)
  })

  it('writes the date', async () => {
    requireEffectiveRoleMock.mockResolvedValue(ALLOWED_PM)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, item({ status: 'open', assignee_id: USER })))
    await setWorkItemDueDateAction({ workItemId: ITEM, dueDate: '2026-10-02' })
    expect(updateSpy.mock.calls[0][0]).toEqual({ due_date: '2026-10-02' })
  })
})
