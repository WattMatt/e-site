import { describe, it, expect } from 'vitest'
import { sha256Hex } from './sha256'

describe('sha256Hex (browser WebCrypto)', () => {
  it('hashes bytes to lowercase hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
