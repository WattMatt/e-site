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
  acceptPendingInvitationAction,
  continueReturnVisitWithCodeAction,
  pendingInvitationsAction,
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
  pending?: Row[]
  rekeyed?: Row[]
}) {
  const calls: string[] = []
  const lookedUpHash: string[] = []
  const rpcArgs: unknown[] = []
  const updates: { table: string; values: Row; filters: [string, unknown][] }[] = []
  const filters: [string, unknown][] = []
  h.svc = {
    schema: () => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (k: string, v: string) => {
          if (k === 'token_hash') lookedUpHash.push(v)
          filters.push([k, v])
          return q
        }
        q.ilike = (k: string, v: string) => { filters.push([`ILIKE ${k}`, v]); return q }
        q.in = () => q
        q.order = () => q
        q.limit = () => Promise.resolve({ data: w.pending ?? w.byAddress ?? [] })
        q.maybeSingle = () => Promise.resolve({ data: table === 'tender_invitations' ? w.invitation : table === 'tenders' ? w.tender : { name: 'Project' } })
        q.insert = () => { calls.push(`SERVICE insert:${table}`); return Promise.resolve({ error: null }) }
        q.update = (values: Row) => {
          const rec = { table, values, filters: [] as [string, unknown][] }
          updates.push(rec)
          const u: Record<string, unknown> = {}
          u.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return u }
          u.in = (k: string, v: unknown) => { rec.filters.push([k, v]); return u }
          u.select = () => Promise.resolve({ data: w.rekeyed ?? [{ id: 'inv' }], error: null })
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
  return { calls, lookedUpHash, rpcArgs, updates, filters }
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

  it('emails a return link and NEVER touches an invitation (anyone may ask for any address)', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [{ id: 'inv' }] })
    expect(await requestTenderAccessAction('bidder@co.example')).toEqual({ data: true })
    expect(w.updates).toEqual([])
    expect(h.minted).toEqual(['bidder@co.example'])
    expect(h.sent[0].html).toContain('/tender/login?k=')
  })

  it('matches the address exactly: LIKE wildcards are just characters', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [] })
    await requestTenderAccessAction('%@co.example')
    expect(w.filters.some(([k]) => String(k).startsWith('ILIKE'))).toBe(false)
    expect(w.filters).toContainEqual(['email', '%@co.example'])
  })
})

describe('continueReturnVisitWithCodeAction', () => {
  it('does not try a code for an address that has no tender invitation', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [] })
    expect(await continueReturnVisitWithCodeAction('wm-user@wm.example', '123456')).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })

  it('tries the code for an invited address', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null, byAddress: [{ id: 'inv' }] })
    expect(await continueReturnVisitWithCodeAction('bidder@co.example', '123456')).toEqual({ data: true })
    expect(w.calls[0]).toContain('verifyOtp')
  })
})

describe('pendingInvitationsAction / acceptPendingInvitationAction (accept from /tender, no link needed)', () => {
  it('lists only invitations on tenders that are still open', async () => {
    world({
      invitation: null, tender: null, sessionEmail: 'bidder@co.example',
      pending: [
        { id: 'a', company_name: 'Bidder', tender: { package: 'Electrical', title: 'Main', status: 'issued', closing_at: FUTURE } },
        { id: 'b', company_name: 'Bidder', tender: { package: 'Electrical', title: 'Old', status: 'issued', closing_at: '2000-01-01T00:00:00Z' } },
      ],
    })
    expect(((await pendingInvitationsAction()) as { data: { id: string }[] }).data.map((p) => p.id)).toEqual(['a'])
  })

  it('re-keys only an invitation to the SESSION address, then accepts through tender_accept', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: 'Bidder@Co.Example' })
    expect(await acceptPendingInvitationAction('inv')).toEqual({ data: { tenderId: 't1' } })
    expect(w.updates[0].filters).toContainEqual(['email', 'bidder@co.example'])
    expect(w.updates[0].filters).toContainEqual(['status', ['prepared', 'sent']])
    expect(w.rpcArgs).toEqual([{ p_token_hash: w.updates[0].values.token_hash }])
  })

  it('accepts nothing when the invitation is not to this address (nothing re-keyed)', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: 'someone@else.example', rekeyed: [] })
    expect(await acceptPendingInvitationAction('inv')).toHaveProperty('error')
    expect(w.calls).toEqual([])
  })

  it('needs a session', async () => {
    const w = world({ invitation: null, tender: null, sessionEmail: null })
    expect(await acceptPendingInvitationAction('inv')).toHaveProperty('error')
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
