import { describe, it, expect } from 'vitest'
import { signOAuthState, verifyOAuthState } from '../utils/oauth-state'

const SECRET = 'a'.repeat(40) // >= 32 chars

describe('OAuth state token signing', () => {
  it('round-trips a payload with all context fields', async () => {
    const state = await signOAuthState(
      { uid: 'user-1', orgId: 'org-1', provider: 'dropbox' },
      { secret: SECRET },
    )
    const payload = await verifyOAuthState(state, { secret: SECRET })
    expect(payload.uid).toBe('user-1')
    expect(payload.orgId).toBe('org-1')
    expect(payload.provider).toBe('dropbox')
    expect(typeof payload.nonce).toBe('string')
    expect(typeof payload.exp).toBe('number')
    expect(payload.exp).toBeGreaterThan(Date.now())
  })

  it('produces a non-deterministic state (fresh nonce + exp each call)', async () => {
    const a = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'google_drive' }, { secret: SECRET })
    const b = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'google_drive' }, { secret: SECRET })
    expect(a).not.toBe(b)
  })

  it('rejects a state signed with a different secret', async () => {
    const state = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'onedrive' }, { secret: SECRET })
    await expect(
      verifyOAuthState(state, { secret: 'b'.repeat(40) }),
    ).rejects.toThrow(/signature/)
  })

  it('rejects a malformed state (wrong number of parts)', async () => {
    await expect(verifyOAuthState('only-one-part', { secret: SECRET })).rejects.toThrow(/malformed/)
    await expect(verifyOAuthState('a.b.c', { secret: SECRET })).rejects.toThrow(/malformed/)
  })

  it('rejects a tampered payload (signature mismatch)', async () => {
    const state = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'dropbox' }, { secret: SECRET })
    const [b64, sig] = state.split('.')
    // Re-encode a payload with a different uid; signature now won't match.
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(b64!))) as Record<string, unknown>
    payload.uid = 'attacker'
    const tampered = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload))) + '.' + sig
    await expect(verifyOAuthState(tampered, { secret: SECRET })).rejects.toThrow(/signature/)
  })

  it('rejects an expired state', async () => {
    // Sign with a "now" 11 minutes ago — exp = (now-11min) + 10min = 1min ago.
    const past = Date.now() - 11 * 60 * 1000
    const state = await signOAuthState(
      { uid: 'u', orgId: 'o', provider: 'dropbox' },
      { secret: SECRET, now: past },
    )
    await expect(verifyOAuthState(state, { secret: SECRET })).rejects.toThrow(/expired/)
  })

  it('rejects a provider mismatch on verify', async () => {
    const state = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'dropbox' }, { secret: SECRET })
    await expect(
      verifyOAuthState(state, { secret: SECRET, expectedProvider: 'google_drive' }),
    ).rejects.toThrow(/provider mismatch/)
  })

  it('rejects a too-short secret', async () => {
    await expect(
      signOAuthState({ uid: 'u', orgId: 'o', provider: 'dropbox' }, { secret: 'short' }),
    ).rejects.toThrow(/32 chars/)
  })

  it('verifies state issued at provider claim', async () => {
    const state = await signOAuthState({ uid: 'u', orgId: 'o', provider: 'onedrive' }, { secret: SECRET })
    const payload = await verifyOAuthState(state, {
      secret: SECRET,
      expectedProvider: 'onedrive',
    })
    expect(payload.provider).toBe('onedrive')
  })
})

// Helpers used by the tampering test.
function base64UrlDecode(s: string): Uint8Array {
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4) b += '='
  const bin = atob(b)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
