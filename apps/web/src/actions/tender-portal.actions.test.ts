import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ svc: null as unknown, cookie: null as unknown }))
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', '1.2.3.4']]) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.svc, createClient: async () => h.cookie }))

import { acceptInvitationAction, previewInvitationAction, sendInvitationSignInAction } from './tender-portal.actions'
import { hashInvitationToken, newInvitationToken } from '@/lib/tender/invitation'

const TOKEN = newInvitationToken()
const FUTURE = '2099-01-01T00:00:00Z'
const INVITE = { id: 'inv', tender_id: 't1', status: 'prepared', token_expires_at: null, email: 'bidder@co.example', company_name: 'Bidder', contact_name: null, phone: null }
const OPEN = { id: 't1', status: 'issued', closing_at: FUTURE, package: 'Electrical', title: 'Main', project_id: 'p1', organisation_id: 'o1' }

function world(w: { invitation: Record<string, unknown> | null; tender: Record<string, unknown> | null; sessionEmail: string | null; rpcError?: { code: string; message: string } }) {
  const calls: string[] = []
  const lookedUpHash: string[] = []
  const rpcArgs: unknown[] = []
  h.svc = {
    schema: () => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (k: string, v: string) => {
          if (k === 'token_hash') lookedUpHash.push(v)
          return q
        }
        q.maybeSingle = () => Promise.resolve({ data: table === 'tender_invitations' ? w.invitation : table === 'tenders' ? w.tender : { name: 'Project' } })
        // Any write on the service path is a defect in the new design.
        q.insert = () => { calls.push(`SERVICE insert:${table}`); return Promise.resolve({ error: null }) }
        q.update = () => { calls.push(`SERVICE update:${table}`); return q }
        return q
      },
    }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'WM' } }) }) }) }),
    auth: { admin: new Proxy({}, { get: (_t, p) => () => { calls.push(`SERVICE admin.${String(p)}`); return Promise.resolve({ data: null, error: null }) } }) },
  }
  h.cookie = {
    auth: {
      getUser: async () => ({ data: { user: w.sessionEmail ? { id: 'u1', email: w.sessionEmail } : null } }),
      signInWithOtp: async (a: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => {
        calls.push(`signInWithOtp:${a.email}:create=${a.options.shouldCreateUser}:${a.options.emailRedirectTo}`)
        return { error: null }
      },
      verifyOtp: async () => { calls.push('verifyOtp'); return { error: null } },
    },
    schema: () => ({
      rpc: (name: string, args: unknown) => {
        calls.push(`rpc:${name}`)
        rpcArgs.push(args)
        return Promise.resolve(w.rpcError ? { data: null, error: w.rpcError } : { data: 't1', error: null })
      },
    }),
  }
  return { calls, lookedUpHash, rpcArgs }
}

beforeEach(() => vi.clearAllMocks())

describe('sendInvitationSignInAction', () => {
  it('emails a sign-in link to the INVITED address only, returning to the invitation; no session, no writes', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    const r = await sendInvitationSignInAction(TOKEN)
    expect(r).toEqual({ data: { email: 'bidder@co.example' } })
    expect(w.lookedUpHash).toEqual([hashInvitationToken(TOKEN)])
    expect(w.calls).toHaveLength(1)
    expect(w.calls[0]).toMatch(/^signInWithOtp:bidder@co\.example:create=true:https:\/\/.+\/auth\/callback\?next=%2Ftender%2Finvite%2F/)
    expect(w.calls[0]).toContain(encodeURIComponent(`/tender/invite/${TOKEN}`))
  })

  it('refuses a used, revoked, expired or not-open invitation without emailing anyone', async () => {
    for (const [inv, tender, text] of [
      [{ ...INVITE, status: 'accepted' }, OPEN, /already been accepted/],
      [{ ...INVITE, status: 'revoked' }, OPEN, /withdrawn/],
      [{ ...INVITE, token_expires_at: '2000-01-01T00:00:00Z' }, OPEN, /expired/],
      [INVITE, { ...OPEN, status: 'draft' }, /not open/],
      [INVITE, { ...OPEN, closing_at: '2000-01-01T00:00:00Z' }, /closed/],
    ] as const) {
      const w = world({ invitation: inv, tender, sessionEmail: null })
      expect(((await sendInvitationSignInAction(TOKEN)) as { error: string }).error).toMatch(text)
      expect(w.calls).toEqual([])
    }
  })

  it('does not even look up a malformed token', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await sendInvitationSignInAction('../../etc')).toHaveProperty('error')
    expect(w.lookedUpHash).toEqual([])
  })
})

describe('previewInvitationAction', () => {
  it('offers Accept only to a session signed in as the invited address', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: 'Bidder@Co.Example' })
    expect(((await previewInvitationAction(TOKEN)) as { data: { canAccept: boolean } }).data.canAccept).toBe(true)
    world({ invitation: INVITE, tender: OPEN, sessionEmail: 'pm@wm.example' })
    expect(((await previewInvitationAction(TOKEN)) as { data: { canAccept: boolean } }).data.canAccept).toBe(false)
    world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(((await previewInvitationAction(TOKEN)) as { data: { canAccept: boolean } }).data.canAccept).toBe(false)
  })
})

describe('acceptInvitationAction', () => {
  it('needs a session, and never creates or signs in an account itself', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await acceptInvitationAction(TOKEN)).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })

  it('accepts through the database function, by hash only', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: 'bidder@co.example' })
    expect(await acceptInvitationAction(TOKEN)).toEqual({ data: { tenderId: 't1' } })
    expect(w.calls).toEqual(['rpc:tender_accept'])
    expect(w.rpcArgs).toEqual([{ p_token_hash: hashInvitationToken(TOKEN) }])
    expect(JSON.stringify(w.rpcArgs)).not.toContain(TOKEN)
  })

  it('asks a password session to use the emailed link instead', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: 'bidder@co.example', rpcError: { code: '42501', message: 'sign in with the link we emailed to the invited address' } })
    expect(((await acceptInvitationAction(TOKEN)) as { error: string }).error).toMatch(/link we email/)
  })

  it('explains a different signed-in account (the database refuses it)', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: 'pm@wm.example', rpcError: { code: '42501', message: 'this invitation was sent to a different email address' } })
    expect(((await acceptInvitationAction(TOKEN)) as { error: string }).error).toMatch(/different email address/)
  })
})
