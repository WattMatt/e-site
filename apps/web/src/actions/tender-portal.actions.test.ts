import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  svc: null as unknown,
  cookie: null as unknown,
  minted: [] as string[],
  sent: [] as { to: string; subject: string; html: string }[],
  sendError: null as string | null,
}))
vi.mock('next/headers', () => ({ headers: async () => new Map([['x-forwarded-for', '1.2.3.4']]) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.svc, createClient: async () => h.cookie }))
vi.mock('@/lib/tender/access', async (orig) => {
  const real = await orig<typeof import('@/lib/tender/access')>()
  return {
    ...real,
    mintTenderAccess: async (_svc: unknown, email: string) => {
      h.minted.push(email)
      return { tokenHash: 'a'.repeat(56), type: 'magiclink', code: '123456' }
    },
    sendTenderEmail: async (to: string, subject: string, html: string) => {
      h.sent.push({ to, subject, html })
      return h.sendError ? { error: h.sendError } : { data: true }
    },
  }
})

import {
  acceptInvitationAction,
  continueInvitationAction,
  continueInvitationWithCodeAction,
  emailInvitationLinkAction,
  previewInvitationAction,
  requestTenderAccessAction,
} from './tender-portal.actions'
import { hashInvitationToken, newInvitationToken } from '@/lib/tender/invitation'

const TOKEN = newInvitationToken()
const K = 'b'.repeat(56)
const FUTURE = '2099-01-01T00:00:00Z'
const INVITE = { id: 'inv', tender_id: 't1', status: 'sent', token_expires_at: null, email: 'bidder@co.example', company_name: 'Bidder', contact_name: null, phone: null }
const OPEN = { id: 't1', status: 'issued', closing_at: FUTURE, package: 'Electrical', title: 'Main', project_id: 'p1', organisation_id: 'o1' }

type Row = Record<string, unknown>
function world(w: {
  invitation: Row | null
  tender: Row | null
  sessionEmail: string | null
  verifiedEmail?: string | null
  rpcError?: { code: string; message: string }
  byAddress?: Row[]
}) {
  const calls: string[] = []
  const lookedUpHash: string[] = []
  const rpcArgs: unknown[] = []
  const updates: { table: string; values: Row }[] = []
  h.svc = {
    schema: () => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (k: string, v: string) => {
          if (k === 'token_hash') lookedUpHash.push(v)
          return q
        }
        q.ilike = () => q
        q.in = () => q
        q.order = () => q
        q.limit = () => Promise.resolve({ data: w.byAddress ?? [] })
        q.maybeSingle = () => Promise.resolve({ data: table === 'tender_invitations' ? w.invitation : table === 'tenders' ? w.tender : { name: 'Project' } })
        q.insert = () => { calls.push(`SERVICE insert:${table}`); return Promise.resolve({ error: null }) }
        q.update = (values: Row) => {
          updates.push({ table, values })
          const u: Record<string, unknown> = {}
          u.eq = () => u
          u.then = (res: (v: unknown) => void) => res({ error: null })
          return u
        }
        return q
      },
    }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'WM' } }) }) }) }),
    auth: { admin: new Proxy({}, { get: (_t, p) => () => { calls.push(`SERVICE admin.${String(p)}`); return Promise.resolve({ data: null, error: null }) } }) },
  }
  const verified = w.verifiedEmail === undefined ? INVITE.email : w.verifiedEmail
  h.cookie = {
    auth: {
      getUser: async () => ({ data: { user: w.sessionEmail ? { id: 'u1', email: w.sessionEmail } : null } }),
      verifyOtp: async (a: Row) => {
        calls.push(`verifyOtp:${JSON.stringify(a)}`)
        return verified ? { data: { user: { email: verified } }, error: null } : { data: { user: null }, error: { message: 'Token has expired or is invalid' } }
      },
      signOut: async () => { calls.push('signOut'); return { error: null } },
    },
    schema: () => ({
      rpc: (name: string, args: unknown) => {
        calls.push(`rpc:${name}`)
        rpcArgs.push(args)
        return Promise.resolve(w.rpcError ? { data: null, error: w.rpcError } : { data: 't1', error: null })
      },
    }),
  }
  return { calls, lookedUpHash, rpcArgs, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.minted = []
  h.sent = []
  h.sendError = null
})

describe('emailInvitationLinkAction', () => {
  it('emails a fresh link and code to the INVITED address only, back to this invitation; no session, no writes', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await emailInvitationLinkAction(TOKEN)).toEqual({ data: { email: 'bidder@co.example' } })
    expect(w.lookedUpHash).toEqual([hashInvitationToken(TOKEN)])
    expect(h.minted).toEqual(['bidder@co.example'])
    expect(h.sent.map((s) => s.to)).toEqual(['bidder@co.example'])
    expect(h.sent[0].html).toContain(`/tender/invite/${TOKEN}?k=`)
    expect(h.sent[0].html).toContain('123456')
    expect(w.calls).toEqual([])
    expect(w.updates).toEqual([])
  })

  it('refuses a used, withdrawn, expired or not-open invitation without emailing anyone', async () => {
    for (const [inv, tender, text] of [
      [{ ...INVITE, status: 'accepted' }, OPEN, /already been accepted/],
      [{ ...INVITE, status: 'revoked' }, OPEN, /withdrawn/],
      [{ ...INVITE, token_expires_at: '2000-01-01T00:00:00Z' }, OPEN, /expired/],
      [INVITE, { ...OPEN, status: 'draft' }, /not open/],
      [INVITE, { ...OPEN, closing_at: '2000-01-01T00:00:00Z' }, /closed/],
    ] as const) {
      world({ invitation: inv, tender, sessionEmail: null })
      expect(((await emailInvitationLinkAction(TOKEN)) as { error: string }).error).toMatch(text)
    }
    expect(h.minted).toEqual([])
    expect(h.sent).toEqual([])
  })

  it('does not even look up a malformed token', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await emailInvitationLinkAction('../../etc')).toHaveProperty('error')
    expect(w.lookedUpHash).toEqual([])
  })

  it('reports a failed send instead of claiming success', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    h.sendError = 'The email could not be sent.'
    expect(await emailInvitationLinkAction(TOKEN)).toEqual({ error: 'The email could not be sent.' })
  })
})

describe('continueInvitationAction (the Continue button from the email)', () => {
  it('uses the single-use sign-in by its hash, as the invited address', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await continueInvitationAction(TOKEN, K, 'signup')).toEqual({ data: true })
    expect(w.calls).toEqual([`verifyOtp:${JSON.stringify({ token_hash: K, type: 'signup' })}`])
  })

  it('signs straight back out if the link belongs to a different address', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null, verifiedEmail: 'someone@else.example' })
    expect(((await continueInvitationAction(TOKEN, K, 'magiclink')) as { error: string }).error).toMatch(/different address/)
    expect(w.calls.at(-1)).toBe('signOut')
  })

  it('says a used or expired link plainly, and offers the way out', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: null, verifiedEmail: null })
    expect(((await continueInvitationAction(TOKEN, K, 'magiclink')) as { error: string }).error).toMatch(/Email me a fresh link/)
  })

  it('never signs anyone in for an invitation that is no longer open', async () => {
    const w = world({ invitation: { ...INVITE, status: 'revoked' }, tender: OPEN, sessionEmail: null })
    expect(await continueInvitationAction(TOKEN, K, 'magiclink')).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })

  it('refuses an unknown sign-in type or a malformed hash without calling the auth server', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await continueInvitationAction(TOKEN, K, 'recovery')).toHaveProperty('error')
    expect(await continueInvitationAction(TOKEN, 'x y', 'magiclink')).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })
})

describe('continueInvitationWithCodeAction', () => {
  it('checks the code against the INVITED address, never one the caller supplies', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await continueInvitationWithCodeAction(TOKEN, ' 123456 ')).toEqual({ data: true })
    expect(w.calls[0]).toBe(`verifyOtp:${JSON.stringify({ email: 'bidder@co.example', token: '123456', type: 'email' })}`)
  })

  it('refuses a code that is not six digits without calling the auth server', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: null })
    expect(await continueInvitationWithCodeAction(TOKEN, '12345a')).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })
})

describe('requestTenderAccessAction (/tender/login)', () => {
  it('gives the same answer, and sends nothing, for an address with no invitation', async () => {
    world({ invitation: null, tender: null, sessionEmail: null, byAddress: [] })
    expect(await requestTenderAccessAction('nobody@co.example')).toEqual({ data: true })
    expect(h.sent).toEqual([])
  })

  it('sends a bidder who has not accepted yet back to the invitation itself, with a new link', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [{ id: 'inv', status: 'sent', tender: { status: 'issued', closing_at: FUTURE } }] })
    expect(await requestTenderAccessAction('bidder@co.example')).toEqual({ data: true })
    expect(w.updates).toHaveLength(1)
    expect(w.updates[0].table).toBe('tender_invitations')
    expect(Object.keys(w.updates[0].values)).toEqual(['token_hash'])
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].html).toMatch(/\/tender\/invite\/[A-Za-z0-9_-]{20,}\?k=/)
  })

  it('sends a bidder who has accepted to their tenders, changing nothing', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [{ id: 'inv', status: 'accepted', tender: { status: 'issued', closing_at: FUTURE } }] })
    expect(await requestTenderAccessAction('bidder@co.example')).toEqual({ data: true })
    expect(w.updates).toEqual([])
    expect(h.sent[0].html).toContain('/tender/login?k=')
  })

  it('does not reissue an invitation on a tender that has closed', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [{ id: 'inv', status: 'sent', tender: { status: 'issued', closing_at: '2000-01-01T00:00:00Z' } }] })
    await requestTenderAccessAction('bidder@co.example')
    expect(w.updates).toEqual([])
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
    expect(((await acceptInvitationAction(TOKEN)) as { error: string }).error).toMatch(/Continue/)
    expect(w.calls).toEqual([])
  })

  it('accepts through the database function, by hash only', async () => {
    const w = world({ invitation: INVITE, tender: OPEN, sessionEmail: 'bidder@co.example' })
    expect(await acceptInvitationAction(TOKEN)).toEqual({ data: { tenderId: 't1' } })
    expect(w.calls).toEqual(['rpc:tender_accept'])
    expect(w.rpcArgs).toEqual([{ p_token_hash: hashInvitationToken(TOKEN) }])
    expect(JSON.stringify(w.rpcArgs)).not.toContain(TOKEN)
  })

  it('explains a different signed-in account (the database refuses it)', async () => {
    world({ invitation: INVITE, tender: OPEN, sessionEmail: 'pm@wm.example', rpcError: { code: '42501', message: 'this invitation was sent to a different email address' } })
    expect(((await acceptInvitationAction(TOKEN)) as { error: string }).error).toMatch(/different email address/)
  })
})
