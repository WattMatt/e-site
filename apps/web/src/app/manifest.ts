import type { MetadataRoute } from 'next'
import { PWA_BRAND } from '@/lib/pwa/brand'

/**
 * Served at /manifest.webmanifest (Next adds the <link>). The middleware
 * matcher lets it through unauthenticated — a manifest that answers with a
 * login redirect fails installability silently.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: PWA_BRAND.name,
    short_name: PWA_BRAND.name,
    description: PWA_BRAND.description,
    start_url: '/projects',
    scope: '/',
    display: 'standalone',
    background_color: PWA_BRAND.base,
    theme_color: PWA_BRAND.surfaceDark,
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
