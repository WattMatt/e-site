import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sniffImageFormat, targetSize, prepareImageForUpload, ImageUnreadableError, MAX_EDGE, PHOTO_ACCEPT } from './prepare'

const { heicToMock } = vi.hoisted(() => ({ heicToMock: vi.fn() }))
vi.mock('heic-to/csp', () => ({ heicTo: heicToMock }))

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(Math.max(0, 32 - b.length)).fill(0)])
const ftyp = (brand: string) => bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0)))
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)

describe('sniffImageFormat: from the bytes, never the name', () => {
  it.each([
    ['jpeg', JPEG],
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['gif', bytes(0x47, 0x49, 0x46, 0x38)],
    ['webp', bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)],
    ['heic', ftyp('heic')],
    ['heic', ftyp('mif1')],
    ['avif', ftyp('avif')],
    ['unknown', bytes(0x25, 0x50, 0x44, 0x46)], // %PDF
  ])('%s', (format, head) => {
    expect(sniffImageFormat(head as Uint8Array)).toBe(format)
  })
})

describe('targetSize', () => {
  it('caps the LONG edge, so a portrait photo is not left full size', () => {
    expect(targetSize(3024, 4032)).toEqual({ width: 1536, height: MAX_EDGE })
    expect(targetSize(8064, 6048)).toEqual({ width: MAX_EDGE, height: 1536 })
  })
  it('never enlarges', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('prepareImageForUpload', () => {
  const drawn: Array<{ w: number; h: number }> = []
  let decodable: (b: Blob) => boolean

  beforeEach(() => {
    drawn.length = 0
    heicToMock.mockReset()
    decodable = () => true
    vi.stubGlobal('createImageBitmap', vi.fn(async (b: Blob) => {
      if (!decodable(b)) throw new Error('InvalidStateError: The source image could not be decoded.')
      return { width: 4032, height: 3024, close: vi.fn() }
    }))
    // jsdom has no <img> decoder: make it fail so only createImageBitmap or the HEIC path can succeed.
    vi.stubGlobal('Image', class { decoding = ''; src = ''; naturalWidth = 0; naturalHeight = 0; decode() { return Promise.reject(new Error('no')) } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { fillRect: vi.fn(), drawImage: () => drawn.push({ w: this.width, h: this.height }), fillStyle: '', imageSmoothingQuality: '' } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback, type?: string) =>
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('re-encodes any readable photo as a JPEG, long edge capped, named .jpg', async () => {
    const out = await prepareImageForUpload(new File([JPEG], 'IMG_0001.JPG', { type: '' }))
    expect(out.file.type).toBe('image/jpeg')
    expect(out.file.name).toBe('IMG_0001.jpg')
    expect([out.width, out.height]).toEqual([MAX_EDGE, 1536])
    expect(drawn).toEqual([{ w: MAX_EDGE, h: 1536 }])
    expect(out.sourceFormat).toBe('jpeg')
  })

  it('an iPhone HEIC the browser cannot read goes through the HEIC decoder, and still comes out JPEG', async () => {
    const heic = new File([ftyp('heic')], 'IMG_0002.HEIC', { type: 'image/heic' })
    decodable = (b) => b !== heic // the browser refuses the HEIC itself, reads the decoder's JPEG
    heicToMock.mockResolvedValue(new Blob([JPEG], { type: 'image/jpeg' }))
    const out = await prepareImageForUpload(heic)
    expect(heicToMock).toHaveBeenCalledWith(expect.objectContaining({ blob: heic, type: 'image/jpeg' }))
    expect(out.file.type).toBe('image/jpeg')
    expect(out.sourceFormat).toBe('heic')
  })

  it('an iPad HEIC picked on a Windows PC (no type, as Windows reports it) is still converted to JPEG', async () => {
    // Without the HEIF extension Windows gives the browser type "" — production uploaded that raw,
    // and the bucket refused it as application/octet-stream (2026-10-14).
    const heic = new File([ftyp('heic')], 'IMG_4821.HEIC', { type: '' })
    decodable = (b) => b !== heic
    heicToMock.mockResolvedValue(new Blob([JPEG], { type: 'image/jpeg' }))
    const out = await prepareImageForUpload(heic)
    expect(out.file.type).toBe('image/jpeg')
    expect(out.file.name).toBe('IMG_4821.jpg')
    expect(out.sourceFormat).toBe('heic')
  })

  it('every photo picker accepts .heic explicitly, so Windows shows iPad photos in the dialog', () => {
    expect(PHOTO_ACCEPT.split(',')).toEqual(expect.arrayContaining(['image/*', '.heic', '.heif']))
  })

  it('refuses with a sentence, rather than uploading bytes nobody else could open', async () => {
    decodable = () => false
    heicToMock.mockResolvedValue(null)
    await expect(prepareImageForUpload(new File([ftyp('heic')], 'x.heic'))).rejects.toBeInstanceOf(ImageUnreadableError)
    await expect(prepareImageForUpload(new File([bytes(1, 2, 3)], 'x.raw'))).rejects.toThrow(/could not be read on this device/)
  })
})
