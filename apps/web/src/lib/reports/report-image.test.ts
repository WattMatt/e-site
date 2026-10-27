// @vitest-environment node
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { toReportJpeg, REPORT_IMAGE_EDGE } from './report-image'

describe('toReportJpeg', () => {
  it('applies the EXIF rotation, caps the long edge and stays small', async () => {
    // A 4032×3024 landscape-stored phone photo tagged "rotate 90°" (how an iPhone saves portrait).
    const noisy = Buffer.alloc(4032 * 3024 * 3)
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 2654435761) >>> 24
    const src = await sharp(noisy, { raw: { width: 4032, height: 3024, channels: 3 } })
      .jpeg({ quality: 92 })
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const out = await toReportJpeg(src)
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([Math.round((3024 * REPORT_IMAGE_EDGE) / 4032), REPORT_IMAGE_EDGE]) // portrait now
    expect(meta.orientation ?? 1).toBe(1)
    expect(out!.length).toBeLessThan(src.length)
  })

  it('paints transparency white instead of black', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const { data } = await sharp((await toReportJpeg(png))!).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(240)
  })

  it('returns null for bytes it cannot read, so one bad photo does not sink the report', async () => {
    expect(await toReportJpeg(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]))).toBeNull()
  })
})
