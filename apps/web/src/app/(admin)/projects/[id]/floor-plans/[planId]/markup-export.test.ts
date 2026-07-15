import { describe, it, expect } from 'vitest'
import { pngBase64ToBlob } from './markup-export'

// A 1×1 transparent PNG (raw base64, no data: prefix) — the shape of the
// string `snapshotScene()` hands to the external-save path.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('pngBase64ToBlob', () => {
  it('produces an image/png Blob', () => {
    const blob = pngBase64ToBlob(ONE_PX_PNG_BASE64)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
  })

  it('decodes to the exact byte length of the base64 payload', () => {
    // base64 → bytes: every 4 chars = 3 bytes, minus the '=' padding.
    const blob = pngBase64ToBlob(ONE_PX_PNG_BASE64)
    const padding = (ONE_PX_PNG_BASE64.match(/=+$/)?.[0].length ?? 0)
    const expected = (ONE_PX_PNG_BASE64.length / 4) * 3 - padding
    expect(blob.size).toBe(expected)
  })

  it('returns an empty Blob for an empty string', () => {
    const blob = pngBase64ToBlob('')
    expect(blob.size).toBe(0)
    expect(blob.type).toBe('image/png')
  })
})
