import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { gateMock, svcMock, cookieMock, revalidateMock, sendMock } = vi.hoisted(() => ({
  gateMock: vi.fn(),
  svcMock: vi.fn(),
  cookieMock: vi.fn(),
  revalidateMock: vi.fn(),
  sendMock: vi.fn(),
}))
vi.mock('@esite/shared', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  filterSuppressed: async (_svc: unknown, emails: string[]) => ({ allowed: emails, suppressed: [] }),
}))
vi.mock('@/lib/tender/access', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  mintTenderAccess: async () => ({ tokenHash: 'a'.repeat(56), type: 'magiclink', code: '123456' }),
  sendTenderEmail: sendMock,
}))
vi.mock('@/lib/tender/gate', () => ({
  gateTender: gateMock,
  tenderPrefix: (t: { organisation_id: string; project_id: string; id: string }) => `${t.organisation_id}/${t.project_id}/${t.id}/`,
  tenderInvitesEnabled: () => process.env.TENDER_INVITES_ENABLED === 'true',
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: svcMock, createClient: cookieMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }))

import { prepareInvitationsAction, sendTenderInvitationsAction, issueTenderAction, revokeInvitationAction } from './tender-invite.actions'
import { hashInvitationToken } from '@/lib/tender/invitation'

const TENDER = { id: 't1', project_id: 'p1', organisation_id: 'o1', status: 'issued', closing_at: '2099-01-01T00:00:00Z', package: 'Electrical', title: 'Main' }

function recorder(insertResult: (row: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } }) {
  const inserts: Record<string, unknown>[] = []
  const updates: { payload: unknown; filters: Record<string, unknown> }[] = []
  const from = () => {
    let payload: unknown
    const filters: Record<string, unknown> = {}
    const q: Record<string, unknown> = {}
    q.insert = (row: Record<string, unknown>) => {
      inserts.push(row)
      q.single = () => Promise.resolve(insertResult(row))
      return q
    }
    q.update = (p: unknown) => {
      payload = p
      updates.push({ payload, filters })
      return q
    }
    q.select = () => q
    q.eq = (k: string, v: unknown) => ((filters[k] = v), q)
    q.in = (k: string, v: unknown) => ((filters[k] = v), q)
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'x' }], error: null }).then(res)
    return q
  }
  return { client: { schema: () => ({ from }) }, inserts, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TENDER_INVITES_ENABLED
})
afterEach(() => {
  delete process.env.TENDER_INVITES_ENABLED
})

describe('gate first', () => {
  it('prepare writes nothing when the caller is refused', async () => {
    gateMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const r = await prepareInvitationsAction('t1', [{ companyName: 'A', email: 'a@x.example' }])
    expect(r).toEqual({ error: 'Your role (contractor) is not allowed' })
  })

  it('issue writes nothing when refused, and validates the date before the gate', async () => {
    expect(await issueTenderAction('t1', 'not a date')).toEqual({ error: 'Closing time is not a valid date' })
    expect(gateMock).not.toHaveBeenCalled()
    gateMock.mockResolvedValue({ ok: false, error: 'nope' })
    expect(await issueTenderAction('t1', '2099-01-01T00:00:00Z')).toEqual({ error: 'nope' })
  })
})

describe('prepareInvitationsAction', () => {
  it('stores only a hash, returns each link once, and reports bad rows', async () => {
    const rec = recorder((row) => ({ data: { id: `id-${row.email}`, email: row.email } }))
    gateMock.mockResolvedValue({ ok: true, supabase: rec.client, tender: TENDER })
    const r = await prepareInvitationsAction('t1', [
      { companyName: 'Alpha', email: 'Ann@Alpha.example' },
      { companyName: 'Beta', email: 'not-an-email' },
      { companyName: '', email: 'c@x.example' },
      { companyName: 'Alpha again', email: 'ann@alpha.example' },
    ])
    if (!('data' in r)) throw new Error(r.error)
    expect(r.data.prepared).toHaveLength(1)
    const link = r.data.prepared[0].link
    const token = link.split('/tender/invite/')[1]
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rec.inserts).toHaveLength(1)
    expect(rec.inserts[0]).toMatchObject({ email: 'ann@alpha.example', token_hash: hashInvitationToken(token), token_expires_at: null })
    expect(JSON.stringify(rec.inserts)).not.toContain(token)
    expect(r.data.rejected.map((x) => x.reason)).toEqual(['not a valid email address', 'company name is required', 'listed twice'])
  })

  it('reports an address already invited to this tender', async () => {
    const rec = recorder(() => ({ error: { code: '23505', message: 'duplicate key' } }))
    gateMock.mockResolvedValue({ ok: true, supabase: rec.client, tender: TENDER })
    const r = await prepareInvitationsAction('t1', [{ companyName: 'Alpha', email: 'ann@alpha.example' }])
    expect(r).toEqual({ data: { prepared: [], rejected: [{ email: 'ann@alpha.example', reason: 'already invited to this tender' }] } })
  })
})

describe('sendTenderInvitationsAction', () => {
  it('refuses while the owner switch is off, before touching anything', async () => {
    const r = await sendTenderInvitationsAction('t1', ['i1'])
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toMatch(/switched off/)
    expect(gateMock).not.toHaveBeenCalled()
    expect(svcMock).not.toHaveBeenCalled()
  })
})

describe('sendTenderInvitationsAction (switched on)', () => {
  function sendWorld() {
    const updates: Record<string, unknown>[] = []
    const invs = [{ id: 'i1', email: 'bidder@co.example', company_name: 'Bidder', contact_name: null, status: 'prepared' }]
    const from = () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.in = () => q
      q.maybeSingle = () => Promise.resolve({ data: { name: 'Name' } })
      q.update = (p: Record<string, unknown>) => {
        updates.push(p)
        const u: Record<string, unknown> = {}
        u.eq = () => u
        u.in = () => u
        u.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
        return u
      }
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: invs, error: null }).then(res)
      return q
    }
    const client = { schema: () => ({ from }), from }
    gateMock.mockResolvedValue({ ok: true, tender: TENDER, supabase: client })
    svcMock.mockReturnValue(client)
    process.env.TENDER_INVITES_ENABLED = 'true'
    return { updates }
  }

  it('stores the new link first, emails it, and only then marks the invitation sent', async () => {
    const w = sendWorld()
    sendMock.mockResolvedValue({ data: true })
    expect(await sendTenderInvitationsAction('t1', ['i1'])).toEqual({ data: { sent: 1, skipped: [] } })
    expect(Object.keys(w.updates[0]).sort()).toEqual(['token_expires_at', 'token_hash'])
    expect(w.updates[1]).toMatchObject({ status: 'sent' })
    expect(sendMock.mock.calls[0][0]).toBe('bidder@co.example')
    expect(sendMock.mock.calls[0][2]).toMatch(/\/tender\/invite\/[A-Za-z0-9_-]{20,}\?k=a{56}&amp;t=magiclink/)
  })

  it('never marks an invitation sent when the email did not go, and says so', async () => {
    const w = sendWorld()
    sendMock.mockResolvedValue({ error: 'The email could not be sent.' })
    expect(await sendTenderInvitationsAction('t1', ['i1'])).toEqual({ data: { sent: 0, skipped: ['bidder@co.example (The email could not be sent.)'] } })
    expect(w.updates.some((u) => u.status === 'sent')).toBe(false)
  })
})

describe('revokeInvitationAction', () => {
  it('clears the token hash so the link stops working', async () => {
    const rec = recorder(() => ({}))
    // The invitation is read AS THE CALLER (row security + site_scope), never with the service key.
    cookieMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'i1', tender_id: 't1', status: 'prepared', email: 'a@x.example', company_name: 'A' } }) }) }) }) }),
    })
    gateMock.mockResolvedValue({ ok: true, supabase: rec.client, tender: TENDER })
    await revokeInvitationAction('i1')
    expect(rec.updates[0].payload).toEqual({ status: 'revoked', token_hash: null })
    expect(svcMock).not.toHaveBeenCalled()
    expect(rec.updates[0].filters).toMatchObject({ id: 'i1', tender_id: 't1' })
  })
})

describe('readTenderListAction', () => {
  it('refuses any file that is not this tender\'s list upload, and deletes nothing', async () => {
    const removed: string[][] = []
    svcMock.mockReturnValue({ storage: { from: () => ({ download: vi.fn(), remove: (p: string[]) => removed.push(p) }) } })
    gateMock.mockResolvedValue({ ok: true, supabase: {}, tender: TENDER })
    const { readTenderListAction } = await import('./tender-invite.actions')
    for (const p of ['o1/p1/t1/source-1700000000000-R9.xlsx', 'o1/p1/t1/estimate-17-x.xlsx', 'o1/p1/t2/list-1-x.xlsx', 'o1/p1/t1/list-1-../x.xlsx', 'o1/p1/t1/list-abc-x.xlsx']) {
      expect(await readTenderListAction('t1', p)).toEqual({ error: 'That file is not a tender list upload of this tender' })
    }
    expect(removed).toEqual([])
  })
})

describe('revokeInvitationAction (status scope)', () => {
  it('only touches a live invitation', async () => {
    const rec = recorder(() => ({}))
    // The invitation is read AS THE CALLER (row security + site_scope), never with the service key.
    cookieMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'i1', tender_id: 't1', status: 'sent', email: 'a@x.example', company_name: 'A' } }) }) }) }) }),
    })
    gateMock.mockResolvedValue({ ok: true, supabase: rec.client, tender: TENDER })
    await revokeInvitationAction('i1')
    expect(rec.updates[0].filters).toMatchObject({ status: ['prepared', 'sent'] })
  })
})
