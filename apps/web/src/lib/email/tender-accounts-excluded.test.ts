// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Lifecycle mail (onboarding d1–d14, re-engagement) must never reach an
 * account that exists only because of a tender: E5 creates the contractor's
 * account when WM emails the invitation, and they never signed up for E-Site.
 * Tested against the real Deno module (see lifecycle-send-status.test.ts for
 * why it is imported this way).
 */

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))

const SENDER_MODULE = '../../../../edge-functions/supabase/functions/_shared/email-sequence.ts'

async function loadModule() {
  ;(globalThis as any).Deno = { env: { get: () => undefined } }
  vi.resetModules()
  return await import(/* @vite-ignore */ SENDER_MODULE)
}
afterEach(() => {
  delete (globalThis as any).Deno
})

type Tables = { orgs: string[]; participants: string[]; invitedEmails: string[]; fail?: string }
function client(t: Tables) {
  const q = (table: string) => {
    const filters: Record<string, string[]> = {}
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.in = (col: string, vals: string[]) => {
      filters[col] = vals
      return b
    }
    b.then = (res: (v: unknown) => unknown) => {
      if (t.fail === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res)
      const data =
        table === 'user_organisations' ? t.orgs.filter((u) => filters.user_id.includes(u)).map((user_id) => ({ user_id }))
        : table === 'tender_participants' ? t.participants.filter((u) => filters.user_id.includes(u)).map((user_id) => ({ user_id }))
        : t.invitedEmails.filter((e) => filters.email.includes(e)).map((email) => ({ email }))
      return Promise.resolve({ data, error: null }).then(res)
    }
    return b
  }
  return { from: q, schema: () => ({ from: q }) }
}

const T = (userId: string, email: string) => ({ userId, email })

describe('excludeTenderOnlyAccounts', () => {
  it('drops tender-only accounts (invited, or a bidder) and keeps everyone else', async () => {
    const { excludeTenderOnlyAccounts } = await loadModule()
    const kept = await excludeTenderOnlyAccounts(
      client({ orgs: ['wm'], participants: ['bidder'], invitedEmails: ['invitee@co.example', 'pm@wm.example'] }),
      [T('wm', 'pm@wm.example'), T('bidder', 'bidder@co.example'), T('invitee', 'Invitee@Co.Example'), T('signup', 'new@co.example')],
    )
    // A WM user who was also invited keeps their mail; a normal new sign-up too.
    expect(kept.map((k: { userId: string }) => k.userId)).toEqual(['wm', 'signup'])
  })

  it('fails closed: a lookup error sends nothing', async () => {
    const { excludeTenderOnlyAccounts } = await loadModule()
    await expect(
      excludeTenderOnlyAccounts(client({ orgs: [], participants: [], invitedEmails: [], fail: 'tender_invitations' }), [T('a', 'a@co.example')]),
    ).rejects.toThrow(/excludeTenderOnlyAccounts/)
  })
})
