import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { canonicalJson, inputsHash, sha256Hex } from './hash'

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('agrees with node:crypto across block boundaries and multi-byte UTF-8', () => {
    const alphabet = 'aZ9 ,.{}"é€🙂Ω≤'
    for (let len = 0; len <= 200; len++) {
      let s = ''
      for (let i = 0; i < len; i++) s += alphabet[(i * 7 + len) % alphabet.length]
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })
})

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it('writes typed arrays as plain arrays and -0 as 0', () => {
    expect(canonicalJson({ x: Float64Array.from([1.5, -0]) })).toBe('{"x":[1.5,0]}')
  })

  it('refuses NaN and Infinity instead of hashing them as null', () => {
    expect(() => canonicalJson({ a: [1, Number.NaN] })).toThrow(/non-finite number at \$\.a\[1\]/)
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/)
  })
})

describe('inputsHash', () => {
  it('is independent of key order and sensitive to any value', () => {
    const a = inputsHash({ kWp: 100, tilt: 30, load: Float64Array.from([1, 2]) })
    expect(inputsHash({ load: [1, 2], tilt: 30, kWp: 100 })).toBe(a)
    expect(inputsHash({ kWp: 100, tilt: 30.0001, load: [1, 2] })).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
