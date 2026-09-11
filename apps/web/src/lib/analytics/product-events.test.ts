import { describe, it, expect, vi, beforeEach } from 'vitest'

// ⚠ `server-only` THROWS on import outside the react-server condition, which is
// exactly the condition vitest runs in. This repo already knows it —
// actions/cloud-storage.actions.test.ts:51-52 mocks two services partly to keep
// their `server-only` imports out of the module graph, and every one of the five
// modules that imports it is mocked away rather than imported by a test.
// (Under vitest the specifier resolves to src/test/server-only-stub.ts — see
// vitest.config.ts — which is what makes this mock resolvable at all.)
// vi.mock is hoisted, so this must sit ABOVE the import of the module under test.
vi.mock('server-only', () => ({}))

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ rpc }),
}))

import { emitProductEvent } from './product-events'

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'evt-1', error: null })
})

describe('emitProductEvent', () => {
  it('forwards the six stamped arguments to the RPC', async () => {
    await emitProductEvent({
      actorId: 'user-1',
      projectId: 'proj-1',
      event: 'rfi_created',
      properties: { assignee_source: 'project_default' },
    })
    expect(rpc).toHaveBeenCalledWith('emit_product_event', {
      p_actor_id: 'user-1',
      p_project_id: 'proj-1',
      p_event: 'rfi_created',
      p_properties: { assignee_source: 'project_default' },
      p_session_id: null,
      p_organisation_id: null,
    })
  })

  it('accepts a null project with an explicit organisation — the project_deleted case', async () => {
    await emitProductEvent({
      actorId: 'user-1',
      projectId: null,
      organisationId: 'org-1',
      event: 'project_deleted',
      properties: { project_id: 'gone' },
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_project_id: null, p_organisation_id: 'org-1' })
  })

  // JSON.stringify DROPS an undefined value, so an undefined projectId would
  // send a body with no p_project_id key at all. PostgREST answers 404
  // "could not find the function" for a missing argument with no default —
  // which this helper swallows and logs, silently losing every event from
  // that call site. Coerce at the boundary AND default in SQL.
  it('coerces an undefined project or organisation to null, never a dropped key', async () => {
    await emitProductEvent({
      actorId: 'u',
      projectId: undefined as unknown as string | null,
      event: 'marketplace_order_placed',
    })
    const body = rpc.mock.calls[0][1] as Record<string, unknown>
    expect('p_project_id' in body).toBe(true)
    expect(body.p_project_id).toBeNull()
    expect(body.p_organisation_id).toBeNull()
  })

  // The marketplace_order_placed call site (supplier.actions.ts) passes the
  // buyer's organisation ONLY when there is no project:
  //   organisationId: projectId ? undefined : mem.organisation_id
  // because emit_product_event RAISES when a supplied p_organisation_id
  // disagrees with the project's organisation — and an order placed against a
  // project owned by another org than the buyer's membership org would then be
  // swallowed-and-logged instead of recorded. With a project the org is the
  // PROJECT's, resolved server-side; the body must carry p_organisation_id: null.
  it('marketplace_order_placed with a project sends p_organisation_id null; without one, the buyer org', async () => {
    const withProject: string | undefined = 'proj-1'
    await emitProductEvent({
      actorId: 'u',
      projectId: withProject ?? null,
      organisationId: withProject ? undefined : 'org-1',
      event: 'marketplace_order_placed',
      properties: { order_id: 'o-1' },
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_project_id: 'proj-1', p_organisation_id: null })

    const withoutProject: string | undefined = undefined
    await emitProductEvent({
      actorId: 'u',
      projectId: withoutProject ?? null,
      organisationId: withoutProject ? undefined : 'org-1',
      event: 'marketplace_order_placed',
      properties: { order_id: 'o-2' },
    })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_project_id: null, p_organisation_id: 'org-1' })
  })

  // The bell path swallows failures by design and this must too: a metric
  // must never be able to fail a user's write.
  it('never throws when the RPC errors, but logs it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(
      emitProductEvent({ actorId: 'u', projectId: 'p', event: 'rfi_created' }),
    ).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('never throws when the client itself throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockRejectedValue(new Error('network'))
    await expect(
      emitProductEvent({ actorId: 'u', projectId: 'p', event: 'rfi_created' }),
    ).resolves.toBeUndefined()
    err.mockRestore()
  })

  it('refuses an unregistered event key at the type level and at runtime', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    // @ts-expect-error — not a member of PRODUCT_EVENTS
    await emitProductEvent({ actorId: 'u', projectId: 'p', event: 'made_up' })
    expect(rpc).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('unregistered'), expect.anything())
    err.mockRestore()
  })
})
