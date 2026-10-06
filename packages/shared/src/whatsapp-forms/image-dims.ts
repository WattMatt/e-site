/**
 * Identify a JPEG or PNG from its bytes and read its pixel size, without decoding.
 * The mime type comes from the magic bytes, never from what Meta or the sender claims.
 * Returns null for anything else, including a truncated JPEG with no frame header.
 */
export interface ImageInfo {
  mime: 'image/jpeg' | 'image/png'
  width: number
  height: number
}

// SOF markers carry the frame size. C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const width = dv.getUint32(16)
    const height = dv.getUint32(20)
    return width > 0 && height > 0 ? { mime: 'image/png', width, height } : null
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) { i += 1; continue } // fill byte
    if (marker === 0xd9 || marker === 0xda) return null // EOI / start of scan before any frame
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2) return null
    if (SOF.has(marker)) {
      if (i + 8 >= b.length) return null
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      return width > 0 && height > 0 ? { mime: 'image/jpeg', width, height } : null
    }
    i += 2 + len
  }
  return null
}
