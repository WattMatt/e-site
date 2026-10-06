// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { consumeWaLink, type WaLinkDeps } from './wa-link'

const P = '11111111-1111-4111-8111-111111111111'
const I = '22222222-2222-4222-8222-222222222222'
const TARGET = `/projects/${P}/inspections/${I}`
let row: { user_id: string; target_path: string } | null
let role: string | null
let calls: string[]
const TOK = 'A'.repeat(43)

function deps(): WaLinkDeps {
  return {
    hash: (t) => `h(${t})`,
    consume: vi.fn(async (h: string) => { calls.push(`consume ${h}`); const r = row; row = null; return r }),
    projectRole: vi.fn(async (p: string, u: string) => { calls.push(`role ${p} ${u}`); return role }),
    emailFor: vi.fn(async () => 'wa-x@wa.e-site.live'),
    magicLinkHash: vi.fn(async (email: string) => { calls.push(`generate ${email}`); return 'GOTRUE' }),
    signIn: vi.fn(async (h: string) => { calls.push(`verify ${h}`); return true }),
    audit: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  row = { user_id: 'u-1', target_path: TARGET }
  role = 'contractor'
  calls = []
})

describe('consumeWaLink', () => {
  it('consumes the token once, re-checks the project role, signs the person in, and goes to the form', async () => {
    const d = deps()
    expect(await consumeWaLink(TOK, d)).toEqual({ ok: true, redirectTo: TARGET })
    expect(calls).toEqual([`consume h(${TOK})`, `role ${P} u-1`, 'generate wa-x@wa.e-site.live', 'verify GOTRUE'])
    expect(d.audit).toHaveBeenCalledWith('u-1')
  })
  it('a second use, an unknown or an expired token is refused and signs nobody in', async () => {
    const d = deps()
    await consumeWaLink(TOK, d)
    calls = []
    expect(await consumeWaLink(TOK, d)).toEqual({ ok: false, reason: 'expired' })
    expect(calls).toEqual([`consume h(${TOK})`])
  })
  it('refuses someone who lost the project, or is only a client viewer, after the link was sent', async () => {
    for (const r of [null, 'client_viewer']) {
      row = { user_id: 'u-1', target_path: TARGET }
      role = r
      const d = deps()
      expect(await consumeWaLink(TOK, d)).toEqual({ ok: false, reason: 'not_available' })
      expect(d.signIn).not.toHaveBeenCalled()
    }
  })
  it('never redirects anywhere but an inspection page, whatever the row says', async () => {
    row = { user_id: 'u-1', target_path: 'https://evil.example/x' }
    const d = deps()
    expect(await consumeWaLink(TOK, d)).toEqual({ ok: false, reason: 'not_available' })
    expect(d.signIn).not.toHaveBeenCalled()
  })
  it('a malformed token is refused before any lookup', async () => {
    const d = deps()
    expect(await consumeWaLink('../../x', d)).toEqual({ ok: false, reason: 'expired' })
    expect(d.consume).not.toHaveBeenCalled()
  })
  it('a failed sign-in is reported, not redirected', async () => {
    const d = deps()
    d.signIn = vi.fn(async () => false)
    expect(await consumeWaLink(TOK, d)).toEqual({ ok: false, reason: 'sign_in_failed' })
  })
})
