/**
 * The install surface, checked against the files that actually ship: every
 * icon the manifest names must exist in public/ at the size it claims, and
 * every iOS launch image link must be one the splash route prerenders.
 */
import { describe, it, expect, vi } from 'vitest'

// The root layout imports next/font/google, which only works inside Next's build.
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '', className: '' })
  return { Syne: font, JetBrains_Mono: font, Fraunces: font, IBM_Plex_Mono: font }
})
vi.mock('@fontsource-variable/mona-sans', () => ({}))
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import manifest from '@/app/manifest'
import { metadata, viewport } from '@/app/layout'
import { SPLASH_DEVICES, parseSplashFile, splashFile, splashStartupImages } from './splash'

const PUBLIC = path.join(__dirname, '../../../public')

/** Width × height from a PNG's IHDR chunk. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file)
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('web app manifest', () => {
  const m = manifest()

  it('is installable as a standalone app scoped to the whole origin', () => {
    expect(m.display).toBe('standalone')
    expect(m.scope).toBe('/')
    expect(m.start_url?.startsWith('/')).toBe(true)
    expect(m.name).toBe('E-Site')
    expect(m.theme_color).toMatch(/^#[0-9A-F]{6}$/i)
    expect(m.background_color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('names a 192 and a 512 icon plus a maskable one, each a real PNG of the stated size', () => {
    const icons = m.icons ?? []
    for (const need of ['192x192', '512x512']) expect(icons.some(i => i.sizes === need && i.purpose === 'any')).toBe(true)
    expect(icons.some(i => i.purpose === 'maskable')).toBe(true)
    for (const icon of icons) {
      const file = path.join(PUBLIC, icon.src)
      expect(existsSync(file), icon.src).toBe(true)
      const [w, h] = (icon.sizes ?? '').split('x').map(Number)
      expect(pngSize(file), icon.src).toEqual({ w, h })
    }
  })
})

describe('iOS install metadata', () => {
  it('declares a home-screen app with an apple-touch-icon that exists at 180×180', () => {
    const awa = metadata.appleWebApp as { capable: boolean; statusBarStyle: string }
    expect(awa.capable).toBe(true)
    // 'default' = content below an opaque status bar on every layout (see layout.tsx).
    expect(awa.statusBarStyle).toBe('default')
    const apple = (metadata.icons as { apple: { url: string }[] }).apple[0].url
    expect(pngSize(path.join(PUBLIC, apple))).toEqual({ w: 180, h: 180 })
  })

  it('uses viewport-fit=cover, and every layout handles the insets that switches on', () => {
    expect(viewport.viewportFit).toBe('cover')
    const css = readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8')
    // Landscape notch, on every layout (auth, portal, public, app).
    expect(css).toMatch(/body\s*\{\s*padding-left:\s*env\(safe-area-inset-left\);\s*padding-right:\s*env\(safe-area-inset-right\);/)
    // Home indicator: the phone tab bar and the desktop sidebar's foot.
    expect(css).toMatch(/\.mobile-tabbar\s*\{[^}]*env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/\.sidebar\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom\);/)
  })

  it('links one launch image per device, each with a distinct portrait media query', () => {
    const links = splashStartupImages()
    expect(links).toHaveLength(SPLASH_DEVICES.length)
    for (const l of links) expect(l.media).toMatch(/-webkit-device-pixel-ratio: [23]\) and \(orientation: portrait\)$/)
    expect(new Set(links.map(l => l.media)).size).toBe(links.length)
    // The image behind each link is rendered and measured in app/apple-splash/[size]/route.test.ts.
  })

  it('emits the apple-prefixed capable tag older iOS needs for launch images', () => {
    expect((metadata.other as Record<string, string>)['apple-mobile-web-app-capable']).toBe('yes')
  })

  it('refuses sizes it does not publish (the route cannot be used to render arbitrary images)', () => {
    expect(parseSplashFile(splashFile(SPLASH_DEVICES[0]))).toEqual({ width: 1320, height: 2868 })
    expect(parseSplashFile('99999x99999.png')).toBeNull()
    expect(parseSplashFile('1170x2532')).toBeNull()
  })
})
