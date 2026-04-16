/**
 * QR Code Service
 *
 * Generates QR codes per compliance subsection.
 * Each QR encodes a deep link to the subsection's compliance record.
 *
 * Web: renders SVG string or data URL via qrcode package.
 * Mobile: renders via react-native-qrcode-svg (separate component).
 *
 * Spec § 7.2 T-026
 */

export interface QrCodeOptions {
  /** Width/height in pixels (default 256) */
  size?: number
  /** Error correction level: L(7%), M(15%), Q(25%), H(30%) */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  /** Output format */
  format?: 'svg' | 'dataUrl'
}

/**
 * Build the deep link URL for a subsection.
 * Web: https://app.esite.co.za/compliance/{siteId}/{subsectionId}
 * Mobile deep link: esite://compliance/{siteId}/{subsectionId}
 */
export function buildSubsectionQrUrl(
  siteId: string,
  subsectionId: string,
  baseUrl = 'https://app.esite.co.za',
): string {
  return `${baseUrl}/compliance/${siteId}/${subsectionId}`
}

/**
 * Build QR label data (used for print-ready PDF export).
 */
export interface QrLabelData {
  subsectionId: string
  subsectionName: string
  siteName: string
  sansRef?: string
  url: string
}

export function buildQrLabelData(params: {
  subsectionId: string
  subsectionName: string
  siteName: string
  sansRef?: string
  baseUrl?: string
  siteId: string
}): QrLabelData {
  return {
    subsectionId: params.subsectionId,
    subsectionName: params.subsectionName,
    siteName: params.siteName,
    sansRef: params.sansRef,
    url: buildSubsectionQrUrl(params.siteId, params.subsectionId, params.baseUrl),
  }
}

/**
 * Parse a subsection URL or deep link back to its IDs.
 * Returns null if the URL is not a valid E-Site compliance deep link.
 *
 * Supported formats:
 *   https://app.esite.co.za/compliance/{siteId}/{subsectionId}
 *   esite://compliance/{siteId}/{subsectionId}
 */
export function parseSubsectionQrUrl(url: string): {
  siteId: string
  subsectionId: string
} | null {
  // Match web URL
  const webMatch = url.match(/\/compliance\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:[/?#].*)?$/i)
  if (webMatch) {
    return { siteId: webMatch[1], subsectionId: webMatch[2] }
  }

  // Match deep link
  const deepMatch = url.match(/^esite:\/\/compliance\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i)
  if (deepMatch) {
    return { siteId: deepMatch[1], subsectionId: deepMatch[2] }
  }

  return null
}

/**
 * Generate QR code as SVG string (server-side / web only).
 *
 * NOTE: Requires the `qrcode` npm package:
 *   pnpm add qrcode @types/qrcode -w
 *
 * Used for PDF label generation and web display.
 */
export async function generateQrSvg(
  text: string,
  options: QrCodeOptions = {},
): Promise<string> {
  // Dynamic import avoids bundling qrcode into the mobile app
  const QRCode = await import('qrcode')
  const svg = await QRCode.toString(text, {
    type: 'svg',
    width: options.size ?? 256,
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  })
  return svg
}

/**
 * Generate QR code as base64 data URL (for use in <img> tags and PDF).
 */
export async function generateQrDataUrl(
  text: string,
  options: QrCodeOptions = {},
): Promise<string> {
  const QRCode = await import('qrcode')
  return QRCode.toDataURL(text, {
    width: options.size ?? 256,
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  })
}
