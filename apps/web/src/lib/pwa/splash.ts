/**
 * iOS ignores the manifest for launch screens; it wants one
 * <link rel="apple-touch-startup-image"> per device size, matched by media
 * query. This table is the single source for BOTH the <link>s (root layout
 * metadata) and the images (app/apple-splash/[size] route, prerendered).
 * Portrait only: field users hold the phone upright on launch.
 */
export interface SplashDevice {
  /** CSS points. */
  width: number
  height: number
  ratio: 2 | 3
}

export const SPLASH_DEVICES: readonly SplashDevice[] = [
  { width: 440, height: 956, ratio: 3 },  // iPhone 16/17 Pro Max
  { width: 420, height: 912, ratio: 3 },  // iPhone Air
  { width: 402, height: 874, ratio: 3 },  // iPhone 16 Pro
  { width: 430, height: 932, ratio: 3 },  // iPhone 14/15 Pro Max, 15/16 Plus
  { width: 393, height: 852, ratio: 3 },  // iPhone 14/15 Pro, 15, 16
  { width: 428, height: 926, ratio: 3 },  // iPhone 12/13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 },  // iPhone 12/13/14
  { width: 375, height: 812, ratio: 3 },  // iPhone X/XS/11 Pro, 12/13 mini
  { width: 414, height: 896, ratio: 3 },  // iPhone XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 },  // iPhone XR, 11
  { width: 414, height: 736, ratio: 3 },  // iPhone 8 Plus
  { width: 375, height: 667, ratio: 2 },  // iPhone SE 2/3, 8
  { width: 1032, height: 1376, ratio: 2 }, // iPad Pro 13" (M4)
  { width: 834, height: 1210, ratio: 2 },  // iPad Pro 11" (M4)
  { width: 1024, height: 1366, ratio: 2 }, // iPad Pro 12.9"
  { width: 834, height: 1194, ratio: 2 },  // iPad Pro 11"
  { width: 820, height: 1180, ratio: 2 },  // iPad Air
  { width: 810, height: 1080, ratio: 2 },  // iPad 10.2"
  { width: 744, height: 1133, ratio: 2 },  // iPad mini
]

/** The path segment for a device's image, e.g. "1170x2532.png" (ends in .png so middleware skips it). */
export function splashFile(d: SplashDevice): string {
  return `${d.width * d.ratio}x${d.height * d.ratio}.png`
}

export function splashMedia(d: SplashDevice): string {
  return `(device-width: ${d.width}px) and (device-height: ${d.height}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)`
}

/** Pixel size for a requested file, or null if it is not one we publish. */
export function parseSplashFile(file: string): { width: number; height: number } | null {
  const known = SPLASH_DEVICES.find(d => splashFile(d) === file)
  return known ? { width: known.width * known.ratio, height: known.height * known.ratio } : null
}

export function splashStartupImages(): { url: string; media: string }[] {
  return SPLASH_DEVICES.map(d => ({ url: `/apple-splash/${splashFile(d)}`, media: splashMedia(d) }))
}
