/**
 * Every photo the app stores goes through here first, so it displays and prints anywhere.
 *
 * What a phone or tablet hands the browser varies: an iPhone or iPad can give HEIC (which only
 * Safari can show, and which no PDF can embed), EXIF-rotated JPEGs, PNGs with transparency,
 * 12–48 MP originals, or a file whose `type` is empty. Before this, five copies of a resize helper
 * each fell back to uploading the ORIGINAL bytes on any failure, so an undecodable HEIC was stored
 * as-is and then shown as a broken image on every other device and left out of every report.
 *
 * The rules, in order:
 *  1. Identify the format from the file's own bytes, never from its name or `type`.
 *  2. Decode it: the browser's own decoder first (createImageBitmap, then <img>); for HEIC/HEIF that
 *     the browser cannot read (Chrome, Edge, Firefox, Windows), a WebAssembly decoder loaded only
 *     when needed.
 *  3. Bake the camera rotation into the pixels, cap the long edge at MAX_EDGE, paint transparency
 *     onto white.
 *  4. Re-encode as JPEG. This also drops all metadata, the photo's GPS position included.
 *  5. If any step fails, refuse with a sentence. Never upload bytes we could not read.
 */

/** Long edge, in pixels: sharp on a tablet screen, legible when printed, ~0.3–0.8 MB. */
export const MAX_EDGE = 2048
export const JPEG_QUALITY = 0.82

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'bmp' | 'tiff' | 'unknown'

export class ImageUnreadableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageUnreadableError'
  }
}

export interface PreparedImage {
  file: File
  width: number
  height: number
  /** The format the device actually supplied, for diagnostics. */
  sourceFormat: ImageFormat
}

/** The format from the first bytes. HEIC/HEIF/AVIF share the ISO-BMFF `ftyp` box. */
export function sniffImageFormat(head: Uint8Array): ImageFormat {
  const b = head
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))) return 'tiff'
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(brand)) return 'heic'
  }
  return 'unknown'
}

/** Long edge capped at maxEdge, aspect ratio kept, never enlarged. */
export function targetSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The first bytes. FileReader where Blob.arrayBuffer() is missing (Safari before iOS 14). */
async function readHead(blob: Blob, n = 32): Promise<Uint8Array> {
  const part = blob.slice(0, n)
  if (typeof (part as Blob & { arrayBuffer?: unknown }).arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer())
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(part)
  })
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

async function decodeWithBrowser(blob: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation` bakes EXIF rotation in; an older Safari rejects the options bag, so retry
    // without it (those versions orient from EXIF by default).
    for (const opts of [{ imageOrientation: 'from-image' as const }, undefined]) {
      try {
        const bmp = opts ? await createImageBitmap(blob, opts) : await createImageBitmap(blob)
        return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
      } catch {
        // try the next way
      }
    }
  }
  // <img> decodes formats createImageBitmap refuses on some engines, and orients from EXIF.
  if (typeof Image === 'function' && typeof URL?.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
      }
    } catch {
      // fall through
    }
    URL.revokeObjectURL(url)
  }
  return null
}

async function decodeHeic(blob: Blob): Promise<Blob | null> {
  try {
    // Loaded only when a HEIC/HEIF photo reaches a browser that cannot read it (~3 MB, once).
    const { heicTo } = await import('heic-to/csp')
    return await heicTo({ blob, type: 'image/jpeg', quality: 0.92 })
  } catch {
    return null
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

const UNREADABLE =
  'This photo could not be read on this device, so it was not uploaded. Take it again with the camera, or save it as a JPEG and choose that.'

/**
 * Turns whatever the device supplied into a JPEG every browser and every report can use.
 * Throws ImageUnreadableError (with a sentence for the person) when it cannot.
 */
export async function prepareImageForUpload(input: File | Blob, name = (input as File).name ?? 'photo'): Promise<PreparedImage> {
  const head = await readHead(input)
  const sourceFormat = sniffImageFormat(head)

  let decoded = await decodeWithBrowser(input)
  if (!decoded && sourceFormat === 'heic') {
    const jpeg = await decodeHeic(input)
    if (jpeg) decoded = await decodeWithBrowser(jpeg)
  }
  if (!decoded) throw new ImageUnreadableError(UNREADABLE)

  try {
    const size = targetSize(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageUnreadableError(UNREADABLE)
    ctx.fillStyle = '#ffffff' // transparency would turn black in a JPEG
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height)
    const blob = await canvasToJpeg(canvas, JPEG_QUALITY)
    if (!blob || blob.size === 0) throw new ImageUnreadableError(UNREADABLE)
    const base = String(name).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo'
    return { file: new File([blob], `${base}.jpg`, { type: 'image/jpeg' }), width: size.width, height: size.height, sourceFormat }
  } finally {
    decoded.release()
  }
}

/** True for anything that might be a photo: by bytes, falling back to the declared type or name. */
export async function looksLikeImage(file: File): Promise<boolean> {
  const head = await readHead(file)
  if (sniffImageFormat(head) !== 'unknown') return true
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.name)
}

/**
 * A photo comes back prepared (JPEG, see prepareImageForUpload); anything else, a video or a
 * document, comes back untouched. A photo that cannot be read throws ImageUnreadableError.
 */
export async function prepareIfImage(file: File): Promise<File> {
  if (file.type.startsWith('video/')) return file
  const head = await readHead(file)
  const format = sniffImageFormat(head)
  const declaredImage = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.name)
  if (format === 'unknown' && !declaredImage) return file
  return (await prepareImageForUpload(file)).file
}
