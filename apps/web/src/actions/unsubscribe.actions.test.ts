// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Marketing opt-out / opt-back-in contract.
 *
 * The defect these pin: the opt-out ran on the anon cookie client, and the
 * only UPDATE policy on public.profiles is `id = auth.uid()`. For an
 * anonymous caller — which is every caller, since the link is clicked from an
 * inbox — auth.uid() is NULL, the UPDATE matched zero rows, PostgREST raised
 * NO error, and the page rendered "You're unsubscribed" having written
 * nothing. Production: 246 marketing sends to 36 recipients, 0 of 36 with
 * marketing_emails_opted_out = true.
 *
 * A test that only asserted `ok === true` would have passed against that
 * broken code, because the broken code returned ok:true. The assertion that
 * can fail is on the ROWS AFFECTED, and on WHICH CLIENT does the write.
 */

const state = vi.hoisted(() => ({
  // Row the UPDATE ... RETURNING comes back with. null = zero rows matched.
  updateResult: { data: null as { id: string; email: string } | null, error: null as unknown },
  sessionUser: null as { id: string } | null,
  // Every builder chain that was constructed, tagged with the client that
  // built it — so a test can assert the write ran on the service client.
  writes: [] as Array<{ client: 'service' | 'cookie'; table: string; payload: unknown; eq: unknown }>,
}))

function fakeClient(tag: 'service' | 'cookie') {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.sessionUser },
        error: state.sessionUser ? null : { message: 'no session' },
      })),
    },
    from(table: string) {
      const record = { client: tag, table, payload: undefined as unknown, eq: undefined as unknown }
      const builder: Record<string, unknown> = {}
      builder.update = (payload: unknown) => {
        record.payload = payload
        state.writes.push(record)
        return builder
      }
      builder.eq = (_col: string, val: unknown) => {
        record.eq = val
        return builder
      }
      builder.select = () => builder
      builder.maybeSingle = async () => state.updateResult
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => fakeClient('cookie')),
  createServiceClient: vi.fn(() => fakeClient('service')),
}))

import {
  optOutMarketingEmailsAction,
  optBackInMarketingEmailsAction,
} from './unsubscribe.actions'

const USER = '018f2d31-bbe8-4cc1-bbdd-63af0187081e'
const OTHER = 'c0ffee00-dead-4bee-8000-000000000001'

beforeEach(() => {
  state.updateResult = { data: null, error: null }
  state.sessionUser = null
  state.writes = []
})

describe('optOutMarketingEmailsAction', () => {
  it('rejects a malformed userId without touching the database', async () => {
    const res = await optOutMarketingEmailsAction('not-a-uuid')
    expect(res.ok).toBe(false)
    expect(state.writes).toHaveLength(0)
  })

  it('writes with the service client — the anon client matches zero rows under RLS', async () => {
    state.updateResult = { data: { id: USER, email: 'a@example.com' }, error: null }
    await optOutMarketingEmailsAction(USER)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({
      client: 'service',
      table: 'profiles',
      payload: { marketing_emails_opted_out: true },
      eq: USER,
    })
  })

  it('reports success and the address when a row was actually updated', async () => {
    state.updateResult = { data: { id: USER, email: 'arno@example.com' }, error: null }
    const res = await optOutMarketingEmailsAction(USER)
    expect(res).toEqual({ ok: true, email: 'arno@example.com' })
  })

  // THE ONE THAT COULD NOT FAIL BEFORE. PostgREST returns data:null,
  // error:null when an UPDATE matches nothing. The old code read only
  // `error` and returned ok:true, so the page told 36 people they were
  // unsubscribed while the column stayed false.
  it('does NOT claim success when the UPDATE matched zero rows', async () => {
    state.updateResult = { data: null, error: null }
    const res = await optOutMarketingEmailsAction(USER)
    expect(res.ok).toBe(false)
    expect(res.email).toBeUndefined()
    expect(res.error).toBeTruthy()
  })

  it('reports failure on a PostgREST error', async () => {
    state.updateResult = { data: null, error: { message: 'boom' } }
    const res = await optOutMarketingEmailsAction(USER)
    expect(res.ok).toBe(false)
  })
})

describe('optBackInMarketingEmailsAction', () => {
  // The userId is printed in the URL of every marketing email ever sent. A
  // service-role re-subscribe endpoint with no auth check would let anyone
  // holding a forwarded email silently reverse someone's opt-out — a fresh
  // POPIA §11(3) violation, and a worse one than the bug being fixed.
  it('refuses an anonymous caller and writes NOTHING', async () => {
    state.sessionUser = null
    state.updateResult = { data: { id: USER, email: 'a@example.com' }, error: null }
    const res = await optBackInMarketingEmailsAction(USER)
    expect(res.ok).toBe(false)
    expect(state.writes).toHaveLength(0)
  })

  it('refuses a signed-in caller re-subscribing somebody else, and writes NOTHING', async () => {
    state.sessionUser = { id: OTHER }
    state.updateResult = { data: { id: USER, email: 'a@example.com' }, error: null }
    const res = await optBackInMarketingEmailsAction(USER)
    expect(res.ok).toBe(false)
    expect(state.writes).toHaveLength(0)
  })

  it('never runs the re-subscribe on the service client', async () => {
    state.sessionUser = { id: USER }
    state.updateResult = { data: { id: USER, email: 'a@example.com' }, error: null }
    await optBackInMarketingEmailsAction(USER)
    expect(state.writes.map((w) => w.client)).not.toContain('service')
  })

  it('opts a matching signed-in user back in', async () => {
    state.sessionUser = { id: USER }
    state.updateResult = { data: { id: USER, email: 'a@example.com' }, error: null }
    const res = await optBackInMarketingEmailsAction(USER)
    expect(res.ok).toBe(true)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({
      table: 'profiles',
      payload: { marketing_emails_opted_out: false },
      eq: USER,
    })
  })

  it('does NOT claim success when the re-subscribe matched zero rows', async () => {
    state.sessionUser = { id: USER }
    state.updateResult = { data: null, error: null }
    const res = await optBackInMarketingEmailsAction(USER)
    expect(res.ok).toBe(false)
  })
})
