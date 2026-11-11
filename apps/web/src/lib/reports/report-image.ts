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

// Decoding a 12 MP photo holds ~50 MB of pixels; an entry-parallel gatherer that decodes 40 at
// once can exhaust a serverless function. Every report photo goes through this one queue.
const MAX_CONCURRENT_DECODES = 4
let active = 0
const waiting: (() => void)[] = []
async function withDecodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_DECODES) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

/** Anything with a Supabase-style storage download (the service client). */
interface StorageDownloader {
  storage: { from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: unknown }> } }
}

/**
 * Download a stored PHOTO and return it as a downscaled JPEG data: URI for a report, or null when
 * it cannot be downloaded or decoded (the report then shows an "image unavailable" slot). Logos
 * and signatures do NOT come through here: they keep their PNG transparency.
 */
export async function photoToReportDataUri(
  service: StorageDownloader,
  bucket: string,
  path: string,
): Promise<string | null> {
  try {
    const { data, error } = await service.storage.from(bucket).download(path)
    if (error || !data) return null
    const raw = new Uint8Array(await data.arrayBuffer())
    const jpeg = await withDecodeSlot(() => toReportJpeg(raw))
    return jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null
  } catch {
    return null
  }
}
