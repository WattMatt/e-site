// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OWNER_ADMIN } from '@esite/shared'

/**
 * /api/paystack/solar-subscribe starts the ORG-wide Solar subscription (D-01).
 *
 * Properties pinned:
 *  - the org is derived from the PROJECT, never from the caller's oldest org
 *    (requireRoleAPI's default) — a multi-org owner must buy for the project's
 *    org, and an owner of org A must not be able to buy "for" org B's project;
 *  - OWNER_ADMIN of that org only;
 *  - 409 when the org already has Solar (no second charge);
 *  - the route WRITES NOTHING: no service client is ever created — the
 *    webhook is the single writer (spec §1.2 "Writes nothing until the webhook");
 *  - return_to is the project's Solar LOCKED page flagged payment=received
 *    (owner default: the locked page sits outside the gated group and shows
 *    "activating Solar…"), and cancel_action is the same page, unflagged.
 */

const PROJECT_ID = '5a0e8f7c-1b2d-4c3e-9f4a-6b7c8d9e0f1a'
const PROJECT_ORG = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const {
  getUserMock,
  projectResult,
  projectFilters,
  requireRoleMock,
  orgHasSolarMock,
  rateLimitMock,
  fetchMock,
  serviceClientMock,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'
  return {
    getUserMock: vi.fn(),
    projectResult: { value: { data: null as any, error: null as any } },
    projectFilters: [] as Array<[string, unknown]>,
    requireRoleMock: vi.fn(),
    orgHasSolarMock: vi.fn(),
    rateLimitMock: vi.fn(),
    fetchMock: vi.fn(),
    serviceClientMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    schema: (s: string) => ({
      from: (t: string) => {
        const api: any = {
          select: () => api,
          eq: (c: string, v: unknown) => {
            projectFilters.push([`${s}.${t}.${c}`, v])
            return api
          },
          maybeSingle: () => Promise.resolve(projectResult.value),
        }
        return api
      },
    }),
  }),
  createServiceClient: (...a: unknown[]) => serviceClientMock(...a),
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a),
}))
vi.mock('@/lib/solar/access', () => ({
  orgHasSolar: (...a: unknown[]) => orgHasSolarMock(...a),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...a: unknown[]) => rateLimitMock(...a),
}))

import { POST } from './route'

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

function sentInit() {
  return JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, any>
}

beforeEach(() => {
  process.env.PAYSTACK_PLAN_SOLAR_ANNUAL = 'PLN_solar_annual'
  projectFilters.length = 0
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-owner', email: 'owner@org.co' } }, error: null })
  projectResult.value = { data: { id: PROJECT_ID, organisation_id: PROJECT_ORG }, error: null }
  requireRoleMock.mockReset().mockResolvedValue({ ok: true, role: 'owner' })
  orgHasSolarMock.mockReset().mockResolvedValue(false)
  rateLimitMock.mockReset().mockReturnValue(true)
  serviceClientMock.mockReset()
  fetchMock.mockReset().mockResolvedValue({
    json: async () => ({ status: true, data: { authorization_url: 'https://checkout.paystack.com/solar' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/paystack/solar-subscribe — configuration', () => {
  it('503s when the Solar plan is not configured, before touching the session', async () => {
    delete process.env.PAYSTACK_PLAN_SOLAR_ANNUAL
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Solar subscription plan not configured')
    expect(getUserMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/paystack/solar-subscribe — gates', () => {
  it('401s without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(401)
  })

  it('429s past 5 per minute per user', async () => {
    rateLimitMock.mockReturnValue(false)
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(429)
    expect(rateLimitMock).toHaveBeenCalledWith('solar-subscribe:u-owner', 5, 60_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ project_id: 'not-a-uuid' }], [{ project_id: 42 }], [null]])(
    '400s on a malformed body %j',
    async (body) => {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('400s when the body is not JSON rather than 500ing', async () => {
    const bad = { json: async () => { throw new SyntaxError('bad json') } } as unknown as Parameters<typeof POST>[0]
    const res = await POST(bad)
    expect(res.status).toBe(400)
  })

  it('reads the project by id through the CALLER session', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(projectFilters).toContainEqual(['projects.projects.id', PROJECT_ID])
  })

  it('403s for a project the caller cannot see, and never reaches the role gate', async () => {
    projectResult.value = { data: null, error: null }
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(requireRoleMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("gates on OWNER_ADMIN of the PROJECT's org — not the caller's primary org", async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(requireRoleMock).toHaveBeenCalledTimes(1)
    expect(requireRoleMock.mock.calls[0][1]).toBe(PROJECT_ORG)
    expect(requireRoleMock.mock.calls[0][2]).toEqual(OWNER_ADMIN)
  })

  it('403s a non-owner/admin with the SAME body as an invisible project — no existence oracle', async () => {
    projectResult.value = { data: null, error: null }
    const hidden = await (await POST(req({ project_id: PROJECT_ID }))).json()
    projectResult.value = { data: { id: PROJECT_ID, organisation_id: PROJECT_ORG }, error: null }
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(hidden)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('409s when the org already has Solar — asked about the PROJECT org', async () => {
    orgHasSolarMock.mockResolvedValue(true)
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(409)
    expect((await res.json()).alreadySubscribed).toBe(true)
    expect(orgHasSolarMock.mock.calls[0][0]).toBe(PROJECT_ORG)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/paystack/solar-subscribe — Paystack initialize', () => {
  it('subscribes to the Solar annual PLAN, sends no amount, and returns the hosted URL', async () => {
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authorization_url: 'https://checkout.paystack.com/solar' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/transaction/initialize')
    const init = sentInit()
    expect(init.plan).toBe('PLN_solar_annual')
    expect(init).not.toHaveProperty('amount')
    expect(init.currency).toBe('ZAR')
    expect(init.email).toBe('owner@org.co')
    expect(init.callback_url).toBe('https://www.e-site.live/api/paystack/callback')
  })

  it('carries the metadata the webhook and callback key on', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(sentInit().metadata).toMatchObject({
      type: 'org_addon_subscription',
      feature_key: 'solar',
      org_id: PROJECT_ORG,
      project_id: PROJECT_ID,
      user_id: 'u-owner',
      return_to: `/projects/${PROJECT_ID}/solar/locked?payment=received`,
    })
  })

  it('keeps cancel_action on-origin, on the project Solar locked page, and NOT flagged as paid', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    const cancel = new URL(sentInit().metadata.cancel_action)
    expect(cancel.origin).toBe('https://www.e-site.live')
    expect(cancel.pathname).toBe(`/projects/${PROJECT_ID}/solar/locked`)
    expect(cancel.searchParams.has('payment')).toBe(false)
  })

  it('writes NOTHING — no service client is ever created', async () => {
    await POST(req({ project_id: PROJECT_ID }))
    expect(serviceClientMock).not.toHaveBeenCalled()
  })

  it('400s when the account has no email — Paystack cannot initialise without one', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u-owner', email: null } }, error: null })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('502s (not an unhandled 500) when the Paystack request throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(502)
  })

  it('502s when Paystack refuses', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ status: false, message: 'Invalid plan' }) })
    const res = await POST(req({ project_id: PROJECT_ID }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Invalid plan')
  })
})
