import type { MetadataRoute } from 'next'

// Sitemap for the public surface. Crawled by Paystack KYC reviewer and by
// search engines. Only the unauthenticated, indexable routes belong here —
// the (admin) app, auth flows, and API routes stay out.
//
// `NEXT_PUBLIC_SITE_URL` should be set to the canonical URL of the public
// site (e.g. `https://e-site.live`). It falls back to the Vercel preview URL
// at build time so generated absolute URLs work on previews too.

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://e-site.live')

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    { url: `${SITE_URL}/`,                                 lastModified, changeFrequency: 'monthly', priority: 1.0 },
    { url: `${SITE_URL}/pricing`,                          lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/legal/acceptable-use-policy`,      lastModified, changeFrequency: 'yearly',  priority: 0.5 },
    { url: `${SITE_URL}/legal/privacy`,                    lastModified, changeFrequency: 'yearly',  priority: 0.5 },
    { url: `${SITE_URL}/legal/terms`,                      lastModified, changeFrequency: 'yearly',  priority: 0.5 },
  ]
}
