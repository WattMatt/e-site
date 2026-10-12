import sharp from 'sharp'

/** Long edge of a photo embedded in a report: ~300 dpi at the 4.5 in a full-width photo prints at. */
export const REPORT_IMAGE_EDGE = 1400
export const REPORT_IMAGE_QUALITY = 72

/**
 * Makes a stored photo safe and small enough to embed in a PDF.
 *
 * Photos are prepared on upload (lib/image/prepare.ts), but rows from before that, or from another
 * client, can be any size, rotated by EXIF only, or PNG with transparency. Embedded as-is, a
 * 30-photo inspection came to ~40 MB. Every photo goes through the same steps here: the EXIF
 * rotation applied, the long edge capped, transparency painted white, re-encoded as JPEG.
 *
 * Returns null when the bytes cannot be read (an undecodable HEIC, a corrupt file): the report then
 * shows "[image unavailable]" for that one photo rather than failing as a whole.
 */
export async function toReportJpeg(bytes: Uint8Array): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: REPORT_IMAGE_EDGE, height: REPORT_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: REPORT_IMAGE_QUALITY, mozjpeg: true })
      .toBuffer()
  } catch {
    return null
  }
}
