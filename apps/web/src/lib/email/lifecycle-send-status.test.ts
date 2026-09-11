// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Behavioural tests for the lifecycle sender — the real Deno module, not a
 * Node-side mirror of it.
 *
 * Why it can be imported at all: sendSequenceEmail takes its Supabase client as
 * a parameter, and the only Deno-specific things in the module are the esm.sh
 * import (mocked below) and Deno.env reads at module scope (stubbed below).
 * That matters for the fixture question — a mirror in packages/shared would
 * pass forever while the deployed file diverged, which is exactly how
 * email-sequence.service.ts came to describe an insert-first design nothing
 * verifies.
 *
 * What is under test:
 *  - #27  A failed send was recorded as a completed step. The row was inserted
 *         BEFORE the send and left in place on failure, so the next run hit
 *         UNIQUE (user_id, sequence_name, step_name) and returned
 *         skipped_duplicate forever. 11 production rows carry a NULL message id
 *         from a one-week sender-domain outage in April and none of them could
 *         ever be retried. The success-path UPDATE that writes the message id
 *         also discarded its own error, so a NULL id did not even reliably mean
 *         the send failed.
 *  - #21  public.email_suppressions shipped this morning and nothing read it.
 *
 * The rule that governs every assertion below: a row we are not certain about
 * must never be retried, because a double-send of a real email cannot be undone
 * and a missed lifecycle email can.
 */

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({
  createClient: () => ({}),
}))

// ─── A Supabase test double with a real query-builder shape ──────────────────

type Row = Record<string, unknown>

interface Op {
  table: string
  kind: 'select' | 'insert' | 'update'
  payload?: Row
  filters: Array<[string, unknown]>
  terminal?: 'maybeSingle' | 'single' | 'select' | 'await'
}

interface Responder {
  (op: Op): { data: unknown; error: unknown }
}

function makeClient(respond: Responder) {
  const ops: Op[] = []

  function builder(op: Op) {
    const settle = (terminal: Op['terminal']) => {
      op.terminal = terminal
      ops.push(op)
      return Promise.resolve(respond(op))
    }
    const chain: any = {
      select: (_cols?: string) => {
        // `.select()` after insert/update is a returning clause, not a read.
        if (op.kind === 'insert' || op.kind === 'update') {
          const returning: any = {
            single:      () => settle('single'),
            maybeSingle: () => settle('maybeSingle'),
            then: (res: any, rej: any) => settle('select').then(res, rej),
          }
          return returning
        }
        return chain
      },
      eq: (col: string, val: unknown) => { op.filters.push([col, val]); return chain },
      maybeSingle: () => settle('maybeSingle'),
      single:      () => settle('single'),
      // a bare `await supabase.from(t).update(x).eq(...)`
      then: (res: any, rej: any) => settle('await').then(res, rej),
    }
    return chain
  }

  const client = {
    from: (table: string) => ({
      select: (_cols: string) => builder({ table, kind: 'select', filters: [] }).select(_cols),
      insert: (payload: Row) => builder({ table, kind: 'insert', payload, filters: [] }),
      update: (payload: Row) => builder({ table, kind: 'update', payload, filters: [] }),
    }),
  }
  return { client, ops }
}

const OK = { data: null, error: null }

/** Default responder: nobody opted out, nobody suppressed, insert succeeds. */
function defaults(overrides: Partial<Record<string, Responder>> = {}): Responder {
  return (op) => {
    const key = `${op.table}:${op.kind}`
    const custom = overrides[key]
    if (custom) return custom(op)
    switch (key) {
      case 'profiles:select':           return { data: { marketing_emails_opted_out: false }, error: null }
      case 'email_suppressions:select': return { data: null, error: null }
      case 'email_sequence_events:insert': return { data: { id: 'evt-1' }, error: null }
      case 'email_sequence_events:update': return { data: [{ id: 'evt-1' }], error: null }
      case 'email_sequence_events:select': return { data: null, error: null }
      default: return OK
    }
  }
}

const INPUT = {
  userId: 'user-1',
  toEmail: 'Site.Manager@Example.co.za',
  sequence: 'onboarding' as const,
  step: 'd3' as const,
  subject: 'Invite your first field worker',
  html: '<p>hi</p>',
}

const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value' }

const SENDER_MODULE =
  '../../../../edge-functions/supabase/functions/_shared/email-sequence.ts'

let fetchMock: ReturnType<typeof vi.fn>

async function loadModule() {
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => (k === 'RESEND_API_KEY' ? 're_test_key' : undefined) },
  }
  vi.resetModules()
  // Specifier held in a variable ON PURPOSE. Vitest resolves it through Vite at
  // runtime, but `tsc --noEmit` for apps/web cannot follow a non-literal, which
  // keeps a Deno module — `Deno.env`, an esm.sh URL import — out of the web
  // app's type-check. A literal here turns those into six build errors.
  return await import(/* @vite-ignore */ SENDER_MODULE)
}

function resendOk(id = 'msg-abc') {
  return { ok: true, status: 200, json: async () => ({ id }), text: async () => '' }
}
function resendFail(status = 500, body = 'boom') {
  return { ok: false, status, json: async () => ({}), text: async () => body }
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(resendOk())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as any).Deno
})

function eventUpdates(ops: Op[]) {
  return ops.filter(o => o.table === 'email_sequence_events' && o.kind === 'update')
}
function eventInserts(ops: Op[]) {
  return ops.filter(o => o.table === 'email_sequence_events' && o.kind === 'insert')
}

// ─── #27: the status ledger ──────────────────────────────────────────────────

describe('sendSequenceEmail records what actually happened', () => {
  it('inserts the row as pending BEFORE sending, then stamps it sent', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client, ops } = makeClient(defaults())

    const r = await sendSequenceEmail(client as any, INPUT)

    expect(r.status).toBe('sent')
    expect(r.messageId).toBe('msg-abc')

    // pending first — the insert must precede the fetch, so a crash mid-send
    // leaves "possibly not sent" rather than "possibly sent twice".
    const insert = eventInserts(ops)[0]
    expect(insert.payload!.status).toBe('pending')

    const stamp = eventUpdates(ops).at(-1)!
    expect(stamp.payload).toMatchObject({ status: 'sent', resend_message_id: 'msg-abc' })
  })

  it('a Resend failure is written to the row as failed, with the reason', async () => {
    const { sendSequenceEmail } = await loadModule()
    fetchMock.mockResolvedValue(resendFail(500, 'upstream exploded'))
    const { client, ops } = makeClient(defaults())

    const r = await sendSequenceEmail(client as any, INPUT)

    expect(r.status).toBe('failed')
    // The whole point of #27: the row must NOT be left looking like a completed
    // step. Before this fix it stayed exactly as inserted.
    const stamp = eventUpdates(ops).at(-1)!
    expect(stamp.payload!.status).toBe('failed')
    expect(String(stamp.payload!.failure_reason)).toContain('upstream exploded')
  })

  it('a send that succeeded but whose id could not be written is send_id_unrecorded, and still counts as sent', async () => {
    const { sendSequenceEmail } = await loadModule()
    let updateCall = 0
    const { client, ops } = makeClient(defaults({
      'email_sequence_events:update': () => {
        updateCall++
        // first write (status+id) fails, the fallback write succeeds
        return updateCall === 1
          ? { data: null, error: { message: 'connection reset' } }
          : { data: [{ id: 'evt-1' }], error: null }
      },
    }))

    const r = await sendSequenceEmail(client as any, INPUT)

    // Resend accepted it. Reporting this as a failure would be a lie that
    // causes a double-send on the next run.
    expect(r.status).toBe('sent')
    const stamp = eventUpdates(ops).at(-1)!
    expect(stamp.payload!.status).toBe('send_id_unrecorded')
  })
})

// ─── #27: the retry decision on a UNIQUE collision ───────────────────────────

describe('a UNIQUE collision retries only a row known to have failed', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

  async function collideWith(existing: Row | null) {
    const { sendSequenceEmail } = await loadModule()
    const { client, ops } = makeClient(defaults({
      'email_sequence_events:insert': () => ({ data: null, error: UNIQUE_VIOLATION }),
      'email_sequence_events:select': () => ({ data: existing, error: null }),
    }))
    const r = await sendSequenceEmail(client as any, INPUT)
    return { r, ops }
  }

  it('retries a recent failed row via UPDATE — not a second INSERT, which the UNIQUE forbids', async () => {
    const { r, ops } = await collideWith({
      id: 'evt-9', status: 'failed', sent_at: hoursAgo(20), send_attempts: 1,
    })

    expect(r.status).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Exactly one insert attempt (the one that 23505'd) and no more.
    expect(eventInserts(ops)).toHaveLength(1)

    const claim = eventUpdates(ops)[0]
    expect(claim.payload!.status).toBe('pending')
    expect(claim.payload!.send_attempts).toBe(2)
    // Claimed conditionally, so two concurrent cron runs cannot both send.
    expect(claim.filters).toContainEqual(['status', 'failed'])
  })

  it('does NOT retry a row that already sent', async () => {
    const { r } = await collideWith({
      id: 'evt-9', status: 'sent', sent_at: hoursAgo(2), send_attempts: 1,
    })
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT retry a pending row — we do not know whether it went out', async () => {
    // This is the case that makes double-sending possible. resendSend throws on
    // any fetch rejection, including a timeout AFTER Resend already accepted the
    // message, and a row stuck at pending is precisely "we never found out".
    const { r } = await collideWith({
      id: 'evt-9', status: 'pending', sent_at: hoursAgo(1), send_attempts: 1,
    })
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT retry send_id_unrecorded — Resend accepted that one', async () => {
    const { r } = await collideWith({
      id: 'evt-9', status: 'send_id_unrecorded', sent_at: hoursAgo(1), send_attempts: 1,
    })
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT retry a failed row older than the retry window', async () => {
    // The 11 production NULL-id rows are from April. "Two weeks in — how is
    // E-Site working for you?" arriving five months late is worse than never.
    const { r } = await collideWith({
      id: 'evt-9', status: 'failed', sent_at: hoursAgo(24 * 40), send_attempts: 1,
    })
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT retry a failed row that has exhausted its attempts', async () => {
    const { sendSequenceEmail, MAX_SEND_ATTEMPTS } = await loadModule()
    expect(MAX_SEND_ATTEMPTS).toBeGreaterThan(1)
    const { client, ops } = makeClient(defaults({
      'email_sequence_events:insert': () => ({ data: null, error: UNIQUE_VIOLATION }),
      'email_sequence_events:select': () => ({
        data: { id: 'evt-9', status: 'failed', sent_at: hoursAgo(1), send_attempts: MAX_SEND_ATTEMPTS },
        error: null,
      }),
    }))
    const r = await sendSequenceEmail(client as any, INPUT)
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(eventUpdates(ops)).toHaveLength(0)
  })

  it('does NOT send when another runner won the claim', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client } = makeClient(defaults({
      'email_sequence_events:insert': () => ({ data: null, error: UNIQUE_VIOLATION }),
      'email_sequence_events:select': () => ({
        data: { id: 'evt-9', status: 'failed', sent_at: hoursAgo(1), send_attempts: 1 },
        error: null,
      }),
      // conditional UPDATE matched zero rows: someone else flipped it first
      'email_sequence_events:update': () => ({ data: [], error: null }),
    }))
    const r = await sendSequenceEmail(client as any, INPUT)
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT retry when the existing row cannot be read', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client } = makeClient(defaults({
      'email_sequence_events:insert': () => ({ data: null, error: UNIQUE_VIOLATION }),
      'email_sequence_events:select': () => ({ data: null, error: { message: 'read failed' } }),
    }))
    const r = await sendSequenceEmail(client as any, INPUT)
    expect(r.status).toBe('skipped_duplicate')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── #21: the suppression consult ────────────────────────────────────────────

describe('suppressed addresses are filtered before Resend sees them', () => {
  it('skips a suppressed address without inserting a row or calling Resend', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client, ops } = makeClient(defaults({
      'email_suppressions:select': () => ({ data: { email_address: 'x' }, error: null }),
    }))

    const r = await sendSequenceEmail(client as any, INPUT)

    expect(r.status).toBe('skipped_suppressed')
    expect(fetchMock).not.toHaveBeenCalled()
    // No event row: burning the once-ever (user, sequence, step) slot on a send
    // that never happened would make the step unsendable if the address is ever
    // un-suppressed.
    expect(eventInserts(ops)).toHaveLength(0)
  })

  it('looks the address up normalised — the table is keyed on lowercase', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client, ops } = makeClient(defaults())
    await sendSequenceEmail(client as any, INPUT)

    const lookup = ops.find(o => o.table === 'email_suppressions')
    expect(lookup, 'nothing consulted email_suppressions').toBeDefined()
    expect(lookup!.filters).toContainEqual(['email_address', 'site.manager@example.co.za'])
  })

  it('FAILS OPEN on a suppression read error', async () => {
    // Failing closed here silences every outbound email at once — an invisible
    // total outage. Mailing a few dead addresses is the cheaper failure and it
    // is self-announcing, because it produces more bounce events.
    const { sendSequenceEmail } = await loadModule()
    const { client } = makeClient(defaults({
      'email_suppressions:select': () => ({ data: null, error: { message: 'db hiccup' } }),
    }))

    const r = await sendSequenceEmail(client as any, INPUT)

    expect(r.status).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not consult suppression for someone who already opted out', async () => {
    const { sendSequenceEmail } = await loadModule()
    const { client, ops } = makeClient(defaults({
      'profiles:select': () => ({ data: { marketing_emails_opted_out: true }, error: null }),
    }))

    const r = await sendSequenceEmail(client as any, INPUT)

    expect(r.status).toBe('skipped_opt_out')
    expect(ops.find(o => o.table === 'email_suppressions')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
