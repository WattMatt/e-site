// @vitest-environment node
/**
 * POST /api/paystack/subaccount — supplier payout onboarding (finding #7).
 *
 * This route decides WHERE A SUPPLIER'S MARKETPLACE PAYOUTS LAND. As shipped
 * it had:
 *
 *  - no role predicate at all — a session plus *any* active org membership was
 *    the whole check, so a contractor, inspector or client_viewer sharing an
 *    org with the supplier could bind a bank account;
 *  - an ambient `.eq('is_active', true).limit(1).single()` membership read with
 *    no `.order()`, so a multi-org caller was scoped to an ARBITRARY org;
 *  - the Paystack subaccount minted BEFORE any durable write, on the caller's
 *    anon-key cookie client — and marketplace.paystack_subaccounts has exactly
 *    one RLS policy (SELECT). The insert therefore fails 42501 every time, and
 *    the returned subaccount_code — already bound to a real SA bank account —
 *    existed only inside a console.error. Every retry minted another orphan;
 *  - `onConflict: 'supplier_id'`, i.e. designed to REPLACE an existing binding.
 *
 * THE FIXTURE RULE, twice over.
 *  1. Every authorisation test asserts that `createSubaccount` was NOT CALLED,
 *     not merely that the status was 403. A gate placed after the Paystack call
 *     returns the same 403 while still minting a live payout account against a
 *     stranger's bank details — the exact failure this route already had. Only
 *     the call-count assertion can fail on that.
 *  2. The org-less-supplier test asserts on the ARGUMENTS requireRole received.
 *     Passing `supplier.organisation_id ?? undefined` to requireRoleAPI silently
 *     falls back to the CALLER's primary org (require-role.ts:130-153), which
 *     would let any org admin anywhere bank an org-less supplier — and every
 *     status-code-only assertion would still be green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const SUPPLIER_ID = '77777777-7777-4777-8777-777777777777'
const SUPPLIER_ORG = '88888888-8888-4888-8888-888888888888'
const CALLER_ORG = '99999999-9999-4999-8999-999999999999'

const {
  authUser, supplierRow, existingSub, insertResult,
  requireRoleMock, createSubaccountMock, serviceInserts, errorLogs,
} = vi.hoisted(() => ({
  authUser: { value: { id: 'u-caller' } as { id: string } | null },
  supplierRow: { value: null as any },
  existingSub: { value: null as any },
  insertResult: { value: { error: null as any } },
  requireRoleMock: vi.fn(),
  createSubaccountMock: vi.fn(),
  serviceInserts: [] as any[],
  errorLogs: [] as unknown[][],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser.value }, error: null }) },
  }),
  createServiceClient: () => ({
    schema: (_s: string) => ({
      from: (t: string) => {
        const b: any = {}
        const chain = () => b
        b.select = chain
        b.eq = chain
        b.maybeSingle = async () => ({
          data: t === 'suppliers' ? supplierRow.value : existingSub.value,
          error: null,
        })
        b.insert = async (payload: any) => {
          serviceInserts.push(payload)
          return insertResult.value
        }
        return b
      },
    }),
  }),
}))

vi.mock('@/lib/auth/require-role', async () => {
  const actual = await vi.importActual<any>('@/lib/auth/require-role')
  return { ...actual, requireRole: (...a: unknown[]) => requireRoleMock(...a) }
})

vi.mock('@esite/db', () => ({
  getPaystackService: () => ({ createSubaccount: (...a: unknown[]) => createSubaccountMock(...a) }),
}))

import { POST } from './route'

function req(body: Record<string, unknown> = {}) {
  // The handler only ever calls req.json(); NextRequest's cookies/nextUrl are
  // never touched, so a minimal stub is honest here.
  return {
    json: async () => ({
      supplierId: SUPPLIER_ID,
      bankCode: '632005',
      accountNumber: '1234567890',
      businessName: 'Sparks Wholesale',
      ...body,
    }),
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.resetModules()
  authUser.value = { id: `u-${Math.random()}` } // fresh id per test: the limiter is per-user
  supplierRow.value = { id: SUPPLIER_ID, name: 'Sparks Wholesale', organisation_id: SUPPLIER_ORG }
  existingSub.value = null
  insertResult.value = { error: null }
  serviceInserts.length = 0
  errorLogs.length = 0
  requireRoleMock.mockReset()
  requireRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  createSubaccountMock.mockReset()
  createSubaccountMock.mockResolvedValue({ subaccount_code: 'ACCT_new01' })
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errorLogs.push(a) })
})

describe('POST /api/paystack/subaccount — nothing is minted before authorisation', () => {
  it('401 unauthenticated, no Paystack call', async () => {
    authUser.value = null
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(createSubaccountMock).not.toHaveBeenCalled()
  })

  it('403 when the caller is not owner/admin of the SUPPLIER\'s org — and mints nothing', async () => {
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    const res = await POST(req())
    expect(res.status).toBe(403)
    // The whole point of the ordering fix.
    expect(createSubaccountMock).not.toHaveBeenCalled()
    expect(serviceInserts).toHaveLength(0)
  })

  it('gates against the supplier\'s org, never the caller\'s', async () => {
    await POST(req())
    expect(requireRoleMock).toHaveBeenCalledTimes(1)
    const [, orgArg, roles] = requireRoleMock.mock.calls[0]
    expect(orgArg).toBe(SUPPLIER_ORG)
    expect(orgArg).not.toBe(CALLER_ORG)
    expect(roles).toEqual(expect.arrayContaining(['owner', 'admin']))
    expect(roles).not.toContain('contractor')
    expect(roles).not.toContain('client_viewer')
  })

  it('409 — never undefined — when the supplier has no organisation', async () => {
    supplierRow.value = { id: SUPPLIER_ID, name: 'Orphan Supply', organisation_id: null }
    const res = await POST(req())
    expect(res.status).toBe(409)
    // `?? undefined` would make requireRoleAPI fall back to the caller's own
    // primary org and pass. The gate must never have been consulted at all.
    expect(requireRoleMock).not.toHaveBeenCalled()
    for (const call of requireRoleMock.mock.calls) expect(call[1]).toBeDefined()
    expect(createSubaccountMock).not.toHaveBeenCalled()
  })

  it('404 for an unknown supplier, with no Paystack call', async () => {
    supplierRow.value = null
    const res = await POST(req())
    expect(res.status).toBe(404)
    expect(createSubaccountMock).not.toHaveBeenCalled()
  })

  it('400 on a malformed body before anything else happens', async () => {
    const res = await POST(req({ accountNumber: '123' }))
    expect(res.status).toBe(400)
    expect(createSubaccountMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/paystack/subaccount — an existing payout binding is never replaced', () => {
  it('409s when the supplier already has a subaccount, minting nothing', async () => {
    existingSub.value = { subaccount_code: 'ACCT_existing', supplier_org_id: SUPPLIER_ORG }
    const res = await POST(req())
    expect(res.status).toBe(409)
    // Re-binding payouts is the hijack primitive the old `onConflict:
    // 'supplier_id'` upsert handed to anyone who passed the (absent) gate.
    expect(createSubaccountMock).not.toHaveBeenCalled()
    expect(serviceInserts).toHaveLength(0)
    const body = await res.json()
    expect(body.subaccount_code).toBe('ACCT_existing')
  })
})

describe('POST /api/paystack/subaccount — the happy path persists, and a failure is recoverable', () => {
  it('creates the subaccount and writes the row bound to the SUPPLIER org', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ subaccount_code: 'ACCT_new01' })
    expect(serviceInserts).toHaveLength(1)
    expect(serviceInserts[0]).toMatchObject({
      supplier_id: SUPPLIER_ID,
      supplier_org_id: SUPPLIER_ORG,
      subaccount_code: 'ACCT_new01',
    })
  })

  it('a failed write returns the subaccount_code so it is not lost', async () => {
    insertResult.value = { error: { message: 'boom', code: 'XX000' } }
    const res = await POST(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    // The original bug: the code existed ONLY inside console.error, so the
    // live Paystack subaccount bound to a real bank account was unrecoverable.
    expect(body.subaccount_code).toBe('ACCT_new01')
    const logged = JSON.stringify(errorLogs)
    expect(logged).toContain('ACCT_new01')
    expect(logged).toContain('PAYSTACK_SUBACCOUNT_ORPHAN')
  })

  it('rate limits repeated attempts by the same user', async () => {
    const codes: number[] = []
    for (let i = 0; i < 7; i++) {
      createSubaccountMock.mockResolvedValue({ subaccount_code: `ACCT_${i}` })
      existingSub.value = null
      codes.push((await POST(req())).status)
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
    // A rate limit that fires only after the Paystack call is worthless.
    expect(createSubaccountMock.mock.calls.length).toBeLessThan(7)
  })
})
