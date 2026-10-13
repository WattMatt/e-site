/**
 * Read a chosen file's bytes in the browser BEFORE uploading it.
 *
 * Why: a Dropbox / OneDrive / iCloud "online-only" placeholder reports a real
 * size to the browser but cannot be read. supabase-js then gets as far as the
 * CORS preflight and never sends the PUT, so storage logs show sign 200 +
 * OPTIONS 200 and nothing else (seen 2026-10-13 on 643.E.001 / 643.E.300, both
 * 0 bytes on disk). Reading first turns that into a sentence the person can
 * act on, and the upload then sends exactly the bytes that were read.
 */

export type ReadUploadResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: string; cause?: unknown }

function unreadable(name: string): string {
  return `${name} could not be read from this computer. If it is a Dropbox, OneDrive or iCloud file that is online-only, right-click it and make it available offline (or open it once so it downloads), then upload again.`
}

function readAll(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  // Older engines (and jsdom) without Blob#arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export async function readUploadBytes(file: File, mime: string): Promise<ReadUploadResult> {
  let buf: ArrayBuffer
  try {
    buf = await readAll(file)
  } catch (cause) {
    return { ok: false, error: unreadable(file.name), cause }
  }
  if (buf.byteLength === 0 || (file.size > 0 && buf.byteLength < file.size)) {
    return { ok: false, error: unreadable(file.name) }
  }
  return { ok: true, blob: new Blob([buf], { type: mime }) }
}

const NETWORK = /failed to fetch|load failed|networkerror|network request failed/i
const MAX_REASON = 120

/** The upload's own reason, kept short; never just "failed". */
export function uploadFailedMessage(name: string, err: { message?: string } | null | undefined): string {
  const reason = err?.message?.trim()
  if (!reason) return `Uploading ${name} failed. Try again.`
  if (NETWORK.test(reason)) {
    return `Uploading ${name} failed (the connection to file storage dropped). Check your connection and try again.`
  }
  const short = reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON)}…` : reason
  return `Uploading ${name} failed (${short}). Try again.`
}
