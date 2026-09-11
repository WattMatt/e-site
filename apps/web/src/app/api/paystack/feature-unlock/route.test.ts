// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/paystack/feature-unlock initialises the one-time charge. Two properties
 * are pinned, both of which were wrong in production:
 *
 *  1. `cancel_action` was hardcoded to `/inspections/unlock` for EVERY feature,
 *     so a JBCC buyer (R1,999) who pressed cancel was sent to the Inspections
 *     paywall — a page about a module they were not buying.
 *
 *  2. The metadata carried no `return_to`, and the callback bailed to
 *     `/settings/billing?error=meta` for anything without a `tier`. Every
 *     successful unlock therefore dumped the payer on an unrelated page with no
 *     confirmation — the realistic path into paying a second time.
 *
 * `return_to` is now caller-supplied, which makes it an open-redirect vector:
 * it is written into Paystack metadata and comes back in the verify response,
 * where `new URL(x, req.url)` will follow an absolute URL off-site. It must be
 * validated HERE too, not only on the way back.
 */

const { getUserMock, membershipResult, hasFeatureMock, fetchMock } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'
  return {
    getUserMock: vi.fn(),
    membershipResult: { value: { data: null as any, error: null as any } },
    hasFeatureMock: vi.fn(),
    fetchMock: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => {
      const api: any = {
        select: () => api,
        eq: () => api,
        in: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: () => Promise.resolve(membershipResult.value),
      }
      return api
    },
  }),
}))

vi.mock('@/lib/features', () => ({ hasFeature: (...a: unknown[]) => hasFeatureMock(...a) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST } from './route'

const ORG_ID = 'dddddddd-0000-0000-0000-000000000001'

function req(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

/** The metadata object this route actually sent to Paystack. */
function sentMetadata() {
  const init = JSON.parse(fetchMock.mock.calls[0][1].body)
  return init.metadata as Record<string, string>
}

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', email: 'a@b.co' } }, error: null })
  membershipResult.value = { data: { organisation_id: ORG_ID, role: 'owner' }, error: null }
  hasFeatureMock.mockReset().mockResolvedValue(false)
  fetchMock.mockReset().mockResolvedValue({
    json: async () => ({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/paystack/feature-unlock — cancel destination', () => {
  it('does not send a JBCC buyer to the Inspections paywall on cancel', async () => {
    await POST(req({ feature_key: 'jbcc' }))
    expect(sentMetadata().cancel_action).not.toContain('/inspections')
  })

  it('sends an inspections buyer somewhere about inspections', async () => {
    await POST(req({ feature_key: 'inspections' }))
    expect(sentMetadata().cancel_action).toContain('/inspections')
  })

  it('honours an explicit return_to for the cancel destination too', async () => {
    await POST(req({ feature_key: 'jbcc', return_to: '/projects/p1/jbcc' }))
    expect(sentMetadata().cancel_action).toContain('/projects/p1/jbcc')
  })
})

describe('POST /api/paystack/feature-unlock — return_to reaches the callback', () => {
  it('carries the caller-supplied path in the metadata', async () => {
    await POST(req({ feature_key: 'jbcc', return_to: '/projects/p1/jbcc' }))
    expect(sentMetadata().return_to).toBe('/projects/p1/jbcc')
  })

  it('always carries SOME return_to, so the callback can never fall to error=meta', async () => {
    await POST(req({ feature_key: 'jbcc' }))
    expect(sentMetadata().return_to).toBeTruthy()
    expect(sentMetadata().return_to.startsWith('/')).toBe(true)
  })

  it.each([
    '//evil.test/pwn',
    'https://evil.test',
    'javascript:alert(1)',
    '\\\\evil.test',
    'projects/p1/jbcc',
  ])('never forwards the hostile value %s to Paystack', async (hostile) => {
    await POST(req({ feature_key: 'jbcc', return_to: hostile }))
    const meta = sentMetadata()
    expect(meta.return_to).not.toContain('evil.test')
    expect(meta.return_to.startsWith('/')).toBe(true)
    expect(meta.return_to.startsWith('//')).toBe(false)
    // The cancel URL is built from the same value and must stay on-origin.
    expect(new URL(meta.cancel_action).origin).toBe('https://www.e-site.live')
  })
})

describe('POST /api/paystack/feature-unlock — existing gates are untouched', () => {
  it('still refuses a non-owner/admin', async () => {
    membershipResult.value = { data: null, error: null }
    const res = await POST(req({ feature_key: 'jbcc' }))
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still refuses an unauthenticated caller', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(req({ feature_key: 'jbcc' }))
    expect(res.status).toBe(401)
  })

  it('still 409s when the org already holds the feature', async () => {
    hasFeatureMock.mockResolvedValue(true)
    const res = await POST(req({ feature_key: 'jbcc' }))
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still rejects an unknown feature key', async () => {
    const res = await POST(req({ feature_key: 'not_a_feature' }))
    expect(res.status).toBe(400)
  })

  it('rejects a return_to that is not a string rather than crashing', async () => {
    const res = await POST(req({ feature_key: 'jbcc', return_to: { evil: true } }))
    // Either a 400 from the schema or a fallback path — never a 500, and never
    // the attacker's object in the metadata.
    expect(res.status).not.toBe(500)
    if (fetchMock.mock.calls.length > 0) {
      expect(typeof sentMetadata().return_to).toBe('string')
    }
  })
})
