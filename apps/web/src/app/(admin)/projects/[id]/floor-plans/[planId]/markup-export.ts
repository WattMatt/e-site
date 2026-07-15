/**
 * PNG export helper for the floor-plan markup canvas.
 *
 * Extracted from MarkupCanvas.tsx so the base64→Blob conversion used by the
 * external-save (QC) path is unit-testable without pulling in react-konva /
 * pdfjs / a real <canvas>. Touches the DOM `Blob`/`atob` globals only (jsdom
 * provides both) — no React, no Konva.
 */

/**
 * Convert the raw base64 PNG returned by `snapshotScene()` (no `data:` prefix)
 * into a `Blob` for direct storage upload. Mirrors the decode the RFI server
 * action does with `Buffer.from(base64, 'base64')`, but stays client-side so
 * the QC flow can upload past the 10 MB server-action body cap.
 */
export function pngBase64ToBlob(pngBase64: string): Blob {
  const binary = atob(pngBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: 'image/png' })
}
