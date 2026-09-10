// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
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

/**
 * Forge a `v1,` signature the way an ATTACKER would, with a key of our choosing.
 * Used only where the fixture must be wrong in a specific way that the published
 * vector cannot express — a zero-length key, or a NaN timestamp inside the
 * signed content. Never used to produce the "valid" case; that stays the vector.
 */
function forge(key: Buffer, over: Partial<typeof VECTOR> = {}) {
  const v = { ...VECTOR, ...over }
  return 'v1,' + createHmac('sha256', key).update(`${v.id}.${v.timestamp}.${v.body}`).digest('base64')
}

/** The real key, base64-decoded out of the vector's whsec_ secret. */
const REAL_KEY = Buffer.from(VECTOR.secret.slice('whsec_'.length), 'base64')

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

  it('rejects a NaN timestamp even when the signature over it is valid', () => {
    // This is what the `Number.isFinite` guard is FOR, and the test above does
    // not exercise it: without the guard, `Math.abs(NaN) > TOLERANCE_MS` is
    // false, so the freshness check is silently SKIPPED and the only thing left
    // rejecting the request is the HMAC. Sign the literal 'not-a-number' with
    // the real key and the HMAC agrees — a request with no replay window at all.
    const timestamp = 'not-a-number'
    expect(verify({ timestamp, signature: forge(REAL_KEY, { timestamp }) })).toBe(false)
  })

  it('rejects a signature of the wrong byte length without throwing', () => {
    // timingSafeEqual THROWS on a length mismatch. Every other fixture in this
    // file decodes to exactly 32 bytes, so only these reach that branch.
    expect(verify({ signature: 'v1,AAAA' })).toBe(false)              // 3 bytes
    expect(verify({ signature: 'v1,' })).toBe(false)                  // 0 bytes
    expect(verify({ signature: `v1,${'A'.repeat(88)}` })).toBe(false) // 66 bytes
  })

  it('still finds the valid signature after a malformed one in the rotation list', () => {
    // The production shape of the bug above: a junk entry AHEAD of the good one
    // during key rotation, where a throw costs a legitimate delivery.
    expect(verify({ signature: `v1,AAAA ${VECTOR.signature}` })).toBe(true)
  })

  it('rejects an empty or undecodable secret instead of keying the HMAC with zero bytes', () => {
    // createHmac accepts a zero-length key silently, so without the guard an empty
    // secret verifies against a digest ANYONE can compute. The fixture must be
    // forged WITH the empty key — asserting VECTOR.signature here would pass with
    // the guard deleted.
    const forged = forge(Buffer.alloc(0))
    for (const secret of ['whsec_', 'whsec_!!!!', '']) {
      expect(verify({ secret, signature: forged })).toBe(false)
    }
  })

  it('returns false rather than throwing when the secret or signature is missing', () => {
    // `secret: string` type-checks a `process.env.RESEND_WEBHOOK_SECRET!` that is
    // undefined at runtime. A throw here is worse than a false: a handler that
    // wraps itself in try/catch -> 200 (to stop provider retries) turns it into a
    // bypass. Same for a header triple assembled by hand rather than by
    // readSvixHeaders.
    const missing = undefined as unknown as string
    expect(verify({ secret: missing })).toBe(false)
    expect(verify({ signature: missing })).toBe(false)
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

  it('treats a blank-but-present header as absent', () => {
    // Otherwise the caller logs "invalid signature" when the truth is "no
    // signature" — two different incidents (wrong secret vs. not-Resend-at-all).
    expect(readSvixHeaders(map({
      'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': '   ',
    }))).toBeNull()
    expect(readSvixHeaders(map({
      'svix-id': '', 'svix-timestamp': 'b', 'svix-signature': 'c',
    }))).toBeNull()
  })

  it('returns header values untrimmed', () => {
    // `id` and `timestamp` are part of the signed string, so trimming them here
    // would change what gets hashed and break verification against a sender that
    // signed the padded value. Blankness is a presence check, not a normaliser.
    expect(readSvixHeaders(map({
      'svix-id': ' a ', 'svix-timestamp': 'b', 'svix-signature': 'c',
    }))).toEqual({ id: ' a ', timestamp: 'b', signature: 'c' })
  })
})
