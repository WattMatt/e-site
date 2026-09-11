import { describe, it, expect, vi, beforeEach } from 'vitest'

// ⚠ `server-only` THROWS on import outside the react-server condition, which is
// exactly the condition vitest runs in. This repo already knows it —
// actions/cloud-storage.actions.test.ts:51-52 mocks two services partly to keep
// their `server-only` imports out of the module graph, and every one of the five
// modules that imports it is mocked away rather than imported by a test.
// Under vitest the specifier resolves to src/test/server-only-stub.ts (see
// vitest.config.ts), so this mock is belt-and-braces rather than required; it
// stays so the intent survives a config change. vi.mock is hoisted, so it must
// sit ABOVE the import of the module under test.
vi.mock('server-only', () => ({}))

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ rpc }),
}))

// next/server's after() is passed through to the REAL implementation by
// default: outside a request scope — which is where these tests run — it
// throws, and the writer falls back to running the RPC inline. One test
// overrides it to capture the task and prove the deferred path.
const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn<(task: () => unknown) => void>() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  afterMock.mockImplementation(actual.after as (task: () => unknown) => void)
  return { ...actual, after: afterMock }
})

import { emitProductEvent } from './product-events'

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'evt-1', error: null })
  afterMock.mockClear()
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
    // The real after() was attempted and threw (no request scope), so the
    // RPC ran inline before the promise resolved — which is what the
    // assertion above already relies on.
    expect(afterMock).toHaveBeenCalledTimes(1)
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

  // Inside a request scope after() accepts the task: the RPC must NOT run on
  // the caller's path, and must run — with the same body — when Next fires
  // the task after the response.
  it('inside a request scope, defers the RPC until after() runs the task, with the same body', async () => {
    const captured: Array<() => unknown> = []
    afterMock.mockImplementationOnce((task) => { captured.push(task) })

    await emitProductEvent({
      actorId: 'user-1',
      projectId: 'proj-1',
      event: 'rfi_closed',
      properties: { rfi_id: 'rfi-1' },
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(captured).toHaveLength(1)

    await captured[0]()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('emit_product_event', {
      p_actor_id: 'user-1',
      p_project_id: 'proj-1',
      p_event: 'rfi_closed',
      p_properties: { rfi_id: 'rfi-1' },
      p_session_id: null,
      p_organisation_id: null,
    })
  })
})
