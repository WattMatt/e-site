// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readSvixHeaders, verifySvixSignature } from './svix-signature'

/**
 * Published standardwebhooks/Svix test vector. NOT computed by the code under
 * test — that is the whole point. secret/id/timestamp/payload/signature are
 * transcribed from the specification's worked example.
 */
const VECTOR = {
  secret:    'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id:        'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body:      '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}
// The vector's timestamp is in 2021, so every call pins `now` to it. Real
// requests use Date.now() and the 5-minute tolerance.
const NOW = Number(VECTOR.timestamp) * 1000

function verify(over: Partial<typeof VECTOR> = {}, now = NOW) {
  const v = { ...VECTOR, ...over }
  return verifySvixSignature({
    secret: v.secret,
    body: v.body,
    headers: { id: v.id, timestamp: v.timestamp, signature: v.signature },
    now,
  })
}

describe('verifySvixSignature', () => {
  it('accepts the published vector', () => {
    expect(verify()).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verify({ body: '{"test": 2432232315}' })).toBe(false)
  })

  it('rejects a tampered signature', () => {
    // Flip the FIRST base64 character, never the last. In a 44-char base64
    // string ending in one '=', the final data character carries 4 data bits
    // and 2 padding bits, so '...1OE=' and '...1OF=' decode to BYTE-IDENTICAL
    // buffers — a verifier returning false for that would be WRONG. Do not
    // "simplify" this back to a trailing-character flip.
    expect(verify({ signature: VECTOR.signature.replace('v1,g0hM', 'v1,h0hM') })).toBe(false)
  })

  it('rejects a different message id (the id is part of the signed content)', () => {
    expect(verify({ id: 'msg_p5jXN8AQM9LWM0D4loKWxJel' })).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(verify({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx' })).toBe(false)
  })

  it('accepts the same secret stored without the whsec_ prefix', () => {
    expect(verify({ secret: VECTOR.secret.slice('whsec_'.length) })).toBe(true)
  })

  it('rejects a timestamp outside the 5-minute tolerance', () => {
    expect(verify({}, NOW + 6 * 60 * 1000)).toBe(false)
    expect(verify({}, NOW - 6 * 60 * 1000)).toBe(false)
  })

  it('accepts a timestamp inside the tolerance', () => {
    expect(verify({}, NOW + 4 * 60 * 1000)).toBe(true)
  })

  it('accepts a rotated multi-signature header where only the second matches', () => {
    expect(verify({ signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${VECTOR.signature}` })).toBe(true)
  })

  it('rejects an unversioned or v2 signature', () => {
    expect(verify({ signature: VECTOR.signature.replace('v1,', 'v2,') })).toBe(false)
    expect(verify({ signature: VECTOR.signature.replace('v1,', '') })).toBe(false)
  })

  it('rejects a non-numeric timestamp without throwing', () => {
    expect(verify({ timestamp: 'not-a-number' })).toBe(false)
  })
})

describe('readSvixHeaders', () => {
  const map = (o: Record<string, string>) => (n: string) => o[n] ?? null

  it('reads the svix-* family Resend sends', () => {
    expect(readSvixHeaders(map({
      'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c',
    }))).toEqual({ id: 'a', timestamp: 'b', signature: 'c' })
  })

  it('reads the webhook-* family standardwebhooks defines', () => {
    expect(readSvixHeaders(map({
      'webhook-id': 'a', 'webhook-timestamp': 'b', 'webhook-signature': 'c',
    }))).toEqual({ id: 'a', timestamp: 'b', signature: 'c' })
  })

  it('returns null when any of the three is missing', () => {
    expect(readSvixHeaders(map({ 'svix-id': 'a', 'svix-timestamp': 'b' }))).toBeNull()
  })
})
