// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'

const { calls, insertResult, upsertResult, updateResult, createServiceClientMock } = vi.hoisted(() => {
  const calls: Array<{ table: string; op: string; payload: unknown; filters: string[] }> = []
  const insertResult = { value: { error: null as { code?: string } | null } }
  const upsertResult = { value: { error: null as { code?: string } | null } }
  const updateResult = {
    value: { data: [{ id: 'seq-1' }] as { id: string }[] | null, error: null as unknown },
  }
  return { calls, insertResult, upsertResult, updateResult, createServiceClientMock: vi.fn() }
})

// Recorder client: every call appends to `calls`, so the assertions are about
// what was written, not about whether a promise resolved.
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    const make = (table: string) => {
      const filters: string[] = []
      const chain: any = {
        insert: (payload: unknown) => {
          calls.push({ table, op: 'insert', payload, filters })
          return Promise.resolve(insertResult.value)
        },
        upsert: (payload: unknown) => {
          calls.push({ table, op: 'upsert', payload, filters })
          return Promise.resolve(upsertResult.value)
        },
        update: (payload: unknown) => {
          calls.push({ table, op: 'update', payload, filters })
          return chain
        },
        eq: (c: string, v: string) => { filters.push(`eq:${c}=${v}`); return chain },
        is: (c: string, v: unknown) => { filters.push(`is:${c}=${String(v)}`); return chain },
        select: () => Promise.resolve(updateResult.value),
      }
      return chain
    }
    createServiceClientMock()
    return { from: (t: string) => make(t) }
  },
}))

import { POST } from './route'

function signed(body: string, at = Date.now()) {
  const id = 'msg_test_0001'
  const ts = String(Math.floor(at / 1000))
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  const headers: Record<string, string> = {
    'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`,
  }
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as any
}

const bounced = JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-09-10T06:00:00.000Z',
  data: {
    email_id: 'ab12cd34-0000-0000-0000-000000000001',
    to: ['Ghost@aeec.co.za'],
    subject: 'Your open items',
    bounce: { type: 'Permanent', subType: 'General', message: 'no such mailbox' },
  },
})

const opened = JSON.stringify({
  type: 'email.opened',
  created_at: '2026-09-10T07:00:00.000Z',
  data: { email_id: 'ab12cd34-0000-0000-0000-000000000002', to: ['a@x.co.za'] },
})

// An open with no email_id at all. Resend has no reason to send one, which is
// exactly why the guard that skips the stamp for it is otherwise unexercised.
const openedNoMessageId = JSON.stringify({
  type: 'email.opened',
  created_at: '2026-09-10T07:00:00.000Z',
  data: { to: ['a@x.co.za'] },
})

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  calls.length = 0
  insertResult.value = { error: null }
  upsertResult.value = { error: null }
  updateResult.value = { data: [{ id: 'seq-1' }], error: null }
  createServiceClientMock.mockClear()
})

describe('POST /api/webhooks/resend', () => {
  it('401s a tampered body and writes nothing', async () => {
    const req = signed(bounced)
    const tampered = { ...req, text: async () => bounced.replace('Permanent', 'Transient') }
    const res = await POST(tampered)
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('401s a request with no signature headers at all', async () => {
    const res = await POST({ headers: { get: () => null }, text: async () => bounced } as any)
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('401s a replayed request signed ten minutes ago', async () => {
    const res = await POST(signed(bounced, Date.now() - 10 * 60 * 1000))
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('stores a Permanent bounce and suppresses the address', async () => {
    const res = await POST(signed(bounced))
    expect(res.status).toBe(200)
    const evt = calls.find(c => c.table === 'email_events')
    expect(evt?.op).toBe('insert')
    expect(evt?.payload).toMatchObject({
      webhook_id: 'msg_test_0001',
      event_type: 'email.bounced',
      to_email: 'ghost@aeec.co.za',
      bounce_type: 'Permanent',
    })
    const sup = calls.find(c => c.table === 'email_suppressions')
    expect(sup?.op).toBe('upsert')
    expect(sup?.payload).toMatchObject({ email_address: 'ghost@aeec.co.za', reason: 'hard_bounce' })
  })

  it('stamps opened_at on the sequence row, only when it is still null, and reports the count', async () => {
    const res = await POST(signed(opened))
    expect(res.status).toBe(200)
    const seq = calls.find(c => c.table === 'email_sequence_events')
    expect(seq?.op).toBe('update')
    expect(seq?.payload).toEqual({ opened_at: '2026-09-10T07:00:00.000Z' })
    // First open wins: a message opened five times keeps the first timestamp.
    expect(seq?.filters).toContain('is:opened_at=null')
    expect(seq?.filters).toContain('eq:resend_message_id=ab12cd34-0000-0000-0000-000000000002')
    // The count is in the body, so a production probe can assert on it rather
    // than hoping a console.error somewhere did not fire.
    expect(await res.json()).toEqual({ received: true, stamped: 1 })
  })

  it('reports stamped:0 when the message matches no sequence row — a dashboard test event', async () => {
    updateResult.value = { data: [], error: null }
    const res = await POST(signed(opened))
    expect(await res.json()).toEqual({ received: true, stamped: 0 })
  })

  it('flags a stamp error in the body instead of failing silently', async () => {
    updateResult.value = { data: null, error: { code: '42501' } }
    const res = await POST(signed(opened))
    expect(res.status).toBe(200)   // a retry cannot help: the insert already succeeded
    expect(await res.json()).toEqual({ received: true, stamped: 0, stamp_error: true })
  })

  it('200s a duplicate delivery (unique violation) without erroring', async () => {
    insertResult.value = { error: { code: '23505' } }
    const res = await POST(signed(bounced))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, duplicate: true })
  })

  it('500s a real storage failure so Svix retries', async () => {
    insertResult.value = { error: { code: '42501' } }
    const res = await POST(signed(bounced))
    expect(res.status).toBe(500)
  })

  it('200s an unhandled event type and writes nothing — a 4xx would make Svix disable the endpoint', async () => {
    const res = await POST(signed(JSON.stringify({ type: 'contact.created', data: {} })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ignored: true })
    expect(calls).toHaveLength(0)
  })

  // ── Added after the mutation sweep ──────────────────────────────────────
  // The eleven tests above leave three branches alive: each of these three was
  // written because deleting the branch it covers left `Tests 11 passed`.

  it('does not attempt a stamp when the event carries no message id', async () => {
    const res = await POST(signed(openedNoMessageId))
    expect(res.status).toBe(200)
    // Without the row.resend_message_id guard this issues
    // `resend_message_id=eq.null`, which matches no row in Postgres anyway —
    // a pointless UPDATE against the whole table's index for every such event.
    expect(calls.find(c => c.table === 'email_sequence_events')).toBeUndefined()
    expect(await res.json()).toEqual({ received: true, stamped: 0 })
  })

  it('200s a signed body that is not JSON — a 500 would retry a body that can never parse', async () => {
    const res = await POST(signed('this is not json'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ignored: true })
    expect(calls).toHaveLength(0)
  })

  it('500s when the suppression write fails, so Svix retries the suppression', async () => {
    // The suppression list is the control that stops us mailing a dead address.
    // Losing the event is recoverable; losing the suppression is not, so this
    // is the one post-insert failure that must invite a retry.
    upsertResult.value = { error: { code: '42501' } }
    const res = await POST(signed(bounced))
    expect(res.status).toBe(500)
    expect(calls.find(c => c.table === 'email_suppressions')?.op).toBe('upsert')
  })

  it('500s when the signing secret is not configured, and never reaches the database', async () => {
    // No vi.resetModules(): the route reads process.env per request.
    delete process.env.RESEND_WEBHOOK_SECRET
    const res = await POST(signed(bounced))
    expect(res.status).toBe(500)
    expect(calls).toHaveLength(0)
  })
})
