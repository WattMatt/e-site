import { describe, expect, it } from 'vitest'
import { compressImage, detectImageMime, extensionForImage, prepareImageUpload } from './compress'

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]
// ISO-BMFF box: size, 'ftyp', brand 'heic' — what an iPhone .HEIC starts with.
const HEIC_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]

const file = (bytes: number[], name: string, type = '') => new File([new Uint8Array(bytes)], name, { type })

describe('detectImageMime', () => {
  it('trusts an image File.type', async () => {
    expect(await detectImageMime(file(JPEG_HEAD, 'a.jpg', 'image/jpeg'))).toBe('image/jpeg')
  })

  it('sniffs a JPEG whose File.type is blank (the octet-stream failure)', async () => {
    expect(await detectImageMime(file(JPEG_HEAD, 'IMG_2408.jpg'))).toBe('image/jpeg')
  })

  it('sniffs HEIC by magic bytes even with a misleading name', async () => {
    expect(await detectImageMime(file(HEIC_HEAD, 'IMG_2409'))).toBe('image/heic')
  })

  it('re-checks a non-image File.type such as application/octet-stream', async () => {
    expect(await detectImageMime(file(JPEG_HEAD, 'x', 'application/octet-stream'))).toBe('image/jpeg')
  })

  it('falls back to the extension when bytes are unknown', async () => {
    expect(await detectImageMime(file([1, 2, 3], 'IMG_1.HEIC'))).toBe('image/heic')
  })

  it('returns empty for non-images', async () => {
    expect(await detectImageMime(file([0x25, 0x50, 0x44, 0x46], 'doc.pdf'))).toBe('')
  })
})

describe('compressImage / prepareImageUpload (no canvas in jsdom → fallback path)', () => {
  it('never returns a blank type for a recognisable image', async () => {
    const out = await compressImage(file(JPEG_HEAD, 'IMG_2408.jpg'))
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_2408.jpg')
  })

  it('refuses a non-image with a readable message', async () => {
    await expect(prepareImageUpload(file([0x25, 0x50, 0x44, 0x46], 'doc.pdf'))).rejects.toThrow(
      /not a photo the app can read/,
    )
  })
})

describe('extensionForImage', () => {
  it('derives the extension from the resolved type', () => {
    expect(extensionForImage(file([], 'photo', 'image/jpeg'))).toBe('jpg')
    expect(extensionForImage(file([], 'x.HEIC', 'image/heic'))).toBe('heic')
    expect(extensionForImage(file([], 'x', 'image/png'))).toBe('png')
  })
})
