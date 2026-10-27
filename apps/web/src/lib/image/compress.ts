/**
 * Client-side image preparation for photo uploads.
 *
 * The one place every photo path (inspection fields, site forms, snags, QC
 * entries) turns a picked File into something the storage buckets will
 * accept. Those buckets carry MIME allow-lists (jpeg/png/heic, some webp), so
 * the upload MUST carry a real image content type:
 *
 *  - `File.type` is empty when the OS doesn't know the extension — e.g. an
 *    iPhone .HEIC copied to Windows without the HEIF codec. supabase-js then
 *    sends `application/octet-stream` and the bucket refuses it ("mime type
 *    application/octet-stream is not supported"). So the type is resolved
 *    from the file's magic bytes, then its extension, never trusted blank.
 *  - Chrome/Edge cannot decode HEIC at all; those files are converted to JPEG
 *    (heic2any, lazy-loaded only when needed) so the photo also renders in
 *    the app and the PDF report (react-pdf embeds only JPEG/PNG).
 *
 * Everything decodable is downscaled to 2048 px and re-encoded as JPEG q0.85.
 * A JPEG/PNG that would come out larger is kept as-is; any other format is
 * always re-encoded so only JPEG/PNG reach the buckets when possible.
 *
 * Falls back to the original bytes (correctly labelled) on any failure — a
 * photo that uploads slightly big beats a photo that doesn't upload.
 */

const MAX_WIDTH = 2048
const QUALITY = 0.85

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
}

const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])

/** Formats every photo bucket and the PDF renderer accept untouched. */
const PASSTHROUGH_MIMES = new Set(['image/jpeg', 'image/png'])

function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  }
  return ''
}

/** First bytes of a blob. FileReader fallback for engines without Blob.arrayBuffer (Safari < 14). */
async function readHead(file: Blob): Promise<Uint8Array> {
  const slice = file.slice(0, 16)
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer())
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(slice)
  })
  return new Uint8Array(buf)
}

/**
 * The file's real image MIME type, or '' if it isn't a recognisable image.
 * Trusts `file.type` only when it already names an image.
 */
export async function detectImageMime(file: File): Promise<string> {
  if (file.type.startsWith('image/')) return file.type
  try {
    const head = await readHead(file)
    const sniffed = sniffImageMime(head)
    if (sniffed) return sniffed
  } catch {
    // unreadable — fall through to the extension
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? ''
}

/** Decode → resize → JPEG. Null when this browser can't decode the bytes. */
async function reencodeAsJpeg(source: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null
  let bitmap: ImageBitmap | null = null
  try {
    // imageOrientation:'from-image' bakes EXIF rotation into the pixels, so
    // phone photos don't arrive sideways in the PDF.
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

/** HEIC → JPEG for browsers without a native HEIC decoder (Chrome, Edge). */
async function convertHeicToJpeg(source: Blob): Promise<Blob | null> {
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: source, toType: 'image/jpeg', quality: QUALITY })
    const jpeg = Array.isArray(out) ? out[0] : out
    if (!jpeg) return null
    // heic2any returns full resolution; downscale like every other photo.
    return (await reencodeAsJpeg(jpeg)) ?? jpeg
  } catch {
    return null
  }
}

export async function compressImage(file: File): Promise<File> {
  const mime = await detectImageMime(file)
  if (!mime) return file

  // Relabel up front so even the fallback path never uploads as octet-stream.
  const typed = file.type === mime ? file : new File([file], file.name, { type: mime })

  const jpeg =
    (await reencodeAsJpeg(typed)) ?? (HEIC_MIMES.has(mime) ? await convertHeicToJpeg(typed) : null)
  if (!jpeg) return typed
  if (PASSTHROUGH_MIMES.has(mime) && jpeg.size >= typed.size) return typed

  return new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

/** A storage-safe extension that matches the file's (resolved) type. */
export function extensionForImage(file: File): string {
  const fromType = Object.entries(EXT_MIME).find(([, m]) => m === file.type)?.[0]
  return fromType === 'jpeg' || fromType === 'jfif' ? 'jpg' : (fromType ?? 'jpg')
}

/**
 * compressImage, but refuses anything that is not an image, with a message a
 * field worker can act on (instead of the bucket's raw MIME error).
 */
export async function prepareImageUpload(file: File): Promise<File> {
  const prepared = await compressImage(file)
  if (!prepared.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not a photo the app can read. Use a JPEG, PNG or HEIC image.`)
  }
  return prepared
}

/**
 * Upload one snag photo and write its row, cleaning up the storage object if
 * the row write fails.
 *
 * The ordering matters: the bucket accepts the object before the table applies
 * its CHECK/RLS, so a failed insert would otherwise strand a file nobody can
 * reach — exactly how the `photo_type:'defect'` bug filled the bucket with
 * orphans while leaving field.snag_photos empty.
 */
export async function uploadSnagPhoto(
  supabase: {
    storage: { from: (b: string) => { upload: (p: string, f: File, o?: unknown) => Promise<{ error: { message: string } | null }>; remove: (p: string[]) => Promise<unknown> } }
    schema: (s: string) => { from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } }
  },
  opts: {
    file: File
    orgId: string
    projectId: string
    snagId: string
    photoType: 'evidence' | 'closeout' | 'markup'
    sortOrder: number
    uploadedBy: string | null
    visitId?: string | null
    caption?: string | null
  },
): Promise<void> {
  const prepared = await prepareImageUpload(opts.file)
  const ext = extensionForImage(prepared)
  const path = `${opts.orgId}/${opts.projectId}/${opts.snagId}/${Date.now()}-${opts.sortOrder}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('snag-photos')
    .upload(path, prepared, { contentType: prepared.type })
  if (upErr) throw new Error(upErr.message)

  const { error: insErr } = await supabase.schema('field').from('snag_photos').insert({
    snag_id: opts.snagId,
    file_path: path,
    caption: opts.caption ?? opts.file.name,
    photo_type: opts.photoType,
    sort_order: opts.sortOrder,
    uploaded_by: opts.uploadedBy,
    ...(opts.visitId ? { visit_id: opts.visitId } : {}),
  })
  if (insErr) {
    await supabase.storage.from('snag-photos').remove([path])
    throw new Error(insErr.message)
  }
}
