import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  classifyRemoteError,
  drainOnce,
  enqueueResponse,
  enqueueSubmit,
  ensureOutboxSchema,
  listForInspection,
  mergeOutboxIntoResponses,
  toResponseValues,
  type OutboxItem,
  type OutboxRemote,
  type ResponseOutboxItem,
  type SubmitOutboxItem,
  type RemoteError,
  type ResponseValues,
} from '../response-outbox'
import { createSqliteExecutor } from './sqlite-executor'

const ME = 'user-me'
const OTHER = 'user-other'
const INSP = 'insp-1'
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0)

const blank: ResponseValues = {
  value_bool: null,
  value_number: null,
  value_text: null,
  value_array: null,
  value_json: null,
  pass_state: null,
  fail_reason: null,
}

type Call =
  | { kind: 'response'; inspectionId: string; sectionId: string; fieldId: string; values: ResponseValues; respondedBy: string }
  | { kind: 'submit'; inspectionId: string; completedAt: string }

function recordingRemote(script: Array<RemoteError | null> = []) {
  const calls: Call[] = []
  const next = () => (script.length ? script.shift()! : null)
  const remote: OutboxRemote = {
    async upsertResponse(i) {
      calls.push({ kind: 'response', inspectionId: i.inspectionId, sectionId: i.sectionId, fieldId: i.fieldId, values: i.values, respondedBy: i.respondedBy })
      return next()
    },
    async submitInspection(i) {
      calls.push({ kind: 'submit', inspectionId: i.inspectionId, completedAt: i.completedAt })
      return next()
    },
  }
  return { remote, calls }
}

let db: ReturnType<typeof createSqliteExecutor>

function asResponse(item: OutboxItem): ResponseOutboxItem {
  if (item.kind !== 'response') throw new Error(`expected a response row, got ${item.kind}`)
  return item
}
function asSubmit(item: OutboxItem): SubmitOutboxItem {
  if (item.kind !== 'submit') throw new Error(`expected a submit row, got ${item.kind}`)
  return item
}

beforeEach(async () => {
  db = createSqliteExecutor()
  await ensureOutboxSchema(db)
})
afterEach(() => db.close())

function answer(fieldId: string, values: Partial<ResponseValues>, responderId = ME, inspectionId = INSP) {
  return enqueueResponse(db, {
    inspectionId,
    sectionId: 's1',
    fieldId,
    responderId,
    values: { ...blank, ...values },
    respondedAt: new Date(T0).toISOString(),
  })
}

describe('enqueueResponse', () => {
  it('keeps only the newest answer per field, as a full row', async () => {
    await answer('f1', { pass_state: 'fail' })
    await answer('f1', { pass_state: 'fail', fail_reason: 'loose terminal' })

    const items = await listForInspection(db, INSP)
    expect(items).toHaveLength(1)
    expect(asResponse(items[0]).values).toEqual({ ...blank, pass_state: 'fail', fail_reason: 'loose terminal' })
    expect(items[0].status).toBe('pending')
  })

  it('round-trips arrays, JSON and booleans with their types', async () => {
    await answer('f1', { value_array: ['a', 'b'], value_json: { k: 1 }, value_bool: false, value_number: 0.5 })
    const item = asResponse((await listForInspection(db, INSP))[0])
    expect(item.values.value_array).toEqual(['a', 'b'])
    expect(item.values.value_json).toEqual({ k: 1 })
    expect(item.values.value_bool).toBe(false)
    expect(item.values.value_number).toBe(0.5)
  })

  it('a new answer replaces a refused one and is retried', async () => {
    await answer('f1', { value_text: 'x' })
    const { remote } = recordingRemote([{ status: 403, code: '42501', message: 'row-level security' }])
    await drainOnce(db, remote, { responderId: ME, now: T0 })
    expect((await listForInspection(db, INSP))[0].status).toBe('rejected')

    await answer('f1', { value_text: 'y' })
    const item = asResponse((await listForInspection(db, INSP))[0])
    expect(item.status).toBe('pending')
    expect(item.values.value_text).toBe('y')
  })
})

describe('drainOnce', () => {
  it('uploads answers oldest first and removes them once the server accepts', async () => {
    await answer('f1', { value_text: 'one' })
    await answer('f2', { value_text: 'two' })
    const { remote, calls } = recordingRemote()

    const out = await drainOnce(db, remote, { responderId: ME, now: T0 })

    expect(calls.map((c) => c.kind === 'response' && c.fieldId)).toEqual(['f1', 'f2'])
    expect(calls[0]).toMatchObject({ respondedBy: ME, values: { ...blank, value_text: 'one' } })
    expect(out).toEqual({ uploaded: 2, retrying: 0, rejected: 0 })
    expect(await listForInspection(db, INSP)).toEqual([])
  })

  it('backs off on a network failure, stops the round, and retries after the delay', async () => {
    await answer('f1', { value_text: 'one' })
    await answer('f2', { value_text: 'two' })
    const { remote, calls } = recordingRemote([{ status: 0, message: 'TypeError: Network request failed' }])

    const out = await drainOnce(db, remote, { responderId: ME, now: T0 })
    expect(out).toEqual({ uploaded: 0, retrying: 1, rejected: 0 })
    expect(calls).toHaveLength(1)
    const [f1] = await listForInspection(db, INSP)
    expect(f1).toMatchObject({ status: 'failed', retryCount: 1, lastError: 'TypeError: Network request failed' })
    expect(f1.nextAttemptAt).toBeGreaterThan(T0)

    // Too early: nothing is attempted.
    await drainOnce(db, remote, { responderId: ME, now: T0 + 1 })
    expect(calls).toHaveLength(1)

    // After the delay both go.
    await drainOnce(db, remote, { responderId: ME, now: f1.nextAttemptAt })
    expect(calls).toHaveLength(3)
    expect(await listForInspection(db, INSP)).toEqual([])
  })

  it('keeps a refused answer for the user to see and carries on with the rest', async () => {
    await answer('f1', { value_text: 'one' })
    await answer('f2', { value_text: 'two' })
    const { remote } = recordingRemote([{ status: 400, code: 'P0001', message: 'inspection is not open for answers' }])

    const out = await drainOnce(db, remote, { responderId: ME, now: T0 })

    expect(out).toEqual({ uploaded: 1, retrying: 0, rejected: 1 })
    const items = await listForInspection(db, INSP)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ fieldId: 'f1', status: 'rejected', lastError: 'inspection is not open for answers' })
  })

  it('never uploads another user’s queued answers under the signed-in session', async () => {
    await answer('f1', { value_text: 'theirs' }, OTHER)
    const { remote, calls } = recordingRemote()

    await drainOnce(db, remote, { responderId: ME, now: T0 })

    expect(calls).toEqual([])
    expect(await listForInspection(db, INSP)).toHaveLength(1)
  })
})

describe('submit', () => {
  it('waits for every earlier answer on that inspection, then sends', async () => {
    await answer('f1', { value_text: 'one' })
    await enqueueSubmit(db, { inspectionId: INSP, responderId: ME, completedAt: '2026-10-05T10:00:00.000Z' })
    const { remote, calls } = recordingRemote([{ status: 0, message: 'offline' }])

    await drainOnce(db, remote, { responderId: ME, now: T0 })
    expect(calls.map((c) => c.kind)).toEqual(['response'])

    const retryAt = (await listForInspection(db, INSP)).find((i) => i.kind === 'response')!.nextAttemptAt
    await drainOnce(db, remote, { responderId: ME, now: retryAt })
    expect(calls.map((c) => c.kind)).toEqual(['response', 'response', 'submit'])
    expect(calls[2]).toEqual({ kind: 'submit', inspectionId: INSP, completedAt: '2026-10-05T10:00:00.000Z' })
    expect(await listForInspection(db, INSP)).toEqual([])
  })

  it('is refused without calling the server when an earlier answer was refused', async () => {
    await answer('f1', { value_text: 'one' })
    await enqueueSubmit(db, { inspectionId: INSP, responderId: ME, completedAt: '2026-10-05T10:00:00.000Z' })
    const { remote, calls } = recordingRemote([{ status: 403, code: '42501', message: 'rls' }])

    const out = await drainOnce(db, remote, { responderId: ME, now: T0 })

    expect(calls.map((c) => c.kind)).toEqual(['response'])
    expect(out.rejected).toBe(2)
    const submit = (await listForInspection(db, INSP)).find((i) => i.kind === 'submit')!
    expect(submit.status).toBe('rejected')
    expect(submit.lastError).toMatch(/1 answer was refused/)
  })

  it('is not held up by answers on a different inspection', async () => {
    await answer('f1', { value_text: 'other inspection' }, ME, 'insp-2')
    await enqueueSubmit(db, { inspectionId: INSP, responderId: ME, completedAt: '2026-10-05T10:00:00.000Z' })
    const { remote, calls } = recordingRemote([{ status: 0, message: 'offline' }, null])

    await drainOnce(db, remote, { responderId: ME, now: T0 })
    // insp-2's answer is older and fails first; the round stops there.
    expect(calls.map((c) => c.kind)).toEqual(['response'])
    const later = T0 + 10 * 60_000
    await drainOnce(db, remote, { responderId: ME, now: later })
    expect(calls.map((c) => c.kind)).toContain('submit')
  })

  it('submitting twice keeps one submission', async () => {
    await enqueueSubmit(db, { inspectionId: INSP, responderId: ME, completedAt: '2026-10-05T10:00:00.000Z' })
    await enqueueSubmit(db, { inspectionId: INSP, responderId: ME, completedAt: '2026-10-05T10:05:00.000Z' })
    const items = await listForInspection(db, INSP)
    expect(items).toHaveLength(1)
    expect(asSubmit(items[0]).completedAt).toBe('2026-10-05T10:05:00.000Z')
  })
})

describe('classifyRemoteError', () => {
  it.each([
    [{ status: 0, message: 'FetchError: Network request failed' }, 'retry'],
    [{ message: 'TypeError: Network request failed' }, 'retry'],
    [{ status: 401, code: 'PGRST301', message: 'JWT expired' }, 'retry'],
    [{ status: 408, message: 'timeout' }, 'retry'],
    [{ status: 429, message: 'rate limited' }, 'retry'],
    [{ status: 503, code: 'PGRST002', message: 'schema cache' }, 'retry'],
    [{ status: 403, code: '42501', message: 'new row violates row-level security policy' }, 'reject'],
    [{ status: 400, code: 'P0001', message: 'status transition not allowed' }, 'reject'],
    [{ status: 400, code: '23514', message: 'check constraint' }, 'reject'],
    [{ status: 409, message: 'conflict' }, 'reject'],
    [{ status: 404, message: 'not found' }, 'reject'],
  ] as Array<[RemoteError, 'retry' | 'reject']>)('%j → %s', (err, expected) => {
    expect(classifyRemoteError(err)).toBe(expected)
  })
})

describe('mergeOutboxIntoResponses', () => {
  it('lays unsent answers over the server copy, field by field', async () => {
    await answer('f1', { value_text: 'local' })
    await answer('f3', { value_bool: true })
    const outbox = await listForInspection(db, INSP)

    const merged = mergeOutboxIntoResponses(
      [
        { section_id: 's1', field_id: 'f1', value_text: 'server' },
        { section_id: 's1', field_id: 'f2', value_text: 'server only' },
      ],
      outbox,
    )

    expect(merged.find((r) => r.field_id === 'f1')?.value_text).toBe('local')
    expect(merged.find((r) => r.field_id === 'f2')?.value_text).toBe('server only')
    expect(merged.find((r) => r.field_id === 'f3')?.value_bool).toBe(true)
    expect(merged).toHaveLength(3)
  })
})

describe('toResponseValues', () => {
  it('gives every value column, null where the answer has none', () => {
    expect(toResponseValues({ section_id: 's', field_id: 'f', pass_state: 'fail', fail_reason: 'loose' })).toEqual({
      ...blank,
      pass_state: 'fail',
      fail_reason: 'loose',
    })
  })

  it('keeps false and 0, which are answers, not blanks', () => {
    const v = toResponseValues({ section_id: 's', field_id: 'f', value_bool: false, value_number: 0, value_text: '' })
    expect(v.value_bool).toBe(false)
    expect(v.value_number).toBe(0)
    expect(v.value_text).toBe('')
  })
})
