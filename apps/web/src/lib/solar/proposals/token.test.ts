import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { hashShareToken, isShareToken, newShareToken } from './token'

describe('share token (spec §5 item 6)', () => {
  it('is 32 random bytes, base64url (43 chars), and differs every time', () => {
    const a = newShareToken(), b = newShareToken()
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
  })
  it('stores only the SHA-256 hex of the token — the same formula as solar.proposal_hash_token()', () => {
    const { token, hash } = newShareToken()
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
    expect(hashShareToken(token)).toBe(hash)
  })
  it('recognises only the token shape (the stored hash is not a token)', () => {
    const { token, hash } = newShareToken()
    expect(isShareToken(token)).toBe(true)
    expect(isShareToken(hash)).toBe(false)
    expect(isShareToken('short')).toBe(false)
  })
})
