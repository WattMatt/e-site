/**
 * A `data:` URL as a Blob, decoded in memory.
 *
 * Do NOT use `fetch(dataUrl)` for this. The site's Content-Security-Policy `connect-src` does not
 * list `data:`, so the browser refuses the fetch ("Failed to fetch"). That is how saving an
 * inspection signature failed on every device, every time, until 2026-10-13: production held zero
 * signatures and every template with a required signature could never be submitted. The drawing-
 * markup save in FloorPlanAnnotator failed the same way. A guard test forbids `fetch(` on a data URL.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Not a data URL')
  const header = dataUrl.slice(5, comma)
  const mime = header.split(';')[0] || 'application/octet-stream'
  const payload = dataUrl.slice(comma + 1)
  if (header.includes(';base64')) {
    const bin = atob(payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}
