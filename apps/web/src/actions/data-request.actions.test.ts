// @vitest-environment node
/**
 * The public POPIA form must reach send-email as an AUTHENTICATED caller.
 *
 * `data-subject-request` is the one type send-email accepts without a
 * service-role credential, and that exemption is what made the function an
 * open relay (audit 2026-09-10). The exemption can only be withdrawn once the
 * one legitimate anonymous caller — this action — stops being anonymous, and
 * it must already be authenticated before the Supabase gateway is switched to
 * verifying JWTs, or the published privacy notice's request form starts 401ing
 * the moment the deploy flag changes.
 *
 * The fixture asserts which client actually carried the invoke, so swapping
 * back to the SSR anon client turns it red.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokes: { client: 'anon' | 'service'; args: any[] }[] = []

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.7' }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    functions: {
      invoke: async (...args: any[]) => {
        invokes.push({ client: 'anon', args })
        return { error: null }
      },
    },
  }),
  createServiceClient: () => ({
    functions: {
      invoke: async (...args: any[]) => {
        invokes.push({ client: 'service', args })
        return { error: null }
      },
    },
  }),
}))

async function submit(over: Record<string, string> = {}) {
  const { submitDataRequestAction } = await import('./data-request.actions')
  const fd = new FormData()
  const fields: Record<string, string> = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    requestType: 'access',
    description: 'Please send me a copy of everything you hold about me.',
    ...over,
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return submitDataRequestAction(fd)
}

beforeEach(() => {
  invokes.length = 0
  vi.resetModules()
})

describe('submitDataRequestAction', () => {
  it('invokes send-email with the service-role client, never the anon client', async () => {
    const res = await submit()
    expect(res.ok).toBe(true)
    expect(invokes).toHaveLength(1)
    expect(invokes[0].client).toBe('service')
  })

  it('still sends the request type the hardened function validates against', async () => {
    await submit({ requestType: 'deletion' })
    const body = invokes[0].args[1].body
    expect(body.type).toBe('data-subject-request')
    expect(body.payload.requestType).toBe('deletion')
    expect(body.payload.requester).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })
})
